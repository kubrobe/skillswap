// Sign in with Google, for the website AND the Android app.
//
// 1. The page (Google's button) or the phone (Credential Manager) asks Google to sign the person in.
// 2. Google gives back an "ID token": a small document SIGNED by Google that says who the person is.
// 3. We send that token here. The server checks Google's signature and that the token was made for OUR
//    app (audience = our client id). Only then do we trust the email and name inside it.
// 4. We find the SkillSwap account (by Google id, else by the same verified email) or create a new one,
//    and start the normal session: a cookie for the website, a bearer token for the app.
//
// The password is never seen by SkillSwap: Google checks it. Setup steps: docs/GOOGLE_SIGN_IN.md.
import { OAuth2Client } from 'google-auth-library';
import { query, withTransaction } from './db.js';
import { HttpError } from './validate.js';
import { startSession, createSessionToken } from './auth.js';
import { giveWelcome } from './mobile.js';

// The WEB client id from Google Cloud. The Android app asks Google for a token for this same id
// (serverClientId), so one id checks tokens from both the website and the phone.
const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client();

// Checks the token with Google's public keys. Tests replace it (they cannot ask Google).
let verify = async (idToken) => {
  const ticket = await client.verifyIdToken({ idToken, audience: clientId() });
  return ticket.getPayload();
};
export const setGoogleVerifier = (fn) => { verify = fn; };

/** Who is this token for? Throws 401 for a fake, expired or foreign token. */
async function googleProfile(idToken) {
  if (!clientId()) throw new HttpError(503, 'Google sign-in is not set up on this server');
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) throw new HttpError(400, 'Missing Google token');
  let p;
  try { p = await verify(idToken); } catch { throw new HttpError(401, 'Google sign-in failed. Please try again.'); }
  if (!p?.sub || !p.email) throw new HttpError(401, 'Google sign-in failed. Please try again.');
  // An unverified email could belong to someone else: never link or create an account with it.
  if (p.email_verified !== true && p.email_verified !== 'true') throw new HttpError(401, 'Your Google email is not verified');
  const email = String(p.email).trim().toLowerCase();
  const name = String(p.name || p.given_name || email.split('@')[0]).trim().slice(0, 60);
  return { sub: String(p.sub), email, name: name.length >= 2 ? name : 'SkillSwap member' };
}

/**
 * Find or create the account, in ONE transaction:
 *  - known Google id            -> that account
 *  - known (verified) email     -> link Google to the existing account (same person: Google proved the email)
 *  - otherwise                  -> new account without a password + profile + welcome credits
 * Returns { id, isNew }.
 */
export async function findOrCreateGoogleUser({ sub, email, name }) {
  return withTransaction(async (db) => {
    const bySub = await db.query('SELECT id FROM users WHERE google_sub = $1', [sub]);
    if (bySub.rows[0]) return { id: bySub.rows[0].id, isNew: false };
    const byEmail = await db.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    if (byEmail.rows[0]) {
      await db.query('UPDATE users SET google_sub = $1 WHERE id = $2', [sub, byEmail.rows[0].id]);
      return { id: byEmail.rows[0].id, isNew: false };
    }
    const u = await db.query('INSERT INTO users (email, password_hash, google_sub) VALUES ($1, NULL, $2) RETURNING id', [email, sub]);
    await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1,$2)', [u.rows[0].id, name]);
    await giveWelcome(db, u.rows[0].id);
    return { id: u.rows[0].id, isNew: true };
  });
}

const profileOf = async (id) => (await query(
  'SELECT u.id, u.email, p.display_name, p.bio FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1', [id])).rows[0];

export function googleRoutes(app) {
  // The pages ask whether to show the Google button (no button until the server is set up).
  app.get('/api/config', (_req, res) => res.json({ googleClientId: clientId() || null }));
  app.get('/api/mobile/config', (_req, res) => res.json({ googleClientId: clientId() || null }));   // the Android app

  // Website: Google's button gives the page a "credential" (the ID token) -> login cookie
  app.post('/api/auth/google', async (req, res) => {
    const g = await googleProfile(req.body.credential);
    const { id, isNew } = await findOrCreateGoogleUser(g);
    await startSession(res, id);
    const p = await profileOf(id);
    res.status(isNew ? 201 : 200).json({ id, email: p.email, display_name: p.display_name, isNew });
  });

  // Android app: Credential Manager gives the phone the ID token -> bearer token, like /api/mobile/login
  app.post('/api/mobile/google', async (req, res) => {
    const g = await googleProfile(req.body.idToken);
    const { id, isNew } = await findOrCreateGoogleUser(g);
    const { token } = await createSessionToken(id);
    const p = await profileOf(id);
    res.status(isNew ? 201 : 200).json({ token, isNew, user: { id: p.id, fullName: p.display_name, email: p.email, bio: p.bio || '' } });
  });
}
