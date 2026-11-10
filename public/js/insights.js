import { api, h, $, icon, requireLogin, renderShell, loadCategories, emptyState, bar, skillTile, sectionTitle, countUp } from '/app.js';

await requireLogin();
renderShell();
await loadCategories();
const box = $('#content');
const main = h('div');
const aside = h('div', { class: 'sticky' });
box.append(h('div', { class: 'cols' }, main, aside));

function statTile(iconId, value, label, small) {
  const b = h('b', {}, '0');
  countUp(b, value);
  return h('div', { class: 'stat' }, h('span', { class: 'stat-ic' }, icon(iconId)), b, h('span', {}, label), small ? h('small', {}, small) : null);
}
const source = (text) => h('p', { class: 'source' }, icon('database'), text);

// ---- PostgreSQL: what people search for, and how many members teach it (demand vs supply) ----
const demand = await api('GET', '/api/stats/demand');
const max = demand.top.length ? demand.top[0].searches : 1;
const gaps = demand.top.filter((s) => s.teachers <= 1).slice(0, 3);
main.append(sectionTitle('Most searched skills · last 7 days', 'search'));
const card = h('section', { class: 'card' });
if (!demand.top.length) card.append(emptyState('search', 'No searches yet', 'Searches on Find a skill appear here.'));
for (const s of demand.top) {
  card.append(bar(s.name, s.searches, max, `${s.teachers} member${s.teachers === 1 ? ' teaches' : 's teach'} this`, skillTile(s.name, { size: 'sm' })));
}
card.append(source('PostgreSQL · search_log joined with skills and user_offers. Most searches are generated demo data.'));
main.append(card);

aside.append(h('div', { class: 'stat-grid' },
  statTile('search', demand.searches_last_7_days, 'searches this week'),
  statTile('target', demand.top.length, 'skills searched')));
if (gaps.length) {
  aside.append(h('section', { class: 'card gold-edge' }, h('h3', {}, 'Teachers wanted'),
    h('p', { class: 'meta' }, 'Many people look for these, but few teach them. A chance to earn credits:'),
    h('div', { class: 'stack' }, gaps.map((s) => h('div', { class: 'skill-row' }, skillTile(s.name, { size: 'sm' }),
      h('div', {}, h('h3', {}, s.name), h('p', {}, `${s.searches} searches · ${s.teachers} teacher${s.teachers === 1 ? '' : 's'}`))))),
    h('a', { class: 'btn btn-primary btn-small', href: '/skills' }, icon('plus'), 'Teach a skill')));
}

// ---- MongoDB: activity events (aggregation pipelines) ----
const act = await api('GET', '/api/stats/activity');
main.append(sectionTitle('Community activity · last 30 days', 'pulse'));
if (!act.enabled) {
  main.append(emptyState('database', 'Activity statistics are off', 'MongoDB is not connected on this server, so this part is switched off.'));
} else {
  const total = act.byType.reduce((s, r) => s + r.events, 0);
  const top = (rows, key = 'events') => (rows.length ? rows[0][key] : 1);
  aside.append(h('div', { class: 'stat-grid' }, statTile('bolt', total, 'events'), statTile('phone', act.byDevice.length, 'kinds of device')));
  main.append(h('div', { class: 'grid grid-2' },
    h('section', { class: 'card' }, h('h3', {}, 'By type'), ...act.byType.map((r) => bar(r._id.replace(/_/g, ' '), r.events, top(act.byType)))),
    h('section', { class: 'card' }, h('h3', {}, 'By device'), ...act.byDevice.map((r) => bar(r._id, r.events, top(act.byDevice))),
      h('h3', { class: 'mt' }, 'Top search cities'), ...act.cities.map((r) => bar(r._id, r.searches, top(act.cities, 'searches'), null, icon('map_pin'))))));
  main.append(source('MongoDB · activity_events, $match → $group → $sort aggregation pipelines.'));
}
aside.append(h('a', { class: 'callout', href: '/community' }, h('span', { class: 'stile gold' }, icon('users')), h('div', {}, h('h3', {}, 'Community impact'), h('p', {}, 'Lessons, hours and money saved.')), icon('arrow_right')));
