// One map: background, view, grid, tokens, overlays, sounds, fog, effects,
// lighting, weather and spell areas. Pure functions over plain JSON, plus a
// small undo/redo history.
//
// Coordinates: everything anchored to the map is stored in "map inches".
// map.view places map space on the table: tableInches = view.xy + mapInches * view.zoom.
// Moving or zooming the map changes only map.view, so fog, grid, tokens and
// effects travel with it. Weather and table-anchored overlays ignore the view.
'use strict';

const { kindOf, treeOf, lightOf } = require('./library');
const Vision = require('./renderer/vision');
const FXDATA = require('./renderer/fx-data');

let seq = 1;
const FRAME0 = { a: 0, tx: 0, ty: 0 }; // no turn: a, degrees; tx, ty, map inches (x' = turn(a)·x + t)
const newId =(p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// outlines from the windows: rings of numbers, rounded, at least three points each
function cleanRings(rings) {
  if (!Array.isArray(rings)) return [];
  return rings.filter((r) => Array.isArray(r) && r.length >= 6 && r.length % 2 === 0 && r.every(Number.isFinite))
    .slice(0, 64).map((r) => r.slice(0, 20000).map((v) => Math.round(v * 1000) / 1000));
}

// Beta 3.20: the wind in the living trees. auto: it follows the weather (its direction and how hard it blows; no
// weather: a light breeze); else these values. storm: on top of either, until it is switched off again.
// dir: degrees, where it blows to (0 = right, 90 = down, like the weather's). strength 0..3 (1: a breeze, 2.4: a storm),
// lean 0..1, branches and rustle 0..3.
const WIND_RANGE = { dir: [0, 360], strength: [0, 3], lean: [0, 1], branches: [0, 3], rustle: [0, 3] };
function defaultWind() { return { auto: true, storm: false, dir: 30, strength: 1, lean: 0, branches: 1, rustle: 1 }; }
// Beta 3.42, living tiles (water, lava and grass that move on an Oldschool map): on or off for this map, and how the
// grass is: how many blades (amount), how long (length), how soon they show in a light wind (breeze). Each about 1.
// Beta 3.46: what moves on an Oldschool map (living.js), set for the map and for each kind of effect on its own card.
// [what a new map has, the least, the most]
const LIVE_SPEC = {
  grass: { amount: [1, 0, 1.5], length: [1, 0.3, 2.5], calm: [0.35, 0, 1], range: [0.5, 0.05, 1], vary: [0.3, 0, 1] },
  water: { clear: [0.25, 0, 1], speed: [1, 0.3, 2.5] },
  lava: { glow: [1, 0, 2], embers: [1, 0, 2], heat: [0.5, 0, 1], speed: [1, 0.3, 2.5], range: [0.5, 0, 1] },
  shimmer: { power: [1, 0, 2], speed: [1, 0.3, 2.5], range: [0.5, 0, 1] },
  pulse: { power: [1, 0, 2], speed: [1, 0.3, 2.5], range: [0.5, 0, 1] },
  ripple: { power: [1, 0, 2], speed: [1, 0.3, 2.5], range: [0.5, 0, 1] },
};
const GROWS = ['all', 'bright', 'dark', 'colour']; // where grass grows: everywhere, on the floor's bright or dark parts, on a colour of it
const HEX6 = /^#[0-9a-f]{6}$/;
function defaultLive() {
  const out = { on: true };
  for (const [fx, spec] of Object.entries(LIVE_SPEC)) { out[fx] = {}; for (const [k, [d]] of Object.entries(spec)) out[fx][k] = d; }
  out.grass.grow = 'all'; out.grass.growColor = '#5c8a34';
  return out;
}
function cleanLive(v) {
  const out = defaultLive();
  if (!v || typeof v !== 'object') return out;
  out.on = v.on !== false;
  // (a map of Beta 3.42 to 3.45 had a few sliders for the whole map)
  const old = { grass: { amount: v.amount, length: v.length }, shimmer: { power: v.glow, speed: v.speed }, pulse: { power: v.glow, speed: v.speed }, ripple: { power: v.glow, speed: v.speed } };
  for (const [fx, spec] of Object.entries(LIVE_SPEC)) {
    const src = { ...(old[fx] || {}), ...(v[fx] && typeof v[fx] === 'object' ? v[fx] : {}) };
    for (const [k, [, a, b]] of Object.entries(spec)) { const n = Number(src[k]); if (src[k] != null && Number.isFinite(n)) out[fx][k] = Math.round(Math.min(b, Math.max(a, n)) * 100) / 100; }
  }
  const g = v.grass && typeof v.grass === 'object' ? v.grass : {};
  if (GROWS.includes(g.grow)) out.grass.grow = g.grow;
  if (HEX6.test(String(g.growColor || '').toLowerCase())) out.grass.growColor = String(g.growColor).toLowerCase();
  return out;
}
function cleanWind(w) {
  const out = defaultWind();
  if (!w || typeof w !== 'object') return out;
  out.auto = w.auto !== false; out.storm = !!w.storm;
  for (const [k, [a, b]] of Object.entries(WIND_RANGE)) { const v = Number(w[k]); if (Number.isFinite(v)) out[k] = k === 'dir' ? Math.round(((v % 360) + 360) % 360) : Math.round(Math.min(b, Math.max(a, v)) * 100) / 100; }
  return out;
}
const newSeed = () => 1 + Math.floor(Math.random() * 9998);
// a living tree's own values: its variant, the layer it starts at (its size), the seed its look and movement come from
function cleanTree(t, ref) {
  const k = treeOf(ref);
  if (!k) return null;
  const seed = Math.floor(Number(t && t.seed));
  return { v: k.v, base: k.base, seed: seed >= 1 && seed <= 9999 ? seed : newSeed() };
}

// ---------- Beta 3.22: Oldschool maps (drawn, not a picture) ----------
// map.os: what the GM drew, in drawing order: floors ('area': a shape with its tile, its edge and its height level),
// cuts (what the eraser took away), wall lines, pillars and stairs; doors sit on the walls. The GM screen turns it into
// the map's picture (renderer/oldschool.js) and the line-of-sight walls (os.result); the TV only shows that picture.
const OS_EDGES = ['ledge', 'walls', 'rock', 'cliff', 'fade']; // (Beta 3.28: fade)
const OS_SHAPES = ['rect', 'poly', 'round', 'path', 'brush'];
const LIVE_FX = ['grass', 'water', 'lava', 'shimmer', 'pulse', 'ripple', 'none']; // (Beta 3.43; 3.46: Glow is called Shimmer)
const OLD_TINT = { green: '#5c8a34', dry: '#9a8f4e', wheat: '#c8a548', autumn: '#a85f28' }; // (Beta 3.43 to 3.45: four colours by name)
// Beta 3.25: ground drawn into an Oldschool map (the Draw tool's Ground): the picture shows the pool, an effect of the
// same kind (fx, key os) makes it move
const GROUND_KINDS = ['water', 'lava', 'acid', 'darkness', 'swamp'];
// Beta 3.33: what fills a door or a window (the pieces of tablescape_doors_windows_dynamic)
const DOOR_LEAVES = ['wood', 'metal', 'stone', 'portcullis'];
const WINDOW_LEAVES = ['clear', 'leaded', 'stained', 'shutter', 'bars'];
// Beta 3.27: how a floor mixes into the floor already there, by opacity alone: mixW squares wide (0: not at all), the
// line made uneven by mixU (0–1), squares pushed in or out along the grid by mixT (0–1). (3.26's 'stones' / 'soft'
// become the defaults; 'off' stays off.)
const MIX_DEFAULT = { mixW: 1.5, mixU: 0.5, mixT: 0.5 };
function mixOf(it) {
  const legacy = typeof it.mix === 'string' && it.mixU === undefined;
  if (legacy) return { mixW: it.mix === 'off' ? 0 : MIX_DEFAULT.mixW, mixU: MIX_DEFAULT.mixU, mixT: MIX_DEFAULT.mixT };
  return { mixW: Math.round(osNum(it.mixW, MIX_DEFAULT.mixW, 0, 3) * 2) / 2, mixU: r3(osNum(it.mixU, MIX_DEFAULT.mixU, 0, 1)), mixT: r3(osNum(it.mixT, MIX_DEFAULT.mixT, 0, 1)) };
}
function defaultOs() { return { v: 1, items: [], doors: [], sun: 135, shadowLen: 0.35, shadowAll: 0, sight: true }; } // (Beta 3.25: the depth view of 3.23 is gone; shadows. Beta 3.35: their length and all around)
const SHADOW_LEN = { short: 0.35, long: 0.75, off: 0 }; // (Beta 3.35: what short / long / off of before became)
const osNum = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
const ptsOf = (pts) => (Array.isArray(pts) ? pts.filter((q) => Array.isArray(q) && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1]))).slice(0, 4000).map((q) => [r3(Number(q[0])), r3(Number(q[1]))]) : []);
const refOf = (t) => (t && (t.rel || t.path) ? { ...(t.rel ? { rel: String(t.rel) } : {}), ...(t.path ? { path: String(t.path) } : {}) } : null);
function cleanOsItem(it) {
  if (!it || typeof it !== 'object') return null;
  const id = typeof it.id === 'string' && it.id ? it.id : newId('o');
  const kind = ['area', 'cut', 'line', 'pillar', 'stairs', 'paint', 'live'].includes(it.kind) ? it.kind : null; // (Beta 3.29: no more ground; 3.43: live, an effect drawn over the floors)
  if (!kind) return null;
  const pts = ptsOf(it.pts);
  if (kind === 'live') { // (Beta 3.43) grass, water, lava, glow, pulse or ripple over whatever floor lies there; 'none' takes effects away
    // (3.46: shape 'fill': from one spot over all the floor that lies at its height and is joined to it; a colour of
    // one's own for grass and for water, any colour)
    const shape = it.shape === 'fill' || OS_SHAPES.includes(it.shape) ? it.shape : 'poly';
    const fx = it.fx === 'glow' ? 'shimmer' : it.fx;
    if (pts.length < (shape === 'poly' ? 3 : shape === 'path' || shape === 'brush' || shape === 'fill' ? 1 : 2) || !LIVE_FX.includes(fx)) return null;
    const tint = OLD_TINT[it.tint] || String(it.tint || '').toLowerCase();
    return { id, kind, shape, pts: shape === 'fill' ? pts.slice(0, 1) : pts, r: r3(osNum(it.r, 0.5, 0.05, 50)), fx, ...((fx === 'grass' || fx === 'water') && HEX6.test(tint) ? { tint } : {}), mixW: shape === 'fill' ? 0 : Math.round(osNum(it.mixW, 1.5, 0, 3) * 2) / 2 };
  }
  if (kind === 'paint') { // (Beta 3.26) a floor painted into the floors under a brush
    // (Beta 3.49: Texture with every painting tool: a box, a round or a shape as well as the brush)
    const shape = ['rect', 'round', 'poly'].includes(it.shape) ? it.shape : 'brush';
    if (pts.length < (shape === 'poly' ? 3 : shape === 'brush' ? 1 : 2)) return null;
    const m = mixOf(it);
    // (Beta 3.38: its soft edge as wide as the panel says; a tile painted before has none and keeps the brush's own)
    return { id, kind, shape, pts, r: r3(osNum(it.r, 0.75, 0.05, 50)), tile: refOf(it.tile), ...(it.mixW !== undefined && it.mixW !== null || shape !== 'brush' ? { mixW: m.mixW } : {}), mixU: m.mixU, mixT: m.mixT };
  }
  if (kind === 'area' || kind === 'cut') {
    const shape = OS_SHAPES.includes(it.shape) ? it.shape : 'poly';
    const need = shape === 'poly' ? 3 : shape === 'path' || shape === 'brush' ? 1 : 2;
    if (pts.length < need) return null;
    const out = { id, kind, shape, pts, r: r3(osNum(it.r, 0.5, 0.05, 50)) };
    if (kind === 'area') {
      Object.assign(out, { tile: refOf(it.tile), edge: OS_EDGES.includes(it.edge) ? it.edge : 'walls', mat: typeof it.mat === 'string' ? it.mat : 'stone_wall', level: Math.round(osNum(it.level, 0, -3, 3)) });
      Object.assign(out, mixOf(it)); // (Beta 3.27)
    }
    return out;
  }
  if (kind === 'line') return pts.length >= 2 ? { id, kind, pts, w: r3(osNum(it.w, 0.5, 0.05, 10)), h: r3(osNum(it.h, 1, 0.1, 3)), mat: typeof it.mat === 'string' ? it.mat : 'stone_wall' } : null;
  if (kind === 'pillar') return pts.length >= 1 ? { id, kind, pts: pts.slice(0, 1), r: r3(osNum(it.r, 0.3, 0.05, 10)), round: !!it.round, mat: typeof it.mat === 'string' ? it.mat : 'stone_wall' } : null;
  // stairs: a box (two corners) climbing toward dir (0 right, 1 down, 2 left, 3 up), from the floor's level to one higher
  // (Beta 3.29: in a floor tile, tile; stairs from before have only their material)
  return pts.length >= 2 ? { id, kind, pts: pts.slice(0, 2), dir: Math.round(osNum(it.dir, 3, 0, 3)), mat: typeof it.mat === 'string' ? it.mat : 'stone_wall', ...(refOf(it.tile) ? { tile: refOf(it.tile) } : {}) } : null;
}
function cleanOs(o) {
  if (!o || typeof o !== 'object') return null;
  const out = defaultOs();
  out.items = (Array.isArray(o.items) ? o.items : []).map(cleanOsItem).filter(Boolean);
  out.doors = (Array.isArray(o.doors) ? o.doors : []).filter((d) => d && [d.x1, d.y1, d.x2, d.y2].every((v) => Number.isFinite(Number(v)))).map((d) => {
    const win = d.kind === 'window';
    const leaf = (win ? WINDOW_LEAVES : DOOR_LEAVES).includes(d.leaf) ? d.leaf : null; // (Beta 3.33; none: wood, or clear glass)
    return { id: typeof d.id === 'string' && d.id ? d.id : newId('od'), x1: r3(+d.x1), y1: r3(+d.y1), x2: r3(+d.x2), y2: r3(+d.y2), door: d.door === 2 ? 2 : 1, ...(win ? { kind: 'window' } : {}), ...(leaf ? { leaf } : {}) };
  });
  out.sun = Math.round(osNum(o.sun, 135, 0, 359));
  out.shadowLen = r3(osNum(o.shadowLen, SHADOW_LEN[o.shadows] ?? 0.35, 0, 1));
  out.shadowAll = r3(osNum(o.shadowAll, 0, 0, 1));
  out.sight = o.sight !== false;
  return out;
}

