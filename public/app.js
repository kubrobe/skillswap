// Shared helpers used by every page. Plain JavaScript modules, no framework.
import { icon, iconSvg, skillIconId, categoryClass, categoryOfIcon, iconForEmoji } from '/js/icons.js';
export { icon, iconSvg, skillIconId, categoryClass, iconForEmoji };

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
// Never pass a "style" attribute: the security policy blocks inline styles (set el.style.x from JS instead).
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
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const firstName = (name = '') => name.trim().split(/\s+/)[0] || name;

// Redirect to /login when nobody is logged in; otherwise return the user.
let currentUser = null;
export async function requireLogin() {
  const { user } = await api('GET', '/api/me');
  if (!user) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return new Promise(() => {}); }
  currentUser = user;
  return user;
}

// One download of the shared app data (wallet, live activity...) per page, shared by everyone who asks.
let syncPromise = null;
export function getSync() {
  if (!syncPromise) syncPromise = api('GET', '/api/mobile/sync').catch(() => null);
  return syncPromise;
}

// The skill catalogue (name -> category), loaded once per page, for icons and colours.
let catalogPromise = null;
export function getCatalog() {
  if (!catalogPromise) catalogPromise = api('GET', '/api/skills').catch(() => []);
  return catalogPromise;
}
const categoryByName = new Map();
export async function loadCategories() {
  for (const s of await getCatalog()) categoryByName.set(s.name, s.category);
}
export const categoryOf = (skillName) => categoryByName.get(skillName) || categoryOfIcon(skillIconId(skillName));

// ---------- Small building blocks ----------

// Skill level as a medal: beginner = bronze, intermediate = silver, advanced = gold.
const TIERS = { beginner: 'Bronze', intermediate: 'Silver', advanced: 'Gold' };
export function tier(level) {
  return h('span', { class: `tier tier-${level}`, title: `${TIERS[level] || ''} level` }, icon('medal'), level);
}

// A skill with its own icon in its category colour (and an optional level dot).
export function skillChip(name, { level, category, title } = {}) {
  const cat = category || categoryOf(name);
  return h('span', { class: `chip skill-chip ${categoryClass(cat)}`, title: title || (level ? `${name} · ${level}` : name) },
    h('span', { class: 'dot-ic' }, icon(skillIconId(name, cat))), name,
    level ? h('span', { class: `lvl lvl-${level}`, 'aria-label': level }) : null);
}

// The skill icon on a tile tinted with its category colour.
export function skillTile(name, { category, size = '' } = {}) {
  const cat = category || categoryOf(name);
  return h('span', { class: `stile ${size} ${categoryClass(cat)}`, 'aria-hidden': 'true' }, icon(skillIconId(name, cat)));
}

// Any icon of our set on a gold tile.
export const iconTile = (id, size = '', extra = '') => h('span', { class: `stile gold ${size} ${extra}`, 'aria-hidden': 'true' }, icon(id));

// Round avatar with initials; the colour comes from the person's id, so everyone keeps theirs.
export function avatar(name = '?', id = 0, size = '', href) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  return h(href ? 'a' : 'span', { class: `avatar ${size} av-${Math.abs(Number(id) || hash(name)) % 8}`, href, 'aria-hidden': href ? false : 'true', title: name }, initials);
}
function hash(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return x; }

// Five stars for a rating.
export function stars(n, label = true) {
  return h('span', { class: 'stars', role: label ? 'img' : false, 'aria-label': label ? `${n} out of 5` : false },
    [1, 2, 3, 4, 5].map((i) => icon('star_fill', `icon${i <= Math.round(n) ? '' : ' off'}`)));
}

// Friendly empty state: an icon on a gold circle, a title, one sentence and maybe a button.
export function emptyState(iconId, title, text, action) {
  return h('div', { class: 'empty' }, h('span', { class: 'bubble-ic' }, icon(iconId)), h('strong', {}, title), text ? h('p', {}, text) : null, action || null);
}
// Older pages call empty(text): keep it, with a neutral icon.
export const empty = (text) => emptyState('spark', text, '');

// Small message that appears at the bottom for a moment ("Request accepted").
export function toast(text, tone = 'ok') {
  const t = h('div', { class: `toast toast-${tone}`, role: 'status' }, icon(tone === 'error' ? 'close' : 'check_circle'), text);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// Grey shimmering placeholders shown while data loads.
export function skeleton(count = 3) {
  return Array.from({ length: count }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'sk-line sk-title' }), h('div', { class: 'sk-line' }), h('div', { class: 'sk-line sk-short' })));
}

// "2 days ago" style time.
export function ago(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, sec] of units) if (s >= sec) { const n = Math.floor(s / sec); return `${n} ${name}${n > 1 ? 's' : ''} ago`; }
  return 'just now';
}

// Shows a message in an element with aria-live so screen readers announce it too.
export function say(el, text, kind = 'error') {
  el.textContent = text;
  el.className = `notice ${kind}` + (text ? '' : ' hidden');
}

