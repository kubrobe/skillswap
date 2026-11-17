// Tests for native video rooms (src/rooms.js): access rules, the signalling relay and the room lifecycle.
// They use real SSE streams against the real server and database. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.TURN_KEY_ID;            // tests never call Cloudflare
const { default: app } = await import('../server.js');
const { pool } = await import('../src/db.js');
const { roomConfig, cleanSignal, iceServers, resetRoomsForTests } = await import('../src/rooms.js');

// short timers so disconnect / empty-room behaviour can be tested in milliseconds
roomConfig.graceMs = 250;
roomConfig.emptyMs = 400;

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api/mobile`;
const open = new Set();
test.after(async () => {
  for (const s of open) s.close();
  resetRoomsForTests();
  server.close();
  await pool.end();
});

async function call(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** An SSE stream like the phone's: next(type) waits for the next event of that type. */
async function stream(url, token) {
  const ctrl = new AbortController();
  const res = await fetch(base + url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
  if (res.status !== 200) return { status: res.status, body: await res.json().catch(() => null) };
  const queue = [];
  const waiters = [];
  let ended = false;
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (type) { queue.push({ type, data: JSON.parse(data) }); waiters.splice(0).forEach((w) => w()); }
        }
      }
    } catch { /* aborted */ }
    ended = true;
    waiters.splice(0).forEach((w) => w());
  })();
  const s = {
    status: 200,
    get ended() { return ended; },
    async next(type, ms = 2000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const k = queue.findIndex((e) => e.type === type);
        if (k >= 0) return queue.splice(k, 1)[0].data;
        if (ended) throw new Error(`stream ended before "${type}"`);
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no "${type}" event within ${ms} ms`);
        await new Promise((r) => { waiters.push(r); setTimeout(r, left); });
      }
    },
    has: (type) => queue.some((e) => e.type === type),
    close() { ctrl.abort(); open.delete(s); },
  };
  open.add(s);
  return s;
}

const stamp = Date.now();
let n = 0;
async function newPhoneUser() {
  const r = await call('POST', '/register', null, { fullName: `Room Tester${++n}`, email: `room${n}_${stamp}@test.uz`, password: 'password123' });
  assert.equal(r.status, 201);
  return r.body;
}

/** A fresh teacher + learner with one BOOKED lesson between them. */
async function bookedLesson() {
  const teacher = await newPhoneUser();
  const learner = await newPhoneUser();
  const sync = await call('GET', '/sync', teacher.token);
  const pub = await call('POST', '/offers', teacher.token, {
    skillId: sync.body.skills[n % sync.body.skills.length].id, level: 'Beginner', description: 'Video test lesson',
    slots: [{ day: 2, hour: 10 + (n % 8) }],
  });
  assert.equal(pub.status, 201);
  const slot = (await call('GET', '/sync', teacher.token)).body.slots.find((s) => s.offerId === pub.body.offerId);
  const book = await call('POST', '/bookings', learner.token, { slotId: slot.id });
  assert.equal(book.status, 201);
  return { teacher, learner, bookingId: book.body.bookingId };
}

const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

test('only the learner and the teacher can open a lesson\'s room, and both get the same room', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const stranger = await newPhoneUser();
  assert.equal((await call('POST', `/bookings/${bookingId}/room`, stranger.token)).status, 404);
  assert.equal((await call('POST', `/bookings/${bookingId}/room`)).status, 401);

  const [a, b] = await Promise.all([
    call('POST', `/bookings/${bookingId}/room`, learner.token),
    call('POST', `/bookings/${bookingId}/room`, teacher.token),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);   // one created it, the other joined it
  assert.equal(a.body.roomId, b.body.roomId);
  assert.match(a.body.roomId, /^[0-9a-f-]{36}$/);
  assert.equal(a.body.you.role, 'learner');
  assert.equal(b.body.you.role, 'teacher');
  assert.ok(a.body.iceServers.length >= 1);
  assert.equal(a.body.turn, false);
  const active = await pool.query("SELECT count(*)::int AS n FROM video_rooms WHERE booking_id = $1 AND status = 'ACTIVE'", [bookingId]);
  assert.equal(active.rows[0].n, 1);

  // a stranger cannot join the stream either, and cannot tell the room exists
  assert.equal((await stream(`/rooms/${a.body.roomId}/events`, stranger.token)).status, 404);
  assert.equal((await stream('/rooms/not-a-room/events', learner.token)).status, 404);
});

