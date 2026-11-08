// Tests for notifications, chat, workspace and availability. Run: npm test (needs `npm run db:reset` first)
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');
const { cleanSlots, sharedSlots, offsetMinutes } = await import('../src/availability.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const stamp = Date.now();
const skill = async (n) => (await pool.query('SELECT id FROM skills WHERE name=$1', [n])).rows[0].id;
const newUser = async (tag) => {
  const c = client();
  const r = await c('POST', '/api/register', { email: `${tag}${stamp}@test.uz`, password: 'password123', display_name: `Tester ${tag}` });
  assert.equal(r.status, 201);
  return { c, id: r.body.id };
};
// Two people with a PENDING swap, then accept it.
async function pair(tag) {
  const a = await newUser(`${tag}a`); const b = await newUser(`${tag}b`);
  await a.c('POST', '/api/me/offers', { skill_id: await skill('Python basics') });
  await b.c('POST', '/api/me/offers', { skill_id: await skill('Guitar') });
  const ex = (await a.c('POST', '/api/exchanges', { provider_id: b.id, skill_wanted_id: await skill('Guitar'), skill_offered_id: await skill('Python basics') })).body.id;
  return { a, b, ex, accept: () => b.c('PATCH', `/api/exchanges/${ex}`, { action: 'accept' }) };
}

test('notifications: created inside the status transaction, private to their owner, read/unread works', async () => {
  const { a, b, ex, accept } = await pair('nt');
  const first = (await b.c('GET', '/api/notifications')).body;
  assert.equal(first.unread, 1); assert.equal(first.items[0].type, 'request');
  assert.equal((await a.c('GET', '/api/notifications/count')).body.unread, 0);   // not copied to the sender
  await accept();
  const mine = (await a.c('GET', '/api/notifications')).body;
  assert.equal(mine.items[0].type, 'accepted'); assert.equal(mine.items[0].link, `/workspace?id=${ex}`);
  // another member cannot mark my notification as read
  await b.c('POST', '/api/notifications/read', { id: mine.items[0].id });
  assert.equal((await a.c('GET', '/api/notifications/count')).body.unread, 1);
  await a.c('POST', '/api/notifications/read', { id: mine.items[0].id });
  assert.equal((await a.c('GET', '/api/notifications/count')).body.unread, 0);
  assert.equal((await client()('GET', '/api/notifications')).status, 401);
});

test('chat: only the two people, only for accepted swaps, validated, unread tracking, pagination', async () => {
  const { a, b, ex, accept } = await pair('ch');
  const out = await newUser('chx');
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: 'hi' })).status, 409);        // still pending
  assert.equal((await a.c('GET', `/api/exchanges/${ex}/messages`)).status, 409);
  await accept();
  assert.equal((await out.c('POST', `/api/exchanges/${ex}/messages`, { body: 'hi' })).status, 404);     // outsider
  assert.equal((await out.c('GET', `/api/exchanges/${ex}/messages`)).status, 404);
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: '   ' })).status, 400);       // blank
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: '<b>hello</b>' })).status, 201);
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: 'second' })).status, 201);

  const conv = (await b.c('GET', '/api/conversations')).body.find((c) => c.id === ex);
  assert.equal(conv.unread, 2); assert.equal(conv.last_body, 'second');
  assert.equal((await b.c('GET', '/api/notifications')).body.items.filter((n) => n.type === 'message').length, 1); // one bell entry, not one per line
  const got = (await b.c('GET', `/api/exchanges/${ex}/messages`)).body;
  assert.equal(got.messages.length, 2); assert.equal(got.messages[0].body, '<b>hello</b>');           // stored as plain text
  assert.equal((await b.c('GET', '/api/conversations')).body.find((c) => c.id === ex).unread, 0);       // opening = reading
  // polling: only newer messages
  await b.c('POST', `/api/exchanges/${ex}/messages`, { body: 'reply' });
  const fresh = (await a.c('GET', `/api/exchanges/${ex}/messages?after=${got.messages[1].id}`)).body;
  assert.deepEqual(fresh.messages.map((m) => m.body), ['reply']);
  // pagination: 35 more messages -> first page has 30 and says there are more
  for (let i = 0; i < 12; i++) { await a.c('POST', `/api/exchanges/${ex}/messages`, { body: `m${i}` }); }
  await pool.query('INSERT INTO messages (exchange_id, sender_id, body) SELECT $1, $2, \'bulk\' || g FROM generate_series(1, 25) g', [ex, a.id]);
  const page = (await a.c('GET', `/api/exchanges/${ex}/messages`)).body;
  assert.equal(page.messages.length, 30); assert.equal(page.has_more, true);
  const older = (await a.c('GET', `/api/exchanges/${ex}/messages?before=${page.messages[0].id}`)).body;
  assert.ok(older.messages.length > 0 && older.messages.at(-1).id < page.messages[0].id);
  // finished swap: chat is read-only
  await a.c('PATCH', `/api/exchanges/${ex}`, { action: 'complete' });
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/messages`, { body: 'late' })).status, 409);
  assert.equal((await a.c('GET', `/api/exchanges/${ex}/messages`)).status, 200);
});

test('chat rate limit: more than 20 messages a minute is refused', async () => {
  const { a, ex, accept } = await pair('rl'); await accept();
  let last;
  for (let i = 0; i < 22; i++) last = await a.c('POST', `/api/exchanges/${ex}/messages`, { body: `n${i}` });
  assert.equal(last.status, 429);
});

test('workspace: participants only, milestones validated, progress computed, no IDOR, read-only when finished', async () => {
  const { a, b, ex, accept } = await pair('ws');
  const other = await pair('ws2'); await other.accept();
  const out = await newUser('wsx');
  assert.equal((await a.c('GET', `/api/exchanges/${ex}/workspace`)).status, 409);                          // pending
  await accept();
  assert.equal((await out.c('GET', `/api/exchanges/${ex}/workspace`)).status, 404);
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/milestones`, { title: '' })).status, 400);
  const m1 = (await a.c('POST', `/api/exchanges/${ex}/milestones`, { title: 'Basics' })).body;
  await b.c('POST', `/api/exchanges/${ex}/milestones`, { title: 'Project' });
  assert.equal(m1.progress.total, 1);
  const id1 = m1.milestones[0].id;
  assert.equal((await a.c('PATCH', `/api/exchanges/${ex}/milestones/${id1}`, { status: 'finished' })).status, 400);
  const upd = (await b.c('PATCH', `/api/exchanges/${ex}/milestones/${id1}`, { status: 'done' })).body;
  assert.equal(upd.progress.percent, 50);
  assert.equal((await a.c('GET', '/api/notifications')).body.items.some((n) => n.type === 'milestone'), true);
  // IDOR: a milestone of ANOTHER swap cannot be changed through this swap's URL
  const foreign = (await other.a.c('POST', `/api/exchanges/${other.ex}/milestones`, { title: 'Secret' })).body.milestones[0].id;
  assert.equal((await a.c('PATCH', `/api/exchanges/${ex}/milestones/${foreign}`, { status: 'done' })).status, 404);
  assert.equal((await a.c('DELETE', `/api/exchanges/${ex}/milestones/${foreign}`)).status, 404);
  assert.equal((await pool.query('SELECT status FROM milestones WHERE id=$1', [foreign])).rows[0].status, 'todo');
  // goals + notes
  const w = (await a.c('PUT', `/api/exchanges/${ex}/workspace`, { objective: 'Learn loops', notes: 'Week 1' })).body;
  assert.equal(w.objective, 'Learn loops');
  assert.equal((await a.c('PUT', `/api/exchanges/${ex}/workspace`, { objective: 'x'.repeat(301), notes: '' })).status, 400);
  assert.equal((await out.c('PUT', `/api/exchanges/${ex}/workspace`, { objective: 'hack', notes: '' })).status, 404);
  // delete + limit of 20
  assert.equal((await a.c('DELETE', `/api/exchanges/${ex}/milestones/${id1}`)).body.progress.total, 1);
  for (let i = 0; i < 19; i++) await a.c('POST', `/api/exchanges/${ex}/milestones`, { title: `t${i}` });
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/milestones`, { title: 'one too many' })).status, 409);
  // finished -> read-only
  await a.c('PATCH', `/api/exchanges/${ex}`, { action: 'complete' });
  assert.equal((await a.c('POST', `/api/exchanges/${ex}/milestones`, { title: 'late' })).status, 409);
  assert.equal((await a.c('GET', `/api/exchanges/${ex}/workspace`)).status, 200);
});

test('availability: validation, replace-all, time zones and shared free time', async () => {
  const a = await newUser('av'); const b = await newUser('avb');
  const bad = (slots, tz) => a.c('PUT', '/api/me/availability', { slots, time_zone: tz });
  assert.equal((await bad([{ weekday: 7, start: '10:00', end: '11:00' }])).status, 400);
  assert.equal((await bad([{ weekday: 1, start: '11:00', end: '10:00' }])).status, 400);
  assert.equal((await bad([{ weekday: 1, start: '25:00', end: '26:00' }])).status, 400);
  assert.equal((await bad([{ weekday: 1, start: '10:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }])).status, 400); // overlap
  assert.equal((await bad([], 'Mars/Phobos')).status, 400);
  const ok = await bad([{ weekday: 0, start: '18:00', end: '20:00' }, { weekday: 2, start: '09:00', end: '10:00' }], 'Asia/Tashkent');
  assert.equal(ok.status, 200); assert.equal(ok.body.slots.length, 2);
  assert.equal((await bad([{ weekday: 4, start: '10:00', end: '11:00' }])).body.slots.length, 1);               // replaced, not added
  // same wall-clock time in two zones = no overlap; shifted by the zone difference = overlap
  await a.c('PUT', '/api/me/availability', { time_zone: 'Asia/Tashkent', slots: [{ weekday: 0, start: '18:00', end: '20:00' }] });
  await b.c('PUT', '/api/me/availability', { time_zone: 'Asia/Seoul', slots: [{ weekday: 0, start: '22:00', end: '23:30' }] });  // Seoul is +4h vs Tashkent
  const sh = (await a.c('GET', `/api/members/${b.id}/availability`)).body;
  assert.deepEqual(sh.shared, [{ weekday: 0, start: '18:00', end: '19:30' }]);
  assert.equal(sh.my_time_zone, 'Asia/Tashkent');
  assert.equal((await a.c('GET', '/api/members/999999/availability')).status, 404);
});

test('availability maths (pure functions)', () => {
  assert.equal(offsetMinutes('UTC'), 0); assert.equal(offsetMinutes('Asia/Tashkent'), 300);
  assert.throws(() => cleanSlots('nope'));
  // a slot after midnight in Seoul lands on the previous evening in Tashkent
  const s = sharedSlots([{ weekday: 1, start: '00:00', end: '23:59' }], 'Asia/Tashkent', [{ weekday: 2, start: '01:00', end: '02:00' }], 'Asia/Seoul');
  assert.deepEqual(s, [{ weekday: 1, start: '21:00', end: '22:00' }]);
  assert.deepEqual(sharedSlots([], 'UTC', [{ weekday: 0, start: '10:00', end: '11:00' }], 'UTC'), []);
});
