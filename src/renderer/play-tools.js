// Play tools on the GM screen:
//   Tokens  drop NPCs with a click: numbered copies, 5e sizes, hidden if you like
//   Point   ping, laser pointer, spotlight, ruler
//   Draw    chalk (fades), pen (stays with the map), text labels, eraser
//   Mark    pins, crosses, numbered markers, counters, notes only the GM sees
//   Timer   countdowns on the TV, normal or dramatic
//   and the round counter ("Next round" moves spell areas and counters along).
// gm-play.js owns the canvas input; it hands the pointer to these tools and asks them for popovers and cards.
'use strict';

const PlayTools = (() => {
  const { h, iconEl, toast, openMenu, askText, Thumbs, clamp, round } = UI;
  const ts = window.ts;

  const SIZES = [
    { id: 'tiny', label: 'Tiny', short: 'T', cells: 0.5 },
    { id: 'small', label: 'Small', short: 'S', cells: 1 },
    { id: 'medium', label: 'Medium', short: 'M', cells: 1 },
    { id: 'large', label: 'Large', short: 'L', cells: 2 },
    { id: 'huge', label: 'Huge', short: 'H', cells: 3 },
    { id: 'garg', label: 'Gargantuan', short: 'G', cells: 4 },
  ];
  const sizeName = (cells) => ({ 0.5: 'Tiny', 1: 'Medium', 2: 'Large', 3: 'Huge', 4: 'Gargantuan' }[cells] || `${cells} cells`);
  const sizeShort = (cells) => ({ 0.5: 'T', 1: 'M', 2: 'L', 3: 'H', 4: 'G' }[cells] || String(cells)); // 4.10: the compact toolbar
  const INK = [
    { hex: '#ffffff', label: 'White chalk' }, { hex: '#e3963e', label: 'Torch' }, { hex: '#e4675e', label: 'Red' },
    { hex: '#f2d14b', label: 'Yellow' }, { hex: '#5cc382', label: 'Green' }, { hex: '#6fb4ff', label: 'Blue' },
    { hex: '#b98cff', label: 'Violet' }, { hex: '#17181c', label: 'Black' },
  ];
  const WIDTHS = [{ id: 'thin', in: 0.05, label: 'Thin' }, { id: 'mid', in: 0.1, label: 'Medium' }, { id: 'thick', in: 0.22, label: 'Thick' }];
  const TEXT_SIZES = [{ id: 's', in: 0.32, label: 'Small' }, { id: 'm', in: 0.5, label: 'Medium' }, { id: 'l', in: 0.85, label: 'Large' }];
  const TIMES = [10, 30, 60, 120, 300, 600];
  const POINT_MODES = ['ping', 'laser', 'spot', 'measure'];
  const DRAW_MODES = ['chalk', 'pen', 'text', 'erase'];

  function create(ctx) {
    const { ui, cmd, send, undoable } = ctx;
    const S = () => ctx.state();
    const view = () => ctx.view();
    const map = () => (S() ? S().map : null);
    const grid = () => map().grid;
    const zoom = () => map().view.zoom;
    const c = () => ctx.ctl;
    const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // ---------- preferences (remembered between sessions) ----------
    const prefs = {
      tok: { brush: null, size: 'medium', hidden: false, number: true, tag: 'off', recent: [] },
      point: { mode: 'ping', spotR: 7, spotDim: 0.85, rule: 'phb', ring: true, share: true },
      draw: { mode: 'chalk', color: '#ffffff', width: 'mid', textSize: 'm' },
      mark: { mode: 'marker', shape: 'pin', color: '#e3963e', label: 'Counter', value: 3, auto: null },
      timer: { mode: 'dramatic', seconds: 30, label: '', sound: true, side: 'right' },
    };
    try {
      const p = JSON.parse(localStorage.getItem('playPrefs') || 'null');
      if (p) for (const k of Object.keys(prefs)) if (p[k]) Object.assign(prefs[k], p[k]);
      // 2.2: notes have their own tool (Build → Notes); a new counter only moves on Next round when ticked
      if (prefs.mark.mode === 'note') prefs.mark.mode = 'marker';
      if (localStorage.getItem('markAuto22') !== '1') { prefs.mark.auto = null; localStorage.setItem('markAuto22', '1'); }
      // Prototype 30: new tokens come without a name tag (a choice remembered from Beta 4.7 kept showing names); Options → Tokens → New tokens still sets it
      if (localStorage.getItem('tokTagOff30') !== '1') { prefs.tok.tag = 'off'; localStorage.setItem('tokTagOff30', '1'); }
    } catch {}
    Object.assign(ui, prefs, { selMark: null });
    // 4.10: Options → Tokens
    const tokSet = () => { const st = S(); return (st && st.settings && st.settings.tokens) || { pic: Geom.PIC_DEFAULT, snap: true }; };
    const snapOn = () => tokSet().snap !== false;
    const save = () => { try { localStorage.setItem('playPrefs', JSON.stringify(Object.fromEntries(Object.keys(prefs).map((k) => [k, ui[k]])))); } catch {} };

    const markOf = (id) => (map() && id ? map().marks.find((m) => m.id === id) || map().draw.find((d) => d.id === id && d.kind === 'text') || null : null);
    const isText = (m) => m && m.kind === 'text';
    function selectMark(id) {
      ui.selMark = id;
      view().setSelectedMark(id);
      ctx.placeCard();
    }
    const swatchRow = (get, set, list = INK) => {
      const wrap = h('div', { class: 'swatches color-row' });
      for (const col of list) wrap.append(h('button', { class: 'swatch', style: `background:${col.hex}`, dataset: { v: col.hex }, 'aria-label': col.label, 'data-tip': col.label, onclick: () => set(col.hex) }));
      const pick = h('input', { type: 'color', 'aria-label': 'Any colour', oninput: (e) => set(e.target.value) });
      const box = h('label', { class: 'swatch pick', 'data-tip': 'Any colour' }, iconEl('palette'), pick);
      wrap.append(box);
      c().bind(() => {
        const v = get();
        let preset = false;
        for (const b of wrap.querySelectorAll('button.swatch')) { const on = b.dataset.v === v; b.classList.toggle('on', on); preset = preset || on; }
        box.classList.toggle('on', !preset);
        box.style.background = preset ? '' : v;
      });
      return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Colour'), wrap);
    };

    // =====================================================================
    // Tokens
    // =====================================================================
    let libTokens = []; let libAt = 0;
    async function loadLibTokens() {
      if (Date.now() - libAt < 3000) return; // (4.7: the List window asks often)
      libAt = Date.now();
      try { libTokens = (await ts.library('list')).filter((it) => it.cat === 'tokens'); } catch { libTokens = []; }
      ctx.refreshPop();
    }
    const tokenCells = () => (SIZES.find((x) => x.id === ui.tok.size) || SIZES[2]).cells;
    function setTokenBrush(it) {
      const url = it.url || UI.pathToUrl(it.path);
      ui.tok.brush = { path: it.path, name: it.name, kind: it.kind || 'image', url };
      ui.tok.recent = [ui.tok.brush, ...(ui.tok.recent || []).filter((b) => b.path !== it.path)].slice(0, 8);
      save();
      if (ui.tool !== 'token') ctx.setTool('token');
      ctx.openPop('token');
      updateGhost();
    }
    // 4.7: the small panel shows the party's tokens and this chapter's Ready list; List … opens every token in a window of its own
    function tokenSources() {
      const groups = [];
      const party = (S().chars || []).filter((c) => c.here && c.token).map((c) => ({ path: c.token.path, name: c.name, kind: 'image', url: c.token.url }));
      if (party.length) groups.push(['The party', party, { party: true }]);
      const ch = ctx.ready.chapter();
      // (4.10.1: a token deleted from the library stays visible here, greyed, so its ✕ can take it off)
      if (ch) groups.push([`Ready · ${ch.name}`, ctx.ready.list('tokens').filter((t) => !party.some((x) => x.path === t.path)), { ready: true }]);
      return groups;
    }
    async function clearRecent() {
      const paths = [...(ui.tok.recent || []).map((b) => b.path), ...libTokens.filter((t) => t.recent >= 0).map((t) => t.path)];
      ui.tok.recent = [];
      save();
      for (const t of libTokens) if (paths.includes(t.path)) t.recent = -1;
      await ts.library('forget', { paths });
      ctx.refreshPop();
    }
    // Tokens → List: every token in the library; click: pick it up (the next click on the map places it), tick: ready
    const tokListDef = () => ({
      id: 'toklist', title: 'Tokens', icon: 'user-plus',
      tips: ['Click a token to pick it up: the next click on the map places it.', 'The tick puts it on this chapter\'s Ready list, or takes it off.',
        'The party\'s tokens come from their cards (Party folder).'],
      build: () => {
        loadLibTokens();
        const recentPaths = () => new Set((ui.tok.recent || []).map((b) => b.path));
        const onMap = () => new Set(map() ? map().layers.filter((l) => l.role === 'token').map((l) => l.path) : []);
        return PickList.build({
          bind: c().bind, round: true,
          items: () => libTokens,
          pathOf: PickList.pathOf, shortName: PickList.shortName, rootLabel: 'Tokens', memKey: 'tokens', // (4.11: its folders, all of them)
          shelves: [{ id: 'map', label: 'On this map', icon: 'map-2', has: (it) => onMap().has(it.path) }, { id: 'fav', label: 'Favourites', icon: 'star', has: (it) => !!it.fav },
            { id: 'recent', label: 'Recent', icon: 'clock', has: (it) => it.recent >= 0 || recentPaths().has(it.path) }],
          pick: (it) => setTokenBrush(it),
          state: (it) => ({ on: !!(ui.tok.brush && ui.tok.brush.path === it.path), tip: `${it.name}: click to pick it up` }),
          ready: { chapter: () => ctx.ready.chapter(), has: (p) => ctx.ready.list('tokens').some((x) => x.path === p), toggle: (it, on) => (on ? ctx.ready.add('tokens', [{ path: it.path, name: it.name }]) : ctx.ready.remove('tokens', it.path)) },
          dragCat: 'tokens',
          empty: 'No tokens yet. Put PNG or WEBP tokens into the Tokens folder of your library.',
          foot: [c().btn('From this PC …', 'folder', async () => { const r = await ts.library('import', { cat: 'tokens' }); if (r && r.ok) { libAt = 0; loadLibTokens(); toast(`${r.items.length} token${r.items.length === 1 ? '' : 's'} added`, { ms: 2000 }); } else if (r && r.error) toast(r.error, { kind: 'error' }); }, { kind: 'small', tip: 'Copy pictures from anywhere on this PC into Tokens' }),
            c().btn('Forget the recent ones', 'clock', () => clearRecent(), { kind: 'small ghost' })],
        });
      },
    });
    function buildTokenPop() {
      loadLibTokens();
      const strip = h('div', { class: 'tok-strip' });
      c().bind(() => {
        const groups = tokenSources();
        const sig = JSON.stringify([groups.map(([t, l]) => [t, l.map((x) => x.path)]), ui.tok.brush && ui.tok.brush.path]);
        if (strip.dataset.sig === sig) return;
        strip.dataset.sig = sig;
        strip.innerHTML = '';
        if (!groups.length) strip.append(c().hint('Open List … to pick tokens; tick them there to have them ready here.'));
        for (const [title, list, o] of groups) {
          strip.append(h('div', { class: 'tok-group' }, h('span', { class: 'grow ellipsis' }, title),
            o.ready && list.length ? h('button', { class: 'tg-clear', 'data-tip': 'Empty this chapter\'s Ready list', onclick: () => ctx.ready.clear('tokens') }, 'Clear') : null));
          const row = h('div', { class: `tok-row ${o.ready ? 'ready-row' : ''}` });
          for (const it of list.slice(0, 48)) {
            row.append(h('button', {
              class: `tok-pick ${ui.tok.brush && ui.tok.brush.path === it.path ? 'on' : ''} ${it.missing ? 'missing' : ''}`, 'data-tip': it.missing ? `${it.name}: no longer in the library (✕ takes it off)` : it.name, 'aria-label': it.name,
              onclick: () => (it.missing ? toast(`${it.name} is no longer in the library: ✕ takes it off the Ready list`, { ms: 3500 }) : setTokenBrush(it)),
            }, it.missing ? h('span', { class: 'miss-thumb' }, iconEl('alert-triangle')) : Thumbs.img(it.path, it.kind, it.thumb), h('span', {}, it.name),
            o.ready ? h('span', { class: 'ready-x', role: 'button', 'aria-label': `Take ${it.name} off the Ready list`, 'data-tip': 'Take it off the Ready list', onclick: (e) => { e.stopPropagation(); ctx.ready.remove('tokens', it.path); } }, iconEl('x')) : null));
          }
          if (o.ready) {
            if (!list.length) row.append(h('p', { class: 'hint ready-empty' }, 'Nothing ready yet: tick tokens in List …'));
            ctx.ready.drop(row, 'tokens');
          }
          strip.append(row);
        }
      });
      const listBtn = c().btn('List …', 'layout-grid', () => ctx.togglePanel(tokListDef()), { kind: 'wide', tip: 'All tokens: click one to pick it up, tick it to have it ready here' });
      c().bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen('toklist')));
      // what the next click on the map places
      const now = h('div', { class: 'brush-row' });
      c().bind(() => {
        const b = ui.tok.brush;
        if (now.dataset.path === (b ? b.path : '')) return;
        now.dataset.path = b ? b.path : '';
        now.innerHTML = '';
        now.append(h('span', { class: 'brush-thumb round' }, b ? Thumbs.img(b.path, b.kind) : iconEl('user')),
          h('span', { class: 'grow ellipsis' }, b ? h('span', {}, 'Placing ', h('b', {}, b.name)) : 'Pick a token above or in the List'));
      });
      return h('div', { class: 'stack' },
        strip, listBtn, now,
        c().seg({ label: 'Size', cls: 'seg-sizes', options: SIZES.map((x) => ({ value: x.id, label: x.short, tip: `${x.label}: ${x.cells === 0.5 ? 'half a square' : `${x.cells} × ${x.cells} squares`}` })),
          get: () => ui.tok.size, set: (v) => { ui.tok.size = v; save(); ctx.refreshPop(); updateGhost(); } }),
        c().toggle({ label: 'Place hidden (players don\'t see it yet)', get: () => ui.tok.hidden, set: (v) => { ui.tok.hidden = v; save(); updateGhost(); } }),
        allTags());
    }
    // all tokens on this map at once: no name tags, mine only, or for the players too (one undo step)
    function allTags() {
      const set = (t) => {
        const list = map() ? map().layers.filter((l) => l.role === 'token') : [];
        if (!list.length) { toast('No tokens on this map yet.'); return; }
        cmd('layer.many', { patches: list.map((l) => ({ id: l.id, tag: t })), stepLabel: 'Name tags' });
        toast(t === 'off' ? 'Name tags off on this map' : t === 'gm' ? 'Name tags on your screen' : 'Name tags on the table too', { ms: 1800 });
      };
      return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'All tokens on this map'),
        h('div', { class: 'ctl-row tag-all' }, c().btn('Off', null, () => set('off'), { kind: 'small' }), c().btn('Only me', null, () => set('gm'), { kind: 'small' }), c().btn('Players too', null, () => set('all'), { kind: 'small' })));
    }
    async function placeToken(pt) {
      const b = ui.tok.brush;
      if (!b) { toast('Pick a token first.'); ctx.togglePanel(tokListDef()); return; }
      const cells = tokenCells();
      const p = snapOn() ? Geom.snap(grid(), pt.x, pt.y, cells) : pt; // (4.10: Options → Tokens can turn snapping off)
      const r = await cmd('layer.add', { path: b.path, role: 'token', x: p.x, y: p.y, size: cells, hidden: ui.tok.hidden, number: ui.tok.number, tag: ui.tok.tag || 'off' });
      if (r && r.ok) {
        ui.tok.recent = [b, ...(ui.tok.recent || []).filter((x) => x.path !== b.path)].slice(0, 8);
        save();
        ui.selected = r.selected;
        view().setSelected(r.selected);
        ctx.placeCard();
        window.ts.library('touch', b.path);
      }
    }
    // a faint copy of the token under the pointer
    let ghost = null;
    let lastPt = null;
    function updateGhost(e) {
      if (e) lastPt = { x: e.clientX, y: e.clientY };
      const v = view();
      if (!v) return;
      if (!ghost) ghost = h('img', { class: 'token-ghost', alt: '' });
      const b = ui.tok.brush;
      const overToken = lastPt && document.elementsFromPoint(lastPt.x, lastPt.y).some((x) => x.classList && x.classList.contains('sv-token'));
      const show = ui.tool === 'token' && b && lastPt && map() && !overToken && !ctx.dragging();
      if (!show) { ghost.style.display = 'none'; return; }
      if (ghost.parentNode !== v.marks) v.marks.append(ghost);
      if (ghost.dataset.src !== b.url) { ghost.src = b.kind === 'video' ? '' : b.url; ghost.dataset.src = b.url; }
      const cells = tokenCells();
      const m = v.toMap(lastPt.x, lastPt.y);
      const p = snapOn() ? Geom.snap(grid(), m.x, m.y, cells) : m;
      const at = v.mapToPx(p.x, p.y);
      const d = cells * grid().size * zoom() * v.ppi * Geom.tokenPic(cells, tokSet().pic, 1); // (4.10: as big as its picture will be)
      Object.assign(ghost.style, { display: '', left: `${at.x}px`, top: `${at.y}px`, width: `${d}px`, height: `${d}px` });
      ghost.classList.toggle('hidden-tok', ui.tok.hidden);
    }

    // =====================================================================
    // Point: ping, laser, spotlight, ruler
    // =====================================================================
    let lastSend = 0;
    let spotLast = null;
    let spotTimer = 0;
    function sendSpot(pt) {
      spotLast = { mapId: S().editMapId, kind: 'spot', x: pt.x, y: pt.y, r: ui.point.spotR, dim: ui.point.spotDim };
      ts.ping(spotLast);
      if (!spotTimer) spotTimer = setInterval(() => { if (spotLast) ts.ping(spotLast); }, 1000); // keep it alive while the pointer rests
    }
    function spotOff() {
      if (!spotLast) return;
      ts.ping({ mapId: spotLast.mapId, kind: 'spot', off: true });
      spotLast = null;
      clearInterval(spotTimer); spotTimer = 0;
    }
    function measureMsg(a, b, free, done) {
      const m = Geom.measure(grid(), a, b, ui.point.rule, free);
      const label = `${ui.point.rule === 'real' && !Geom.isHex(grid()) ? '≈ ' : ''}${m.ft} ft`;
      return { mapId: S().editMapId, kind: 'measure', a: m.a, b: m.b, ft: m.ft, label, ring: ui.point.ring, done: !!done };
    }
    function showMeasure(msg) {
      if (ui.point.share) ts.ping(msg); else view().measureIn(msg);
    }
    function buildPointPop() {
      const opts = h('div', { class: 'stack' });
      c().bind(() => {
        if (opts.dataset.mode === ui.point.mode) return;
        opts.dataset.mode = ui.point.mode;
        opts.innerHTML = '';
        if (ui.point.mode === 'spot') {
          opts.append(
            c().slider({ label: 'Size of the light', min: 2, max: 24, step: 0.5, get: () => ui.point.spotR, set: (v) => { ui.point.spotR = v; save(); }, fmt: (v) => `${v}″` }),
            c().slider({ label: 'Darkness around it', min: 0.3, max: 0.97, step: 0.01, get: () => ui.point.spotDim, set: (v) => { ui.point.spotDim = v; save(); }, fmt: (v) => `${Math.round(v * 100)}%` }));
        } else if (ui.point.mode === 'measure') {
          opts.append(
            c().seg({ label: 'Diagonals', options: [{ value: 'phb', label: '5 ft', tip: 'Every square counts 5 ft, also diagonally (Player\'s Handbook)' }, { value: 'dmg', label: '5-10-5', tip: 'Every second diagonal counts 10 ft (Dungeon Master\'s Guide)' }, { value: 'real', label: 'Straight', tip: 'Straight-line distance' }],
              get: () => ui.point.rule, set: (v) => { ui.point.rule = v; save(); ctx.refreshPop(); } }),
            c().toggle({ label: 'Show a range ring around the start', get: () => ui.point.ring, set: (v) => { ui.point.ring = v; save(); } }),
            c().toggle({ label: 'Players see the ruler', get: () => ui.point.share, set: (v) => { ui.point.share = v; save(); } }));
        }
      });
      return h('div', { class: 'stack' },
        c().tiles([
          { id: 'ping', label: 'Ping', icon: 'target', tip: 'Click to ping, drag for a laser' },
          { id: 'laser', label: 'Laser', icon: 'pointer', tip: 'A red dot that follows the mouse' },
          { id: 'spot', label: 'Spotlight', icon: 'focus-2', tip: 'Darken the table except around the mouse' },
          { id: 'measure', label: 'Ruler', icon: 'ruler-measure', tip: 'Measure in feet' }], () => ui.point.mode, (v) => setPointMode(v)),
        opts);
    }
    function setPointMode(v) {
      if (ui.point.mode === 'spot' && v !== 'spot') spotOff();
      ui.point.mode = v;
      save();
      document.body.dataset.pointMode = v;
      ctx.refreshPop();
    }

    // =====================================================================
    // Draw: chalk, pen, text, eraser
    // =====================================================================
    const widthIn = () => (WIDTHS.find((w) => w.id === ui.draw.width) || WIDTHS[1]).in;
    const textIn = () => (TEXT_SIZES.find((w) => w.id === ui.draw.textSize) || TEXT_SIZES[1]).in;
    function buildDrawPop() {
      const extra = h('div', { class: 'stack' });
      c().bind(() => {
        if (extra.dataset.mode === ui.draw.mode) return;
        extra.dataset.mode = ui.draw.mode;
        extra.innerHTML = '';
        const m = ui.draw.mode;
        if (m === 'chalk' || m === 'pen') {
          extra.append(c().seg({ label: 'Line', options: WIDTHS.map((w) => ({ value: w.id, label: w.label })), get: () => ui.draw.width, set: (v) => { ui.draw.width = v; save(); } }));
        }
        if (m === 'text') extra.append(c().seg({ label: 'Text size', options: TEXT_SIZES.map((w) => ({ value: w.id, label: w.label })), get: () => ui.draw.textSize, set: (v) => { ui.draw.textSize = v; save(); } }));
      });
      const count = h('span', { class: 'grow hint' });
      c().bind(() => { const n = map().draw.length; count.textContent = n ? `${n} drawing${n === 1 ? '' : 's'} on this map` : 'Nothing drawn on this map'; });
      return h('div', { class: 'stack' },
        c().tiles([
          { id: 'chalk', label: 'Chalk', icon: 'scribble', tip: 'Fades after a few seconds' },
          { id: 'pen', label: 'Pen', icon: 'ballpen', tip: 'Stays on the map' },
          { id: 'text', label: 'Text', icon: 'typography', tip: 'A label on the map' },
          { id: 'erase', label: 'Erase', icon: 'eraser', tip: 'Erase pen lines and labels' }], () => ui.draw.mode, (v) => { ui.draw.mode = v; save(); ctx.refreshPop(); ctx.updateCursor(); }),
        swatchRow(() => ui.draw.color, (v) => { ui.draw.color = v; save(); ctx.refreshPop(); }),
        extra,
        c().sep(),
        c().row(count, c().btn('Clear', 'trash', () => undoable('draw.clear', {}), { kind: 'danger', tip: 'Remove every pen line and label from this map' })));
    }
    function flushChalk(d, end) {
      if (!d.buf.length && !end) return;
      ts.ping({ mapId: S().editMapId, kind: 'chalk', id: d.id, pts: d.buf, color: d.color, w: d.w, end: !!end });
      d.buf = [];
    }
    function flushPen(d) {
      if (!d.buf.length) return;
      const pts = d.buf;
      d.buf = [];
      cmd('draw.stroke', { id: d.id, color: d.color, w: d.w, pts, coalesce: d.id });
    }
    // pen lines the eraser touched on its way from a to b, and labels under the pointer (map inches)
    function drawAt(a, b, clientX, clientY) {
      const hits = [];
      const tol = 0.16 / zoom();
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / (tol / 2)));
      const samples = Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
      for (const d of map().draw) {
        if (d.kind !== 'pen') continue;
        const r = d.w / 2 + tol;
        let hit = false;
        for (let i = 0; i + 1 < d.pts.length && !hit; i += 2) {
          const x1 = d.pts[i]; const y1 = d.pts[i + 1];
          const x2 = i + 3 < d.pts.length ? d.pts[i + 2] : x1; const y2 = i + 3 < d.pts.length ? d.pts[i + 3] : y1;
          for (const p of samples) if (segDist(p.x, p.y, x1, y1, x2, y2) <= r) { hit = true; break; }
        }
        if (hit) hits.push(d.id);
      }
      for (const el of document.elementsFromPoint(clientX, clientY)) if (el.classList && el.classList.contains('sv-text')) hits.push(el.dataset.id);
      return hits;
    }
    async function writeText(pt) {
      const text = await askText('Write on the map', '', { ok: 'Place label', placeholder: 'The old well' });
      if (!text) return;
      const r = await cmd('draw.add', { x: pt.x, y: pt.y, text, color: ui.draw.color, size: textIn() });
      if (r && r.selected) selectMark(r.selected);
    }
    async function editText(d) {
      const text = await askText('Change the label', d.text, { ok: 'Save' });
      if (text == null) return;
      if (!text.trim()) undoable('draw.remove', { id: d.id }, 'Label removed');
      else cmd('draw.update', { id: d.id, text: text.trim() });
    }

    // =====================================================================
    // Markers and counters (Toolbox → On the map) and GM notes (Build → Notes)
    // =====================================================================
    function buildMarkPop() {
      const extra = h('div', { class: 'stack' });
      c().bind(() => {
        const sig = `${ui.mark.mode}|${ui.mark.auto}`;
        if (extra.dataset.sig === sig) return;
        extra.dataset.sig = sig;
        extra.innerHTML = '';
        if (ui.mark.mode !== 'counter') {
          extra.append(
            c().seg({ label: 'Shape', options: [{ value: 'pin', label: 'Pin', icon: 'map-pin' }, { value: 'x', label: 'Cross', icon: 'x' }, { value: 'dot', label: 'Number', icon: 'circle-number-1', tip: 'Numbered markers: 1, 2, 3 …' }],
              get: () => ui.mark.shape, set: (v) => { ui.mark.shape = v; save(); ctx.refreshPop(); } }),
            swatchRow(() => ui.mark.color, (v) => { ui.mark.color = v; save(); ctx.refreshPop(); }));
        } else if (ui.mark.mode === 'counter') {
          const name = h('input', { type: 'text', value: ui.mark.label, placeholder: 'Ritual, Reinforcements, Torches …', 'aria-label': 'Counter name', oninput: (e) => { ui.mark.label = e.target.value; save(); } });
          extra.append(...[
            h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Name'), name),
            c().stepper({ name: 'Start', label: 'Starts at', get: () => ui.mark.value, prev: (v) => v - 1, next: (v) => v + 1, set: (v) => { ui.mark.value = v; save(); ctx.refreshPop(); }, fmt: (v) => String(v) }),
            c().toggle({ label: 'Moves on Next round', get: () => !!ui.mark.auto, set: (v) => { ui.mark.auto = v ? 'down' : null; save(); ctx.refreshPop(); } }),
            ui.mark.auto ? c().seg({ options: [{ value: 'down', label: 'Count down', icon: 'trending-down' }, { value: 'up', label: 'Count up', icon: 'trending-up' }],
              get: () => ui.mark.auto, set: (v) => { ui.mark.auto = v; save(); ctx.refreshPop(); } }) : null].filter(Boolean)); // (append would write "null")
        }
      });
      const count = h('span', { class: 'grow hint' });
      c().bind(() => { const n = map().marks.filter((m) => m.kind !== 'note').length; count.textContent = n ? `${n} marker${n === 1 ? '' : 's'} and counters` : 'No markers on this map'; });
      return h('div', { class: 'stack' },
        c().seg({ options: [{ value: 'marker', label: 'Marker', icon: 'map-pin', tip: 'Pins, crosses and numbered markers' }, { value: 'counter', label: 'Counter', icon: 'plus-minus', tip: 'A number on the map, e.g. rounds until the ritual completes' }],
          get: () => (ui.mark.mode === 'counter' ? 'counter' : 'marker'), set: (v) => { ui.mark.mode = v; save(); ctx.refreshPop(); } }),
        extra,
        c().sep(),
        c().row(count, c().btn('Clear', 'trash', () => undoable('mark.clear', { kinds: ['pin', 'x', 'dot', 'counter'] }), { kind: 'danger', tip: 'Remove every marker and counter from this map (notes stay)' })));
    }
    // GM notes (Build → Notes): pinned on the map, only on this screen, never on the TV
    function buildNotesPop() {
      const list = h('div', { class: 'note-list' });
      c().bind(() => {
        const notes = map().marks.filter((m) => m.kind === 'note');
        const sig = JSON.stringify([notes.map((n) => [n.id, n.text]), ui.selMark]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        if (!notes.length) { list.append(c().hint('No notes on this map yet.')); return; }
        for (const n of notes) {
          list.append(h('div', { class: `note-row ${ui.selMark === n.id ? 'on' : ''}`, dataset: { flash: n.id } },
            iconEl('note'),
            h('button', { class: 'note-text', 'data-tip': 'Show it on the map', onclick: () => { selectMark(n.id); if (ctx.showPoint) ctx.showPoint(n.x, n.y); } }, n.text),
            c().ib('pencil', 'Edit', async () => { const t = await askText('Note (only you see it)', n.text, { ok: 'Save' }); if (t) cmd('mark.update', { id: n.id, text: t }); }),
            c().ib('trash', 'Remove', () => undoable('mark.remove', { id: n.id }, 'Note removed'), { danger: true })));
        }
      });
      return h('div', { class: 'stack' },
        list,
        c().row(h('span', { class: 'grow' }), c().btn('Remove all notes', 'trash', () => undoable('mark.clear', { kinds: ['note'] }, 'Notes removed'), { kind: 'danger' })));
    }
    async function placeMark(pt, mode = ui.mark.mode) {
      const m = ui.mark;
      let p = null;
      if (mode === 'note') {
        const text = await askText('Note (only you see it)', '', { ok: 'Pin note', placeholder: 'Silver key opens this door' });
        if (!text) return;
        p = { kind: 'note', text, color: '#e2b44f' };
      } else if (mode === 'counter') p = { kind: 'counter', label: (m.label || 'Counter').trim() || 'Counter', value: m.value, auto: m.auto || null, color: m.color };
      else p = { kind: m.shape, color: m.color };
      const r = await cmd('mark.add', { ...p, x: pt.x, y: pt.y });
      if (r && r.selected) selectMark(r.selected);
    }
    function counterStep(id, d) {
      const m = map().marks.find((x) => x.id === id);
      if (m) cmd('mark.update', { id, value: m.value + d, coalesce: `count-${id}` });
    }

    // =====================================================================
    // Pointer input (called by gm-play)
    // =====================================================================
    const OWN = new Set(['chalk', 'pen', 'erase', 'measure', 'markmove', 'textmove', 'tokenTool']);
    function pointerDown(e, pt) {
      const t = ui.tool;
      if (t === 'token') {
        const tokEl = e.target.closest('.sv-token');
        if (tokEl) return ctx.startTokenDrag(tokEl.dataset.id, pt);
        if (ui.selected) { ui.selected = null; view().setSelected(null); ctx.placeCard(); }
        placeToken(pt);
        return null;
      }
      if (t === 'point') {
        const m = ui.point.mode;
        if (m === 'measure') {
          const msg = measureMsg(pt, pt, e.altKey, false);
          showMeasure(msg);
          return { kind: 'measure', a: pt };
        }
        if (m === 'spot') { sendSpot(pt); return null; }
        return { kind: 'laser', x: e.clientX, y: e.clientY, moved: false, pt };
      }
      if (t === 'draw') {
        const m = ui.draw.mode;
        const textEl = e.target.closest('.sv-text');
        if (textEl && (m === 'text' || m === 'chalk' || m === 'pen')) {
          const d = markOf(textEl.dataset.id);
          if (!d) return null;
          selectMark(d.id);
          return { kind: 'textmove', id: d.id, dx: d.x - pt.x, dy: d.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `tx-${d.id}-${Date.now()}`, edit: m === 'text' };
        }
        if (ui.selMark) selectMark(null);
        if (m === 'chalk') {
          const d = { kind: 'chalk', id: uid('c'), color: ui.draw.color, w: widthIn() * 1.4, buf: [pt.x, pt.y], last: pt, r: 0.05 / zoom() };
          flushChalk(d);
          return d;
        }
        if (m === 'pen') {
          const d = { kind: 'pen', id: uid('p'), color: ui.draw.color, w: round(widthIn() / zoom(), 4), buf: [pt.x, pt.y], last: pt, r: 0.04 / zoom() };
          flushPen(d);
          return d;
        }
        if (m === 'text') { writeText(pt); return null; }
        const d = { kind: 'erase', key: `erase-${Date.now()}`, gone: new Set(), last: pt };
        eraseAt(d, pt, e);
        return d;
      }
      if (t === 'mark' || t === 'notes') {
        const el = e.target.closest(t === 'notes' ? '.sv-note' : '.sv-mark, .sv-note');
        if (el) {
          const m = markOf(el.dataset.id);
          if (!m) return null;
          selectMark(m.id);
          return { kind: 'markmove', id: m.id, dx: m.x - pt.x, dy: m.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `mk-${m.id}-${Date.now()}` };
        }
        placeMark(pt, t === 'notes' ? 'note' : ui.mark.mode === 'counter' ? 'counter' : 'marker'); // (Esc deselects; a click on the map always places the next one)
        return null;
      }
      return null;
    }
    function eraseAt(d, pt, e) {
      const ids = drawAt(d.last || pt, pt, e.clientX, e.clientY).filter((id) => !d.gone.has(id));
      d.last = pt;
      if (!ids.length) return;
      for (const id of ids) d.gone.add(id);
      cmd('draw.remove', { ids, coalesce: d.key });
    }
    function pointerMove(d, e, pt) {
      if (d.kind === 'chalk' || d.kind === 'pen') {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ce of evs.length ? evs : [e]) {
          const p = view().toMap(ce.clientX, ce.clientY);
          if (Math.hypot(p.x - d.last.x, p.y - d.last.y) < d.r) continue;
          d.buf.push(round(p.x, 3), round(p.y, 3));
          d.last = p;
        }
        const now = performance.now();
        if (d.kind === 'chalk') { if (now - lastSend > 30) { lastSend = now; flushChalk(d); } } else flushPen(d);
      } else if (d.kind === 'erase') {
        eraseAt(d, pt, e);
      } else if (d.kind === 'measure') {
        // at most one update every 30 ms; the newest position always follows, also when the mouse stops (it used to stay one step behind)
        const now = performance.now();
        const alt = e.altKey;
        const send = () => { lastSend = performance.now(); showMeasure(measureMsg(d.a, pt, alt, false)); };
        clearTimeout(d.sendT);
        if (now - lastSend > 30) send(); else d.sendT = setTimeout(send, 32);
      } else if (d.kind === 'markmove' || d.kind === 'textmove') {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
        if (d.moved) send(d.key, d.kind === 'markmove' ? 'mark.update' : 'draw.update', { id: d.id, x: pt.x + d.dx, y: pt.y + d.dy });
      }
    }
    function pointerUp(d, e, pt) {
      if (d.kind === 'chalk') flushChalk(d, true);
      else if (d.kind === 'pen') flushPen(d);
      else if (d.kind === 'measure') { clearTimeout(d.sendT); showMeasure(measureMsg(d.a, pt, e.altKey, true)); }
      else if ((d.kind === 'markmove' || d.kind === 'textmove') && d.moved) {
        ctx.pending.delete(d.key);
        cmd(d.kind === 'markmove' ? 'mark.update' : 'draw.update', { id: d.id, x: pt.x + d.dx, y: pt.y + d.dy, coalesce: d.key });
      } else if (d.kind === 'textmove' && !d.moved && d.edit && e.type === 'pointerup') {
        const t = markOf(d.id);
        if (t) editText(t);
      }
    }
    // the pointer moves over the map with no button held
    function hover(e, pt) {
      if (ui.tool === 'token') updateGhost(e);
      if (ui.tool !== 'point' || !pt) return;
      const now = performance.now();
      if (ui.point.mode === 'spot' && now - lastSend > 35) { lastSend = now; sendSpot(pt); }
      if (ui.point.mode === 'laser' && now - lastSend > 35) { lastSend = now; ts.ping({ mapId: S().editMapId, x: pt.x, y: pt.y, kind: 'laser' }); }
    }
    function leave() {
      lastPt = null;
      updateGhost();
      spotOff();
    }
    function toolChanged(t) {
      if (t !== 'point') spotOff();
      if (t !== 'mark' && t !== 'notes' && t !== 'draw' && ui.selMark) { ui.selMark = null; view().setSelectedMark(null); }
      document.body.dataset.pointMode = ui.point.mode;
      document.body.dataset.drawMode = ui.draw.mode;
      updateGhost();
    }
    // P and D pressed again step through their modes
    function setMode(t, v) {
      if (t === 'point') { setPointMode(v); return; }
      if (t === 'mark') { ui.mark.mode = v === 'counter' ? 'counter' : 'marker'; save(); ctx.refreshPop(); return; }
      if (t === 'draw') { ui.draw.mode = v; save(); document.body.dataset.drawMode = v; ctx.refreshPop(); if (ctx.updateCursor) ctx.updateCursor(); }
    }
    function cycle(t) {
      if (t === 'point') { setPointMode(POINT_MODES[(POINT_MODES.indexOf(ui.point.mode) + 1) % POINT_MODES.length]); return { ping: 'Ping', laser: 'Laser pointer', spot: 'Spotlight', measure: 'Ruler' }[ui.point.mode]; }
      if (t === 'draw') { ui.draw.mode = DRAW_MODES[(DRAW_MODES.indexOf(ui.draw.mode) + 1) % DRAW_MODES.length]; save(); document.body.dataset.drawMode = ui.draw.mode; ctx.refreshPop(); return { chalk: 'Chalk', pen: 'Pen', text: 'Text', erase: 'Eraser' }[ui.draw.mode]; }
      return null;
    }

    // =====================================================================
    // Card for a selected marker, counter, note or label
    // =====================================================================
    function cardTarget() {
      const m = markOf(ui.selMark);
      if (!m) return null;
      if (isText(m) ? ui.tool !== 'draw' : !(ui.tool === 'mark' || (ui.tool === 'notes' && m.kind === 'note'))) return null;
      return { kind: 'mark', item: m };
    }
    function cardAnchor(t) {
      const v = view();
      const el = v.annoEl.querySelector(`[data-id="${t.item.id}"]`) || v.notesEl.querySelector(`[data-id="${t.item.id}"]`);
      return el ? el.getBoundingClientRect() : null;
    }
    function colorMenu(anchor, set) {
      const r = anchor.getBoundingClientRect();
      openMenu(r.left, r.bottom + 6, INK.map((col) => ({ icon: 'circle', label: col.label, swatch: col.hex, action: () => set(col.hex) })));
    }
    function card(t) {
      const m = t.item;
      const { ib, cardSep } = c();
      const upd = (patch) => cmd(isText(m) ? 'draw.update' : 'mark.update', { id: m.id, ...patch });
      const remove = () => { undoable(isText(m) ? 'draw.remove' : 'mark.remove', { id: m.id }); selectMark(null); };
      const hide = ib(m.hidden ? 'eye-off' : 'eye', m.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => upd({ hidden: !m.hidden }), { on: m.hidden, key: 'H' });
      const del = ib('trash', 'Remove', remove, { danger: true, key: 'Del' });
      const col = ib('palette', 'Colour', (e) => colorMenu(e.currentTarget, (hex) => upd({ color: hex })));
      if (isText(m)) {
        return [h('span', { class: 'card-title ellipsis' }, iconEl('typography'), m.text),
          ib('pencil', 'Change the text', () => editText(m)),
          ib('minus', 'Smaller', () => upd({ size: round(Math.max(0.15, m.size / 1.25), 3) })),
          ib('plus', 'Bigger', () => upd({ size: round(Math.min(4, m.size * 1.25), 3) })),
          col, cardSep(), hide, del];
      }
      if (m.kind === 'note') {
        return [h('span', { class: 'card-title ellipsis' }, iconEl('note'), 'Note (only you)'),
          ib('pencil', 'Edit the note', async () => { const text = await askText('Note (only you see it)', m.text, { ok: 'Save' }); if (text != null) upd({ text }); }), cardSep(), del];
      }
      if (m.kind === 'counter') {
        const auto = m.auto === 'down' ? 'trending-down' : m.auto === 'up' ? 'trending-up' : 'minus';
        return [h('span', { class: 'card-title ellipsis' }, iconEl('plus-minus'), m.label),
          ib('pencil', 'Rename', async () => { const n = await askText('Name the counter', m.label, { ok: 'Save' }); if (n) upd({ label: n }); }),
          ib('minus', 'One less', () => counterStep(m.id, -1)),
          h('span', { class: 'card-size' }, String(m.value)),
          ib('plus', 'One more', () => counterStep(m.id, 1)),
          ib(auto, m.auto === 'down' ? 'Counts down on Next round. Click to change' : m.auto === 'up' ? 'Counts up on Next round. Click to change' : 'Ignores Next round. Click to change',
            () => upd({ auto: m.auto === 'down' ? 'up' : m.auto === 'up' ? null : 'down' }), { on: !!m.auto }),
          col, cardSep(), hide, del];
      }
      const name = m.kind === 'pin' ? 'Pin' : m.kind === 'x' ? 'Cross' : `Marker ${m.n}`;
      const out = [h('span', { class: 'card-title ellipsis' }, iconEl(m.kind === 'x' ? 'x' : m.kind === 'dot' ? 'circle-number-1' : 'map-pin'), name)];
      if (m.kind === 'dot') out.push(ib('minus', 'Lower number', () => upd({ n: Math.max(0, (m.n || 1) - 1) })), ib('plus', 'Higher number', () => upd({ n: (m.n || 0) + 1 })));
      out.push(col, cardSep(), hide, del);
      return out;
    }
    function markRadial(id, x, y) {
      const m = markOf(id);
      if (!m) return false;
      selectMark(m.id);
      const upd = (patch) => cmd(isText(m) ? 'draw.update' : 'mark.update', { id: m.id, ...patch });
      const items = [
        { icon: m.hidden ? 'eye' : 'eye-off', label: m.hidden ? 'Show' : 'Hide', run: () => upd({ hidden: !m.hidden }) },
        { icon: 'trash', label: 'Remove', danger: true, run: () => { undoable(isText(m) ? 'draw.remove' : 'mark.remove', { id: m.id }); selectMark(null); } },
        { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S().editMapId, x: m.x, y: m.y }) },
      ];
      if (m.kind === 'counter') items.unshift({ icon: 'plus', label: '+1', run: () => counterStep(m.id, 1) }, { icon: 'minus', label: '−1', run: () => counterStep(m.id, -1) });
      if (isText(m)) items.unshift({ icon: 'pencil', label: 'Edit', run: () => editText(m) });
      if (m.kind === 'note') items.splice(0, 1, { icon: 'pencil', label: 'Edit', run: async () => { const text = await askText('Note (only you see it)', m.text, { ok: 'Save' }); if (text != null) upd({ text }); } });
      ctx.Radial.open(x, y, items, isText(m) ? 'Label' : m.kind === 'counter' ? m.label : m.kind === 'note' ? 'Note' : 'Marker');
      return true;
    }
    function removeSelected() {
      const m = markOf(ui.selMark);
      if (!m) return false;
      undoable(isText(m) ? 'draw.remove' : 'mark.remove', { id: m.id });
      selectMark(null);
      return true;
    }
    function toggleSelectedHidden() {
      const m = markOf(ui.selMark);
      if (!m) return false;
      cmd(isText(m) ? 'draw.update' : 'mark.update', { id: m.id, hidden: !m.hidden });
      return true;
    }

    // =====================================================================
    // Countdown timer
    // =====================================================================
    const timer = () => S() && S().timer;
    const leftSecs = (t) => Math.ceil(Countdown.leftMs(t) / 1000);
    const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // 10 s steps up to 2 min, 30 s steps up to 10 min, then whole minutes
    const stepTime = (v, d) => { const ref = d > 0 ? v : v - 1; const st = ref < 120 ? 10 : ref < 600 ? 30 : 60; return clamp(v + d * st, 5, 5940); };
    function buildTimerPop() {
      const setup = h('div', { class: 'stack' });
      const running = h('div', { class: 'stack timer-running' });
      const chips = h('div', { class: 'chips' }, ...TIMES.map((s) => h('button', { class: 'chip', dataset: { v: String(s) }, onclick: () => { ui.timer.seconds = s; save(); ctx.refreshPop(); } }, s < 60 ? `${s} s` : `${s / 60} min`)));
      c().bind(() => { for (const b of chips.children) b.classList.toggle('on', Number(b.dataset.v) === ui.timer.seconds); });
      const label = h('input', { type: 'text', value: ui.timer.label, placeholder: 'What happens at zero? (optional)', 'aria-label': 'Label', oninput: (e) => { ui.timer.label = e.target.value; save(); } });
      setup.append(
        c().seg({ options: [{ value: 'normal', label: 'Normal', icon: 'clock', tip: 'A small clock at the top of the TV' }, { value: 'dramatic', label: 'Dramatic', icon: 'heartbeat', tip: 'A big number in the middle, a pulse every second that gets deeper' }],
          get: () => ui.timer.mode, set: (v) => { ui.timer.mode = v; save(); ctx.refreshPop(); } }),
        chips,
        c().stepper({ name: 'Time', label: 'Time', get: () => ui.timer.seconds, prev: (v) => stepTime(v, -1), next: (v) => stepTime(v, 1), set: (v) => { ui.timer.seconds = v; save(); ctx.refreshPop(); }, fmt: clock }),
        h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Label on the table'), label),
        (() => {
          const box = h('div', {}, c().seg({ label: 'Dial at', options: [{ value: 'left', label: 'Left end', icon: 'arrow-left' }, { value: 'center', label: 'Middle', icon: 'circle' }, { value: 'right', label: 'Right end', icon: 'arrow-right' }], get: () => ui.timer.side || 'right', set: (v) => { ui.timer.side = v; save(); ctx.refreshPop(); } }));
          c().bind(() => { box.hidden = ui.timer.mode !== 'normal'; });
          return box;
        })(),
        c().toggle({ label: 'Sound', get: () => ui.timer.sound, set: (v) => { ui.timer.sound = v; save(); } }),
        c().row(
          c().btn('Start', 'player-play', startTimer, { kind: 'primary', tip: 'Start the countdown on the table' }),
          c().btn('Listen', 'volume', () => (ui.timer.mode === 'dramatic' ? Countdown.demo((S().settings && S().settings.sfxVolume) ?? 0.7) : Countdown.chime((S().settings && S().settings.sfxVolume) ?? 0.7)), { tip: ui.timer.mode === 'dramatic' ? 'Hear how the pulse darkens towards zero (here, not on the table)' : 'Hear the chime (here, not on the table)' })));
      const big = h('div', { class: 'timer-big' });
      const sub = h('div', { class: 'hint' });
      const pauseBtn = c().btn('Pause', 'player-pause', () => cmd(timer() && timer().endsAt ? 'timer.pause' : 'timer.resume'));
      // a running dial can move too
      const sideSeg = c().seg({ label: 'Dial at', options: [{ value: 'left', label: 'Left end', icon: 'arrow-left' }, { value: 'center', label: 'Middle', icon: 'circle' }, { value: 'right', label: 'Right end', icon: 'arrow-right' }],
        get: () => (timer() && timer().side) || 'right', set: (v) => { ui.timer.side = v; save(); cmd('timer.side', { side: v }); } });
      running.append(big, sub, sideSeg,
        c().row(pauseBtn, c().btn('+10 s', null, () => cmd('timer.add', { seconds: 10 })), c().btn('+1 min', null, () => cmd('timer.add', { seconds: 60 }))),
        c().btn('Stop', 'player-stop', () => cmd('timer.stop'), { kind: 'wide danger' }));
      const paint = () => {
        const t = timer();
        setup.hidden = !!t;
        running.hidden = !t;
        if (!t) return;
        const s = leftSecs(t);
        big.textContent = s > 0 ? clock(s) : 'Time!';
        big.classList.toggle('dramatic', t.mode === 'dramatic');
        sideSeg.hidden = t.mode !== 'normal';
        sub.textContent = `${t.mode === 'dramatic' ? 'Dramatic' : 'Normal'} timer${t.label ? `: ${t.label}` : ''}${t.endsAt ? '' : ' (paused)'}`;
        const st = t.endsAt ? 'run' : 'paused';
        if (pauseBtn.dataset.st !== st) {
          pauseBtn.dataset.st = st;
          pauseBtn.lastChild.textContent = t.endsAt ? 'Pause' : 'Resume';
          pauseBtn.firstChild.replaceWith(iconEl(t.endsAt ? 'player-pause' : 'player-play'));
        }
      };
      c().bind(paint);
      popTick = paint;
      return h('div', { class: 'stack' }, setup, running);
    }
    let popTick = null;
    function startTimer() {
      cmd('timer.start', { mode: ui.timer.mode, seconds: ui.timer.seconds, label: ui.timer.label.trim(), sound: ui.timer.sound, side: ui.timer.side || 'right' });
    }

    // =====================================================================
    // HUD rows under the table preview: round counter and running timer
    // =====================================================================
    function nextRound() {
      if (S() && S().init && S().init.running) { // in a fight, Enter moves to the next turn (and the next round after the last one)
        cmd('init.next').then((r) => { if (r && r.ok && r.round) toast(r.label, { undo: () => cmd('history.undo', { mapId: r.mapId }), ms: 3500 }); });
        return;
      }
      const cb = S() && S().combat;
      if (!cb) return;
      if (cb.n == null) { cmd('round.set', { mapId: cb.mapId, n: 1 }).then((r) => r && r.ok && toast('Round 1. Next round: Enter', { undo: () => cmd('history.undo', { mapId: cb.mapId }) })); return; }
      cmd('round.next', { mapId: cb.mapId }).then((r) => {
        if (r && r.ok) toast(r.label, { undo: () => cmd('history.undo', { mapId: cb.mapId }), ms: r.ended && r.ended.length ? 7000 : 3500 });
      });
    }
    function renderHud(box) {
      const s = S();
      const cb = s.combat;
      const t = s.timer;
      const I = s.init;
      const talk = s.talk;
      const fight = !!(I && I.running); // the turn order and its round live in the Initiative panel
      const sig = JSON.stringify([cb, t && [t.id, t.mode, !!t.endsAt], fight, talk && talk.cast.map((x) => x.name), s.handout && s.handout.name, s.brk && s.brk.id]);
      if (box.dataset.sig !== sig) {
        box.dataset.sig = sig;
        box.innerHTML = '';
        if (talk) {
          box.append(h('div', { class: 'hud-row hud-talk' }, iconEl('messages'),
            h('span', { class: 'grow ellipsis' }, talk.cast.length ? talk.cast.map((x) => x.name).reverse().join(', ') : 'Conversation: nobody on stage yet'),
            h('button', { class: 'icon-btn', 'aria-label': 'Conversation', 'data-tip': 'Choose portraits', onclick: () => ctx.openPop('talk') }, iconEl('user-circle')),
            h('button', { class: 'icon-btn', 'aria-label': 'End the conversation', 'data-tip': 'End the conversation', onclick: () => cmd('talk.off') }, iconEl('player-stop'))));
        }
        if (s.handout) {
          box.append(h('div', { class: 'hud-row hud-handout' }, iconEl('script'), h('span', { class: 'grow ellipsis' }, s.handout.name),
            h('button', { class: 'icon-btn', 'aria-label': 'Put it away', 'data-tip': 'Put the handout away', onclick: () => cmd('handout.hide') }, iconEl('x'))));
        }
        if (s.brk) {
          box.append(h('div', { class: 'hud-row hud-break' }, iconEl('coffee'), h('span', {}, 'Break'), h('b', { class: 'hud-brk grow' }),
            h('button', { class: 'icon-btn', 'aria-label': 'End the break', 'data-tip': 'End the break', onclick: () => cmd('break.end') }, iconEl('player-stop'))));
        }
        if (t) {
          box.append(h('div', { class: `hud-row hud-timer ${t.mode}` },
            iconEl(t.mode === 'dramatic' ? 'heartbeat' : 'clock'), h('b', { class: 'hud-time grow' }),
            h('button', { class: 'icon-btn', 'aria-label': t.endsAt ? 'Pause' : 'Resume', 'data-tip': t.endsAt ? 'Pause the countdown' : 'Resume', onclick: () => cmd(t.endsAt ? 'timer.pause' : 'timer.resume') }, iconEl(t.endsAt ? 'player-pause' : 'player-play')),
            h('button', { class: 'icon-btn', 'aria-label': 'Stop', 'data-tip': 'Stop and remove it from the table', onclick: () => cmd('timer.stop') }, iconEl('player-stop'))));
        }
        // 2.2: no "Count rounds" button here any more (Enter starts counting; in a fight the Initiative panel counts);
        // while rounds are counted outside a fight, this row shows the round
        if (cb && !fight) {
          if (cb.n != null) {
            box.append(h('div', { class: 'hud-row hud-round' },
              h('span', { class: 'grow hud-label', 'data-tip': cb.show ? `Round ${cb.n}, shown on the table` : `Round ${cb.n}, hidden from players` }, h('small', { class: 'hud-r' }, 'Round'), ' ', h('b', {}, String(cb.n)), cb.show ? null : iconEl('eye-off', 'hud-hid')),
              h('button', { class: 'icon-btn', 'aria-label': 'Round on the table', 'data-tip': 'Where and how big the round shows on the table', onclick: () => ctx.openPop('round') }, iconEl('drag-drop-2')),
              h('button', { class: 'icon-btn', 'aria-label': 'Stop counting', 'data-tip': 'Stop counting rounds', onclick: () => cmd('round.set', { mapId: cb.mapId, n: null }) }, iconEl('x')),
              Hotbar.offer(h('button', { class: 'btn primary small hud-next', 'data-tip': 'Next round: counts spell areas and counters along', 'data-key': 'Enter', onclick: nextRound }, 'Next', iconEl('player-track-next')), ctx.doHot('next'))));
          }
        }
      }
      tickHud(box);
    }
    let hudTimer = 0;
    function tickHud(box) {
      const t = S() && S().timer;
      const out = box.querySelector('.hud-time');
      if (out && t) { const s = leftSecs(t); out.textContent = s > 0 ? clock(s) : 'Time!'; }
      const b = S() && S().brk;
      const brkOut = box.querySelector('.hud-brk');
      if (brkOut && b) { const s = Math.ceil(Math.max(0, b.endsAt - Date.now()) / 1000); brkOut.textContent = s > 0 ? clock(s) : 'Time!'; }
      const inPop = ctx.popId() === 'timer' || ctx.popId() === 'toolbox';
      if (popTick && inPop) popTick();
      if (inPop && ctx.tick) ctx.tick();
      if ((t || b) && !hudTimer) hudTimer = setInterval(() => tickHud(box), 250);
      if (!t && !b && hudTimer) { clearInterval(hudTimer); hudTimer = 0; if (popTick && inPop) popTick(); if (inPop && ctx.tick) ctx.tick(); }
    }

    function update() {
      if (ui.selMark && !markOf(ui.selMark)) { ui.selMark = null; view().setSelectedMark(null); }
    }

    document.body.dataset.pointMode = ui.point.mode;
    document.body.dataset.drawMode = ui.draw.mode;

    return {
      buildTokenPop, buildPointPop, buildDrawPop, buildMarkPop, buildNotesPop, buildTimerPop,
      pointerDown, pointerMove, pointerUp, hover, leave, toolChanged, cycle, setMode, owns: (k) => OWN.has(k),
      cardTarget, cardAnchor, card, markRadial, removeSelected, toggleSelectedHidden, selectMark,
      setTokenBrush, placeToken, counterStep, nextRound, renderHud, update, spotOff, sizeName, SIZES,
      // 4.10: Options → Tokens sets what new tokens get (size, hidden, numbers, name tag)
      tokPref: (k) => ui.tok[k], setTokPref: (k, v) => { ui.tok[k] = v; save(); ctx.refreshPop(); updateGhost(); },
    };
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1; const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  return { create, SIZES, sizeName, sizeShort };
})();
