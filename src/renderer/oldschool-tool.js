// The Draw tool (Beta 3.22) on the GM screen: drawing an Oldschool map on the grid.
//   Room / Round       drag a box (Shift: a square or a circle)
//   Shape              click its corners; click the first one again, double-click, Enter or right-click closes it
//   Corridor           drag along the grid: 1, 2 or 3 squares wide
//   Brush              paint freely (caves)
//   Erase              a box, a round or a brush that takes floor, walls and pillars away (Alt erases with any floor tool)
//   Wall               drag a wall line from corner to corner
//   Pillar             click a square
//   Stairs             drag where they go: they climb toward where you drag
//   Door               click a grid line: a door, a secret door or a window there
//   Floor              click a floor: it gets the picked tile (and/or edge)
// What is drawn is kept in map.os (mapstate.js); the picture is made from it here (oldschool.js) and sent to main,
// which makes it the map's picture and its outlines the walls for sight. gm-play.js hands the pointer to this tool.
'use strict';

const OldschoolTool = (() => {
  const { h, iconEl, toast, clamp, round } = UI;
  const ts = window.ts;
  const TOOLS = [
    { id: 'room', label: 'Room', icon: 'square', tip: 'Drag a room (Shift: a square)' },
    { id: 'shape', label: 'Shape', icon: 'polygon', tip: 'Click the corners; click the first again (or Enter) to close it' },
    { id: 'round', label: 'Round', icon: 'circle', tip: 'Drag a round room (Shift: a circle)' },
    { id: 'corridor', label: 'Corridor', icon: 'route', tip: 'Drag a corridor along the grid' },
    { id: 'brush', label: 'Brush', icon: 'brush', tip: 'Paint freely: caves, rough ground' },
    { id: 'erase', label: 'Erase', icon: 'eraser', tip: 'Take floor, walls and pillars away (Alt erases with any floor tool)' },
    { id: 'floor', label: 'Floor', icon: 'color-swatch', tip: 'Click a floor: it gets the picked tile' },
    { id: 'wall', label: 'Wall', icon: 'wall', tip: 'Drag a wall from corner to corner' },
    { id: 'pillar', label: 'Pillar', icon: 'square-dashed', tip: 'Click a square for a pillar' },
    { id: 'stairs', label: 'Stairs', icon: 'stairs', tip: 'Drag where they go: they climb toward where you drag' },
    { id: 'door', label: 'Door', icon: 'door', tip: 'Click a grid line: a door there' },
  ];
  const AREA_TOOLS = ['room', 'shape', 'round', 'corridor', 'brush'];
  const OWN = new Set(['osbox', 'ospath', 'osbrush', 'osline', 'osstairs']);
  const EDGE_LABEL = { walls: 'Walls', rock: 'Rock', ledge: 'Ledge', cliff: 'Cliff' };

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const view = () => ctx.view();
    const map = () => (S() ? S().map : null);
    const c = () => ctx.ctl;
    const first = Oldschool.FLOORS[0];
    const prefs = {
      tool: 'room', snap: 'sq', level: 0, width: 1, brush: 1.5, erase: 'box', edge: 'walls', mats: { ...Oldschool.DEFAULT_MAT },
      line: { w: 0.5, h: 1, mat: 'stone_wall' }, pillar: { r: 0.3, round: false }, door: 'door', floorMode: 'tile',
      floor: first ? { rel: Oldschool.relOf(first) } : null,
    };
    try { const saved = JSON.parse(localStorage.getItem('osPrefs') || '{}'); Object.assign(prefs, saved, { mats: { ...prefs.mats, ...(saved.mats || {}) }, line: { ...prefs.line, ...(saved.line || {}) }, pillar: { ...prefs.pillar, ...(saved.pillar || {}) } }); } catch {}
    ui.os = { ...prefs, poly: null };
    const O = ui.os;
    const save = () => { try { const { poly, ...keep } = O; void poly; localStorage.setItem('osPrefs', JSON.stringify(keep)); } catch {} };
    let lib = []; // the library's tiles (with their squares)
    let libAt = 0;
    async function loadLib(force) {
      if (!force && Date.now() - libAt < 5000) return;
      libAt = Date.now();
      try { lib = (await ts.library('list')).filter((x) => x.cat === 'tiles'); } catch { lib = []; }
      update(); ctx.refreshPop();
    }

    // ---------- the grid ----------
    const grid = () => (map() ? map().grid : { size: 1, ox: 0, oy: 0 });
    const g = () => grid().size || 1;
    function snapCorner(p, free) {
      const G = grid(); const s = O.snap === 'half' ? g() / 2 : g();
      if (free || O.snap === 'free') return { x: round(p.x, 3), y: round(p.y, 3) };
      return { x: round(G.ox + Math.round((p.x - G.ox) / s) * s, 4), y: round(G.oy + Math.round((p.y - G.oy) / s) * s, 4) };
    }
    function snapCenter(p, free) {
      const G = grid(); const s = O.snap === 'half' ? g() / 2 : g();
      if (free || O.snap === 'free') return { x: round(p.x, 3), y: round(p.y, 3) };
      return { x: round(G.ox + (Math.floor((p.x - G.ox) / s) + 0.5) * s, 4), y: round(G.oy + (Math.floor((p.y - G.oy) / s) + 0.5) * s, 4) };
    }
    // a corridor's line runs through square centres (odd widths) or along grid lines (even ones)
    const snapCorr = (p, free) => (free || O.snap === 'free' ? snapCorner(p, true) : O.width % 2 === 1 ? snapCenter(p) : snapCorner(p));

    // ---------- what a new floor gets ----------
    const areaLook = () => ({ tile: O.floor, edge: O.edge, mat: O.edge === 'ledge' ? 'stone_wall' : O.mats[O.edge] || Oldschool.DEFAULT_MAT[O.edge], level: O.level });
    function add(item, label) {
      if (!map() || !map().os) return;
      pending.push({ ...item, at: Date.now() });
      drawPreview();
      return cmd('os.add', { item }).then((r) => { if (r && r.ok && label !== false) toast(label || r.label || 'Drawn', { ms: 1400, undo: () => cmd('history.undo') }); return r; });
    }

    // ---------- the pointer ----------
    function pointerDown(e, pt) {
      const m = map(); if (!m || !m.os) return null;
      const free = e.altKey && !AREA_TOOLS.includes(O.tool) && O.tool !== 'erase';
      const cut = O.tool === 'erase' || (e.altKey && AREA_TOOLS.includes(O.tool));
      const t = O.tool;
      if (t === 'shape') {
        const p = snapCorner(pt);
        if (!O.poly) { O.poly = { pts: [[p.x, p.y]], cut }; drawPreview(pt); return null; }
        const [fx, fy] = O.poly.pts[0];
        if (O.poly.pts.length >= 3 && Math.hypot(p.x - fx, p.y - fy) < g() * 0.3) { closePoly(); return null; }
        const [lx, ly] = O.poly.pts[O.poly.pts.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) > 1e-3) O.poly.pts.push([p.x, p.y]);
        drawPreview(pt);
        return null;
      }
      if (t === 'floor') { repaint(pt); return null; }
      if (t === 'pillar') { const p = snapCenter(pt, e.altKey); add({ kind: 'pillar', pts: [[p.x, p.y]], r: O.pillar.r * g(), round: O.pillar.round, mat: O.line.mat }); return null; }
      if (t === 'door') { placeDoor(pt); return null; }
      if (t === 'corridor' && !cut) { const p = snapCorr(pt); return { kind: 'ospath', pts: [[p.x, p.y]], cut }; }
      if (t === 'brush' || (t === 'erase' && O.erase === 'brush')) return { kind: 'osbrush', pts: [[round(pt.x, 3), round(pt.y, 3)]], cut, r: (O.brush * g()) / 2 };
      if (t === 'wall') { const p = snapCorner(pt, e.altKey); return { kind: 'osline', a: p, b: p }; }
      if (t === 'stairs') { const p = snapCorner(pt, e.altKey); return { kind: 'osstairs', a: p, b: p }; }
      // room, round, erase box/round, and a corridor erased
      const p = snapCorner(pt, free);
      const shape = t === 'round' || (t === 'erase' && O.erase === 'round') ? 'round' : 'rect';
      return { kind: 'osbox', a: p, b: p, shape, cut, start: pt };
    }
    function pointerMove(d, e, pt) {
      if (d.kind === 'osbox' || d.kind === 'osstairs') {
        let b = snapCorner(pt, e.altKey && d.kind !== 'osbox');
        if (e.shiftKey && d.kind === 'osbox') { const s = Math.max(Math.abs(b.x - d.a.x), Math.abs(b.y - d.a.y)); b = { x: d.a.x + Math.sign(b.x - d.a.x || 1) * s, y: d.a.y + Math.sign(b.y - d.a.y || 1) * s }; }
        d.b = b;
      } else if (d.kind === 'osline') {
        let b = snapCorner(pt, e.altKey);
        if (e.shiftKey) { if (Math.abs(b.x - d.a.x) > Math.abs(b.y - d.a.y)) b = { x: b.x, y: d.a.y }; else b = { x: d.a.x, y: b.y }; }
        d.b = b;
      } else if (d.kind === 'ospath') {
        const q = snapCorr(pt); const [lx, ly] = d.pts[d.pts.length - 1];
        if (Math.abs(q.x - lx) > 1e-4 || Math.abs(q.y - ly) > 1e-4) {
          // along the grid: a corner where it turns
          if (Math.abs(q.x - lx) > 1e-4 && Math.abs(q.y - ly) > 1e-4) {
            const prev = d.pts.length > 1 ? d.pts[d.pts.length - 2] : null;
            const horiz = prev ? Math.abs(prev[1] - ly) < 1e-4 : Math.abs(q.x - lx) >= Math.abs(q.y - ly);
            d.pts.push(horiz ? [q.x, ly] : [lx, q.y]);
          }
          d.pts.push([q.x, q.y]);
          d.pts = straighten(d.pts);
        }
      } else if (d.kind === 'osbrush') {
        const [lx, ly] = d.pts[d.pts.length - 1];
        if (Math.hypot(pt.x - lx, pt.y - ly) >= g() * 0.2) d.pts.push([round(pt.x, 3), round(pt.y, 3)]);
      }
      lastD = d;
      drawPreview(pt, d);
    }
    function pointerUp(d) {
      lastD = null;
      const m = map(); if (!m || !m.os) return;
      if (d.kind === 'osbox') {
        let { a, b } = d;
        if (Math.abs(b.x - a.x) < 1e-4 || Math.abs(b.y - a.y) < 1e-4) { // a click: one square
          const c0 = snapCenter(d.start); const s = O.snap === 'half' ? g() / 2 : g();
          a = { x: c0.x - s / 2, y: c0.y - s / 2 }; b = { x: c0.x + s / 2, y: c0.y + s / 2 };
        }
        const item = { kind: d.cut ? 'cut' : 'area', shape: d.shape, pts: [[a.x, a.y], [b.x, b.y]], ...(d.cut ? {} : areaLook()) };
        add(item, d.cut ? 'Erased' : null);
        if (d.cut) dropDoorsIn(item);
      } else if (d.kind === 'ospath') {
        add({ kind: d.cut ? 'cut' : 'area', shape: 'path', pts: d.pts, r: (O.width * g()) / 2, ...(d.cut ? {} : areaLook()) });
      } else if (d.kind === 'osbrush') {
        add({ kind: d.cut ? 'cut' : 'area', shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05), r: d.r, ...(d.cut ? {} : areaLook()) }, d.cut ? 'Erased' : null);
      } else if (d.kind === 'osline') {
        if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < g() * 0.25) { toast('Drag a wall from corner to corner', { ms: 1800 }); drawPreview(); return; }
        add({ kind: 'line', pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], w: O.line.w * g(), h: O.line.h, mat: O.line.mat });
      } else if (d.kind === 'osstairs') {
        let { a, b } = d;
        const dx = b.x - a.x; const dy = b.y - a.y;
        if (Math.abs(dx) < 1e-4 || Math.abs(dy) < 1e-4) { // at least one square across
          const s = g();
          if (Math.abs(dx) < 1e-4) b = { x: a.x + s, y: b.y };
          if (Math.abs(dy) < 1e-4) b = { x: b.x, y: a.y + s };
        }
        const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : (dy >= 0 ? 1 : 3);
        add({ kind: 'stairs', pts: [[a.x, a.y], [b.x, b.y]], dir, mat: O.line.mat });
      }
      drawPreview();
    }
    const owns = (k) => OWN.has(k);
    function closePoly() {
      const P = O.poly; O.poly = null;
      if (!P || P.pts.length < 3) { drawPreview(); return; }
      const item = { kind: P.cut ? 'cut' : 'area', shape: 'poly', pts: P.pts, ...(P.cut ? {} : areaLook()) };
      add(item, P.cut ? 'Erased' : null);
      drawPreview();
    }
    function cancel() { if (O.poly) { O.poly = null; drawPreview(); return true; } return false; }
    // Enter closes a shape, Esc drops it, Backspace takes its last corner back
    window.addEventListener('keydown', (e) => {
      if (ui.tool !== 'oldschool' || !O.poly) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); closePoly(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
      else if (e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); O.poly.pts.pop(); if (!O.poly.pts.length) O.poly = null; drawPreview(); }
    }, true);
    function rightClick() { if (O.poly) { closePoly(); return true; } return false; }
    function dblClick() { if (O.poly && O.poly.pts.length >= 3) { closePoly(); return true; } return false; }

    // a straight run of points has no corners in between
    function straighten(pts) {
      const out = [];
      for (const p of pts) {
        out.push(p);
        while (out.length >= 3) {
          const [a, b, c2] = out.slice(-3);
          const cross = (b[0] - a[0]) * (c2[1] - a[1]) - (b[1] - a[1]) * (c2[0] - a[0]);
          if (Math.abs(cross) < 1e-6) out.splice(out.length - 2, 1); else break;
        }
      }
      return out;
    }
    function simplifyPts(pts, tol) {
      if (pts.length < 3) return pts;
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) { const [x, y] = out[out.length - 1]; if (Math.hypot(pts[i][0] - x, pts[i][1] - y) >= tol) out.push(pts[i]); }
      out.push(pts[pts.length - 1]);
      return out;
    }
    // the Floor tool: the floor clicked gets the picked tile (and/or the edge)
    function repaint(pt) {
      const it = Oldschool.areaAt(map().os, pt.x, pt.y);
      if (!it) { toast('No floor here', { ms: 1400 }); return; }
      const L = areaLook();
      const patch = O.floorMode === 'edge' ? { edge: L.edge, mat: L.mat } : O.floorMode === 'both' ? { tile: L.tile, edge: L.edge, mat: L.mat } : { tile: L.tile };
      cmd('os.update', { id: it.id, ...patch }).then((r) => { if (r && r.ok) toast(O.floorMode === 'edge' ? 'New edge' : 'New floor', { ms: 1400, undo: () => cmd('history.undo') }); });
    }
    // a door on the grid line nearest to the click, one square long
    function placeDoor(pt) {
      const G = grid(); const s = g();
      const u = (pt.x - G.ox) / s; const v = (pt.y - G.oy) / s;
      const du = Math.abs(u - Math.round(u)); const dv = Math.abs(v - Math.round(v));
      let x1; let y1; let x2; let y2;
      if (du <= dv) { const x = G.ox + Math.round(u) * s; const y0 = G.oy + Math.floor(v) * s; x1 = x; x2 = x; y1 = y0; y2 = y0 + s; }
      else { const y = G.oy + Math.round(v) * s; const x0 = G.ox + Math.floor(u) * s; y1 = y; y2 = y; x1 = x0; x2 = x0 + s; }
      // a door already there: it goes (a click again takes it away)
      const old = map().os.doors.find((d) => Math.hypot((d.x1 + d.x2) / 2 - (x1 + x2) / 2, (d.y1 + d.y2) / 2 - (y1 + y2) / 2) < s * 0.2);
      if (old) { cmd('os.remove', { id: old.id }).then((r) => { if (r && r.ok) toast('Door removed', { ms: 1400, undo: () => cmd('history.undo') }); }); return; }
      const p = { x1: round(x1, 4), y1: round(y1, 4), x2: round(x2, 4), y2: round(y2, 4), door: O.door === 'secret' ? 2 : 1, ...(O.door === 'window' ? { kind: 'window' } : {}) };
      pending.push({ kind: 'door', ...p, at: Date.now() }); drawPreview();
      cmd('os.door', p).then((r) => { if (r && r.ok) toast(r.label || 'Door added', { ms: 1400, undo: () => cmd('history.undo') }); });
    }
    // erasing a box or a round takes the doors in it away too
    function dropDoorsIn(item) {
      const [[ax, ay], [bx, by]] = item.pts;
      const x0 = Math.min(ax, bx); const x1 = Math.max(ax, bx); const y0 = Math.min(ay, by); const y1 = Math.max(ay, by);
      const ids = map().os.doors.filter((d) => { const mx = (d.x1 + d.x2) / 2; const my = (d.y1 + d.y2) / 2; return mx >= x0 && mx <= x1 && my >= y0 && my <= y1; }).map((d) => d.id);
      if (ids.length) cmd('os.remove', { ids });
    }

    // ---------- what is being drawn (and what was just drawn, until its picture comes) ----------
    let svg = null; let pending = []; let lastBg = null;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); return e; };
    function patternFor(defs, ref) {
      const t = Oldschool.tileInfo(ref, lib); if (!t) return '#77736c';
      const id = `osp-${btoa(unescape(encodeURIComponent(t.url))).replace(/[^a-z0-9]/gi, '').slice(-24)}`;
      if (!defs.querySelector(`#${id}`)) {
        const s = (t.squares || 4) * g(); const G = grid();
        const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', x: G.ox, y: G.oy, width: s, height: s });
        p.append(el('image', { href: t.url, x: 0, y: 0, width: s, height: s, preserveAspectRatio: 'none' }));
        defs.append(p);
      }
      return `url(#${id})`;
    }
    function shapeEl(it, fill, extra) {
      const P = it.pts;
      if (it.shape === 'rect' || it.kind === 'stairs') { const [[ax, ay], [bx, by]] = P; return el('rect', { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), fill, ...extra }); }
      if (it.shape === 'round') { const [[ax, ay], [bx, by]] = P; return el('ellipse', { cx: (ax + bx) / 2, cy: (ay + by) / 2, rx: Math.abs(bx - ax) / 2, ry: Math.abs(by - ay) / 2, fill, ...extra }); }
      if (it.shape === 'poly') return el('polygon', { points: P.map((q) => q.join(',')).join(' '), fill, ...extra });
      if (it.shape === 'path' || it.shape === 'brush' || it.kind === 'line') {
        const pts = P.length === 1 ? [...P, [P[0][0] + 0.001, P[0][1]]] : P;
        const w = it.kind === 'line' ? it.w : it.r * 2;
        return el('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: fill, 'stroke-width': w, 'stroke-linecap': it.shape === 'brush' ? 'round' : 'square', 'stroke-linejoin': it.shape === 'brush' ? 'round' : 'miter', ...extra });
      }
      if (it.kind === 'pillar') { const [[x, y]] = P; return it.round ? el('circle', { cx: x, cy: y, r: it.r, fill, ...extra }) : el('rect', { x: x - it.r, y: y - it.r, width: it.r * 2, height: it.r * 2, fill, ...extra }); }
      if (it.kind === 'door') return el('line', { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, stroke: '#8a5d34', 'stroke-width': g() * 0.2, ...extra });
      return null;
    }
    function drawPreview(pt, d) {
      const v = view(); if (!v || !v.marks) return;
      if (!svg) { svg = el('svg', { class: 'os-preview' }); }
      if (svg.parentNode !== v.marks) v.marks.appendChild(svg);
      svg.replaceChildren();
      const m = map();
      if (!m || !m.os || (ui.tool !== 'oldschool' && !pending.length)) return;
      const p0 = v.mapToPx(0, 0); const px = v.mapToPx(1, 0); const py = v.mapToPx(0, 1);
      const defs = el('defs'); svg.append(defs);
      const root = el('g', { transform: `matrix(${px.x - p0.x} ${px.y - p0.y} ${py.x - p0.x} ${py.y - p0.y} ${p0.x} ${p0.y})` });
      svg.append(root);
      const thin = (0.06 * g()).toFixed(4);
      const look = (it) => (it.kind === 'cut' ? 'rgba(10,10,12,0.85)' : it.kind === 'line' || it.kind === 'pillar' || it.kind === 'stairs' ? 'rgba(140,135,128,0.95)' : patternFor(defs, it.tile));
      for (const it of pending) { const e2 = shapeEl(it, look(it), { opacity: '0.95' }); if (e2) root.append(e2); }
      // the one being drawn
      if (ui.tool !== 'oldschool') return;
      let cur = null;
      if (d && d.kind === 'osbox') cur = { kind: d.cut ? 'cut' : 'area', shape: d.shape, pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], tile: O.floor };
      else if (d && d.kind === 'ospath') cur = { kind: d.cut ? 'cut' : 'area', shape: 'path', pts: d.pts, r: (O.width * g()) / 2, tile: O.floor };
      else if (d && d.kind === 'osbrush') cur = { kind: d.cut ? 'cut' : 'area', shape: 'brush', pts: d.pts, r: d.r, tile: O.floor };
      else if (d && d.kind === 'osline') cur = { kind: 'line', pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], w: O.line.w * g() };
      else if (d && d.kind === 'osstairs') cur = { kind: 'stairs', pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]] };
      if (cur) { const e2 = shapeEl(cur, look(cur), { opacity: cur.kind === 'cut' ? '0.7' : '0.9', stroke: cur.kind === 'line' || cur.shape === 'path' || cur.shape === 'brush' ? undefined : '#f0b44a', 'stroke-width': thin, 'stroke-dasharray': `${thin * 3} ${thin * 2}` }); if (e2) root.append(e2); }
      if (O.poly) {
        const pts = [...O.poly.pts]; if (pt) { const q = snapCorner(pt); pts.push([q.x, q.y]); }
        if (pts.length >= 3) root.append(el('polygon', { points: pts.map((q) => q.join(',')).join(' '), fill: O.poly.cut ? 'rgba(10,10,12,0.7)' : patternFor(defs, O.floor), opacity: '0.85' }));
        root.append(el('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: '#f0b44a', 'stroke-width': thin }));
        const [fx, fy] = O.poly.pts[0];
        root.append(el('circle', { cx: fx, cy: fy, r: g() * 0.15, fill: '#f0b44a' }));
      }
      // where a click would go (pillars and doors)
      if (pt && !d && (O.tool === 'pillar' || O.tool === 'door')) {
        if (O.tool === 'pillar') { const q = snapCenter(pt); root.append(shapeEl({ kind: 'pillar', pts: [[q.x, q.y]], r: O.pillar.r * g(), round: O.pillar.round }, 'rgba(240,180,74,0.5)')); }
        else {
          const G = grid(); const s = g(); const u = (pt.x - G.ox) / s; const v2 = (pt.y - G.oy) / s;
          const vert = Math.abs(u - Math.round(u)) <= Math.abs(v2 - Math.round(v2));
          const a = vert ? [G.ox + Math.round(u) * s, G.oy + Math.floor(v2) * s] : [G.ox + Math.floor(u) * s, G.oy + Math.round(v2) * s];
          root.append(el('line', { x1: a[0], y1: a[1], x2: a[0] + (vert ? 0 : s), y2: a[1] + (vert ? s : 0), stroke: '#f0b44a', 'stroke-width': g() * 0.18, 'stroke-linecap': 'round' }));
        }
      }
    }
    let lastPt = null; let lastD = null;
    function hover(e, pt) { lastPt = pt; if (ui.tool === 'oldschool' && (O.poly || O.tool === 'pillar' || O.tool === 'door')) drawPreview(pt); }
    function leave() { lastPt = null; if (ui.tool === 'oldschool') drawPreview(); }
    // the view moved or zoomed: the preview follows
    function redraw() { if (svg && (ui.tool === 'oldschool' || pending.length)) drawPreview(lastPt, lastD); }

    // ---------- making the picture ----------
    let baking = false; let again = false; let timer = 0; let status = 'idle'; let lastErr = null;
    function update() {
      const m = map();
      const bgKey = m && m.bg ? `${m.bg.path}|${m.bg.os}` : '';
      if (bgKey !== lastBg) { lastBg = bgKey; if (pending.length) { pending = pending.filter((x) => Date.now() - x.at < 600 && baking); drawPreview(); } }
      if (!m || !m.os) { if (svg) svg.replaceChildren(); return; }
      if (ui.tool === 'oldschool' || pending.length) drawPreview();
      // a tile of the library not known yet (or its squares): the library is read again first
      if (m.os.items.some((it) => it.tile && !Oldschool.tileInfo(it.tile, []) && !lib.some((x) => (it.tile.rel && x.rel === it.tile.rel) || (it.tile.path && x.path === it.tile.path)))) loadLib();
      const want = Oldschool.hash(m, lib);
      const has = m.bg && !m.bg.missing ? m.bg.os : (m.os.items.length ? null : want);
      if (has === want) { if (status !== 'idle') { status = 'idle'; ctx.refreshPop(); } return; }
      clearTimeout(timer);
      timer = setTimeout(bake, 320);
    }
    async function bake() {
      if (baking) { again = true; return; }
      const m = map(); if (!m || !m.os) return;
      baking = true; status = 'busy'; ctx.refreshPop();
      const mapId = m.id; const snap = structuredClone({ os: m.os, grid: m.grid });
      const want = Oldschool.hash(snap, lib);
      try {
        const r = await Oldschool.bake(snap, lib);
        if (map() && map().id === mapId) {
          const data = r.blob ? new Uint8Array(await r.blob.arrayBuffer()) : null;
          await ts.cmd('os.baked', { mapId, hash: want, empty: !!r.empty, data, x: r.x, y: r.y, scale: r.scale, nw: r.nw, nh: r.nh, walls: r.walls });
        }
        lastErr = null;
      } catch (err) { console.error(err); lastErr = String(err && err.message || err); }
      baking = false; status = 'idle';
      pending = pending.filter((x) => Date.now() - x.at < 300);
      drawPreview();
      ctx.refreshPop();
      if (again) { again = false; update(); }
    }

    // ---------- tiles: the squares a tile spans, set once ----------
    async function pickTile(it) {
      if (!it) return;
      if (!it.builtin && !it.squares) { const n = await askSquares(it); if (!n) return; it.squares = n; }
      O.floor = { rel: it.rel, ...(it.rel ? {} : { path: it.path }) }; save();
      ctx.refreshPop(); drawPreview();
    }
    function askSquares(it) {
      return new Promise((resolve) => {
        let n = 4; let done = false;
        const cv = h('canvas', { class: 'os-tilegrid', width: 320, height: 320 });
        const img = new Image();
        const paint = () => {
          const g2 = cv.getContext('2d'); g2.clearRect(0, 0, 320, 320);
          if (img.naturalWidth) g2.drawImage(img, 0, 0, 320, 320);
          g2.strokeStyle = 'rgba(240,180,74,0.95)'; g2.lineWidth = 1.5;
          for (let i = 0; i <= n; i++) { const p = Math.round((i * 320) / n) + 0.5; g2.beginPath(); g2.moveTo(p, 0); g2.lineTo(p, 320); g2.stroke(); g2.beginPath(); g2.moveTo(0, p); g2.lineTo(320, p); g2.stroke(); }
          out.textContent = `${n} × ${n} squares`;
        };
        const out = h('b', {});
        img.onload = () => {
          try { const gd = typeof GridDetect === 'object' ? GridDetect.fromImage(img, img.naturalWidth, img.naturalHeight) : null; if (gd && gd.cell) n = clamp(Math.round((img.naturalWidth / gd.cell) * 2) / 2, 1, 24); } catch { /* */ }
          paint();
        };
        img.src = it.url || UI.pathToUrl(it.path);
        const step = (dv) => { n = clamp(n + dv, 1, 24); paint(); };
        const body = h('div', { class: 'stack os-squares' },
          h('p', {}, 'How many squares does it span? Match the lines to its blocks.'), cv,
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => step(-0.5) }, iconEl('minus')), out, h('button', { class: 'btn', onclick: () => step(0.5) }, iconEl('plus')), h('span', { class: 'grow' }),
            h('button', { class: 'btn primary', onclick: async () => { done = true; await ts.library('tileSquares', { path: it.path, squares: n }); libAt = 0; await loadLib(true); dlg.close(); resolve(n); } }, 'Use it')));
        const dlg = UI.dialog(`${it.name}: its squares`, body, { onClose: () => { if (!done) resolve(null); } });
      });
    }

    // ---------- the panel ----------
    function buildPop() {
      const { slider, toggle, seg, btn, row, hint, sep, bind } = c();
      loadLib();
      const m = map();
      if (!m || !m.os) return h('div', { class: 'stack' }, hint('Draw works on Oldschool maps: Add map → Oldschool map.'));
      const tools = h('div', { class: 'tiles os-tools' }, ...TOOLS.map((t) => h('button', {
        class: 'tile', dataset: { v: t.id }, 'data-tip': t.tip, 'aria-label': t.label,
        onclick: () => { O.tool = t.id; O.poly = null; save(); ctx.openPop('oldschool'); drawPreview(); },
      }, iconEl(t.icon), h('span', {}, t.label))));
      bind(() => { for (const b of tools.children) b.classList.toggle('on', b.dataset.v === O.tool); });
      const opts = [];
      const t = O.tool;
      if (AREA_TOOLS.includes(t)) {
        if (t === 'corridor') opts.push(seg({ options: [1, 2, 3].map((n) => ({ value: n, label: `${n} square${n > 1 ? 's' : ''}` })), get: () => O.width, set: (v) => { O.width = v; save(); } }));
        if (t === 'brush') opts.push(slider({ label: 'Brush', min: 0.5, max: 6, step: 0.5, get: () => O.brush, set: (v) => { O.brush = v; save(); }, fmt: (v) => `${v} squares` }));
        opts.push(seg({ cls: 'os-level', options: [{ value: -1, label: 'Lower', icon: 'arrow-down' }, { value: 0, label: 'Floor' }, { value: 1, label: 'Raised', icon: 'arrow-up' }], get: () => O.level, set: (v) => { O.level = v; save(); } }));
      } else if (t === 'erase') {
        opts.push(seg({ options: [{ value: 'box', label: 'Box', icon: 'square' }, { value: 'round', label: 'Round', icon: 'circle' }, { value: 'brush', label: 'Brush', icon: 'brush' }], get: () => O.erase, set: (v) => { O.erase = v; save(); ctx.refreshPop(); } }));
        if (O.erase === 'brush') opts.push(slider({ label: 'Brush', min: 0.5, max: 6, step: 0.5, get: () => O.brush, set: (v) => { O.brush = v; save(); }, fmt: (v) => `${v} squares` }));
      } else if (t === 'wall' || t === 'pillar' || t === 'stairs') {
        if (t === 'wall') {
          opts.push(seg({ options: [{ value: 0.25, label: 'Thin' }, { value: 0.5, label: 'Normal' }, { value: 1, label: 'Thick' }], get: () => O.line.w, set: (v) => { O.line.w = v; save(); } }));
          opts.push(seg({ options: [{ value: 0.4, label: 'Low' }, { value: 1, label: 'Full height' }], get: () => O.line.h, set: (v) => { O.line.h = v; save(); } }));
        }
        if (t === 'pillar') {
          opts.push(seg({ options: [{ value: false, label: 'Square', icon: 'square' }, { value: true, label: 'Round', icon: 'circle' }], get: () => O.pillar.round, set: (v) => { O.pillar.round = v === true || v === 'true'; save(); } }));
          opts.push(slider({ label: 'Size', min: 0.2, max: 1.5, step: 0.05, get: () => O.pillar.r * 2, set: (v) => { O.pillar.r = v / 2; save(); }, fmt: (v) => `${round(v, 2)} square${v === 1 ? '' : 's'}` }));
        }
        opts.push(h('div', { class: 'ctl-label' }, t === 'stairs' ? 'Steps of' : 'Made of'), matPicker(() => O.line.mat, (v) => { O.line.mat = v; save(); }, ['stone_wall', 'dark_stone_wall', 'hedge', 'rock', 'cliff']));
      } else if (t === 'door') {
        opts.push(seg({ options: [{ value: 'door', label: 'Door', icon: 'door' }, { value: 'secret', label: 'Secret', icon: 'eye-off' }, { value: 'window', label: 'Window', icon: 'window' }], get: () => O.door, set: (v) => { O.door = v; save(); } }));
      } else if (t === 'floor') {
        opts.push(seg({ label: 'A click changes', options: [{ value: 'tile', label: 'Floor' }, { value: 'edge', label: 'Edge' }, { value: 'both', label: 'Both' }], get: () => O.floorMode, set: (v) => { O.floorMode = v; save(); } }));
      }
      const snapSeg = seg({ options: [{ value: 'sq', label: 'Squares' }, { value: 'half', label: 'Half' }, { value: 'free', label: 'Free' }], get: () => O.snap, set: (v) => { O.snap = v; save(); } });
      // the floor tiles: those of the app, then those of the library
      const floorBox = h('div', { class: 'living-pick os-floors' });
      const floorList = () => [...Oldschool.FLOORS.map((f) => ({ rel: Oldschool.relOf(f), name: f.label, url: Oldschool.tileInfo({ rel: Oldschool.relOf(f) }).small, builtin: true, squares: f.squares })), ...lib.filter((x) => !x.builtin)];
      const paintFloors = () => {
        const list = floorList();
        const sig = list.map((x) => `${x.rel || x.path}:${x.squares}`).join('|');
        if (floorBox.dataset.sig !== sig) {
          floorBox.dataset.sig = sig;
          floorBox.replaceChildren(h('div', { class: 'tiles living-tiles' }, ...list.map((it) => h('button', {
            class: 'tile', dataset: { v: it.rel || it.path }, 'data-tip': `${it.name}${it.squares ? ` (${it.squares} × ${it.squares} squares)` : ''}`, 'aria-label': it.name,
            onclick: () => pickTile(it),
          }, h('img', { src: it.builtin ? it.url : it.thumb || it.url, alt: '', draggable: false }), h('span', {}, it.name))),
          h('button', { class: 'tile os-more', 'data-tip': 'Your own tiles: the library\'s Tiles section', onclick: () => ctx.openLibrary() }, iconEl('plus'), h('span', {}, 'More'))));
        }
        const cur = O.floor ? O.floor.rel || O.floor.path : null;
        for (const b of floorBox.querySelectorAll('.tile[data-v]')) b.classList.toggle('on', b.dataset.v === cur);
      };
      bind(paintFloors);
      const edgeSeg = seg({ cls: 'seg-4', options: Oldschool.EDGES.map((e) => ({ value: e, label: EDGE_LABEL[e] })), get: () => O.edge, set: (v) => { O.edge = v; save(); ctx.refreshPop(); } });
      const edgeMat = h('div', {}, matPicker(() => O.mats[O.edge], (v) => { O.mats[O.edge] = v; save(); }, O.edge === 'walls' ? ['stone_wall', 'dark_stone_wall', 'hedge'] : ['rock', 'cliff', 'stone_wall', 'dark_stone_wall']));
      bind(() => { edgeMat.hidden = O.edge === 'ledge'; });
      const light = slider({ label: 'Light from', min: 0, max: 355, step: 5, get: () => (360 - (map().os.sun ?? 135) + 90) % 360, set: (v, k) => ctx.send(k || 'os-sun', 'os.set', { sun: (360 - v + 90 + 360) % 360 }), fmt: (v) => ['above', 'top right', 'the right', 'bottom right', 'below', 'bottom left', 'the left', 'top left'][Math.round(v / 45) % 8] });
      const sight = toggle({ label: 'Walls for sight follow the drawing', get: () => map().os.sight !== false, set: (v) => cmd('os.set', { sight: v }) });
      const st = h('div', { class: 'row os-status' });
      bind(() => {
        const busy = baking || status === 'busy';
        const txt = lastErr ? 'The picture could not be made (see the log)' : busy ? 'Making the picture …' : map().os.items.length ? 'Picture up to date' : 'Draw a room to start';
        if (st.dataset.t === txt) return; st.dataset.t = txt;
        st.replaceChildren(h('span', { class: `grow hint ${busy ? 'busy' : ''}` }, txt), btn('Clear', 'trash', async () => { if (!map().os.items.length) return; const r = await cmd('os.clear', {}); if (r && r.ok) toast('Drawing cleared', { undo: () => cmd('history.undo') }); }, { kind: 'small', tip: 'Take everything drawn away (undo brings it back)' }));
      });
      return h('div', { class: 'stack' }, tools, ...opts, snapSeg, sep(),
        h('div', { class: 'ctl-label' }, 'Floor'), floorBox,
        h('div', { class: 'ctl-label' }, 'Edge'), edgeSeg, edgeMat,
        sep(), light, sight, st);
    }
    function matPicker(get, set, ids) {
      const { bind } = c();
      const box = h('div', { class: 'tiles living-tiles os-mats' }, ...ids.map((id) => { const t = Oldschool.DATA.tiles.find((x) => x.id === id); return h('button', { class: 'tile', dataset: { v: id }, 'aria-label': t.label, 'data-tip': t.label, onclick: () => { set(id); paintM(); } }, h('img', { src: new URL(`tiles/${t.small}`, document.baseURI).href, alt: '', draggable: false }), h('span', {}, t.label)); }));
      const paintM = () => { for (const b of box.children) b.classList.toggle('on', b.dataset.v === get()); };
      bind(paintM);
      return box;
    }
    // a tile picked in the library (purpose 'tile')
    function useTile(it) { pickTile({ ...it }); ctx.setTool('oldschool'); ctx.openPop('oldschool'); }
    // a tile dragged from the library onto the map: it becomes the floor to draw with, and the floor it lands on gets it
    async function dropTile(a, pt) {
      if (!map() || !map().os) { toast('Tiles are floors for Oldschool maps: Add map → Oldschool map', { ms: 3200 }); return; }
      await loadLib(true);
      const it = lib.find((x) => x.path === a.path);
      if (!it) return;
      await pickTile({ ...it });
      if (!O.floor || (O.floor.rel || O.floor.path) !== (it.rel || it.path)) return; // (the squares were not given)
      const at = Oldschool.areaAt(map().os, pt.x, pt.y);
      if (at) cmd('os.update', { id: at.id, tile: O.floor }).then((r) => { if (r && r.ok) toast(`${it.name} on that floor`, { ms: 1600, undo: () => cmd('history.undo') }); });
      if (ui.tool !== 'oldschool') ctx.setTool('oldschool');
      ctx.openPop('oldschool');
    }

    const hashOf = (m) => Oldschool.hash(m, lib); // (for the self-test)
    return { hashOf, owns, pointerDown, pointerMove, pointerUp, hover, leave, redraw, update, buildPop, cancel, rightClick, dblClick, useTile, dropTile, loadLib, get busy() { return baking; }, TOOLS };
  }
  return { create };
})();
