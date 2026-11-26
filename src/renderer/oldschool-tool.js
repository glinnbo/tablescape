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
    { id: 'light', label: 'Light', icon: 'flame', tip: 'Click a wall: a torch or a lantern on it, its light in the room. Lamps, candles and a cooking fire go where you click' }, // (Beta 3.49)
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
  const OWN = new Set(['osbox', 'ospath', 'osbrush', 'osline', 'osstairs', 'osdoor', 'oslight']); // (Beta 3.51: oslight, a picked light dragged)
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
      rough: 0, /* (XA4: how jagged the brush's edge is, 0 to 1) */ line: { w: 0.5, h: 1, mat: 'stone_wall' }, pillar: { r: 0.25, round: false }, door: 'door', doorLeaf: 'wood', windowLeaf: 'clear', floorMode: 'tile', piece: 'tavern', turn: 0, ground: 'water', groundShape: 'box', mixW: 1.5, mixU: 0.5, mixT: 0.5, floorHow: 'click', fx: null, tint: '', waterTint: '', fxSoft: true, fxShape: 'box', // (Beta 3.43: an effect picked instead of a tile, the grass's colour, its soft edge; 3.46: the water's colour, how the effect is drawn)
      floor: first ? { rel: Oldschool.relOf(first) } : null,
    };
    try { const saved = JSON.parse(localStorage.getItem('osPrefs') || '{}'); if ('mix' in saved && !('mixU' in saved)) { delete saved.mix; delete saved.mixW; } Object.assign(prefs, saved, { mats: { ...prefs.mats, ...(saved.mats || {}) }, line: { ...prefs.line, ...(saved.line || {}) }, pillar: { ...prefs.pillar, ...(saved.pillar || {}) } }); } catch {}
    if (prefs.door === 'window') { prefs.door = 'door'; if (prefs.tool === 'door') prefs.tool = 'window'; } // (Beta 3.35: windows have a tool of their own)
    prefs.floorMode = 'tile'; // (Beta 3.37: the Tile tool changes the tile alone)
    if (prefs.tool === 'floor' && !prefs.tex) { prefs.tex = true; prefs.texShape = 'fill'; } // (Beta 3.49: Tile is the group Texture; whole floor is its Fill)
    if (prefs.floorHow === 'paint') { prefs.floorHow = 'click'; if (prefs.tex) { prefs.texShape = 'brush'; prefs.tool = 'brush'; } }
    if (!TOOLS.some((x) => x.id === prefs.tool)) prefs.tool = 'room';
    ui.os = { ...prefs, poly: null };
    const O = ui.os;
    const save = () => { try { const { poly, lightSel: sel0, ...keep } = O; void poly; void sel0; localStorage.setItem('osPrefs', JSON.stringify(keep)); } catch {} };
    let lib = []; // the library's tiles (with their squares)
    let libRev = 0; let hashFor = null; let hashWas = null; // (Speed 3, WC8: the drawing's fingerprint, kept while nothing it depends on changed)
    let libAt = 0;
    async function loadLib(force) {
      if (!force && Date.now() - libAt < 5000) return;
      libAt = Date.now();
      try { lib = (await ts.library('list')).filter((x) => x.cat === 'tiles'); } catch { lib = []; }
      libRev++;
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
    // XA1 (Glinn, 26 Nov 2026): a pillar's size in half squares, with a quarter at the start: 0.25, 0.5, 1, 1.5 … 8
    // (a square is an inch on the table). It was 0.2 to 8 in steps of a tenth: eighty stops
    const PILLAR_SIZES = [0.25, 0.5, ...Array.from({ length: 15 }, (_, i) => 1 + i * 0.5)];
    const pillarStop = (size) => PILLAR_SIZES.reduce((best, v, i) => (Math.abs(v - size) < Math.abs(PILLAR_SIZES[best] - size) ? i : best), 0);
    O.pillar.r = PILLAR_SIZES[pillarStop(O.pillar.r * 2)] / 2; // (a size kept from before goes to the nearest stop)
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
    // Beta 3.49: the tools stand in four groups (Glinn: "tools that create floor and rooms; tools that create objects
    // and functional things; tools that stylize a scene", and Texture as a group of its own). The group's tabs are the
    // first column, its painting tools (or, for Structure, its things) the second. What is painted is picked in the panel.
    const GROUPS = [
      { id: 'terrain', label: 'Terrain', icon: 'mountain', tip: 'Floors and rooms: make them, raise or lower them, take them away' },
      { id: 'structure', label: 'Structure', icon: 'building-castle', tip: 'What stands on the floor: walls, pillars, stairs, doors, windows, lights' },
      { id: 'texture', label: 'Texture', icon: 'color-swatch', tip: 'Another tile on a floor that is there: nothing else changes' },
      { id: 'style', label: 'Style', icon: 'sparkles', tip: 'Living effects over any floor: grass, water, lava, shimmer, pulse, ripple' },
    ];
    const TERRAIN = ['room', 'round', 'shape', 'brush', 'erase']; // (Terrain's painting tools, in the order of the others' shapes)
    // Texture's painting tools: the picked tile laid into the floors under a box, a round, a shape or the brush; Fill
    // gives the whole floor clicked the tile; Erase takes painted textures away (a box dragged over them)
    const TEX_SHAPES = [
      { id: 'box', label: 'Box', icon: 'square', tool: 'room', tip: 'Drag a box: the tile on the floors under it' },
      { id: 'round', label: 'Round', icon: 'circle', tool: 'round', tip: 'Drag a round patch (Shift: a circle)' },
      { id: 'shape', label: 'Shape', icon: 'polygon', tool: 'shape', tip: 'Click the corners; click the first again (or Enter) to close it' },
      { id: 'brush', label: 'Brush', icon: 'brush', tool: 'brush', tip: 'Paint the tile onto the floors under the brush' },
      { id: 'fill', label: 'Fill', icon: 'droplet', tool: 'floor', tip: 'Click a floor: the whole of it gets the tile' },
      { id: 'erase', label: 'Erase', icon: 'eraser', tool: 'room', tip: 'Drag a box over painted textures: they go, the floor stays' },
    ];
    // Beta 3.51: a light that is there can be picked with the Light tool (a click on it): then it is dragged, and the
    // panel shows and changes that light. Beta 3.54: a light is one thing (fixtures.js); O.lightSel: its id (not kept
    // between sessions). The panel is the one of Effects → Light → Light sources (gm-play.js lightPanel)
    const lightSel = () => { const m = map(); const f = m && O.lightSel ? (m.fx || []).find((x) => x.id === O.lightSel && Fixtures.isLight(x)) : null; if (!f && O.lightSel) O.lightSel = null; return f || null; };
    const wallLight = (f) => !!(f && f.holder && Fixtures.BY[f.holder] && Fixtures.BY[f.holder].wall != null);
    function removeLight(f) { O.lightSel = null; cmd('fx.remove', { id: f.id }).then((r) => { if (r && r.ok) toast(r.label || 'Light removed', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); ctx.openPop('oldschool'); drawPreview(); }); }
    const texShape = () => (TEX_SHAPES.some((x) => x.id === O.texShape) ? O.texShape : 'fill');
    const texNow = () => !!O.tex && !O.fx && (AREA_TOOLS.includes(O.tool) || O.tool === 'floor');
    const groupNow = () => (fxNow() ? 'style' : texNow() ? 'texture' : PARTS.includes(O.tool) ? 'structure' : 'terrain');
    function pickGroup(id) {
      settle(); // (VG3)
      if (id === 'style') { O.tex = false; O.fx = Oldschool.LIVE_FX.some((x) => x.id === O.lastFx) ? O.lastFx : Oldschool.LIVE_FX[0].id; O.tool = (FX_SHAPES.find((x) => x.id === O.fxShape) || FX_SHAPES[0]).tool; }
      else if (id === 'texture') { O.fx = null; O.tex = true; O.tool = TEX_SHAPES.find((x) => x.id === texShape()).tool; }
      else if (id === 'structure') { O.fx = null; O.tex = false; O.tool = PARTS.includes(O.lastPart) ? O.lastPart : 'wall'; }
      else { O.fx = null; O.tex = false; O.tool = TERRAIN.includes(O.lastTerrain) ? O.lastTerrain : 'room'; }
    }
    const fxNow = () => (O.fx && FX_TOOLS.includes(O.tool) && Oldschool.LIVE_FX.some((x) => x.id === O.fx) ? O.fx : null);
    const fxInfo = (id) => Oldschool.LIVE_FX.find((x) => x.id === id) || null;
    const fxColor = (id) => (id === 'none' ? 'rgba(10,10,12,0.5)' : (fxInfo(id) || { color: 'rgba(255,255,255,0.4)' }).color);
    const fxTint = (fx) => (fx === 'grass' ? O.tint : fx === 'water' ? O.waterTint : '') || '';
    const made = (geo, cut) => {
      const fx = fxNow();
      if (!fx && texNow()) return cut ? { kind: 'texcut', ...geo } : { kind: 'paint', ...geo, tile: O.floor, mixW: O.mixW, mixU: O.mixU, mixT: O.mixT }; // (Beta 3.49: Texture with every shape)
      if (fx) return { kind: 'live', ...geo, fx: cut ? 'none' : fx, ...(!cut && /^#[0-9a-f]{6}$/.test(fxTint(fx)) ? { tint: fxTint(fx) } : {}), mixW: O.fxSoft === false || geo.shape === 'fill' ? 0 : 1.5 };
      return { kind: cut ? 'cut' : 'area', ...geo, ...(cut ? {} : areaLook()) };
    };
    // 26 Nov 2026: a drawn map has a maximum size (mapstate OS_MAX). What would pass it is not added: its outline
    // leaves the preview and a short message says why.
    function tooBig(n, waiting) {
      count.refused++;
      const gone = new Set((waiting || []).filter(Boolean));
      if (gone.size) { pending = pending.filter((x) => !gone.has(x)); drawPreview(); }
      toast(`A drawn map can be ${n} × ${n} squares at most`, { kind: 'error', ms: 4000 });
    }
    function add(item, label) {
      if (!map() || !map().os) return;
      if (item.kind === 'texcut') { dropTex(item); drawPreview(); return Promise.resolve(null); } // (Texture → Erase: nothing is added)
      const wait = item.shape !== 'fill' ? { ...item, at: Date.now() } : null; // (a poured effect has no outline to show until the picture knows where it ran)
      if (wait) pending.push(wait);
      drawPreview();
      return cmd('os.add', { item }).then((r) => { if (r && r.tooBig) { tooBig(r.tooBig, [wait]); return r; } if (r && r.ok && label !== false) toast(label || r.label || 'Drawn', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); return r; });
    }

    // ---------- the pointer ----------
    function pointerDown(e, pt) {
      const m = map(); if (!m || !m.os) return null;
      const free = e.altKey && !AREA_TOOLS.includes(O.tool) && O.tool !== 'erase';
      const cut = O.tool === 'erase' || (e.altKey && AREA_TOOLS.includes(O.tool)) || (!!fxNow() && O.fxShape === 'erase') || (texNow() && texShape() === 'erase'); // (3.46: an effect's own Erase; 3.49: Texture's)
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
      if (t === 'light') { // (Beta 3.49) a light: a wall light on the wall's face, the others where clicked
        // (Beta 3.51) a click on one that is there picks it and may drag it; a click beside a picked one lets go of it
        const hit = Fixtures.under(m, pt);
        if (hit) { const was = O.lightSel; O.lightSel = hit.id; if (was !== hit.id) ctx.openPop('oldschool'); drawPreview(pt); return { kind: 'oslight', id: hit.id, from: pt, pt, moved: false }; }
        if (lightSel()) { O.lightSel = null; ctx.openPop('oldschool'); drawPreview(pt); return null; }
        const d = ctx.lightDef();
        ctx.placeLight(pt).then((r) => { if (r && r.ok) toast(r.label || `${d.label} placed`, { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
        return null;
      }
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
      if (d.kind === 'oslight') { d.pt = pt; if (Math.hypot(pt.x - d.from.x, pt.y - d.from.y) > g() * 0.12) d.moved = true; lastD = d; drawPreview(pt, d); return; } // (Beta 3.51: a picked light dragged)
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
      if (d.kind === 'oslight') { // (Beta 3.51) dropped: a wall light on the wall there, turned to it; the others where dropped
        const f = lightSel();
        if (f && d.moved) { const q = wallLight(f) ? Fixtures.at(m, d.pt, f.holder) : { x: round(d.pt.x, 3), y: round(d.pt.y, 3) }; cmd('fx.update', { id: f.id, x: q.x, y: q.y, ...(wallLight(f) ? { rotation: q.rotation, wall: q.wall || null } : {}) }); }
        drawPreview(); return;
      }
      if (d.kind === 'osdoor') { // (Beta 3.33) a click: a door of one square, or the one there goes; a drag: any length
        const seg = doorFor(d.a, d.b);
        if (!seg) placeDoor(d.a);
        else if (seg.wall && Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < g() / 3) { // (a click on a wall off the grid: a door there, or the one there goes)
          const on = (x) => { const lx = x.x2 - x.x1; const ly = x.y2 - x.y1; const L2 = lx * lx + ly * ly || 1; const u = Math.max(0, Math.min(1, ((d.a.x - x.x1) * lx + (d.a.y - x.y1) * ly) / L2)); return Math.hypot(d.a.x - x.x1 - lx * u, d.a.y - x.y1 - ly * u); };
          const old = m.os.doors.filter((x) => on(x) < g() * 0.6).sort((p, q) => on(p) - on(q))[0];
          if (old) cmd('os.remove', { id: old.id }).then((r) => { if (r && r.ok) toast('Door removed', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
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
        add(made({ shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05, d.r), r: d.r }, false));
      } else if (d.kind === 'osbrush' && d.paint) { // (Beta 3.26) the picked floor painted into the floors under the brush
        add({ kind: 'paint', shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05, d.r), r: d.r, tile: O.floor, mixW: O.mixW, mixU: O.mixU, mixT: O.mixT }); // (Beta 3.38: its soft edge as wide as Blending says)
      } else if (d.kind === 'osbrush' && d.ground) {
        add({ kind: 'ground', shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05, d.r), r: d.r, preset: d.ground });
      } else if (d.kind === 'osbrush') {
        { const item = made({ shape: 'brush', pts: simplifyPts(d.pts, g() * 0.05, d.r), r: d.r, ...(O.tool === 'brush' && O.rough > 0 ? { rough: O.rough } : {}) }, d.cut); add(item, item.kind === 'cut' ? 'Erased' : null); } // (XA4: the Brush's jagged edge, also when Alt erases with it)
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
    // UI audit VG1: the last corner of a half-drawn shape goes (Backspace, Delete, Ctrl Z)
    function back() { if (!O.poly) return false; O.poly.pts.pop(); if (!O.poly.pts.length) O.poly = null; drawPreview(); return true; }
    // UI audit VG3: another tool, tab or kind with a shape half drawn: from three corners it is closed (as Enter
    // does); with fewer it goes and says why (it used to go without a word)
    function settle() {
      if (!O.poly) return false;
      if (O.poly.pts.length >= 3) closePoly();
      else { O.poly = null; drawPreview(); toast('A shape needs at least three corners', { ms: 1800 }); }
      return true;
    }
    // UI audit VF5: [ ], Ctrl + wheel: the Brush's size, while the Brush is in hand
    function brushStep(dir) {
      if (!(O.tool === 'brush' || (O.tool === 'erase' && O.erase === 'brush') || (O.tool === 'floor' && O.floorHow === 'paint') || (O.tool === 'ground' && O.groundShape === 'brush'))) return false;
      O.brush = Math.max(0.5, Math.min(6, (Number(O.brush) || 1) + (dir > 0 ? 0.5 : -0.5)));
      save(); ctx.refreshPop(); drawPreview();
      return true;
    }
    // Beta 3.68 (Glinn): out of Draw: a picked light is let go and its rings go with it (they stayed on the map)
    function leaveTool() { if (O.lightSel) { O.lightSel = null; save(); } drawPreview(); }
    // Enter closes a shape, Esc drops it, Backspace takes its last corner back
    window.addEventListener('keydown', (e) => {
      if (ui.tool === 'oldschool' && O.tool === 'light' && !O.poly && (e.key === 'Delete' || e.key === 'Backspace')) { // (Beta 3.51: the picked light goes)
        const t0 = e.target; if (t0 && (t0.tagName === 'INPUT' || t0.tagName === 'TEXTAREA' || t0.isContentEditable)) return;
        const l = lightSel(); if (l) { e.preventDefault(); e.stopImmediatePropagation(); removeLight(l); }
        return;
      }
      if (ui.tool !== 'oldschool' || !O.poly) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); closePoly(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); back(); } // (VG1: Delete too)
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
    // Speed 3 (WC4): a stroke kept a point every fifth of a square whatever its width, and the thinning could remove
    // none of them (it dropped points closer than a twentieth). Now the points a stroke's shape does not need go: one
    // that lies within tol of the line between its neighbours (Ramer, Douglas, Peucker), tol the larger of a twentieth
    // of a square and a tenth of the brush's half width. A stroke that is still too long for a map says so.
    const STROKE_MAX = 4000; // (what a map keeps of one stroke: mapstate ptsOf)
    function simplifyPts(pts, tol, r = 0) {
      if (pts.length < 3) return pts;
      const near = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) { const [x, y] = near[near.length - 1]; if (Math.hypot(pts[i][0] - x, pts[i][1] - y) >= tol) near.push(pts[i]); }
      near.push(pts[pts.length - 1]);
      const eps = Math.max(tol, r * 0.1);
      const keep = new Uint8Array(near.length); keep[0] = keep[near.length - 1] = 1;
      const todo = [[0, near.length - 1]];
      while (todo.length) {
        const [a, b] = todo.pop(); if (b - a < 2) continue;
        const [ax, ay] = near[a]; const [bx, by] = near[b]; const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
        let worst = 0; let at = -1;
        for (let i = a + 1; i < b; i++) {
          const [px, py] = near[i];
          const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          if (d > worst) { worst = d; at = i; }
        }
        if (worst > eps) { keep[at] = 1; todo.push([a, at], [at, b]); }
      }
      const out = near.filter((_, i) => keep[i]);
      if (out.length > STROKE_MAX) toast('This stroke is too long for one piece: its end is left out', { kind: 'error' });
      return out;
    }
    // the Floor tool: the floor clicked gets the picked tile (and/or the edge)
    function repaint(pt) {
      const it = Oldschool.areaAt(map().os, pt.x, pt.y);
      if (!it) { toast('No floor here', { ms: 1400 }); return; }
      const L = areaLook();
      const patch = O.floorMode === 'edge' ? { edge: L.edge, mat: L.mat } : O.floorMode === 'both' ? { tile: L.tile, edge: L.edge, mat: L.mat } : { tile: L.tile, mixW: L.mixW, mixU: L.mixU, mixT: L.mixT }; // (Beta 3.38: its blending with it)
      cmd('os.update', { id: it.id, ...patch }).then((r) => { if (r && r.ok) toast(O.floorMode === 'edge' ? 'New edge' : 'New floor', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
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
      cmd('os.add', { items: P.items, doors: P.doors }).then((r) => { if (r && r.tooBig) { tooBig(r.tooBig, pending.filter((x) => x.at === at)); return; } if (r && r.ok) toast(`${P.p.label} placed`, { ms: 1600, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
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
      if (old) { cmd('os.remove', { id: old.id }).then((r) => { if (r && r.ok) toast('Door removed', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); }); return; }
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
      cmd('os.door', { ...p, ...(over.length ? { replace: over.map((d) => d.id) } : {}) }).then((r) => { if (r && r.ok) toast(r.label || 'Door added', { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
    }
    // Beta 3.49, Texture → Erase: the painted textures whose middle lies in what was dragged go (the floor keeps its own tile)
    function dropTex(item) {
      const pad = item.shape === 'brush' || item.shape === 'path' ? item.r || 0 : 0;
      const xs0 = item.pts.map((q) => q[0]); const ys0 = item.pts.map((q) => q[1]);
      const x0 = Math.min(...xs0) - pad; const x1 = Math.max(...xs0) + pad; const y0 = Math.min(...ys0) - pad; const y1 = Math.max(...ys0) + pad;
      const ids = [];
      for (const it of map().os.items) if (it.kind === 'paint') { const xs = it.pts.map((q) => q[0]); const ys = it.pts.map((q) => q[1]); const mx = (Math.min(...xs) + Math.max(...xs)) / 2; const my = (Math.min(...ys) + Math.max(...ys)) / 2; if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) ids.push(it.id); }
      if (!ids.length) { toast('No painted texture here', { ms: 1400 }); return; }
      cmd('os.remove', { ids }).then((r) => { if (r && r.ok) toast(ids.length === 1 ? 'Painted texture removed' : `${ids.length} painted textures removed`, { ms: 1400, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
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
      // (Beta 3.68, Glinn: the light previews' lines were too thick) a hair: 1.5 pixels on the screen at any zoom
      const hair = Math.max(1e-4, 1.5 / ((Math.hypot(px.x - p0.x, px.y - p0.y) || 1) * ((v.cam && v.cam.s) || 1)));
      const fillNow = () => (fxNow() ? fxColor(fxNow()) : patternFor(defs, O.floor));
      if (ui.tool === 'oldschool' && O.tool === 'light') { // (Beta 3.51) the picked light: a ring, its reach, and where a drag would put it
        const sl = lightSel();
        if (sl) {
          const s2 = g(); const f = sl; const dd = sl.holder ? Fixtures.BY[sl.holder] : null; const GOLD = '#f0b44a';
          const drag = d && d.kind === 'oslight' && d.moved ? (wallLight(sl) ? Fixtures.at(m, d.pt, sl.holder) : { x: d.pt.x, y: d.pt.y, rotation: sl.rotation || 0 }) : null;
          const q = drag || { x: sl.x, y: sl.y, rotation: sl.rotation || 0 };
          if (drag && dd) root.append(el('rect', { x: q.x - (dd.w * s2) / 2, y: q.y - (dd.h * s2) / 2, width: dd.w * s2, height: dd.h * s2, fill: 'rgba(240,180,74,0.25)', stroke: GOLD, 'stroke-width': hair, transform: `rotate(${q.rotation} ${q.x} ${q.y})` }));
          root.append(el('circle', { class: 'os-lightsel', cx: q.x, cy: q.y, r: s2 * 0.32, fill: 'rgba(240,180,74,0.16)', stroke: GOLD, 'stroke-width': hair * 1.4 }),
            el('circle', { class: 'os-lightreach', cx: q.x, cy: q.y, r: (((f && f.dim) || 40) / 5) * s2, fill: 'none', stroke: (f && f.color) || GOLD, 'stroke-width': hair, 'stroke-dasharray': `${hair * 6} ${hair * 4}`, opacity: '0.7' }));
        }
      }
      const look = (it) => (it.kind === 'live' ? fxColor(it.fx) : it.kind === 'cut' ? 'rgba(10,10,12,0.85)' : it.kind === 'ground' ? groundColor(it.preset) : it.kind === 'line' || it.kind === 'pillar' || (it.kind === 'stairs' && !it.tile) ? 'rgba(140,135,128,0.95)' : patternFor(defs, it.tile));
      for (const it of pending) { const e2 = shapeEl(it, look(it), { opacity: '0.95' }); if (e2) root.append(e2); }
      // the one being drawn
      if (ui.tool !== 'oldschool') return;
      // XA3 (Glinn, 26 Nov 2026): a drawn map can be 300 × 300 squares. A faint frame shows how far this drawing may
      // still reach: far out while the drawing is small, and exactly 300 × 300 once it is that large. Your screen only
      { const fr = reach(m); if (fr) {
        const dash = `${(hair * 8).toFixed(4)} ${(hair * 6).toFixed(4)}`;
        root.append(el('rect', { class: 'os-reach', x: fr.x, y: fr.y, width: fr.w, height: fr.h, fill: 'none', stroke: 'rgba(244,232,206,0.42)', 'stroke-width': (hair * 1.2).toFixed(4), 'stroke-dasharray': dash, 'pointer-events': 'none' }));
        const word = el('text', { class: 'os-reach-word', x: fr.x + hair * 7, y: fr.y + hair * 15, 'font-size': (hair * 8.5).toFixed(4), fill: 'rgba(244,232,206,0.55)', 'pointer-events': 'none' });
        word.textContent = `${Oldschool.MAX_SQUARES} × ${Oldschool.MAX_SQUARES} squares`;
        root.append(word);
      } }
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
          } else if (t === 'light') { // (Beta 3.49: where it would sit: its box on the wall's face, a ring where it shines)
            const dd = ctx.lightDef(); const q = lightSel() || Fixtures.under(m, pt) ? null : dd.group === 'holder' ? Fixtures.at(m, pt, dd.id) : { x: pt.x, y: pt.y, rotation: 0 }; // (3.51: none while one is picked or under the pointer)
            if (q) {
              const col = (ctx.lightNext().color || '') || ORANGE;
              if (dd.group === 'holder') { const w = dd.w * s; const hh = dd.h * s; root.append(el('rect', { x: q.x - w / 2, y: q.y - hh / 2, width: w, height: hh, fill: 'rgba(240,180,74,0.25)', stroke: ORANGE, 'stroke-width': hair, transform: `rotate(${q.rotation} ${q.x} ${q.y})` })); }
              root.append(el('circle', { cx: q.x, cy: q.y, r: s * 0.45, fill: 'none', stroke: col, 'stroke-width': hair, 'stroke-dasharray': `${hair * 6} ${hair * 4}`, opacity: q.free && dd.wall != null ? '0.4' : '1' }));
            }
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
    // Speed 1 (WA4): is the hand still at it? A mouse button held anywhere (a shape, the sun dial, a slider), a
    // half-drawn shape, or the pointer moved over the map with Draw in hand a moment ago
    let btnHeld = false; let movedAt = 0; let warmed = false; let lastCamp;
    window.addEventListener('pointerdown', () => { btnHeld = true; }, true);
    for (const ev of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(ev, () => { btnHeld = false; }, true);
    function hover(e, pt) { lastPt = pt; if (ui.tool === 'oldschool') { movedAt = Date.now(); drawPreview(pt); } } // (Beta 3.24: every tool shows where it would draw)
    function leave() { lastPt = null; if (ui.tool === 'oldschool') drawPreview(); }
    // the view moved or zoomed: the preview follows
    function redraw() { if (svg && (ui.tool === 'oldschool' || pending.length)) drawPreview(lastPt, lastD); }
    // XA3: the frame a drawing may still reach to. What counts is what mapstate.js counts (osSpan): floors, grounds,
    // walls, pillars and stairs with their width; not Erase, not effects. Worked out once per state of the drawing
    let reachOf = null; let reachIs = null;
    function reach(m) {
      if (!m || !m.os) return null;
      if (reachOf === m.os.items) return reachIs;
      reachOf = m.os.items; reachIs = null;
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const it of m.os.items) {
        if (!it || it.kind === 'cut' || it.kind === 'live' || !it.pts) continue;
        const pad = it.kind === 'line' ? (it.w || 0) / 2 : it.kind === 'pillar' ? (it.r || 0) : it.shape === 'path' || it.shape === 'brush' ? (it.r || 0) : 0;
        for (const [x, y] of it.pts) { if (x - pad < x0) x0 = x - pad; if (y - pad < y0) y0 = y - pad; if (x + pad > x1) x1 = x + pad; if (y + pad > y1) y1 = y + pad; }
      }
      if (x1 < x0) return null; // (nothing drawn yet: no frame)
      const M = Oldschool.MAX_SQUARES * g();
      // (a drawing from before the maximum may be larger than it: then the frame is what it covers now)
      const lo = (a, b) => Math.min(a, b - M); const span = (a, b) => Math.max(b - a, 2 * M - (b - a));
      reachIs = { x: lo(x0, x1), y: lo(y0, y1), w: span(x0, x1), h: span(y0, y1) };
      return reachIs;
    }

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
        start() { k = 0; clearTimeout(showT); if (Oldschool.noPill) return; if (on || Oldschool.pillNow) show(); else showT = setTimeout(show, 700); }, // (pillNow: the self-test, without the wait)
        progress(v) { k = Math.max(k, v); if (on) paint(); },
        end(ok) {
          clearTimeout(showT); showT = 0;
          if (!on) return;
          k = 1; paint();
          if (ok) { el.classList.add('done'); maid.src = 'maid.webp'; text.textContent = 'Map painted ✓'; }
          clearTimeout(hideT);
          hideT = setTimeout(() => { el.classList.add('out'); hideT = setTimeout(() => { el.hidden = true; on = false; el.classList.remove('out', 'done'); }, 500); }, ok ? 900 : 0);
        },
        // (Glinn, 26 Nov 2026: "very often stuck at 94 %") no picture is being made right now and the next one waits
        // for the hand to rest: the pill goes without a tick, and comes back when that picture takes a while
        rest() {
          clearTimeout(showT); showT = 0;
          if (!on) return;
          clearTimeout(hideT);
          hideT = setTimeout(() => { el.classList.add('out'); hideT = setTimeout(() => { el.hidden = true; on = false; el.classList.remove('out', 'done'); }, 500); }, 400);
        },
        get shown() { return on; },
      };
    })();

    // ---------- making the picture ----------
    let baking = false; let again = false; let timer = 0; let status = 'idle'; let lastErr = null;
    let bakingFor = null; let staleNow = false; let failed = null; let dueAt = 0; let shownFrom = 0;
    const count = { started: 0, sent: 0, dropped: 0, again: 0, refused: 0 }; // (for the self-test; refused: things not added because the map would be too large)
    // Speed 1 (WA4): the picture is made 0.3 s after the last change, but not while the hand is still at it: making it
    // holds the screen for a moment, and that came exactly while the next room was being drawn. A held button or a
    // half-drawn shape puts it off for up to 20 s, a pointer moving over the map for up to 4 s. What was drawn stays on
    // screen as its outline meanwhile.
    function arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        const waited = Date.now() - dueAt;
        const busy = btnHeld || O.poly ? waited < 20000 : ui.tool === 'oldschool' && Date.now() - movedAt < 250 && waited < 4000;
        if (busy) arm(); else { dueAt = 0; bake(); }
      }, 320);
    }
    function update() {
      const m = map();
      const bgKey = m && m.bg ? `${m.bg.path}|${m.bg.os}` : '';
      // (a new picture is there: what it was made from is in it; what was drawn after its making began stays as an outline)
      if (bgKey !== lastBg) { lastBg = bgKey; if (pending.length) { pending = pending.filter((x) => x.at > shownFrom); drawPreview(); } }
      if (!m || !m.os) { if (svg) svg.replaceChildren(); return; }
      if (ui.tool === 'oldschool' || pending.length) drawPreview();
      // a tile of the library not known yet (or its squares): the library is read again first
      if (m.os.items.some((it) => it.tile && !Oldschool.tileInfo(it.tile, []) && !lib.some((x) => (it.tile.rel && x.rel === it.tile.rel) || (it.tile.path && x.path === it.tile.path)))) loadLib();
      // (Speed 2, WB8: the store of mixing masks, up to 96 MB, was never emptied: it is let go with the campaign)
      { const camp = S() && S().campaign ? S().campaign.id : null; if (camp !== lastCamp) { if (lastCamp !== undefined && !baking) Oldschool.forgetKept(); lastCamp = camp; } }
      // (Speed 2, WB6: a drawn map is open: the graphics programs are handed over now, in a quiet moment, not with the first picture)
      if (!warmed) { warmed = true; (window.requestIdleCallback || setTimeout)(() => { try { Oldschool.warm(); } catch (err) { console.error(err); } }, { timeout: 2000 }); }
      sharpFromTv(m);
      // (Speed 1, WA2: the dots a square the picture has are kept while they are near enough)
      Oldschool.setHas(m.bg && m.bg.os && m.bg.scale > 0 && !m.bg.missing ? { P: Math.round((m.grid.size || 1) / m.bg.scale), sharpP: m.bg.sharp ? m.bg.sharp.P : 0 } : null);
      // (Speed 3, WC8: worked out only when the drawing, the grid, the library's tiles or the sharpness is another one)
      const sig = m.osRev ? `${m.id}|${m.osRev}|${m.grid.size},${m.grid.ox},${m.grid.oy}|${libRev}|${Oldschool.keySig()}` : null;
      const want = sig && sig === hashFor ? hashWas : Oldschool.hash(m, lib);
      hashFor = sig; hashWas = want;
      if (baking && want !== bakingFor) staleNow = true; // (Speed 1, WA5: the picture being made is for a drawing that is gone)
      const has = m.bg && !m.bg.missing ? m.bg.os : (m.os.items.length ? null : want);
      if (has === want) {
        clearTimeout(timer); timer = 0; dueAt = 0; // (a timer set by an earlier change made a picture of an unchanged drawing)
        // (Glinn, 26 Nov 2026: stuck at 94 % with everything there. A state that came while the picture was being made
        // asked for it once more; when that picture then arrived, this line dropped the request and nobody put the
        // pill away. It stood at the last number it had been told, 94 %, until the next change of the drawing)
        if (!baking && pill.shown) pill.end(true);
        if (pending.length && !baking) { const n = pending.length; pending = pending.filter((x) => Date.now() - x.at < 500); if (pending.length !== n) drawPreview(); } // (the picture is the drawing: no outline is owed, e.g. after Undo)
        if (status !== 'idle') { status = 'idle'; ctx.refreshPop(); }
        return;
      }
      if (want === failed) return; // (Speed 1, WA9: this very drawing could not be made into a picture: tried again when it changes, not on every state)
      if (baking && want === bakingFor) return; // (its picture is being made this very moment: nothing more to ask for)
      if (!dueAt) dueAt = Date.now();
      arm();
    }
    // Beta 3.25: the sharp tiles get as many dots a square as the TV shows (a quarter more, for a closer look on this
    // screen): the square's size on the table × the TV's dots an inch
    function sharpFromTv(m) {
      const v = S() && S().view; if (!v || !v.ppi) return;
      const zoom = (m.view && m.view.zoom) || 1;
      Oldschool.setSharp((m.grid.size || 1) * zoom * v.ppi * (v.dpr || 1) * 1.25, m.bg && m.bg.sharp ? m.bg.sharp.P : 0); // (Speed 1, WA3: in steps, and what the picture has is kept while it is near enough)
    }
    async function bake() {
      if (baking) { again = true; return; }
      const m = map(); if (!m || !m.os) return;
      baking = true; status = 'busy'; ctx.refreshPop();
      const mapId = m.id; const snap = structuredClone({ os: m.os, grid: m.grid });
      const want = Oldschool.hash(snap, lib);
      bakingFor = want; staleNow = false; const began = Date.now(); count.started++;
      pill.start(); let ok = false; let sent = false;
      try {
        // (Speed 1, WA8) tiles of an earlier state of this drawing that are still on the disk (the last undo steps' are kept there)
        let have = null; try { have = new Set(await ts.app('os.tiles', { mapId })); } catch { have = null; }
        let r = await Oldschool.bake(snap, lib, m.bg && m.bg.sharp, (v) => pill.progress(v * 0.97), { stale: () => staleNow, have }); // (the last 3 %: handing it over and saving)
        // (Speed 3, WC10: the graphics card failed and the picture came out flat: made once more before one is kept)
        if (r && r.flat && !staleNow) { count.again = (count.again || 0) + 1; r = await Oldschool.bake(snap, lib, m.bg && m.bg.sharp, (v) => pill.progress(v * 0.97), { stale: () => staleNow, have }); }
        if (map() && map().id === mapId && !staleNow) { // (WA5: a picture of a drawing that is gone is not saved or shown)
          shownFrom = began; sent = true; count.sent++;
          const data = r.blob ? new Uint8Array(await r.blob.arrayBuffer()) : null;
          // (Beta 3.25) the sharp tiles: new ones with their picture, kept ones by their key alone
          const sharp = r.sharp ? { P: r.sharp.P, ts: r.sharp.ts, tiles: await Promise.all(r.sharp.tiles.map(async (t) => ({ c: t.c, r: t.r, h: t.h, jpg: !!(t.blob && t.jpg), data: t.blob ? new Uint8Array(await t.blob.arrayBuffer()) : null }))) } : null;
          const live = r.live ? new Uint8Array(await r.live.arrayBuffer()) : null; // (Beta 3.42: where its living tiles lie)
          await ts.cmd('os.baked', { mapId, hash: want, empty: !!r.empty, data, sharp, live, ids: [...snap.os.items.map((x) => x.id), ...snap.os.doors.map((x) => x.id)], x: r.x, y: r.y, scale: r.scale, nw: r.nw, nh: r.nh, walls: r.walls });
        }
        lastErr = null; ok = true; failed = null;
      } catch (err) {
        if (err && err.stale) { ok = true; count.dropped++; } // (given up for the next one)
        else { console.error(err); lastErr = String(err && err.message || err); failed = want; }
      }
      if (!again) pill.end(ok); // (another change waits: the pill goes on with it)
      baking = false; bakingFor = null; status = 'idle';
      // (Speed 9, WI6: an outline goes when the picture that holds its shape was sent. It went by age: a shape drawn
      // while a picture was being made vanished until the next one.)
      if (sent) pending = pending.filter((x) => x.at > began);
      drawPreview();
      ctx.refreshPop();
      if (again) { again = false; update(); if (!timer && !baking) pill.end(ok); else if (!baking) pill.rest(); } // (nothing left to make after all; or the next one waits for the hand to rest)
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
    // the last five used, one row (25 Nov 2026; it was eight in two rows): a pick among them keeps their places; one
    // from the list takes the oldest one's place
    // XA5 (Glinn, 26 Nov 2026): the row shows the four used last and a "+" that opens all of them (it was five and a
    // wide button "List …" under them)
    const TILE_ROW = 4;
    const moreTile = (cls, label, tip, open) => h('button', { class: `tile os-plus ${cls}`, 'aria-label': label, 'data-tip': tip, onclick: open }, iconEl('plus'));
    const secLabel = (text) => h('div', { class: 'ctl-label os-sec' }, text); // (the panel's headings: larger, to be read at a glance)
    function recentTiles() {
      const all = floorList(); const by = new Map(all.map((x) => [tileKey(x), x]));
      let keys = (O.recentTiles || []).map(tileKey).filter((k) => by.has(k));
      if (O.floor && by.has(tileKey(O.floor)) && !keys.includes(tileKey(O.floor))) keys.unshift(tileKey(O.floor));
      for (const it of all) { if (keys.length >= TILE_ROW) break; if (!keys.includes(tileKey(it))) keys.push(tileKey(it)); }
      if (O.floor && keys.indexOf(tileKey(O.floor)) >= TILE_ROW) keys = [tileKey(O.floor), ...keys.filter((k) => k !== tileKey(O.floor))]; // (a row kept from when it was longer: the tile in hand stays in it)
      keys = keys.slice(0, TILE_ROW);
      if (JSON.stringify(keys) !== JSON.stringify((O.recentTiles || []).map(tileKey))) { O.recentTiles = keys.map((k) => { const it = by.get(k); return it.rel ? { rel: it.rel } : { path: it.path }; }); save(); }
      return keys.map((k) => by.get(k));
    }
    function rememberTile(ref) {
      const k = tileKey(ref); const list = O.recentTiles || [];
      if (list.some((x) => tileKey(x) === k)) return;
      O.recentTiles = [ref.rel ? { rel: ref.rel } : { path: ref.path }, ...list].slice(0, TILE_ROW); save();
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
        // (Speed 2, WB10: once for each state, not once for each tile of the list)
        let onMapFor = null; let onMapSet = new Set();
        const onMap = () => { const os = (map() && map().os) || null; if (os !== onMapFor) { onMapFor = os; onMapSet = new Set((os ? os.items : []).map((x) => tileKey(x.tile)).filter(Boolean)); } return onMapSet; };
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
    const PARTS = ['wall', 'pillar', 'stairs', 'door', 'window', 'light'];
    const LEVEL_MAX = 3; // (what a map keeps: three down to three up)
    const LOOKS = [{ id: 'sharp', label: 'Sharp', mixW: 0, mixU: 0, mixT: 0 }, { id: 'soft', label: 'Soft', mixW: 1.5, mixU: 0, mixT: 0 }, { id: 'natural', label: 'Natural', mixW: 1.5, mixU: 0.5, mixT: 0.5 }, { id: 'tiled', label: 'Tiled', mixW: 1.5, mixU: 0.5, mixT: 1 }];
    const lookNow = () => { const L = LOOKS.find((l) => (l.mixW === 0 ? O.mixW === 0 : l.mixW === O.mixW && l.mixU === O.mixU && l.mixT === O.mixT)); return L ? L.id : ''; };
    const levelWord = (n) => (n ? `${Math.abs(n)} level${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'up' : 'down'}` : 'floor level');
    const around = () => sides;
    const cssUrl = (u) => `url("${String(u || '').replace(/["\\\n]/g, (ch) => encodeURIComponent(ch))}")`;
    const bgOf = (u, px) => (u ? `${cssUrl(u)} 0 0 / ${px}px ${px}px` : '#3a3a3a');
    const matOf = (id) => Oldschool.DATA.tiles.find((x) => x.id === id) || Oldschool.DATA.tiles.find((x) => x.id === 'stone_wall');
    const KIT_IDS = Oldschool.WALLKITS.map((x) => x.id); // (25 Nov 2026: the wall kits, after the three walls there were)
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
        const sig = JSON.stringify([t, tileKey(O.floor), tu, O.edge, O.mats, O.level, O.line, O.pillar, O.door, O.doorLeaf, O.windowLeaf, O.floorHow, fx, O.tint, O.waterTint, O.fxSoft, O.fxShape, O.tex, O.texShape, ctx.lightNext(), O.lightSel, (() => { const f = lightSel(); return f ? f.lit !== false : null; })()]);
        if (card.dataset.sig === sig) return; card.dataset.sig = sig;
        let art; let name; let sub;
        const ground = (cls, ...kids) => { const a = h('span', { class: `os-art a-${cls}` }, ...kids.filter(Boolean)); a.style.background = bgOf(tu, 78); return a; };
        if (fx) { // (Beta 3.43) an effect: drawn over the floors that are there
          const F = fxInfo(fx); const own = fxTint(fx);
          const wash = h('i', { class: 'fxwash' }); wash.style.background = own ? `${own}99` : F.color;
          art = ground('fx', wash, iconEl(F.icon));
          const how = { box: 'a box', round: 'round', shape: 'a shape', brush: 'brushed on', fill: 'poured over one height', erase: 'brushed away' }[O.fxShape] || 'a box';
          name = O.fxShape === 'erase' ? `${F.label}: erase` : F.label; sub = `${how} · over any floor${fx === 'grass' && !own ? ' · the floor\'s colour' : ''}`;
        } else if (texNow()) { // (Beta 3.49)
          const how = { box: 'a box', round: 'round', shape: 'a shape', brush: 'brushed on', fill: 'on the whole floor clicked', erase: 'painted textures taken away' }[texShape()];
          art = ground('tile'); name = texShape() === 'erase' ? 'Texture: erase' : tl ? tl.name : 'Texture'; sub = texShape() === 'erase' ? how : `${how} · on the floor that is there`;
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
          art = ground('pillar', b); name = `${matOf(O.line.mat).label} pillar`; sub = `${O.pillar.round ? 'round' : 'square'} · ${round(O.pillar.r * 2, 2)} square${O.pillar.r * 2 === 1 ? '' : 's'}`;
        } else if (t === 'light') { // (Beta 3.49)
          const sl = lightSel(); const nx = ctx.lightNext();
          const dd = sl ? Fixtures.defOfLight(sl) : ctx.lightDef(); // (Beta 3.54: a holder's picture, or a flame's or a light's icon)
          const pic = h('i', { class: dd.thumb ? 'lt' : 'lt ic' }, dd.thumb ? null : iconEl(dd.icon));
          if (dd.thumb) pic.style.background = `${cssUrl(dd.thumb)} center / contain no-repeat`;
          art = ground('light', pic); name = dd.label;
          sub = sl ? `picked · ${sl.lit !== false ? 'lit' : 'unlit'} · drag to move it` : `${nx.lit === false ? 'unlit' : 'lit'} · ${dd.wall != null ? 'on a wall' : 'where you click'}`; // (Beta 3.51: the one picked)
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
      // Beta 3.49: two columns of tabs. The first has the four groups; the second the picked group's painting tools
      // (Terrain, Texture, Style) or its things (Structure). A tab's data-v: g-<group>, a tool's id, tx-<shape>, fxs-<shape>.
      const fx = fxNow(); const tex = texNow(); const group = groupNow();
      const go = () => { save(); ctx.openPop('oldschool'); drawPreview(); }; // (an open card stays while it still fits: Blending with a tool that blends, an effect's card with an effect)
      const tile = (v, label, icon, tip, run, extra = {}) => h('button', { class: 'tile', dataset: { v, ...extra }, 'data-tip': tip, 'aria-label': label, onclick: run }, iconEl(icon), h('span', {}, label));
      const groups = h('div', { class: 'os-tools os-tabs os-groups' }, ...GROUPS.map((G) => tile(`g-${G.id}`, G.label, G.icon, G.tip, () => { if (groupNow() === G.id) return; pickGroup(G.id); go(); }, { g: G.id })));
      const toolTab = (t) => tile(t.id, t.id === 'room' ? 'Box' : t.label, t.icon, t.tip, () => { settle(); O.tool = t.id; O.fx = null; O.tex = false; if (PARTS.includes(t.id)) O.lastPart = t.id; else O.lastTerrain = t.id; go(); });
      const second = group === 'terrain' ? TERRAIN.map((id) => toolTab(TOOLS.find((x) => x.id === id)))
        : group === 'structure' ? TOOLS.filter((t) => PARTS.includes(t.id)).map(toolTab)
          : group === 'texture' ? TEX_SHAPES.map((x) => tile(`tx-${x.id}`, x.label, x.icon, x.tip, () => { settle(); O.texShape = x.id; O.tool = x.tool; O.floorHow = 'click'; go(); }))
            : FX_SHAPES.map((x) => tile(`fxs-${x.id}`, x.label, x.icon, x.tip, () => { settle(); O.fxShape = x.id; O.tool = x.tool; go(); }));
      const parts = h('div', { class: `os-tools os-tabs os-tabs2 g-${group}` }, ...second);
      const tools = groups;
      const toolKey = group === 'texture' ? `tx-${texShape()}` : group === 'style' ? `fxs-${FX_SHAPES.some((x) => x.id === O.fxShape) ? O.fxShape : 'box'}` : O.tool; // (what is marked in the second column)
      // the tabs come out from behind the panel when it opens, one after the other; a group's tools from behind the
      // groups when it is picked; a tab picked comes out a little further
      const hadParts = again && lastSecond === group;
      [...tools.children].forEach((b, i) => b.style.setProperty('--i', String(i)));
      [...parts.children].forEach((b, i) => b.style.setProperty('--i', String(i + (again ? 0 : 3))));
      if (!again) tools.classList.add('slide');
      if (!hadParts) parts.classList.add('slide');
      if (again && hadParts && lastTool !== toolKey) { const b = [...parts.children].find((x) => x.dataset.v === toolKey); if (b) b.classList.add('pick'); }
      lastTool = toolKey; lastSecond = group;
      bind(() => {
        for (const b of tools.children) b.classList.toggle('open', b.dataset.g === group);
        for (const b of parts.children) b.classList.toggle('on', b.dataset.v === toolKey);
      });
      const t = O.tool;
      const area = !fx && !tex && AREA_TOOLS.includes(t); // (an effect picked: its own few choices, see fxPanel)
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
        const box = h('div', { class: 'stack os-blend' }, h('div', { class: 'os-hd' }, h('span', { class: 'ctl-label os-sec' }, 'Blending'), fine), row);
        return box;
      };
      const madeOf = () => [secLabel('Made of'), matPicker(() => O.line.mat, (v) => { O.line.mat = v; upd(); }, ['stone_wall', 'dark_stone_wall', 'hedge', 'rock', 'cliff', ...KIT_IDS], 'oslinemats')];
      if (fx) { // (Beta 3.46) an effect: how it is drawn, its colour, its edge; its sliders on a card of its own
        const shapeNow = () => (FX_SHAPES.some((x) => x.id === O.fxShape) ? O.fxShape : 'box');
        // (Beta 3.49: what gets painted is picked here, a tile each; how it is painted are the tabs)
        // (Beta 3.65: the pictures of Effects → Elements, so that one effect looks the same in both menus)
        const chip = (f) => { const pic = typeof FxThumbs === 'object' ? FxThumbs.img('region', f.pic || f.id, { w: 72, h: 72, zoom: 0.8 }) : null; const a2 = h('span', { class: `os-art os-fxart${pic ? ' pic' : ''}` }, pic || iconEl(f.icon)); if (!pic) a2.style.background = f.color; return a2; };
        const kinds = picks({ cls: 'os-fx os-fxkinds', options: () => Oldschool.LIVE_FX.map((f) => ({ value: `fx-${f.id}`, label: f.label, art: chip(f) })), get: () => `fx-${fx}`,
          set: (v) => { O.fx = v.slice(3); O.lastFx = O.fx; save(); ctx.openPop('oldschool'); drawPreview(); } }); // (an open card shows the newly picked effect's sliders)
        for (const b2 of kinds.children) { const f = fxInfo(String(b2.dataset.v || '').slice(3)); if (f) b2.dataset.tip = f.tip; }
        choices.push(kinds);
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
        choices.push(secLabel('Edge'));
        choices.push(picks({ cls: 'os-edges', sig: () => `${tileKey(O.floor)}|${tileUrl(tileNow())}|${JSON.stringify(O.mats)}`,
          options: () => Oldschool.EDGES.map((e) => ({ value: e, label: EDGE_LABEL[e], art: floorArt({ edge: e, mat: O.mats[e], tile: tileUrl(tileNow()) }) })),
          get: () => O.edge, set: (v) => { O.edge = v; save(); ctx.openPop('oldschool'); } }));
        const edgeMat = h('div', { class: 'stack os-edgemat' }, secLabel('Made of'), matPicker(() => O.mats[O.edge], (v) => { O.mats[O.edge] = v; upd(); }, O.edge === 'walls' ? ['stone_wall', 'dark_stone_wall', 'hedge', ...KIT_IDS] : ['rock', 'cliff', 'stone_wall', 'dark_stone_wall', ...KIT_IDS], O.edge === 'walls' ? 'osmats' : 'osrockmats'));
        bind(() => { edgeMat.hidden = O.edge === 'ledge' || O.edge === 'fade'; });
        choices.push(edgeMat);
        if (t === 'brush') after.push(brush());
        // XA4 (Glinn, 26 Nov 2026): the brush's edge, from smooth to jagged as a cave's wall
        if (t === 'brush') after.push(wordSlider({ name: 'Edge', lo: 'smooth', hi: 'jagged', min: 0, max: 1, step: 0.05, get: () => O.rough || 0, set: (v) => { O.rough = v; save(); }, fmt: (v) => (v ? `${Math.round(v * 100)} %` : 'smooth') }));
        after.push(blending());
      } else if (tex) { // (Beta 3.37) the tile alone; Beta 3.49: with every painting tool
        const sh = texShape();
        if (sh === 'box' || sh === 'round' || sh === 'shape' || sh === 'erase') choices.push(snap3());
        if (sh === 'brush') after.push(brush());
        if (sh !== 'erase') after.push(blending()); // (Beta 3.38: every way blends as the looks say)
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
        // (XA1: the slider walks the stops; what it holds is the stop's number)
        after.push(wordSlider({ name: 'Size', lo: 'small', hi: 'big', min: 0, max: PILLAR_SIZES.length - 1, step: 1, get: () => pillarStop(O.pillar.r * 2), set: (i) => { O.pillar.r = PILLAR_SIZES[i] / 2; upd(); }, fmt: (i) => { const v = PILLAR_SIZES[i]; return `${v} square${v === 1 ? '' : 's'}`; } }));
      } else if (t === 'stairs') {
        choices.push(snap3());
      } else if (t === 'door') {
        choices.push(seg({ options: [{ value: 'door', label: 'Door', icon: 'door' }, { value: 'secret', label: 'Secret', icon: 'eye-off' }], get: () => (O.door === 'secret' ? 'secret' : 'door'), set: (v) => { O.door = v; upd(); } }));
        const leafSeg = seg({ cls: 'seg-4 os-leaf', options: [{ value: 'wood', label: 'Wood' }, { value: 'metal', label: 'Iron' }, { value: 'stone', label: 'Stone' }, { value: 'portcullis', label: 'Portcullis' }], get: () => O.doorLeaf, set: (v) => { O.doorLeaf = v; upd(); } });
        bind(() => { leafSeg.hidden = O.door === 'secret'; });
        choices.push(leafSeg, snap2());
      } else if (t === 'light') { // (Beta 3.49) which light, lit or not, the colour of its light
        // (Beta 3.51) with a light picked the same rows show and change that light: no kinds then, and Remove.
        // (Beta 3.54) the panel of Effects → Light → Light sources: Holder, Flame or Just light, and More
        const sel = lightSel();
        choices.push(...ctx.lightPanel({ picked: () => lightSel(), rebuild: () => ctx.openPop('oldschool'), changed: () => drawPreview() }));
        if (sel) after.push(btn('Remove', 'trash', () => { const f = lightSel(); if (f) removeLight(f); }, { kind: 'wide os-light-remove', tip: 'Take this light away (Delete)' }));
      } else if (t === 'window') {
        choices.push(seg({ cls: 'seg-5 os-leaf', options: [{ value: 'clear', label: 'Glass' }, { value: 'leaded', label: 'Leaded' }, { value: 'stained', label: 'Stained' }, { value: 'shutter', label: 'Shutters' }, { value: 'bars', label: 'Bars' }], get: () => O.windowLeaf, set: (v) => { O.windowLeaf = v; upd(); } }));
        choices.push(snap2());
      }
      // its tiles: the four used last and a "+" for all of them (XA5; Beta 3.35: the last 8 and a button List …)
      const usesTiles = !fx && (area || t === 'stairs' || (tex && texShape() !== 'erase'));
      const floorBox = h('div', { class: 'tiles os-floors' });
      const paintFloors = () => {
        const list = recentTiles();
        const sig = list.map((x) => `${tileKey(x)}:${x.squares}:${x.off}`).join('|');
        if (floorBox.dataset.sig !== sig) {
          floorBox.dataset.sig = sig;
          floorBox.replaceChildren(...list.map((it) => h('button', {
            class: 'tile', dataset: { v: tileKey(it) }, 'data-tip': `${it.name}${it.squares ? ` (${it.squares} × ${it.squares} squares)` : ''}`, 'aria-label': it.name,
            onclick: () => pickTile(it), oncontextmenu: (e) => gridMenu(e, it), // (Beta 3.24) right-click: its grid
          }, h('img', { src: it.builtin ? it.url : it.thumb || it.url, alt: '', draggable: false }), h('span', {}, it.name))), listBtn);
        }
        const cur = fxNow() ? '' : tileKey(O.floor); // (an effect picked: no tile is)
        for (const b of floorBox.querySelectorAll('.tile[data-v]')) b.classList.toggle('on', b.dataset.v === cur);
      };
      const listBtn = moreTile('os-tile-list', 'All tiles', 'All tiles: the app\'s and your own', () => ctx.togglePanel(tileListDef()));
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
          rows.push(sl('Amount', 'amount', 0, 1.5), sl('Length', 'length', 0.3, 5), sl('Thickness', 'thick', 0.5, 6), sl('Between gusts', 'calm', 0, 1, 'How much grass still shows where no gust is passing'), sl('Colour variety', 'vary', 0, 2),
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
          // (Glinn, 26 Nov 2026) how much of the rock (or of a wall's top) behind a wall in sight the fog uncovers
          slider({ label: 'Rock in sight', min: 0, max: 4, step: 0.5, get: () => (map() && map().vision ? map().vision.rock ?? Vision.ROCK : null), set: (v, k) => ctx.send(k || 'os-rock', 'vision.update', { rock: v }), fmt: (v) => (v > 0 ? `${v} square${v === 1 ? '' : 's'}` : 'off') }),
          // (Beta 3.42) what moves on the map: on or off (3.46: each effect's sliders are on its own card)
          toggle({ label: 'Living effects', get: () => liveNow().on !== false, set: (v) => cmd('live.set', { on: v }) }),
          h('div', { class: 'row' }, btn('Clear', 'trash', async () => { if (!osNow() || !osNow().items.length) return; const r = await cmd('os.clear', {}); if (r && r.ok) toast('Drawing cleared', { undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); }, { kind: 'small', tip: 'Take everything drawn away (undo brings it back)' })));
      }
      const mapBtn = btn('Map settings', 'sun', () => { flyOpen = flyOpen === 'map' ? null : 'map'; ctx.openPop('oldschool'); }, { kind: `small os-mapbtn${flyOpen === 'map' ? ' on' : ''}`, tip: 'Where the light comes from, the shadows, walls for sight, Clear' });
      const note = h('span', { class: 'grow hint' });
      bind(() => { const o = osNow(); note.textContent = !o ? '' : lastErr ? 'The picture could not be made (see the log)' : o.items.length ? '' : 'Draw a room to start'; });
      // Beta 3.41: the card slides out from behind the panel like the tabs (when it opens, or with the panel), and back
      // behind it when it is closed. (Beta 3.42) It stands in a frame that is cut at the panel's edge and does not
      // move, and only the card moves in it: before, the cut moved with the card and could land inside the panel
      const wrap = fly ? h('div', { class: 'os-flywrap past-parts' }, fly) : null; // (past-parts: beyond the second column of tabs)
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
        ...(usesTiles ? [secLabel('Floor'), floorBox] : []),
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
      // (Speed 1, WA6: only a new 5° step is sent: every mouse move on the dial sent the same value again, each a full state)
      const setSun = (v) => { v = (((Math.round(v / 5) * 5) % 360) + 360) % 360; if (v === (held ?? (map() && map().os ? map().os.sun ?? 135 : 135))) return; held = v; paint(); ctx.send(key, 'os.set', { sun: v }); };
      const from = (e) => { const r = dial.getBoundingClientRect(); setSun((Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI); };
      dial.addEventListener('pointerdown', (e) => { e.preventDefault(); dial.setPointerCapture(e.pointerId); from(e); dial.onpointermove = from; });
      const done = () => { dial.onpointermove = null; held = null; };
      dial.addEventListener('pointerup', done); dial.addEventListener('pointercancel', done);
      dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSun((map().os.sun ?? 135) + (e.key === 'ArrowLeft' ? 15 : -15)); held = null; } });
      bind(paint);
      return h('div', { class: 'ctl os-sun-row' }, h('span', { class: 'ctl-label' }, 'Light from'), dial, out);
    }
    // (25 Nov 2026) With the fifteen wall kits there are 18 walls to pick from. More than one row of five: the panel
    // shows those used last (a pick among them keeps their places) and a "+" opens them all, as the floors do
    // (XA5: four and the "+"; it was five and a button List …).
    const MAT_ROW = 4;
    // (each Made of keeps its own five: walls, rock and cliffs, wall lines)
    const matMem = (listId) => (O.recentMats && !Array.isArray(O.recentMats) && Array.isArray(O.recentMats[listId]) ? O.recentMats[listId] : []);
    function recentMats(ids, cur, listId) {
      const keys = matMem(listId).filter((id) => ids.includes(id));
      if (cur && ids.includes(cur) && !keys.includes(cur)) keys.unshift(cur);
      for (const id of ids) { if (keys.length >= MAT_ROW) break; if (!keys.includes(id)) keys.push(id); }
      if (cur && keys.indexOf(cur) >= MAT_ROW) return [cur, ...keys.filter((id) => id !== cur)].slice(0, MAT_ROW); // (a row kept from when it was longer)
      return keys.slice(0, MAT_ROW);
    }
    function rememberMat(ids, id, listId) {
      if (recentMats(ids, null, listId).includes(id)) return;
      O.recentMats = { ...(O.recentMats && !Array.isArray(O.recentMats) ? O.recentMats : {}), [listId]: [id, ...recentMats(ids, null, listId)].slice(0, MAT_ROW) }; save();
    }
    function matPicker(get, set, ids, listId) {
      const { bind, btn } = c();
      const many = !!listId && ids.length > MAT_ROW + 1; // (five fit in the row without a "+")
      const tileOf = (id) => { const t = matOf(id); return h('button', { class: 'tile', dataset: { v: id }, 'aria-label': t.label, 'data-tip': t.label, onclick: () => { set(id); paintM(); } }, h('img', { src: matUrl(id), alt: '', draggable: false }), h('span', {}, t.label)); };
      const box = h('div', { class: 'tiles living-tiles os-mats' });
      const paintM = () => {
        const show = many ? recentMats(ids, get(), listId) : ids;
        if (box.dataset.sig !== show.join('|')) { box.dataset.sig = show.join('|'); box.replaceChildren(...show.map(tileOf), ...(listBtn ? [listBtn] : [])); }
        for (const b of box.querySelectorAll('.tile[data-v]')) b.classList.toggle('on', b.dataset.v === get());
      };
      let listBtn = null;
      if (!many) { bind(paintM); return box; }
      const def = () => ({
        id: listId, title: 'Made of', icon: 'layout-grid',
        build: () => PickList.build({
          bind: c().bind, rootLabel: 'All', memKey: listId, pathOf: () => [], shortName: (it) => it.name,
          items: () => ids.map((id) => ({ id, name: matOf(id).label, path: `mat:${id}`, kind: 'image', thumb: matUrl(id) })),
          pick: (it) => { rememberMat(ids, it.id, listId); set(it.id); paintM(); },
          state: (it) => ({ on: get() === it.id, tip: it.name }),
        }),
      });
      listBtn = moreTile('os-mat-list', 'All walls', 'All walls', () => ctx.togglePanel(def()));
      bind(paintM);
      bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen(listId)));
      return h('div', { class: 'stack os-matpick' }, box);
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
      if (at) cmd('os.update', { id: at.id, tile: O.floor }).then((r) => { if (r && r.ok) toast(`${it.name} on that floor`, { ms: 1600, undo: () => cmd('history.undo', { mapId: r && r.mapId }) }); });
      if (ui.tool !== 'oldschool') ctx.setTool('oldschool');
      ctx.openPop('oldschool');
    }

    const hashOf = (m) => Oldschool.hash(m, lib); // (for the self-test)
    // (Beta 3.28: Pieces left, so the wheel is the map's again)
    const wheel = () => false;
    const cancelDrag = (d) => { if (owns(d.kind)) { lastD = null; drawPreview(); } }; // (UI audit VD1: Esc in mid-drag: what was being drawn goes)
    return { pill, hashOf, wheel, owns, cancelDrag, back, settle, brushStep, pointerDown, pointerMove, pointerUp, hover, leave, redraw, update, buildPop, around, cancel, leaveTool, rightClick, dblClick, useTile, dropTile, loadLib, simplifyPts, get busy() { return baking; }, get debug() { return { pill: pill.shown, baking, due: !!timer, stale: staleNow, failed: !!failed, pending: pending.length, held: btnHeld, ...count }; }, TOOLS };
  }
  return { create };
})();
