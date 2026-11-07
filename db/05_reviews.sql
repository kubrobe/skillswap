-- Migration for a database that already exists (Supabase): adds the reviews table without touching any data.
-- Safe to run twice. Run it with:  npm run db:migrate

-- 7b. Reviews: after a swap is completed, each of the two people can rate the other (1-5) once.
CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  exchange_id INTEGER     NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  reviewer_id INTEGER     NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  reviewee_id INTEGER     NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     VARCHAR(300) NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, reviewer_id),             -- one review per person per swap
  CONSTRAINT no_self_review CHECK (reviewer_id <> reviewee_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id, created_at DESC);
