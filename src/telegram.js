// The SkillSwap Telegram bot. Students already live in Telegram, so the important moments reach them there:
//   - "Bobur booked your Python lesson" and "+1 credit" (every live notice also goes to Telegram)
//   - "⏰ In 1 hour: Guitar with Jasur" before each weekly lesson
//   - /next (my upcoming lessons), /credits (my balance), /stop (unlink)
//
// Linking: the app asks POST /api/mobile/telegram/link for a one-time link t.me/<bot>?start=<code>;
// Telegram opens the chat, the user taps Start, and the bot receives "/start <code>".
// Telegram calls our webhook (an incoming request also wakes the free Render server).
//
// Log in with Telegram uses the same bot: the login page asks for t.me/<bot>?start=login_<token>, the person
// taps Start, and the bot marks that one-time token as confirmed (the rest is in src/telegram-login.js).
//
// Settings (Render → Environment): TELEGRAM_BOT_TOKEN from @BotFather, optional TELEGRAM_BOT_USERNAME
// (the short names BOT_TOKEN / BOT_USERNAME work too). They live ONLY in environment variables, never in the code.
// Without a token every function here does nothing, so the rest of the app works the same.
import crypto from 'node:crypto';
import { query } from './db.js';
import { HttpError, cleanPhone } from './validate.js';

