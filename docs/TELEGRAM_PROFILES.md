# Telegram login, @username and one-tap contact

Branch `feature/telegram-profiles` in both repositories (`kubrobe/skillswap` = server + website,
`kubrobe/skillswap-android` = app). This page is the hand-over: what to deploy, what to set, and how to test.

## 1. Deploy order

1. **Server first.** The new server still works with the old app (it only adds fields and routes).
   The new app with the old server hides the Telegram button and the username features, so nothing breaks
   in either order, but the new features need the new server.
2. Then install the new app build.

## 2. SQL for Supabase

Everything is in **`db/15_telegram_profiles.sql`**. You have two ways, pick one:

- **Do nothing:** the server runs it by itself on every start (`src/migrations.js`), like the earlier files.
- **By hand:** Supabase → SQL Editor → paste the whole file → Run. It is safe to run more than once.

What it does:

| Change | Detail |
|---|---|
| `users.username` | unique, lower case, 3-20 chars, `a-z 0-9 _`, starts with a letter; `admin`, `skillswap`, `support` refused |
| backfill | the first time, every existing member gets `firstname` + 4 random digits (e.g. `aziza7110`) |
| `users.telegram_username`, `users.telegram_id` | Telegram username without `@`; Telegram's permanent id (unique) |
| `users.phone` | E.164, e.g. `+998901234567` |
| `users.faculty`, `users.study_year` (1-4), `users.languages` (`text[]`) | profile |
| `users.contact_visibility` | enum `everyone` / `matches` / `nobody`, default `matches` |
| `telegram_login_tokens` | one-time login tokens (only the SHA-256 hash is stored) |
| row level security | switched on for `users`, `sessions`, `telegram_links`, `telegram_link_codes`, `telegram_login_tokens`, and all rights of Supabase's `anon` / `authenticated` roles on them removed |

About row level security: the website and the app never read tables directly; they go through this server,
which applies the contact rule. Supabase also exposes tables through its own REST API, and that door is now
closed for the tables with private data. The server connects as the table owner, which is not restricted
(tested with a non-superuser owner: all 78 tests pass with RLS on).

## 3. Environment variables (Render → Environment)

| Variable | Needed | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes, for Telegram login and alerts | the token from @BotFather. **Secret: only here and in your local `.env`, never in the code.** `BOT_TOKEN` also works |
| `TELEGRAM_BOT_USERNAME` | optional | the bot's username without `@` (`BOT_USERNAME` also works). Without it the server asks Telegram |
| `PUBLIC_URL` | only outside Render | the server's public address, so Telegram can call the webhook. Render sets `RENDER_EXTERNAL_URL` itself |

If "Connect Telegram" already works on the live site, the token is already set and there is nothing to add.
Without a token the "Continue with Telegram" buttons are simply not shown.

How the bot gets messages: on Render by **webhook** (`/telegram/webhook`, as before). On your own computer
(no public address) the server uses **long polling** (`getUpdates`). If you start it locally with the same
bot token as the live server, Telegram refuses polling (the bot has a webhook) and the server says so in the log;
the live site is not affected. Use a second test bot for local work.

## 4. What was built

**Log in with Telegram** (website + app)
- `POST /api/auth/telegram/start` → `{ url: "https://t.me/<bot>?start=login_<token>", token, expiresIn: 300 }`
- `GET /api/auth/telegram/status?token=…` every 2 s → `pending` / `expired` / `confirmed` (sets the session cookie)
- The app uses the same two routes under `/api/mobile/auth/telegram/…` and gets `{ token, user, isNew }` like a normal login.
- The token is 32 random bytes, lives 5 minutes, works once, and is deleted when used or expired.
- The bot answers "✅ You're logged in to SkillSwap. Go back to the app."
- New Telegram person → new account (name = Telegram first name, welcome credits, bot alerts on).
  A person who used "Connect Telegram" before → their existing account.

