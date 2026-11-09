-- Sample data for the Android app (fictional people). Idempotent: safe on every server start.

-- 1. A short description for every lesson that has none (the website's demo offers had none).
UPDATE user_offers o SET description = v.txt
  FROM skills s, (VALUES
    ('Python basics',              'Variables, loops and functions, then a small project of your own.'),
    ('Web development (HTML/CSS)', 'Build and publish a one-page website from scratch.'),
    ('SQL and databases',          'SELECT, JOIN and GROUP BY on real tables, plus how to design them.'),
    ('JavaScript',                 'Make a web page interactive: events, the DOM and fetch.'),
    ('Excel and data analysis',    'Formulas, pivot tables and charts that bosses love.'),
    ('English conversation',       'Speak more and freeze less: everyday topics with friendly corrections.'),
    ('IELTS writing',              'Task 1 and Task 2 structure, with feedback on one essay per lesson.'),
    ('Korean for beginners',       'Read Hangul in one evening and learn the first 50 phrases.'),
    ('Russian',                    'Everyday Russian for the market, university and work.'),
    ('UI design in Figma',         'Frames, auto layout and components: design one real app screen.'),
    ('Photo editing',              'Light, colour and retouching in Lightroom or Snapseed.'),
    ('Video editing',              'Cut, add music and subtitles: a 60-second reel by the end.'),
    ('Guitar',                     'First chords and strumming patterns, then a full song.'),
    ('Piano',                      'Read simple notes and play a melody with both hands.'),
    ('Gym training basics',        'Safe technique for the big lifts and a plan for your first month.'),
    ('Chess',                      'Openings, tactics and how to stop losing pieces.'),
    ('Running for beginners',      'From zero to 5 km without injuries.'),
    ('Public speaking',            'Structure a 3-minute talk and stop being nervous on stage.'),
    ('Presentation design',        'Slides people remember: one idea per slide, strong visuals.'),
    ('Academic writing',           'Clear paragraphs, citations and a thesis statement that works.'),
    ('Cooking plov',               'Real Tashkent plov: choosing rice, meat and the right fire.'),
    ('Baking',                     'Bread and simple cakes with tips that always work.'),
    ('Calligraphy',                'Arabic and Latin lettering basics with a simple pen.')
  ) AS v(skill, txt)
 WHERE s.id = o.skill_id AND s.name = v.skill AND o.description = '';

-- 2. A few more lessons so every category has something to book.
INSERT INTO user_offers (user_id, skill_id, level, description)
SELECT u.id, s.id, v.level, ''
  FROM (VALUES
    ('dilnoza@demo.uz', 'Video editing',         'intermediate'),
    ('sardor@demo.uz',  'Running for beginners', 'advanced'),
    ('nilufar@demo.uz', 'Calligraphy',           'beginner'),
    ('jasur@demo.uz',   'Piano',                 'beginner'),
    ('malika@demo.uz',  'Academic writing',      'advanced')
  ) AS v(email, skill, level)
  JOIN users u  ON u.email = v.email
  JOIN skills s ON s.name = v.skill
ON CONFLICT (user_id, skill_id) DO NOTHING;

-- descriptions for the new lessons too
UPDATE user_offers o SET description = CASE s.name
    WHEN 'Video editing' THEN 'Cut, add music and subtitles: a 60-second reel by the end.'
    WHEN 'Running for beginners' THEN 'From zero to 5 km without injuries.'
    WHEN 'Calligraphy' THEN 'Arabic and Latin lettering basics with a simple pen.'
    WHEN 'Piano' THEN 'Read simple notes and play a melody with both hands.'
    WHEN 'Academic writing' THEN 'Clear paragraphs, citations and a thesis statement that works.'
    ELSE o.description END
  FROM skills s WHERE s.id = o.skill_id AND o.description = '';

-- weekly times for lessons that have none yet
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

-- 3. Upcoming lessons, so "I learn" and "I teach" are not empty for the demo accounts.
--    Only once: skipped as soon as any upcoming booking exists. Each booking spends 1 credit.
DO $$
DECLARE
  r RECORD; sid INT; oid INT; lid INT; bid INT;
BEGIN
  IF EXISTS (SELECT 1 FROM slot_bookings WHERE status = 'BOOKED') THEN RETURN; END IF;
  FOR r IN SELECT * FROM (VALUES
      ('kamola@demo.uz', 'Korean for beginners', 'aziza@demo.uz'),
      ('jasur@demo.uz',  'Guitar',               'aziza@demo.uz'),
      ('aziza@demo.uz',  'Python basics',        'bobur@demo.uz'),
      ('aziza@demo.uz',  'SQL and databases',    'nilufar@demo.uz'),
      ('dilnoza@demo.uz','UI design in Figma',   'timur@demo.uz')
    ) AS v(teacher, skill, learner)
  LOOP
    sid := NULL; oid := NULL;
    SELECT s.id, o.id INTO sid, oid
      FROM offer_slots s
      JOIN user_offers o ON o.id = s.offer_id
      JOIN users t       ON t.id = o.user_id
      JOIN skills k      ON k.id = o.skill_id
     WHERE t.email = r.teacher AND k.name = r.skill AND NOT s.is_booked
     ORDER BY s.weekday DESC, s.hour LIMIT 1;
    SELECT id INTO lid FROM users WHERE email = r.learner;
    CONTINUE WHEN sid IS NULL OR lid IS NULL;
    UPDATE offer_slots SET is_booked = true WHERE id = sid;
    INSERT INTO slot_bookings (slot_id, offer_id, learner_id, status, created_at)
    VALUES (sid, oid, lid, 'BOOKED', now() - interval '1 day') RETURNING id INTO bid;
    INSERT INTO credit_ledger (user_id, amount, reason, booking_id) VALUES (lid, -1, 'booked', bid);
  END LOOP;
END $$;
