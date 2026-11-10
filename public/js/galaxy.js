// Skill Galaxy for the website: the same solar system as the Android app.
// You are the sun in the middle, the people you swapped lessons with circle you on the inner orbit,
// everyone else is on outer orbits, turned towards the people they swap with. Lines are lessons and
// gold sparks flow from teacher to learner. Orbits are computed once (no physics), so stars never overlap.
import { api, h, $, icon, requireLogin, renderShell, emptyState, avatar, iconForEmoji, categoryClass } from '/app.js';
import { iconPaths, categoryColor, categoryOfIcon } from '/js/icons.js';

const user = await requireLogin();
renderShell();
const box = $('#content');

const SLOT = 76;            // room for one star and its name along an orbit (layout units = CSS px at zoom 1)
const FIRST_ORBIT = 110;
const ORBIT_GAP = 84;
const TAU = Math.PI * 2;
const GOLD = '#E0B44C';
const LIGHT_GOLD = '#F2D28B';
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Layout ----------
function layout(g, previous) {
  const nodes = g.nodes;
  const n = nodes.length;
  const index = new Map(nodes.map((v, i) => [v.id, i]));
  const edges = g.edges.map((e) => ({ a: index.get(e.from), b: index.get(e.to), w: e.lessons, key: `${e.from}>${e.to}` }))
    .filter((e) => e.a != null && e.b != null && e.a !== e.b);
  const link = nodes.map(() => new Map());
  for (const e of edges) { link[e.a].set(e.b, (link[e.a].get(e.b) || 0) + e.w); link[e.b].set(e.a, (link[e.b].get(e.a) || 0) + e.w); }
  const w = (a, b) => link[a].get(b) || 0;
  const act = nodes.map((v) => v.taught + v.learned);
  const centre = index.has(g.me) ? index.get(g.me) : act.indexOf(Math.max(...act));
  const size = act.map((a, i) => (i === centre ? 28 : Math.min(24, 12 + 2.4 * Math.sqrt(a))));
  const orbit = new Array(n).fill(0), dist = new Array(n).fill(0), angle = new Array(n).fill(0), placed = new Array(n).fill(false);
  placed[centre] = true;
  const others = [...Array(n).keys()].filter((i) => i !== centre);
  const direct = others.filter((i) => w(centre, i) > 0).sort((x, y) => w(centre, y) - w(centre, x) || x - y);
  const rest = others.filter((i) => w(centre, i) === 0).sort((x, y) => act[y] - act[x] || x - y);
  const queue = direct.concat(rest);
  const orbits = [];
  let r = FIRST_ORBIT, pos = 0, k = 0;
  while (pos < queue.length) {
    const fits = Math.max(6, Math.floor((TAU * r) / SLOT));
    const members = queue.slice(pos, pos + fits);
    pos += members.length; k += 1;
    const wish = new Map();
    let order;
    if (k === 1) {
      // a chain: the next star is the one with the most lessons with the previous one (short lines, few crossings)
      const left = members.slice(); order = [left.shift()];
      while (left.length) {
        let best = 0;
        for (let q = 1; q < left.length; q++) if (w(order[order.length - 1], left[q]) > w(order[order.length - 1], left[best])) best = q;
        order.push(left.splice(best, 1)[0]);
      }
    } else {
      for (const m of members) {
        let x = 0, y = 0;
        for (const [j, lessons] of link[m]) if (placed[j] && j !== centre) { x += lessons * Math.cos(angle[j]); y += lessons * Math.sin(angle[j]); }
        if (x || y) wish.set(m, Math.atan2(y, x));
      }
      order = members.slice().sort((a, b) => (wish.has(a) ? 0 : 1) - (wish.has(b) ? 0 : 1) || (wish.get(a) || 0) - (wish.get(b) || 0));
    }
    const step = TAU / order.length;
    let ox = 0, oy = 0;
    order.forEach((m, q) => { if (wish.has(m)) { ox += Math.cos(wish.get(m) - q * step); oy += Math.sin(wish.get(m) - q * step); } });
    const offset = ox || oy ? Math.atan2(oy, ox) : -Math.PI / 2;
    order.forEach((m, q) => { orbit[m] = k; dist[m] = r; angle[m] = offset + q * step; placed[m] = true; });
    orbits.push(r); r += ORBIT_GAP;
  }
  const iconIds = nodes.map((v) => iconForEmoji(v.emoji));
  const colors = nodes.map((v, i) => categoryColor(v.category || categoryOfIcon(iconIds[i])));
  // where each star was before this download, so it glides instead of jumping
  const from = nodes.map((v) => { const j = previous?.index.get(v.id); return j == null ? null : { orbit: previous.orbit[j], dist: previous.dist[j], angle: previous.angle[j] }; });
  return {
    nodes, n, index, edges, orbit, dist, angle, size, orbits, maxOrbit: orbits.length ? orbits[orbits.length - 1] : 0, centre,
    iconIds, colors, from, fresh: !previous, start: 0, sx: new Float32Array(n), sy: new Float32Array(n), sr: new Float32Array(n), grow: new Float32Array(n),
    phase: edges.map((_, i) => (i * 0.618) % 1),
  };
}

