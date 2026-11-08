# Collaboration features: design notes (for the report and the viva)

## What was added
| Feature | Tables | Main routes | Page |
|---|---|---|---|
| Notifications | `notifications` | `GET /api/notifications`, `/count`, `POST /read` | `/notifications`, bell in header |
| Private chat | `messages` | `GET/POST /api/exchanges/:id/messages`, `GET /api/conversations` | `/messages`, `/chat?id=` |
| Learning workspace | `workspaces`, `milestones` | `GET/PUT /api/exchanges/:id/workspace`, `POST/PATCH/DELETE .../milestones` | `/workspace?id=` |
| Weekly availability | `availability`, `profiles.time_zone` | `GET/PUT /api/me/availability`, `GET /api/members/:id/availability` | `/profile`, `/member` |
| Reviews (earlier) | `reviews` | `POST /api/exchanges/:id/review`, `GET /api/members/:id/reviews` | `/exchanges`, `/member` |

All of them hang off `exchanges(id)` or `users(id)` with foreign keys and `ON DELETE CASCADE`.

## Decisions and why
- **Chat belongs to a swap, not to two users.** The `exchange_id` already says who the two people are, so there is no separate conversations table (less to keep consistent). Chat opens only when the swap is `accepted`; after `completed` it is read-only.
- **Polling, not WebSockets.** The chat page asks `?after=<last id>` every 5 seconds, the bell asks `/count` every 30 seconds, only while the tab is visible. It needs no new infrastructure and works on Render's free plan.
- **Access control = "outsiders get 404".** Every chat/workspace route loads the swap with `WHERE id = $1 AND (requester_id = $2 OR provider_id = $2)`. A stranger cannot tell whether a swap exists.
- **IDOR protection on milestones.** `UPDATE milestones ... WHERE id = $mid AND exchange_id = $id` - a milestone id from another swap changes nothing (404). Covered by a test.
- **Notifications are written in the same transaction** as the status change, so there is never an "accepted" without its notification (or the opposite). Chat notifications are de-duplicated: one unread "new message" per conversation.
- **Integrity in the database, not only in JavaScript:** `CHECK` on status values, rating 1-5, weekday 0-6, `end_time > start_time`, non-blank message text; `UNIQUE` on one review per person per swap and on availability slots.
- **Rate limit:** 20 chat messages per minute per member (in memory; fine for one server instance, would need Redis for several).
- **Availability across time zones:** slots are stored as local wall-clock times plus the member's IANA time zone. To find shared free time both schedules are converted to minutes of the week in UTC, intersected, and converted back to the viewer's zone (`src/availability.js`, pure functions with unit tests). The offset is the one valid *today*, so a daylight-saving change is not modelled (Uzbekistan and South Korea have none).
- **Text is always inserted with `textContent`** (helper `h()`), so a chat message like `<script>` is shown as text. The page's CSP also blocks inline scripts.

## Honest limits
- Exchange states stay `pending / accepted / declined / cancelled / completed`; `accepted` is the "in progress" state.
- No block/report, no push notifications, no notification preferences, no file uploads, no booking of concrete sessions (availability only shows overlaps).
- Chat polls instead of pushing, so a message can take up to 5 seconds to appear.

## Likely questions
1. *Why no WebSocket?* See above: polling is enough for a few users and adds no infrastructure.
2. *How do you stop a user reading someone else's chat?* The `WHERE` clause with both participant ids; test "outsider gets 404".
3. *What is a foreign key doing here?* `messages.exchange_id -> exchanges.id` makes a message without a swap impossible; `ON DELETE CASCADE` removes the messages with the swap.
4. *Why a partial index (`WHERE read_at IS NULL`)?* Unread rows are few; the index stays tiny and the bell count is fast.
5. *Where is the transaction?* `PATCH /api/exchanges/:id` (status + history + notification), milestone changes (update + notification), availability replace (delete + inserts).
