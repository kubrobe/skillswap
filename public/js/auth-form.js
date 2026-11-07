// Shared by signup.js and login.js: send the form to the API, show errors, redirect on success.
import { api, $, say } from '/app.js';

export async function handleAuthForm(endpoint) {
  // Already logged in? Skip the form.
  const { user } = await api('GET', '/api/me');
  if (user) { location.href = '/dashboard'; return; }

  const form = $('#form');
  const msg = $('#msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('POST', endpoint, data);
      location.href = '/dashboard';
    } catch (err) {
      say(msg, err.message);
      button.disabled = false;
    }
  });
}
