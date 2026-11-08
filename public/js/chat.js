import { api, h, $, requireLogin, renderShell, say, toast } from '/app.js';

await requireLogin();
renderShell();
const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
const err = h('div', { class: 'notice error hidden', role: 'alert' });

let data;
try { data = await api('GET', `/api/exchanges/${id}/messages`); }
catch (e) { box.append(h('div', { class: 'notice error' }, e.message), h('a', { class: 'btn btn-secondary', href: '/messages' }, 'Back to messages')); throw e; }

const { exchange, me } = data;
$('.page-title').textContent = exchange.other_name;
$('.page-sub').textContent = `${exchange.skill_wanted} ↔ ${exchange.skill_offered}`;

const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite' });
const older = h('button', { class: 'btn btn-secondary btn-small hidden', type: 'button' }, 'Load older messages');
let lastId = 0, firstId = Infinity;

const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const bubble = (m) => h('div', { class: `bubble ${m.sender_id === me ? 'mine' : 'theirs'}` }, h('p', {}, m.body), h('span', { class: 'when' }, time(m.created_at)));

function add(msgs, atTop = false) {
  if (!msgs.length) return;
  const nodes = msgs.map(bubble);
  if (atTop) thread.prepend(...nodes); else thread.append(...nodes);
  lastId = Math.max(lastId, ...msgs.map((m) => m.id)); firstId = Math.min(firstId, ...msgs.map((m) => m.id));
}
const toBottom = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

older.addEventListener('click', async () => {
  const r = await api('GET', `/api/exchanges/${id}/messages?before=${firstId}`);
  add(r.messages, true); older.classList.toggle('hidden', !r.has_more);
});
add(data.messages); older.classList.toggle('hidden', !data.has_more);

const links = h('div', { class: 'row' },
  h('a', { class: 'btn btn-secondary btn-small', href: `/workspace?id=${id}` }, 'Learning workspace'),
  h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${exchange.other_id}` }, `View ${exchange.other_name.split(' ')[0]}`));
box.append(links, err, older, thread);
if (!data.messages.length) thread.append(h('p', { class: 'empty', id: 'none' }, 'No messages yet. Say hello and suggest a time!'));

if (exchange.status === 'accepted') {
  const input = h('textarea', { id: 'body', rows: 2, maxlength: 1000, placeholder: 'Write a message', 'aria-label': 'Message' });
  const form = h('form', { class: 'composer', novalidate: true }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send'));
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      const m = await api('POST', `/api/exchanges/${id}/messages`, { body: text });
      const none = $('#none'); if (none) none.remove();
      input.value = ''; say(err, ''); add([m]); toBottom();
    } catch (e) { say(err, e.message); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  box.append(form);
} else {
  box.append(h('p', { class: 'empty' }, 'This swap is finished, so the chat is read-only.'));
}

// New messages: ask the server every 5 seconds while this page is open (simple polling).
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const r = await api('GET', `/api/exchanges/${id}/messages?after=${lastId}`);
    if (r.messages.length) { const none = $('#none'); if (none) none.remove(); add(r.messages); toBottom(); }
  } catch { /* ignore a failed poll */ }
}, 5000);
setTimeout(toBottom, 100);
