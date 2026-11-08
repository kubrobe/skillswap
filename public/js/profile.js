import { api, h, $, requireLogin, renderShell, say, toast } from '/app.js';

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

// ---- Weekly availability ----
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ZONES = ['Asia/Tashkent', 'Asia/Almaty', 'Asia/Seoul', 'Europe/Istanbul', 'Europe/Moscow', 'Europe/London', 'America/New_York', 'UTC'];
const av = await api('GET', '/api/me/availability');
if (!ZONES.includes(av.time_zone)) ZONES.push(av.time_zone);
const avMsg = h('div', { class: 'notice hidden', role: 'status' });
const zone = h('select', { id: 'zone', 'aria-label': 'Time zone' }, ZONES.map((z) => h('option', { value: z, selected: z === av.time_zone }, z.replace('_', ' '))));
const rows = h('div', { class: 'slots' });

function slotRow(s = { weekday: 0, start: '18:00', end: '20:00' }) {
  const day = h('select', { 'aria-label': 'Day' }, DAYS.map((d, i) => h('option', { value: i, selected: i === s.weekday }, d)));
  const start = h('input', { type: 'time', value: s.start, 'aria-label': 'From', required: true });
  const end = h('input', { type: 'time', value: s.end, 'aria-label': 'To', required: true });
  const row = h('div', { class: 'slot' }, day, start, h('span', { class: 'hint' }, 'to'), end,
    h('button', { class: 'btn btn-danger btn-small', type: 'button', 'aria-label': 'Remove time slot', onclick: () => row.remove() }, '\u00D7'));
  row.read = () => ({ weekday: Number(day.value), start: start.value, end: end.value });
  return row;
}
for (const s of av.slots) rows.append(slotRow(s));

const avForm = h('form', { class: 'card', novalidate: true },
  h('h3', {}, 'Weekly availability'),
  h('p', { class: 'meta' }, 'When can you teach or learn? Partners see when you are both free.'),
  avMsg,
  h('div', { class: 'field' }, h('label', { for: 'zone' }, 'Your time zone'), zone),
  rows,
  h('div', { class: 'row' },
    h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => rows.append(slotRow()) }, 'Add time slot'),
    h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save availability')));
avForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/me/availability', { time_zone: zone.value, slots: [...rows.children].map((r) => r.read()) });
    say(avMsg, ''); toast('Availability saved');
  } catch (err) { say(avMsg, err.message, 'error'); }
});
$('#content').append(avForm);
