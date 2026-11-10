// Lessons of the time bank, on the website: the same offers, weekly times and bookings as the Android app.
// Book a 1-hour lesson for 1 credit; the teacher shows a 4-digit check-in code, the learner types it in
// after the lesson, and the teacher earns the credit. All rules are checked on the server.
import {
  api, h, $, icon, requireLogin, renderShell, loadCategories, avatar, skillTile, tier, stars, emptyState, sectionTitle,
  say, toast, setCredits, stagger, categoryClass, firstName,
} from '/app.js';
import { categoryIconId } from '/js/icons.js';

const me = await requireLogin();
renderShell();
await loadCategories();
const box = $('#content');
const msg = h('div', { class: 'notice error hidden', role: 'alert' });
box.before(msg);

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const slotLabel = (s) => `${DAYS[(s.day - 1 + 7) % 7]} ${String(s.hour).padStart(2, '0')}:00`;
// The same video room as the app: both people open the same link
const jitsi = (b) => `https://meet.jit.si/SkillSwap-${b.id}-${(Math.floor(b.createdAt) % 1e9).toString(36)}`;

let tab = new URLSearchParams(location.search).get('tab') === 'mine' ? 'mine' : 'book';
let query = '';
let category = '';
let d;                               // the latest /sync answer

async function refresh() {
  d = await api('GET', '/api/mobile/sync');
  setCredits(d.wallet.balance);
  draw();
}

const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Lessons' });
const body = h('div');
box.append(h('div', { class: 'row' }, tabs), body);

function draw() {
  const users = new Map(d.users.map((u) => [u.id, u]));
  const skills = new Map(d.skills.map((s) => [s.id, s]));
  const offers = new Map(d.offers.map((o) => [o.id, o]));
  const slots = new Map(d.slots.map((s) => [s.id, s]));
  const mine = d.bookings.filter((b) => b.learnerId === me.id || offers.get(b.offerId)?.teacherId === me.id);
  const upcoming = mine.filter((b) => b.status === 'BOOKED').length;
  tabs.replaceChildren(...[['book', 'Book a lesson'], ['mine', `My lessons${upcoming ? ` · ${upcoming}` : ''}`]].map(([key, label]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === key), onclick: () => { tab = key; history.replaceState(null, '', key === 'mine' ? '?tab=mine' : location.pathname); draw(); } }, label)));
  body.replaceChildren(...(tab === 'book' ? bookView(users, skills, slots) : mineView(users, skills, offers, slots, mine)));
}

// ---------- Book a lesson ----------
function bookView(users, skills) {
  const out = [];
  const search = h('input', { type: 'search', placeholder: 'Search a skill or a teacher', 'aria-label': 'Search lessons', value: query });
  const cats = [...new Set(d.skills.map((s) => s.category))].sort();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' },
    [['', 'All', 'layers'], ...cats.map((c) => [c, c, categoryIconId(c)])].map(([c, label, ic]) =>
      h('button', { class: `chip ${c ? categoryClass(c) : ''}`, type: 'button', 'aria-pressed': String(category === c), onclick: () => { category = c; draw(); } }, icon(ic), label)));
  const grid = h('div', { class: 'grid grid-3' });
  const fill = () => {
    const q = query.trim().toLowerCase();
    const list = d.offers.filter((o) => o.teacherId !== me.id)
      .map((o) => ({ o, skill: skills.get(o.skillId), teacher: users.get(o.teacherId), free: d.slots.filter((s) => s.offerId === o.id && !s.isBooked).sort((a, b) => a.day - b.day || a.hour - b.hour) }))
      .filter((x) => x.skill && x.teacher && x.free.length)
      .filter((x) => !category || x.skill.category === category)
      .filter((x) => !q || x.skill.name.toLowerCase().includes(q) || x.teacher.fullName.toLowerCase().includes(q))
      .sort((a, b) => (b.o.trusted - a.o.trusted) || (b.o.rating - a.o.rating));
    grid.replaceChildren(...(list.length ? stagger(list.map(lessonCard)) : [emptyState('calendar', 'No free lessons here', 'Try another word or category.')]));
  };
  search.addEventListener('input', () => { query = search.value; fill(); });
  out.push(h('div', { class: 'card' }, h('div', { class: 'input-icon' }, icon('search'), search), h('div', { class: 'row' }, chips)));
  if (d.wallet.balance < 1) out.push(h('div', { class: 'callout' }, h('span', { class: 'stile gold' }, icon('coin')), h('div', {}, h('h3', {}, 'No credits left'), h('p', {}, 'Teach a lesson to earn one: every hour you teach gives you a credit.'))));
  out.push(grid);
  fill();
  return out;
}

