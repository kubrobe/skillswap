// Video lesson in the browser: the SAME room as the Android app (src/rooms.js), so a teacher on the website and a
// learner on the phone meet in one call. No third-party meeting site, no "moderator": the two people of a booked
// lesson are the only members, and whoever opens the room first simply waits for the other.
//
// Signalling rules are the app's (call/VideoRoomManager.kt), so the two can talk to each other:
// - the person ALREADY in the room makes the offer when the other joins ("peer-joined");
// - a newcomer who gets no offer within a few seconds asks for one ("renegotiate");
// - two offers at once: the smaller user id keeps offering, the other answers;
// - every message has an id; one delivered twice is ignored.
import { api, h, icon, requireLogin } from '/app.js';

const box = document.getElementById('call');
const lessonId = Number(new URLSearchParams(location.search).get('lesson'));
const me = await requireLogin();

const OFFER_WAIT_MS = 3000;
const MAX_ICE_RESTARTS = 3;

let room = null;          // answer of POST /bookings/:id/room
let peer = null;          // the other member { userId, name, role, online }
let events = null;        // EventSource of the room
let pc = null;            // RTCPeerConnection to the other person
let offerer = false;
let pendingCandidates = [];
let offerWait = null;
let iceRestarts = 0;
let ended = false;
const seen = new Set();
let localStream = null;
let micOn = true;
let camOn = true;
let sendChain = Promise.resolve();

// ---------- screen ----------
const remoteVideo = h('video', { class: 'call-remote', autoplay: true, playsinline: true });
const localVideo = h('video', { class: 'call-local', autoplay: true, playsinline: true, muted: true });
localVideo.muted = true;
const status = h('p', { class: 'call-status' }, 'Starting…');
const title = h('h1', { class: 'call-title' }, 'Video lesson');
const peerState = h('p', { class: 'call-peer-state' });
const micBtn = h('button', { class: 'call-btn', type: 'button', 'aria-label': 'Microphone on/off', onclick: toggleMic }, icon('mic'));
const camBtn = h('button', { class: 'call-btn', type: 'button', 'aria-label': 'Camera on/off', onclick: toggleCam }, icon('video'));
const leaveBtn = h('button', { class: 'call-btn call-leave', type: 'button', 'aria-label': 'Leave', onclick: () => leave(false) }, icon('close'));
const endBtn = h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => leave(true) }, 'End for both');
const stage = h('div', { class: 'call-stage' }, remoteVideo, localVideo,
  h('div', { class: 'call-top' }, title, status, peerState));
const controls = h('div', { class: 'call-controls' }, micBtn, camBtn, leaveBtn);

function say(text) { status.textContent = text; }
function showMessage(heading, text) {
  box.replaceChildren(h('div', { class: 'call-message' }, h('h1', {}, heading), h('p', {}, text),
    h('a', { class: 'btn btn-primary', href: '/lessons?tab=mine' }, 'Back to my lessons')));
}

if (!Number.isInteger(lessonId) || lessonId <= 0) {
  showMessage('No lesson chosen', 'Open the video room from your lesson on the Lessons page.');
} else {
  // A start screen first: browsers allow sound only after a tap, and the person sees their camera before joining.
  const preview = h('video', { class: 'call-preview', autoplay: true, playsinline: true, muted: true });
  preview.muted = true;
  const join = h('button', { class: 'btn btn-primary btn-large', type: 'button' }, icon('video'), 'Join video lesson');
  const note = h('p', { class: 'call-note' }, 'No login or moderator needed. Your teacher or learner joins the same room from the app or the website.');
  box.replaceChildren(h('div', { class: 'call-lobby' }, h('h1', {}, 'Video lesson'), preview, join, note));
  getMedia().then((s) => { if (s) preview.srcObject = s; });
  join.addEventListener('click', async () => {
    join.disabled = true;
    preview.srcObject = null;
    await start();
  });
}

// ---------- camera and microphone ----------
async function getMedia() {
  if (localStream) return localStream;
  const tries = [{ audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } }, { audio: true, video: false }, { audio: false, video: true }];
  for (const c of tries) {
    try { localStream = await navigator.mediaDevices.getUserMedia(c); break; } catch { /* try the next, smaller wish */ }
  }
  micOn = !!localStream?.getAudioTracks().length;
  camOn = !!localStream?.getVideoTracks().length;
  return localStream;
}

