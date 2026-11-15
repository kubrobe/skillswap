-- Native video lessons inside the Android app (replaces the external Jitsi link).
-- A room belongs to ONE booked lesson; its two members are the learner and the teacher of that booking.
-- Only room facts are stored here. Audio/video go phone-to-phone (WebRTC, encrypted) and are never recorded;
-- the connection messages (SDP, ICE) are relayed in memory by src/rooms.js and never written to the database.
-- This file is idempotent: running it twice changes nothing.

CREATE TABLE IF NOT EXISTS video_rooms (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),   -- unguessable, unlike a booking id
  booking_id  INTEGER      NOT NULL REFERENCES slot_bookings(id) ON DELETE CASCADE,
  created_by  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(8)   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT now() + interval '3 hours',
  ended_at    TIMESTAMPTZ,
  end_reason  VARCHAR(20)  CHECK (end_reason IN ('ended_by_user', 'empty', 'expired', 'booking_cancelled', 'booking_done')),
  CHECK ((status = 'ACTIVE') = (ended_at IS NULL))
);
-- At most ONE open room per lesson, so both phones always land in the same room.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_room_per_booking ON video_rooms (booking_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_video_rooms_booking ON video_rooms (booking_id, created_at DESC);

-- Who was in a room and when (the "membership" history; ready for group lessons later).
CREATE TABLE IF NOT EXISTS video_room_participants (
  room_id         UUID        NOT NULL REFERENCES video_rooms(id) ON DELETE CASCADE,
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(8)  NOT NULL CHECK (role IN ('teacher', 'learner')),
  first_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,
  PRIMARY KEY (room_id, user_id)
);