// Beta 3.25: each ground drawn has its effect (fx id 'og' + the item's id, os: the item); what the GM set on it in the
// Effects panel (strength, colour, hidden) stays when the ground changes
function syncGround(map) {
  if (!map.os || !Array.isArray(map.fx)) return;
  const g = (map.grid && map.grid.size) || 1;
  const want = new Map(map.os.items.filter((it) => it.kind === 'ground').map((it) => [`og${it.id}`, it]));
  map.fx = map.fx.filter((f) => !f.os || want.has(f.id));
  for (const [id, it] of want) {
    const strokes = groundStrokes(it, g);
    const f = map.fx.find((x) => x.id === id);
    if (!f) map.fx.push({ id, kind: 'region', preset: it.preset, strokes, intensity: 1, hidden: false, color: null, density: 1, speed: 1, os: it.id });
    else { f.preset = it.preset; if (JSON.stringify(f.strokes) !== JSON.stringify(strokes)) f.strokes = strokes; }
  }
}
// Beta 3.41 (Erase in Paint effect): the box a list of strokes covers; whether a point lies in one of the erasing
// strokes; and whether anything of a painted area is left after what was erased from it (looked at in points: along its
// brush lines, on a fine grid in its boxes and rounds)
function strokesBox(strokes) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const st of strokes) { const r = st.r || 0; const q = st.pts || []; for (let i = 0; i + 1 < q.length; i += 2) { x0 = Math.min(x0, q[i] - r); x1 = Math.max(x1, q[i] + r); y0 = Math.min(y0, q[i + 1] - r); y1 = Math.max(y1, q[i + 1] + r); } }
  return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}
function inPoly(q, x, y) { let c = false; for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) if ((q[i + 1] > y) !== (q[j + 1] > y) && x < ((q[j] - q[i]) * (y - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) c = !c; return c; }
function inCuts(cuts, x, y) {
  for (const c of cuts) {
    const q = c.pts;
    if (c.poly) { if (inPoly(q, x, y)) return true; continue; }
    const rr = c.r * c.r;
    if (q.length === 2) { if ((x - q[0]) ** 2 + (y - q[1]) ** 2 <= rr) return true; continue; }
    for (let i = 0; i + 3 < q.length; i += 2) {
      const ax = q[i]; const ay = q[i + 1]; const bx = q[i + 2]; const by = q[i + 3]; const L = (bx - ax) ** 2 + (by - ay) ** 2;
      const u = L ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L)) : 0;
      if ((x - ax - (bx - ax) * u) ** 2 + (y - ay - (by - ay) * u) ** 2 <= rr) return true;
    }
  }
  return false;
}
function regionLeft(fx, g) {
  const S = fx.strokes || [];
  for (let i = 0; i < S.length; i++) {
    const st = S[i]; if (st.cut || st.nm) continue;
    const cuts = S.slice(i + 1).filter((x) => x.cut);
    if (!cuts.length) return true;
    const q = st.pts;
    if (st.poly) {
      const b = strokesBox([st]); if (!b) continue;
      const step = Math.max(Math.min(g * 0.2, (b.x1 - b.x0) / 6, (b.y1 - b.y0) / 6), Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / 900) || 0.01);
      for (let y = b.y0 + step / 2; y < b.y1; y += step) for (let x = b.x0 + step / 2; x < b.x1; x += step) if (inPoly(q, x, y) && !inCuts(cuts, x, y)) return true;
      continue;
    }
    const r = (st.r || 0) * 0.75; const hop = Math.max(2, Math.ceil(q.length / 2 / 150) * 2);
    for (let k = 0; k + 1 < q.length; k += hop) for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (!inCuts(cuts, q[k] + dx, q[k + 1] + dy)) return true;
  }
  return false;
}
// the effect's strokes: a corridor or brush is a stroke already; a box, round or shape is its outline (filled: where
// the effect shows) and dots about a square apart inside it (for what moves in it: bubbles, embers), each no bigger
// than its room to the edge
function groundStrokes(it, g) {
  const flat = (pts) => pts.flatMap(([x, y]) => [r3(x), r3(y)]);
  if (it.shape === 'path' || it.shape === 'brush') return [{ sid: 'b', r: it.r, pts: flat(it.pts) }];
  let poly;
  if (it.shape === 'rect') { const [[ax, ay], [bx, by]] = it.pts; poly = [[ax, ay], [bx, ay], [bx, by], [ax, by]]; }
  else if (it.shape === 'round') {
    const [[ax, ay], [bx, by]] = it.pts; const cx = (ax + bx) / 2; const cy = (ay + by) / 2; const rx = Math.abs(bx - ax) / 2; const ry = Math.abs(by - ay) / 2;
    poly = Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * rx, cy + Math.sin((i / 40) * Math.PI * 2) * ry]);
  } else poly = it.pts;
  const out = [{ sid: 'm', r: 0, poly: true, pts: flat(poly) }];
  const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const edge = (x, y) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j]; const [bx, by] = poly[i]; const L = (bx - ax) ** 2 + (by - ay) ** 2; const t = L ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L)) : 0; d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay))); } return d; };
  const xs = poly.map((q) => q[0]); const ys = poly.map((q) => q[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const s = g * 0.9; let n = 0;
  for (let y = y0 + s / 2; y < y1 && n < 400; y += s) {
    for (let x = x0 + s / 2; x < x1 && n < 400; x += s) {
      if (!inside(x, y)) continue;
      const d = edge(x, y); if (d < g * 0.15) continue;
      out.push({ sid: `d${n++}`, r: r3(Math.min(g * 0.55, d)), pts: [r3(x), r3(y)], nm: true });
    }
  }
  if (!n) { const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; out.push({ sid: 'd0', r: r3(Math.max(0.05, Math.min(g * 0.4, (x1 - x0) / 2, (y1 - y0) / 2))), pts: [r3(cx), r3(cy)], nm: true }); }
  return out;
}

function defaultGrid() {
  return { type: 'square', size: 1, angle: 0, ox: 0, oy: 0, show: true, color: '#ffffff', opacity: 0.3, width: 1 };
}

function emptyMap(name = 'New map') {
  return {
    id: newId('m'), name,
    view: { x: 0, y: 0, zoom: 1 },
    bg: null, layers: [], grid: defaultGrid(),
    fog: { enabled: false, base: 'cover', ops: [] },
    fx: [], spells: [],
    weather: { layers: [], fade: 0, name: 'None' }, // a mix of weather layers over the whole table (fade: seconds new weather takes to come in)
    wind: defaultWind(), // (Beta 3.20) the wind in the living trees
    live: defaultLive(), // (Beta 3.42) living tiles
    light: { darkness: 0, tint: '#03040a', memory: false, seen: [] },
    draw: [], // pen strokes and text labels
    marks: [], // pins, crosses, numbered dots, counters, GM notes
    round: { n: null, show: true }, // round counter (null = not counting)
    walls: [], // { id, x1, y1, x2, y2, door: 0 wall | 1 door | 2 secret door, open, kind: (Prototype 14, plain walls only) 'window' | 'invisible', shut: (Beta 3.1) a closed window }
    areas: [], // { id, name, rings } areas the GM marked out to reveal in one click
    vision: { on: true, dim: 0.5 }, // line of sight; dim: explored ground nobody sees right now
    // how far the map was turned since it was made (see turnMap): frame for everything, pframe for what came in the
    // picture's file. Snapshots remember theirs, so a map turned later still gets its snapshots in the right place.
    frame: { ...FRAME0 }, pframe: { ...FRAME0 },
    snaps: [], // snapshots (2.1): the map's scenery saved to come back to, a timeline from left to right
  };
}

// Fill in anything missing and upgrade older files.
function normalize(m) {
  const base = emptyMap(m && m.name);
  const out = Object.assign(base, m || {});
  const g = (m && m.grid) || {};
  out.grid = { ...defaultGrid(), ...g };
  if ('inches' in g && !('size' in g)) {
    // 0.2: square grid in table inches, offset as a fraction of a cell
    out.grid.size = g.inches || 1;
    out.grid.ox = (g.offsetX || 0) * out.grid.size;
    out.grid.oy = (g.offsetY || 0) * out.grid.size;
  }
  delete out.grid.inches; delete out.grid.offsetX; delete out.grid.offsetY;
  out.view = { x: 0, y: 0, zoom: 1, ...((m && m.view) || {}) };
  out.fog = { enabled: false, base: 'cover', ops: [], ...((m && m.fog) || {}) };
  out.layers = Array.isArray(out.layers) ? out.layers.filter((l) => l && l.role) : [];
  for (const l of out.layers) if (l.role === 'overlay' && !l.anchor) l.anchor = 'map';
  out.fx = Array.isArray(out.fx) ? out.fx : [];
  out.spells = Array.isArray(out.spells) ? out.spells : [];
  out.weather = normalizeWeather(m && m.weather);
  out.wind = cleanWind(m && m.wind);
  out.live = cleanLive(m && m.live);
  for (const l of out.layers) { // (Beta 3.20: a living tree is known by its picture; anything else has no "tree")
    if (l.role === 'asset' && treeOf(l)) l.tree = cleanTree(l.tree, l); else if (l.tree) delete l.tree;
  }
  out.light = { darkness: 0, tint: '#03040a', memory: false, ...((m && m.light) || {}) };
  if (!Array.isArray(out.light.seen)) out.light.seen = [];
  out.draw = Array.isArray(out.draw) ? out.draw.filter((d) => d && d.kind) : [];
  out.marks = Array.isArray(out.marks) ? out.marks.filter((d) => d && d.kind) : [];
  out.round = { n: null, show: true, ...((m && m.round) || {}) };
  out.walls = Array.isArray(out.walls) ? out.walls.filter((w) => w && Number.isFinite(w.x1) && Number.isFinite(w.y2)) : [];
  out.os = out.os ? cleanOs(out.os) : null; // (Beta 3.22) an Oldschool map's drawing
  if (out.os) syncGround(out); // (Beta 3.29: Ground is gone; pools drawn before go, and their effects with them)
  out.vision = { on: true, dim: 0.5, ...((m && m.vision) || {}) };
  out.areas = Array.isArray(out.areas) ? out.areas.filter((a) => a && Array.isArray(a.rings) && a.rings.length) : [];
  out.frame = { ...FRAME0, ...((m && m.frame) || {}) };
  out.pframe = { ...FRAME0, ...((m && m.pframe) || {}) };
  out.snaps = Array.isArray(out.snaps) ? out.snaps.filter((s) => s && s.id && s.data) : [];
  return out;
}

// ---------- weather: a list of layers (rain, splashes, clouds, lightning ...) ----------
const WEATHER_KEYS = ['amount', 'opacity', 'size', 'speed', 'color', 'dir', 'gust', 'hidden', 'thunder'];
function weatherLayer(p, now) {
  const L = { id: p.id || newId('w'), type: String(p.type || 'rain'), amount: 1, opacity: 1, size: 1, speed: 1, color: null, dir: null, gust: 0, hidden: false, born: now || 0, dying: null };
  Object.assign(L, pick(p, WEATHER_KEYS));
  if (L.type === 'lightning' && L.thunder == null) L.thunder = true;
  return L;
}
// 0.5 and older: one preset with a strength and a left/right wind
function legacyLayers(w) {
  const I = (w.intensity ?? 0.6) / 0.6;
  const wind = w.wind ?? 0.25;
  const fall = Math.round((Math.atan2(1, wind) * 180) / Math.PI);
  const rise = Math.round((Math.atan2(-1, wind * 0.4) * 180) / Math.PI);
  const one = (type, extra = {}) => weatherLayer({ type, amount: I, dir: type === 'embers' ? rise : fall, ...extra });
  switch (w.preset) {
    case 'rain': return [one('rain')];
    case 'storm': return [one('rain', { amount: I * 1.6 }), one('lightning', { dir: null })];
    case 'snow': case 'ash': case 'embers': case 'leaves': return [one(w.preset)];
    default: return [];
  }
}
function normalizeWeather(w) {
  w = w || {};
  const out = { layers: [], fade: 0, name: 'None', ...w };
  if (!Array.isArray(w.layers)) {
    out.layers = legacyLayers(w);
    out.name = out.layers.length ? String(w.preset).replace(/^./, (c) => c.toUpperCase()) : 'None';
  }
  out.layers = out.layers.filter((l) => l && l.type && !l.dying).map((l) => ({ ...l, born: 0 }));
  delete out.preset; delete out.intensity; delete out.wind;
  return out;
}

const TOKEN_DEFAULTS = { size: 1, rotation: 0, opacity: 1, hidden: false };
const OVERLAY_DEFAULTS = { x: 0, y: 0, scale: 1, fill: true, opacity: 1, blend: 'screen', rate: 1, hidden: false, anchor: 'map' };
const AUDIO_DEFAULTS = { volume: 0.6, muted: false, hidden: false };
// Assets (trees, rocks, furniture): free placement, w = width in map inches
const STRETCH = [0.05, 20]; // (Beta 3.10: an asset's height against its own picture's)
const ASSET_DEFAULTS = { rotation: 0, opacity: 1, hidden: false, flip: false, shadow: false, dark: 0, locked: false };
const LAYER_KEYS = ['front', 'over', 'x', 'y', 'scale', 'fill', 'opacity', 'blend', 'rate', 'size', 'rotation', 'hidden', 'volume', 'muted', 'name', 'anchor', 'w', 'flip', 'shadow', 'dark', 'locked', 'n', 'tag', 'named', 'asVideo', 'pic', 'stretch', 'hue']; // (4.8: asVideo; 4.10: pic, a token's own picture size)
// a token's name tag: 'off' (none), 'gm' (on the GM screen only), 'all' (on the TV too, unless the token is hidden)
const TAGS = ['off', 'gm', 'all'];
// (Beta 3.11, for world and regional maps: 'place', a marker with a title and a line under it that can lead to a
// regional map and bring a note or a handout; 'route', a dotted path from point to point whose length is counted in
// grid cells)
const MARK_KINDS = ['pin', 'x', 'dot', 'counter', 'note', 'place', 'route'];
const short = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const PLACE_STYLES = ['medallion', 'diamond', 'pin']; // (Beta 3.12)
const placeIcon = (v) => (typeof v === 'string' && /^[a-z0-9-]{1,32}$/.test(v) ? v : 'flag');
// Beta 3.12: how a world or regional map shows on the TV, kept with the map so each region has its own air:
//   mist: 'cloud' (white) | 'dark' (black): what the map fades into at its edges; reach: how far it comes in from the
//   map's edges; rim: how far from the TV's rim (0: not at all); weather: cloud shadows, rain, snow, sunshine, storm (0 to 1)
// (Beta 3.14) how a route is drawn: its line, its width (1 thin … 3 bold), an arrow at its end, rounded bends, and how
// much of it the party has walked (0 … 1: that part is drawn solid)
const ROUTE_LOOKS = ['dash', 'dots', 'solid'];
function routeLook(m, p) {
  if ('look' in p && ROUTE_LOOKS.includes(p.look)) m.look = p.look;
  if ('width' in p) m.width = Math.min(3, Math.max(1, Math.round(num(p.width, 2))));
  if ('arrow' in p) m.arrow = !!p.arrow;
  if ('round' in p) m.round = !!p.round;
  if ('walked' in p) m.walked = Math.round(Math.min(1, Math.max(0, num(p.walked, 0))) * 1000) / 1000;
}
// the middle of a route, measured along it: where its label stands
function routeMid(pts) {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  let left = len / 2;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    if (d > 0 && left <= d) return { x: r3(pts[i] + ((pts[i + 2] - pts[i]) * left) / d), y: r3(pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * left) / d) };
    left -= d;
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1] };
}
const ATLAS_WEATHER = ['sun']; // (Beta 3.13: sunshine only; the rest is the map's own weather, as on a battlemap)
const part = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100 : d);
function atlasMapSet(map, p) {
  const a = { mist: 'cloud', reach: 0.5, rim: 0.3, weather: {}, ...(map.atlas || {}) };
  if ('mist' in p) a.mist = p.mist === 'dark' ? 'dark' : 'cloud';
  if ('reach' in p) a.reach = part(p.reach, a.reach);
  if ('rim' in p) a.rim = part(p.rim, a.rim);
  a.weather = Object.fromEntries(Object.entries(a.weather || {}).filter(([k]) => ATLAS_WEATHER.includes(k))); // (what Beta 3.12 kept there besides is gone)
  if (p.weather && typeof p.weather === 'object') { for (const k of ATLAS_WEATHER) if (k in p.weather) { const v = part(p.weather[k], 0); if (v > 0) a.weather[k] = v; else delete a.weather[k]; } }
  map.atlas = a;
}
// what one grid cell stands for (Beta 3.11): { n, name } as in "1 day of travel", "6 miles"; null: 5 ft, as on a battlemap
function gridUnit(u) {
  if (!u || typeof u !== 'object') return null;
  const n = Number(u.n); const name = short(u.name, 30);
  return name && Number.isFinite(n) && n > 0 ? { n: Math.round(Math.min(100000, n) * 100) / 100, name } : null;
}
const r4g = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]]));
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

