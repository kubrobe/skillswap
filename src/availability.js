// Weekly availability maths. Pure functions (no database), so they are easy to test.
// A slot is { weekday: 0..6 (0 = Monday), start: 'HH:MM', end: 'HH:MM' } in the owner's local time zone.
// To compare two people we convert every slot to minutes of the week in UTC, intersect, and convert back.
import { HttpError } from './validate.js';

const WEEK = 7 * 1440;
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function validZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length <= 40; } catch { return false; }
}

// How many minutes the zone is ahead of UTC right now (Asia/Tashkent = 300).
export function offsetMinutes(tz, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const local = Date.UTC(p.year, p.month - 1, p.day, Number(p.hour) % 24, p.minute, p.second);
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

// Check what the user sent. Returns clean slots or throws HttpError(400).
export function cleanSlots(input) {
  if (!Array.isArray(input)) throw new HttpError(400, 'slots must be a list');
  if (input.length > 21) throw new HttpError(400, 'At most 21 time slots');
  const slots = input.map((s) => {
    const weekday = Number(s && s.weekday);
    const ok = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Day must be Monday to Sunday');
    if (!ok.test(s.start) || !ok.test(s.end)) throw new HttpError(400, 'Times must look like 18:30');
    if (toMin(s.end) <= toMin(s.start)) throw new HttpError(400, 'End time must be after start time');
    return { weekday, start: s.start, end: s.end };
  });
  slots.sort((a, b) => a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].weekday === slots[i - 1].weekday && toMin(slots[i].start) < toMin(slots[i - 1].end)) throw new HttpError(400, 'Time slots on the same day must not overlap');
  }
  return slots;
}

// Slots -> intervals [start, end) in UTC minutes of the week (split if they cross the end of the week).
function toUtcIntervals(slots, tz) {
  const off = offsetMinutes(tz);
  const out = [];
  for (const s of slots) {
    let a = s.weekday * 1440 + toMin(s.start) - off;
    let b = s.weekday * 1440 + toMin(s.end) - off;
    a = ((a % WEEK) + WEEK) % WEEK; b = a + (toMin(s.end) - toMin(s.start));
    if (b > WEEK) { out.push([a, WEEK], [0, b - WEEK]); } else out.push([a, b]);
  }
  return out;
}

function intersect(A, B) {
  const out = [];
  for (const [a1, a2] of A) for (const [b1, b2] of B) {
    const s = Math.max(a1, b1), e = Math.min(a2, b2);
    if (s < e) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// UTC intervals -> slots in a local zone (split at midnight so each slot stays on one day).
function toLocalSlots(intervals, tz) {
  const off = offsetMinutes(tz);
  const out = [];
  for (const [s, e] of intervals) {
    let a = s + off, len = e - s;
    a = ((a % WEEK) + WEEK) % WEEK;
    while (len > 0) {
      const day = Math.floor(a / 1440), inDay = a % 1440, take = Math.min(len, 1440 - inDay);
      out.push({ weekday: day, start: fmt(inDay), end: fmt(inDay + take) });
      len -= take; a = (a + take) % WEEK;
    }
  }
  return out.sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start));
}

// Times when BOTH people are free, shown in `viewerZone`.
export function sharedSlots(mine, myZone, theirs, theirZone) {
  if (!mine.length || !theirs.length) return [];
  return toLocalSlots(intersect(toUtcIntervals(mine, myZone), toUtcIntervals(theirs, theirZone)), myZone);
}
