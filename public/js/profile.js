import { api, h, $, requireLogin, renderShell, say } from '/app.js';

await requireLogin();
renderShell();

const p = await api('GET', '/api/me/profile');
const msg = h('div', { class: 'notice hidden', role: 'status' });
const form = h('form', { class: 'card', novalidate: true },
  msg,
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), h('input', { id: 'email', value: p.email, disabled: true })),
  h('div', { class: 'field' }, h('label', { for: 'display_name' }, 'Name'), h('input', { id: 'display_name', value: p.display_name, maxlength: 60, required: true })),
  h('div', { class: 'field' }, h('label', { for: 'city' }, 'City ', h('span', { class: 'hint' }, '(optional)')), h('input', { id: 'city', value: p.city || '', maxlength: 80 })),
  h('div', { class: 'field' }, h('label', { for: 'bio' }, 'About you ', h('span', { class: 'hint' }, '(optional)')), h('textarea', { id: 'bio', maxlength: 500 }, p.bio || '')),
  h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save profile'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/me/profile', { display_name: $('#display_name').value, city: $('#city').value, bio: $('#bio').value });
    say(msg, 'Saved', 'ok');
  } catch (err) { say(msg, err.message, 'error'); }
});
$('#content').append(form);
