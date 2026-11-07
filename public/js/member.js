import { api, h, $, requireLogin, renderShell, chip, empty, say, ago } from '/app.js';

const me = await requireLogin();
renderShell();

const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
let member;
try {
  member = await api('GET', `/api/members/${id}`);
} catch (err) {
  box.append(h('div', { class: 'notice error' }, err.message), h('a', { class: 'btn btn-secondary', href: '/browse' }, 'Back to browse'));
  throw err;
}
$('.page-title').textContent = member.display_name;
$('.page-sub').textContent = member.city || 'City not set';

if (member.bio) box.append(h('p', {}, member.bio));

box.append(h('h2', {}, 'Can teach'));
if (!member.offers.length) box.append(empty('Nothing listed yet.'));
for (const o of member.offers) {
  box.append(h('div', { class: 'card' }, h('h3', {}, o.skill), h('p', { class: 'meta' }, `Level: ${o.level}`), o.description ? h('p', {}, o.description) : null));
}
// Reviews come from the PostgreSQL reviews table
const rv = await api('GET', `/api/members/${id}/reviews`);
if (rv.enabled) {
  box.append(h('h2', {}, 'Reviews'));
  if (!rv.count) box.append(empty('No reviews yet.'));
  else {
    box.append(h('div', { class: 'row' }, chip(`★ ${rv.average} / 5 average`, 'green'), chip(`${rv.count} review${rv.count > 1 ? 's' : ''}`, 'gray')));
    for (const r of rv.latest) box.append(h('div', { class: 'card' }, h('h3', {}, h('span', { class: 'stars', 'aria-label': `${r.rating} out of 5` }, `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}`), `  ${r.skill}`), r.comment ? h('p', {}, r.comment) : null, h('p', { class: 'meta' }, `${r.reviewer.split(' ')[0]} · ${ago(r.created_at)}`)));
  }
}

box.append(h('h2', {}, 'Wants to learn'), h('div', { class: 'row' }, member.wants.length ? member.wants.map((w) => chip(w.skill, 'violet')) : h('span', { class: 'meta' }, 'Nothing listed yet.')));

// ---- Swap request form ----
if (member.id === me.id) {
  box.append(h('p', { class: 'empty' }, 'This is your own profile.'));
} else if (member.offers.length) {
  const myOffers = await api('GET', '/api/me/offers');
  box.append(h('h2', {}, 'Ask for a swap'));
  if (!myOffers.length) {
    box.append(h('div', { class: 'card' }, h('p', {}, 'To ask for a swap you need to offer something in return. Add a skill you can teach first.'),
      h('a', { class: 'btn btn-primary btn-small', href: '/skills' }, 'Add a skill')));
  } else {
    const msg = h('div', { class: 'notice error hidden', role: 'alert' });
    const wanted = h('select', { id: 'wanted', required: true }, member.offers.map((o) => h('option', { value: o.skill_id }, o.skill)));
    const offered = h('select', { id: 'offered', required: true }, myOffers.map((o) => h('option', { value: o.skill_id }, o.skill)));
    const text = h('textarea', { id: 'message', maxlength: 300, placeholder: 'Say hi and suggest a time (optional)' });
    const form = h('form', { class: 'card', novalidate: true },
      msg,
      h('div', { class: 'field' }, h('label', { for: 'wanted' }, `I want to learn (from ${member.display_name.split(' ')[0]})`), wanted),
      h('div', { class: 'field' }, h('label', { for: 'offered' }, 'I will teach'), offered),
      h('div', { class: 'field' }, h('label', { for: 'message' }, 'Message ', h('span', { class: 'hint' }, '(optional)')), text),
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Send swap request'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/exchanges', {
          provider_id: member.id, skill_wanted_id: wanted.value, skill_offered_id: offered.value, message: text.value,
        });
        location.href = '/exchanges';
      } catch (err) { say(msg, err.message); }
    });
    box.append(form);
  }
}
