import { api, h, $, icon, requireLogin, renderShell, avatar, emptyState, sectionTitle, stagger } from '/app.js';
import { badgeCard } from '/js/badges.js';

const user = await requireLogin();
renderShell();
const box = $('#content');

let data;
try { data = await api('GET', '/api/mobile/achievements'); }
catch (e) { box.append(emptyState('trophy', 'Could not load badges', e.message)); throw e; }

const got = data.badges.filter((b) => b.progress >= b.goal).length;
$('.page-sub').textContent = `You unlocked ${got} of ${data.badges.length} badges. They come from real lessons in the SkillSwap app.`;

box.append(sectionTitle('Your badges', 'medal'), h('div', { class: 'badges' }, stagger(data.badges.map((b) => badgeCard(b)))));

// ---- Top teachers: this week or all time ----
let weekly = data.week.length > 0;
const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Period' });
const board = h('div');
box.append(sectionTitle('Top teachers', 'trophy', tabs), board);

function place(row, n) {
  if (!row) return h('div', { class: `place p${n}` });
  return h('div', { class: `place p${n}` },
    n === 1 ? icon('crown', 'icon crown') : null,
    avatar(row.name, row.id, n === 1 ? 'md' : ''),
    h('b', {}, row.id === user.id ? `${row.name} · you` : row.name),
    h('span', { class: 'sub' }, `${row.lessons} lesson${row.lessons === 1 ? '' : 's'}${row.rating ? ` · ★ ${row.rating}` : ''}`),
    h('div', { class: 'block' }, String(n)));
}

function draw() {
  tabs.replaceChildren(...[['This week', true], ['All time', false]].map(([label, w]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(weekly === w), onclick: () => { weekly = w; draw(); } }, label)));
  const rows = weekly ? data.week : data.allTime;
  board.replaceChildren();
  if (!rows.length) {
    board.append(emptyState('trophy', 'No lessons yet this week', 'Teach a lesson in the app and you could be first.'));
    return;
  }
  board.append(h('div', { class: 'podium' }, place(rows[1], 2), place(rows[0], 1), place(rows[2], 3)));
  board.append(...stagger(rows.slice(3).map((r, i) => h('div', { class: `leader${r.id === user.id ? ' me' : ''}` },
    h('span', { class: 'rank' }, String(i + 4)), avatar(r.name, r.id, 'sm'),
    h('div', {}, h('b', {}, r.name), h('span', { class: 'meta' }, `${r.lessons} lesson${r.lessons === 1 ? '' : 's'}`)),
    r.rating ? h('span', { class: 'rating' }, icon('star_fill'), r.rating) : null,
    r.id === user.id ? h('span', { class: 'chip chip-gold' }, 'You') : null))));
}
draw();
