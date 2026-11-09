-- Hackathon features: skill credits (time bank) and cached lesson plans. Idempotent.

-- 1. Time bank. Every change of credits is one row; the balance is SUM(amount).
--    Keeping the history (a ledger) instead of one "balance" number means nothing can be
--    lost or invented: every credit can be traced to a lesson.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     SMALLINT    NOT NULL CHECK (amount <> 0),
  reason     VARCHAR(10) NOT NULL CHECK (reason IN ('welcome','booked','refund','taught')),
  booking_id INTEGER     REFERENCES slot_bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_user ON credit_ledger(user_id, created_at DESC);
-- Each person gets the welcome gift only once.
CREATE UNIQUE INDEX IF NOT EXISTS one_welcome_gift ON credit_ledger(user_id) WHERE reason = 'welcome';

-- Everybody who already exists gets the welcome gift (5 credits = 5 lessons).
INSERT INTO credit_ledger (user_id, amount, reason)
SELECT id, 5, 'welcome' FROM users
ON CONFLICT (user_id) WHERE reason = 'welcome' DO NOTHING;

-- 2. Lesson plans are generated once per booking and then reused.
CREATE TABLE IF NOT EXISTS lesson_plans (
  booking_id INTEGER PRIMARY KEY REFERENCES slot_bookings(id) ON DELETE CASCADE,
  plan       TEXT        NOT NULL,
  source     VARCHAR(10) NOT NULL CHECK (source IN ('ai','template')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
