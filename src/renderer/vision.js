// Line of sight: walls and doors, how far lights reach, what the party sees.
// Shared by the main process (it records what the party has explored into the fog)
// and both windows (lights stop at walls, the view of the party is drawn live).
// All coordinates are map inches.
//
// map.walls: [{ id, x1, y1, x2, y2, door: 0 wall | 1 door | 2 secret door, open }]
// map.vision: { on, dim }  dim = how dark explored ground gets while nobody sees it
// The party sees from its party lights (Play → Party): line of sight with walls, a circle without.
'use strict';

(function (root) {
  const TAU = Math.PI * 2;
  const EPS = 1e-4;
  const DARK = 0.5; // from this darkness on, the party only sees what is lit

  const ftToIn = (map, ft) => (ft / 5) * ((map.grid && map.grid.size) || 1);

  // ---------- small geometry ----------
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1; const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  // where a ray from (x, y) in direction (dx, dy) meets a segment (distance along the ray), or -1
  function raySeg(x, y, dx, dy, x1, y1, x2, y2) {
    const ex = x2 - x1; const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return -1;
    const ax = x1 - x; const ay = y1 - y;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * dy - ay * dx) / den;
    return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : -1;
  }
  function rayBox(x, y, dx, dy, b) {
    const tx = dx > 0 ? (b[2] - x) / dx : dx < 0 ? (b[0] - x) / dx : Infinity;
    const ty = dy > 0 ? (b[3] - y) / dy : dy < 0 ? (b[1] - y) / dy : Infinity;
    return Math.max(0, Math.min(tx, ty));
  }
  function bboxOf(pts) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < b[0]) b[0] = pts[i]; if (pts[i] > b[2]) b[2] = pts[i];
      if (pts[i + 1] < b[1]) b[1] = pts[i + 1]; if (pts[i + 1] > b[3]) b[3] = pts[i + 1];
    }
    return b;
  }
  const overlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  function area(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i += 2) {
      const j = (i + 2) % n;
      s += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
    }
    return Math.abs(s) / 2;
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i]; const yi = pts[i + 1]; const xj = pts[j]; const yj = pts[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // drop points that add nothing: near duplicates and points on a straight line
  function simplify(pts, tol = 0.01) {
    // 1. near duplicates (rays just before and after a corner land on the same spot)
    const q = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i]; const y = pts[i + 1];
      if (q.length && Math.abs(x - q[q.length - 2]) < tol && Math.abs(y - q[q.length - 1]) < tol) continue;
      q.push(x, y);
    }
    while (q.length > 6 && Math.abs(q[0] - q[q.length - 2]) < tol && Math.abs(q[1] - q[q.length - 1]) < tol) q.length -= 2;
    const n = q.length / 2;
    if (n < 4) return q.length >= 6 ? q : pts;
    // 2. points on the straight line between the last point kept and the next one
    const out = [];
    for (let i = 0; i < n; i++) {
      const px = out.length ? out[out.length - 2] : q[(n - 1) * 2]; const py = out.length ? out[out.length - 1] : q[(n - 1) * 2 + 1];
      const x = q[i * 2]; const y = q[i * 2 + 1];
      const nx = q[((i + 1) % n) * 2]; const ny = q[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(nx - px, ny - py) || 1;
      const off = Math.abs((x - px) * (ny - py) - (y - py) * (nx - px)) / len;
      // also keep it when it sticks out beyond its neighbours (a spike along the line)
      const along = (x - px) * (nx - px) + (y - py) * (ny - py);
      if (off < tol * 0.5 && along > 0 && along < len * len) continue;
      out.push(x, y);
    }
    return out.length >= 6 ? out : q;
  }

  // ---------- walls ----------
  // a cheap fingerprint of the walls and door states, for caches
  // In the windows every state update brings new wall arrays, so the fingerprint can be kept per array;
  // the main process changes its arrays in place and always computes it afresh.
  const sigCache = typeof window !== 'undefined' ? new WeakMap() : null;
  function wallSig(map) {
    const w = map.walls || [];
    if (sigCache && sigCache.has(w)) return sigCache.get(w);
    const sig = computeSig(w);
    if (sigCache) sigCache.set(w, sig);
    return sig;
  }
  function computeSig(w) {
    let h = w.length;
    for (const s of w) {
      h = (h * 31 + Math.round(s.x1 * 97 + s.y1 * 89 + s.x2 * 83 + s.y2 * 79)) | 0;
      h = (h * 7 + (s.door || 0) * 3 + (s.open ? 1 : 0) + (s.kind === 'window' ? (s.shut ? 17 : 11) : s.kind === 'invisible' ? 13 : 0)) | 0;
    }
    return `${w.length}:${h}`;
  }
  const segCache = new Map(); // sig -> Float64Array [x1, y1, x2, y2, ...] of what blocks sight
  function blockers(map, sig = wallSig(map)) {
    let s = segCache.get(sig);
    if (s) return s;
    // (Prototype 14: windows and invisible walls let sight and light through; Beta 3.1: a closed window doesn't)
    const list = (map.walls || []).filter((w) => !(w.door && w.open) && (!w.kind || (w.kind === 'window' && w.shut)));
    s = new Float64Array(list.length * 4);
    list.forEach((w, i) => { s[i * 4] = w.x1; s[i * 4 + 1] = w.y1; s[i * 4 + 2] = w.x2; s[i * 4 + 3] = w.y2; });
    if (segCache.size > 24) segCache.clear();
    segCache.set(sig, s);
    return s;
  }
  // Prototype 14: what stops feet: every wall (windows and invisible ones too) and closed doors
  function movers(map, sig = wallSig(map)) {
    const key = `m${sig}`;
    let s = segCache.get(key);
    if (s) return s;
    const list = (map.walls || []).filter((w) => !(w.door && w.open));
    s = new Float64Array(list.length * 4);
    list.forEach((w, i) => { s[i * 4] = w.x1; s[i * 4 + 1] = w.y1; s[i * 4 + 2] = w.x2; s[i * 4 + 3] = w.y2; });
    if (segCache.size > 24) segCache.clear();
    segCache.set(key, s);
    return s;
  }
  // a frame for sight without a range: far around the eye and every wall, so open ground beyond the
  // outermost wall is seen too (a frame just around the walls cut the view off there, and that edge
  // moved along with the party)
  const FAR = 400; // inches: bigger than any map
  function boundsFor(map, x, y) {
    let b = [x - FAR, y - FAR, x + FAR, y + FAR];
    for (const s of map.walls || []) {
      b = [Math.min(b[0], s.x1 - 2, s.x2 - 2), Math.min(b[1], s.y1 - 2, s.y2 - 2), Math.max(b[2], s.x1 + 2, s.x2 + 2), Math.max(b[3], s.y1 + 2, s.y2 + 2)];
    }
    return b;
  }

  // Everything visible from (x, y): a polygon (flat [x, y, ...]) cut by the walls.
  // R > 0 limits it to a circle (a light's reach), otherwise it stops at the frame `box`.
  function visibility(segs, x, y, R, box, raw) {
    const n = segs.length / 4;
    const cand = [];
    for (let i = 0; i < n; i++) {
      const x1 = segs[i * 4]; const y1 = segs[i * 4 + 1]; const x2 = segs[i * 4 + 2]; const y2 = segs[i * 4 + 3];
      const d = segDist(x, y, x1, y1, x2, y2);
      if (d < 1e-3) continue; // standing right on it (a torch on a wall): it does not cast a shadow
      if (R > 0 && d >= R) continue;
      if (!(R > 0) && box && (Math.max(x1, x2) < box[0] || Math.min(x1, x2) > box[2] || Math.max(y1, y2) < box[1] || Math.min(y1, y2) > box[3])) continue;
      cand.push([d, x1, y1, x2, y2]);
    }
    cand.sort((a, b) => a[0] - b[0]); // near walls first: most rays stop after a few tests
    const angs = [];
    const add = (px, py) => { const a = Math.atan2(py - y, px - x); angs.push(a - EPS, a, a + EPS); };
    for (const c of cand) {
      if (!(R > 0) || Math.hypot(c[1] - x, c[2] - y) < R * 1.02) add(c[1], c[2]);
      if (!(R > 0) || Math.hypot(c[3] - x, c[4] - y) < R * 1.02) add(c[3], c[4]);
    }
    if (R > 0) for (let k = 0; k < 72; k++) angs.push(-Math.PI + (k * TAU) / 72);
    else { add(box[0], box[1]); add(box[2], box[1]); add(box[2], box[3]); add(box[0], box[3]); }
    angs.sort((a, b) => a - b);
    const pts = [];
    let last = NaN;
    for (const a of angs) {
      if (a - last < 1e-7) continue;
      last = a;
      const dx = Math.cos(a); const dy = Math.sin(a);
      let t = R > 0 ? R : rayBox(x, y, dx, dy, box);
      for (const c of cand) {
        if (c[0] >= t) break;
        const u = raySeg(x, y, dx, dy, c[1], c[2], c[3], c[4]);
        if (u >= 0 && u < t) t = u;
      }
      pts.push(x + dx * t, y + dy * t);
    }
    return raw ? pts : simplify(pts);
  }

  // cached polygons (the same light is asked for every frame)
  const polyCache = new Map();
  function poly(map, x, y, R, sig = wallSig(map)) {
    const key = `${map.id}|${sig}|${x.toFixed(3)}|${y.toFixed(3)}|${R ? R.toFixed(3) : 0}`;
    let p = polyCache.get(key);
    if (p) return p;
    const box = R > 0 ? null : boundsFor(map, x, y);
    p = visibility(blockers(map, sig), x, y, R, box);
    if (polyCache.size > 400) polyCache.clear();
    polyCache.set(key, p);
    return p;
  }

  // ---------- who sees, what is lit ----------
  const on = (map) => !!(map && map.vision && map.vision.on && map.walls && map.walls.length);
  const isDark = (map) => (map.light && map.light.darkness) >= DARK;
  // hidden by hand, or carried by a hidden token: not on the TV
  function offTable(map, f) {
    if (f.hidden) return true;
    if (!f.attachTo) return false;
    const t = (map.layers || []).find((l) => l.id === f.attachTo);
    return !!(t && t.hidden);
  }
  function posOf(map, f) {
    if (f.attachTo) { const t = (map.layers || []).find((l) => l.id === f.attachTo); if (t) return { x: t.x, y: t.y }; }
    return { x: f.x, y: f.y };
  }
  // the party's eyes: every visible party light
  //   D: the light it carries, DV: darkvision, V: how far it sees (0: as far as the walls allow)
  // Prototype 17: on a map whose player tokens see for themselves (their eyes), the single party marker rests
  function markersIdle(map) { const L = map.layers || []; return (map.fx || []).some((f) => f.eye && f.attachTo && L.some((l) => l.id === f.attachTo)); }
  const idleMarker = (f, idle) => idle && f.kind === 'light' && f.preset === 'party' && !f.attachTo && !f.eye;
  function eyes(map) {
    const idle = markersIdle(map);
    return (map.fx || []).filter((f) => f.kind === 'light' && f.preset === 'party' && !offTable(map, f) && !idleMarker(f, idle)).map((f) => {
      const p = posOf(map, f);
      return { id: f.id, x: p.x, y: p.y, D: ftToIn(map, Math.max(f.dim || 0, f.bright || 0)), DV: ftToIn(map, f.darkvision || 0), V: ftToIn(map, f.range || 0) };
    });
  }
  // without walls (or with line of sight off) the party sees a circle: its range, or this far
  const OPEN_FT = 30;
  // everything that gives light: lights and flames that carry their own light
  function lights(map, gm) {
    const idle = markersIdle(map);
    return (map.fx || []).filter((f) => (f.kind === 'light' || (f.kind === 'emitter' && f.bright > 0)) && (gm || !offTable(map, f)) && !idleMarker(f, idle)).map((f) => {
      const p = posOf(map, f);
      return { id: f.id, x: p.x, y: p.y, D: Math.max(0.05, ftToIn(map, Math.max(f.dim || 0, f.bright || 0))) };
    });
  }
  const circleCache = new Map();
  function circle(x, y, R) {
    const key = `${x.toFixed(3)}|${y.toFixed(3)}|${R.toFixed(3)}`;
    let p = circleCache.get(key);
    if (p) return p;
    p = [];
    for (let k = 0; k < 64; k++) { const a = -Math.PI + (k * TAU) / 64; p.push(x + Math.cos(a) * R, y + Math.sin(a) * R); }
    if (circleCache.size > 200) circleCache.clear();
    circleCache.set(key, p);
    return p;
  }
  // What one eye sees: { pts: the view (cut by walls when line of sight is on), lit: null (bright map) or the lit areas inside it }
  // On a dark map the party sees what its own light, its darkvision and the other lights reach.
  function sight(map, eye, sig, walled = on(map)) {
    if (walled && !sig) sig = wallSig(map);
    const reach = (x, y, R) => (walled ? poly(map, x, y, R, sig) : circle(x, y, R));
    const pts = walled ? poly(map, eye.x, eye.y, eye.V, sig) : circle(eye.x, eye.y, eye.V || ftToIn(map, OPEN_FT));
    if (!isDark(map)) return { pts, lit: null };
    const box = bboxOf(pts);
    const lit = [];
    if (eye.D > 0.05) lit.push(reach(eye.x, eye.y, eye.D));
    if (eye.DV > 0) lit.push(reach(eye.x, eye.y, eye.DV));
    for (const L of lights(map, false)) {
      if (L.id === eye.id) continue;
      if (!overlap(box, [L.x - L.D, L.y - L.D, L.x + L.D, L.y + L.D])) continue;
      lit.push(reach(L.x, L.y, L.D));
    }
    return { pts, lit };
  }
  function sights(map) {
    const list = eyes(map);
    if (!list.length) return [];
    const walled = on(map);
    const sig = walled ? wallSig(map) : 'open';
    return list.map((e) => ({ eye: e, ...sight(map, e, sig, walled) }));
  }
  // the light of one source, stopped by the walls (null when line of sight is off)
  function lightPoly(map, x, y, R) {
    if (!on(map)) return null;
    return poly(map, x, y, R);
  }

  // ---------- walls for editing ----------
  // the wall (or door) closest to a point, within tol
  function wallAt(map, x, y, tol, filter) {
    let best = null; let bd = tol;
    for (const w of map.walls || []) {
      if (filter && !filter(w)) continue;
      const d = segDist(x, y, w.x1, w.y1, w.x2, w.y2);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  // ---------- rooms ----------
  // The room around (x, y): everything reachable from there without crossing a wall or a closed door.
  // Found on a fine raster (about an eighth of a square), grown over the wall line itself, and returned as
  // outlines: rings of flat [x, y, ...] in map inches (holes, like a pillar, run the other way).
  // null when the spot is not closed in: the fill runs out of the frame around the walls.
  function room(map, x, y) {
    const all = map.walls || [];
    const walls = all.filter((w) => !(w.door && w.open));
    if (walls.length < 3) return null;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const w of all) {
      b[0] = Math.min(b[0], w.x1, w.x2); b[1] = Math.min(b[1], w.y1, w.y2);
      b[2] = Math.max(b[2], w.x1, w.x2); b[3] = Math.max(b[3], w.y1, w.y2);
    }
    if (!(x > b[0] && x < b[2] && y > b[1] && y < b[3])) return null;
    const g = (map.grid && map.grid.size) || 1;
    const cell = Math.max(g / 8, (b[2] - b[0]) / 720, (b[3] - b[1]) / 720);
    const pad = 3;
    // shifted half a cell, so walls on grid lines run through the middle of cells: the reveal reaches as far past every wall
    const ox = b[0] - (pad + 0.5) * cell; const oy = b[1] - (pad + 0.5) * cell;
    const nx = Math.ceil((b[2] - b[0]) / cell) + pad * 2 + 1; const ny = Math.ceil((b[3] - b[1]) / cell) + pad * 2 + 1;
    const N = nx * ny;
    const wall = new Uint8Array(N);
    // walls on the raster: every cell a wall passes through (fine steps, so a diagonal wall has no gaps)
    for (const w of walls) {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const steps = Math.max(1, Math.ceil(len / (cell * 0.25)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const i = Math.floor((w.x1 + (w.x2 - w.x1) * t - ox) / cell); const j = Math.floor((w.y1 + (w.y2 - w.y1) * t - oy) / cell);
        if (i >= 0 && j >= 0 && i < nx && j < ny) wall[j * nx + i] = 1;
      }
    }
    // the start: the clicked cell, or the nearest open one next to it
    let si = Math.floor((x - ox) / cell); let sj = Math.floor((y - oy) / cell);
    if (wall[sj * nx + si]) {
      let found = false;
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r && !found; di++) {
          const i = si + di; const j = sj + dj;
          if (i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && !wall[j * nx + i]) { si = i; sj = j; found = true; }
        }
      }
      if (!found) return null;
    }
    // flood fill (four neighbours: a wall touching only at a corner still closes the room)
    const fill = new Uint8Array(N);
    const queue = new Int32Array(N);
    let head = 0; let tail = 0;
    fill[sj * nx + si] = 1; queue[tail++] = sj * nx + si;
    while (head < tail) {
      const c = queue[head++];
      const i = c % nx; const j = (c - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) return null; // it leaks out: not a closed room
      for (const n of [c - 1, c + 1, c - nx, c + nx]) {
        if (!fill[n] && !wall[n]) { fill[n] = 1; queue[tail++] = n; }
      }
    }
    const count = tail;
    // grow over the wall line (two cells, only into wall cells), so the reveal reaches the wall itself
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let c = nx; c < N - nx; c++) {
        if (fill[c] || !wall[c]) continue;
        if (fill[c - 1] || fill[c + 1] || fill[c - nx] || fill[c + nx]) add.push(c);
      }
      for (const c of add) fill[c] = 2;
    }
    return { rings: outline(fill, nx, ny, ox, oy, cell), area: count * cell * cell, cell };
  }
  // the outlines of the filled cells: edges with the filled side on the right, joined into rings
  function outline(fill, nx, ny, ox, oy, cell) {
    const W = nx + 1;
    const out = new Map(); // vertex -> [next vertices]
    const add = (a, c) => { const l = out.get(a); if (l) l.push(c); else out.set(a, [c]); };
    const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && fill[j * nx + i] > 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!on(i, j)) continue;
        if (!on(i, j - 1)) add(j * W + i, j * W + i + 1);
        if (!on(i + 1, j)) add(j * W + i + 1, (j + 1) * W + i + 1);
        if (!on(i, j + 1)) add((j + 1) * W + i + 1, (j + 1) * W + i);
        if (!on(i - 1, j)) add((j + 1) * W + i, j * W + i);
      }
    }
    const rings = [];
    const dir = (a, c) => [(c % W) - (a % W), Math.floor(c / W) - Math.floor(a / W)];
    for (const [start, list] of out) {
      while (list.length) {
        const ring = [];
        let a = start; let c = list.shift();
        let guard = 0;
        while (guard++ < 2000000) {
          ring.push(a);
          a = c;
          if (a === start) break;
          const nexts = out.get(a);
          if (!nexts || !nexts.length) break;
          // where two cells touch only at a corner: turn right, so each region stays one ring
          let k = 0;
          if (nexts.length > 1) {
            const [dx, dy] = dir(ring[ring.length - 1], a);
            k = nexts.findIndex((n) => { const [ex, ey] = dir(a, n); return dx * ey - dy * ex > 0; });
            if (k < 0) k = 0;
          }
          c = nexts.splice(k, 1)[0];
        }
        if (ring.length < 4) continue;
        const pts = [];
        for (const v of ring) pts.push(ox + (v % W) * cell, oy + Math.floor(v / W) * cell);
        // straight walls stay straight and square corners square; the steps along a diagonal wall go
        const sm = dpRing(pts, cell * 0.75);
        if (sm.length >= 6) rings.push(sm.map((v) => Math.round(v * 1000) / 1000));
      }
    }
    return rings;
  }
  // Douglas-Peucker on a closed ring (flat [x, y, ...]): split at the two points farthest apart
  function dpRing(pts, tol) {
    const n = pts.length / 2;
    if (n < 4) return pts;
    let far = 0; let fd = -1;
    for (let i = 1; i < n; i++) { const d = (pts[i * 2] - pts[0]) ** 2 + (pts[i * 2 + 1] - pts[1]) ** 2; if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[far] = 1;
    const run = (a, b) => { // indices along the ring from a to b (b may wrap past the end)
      const stack = [[a, b]];
      while (stack.length) {
        const [s, e] = stack.pop();
        const ax = pts[(s % n) * 2]; const ay = pts[(s % n) * 2 + 1]; const bx = pts[(e % n) * 2]; const by = pts[(e % n) * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1e-9;
        let best = -1; let bd = tol;
        for (let k = s + 1; k < e; k++) {
          const x = pts[(k % n) * 2]; const y = pts[(k % n) * 2 + 1];
          const d = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
          if (d > bd) { bd = d; best = k; }
        }
        if (best >= 0) { keep[best % n] = 1; stack.push([s, best], [best, e]); }
      }
    };
    run(0, far); run(far, n);
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
    return out;
  }
  // is (x, y) inside these outlines (even-odd, so holes count as outside)
  function inRings(rings, x, y) {
    let inside = false;
    for (const r of rings || []) if (inPoly(r, x, y)) inside = !inside;
    return inside;
  }

  // ---------- how dark it is right now ----------
  // A change of light can take some seconds (light.from = { darkness, tint, t0, s }): both windows ease
  // from the old darkness and colour to the new ones, so a sunset or entering a cave happens gradually.
  function hexRgb(hx) { const n = parseInt(String(hx || '#03040a').slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lightNow(light, now = Date.now()) {
    const L = light || {};
    const to = { darkness: L.darkness || 0, tint: L.tint || '#03040a' };
    const f = L.from;
    if (!f || !(f.s > 0)) return { ...to, fading: false };
    const u = (now - f.t0) / (f.s * 1000);
    if (u >= 1 || u < 0) return { ...to, fading: false };
    const e = u * u * (3 - 2 * u);
    const a = hexRgb(f.tint); const b = hexRgb(to.tint);
    const tint = `#${a.map((v, i) => Math.round(v + (b[i] - v) * e).toString(16).padStart(2, '0')).join('')}`;
    return { darkness: (f.darkness || 0) + (to.darkness - (f.darkness || 0)) * e, tint, fading: true };
  }

  const api = {
    lightNow, room, inRings,
    visibility, poly, sight, sights, eyes, lights, lightPoly, offTable, blockers, movers, wallSig, wallAt, boundsFor,
    on, isDark, markersIdle, idleMarker, segDist, raySeg, area, inPoly, bboxOf, simplify, DARK,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vision = api;
})(typeof window !== 'undefined' ? window : globalThis);