function toggleMic() {
  const t = localStream?.getAudioTracks()[0];
  if (!t) return;
  micOn = !micOn;
  t.enabled = micOn;
  micBtn.classList.toggle('off', !micOn);
  sendMediaState();
}
function toggleCam() {
  const t = localStream?.getVideoTracks()[0];
  if (!t) return;
  camOn = !camOn;
  t.enabled = camOn;
  camBtn.classList.toggle('off', !camOn);
  localVideo.classList.toggle('hidden', !camOn);
  sendMediaState();
}

// ---------- the room ----------
async function start() {
  await getMedia();
  box.replaceChildren(stage, h('div', { class: 'call-bar' }, controls, endBtn));
  if (localStream) localVideo.srcObject = localStream;
  if (!localStream) say('No camera or microphone allowed: you can still see and hear the other person.');
  micBtn.classList.toggle('off', !micOn);
  camBtn.classList.toggle('off', !camOn);
  try {
    room = await api('POST', `/api/mobile/bookings/${lessonId}/room`, {});
  } catch (e) {
    return showMessage('Cannot open the video room', e.message);
  }
  peer = room.participants.find((p) => p.userId !== me.id) || null;
  title.textContent = room.skill;
  connectEvents();
}

function connectEvents() {
  events = new EventSource(`/api/mobile/rooms/${room.roomId}/events`);
  events.addEventListener('room-state', (e) => onRoomState(JSON.parse(e.data)));
  events.addEventListener('peer-joined', (e) => onPeerJoined(JSON.parse(e.data)));
  events.addEventListener('peer-left', (e) => onPeerLeft(JSON.parse(e.data)));
  events.addEventListener('signal', (e) => onSignal(JSON.parse(e.data)));
  events.addEventListener('room-ended', (e) => onEnded(JSON.parse(e.data)));
  events.onerror = () => { if (!ended) say('Reconnecting…'); };     // EventSource tries again by itself
}

function onRoomState(s) {
  peer = s.participants.find((p) => p.userId !== me.id) || peer;
  const online = !!peer?.online;
  if (!online) {
    closeLink();
    waitingText();
    return;
  }
  if (!pc || (!offerer && !connected())) scheduleOfferWait();
  else if (offerer && !connected()) restartIce();
}

function onPeerJoined(p) {
  if (p.userId === me.id) return;
  peer = { ...p, online: true };
  if (p.resumed && pc && connected()) { sendMediaState(); return; }
  startOffer();
}

function onPeerLeft(p) {
  if (!peer || p.userId !== peer.userId) return;
  closeLink();
  peer.online = false;
  waitingText(p.reason === 'disconnected' ? 'lost connection' : 'left');
}

function onEnded(d) {
  ended = true;
  events?.close();
  closeLink();
  stopMedia();
  const why = {
    ended_by_user: 'The video lesson was ended.', empty: 'The room closed because nobody was in it.',
    expired: 'The room expired. Open the lesson again to start a new one.', superseded: 'You joined this room from another tab or device.',
    booking_cancelled: 'This lesson was cancelled.', booking_done: 'This lesson is finished.',
  }[d.reason] || 'The video room has ended.';
  showMessage('Call ended', why);
}

function waitingText(how) {
  const name = (peer?.name || 'the other person').split(' ')[0];
  say(how ? `${name} ${how}. Waiting for them to come back…` : `Waiting for ${name} to join…`);
  remoteVideo.srcObject = null;
  peerState.textContent = '';
}

// ---------- connection messages ----------
function send(type, payload = {}) {
  if (!peer || !room) return;
  const msg = { id: crypto.randomUUID(), to: peer.userId, type, payload };
  // one at a time, in order: an offer must reach the other side before its candidates
  sendChain = sendChain.then(() => api('POST', `/api/mobile/rooms/${room.roomId}/signal`, msg)).catch(() => {});
}
function sendMediaState() { send('media', { audio: micOn, video: camOn }); }

