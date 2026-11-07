-- SkillSwap schema (PostgreSQL). Run with:  npm run db:reset
-- Normalized to 3NF: every non-key column depends only on its table's key.

DROP VIEW IF EXISTS v_mutual_matches;
DROP TABLE IF EXISTS search_log, exchange_status_log, exchanges, user_requests, user_offers,
                     skills, categories, profiles, sessions, users CASCADE;

-- 1. Accounts: login data only
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,              -- bcrypt hash, never the password
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email LIKE '%_@_%._%')
);

-- 2. Public profile: one row per user (1:1 with users)
CREATE TABLE profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(60)  NOT NULL CHECK (length(trim(display_name)) >= 2),
  city         VARCHAR(80),
  bio          VARCHAR(500) NOT NULL DEFAULT ''
);

-- 3. Login sessions (cookie holds a random token; we store only its hash)
CREATE TABLE sessions (
  token_hash CHAR(64)    PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 4. Skill catalog: categories 1:N skills
CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE skills (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER     NOT NULL REFERENCES categories(id),
  name        VARCHAR(80) NOT NULL UNIQUE
);

-- 5. MANY-TO-MANY users <-> skills, in two roles (junction tables)
--    A user can teach many skills; a skill can be taught by many users.
CREATE TABLE user_offers (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  skill_id    INTEGER NOT NULL REFERENCES skills(id),
  level       VARCHAR(12) NOT NULL DEFAULT 'intermediate'
              CHECK (level IN ('beginner','intermediate','advanced')),
  description VARCHAR(300) NOT NULL DEFAULT '',
  UNIQUE (user_id, skill_id)                       -- no duplicate offers
);

CREATE TABLE user_requests (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  skill_id    INTEGER NOT NULL REFERENCES skills(id),
  description VARCHAR(300) NOT NULL DEFAULT '',
  UNIQUE (user_id, skill_id)
);

-- 6. Exchange requests: "I'd like to learn X from you, and I can teach you Y"
CREATE TABLE exchanges (
  id                  SERIAL PRIMARY KEY,
  requester_id        INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  provider_id         INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  skill_wanted_id     INTEGER NOT NULL REFERENCES skills(id),  -- provider teaches this
  skill_offered_id    INTEGER NOT NULL REFERENCES skills(id),  -- requester teaches this
  message             VARCHAR(300) NOT NULL DEFAULT '',
  status              VARCHAR(10)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','cancelled','completed')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT no_self_exchange CHECK (requester_id <> provider_id)
);

-- At most one open (pending) request per pair + skill combination
CREATE UNIQUE INDEX one_pending_exchange
  ON exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id)
  WHERE status = 'pending';

-- 7. History of status changes (written inside the same transaction as the change)
CREATE TABLE exchange_status_log (
  id          SERIAL PRIMARY KEY,
  exchange_id INTEGER     NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  status      VARCHAR(10) NOT NULL,
  changed_by  INTEGER     NOT NULL REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the joins we actually run (matching + inbox)
CREATE INDEX idx_offers_skill    ON user_offers(skill_id);
CREATE INDEX idx_requests_skill  ON user_requests(skill_id);
CREATE INDEX idx_exch_provider   ON exchanges(provider_id, status);
CREATE INDEX idx_exch_requester  ON exchanges(requester_id, status);
CREATE INDEX idx_sessions_user   ON sessions(user_id);

-- 8. Search log: one row per search made in the app (also the table used for the
--    500,000-row index experiment in 04_big_data.sql).
--    NOTE: there is deliberately NO index on skill_id / searched_at here; the experiment adds it.
CREATE TABLE search_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  skill_id    INTEGER REFERENCES skills(id),              -- NULL when the text matched no skill
  term        VARCHAR(60) NOT NULL,
  device      VARCHAR(10) NOT NULL DEFAULT 'mobile' CHECK (device IN ('mobile','desktop','tablet')),
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_user ON search_log(user_id);
