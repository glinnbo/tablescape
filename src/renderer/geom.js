// Grid and template geometry. All coordinates are map inches.
// Grid: { type: 'square' | 'hex-pointy' | 'hex-flat', size, angle (deg), ox, oy }
//   square: size = side of a square
//   hex:    size = distance between the centres of neighbouring hexes (flat-to-flat width)
'use strict';

const Geom = (() => {
  const D2R = Math.PI / 180;
  const SQ3 = Math.sqrt(3);
  const isHex = (g) => g.type === 'hex-pointy' || g.type === 'hex-flat';

  function toLocal(g, x, y) {
    const a = -(g.angle || 0) * D2R;
    const dx = x - (g.ox || 0); const dy = y - (g.oy || 0);
    return { u: dx * Math.cos(a) - dy * Math.sin(a), v: dx * Math.sin(a) + dy * Math.cos(a) };
  }
  function fromLocal(g, u, v) {
    const a = (g.angle || 0) * D2R;
    return { x: (g.ox || 0) + u * Math.cos(a) - v * Math.sin(a), y: (g.oy || 0) + u * Math.sin(a) + v * Math.cos(a) };
  }

  // ---------- hex helpers (axial coordinates) ----------
  function hexBasis(g) {
    const s = g.size;
    return g.type === 'hex-pointy'
      ? { qx: s, qy: 0, rx: s / 2, ry: (s * SQ3) / 2 }
      : { qx: (s * SQ3) / 2, qy: s / 2, rx: 0, ry: s };
  }
  function hexCenter(g, q, r) {
    const b = hexBasis(g);
    return fromLocal(g, q * b.qx + r * b.rx, q * b.qy + r * b.ry);
  }
  function hexAt(g, x, y) {
    const { u, v } = toLocal(g, x, y);
    const b = hexBasis(g);
    const det = b.qx * b.ry - b.rx * b.qy;
    const qf = (u * b.ry - v * b.rx) / det;
    const rf = (v * b.qx - u * b.qy) / det;
    // cube rounding
    const sf = -qf - rf;
    let q = Math.round(qf); let r = Math.round(rf); const s = Math.round(sf);
    const dq = Math.abs(q - qf); const dr = Math.abs(r - rf); const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return { q, r };
  }
  function hexCorners(g, q, r) {
    const c = hexCenter(g, q, r);
    const R = g.size / SQ3;
    const base = (g.type === 'hex-pointy' ? 30 : 0) + (g.angle || 0);
    const pts = [];
    for (let k = 0; k < 6; k++) { const a = (base + 60 * k) * D2R; pts.push(c.x + R * Math.cos(a), c.y + R * Math.sin(a)); }
    return pts;
  }

  // ---------- cells (for drawing and for affected squares) ----------
  // Calls fn(cell) for every cell touching the map-space rectangle.
  // cell = { key, cx, cy, poly: [x0,y0,x1,y1,...] }
  function eachCell(g, minx, miny, maxx, maxy, fn) {
    const corners = [toLocal(g, minx, miny), toLocal(g, maxx, miny), toLocal(g, minx, maxy), toLocal(g, maxx, maxy)];
    const us = corners.map((c) => c.u); const vs = corners.map((c) => c.v);
    const u0 = Math.min(...us); const u1 = Math.max(...us); const v0 = Math.min(...vs); const v1 = Math.max(...vs);
    const s = g.size;
    if (!isHex(g)) {
      const i0 = Math.floor(u0 / s); const i1 = Math.ceil(u1 / s); const j0 = Math.floor(v0 / s); const j1 = Math.ceil(v1 / s);
      if ((i1 - i0) * (j1 - j0) > 40000) return;
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          const p = [fromLocal(g, i * s, j * s), fromLocal(g, (i + 1) * s, j * s), fromLocal(g, (i + 1) * s, (j + 1) * s), fromLocal(g, i * s, (j + 1) * s)];
          const c = fromLocal(g, (i + 0.5) * s, (j + 0.5) * s);
          fn({ key: `${i},${j}`, cx: c.x, cy: c.y, poly: p.flatMap((q) => [q.x, q.y]) });
        }
      }
      return;
    }
    // hex: walk axial coordinates whose centres fall inside the padded local rectangle
    const b = hexBasis(g);
    const det = b.qx * b.ry - b.rx * b.qy;
    const pad = s;
    const toQR = (u, v) => ({ q: (u * b.ry - v * b.rx) / det, r: (v * b.qx - u * b.qy) / det });
    const cs = [toQR(u0 - pad, v0 - pad), toQR(u1 + pad, v0 - pad), toQR(u0 - pad, v1 + pad), toQR(u1 + pad, v1 + pad)];
    const q0 = Math.floor(Math.min(...cs.map((c) => c.q))); const q1 = Math.ceil(Math.max(...cs.map((c) => c.q)));
    const r0 = Math.floor(Math.min(...cs.map((c) => c.r))); const r1 = Math.ceil(Math.max(...cs.map((c) => c.r)));
    if ((q1 - q0) * (r1 - r0) > 60000) return;
    for (let q = q0; q <= q1; q++) {
      for (let r = r0; r <= r1; r++) {
        const u = q * b.qx + r * b.rx; const v = q * b.qy + r * b.ry;
        if (u < u0 - pad || u > u1 + pad || v < v0 - pad || v > v1 + pad) continue;
        const c = fromLocal(g, u, v);
        fn({ key: `${q},${r}`, cx: c.x, cy: c.y, poly: hexCorners(g, q, r) });
      }
    }
  }

  // Snap a token centre: odd sizes to cell centres, even sizes to square corners.
  function snap(g, x, y, sizeCells = 1) {
    if (isHex(g)) { const { q, r } = hexAt(g, x, y); return hexCenter(g, q, r); }
    const { u, v } = toLocal(g, x, y);
    const s = g.size;
    const even = Math.round(sizeCells) % 2 === 0 && Math.round(sizeCells) === sizeCells;
    const f = (w) => (even ? Math.round(w / s) * s : (Math.floor(w / s) + 0.5) * s);
    return fromLocal(g, f(u), f(v));
  }

  // ---------- 5e area templates ----------
  const CONE_HALF = Math.atan(0.5); // a 5e cone is as wide as it is long
  const ftToIn = (g, ft) => (ft / 5) * g.size;

  // sp: { shape, x, y, angle, size, width }   tokenR: radius of the token an aura sits on
  function template(g, sp, at, tokenR = 0) {
    const ox = at ? at.x : sp.x; const oy = at ? at.y : sp.y;
    const a = (sp.angle || 0) * D2R;
    const dx = Math.cos(a); const dy = Math.sin(a);
    const L = ftToIn(g, sp.size);
    let t;
    if (sp.shape === 'sphere' || sp.shape === 'cylinder' || sp.shape === 'aura') {
      const R = L + (sp.shape === 'aura' ? tokenR : 0);
      t = { kind: 'circle', cx: ox, cy: oy, R, origin: { x: ox, y: oy },
        contains: (x, y) => Math.hypot(x - ox, y - oy) <= R,
        bbox: [ox - R, oy - R, ox + R, oy + R] };
    } else if (sp.shape === 'cone') {
      const hw = L * Math.tan(CONE_HALF);
      const p1 = { x: ox + dx * L - dy * hw, y: oy + dy * L + dx * hw };
      const p2 = { x: ox + dx * L + dy * hw, y: oy + dy * L - dx * hw };
      t = { kind: 'poly', poly: [ox, oy, p1.x, p1.y, p2.x, p2.y], origin: { x: ox, y: oy },
        contains: (x, y) => {
          const px = x - ox; const py = y - oy;
          const along = px * dx + py * dy;
          if (along <= 0 || along > L) return false;
          const across = Math.abs(-px * dy + py * dx);
          return across <= along * Math.tan(CONE_HALF);
        } };
    } else if (sp.shape === 'line') {
      const W = ftToIn(g, sp.width || 5) / 2;
      const nx = -dy; const ny = dx;
      t = { kind: 'poly', origin: { x: ox, y: oy },
        poly: [ox + nx * W, oy + ny * W, ox + dx * L + nx * W, oy + dy * L + ny * W, ox + dx * L - nx * W, oy + dy * L - ny * W, ox - nx * W, oy - ny * W],
        contains: (x, y) => { const px = x - ox; const py = y - oy; const al = px * dx + py * dy; const ac = Math.abs(px * nx + py * ny); return al >= 0 && al <= L && ac <= W; } };
    } else { // cube: origin is the centre of one face, the cube extends along the angle
      const h = L / 2;
      const cx = ox + dx * h; const cy = oy + dy * h;
      const nx = -dy; const ny = dx;
      t = { kind: 'poly', origin: { x: ox, y: oy }, cx, cy,
        poly: [ox + nx * h, oy + ny * h, ox + dx * L + nx * h, oy + dy * L + ny * h, ox + dx * L - nx * h, oy + dy * L - ny * h, ox - nx * h, oy - ny * h],
        contains: (x, y) => { const px = x - cx; const py = y - cy; return Math.abs(px * dx + py * dy) <= h && Math.abs(px * nx + py * ny) <= h; } };
    }
    if (!t.bbox) {
      const xs = t.poly.filter((_, i) => i % 2 === 0); const ys = t.poly.filter((_, i) => i % 2 === 1);
      t.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    if (t.cx == null) { t.cx = (t.bbox[0] + t.bbox[2]) / 2; t.cy = (t.bbox[1] + t.bbox[3]) / 2; }
    t.extent = Math.max(t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1]);
    // typical size for effect details: a thin line gets small sparks, a big sphere big flames
    t.S = sp.shape === 'line' ? Math.min(L, ftToIn(g, sp.width || 5) * 5) : t.kind === 'circle' ? 2 * t.R : L;
    return t;
  }

  function tracePath(ctx, t) {
    ctx.beginPath();
    if (t.kind === 'circle') ctx.arc(t.cx, t.cy, t.R, 0, Math.PI * 2);
    else { ctx.moveTo(t.poly[0], t.poly[1]); for (let i = 2; i < t.poly.length; i += 2) ctx.lineTo(t.poly[i], t.poly[i + 1]); ctx.closePath(); }
  }

  // DMG rule: a square (or hex) is affected if at least half of it is covered.
  function affected(g, t) {
    const out = [];
    const [x0, y0, x1, y1] = t.bbox;
    eachCell(g, x0, y0, x1, y1, (cell) => {
      // sample a 5x5 lattice spanning the cell's polygon bounding box, keep only points inside the cell
      const xs = cell.poly.filter((_, i) => i % 2 === 0); const ys = cell.poly.filter((_, i) => i % 2 === 1);
      const bx0 = Math.min(...xs); const bx1 = Math.max(...xs); const by0 = Math.min(...ys); const by1 = Math.max(...ys);
      let inCell = 0; let hit = 0;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          const x = bx0 + ((i + 0.5) / 6) * (bx1 - bx0); const y = by0 + ((j + 0.5) / 6) * (by1 - by0);
          if (!pointInPoly(cell.poly, x, y)) continue;
          inCell++;
          if (t.contains(x, y)) hit++;
        }
      }
      if (inCell && hit / inCell >= 0.5) out.push(cell);
    });
    return out;
  }

  function pointInPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i]; const yi = poly[i + 1]; const xj = poly[j]; const yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Distance between two points in feet, counted the 5e way. Ends snap to cell centres unless `free`.
  // rule: 'phb' (every diagonal step is 5 ft), 'dmg' (5-10-5), 'real' (straight line)
  function measure(g, a, b, rule = 'phb', free = false) {
    if (isHex(g)) {
      const A = hexAt(g, a.x, a.y); const B = hexAt(g, b.x, b.y);
      const dq = B.q - A.q; const dr = B.r - A.r;
      const steps = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      return { ft: steps * 5, cells: steps, a: free ? a : hexCenter(g, A.q, A.r), b: free ? b : hexCenter(g, B.q, B.r) };
    }
    const sa = free ? a : snap(g, a.x, a.y, 1); const sb = free ? b : snap(g, b.x, b.y, 1);
    const la = toLocal(g, sa.x, sa.y); const lb = toLocal(g, sb.x, sb.y);
    const du = Math.abs(lb.u - la.u) / g.size; const dv = Math.abs(lb.v - la.v) / g.size;
    if (rule === 'real') { const c = Math.hypot(du, dv); return { ft: Math.round(c * 5), cells: c, a: sa, b: sb }; }
    const nu = Math.round(du); const nv = Math.round(dv);
    const diag = Math.min(nu, nv); const straight = Math.max(nu, nv) - diag;
    const cells = rule === 'dmg' ? straight + diag + Math.floor(diag / 2) : straight + diag;
    return { ft: cells * 5, cells, a: sa, b: sb };
  }

  // 4.10: how big a token's picture is drawn, as a share of the squares it takes (Options → Tokens: one value per 5e size,
  // sizes in between lie between them), times its own adjustment (l.pic). The token still takes its squares.
  const PIC_DEFAULT = { tiny: 1.2, medium: 1.3, large: 1.15, huge: 1.1, garg: 1.05 };
  const PIC_STEPS = [[0.5, 'tiny'], [1, 'medium'], [2, 'large'], [3, 'huge'], [4, 'garg']];
  function tokenPic(size, pic, own) {
    const P = { ...PIC_DEFAULT, ...(pic || {}) };
    const s = Number(size) || 1;
    let k = P.garg;
    if (s <= PIC_STEPS[0][0]) k = P.tiny;
    else {
      for (let i = 1; i < PIC_STEPS.length; i++) {
        const [s1, k1] = PIC_STEPS[i];
        if (s <= s1) { const [s0, k0] = PIC_STEPS[i - 1]; k = P[k0] + ((s - s0) / (s1 - s0)) * (P[k1] - P[k0]); break; }
      }
    }
    return k * (Number(own) > 0 ? Number(own) : 1);
  }
  return { isHex, toLocal, fromLocal, hexAt, hexCenter, hexCorners, eachCell, snap, template, tracePath, affected, ftToIn, pointInPoly, measure, D2R, tokenPic, PIC_DEFAULT };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Geom; // (Prototype 1: the main process steps tokens on the grid too)
