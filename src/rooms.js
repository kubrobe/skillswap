// Native video lessons: room records + the signalling relay for WebRTC.
//
// WebRTC sends audio and video straight between the two phones (encrypted with DTLS-SRTP). Before that can
// happen the phones must swap "connection messages": an SDP offer/answer (codecs, keys) and ICE candidates
// (network addresses). This file is the post office for those messages. It never stores or logs them.
//
// Transport: the same technique as src/live.js. Each phone in a room keeps ONE Server-Sent Events stream open
// (GET /api/mobile/rooms/:id/events) and sends its own messages with small POSTs (/signal). That is plain HTTPS,
// works through Render's proxy and needs no extra library on the server or on the phone.
//
// Rules that keep the call predictable:
// - Members = the learner and the teacher of a BOOKED lesson. Everyone else gets 404 (they cannot tell a room exists).
// - Whoever is ALREADY in the room makes the offer to the newcomer. Joins are handled one at a time by this
//   single Node process, so two people pressing "Join" together can never both make an offer.
// - A dropped stream gets a short grace period before the others hear "peer-left" (a phone switching Wi-Fi -> 4G).
// - A room ends when it is empty, when it is ended, after 3 hours, or when its lesson is cancelled / checked in.
//
// Room presence lives in memory (one server instance on Render). After a restart the database still knows the
// room, and the phones simply connect again; media that was already flowing between them is not interrupted.
import { query, withTransaction } from './db.js';
import { requireAuth } from './auth.js';
import { HttpError, cleanId } from './validate.js';
import { notify, sendEvent } from './live.js';

// Timings. Tests make them shorter; the values here are for real phones.
export const roomConfig = {
  graceMs: 20_000,        // a stream may drop this long before the other person is told "left"
  emptyMs: 120_000,       // an empty room closes after this long
  pingMs: 15_000,         // keep-alive comment through proxies and phone networks
  maxPerMinute: 240,      // signals per person per minute (a call start sends ~30 ICE candidates)
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'media', 'bye', 'renegotiate']);
const MAX_SDP = 16_000;
const MAX_CANDIDATE = 1_000;

const hubs = new Map();   // roomId -> hub (only rooms with someone connected or a timer running)
let nextConnId = 1;

function cleanRoomId(value) {
  const s = String(value || '');
  if (!UUID.test(s)) throw new HttpError(404, 'Room not found');
  return s.toLowerCase();
}

// ---------- ICE servers (STUN + temporary TURN credentials) ----------

// Public STUN servers only tell a phone its public address. They are always included.
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TURN_TTL_SECONDS = 4 * 3600;   // longer than the longest room (3 h); the phone asks again for every room

/**
 * ICE servers for one phone. With TURN_KEY_ID + TURN_KEY_API_TOKEN set (Cloudflare Realtime TURN), the server
 * asks Cloudflare for credentials that expire after a few hours, so the long-term TURN key never leaves the server.
 * TURN relays the media when two phones cannot reach each other directly (common on mobile networks).
 */
export async function iceServers({ fetchImpl = fetch, env = process.env } = {}) {
  const keyId = env.TURN_KEY_ID;
  const token = env.TURN_KEY_API_TOKEN;
  if (!keyId || !token) return { iceServers: STUN, turn: false, ttl: 0 };
  try {
    const res = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    const body = await res.json();
    const list = (Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]).filter(Boolean)
      .map((s) => ({ urls: [].concat(s.urls || []), ...(s.username ? { username: s.username, credential: s.credential } : {}) }))
      .filter((s) => s.urls.length);
    const hasTurn = list.some((s) => s.urls.some((u) => /^turns?:/.test(u)));
    if (!hasTurn) throw new Error('TURN credentials: no turn: urls in the answer');
    return { iceServers: [...STUN, ...list], turn: true, ttl: TURN_TTL_SECONDS };
  } catch (e) {
    // Never fail the call because of TURN: STUN still works on many networks. The phone shows a hint.
    console.error('TURN unavailable:', e.message);
    return { iceServers: STUN, turn: false, ttl: 0 };
  }
}

// ---------- database ----------

// The booking with both members' names (no access check).
async function lessonRow(db, bookingId) {
  const r = await db.query(
    `SELECT b.id, b.status, b.learner_id, o.user_id AS teacher_id, s.name AS skill,
            lp.display_name AS learner_name, tp.display_name AS teacher_name
       FROM slot_bookings b
       JOIN user_offers o ON o.id = b.offer_id
       JOIN skills s      ON s.id = o.skill_id
       JOIN profiles lp   ON lp.user_id = b.learner_id
       JOIN profiles tp   ON tp.user_id = o.user_id
      WHERE b.id = $1`, [bookingId]);
  return r.rows[0] || null;
}