const turned = (orbit, s) => (orbit <= 0 ? 0 : (orbit % 2 ? 1 : -1) * s * TAU / (150 + 60 * orbit));
const wrap = (a) => { let v = a % TAU; if (v > Math.PI) v -= TAU; if (v < -Math.PI) v += TAU; return v; };
const backOut = (x) => { if (x <= 0) return 0; if (x >= 1) return 1; const c = 1.70158, y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y; };
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const bez = (t, p0, c, p1) => { const u = 1 - t; return u * u * p0 + 2 * u * t * c + t * t * p1; };

// Our icons drawn once into small white pictures, then reused for every star in every frame.
const iconCache = new Map();
function iconImage(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const px = 96, c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  const [rot, shapes] = iconPaths(id);
  x.scale(px / 24, px / 24);
  if (rot) { x.translate(12, 12); x.rotate((rot * Math.PI) / 180); x.translate(-12, -12); }
  x.strokeStyle = x.fillStyle = '#fff'; x.lineWidth = 1.8; x.lineCap = 'round'; x.lineJoin = 'round';
  for (const [d, filled] of shapes) { const p = new Path2D(d); if (filled) x.fill(p); else x.stroke(p); }
  iconCache.set(id, c);
  return c;
}

// ---------- Page ----------
let data;
try { data = await api('GET', '/api/mobile/galaxy'); }
catch (e) { box.append(emptyState('signal_off', 'Could not load the galaxy', e.message)); throw e; }

const lessons = (g) => g.edges.reduce((s, e) => s + e.lessons, 0);
const sub = $('.page-sub');
const setSub = () => { sub.textContent = `${data.nodes.length} people · ${lessons(data)} lessons. Inner orbit = people you swapped with.`; };
setSub();
if (!data.nodes.length) { box.append(emptyState('orbit', 'The galaxy is empty', 'It fills up as people book and teach lessons.')); throw new Error('empty'); }

const legend = h('div', { class: 'galaxy-legend', 'aria-label': 'Categories' });
const cats = [...new Set(data.nodes.map((v) => v.category).filter(Boolean))];
legend.append(...cats.map((c) => h('span', { class: categoryClass(c) }, h('i'), c)));
const canvas = h('canvas', { role: 'img', 'aria-label': 'Skill Galaxy: people as stars, lessons as lines' });
const card = h('div', { class: 'star-card', 'aria-live': 'polite' });
const hint = h('p', { class: 'galaxy-hint' }, 'Drag to move · scroll or pinch to zoom · click a star');
const tools = h('div', { class: 'galaxy-tools' },
  h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, icon('plus')),
  h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomBy(0.8) }, h('span', { 'aria-hidden': 'true' }, '–')),
  h('button', { type: 'button', 'aria-label': 'Back to the middle', onclick: () => { view.zoom = 1; view.px = 0; view.py = 0; } }, icon('target')));
const stage = h('div', { class: 'galaxy-wrap' }, canvas, tools, card, hint);
box.append(legend, stage);

let lay = layout(data, null);
const view = { zoom: 1, px: 0, py: 0 };
let selected = null;           // user id of the selected star
let spin = 0, last = 0, clock = 0;
let comets = [];
let W = 0, H = 0, dpr = 1;
const ctx = canvas.getContext('2d');

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth; H = stage.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}
new ResizeObserver(resize).observe(stage);
resize();

// Still stars in the background, drawn once into their own picture
const starfield = document.createElement('canvas');
function paintStarfield() {
  starfield.width = canvas.width; starfield.height = canvas.height;
  const x = starfield.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    x.globalAlpha = 0.12 + rnd() * 0.45; x.fillStyle = '#fff';
    x.beginPath(); x.arc(rnd() * starfield.width, rnd() * starfield.height, (0.4 + rnd() * 1.1) * dpr, 0, TAU); x.fill();
  }
}

function zoomBy(k, cx = W / 2, cy = H / 2) {
  const before = view.zoom;
  const after = Math.min(4, Math.max(0.5, before * k));
  const mx = W / 2 + view.px, my = H / 2 + view.py;
  view.px += (cx - mx) * (1 - after / before); view.py += (cy - my) * (1 - after / before);
  view.zoom = after;
}

