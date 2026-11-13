// The 8 badges (computed on the server from real lessons, the same as in the Android app).
import { h, icon, grow } from '/app.js';

export const BADGES = {
  first_lesson: ['First lesson', 'Finish your first lesson', 'cap'],
  first_teach: ['First class', 'Teach your first lesson', 'easel'],
  mentor: ['Mentor', 'Teach 5 lessons', 'trophy'],
  five_star: ['Five stars', 'Get a 5-star review', 'star_fill'],
  trusted: ['Trusted', '2+ lessons rated 4.5 or more', 'shield'],
  explorer: ['Explorer', 'Learn 3 different skills', 'compass'],
  perfect_swap: ['Perfect swap', 'Teach someone who also teaches you', 'swap'],
  critic: ['Critic', 'Rate 3 lessons', 'quill'],
};

export function badgeCard(b, compact = false) {
  const [title, desc, ic] = BADGES[b.id] || [b.id, '', 'medal'];
  const on = b.progress >= b.goal;
  const fill = h('i');
  grow(fill, Math.min(1, b.progress / b.goal));
  return h('div', { class: `badge-card ${on ? 'on' : 'off'}${compact ? ' compact' : ''}`, title: `${title}: ${desc}` },
    h('div', { class: 'medal' }, icon(ic)),
    h('h3', {}, title),
    compact ? null : h('p', {}, desc),
    !on && b.goal > 1 ? h('div', { class: 'prog', role: 'progressbar', 'aria-valuenow': b.progress, 'aria-valuemax': b.goal, 'aria-label': `${b.progress} of ${b.goal}` }, fill) : null,
    !on && b.goal > 1 ? h('p', { class: 'prog-text' }, `${b.progress} / ${b.goal}`) : null,
    on && !compact ? h('p', { class: 'prog-text gold' }, 'Unlocked') : null);
}
