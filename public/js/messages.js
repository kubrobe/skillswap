import { api, h, $, requireLogin, renderShell, empty, skeleton, ago } from '/app.js';

await requireLogin();
renderShell();
const box = $('#content');
box.replaceChildren(...skeleton(3));
const list = await api('GET', '/api/conversations');
box.replaceChildren();
if (!list.length) box.append(empty('No chats yet. A chat opens when a swap request is accepted. Check the Swaps tab.'));
for (const c of list) {
  const preview = c.last_body ? `${c.last_sender === c.other_id ? '' : 'You: '}${c.last_body}` : 'No messages yet. Say hello!';
  box.append(h('a', { class: `card card-link convo${c.unread ? ' unread' : ''}`, href: `/chat?id=${c.id}` },
    h('div', { class: 'row convo-top' }, h('h3', {}, c.other_name), c.unread ? h('span', { class: 'badge', 'aria-label': `${c.unread} unread` }, c.unread) : null),
    h('p', { class: 'meta' }, `${c.skill_wanted} ↔ ${c.skill_offered}${c.status === 'completed' ? ' · finished' : ''}`),
    h('p', { class: 'convo-preview' }, preview.length > 90 ? `${preview.slice(0, 90)}…` : preview),
    c.last_at ? h('p', { class: 'meta' }, ago(c.last_at)) : null));
}
