// @username, the richer profile (faculty, year, languages, phone, Telegram) and the contact-privacy rule.
//
// PRIVACY RULE (enforced here, on the server; the pages and the app only draw what they receive):
// a person's Telegram username and phone are sent to a viewer only if
//   - the viewer is that person, or
//   - contact_visibility = 'everyone', or
//   - contact_visibility = 'matches' AND (the two share a lesson that is not cancelled OR they are a two-way "perfect match").
// Otherwise both fields are null and contactsHidden is true ("Book a lesson to see contacts").
import { query } from './db.js';
import {
  HttpError, cleanText, cleanChoice, cleanUsername, cleanPhone, cleanTelegramUsername, normalizeUsername, usernameProblem,
} from './validate.js';

export const VISIBILITY = ['everyone', 'matches', 'nobody'];

/** The whole rule in one small function, so it can be unit-tested without a database. */
export function canSeeContacts({ visibility, isOwner = false, sharesBooking = false, mutualMatch = false }) {
  if (isOwner) return true;
  if (visibility === 'everyone') return true;
  if (visibility === 'matches') return Boolean(sharesBooking || mutualMatch);
  return false;                                   // 'nobody', and anything unexpected, hides the contacts
}

/**
 * Two SQL columns (shares_booking, mutual_match) for a viewer and a profile owner.
 * `viewer` and `owner` are SQL expressions written by us (a $1 placeholder, a column name), never user input.
 *  - shares_booking: a booking between the two in any status except CANCELLED (either one is the teacher),
 *                    or a website swap that was accepted or completed.
 *  - mutual_match:   the owner teaches something the viewer wants AND wants something the viewer teaches.
 */
export const contactFlagsSql = (viewer, owner) => `
  (EXISTS (SELECT 1 FROM slot_bookings cb JOIN user_offers co ON co.id = cb.offer_id
            WHERE cb.status <> 'CANCELLED'
              AND ((cb.learner_id = ${viewer} AND co.user_id = ${owner}) OR (cb.learner_id = ${owner} AND co.user_id = ${viewer})))
   OR EXISTS (SELECT 1 FROM exchanges ce
               WHERE ce.status IN ('accepted', 'completed')
                 AND ((ce.requester_id = ${viewer} AND ce.provider_id = ${owner}) OR (ce.requester_id = ${owner} AND ce.provider_id = ${viewer})))
  ) AS shares_booking,
  (EXISTS (SELECT 1 FROM user_requests cw JOIN user_offers cto ON cto.skill_id = cw.skill_id
            WHERE cw.user_id = ${viewer} AND cto.user_id = ${owner})
   AND EXISTS (SELECT 1 FROM user_requests cr JOIN user_offers cmo ON cmo.skill_id = cr.skill_id
                WHERE cr.user_id = ${owner} AND cmo.user_id = ${viewer})) AS mutual_match`;

/** The profile columns added by db/15_telegram_profiles.sql, for a users table called `u`. */
export const EXTRA_COLUMNS = 'u.username, u.telegram_username, u.phone, u.faculty, u.study_year, u.languages, u.contact_visibility';

/** Applies the privacy rule to one database row. Returns the two contact fields and whether they were hidden. */
export function contactsFor(row, viewerId) {
  const isOwner = Number(row.id) === Number(viewerId);
  const allowed = canSeeContacts({
    visibility: row.contact_visibility, isOwner, sharesBooking: row.shares_booking, mutualMatch: row.mutual_match,
  });
  return {
    telegramUsername: allowed ? row.telegram_username || null : null,
    phone: allowed ? row.phone || null : null,
    contactsHidden: !allowed,
  };
}

/** One person as the Android app receives them. `email` is hidden by the caller for other people. */
export function mobileUser(row, viewerId) {
  const mine = Number(row.id) === Number(viewerId);
  return {
    id: row.id, fullName: row.display_name, email: row.email, bio: row.bio || '',
    username: row.username || '',
    faculty: row.faculty || '', studyYear: row.study_year || 0, languages: row.languages || [],
    ...contactsFor(row, viewerId),
    contactVisibility: mine ? row.contact_visibility || 'matches' : null,      // my own setting is nobody else's business
  };
}

