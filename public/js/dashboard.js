import {
  api, h, $, icon, requireLogin, renderShell, getSync, loadCategories, skillChip, avatar, iconTile, emptyState,
  skeleton, sectionTitle, countUp, stagger, activityItem, firstName,
} from '/app.js';

const user = await requireLogin();
renderShell();
await loadCategories();

const head = $('.page-head');
const box = $('#content');
head.classList.add('hidden');                        // the welcome banner replaces the plain title
box.replaceChildren(...skeleton(3));

const [matches, exchanges, offers, wants, reviews, sync] = await Promise.all([
  api('GET', '/api/matches'),
  api('GET', '/api/exchanges'),
  api('GET', '/api/me/offers'),
  api('GET', '/api/me/requests'),
  api('GET', `/api/members/${user.id}/reviews`).catch(() => ({ enabled: false })),
  getSync(),
]);

const waiting = exchanges.filter((e) => e.direction === 'incoming' && e.status === 'pending');
const active = exchanges.filter((e) => e.status === 'accepted');
const hour = new Date().getHours();
const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

// ---- Welcome banner with the four numbers that matter ----
function stat(href, iconId, value, label) {
  const b = h('b', {}, icon(iconId), h('span', { class: 'num' }, '0'));
  countUp(b.lastChild, value, { format: (n) => (Number.isInteger(value) ? Math.round(n) : n.toFixed(1)).toString() });
  return h(href ? 'a' : 'div', { href }, b, h('span', {}, label));
}
const credits = sync?.wallet?.balance ?? 0;
const welcome = h('section', { class: 'welcome', 'aria-label': 'Overview' },
  h('p', { class: 'eyebrow' }, icon('calendar'), new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
  h('h1', {}, `${hello}, ${firstName(user.display_name)}`),
  h('p', {}, waiting.length
    ? `${waiting.length} swap request${waiting.length > 1 ? 's are' : ' is'} waiting for your answer.`
    : matches.length ? `You have ${matches.length} people to swap skills with.` : 'Add your skills to get matched with other members.'),
  h('div', { class: 'welcome-stats' },
    stat('/profile#wallet', 'coin', credits, 'time bank credits'),
    stat('/exchanges', 'swap', active.length + waiting.length, 'open swaps'),
    stat('#matches', 'users', matches.length, 'matches'),
    stat(`/member?id=${user.id}`, 'star_fill', reviews.enabled && reviews.count ? Number(reviews.average) : 0, reviews.count ? `rating · ${reviews.count} review${reviews.count > 1 ? 's' : ''}` : 'no reviews yet')));

const main = h('div');
const aside = h('div', { class: 'sticky' });
box.replaceChildren(welcome, h('div', { class: 'cols' }, main, aside));

// ---- Things to do first ----
if (!offers.length || !wants.length) {
  main.append(h('a', { class: 'callout', href: '/skills' }, iconTile('target'),
    h('div', {}, h('h3', {}, 'Get your first matches'),
      h('p', {}, `Matching compares what you teach (${offers.length}) with what you want to learn (${wants.length}). Add both.`)), icon('arrow_right')));
}
for (const e of waiting.slice(0, 2)) {
  main.append(h('a', { class: 'callout', href: '/exchanges' }, avatar(e.requester_name, e.requester_id),
    h('div', {}, h('h3', {}, `${firstName(e.requester_name)} wants to swap with you`),
      h('p', {}, `Learns ${e.skill_wanted} from you, teaches you ${e.skill_offered}.`)), icon('arrow_right')));
}

// ---- Matches ----
main.append(h('div', { id: 'matches' }), sectionTitle('Your matches', 'users', h('a', { class: 'btn-link', href: '/browse' }, 'Find more', icon('arrow_right'))));
if (!matches.length) {
  main.append(emptyState('search', 'No matches yet', 'Add skills you can teach and skills you want to learn, or look around on Find a skill.',
    h('a', { class: 'btn btn-primary btn-small', href: '/skills' }, icon('plus'), 'Add skills')));
} else {
  const grid = h('div', { class: 'grid grid-2' });
  grid.append(...stagger(matches.map((m) => h('a', { class: 'card card-link person', href: `/member?id=${m.id}` },
    h('div', { class: 'who' }, avatar(m.display_name, m.id),
      h('div', {}, h('h3', {}, m.display_name), h('span', { class: 'city' }, icon('map_pin'), m.city || 'City not set')),
      m.mutual ? h('span', { class: 'chip chip-green tag-mutual', title: 'You can teach each other' }, icon('swap'), 'Two-way') : null),
    m.they_teach_me.length ? h('div', { class: 'group' }, h('p', { class: 'label' }, 'Can teach you'), h('div', { class: 'chips' }, m.they_teach_me.map((s) => skillChip(s.name)))) : null,
    m.i_teach_them.length ? h('div', { class: 'group' }, h('p', { class: 'label' }, 'Wants to learn from you'), h('div', { class: 'chips' }, m.i_teach_them.map((s) => skillChip(s.name)))) : null))));
  main.append(grid);
}

// ---- Right column: live activity and the community ----
const feed = h('ul', { class: 'feed' });
const items = (sync?.activity || []).slice(0, 6);
if (items.length) feed.append(...items.map((a) => activityItem(a)));
else feed.append(h('li', {}, h('p', { class: 'muted' }, 'Quiet for now. New lessons appear here the moment they happen.')));
aside.append(h('section', { class: 'card', 'aria-labelledby': 'live-title' },
  h('div', { class: 'spread' }, h('h3', { id: 'live-title' }, 'Happening now'), h('span', { class: 'chip chip-green' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'LIVE')),
  h('p', { class: 'meta' }, 'Lessons booked and taught on SkillSwap, on the website and in the Android app.'),
  feed));
window.addEventListener('live:activity', (e) => {
  if (feed.firstChild && !feed.firstChild.querySelector('.stile')) feed.replaceChildren();
  feed.prepend(activityItem(e.detail, true));
  while (feed.children.length > 6) feed.lastChild.remove();
});

aside.append(
  h('a', { class: 'callout', href: '/galaxy' }, iconTile('orbit'), h('div', {}, h('h3', {}, 'Skill Galaxy'), h('p', {}, 'See who swaps with whom, live.')), icon('arrow_right')),
  h('a', { class: 'callout', href: '/leaderboard' }, iconTile('trophy'), h('div', {}, h('h3', {}, 'Badges and leaders'), h('p', {}, 'Earn badges from real lessons.')), icon('arrow_right')),
  h('a', { class: 'callout', href: '/community' }, iconTile('users'), h('div', {}, h('h3', {}, 'Community impact'), h('p', {}, 'Hours shared and money saved together.')), icon('arrow_right')));
