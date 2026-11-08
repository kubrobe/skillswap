// Main API: profile, skills, search, matching, exchanges.
import { query, withTransaction } from './db.js';
import { requireAuth } from './auth.js';
import { HttpError, cleanChoice, cleanId, cleanText } from './validate.js';
import { mongo, mongoEnabled } from './mongo.js';
import { notify } from './notify.js';
import { collabRoutes } from './collab.js';
import * as P from './mongo-pipelines.js';

const LEVELS = ['beginner', 'intermediate', 'advanced'];

// Record an activity event in MongoDB (search, profile_view, swap_request).
// Fire-and-forget: if MongoDB is off or slow, the real request must not fail.
function track(req, type, skill = null) {
  if (!mongoEnabled()) return;
  const ua = req.headers['user-agent'] || '';
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
  mongo().then((db) => db.collection('activity_events').insertOne(
    { user_id: req.user.id, type, skill, city: req.user.city || 'unknown', device, ts: new Date() }))
    .catch((e) => console.error('mongo track failed:', e.message));
}

export function apiRoutes(app) {
  // ---------- Public: skill catalog and popularity ----------
  app.get('/api/skills', async (_req, res) => {
    const r = await query(
      `SELECT s.id, s.name, c.id AS category_id, c.name AS category
         FROM skills s JOIN categories c ON c.id = s.category_id
        ORDER BY c.name, s.name`);
    res.json(r.rows);
  });

  // Statistics (GROUP BY + HAVING): skills that at least one member offers, most offered first
  app.get('/api/stats/popular-skills', async (_req, res) => {
    const r = await query(
      `SELECT s.id, s.name, count(o.id)::int AS teachers
         FROM skills s JOIN user_offers o ON o.skill_id = s.id
        GROUP BY s.id, s.name
       HAVING count(o.id) >= 1
        ORDER BY teachers DESC, s.name LIMIT 8`);
    res.json(r.rows);
  });

  // Everything below needs a logged-in user
  app.use('/api', requireAuth);

  // Which optional features are switched on (lets the pages hide buttons that cannot work)
  app.get('/api/features', (_req, res) => res.json({ mongo: mongoEnabled() }));

  // ---------- My profile ----------
  app.get('/api/me/profile', async (req, res) => {
    const r = await query('SELECT display_name, city, bio FROM profiles WHERE user_id = $1', [req.user.id]);
    res.json({ email: req.user.email, ...r.rows[0] });
  });

  app.put('/api/me/profile', async (req, res) => {
    const name = cleanText(req.body.display_name, { min: 2, max: 60, field: 'Name' });
    const city = cleanText(req.body.city, { max: 80, field: 'City' });
    const bio = cleanText(req.body.bio, { max: 500, field: 'Bio' });
    await query('UPDATE profiles SET display_name=$1, city=$2, bio=$3 WHERE user_id=$4', [name, city || null, bio, req.user.id]);
    res.json({ ok: true });
  });

  // ---------- My offers / requests (same logic, two tables) ----------
  for (const [path, table] of [['offers', 'user_offers'], ['requests', 'user_requests']]) {
    app.get(`/api/me/${path}`, async (req, res) => {
      const extra = table === 'user_offers' ? ', t.level' : '';
      const r = await query(
        `SELECT t.id, t.skill_id, s.name AS skill, t.description${extra}
           FROM ${table} t JOIN skills s ON s.id = t.skill_id
          WHERE t.user_id = $1 ORDER BY s.name`, [req.user.id]);
      res.json(r.rows);
    });

    app.post(`/api/me/${path}`, async (req, res) => {
      const skillId = cleanId(req.body.skill_id, 'skill_id');
      const description = cleanText(req.body.description, { max: 300, field: 'Description' });
      try {
        if (table === 'user_offers') {
          const level = cleanChoice(req.body.level || 'intermediate', LEVELS, 'level');
          await query('INSERT INTO user_offers (user_id, skill_id, level, description) VALUES ($1,$2,$3,$4)', [req.user.id, skillId, level, description]);
        } else {
          await query('INSERT INTO user_requests (user_id, skill_id, description) VALUES ($1,$2,$3)', [req.user.id, skillId, description]);
        }
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'You already added that skill');
        if (e.code === '23503') throw new HttpError(400, 'That skill does not exist');
        throw e;
      }
      res.status(201).json({ ok: true });
    });

    app.delete(`/api/me/${path}/:id`, async (req, res) => {
      const r = await query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2`, [cleanId(req.params.id, 'id'), req.user.id]);
      if (!r.rowCount) throw new HttpError(404, 'Not found');
      res.json({ ok: true });
    });
  }

  // ---------- Search members ----------
  // ?q=text (name or skill)  &category=id
  app.get('/api/members', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60).replace(/[\\%_]/g, '\\$&');
    const category = req.query.category ? cleanId(req.query.category, 'category') : null;
    const r = await query(
      `SELECT p.user_id AS id, p.display_name, p.city, p.bio,
              (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'level', o.level) ORDER BY s.name), '[]')
                 FROM user_offers o JOIN skills s ON s.id = o.skill_id WHERE o.user_id = p.user_id) AS offers
         FROM profiles p
        WHERE p.user_id <> $1
          AND ($2 = '' OR p.display_name ILIKE '%' || $2 || '%' OR p.city ILIKE '%' || $2 || '%'
               OR EXISTS (SELECT 1 FROM user_offers o JOIN skills s ON s.id = o.skill_id
                           WHERE o.user_id = p.user_id AND s.name ILIKE '%' || $2 || '%'))
          AND ($3::int IS NULL
               OR EXISTS (SELECT 1 FROM user_offers o JOIN skills s ON s.id = o.skill_id
                           WHERE o.user_id = p.user_id AND s.category_id = $3))
        ORDER BY p.display_name LIMIT 50`,
      [req.user.id, q, category]);

    // Remember what people search for (feeds the "in demand" statistics). If the text is exactly a
    // skill name we also store its id. A failure here must never break the search itself.
    const term = String(req.query.q || '').trim().slice(0, 60);
    if (term) {
      track(req, 'search', term);
      const device = /iPad|Tablet/i.test(req.headers['user-agent'] || '') ? 'tablet'
                   : /Mobi|Android|iPhone/i.test(req.headers['user-agent'] || '') ? 'mobile' : 'desktop';
      query(
        `INSERT INTO search_log (user_id, skill_id, term, device)
         VALUES ($1, (SELECT id FROM skills WHERE lower(name) = lower($2)), $2, $3)`,
        [req.user.id, term, device]).catch((e) => console.error('search_log insert failed:', e.message));
    }
    res.json(r.rows);
  });

  // Statistics (SQL): what was searched most in the last 7 days, and how many members teach it?
  // Demand vs supply: a skill with many searches and few teachers is a gap we should fill.
  app.get('/api/stats/demand', async (_req, res) => {
    const r = await query(
      `SELECT s.id, s.name, count(*)::int AS searches,
              (SELECT count(*)::int FROM user_offers o WHERE o.skill_id = s.id) AS teachers
         FROM search_log l JOIN skills s ON s.id = l.skill_id
        WHERE l.searched_at >= now() - interval '7 days'
        GROUP BY s.id, s.name
       HAVING count(*) >= 1
        ORDER BY searches DESC LIMIT 8`);
    const total = await query(`SELECT count(*)::int AS n FROM search_log WHERE searched_at >= now() - interval '7 days'`);
    res.json({ searches_last_7_days: total.rows[0].n, top: r.rows });
  });

  app.get('/api/members/:id', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const p = await query('SELECT user_id AS id, display_name, city, bio FROM profiles WHERE user_id = $1', [id]);
    if (!p.rows[0]) throw new HttpError(404, 'Member not found');
    const offers = await query(
      `SELECT s.id AS skill_id, s.name AS skill, o.level, o.description
         FROM user_offers o JOIN skills s ON s.id = o.skill_id WHERE o.user_id = $1 ORDER BY s.name`, [id]);
    const wants = await query(
      `SELECT s.id AS skill_id, s.name AS skill, r.description
         FROM user_requests r JOIN skills s ON s.id = r.skill_id WHERE r.user_id = $1 ORDER BY s.name`, [id]);
    if (id !== req.user.id) track(req, 'profile_view');
    res.json({ ...p.rows[0], offers: offers.rows, wants: wants.rows });
  });

  // ---------- Matching ----------
  // "They teach me":  they OFFER a skill I REQUEST.
  // "I teach them":   they REQUEST a skill I OFFER.
  // A member with both is a MUTUAL match (a fair swap) and is listed first.
  app.get('/api/matches', async (req, res) => {
    const r = await query(
      `WITH they_teach_me AS (
         SELECT o.user_id, o.skill_id
           FROM user_offers o JOIN user_requests r ON r.skill_id = o.skill_id
          WHERE r.user_id = $1 AND o.user_id <> $1),
       i_teach_them AS (
         SELECT r.user_id, r.skill_id
           FROM user_requests r JOIN user_offers o ON o.skill_id = r.skill_id
          WHERE o.user_id = $1 AND r.user_id <> $1)
       SELECT p.user_id AS id, p.display_name, p.city,
              (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name), '[]')
                 FROM they_teach_me t JOIN skills s ON s.id = t.skill_id WHERE t.user_id = p.user_id) AS they_teach_me,
              (SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name), '[]')
                 FROM i_teach_them t JOIN skills s ON s.id = t.skill_id WHERE t.user_id = p.user_id) AS i_teach_them
         FROM profiles p
        WHERE p.user_id IN (SELECT user_id FROM they_teach_me UNION SELECT user_id FROM i_teach_them)`,
      [req.user.id]);
    const rows = r.rows.map((m) => ({ ...m, mutual: m.they_teach_me.length > 0 && m.i_teach_them.length > 0 }));
    rows.sort((a, b) => b.mutual - a.mutual || (b.they_teach_me.length + b.i_teach_them.length) - (a.they_teach_me.length + a.i_teach_them.length));
    res.json(rows);
  });

  // ---------- Exchanges ----------
  // Create: "I want to learn <skill_wanted> from you and I will teach <skill_offered>"
  app.post('/api/exchanges', async (req, res) => {
    const providerId = cleanId(req.body.provider_id, 'provider_id');
    const wanted = cleanId(req.body.skill_wanted_id, 'skill_wanted_id');
    const offered = cleanId(req.body.skill_offered_id, 'skill_offered_id');
    const message = cleanText(req.body.message, { max: 300, field: 'Message' });
    if (providerId === req.user.id) throw new HttpError(400, 'You cannot send a request to yourself');

    const id = await withTransaction(async (db) => {
      // Business rules, checked inside the transaction so nothing changes in between
      const theyTeach = await db.query('SELECT 1 FROM user_offers WHERE user_id=$1 AND skill_id=$2', [providerId, wanted]);
      if (!theyTeach.rowCount) throw new HttpError(400, 'That member does not offer this skill');
      const iTeach = await db.query('SELECT 1 FROM user_offers WHERE user_id=$1 AND skill_id=$2', [req.user.id, offered]);
      if (!iTeach.rowCount) throw new HttpError(400, 'Add the skill you will teach to your offers first');
      try {
        const ex = await db.query(
          `INSERT INTO exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id, message)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`, [req.user.id, providerId, wanted, offered, message]);
        await db.query('INSERT INTO exchange_status_log (exchange_id, status, changed_by) VALUES ($1,$2,$3)', [ex.rows[0].id, 'pending', req.user.id]);
        await notify(db, providerId, 'request', `${req.user.display_name} wants to swap skills with you`, '/exchanges');
        return ex.rows[0].id;
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'You already sent this exact request and it is still pending');
        throw e;
      }
    });
    track(req, 'swap_request');
    res.status(201).json({ id });
  });

  // List my exchanges (both directions)
  app.get('/api/exchanges', async (req, res) => {
    const r = await query(
      `SELECT e.id, e.status, e.message, e.created_at,
              e.requester_id, rp.display_name AS requester_name,
              e.provider_id,  pp.display_name AS provider_name,
              sw.name AS skill_wanted, so.name AS skill_offered,
              CASE WHEN e.provider_id = $1 THEN 'incoming' ELSE 'outgoing' END AS direction,
              EXISTS (SELECT 1 FROM reviews rv WHERE rv.exchange_id = e.id AND rv.reviewer_id = $1) AS reviewed,
              (SELECT json_agg(json_build_object('status', l.status, 'by', lp.display_name, 'at', l.changed_at) ORDER BY l.changed_at, l.id)
                 FROM exchange_status_log l JOIN profiles lp ON lp.user_id = l.changed_by
                WHERE l.exchange_id = e.id) AS timeline
         FROM exchanges e
         JOIN profiles rp ON rp.user_id = e.requester_id
         JOIN profiles pp ON pp.user_id = e.provider_id
         JOIN skills sw ON sw.id = e.skill_wanted_id
         JOIN skills so ON so.id = e.skill_offered_id
        WHERE e.requester_id = $1 OR e.provider_id = $1
        ORDER BY e.created_at DESC`, [req.user.id]);
    res.json(r.rows);
  });


  // ---------- Reviews (PostgreSQL) ----------
  // Average rating + latest reviews of a member (aggregate over the reviews table).
  app.get('/api/members/:id/reviews', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const s = await query('SELECT count(*)::int AS count, round(avg(rating), 1)::float AS average FROM reviews WHERE reviewee_id = $1', [id]);
    const latest = await query(
      `SELECT r.rating, r.comment, r.created_at, p.display_name AS reviewer,
              CASE WHEN e.requester_id = r.reviewee_id THEN so.name ELSE sw.name END AS skill
         FROM reviews r
         JOIN profiles p ON p.user_id = r.reviewer_id
         JOIN exchanges e ON e.id = r.exchange_id
         JOIN skills sw ON sw.id = e.skill_wanted_id JOIN skills so ON so.id = e.skill_offered_id
        WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC LIMIT 5`, [id]);
    res.json({ enabled: true, average: s.rows[0].average, count: s.rows[0].count, latest: latest.rows });
  });

  // Leave a review for a COMPLETED exchange you took part in (one review per person per exchange).
  app.post('/api/exchanges/:id/review', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const rating = cleanId(req.body.rating, 'rating');
    if (rating > 5) throw new HttpError(400, 'rating must be between 1 and 5');
    const comment = cleanText(req.body.comment, { max: 300, field: 'Comment' });

    const r = await query('SELECT requester_id, provider_id, status FROM exchanges WHERE id = $1', [id]);
    const ex = r.rows[0];
    if (!ex || (ex.requester_id !== req.user.id && ex.provider_id !== req.user.id)) throw new HttpError(404, 'Exchange not found');
    if (ex.status !== 'completed') throw new HttpError(409, 'You can review an exchange after it is marked as done');
    const reviewee = ex.requester_id === req.user.id ? ex.provider_id : ex.requester_id;
    try {
      await query('INSERT INTO reviews (exchange_id, reviewer_id, reviewee_id, rating, comment) VALUES ($1,$2,$3,$4,$5)',
        [id, req.user.id, reviewee, rating, comment]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'You already reviewed this exchange');   // UNIQUE (exchange_id, reviewer_id)
      throw e;
    }
    await notify({ query }, reviewee, 'review', `${req.user.display_name} left you a ${rating}-star review`, `/member?id=${reviewee}`);
    res.status(201).json({ ok: true });
  });

  // ---------- MongoDB features (optional) ----------
  // Statistics (MongoDB aggregations): activity of the last 30 days
  app.get('/api/stats/activity', async (_req, res) => {
    if (!mongoEnabled()) return res.json({ enabled: false });
    const ev = (await mongo()).collection('activity_events');
    const [byType, byDevice, cities, daily] = await Promise.all([
      ev.aggregate(P.eventsByType(30)).toArray(), ev.aggregate(P.eventsByDevice(30)).toArray(),
      ev.aggregate(P.topSearchCities(30, 5)).toArray(), ev.aggregate(P.dailyEvents(14)).toArray()]);
    res.json({ enabled: true, byType, byDevice, cities, daily });
  });

  // Change status. Who may do what:
  //   provider:  pending -> accepted | declined
  //   requester: pending -> cancelled
  //   either:    accepted -> completed
  const RULES = {
    accept:   { from: 'pending',  to: 'accepted',  who: 'provider' },
    decline:  { from: 'pending',  to: 'declined',  who: 'provider' },
    cancel:   { from: 'pending',  to: 'cancelled', who: 'requester' },
    complete: { from: 'accepted', to: 'completed', who: 'either' },
  };

  app.patch('/api/exchanges/:id', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const action = cleanChoice(req.body.action, Object.keys(RULES), 'action');
    const rule = RULES[action];

    const status = await withTransaction(async (db) => {
      // FOR UPDATE locks the row so two clicks at the same time cannot both succeed
      const r = await db.query('SELECT requester_id, provider_id, status FROM exchanges WHERE id = $1 FOR UPDATE', [id]);
      const ex = r.rows[0];
      if (!ex || (ex.requester_id !== req.user.id && ex.provider_id !== req.user.id)) throw new HttpError(404, 'Exchange not found');
      const isProvider = ex.provider_id === req.user.id;
      if (rule.who === 'provider' && !isProvider) throw new HttpError(403, 'Only the member who teaches can do that');
      if (rule.who === 'requester' && isProvider) throw new HttpError(403, 'Only the member who asked can do that');
      if (ex.status !== rule.from) throw new HttpError(409, `This exchange is ${ex.status}, so it cannot be ${rule.to}`);
      await db.query('UPDATE exchanges SET status = $1 WHERE id = $2', [rule.to, id]);
      await db.query('INSERT INTO exchange_status_log (exchange_id, status, changed_by) VALUES ($1,$2,$3)', [id, rule.to, req.user.id]);
      // tell the other person (same transaction: no status change without its notification)
      const other = isProvider ? ex.requester_id : ex.provider_id;
      const text = { accepted: 'accepted your swap request', declined: 'declined your swap request', cancelled: 'cancelled their swap request', completed: 'marked your swap as done' }[rule.to];
      await notify(db, other, rule.to, `${req.user.display_name} ${text}`, rule.to === 'accepted' ? `/workspace?id=${id}` : '/exchanges');
      return rule.to;
    });
    res.json({ id, status });
  });

  collabRoutes(app);
}
