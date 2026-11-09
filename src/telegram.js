// The SkillSwap Telegram bot. Students already live in Telegram, so the important moments reach them there:
//   - "Bobur booked your Python lesson" and "+1 credit" (every live notice also goes to Telegram)
//   - "⏰ In 1 hour: Guitar with Jasur" before each weekly lesson
//   - /next (my upcoming lessons), /credits (my balance), /stop (unlink)
//
// Linking: the app asks POST /api/mobile/telegram/link for a one-time link t.me/<bot>?start=<code>;
// Telegram opens the chat, the user taps Start, and the bot receives "/start <code>".
// Telegram calls our webhook (an incoming request also wakes the free Render server).
//
// Settings (Render → Environment): TELEGRAM_BOT_TOKEN from @BotFather, optional TELEGRAM_BOT_USERNAME.
// Without a token every function here does nothing, so the rest of the app works the same.
import crypto from 'node:crypto';
import { query } from './db.js';
import { HttpError } from './validate.js';

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const apiBase = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
export const telegramConfigured = () => token().length > 0;
// Telegram sends this back in a header, so only Telegram can call the webhook.
const webhookSecret = () => crypto.createHash('sha256').update(`skillswap:${token()}`).digest('hex').slice(0, 48);
const TZ = 'Asia/Tashkent';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function callTelegram(method, body) {
  if (!telegramConfigured()) return null;
  try {
    const res = await fetch(`${apiBase()}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return await res.json().catch(() => null);
  } catch (e) {
    console.error('Telegram:', method, e.message);
    return null;
  }
}

const sendTo = (chatId, text) => callTelegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

let username = null;
async function botUsername() {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (!username) username = (await callTelegram('getMe', {}))?.result?.username || null;
  return username;
}

/** Send a message to a SkillSwap user if they linked Telegram. Never throws, never waits for the answer. */
export function telegramNotify(userId, text) {
  if (!telegramConfigured()) return;
  query('SELECT chat_id FROM telegram_links WHERE user_id = $1', [userId])
    .then((r) => r.rows[0] && sendTo(Number(r.rows[0].chat_id), text))   // BIGINT arrives as a string
    .catch((e) => console.error('Telegram notify:', e.message));
}

const jitsi = (id, createdAt) =>
  `https://meet.jit.si/SkillSwap-${id}-${(new Date(createdAt).getTime() % 1_000_000_000).toString(36)}`;

/** Upcoming lessons of a user, each with its next date in Tashkent time. */
async function upcomingLessons(userId) {
  return (await query(
    `SELECT b.id, b.created_at, s.name AS skill, sl.weekday, sl.hour, b.learner_id = $1 AS learning,
            split_part(tp.display_name, ' ', 1) AS teacher, split_part(lp.display_name, ' ', 1) AS learner
       FROM slot_bookings b
       JOIN offer_slots sl ON sl.id = b.slot_id
       JOIN user_offers o  ON o.id = b.offer_id
       JOIN skills s       ON s.id = o.skill_id
       JOIN profiles tp    ON tp.user_id = o.user_id
       JOIN profiles lp    ON lp.user_id = b.learner_id
      WHERE b.status = 'BOOKED' AND (b.learner_id = $1 OR o.user_id = $1)
      ORDER BY sl.weekday, sl.hour`, [userId])).rows;
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || '').trim();
  if (!chatId || !text.startsWith('/')) {
    if (chatId) await sendTo(chatId, 'Hi! I am the SkillSwap bot. Commands: /next — my lessons, /credits — my balance, /stop — unlink.');
    return;
  }
  const [command, arg] = text.split(/\s+/, 2);
  const linked = (await query('SELECT user_id FROM telegram_links WHERE chat_id = $1', [chatId])).rows[0];

  if (command === '/start' && arg) {
    const code = (await query(
      `DELETE FROM telegram_link_codes WHERE code = $1 AND created_at > now() - interval '15 minutes'
       RETURNING user_id`, [arg])).rows[0];
    if (!code) return sendTo(chatId, 'This link has expired. Open SkillSwap → Profile → Connect Telegram again.');
    await query('DELETE FROM telegram_links WHERE chat_id = $1 OR user_id = $2', [chatId, code.user_id]);
    await query('INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2)', [code.user_id, chatId]);
    const name = (await query('SELECT display_name FROM profiles WHERE user_id = $1', [code.user_id])).rows[0]?.display_name || '';
    return sendTo(chatId,
      `✅ Connected, ${name.split(' ')[0]}! You will get booking alerts and a reminder 1 hour before each lesson.\n` +
      'Commands: /next — my lessons · /credits — my balance · /stop — unlink');
  }
  if (!linked) return sendTo(chatId, 'To connect, open the SkillSwap app → Profile → Connect Telegram.');

  if (command === '/next') {
    const lessons = await upcomingLessons(linked.user_id);
    if (lessons.length === 0) return sendTo(chatId, 'No upcoming lessons. Book one in the app!');
    return sendTo(chatId, '📅 Your lessons\n' + lessons.map((l) =>
      `• ${DAYS[l.weekday - 1]} ${String(l.hour).padStart(2, '0')}:00 — ${l.skill} ` +
      (l.learning ? `with ${l.teacher}` : `teaching ${l.learner}`)).join('\n'));
  }
  if (command === '/credits') {
    const r = (await query('SELECT COALESCE(sum(amount), 0)::int AS balance FROM credit_ledger WHERE user_id = $1', [linked.user_id])).rows[0];
    return sendTo(chatId, `🪙 You have ${r.balance} credit${r.balance === 1 ? '' : 's'}. Teach 1 hour to earn 1 more.`);
  }
  if (command === '/stop') {
    await query('DELETE FROM telegram_links WHERE chat_id = $1', [chatId]);
    return sendTo(chatId, 'Unlinked. You will not get SkillSwap messages here any more.');
  }
  return sendTo(chatId, 'Commands: /next — my lessons · /credits — my balance · /stop — unlink');
}

/** Lessons starting within the next hour: remind the learner and the teacher, once per week. */
export async function sendDueReminders() {
  if (!telegramConfigured()) return 0;
  const due = (await query(
    `WITH lessons AS (
       SELECT b.id, b.learner_id, o.user_id AS teacher_id, b.created_at, s.name AS skill, sl.weekday, sl.hour,
              split_part(tp.display_name, ' ', 1) AS teacher, split_part(lp.display_name, ' ', 1) AS learner,
              date_trunc('week', now() AT TIME ZONE '${TZ}') + (sl.weekday - 1) * interval '1 day' + sl.hour * interval '1 hour' AS this_week
         FROM slot_bookings b
         JOIN offer_slots sl ON sl.id = b.slot_id
         JOIN user_offers o  ON o.id = b.offer_id
         JOIN skills s       ON s.id = o.skill_id
         JOIN profiles tp    ON tp.user_id = o.user_id
         JOIN profiles lp    ON lp.user_id = b.learner_id
        WHERE b.status = 'BOOKED'
          AND (b.learner_id IN (SELECT user_id FROM telegram_links) OR o.user_id IN (SELECT user_id FROM telegram_links))
     ), timed AS (
       SELECT *, CASE WHEN this_week <= now() AT TIME ZONE '${TZ}' THEN this_week + interval '7 days' ELSE this_week END AS lesson_at
         FROM lessons
     )
     SELECT * FROM timed WHERE lesson_at <= (now() AT TIME ZONE '${TZ}') + interval '60 minutes'`)).rows;
  let sent = 0;
  for (const l of due) {
    const fresh = await query(
      'INSERT INTO telegram_reminders (booking_id, lesson_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1',
      [l.id, l.lesson_at]);
    if (fresh.rowCount === 0) continue;                // already reminded for this week
    const when = `${DAYS[l.weekday - 1]} ${String(l.hour).padStart(2, '0')}:00`;
    const room = jitsi(l.id, l.created_at);
    telegramNotify(l.learner_id, `⏰ In 1 hour: ${l.skill} with ${l.teacher} (${when}).\nVideo room: ${room}`);
    telegramNotify(l.teacher_id, `⏰ In 1 hour you teach ${l.skill} to ${l.learner} (${when}).\nShow your check-in QR at the end.\nVideo room: ${room}`);
    sent += 1;
  }
  return sent;
}

export function telegramRoutes(app) {
  // Telegram → us. Answer 200 quickly, even on errors, so Telegram does not resend the same update forever.
  app.post('/telegram/webhook', async (req, res) => {
    if (!telegramConfigured() || req.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      if (req.body?.message) await handleMessage(req.body.message);
    } catch (e) {
      console.error('Telegram update:', e.message);
    }
    res.json({ ok: true });
  });
}

/** Routes the app uses (registered with the other /api/mobile routes). */
export function telegramAppRoutes(app, requireAuth) {
  app.get('/api/mobile/telegram', requireAuth, async (req, res) => {
    const linked = (await query('SELECT 1 FROM telegram_links WHERE user_id = $1', [req.user.id])).rowCount > 0;
    res.json({ configured: telegramConfigured(), linked, bot: telegramConfigured() ? await botUsername() : null });
  });
  app.post('/api/mobile/telegram/link', requireAuth, async (req, res) => {
    if (!telegramConfigured()) throw new HttpError(503, 'The Telegram bot is not set up on the server yet');
    const bot = await botUsername();
    if (!bot) throw new HttpError(503, 'The Telegram bot is not reachable right now');
    const code = crypto.randomBytes(12).toString('hex');
    await query(`DELETE FROM telegram_link_codes WHERE user_id = $1 OR created_at < now() - interval '1 day'`, [req.user.id]);
    await query('INSERT INTO telegram_link_codes (code, user_id) VALUES ($1, $2)', [code, req.user.id]);
    res.json({ url: `https://t.me/${bot}?start=${code}` });
  });
  app.post('/api/mobile/telegram/unlink', requireAuth, async (req, res) => {
    await query('DELETE FROM telegram_links WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  });
}

/** On server start: point Telegram at our webhook and check for due reminders every 5 minutes. */
export function startTelegram() {
  if (!telegramConfigured()) return;
  const site = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (site) {
    callTelegram('setWebhook', {
      url: `${site.replace(/\/$/, '')}/telegram/webhook`,
      secret_token: webhookSecret(),
      allowed_updates: ['message'],
    }).then((r) => console.log('Telegram webhook:', r?.ok ? 'set' : r?.description || 'failed'));
  }
  setInterval(() => sendDueReminders().catch((e) => console.error('Telegram reminders:', e.message)), 5 * 60_000);
}

export const _test = { webhookSecret };