function lessonCard({ o, skill, teacher, free }) {
  let chosen = null;
  const book = h('button', { class: 'btn btn-primary btn-small', type: 'button', disabled: true }, icon('coin'), 'Choose a time');
  const times = h('div', { class: 'chips', role: 'group', 'aria-label': 'Free times' }, free.map((s) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, icon('clock'), slotLabel(s));
    b.addEventListener('click', () => {
      chosen = s;
      for (const x of times.children) x.setAttribute('aria-pressed', String(x === b));
      book.disabled = d.wallet.balance < 1;
      book.replaceChildren(icon('coin'), `Book ${slotLabel(s)} · 1 credit`);
    });
    return b;
  }));
  book.addEventListener('click', async () => {
    if (!chosen) return;
    book.disabled = true;
    try {
      await api('POST', '/api/mobile/bookings', { slotId: chosen.id });
      toast(`Booked: ${skill.name} with ${firstName(teacher.fullName)}, ${slotLabel(chosen)}`);
      tab = 'mine'; await refresh();
    } catch (e) { say(msg, e.message); book.disabled = false; await refresh(); }
  });
  return h('article', { class: 'card lesson' },
    h('div', { class: 'card-head' }, skillTile(skill.name, { category: skill.category }),
      h('div', {}, h('h3', {}, skill.name), h('p', { class: 'meta' }, skill.category)),
      o.trusted ? h('span', { class: 'chip chip-green', title: '2+ lessons rated 4.5 or more' }, icon('shield'), 'Trusted') : null),
    h('div', { class: 'row' }, avatar(teacher.fullName, teacher.id, 'sm', `/member?id=${teacher.id}`), h('span', {}, teacher.fullName), tier(o.level.toLowerCase())),
    o.description ? h('p', { class: 'bio' }, o.description) : null,
    o.reviewCount ? h('p', { class: 'rating' }, stars(o.rating), `${o.rating} · ${o.reviewCount} review${o.reviewCount > 1 ? 's' : ''}`) : h('p', { class: 'meta' }, 'New teacher, no reviews yet'),
    h('p', { class: 'label' }, 'Free times · every week'), times,
    h('div', { class: 'card-foot' }, book));
}

// ---------- My lessons ----------
function mineView(users, skills, offers, slots, mine) {
  const out = [];
  if (!mine.length) return [emptyState('calendar', 'No lessons yet', 'Book your first lesson. You have welcome credits for it.', h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { tab = 'book'; draw(); } }, icon('search'), 'Book a lesson'))];
  const reviewed = new Set(d.reviews.map((r) => r.bookingId));
  const info = (b) => {
    const o = offers.get(b.offerId) || {};
    return { o, skill: skills.get(o.skillId) || { name: 'Lesson', category: '' }, slot: slots.get(b.slotId), teacher: users.get(o.teacherId), learner: users.get(b.learnerId), iTeach: o.teacherId === me.id };
  };
  const groups = [
    ['I learn', 'cap', mine.filter((b) => b.status === 'BOOKED' && b.learnerId === me.id)],
    ['I teach', 'easel', mine.filter((b) => b.status === 'BOOKED' && info(b).iTeach)],
    ['Finished', 'check_circle', mine.filter((b) => b.status === 'DONE').sort((a, b) => b.createdAt - a.createdAt)],
    ['Cancelled', 'undo', mine.filter((b) => b.status === 'CANCELLED').sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)],
  ];
  for (const [title, ic, rows] of groups) {
    if (!rows.length) continue;
    out.push(sectionTitle(`${title} · ${rows.length}`, ic), h('div', { class: 'grid grid-2' }, stagger(rows.map((b) => bookingCard(b, info(b), reviewed)))));
  }
  return out;
}