// Section heading with an icon and an optional action on the right.
export function sectionTitle(text, iconId, action) {
  return h('div', { class: 'section-title' }, h('h2', {}, iconId ? icon(iconId) : null, text), action || null);
}

// Labelled progress bar; the width is set through JavaScript (allowed by our security policy).
export function bar(label, value, max, note, lead) {
  const fill = h('div', { class: 'bar-fill' });
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${Math.max(2, Math.round((value / (max || 1)) * 100))}%`; }));
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, h('span', {}, lead || null, label), h('span', {}, Number(value).toLocaleString('en-US'))),
    h('div', { class: 'bar-track', role: 'presentation' }, fill),
    note ? h('p', { class: 'bar-note' }, note) : null);
}

// Numbers that count up from 0 when they appear.
export function countUp(el, to, { duration = 900, format = (n) => Math.round(n).toLocaleString('en-US') } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    el.textContent = format(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Cards that appear one after another.
export function stagger(nodes) {
  nodes.forEach((n, i) => { n.classList.add('rise'); n.style.animationDelay = `${Math.min(i, 10) * 45}ms`; });
  return nodes;
}

export const chip = (text, tone = 'gray', iconId) => h('span', { class: `chip chip-${tone}` }, iconId ? icon(iconId) : null, text);

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

// ---------- Texts from the server may carry emoji: draw our own icons in their place ----------
const EMOJI_ICONS = [['🪙', 'coin'], ['🎉', 'party'], ['⭐', 'star_fill'], ['✅', 'check_circle'], ['🔁', 'swap'], ['📅', 'calendar'], ['🎓', 'cap'], ['👋', '']];
export function richText(text = '') {
  const out = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const [e, id] of EMOJI_ICONS) { const i = rest.indexOf(e); if (i >= 0 && (!best || i < best.i)) best = { i, e, id }; }
    if (!best) { out.push(rest); break; }
    if (best.i) out.push(rest.slice(0, best.i));
    if (best.id) out.push(icon(best.id, 'icon inline-ic'));
    rest = rest.slice(best.i + best.e.length).replace(/^\uFE0F/, '');
  }
  return out;
}

// One line of the LIVE activity feed: the skill's icon when we recognise the skill, else a spark.
export function activityItem(a, isNew = false) {
  const skill = [...categoryByName.keys()].sort((x, y) => y.length - x.length).find((n) => (a.text || '').includes(n));
  return h('li', { class: isNew ? 'new' : false }, skill ? skillTile(skill, { size: 'sm' }) : iconTile('bolt', 'sm'),
    h('div', {}, h('p', {}, richText(a.text)), h('span', {}, ago(a.at))));
}

// Live updates through Server-Sent Events: the same stream the Android app listens to.
// Pages listen with: window.addEventListener('live:activity', (e) => e.detail)
let liveSource = null;
function openLive() {
  if (liveSource || !('EventSource' in window)) return;
  liveSource = new EventSource('/api/mobile/events');
  for (const type of ['notice', 'credit', 'activity', 'changed']) {
    liveSource.addEventListener(type, (e) => {
      let data = {};
      try { data = JSON.parse(e.data || '{}'); } catch { /* ignore */ }
      if (type === 'notice' && data.text) toast(data.text.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?\s*/gu, '').trim());
      if (type === 'credit') bumpCredits(data.amount || 0);
      window.dispatchEvent(new CustomEvent(`live:${type}`, { detail: data }));
    });
  }
  addEventListener('pagehide', () => liveSource && liveSource.close());
}
/** Show a new credit balance in the header (after booking a lesson, for example). */
export function setCredits(n) {
  const el = $('.credits .num');
  if (!el || el.textContent === String(n)) return;
  el.textContent = String(n);
  el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump');
}
function bumpCredits(amount) {
  const n = $('.credits .num');
  if (!n || !amount) return;
  n.textContent = String((Number(n.textContent) || 0) + amount);
  n.parentElement.classList.remove('bump'); void n.offsetWidth; n.parentElement.classList.add('bump');
}

// ---------- The app shell: sidebar (laptops), top bar + tab bar (phones) ----------
const NAV = [
  ['Main', [
    ['/dashboard', 'Home', 'home'],
    ['/browse', 'Find a skill', 'search'],
    ['/skills', 'My skills', 'star'],
    ['/lessons', 'Lessons', 'calendar'],
    ['/exchanges', 'Swaps', 'swap'],
    ['/messages', 'Messages', 'message'],
    ['/notifications', 'Notifications', 'bell'],
  ]],
  ['Community', [
    ['/community', 'Community impact', 'users'],
    ['/galaxy', 'Skill Galaxy', 'orbit'],
    ['/leaderboard', 'Badges & leaders', 'trophy'],
    ['/insights', 'Insights', 'chart'],
  ]],
  ['Account', [
    ['/profile', 'Profile', 'user'],
  ]],
];
const TABS = [
  ['/dashboard', 'Home', 'home'],
  ['/browse', 'Browse', 'search'],
  ['/lessons', 'Lessons', 'calendar'],
  ['/exchanges', 'Swaps', 'swap'],
  ['/profile', 'Profile', 'user'],
];
// Pages that belong to a tab (a member page is part of Browse, a chat part of Messages...)
const PARENT = { '/member': '/browse', '/chat': '/messages', '/workspace': '/exchanges', '/galaxy': '/community', '/leaderboard': '/community', '/insights': '/community' };

function makeBell() {
  const badge = h('span', { class: 'badge hidden' });
  const a = h('a', { class: 'icon-btn', href: '/notifications', 'aria-label': 'Notifications' }, icon('bell'), badge);
  const refresh = async () => {
    try {
      const { unread } = await api('GET', '/api/notifications/count');
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
      a.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
      for (const b of $$('.nav-badge-notifications')) { b.textContent = badge.textContent; b.classList.toggle('hidden', unread === 0); }
    } catch { /* offline or logged out: ignore */ }
  };
  refresh();
  // Checked every 30 seconds while the tab is visible (simple polling, no extra server).
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  return a;
}

// Credits of the time bank (shared with the Android app: one hour taught = one credit).
function makeCredits() {
  const n = h('span', { class: 'num' }, '…');
  const a = h('a', { class: 'credits', href: '/profile#wallet', title: 'Your time bank credits', 'aria-label': 'Time bank credits' }, icon('coin'), n);
  getSync().then((s) => {
    if (!s || !s.wallet) { a.classList.add('hidden'); return; }
    n.textContent = s.wallet.balance;
    a.setAttribute('aria-label', `${s.wallet.balance} time bank credits`);
  });
  return a;
}

export function themeButton(cls = 'icon-btn') {
  const b = h('button', { class: cls, type: 'button' });
  const paint = () => {
    const dark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    b.replaceChildren(icon(dark ? 'sun' : 'moon'));
    b.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
    b.title = b.getAttribute('aria-label');
  };
  b.addEventListener('click', () => { window.skillswapTheme?.toggle(); paint(); });
  paint();
  return b;
}

export function brandMark() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#1B1D23"/><path d="M32 12v11a9 9 0 0 1-9 9H9z" fill="#E0B44C" fill-opacity=".25"/><path d="M8 12.5h14l-3.5-3.5M24 19.5H10l3.5 3.5" fill="none" stroke="#E0B44C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return t.content.firstChild;
}

export function renderShell() {
  const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const active = PARENT[here] || here;
  const navActive = NAV.some(([, items]) => items.some(([href]) => href === here)) ? here : active;
  document.body.dataset.page = here;   // lets the CSS pick a layout per page
  const logout = async () => { await api('POST', '/api/logout'); location.href = '/'; };
  const close = () => document.body.classList.remove('nav-open');
  const open = () => { document.body.classList.add('nav-open'); $('.sidebar a')?.focus(); };

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Main menu' },
    h('a', { class: 'brand', href: '/dashboard', 'aria-label': 'SkillSwap home' }, brandMark(), 'SkillSwap'),
    NAV.map(([group, items]) => h('nav', { class: 'nav-group', 'aria-label': group },
      h('p', { class: 'label' }, group),
      items.map(([href, label, ic]) => h('a', { class: 'nav-link', href, 'aria-current': navActive === href ? 'page' : false },
        icon(ic), label,
        href === '/notifications' ? h('span', { class: 'badge hidden nav-badge-notifications' }) : null)))),
    h('div', { class: 'side-foot' },
      currentUser ? h('a', { class: 'me-card', href: '/profile' }, avatar(currentUser.display_name, currentUser.id, 'sm'),
        h('div', {}, h('b', {}, currentUser.display_name), h('span', {}, currentUser.city || 'Member'))) : null,
      h('div', { class: 'side-actions' },
        themeButton('btn btn-secondary btn-small'),
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: logout }, icon('logout'), 'Log out'))));

  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu', onclick: open }, icon('menu')),
    h('a', { class: 'brand', href: '/dashboard', 'aria-label': 'SkillSwap home' }, brandMark(), 'SkillSwap'),
    h('div', { class: 'top-actions' }, makeCredits(), makeBell(),
      currentUser ? avatar(currentUser.display_name, currentUser.id, 'sm', '/profile') : null));

  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Quick links' },
    TABS.map(([href, label, ic]) => h('a', { href, 'aria-current': active === href ? 'page' : false }, icon(ic), h('span', {}, label))));

  document.body.prepend(h('a', { class: 'skip', href: '#main' }, 'Skip to content'), topbar, sidebar, h('div', { class: 'scrim', onclick: close }));
  document.body.append(tabbar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  loadCategories();
  openLive();
}
