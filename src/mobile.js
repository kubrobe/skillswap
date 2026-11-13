import crypto from 'node:crypto';
// JSON API for the SkillSwap Android app.
//
// The website and the app share ONE PostgreSQL database and ONE sessions table.
// The only difference is how the session token travels: the website uses a cookie,
// the app sends "Authorization: Bearer <token>" (phones have no cookie jar).
//
// The app keeps a local Room (SQLite) copy of what it downloads, so it still works
// without internet. GET /api/mobile/sync returns that whole snapshot in one request.
import bcrypt from 'bcryptjs';
import { query, withTransaction } from './db.js';
import { createSessionToken, deleteSession, requireAuth, sessionToken } from './auth.js';
import { HttpError, cleanEmail, cleanPassword, cleanText, cleanId } from './validate.js';
import { openStream, broadcastChanged, notify, notifyAllExcept, sendCredit, broadcastActivity } from './live.js';
import { aiPlan, templatePlan, dayName } from './plan.js';
import { understand, rankOffers, aiMatch } from './matchmaker.js';
import { telegramAppRoutes } from './telegram.js';
import { mobileSchemaReady } from './migrations.js';

// Live messages are sent AFTER the answer; a problem there must never break the request.
const later = (work) => Promise.resolve().then(work).catch((e) => console.error('live update failed:', e.message));

const WELCOME_CREDITS = 5;     // a new member can learn 5 hours before teaching anything

// Gives the one-time welcome gift (website accounts get it on their first app visit).
export const giveWelcome = (db, userId) => db.query(
  `INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, 'welcome')
   ON CONFLICT (user_id) WHERE reason = 'welcome' DO NOTHING`, [userId, WELCOME_CREDITS]);

const balanceOf = async (db, userId) =>
  (await db.query('SELECT COALESCE(SUM(amount), 0)::int AS n FROM credit_ledger WHERE user_id = $1', [userId])).rows[0].n;

// Top 10 teachers by finished lessons, this week (Monday on) or all time. A lesson counts when it was checked in.
const leaderboard = (thisWeek) => query(
  `SELECT o.user_id AS id, split_part(p.display_name, ' ', 1) AS name, count(*)::int AS lessons,
          COALESCE(round(avg(r.rating)::numeric, 1), 0)::float AS rating,
          (SELECT s.emoji FROM user_offers o2 JOIN skills s ON s.id = o2.skill_id
            WHERE o2.user_id = o.user_id ORDER BY o2.id LIMIT 1) AS emoji
     FROM slot_bookings b
     JOIN user_offers o ON o.id = b.offer_id
     JOIN profiles p ON p.user_id = o.user_id
     LEFT JOIN slot_reviews r ON r.booking_id = b.id
    WHERE b.status = 'DONE'
      ${thisWeek ? `AND COALESCE((SELECT c.created_at FROM credit_ledger c WHERE c.booking_id = b.id AND c.reason = 'taught' LIMIT 1),
                         b.created_at) >= date_trunc('week', now())` : ''}
    GROUP BY o.user_id, p.display_name
    ORDER BY lessons DESC, rating DESC, name
    LIMIT 10`);

// Names and times of one booking, for the live messages.
async function lessonInfo(bookingId) {
  const r = await query(
    `SELECT b.learner_id, o.user_id AS teacher_id, split_part(lp.display_name, ' ', 1) AS learner,
            split_part(tp.display_name, ' ', 1) AS teacher, s.name AS skill, os.weekday, os.hour
       FROM slot_bookings b
       JOIN user_offers o  ON o.id = b.offer_id
       JOIN offer_slots os ON os.id = b.slot_id
       JOIN skills s       ON s.id = o.skill_id
       JOIN profiles lp    ON lp.user_id = b.learner_id
       JOIN profiles tp    ON tp.user_id = o.user_id
      WHERE b.id = $1`, [bookingId]);
  const i = r.rows[0];
  return i && { ...i, when: `${dayName(i.weekday).slice(0, 3)} ${String(i.hour).padStart(2, '0')}:00` };
}

const LEVELS = ['beginner', 'intermediate', 'advanced'];
const toTitle = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function cleanLevel(value) {
  const s = String(value || '').toLowerCase();
  if (!LEVELS.includes(s)) throw new HttpError(400, `level must be one of: ${LEVELS.map(toTitle).join(', ')}`);
  return s;
}

// [{day,hour}, ...] -> a clean, duplicate-free list
function cleanSlots(value) {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, 'Add at least one time slot');
  if (value.length > 20) throw new HttpError(400, 'At most 20 time slots');
  const seen = new Set();
  const out = [];
  for (const s of value) {
    const day = Number(s?.day);
    const hour = Number(s?.hour);
    if (!Number.isInteger(day) || day < 1 || day > 7) throw new HttpError(400, 'day must be 1 (Monday) to 7 (Sunday)');
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'hour must be 0 to 23');
    const key = `${day}:${hour}`;
    if (!seen.has(key)) { seen.add(key); out.push({ day, hour }); }
  }
  return out;
}

