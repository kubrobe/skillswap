# SkillSwap

A mobile-first website where members offer a practical skill, say what they want to learn, get matched, and send each other swap requests. Course project for Big Data (database-backed website).

**Stack:** Node.js + Express (server), **PostgreSQL** (database), plain HTML/CSS/JavaScript (pages, no framework).
**Why:** the course guide's own stack is Node/Express + PostgreSQL, so it is easy to grade and explain. Plain JS keeps every line readable.

## Run it (Windows)

1. Install **Node.js LTS** (nodejs.org) and **PostgreSQL 16** (postgresql.org/download/windows). Remember the password you set for the `postgres` user.
2. Open **pgAdmin → Query Tool** (connected as `postgres`) and run:
   ```sql
   CREATE ROLE skillswap LOGIN PASSWORD 'skillswap';
   CREATE DATABASE skillswap OWNER skillswap;
   ```
3. In the project folder (VS Code terminal; if `npm` is blocked, use **Command Prompt** instead of PowerShell):
   ```
   npm install
   npm run db:reset     (creates all tables and loads demo data)
   npm run dev          (starts the site on http://localhost:3000)
   npm test             (runs the 10 automated tests)
   ```
To use a different database, set `DATABASE_URL` (default: `postgres://skillswap:skillswap@localhost:5432/skillswap`).

**Demo accounts** (all fictional): `aziza@demo.uz`, `kamola@demo.uz`, `timur@demo.uz` ... password `demo12345`.

## What is implemented

| Area | What it does | Where |
|---|---|---|
| Accounts | Register, log in, log out. Passwords hashed with bcrypt. Login sessions stored in the database, cookie is httpOnly + SameSite | `src/auth.js` |
| Profiles | Name, city, bio; public member page | `src/api.js`, `public/js/profile.js`, `member.js` |
| Skills | Catalog (7 categories, 23 skills). Members add/remove skills they **offer** and skills they **want** | `db/02_catalog.sql`, `public/js/skills.js` |
| Search | By member name, city or skill, plus category filter; "most offered skills" statistic | `GET /api/members`, `/api/stats/popular-skills` |
| Matching | Members who offer what I want / want what I offer; **fair two-way swaps first** | `GET /api/matches` |
| Exchanges | Send request (my skill for theirs), accept / decline / cancel / mark done, full status history | `POST/PATCH /api/exchanges` |
| Validation | Server checks every input; database CHECK / UNIQUE / FOREIGN KEY constraints as a second layer | `src/validate.js`, `db/01_schema.sql` |

## Database (PostgreSQL, 9 tables, 3NF)

ERD: `docs/erd.png` (source `docs/erd.mmd`). Schema: `db/01_schema.sql`.

- **users** 1—1 **profiles** (login data separate from public data)
- **categories** 1—N **skills**
- **users** M—N **skills** through two junction tables: **user_offers** (can teach) and **user_requests** (wants to learn), each `UNIQUE (user_id, skill_id)`
- **exchanges** links a requester, a provider and two skills; `CHECK (requester_id <> provider_id)`, status `CHECK`, and a partial unique index that blocks duplicate pending requests
- **exchange_status_log** keeps the history of every status change
- **sessions** stores a hash of each login token

Transactions (BEGIN/COMMIT/ROLLBACK) are used in: registration (user + profile), creating an exchange (rules check + insert + log), and changing an exchange status (row lock `FOR UPDATE` + update + log).

## Course requirements check (from `sources/` guide PDFs)