function fixStretch(l) {
  fixHue(l);
  if (!('stretch' in l)) return;
  const k = Number(l.stretch);
  if (l.role !== 'asset' || l.tree || !Number.isFinite(k) || Math.abs(k - 1) < 0.005) delete l.stretch; // (a living tree keeps its shape)
  else l.stretch = Math.round(Math.min(STRETCH[1], Math.max(STRETCH[0], k)) * 1000) / 1000;
}
// Beta 3.10: an asset's colours turned round the colour wheel, in whole degrees from -179 to 180 (a red banner made
// blue, autumn leaves from green ones). Only kept when it is turned at all.
function fixHue(l) {
  if (!('hue' in l)) return;
  const d = Math.round(Number(l.hue));
  const v = Number.isFinite(d) ? ((((d + 180) % 360) + 360) % 360) - 180 : 0;
  if (l.role !== 'asset' || !Number.isFinite(d) || v === 0) delete l.hue;
  else l.hue = v === -180 ? 180 : v;
}
function updateLayer(l, p) {
  Object.assign(l, pick(p, LAYER_KEYS));
  if ('tag' in p && !TAGS.includes(l.tag)) l.tag = 'off';
  if ('player' in p) { if (p.player === false) l.player = false; else if (p.player) l.player = String(p.player).slice(0, 40); else delete l.player; } // (Prototype 17: a player token by the DM's word)
  if ('name' in p) l.name = String(l.name ?? '').trim().slice(0, 60) || 'Token';
  if ('pic' in p) { const k = Number(p.pic); if (p.pic == null || !Number.isFinite(k) || Math.abs(k - 1) < 0.001) delete l.pic; else l.pic = Math.round(Math.min(2, Math.max(0.5, k)) * 100) / 100; }
  if ('front' in p) { if (p.front) l.front = true; else delete l.front; } // (Prototype 18: an asset in front of the effects)
  if ('over' in p) { if (p.over) { l.over = true; delete l.front; } else delete l.over; } // (Prototype 23: above the tokens: tree tops, roofs)
  if (p.front) delete l.over;
  if (l.role === 'asset') { l.w = Math.max(0.05, Number(l.w) || 1); l.dark = Math.min(0.9, Math.max(0, Number(l.dark) || 0)); }
  // Beta 3.10: an asset's shape: how tall it is drawn against its own picture (1: as the picture is; below: flat, above:
  // long). Its width stays "w", so Bigger and Smaller keep the shape. Only kept when it differs from the picture's own.
  fixStretch(l);
}
// Copies of the same NPC get numbers: Goblin 1, Goblin 2 ... (one renamed on its own, "named", stays out of it)
function numberToken(map, layer) {
  const same = map.layers.filter((l) => l.role === 'token' && l !== layer && l.path === layer.path && !l.named);
  if (!same.length) return;
  let max = Math.max(0, ...same.map((l) => l.n || 0));
  for (const l of same) if (!l.n) l.n = ++max;
  layer.n = max + 1;
}

// ---------- turning the map ----------
// The picture turns to p.to degrees (any angle). mode 'all': around p.pivot (the middle of the table), with everything
// on the map: grid, fog, walls, tokens, assets, spells, effects, drawings, marks, areas. mode 'picture': around its own
// centre (p.center), with only what came in its file (walls, doors, lights, the grid). The window sends the picture's
// centre because only it knows the picture's size.
const normDeg = (a) => { let x = ((Number(a) || 0) % 360 + 360) % 360; if (x > 180) x -= 360; return Math.round(x * 1000) / 1000; };
function turnMap(map, p) {
  const bg = map.bg;
  if (!bg) return { changed: null };
  const to = normDeg(p.to);
  const d = normDeg(to - (bg.rotation || 0));
  if (Math.abs(d) < 1e-4) return { changed: null };
  const all = p.mode !== 'picture';
  const c = p.center && Number.isFinite(p.center.x) && Number.isFinite(p.center.y) ? p.center : null;
  const piv = all && p.pivot && Number.isFinite(p.pivot.x) && Number.isFinite(p.pivot.y) ? p.pivot : c;
  bg.rotation = to;
  if (!piv) return { changed: 'all', label: 'Map turned' };
  const a = (d * Math.PI) / 180; const cos = Math.cos(a); const sin = Math.sin(a);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const R = (x, y) => [r4(piv.x + (x - piv.x) * cos - (y - piv.y) * sin), r4(piv.y + (x - piv.x) * sin + (y - piv.y) * cos)];
  const pt = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) [o.x, o.y] = R(o.x, o.y); };
  const flat = (arr) => { if (!Array.isArray(arr)) return; for (let i = 0; i + 1 < arr.length; i += 2) [arr[i], arr[i + 1]] = R(arr[i], arr[i + 1]); };
  const turnAngle = (v) => normDeg((v || 0) + d);
  // the frames follow (snapshots saved before the turn are placed with them)
  const turnFrame = (F) => { const f = { ...FRAME0, ...F }; const [tx, ty] = R(f.tx, f.ty); return { a: turnAngle(f.a), tx, ty }; };
  map.pframe = turnFrame(map.pframe);
  if (all) map.frame = turnFrame(map.frame);
  // the picture: its centre goes round the pivot
  if (c && piv !== c) { const [cx, cy] = R(c.x, c.y); bg.x = r4((bg.x || 0) + cx - c.x); bg.y = r4((bg.y || 0) + cy - c.y); }
  // what belongs to the picture always turns with it
  for (const w of map.walls) if (all || w.file) { [w.x1, w.y1] = R(w.x1, w.y1); [w.x2, w.y2] = R(w.x2, w.y2); }
  for (const f of map.fx) if ((all || f.imported) && !f.attachTo) { pt(f); if (f.angle != null) f.angle = turnAngle(f.angle); } // (Beta 2: a light shaft keeps facing the room)
  if (all || map.grid.file) { [map.grid.ox, map.grid.oy] = R(map.grid.ox || 0, map.grid.oy || 0); map.grid.angle = turnAngle(map.grid.angle); }
  if (all) {
    for (const l of map.layers) {
      if (l.role === 'overlay' || !Number.isFinite(l.x)) continue; // films over the map stay as they are
      pt(l);
      if (l.role === 'asset') l.rotation = turnAngle(l.rotation); // tokens stay upright, furniture turns with the room
    }
    for (const f of map.fx) if (f.kind === 'region') for (const st of f.strokes || []) { flat(st.pts); flat(st.line); }
    for (const sp of map.spells) { if (!sp.attachTo) pt(sp); sp.angle = turnAngle(sp.angle); }
    for (const op of map.fog.ops) {
      if (op.shape === 'mask') { // a folded fog turns round its centre
        const [cx, cy] = R(op.x + op.w / 2, op.y + op.h / 2);
        op.x = r4(cx - op.w / 2); op.y = r4(cy - op.h / 2); op.rot = turnAngle(op.rot);
        continue;
      }
      if (op.shape === 'rect') { // a rectangle becomes a turned outline
        const ring = [op.x, op.y, op.x + op.w, op.y, op.x + op.w, op.y + op.h, op.x, op.y + op.h];
        flat(ring);
        op.shape = 'poly'; op.rings = [ring]; delete op.x; delete op.y; delete op.w; delete op.h;
        continue;
      }
      pt(op); if (op.anim) pt(op.anim);
      for (const r of op.rings || []) flat(r);
      flat(op.pts);
      for (const r of op.lit || []) flat(r);
    }
    for (const s of map.light.seen || []) pt(s);
    for (const dr of map.draw) { flat(dr.pts); pt(dr); }
    for (const m of map.marks) { pt(m); flat(m.pts); } // (Beta 3.11: a route turns with all its points)
    for (const ar of map.areas || []) for (const r of ar.rings || []) flat(r);
  }
  return { changed: 'all', fog: true, label: all ? 'Map turned' : 'Picture turned' };
}

// ---------- snapshots (2.1): the map's scenery ----------
// In a snapshot: the picture, assets, films, map sounds, effects and lights, the weather, the light.
// Not in it: tokens (and their lights), the party's light, fog, walls and doors, spell areas, drawings, marks.
// Those are the players' doing or the map's setup, so a snapshot never takes them back. The grid and where the map
// lies on the TV are kept with it (2.3) but only come back with another picture.
const WX_SNAP = ['type', ...WEATHER_KEYS];
const tokenIds = (map) => new Set(map.layers.filter((l) => l.role === 'token').map((l) => l.id));
const sceneryFx = (f, tok) => f.preset !== 'party' && !(f.attachTo && tok.has(f.attachTo));
function sceneOf(map) {
  const tok = tokenIds(map);
  return structuredClone({
    bg: map.bg ? pick(map.bg, ['path', 'rel', 'name', 'kind', 'volume', 'rate', 'x', 'y', 'scale', 'span', 'rotation', 'nw', 'nh']) : null,
    // 2.3: the grid and where the map lies on the TV come back when the snapshot brings another picture
    grid: { ...map.grid }, view: { x: map.view.x, y: map.view.y, zoom: map.view.zoom },
    layers: map.layers.filter((l) => l.role !== 'token'),
    fx: map.fx.filter((f) => sceneryFx(f, tok)),
    weather: { name: map.weather.name, layers: map.weather.layers.filter((l) => !l.dying).map((l) => pick(l, WX_SNAP)) },
    light: { darkness: map.light.darkness, tint: map.light.tint, mood: map.light.mood || null },
    frame: { ...FRAME0, ...map.frame }, pframe: { ...FRAME0, ...map.pframe },
    look: map.look || null, // 4.5: the map's colours (Build → Map)
  });
}
// from where things lay when the snapshot was saved to where they lie now (the map may have been turned since)
function frameShift(f1, f2) {
  const A = { ...FRAME0, ...f1 }; const B = { ...FRAME0, ...f2 };
  const d = normDeg(B.a - A.a);
  if (Math.abs(d) < 1e-6 && Math.abs(A.tx - B.tx) < 1e-6 && Math.abs(A.ty - B.ty) < 1e-6) return null;
  const a1 = (-A.a * Math.PI) / 180; const a2 = (B.a * Math.PI) / 180;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return {
    d,
    pt: (x, y) => {
      const ux = x - A.tx; const uy = y - A.ty;
      const ox = ux * Math.cos(a1) - uy * Math.sin(a1); const oy = ux * Math.sin(a1) + uy * Math.cos(a1);
      return [r4(ox * Math.cos(a2) - oy * Math.sin(a2) + B.tx), r4(ox * Math.sin(a2) + oy * Math.cos(a2) + B.ty)];
    },
  };
}
// a snapshot's scenery placed on the map as it lies now
function placeScene(D, map) {
  const out = structuredClone(D);
  const T = frameShift(D.frame, map.frame); const TP = frameShift(D.pframe || D.frame, map.pframe);
  const mv = (o, t) => { if (t && o && Number.isFinite(o.x) && Number.isFinite(o.y)) [o.x, o.y] = t.pt(o.x, o.y); };
  const flat = (arr, t) => { if (!t || !Array.isArray(arr)) return; for (let i = 0; i + 1 < arr.length; i += 2) [arr[i], arr[i + 1]] = t.pt(arr[i], arr[i + 1]); };
  for (const l of out.layers || []) {
    if (l.role === 'overlay' || !Number.isFinite(l.x)) continue; // films over the map stay as they are
    mv(l, T);
    if (l.role === 'asset' && T) l.rotation = normDeg((l.rotation || 0) + T.d);
  }
  for (const f of out.fx || []) {
    if (!f.attachTo) mv(f, f.imported ? TP : T);
    const TT = f.imported ? TP : T;
    if (f.angle != null && TT && !f.attachTo) f.angle = normDeg(f.angle + TT.d);
    if (f.kind === 'region') for (const st of f.strokes || []) { flat(st.pts, T); flat(st.line, T); }
  }
  // the picture (its centre goes along, it turns by the same angle) and its grid follow every turn of the picture
  const b = out.bg;
  if (b && TP) {
    const w = b.span || (b.nw && b.scale != null ? b.nw * b.scale : null);
    const hh = b.span && b.nw ? (b.span * b.nh) / b.nw : b.nh && b.scale != null ? b.nh * b.scale : null;
    if (w && hh) { const [cx, cy] = TP.pt((b.x || 0) + w / 2, (b.y || 0) + hh / 2); b.x = Math.round((cx - w / 2) * 10000) / 10000; b.y = Math.round((cy - hh / 2) * 10000) / 10000; }
    b.rotation = normDeg((b.rotation || 0) + TP.d);
  }
  const TG = out.grid && out.grid.file ? TP : T;
  if (out.grid && TG) { [out.grid.ox, out.grid.oy] = TG.pt(out.grid.ox || 0, out.grid.oy || 0); out.grid.angle = normDeg((out.grid.angle || 0) + TG.d); }
  return out;
}
// a short fingerprint of the scenery (does the map still look like its snapshot?)
function sceneSig(D) {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v ?? null);
  return JSON.stringify([D.bg ? D.bg.path : null,
    (D.layers || []).map((l) => [l.id, l.path, r(l.x), r(l.y), r(l.w), r(l.rotation), !!l.hidden, r(l.opacity), !!l.muted, r(l.volume)]),
    (D.fx || []).map((f) => [f.id, f.preset, r(f.x), r(f.y), r(f.r), !!f.hidden, r(f.intensity), f.color || null, (f.strokes || []).length]),
    D.weather ? D.weather.layers.map((l) => [l.type, r(l.amount), !!l.hidden]) : [], D.light ? [r(D.light.darkness), D.light.tint] : null,
    'look' in D ? JSON.stringify(D.look || null) : '-']);
}
const sceneMatches = (map, D) => { const cur = sceneOf(map); if (!('look' in D)) delete cur.look; return sceneSig(cur) === sceneSig(placeScene(D, map)); }; // (a snapshot from before 4.5 has no colours)