// The same, but only its learner or teacher may see it; everyone else gets 404.
async function lessonFor(db, bookingId, userId) {
  const b = await lessonRow(db, bookingId);
  if (!b || (b.learner_id !== userId && b.teacher_id !== userId)) throw new HttpError(404, 'Lesson not found');
  return b;
}

const membersOf = (b) => [
  { userId: b.teacher_id, name: b.teacher_name, role: 'teacher' },
  { userId: b.learner_id, name: b.learner_name, role: 'learner' },
];

// A room with its lesson, checked for membership. Ended / expired rooms answer 410 with the reason.
async function roomFor(roomId, userId) {
  const r = await query(
    `SELECT id, booking_id, status, end_reason, expires_at, created_at, (expires_at <= now()) AS expired
       FROM video_rooms WHERE id = $1`, [roomId]);
  const room = r.rows[0];
  if (!room) throw new HttpError(404, 'Room not found');
  const lesson = await lessonFor({ query }, room.booking_id, userId);    // 404 for outsiders
  if (room.status === 'ACTIVE' && room.expired) {
    await endRoom(room.id, 'expired');
    throw new HttpError(410, 'This video room has expired. Open the lesson again to start a new one.');
  }
  if (room.status !== 'ACTIVE') throw new HttpError(410, endedText(room.end_reason));
  if (lesson.status !== 'BOOKED') {
    await endRoom(room.id, lesson.status === 'DONE' ? 'booking_done' : 'booking_cancelled');
    throw new HttpError(410, endedText(lesson.status === 'DONE' ? 'booking_done' : 'booking_cancelled'));
  }
  return { room, lesson };
}

function endedText(reason) {
  return {
    expired: 'This video room has expired. Open the lesson again to start a new one.',
    booking_cancelled: 'This lesson was cancelled, so its video room is closed.',
    booking_done: 'This lesson is finished, so its video room is closed.',
  }[reason] || 'This video room has ended.';
}

// ---------- in-memory presence ----------

function hubFor(room, lesson) {
  let hub = hubs.get(room.id);
  if (!hub) {
    hub = {
      id: room.id,
      bookingId: lesson.id,
      skill: lesson.skill,
      members: new Map(membersOf(lesson).map((m) => [m.userId, m])),
      conns: new Map(),        // userId -> { res, connId, ping }
      grace: new Map(),        // userId -> timer
      notified: new Set(),     // "waiting for you" sent once per person per room
      emptyTimer: null,
      expiryTimer: null,
      startedAt: new Date(room.created_at).getTime(),
      expiresAt: new Date(room.expires_at).getTime(),
    };
    const left = hub.expiresAt - Date.now();
    hub.expiryTimer = setTimeout(() => endRoom(hub.id, 'expired').catch(logError), Math.max(0, Math.min(left, 2 ** 31 - 1)));
    hub.expiryTimer.unref?.();
    hubs.set(room.id, hub);
  }
  return hub;
}

const logError = (e) => console.error('video room:', e.message);
const write = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const online = (hub) => [...hub.conns.keys()];

function participants(hub) {
  return [...hub.members.values()].map((m) => ({ ...m, online: hub.conns.has(m.userId) || hub.grace.has(m.userId) }));
}

function toOthers(hub, userId, type, data) {
  for (const [id, c] of hub.conns) if (id !== userId) write(c.res, type, data);
}

/** Tell both members' MAIN app stream who is in the room, so the lesson card can show "Bobur is waiting". */
function announcePresence(hub) {
  const data = { bookingId: hub.bookingId, roomId: hub.id, online: [...new Set([...online(hub), ...hub.grace.keys()])] };
  for (const userId of hub.members.keys()) sendEvent(userId, 'room', data);
}

function scheduleEmptyCheck(hub) {
  clearTimeout(hub.emptyTimer);
  hub.emptyTimer = null;
  if (hub.conns.size === 0 && hub.grace.size === 0) {
    hub.emptyTimer = setTimeout(() => endRoom(hub.id, 'empty').catch(logError), roomConfig.emptyMs);
    hub.emptyTimer.unref?.();
  }
}

