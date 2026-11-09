-- 11_impact_history.sql : SAMPLE history for the Impact dashboard.
-- Finished demo lessons spread over the last 8 weeks (a few more each week), so the weekly
-- chart has a shape from the first start (the current week fills up with real lessons). Only the demo accounts (@demo.uz) take part.
-- Runs once: skipped as soon as any finished lesson is older than two weeks.
-- These lessons are older than the time bank, so they have no credit rows (balances do not change).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM slot_bookings WHERE status = 'DONE' AND created_at < now() - interval '14 days') THEN
    WITH demo_offers AS (
      SELECT o.id AS offer_id, o.user_id AS teacher_id,
             (SELECT id FROM offer_slots WHERE offer_id = o.id ORDER BY weekday, hour LIMIT 1) AS slot_id,
             row_number() OVER (ORDER BY o.id) - 1 AS k
        FROM user_offers o JOIN users t ON t.id = o.user_id
       WHERE t.email LIKE '%@demo.uz'
    ), demo_people AS (
      SELECT id, row_number() OVER (ORDER BY id) - 1 AS k FROM users WHERE email LIKE '%@demo.uz'
    ), plan AS (
      SELECT w.weeks_ago, i, row_number() OVER (ORDER BY w.weeks_ago DESC, i) AS seq
        FROM (VALUES (7, 2), (6, 3), (5, 4), (4, 5), (3, 7), (2, 8), (1, 4)) AS w(weeks_ago, cnt)
        CROSS JOIN LATERAL generate_series(1, w.cnt) AS i
    ), picks AS (
      SELECT p.seq, p.weeks_ago, p.i, o.offer_id, o.slot_id, pe.id AS learner_id
        FROM plan p
        JOIN demo_offers o  ON o.k  = p.seq % GREATEST((SELECT count(*) FROM demo_offers), 1)
        JOIN demo_people pe ON pe.k = (p.seq * 7 + 3) % GREATEST((SELECT count(*) FROM demo_people), 1)
       WHERE pe.id <> o.teacher_id AND o.slot_id IS NOT NULL
    ), b AS (
      INSERT INTO slot_bookings (slot_id, offer_id, learner_id, status, created_at)
      SELECT slot_id, offer_id, learner_id, 'DONE',
             date_trunc('week', now()) - weeks_ago * interval '7 days' + ((i % 6) * interval '1 day') + interval '17 hours'
        FROM picks
      RETURNING id, created_at
    )
    -- most learners left a rating (4 or 5 stars) a day later
    INSERT INTO slot_reviews (booking_id, rating, comment, created_at)
    SELECT id,
           CASE WHEN id % 3 = 0 THEN 4 ELSE 5 END,
           (ARRAY['Clear and friendly, thank you!', 'Very practical lesson.', 'Learned more than I expected.',
                  'Great examples, will book again.', 'Patient teacher, easy to follow.'])[1 + (id % 5)::int],
           created_at + interval '1 day'
      FROM b
     WHERE id % 4 <> 0;
  END IF;
END $$;
