// The Draw tool (Beta 3.22) on the GM screen: drawing an Oldschool map on the grid.
//   Room / Round       drag a box (Shift: a square or a circle)
//   Shape              click its corners; click the first one again, double-click, Enter or right-click closes it
//   Brush              paint freely (caves)
//   Erase              a box, a round or a brush that takes floor, walls and pillars away (Alt erases with any floor tool)
//   Wall               drag a wall line from corner to corner
//   Pillar             click a square
//   Stairs             drag where they go: they climb toward where you drag
//   Door               click a grid line: a door or a secret door there; drag along it: one of any length
//   Window             the same for a window (Beta 3.35: a tool of its own)
//   Tile               (Beta 3.37) another tile on floor that is there, and nothing else (not its level, edge or shape):
//                      click a floor for the whole of it, or paint the tile onto the floors under the brush
//   (Beta 3.28: Corridor, Floor and Pieces are gone; what they made still draws. Beta 3.29: Ground is gone)
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
    { id: 'brush', label: 'Brush', icon: 'brush', tip: 'Paint freely: caves, rough ground' },
    { id: 'floor', label: 'Tile', icon: 'color-swatch', tip: 'Another tile on a floor that is there: nothing else changes' },
    { id: 'erase', label: 'Erase', icon: 'eraser', tip: 'Take floor, walls and pillars away (Alt erases with any floor tool)' },
    { id: 'wall', label: 'Wall', icon: 'wall', tip: 'Drag a wall from corner to corner' },
    { id: 'pillar', label: 'Pillar', icon: 'square-dashed', tip: 'Click a square for a pillar' },
    { id: 'stairs', label: 'Stairs', icon: 'stairs', tip: 'Drag where they go: they climb toward where you drag' },
    { id: 'door', label: 'Door', icon: 'door', tip: 'Click a wall or a grid line: a door there; drag along it: a longer one' },
    { id: 'window', label: 'Window', icon: 'window', tip: 'Click a wall or a grid line: a window there; drag along it: a longer one' },
  ];
  // Beta 3.28: Corridor, Floor and Pieces left the toolbar (what they made still draws and erases)
  // Beta 3.25: the ground the Ground tool lays (the effects of the same name, with a pool in the picture)
  const GROUNDS = [
    { id: 'water', label: 'Water', icon: 'ripple', color: 'rgba(40,110,125,0.85)' },
    { id: 'lava', label: 'Lava', icon: 'volcano', color: 'rgba(220,80,20,0.9)' },
    { id: 'acid', label: 'Acid', icon: 'flask', color: 'rgba(110,180,40,0.85)' },
    { id: 'darkness', label: 'Magical darkness', icon: 'spiral', color: 'rgba(6,4,10,0.92)' },
    { id: 'swamp', label: 'Swamp', icon: 'plant', color: 'rgba(70,84,40,0.9)' },
  ];
  const AREA_TOOLS = ['room', 'shape', 'round', 'brush'];
  const OWN = new Set(['osbox', 'ospath', 'osbrush', 'osline', 'osstairs', 'osdoor']);
  const EDGE_LABEL = { walls: 'Walls', rock: 'Rock', ledge: 'Ledge', cliff: 'Cliff', fade: 'Fade' };

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const view = () => ctx.view();
    const map = () => (S() ? S().map : null);
    const c = () => ctx.ctl;
    const first = Oldschool.FLOORS[0];
    const prefs = {
      tool: 'room', snap: 'sq', level: 0, width: 1, brush: 1.5, erase: 'box', edge: 'walls', mats: { ...Oldschool.DEFAULT_MAT },
      line: { w: 0.5, h: 1, mat: 'stone_wall' }, pillar: { r: 0.3, round: false }, door: 'door', doorLeaf: 'wood', windowLeaf: 'clear', floorMode: 'tile', piece: 'tavern', turn: 0, ground: 'water', groundShape: 'box', mixW: 1.5, mixU: 0.5, mixT: 0.5, floorHow: 'click', fx: null, tint: '', waterTint: '', fxSoft: true, fxShape: 'box', // (Beta 3.43: an effect picked instead of a tile, the grass's colour, its soft edge; 3.46: the water's colour, how the effect is drawn)
      floor: first ? { rel: Oldschool.relOf(first) } : null,
    };
    try { const saved = JSON.parse(localStorage.getItem('osPrefs') || '{}'); if ('mix' in saved && !('mixU' in saved)) { delete saved.mix; delete saved.mixW; } Object.assign(prefs, saved, { mats: { ...prefs.mats, ...(saved.mats || {}) }, line: { ...prefs.line, ...(saved.line || {}) }, pillar: { ...prefs.pillar, ...(saved.pillar || {}) } }); } catch {}
    if (prefs.door === 'window') { prefs.door = 'door'; if (prefs.tool === 'door') prefs.tool = 'window'; } // (Beta 3.35: windows have a tool of their own)
    prefs.floorMode = 'tile'; // (Beta 3.37: the Tile tool changes the tile alone)
    if (!TOOLS.some((x) => x.id === prefs.tool)) prefs.tool = 'room';
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
    // Beta 3.35: a pillar of 2, 4, 6 or 8 squares sits on a grid corner, so it covers whole squares; others on a square
    const pillarAt = (p, free) => { const n = O.pillar.r * 2; return !free && Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) % 2 === 0 ? snapCorner(p) : snapCenter(p, free); };
    // a corridor's line runs through square centres (odd widths) or along grid lines (even ones)
    const snapCorr = (p, free) => (free || O.snap === 'free' ? snapCorner(p, true) : O.width % 2 === 1 ? snapCenter(p) : snapCorner(p));

    // ---------- what a new floor gets ----------
    const areaLook = () => ({ tile: O.floor, edge: O.edge, mat: O.edge === 'ledge' ? 'stone_wall' : O.mats[O.edge] || Oldschool.DEFAULT_MAT[O.edge], level: O.level, mixW: O.mixW, mixU: O.mixU, mixT: O.mixT });
    // Beta 3.43: an effect picked instead of a tile (grass, water, lava, shimmer, pulse, ripple). What is drawn then
    // is the effect alone, over the floors that are there. Beta 3.46: the effects are a blue block of their own under
    // Tile, each drawn with a box, round, a shape, a brush, poured over one height (Fill) or taken away (Erase; Alt
    // with the others does that too)
    const FX_SHAPES = [
      { id: 'box', label: 'Box', icon: 'square', tool: 'room', tip: 'Drag a box (Shift: a square · Alt: take the effect away)' },
      { id: 'round', label: 'Round', icon: 'circle', tool: 'round', tip: 'Drag a round patch (Shift: a circle)' },
      { id: 'shape', label: 'Shape', icon: 'polygon', tool: 'shape', tip: 'Click the corners; click the first again (or Enter) to close it' },
      { id: 'brush', label: 'Brush', icon: 'brush', tool: 'brush', tip: 'Paint it on freely' },
      { id: 'fill', label: 'Fill', icon: 'droplet', tool: 'fxfill', tip: 'Click a floor: the effect on all the floor at that height that is joined to it (water fills a pit to its rim)' },
      { id: 'erase', label: 'Erase', icon: 'eraser', tool: 'brush', tip: 'Brush effects away; the floor stays' },
    ];
    const FX_TOOLS = [...AREA_TOOLS, 'fxfill'];
    const fxNow = () => (O.fx && FX_TOOLS.includes(O.tool) && Oldschool.LIVE_FX.some((x) => x.id === O.fx) ? O.fx : null);
    const fxInfo = (id) => Oldschool.LIVE_FX.find((x) => x.id === id) || null;
    const fxColor = (id) => (id === 'none' ? 'rgba(10,10,12,0.5)' : (fxInfo(id) || { color: 'rgba(255,255,255,0.4)' }).color);
    const fxTint = (fx) => (fx === 'grass' ? O.tint : fx === 'water' ? O.waterTint : '') || '';
    const made = (geo, cut) => {
      const fx = fxNow();
      if (fx) return { kind: 'live', ...geo, fx: cut ? 'none' : fx, ...(!cut && /^#[0-9a-f]{6}$/.test(fxTint(fx)) ? { tint: fxTint(fx) } : {}), mixW: O.fxSoft === false || geo.shape === 'fill' ? 0 : 1.5 };
      return { kind: cut ? 'cut' : 'area', ...geo, ...(cut ? {} : areaLook()) };
    };
    function add(item, label) {
      if (!map() || !map().os) return;
      if (item.shape !== 'fill') pending.push({ ...item, at: Date.now() }); // (a poured effect has no outline to show until the picture knows where it ran)
      drawPreview();
      return cmd('os.add', { item }).then((r) => { if (r && r.ok && label !== false) toast(label || r.label || 'Drawn', { ms: 1400, undo: () => cmd('history.undo') }); return r; });
    }

    // ---------- the pointer ----------
    function pointerDown(e, pt) {
      const m = map(); if (!m || !m.os) return null;
      const free = e.altKey && !AREA_TOOLS.includes(O.tool) && O.tool !== 'erase';
      const cut = O.tool === 'erase' || (e.altKey && AREA_TOOLS.includes(O.tool)) || (!!fxNow() && O.fxShape === 'erase'); // (3.46: an effect's own Erase)
      const t = O.tool;
      if (t === 'fxfill') { if (fxNow()) add(made({ shape: 'fill', pts: [[round(pt.x, 3), round(pt.y, 3)]] }, e.altKey)); return null; } // (3.46: poured over one height)
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
      if (t === 'floor' && O.floorHow === 'paint') return { kind: 'osbrush', pts: [[round(pt.x, 3), round(pt.y, 3)]], paint: true, r: (O.brush * g()) / 2 }; // (Beta 3.26)
      if (t === 'floor') { repaint(pt); return null; }
      if (t === 'pillar') { const p = pillarAt(pt, e.altKey); add({ kind: 'pillar', pts: [[p.x, p.y]], r: O.pillar.r * g(), round: O.pillar.round, mat: O.line.mat }); return null; }
      if (t === 'door' || t === 'window') return { kind: 'osdoor', a: pt, b: pt }; // (Beta 3.33: a click, or a drag along a grid line)
      if (t === 'piece') { stamp(pt); return null; }
      if (t === 'corridor' && !cut) { const p = snapCorr(pt); return { kind: 'ospath', pts: [[p.x, p.y]], cut }; }
      if (t === 'ground' && O.groundShape === 'brush') return { kind: 'osbrush', pts: [[round(pt.x, 3), round(pt.y, 3)]], ground: O.ground, r: (O.brush * g()) / 2 };
      if (t === 'ground') { const p = snapCorner(pt, free); return { kind: 'osbox', a: p, b: p, shape: O.groundShape === 'round' ? 'round' : 'rect', ground: O.ground, start: pt }; }
      if (t === 'brush' || (t === 'erase' && O.erase === 'brush')) return { kind: 'osbrush', pts: [[round(pt.x, 3), round(pt.y, 3)]], cut, r: (O.brush * g()) / 2 };
      if (t === 'wall') { const p = snapCorner(pt, e.altKey); return { kind: 'osline', a: p, b: p }; }
      if (t === 'stairs') { const p = snapCorner(pt, e.altKey); return { kind: 'osstairs', a: p, b: p }; }
      // room, round, erase box/round, and a corridor erased
      const p = snapCorner(pt, free);
      const shape = t === 'round' || (t === 'erase' && O.erase === 'round') ? 'round' : 'rect';
      return { kind: 'osbox', a: p, b: p, shape, cut, start: pt };
    }
    function pointerMove(d, e, pt) {
      if (d.kind === 'osdoor') { d.b = pt; lastD = d; drawPreview(pt, d); return; }
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
      if (d.kind === 'osdoor') { // (Beta 3.33) a click: a door of one square, or the one there goes; a drag: any length
        const seg = doorFor(d.a, d.b);
        if (!seg) placeDoor(d.a);
        else if (seg.wall && Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < g() / 3) { // (a click on a wall off the grid: a door there, or the one there goes)
          const on = (x) => { const lx = x.x2 - x.x1; const ly = x.y2 - x.y1; const L2 = lx * lx + ly * ly || 1; const u = Math.max(0, Math.min(1, ((d.a.x - x.x1) * lx + (d.a.y - x.y1) * ly) / L2)); return Math.hypot(d.a.x - x.x1 - lx * u, d.a.y - x.y1 - ly * u); };
          const old = m.os.doors.filter((x) => on(x) < g() * 0.6).sort((p, q) => on(p) - on(q))[0];
          if (old) cmd('os.remove', { id: old.id }).then((r) => { if (r && r.ok) toast('Door removed', { ms: 1400, undo: () => cmd('history.undo') }); });
          else putDoor(seg);
        } else putDoor(seg);
        drawPreview(); return;
      }
      if (d.kind === 'osbox') {
        let { a, b } = d;
        if (Math.abs(b.x - a.x) < 1e-4 || Math.abs(b.y - a.y) < 1e-4) { // a click: one square
          const c0 = snapCenter(d.start); const s = O.snap === 'half' ? g() / 2 : g();
          a = { x: c0.x - s / 2, y: c0.y - s / 2 }; b = { x: c0.x + s / 2, y: c0.y + s / 2 };
        }
        if (d.ground) { add({ kind: 'ground', shape: d.shape, pts: [[a.x, a.y], [b.x, b.y]], preset: d.ground }); drawPreview(); return; }
        const item = made({ shape: d.shape, pts: [[a.x, a.y], [b.x, b.y]] }, d.cut);
        add(item, item.kind === 'cut' ? 'Erased' : null);
        if (item.kind === 'cut') dropDoorsIn(item);
      } else if (d.kind === 'ospath') {
        add(made({ shape: 'path', pts: d.pts, r: (O.width * g()) / 2 }, d.cut));
      } else if (d.kind === 'osbrush' && d.paint && fxNow()) { // (Beta 3.43) an effect brushed on
        add(made({ shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05), r: d.r }, false));
      } else if (d.kind === 'osbrush' && d.paint) { // (Beta 3.26) the picked floor painted into the floors under the brush
        add({ kind: 'paint', shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05), r: d.r, tile: O.floor, mixW: O.mixW, mixU: O.mixU, mixT: O.mixT }); // (Beta 3.38: its soft edge as wide as Blending says)
      } else if (d.kind === 'osbrush' && d.ground) {
        add({ kind: 'ground', shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05), r: d.r, preset: d.ground });
      } else if (d.kind === 'osbrush') {
        { const item = made({ shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05), r: d.r }, d.cut); add(item, item.kind === 'cut' ? 'Erased' : null); }
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
        add({ kind: 'stairs', pts: [[a.x, a.y], [b.x, b.y]], dir, mat: O.line.mat, tile: O.floor }); // (Beta 3.29: in the picked floor)
      }
      drawPreview();
    }
    const owns = (k) => OWN.has(k);
    function closePoly() {
      const P = O.poly; O.poly = null;
      if (!P || P.pts.length < 3) { drawPreview(); return; }
      const item = made({ shape: 'poly', pts: P.pts }, P.cut);
      add(item, item.kind === 'cut' ? 'Erased' : null);
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
      const patch = O.floorMode === 'edge' ? { edge: L.edge, mat: L.mat } : O.floorMode === 'both' ? { tile: L.tile, edge: L.edge, mat: L.mat } : { tile: L.tile, mixW: L.mixW, mixU: L.mixU, mixT: L.mixT }; // (Beta 3.38: its blending with it)
      cmd('os.update', { id: it.id, ...patch }).then((r) => { if (r && r.ok) toast(O.floorMode === 'edge' ? 'New edge' : 'New floor', { ms: 1400, undo: () => cmd('history.undo') }); });
    }
    // Beta 3.23: a ready-made piece, centred on the pointer, its corner on the grid (oldschool-pieces.js)
    function pieceAt(pt) {
      const p = OldschoolPieces.BY[O.piece] || OldschoolPieces.LIST[0];
      const sz = OldschoolPieces.sizeOf(p, O.turn || 0); const G = grid(); const s = g();
      const x0 = G.ox + Math.round((pt.x - (sz.w * s) / 2 - G.ox) / s) * s; const y0 = G.oy + Math.round((pt.y - (sz.h * s) / 2 - G.oy) / s) * s;
      return { p, ...OldschoolPieces.build(p, { x0, y0, g: s, q: O.turn || 0, look: areaLook(), defaultMat: (e) => O.mats[e] || Oldschool.DEFAULT_MAT[e] }), x0, y0 };
    }
    function stamp(pt) {
      const P = pieceAt(pt);
      const at = Date.now();
      pending.push(...P.items.map((it) => ({ ...it, at })), ...P.doors.map((d) => ({ kind: 'door', ...d, at })));
      drawPreview(pt);
      cmd('os.add', { items: P.items, doors: P.doors }).then((r) => { if (r && r.ok) toast(`${P.p.label} placed`, { ms: 1600, undo: () => cmd('history.undo') }); });
    }
    function turnPiece() { O.turn = ((O.turn || 0) + 1) % 4; save(); drawPreview(lastPt); }
    // Beta 3.40: doors and windows on any wall, not only on grid lines: the slanted side of a Shape, a round room's
    // wall, a slanted wall line, a room drawn off the grid (Half, Free). The wall nearest to the pointer within reach
    // (a wall on a grid line is left to the grid, as before: where one is nearer, it wins); null: none there
    function wallAt(pt) {
      const m = map(); if (!m || !m.os) return null;
      const s = g(); const G = grid(); let best = null;
      const onLine = (v, o) => Math.abs((v - o) / s - Math.round((v - o) / s)) < 0.02;
      const seg = (ax, ay, bx, by, reach) => {
        const lx = bx - ax; const ly = by - ay; const L = Math.hypot(lx, ly); if (L < s * 0.3) return;
        const onGrid = (Math.abs(lx) < s * 0.02 && onLine(ax, G.ox)) || (Math.abs(ly) < s * 0.02 && onLine(ay, G.oy));
        const t = ((pt.x - ax) * lx + (pt.y - ay) * ly) / L; const slack = onGrid ? 0 : s * 0.25; if (t < -slack || t > L + slack) return;
        const dist = Math.abs((pt.x - ax) * ly - (pt.y - ay) * lx) / L; if (dist > reach) return;
        if (!best || dist < best.dist) best = onGrid ? { dist, grid: true } : { dist, ax, ay, ux: lx / L, uy: ly / L, L, t: Math.max(0, Math.min(L, t)) };
      };
      for (const it of m.os.items) {
        if (it.kind === 'line') { for (let i = 0; i + 1 < it.pts.length; i++) seg(it.pts[i][0], it.pts[i][1], it.pts[i + 1][0], it.pts[i + 1][1], (it.w || s * 0.5) / 2 + s * 0.25); continue; }
        if (it.kind !== 'area') continue;
        if (it.shape === 'poly') it.pts.forEach((q, i) => { const n = it.pts[(i + 1) % it.pts.length]; seg(q[0], q[1], n[0], n[1], s * 0.6); });
        else if (it.shape === 'rect') {
          const [[x0, y0], [x1, y1]] = it.pts; const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
          c.forEach((q, i) => { const n = c[(i + 1) % 4]; seg(q[0], q[1], n[0], n[1], s * 0.6); });
        } else if (it.shape === 'round') {
          const [[x0, y0], [x1, y1]] = it.pts; const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const rx = Math.abs(x1 - x0) / 2; const ry = Math.abs(y1 - y0) / 2;
          if (rx < s * 0.6 || ry < s * 0.6) continue;
          const a = Math.atan2((pt.y - cy) / ry, (pt.x - cx) / rx);
          const dist = Math.hypot(pt.x - (cx + rx * Math.cos(a)), pt.y - (cy + ry * Math.sin(a)));
          if (dist <= s * 0.6 && (!best || dist < best.dist)) best = { dist, round: { cx, cy, rx, ry, a } };
        }
      }
      return best && !best.grid ? best : null;
    }
    // the door on that wall: one square where a click went, or from a to b along it. It moves in half steps counted from
    // the wall's middle, so a door can sit in the middle of a wall of any length; on a round wall the steps go round
    // from its four sides, and the door is the chord there, never so long that it would leave the wall
    function wallDoor(w, a, b) {
      const s = g(); const st = O.snap === 'half' ? s / 2 : s;
      const drag = b && Math.hypot(b.x - a.x, b.y - a.y) >= s / 3;
      if (w.round) {
        const { cx, cy, rx, ry } = w.round; const r = (rx + ry) / 2;
        const at = (q) => Math.atan2((q.y - cy) / ry, (q.x - cx) / rx);
        const cap = 2 * Math.sqrt(2 * r * 0.12 * s); // (its middle stays within 0.12 squares of the wall)
        let ang = w.round.a; let len = Math.min(s, cap);
        if (drag) { const a0 = at(a); let da = at(b) - a0; da = Math.atan2(Math.sin(da), Math.cos(da)); ang = a0 + da / 2; len = Math.min(cap, Math.max(st, 2 * r * Math.sin(Math.min(Math.PI / 2, Math.abs(da) / 2)))); }
        else { const step = (2 * Math.PI) / (Math.max(1, Math.round((2 * Math.PI * r) / (st / 2) / 8)) * 8); ang = Math.round(ang / step) * step; }
        const h = Math.asin(Math.min(1, len / 2 / r));
        return { x1: cx + rx * Math.cos(ang - h), y1: cy + ry * Math.sin(ang - h), x2: cx + rx * Math.cos(ang + h), y2: cy + ry * Math.sin(ang + h) };
      }
      let t0; let t1; const h = st / 2; const mid = w.L / 2;
      if (drag) {
        const tb = Math.max(0, Math.min(w.L, (b.x - w.ax) * w.ux + (b.y - w.ay) * w.uy));
        t0 = mid + Math.round((Math.min(w.t, tb) - mid) / h) * h; t1 = mid + Math.round((Math.max(w.t, tb) - mid) / h) * h;
        if (t1 - t0 < st) { const c = (t0 + t1) / 2; t0 = c - st / 2; t1 = c + st / 2; }
      } else { const c = mid + Math.round((w.t - mid) / h) * h; t0 = c - s / 2; t1 = c + s / 2; }
      if (t1 > w.L) { t0 -= t1 - w.L; t1 = w.L; } // (it stays on the wall)
      if (t0 < 0) { t1 = Math.min(w.L, t1 - t0); t0 = 0; }
      return { x1: w.ax + w.ux * t0, y1: w.ay + w.uy * t0, x2: w.ax + w.ux * t1, y2: w.ay + w.uy * t1 };
    }
    // the door a click or a drag gives: on a wall off the grid if one is there, else on the grid line as before (null: a
    // click on the grid, which placeDoor takes)
    function doorFor(a, b) {
      const w = wallAt(a);
      return w ? { ...wallDoor(w, a, b), wall: true } : doorSeg(a, b);
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
      putDoor({ x1, y1, x2, y2 });
    }
    // Beta 3.33: a drag along a grid line: the door covers the squares (or half squares) it passes, on the line nearest to
    // where it started; null for a click (shorter than a third of a square)
    function doorSeg(a, b) {
      const G = grid(); const s = g(); const st = O.snap === 'half' ? s / 2 : s;
      if (Math.hypot(b.x - a.x, b.y - a.y) < s / 3) return null;
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const lo = (v, o) => o + Math.floor((v - o) / st + 1e-6) * st; const hi = (v, o) => o + Math.ceil((v - o) / st - 1e-6) * st;
      if (horiz) {
        const y = G.oy + Math.round((a.y - G.oy) / s) * s; let x1 = lo(Math.min(a.x, b.x), G.ox); let x2 = hi(Math.max(a.x, b.x), G.ox);
        if (x2 - x1 < st) x2 = x1 + st;
        return { x1, y1: y, x2, y2: y };
      }
      const x = G.ox + Math.round((a.x - G.ox) / s) * s; let y1 = lo(Math.min(a.y, b.y), G.oy); let y2 = hi(Math.max(a.y, b.y), G.oy);
      if (y2 - y1 < st) y2 = y1 + st;
      return { x1: x, y1, x2: x, y2 };
    }
    function putDoor({ x1, y1, x2, y2 }) {
      const win = O.tool === 'window'; const secret = !win && O.door === 'secret';
      const leaf = secret ? null : win ? O.windowLeaf : O.doorLeaf;
      const p = { x1: round(x1, 4), y1: round(y1, 4), x2: round(x2, 4), y2: round(y2, 4), door: secret ? 2 : 1, ...(win ? { kind: 'window' } : {}), ...(leaf && leaf !== 'wood' && leaf !== 'clear' ? { leaf } : {}) };
      // (doors it lies over go: a new door replaces them)
      const ux = x2 - x1; const uy = y2 - y1; const L2 = ux * ux + uy * uy || 1;
      const over = map().os.doors.filter((d) => {
        const mx = (d.x1 + d.x2) / 2; const my = (d.y1 + d.y2) / 2; const t2 = ((mx - x1) * ux + (my - y1) * uy) / L2;
        return t2 > 0 && t2 < 1 && Math.abs((mx - x1) * uy - (my - y1) * ux) / Math.sqrt(L2) < g() * 0.2;
      });
      pending.push({ kind: 'door', ...p, at: Date.now() }); drawPreview();
      cmd('os.door', { ...p, ...(over.length ? { replace: over.map((d) => d.id) } : {}) }).then((r) => { if (r && r.ok) toast(r.label || 'Door added', { ms: 1400, undo: () => cmd('history.undo') }); });
    }
    // erasing a box or a round takes the doors in it away too
    function dropDoorsIn(item) {
      const [[ax, ay], [bx, by]] = item.pts;
      const x0 = Math.min(ax, bx); const x1 = Math.max(ax, bx); const y0 = Math.min(ay, by); const y1 = Math.max(ay, by);
      const inBox = (mx, my) => mx >= x0 && mx <= x1 && my >= y0 && my <= y1;
      const ids = map().os.doors.filter((d) => inBox((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2)).map((d) => d.id);
      // (Beta 3.25) and the ground whose middle is in it
      for (const it of map().os.items) if (it.kind === 'ground' || it.kind === 'paint') { const xs = it.pts.map((q) => q[0]); const ys = it.pts.map((q) => q[1]); if (inBox((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)) ids.push(it.id); }
      if (ids.length) cmd('os.remove', { ids });
    }

    // ---------- what is being drawn (and what was just drawn, until its picture comes) ----------
    let svg = null; let pending = []; let lastBg = null;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); return e; };
    function patternFor(defs, ref) {
      const t = Oldschool.tileInfo(ref, lib); if (!t) return '#77736c';
      const off = t.off || [0, 0];
      const key = `${t.url}@${t.squares}@${off}`; let hsh = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) hsh = Math.imul(hsh ^ key.charCodeAt(i), 16777619);
      const id = `osp-${(hsh >>> 0).toString(36)}-${key.length}`;
      if (!defs.querySelector(`#${id}`)) {
        const s = (t.squares || 4) * g(); const G = grid();
        const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', x: G.ox - off[0] * g(), y: G.oy - off[1] * g(), width: s, height: s });
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
    const groundColor = (id) => (GROUNDS.find((x) => x.id === id) || GROUNDS[0]).color;
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
      const fillNow = () => (fxNow() ? fxColor(fxNow()) : patternFor(defs, O.floor));
      const look = (it) => (it.kind === 'live' ? fxColor(it.fx) : it.kind === 'cut' ? 'rgba(10,10,12,0.85)' : it.kind === 'ground' ? groundColor(it.preset) : it.kind === 'line' || it.kind === 'pillar' || (it.kind === 'stairs' && !it.tile) ? 'rgba(140,135,128,0.95)' : patternFor(defs, it.tile));
      for (const it of pending) { const e2 = shapeEl(it, look(it), { opacity: '0.95' }); if (e2) root.append(e2); }
      // the one being drawn
      if (ui.tool !== 'oldschool') return;
      // Beta 3.24: the grid line is hidden, so the squares show around the pointer (fading out), and what a click or a
      // drag would make shows before it is made: its corner, the corridor's width, the brush, the floor that changes
      if (pt) {
        const G = grid(); const s = g(); const R = 3.5 * s; const cx = pt.x; const cy = pt.y;
        const rg = el('radialGradient', { id: 'os-fade-g' });
        rg.append(el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '1' }), el('stop', { offset: '0.5', 'stop-color': '#fff', 'stop-opacity': '0.65' }), el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
        const mk = el('mask', { id: 'os-fade', maskUnits: 'userSpaceOnUse', x: cx - R, y: cy - R, width: 2 * R, height: 2 * R });
        mk.append(el('circle', { cx, cy, r: R, fill: 'url(#os-fade-g)' }));
        defs.append(rg, mk);
        let dp = '';
        for (let x = G.ox + Math.ceil((cx - R - G.ox) / s) * s; x <= cx + R; x += s) dp += `M${x.toFixed(4)} ${(cy - R).toFixed(4)}V${(cy + R).toFixed(4)}`;
        for (let y = G.oy + Math.ceil((cy - R - G.oy) / s) * s; y <= cy + R; y += s) dp += `M${(cx - R).toFixed(4)} ${y.toFixed(4)}H${(cx + R).toFixed(4)}`;
        root.append(el('path', { d: dp, fill: 'none', stroke: 'rgba(244,232,206,0.6)', 'stroke-width': (thin * 0.55).toFixed(4), mask: 'url(#os-fade)' }));
        if (!d) {
          const t = O.tool; const ORANGE = '#f0b44a';
          const cross = (q, r = 0.22) => root.append(el('path', { d: `M${q.x - s * r} ${q.y}H${q.x + s * r}M${q.x} ${q.y - s * r}V${q.y + s * r}`, stroke: ORANGE, 'stroke-width': thin, 'stroke-linecap': 'round' }), el('circle', { cx: q.x, cy: q.y, r: s * 0.06, fill: ORANGE }));
          if (t === 'corridor') {
            const q = snapCorr(pt); const w = O.width * s;
            root.append(el('rect', { x: q.x - w / 2, y: q.y - w / 2, width: w, height: w, fill: patternFor(defs, O.floor), opacity: '0.6' }), el('rect', { x: q.x - w / 2, y: q.y - w / 2, width: w, height: w, fill: 'none', stroke: ORANGE, 'stroke-width': thin, 'stroke-dasharray': `${thin * 3} ${thin * 2}` }));
          } else if (t === 'brush' || (t === 'erase' && O.erase === 'brush') || (t === 'ground' && O.groundShape === 'brush') || (t === 'floor' && O.floorHow === 'paint')) {
            const r = (O.brush * s) / 2;
            root.append(el('circle', { cx: pt.x, cy: pt.y, r, fill: t === 'erase' ? 'rgba(10,10,12,0.55)' : t === 'ground' ? groundColor(O.ground) : fillNow(), opacity: t === 'brush' ? '0.55' : '0.8' }), el('circle', { cx: pt.x, cy: pt.y, r, fill: 'none', stroke: ORANGE, 'stroke-width': thin }));
          } else if (t === 'wall') {
            const q = snapCorner(pt); root.append(el('circle', { cx: q.x, cy: q.y, r: (O.line.w * s) / 2, fill: 'rgba(140,135,128,0.8)' })); cross(q);
          } else if (t === 'floor') {
            const a = Oldschool.areaAt(m.os, pt.x, pt.y);
            if (a && O.floorMode !== 'edge') { const e2 = shapeEl(a, fillNow(), { opacity: '0.6' }); if (e2) root.append(e2); }
            if (a && a.shape !== 'path' && a.shape !== 'brush') { const e3 = shapeEl(a, 'none', { stroke: ORANGE, 'stroke-width': thin * 1.4, 'stroke-dasharray': `${thin * 3} ${thin * 2}` }); if (e3) root.append(e3); }
          } else if (['room', 'round', 'shape', 'stairs', 'ground'].includes(t) || (t === 'erase' && O.erase !== 'brush')) cross(snapCorner(pt));
        }
      }
      let cur = null;
      if (d && d.kind === 'osbox') cur = { kind: d.ground ? 'ground' : d.cut ? 'cut' : 'area', shape: d.shape, pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], tile: O.floor, preset: d.ground };
      else if (d && d.kind === 'ospath') cur = { kind: d.cut ? 'cut' : 'area', shape: 'path', pts: d.pts, r: (O.width * g()) / 2, tile: O.floor };
      else if (d && d.kind === 'osbrush') cur = { kind: d.ground ? 'ground' : d.cut ? 'cut' : 'area', shape: 'brush', pts: d.pts, r: d.r, tile: O.floor, preset: d.ground };
      if (cur && fxNow() && (cur.kind === 'area' || cur.kind === 'cut')) cur = { ...cur, kind: 'live', fx: cur.kind === 'cut' ? 'none' : fxNow() };
      if (d && d.kind === 'osline') cur = { kind: 'line', pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], w: O.line.w * g() };
      else if (d && d.kind === 'osstairs') cur = { kind: 'stairs', pts: [[d.a.x, d.a.y], [d.b.x, d.b.y]], tile: O.floor };
      else if (d && d.kind === 'osdoor') { const q = doorFor(d.a, d.b); if (q) root.append(el('line', { x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, stroke: '#f0b44a', 'stroke-width': g() * 0.18, 'stroke-linecap': 'round' })); }
      if (cur && (cur.kind === 'line' || cur.shape === 'path' || cur.shape === 'brush')) {
        // (Beta 3.28) a stroke shows at its real width while dragging, with an orange rim (it used to vanish)
        const w = cur.kind === 'line' ? cur.w : cur.r * 2;
        const rim = shapeEl(cur, '#f0b44a', { opacity: '0.95', 'stroke-width': w + thin * 2.4 }); if (rim) root.append(rim);
        const body = shapeEl(cur, look(cur), { opacity: cur.kind === 'cut' ? '0.85' : '0.95' }); if (body) root.append(body);
      } else if (cur) { const e2 = shapeEl(cur, look(cur), { opacity: cur.kind === 'cut' ? '0.7' : '0.9', stroke: '#f0b44a', 'stroke-width': thin, 'stroke-dasharray': `${thin * 3} ${thin * 2}` }); if (e2) root.append(e2); }
      if (O.poly) {
        const pts = [...O.poly.pts]; if (pt) { const q = snapCorner(pt); pts.push([q.x, q.y]); }
        if (pts.length >= 3) root.append(el('polygon', { points: pts.map((q) => q.join(',')).join(' '), fill: fxNow() ? fxColor(O.poly.cut ? 'none' : fxNow()) : O.poly.cut ? 'rgba(10,10,12,0.7)' : patternFor(defs, O.floor), opacity: '0.85' }));
        root.append(el('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: '#f0b44a', 'stroke-width': thin }));
        const [fx, fy] = O.poly.pts[0];
        root.append(el('circle', { cx: fx, cy: fy, r: g() * 0.15, fill: '#f0b44a' }));
      }
      // the piece a click would stamp
      if (pt && !d && O.tool === 'piece' && typeof OldschoolPieces === 'object') {
        const P = pieceAt(pt);
        for (const it of P.items) { const e2 = shapeEl(it, look(it), { opacity: '0.7' }); if (e2) root.append(e2); }
        for (const dd of P.doors) root.append(shapeEl({ kind: 'door', ...dd }, null, { opacity: '0.9' }));
        root.append(el('rect', { x: P.x0, y: P.y0, width: P.w * g(), height: P.h * g(), fill: 'none', stroke: '#f0b44a', 'stroke-width': thin, 'stroke-dasharray': `${thin * 3} ${thin * 2}` }));
      }
      // where a click would go (pillars and doors)
      if (pt && (!d || (d.kind === 'osdoor' && !doorFor(d.a, d.b))) && (O.tool === 'pillar' || O.tool === 'door' || O.tool === 'window')) {
        if (O.tool === 'pillar') { const q = pillarAt(pt); root.append(shapeEl({ kind: 'pillar', pts: [[q.x, q.y]], r: O.pillar.r * g(), round: O.pillar.round }, 'rgba(240,180,74,0.5)')); }
        else if (wallAt(pt)) { // (Beta 3.40: on a wall off the grid)
          const q = wallDoor(wallAt(pt), pt, null);
          root.append(el('line', { x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, stroke: '#f0b44a', 'stroke-width': g() * 0.18, 'stroke-linecap': 'round' }));
        } else {
          const G = grid(); const s = g(); const u = (pt.x - G.ox) / s; const v2 = (pt.y - G.oy) / s;
          const vert = Math.abs(u - Math.round(u)) <= Math.abs(v2 - Math.round(v2));
          const a = vert ? [G.ox + Math.round(u) * s, G.oy + Math.floor(v2) * s] : [G.ox + Math.floor(u) * s, G.oy + Math.round(v2) * s];
          root.append(el('line', { x1: a[0], y1: a[1], x2: a[0] + (vert ? 0 : s), y2: a[1] + (vert ? s : 0), stroke: '#f0b44a', 'stroke-width': g() * 0.18, 'stroke-linecap': 'round' }));
        }
      }
    }
    let lastPt = null; let lastD = null;
    function hover(e, pt) { lastPt = pt; if (ui.tool === 'oldschool') drawPreview(pt); } // (Beta 3.24: every tool shows where it would draw)
    function leave() { lastPt = null; if (ui.tool === 'oldschool') drawPreview(); }
    // the view moved or zoomed: the preview follows
    function redraw() { if (svg && (ui.tool === 'oldschool' || pending.length)) drawPreview(lastPt, lastD); }

    // ---------- Beta 3.32: how far the picture is, in a pill at the top (the one of the prepared animations: the maid runs
    // along). Only when it takes a while: on a quick machine it never shows.
    const pill = (() => {
      let el = null; let maid = null; let text = null; let showT = 0; let hideT = 0; let k = 0; let on = false;
      const build = () => {
        maid = h('img', { class: 'anim-maid', src: 'maid-run.webp', alt: '' });
        text = h('span', { class: 'anim-text' });
        el = h('div', { class: 'anim-pill os-pill', role: 'status', 'aria-live': 'polite', hidden: true }, h('span', { class: 'anim-track' }, h('span', { class: 'anim-fill' }), maid), text);
        document.body.appendChild(el);
      };
      const paint = () => { el.style.setProperty('--k', k.toFixed(3)); text.textContent = `Painting the map ${Math.round(k * 100)} %`; };
      const show = () => {
        if (!el) build();
        clearTimeout(hideT); hideT = 0;
        const anim = document.querySelector('.anim-pill:not(.os-pill)');
        el.classList.toggle('below', !!(anim && !anim.hidden)); // (under the animations' pill, when that shows too)
        el.classList.remove('done', 'out'); if (!maid.src.endsWith('maid-run.webp')) maid.src = 'maid-run.webp';
        paint(); el.hidden = false; on = true;
      };
      return {
        start() { k = 0; clearTimeout(showT); if (Oldschool.noPill) return; if (on) show(); else showT = setTimeout(show, 700); },
        progress(v) { k = Math.max(k, v); if (on) paint(); },
        end(ok) {
          clearTimeout(showT); showT = 0;
          if (!on) return;
          k = 1; paint();
          if (ok) { el.classList.add('done'); maid.src = 'maid.webp'; text.textContent = 'Map painted ✓'; }
          clearTimeout(hideT);
          hideT = setTimeout(() => { el.classList.add('out'); hideT = setTimeout(() => { el.hidden = true; on = false; el.classList.remove('out', 'done'); }, 500); }, ok ? 900 : 0);
        },
        get shown() { return on; },
      };
    })();

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
      sharpFromTv(m);
      const want = Oldschool.hash(m, lib);
      const has = m.bg && !m.bg.missing ? m.bg.os : (m.os.items.length ? null : want);
      if (has === want) { if (status !== 'idle') { status = 'idle'; ctx.refreshPop(); } return; }
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; bake(); }, 320);
    }
    // Beta 3.25: the sharp tiles get as many dots a square as the TV shows (a quarter more, for a closer look on this
    // screen): the square's size on the table × the TV's dots an inch
    function sharpFromTv(m) {
      const v = S() && S().view; if (!v || !v.ppi) return;
      const zoom = (m.view && m.view.zoom) || 1;
      Oldschool.setSharp((m.grid.size || 1) * zoom * v.ppi * (v.dpr || 1) * 1.25);
    }
    async function bake() {
      if (baking) { again = true; return; }
      const m = map(); if (!m || !m.os) return;
      baking = true; status = 'busy'; ctx.refreshPop();
      const mapId = m.id; const snap = structuredClone({ os: m.os, grid: m.grid });
      const want = Oldschool.hash(snap, lib);
      pill.start(); let ok = false;
      try {
        const r = await Oldschool.bake(snap, lib, m.bg && m.bg.sharp, (v) => pill.progress(v * 0.97));
        if (map() && map().id === mapId) {
          const data = r.blob ? new Uint8Array(await r.blob.arrayBuffer()) : null;
          // (Beta 3.25) the sharp tiles: new ones with their picture, kept ones by their key alone
          const sharp = r.sharp ? { P: r.sharp.P, ts: r.sharp.ts, tiles: await Promise.all(r.sharp.tiles.map(async (t) => ({ c: t.c, r: t.r, h: t.h, jpg: !!(t.blob && t.jpg), data: t.blob ? new Uint8Array(await t.blob.arrayBuffer()) : null }))) } : null;
          const live = r.live ? new Uint8Array(await r.live.arrayBuffer()) : null; // (Beta 3.42: where its living tiles lie)
          await ts.cmd('os.baked', { mapId, hash: want, empty: !!r.empty, data, sharp, live, ids: [...snap.os.items.map((x) => x.id), ...snap.os.doors.map((x) => x.id)], x: r.x, y: r.y, scale: r.scale, nw: r.nw, nh: r.nh, walls: r.walls });
        }
        lastErr = null; ok = true;
      } catch (err) { console.error(err); lastErr = String(err && err.message || err); }
      if (!again) pill.end(ok); // (another change waits: the pill goes on with it)
      baking = false; status = 'idle';
      pending = pending.filter((x) => Date.now() - x.at < 300);
      drawPreview();
      ctx.refreshPop();
      if (again) { again = false; update(); if (!timer && !baking) pill.end(ok); } // (nothing left to make after all)
    }

    // ---------- tiles: the squares a tile spans, set once ----------
    async function pickTile(it) {
      if (!it) return;
      if (!it.builtin && !it.squares) { const r = await adjustGrid(it, { first: true }); if (!r) return; Object.assign(it, r); }
      const hadFx = !!O.fx; // (Beta 3.43: a tile picked puts the effect down; the panel shows heights and edges again)
      O.floor = { rel: it.rel, ...(it.rel ? {} : { path: it.path }) }; O.fx = null; rememberTile(O.floor); save();
      if (hadFx) ctx.openPop('oldschool'); else ctx.refreshPop();
      drawPreview();
    }
    // Beta 3.24: a tile's grid (any floor: right-click it → Adjust grid; your own the first time it is used). Like the
    // map's Grid: how many squares across, and the lines shifted onto its joints (drag them, or the sliders).
    // Resolves { squares, off } or null.
    function adjustGrid(it, { first = false } = {}) {
      return new Promise((resolve) => {
        const info = Oldschool.tileInfo(it.builtin ? { rel: it.rel } : { rel: it.rel, path: it.path }, lib) || {};
        let n = it.squares || info.squares || 4; let off = [...(it.off || info.off || [0, 0])]; let done = false;
        const S = 360;
        const cv = h('canvas', { class: 'os-tilegrid', width: S * 2, height: S * 2, 'aria-label': 'The tile with its grid: drag the lines onto its joints' });
        const img = new Image();
        const out = h('b', {});
        const sx = h('input', { type: 'range', min: 0, max: 1, step: 0.005, 'aria-label': 'Shift sideways' }); const ox = h('output');
        const sy = h('input', { type: 'range', min: 0, max: 1, step: 0.005, 'aria-label': 'Shift up / down' }); const oy = h('output');
        const paint = () => {
          const g2 = cv.getContext('2d'); const W = S * 2;
          g2.clearRect(0, 0, W, W);
          if (img.naturalWidth) g2.drawImage(img, 0, 0, W, W);
          const cell = W / n;
          const lines = (stroke, w) => {
            g2.strokeStyle = stroke; g2.lineWidth = w; g2.beginPath();
            for (let i = -1; i <= n + 1; i++) {
              const x = Math.round((off[0] + i) * cell) + 0.5; const y = Math.round((off[1] + i) * cell) + 0.5;
              if (x >= 0 && x <= W) { g2.moveTo(x, 0); g2.lineTo(x, W); }
              if (y >= 0 && y <= W) { g2.moveTo(0, y); g2.lineTo(W, y); }
            }
            g2.stroke();
          };
          lines('rgba(0,0,0,0.55)', 5); lines('rgba(240,180,74,0.95)', 2.2);
          out.textContent = `${n} × ${n} squares`;
          sx.value = off[0]; sy.value = off[1];
          ox.textContent = `${Math.round(off[0] * 100)}%`; oy.textContent = `${Math.round(off[1] * 100)}%`;
        };
        img.onload = () => {
          if (first && !it.squares) {
            try { const gd = typeof GridDetect === 'object' ? GridDetect.fromImage(img, img.naturalWidth, img.naturalHeight) : null; if (gd && gd.cell) n = clamp(Math.round((img.naturalWidth / gd.cell) * 2) / 2, 1, 30); } catch { /* */ }
            try { off = Oldschool.findJoints(img, n); } catch { /* */ }
          }
          paint();
        };
        img.src = it.url || UI.pathToUrl(it.path);
        const step = (dv) => { n = clamp(n + dv, 1, 30); paint(); };
        sx.addEventListener('input', () => { off[0] = Number(sx.value); paint(); });
        sy.addEventListener('input', () => { off[1] = Number(sy.value); paint(); });
        // drag on the tile: the lines follow the pointer
        let drag = null;
        cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, off: [...off] }; });
        cv.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const r = cv.getBoundingClientRect(); const cell = r.width / n;
          off = [0, 1].map((i) => ((((drag.off[i] + ((i ? e.clientY - drag.y : e.clientX - drag.x) / cell)) % 1) + 1) % 1));
          paint();
        });
        cv.addEventListener('pointerup', () => { drag = null; });
        const find = () => { if (img.naturalWidth) { off = Oldschool.findJoints(img, n); paint(); } };
        const save = async () => {
          done = true;
          await ts.library('tileSquares', it.builtin ? { rel: it.rel, squares: n, off } : { path: it.path, squares: n, off });
          libAt = 0; await loadLib(true);
          dlg.close(); ctx.refreshPop(); update();
          if (!first) toast(`${it.name}: its grid is set`, { ms: 1800 });
          resolve({ squares: n, off });
        };
        const reset = async () => {
          done = true;
          await ts.library('tileSquares', { rel: it.rel, squares: null });
          libAt = 0; await loadLib(true);
          dlg.close(); ctx.refreshPop(); update();
          resolve(null);
        };
        const ctl = (label, input, o) => h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, label), input, o);
        const body = h('div', { class: 'stack os-squares' },
          cv,
          h('div', { class: 'row' }, h('span', { class: 'ctl-label' }, 'Squares across'), h('span', { class: 'grow' }),
            h('button', { class: 'btn', 'aria-label': 'Fewer squares', onclick: () => step(-0.5) }, iconEl('minus')), out,
            h('button', { class: 'btn', 'aria-label': 'More squares', onclick: () => step(0.5) }, iconEl('plus'))),
          ctl('Shift sideways', sx, ox), ctl('Shift up / down', sy, oy),
          h('div', { class: 'row' },
            h('button', { class: 'btn', 'data-tip': 'Tablescape looks for the joints', onclick: find }, iconEl('focus-2'), 'Find the joints'),
            it.builtin && it.adjusted ? h('button', { class: 'btn ghost', 'data-tip': 'As it came with Tablescape', onclick: reset }, iconEl('restore'), 'As it came') : null,
            h('span', { class: 'grow' }),
            h('button', { class: 'btn primary', onclick: save }, first ? 'Use it' : 'Save')));
        const dlg = UI.dialog(`${it.name}: its grid`, body, { onClose: () => { if (!done) resolve(null); } });
      });
    }

    // ---------- the panel ----------
    // Beta 3.35 (Glinn's order): the tools; the choices of the tool picked (buttons first, each tool only what it uses);
    // its tiles (the last 8 used, List … for all of them); its sliders; at the bottom the map's own settings.
    const tileKey = (x) => (x ? x.rel || x.path : null);
    // the floor tiles: those of the app, then those of the library
    const floorList = () => [...Oldschool.FLOORS.map((f) => {
      const rel = Oldschool.relOf(f); const o = lib.find((x) => x.builtin && x.rel === rel);
      return { rel, name: f.label, url: Oldschool.tileInfo({ rel }).small, big: Oldschool.tileInfo({ rel }).url, builtin: true, squares: (o && o.squares) || f.squares, off: (o && o.off) || f.off || [0, 0], adjusted: !!(o && o.adjusted) };
    }), ...lib.filter((x) => !x.builtin)];
    // the last 8 used (a pick among them keeps their places; one from the list takes the oldest one's place)
    function recentTiles() {
      const all = floorList(); const by = new Map(all.map((x) => [tileKey(x), x]));
      let keys = (O.recentTiles || []).map(tileKey).filter((k) => by.has(k));
      if (O.floor && by.has(tileKey(O.floor)) && !keys.includes(tileKey(O.floor))) keys.unshift(tileKey(O.floor));
      for (const it of all) { if (keys.length >= 8) break; if (!keys.includes(tileKey(it))) keys.push(tileKey(it)); }
      keys = keys.slice(0, 8);
      if (JSON.stringify(keys) !== JSON.stringify((O.recentTiles || []).map(tileKey))) { O.recentTiles = keys.map((k) => { const it = by.get(k); return it.rel ? { rel: it.rel } : { path: it.path }; }); save(); }
      return keys.map((k) => by.get(k));
    }
    function rememberTile(ref) {
      const k = tileKey(ref); const list = O.recentTiles || [];
      if (list.some((x) => tileKey(x) === k)) return;
      O.recentTiles = [ref.rel ? { rel: ref.rel } : { path: ref.path }, ...list].slice(0, 8); save();
    }
    const gridMenu = (e, it) => { e.preventDefault(); e.stopPropagation(); UI.openMenu(e.clientX, e.clientY, [{ icon: 'grid-4x4', label: 'Adjust grid', action: () => adjustGrid(it.builtin ? { ...it, url: it.big } : it) }]); };
    // Beta 3.38: a tile's colour, for sorting the list by it: greys first (dark to light), then round the colour wheel.
    // Read from its small picture the first time it is asked for, and kept
    const tints = new Map(); let tintTimer = 0;
    try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('osTileTints') || '{}'))) tints.set(k, v); } catch {}
    function tintOf(it) {
      const url = it.thumb || it.url; if (!url) return null;
      if (tints.has(url)) return tints.get(url);
      tints.set(url, null); // (asked for)
      const img = new Image();
      img.onload = () => {
        try {
          const N = 16; const cv = document.createElement('canvas'); cv.width = cv.height = N;
          const g2 = cv.getContext('2d', { willReadFrequently: true }); g2.drawImage(img, 0, 0, N, N);
          const d = g2.getImageData(0, 0, N, N).data; let r = 0; let gr = 0; let b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
          r /= N * N * 255; gr /= N * N * 255; b /= N * N * 255;
          const mx = Math.max(r, gr, b); const mn = Math.min(r, gr, b); const sat = mx ? (mx - mn) / mx : 0;
          let hue = 0;
          if (mx > mn) { hue = mx === r ? ((gr - b) / (mx - mn) + 6) % 6 : mx === gr ? (b - r) / (mx - mn) + 2 : (r - gr) / (mx - mn) + 4; hue /= 6; }
          tints.set(url, sat < 0.12 ? [0, 0, round(mx, 3)] : [1, Math.round(hue * 12) % 12, round(mx, 3)]);
          const keep = {}; for (const [k, v] of tints) if (v) keep[k] = v;
          try { localStorage.setItem('osTileTints', JSON.stringify(keep)); } catch {}
        } catch { tints.set(url, [2, 0, 0]); } // (a picture that cannot be read: at the end)
        clearTimeout(tintTimer); tintTimer = setTimeout(() => ctx.refreshPop(), 60);
      };
      img.onerror = () => { tints.set(url, [2, 0, 0]); };
      img.src = url;
      return null;
    }
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
    const TILE_SORTS = [
      { id: 'name', label: 'Name', tip: 'A to Z', cmp: byName },
      { id: 'colour', label: 'Colour', tip: 'Greys first, then round the colour wheel', cmp: (a, b) => { const x = tintOf(a) || [3, 0, 0]; const y = tintOf(b) || [3, 0, 0]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || byName(a, b); } },
      { id: 'newest', label: 'Newest', tip: 'The newest first: yours by the day they came, then the app\'s', cmp: (a, b) => (b._when || 0) - (a._when || 0) || byName(a, b) },
    ];
    // Tiles → List …: every tile (the app's in their folder, yours in theirs); click: draw with it
    const tileListDef = () => ({
      id: 'ostiles', title: 'Tiles', icon: 'layout-grid',
      tips: ['Click a tile to draw with it.', 'Right-click a tile: Adjust grid (how many squares it spans, where its joints lie).'],
      build: () => {
        loadLib();
        // (_when: for Newest. Your own by their file's day; the app's after them, the ones that came last first)
        const items = () => floorList().map((it, i) => ({ ...it, src: it, path: it.builtin ? `tile:${it.rel}` : it.path, kind: 'image', thumb: it.builtin ? it.url : it.thumb || it.url, _when: it.builtin ? i + 1 : it.mtime || 0, ...(it.builtin ? { _dirs: ['Tablescape'] } : {}) }));
        const onMap = () => new Set((map() && map().os ? map().os.items : []).map((x) => tileKey(x.tile)).filter(Boolean));
        const recent = () => new Set((O.recentTiles || []).map(tileKey));
        return PickList.build({
          bind: c().bind, items, rootLabel: 'Tiles', memKey: 'ostiles', sorts: TILE_SORTS,
          pathOf: (it) => it._dirs || PickList.pathOf(it), shortName: (it) => it.name,
          shelves: [{ id: 'map', label: 'On this map', icon: 'map-2', has: (it) => onMap().has(tileKey(it.src)) }, { id: 'recent', label: 'Recent', icon: 'clock', has: (it) => recent().has(tileKey(it.src)) }],
          pick: (it) => pickTile(it.src),
          state: (it) => ({ on: tileKey(O.floor) === tileKey(it.src), tip: `${it.name}${it.squares ? ` (${it.squares} × ${it.squares} squares)` : ''}` }),
          menu: (e, it) => gridMenu(e, it.src),
          empty: 'No tiles yet.',
          foot: [c().btn('From this PC …', 'folder', async () => { const r = await ts.library('import', { cat: 'tiles' }); if (r && r.ok) { libAt = 0; await loadLib(true); toast(`${r.items.length} tile${r.items.length === 1 ? '' : 's'} added`, { ms: 2000 }); } else if (r && r.error) toast(r.error, { kind: 'error' }); }, { kind: 'small', tip: 'Copy pictures from anywhere on this PC into Tiles' }),
            c().btn('Library …', 'books', () => ctx.openLibrary(), { kind: 'small ghost os-more', tip: 'The library\'s Tiles section' })],
        });
      },
    });
    // ---------- Beta 3.37: the menu made new (Glinn's sketch, with pictures) ----------
    // The tools are tabs on the panel's right edge. The panel shows a picture of what is about to be drawn, then the
    // picked tool's choices (height and edge as little drawings) and its tiles. The map's own settings open from a
    // button at the bottom.
    // Beta 3.38: Room's parts (Wall, Pillar, Stairs, Door, Window) come out in a second column, in blue, while Room or
    // one of them is picked. Heights stack: Lower and Higher step a level each, the middle shows it and puts it back.
    // How floors meet is picked from four looks (Blending); a small button opens the three sliders in a card.
    let sides = null; let flyOpen = null; // (the card beside the tabs: 'map' the map's settings, 'blend' the sliders)
    let lastTool = null; let lastSecond = null; // (the tool the panel was built for last, and which blue block stood open: what is new slides out from behind the panel)
    let shownFly = null; let flyEl = null; // (Beta 3.41: the card shown at the last build, so a new one slides out and a closed one slides back)
    const osNow = () => (map() && map().os) || null; // (the panel may be asked to refresh while another map comes up)
    const PARTS = ['wall', 'pillar', 'stairs', 'door', 'window'];
    const LEVEL_MAX = 3; // (what a map keeps: three down to three up)
    const LOOKS = [{ id: 'sharp', label: 'Sharp', mixW: 0, mixU: 0, mixT: 0 }, { id: 'soft', label: 'Soft', mixW: 1.5, mixU: 0, mixT: 0 }, { id: 'natural', label: 'Natural', mixW: 1.5, mixU: 0.5, mixT: 0.5 }, { id: 'tiled', label: 'Tiled', mixW: 1.5, mixU: 0.5, mixT: 1 }];
    const lookNow = () => { const L = LOOKS.find((l) => (l.mixW === 0 ? O.mixW === 0 : l.mixW === O.mixW && l.mixU === O.mixU && l.mixT === O.mixT)); return L ? L.id : ''; };
    const levelWord = (n) => (n ? `${Math.abs(n)} level${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'up' : 'down'}` : 'floor level');
    const around = () => sides;
    const cssUrl = (u) => `url("${String(u || '').replace(/["\\\n]/g, (ch) => encodeURIComponent(ch))}")`;
    const bgOf = (u, px) => (u ? `${cssUrl(u)} 0 0 / ${px}px ${px}px` : '#3a3a3a');
    const matOf = (id) => Oldschool.DATA.tiles.find((x) => x.id === id) || Oldschool.DATA.tiles.find((x) => x.id === 'stone_wall');
    const matUrl = (id) => new URL(`tiles/${matOf(id).small}`, document.baseURI).href;
    const doorUrl = (n) => new URL(`doors/${n}.png`, document.baseURI).href;
    const tileNow = () => { const all = floorList(); const k = tileKey(O.floor); return all.find((x) => tileKey(x) === k) || all[0]; };
    const tileUrl = (it) => (it ? (it.builtin ? it.url : it.thumb || it.url) : '');
    // a little drawing of a floor's corner with its edge and height (the panel's picture, and the edge buttons)
    function floorArt({ edge, mat, tile, level = 0, shape = 'rect', ts = 22 }) {
      const band = h('i', { class: 'band' }); const fl = h('i', { class: 'fl' });
      if (edge === 'walls' || edge === 'rock' || edge === 'cliff') band.style.background = bgOf(matUrl(mat || Oldschool.DEFAULT_MAT[edge]), ts * 2.6);
      fl.style.background = bgOf(tile, ts * 2.6);
      return h('span', { class: `os-art e-${edge} l-${level < 0 ? 'lo' : level > 0 ? 'hi' : 'mid'} s-${shape}` }, band, fl);
    }
    const LEAF_ART = { wood: ['leaf_wood_middle', 'Wooden door'], metal: ['leaf_metal_middle', 'Iron door'], stone: ['leaf_stone_middle', 'Stone door'], portcullis: ['portcullis_middle', 'Portcullis'],
      clear: ['glass_clear_middle', 'Glass window'], leaded: ['glass_leaded_middle', 'Leaded window'], stained: ['glass_stained_middle', 'Stained glass'], shutter: ['shutter_wood_middle', 'Shutters'], bars: ['window_bars_middle', 'Window bars'] };
    // the picture at the top: what the picked tool is about to draw
    function previewCard() {
      const { bind } = c();
      const card = h('div', { class: 'os-prev' });
      bind(() => {
        const t = O.tool; const tl = tileNow(); const tu = tileUrl(tl);
        const fx = fxNow();
        const sig = JSON.stringify([t, tileKey(O.floor), tu, O.edge, O.mats, O.level, O.line, O.pillar, O.door, O.doorLeaf, O.windowLeaf, O.floorHow, fx, O.tint, O.waterTint, O.fxSoft, O.fxShape]);
        if (card.dataset.sig === sig) return; card.dataset.sig = sig;
        let art; let name; let sub;
        const ground = (cls, ...kids) => { const a = h('span', { class: `os-art a-${cls}` }, ...kids.filter(Boolean)); a.style.background = bgOf(tu, 78); return a; };
        if (fx) { // (Beta 3.43) an effect: drawn over the floors that are there
          const F = fxInfo(fx); const own = fxTint(fx);
          const wash = h('i', { class: 'fxwash' }); wash.style.background = own ? `${own}99` : F.color;
          art = ground('fx', wash, iconEl(F.icon));
          const how = { box: 'a box', round: 'round', shape: 'a shape', brush: 'brushed on', fill: 'poured over one height', erase: 'brushed away' }[O.fxShape] || 'a box';
          name = O.fxShape === 'erase' ? `${F.label}: erase` : F.label; sub = `${how} · over any floor${fx === 'grass' && !own ? ' · the floor\'s colour' : ''}`;
        } else if (AREA_TOOLS.includes(t)) {
          art = floorArt({ edge: O.edge, mat: O.mats[O.edge], tile: tu, level: O.level, shape: t === 'round' ? 'round' : t === 'brush' ? 'brush' : 'rect', ts: 30 });
          name = tl ? tl.name : 'Floor';
          const m = matOf(O.mats[O.edge] || Oldschool.DEFAULT_MAT[O.edge]).label.toLowerCase();
          sub = `${{ walls: `${m} walls`, rock: `in ${m}`, ledge: 'a ledge', cliff: 'a cliff', fade: 'fading out' }[O.edge]} · ${levelWord(O.level)}`;
        } else if (t === 'floor') {
          art = ground('tile'); name = tl ? tl.name : 'Tile'; sub = O.floorHow === 'paint' ? 'painted onto the floor' : 'on the whole floor';
        } else if (t === 'stairs') {
          const st = h('i', { class: 'st' }); st.style.background = `repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 3px, rgba(0,0,0,0.3) 3px 9px, rgba(255,244,228,0.14) 9px 22px), ${bgOf(tu, 78)}`;
          art = ground('stairs', st); name = tl ? tl.name : 'Stairs'; sub = 'stairs, climbing where you drag';
        } else if (t === 'wall') {
          const w = h('i', { class: 'strip' }); w.style.background = bgOf(matUrl(O.line.mat), 84); w.style.height = `${O.line.w <= 0.25 ? 10 : O.line.w >= 1 ? 34 : 19}px`; if (O.line.h < 1) w.classList.add('low');
          art = ground('wall', w); name = `${matOf(O.line.mat).label} wall`; sub = `${O.line.w <= 0.25 ? 'thin' : O.line.w >= 1 ? 'thick' : 'normal'} · ${O.line.h < 1 ? 'low' : 'full height'}`;
        } else if (t === 'pillar') {
          const d = Math.round(Math.min(50, 14 + O.pillar.r * 2 * 12)); const b = h('i', { class: `blk${O.pillar.round ? ' round' : ''}` }); b.style.background = bgOf(matUrl(O.line.mat), 84); b.style.width = b.style.height = `${d}px`;
          art = ground('pillar', b); name = `${matOf(O.line.mat).label} pillar`; sub = `${O.pillar.round ? 'round' : 'square'} · ${round(O.pillar.r * 2, 1)} square${O.pillar.r * 2 === 1 ? '' : 's'}`;
        } else if (t === 'door' || t === 'window') {
          const secret = t === 'door' && O.door === 'secret'; const leaf = t === 'window' ? O.windowLeaf : O.doorLeaf; const [img, label] = LEAF_ART[leaf] || LEAF_ART.wood;
          const wl = h('i', { class: `wl${secret ? ' whole' : ''}` }); wl.style.background = bgOf(matUrl('stone_wall'), 84);
          const lf = h('i', { class: `leaf${t === 'window' ? ' win' : ''}` }); lf.style.backgroundImage = cssUrl(doorUrl(img));
          art = ground('door', wl, secret ? null : lf); name = secret ? 'Secret door' : label; sub = secret ? 'the wall shows whole' : t === 'window' ? 'blocks walking, not sight' : 'drag along a wall for a longer one';
        } else { card.hidden = true; return; }
        card.hidden = false;
        card.replaceChildren(art, h('div', { class: 'cap' }, h('b', {}, name), sub));
      });
      return card;
    }
    // a row of choices as little drawings
    function picks({ cls, options, get, set, sig }) {
      const { bind } = c();
      const row = h('div', { class: `os-picks ${cls || ''}`, role: 'radiogroup' });
      bind(() => {
        const s2 = sig ? sig() : '';
        if (row.dataset.sig !== s2 || !row.children.length) {
          row.dataset.sig = s2;
          row.replaceChildren(...options().map((o) => h('button', { class: 'os-pick', role: 'radio', dataset: { v: String(o.value) }, 'aria-label': o.label, onclick: () => set(o.value) }, o.art, h('span', {}, o.label))));
        }
        for (const b of row.children) { const on = b.dataset.v === String(get()); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }
      });
      return row;
    }
    const levelArt = (d) => { const NS = 'http://www.w3.org/2000/svg'; const sv = document.createElementNS(NS, 'svg'); sv.setAttribute('viewBox', '0 0 40 22'); sv.setAttribute('class', 'os-h'); const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d); sv.append(pa); return sv; };
    // a slider with words at its ends; what it is set to shows while the pointer is on it
    function wordSlider({ name, lo, hi, min, max, step, get, set, fmt }) {
      const { bind } = c();
      const input = h('input', { type: 'range', min, max, step, 'aria-label': name });
      const out = h('output');
      const show = () => { out.textContent = fmt(Number(input.value)); };
      input.addEventListener('input', () => { show(); set(Number(input.value)); });
      bind(() => { const v = get(); if (v == null) return; if (document.activeElement !== input) input.value = v; show(); });
      return h('label', { class: 'ctl os-ws' }, h('span', { class: 'ctl-label' }, name), out, h('span', { class: 'os-ws-row' }, h('span', {}, lo), input, h('span', {}, hi)));
    }
    // a look of how floors meet, as a little picture: this tile running into another one
    function lookArt(id, a, b) {
      const MASK = { sharp: 'linear-gradient(90deg,#000 50%,transparent 50%)', soft: 'linear-gradient(90deg,#000 20%,transparent 80%)',
        natural: 'radial-gradient(circle at 22% 28%,#000 34%,transparent 52%),radial-gradient(circle at 36% 80%,#000 30%,transparent 48%),linear-gradient(90deg,#000 30%,transparent 64%)',
        tiled: 'linear-gradient(#000,#000) 0 0/62% 34% no-repeat,linear-gradient(#000,#000) 0 34%/38% 33% no-repeat,linear-gradient(#000,#000) 0 67%/72% 33% no-repeat' }[id];
      const under = h('i'); under.style.background = bgOf(b || a, 30); under.style.filter = 'brightness(0.42)'; // (the other floor, darker, so the line between them shows whatever the two tiles)
      const over = h('i'); over.style.background = bgOf(a, 30); over.style.webkitMaskImage = MASK; over.style.maskImage = MASK;
      return h('span', { class: 'os-art os-look' }, under, over);
    }
    function buildPop(opts) {
      const { slider, toggle, seg, btn, sep, bind } = c();
      const again = !!(opts && opts.again);
      loadLib();
      const m = map();
      sides = null;
      if (!m || !m.os) return h('div', { class: 'stack' }, c().hint('Draw works on Oldschool maps: Add map → Oldschool map.'));
      const upd = () => { save(); ctx.refreshPop(); };
      const tab = (t) => h('button', {
        class: 'tile', dataset: { v: t.id }, 'data-tip': t.tip, 'aria-label': t.label,
        onclick: () => { O.tool = t.id; O.fx = null; O.poly = null; save(); ctx.openPop('oldschool'); drawPreview(); }, // (a tool picked puts an effect down)
      }, iconEl(t.icon), h('span', {}, t.label));
      // Beta 3.46: the effects are Tile's own blue block (as Wall, Pillar … are Room's): Grass, Water, Lava, Shimmer, Pulse, Ripple
      const fx = fxNow();
      const fxTab = (f) => h('button', {
        class: 'tile', dataset: { v: `fx-${f.id}` }, 'data-tip': f.tip, 'aria-label': f.label,
        onclick: () => { O.fx = f.id; O.tool = (FX_SHAPES.find((x) => x.id === O.fxShape) || FX_SHAPES[0]).tool; O.poly = null; if (flyOpen === 'blend') flyOpen = null; save(); ctx.openPop('oldschool'); drawPreview(); },
      }, iconEl(f.icon), h('span', {}, f.label));
      const toolKey = fx ? `fx-${fx}` : O.tool; // (what is marked among the tabs)
      const inPart = !fx && PARTS.includes(O.tool); const partsOpen = !fx && (O.tool === 'room' || inPart); const fxOpen = !!fx || O.tool === 'floor';
      const second = partsOpen ? 'parts' : fxOpen ? 'fx' : null;
      const tools = h('div', { class: 'os-tools os-tabs' }, ...TOOLS.filter((t) => !PARTS.includes(t.id)).map(tab));
      const parts = partsOpen ? h('div', { class: 'os-tools os-tabs os-tabs2' }, ...TOOLS.filter((t) => PARTS.includes(t.id)).map(tab))
        : fxOpen ? h('div', { class: 'os-tools os-tabs os-tabs2 os-fxtabs' }, ...Oldschool.LIVE_FX.map(fxTab)) : null;
      // the tabs come out from behind the panel when it opens, one after the other; Room's parts from behind the tools
      // when Room is picked; a tab picked comes out a little further
      const hadParts = again && lastSecond === second;
      [...tools.children].forEach((b, i) => b.style.setProperty('--i', String(i)));
      if (parts) [...parts.children].forEach((b, i) => b.style.setProperty('--i', String(i + (again ? 0 : 3))));
      if (!again) tools.classList.add('slide');
      if (parts && !hadParts) parts.classList.add('slide');
      if (again && lastTool !== toolKey) { const b = [...tools.children, ...(parts && hadParts ? parts.children : [])].find((x) => x.dataset.v === toolKey); if (b) b.classList.add('pick'); }
      lastTool = toolKey; lastSecond = second;
      bind(() => {
        const key = fxNow() ? `fx-${fxNow()}` : O.tool;
        for (const b of [...tools.children, ...(parts ? parts.children : [])]) b.classList.toggle('on', b.dataset.v === key);
        tools.querySelector('[data-v="room"]').classList.toggle('open', !fxNow() && PARTS.includes(O.tool)); // (Room stays marked while one of its parts is in use)
        tools.querySelector('[data-v="floor"]').classList.toggle('open', !!fxNow()); // (and Tile while one of its effects is)
      });
      const t = O.tool;
      const area = !fx && AREA_TOOLS.includes(t); // (an effect picked: its own few choices, see fxPanel)
      const choices = []; const after = [];
      const snap3 = () => seg({ options: [{ value: 'sq', label: 'Squares' }, { value: 'half', label: 'Half' }, { value: 'free', label: 'Free' }], get: () => O.snap, set: (v) => { O.snap = v; save(); } });
      const snap2 = () => seg({ options: [{ value: 'sq', label: 'Squares' }, { value: 'half', label: 'Half' }], get: () => (O.snap === 'half' ? 'half' : 'sq'), set: (v) => { O.snap = v; save(); } });
      const brush = () => wordSlider({ name: 'Brush', lo: 'small', hi: 'big', min: 0.5, max: 6, step: 0.5, get: () => O.brush, set: (v) => { O.brush = v; save(); }, fmt: (v) => `${v} squares` });
      const pct = (v) => (v ? `${Math.round(v * 100)} %` : 'none');
      const blendSliders = () => [
        wordSlider({ name: 'Mix width', lo: 'sharp', hi: 'soft', min: 0, max: 3, step: 0.5, get: () => O.mixW, set: (v) => { O.mixW = v; upd(); }, fmt: (v) => (v ? `${v} square${v === 1 ? '' : 's'}` : 'off') }),
        wordSlider({ name: 'Uneven', lo: 'straight', hi: 'wild', min: 0, max: 1, step: 0.05, get: () => O.mixU, set: (v) => { O.mixU = v; upd(); }, fmt: pct }),
        wordSlider({ name: 'Tiled', lo: 'smooth', hi: 'stone by stone', min: 0, max: 1, step: 0.05, get: () => O.mixT, set: (v) => { O.mixT = v; upd(); }, fmt: pct })];
      // Blending: four looks to pick from; the small button opens the sliders (Beta 3.40: at any height: a floor blends
      // with the floors at its own height)
      let usesBlend = false;
      const blending = () => {
        usesBlend = true;
        const other = () => { const cur = tileKey(O.floor); const o2 = recentTiles().find((x) => tileKey(x) !== cur); return o2 ? tileUrl(o2) : ''; };
        const fine = h('button', { class: `icon-btn os-fine${flyOpen === 'blend' ? ' on' : ''}`, 'aria-label': 'Blending: fine-tune', 'data-tip': 'Fine-tune: width, uneven, tiled', onclick: () => { flyOpen = flyOpen === 'blend' ? null : 'blend'; ctx.openPop('oldschool'); } }, iconEl('adjustments-horizontal'));
        const row = picks({ cls: 'os-looks', sig: () => `${tileUrl(tileNow())}|${other()}`,
          options: () => LOOKS.map((l) => ({ value: l.id, label: l.label, art: lookArt(l.id, tileUrl(tileNow()), other()) })),
          get: lookNow, set: (v) => { const l = LOOKS.find((x) => x.id === v); O.mixW = l.mixW; if (l.mixW) { O.mixU = l.mixU; O.mixT = l.mixT; } upd(); } });
        const box = h('div', { class: 'stack os-blend' }, h('div', { class: 'os-hd' }, h('span', { class: 'ctl-label' }, 'Blending'), fine), row);
        return box;
      };
      const madeOf = () => [h('div', { class: 'ctl-label' }, 'Made of'), matPicker(() => O.line.mat, (v) => { O.line.mat = v; upd(); }, ['stone_wall', 'dark_stone_wall', 'hedge', 'rock', 'cliff'])];
      if (fx) { // (Beta 3.46) an effect: how it is drawn, its colour, its edge; its sliders on a card of its own
        const shapeNow = () => (FX_SHAPES.some((x) => x.id === O.fxShape) ? O.fxShape : 'box');
        const chip = (icon) => h('span', { class: 'os-art os-fxart' }, iconEl(icon));
        const shapes = picks({ cls: 'os-fx os-fxshapes', options: () => FX_SHAPES.map((x) => ({ value: x.id, label: x.label, art: chip(x.icon) })), get: shapeNow,
          set: (v) => { O.fxShape = v; O.tool = FX_SHAPES.find((x) => x.id === v).tool; O.poly = null; save(); ctx.openPop('oldschool'); drawPreview(); } });
        for (const b of shapes.children) { const x = FX_SHAPES.find((y) => y.id === b.dataset.v); if (x) b.dataset.tip = x.tip; }
        choices.push(shapes);
        const sh = shapeNow();
        if (sh === 'box' || sh === 'round' || sh === 'shape') choices.push(snap3());
        if (sh === 'brush' || sh === 'erase') choices.push(brush());
        if (fx === 'grass' || fx === 'water') { // a colour of its own for what is drawn next (each patch keeps its colour)
          const key = fx === 'grass' ? 'tint' : 'waterTint'; const plain = fx === 'grass' ? 'Floor\'s colour' : 'Teal';
          const inp = h('input', { type: 'color', class: 'os-fxcolor', value: O[key] || (fx === 'grass' ? '#5c8a34' : '#57a0aa'), 'aria-label': `${fxInfo(fx).label}: its own colour`, 'data-tip': 'Pick the colour (the picker can also take one from the screen)' });
          inp.addEventListener('input', () => { O[key] = inp.value.toLowerCase(); upd(); });
          const row = h('div', { class: 'row os-fxtint' },
            seg({ options: [{ value: '', label: plain }, { value: 'own', label: 'Own colour' }], get: () => (O[key] ? 'own' : ''), set: (v) => { O[key] = v ? inp.value.toLowerCase() : ''; upd(); } }), inp);
          bind(() => { inp.disabled = !O[key]; });
          choices.push(row);
        }
        if (sh !== 'fill') choices.push(seg({ options: [{ value: 'soft', label: 'Soft edge' }, { value: 'sharp', label: 'Sharp edge' }], get: () => (O.fxSoft === false ? 'sharp' : 'soft'), set: (v) => { O.fxSoft = v !== 'sharp'; save(); } }));
        after.push(btn(`${fxInfo(fx).label} settings`, 'adjustments-horizontal', () => { flyOpen = flyOpen === 'fx' ? null : 'fx'; ctx.openPop('oldschool'); }, { kind: `wide os-fxset${flyOpen === 'fx' ? ' on' : ''}`, tip: `How all the ${fxInfo(fx).label.toLowerCase()} on this map looks and moves` }));
      } else if (area) {
        { // (Beta 3.38) heights stack: Lower and Higher step one level, the middle shows the level and puts it back
          const step = (d) => { O.level = Math.max(-LEVEL_MAX, Math.min(LEVEL_MAX, (O.level || 0) + d)); upd(); };
          const lo = h('button', { class: 'os-pick', dataset: { v: 'lower' }, 'aria-label': 'Lower', 'data-tip': 'One level lower', onclick: () => step(-1) }, levelArt('M3 7H13V17H27V7H37'), h('span', {}, 'Lower'));
          const hi = h('button', { class: 'os-pick', dataset: { v: 'higher' }, 'aria-label': 'Higher', 'data-tip': 'One level higher', onclick: () => step(1) }, levelArt('M3 17H13V7H27V17H37'), h('span', {}, 'Higher'));
          const word = h('span'); const mid = h('button', { class: 'os-pick on os-level-now', dataset: { v: 'now' }, onclick: () => { if (O.level) { O.level = 0; upd(); } } });
          bind(() => {
            const n = O.level || 0; const y = round(12 - n * 2.8, 1);
            mid.replaceChildren(levelArt(n ? `M3 12H12V${y}H28V12H37` : 'M3 12H37'), word);
            word.textContent = n ? `${n > 0 ? '+' : '\u2212'}${Math.abs(n)}` : 'Floor';
            mid.dataset.level = String(n); mid.setAttribute('aria-label', n ? `${levelWord(n)}: back to floor level` : 'Floor level');
            if (n) mid.dataset.tip = 'Back to floor level'; else delete mid.dataset.tip;
            lo.disabled = n <= -LEVEL_MAX; hi.disabled = n >= LEVEL_MAX;
          });
          choices.push(h('div', { class: 'os-picks os-level' }, lo, mid, hi));
        }
        choices.push(snap3());
        choices.push(picks({ cls: 'os-edges', sig: () => `${tileKey(O.floor)}|${tileUrl(tileNow())}|${JSON.stringify(O.mats)}`,
          options: () => Oldschool.EDGES.map((e) => ({ value: e, label: EDGE_LABEL[e], art: floorArt({ edge: e, mat: O.mats[e], tile: tileUrl(tileNow()) }) })),
          get: () => O.edge, set: (v) => { O.edge = v; save(); ctx.openPop('oldschool'); } }));
        const edgeMat = h('div', {}, matPicker(() => O.mats[O.edge], (v) => { O.mats[O.edge] = v; upd(); }, O.edge === 'walls' ? ['stone_wall', 'dark_stone_wall', 'hedge'] : ['rock', 'cliff', 'stone_wall', 'dark_stone_wall']));
        bind(() => { edgeMat.hidden = O.edge === 'ledge' || O.edge === 'fade'; });
        choices.push(edgeMat);
        if (t === 'brush') after.push(brush());
        after.push(blending());
      } else if (t === 'floor') { // (Beta 3.37) the tile alone: of the whole floor clicked, or painted on with the brush
        choices.push(seg({ options: [{ value: 'click', label: 'Whole floor', icon: 'hand-click' }, { value: 'paint', label: 'Brush', icon: 'brush' }], get: () => (O.floorHow === 'paint' ? 'paint' : 'click'), set: (v) => { O.floorHow = v; save(); ctx.openPop('oldschool'); drawPreview(); } }));
        if (O.floorHow === 'paint') after.push(brush());
        after.push(blending()); // (Beta 3.38: both ways blend as the looks say)
      } else if (t === 'erase') {
        choices.push(seg({ options: [{ value: 'box', label: 'Box', icon: 'square' }, { value: 'round', label: 'Round', icon: 'circle' }, { value: 'brush', label: 'Brush', icon: 'brush' }], get: () => O.erase, set: (v) => { O.erase = v; save(); ctx.openPop('oldschool'); } }));
        if (O.erase === 'brush') after.push(brush()); else choices.push(snap3());
      } else if (t === 'wall') {
        choices.push(seg({ options: [{ value: 0.25, label: 'Thin' }, { value: 0.5, label: 'Normal' }, { value: 1, label: 'Thick' }], get: () => O.line.w, set: (v) => { O.line.w = v; upd(); } }));
        choices.push(seg({ options: [{ value: 0.4, label: 'Low' }, { value: 1, label: 'Full height' }], get: () => O.line.h, set: (v) => { O.line.h = v; upd(); } }));
        choices.push(snap3(), ...madeOf());
      } else if (t === 'pillar') {
        choices.push(seg({ options: [{ value: false, label: 'Square', icon: 'square' }, { value: true, label: 'Round', icon: 'circle' }], get: () => O.pillar.round, set: (v) => { O.pillar.round = v === true || v === 'true'; upd(); } }));
        choices.push(snap3(), ...madeOf());
        // (Beta 3.35: up to 8 squares; 2, 4, 6 and 8 sit on a grid corner)
        after.push(wordSlider({ name: 'Size', lo: 'small', hi: 'big', min: 0.2, max: 8, step: 0.1, get: () => O.pillar.r * 2, set: (v) => { O.pillar.r = round(v / 2, 3); upd(); }, fmt: (v) => `${round(v, 1)} square${v === 1 ? '' : 's'}` }));
      } else if (t === 'stairs') {
        choices.push(snap3());
      } else if (t === 'door') {
        choices.push(seg({ options: [{ value: 'door', label: 'Door', icon: 'door' }, { value: 'secret', label: 'Secret', icon: 'eye-off' }], get: () => (O.door === 'secret' ? 'secret' : 'door'), set: (v) => { O.door = v; upd(); } }));
        const leafSeg = seg({ cls: 'seg-4 os-leaf', options: [{ value: 'wood', label: 'Wood' }, { value: 'metal', label: 'Iron' }, { value: 'stone', label: 'Stone' }, { value: 'portcullis', label: 'Portcullis' }], get: () => O.doorLeaf, set: (v) => { O.doorLeaf = v; upd(); } });
        bind(() => { leafSeg.hidden = O.door === 'secret'; });
        choices.push(leafSeg, snap2());
      } else if (t === 'window') {
        choices.push(seg({ cls: 'seg-5 os-leaf', options: [{ value: 'clear', label: 'Glass' }, { value: 'leaded', label: 'Leaded' }, { value: 'stained', label: 'Stained' }, { value: 'shutter', label: 'Shutters' }, { value: 'bars', label: 'Bars' }], get: () => O.windowLeaf, set: (v) => { O.windowLeaf = v; upd(); } }));
        choices.push(snap2());
      }
      // its tiles: the last 8 used, in two rows; List … has them all
      const usesTiles = !fx && (area || t === 'stairs' || t === 'floor');
      const floorBox = h('div', { class: 'tiles os-floors' });
      const paintFloors = () => {
        const list = recentTiles();
        const sig = list.map((x) => `${tileKey(x)}:${x.squares}:${x.off}`).join('|');
        if (floorBox.dataset.sig !== sig) {
          floorBox.dataset.sig = sig;
          floorBox.replaceChildren(...list.map((it) => h('button', {
            class: 'tile', dataset: { v: tileKey(it) }, 'data-tip': `${it.name}${it.squares ? ` (${it.squares} × ${it.squares} squares)` : ''}`, 'aria-label': it.name,
            onclick: () => pickTile(it), oncontextmenu: (e) => gridMenu(e, it), // (Beta 3.24) right-click: its grid
          }, h('img', { src: it.builtin ? it.url : it.thumb || it.url, alt: '', draggable: false }), h('span', {}, it.name))));
        }
        const cur = fxNow() ? '' : tileKey(O.floor); // (an effect picked: no tile is)
        for (const b of floorBox.querySelectorAll('.tile[data-v]')) b.classList.toggle('on', b.dataset.v === cur);
      };
      const listBtn = btn('List …', 'layout-grid', () => ctx.togglePanel(tileListDef()), { kind: 'wide os-tile-list', tip: 'All tiles: the app\'s and your own' });
      if (usesTiles) { bind(paintFloors); bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen('ostiles'))); }
      // the map's own settings, behind their button (the light's dial, how long the shadows are, shadows all around)
      let fly = null;
      if (flyOpen === 'blend' && !usesBlend) flyOpen = null; // (a tool without blending: its card goes)
      if (flyOpen === 'blend') {
        fly = h('div', { class: 'os-fly os-fly-blend stack' },
          h('div', { class: 'os-fly-head' }, h('b', {}, 'Blending'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => { flyOpen = null; ctx.openPop('oldschool'); } }, iconEl('x'))),
          ...blendSliders());
      }
      const liveNow = () => (map() && map().live) || {};
      if (flyOpen === 'fx' && !fx) flyOpen = null; // (no effect picked: its card goes)
      if (flyOpen === 'fx') { // (Beta 3.46) one kind of effect's own settings, for all of it on this map
        const F = fxInfo(fx); const now = () => liveNow()[fx] || {};
        const pct1 = (v) => `${Math.round(v * 100)} %`;
        const sl = (label, f, min, max, tip) => { const el = slider({ label, min, max, step: 0.05, get: () => (map() && now()[f] != null ? now()[f] : null), set: (v, k) => ctx.send(k || `live-${fx}-${f}`, 'live.set', { fx, set: { [f]: v } }), fmt: pct1 }); if (tip) el.dataset.tip = tip; return el; };
        const rows = [];
        if (fx === 'grass') {
          const col = h('input', { type: 'color', class: 'os-fxcolor', value: now().growColor || '#5c8a34', 'aria-label': 'The floor colour grass grows on', 'data-tip': 'The floor colour it grows on (the picker can take it from the screen)' });
          col.addEventListener('input', () => ctx.send('live-grass-growColor', 'live.set', { fx, set: { growColor: col.value.toLowerCase() } }));
          const range = sl('Range', 'range', 0.05, 1, 'How close to that colour the floor must be');
          const pick = h('div', { class: 'row os-fxtint' }, h('span', { class: 'ctl-label grow' }, 'The colour'), col);
          bind(() => { const on = now().grow === 'colour'; pick.hidden = !on; range.hidden = !on; });
          rows.push(sl('Amount', 'amount', 0, 1.5), sl('Length', 'length', 0.3, 2.5), sl('Between gusts', 'calm', 0, 1, 'How much grass still shows where no gust is passing'), sl('Colour variety', 'vary', 0, 1),
            h('div', { class: 'ctl-label' }, 'Grows on'),
            seg({ options: [{ value: 'all', label: 'All' }, { value: 'bright', label: 'Bright' }, { value: 'dark', label: 'Dark' }, { value: 'colour', label: 'Colour' }], get: () => now().grow || 'all', set: (v) => cmd('live.set', { fx, set: { grow: v } }) }),
            pick, range);
        } else if (fx === 'water') rows.push(sl('Transparency', 'clear', 0, 1), sl('Speed', 'speed', 0.3, 2.5));
        else if (fx === 'lava') rows.push(sl('Glow', 'glow', 0, 2), sl('Embers', 'embers', 0, 2), sl('Heat shimmer', 'heat', 0, 1), sl('Speed', 'speed', 0.3, 2.5), sl('Pick-up range', 'range', 0, 1, 'How much of the floor counts as red-hot'));
        else rows.push(sl('Intensity', 'power', 0, 2), sl('Speed', 'speed', 0.3, 2.5), sl('Pick-up range', 'range', 0, 1, 'How bright and strong a colour must be to shine: further right picks up more'));
        fly = h('div', { class: 'os-fly os-fly-fx stack' },
          h('div', { class: 'os-fly-head' }, h('b', {}, F.label), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => { flyOpen = null; ctx.openPop('oldschool'); } }, iconEl('x'))),
          ...rows);
      }
      if (flyOpen === 'map') {
        const pctOff = (v) => (v > 0 ? `${Math.round(v * 100)} %` : 'off');
        fly = h('div', { class: 'os-fly stack' },
          h('div', { class: 'os-fly-head' }, h('b', {}, 'Map settings'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => { flyOpen = null; ctx.openPop('oldschool'); } }, iconEl('x'))),
          sunDial(),
          slider({ label: 'Shadow length', min: 0, max: 1, step: 0.05, get: () => (osNow() ? Oldschool.shadowOf(osNow()).len : null), set: (v, k) => ctx.send(k || 'os-shlen', 'os.set', { shadowLen: v }), fmt: pctOff }),
          slider({ label: 'Shadows all around', min: 0, max: 1, step: 0.05, get: () => (osNow() ? Oldschool.shadowOf(osNow()).all : null), set: (v, k) => ctx.send(k || 'os-shall', 'os.set', { shadowAll: v }), fmt: pctOff }),
          toggle({ label: 'Walls for sight follow the drawing', get: () => !osNow() || osNow().sight !== false, set: (v) => cmd('os.set', { sight: v }) }),
          // (Beta 3.42) what moves on the map: on or off (3.46: each effect's sliders are on its own card)
          toggle({ label: 'Living effects', get: () => liveNow().on !== false, set: (v) => cmd('live.set', { on: v }) }),
          h('div', { class: 'row' }, btn('Clear', 'trash', async () => { if (!osNow() || !osNow().items.length) return; const r = await cmd('os.clear', {}); if (r && r.ok) toast('Drawing cleared', { undo: () => cmd('history.undo') }); }, { kind: 'small', tip: 'Take everything drawn away (undo brings it back)' })));
      }
      const mapBtn = btn('Map settings', 'sun', () => { flyOpen = flyOpen === 'map' ? null : 'map'; ctx.openPop('oldschool'); }, { kind: `small os-mapbtn${flyOpen === 'map' ? ' on' : ''}`, tip: 'Where the light comes from, the shadows, walls for sight, Clear' });
      const note = h('span', { class: 'grow hint' });
      bind(() => { const o = osNow(); note.textContent = !o ? '' : lastErr ? 'The picture could not be made (see the log)' : o.items.length ? '' : 'Draw a room to start'; });
      // Beta 3.41: the card slides out from behind the panel like the tabs (when it opens, or with the panel), and back
      // behind it when it is closed. (Beta 3.42) It stands in a frame that is cut at the panel's edge and does not
      // move, and only the card moves in it: before, the cut moved with the card and could land inside the panel
      const wrap = fly ? h('div', { class: `os-flywrap${parts ? ' past-parts' : ''}` }, fly) : null; // (past-parts: beyond the second column of tabs)
      const slideIn = !!fly && (!again || shownFly !== flyOpen);
      let leaving = null;
      if (!fly && again && shownFly && flyEl && flyEl.parentNode) { leaving = flyEl.parentNode; flyEl.classList.remove('slide'); flyEl.classList.add('out'); const gone = leaving; setTimeout(() => gone.remove(), 240); }
      shownFly = flyOpen; flyEl = fly;
      sides = {
        els: [tools, parts, wrap, leaving],
        after: () => { // (the card beside its button where the panel is tall enough, else from the top)
          const pop = tools.parentNode; if (!pop) return;
          if (!fly) { // (a card sliding back keeps the panel's corner as it was until it is gone)
            const was = !!(leaving && leaving.classList.contains('docked')); pop.classList.toggle('os-docked', was);
            if (was) setTimeout(() => { if (!flyEl) pop.classList.remove('os-docked'); }, 240);
            return;
          }
          const tall = pop.offsetHeight >= fly.offsetHeight; wrap.style.bottom = tall ? '0' : 'auto'; wrap.style.top = tall ? 'auto' : '0';
          // Beta 3.41: where it fits under the tabs it lines up with the panel, joined to its edge like a drawer pulled
          // out of it; a panel too short for that keeps the card beside the tabs
          const tabsEnd = Math.max(0, ...[tools, parts].filter(Boolean).map((el) => el.offsetTop + el.offsetHeight));
          const docked = tall && pop.offsetHeight - fly.offsetHeight >= tabsEnd + 8;
          wrap.classList.toggle('docked', docked); fly.classList.toggle('docked', docked); pop.classList.toggle('os-docked', docked);
          if (slideIn) fly.classList.add('slide'); // (only now: how far it has to come is known)
        },
      };
      return h('div', { class: 'stack' }, previewCard(), ...choices,
        ...(usesTiles ? [h('div', { class: 'ctl-label' }, 'Tiles'), floorBox, listBtn] : []),
        ...after,
        h('div', { class: 'row os-status' }, note, mapBtn));
    }
    // Beta 3.35: where the light comes from, as a dial: drag the sun round it
    function sunDial() {
      const { bind } = c();
      const NAMES = ['the right', 'top right', 'above', 'top left', 'the left', 'bottom left', 'below', 'bottom right'];
      const knob = h('span', { class: 'os-sun-knob' }, iconEl('sun'));
      const dial = h('div', { class: 'os-sun-dial', role: 'slider', tabindex: '0', 'aria-label': 'Light from', 'data-tip': 'Drag the sun round' }, h('i', { class: 'os-sun-hub' }), knob);
      const out = h('output');
      const key = `os-sun-${Math.random().toString(36).slice(2, 6)}`;
      let held = null; // (while it is dragged: the angle shown, before the map has it)
      const paint = () => {
        const v = held ?? (map() && map().os ? map().os.sun ?? 135 : 135); const a = (v * Math.PI) / 180; const R = 25;
        knob.style.transform = `translate(${(Math.cos(a) * R).toFixed(1)}px, ${(-Math.sin(a) * R).toFixed(1)}px)`;
        out.textContent = NAMES[Math.round(v / 45) % 8]; dial.setAttribute('aria-valuenow', String(v));
      };
      const setSun = (v) => { v = (((Math.round(v / 5) * 5) % 360) + 360) % 360; held = v; paint(); ctx.send(key, 'os.set', { sun: v }); };
      const from = (e) => { const r = dial.getBoundingClientRect(); setSun((Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI); };
      dial.addEventListener('pointerdown', (e) => { e.preventDefault(); dial.setPointerCapture(e.pointerId); from(e); dial.onpointermove = from; });
      const done = () => { dial.onpointermove = null; held = null; };
      dial.addEventListener('pointerup', done); dial.addEventListener('pointercancel', done);
      dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSun((map().os.sun ?? 135) + (e.key === 'ArrowLeft' ? 15 : -15)); held = null; } });
      bind(paint);
      return h('div', { class: 'ctl os-sun-row' }, h('span', { class: 'ctl-label' }, 'Light from'), dial, out);
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
    // (Beta 3.28: Pieces left, so the wheel is the map's again)
    const wheel = () => false;
    return { pill, hashOf, wheel, owns, pointerDown, pointerMove, pointerUp, hover, leave, redraw, update, buildPop, around, cancel, rightClick, dblClick, useTile, dropTile, loadLib, get busy() { return baking; }, TOOLS };
  }
  return { create };
})();