async function onSignal(m) {
  if (seen.has(m.id) || m.from === me.id) return;
  seen.add(m.id);
  if (!peer) peer = { userId: m.from, name: '', online: true };
  if (m.from !== peer.userId) return;
  const p = m.payload || {};
  try {
    switch (m.type) {
      case 'offer': {
        clearTimeout(offerWait);
        if (p.iceRestart && pc && !offerer) { await answer(p.sdp); return; }   // same call, new network path
        if (pc && offerer && !connected() && me.id < peer.userId) return;    // both offered: mine wins
        closeLink();
        newLink(false);
        await answer(p.sdp);
        sendMediaState();
        break;
      }
      case 'answer':
        if (pc && offerer) { await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); flushCandidates(); }
        break;
      case 'candidate': {
        const c = { candidate: p.candidate, sdpMid: p.sdpMid ?? null, sdpMLineIndex: p.sdpMLineIndex };
        if (pc?.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
        else pendingCandidates.push(c);
        break;
      }
      case 'media':
        peerState.textContent = [p.audio ? '' : '🔇 muted', p.video ? '' : '📷 camera off'].filter(Boolean).join(' · ');
        break;
      case 'bye':
        closeLink();
        if (peer) peer.online = false;
        waitingText('left');
        break;
      case 'renegotiate':
        startOffer();
        break;
      default:
    }
  } catch (e) {
    console.error('signal', m.type, e);
  }
}

async function answer(sdp) {
  await pc.setRemoteDescription({ type: 'offer', sdp });
  attachLocalTracks();                                   // reuses the transceivers the offer created
  const a = await pc.createAnswer();
  await pc.setLocalDescription(a);
  send('answer', { sdp: pc.localDescription.sdp });
  flushCandidates();
}

function flushCandidates() {
  for (const c of pendingCandidates) pc.addIceCandidate(c).catch(() => {});
  pendingCandidates = [];
}

function scheduleOfferWait() {
  clearTimeout(offerWait);
  say('Connecting…');
  offerWait = setTimeout(() => { if (!connected()) send('renegotiate'); }, OFFER_WAIT_MS);
}

async function startOffer() {
  closeLink();
  newLink(true);
  // audio first, then video: the same order as the app
  for (const kind of ['audio', 'video']) {
    const track = localStream?.getTracks().find((t) => t.kind === kind);
    if (track) pc.addTrack(track, localStream);
    else pc.addTransceiver(kind, { direction: 'recvonly' });
  }
  say('Connecting…');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send('offer', { sdp: pc.localDescription.sdp });
  sendMediaState();
}

async function restartIce() {
  if (!pc || !offerer) return;
  if (iceRestarts >= MAX_ICE_RESTARTS) { say('Connection lost. Leave and join again.'); return; }
  iceRestarts += 1;
  say('Reconnecting…');
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  send('offer', { sdp: pc.localDescription.sdp, iceRestart: true });
}

function attachLocalTracks() {
  if (!localStream) return;
  const used = new Set(pc.getSenders().map((s) => s.track).filter(Boolean));
  for (const t of localStream.getTracks()) if (!used.has(t)) pc.addTrack(t, localStream);
}

function newLink(asOfferer) {
  offerer = asOfferer;
  iceRestarts = 0;
  pendingCandidates = [];
  pc = new RTCPeerConnection({ iceServers: room.iceServers });
  const mine = pc;
  pc.onicecandidate = (e) => {
    if (mine !== pc || !e.candidate || !e.candidate.candidate) return;
    send('candidate', { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0 });
  };
  pc.ontrack = (e) => {
    if (mine !== pc) return;
    const stream = e.streams[0] || new MediaStream([e.track]);
    if (remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream;
    remoteVideo.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (mine !== pc) return;
    const st = pc.connectionState;
    if (st === 'connected') { iceRestarts = 0; say(''); }
    else if (st === 'disconnected') say('Reconnecting…');
    else if (st === 'failed') { if (offerer) restartIce(); else say('Reconnecting…'); }
  };
}

const connected = () => pc?.connectionState === 'connected';

function closeLink() {
  clearTimeout(offerWait);
  if (pc) { pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null; pc.close(); }
  pc = null;
  pendingCandidates = [];
  remoteVideo.srcObject = null;
}

function stopMedia() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
}

async function leave(forBoth) {
  if (ended) return;
  ended = true;
  if (!forBoth) send('bye');
  await sendChain;
  events?.close();
  closeLink();
  stopMedia();
  try { await api('POST', `/api/mobile/rooms/${room.roomId}/${forBoth ? 'end' : 'leave'}`, {}); } catch { /* already closed */ }
  location.href = '/lessons?tab=mine';
}

// Closing the tab: tell the server at once instead of waiting for the grace period.
addEventListener('pagehide', () => {
  if (ended || !room) return;
  navigator.sendBeacon(`/api/mobile/rooms/${room.roomId}/leave`);
});
