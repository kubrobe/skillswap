import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, say, skillSelect, tier, skillTile, emptyState, toast,
  sectionTitle, stagger,
} from '/app.js';

await requireLogin();
renderShell();
await loadCategories();

const catalog = await api('GET', '/api/skills');
const box = $('#content');
const LEVELS = ['beginner', 'intermediate', 'advanced'];

// One column for "I can teach" (offers) and one for "I want to learn" (requests)
function section({ title, iconId, path, withLevel, addLabel, emptyTitle, emptyText }) {
  const list = h('div', { class: 'stack' });
  const msg = h('div', { class: 'notice error hidden', role: 'alert' });
  const select = skillSelect(catalog, `${path}-skill`, 'Skill');

  // Level as three buttons (bronze, silver, gold) instead of a drop-down
  let level = 'intermediate';
  const seg = withLevel ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Your level' }, LEVELS.map((l) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(l === level) }, h('span', { class: `lvl lvl-${l}` }), l);
    b.addEventListener('click', () => { level = l; for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b)); });
    return b;
  })) : null;

  const desc = h('div', { class: 'field' }, h('label', { for: `${path}-desc` }, 'Details ', h('span', { class: 'hint' }, '(optional)')),
    h('input', { id: `${path}-desc`, maxlength: 300, placeholder: withLevel ? 'What will a learner be able to do afterwards?' : 'What exactly do you want to learn?' }));
  const form = h('form', { class: 'card gold-edge', novalidate: true },
    h('h3', {}, addLabel), msg, select,
    seg ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Your level'), seg) : null,
    desc,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('plus'), 'Add'));

  let first = true;
  async function load() {
    let rows;
    try { rows = await api('GET', `/api/me/${path}`); } catch (err) { say(msg, err.message); return; }
    list.replaceChildren();
    if (!rows.length) list.append(emptyState(iconId, emptyTitle, emptyText));
    const animate = first; first = false;      // only the first list animates in; adding a skill does not replay it
    list.append(...(animate ? stagger : (x) => x)(rows.map((r) => h('div', { class: 'card skill-row has-remove' },
      skillTile(r.skill),
      h('div', {}, h('h3', {}, r.skill), r.level ? tier(r.level) : null, r.description ? h('p', {}, r.description) : null),
      h('button', { class: 'icon-btn card-remove', type: 'button', title: 'Remove', 'aria-label': `Remove ${r.skill}`, onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { await api('DELETE', `/api/me/${path}/${r.id}`); toast(`${r.skill} removed`); load(); }
        catch (err) { say(msg, err.message); btn.disabled = false; }
      } }, icon('trash'))))));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const skillId = $(`#${path}-skill`).value;
    if (!skillId) return say(msg, 'Please choose a skill');
    const add = form.querySelector('button[type=submit]');
    if (add.disabled) return;
    add.disabled = true;
    try {
      await api('POST', `/api/me/${path}`, {
        skill_id: skillId,
        level: withLevel ? level : undefined,
        description: $(`#${path}-desc`).value,
      });
      form.reset(); say(msg, '');
      toast('Skill added. Your matches are updated.');
      load();
    } catch (err) { say(msg, err.message); }
    add.disabled = false;
  });

  load();
  return h('section', {}, sectionTitle(title, iconId), list, form);
}

box.append(h('div', { class: 'cols even' },
  section({ title: 'I can teach', iconId: 'cap', path: 'offers', withLevel: true, addLabel: 'Add a skill you can teach',
    emptyTitle: 'Nothing to teach yet', emptyText: 'Everyone is good at something: a language, a game, a recipe.' }),
  section({ title: 'I want to learn', iconId: 'target', path: 'requests', withLevel: false, addLabel: 'Add a skill you want to learn',
    emptyTitle: 'No wishes yet', emptyText: 'Add what you want to learn and we will find people who teach it.' })));
