-- Sign in with Google (website + Android app share it).
-- google_sub = Google's permanent id for the person ("sub" in the ID token). It never changes,
-- even if the person changes their Gmail address, so we link accounts by it, not by email.
-- A Google-only account has no password, so password_hash may now be NULL
-- (the login routes treat NULL as "no password set").
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub);
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
