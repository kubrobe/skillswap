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
| GET  | `/api/mobile/events` | **live updates** (Server-Sent Events): `changed`, personal `notice` and `credit` (+1), and `activity` lines for everyone |
| GET  | `/api/mobile/impact` | public community numbers for the Impact screen (no personal data) |
| GET  | `/api/mobile/galaxy` | Skill Galaxy: people (first names) and lessons from teacher to learner, app + website |
| POST | `/api/mobile/match` | AI matchmaker: `{text, lang}` → 3 best lessons with a reason each (AI or keyword fallback) |
| GET  | `/api/mobile/achievements` | my 8 badges (progress / goal) and the top-10 teachers this week and all time |
| GET  | `/api/mobile/telegram` | is the bot set up, is my Telegram linked |
| POST | `/api/mobile/telegram/link` | a one-time `t.me/<bot>?start=<code>` link (15 minutes) |
| POST | `/api/mobile/telegram/unlink` | stop Telegram messages |
| POST | `/api/mobile/wants` | my wish list (what I want to learn) → used for perfect matches |
| POST | `/api/mobile/bookings/:id/plan` | 60-minute lesson plan (AI if `ANTHROPIC_API_KEY` is set, otherwise a template), cached |
| POST | `/api/mobile/register` | new account → `{token, user}` |
| POST | `/api/mobile/login` | `{token, user}` |
| POST | `/api/mobile/logout` | ends the session |
| GET  | `/api/mobile/sync` | the whole snapshot: users, skills, offers, slots, bookings, reviews, wallet, wishes, matches, last 12 activity lines |
| POST/PATCH | `/api/mobile/me` | change name and bio |
| POST | `/api/mobile/offers` | publish a lesson: offer + its time slots in **one transaction** |
| POST | `/api/mobile/bookings` | book a slot (transaction + `SELECT … FOR UPDATE`) |
| POST | `/api/mobile/bookings/:id/cancel` | learner **or teacher** cancels; the slot becomes free again |
| POST | `/api/mobile/bookings/:id/complete` | learner checks in with the teacher's 4-digit code (QR); the slot is free again, the teacher gets +1 |
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

## Always online
Supabase (through this server) is the only source of truth. The app keeps the last snapshot in Room
only as a cache so screens open instantly; every change goes to the server first.

## Hackathon features
* **Time bank** (`credit_ledger`, db/08_hackathon.sql): 5 welcome credits; booking costs 1 (inside the booking
  transaction, with the user row locked so the last credit cannot be spent twice); cancel refunds it;
  finishing a lesson pays the teacher 1. The balance is `SUM(amount)` — every credit is traceable.
* **Perfect matches**: people who teach what I want; two-way swaps (they also want what I teach) come first.
* **Live updates** (src/live.js): each phone keeps one SSE connection; the server pushes `changed` to everyone
  and a personal `notice` ("Bobur booked your Python lesson") to the right person. 20-second pings keep it alive.
* **AI lesson plan** (src/plan.js): optional Claude call with a 20-second timeout; falls back to a template,
  so the demo never fails. Set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`) in Render to enable AI.
* **Check-in** (db/10_checkin.sql): every booking gets a random 4-digit code that only the teacher sees (also as a QR).
  The learner scans it to finish the lesson, so credits cannot be farmed without meeting.
  Teachers with 2+ finished lessons and an average of 4.5+ get a **✓ Trusted** badge.
* **Swipe to swap + flying coin + LIVE ticker**: `activity` events and the `activity` list in /sync feed the ticker
  (learners stay anonymous); the `credit` event plays the +1 coin on the teacher's phone.
* **Community impact** (`GET /impact`): members, teachers, finished lessons (app lessons + website swaps), hours,
  credits in circulation, average rating, finished lessons per week (8 weeks) and the top skills.
  "Money saved" is an **estimate**: finished lessons × `AVG_TUTOR_PRICE_UZS` (default 100,000 UZS per hour).
  `db/11_impact_history.sql` adds SAMPLE finished lessons between the demo accounts so the chart has history.
* **Telegram bot** (`src/telegram.js`, `db/12_telegram.sql`): every personal live notice also goes to the linked
  Telegram chat, plus a reminder 1 hour before each weekly lesson (Tashkent time, once per week) and the commands
  `/next`, `/credits`, `/stop`. Telegram calls `POST /telegram/webhook` (checked with a secret header).
  **Setup:** in Telegram open @BotFather → `/newbot` → copy the token → Render → Environment →
  `TELEGRAM_BOT_TOKEN` = the token → Save. On start the server sets its webhook itself (`RENDER_EXTERNAL_URL`).
  Optional in @BotFather: `/setcommands` → `next - My upcoming lessons`, `credits - My credit balance`, `stop - Unlink`.
