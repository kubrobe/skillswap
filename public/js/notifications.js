import { api, h, $, requireLogin, renderShell, empty, skeleton, ago } from '/app.js';

await requireLogin();
renderShell();
const box = $('#content');
const ICON = { request: '\u{1F4E5}', accepted: '✅', declined: '❌', cancelled: '↩', completed: '\u{1F3C1}', message: '\u{1F4AC}', review: '⭐', milestone: '\u{1F3AF}' };

async function load() {
  box.replaceChildren(...skeleton(3));
  const { unread, items } = await api('GET', '/api/notifications');
  box.replaceChildren();
  if (!items.length) { box.append(empty('Nothing yet. You will see swap requests, messages and reviews here.')); return; }
  if (unread) box.append(h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { await api('POST', '/api/notifications/read', {}); load(); } }, `Mark all ${unread} as read`));
  for (const n of items) {
    const card = h('a', { class: `card card-link notif${n.read_at ? '' : ' unread'}`, href: n.link },
      h('span', { class: 'notif-icon', 'aria-hidden': 'true' }, ICON[n.type] || '\u{1F514}'),
      h('div', {}, h('p', { class: 'notif-body' }, n.body), h('p', { class: 'meta' }, ago(n.created_at))));
    card.addEventListener('click', (e) => {
      if (n.read_at) return;
      e.preventDefault();
      api('POST', '/api/notifications/read', { id: n.id }).finally(() => { location.href = n.link; });
    });
    box.append(card);
  }
}
load();
