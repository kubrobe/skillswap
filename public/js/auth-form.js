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

  // The brand panel shows live numbers of the community
  api('GET', '/api/mobile/impact').then((impact) => {
    for (const b of $$('#mini [data-count]')) {
      const dec = Number(b.dataset.decimals || 0);
      countUp(b, Number(impact[b.dataset.count]) || 0, { format: (n) => (dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US')) });
    }
  }).catch(() => {});
}
