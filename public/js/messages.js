import { api, h, $, icon, requireLogin, renderShell, emptyState, skeleton, ago, avatar, stagger } from '/app.js';

await requireLogin();
renderShell();
const box = $('#content');
box.replaceChildren(...skeleton(3));
const list = await api('GET', '/api/conversations');
box.replaceChildren();
if (!list.length) {
  box.append(emptyState('message', 'No chats yet', 'A chat opens when a swap request is accepted.',
    h('a', { class: 'btn btn-primary btn-small', href: '/exchanges' }, icon('swap'), 'Go to Swaps')));
}
box.append(...stagger(list.map((c) => {
  const preview = c.last_body ? `${c.last_sender === c.other_id ? '' : 'You: '}${c.last_body}` : 'No messages yet. Say hello!';
  return h('a', { class: `card card-link convo${c.unread ? ' unread' : ''}`, href: `/chat?id=${c.id}` },
    avatar(c.other_name, c.other_id, 'md'),
    h('div', {},
      h('div', { class: 'top' }, h('h3', {}, c.other_name), c.last_at ? h('span', {}, ago(c.last_at)) : null),
      h('p', { class: 'convo-preview' }, preview),
      h('p', { class: 'skills' }, `${c.skill_wanted} ↔ ${c.skill_offered}${c.status === 'completed' ? ' · finished' : ''}`)),
    c.unread ? h('span', { class: 'badge inline', 'aria-label': `${c.unread} unread` }, c.unread) : null);
})));
