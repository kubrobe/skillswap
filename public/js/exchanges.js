import { api, h, $, requireLogin, renderShell, chip, empty, say } from '/app.js';

await requireLogin();
renderShell();

const box = $('#content');
const msg = h('div', { class: 'notice error hidden', role: 'alert' });
box.before(msg);

const features = await api('GET', '/api/features');
const TONE = { pending: 'amber', accepted: 'green', completed: 'green', declined: 'red', cancelled: 'gray' };

// Which buttons to show: same rules as the server (the server enforces them too)
function actionsFor(e) {
  const acts = [];
  if (e.status === 'pending' && e.direction === 'incoming') acts.push(['accept', 'Accept', 'btn-primary'], ['decline', 'Decline', 'btn-danger']);
  if (e.status === 'pending' && e.direction === 'outgoing') acts.push(['cancel', 'Cancel request', 'btn-danger']);
  if (e.status === 'accepted') acts.push(['complete', 'Mark as done', 'btn-primary']);
  return acts;
}

// Review form for a finished swap (saved in MongoDB)
function reviewForm(e, other) {
  const note = h('div', { class: 'notice hidden', role: 'status' });
  const rating = h('select', { id: `rating-${e.id}`, 'aria-label': 'Rating' }, [5, 4, 3, 2, 1].map((n) => h('option', { value: n }, `${n} - ${'★'.repeat(n)}`)));
  const comment = h('input', { id: `comment-${e.id}`, maxlength: 300, placeholder: `How was it with ${other.split(' ')[0]}?`, 'aria-label': 'Comment' });
  const form = h('form', { class: 'review' }, note,
    h('div', { class: 'field' }, h('label', { for: `rating-${e.id}` }, 'Leave a review'), rating),
    h('div', { class: 'field' }, comment),
    h('button', { class: 'btn btn-secondary btn-small', type: 'submit' }, 'Send review'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('POST', `/api/exchanges/${e.id}/review`, { rating: rating.value, comment: comment.value }); say(note, 'Thanks! Review saved.', 'ok'); form.querySelector('button').disabled = true; }
    catch (err) { say(note, err.message, 'error'); }
  });
  return form;
}

function card(e) {
  const incoming = e.direction === 'incoming';
  const other = incoming ? e.requester_name : e.provider_name;
  const otherId = incoming ? e.requester_id : e.provider_id;
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, chip(e.status, TONE[e.status])),
    h('h3', {}, incoming ? `${other} wants to swap with you` : `Your request to ${other}`),
    h('p', {}, incoming
      ? `They want to learn ${e.skill_wanted} and can teach you ${e.skill_offered}.`
      : `You want to learn ${e.skill_wanted} and will teach ${e.skill_offered}.`),
    e.message ? h('p', { class: 'meta' }, `"${e.message}"`) : null,
    h('div', { class: 'row' },
      actionsFor(e).map(([action, label, cls]) => h('button', { class: `btn btn-small ${cls}`, type: 'button', onclick: async () => {
        try { await api('PATCH', `/api/exchanges/${e.id}`, { action }); load(); } catch (err) { say(msg, err.message); }
      } }, label)),
      h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${otherId}` }, `View ${other.split(' ')[0]}`)),
    e.status === 'completed' && features.mongo ? reviewForm(e, other) : null);
}

async function load() {
  say(msg, '');
  const all = await api('GET', '/api/exchanges');
  box.replaceChildren();
  const open = (e) => e.status === 'pending' || e.status === 'accepted';
  const groups = [
    ['Waiting for you', all.filter((e) => e.direction === 'incoming' && open(e))],
    ['Sent by you', all.filter((e) => e.direction === 'outgoing' && open(e))],
    ['Finished', all.filter((e) => !open(e))],
  ];
  if (!all.length) box.append(empty('No swap requests yet. Find someone on the Browse tab.'));
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    box.append(h('h2', {}, title), ...rows.map(card));
  }
}
load();
