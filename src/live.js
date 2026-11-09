// Live updates for the Android app with Server-Sent Events (SSE).
//
// Each phone keeps ONE long HTTP request open to GET /api/mobile/events.
// When something changes (a booking, a new lesson...), the server writes a short line into
// every open request, and the phones refresh at once - no need to pull every few seconds.
// SSE is plain HTTP, so it passes through Render's proxy without extra libraries.

const clients = new Map();   // userId -> Set of open responses (a person may have 2 phones)

export function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',                  // ask proxies not to hold the data back
  });
  res.flushHeaders();
  res.write('event: hello\ndata: {}\n\n');

  const userId = req.user.id;
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);

  // A comment line every 20 s keeps the connection alive through proxies and phone networks.
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    const set = clients.get(userId);
    set?.delete(res);
    if (set && set.size === 0) clients.delete(userId);
  });
}

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Tell every connected phone that data changed (they download a fresh copy). */
export function broadcastChanged() {
  for (const set of clients.values()) for (const res of set) send(res, 'changed', {});
}

/** A personal message that the phone shows as a banner, e.g. "Bobur booked your lesson". */
export function notify(userId, text) {
  for (const res of clients.get(userId) || []) send(res, 'notice', { text });
}

/** A message for everybody except one person (e.g. a new lesson was published). */
export function notifyAllExcept(userId, text) {
  for (const [id, set] of clients) if (id !== userId) for (const res of set) send(res, 'notice', { text });
}

export const connectedCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);

/** Credits changed for this person: the phone plays the flying-coin animation (+1 / -1). */
export function sendCredit(userId, amount) {
  for (const res of clients.get(userId) || []) send(res, 'credit', { amount });
}

/** A line for the live activity ticker on every phone, e.g. "Jasur taught Guitar · +1 🪙". */
export function broadcastActivity(text) {
  const item = { text, at: Date.now() };
  for (const set of clients.values()) for (const res of set) send(res, 'activity', item);
}