test('joining: the waiting person is told when the other one arrives, and the other is invited', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const main = await stream('/events', teacher.token);        // the teacher's normal app stream
  await main.next('hello');
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);

  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  const state = await l.next('room-state');
  assert.equal(state.you.userId, learner.user.id);
  assert.equal(state.participants.find((p) => p.role === 'teacher').online, false);

  // the teacher's app hears "Room Tester is waiting" and the lesson card gets "who is online"
  const notice = await main.next('notice');
  assert.match(notice.text, /waiting for you in the .* video lesson/);
  const presence = await main.next('room');
  assert.deepEqual(presence.online, [learner.user.id]);

  const t = await stream(`/rooms/${room.roomId}/events`, teacher.token);
  const tState = await t.next('room-state');
  assert.equal(tState.participants.find((p) => p.role === 'learner').online, true);
  const joined = await l.next('peer-joined');                 // the learner was first, so the learner makes the offer
  assert.equal(joined.userId, teacher.user.id);
  assert.equal(joined.resumed, false);

  const sync = await call('GET', '/sync', learner.token);
  const r = sync.body.rooms.find((x) => x.bookingId === bookingId);
  assert.equal(r.roomId, room.roomId);
  assert.deepEqual(r.online.sort(), [learner.user.id, teacher.user.id].sort());
  l.close(); t.close(); main.close();
});

test('signals reach only the person they are addressed to, and bad ones are refused', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const stranger = await newPhoneUser();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const url = `/rooms/${room.roomId}/signal`;

  // you must be connected to send
  assert.equal((await call('POST', url, learner.token, { id: 'x1', to: teacher.user.id, type: 'offer', payload: { sdp } })).status, 409);
  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  // the other person is not here yet
  assert.equal((await call('POST', url, learner.token, { id: 'x2', to: teacher.user.id, type: 'offer', payload: { sdp } })).status, 409);
  const t = await stream(`/rooms/${room.roomId}/events`, teacher.token);
  await t.next('room-state');
  await l.next('peer-joined');

  const ok = await call('POST', url, learner.token, { id: 'm1', to: teacher.user.id, type: 'offer', payload: { sdp } });
  assert.equal(ok.status, 200);
  const got = await t.next('signal');
  assert.deepEqual(got, { id: 'm1', from: learner.user.id, type: 'offer', payload: { sdp } });

  const cand = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  assert.equal((await call('POST', url, teacher.token, { id: 'm2', to: learner.user.id, type: 'candidate', payload: cand })).status, 200);
  assert.deepEqual((await l.next('signal')).payload, cand);

  // refused: outsiders, unknown types, myself as receiver, a stranger as receiver, oversized SDP
  assert.equal((await call('POST', url, stranger.token, { id: 'b1', to: learner.user.id, type: 'offer', payload: { sdp } })).status, 404);
  assert.equal((await call('POST', url, learner.token, { id: 'b2', to: teacher.user.id, type: 'chat', payload: {} })).status, 400);
  assert.equal((await call('POST', url, learner.token, { id: 'b3', to: learner.user.id, type: 'bye' })).status, 400);
  assert.equal((await call('POST', url, learner.token, { id: 'b4', to: stranger.user.id, type: 'bye' })).status, 400);
  assert.equal((await call('POST', url, learner.token, { id: 'b5', to: teacher.user.id, type: 'offer', payload: { sdp: 'x'.repeat(16_001) } })).status, 400);
  assert.equal(t.has('signal'), false);                        // none of them reached the teacher
  l.close(); t.close();
});