| Requirement in the guide | Status |
|---|---|
| ≥ 6 SQL tables, at least one many-to-many | Done (9 tables) |
| ≥ 30 rows of sample data | Done (about 94 rows after `db:reset`; fictional people) |
| ER diagram | Done as `docs/erd.png`. **Redraw it yourself in pgAdmin's ERD tool** as the guide suggests |
| ≥ 8 API routes, ≥ 4 pages | Done (about 20 routes, 8 pages) |
| 1 transaction with tested failure case | Done, tested in `tests/api.test.js` |
| bcrypt login, parameterised SQL, validation | Done |
| **MongoDB: ≥ 2 collections, one with ≥ 10,000 documents** | **Not done.** The PDFs require it, but the project brief said PostgreSQL or MySQL. Ask your professor which applies |
| **500,000-row index experiment** | **Not done** |
| **Deployment (public URL)** | **Not done** |
| **Report, slides, 7-minute demo** | **Not done** (the report must contain your own screenshots and results) |

## Open questions for the professor (not guessed)

- Deadlines: a previous conversation said "Thursday report"; the brief says proposal Dec 10, 2026 4 PM and final demo in teaching week 15; the PDF I was given mentions neither. Confirm which applies.
- Is MongoDB required, or is one relational database enough?

## Verification status

- **Verified in this environment:** 10 automated API/database tests pass; browser test of sign-up, skills, search, matching, swap request, accept, validation errors, login failure, protected-page redirect; pages have no horizontal scroll at 360px wide.
- **Not verified:** real phones, Safari/Firefox, screen readers, keyboard-only use beyond default browser behaviour, performance with large data, HTTPS/production hosting.
- **Known gaps:** no email verification, password reset, rate limiting on login, or messaging between members; an accepted swap shows no contact details yet.


---

## Update (final state)

- **Database:** PostgreSQL, 10 tables (adds `exchange_status_log`, `search_log`). Schema `db/01_schema.sql`, catalog `db/02_catalog.sql`, seed `db/seed.js` / `db/02_seed.sql`.
- **Queries:** `db/03_queries.sql` has 20 queries (CRUD, JOIN, GROUP BY/HAVING, view, window, subquery, transaction, CTE matching).
- **Big data:** `npm run db:bigdata` runs the 500,000-row index experiment (`db/04_big_data.sql`, results in `docs/big_data_results.json`).
- **MongoDB (optional):** set `MONGODB_URI`, then `npm run mongo:setup` and `npm run mongo:queries`. Not verified against a real MongoDB server; the pipelines are unit-tested with `mingo`.
- **Tests:** `npm test` runs 16 tests. `tests/e2e_browser.py` is the Playwright browser flow check (needs the server running).
- **Deployment:** configuration is in `render.yaml` and `docs/DEPLOY.md`. It has not been deployed yet.
- **Study material:** `docs/DEFENSE_GUIDE.md` (questions the professor may ask) and `docs/DEMO_SCRIPT.md` (7-minute plan).
- All members and data are fictional demo data.

## Update: reviews, swap history, day/night mode
- `reviews` table (PostgreSQL): rating 1-5 (CHECK), one review per person per swap (UNIQUE (exchange_id, reviewer_id)), no self-review (CHECK). Only participants of a COMPLETED swap can review.
- Swap history on the Swaps page comes from `exchange_status_log` (written in the same transaction as every status change).
- Day/night mode toggle (saved per browser). Loading placeholders, toast messages and a profile avatar in the header.
- Existing database (e.g. Supabase): run `npm run db:migrate` once to add the `reviews` table without losing data. A fresh `npm run db:reset` also creates it and adds 3 demo swaps with reviews.

## Update: chat, notifications, learning workspace, availability
- New tables: `messages`, `notifications`, `workspaces`, `milestones`, `availability` (+ `profiles.time_zone`). See `docs/COLLAB_DESIGN.md` for the design and the viva questions.
- Pages: `/notifications` (bell in the header), `/messages`, `/chat?id=`, `/workspace?id=`; availability is edited on `/profile` and shown on member pages.
- Existing database (e.g. Supabase): run `npm run db:migrate` once. It now applies both `db/05_reviews.sql` and `db/06_collab.sql`, keeps all data, and is safe to run twice.
- Tests: `npm test` now has 23 API/unit tests plus the MongoDB pipeline tests.
