import { api, h, $, icon, requireLogin, renderShell, say, avatar, emptyState, firstName } from '/app.js';

await requireLogin();
renderShell();
const id = Number(new URLSearchParams(location.search).get('id'));
const box = $('#content');
const err = h('div', { class: 'notice error hidden', role: 'alert' });
$('.page-head').classList.add('hidden');

let data;
try { data = await api('GET', `/api/exchanges/${id}/messages`); }
catch (e) { box.append(emptyState('message', 'Chat not found', e.message, h('a', { class: 'btn btn-secondary btn-small', href: '/messages' }, icon('arrow_left'), 'Back to messages'))); throw e; }

const { exchange, me } = data;
document.title = `${exchange.other_name} - SkillSwap`;

const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-label': `Messages with ${exchange.other_name}` });
const older = h('button', { class: 'btn btn-ghost btn-small hidden', type: 'button' }, 'Load older messages');
let lastId = 0, firstId = Infinity, lastDay = '';

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const bubble = (m) => h('div', { class: `bubble ${m.sender_id === me ? 'mine' : 'theirs'}` }, h('p', {}, m.body), h('span', { class: 'when' }, time(m.created_at)));

// Messages with a small date line whenever the day changes
function nodes(msgs) {
  const out = [];
  let day = '';
  for (const m of msgs) {
    const d = dayOf(m.created_at);
    if (d !== day) { out.push(h('p', { class: 'day-sep' }, d)); day = d; }
    out.push(bubble(m));
  }
  return { out, day };
}
function add(msgs, atTop = false) {
  if (!msgs.length) return;
  if (atTop) { thread.prepend(...nodes(msgs).out); }
  else {
    const { out } = nodes(msgs);
    if (out[0].classList.contains('day-sep') && out[0].textContent === lastDay) out.shift();
    thread.append(...out);
    lastDay = dayOf(msgs[msgs.length - 1].created_at);
  }
  lastId = Math.max(lastId, ...msgs.map((m) => m.id)); firstId = Math.min(firstId, ...msgs.map((m) => m.id));
}
const toBottom = (smooth = true) => window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

older.addEventListener('click', async () => {
  const r = await api('GET', `/api/exchanges/${id}/messages?before=${firstId}`);
  add(r.messages, true); older.classList.toggle('hidden', !r.has_more);
});
add(data.messages); older.classList.toggle('hidden', !data.has_more);

const head = h('div', { class: 'chat-head' },
  h('a', { class: 'icon-btn', href: '/messages', 'aria-label': 'Back to messages' }, icon('arrow_left')),
  avatar(exchange.other_name, exchange.other_id, '', `/member?id=${exchange.other_id}`),
  h('div', {}, h('h1', {}, exchange.other_name), h('p', {}, `${exchange.skill_wanted} ↔ ${exchange.skill_offered}`)),
  h('a', { class: 'btn btn-secondary btn-small', href: `/workspace?id=${id}` }, icon('target'), h('span', { class: 'hide-sm' }, 'Workspace')));
const wrap = h('div', { class: 'chat-wrap' }, head, err, older, thread);
box.append(wrap);
if (!data.messages.length) thread.append(h('div', { id: 'none' }, emptyState('message', `Say hello to ${firstName(exchange.other_name)}`, 'Suggest a time for your first lesson.')));

if (exchange.status === 'accepted') {
  const input = h('textarea', { id: 'body', rows: 1, maxlength: 1000, placeholder: 'Write a message', 'aria-label': 'Message' });
  const send = h('button', { class: 'btn btn-primary btn-icon', type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const form = h('form', { class: 'composer', novalidate: true }, input, send);
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  const sendNow = async () => {
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      const m = await api('POST', `/api/exchanges/${id}/messages`, { body: text });
      const none = $('#none'); if (none) none.remove();
      input.value = ''; grow(); say(err, ''); add([m]); toBottom();
    } catch (e) { say(err, e.message); }
    send.disabled = false; input.focus();
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); sendNow(); });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNow(); } });
  wrap.append(form);
} else {
  wrap.append(h('p', { class: 'notice info' }, icon('lock'), 'This swap is finished, so the chat is read-only.'));
}

// New messages: ask the server every 5 seconds while this page is open (simple polling).
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const r = await api('GET', `/api/exchanges/${id}/messages?after=${lastId}`);
    if (r.messages.length) { const none = $('#none'); if (none) none.remove(); add(r.messages); toBottom(); }
  } catch { /* ignore a failed poll */ }
}, 5000);
setTimeout(() => toBottom(false), 50);
