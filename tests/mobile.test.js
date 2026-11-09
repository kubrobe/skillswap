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
const codeOf = async (bookingId) =>
  (await pool.query('SELECT checkin_code FROM slot_bookings WHERE id = $1', [bookingId])).rows[0].checkin_code;
const finish = async (bookingId, token) =>
  call('POST', `/bookings/${bookingId}/complete`, token, { code: await codeOf(bookingId) });
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
  assert.equal(r.body.database, 'ready');
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
  assert.equal((await finish(b, learner.token)).status, 200);
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
  assert.equal((await finish(b, learner.token)).status, 200);
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

test('time bank: 5 welcome credits, booking costs 1, cancel refunds, finishing pays the teacher', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const bal = async (u) => (await call('GET', '/sync', u.token)).body.wallet.balance;
  assert.equal(await bal(learner), 5);
  const b1 = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  assert.equal(await bal(learner), 4);
  assert.equal((await call('POST', `/bookings/${b1}/cancel`, learner.token)).status, 200);
  assert.equal(await bal(learner), 5);                                   // refunded
  const b2 = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  const before = await bal(teacher);
  assert.equal((await finish(b2, learner.token)).status, 200);
  assert.equal(await bal(teacher), before + 1);                          // teacher earned
  const history = (await call('GET', '/sync', teacher.token)).body.wallet.history;
  assert.equal(history[0].reason, 'taught');
});

test('no credits left -> booking is refused with 402 and nothing is saved', async () => {
  const { slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  await pool.query("INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, -5, 'booked')", [learner.user.id]);
  const r = await call('POST', '/bookings', learner.token, { slotId: slots[0].id });
  assert.equal(r.status, 402);
  const slot = (await pool.query('SELECT is_booked FROM offer_slots WHERE id=$1', [slots[0].id])).rows[0];
  assert.equal(slot.is_booked, false);                                    // transaction rolled back
});

test('perfect match: they teach what I want AND want what I teach', async () => {
  const a = await teacherWithSlots();                 // a teaches skill A
  const b = await teacherWithSlots();                 // b teaches skill B
  const skillOf = async (offerId) => (await pool.query('SELECT skill_id FROM user_offers WHERE id=$1', [offerId])).rows[0].skill_id;
  const skillA = await skillOf(a.offerId);
  const skillB = await skillOf(b.offerId);
  assert.equal((await call('POST', '/wants', a.teacher.token, { skillIds: [skillB] })).status, 200);
  assert.equal((await call('POST', '/wants', b.teacher.token, { skillIds: [skillA] })).status, 200);
  const sync = (await call('GET', '/sync', a.teacher.token)).body;
  assert.deepEqual(sync.wants, [skillB]);
  const m = sync.matches.find((x) => x.offerId === b.offerId);
  assert.ok(m, 'match found');
  assert.ok(m.theyWant, 'two-way match');
  assert.equal((await call('POST', '/wants', a.teacher.token, { skillIds: 'nope' })).status, 400);
});

test('lesson plan: only for the two people of the lesson, generated once and cached', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const stranger = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[1].id })).body.bookingId;
  assert.equal((await call('POST', `/bookings/${b}/plan`, stranger.token)).status, 404);
  const p1 = await call('POST', `/bookings/${b}/plan`, learner.token);
  assert.equal(p1.status, 200);
  assert.ok(p1.body.plan.includes('min'));
  const p2 = await call('POST', `/bookings/${b}/plan`, teacher.token);
  assert.equal(p2.body.plan, p1.body.plan);                               // same cached plan
});

