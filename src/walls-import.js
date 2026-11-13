// Walls, doors and lights from other programs.
//   Universal VTT (.dd2vtt, .uvtt, .df2vtt): Dungeon Alchemist, Dungeondraft, Dungeon Fog, Arkenforge ...
//     JSON with resolution { map_origin, map_size, pixels_per_grid }, line_of_sight (wall polylines),
//     objects_line_of_sight, portals (doors), lights, and the map image (base64). Units: grid squares.
//   Foundry VTT scenes (.json export, or a compendium .db with one scene per line):
//     walls { c: [x1, y1, x2, y2], door, ds, sight / sense }, lights, width, height, grid, padding. Units: pixels.
// Everything is first brought into one neutral form (source units, origin = top left of the map image),
// then placed onto the map in map inches.
'use strict';

const fs = require('fs');
const path = require('path');

const VTT_EXT = new Set(['.dd2vtt', '.uvtt', '.df2vtt']);
const isVtt = (file) => VTT_EXT.has(path.extname(String(file)).toLowerCase());
const isFoundry = (file) => /\.(json|db)$/i.test(String(file));

// ---------- helpers ----------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
function hexColor(c, fallback = '#ffd9a0') {
  if (typeof c === 'number') return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  let s = String(c || '').replace(/^#/, '').trim();
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(2); // Universal VTT: aarrggbb
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : fallback;
}
// A polyline as segments, with points on a straight line dropped (exporters write many tiny pieces).
function polySegs(points, tol) {
  const p = points.filter((q) => q && Number.isFinite(num(q.x, NaN)) && Number.isFinite(num(q.y, NaN))).map((q) => [num(q.x), num(q.y)]);
  if (p.length < 2) return [];
  const keep = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = keep[keep.length - 1]; const b = p[i]; const c = p[i + 1];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const off = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / len;
    if (off > tol) keep.push(b);
  }
  keep.push(p[p.length - 1]);
  const out = [];
  for (let i = 0; i < keep.length - 1; i++) {
    const [x1, y1] = keep[i]; const [x2, y2] = keep[i + 1];
    if (Math.hypot(x2 - x1, y2 - y1) > tol) out.push([x1, y1, x2, y2, 0, 0]);
  }
  return out;
}
// Ends that almost touch become one point, so light can't slip through hairline cracks.
function weld(segs, tol) {
  const cells = new Map();
  const key = (i, j) => `${i},${j}`;
  const snap = (x, y) => {
    const ci = Math.round(x / tol); const cj = Math.round(y / tol);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const q = cells.get(key(ci + di, cj + dj));
        if (q && Math.abs(q[0] - x) < tol && Math.abs(q[1] - y) < tol) return q;
      }
    }
    const q = [x, y];
    cells.set(key(ci, cj), q);
    return q;
  };
  for (const s of segs) {
    const a = snap(s[0], s[1]); const b = snap(s[2], s[3]);
    s[0] = a[0]; s[1] = a[1]; s[2] = b[0]; s[3] = b[1];
  }
  return segs.filter((s) => Math.hypot(s[2] - s[0], s[3] - s[1]) > tol / 2);
}
// Where a door lies on a wall, the wall gets a gap (some exporters draw the wall straight through).
function carveDoors(walls, doors, tol) {
  let out = walls;
  for (const d of doors) {
    const next = [];
    for (const w of out) {
      const ex = w[2] - w[0]; const ey = w[3] - w[1];
      const L2 = ex * ex + ey * ey;
      const L = Math.sqrt(L2);
      const off = (x, y) => Math.abs((x - w[0]) * ey - (y - w[1]) * ex) / (L || 1);
      if (!L || off(d[0], d[1]) > tol || off(d[2], d[3]) > tol) { next.push(w); continue; }
      let t0 = ((d[0] - w[0]) * ex + (d[1] - w[1]) * ey) / L2;
      let t1 = ((d[2] - w[0]) * ex + (d[3] - w[1]) * ey) / L2;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t1 <= 0 || t0 >= 1) { next.push(w); continue; }
      const at = (t) => [w[0] + ex * t, w[1] + ey * t];
      if (t0 * L > tol) next.push([w[0], w[1], ...at(t0), 0, 0]);
      if ((1 - t1) * L > tol) next.push([...at(t1), w[2], w[3], 0, 0]);
    }
    out = next;
  }
  return out;
}

