import { api, h, $, requireLogin, renderShell, chip, empty } from '/app.js';

await requireLogin();
renderShell();

const [skills, popular] = await Promise.all([api('GET', '/api/skills'), api('GET', '/api/stats/popular-skills')]);
const categories = [...new Map(skills.map((s) => [s.category_id, s.category]))];

const q = h('input', { id: 'q', type: 'search', placeholder: 'Try "guitar" or "Tashkent"', 'aria-label': 'Search members' });
const cat = h('select', { id: 'cat', 'aria-label': 'Category' },
  h('option', { value: '' }, 'All categories'),
  categories.map(([id, name]) => h('option', { value: id }, name)));
const results = h('div', { 'aria-live': 'polite' });

$('#content').append(
  h('div', { class: 'search-bar' }, q, cat),
  h('p', { class: 'match-note' }, 'Most offered skills:'),
  h('div', { class: 'chips' }, popular.map((p) => h('button', {
    class: 'chip chip-blue chip-btn', type: 'button',
    onclick: () => { q.value = p.name; search(); },
  }, `${p.name} (${p.teachers})`))),
  results);

let timer;
async function search() {
  const params = new URLSearchParams({ q: q.value, category: cat.value });
  if (!cat.value) params.delete('category');
  const members = await api('GET', `/api/members?${params}`);
  results.replaceChildren();
  if (!members.length) results.append(empty('No members found. Try a different word.'));
  for (const m of members) {
    results.append(h('a', { class: 'card card-link', href: `/member?id=${m.id}` },
      h('h3', {}, m.display_name),
      h('p', { class: 'meta' }, m.city || 'City not set'),
      h('div', { class: 'row' }, m.offers.length ? m.offers.map((s) => chip(s.name)) : h('span', { class: 'meta' }, 'No skills listed yet'))));
  }
}
q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });  // wait until typing pauses
cat.addEventListener('change', search);
search();