const token = () => process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const apiBase = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
export const telegramConfigured = () => token().length > 0;
// Telegram sends this back in a header, so only Telegram can call the webhook.
const webhookSecret = () => crypto.createHash('sha256').update(`skillswap:${token()}`).digest('hex').slice(0, 48);
const TZ = 'Asia/Tashkent';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function callTelegram(method, body, timeoutMs = 10_000) {
  if (!telegramConfigured()) return null;
  try {
    const res = await fetch(`${apiBase()}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await res.json().catch(() => null);
  } catch (e) {
    console.error('Telegram:', method, e.message);
    return null;
  }
}

const sendTo = (chatId, text, extra = {}) =>
  callTelegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

// Telegram never gives a bot someone's phone number by itself. The bot shows this button; one tap sends the
// person's own number (a "contact" message), and handleContact() saves it on their SkillSwap profile.
const PHONE_BUTTON = '📱 Share my phone number';
const ASK_PHONE = {
  reply_markup: { keyboard: [[{ text: PHONE_BUTTON, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
};
const NO_KEYBOARD = { reply_markup: { remove_keyboard: true } };
const PHONE_HINT = '\n\n📱 Tap the button below to add your phone number to your SkillSwap profile. ' +
  'You choose who sees it in Edit profile.';

/** "998901234567" (how Telegram sends it) -> "+998901234567"; null when it is not a valid number. */
export function phoneFromTelegram(raw) {
  const digits = String(raw || '').replace(/[^0-9+]/g, '');
  try { return cleanPhone(digits.startsWith('+') ? digits : `+${digits}`); } catch { return null; }
}

/** The person tapped "Share my phone number": save it on the SkillSwap account this Telegram belongs to. */
async function handleContact(msg) {
  const chatId = msg.chat.id;
  const from = msg.from || {};
  // A forwarded contact card is someone else's number: only the person's OWN number is accepted.
  if (!from.id || msg.contact.user_id !== from.id) {
    return sendTo(chatId, 'Please share your own number with the button below.', ASK_PHONE);
  }
  const phone = phoneFromTelegram(msg.contact.phone_number);
  if (!phone) return sendTo(chatId, 'That number does not look right. Add it in SkillSwap → Profile → Edit profile.', NO_KEYBOARD);
  // the account that connected this chat first; otherwise the account that logs in with this Telegram
  const user = (await query(
    `SELECT u.id FROM users u LEFT JOIN telegram_links l ON l.user_id = u.id
      WHERE l.chat_id = $1 OR u.telegram_id = $2
      ORDER BY (l.chat_id = $1) DESC NULLS LAST LIMIT 1`, [chatId, from.id])).rows[0];
  if (!user) return sendTo(chatId, 'To connect, open the SkillSwap app → Profile → Connect Telegram.', NO_KEYBOARD);
  await query('UPDATE users SET phone = $2 WHERE id = $1', [user.id, phone]);
  // the open app downloads a fresh copy, so the number appears on the profile right away
  import('./live.js').then((live) => live.sendEvent(user.id, 'changed', {})).catch(() => {});
  return sendTo(chatId, `✅ Saved ${phone} on your SkillSwap profile.`, NO_KEYBOARD);
}

let username = null;
export async function botUsername() {
  const fixed = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME;
  if (fixed) return fixed.replace(/^@/, '');
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

// The lesson's video room on our own site (the same room as the app; no meeting site, no moderator).
const videoRoom = (id) => {
  const site = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  return site ? `${site}/call?lesson=${id}` : 'open the lesson in the SkillSwap app';
};

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
  if (chatId && msg.contact && (!msg.chat.type || msg.chat.type === 'private')) return handleContact(msg);
  const text = String(msg.text || '').trim();
  if (!chatId || !text.startsWith('/')) {
    if (chatId) await sendTo(chatId, 'Hi! I am the SkillSwap bot. Commands: /next — my lessons, /credits — my balance, /stop — unlink.');
    return;
  }
  const [command, arg] = text.split(/\s+/, 2);
  const from = msg.from || {};
  const tgName = /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(from.username || '') ? from.username : null;

  // Log in with Telegram: "/start login_<token>". Only in a private chat, so the token is tied to ONE person.
  if (command === '/start' && arg?.startsWith(LOGIN_PREFIX)) {
    const personal = from.id && !from.is_bot && (!msg.chat.type || msg.chat.type === 'private');
    const ok = personal && (await query(
      `UPDATE telegram_login_tokens
          SET telegram_id = $2, tg_username = $3, tg_first_name = $4, confirmed_at = now()
        WHERE token_hash = $1 AND confirmed_at IS NULL AND created_at > now() - interval '${LOGIN_MINUTES} minutes'`,
      [loginTokenHash(arg.slice(LOGIN_PREFIX.length)), from.id, tgName, String(from.first_name || '').slice(0, 64)])).rowCount > 0;
    if (!ok) return sendTo(chatId, 'This login link has expired. Go back to SkillSwap and tap "Continue with Telegram" again.');
    const hasPhone = (await query('SELECT 1 FROM users WHERE telegram_id = $1 AND phone IS NOT NULL', [from.id])).rowCount > 0;
    return hasPhone
      ? sendTo(chatId, "✅ You're logged in to SkillSwap. Go back to the app.")
      : sendTo(chatId, "✅ You're logged in to SkillSwap. Go back to the app." + PHONE_HINT, ASK_PHONE);
  }

  const linked = (await query('SELECT user_id FROM telegram_links WHERE chat_id = $1', [chatId])).rows[0];

  if (command === '/start' && arg) {
    const code = (await query(
      `DELETE FROM telegram_link_codes WHERE code = $1 AND created_at > now() - interval '15 minutes'
       RETURNING user_id`, [arg])).rows[0];
    if (!code) return sendTo(chatId, 'This link has expired. Open SkillSwap → Profile → Connect Telegram again.');
    await query('DELETE FROM telegram_links WHERE chat_id = $1 OR user_id = $2', [chatId, code.user_id]);
    await query('INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2)', [code.user_id, chatId]);
    // The profile learns the Telegram username (for the "Message on Telegram" button), and this Telegram
    // account can log in to this SkillSwap account from now on (unless it already belongs to another account).
    if (from.id) {
      await query(
        `UPDATE users SET telegram_username = COALESCE($2, telegram_username),
                          telegram_id = CASE WHEN EXISTS (SELECT 1 FROM users o WHERE o.telegram_id = $3 AND o.id <> $1)
                                             THEN telegram_id ELSE $3 END
          WHERE id = $1`, [code.user_id, tgName, from.id]);
    }
    const me = (await query(
      'SELECT p.display_name, u.phone FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1', [code.user_id])).rows[0] || {};
    const connected = `✅ Connected, ${(me.display_name || '').split(' ')[0]}! ` +
      (tgName ? `Your profile now shows @${tgName}. ` : '') +
      'You will get booking alerts and a reminder 1 hour before each lesson.\n' +
      'Commands: /next — my lessons · /credits — my balance · /stop — unlink';
    // the open app downloads a fresh copy, so the Telegram username appears on the profile right away
    import('./live.js').then((live) => live.sendEvent(code.user_id, 'changed', {})).catch(() => {});
    return me.phone ? sendTo(chatId, connected) : sendTo(chatId, connected + PHONE_HINT, ASK_PHONE);
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
    const room = videoRoom(l.id);
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

// ---------- Log in with Telegram: the one-time token ----------
export const LOGIN_PREFIX = 'login_';      // tells a login token apart from a "Connect Telegram" code
export const LOGIN_MINUTES = 5;
/** Only this hash is stored, so a copy of the database cannot be used to log in. */
export const loginTokenHash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/**
 * Local development (no public address, so Telegram cannot call a webhook): ask Telegram for new messages
 * with long polling. Never used on Render, and it never removes a webhook: if this bot already has one
 * (the live server), Telegram answers 409 and polling simply stops.
 */
async function pollUpdates() {
  console.log('Telegram: no PUBLIC_URL, reading messages with long polling (getUpdates)');
  let offset = 0;
  for (;;) {
    const r = await callTelegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 40_000);
    if (r?.error_code === 409) {
      console.error('Telegram: this bot already has a webhook (another server uses it). Long polling stopped.');
      return;
    }
    if (!r?.ok) { await new Promise((wait) => setTimeout(wait, 5_000)); continue; }
    for (const update of r.result || []) {
      offset = update.update_id + 1;
      try { if (update.message) await handleMessage(update.message); } catch (e) { console.error('Telegram update:', e.message); }
    }
  }
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
  } else {
    pollUpdates().catch((e) => console.error('Telegram polling:', e.message));
  }
  setInterval(() => sendDueReminders().catch((e) => console.error('Telegram reminders:', e.message)), 5 * 60_000);
}

export const _test = { webhookSecret };
