-- 12_telegram.sql : the SkillSwap Telegram bot (booking alerts, lesson reminders, /next, /credits).
-- Idempotent: safe to run on every start.

-- A SkillSwap account linked to a Telegram chat (one chat per account, one account per chat).
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id   BIGINT      NOT NULL UNIQUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time codes inside the t.me/<bot>?start=<code> link; they expire after 15 minutes.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code       VARCHAR(32) PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "In 1 hour" reminders already sent, so a weekly lesson is reminded once per week.
CREATE TABLE IF NOT EXISTS telegram_reminders (
  booking_id INTEGER   NOT NULL REFERENCES slot_bookings(id) ON DELETE CASCADE,
  lesson_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (booking_id, lesson_at)
);
