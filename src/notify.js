// Creating notifications. `db` is either the pool or a transaction client, so a notification is saved
// in the SAME transaction as the thing it announces (no "accepted" without its notification).
export function notify(db, userId, type, body, link = '/exchanges') {
  return db.query('INSERT INTO notifications (user_id, type, body, link) VALUES ($1,$2,$3,$4)', [userId, type, body.slice(0, 200), link]);
}

// For chat: one unread "new message" notification per conversation is enough (no spam for every line).
export function notifyMessageOnce(db, userId, body, link) {
  return db.query(
    `INSERT INTO notifications (user_id, type, body, link)
     SELECT $1::int, 'message', $2::text, $3::text
      WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'message' AND link = $3 AND read_at IS NULL)`,
    [userId, body.slice(0, 200), link]);
}
