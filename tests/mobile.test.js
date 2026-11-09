// Tests for the Android app's API (/api/mobile/*). Run: npm test
// Needs the database from `npm run db:reset` + `npm run db:migrate`.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api/mobile`;
test.after(async () => { server.close(); await pool.end(); });

// A phone has no cookies: it sends the token in the Authorization header.
async function call(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const stamp = Date.now();
let n = 0;
async function newPhoneUser() {
  const r = await call('POST', '/register', null, { fullName: `Phone ${++n}`, email: `phone${n}_${stamp}@test.uz`, password: 'password123' });
  assert.equal(r.status, 201);
  assert.ok(r.body.token.length >= 64);
  return r.body;
}

// A teacher with one fresh offer and two slots, so tests never depend on demo data.
async function teacherWithSlots() {
  const t = await newPhoneUser();
  const sync = await call('GET', '/sync', t.token);
  const mine = new Set(sync.body.offers.filter((o) => o.teacherId === t.user.id).map((o) => o.skillId));
  const skill = sync.body.skills.find((s) => !mine.has(s.id));
  const pub = await call('POST', '/offers', t.token, {
    skillId: skill.id, level: 'Intermediate', description: 'Test lesson',
    slots: [{ day: 3, hour: 9 }, { day: 4, hour: 9 }],
  });
  assert.equal(pub.status, 201);
  const after = await call('GET', '/sync', t.token);
  const slots = after.body.slots.filter((s) => s.offerId === pub.body.offerId);
  return { teacher: t, offerId: pub.body.offerId, slots };
}

test('health check is public and reaches the database', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('login gives a token; sync without a token is refused', async () => {
  const bad = await call('POST', '/login', null, { email: 'aziza@demo.uz', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal((await call('GET', '/sync')).status, 401);
  const u = await newPhoneUser();
  const login = await call('POST', '/login', null, { email: u.user.email, password: 'password123' });
  assert.equal(login.status, 200);
  const sync = await call('GET', '/sync', login.body.token);
  assert.equal(sync.status, 200);
  for (const key of ['users', 'skills', 'offers', 'slots', 'bookings', 'reviews']) assert.ok(Array.isArray(sync.body[key]), key);
});

test('publishing an offer saves the offer and its slots together (and only once per skill)', async () => {
  const { teacher, offerId, slots } = await teacherWithSlots();
  assert.equal(slots.length, 2);
  const skillId = (await pool.query('SELECT skill_id FROM user_offers WHERE id=$1', [offerId])).rows[0].skill_id;
  const again = await call('POST', '/offers', teacher.token, { skillId, level: 'Advanced', description: 'Again', slots: [{ day: 1, hour: 8 }] });
  assert.equal(again.status, 409);
  const bad = await call('POST', '/offers', teacher.token, { skillId, level: 'Expert', description: 'Bad level', slots: [{ day: 1, hour: 8 }] });
  assert.equal(bad.status, 400);
});

test('booking rules: not your own lesson, no double booking, cancel frees the slot', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  assert.equal((await call('POST', '/bookings', teacher.token, { slotId: slots[0].id })).status, 400);  // own lesson

  const ok = await call('POST', '/bookings', learner.token, { slotId: slots[0].id });
  assert.equal(ok.status, 201);
  const other = await newPhoneUser();
  assert.equal((await call('POST', '/bookings', other.token, { slotId: slots[0].id })).status, 409);    // taken

  assert.equal((await call('POST', `/bookings/${ok.body.bookingId}/cancel`, other.token)).status, 404);  // not yours
  assert.equal((await call('POST', `/bookings/${ok.body.bookingId}/cancel`, learner.token)).status, 200);
  const slot = (await pool.query('SELECT is_booked FROM offer_slots WHERE id=$1', [slots[0].id])).rows[0];
  assert.equal(slot.is_booked, false);
  assert.equal((await call('POST', '/bookings', other.token, { slotId: slots[0].id })).status, 201);    // free again
});

test('10 learners tap "Book" on the same slot at the same moment: exactly one wins', async () => {
  const { slots } = await teacherWithSlots();
  const learners = await Promise.all(Array.from({ length: 10 }, () => newPhoneUser()));
  const results = await Promise.all(learners.map((l) => call('POST', '/bookings', l.token, { slotId: slots[1].id })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  const live = await pool.query("SELECT count(*)::int AS n FROM slot_bookings WHERE slot_id=$1 AND status='BOOKED'", [slots[1].id]);
  assert.equal(live.rows[0].n, 1);
});

test('a lesson can be rated once, only after it is done, and the rating reaches the offer', async () => {
  const { offerId, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  assert.equal((await call('POST', `/bookings/${b}/review`, learner.token, { rating: 5 })).status, 409);  // not done yet
  assert.equal((await call('POST', `/bookings/${b}/complete`, learner.token)).status, 200);
  assert.equal((await call('POST', `/bookings/${b}/review`, learner.token, { rating: 9 })).status, 400);
  assert.equal((await call('POST', `/bookings/${b}/review`, learner.token, { rating: 4, comment: 'Good' })).status, 201);
  assert.equal((await call('POST', `/bookings/${b}/review`, learner.token, { rating: 5 })).status, 409);  // only once
  const offer = (await call('GET', '/sync', learner.token)).body.offers.find((o) => o.id === offerId);
  assert.equal(offer.rating, 4);
  assert.equal(offer.reviewCount, 1);
});

test('profile can be edited with POST (Android) and the change is in the next sync', async () => {
  const u = await newPhoneUser();
  const r = await call('POST', '/me', u.token, { fullName: 'Renamed Student', bio: 'Loves chess' });
  assert.equal(r.status, 200);
  const sync = await call('GET', '/sync', u.token);
  assert.equal(sync.body.user.fullName, 'Renamed Student');
  assert.equal(sync.body.user.bio, 'Loves chess');
});

test('finishing a lesson frees the weekly slot again', async () => {
  const { slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  assert.equal((await call('POST', `/bookings/${b}/complete`, learner.token)).status, 200);
  const next = await newPhoneUser();
  assert.equal((await call('POST', '/bookings', next.token, { slotId: slots[0].id })).status, 201);
});

test('the teacher can cancel a booked lesson; a stranger cannot', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const stranger = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[1].id })).body.bookingId;
  assert.equal((await call('POST', `/bookings/${b}/cancel`, stranger.token)).status, 404);
  assert.equal((await call('POST', `/bookings/${b}/complete`, teacher.token)).status, 404);  // only the learner finishes
  assert.equal((await call('POST', `/bookings/${b}/cancel`, teacher.token)).status, 200);
});

test('sync is private: other people\'s bookings and e-mails are not sent', async () => {
  const { slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const outsider = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  const seen = (await call('GET', '/sync', outsider.token)).body;
  assert.equal(seen.bookings.some((x) => x.id === b), false);
  assert.equal(seen.users.some((u) => u.email === learner.user.email), false);
  assert.ok(seen.users.find((u) => u.id === outsider.user.id).email === outsider.user.email);   // own e-mail is there
  const mine = (await call('GET', '/sync', learner.token)).body;
  assert.equal(mine.bookings.some((x) => x.id === b), true);
});

test('logout deletes the session on the server', async () => {
  const u = await newPhoneUser();
  assert.equal((await call('POST', '/logout', u.token)).status, 200);
  assert.equal((await call('GET', '/sync', u.token)).status, 401);
});
