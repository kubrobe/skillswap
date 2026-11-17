// "Continue with Telegram" (bot deep-link flow). A small local server stands in for api.telegram.org,
// and the test plays Telegram's part by calling our webhook with "/start login_<token>".
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
const sent = [];                                           // everything the bot "sent" to Telegram
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    sent.push({ method: req.url.split('/').pop(), ...JSON.parse(body || '{}') });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise((r) => fake.listen(0, r));

const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');
const { applyMigrations } = await import('../src/migrations.js');
const { _test } = await import('../src/telegram.js');
await applyMigrations();

const server = app.listen(0);
const root = `http://localhost:${server.address().port}`;
test.after(async () => { server.close(); fake.close(); await pool.end(); });

const botOn = () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_BOT_USERNAME = 'SkillSwapTestBot';
  process.env.TELEGRAM_API_BASE = `http://localhost:${fake.address().port}`;
};
botOn();

async function call(method, url, token, body) {
  const res = await fetch(root + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
// Telegram -> our webhook: the person `from` wrote `text` to the bot in a private chat
const telegramSays = (text, from) => fetch(`${root}/telegram/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': _test.webhookSecret() },
  body: JSON.stringify({ message: { chat: { id: from.id, type: 'private' }, from, text } }),
});
const lastTo = (chatId) => sent.filter((m) => m.chat_id === chatId).pop()?.text || '';
const tgId = 5_000_000_000 + (Date.now() % 1_000_000_000);         // bigger than 32 bits, like real Telegram ids
const startParam = (url) => new URL(url).searchParams.get('start');

test('the pages learn whether to show "Continue with Telegram"; without a bot token the start is refused', async () => {
  assert.equal((await call('GET', '/api/config')).body.telegramLogin, true);
  assert.equal((await call('GET', '/api/mobile/config')).body.telegramLogin, true);
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.equal((await call('GET', '/api/config')).body.telegramLogin, false);
    assert.equal((await call('POST', '/api/mobile/auth/telegram/start')).status, 503);
  } finally { botOn(); }
});

test('app: start -> link, Start in Telegram -> confirmed; a new person gets an account, welcome credits and bot alerts', async () => {
  const from = { id: tgId, is_bot: false, first_name: 'Temur', username: 'temur_tg' };
  const start = await call('POST', '/api/mobile/auth/telegram/start');
  assert.equal(start.status, 200);
  assert.match(start.body.url, /^https:\/\/t\.me\/SkillSwapTestBot\?start=login_[A-Za-z0-9_-]{43}$/);
  assert.equal(startParam(start.body.url), `login_${start.body.token}`);
  assert.ok(startParam(start.body.url).length <= 64, 'Telegram allows 64 characters after start=');
  assert.equal(start.body.expiresIn, 300);
  const stored = await pool.query('SELECT token_hash FROM telegram_login_tokens');
  assert.ok(stored.rows.every((r) => r.token_hash !== start.body.token), 'only the hash of the token is stored');

  assert.deepEqual((await call('GET', `/api/mobile/auth/telegram/status?token=${start.body.token}`)).body, { status: 'pending' });
  assert.equal((await telegramSays(`/start ${startParam(start.body.url)}`, from)).status, 200);
  assert.match(lastTo(tgId), /^✅ You're logged in to SkillSwap. Go back to the app./);

  const done = await call('GET', `/api/mobile/auth/telegram/status?token=${start.body.token}`);
  assert.equal(done.body.status, 'confirmed');
  assert.equal(done.body.isNew, true);
  assert.ok(done.body.token.length >= 64, 'the same kind of session token as a normal login');
  assert.deepEqual([done.body.user.fullName, done.body.user.telegramUsername, done.body.user.username], ['Temur', 'temur_tg', '']);

  const sync = await call('GET', '/api/mobile/sync', done.body.token);
  assert.equal(sync.status, 200);
  assert.equal(sync.body.wallet.balance, 5, 'welcome credits, as in giveWelcome()');
  assert.equal((await call('GET', '/api/mobile/telegram', done.body.token)).body.linked, true, 'booking alerts go to this chat');
  const row = (await pool.query('SELECT telegram_id, password_hash FROM users WHERE id = $1', [done.body.user.id])).rows[0];
  assert.deepEqual([row.telegram_id, row.password_hash], [String(tgId), null]);

  // single use: the token is gone, for the app and for anyone who saw the link
  assert.deepEqual((await call('GET', `/api/mobile/auth/telegram/status?token=${start.body.token}`)).body, { status: 'expired' });
  await telegramSays(`/start ${startParam(start.body.url)}`, from);
  assert.match(lastTo(tgId), /expired/);
  assert.equal((await pool.query('SELECT 1 FROM telegram_login_tokens WHERE telegram_id = $1', [tgId])).rowCount, 0);
});

test('website: the same person logs in again -> the SAME account, a session cookie, and the new Telegram username', async () => {
  const from = { id: tgId, is_bot: false, first_name: 'Temur', username: 'temur_new' };
  const start = await call('POST', '/api/auth/telegram/start');
  await telegramSays(`/start login_${start.body.token}`, from);
  const done = await call('GET', `/api/auth/telegram/status?token=${start.body.token}`);
  assert.deepEqual(done.body, { status: 'confirmed', isNew: false });
  assert.match(done.cookie, /^skillswap_session=/);
  const me = await (await fetch(`${root}/api/me/profile`, { headers: { cookie: done.cookie } })).json();
  assert.equal(me.display_name, 'Temur');
  assert.equal(me.telegram_username, 'temur_new');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users WHERE telegram_id = $1', [tgId])).rows[0].n, 1);
});

test('an account that used "Connect Telegram" is found by Telegram login (no second account)', async () => {
  const chat = tgId + 1;
  const from = { id: chat, is_bot: false, first_name: 'Linked', username: 'linked_tg' };
  const reg = await call('POST', '/api/mobile/register', null, { fullName: 'Email First', email: `tglink_${tgId}@test.uz`, password: 'password123' });
  const link = (await call('POST', '/api/mobile/telegram/link', reg.body.token)).body.url;
  await telegramSays(`/start ${startParam(link)}`, from);
  assert.match(lastTo(chat), /Connected/);
  const profile = (await call('GET', '/api/mobile/sync', reg.body.token)).body.user;
  assert.equal(profile.telegramUsername, 'linked_tg', 'connecting fills in the Telegram username');

  const start = await call('POST', '/api/mobile/auth/telegram/start');
  await telegramSays(`/start login_${start.body.token}`, from);
  const done = await call('GET', `/api/mobile/auth/telegram/status?token=${start.body.token}`);
  assert.deepEqual([done.body.status, done.body.isNew, done.body.user.id, done.body.user.email], ['confirmed', false, reg.body.user.id, reg.body.user.email]);
});

test('tokens: 5 minutes only, never confirmed twice, garbage is refused, bots and group chats cannot confirm', async () => {
  const from = { id: tgId + 2, is_bot: false, first_name: 'Late' };
  const old = await call('POST', '/api/mobile/auth/telegram/start');
  await pool.query(`UPDATE telegram_login_tokens SET created_at = now() - interval '6 minutes' WHERE confirmed_at IS NULL`);
  await telegramSays(`/start login_${old.body.token}`, from);
  assert.match(lastTo(from.id), /expired/);
  assert.deepEqual((await call('GET', `/api/mobile/auth/telegram/status?token=${old.body.token}`)).body, { status: 'expired' });

  assert.equal((await call('GET', '/api/mobile/auth/telegram/status?token=abc')).status, 400);
  assert.equal((await call('GET', '/api/mobile/auth/telegram/status')).status, 400);
  assert.deepEqual((await call('GET', `/api/mobile/auth/telegram/status?token=${'A'.repeat(43)}`)).body, { status: 'expired' });

  const fresh = await call('POST', '/api/mobile/auth/telegram/start');
  await telegramSays(`/start login_${fresh.body.token}`, { ...from, is_bot: true });
  assert.match(lastTo(from.id), /expired/, 'a bot cannot confirm');
  await fetch(`${root}/telegram/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': _test.webhookSecret() },
    body: JSON.stringify({ message: { chat: { id: -100123, type: 'group' }, from, text: `/start login_${fresh.body.token}` } }),
  });
  assert.deepEqual((await call('GET', `/api/mobile/auth/telegram/status?token=${fresh.body.token}`)).body, { status: 'pending' }, 'not in a group chat');

  // the real person confirms; someone else trying the same link afterwards changes nothing
  await telegramSays(`/start login_${fresh.body.token}`, from);
  await telegramSays(`/start login_${fresh.body.token}`, { id: tgId + 3, is_bot: false, first_name: 'Thief' });
  assert.match(lastTo(tgId + 3), /expired/);
  const done = await call('GET', `/api/mobile/auth/telegram/status?token=${fresh.body.token}`);
  assert.equal(done.body.user.fullName, 'Late');
  // starting a new login clears out tokens that are too old
  await call('POST', '/api/mobile/auth/telegram/start');
  assert.equal((await pool.query(`SELECT 1 FROM telegram_login_tokens WHERE created_at < now() - interval '5 minutes'`)).rowCount, 0);
});

