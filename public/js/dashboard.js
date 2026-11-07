import { api, h, $, requireLogin, renderShell, chip, empty, skeleton } from '/app.js';

const user = await requireLogin();
renderShell();
$('.page-title').textContent = `Hi, ${user.display_name.split(' ')[0]}`;

$('#content').replaceChildren(...skeleton(3));
const [matches, exchanges, offers, wants] = await Promise.all([
  api('GET', '/api/matches'),
  api('GET', '/api/exchanges'),
  api('GET', '/api/me/offers'),
  api('GET', '/api/me/requests'),
]);

const box = $('#content');
box.replaceChildren();
const waiting = exchanges.filter((e) => e.direction === 'incoming' && e.status === 'pending').length;

// 1. Nudge to complete the setup (matching needs both lists)
if (!offers.length || !wants.length) {
  box.append(h('div', { class: 'card' },
    h('h3', {}, 'Get your first matches'),
    h('p', {}, 'Matching compares what you can teach with what you want to learn.'),
    h('p', { class: 'meta' }, `You have ${offers.length} skill(s) to teach and ${wants.length} you want to learn.`),
    h('a', { class: 'btn btn-primary btn-small', href: '/skills' }, 'Add your skills')));
}

// 2. Requests waiting for an answer
if (waiting) {
  box.append(h('a', { class: 'card card-link', href: '/exchanges' },
    h('h3', {}, `${waiting} swap request${waiting > 1 ? 's' : ''} waiting for you`),
    h('p', { class: 'meta' }, 'Open to accept or decline.')));
}

// 3. Matches
box.append(h('h2', {}, 'Your matches'));
if (!matches.length) {
  box.append(empty('No matches yet. Add skills you can teach and skills you want to learn, or browse members.'));
}
for (const m of matches) {
  box.append(h('a', { class: 'card card-link', href: `/member?id=${m.id}` },
    h('h3', {}, m.display_name),
    h('p', { class: 'meta' }, m.city || 'City not set'),
    m.mutual ? h('div', { class: 'row' }, chip('Fair swap: you can teach each other', 'green')) : null,
    m.they_teach_me.length ? h('div', { class: 'row' }, h('span', { class: 'match-note' }, 'Can teach you:'), m.they_teach_me.map((s) => chip(s.name, 'blue'))) : null,
    m.i_teach_them.length ? h('div', { class: 'row' }, h('span', { class: 'match-note' }, 'Wants to learn from you:'), m.i_teach_them.map((s) => chip(s.name, 'violet'))) : null));
}

// 4. Link to the statistics page
box.append(h('a', { class: 'card card-link', href: '/insights' },
  h('h3', {}, 'Insights'),
  h('p', { class: 'meta' }, 'What people search for and how active the community is.')));
