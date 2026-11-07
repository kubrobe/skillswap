import { api, h, $, requireLogin, renderShell, chip, empty, say, skillSelect } from '/app.js';

await requireLogin();
renderShell();

const catalog = await api('GET', '/api/skills');
const box = $('#content');

// One section for "I can teach" (offers) and one for "I want to learn" (requests)
function section({ title, path, withLevel, addLabel }) {
  const list = h('div');
  const msg = h('div', { class: 'notice error hidden', role: 'alert' });

  const select = skillSelect(catalog, `${path}-skill`, 'Skill');
  const level = withLevel
    ? h('div', { class: 'field' }, h('label', { for: `${path}-level` }, 'Your level'),
        h('select', { id: `${path}-level` }, ['beginner', 'intermediate', 'advanced'].map((l) => h('option', { value: l, selected: l === 'intermediate' }, l))))
    : null;
  const desc = h('div', { class: 'field' }, h('label', { for: `${path}-desc` }, 'Details ', h('span', { class: 'hint' }, '(optional)')),
    h('input', { id: `${path}-desc`, maxlength: 300, placeholder: withLevel ? 'What can you help with?' : 'What exactly do you want to learn?' }));
  const form = h('form', { class: 'card', novalidate: true }, h('h3', {}, addLabel), msg, select, level, desc,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Add'));

  async function load() {
    const rows = await api('GET', `/api/me/${path}`);
    list.replaceChildren();
    if (!rows.length) list.append(empty('Nothing here yet.'));
    for (const r of rows) {
      list.append(h('div', { class: 'card' },
        h('h3', {}, r.skill),
        h('div', { class: 'row' }, r.level ? chip(r.level, 'gray') : null),
        r.description ? h('p', {}, r.description) : null,
        h('button', { class: 'btn btn-danger btn-small', type: 'button', 'aria-label': `Remove ${r.skill}`, onclick: async () => {
          await api('DELETE', `/api/me/${path}/${r.id}`); load();
        } }, 'Remove')));
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const skillId = $(`#${path}-skill`).value;
    if (!skillId) return say(msg, 'Please choose a skill');
    try {
      await api('POST', `/api/me/${path}`, {
        skill_id: skillId,
        level: withLevel ? $(`#${path}-level`).value : undefined,
        description: $(`#${path}-desc`).value,
      });
      form.reset(); say(msg, '');
      load();
    } catch (err) { say(msg, err.message); }
  });

  load();
  return [h('h2', {}, title), list, form];
}

box.append(
  ...section({ title: 'I can teach', path: 'offers', withLevel: true, addLabel: 'Add a skill you can teach' }),
  ...section({ title: 'I want to learn', path: 'requests', withLevel: false, addLabel: 'Add a skill you want to learn' }));
