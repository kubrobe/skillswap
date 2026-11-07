-- 03_queries.sql : 20 queries for SkillSwap. Run top to bottom in pgAdmin's Query Tool.
-- Order matters a little: Q1 creates a member that Q3 changes and Q4 deletes; Q18 (transaction) is last
-- because it changes data. Run `npm run db:reset` to restore the original demo data afterwards.
-- Each query has a comment with the business question it answers.

-- =============================================================== CRUD (4)
-- Q1 CREATE. Business question: how does a new member join? (user + profile must both exist)
WITH new_user AS (
  INSERT INTO users (email, password_hash)
  VALUES ('new.member@example.uz', 'NOT-A-REAL-HASH-demo-only')
  RETURNING id)
INSERT INTO profiles (user_id, display_name, city)
SELECT id, 'New Member', 'Tashkent' FROM new_user
RETURNING user_id, display_name, city;

-- Q2 READ. Business question: which members live in Tashkent and what do they teach?
SELECT p.display_name, s.name AS skill, o.level
FROM profiles p
JOIN user_offers o ON o.user_id = p.user_id
JOIN skills s      ON s.id = o.skill_id
WHERE p.city = 'Tashkent'
ORDER BY p.display_name, s.name;

-- Q3 UPDATE. Business question: a member moves to another city, so their profile must change.
UPDATE profiles SET city = 'Samarkand', bio = 'Just joined SkillSwap'
WHERE user_id = (SELECT id FROM users WHERE email = 'new.member@example.uz')
RETURNING user_id, display_name, city, bio;

-- Q4 DELETE. Business question: a member leaves; deleting the user also removes the profile (ON DELETE CASCADE).
DELETE FROM users WHERE email = 'new.member@example.uz'
RETURNING id, email;

-- =============================================================== JOINs (5, one LEFT JOIN)
-- Q5 INNER JOIN (4 tables). Business question: what does every member offer, by category?
SELECT p.display_name, c.name AS category, s.name AS skill, o.level
FROM user_offers o
JOIN profiles   p ON p.user_id = o.user_id
JOIN skills     s ON s.id = o.skill_id
JOIN categories c ON c.id = s.category_id
ORDER BY c.name, s.name, p.display_name;

-- Q6 LEFT JOIN. Business question: which skills in our catalog have NO teacher yet?
SELECT s.name AS skill, c.name AS category
FROM skills s
JOIN categories c ON c.id = s.category_id
LEFT JOIN user_offers o ON o.skill_id = s.id
WHERE o.id IS NULL
ORDER BY c.name, s.name;

-- Q7 JOIN with the same table twice (profiles as requester AND as provider).
-- Business question: who asked whom for which skill, and what do they offer in return?
SELECT rp.display_name AS requester, pp.display_name AS provider,
       sw.name AS wants_to_learn, so.name AS will_teach, e.status
FROM exchanges e
JOIN profiles rp ON rp.user_id = e.requester_id
JOIN profiles pp ON pp.user_id = e.provider_id
JOIN skills sw   ON sw.id = e.skill_wanted_id
JOIN skills so   ON so.id = e.skill_offered_id
ORDER BY e.created_at;

-- Q8 JOIN (requests <-> offers). Business question: for each skill people WANT, how many members teach it?
-- (a low number means high demand and low supply: where to recruit new teachers)
SELECT s.name AS skill,
       count(DISTINCT r.user_id) AS learners,
       count(DISTINCT o.user_id) AS teachers
FROM user_requests r
JOIN skills s ON s.id = r.skill_id
LEFT JOIN user_offers o ON o.skill_id = r.skill_id
GROUP BY s.name
ORDER BY learners DESC, teachers ASC, s.name;

-- Q9 JOIN across the M:N link. Business question: which pairs of members could teach each other
-- (A offers what B wants), listing the skill?
SELECT teacher.display_name AS teacher, learner.display_name AS learner, s.name AS skill
FROM user_offers o
JOIN user_requests r   ON r.skill_id = o.skill_id AND r.user_id <> o.user_id
JOIN profiles teacher  ON teacher.user_id = o.user_id
JOIN profiles learner  ON learner.user_id = r.user_id
JOIN skills s          ON s.id = o.skill_id
ORDER BY s.name, teacher.display_name;

-- =============================================================== GROUP BY (4, one HAVING)
-- Q10 GROUP BY. Business question: which categories are most popular among teachers?
SELECT c.name AS category, count(o.id) AS offers
FROM categories c
JOIN skills s ON s.category_id = c.id
LEFT JOIN user_offers o ON o.skill_id = s.id
GROUP BY c.name
ORDER BY offers DESC, c.name;

-- Q11 GROUP BY. Business question: how many members do we have in each city?
SELECT coalesce(city, 'not set') AS city, count(*) AS members
FROM profiles
GROUP BY city
ORDER BY members DESC, city;

-- Q12 GROUP BY + HAVING. Business question: which skills have at least 2 teachers (a "healthy" skill)?
SELECT s.name AS skill, count(o.id) AS teachers
FROM skills s
JOIN user_offers o ON o.skill_id = s.id
GROUP BY s.name
HAVING count(o.id) >= 2
ORDER BY teachers DESC;

-- Q13 GROUP BY. Business question: how many exchange requests are in each status?
SELECT status, count(*) AS exchanges
FROM exchanges
GROUP BY status
ORDER BY exchanges DESC;