function dropMember(hub, userId, reason) {
  clearTimeout(hub.grace.get(userId));
  hub.grace.delete(userId);
  const c = hub.conns.get(userId);
  if (c) { clearInterval(c.ping); hub.conns.delete(userId); c.res.end(); }
  toOthers(hub, userId, 'peer-left', { userId, reason });
  query('UPDATE video_room_participants SET left_at = now() WHERE room_id = $1 AND user_id = $2', [hub.id, userId]).catch(logError);
}

/**
 * Close a room for everyone: mark it ENDED in the database, tell connected phones why, free the timers.
 * Safe to call more than once (the second call changes nothing).
 */
export async function endRoom(roomId, reason, byUserId = null) {
  const r = await query(
    `UPDATE video_rooms SET status = 'ENDED', ended_at = now(), end_reason = $2
      WHERE id = $1 AND status = 'ACTIVE' RETURNING booking_id`, [roomId, reason]);
  const hub = hubs.get(roomId);
  if (!hub) return r.rowCount > 0;
  hubs.delete(roomId);
  clearTimeout(hub.emptyTimer);
  clearTimeout(hub.expiryTimer);
  for (const t of hub.grace.values()) clearTimeout(t);
  hub.grace.clear();
  for (const c of hub.conns.values()) {
    clearInterval(c.ping);
    write(c.res, 'room-ended', { reason, by: byUserId });
    c.res.end();
  }
  hub.conns.clear();
  for (const userId of hub.members.keys()) sendEvent(userId, 'room', { bookingId: hub.bookingId, roomId, online: [], ended: true });
  return r.rowCount > 0;
}

/** The lesson was cancelled or checked in: its room (if any) closes at once. */
export async function endRoomsForBooking(bookingId, reason) {
  const r = await query("SELECT id FROM video_rooms WHERE booking_id = $1 AND status = 'ACTIVE'", [bookingId]);
  for (const row of r.rows) await endRoom(row.id, reason);
}

/** Open rooms of my lessons, for GET /sync: the lesson card shows "Join" and who is waiting. */
export async function myRooms(userId) {
  const r = await query(
    `SELECT v.id, v.booking_id
       FROM video_rooms v
       JOIN slot_bookings b ON b.id = v.booking_id
       JOIN user_offers o   ON o.id = b.offer_id
      WHERE v.status = 'ACTIVE' AND v.expires_at > now() AND b.status = 'BOOKED'
        AND (b.learner_id = $1 OR o.user_id = $1)`, [userId]);
  return r.rows.map((row) => {
    const hub = hubs.get(row.id);
    return { bookingId: row.booking_id, roomId: row.id, online: hub ? [...new Set([...online(hub), ...hub.grace.keys()])] : [] };
  });
}

// ---------- signal validation ----------

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Checks one message from a phone. Returns a clean copy, or throws 400. Exported for unit tests. */
export function cleanSignal(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!isStr(b.id, 64)) throw new HttpError(400, 'Signal id is required');
  if (!SIGNAL_TYPES.has(b.type)) throw new HttpError(400, 'Unknown signal type');
  const to = Number(b.to);
  if (!Number.isInteger(to) || to <= 0) throw new HttpError(400, 'Signal needs a receiver');
  const p = b.payload && typeof b.payload === 'object' ? b.payload : {};
  let payload;
  switch (b.type) {
    case 'offer':
    case 'answer':
      if (!isStr(p.sdp, MAX_SDP)) throw new HttpError(400, 'Invalid session description');
      payload = { sdp: p.sdp, ...(p.iceRestart === true ? { iceRestart: true } : {}) };
      break;
    case 'candidate':
      if (!isStr(p.candidate, MAX_CANDIDATE)) throw new HttpError(400, 'Invalid ICE candidate');
      if (!Number.isInteger(p.sdpMLineIndex) || p.sdpMLineIndex < 0 || p.sdpMLineIndex > 16) throw new HttpError(400, 'Invalid ICE candidate');
      if (p.sdpMid != null && !isStr(p.sdpMid, 32)) throw new HttpError(400, 'Invalid ICE candidate');
      payload = { candidate: p.candidate, sdpMLineIndex: p.sdpMLineIndex, sdpMid: p.sdpMid ?? null };
      break;
    case 'media':
      if (typeof p.audio !== 'boolean' || typeof p.video !== 'boolean') throw new HttpError(400, 'Invalid media state');
      payload = { audio: p.audio, video: p.video };
      break;
    default:
      payload = {};
  }
  return { id: b.id, to, type: b.type, payload };
}

