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

  // Sign in with Google: only when the server has a Google client id (otherwise nothing changes)
  googleButton(endpoint.endsWith('login') ? 'signin_with' : 'signup_with', msg).catch(() => {});

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

async function googleButton(text, msg) {
  const { googleClientId } = await api('GET', '/api/config');
  if (!googleClientId) return;
  await loadGoogle();
  const slot = h('div', { class: 'google-slot' });
  const or = h('p', { class: 'or-line' }, h('span', {}, 'or'));
  $('#form').before(slot, or);
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
