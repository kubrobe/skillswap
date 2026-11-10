import { api, h, $, icon, requireLogin, renderShell, emptyState, skeleton, ago, iconTile, richText, stagger } from '/app.js';

await requireLogin();
renderShell();
const box = $('#content');
// Our own icon for each kind of notification (no emoji)
const ICON = { request: 'inbox', accepted: 'check_circle', declined: 'close', cancelled: 'undo', completed: 'flag', message: 'message', review: 'star_fill', milestone: 'target' };
const actions = $('.page-actions');

async function load() {
  box.replaceChildren(...skeleton(3));
  const { unread, items } = await api('GET', '/api/notifications');
  box.replaceChildren();
  actions.replaceChildren();
  if (!items.length) { box.append(emptyState('bell', 'All quiet', 'You will see swap requests, messages and reviews here.')); return; }
  if (unread) actions.append(h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { await api('POST', '/api/notifications/read', {}); load(); } }, icon('check'), `Mark all ${unread} as read`));
  box.append(...stagger(items.map((n) => {
    const card = h('a', { class: `card card-link notif${n.read_at ? '' : ' unread'}`, href: n.link },
      iconTile(ICON[n.type] || 'bell', '', `n-${n.type}`),
      h('div', {}, h('p', { class: 'notif-body' }, richText(n.body)), h('p', { class: 'meta' }, ago(n.created_at))));
    card.addEventListener('click', (e) => {
      if (n.read_at) return;
      e.preventDefault();
      api('POST', '/api/notifications/read', { id: n.id }).finally(() => { location.href = n.link; });
    });
    return card;
  })));
}
load();
