import {
  api, h, $, icon, requireLogin, renderShell, say, toast, avatar, getSync, iconTile, ago,
} from '/app.js';
import { badgeCard } from '/js/badges.js';

const user = await requireLogin();
renderShell();

const [p, av, sync, ach, tg] = await Promise.all([
  api('GET', '/api/me/profile'),
  api('GET', '/api/me/availability'),
  getSync(),
  api('GET', '/api/mobile/achievements').catch(() => null),
  api('GET', '/api/mobile/telegram').catch(() => null),
]);
$('.page-actions').append(h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${user.id}` }, icon('eye'), 'See my public profile'));

const main = h('div');
const aside = h('div', { class: 'sticky' });
$('#content').append(h('div', { class: 'cols' }, main, aside));

// ---- Profile form ----
const msg = h('div', { class: 'notice hidden', role: 'status' });
const nameInput = h('input', { id: 'display_name', value: p.display_name, maxlength: 60, required: true, autocomplete: 'name' });
const preview = h('span', {}, avatar(p.display_name, user.id, 'md'));
nameInput.addEventListener('input', () => preview.replaceChildren(avatar(nameInput.value || '?', user.id, 'md')));
const bio = h('textarea', { id: 'bio', maxlength: 500, placeholder: 'What do you study, what do you love teaching?' }, p.bio || '');
const bioCount = h('span', { class: 'hint' }, `${(p.bio || '').length} / 500`);
bio.addEventListener('input', () => { bioCount.textContent = `${bio.value.length} / 500`; });
const form = h('form', { class: 'card', novalidate: true },
  h('div', { class: 'card-head' }, preview, h('div', {}, h('h3', {}, 'About you'), h('p', { class: 'meta' }, 'Your name, city and a few words.'))),
  msg,
  h('div', { class: 'form-grid two' },
    h('div', { class: 'field' }, h('label', { for: 'display_name' }, 'Name'), nameInput),
    h('div', { class: 'field' }, h('label', { for: 'city' }, 'City ', h('span', { class: 'hint' }, '(optional)')), h('input', { id: 'city', value: p.city || '', maxlength: 80, autocomplete: 'address-level2' }))),
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email ', h('span', { class: 'hint' }, '(only you see it)')), h('input', { id: 'email', value: p.email, disabled: true })),
  h('div', { class: 'field' }, h('label', { for: 'bio' }, 'About you ', bioCount), bio),
  h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), 'Save profile'));
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/me/profile', { display_name: nameInput.value, city: $('#city').value, bio: bio.value });
    say(msg, ''); toast('Profile saved');
  } catch (err) { say(msg, err.message, 'error'); }
});
main.append(form);

// ---- Weekly availability ----
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ZONES = ['Asia/Tashkent', 'Asia/Almaty', 'Asia/Seoul', 'Europe/Istanbul', 'Europe/Moscow', 'Europe/London', 'America/New_York', 'UTC'];
if (!ZONES.includes(av.time_zone)) ZONES.push(av.time_zone);
const avMsg = h('div', { class: 'notice hidden', role: 'status' });
const zone = h('select', { id: 'zone', 'aria-label': 'Time zone' }, ZONES.map((z) => h('option', { value: z, selected: z === av.time_zone }, z.replace('_', ' '))));
const rows = h('div', { class: 'slots' });
function slotRow(s = { weekday: 0, start: '18:00', end: '20:00' }) {
  const day = h('select', { 'aria-label': 'Day' }, DAYS.map((d, i) => h('option', { value: i, selected: i === s.weekday }, d)));
  const start = h('input', { type: 'time', value: s.start, 'aria-label': 'From', required: true });
  const end = h('input', { type: 'time', value: s.end, 'aria-label': 'To', required: true });
  const row = h('div', { class: 'slot' }, day, start, h('span', { class: 'hint' }, 'to'), end,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove time slot', onclick: () => row.remove() }, icon('trash')));
  row.read = () => ({ weekday: Number(day.value), start: start.value, end: end.value });
  return row;
}
for (const s of av.slots) rows.append(slotRow(s));
const avForm = h('form', { class: 'card', novalidate: true },
  h('div', { class: 'card-head' }, iconTile('calendar'), h('div', {}, h('h3', {}, 'Weekly availability'), h('p', { class: 'meta' }, 'Partners see when you are both free.'))),
  avMsg,
  h('div', { class: 'field' }, h('label', { for: 'zone' }, 'Your time zone'), zone),
  rows,
  h('div', { class: 'row' },
    h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => rows.append(slotRow()) }, icon('plus'), 'Add time'),
    h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, icon('check'), 'Save availability')));
avForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/me/availability', { time_zone: zone.value, slots: [...rows.children].map((r) => r.read()) });
    say(avMsg, ''); toast('Availability saved');
  } catch (err) { say(avMsg, err.message, 'error'); }
});
main.append(avForm);

// ---- Time bank (shared with the Android app) ----
if (sync && sync.wallet) {
  const REASON = { welcome: 'Welcome gift', booked: 'Booked a lesson', refund: 'Refund for a cancelled lesson', taught: 'Taught a lesson' };
  const RICON = { welcome: 'gift', booked: 'cap', refund: 'undo', taught: 'easel' };
  aside.append(h('section', { class: 'card gold-edge', id: 'wallet' },
    h('div', { class: 'spread' }, h('h3', {}, 'Time bank'), icon('coin', 'icon gold')),
    h('p', { class: 'wallet-balance' }, h('b', { class: 'num' }, String(sync.wallet.balance)), ' credits'),
    h('p', { class: 'meta' }, 'Teach one hour = earn one credit. One credit books one hour of learning in the SkillSwap app.'),
    h('ul', { class: 'feed' }, (sync.wallet.history || []).slice(0, 6).map((x) => h('li', {}, iconTile(RICON[x.reason] || 'coin', 'sm'),
      h('div', {}, h('p', {}, REASON[x.reason] || x.reason, x.skillName ? ` · ${x.skillName}` : ''), h('span', {}, ago(x.createdAt))),
      h('b', { class: `amount ${x.amount > 0 ? 'plus' : 'minus'}` }, `${x.amount > 0 ? '+' : ''}${x.amount}`))))));
}

// ---- Badges ----
if (ach && ach.badges) {
  const got = ach.badges.filter((b) => b.progress >= b.goal).length;
  aside.append(h('section', { class: 'card' },
    h('div', { class: 'spread' }, h('h3', {}, 'Badges'), h('a', { class: 'btn-link', href: '/leaderboard' }, `${got} of ${ach.badges.length}`, icon('arrow_right'))),
    h('div', { class: 'badges mini' }, ach.badges.map((b) => badgeCard(b, true)))));
}

// ---- Telegram: booking alerts and lesson reminders, even with the site closed ----
if (tg) {
  const note = h('div', { class: 'notice hidden', role: 'status' });
  const body = h('div');
  const draw = (linked) => {
    body.replaceChildren(
      h('p', { class: 'meta' }, linked ? 'Connected. You get booking alerts and a reminder 1 hour before each lesson.' : 'Get booking alerts and a reminder 1 hour before each lesson in Telegram.'),
      !tg.configured ? h('p', { class: 'hint' }, 'The bot is not switched on for this server yet.') :
        linked ? h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { await api('POST', '/api/mobile/telegram/unlink', {}); toast('Telegram disconnected'); draw(false); } }, icon('close'), 'Disconnect')
          : h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: async () => {
            try { const { url } = await api('POST', '/api/mobile/telegram/link', {}); window.open(url, '_blank', 'noopener'); say(note, 'Press Start in Telegram, then come back.', 'ok'); }
            catch (e) { say(note, e.message, 'error'); }
          } }, icon('plane'), 'Connect Telegram'));
  };
  draw(tg.linked);
  aside.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, iconTile('plane', '', 'tg'), h('div', {}, h('h3', {}, 'Telegram'), h('p', { class: 'meta' }, tg.linked ? 'Connected' : 'Not connected'))), note, body));
}