/** My own row, complete (for login answers and after saving the profile). */
export async function mobileMe(userId) {
  const r = await query(
    `SELECT u.id, u.email, p.display_name, p.bio, ${EXTRA_COLUMNS}
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]);
  return r.rows[0] ? mobileUser(r.rows[0], userId) : null;
}

/** The same fields in the website's naming (snake_case). */
export function webExtras(row, viewerId) {
  const c = contactsFor(row, viewerId);
  return {
    username: row.username || null, faculty: row.faculty || null, study_year: row.study_year || null,
    languages: row.languages || [], telegram_username: c.telegramUsername, phone: c.phone, contacts_hidden: c.contactsHidden,
  };
}

// ---------- reading the new fields from a request ----------
function cleanLanguages(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const s = String(item ?? '').trim().replace(/\s+/g, ' ');
    if (!s) continue;
    if (s.length > 30) throw new HttpError(400, 'A language name must be at most 30 characters');
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  if (out.length > 8) throw new HttpError(400, 'At most 8 languages');
  return out;
}

function cleanStudyYear(value) {
  if (value === null || value === '' || value === 0 || value === '0') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new HttpError(400, 'Year of study must be 1, 2, 3 or 4');
  return n;
}

/**
 * Picks and validates the new profile fields that are PRESENT in the body (the app sends camelCase, the website
 * snake_case). A field that is not sent is not changed, so an older app that only sends name + bio keeps working.
 * An empty username is ignored: once chosen, a username can be changed but not removed.
 */
export function cleanProfileExtras(body = {}) {
  const get = (camel, snake) => (body[camel] !== undefined ? body[camel] : body[snake]);
  const out = {};
  const username = body.username;
  if (username !== undefined && username !== null && String(username).trim() !== '') out.username = cleanUsername(username);
  const tg = get('telegramUsername', 'telegram_username');
  if (tg !== undefined) out.telegram_username = cleanTelegramUsername(tg ?? '');
  if (body.phone !== undefined) out.phone = cleanPhone(body.phone ?? '');
  if (body.faculty !== undefined) out.faculty = cleanText(body.faculty ?? '', { max: 80, field: 'Faculty' }) || null;
  const year = get('studyYear', 'study_year');
  if (year !== undefined) out.study_year = cleanStudyYear(year);
  if (body.languages !== undefined) out.languages = cleanLanguages(body.languages);
  const vis = get('contactVisibility', 'contact_visibility');
  if (vis !== undefined && vis !== null) out.contact_visibility = cleanChoice(vis, VISIBILITY, 'Contact visibility');
  return out;
}

/** Writes the cleaned fields. `db` is the pool or a transaction client. */
export async function saveProfileExtras(db, userId, changes) {
  const keys = Object.keys(changes);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'contact_visibility' ? '::contact_visibility' : ''}`);
  try {
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, [userId, ...keys.map((k) => changes[k])]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That username is already taken');
    throw e;
  }
}

// ---------- routes (website: /api/users/..., Android app: /api/mobile/users/...) ----------
export function profileRoutes(app, requireAuth) {
  for (const prefix of ['/api', '/api/mobile']) {
    // Live check while typing: { username, available, reason }
    app.get(`${prefix}/users/username-available`, requireAuth, async (req, res) => {
      const username = normalizeUsername(req.query.u);
      const problem = usernameProblem(username);
      if (problem) return res.json({ username, available: false, reason: problem });
      const taken = (await query('SELECT 1 FROM users WHERE username = $1 AND id <> $2', [username, req.user.id])).rowCount > 0;
      res.json({ username, available: !taken, reason: taken ? 'That username is already taken' : null });
    });

    // Public profile by @username. Contacts follow the privacy rule above.
    app.get(`${prefix}/users/by-username/:username`, requireAuth, async (req, res) => {
      const username = normalizeUsername(req.params.username);
      const r = await query(
        `SELECT u.id, p.display_name, p.city, p.bio, ${EXTRA_COLUMNS}, ${contactFlagsSql('$1', 'u.id')}
           FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.username = $2`, [req.user.id, username]);
      const row = r.rows[0];
      if (!row) throw new HttpError(404, 'No member with that username');
      const offers = await query(
        `SELECT o.id AS "offerId", s.name AS skill, s.emoji, o.level
           FROM user_offers o JOIN skills s ON s.id = o.skill_id WHERE o.user_id = $1 ORDER BY s.name`, [row.id]);
      res.json({
        id: row.id, username: row.username, fullName: row.display_name, city: row.city || '', bio: row.bio || '',
        faculty: row.faculty || '', studyYear: row.study_year || 0, languages: row.languages || [],
        ...contactsFor(row, req.user.id),
        offers: offers.rows,
      });
    });
  }
}
