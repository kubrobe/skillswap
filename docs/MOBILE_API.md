# SkillSwap mobile API (used by the Android app)

The website and the Android app share **one backend**: the same Express server on Render and the
same PostgreSQL database on Supabase. An account made on the website works in the app and the other way round.

## How the app logs in
* `POST /api/mobile/login` returns a random **session token**. The server stores only its SHA-256 hash
  in the same `sessions` table the website uses.
* The website keeps the token in an httpOnly cookie. The app keeps it and sends
  `Authorization: Bearer <token>` with every request (phones have no cookie jar).
* `POST /api/mobile/logout` deletes the session row, so the token stops working at once.

## Endpoints (all JSON)
| Method | Path | What it does |
|---|---|---|
| GET  | `/api/mobile/health` | public check that the server and database are up |
| GET  | `/api/mobile/events` | **live updates** (Server-Sent Events): `changed` + personal `notice` messages |
| POST | `/api/mobile/wants` | my wish list (what I want to learn) → used for perfect matches |
| POST | `/api/mobile/bookings/:id/plan` | 60-minute lesson plan (AI if `ANTHROPIC_API_KEY` is set, otherwise a template), cached |
| POST | `/api/mobile/register` | new account → `{token, user}` |
| POST | `/api/mobile/login` | `{token, user}` |
| POST | `/api/mobile/logout` | ends the session |
| GET  | `/api/mobile/sync` | the whole snapshot: users, skills, offers, slots, bookings, reviews |
| POST/PATCH | `/api/mobile/me` | change name and bio |
| POST | `/api/mobile/offers` | publish a lesson: offer + its time slots in **one transaction** |
| POST | `/api/mobile/bookings` | book a slot (transaction + `SELECT … FOR UPDATE`) |
| POST | `/api/mobile/bookings/:id/cancel` | learner **or teacher** cancels; the slot becomes free again |
| POST | `/api/mobile/bookings/:id/complete` | learner marks the lesson as done; the weekly slot is free again |
| POST | `/api/mobile/bookings/:id/review` | rate a finished lesson once (1–5) |

## New tables (db/07_mobile.sql)
* `offer_slots` – weekly times of a `user_offers` row (weekday 1–7, hour 0–23, `is_booked`)
* `slot_bookings` – learner + slot + status (`BOOKED` / `DONE` / `CANCELLED`).
  A partial unique index allows only **one live booking per slot**.
* `slot_reviews` – one rating per finished booking
* `skills.emoji` – a small picture for each skill

`users`, `profiles`, `skills`, `user_offers` and `sessions` are shared with the website, so a lesson
published in the app also appears on the website's member pages.

## Business rules (checked on the server, inside transactions)
* You cannot book your own lesson.
* You cannot have two lessons at the same weekday + hour.
* Ten people pressing "Book" on one slot at the same moment → exactly one wins (tested in `tests/mobile.test.js`).
* Only the learner can cancel / finish / rate; rating only after the lesson is done, and only once.

## Privacy of /sync
* Bookings: only my own bookings and bookings of my lessons — never other people's plans.
* Other users: name + bio only; their e-mail is replaced by a placeholder.
* Reviews are public, but carry only the learner's first name.

## Security on the phone
The token is encrypted with an AES-256-GCM key kept in the **Android Keystore** before it is saved.

## Offline
The app saves the last snapshot in Room (SQLite). Without internet it shows the saved data;
changes need the server. Accounts created while offline stay on the phone only.

## Hackathon features
* **Time bank** (`credit_ledger`, db/08_hackathon.sql): 5 welcome credits; booking costs 1 (inside the booking
  transaction, with the user row locked so the last credit cannot be spent twice); cancel refunds it;
  finishing a lesson pays the teacher 1. The balance is `SUM(amount)` — every credit is traceable.
* **Perfect matches**: people who teach what I want; two-way swaps (they also want what I teach) come first.
* **Live updates** (src/live.js): each phone keeps one SSE connection; the server pushes `changed` to everyone
  and a personal `notice` ("Bobur booked your Python lesson") to the right person. 20-second pings keep it alive.
* **AI lesson plan** (src/plan.js): optional Claude call with a 20-second timeout; falls back to a template,
  so the demo never fails. Set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`) in Render to enable AI.