const publicUser = (row) => ({ id: row.id, fullName: row.display_name, email: row.email, bio: row.bio || '' });

// Everything the app needs, in one answer. The app writes it into its own SQLite copy.
async function snapshot(userId) {
  await giveWelcome({ query }, userId);
  const [wallet, history, wants, matches, activity] = await Promise.all([
    balanceOf({ query }, userId),
    query(`SELECT c.amount, c.reason, s.name AS "skillName",
                  (EXTRACT(EPOCH FROM c.created_at) * 1000)::double precision AS "createdAt"
             FROM credit_ledger c
             LEFT JOIN slot_bookings b ON b.id = c.booking_id
             LEFT JOIN user_offers o   ON o.id = b.offer_id
             LEFT JOIN skills s        ON s.id = o.skill_id
            WHERE c.user_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 15`, [userId]),
    query('SELECT skill_id AS id FROM user_requests WHERE user_id = $1', [userId]),
    // People who teach what I want. "theyWant" is filled when they ALSO want something I teach:
    // that is a perfect two-way swap, shown first.
    query(`SELECT DISTINCT ON (o.id) o.id AS "offerId", p.display_name AS "teacherName",
                  s.name AS "skillName", s.emoji, tw.name AS "theyWant"
             FROM user_requests w
             JOIN user_offers o ON o.skill_id = w.skill_id AND o.user_id <> $1
             JOIN profiles p    ON p.user_id = o.user_id
             JOIN skills s      ON s.id = o.skill_id
             LEFT JOIN LATERAL (
                  SELECT sk.name FROM user_requests r
                    JOIN user_offers mine ON mine.user_id = $1 AND mine.skill_id = r.skill_id
                    JOIN skills sk ON sk.id = r.skill_id
                   WHERE r.user_id = o.user_id LIMIT 1) tw ON true
            WHERE w.user_id = $1
            ORDER BY o.id`, [userId]),
    // Live community feed. Learners stay anonymous; teachers are named (their lessons are public anyway).
    query(`SELECT text, (EXTRACT(EPOCH FROM at) * 1000)::double precision AS at FROM (
             SELECT 'A student booked ' || s.name || ' with ' || split_part(tp.display_name, ' ', 1) AS text, b.created_at AS at
               FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
               JOIN skills s ON s.id = o.skill_id JOIN profiles tp ON tp.user_id = o.user_id
             UNION ALL
             SELECT split_part(tp.display_name, ' ', 1) || ' taught ' || s.name || ' · +1 🪙', c.created_at
               FROM credit_ledger c JOIN slot_bookings b ON b.id = c.booking_id
               JOIN user_offers o ON o.id = b.offer_id JOIN skills s ON s.id = o.skill_id
               JOIN profiles tp ON tp.user_id = c.user_id
              WHERE c.reason = 'taught'
             UNION ALL
             SELECT repeat('★', r.rating) || ' for ' || split_part(tp.display_name, ' ', 1) || '''s ' || s.name, r.created_at
               FROM slot_reviews r JOIN slot_bookings b ON b.id = r.booking_id
               JOIN user_offers o ON o.id = b.offer_id JOIN skills s ON s.id = o.skill_id
               JOIN profiles tp ON tp.user_id = o.user_id
           ) feed ORDER BY at DESC LIMIT 12`),
  ]);
  const extra = {
    wallet: { balance: wallet, history: history.rows },
    wants: wants.rows.map((r) => r.id),
    activity: activity.rows,
    matches: matches.rows
      .sort((a, b) => (b.theyWant ? 1 : 0) - (a.theyWant ? 1 : 0))
      .slice(0, 10),
  };
  const [users, skills, offers, slots, bookings, reviews] = await Promise.all([
    // Only people the app shows: myself, every teacher, and the learners of MY lessons.
    // E-mail addresses of other people are NOT sent (privacy); the phone only needs names.
    query(`SELECT u.id, CASE WHEN u.id = $1 THEN u.email ELSE 'user' || u.id || '@hidden.skillswap' END AS email,
                  p.display_name, p.bio
             FROM users u JOIN profiles p ON p.user_id = u.id
            WHERE u.id = $1
               OR u.id IN (SELECT user_id FROM user_offers)
               OR u.id IN (SELECT b.learner_id FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
                            WHERE o.user_id = $1)
            ORDER BY u.id`, [userId]),
    query(`SELECT s.id, s.name, c.name AS category, s.emoji
             FROM skills s JOIN categories c ON c.id = s.category_id
            ORDER BY s.name`),
    // "trusted" = the teacher finished at least 2 lessons (across all their offers)
    // with an average rating of 4.5 or more. Earned from real data, it cannot be bought.
    query(`WITH teacher AS (
             SELECT o.user_id,
                    COUNT(b.id) FILTER (WHERE b.status = 'DONE') AS done,
                    AVG(r.rating) AS avg_rating
               FROM user_offers o
               LEFT JOIN slot_bookings b ON b.offer_id = o.id
               LEFT JOIN slot_reviews  r ON r.booking_id = b.id
              GROUP BY o.user_id)
           SELECT o.id, o.user_id AS "teacherId", o.skill_id AS "skillId", o.level, o.description,
                  COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::double precision AS rating,
                  COUNT(r.id)::int AS "reviewCount",
                  BOOL_OR(t.done >= 2 AND COALESCE(t.avg_rating, 0) >= 4.5) AS trusted
             FROM user_offers o
             JOIN teacher t ON t.user_id = o.user_id
             LEFT JOIN slot_bookings b ON b.offer_id = o.id
             LEFT JOIN slot_reviews  r ON r.booking_id = b.id
            GROUP BY o.id
            ORDER BY o.id`),
    query(`SELECT id, offer_id AS "offerId", weekday AS day, hour, is_booked AS "isBooked"
             FROM offer_slots ORDER BY offer_id, weekday, hour`),
    // Only MY bookings (as learner) and bookings of MY lessons (as teacher) - not other people's plans.
    // The check-in code is sent ONLY to the teacher of the lesson; the learner must get it in person.
    query(`SELECT b.id, b.slot_id AS "slotId", b.offer_id AS "offerId", b.learner_id AS "learnerId", b.status,
                  (EXTRACT(EPOCH FROM b.created_at) * 1000)::double precision AS "createdAt",
                  CASE WHEN o.user_id = $1 AND b.status = 'BOOKED' THEN b.checkin_code END AS "checkinCode"
             FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
            WHERE b.learner_id = $1 OR o.user_id = $1
            ORDER BY b.id`, [userId]),
    // Reviews are public, so they come with the offer id and the learner's first name only.
    query(`SELECT r.id, r.booking_id AS "bookingId", b.offer_id AS "offerId",
                  split_part(p.display_name, ' ', 1) AS "learnerName", r.rating, r.comment,
                  (EXTRACT(EPOCH FROM r.created_at) * 1000)::double precision AS "createdAt"
             FROM slot_reviews r
             JOIN slot_bookings b ON b.id = r.booking_id
             JOIN profiles p      ON p.user_id = b.learner_id
            ORDER BY r.id`),
  ]);
  return {
    ...extra,
    users: users.rows.map(publicUser),
    skills: skills.rows,
    offers: offers.rows.map((o) => ({ ...o, level: toTitle(o.level) })),
    slots: slots.rows,
    bookings: bookings.rows,
    reviews: reviews.rows,
  };
}

