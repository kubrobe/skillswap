# SkillSwap

Trade skills, not bills. SkillSwap is a mobile-first website where members offer a practical skill, say what they want to learn, get matched with each other, swap skills, and book one-hour lessons paid for with time-bank credits. An Android app uses the same backend and database ([skillswap-android](https://github.com/kubrobe/skillswap-android)).

Course project for Big Data (database-backed website).

**Live site:** https://skillswap-vqt7.onrender.com (free hosting: the first page load after a quiet period can take up to a minute while the server wakes up)

**Stack:** Node.js + Express (server), PostgreSQL on Supabase (database), plain HTML/CSS/JavaScript (pages, no framework). MongoDB is optional (reviews and activity statistics).

## Features

| Area | What it does |
|---|---|
| Accounts | Register, log in, log out. Passwords hashed with bcrypt; login sessions stored in the database; httpOnly + SameSite cookie |
| Profiles | Name, city, bio, time zone, weekly availability; public member page |
| Skills | Catalog of categories and skills; members add skills they **offer** and skills they **want** |
| Search and matching | Search by name, city, skill or category; matches where both people can teach each other come first |
| Swaps | Send a request (my skill for yours), accept / decline / cancel / mark done, full status history |
| Reviews | Rating 1-5 after a completed swap, one review per person per swap |
| Lessons and time bank | Book a one-hour lesson with credits, check in with the teacher's code, video room, lesson plan, rate the lesson |
| Community | Messages, notifications, learning workspace with milestones, community impact page, Skill Galaxy, badges and weekly leaderboard |
| Live updates | Credits, notifications and the activity feed update by themselves (server-sent events) |
| Telegram bot | Booking alerts and lesson reminders (optional) |

## Run it locally

You need **Node.js LTS** and **PostgreSQL 16**.

1. Create the database (pgAdmin Query Tool, connected as `postgres`):
   ```sql
   CREATE ROLE skillswap LOGIN PASSWORD 'skillswap';
   CREATE DATABASE skillswap OWNER skillswap;
   ```
2. In the project folder:
   ```
   npm install
   npm run db:reset     # creates all tables and loads demo data
   npm run dev          # http://localhost:3000
   npm test             # runs the automated tests
   ```
3. Optional: copy `.env.example` to `.env` to change settings. To use another database (for example Supabase) set `DATABASE_URL`. **Never commit `.env`.**

On Windows, if `npm` is blocked in PowerShell, use Command Prompt.

**Demo accounts** (fictional): `aziza@demo.uz`, `kamola@demo.uz`, `timur@demo.uz` ... password `demo12345`.

### Useful commands

| Command | What it does |
|---|---|
| `npm run db:reset` | Drops and recreates all tables, loads demo data |
| `npm run db:migrate` | Adds newer tables to an existing database without losing data (safe to run twice) |
| `npm run db:bigdata` | Runs the 500,000-row index experiment (results in `docs/big_data_results.json`) |
| `npm run mongo:setup` / `npm run mongo:queries` | Optional MongoDB collections and aggregation queries (need `MONGODB_URI`) |

Deployment on Render + Supabase is described in `docs/DEPLOY.md`.

## Database (PostgreSQL, 24 tables)

Schema in `db/01_schema.sql`; later files (`05_` to `12_`) add reviews, collaboration, lessons and the Telegram bot. Ready-made queries (JOIN, GROUP BY/HAVING, view, window function, subquery, CTE, transaction) are in `db/03_queries.sql`.

| Group | Tables |
|---|---|
| Accounts | `users`, `profiles`, `sessions` |
| Catalog | `categories`, `skills`, `user_offers`, `user_requests` (many-to-many between users and skills) |
| Swaps | `exchanges`, `exchange_status_log`, `reviews` |
| Collaboration | `messages`, `notifications`, `workspaces`, `milestones`, `availability` |
| Lessons and time bank | `offer_slots`, `slot_bookings`, `slot_reviews`, `credit_ledger`, `lesson_plans` |
| Telegram | `telegram_links`, `telegram_link_codes`, `telegram_reminders` |
| Analytics | `search_log` |

Integrity rules live in the database as well as in the code: `CHECK`, `UNIQUE` and `FOREIGN KEY` constraints, for example no swap with yourself, one review per person per swap, and a unique index that blocks duplicate pending requests.

**Transactions** (`BEGIN` / `COMMIT` / `ROLLBACK`) are used wherever several writes must succeed together: registration (user + profile), creating and updating a swap (row lock `FOR UPDATE` + update + history log), and booking a lesson (slot still free, credit available, all or nothing).

**Big data experiment:** `db/04_big_data.sql` and `db/measure_big_data.js` load 500,000 rows and compare query times before and after adding indexes. The measured results are in `docs/big_data_results.json`.

## API

About 59 routes under `/api` (website) and `/api/mobile` (Android app). The mobile API is documented in `docs/MOBILE_API.md`.

## Security

- Passwords: bcrypt. Sessions: random token, only its hash is stored.
- All SQL is parameterised; every input is validated on the server (`src/validate.js`).
- Content-Security-Policy `default-src 'self'` (fonts and icons are self-hosted).
- Secrets (database URL, bot token, AI key) come from environment variables only and are never committed. `render.yaml` holds no secrets.

**Known limitations:** no email verification, no password reset, no rate limiting on login (only chat messages are rate-limited).

## Tests

`npm test` runs 47 automated tests (API, database rules, mobile API, MongoDB pipelines). `tests/e2e_browser.py` is an optional Playwright browser check (needs the server running).

## Documentation

- `docs/DEFENSE_GUIDE.md` - questions the professor may ask, with answers
- `docs/DEMO_SCRIPT.md` - 7-minute demo plan
- `docs/COLLAB_DESIGN.md` - design of chat, notifications and workspaces
- `docs/MOBILE_API.md` - API used by the Android app
- `docs/DEPLOY.md` - hosting on Supabase and Render
- `docs/erd.png` - entity-relationship diagram

## Team

| Name | Group | Role |
|---|---|---|
| Abdullox Xojimurodov (leader) | I24B | Backend: server, database, API |
| Biloliddin To'laganov | I24B | Design: colours, icons, screens |
| Najmiddin Kurganov | I24A | Android app and website front end |

All members and data in the demo are fictional.