function draw(t) {
  if (!last) last = t;
  if (selected == null && !still) spin += (t - last) / 1000;
  last = t; clock = t;
  if (!lay.start) lay.start = t;
  const age = still ? 5000 : t - lay.start;
  if (starfield.width !== canvas.width) paintStarfield();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(starfield, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const avail = Math.min(W / 2, H / 2) - 26;
  const fit = lay.maxOrbit <= 0 ? 1.2 : Math.min(1.9, Math.max(0.45, avail / (lay.maxOrbit + 30)));
  const u = fit * view.zoom;
  const ox = W / 2 + view.px, oy = H / 2 + view.py;
  const sel = selected == null ? -1 : (lay.index.get(selected) ?? -1);
  const lit = new Set();
  if (sel >= 0) for (const e of lay.edges) { if (e.a === sel) lit.add(e.b); if (e.b === sel) lit.add(e.a); }

  for (let i = 0; i < lay.n; i++) {
    let d = lay.dist[i], a = lay.angle[i] + turned(lay.orbit[i], spin), grow = 1;
    if (lay.fresh) { grow = backOut((age - 90 * lay.orbit[i]) / 700); d *= grow; }
    else if (age < 700) {
      const m = easeInOut(age / 700), f = lay.from[i];
      if (f) { const a0 = f.angle + turned(f.orbit, spin); a = a0 + wrap(a - a0) * m; d = f.dist + (d - f.dist) * m; }
      else grow = backOut(age / 700);
    }
    lay.sx[i] = ox + Math.cos(a) * d * u; lay.sy[i] = oy + Math.sin(a) * d * u;
    lay.grow[i] = grow; lay.sr[i] = lay.size[i] * u * Math.max(grow, 0);
  }

  // faint orbit circles
  ctx.lineWidth = 1; ctx.strokeStyle = '#fff';
  ctx.globalAlpha = 0.07 * (lay.fresh ? Math.min(1, age / 900) : 1);
  for (const r of lay.orbits) { ctx.beginPath(); ctx.arc(ox, oy, r * u, 0, TAU); ctx.stroke(); }

  // lesson lines bent towards the middle, sparks flow from teacher to learner
  lay.edges.forEach((e, k) => {
    const show = Math.min(1, Math.max(0, Math.min(lay.grow[e.a], lay.grow[e.b])));
    if (show <= 0) return;
    const hot = sel >= 0 && (e.a === sel || e.b === sel);
    const mine = e.a === lay.centre || e.b === lay.centre;
    const x0 = lay.sx[e.a], y0 = lay.sy[e.a], x1 = lay.sx[e.b], y1 = lay.sy[e.b];
    const qx = ox + ((x0 + x1) / 2 - ox) * 0.55, qy = oy + ((y0 + y1) / 2 - oy) * 0.55;
    ctx.globalAlpha = show * (hot ? 0.9 : sel >= 0 ? 0.05 : mine ? 0.34 : 0.1);
    ctx.strokeStyle = hot ? lay.colors[e.a === sel ? e.b : e.a] : GOLD;
    ctx.lineWidth = (1 + 0.5 * Math.log(1 + e.w)) * (hot ? 1.7 : 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(qx, qy, x1, y1); ctx.stroke();
    if (!still && (hot || (mine && sel < 0))) {
      const sparks = Math.min(e.w, hot ? 3 : 2);
      ctx.fillStyle = hot ? '#fff' : LIGHT_GOLD;
      for (let s = 0; s < sparks; s++) {
        const tt = ((t % 2600) / 2600 + s / sparks + lay.phase[k]) % 1;
        ctx.globalAlpha = 0.9 * Math.sin(Math.PI * tt) * show;
        ctx.beginPath(); ctx.arc(bez(tt, x0, qx, x1), bez(tt, y0, qy, y1), 2.2, 0, TAU); ctx.fill();
      }
    }
  });

  // stars
  const allNames = SLOT * u >= 58;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i < lay.n; i++) {
    const r = lay.sr[i];
    if (r < 0.5) continue;
    const x = lay.sx[i], y = lay.sy[i];
    const dim = sel < 0 || i === sel || lit.has(i) ? 1 : 0.28;
    const col = lay.colors[i];
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.15 * dim; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = dim; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.2 * dim; ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.45, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (i === lay.centre) {
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
      if (!still) { const p = (t % 2400) / 2400; ctx.globalAlpha = 0.5 * (1 - p); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 5 + p * 26, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    if (i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU); ctx.stroke(); }
    if (r >= 8) { const side = r * 1.1; ctx.globalAlpha = dim; ctx.drawImage(iconImage(lay.iconIds[i]), x - side / 2, y - side / 2, side, side); ctx.globalAlpha = 1; }
    if ((allNames || i === lay.centre || i === sel || lit.has(i)) && lay.grow[i] > 0.5) {
      const me = i === lay.centre;
      ctx.font = `${me ? 700 : 500} 11px Inter, system-ui, sans-serif`;
      ctx.fillStyle = me ? GOLD : 'rgba(255,255,255,0.88)';
      ctx.globalAlpha = dim;
      ctx.fillText(me ? 'You' : lay.nodes[i].name, x, y + r + (i === sel ? 10 : me ? 9 : 4));
      ctx.globalAlpha = 1;
    }
  }

  // comets for lessons that just happened, then a pulse on the learner's star
  comets = comets.filter((c) => t - (c.start || (c.start = t)) < 2600);
  for (const c of comets) {
    const e = lay.edges[c.edge];
    if (!e) continue;
    const x0 = lay.sx[e.a], y0 = lay.sy[e.a], x1 = lay.sx[e.b], y1 = lay.sy[e.b];
    const qx = ox + ((x0 + x1) / 2 - ox) * 0.55, qy = oy + ((y0 + y1) / 2 - oy) * 0.55;
    const cAge = t - c.start;
    ctx.fillStyle = ctx.strokeStyle = GOLD;
    if (cAge < 1800) {
      const p = easeInOut(cAge / 1800);
      for (let k = 4; k >= 0; k--) { const tt = Math.min(1, Math.max(0, p - k * 0.035)); ctx.globalAlpha = 0.95 - k * 0.18; ctx.beginPath(); ctx.arc(bez(tt, x0, qx, x1), bez(tt, y0, qy, y1), 6 - k, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(bez(p, x0, qx, x1), bez(p, y0, qy, y1), 15, 0, TAU); ctx.fill();
    } else {
      const p = Math.min(1, (cAge - 1800) / 800);
      ctx.globalAlpha = 1 - p; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x1, y1, lay.sr[e.b] + p * 36, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------- Input: drag, wheel / pinch zoom, click a star ----------
const pointers = new Map();
let moved = 0, pinch0 = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = 0; });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) { view.px += e.offsetX - p.x; view.py += e.offsetY - p.y; moved += Math.abs(e.offsetX - p.x) + Math.abs(e.offsetY - p.y); }
  p.x = e.offsetX; p.y = e.offsetY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0) zoomBy(d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch0 = d; moved = 99;
  }
});
const up = (e) => {
  const was = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = 0;
  if (was && moved < 6 && e.type === 'pointerup') pick(e.offsetX, e.offsetY);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.offsetX, e.offsetY); }, { passive: false });