// Read one booking (locked for this transaction) and check who is asking.
// allowTeacher = the teacher of the lesson may also do this (only used for cancelling).
async function myBooking(db, bookingId, userId, { allowTeacher = false } = {}) {
  const r = await db.query(
    `SELECT b.id, b.slot_id, b.status, b.learner_id, b.checkin_code, o.user_id AS teacher_id
       FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
      WHERE b.id = $1 FOR UPDATE OF b`, [bookingId]);
  const b = r.rows[0];
  const allowed = b && (b.learner_id === userId || (allowTeacher && b.teacher_id === userId));
  if (!allowed) throw new HttpError(404, 'Booking not found');
  return b;
}

export function mobileRoutes(app) {
  // Public "are you awake?" check. Also handy to test the deployment in a browser.
  app.get('/api/mobile/health', async (_req, res) => {
    const database = await mobileSchemaReady();      // also proves the database answers
    res.json({ ok: true, api: 'skillswap-mobile', version: 3, database: database ? 'ready' : 'tables missing' });
  });

  // Community impact, the same numbers for everyone (no login, no personal data).
  // "Saved" money is an ESTIMATE: finished lessons x AVG_TUTOR_PRICE_UZS (default 100,000 UZS per hour).
  app.get('/api/mobile/impact', async (req, res) => {
    const price = Number(process.env.AVG_TUTOR_PRICE_UZS) || 100000;
    const [totals, weekly, top] = await Promise.all([
      query(`SELECT
               (SELECT count(*) FROM users)::int                                      AS members,
               (SELECT count(DISTINCT user_id) FROM user_offers)::int                 AS teachers,
               (SELECT count(DISTINCT skill_id) FROM user_offers)::int                AS skills,
               (SELECT count(*) FROM slot_bookings WHERE status = 'DONE')::int        AS app_lessons,
               (SELECT count(*) FROM exchanges WHERE status = 'completed')::int       AS web_swaps,
               (SELECT count(*) FROM slot_bookings WHERE status = 'BOOKED')::int      AS upcoming,
               (SELECT COALESCE(sum(amount), 0) FROM credit_ledger)::int              AS credits,
               (SELECT round(avg(rating)::numeric, 1) FROM slot_reviews)::float       AS avg_rating,
               (SELECT count(*) FROM slot_reviews)::int                               AS reviews`),
      // finished lessons per week (app lessons + website swaps), last 8 weeks, empty weeks included
      query(`WITH weeks AS (
               SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS wk
             ), done AS (
               SELECT COALESCE(c.created_at, b.created_at) AS at
                 FROM slot_bookings b
                 LEFT JOIN credit_ledger c ON c.booking_id = b.id AND c.reason = 'taught'
                WHERE b.status = 'DONE'
               UNION ALL
               SELECT COALESCE((SELECT max(changed_at) FROM exchange_status_log l
                                 WHERE l.exchange_id = e.id AND l.status = 'completed'), e.created_at)
                 FROM exchanges e WHERE e.status = 'completed'
             )
             SELECT to_char(w.wk, 'YYYY-MM-DD') AS week, count(d.at)::int AS lessons
               FROM weeks w LEFT JOIN done d ON d.at >= w.wk AND d.at < w.wk + interval '1 week'
              GROUP BY w.wk ORDER BY w.wk`),
      query(`SELECT s.name, s.emoji, count(*)::int AS lessons
               FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id JOIN skills s ON s.id = o.skill_id
              WHERE b.status <> 'CANCELLED'
              GROUP BY s.id, s.name, s.emoji ORDER BY lessons DESC, s.name LIMIT 5`),
    ]);
    const t = totals.rows[0];
    const lessons = t.app_lessons + t.web_swaps;
    res.json({
      members: t.members, teachers: t.teachers, skills: t.skills,
      lessonsDone: lessons, hoursShared: lessons, upcoming: t.upcoming,
      creditsInCirculation: t.credits, avgRating: t.avg_rating ?? 0, reviews: t.reviews,
      tutorPriceUzs: price, savedUzs: lessons * price,
      assumption: `Estimate: 1 lesson = 1 hour, and a private tutor costs about ${price.toLocaleString('en-US')} UZS per hour.`,
      weekly: weekly.rows, topSkills: top.rows,
    });
  });

  // Badges and leaderboard. Badge ids are fixed; the app shows their names in the user's language.
  app.get('/api/mobile/achievements', requireAuth, async (req, res) => {
    const me = req.user.id;
    const [stats, week, allTime] = await Promise.all([
      query(
        `SELECT
           (SELECT count(*) FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
             WHERE o.user_id = $1 AND b.status = 'DONE')::int AS taught,
           (SELECT count(*) FROM slot_bookings WHERE learner_id = $1 AND status = 'DONE')::int AS learned,
           (SELECT count(DISTINCT o.skill_id) FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
             WHERE b.learner_id = $1 AND b.status = 'DONE')::int AS skills_learned,
           (SELECT count(*) FROM slot_reviews r JOIN slot_bookings b ON b.id = r.booking_id JOIN user_offers o ON o.id = b.offer_id
             WHERE o.user_id = $1 AND r.rating = 5)::int AS five_stars,
           (SELECT COALESCE(avg(r.rating), 0) FROM slot_reviews r JOIN slot_bookings b ON b.id = r.booking_id
              JOIN user_offers o ON o.id = b.offer_id WHERE o.user_id = $1)::float AS avg_rating,
           (SELECT count(*) FROM slot_reviews r JOIN slot_bookings b ON b.id = r.booking_id
             WHERE b.learner_id = $1)::int AS reviews_written,
           EXISTS (SELECT 1 FROM slot_bookings a JOIN user_offers ao ON ao.id = a.offer_id
                     JOIN slot_bookings b ON b.learner_id = ao.user_id
                     JOIN user_offers bo ON bo.id = b.offer_id AND bo.user_id = a.learner_id
                    WHERE ao.user_id = $1 AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED') AS swapped`, [me]),
      leaderboard(true),
      leaderboard(false),
    ]);
    const s = stats.rows[0];
    const badge = (id, progress, goal) => ({ id, progress: Math.min(progress, goal), goal });
    res.json({
      badges: [
        badge('first_lesson', s.learned, 1),
        badge('first_teach', s.taught, 1),
        badge('mentor', s.taught, 5),
        badge('five_star', s.five_stars, 1),
        badge('trusted', s.taught >= 2 && s.avg_rating >= 4.5 ? 1 : 0, 1),
        badge('explorer', s.skills_learned, 3),
        badge('perfect_swap', s.swapped ? 1 : 0, 1),
        badge('critic', s.reviews_written, 3),
      ],
      week: week.rows,
      allTime: allTime.rows,
      me,
    });
  });

  // Telegram bot: link / unlink / status (the bot itself is in src/telegram.js)
  telegramAppRoutes(app, requireAuth);

  // AI matchmaker: "I want to learn guitar on weekends" (spoken or typed, English / Uzbek / Russian)
  // -> the 3 best lessons with a reason each. Claude when ANTHROPIC_API_KEY is set, keywords otherwise.
  app.post('/api/mobile/match', requireAuth, async (req, res) => {
    const text = cleanText(req.body.text, { max: 300, field: 'text' });
    if (!text) throw new HttpError(400, 'Say or type what you want to learn');
    const lang = ['en', 'uz', 'ru'].includes(req.body.lang) ? req.body.lang : 'en';
    const offers = (await query(
      `SELECT o.id AS "offerId", s.name AS skill, c.name AS category, split_part(p.display_name, ' ', 1) AS teacher,
              o.level, COALESCE(r.avg, 0)::float AS rating, COALESCE(r.cnt, 0)::int AS reviews,
              sl.days, sl.hours, tw.name AS "theyWant"
         FROM user_offers o
         JOIN skills s ON s.id = o.skill_id
         JOIN categories c ON c.id = s.category_id
         JOIN profiles p ON p.user_id = o.user_id
         JOIN LATERAL (SELECT array_agg(weekday::int ORDER BY weekday, hour) AS days,
                              array_agg(hour::int ORDER BY weekday, hour) AS hours
                         FROM offer_slots WHERE offer_id = o.id AND NOT is_booked) sl ON sl.days IS NOT NULL
         LEFT JOIN LATERAL (SELECT round(avg(rv.rating)::numeric, 1) AS avg, count(*) AS cnt
                              FROM slot_reviews rv JOIN slot_bookings b ON b.id = rv.booking_id
                             WHERE b.offer_id = o.id) r ON true
         LEFT JOIN LATERAL (SELECT sk.name FROM user_requests rq
                              JOIN user_offers mine ON mine.user_id = $1 AND mine.skill_id = rq.skill_id
                              JOIN skills sk ON sk.id = rq.skill_id
                             WHERE rq.user_id = o.user_id LIMIT 1) tw ON true
        WHERE o.user_id <> $1`, [req.user.id])).rows;
    const ai = await aiMatch({ text, lang, offers });
    if (ai) return res.json({ source: 'ai', understood: ai.understood, picks: ai.picks });
    const wish = understand(text);
    res.json({
      source: 'smart',
      understood: [...wish.skills, ...wish.categories, wish.time].filter(Boolean).join(', '),
      picks: rankOffers(offers, wish, lang),
    });
  });

  // Skill Galaxy: who taught whom. Nodes = people (first names only), edges = lessons from teacher to learner.
  // App lessons and website swaps both count, because both live in this one database.
  app.get('/api/mobile/galaxy', requireAuth, async (req, res) => {
    const edges = (await query(
      `SELECT teacher_id AS "from", learner_id AS "to", sum(n)::int AS lessons,
              (array_agg(emoji ORDER BY at DESC))[1] AS emoji
         FROM (
           SELECT o.user_id AS teacher_id, b.learner_id, 1 AS n, s.emoji, b.created_at AS at
             FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id JOIN skills s ON s.id = o.skill_id
            WHERE b.status <> 'CANCELLED'
           UNION ALL   -- a website swap teaches both ways
           SELECT e.provider_id, e.requester_id, 1, s.emoji, e.created_at
             FROM exchanges e JOIN skills s ON s.id = e.skill_wanted_id
            WHERE e.status IN ('accepted', 'completed')
           UNION ALL
           SELECT e.requester_id, e.provider_id, 1, s.emoji, e.created_at
             FROM exchanges e JOIN skills s ON s.id = e.skill_offered_id
            WHERE e.status IN ('accepted', 'completed')
         ) lessons
        WHERE teacher_id <> learner_id
        GROUP BY teacher_id, learner_id
        ORDER BY lessons DESC
        LIMIT 240`)).rows;
    // everyone in a lesson, plus teachers who are still waiting for their first learner (most active first, at most 90)
    const active = new Map();
    for (const e of edges) {
      active.set(e.from, (active.get(e.from) || 0) + e.lessons);
      active.set(e.to, (active.get(e.to) || 0) + e.lessons);
    }
    active.set(req.user.id, active.get(req.user.id) || 0);
    const teachers = (await query('SELECT DISTINCT user_id FROM user_offers LIMIT 200')).rows;
    for (const t of teachers) if (!active.has(t.user_id)) active.set(t.user_id, 0);
    // me and the people I learned from or taught always stay in the picture
    const me = req.user.id;
    const mine = edges.filter((e) => e.from === me || e.to === me).flatMap((e) => [e.from, e.to]);
    const byActivity = [...active.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const ids = [...new Set([me, ...mine, ...byActivity])].slice(0, 90);
    const keep = new Set(ids);
    const people = (await query(
      `SELECT u.id, split_part(p.display_name, ' ', 1) AS name,
              (SELECT c.name FROM user_offers o JOIN skills s ON s.id = o.skill_id JOIN categories c ON c.id = s.category_id
                WHERE o.user_id = u.id ORDER BY o.id LIMIT 1) AS category,
              (SELECT s.emoji FROM user_offers o JOIN skills s ON s.id = o.skill_id
                WHERE o.user_id = u.id ORDER BY o.id LIMIT 1) AS emoji
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ANY($1::int[])`, [ids])).rows;
    const shown = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    const sum = (id, side) => shown.filter((e) => e[side] === id).reduce((n, e) => n + e.lessons, 0);
    res.json({
      me: req.user.id,
      nodes: people.map((p) => ({
        id: p.id, name: p.name, category: p.category || '', emoji: p.emoji || '🎓',
        taught: sum(p.id, 'from'), learned: sum(p.id, 'to'),
      })),
      edges: shown,
    });
  });

  // Live updates (Server-Sent Events). The connection stays open; see src/live.js.
  app.get('/api/mobile/events', requireAuth, (req, res) => openStream(req, res));

  // "What I want to learn" (shared with the website's wish list). Replaces the whole list at once.
  app.post('/api/mobile/wants', requireAuth, async (req, res) => {
    const ids = Array.isArray(req.body.skillIds) ? [...new Set(req.body.skillIds.map(Number))] : null;
    if (!ids || ids.length > 10 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new HttpError(400, 'skillIds must be a list of up to 10 skill ids');
    }
    await withTransaction(async (db) => {
      await db.query('DELETE FROM user_requests WHERE user_id = $1', [req.user.id]);
      for (const id of ids) {
        await db.query('INSERT INTO user_requests (user_id, skill_id) SELECT $1, id FROM skills WHERE id = $2', [req.user.id, id]);
      }
    });
    res.json({ ok: true });
  });

  // A 60-minute plan for a booked lesson (learner or teacher). Generated once, then cached.
  app.post('/api/mobile/bookings/:id/plan', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'bookingId');
    const r = await query(
      `SELECT b.learner_id, o.user_id AS teacher_id, o.level, s.name AS skill, c.name AS category
         FROM slot_bookings b JOIN user_offers o ON o.id = b.offer_id
         JOIN skills s ON s.id = o.skill_id JOIN categories c ON c.id = s.category_id
        WHERE b.id = $1`, [id]);
    const info = r.rows[0];
    if (!info || (info.learner_id !== req.user.id && info.teacher_id !== req.user.id)) {
      throw new HttpError(404, 'Booking not found');
    }
    const cached = await query('SELECT plan, source FROM lesson_plans WHERE booking_id = $1', [id]);
    if (cached.rows[0]) return res.json(cached.rows[0]);
    let plan = null;
    let source = 'ai';
    try { plan = await aiPlan(info); } catch { plan = null; }
    if (!plan) { plan = templatePlan(info); source = 'template'; }
    await query('INSERT INTO lesson_plans (booking_id, plan, source) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, plan, source]);
    res.json({ plan, source });
  });

  app.post('/api/mobile/register', async (req, res) => {
    const email = cleanEmail(req.body.email);
    const password = cleanPassword(req.body.password);
    const name = cleanText(req.body.fullName, { min: 2, max: 60, field: 'Name' });
    const hash = await bcrypt.hash(password, 10);
    let id;
    try {
      id = await withTransaction(async (db) => {
        const u = await db.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id', [email, hash]);
        await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1,$2)', [u.rows[0].id, name]);
        await giveWelcome(db, u.rows[0].id);
        return u.rows[0].id;
      });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That email is already registered');
      throw e;
    }
    const { token } = await createSessionToken(id);
    res.status(201).json({ token, user: { id, fullName: name, email, bio: '' } });
  });

  app.post('/api/mobile/login', async (req, res) => {
    const email = cleanEmail(req.body.email);
    const r = await query(
      `SELECT u.id, u.password_hash, u.email, p.display_name, p.bio
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.email = $1`, [email]);
    const row = r.rows[0];
    const ok = row?.password_hash && (await bcrypt.compare(String(req.body.password || ''), row.password_hash));
    if (!ok) throw new HttpError(401, 'Wrong email or password');   // same text for both cases
    const { token } = await createSessionToken(row.id);
    res.json({ token, user: publicUser(row) });
  });

  app.post('/api/mobile/logout', requireAuth, async (req, res) => {
    const token = sessionToken(req);
    if (token) await deleteSession(token);
    res.json({ ok: true });
  });

  app.get('/api/mobile/sync', requireAuth, async (req, res) => {
    const data = await snapshot(req.user.id);
    res.json({ user: publicUser({ ...req.user, id: req.user.id }), ...data });
  });

  // POST and PATCH both work: Android's built-in HttpURLConnection cannot send PATCH.
  const updateMe = async (req, res) => {
    const name = cleanText(req.body.fullName, { min: 2, max: 60, field: 'Name' });
    const bio = cleanText(req.body.bio, { max: 500, field: 'Bio' });
    await query('UPDATE profiles SET display_name = $2, bio = $3 WHERE user_id = $1', [req.user.id, name, bio]);
    res.json({ user: { id: req.user.id, fullName: name, email: req.user.email, bio } });
  };
  app.patch('/api/mobile/me', requireAuth, updateMe);
  app.post('/api/mobile/me', requireAuth, updateMe);

  // Publish a lesson: the offer row AND all its time slots are saved together, or nothing is.
  app.post('/api/mobile/offers', requireAuth, async (req, res) => {
    const skillId = cleanId(req.body.skillId, 'skillId');
    const level = cleanLevel(req.body.level);
    const description = cleanText(req.body.description, { min: 3, max: 300, field: 'Description' });
    const slots = cleanSlots(req.body.slots);
    try {
      const offerId = await withTransaction(async (db) => {
        const skill = await db.query('SELECT id FROM skills WHERE id = $1', [skillId]);
        if (!skill.rows[0]) throw new HttpError(404, 'Unknown skill');
        const o = await db.query(
          'INSERT INTO user_offers (user_id, skill_id, level, description) VALUES ($1,$2,$3,$4) RETURNING id',
          [req.user.id, skillId, level, description]);
        const id = o.rows[0].id;
        for (const s of slots) {
          await db.query('INSERT INTO offer_slots (offer_id, weekday, hour) VALUES ($1,$2,$3)', [id, s.day, s.hour]);
        }
        return id;
      });
      res.status(201).json({ offerId });
      later(async () => {
        const skillName = (await query('SELECT name FROM skills WHERE id = $1', [skillId])).rows[0].name;
        notifyAllExcept(req.user.id, `New lesson: ${skillName} by ${req.user.display_name.split(' ')[0]}`);
        broadcastActivity(`New lesson: ${skillName} by ${req.user.display_name.split(' ')[0]}`);
        broadcastChanged();
      });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'You already teach this skill');
      throw e;
    }
  });

  // Book a time slot. Everything below happens in ONE transaction, so two learners
  // tapping "Book" at the same moment can never take the same slot.
  app.post('/api/mobile/bookings', requireAuth, async (req, res) => {
    const slotId = cleanId(req.body.slotId, 'slotId');
    const bookingId = await withTransaction(async (db) => {
      const s = await db.query(
        `SELECT s.id, s.offer_id, s.weekday, s.hour, o.user_id AS teacher_id
           FROM offer_slots s JOIN user_offers o ON o.id = s.offer_id
          WHERE s.id = $1 FOR UPDATE OF s`, [slotId]);
      const slot = s.rows[0];
      if (!slot) throw new HttpError(404, 'This time does not exist any more');
      if (slot.teacher_id === req.user.id) throw new HttpError(400, 'You cannot book your own lesson');

      // Lock MY row so two bookings of mine at the same moment cannot both spend the last credit.
      await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      await giveWelcome(db, req.user.id);
      if ((await balanceOf(db, req.user.id)) < 1) {
        throw new HttpError(402, 'Not enough credits. Teach a lesson to earn more 🪙');
      }

      const clash = await db.query(
        `SELECT 1 FROM slot_bookings b JOIN offer_slots s2 ON s2.id = b.slot_id
          WHERE b.learner_id = $1 AND b.status = 'BOOKED' AND s2.weekday = $2 AND s2.hour = $3`,
        [req.user.id, slot.weekday, slot.hour]);
      if (clash.rowCount > 0) throw new HttpError(409, 'You already have a lesson at this time');

      // Taking the slot and saving the booking must both succeed.
      const taken = await db.query('UPDATE offer_slots SET is_booked = true WHERE id = $1 AND is_booked = false', [slotId]);
      if (taken.rowCount === 0) throw new HttpError(409, 'Sorry, this time was just booked by someone else');

      const b = await db.query(
        'INSERT INTO slot_bookings (slot_id, offer_id, learner_id, checkin_code) VALUES ($1,$2,$3,$4) RETURNING id',
        [slotId, slot.offer_id, req.user.id, String(crypto.randomInt(0, 10000)).padStart(4, '0')]);
      await db.query("INSERT INTO credit_ledger (user_id, amount, reason, booking_id) VALUES ($1, -1, 'booked', $2)",
        [req.user.id, b.rows[0].id]);                  // 1 hour of learning costs 1 credit
      return b.rows[0].id;
    });
    res.status(201).json({ bookingId });
    later(async () => {
      const i = await lessonInfo(bookingId);
      notify(i.teacher_id, `🎉 ${i.learner} booked your ${i.skill} lesson · ${i.when}`);
      broadcastActivity(`A student booked ${i.skill} with ${i.teacher}`);
      broadcastChanged();
    });
  });

  app.post('/api/mobile/bookings/:id/cancel', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'bookingId');
    await withTransaction(async (db) => {
      const b = await myBooking(db, id, req.user.id, { allowTeacher: true });   // learner or teacher
      if (b.status !== 'BOOKED') throw new HttpError(409, 'Only a planned lesson can be cancelled');
      await db.query("UPDATE slot_bookings SET status = 'CANCELLED' WHERE id = $1", [id]);
      await db.query('UPDATE offer_slots SET is_booked = false WHERE id = $1', [b.slot_id]);  // free the time again
      await db.query("INSERT INTO credit_ledger (user_id, amount, reason, booking_id) VALUES ($1, 1, 'refund', $2)",
        [b.learner_id, id]);                           // the learner gets the credit back
    });
    res.json({ ok: true });
    later(async () => {
      const i = await lessonInfo(id);
      const other = req.user.id === i.learner_id ? i.teacher_id : i.learner_id;
      const who = req.user.id === i.learner_id ? i.learner : i.teacher;
      notify(other, `${who} cancelled the ${i.skill} lesson · ${i.when}`);
      broadcastChanged();
    });
  });

  app.post('/api/mobile/bookings/:id/complete', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'bookingId');
    await withTransaction(async (db) => {
      const b = await myBooking(db, id, req.user.id);
      if (b.status !== 'BOOKED') throw new HttpError(409, 'Only a planned lesson can be marked as done');
      // Check-in: the learner must give the teacher's secret code (scanned from the QR or typed).
      if (String(req.body?.code ?? '').trim() !== b.checkin_code) {
        throw new HttpError(403, 'Wrong check-in code. Ask your teacher to show the QR or the 4-digit code.');
      }
      await db.query("UPDATE slot_bookings SET status = 'DONE' WHERE id = $1", [id]);
      // The slot is a WEEKLY time: after the lesson it is free again for the next learner.
      await db.query('UPDATE offer_slots SET is_booked = false WHERE id = $1', [b.slot_id]);
      await db.query("INSERT INTO credit_ledger (user_id, amount, reason, booking_id) VALUES ($1, 1, 'taught', $2)",
        [b.teacher_id, id]);                           // the teacher earns 1 credit for 1 hour taught
    });
    res.json({ ok: true });
    later(async () => {
      const i = await lessonInfo(id);
      notify(i.teacher_id, `🪙 ${i.learner} checked in to your ${i.skill} lesson. You earned 1 credit!`);
      sendCredit(i.teacher_id, 1);
      broadcastActivity(`${i.teacher} taught ${i.skill} · +1 🪙`);
      broadcastChanged();
    });
  });

  app.post('/api/mobile/bookings/:id/review', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'bookingId');
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be from 1 to 5');
    const comment = cleanText(req.body.comment, { max: 300, field: 'Comment' });
    const reviewId = await withTransaction(async (db) => {
      const b = await myBooking(db, id, req.user.id);
      if (b.status !== 'DONE') throw new HttpError(409, 'You can rate a lesson after it is done');
      const exists = await db.query('SELECT 1 FROM slot_reviews WHERE booking_id = $1', [id]);
      if (exists.rowCount > 0) throw new HttpError(409, 'You already rated this lesson');
      const r = await db.query(
        'INSERT INTO slot_reviews (booking_id, rating, comment) VALUES ($1,$2,$3) RETURNING id', [id, rating, comment]);
      return r.rows[0].id;
    });
    res.status(201).json({ reviewId });
    later(async () => {
      const i = await lessonInfo(id);
      notify(i.teacher_id, `${'★'.repeat(rating)} ${i.learner} rated your ${i.skill} lesson`);
      broadcastActivity(`${'★'.repeat(rating)} for ${i.teacher}'s ${i.skill}`);
      broadcastChanged();
    });
  });
}