function bookingCard(b, { skill, slot, teacher, learner, iTeach }, reviewed) {
  const other = iTeach ? learner : teacher;
  const when = slot ? slotLabel(slot) : '';
  const head = h('div', { class: 'card-head' }, skillTile(skill.name, { category: skill.category }),
    h('div', {}, h('h3', {}, skill.name), h('p', { class: 'meta' }, icon('clock'), ` ${when} · weekly, 1 hour`)),
    h('span', { class: `chip ${b.status === 'BOOKED' ? 'chip-amber' : b.status === 'DONE' ? 'chip-gold' : 'chip-gray'}` }, b.status === 'BOOKED' ? 'Upcoming' : b.status === 'DONE' ? 'Finished' : 'Cancelled'));
  const who = other ? h('div', { class: 'row' }, avatar(other.fullName, other.id, 'sm'), h('span', {}, `${iTeach ? 'Learner' : 'Teacher'}: ${other.fullName}`)) : null;
  const card = h('article', { class: 'card lesson' }, head, who);
  const note = h('div', { class: 'notice hidden', role: 'status' });
  card.append(note);

  if (b.status === 'BOOKED') {
    if (iTeach && b.checkinCode) {
      card.append(h('div', { class: 'code-box' }, h('p', { class: 'label' }, 'Check-in code · show it at the lesson'),
        h('b', { class: 'num' }, b.checkinCode.split('').join(' ')),
        h('p', { class: 'meta' }, 'Your learner types it in after the lesson, and you earn 1 credit.')));
    }
    if (!iTeach) {
      const code = h('input', { inputmode: 'numeric', maxlength: 4, pattern: '[0-9]{4}', placeholder: '0000', 'aria-label': 'Check-in code from your teacher', autocomplete: 'one-time-code' });
      const go = h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, icon('check'), 'Check in');
      const form = h('form', { class: 'row checkin', novalidate: true }, code, go);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!/^\d{4}$/.test(code.value.trim())) return say(note, 'Type the 4 digits your teacher shows you.', 'error');
        go.disabled = true;
        try { await api('POST', `/api/mobile/bookings/${b.id}/complete`, { code: code.value.trim() }); toast(`Lesson finished. ${firstName(teacher?.fullName || '')} earned a credit.`); await refresh(); }
        catch (err) { say(note, err.message, 'error'); go.disabled = false; }
      });
      card.append(h('p', { class: 'label' }, 'After the lesson'), form);
    }
    const plan = h('div', { class: 'plan hidden' });
    card.append(plan, h('div', { class: 'card-foot' },
      h('a', { class: 'btn btn-secondary btn-small', href: jitsi(b), target: '_blank', rel: 'noopener' }, icon('video'), 'Video room'),
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async (e) => {
        if (!plan.classList.contains('hidden')) { plan.classList.add('hidden'); return; }
        e.currentTarget.disabled = true;
        try { const r = await api('POST', `/api/mobile/bookings/${b.id}/plan`, {}); plan.replaceChildren(h('p', { class: 'label' }, r.source === 'ai' ? 'Lesson plan · by AI' : 'Lesson plan'), h('pre', {}, r.plan)); plan.classList.remove('hidden'); }
        catch (err) { say(note, err.message, 'error'); }
        e.currentTarget.disabled = false;
      } }, icon('sparkle'), 'Lesson plan'),
      h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await api('POST', `/api/mobile/bookings/${b.id}/cancel`, {}); toast(iTeach ? 'Lesson cancelled. The learner gets the credit back.' : 'Lesson cancelled. Your credit is back.'); await refresh(); }
        catch (err) { say(note, err.message, 'error'); e.currentTarget.disabled = false; }
      } }, icon('close'), 'Cancel')));
  }

  if (b.status === 'DONE' && !iTeach) {
    if (reviewed.has(b.id)) card.append(h('p', { class: 'meta' }, icon('check', 'icon inline-ic'), ' You rated this lesson'));
    else {
      let rating = 5;
      const row = h('div', { class: 'row star-pick', role: 'radiogroup', 'aria-label': 'Rating' });
      const paint = () => [...row.children].forEach((x, i) => x.classList.toggle('on', i < rating));
      for (let n = 1; n <= 5; n++) row.append(h('button', { type: 'button', role: 'radio', 'aria-label': `${n} star${n > 1 ? 's' : ''}`, onclick: () => { rating = n; paint(); } }, icon('star_fill')));
      paint();
      const comment = h('input', { maxlength: 300, placeholder: 'What was good? (optional)', 'aria-label': 'Comment' });
      const form = h('form', { class: 'review' }, h('p', { class: 'label' }, 'Rate this lesson'), row, h('div', { class: 'row' }, comment, h('button', { class: 'btn btn-secondary btn-small', type: 'submit' }, icon('send'), 'Send')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('POST', `/api/mobile/bookings/${b.id}/review`, { rating, comment: comment.value }); toast('Thank you for the rating!'); await refresh(); }
        catch (err) { say(note, err.message, 'error'); }
      });
      card.append(form);
    }
  }
  return card;
}

await refresh();
// Somebody booked or finished a lesson (on the web or in the app): show the new state
let t;
window.addEventListener('live:changed', () => { clearTimeout(t); t = setTimeout(() => { if (!document.querySelector('.lesson input:focus')) refresh(); }, 400); });
