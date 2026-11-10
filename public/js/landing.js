// Landing page: draws our icons into the markup, shows live community numbers and who is logged in.
import { api, h, icon, $$, countUp, skillChip } from '/app.js';
import { skillIconId } from '/js/icons.js';

function paintIcons(root = document) {
  for (const el of $$('[data-icon]', root)) el.prepend(icon(el.dataset.icon));
  for (const el of $$('[data-icon-only]', root)) el.append(icon(el.dataset.iconOnly));
  for (const el of $$('[data-skill]', root)) el.prepend(h('span', { class: 'dot-ic' }, icon(skillIconId(el.dataset.skill))));
  for (const el of $$('[data-skill-tile]', root)) el.append(icon(skillIconId(el.dataset.skillTile)));
}
paintIcons();

// Logged in already? Show "Open SkillSwap" instead of "Log in / Join"
api('GET', '/api/me').then(({ user }) => {
  if (!user) return;
  for (const el of $$('[data-guest]')) el.classList.add('hidden');
  for (const el of $$('[data-member]')) el.classList.remove('hidden');
}).catch(() => {});

// Live numbers from the same database the app uses (public endpoint)
try {
  const impact = await api('GET', '/api/mobile/impact');
  const band = document.getElementById('numbers');
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    for (const b of $$('[data-count]', band)) {
      const v = Number(impact[b.dataset.count]) || 0;
      const dec = Number(b.dataset.decimals || 0);
      countUp(b, v, { format: (n) => (dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US')) });
    }
  });
  io.observe(band);
  if (impact.topSkills && impact.topSkills.length >= 4) {
    const cloud = document.getElementById('top-skills');
    const catalog = await api('GET', '/api/skills').catch(() => []);
    const cat = new Map(catalog.map((s) => [s.name, s.category]));
    cloud.replaceChildren(...impact.topSkills.map((s) => {
      const c = skillChip(s.name, { category: cat.get(s.name) });
      c.append(h('span', { class: 'muted' }, `· ${s.lessons} lesson${s.lessons === 1 ? '' : 's'}`));
      return c;
    }));
  }
} catch { /* the page still works without the numbers */ }
