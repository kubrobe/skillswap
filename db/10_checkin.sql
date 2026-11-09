-- Lesson check-in: a secret 4-digit code per booking, shown only to the TEACHER (as digits and a QR).
-- The learner can only finish a lesson with that code, so credits move only when both people met.
ALTER TABLE slot_bookings ADD COLUMN IF NOT EXISTS checkin_code CHAR(4);
UPDATE slot_bookings SET checkin_code = lpad((floor(random() * 10000))::int::text, 4, '0')
 WHERE checkin_code IS NULL;
