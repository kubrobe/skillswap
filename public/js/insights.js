import { api, h, $, requireLogin, renderShell, empty } from '/app.js';

await requireLogin();
renderShell();
const box = $('#content');

// A labelled bar. The width is set through JavaScript (allowed by our security policy).
function bar(label, value, max, note) {
  const fill = h('div', { class: 'bar-fill' });
  fill.style.width = `${Math.max(2, Math.round((value / max) * 100))}%`;
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, h('span', {}, label), h('span', {}, value.toLocaleString())),
    h('div', { class: 'bar-track', role: 'presentation' }, fill),
    note ? h('p', { class: 'bar-note' }, note) : null);
}

// ---- PostgreSQL: demand vs supply ----
const demand = await api('GET', '/api/stats/demand');
box.append(h('h2', {}, 'Most searched skills (last 7 days)'),
  h('div', { class: 'stat-grid' }, h('div', { class: 'stat' }, h('b', {}, demand.searches_last_7_days.toLocaleString()), h('span', {}, 'searches this week'))));
if (!demand.top.length) box.append(empty('No searches yet.'));
const max = demand.top.length ? demand.top[0].searches : 1;
for (const s of demand.top) box.append(bar(s.name, s.searches, max, `${s.teachers} member${s.teachers === 1 ? ' teaches' : 's teach'} this`));
box.append(h('p', { class: 'bar-note' }, 'Source: PostgreSQL (search_log). Most of these searches are generated demo data.'));

// ---- MongoDB: activity ----
const act = await api('GET', '/api/stats/activity');
box.append(h('h2', {}, 'Community activity (last 30 days)'));
if (!act.enabled) {
  box.append(empty('MongoDB is not connected, so activity statistics are switched off.'));
} else {
  const total = act.byType.reduce((s, r) => s + r.events, 0);
  const top = (rows) => (rows.length ? rows[0].events : 1);
  box.append(h('div', { class: 'stat-grid' }, h('div', { class: 'stat' }, h('b', {}, total.toLocaleString()), h('span', {}, 'events'))));
  box.append(h('h3', {}, 'By type'), ...act.byType.map((r) => bar(r._id.replace('_', ' '), r.events, top(act.byType))));
  box.append(h('h3', {}, 'By device'), ...act.byDevice.map((r) => bar(r._id, r.events, top(act.byDevice))));
  box.append(h('h3', {}, 'Top search cities'), ...act.cities.map((r) => bar(r._id, r.searches, top(act.cities.map((c) => ({ events: c.searches }))))));
  box.append(h('p', { class: 'bar-note' }, 'Source: MongoDB (activity_events aggregation).'));
}
