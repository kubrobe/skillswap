import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, say, ago, tier, skillChip, skillTile, avatar, stars,
  emptyState, sectionTitle, firstName, stagger,
} from '/app.js';

const me = await requireLogin();
renderShell();
await loadCategories();

const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
let member;
try {
  member = await api('GET', `/api/members/${id}`);
} catch (err) {
  $('.page-head').classList.add('hidden');
  box.append(emptyState('search', 'Member not found', err.message, h('a', { class: 'btn btn-secondary btn-small', href: '/browse' }, icon('arrow_left'), 'Back to Find a skill')));
  throw err;
}
document.title = `${member.display_name} - SkillSwap`;
$('.page-head').classList.add('hidden');
const own = member.id === me.id;
const first = firstName(member.display_name);

const [rv, av, myOffers] = await Promise.all([
  api('GET', `/api/members/${id}/reviews`).catch(() => ({ enabled: false })),
  api('GET', `/api/members/${id}/availability`).catch(() => ({ slots: [], shared: [] })),
  own ? Promise.resolve([]) : api('GET', '/api/me/offers'),
]);

// ---- Profile header ----
box.append(h('section', { class: 'card gold-edge' },
  h('div', { class: 'row' }, h('a', { class: 'btn-link', href: '/browse' }, icon('arrow_left'), 'Find a skill')),
  h('div', { class: 'who person' },
    avatar(member.display_name, member.id, 'lg'),
    h('div', {},
      h('h1', { class: 'page-title' }, member.display_name),
      h('p', { class: 'city' }, icon('map_pin'), member.city || 'City not set'),
      h('div', { class: 'row' },
        rv.enabled && rv.count ? h('span', { class: 'rating' }, stars(rv.average), `${rv.average} · ${rv.count} review${rv.count > 1 ? 's' : ''}`) : h('span', { class: 'chip chip-gray' }, 'No reviews yet'),
        h('span', { class: 'chip chip-gold' }, icon('cap'), `Teaches ${member.offers.length}`),
        own ? h('a', { class: 'chip chip-gold', href: '/profile' }, icon('edit'), 'This is you · edit') : null))),
  member.bio ? h('p', { class: 'bio-full' }, member.bio) : null));

const main = h('div');
const aside = h('div', { class: 'sticky' });
box.append(h('div', { class: 'cols' }, main, aside));

// ---- Skills ----
main.append(sectionTitle(`${own ? 'You' : first} can teach`, 'cap'));
if (!member.offers.length) main.append(emptyState('cap', 'Nothing listed yet', `${first} has not added a skill to teach.`));
main.append(...stagger(member.offers.map((o) => h('div', { class: 'card skill-row' }, skillTile(o.skill),
  h('div', {}, h('h3', {}, o.skill), tier(o.level), o.description ? h('p', {}, o.description) : null)))));

main.append(sectionTitle('Wants to learn', 'target'));
main.append(member.wants.length ? h('div', { class: 'chips' }, member.wants.map((w) => skillChip(w.skill))) : h('p', { class: 'meta' }, 'Nothing listed yet.'));

// ---- Reviews (PostgreSQL reviews table) ----
if (rv.enabled) {
  main.append(sectionTitle('Reviews', 'star'));
  if (!rv.count) main.append(emptyState('star', 'No reviews yet', 'Reviews appear after a finished swap.'));
  for (const r of rv.latest || []) {
    main.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, avatar(r.reviewer, 0, 'sm'), h('div', {}, h('h3', {}, firstName(r.reviewer)), h('p', { class: 'meta' }, `${r.skill} · ${ago(r.created_at)}`)), stars(r.rating)),
      r.comment ? h('p', {}, `“${r.comment}”`) : null));
  }
}

// ---- Weekly availability: a small week grid; green = we are both free ----
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const week = h('div', { class: 'week' }, DAYS.map((d, i) => h('div', { class: 'day' }, h('b', {}, d),
  (av.slots || []).filter((s) => s.weekday === i).map((s) => h('i', { title: `${s.start}–${s.end}` }, `${s.start}`)))));
aside.append(h('section', { class: 'card' },
  h('h3', {}, 'Availability'),
  av.slots && av.slots.length ? h('p', { class: 'meta' }, `${first}'s times in ${(av.time_zone || '').replace('_', ' ')}`) : h('p', { class: 'meta' }, 'No times shared yet.'),
  av.slots && av.slots.length ? week : null,
  !own && av.slots && av.slots.length ? h('div', {},
    h('p', { class: 'label' }, 'Free at the same time'),
    av.shared.length
      ? h('div', { class: 'chips' }, av.shared.map((s) => h('span', { class: 'chip chip-green' }, icon('clock'), `${DAYS[s.weekday]} ${s.start}–${s.end}`)))
      : h('p', { class: 'meta' }, 'No overlap yet. Agree on a time in the chat.'),
    av.shared.length ? h('p', { class: 'meta' }, `In your time zone (${(av.my_time_zone || '').replace('_', ' ')})`) : null) : null));

// ---- Swap request form ----
if (!own && member.offers.length) {
  if (!myOffers.length) {
    aside.append(h('section', { class: 'card' }, h('h3', {}, `Ask ${first} for a swap`),
      h('p', { class: 'meta' }, 'To ask for a swap you need to offer something in return. Add a skill you can teach first.'),
      h('a', { class: 'btn btn-primary btn-small', href: '/skills' }, icon('plus'), 'Add a skill')));
  } else {
    const msg = h('div', { class: 'notice error hidden', role: 'alert' });
    const wanted = h('select', { id: 'wanted', required: true }, member.offers.map((o) => h('option', { value: o.skill_id }, o.skill)));
    const offered = h('select', { id: 'offered', required: true }, myOffers.map((o) => h('option', { value: o.skill_id }, o.skill)));
    // Pre-select a skill they want to learn, if I teach it (a fair two-way swap)
    const theyWant = new Set(member.wants.map((w) => w.skill));
    const fair = myOffers.find((o) => theyWant.has(o.skill));
    if (fair) offered.value = fair.skill_id;
    const text = h('textarea', { id: 'message', maxlength: 300, placeholder: `Say hi to ${first} and suggest a time (optional)` });
    const button = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('send'), 'Send swap request');
    const form = h('form', { class: 'card gold-edge', novalidate: true },
      h('h3', {}, `Ask ${first} for a swap`),
      h('p', { class: 'meta' }, fair ? `${first} wants to learn ${fair.skill}: a fair two-way swap.` : 'Offer one of your skills in return.'),
      msg,
      h('div', { class: 'field' }, h('label', { for: 'wanted' }, 'I want to learn'), wanted),
      h('div', { class: 'field' }, h('label', { for: 'offered' }, 'I will teach'), offered),
      h('div', { class: 'field' }, h('label', { for: 'message' }, 'Message ', h('span', { class: 'hint' }, '(optional)')), text),
      button);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      try {
        await api('POST', '/api/exchanges', {
          provider_id: member.id, skill_wanted_id: wanted.value, skill_offered_id: offered.value, message: text.value,
        });
        location.href = '/exchanges';
      } catch (err) { say(msg, err.message); button.disabled = false; }
    });
    aside.append(form);
  }
}
