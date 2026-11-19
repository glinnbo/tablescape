// Oldschool maps, Beta 3.23: ready-made pieces for the Draw tool (Pieces). Each is a little drawing in squares, from
// its top left corner: its floors, wall lines, pillars, stairs and doors. Stamped, it becomes ordinary drawing (every
// part can be changed or erased afterwards). Floors marked "main" take the floor and edge picked in the Draw panel, so
// a piece fits the map it lands on; accents (a bar, a dais, a bridge) keep their own tiles.
'use strict';

const OldschoolPieces = (() => {
  const T = (label) => ({ rel: `Tiles/Tablescape/${label}.webp` });
  const rect = (x0, y0, x1, y1, extra = {}) => ({ kind: 'area', shape: 'rect', pts: [[x0, y0], [x1, y1]], role: 'main', ...extra });
  const round = (x0, y0, x1, y1, extra = {}) => ({ kind: 'area', shape: 'round', pts: [[x0, y0], [x1, y1]], role: 'main', ...extra });
  const path = (pts, r, extra = {}) => ({ kind: 'area', shape: 'path', pts, r, role: 'main', ...extra });
  const brush = (pts, r, extra = {}) => ({ kind: 'area', shape: 'brush', pts, r, role: 'main', ...extra });
  const pillar = (x, y, r, rnd = false) => ({ kind: 'pillar', pts: [[x, y]], r, round: rnd, mat: 'stone_wall' });
  const line = (pts, w, h, mat = 'dark_stone_wall') => ({ kind: 'line', pts, w, h, mat });
  const stairs = (x0, y0, x1, y1, dir) => ({ kind: 'stairs', pts: [[x0, y0], [x1, y1]], dir, mat: 'stone_wall' });
  const door = (x1, y1, x2, y2, extra = {}) => ({ x1, y1, x2, y2, door: 1, ...extra });

  const LIST = [
    { id: 'tavern', label: 'Tavern room', w: 10, h: 7,
      items: [rect(0, 0, 10, 7), rect(0, 0, 6, 2, { role: 'accent', tile: T('Wood parquet') }), line([[0.6, 2.4], [6.4, 2.4], [6.4, 0.6]], 0.6, 0.45), pillar(3, 5, 0.3, true), pillar(7, 5, 0.3, true), line([[9.3, 2.5], [9.3, 4.5]], 0.7, 0.6, 'stone_wall')],
      doors: [door(4, 7, 5, 7), door(5, 7, 6, 7)] },
    { id: 'hall', label: 'Pillared hall', w: 12, h: 8,
      items: [rect(0, 0, 12, 8), ...[3, 6, 9].flatMap((x) => [pillar(x, 2, 0.35, true), pillar(x, 6, 0.35, true)])],
      doors: [door(0, 3, 0, 4), door(0, 4, 0, 5), door(12, 3, 12, 4), door(12, 4, 12, 5)] },
    { id: 'crossroads', label: 'Crossroads', w: 10, h: 10,
      items: [path([[0, 5], [10, 5]], 1), path([[5, 0], [5, 10]], 1), rect(3, 3, 7, 7)],
      doors: [] },
    { id: 'tower', label: 'Round tower', w: 8, h: 8,
      items: [round(0, 0, 8, 8), pillar(4, 4, 0.6, true), stairs(5.5, 2, 7, 5, 3)],
      doors: [door(3.5, 8, 4.5, 8)] },
    { id: 'crypt', label: 'Crypt with alcoves', w: 12, h: 6,
      items: [rect(0, 1.5, 12, 4.5), ...[1, 5, 9].flatMap((x) => [rect(x, 0, x + 2, 1.5), rect(x, 4.5, x + 2, 6), line([[x + 0.5, 0.75], [x + 1.5, 0.75]], 0.7, 0.45), line([[x + 0.5, 5.25], [x + 1.5, 5.25]], 0.7, 0.45)])],
      doors: [door(0, 2.5, 0, 3.5)] },
    { id: 'shrine', label: 'Shrine', w: 9, h: 9,
      items: [rect(0, 0, 9, 9), round(2.5, 2.5, 6.5, 6.5, { role: 'accent', tile: T('Glowing blue'), edge: 'ledge', level: 1 }), stairs(4, 6.5, 5, 7.5, 3), pillar(4.5, 4.5, 0.4)],
      doors: [door(4, 9, 5, 9)] },
    { id: 'cave', label: 'Cave pocket', w: 8, h: 6,
      items: [brush([[1.6, 3], [2.4, 1.9], [4.3, 1.6], [6.3, 2.4], [6.2, 4.1], [4.2, 4.5], [2.2, 4.2], [1.6, 3]], 1.4)],
      doors: [] },
    { id: 'chasm', label: 'Chasm with a bridge', w: 12, h: 7,
      items: [rect(0, 0, 4, 7, { edge: 'cliff', mat: 'rock' }), rect(8, 0, 12, 7, { edge: 'cliff', mat: 'rock' }), rect(4, 3, 8, 4, { role: 'accent', tile: T('Wood parquet'), edge: 'cliff', mat: 'rock' })],
      doors: [] },
  ];
  const BY = Object.fromEntries(LIST.map((p) => [p.id, p]));

  // turned by a quarter turns clockwise: a point in squares, inside a piece of w × h
  function turnPt([x, y], w, h, q) {
    for (let i = 0; i < q; i++) { [x, y] = [h - y, x]; [w, h] = [h, w]; }
    return [x, y];
  }
  const sizeOf = (p, q) => (q % 2 ? { w: p.h, h: p.w } : { w: p.w, h: p.h });

  // the piece as drawing in map inches: at (x0, y0) (its top left corner), turned q quarter turns, squares of g.
  // look: what "main" floors get ({ tile, edge, mat, level }); defaultMat(edge) for edges a piece sets itself.
  function build(p, { x0, y0, g, q = 0, look, defaultMat }) {
    const P = ([x, y]) => { const [u, v] = turnPt([x, y], p.w, p.h, q); return [Math.round((x0 + u * g) * 1e4) / 1e4, Math.round((y0 + v * g) * 1e4) / 1e4]; };
    const items = p.items.map((it) => {
      const o = { kind: it.kind, pts: it.pts.map(P) };
      if (it.kind === 'area') {
        Object.assign(o, { shape: it.shape });
        if (it.r != null) o.r = it.r * g;
        const edge = it.edge || look.edge;
        Object.assign(o, {
          tile: it.role === 'accent' && it.tile ? it.tile : look.tile,
          edge,
          mat: it.mat || (it.edge ? defaultMat(edge) : look.mat),
          level: (it.level || 0) + (look.level || 0),
          // (Beta 3.26) the main floors mix as picked; an accent (a bar, a dais, a bridge) keeps a hard edge
          mix: it.role === 'accent' ? 'off' : look.mix || 'stones', mixW: look.mixW || 1,
        });
      } else if (it.kind === 'pillar') Object.assign(o, { r: it.r * g, round: !!it.round, mat: it.mat });
      else if (it.kind === 'line') Object.assign(o, { w: it.w * g, h: it.h, mat: it.mat });
      else if (it.kind === 'stairs') Object.assign(o, { dir: (it.dir + q) % 4, mat: it.mat });
      return o;
    });
    const doors = p.doors.map((d) => { const [x1, y1] = P([d.x1, d.y1]); const [x2, y2] = P([d.x2, d.y2]); return { x1, y1, x2, y2, door: d.door, ...(d.kind ? { kind: d.kind } : {}) }; });
    return { items, doors, ...sizeOf(p, q) };
  }

  // a little sketch on squared paper, for the panel
  const sketches = new Map();
  function sketch(p) {
    if (sketches.has(p.id)) return sketches.get(p.id);
    const S = 64; const c = document.createElement('canvas'); c.width = c.height = S * 2;
    const g = c.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#ece6d6'; g.fillRect(0, 0, S, S);
    const k = (S - 8) / Math.max(p.w, p.h); const ox = (S - p.w * k) / 2; const oy = (S - p.h * k) / 2;
    g.strokeStyle = 'rgba(70, 110, 170, 0.22)'; g.lineWidth = 0.6;
    for (let x = ox % k; x < S; x += k) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    for (let y = oy % k; y < S; y += k) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    const X = (x) => ox + x * k; const Y = (y) => oy + y * k;
    const shapePath = (it) => {
      const P = it.pts; g.beginPath();
      if (it.shape === 'rect') { const [[a, b], [cc, d]] = P; g.rect(X(Math.min(a, cc)), Y(Math.min(b, d)), Math.abs(cc - a) * k, Math.abs(d - b) * k); }
      else if (it.shape === 'round') { const [[a, b], [cc, d]] = P; g.ellipse(X((a + cc) / 2), Y((b + d) / 2), (Math.abs(cc - a) * k) / 2, (Math.abs(d - b) * k) / 2, 0, 0, Math.PI * 2); }
    };
    const strokeOf = (it, w) => { g.beginPath(); it.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.lineWidth = w; g.stroke(); };
    // floors: outlines first (thick dark), then the floor over them, so only the outer edge stays
    const areas = p.items.filter((it) => it.kind === 'area');
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const it of areas) {
      g.strokeStyle = it.edge === 'cliff' ? '#7a6a55' : '#2b2a33';
      if (it.shape === 'path' || it.shape === 'brush') { g.lineCap = it.shape === 'brush' ? 'round' : 'square'; strokeOf(it, it.r * 2 * k + 3); }
      else { shapePath(it); g.lineWidth = 3; g.stroke(); }
    }
    for (const it of areas) {
      g.fillStyle = it.role === 'accent' ? (it.level ? '#cfe3f0' : '#e8d3b0') : '#fbfaf5'; g.strokeStyle = g.fillStyle;
      if (it.shape === 'path' || it.shape === 'brush') { g.lineCap = it.shape === 'brush' ? 'round' : 'square'; strokeOf(it, it.r * 2 * k); }
      else { shapePath(it); g.fill(); }
    }
    g.lineCap = 'butt';
    for (const it of p.items) {
      if (it.kind === 'line') { g.strokeStyle = '#3a3640'; strokeOf(it, Math.max(1.5, it.w * k)); }
      if (it.kind === 'pillar') { const [[x, y]] = it.pts; g.fillStyle = '#3a3640'; g.beginPath(); if (it.round) g.arc(X(x), Y(y), it.r * k, 0, Math.PI * 2); else g.rect(X(x) - it.r * k, Y(y) - it.r * k, it.r * 2 * k, it.r * 2 * k); g.fill(); }
      if (it.kind === 'stairs') {
        const [[a, b], [cc, d]] = it.pts; const x0 = X(Math.min(a, cc)); const y0 = Y(Math.min(b, d)); const w = Math.abs(cc - a) * k; const h = Math.abs(d - b) * k;
        g.strokeStyle = '#3a3640'; g.lineWidth = 0.8; g.strokeRect(x0, y0, w, h);
        const n = 5; for (let i = 1; i < n; i++) { g.beginPath(); if (it.dir % 2) { g.moveTo(x0, y0 + (h * i) / n); g.lineTo(x0 + w, y0 + (h * i) / n); } else { g.moveTo(x0 + (w * i) / n, y0); g.lineTo(x0 + (w * i) / n, y0 + h); } g.stroke(); }
      }
    }
    for (const d of p.doors) { g.strokeStyle = '#a0612b'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(X(d.x1) + (d.x1 === d.x2 ? 0 : 1), Y(d.y1) + (d.y1 === d.y2 ? 0 : 1)); g.lineTo(X(d.x2) - (d.x1 === d.x2 ? 0 : 1), Y(d.y2) - (d.y1 === d.y2 ? 0 : 1)); g.stroke(); }
    const url = c.toDataURL('image/png');
    sketches.set(p.id, url);
    return url;
  }

  return { LIST, BY, build, sketch, sizeOf };
})();
