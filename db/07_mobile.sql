-- Tables used by the SkillSwap Android app (added on top of the website tables).
-- The app books a concrete weekly time slot of a teacher's offer, so it needs
-- slots + bookings + its own reviews. Users, skills and user_offers are SHARED
-- with the website: an offer published in the app appears on the website too.
-- This file is idempotent: running it twice changes nothing.

-- A small picture for each skill, so the app can show one without downloading images.
ALTER TABLE skills ADD COLUMN IF NOT EXISTS emoji VARCHAR(8) NOT NULL DEFAULT '🎓';
UPDATE skills SET emoji = v.emoji FROM (VALUES
  ('Python basics','🐍'), ('Web development (HTML/CSS)','💻'), ('SQL and databases','🗄️'),
  ('JavaScript','📜'), ('Excel and data analysis','📊'), ('English conversation','🗣️'),
  ('IELTS writing','✍️'), ('Korean for beginners','🇰🇷'), ('Russian','🇷🇺'),
  ('UI design in Figma','🎨'), ('Photo editing','🖼️'), ('Video editing','🎬'),
  ('Guitar','🎸'), ('Piano','🎹'), ('Gym training basics','🏋️'), ('Chess','♟️'),
  ('Running for beginners','🏃'), ('Public speaking','🎤'), ('Presentation design','📽️'),
  ('Academic writing','📝'), ('Cooking plov','🍛'), ('Baking','🧁'), ('Calligraphy','🖌️')
) AS v(name, emoji) WHERE skills.name = v.name AND skills.emoji <> v.emoji;

-- 1. Weekly time slots a teacher opens for one offer. weekday 1 = Monday ... 7 = Sunday.
CREATE TABLE IF NOT EXISTS offer_slots (
  id        SERIAL PRIMARY KEY,
  offer_id  INTEGER  NOT NULL REFERENCES user_offers(id) ON DELETE CASCADE,
  weekday   SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  hour      SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  is_booked BOOLEAN  NOT NULL DEFAULT false,
  UNIQUE (offer_id, weekday, hour)
);
CREATE INDEX IF NOT EXISTS idx_slots_offer ON offer_slots(offer_id, weekday, hour);

-- 2. One learner books one slot. The whole booking runs in a single transaction.
CREATE TABLE IF NOT EXISTS slot_bookings (
  id         SERIAL PRIMARY KEY,
  slot_id    INTEGER     NOT NULL REFERENCES offer_slots(id)  ON DELETE CASCADE,
  offer_id   INTEGER     NOT NULL REFERENCES user_offers(id)  ON DELETE CASCADE,
  learner_id INTEGER     NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  status     VARCHAR(10) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','DONE','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A slot can have only ONE live booking; cancelled ones may stay in the history.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_booking_per_slot
  ON slot_bookings (slot_id) WHERE status = 'BOOKED';
CREATE INDEX IF NOT EXISTS idx_bookings_learner ON slot_bookings(learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_offer   ON slot_bookings(offer_id);

-- 3. The learner rates a finished lesson, once.
CREATE TABLE IF NOT EXISTS slot_reviews (
  id         SERIAL PRIMARY KEY,
  booking_id INTEGER      NOT NULL UNIQUE REFERENCES slot_bookings(id) ON DELETE CASCADE,
  rating     SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Demo data: give every offer that has no slots yet three weekly times,
-- spread over the week so the app never shows an empty calendar.
INSERT INTO offer_slots (offer_id, weekday, hour)
SELECT o.id, v.weekday, v.hour
  FROM user_offers o
  CROSS JOIN LATERAL (VALUES
      (((o.id * 3) % 7) + 1, 18),
      (((o.id * 5) % 7) + 1, 19),
      (((o.id * 2) % 6) + 1, 11)
  ) AS v(weekday, hour)
 WHERE NOT EXISTS (SELECT 1 FROM offer_slots s WHERE s.offer_id = o.id)
ON CONFLICT (offer_id, weekday, hour) DO NOTHING;

-- Demo history: a few finished lessons with reviews, so ratings show from the first start.
-- Only runs while slot_bookings is still empty; people that do not exist are simply skipped.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM slot_bookings) THEN
    WITH picks AS (
      SELECT s.id AS slot_id, o.id AS offer_id, l.id AS learner_id, v.rating, v.comment
        FROM (VALUES
          ('aziza@demo.uz',   'Python basics',        'bobur@demo.uz',   5, 'Patient and clear. I wrote my first script in one hour.'),
          ('aziza@demo.uz',   'Python basics',        'dilnoza@demo.uz', 4, 'Good examples, a little fast at the end.'),
          ('dilnoza@demo.uz', 'UI design in Figma',   'aziza@demo.uz',   5, 'Great tips for components.'),
          ('jasur@demo.uz',   'Guitar',               'nilufar@demo.uz', 5, 'Fun lessons, learned three chords.'),
          ('nilufar@demo.uz', 'Cooking plov',         'jasur@demo.uz',   5, 'Best plov of my life.'),
          ('malika@demo.uz',  'IELTS writing',        'sardor@demo.uz',  5, 'Clear Task 2 structure, my essays improved.'),
          ('kamola@demo.uz',  'Korean for beginners', 'timur@demo.uz',   4, 'Hangul in one evening, fun teacher.')
        ) AS v(teacher, skill, learner, rating, comment)
        JOIN users t        ON t.email = v.teacher
        JOIN skills sk      ON sk.name = v.skill
        JOIN user_offers o  ON o.user_id = t.id AND o.skill_id = sk.id
        JOIN LATERAL (SELECT id FROM offer_slots WHERE offer_id = o.id ORDER BY weekday, hour LIMIT 1) s ON true
        JOIN users l        ON l.email = v.learner
    ), b AS (
      INSERT INTO slot_bookings (slot_id, offer_id, learner_id, status, created_at)
      SELECT slot_id, offer_id, learner_id, 'DONE', now() - interval '3 days' FROM picks
      RETURNING id, slot_id, learner_id
    )
    INSERT INTO slot_reviews (booking_id, rating, comment, created_at)
    SELECT b.id, p.rating, p.comment, now() - interval '2 days'
      FROM b JOIN picks p ON p.slot_id = b.slot_id AND p.learner_id = b.learner_id;
  END IF;
END $$;
