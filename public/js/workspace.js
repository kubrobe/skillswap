import { api, h, $, requireLogin, renderShell, say, toast } from '/app.js';

await requireLogin();
renderShell();
const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
const err = h('div', { class: 'notice error hidden', role: 'alert' });

let ws;
try { ws = await api('GET', `/api/exchanges/${id}/workspace`); }
catch (e) { box.append(h('div', { class: 'notice error' }, e.message), h('a', { class: 'btn btn-secondary', href: '/exchanges' }, 'Back to swaps')); throw e; }

const LABEL = { todo: 'Not started', doing: 'In progress', done: 'Done' };
const TONE = { todo: 'gray', doing: 'amber', done: 'green' };

function draw() {
  const { exchange, progress } = ws;
  const open = exchange.status === 'accepted';
  $('.page-title').textContent = `${exchange.skill_wanted} ↔ ${exchange.skill_offered}`;
  $('.page-sub').textContent = `With ${exchange.other_name}${open ? '' : ' · finished, read-only'}`;
  box.replaceChildren();

  const bar = h('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress.percent, 'aria-label': 'Progress' }, h('div', { class: 'bar-fill' }));
  bar.firstChild.style.width = `${progress.percent}%`;   // set from JavaScript: the page's security policy blocks inline style attributes
  box.append(
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-secondary btn-small', href: `/chat?id=${id}` }, 'Open chat'),
      h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${exchange.other_id}` }, `View ${exchange.other_name.split(' ')[0]}`)),
    err,
    h('div', { class: 'card' }, h('h3', {}, 'Progress'), h('p', { class: 'meta' }, progress.total ? `${progress.done} of ${progress.total} milestones done (${progress.percent}%)` : 'Add your first milestone below.'), bar));

  // Milestones
  box.append(h('h2', {}, 'Milestones'));
  if (!ws.milestones.length) box.append(h('p', { class: 'empty' }, 'No milestones yet. Example: "Python fundamentals", "Functions and loops", "Build a mini project".'));
  for (const m of ws.milestones) {
    const sel = h('select', { 'aria-label': `Status of ${m.title}`, disabled: !open },
      Object.entries(LABEL).map(([v, t]) => h('option', { value: v, selected: v === m.status }, t)));
    sel.addEventListener('change', () => run(() => api('PATCH', `/api/exchanges/${id}/milestones/${m.id}`, { status: sel.value })));
    box.append(h('div', { class: `card milestone ms-${m.status}` },
      h('div', { class: 'row ms-top' }, h('h3', {}, m.title), h('span', { class: `chip chip-${TONE[m.status]}` }, LABEL[m.status])),
      open ? h('div', { class: 'row' }, sel, h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => run(() => api('DELETE', `/api/exchanges/${id}/milestones/${m.id}`)) }, 'Remove')) : null));
  }
  if (open) {
    const title = h('input', { id: 'ms-title', maxlength: 120, placeholder: 'New milestone, e.g. Functions and loops', 'aria-label': 'New milestone' });
    const add = h('form', { class: 'card', novalidate: true }, h('div', { class: 'field' }, title), h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Add milestone'));
    add.addEventListener('submit', (e) => { e.preventDefault(); if (title.value.trim()) run(() => api('POST', `/api/exchanges/${id}/milestones`, { title: title.value })); });
    box.append(add);
  }

  // Goal and shared notes
  const objective = h('textarea', { id: 'objective', maxlength: 300, rows: 2, disabled: !open, placeholder: 'What do you want to be able to do at the end?' }, ws.objective);
  const notes = h('textarea', { id: 'notes', maxlength: 2000, rows: 6, disabled: !open, placeholder: 'Shared notes, links, homework...' }, ws.notes);
  const form = h('form', { class: 'card', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'objective' }, 'Learning goal'), objective),
    h('div', { class: 'field' }, h('label', { for: 'notes' }, 'Shared notes ', h('span', { class: 'hint' }, '(both of you can edit)')), notes),
    ws.updated_by ? h('p', { class: 'meta' }, `Last saved by ${ws.updated_by}`) : null,
    open ? h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save goal and notes') : null);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(() => api('PUT', `/api/exchanges/${id}/workspace`, { objective: objective.value, notes: notes.value }), 'Saved'); });
  box.append(h('h2', {}, 'Goal and notes'), form);
}

async function run(action, ok) {
  try { ws = await action(); say(err, ''); draw(); if (ok) toast(ok); }
  catch (e) { say(err, e.message); }
}
draw();
