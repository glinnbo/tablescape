// Toolbox → Cartographer: the Map table (Beta 3.12), the window the campaign's world and regional maps are worked on in.
// One window like the Handout table: the map as a picture, every tool at its side, as big as you drag it.
//   the picture  the map flat, with the TV's frame on it (drag its tab to move it, its corner to size it); or
//                "As on the TV": tilted and bulged, with the mist and the weather, the way the players see it. It is
//                drawn by the same code as the TV (table-atlas.js)
//   the tools    Move, Place, Route, Draw, Write, Erase; and, at the bottom, what is set once for a map: Maps (the atlas),
//                Assets, Grid, On the TV (tilt, bulge, blur, which side it faces, the mist) and Weather (the battlemap's).
//                One is picked; its choices stand next to the strip. A right-click opens a round menu (Beta 3.13).
//                A place, a route, a label or an asset that is picked shows what can be changed about it there.
//   the map      S().atlasMap: the atlas map main keeps for this window (state.atlasEdit). It is never the map of the
//                battlemap editor: every command names it (mapId), and it has its own Undo.
// While the window is open the battlemap on the GM screen rests (gm-play.js asks isOpen()).
'use strict';

const AtlasPanel = (() => {
  const { h, iconEl, openMenu, askText, Thumbs, clamp, toast } = UI;
  const D2R = Math.PI / 180;
  const FLAT = { tilt: 0, bulge: 0, blur: 0, turn: 0 };
  const INK = [{ hex: '#ffffff', label: 'White' }, { hex: '#e3963e', label: 'Torch' }, { hex: '#e4675e', label: 'Red' }, { hex: '#f2d14b', label: 'Yellow' }, { hex: '#5cc382', label: 'Green' },
    { hex: '#6fb4ff', label: 'Blue' }, { hex: '#b98cff', label: 'Violet' }, { hex: '#17181c', label: 'Black' }];
  const FACES = [{ value: 0, icon: 'arrow-down', tip: 'It faces the bottom side of the TV' }, { value: 90, icon: 'arrow-left', tip: 'It faces the left side' }, { value: 180, icon: 'arrow-up', tip: 'It faces the top side' }, { value: 270, icon: 'arrow-right', tip: 'It faces the right side' }];
  // the strip: at the top what is used all the time, at the bottom (low) what is set once for a map
  const TOOLS = [
    { id: 'move', icon: 'hand-grab', label: 'Move', key: 'V', tip: 'Move the view; pick a place, a route or a label to change it. Double click a place to open its map' },
    { id: 'place', icon: 'map-pin', label: 'Place', key: 'P', tip: 'Click the map to set a named place' },
    { id: 'route', icon: 'route', label: 'Route', key: 'R', tip: 'A line from click to click, counted in grid cells. With a grid shown it snaps to the cells (Alt: free)' },
    { id: 'draw', icon: 'pencil', label: 'Draw', key: 'D', tip: 'Draw on the map' },
    { id: 'write', icon: 'typography', label: 'Write', key: 'T', tip: 'Click the map to write on it' },
    { id: 'erase', icon: 'eraser', label: 'Erase', key: 'E', tip: 'Rub out what was drawn or written' },
    { id: 'maps', icon: 'map-2', label: 'Maps', tip: 'The maps of the atlas', low: true },
    { id: 'assets', icon: 'trees', label: 'Assets', tip: 'Pictures and animations that lie on the map', low: true },
    { id: 'grid', icon: 'grid-4x4', label: 'Grid', tip: 'A grid, and what one cell stands for', low: true },
    { id: 'view', icon: 'device-tv', label: 'On the TV', tip: 'Tilt, bulge, blur, and the mist at its edges', low: true },
    { id: 'weather', icon: 'cloud-rain', label: 'Weather', tip: 'Rain, snow, fog, a storm … as on a battlemap, and sunshine', low: true },
  ];
  const MARKERS = ['place', 'pin', 'x', 'dot', 'counter', 'note'];
  // (Beta 3.15) the tools with which what stands on the map can be picked: all but Route (a route often starts on a
  // marker), Draw and Erase. Picking with another one than Move switches to Move.
  const PICK = ['move', 'place', 'write', 'maps', 'assets', 'grid', 'view', 'weather'];
  const TIPS = ['The picture is the whole map, flat. The dashed frame is what the TV shows: drag the round handle at its corner to move it, the dot at the opposite corner to make it bigger or smaller.',
    'As on the TV shows it the way the players see it. There, dragging and the mouse wheel move the TV\'s camera.',
    'Drag the map to move the view, mouse wheel to zoom. The middle mouse button (or Alt + drag) moves the view with any tool.',
    'Right-click the map for a round menu (right-click again, Esc or a click beside it closes it): a place, a route, a label or an asset right there, or the TV looking there. Right-click a place, a route or an asset for what can be done with it.',
    'Place: click the map. A place has a name, a marker (medallion, diamond or pin), an icon and a colour; it can lead to another map and bring a note or a handout.',
    'Double click a place that leads to another map (Move tool; it wears a small door) to open that map. On the TV the camera dives into the place, the mist closes, and the other map opens (asked first). Zoom out (top right) goes back the same way.',
    'After a place is set, a route ended or a label written, the Move tool is back. Draw and Erase stay until you pick another tool or press Esc.',
    'Route: click from point to point; a right-click, a double click or Enter ends it, Backspace takes the last point back. With a grid shown the points snap to the middle of its cells; hold Alt for a free point. Its length is counted in grid cells, in what one cell stands for.',
    'A route\'s name stands where it covers no place. Drag its name along the road to put it somewhere else; "Name plate back by itself" returns it.',
    'How far is it? Right-click the map or a place: How far from here, or M at the pointer. Every click adds a bend; a double click, a right-click, Enter or Esc ends it. Nothing is kept.',
    'Keys: V Move, P Place, R Route, D Draw, T Write, E Erase, M measure. The Move tool lists the places and routes of the map: click one to show it here, the TV button to make the TV look there.',
    'A picked route glows. With Lock routes open, its points show as handles: drag one to move it, click the line to add one, right-click one to take it out. Travelled draws the part the party has walked solid, with a marker where they are; − and + move them one cell (one day, in what a cell stands for).',
    'The two locks at the top right keep markers and routes where they are: they can still be picked and changed, but not dragged. Open a lock to move them.',
    'Assets lie on the map: Add from the library, or drag one from the library onto the map. Animated ones move there too, up to 20 at once; more than that stand still.',
    'The mist hides where the map ends: white cloud or dark mist, kept with each map. Reach is how far it comes in from the map\'s edge, Screen edge how far from the rim of the TV.',
    'Weather is the battlemap\'s: the same mixes and layers, falling over the world map. Every map has its own.',
    'A world map comes onto the TV and leaves it with the table style\'s map change. While a world map is on the TV the battlemap under it rests; while this window is open, the battlemap on your screen rests too.',
    'Ctrl + Z takes back the last change to this map. Delete removes what is picked (the note that says so has an Undo too).',
    'Drag the corner of this window to make it bigger.'];
  const KEY = 'mapTable';
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function create(ctx) {
    const { cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const A = () => (S() && S().atlas) || { maps: [], look: {}, on: null, world: null, note: null, edit: null, history: {} };
    const M = () => (S() && S().atlasMap) || null;
    const mid = () => (M() ? M().id : null);
    const mcmd = (type, p = {}) => cmd(type, { mapId: mid(), ...p });
    const msend = (key, type, p = {}) => ctx.send(key, type, { mapId: mid(), ...p });
    // what the window remembers
    const ui = { tool: 'move', mode: 'flat', w: 780, h: 480, lockMarks: true, lockRoutes: true, moved: false, // (Beta 3.13: markers and routes are locked until their lock is opened; moved: the TV's handle was used once)
      place: { style: 'medallion', icon: 'city', color: '#e3963e' }, draw: { color: '#17181c', w: 3 }, write: { color: '#17181c', size: 3 }, route: { color: '#e4675e', look: 'dash', width: 2, arrow: true, round: true }, lookOpen: false }; // (Beta 3.14: how the next route is drawn; Second Builder (second-cartographer-polish): lookOpen: a picked place's Look is unfolded)
    try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k of Object.keys(ui)) if (s && k in s && typeof s[k] === typeof ui[k]) ui[k] = typeof ui[k] === 'object' ? { ...ui[k], ...s[k] } : s[k]; } catch {}
    if (!TOOLS.some((t) => t.id === ui.tool)) ui.tool = 'move';
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch {} };
    const cams = {}; const fitted = {}; // the window's own view of each map (flat)
    let win = null; // the open window: { ed, addAsset, debug, … } (null: closed)

    const def = () => ({
      id: 'atlas', title: 'Cartographer', icon: 'world', tips: TIPS, // (the Toolbox's Cartographer tile; Third Builder (third-small-labels): E1, one name, was Map table)
      place: (r, el) => ({ x: Math.max(12, Math.round((r.width - el.offsetWidth) / 2)), y: 14 }),
      build,
    });

    // ---------- small parts ----------
    const swatches = (label, get, set) => {
      const wrap = h('div', { class: 'swatches color-row' });
      for (const col of INK) wrap.append(h('button', { class: 'swatch', style: `background:${col.hex}`, dataset: { v: col.hex }, 'aria-label': col.label, 'data-tip': col.label, onclick: () => set(col.hex) }));
      const pick = h('input', { type: 'color', 'aria-label': 'Any colour', oninput: (e) => set(e.target.value, true) });
      const box = h('label', { class: 'swatch pick', 'data-tip': 'Any colour' }, iconEl('palette'), pick);
      wrap.append(box);
      c().bind(() => { const v = get(); let preset = false; for (const b of wrap.querySelectorAll('button.swatch')) { const on = b.dataset.v === v; b.classList.toggle('on', on); preset = preset || on; } box.classList.toggle('on', !preset); box.style.background = preset ? '' : v; });
      return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), wrap);
    };
    const field = (label, el) => h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), el);
    const undoToast = (res) => { if (res && res.undo) ctx.undoToast(res); };

    function build() {
      if (win) win.close();
      ui.tool = 'move'; // (the window always opens with the Move tool: Beta 3.15)
      cmd('atlas.open', {}); // (the map it had, else the one on the TV, else the world map)
      let sel = null; // what is picked: { kind: 'mark' | 'text' | 'asset' | 'token', id }
      let routeId = null; let routeQ = Promise.resolve(); // the route being drawn
      let tvView = null; let tvBusy = false; let tvAt = 0; // the TV's frame while it is dragged here (ahead of the state)
      let pen = null; let hover = null; let focusTitle = false;

      const view = h('div', { class: 'mt-view' });
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mt-svg');
      const mk = (tag, cls) => { const e = document.createElementNS(NS, tag); e.setAttribute('class', cls); svg.append(e); return e; };
      const rglow = mk('polyline', 'mt-rglow'); const rline = mk('polyline', 'mt-rline'); // a picked route: its glow, and the line to click for one more point
      const penEl = mk('polyline', 'mt-pen'); const rubber = mk('polyline', 'mt-rubber'); const giz = mk('polygon', 'mt-giz');
      const measEl = mk('polyline', 'mt-measure'); let meas = null; // (Second Builder (second-cartographer-polish): a line that only measures: { pts })
      const countEl = h('span', { class: 'mt-count', hidden: true }); const rhs = []; // what the next leg adds, next to the pointer; the handles of a picked route's points
      // the TV's frame: a round handle at its corner to move it (it stays in the picture when the corner does not), a dot
      // at the opposite corner to size it
      const tvGrab = h('span', { class: `mt-tv-grab${ui.moved ? '' : ' fresh'}`, hidden: true, 'data-tip': 'What the TV shows. Drag to move it' }, h('i', { class: 'mt-tv-knob' }, iconEl('arrows-move')), h('b', {}, 'TV'));
      const tvGrip = h('span', { class: 'mt-tv-grip', 'data-tip': 'Drag: the TV shows more or less of the map' });
      const tvFace = h('span', { class: 'mt-tv-face' }, iconEl('chevron-down'));
      const tv = h('div', { class: 'mt-tv', hidden: true }, tvGrip, tvFace);
      const hSize = h('span', { class: 'mt-h size', dataset: { k: 'size' }, hidden: true, 'data-tip': 'Drag: bigger or smaller' });
      const hTurn = h('span', { class: 'mt-h turn', dataset: { k: 'turn' }, hidden: true, 'data-tip': 'Drag: turn it (Shift: in steps)' }, iconEl('rotate-clockwise'));
      const over = h('div', { class: 'mt-over' }, svg, tv, tvGrab, hSize, hTurn, countEl);
      const wrap = h('div', { class: 'mt-wrap' }, view, over);
      const none = h('div', { class: 'mt-none' }, h('p', { class: 'hint' }, 'No world map yet.'),
        c().btn('Add a map', 'plus', () => ctx.Drawer.open({ filter: 'maps', purpose: 'atlasMap' }), { kind: 'primary', tip: 'A picture from the library becomes a world or regional map' }));
      // top right of the picture: back out of a regional map, and the two locks
      const lockBtn = (k, label, ic) => {
        const b = h('button', { class: 'mt-lock', onclick: () => { ui[k] = !ui[k]; save(); paintTop(); } }, iconEl('lock'), iconEl(ic));
        b.dataset.k = k; b.dataset.label = label;
        return b;
      };
      const zoomOutB = h('button', { class: 'btn small mt-out', hidden: true, 'data-tip': 'Back out of this map, to the one that leads here' }, iconEl('zoom-out'), 'Zoom out');
      const lockM = lockBtn('lockMarks', 'markers', 'map-pin'); const lockR = lockBtn('lockRoutes', 'routes', 'route');
      const top = h('div', { class: 'mt-top' }, zoomOutB, lockM, lockR);
      function paintTop() {
        for (const b of [lockM, lockR]) {
          const on = !!ui[b.dataset.k];
          b.classList.toggle('on', on); b.firstChild.replaceWith(iconEl(on ? 'lock' : 'lock-open'));
          b.setAttribute('aria-label', `Lock ${b.dataset.label}`); b.setAttribute('aria-pressed', String(on));
          b.dataset.tip = on ? `The ${b.dataset.label} are locked: they can be picked and changed, not dragged. Click to unlock` : `The ${b.dataset.label} can be dragged. Click to lock them`;
        }
      }
      paintTop();
      const stage = h('div', { class: 'mt-stage', tabindex: '0' }, wrap, top, none);
      const ed = TableAtlas.mount(view, { edit: true });

      // ---------- geometry ----------
      const tIn = () => { const v = (S() && S().view) || {}; const w = v.world || { w: 1920, h: 1080 }; const ppi = v.ppi || 96; return { w: w.w / ppi, h: w.h / ppi }; };
      const viewNow = () => tvView || (M() ? M().view : { x: 0, y: 0, zoom: 1 });
      const camOfView = (v) => { const t = tIn(); return { cx: (t.w / 2 - v.x) / v.zoom, cy: (t.h / 2 - v.y) / v.zoom, S: t.h / (2 * v.zoom) }; };
      const viewOfCam = (cm) => { const t = tIn(); const z = clamp(t.h / (2 * cm.S), 0.05, 20); return { x: r3(t.w / 2 - cm.cx * z), y: r3(t.h / 2 - cm.cy * z), zoom: Math.round(z * 1e5) / 1e5 }; };
      const dims = () => ({ W: wrap.clientWidth || 1, H: wrap.clientHeight || 1 });
      const tvFrame = () => { const cv = camOfView(viewNow()); const t = tIn(); const a = t.w / t.h; return { x: cv.cx - cv.S * a, y: cv.cy - cv.S, w: 2 * cv.S * a, h: 2 * cv.S }; };
      const mapRect = () => ed.rect() || tvFrame();
      const span = () => { const R = mapRect(); return Math.max(R.w, R.h); };
      const fitCam = () => { const R = mapRect(); const d = dims(); return { cx: R.x + R.w / 2, cy: R.y + R.h / 2, S: Math.max(R.h / 2, R.w / 2 / (d.W / d.H)) * 1.06 }; };
      const winCam = () => { const id = mid(); if (!cams[id] || (!fitted[id] && ed.rect())) { cams[id] = fitCam(); fitted[id] = !!ed.rect(); } return cams[id]; };
      const lookNow = () => (ui.mode === 'flat' ? FLAT : { ...FLAT, ...(A().look || {}) });
      const camNow = () => (ui.mode === 'flat' ? winCam() : camOfView(viewNow()));
      const G = () => { const d = dims(); return TableAtlas.geo(lookNow(), camNow(), d.W, d.H); };
      const pt = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const toMap = (p) => G().toMap(p.x, p.y);
      const inchPx = (g, x, y) => { const p = g.toScreen(x, y); return p ? (p.scale * g.H) / 2 / camNow().S : 0; }; // how many pixels an inch of the map is, at that spot

      // ---------- the editor follows the state ----------
      function layout() {
        ui.w = clamp(ui.w, 420, Math.max(420, window.innerWidth - 400)); ui.h = clamp(ui.h, 280, Math.max(280, window.innerHeight - 190));
        stage.style.width = `${ui.w}px`; stage.style.height = `${ui.h}px`;
        let w = ui.w; let hh = ui.h;
        if (ui.mode === 'tv') { const t = tIn(); const a = t.w / t.h; if (w / hh > a) w = hh * a; else hh = w / a; }
        wrap.style.width = `${Math.round(w)}px`; wrap.style.height = `${Math.round(hh)}px`;
        wrap.style.left = `${Math.round((ui.w - w) / 2)}px`; wrap.style.top = `${Math.round((ui.h - hh) / 2)}px`;
      }
      function syncEd() {
        const m = M();
        stage.classList.toggle('none', !m);
        layout();
        if (!m) { ed.set({ view: S().view, atlas: null }); return; }
        ed.set({ view: S().view, atlas: { id: m.id, look: A().look, map: tvView ? { ...m, view: tvView } : m, note: null } });
        ed.setEdit({ cam: { ...camNow() }, plain: ui.mode === 'flat' });
        ed.setSelected(sel ? sel.id : null);
        view.classList.toggle('pick', PICK.includes(ui.tool));
        view.classList.toggle('grab', ['move', 'write'].includes(ui.tool));
        wrap.dataset.tool = ui.tool;
      }

      // ---------- the TV's frame, moved from here ----------
      function setTv(cm, key, hold) { tvView = viewOfCam(cm); tvBusy = true; msend(key, 'view.update', { ...tvView, live: true, hold: !!hold }); syncEd(); }
      function endTv(key) { tvBusy = false; tvAt = Date.now(); if (tvView) mcmd('view.update', { ...tvView, coalesce: key }); }
      const camLimits = () => { if (ui.mode === 'tv') { const t = tIn(); return [t.h / 40, t.h * 10]; } const s = span(); return [s / 400, s * 3]; };

      // ---------- what is picked ----------
      const itemOf = (id) => {
        const m = M(); if (!m || !id) return null;
        const k = m.marks.find((x) => x.id === id); if (k) return { sel: { kind: 'mark', id }, o: k, type: 'mark.update' };
        const d = m.draw.find((x) => x.id === id); if (d) return { sel: { kind: 'text', id }, o: d, type: 'draw.update' };
        const l = m.layers.find((x) => x.id === id); if (l) return { sel: { kind: l.role === 'asset' ? 'asset' : 'token', id }, o: l, type: 'layer.update' };
        return null;
      };
      const selItem = () => (sel ? itemOf(sel.id) : null);
      // (something just made is picked before the state that brings it has arrived: it gets a moment)
      let selAt = 0;
      const selLost = () => !!sel && !selItem() && Date.now() - selAt > 1500;
      function select(s) { sel = s; selAt = Date.now(); ed.setSelected(s ? s.id : null); renderOpts(); }
      async function removeSel() {
        const it = selItem(); if (!it) return;
        const mapId = mid(); const type = it.sel.kind === 'mark' ? 'mark.remove' : it.sel.kind === 'text' ? 'draw.remove' : 'layer.remove';
        const name = nameOfItem(it); const title = it.o.title || it.o.name || '';
        if (routeId === it.o.id) routeId = null;
        select(null);
        const r = await mcmd(type, { id: it.o.id });
        // Second Builder (second-cartographer-polish): an Undo right there (H5)
        if (r && r.ok) toast(title ? `${title} removed` : `${name} removed`, { undo: () => cmd('history.undo', { mapId }) });
      }
      function setTool(t) {
        ui.tool = t; save();
        if (sel && !((sel.kind === 'asset' && t === 'assets') || (sel.kind !== 'asset' && ['move', 'place', 'write'].includes(t)))) sel = null;
        if (t !== 'route') routeId = null;
        for (const b of strip.children) b.classList.toggle('on', b.dataset.id === t);
        syncEd(); renderOpts();
      }

      // ---------- from map to map (Beta 3.13) ----------
      // the map a regional map is left to: one whose place leads here (the world map first), else the world map
      const parentOf = (id) => { const a = A(); const lead = a.maps.filter((x) => x.id !== id && (x.to || []).includes(id)); return (lead.find((x) => x.id === a.world) || lead[0] || a.maps.find((x) => x.id === a.world && x.id !== id) || {}).id || null; };
      // open the map a place leads to: on the TV the camera dives into the place; not on the TV, the window just changes
      function openRegion(m) {
        if (!m || !m.to || !A().maps.some((x) => x.id === m.to)) return;
        sel = null; routeId = null;
        if (A().on === mid()) cmd('atlas.show', { id: m.to, via: 'in', place: m.id }); else cmd('atlas.open', { id: m.to });
      }
      function askOpen(m) {
        const dest = m && m.to ? A().maps.find((x) => x.id === m.to) : null;
        if (!dest) return;
        if (A().on !== mid()) { openRegion(m); return; } // (Second Builder (second-cartographer-polish): only a trip on the TV asks first)
        let dlg = null;
        const yes = c().btn('Open', 'door-enter', () => { dlg.close(); openRegion(m); }, { kind: 'primary' });
        dlg = UI.dialog(`Open ${dest.name}?`, h('div', { class: 'stack' }, h('p', { class: 'hint' }, A().on === mid() ? 'The TV dives into this place and opens the map behind it.' : 'This window changes to the map behind this place.'),
          h('div', { class: 'ctl-row mt-ask' }, yes, c().btn('No', 'x', () => dlg.close()))));
        requestAnimationFrame(() => yes.focus());
      }
      function zoomOut() {
        const to = parentOf(mid()); if (!to) return;
        sel = null; routeId = null;
        if (A().on === mid()) cmd('atlas.show', { id: to, via: 'out' }); else cmd('atlas.open', { id: to });
      }
      zoomOutB.onclick = zoomOut;
      const locked = (it) => it.sel.kind === 'mark' && (it.o.kind === 'route' ? ui.lockRoutes : MARKERS.includes(it.o.kind) && ui.lockMarks);

      // ---------- the pointer ----------
      function track(e, onMove, onUp) {
        try { wrap.setPointerCapture(e.pointerId); } catch {}
        const mv = (ev) => onMove(pt(ev), ev);
        const up = (ev) => { wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); if (onUp) onUp(pt(ev), ev); };
        wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
      }
      // the view: this window's own (flat), or the TV's camera (as on the TV)
      function startPan(e, p0, onClick) {
        const m0 = toMap(p0); if (!m0) return;
        const onTv = ui.mode === 'tv'; const key = `atl-view-${Date.now()}`; let moved = false;
        track(e, (p) => {
          if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
          moved = true; wrap.classList.add('panning');
          const q = toMap(p); if (!q) return;
          const cm = { ...camNow() }; cm.cx += m0.x - q.x; cm.cy += m0.y - q.y;
          if (onTv) setTv(cm, key, true); else { cams[mid()] = cm; syncEd(); }
        }, () => { wrap.classList.remove('panning'); if (onTv && moved) endTv(key); if (!moved && onClick) onClick(); });
      }
      function dragFrame(e, p0, kind) {
        e.preventDefault();
        const cam0 = camOfView(viewNow()); const m0 = toMap(p0); if (!m0) return;
        const key = `atl-view-${Date.now()}`; const t = tIn(); const a = t.w / t.h; const lim = [t.h / 40, t.h * 10];
        track(e, (p) => {
          const q = toMap(p); if (!q) return;
          const cm = { ...cam0 };
          if (kind === 'move') { cm.cx += q.x - m0.x; cm.cy += q.y - m0.y; } else cm.S = clamp(Math.max(Math.abs(q.y - cam0.cy), Math.abs(q.x - cam0.cx) / a), lim[0], lim[1]);
          setTv(cm, key, true);
        }, () => endTv(key));
      }
      function dragItem(e, p0, it) {
        const m0 = toMap(p0); if (!m0) return;
        const ox = it.o.x - m0.x; const oy = it.o.y - m0.y; const key = `atl-drag-${Date.now()}`; let moved = false; let at = null;
        track(e, (p) => {
          if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
          moved = true;
          const q = toMap(p); if (!q) return;
          at = { x: r3(q.x + ox), y: r3(q.y + oy) };
          msend(key, it.type, { id: it.o.id, ...at });
        }, () => { if (moved && at) mcmd(it.type, { id: it.o.id, ...at, coalesce: key }); });
      }
      // assets lie on the map: the one under the pointer (the topmost first)
      const assetBox = (l) => { const s = ed.assetSize(l); return s ? { ...s, co: Math.cos((l.rotation || 0) * D2R), si: Math.sin((l.rotation || 0) * D2R) } : null; };
      const assetLocal = (l, b, q) => { const dx = q.x - l.x; const dy = q.y - l.y; return { x: dx * b.co + dy * b.si, y: -dx * b.si + dy * b.co }; };
      function assetAt(p) {
        const q = toMap(p); const m = M(); if (!q || !m) return null;
        for (let i = m.layers.length - 1; i >= 0; i--) {
          const l = m.layers[i]; if (l.role !== 'asset' || l.hidden) continue;
          const b = assetBox(l); if (!b) continue;
          const o = assetLocal(l, b, q);
          if (Math.abs(o.x) <= b.w / 2 && Math.abs(o.y) <= b.h / 2) return l;
        }
        return null;
      }
      // Second Builder (second-cartographer-polish): a route's name plate is pulled along its road (also when routes
      // are locked: the road itself stays where it is). Where the plate's foot stands is kept, not where it was grabbed.
      function dragPlate(e, p0, it, node) {
        const id = it.o.id; const key = `atl-plate-${Date.now()}`; let moved = false; let t = null;
        const r0 = wrap.getBoundingClientRect(); const a = node.getBoundingClientRect(); const off = { x: a.left - r0.left - p0.x, y: a.top - r0.top - p0.y };
        track(e, (p) => {
          if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
          moved = true;
          const q = toMap({ x: p.x + off.x, y: p.y + off.y }); const r = itemOf(id); if (!q || !r) return;
          t = r3(TableAtlas.routeT(r.o.pts, q.x, q.y));
          msend(key, 'mark.update', { id, labelAt: t });
        }, () => { if (moved && t != null) mcmd('mark.update', { id, labelAt: t, coalesce: key }); });
      }
      function dragGizmo(e, p0, kind) {
        e.preventDefault();
        const it = selItem(); if (!it || it.sel.kind !== 'asset') return;
        const l = it.o; const b0 = assetBox(l); if (!b0) return;
        const key = `atl-giz-${Date.now()}`; let patch = null;
        track(e, (p, ev) => {
          const q = toMap(p); if (!q) return;
          if (kind === 'size') { const o = assetLocal(l, b0, q); patch = { w: r3(Math.max(span() / 400, 2 * Math.max(Math.abs(o.x), Math.abs(o.y) * (b0.w / b0.h)))) }; }
          else { let a = Math.atan2(q.y - l.y, q.x - l.x) / D2R + 90; if (ev.shiftKey) a = Math.round(a / 15) * 15; patch = { rotation: Math.round((((a + 180) % 360 + 360) % 360 - 180) * 10) / 10 }; }
          msend(key, 'layer.update', { id: l.id, ...patch });
        }, () => { if (patch) mcmd('layer.update', { id: l.id, ...patch, coalesce: key }); });
      }
      async function placeAt(p) {
        const q = toMap(p); if (!q) return;
        const r = await mcmd('mark.add', { kind: 'place', x: r3(q.x), y: r3(q.y), title: '', style: ui.place.style, icon: ui.place.icon, color: ui.place.color });
        if (r && r.selected) { focusTitle = true; if (ui.tool !== 'move') setTool('move'); select({ kind: 'mark', id: r.selected }); } // (one place set: the Move tool is back)
      }
      // a route's point: on the middle of a grid cell when the map shows its grid (Alt: where the pointer is)
      const snapPt = (q, free) => { const g = M() && M().grid; return q && g && g.show && !free ? Geom.snap(g, q.x, q.y) : q; };
      // a picked route's points (Beta 3.14): one dragged, one added on the line, one taken out
      function dragRoutePoint(e, i) {
        const it = selItem(); if (!it || it.o.kind !== 'route') return;
        e.preventDefault();
        const id = it.o.id; const key = `atl-rpt-${Date.now()}`; let at = null;
        track(e, (p, ev) => { const q = snapPt(toMap(p), ev.altKey); if (!q) return; at = { x: r3(q.x), y: r3(q.y) }; msend(key, 'mark.route', { id, at: i, ...at }); },
          () => { if (at) mcmd('mark.route', { id, at: i, ...at, coalesce: key }); });
      }
      function addRoutePoint(p, e) {
        const it = selItem(); const q = toMap(p); if (!it || it.o.kind !== 'route' || !q) return;
        const pts = it.o.pts; let best = 1; let bd = Infinity;
        for (let i = 0; i + 3 < pts.length; i += 2) { const d = segDist(q.x, q.y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]); if (d < bd) { bd = d; best = i / 2 + 1; } }
        const s = snapPt(q, e.altKey);
        mcmd('mark.route', { id: it.o.id, insert: best, x: r3(s.x), y: r3(s.y) });
      }
      // a route is ended (a right-click, a double click, Enter, Done): the Move tool is back, with the route picked. One
      // that has no second point is taken away again.
      function endRoute() {
        routeQ = routeQ.then(() => {
          const id = routeId; routeId = null;
          const r = id && M() ? M().marks.find((x) => x.id === id) : null;
          if (r && r.pts.length < 4) { mcmd('mark.remove', { id }); if (ui.tool === 'route') setTool('move'); else renderOpts(); return; }
          if (ui.tool === 'route') setTool('move');
          if (r) select({ kind: 'mark', id }); else renderOpts();
        }).catch(() => {});
      }
      function routeClick(p, twice, free) {
        const q = snapPt(toMap(p), free); if (!q) return;
        if (twice) { endRoute(); return; } // (a double click ends it; its first click set the last point)
        routeQ = routeQ.then(async () => {
          if (routeId && M() && M().marks.some((x) => x.id === routeId)) { await mcmd('mark.route', { id: routeId, x: q.x, y: q.y }); return; }
          const r = await mcmd('mark.add', { kind: 'route', x: r3(q.x), y: r3(q.y), ...ui.route });
          routeId = r && r.selected ? r.selected : null; renderOpts();
        }).catch(() => {});
      }
      // Second Builder (second-cartographer-polish): how far is it? A line from a spot, counted like a route, that is not
      // kept: every click adds a bend; a double click, a right-click, Enter or Esc ends it
      function startMeasure(q, free) {
        const s0 = snapPt(q, free); if (!s0) return;
        meas = { pts: [r3(s0.x), r3(s0.y)] }; routeId = null;
        wrap.classList.add('measuring'); syncEd();
      }
      function endMeasure() { meas = null; wrap.classList.remove('measuring'); countEl.hidden = true; measEl.style.display = 'none'; syncEd(); }
      const penW = () => (ui.draw.w / 1000) * span();
      function startPen(e, p0) {
        const q0 = toMap(p0); if (!q0) return;
        pen = { pts: [r3(q0.x), r3(q0.y)], last: p0 };
        track(e, (p) => { if (!pen || Math.hypot(p.x - pen.last.x, p.y - pen.last.y) < 2) return; const q = toMap(p); if (!q) return; pen.pts.push(r3(q.x), r3(q.y)); pen.last = p; },
          async () => { const done = pen; if (!done) return; await mcmd('draw.stroke', { color: ui.draw.color, w: r3(penW()), pts: done.pts }); if (pen === done) pen = null; });
      }
      async function writeAt(p) {
        const q = toMap(p); if (!q) return;
        const text = await askText('Write on the map', '', { ok: 'Write' });
        if (!text) return;
        const r = await mcmd('draw.add', { x: r3(q.x), y: r3(q.y), text, color: ui.write.color, size: r3((ui.write.size / 100) * span()) });
        if (r && r.selected) { if (ui.tool !== 'move') setTool('move'); select({ kind: 'text', id: r.selected }); }
      }
      function startErase(e, p0) {
        const key = `atl-erase-${Date.now()}`; const gone = new Set();
        const rub = (p) => {
          const q = toMap(p); const q2 = toMap({ x: p.x + 9, y: p.y }); const m = M(); if (!q || !q2 || !m) return;
          const tol = Math.hypot(q2.x - q.x, q2.y - q.y); const ids = [];
          for (const d of m.draw) {
            if (gone.has(d.id)) continue;
            let hit = false;
            if (d.kind === 'pen') { const r = tol + d.w / 2; for (let i = 0; i + 1 < d.pts.length && !hit; i += 2) { const j = Math.min(i + 2, d.pts.length - 2); hit = segDist(q.x, q.y, d.pts[i], d.pts[i + 1], d.pts[j], d.pts[j + 1]) <= r; } }
            else if (d.kind === 'text') hit = Math.abs(q.x - d.x) < d.size * 0.3 * Math.max(1, String(d.text).length) + tol && Math.abs(q.y - d.y) < d.size * 0.6 + tol;
            if (hit) { ids.push(d.id); gone.add(d.id); }
          }
          if (ids.length) mcmd('draw.remove', { ids, coalesce: key });
        };
        rub(p0); track(e, rub);
      }
      const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax; const dy = by - ay; const l2 = dx * dx + dy * dy; const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0; return Math.hypot(px - ax - dx * t, py - ay - dy * t); };

      // the route whose line runs under the pointer (within a few pixels)
      function routeAt(p) {
        const m = M(); if (!m) return null;
        const g = G(); let best = null; let bd = 7;
        for (const r of m.marks) {
          if (r.kind !== 'route' || r.pts.length < 4) continue;
          const poly = TableAtlas.routeLine(r.pts, r.round !== false ? TableAtlas.routeWidth(r, span()) * 9 : 0);
          let a = g.toScreen(poly[0], poly[1]);
          for (let i = 2; i + 1 < poly.length; i += 2) { const b = g.toScreen(poly[i], poly[i + 1]); if (a && b) { const d = segDist(p.x, p.y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; best = r; } } a = b; }
        }
        return best;
      }
      // something locked is pressed and pulled: it stays, and its lock flashes to say why
      function lockedPress(e, p0, it) {
        const b = it.o.kind === 'route' ? lockR : lockM; let said = false;
        track(e, (p) => { if (said || Math.hypot(p.x - p0.x, p.y - p0.y) < 5) return; said = true; b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); });
      }
      // (a pointer event does not count clicks: two presses of the left button, close in time and place, are a double click)
      let lastDown = { t: 0, x: 0, y: 0 };
      wrap.addEventListener('pointerdown', (e) => {
        if (!M()) return;
        stage.focus({ preventScroll: true });
        const p = pt(e);
        const twice = e.button === 0 && e.timeStamp - lastDown.t < 400 && Math.hypot(p.x - lastDown.x, p.y - lastDown.y) < 6;
        if (e.button === 0) lastDown = twice ? { t: 0, x: 0, y: 0 } : { t: e.timeStamp, x: p.x, y: p.y };
        if (e.button === 1 || (e.button === 0 && e.altKey && !meas)) { e.preventDefault(); startPan(e, p); return; }
        if (e.button !== 0) return;
        if (meas) { e.preventDefault(); if (twice) endMeasure(); else { const q = snapPt(toMap(p), e.altKey); if (q) { meas.pts.push(r3(q.x), r3(q.y)); syncEd(); } } return; } // (Second Builder (second-cartographer-polish))
        if (e.target.closest('.mt-tv-grab')) { if (!ui.moved) { ui.moved = true; save(); tvGrab.classList.remove('fresh'); } dragFrame(e, p, 'move'); return; }
        if (e.target.closest('.mt-tv-grip')) { dragFrame(e, p, 'size'); return; }
        const hd = e.target.closest('.mt-h'); if (hd) { dragGizmo(e, p, hd.dataset.k); return; }
        const rh = e.target.closest('.mt-rh'); if (rh) { dragRoutePoint(e, Number(rh.dataset.i)); return; }
        if (e.target === rline) { addRoutePoint(p, e); return; }
        const t = ui.tool; const node = e.target.closest('.atl-s');
        const pick = (it, plate) => {
          if (t !== 'move') setTool('move');
          select(it.sel);
          if (twice && t === 'move' && it.o.kind === 'place' && it.o.to) { askOpen(it.o); return; } // (a double click on a place that leads somewhere)
          if (plate && it.o.kind === 'route') { dragPlate(e, p, it, plate); return; } // (Second Builder (second-cartographer-polish): its name plate slides along it)
          if (locked(it)) lockedPress(e, p, it); else dragItem(e, p, it); // (locked: picked, but it stays where it is)
        };
        // (with the Assets tool an asset under the pointer comes first, also under a marker that stands on it)
        if (t === 'assets') { const l = assetAt(p); if (l) { select({ kind: 'asset', id: l.id }); dragItem(e, p, itemOf(l.id)); return; } }
        if (node && PICK.includes(t)) { const it = itemOf(node.dataset.id); if (it) { pick(it, node); return; } }
        // a route is picked by its line too (not while a place is being set or a label written: those may go onto a road)
        if (PICK.includes(t) && t !== 'place' && t !== 'write') { const r = routeAt(p); if (r) { pick(itemOf(r.id)); return; } }
        if (t === 'place') { placeAt(p); return; }
        if (t === 'route') { routeClick(p, twice, e.altKey); return; }
        if (t === 'draw') { startPen(e, p); return; }
        if (t === 'write') { writeAt(p); return; }
        if (t === 'erase') { startErase(e, p); return; }
        if (sel) select(null);
        startPan(e, p, t === 'assets' ? () => setTool('move') : null); // (a click beside the assets: the Move tool is back)
      });
      // right-click: a round menu with what can be made here, or what can be done with the thing under the pointer
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!M() || !ctx.Radial) return;
        if (routeId && ui.tool === 'route') { endRoute(); return; } // (Beta 3.15: a right-click ends the route being drawn)
        if (meas) { endMeasure(); return; } // (Second Builder (second-cartographer-polish): and the measuring line)
        const rh = e.target.closest('.mt-rh'); // (a point of the picked route: it is taken out)
        if (rh) { const it0 = selItem(); if (it0 && it0.o.kind === 'route') mcmd('mark.route', { id: it0.o.id, remove: Number(rh.dataset.i) }); return; }
        const p = pt(e); const q = toMap(p);
        const node = e.target.closest('.atl-s'); const it = node ? itemOf(node.dataset.id) : (() => { const l = assetAt(p); return l ? itemOf(l.id) : null; })();
        const items = [];
        if (it && it.sel.kind !== 'token') {
          const o = it.o; const upd = (patch) => mcmd(it.type, { id: o.id, ...patch });
          if (it.sel.kind === 'asset') { if (ui.tool !== 'assets') setTool('assets'); } else if (ui.tool !== 'move') setTool('move');
          select(it.sel);
          if (it.sel.kind === 'asset') items.push({ icon: 'copy', label: 'Copy', run: async () => { const r = await mcmd('layer.duplicate', { id: o.id, dx: o.w * 0.3, dy: o.w * 0.3 }); if (r && r.selected) select({ kind: 'asset', id: r.selected }); } },
            { icon: 'stack-front', label: 'To the front', run: () => mcmd('layer.order', { id: o.id, to: 'front' }) });
          else {
            const dest = o.kind === 'place' && o.to ? A().maps.find((x) => x.id === o.to) : null;
            if (dest) items.push({ icon: 'door-enter', label: `Open ${dest.name}`, run: () => openRegion(o) });
            if (o.kind === 'place' && o.note && A().on === mid()) items.push({ icon: 'message', label: A().note === o.id ? 'Put its note away' : 'Show its note', run: () => cmd('atlas.note', { id: o.id }) });
            if (o.kind === 'place') items.push({ icon: 'ruler-measure', label: 'How far from here', run: () => startMeasure({ x: o.x, y: o.y }, true) }); // (Second Builder (second-cartographer-polish))
            if (o.kind === 'route') items.push({ icon: 'route', label: 'Draw on', run: () => { routeId = o.id; sel = null; setTool('route'); } }, { icon: 'arrow-back-up', label: 'One point back', run: () => mcmd('mark.route', { id: o.id, back: true }) });
            items.push({ icon: o.hidden ? 'eye' : 'eye-off', label: o.hidden ? 'Unhide' : 'Hide', run: () => upd({ hidden: !o.hidden }) });
          }
          items.push({ icon: 'trash', label: 'Remove', danger: true, run: () => { select(it.sel); removeSel(); } });
          ctx.Radial.open(e.clientX, e.clientY, items, nameOfItem(it), { modal: true });
          return;
        }
        if (!q) return;
        items.push({ icon: 'map-pin', label: 'Place here', run: () => { if (ui.tool !== 'place') setTool('place'); placeAt(p); } },
          { icon: 'route', label: 'Route from here', run: () => { setTool('route'); routeClick(p, false); } },
          { icon: 'typography', label: 'Write here', run: () => { if (ui.tool !== 'write') setTool('write'); writeAt(p); } },
          { icon: 'ruler-measure', label: 'How far from here', run: () => startMeasure(q, false) }, // (Second Builder (second-cartographer-polish))
          { icon: 'trees', label: 'Asset here', run: () => ctx.Drawer.open({ cat: 'assets', purpose: 'atlasAsset', at: { x: r3(q.x), y: r3(q.y) } }) },
          { icon: 'device-tv', label: 'TV looks here', run: () => { const cm = { ...camOfView(viewNow()), cx: q.x, cy: q.y }; mcmd('view.update', viewOfCam(cm)); } });
        ctx.Radial.open(e.clientX, e.clientY, items, 'Here', { modal: true });
      });
      // Second Builder (second-cartographer-polish): an asset dragged from the library lies where it is dropped
      const draggedAsset = (e) => [...e.dataTransfer.types].includes('application/x-ts-asset');
      wrap.addEventListener('dragover', (e) => { if (!M() || !draggedAsset(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; wrap.classList.add('drop-ok'); });
      wrap.addEventListener('dragleave', () => wrap.classList.remove('drop-ok'));
      wrap.addEventListener('drop', (e) => {
        wrap.classList.remove('drop-ok');
        if (!M() || !draggedAsset(e)) return;
        let a = null; try { a = JSON.parse(e.dataTransfer.getData('application/x-ts-asset') || 'null'); } catch {}
        e.preventDefault(); e.stopPropagation();
        if (!a || !a.path) return;
        if (a.cat && a.cat !== 'assets') { toast('Only assets lie on a world map: maps come in under Maps', { kind: 'error' }); return; }
        const q = toMap(pt(e)); if (q) win.addAsset(a, { x: r3(q.x), y: r3(q.y) });
      });
      wrap.addEventListener('pointermove', (e) => { hover = pt(e); hover.free = e.altKey; });
      wrap.addEventListener('pointerleave', () => { hover = null; });
      let wheelKey = null; let wheelT = 0;
      wrap.addEventListener('wheel', (e) => {
        if (!M()) return;
        e.preventDefault();
        const q = toMap(pt(e)); if (!q) return;
        const cm = { ...camNow() }; const lim = camLimits();
        const S1 = clamp(cm.S / Math.exp(-e.deltaY * 0.0015), lim[0], lim[1]); const k = S1 / cm.S;
        cm.cx = q.x - (q.x - cm.cx) * k; cm.cy = q.y - (q.y - cm.cy) * k; cm.S = S1;
        if (ui.mode === 'tv') { wheelKey = wheelKey || `atl-zoom-${Date.now()}`; setTv(cm, wheelKey, false); clearTimeout(wheelT); const key = wheelKey; wheelT = setTimeout(() => { wheelKey = null; endTv(key); }, 260); }
        else { cams[mid()] = cm; syncEd(); }
      }, { passive: false });

      // ---------- what lies over the picture: the TV's frame, the stroke being drawn, the route's next leg, an asset's handles ----------
      function drawOver(g) {
        const m = M();
        const onFlat = !!m && ui.mode === 'flat';
        tv.hidden = !onFlat; tvGrab.hidden = !onFlat;
        if (onFlat) {
          const F = tvFrame(); const a = g.toScreen(F.x, F.y); const b = g.toScreen(F.x + F.w, F.y + F.h);
          if (a && b) {
            tv.style.left = `${a.x.toFixed(1)}px`; tv.style.top = `${a.y.toFixed(1)}px`; tv.style.width = `${(b.x - a.x).toFixed(1)}px`; tv.style.height = `${(b.y - a.y).toFixed(1)}px`;
            // (its handle stays in the picture: at the frame's corner, or where the frame's edge leaves the picture)
            tvGrab.style.left = `${clamp(a.x, 18, Math.max(18, g.W - 60)).toFixed(1)}px`; tvGrab.style.top = `${clamp(a.y, 18, Math.max(18, g.H - 18)).toFixed(1)}px`;
          }
          tv.dataset.face = String((((A().look || {}).turn || 0) % 360 + 360) % 360);
        }
        const line = (pts) => { let s = ''; for (let i = 0; i + 1 < pts.length; i += 2) { const p = g.toScreen(pts[i], pts[i + 1]); if (p) s += `${p.x.toFixed(1)},${p.y.toFixed(1)} `; } return s; };
        if (pen) { penEl.setAttribute('points', pen.pts.length > 2 ? line(pen.pts) : line([...pen.pts, pen.pts[0] + 0.0001, pen.pts[1]])); penEl.style.stroke = ui.draw.color; penEl.style.strokeWidth = `${Math.max(1, penW() * inchPx(g, pen.pts[0], pen.pts[1])).toFixed(1)}px`; }
        penEl.style.display = pen ? '' : 'none';
        const rt = routeId && m && ui.tool === 'route' && hover ? m.marks.find((x) => x.id === routeId) : null;
        const hq = rt ? snapPt(g.toMap(hover.x, hover.y), hover.free) : null;
        rubber.style.display = rt && hq ? '' : 'none'; countEl.hidden = !(rt && hq);
        // (Second Builder (second-cartographer-polish)) the measuring line: its bends, on to the pointer, and how far that is
        const mq = meas && m && hover ? snapPt(g.toMap(hover.x, hover.y), hover.free) : null;
        const mpts = meas ? (mq ? [...meas.pts, mq.x, mq.y] : meas.pts) : null;
        measEl.style.display = mpts && mpts.length >= 4 ? '' : 'none';
        if (meas && m) {
          if (mpts.length >= 4) measEl.setAttribute('points', line(mpts));
          const say = mpts.length >= 4 ? Geom.unitLabel(m.grid, Geom.routeCells(m.grid, mpts)) : 'Click where to';
          if (countEl.textContent !== say) countEl.textContent = say;
          countEl.hidden = !hover;
          if (hover) { countEl.style.left = `${(hover.x + 16).toFixed(0)}px`; countEl.style.top = `${(hover.y + 14).toFixed(0)}px`; }
        }
        if (rt && hq) {
          const last = [rt.pts[rt.pts.length - 2], rt.pts[rt.pts.length - 1]];
          rubber.setAttribute('points', line([...last, hq.x, hq.y])); rubber.style.stroke = rt.color;
          // what the next leg adds, and what the route comes to with it
          const add = Geom.routeCells(m.grid, [...last, hq.x, hq.y]); const all = Geom.routeCells(m.grid, rt.pts) + add;
          const say = add ? `+${add} · ${Geom.unitLabel(m.grid, all)}` : '';
          if (countEl.textContent !== say) countEl.textContent = say;
          countEl.hidden = !say; countEl.style.left = `${(hover.x + 16).toFixed(0)}px`; countEl.style.top = `${(hover.y + 14).toFixed(0)}px`;
        }
        // a picked route (or the one being drawn) glows; unlocked, its points are handles and its line takes new points
        const ro = m && (sel && sel.kind === 'mark' ? m.marks.find((x) => x.id === sel.id && x.kind === 'route') : routeId ? m.marks.find((x) => x.id === routeId) : null);
        rglow.style.display = ro ? '' : 'none';
        const edit = !!ro && !!sel && sel.id === ro.id && !ui.lockRoutes;
        rline.style.display = edit ? '' : 'none';
        if (ro) { const pl = line(TableAtlas.routeLine(ro.pts, ro.round !== false ? TableAtlas.routeWidth(ro, span()) * 9 : 0)); rglow.setAttribute('points', pl); if (edit) rline.setAttribute('points', pl); }
        const nh = edit ? Math.min(80, ro.pts.length / 2) : 0;
        while (rhs.length < nh) { const e = h('span', { class: 'mt-rh', 'data-tip': 'Drag: move this point (Alt: free). Right-click: take it out' }); e.dataset.i = String(rhs.length); rhs.push(e); over.append(e); }
        for (let i = 0; i < rhs.length; i++) {
          const p = i < nh ? g.toScreen(ro.pts[i * 2], ro.pts[i * 2 + 1]) : null;
          rhs[i].hidden = !p;
          if (p) { rhs[i].style.left = `${p.x.toFixed(1)}px`; rhs[i].style.top = `${p.y.toFixed(1)}px`; }
        }
        // the picked asset: its outline, a handle to size it and one to turn it
        const it = sel && sel.kind === 'asset' ? selItem() : null; const b = it ? assetBox(it.o) : null;
        giz.style.display = b ? '' : 'none'; hSize.hidden = !b; hTurn.hidden = !b;
        if (b) {
          const l = it.o; const at = (x, y) => [l.x + x * b.co - y * b.si, l.y + x * b.si + y * b.co];
          const ring = []; const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          for (let i = 0; i < 4; i++) { const p = cs[i]; const q = cs[(i + 1) % 4]; for (let k = 0; k < 6; k++) { const f = k / 6; ring.push(...at(((p[0] + (q[0] - p[0]) * f) * b.w) / 2, ((p[1] + (q[1] - p[1]) * f) * b.h) / 2)); } }
          giz.setAttribute('points', line(ring));
          const cz = g.toScreen(...at(b.w / 2, b.h / 2)); const up = 26 / Math.max(0.01, inchPx(g, l.x, l.y)); const ct = g.toScreen(...at(0, -b.h / 2 - up));
          if (cz) { hSize.style.left = `${cz.x.toFixed(1)}px`; hSize.style.top = `${cz.y.toFixed(1)}px`; } else hSize.hidden = true;
          if (ct) { hTurn.style.left = `${ct.x.toFixed(1)}px`; hTurn.style.top = `${ct.y.toFixed(1)}px`; } else hTurn.hidden = true;
        }
      }
      ed.setOnDraw(drawOver);

      // ---------- keys (the window keeps them: the battlemap's shortcuts rest while you work here) ----------
      const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const undo = (redo) => { if (mid()) cmd(redo ? 'history.redo' : 'history.undo', { mapId: mid() }); };
      const onKey = (e) => {
        if (e.key === 'F1' || e.key === 'F11' || e.key === 'F12') return;
        e.stopPropagation();
        if (isField(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) { e.preventDefault(); undo(k === 'y' || e.shiftKey); return; }
        if (e.ctrlKey || e.metaKey) return;
        if (k === 'escape') { // the round menu closes; else a route ends; else what is picked is let go; else the Move tool is back
          if (ctx.Radial && ctx.Radial.isOpen) ctx.Radial.close(); else if (meas) endMeasure(); else if (routeId) endRoute(); else if (sel) select(null); else if (ui.tool !== 'move') setTool('move');
          return;
        }
        if (k === 'enter' && meas) { endMeasure(); return; }
        if (k === 'enter' && routeId) { endRoute(); return; }
        // Second Builder (second-cartographer-polish): a letter picks a tool, M measures from the pointer
        if (!e.altKey && !e.shiftKey && M()) {
          const tk = TOOLS.find((x) => x.key && x.key.toLowerCase() === k);
          if (tk) { e.preventDefault(); if (meas) endMeasure(); if (routeId && tk.id !== 'route') endRoute(); setTool(tk.id); return; }
          if (k === 'm') { e.preventDefault(); if (meas) endMeasure(); else if (hover) startMeasure(toMap(hover), false); return; }
        }
        if (k === 'backspace' && routeId && ui.tool === 'route') { e.preventDefault(); mcmd('mark.route', { id: routeId, back: true }); return; }
        if ((k === 'delete' || k === 'backspace') && sel) { e.preventDefault(); removeSel(); }
      };

      // ---------- the strip of tools ----------
      const strip = h('div', { class: 'mt-strip', role: 'toolbar', 'aria-label': 'Map tools' });
      for (const t of TOOLS) strip.append(h('button', { class: `mt-tool${ui.tool === t.id ? ' on' : ''}${t.low && !TOOLS[TOOLS.indexOf(t) - 1].low ? ' first-low' : ''}`, dataset: { id: t.id }, 'aria-label': t.label, 'data-tip': `${t.label}${t.key ? ` (${t.key})` : ''}: ${t.tip}`, onclick: () => setTool(t.id) }, iconEl(t.icon))); // (Second Builder (second-cartographer-polish): its key in the tip)

      // ---------- the choices next to it ----------
      const opts = h('div', { class: 'mt-opts stack' });
      let optBinds = []; let optSig = null;
      function renderOpts(force) {
        if (selLost()) sel = null;
        const it = selItem();
        const sig = JSON.stringify([ui.tool, sel, !!it, mid(), routeId && ui.tool === 'route' ? routeId : null]);
        if (sig === optSig && !force) return;
        optSig = sig; optBinds = [];
        const t = TOOLS.find((x) => x.id === ui.tool) || TOOLS[0];
        ctx.withBinds(optBinds, () => {
          const body = !M() && ui.tool !== 'maps' ? [] : it ? editorOf(it) : toolOpts(ui.tool); // (Second Builder (second-cartographer-polish): the window says it once, E2)
          opts.replaceChildren(h('div', { class: 'mt-opts-head' }, iconEl(it ? iconOfItem(it) : t.icon), h('b', { class: 'ellipsis' }, it ? nameOfItem(it) : t.label)), ...body.filter(Boolean));
        });
        if (focusTitle && it) { focusTitle = false; const f = opts.querySelector('input.mt-title'); if (f) requestAnimationFrame(() => { f.focus(); f.select(); }); }
      }
      const iconOfItem = (it) => (it.sel.kind === 'asset' ? 'trees' : it.sel.kind === 'text' ? 'typography' : it.sel.kind === 'token' ? 'user' : it.o.kind === 'route' ? 'route' : 'map-pin');
      const nameOfItem = (it) => (it.sel.kind === 'asset' ? it.o.name || 'Asset' : it.sel.kind === 'text' ? 'Label' : it.sel.kind === 'token' ? it.o.name || 'Token' : it.o.kind === 'place' ? 'Place' : it.o.kind === 'route' ? 'Route' : it.o.kind === 'counter' ? 'Counter' : 'Marker');
      const pc = (v) => (v < 0.01 ? 'Off' : `${Math.round(v * 100)}%`);

      function toolOpts(t) {
        if (t === 'maps') return mapsOpts();
        if (t === 'move') return [c().btn('Show the whole map', 'maximize', () => { cams[mid()] = fitCam(); if (ui.mode !== 'flat') { ui.mode = 'flat'; save(); } syncEd(); }, { kind: 'wide', tip: 'The whole map in this window, flat' }),
          c().btn('Fit the TV to the map', 'device-tv', fitTv, { kind: 'wide', tip: 'The TV shows as much of the map as fits without showing past its edge' }), placesList()];
        if (t === 'place') return placeChoices(() => ui.place, (patch) => { Object.assign(ui.place, patch); save(); });
        if (t === 'route') {
          const now = h('div', { class: 'stack' });
          c().bind(() => {
            const r = routeId && M() ? M().marks.find((x) => x.id === routeId) : null; const lab = r ? Geom.routeLabel(M().grid, r) || `${r.pts.length / 2} point${r.pts.length === 2 ? '' : 's'}` : '';
            if (now.dataset.sig === `${routeId}|${lab}`) return;
            now.dataset.sig = `${routeId}|${lab}`; now.replaceChildren();
            if (r) now.append(h('output', { class: 'mt-say' }, lab), c().row(c().btn('Back', 'arrow-back-up', () => mcmd('mark.route', { id: r.id, back: true }), { tip: 'Take the last point back (Backspace)' }), c().btn('Done', 'check', endRoute, { kind: 'primary', tip: 'End this route (a right-click, Enter, or a double click)' })));
          });
          return [...routeChoices(() => ui.route, (patch) => { Object.assign(ui.route, patch); save(); }), now];
        }
        if (t === 'draw') return [swatches('Colour', () => ui.draw.color, (v) => { ui.draw.color = v; save(); }),
          c().slider({ label: 'Width', min: 1, max: 14, step: 0.5, get: () => ui.draw.w, set: (v) => { ui.draw.w = v; save(); }, fmt: (v) => String(v) })];
        if (t === 'write') return [swatches('Colour', () => ui.write.color, (v) => { ui.write.color = v; save(); }),
          c().slider({ label: 'Size', min: 1, max: 12, step: 0.5, get: () => ui.write.size, set: (v) => { ui.write.size = v; save(); }, fmt: (v) => String(v) })];
        if (t === 'erase') return [c().btn('Rub out everything', 'trash', async () => { const mapId = mid(); const r = await mcmd('draw.clear', {}); if (r && r.ok) toast('Drawings and labels rubbed out', { undo: () => cmd('history.undo', { mapId }) }); }, { kind: 'wide', tip: 'All drawings and labels of this map' })]; // (Second Builder (second-cartographer-polish): with an Undo)
        if (t === 'assets') return [c().btn('Add from the library', 'plus', () => ctx.Drawer.open({ cat: 'assets', purpose: 'atlasAsset' }), { kind: 'wide primary', tip: 'A picture or an animation that lies on the map' })];
        if (t === 'grid') return gridOpts();
        if (t === 'view') return viewOpts();
        // the battlemap's weather, for this map (gm-play.js builds it), and sunshine, which only world maps have
        return [...ctx.weatherPanel({ map: M, cmd: mcmd, send: msend, refresh: () => renderOpts(true), key: 'wxOpenAtlas', plain: true }), c().sep(),
          c().slider({ label: 'Sunshine', min: 0, max: 1, step: 0.05, get: () => ((M() && M().atlas && M().atlas.weather) || {}).sun || 0, set: (v, key) => msend(key, 'atlasmap.set', { weather: { sun: v } }), fmt: pc })];
      }
      // Second Builder (second-cartographer-polish): the places and routes of this map, to find one on a big map. A click
      // shows it in the middle of this window and picks it; the TV button moves the TV's frame there.
      let findText = '';
      function placesList() {
        const list = h('div', { class: 'mt-places' });
        const find = h('input', { type: 'search', class: 'mt-find', placeholder: 'Find a place', 'aria-label': 'Find a place', spellcheck: 'false', value: findText });
        find.addEventListener('input', () => { findText = find.value; list.dataset.sig = ''; paint(); });
        const box = h('div', { class: 'ctl mt-places-box' }, h('span', { class: 'ctl-label' }, 'On this map'), find, list);
        const centre = (o) => { const at = o.kind === 'route' ? TableAtlas.routeAlong(o.pts, 0.5) : o; const cm = { ...winCam(), cx: at.x, cy: at.y }; cams[mid()] = cm; if (ui.mode !== 'flat') { ui.mode = 'flat'; save(); } syncEd(); };
        function paint() {
          const m = M(); const all = m ? m.marks.filter((x) => x.kind === 'place' || (x.kind === 'route' && x.pts && x.pts.length >= 4)) : [];
          const q = findText.trim().toLowerCase();
          const rows = all.filter((x) => !q || `${x.title || ''} ${x.sub || ''}`.toLowerCase().includes(q))
            .sort((a, b) => (a.kind === b.kind ? String(a.title || '').localeCompare(String(b.title || '')) : a.kind === 'place' ? -1 : 1));
          const sig = JSON.stringify([rows.map((x) => [x.id, x.title, x.icon, x.hidden, x.to]), all.length]);
          if (list.dataset.sig === sig) return;
          list.dataset.sig = sig; list.replaceChildren();
          find.hidden = all.length < 7 && !q;
          box.hidden = !all.length;
          for (const o of rows) {
            const ic = o.kind === 'route' ? 'route' : (TableAtlas.ICONS[o.icon] || TableAtlas.ICONS.flag)[1];
            const name = o.title || (o.kind === 'route' ? 'Route' : 'Place');
            list.append(h('div', { class: `mt-prow${o.hidden ? ' is-hidden' : ''}`, dataset: { id: o.id } },
              h('button', { class: 'mt-pgo', 'data-tip': `Show ${name} here and pick it`, onclick: () => { centre(o); if (ui.tool !== 'move') setTool('move'); select({ kind: 'mark', id: o.id }); } },
                iconEl(ic), h('span', { class: 'ellipsis' }, name), o.hidden ? iconEl('eye-off') : null, o.to ? iconEl('door-enter') : null),
              c().ib('device-tv', `The TV looks at ${name}`, () => { const at = o.kind === 'route' ? TableAtlas.routeAlong(o.pts, 0.5) : o; mcmd('view.update', viewOfCam({ ...camOfView(viewNow()), cx: at.x, cy: at.y })); })));
          }
          if (!rows.length && q) list.append(h('p', { class: 'hint' }, 'Nothing by that name.'));
        }
        c().bind(paint);
        return box;
      }
      function fitTv() { const R = mapRect(); const t = tIn(); const cm = { cx: R.x + R.w / 2, cy: R.y + R.h / 2, S: Math.min(R.h / 2, R.w / 2 / (t.w / t.h)) }; mcmd('view.update', viewOfCam(cm)); }

      // -- Maps: the atlas
      function rowMenu(e, m) {
        const r = e.currentTarget.getBoundingClientRect(); const a = A();
        openMenu(r.left, r.bottom + 6, [
          { icon: 'pencil', label: 'Rename', action: async () => { const n = await askText('Name the map', m.name, { ok: 'Save' }); if (n) cmd('map.rename', { id: m.id, name: n }); } },
          ...(a.world === m.id ? [] : [{ icon: 'world', label: 'Make it the world map', action: () => cmd('atlas.world', { id: m.id }) }]),
          { sep: true },
          { icon: 'trash', label: 'Take it out of the atlas', danger: true, action: async () => undoToast(await cmd('atlas.remove', { id: m.id })) },
        ]);
      }
      function mapsOpts() {
        const list = h('div', { class: 'atl-list' });
        c().bind(() => {
          const a = A(); const sig = JSON.stringify([a.maps, a.world, a.on, a.edit]);
          if (list.dataset.sig === sig) return;
          list.dataset.sig = sig; list.replaceChildren();
          if (!a.maps.length) { list.append(h('p', { class: 'hint atl-empty' }, 'No world map yet.')); return; }
          for (const m of a.maps) {
            const onTv = a.on === m.id; const world = a.world === m.id;
            const sub = [world ? 'World map' : 'Regional map', m.places ? `${m.places} place${m.places === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
            list.append(h('div', { class: `atl-row${a.edit === m.id ? ' on' : ''}${onTv ? ' live' : ''}`, dataset: { id: m.id } },
              h('button', { class: 'atl-open', 'data-tip': `Work on ${m.name}`, onclick: () => { sel = null; routeId = null; cmd('atlas.open', { id: m.id }); } },
                h('span', { class: 'atl-thumb' }, m.missing || !m.bgPath ? iconEl(m.missing ? 'alert-triangle' : world ? 'world' : 'map-2') : Thumbs.img(m.bgPath, m.bgKind || 'image')),
                h('span', { class: 'atl-name' }, h('b', { class: 'ellipsis' }, m.name), h('small', {}, sub))),
              c().ib('cast', onTv ? 'On the table. Click to take it off' : 'Show it on the table', () => cmd(onTv ? 'atlas.hide' : 'atlas.show', { id: m.id }), { on: onTv }),
              h('button', { class: 'icon-btn', 'aria-label': `More for ${m.name}`, onclick: (e) => rowMenu(e, m) }, iconEl('dots'))));
          }
        });
        return [list, c().btn('Add a map', 'plus', () => ctx.Drawer.open({ filter: 'maps', purpose: 'atlasMap' }), { kind: 'wide', tip: 'A picture from the library becomes a world or regional map' })];
      }

      // -- a place's marker, icon and colour (for the next place, or the picked one)
      function placeChoices(get, set) {
        const icons = h('div', { class: 'mt-icons', role: 'radiogroup', 'aria-label': 'Icon' });
        for (const [id, [name, ic]] of Object.entries(TableAtlas.ICONS)) icons.append(h('button', { class: 'mt-icon', dataset: { v: id }, 'aria-label': name, 'data-tip': name, onclick: () => set({ icon: id }) }, iconEl(ic)));
        c().bind(() => { const v = get().icon; for (const b of icons.children) b.classList.toggle('on', b.dataset.v === v); });
        return [c().seg({ label: 'Marker', cls: 'seg-3', options: Object.entries(TableAtlas.STYLES).map(([value, label]) => ({ value, label })), get: () => get().style, set: (v) => set({ style: v }) }),
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Icon'), icons),
          swatches('Colour', () => get().color, (v, live) => set({ color: v }, live))];
      }

      // -- how a route is drawn (the next one, or the picked one)
      function routeChoices(get, set) {
        return [swatches('Colour', () => get().color, (v, live) => set({ color: v }, live)),
          c().seg({ label: 'Line', cls: 'seg-3', options: [{ value: 'dash', label: 'Dashed' }, { value: 'dots', label: 'Dotted' }, { value: 'solid', label: 'Solid' }], get: () => get().look || 'dash', set: (v) => set({ look: v }) }),
          c().seg({ label: 'Width', cls: 'seg-3', options: [{ value: 1, label: 'Thin' }, { value: 2, label: 'Medium' }, { value: 3, label: 'Bold' }], get: () => get().width || 2, set: (v) => set({ width: v }) }),
          c().toggle({ label: 'Arrow at the end', get: () => get().arrow !== false, set: (v) => set({ arrow: v }) }),
          c().toggle({ label: 'Rounded bends', get: () => get().round !== false, set: (v) => set({ round: v }) })];
      }

      // -- what is picked
      function editorOf(it) {
        const id = it.o.id; const type = it.type;
        const cur = () => { const x = itemOf(id); return x ? x.o : it.o; };
        const upd = (patch, key) => (key ? msend(key, type, { id, ...patch }) : mcmd(type, { id, ...patch }));
        const hide = c().ib('eye-off', 'Hidden from the players', () => upd({ hidden: !cur().hidden }));
        c().bind(() => { const on = !!cur().hidden; hide.classList.toggle('on', on); hide.dataset.tip = on ? 'Hidden from the players. Click to show it' : 'Hide it from the players'; });
        const foot = h('div', { class: 'mt-foot' }, hide, h('span', { class: 'grow' }), c().btn('Remove', 'trash', removeSel, { kind: 'small', tip: 'Remove it (Delete)' }));
        const text = (cls, key, ph, max) => { const el = h('input', { type: 'text', class: cls, maxlength: String(max), spellcheck: 'false', placeholder: ph, 'aria-label': ph }); el.addEventListener('input', () => upd({ [key]: el.value }, `atl-${key}-${id}`)); c().bind(() => { if (document.activeElement !== el) el.value = cur()[key] || ''; }); return el; };
        if (it.sel.kind === 'asset') return assetEditor(cur, upd, foot);
        if (it.sel.kind === 'text') return [field('Text', text('', 'text', 'Text', 200)),
          swatches('Colour', () => cur().color, (v, live) => upd({ color: v }, live ? `atl-col-${id}` : null)),
          c().slider({ label: 'Size', min: 1, max: 12, step: 0.25, get: () => (cur().size / span()) * 100, set: (v, key) => upd({ size: r3((v / 100) * span()) }, key), fmt: (v) => String(Math.round(v * 10) / 10) }), foot];
        if (it.sel.kind === 'token') return [foot];
        const m = it.o;
        if (m.kind === 'place') {
          const a = () => A();
          const lead = h('button', { class: 'btn wide mt-pick' }, iconEl('map-2'), h('span', { class: 'ellipsis' }));
          lead.onclick = (e) => { const others = a().maps.filter((x) => x.id !== mid()); const r = e.currentTarget.getBoundingClientRect(); const to = cur().to;
            openMenu(r.left, r.bottom + 6, [...others.map((x) => ({ icon: x.id === to ? 'check' : 'map-2', checked: x.id === to, label: x.name, action: () => upd({ to: x.id }) })),
              ...(others.length ? [] : [{ icon: 'info-circle', label: 'No other map in the atlas yet', disabled: true }]),
              ...(to ? [{ sep: true }, { icon: 'x', label: 'Leads nowhere', action: () => upd({ to: null }) }] : [])]); };
          const ho = h('button', { class: 'btn wide mt-pick' }, iconEl('script'), h('span', { class: 'ellipsis' }));
          ho.onclick = async (e) => { const r = e.currentTarget.getBoundingClientRect(); const now = cur().ho; let list = []; try { list = (await ts.library('list')).filter((x) => x.cat === 'handouts'); } catch {}
            openMenu(r.left, r.bottom + 6, [...list.slice(0, 60).map((x) => ({ icon: now && now.path === x.path ? 'check' : 'script', checked: !!(now && now.path === x.path), label: x.name, action: () => upd({ ho: { path: x.path, name: x.name } }) })),
              ...(list.length ? [] : [{ icon: 'info-circle', label: 'No handouts in the library yet', disabled: true }]),
              ...(now ? [{ sep: true }, { icon: 'x', label: 'No handout', action: () => upd({ ho: null }) }] : [])]); };
          const note = h('textarea', { class: 'mt-note', rows: '3', maxlength: '600', placeholder: 'A note the table can read', 'aria-label': 'Note' });
          note.addEventListener('change', () => upd({ note: note.value }));
          const acts = h('div', { class: 'ctl-row mt-acts' });
          c().bind(() => {
            const k = cur(); const dest = k.to ? a().maps.find((x) => x.id === k.to) : null;
            lead.lastChild.textContent = dest ? dest.name : 'Nowhere'; ho.lastChild.textContent = k.ho ? k.ho.name : 'None';
            if (document.activeElement !== note) note.value = k.note || '';
            const onTv = a().on === mid(); const sig = JSON.stringify([dest && dest.name, !!k.note, onTv, a().note === id, k.ho && k.ho.path]);
            if (acts.dataset.sig === sig) return;
            acts.dataset.sig = sig; acts.replaceChildren(); acts.hidden = !(dest || k.note || k.ho);
            if (dest) acts.append(c().btn(`Open ${dest.name}`, 'door-enter', () => openRegion(cur()), { kind: 'small primary', tip: 'On the TV the camera dives into this place and the map behind it opens' }));
            if (k.note) acts.append(c().ib('message', onTv ? (a().note === id ? 'Its note is on the TV. Click to put it away' : 'Show its note on the TV') : 'Its note shows once this map is on the TV', () => cmd('atlas.note', { id }), { on: a().note === id }));
            if (k.ho) acts.append(c().ib('cast', 'Show its handout on the table', () => cmd('handout.show', { path: k.ho.path, add: true })));
          });
          // (Second Builder (second-cartographer-polish): what matters at the table first; how it looks folded under Look)
          const look = h('details', { class: 'opt-adv mt-look', open: ui.lookOpen || undefined }, h('summary', {}, 'Look'),
            h('div', { class: 'stack' }, ...placeChoices(cur, (patch, live) => { Object.assign(ui.place, patch); save(); upd(patch, live ? `atl-col-${id}` : null); })));
          look.addEventListener('toggle', () => { ui.lookOpen = look.open; save(); });
          return [text('mt-title', 'title', 'Name', 60), text('', 'sub', 'A line under the name', 80),
            field('Leads to', lead), note, field('Handout', ho), acts, look, foot];
        }
        if (m.kind === 'route') {
          const say = h('output', { class: 'mt-say' });
          c().bind(() => { say.textContent = Geom.routeLabel(M().grid, cur()) || ''; });
          return [text('mt-title', 'title', 'Name', 60), say,
            ...routeChoices(cur, (patch, live) => { Object.assign(ui.route, patch); save(); upd(patch, live ? `atl-col-${id}` : null); }),
            c().slider({ label: 'Travelled', min: 0, max: 1, step: 0.01, get: () => cur().walked || 0, set: (v, key) => upd({ walked: v }, key), fmt: (v) => (v < 0.005 ? 'Off' : `${Math.round(v * 100)}%`) }),
            dayRow(cur, upd),
            plateRow(cur, upd),
            c().row(c().btn('Draw on', 'route', () => { routeId = id; sel = null; setTool('route'); }, { tip: 'Every click adds a point' }), c().btn('Back', 'arrow-back-up', () => mcmd('mark.route', { id, back: true }), { tip: 'Take the last point back' })), foot];
        }
        return [swatches('Colour', () => cur().color, (v, live) => upd({ color: v }, live ? `atl-col-${id}` : null)), foot];
      }
      // Second Builder (second-cartographer-polish): the party walks on one cell (one day of travel, in what one cell
      // stands for) at a time: Travelled moves by one cell of the route's length
      function dayRow(cur, upd) {
        const g = () => (M() && M().grid) || {};
        const total = () => Math.max(1, Geom.routeCells(g(), cur().pts || []));
        const now = () => Math.round((cur().walked || 0) * total());
        const say = h('output', { class: 'mt-say mt-days' });
        const step = (d) => upd({ walked: r3(clamp((now() + d) / total(), 0, 1)) });
        const back = c().ib('minus', 'One back', () => step(-1)); const on = c().ib('plus', 'One on', () => step(1));
        c().bind(() => {
          const n = now(); const all = total(); const one = Geom.unitLabel(g(), 1);
          say.textContent = `${n} of ${Geom.unitLabel(g(), all)}`;
          back.dataset.tip = `Back by ${one}`; on.dataset.tip = `On by ${one}`; back.disabled = n <= 0; on.disabled = n >= all;
        });
        return h('div', { class: 'ctl-row mt-dayrow' }, back, say, on);
      }
      // where its name plate stands: dragged along the road, or by itself
      function plateRow(cur, upd) {
        const row = h('div', { class: 'mt-plate-row' });
        c().bind(() => {
          const set = typeof cur().labelAt === 'number';
          if (row.dataset.on === String(set)) return;
          row.dataset.on = String(set); row.replaceChildren();
          if (set) row.append(c().btn('Name plate back by itself', 'refresh', () => upd({ labelAt: null }), { kind: 'small wide', tip: 'It finds a spot along the road where it covers no place' }));
        });
        return row;
      }
      function assetEditor(cur, upd, foot) {
        const id = cur().id;
        return [
          c().slider({ label: 'Size', min: 0.5, max: 100, step: 0.5, get: () => (cur().w / span()) * 100, set: (v, key) => upd({ w: r3((v / 100) * span()) }, key), fmt: (v) => `${Math.round(v * 10) / 10}%` }),
          c().slider({ label: 'Height', min: 0.25, max: 4, step: 0.05, get: () => cur().stretch || 1, set: (v, key) => upd({ stretch: v }, key), fmt: (v) => `${Math.round(v * 100)}%` }),
          c().slider({ label: 'Turn', min: -180, max: 180, step: 1, get: () => cur().rotation || 0, set: (v, key) => upd({ rotation: v }, key), fmt: (v) => `${Math.round(v)}°` }),
          c().slider({ label: 'Hue', min: 0, max: 360, step: 5, get: () => cur().hue || 0, set: (v, key) => upd({ hue: v }, key), fmt: (v) => (v ? `${Math.round(v)}°` : 'Off') }),
          c().slider({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, get: () => cur().opacity ?? 1, set: (v, key) => upd({ opacity: v }, key), fmt: (v) => `${Math.round(v * 100)}%` }),
          c().toggle({ label: 'Mirrored', get: () => cur().flip, set: (v) => upd({ flip: v }) }),
          c().toggle({ label: 'Shadow', get: () => cur().shadow, set: (v) => upd({ shadow: v }) }),
          c().row(c().btn('To the front', 'stack-front', () => mcmd('layer.order', { id, to: 'front' }), { tip: 'Over the other assets' }), c().btn('Copy', 'copy', async () => { const r = await mcmd('layer.duplicate', { id, dx: cur().w * 0.3, dy: cur().w * 0.3 }); if (r && r.selected) select({ kind: 'asset', id: r.selected }); }, { tip: 'One more of it' })),
          foot];
      }

      // -- Grid
      function gridOpts() {
        const g = () => (M() ? M().grid : {});
        const SW = ['#ffffff', '#000000', '#e3963e', '#7fd0ff'];
        const sw = h('div', { class: 'swatches' }, ...SW.map((col) => h('button', { class: 'swatch', style: `background:${col}`, dataset: { v: col }, 'aria-label': `Grid colour ${col}`, onclick: () => mcmd('grid.update', { color: col }) })),
          h('input', { type: 'color', 'aria-label': 'Any grid colour', oninput: (e) => msend('atl-grid-color', 'grid.update', { color: e.target.value }) }));
        c().bind(() => { for (const b of sw.querySelectorAll('.swatch')) b.classList.toggle('on', b.dataset.v === g().color); });
        const nIn = h('input', { type: 'number', class: 'atl-n', min: '0.01', step: 'any', 'aria-label': 'How many', placeholder: '1' });
        const nameIn = h('input', { type: 'text', class: 'atl-unit', maxlength: '30', spellcheck: 'false', 'aria-label': 'One grid cell stands for', placeholder: 'day of travel' });
        const say = h('output', { class: 'mt-say' });
        const setUnit = () => { const name = nameIn.value.trim(); mcmd('grid.update', { unit: name ? { n: Number(nIn.value) || 1, name } : null, coalesce: 'atlas-unit' }); };
        nIn.addEventListener('change', setUnit); nameIn.addEventListener('change', setUnit);
        c().bind(() => { const u = g().unit || null; if (document.activeElement !== nIn) nIn.value = u ? String(u.n) : ''; if (document.activeElement !== nameIn) nameIn.value = u ? u.name : ''; say.textContent = u ? `17 cells: ${Geom.unitLabel(g(), 17)}` : ''; });
        const frac = (k) => c().slider({ label: k === 'ox' ? 'Shift sideways' : 'Shift up / down', min: 0, max: 1, step: 0.01, get: () => (((g()[k] || 0) / (g().size || 1)) % 1 + 1) % 1, set: (v, key) => msend(key, 'grid.update', { [k]: r3(v * (g().size || 1)) }), fmt: (v) => `${Math.round(v * 100)}%` });
        return [c().toggle({ label: 'Show the grid', get: () => g().show, set: (v) => mcmd('grid.update', { show: v }) }),
          c().seg({ options: [{ value: 'square', label: 'Squares', icon: 'square' }, { value: 'hex-pointy', label: 'Hex rows', icon: 'hexagon', tip: 'Hexes with a point at the top' }, { value: 'hex-flat', label: 'Hex columns', icon: 'hexagon', iconCls: 'rot90', tip: 'Hexes with a flat top' }], get: () => g().type, set: (v) => mcmd('grid.update', { type: v }) }),
          c().slider({ label: 'Cells across the map', min: 4, max: 120, step: 1, get: () => clamp(mapRect().w / (g().size || 1), 4, 120), set: (v, key) => msend(key, 'grid.update', { size: r3(mapRect().w / v) }), fmt: (v) => String(Math.round(v)) }),
          frac('ox'), frac('oy'),
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Colour'), sw),
          c().slider({ label: 'Opacity', min: 0, max: 1, step: 0.01, get: () => g().opacity, set: (v, key) => msend(key, 'grid.update', { opacity: v }), fmt: (v) => `${Math.round(v * 100)}%` }),
          c().sep(),
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'One cell is'), h('div', { class: 'atl-unit-row' }, nIn, nameIn), say)];
      }

      // -- On the TV: how it lies there (for the whole atlas), and the mist at this map's edges
      function viewOpts() {
        const L = () => A().look || {}; const air = () => (M() && M().atlas) || {};
        const sl = (label, k) => c().slider({ label, min: 0, max: 1, step: 0.05, get: () => L()[k] ?? 0.5, set: (v, key) => ctx.send(key, 'atlas.look', { look: { [k]: v } }), fmt: pc });
        return [sl('Tilt', 'tilt'), sl('Bulge', 'bulge'), sl('Blur', 'blur'),
          c().seg({ label: 'Faces', cls: 'seg-4', options: FACES.map((f) => ({ value: f.value, icon: f.icon, label: '', tip: f.tip })), get: () => L().turn || 0, set: (v) => cmd('atlas.look', { look: { turn: v } }) }),
          c().sep(),
          c().seg({ label: 'Mist', cls: 'seg-2', options: [{ value: 'cloud', label: 'Cloud', icon: 'cloud', tip: 'White cloud hides where the map ends' }, { value: 'dark', label: 'Dark mist', icon: 'mist', tip: 'Dark mist hides where the map ends' }], get: () => air().mist || 'cloud', set: (v) => mcmd('atlasmap.set', { mist: v }) }),
          c().slider({ label: 'Reach', min: 0, max: 1, step: 0.05, get: () => air().reach ?? 0.5, set: (v, key) => msend(key, 'atlasmap.set', { reach: v }), fmt: pc }),
          c().slider({ label: 'Screen edge', min: 0, max: 1, step: 0.05, get: () => air().rim ?? 0.3, set: (v, key) => msend(key, 'atlasmap.set', { rim: v }), fmt: pc }),
          c().sep(),
          c().btn('Fit the TV to the map', 'device-tv', fitTv, { kind: 'wide', tip: 'The TV shows as much of the map as fits without showing past its edge' })];
      }

      // ---------- the bar under the picture ----------
      const modeSeg = c().seg({ cls: 'seg-2 mt-mode', options: [{ value: 'flat', label: 'Flat', icon: 'map-2', tip: 'The whole map, flat, with the TV\'s frame on it' }, { value: 'tv', label: 'As on the TV', icon: 'device-tv', tip: 'The way the players see it' }],
        get: () => ui.mode, set: (v) => { ui.mode = v; save(); syncEd(); } });
      const undoB = c().ib('arrow-back-up', 'Undo (Ctrl + Z)', () => undo(false)); const redoB = c().ib('arrow-forward-up', 'Redo (Ctrl + Y)', () => undo(true));
      const name = h('b', { class: 'mt-name ellipsis' });
      const tvBtn = h('button', { class: 'btn small' });
      tvBtn.onclick = () => { const a = A(); if (!mid()) return; cmd(a.on === mid() ? 'atlas.hide' : 'atlas.show', { id: mid() }); };
      const bar = h('div', { class: 'mt-bar' }, modeSeg, undoB, redoB, name, h('span', { class: 'grow' }), tvBtn);
      const grip = h('span', { class: 'hot-grip mt-grip', 'data-tip': 'Drag to make the window bigger or smaller' }, iconEl('arrows-diagonal'));
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX; const y0 = e.clientY; const w0 = ui.w; const h0 = ui.h;
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => { ui.w = w0 + ev.clientX - x0; ui.h = h0 + ev.clientY - y0; syncEd(); };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); save(); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      });

      // ---------- it follows the state ----------
      c().bind(() => {
        const m = M(); const a = A();
        if (tvView && !tvBusy && (!m || (Math.abs(m.view.x - tvView.x) < 0.002 && Math.abs(m.view.y - tvView.y) < 0.002 && Math.abs(m.view.zoom - tvView.zoom) < 1e-4) || Date.now() - tvAt > 1500)) tvView = null;
        if (selLost()) sel = null;
        if (routeId && !(m && m.marks.some((x) => x.id === routeId))) routeId = null;
        syncEd(); renderOpts();
        ctx.withBinds(optBinds, () => { for (const f of [...optBinds]) f(); });
        const h0 = a.history || {};
        undoB.disabled = !h0.canUndo; redoB.disabled = !h0.canRedo;
        const row = m ? a.maps.find((x) => x.id === m.id) : null;
        name.textContent = row ? row.name : '';
        const onTv = !!m && a.on === m.id;
        tvBtn.hidden = !m; tvBtn.className = `btn small ${onTv ? '' : 'primary'}`;
        tvBtn.replaceChildren(iconEl(onTv ? 'player-stop' : 'cast'), onTv ? 'Take off the TV' : 'Show on the TV');
        tvBtn.dataset.tip = onTv ? 'The battlemap is there again as it was' : 'It goes onto the TV, over the battlemap';
        bar.classList.toggle('live', onTv);
        zoomOutB.hidden = !m || !parentOf(m.id) || m.id === a.world;
        top.hidden = !m;
      });

      const root = h('div', { class: 'mt' }, strip, opts, h('div', { class: 'mt-main' }, stage, bar), grip);
      root.addEventListener('keydown', onKey);
      // UI audit VB5: the window takes the keyboard as it opens (until a click inside it, T, R, D and E went to the
      // battlemap behind it, and T sent the map being edited to the TV)
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (root.isConnected && (!a || a === document.body || a.tagName === 'BUTTON' || (a.getAttribute && a.getAttribute('role') === 'button'))) stage.focus({ preventScroll: true });
      });
      win = {
        root, ed,
        close() { if (win === this) win = null; try { ed.destroy(); } catch {} },
        // an asset from the library: into the middle of what the window shows
        async addAsset(it, at) {
          if (!M()) return;
          const cm = camNow(); const r = await mcmd('layer.add', { role: 'asset', path: it.path, x: r3(at ? at.x : cm.cx), y: r3(at ? at.y : cm.cy), w: r3(span() * 0.12) });
          setTool('assets'); if (r && r.selected) select({ kind: 'asset', id: r.selected });
        },
        // (for the self-test)
        debug: () => ({ tool: ui.tool, mode: ui.mode, sel, routeId, map: mid(), ed: ed.debug(), size: dims(), locks: [ui.lockMarks, ui.lockRoutes] }),
        setTool, setMode: (v) => { ui.mode = v === 'tv' ? 'tv' : 'flat'; save(); syncEd(); }, select,
        screen: (x, y) => { const p = G().toScreen(x, y); const r = wrap.getBoundingClientRect(); return p ? { x: r.left + p.x, y: r.top + p.y } : null; },
      };
      return root;
    }

    return {
      def,
      isOpen: () => !!win,
      closed() { if (win) win.close(); }, // (gm-play.js: the window was closed)
      addAsset: (it, at) => (win ? win.addAsset(it, at) : null),
      get win() { return win; },
    };
  }
  return { create };
})();
