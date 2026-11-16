// "Continue with Telegram" for the website AND the Android app (bot deep-link flow).
// Telegram's own Login Widget only works on websites, so both use the bot instead:
//
// 1. The login screen asks  POST .../auth/telegram/start . The server makes a one-time token
//    (32 random bytes, valid 5 minutes, only its hash is stored) and answers t.me/<bot>?start=login_<token>.
// 2. The screen opens that link. In Telegram the person taps Start.
// 3. The bot (src/telegram.js) receives "/start login_<token>" and marks the token as confirmed with the
//    person's Telegram id, username and first name. Only Telegram can tell us those, so they can be trusted.
// 4. Meanwhile the screen asks  GET .../auth/telegram/status?token=...  every 2 seconds. Once confirmed, the
//    server finds or creates the SkillSwap account and starts the normal session (cookie for the website,
//    bearer token for the app). The token is deleted in the same step: it works exactly once.
import crypto from 'node:crypto';
import { query, withTransaction } from './db.js';
import { HttpError } from './validate.js';
import { startSession, createSessionToken } from './auth.js';
import { giveWelcome } from './mobile.js';
import { mobileMe } from './profiles.js';
import { telegramConfigured, botUsername, LOGIN_PREFIX, LOGIN_MINUTES, loginTokenHash } from './telegram.js';

const MAX_OPEN_TOKENS = 2000;      // nobody needs more unfinished logins within 5 minutes; stops a flood

export async function startTelegramLogin() {
  if (!telegramConfigured()) throw new HttpError(503, 'Telegram login is not set up on this server');
  const bot = await botUsername();
  if (!bot) throw new HttpError(503, 'The Telegram bot is not reachable right now');
  await query(`DELETE FROM telegram_login_tokens WHERE created_at < now() - interval '${LOGIN_MINUTES} minutes'`);
  const open = (await query('SELECT count(*)::int AS n FROM telegram_login_tokens')).rows[0].n;
  if (open >= MAX_OPEN_TOKENS) throw new HttpError(429, 'Too many logins right now. Please try again in a minute.');
  const token = crypto.randomBytes(32).toString('base64url');          // 43 characters; Telegram allows 64 after "start="
  await query('INSERT INTO telegram_login_tokens (token_hash) VALUES ($1)', [loginTokenHash(token)]);
  return { token, url: `https://t.me/${bot}?start=${LOGIN_PREFIX}${token}`, expiresIn: LOGIN_MINUTES * 60 };
}

/**
 * Find or create the SkillSwap account of a Telegram person, in ONE transaction:
 *  - known Telegram id                      -> that account
 *  - a chat linked with "Connect Telegram"  -> that account (the person proved both sides when linking)
 *  - otherwise                              -> a new account: name = first name, welcome credits, bot alerts on
 * A Telegram account has no email, so a placeholder that cannot receive mail is stored (the column is required).
 */
export async function findOrCreateTelegramUser({ telegramId, username, firstName }) {
  return withTransaction(async (db) => {
    const known = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    let id = known.rows[0]?.id;
    if (!id) {
      const linked = await db.query('SELECT user_id FROM telegram_links WHERE chat_id = $1', [telegramId]);
      id = linked.rows[0]?.user_id;
      if (id) await db.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegramId, id]);
    }
    if (id) {
      // keep the Telegram username on the profile fresh (people change it)
      if (username) await db.query('UPDATE users SET telegram_username = $1 WHERE id = $2', [username, id]);
      return { id, isNew: false };
    }
    const name = String(firstName || '').trim().slice(0, 60);
    const u = await db.query(
      'INSERT INTO users (email, password_hash, telegram_id, telegram_username) VALUES ($1, NULL, $2, $3) RETURNING id',
      [`tg${telegramId}@telegram.skillswap`, telegramId, username || null]);
    id = u.rows[0].id;
    await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [id, name.length >= 2 ? name : 'SkillSwap member']);
    await giveWelcome(db, id);
    // In a private chat the chat id is the person's id: booking alerts and reminders work from the first minute.
    await db.query('INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, telegramId]);
    return { id, isNew: true };
  });
}

/** { status: 'pending' | 'expired' } or { status: 'confirmed', userId, isNew } (and the token is gone). */
export async function telegramLoginStatus(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, 'Missing login token');
  const hash = loginTokenHash(token);
  // DELETE ... RETURNING: of two requests at the same moment only one gets the row, so a token logs in once.
  const done = await query(
    `DELETE FROM telegram_login_tokens
      WHERE token_hash = $1 AND confirmed_at IS NOT NULL AND created_at > now() - interval '${LOGIN_MINUTES} minutes'
      RETURNING telegram_id, tg_username, tg_first_name`, [hash]);
  if (done.rows[0]) {
    const t = done.rows[0];
    const { id, isNew } = await findOrCreateTelegramUser({ telegramId: t.telegram_id, username: t.tg_username, firstName: t.tg_first_name });
    return { status: 'confirmed', userId: id, isNew };
  }
  const waiting = await query(
    `SELECT 1 FROM telegram_login_tokens WHERE token_hash = $1 AND created_at > now() - interval '${LOGIN_MINUTES} minutes'`, [hash]);
  if (waiting.rowCount > 0) return { status: 'pending' };
  await query('DELETE FROM telegram_login_tokens WHERE token_hash = $1', [hash]);     // too old: remove it
  return { status: 'expired' };
}

export function telegramLoginRoutes(app) {
  // Website: the session arrives as the usual cookie.
  app.post('/api/auth/telegram/start', async (_req, res) => res.json(await startTelegramLogin()));
  app.get('/api/auth/telegram/status', async (req, res) => {
    const r = await telegramLoginStatus(req.query.token);
    res.set('Cache-Control', 'no-store');
    if (r.status !== 'confirmed') return res.json({ status: r.status });
    await startSession(res, r.userId);
    res.json({ status: 'confirmed', isNew: r.isNew });
  });

  // Android app: the same two steps; the session arrives as a bearer token, like /api/mobile/login.
  app.post('/api/mobile/auth/telegram/start', async (_req, res) => res.json(await startTelegramLogin()));
  app.get('/api/mobile/auth/telegram/status', async (req, res) => {
    const r = await telegramLoginStatus(req.query.token);
    res.set('Cache-Control', 'no-store');
    if (r.status !== 'confirmed') return res.json({ status: r.status });
    const { token } = await createSessionToken(r.userId);
    res.json({ status: 'confirmed', token, isNew: r.isNew, user: await mobileMe(r.userId) });
  });
}
