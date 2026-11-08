// Collaboration API: notifications, private chat, learning workspace, weekly availability.
// Rule used everywhere: only the TWO people of a swap may touch its chat/workspace. Anyone else gets 404
// (not 403), so outsiders cannot even find out that the swap exists.
import { query, withTransaction } from './db.js';
import { HttpError, cleanId, cleanText } from './validate.js';
import { notify, notifyMessageOnce } from './notify.js';
import { cleanSlots, validZone, sharedSlots } from './availability.js';

const hhmm = (t) => String(t).slice(0, 5);

// Load a swap and check the caller is one of its two people.
async function myExchange(db, id, userId) {
  const r = await db.query(
    `SELECT e.id, e.status, e.requester_id, e.provider_id, sw.name AS skill_wanted, so.name AS skill_offered,
            CASE WHEN e.requester_id = $2 THEN e.provider_id ELSE e.requester_id END AS other_id,
            p.display_name AS other_name
       FROM exchanges e
       JOIN skills sw ON sw.id = e.skill_wanted_id JOIN skills so ON so.id = e.skill_offered_id
       JOIN profiles p ON p.user_id = CASE WHEN e.requester_id = $2 THEN e.provider_id ELSE e.requester_id END
      WHERE e.id = $1 AND (e.requester_id = $2 OR e.provider_id = $2)`, [id, userId]);
  if (!r.rows[0]) throw new HttpError(404, 'Swap not found');
  return r.rows[0];
}
const needOpen = (ex, what) => {
  if (ex.status !== 'accepted' && ex.status !== 'completed') throw new HttpError(409, `${what} opens when the swap is accepted`);
};

// Very small rate limit for chat: 20 messages per minute per member (kept in memory).
const sent = new Map();
function chatLimit(userId) {
  const now = Date.now();
  const recent = (sent.get(userId) || []).filter((t) => now - t < 60000);
  if (recent.length >= 20) throw new HttpError(429, 'You are sending messages too fast. Wait a moment.');
  recent.push(now); sent.set(userId, recent);
}

