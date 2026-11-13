import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, chip, say, toast, skeleton, ago, avatar, skillTile,
  emptyState, sectionTitle, firstName, stagger,
} from '/app.js';

await requireLogin();
renderShell();
await loadCategories();

const box = $('#content');
const msg = h('div', { class: 'notice error hidden', role: 'alert' });
box.before(msg);
$('.page-actions').append(h('a', { class: 'btn btn-secondary btn-small', href: '/messages' }, icon('message'), 'Messages'),
  h('a', { class: 'btn btn-primary btn-small', href: '/browse' }, icon('plus'), 'New swap'));

const DONE = { accept: 'Request accepted. A chat is open now.', decline: 'Request declined', cancel: 'Request cancelled', complete: 'Swap marked as done' };
const TONE = { pending: 'amber', accepted: 'green', completed: 'gold', declined: 'red', cancelled: 'gray' };
const LABEL = { pending: 'Waiting', accepted: 'In progress', completed: 'Finished', declined: 'Declined', cancelled: 'Cancelled' };
const STATUS_ICON = { pending: 'hourglass', accepted: 'bolt', completed: 'check_circle', declined: 'close', cancelled: 'undo' };

// Which buttons to show: same rules as the server (the server enforces them too)
function actionsFor(e) {
  const acts = [];
  if (e.status === 'pending' && e.direction === 'incoming') acts.push(['accept', 'Accept', 'btn-primary', 'check'], ['decline', 'Decline', 'btn-danger', 'close']);
  if (e.status === 'pending' && e.direction === 'outgoing') acts.push(['cancel', 'Cancel request', 'btn-danger', 'undo']);
  if (e.status === 'accepted') acts.push(['complete', 'Mark as done', 'btn-primary', 'check_circle']);
  return acts;
}

// Review form for a finished swap: five star buttons and a comment (one review per person per swap)
function reviewForm(e, other) {
  const note = h('div', { class: 'notice hidden', role: 'status' });
  let rating = 5;
  const starsRow = h('div', { class: 'row star-pick', role: 'radiogroup', 'aria-label': 'Rating' });
  const paint = () => [...starsRow.children].forEach((b, i) => { b.classList.toggle('on', i < rating); b.setAttribute('aria-checked', String(i + 1 === rating)); });
  for (let n = 1; n <= 5; n++) {
    starsRow.append(h('button', { type: 'button', role: 'radio', 'aria-label': `${n} star${n > 1 ? 's' : ''}`, onclick: () => { rating = n; paint(); } }, icon('star_fill')));
  }
  paint();
  const comment = h('input', { maxlength: 300, placeholder: `How was it with ${firstName(other)}?`, 'aria-label': 'Comment' });
  const form = h('form', { class: 'review' }, note,
    h('p', { class: 'label' }, 'Leave a review'), starsRow,
    h('div', { class: 'row' }, comment, h('button', { class: 'btn btn-secondary btn-small', type: 'submit' }, icon('send'), 'Send')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const send = form.querySelector('button[type=submit]');
    if (send.disabled) return;
    send.disabled = true;
    try { await api('POST', `/api/exchanges/${e.id}/review`, { rating, comment: comment.value }); toast('Review saved. Thank you!'); load(); }
    catch (err) { say(note, err.message, 'error'); send.disabled = false; }
  });
  return form;
}

