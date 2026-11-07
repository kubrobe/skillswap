// Shared helpers used by every page. Plain JavaScript, no framework.

// Talk to the server. Throws an Error with the server's message if something goes wrong.
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Build a DOM element safely. Text goes in with textContent, so user input can never run as HTML (XSS-safe).
//   h('a', { class: 'btn', href: '/x' }, 'Open')
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Redirect to /login when nobody is logged in; otherwise return the user.
let currentUser = null;
export async function requireLogin() {
  const { user } = await api('GET', '/api/me');
  if (!user) { location.href = '/login'; return new Promise(() => {}); }
  currentUser = user;
  return user;
}

// Small message that appears at the bottom for a moment ("Request accepted").
export function toast(text, tone = 'ok') {
  const t = h('div', { class: `toast toast-${tone}`, role: 'status' }, text);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// Grey pulsing placeholders shown while data loads.
export function skeleton(count = 3) {
  return Array.from({ length: count }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'sk-line sk-title' }), h('div', { class: 'sk-line' }), h('div', { class: 'sk-line sk-short' })));
}

// "2 days ago" style time.
export function ago(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, sec] of units) if (s >= sec) { const n = Math.floor(s / sec); return `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  return 'just now';
}

const ICONS = {
  home:   '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  skills: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  swaps:  '<path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5"/>',
  me:     '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
};
const TABS = [
  ['/dashboard', 'Home', 'home'],
  ['/browse', 'Browse', 'search'],
  ['/skills', 'My skills', 'skills'],
  ['/exchanges', 'Swaps', 'swaps'],
  ['/profile', 'Profile', 'me'],
];

// Adds the top bar and the bottom tab bar around <main>.
export function renderShell() {
  const here = location.pathname.replace(/\.html$/, '');
  document.body.dataset.page = here;   // lets the CSS pick a layout per page
  const logout = h('button', { class: 'btn-link', type: 'button', onclick: async () => {
    await api('POST', '/api/logout'); location.href = '/';
  } }, 'Log out');
  document.body.prepend(
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    h('header', { class: 'app-header' }, h('div', { class: 'app-header-inner' },
      h('a', { class: 'brand', href: '/dashboard', 'aria-label': 'SkillSwap home' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }), 'SkillSwap'),
      h('div', { class: 'header-actions' }, currentUser ? h('a', { class: 'avatar', href: '/profile', 'aria-label': `Profile: ${currentUser.display_name}`, title: currentUser.display_name }, (currentUser.display_name || '?').trim().charAt(0).toUpperCase()) : false, window.skillswapTheme ? window.skillswapTheme.makeButton() : false, logout))));
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Main' });
  for (const [href, label, icon] of TABS) {
    const a = h('a', { href, 'aria-current': (here === href || (href === '/browse' && here === '/member')) ? 'page' : false });
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
    a.append(h('span', {}, label));
    nav.append(a);
  }
  document.body.append(nav);
}

// Shows a message in an element with aria-live so screen readers announce it too.
export function say(el, text, kind = 'error') {
  el.textContent = text;
  el.className = `notice ${kind}` + (text ? '' : ' hidden');
}

// Small reusable pieces
export const chip = (text, tone = 'blue') => h('span', { class: `chip chip-${tone}` }, text);
export const empty = (text) => h('p', { class: 'empty' }, text);

export function skillSelect(skills, id, label, extra = {}) {
  // <select> grouped by category (<optgroup>)
  const select = h('select', { id, name: id, required: true, ...extra }, h('option', { value: '' }, 'Choose a skill...'));
  const groups = new Map();
  for (const s of skills) {
    if (!groups.has(s.category)) groups.set(s.category, h('optgroup', { label: s.category }));
    groups.get(s.category).append(h('option', { value: s.id }, s.name));
  }
  select.append(...groups.values());
  return h('div', { class: 'field' }, h('label', { for: id }, label), select);
}
