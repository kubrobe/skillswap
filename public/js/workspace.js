import { api, h, $, icon, requireLogin, renderShell, say, toast, avatar, emptyState, skillTile, sectionTitle, firstName } from '/app.js';

await requireLogin();
renderShell();
const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
const err = h('div', { class: 'notice error hidden', role: 'alert' });

let ws;
try { ws = await api('GET', `/api/exchanges/${id}/workspace`); }
catch (e) { box.append(emptyState('target', 'Workspace not found', e.message, h('a', { class: 'btn btn-secondary btn-small', href: '/exchanges' }, icon('arrow_left'), 'Back to swaps'))); throw e; }

const LABEL = { todo: 'Not started', doing: 'In progress', done: 'Done' };
const NEXT = { todo: 'doing', doing: 'done', done: 'todo' };

function draw() {
  const { exchange, progress } = ws;
  const open = exchange.status === 'accepted';
  $('.page-title').textContent = `${exchange.skill_wanted} ↔ ${exchange.skill_offered}`;
  $('.page-sub').textContent = `With ${exchange.other_name}${open ? '' : ' · finished, read-only'}`;
  $('.page-actions').replaceChildren(
    h('a', { class: 'btn btn-secondary btn-small', href: `/chat?id=${id}` }, icon('message'), 'Chat'),
    h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${exchange.other_id}` }, icon('user'), firstName(exchange.other_name)));
  box.replaceChildren();

  // Progress ring: the colour fills as milestones are done (the percentage is set from JavaScript)
  const ring = h('div', { class: 'ring', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress.percent, 'aria-label': 'Progress' }, h('b', {}, `${progress.percent}%`));
  ring.style.setProperty('--p', progress.percent);
  const main = h('div');
  const aside = h('div', { class: 'sticky' });
  box.append(err, h('div', { class: 'cols' }, main, aside));

  aside.append(h('section', { class: 'card progress-card' }, ring,
    h('div', {}, h('h3', {}, 'Progress'), h('p', { class: 'meta' }, progress.total ? `${progress.done} of ${progress.total} milestones done` : 'Add your first milestone.'))),
    h('section', { class: 'card' }, h('p', { class: 'label' }, 'This swap'),
      h('div', { class: 'skill-row' }, skillTile(exchange.skill_wanted, { size: 'sm' }), h('div', {}, h('h3', {}, exchange.skill_wanted))),
      h('div', { class: 'skill-row', }, skillTile(exchange.skill_offered, { size: 'sm' }), h('div', {}, h('h3', {}, exchange.skill_offered))),
      h('div', { class: 'card-foot' }, avatar(exchange.other_name, exchange.other_id, 'sm'), h('span', {}, `Partner: ${exchange.other_name}`))));

  // Milestones: tap the box to move it on (not started -> in progress -> done)
  main.append(sectionTitle('Milestones', 'flag'));
  if (!ws.milestones.length) main.append(emptyState('flag', 'No milestones yet', 'Example: "Python fundamentals", "Functions and loops", "Build a mini project".'));
  for (const m of ws.milestones) {
    const check = h('button', { class: 'ms-check', type: 'button', disabled: !open, 'aria-label': `${m.title}: ${LABEL[m.status]}. Change status` }, icon(m.status === 'doing' ? 'hourglass' : 'check'));
    check.addEventListener('click', () => run(() => api('PATCH', `/api/exchanges/${id}/milestones/${m.id}`, { status: NEXT[m.status] })));
    const sel = h('select', { 'aria-label': `Status of ${m.title}`, disabled: !open }, Object.entries(LABEL).map(([v, t]) => h('option', { value: v, selected: v === m.status }, t)));
    sel.addEventListener('change', () => run(() => api('PATCH', `/api/exchanges/${id}/milestones/${m.id}`, { status: sel.value })));
    main.append(h('div', { class: `card tight milestone ms-${m.status}` }, check,
      h('div', {}, h('h3', {}, m.title), h('p', { class: 'meta' }, LABEL[m.status])),
      open ? sel : null,
      open ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${m.title}`, onclick: () => run(() => api('DELETE', `/api/exchanges/${id}/milestones/${m.id}`)) }, icon('trash')) : null));
  }
  if (open) {
    const title = h('input', { id: 'ms-title', maxlength: 120, placeholder: 'New milestone, e.g. Functions and loops', 'aria-label': 'New milestone' });
    const add = h('form', { class: 'row add-ms', novalidate: true }, title, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Add'));
    add.addEventListener('submit', (e) => { e.preventDefault(); if (title.value.trim()) run(() => api('POST', `/api/exchanges/${id}/milestones`, { title: title.value })); });
    main.append(add);
  }

  // Goal and shared notes
  const objective = h('textarea', { id: 'objective', maxlength: 300, rows: 2, disabled: !open, placeholder: 'What do you want to be able to do at the end?' }, ws.objective);
  const notes = h('textarea', { id: 'notes', maxlength: 2000, rows: 7, disabled: !open, placeholder: 'Shared notes, links, homework...' }, ws.notes);
  const form = h('form', { class: 'card', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'objective' }, 'Learning goal'), objective),
    h('div', { class: 'field' }, h('label', { for: 'notes' }, 'Shared notes ', h('span', { class: 'hint' }, '(both of you can edit)')), notes),
    ws.updated_by ? h('p', { class: 'meta' }, `Last saved by ${ws.updated_by}`) : null,
    open ? h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, icon('check'), 'Save goal and notes') : null);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(() => api('PUT', `/api/exchanges/${id}/workspace`, { objective: objective.value, notes: notes.value }), 'Saved'); });
  main.append(sectionTitle('Goal and notes', 'edit'), form);
}

async function run(action, ok) {
  try { ws = await action(); say(err, ''); draw(); if (ok) toast(ok); }
  catch (e) { say(err, e.message); }
}
draw();
