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