test('"Connect Telegram" asks for the phone; one tap saves the person\'s OWN number on their profile', async () => {
  const chat = tgId + 10;
  const from = { id: chat, is_bot: false, first_name: 'Phone', username: 'phone_tg' };
  const reg = await call('POST', '/api/mobile/register', null, { fullName: 'Phone Person', email: `tgphone_${tgId}@test.uz`, password: 'password123' });
  const link = (await call('POST', '/api/mobile/telegram/link', reg.body.token)).body.url;
  await telegramSays(`/start ${startParam(link)}`, from);
  const reply = sent.filter((m) => m.chat_id === chat).pop();
  assert.match(reply.text, /Connected[\s\S]*@phone_tg[\s\S]*phone number/);
  assert.equal(reply.reply_markup.keyboard[0][0].request_contact, true, 'the "Share my phone number" button');

  const contact = (c, chatType = 'private') => fetch(`${root}/telegram/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': _test.webhookSecret() },
    body: JSON.stringify({ message: { chat: { id: chat, type: chatType }, from, contact: c } }),
  });
  const phoneNow = async () => (await call('GET', '/api/mobile/sync', reg.body.token)).body.user.phone;

  // someone else's contact card (forwarded) is refused
  await contact({ user_id: 42, phone_number: '998911112233', first_name: 'Other' });
  assert.match(lastTo(chat), /your own number/);
  assert.equal(await phoneNow(), null);
  // not in a group chat
  await contact({ user_id: chat, phone_number: '998901234567', first_name: 'Phone' }, 'group');
  assert.equal(await phoneNow(), null);
  // their own number, as Telegram sends it (no "+")
  await contact({ user_id: chat, phone_number: '998901234567', first_name: 'Phone' });
  assert.match(lastTo(chat), /Saved \+998901234567/);
  assert.equal(sent.filter((m) => m.chat_id === chat).pop().reply_markup.remove_keyboard, true);
  assert.equal(await phoneNow(), '+998901234567');

  // connecting again later: the phone is already there, so the button is not shown
  const again = (await call('POST', '/api/mobile/telegram/link', reg.body.token)).body.url;
  await telegramSays(`/start ${startParam(again)}`, from);
  assert.equal(sent.filter((m) => m.chat_id === chat).pop().reply_markup, undefined);
});

test('phoneFromTelegram: adds "+", refuses junk', async () => {
  const { phoneFromTelegram } = await import('../src/telegram.js');
  assert.equal(phoneFromTelegram('998901234567'), '+998901234567');
  assert.equal(phoneFromTelegram('+82 10-1234-5678'), '+821012345678');
  assert.equal(phoneFromTelegram('123'), null);
  assert.equal(phoneFromTelegram(undefined), null);
});
