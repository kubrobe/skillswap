// Automated API tests. Run: npm test   (needs the database from `npm run db:reset`)
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

// Tiny client that remembers its cookie, like a browser does
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const stamp = Date.now();
const skill = async (name) => (await pool.query('SELECT id FROM skills WHERE name=$1', [name])).rows[0].id;
const newUser = async (tag) => {
  const c = client();
  const r = await c('POST', '/api/register', { email: `${tag}${stamp}@test.uz`, password: 'password123', display_name: `Tester ${tag}` });
  assert.equal(r.status, 201);
  return { c, id: r.body.id };
};

test('registration validates input', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/register', { email: 'nope', password: 'password123', display_name: 'Ab' })).status, 400);
  assert.equal((await c('POST', '/api/register', { email: 'a@b.uz', password: 'short', display_name: 'Ab' })).status, 400);
  assert.equal((await c('POST', '/api/register', { email: 'a@b.uz', password: 'password123', display_name: 'A' })).status, 400);
});

test('duplicate email is rejected (UNIQUE constraint) and passwords are stored hashed', async () => {
  const { c } = await newUser('dup');
  const again = await c('POST', '/api/register', { email: `dup${stamp}@test.uz`, password: 'password123', display_name: 'Again' });
  assert.equal(again.status, 409);
  const row = (await pool.query('SELECT password_hash FROM users WHERE email=$1', [`dup${stamp}@test.uz`])).rows[0];
  assert.notEqual(row.password_hash, 'password123');
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('login: wrong password fails, right password works, logout ends the session', async () => {
  await newUser('log');
  const c = client();
  assert.equal((await c('POST', '/api/login', { email: `log${stamp}@test.uz`, password: 'wrongwrong' })).status, 401);
  assert.equal((await c('POST', '/api/login', { email: `log${stamp}@test.uz`, password: 'password123' })).status, 200);
  assert.equal((await c('GET', '/api/me')).body.user.email, `log${stamp}@test.uz`);
  await c('POST', '/api/logout');
});

test('private routes need login', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/matches')).status, 401);
  assert.equal((await c('GET', '/api/exchanges')).status, 401);
});

test('SQL injection text is treated as plain text', async () => {
  const { c } = await newUser('sqli');
  const r = await c('GET', "/api/members?q=" + encodeURIComponent("'; DROP TABLE users; --"));
  assert.equal(r.status, 200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n > 0, true);
});

test('offers: duplicates are blocked, invalid level is rejected', async () => {
  const { c } = await newUser('off');
  const py = await skill('Python basics');
  assert.equal((await c('POST', '/api/me/offers', { skill_id: py, level: 'advanced' })).status, 201);
  assert.equal((await c('POST', '/api/me/offers', { skill_id: py })).status, 409);
  assert.equal((await c('POST', '/api/me/offers', { skill_id: await skill('Chess'), level: 'god' })).status, 400);
  assert.equal((await c('POST', '/api/me/offers', { skill_id: 999999 })).status, 400);
});

test('matching: mutual match is found and listed first', async () => {
  const { c } = await newUser('mat');
  await c('POST', '/api/me/offers',   { skill_id: await skill('Python basics') });
  await c('POST', '/api/me/requests', { skill_id: await skill('Korean for beginners') });
  const m = (await c('GET', '/api/matches')).body;
  const kamola = m.find((x) => x.display_name === 'Kamola Hasanova');   // seed: teaches Korean, wants Python
  assert.ok(kamola && kamola.mutual);
  assert.equal(m[0].mutual, true);
});

test('exchange rules and the full status flow', async () => {
  const a = await newUser('exa');           // requester
  const kamolaId = (await pool.query("SELECT id FROM users WHERE email='kamola@demo.uz'")).rows[0].id;
  const korean = await skill('Korean for beginners'), python = await skill('Python basics');
  const req = { provider_id: kamolaId, skill_wanted_id: korean, skill_offered_id: python, message: 'hi' };

  // cannot offer a skill you do not have
  assert.equal((await a.c('POST', '/api/exchanges', req)).status, 400);
  await a.c('POST', '/api/me/offers', { skill_id: python });
  // cannot ask a skill the provider does not teach
  assert.equal((await a.c('POST', '/api/exchanges', { ...req, skill_wanted_id: await skill('Guitar') })).status, 400);
  // cannot send to yourself
  assert.equal((await a.c('POST', '/api/exchanges', { ...req, provider_id: a.id })).status, 400);

  const ok = await a.c('POST', '/api/exchanges', req);
  assert.equal(ok.status, 201);
  // exact duplicate pending request is blocked by the partial unique index
  assert.equal((await a.c('POST', '/api/exchanges', req)).status, 409);

  // the requester cannot accept their own request
  assert.equal((await a.c('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'accept' })).status, 403);
  // a stranger cannot see it at all
  const stranger = await newUser('str');
  assert.equal((await stranger.c('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'accept' })).status, 404);

  const k = client();
  await k('POST', '/api/login', { email: 'kamola@demo.uz', password: 'demo12345' });
  assert.equal((await k('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'complete' })).status, 409); // not accepted yet
  assert.equal((await k('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'accept' })).body.status, 'accepted');
  assert.equal((await k('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'accept' })).status, 409);   // already accepted
  assert.equal((await a.c('PATCH', `/api/exchanges/${ok.body.id}`, { action: 'complete' })).body.status, 'completed');

  // every change was written to the history table
  const log = await pool.query('SELECT status FROM exchange_status_log WHERE exchange_id=$1 ORDER BY id', [ok.body.id]);
  assert.deepEqual(log.rows.map((r) => r.status), ['pending', 'accepted', 'completed']);
});

test('transaction rolls back: a failed exchange leaves no half-written rows', async () => {
  const a = await newUser('rb');
  await a.c('POST', '/api/me/offers', { skill_id: await skill('Python basics') });
  const before = (await pool.query('SELECT count(*)::int n FROM exchanges')).rows[0].n;
  const kamolaId = (await pool.query("SELECT id FROM users WHERE email='kamola@demo.uz'")).rows[0].id;
  await a.c('POST', '/api/exchanges', { provider_id: kamolaId, skill_wanted_id: await skill('Guitar'), skill_offered_id: await skill('Python basics') }); // rejected
  assert.equal((await pool.query('SELECT count(*)::int n FROM exchanges')).rows[0].n, before);
});

test('database CHECK constraints work even if the API were bypassed', async () => {
  await assert.rejects(pool.query("INSERT INTO exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id, status) SELECT id, id, 1, 1, 'pending' FROM users LIMIT 1"), /no_self_exchange/);
  await assert.rejects(pool.query("UPDATE exchanges SET status='banana' WHERE id = (SELECT min(id) FROM exchanges)"), /check/i);
});