export function collabRoutes(app) {
  // ---------- Notifications ----------
  app.get('/api/notifications', async (req, res) => {
    const items = await query('SELECT id, type, body, link, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 40', [req.user.id]);
    const unread = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ unread: unread.rows[0].n, items: items.rows });
  });
  app.get('/api/notifications/count', async (req, res) => {
    const r = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ unread: r.rows[0].n });
  });
  // Mark one notification (body.id) or all of mine as read. user_id is in the WHERE, so nobody can touch another member's.
  app.post('/api/notifications/read', async (req, res) => {
    if (req.body.id != null) await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [cleanId(req.body.id, 'id'), req.user.id]);
    else await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json({ ok: true });
  });

  // ---------- Chat ----------
  // One conversation per accepted/completed swap.
  app.get('/api/conversations', async (req, res) => {
    const r = await query(
      `SELECT e.id, e.status, sw.name AS skill_wanted, so.name AS skill_offered,
              op.user_id AS other_id, op.display_name AS other_name,
              lm.body AS last_body, lm.created_at AS last_at, lm.sender_id AS last_sender,
              (SELECT count(*)::int FROM messages m WHERE m.exchange_id = e.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
         FROM exchanges e
         JOIN skills sw ON sw.id = e.skill_wanted_id JOIN skills so ON so.id = e.skill_offered_id
         JOIN profiles op ON op.user_id = CASE WHEN e.requester_id = $1 THEN e.provider_id ELSE e.requester_id END
         LEFT JOIN LATERAL (SELECT body, created_at, sender_id FROM messages m WHERE m.exchange_id = e.id ORDER BY id DESC LIMIT 1) lm ON true
        WHERE (e.requester_id = $1 OR e.provider_id = $1) AND e.status IN ('accepted','completed')
        ORDER BY coalesce(lm.created_at, e.created_at) DESC`, [req.user.id]);
    res.json(r.rows);
  });

  // Messages of one swap. ?before=<id> loads older ones (pagination), ?after=<id> loads only new ones (polling).
  app.get('/api/exchanges/:id/messages', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const ex = await myExchange({ query }, id, req.user.id);
    needOpen(ex, 'Chat');
    const limit = 30;
    let rows;
    if (req.query.after) {
      rows = (await query('SELECT id, sender_id, body, created_at, read_at FROM messages WHERE exchange_id = $1 AND id > $2 ORDER BY id', [id, cleanId(req.query.after, 'after')])).rows;
    } else {
      const before = req.query.before ? cleanId(req.query.before, 'before') : 2147483647;
      rows = (await query('SELECT id, sender_id, body, created_at, read_at FROM messages WHERE exchange_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3', [id, before, limit + 1])).rows;
    }
    const hasMore = !req.query.after && rows.length > limit;
    if (hasMore) rows.pop();
    if (!req.query.after) rows.reverse();
    // Opening the chat = reading it: mark the other person's messages and the matching bell notification as read.
    await query('UPDATE messages SET read_at = now() WHERE exchange_id = $1 AND sender_id <> $2 AND read_at IS NULL', [id, req.user.id]);
    await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND type = 'message' AND link = $2 AND read_at IS NULL", [req.user.id, `/chat?id=${id}`]);
    res.json({ exchange: { id: ex.id, status: ex.status, other_id: ex.other_id, other_name: ex.other_name, skill_wanted: ex.skill_wanted, skill_offered: ex.skill_offered }, me: req.user.id, messages: rows, has_more: hasMore });
  });

  app.post('/api/exchanges/:id/messages', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const body = cleanText(req.body.body, { min: 1, max: 1000, field: 'Message' });
    const msg = await withTransaction(async (db) => {
      const ex = await myExchange(db, id, req.user.id);
      if (ex.status !== 'accepted') throw new HttpError(409, ex.status === 'completed' ? 'This swap is finished, so the chat is read-only' : 'Chat opens when the swap is accepted');
      chatLimit(req.user.id);
      const r = await db.query('INSERT INTO messages (exchange_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, sender_id, body, created_at, read_at', [id, req.user.id, body]);
      await notifyMessageOnce(db, ex.other_id, `New message from ${req.user.display_name}`, `/chat?id=${id}`);
      return r.rows[0];
    });
    res.status(201).json(msg);
  });

  // ---------- Learning workspace ----------
  async function workspace(db, ex) {
    const w = await db.query('SELECT w.objective, w.notes, w.updated_at, p.display_name AS updated_by FROM workspaces w LEFT JOIN profiles p ON p.user_id = w.updated_by WHERE w.exchange_id = $1', [ex.id]);
    const ms = await db.query('SELECT id, title, status, position FROM milestones WHERE exchange_id = $1 ORDER BY position, id', [ex.id]);
    const done = ms.rows.filter((m) => m.status === 'done').length;
    return {
      exchange: { id: ex.id, status: ex.status, other_id: ex.other_id, other_name: ex.other_name, skill_wanted: ex.skill_wanted, skill_offered: ex.skill_offered },
      objective: w.rows[0]?.objective || '', notes: w.rows[0]?.notes || '', updated_at: w.rows[0]?.updated_at || null, updated_by: w.rows[0]?.updated_by || null,
      milestones: ms.rows, progress: { done, total: ms.rows.length, percent: ms.rows.length ? Math.round((done * 100) / ms.rows.length) : 0 },
    };
  }
  const MAX_MILESTONES = 20;

  app.get('/api/exchanges/:id/workspace', async (req, res) => {
    const ex = await myExchange({ query }, cleanId(req.params.id, 'id'), req.user.id);
    needOpen(ex, 'The workspace');
    res.json(await workspace({ query }, ex));
  });

  // Goals and shared notes (both people can edit; only while the swap is running).
  app.put('/api/exchanges/:id/workspace', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const objective = cleanText(req.body.objective, { max: 300, field: 'Learning goal' });
    const notes = cleanText(req.body.notes, { max: 2000, field: 'Notes' });
    const ex = await myExchange({ query }, id, req.user.id);
    needOpen(ex, 'The workspace');
    if (ex.status !== 'accepted') throw new HttpError(409, 'This swap is finished, so the workspace is read-only');
    await query(
      `INSERT INTO workspaces (exchange_id, objective, notes, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (exchange_id) DO UPDATE SET objective = $2, notes = $3, updated_by = $4, updated_at = now()`, [id, objective, notes, req.user.id]);
    res.json(await workspace({ query }, ex));
  });

  app.post('/api/exchanges/:id/milestones', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const title = cleanText(req.body.title, { min: 1, max: 120, field: 'Milestone' });
    await withTransaction(async (db) => {
      const ex = await myExchange(db, id, req.user.id);
      needOpen(ex, 'The workspace');
      if (ex.status !== 'accepted') throw new HttpError(409, 'This swap is finished, so the workspace is read-only');
      await db.query('SELECT 1 FROM exchanges WHERE id = $1 FOR UPDATE', [id]);   // serialise concurrent adds so the limit holds
      const c = await db.query('SELECT count(*)::int AS n, coalesce(max(position), 0) AS pos FROM milestones WHERE exchange_id = $1', [id]);
      if (c.rows[0].n >= MAX_MILESTONES) throw new HttpError(409, `A swap can have at most ${MAX_MILESTONES} milestones`);
      await db.query('INSERT INTO milestones (exchange_id, title, position, created_by) VALUES ($1,$2,$3,$4)', [id, title, c.rows[0].pos + 1, req.user.id]);
      await notify(db, ex.other_id, 'milestone', `${req.user.display_name} added a milestone: ${title}`, `/workspace?id=${id}`);
    });
    res.status(201).json(await workspace({ query }, await myExchange({ query }, id, req.user.id)));
  });

  app.patch('/api/exchanges/:id/milestones/:mid', async (req, res) => {
    const id = cleanId(req.params.id, 'id'); const mid = cleanId(req.params.mid, 'mid');
    const status = req.body.status;
    if (status !== undefined && !['todo', 'doing', 'done'].includes(status)) throw new HttpError(400, 'status must be todo, doing or done');
    const title = req.body.title === undefined ? null : cleanText(req.body.title, { min: 1, max: 120, field: 'Milestone' });
    if (status === undefined && title === null) throw new HttpError(400, 'Nothing to change');
    await withTransaction(async (db) => {
      const ex = await myExchange(db, id, req.user.id);
      needOpen(ex, 'The workspace');
      if (ex.status !== 'accepted') throw new HttpError(409, 'This swap is finished, so the workspace is read-only');
      // exchange_id is part of the WHERE: a milestone id from ANOTHER swap cannot be changed through this one (IDOR protection)
      const r = await db.query(
        `UPDATE milestones SET status = coalesce($3, status), title = coalesce($4, title), updated_at = now()
          WHERE id = $1 AND exchange_id = $2 RETURNING title, status`, [mid, id, status ?? null, title]);
      if (!r.rows[0]) throw new HttpError(404, 'Milestone not found');
      if (status !== undefined) await notify(db, ex.other_id, 'milestone', `${req.user.display_name} marked "${r.rows[0].title}" as ${{ todo: 'not started', doing: 'in progress', done: 'done' }[status]}`, `/workspace?id=${id}`);
    });
    res.json(await workspace({ query }, await myExchange({ query }, id, req.user.id)));
  });

  app.delete('/api/exchanges/:id/milestones/:mid', async (req, res) => {
    const id = cleanId(req.params.id, 'id'); const mid = cleanId(req.params.mid, 'mid');
    const ex = await myExchange({ query }, id, req.user.id);
    needOpen(ex, 'The workspace');
    if (ex.status !== 'accepted') throw new HttpError(409, 'This swap is finished, so the workspace is read-only');
    const r = await query('DELETE FROM milestones WHERE id = $1 AND exchange_id = $2', [mid, id]);
    if (!r.rowCount) throw new HttpError(404, 'Milestone not found');
    res.json(await workspace({ query }, ex));
  });

  // ---------- Weekly availability ----------
  const mySlots = async (userId) => {
    const z = await query('SELECT time_zone FROM profiles WHERE user_id = $1', [userId]);
    const s = await query('SELECT weekday, start_time, end_time FROM availability WHERE user_id = $1 ORDER BY weekday, start_time', [userId]);
    return { time_zone: z.rows[0]?.time_zone || 'Asia/Tashkent', slots: s.rows.map((r) => ({ weekday: r.weekday, start: hhmm(r.start_time), end: hhmm(r.end_time) })) };
  };

  app.get('/api/me/availability', async (req, res) => res.json(await mySlots(req.user.id)));

  // Replace my whole weekly schedule at once (delete + insert in one transaction).
  app.put('/api/me/availability', async (req, res) => {
    const slots = cleanSlots(req.body.slots);
    const tz = req.body.time_zone === undefined ? null : req.body.time_zone;
    if (tz !== null && !validZone(tz)) throw new HttpError(400, 'Unknown time zone');
    await withTransaction(async (db) => {
      if (tz !== null) await db.query('UPDATE profiles SET time_zone = $1 WHERE user_id = $2', [tz, req.user.id]);
      await db.query('DELETE FROM availability WHERE user_id = $1', [req.user.id]);
      for (const s of slots) await db.query('INSERT INTO availability (user_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [req.user.id, s.weekday, s.start, s.end]);
    });
    res.json(await mySlots(req.user.id));
  });

  // Someone else's availability + the times when we are BOTH free (in my own time zone).
  app.get('/api/members/:id/availability', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const exists = await query('SELECT 1 FROM profiles WHERE user_id = $1', [id]);
    if (!exists.rowCount) throw new HttpError(404, 'Member not found');
    const [them, me] = await Promise.all([mySlots(id), mySlots(req.user.id)]);
    res.json({ ...them, my_time_zone: me.time_zone, shared: id === req.user.id ? [] : sharedSlots(me.slots, me.time_zone, them.slots, them.time_zone) });
  });
}
