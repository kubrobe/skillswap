// @username, phone, richer profile and the contact-privacy rule. Run: npm test
// The first three tests are pure unit tests (no database); the rest go through the real API.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');
const { applyMigrations } = await import('../src/migrations.js');
const { cleanUsername, usernameProblem, cleanPhone, cleanTelegramUsername } = await import('../src/validate.js');
const { canSeeContacts } = await import('../src/profiles.js');
const { bookedTelegramText } = await import('../src/mobile.js');
await applyMigrations();

const server = app.listen(0);
const root = `http://localhost:${server.address().port}`;
test.after(async () => { server.close(); await pool.end(); });

async function call(method, url, token, body) {
  const res = await fetch(root + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const stamp = Date.now().toString(36);
let n = 0;
async function newUser(extras) {
  n += 1;
  const r = await call('POST', '/api/mobile/register', null, { fullName: `Profile ${n}`, email: `prof${n}_${stamp}@test.uz`, password: 'password123' });
  assert.equal(r.status, 201);
  if (extras) assert.equal((await call('POST', '/api/mobile/me', r.body.token, extras)).status, 200);
  return r.body;
}
const uname = (label) => `${label}_${stamp}`.slice(0, 20);
// how `viewer` sees `owner` in the app's sync
const seenBy = async (viewer, owner) => (await call('GET', '/api/mobile/sync', viewer.token)).body.users.find((u) => u.id === owner.user.id);
async function teacherWithSlot(extras) {
  const t = await newUser(extras);
  const sync = (await call('GET', '/api/mobile/sync', t.token)).body;
  const pub = await call('POST', '/api/mobile/offers', t.token, { skillId: sync.skills[n % sync.skills.length].id, level: 'Beginner', description: 'Privacy test', slots: [{ day: 2, hour: 7 }] });
  assert.equal(pub.status, 201);
  const slot = (await call('GET', '/api/mobile/sync', t.token)).body.slots.find((s) => s.offerId === pub.body.offerId);
  return { teacher: t, slot, offerId: pub.body.offerId };
}

// ---------- unit tests ----------
test('username validation: 3-20 chars, a-z 0-9 _, starts with a letter, lower-cased, reserved names refused', () => {
  assert.equal(cleanUsername('aziza'), 'aziza');
  assert.equal(cleanUsername('  @Aziza_01 '), 'aziza_01', 'trimmed, "@" removed, stored in lower case');
  assert.equal(cleanUsername('abc'), 'abc', '3 characters is the minimum');
  assert.equal(cleanUsername('a2345678901234567890'), 'a2345678901234567890', '20 characters is the maximum');
  for (const bad of ['', 'ab', 'a23456789012345678901', '1aziza', '_aziza', 'azi za', 'aziza!', 'azi-za', 'азиза', 'aziza.k']) {
    assert.throws(() => cleanUsername(bad), { status: 400 }, `"${bad}" must be refused`);
  }
  for (const reserved of ['admin', 'skillswap', 'support', 'Admin', '@SUPPORT']) {
    assert.throws(() => cleanUsername(reserved), /reserved/, `"${reserved}" is reserved`);
  }
  assert.match(usernameProblem('ab'), /at least 3/);
  assert.match(usernameProblem('9lives'), /start with a letter/);
  assert.match(usernameProblem('bad-name'), /letters a-z, digits and _/);
  assert.equal(usernameProblem('good_name1'), null);
});

test('phone validation: E.164 (+ and 8-15 digits); spaces and dashes are removed; empty means "no phone"', () => {
  assert.equal(cleanPhone('+998901234567'), '+998901234567');
  assert.equal(cleanPhone('+998 90 123-45-67'), '+998901234567');
  assert.equal(cleanPhone('+998 (90) 123 45 67'), '+998901234567');
  assert.equal(cleanPhone(''), null);
  assert.equal(cleanPhone('   '), null);
  for (const bad of ['998901234567', '901234567', '+0998901234567', '+99890', '+9989012345678901', '+99890abc4567', 'call me']) {
    assert.throws(() => cleanPhone(bad), { status: 400 }, `"${bad}" must be refused`);
  }
  assert.equal(cleanTelegramUsername('@Aziza_K'), 'Aziza_K');
  assert.equal(cleanTelegramUsername('https://t.me/aziza_k'), 'aziza_k');
  assert.equal(cleanTelegramUsername(''), null);
  assert.throws(() => cleanTelegramUsername('a b'), { status: 400 });
});

test('contact-visibility rule: all 3 settings x booked / not booked (and perfect match, and the owner)', () => {
  const see = (visibility, sharesBooking, mutualMatch = false) => canSeeContacts({ visibility, sharesBooking, mutualMatch });
  // setting      booked   -> visible?
  assert.equal(see('everyone', false), true);
  assert.equal(see('everyone', true), true);
  assert.equal(see('matches', false), false);
  assert.equal(see('matches', true), true);
  assert.equal(see('nobody', false), false);
  assert.equal(see('nobody', true), false);
  // a two-way "perfect match" counts like a booking, but only for 'matches'
  assert.equal(see('matches', false, true), true);
  assert.equal(see('nobody', false, true), false);
  // I always see my own contacts; an unknown setting hides them
  assert.equal(canSeeContacts({ visibility: 'nobody', isOwner: true }), true);
  assert.equal(see(undefined, true, true), false);
  assert.equal(see('friends', true, true), false);
});

// ---------- through the API ----------
test('profile: new fields are saved, invalid username / phone get a clear message, a username is unique', async () => {
  const a = await newUser();
  assert.equal(a.user.username, '', 'a new account has no username yet (the app asks for one)');
  const name = uname('ann');
  const ok = await call('PATCH', '/api/mobile/me', a.token, {
    fullName: 'Ann Tester', bio: 'hi', username: `@${name.toUpperCase()}`, telegramUsername: '@ann_tg', phone: '+998 90 123 45 67',
    faculty: 'IT-Business', studyYear: 3, languages: ['Uzbek', 'English', 'english', ' Korean '], contactVisibility: 'everyone',
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    { ...ok.body.user, id: 0, email: '' },
    { id: 0, fullName: 'Ann Tester', email: '', bio: 'hi', username: name, faculty: 'IT-Business', studyYear: 3,
      languages: ['Uzbek', 'English', 'Korean'], telegramUsername: 'ann_tg', phone: '+998901234567', contactsHidden: false, contactVisibility: 'everyone' });

  for (const [body, message] of [
    [{ username: 'ab' }, /at least 3/], [{ username: '1abc' }, /start with a letter/], [{ username: 'admin' }, /reserved/],
    [{ phone: '901234567' }, /country code/], [{ phone: '+99890' }, /8 to 15 digits/],
    [{ studyYear: 5 }, /1, 2, 3 or 4/], [{ contactVisibility: 'friends' }, /everyone, matches, nobody/],
  ]) {
    const r = await call('POST', '/api/mobile/me', a.token, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, message);
  }
  const b = await newUser();
  const taken = await call('POST', '/api/mobile/me', b.token, { username: name.toUpperCase() });
  assert.equal(taken.status, 409, 'unique, and not case-sensitive');
  assert.match(taken.body.error, /already taken/);

  // an older app that only sends name + bio changes nothing else
  assert.equal((await call('POST', '/api/mobile/me', a.token, { fullName: 'Ann T', bio: 'new bio' })).status, 200);
  const me = (await call('GET', '/api/mobile/sync', a.token)).body.user;
  assert.equal(me.username, name);
  assert.equal(me.phone, '+998901234567');
  assert.equal(me.bio, 'new bio');
});

test('username-available: rules first, then the database; my own username counts as free', async () => {
  const a = await newUser({ username: uname('avail') });
  const b = await newUser();
  const ask = async (u, who = b) => (await call('GET', `/api/users/username-available?u=${encodeURIComponent(u)}`, who.token)).body;
  assert.equal((await call('GET', '/api/users/username-available?u=x')).status, 401, 'login needed');
  assert.deepEqual(await ask(`@${uname('avail').toUpperCase()}`), { username: uname('avail'), available: false, reason: 'That username is already taken' });
  assert.equal((await ask(uname('avail'), a)).available, true);
  assert.equal((await ask(uname('free'))).available, true);
  assert.match((await ask('ab')).reason, /at least 3/);
  assert.match((await ask('support')).reason, /reserved/);
  assert.equal((await call('GET', `/api/mobile/users/username-available?u=${uname('free')}`, b.token)).body.available, true, 'the app uses /api/mobile/...');
});

test('privacy "matches" (the default): a stranger gets null contacts; booking shows them; cancelling hides them again', async () => {
  const { teacher, slot } = await teacherWithSlot({ username: uname('teach'), telegramUsername: 'teach_tg', phone: '+998901112233' });
  const learner = await newUser({ telegramUsername: 'learner_tg', phone: '+998907778899' });

  const before = await seenBy(learner, teacher);
  assert.deepEqual([before.telegramUsername, before.phone, before.contactsHidden], [null, null, true]);
  assert.equal(before.username, uname('teach'), 'the @username itself is public');
  assert.equal(before.contactVisibility, null, 'someone else\'s setting is not sent');
  const profile = (await call('GET', `/api/users/by-username/${uname('teach')}`, learner.token)).body;
  assert.deepEqual([profile.telegramUsername, profile.phone, profile.contactsHidden], [null, null, true]);
  const web = (await call('GET', `/api/members/${teacher.user.id}`, learner.token)).body;
  assert.deepEqual([web.telegram_username, web.phone, web.contacts_hidden], [null, null, true]);

  const booked = await call('POST', '/api/mobile/bookings', learner.token, { slotId: slot.id });
  assert.equal(booked.status, 201);
  const after = await seenBy(learner, teacher);
  assert.deepEqual([after.telegramUsername, after.phone, after.contactsHidden], ['teach_tg', '+998901112233', false]);
  const back = await seenBy(teacher, learner);
  assert.deepEqual([back.telegramUsername, back.phone, back.contactsHidden], ['learner_tg', '+998907778899', false], 'it works both ways');
  const web2 = (await call('GET', `/api/members/${teacher.user.id}`, learner.token)).body;
  assert.deepEqual([web2.telegram_username, web2.phone, web2.contacts_hidden], ['teach_tg', '+998901112233', false]);
  const outsider = await newUser();
  assert.equal((await seenBy(outsider, teacher)).contactsHidden, true, 'a third person still sees nothing');

  assert.equal((await call('POST', `/api/mobile/bookings/${booked.body.bookingId}/cancel`, learner.token)).status, 200);
  const cancelled = await seenBy(learner, teacher);
  assert.deepEqual([cancelled.telegramUsername, cancelled.phone, cancelled.contactsHidden], [null, null, true], 'a cancelled booking does not count');
});

test('privacy "everyone" shows contacts to a stranger; "nobody" hides them even after a booking; I always see my own', async () => {
  const open = await teacherWithSlot({ telegramUsername: 'open_tg', phone: '+998900000001', contactVisibility: 'everyone' });
  const closed = await teacherWithSlot({ telegramUsername: 'closed_tg', phone: '+998900000002', contactVisibility: 'nobody' });
  const learner = await newUser();
  const o = await seenBy(learner, open.teacher);
  assert.deepEqual([o.telegramUsername, o.phone, o.contactsHidden], ['open_tg', '+998900000001', false]);
  assert.equal((await seenBy(learner, closed.teacher)).contactsHidden, true);
  assert.equal((await call('POST', '/api/mobile/bookings', learner.token, { slotId: closed.slot.id })).status, 201);
  const c = await seenBy(learner, closed.teacher);
  assert.deepEqual([c.telegramUsername, c.phone, c.contactsHidden], [null, null, true]);
  const mine = (await call('GET', '/api/mobile/sync', closed.teacher.token)).body.user;
  assert.deepEqual([mine.telegramUsername, mine.phone, mine.contactsHidden, mine.contactVisibility], ['closed_tg', '+998900000002', false, 'nobody']);
});

test('privacy "matches": a two-way perfect match sees contacts without a booking; a one-way wish does not', async () => {
  const a = await teacherWithSlot({ telegramUsername: 'match_a', phone: '+998900000003' });
  const b = await teacherWithSlot({ telegramUsername: 'match_b' });
  const skillOf = async (offerId) => (await pool.query('SELECT skill_id FROM user_offers WHERE id = $1', [offerId])).rows[0].skill_id;
  // b wants what a teaches: one-way only
  assert.equal((await call('POST', '/api/mobile/wants', b.teacher.token, { skillIds: [await skillOf(a.offerId)] })).status, 200);
  assert.equal((await seenBy(b.teacher, a.teacher)).contactsHidden, true);
  // a also wants what b teaches: now it is a perfect match
  assert.equal((await call('POST', '/api/mobile/wants', a.teacher.token, { skillIds: [await skillOf(b.offerId)] })).status, 200);
  const seen = await seenBy(b.teacher, a.teacher);
  assert.deepEqual([seen.telegramUsername, seen.phone, seen.contactsHidden], ['match_a', '+998900000003', false]);
  assert.equal((await seenBy(a.teacher, b.teacher)).telegramUsername, 'match_b');
});

test('by-username returns the public profile (404 for an unknown name); the website search also finds "@username"', async () => {
  const name = uname('finder');
  const { teacher } = await teacherWithSlot({ username: name, faculty: 'Design', studyYear: 2, languages: ['Russian'] });
  const viewer = await newUser();
  const p = await call('GET', `/api/users/by-username/@${name.toUpperCase()}`, viewer.token);
  assert.equal(p.status, 200);
  assert.deepEqual([p.body.id, p.body.username, p.body.faculty, p.body.studyYear, p.body.languages], [teacher.user.id, name, 'Design', 2, ['Russian']]);
  assert.equal(p.body.offers.length, 1);
  assert.equal((await call('GET', `/api/users/by-username/${uname('nobody')}`, viewer.token)).status, 404);
  assert.equal((await call('GET', `/api/users/by-username/${name}`)).status, 401);

  const found = await call('GET', `/api/members?q=${encodeURIComponent('@' + name)}`, viewer.token);
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map((m) => m.id), [teacher.user.id]);
  assert.equal(found.body[0].username, name);
  assert.equal((await call('GET', `/api/members?q=${name.slice(2, 12)}`, viewer.token)).body.some((m) => m.id === teacher.user.id), true, 'part of the username is enough');
});

test('website profile: the same fields from the same database (snake_case), with the same checks', async () => {
  const a = await newUser();
  const name = uname('web');
  const put = await call('PUT', '/api/me/profile', a.token, {
    display_name: 'Web Tester', city: 'Tashkent', bio: '', username: name, telegram_username: 'web_tg', phone: '+998901231231',
    faculty: 'Business', study_year: 4, languages: 'Uzbek, English', contact_visibility: 'nobody',
  });
  assert.equal(put.status, 200);
  const got = (await call('GET', '/api/me/profile', a.token)).body;
  assert.deepEqual(
    [got.username, got.telegram_username, got.phone, got.faculty, got.study_year, got.languages, got.contact_visibility],
    [name, 'web_tg', '+998901231231', 'Business', 4, ['Uzbek', 'English'], 'nobody']);
  const app = (await call('GET', '/api/mobile/sync', a.token)).body.user;
  assert.deepEqual([app.username, app.faculty, app.studyYear, app.contactVisibility], [name, 'Business', 4, 'nobody'], 'the app reads the same row');
  const bad = await call('PUT', '/api/me/profile', a.token, { display_name: 'Web Tester', city: '', bio: '', phone: '12345' });
  assert.equal(bad.status, 400);
});

test('booking alert for Telegram: "@learner booked your <skill> lesson on <date>" with a chat link unless the learner chose "nobody"', () => {
  const info = { learner: 'Bobur', learner_username: 'bobur_r', learner_telegram: 'bobur_tg', learner_visibility: 'matches', skill: 'Python basics', when: 'Mon 18:00' };
  assert.equal(bookedTelegramText(info), '📚 @bobur_r booked your Python basics lesson on Mon 18:00. Tap to chat: t.me/bobur_tg');
  assert.equal(bookedTelegramText({ ...info, learner_visibility: 'nobody' }), '📚 @bobur_r booked your Python basics lesson on Mon 18:00.');
  assert.equal(bookedTelegramText({ ...info, learner_username: null, learner_telegram: null }), '📚 Bobur booked your Python basics lesson on Mon 18:00.');
});