const sent = new Map();   // userId -> timestamps of the last minute (rate limit, in memory like the chat limit)
function rateLimit(userId) {
  const now = Date.now();
  const list = (sent.get(userId) || []).filter((t) => now - t < 60_000);
  if (list.length >= roomConfig.maxPerMinute) throw new HttpError(429, 'Too many signals, slow down');
  list.push(now);
  sent.set(userId, list);
}

// ---------- routes ----------

export function roomRoutes(app) {
  // ICE servers for a call (STUN + temporary TURN). Also returned when a room is opened.
  app.get('/api/mobile/ice', requireAuth, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await iceServers());
  });

  // Open the video room of a lesson: returns the active room or creates it. Learner or teacher only.
  app.post('/api/mobile/bookings/:id/room', requireAuth, async (req, res) => {
    const bookingId = cleanId(req.params.id, 'bookingId');
    const me = req.user.id;
    const room = await withTransaction(async (db) => {
      await db.query('SELECT id FROM slot_bookings WHERE id = $1 FOR UPDATE', [bookingId]);   // one room per lesson, even if both tap at once
      const lesson = await lessonFor(db, bookingId, me);
      if (lesson.status !== 'BOOKED') throw new HttpError(409, endedText(lesson.status === 'DONE' ? 'booking_done' : 'booking_cancelled'));
      const old = await db.query(
        `SELECT id, created_at, expires_at, (expires_at <= now()) AS expired
           FROM video_rooms WHERE booking_id = $1 AND status = 'ACTIVE'`, [bookingId]);
      let row = old.rows[0];
      if (row?.expired) {
        await db.query("UPDATE video_rooms SET status = 'ENDED', ended_at = now(), end_reason = 'expired' WHERE id = $1", [row.id]);
        row = null;
      }
      let created = false;
      if (!row) {
        row = (await db.query(
          'INSERT INTO video_rooms (booking_id, created_by) VALUES ($1, $2) RETURNING id, created_at, expires_at',
          [bookingId, me])).rows[0];
        created = true;
      }
      return { row, lesson, created };
    });
    if (!room.created) {
      const hub = hubs.get(room.row.id);
      if (!hub) await endIfMemoryLost(room.row.id);
    }
    const ice = await iceServers();
    const members = membersOf(room.lesson);
    const hub = hubs.get(room.row.id);
    res.status(room.created ? 201 : 200).json({
      roomId: room.row.id,
      bookingId,
      skill: room.lesson.skill,
      you: members.find((m) => m.userId === me),
      participants: members.map((m) => ({ ...m, online: !!hub && (hub.conns.has(m.userId) || hub.grace.has(m.userId)) })),
      startedAt: new Date(room.row.created_at).getTime(),
      expiresAt: new Date(room.row.expires_at).getTime(),
      ...ice,
    });
  });

  // Join: the room's live stream. The first event is "room-state"; then peer-joined / peer-left / signal / room-ended.
  app.get('/api/mobile/rooms/:roomId/events', requireAuth, async (req, res) => {
    const roomId = cleanRoomId(req.params.roomId);
    const me = req.user.id;
    const { room, lesson } = await roomFor(roomId, me);
    const hub = hubFor(room, lesson);
    const role = hub.members.get(me).role;
    await query(
      `INSERT INTO video_room_participants (room_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) DO UPDATE SET last_joined_at = now(), left_at = NULL`, [roomId, me, role]);
    if (hubs.get(roomId) !== hub) throw new HttpError(410, 'This video room has ended.');   // ended while we waited

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Back within the grace period (e.g. Wi-Fi -> 4G): the others never heard "left".
    const resumed = hub.grace.has(me) || hub.conns.has(me);
    clearTimeout(hub.grace.get(me));
    hub.grace.delete(me);
    // Only one stream per person: a newer one replaces the old (the old phone/stream is told why).
    const old = hub.conns.get(me);
    if (old) { clearInterval(old.ping); write(old.res, 'room-ended', { reason: 'superseded' }); old.res.end(); }

    const connId = nextConnId++;
    const ping = setInterval(() => res.write(': ping\n\n'), roomConfig.pingMs);
    hub.conns.set(me, { res, connId, ping });
    clearTimeout(hub.emptyTimer);
    hub.emptyTimer = null;

    write(res, 'room-state', {
      roomId, bookingId: hub.bookingId, skill: hub.skill, connId,
      you: hub.members.get(me), participants: participants(hub),
      startedAt: hub.startedAt, expiresAt: hub.expiresAt,
    });
    // The ones already here make the offer to me (see the rules at the top).
    toOthers(hub, me, 'peer-joined', { ...hub.members.get(me), resumed });
    announcePresence(hub);

    // "Bobur is waiting for you" - once per room, only if the other person is not here yet.
    for (const userId of hub.members.keys()) {
      if (userId !== me && !hub.conns.has(userId) && !hub.notified.has(userId)) {
        hub.notified.add(userId);
        const first = hub.members.get(me).name.split(' ')[0];
        notify(userId, `🎥 ${first} is waiting for you in the ${hub.skill} video lesson`);
      }
    }

    req.on('close', () => {
      clearInterval(ping);
      const current = hub.conns.get(me);
      if (!current || current.connId !== connId) return;       // replaced by a newer stream
      hub.conns.delete(me);
      if (hubs.get(roomId) !== hub) return;                     // the room already ended
      hub.grace.set(me, setTimeout(() => {
        hub.grace.delete(me);
        if (hubs.get(roomId) !== hub) return;
        dropMember(hub, me, 'disconnected');
        announcePresence(hub);
        scheduleEmptyCheck(hub);
      }, roomConfig.graceMs));
      hub.grace.get(me).unref?.();
    });
  });

  // One connection message for one other member. Relayed at once, never stored or logged.
  app.post('/api/mobile/rooms/:roomId/signal', requireAuth, async (req, res) => {
    const roomId = cleanRoomId(req.params.roomId);
    const me = req.user.id;
    const hub = hubs.get(roomId);
    if (!hub || !hub.members.has(me)) {
      await roomFor(roomId, me);                               // 404 for outsiders, 410 for ended rooms
      throw new HttpError(409, 'Join the room first');
    }
    if (!hub.conns.has(me)) throw new HttpError(409, 'Join the room first');
    const msg = cleanSignal(req.body);
    if (msg.to === me || !hub.members.has(msg.to)) throw new HttpError(400, 'That person is not in this room');
    rateLimit(me);
    const target = hub.conns.get(msg.to);
    if (!target) throw new HttpError(409, 'The other person is not connected right now');
    write(target.res, 'signal', { id: msg.id, from: me, type: msg.type, payload: msg.payload });
    res.json({ ok: true });
  });

  // I leave; the room stays open for the other person (and for me to come back) until it is empty.
  app.post('/api/mobile/rooms/:roomId/leave', requireAuth, async (req, res) => {
    const roomId = cleanRoomId(req.params.roomId);
    const me = req.user.id;
    const hub = hubs.get(roomId);
    if (hub && hub.members.has(me)) {
      dropMember(hub, me, 'left');
      announcePresence(hub);
      if (hub.conns.size === 0 && hub.grace.size === 0) await endRoom(roomId, 'empty');
    } else {
      await roomFor(roomId, me).catch((e) => { if (e.status !== 410) throw e; });   // 404 for outsiders
    }
    res.json({ ok: true });
  });

  // End the lesson call for everyone.
  app.post('/api/mobile/rooms/:roomId/end', requireAuth, async (req, res) => {
    const roomId = cleanRoomId(req.params.roomId);
    const me = req.user.id;
    const hub = hubs.get(roomId);
    if (!hub || !hub.members.has(me)) await roomFor(roomId, me).catch((e) => { if (e.status !== 410) throw e; });
    await endRoom(roomId, 'ended_by_user', me);
    res.json({ ok: true });
  });
}

// A room the database calls ACTIVE but nobody is connected to after a server restart: give it the normal
// "empty room" timeout so it does not stay open forever.
async function endIfMemoryLost(roomId) {
  if (hubs.has(roomId)) return;
  const r = await query(
    `SELECT v.id, v.booking_id, v.created_at, v.expires_at FROM video_rooms v WHERE v.id = $1 AND v.status = 'ACTIVE'`, [roomId]);
  const row = r.rows[0];
  const lesson = row && await lessonRow({ query }, row.booking_id);
  if (!lesson) return;
  scheduleEmptyCheck(hubFor(row, lesson));
}

/** For tests: forget all in-memory rooms and timers. */
export function resetRoomsForTests() {
  for (const hub of hubs.values()) {
    clearTimeout(hub.emptyTimer);
    clearTimeout(hub.expiryTimer);
    for (const t of hub.grace.values()) clearTimeout(t);
    for (const c of hub.conns.values()) { clearInterval(c.ping); c.res.end(); }
  }
  hubs.clear();
  sent.clear();
}