test('a dropped stream gets a grace period; coming back in time is a "resume", not a "leave"', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const t = await stream(`/rooms/${room.roomId}/events`, teacher.token);
  await t.next('room-state');
  let l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  await t.next('peer-joined');

  l.close();                                                   // e.g. Wi-Fi -> mobile data
  await new Promise((r) => setTimeout(r, 80));
  l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  const back = await t.next('peer-joined');
  assert.equal(back.resumed, true);
  await new Promise((r) => setTimeout(r, roomConfig.graceMs + 100));
  assert.equal(t.has('peer-left'), false);

  l.close();                                                   // now really gone
  const left = await t.next('peer-left', roomConfig.graceMs + 1000);
  assert.deepEqual(left, { userId: learner.user.id, reason: 'disconnected' });
  t.close();
});

test('a second stream for the same person replaces the first one', async () => {
  const { learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const first = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await first.next('room-state');
  const second = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await second.next('room-state');
  assert.equal((await first.next('room-ended')).reason, 'superseded');
  second.close();
});

test('leaving: the other person is told; when the last one leaves the room ends', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  const t = await stream(`/rooms/${room.roomId}/events`, teacher.token);
  await t.next('room-state');

  assert.equal((await call('POST', `/rooms/${room.roomId}/leave`, learner.token)).status, 200);
  assert.deepEqual(await t.next('peer-left'), { userId: learner.user.id, reason: 'left' });
  assert.equal((await call('POST', `/rooms/${room.roomId}/leave`, teacher.token)).status, 200);
  const row = await pool.query('SELECT status, end_reason FROM video_rooms WHERE id = $1', [room.roomId]);
  assert.deepEqual(row.rows[0], { status: 'ENDED', end_reason: 'empty' });

  // opening the lesson again gives a NEW room
  const again = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  assert.equal(again.status, 201);
  assert.notEqual(again.body.roomId, room.roomId);
});

test('ending the call closes it for both, and an empty room closes by itself', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  const t = await stream(`/rooms/${room.roomId}/events`, teacher.token);
  await t.next('room-state');
  assert.equal((await call('POST', `/rooms/${room.roomId}/end`, teacher.token)).status, 200);
  assert.deepEqual(await l.next('room-ended'), { reason: 'ended_by_user', by: teacher.user.id });
  const joinEnded = await stream(`/rooms/${room.roomId}/events`, learner.token);
  assert.equal(joinEnded.status, 410);

  // nobody connects to a new room: it ends after the empty timeout
  const { body: r2 } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const s = await stream(`/rooms/${r2.roomId}/events`, learner.token);
  await s.next('room-state');
  s.close();
  await new Promise((r) => setTimeout(r, roomConfig.graceMs + roomConfig.emptyMs + 200));
  const row = await pool.query('SELECT status, end_reason FROM video_rooms WHERE id = $1', [r2.roomId]);
  assert.deepEqual(row.rows[0], { status: 'ENDED', end_reason: 'empty' });
});

