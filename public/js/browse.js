import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, skillChip, avatar, emptyState, skeleton, stagger,
  categoryClass,
} from '/app.js';
import { categoryIconId } from '/js/icons.js';

const me = await requireLogin();
renderShell();
await loadCategories();

const [skills, popular] = await Promise.all([api('GET', '/api/skills'), api('GET', '/api/stats/popular-skills')]);
const categories = [...new Map(skills.map((s) => [s.category_id, s.category]))];

// Remember the last search in the address bar, so "Back" from a member page returns to the same results.
const params0 = new URLSearchParams(location.search);
const q = h('input', { id: 'q', type: 'search', placeholder: 'Try "guitar", "Python" or "Tashkent"', 'aria-label': 'Search members', autocomplete: 'off', value: params0.get('q') || '' });
let category = params0.get('category') || '';

const catBar = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
function catButton(id, name, iconId) {
  const b = h('button', { class: `chip ${id ? categoryClass(name) : ''}`, type: 'button', 'aria-pressed': String(String(category) === String(id)) },
    iconId ? icon(iconId) : null, name);
  b.addEventListener('click', () => {
    category = id;
    for (const x of catBar.children) x.setAttribute('aria-pressed', String(x === b));
    search();
  });
  return b;
}
catBar.append(catButton('', 'All', 'layers'), ...categories.map(([id, name]) => catButton(id, name, categoryIconId(name))));

const count = h('p', { class: 'meta', 'aria-live': 'polite' });
const results = h('div', { class: 'grid grid-3' });

$('#content').append(
  h('div', { class: 'card' },
    h('div', { class: 'input-icon' }, icon('search'), q),
    h('div', { class: 'row' }, catBar)),
  popular.length ? h('div', {},
    h('p', { class: 'label' }, 'Most offered skills'),
    h('div', { class: 'chips' }, popular.map((p) => {
      const chip = skillChip(p.name);
      const b = h('button', { class: chip.className, type: 'button', title: `${p.teachers} member${p.teachers > 1 ? 's' : ''} teach this` },
        ...chip.childNodes, h('span', { class: 'muted' }, `· ${p.teachers}`));
      b.addEventListener('click', () => { q.value = p.name; search(); q.focus(); });
      return b;
    }))) : null,
  h('div', { class: 'spread section-title' }, h('h2', {}, icon('users'), 'Members'), count),
  results);

let timer;
let seq = 0;
async function search() {
  const params = new URLSearchParams({ q: q.value.trim(), category });
  if (!category) params.delete('category');
  if (!q.value.trim()) params.delete('q');
  history.replaceState(null, '', params.toString() ? `?${params}` : location.pathname);
  const mine = ++seq;
  if (!results.firstChild) results.replaceChildren(...skeleton(3));   // later searches keep the old cards until the new ones arrive
  results.classList.add('loading');
  let members;
  try { members = await api('GET', `/api/members?${params}`); }
  catch (e) { if (mine === seq) { results.classList.remove('loading'); results.replaceChildren(emptyState('signal_off', 'Search failed', e.message)); } return; }
  if (mine !== seq) return;                       // an older search answered late: ignore it
  results.classList.remove('loading');
  results.replaceChildren();
  count.textContent = `${members.length} found`;
  if (!members.length) {
    results.append(emptyState('search', 'Nobody found', 'Try a different word, or choose "All" categories.'));
    return;
  }
  results.append(...stagger(members.map((m) => h('a', { class: 'card card-link person', href: `/member?id=${m.id}` },
    h('div', { class: 'who' }, avatar(m.display_name, m.id),
      h('div', {}, h('h3', {}, m.display_name), h('span', { class: 'city' }, icon('map_pin'), m.city || 'City not set')),
      m.id === me.id ? h('span', { class: 'chip chip-gold tag-mutual' }, 'You') : null),
    m.bio ? h('p', { class: 'bio' }, m.bio) : null,
    h('p', { class: 'label' }, 'Teaches'),
    h('div', { class: 'chips' }, m.offers.length ? m.offers.map((s) => skillChip(s.name, { level: s.level })) : h('span', { class: 'meta' }, 'No skills listed yet'))))));
}
q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });  // wait until typing pauses
search();
