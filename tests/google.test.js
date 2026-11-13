// Sign in with Google. Tests cannot ask Google, so a fake verifier stands in for Google's signature check:
// "good-<sub>-<email>" is a valid token, anything else is rejected like a forged token.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');
const { setGoogleVerifier } = await import('../src/google.js');
const { applyMigrations } = await import('../src/migrations.js');
await applyMigrations();

setGoogleVerifier(async (token) => {
  const m = /^good-([^-]+)-(.+?)(-unverified)?$/.exec(token);
  if (!m) throw new Error('bad signature');
  return { sub: m[1], email: m[2], email_verified: !m[3], name: 'Google Tester' };
});

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

const post = async (url, body, cookie = '') => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const stamp = Date.now();

test('the pages learn the client id (so they can show the button)', async () => {
  const r = await (await fetch(`${base}/api/config`)).json();
  assert.equal(r.googleClientId, 'test-client.apps.googleusercontent.com');
});

test('website: a new Google user gets an account without a password, a session cookie and welcome credits', async () => {
  const email = `g${stamp}@gmail.test`;
  const r = await post('/api/auth/google', { credential: `good-sub${stamp}-${email}` });
  assert.equal(r.status, 201);
  assert.equal(r.body.isNew, true);
  assert.match(r.cookie, /^skillswap_session=/);
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie: r.cookie } })).json();
  assert.equal(me.user.email, email);
  const row = (await pool.query('SELECT password_hash, google_sub FROM users WHERE email = $1', [email])).rows[0];
  assert.equal(row.password_hash, null);
  assert.equal(row.google_sub, `sub${stamp}`);
  const credits = (await pool.query(`SELECT count(*)::int AS n FROM credit_ledger l JOIN users u ON u.id = l.user_id WHERE u.email = $1 AND l.reason = 'welcome'`, [email])).rows[0].n;
  assert.equal(credits, 1);
  // signing in again: the same account, not a second one
  const again = await post('/api/auth/google', { credential: `good-sub${stamp}-${email}` });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, r.body.id);
  // and nobody can log in to it with an empty / guessed password
  assert.equal((await post('/api/login', { email, password: 'password123' })).status, 401);
  assert.equal((await post('/api/mobile/login', { email, password: 'password123' })).status, 401);
});

test('app: Google on the phone links to the existing account with the same email', async () => {
  const email = `both${stamp}@test.uz`;
  const reg = await post('/api/register', { email, password: 'password123', display_name: 'Web First' });
  assert.equal(reg.status, 201);
  const r = await post('/api/mobile/google', { idToken: `good-phone${stamp}-${email}` });
  assert.equal(r.status, 200);
  assert.equal(r.body.isNew, false);
  assert.equal(r.body.user.id, reg.body.id);
  assert.equal(r.body.user.fullName, 'Web First');           // keeps the name they chose
  assert.ok(r.body.token.length >= 32);
  // the password still works too
  assert.equal((await post('/api/login', { email, password: 'password123' })).status, 200);
});

test('fake, unverified or missing tokens are refused', async () => {
  assert.equal((await post('/api/auth/google', { credential: 'forged-token-forged-token' })).status, 401);
  assert.equal((await post('/api/mobile/google', { idToken: `good-x${stamp}-u${stamp}@test.uz-unverified` })).status, 401);
  assert.equal((await post('/api/auth/google', {})).status, 400);
});