test('cancelling the lesson closes its room; an expired room cannot be joined', async () => {
  const { teacher, learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  assert.equal((await call('POST', `/bookings/${bookingId}/cancel`, teacher.token)).status, 200);
  assert.equal((await l.next('room-ended')).reason, 'booking_cancelled');
  assert.equal((await call('POST', `/bookings/${bookingId}/room`, learner.token)).status, 409);

  const other = await bookedLesson();
  const { body: r2 } = await call('POST', `/bookings/${other.bookingId}/room`, other.learner.token);
  await pool.query("UPDATE video_rooms SET expires_at = now() - interval '1 minute' WHERE id = $1", [r2.roomId]);
  const late = await stream(`/rooms/${r2.roomId}/events`, other.learner.token);
  assert.equal(late.status, 410);
  assert.match(late.body.error, /expired/);
  const row = await pool.query('SELECT end_reason FROM video_rooms WHERE id = $1', [r2.roomId]);
  assert.equal(row.rows[0].end_reason, 'expired');
});

test('checking in to the lesson closes its room', async () => {
  const { learner, bookingId } = await bookedLesson();
  const { body: room } = await call('POST', `/bookings/${bookingId}/room`, learner.token);
  const l = await stream(`/rooms/${room.roomId}/events`, learner.token);
  await l.next('room-state');
  const code = (await pool.query('SELECT checkin_code FROM slot_bookings WHERE id = $1', [bookingId])).rows[0].checkin_code;
  assert.equal((await call('POST', `/bookings/${bookingId}/complete`, learner.token, { code })).status, 200);
  assert.equal((await l.next('room-ended')).reason, 'booking_done');
});

test('cleanSignal keeps only known fields of known types', () => {
  assert.deepEqual(cleanSignal({ id: 'a', to: 5, type: 'media', payload: { audio: false, video: true, extra: 1 } }),
    { id: 'a', to: 5, type: 'media', payload: { audio: false, video: true } });
  // "Demonstrate": the screen flag passes through, only as true
  assert.deepEqual(cleanSignal({ id: 'b', to: 5, type: 'media', payload: { audio: true, video: true, screen: true } }).payload,
    { audio: true, video: true, screen: true });
  assert.deepEqual(cleanSignal({ id: 'c', to: 5, type: 'media', payload: { audio: true, video: true, screen: 'yes' } }).payload,
    { audio: true, video: true });
  assert.deepEqual(cleanSignal({ id: 'a', to: '7', type: 'answer', payload: { sdp: 'v=0', evil: '<x>' } }),
    { id: 'a', to: 7, type: 'answer', payload: { sdp: 'v=0' } });
  assert.deepEqual(cleanSignal({ id: 'a', to: 7, type: 'offer', payload: { sdp: 'v=0', iceRestart: true } }).payload,
    { sdp: 'v=0', iceRestart: true });
  assert.deepEqual(cleanSignal({ id: 'a', to: 7, type: 'bye', payload: { x: 1 } }).payload, {});
  assert.deepEqual(cleanSignal({ id: 'a', to: 7, type: 'renegotiate' }).payload, {});
  for (const bad of [
    {}, { id: 'a', to: 1, type: 'hack' }, { id: 'a', to: 0, type: 'bye' }, { id: '', to: 1, type: 'bye' },
    { id: 'a', to: 1, type: 'candidate', payload: { candidate: 'c', sdpMLineIndex: -1 } },
    { id: 'a', to: 1, type: 'candidate', payload: { candidate: '', sdpMLineIndex: 0 } },
    { id: 'a', to: 1, type: 'media', payload: { audio: 'yes', video: true } },
    { id: 'x'.repeat(65), to: 1, type: 'bye' },
  ]) assert.throws(() => cleanSignal(bad), /./, JSON.stringify(bad));
});

test('ICE servers: STUN only without a TURN key; temporary TURN credentials with one; STUN if Cloudflare fails', async () => {
  const none = await iceServers({ env: {} });
  assert.equal(none.turn, false);
  assert.ok(none.iceServers.every((s) => s.urls.every((u) => u.startsWith('stun:'))));

  let asked;
  const fake = async (url, init) => {
    asked = { url, init };
    return { ok: true, json: async () => ({ iceServers: { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'u1', credential: 'c1' } }) };
  };
  const withTurn = await iceServers({ env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'secret' }, fetchImpl: fake });
  assert.equal(withTurn.turn, true);
  assert.match(asked.url, /\/turn\/keys\/kid\/credentials\/generate-ice-servers$/);
  assert.equal(asked.init.headers.Authorization, 'Bearer secret');
  assert.ok(JSON.parse(asked.init.body).ttl > 3 * 3600);        // outlives the longest room
  const turn = withTurn.iceServers.find((s) => s.username);
  assert.deepEqual([turn.username, turn.credential], ['u1', 'c1']);
  assert.ok(!JSON.stringify(withTurn).includes('secret'));      // the long-term key never reaches the phone

  const broken = await iceServers({ env: { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'secret' }, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(broken.turn, false);
  assert.ok(broken.iceServers.length >= 1);
});