// ---------- Universal VTT ----------
function readVtt(file, { image = false } = {}) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = j.resolution || {};
  const o = res.map_origin || { x: 0, y: 0 };
  const size = res.map_size || {};
  const w = num(size.x); const h = num(size.y);
  if (!(w > 0) || !(h > 0)) throw new Error('This file has no map size.');
  const tol = 0.02; // grid squares
  let walls = [];
  for (const line of [...(j.line_of_sight || []), ...(j.objects_line_of_sight || [])]) walls.push(...polySegs(line || [], tol));
  const doors = [];
  for (const pt of j.portals || []) {
    const b = pt.bounds || [];
    if (b.length < 2 || pt.closed === false) continue; // open portals (windows) let sight through
    doors.push([num(b[0].x), num(b[0].y), num(b[1].x), num(b[1].y), 1, 0]);
  }
  walls = carveDoors(weld(walls, 0.01), doors, 0.05);
  const lights = (j.lights || []).map((L) => {
    const range = num(L.range, 4);
    const dim = Math.max(5, Math.round(range * 5));
    return { x: num(L.position && L.position.x), y: num(L.position && L.position.y), dim, bright: Math.round(dim / 2), color: hexColor(L.color), intensity: Math.min(1, Math.max(0.3, num(L.intensity, 1))) };
  });
  const out = {
    kind: 'uvtt', name: path.parse(file).name, w, h, perSquare: 1, origin: { x: num(o.x), y: num(o.y) },
    ppg: num(res.pixels_per_grid, 0), walls: [...walls, ...doors], lights,
    baked: !!(j.environment && j.environment.baked_lighting), hasImage: typeof j.image === 'string' && j.image.length > 100,
  };
  if (image && out.hasImage) out.image = j.image;
  return out;
}
// the map picture inside a Universal VTT file
function vttImage(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof j.image !== 'string' || j.image.length < 100) return null;
  const b64 = j.image.replace(/^data:[^,]+,/, '');
  const head = b64.slice(0, 8);
  const ext = head.startsWith('iVBOR') ? 'png' : head.startsWith('/9j/') ? 'jpg' : head.startsWith('UklGR') ? 'webp' : 'png';
  return { buf: Buffer.from(b64, 'base64'), ext };
}