const WORDS = { pending: 'Request sent', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled', completed: 'Marked as done' };
const DOT = { pending: 'amber', accepted: 'green', completed: 'green', declined: 'red', cancelled: 'gray' };
// Vertical history of the swap, read from the exchange_status_log table.
function timeline(e) {
  return h('ol', { class: 'timeline', 'aria-label': 'History' }, (e.timeline || []).map((t) =>
    h('li', {}, h('span', { class: `dot dot-${DOT[t.status]}` }), h('span', { class: 'tl-text' }, `${WORDS[t.status] || t.status} by ${firstName(t.by)}`), h('span', { class: 'tl-when' }, ago(t.at)))));
}

function card(e) {
  const incoming = e.direction === 'incoming';
  const other = incoming ? e.requester_name : e.provider_name;
  const otherId = incoming ? e.requester_id : e.provider_id;
  // What *I* learn and what *I* teach in this swap
  const iLearn = incoming ? e.skill_offered : e.skill_wanted;
  const iTeach = incoming ? e.skill_wanted : e.skill_offered;
  const open = e.status === 'accepted' || e.status === 'completed';
  return h('article', { class: 'card' },
    h('div', { class: 'card-head' }, avatar(other, otherId, '', `/member?id=${otherId}`),
      h('div', {}, h('h3', {}, incoming ? `${firstName(other)} wants to swap` : `Your request to ${firstName(other)}`), h('p', { class: 'meta' }, ago(e.created_at))),
      chip(LABEL[e.status] || e.status, TONE[e.status], STATUS_ICON[e.status])),
    h('div', { class: 'pair' },
      h('div', { class: 'side' }, skillTile(iLearn, { size: 'sm' }), h('div', {}, h('small', {}, 'You learn'), h('b', {}, iLearn))),
      h('span', { class: 'swap-ic', 'aria-hidden': 'true' }, icon('swap')),
      h('div', { class: 'side' }, skillTile(iTeach, { size: 'sm' }), h('div', {}, h('small', {}, 'You teach'), h('b', {}, iTeach)))),
    e.message ? h('p', { class: 'msg-quote' }, `“${e.message}”`) : null,
    timeline(e),
    e.status === 'completed' && e.reviewed ? h('p', { class: 'meta' }, icon('check', 'icon inline-ic'), ' You reviewed this swap') : null,
    e.status === 'completed' && !e.reviewed ? reviewForm(e, other) : null,
    h('div', { class: 'card-foot' },
      actionsFor(e).map(([action, label, cls, ic]) => h('button', { class: `btn btn-small ${cls}`, type: 'button', onclick: async (ev) => {
        const btn = ev.currentTarget;
        if ((action === 'decline' || action === 'cancel') && !btn.dataset.armed) {   // destructive: tap twice
          btn.dataset.armed = '1'; const old = [...btn.childNodes];
          btn.replaceChildren(icon('close'), 'Tap again');
          setTimeout(() => { delete btn.dataset.armed; btn.replaceChildren(...old); }, 3000);
          return;
        }
        for (const b of btn.parentElement.querySelectorAll('button')) b.disabled = true;
        try { await api('PATCH', `/api/exchanges/${e.id}`, { action }); toast(DONE[action]); load(); } catch (err) { say(msg, err.message); load(); }
      } }, icon(ic), label)),
      open ? h('a', { class: 'btn btn-secondary btn-small', href: `/chat?id=${e.id}` }, icon('message'), 'Chat') : null,
      open ? h('a', { class: 'btn btn-secondary btn-small', href: `/workspace?id=${e.id}` }, icon('target'), 'Workspace') : null));
}

// Filter: all / waiting / in progress / finished
let filter = new URLSearchParams(location.search).get('show') || 'all';
const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Show' });
let loaded = false, animateNext = false;
async function load() {
  say(msg, '');
  if (!loaded) box.replaceChildren(...skeleton(2));   // only the first time: later reloads swap the content in place
  let all;
  try { all = await api('GET', '/api/exchanges'); }
  catch (err) { if (!loaded) box.replaceChildren(emptyState('signal_off', 'Could not load your swaps', err.message)); else say(msg, err.message); return; }
  const y = scrollY, animate = !loaded || animateNext;
  loaded = true; animateNext = false;
  const groups = {
    waiting: ['Waiting for you', 'inbox', all.filter((e) => e.direction === 'incoming' && e.status === 'pending')],
    sent: ['Sent by you', 'send', all.filter((e) => e.direction === 'outgoing' && e.status === 'pending')],
    active: ['In progress', 'bolt', all.filter((e) => e.status === 'accepted')],
    finished: ['Finished', 'check_circle', all.filter((e) => !['pending', 'accepted'].includes(e.status))],
  };
  const FILTERS = [['all', 'All', all.length], ['waiting', 'Waiting', groups.waiting[2].length + groups.sent[2].length], ['active', 'In progress', groups.active[2].length], ['finished', 'Finished', groups.finished[2].length]];
  tabs.replaceChildren(...FILTERS.map(([key, label, n]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(filter === key), onclick: () => { filter = key; animateNext = true; history.replaceState(null, '', key === 'all' ? location.pathname : `?show=${key}`); load(); } }, `${label} · ${n}`)));
  box.replaceChildren(h('div', { class: 'row' }, tabs));
  if (!all.length) {
    box.append(emptyState('swap', 'No swaps yet', 'Find someone who teaches what you want to learn, and offer one of your skills in return.',
      h('a', { class: 'btn btn-primary btn-small', href: '/browse' }, icon('search'), 'Find a skill')));
    return;
  }
  const show = { all: ['waiting', 'sent', 'active', 'finished'], waiting: ['waiting', 'sent'], active: ['active'], finished: ['finished'] }[filter] || [];
  let shown = 0;
  for (const key of show) {
    const [title, ic, rows] = groups[key];
    if (!rows.length) continue;
    shown += rows.length;
    const cards = rows.map(card);
    box.append(sectionTitle(`${title} · ${rows.length}`, ic), h('div', { class: 'grid grid-2' }, animate ? stagger(cards) : cards));
  }
  if (!shown) box.append(emptyState('inbox', 'Nothing here', 'Try another filter.'));
  if (!animate) scrollTo(0, y);
}
load();
