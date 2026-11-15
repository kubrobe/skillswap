# Video lessons (native WebRTC): server side

The Android app runs video lessons itself; nobody is sent to an external meeting website.
The server's job is small: decide **who may be in a room**, and **pass connection messages** between the two phones.
Audio and video never touch the server (except through the TURN relay, which only forwards encrypted packets).

## Pieces
| Piece | Where | What it does |
|---|---|---|
| `video_rooms` | `db/14_video_rooms.sql` | one row per room: lesson, status ACTIVE/ENDED, expiry (3 h), why it ended |
| `video_room_participants` | same | who joined, when, when they left |
| Signalling hub | `src/rooms.js` | in-memory presence + relay; SSE down, POST up (same technique as `src/live.js`) |
| ICE servers | `src/rooms.js` `iceServers()` | STUN always; TURN with short-lived Cloudflare credentials when configured |
| Tests | `tests/rooms.test.js` | access rules, relay, grace period, leave/end/expiry/cancel/check-in, TURN |

## Protocol (version 1)
Phone → server: `POST /api/mobile/rooms/:roomId/signal`
```json
{ "id": "unique per message", "to": 42, "type": "offer", "payload": { "sdp": "v=0..." } }
```
| type | payload |
|---|---|
| `offer`, `answer` | `{ sdp, iceRestart? }` (max 16,000 characters) |
| `candidate` | `{ candidate, sdpMid, sdpMLineIndex }` |
| `media` | `{ audio: bool, video: bool }`: mic/camera on or off, so the other side can show it |
| `bye` | `{}`: polite goodbye before leaving |

Server → phone (SSE on `GET /api/mobile/rooms/:roomId/events`):
| event | data |
|---|---|
| `room-state` | first event: `{roomId, bookingId, skill, connId, you, participants[{userId,name,role,online}], startedAt, expiresAt}` |
| `peer-joined` | `{userId, name, role, resumed}`. **You** now send the offer (you were here first). `resumed` = they came back within the grace period |
| `peer-left` | `{userId, reason}`: `left` or `disconnected` |
| `signal` | `{id, from, type, payload}` |
| `room-ended` | `{reason, by?}`: `ended_by_user`, `empty`, `expired`, `booking_cancelled`, `booking_done`, `superseded` (you joined again from another stream) |

Rules:
* Only the lesson's learner and teacher; everyone else gets **404** (they cannot tell a room exists). Ended or expired rooms answer **410** with the reason.
* Messages are checked (type whitelist, field types, sizes, max 240 per person per minute) and go **only to the addressee**.
  They are never written to the database or the log.
* The person already in the room makes the offer. Joins run one at a time in this single Node process, so there is
  never an "offer collision".
* A dropped stream has **20 s** to come back (`peer-joined` with `resumed: true`), otherwise the others get `peer-left`.
* An empty room ends after **2 minutes**; every room ends after **3 hours**; cancelling or checking in to a lesson ends its room.

**Limit (free Render plan, one instance):** presence is in memory. A deploy or restart drops the streams; the phones
reconnect and the database still knows the room. Several server instances would need a shared message bus (e.g. Redis).

## Set up TURN (Cloudflare Realtime): about 5 minutes
Without TURN, phones that cannot reach each other directly (common on mobile data behind carrier NAT) **cannot connect**.
Cloudflare's TURN gives the first 1,000 GB per month free, then $0.05 per GB.

1. Log in at <https://dash.cloudflare.com> (a free account is enough).
2. Open **Realtime** (older name: **Calls**) → **TURN Server** → **Create**, and give it a name, e.g. `skillswap`.
3. Copy the two values it shows: the **Turn Token ID** and the **API Token**. The API token is shown once, so keep it safe and never put it in the app or on GitHub.
4. Render → your `skillswap` service → **Environment** → add
   `TURN_KEY_ID` = Turn Token ID, `TURN_KEY_API_TOKEN` = API Token → **Save** (Render redeploys).
5. Check: open `https://<your-app>.onrender.com/api/mobile/health`. It should show `"turn": true`.

The server asks Cloudflare for credentials that expire after 4 hours each time a room is opened. The long-term key
never leaves the server, and nothing is hardcoded in the app.

## Likely viva questions
1. *Does the video go through your server?* No. WebRTC sends it phone to phone (or via the TURN relay, still encrypted end to end with DTLS-SRTP). The server only passes the "how to connect" messages.
2. *Why SSE and not WebSockets?* SSE already works through Render's proxy for live updates; down = SSE, up = normal POSTs. No new library on either side. It sits behind one interface in the app, so it could be swapped later.
3. *How do you stop a stranger joining?* Every route checks the booking's learner/teacher; strangers get 404, and room ids are random UUIDs.
4. *What about group lessons?* Every message is addressed `from`/`to` a participant id, so the protocol already supports more people. Media for groups should go through an SFU (e.g. Cloudflare Realtime SFU) instead of every phone sending to every other phone.