// ---------- Foundry VTT ----------
function foundryScenes(file) {
  const text = fs.readFileSync(file, 'utf8');
  let docs = [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) docs = j;
    else if (j && Array.isArray(j.scenes)) docs = j.scenes; // an adventure
    else docs = [j];
  } catch {
    // a compendium .db: one document per line
    for (const line of text.split(/\r?\n/)) { try { if (line.trim()) docs.push(JSON.parse(line)); } catch {} }
  }
  return docs.filter((d) => d && Array.isArray(d.walls) && (d.width || d.walls.length));
}
function blocksSight(w) {
  if ('sight' in w) return w.sight === 10 || w.sight === 20; // v10+: 0 none, 10 limited, 20 normal, 30/40 like a window
  if ('sense' in w) return w.sense === 1 || w.sense === 2; // v9: 0 none, 1 normal, 2 limited
  return true;
}
function readFoundry(file, { scene, prefer } = {}) {
  const scenes = foundryScenes(file);
  if (!scenes.length) throw new Error('No Foundry scene with walls in this file.');
  let s = null;
  if (scene) s = scenes.find((x) => x.name === scene);
  if (!s && scenes.length > 1 && prefer) {
    const words = String(prefer).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
    const score = (x) => { const n = `${x.name || ''} ${(x.background && x.background.src) || x.img || ''}`.toLowerCase(); return words.filter((wd) => n.includes(wd)).length; };
    const best = [...scenes].sort((a, b) => score(b) - score(a) || b.walls.length - a.walls.length)[0];
    if (score(best) > 0) s = best;
  }
  if (!s && scenes.length === 1) s = scenes[0];
  if (!s) return { choose: scenes.map((x) => ({ name: x.name || 'Scene', walls: x.walls.length })) };
  const gridPx = num(typeof s.grid === 'object' && s.grid ? s.grid.size : s.grid, 100) || 100;
  const dist = num(typeof s.grid === 'object' && s.grid ? s.grid.distance : s.gridDistance, 5) || 5;
  const width = num(s.width, 0) || gridPx * 30; const height = num(s.height, 0) || gridPx * 20;
  const pad = num(s.padding, 0.25);
  const padX = Math.ceil((width * pad) / gridPx) * gridPx; const padY = Math.ceil((height * pad) / gridPx) * gridPx;
  const offX = num(s.background && s.background.offsetX, num(s.shiftX, 0));
  const offY = num(s.background && s.background.offsetY, num(s.shiftY, 0));
  const origin = { x: padX - offX, y: padY - offY }; // where the map picture starts, in scene pixels
  const walls = [];
  for (const w of s.walls) {
    const c = w.c || [];
    if (c.length < 4 || !blocksSight(w)) continue;
    const door = w.door === 2 ? 2 : w.door ? 1 : 0;
    walls.push([num(c[0]), num(c[1]), num(c[2]), num(c[3]), door, door && w.ds === 1 ? 1 : 0]);
  }
  const ft = (v) => Math.max(0, (num(v) / dist) * 5);
  const lights = (s.lights || []).filter((L) => !L.hidden).map((L) => {
    const cfg = L.config || L;
    const dim = ft(cfg.dim); const bright = ft(cfg.bright);
    return { x: num(L.x), y: num(L.y), dim: Math.max(dim, bright, 5), bright, color: hexColor(cfg.color || L.tintColor), intensity: 1 };
  }).filter((L) => L.dim > 0);
  return { kind: 'foundry', name: s.name || path.parse(file).name, w: width, h: height, perSquare: gridPx, origin, walls, lights, scenes: scenes.length };
}

function read(file, opts = {}) {
  return isVtt(file) ? readVtt(file, opts) : readFoundry(file, opts);
}

// A walls file next to a map with the same name (Crypt.webm + Crypt.dd2vtt or Crypt.json).
function sidecar(mediaPath) {
  const dir = path.dirname(mediaPath);
  const stem = path.parse(mediaPath).name.toLowerCase();
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const hit = (exts) => names.find((n) => path.parse(n).name.toLowerCase() === stem && exts.includes(path.extname(n).toLowerCase()));
  const f = hit(['.dd2vtt', '.uvtt', '.df2vtt']) || hit(['.json']);
  return f ? path.join(dir, f) : null;
}

// Neutral form -> map inches. rect: where the map picture lies on the map { x, y, w } (map inches).
function place(n, rect) {
  const k = rect.w / n.w;
  const X = (v) => rect.x + (v - n.origin.x) * k;
  const Y = (v) => rect.y + (v - n.origin.y) * k;
  const r = (v) => Math.round(v * 1000) / 1000;
  const walls = n.walls.map((s) => [r(X(s[0])), r(Y(s[1])), r(X(s[2])), r(Y(s[3])), s[4] || 0, s[5] || 0]);
  const lights = n.lights.map((L) => ({ ...L, x: r(X(L.x)), y: r(Y(L.y)) }))
    .filter((L) => L.x >= rect.x - 1 && L.x <= rect.x + rect.w + 1 && L.y >= rect.y - 1 && L.y <= rect.y + n.h * k + 1);
  const size = n.perSquare * k;
  const grid = { type: 'square', angle: 0, size: r(size), ox: r(rect.x - n.origin.x * k), oy: r(rect.y - n.origin.y * k) };
  return { walls, lights, grid, k };
}
// how many squares the picture is wide and high
const squares = (n) => ({ w: n.w / n.perSquare, h: n.h / n.perSquare });

module.exports = { isVtt, isFoundry, read, readVtt, readFoundry, vttImage, sidecar, place, squares, VTT_EXT, hexColor };