// media(path) is injected by the caller: turns a file path into {path, rel, name, url}
// Beta 3.49: a light of the app is a picture (an asset with .fixture) and its flame (an effect with .fixture). After
// anything done to layers or effects they are put right: the flame lies where the picture lies, a copied picture has a
// flame of its own, a flame whose picture is gone goes too.
function syncFixtures(map) {
  if (!Array.isArray(map.layers) || !Array.isArray(map.fx)) return;
  if (!map.layers.some((l) => l.fixture) && !map.fx.some((f) => f.fixture)) return;
  const used = new Set();
  for (const l of map.layers) {
    if (!l.fixture) continue;
    let f = map.fx.find((x) => x.id === l.fixture.fx);
    if (f && used.has(f.id)) { f = { ...structuredClone(f), id: newId('x') }; map.fx.push(f); l.fixture = { ...l.fixture, fx: f.id }; }
    if (f) { used.add(f.id); f.fixture = l.id; f.x = l.x; f.y = l.y; }
  }
  const have = new Set(map.layers.filter((l) => l.fixture).map((l) => l.id));
  map.fx = map.fx.filter((f) => !f.fixture || have.has(f.fixture));
}
function apply(map, type, p, media) {
  const r = applyRaw(map, type, p, media);
  if (r && r.changed && map && /^(layer|fx|scene)\./.test(type)) syncFixtures(map);
  return r;
}
function applyRaw(map, type, p, media) {
  switch (type) {
    // ---------- background ----------
    case 'bg.set': {
      const kind = kindOf(p.path);
      if (kind !== 'image' && kind !== 'video') return { changed: null };
      const old = map.bg;
      map.bg = { ...media(p.path), kind, x: 0, y: 0, scale: null, volume: 0, rate: 1 };
      // a variant of the same map (day / night / rain) keeps its place, so grid and fog still fit
      if (p.keep && old && (old.scale != null || old.span)) Object.assign(map.bg, { x: old.x, y: old.y, scale: old.scale, span: old.span || null, volume: old.volume, rate: old.rate, rotation: old.rotation || 0 });
      return { changed: 'all', label: p.keep ? 'Map variant shown' : 'Map background replaced' };
    }
    case 'bg.pin': // the renderer fixes a "fit" placement once it knows the image size (and tells its pixel size)
    case 'bg.update':
      if (!map.bg) return { changed: null };
      Object.assign(map.bg, pick(p, ['x', 'y', 'scale', 'volume', 'rate', 'nw', 'nh']));
      return { changed: 'all' };
    case 'bg.turn': return turnMap(map, p);
    // 4.5: the map's look (Build → Map): brightness, contrast, saturation, warmth; it stays with the map, whatever picture it shows
    case 'bg.look': {
      const cur = map.look || {};
      const n = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
      const next = p.reset ? {} : {
        bright: n(p.bright ?? cur.bright, 1, 0.3, 2), contrast: n(p.contrast ?? cur.contrast, 1, 0.3, 2),
        sat: n(p.sat ?? cur.sat, 1, 0, 2.5), warm: n(p.warm ?? cur.warm, 0, -1, 1),
      };
      if (p.preset !== undefined) next.preset = p.preset ? String(p.preset).slice(0, 20) : null; else if (!p.reset && cur.preset && ['bright', 'contrast', 'sat', 'warm'].some((k) => k in p)) next.preset = null;
      const plain = !next.preset && ['bright', 'contrast', 'sat'].every((k) => next[k] == null || Math.abs(next[k] - 1) < 0.005) && Math.abs(next.warm || 0) < 0.005;
      if (JSON.stringify(plain ? null : next) === JSON.stringify(map.look || null)) return { changed: null };
      if (plain) delete map.look; else map.look = next;
      return { changed: 'all', label: p.reset ? 'Map colours back to normal' : 'Map colours changed' };
    }

    // ---------- a snapshot comes back: its scenery replaces the map's (tokens, fog, walls ... stay) ----------
    case 'scene.apply': {
      if (!p.scene) return { changed: null };
      const D = placeScene(p.scene, map);
      const now = Date.now();
      const fade = Math.min(60, Math.max(0, Number(p.fade) || 0));
      // the picture: another one takes the place of the one there (like a variant), so grid, walls and fog still fit
      if ('bg' in D) {
        const cur = map.bg;
        if (!D.bg) map.bg = null;
        else if (!cur || cur.path !== D.bg.path) {
          // another picture (2.3): it comes back where it lay and as big as it was, with its grid and where the map lay
          // on the TV. (The same picture leaves the map where it is: moving or turning it at the table is kept.)
          map.bg = { ...media(D.bg.path), kind: D.bg.kind || kindOf(D.bg.path), x: 0, y: 0, scale: null, volume: D.bg.volume ?? 0, rate: D.bg.rate ?? 1,
            ...pick(D.bg, ['x', 'y', 'scale', 'span', 'rotation', 'nw', 'nh']) };
          if (D.grid) map.grid = { ...map.grid, ...D.grid };
          if (D.view && [D.view.x, D.view.y, D.view.zoom].every(Number.isFinite)) map.view = { ...map.view, x: D.view.x, y: D.view.y, zoom: D.view.zoom };
        }
      }
      // assets, films and map sounds; the tokens stay where the players put them
      const toks = map.layers.filter((l) => l.role === 'token');
      const tok = new Set(toks.map((l) => l.id));
      const scen = (D.layers || []).filter((l) => l.role !== 'token' && !tok.has(l.id));
      for (const l of scen) if (l.path && !l.url) l.url = media(l.path).url;
      map.layers = [...scen, ...toks];
      // effects and lights; the tokens' own lights and the party's light stay
      const stay = map.fx.filter((f) => !sceneryFx(f, tok));
      const stayIds = new Set(stay.map((f) => f.id));
      map.fx = [...(D.fx || []).filter((f) => !stayIds.has(f.id)), ...stay];
      // the weather, only where it differs (the same rain keeps falling)
      const wsig = (ls) => JSON.stringify(ls.filter((l) => !l.dying).map((l) => pick(l, WX_SNAP)));
      if (D.weather && wsig(map.weather.layers) !== wsig(D.weather.layers || [])) {
        const fsec = fade || map.weather.fade || 0;
        for (const L of map.weather.layers) if (!L.dying) { L.dying = now; if (fade) L.fs = fade; }
        if (!fsec) map.weather.layers = [];
        map.weather.layers.push(...(D.weather.layers || []).map((q) => Object.assign(weatherLayer({ ...q, id: null }, fsec ? now : 0), fade ? { fs: fade } : {})));
      }
      if (D.weather) map.weather.name = String(D.weather.name || 'None').slice(0, 40);
      // the light (with a fade, the windows ease into it)
      if (D.light) {
        const L = map.light;
        if (L.darkness !== D.light.darkness || L.tint !== D.light.tint) {
          if (fade) { const cur = Vision.lightNow(L); L.from = { darkness: cur.darkness, tint: cur.tint, t0: now, s: fade }; } else delete L.from;
          L.darkness = Math.min(1, Math.max(0, Number(D.light.darkness) || 0));
          L.tint = D.light.tint || L.tint;
        }
        L.mood = D.light.mood || null;
      }
      // 4.5: the map's colours (snapshots from before 4.5 leave them as they are)
      if ('look' in D) { if (D.look) map.look = { ...D.look }; else delete map.look; }
      return { changed: 'all', label: p.label || null };
    }
    case 'bg.clear':
      map.bg = null;
      return { changed: 'all', label: 'Background removed' };

    // ---------- where the map sits on the table ----------
    case 'view.update':
      Object.assign(map.view, pick(p, ['x', 'y', 'zoom']));
      map.view.zoom = Math.min(20, Math.max(0.05, Number(map.view.zoom) || 1));
      return { changed: 'all' }; // fog lives in map space: it moves with the view, nothing to resend

    // ---------- layers ----------
    case 'layer.add': {
      const kind = kindOf(p.path);
      if (!kind) return { changed: null };
      const role = p.role || (kind === 'audio' ? 'audio' : 'token');
      const layer = { id: newId('l'), role, kind, ...media(p.path) };
      if (role === 'token') {
        Object.assign(layer, TOKEN_DEFAULTS, { x: p.x ?? 0, y: p.y ?? 0 }, pick(p, ['size', 'hidden', 'tag']));
        if (!TAGS.includes(layer.tag)) layer.tag = 'off';
        // a new copy takes the name its group was given (all copies renamed "Goblin archer": the next one too)
        const kin = map.layers.find((l) => l.role === 'token' && l.path === layer.path && !l.named);
        if (kin && kin.name) layer.name = kin.name;
        layer.size = Math.max(0.25, Number(layer.size) || 1);
        layer.hidden = !!layer.hidden;
        if (p.number !== false) numberToken(map, layer);
      }
      if (role === 'overlay') Object.assign(layer, OVERLAY_DEFAULTS, pick(p, ['blend', 'anchor']));
      if (role === 'audio') Object.assign(layer, AUDIO_DEFAULTS);
      if (role === 'asset') Object.assign(layer, ASSET_DEFAULTS, { x: p.x ?? 0, y: p.y ?? 0, w: Math.max(0.05, p.w ?? 1) }, pick(p, ['rotation', 'flip', 'opacity', 'shadow', 'dark', 'stretch', 'hue']));
      // Beta 3.20: a living tree: a seed of its own (its look and its movement), above the tokens unless told otherwise,
      // and turned only as far as its kind allows (the pictures have a little light baked in from the top)
      const tk = role === 'asset' ? treeOf(layer) : null;
      if (tk) {
        layer.tree = cleanTree({ seed: p.seed }, layer);
        if (p.over !== false && !p.front) layer.over = true; else if (p.front) layer.front = true;
        const a = ((((Number(layer.rotation) || 0) + 180) % 360) + 360) % 360 - 180;
        layer.rotation = Math.round((a * Math.min(180, tk.turn)) / 180);
        layer.flip = false; layer.shadow = false;
      }
      fixStretch(layer);
      map.layers.push(layer); // drawing order within each role follows this list
      const what = role === 'audio' ? 'Sound' : role === 'overlay' ? (layer.anchor === 'table' ? 'Weather overlay' : 'Atmosphere overlay') : role === 'asset' ? 'Asset' : `${layer.name}${layer.n ? ` ${layer.n}` : ''}`;
      return { changed: 'all', selected: layer.id, label: `${what} added` };
    }
    case 'layer.update': {
      const l = map.layers.find((x) => x.id === p.id);
      if (!l) return { changed: null };
      updateLayer(l, p);
      if (l.fixture) { const f = map.fx.find((x) => x.id === l.fixture.fx); if (f) { f.x = l.x; f.y = l.y; } } // (Beta 3.49: a light's flame goes along)
      return { changed: 'all' };
    }
    case 'layer.reroll': { // (Beta 3.20) living trees: another look and movement (a new seed), one or several
      const ids = new Set(p.ids || (p.id ? [p.id] : []));
      const ls = map.layers.filter((x) => ids.has(x.id) && x.tree);
      if (!ls.length) return { changed: null };
      for (const l of ls) { let n = newSeed(); if (n === l.tree.seed) n = (n % 9999) + 1; l.tree.seed = n; }
      return { changed: 'all', label: ls.length === 1 ? 'A new look for the tree' : `A new look for ${ls.length} trees` };
    }
    case 'layer.many': { // several layers in one undo step (moving or turning a group of assets)
      let n = 0;
      for (const q of p.patches || []) { const l = map.layers.find((x) => x.id === q.id); if (l) { updateLayer(l, q); n++; } }
      return n ? { changed: 'all' } : { changed: null };
    }
    case 'layer.removeMany': {
      const ids = new Set(p.ids || []);
      const gone = map.layers.filter((l) => ids.has(l.id));
      if (!gone.length) return { changed: null };
      map.layers = map.layers.filter((l) => !ids.has(l.id));
      for (const l of gone) detach(map, l);
      return { changed: 'all', label: gone.length === 1 ? `${gone[0].name} removed` : `${gone.length} removed` };
    }
    case 'layer.purge': { // things of any kind in one undo step (Layers: remove everything off the table)
      const ids = (k) => new Set(Array.isArray(p[k]) ? p[k] : []);
      const L = ids('layers'); const F = ids('fx'); const Sp = ids('spells'); const M = ids('marks'); const Dr = ids('draw');
      const gone = map.layers.filter((l) => L.has(l.id));
      const n = gone.length + map.fx.filter((f) => F.has(f.id)).length + map.spells.filter((s) => Sp.has(s.id)).length
        + map.marks.filter((m) => M.has(m.id)).length + map.draw.filter((d) => Dr.has(d.id)).length;
      if (!n) return { changed: null };
      map.layers = map.layers.filter((l) => !L.has(l.id));
      for (const l of gone) detach(map, l);
      map.fx = map.fx.filter((f) => !F.has(f.id));
      map.spells = map.spells.filter((s) => !Sp.has(s.id));
      map.marks = map.marks.filter((m) => !M.has(m.id));
      map.draw = map.draw.filter((d) => !Dr.has(d.id));
      return { changed: 'all', label: n === 1 ? '1 thing removed' : `${n} things removed` };
    }
    case 'layer.duplicate': {
      const l = map.layers.find((x) => x.id === p.id);
      if (!l) return { changed: null };
      const copy = { ...structuredClone(l), id: newId('l') };
      if (copy.role === 'token' || copy.role === 'asset') { copy.x += p.dx ?? 0; copy.y += p.dy ?? 0; }
      if (copy.role === 'token') { delete copy.n; if (!copy.named) numberToken(map, copy); }
      if (copy.role === 'asset') copy.locked = false;
      if (copy.tree) copy.tree.seed = newSeed(); // (Beta 3.20: a copy of a living tree is a tree of its own)
      map.layers.splice(map.layers.indexOf(l) + 1, 0, copy);
      return { changed: 'all', selected: copy.id, label: 'Duplicated' };
    }
    case 'layer.remove': {
      const l = map.layers.find((x) => x.id === p.id);
      if (!l) return { changed: null };
      map.layers = map.layers.filter((x) => x.id !== p.id);
      if (l.fixture) map.fx = map.fx.filter((x) => x.id !== l.fixture.fx); // (Beta 3.49: a light's flame goes with it)
      detach(map, l);
      return { changed: 'all', label: `${l.name} removed` };
    }
    case 'layer.order': {
      const i = map.layers.findIndex((x) => x.id === p.id);
      if (i < 0) return { changed: null };
      const [l] = map.layers.splice(i, 1);
      if (p.to === 'front') map.layers.push(l);
      else if (p.to === 'back') map.layers.unshift(l);
      else map.layers.splice(Math.max(0, Math.min(map.layers.length, i + (p.dir > 0 ? 1 : -1))), 0, l);
      return { changed: 'all' };
    }

    // ---------- grid ----------
    case 'grid.update':
      Object.assign(map.grid, pick(p, ['type', 'size', 'angle', 'ox', 'oy', 'show', 'color', 'opacity', 'width', 'under']));
      if ('unit' in p) { const u = gridUnit(p.unit); if (u) map.grid.unit = u; else delete map.grid.unit; } // (Beta 3.11)
      map.grid.under = !!map.grid.under;
      map.grid.size = Math.max(0.05, Number(map.grid.size) || 1);
      return { changed: 'all' };

    // ---------- fog ----------
    case 'fog.enabled': // only shown or hidden: the fog itself is not sent again (2.2)
      if (map.fog.enabled === !!p.enabled) return { changed: null };
      map.fog.enabled = !!p.enabled;
      return { changed: 'all', label: map.fog.enabled ? 'Fog on' : 'Fog off' };
    case 'fog.bake': { // many older fog steps folded into one picture by the GM screen (2.2): same fog, much faster
      const ops = map.fog.ops;
      const n = Math.floor(Number(p.n) || 0);
      const M = p.mask || {};
      if (n < 2 || n > ops.length || ops[0].id !== p.first || ops[n - 1].id !== p.last) return { changed: null };
      if (![M.x, M.y, M.w, M.h].every(Number.isFinite) || M.w <= 0 || M.h <= 0 || !/^data:image\/png;base64,/.test(M.png || '')) return { changed: null };
      const op = { id: newId('f'), mode: 'cover', shape: 'mask', x: M.x, y: M.y, w: M.w, h: M.h, rot: 0, png: M.png };
      map.fog.ops = [op, ...ops.slice(n)];
      return { changed: 'all', fog: true };
    }
    case 'fog.base':
      map.fog.base = p.base === 'clear' ? 'clear' : 'cover';
      map.fog.ops = [];
      map.fog.enabled = true;
      return { changed: 'all', fog: true, label: p.base === 'clear' ? 'Everything revealed' : 'Everything covered' };
    case 'fog.op': {
      const shape = p.shape === 'circle' ? 'circle' : p.shape === 'poly' ? 'poly' : 'rect';
      const op = { id: newId('f'), mode: p.mode === 'cover' ? 'cover' : 'reveal', shape };
      if (shape === 'rect') Object.assign(op, { x: p.x, y: p.y, w: p.w, h: p.h });
      else if (shape === 'poly') { // a room or a marked area; anim: where the reveal spreads from
        op.rings = cleanRings(p.rings);
        if (!op.rings.length) return { changed: null };
        if (p.anim && Number.isFinite(p.anim.x)) op.anim = { x: p.anim.x, y: p.anim.y };
        if (p.name) op.name = String(p.name).slice(0, 60);
      } else Object.assign(op, { x: p.x, y: p.y, r: p.r });
      if (!map.fog.enabled) map.fog.enabled = true;
      map.fog.ops.push(op);
      return { changed: 'fog', fogDelta: { op }, label: op.name ? `${op.name} ${op.mode === 'cover' ? 'covered' : 'revealed'}` : null };
    }
    // ---------- areas: parts of the map marked out in advance, revealed in one click ----------
    case 'area.add': {
      const rings = cleanRings(p.rings);
      if (!rings.length) return { changed: null };
      const n = map.areas.length + 1;
      const area = { id: newId('a'), name: String(p.name || `Area ${n}`).slice(0, 60), rings };
      map.areas.push(area);
      return { changed: 'all', selected: area.id, label: `${area.name} marked` };
    }
    case 'area.update': {
      const a = map.areas.find((x) => x.id === p.id);
      if (!a) return { changed: null };
      if (p.name != null) a.name = String(p.name).trim().slice(0, 60) || a.name;
      return { changed: 'all' };
    }
    case 'area.remove': {
      const a = map.areas.find((x) => x.id === p.id);
      if (!a) return { changed: null };
      map.areas = map.areas.filter((x) => x !== a);
      return { changed: 'all', label: `${a.name} removed` };
    }
    case 'fog.stroke': {
      let op = map.fog.ops.find((o) => o.id === p.id);
      if (!op) {
        op = { id: p.id, mode: p.mode === 'cover' ? 'cover' : 'reveal', shape: 'brush', r: p.r, pts: [] };
        map.fog.ops.push(op);
      }
      const prev = op.pts.length ? op.pts.slice(-2) : null;
      op.pts.push(...p.pts);
      return { changed: 'fog', fogDelta: { stroke: { id: op.id, mode: op.mode, r: op.r, prev, pts: p.pts } } };
    }

    // ---------- atmosphere effects and lights ----------
    case 'fx.add': {
      const fx = {
        id: newId('x'), kind: p.kind === 'light' ? 'light' : p.kind === 'region' ? 'region' : 'emitter',
        preset: String(p.preset || 'glow'), x: p.x ?? 0, y: p.y ?? 0, r: p.r ?? 1,
        color: p.color || null, intensity: p.intensity ?? 1, hidden: false, attachTo: p.attachTo || null,
        density: p.density ?? 1, speed: p.speed ?? 1,
      };
      if (p.sat != null) fx.sat = Math.min(1, Math.max(0, Number(p.sat) || 0)); // how strongly its light colours the map
      // Beta 2: which way it faces (light shaft, arcs, a bullseye lantern), what kind (a vent), how its light lives
      if (p.angle != null) fx.angle = normDeg(p.angle);
      if (p.variant) fx.variant = String(p.variant).slice(0, 20);
      if (p.wave) fx.wave = ['pulse', 'sputter'].includes(p.wave) ? p.wave : null;
      if (p.cone) fx.cone = Math.min(180, Math.max(10, Number(p.cone) || 53));
      if (p.dust != null) fx.dust = Math.min(12, Math.max(0.05, Number(p.dust) || 1)); // 4.3.2: the dust in a light shaft
      // 4.9: a window light: the window's shape, its bars, how far it reaches
      if (p.shape) fx.shape = String(p.shape).slice(0, 20);
      if (p.grid) fx.grid = String(p.grid).slice(0, 20);
      if (p.stretch != null) fx.stretch = Math.min(3, Math.max(1, Number(p.stretch) || 1.5));
      if (fx.kind === 'light') Object.assign(fx, { bright: p.bright ?? 20, dim: p.dim ?? 40, flicker: p.flicker ?? true, color: p.color || '#ffb45a' });
      // flames also light up a dark map
      if (fx.kind === 'emitter' && p.bright) Object.assign(fx, { bright: p.bright, dim: p.dim ?? p.bright * 2, flicker: true });
      if (fx.kind === 'region') fx.strokes = [];
      // the party: what it carries, darkvision, how far it sees, locked to the grid
      if (fx.kind === 'light' && fx.preset === 'party') Object.assign(fx, partyFields(fx, p));
      if (p.byPhone) fx.eye = true; // (Prototype 14: a player's eye: it sits on the token and can't be grabbed off it)
      map.fx.push(fx);
      return { changed: 'all', selected: fx.id, label: fx.kind === 'light' ? 'Light added' : 'Effect added' };
    }
    case 'fx.update': {
      const fx = map.fx.find((x) => x.id === p.id);
      if (!fx) return { changed: null };
      Object.assign(fx, pick(p, ['x', 'y', 'r', 'color', 'intensity', 'hidden', 'bright', 'dim', 'flicker', 'attachTo', 'preset', 'density', 'speed', 'sat', 'variant', 'cone']));
      if ('angle' in p) fx.angle = normDeg(p.angle);
      if ('eye' in p) fx.eye = !!p.eye;
      if ('wave' in p) fx.wave = ['pulse', 'sputter'].includes(p.wave) ? p.wave : null;
      if ('dust' in p) fx.dust = Math.min(12, Math.max(0.05, Number(p.dust) || 1));
      if (p.shape) fx.shape = String(p.shape).slice(0, 20);
      if (p.grid) fx.grid = String(p.grid).slice(0, 20);
      if ('stretch' in p) fx.stretch = Math.min(3, Math.max(1, Number(p.stretch) || 1.5));
      if (fx.preset === 'party') Object.assign(fx, partyFields(fx, p));
      return { changed: 'all' };
    }
    case 'fx.stroke': { // painted areas (mist, water, lava ...)
      let fx = map.fx.find((x) => x.id === p.id);
      if (!fx) {
        fx = { id: p.id, kind: 'region', preset: String(p.preset || 'mist'), strokes: [], intensity: p.intensity ?? 1, hidden: false, color: p.color || null, density: p.density ?? 1, speed: p.speed ?? 1 };
        map.fx.push(fx);
      }
      let s = fx.strokes.find((x) => x.sid === p.sid);
      if (!s) { s = { sid: p.sid, r: p.r, pts: [], t0: Date.now() }; fx.strokes.push(s); }
      s.pts.push(...p.pts);
      return { changed: 'all' };
    }
    case 'fx.shape': { // Beta 3.41: a painted effect as a box or a round, dragged on the grid
      const w = Number(p.w); const hh = Number(p.h); const x = Number(p.x); const y = Number(p.y);
      if (!(w > 0 && hh > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { changed: null };
      let fx = map.fx.find((f) => f.id === p.id);
      if (!fx) {
        fx = { id: p.id, kind: 'region', preset: String(p.preset || 'mist'), strokes: [], intensity: p.intensity ?? 1, hidden: false, color: p.color || null, density: p.density ?? 1, speed: p.speed ?? 1 };
        map.fx.push(fx);
      }
      if (fx.kind !== 'region') return { changed: null };
      // (its outline, filled: where it shows; and dots inside it for what moves in it)
      // (no time of painting: a box of blood lies there at once, it does not spread out dab by dab)
      const made = groundStrokes({ shape: p.shape === 'round' ? 'round' : 'rect', pts: [[x, y], [x + w, y + hh]] }, (map.grid && map.grid.size) || 1);
      // which way it flows (a river, wind over grass): along its longer side, toward where it was dragged. A line
      // through its middle, as if painted with a brush as wide as the shape
      const horiz = w >= hh; const lr = Math.min(w, hh) / 2; const cx = x + w / 2; const cy = y + hh / 2;
      const half = Math.max((horiz ? w : hh) / 2 - lr, Math.max(w, hh) * 0.25) * ((horiz ? Number(p.dx) : Number(p.dy)) < 0 ? -1 : 1);
      made[0].line = (horiz ? [cx - half, cy, cx + half, cy] : [cx, cy - half, cx, cy + half]).map(r3); made[0].lr = r3(lr);
      for (const st of made) fx.strokes.push({ ...st, sid: `${p.sid}-${st.sid}` });
      return { changed: 'all', label: 'Effect painted' };
    }
    case 'fx.cut': { // Beta 3.41: Erase. A brush line (p.pts, piece p.n of the stroke p.sid) or a box or a round takes away
      // what was painted there before, in every painted area it reaches; an area with nothing left goes
      let cut;
      if (p.shape) {
        const w = Number(p.w); const hh = Number(p.h); const x = Number(p.x); const y = Number(p.y);
        if (!(w > 0 && hh > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { changed: null };
        cut = { sid: String(p.sid), r: 0, poly: true, cut: true, pts: groundStrokes({ shape: p.shape === 'round' ? 'round' : 'rect', pts: [[x, y], [x + w, y + hh]] }, 1)[0].pts };
      } else {
        const pts = (Array.isArray(p.pts) ? p.pts : []).map(Number);
        if (pts.length < 2 || pts.length % 2 || pts.some((v) => !Number.isFinite(v)) || !(p.r > 0)) return { changed: null };
        cut = { sid: String(p.sid), r: r3(p.r), cut: true, pts: pts.map(r3), n: Number(p.n) || 0 };
      }
      const cb = strokesBox([cut]);
      let n = 0; const gone = [];
      for (const fx of map.fx) {
        if (fx.kind !== 'region' || fx.os || !fx.strokes) continue;
        const b = strokesBox(fx.strokes.filter((st) => !st.cut));
        if (!b || b.x1 < cb.x0 || b.x0 > cb.x1 || b.y1 < cb.y0 || b.y0 > cb.y1) continue;
        const last = fx.strokes[fx.strokes.length - 1];
        if (!cut.poly && last && last.cut && !last.poly && last.sid === cut.sid && last.n === cut.n - 1) { last.pts.push(...cut.pts.slice(2)); last.n = cut.n; } // (the stroke goes on)
        else fx.strokes.push({ ...cut, pts: cut.pts.slice() });
        n++;
        if (!regionLeft(fx, (map.grid && map.grid.size) || 1)) gone.push(fx.id);
      }
      if (!n) return { changed: null };
      if (gone.length) map.fx = map.fx.filter((f) => !gone.includes(f.id));
      return { changed: 'all', label: 'Effect erased' };
    }
    // Beta 3.49: a light that comes with the app: its unlit picture (an asset) and what burns on it (the app's own
    // flame or glow, with a light that walls stop), made together and kept together: moved, the light goes along;
    // removed, both go. p: { kind, x, y, rotation, color, lit }
    case 'fx.fixture': {
      const d = lightOf(String(p.kind || ''));
      if (!d || !media) return { changed: null };
      const g = map.grid.size || 1;
      const layer = { id: newId('l'), role: 'asset', kind: 'image', ...media(d.path), ...ASSET_DEFAULTS, x: r3(+p.x || 0), y: r3(+p.y || 0), w: r3(d.w * g), rotation: normDeg(Number(p.rotation) || 0), name: d.label, named: true };
      const color = HEX6.test(String(p.color || '').toLowerCase()) ? String(p.color).toLowerCase() : d.fx.color || null;
      const fx = { id: newId('x'), kind: 'emitter', preset: d.fx.preset, x: layer.x, y: layer.y, r: d.fx.r, color, intensity: 1, hidden: p.lit === false, attachTo: null, density: 1, speed: 1, bright: d.fx.bright, dim: d.fx.dim, flicker: true, fixture: layer.id };
      layer.fixture = { kind: d.id, fx: fx.id };
      fixStretch(layer);
      map.layers.push(layer); map.fx.push(fx);
      return { changed: 'all', label: `${d.label} placed`, id: layer.id };
    }
    case 'fx.fixtureLit': { // lit or put out (p.id: the picture's or the effect's id; p.on: which, else the other of now)
      const layer = map.layers.find((x) => x.fixture && (x.id === p.id || x.fixture.fx === p.id));
      if (!layer) return { changed: null };
      const d = lightOf(layer.fixture.kind);
      let fx = map.fx.find((x) => x.id === layer.fixture.fx);
      const on = p.on === undefined ? !(fx && !fx.hidden) : !!p.on;
      if (!fx && d) { // (its flame was removed by hand: a new one)
        fx = { id: newId('x'), kind: 'emitter', preset: d.fx.preset, x: layer.x, y: layer.y, r: d.fx.r, color: d.fx.color || null, intensity: 1, hidden: true, attachTo: null, density: 1, speed: 1, bright: d.fx.bright, dim: d.fx.dim, flicker: true, fixture: layer.id };
        layer.fixture.fx = fx.id; map.fx.push(fx);
      }
      if (!fx || !fx.hidden === on) return { changed: null };
      fx.hidden = !on;
      return { changed: 'all', label: `${layer.name || 'Light'} ${on ? 'lit' : 'put out'}` };
    }
    case 'fx.remove': {
      const fx = map.fx.find((x) => x.id === p.id);
      if (!fx) return { changed: null };
      map.fx = map.fx.filter((x) => x.id !== p.id);
      return { changed: 'all', label: fx.kind === 'light' ? 'Light removed' : 'Effect removed' };
    }
    case 'light.update': {
      const L = map.light;
      const changes = 'darkness' in p || 'tint' in p;
      // with fade (seconds) the windows ease from what is shown right now to the new light
      const fade = Math.min(120, Math.max(0, Number(p.fade) || 0));
      if (changes && fade) { const cur = Vision.lightNow(L); L.from = { darkness: cur.darkness, tint: cur.tint, t0: Date.now(), s: fade }; }
      else if (changes) delete L.from;
      Object.assign(L, pick(p, ['darkness', 'tint', 'memory', 'mood']));
      if (changes && !('mood' in p)) L.mood = null;
      L.darkness = Math.min(1, Math.max(0, Number(L.darkness) || 0));
      return { changed: 'all', label: p.mood && p.label ? p.label : null };
    }
    case 'light.forget':
      if (!map.light.seen.length) return { changed: null };
      map.light.seen = [];
      return { changed: 'all', label: 'Explored areas forgotten' };
    // ---------- weather ----------
    case 'weather.set': // older single-preset form, still understood
      return apply(map, 'weather.preset', { name: p.preset, layers: legacyLayers({ preset: p.preset, intensity: p.intensity, wind: p.wind }) }, media);
    case 'weather.preset': { // replace the whole mix; with a fade the old layers fade out while the new ones come in
      const now = Date.now();
      const fade = map.weather.fade > 0;
      for (const L of map.weather.layers) if (!L.dying) L.dying = now;
      if (!fade) map.weather.layers = [];
      map.weather.layers.push(...(p.layers || []).map((q) => weatherLayer({ ...q, id: null }, fade ? now : 0)));
      map.weather.name = String(p.name || (p.layers && p.layers.length ? 'Custom' : 'None')).slice(0, 40);
      return { changed: 'all', label: p.layers && p.layers.length ? `Weather: ${map.weather.name}` : 'Weather off' };
    }
    case 'weather.add': {
      const L = weatherLayer(p, map.weather.fade > 0 ? Date.now() : 0);
      map.weather.layers.push(L);
      map.weather.name = 'Custom';
      return { changed: 'all', selected: L.id };
    }
    case 'weather.update': {
      const L = map.weather.layers.find((x) => x.id === p.id);
      if (!L) return { changed: null };
      // a new speed or direction goes on from where the wind has carried things so far (nothing jumps)
      const now = Date.now();
      const was = FXDATA.wxTravel(L, now / 1000 - FXDATA.TBASE);
      const before = [L.speed, L.dir];
      Object.assign(L, pick(p, WEATHER_KEYS));
      if (L.speed !== before[0] || L.dir !== before[1]) L.anc = { at: now, x: was.x, y: was.y, s: was.s };
      return { changed: 'all' };
    }
    case 'weather.remove': {
      const L = map.weather.layers.find((x) => x.id === p.id && !x.dying);
      if (!L) return { changed: null };
      if (map.weather.fade > 0) L.dying = Date.now(); else map.weather.layers = map.weather.layers.filter((x) => x !== L);
      map.weather.name = 'Custom';
      return { changed: 'all' };
    }
    case 'weather.fade':
      map.weather.fade = Math.max(0, Math.min(120, Number(p.fade) || 0));
      return { changed: 'all' };

    // ---------- the wind in the living trees (Beta 3.20) ----------
    case 'wind.set': {
      const before = JSON.stringify(map.wind);
      map.wind = cleanWind({ ...map.wind, ...pick(p, ['auto', 'storm', 'dir', 'strength', 'lean', 'branches', 'rustle']) });
      if (JSON.stringify(map.wind) === before) return { changed: null };
      return { changed: 'all' };
    }
    case 'live.set': { // (Beta 3.42) what moves on the map: on or off; (3.46) { fx, set }: one kind of effect's own settings
      const before = JSON.stringify(map.live);
      const next = { ...map.live, ...pick(p, ['on']) };
      if (LIVE_SPEC[p.fx] && p.set && typeof p.set === 'object') next[p.fx] = { ...map.live[p.fx], ...p.set };
      map.live = cleanLive(next);
      if (JSON.stringify(map.live) === before) return { changed: null };
      return { changed: 'all' };
    }
    case 'wind.storm': {
      map.wind = cleanWind({ ...map.wind, storm: 'on' in p ? !!p.on : !map.wind.storm });
      return { changed: 'all', label: map.wind.storm ? 'Storm in the trees' : 'The storm has passed' };
    }

    // ---------- spell areas ----------
    case 'spell.add': {
      const now = Date.now();
      const sp = {
        id: newId('s'), name: String(p.name || 'Spell').slice(0, 60),
        shape: ['sphere', 'cylinder', 'cone', 'line', 'cube', 'aura'].includes(p.shape) ? p.shape : 'sphere',
        x: p.x ?? 0, y: p.y ?? 0, angle: p.angle ?? 0, size: Math.max(5, p.size ?? 20), width: Math.max(1, p.width ?? 5),
        skin: String(p.skin || 'arcane'), mode: p.mode === 'stay' ? 'stay' : 'burst',
        squares: p.squares !== false, attachTo: p.attachTo || null, rounds: Number.isFinite(p.rounds) ? p.rounds : null, hidden: false,
        color: p.color || null, muted: !!p.muted,
        duration: Number.isFinite(p.duration) && p.duration > 0 ? Math.round(p.duration) : null, // rounds; Next round ends it
        t0: now, expires: p.mode === 'stay' ? null : now + (p.hold ?? 8000),
      };
      if (sp.duration && sp.rounds == null) sp.rounds = 1;
      map.spells.push(sp);
      return { changed: 'all', selected: sp.id, label: `${sp.name} cast` };
    }
    case 'spell.update': {
      const sp = map.spells.find((x) => x.id === p.id);
      if (!sp) return { changed: null };
      Object.assign(sp, pick(p, ['x', 'y', 'angle', 'size', 'width', 'skin', 'mode', 'squares', 'attachTo', 'rounds', 'hidden', 'name', 'shape', 'color', 'muted']));
      if ('duration' in p) { sp.duration = Number.isFinite(p.duration) && p.duration > 0 ? Math.round(p.duration) : null; if (sp.duration && sp.rounds == null) sp.rounds = 1; }
      if ('mode' in p) sp.expires = sp.mode === 'stay' ? null : Date.now() + (p.hold ?? 8000);
      return { changed: 'all' };
    }
    case 'spell.burst': { // play the cast animation again
      const sp = map.spells.find((x) => x.id === p.id);
      if (!sp) return { changed: null };
      sp.t0 = Date.now();
      if (sp.mode === 'burst') sp.expires = sp.t0 + (p.hold ?? 8000);
      return { changed: 'all' };
    }
    case 'spell.remove': {
      const sp = map.spells.find((x) => x.id === p.id);
      if (!sp) return { changed: null };
      map.spells = map.spells.filter((x) => x.id !== p.id);
      return { changed: 'all', label: `${sp.name} removed` };
    }
    case 'spell.clear':
      if (!map.spells.length) return { changed: null };
      map.spells = [];
      return { changed: 'all', label: 'All spell areas cleared' };

    // ---------- drawings: pen strokes (stay with the map) and text labels ----------
    case 'draw.stroke': {
      let d = map.draw.find((x) => x.id === p.id);
      if (!d) {
        d = { id: p.id || newId('d'), kind: 'pen', color: String(p.color || '#ffffff'), w: Math.max(0.005, Number(p.w) || 0.1), pts: [], hidden: false };
        map.draw.push(d);
      }
      if (d.kind !== 'pen') return { changed: null };
      d.pts.push(...(p.pts || []).map((v) => Math.round(v * 1000) / 1000));
      return { changed: 'all' };
    }
    case 'draw.add': {
      const text = String(p.text || '').trim().slice(0, 200);
      if (!text) return { changed: null };
      const d = { id: newId('d'), kind: 'text', x: p.x ?? 0, y: p.y ?? 0, text, color: String(p.color || '#ffffff'), size: Math.max(0.1, Number(p.size) || 0.5), hidden: !!p.hidden };
      map.draw.push(d);
      return { changed: 'all', selected: d.id, label: 'Label added' };
    }
    case 'draw.update': {
      const d = map.draw.find((x) => x.id === p.id);
      if (!d) return { changed: null };
      Object.assign(d, pick(p, ['x', 'y', 'text', 'color', 'size', 'hidden', 'w']));
      return { changed: 'all' };
    }
    case 'draw.remove': {
      const ids = new Set(p.ids || [p.id]);
      const before = map.draw.length;
      map.draw = map.draw.filter((d) => !ids.has(d.id));
      const n = before - map.draw.length;
      return n ? { changed: 'all', label: n === 1 ? 'Erased' : `${n} drawings erased` } : { changed: null };
    }
    case 'draw.clear':
      if (!map.draw.length) return { changed: null };
      map.draw = [];
      return { changed: 'all', label: 'Drawings cleared' };

    // ---------- marks: pins, crosses, numbered dots, counters, GM notes ----------
    case 'mark.add': {
      const kind = MARK_KINDS.includes(p.kind) ? p.kind : 'pin';
      const m = { id: newId('k'), kind, x: p.x ?? 0, y: p.y ?? 0, color: String(p.color || '#e3963e'), hidden: !!p.hidden };
      if (kind === 'dot') m.n = Number.isFinite(p.n) ? p.n : Math.max(0, ...map.marks.filter((x) => x.kind === 'dot').map((x) => x.n || 0)) + 1;
      if (kind === 'counter') Object.assign(m, { label: String(p.label || 'Counter').slice(0, 40), value: Math.round(num(p.value, 0)), auto: ['up', 'down'].includes(p.auto) ? p.auto : null });
      if (kind === 'note') m.text = String(p.text || '').slice(0, 600);
      if (kind === 'place') Object.assign(m, { style: PLACE_STYLES.includes(p.style) ? p.style : 'medallion', icon: placeIcon(p.icon), title: short(p.title, 60) || 'New place', sub: short(p.sub, 80), to: typeof p.to === 'string' ? p.to : null, note: String(p.note || '').slice(0, 600), ho: p.ho && p.ho.path && media ? media(String(p.ho.path)) : null });
      if (kind === 'route') { Object.assign(m, { title: short(p.title, 60), pts: [r3(m.x), r3(m.y)], look: 'dash', width: 2, arrow: true, round: true, walked: 0 }); routeLook(m, p); }
      map.marks.push(m);
      const what = { pin: 'Pin', x: 'Cross', dot: `Marker ${m.n}`, counter: m.label, note: 'Note', place: m.title, route: 'Route' }[kind];
      return { changed: 'all', selected: m.id, label: `${what} added` };
    }
    case 'mark.update': {
      const m = map.marks.find((x) => x.id === p.id);
      if (!m) return { changed: null };
      const was = { x: m.x, y: m.y };
      Object.assign(m, pick(p, ['x', 'y', 'color', 'label', 'value', 'auto', 'text', 'hidden', 'n']));
      if (m.kind === 'counter') { m.value = Math.round(num(m.value, 0)); if (!['up', 'down'].includes(m.auto)) m.auto = null; }
      if (m.kind === 'place') {
        if ('title' in p) m.title = short(p.title, 60) || m.title;
        if ('style' in p && PLACE_STYLES.includes(p.style)) m.style = p.style; // (Beta 3.12: how it looks: a medallion, a diamond or a pin; and its icon)
        if ('icon' in p) m.icon = placeIcon(p.icon);
        if ('sub' in p) m.sub = short(p.sub, 80);
        if ('to' in p) m.to = typeof p.to === 'string' ? p.to : null;
        if ('note' in p) m.note = String(p.note || '').slice(0, 600);
        if ('ho' in p) m.ho = p.ho && p.ho.path && media ? media(String(p.ho.path)) : null; // (a handout from the library: it travels with the campaign)
      }
      if (m.kind === 'route') {
        if ('title' in p) m.title = short(p.title, 60);
        routeLook(m, p);
        // moved by its label: the whole route goes along
        const dx = m.x - was.x; const dy = m.y - was.y;
        if (dx || dy) { for (let i = 0; i < m.pts.length; i += 2) { m.pts[i] = r3(m.pts[i] + dx); m.pts[i + 1] = r3(m.pts[i + 1] + dy); } Object.assign(m, routeMid(m.pts)); }
      }
      return { changed: 'all' };
    }
    case 'atlasmap.set': atlasMapSet(map, p); return { changed: 'all' }; // (Beta 3.12)
    case 'mark.route': { // (Beta 3.11) a route grows by a point, or loses its last one (back: true). (Beta 3.14) One of its points is moved (at: which one), a point is put in before one (insert: which one), or one is taken out (remove)
      const m = map.marks.find((x) => x.id === p.id && x.kind === 'route');
      if (!m) return { changed: null };
      const n = m.pts.length / 2; const idx = (v) => (Number.isInteger(v) && v >= 0 && v < n ? v : -1);
      const pos = () => [r3(num(p.x, 0)), r3(num(p.y, 0))];
      let label = 'Route drawn';
      if (p.back) { if (m.pts.length <= 2) return { changed: null }; m.pts.length -= 2; label = 'Route shortened'; }
      else if ('at' in p) { const i = idx(p.at); if (i < 0) return { changed: null }; [m.pts[i * 2], m.pts[i * 2 + 1]] = pos(); label = 'Route changed'; }
      else if ('remove' in p) { const i = idx(p.remove); if (i < 0 || n <= 2) return { changed: null }; m.pts.splice(i * 2, 2); label = 'Route changed'; }
      else if ('insert' in p) { const i = Number.isInteger(p.insert) && p.insert >= 0 && p.insert <= n ? p.insert : -1; if (i < 0 || m.pts.length >= 400) return { changed: null }; m.pts.splice(i * 2, 0, ...pos()); label = 'Route changed'; }
      else { if (m.pts.length >= 400) return { changed: null }; m.pts.push(...pos()); }
      Object.assign(m, routeMid(m.pts)); // (its label stands at its middle)
      return { changed: 'all', label };
    }
    case 'mark.remove': {
      const m = map.marks.find((x) => x.id === p.id);
      if (!m) return { changed: null };
      map.marks = map.marks.filter((x) => x.id !== p.id);
      return { changed: 'all', label: m.kind === 'note' ? 'Note removed' : m.kind === 'counter' ? `${m.label} removed` : m.kind === 'place' ? `${m.title} removed` : m.kind === 'route' ? 'Route removed' : 'Marker removed' };
    }
    case 'mark.clear': {
      const kinds = new Set(p.kinds || MARK_KINDS);
      const before = map.marks.length;
      map.marks = map.marks.filter((m) => !kinds.has(m.kind));
      return map.marks.length === before ? { changed: null } : { changed: 'all', label: 'Markers cleared' };
    }

    // ---------- Beta 3.22: Oldschool maps: the drawing ----------
    case 'os.add': { // one thing drawn (or erased): p.item, or several: p.items (Beta 3.23: with doors, a ready-made piece)
      if (!map.os) return { changed: null };
      const list = (p.items || [p.item]).map(cleanOsItem).filter(Boolean);
      if (!list.length) return { changed: null };
      map.os.items.push(...list);
      if (Array.isArray(p.doors) && p.doors.length) map.os.doors.push(...cleanOs({ doors: p.doors.slice(0, 200).map((d) => ({ ...d, id: newId('od') })) }).doors);
      const k = list[list.length - 1].kind;
      syncGround(map);
      return { changed: 'all', selected: list[list.length - 1].id, label: k === 'cut' ? 'Erased' : k === 'line' ? 'Wall drawn' : k === 'pillar' ? 'Pillar placed' : k === 'stairs' ? 'Stairs placed' : k === 'ground' ? 'Ground drawn' : k === 'paint' ? 'Floor painted' : k === 'live' ? (list[list.length - 1].fx === 'none' ? 'Effect erased' : `${list[list.length - 1].fx[0].toUpperCase()}${list[list.length - 1].fx.slice(1)} drawn`) : 'Floor drawn' };
    }
    case 'os.update': { // an area's tile, edge, material or level; any item's points
      if (!map.os) return { changed: null };
      const i = map.os.items.findIndex((x) => x.id === p.id);
      if (i < 0) return { changed: null };
      const mixing = 'mixW' in p || 'mixU' in p || 'mixT' in p ? { mix: undefined } : {}; // (a 3.26 floor set anew)
      const next = cleanOsItem({ ...map.os.items[i], ...mixing, ...pick(p, ['tile', 'edge', 'mat', 'level', 'pts', 'r', 'w', 'h', 'round', 'dir', 'preset', 'mixW', 'mixU', 'mixT']), id: p.id });
      if (!next) return { changed: null };
      map.os.items[i] = next;
      syncGround(map);
      return { changed: 'all', label: p.label || null };
    }
    case 'os.remove': {
      if (!map.os) return { changed: null };
      const ids = new Set([p.id, ...(p.ids || [])]);
      const n = map.os.items.length + map.os.doors.length;
      map.os.items = map.os.items.filter((x) => !ids.has(x.id));
      map.os.doors = map.os.doors.filter((x) => !ids.has(x.id));
      syncGround(map);
      return n !== map.os.items.length + map.os.doors.length ? { changed: 'all', label: 'Removed' } : { changed: null };
    }
    case 'os.door': { // a door, secret door or window on a drawn wall (the segment it covers)
      if (!map.os) return { changed: null };
      const d = cleanOs({ doors: [{ ...p, id: newId('od') }] }).doors[0];
      if (!d) return { changed: null };
      if (Array.isArray(p.replace)) { const gone = new Set(p.replace); map.os.doors = map.os.doors.filter((x) => !gone.has(x.id)); } // (Beta 3.33: the doors it lies over)
      map.os.doors.push(d);
      return { changed: 'all', label: d.kind === 'window' ? 'Window added' : d.door === 2 ? 'Secret door added' : 'Door added' };
    }
    case 'os.set': { // the map's sun (where the light comes from), and whether walls for sight follow the drawing
      if (!map.os) return { changed: null };
      if ('sun' in p) map.os.sun = Math.round(osNum(p.sun, 135, 0, 359));
      if ('sight' in p) map.os.sight = !!p.sight;
      if ('shadows' in p) map.os.shadowLen = SHADOW_LEN[p.shadows] ?? 0.35; // (Beta 3.25; 3.35: a length now)
      if ('shadowLen' in p) map.os.shadowLen = r3(osNum(p.shadowLen, 0.35, 0, 1));
      if ('shadowAll' in p) map.os.shadowAll = r3(osNum(p.shadowAll, 0, 0, 1));
      return { changed: 'all' };
    }
    case 'os.clear': {
      if (!map.os || (!map.os.items.length && !map.os.doors.length)) return { changed: null };
      map.os.items = []; map.os.doors = [];
      syncGround(map);
      return { changed: 'all', label: 'Drawing cleared' };
    }
    // the GM screen made the picture of the drawing: it becomes the map's picture, and its outlines the walls for sight
    // (doors keep whether they are open). Not an undo step of its own: undo brings the drawing back, and it is made again.
    case 'os.result': {
      if (!map.os) return { changed: null };
      if (p.bg) {
        map.bg = { ...media(p.bg.path), kind: 'image', x: r4g(p.bg.x), y: r4g(p.bg.y), scale: p.bg.scale, nw: p.bg.nw, nh: p.bg.nh, volume: 0, rate: 1, os: String(p.hash || '') };
        if (Array.isArray(p.ids)) map.bg.osIds = p.ids.map(String).slice(0, 5000); // (Beta 3.23) what the picture already shows (the TV inks the rest)
        // (Beta 3.25) the sharp tiles on top of the picture: P dots a square, ts squares across, at whole squares from
        // the grid's origin (c, r)
        if (p.bg.live) map.bg.live = media(p.bg.live); // (Beta 3.42) where its living tiles lie
        if (p.bg.sharp && p.bg.sharp.P > 0 && p.bg.sharp.ts > 0 && Array.isArray(p.bg.sharp.tiles)) map.bg.sharp = { P: p.bg.sharp.P, ts: p.bg.sharp.ts, tiles: p.bg.sharp.tiles.map((t) => ({ c: t.c, r: t.r, h: t.h, ...media(t.path) })) };
      }
      else if (p.empty) map.bg = null;
      if (Array.isArray(p.walls)) {
        const was = new Map(map.walls.filter((w) => w.os).map((w) => [w.os, w]));
        map.walls = map.walls.filter((w) => !w.os);
        if (map.os.sight) {
          for (const q of p.walls) {
            const w = wallOf(q.c || q, q.door || 0, q.kind);
            if (!w) continue;
            w.os = String(q.key || w.id);
            const old = was.get(w.os);
            if (old) { w.id = old.id; if (w.door || w.kind === 'window') { w.open = !!old.open; if (old.shut) w.shut = true; } }
            map.walls.push(w);
          }
        }
      }
      return { changed: 'all' };
    }

    // ---------- walls, doors and line of sight ----------
    case 'wall.add': { // one or more segments [x1, y1, x2, y2] (a chain of walls, a room, a door)
      const door = p.door === 2 ? 2 : p.door ? 1 : 0;
      const added = [];
      for (const q of p.segs || []) {
        const w = wallOf(q, door, p.kind);
        if (w) { map.walls.push(w); added.push(w); }
      }
      if (!added.length) return { changed: null };
      const mine = new Set(added.map((w) => w.id));
      for (const w of added) { joinAt(map, w.x1, w.y1, mine); joinAt(map, w.x2, w.y2, mine); } // (Prototype 14: T-joints)
      return { changed: 'all', selected: added[added.length - 1].id, label: door ? (door === 2 ? 'Secret door added' : 'Door added') : null, walls: added.map((w) => w.id) };
    }
    case 'wall.update': {
      const w = map.walls.find((x) => x.id === p.id);
      if (!w) return { changed: null };
      updateWall(w, p);
      return { changed: 'all' };
    }
    case 'wall.many': { // moving a corner moves every wall that meets there
      let n = 0;
      for (const q of p.patches || []) { const w = map.walls.find((x) => x.id === q.id); if (w) { updateWall(w, q); n++; } }
      return n ? { changed: 'all' } : { changed: null };
    }
    case 'wall.remove': {
      const ids = new Set(p.ids || [p.id]);
      const before = map.walls.length;
      map.walls = map.walls.filter((w) => !ids.has(w.id));
      const n = before - map.walls.length;
      return n ? { changed: 'all', label: n === 1 ? 'Wall removed' : `${n} walls removed` } : { changed: null };
    }
    case 'wall.clear':
      if (!map.walls.length) return { changed: null };
      map.walls = [];
      return { changed: 'all', label: 'All walls removed' };
    case 'wall.door': { // open or close a door (Beta 3.1: or a window: closed it stops sight and light, open it lets them through)
      const w = map.walls.find((x) => x.id === p.id && (x.door || x.kind === 'window'));
      if (!w) return { changed: null };
      if (!w.door) {
        const open = 'open' in p ? !!p.open : !!w.shut;
        if (open) delete w.shut; else w.shut = true;
        return { changed: 'all', label: open ? 'Window opened' : 'Window closed' };
      }
      w.open = 'open' in p ? !!p.open : !w.open;
      return { changed: 'all', label: w.open ? 'Door opened' : 'Door closed' };
    }
    case 'wall.split': { // put a door into a wall: the wall keeps its two ends, the door sits in between
      const w = map.walls.find((x) => x.id === p.id);
      if (!w || w.door) return { changed: null };
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const t0 = Math.max(0, Math.min(1, Number(p.t0))); const t1 = Math.max(0, Math.min(1, Number(p.t1)));
      if (!(L > 0) || !(t1 - t0 > 0.01)) return { changed: null };
      const at = (t) => [w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t];
      const [ax, ay] = at(t0); const [bx, by] = at(t1);
      const i = map.walls.indexOf(w);
      const parts = [];
      if (t0 * L > 0.02) parts.push(Object.assign(wallOf([w.x1, w.y1, ax, ay], 0, w.kind), w.shut ? { shut: true } : {}));
      const d = wallOf([ax, ay, bx, by], p.door === 2 ? 2 : 1);
      parts.push(d);
      if ((1 - t1) * L > 0.02) parts.push(Object.assign(wallOf([bx, by, w.x2, w.y2], 0, w.kind), w.shut ? { shut: true } : {}));
      map.walls.splice(i, 1, ...parts.filter(Boolean));
      return { changed: 'all', selected: d.id, label: p.door === 2 ? 'Secret door added' : 'Door added' };
    }
    case 'wall.import': // walls (and lights) from a file, already in map inches
      if (p.replace) { map.walls = []; map.fx = map.fx.filter((f) => !f.imported); } // a new walls file replaces what an older one brought
      for (const q of p.walls || []) { const w = wallOf(q, q[4] || 0); if (w) { if (q[5]) w.open = true; w.file = true; map.walls.push(w); } }
      for (const L of p.lights || []) map.fx.push({ id: newId('x'), kind: 'light', preset: 'light', x: L.x, y: L.y, r: 1, color: L.color || '#ffd9a0', intensity: L.intensity ?? 1, hidden: false, attachTo: null, density: 1, speed: 1, bright: L.bright, dim: L.dim, flicker: false, imported: true });
      if (p.grid) Object.assign(map.grid, pick(p.grid, ['type', 'size', 'angle', 'ox', 'oy']), { file: true });
      if (p.bg && map.bg) Object.assign(map.bg, pick(p.bg, ['x', 'y', 'scale', 'span']));
      map.vision.on = true;
      return { changed: 'all', label: p.label || `${(p.walls || []).length} walls loaded` };
    case 'vision.update':
      Object.assign(map.vision, pick(p, ['on', 'dim']));
      map.vision.on = !!map.vision.on;
      map.vision.dim = Math.min(0.95, Math.max(0, num(map.vision.dim, 0.5)));
      return { changed: 'all' };

    // ---------- rounds ----------
    case 'round.set':
      if ('n' in p) map.round.n = p.n == null ? null : Math.max(1, Math.round(Number(p.n) || 1));
      if ('show' in p) map.round.show = !!p.show;
      return { changed: 'all', label: 'n' in p ? (map.round.n == null ? 'Round counter stopped' : `Round ${map.round.n}`) : null };
    case 'round.next': {
      // the round counter, every spell area that counts rounds and every counter set to follow the rounds
      map.round.n = (map.round.n || 0) + 1;
      const ended = [];
      for (const sp of map.spells) {
        if (sp.rounds == null) continue;
        sp.rounds += 1;
        if (sp.duration && sp.rounds > sp.duration) ended.push(sp);
      }
      if (ended.length) map.spells = map.spells.filter((sp) => !ended.includes(sp));
      for (const m of map.marks) {
        if (m.kind !== 'counter' || !m.auto) continue;
        m.value = m.auto === 'up' ? m.value + 1 : Math.max(0, m.value - 1);
      }
      const tail = ended.length ? ` · ${ended.map((x) => x.name).join(', ')} ended` : '';
      return { changed: 'all', label: `Round ${map.round.n}${tail}`, ended: ended.map((x) => x.name) };
    }

    default:
      return { changed: null };
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
// Prototype 14: a window lets sight and light through, an invisible wall everything but feet (both stop movement)
const WALL_KINDS = ['window', 'invisible'];
function wallOf(q, door, kind) {
  const c = (Array.isArray(q) ? q.slice(0, 4) : [q.x1, q.y1, q.x2, q.y2]).map(Number);
  if (!c.every(Number.isFinite) || Math.hypot(c[2] - c[0], c[3] - c[1]) < 0.01) return null;
  const w = { id: newId('w'), x1: r3(c[0]), y1: r3(c[1]), x2: r3(c[2]), y2: r3(c[3]), door: door === 2 ? 2 : door ? 1 : 0, open: false };
  if (!w.door && WALL_KINDS.includes(kind)) w.kind = kind;
  return w;
}
// Prototype 14: a new wall that ends on the middle of another one joins it there: that wall is cut in two at that point
function joinAt(map, x, y, skip) {
  for (let i = 0; i < map.walls.length; i++) {
    const w = map.walls[i];
    if (w.door || skip.has(w.id)) continue;
    const ex = w.x2 - w.x1; const ey = w.y2 - w.y1; const L2 = ex * ex + ey * ey;
    if (!(L2 > 0)) continue;
    const t = ((x - w.x1) * ex + (y - w.y1) * ey) / L2;
    const L = Math.sqrt(L2);
    if (t * L < 0.03 || (1 - t) * L < 0.03) continue; // at its end already
    if (Math.hypot(w.x1 + ex * t - x, w.y1 + ey * t - y) > 0.02) continue;
    const a = wallOf([w.x1, w.y1, x, y], 0, w.kind); const b = wallOf([x, y, w.x2, w.y2], 0, w.kind);
    if (!a || !b) continue;
    if (w.shut) { a.shut = true; b.shut = true; } // (Beta 3.1: a closed window stays closed)
    if (w.file) { a.file = true; b.file = true; }
    map.walls.splice(i, 1, a, b);
    return true;
  }
  return false;
}
function updateWall(w, p) {
  for (const k of ['x1', 'y1', 'x2', 'y2']) if (k in p && Number.isFinite(Number(p[k]))) w[k] = r3(Number(p[k]));
  if ('door' in p) { w.door = p.door === 2 ? 2 : p.door ? 1 : 0; if (!w.door) w.open = false; if (w.door) delete w.kind; }
  if ('open' in p && w.door) w.open = !!p.open;
  if ('kind' in p && !w.door) { if (WALL_KINDS.includes(p.kind)) w.kind = p.kind; else delete w.kind; }
  if (w.kind !== 'window') delete w.shut; // (Beta 3.1: only a window is open or closed that way)
}

// What the party sees goes into the fog for good ("reveal and remember").
// Called after every map change: an eye that moved far enough, a door that opened,
// a light that came on (on dark maps) records the view again. last: Map eyeId -> what was recorded.
function recordSight(map, last, force, stepK = 0.75) { // (Prototype 23: stepK, how far in squares an eye moves before it sees anew)
  if (!map.fog.enabled) return [];
  const eyes = Vision.eyes(map);
  if (!eyes.length) return [];
  const walled = Vision.on(map);
  const sig = walled ? Vision.wallSig(map) : 'open';
  const dark = Vision.isDark(map);
  const litSig = dark ? JSON.stringify(Vision.lights(map, false).map((L) => [Math.round(L.x * 4), Math.round(L.y * 4), Math.round(L.D * 4)])) : '';
  const step = Math.max(0.2, (map.grid.size || 1) * stepK);
  const ops = [];
  for (const e of eyes) {
    const prev = last.get(e.id);
    const eyeSig = `${e.V}|${e.DV}|${e.D}`;
    const moved = !prev || Math.hypot(prev.x - e.x, prev.y - e.y) >= (force ? 0.01 : step);
    // still in the fog: not cleared by "Cover all" or taken back by undo
    const kept = prev && map.fog.ops.some((o) => o.id === prev.op);
    if (prev && kept && !moved && prev.sig === sig && prev.lit === litSig && prev.eye === eyeSig) continue;
    const s = Vision.sight(map, e, sig, walled);
    const rnd = (pts) => pts.map((v) => Math.round(v * 100) / 100);
    const op = { id: newId('v'), mode: 'reveal', shape: 'sight', pts: rnd(s.pts), lit: s.lit ? s.lit.map(rnd) : null, eye: e.id }; // (Prototype 14: whose sight)
    map.fog.ops.push(op);
    ops.push(op);
    last.set(e.id, { x: e.x, y: e.y, sig, lit: litSig, eye: eyeSig, op: op.id });
  }
  return ops;
}

// The party's settings (a party light: kind 'light', preset 'party').
// carry: the light it carries (sets bright and dim), darkvision and range in feet (range 0: as far as walls allow), snap: on the grid.
const CARRY = { none: [0, 0], candle: [5, 10], torch: [20, 40], lantern: [30, 60], light: [20, 40], daylight: [60, 120] };
function partyFields(base, p) {
  const o = {};
  const ft = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  if (CARRY[p.carry]) {
    o.carry = p.carry;
    o.bright = CARRY[p.carry][0]; o.dim = CARRY[p.carry][1];
  } else if (p.carry === 'custom') {
    o.carry = 'custom'; // (Prototype 17: a player's own light: bright and dim come with it)
  } else if (!('carry' in base)) {
    // placed with a light of its own (Effects → Party light): the carried light that matches it, if any
    const hit = Object.keys(CARRY).find((k) => CARRY[k][0] === (base.bright || 0) && CARRY[k][1] === (base.dim || 0));
    o.carry = hit || 'custom';
  }
  if ('darkvision' in p || !('darkvision' in base)) o.darkvision = ft(p.darkvision ?? base.darkvision, 300);
  if ('range' in p || !('range' in base)) o.range = ft(p.range ?? base.range, 600);
  if ('snap' in p || !('snap' in base)) o.snap = 'snap' in p ? !!p.snap : base.snap !== false;
  if (p.name != null) o.name = String(p.name).trim().slice(0, 40) || base.name || 'Party';
  else if (!base.name) o.name = 'Party';
  return o;
}

// Removing a token leaves attached auras and lights where the token was.
function detach(map, token) {
  map.fx = map.fx.filter((f) => !(f.eye && f.attachTo === token.id)); // (Prototype 17: a player's eye goes with the token)
  for (const it of [...map.fx, ...map.spells]) {
    if (it.attachTo === token.id) { it.attachTo = null; it.x = token.x; it.y = token.y; }
  }
}

// "Remember lit areas": ground a light has reached stays faintly visible in the dark.
// Stores circles (map inches) for every light position; returns true if anything was added.
function recordSeen(map) {
  const L = map.light;
  if (!L || !L.memory || !(L.darkness > 0)) return false;
  const ftIn = (ft) => (ft / 5) * map.grid.size;
  let added = false;
  for (const f of map.fx) {
    const lit = f.kind === 'light' || (f.kind === 'emitter' && f.bright > 0);
    if (!lit || f.hidden) continue;
    let x = f.x; let y = f.y;
    if (f.attachTo) { const t = map.layers.find((l) => l.id === f.attachTo); if (t) { x = t.x; y = t.y; } }
    const r = ftIn(Math.max(f.dim || 0, f.bright || 0));
    if (!(r > 0)) continue;
    const covered = L.seen.some((c) => c.r >= r * 0.9 && Math.hypot(c.x - x, c.y - y) < r * 0.2);
    if (covered) continue;
    L.seen.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, r: Math.round(r * 100) / 100 });
    if (L.seen.length > 3000) L.seen.shift();
    added = true;
  }
  return added;
}

// Burst spells fade on their own, and weather layers finish fading out: drop them. Returns true if anything changed.
function expire(map, now = Date.now()) {
  const before = map.spells.length;
  map.spells = map.spells.filter((s) => !s.expires || s.expires > now);
  const w = map.weather;
  const nw = w.layers.length;
  const fadeMs = (w.fade || 0) * 1000;
  w.layers = w.layers.filter((l) => !l.dying || now - l.dying < (l.fs ? l.fs * 1000 : fadeMs)); // fs: a snapshot's own fade
  return map.spells.length !== before || w.layers.length !== nw;
}

// ---------- undo / redo ----------
// One history per map. Continuous gestures (drag, brush, slider) pass a
// `coalesce` key so the whole gesture becomes a single undo step.
const NO_HISTORY = new Set(['bg.pin', 'fog.bake']);
// what an undo step was, in words (the undo and redo arrows say it)
const STEP_WORDS = [
  [/^fog\.|^area\./, 'Fog'], [/^layer\.add/, 'Placing'], [/^layer\.(remove|purge)/, 'Removing'], [/^layer\./, 'Token or asset change'],
  [/^fx\.add/, 'New effect or light'], [/^fx\.remove/, 'Removing an effect'], [/^fx\./, 'Effect or light change'],
  [/^spell\.add|^spell\.burst/, 'Spell area'], [/^spell\./, 'Spell area change'], [/^wall\.import/, 'Walls from a file'], [/^wall\./, 'Walls'],
  [/^light\./, 'Light'], [/^weather\./, 'Weather'], [/^view\./, 'Moving the map'], [/^grid\./, 'Grid'], [/^bg\./, 'Background'],
  [/^draw\./, 'Drawing'], [/^os\./, 'Drawing the map'], [/^mark\./, 'Marker'], [/^round\./, 'Round counter'], [/^vision\./, 'Line of sight'], [/^scene\./, 'Snapshot'],
];
const stepWords = (type) => { for (const [re, w] of STEP_WORDS) if (re.test(type || '')) return w; return 'Last change'; };
class History {
  constructor() { this.undo = []; this.redo = []; this.ul = []; this.rl = []; this.ut = []; this.rt = []; this.lastKey = null; this.lastTime = 0; } // (Prototype 14: ut / rt: when each copy was taken)
  // hold: a drag still in progress (4.5.1): the same gesture however long the hand rested
  before(map, key, type, label, hold = false) {
    if (NO_HISTORY.has(type)) return false;
    const now = Date.now();
    if (key && key === this.lastKey && (hold || now - this.lastTime < 2500)) { this.lastTime = now; return false; }
    this.undo.push(snapshot(map));
    this.ul.push(label || stepWords(type)); this.ut.push(now);
    if (this.undo.length > 80) { this.undo.shift(); this.ul.shift(); this.ut.shift(); }
    this.redo = []; this.rl = []; this.rt = [];
    this.lastKey = key || null;
    this.lastTime = now;
    return true;
  }
  // a step that changed nothing is taken back
  drop() { this.undo.pop(); this.ul.pop(); this.ut.pop(); }
  step(map, dir) {
    const from = dir === 'undo' ? this.undo : this.redo;
    const to = dir === 'undo' ? this.redo : this.undo;
    const fl = dir === 'undo' ? this.ul : this.rl;
    const tl = dir === 'undo' ? this.rl : this.ul;
    const ft = dir === 'undo' ? this.ut : this.rt;
    const tt = dir === 'undo' ? this.rt : this.ut;
    if (!from.length) return false;
    to.push(snapshot(map));
    tl.push(fl.pop() || 'Last change');
    const when = ft.pop() || 1; tt.push(Date.now());
    restore(map, from.pop());
    this.lastKey = null;
    return when; // (Prototype 14: when the copy put back was taken: what the phones moved after it stays where it is)
  }
  get state() {
    return { canUndo: this.undo.length > 0, canRedo: this.redo.length > 0, undoLabel: this.ul[this.ul.length - 1] || null, redoLabel: this.rl[this.rl.length - 1] || null };
  }
}

const SNAP_KEYS = ['bg', 'view', 'layers', 'grid', 'fog', 'fx', 'spells', 'weather', 'light', 'draw', 'marks', 'round', 'walls', 'vision', 'areas', 'frame', 'pframe', 'atlas', 'os']; // (Beta 3.12: atlas, a world map's mist and weather; Beta 3.22: os, an Oldschool map's drawing)
function snapshot(map) { return structuredClone(Object.fromEntries(SNAP_KEYS.map((k) => [k, map[k]]))); }
function restore(map, snap) { for (const k of SNAP_KEYS) if (k in snap) map[k] = snap[k]; }

module.exports = { defaultOs, cleanOs, emptyMap, normalize, apply, expire, recordSeen, recordSight, newId, History, defaultGrid, sceneOf, sceneMatches };
