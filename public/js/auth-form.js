// Shared by signup.js and login.js: send the form to the API, show errors, redirect on success.
import { api, $, $$, say, icon, h, countUp } from '/app.js';

// Only go back to a page of this site (never to another website)
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^\/[a-z]/i.test(n) && !n.startsWith('//') ? n : '/dashboard';
}

export async function handleAuthForm(endpoint) {
  // Already logged in? Skip the form.
  const { user } = await api('GET', '/api/me');
  if (user) { location.href = nextUrl(); return; }

  const form = $('#form');
  const msg = $('#msg');
  const pw = $('#password');
  // Show / hide the password
  const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye'));
  eye.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  pw.after(eye);
  for (const el of $$('[data-icon-slot]')) el.replaceWith(icon(el.dataset.iconSlot));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      const bad = form.querySelector(':invalid');
      say(msg, bad.type === 'email' ? 'Please enter a valid email address' : bad.id === 'password' && bad.minLength > 0 ? 'The password needs at least 8 characters' : 'Please fill in every field');
      bad.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'One moment…';
    try {
      await api('POST', endpoint, data);
      location.href = nextUrl();
    } catch (err) {
      say(msg, err.message);
      button.disabled = false;
      button.textContent = endpoint.endsWith('login') ? 'Log in' : 'Create your account';
    }
  });

  // Sign in with Google / Telegram: each button appears only when the server is set up for it
  socialButtons(endpoint.endsWith('login') ? 'signin_with' : 'signup_with', msg).catch(() => {});

  // The brand panel shows live numbers of the community
  api('GET', '/api/mobile/impact').then((impact) => {
    for (const b of $$('#mini [data-count]')) {
      const dec = Number(b.dataset.decimals || 0);
      countUp(b, Number(impact[b.dataset.count]) || 0, { format: (n) => (dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US')) });
    }
  }).catch(() => {});
}

// ---------- Sign in with Google ----------
// Google's own button (loaded from accounts.google.com, allowed by our security policy). When the person
// picks their Google account, Google gives this page a signed "credential"; the server checks it with
// Google and logs the person in (a new account is made on the first visit).
const loadGoogle = () => new Promise((resolve, reject) => {
  if (window.google?.accounts?.id) return resolve();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error('Google could not be reached'));
  document.head.append(s);
});

async function socialButtons(text, msg) {
  const config = await api('GET', '/api/config');
  // One "or" line under the buttons; Telegram sits under Google.
  const slot = h('div', { class: 'google-slot hidden' });
  const telegram = config.telegramLogin ? telegramButton(msg) : null;
  if (!config.googleClientId && !telegram) return;
  $('#form').before(...[slot, telegram, h('p', { class: 'or-line' }, h('span', {}, 'or'))].filter(Boolean));   // before() would print a null as text
  if (config.googleClientId) await googleButton(config.googleClientId, slot, text, msg);
}

// ---------- Continue with Telegram ----------
// Telegram's own login widget is web-only and needs a fixed domain, so the website uses the same flow as the
// Android app: the server gives a one-time link t.me/<bot>?start=login_<token>, the person taps Start in
// Telegram, and this page asks the server every 2 seconds whether that happened (for at most 5 minutes).
function telegramButton(msg) {
  const button = h('button', { class: 'btn btn-telegram btn-block btn-large', type: 'button' }, icon('plane'), 'Continue with Telegram');
  const note = h('p', { class: 'tg-note hidden', role: 'status' });
  const box = h('div', { class: 'tg-login' }, button, note);
  const reset = (text, kind) => {
    button.disabled = false;
    note.classList.add('hidden');
    if (text) say(msg, text, kind);
  };
  button.addEventListener('click', async () => {
    say(msg, '');
    button.disabled = true;
    // Open the tab now, inside the click: a tab opened later (after the server answers) is blocked as a pop-up.
    const tab = window.open('about:blank', '_blank');
    try {
      const { url, token, expiresIn } = await api('POST', '/api/auth/telegram/start', {});
      if (tab) { tab.opener = null; tab.location.href = url; }
      note.replaceChildren('Tap ', h('b', {}, 'Start'), ' in Telegram, then come back to this page. ',
        h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open Telegram again'));
      note.classList.remove('hidden');
      const until = Date.now() + (expiresIn || 300) * 1000;
      const ask = async () => {
        try {
          const r = await api('GET', `/api/auth/telegram/status?token=${encodeURIComponent(token)}`);
          if (r.status === 'confirmed') { location.href = nextUrl(); return; }
          if (r.status === 'expired') return reset('The Telegram link expired. Please try again.');
        } catch { /* a short network problem: keep asking until the time is up */ }
        if (Date.now() > until) return reset('The Telegram link expired. Please try again.');
        setTimeout(ask, 2000);
      };
      setTimeout(ask, 2000);
    } catch (err) {
      if (tab) tab.close();
      reset(err.message);
    }
  });
  return box;
}

async function googleButton(googleClientId, slot, text, msg) {
  await loadGoogle();
  slot.classList.remove('hidden');
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    ux_mode: 'popup',
    callback: async ({ credential }) => {
      say(msg, '');
      try {
        await api('POST', '/api/auth/google', { credential });
        location.href = nextUrl();
      } catch (err) { say(msg, err.message); }
    },
  });
  const dark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
  window.google.accounts.id.renderButton(slot, {
    type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill',
    text, logo_alignment: 'center', width: Math.min(400, Math.round(slot.clientWidth || 360)),
  });
}