canvas.addEventListener('dblclick', () => { view.zoom = 1; view.px = 0; view.py = 0; });

function pick(x, y) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < lay.n; i++) {
    const d = Math.hypot(x - lay.sx[i], y - lay.sy[i]);
    if (d < lay.sr[i] + 14 && d < bestD) { best = i; bestD = d; }
  }
  selected = best >= 0 ? lay.nodes[best].id : null;
  showCard(best >= 0 ? lay.nodes[best] : null);
}

function showCard(v) {
  hint.classList.toggle('hidden', !!v);
  card.classList.toggle('show', !!v);
  if (!v) return;
  const links = data.edges.filter((e) => e.from === v.id || e.to === v.id).length;
  card.replaceChildren(avatar(v.name, v.id, 'md'),
    h('div', {}, h('h3', {}, v.id === user.id ? `${v.name} · you` : v.name),
      v.category ? h('p', { class: 'cat' }, v.category) : null,
      h('p', {}, `Taught ${v.taught} · learned ${v.learned} · ${links} connection${links === 1 ? '' : 's'}`)),
    h('a', { class: 'btn btn-secondary btn-small', href: `/member?id=${v.id}` }, 'Profile', icon('arrow_right')));
}

// ---------- Live: new lessons glide in, with a comet along their line ----------
let reloading = false;
async function reload() {
  if (reloading) return;
  reloading = true;
  try {
    const next = await api('GET', '/api/mobile/galaxy');
    const before = new Map(lay.edges.map((e) => [e.key, e.w]));
    const nl = layout(next, lay);
    comets = nl.edges.map((e, i) => ((e.w > (before.get(e.key) || 0)) ? { edge: i } : null)).filter(Boolean);
    data = next; lay = nl; setSub();
  } catch { /* keep the old picture */ }
  reloading = false;
}
window.addEventListener('live:changed', reload);
window.addEventListener('live:activity', reload);
