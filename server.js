// SkillSwap web server (Express + PostgreSQL).
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser, authRoutes } from './src/auth.js';
import { apiRoutes } from './src/api.js';
import { mobileRoutes } from './src/mobile.js';
import { telegramRoutes, startTelegram } from './src/telegram.js';
import { googleRoutes } from './src/google.js';
import { applyMigrations } from './src/migrations.js';
import { HttpError } from './src/validate.js';

const app = express();
app.set('trust proxy', 1);   // behind Render's proxy, so secure cookies and client info work
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Basic browser security headers
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Google's sign-in button needs the page's origin in the Referer header (no full URLs are sent)
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Our own files only, plus exactly what Google's sign-in button needs (its script, frame and styles)
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https://lh3.googleusercontent.com",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "frame-src https://accounts.google.com/gsi/",
      "connect-src 'self' https://accounts.google.com/gsi/",
      "style-src 'self' https://accounts.google.com/gsi/style",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

// gzip for pages, CSS, JS and JSON (about 4x smaller over a phone network).
// Never for the live event stream: compression would hold the events back until a buffer fills.
app.use(compression({
  filter: (req, res) => !String(res.getHeader('Content-Type') || '').includes('text/event-stream') && compression.filter(req, res),
}));

// Static files FIRST: pages, CSS, JS, fonts and icons do not need to know who is logged in, so they are
// sent without the session lookup in the database (one database round trip saved on every file).
const ONE_YEAR = 365 * 24 * 3600;
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    if (/\.(woff2|svg|png|jpg)$/.test(file)) res.set('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);   // fonts and icons never change
    else if (/\.(css|js)$/.test(file)) res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');  // fresh within 10 minutes of a deploy
    else res.set('Cache-Control', 'no-cache');                                                                    // HTML: always ask (cheap 304)
  },
}));

app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(loadUser);                        // sets req.user when logged in

// Express 4 does not catch errors thrown in async routes by itself; this wrapper does.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) =>
    typeof route === 'string' && handlers.length
      ? original(route, ...handlers.map((h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)))
      : original(route, ...handlers);
}

authRoutes(app);
googleRoutes(app);     // Sign in with Google: website + Android app (public routes)
telegramRoutes(app);   // Telegram calls this webhook (booking alerts, reminders, /next)
mobileRoutes(app);     // JSON API used by the Android app (before apiRoutes, which requires a login for all of /api)
apiRoutes(app);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
// Unknown page: a friendly 404 page instead of a blank error
app.use((req, res, next) => (req.method === 'GET' && req.accepts('html')
  ? res.status(404).sendFile(path.join(__dirname, 'public', '404.html'))
  : next()));

// One place that turns errors into JSON answers
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  // Update the database first (a second or two), then start answering requests.
  // If the update fails, the server still starts and logs why.
  applyMigrations()
    .then(() => console.log('Database schema up to date'))
    .catch((e) => console.error('Database update failed:', e.message))
    .finally(() => {
      app.listen(PORT, () => console.log(`SkillSwap running on http://localhost:${PORT}`));
      startTelegram();
    });
}
export default app;