**@username and profile**
- `GET /api/users/username-available?u=…`, `GET /api/users/by-username/:username` (app: `/api/mobile/users/…`)
- `POST/PATCH /api/mobile/me` and `PUT /api/me/profile` accept the new fields and refuse bad values with a clear message.
- Website search (`/api/members?q=`) also matches `@username`; the app's search does too, and has an `@username` chip.

**Contact privacy (on the server)**
- `telegram_username` and `phone` are sent only if the owner chose `everyone`, or chose `matches` and the viewer
  shares a booking with them (any status except cancelled; an accepted or completed website swap also counts)
  or is a two-way perfect match. Otherwise both are `null` and `contactsHidden` is `true`.
- The rule is one function, `canSeeContacts()` in `src/profiles.js`.
- Booking alert in Telegram: "📚 @learner booked your <skill> lesson on <date>. Tap to chat: t.me/<learner>".

## 5. Tests

- Server: `npm test` → 78 tests. New: `tests/profiles.test.js` (username, phone, the visibility rule for all
  3 settings × booked / not booked, and the API) and `tests/telegram-login.test.js` (the whole login flow with a
  stand-in for Telegram).
- App: `./gradlew testDebugUnitTest` → new `ProfileRulesTest` (username, phone, Telegram username).

## 6. Manual test on your phone

Before you start: server deployed, bot token set, new app installed. Use two people (A = you, B = a friend or a
second account on the website).

**A. Telegram login, new user**
1. Log out. On the login screen tap **Continue with Telegram** (blue, under Google).
2. Telegram opens the SkillSwap bot → tap **Start**. The bot says "✅ You're logged in…".
3. Go back to the app. Within about 2 seconds you are in. Expect: the **Pick your @username** screen.
4. Profile → Time bank shows 5 credits; the Telegram card says connected.

**B. Pick username**
1. Type `ab` → red "At least 3 characters". Type `admin` → red "reserved". Type a taken name → red "Already taken".
2. Type a free name → green "✓ Available" after a short pause → **Save**. The screen closes and does not come back.

**C. Telegram login, existing user**
1. Log out, tap **Continue with Telegram** again, tap Start.
2. Expect: the same account (same name, username, credits), no "Pick your @username" screen.
3. Also try: an email account that used "Connect Telegram" → log out → Continue with Telegram → the same email account.

**D. Edit profile**
1. Profile → **Edit profile**. Telegram username is already filled in.
2. Enter phone `901234567` → Save → error about the country code. Enter `+998 90 123 45 67` → saved.
3. Set faculty, year, languages, and "Who sees my Telegram and phone" = Lesson partners. Save.
4. Open the website → Profile: the same values are there. Change the faculty on the website → pull to refresh in the app.

**E. A stranger's profile (contacts hidden)**
1. As B (no lesson with A), open one of A's lessons in Browse.
2. Expect: `@username` under the teacher's name, and "🔒 Book a lesson to see contacts". No phone, no Telegram.

**F. Book their lesson (contacts visible)**
1. As B, book a time of A's lesson.
2. Open the lesson again, and Lessons → I learn. Expect: **Message on Telegram** and **Call** buttons.
3. A gets the Telegram message "📚 @b… booked your … lesson on …. Tap to chat: t.me/…".
4. Cancel the booking → the contacts are hidden again.

**G. Message on Telegram**
1. Tap **Message on Telegram** → the Telegram chat with that person opens (a browser page if Telegram is not installed).
2. Tap **Call** → the dialer opens with the number.

**H. Check that nothing else broke:** booking, credits, check-in (QR and code), review, live banner, video lesson, Google sign-in.

## 7. Known limits

- Tapping Start in Telegram is the whole confirmation. Someone who tricks a person into tapping Start on a link
  *they* created would be logged in as that person. Telegram-bot logins all share this; for a real launch add a
  "Is this you? Yes / No" step in the bot.
- A Telegram-only account has no email; the server stores `tg<id>@telegram.skillswap` because the column is required.
  The app hides it.
- `@username` is shown on offer cards, lesson detail, lessons and profile. It is not added to the perfect-match
  cards, the leaderboard or the Skill Galaxy.
- Server messages (errors, bot texts) are English only, like the existing ones.
