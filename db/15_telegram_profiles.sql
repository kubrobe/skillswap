-- 15_telegram_profiles.sql : log in with Telegram, @username, richer profile, contact privacy.
-- Idempotent: safe to run on every server start and safe to paste into the Supabase SQL editor.
-- Existing rows are kept; nothing is deleted.

-- 1. Who may see my Telegram username and phone:
--    everyone | matches (people I share a lesson with, or a two-way "perfect match") | nobody
DO $$ BEGIN
  CREATE TYPE contact_visibility AS ENUM ('everyone', 'matches', 'nobody');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. New profile columns on users.
--    username: stored in lower case (so "unique" is also case-insensitive), 3-20 chars, a-z 0-9 _, starts with a letter.
--    The first time the column is added, every existing member gets a username made from their name + 4 random
--    digits, so nobody is left without one. Members who register later choose their own in the app.
DO $$
DECLARE
  u RECORD;
  base TEXT;
  candidate TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'username') THEN
    ALTER TABLE users ADD COLUMN username VARCHAR(20)
      CONSTRAINT users_username_format CHECK (username ~ '^[a-z][a-z0-9_]{2,19}$'
                                              AND username NOT IN ('admin', 'skillswap', 'support'));
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);

    FOR u IN SELECT us.id, p.display_name FROM users us LEFT JOIN profiles p ON p.user_id = us.id ORDER BY us.id LOOP
      -- first name in lower case: "Aziza Karimova" -> "aziza"; a name without Latin letters -> "user"
      base := left(regexp_replace(split_part(lower(trim(COALESCE(u.display_name, ''))), ' ', 1), '[^a-z0-9]', '', 'g'), 14);
      IF base !~ '^[a-z]' THEN base := 'user'; END IF;
      LOOP
        candidate := base || lpad((floor(random() * 10000))::int::text, 4, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE username = candidate);
      END LOOP;
      UPDATE users SET username = candidate WHERE id = u.id;
    END LOOP;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(32)        -- without the "@"
  CONSTRAINT users_telegram_username_format CHECK (telegram_username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT;                  -- Telegram's permanent id of the person
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(16)                    -- E.164, e.g. +998901234567
  CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS faculty VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS study_year SMALLINT
  CONSTRAINT users_study_year_range CHECK (study_year BETWEEN 1 AND 4);
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_visibility contact_visibility NOT NULL DEFAULT 'matches';

-- 3. One-time tokens for "Continue with Telegram" (t.me/<bot>?start=login_<token>).
--    Only the SHA-256 hash of the token is stored. A token lives 5 minutes and is deleted when it is used.
CREATE TABLE IF NOT EXISTS telegram_login_tokens (
  token_hash    CHAR(64)    PRIMARY KEY,
  telegram_id   BIGINT,                 -- filled when the person taps Start in Telegram
  tg_username   VARCHAR(32),
  tg_first_name VARCHAR(64),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tg_login_created ON telegram_login_tokens (created_at);

-- 4. Supabase: the website and the app read ONLY through our server, which applies the contact-privacy rule.
--    Supabase also publishes every table through its own REST API for the "anon" / "authenticated" roles.
--    Close that door for the tables that hold private data (phone, Telegram, password hashes, sessions, tokens).
--    Our server connects as the table owner, which row level security does not restrict.
DO $$
DECLARE
  t TEXT;
  owner_or_bypass BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'telegram_links', 'telegram_link_codes', 'telegram_login_tokens'] LOOP
    -- Only when the role running this file is not limited by row level security itself
    SELECT (r.rolsuper OR r.rolbypassrls OR c.relowner = r.oid) INTO owner_or_bypass
      FROM pg_roles r, pg_class c
     WHERE r.rolname = current_user AND c.oid = to_regclass(t);
    IF owner_or_bypass THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
