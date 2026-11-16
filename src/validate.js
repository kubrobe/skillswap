// Input validation. Every API route checks its input here BEFORE touching the database.
// The database has its own CHECK constraints too (defence in depth).

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanText(value, { min = 0, max, field }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

export function cleanEmail(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(s) || s.length > 254) throw new HttpError(400, 'Please enter a valid email address');
  return s;
}

export function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (value.length > 72) throw new HttpError(400, 'Password must be at most 72 characters'); // bcrypt limit
  return value;
}

export function cleanId(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} must be a positive whole number`);
  return n;
}

export function cleanChoice(value, allowed, field) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

// ---------- @username, phone, Telegram username (db/15_telegram_profiles.sql has the same rules as CHECKs) ----------
export const RESERVED_USERNAMES = ['admin', 'skillswap', 'support'];
const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

/** Why a username is not allowed, or null when it is fine. Expects the cleaned (lower-case, no "@") form. */
export function usernameProblem(u) {
  if (u.length < 3) return 'Username must be at least 3 characters';
  if (u.length > 20) return 'Username must be at most 20 characters';
  if (!/^[a-z]/.test(u)) return 'Username must start with a letter';
  if (!USERNAME_RE.test(u)) return 'Username can only use letters a-z, digits and _';
  if (RESERVED_USERNAMES.includes(u)) return 'That username is reserved';
  return null;
}

/** "@Aziza_01 " -> "aziza_01". Does not check the rules; see cleanUsername. */
export const normalizeUsername = (value) => (typeof value === 'string' ? value : '').trim().replace(/^@/, '').toLowerCase();

export function cleanUsername(value) {
  const u = normalizeUsername(value);
  const problem = usernameProblem(u);
  if (problem) throw new HttpError(400, problem);
  return u;
}

/** Phone in E.164 format: "+" and 8-15 digits, e.g. +998901234567. Spaces, dashes and brackets are removed. "" -> null. */
export function cleanPhone(value) {
  const s = (typeof value === 'string' ? value : '').replace(/[\s\-().]/g, '');
  if (s === '') return null;
  if (!s.startsWith('+')) throw new HttpError(400, 'Phone must start with + and the country code, e.g. +998901234567');
  if (!/^\+[1-9][0-9]{7,14}$/.test(s)) throw new HttpError(400, 'Phone must be + and 8 to 15 digits, e.g. +998901234567');
  return s;
}

/** "@durov", "t.me/durov", "https://t.me/durov" -> "durov". "" -> null. */
export function cleanTelegramUsername(value) {
  const s = (typeof value === 'string' ? value : '').trim().replace(/^(https?:\/\/)?t\.me\//i, '').replace(/^@/, '');
  if (s === '') return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s)) throw new HttpError(400, 'Telegram username: 4 to 32 letters, digits or _, starting with a letter');
  return s;
}
