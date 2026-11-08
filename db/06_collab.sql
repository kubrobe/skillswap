-- Collaboration features: messages, notifications, learning workspace, availability.
-- Safe to run more than once (IF NOT EXISTS) and it never deletes data. Run with: npm run db:migrate

-- Private chat between the two people of an ACCEPTED (or completed) swap.
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  exchange_id INTEGER      NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  sender_id   INTEGER      NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  body        VARCHAR(1000) NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ                                   -- NULL = the other person has not read it yet
);
CREATE INDEX IF NOT EXISTS idx_messages_exchange ON messages(exchange_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread   ON messages(exchange_id) WHERE read_at IS NULL;

-- Short messages shown under the bell icon.
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(20)  NOT NULL CHECK (type IN ('request','accepted','declined','cancelled','completed','message','review','milestone')),
  body       VARCHAR(200) NOT NULL,
  link       VARCHAR(100) NOT NULL DEFAULT '/exchanges',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Learning workspace of one swap: one row of goals/notes + a list of milestones.
CREATE TABLE IF NOT EXISTS workspaces (
  exchange_id INTEGER PRIMARY KEY REFERENCES exchanges(id) ON DELETE CASCADE,
  objective   VARCHAR(300)  NOT NULL DEFAULT '',
  notes       VARCHAR(2000) NOT NULL DEFAULT '',
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS milestones (
  id          SERIAL PRIMARY KEY,
  exchange_id INTEGER      NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  title       VARCHAR(120) NOT NULL CHECK (length(btrim(title)) > 0),
  status      VARCHAR(5)   NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  position    INTEGER      NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_milestones_exchange ON milestones(exchange_id, position, id);

-- Weekly availability: weekday 0 = Monday ... 6 = Sunday. Times are local to profiles.time_zone.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS time_zone VARCHAR(40) NOT NULL DEFAULT 'Asia/Tashkent';
CREATE TABLE IF NOT EXISTS availability (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  CONSTRAINT end_after_start CHECK (end_time > start_time),
  UNIQUE (user_id, weekday, start_time)
);