test('live events: the teacher\'s phone is told at once when someone books', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${teacher.token}` }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const waitFor = async (needle) => {
    const until = Date.now() + 5000;
    while (!text.includes(needle) && Date.now() < until) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    return text.includes(needle);
  };
  assert.ok(await waitFor('event: hello'));
  await call('POST', '/bookings', learner.token, { slotId: slots[0].id });
  assert.ok(await waitFor('event: notice'), 'notice received');
  assert.ok(text.includes('booked your'));
  ctrl.abort();
});

test('check-in: only the teacher sees the code, and a wrong code cannot finish a lesson', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  const forTeacher = (await call('GET', '/sync', teacher.token)).body.bookings.find((x) => x.id === b);
  const forLearner = (await call('GET', '/sync', learner.token)).body.bookings.find((x) => x.id === b);
  assert.match(forTeacher.checkinCode, /^\d{4}$/);
  assert.equal(forLearner.checkinCode, null);
  const wrong = forTeacher.checkinCode === '0000' ? '1111' : '0000';
  assert.equal((await call('POST', `/bookings/${b}/complete`, learner.token, { code: wrong })).status, 403);
  assert.equal((await call('POST', `/bookings/${b}/complete`, learner.token)).status, 403);
  assert.equal((await call('POST', `/bookings/${b}/complete`, learner.token, { code: forTeacher.checkinCode })).status, 200);
});

test('trusted badge: 2 finished lessons with an average of 4.5+', async () => {
  const { teacher, offerId, slots } = await teacherWithSlots();
  const isTrusted = async () => (await call('GET', '/sync', teacher.token)).body.offers.find((o) => o.id === offerId).trusted;
  assert.equal(await isTrusted(), false);
  for (const slot of slots) {
    const l = await newPhoneUser();
    const b = (await call('POST', '/bookings', l.token, { slotId: slot.id })).body.bookingId;
    assert.equal((await finish(b, l.token)).status, 200);
    await call('POST', `/bookings/${b}/review`, l.token, { rating: 5 });
  }
  assert.equal(await isTrusted(), true);
});

test('activity feed: sync has it, and the teacher\'s phone gets a live credit event at check-in', async () => {
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${teacher.token}` }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const waitFor = async (needle) => {
    const until = Date.now() + 5000;
    while (!text.includes(needle) && Date.now() < until) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    return text.includes(needle);
  };
  assert.ok(await waitFor('event: hello'));
  assert.equal((await finish(b, learner.token)).status, 200);
  assert.ok(await waitFor('event: credit'), 'credit event');
  assert.ok(await waitFor('event: activity'), 'activity event');
  ctrl.abort();
  const feed = (await call('GET', '/sync', learner.token)).body.activity;
  assert.ok(Array.isArray(feed) && feed.length > 0);
  assert.ok(feed.some((f) => f.text.includes('taught')));
  assert.ok(!feed.some((f) => f.text.includes(learner.user.fullName)), 'learners stay anonymous');
});

test('impact: public community numbers, 8 weeks of history, and a finished lesson counts at once', async () => {
  const before = await call('GET', '/impact', null);
  assert.equal(before.status, 200);
  const i = before.body;
  assert.equal(i.weekly.length, 8);
  assert.ok(i.members > 0 && i.lessonsDone > 0);
  assert.equal(i.savedUzs, i.lessonsDone * i.tutorPriceUzs);
  assert.match(i.assumption, /Estimate/);
  assert.ok(i.weekly.slice(0, 7).some((w) => w.lessons > 0), 'sample history fills earlier weeks');
  assert.ok(i.topSkills.length > 0 && i.topSkills[0].emoji);

  const { slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const b = (await call('POST', '/bookings', learner.token, { slotId: slots[0].id })).body.bookingId;
  assert.equal((await finish(b, learner.token)).status, 200);
  const after = (await call('GET', '/impact', null)).body;
  assert.equal(after.lessonsDone, i.lessonsDone + 1);
  assert.equal(after.weekly[7].lessons, i.weekly[7].lessons + 1);
});

test('galaxy: login needed, first names only, and a new lesson adds an edge from teacher to learner', async () => {
  assert.equal((await call('GET', '/galaxy', null)).status, 401);
  const { teacher, slots } = await teacherWithSlots();
  const learner = await newPhoneUser();
  const before = (await call('GET', '/galaxy', learner.token)).body;
  assert.ok(before.nodes.some((n) => n.id === learner.user.id), 'I am always in my galaxy');
  assert.ok(before.nodes.every((n) => !('email' in n) && !n.name.includes(' ')), 'first names only');
  assert.ok(before.edges.length > 0, 'the sample history draws lines');
  await call('POST', '/bookings', learner.token, { slotId: slots[0].id });
  const after = (await call('GET', '/galaxy', learner.token)).body;
  const edge = after.edges.find((e) => e.from === teacher.user.id && e.to === learner.user.id);
  assert.ok(edge && edge.lessons === 1, 'new edge teacher -> learner');
  const me = after.nodes.find((n) => n.id === learner.user.id);
  assert.equal(me.learned, 1);
});

test('logout deletes the session on the server', async () => {
  const u = await newPhoneUser();
  assert.equal((await call('POST', '/logout', u.token)).status, 200);
  assert.equal((await call('GET', '/sync', u.token)).status, 401);
});