-- =============================================================== VIEW (1)
-- Q14 VIEW. Business question: who are the "fair swap" pairs? (A teaches what B wants AND B teaches what A wants)
-- A view saves this query under a name so the app and reports can reuse it like a table.
CREATE OR REPLACE VIEW v_mutual_matches AS
SELECT a.user_id AS member_a, b.user_id AS member_b,
       sa.name AS a_teaches_b, sb.name AS b_teaches_a
FROM user_offers a
JOIN user_requests rb ON rb.skill_id = a.skill_id AND rb.user_id <> a.user_id
JOIN user_offers   b  ON b.user_id = rb.user_id
JOIN user_requests ra ON ra.skill_id = b.skill_id AND ra.user_id = a.user_id
JOIN skills sa ON sa.id = a.skill_id
JOIN skills sb ON sb.id = b.skill_id
WHERE a.user_id < b.user_id;                    -- each pair listed once

SELECT pa.display_name AS member_a, pb.display_name AS member_b, v.a_teaches_b, v.b_teaches_a
FROM v_mutual_matches v
JOIN profiles pa ON pa.user_id = v.member_a
JOIN profiles pb ON pb.user_id = v.member_b
ORDER BY pa.display_name;

-- =============================================================== WINDOW FUNCTIONS (2)
-- Q15 RANK() window. Business question: inside each category, which skills have the most teachers?
SELECT category, skill, teachers,
       RANK() OVER (PARTITION BY category ORDER BY teachers DESC) AS rank_in_category
FROM (SELECT c.name AS category, s.name AS skill, count(o.id) AS teachers
        FROM skills s
        JOIN categories c ON c.id = s.category_id
        LEFT JOIN user_offers o ON o.skill_id = s.id
       GROUP BY c.name, s.name) t
ORDER BY category, rank_in_category, skill;

-- Q16 Window with a running total. Business question: how fast is the community growing
-- (number of members and cumulative total per signup day)?
SELECT created_at::date AS day,
       count(*) AS new_members,
       sum(count(*)) OVER (ORDER BY created_at::date) AS total_members
FROM users
GROUP BY created_at::date
ORDER BY day;

-- =============================================================== SUBQUERY (1)
-- Q17 Subquery. Business question: which members teach MORE skills than the average member does?
SELECT p.display_name, count(*) AS skills_offered
FROM user_offers o
JOIN profiles p ON p.user_id = o.user_id
GROUP BY p.display_name
HAVING count(*) > (SELECT avg(n) FROM (SELECT count(*) AS n FROM user_offers GROUP BY user_id) per_user)
ORDER BY skills_offered DESC, p.display_name;

-- =============================================================== OWN CHOICE (2)
-- Q19 CTE (the matching query used by the app). Business question: for member #1, who teaches what they want
-- or wants what they teach? (change the 1 to another user id to try)
WITH they_teach_me AS (
  SELECT o.user_id, s.name FROM user_offers o
  JOIN user_requests r ON r.skill_id = o.skill_id JOIN skills s ON s.id = o.skill_id
  WHERE r.user_id = 1 AND o.user_id <> 1),
i_teach_them AS (
  SELECT r.user_id, s.name FROM user_requests r
  JOIN user_offers o ON o.skill_id = r.skill_id JOIN skills s ON s.id = r.skill_id
  WHERE o.user_id = 1 AND r.user_id <> 1)
SELECT p.display_name,
       (SELECT string_agg(name, ', ') FROM they_teach_me t WHERE t.user_id = p.user_id) AS can_teach_me,
       (SELECT string_agg(name, ', ') FROM i_teach_them t WHERE t.user_id = p.user_id) AS wants_from_me
FROM profiles p
WHERE p.user_id IN (SELECT user_id FROM they_teach_me UNION SELECT user_id FROM i_teach_them)
ORDER BY p.display_name;

-- Q20 DISTINCT ON (PostgreSQL feature). Business question: what is the latest status event of every exchange,
-- and who made it? (uses the history table)
SELECT DISTINCT ON (l.exchange_id)
       l.exchange_id, l.status AS latest_status, p.display_name AS changed_by, l.changed_at
FROM exchange_status_log l
JOIN profiles p ON p.user_id = l.changed_by
ORDER BY l.exchange_id, l.changed_at DESC, l.id DESC;

-- =============================================================== TRANSACTION (1) - run last
-- Q18 TRANSACTION. Business question: when a provider accepts a request, the status change and its history row
-- must be saved together or not at all. FOR UPDATE locks the row against a double click.
BEGIN;
  SELECT id, status FROM exchanges WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE;
  UPDATE exchanges SET status = 'accepted'
   WHERE id = (SELECT min(id) FROM exchanges WHERE status = 'pending');
  INSERT INTO exchange_status_log (exchange_id, status, changed_by)
  SELECT e.id, 'accepted', e.provider_id FROM exchanges e
   WHERE e.id = (SELECT min(id) FROM exchanges WHERE status = 'accepted');
COMMIT;

-- Failure case: the CHECK constraint rejects an invalid status, so the whole transaction is rolled back.
BEGIN;
  UPDATE exchanges SET status = 'accepted' WHERE status = 'pending';
  UPDATE exchanges SET status = 'banana' WHERE id = (SELECT min(id) FROM exchanges);   -- ERROR: violates check constraint
ROLLBACK;                                      -- pgAdmin needs ROLLBACK after an error
SELECT status, count(*) FROM exchanges GROUP BY status;   -- proves the first UPDATE did not stay
