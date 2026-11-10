import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, getSync, bar, skillTile, sectionTitle, countUp, activityItem, iconTile,
} from '/app.js';

await requireLogin();
renderShell();
await loadCategories();
const box = $('#content');

const [impact, sync] = await Promise.all([api('GET', '/api/mobile/impact'), getSync()]);

function statTile(iconId, value, label, small, decimals = 0) {
  const b = h('b', {}, '0');
  countUp(b, value, { format: (n) => (decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-US')) });
  return h('div', { class: 'stat' }, h('span', { class: 'stat-ic' }, icon(iconId)), b, h('span', {}, label), small ? h('small', {}, small) : null);
}

box.append(h('div', { class: 'stat-grid four' },
  statTile('cap', impact.lessonsDone, 'lessons finished', `${impact.upcoming} more booked`),
  statTile('clock', impact.hoursShared, 'hours of knowledge shared'),
  statTile('users', impact.members, 'members', `${impact.teachers} of them teach`),
  statTile('star_fill', impact.avgRating, 'average rating', `${impact.reviews} reviews`, 1)));

const main = h('div');
const aside = h('div', { class: 'sticky' });
box.append(h('div', { class: 'cols' }, main, aside));

// ---- Money saved: lessons x the average price of a private tutor (clearly an estimate) ----
const saved = h('b', { class: 'num' }, '0');
countUp(saved, impact.savedUzs, { duration: 1400 });
main.append(h('section', { class: 'welcome saved' },
  h('p', { class: 'eyebrow' }, icon('wallet'), 'Saved together'),
  h('h2', {}, saved, h('span', {}, ' UZS')),
  h('p', {}, `Students did not pay a tutor for ${impact.lessonsDone} hours of lessons. ${impact.assumption}`)));

// ---- Lessons per week: a column chart; heights are set from JavaScript ----
const weeks = impact.weekly || [];
const maxW = Math.max(1, ...weeks.map((w) => w.lessons));
const lastFull = weeks.slice(-4, -1).reduce((s, w) => s + w.lessons, 0);
const before = weeks.slice(-7, -4).reduce((s, w) => s + w.lessons, 0);
const growth = before ? Math.round(((lastFull - before) / before) * 100) : null;
const chart = h('div', { class: 'cchart', role: 'img', 'aria-label': `Lessons per week: ${weeks.map((w) => w.lessons).join(', ')}` });
weeks.forEach((w, i) => {
  const bar_ = h('i');
  const d = new Date(w.week);
  const col = h('div', { class: `col${i === weeks.length - 1 ? ' dim' : ''}`, title: i === weeks.length - 1 ? 'This week (not finished yet)' : '' },
    h('b', {}, String(w.lessons)), bar_, h('span', {}, `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`));
  chart.append(col);
  requestAnimationFrame(() => requestAnimationFrame(() => { bar_.style.height = `${Math.max(4, (w.lessons / maxW) * 130)}px`; }));
});
main.append(sectionTitle('Lessons per week', 'chart',
  growth == null ? null : h('span', { class: `chip ${growth >= 0 ? 'chip-green' : 'chip-red'}` }, icon(growth >= 0 ? 'trend_up' : 'trend_down'), `${growth >= 0 ? '+' : ''}${growth}% in 3 weeks`)),
  h('section', { class: 'card' }, chart, h('p', { class: 'source' }, icon('database'), 'Finished lessons from the app and finished swaps from the website, by week.')));

// ---- Most popular skills ----
const tops = impact.topSkills || [];
main.append(sectionTitle('Most taught skills', 'trophy'),
  h('section', { class: 'card' }, tops.length ? tops.map((s) => bar(s.name, s.lessons, tops[0].lessons, null, skillTile(s.name, { size: 'sm' }))) : h('p', { class: 'meta' }, 'No lessons yet.')));

// ---- Right column: live feed and the other community pages ----
const feed = h('ul', { class: 'feed' });
const acts = (sync?.activity || []).slice(0, 8);
feed.append(...(acts.length ? acts.map((a) => activityItem(a)) : [h('li', {}, h('p', { class: 'muted' }, 'Quiet for now.'))]));
window.addEventListener('live:activity', (e) => { feed.prepend(activityItem(e.detail, true)); while (feed.children.length > 8) feed.lastChild.remove(); });
aside.append(
  h('section', { class: 'card' }, h('div', { class: 'spread' }, h('h3', {}, 'Happening now'), h('span', { class: 'chip chip-green' }, h('span', { class: 'live-dot' }), 'LIVE')), h('p', { class: 'meta' }, 'Updates by itself.'), feed),
  h('a', { class: 'callout', href: '/galaxy' }, iconTile('orbit'), h('div', {}, h('h3', {}, 'Skill Galaxy'), h('p', {}, 'Who swaps with whom.')), icon('arrow_right')),
  h('a', { class: 'callout', href: '/leaderboard' }, iconTile('trophy'), h('div', {}, h('h3', {}, 'Top teachers'), h('p', {}, 'This week and all time.')), icon('arrow_right')),
  h('a', { class: 'callout', href: '/insights' }, iconTile('chart'), h('div', {}, h('h3', {}, 'Insights'), h('p', {}, 'Searches and activity (Big Data).')), icon('arrow_right')));
