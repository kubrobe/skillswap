// Registration, login, logout and the "who is logged in?" middleware.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from './db.js';
import { HttpError, cleanEmail, cleanPassword, cleanText } from './validate.js';

const COOKIE = 'skillswap_session';
const SESSION_DAYS = 7;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Create a random token and store only its HASH in the DB. The raw token is given out once:
// the website keeps it in a cookie, the Android app keeps it and sends "Authorization: Bearer <token>".
export async function createSessionToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires]);
  return { token, expires };
}

export const deleteSession = (token) => query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);

async function startSession(res, userId) {
  const { token, expires } = await createSessionToken(userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,            // JavaScript in the page cannot read it (protects against XSS theft)
    sameSite: 'lax',           // not sent on cross-site POSTs (protects against CSRF)
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

// Middleware: attaches req.user when the request carries a valid session token.
// Browsers send it in the cookie; the Android app sends it in the Authorization header.
export function sessionToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return req.cookies?.[COOKIE] || null;
}

export async function loadUser(req, _res, next) {
  try {
    const token = sessionToken(req);
    if (token) {
      const r = await query(
        `SELECT u.id, u.email, p.display_name, p.city, p.bio
           FROM sessions s JOIN users u ON u.id = s.user_id JOIN profiles p ON p.user_id = u.id
          WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
      req.user = r.rows[0] || null;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  next();
}

export function authRoutes(app) {
  app.post('/api/register', async (req, res) => {
    const email = cleanEmail(req.body.email);
    const password = cleanPassword(req.body.password);
    const name = cleanText(req.body.display_name, { min: 2, max: 60, field: 'Name' });
    const hash = await bcrypt.hash(password, 10);
    try {
      // users row + profiles row must both exist or neither -> transaction
      const id = await withTransaction(async (db) => {
        const u = await db.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id', [email, hash]);
        await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1,$2)', [u.rows[0].id, name]);
        return u.rows[0].id;
      });
      await startSession(res, id);
      res.status(201).json({ id, email, display_name: name });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That email is already registered');
      throw e;
    }
  });

  app.post('/api/login', async (req, res) => {
    const email = cleanEmail(req.body.email);
    const r = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    const ok = r.rows[0] && (await bcrypt.compare(String(req.body.password || ''), r.rows[0].password_hash));
    // Same message for "no such email" and "wrong password" so attackers learn nothing.
    if (!ok) throw new HttpError(401, 'Wrong email or password');
    await startSession(res, r.rows[0].id);
    res.json({ ok: true });
  });

  app.post('/api/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await deleteSession(token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user });
  });
}
