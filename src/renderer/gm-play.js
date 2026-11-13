// The GM's play screen: canvas, icon rail, tool popovers, radial menu,
// library drawer, map roster, live/prep frame and table controls.
//
// Positions on the map are map inches (see scene-view.js). Brush sizes and
// "cell size on the table" are physical inches on the TV.
'use strict';

const Play = (() => {
  const { h, iconEl, $, toast, openMenu, closeMenu, menuOpen, askText, Thumbs, clamp, round, dialog } = UI;
  const ts = window.ts;
  const D2R = Math.PI / 180;
  const SQ3 = Math.sqrt(3);

  let S = null; // latest state from main
  let view = null; // SceneView
  let els = {};
  const ui = {
    tool: 'select', fogMode: 'reveal', fogShape: 'brush', brushIn: 2,
    selected: null, selFx: null, selSpell: null, drawer: null, rosterCollapsed: false,
    align: null, expanded: null, viewChapterId: null, lastEditId: null,
    // effects tool
    fxMode: 'place', emitter: 'torch', region: 'mist', light: 'torch', fxSize: 1, paintIn: 2, regionIds: {},
    look: { color: null, intensity: 1, density: 1, speed: 1, flicker: true, angle: null, variant: null, wave: null }, // the next effect you place
    // assets tool
    brush: null, assetMode: 'stamp', assetCells: 2, assetRot: 0, scatterIn: 3, scatterGap: 1.2, scatterTurn: true, scatterVary: 0.25, selAsset: null, selAssets: [],
    assetLook: { opacity: 1, dark: 0, shadow: false, flip: false }, // the next asset you stamp
    // spells tool
    spell: { name: 'Fireball', shape: 'sphere', size: 20, width: 5, skin: 'fire', mode: 'burst', squares: true, count: false, color: null, duration: null },
    spellAngle: 0, spellQuery: '', recent: [], aimFrom: null,
  };
  try {
    const p = JSON.parse(localStorage.getItem('spellPrefs') || 'null');
    if (p && p.spell) Object.assign(ui.spell, p.spell);
    if (p && Array.isArray(p.recent)) ui.recent = p.recent.slice(0, 7);
  } catch {}
  const savePrefs = () => { try { localStorage.setItem('spellPrefs', JSON.stringify({ spell: ui.spell, recent: ui.recent })); } catch {} };
  const cams = new Map();
  let refreshers = [];
  let popId = null;
  let Floats = null; // floating Toolbox panels (float-panels.js)
  let Hot = null; // the hotbar (hotbar.js)

  // =====================================================================
  // Commands
  // =====================================================================
  const cmd = (type, payload) => ts.cmd(type, payload);
  // rAF-throttled sender for continuous input (drags, sliders); latest value per key wins.
  const pending = new Map();
  let frameQueued = false;
  function send(key, type, payload) {
    pending.set(key, [type, { ...payload, coalesce: key }]);
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      const batch = [...pending.values()];
      pending.clear();
      for (const [t, p] of batch) ts.cmd(t, p);
    });
  }
  // settings changed while dragging: at most one message per frame
  let setQueue = null;
  function sendSettings(patch) {
    if (setQueue) { Object.assign(setQueue, patch); return; }
    setQueue = { ...patch };
    requestAnimationFrame(() => { const p = setQueue; setQueue = null; ts.settings(p); });
  }
  // Destructive map edits get an undo toast instead of a confirmation.
  async function undoable(type, payload, label) {
    const r = await cmd(type, payload);
    if (r && r.ok) toast(label || r.label || 'Done', { undo: () => cmd('history.undo') });
    return r;
  }
  async function structural(type, payload) {
    const r = await cmd(type, payload);
    if (r && r.ok && r.undo) toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) });
    else if (r && !r.ok && r.error) toast(r.error, { kind: 'error' });
    return r;
  }
  let lastPreview = ''; // the latest picture of the TV (also behind the round placer)
  let settingsTimer = null;
  const settingsLater = (patch) => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => ts.settings(patch), 120); };

  const map = () => (S ? S.map : null);
  const layer = (id) => (map() ? map().layers.find((l) => l.id === id) : null);
  const fxOf = (id) => (map() && id ? map().fx.find((f) => f.id === id) : null);
  const spellOf = (id) => (map() && id ? map().spells.find((s) => s.id === id) : null);
  const grid = () => map().grid;
  const zoom = () => (map() ? map().view.zoom : 1);
  const tableIn = () => ({ w: view.W / view.ppi, h: view.H / view.ppi });
  const chapters = () => (S && S.campaign ? S.campaign.chapters : []);
  const chapterOfMap = (id) => chapters().find((c) => c.maps.some((m) => m.id === id)) || null;
  const allMaps = () => chapters().flatMap((c) => c.maps);
  const viewChapter = () => chapters().find((c) => c.id === ui.viewChapterId) || chapterOfMap(S.editMapId) || chapters()[0] || null;
  const isLive = () => S && S.editMapId && S.table.liveMapId === S.editMapId;
  // 2.2: a chapter's Ready lists (Tokens, Talk): the tokens and portraits the GM wants at hand there
  const Ready = {
    chapter: () => chapterOfMap(S && S.editMapId) || viewChapter(),
    list: (kind) => { const ch = Ready.chapter(); return (ch && ch.ready && ch.ready[kind]) || []; },
    // Prototype 26: one list per chapter for anything from the library, kept by kind
    KINDS: ['tokens', 'portraits', 'handouts', 'other'],
    kindOf: (cat) => (['tokens', 'portraits', 'handouts'].includes(cat) ? cat : 'other'),
    all: () => Ready.KINDS.flatMap((k) => Ready.list(k)),
    kindWith: (path) => Ready.KINDS.find((k) => Ready.list(k).some((x) => x.path === path)) || null,
    async set(kind, items, msg) {
      const ch = Ready.chapter();
      if (!ch) return null;
      const r = await cmd('ready.set', { chapterId: ch.id, kind, items: items.map((x) => ({ path: x.path })) });
      if (r && r.ok && msg) toast(msg, { ms: 3500, undo: () => cmd(r.undo.type, r.undo.payload) });
      return r;
    },
    add(kind, items) {
      const cur = Ready.list(kind);
      const more = items.filter((x) => x && x.path && !cur.some((y) => y.path === x.path));
      if (!more.length) { toast('Already on the Ready list', { ms: 2000 }); return null; }
      const what = more.length === 1 ? more[0].name : `${more.length} ${kind}`;
      return Ready.set(kind, [...cur, ...more], `${what} ready for ${Ready.chapter().name}${{ tokens: ' (Tokens)', handouts: ' (Handouts)', portraits: ' (Portraits)' }[kind] || ''}`);
    },
    remove(kind, path) { const cur = Ready.list(kind); const it = cur.find((x) => x.path === path); return Ready.set(kind, cur.filter((x) => x.path !== path), it ? `${it.name} taken off the Ready list` : null); },
    clear(kind) { return Ready.set(kind, [], `Ready list of ${Ready.chapter().name} cleared`); },
    // a row that takes tokens or portraits dragged from the library
    drop(el, kind) {
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-ts-asset')) { e.preventDefault(); e.stopPropagation(); el.classList.add('drop-ok'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop-ok'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('drop-ok');
        let a = null;
        try { a = JSON.parse(e.dataTransfer.getData('application/x-ts-asset') || 'null'); } catch {}
        if (!a || !a.path) return;
        e.preventDefault(); e.stopPropagation();
        Ready.add(kind, [{ path: a.path, name: a.name }]);
      });
      return el;
    },
  };
  const tokenLight = (id) => (map() ? map().fx.find((f) => f.kind === 'light' && f.attachTo === id) : null);
  const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // The view we just asked for, until main confirms it (keeps wheel zoom smooth).
  let pv = null;
  const curView = () => (pv && performance.now() - pv.t < 400 ? pv.v : map().view);
  // 4.4: while the map moves, your screen takes the new place at once and the TV gets only the place (live); when
  // the move rests a moment (or the drag ends) the whole state follows once
  let liveView = null;
  // hold: a drag still in progress (4.5): it only settles when the button is let go, not when the hand rests
  // 4.8: while the map moves, this screen holds still (its effects, animated assets and videos) and nothing new is
  // loaded in the background (animations prepared, thumbnails, the floating panels' refreshes); main skips the TV preview
  function startMove() {
    if (window.__tsMoving) return;
    window.__tsMoving = true;
    if (view) view.holdStill(true);
  }
  function endMove() {
    if (!window.__tsMoving) return;
    window.__tsMoving = false;
    if (view) view.holdStill(false);
    if (typeof AnimBaker === 'object' && AnimBaker.kick) AnimBaker.kick();
  }
  function sendView(key, v, hold = false) {
    startMove();
    pv = { v: { ...curView(), ...v }, t: performance.now() };
    if (view && S && S.map) view.setViewLive(pv.v);
    send(key, 'view.update', { ...v, live: true, hold: hold || undefined });
    if (liveView) clearTimeout(liveView.t);
    liveView = { key, t: hold ? 0 : setTimeout(finishView, 250) };
  }
  function finishView() {
    endMove();
    if (!liveView) return;
    clearTimeout(liveView.t);
    const { key } = liveView; liveView = null;
    const v = pv ? pv.v : curView();
    send(key, 'view.update', { x: v.x, y: v.y, zoom: v.zoom, live: false });
  }

  // =====================================================================
  // Build
  // =====================================================================
  // Undo and redo on top; two groups: building the map (prep) and playing on it (at the table); library, campaigns, table and keys below.
  // Prototype 5: with one of these in hand the map shows whole, lit and with its effects, also beyond the TV's edge
  const WIDE_TOOLS = ['map', 'fx', 'asset', 'walls', 'notes'];
  const wideFor = (t) => WIDE_TOOLS.includes(t) && !(S && S.settings && S.settings.buildWide === false);
  const RAIL = [
    { group: 'history' },
    { group: 'build', title: 'Build', fold: true, items: [
      { id: 'map', icon: 'map-2', label: 'Map', key: 'M', tool: true, pop: true, tip: 'Move and scale the map; its brightness, contrast and colours' },
      { id: 'grid', icon: 'grid-4x4', label: 'Grid', pop: true, tip: 'Grid shape, size and tilt (G shows or hides it)' },
      { id: 'fx', icon: 'flame', label: 'Effects', key: 'E', tool: true, pop: true, tip: 'Torches, mist, lights, darkness and weather' },
      { id: 'asset', icon: 'trees', label: 'Assets', key: 'S', tool: true, pop: true, tip: 'Trees, rocks, furniture: stamp or scatter them on the map' },
      { id: 'walls', icon: 'wall', label: 'Walls', key: 'W', tool: true, pop: true, tip: 'Walls and doors: they stop light and line of sight' },
      { id: 'layers', icon: 'stack-2', label: 'Layers', key: 'K', pop: true, tip: 'Everything placed on this map' },
      { id: 'sound', icon: 'volume', label: 'Ambience', pop: true, tip: 'Chapter ambience, map sounds, fight music and Spotify' }] }, // (Prototype 14: Map notes moved to the Toolbox)
    // 4.5: the Toolbox on its own between Build and Play (and the panels pinned from it); 4.5.1: without a heading
    { group: 'extra', items: [
      { id: 'toolbox', icon: 'briefcase', label: 'Toolbox', key: 'Q', pop: true, tip: 'Map tools and panels: pointer, draw, markers, initiative, sounds, screen effects and more' }] },
    { group: 'play', title: 'Play', items: [
      { id: 'select', icon: 'pointer', label: 'Select', key: 'V', tool: true, tip: 'Select and move tokens, spell areas and lights' },
      { id: 'token', icon: 'user-plus', label: 'Tokens', key: 'N', tool: true, pop: true, tip: 'Drop NPCs with a click' },
      { id: 'fog', icon: 'cloud-fog', label: 'Fog', key: 'R / C', tool: true, pop: true, tip: 'Reveal (R) or cover (C) with fog' },
      { id: 'party', icon: 'users-group', label: 'Party marker', short: 'Party', key: 'U', tool: true, pop: true, tip: 'The party marker: where it is, its light and darkvision' },
      { id: 'spell', icon: 'wand', label: 'Spells', key: 'A', tool: true, pop: true, tip: 'Spells: spheres, cones, lines, cubes and auras' },
      { id: 'talk', icon: 'messages', label: 'Conversation', short: 'Converse', key: 'O', pop: true, tip: 'NPC portraits rise out of a band on the table' }] },
    'spacer',
    { group: 'end', items: [{ id: 'library', icon: 'photo', label: 'Library', key: 'L', tip: 'Maps, tokens, overlays and sounds' },
      { id: 'home', icon: 'home', label: 'Campaign', tip: 'The campaign page: players, screens, table check' }, { id: 'table', icon: 'settings', label: 'Options', key: 'Ctrl ,', tip: 'The TV, its picture, seating, sound, performance, this screen, the library' },
      { id: 'help', icon: 'keyboard', label: 'Guide', key: '?', tip: 'First evening, keys, what\'s new, report a problem' }] },
  ];
  const BUILD = new Set(['map', 'asset', 'fx', 'walls', 'grid', 'layers', 'sound']);
  // Beta 3.2: the Build tools stay open unless you fold them; folded, they stay folded (on every map, also after a
  // restart) until you open them again. (Before, they folded by themselves while the map was on the table.)
  let buildFold = false;
  try { buildFold = localStorage.getItem('buildFolded') === '1'; } catch {}
  const buildFolded = () => !!(S && S.map) && buildFold;
  function toggleBuild() {
    buildFold = !buildFold;
    try { localStorage.setItem('buildFolded', buildFold ? '1' : '0'); } catch {}
    renderRail();
  }
  // the rail buttons get as tall as the screen allows (50 px down to 28 px, icons only), so everything fits without scrolling
  let fitT = 0;
  function fitRail() {
    cancelAnimationFrame(fitT);
    fitT = requestAnimationFrame(() => {
      const rail = els.rail;
      if (!rail || !rail.isConnected || !rail.clientHeight) return;
      const btns = [...rail.querySelectorAll('.rail-btn:not(.small)')].filter((b) => b.offsetParent);
      if (!btns.length) return;
      const cur = btns[0].getBoundingClientRect().height;
      const grow = rail.querySelector('.grow');
      const spare = (grow ? grow.getBoundingClientRect().height : 0) - (rail.scrollHeight - rail.clientHeight) - 10;
      const hh = Math.max(28, Math.min(50, Math.floor(cur + spare / btns.length)));
      const dense = hh < 34 ? '3' : hh < 38 ? '2' : hh < 45 ? '1' : ''; // 3: icons only (their names show as tips)
      if (rail.dataset.dense !== dense) rail.dataset.dense = dense;
      if (Math.abs(hh - cur) >= 1) rail.style.setProperty('--rail-btn-h', `${hh}px`);
    });
  }
  window.addEventListener('resize', () => fitRail());
  function railBtn(it, small) {
    const b = h('button', {
      class: `rail-btn ${small ? 'small' : ''} ${it.cls || ''}`, dataset: { id: it.id }, 'data-tip': it.tip, 'data-key': it.key || null, 'aria-label': it.label,
      onclick: (e) => railClick(it, e.currentTarget),
    }, iconEl(it.icon), small ? null : h('span', { class: 'rail-label' }, it.short || it.label)); // (the narrow rail shows the short name)
    return HOT_RAIL(it) && railItem(it.id) ? Hotbar.offer(b, toolHot(it.id, it.label, it.icon)) : b; // Prototype 24: a tool on the hotbar
  }
  const railButton = (id) => {
    const b = els.rail.querySelector(`.rail-btn[data-id="${id}"]`);
    if (b && b.offsetParent) return b;
    if (BUILD.has(id)) return els.rail.querySelector('.rail-btn[data-id="build"]') || b;
    return els.rail.querySelector('.rail-btn[data-id="toolbox"]'); // Point and Draw live in the Toolbox
  };

  function mount(root) {
    const rail = h('nav', { id: 'rail', 'aria-label': 'Tools' });
    for (const g of RAIL) {
      if (g === 'spacer') { rail.append(h('div', { class: 'grow' })); continue; }
      if (g.group === 'history') {
        rail.append(h('div', { class: 'rail-history' },
          railBtn({ id: 'undo', icon: 'arrow-back-up', label: 'Undo', key: 'Ctrl Z', tip: 'Undo' }, true),
          railBtn({ id: 'redo', icon: 'arrow-forward-up', label: 'Redo', key: 'Ctrl Y', tip: 'Redo' }, true)));
        continue;
      }
      const box = h('div', { class: `rail-group g-${g.group}`, dataset: { group: g.group } });
      if (g.title) {
        // Build: the arrow folds it into one button (that button opens it again)
        box.append(g.fold
          ? h('div', { class: 'rail-head rail-head-fold' },
            h('button', { class: 'rail-fold-btn', 'aria-label': `${g.title}: fold`, onclick: (e) => { e.currentTarget.blur(); toggleBuild(); } }, h('span', {}, g.title), iconEl('chevron-up')))
          : h('div', { class: 'rail-head' }, h('span', {}, g.title)));
      }
      if (g.fold) box.append(railBtn({ id: 'build', icon: 'tools', label: 'Build', cls: 'rail-fold', tip: 'Build tools: map, grid, effects, assets, walls, layers, sound' }));
      for (const it of g.items) box.append(railBtn(it));
      if (g.group === 'extra') box.append(h('div', { class: 'rail-pins' })); // 4.3: panels pinned from the Toolbox (4.5: under it)
      if (g.small) box.append(h('div', { class: 'rail-small' }, ...g.small.map((it) => railBtn(it, true))));
      rail.append(box);
    }
    const stage = h('div', { id: 'stage' },
      h('div', { id: 'viewport' }),
      h('div', { id: 'frame' }, h('span', { class: 'frame-tab' })),
      h('div', { id: 'empty' }),
      h('div', { id: 'topbar' }),
      h('div', { id: 'toolhint', role: 'status' }), // Prototype 25
      h('div', { id: 'table-ctl' }),
      h('div', { id: 'token-card' }),
      h('div', { id: 'pop', role: 'dialog' }),
      h('aside', { id: 'drawer', 'aria-label': 'Library' }),
      h('div', { id: 'roster' }));
    root.append(rail, stage);
    els = {
      root, rail, stage, viewport: $('#viewport', stage), frame: $('#frame', stage), empty: $('#empty', stage),
      topbar: $('#topbar', stage), hint: $('#toolhint', stage), tctl: $('#table-ctl', stage), card: $('#token-card', stage),
      pop: $('#pop', stage), drawer: $('#drawer', stage), roster: $('#roster', stage),
    };
    // the "Preparing animations" pill (top centre) moves down below the top bar while that shows
    const topbarEdge = () => { const r = els.topbar.getBoundingClientRect(); document.documentElement.style.setProperty('--topbar-bottom', `${r.height ? Math.round(r.bottom) : 0}px`); };
    new ResizeObserver(topbarEdge).observe(els.topbar);
    window.addEventListener('resize', topbarEdge);
    view = new SceneView(els.viewport, { gm: true });
    view.on('render', () => { placeFrame(); placeCard(); updateBrushCursor(); });
    view.on('broken', () => { renderRoster(true); refreshPop(); checkMissingSoon(); });
    view.on('render', () => updateAssetGhost());
    view.on('render', () => { const hud = $('.tc-hud', els.tctl); if (hud && S) Tools.renderHud(hud); });
    // a new background is fitted to the table once, then stays put; with a grid (in its name or printed on it)
    // it arrives at real size instead: one square, one inch on the table
    view.on('pin', (p) => pinBackground(p));
    try { ui.rosterCollapsed = localStorage.getItem('rosterCollapsed') === '1'; } catch {}
    new ResizeObserver(() => placePop()).observe(els.pop);
    bindViewport();
    Bench.setStart(() => view.animMeasureStart());
    Bench.setInfo(() => ({ anim: view.animInfo(), motion: view.animMeasureStop() }));
    bindKeys();
    bindDrops();
    bindShowEnd();
    ts.onFog((d) => { SceneView.fogDelta(d, [view]); if (S && S.map && d.mapId === S.map.id) maybeBakeFog(S.map); });
    ts.onPing((p) => { if (S && p.mapId === S.editMapId) view.ping(p); });
    addEventListener('blur', () => Tools.spotOff());
    ts.onEvent((e) => {
      if (e.kind === 'strike' && S && (!e.mapId || e.mapId === S.editMapId)) view.strike(e.seed);
    });
    ts.onFps((r) => {
      const n = typeof r === 'number' ? r : r && r.fps;
      if (!Number.isFinite(n)) return;
      const el = $('.tc-fps', els.tctl);
      if (el) {
        el.textContent = `${n} fps`;
        el.classList.toggle('slow', n < slowBelow());
      }
      ui.tableFps = n;
      if (Date.now() - (ui.fpsSimAt || 0) < 15000) return; // the self-test is simulating the TV's frame rate
      fpsWatch(n, (r && r.hitches) || 0, (r && r.heavy) || null);
    });
    ts.onPreview((url) => {
      lastPreview = url;
      const img = $('#tc-preview', els.tctl); if (img) img.src = url;
      const rp = $('#pop .rp-img'); if (rp) rp.src = url;
      const big = $('.fp[data-id="preview"] .big-preview'); if (big) big.src = url;
    });
    setTool('select');
  }

  // =====================================================================
  // FPS watch: when the TV stutters for a while, offer lighter effects for that map
  // =====================================================================
  const hz = () => (S && S.view && S.view.hz) || 60;
  const slowBelow = () => Math.round(Math.min(hz(), 120) * 0.85);
  const fpsLog = []; // the last reports: { fps, hitches, t }
  const fpsSnooze = new Set(); // maps the GM said "Not now" for (this session)
  function fpsWatch(fps, hitches, heavy) {
    ui.fpsHeavy = heavy;
    // only reports while it watches count (turning the watch on starts afresh)
    if (!S || !S.table.open || S.table.blackout || !S.table.liveMapId || !S.settings || S.settings.fpsWatch === false) { fpsLog.length = 0; return; }
    fpsLog.push({ fps, hitches, t: Date.now() });
    while (fpsLog.length > 6) fpsLog.shift();
    const id = S.table.liveMapId;
    const q = S.settings.liveQuality || 'high';
    if (q === 'low' || fpsSnooze.has(id) || ui.fpsAsk) return;
    // five reports in a row (ten seconds): below 85 % of the TV's refresh rate, or frames that took too long
    const recent = fpsLog.slice(-5);
    if (recent.length < 5 || recent[0].t < Date.now() - 13000) return;
    const bad = recent.every((x) => x.fps < slowBelow() || x.hitches >= 3);
    if (bad) askLighter(id, Math.round(recent.reduce((a, x) => a + x.fps, 0) / recent.length), heavy, q);
  }
  function askLighter(mapId, fps, heavy, q) {
    const next = q === 'high' ? 'medium' : 'low';
    const name = S.table.liveName || 'this map';
    ui.fpsAsk = { mapId, next };
    const box = h('div', { class: 'fps-ask', role: 'alertdialog', 'aria-label': 'The TV is stuttering' },
      h('div', { class: 'fps-ask-text' }, iconEl('gauge'),
        h('span', {}, h('b', {}, `The TV is stuttering (${fps} fps).`), ` Switch ${name} to ${next === 'medium' ? 'Medium' : 'Low'} effects?`, heavy ? h('small', {}, `Heaviest here: ${heavy}`) : null)),
      h('div', { class: 'fps-ask-btns' },
        h('button', { class: 'btn small primary', onclick: () => { ts.settings({ mapQuality: { mapId, level: next } }); done(); toast(`${name} plays with ${next === 'medium' ? 'Medium' : 'Low'} effects (Options → Performance)`); } }, `Switch to ${next === 'medium' ? 'Medium' : 'Low'}`),
        h('button', { class: 'btn small ghost', onclick: () => { fpsSnooze.add(mapId); done(); } }, 'Not now')));
    const done = () => { box.remove(); ui.fpsAsk = null; fpsLog.length = 0; };
    els.tctl.after(box);
    placeFpsAsk();
  }
  function placeFpsAsk() {
    const box = $('.fps-ask', els.stage);
    if (!box) return;
    const r = els.tctl.getBoundingClientRect(); const sr = els.stage.getBoundingClientRect();
    box.style.top = `${Math.round(r.bottom - sr.top + 8)}px`;
    box.style.width = `${Math.max(240, Math.round(r.width))}px`;
  }

  // =====================================================================
  // State in
  // =====================================================================
  function update(s) {
    const prevMapId = S && S.map ? S.map.id : null;
    S = s;
    view.setView(s.view);
    const m = s.map;
    const switched = (m ? m.id : null) !== prevMapId;
    if (switched) {
      if (prevMapId && !view.cam.auto) cams.set(prevMapId, { s: view.cam.s, tx: view.cam.tx, ty: view.cam.ty });
      ui.selected = null; ui.selFx = null; ui.selSpell = null; ui.aimFrom = null;
      ui.expanded = null;
      pv = null;
    }
    const q = (s.settings && (s.settings.editQuality || s.settings.quality)) || 'high';
    FX.setQuality(q); Moments.setQuality(q); view.setQuality(q);
    view.setWide(wideFor(ui.tool));
    view.setAnimMode((s.settings && s.settings.gmAnim) || 'light');
    view.setFxMode((s.settings && s.settings.gmFx) || 'light'); // Prototype 19
    view.setDrawMode((s.settings && s.settings.animDraw) || 'cpu');
    // 4.10: Options → Tokens: their pictures' size, the selection ring
    view.setTokenLook(tokSet());
    document.body.classList.toggle('ring-glow', tokSet().ring === 'glow');
    if (typeof AnimCache === 'object') { AnimCache.setMemory(s.view && s.view.memGB); AnimCache.setIdleFree(((s.settings && s.settings.gmAnim) || 'light') === 'still'); }
    if (m) view.setMap(m); else view.clear();
    if (m) maybeBakeFog(m);
    // screen moments: those over the whole table show here while this map is the one on the table
    view.setMoments(s.moments || [], !!(m && s.table.liveMapId === m.id));
    view.setTrails(s.trails || []); // (Prototype 6: the squares a player walked this turn)
    // a campaign just opened: point out library files that are no longer where they were
    const opening = s.campaign ? `${s.campaign.id}:${s.campaign.opened}` : null;
    if (opening && opening !== ui.checkedCampaign) { ui.checkedCampaign = opening; setTimeout(checkMissing, 800); }
    if (switched) {
      const c = m && cams.get(m.id);
      if (c) view.setCamera(c); else view.fit();
      view.selectFx(null); view.selectSpell(null);
      if (m) view.setGhost(null);
    }
    if (ui.selected && !layer(ui.selected)) ui.selected = null;
    if (ui.selFx && !fxOf(ui.selFx)) { ui.selFx = null; view.selectFx(null); }
    if (ui.selAssets.some((id) => !layer(id))) setAssetSelection(ui.selAssets.filter((id) => layer(id) && !layer(id).locked));
    Tools.update();
    if (ui.selSpell && !spellOf(ui.selSpell)) { ui.selSpell = null; view.selectSpell(null); }
    view.setSelected(ui.selected);
    renderShow(s);
    if (s.editMapId !== ui.lastEditId) {
      ui.lastEditId = s.editMapId;
      const ch = chapterOfMap(s.editMapId);
      if (ch) ui.viewChapterId = ch.id;
    }
    if (!chapters().some((c) => c.id === ui.viewChapterId)) ui.viewChapterId = (chapterOfMap(s.editMapId) || chapters()[0] || {}).id;
    renderRail();
    renderRoster();
    renderTopbar();
    renderTableCtl();
    renderEmpty();
    if (Hot) { if (!Hot.el.isConnected && els.stage) els.stage.append(Hot.el); Hot.el.hidden = !m; Hot.render(); }
    placeFrame();
    placeCard();
    if (ui.drawer) Drawer.refreshPurpose();
    refreshPop();
  }

  // Beta 3.2: tokens shown to the table: a turning ring round them here, a pill at the top; a click anywhere or Esc
  // brings them back (right-click still opens a token's menu: more can join)
  let showPill = null; let showEat = 0;
  const showing = () => !!(S && S.show && S.show.phase === 'show');
  function renderShow(s) {
    const sh = s.show && s.show.phase === 'show' ? s.show : null;
    view.setOnShow(new Set(sh && sh.mapId === s.editMapId ? sh.ids : []));
    if (!sh) { if (showPill) { showPill.remove(); showPill = null; } return; }
    const live = s.map && s.map.id === sh.mapId ? s.map : null;
    const names = sh.ids.map((id) => { const l = live && live.layers.find((x) => x.id === id); return l ? `${l.name || 'Token'}${l.n ? ` ${l.n}` : ''}` : null; }).filter(Boolean);
    const text = names.length ? names.join(', ') : `${sh.ids.length} token${sh.ids.length === 1 ? '' : 's'}`;
    if (!showPill) { showPill = h('div', { class: 'anim-pill show-pill', role: 'button' }); document.body.append(showPill); }
    if (showPill.dataset.text === text) return;
    showPill.dataset.text = text;
    showPill.replaceChildren(iconEl('rotate-360'), h('span', {}, 'Showing ', h('b', {}, text)), h('span', { class: 'muted' }, 'Click or Esc: back'));
  }
  function bindShowEnd() {
    window.addEventListener('pointerdown', (e) => {
      if (!showing() || e.button !== 0 || (e.target.closest && e.target.closest('#radial'))) return;
      e.preventDefault(); e.stopPropagation();
      showEat = performance.now() + 1500; // (the click that follows does nothing else)
      cmd('show.end');
    }, true);
    window.addEventListener('click', (e) => { if (performance.now() < showEat && !(e.target.closest && e.target.closest('#radial'))) { showEat = 0; e.preventDefault(); e.stopPropagation(); } }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && showing()) { e.preventDefault(); e.stopPropagation(); cmd('show.end'); } }, true);
  }

  // =====================================================================
  // Rail, tools, popovers
  // =====================================================================
  function railClick(it, btn) {
    btn.blur(); // keyboard shortcuts keep working after a click
    if (it.id === 'home') { cmd('campaign.page'); return; }
    if (it.id === 'help') { App.toggleHelp(); return; }
    if (it.id === 'table') { closePop(); App.openOptions(); return; } // 4.3: Options (gm.js)
    if (it.id === 'library') { Drawer.toggle(); return; }
    if (it.id === 'build') { toggleBuild(); return; }
    if (it.id === 'undo' || it.id === 'redo') {
      const what = S && S.history ? S.history[`${it.id}Label`] : null;
      cmd(`history.${it.id}`).then((r) => { if (r && r.ok) toast(`${it.id === 'undo' ? 'Undone' : 'Redone'}: ${what || 'last change'}`, { ms: 1800 }); });
      return;
    }
    if (it.id === 'snaps') { if (Floats.isOpen('snaps')) Floats.hide('snaps'); else Snaps.openFor(null); renderRail(); return; }
    if (it.pin) { TB.togglePanel(it.pin); renderRail(); return; } // 4.3: a panel pinned to the rail
    if (it.id === 'toolbox' && popId !== 'toolbox') ui.tb = 'home';
    if (it.tool) {
      if (ui.tool === it.id && it.pop) { togglePop(it.id, btn); return; }
      setTool(it.id);
      if (it.pop) openPop(it.id, btn); else closePop();
      return;
    }
    togglePop(it.id, btn);
  }

  function setTool(t, opts = {}) {
    // 4.8: the Map tool in hand: both screens keep the fog ready for a move
    if ((t === 'map') !== (ui.tool === 'map')) { if (view) view.prepareMove(t === 'map'); cmd('move.prepare', { on: t === 'map' }); }
    ui.tool = t;
    if (t === 'fog' && opts.mode) ui.fogMode = opts.mode;
    document.body.dataset.tool = t;
    if (t !== 'select' && t !== 'token') { ui.selected = null; view.setSelected(null); }
    if (t !== 'fx') { ui.selFx = null; view.selectFx(null); }
    if (t !== 'spell' && t !== 'select') { ui.selSpell = null; view.selectSpell(null); }
    if (t !== 'spell') { ui.aimFrom = null; if (view.map) view.setGhost(null); }
    if (t !== 'asset') setAssetSelection([]);
    Tools.toolChanged(t);
    Walls.toolChanged(t);
    // effect markers: all of them in the Effects tool, party lights also while selecting
    view.setHandles(t === 'fx' ? 'all' : WallsTool.PLAY_TOOLS.includes(t) ? 'party' : false); // (Prototype 4: the party's marker in every Play tool)
    view.setWide(wideFor(t)); // (Prototype 5: the Build tools show the whole map with its light and effects)
    Party.toolChanged(t);
    view.setAreaMode(t === 'fog');
    if (t !== 'fog') { cancelArea(); view.setRoomPreview(null); }
    updateReadout();
    updateAssetGhost();
    placeCard();
    renderRail();
    refreshPop();
    updateBrushCursor();
    showToolHint(true);
  }

  const MAP_TOOLS = {
    'point:ping': { label: 'Ping', icon: 'target' }, 'point:laser': { label: 'Laser', icon: 'pointer' }, 'point:spot': { label: 'Spotlight', icon: 'focus-2' }, 'point:measure': { label: 'Ruler', icon: 'ruler-measure' },
    'draw:chalk': { label: 'Chalk', icon: 'scribble' }, 'draw:pen': { label: 'Pen', icon: 'ballpen' }, 'draw:text': { label: 'Text', icon: 'typography' }, 'draw:erase': { label: 'Erase', icon: 'eraser' },
    'mark:marker': { label: 'Marker', icon: 'map-pin' }, 'mark:counter': { label: 'Counter', icon: 'plus-minus' },
  };
  const TOOLBOX_TIP = 'Map tools and panels: pointer, draw, markers, initiative, sounds, screen effects and more';
  // 4.3: panels pinned to the rail: one click opens or closes them (right-click a panel in the Toolbox to pin it).
  // 4.3.1: Initiative is not one of them: it stays in the Toolbox (Fight), and I opens it.
  const UNPINNED = new Set(['init']);
  let pins = [];
  try { const v = JSON.parse(localStorage.getItem('railPins') || 'null'); if (Array.isArray(v)) pins = v.filter((x) => typeof x === 'string' && !UNPINNED.has(x)).slice(0, 6); } catch {}
  function togglePin(id) {
    if (UNPINNED.has(id)) return;
    const on = !pins.includes(id);
    if (on && pins.length >= 6) { toast('Six panels are on the rail already: take one off first (right-click it)', { kind: 'error', ms: 3500 }); return; }
    pins = on ? [...pins, id] : pins.filter((x) => x !== id);
    try { localStorage.setItem('railPins', JSON.stringify(pins)); } catch {}
    const p = TB.panelInfo(id);
    toast(on ? `${p ? p.label : id} is on the rail` : `${p ? p.label : id} is off the rail (still in the Toolbox)`, { ms: 2200 });
    renderRail(); refreshPop();
  }
  function renderPins() {
    const box = els.rail.querySelector('.rail-pins');
    if (!box) return;
    const sig = pins.join();
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.replaceChildren(...pins.map((id) => {
        const p = TB.panelInfo(id);
        if (!p) return null;
        const b = railBtn({ id: `pin-${id}`, pin: id, icon: p.icon, label: p.short || p.label, tip: `${p.label} (right-click: take it off the rail)` });
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [{ header: p.label }, { icon: 'pinned-off', label: 'Take off the rail', action: () => togglePin(id) }]); });
        return b;
      }).filter(Boolean));
    }
    for (const b of box.children) {
      const id = b.dataset.id.slice(4);
      b.classList.toggle('is-open', id === 'mapnotes' ? ui.tool === 'notes' : !!(Floats && Floats.isOpen(id)));
      b.classList.toggle('is-running', !!(S && TB.running(id)));
    }
  }
  function renderRail() {
    for (const b of els.rail.querySelectorAll('.rail-btn')) {
      if (b.closest('.rail-pins')) continue; // (renderPins: their own open and running state)
      const id = b.dataset.id;
      b.classList.toggle('is-tool', id === ui.tool);
      b.classList.toggle('is-open', id === popId || (id === 'library' && !!ui.drawer) || (id === 'snaps' && !!Floats && Floats.isOpen('snaps')));
    }
    // undo and redo say what they take back
    const hs = (S && S.history) || {};
    for (const [id, can, what, word] of [['undo', hs.canUndo, hs.undoLabel, 'Undo'], ['redo', hs.canRedo, hs.redoLabel, 'Redo']]) {
      const b = els.rail.querySelector(`.rail-btn[data-id="${id}"]`);
      if (!b) continue;
      b.classList.toggle('off', !can);
      b.setAttribute('aria-disabled', String(!can));
      b.dataset.tip = can ? `${word}: ${what || 'last change'}` : `Nothing to ${word.toLowerCase()} on this map`;
    }
    renderPins();
    fitRail();
    const fogBtn = els.rail.querySelector('[data-id="fog"] .rail-label');
    if (fogBtn) fogBtn.textContent = ui.tool === 'fog' ? (ui.fogMode === 'reveal' ? 'Reveal' : 'Cover') : 'Fog';
    // Point and Draw are in the Toolbox: while one of them is in use, the Toolbox button stays lit
    // and carries that tool's icon as a small badge
    const mapTool = ui.tool === 'point' || ui.tool === 'draw' || ui.tool === 'mark';
    const tbRail = els.rail.querySelector('[data-id="toolbox"]');
    if (tbRail) {
      tbRail.classList.toggle('is-tool', mapTool);
      const m = mapTool ? MAP_TOOLS[`${ui.tool}:${ui.tool === 'point' ? ui.point.mode : ui.tool === 'mark' ? (ui.mark.mode === 'counter' ? 'counter' : 'marker') : ui.draw.mode}`] : null;
      let badge = tbRail.querySelector('.rail-badge');
      if (!m) { if (badge) badge.remove(); tbRail.dataset.tip = TOOLBOX_TIP; }
      else if (!badge || badge.dataset.tool !== m.label) {
        if (badge) badge.remove();
        tbRail.append(h('span', { class: 'rail-badge', dataset: { tool: m.label } }, iconEl(m.icon)));
        tbRail.dataset.tip = `Toolbox · ${m.label} is in use (Esc: back to Select)`;
      }
    }
    const timerBtn = els.rail.querySelector('[data-id="timer"]');
    if (timerBtn) timerBtn.classList.toggle('is-running', !!(S && S.timer));
    const tbBtn = els.rail.querySelector('[data-id="toolbox"]');
    if (tbBtn) tbBtn.classList.toggle('is-running', !!(S && (S.timer || (S.init && S.init.running) || S.brk)));
    const talkBtn = els.rail.querySelector('[data-id="talk"]');
    if (talkBtn) talkBtn.classList.toggle('is-running', !!(S && S.talk));
    const g = els.rail.querySelector('.g-build');
    if (g) {
      const folded = buildFolded();
      g.classList.toggle('folded', folded);
      const head = g.querySelector('.rail-fold-btn');
      head.dataset.tip = folded ? '' : 'Fold the Build tools away';
    }
  }

  // 4.3: the handy things, behind the "?" in the title bar (a tutorial will show them later). 4.3.1: every panel has
  // them; the panels keep only what they need to work. A function gives the tips for the tab or mode that is open.
  const FOG_TIPS = ['[ and ] change the brush size.', 'Shift + drag draws a rectangle.', 'Right-click a room or a marked area to reveal it in one go.',
    'In Room mode, Shift + click marks the room as an area.', 'Marked areas are outlined only for you, never on the table.', 
    'Drag any of these onto the hotbar, or right-click one.'];
  const walled = () => !!(map() && map().walls.length && map().vision.on);
  const TIPS = {
    map: ['Drag the map to move it; Alt + wheel scales it. Fog, grid, tokens and effects move with it.', 
      'Colours change the picture and its assets only. Each map keeps its own.', 'Hold "original" to compare, here and on the table.',
      'Right-drag or Space-drag moves your view; F fits it to the table, Shift + F shows everything.'],
    fx: () => [...({
      place: ['Click the map to place it; click its marker to change it, drag to move it.', 'Torches, campfires and candles also light up a dark map.', 'Right-click a placed effect for more.'],
      paint: ['Paint over the map; [ and ] change the brush size.', 'Strokes of the same kind join one area until you press Start a new area.', 'Click an area\'s marker to change its look; right-click it to remove it.'],
      light: ui.lightTab === 'sources'
        ? ['Click the map to place a light, or click a token so it carries the light.', 'The party\'s own light is set in Play → Party marker (U).']
        : ['Darkness covers the whole map; lights, torches and campfires shine through it.', 'Remember lit areas: what the light reached stays dimly visible.', 'Day, Dusk, Night and Cave work on the hotbar and the button deck too.'],
      weather: ['Weather covers the whole table and stays put when you move the map.', 'With lightning in the mix, the Lightning button flashes it whenever you like.', 'Save a mix to use it on other maps.'],
    }[ui.fxMode] || [])],
    walls: () => [({
      wall: 'Click from corner to corner; double-click, Enter or right-click ends the line. Alt places freely.',
      room: 'Drag from one corner of a room to the other.',
      door: 'Click a wall: the square you clicked becomes a door. Or drag to draw one.',
      edit: 'Drag a corner dot or a whole wall to move it. Click a wall to select it; Delete removes it.',
      erase: 'Click a wall to remove it, or drag a box over several.',
    }[ui.walls && ui.walls.mode] || null), 'Players never see walls or door markers.', 'A click on a door opens or closes it; in the Play tools it asks first.',
    'Universal VTT maps bring their walls along.', 'W again switches to the next mode.'],
    party: () => ['Drag the party or click where it goes; arrow keys move it one square.',
      walled() ? 'Line of sight: they see what the walls allow.' : 'No walls (or line of sight off): they reveal a circle around them.',
      'What they revealed stays revealed, also when you remove the party.', 'A split group: Another party.'],
    spell: ['Click the map to cast; drag to aim a cone, line or cube.', 'Ctrl + wheel turns the area before you place it (Shift: small steps).', '+ and − change the size in 5 ft steps.',
      'Shift snaps the aim to 15°, Alt skips the grid.', 'Right-click a placed area for its options; H hides it from the players.', 'Drag a spell onto the hotbar to cast it with a number key.', 'Speakers and spell sounds: Options → Sound.'],
    asset: ['Click to stamp, drag to scatter.', 'Click a placed asset to select it; Shift + click or Shift + drag selects several.', 'Drag to move, Ctrl + wheel to turn, [ and ] to resize.',
      'Assets lie under tokens and only react while this tool is on.'],
    layers: ['Click a row to select it on the map; H hides it from the players.', 'Delete removes what is selected; Ctrl + Z brings it back.'],
    grid: ['First match the printed grid, then make the squares 1 inch so miniatures fit.', 'One cell is 5 ft.', 'G switches the grid on or off.'],
    sound: () => [...({
      chapter: ['It plays on every map of this chapter that has no sounds of its own.'],
      map: ['A map with its own sounds replaces the chapter ambience while it is on the table.', 'A video map\'s own sound has its row here too.'],
      combat: ['Fight music fades in over the ambience and out again when the fight ends.', 'Whether it starts and ends with Initiative: Options → Sound.', 'Music from Audio/Music fits well; a Spotify mood works too (Toolbox → Spotify).'],
    }[ui.soundTab] || []), 'Speakers and spell sounds: Options → Sound. Mute is under the table preview.'],
    token: ['Click the map to drop one, click again for more.', 'Drag a token to move it; right-click it for its options.', 'List … has every token: click to pick one up, tick to keep it ready here.',
      'Ctrl + D duplicates the selected token; Alt while dragging places it without snapping.'],
    point: () => [...({
      ping: ['Click to ping a spot, drag for a laser pointer.', 'Double-click with the Select tool also pings.'],
      laser: ['Move the mouse over the map: players see a red dot with a short trail.', 'Click to ping.'],
      spot: ['Move the mouse over the map: the table goes dark except around the pointer.', 'Leave the map or press Esc to turn it off.'],
      measure: ['Drag from one square to another; the ruler snaps to square centres.', 'Hold Alt to measure freely.'],
    }[ui.point && ui.point.mode] || []), 'P switches between Ping, Laser, Spotlight and Ruler.'],
    draw: () => [({
      chalk: 'Draw on the map to show something. Chalk fades after a few seconds.',
      pen: 'Draw on the map. Pen lines stay with the map (and move with it) until you erase them.',
      text: 'Click the map to write a label. Click a label to change it, drag it to move it.',
      erase: 'Drag over pen lines and labels to erase them. Ctrl + Z brings them back.',
    }[ui.draw && ui.draw.mode] || null), 'D switches between Chalk, Pen, Text and Erase.'],
    mark: () => (ui.mark && ui.mark.mode === 'counter'
      ? ['Click the map to place the counter. Its − and + work in every tool.', ui.mark.auto ? 'It moves on Next round; counting down stops at 0 and lights up.' : 'It changes only when you click − or +.']
      : ['Click the map to place it. Drag a marker to move it; click it for its options.', 'Numbered markers count up by themselves: 1, 2, 3 …']),
    notes: ['Click the map to pin a note only you see, e.g. "Silver key opens this door".', 'Drag a note to move it.'],
    timer: ['Normal: a round dial at a short end or in the middle of the TV.', 'Dramatic: a big number in the middle, pulsing darker towards zero.', 'A running dial can still move to another end.'],
    talk: ['Click a portrait to bring it in, click it again to take it out. The newest one stands in front.', 'With players on both long sides, the far side gets its own copy.',
      'List … has every portrait: click to bring one in, tick to keep it ready here.', 'The mirror button turns a portrait to face the other way.', 'The look of the band: Options → Looks.'],
    toolbox: ['P and D switch the map tools, X is the marker.', 'Right-click a panel to pin it to the rail or put it on the hotbar.'],
    round: ['Drag the badge over the picture of the TV.', 'With players on both long sides, the second badge follows, turned towards the far side.'],
  };
  // Prototype 25: the Guide's Help page shows every tip of every panel in one place (the "?" of a panel opens it there).
  // Tips that depend on a tab or a mode are collected for each of them; what all of them share comes last.
  const PLAYER_TIPS = ['Everything here belongs to the character and goes with them to every map.',
        'Sight: their token reveals the fog by its own line of sight, light and darkvision.',
        'While player tokens see for themselves, the single party marker on that map rests.',
        'HP and conditions live in the turn order: a player who is not in it gets the max HP here.'];
  const HELP_VARIANTS = {
    fx: [{ fxMode: 'place' }, { fxMode: 'paint' }, { fxMode: 'light', lightTab: 'sources' }, { fxMode: 'light', lightTab: 'dark' }, { fxMode: 'weather' }],
    walls: ['wall', 'room', 'door', 'edit', 'erase'].map((m) => ({ 'walls.mode': m })),
    sound: ['chapter', 'map', 'combat'].map((t) => ({ soundTab: t })),
    point: ['ping', 'laser', 'spot', 'measure'].map((m) => ({ 'point.mode': m })),
    draw: ['chalk', 'pen', 'text', 'erase'].map((m) => ({ 'draw.mode': m })),
    mark: [{ 'mark.mode': 'marker' }, { 'mark.mode': 'counter', 'mark.auto': true }, { 'mark.mode': 'counter', 'mark.auto': false }],
  };
  function allTips(id, tips) {
    if (typeof tips !== 'function') return (tips || []).filter(Boolean);
    const variants = HELP_VARIANTS[id] || [{}];
    const seen = new Map(); // tip → in how many variants
    for (const variant of variants) {
      const keep = {};
      try {
        for (const [path, v] of Object.entries(variant)) {
          const [top, sub] = path.split('.');
          if (!(top in keep)) keep[top] = { had: top in ui, val: ui[top] };
          if (sub) ui[top] = { ...(ui[top] || {}), [sub]: v }; else ui[top] = v;
        }
        for (const t of new Set((tips() || []).filter(Boolean))) seen.set(t, (seen.get(t) || 0) + 1);
      } catch { /* a tip list that needs a map: leave it out */ } finally {
        for (const [top, k] of Object.entries(keep)) { if (k.had) ui[top] = k.val; else delete ui[top]; }
      }
    }
    const shared = variants.length > 1 ? [...seen].filter(([, n]) => n === variants.length).map(([t]) => t) : [];
    return [...[...seen.keys()].filter((t) => !shared.includes(t)), ...shared];
  }
  function helpSections() {
    const out = [];
    const add = (title, tips, id) => { const list = allTips(id, tips); if (list.length && !out.some((x) => x.title === title)) out.push({ title, tips: list }); };
    for (const [id, pdef] of Object.entries(POPS)) add(pdef.title, pdef.tips, id);
    for (const x of TB.PANELS) { const tips = TB.PANEL_TIPS[x.id]; if (tips) add(x.label, tips, x.id); }
    add('Snapshots', Snaps.def().tips, 'snaps');
    add('Player tokens', PLAYER_TIPS, 'player');
    return out;
  }
  // Prototype 25: one line with what you cannot guess, shown for a few seconds when a tool is picked (Options → This screen)
  const TOOL_HINTS = {
    map: 'Drag moves the map · Alt + wheel scales it · Space-drag moves your view',
    fx: () => ({ place: 'Click places it · drag its marker to move it · right-click for more', paint: '[ and ] change the brush size', light: 'Click the map or a token to place a light', weather: '' }[ui.fxMode] || ''),
    asset: 'Click stamps · drag scatters · Ctrl + wheel turns · [ and ] resize · Shift + click selects several',
    walls: () => ({ wall: 'Click corner to corner · double-click ends · Alt places freely', room: 'Drag from corner to corner', door: 'Click a wall for a door', edit: 'Drag a corner or a wall · Delete removes', erase: 'Click a wall, or drag a box' }[ui.walls && ui.walls.mode] || ''),
    token: 'Click drops one · Alt places freely · Ctrl + D duplicates',
    fog: '[ and ] brush size · Shift + drag: rectangle · right-click a room reveals it',
    party: 'Drag it or click where it goes · arrow keys: one square',
    spell: 'Drag aims · Ctrl + wheel turns · + and − size · Shift snaps to 15° · Alt skips the grid',
    point: () => ({ ping: 'Click pings · drag: laser', laser: 'Move the mouse · click pings', spot: 'Move the mouse · Esc ends it', measure: 'Drag between squares · Alt measures freely' }[ui.point && ui.point.mode] || ''),
    draw: () => ({ chalk: 'Draw · chalk fades by itself', pen: 'Draw · pen lines stay with the map', text: 'Click to write · drag a label to move it', erase: 'Drag over lines and labels' }[ui.draw && ui.draw.mode] || ''),
    mark: 'Click places it · drag moves it · click it for its options',
    notes: 'Click pins a note only you see · drag moves it',
  };
  let hintT = 0; let hintSig = '';
  const hintsOn = () => { try { return localStorage.getItem('toolHints') !== '0'; } catch { return true; } };
  function showToolHint(force) {
    const el = els && els.hint;
    if (!el) return;
    const h0 = TOOL_HINTS[ui.tool];
    const text = hintsOn() ? (typeof h0 === 'function' ? h0() : h0) || '' : '';
    const sig = `${ui.tool}|${text}`;
    if (!force && sig === hintSig) return;
    hintSig = sig;
    clearTimeout(hintT);
    if (!text) { el.classList.remove('on'); return; }
    el.replaceChildren(...text.split(' · ').flatMap((part, i) => [i ? h('i', {}, '·') : null, h('span', {}, part)]).filter(Boolean));
    el.classList.add('on');
    hintT = setTimeout(() => el.classList.remove('on'), 7000);
  }
  const POPS = {
    map: { title: 'Map', icon: 'map-2', build: buildMapPop, tips: TIPS.map },
    fog: { title: 'Fog of war', icon: 'cloud-fog', build: buildFogPop, tips: FOG_TIPS },
    fx: { title: 'Effects', icon: 'flame', build: buildFxPop, tips: TIPS.fx },
    walls: { title: 'Walls and doors', icon: 'wall', build: () => Walls.buildPop(), tips: TIPS.walls },
    party: { title: 'Party marker', icon: 'users-group', build: () => Party.buildPop(), tips: TIPS.party },
    spell: { title: 'Spells', icon: 'wand', build: buildSpellPop, tips: TIPS.spell },
    asset: { title: 'Assets', icon: 'trees', build: buildAssetPop, tips: TIPS.asset },
    layers: { title: 'Layers', icon: 'stack-2', build: buildLayersPop, tips: TIPS.layers },
    grid: { title: 'Grid', icon: 'grid-4x4', build: buildGridPop, tips: TIPS.grid },
    sound: { title: 'Ambience', icon: 'volume', build: buildSoundPop, tips: TIPS.sound },
    token: { title: 'Tokens', icon: 'user-plus', build: () => Tools.buildTokenPop(), tips: TIPS.token },
    point: { title: 'Point', icon: 'target', build: () => Tools.buildPointPop(), tips: TIPS.point },
    draw: { title: 'Draw', icon: 'scribble', build: () => Tools.buildDrawPop(), tips: TIPS.draw },
    mark: { title: 'Markers and counters', icon: 'map-pin', build: () => Tools.buildMarkPop(), tips: TIPS.mark },
    notes: { title: 'Map notes (only you see them)', icon: 'note', build: () => Tools.buildNotesPop(), tips: TIPS.notes },
    timer: { title: 'Countdown', icon: 'hourglass', build: () => Tools.buildTimerPop(), tips: TIPS.timer },
    talk: { title: 'Conversation', icon: 'messages', build: () => TB.buildTalkPop(), tips: TIPS.talk },
    toolbox: { title: 'Toolbox', icon: 'briefcase', build: () => TB.buildToolbox(), tips: TIPS.toolbox },
    round: { title: 'Round on the table', icon: 'swords', build: buildRoundPop, tips: TIPS.round },
  };
  // Where the round shows on the TV: drag the badge over a picture of the TV; the far side's copy follows,
  // mirrored through the middle of the table.
  function buildRoundPop() {
    const look = () => (S.settings && S.settings.round) || { x: 0.07, y: 0.07, size: 1.4, banner: true };
    const both = () => !S.settings || S.settings.seats !== 'one';
    const w = S.view && S.view.world ? S.view.world.w : 16; const hh = S.view && S.view.world ? S.view.world.h : 9;
    const img = h('img', { class: 'rp-img', alt: '', src: lastPreview || '' });
    const n = () => String((S.combat && S.combat.n) || 1);
    const near = h('div', { class: 'rp-badge near', 'data-tip': 'Drag to move it' }, h('span', {}, 'R'), h('b', {}));
    const far = h('div', { class: 'rp-badge far' }, h('span', {}, 'R'), h('b', {}));
    const box = h('div', { class: 'round-place', style: { aspectRatio: `${w} / ${hh}` } }, img, near, far);
    let drag = null; let local = null;
    const put = (L) => {
      near.style.left = `${L.x * 100}%`; near.style.top = `${L.y * 100}%`;
      far.style.left = `${(1 - L.x) * 100}%`; far.style.top = `${(1 - L.y) * 100}%`;
      far.hidden = !both();
      for (const b of [near, far]) b.querySelector('b').textContent = n();
    };
    bind(() => { if (!drag) put(local && Date.now() - local.t < 800 ? local : look()); });
    near.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      near.setPointerCapture(e.pointerId);
      drag = true;
      const move = (ev) => {
        const r = box.getBoundingClientRect();
        local = { x: round(clamp((ev.clientX - r.left) / r.width, 0, 1), 3), y: round(clamp((ev.clientY - r.top) / r.height, 0, 1), 3), t: Date.now() };
        put(local);
        sendSettings({ roundPos: { x: local.x, y: local.y } });
      };
      const up = () => { drag = false; near.removeEventListener('pointermove', move); near.removeEventListener('pointerup', up); near.removeEventListener('pointercancel', up); };
      near.addEventListener('pointermove', move); near.addEventListener('pointerup', up); near.addEventListener('pointercancel', up);
    });
    const spot = (x, y) => () => { local = { x, y, t: Date.now() }; put(local); ts.settings({ roundPos: { x, y } }); };
    const cb = () => S.combat;
    return h('div', { class: 'stack' },
      box,
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: spot(0.07, 0.07), 'data-tip': 'Top left, and bottom right for the far side' }, 'Corners'),
        h('button', { class: 'chip', onclick: spot(0.5, 0.07), 'data-tip': 'The middle of the long edges' }, 'Long edges'),
        h('button', { class: 'chip', onclick: spot(0.06, 0.5), 'data-tip': 'The middle of the short ends' }, 'Short ends'),
        h('button', { class: 'chip', onclick: spot(0.5, 0.42), 'data-tip': 'Near the middle of the table' }, 'Middle')),
      slider({ label: 'Size', min: 0.6, max: 3, step: 0.05, get: () => look().size, set: (v) => sendSettings({ roundSize: v }), fmt: (v) => `${Math.round(v * 100)}%` }),
      toggle({ label: 'Players see the round', get: () => !!(cb() && cb().show), set: (v) => { if (cb()) cmd('round.set', { mapId: cb().mapId, show: v }); } }));
  }
  function openPop(id, anchor) {
    if (!POPS[id] || !S) return;
    if (id !== 'toolbox' || popId !== 'toolbox') popTicker = null;
    if (id === 'toolbox' && popId !== 'toolbox' && !anchor && !ui.tbKeep) ui.tb = ui.tb || 'home';
    if (ui.drawer) Drawer.close();
    const scroll = popId === id ? els.pop.scrollTop : 0;
    popId = id;
    refreshers = [];
    const p = POPS[id];
    els.pop.innerHTML = '';
    // a panel that fails to build still opens, with a note (2.4: before, it stayed invisible); the error goes into the log
    let body;
    try { body = p.build(); } catch (err) {
      console.error(`panel ${id}: ${err && err.stack ? err.stack : err}`);
      refreshers = [];
      body = h('div', { class: 'stack' }, hint('This panel ran into a problem. Close it and try again (the log: Guide → Report a problem).'));
    }
    els.pop.append(
      h('div', { class: 'pop-head' }, iconEl(p.icon), h('span', { class: 'pop-title' }, p.title),
        p.tips ? UI.helpTip(p.title, p.tips) : null, // 4.3: a "?" with the handy things
        h('button', { class: 'icon-btn', 'aria-label': 'Close', 'data-tip': 'Close', 'data-key': 'Esc', onclick: closePop }, iconEl('x'))),
      h('div', { class: 'pop-body' }, body));
    els.pop.classList.add('on');
    const btn = anchor && anchor.offsetParent ? anchor : railButton(id);
    popWant = btn.getBoundingClientRect().top - els.stage.getBoundingClientRect().top - 6;
    els.pop.style.left = '10px';
    placePop();
    els.pop.scrollTop = scroll;
    renderRail();
  }
  // level with its rail button where it fits, but always above the map bar (also when it grows)
  let popWant = 10;
  function placePop() {
    if (!popId) return;
    const sr = els.stage.getBoundingClientRect();
    const roster = els.roster ? els.roster.getBoundingClientRect().height : 0;
    const ph = els.pop.getBoundingClientRect().height;
    els.pop.style.top = `${clamp(popWant, 10, Math.max(10, sr.height - roster - ph - 12))}px`;
  }
  function togglePop(id, btn) { if (popId === id) closePop(); else openPop(id, btn); }
  function closePop() {
    popId = null;
    popTicker = null;
    if (ui.tb && ui.tb !== 'home') ui.tb = 'home'; // the toolbox opens on its tiles next time
    refreshers = [];
    els.pop.classList.remove('on');
    els.pop.innerHTML = '';
    renderRail();
  }
  function refreshPop() {
    showToolHint(false); // (a tab or a mode of the tool changed: its hint follows)
    if (Floats && S && S.map) Floats.refresh();
    if (!popId) return;
    if (!S || !S.map) { closePop(); return; }
    for (const f of refreshers) f();
  }
  function bind(fn) { refreshers.push(fn); fn(); }

  // ---------- controls ----------
  function slider(o) {
    const out = h('output');
    const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 0.01, 'aria-label': o.label });
    const key = `sl-${o.label}-${Math.random().toString(36).slice(2, 6)}`;
    input.addEventListener('input', () => { const v = Number(input.value); out.textContent = o.fmt ? o.fmt(v) : v; o.set(v, key); });
    bind(() => {
      const v = o.get();
      if (v == null) return;
      if (document.activeElement !== input) input.value = v;
      out.textContent = o.fmt ? o.fmt(Number(input.value)) : input.value;
    });
    return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, o.label), input, out);
  }
  function toggle(o) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => o.set(input.checked));
    bind(() => { input.checked = !!o.get(); });
    return h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, o.label), input, h('span', { class: 'switch' }));
  }
  function seg(o) {
    const wrap = h('div', { class: `seg ${o.cls || ''}`, role: 'radiogroup', 'aria-label': o.label || '' });
    for (const opt of o.options) {
      wrap.append(h('button', {
        class: 'seg-btn', role: 'radio', dataset: { v: String(opt.value) }, 'data-tip': opt.tip || null, 'data-key': opt.key || null,
        'aria-label': opt.label || opt.tip || String(opt.value),
        onclick: () => { o.set(opt.value); paint(); }, // (Beta 3.1: shown at once, also when the choice only lives in the panel)
      }, opt.icon ? iconEl(opt.icon, opt.iconCls) : null, opt.label ? h('span', {}, opt.label) : null));
    }
    const paint = () => { const v = String(o.get()); for (const b of wrap.children) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); } };
    bind(paint);
    return o.label ? h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, o.label), wrap) : wrap;
  }
  // a row of big icon tiles to pick a preset
  function tiles(list, get, set) {
    const wrap = h('div', { class: 'tiles' });
    for (const it of list) {
      wrap.append(h('button', { class: 'tile', dataset: { v: it.id }, 'data-tip': it.tip || null, 'aria-label': it.label, onclick: () => { set(it.id); paint(); } },
        iconEl(it.icon), h('span', {}, it.label)));
    }
    const paint = () => { const v = get(); for (const b of wrap.children) b.classList.toggle('on', b.dataset.v === v); };
    bind(paint);
    return wrap;
  }
  function stepper(o) {
    const out = h('output');
    const lab = h('span', { class: 'ctl-label' });
    const minus = h('button', { class: 'icon-btn', 'aria-label': `${o.name} smaller`, 'data-tip': o.minusTip || 'Smaller', 'data-key': o.minusKey || null, onclick: () => o.set(o.prev(o.get())) }, iconEl('minus'));
    const plus = h('button', { class: 'icon-btn', 'aria-label': `${o.name} bigger`, 'data-tip': o.plusTip || 'Bigger', 'data-key': o.plusKey || null, onclick: () => o.set(o.next(o.get())) }, iconEl('plus'));
    bind(() => { lab.textContent = typeof o.label === 'function' ? o.label() : o.label; out.textContent = o.fmt(o.get()); });
    return h('div', { class: 'ctl ctl-stepper' }, lab, h('div', { class: 'stepper' }, minus, out, plus));
  }
  const btn = (label, iconName, onclick, opts = {}) => h('button', { class: `btn ${opts.kind || ''}`, onclick, 'data-tip': opts.tip || null, 'data-key': opts.key || null }, iconName ? iconEl(iconName) : null, label);
  const row = (...kids) => h('div', { class: 'ctl-row' }, ...kids);
  const hint = (text) => h('p', { class: 'hint' }, text);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const sep = () => h('div', { class: 'pop-sep' });

  // ---------- map popover ----------
  function buildMapPop() {
    if (!ui.turnMode) { try { ui.turnMode = localStorage.getItem('turnMode') === 'picture' ? 'picture' : 'all'; } catch { ui.turnMode = 'all'; } }
    const name = h('span', { class: 'ellipsis grow' });
    bind(() => { const bg = map() && map().bg; name.textContent = bg ? bg.name + (view.broken.has('bg') ? ' (file missing)' : '') : 'No background yet'; name.classList.toggle('danger-text', view.broken.has('bg')); });
    const videoBox = h('div', { class: 'stack' },
      slider({ label: 'Speed', min: 0.25, max: 2, step: 0.05, get: () => map().bg && map().bg.rate, set: (v, k) => send(k, 'bg.update', { rate: v }), fmt: (v) => `${round(v, 2)}×` }));
    bind(() => { videoBox.hidden = !(map().bg && map().bg.kind === 'video'); });
    const tip = (el, t) => { el.dataset.tip = t; return el; };
    const size = tip(slider({
      // relative to "fit to table": 0 = fit, +1 = twice as big
      label: 'Size', min: -2, max: 3, step: 0.01,
      get: () => { const f = fitView(); return f ? Math.log2(zoom() / f.zoom) : null; },
      set: (v, k) => { const f = fitView(); if (f) zoomAround(f.zoom * 2 ** v, null, k); },
      fmt: () => { const p = view.bgPlacement(); return p ? `${round(p.w * curView().zoom, 1)} × ${round(p.h * curView().zoom, 1)}″` : ''; },
    }), 'Drag the map to move it, Alt + wheel to scale it');
    // turning: the slider, quarter turns, back to 0°, straighten to the grid, and what turns along
    const turn = tip(slider({ label: 'Turn', min: -180, max: 180, step: 0.5, get: () => (map().bg ? view.bgTurn() : null), set: (v, k) => turnMap(v, k), fmt: (v) => `${round(v, 1)}°` }),
      'Any angle. Ctrl + wheel over the map: 15°, with Shift 1°');
    const zero = btn('0°', 'arrow-back-up', () => turnMap(0), { tip: 'Back to 0°' });
    bind(() => { zero.disabled = !map().bg || !view.bgTurn(); });
    const straight = btn('Straighten to the grid', 'grid-4x4', straighten, { kind: 'wide', tip: 'Turns the map so its grid runs along the table edges' });
    bind(() => { straight.hidden = !map().bg || Math.abs(gridTilt()) < 0.05; });
    const quarter = row(
      btn('90°', 'rotate', () => turnMap(view.bgTurn() - 90), { tip: 'A quarter turn to the left' }),
      btn('90°', 'rotate-clockwise', () => turnMap(view.bgTurn() + 90), { tip: 'A quarter turn to the right' }),
      zero);
    const mode = seg({ label: 'Turns', cls: 'seg-2', options: [
      { value: 'all', label: 'Everything', tip: 'Everything on the map turns together' },
      { value: 'picture', label: 'Only the picture', tip: 'Only the picture turns; what you placed stays where it is' }],
    get: () => ui.turnMode, set: (v) => { ui.turnMode = v; try { localStorage.setItem('turnMode', v); } catch {} refreshPop(); } });
    const turnBox = h('div', { class: 'stack' }, turn, quarter, straight, mode);
    bind(() => { turnBox.hidden = !map().bg; });
    return h('div', { class: 'stack map-pop' },
      h('div', { class: 'row map-pop-head', dataset: { flash: 'bg' } }, iconEl('photo'), name,
        btn('Replace', 'refresh', () => Drawer.open({ filter: 'maps', purpose: 'replace', back: { pop: 'map' } }), { kind: 'small', tip: 'Pick another picture for this map' })),
      size,
      row(
        btn('Fit to table', 'maximize', () => { const f = fitView(); if (f) cmd('view.update', f); }, { tip: 'Show the whole map on the table' }),
        btn('Grid squares = 1 inch', 'ruler-measure', oneInch, { tip: 'Scale the map so one grid cell is one inch on the table' })),
      sep(),
      buildLookBox(),
      sep(),
      turnBox,
      videoBox);
  }
  // 4.5: the map's colours: presets, four sliders, hold to see the original (on this screen and the TV)
  const LOOK_PRESETS = [
    { id: 'natural', label: 'Natural', tip: 'The picture as it is', v: null },
    { id: 'vivid', label: 'Vivid', tip: 'Richer colours, a little more contrast', v: { bright: 1.03, contrast: 1.12, sat: 1.4, warm: 0.05 } },
    { id: 'muted', label: 'Muted', tip: 'Softer, quieter colours', v: { bright: 0.98, contrast: 0.92, sat: 0.6, warm: 0 } },
    { id: 'grim', label: 'Grim', tip: 'Darker, colder, drained: a place where something went wrong', v: { bright: 0.8, contrast: 1.15, sat: 0.45, warm: -0.3 } },
    { id: 'sepia', label: 'Sepia', tip: 'An old picture: warm and nearly without colour', v: { bright: 1, contrast: 1.02, sat: 0.2, warm: 0.75 } },
    { id: 'cold', label: 'Cold', tip: 'Winter, a frozen cave, the north', v: { bright: 0.96, contrast: 1.05, sat: 0.8, warm: -0.65 } },
  ];
  let lookSwatches = null;
  function lookSwatchDefs() { // the presets' own filters, for their little sample chips
    if (lookSwatches) return;
    const NS = 'http://www.w3.org/2000/svg';
    lookSwatches = document.createElementNS(NS, 'svg');
    lookSwatches.setAttribute('width', '0'); lookSwatches.setAttribute('height', '0'); lookSwatches.style.position = 'absolute';
    for (const P of LOOK_PRESETS) {
      const m = SceneView.lookOf(P.v);
      if (!m) continue;
      const f = document.createElementNS(NS, 'filter'); f.id = `look-chip-${P.id}`; f.setAttribute('color-interpolation-filters', 'sRGB');
      const cm = document.createElementNS(NS, 'feColorMatrix'); cm.setAttribute('type', 'matrix'); cm.setAttribute('values', m.join(' '));
      f.append(cm); lookSwatches.append(f);
    }
    document.body.append(lookSwatches);
  }
  function buildLookBox() {
    lookSwatchDefs();
    const L = () => (map() && map().look) || {};
    const val = (k, d) => { const v = L()[k]; return Number.isFinite(v) ? v : d; };
    const presets = h('div', { class: 'look-presets' }, ...LOOK_PRESETS.map((P) => h('button', { class: 'look-chip', dataset: { v: P.id }, 'data-tip': P.tip,
      onclick: () => (P.v ? cmd('bg.look', { ...P.v, preset: P.id }) : cmd('bg.look', { reset: true })) },
    h('i', { style: P.v ? `filter:url(#look-chip-${P.id})` : '' }), h('span', {}, P.label))));
    bind(() => { const cur = map() && map().look ? map().look.preset || 'custom' : 'natural'; for (const b of presets.children) b.classList.toggle('on', b.dataset.v === cur); });
    const pct = (v) => `${Math.round(v * 100)}%`;
    const sl = (label, k, min, max, d, fmt, tip) => { const e = slider({ label, min, max, step: 0.01, get: () => val(k, d), set: (v, key) => send(key, 'bg.look', { [k]: v }), fmt }); if (tip) e.dataset.tip = tip; return e; };
    const peek = (on) => { view.setPeek(on); cmd('look.peek', { on }); peekBtn.classList.toggle('on', on); };
    const peekBtn = btn('Hold: original', 'eye', () => {}, { tip: 'Hold the button to see the map without its colours, here and on the table' });
    peekBtn.addEventListener('pointerdown', (e) => { if (e.button === 0) { peekBtn.setPointerCapture(e.pointerId); peek(true); } });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) peekBtn.addEventListener(t, () => { if (view.peek) peek(false); });
    const reset = btn('Reset', 'arrow-back-up', () => cmd('bg.look', { reset: true }), { tip: 'The picture as it is' });
    const box = h('div', { class: 'stack look-box' },
      h('div', { class: 'ctl-label' }, 'Colours'),
      presets,
      sl('Brightness', 'bright', 0.4, 1.6, 1, pct),
      sl('Contrast', 'contrast', 0.5, 1.6, 1, pct),
      sl('Saturation', 'sat', 0, 2, 1, (v) => (v < 0.01 ? 'Grey' : pct(v))),
      sl('Warmth', 'warm', -1, 1, 0, (v) => (Math.abs(v) < 0.01 ? 'Neutral' : v > 0 ? `Warmer ${Math.round(v * 100)}` : `Cooler ${Math.round(-v * 100)}`), 'Left: cooler, bluer. Right: warmer, more golden'),
      row(peekBtn, reset));
    bind(() => { box.hidden = !(map() && map().bg); const plain = !(map() && map().look); reset.disabled = plain; peekBtn.disabled = plain; });
    return box;
  }
  // Turn the map to an angle: everything around the middle of the table, or only the picture around its centre.
  function turnMap(to, key) {
    const m = map();
    const p = view.bgPlacement();
    if (!m || !m.bg || !p) return;
    const t = view.tableRectInMap();
    const payload = { to: normAngle(to), mode: ui.turnMode === 'picture' ? 'picture' : 'all', center: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, pivot: { x: t.x + t.w / 2, y: t.y + t.h / 2 } };
    if (key) send(key, 'bg.turn', payload); else cmd('bg.turn', payload);
  }
  // the map's grid runs along the table edges: everything turns by the grid's tilt (the grid ends at 0°)
  // how far the grid is off the table edges (a square grid repeats every 90°, a hex grid every 60°)
  function gridTilt() {
    const g = grid(); const per = g.type === 'square' ? 90 : 60;
    let a = (((g.angle || 0) % per) + per) % per;
    if (a > per / 2) a -= per;
    return a;
  }
  function straighten() {
    const a = gridTilt();
    if (!map().bg || Math.abs(a) < 0.05) return;
    const p = view.bgPlacement(); const t = view.tableRectInMap();
    cmd('bg.turn', { to: normAngle(view.bgTurn() - a), mode: 'all', center: { x: p.x + p.w / 2, y: p.y + p.h / 2 }, pivot: { x: t.x + t.w / 2, y: t.y + t.h / 2 } })
      .then((r) => r && r.ok !== false && toast('Straightened: the grid runs along the table edges', { undo: () => cmd('history.undo', { mapId: S.editMapId }) }));
  }

  // The view that shows the whole background on the table.
  function fitView() {
    const p = view.bgBox();
    if (!p) return null;
    const t = tableIn();
    const z = Math.min(t.w / p.w, t.h / p.h);
    return { zoom: z, x: (t.w - p.w * z) / 2 - p.x * z, y: (t.h - p.h * z) / 2 - p.y * z };
  }
  // Zoom the map so the point under `at` (table inches) stays put.
  function zoomAround(z, at, key) {
    const v = curView();
    z = clamp(z, 0.05, 20);
    const t = tableIn();
    const c = at || { x: t.w / 2, y: t.h / 2 };
    const mx = (c.x - v.x) / v.zoom; const my = (c.y - v.y) / v.zoom;
    sendView(key || 'view-zoom', { zoom: z, x: c.x - mx * z, y: c.y - my * z });
  }
  function oneInch() {
    if (!S.map) return;
    zoomAround(1 / grid().size, null, `one-inch-${Date.now()}`);
    toast('Map scaled: one grid cell is now one inch on the table.', { undo: () => cmd('history.undo') });
  }

  // ---------- fog popover ----------
  function buildFogPop() {
    return h('div', { class: 'stack' },
      Hotbar.offer(toggle({ label: 'Fog on this map', get: () => map().fog.enabled, set: (v) => cmd('fog.enabled', { enabled: v }) }), fogHot('toggle')),
      hotTiles(seg({ options: [{ value: 'reveal', label: 'Reveal', icon: 'eye', key: 'R' }, { value: 'cover', label: 'Cover', icon: 'eye-off', key: 'C' }], get: () => ui.fogMode, set: (v) => { ui.fogMode = v; setTool('fog'); } }), fogHot),
      (() => {
        const shape = seg({ label: 'Shape', options: [{ value: 'brush', label: 'Brush', icon: 'brush' }, { value: 'rect', label: 'Rectangle', icon: 'square', tip: 'Or hold Shift while dragging' },
          { value: 'room', label: 'Room', icon: 'door', tip: 'Click inside a room: it opens up to its walls and closed doors (needs walls, W)' }],
        get: () => (ui.fogShape === 'area' ? 'room' : ui.fogShape), set: (v) => setFogShape(v) });
        hotTiles(shape.querySelector('.seg'), fogHot);
        return shape;
      })(),
      slider({ label: 'Brush size', min: 0.5, max: 8, step: 0.25, get: () => ui.brushIn, set: (v) => { ui.brushIn = v; updateBrushCursor(); }, fmt: (v) => `${v}″` }),
      row(Hotbar.offer(btn('Cover all', 'eye-off', () => undoable('fog.base', { base: 'cover' })), fogHot('cover-all')), Hotbar.offer(btn('Reveal all', 'eye', () => undoable('fog.base', { base: 'clear' })), fogHot('reveal-all'))),
      sep(),
      areaSection());
  }

  function setFogShape(v) {
    if (v === 'area' && ui.fogShape !== 'area') ui.fogShapeBefore = ui.fogShape; // back to it once the area is marked
    ui.fogShape = v;
    if (v !== 'area') cancelArea();
    view.setRoomPreview(null);
    refreshPop(); updateBrushCursor();
  }

  // ---------- rooms and marked areas: revealed in one click ----------
  const roomCache = { key: '', res: null, sig: '' };
  // the walled room around a spot (or null): an already found room answers for every spot inside it
  function roomAt(pt) {
    const m = map();
    if (!m || !m.walls || m.walls.length < 3) return null;
    const sig = `${m.id}|${Vision.wallSig(m)}`;
    const c = (m.grid.size || 1) / 8;
    const key = `${sig}|${Math.floor(pt.x / c)},${Math.floor(pt.y / c)}`;
    if (roomCache.key === key) return roomCache.res;
    if (roomCache.sig === sig && roomCache.res && Vision.inRings(roomCache.res.rings, pt.x, pt.y)) return roomCache.res;
    const res = Vision.room(m, pt.x, pt.y);
    Object.assign(roomCache, { key, res, sig });
    return res;
  }
  // the marked area under a spot (the last marked wins where they overlap)
  const areaAt = (pt) => [...(map().areas || [])].reverse().find((a) => Vision.inRings(a.rings, pt.x, pt.y)) || null;
  function revealRings(rings, mode, at, name) {
    return cmd('fog.op', { mode, shape: 'poly', rings, anim: at ? { x: at.x, y: at.y } : null, name: name || null });
  }
  async function markArea(rings, suggest) {
    const n = (map().areas || []).length + 1;
    const name = await askText('Name this area', suggest || `Area ${n}`, { ok: 'Mark it' });
    if (!name) return;
    const r = await cmd('area.add', { name, rings });
    if (r && r.ok) toast(`${name} marked: right-click inside it to reveal it`, { ms: 4500 });
  }
  // drawing an area: click its corners, double-click or Enter to finish
  function addAreaPoint(pt) {
    ui.areaPts = ui.areaPts || [];
    const n = ui.areaPts.length;
    if (n >= 2 && Math.hypot(pt.x - ui.areaPts[n - 2], pt.y - ui.areaPts[n - 1]) < grid().size * 0.08) return; // the second click of a double-click
    ui.areaPts.push(round(pt.x, 3), round(pt.y, 3));
    view.setAreaDraft(ui.areaPts.slice());
  }
  function finishArea() {
    const pts = ui.areaPts;
    if (!pts) return false;
    ui.areaPts = null;
    view.setAreaDraft(null);
    if (pts.length >= 6) { markArea([pts]); setFogShape(ui.fogShapeBefore || 'brush'); } else toast('An area needs at least three corners.');
    return true;
  }
  function cancelArea() { if (ui.areaPts) { ui.areaPts = null; view.setAreaDraft(null); } }
  let roomHover = 0;
  function fogHover(pt) {
    if (ui.fogShape === 'area') { if (ui.areaPts) view.setAreaDraft([...ui.areaPts, pt.x, pt.y]); return; }
    if (ui.fogShape !== 'room') return;
    clearTimeout(roomHover);
    roomHover = setTimeout(() => {
      if (ui.tool !== 'fog' || ui.fogShape !== 'room') return;
      const r = roomAt(pt);
      view.setRoomPreview(r ? { rings: r.rings, mode: ui.fogMode } : null);
    }, 90);
  }
  function areaSection() {
    const list = h('div', { class: 'area-list' });
    bind(() => {
      const areas = map().areas || [];
      const sig = JSON.stringify(areas.map((a) => [a.id, a.name]));
      if (list.dataset.sig === sig) return;
      list.dataset.sig = sig;
      list.innerHTML = '';
      if (!areas.length) { list.append(h('div', { class: 'hint' }, 'No marked areas yet.')); return; }
      for (const a of areas) {
        let x = 0; let y = 0; const r0 = a.rings[0];
        for (let i = 0; i < r0.length; i += 2) { x += r0[i]; y += r0[i + 1]; }
        const at = { x: x / (r0.length / 2), y: y / (r0.length / 2) };
        list.append(Hotbar.offer(h('div', { class: 'area-row' }, iconEl('polygon'),
          h('span', { class: 'grow ellipsis', 'data-tip': 'Double-click to rename', ondblclick: async () => { const v = await askText('Rename area', a.name); if (v) cmd('area.update', { id: a.id, name: v }); } }, a.name),
          ib('eye', `Reveal ${a.name}`, () => revealRings(a.rings, 'reveal', at, a.name)),
          ib('eye-off', `Cover ${a.name}`, () => revealRings(a.rings, 'cover', at, a.name)),
          ib('trash', `Remove ${a.name}`, () => undoable('area.remove', { id: a.id }), { danger: true })), { kind: 'fog', ref: { map: map().id, area: a.id }, label: a.name, icon: 'polygon' }));
      }
    });
    const drawBtn = btn('Mark an area', 'polygon', () => { setTool('fog'); setFogShape('area'); toast('Click the corners of the area; double-click or Enter to finish.', { ms: 4000 }); },
      { tip: 'Click its corners on the map, then double-click or press Enter' });
    bind(() => { drawBtn.classList.toggle('on', ui.fogShape === 'area'); });
    return h('div', { class: 'stack' }, h('div', { class: 'ctl-label' }, 'Marked areas'), list, row(drawBtn));
  }

  // ---------- effects popover ----------
  const { EMITTERS, REGIONS, LIGHTS, WEATHER, SKINS, SPELLS, SHAPES } = FXDATA;
  const fxLabel = (f) => {
    if (f.kind === 'light') { const d = LIGHTS.find((x) => x.id === f.preset); return `${d ? d.label : 'Light'}${f.attachTo ? ' (carried)' : ''}`; }
    const d = (f.kind === 'region' ? REGIONS : EMITTERS).find((x) => x.id === f.preset);
    return d ? d.label : f.preset;
  };
  // colour swatches: the effect's own colours, a few presets and a picker
  function colorSwatches(get, set, label = 'Colour') {
    const wrap = h('div', { class: 'swatches color-row' });
    for (const c of FXDATA.COLORS) {
      wrap.append(h('button', {
        class: `swatch ${c.hex ? '' : 'own'}`, style: c.hex ? `background:${c.hex}` : null, dataset: { v: c.hex || '' },
        'aria-label': c.label, 'data-tip': c.label, onclick: () => set(c.hex),
      }, c.hex ? null : iconEl('circle-off')));
    }
    // any other colour: a palette button over a hidden colour picker
    const pick = h('input', { type: 'color', 'aria-label': 'Any colour', oninput: (e) => set(e.target.value) });
    const pickBox = h('label', { class: 'swatch pick', 'data-tip': 'Any colour' }, iconEl('palette'), pick);
    wrap.append(pickBox);
    bind(() => {
      const v = get() || '';
      let preset = false;
      for (const b of wrap.querySelectorAll('button.swatch')) { const on = b.dataset.v === v; b.classList.toggle('on', on); preset = preset || on; }
      const custom = v && !preset;
      pickBox.classList.toggle('on', !!custom);
      pickBox.style.background = custom ? v : '';
      if (v && document.activeElement !== pick) pick.value = v;
    });
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), wrap);
  }

  // ---------- effects popover ----------
  const LOOK_GROUP = { emitter: 'place', region: 'paint', light: 'light' };
  // the options edit the selected effect, or the next one you place
  const lookTarget = () => { const f = fxOf(ui.selFx); return f && LOOK_GROUP[f.kind] === ui.fxMode ? f : null; };
  const LOOK_DEFAULT = { color: null, intensity: 1, density: 1, speed: 1, flicker: true, sat: null, angle: null, variant: null, wave: null, dust: 1, shape: 'arched', grid: 'cross', stretch: 1.5 };
  // Beta 2: what the effect being edited (or the next one) is: its definition in EMITTERS / LIGHTS
  const lookDef = () => {
    const f = lookTarget();
    if (ui.fxMode === 'light') return LIGHTS.find((x) => x.id === (f ? f.preset : ui.light)) || null;
    if (ui.fxMode === 'place') return EMITTERS.find((x) => x.id === (f ? f.preset : ui.emitter)) || null;
    if (ui.fxMode === 'paint') return REGIONS.find((x) => x.id === (f ? f.preset : ui.region)) || null;
    return null;
  };
  const defaultAngle = (d) => (d && d.id === 'shaft' ? 35 : d && d.id === 'window' ? 60 : 0);
  // 4.3.2: placed effects are sized by the grid square (1 on a normal map), like assets: a big map with a fine grid gets small effects
  const cellK = () => { const g = map() && map().grid; return g && g.size > 0 ? g.size : 1; };
  // a control that shows only while it applies (the look section is kept, not rebuilt, when the pick changes)
  function shownIf(test, el) { bind(() => { el.hidden = !test(); }); return el; }
  function lookGet(k) { const f = lookTarget(); return f ? (f[k] ?? LOOK_DEFAULT[k]) : (ui.look[k] ?? LOOK_DEFAULT[k]); }
  function lookSet(k, v, key) {
    const f = lookTarget();
    const patch = { [k]: v };
    // picking a colour should change the mood: a colour makes the light colourful, "own colours" makes it natural again
    if (k === 'color') patch.sat = v ? Math.max(0.7, lookGet('sat') ?? 0) : 0.25;
    if (f) { if (key) send(key, 'fx.update', { id: f.id, ...patch }); else cmd('fx.update', { id: f.id, ...patch }); } else { Object.assign(ui.look, patch); refreshPop(); }
  }
  // does the effect being edited (or the next one) give light? Then its colour can tint the map
  const givesLight = () => { if (ui.fxMode === 'light') return true; if (ui.fxMode !== 'place') return false; const f = lookTarget(); const d = EMITTERS.find((x) => x.id === (f ? f.preset : ui.emitter)); return !!(d && d.light); };
  const satNow = () => { const v = lookGet('sat'); if (v != null) return v; const f = lookTarget(); return f ? lightSat(f) : (lookGet('color') ? 0.7 : 0.25); };
  function lookSection() {
    const light = ui.fxMode === 'light';
    const head = h('div', { class: 'look-head' });
    bind(() => {
      head.innerHTML = '';
      const f = lookTarget();
      // filter: append() would write a null out as the text "null"
      head.append(...[h('span', { class: 'grow' }, f ? h('b', {}, fxLabel(f)) : 'Look of the next one you place'),
        f ? h('button', { class: 'btn ghost small', onclick: () => selectFx(null) }, iconEl('x'), 'Done') : null].filter(Boolean));
    });
    return h('div', { class: 'stack look' }, head,
      shownIf(() => !(lookDef() && lookDef().noColor), colorSwatches(() => lookGet('color'), (v) => lookSet('color', v))), // (Beta 3.1: Sway has no colour)
      ui.fxMode !== 'paint' ? shownIf(() => givesLight(), slider({ label: 'Colour of its light', min: 0, max: 1, step: 0.05, get: satNow, set: (v, k) => lookSet('sat', v, k), fmt: (v) => (v < 0.05 ? 'Natural' : v >= 0.95 ? 'Full colour' : pct(v)) })) : null,
      // Beta 2: a vent is steam, gas or fire (shown while a vent is picked or selected; the panel is not rebuilt for that)
      shownIf(() => !!(lookDef() && lookDef().kinds), seg({ label: 'What comes out', options: [['steam', 'Steam'], ['gas', 'Gas'], ['fire', 'Fire']].map(([v, label]) => ({ value: v, label })), get: () => lookGet('variant') || 'steam', set: (v) => lookSet('variant', v) })),
      // Beta 2: which way it faces (light shaft, arcs, bullseye lantern); also Ctrl + wheel
      shownIf(() => { const d = lookDef(); return !!(d && (d.turn || d.cone)); }, slider({ label: 'Facing (Ctrl + wheel turns it too)', min: 0, max: 355, step: 5, get: () => { const d = lookDef(); const v = lookGet('angle'); return ((v ?? defaultAngle(d)) % 360 + 360) % 360; }, set: (v, k) => lookSet('angle', v, k), fmt: (v) => `${Math.round(v)}°` })),
      slider({ label: light ? 'Brightness' : 'Strength', min: 0.1, max: light ? 1 : 2, step: 0.05, get: () => lookGet('intensity'), set: (v, k) => lookSet('intensity', v, k), fmt: pct }),
      // 4.9: a window light: which window, its bars, how far the light reaches into the room
      shownIf(() => { const d = lookDef(); return !!(d && d.id === 'window'); }, windowPicks()),
      // 4.3.2: the dust in a light shaft (4.9: and a window light), up to ten times as big
      shownIf(() => { const d = lookDef(); return !!(d && (d.id === 'shaft' || d.id === 'window')); }, slider({ label: 'Dust size', min: 0.1, max: 10, step: 0.05, get: () => lookGet('dust') ?? 1, set: (v, k) => lookSet('dust', v, k), fmt: (v) => `${round(v, 2)}×` })),
      light ? null : shownIf(() => !(lookDef() && lookDef().still), slider({ label: 'Amount', min: 0.25, max: 3, step: 0.05, get: () => lookGet('density'), set: (v, k) => lookSet('density', v, k), fmt: (v) => `${round(v, 2)}×` })),
      light ? null : shownIf(() => !(lookDef() && lookDef().still), slider({ label: 'Speed', min: 0.25, max: 3, step: 0.05, get: () => lookGet('speed'), set: (v, k) => lookSet('speed', v, k), fmt: (v) => `${round(v, 2)}×` })), // (Beta 3.1: a Roof doesn't move)
      ui.fxMode !== 'paint' ? toggle({ label: light ? 'Flicker' : 'Flames flicker their light', get: () => lookGet('flicker'), set: (v) => lookSet('flicker', v) }) : null,
      // Beta 2: how the light lives: steady, a slow pulse, or a dying torch that sputters
      ui.fxMode !== 'paint' ? shownIf(() => light || givesLight(), seg({ label: 'Its light', options: [{ value: '', label: 'Steady' }, { value: 'pulse', label: 'Pulse', tip: 'Breathes slowly: magic, a heartbeat' }, { value: 'sputter', label: 'Sputter', tip: 'A dying torch: it gutters and almost goes out now and then' }],
        get: () => lookGet('wave') || '', set: (v) => lookSet('wave', v || null) })) : null,
      // Beta 2: oil can be set alight
      ui.fxMode === 'paint' ? shownIf(() => { const f = lookTarget(); return !!(f && f.kind === 'region' && f.preset === 'oil'); },
        row(btn('Set it alight', 'flame', () => { const f = lookTarget(); if (f) undoable('fx.update', { id: f.id, preset: 'burning' }, `${fxLabel(f)} is burning`); }, { kind: 'primary', tip: 'The oil becomes burning ground (Undo puts it out)' }))) : null);
  }
  // 4.9: the window light's window and bars, as little pictures
  function windowPicks() {
    const pick = (label, list, key, iconOf) => {
      const btns = list.map((it) => {
        const img = h('img', { alt: '', draggable: 'false' });
        const b = h('button', { class: 'win-pick', role: 'radio', dataset: { v: it.id }, 'aria-label': it.label, 'data-tip': it.short ? it.label : null, onclick: () => lookSet(key, it.id) }, img, h('span', {}, it.short || it.label));
        return { b, img, it };
      });
      bind(() => {
        const v = lookGet(key);
        for (const { b, img, it } of btns) {
          const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
          const src = iconOf(it); if (img.getAttribute('src') !== src) img.src = src;
        }
      });
      return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), h('div', { class: 'win-picks', role: 'radiogroup', 'aria-label': label }, ...btns.map((x) => x.b)));
    };
    return h('div', { class: 'stack win-look' },
      pick('Window', FXDATA.WINDOW_SHAPES, 'shape', (it) => FX.windowIcon(it.id, lookGet('grid'))),
      pick('Bars', FXDATA.WINDOW_GRIDS, 'grid', (it) => FX.windowIcon(lookGet('shape'), it.id)),
      slider({ label: 'Length (a low sun throws it further)', min: 1, max: 3, step: 0.05, get: () => lookGet('stretch'), set: (v, k) => lookSet('stretch', v, k), fmt: (v) => `${round(v, 2)}×` }));
  }
  function buildFxPop() {
    const mode = seg({
      cls: 'seg-4',
      options: [
        { value: 'place', label: 'Place', icon: 'flame', tip: 'Torches, campfires, smoke, sparkles: click to place' },
        { value: 'paint', label: 'Paint', icon: 'brush', tip: 'Water, surf, blood, mist, lava: paint over an area' },
        { value: 'light', label: 'Light', icon: 'bulb', tip: 'Darkness and light sources' },
        { value: 'weather', label: 'Weather', icon: 'cloud-rain', tip: 'Mix rain, clouds, fog, lightning … over the whole table' }],
      get: () => ui.fxMode, set: (v) => { ui.fxMode = v; if (ui.selFx) selectFx(null); openPop('fx'); updateBrushCursor(); },
    });
    const body = [];
    if (ui.fxMode === 'place') {
      body.push(
        tiles(EMITTERS, () => ui.emitter, (v) => { ui.emitter = v; refreshPop(); }),
        slider({ label: 'Size', min: 0.4, max: 3, step: 0.05, get: () => (lookTarget() ? lookTarget().r / (((EMITTERS.find((d) => d.id === lookTarget().preset) || { r: 1 }).r) * cellK()) : ui.fxSize),
          set: (v, k) => { const f = lookTarget(); if (f) send(k, 'fx.update', { id: f.id, r: round(v * ((EMITTERS.find((d) => d.id === f.preset) || { r: 1 }).r) * cellK(), 4) }); else ui.fxSize = v; }, fmt: (v) => `${round(v, 2)}×` }),
        lookSection());
    } else if (ui.fxMode === 'paint') {
      body.push(
        tiles(REGIONS, () => ui.region, (v) => { ui.region = v; refreshPop(); }),
        slider({ label: 'Brush size', min: 0.5, max: 8, step: 0.25, get: () => ui.paintIn, set: (v) => { ui.paintIn = v; updateBrushCursor(); }, fmt: (v) => `${v}″` }),
        row(btn('Start a new area', 'plus', () => { delete ui.regionIds[`${S.editMapId}:${ui.region}`]; toast('The next strokes start a new area.'); }, { tip: 'Strokes of the same kind join one area until you start a new one' })),
        lookSection());
    } else if (ui.fxMode === 'light') {
      const tints = h('div', { class: 'swatches' }, ...FXDATA.TINTS.map((t) => h('button', {
        class: 'swatch', style: `background:${t.hex}`, dataset: { v: t.hex }, 'aria-label': t.label, 'data-tip': t.label, onclick: () => cmd('light.update', { tint: t.hex }),
      })));
      bind(() => { for (const b of tints.children) b.classList.toggle('on', b.dataset.v === (map().light.tint || '#03040a')); });
      // two halves: the light of the whole scene, and the lights you place
      ui.lightTab = ui.lightTab || 'scene';
      body.push(seg({ cls: 'light-tabs', options: [
        { value: 'scene', label: 'Map light', icon: 'sun-moon', tip: 'Day, dusk, night or cave, and how dark the whole map is' },
        { value: 'sources', label: 'Light sources', icon: 'bulb', tip: 'Candles, torches, lanterns and moonlight you place' }],
      get: () => ui.lightTab, set: (v) => { ui.lightTab = v; if (ui.selFx) selectFx(null); openPop('fx'); } }));
      if (ui.lightTab === 'scene') {
        body.push(h('div', { class: 'light-card' },
          hotTiles(tiles(FXDATA.MOODS.map((m) => ({ id: m.id, label: m.label, icon: m.icon, tip: m.tip })), () => map().light.mood || null, (v) => setMood(v)), (id) => { const m = FXDATA.MOODS.find((x) => x.id === id); return m && { kind: 'light', ref: m.id, label: m.label, icon: m.icon }; }),
          seg({ label: 'Change over', options: [{ value: 10, label: '10 seconds' }, { value: 0, label: 'At once' }], get: () => ui.moodFade, set: (v) => { ui.moodFade = v; try { localStorage.setItem('moodFade', String(v)); } catch {} refreshPop(); } }),
          slider({ label: 'Darkness', min: 0, max: 1, step: 0.01, get: () => map().light.darkness, set: (v, k) => send(k, 'light.update', { darkness: v }), fmt: (v) => (v < 0.01 ? 'Off (daylight)' : v > 0.995 ? 'Pitch black' : pct(v)) }),
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Colour of the dark'), tints),
          toggle({ label: 'Remember lit areas', get: () => map().light.memory, set: (v) => cmd('light.update', { memory: v }) }),
          row(btn('Forget explored areas', 'eraser', () => undoable('light.forget', {}), { tip: 'Make everything dark again' }))));
      } else {
        body.push(h('div', { class: 'light-card' },
          // the party is not a light you place here: it has its own tool (Play → Party)
          tiles(LIGHTS.filter((l) => l.id !== 'party').map((l) => ({ ...l, icon: l.id === 'moon' ? 'moon' : l.id === 'candle' ? 'candle' : l.id === 'bullseye' ? 'cone' : 'bulb', tip: `${l.bright} ft bright, ${l.dim} ft dim` })), () => ui.light, (v) => { ui.light = v; refreshPop(); }),
          lookSection()));
      }
    } else {
      body.push(...weatherPanel());
    }
    const count = h('span', { class: 'grow hint' });
    bind(() => { const n = map().fx.length; count.textContent = n ? `${n} effect${n === 1 ? '' : 's'} on this map` : 'No effects on this map yet'; });
    return h('div', { class: 'stack' }, mode, ...body.filter(Boolean), sep(), row(count, btn('List', 'stack-2', () => openPop('layers'), { tip: 'All effects in Layers' })));
  }

  // the light of the whole scene: day, dawn, dusk, night, cave (eases over 10 s unless "At once")
  // how a new light comes: over 10 seconds or at once (remembered)
  try { const v = localStorage.getItem('moodFade'); if (v === '0' || v === '10') ui.moodFade = Number(v); } catch {}
  ui.moodFade = ui.moodFade ?? 10;
  // tiles that can go on the hotbar
  function hotTiles(wrap, itemOf) { for (const b of wrap.children) Hotbar.offer(b, () => itemOf(b.dataset.v)); return wrap; }
  function setMood(id, fade = ui.moodFade) {
    const m = FXDATA.MOODS.find((x) => x.id === id);
    if (!m || !S.map) return null;
    return cmd('light.update', { darkness: m.darkness, tint: m.tint, mood: m.id, fade, label: m.label });
  }
  function moodRadial(x, y) {
    Radial.open(x, y, FXDATA.MOODS.map((m) => ({ icon: m.icon, label: m.label, cls: map().light.mood === m.id ? 'on' : '', run: () => setMood(m.id) })), 'Light');
  }

  // ---------- weather: a mix of layers ----------
  const WT = Object.fromEntries(FXDATA.WEATHER_TYPES.map((x) => [x.id, x]));
  const wxLayers = () => map().weather.layers.filter((l) => !l.dying);
  function applyWeather(p) {
    cmd('weather.preset', { name: p.label, layers: p.layers.map((l) => ({ dir: (WT[l.type] || {}).dir, ...l })) });
    ui.wxOpen = null;
  }
  // a dial to set where the weather moves to
  function compass(get, set) {
    const arrow = h('span', { class: 'compass-arrow' });
    const dial = h('div', { class: 'compass', role: 'slider', tabindex: '0', 'aria-label': 'Direction', 'data-tip': 'Drag: where the wind blows' }, arrow, h('i', { class: 'compass-hub' }));
    const out = h('output');
    const from = (e) => {
      const r = dial.getBoundingClientRect();
      const a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
      set(Math.round((((a % 360) + 360) % 360) / 5) * 5);
    };
    dial.addEventListener('pointerdown', (e) => { e.preventDefault(); dial.setPointerCapture(e.pointerId); from(e); dial.onpointermove = from; });
    dial.addEventListener('pointerup', () => { dial.onpointermove = null; });
    dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set((((get() || 0) + (e.key === 'ArrowRight' ? 15 : -15)) % 360 + 360) % 360); } });
    bind(() => { const v = get() ?? 90; arrow.style.transform = `rotate(${v}deg)`; out.textContent = `${Math.round(v)}°`; });
    return h('div', { class: 'ctl compass-row' }, h('span', { class: 'ctl-label' }, 'Direction'), dial, out);
  }
  function weatherPanel() {
    const own = () => (S.settings && S.settings.weatherPresets) || [];
    const presets = h('div', { class: 'tiles wx-presets' });
    // a mix is lit when the weather on the map has exactly its kinds of layers
    const kinds = (ls) => [...new Set(ls.map((l) => l.type))].sort().join('+');
    bind(() => {
      const now = kinds(wxLayers());
      const sig = JSON.stringify([own().map((p) => p.name), now]);
      if (presets.dataset.sig === sig) return;
      presets.dataset.sig = sig;
      presets.innerHTML = '';
      const list = [...WEATHER, ...own().map((o) => ({ id: `own:${o.name}`, label: o.name, icon: 'bookmark', layers: o.layers, own: true }))];
      for (const p of list) {
        presets.append(Hotbar.offer(h('button', {
          class: `tile ${kinds(p.layers) === now ? 'on' : ''}`, 'data-tip': p.own ? 'Your own mix. Right-click to delete it' : `${p.layers.length ? p.layers.map((l) => (WT[l.type] || {}).label).join(' + ') : 'No weather'}`,
          onclick: () => applyWeather(p),
          oncontextmenu: p.own ? (e) => { e.preventDefault(); ts.settings({ weatherPresets: own().filter((o) => o.name !== p.label) }); toast(`${p.label} deleted`); } : null,
        }, iconEl(p.icon), h('span', {}, p.label)), { kind: 'weather', ref: p.layers, label: p.label, icon: p.own ? 'cloud-rain' : p.icon }, { menu: !p.own }));
      }
    });
    // the layers of this map's weather
    const list = h('div', { class: 'wx-list' });
    let sig = '';
    let details = [];
    bind(() => {
      const ls = wxLayers();
      const nsig = JSON.stringify([ls.map((l) => [l.id, l.type, l.hidden]), ui.wxOpen]);
      if (nsig === sig) { for (const f of details) f(); return; }
      sig = nsig;
      details = [];
      list.innerHTML = '';
      if (!ls.length) { list.append(hint('No weather on this map.')); return; }
      for (const L of ls) {
        const def = WT[L.type] || { label: L.type, icon: 'cloud' };
        const open = ui.wxOpen === L.id;
        list.append(h('div', { class: `layer-row ${open ? 'open' : ''} ${L.hidden ? 'is-hidden' : ''}` },
          h('button', { class: 'layer-main', onclick: () => { ui.wxOpen = open ? null : L.id; refreshPop(); } }, iconEl(def.icon), h('span', { class: 'ellipsis grow' }, def.label), iconEl(open ? 'chevron-up' : 'chevron-down')),
          h('button', { class: 'icon-btn', 'aria-label': L.hidden ? 'Show' : 'Hide', 'data-tip': L.hidden ? 'Off. Click to show it' : 'Showing. Click to hide it', onclick: () => cmd('weather.update', { id: L.id, hidden: !L.hidden }) }, iconEl(L.hidden ? 'eye-off' : 'eye')),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', 'data-tip': 'Remove', onclick: () => cmd('weather.remove', { id: L.id }) }, iconEl('trash'))));
        if (open) list.append(wxDetail(L, def, (f) => { details.push(f); f(); }));
      }
    });
    // lightning on demand, while the mix has lightning in it
    const strike = row(Hotbar.offer(btn('Lightning', 'bolt', () => { cmd('strike.now', {}); toast('Lightning!', { ms: 1200 }); }, { kind: 'primary wx-strike', tip: 'A lightning flash on the table right now; thunder follows' }), doHot('strike')));
    bind(() => { strike.hidden = !wxLayers().some((l) => l.type === 'lightning' && !l.hidden); });
    // every single layer as a switch: lit while it is in the mix, click again to take it out
    async function toggleLayer(t) {
      const ls = wxLayers().filter((l) => l.type === t.id);
      if (ls.length) { for (const l of ls) await cmd('weather.remove', { id: l.id }); if (ls.some((l) => l.id === ui.wxOpen)) ui.wxOpen = null; refreshPop(); return; }
      const r = await cmd('weather.add', { type: t.id, dir: t.dir });
      if (r && r.selected) { ui.wxOpen = r.selected; refreshPop(); }
    }
    const add = h('div', { class: 'tiles wx-add' }, ...FXDATA.WEATHER_TYPES.map((t) => h('button', {
      class: 'tile', dataset: { v: t.id }, 'aria-label': t.label, onclick: () => toggleLayer(t),
    }, iconEl(t.icon), h('span', {}, t.label))));
    bind(() => {
      const on = new Set(wxLayers().map((l) => l.type));
      for (const b of add.children) { const o = on.has(b.dataset.v); b.classList.toggle('on', o); b.dataset.tip = o ? 'In the mix. Click to take it out' : 'Click to add it to the mix'; }
    });
    return [
      h('div', { class: 'ctl-label' }, 'Mixes'),
      presets,
      h('div', { class: 'ctl-label' }, 'Single layers: click to switch on or off'),
      add,
      h('div', { class: 'ctl-label' }, 'In this mix (click one to change it)'),
      list,
      strike,
      seg({ label: 'Changes come in', options: [{ value: 0, label: 'At once' }, { value: 10, label: 'Over 10 s' }, { value: 60, label: 'Over a minute' }], get: () => map().weather.fade ?? 0, set: (v) => cmd('weather.fade', { fade: v }) }),
      row(btn('Save this mix', 'device-floppy', async () => {
        const ls = wxLayers();
        if (!ls.length) { toast('Add some weather first.'); return; }
        const name = await askText('Name this weather mix', '', { ok: 'Save', placeholder: 'Storm over the sea' });
        if (!name) return;
        const layers = ls.map(({ type, amount, opacity, size, speed, color, dir, gust, thunder }) => ({ type, amount, opacity, size, speed, color, dir, gust, thunder }));
        await ts.settings({ weatherPresets: [...own().filter((o) => o.name !== name), { name, layers }] });
        toast(`${name} saved with your mixes`);
      }, { tip: 'Keep this mix to use on other maps' })),
    ];
  }
  function wxDetail(L, def, local) {
    const cur = (k, d) => { const x = map().weather.layers.find((l) => l.id === L.id); return x ? (x[k] ?? d) : d; };
    const set = (k) => (v, key) => send(key || `wx-${L.id}-${k}`, 'weather.update', { id: L.id, [k]: v });
    const sl = (label, k, min, max, step, fmt, d = 1) => {
      const out = h('output');
      const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
      input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); set(k)(v); });
      local(() => { if (document.activeElement !== input) input.value = cur(k, d); out.textContent = fmt(Number(input.value)); });
      return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, label), input, out);
    };
    const x = (v) => `${round(v, 2)}×`;
    // speed from lo to hi on an even scale of times (1× in the middle, so slow and fast get the same room)
    const slLog = (label, k, lo, hi, fmt, d = 1) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': label });
      const toV = (q) => { const v = lo * (hi / lo) ** (q / 1000); return v < 1 ? round(v, 2) : round(v, 1); };
      const toQ = (v) => Math.round((Math.log(Math.max(lo, Math.min(hi, v)) / lo) / Math.log(hi / lo)) * 1000);
      input.addEventListener('input', () => { const v = toV(Number(input.value)); out.textContent = fmt(v); set(k)(v); });
      local(() => { const v = cur(k, d); if (document.activeElement !== input) input.value = toQ(v); out.textContent = fmt(document.activeElement === input ? toV(Number(input.value)) : v); });
      return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, label), input, out);
    };
    const box = h('div', { class: 'layer-detail wx-detail' });
    const still = def.still;
    box.append(
      sl(L.type === 'lightning' ? 'How often' : 'Amount', 'amount', 0.1, 3, 0.05, x),
      sl('Opacity', 'opacity', 0.05, 1, 0.01, pct),
      sl(L.type === 'lightning' ? 'Bolt size' : 'Size', 'size', 0.3, 3, 0.05, x));
    if (L.type !== 'lightning') box.append(slLog('Speed', 'speed', 0.1, FXDATA.SPEED_MAX, x));
    if (!still && !def.nogust) box.append(sl('Gusts', 'gust', 0, 1, 0.05, (v) => (v < 0.03 ? 'Steady' : pct(v)), 0));
    if (!still) box.append(compass(() => cur('dir', def.dir), (v) => set('dir')(v)));
    if (L.type === 'lightning') {
      const th = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => cmd('weather.update', { id: L.id, thunder: e.target.checked }) });
      local(() => { th.checked = cur('thunder', true) !== false; });
      box.append(h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, 'Thunder follows each flash'), th, h('span', { class: 'switch' })));
    }
    // colour: the layer's own look, a few presets, or any colour
    const sw = h('div', { class: 'swatches color-row' });
    const COLS = [null, '#ffffff', '#b9cdeb', '#9fe3ff', '#cfd6dc', '#d9b77a', '#a9a39b', '#ff8f2e', '#d6ff7a', '#f6b8c9', '#2a1408', '#000000'];
    for (const col of COLS) {
      sw.append(h('button', { class: `swatch ${col ? '' : 'own'}`, style: col ? `background:${col}` : null, dataset: { v: col || '' }, 'aria-label': col || 'Its own colour', 'data-tip': col ? col : 'Its own colour', onclick: () => cmd('weather.update', { id: L.id, color: col }) }, col ? null : iconEl('circle-off')));
    }
    const pick = h('input', { type: 'color', 'aria-label': 'Any colour', oninput: (e) => set('color')(e.target.value) });
    const pickBox = h('label', { class: 'swatch pick', 'data-tip': 'Any colour' }, iconEl('palette'), pick);
    sw.append(pickBox);
    local(() => {
      const v = cur('color', null) || '';
      let preset = false;
      for (const b of sw.querySelectorAll('button.swatch')) { const on = b.dataset.v === v; b.classList.toggle('on', on); preset = preset || on; }
      pickBox.classList.toggle('on', !!v && !preset);
      pickBox.style.background = v && !preset ? v : '';
    });
    box.append(h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Colour'), sw));
    return box;
  }

  // ---------- spells popover ----------
  const shapeInfo = (id) => SHAPES.find((s) => s.id === id) || SHAPES[0];
  function spellDesc(sp) {
    if (sp.shape === 'line') return `${sp.size} ft line${sp.width !== 5 ? `, ${sp.width} ft wide` : ''}`;
    if (sp.shape === 'sphere' || sp.shape === 'cylinder') return `${sp.size} ft radius ${sp.shape}`;
    if (sp.shape === 'aura') return `${sp.size} ft aura`;
    return `${sp.size} ft ${sp.shape}`;
  }
  const skinDot = (id) => { const sk = SKINS[id] || SKINS.arcane; return h('span', { class: 'skin-dot', style: `--c:${sk.c}` }, iconEl(sk.icon)); };
  function setSpell(patch) {
    if ('shape' in patch && patch.shape !== ui.spell.shape && !('name' in patch)) patch.name = shapeInfo(patch.shape).label.replace(' on a token', '');
    Object.assign(ui.spell, patch);
    savePrefs();
    refreshPop();
    updateGhost();
  }
  function pickSpell(sp) { setSpell({ name: sp.name, shape: sp.shape, size: sp.size, width: sp.width || 5, skin: sp.skin, mode: sp.mode }); }
  const SIZES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 300];
  // how long a spell area lasts, in rounds ("Next round" ends it)
  const DURS = [null, 1, 2, 3, 5, 10, 60, 100];
  const stepDur = (v, d) => DURS[clamp(DURS.indexOf(v ?? null) + d, 0, DURS.length - 1)] ?? null;
  const durText = (v) => (v == null ? 'Until removed' : v === 10 ? '1 minute' : v === 100 ? '10 minutes' : `${v} round${v === 1 ? '' : 's'}`);
  const WIDTHS = [1, 5, 10, 15, 20, 30];
  const stepIn = (list, v, d) => (d > 0 ? list.find((x) => x > v) ?? list[list.length - 1] : [...list].reverse().find((x) => x < v) ?? list[0]);
  function buildSpellPop() {
    const search = h('input', { class: 'spell-search', type: 'search', placeholder: 'Find a spell: fireball, cone, cold…', value: ui.spellQuery, spellcheck: 'false', 'aria-label': 'Find a spell' });
    const list = h('div', { class: 'spell-list', role: 'listbox', 'aria-label': 'Spells' });
    const matches = () => {
      const q = ui.spellQuery.trim().toLowerCase();
      if (!q) return [...ui.recent.map((n) => SPELLS.find((s) => s.name === n)).filter(Boolean), ...SPELLS.filter((s) => !ui.recent.includes(s.name))];
      return SPELLS.filter((s) => s.name.toLowerCase().includes(q) || s.shape.includes(q) || s.skin.includes(q) || (SKINS[s.skin] && SKINS[s.skin].label.toLowerCase().includes(q)));
    };
    const renderList = () => {
      list.innerHTML = '';
      const items = matches();
      for (const sp of items) {
        list.append(Hotbar.offer(h('button', { class: `spell-row ${ui.spell.name === sp.name ? 'on' : ''}`, role: 'option', onclick: () => { pickSpell(sp); renderList(); } },
          skinDot(sp.skin), h('span', { class: 'grow ellipsis' }, sp.name), h('span', { class: 'spell-meta' }, spellDesc(sp))), { kind: 'spell', ref: sp.name, label: sp.name, icon: 'flame' }));
      }
      if (!items.length) list.append(hint('No preset matches. Set up your own below.'));
    };
    search.addEventListener('input', () => { ui.spellQuery = search.value; renderList(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const m = matches()[0]; if (m) { pickSpell(m); renderList(); } search.blur(); }
    });
    renderList();

    const now = h('div', { class: 'spell-now' });
    bind(() => { now.innerHTML = ''; now.append(skinDot(ui.spell.skin), h('b', { class: 'ellipsis' }, ui.spell.name), h('span', { class: 'spell-meta' }, spellDesc(ui.spell))); });

    const skins = h('div', { class: 'skin-grid' }, ...Object.entries(SKINS).map(([id, sk]) => h('button', {
      class: 'skin', style: `--c:${sk.c}`, dataset: { v: id }, 'data-tip': sk.label, 'aria-label': sk.label, onclick: () => setSpell({ skin: id }),
    }, iconEl(sk.icon))));
    bind(() => { for (const b of skins.children) b.classList.toggle('on', b.dataset.v === ui.spell.skin); });

    const widthBox = h('div', {}, stepper({ name: 'Width', label: 'Width', get: () => ui.spell.width, prev: (v) => stepIn(WIDTHS, v, -1), next: (v) => stepIn(WIDTHS, v, 1), set: (v) => setSpell({ width: v }), fmt: (v) => `${v} ft` }));
    bind(() => { widthBox.hidden = ui.spell.shape !== 'line'; });

    return h('div', { class: 'stack' },
      search, list, now,
      seg({ cls: 'seg-icons', options: SHAPES.map((s) => ({ value: s.id, icon: s.icon, tip: s.label })), get: () => ui.spell.shape, set: (v) => setSpell({ shape: v }) }),
      stepper({ name: 'Size', label: () => shapeInfo(ui.spell.shape).sizeLabel, get: () => ui.spell.size, prev: (v) => stepIn(SIZES, v, -1), next: (v) => stepIn(SIZES, v, 1), set: (v) => setSpell({ size: v }), fmt: (v) => `${v} ft`, minusKey: '−', plusKey: '+' }),
      widthBox,
      skins,
      colorSwatches(() => ui.spell.color, (v) => setSpell({ color: v })),
      seg({ options: [{ value: 'burst', label: 'Burst', icon: 'bolt', tip: 'Plays, then fades after a few seconds' }, { value: 'stay', label: 'Stays', icon: 'hourglass', tip: 'Stays until you remove it' }], get: () => ui.spell.mode, set: (v) => setSpell({ mode: v }) }),
      impactCtl(),
      toggle({ label: 'Players see the affected squares', get: () => ui.spell.squares, set: (v) => setSpell({ squares: v }) }),
      toggle({ label: 'Count rounds', get: () => ui.spell.count || !!ui.spell.duration, set: (v) => setSpell({ count: v, duration: v ? ui.spell.duration : null }) }),
      stepper({ name: 'Duration', label: 'Lasts', get: () => ui.spell.duration ?? null, prev: (v) => stepDur(v, -1), next: (v) => stepDur(v, 1), set: (v) => setSpell({ duration: v }), fmt: durText, minusTip: 'Shorter', plusTip: 'Longer' }),
      toggle({ label: 'Spell sounds', get: () => S.settings && S.settings.sfxOn, set: (v) => ts.settings({ sfxOn: v }) }),
      slider({ label: 'Bursts fade after', min: 2, max: 30, step: 1, get: () => S.settings && S.settings.burstSeconds, set: (v) => settingsLater({ burstSeconds: v }), fmt: (v) => `${v} s` }),
      sep(),
      row(btn('Clear all spell areas', 'trash', () => undoable('spell.clear', {}), { kind: 'danger', tip: 'Remove every spell area from this map' })));
  }

  // ---------- layers popover ----------
  const ROLE_ICON = { overlay: 'sparkles', token: 'user', audio: 'music', asset: 'trees' };
  const BLENDS = [
    ['screen', 'Light (fire, dust, sparks)'], ['plus-lighter', 'Glow (strong light)'], ['normal', 'Normal'],
    ['multiply', 'Shadow (darkness, smoke)'], ['overlay', 'Contrast'], ['soft-light', 'Soft light'], ['lighten', 'Lighten'],
  ];
  // ---------- off the table: things placed where the TV doesn't show ----------
  // { id -> { kind: 'layers' | 'fx' | 'spells' | 'marks' | 'draw', x, y, fixed (can't be moved, only removed) } }
  function offTable() {
    const m = map();
    const out = new Map();
    if (!m) return out;
    const r = view.tableRectInMap();
    const off = (x, y) => !(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    const box = (pts) => {
      if (!pts.length) return null;
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      return { x0, y0, x1, y1, off: x1 < r.x || x0 > r.x + r.w || y1 < r.y || y0 > r.y + r.h };
    };
    for (const l of m.layers) if ((l.role === 'token' || l.role === 'asset') && off(l.x, l.y)) out.set(l.id, { kind: 'layers', x: l.x, y: l.y });
    for (const f of m.fx) {
      if (f.kind === 'region') { const b = box(f.strokes.flatMap((st) => st.pts)); if (b && b.off) out.set(f.id, { kind: 'fx', x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, fixed: true }); continue; }
      if (!f.attachTo && off(f.x, f.y)) out.set(f.id, { kind: 'fx', x: f.x, y: f.y });
    }
    for (const sp of m.spells) if (!sp.attachTo && off(sp.x, sp.y)) out.set(sp.id, { kind: 'spells', x: sp.x, y: sp.y });
    for (const k of m.marks) if (off(k.x, k.y)) out.set(k.id, { kind: 'marks', x: k.x, y: k.y });
    for (const d of m.draw) {
      if (d.kind === 'text') { if (off(d.x, d.y)) out.set(d.id, { kind: 'draw', x: d.x, y: d.y }); continue; }
      const b = box(d.pts || []);
      if (b && b.off) out.set(d.id, { kind: 'draw', x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, fixed: true });
    }
    return out;
  }
  // move one onto the table, in the middle of what the TV shows
  function bringHere(id, o) {
    const c = tableCenterMap();
    let p = c;
    const l = o.kind === 'layers' ? layer(id) : null;
    if (l && l.role === 'token') p = Geom.snap(grid(), c.x, c.y, l.size || 1);
    const type = { layers: 'layer.update', fx: 'fx.update', spells: 'spell.update', marks: 'mark.update', draw: 'draw.update' }[o.kind];
    undoable(type, { id, x: round(p.x, 3), y: round(p.y, 3) }, 'Brought onto the table');
  }
  function removeOffTable() {
    const groups = { layers: [], fx: [], spells: [], marks: [], draw: [] };
    for (const [id, o] of offTable()) groups[o.kind].push(id);
    return undoable('layer.purge', groups);
  }
  // the camera shows everything: the table, the whole map picture, and whatever lies off the table
  function fitAll() {
    if (!S || !S.map) return;
    const pts = [[0, 0], [view.W, view.H]];
    const bp = view.bgPlacement();
    if (bp) { const a = view.mapToPx(bp.x, bp.y); const b = view.mapToPx(bp.x + bp.w, bp.y + bp.h); pts.push([a.x, a.y], [b.x, b.y]); }
    for (const o of offTable().values()) { const q = view.mapToPx(o.x, o.y); pts.push([q.x, q.y]); }
    const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys);
    const padPx = view.ppi; // an inch of room around it
    view.fitRect({ x: x0 - padPx, y: y0 - padPx, w: Math.max(...xs) - x0 + 2 * padPx, h: Math.max(...ys) - y0 + 2 * padPx });
  }

  function buildLayersPop() {
    const list = h('div', { class: 'layer-list' });
    let sig = '';
    let detailRefs = [];
    // (2.4: defined before the list is drawn the first time; a row already open when the panel opened failed here)
    const local = (fn) => { detailRefs.push(fn); fn(); };
    function sl(o) {
      const out = h('output');
      const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label });
      const key = `ly-${o.key}`;
      input.addEventListener('input', () => { const v = Number(input.value); out.textContent = o.fmt(v); o.set(v, key); });
      local(() => { const v = o.get(); if (v == null) return; if (document.activeElement !== input) input.value = v; out.textContent = o.fmt(Number(input.value)); });
      return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, o.label), input, out);
    }
    bind(() => {
      const m = map();
      const offs = offTable();
      const nsig = JSON.stringify([[...offs.keys()], m.layers.map((l) => [l.id, l.name, l.hidden, l.role, l.anchor, l.n, l.locked]), m.fx.map((f) => [f.id, f.preset, f.hidden, f.attachTo]),
        m.marks.map((k) => [k.id, k.hidden, k.label, k.value, k.text, k.n]), m.draw.map((d) => [d.id, d.hidden, d.text]),
        m.spells.map((s) => [s.id, s.name, s.hidden]), m.weather.name, m.weather.layers.filter((l) => !l.dying).length, ui.selected, ui.selFx, ui.selSpell, ui.expanded, [...view.broken],
        m.walls.length, m.walls.filter((w) => w.door).length, m.vision.on]);
      if (nsig === sig) { for (const f of detailRefs) f(); return; }
      sig = nsig;
      list.innerHTML = '';
      detailRefs = [];
      const wls = m.weather.layers.filter((l) => !l.dying);
      const wd = WEATHER.find((w) => w.label === m.weather.name) || (wls[0] && WT[wls[0].type]);
      const groups = [
        ['Weather (whole table)', [
          ...(wls.length ? [{
            id: 'weather', icon: wd ? wd.icon : 'cloud', name: `${m.weather.name || 'Weather'} (${wls.length} layer${wls.length === 1 ? '' : 's'})`, noEye: true,
            main: () => { ui.fxMode = 'weather'; setTool('fx'); openPop('fx'); },
            remove: () => undoable('weather.preset', { name: 'None', layers: [] }, 'Weather off'),
          }] : []),
          ...m.layers.filter((l) => l.role === 'overlay' && l.anchor === 'table').reverse().map(layerItem)]],
        ['Spells', m.spells.slice().reverse().map((s) => ({
          id: s.id, icon: (SKINS[s.skin] || SKINS.arcane).icon, name: `${s.name}${s.rounds != null ? ` · round ${s.rounds}` : ''}`, hidden: s.hidden,
          sel: ui.selSpell === s.id, main: () => { selectSpell(ui.selSpell === s.id ? null : s.id); if (ui.tool !== 'spell' && ui.tool !== 'select') setTool('select'); },
          eye: () => cmd('spell.update', { id: s.id, hidden: !s.hidden }), remove: () => undoable('spell.remove', { id: s.id }),
        }))],
        ['Tokens', m.layers.filter((l) => l.role === 'token').reverse().map(layerItem)],
        ['Walls', m.walls.length ? [{
          id: 'walls', icon: 'wall', name: `${m.walls.filter((w) => !w.door).length} walls, ${m.walls.filter((w) => w.door).length} doors${m.vision.on ? '' : ' (line of sight off)'}`, noEye: true,
          main: () => { setTool('walls'); openPop('walls'); },
          remove: () => undoable('wall.clear', {}),
        }] : []],
        ['Assets', m.layers.filter((l) => l.role === 'asset').reverse().map(layerItem)],
        ['Atmosphere', [
          ...m.fx.slice().reverse().map((f) => ({
            id: f.id, icon: SceneView.fxIcon(f), name: fxLabel(f), hidden: f.hidden, sel: ui.selFx === f.id,
            eye: () => cmd('fx.update', { id: f.id, hidden: !f.hidden }), remove: () => undoable('fx.remove', { id: f.id }),
            detail: () => fxDetail(f),
          })),
          ...m.layers.filter((l) => l.role === 'overlay' && l.anchor !== 'table').reverse().map(layerItem)]],
        ['Drawings and markers', [
          ...m.marks.slice().reverse().map((k) => ({
            id: k.id, icon: { pin: 'map-pin', x: 'x', dot: 'circle-number-1', counter: 'plus-minus', note: 'note' }[k.kind], hidden: k.hidden, noEye: k.kind === 'note',
            name: k.kind === 'counter' ? `${k.label}: ${k.value}` : k.kind === 'note' ? `Note: ${k.text}` : k.kind === 'dot' ? `Marker ${k.n}` : k.kind === 'x' ? 'Cross' : 'Pin',
            eye: () => cmd('mark.update', { id: k.id, hidden: !k.hidden }), remove: () => undoable('mark.remove', { id: k.id }),
          })),
          ...m.draw.slice().reverse().map((d) => ({
            id: d.id, icon: d.kind === 'text' ? 'typography' : 'ballpen', name: d.kind === 'text' ? d.text : 'Pen line', hidden: d.hidden,
            eye: () => cmd('draw.update', { id: d.id, hidden: !d.hidden }), remove: () => undoable('draw.remove', { id: d.id }),
          }))]],
      ];
      let any = false;
      // things the TV doesn't show (placed beyond its edge, or the map moved away from them)
      if (offs.size) {
        list.append(h('div', { class: 'off-head' }, iconEl('focus-centered'),
          h('span', { class: 'grow' }, `${offs.size} ${offs.size === 1 ? 'thing is' : 'things are'} off the table`),
          h('button', { class: 'btn small', 'data-tip': 'Zoom out to see everything (Shift F)', onclick: fitAll }, iconEl('zoom-scan'), 'Show'),
          h('button', { class: 'btn small danger', 'data-tip': 'Remove everything that lies off the table', onclick: removeOffTable }, iconEl('trash'), 'Remove')));
      }
      for (const [title, items] of groups) {
        if (!items.length) continue;
        any = true;
        list.append(h('div', { class: 'layer-group' }, title));
        for (const it of items) {
          const open = ui.expanded === it.id || it.sel;
          const off = offs.get(it.id);
          list.append(h('div', { class: `layer-row ${open ? 'open' : ''} ${it.hidden ? 'is-hidden' : ''} ${it.broken ? 'broken' : ''} ${off ? 'is-off' : ''}`, dataset: { id: it.id } },
            h('button', { class: 'layer-main', onclick: () => { if (it.main) it.main(); ui.expanded = ui.expanded === it.id ? null : it.id; refreshPop(); } },
              iconEl(it.icon), UI.wrapName(it.name, 'grow'), off ? h('span', { class: 'off-badge', 'data-tip': 'Off the table: the players don\'t see it' }, 'off table') : null),
            off && !off.fixed ? h('button', { class: 'icon-btn off-bring', 'aria-label': `Bring ${it.name} onto the table`, 'data-tip': 'Bring it onto the table', onclick: () => bringHere(it.id, off) }, iconEl('focus-centered')) : null,
            it.lock ? h('button', { class: `icon-btn ${it.locked ? 'on' : ''}`, 'aria-label': it.locked ? 'Unlock' : 'Lock', 'data-tip': it.locked ? 'Locked: clicks go through it. Click to unlock' : 'Lock it in place', onclick: it.lock }, iconEl(it.locked ? 'lock' : 'lock-open')) : null,
            it.noEye ? null : h('button', { class: 'icon-btn', 'aria-label': it.hidden ? 'Show to players' : 'Hide from players', 'data-tip': it.hidden ? 'Hidden from players. Click to show' : 'Visible to players. Click to hide', onclick: it.eye }, iconEl(it.hidden ? 'eye-off' : 'eye')),
            h('button', { class: 'icon-btn', 'aria-label': 'Remove', 'data-tip': 'Remove', onclick: it.remove }, iconEl('trash'))));
          if (open && it.detail) list.append(it.detail());
        }
      }
      if (!any) list.append(hint('Nothing placed yet.'));
    });
    function layerItem(l) {
      return {
        id: l.id, icon: ROLE_ICON[l.role], name: l.name + (l.n ? ` ${l.n}` : '') + (view.broken.has(l.id) ? ' (missing)' : ''), hidden: l.hidden, broken: view.broken.has(l.id),
        lock: l.role === 'asset' ? () => cmd('layer.update', { id: l.id, locked: !l.locked }) : null, locked: !!l.locked,
        sel: l.role === 'token' && ui.selected === l.id,
        main: l.role === 'token' ? () => { if (ui.tool !== 'select') setTool('select'); ui.selected = ui.selected === l.id ? null : l.id; view.setSelected(ui.selected); placeCard(); } : null,
        eye: () => cmd('layer.update', { id: l.id, hidden: !l.hidden }), remove: () => undoable('layer.remove', { id: l.id }),
        detail: () => layerDetail(l),
      };
    }
    function layerDetail(l) {
      const lr = (k) => { const x = layer(l.id); return x ? x[k] : null; };
      const lsl = (o) => sl({ ...o, key: `${l.id}-${o.k}`, get: () => lr(o.k), set: (v, key) => send(key, 'layer.update', { id: l.id, [o.k]: v }) });
      const box = h('div', { class: 'layer-detail' });
      if (l.role === 'overlay') {
        const sel = h('select', { 'aria-label': 'Blend mode', onchange: (e) => cmd('layer.update', { id: l.id, blend: e.target.value }) }, ...BLENDS.map(([v, t]) => h('option', { value: v }, t)));
        local(() => { sel.value = lr('blend'); });
        const fill = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => cmd('layer.update', { id: l.id, fill: e.target.checked }) });
        local(() => { fill.checked = !!lr('fill'); });
        const anchor = h('div', { class: 'seg' }, ...[['map', 'Moves with the map', 'map-2'], ['table', 'Fixed to the table', 'device-tv']].map(([v, t, ic]) => h('button', {
          class: 'seg-btn', dataset: { v }, onclick: () => cmd('layer.update', { id: l.id, anchor: v }),
        }, iconEl(ic), h('span', {}, t))));
        local(() => { for (const b of anchor.children) b.classList.toggle('on', b.dataset.v === (lr('anchor') || 'map')); });
        box.append(
          anchor,
          h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Blend'), sel),
          lsl({ label: 'Strength', k: 'opacity', min: 0, max: 1, step: 0.01, fmt: pct }),
          lsl({ label: 'Speed', k: 'rate', min: 0.25, max: 2, step: 0.05, fmt: (v) => `${round(v, 2)}×` }),
          h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, l.anchor === 'table' ? 'Cover the whole table' : 'Cover the whole map'), fill, h('span', { class: 'switch' })));
        if (!l.fill) box.append(lsl({ label: 'Size', k: 'scale', min: 0.05, max: 1.5, step: 0.01, fmt: pct }), lsl({ label: 'Left', k: 'x', min: -10, max: 60, step: 0.1, fmt: (v) => `${round(v, 1)}″` }), lsl({ label: 'Top', k: 'y', min: -10, max: 40, step: 0.1, fmt: (v) => `${round(v, 1)}″` }));
      } else if (l.role === 'asset') {
        box.append(
          lsl({ label: 'Size', k: 'w', min: 0.2, max: 24, step: 0.1, fmt: (v) => `${round(v, 1)}″` }),
          lsl({ label: 'Turn', k: 'rotation', min: -180, max: 180, step: 5, fmt: (v) => `${v}°` }),
          lsl({ label: 'Opacity', k: 'opacity', min: 0.1, max: 1, step: 0.05, fmt: pct }),
          lsl({ label: 'Darken', k: 'dark', min: 0, max: 0.8, step: 0.05, fmt: pct }));
      } else if (l.role === 'token') {
        box.append(
          lsl({ label: 'Size', k: 'size', min: 0.5, max: 6, step: 0.5, fmt: (v) => `${v} ${v === 1 ? 'cell' : 'cells'}` }),
          lsl({ label: 'Turn', k: 'rotation', min: 0, max: 360, step: 15, fmt: (v) => `${v}°` }),
          lsl({ label: 'Opacity', k: 'opacity', min: 0.1, max: 1, step: 0.05, fmt: pct }));
      } else {
        const mute = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => cmd('layer.update', { id: l.id, muted: e.target.checked }) });
        local(() => { mute.checked = !!lr('muted'); });
        box.append(lsl({ label: 'Volume', k: 'volume', min: 0, max: 1, step: 0.01, fmt: pct }),
          h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, 'Muted'), mute, h('span', { class: 'switch' })));
      }
      return box;
    }
    function fxDetail(f) {
      const fr = (k) => { const x = fxOf(f.id); return x ? x[k] : null; };
      const fsl = (o) => sl({ ...o, key: `${f.id}-${o.k}`, get: () => fr(o.k), set: (v, key) => send(key, 'fx.update', { id: f.id, [o.k]: v }) });
      const box = h('div', { class: 'layer-detail' });
      if (f.kind === 'light') {
        box.append(
          fsl({ label: 'Bright light', k: 'bright', min: 0, max: 120, step: 5, fmt: (v) => `${v} ft` }),
          fsl({ label: 'Dim light', k: 'dim', min: 0, max: 240, step: 5, fmt: (v) => `${v} ft` }));
        const fl = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => cmd('fx.update', { id: f.id, flicker: e.target.checked }) });
        local(() => { fl.checked = !!fr('flicker'); });
        box.append(h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, 'Flicker'), fl, h('span', { class: 'switch' })));
      } else {
        box.append(fsl({ label: 'Strength', k: 'intensity', min: 0.1, max: 2, step: 0.05, fmt: pct }));
        if (f.kind === 'emitter') box.append(fsl({ label: 'Size', k: 'r', min: 0.1, max: 6, step: 0.05, fmt: (v) => `${round(v, 2)}″` }));
      }
      return box;
    }
    return h('div', { class: 'stack' }, list,
      row(btn('Token', 'user', () => Drawer.open({ filter: 'tokens', purpose: 'addToken', back: { pop: 'layers' } }), { tip: 'Add a token' }),
        btn('Effect', 'flame', () => { setTool('fx'); openPop('fx'); }, { tip: 'Place torches, mist, lights or weather', key: 'E' }),
        btn('Ambience', 'volume', () => { ui.soundTab = 'map'; openPop('sound'); }, { tip: 'Ambience, the map\'s sounds, fight music: all in the Ambience panel' })));
  }

  // ---------- grid popover ----------
  // Grid lattice period along its own axes, for the "shift" sliders.
  const period = (g) => (g.type === 'hex-pointy' ? [g.size, g.size * SQ3] : g.type === 'hex-flat' ? [g.size * SQ3, g.size] : [g.size, g.size]);
  function originLocal(g) {
    const a = (g.angle || 0) * D2R;
    return { u: g.ox * Math.cos(a) + g.oy * Math.sin(a), v: -g.ox * Math.sin(a) + g.oy * Math.cos(a) };
  }
  const tableCenterMap = () => { const t = tableIn(); return view.tableToMap(t.w / 2, t.h / 2); };
  // Changes keep the cell in the middle of the table where it is.
  function scaleGrid(newSize, key) {
    const g = grid(); const c = tableCenterMap(); const k = newSize / g.size;
    send(key, 'grid.update', { size: newSize, ox: c.x + (g.ox - c.x) * k, oy: c.y + (g.oy - c.y) * k });
  }
  function rotateGrid(angle, key) {
    const g = grid(); const c = tableCenterMap(); const d = (angle - (g.angle || 0)) * D2R;
    const dx = g.ox - c.x; const dy = g.oy - c.y;
    send(key, 'grid.update', { angle, ox: c.x + dx * Math.cos(d) - dy * Math.sin(d), oy: c.y + dx * Math.sin(d) + dy * Math.cos(d) });
  }
  function shiftGet(axis) { const g = grid(); const o = originLocal(g); const p = period(g)[axis === 'u' ? 0 : 1]; const v = o[axis] / p; return v - Math.floor(v); }
  function shiftSet(axis, f, key) {
    const g = grid(); const o = originLocal(g); const p = period(g)[axis === 'u' ? 0 : 1];
    o[axis] = f * p;
    const a = (g.angle || 0) * D2R;
    send(key, 'grid.update', { ox: o.u * Math.cos(a) - o.v * Math.sin(a), oy: o.u * Math.sin(a) + o.v * Math.cos(a) });
  }
  // 4.5.1: the tilt with an arrow back to 0°
  function tiltRow() {
    const back = ib('arrow-back-up', 'Tilt back to 0°', () => rotateGrid(0, `grid-tilt0-${Date.now()}`), { cls: 'tilt-reset' });
    bind(() => { back.disabled = Math.abs(grid().angle || 0) < 0.05; });
    return h('div', { class: 'slider-reset' },
      slider({ label: 'Tilt', min: -45, max: 45, step: 0.1, get: () => grid().angle || 0, set: (v, k) => rotateGrid(v, k), fmt: (v) => `${round(v, 1)}°` }), back);
  }
  function buildGridPop() {
    const SW = ['#ffffff', '#000000', '#e3963e', '#7fd0ff'];
    const sw = h('div', { class: 'swatches' }, ...SW.map((c) => h('button', { class: 'swatch', style: { background: c }, 'aria-label': `Grid colour ${c}`, onclick: () => cmd('grid.update', { color: c }) })),
      h('input', { type: 'color', 'aria-label': 'Custom grid colour', oninput: (e) => send('grid-color', 'grid.update', { color: e.target.value }) }));
    bind(() => { for (const b of sw.querySelectorAll('.swatch')) b.classList.toggle('on', b.style.background && rgbToHex(b.style.background) === grid().color); const ci = sw.querySelector('input'); if (document.activeElement !== ci) ci.value = grid().color; });
    return h('div', { class: 'stack' },
      toggle({ label: 'Show grid', get: () => grid().show, set: (v) => cmd('grid.update', { show: v }) }),
      seg({ options: [
        { value: 'square', label: 'Squares', icon: 'square' },
        { value: 'hex-pointy', label: 'Hex rows', icon: 'hexagon', tip: 'Hexes with a point at the top' },
        { value: 'hex-flat', label: 'Hex columns', icon: 'hexagon', iconCls: 'rot90', tip: 'Hexes with a flat top' }],
      get: () => grid().type, set: (v) => cmd('grid.update', { type: v }) }),
      slider({ label: 'Cell size on the table', min: 0.3, max: 3, step: 0.01, get: () => grid().size * zoom(), set: (v, k) => scaleGrid(v / zoom(), k), fmt: (v) => `${round(v, 2)}″` }),
      tiltRow(),
      slider({ label: 'Shift sideways', min: 0, max: 1, step: 0.005, get: () => shiftGet('u'), set: (v, k) => shiftSet('u', v, k), fmt: pct }),
      slider({ label: 'Shift up / down', min: 0, max: 1, step: 0.005, get: () => shiftGet('v'), set: (v, k) => shiftSet('v', v, k), fmt: pct }),
      h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Colour'), sw),
      slider({ label: 'Opacity', min: 0, max: 1, step: 0.01, get: () => grid().opacity, set: (v, k) => send(k, 'grid.update', { opacity: v }), fmt: pct }),
      seg({ label: 'Grid lies', options: [
        { value: 'over', label: 'Over everything', icon: 'grid-4x4', tip: 'The grid is drawn over assets and effects' },
        { value: 'under', label: 'Under assets', icon: 'trees', tip: 'Trees, furniture and painted effects cover the grid lines' }],
      get: () => (grid().under ? 'under' : 'over'), set: (v) => cmd('grid.update', { under: v === 'under' }) }),
      sep(),
      btn('Match the map\'s printed grid', 'ruler-2', () => startAlign(), { kind: 'wide', tip: 'Drag across the grid printed on the map; only the grid changes' }),
      btn('Make grid squares 1 inch', 'ruler-measure', oneInch, { kind: 'wide', tip: 'Scale the map with everything on it so one cell is one inch on the table' }));
  }

  // ---------- sound popover: everything the table hears ----------
  function buildSoundPop() {
    const chNow = () => chapterOfMap(S.editMapId);
    const sound = () => S.sound || {};
    // a chapter's track: the ambience, or the fight music
    function trackBox(kind) {
      const box = h('div', { class: 'stack' });
      const cmdName = kind === 'fight' ? 'chapter.fight' : 'chapter.ambience';
      let sig = '';
      bind(() => {
        const ch = chNow();
        const a = ch && ch[kind];
        const spo = S.spotify || {};
        const nsig = JSON.stringify([ch && ch.id, ch && ch.name, a && [a.name, a.missing], kind === 'fight' && [S.settings.fightAuto, sound().fightNow, sound().fighting, S.table.open, ch && ch.fightMood, spo.linked, (spo.moods || []).map((m) => [m.id, m.name])]]);
        if (nsig === sig) { const inp = box.querySelector('input[type=range]'); if (inp && a && document.activeElement !== inp) { inp.value = a.volume; inp.nextSibling.textContent = pct(a.volume); } return; }
        sig = nsig;
        box.innerHTML = '';
        if (!ch) return;
        box.append(h('div', { class: 'ctl-label' }, kind === 'fight' ? `Fight music for ${ch.name}` : `Ambience for ${ch.name}`));
        if (a) {
          box.append(h('div', { class: 'snd-row', dataset: { flash: kind } }, iconEl(kind === 'fight' ? 'swords' : 'music'),
            h('span', { class: `ellipsis grow ${a.missing ? 'danger-text' : ''}` }, a.name + (a.missing ? ' (missing)' : '')),
            h('button', { class: 'icon-btn', 'aria-label': kind === 'fight' ? 'Remove the fight music' : 'Remove the ambience', 'data-tip': 'Remove', onclick: () => cmd(cmdName, { id: ch.id, path: null }) }, iconEl('trash'))));
          const out = h('output');
          const input = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: a.volume, 'aria-label': kind === 'fight' ? 'Fight music volume' : 'Ambience volume' });
          input.addEventListener('input', () => { out.textContent = pct(Number(input.value)); send(kind, cmdName, { id: ch.id, volume: Number(input.value) }); });
          out.textContent = pct(a.volume);
          box.append(h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, 'Volume'), input, out));
        }
        if (kind === 'fight') {
          const fm = Spot.fightMoodCtl(ch, cmd);
          if (fm) box.append(fm);
          if (a || (ch.fightMood && spo.linked)) {
            const on = !!sound().fightNow;
            box.append(Hotbar.offer(btn(on ? 'Stop the fight music' : 'Play it now', on ? 'player-stop' : 'player-play', () => cmd('sound.fight', { on: !on }),
              { kind: 'wide', tip: S.table.open ? 'Without starting a fight in Initiative' : 'Plays on the table: open the table first' }), doHot('fight')));
          }
          if (sound().fighting) box.append(hint('Playing now: the ambience waits quietly underneath.'));
          box.append(h('button', { class: 'btn ghost small opt-link', onclick: () => App.openOptions('sound') }, iconEl('settings'), S.settings.fightAuto ? 'Options: starts with Initiative' : 'Options: does not start with Initiative'));
        }
        box.append(btn(a ? 'Choose another' : kind === 'fight' ? 'Choose fight music' : 'Choose ambience', kind === 'fight' ? 'swords' : 'music',
          () => Drawer.open({ filter: 'sounds', purpose: kind, back: { pop: 'sound', tab: kind === 'fight' ? 'combat' : 'chapter' } }), { kind: 'wide' }));
      });
      return box;
    }
    // the map's own sounds: volume, mute and remove right here
    function mapBox() {
      const own = h('div', { class: 'stack' });
      let ownSig = '';
      bind(() => {
        const sounds = map().layers.filter((l) => l.role === 'audio');
        const bg = map().bg;
        const nsig = JSON.stringify([map().id, sounds.map((l) => [l.id, l.name, !!l.muted, !!l.missing]), bg && bg.kind === 'video']);
        if (nsig === ownSig) {
          for (const inp of own.querySelectorAll('input.snd-vol')) {
            const l = sounds.find((x) => x.id === inp.dataset.id);
            const v = inp.dataset.id === 'bg' ? (bg && bg.volume) || 0 : l ? l.volume ?? 0.6 : null;
            if (v != null && document.activeElement !== inp) inp.value = v;
          }
          return;
        }
        ownSig = nsig;
        own.innerHTML = '';
        own.append(h('div', { class: 'ctl-label' }, 'Sounds on this map'));
        const vol = (id, v, label, set) => {
          const inp = h('input', { type: 'range', class: 'snd-vol', min: 0, max: 1, step: 0.01, value: v, dataset: { id }, 'aria-label': `Volume of ${label}`, 'data-tip': 'Volume' });
          inp.addEventListener('input', () => set(Number(inp.value)));
          return inp;
        };
        for (const l of sounds) {
          own.append(h('div', { class: `snd-row ${l.muted ? 'is-muted' : ''}`, dataset: { flash: l.id } },
            iconEl('music'), h('span', { class: 'ellipsis grow', 'data-tip': l.name }, l.name),
            vol(l.id, l.volume ?? 0.6, l.name, (v) => send(`snd-${l.id}`, 'layer.update', { id: l.id, volume: v })),
            h('button', { class: 'icon-btn', 'aria-label': l.muted ? `Unmute ${l.name}` : `Mute ${l.name}`, 'data-tip': l.muted ? 'Muted. Click to hear it again' : 'Mute', onclick: () => cmd('layer.update', { id: l.id, muted: !l.muted }) }, iconEl(l.muted ? 'volume-off' : 'volume')),
            h('button', { class: 'icon-btn', 'aria-label': `Remove ${l.name}`, 'data-tip': 'Remove', onclick: () => undoable('layer.remove', { id: l.id }, `${l.name} removed`) }, iconEl('trash'))));
        }
        if (bg && bg.kind === 'video') {
          own.append(h('div', { class: 'snd-row', dataset: { flash: 'bgsound' } }, iconEl('movie'), h('span', { class: 'ellipsis grow', 'data-tip': 'The sound in the video map itself' }, 'Video sound'),
            vol('bg', bg.volume || 0, 'the video map', (v) => send('bg-vol', 'bg.update', { volume: v }))));
        }
        if (!sounds.length) own.append(hint('None. The chapter ambience plays while this map is on the table.'));
        else own.append(hint('This map\'s own sounds replace the chapter ambience.'));
        own.append(btn('Add a sound to this map', 'plus', () => Drawer.open({ filter: 'sounds', purpose: 'mapSound', back: { pop: 'sound', tab: 'map' } }), { kind: 'wide' }));
      });
      return own;
    }
    // three tabs: the chapter's ambience, this map's sounds, fight music (the speakers and spell sounds: Options → Sound)
    ui.soundTab = ui.soundTab || 'chapter';
    const tabs = seg({ cls: 'seg-3 sound-tabs', options: [
      { value: 'chapter', label: 'Chapter', icon: 'music', tip: 'The ambience of this chapter' },
      { value: 'map', label: 'Map', icon: 'photo', tip: 'Sounds of this map' },
      { value: 'combat', label: 'Combat', icon: 'swords', tip: 'Fight music' }],
    get: () => ui.soundTab, set: (v) => { ui.soundTab = v; openPop('sound'); } });
    if (ui.soundTab === 'spotify' || ui.soundTab === 'settings') ui.soundTab = 'chapter'; // (Spotify lives in the Toolbox, the settings in Options)
    const body = { chapter: () => trackBox('ambience'), map: mapBox, combat: () => trackBox('fight') }[ui.soundTab] || (() => trackBox('ambience'));
    return h('div', { class: 'stack' }, tabs, body());
  }

  function rgbToHex(rgb) {
    const m = String(rgb).match(/\d+/g);
    if (!m) return rgb;
    return `#${m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
  }

  // =====================================================================
  // Roster (maps of the chapter) and chapter menu
  // =====================================================================
  let rosterSig = '';
  let rosterEdit = null;
  function renderRoster(force) {
    const r = els.roster;
    if (!S || !S.campaign) { r.innerHTML = ''; return; }
    const ch = viewChapter();
    const sig = JSON.stringify([S.campaign.name, chapters().map((c) => [c.id, c.name, c.maps.map((m) => [m.id, m.name, m.bgPath, m.bgKind, m.missing, (m.snaps || []).map((x) => x.name)])]),
      ch && ch.id, S.editMapId, S.table.liveMapId, ui.rosterCollapsed, S.table.blackout]);
    if (!force && sig === rosterSig) return;
    rosterSig = sig;
    // 4.0.1: the strip is drawn again (a map opened, sent to the table …): it keeps where it was scrolled to
    const was = r.querySelector('.roster-strip');
    const keep = was && ch && was.dataset.ch === ch.id ? was.scrollLeft : 0;
    r.innerHTML = '';
    r.classList.toggle('collapsed', ui.rosterCollapsed);

    const chapterBtn = h('button', { class: 'chapter-btn', 'data-tip': 'Switch or edit chapters', 'data-tip-side': 'top', onclick: (e) => chapterMenu(e.currentTarget) },
      h('span', { class: 'chapter-camp' }, S.campaign.name),
      h('span', { class: 'chapter-name' }, ch ? ch.name : 'No chapter', iconEl('chevron-up')));
    const strip = h('div', { class: 'roster-strip', role: 'list' });
    if (ch) {
      ch.maps.forEach((m, i) => strip.append(mapTile(m, i, ch)));
      const add = h('button', {
        class: 'map-tile add-tile', 'data-tip': 'Add a map to this chapter (or drop picture files here)', 'data-tip-side': 'top',
        onclick: () => Drawer.open({ filter: 'maps', purpose: 'newMap', chapterId: ch.id }),
      }, h('span', { class: 'tile-thumb' }, iconEl('plus')), h('span', { class: 'tile-name' }, 'Add map'));
      add.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); add.classList.add('drop-ok'); } });
      add.addEventListener('dragleave', () => add.classList.remove('drop-ok'));
      add.addEventListener('drop', async (e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault(); e.stopPropagation();
        add.classList.remove('drop-ok');
        const files = [...e.dataTransfer.files].map((f) => ts.pathForFile(f)).filter((p) => p && /\.(png|jpe?g|webp|gif|avif|webm|mp4|m4v|mov|dd2vtt|uvtt|df2vtt)$/i.test(p));
        if (!files.length) { toast('Drop picture or video files to add them as maps.'); return; }
        const r = await ts.library('import', { files, cat: 'maps' });
        if (!r || !r.ok) return;
        for (const it of r.items) await cmd('map.add', { chapterId: ch.id, path: it.path });
        toast(`${r.items.length === 1 ? r.items[0].name : `${r.items.length} maps`} added${r.copied ? ' (copied into the library)' : ''}`);
      });
      strip.append(add);
    }
    const collapse = h('button', {
      class: 'icon-btn roster-toggle', 'aria-label': ui.rosterCollapsed ? 'Show map thumbnails' : 'Hide map thumbnails',
      'data-tip': ui.rosterCollapsed ? 'Show thumbnails' : 'Hide thumbnails', 'data-key': 'Tab', 'data-tip-side': 'top',
      onclick: toggleRoster,
    }, iconEl(ui.rosterCollapsed ? 'chevron-up' : 'chevron-down'));
    r.append(chapterBtn, strip, collapse);
    // Prototype 23: the mouse wheel over the maps scrolls them sideways
    strip.addEventListener('wheel', (e) => {
      if (strip.scrollWidth <= strip.clientWidth + 1 || e.ctrlKey) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      strip.scrollBy({ left: d * (e.deltaMode === 1 ? 40 : 1.4), behavior: 'smooth' });
    }, { passive: false });
    if (ch) strip.dataset.ch = ch.id;
    strip.scrollLeft = keep;
    // a map opened from elsewhere (Alt + number, the hotbar …) slides into view if it is outside
    if (rosterEdit !== S.editMapId) {
      rosterEdit = S.editMapId;
      const cur = strip.querySelector('.map-tile.is-edit');
      if (cur) {
        const a = strip.getBoundingClientRect(); const b = cur.getBoundingClientRect();
        if (b.left < a.left) strip.scrollLeft -= a.left - b.left + 24;
        else if (b.right > a.right) strip.scrollLeft += b.right - a.right + 24;
      }
    }
  }
  function toggleRoster() {
    ui.rosterCollapsed = !ui.rosterCollapsed;
    try { localStorage.setItem('rosterCollapsed', ui.rosterCollapsed ? '1' : '0'); } catch {}
    renderRoster(true);
  }

  function mapTile(m, i, ch) {
    const live = S.table.liveMapId === m.id;
    const edit = S.editMapId === m.id;
    const thumb = h('span', { class: 'tile-thumb' }, m.bgPath ? Thumbs.img(m.bgPath, m.bgKind) : iconEl('map-2'));
    if (live) thumb.append(h('span', { class: `tile-badge ${S.table.blackout ? 'black' : ''}` }, S.table.blackout ? 'Blacked out' : 'On table'));
    if (m.missing) thumb.append(h('span', { class: 'tile-badge warn' }, 'File missing'));
    // snapshots: a camera with how many; click opens its timeline
    const snaps = m.snaps || [];
    if (snaps.length) {
      thumb.append(h('span', { class: 'snap-pill', role: 'button', tabindex: '-1', 'aria-label': `${snaps.length} snapshot${snaps.length === 1 ? '' : 's'} of ${m.name}`,
        'data-tip': `${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}: ${snaps.map((x) => x.name).join(' → ')}. Click: open them`, 'data-tip-side': 'top',
        onclick: (e) => { e.stopPropagation(); Snaps.openFor(m.id); }, ondblclick: (e) => e.stopPropagation() }, iconEl('camera'), String(snaps.length)));
    }
    const tile = h('button', {
      class: `map-tile ${edit ? 'is-edit' : ''} ${live ? 'is-live' : ''}`, role: 'listitem', draggable: 'true',
      'data-tip': m.name, 'data-key': i < 9 ? String(i + 1) : null, 'data-tip-side': 'top',
      dataset: { id: m.id, index: String(i) },
      onclick: () => cmd('edit.open', { id: m.id }),
      ondblclick: () => cmd('table.send', { id: m.id }),
      oncontextmenu: (e) => { e.preventDefault(); mapMenu(m, e.clientX, e.clientY); },
      ondragstart: (e) => { e.dataTransfer.setData('application/x-ts-map', m.id); e.dataTransfer.effectAllowed = 'move'; },
    }, thumb, h('span', { class: 'tile-name' }, m.name));
    tile.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].some((t) => t === 'application/x-ts-map' || t === 'application/x-ts-asset')) return;
      e.preventDefault();
      const r = tile.getBoundingClientRect();
      tile.classList.toggle('drop-before', e.clientX < r.left + r.width / 2);
      tile.classList.toggle('drop-after', e.clientX >= r.left + r.width / 2);
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-before', 'drop-after'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const after = tile.classList.contains('drop-after');
      tile.classList.remove('drop-before', 'drop-after');
      const index = i + (after ? 1 : 0);
      const mid = e.dataTransfer.getData('application/x-ts-map');
      if (mid) { cmd('map.move', { id: mid, chapterId: ch.id, index }); return; }
      const asset = parseAsset(e.dataTransfer);
      if (asset && asset.role === 'map') cmd('map.add', { chapterId: ch.id, path: asset.path, index });
    });
    return tile;
  }

  function mapMenu(m, x, y) {
    const ch = chapterOfMap(m.id);
    const others = chapters().filter((c) => c.id !== (ch && ch.id));
    openMenu(x, y, [
      { icon: 'cast', label: 'Send to table', key: 'T', action: () => cmd('table.send', { id: m.id }) },
      { icon: 'pencil', label: 'Rename', action: async () => { const n = await askText('Rename map', m.name); if (n) cmd('map.rename', { id: m.id, name: n }); } },
      { icon: 'copy', label: 'Duplicate', action: () => structural('map.duplicate', { id: m.id }) },
      Hotbar.menuItem({ kind: 'map', ref: m.id, label: m.name, icon: 'map-2' }),
      ...others.map((c) => ({ icon: 'book-2', label: `Move to ${c.name}`, action: () => cmd('map.move', { id: m.id, chapterId: c.id }) })),
      '-',
      { icon: 'trash', label: 'Delete map', danger: true, action: () => structural('map.remove', { id: m.id }) },
    ]);
  }

  function chapterMenu(anchor) {
    const ch = viewChapter();
    const r = anchor.getBoundingClientRect();
    const items = [{ header: 'Chapters' }];
    for (const c of chapters()) {
      items.push({ icon: c.id === (ch && ch.id) ? 'check' : null, label: `${c.name}`, checked: c.id === (ch && ch.id), action: () => {
        ui.viewChapterId = c.id;
        if (c.maps.length) cmd('edit.open', { id: c.maps.some((m) => m.id === S.table.liveMapId) ? S.table.liveMapId : c.maps[0].id });
        else renderRoster(true);
      } });
    }
    items.push('-',
      { icon: 'file-search', label: 'Missing files…', action: () => openMissing() },
      { icon: 'plus', label: 'New chapter', action: async () => { const n = await askText('Name the new chapter', '', { ok: 'Create chapter', placeholder: 'The ruined chapel' }); if (n) { const res = await cmd('chapter.add', { name: n, after: ch && ch.id }); if (res.ok) ui.viewChapterId = res.id; } } });
    if (ch) {
      items.push(
        { icon: 'pencil', label: `Rename ${ch.name}`, action: async () => { const n = await askText('Rename chapter', ch.name); if (n) cmd('chapter.rename', { id: ch.id, name: n }); } },
        { icon: 'music', label: 'Chapter ambience', action: () => { const b = els.rail.querySelector('[data-id="sound"]'); openPop('sound', b); } },
        { icon: 'chevron-up', label: 'Move chapter up', disabled: chapters()[0] === ch, action: () => cmd('chapter.move', { id: ch.id, dir: -1 }) },
        { icon: 'chevron-down', label: 'Move chapter down', disabled: chapters()[chapters().length - 1] === ch, action: () => cmd('chapter.move', { id: ch.id, dir: 1 }) },
        '-',
        { icon: 'trash', label: `Delete ${ch.name}`, danger: true, disabled: chapters().length <= 1, action: () => structural('chapter.remove', { id: ch.id }) });
    }
    openMenu(r.left, r.top - 8 - Math.min(420, items.length * 34), items);
  }

  // =====================================================================
  // Top bar (prep vs live, grid matching, aiming), table controls, frame
  // =====================================================================
  function renderTopbar() {
    const t = els.topbar;
    t.innerHTML = '';
    if (ui.align) {
      const hex = S.map && Geom.isHex(grid());
      const cells = h('output', {}, String(ui.align.cells));
      t.append(h('div', { class: 'bar bar-mode' },
        iconEl('ruler-2'),
        h('span', {}, hex ? 'Drag from the centre of a printed hex to the centre of the hex' : 'Drag diagonally from a corner of a printed square across'),
        h('button', { class: 'icon-btn', 'aria-label': 'Fewer', onclick: () => { ui.align.cells = Math.max(1, ui.align.cells - 1); renderTopbar(); } }, iconEl('minus')),
        cells,
        h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: () => { ui.align.cells = Math.min(30, ui.align.cells + 1); renderTopbar(); } }, iconEl('plus')),
        h('span', {}, hex ? 'steps away in a straight row' : 'squares'),
        btn('Cancel', null, stopAlign, { kind: 'ghost', key: 'Esc' })));
      t.classList.add('on');
      return;
    }
    if (ui.momentAim) {
      const d = Moments.BY[ui.momentAim];
      t.append(h('div', { class: 'bar bar-mode' }, iconEl(d ? d.icon : 'target'), h('span', {}, `Click where the ${d ? d.label.toLowerCase() : 'effect'} should go`),
        btn('Cancel', null, () => aimMoment(null), { kind: 'ghost', key: 'Esc' })));
      t.classList.add('on');
      return;
    }
    if (ui.aimFrom) {
      t.append(h('div', { class: 'bar bar-mode' }, iconEl('wand'), h('span', {}, `Click where ${ui.spell.name} should point`), btn('Cancel', null, () => { ui.aimFrom = null; updateGhost(); renderTopbar(); }, { kind: 'ghost', key: 'Esc' })));
      t.classList.add('on');
      return;
    }
    if (!S || !S.map || isLive()) { t.classList.remove('on'); return; }
    const liveName = S.table.liveName;
    t.append(h('div', { class: 'bar bar-prep' },
      iconEl('eye-off'),
      h('span', {}, h('b', {}, S.map.name), liveName ? ` is not on the table. Players see ${liveName}.` : ' is not on the table yet.'),
      Hotbar.offer(btn('Send to table', 'cast', () => cmd('table.send'), { kind: 'primary', key: 'T', tip: 'Crossfade the table to this map' }), doHot('send')),
      liveName ? btn('Back to the live map', 'arrow-back-up', () => cmd('table.live'), { kind: 'ghost', tip: `Edit ${liveName} again` }) : null));
    t.classList.add('on');
  }

  function renderTableCtl() {
    const c = els.tctl;
    const t = S.table;
    const status = !t.open ? 'Table closed' : t.blackout ? 'Blacked out' : t.title ? `Title: ${t.title}` : t.liveName ? `On the table: ${t.liveName}` : 'Table is dark';
    const cls = !t.open ? 'closed' : t.blackout ? 'black' : t.liveName ? 'live' : 'dark';
    let img = $('#tc-preview', c);
    if (!img) {
      c.innerHTML = '';
      // click: Options → TV; double-click: a big preview; drag the corner: a bigger or smaller one here
      let clickT = 0;
      img = h('img', { id: 'tc-preview', alt: 'What the players see', 'data-tip': 'What the players see. Double-click: big preview',
        onclick: () => { clearTimeout(clickT); clickT = setTimeout(() => App.openOptions('tv'), 260); },
        ondblclick: () => { clearTimeout(clickT); bigPreview(); } });
      const grip = h('span', { class: 'tc-grip', 'data-tip': 'Drag to make the preview bigger or smaller', 'aria-label': 'Preview size' }, iconEl('arrows-diagonal'));
      grip.addEventListener('pointerdown', previewDrag);
      c.append(
        h('div', { class: 'tc-shot' }, img, grip, h('span', { class: 'tc-fps', 'data-tip': 'Frames per second on the TV. Low? Try lighter effects in Options → Performance' })),
        h('div', { class: 'tc-status' }, h('span', { class: 'dot' }), h('span', { class: 'tc-text ellipsis' }),
          h('button', { class: 'icon-btn small tc-title-off', 'aria-label': 'Take the title off the table', 'data-tip': 'Take the title off the table (sending a map does it too)', onclick: () => cmd('title.show', { on: false }) }, iconEl('x'))),
        h('div', { class: 'tc-btns' },
          Hotbar.offer(h('button', { class: 'btn tc-black', 'data-key': 'B', onclick: () => cmd('table.blackout') }, iconEl('screen-share-off'), h('span', {}, 'Blackout')), doHot('blackout')),
          Hotbar.offer(h('button', { class: 'btn tc-quiet', onclick: () => cmd('sound.quiet') }, iconEl('volume'), h('span', {}, 'Mute')), doHot('quiet')),
          h('button', { class: 'btn tc-open', onclick: () => cmd('table.toggle') }, iconEl('device-tv'), h('span', {}, 'Open'))),
        h('div', { class: 'tc-moments' }),
        h('div', { class: 'tc-spotify' }),
        h('div', { class: 'tc-hud' }));
      setPreviewWidth(previewW, false);
    }
    renderMomentsHud($('.tc-moments', c));
    Spot.renderNow($('.tc-spotify', c));
    Tools.renderHud($('.tc-hud', c));
    c.className = cls;
    $('.tc-text', c).textContent = status;
    $('.tc-title-off', c).hidden = !(t.open && t.title && !t.blackout);
    const black = $('.tc-black', c);
    black.classList.toggle('on', t.blackout);
    black.dataset.tip = t.blackout ? 'Show the table again' : 'Black out the table instantly';
    black.disabled = !t.open;
    const quiet = $('.tc-quiet', c);
    const q = !!(S.sound && S.sound.quiet);
    quiet.hidden = !t.open;
    if (quiet.dataset.q !== String(q)) {
      quiet.dataset.q = String(q);
      quiet.classList.toggle('on', q);
      quiet.replaceChildren(iconEl(q ? 'volume-off' : 'volume'), h('span', {}, q ? 'Unmute' : 'Mute'));
      quiet.dataset.tip = q ? 'Bring the table\'s sound back' : 'Fade all table sound out, for talk out of the game';
    }
    const open = $('.tc-open', c);
    open.lastChild.textContent = t.open ? 'Close' : 'Open table';
    open.dataset.tip = t.open ? 'Close the table window (Esc on the TV also works)' : 'Open the table window on the TV';
    $('.tc-shot', c).hidden = !t.open;
  }

  // ---------- maps arrive at real size (grid-detect.js) ----------
  async function pinBackground(p) {
    if (p.scale == null || !S || !S.map) { cmd('bg.pin', p); return; }
    const m = S.map; const bg = m.bg;
    const node = view.bgNode;
    let found = GridDetect.fromName(bg && bg.name, p.nw, p.nh);
    if (!found && node) {
      // a video map needs a picture to look at first
      if (node.kind === 'video' && node.el.readyState < 2) await new Promise((r) => { const t = setTimeout(r, 2500); node.el.addEventListener('loadeddata', () => { clearTimeout(t); r(); }, { once: true }); });
      if (view.bgNode === node) found = GridDetect.fromImage(node.el, p.nw, p.nh);
    }
    if (!S.map || S.map.id !== m.id || view.bgNode !== node) return; // the map changed meanwhile: it is pinned there
    if (!found) { cmd('bg.pin', p); return; }
    // one square = one inch on the table at the map's zoom; centred, or from its top left when bigger than the table
    const z = m.view.zoom || 1;
    const sc = 1 / z / found.cell;
    const w = p.nw * sc; const hh = p.nh * sc;
    const tr = view.tableRectInMap();
    const x = round(tr.x + Math.max(0, (tr.w - w) / 2), 4); const y = round(tr.y + Math.max(0, (tr.h - hh) / 2), 4);
    await cmd('bg.pin', { x, y, scale: sc, nw: p.nw, nh: p.nh });
    const g = 1 / z;
    await cmd('grid.update', { type: 'square', angle: 0, size: round(g, 5), ox: round(x + found.ox * sc, 4), oy: round(y + found.oy * sc, 4) });
    ui.realSize = { mapId: m.id, how: found.how, cols: found.cols, rows: found.rows };
    toast(`Real size: ${found.cols} × ${found.rows} squares, one inch each (${found.how === 'name' ? 'from the file name' : 'from the grid on the map'})`,
      { ms: 8000, action: { label: 'Fit to table instead', run: () => { const f = fitView(); if (f) cmd('view.update', f); } } });
  }

  // ---------- the table preview: three sizes here, and a big floating one ----------
  const PREVIEW_W = [212, 340, 480]; // width of the table controls: small, medium, large
  let previewW = 212;
  try { const v = Number(localStorage.getItem('previewW')); if (PREVIEW_W.includes(v)) previewW = v; } catch {}
  function setPreviewWidth(w, snap = true) {
    const ww = snap ? PREVIEW_W.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)) : clamp(w, PREVIEW_W[0], PREVIEW_W[PREVIEW_W.length - 1]);
    els.tctl.style.width = `${Math.round(ww)}px`;
    els.tctl.dataset.size = ww <= 230 ? 'small' : ww <= 400 ? 'medium' : 'large';
    if (snap) { previewW = ww; try { localStorage.setItem('previewW', String(ww)); } catch {} }
    sendPreviewSize();
    placeFpsAsk();
  }
  // the picture comes as wide as it is shown (sharper when bigger), and quicker while the big one is open
  function sendPreviewSize() {
    const big = Floats && Floats.isOpen('preview');
    const shown = big ? 960 : (els.tctl.getBoundingClientRect().width || previewW) - 16;
    ts.previewSize({ width: Math.round(Math.min(1280, shown * (window.devicePixelRatio || 1))), fast: big });
  }
  function previewDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const g = e.currentTarget;
    g.setPointerCapture(e.pointerId);
    const x0 = e.clientX; const w0 = els.tctl.getBoundingClientRect().width;
    els.tctl.classList.add('sizing');
    const move = (ev) => setPreviewWidth(w0 + (x0 - ev.clientX), false); // the controls sit at the right: drag left to grow
    const up = (ev) => {
      g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
      els.tctl.classList.remove('sizing');
      setPreviewWidth(w0 + (x0 - ev.clientX), true);
    };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  }
  // a big preview as a floating panel: drag it anywhere (the second screen of a laptop, say)
  function bigPreview() {
    Floats.show({ id: 'preview', title: 'The table', icon: 'picture-in-picture', build: () => {
      const im = h('img', { class: 'big-preview', alt: 'What the players see', src: lastPreview || '' });
      return h('div', { class: 'stack' }, im);
    } });
    sendPreviewSize();
  }
  // moments that stay until stopped (gas, dread ...): one row under the preview to stop them
  function renderMomentsHud(box) {
    const on = ((S && S.moments) || []).filter((m) => !m.stop && !(Moments.BY[m.id] || {}).dur);
    const sig = on.map((m) => m.key).join();
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = '';
    for (const m of on) {
      const d = Moments.BY[m.id];
      box.append(h('div', { class: 'hud-row hud-moment' }, iconEl(d.icon), h('span', { class: 'grow ellipsis' }, `${d.label} is on`),
        h('button', { class: 'icon-btn', 'aria-label': `Stop ${d.label}`, 'data-tip': `Stop ${d.label}`, onclick: () => cmd('moment.stop', { id: m.key }) }, iconEl('player-stop'))));
    }
  }

  // ---------- library files that moved or were deleted ----------
  // on opening a campaign; 4.6.2: also when you come back to Tablescape (a file renamed in the folder meanwhile) and
  // when a picture can't be loaded. Then it only speaks up for files that went missing since it last said so.
  let toldMissing = new Set(); let toldFor = null; let checking = Promise.resolve();
  function checkMissing(quiet = false) { checking = checking.then(() => checkMissingNow(quiet)).catch(() => {}); return checking; } // one at a time
  async function checkMissingNow(quiet) {
    const list = await ts.app('missing.list');
    if (!Array.isArray(list)) return;
    ui.missingCount = list.length;
    const camp = S && S.campaign ? `${S.campaign.id}:${S.campaign.opened}` : null; // (each opening of a campaign tells once)
    if (camp !== toldFor) { toldFor = camp; toldMissing = new Set(); }
    const fresh = list.filter((m) => !toldMissing.has(m.key));
    toldMissing = new Set(list.map((m) => m.key));
    if (!fresh.length) return;
    // 4.10.1: files a map or the music uses are a problem; those only kept on a Ready list (or the Tonight tray) are
    // shortcuts to files deleted from the library on purpose, most likely: a quiet word and one click to tidy up
    const used = fresh.filter((m) => !m.onlyLists); const listed = fresh.filter((m) => m.onlyLists);
    if (used.length) {
      const all = list.filter((m) => !m.onlyLists).length;
      const one = used[0];
      const what = used.length === 1
        ? `Missing: ${one.file}${one.uses && one.uses.length ? ` (${one.uses[0]}${one.uses.length > 1 ? ` and ${one.uses.length - 1} more` : ''})` : ''}`
        : `${used.length} files this campaign uses are missing${all > used.length ? ` (${all} in all)` : ''}`;
      toast(what, { kind: 'error', ms: 10000, action: { label: 'Find them', run: openMissing } });
    }
    if (listed.length) {
      const where = [...new Set(listed.flatMap((m) => m.uses.map((u) => u.replace(/: Ready \((Tokens|Talk)\)$/, ''))))];
      const onWhat = where.length === 1 ? `the Ready list of ${where[0]}` : 'Ready lists';
      toast(`${listed.length === 1 ? `${listed[0].file} is` : `${listed.length} files on ${onWhat} are`} no longer in the library${listed.length === 1 ? ` (on ${onWhat})` : ''}`,
        { ms: 12000, action: { label: 'Take them off', run: () => forgetMissing(listed.map((m) => m.key)) } });
      const el = [...document.querySelectorAll('.toast')].pop(); if (el) el.dataset.missLists = '1'; // (it goes once they are taken off elsewhere)
    }
  }
  // 4.10.1: missing files off the Ready lists and the Tonight tray (with undo: the lists as they were)
  async function forgetMissing(keys) {
    const before = chapters().map((c) => ({ id: c.id, ready: c.ready ? { tokens: (c.ready.tokens || []).map((x) => ({ path: x.path })), portraits: (c.ready.portraits || []).map((x) => ({ path: x.path })) } : null }));
    const r = await ts.app('missing.forget', { keys });
    document.querySelectorAll('.toast[data-miss-lists]').forEach((x) => x.remove());
    if (!r || !r.count) return r;
    toast(`${r.count} taken off the Ready list${r.count === 1 ? '' : 's'}`, { ms: 4000, undo: async () => {
      for (const c of before) if (c.ready) for (const k of Ready.KINDS) await cmd('ready.set', { chapterId: c.id, kind: k, items: c.ready[k] });
    } });
    return r;
  }
  let missT = 0;
  const checkMissingSoon = () => { clearTimeout(missT); missT = setTimeout(() => { if (S && S.campaign && S.screen === 'play') checkMissing(true); }, 600); };
  window.addEventListener('focus', checkMissingSoon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkMissingSoon(); });
  async function openMissing() {
    const dlg = dialog('Missing files', UI.loader('Looking …'), { wide: true });
    const fill = async () => {
      const list = await ts.app('missing.list');
      ui.missingCount = list.length;
      dlg.body.innerHTML = '';
      if (!list.length) { dlg.body.append(h('div', { class: 'dlg-row ok' }, h('div', { class: 'dlg-title' }, iconEl('check'), 'Every file this campaign uses is where it should be.'))); return; }
      const used = list.filter((m) => !m.onlyLists); const listed = list.filter((m) => m.onlyLists);
      if (used.length) dlg.body.append(h('div', { class: 'hint' }, 'These files were moved, renamed or deleted. Point each one at the file to use instead.'));
      // 4.10.1: the ones only kept on a Ready list (or the Tonight tray) come after, with a button to take them all off
      const rowFor = (m) => {
        const relink = async (p) => { const r = await ts.app('missing.relink', { key: m.key, path: p }); if (r && r.ok) { toast(`${m.file}: ${r.count} use${r.count === 1 ? '' : 's'} fixed`); fill(); } else if (r && r.error) toast(r.error, { kind: 'error' }); };
        dlg.body.append(h('div', { class: 'dlg-row' },
          h('div', { class: 'dlg-title' }, iconEl('alert-triangle'), h('span', { class: 'ellipsis' }, m.file)),
          h('div', { class: 'dlg-sub' }, `Used for ${m.uses.slice(0, 3).join(', ')}${m.uses.length > 3 ? ` and ${m.uses.length - 3} more` : ''}`),
          h('div', { class: 'dlg-btns' },
            ...m.suggest.map((x) => h('button', { class: 'btn small primary', 'data-tip': x.path, onclick: () => relink(x.path) }, iconEl('check'), `Use ${x.rel || x.path}`)),
            h('button', { class: 'btn small', onclick: () => relink(null) }, iconEl('folder'), 'Find it …'),
            m.onlyLists ? h('button', { class: 'btn small ghost', onclick: async () => { await forgetMissing([m.key]); fill(); } }, iconEl('x'), 'Take it off') : null)));
      };
      for (const m of used) rowFor(m);
      if (listed.length) {
        dlg.body.append(h('div', { class: 'miss-lists' },
          h('div', { class: 'dlg-title' }, iconEl('bookmarks'), h('span', { class: 'grow' }, `Only on Ready lists (${listed.length})`),
            h('button', { class: 'btn small primary', onclick: async () => { await forgetMissing(listed.map((m) => m.key)); fill(); } }, iconEl('x'), 'Take them all off')),
          h('div', { class: 'hint' }, 'No map uses these; they are only on a Ready list. Take them off, or point one at its new file.')));
        for (const m of listed) rowFor(m);
      }
    };
    fill();
  }

  function placeFrame() {
    if (!S || !S.map) { els.frame.className = ''; return; }
    const r = view.frameRect();
    const sr = els.stage.getBoundingClientRect();
    Object.assign(els.frame.style, { left: `${r.left - sr.left}px`, top: `${r.top - sr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const live = isLive();
    const kind = !live ? 'prep' : S.table.blackout ? 'black' : S.table.open ? 'live' : 'closed';
    els.frame.className = `on ${kind}`;
    els.frame.firstChild.textContent = { prep: 'Prep: players can\'t see this', live: 'On the table', black: 'Blacked out', closed: 'On the table (window closed)' }[kind];
  }

  function renderEmpty() {
    const e = els.empty;
    const m = S && S.map;
    if (!S || !S.campaign || (m && m.bg && !m.broken)) { e.className = ''; e.innerHTML = ''; return; }
    e.className = 'on';
    e.innerHTML = '';
    if (m && m.broken) { // Beta 1: the map's file could not be read; nothing is written over it until you decide
      e.append(h('div', { class: 'empty-card broken' },
        h('h2', {}, iconEl('alert-triangle'), ` ${m.name || 'This map'}: its file is damaged`),
        h('p', {}, 'It could not be read (half written, or changed by hand). Bring an earlier version of the campaign back, or start this map over.'),
        h('div', { class: 'ctl-row' },
          btn('Backups', 'history', () => Home.earlier({ id: S.campaign.id, name: S.campaign.name }), { kind: 'primary' }),
          btn('Start it over', 'eraser', () => {
            const dlg = UI.dialog(`Start ${m.name} over?`, h('div', {}, h('p', { class: 'hint' }, 'The damaged file is written over with an empty map. An earlier version of the campaign can still bring it back.'),
              h('div', { class: 'dlg-btns' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Go back'), h('button', { class: 'btn danger', onclick: () => { dlg.close(); cmd('map.reset', { id: m.id }); } }, 'Start over'))));
          }))));
      return;
    }
    e.append(h('div', { class: 'empty-card' },
      h('h2', {}, m ? 'This map has no background yet' : 'This chapter has no maps yet'),
      h('p', {}, m ? 'Pick a map from your library, or drop an image or video file here.' : 'Add the first map for this chapter.'),
      h('div', { class: 'ctl-row' },
        m ? btn('Open library', 'photo', () => Drawer.open({ filter: 'maps', purpose: 'replace' }), { kind: 'primary', key: 'L' })
          : btn('Add map', 'plus', () => Drawer.open({ filter: 'maps', purpose: 'newMap', chapterId: viewChapter() && viewChapter().id }), { kind: 'primary' }),
        m ? btn('Choose a file', 'folder', async () => { const r = await ts.library('import', { cat: 'maps' }); if (r && r.ok && r.items[0]) cmd('bg.set', { path: r.items[0].path }); }, { tip: 'Pick a map anywhere on this computer: it is copied into the library' }) : null)));
  }

  // =====================================================================
  // Selection card: token, spell area or effect
  // =====================================================================
  const ib = (iconName, label, onclick, o = {}) => h('button', {
    class: `icon-btn ${o.on ? 'on' : ''} ${o.danger ? 'danger' : ''} ${o.cls || ''}`, 'aria-label': label, 'data-tip': o.tip || label, 'data-key': o.key || null, onclick,
  }, iconEl(iconName));
  const cardSep = () => h('span', { class: 'card-sep' });
  // 4.10: Options → Tokens (main: tokenLook)
  const tokSet = () => (S && S.settings && S.settings.tokens) || { pic: Geom.PIC_DEFAULT, card: 'compact', ring: 'thin', snap: true };

  function cardTarget() {
    const tok = ui.selected && layer(ui.selected);
    if (tok && tok.role === 'token' && (ui.tool === 'select' || ui.tool === 'token')) return { kind: 'token', item: tok };
    const mk = Tools.cardTarget();
    if (mk) return mk;
    if (ui.tool === 'asset' && ui.selAssets.length > 1) {
      const items = ui.selAssets.map(layer).filter(Boolean);
      if (items.length > 1) return { kind: 'assets', item: items[0], items };
    }
    const sp = spellOf(ui.selSpell);
    if (sp && (ui.tool === 'select' || ui.tool === 'spell')) return { kind: 'spell', item: sp };
    const f = fxOf(ui.selFx);
    if (f && (ui.tool === 'fx' || (ui.tool === 'select' && f.preset === 'party'))) return { kind: 'fx', item: f };
    const a = ui.selAsset && layer(ui.selAsset);
    if (a && ui.tool === 'asset') return { kind: 'asset', item: a };
    return null;
  }
  // The card stays where it opened while only the item's size, turn or look changes, so + or Turn can be
  // clicked again and again. It moves along when the item is moved, the map is panned or zoomed, or
  // something else is selected.
  let cardPin = null; // { key, x, y }
  function cardPinKey(t, sr) {
    const items = t.kind === 'assets' ? t.items : [t.item];
    const ids = items.map((a) => a && a.id).join();
    const pos = items.map((a) => (a && a.x != null ? `${round(a.x, 3)},${round(a.y, 3)}` : '')).join(';');
    const cam = view && view.cam ? `${round(view.cam.s, 4)},${Math.round(view.cam.tx)},${Math.round(view.cam.ty)}` : '';
    const mv = S.map.view ? `${S.map.view.x},${S.map.view.y},${S.map.view.zoom}` : '';
    return `${t.kind}|${ids}|${pos}|${cam}|${mv}|${Math.round(sr.width)}x${Math.round(sr.height)}|${popId || ''}`;
  }
  function placeCard() {
    const c = els.card;
    const t = S && S.map ? cardTarget() : null;
    if (!t) { c.classList.remove('on'); c.innerHTML = ''; c.dataset.sig = ''; cardPin = null; return; }
    // (an asset's opacity is left out, so its slider in the card isn't rebuilt while it is dragged)
    const sigItem = t.kind === 'assets' ? t.items.map((a) => ({ ...a, opacity: 0, x: 0, y: 0 })) : t.kind === 'asset' ? { ...t.item, opacity: 0 } : t.item;
    const pcName = t.kind === 'token' ? pcOf(t.item) : null; // (Prototype 17: a player's token has its own toolbar)
    const sig = JSON.stringify([t.kind, sigItem, t.kind === 'token' ? [!!tokenLight(t.item.id), tokSet().card, tokSet().pic] : 0,
      pcName ? [pcName, pcCard(pcName), ((S.players || {}).moves || {})[pcName], !!(S.players && S.players.on), playerOpen(pcName)] : 0]);
    if (c.dataset.sig !== sig) {
      c.dataset.sig = sig;
      c.innerHTML = '';
      c.append(...(t.kind === 'token' ? (pcName ? playerCard(t.item, pcName) : tokenCard(t.item)) : t.kind === 'spell' ? spellCard(t.item) : t.kind === 'asset' ? assetCard(t.item)
        : t.kind === 'assets' ? assetsCard(t.items) : t.kind === 'mark' ? Tools.card(t) : fxCard(t.item)));
    }
    const range = c.querySelector('.card-range input');
    if (range && document.activeElement !== range && !range.matches(':active')) range.value = t.item.opacity ?? 1;
    // 4.10: a token's toolbar: compact and see-through until the mouse is on it (default), as before, or docked
    const style = t.kind === 'token' ? tokSet().card || 'compact' : 'floating';
    c.classList.toggle('compact', style === 'compact');
    c.classList.toggle('docked', style === 'docked');
    const tr = cardAnchor(t);
    if (!tr) { c.classList.remove('on'); cardPin = null; return; }
    c.classList.add('on');
    const sr = els.stage.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    if (style === 'docked') { // above the hotbar, in the middle
      const hb = Hot && Hot.el && Hot.el.isConnected && !Hot.el.hidden ? Hot.el.getBoundingClientRect() : null;
      const bottom = hb && hb.height && hb.top - sr.top > sr.height / 2 ? hb.top - sr.top - 10 : sr.height - 14;
      c.style.left = `${clamp(sr.width / 2 - cr.width / 2, 8, Math.max(8, sr.width - cr.width - 8))}px`;
      c.style.top = `${clamp(bottom - cr.height, 8, Math.max(8, sr.height - cr.height - 8))}px`;
      cardPin = null;
      return;
    }
    const pinKey = cardPinKey(t, sr);
    if (cardPin && cardPin.key === pinKey) {
      c.style.left = `${clamp(cardPin.x, 8, Math.max(8, sr.width - cr.width - 8))}px`;
      c.style.top = `${clamp(cardPin.y, 8, Math.max(8, sr.height - cr.height - 8))}px`;
      return;
    }
    const gap = style === 'compact' ? 18 : 10; // (4.10: compact keeps a little further away)
    let y = tr.top - sr.top - cr.height - gap;
    if (y < 60) y = tr.bottom - sr.top + gap;
    let x = clamp(tr.left - sr.left + tr.width / 2 - cr.width / 2, 8, sr.width - cr.width - 8);
    y = clamp(y, 8, sr.height - cr.height - 8);
    // keep clear of the table preview in the top right corner and of an open popover
    const tc = els.tctl.getBoundingClientRect();
    if (y < tc.bottom - sr.top + 6 && x + cr.width > tc.left - sr.left - 6) x = Math.max(8, tc.left - sr.left - cr.width - 10);
    if (popId) {
      const pr = els.pop.getBoundingClientRect();
      if (x < pr.right - sr.left + 8 && y + cr.height > pr.top - sr.top && y < pr.bottom - sr.top) x = pr.right - sr.left + 10;
    }
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    cardPin = { key: pinKey, x, y };
  }
  function cardAnchor(t) {
    if (t.kind === 'token') return view.tokenPicRect(t.item.id);
    if (t.kind === 'asset') return view.assetRect(t.item.id);
    if (t.kind === 'mark') return Tools.cardAnchor(t);
    if (t.kind === 'assets') {
      const rs = t.items.map((a) => view.assetRect(a.id)).filter(Boolean);
      if (!rs.length) return null;
      const l = Math.min(...rs.map((r) => r.left)); const tp = Math.min(...rs.map((r) => r.top));
      const r = Math.max(...rs.map((x) => x.right)); const b = Math.max(...rs.map((x) => x.bottom));
      return { left: l, top: tp, width: r - l, height: b - tp, bottom: b };
    }
    if (t.kind === 'spell') {
      const { tpl } = view.spellGeom(t.item);
      const a = view.mapToScreen(tpl.bbox[0], tpl.bbox[1]); const b = view.mapToScreen(tpl.bbox[2], tpl.bbox[3]);
      return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y, bottom: b.y };
    }
    const el = view.handlesEl.querySelector(`.sv-handle[data-id="${t.item.id}"]`);
    return el ? el.getBoundingClientRect() : null;
  }
  function sizeMenu(anchor, l) {
    const r = anchor.getBoundingClientRect();
    // 4.10: its picture: as Options → Tokens sets it for its size, or a little bigger or smaller (a picture with a wide margin)
    const own = l.pic || 1;
    const base = Geom.tokenPic(l.size || 1, tokSet().pic, 1);
    const pctOf = (k) => `${Math.round(base * k * 100)}%`;
    const setPic = (k) => cmd('layer.update', { id: l.id, pic: Math.abs(k - 1) < 0.001 ? null : Math.round(k * 100) / 100, stepLabel: 'Picture size' });
    openMenu(r.left, r.bottom + 6, [{ header: 'Size (D&D 5e)' }, ...[[0.5, 'Tiny'], [1, 'Small or Medium'], [2, 'Large'], [3, 'Huge'], [4, 'Gargantuan']].map(([v, label]) => ({
      icon: l.size === v ? 'check' : null, checked: l.size === v, label: `${label} (${v === 0.5 ? 'half a square' : `${v} × ${v}`})`, action: () => cmd('layer.update', { id: l.id, size: v, ...snapFor(l, v) }),
    })), '-', { header: `Its picture: ${pctOf(own)} of its squares` },
    { icon: 'minus', label: `Smaller (${pctOf(Math.max(0.5, own - 0.1))})`, action: () => setPic(Math.max(0.5, own - 0.1)) },
    { icon: 'plus', label: `Bigger (${pctOf(Math.min(2, own + 0.1))})`, action: () => setPic(Math.min(2, own + 0.1)) },
    { icon: own === 1 ? 'check' : null, checked: own === 1, label: `As set in Options → Tokens (${pctOf(1)})`, action: () => setPic(1) }]);
  }
  // a token that changes size keeps sitting on the grid
  const snapFor = (l, size) => Geom.snap(grid(), l.x, l.y, size);
  // ---------- token names: rename one or all copies, and the name tag (Off / Only me / Players too) ----------
  const TAG_LOOK = { off: { label: 'No name tag', icon: 'tag', tip: 'Name tag: off' }, gm: { label: 'Name tag: only me', icon: 'tag', tip: 'Name tag on your screen only' }, all: { label: 'Name tag: players see it', icon: 'tag', tip: 'Name tag on the table too (not while the token is hidden)' } };
  const copiesOf = (l) => (map() ? map().layers.filter((x) => x.role === 'token' && x.path === l.path && !x.named) : []);
  function nameMenu(anchor, l) {
    const r = anchor.getBoundingClientRect();
    const group = l.named ? [] : copiesOf(l);
    openMenu(r.left, r.bottom + 6, [
      { icon: 'pencil', label: group.length > 1 ? `Rename this ${l.name} …` : 'Rename …', action: () => renameToken(l) },
      ...(group.length > 1 ? [{ icon: 'users', label: `Rename all copies (${group.length}) …`, action: () => renameGroup(l, group) }] : []),
      // Prototype 17: any token can be a player's (a familiar, a summon, an ally): it sees and carries their light
      ...(((S.chars || []).length && !pcOf(l)) ? ['-', { header: 'Make this a player token' }, ...(S.chars || []).filter((c) => c.here).map((c) => ({ icon: 'user', label: c.name, action: () => cmd('layer.update', { id: l.id, player: c.name, stepLabel: 'Player token' }) }))] : []),
      '-', { header: 'Name tag' },
      ...['off', 'gm', 'all'].map((t) => ({ icon: (l.tag || 'off') === t ? 'check' : null, checked: (l.tag || 'off') === t, label: { off: 'Off', gm: 'Only me (my screen)', all: 'Players see it too' }[t], action: () => cmd('layer.update', { id: l.id, tag: t }) })),
    ]);
  }
  async function renameToken(l) {
    const v = await askText(`Rename ${l.name}${l.n ? ` ${l.n}` : ''}`, `${l.name}${l.n ? ` ${l.n}` : ''}`, { ok: 'Rename', placeholder: 'Grimgor the Bold' });
    if (!v) return;
    // a name of its own: out of the numbering (Goblin 3 becomes "Grimgor", not "Grimgor 3")
    cmd('layer.update', { id: l.id, name: v, n: null, named: true, stepLabel: 'Rename' });
  }
  async function renameGroup(l, group) {
    const v = await askText(`Rename all ${group.length} ${l.name}`, l.name, { ok: 'Rename', placeholder: 'Goblin archer' });
    if (!v || v === l.name) return;
    cmd('layer.many', { patches: group.map((x) => ({ id: x.id, name: v })), stepLabel: 'Rename' }); // they keep their numbers
  }
  function tokenCard(l) {
    const lit = tokenLight(l.id);
    const tag = TAG_LOOK[l.tag || 'off'];
    return [
      h('button', { class: 'card-title card-name ellipsis', 'data-tip': 'Rename, name tag', onclick: (e) => nameMenu(e.currentTarget, l) }, iconEl('user'), `${l.name}${l.n ? ` ${l.n}` : ''}`, iconEl('pencil', 'card-pen')),
      ib(tag.icon, `${tag.tip}. Click to change`, (e) => nameMenu(e.currentTarget, l), { on: (l.tag || 'off') !== 'off', cls: `card-tag tag-${l.tag || 'off'}` }),
      ib('minus', 'Smaller', () => cmd('layer.update', { id: l.id, size: Math.max(0.5, l.size - 0.5) })),
      h('button', { class: `card-size ${tokSet().card === 'compact' ? '' : 'wide'}`, 'data-tip': `${PlayTools.sizeName(l.size)}. Click to change the size`, onclick: (e) => sizeMenu(e.currentTarget, l) },
        tokSet().card === 'compact' ? PlayTools.sizeShort(l.size) : PlayTools.sizeName(l.size)),
      ib('plus', 'Bigger', () => cmd('layer.update', { id: l.id, size: Math.min(8, l.size + 0.5) })),
      cardSep(),
      ib('rotate-clockwise', 'Turn 45°', () => cmd('layer.update', { id: l.id, rotation: ((l.rotation || 0) + 45) % 360 })),
      ib(l.hidden ? 'eye-off' : 'eye', l.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => cmd('layer.update', { id: l.id, hidden: !l.hidden }), { on: l.hidden, key: 'H' }),
      ib('bulb', lit ? 'Carries a light. Click to put it out' : 'Carry a light (torch)', () => toggleTokenLight(l), { on: !!lit }),
      ib('copy', 'Duplicate', () => duplicateToken(l)),
      ib('trash', 'Remove', () => undoable('layer.remove', { id: l.id }), { danger: true, key: 'Del' }),
    ];
  }
  // =====================================================================
  // Prototype 17: a player's token. Its own toolbar (sight, the light they carry, darkvision, movement, HP) and,
  // from its name, the player panel. What it sees and carries belongs to the character (the whole campaign).
  // =====================================================================
  const pcOf = (l) => (l && S && S.pcTokens && S.pcTokens[l.id]) || null;
  const pcCard = (name) => ((S && S.chars) || []).find((c) => c.name === name) || null;
  const CARRY_LOOK = { none: ['No light', 'circle-off'], candle: ['Candle', 'candle'], torch: ['Torch', 'flame'], lantern: ['Lantern', 'lamp'], light: ['Light', 'sparkles'], daylight: ['Daylight', 'sun'], custom: ['Own light', 'bulb'] };
  const CARRY_FT = { none: [0, 0], candle: [5, 10], torch: [20, 40], lantern: [30, 60], light: [20, 40], daylight: [60, 120] };
  const carryTip = (k) => (k === 'none' ? 'No light of their own' : k === 'custom' ? 'Their own bright and dim light' : `${CARRY_LOOK[k][0]}: ${CARRY_FT[k][0]} ft bright, light to ${CARRY_FT[k][1]} ft`);
  const DV_STEPS = [0, 30, 60, 90, 120];
  const charSet = (name, patch) => cmd('char.set', { name, patch });
  const chip = (iconName, text, tip, onclick, o = {}) => h('button', { class: `card-chip ${o.on ? 'on' : ''} ${o.off ? 'off' : ''} ${o.cls || ''}`, 'data-tip': tip, 'aria-label': tip, onclick }, iconEl(iconName), h('span', {}, text));
  const menuAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 6]; };
  function lightMenu(e, name, c) {
    openMenu(...menuAt(e), [{ header: `${name} carries` },
      ...Object.keys(CARRY_FT).map((k) => ({ icon: c.carry === k ? 'check' : CARRY_LOOK[k][1], checked: c.carry === k, label: k === 'none' ? 'No light' : `${CARRY_LOOK[k][0]} · ${CARRY_FT[k][0]} / ${CARRY_FT[k][1]} ft`, action: () => charSet(name, { carry: k }) })),
      '-', { icon: c.carry === 'custom' ? 'check' : 'adjustments-horizontal', checked: c.carry === 'custom', label: 'Own light … (the player panel)', action: () => { charSet(name, { carry: 'custom' }); openPlayer(name); } }]);
  }
  function dvMenu(e, name, c) {
    openMenu(...menuAt(e), [{ header: `${name}: darkvision` },
      ...DV_STEPS.map((v) => ({ icon: (c.dark || 0) === v ? 'check' : null, checked: (c.dark || 0) === v, label: v ? `${v} ft` : 'None', action: () => charSet(name, { darkvision: v }) }))]);
  }
  function pcMoreMenu(e, l, name) {
    const tag = l.tag || 'off';
    openMenu(...menuAt(e), [{ header: `${l.name}${l.n ? ` ${l.n}` : ''} (${name})` },
      { icon: 'pencil', label: 'Rename the token …', action: () => renameToken(l) },
      { header: 'Name tag' },
      ...['off', 'gm', 'all'].map((t) => ({ icon: tag === t ? 'check' : null, checked: tag === t, label: { off: 'Off', gm: 'Only me (my screen)', all: 'Players see it too' }[t], action: () => cmd('layer.update', { id: l.id, tag: t }) })),
      '-',
      { icon: 'id-badge-2', label: `${name}'s character card …`, action: () => Characters.openEditor({ state: () => S, name }) },
      { icon: 'user-x', label: 'Not a player token', action: () => cmd('layer.update', { id: l.id, player: false, stepLabel: 'Not a player token' }) },
      { icon: 'trash', label: 'Remove the token', danger: true, action: () => undoable('layer.remove', { id: l.id }) }]);
  }
  function playerCard(l, name) {
    const c = pcCard(name) || { name, eye: true, carry: 'none' };
    const mv = ((S.players || {}).moves || {})[name];
    const phones = !!(S.players && S.players.on);
    const carry = CARRY_LOOK[c.carry] ? c.carry : 'none';
    const hp = c.hp ? `${c.hp.cur ?? '–'}/${c.hp.max ?? '–'}` : c.maxHp ? `${c.maxHp}` : null;
    const open = playerOpen(name);
    return [
      h('button', { class: 'card-title card-name card-pc ellipsis', style: c.color ? `--pcc:${c.color}` : '', 'data-tip': `${name}: the player panel (sight, light, movement, HP, phone)`, onclick: () => (open ? closePlayer() : openPlayer(name, l.id)) },
        h('i', { class: 'pc-dot' }), name, iconEl(open ? 'chevron-up' : 'chevron-down', 'pc-chev')),
      ib(c.eye ? 'eye' : 'eye-off', c.eye ? 'Sees for themselves and reveals the fog. Click: sight off' : 'Sight off: reveals nothing. Click to switch it on', () => charSet(name, { eye: !c.eye }), { on: c.eye, cls: 'pc-sight' }),
      chip(CARRY_LOOK[carry][1], carry === 'none' ? 'No light' : CARRY_LOOK[carry][0], `${carryTip(carry)}. Click to change`, (e) => lightMenu(e, name, c), { on: carry !== 'none', off: !c.eye }),
      chip('moon', c.dark ? `${c.dark} ft` : '–', c.dark ? `Darkvision ${c.dark} ft. Click to change` : 'No darkvision. Click to change', (e) => dvMenu(e, name, c), { on: !!c.dark, off: !c.eye }),
      mv ? chip('walk', phones && mv.left != null ? `${mv.left}/${mv.max}` : `${mv.speed} ft`, phones && mv.left != null ? `${mv.left} of ${mv.max} ft left this turn. Click: movement again` : `Speed ${mv.speed} ft. Click for movement`,
        () => (phones && mv.left != null ? ts.players('resetChar', { name }).then((r) => r && r.ok && toast(`${name}: movement again`, { ms: 1600 })) : openPlayer(name, l.id)), { cls: 'pc-move' }) : null,
      hp ? chip('heart', hp, c.hp ? 'HP now (from the turn order). Click to change' : 'Max HP. Click to change', () => openPlayer(name, l.id, 'hp'), { cls: `pc-hp ${c.down ? 'down' : ''}` }) : null,
      cardSep(),
      ib('minus', 'Smaller', () => cmd('layer.update', { id: l.id, size: Math.max(0.5, l.size - 0.5) })),
      h('button', { class: `card-size ${tokSet().card === 'compact' ? '' : 'wide'}`, 'data-tip': `${PlayTools.sizeName(l.size)}. Click to change the size`, onclick: (e) => sizeMenu(e.currentTarget, l) },
        tokSet().card === 'compact' ? PlayTools.sizeShort(l.size) : PlayTools.sizeName(l.size)),
      ib('plus', 'Bigger', () => cmd('layer.update', { id: l.id, size: Math.min(8, l.size + 0.5) })),
      ib('rotate-clockwise', 'Turn 45°', () => cmd('layer.update', { id: l.id, rotation: ((l.rotation || 0) + 45) % 360 })),
      ib(l.hidden ? 'eye-off' : 'eye', l.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => cmd('layer.update', { id: l.id, hidden: !l.hidden }), { on: l.hidden, key: 'H', cls: 'pc-hide' }),
      ib('dots', 'More: name tag, character card, not a player token, remove', (e) => pcMoreMenu(e, l, name)),
    ].filter(Boolean);
  }

  // ---------- the player panel (a floating panel; opens under the toolbar) ----------
  let pcPanel = null; // { name, id (the token it was opened from), focus }
  const playerOpen = (name) => !!(Floats && Floats.isOpen('player') && pcPanel && pcPanel.name === name);
  function closePlayer() { if (Floats) Floats.hide('player'); placeCard(); }
  function openPlayer(name, tokenId, focus) {
    if (!Floats) return;
    const was = pcPanel && pcPanel.name;
    pcPanel = { name, id: tokenId || (pcPanel && pcPanel.name === name ? pcPanel.id : null), focus: focus || null };
    if (Floats.isOpen('player') && was !== name) Floats.hide('player');
    if (Floats.isOpen('player')) { Floats.rebuild('player'); placeCard(); return; }
    Floats.show({
      id: 'player', title: name, icon: 'user', build: buildPlayerPanel, placeAlways: true,
      place: (r, el) => {
        const cr = els.card.classList.contains('on') ? els.card.getBoundingClientRect() : null;
        if (!cr) return null;
        const hgt = el.offsetHeight || 420; const w = el.offsetWidth || 340;
        const x = clamp(cr.left - r.left + cr.width / 2 - w / 2, 8, Math.max(8, r.width - w - 8));
        const below = cr.bottom - r.top + 8; const above = cr.top - r.top - hgt - 8;
        if (below + hgt < r.height - 8) return { x, y: below };
        if (above >= 8) return { x, y: above };
        // too tall for above or below: beside the toolbar, on the side with room
        const right = cr.right - r.left + 12; const left = cr.left - r.left - w - 12;
        return { x: right + w < r.width - 8 || left < 8 ? Math.min(right, r.width - w - 8) : left, y: clamp(cr.top - r.top, 8, Math.max(8, r.height - hgt - 8)) };
      },
      tips: PLAYER_TIPS,
    });
    placeCard();
  }
  function buildPlayerPanel() {
    const name = pcPanel.name;
    const C = () => pcCard(name) || { name, eye: true, carry: 'none' };
    const P = () => (S && S.players) || {};
    const set = (patch) => charSet(name, patch);
    const lab = (t) => h('div', { class: 'ctl-label' }, t);
    const tok = () => (map() ? map().layers.find((x) => x.id === pcPanel.id) : null) || (map() ? map().layers.find((x) => pcOf(x) === name) : null);
    const head = h('div', { class: 'pc-head' });
    bind(() => {
      const c = C();
      const sig = JSON.stringify([c.color, c.face, c.player]);
      if (head.dataset.sig === sig) return;
      head.dataset.sig = sig;
      head.style.setProperty('--pcc', c.color || 'var(--torch)');
      head.replaceChildren(c.face ? h('img', { class: 'pc-face', src: c.face, alt: '' }) : h('span', { class: 'pc-face' }, iconEl('user')),
        h('div', { class: 'grow' }, h('b', {}, name), c.player ? h('small', {}, `played by ${c.player}`) : null));
    });
    // sight
    const sight = h('div', { class: 'stack pc-sec' }, lab('Sight'),
      toggle({ label: 'Sees for themselves (reveals the fog)', get: () => C().eye, set: (v) => set({ eye: v }) }),
      seg({ label: 'Darkvision', cls: 'seg-5', options: DV_STEPS.map((v) => ({ value: v, label: v ? `${v} ft` : 'None' })), get: () => C().dark || 0, set: (v) => set({ darkvision: v }) }),
      stepper({ name: 'Sight', label: 'How far they see', get: () => C().sight || 0, set: (v) => set({ sight: v }), fmt: (v) => (v ? `${v} ft` : 'to the walls'),
        prev: (v) => Math.max(0, v - (v > 60 ? 30 : 10)), next: (v) => Math.min(600, v + (v >= 60 ? 30 : 10)) }));
    // the light they carry
    const custom = h('div', { class: 'stack' },
      stepper({ name: 'Bright', label: 'Bright light', get: () => C().bright ?? 20, set: (v) => set({ carry: 'custom', bright: v }), fmt: (v) => `${v} ft`, prev: (v) => Math.max(0, v - 5), next: (v) => Math.min(120, v + 5) }),
      stepper({ name: 'Dim', label: 'Dim light to', get: () => C().dim ?? 40, set: (v) => set({ carry: 'custom', dim: v }), fmt: (v) => `${v} ft`, prev: (v) => Math.max(0, v - 5), next: (v) => Math.min(240, v + 5) }));
    bind(() => { custom.hidden = C().carry !== 'custom'; });
    const light = h('div', { class: 'stack pc-sec' }, lab('The light they carry'),
      tiles(Object.keys(CARRY_LOOK).map((k) => ({ id: k, label: CARRY_LOOK[k][0], icon: CARRY_LOOK[k][1], tip: carryTip(k) })), () => C().carry || 'none', (v) => set({ carry: v })),
      custom);
    // movement
    const moveNote = h('p', { class: 'hint' });
    bind(() => {
      const m = (P().moves || {})[name]; const sp = (m && m.speed) || C().speed || 30;
      moveNote.textContent = !P().on ? `Speed ${sp} ft. Moving by phone is off, so no steps are counted.`
        : m && m.left != null ? `${m.left} of ${m.max} ft left this turn${m.dashed ? ' (dashed)' : ''}.` : `Speed ${sp} ft: walks freely right now.`;
    });
    const moves = h('div', { class: 'pc-moves' });
    bind(() => { const list = C().moves || []; const sig = JSON.stringify(list); if (moves.dataset.sig === sig) return; moves.dataset.sig = sig; moves.replaceChildren(...list.map((x) => h('span', { class: 'pc-pill' }, iconEl('bolt'), `${x.name}${x.ft ? ` +${x.ft} ft` : ''}`))); });
    const movement = h('div', { class: 'stack pc-sec' }, lab('Movement'),
      stepper({ name: 'Speed', label: 'Speed', get: () => C().speed || 30, set: (v) => set({ speed: v }), fmt: (v) => `${v} ft`, prev: (v) => Math.max(5, v - 5), next: (v) => Math.min(120, v + 5) }),
      moves, moveNote,
      row(btn('Movement again', 'refresh', () => ts.players('resetChar', { name }).then((r) => r && r.ok && toast(`${name}: movement again`, { ms: 1600 })), { kind: 'small', tip: 'A fresh turn: their feet, Dash and extra moves again' }),
        btn('Extra moves …', 'pencil', () => Characters.openEditor({ state: () => S, name }), { kind: 'small ghost', tip: 'Cunning Action, Step of the Wind …: on the character card' })));
    // HP, AC, conditions
    const cols = () => ((S.init && S.init.cols) || []);
    const hpCol = () => cols().find((x) => x.kind === 'hp'); const condCol = () => cols().find((x) => x.kind === 'cond');
    const hpNow = h('b', { class: 'pc-hpnow' });
    const hpIn = h('input', { type: 'text', class: 'pc-hpin', placeholder: '12, −7, +5 or 12/20', 'aria-label': 'HP', spellcheck: 'false' });
    hpIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = hpIn.value.trim().replace('−', '-'); const c = C();
      let v = null; let m;
      if ((m = t.match(/^([+-])\s*(\d+)$/))) v = { delta: (m[1] === '-' ? -1 : 1) * Number(m[2]) };
      else if ((m = t.match(/^(\d+)\s*\/\s*(\d+)$/))) v = { cur: Number(m[1]), max: Number(m[2]) };
      else if ((m = t.match(/^(\d+)$/))) v = { cur: Number(m[1]) };
      if (!v) { toast('HP: type 12, −7, +5 or 12/20', { kind: 'error', ms: 2200 }); return; }
      if (c.entry && hpCol()) cmd('init.set', { id: c.entry, vals: { [hpCol().id]: v } });
      else if (v.max || v.cur) set({ hp: v.max || v.cur });
      hpIn.value = '';
    });
    const acIn = h('input', { type: 'number', min: 0, max: 40, class: 'pc-acin', 'aria-label': 'AC' });
    acIn.addEventListener('change', () => set({ ac: acIn.value === '' ? null : Number(acIn.value) }));
    const condBox = h('div', { class: 'pc-conds' });
    const combatNote = h('p', { class: 'hint' });
    bind(() => {
      const c = C();
      hpNow.textContent = c.hp ? `${c.hp.cur ?? '–'} / ${c.hp.max ?? '–'}` : c.maxHp ? `max ${c.maxHp}` : '–';
      hpNow.classList.toggle('danger-text', !!c.down);
      if (document.activeElement !== acIn) acIn.value = c.ac ?? '';
      combatNote.textContent = c.entry ? (hpCol() ? '' : 'The turn order has no HP column yet (Initiative → Column).') : 'Not in the turn order: HP here sets the max HP; conditions need the turn order.';
      combatNote.hidden = !combatNote.textContent;
      const list = c.cond || []; const can = !!(c.entry && condCol());
      const sig = JSON.stringify([list, can]);
      if (condBox.dataset.sig === sig) return;
      condBox.dataset.sig = sig;
      const save = (next) => cmd('init.set', { id: C().entry, vals: { [condCol().id]: next } });
      condBox.replaceChildren(...list.map((x) => h('button', { class: 'pc-pill cond', 'data-tip': 'Click to take it off', onclick: () => save(list.filter((y) => y !== x)) }, x, iconEl('x'))),
        ...(can ? [h('button', { class: 'btn small ghost', onclick: (e) => openMenu(...menuAt(e), CONDS.map((t) => ({ icon: list.includes(t) ? 'check' : 'tag', checked: list.includes(t), label: t, action: () => save(list.includes(t) ? list.filter((y) => y !== t) : [...list, t]) }))) }, iconEl('plus'), 'Condition')] : []));
    });
    const combat = h('div', { class: 'stack pc-sec', dataset: { sec: 'hp' } }, lab('HP, AC, conditions'),
      h('div', { class: 'pc-hprow' }, iconEl('heart'), hpNow, hpIn, h('span', { class: 'pc-ac' }, iconEl('shield'), acIn)), condBox, combatNote);
    // the phone
    const phone = h('div', { class: 'stack pc-sec' });
    bind(() => {
      const v = P(); const ph = (v.phones || []).find((d) => d.char === name);
      const free = (v.phones || []).filter((d) => d.char !== name);
      const sig = JSON.stringify([v.on, ph && [ph.id, ph.name, ph.connected], free.map((d) => [d.id, d.name, d.char])]);
      if (phone.dataset.sig === sig) return;
      phone.dataset.sig = sig;
      phone.replaceChildren(lab('Phone'),
        h('p', { class: 'hint' }, ph ? `On ${ph.name} (${ph.connected ? 'connected' : 'away'}).` : 'No phone holds this character.'),
        row(ph ? btn('Take it from the phone', 'user-off', () => ts.players('assign', { id: ph.id, name: null }), { kind: 'small' })
          : btn('Hand to a phone …', 'device-mobile', (e) => openMenu(...menuAt(e), free.length ? free.map((d) => ({ icon: 'device-mobile', label: `${d.name}${d.char ? ` (now ${d.char})` : ''}`, action: () => ts.players('assign', { id: d.id, name }) })) : [{ header: 'No phone has joined yet' }]), { kind: 'small' }),
          !v.on ? btn('Player phones …', 'device-gamepad-2', () => TB.openPanel('players'), { kind: 'small ghost', tip: 'Moving by phone is off: switch it on there' }) : null));
    });
    // the token
    const token = h('div', { class: 'stack pc-sec' }, lab('Token'),
      row(btn('Name tag …', 'tag', (e) => { const l = tok(); if (l) nameMenu(e.currentTarget, l); }, { kind: 'small' }),
        btn('Character card …', 'id-badge-2', () => Characters.openEditor({ state: () => S, name }), { kind: 'small' })),
      row(btn('Not a player token', 'user-x', () => { const l = tok(); if (l) { cmd('layer.update', { id: l.id, player: false, stepLabel: 'Not a player token' }); closePlayer(); } }, { kind: 'small ghost', tip: 'No longer a player token: no sight or light of its own (undo: its name menu)' })));
    const body = h('div', { class: 'stack pc-panel' }, head, sight, light, movement, combat, phone, token);
    if (pcPanel.focus === 'hp') setTimeout(() => { hpIn.focus(); combat.scrollIntoView({ block: 'nearest' }); }, 60);
    pcPanel.focus = null;
    return body;
  }
  const CONDS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhausted', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
  function spellCard(sp) {
    return [
      h('span', { class: 'card-title ellipsis' }, skinDot(sp.skin), sp.name),
      ib('bolt', 'Cast again', () => cmd('spell.burst', { id: sp.id }), { tip: 'Play the cast again (with sound)' }),
      ib(sp.muted ? 'volume-off' : 'volume', sp.muted ? 'Silent. Click to play its sound' : 'Plays a sound. Click to keep this one silent', () => cmd('spell.update', { id: sp.id, muted: !sp.muted }), { on: sp.muted }),
      ib('palette', 'Colour', (e) => colorMenu(e.currentTarget, sp.color, (c) => cmd('spell.update', { id: sp.id, color: c }))),
      directional(sp.shape) && !sp.attachTo ? ib('rotate-clockwise', 'Turn 15° (or Ctrl + wheel over it)', () => cmd('spell.update', { id: sp.id, angle: normAngle((sp.angle || 0) + 15) })) : null,
      cardSep(),
      ib('minus', 'One round less', () => cmd('spell.update', { id: sp.id, rounds: sp.rounds == null ? null : Math.max(0, sp.rounds - 1) })),
      h('button', { class: `card-size ${sp.duration ? 'wide' : ''}`, 'data-tip': sp.rounds == null ? 'Start counting rounds' : sp.duration ? `Round ${sp.rounds} of ${sp.duration}. Click to stop counting` : 'Rounds. Click to stop counting', onclick: () => cmd('spell.update', { id: sp.id, rounds: sp.rounds == null ? 1 : null, ...(sp.rounds != null ? { duration: null } : {}) }) }, sp.rounds == null ? '–' : sp.duration ? `${sp.rounds} / ${sp.duration}` : String(sp.rounds)),
      ib('plus', 'One round more', () => cmd('spell.update', { id: sp.id, rounds: (sp.rounds ?? 0) + 1 })),
      ib('clock', sp.duration ? `Lasts ${durText(sp.duration)}. Click to change` : 'How long it lasts (ends by itself on Next round)', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(r.left, r.bottom + 6, DURS.map((d) => ({ icon: (sp.duration ?? null) === d ? 'check' : null, checked: (sp.duration ?? null) === d, label: durText(d), action: () => cmd('spell.update', { id: sp.id, duration: d, ...(d ? { mode: 'stay' } : {}) }) })));
      }, { on: !!sp.duration }),
      cardSep(),
      ib('hourglass', sp.mode === 'stay' ? 'Stays until removed. Click to let it fade' : 'Fades after a few seconds. Click to keep it', () => cmd('spell.update', { id: sp.id, mode: sp.mode === 'stay' ? 'burst' : 'stay' }), { on: sp.mode === 'stay' }),
      ib('grid-4x4', sp.squares ? 'Players see the affected squares. Click to hide them' : 'Affected squares hidden. Click to show', () => cmd('spell.update', { id: sp.id, squares: !sp.squares }), { on: sp.squares }),
      ib(sp.hidden ? 'eye-off' : 'eye', sp.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => cmd('spell.update', { id: sp.id, hidden: !sp.hidden }), { on: sp.hidden, key: 'H' }),
      ib('trash', 'Remove', () => undoable('spell.remove', { id: sp.id }), { danger: true, key: 'Del' }),
    ].filter(Boolean);
  }
  function colorMenu(anchor, current, set) {
    const r = anchor.getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, FXDATA.COLORS.map((c) => ({
      icon: c.hex ? 'circle' : 'circle-off', label: c.label, checked: (current || null) === c.hex, action: () => set(c.hex), swatch: c.hex,
    })));
  }
  const normAngle = (a) => { let x = ((a % 360) + 360) % 360; if (x > 180) x -= 360; return Math.round(x * 100) / 100; };
  function fxCard(f) {
    const light = f.kind === 'light';
    const out = [h('span', { class: 'card-title ellipsis' }, iconEl(SceneView.fxIcon(f)), fxLabel(f)),
      ib('adjustments-horizontal', 'Colour, strength and more', () => { ui.fxMode = LOOK_GROUP[f.kind] || 'place'; openPop('fx'); })];
    if (light) {
      out.push(
        ib('minus', 'Less light', () => cmd('fx.update', { id: f.id, bright: Math.max(0, f.bright - 5), dim: Math.max(5, f.dim - 10) })),
        h('span', { class: 'card-size wide', 'data-tip': 'Bright / dim light' }, `${f.bright}/${f.dim} ft`),
        ib('plus', 'More light', () => cmd('fx.update', { id: f.id, bright: f.bright + 5, dim: f.dim + 10 })));
    } else if (f.kind === 'emitter') {
      out.push(
        ib('minus', 'Smaller', () => cmd('fx.update', { id: f.id, r: round(Math.max(0.1, f.r / 1.25), 3) })),
        ib('plus', 'Bigger', () => cmd('fx.update', { id: f.id, r: round(Math.min(8, f.r * 1.25), 3) })));
    } else {
      out.push(
        ib('minus', 'Weaker', () => cmd('fx.update', { id: f.id, intensity: round(Math.max(0.1, (f.intensity ?? 1) - 0.2), 2) })),
        ib('plus', 'Stronger', () => cmd('fx.update', { id: f.id, intensity: round(Math.min(2, (f.intensity ?? 1) + 0.2), 2) })));
    }
    out.push(cardSep(),
      f.attachTo ? ib('user-circle', 'Carried by a token. Click to leave it here', () => { const p = view.fxPos(f); cmd('fx.update', { id: f.id, attachTo: null, x: p.x, y: p.y }); }, { on: true }) : null,
      ib(f.hidden ? 'eye-off' : 'eye', f.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => cmd('fx.update', { id: f.id, hidden: !f.hidden }), { on: f.hidden, key: 'H' }),
      ib('trash', 'Remove', () => undoable('fx.remove', { id: f.id }), { danger: true, key: 'Del' }));
    return out.filter(Boolean);
  }
  async function duplicateToken(l) {
    const r = await cmd('layer.duplicate', { id: l.id, dx: grid().size, dy: 0 });
    if (r.selected) { ui.selected = r.selected; view.setSelected(r.selected); placeCard(); }
  }
  function toggleTokenLight(l) {
    const lit = tokenLight(l.id);
    if (lit) { cmd('fx.remove', { id: lit.id }); return; }
    const d = LIGHTS.find((x) => x.id === ui.light) || LIGHTS[1];
    cmd('fx.add', { kind: 'light', preset: d.id, attachTo: l.id, x: l.x, y: l.y, bright: d.bright, dim: d.dim, color: d.color, ...(d.cone ? { cone: d.cone, angle: 0 } : {}) });
    if (!map().light.darkness) toast(`${l.name} carries a ${d.label.toLowerCase()}. It shows once the map is dark (Effects → Light).`);
  }
  function selectSpell(id) {
    ui.selSpell = id;
    view.selectSpell(id);
    if (id) { ui.selected = null; view.setSelected(null); }
    placeCard();
  }
  // where a dragged effect lands: a party locked to the grid jumps from square to square
  function fxDropAt(d, pt) {
    const x = pt.x + d.dx; const y = pt.y + d.dy;
    const f = fxOf(d.id);
    if (!f || f.preset !== 'party' || f.snap === false) return { x, y };
    const q = Geom.snap(grid(), x, y, 1);
    return { x: round(q.x, 3), y: round(q.y, 3) };
  }
  function selectFx(id) {
    ui.selFx = id;
    view.selectFx(id);
    placeCard();
    // the Effects popover shows the options of the selected effect
    const f = fxOf(id);
    if (f && f.kind === 'light' && ui.lightTab !== 'sources') { ui.lightTab = 'sources'; if (ui.fxMode === 'light' && popId === 'fx') { openPop('fx'); return; } }
    if (f && ui.tool === 'fx' && LOOK_GROUP[f.kind] && LOOK_GROUP[f.kind] !== ui.fxMode) { ui.fxMode = LOOK_GROUP[f.kind]; if (popId === 'fx') openPop('fx'); else refreshPop(); } else refreshPop();
  }

  // =====================================================================
  // Radial menu
  // =====================================================================
  function openRadial(clientX, clientY, target) {
    const pt = view.toMap(clientX, clientY);
    const markEl = target && target.closest && target.closest('.sv-mark, .sv-note, .sv-text');
    if (markEl && Tools.markRadial(markEl.dataset.id, clientX, clientY)) return;
    const handle = target && target.closest && target.closest('.sv-handle');
    if (handle) { fxRadial(fxOf(handle.dataset.id), clientX, clientY); return; }
    const doorEl = target && target.closest && target.closest('.sv-door');
    if (doorEl && Walls.radial(map().walls.find((w) => w.id === doorEl.dataset.id), clientX, clientY)) return;
    if (ui.tool === 'walls' && Walls.radial(view.wallAtScreen(clientX, clientY, 9), clientX, clientY)) return;
    const assetEl = ui.tool === 'asset' && target && target.closest && target.closest('.sv-asset');
    if (assetEl && layer(assetEl.dataset.id)) { assetRadial(layer(assetEl.dataset.id), clientX, clientY); return; }
    const tokEl = document.elementsFromPoint(clientX, clientY).find((e) => e.classList && e.classList.contains('sv-token'));
    const l = tokEl ? layer(tokEl.dataset.id) : null;
    if (l) { tokenRadial(l, pt, clientX, clientY); return; }
    const label = target && target.closest && target.closest('.sv-spell-label');
    const sid = label ? label.dataset.id : view.spellAt(pt.x, pt.y);
    if (sid) { spellRadial(spellOf(sid), pt, clientX, clientY); return; }
    const roomR = 3 / zoom();
    const area = areaAt(pt); const room = area ? null : roomAt(pt); // a marked area wins over the walled room
    Radial.open(clientX, clientY, [
      { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S.editMapId, ...pt }) },
      area ? { icon: 'polygon', label: `Reveal ${area.name}`, run: () => revealRings(area.rings, 'reveal', pt, area.name) }
        : room ? { icon: 'door', label: 'Reveal room', run: () => revealRings(room.rings, 'reveal', pt) }
          : { icon: 'eye', label: 'Reveal here', run: () => cmd('fog.op', { mode: 'reveal', shape: 'circle', x: pt.x, y: pt.y, r: roomR }) },
      trayItems().length
        ? { icon: 'bookmarks', label: 'Ready', keep: true, run: () => trayRadial(pt, clientX, clientY) }
        : { icon: 'user', label: 'Add token', run: () => Drawer.open({ cat: 'tokens', purpose: 'place', at: pt }) },
      { icon: 'wand', label: 'Cast spell', keep: true, run: () => castRadial(pt, clientX, clientY) },
      { icon: 'flame', label: 'Effect', keep: true, run: () => effectRadial(pt, clientX, clientY) },
      { icon: 'sun-moon', label: 'Light', keep: true, run: () => moodRadial(clientX, clientY) },
      isLive()
        ? { icon: 'screen-share-off', label: S.table.blackout ? 'Unblack' : 'Blackout', run: () => cmd('table.blackout') }
        : { icon: 'cast', label: 'Send to table', run: () => cmd('table.send') },
      { icon: 'arrow-back-up', label: 'Undo', disabled: !S.history.canUndo, run: () => cmd('history.undo') },
      area ? { icon: 'eye-off', label: `Cover ${area.name}`, run: () => revealRings(area.rings, 'cover', pt, area.name) }
        : room ? { icon: 'eye-off', label: 'Cover room', run: () => revealRings(room.rings, 'cover', pt) }
          : { icon: 'eye-off', label: 'Cover here', run: () => cmd('fog.op', { mode: 'cover', shape: 'circle', x: pt.x, y: pt.y, r: roomR }) },
    ], 'Here');
  }
  function tokenRadial(l, pt, x, y) {
    ui.selected = l.id; view.setSelected(l.id);
    if (ui.tool !== 'select') setTool('select');
    ui.selected = l.id; view.setSelected(l.id); placeCard();
    const lit = tokenLight(l.id);
    // Prototype 14 / 17: a player's token: the player panel and their sight instead of Duplicate and a light
    const pc = pcOf(l);
    if (pc) {
      const c = pcCard(pc) || { eye: true };
      Radial.open(x, y, [
        { icon: 'plus', label: 'Bigger', run: () => cmd('layer.update', { id: l.id, size: Math.min(8, l.size + 0.5) }) },
        { icon: 'rotate-clockwise', label: 'Turn', run: () => cmd('layer.update', { id: l.id, rotation: ((l.rotation || 0) + 45) % 360 }) },
        { icon: l.hidden ? 'eye' : 'eye-off', label: l.hidden ? 'Show' : 'Hide', run: () => cmd('layer.update', { id: l.id, hidden: !l.hidden }) },
        { icon: 'user', label: 'Player …', run: () => openPlayer(pc, l.id) },
        { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('layer.remove', { id: l.id }) },
        { icon: c.eye ? 'eye-off' : 'eye', label: c.eye ? 'Sight off' : 'Sight on', run: () => charSet(pc, { eye: !c.eye }) },
        ...showItems(l),
        { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S.editMapId, ...pt }) },
        { icon: 'minus', label: 'Smaller', run: () => cmd('layer.update', { id: l.id, size: Math.max(0.5, l.size - 0.5) }) },
      ], `${l.name} (${pc})`);
      return;
    }
    Radial.open(x, y, [
      { icon: 'plus', label: 'Bigger', run: () => cmd('layer.update', { id: l.id, size: Math.min(8, l.size + 0.5) }) },
      { icon: 'rotate-clockwise', label: 'Turn', run: () => cmd('layer.update', { id: l.id, rotation: ((l.rotation || 0) + 45) % 360 }) },
      { icon: l.hidden ? 'eye' : 'eye-off', label: l.hidden ? 'Show' : 'Hide', run: () => cmd('layer.update', { id: l.id, hidden: !l.hidden }) },
      { icon: 'copy', label: 'Duplicate', run: () => duplicateToken(l) },
      { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('layer.remove', { id: l.id }) },
      { icon: 'bulb', label: lit ? 'Put out light' : 'Carry light', run: () => toggleTokenLight(l) },
      ...showItems(l),
      { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S.editMapId, ...pt }) },
      { icon: 'minus', label: 'Smaller', run: () => cmd('layer.update', { id: l.id, size: Math.max(0.5, l.size - 0.5) }) },
    ], l.name);
  }
  // Beta 3.2: show a token to the table (table-show.js): only for the map on the table. While one turns, more join it.
  function showItems(l) {
    if (!S || !S.table || S.table.liveMapId !== S.editMapId) return [];
    const sh = S.show && S.show.phase === 'show' && S.show.mapId === S.editMapId ? S.show : null;
    if (sh && sh.ids.includes(l.id)) return [{ icon: 'rotate-360', label: 'Bring back', run: () => cmd('show.end') }];
    const go = (reveal) => cmd('show.start', { id: l.id, reveal }).then((r) => { if (r && !r.ok && r.error) toast(r.error, { kind: 'error' }); });
    const items = [{ icon: 'rotate-360', label: sh ? 'Add to the show' : 'Show to the table', run: () => go(false) }];
    if (l.hidden) items.push({ icon: 'eye-check', label: sh ? 'Add and reveal' : 'Show and reveal', run: () => go(true) });
    return items;
  }
  function spellRadial(sp, pt, x, y) {
    if (ui.tool !== 'spell' && ui.tool !== 'select') setTool('select');
    selectSpell(sp.id);
    Radial.open(x, y, [
      { icon: 'bolt', label: 'Cast again', run: () => cmd('spell.burst', { id: sp.id }) },
      { icon: 'plus', label: 'Round +1', run: () => cmd('spell.update', { id: sp.id, rounds: (sp.rounds ?? 0) + 1 }) },
      { icon: sp.hidden ? 'eye' : 'eye-off', label: sp.hidden ? 'Show' : 'Hide', run: () => cmd('spell.update', { id: sp.id, hidden: !sp.hidden }) },
      { icon: 'hourglass', label: sp.mode === 'stay' ? 'Let it fade' : 'Keep it', run: () => cmd('spell.update', { id: sp.id, mode: sp.mode === 'stay' ? 'burst' : 'stay' }) },
      { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('spell.remove', { id: sp.id }) },
      { icon: 'grid-4x4', label: sp.squares ? 'Hide squares' : 'Show squares', run: () => cmd('spell.update', { id: sp.id, squares: !sp.squares }) },
      { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S.editMapId, ...pt }) },
      { icon: 'minus', label: 'Round −1', disabled: sp.rounds == null, run: () => cmd('spell.update', { id: sp.id, rounds: Math.max(0, (sp.rounds ?? 1) - 1) }) },
    ], sp.name);
  }
  function fxRadial(f, x, y) {
    if (!f) return;
    selectFx(f.id);
    const light = f.kind === 'light';
    Radial.open(x, y, [
      { icon: 'plus', label: light ? 'More light' : 'Bigger', run: () => cmd('fx.update', light ? { id: f.id, bright: f.bright + 5, dim: f.dim + 10 } : f.kind === 'region' ? { id: f.id, intensity: Math.min(2, (f.intensity ?? 1) + 0.2) } : { id: f.id, r: f.r * 1.25 }) },
      { icon: f.hidden ? 'eye' : 'eye-off', label: f.hidden ? 'Show' : 'Hide', run: () => cmd('fx.update', { id: f.id, hidden: !f.hidden }) },
      f.attachTo
        ? { icon: 'user-circle', label: 'Leave here', run: () => { const p = view.fxPos(f); cmd('fx.update', { id: f.id, attachTo: null, x: p.x, y: p.y }); } }
        : { icon: 'copy', label: 'Duplicate', disabled: f.kind === 'region', run: () => cmd('fx.add', { ...f, x: f.x + grid().size, y: f.y }) },
      { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('fx.remove', { id: f.id }) },
      { icon: 'minus', label: light ? 'Less light' : 'Smaller', run: () => cmd('fx.update', light ? { id: f.id, bright: Math.max(0, f.bright - 5), dim: Math.max(5, f.dim - 10) } : f.kind === 'region' ? { id: f.id, intensity: Math.max(0.1, (f.intensity ?? 1) - 0.2) } : { id: f.id, r: f.r / 1.25 }) },
    ], fxLabel(f));
  }
  const DEFAULT_RECENT = ['Fireball', 'Burning Hands', 'Thunderwave', 'Lightning Bolt', 'Fog Cloud', 'Spirit Guardians', 'Darkness'];
  function castRadial(pt, x, y) {
    const names = [...ui.recent, ...DEFAULT_RECENT.filter((n) => !ui.recent.includes(n))].slice(0, 7);
    const items = names.map((n) => SPELLS.find((s) => s.name === n)).filter(Boolean).map((sp) => ({
      icon: (SKINS[sp.skin] || SKINS.arcane).icon, label: sp.name, cls: `skin-${sp.skin}`, run: () => castAt(sp, pt),
    }));
    items.push({ icon: 'dots', label: 'More spells', run: () => { setTool('spell'); openPop('spell'); } });
    Radial.open(x, y, items, 'Cast');
  }
  // the chapter's Ready list, ready to drop where the GM right-clicked (Prototype 26: it was the "Tonight" tray)
  const trayItems = () => Ready.all().filter((t) => !t.missing && t.cat !== 'maps');
  function trayRadial(pt, x, y) {
    const items = trayItems().slice(0, 7).map((t) => ({
      icon: { tokens: 'user', assets: 'trees', overlays: 'sparkles', sounds: 'music', portraits: 'messages', handouts: 'script' }[t.cat] || 'photo', label: t.name,
      // a picture of the thing itself (tokens, assets, portraits, handouts)
      thumb: (t.kind === 'image' || t.kind === 'video') && t.cat !== 'sounds' ? { path: t.path, kind: t.kind } : null,
      run: () => Drawer.useAt(t, pt),
    }));
    items.push({ icon: 'photo', label: 'Library', run: () => Drawer.open({ cat: 'tokens', purpose: 'place', at: pt }) });
    Radial.open(x, y, items, 'Ready');
  }
  function effectRadial(pt, x, y) {
    Radial.open(x, y, EMITTERS.map((d) => ({
      icon: d.icon, label: d.label, run: () => placeEmitter(d, pt),
    })), 'Effect');
  }
  function placeEmitter(d, pt) {
    const L = ui.look;
    return cmd('fx.add', {
      kind: 'emitter', preset: d.id, x: pt.x, y: pt.y, r: round(d.r * ui.fxSize * cellK(), 4), color: L.color || d.color || null,
      intensity: L.intensity, density: L.density, speed: L.speed, flicker: L.flicker,
      bright: d.light ? d.light.bright : 0, dim: d.light ? d.light.dim : 0,
      sat: L.sat ?? (L.color ? 0.7 : 0.25),
      ...(d.turn ? { angle: L.angle ?? defaultAngle(d) } : {}), ...(d.kinds ? { variant: L.variant || d.kinds[0][0] } : {}), ...(d.light && L.wave ? { wave: L.wave } : {}),
      ...(d.id === 'shaft' || d.id === 'window' ? { dust: L.dust ?? 1 } : {}),
      ...(d.id === 'window' ? { shape: L.shape || LOOK_DEFAULT.shape, grid: L.grid || LOOK_DEFAULT.grid, stretch: L.stretch ?? LOOK_DEFAULT.stretch } : {}),
    });
  }
  function placeLight(d, pt, tok) {
    const L = ui.look;
    return cmd('fx.add', { kind: 'light', preset: d.id, x: pt.x, y: pt.y, attachTo: tok ? tok.id : null, bright: d.bright, dim: d.dim, color: L.color || d.color, intensity: Math.min(1, L.intensity), flicker: d.id === 'party' || d.id === 'moon' || d.id === 'light' ? false : L.flicker, sat: L.sat ?? (L.color ? 0.7 : 0.25),
      ...(d.cone ? { cone: d.cone, angle: L.angle ?? 0 } : {}), ...(L.wave ? { wave: L.wave } : {}) });
  }

  const Radial = (() => {
    let el = null;
    function open(x, y, items, title) {
      close();
      const R = Math.max(112, Math.round((items.length * 86) / (2 * Math.PI))); // more items: a wider ring
      el = h('div', { id: 'radial', role: 'menu' });
      const center = h('div', { class: 'radial-center' }, h('span', {}, title));
      el.append(center);
      items.forEach((it, i) => {
        const a = (-90 + (360 / items.length) * i) * (Math.PI / 180);
        const b = h('button', {
          class: `radial-item ${it.danger ? 'danger' : ''} ${it.cls || ''}`, role: 'menuitem', disabled: it.disabled,
          style: { left: `${Math.cos(a) * R}px`, top: `${Math.sin(a) * R}px` },
          onpointerenter: () => { center.firstChild.textContent = it.label; },
          onpointerleave: () => { center.firstChild.textContent = title; },
          onclick: () => { if (!it.keep) close(); it.run(); },
        }, it.thumb ? h('span', { class: 'radial-thumb' }, Thumbs.img(it.thumb.path, it.thumb.kind, null, 'thumb')) : iconEl(it.icon), h('span', {}, it.label));
        if (it.thumb) b.classList.add('has-thumb');
        el.append(b);
      });
      document.body.append(el);
      const m = R + 50;
      el.style.left = `${clamp(x, m, innerWidth - m)}px`;
      el.style.top = `${clamp(y, m, innerHeight - m)}px`;
      requestAnimationFrame(() => el && el.classList.add('on'));
    }
    function close() { if (el) { el.remove(); el = null; } }
    document.addEventListener('pointerdown', (e) => { if (el && !e.target.closest('#radial')) close(); }, true);
    return { open, close, get isOpen() { return !!el; } };
  })();

  // =====================================================================
  // Spell placement
  // =====================================================================
  function snapHalf(g, p) {
    if (Geom.isHex(g)) return Geom.snap(g, p.x, p.y, 1);
    const { u, v } = Geom.toLocal(g, p.x, p.y);
    const q = g.size / 2;
    return Geom.fromLocal(g, Math.round(u / q) * q, Math.round(v / q) * q);
  }
  // Where a spell starts for a pointer position. 5e: spheres start at a grid intersection.
  function castOrigin(p, alt) {
    const g = grid();
    if (alt) return { x: p.x, y: p.y };
    const s = ui.spell.shape;
    if (s === 'sphere' || s === 'cylinder') return Geom.isHex(g) ? Geom.snap(g, p.x, p.y, 1) : Geom.snap(g, p.x, p.y, 2);
    if (s === 'cone' || s === 'line') return snapHalf(g, p);
    return { x: p.x, y: p.y };
  }
  const directional = (shape) => shape === 'cone' || shape === 'line' || shape === 'cube';
  function aimAngle(o, p, shift) {
    let a = Math.atan2(p.y - o.y, p.x - o.x) / D2R;
    if (shift) a = Math.round(a / 15) * 15;
    return a;
  }
  // A cube clicked (not dragged) is centred on the click.
  function centredCube(p, angle, alt) {
    const g = grid();
    const c = alt ? p : Geom.snap(g, p.x, p.y, ui.spell.size / 5);
    const half = Geom.ftToIn(g, ui.spell.size) / 2;
    return { x: c.x - Math.cos(angle * D2R) * half, y: c.y - Math.sin(angle * D2R) * half };
  }
  function tokenUnder(clientX, clientY) {
    const el = document.elementsFromPoint(clientX, clientY).find((e) => e.classList && e.classList.contains('sv-token'));
    return el ? layer(el.dataset.id) : null;
  }
  // The spell as it would be cast from the current pointer state.
  function spellFromPointer(p, o) {
    const s = ui.spell;
    const base = { name: s.name, shape: s.shape, size: s.size, width: s.width, skin: s.skin, mode: s.mode, squares: s.squares, color: s.color || null };
    if (s.shape === 'aura' && o.token) return { ...base, x: o.token.x, y: o.token.y, attachTo: o.token.id, angle: 0 };
    if (o.origin && (o.moved || ui.aimFrom)) {
      const angle = directional(s.shape) ? aimAngle(o.origin, p, o.shift) : 0;
      if (directional(s.shape)) return { ...base, x: o.origin.x, y: o.origin.y, angle };
    }
    if (s.shape === 'cube') { const c = centredCube(p, ui.spellAngle, o.alt); return { ...base, ...c, angle: ui.spellAngle }; }
    const at = castOrigin(p, o.alt);
    return { ...base, x: at.x, y: at.y, angle: directional(s.shape) ? ui.spellAngle : 0 };
  }
  let ghostState = null;
  function updateGhost(p = ghostState && ghostState.p, o = ghostState && ghostState.o) {
    if (ui.tool !== 'spell' || !S || !S.map || !p) { if (view && view.map) view.setGhost(null); return; }
    ghostState = { p, o };
    const sp = spellFromPointer(p, { ...o, origin: ui.aimFrom || (o && o.origin) });
    if (sp.attachTo) { const t = layer(sp.attachTo); view.setGhost(sp, { x: t.x, y: t.y }, ((t.size || 1) * grid().size) / 2); } else view.setGhost(sp);
  }
  // a screen moment as the spell lands (an explosion for a fireball, holy light for a blessing)
  function impactCtl() {
    const sel = h('select', { 'aria-label': 'Screen effect when cast', onchange: (e) => setSpell({ impact: e.target.value || null }) },
      h('option', { value: '' }, 'None'), ...Moments.LIST.filter((d) => d.dur).map((d) => h('option', { value: d.id }, d.label + (d.spot ? '' : ' (whole table)'))));
    bind(() => { if (document.activeElement !== sel) sel.value = ui.spell.impact || ''; });
    return h('label', { class: 'ctl', 'data-tip': 'Plays a screen effect where the spell lands (Toolbox → Screen effects)' }, h('span', { class: 'ctl-label' }, 'Screen effect when cast'), sel);
  }
  async function cast(sp) {
    if (directional(sp.shape)) ui.spellAngle = sp.angle;
    const r = await cmd('spell.add', { ...sp, rounds: ui.spell.count || ui.spell.duration ? 1 : null, duration: ui.spell.duration || null });
    if (r && r.ok && ui.spell.impact && Moments.BY[ui.spell.impact]) {
      const tpl = Geom.template(grid(), sp, null, 0);
      cmd('moment.play', { id: ui.spell.impact, x: tpl.cx, y: tpl.cy, mapId: S.editMapId });
    }
    if (r && r.ok) {
      const preset = SPELLS.find((x) => x.name === sp.name);
      if (preset) { ui.recent = [sp.name, ...ui.recent.filter((n) => n !== sp.name)].slice(0, 7); savePrefs(); }
      if (r.selected && ui.tool === 'spell') selectSpell(r.selected);
    }
    return r;
  }
  // From the radial menu: round areas land right away, cones and lines wait for a direction.
  function castAt(preset, pt) {
    pickSpell(preset);
    if (directional(preset.shape)) {
      setTool('spell');
      ui.aimFrom = castOrigin(pt, false);
      renderTopbar();
      updateGhost(pt, {});
      return;
    }
    const sp = spellFromPointer(pt, {});
    cast(sp);
  }

  // =====================================================================
  // The hotbar: using each kind of thing, and whether it is running
  // =====================================================================
  const isSfx = (r) => /^Audio\/SFX\//i.test(r.rel || '') || /\bsfx\b/i.test(r.rel || r.path || '');
  const libItem = (it) => ({ path: it.ref.path, name: it.label, kind: it.ref.kind || 'image', cat: it.ref.cat, url: UI.pathToUrl(it.ref.path) });
  function hotWhat(it) {
    const r = it.ref || {};
    return {
      token: 'pick it up, the next click on the map places it (or drag the slot onto the map)', asset: 'use it as the asset brush (or drag the slot onto the map)',
      portrait: 'into the conversation and out again', handout: 'show it on the table, again to put it away', overlay: 'on this map, again to take it off',
      sound: isSfx(r) ? 'play it once on the table' : 'play it on this map, again to stop it', mood: 'play this Spotify mood, again to pause it',
      moment: 'play it on the table', cue: 'play the cue', wheel: 'spin it on the table', roll: 'roll it on the table', death: 'a death save on the table',
      spell: 'cast it: the next click on the map', weather: 'this weather, again for none', light: 'this light', map: 'send it to the table', panel: 'open or close the panel',
      snap: r === 'next' ? 'the next snapshot of the map on the table' : 'play the snapshot (its transition, onto the table)',
      lights: ({ follow: 'room lights follow the table', room: 'normal room light', off: 'the lamps switch off', release: 'Tablescape lets go of the lamps', dim: 'the lamps 20 % darker', bright: 'the lamps 20 % brighter (while they are off: on again at 20 %)' })[r] || 'this lamp scene (again: back to the table)',
      tool: typeof r === 'string' && (r.includes(':') || (railItem(r) || {}).tool) ? 'switch to this tool (again: its panel)' : 'open or close it',
      door: 'open or close this door',
      do: doValue(r) ? doValue(r).def.what : ({ send: 'send this map to the table', blackout: 'blackout on or off', quiet: 'all table sound out, again to bring it back', next: 'next turn (no fight: next round)', fight: 'fight music on or off',
        strike: 'a lightning flash on the table', 'stop-moments': 'stop the screen effects that are on', grid: 'the grid on or off', fit: 'fit your view to the table', again: 'movement again for every phone',
        'fight-start': 'round 1 begins with the first in the list', 'fight-end': 'end the fight', prev: 'back one turn', 'roll-enemies': 'd20 + bonus for every enemy without a number', 'init-sort': 'highest first',
        'sp-toggle': 'pause Spotify, again to go on', 'sp-next': 'the next song', 'sel-hide': 'hide what is selected, again to show it', 'sel-lock': 'lock the selected assets, again to unlock',
        'sel-dup': 'a copy of the selected token or asset', 'page-next': 'the next page of this hotbar', 'page-prev': 'the page before' })[r] || '',
      fog: typeof r === 'object' && r ? 'reveal this marked area' : ({ toggle: 'fog on or off on this map', reveal: 'the fog tool: reveal', cover: 'the fog tool: cover', brush: 'the fog tool with the brush', rect: 'the fog tool with rectangles',
        room: 'the fog tool: a room at a click', 'reveal-all': 'reveal the whole map', 'cover-all': 'cover the whole map' })[r] || '',
    }[it.kind] || '';
  }
  function hotLive(it) {
    const r = it.ref || {};
    const m = S && S.map;
    switch (it.kind) {
      case 'token': return ui.tool === 'token' && ui.tok && ui.tok.brush && ui.tok.brush.path === r.path;
      case 'asset': return ui.tool === 'asset' && ui.brush && ui.brush.path === r.path;
      case 'portrait': return !!(S.talk && S.talk.cast.some((x) => x.path === r.path));
      case 'handout': return (S.handouts || []).some((x) => x.path === r.path);
      case 'overlay': return !!(m && m.layers.some((l) => l.role === 'overlay' && l.path === r.path));
      case 'sound': return !isSfx(r) && !!(m && m.layers.some((l) => l.role === 'audio' && l.path === r.path));
      case 'mood': return !!(S.spotify && S.spotify.playingMood === r && S.spotify.now && S.spotify.now.playing);
      case 'moment': return (S.moments || []).some((x) => x.id === r && !x.stop && Moments.alive(x, Date.now()));
      case 'weather': return !!(m && m.weather.name === it.label && m.weather.layers.some((l) => !l.dying));
      case 'light': return !!(m && m.light.mood === r);
      case 'map': return S.table.liveMapId === r;
      case 'panel': return !!(Floats && Floats.isOpen(r));
      case 'lights': { const L = S.lights; if (!L || !L.started || r === 'dim' || r === 'bright') return false; return ['follow', 'room', 'off', 'release'].includes(r) ? L.mode === r : L.mode === 'scene' && L.sceneId === r; }
      case 'spell': return ui.tool === 'spell' && ui.spell.name === r;
      case 'tool': return toolLive(r);
      case 'door': { const w = m && r && r.map === m.id && (m.walls || []).find((x) => x.id === r.id); return !!(w && (w.door ? w.open : !w.shut)); } // (Beta 3.1: a window, open)
      case 'do': return r === 'blackout' ? !!S.table.blackout : r === 'quiet' ? !!(S.sound && S.sound.quiet) : r === 'fight' ? !!(S.sound && S.sound.fightNow) : r === 'grid' ? !!(m && m.grid.show)
        : r === 'sp-toggle' ? !!(S.spotify && S.spotify.now && S.spotify.now.playing)
        : doValue(r) ? (doValue(r).key === 'timer' ? !!S.timer : doValue(r).key === 'break' ? !!S.brk : doValue(r).key === 'dark' ? !!(m && Math.round((m.light.darkness || 0) * 100) === doValue(r).v) : false) : false;
      case 'snap': { const lm = allMaps().find((x) => x.id === S.table.liveMapId); return r !== 'next' && !!(lm && (lm.snaps || []).some((x) => x.id === r && x.at)); }
      case 'fog':
        if (!m || typeof r !== 'string') return false;
        if (r === 'toggle') return !!m.fog.enabled;
        if (r === 'reveal' || r === 'cover') return ui.tool === 'fog' && ui.fogMode === r;
        if (r === 'brush' || r === 'rect' || r === 'room') return ui.tool === 'fog' && ui.fogShape === r;
        return false;
      default: return false;
    }
  }
  // the fog tools on the hotbar (offered in the Fog menu: drag them onto a slot, or right-click)
  const FOG_HOT = {
    toggle: { label: 'Fog on/off', icon: 'cloud-fog' }, reveal: { label: 'Reveal', icon: 'eye' }, cover: { label: 'Cover', icon: 'eye-off' },
    brush: { label: 'Fog: brush', icon: 'brush' }, rect: { label: 'Fog: rectangle', icon: 'square' }, room: { label: 'Fog: room', icon: 'door' },
    'reveal-all': { label: 'Reveal all', icon: 'sun' }, 'cover-all': { label: 'Cover all', icon: 'cloud' },
  };
  const fogHot = (k) => (FOG_HOT[k] ? { kind: 'fog', ref: k, ...FOG_HOT[k] } : null);
  // Prototype 24: tools and single actions on the hotbar. A tool is a rail button (its id) or a map tool of the Toolbox
  // ('point:ping' …): drag it onto a slot or right-click it. Actions: right-click their button, or an empty slot.
  const railItem = (id) => RAIL.flatMap((g) => (g && g.items) || []).find((x) => x.id === id);
  const HOT_RAIL = (it) => it && !it.pin && !['home', 'undo', 'redo', 'build', 'snaps'].includes(it.id);
  const toolHot = (id, label, icon) => ({ kind: 'tool', ref: id, label, icon });
  const mapToolMode = (t) => (t === 'point' ? ui.point && ui.point.mode : t === 'draw' ? ui.draw && ui.draw.mode : t === 'mark' ? (ui.mark && ui.mark.mode === 'counter' ? 'counter' : 'marker') : null);
  function toolLive(r) {
    if (typeof r !== 'string') return false;
    if (r.includes(':')) { const [t, mode] = r.split(':'); return ui.tool === t && mapToolMode(t) === mode; }
    const it = railItem(r);
    if (!it) return false;
    return it.tool ? ui.tool === r : r === 'library' ? !!ui.drawer : popId === r;
  }
  function toolRun(r) {
    if (typeof r !== 'string') return;
    if (r.includes(':')) { // a map tool: the mouse switches to it; pressed again, its panel opens
      const [t, mode] = r.split(':');
      if (toolLive(r)) { togglePop(t); return; }
      Tools.setMode(t, mode); setTool(t);
      return;
    }
    const it = railItem(r);
    if (it && HOT_RAIL(it)) railClick(it, railButton(r) || els.rail);
  }
  const HOT_RENAMED = { Moments: 'Screen effects', Talk: 'Conversation', Portraits: 'Conversation', /* (Prototype 30) */ 'Phone & tablet': 'Remote', 'Players\' phones': 'Player phones', Characters: 'Character cards', 'Fog brush': 'Fog: brush',
    'Fog rectangle': 'Fog: rectangle', Quiet: 'Mute', 'Stop moments': 'Stop effects', Party: 'Party marker', Sound: 'Ambience', Keys: 'Guide' };
  const DO_HOT = {
    send: { label: 'Send to table', icon: 'cast' }, blackout: { label: 'Blackout', icon: 'screen-share-off' }, quiet: { label: 'Mute', icon: 'volume-off' },
    next: { label: 'Next turn', icon: 'player-track-next' }, fight: { label: 'Fight music', icon: 'swords' }, strike: { label: 'Lightning', icon: 'bolt' },
    'stop-moments': { label: 'Stop effects', icon: 'player-stop' }, grid: { label: 'Grid on/off', icon: 'grid-4x4' }, fit: { label: 'Fit the view', icon: 'zoom-scan' },
    again: { label: 'Movement again', icon: 'refresh' },
    // fight (the Initiative panel's buttons)
    'fight-start': { label: 'Start the fight', icon: 'swords' }, 'fight-end': { label: 'End the fight', icon: 'player-stop' }, prev: { label: 'Previous turn', icon: 'player-skip-back' },
    'roll-enemies': { label: 'Roll enemies', icon: 'dice' }, 'init-sort': { label: 'Sort initiative', icon: 'sort-descending' },
    // Spotify
    'sp-toggle': { label: 'Spotify play/pause', icon: 'player-play' }, 'sp-next': { label: 'Spotify next song', icon: 'player-track-next' },
    // what is selected on the map
    'sel-hide': { label: 'Hide/show selected', icon: 'eye-off' }, 'sel-lock': { label: 'Lock/unlock asset', icon: 'lock' }, 'sel-dup': { label: 'Duplicate selected', icon: 'copy' },
    // the hotbar itself
    'page-next': { label: 'Next hotbar page', icon: 'chevron-down' }, 'page-prev': { label: 'Previous hotbar page', icon: 'chevron-up' },
  };
  const DO_GROUPS = [['Table', ['send', 'blackout', 'quiet', 'strike', 'stop-moments', 'grid', 'fit']], ['Fight', ['fight-start', 'next', 'prev', 'roll-enemies', 'init-sort', 'fight-end', 'fight', 'again']],
    ['Selection', ['sel-hide', 'sel-lock', 'sel-dup']], ['Spotify', ['sp-toggle', 'sp-next']], ['Hotbar', ['page-next', 'page-prev']]];
  // H: hide or show what is selected (a token, a marker, assets, a spell area, an effect)
  function toggleSelHidden() {
    if (ui.selected) { const l = layer(ui.selected); if (l) cmd('layer.update', { id: l.id, hidden: !l.hidden }); }
    else if (ui.selMark) Tools.toggleSelectedHidden();
    else if (ui.selAssets.length > 1) { const ls = ui.selAssets.map(layer).filter(Boolean); const hid = !ls.every((l) => l.hidden); cmd('layer.many', { patches: ls.map((l) => ({ id: l.id, hidden: hid })) }); }
    else if (ui.selAsset) { const l = layer(ui.selAsset); if (l) cmd('layer.update', { id: l.id, hidden: !l.hidden }); }
    else if (ui.selSpell) { const sp = spellOf(ui.selSpell); if (sp) cmd('spell.update', { id: sp.id, hidden: !sp.hidden }); }
    else if (ui.selFx) { const f = fxOf(ui.selFx); if (f) cmd('fx.update', { id: f.id, hidden: !f.hidden }); }
    else return false;
    return true;
  }
  const doHot = (k) => (DO_HOT[k] ? { kind: 'do', ref: k, ...DO_HOT[k] } : null);
  // Prototype 25: one list of everything that can go on the hotbar (right-click a slot → Add … / Change …)
  let hotPickOpen = new Set(['tools', 'maptools']);
  async function hotPicker(at) {
    const KEY = Hotbar.KEYS[at % Hotbar.SLOTS];
    let groups = null; let query = '';
    const rail = RAIL.flatMap((g) => (g && g.items) || []).filter((x) => HOT_RAIL(x)).map((x) => toolHot(x.id, x.label, x.icon));
    const local = [
      { id: 'tools', label: 'Tools', items: rail },
      { id: 'maptools', label: 'Map tools', items: Object.entries(MAP_TOOLS).map(([id, d]) => toolHot(id, d.label, d.icon)) },
      { id: 'panels', label: 'Panels', items: TB.PANELS.map((x) => ({ kind: 'panel', ref: x.id, label: x.label, icon: x.icon })) },
      ...DO_GROUPS.map(([title, keys]) => ({ id: `do-${title}`, label: `Actions: ${title.toLowerCase()}`, items: keys.map(doHot) })),
      { id: 'values', label: 'Actions with a value', items: Object.entries(DO_VALUES).map(([key, d]) => ({ ask: key, label: d.label, icon: d.icon })) },
    ];
    const q = h('input', { type: 'search', placeholder: 'Find …', 'aria-label': 'Find something for the hotbar', spellcheck: 'false' });
    const list = h('div', { class: 'dk-cat-list hp-list' });
    const dlg = dialog(`Hotbar slot ${KEY}`, h('div', { class: 'dk-cat hot-pick' }, q, list, h('p', { class: 'hint' }, 'Doors: right-click a door on the map. Anything else: drag it onto the hotbar.')));
    const put = async (it) => {
      let item = it;
      if (it.ask) { item = await askDoValue(it.ask); if (!item) return; }
      Hot.setSlot(at, { kind: item.kind, label: item.label, icon: item.icon || null, ref: item.ref ?? null });
      dlg.close();
    };
    const fill = () => {
      const t = query.trim().toLowerCase();
      const all = [...local, ...(groups || [])];
      list.replaceChildren(...all.map((g) => {
        const items = g.items.filter((it) => !t || it.label.toLowerCase().includes(t) || (it.sub || '').toLowerCase().includes(t));
        if (!items.length) return null;
        const d = h('details', { class: 'dk-grp', open: !!t || hotPickOpen.has(g.id) || undefined },
          h('summary', {}, g.label, h('small', {}, String(items.length))),
          h('div', { class: 'dk-items' }, ...items.slice(0, 400).map((it) => h('button', { class: 'dk-item', 'data-tip': it.sub ? `${it.label} (${it.sub})` : it.label, onclick: () => put(it) },
            iconEl(it.icon || Hotbar.ICON[it.kind] || 'square'), h('span', { class: 'ellipsis' }, it.label)))));
        if (!t) d.addEventListener('toggle', () => { if (d.open) hotPickOpen.add(g.id); else hotPickOpen.delete(g.id); });
        return d;
      }).filter(Boolean), groups ? '' : h('p', { class: 'hint' }, 'Loading the library …')); // (replaceChildren would write "null")
    };
    q.addEventListener('input', () => { query = q.value; fill(); });
    fill();
    setTimeout(() => q.focus(), 30);
    try { const r = await window.ts.remote('catalog', { pc: true }); groups = (r && r.groups) || []; } catch { groups = []; }
    if (dlg.el.isConnected) fill();
  }
  // Prototype 25: actions with a value. The ref is 'name:value': timer:300 (seconds), break:10 (minutes), dark:60 and spvol:40 (%)
  const DO_VALUES = {
    timer: { label: 'Countdown …', icon: 'hourglass', ask: 'Countdown: minutes (or 1:30)', start: '5', parse: (t) => { const m = /^(\d+):(\d{1,2})$/.exec(t.trim()); const sec = m ? Number(m[1]) * 60 + Number(m[2]) : Math.round(parseFloat(t.replace(',', '.')) * 60); return sec >= 1 && sec <= 5999 ? sec : null; },
      name: (v) => `Countdown ${v % 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : `${v / 60} min`}`, what: 'start this countdown on the table, again to stop it' },
    break: { label: 'Break …', icon: 'coffee', ask: 'Break: minutes', start: '10', parse: (t) => { const n = Math.round(parseFloat(t)); return n >= 1 && n <= 180 ? n : null; }, name: (v) => `Break ${v} min`, what: 'start this break, again to end it' },
    dark: { label: 'Darkness …', icon: 'moon', ask: 'Darkness of the map: 0 to 100 %', start: '60', parse: (t) => { const n = Math.round(parseFloat(t)); return n >= 0 && n <= 100 ? n : null; }, name: (v) => `Darkness ${v} %`, what: 'set the map\'s darkness to this' },
    spvol: { label: 'Spotify volume …', icon: 'brand-spotify', ask: 'Spotify volume: 0 to 100 %', start: '40', parse: (t) => { const n = Math.round(parseFloat(t)); return n >= 0 && n <= 100 ? n : null; }, name: (v) => `Spotify ${v} %`, what: 'set Spotify to this volume' },
  };
  const doValue = (r) => { const m = typeof r === 'string' && /^([a-z]+):(\d+)$/.exec(r); return m && DO_VALUES[m[1]] ? { key: m[1], v: Number(m[2]), def: DO_VALUES[m[1]] } : null; };
  async function askDoValue(key) {
    const def = DO_VALUES[key];
    const t = await askText(def.ask, def.start);
    if (t == null || !String(t).trim()) return null;
    const v = def.parse(String(t));
    if (v == null) { toast('That number does not fit', { kind: 'error' }); return null; }
    return { kind: 'do', ref: `${key}:${v}`, label: def.name(v), icon: def.icon };
  }
  async function doValueRun({ key, v }) {
    const m = S && S.map;
    if (key === 'timer') { if (S.timer) cmd('timer.stop'); else cmd('timer.start', { mode: ui.timer.mode, seconds: v, label: '', sound: ui.timer.sound, side: ui.timer.side || 'right' }); }
    else if (key === 'break') { if (S.brk) cmd('break.end'); else cmd('break.start', { minutes: v }); }
    else if (key === 'dark') { if (m) cmd('light.update', { darkness: v / 100, fade: ui.moodFade, label: `Darkness ${v} %` }); }
    else if (key === 'spvol') { const x = await window.ts.spotify('control', { action: 'volume', volume: v }); if (x && x.error) toast(x.error, { kind: 'error' }); else window.ts.settings({ spotify: { volume: v } }); }
  }
  async function doRun(r) {
    const m = S && S.map;
    const val = doValue(r);
    if (val) { await doValueRun(val); return; }
    switch (r) {
      case 'send': { if (isLive()) break; const x = await cmd('table.send'); if (x && x.ok === false && x.error) toast(x.error, { kind: 'error' }); break; }
      case 'blackout': if (S.table.open) cmd('table.blackout'); else toast('The table is closed', { ms: 1600 }); break;
      case 'quiet': cmd('sound.quiet'); break;
      case 'next': Tools.nextRound(); break;
      case 'fight': cmd('sound.fight', {}); break;
      case 'strike': cmd('strike.now', {}); toast('Lightning!', { ms: 1200 }); break;
      case 'stop-moments': cmd('moment.stop', {}); break;
      case 'grid': if (m) cmd('grid.update', { show: !m.grid.show }); break;
      case 'fit': view.fit(); break;
      case 'fight-start': { const x = await cmd('init.start', {}); if (x && x.ok) toast('Round 1. Next turn: Enter'); else if (x && x.error) toast(x.error, { kind: 'error' }); break; }
      case 'fight-end': { const x = await cmd('init.end'); if (x && x.ok) toast(x.label, { undo: () => cmd('init.restore') }); break; }
      case 'prev': cmd('init.prev'); break;
      case 'roll-enemies': { const x = await cmd('init.roll', {}); if (x && !x.ok && x.error) toast(x.error); break; }
      case 'init-sort': cmd('init.sort'); break;
      case 'sp-toggle': { const n = (S.spotify && S.spotify.now) || {}; const x = await (n.playing ? window.ts.spotify('stop', {}) : window.ts.spotify('control', { action: 'resume' })); if (x && x.error) toast(x.error, { kind: 'error' }); break; }
      case 'sp-next': { const x = await window.ts.spotify('control', { action: 'next' }); if (x && x.error) toast(x.error, { kind: 'error' }); break; }
      case 'sel-hide': if (!toggleSelHidden()) toast('Select something on the map first', { ms: 1600 }); break;
      case 'sel-lock': {
        const ls = (ui.selAssets.length ? ui.selAssets : ui.selAsset ? [ui.selAsset] : []).map(layer).filter(Boolean);
        if (!ls.length) { toast('Select an asset first', { ms: 1600 }); break; }
        const lock = !ls.every((l) => l.locked);
        cmd('layer.many', { patches: ls.map((l) => ({ id: l.id, locked: lock })) });
        break;
      }
      case 'sel-dup': {
        if (ui.selected) { const l = layer(ui.selected); if (l) await duplicateToken(l); break; }
        if (!ui.selAsset) { toast('Select a token or an asset first', { ms: 1600 }); break; }
        const x = await cmd('layer.duplicate', { id: ui.selAsset, dx: grid().size, dy: 0 });
        if (x && x.selected) selectAsset(x.selected);
        break;
      }
      case 'page-next': Hot.setPage(Hot.page() + 1); break;
      case 'page-prev': Hot.setPage(Hot.page() - 1); break;
      case 'again': { const x = await window.ts.players('again'); if (x && x.error) toast(x.error, { kind: 'error' }); else if (x && x.ok) toast('Movement again for everyone', { ms: 1600 }); break; }
      default: break;
    }
  }
  function fogRun(r) {
    const m = S && S.map;
    if (!m) return;
    if (r && typeof r === 'object') { // a marked area: reveal it
      const a = r.map === m.id ? (m.areas || []).find((x) => x.id === r.area) : null;
      if (!a) { const mm = allMaps().find((x) => x.id === r.map); toast(mm && r.map !== m.id ? `That area is on ${mm.name}: open it first` : 'This area is gone', { kind: mm ? null : 'error' }); return; }
      const r0 = a.rings[0]; let x = 0; let y = 0;
      for (let i = 0; i < r0.length; i += 2) { x += r0[i]; y += r0[i + 1]; }
      revealRings(a.rings, 'reveal', { x: x / (r0.length / 2), y: y / (r0.length / 2) }, a.name);
      return;
    }
    if (r === 'toggle') { cmd('fog.enabled', { enabled: !m.fog.enabled }).then((x) => { if (x && x.label) toast(x.label, { ms: 1400 }); }); return; }
    if (r === 'reveal-all') { undoable('fog.base', { base: 'clear' }); return; }
    if (r === 'cover-all') { undoable('fog.base', { base: 'cover' }); return; }
    if (r === 'reveal' || r === 'cover') ui.fogMode = r;
    if (r === 'brush' || r === 'rect' || r === 'room') setFogShape(r);
    setTool('fog');
    toast(`Fog: ${ui.fogMode === 'cover' ? 'cover' : 'reveal'}, ${ui.fogShape === 'rect' ? 'rectangles' : ui.fogShape === 'room' ? 'a room at a click' : 'brush'}`, { ms: 1400 });
  }
  async function hotRun(it) {
    const r = it.ref;
    const m = S && S.map;
    const said = (x) => { if (x && x.ok === false && x.error) toast(x.error, { kind: 'error' }); else if (x && x.closed) toast('The table is closed: only you see it', { ms: 2600 }); };
    switch (it.kind) {
      case 'token': Tools.setTokenBrush(libItem(it)); break;
      case 'asset': setBrush(libItem(it)); break;
      case 'portrait': await TB.talkToggle(libItem(it)); break;
      case 'handout': { const x = await cmd('handout.show', { path: r.path }); if (x && x.ok) toast(x.shown ? `${it.label} is on the table` : `${it.label} put away`, { ms: 1800 }); break; }
      case 'overlay': {
        if (!m) break;
        const l = m.layers.find((y) => y.role === 'overlay' && y.path === r.path);
        if (l) undoable('layer.remove', { id: l.id }, `${it.label} off`); else cmd('layer.add', { path: r.path, role: 'overlay', anchor: anchorFor(it.label) });
        break;
      }
      case 'sound': {
        if (isSfx(r)) { cmd('sound.play', { path: r.path }); break; }
        if (!m) break;
        const l = m.layers.find((y) => y.role === 'audio' && y.path === r.path);
        if (l) undoable('layer.remove', { id: l.id }, `${it.label} stopped`); else cmd('layer.add', { path: r.path, role: 'audio' });
        break;
      }
      case 'mood': Spot.toggleMood(r); break;
      case 'moment': Show.play(r); break;
      case 'cue': { const cq = Show.cues().find((x) => x.id === r); if (cq) Show.playCue(cq); else toast('This cue is gone', { kind: 'error' }); break; }
      case 'wheel': said(await cmd('wheel.spin', { id: r })); break;
      case 'roll': said(await cmd('dice.roll', r || {})); break;
      case 'death': said(await cmd('death.roll', {})); break;
      case 'spell': {
        const sp = SPELLS.find((x) => x.name === r);
        if (sp) pickSpell(sp); else if (it.spell) setSpell(it.spell);
        if (ui.tool !== 'spell') setTool('spell');
        toast(`${it.label}: click on the map to cast it`, { ms: 1800 });
        break;
      }
      case 'weather':
        if (!m) break;
        if (hotLive(it)) cmd('weather.preset', { name: 'None', layers: [] }); else applyWeather({ label: it.label, layers: Array.isArray(r) ? r : [] });
        break;
      case 'light': setMood(r); break;
      case 'map': { const x = await cmd('table.send', { id: r }); if (x && x.ok === false && x.error) toast(x.error, { kind: 'error' }); break; }
      case 'panel': TB.togglePanel(r); break;
      case 'lights': { // Room lights: a mode, or a scene (pressed again while it shows: back to the table)
        if (r === 'dim' || r === 'bright') { // 4.5: −20 % / +20 % (+ while Off: on again at 20 %)
          const x = await window.ts.lights('bright.step', { by: r === 'dim' ? -0.2 : 0.2 });
          if (x && x.error) toast(x.error, { kind: 'error' }); else if (x) toast(`Room lights: ${x.back ? 'on again, ' : ''}${Math.round((x.brightness || 0) * 100)}%`, { ms: 1400 });
          return;
        }
        const L = S.lights;
        const again = L && L.mode === 'scene' && L.sceneId === r;
        const x = await window.ts.lights('mode', ['follow', 'room', 'off', 'release'].includes(r) ? { mode: r } : again ? { mode: 'follow' } : { mode: 'scene', sceneId: r });
        if (x && x.error) toast(x.error, { kind: 'error' }); else toast(again ? 'Room lights: back to the table' : `Room lights: ${it.label}`, { ms: 1400 });
        break;
      }
      case 'snap': await Snaps.go(r === 'next' ? { next: true } : { id: r }); break;
      case 'fog': fogRun(r); break;
      case 'tool': toolRun(r); break;
      case 'do': await doRun(r); break;
      case 'door': { // Prototype 25: a door of this map, opened or closed from the hotbar
        if (!S.map || !r || r.map !== S.map.id) { toast(`That ${String(it.label || '').startsWith('Window') ? 'window' : 'door'} is on another map`, { ms: 1800 }); break; }
        const x = await cmd('wall.door', { id: r.id });
        if (x && x.label) toast(x.label, { ms: 1200 });
        break;
      }
      default: break;
    }
    Hot.render();
  }

  // =====================================================================
  // Library drawer (library-drawer.js)
  // =====================================================================
  // Weather-like overlays stay fixed to the table; everything else moves with the map.
  const anchorFor = (name) => (/rain|snow|storm|weather|blizzard|hail|leaves|ash|sleet|wind/i.test(name || '') ? 'table' : 'map');
  function parseAsset(dt) {
    try { const raw = dt.getData('application/x-ts-asset'); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  async function placeToken(path, at) {
    const p = Geom.snap(grid(), at.x, at.y, 1);
    const r = await cmd('layer.add', { path, role: 'token', x: p.x, y: p.y, tag: (ui.tok && ui.tok.tag) || 'off' });
    if (r && r.selected) { setTool('select'); ui.selected = r.selected; view.setSelected(r.selected); placeCard(); }
    return r;
  }
  // an asset at a point, at its natural size (256 pixels per square)
  function placeAsset(it, at) {
    return new Promise((resolve) => {
      const url = it.url || UI.pathToUrl(it.path);
      const add = (w) => resolve(cmd('layer.add', { path: it.path, role: 'asset', x: at.x, y: at.y, w: round(clamp((w || 512) / 256, 0.25, 8) * grid().size, 3) }));
      if (it.kind === 'video') { const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.onloadedmetadata = () => add(v.videoWidth); v.onerror = () => add(0); v.src = url; } else { const img = new Image(); img.onload = () => add(img.naturalWidth); img.onerror = () => add(0); img.src = url; }
    });
  }
  const Drawer = LibraryDrawer.create({
    ui, get els() { return els; }, cmd, undoable, ready: Ready,
    state: () => S, closePop: () => closePop(), renderRail: () => renderRail(), viewChapter: () => viewChapter(),
    viewCenter: () => viewCenter(), anchorFor, placeToken, placeAsset, setBrush: (it) => setBrush(it), setTokenBrush: (it) => Tools.setTokenBrush(it),
    talkToggle: (it) => TB.talkToggle(it),
    returnTo: (back, key) => returnTo(back, key),
  });
  // after picking something in the library: the menu that asked for it opens again, the new thing lit for a moment
  function returnTo(back, key) {
    if (back && back.options) { App.openOptions(back.options, key); return; } // 4.3: picked for Options → Sound
    if (!back || !S || !S.map) return;
    if (back.tool && ui.tool !== back.tool) setTool(back.tool);
    if (back.tab) ui.soundTab = back.tab;
    ui.flashed = key ? String(key) : null; // the panel may need it while building (an open list)
    if (back.panel) TB.openPanel(back.panel);
    else if (popId !== back.pop) openPop(back.pop); else refreshPop();
    if (key) flashRow(key);
    setTimeout(() => { if (ui.flashed === String(key)) ui.flashed = null; }, 2500);
  }
  function flashRow(key) {
    // the row may only appear (or be rebuilt) when the new state arrives: keep looking for a moment
    const k = String(key);
    const until = performance.now() + 1200;
    let first = true;
    const step = () => {
      const el = [...els.stage.querySelectorAll('#pop [data-flash], .fp [data-flash]')].find((x) => x.dataset.flash === k);
      if (el && !el.classList.contains('flash')) {
        if (first) { el.scrollIntoView({ block: 'nearest' }); first = false; }
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1700);
      }
      if (performance.now() < until) setTimeout(step, 60);
    };
    requestAnimationFrame(step);
  }

  // =====================================================================
  // Play tools (play-tools.js): tokens, point, draw, mark, timer, rounds
  // =====================================================================
  const Tools = PlayTools.create({
    doHot, toolHot, // Prototype 24: actions and tools on the hotbar
    ui, cmd, send, undoable, pending, ready: Ready,
    state: () => S, view: () => view, popId: () => popId,
    ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib, cardSep },
    setTool: (t) => setTool(t), openPop: (id) => openPop(id), refreshPop: () => { refreshPop(); renderRail(); }, placeCard: () => placeCard(),
    get Drawer() { return Drawer; }, get Radial() { return Radial; },
    dragging: () => !!drag, updateCursor: () => updateBrushCursor(),
    startTokenDrag: (id, pt) => startTokenDrag(id, pt),
    openToolbox: (id) => TB.openPanel(id), tick: () => { if (popTicker) popTicker(); },
    togglePanel: (def) => { Floats.toggle(def); renderRail(); }, panelOpen: (id) => !!(Floats && Floats.isOpen(id)), // 4.7: Tokens → List
    // a spot on the map moved to the middle of this screen (a note from the Notes list)
    showPoint: (x, y) => { const p = view.mapToScreen(x, y); const r = els.viewport.getBoundingClientRect(); view.panBy(r.left + r.width / 2 - p.x, r.top + r.height / 2 - p.y); },
  });
  // Talk and the toolbox (toolbox.js)
  let popTicker = null;
  const TB = Toolbox.create({
    doHot, toolHot, // Prototype 24: actions and tools on the hotbar
    ui, cmd, state: () => S, ready: Ready, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib, ctlLabel: (t) => h('div', { class: 'ctl-label' }, t) },
    refreshPop: () => { refreshPop(); renderRail(); }, openPop: (id) => openPop(id), closePop: () => closePop(), get Drawer() { return Drawer; }, get Tools() { return Tools; }, get Show() { return Show; }, get Spot() { return Spot; }, get Lights() { return Lights; }, get Remote() { return Remote; }, get Players() { return PlayersP; }, get Chars() { return Chars; }, get Dice() { return Dice; },
    setTick: (fn) => { popTicker = fn; }, nextTurn: () => Tools.nextRound(),
    showPanel: (def) => Floats.show(def), togglePanel: (def) => Floats.toggle(def), panelOpen: (id) => Floats.isOpen(id),
    pins: () => pins, togglePin: (id) => togglePin(id),
    // 4.5: Snapshots live in the Toolbox (Atmosphere, next to Moments)
    snaps: (toggle) => { if (toggle && Floats.isOpen('snaps')) Floats.hide('snaps'); else Snaps.openFor(null); renderRail(); },
    // a map tool from the Toolbox: switch the mouse to it and show its settings
    useTool: (t, mode) => { Tools.setMode(t, mode); setTool(t); openPop(t); },
    // Prototype 14: Map notes, a tool from the Toolbox (or pinned to the rail): the mouse pins notes, its list opens
    mapNotes: (toggle) => { if (toggle && ui.tool === 'notes') { setTool('select'); closePop(); } else { setTool('notes'); openPop('notes'); } renderRail(); },
  });
  // Spotify as a remote (spotify-panel.js): Sound → Spotify, the Spotify panel, what plays under the preview
  const Spot = SpotifyPanel.create({
    ui, state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); if (S && S.table) renderTableCtl(); }, settingsLater: (p) => settingsLater(p),
    openPanel: () => TB.openPanel('spotify'), rebuild: () => Floats.rebuild('spotify'),
  });
  // Dice, the wheel of luck, death saves (dice-panel.js), opened from the Toolbox
  const Dice = DicePanel.create({
    ui, cmd, state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); }, rebuild: () => Floats.rebuild('dice'),
  });
  // Room lights (lights-panel.js, Beta 3), opened from the Toolbox
  const Lights = LightsPanel.create({
    state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); },
  });
  // Characters (characters.js, Beta 4.2), opened from the Toolbox or with Shift + I
  const Chars = Characters.create({
    state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); },
  });
  // Phone & tablet (remote-panel.js, Beta 4), opened from the Toolbox
  const Remote = RemotePanel.create({
    state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); },
  });
  // Players' phones (players-panel.js, Prototype 1), opened from the Toolbox
  const PlayersP = PlayersPanel.create({
    doHot, toolHot, // Prototype 24: actions and tools on the hotbar
    state: () => S, ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); },
  });
  // Moments (show-tools.js), opened from the Toolbox; the older cues still play
  const Show = ShowTools.create({
    doHot, toolHot, // Prototype 24: actions and tools on the hotbar
    ui, cmd, state: () => S, get Drawer() { return Drawer; },
    ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib, ctlLabel: (t) => h('div', { class: 'ctl-label' }, t) },
    refresh: () => { refreshPop(); renderRail(); },
    aimMoment: (id) => aimMoment(id),
  });
  // Snapshots (snapshots.js): the timeline, opened from Build or from a map's camera badge in the map bar
  const Snaps = Snapshots.create({
    ui, cmd, state: () => S, get Show() { return Show; },
    ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refresh: () => { refreshPop(); renderRail(); if (Floats) Floats.refresh(); },
    showPanel: (def) => { Floats.show(def); renderRail(); },
    capture: () => captureMap(), flash: (k) => flashRow(k),
  });
  // A long fog (every step the party takes leaves one) is folded into one picture after a quiet moment (2.2):
  // all but the newest steps. The fog looks the same; drawing it, switching it on and sending it get fast again.
  const BAKE_OPS = 250; const BAKE_PTS = 40000; const BAKE_KEEP = 30;
  let bakeT = 0; let baking = false; let bakeHeld = false; // (held: the self-test compares the TV before and after)
  function fogWeight(f) { let n = 0; for (const o of f.ops) { n += o.pts ? o.pts.length : 0; for (const r of o.rings || []) n += r.length; for (const r of o.lit || []) n += r.length; } return n; }
  function maybeBakeFog(m) {
    const f = m.fog;
    if (!f || baking || bakeHeld || f.ops.length <= BAKE_KEEP + 2) return;
    if (f.ops.length < BAKE_OPS && (f.ops.length < 40 || fogWeight(f) < BAKE_PTS)) return;
    clearTimeout(bakeT);
    bakeT = setTimeout(bakeFog, 3000);
  }
  async function bakeFog() {
    const m = S && S.map;
    if (!m || !m.fog || baking) return;
    if (drag || document.body.classList.contains('dragging-hot')) { bakeT = setTimeout(bakeFog, 2000); return; }
    const ops = m.fog.ops; const n = ops.length - BAKE_KEEP;
    if (n < 2) return;
    const mask = view.bakeFog(m.fog, n);
    if (!mask) { bakeT = setTimeout(bakeFog, 1500); return; }
    baking = true;
    try { await cmd('fog.bake', { mapId: m.id, n, first: ops[0].id, last: ops[n - 1].id, mask }); } finally { baking = false; }
  }
  // a picture of the map as the GM sees it (a snapshot's picture): panels, bars and menus out of the way for a moment
  async function captureMap() {
    if (!S || !S.map || !view) return null;
    const fr = view.frameRect(); const vr = els.viewport.getBoundingClientRect();
    const x = Math.max(fr.left, vr.left); const y = Math.max(fr.top, vr.top);
    const w = Math.min(fr.left + fr.width, vr.right) - x; const hh = Math.min(fr.top + fr.height, vr.bottom) - y;
    if (w < 40 || hh < 30) return null;
    document.body.classList.add('capturing');
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return await ts.app('capture', { x, y, w, h: hh });
    } catch { return null; } finally { document.body.classList.remove('capturing'); }
  }
  // the next click on the map plays a moment there
  function aimMoment(id) {
    ui.momentAim = id && Moments.BY[id] ? id : null;
    document.body.classList.toggle('aiming', !!ui.momentAim);
    renderTopbar();
  }
  // the Toolbox tools as floating panels; their controls get their own refresh list
  Floats = FloatPanels.create({
    host: () => els.stage,
    withBinds: (list, fn) => { const keep = refreshers; refreshers = list; try { return fn(); } finally { refreshers = keep; } },
    onChange: () => { renderRail(); if (popId === 'toolbox') refreshPop(); sendPreviewSize(); if (Hot) Hot.render(); if (S && S.map) placeCard(); }, // (Prototype 17: the player toolbar's arrow)
  });
  // The hotbar (hotbar.js): the bar itself; what each kind of thing does is here
  Hot = Hotbar.create({
    cmd, state: () => S, run: (it) => hotRun(it), live: (it) => hotLive(it), what: (it) => hotWhat(it),
    pick: (at) => hotPicker(at),
    label: (it) => (['panel', 'tool', 'do', 'fog'].includes(it.kind) && HOT_RENAMED[it.label]) || it.label, // Prototype 24: slots saved before the renames show the new names
    mapItem: (id) => { const m = allMaps().find((x) => x.id === id); return m ? { kind: 'map', ref: id, label: m.name, icon: 'map-2' } : null; },
  });
  // Walls and doors (walls-tool.js)
  // The party (party-tool.js)
  const Party = PartyTool.create({
    ui, cmd, undoable, send, pending, state: () => S, view: () => view,
    ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refreshPop: () => refreshPop(), reopen: () => { if (popId === 'party') openPop('party'); }, viewCenter: () => viewCenter(),
  });
  const Walls = WallsTool.create({
    ui, cmd, undoable, send, pending, state: () => S, view: () => view, popId: () => popId,
    ctl: { slider, toggle, seg, tiles, stepper, btn, row, hint, sep, bind, ib },
    refreshPop: () => { refreshPop(); renderRail(); }, openPop: (id) => openPop(id), setTool: (t) => setTool(t),
    get Radial() { return Radial; }, viewCenter: () => viewCenter(),
  });
  function startTokenDrag(id, pt) {
    const l = layer(id);
    if (!l) return null;
    ui.selected = l.id; view.setSelected(l.id);
    if (ui.selSpell) { ui.selSpell = null; view.selectSpell(null); }
    placeCard();
    if (popId === 'layers') refreshPop();
    return { kind: 'token', id: l.id, dx: l.x - pt.x, dy: l.y - pt.y, size: l.size, key: `tok-${l.id}-${Date.now()}` };
  }

  // =====================================================================
  // Pointer input on the canvas
  // =====================================================================
  let drag = null;
  let spaceDown = false;
  let lastPointer = null;
  let brushCursor = null;
  let lastLaser = 0;

  // centre of the table, in map inches
  function viewCenter() { return tableCenterMap(); }

  function updateBrushCursor() {
    if (!brushCursor) { brushCursor = h('div', { class: 'brush-cursor' }); view.marks.appendChild(brushCursor); }
    const fog = ui.tool === 'fog' && ui.fogShape === 'brush' && !(drag && drag.kind === 'rect');
    const paint = (ui.tool === 'fx' && ui.fxMode === 'paint') || (ui.tool === 'asset' && ui.assetMode === 'scatter' && ui.brush);
    const show = (fog || paint) && lastPointer && !ui.align && S && S.map;
    brushCursor.style.display = show ? '' : 'none';
    if (!show) return;
    if (brushCursor.parentNode !== view.marks) view.marks.appendChild(brushCursor);
    const p = view.toTable(lastPointer.x, lastPointer.y);
    const d = (fog ? ui.brushIn : ui.tool === 'asset' ? ui.scatterIn : ui.paintIn) * view.ppi;
    Object.assign(brushCursor.style, { left: `${p.x * view.ppi}px`, top: `${p.y * view.ppi}px`, width: `${d}px`, height: `${d}px`, borderWidth: `${1.5 / view.cam.s}px` });
    brushCursor.classList.toggle('cover', fog && ui.fogMode === 'cover');
    brushCursor.classList.toggle('paint', paint);
  }

  function bindViewport() {
    const vp = els.viewport;
    vp.addEventListener('contextmenu', (e) => e.preventDefault());
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!S || !S.map) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      if (e.altKey) { zoomAround(curView().zoom * factor, view.toTable(e.clientX, e.clientY), 'wheel-scale'); return; }
      if (e.ctrlKey || e.metaKey) {
        if (ui.tool === 'fog') { ui.brushIn = clamp(round(ui.brushIn * factor * 4) / 4, 0.5, 8); refreshPop(); updateBrushCursor(); return; }
        if (ui.tool === 'fx' && ui.fxMode === 'paint') { ui.paintIn = clamp(round(ui.paintIn * factor * 4) / 4, 0.5, 8); refreshPop(); updateBrushCursor(); return; }
        // Ctrl + wheel turns things: 15° per notch, 5° with Shift
        const dir = Math.sign(e.deltaY || e.deltaX);
        if (dir && (ui.tool === 'spell' || ui.tool === 'select' || ui.tool === 'asset')) { turnWithWheel(e, dir, e.shiftKey ? 5 : 15); return; }
        if (dir && ui.tool === 'fx' && turnFx(e, dir, e.shiftKey ? 5 : 15)) return;
        if (dir && ui.tool === 'map' && S.map.bg) { const a = stepTurn(view.bgTurn(), dir, e.shiftKey ? 1 : 15); turnMap(a, 'wheel-turn'); showReadout(e, a); return; }
      }
      view.zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    vp.addEventListener('pointerdown', (e) => {
      if (!S || !S.map) return;
      // no text selection or native drag on the map: either would cancel the pointer mid-stroke
      e.preventDefault();
      const a = document.activeElement;
      if (a && a !== document.body && !vp.contains(a)) a.blur();
      vp.setPointerCapture(e.pointerId);
      const pt = view.toMap(e.clientX, e.clientY);
      if (e.button === 2) {
        if (ui.tool === 'walls' && Walls.chainActive()) { Walls.endChain(); return; } // right-click ends a line of walls
        drag = { kind: 'right', x: e.clientX, y: e.clientY, moved: false, target: e.target }; return;
      }
      if (e.button === 1 || (e.button === 0 && spaceDown)) { drag = { kind: 'pan', x: e.clientX, y: e.clientY }; document.body.classList.add('panning'); return; }
      if (e.button !== 0) return;
      // a counter's − and + work in every tool
      const cbtn = e.target.closest('.sv-counter-btn');
      if (cbtn) { Tools.counterStep(cbtn.closest('.sv-mark').dataset.id, Number(cbtn.dataset.d)); return; }
      if (ui.momentAim) {
        const id = ui.momentAim;
        aimMoment(null);
        cmd('moment.play', { id, x: round(pt.x, 3), y: round(pt.y, 3), mapId: S.editMapId }).then((r) => { if (r && r.closed) toast('The table is closed, so only you see it', { ms: 2500 }); });
        return;
      }
      if (ui.align) {
        const line = h('div', { class: 'align-line' });
        view.marks.appendChild(line);
        drag = { kind: 'align', p0: pt, line };
        updateAlign(drag, pt);
        return;
      }
      const label = e.target.closest('.sv-spell-label');
      if (label && (ui.tool === 'select' || ui.tool === 'spell')) { startSpellMove(label.dataset.id, pt, e); return; }
      // Prototype 4: in every Play tool a door's lock asks before it opens, and the party's marker can be dragged
      if (WallsTool.PLAY_TOOLS.includes(ui.tool)) {
        const doorEl = e.target.closest('.sv-door');
        if (doorEl) { Walls.askDoor(doorEl.dataset.id); return; }
        const pEl = ui.tool !== 'select' && ui.tool !== 'party' ? e.target.closest('.sv-handle.party') : null;
        const pf = pEl && fxOf(pEl.dataset.id);
        if (pf) {
          const p = view.fxPos(pf);
          drag = { kind: 'fxmove', id: pf.id, dx: p.x - pt.x, dy: p.y - pt.y, attached: !!pf.attachTo, sx: e.clientX, sy: e.clientY, moved: false, key: `fx-${pf.id}-${Date.now()}` };
          return;
        }
      }
      switch (ui.tool) {
        case 'select': {
          // party lights can be dragged along with the group while playing
          const hEl = e.target.closest('.sv-handle');
          if (hEl && fxOf(hEl.dataset.id)) {
            const f = fxOf(hEl.dataset.id);
            selectFx(f.id);
            const p = view.fxPos(f);
            drag = { kind: 'fxmove', id: f.id, dx: p.x - pt.x, dy: p.y - pt.y, attached: !!f.attachTo, sx: e.clientX, sy: e.clientY, moved: false, key: `fx-${f.id}-${Date.now()}` };
            break;
          }
          if (ui.selFx) selectFx(null);
          const tokEl = e.target.closest('.sv-token');
          if (tokEl) {
            const l = layer(tokEl.dataset.id);
            ui.selected = l.id; view.setSelected(l.id);
            if (ui.selSpell) { ui.selSpell = null; view.selectSpell(null); }
            placeCard();
            drag = { kind: 'token', id: l.id, dx: l.x - pt.x, dy: l.y - pt.y, size: l.size, key: `tok-${l.id}-${Date.now()}` };
            if (popId === 'layers') refreshPop();
            break;
          }
          const sid = view.spellAt(pt.x, pt.y);
          if (sid) { startSpellMove(sid, pt, e); break; }
          if (ui.selected || ui.selSpell) {
            ui.selected = null; view.setSelected(null);
            selectSpell(null);
            if (popId === 'layers') refreshPop();
          }
          break;
        }
        case 'map': {
          const v = curView();
          drag = { kind: 'map', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, key: `map-${Date.now()}` };
          break;
        }
        case 'fog': {
          const mode = ui.fogMode;
          if (ui.fogShape === 'area') { addAreaPoint(pt); break; }
          if (ui.fogShape === 'room') {
            const r = roomAt(pt);
            if (!r) { toast((map().walls || []).length ? 'No room here: this spot is not closed in by walls and doors.' : 'Rooms need walls: draw them with W or load a map with walls.', { ms: 4000 }); break; }
            if (e.shiftKey) markArea(r.rings, null); else revealRings(r.rings, mode, pt);
            view.setRoomPreview(null);
            break;
          }
          if (e.shiftKey || ui.fogShape === 'rect') {
            const pre = h('div', { class: `rect-preview ${mode}` });
            view.marks.appendChild(pre);
            drag = { kind: 'rect', mode, x0: pt.x, y0: pt.y, rect: pre };
            updateRect(drag, pt);
          } else {
            drag = { kind: 'brush', id: uid('s'), mode, r: ui.brushIn / 2 / zoom(), buf: [pt.x, pt.y], last: pt };
            flushBrush();
          }
          updateBrushCursor();
          break;
        }
        case 'token': case 'point': case 'draw': case 'mark': case 'notes':
          drag = Tools.pointerDown(e, pt);
          break;
        case 'walls':
          drag = Walls.pointerDown(e, pt);
          break;
        case 'party':
          drag = Party.pointerDown(e, pt);
          break;
        case 'fx':
          fxPointerDown(e, pt);
          break;
        case 'spell': {
          const o = { origin: ui.aimFrom || castOrigin(pt, e.altKey), alt: e.altKey, shift: e.shiftKey, token: ui.spell.shape === 'aura' ? tokenUnder(e.clientX, e.clientY) : null };
          if (ui.spell.shape === 'cube' && !ui.aimFrom) o.origin = e.altKey ? pt : snapHalf(grid(), pt);
          drag = { kind: 'cast', sx: e.clientX, sy: e.clientY, moved: false, o };
          updateGhost(pt, o);
          break;
        }
        case 'asset':
          assetPointerDown(e, pt);
          break;
        default:
      }
    });

    vp.addEventListener('pointermove', (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      updateBrushCursor();
      if (ui.tool === 'asset' && !dropGhost) updateAssetGhost(); // Beta 1: the preview follows the mouse
      const pt = S && S.map ? view.toMap(e.clientX, e.clientY) : null;
      if (!drag) {
        if (pt && ui.tool === 'spell' && !ui.align) updateGhost(pt, { alt: e.altKey, shift: e.shiftKey, token: ui.spell.shape === 'aura' ? tokenUnder(e.clientX, e.clientY) : null });
        if (pt && !ui.align) { Tools.hover(e, pt); Walls.hover(e, pt); Party.hover(e, pt); if (ui.tool === 'fog') fogHover(pt); }
        return;
      }
      if (Tools.owns(drag.kind)) { Tools.pointerMove(drag, e, pt); return; }
      if (Walls.owns(drag.kind)) { Walls.pointerMove(drag, e, pt); return; }
      if (Party.owns(drag.kind)) { Party.pointerMove(drag, e, pt); return; }
      if (drag.kind === 'right') {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) { drag.moved = true; document.body.classList.add('panning'); }
        if (drag.moved) { view.panBy(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; }
      } else if (drag.kind === 'pan') {
        view.panBy(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY;
      } else if (drag.kind === 'token') {
        send(drag.key, 'layer.update', { id: drag.id, x: pt.x + drag.dx, y: pt.y + drag.dy, drag: true }); // (Prototype 14: only the place goes to the TV)
        view.dragLive(drag.id, pt.x + drag.dx, pt.y + drag.dy, false); // (Prototype 23: on your screen the token sticks to the mouse)
      } else if (drag.kind === 'map') {
        // 4.8: one step per screen frame, however many moves the mouse sends (a gaming mouse: up to 1000 a second)
        drag.cx = e.clientX; drag.cy = e.clientY;
        if (!drag.raf) {
          const d = drag;
          d.raf = requestAnimationFrame(() => {
            d.raf = 0;
            if (drag !== d) return;
            sendView(d.key, { x: d.vx + (d.cx - d.sx) / view.cam.s / view.ppi, y: d.vy + (d.cy - d.sy) / view.cam.s / view.ppi }, true);
          });
        }
      } else if (drag.kind === 'rect') {
        updateRect(drag, pt);
      } else if (drag.kind === 'align') {
        updateAlign(drag, pt);
      } else if (drag.kind === 'brush' || drag.kind === 'paint') {
        // the browser merges fast moves into one event per frame; the merged ones keep strokes smooth
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ce of evs.length ? evs : [e]) {
          const p = view.toMap(ce.clientX, ce.clientY);
          if (Math.hypot(p.x - drag.last.x, p.y - drag.last.y) < drag.r / 4) continue;
          drag.buf.push(p.x, p.y);
          drag.last = p;
        }
        if (drag.kind === 'brush') flushBrush(); else flushPaint();
      } else if (drag.kind === 'laser') {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
        const now = performance.now();
        if (drag.moved && now - lastLaser > 35) { lastLaser = now; ts.ping({ mapId: S.editMapId, x: pt.x, y: pt.y, kind: 'laser' }); }
      } else if (drag.kind === 'fxmove') {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
        if (drag.moved) { const q = fxDropAt(drag, pt); send(drag.key, 'fx.update', { id: drag.id, x: q.x, y: q.y, ...(drag.attached ? { attachTo: null } : {}) }); }
      } else if (drag.kind === 'spellmove') {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
        if (drag.moved) send(drag.key, 'spell.update', { id: drag.id, x: pt.x + drag.dx, y: pt.y + drag.dy });
      } else if (drag.kind === 'cast') {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
        drag.o.shift = e.shiftKey;
        drag.o.moved = drag.moved;
        updateGhost(pt, drag.o);
        if (drag.moved && directional(ui.spell.shape) && drag.o.origin) showReadout(e, aimAngle(drag.o.origin, pt, e.shiftKey));
      } else if (drag.kind === 'assetmove') {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
        if (drag.moved) moveAssets(drag, pt, false);
      } else if (drag.kind === 'assetbox') {
        updateRect(drag, pt);
      } else if (drag.kind === 'scatter') {
        drag.acc += Math.hypot(pt.x - drag.last.x, pt.y - drag.last.y);
        drag.last = pt;
        const gap = Math.max(0.2, ui.assetCells * grid().size * ui.scatterGap);
        while (drag.acc >= gap) { drag.acc -= gap; scatterAt(pt, drag.key); }
      }
      updateAssetGhost();
    });

    const end = (e) => {
      if (!drag) return;
      const pt = view.toMap(e.clientX, e.clientY);
      const d = drag;
      drag = null;
      document.body.classList.remove('panning');
      if (d.kind === 'map') { // 4.4: the map rests: the whole state follows once (4.8: with the last step the mouse made)
        if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
        if (d.cx != null) sendView(d.key, { x: d.vx + (d.cx - d.sx) / view.cam.s / view.ppi, y: d.vy + (d.cy - d.sy) / view.cam.s / view.ppi }, true);
        finishView();
      }
      if (d.kind === 'right' && !d.moved && e.type === 'pointerup') openRadial(e.clientX, e.clientY, d.target);
      else if (Tools.owns(d.kind)) Tools.pointerUp(d, e, pt);
      else if (Walls.owns(d.kind)) Walls.pointerUp(d, e, pt);
      else if (Party.owns(d.kind)) Party.pointerUp(d, e, pt);
      else if (d.kind === 'token') {
        pending.delete(d.key);
        const free = tokSet().snap === false ? !e.altKey : e.altKey; // (4.10: Options → Tokens can turn snapping off; Alt does the other)
        const p = free ? { x: pt.x + d.dx, y: pt.y + d.dy } : Geom.snap(grid(), pt.x + d.dx, pt.y + d.dy, d.size);
        view.dragLive(d.id, p.x, p.y, false);
        cmd('layer.update', { id: d.id, x: p.x, y: p.y, coalesce: d.key, final: true }).finally(() => view.hold(d.id, null));
      } else if (d.kind === 'rect') {
        d.rect.remove();
        const r = rectOf(d, pt);
        if (r.w * zoom() > 0.1 && r.h * zoom() > 0.1) cmd('fog.op', { mode: d.mode, shape: 'rect', ...r });
      } else if (d.kind === 'brush') {
        flushBrush(d);
      } else if (d.kind === 'paint') {
        flushPaint(d);
      } else if (d.kind === 'align') {
        d.line.remove();
        finishAlign(d.p0, pt);
      } else if (d.kind === 'laser' && !d.moved) {
        ts.ping({ mapId: S.editMapId, ...d.pt });
      } else if (d.kind === 'fxmove' && d.moved) {
        pending.delete(d.key);
        const q = fxDropAt(d, pt);
        cmd('fx.update', { id: d.id, x: q.x, y: q.y, coalesce: d.key, final: true, ...(d.attached ? { attachTo: null } : {}) });
      } else if (d.kind === 'spellmove' && d.moved) {
        pending.delete(d.key);
        cmd('spell.update', { id: d.id, x: pt.x + d.dx, y: pt.y + d.dy, coalesce: d.key });
      } else if (d.kind === 'assetmove' && d.moved) {
        moveAssets(d, pt, true);
      } else if (d.kind === 'assetbox') {
        d.rect.remove();
        const r = rectOf(d, pt);
        const inside = map().layers.filter((l) => l.role === 'asset' && !l.locked && l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h).map((l) => l.id);
        setAssetSelection([...d.add, ...inside]);
      } else if (d.kind === 'cast' && e.type === 'pointerup') {
        d.o.moved = d.moved;
        d.o.shift = e.shiftKey;
        const sp = spellFromPointer(pt, { ...d.o, origin: ui.aimFrom || d.o.origin });
        if (ui.aimFrom) { ui.aimFrom = null; renderTopbar(); }
        cast(sp);
        updateGhost(pt, { alt: e.altKey });
      }
      updateBrushCursor();
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('pointerleave', () => { lastPointer = null; updateBrushCursor(); updateAssetGhost(); Tools.leave(); Walls.leave(); Party.leave(); if (ui.tool === 'spell' && !ui.aimFrom && !drag) view.setGhost(null); });
    vp.addEventListener('dblclick', (e) => {
      if (ui.tool === 'fog' && ui.fogShape === 'area') { finishArea(); return; }
      if (ui.tool !== 'select' || e.target.closest('.sv-token') || !S.map) return;
      ts.ping({ mapId: S.editMapId, ...view.toMap(e.clientX, e.clientY) });
    });
  }

  // ---------- turning with Ctrl + wheel ----------
  const stepTurn = (a, dir, step) => normAngle(Math.round((a || 0) / step) * step + dir * step);
  // Beta 2: Ctrl + wheel turns a light shaft, arcs or a bullseye lantern (the selected one, or the next one placed)
  function turnFx(e, dir, step) {
    const f = lookTarget();
    const d = lookDef();
    if (!d || !(d.turn || d.cone)) return false;
    const a = stepTurn(f ? f.angle ?? defaultAngle(d) : ui.look.angle ?? defaultAngle(d), dir, step);
    if (f) send(`turn-${f.id}`, 'fx.update', { id: f.id, angle: a }); else { ui.look.angle = a; refreshPop(); }
    showReadout(e, a);
    return true;
  }
  function turnWithWheel(e, dir, step) {
    const pt = view.toMap(e.clientX, e.clientY);
    if (ui.tool === 'asset') {
      const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList && x.classList.contains('sv-asset'));
      const over = el && layer(el.dataset.id);
      if (ui.selAssets.length > 1 && (!over || ui.selAssets.includes(over.id))) {
        // a selected group turns together, each piece around its own centre
        const items = ui.selAssets.map(layer).filter(Boolean);
        send('turn-many', 'layer.many', { patches: items.map((x) => ({ id: x.id, rotation: stepTurn(x.rotation, dir, step) })) });
        showReadout(e, stepTurn((over || items[0]).rotation, dir, step));
        return;
      }
      const a = over || (ui.selAsset && layer(ui.selAsset));
      if (a) { if (ui.selAsset !== a.id) selectAsset(a.id); send(`turn-${a.id}`, 'layer.update', { id: a.id, rotation: stepTurn(a.rotation, dir, step) }); }
      else { ui.assetRot = stepTurn(ui.assetRot, dir, step); updateAssetGhost(); }
      showReadout(e, a ? stepTurn(a.rotation, dir, step) : ui.assetRot);
      return;
    }
    // a placed spell area under the pointer (in the spell tool: the selected one)
    const sid = view.spellAt(pt.x, pt.y);
    const target = spellOf(ui.tool === 'select' ? sid : (sid && sid === ui.selSpell ? sid : null));
    if (target && directional(target.shape) && !target.attachTo) {
      if (ui.tool === 'select') selectSpell(target.id);
      const a = stepTurn(target.angle, dir, step);
      send(`turn-${target.id}`, 'spell.update', { id: target.id, angle: a });
      showReadout(e, a);
      return;
    }
    if (ui.tool !== 'spell') return;
    ui.spellAngle = stepTurn(ui.spellAngle, dir, step);
    updateGhost(pt, { alt: e.altKey, shift: false, token: null });
    showReadout(e, ui.spellAngle);
  }
  let readout = null;
  let readoutTimer = null;
  function showReadout(e, angle) {
    if (!readout) readout = h('div', { class: 'aim-readout' });
    if (readout.parentNode !== els.stage) els.stage.append(readout);
    const sr = els.stage.getBoundingClientRect();
    readout.textContent = `${Math.round(angle)}°`;
    readout.style.left = `${e.clientX - sr.left + 18}px`;
    readout.style.top = `${e.clientY - sr.top + 14}px`;
    readout.classList.add('on');
    clearTimeout(readoutTimer);
    readoutTimer = setTimeout(() => readout && readout.classList.remove('on'), 1200);
  }
  function updateReadout() { if (readout && ui.tool !== 'spell' && ui.tool !== 'asset' && ui.tool !== 'select') readout.classList.remove('on'); }

  function startSpellMove(id, pt, e) {
    const sp = spellOf(id);
    if (!sp) return;
    selectSpell(id);
    if (sp.attachTo) return; // auras follow their token
    drag = { kind: 'spellmove', id, dx: sp.x - pt.x, dy: sp.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `sp-${id}-${Date.now()}` };
  }

  function fxPointerDown(e, pt) {
    const hEl = e.target.closest('.sv-handle');
    if (hEl) {
      const f = fxOf(hEl.dataset.id);
      if (!f) return;
      selectFx(f.id);
      const p = view.fxPos(f);
      drag = { kind: 'fxmove', id: f.id, dx: p.x - pt.x, dy: p.y - pt.y, attached: !!f.attachTo, sx: e.clientX, sy: e.clientY, moved: false, key: `fx-${f.id}-${Date.now()}` };
      return;
    }
    if (ui.selFx) selectFx(null);
    if (ui.fxMode === 'place') {
      placeEmitter(EMITTERS.find((x) => x.id === ui.emitter) || EMITTERS[0], pt);
    } else if (ui.fxMode === 'paint') {
      const k = `${S.editMapId}:${ui.region}`;
      if (!ui.regionIds[k] || !fxOf(ui.regionIds[k])) ui.regionIds[k] = uid('r');
      drag = { kind: 'paint', id: ui.regionIds[k], preset: ui.region, sid: uid('w'), r: ui.paintIn / 2 / zoom(), buf: [pt.x, pt.y], last: pt };
      flushPaint();
    } else if (ui.fxMode === 'light') {
      const d = LIGHTS.find((x) => x.id === ui.light) || LIGHTS[1];
      const tok = tokenUnder(e.clientX, e.clientY);
      if (tok) {
        const old = tokenLight(tok.id);
        if (old) cmd('fx.remove', { id: old.id });
        placeLight(d, { x: tok.x, y: tok.y }, tok);
        toast(`${tok.name} carries a ${d.label.toLowerCase()}`);
      } else {
        placeLight(d, pt, null);
      }
      if (!map().light.darkness) toast('Lights show once the map is dark: raise Darkness above.');
    }
  }

  // ---------- assets: stamp, scatter, select ----------
  function setBrush(it) {
    const url = it.url || UI.pathToUrl(it.path);
    ui.brush = { path: it.path, name: it.name, kind: it.kind, url };
    ui.recentBrushes = [ui.brush, ...(ui.recentBrushes || []).filter((b) => b.path !== it.path)].slice(0, 8);
    // default size from the picture, assuming 256 pixels per 5 ft square (the usual for top-down assets)
    const done = (w) => { if (w) ui.assetCells = clamp(Math.round((w / 256) * 4) / 4, 0.25, 8); refreshPop(); updateAssetGhost(); };
    if (it.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata';
      v.addEventListener('loadedmetadata', () => done(v.videoWidth), { once: true });
      v.src = url;
    } else { const img = new Image(); img.onload = () => done(img.naturalWidth); img.src = url; }
    if (ui.tool !== 'asset') setTool('asset');
    if (popId !== 'asset') openPop('asset'); else refreshPop();
  }
  function stampAsset(pt, rotation, scale, key) {
    const b = ui.brush;
    if (!b) return null;
    const L = ui.assetLook;
    return cmd('layer.add', { path: b.path, role: 'asset', x: pt.x, y: pt.y, w: round(ui.assetCells * grid().size * scale, 3), rotation: normAngle(rotation), opacity: L.opacity, dark: L.dark, shadow: L.shadow, flip: L.flip, coalesce: key });
  }
  function scatterAt(pt, key) {
    const R = ui.scatterIn / 2 / zoom();
    const a = Math.random() * Math.PI * 2; const d = Math.sqrt(Math.random()) * R;
    const at = { x: pt.x + Math.cos(a) * d, y: pt.y + Math.sin(a) * d };
    const rot = ui.scatterTurn ? Math.random() * 360 : ui.assetRot;
    stampAsset(at, rot, 1 + (Math.random() * 2 - 1) * ui.scatterVary, key);
  }
  // one or several selected assets (Shift + click adds one, Shift + drag selects with a box)
  function setAssetSelection(ids) {
    ui.selAssets = [...new Set(ids)];
    ui.selAsset = ui.selAssets.length ? ui.selAssets[ui.selAssets.length - 1] : null;
    view.setSelectedAssets(ui.selAssets);
    placeCard();
    updateAssetGhost();
    if (popId === 'asset') refreshPop();
  }
  function selectAsset(id) { setAssetSelection(id ? [id] : []); }
  function moveAssets(d, pt, done) {
    const dx = pt.x - d.p0.x; const dy = pt.y - d.p0.y;
    const patches = d.ids.map((id) => ({ id, x: round(d.from[id].x + dx, 4), y: round(d.from[id].y + dy, 4) }));
    if (done) {
      pending.delete(d.key);
      if (patches.length === 1) cmd('layer.update', { ...patches[0], coalesce: d.key }); else cmd('layer.many', { patches, coalesce: d.key });
    } else if (patches.length === 1) send(d.key, 'layer.update', patches[0]);
    else send(d.key, 'layer.many', { patches });
  }
  function assetPointerDown(e, pt) {
    const el = e.target.closest('.sv-asset');
    if (el) {
      const a = layer(el.dataset.id);
      if (!a) return;
      if (e.shiftKey) { setAssetSelection(ui.selAssets.includes(a.id) ? ui.selAssets.filter((x) => x !== a.id) : [...ui.selAssets, a.id]); return; }
      if (!ui.selAssets.includes(a.id)) selectAsset(a.id);
      const ids = ui.selAssets.slice();
      const from = Object.fromEntries(ids.map((id) => { const l = layer(id); return [id, { x: l.x, y: l.y }]; }));
      drag = { kind: 'assetmove', ids, from, p0: pt, sx: e.clientX, sy: e.clientY, moved: false, key: `as-${a.id}-${Date.now()}` };
      return;
    }
    if (e.shiftKey) {
      const pre = h('div', { class: 'rect-preview select' });
      view.marks.appendChild(pre);
      drag = { kind: 'assetbox', x0: pt.x, y0: pt.y, rect: pre, add: ui.selAssets.slice() };
      updateRect(drag, pt);
      return;
    }
    if (ui.selAssets.length) { selectAsset(null); return; }
    if (!ui.brush) { toast('Pick an asset in the library first.'); Drawer.open({ cat: 'assets', purpose: 'brush', back: { pop: 'asset', tool: 'asset' } }); return; }
    if (ui.assetMode === 'stamp') { stampAsset(pt, ui.assetRot, 1, `stamp-${Date.now()}`); return; }
    const key = `scatter-${Date.now()}`;
    drag = { kind: 'scatter', key, last: pt, acc: 0 };
    scatterAt(pt, key);
  }
  // 2.6: what a click (or a drop) will place, half see-through: the picture itself, a video playing
  let ghost = null; // { el, url, kind, w0: its own width in pixels, bad }
  let dropGhost = null; // a library picture dragged over the map (ui.js DragPic): { asset, x, y } (the mouse)
  function ghostMedia(url, kind) {
    if (ghost && ghost.url === url) return ghost;
    freeGhost();
    const video = kind === 'video';
    const el = document.createElement(video ? 'video' : 'img');
    el.className = 'asset-ghost';
    const g = { el, url, kind, w0: 0, bad: false };
    if (video) {
      Object.assign(el, { muted: true, loop: true, playsInline: true, disablePictureInPicture: true, preload: 'auto' });
      el.addEventListener('loadedmetadata', () => { g.w0 = el.videoWidth; if (ghost === g) updateAssetGhost(); }, { once: true });
    } else {
      el.alt = '';
      el.draggable = false;
      el.addEventListener('load', () => { g.w0 = el.naturalWidth; if (ghost === g) updateAssetGhost(); }, { once: true });
    }
    el.addEventListener('error', () => { g.bad = true; if (ghost === g) updateAssetGhost(); }, { once: true });
    el.src = url;
    ghost = g;
    return g;
  }
  function freeGhost() {
    if (!ghost) return;
    const { el, kind } = ghost;
    ghost = null;
    el.remove();
    if (kind === 'video') { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} }
  }
  function hideGhost() {
    if (!ghost) return;
    ghost.el.style.display = 'none';
    if (ghost.kind === 'video' && !ghost.el.paused) ghost.el.pause();
  }
  function showGhost(g, css) {
    if (g.el.parentNode !== view.marks) view.marks.appendChild(g.el);
    Object.assign(g.el.style, { display: '', ...css });
    if (g.kind === 'video' && g.el.paused) g.el.play().catch(() => {});
  }
  function updateAssetGhost() {
    if (!view) return;
    if (dropGhost) { placeDropGhost(); return; }
    const hovering = lastPointer && document.elementsFromPoint(lastPointer.x, lastPointer.y).some((x) => x.classList && x.classList.contains('sv-asset'));
    const show = ui.tool === 'asset' && ui.brush && ui.assetMode === 'stamp' && lastPointer && S && S.map && !ui.selAsset && !hovering && !(drag && drag.kind === 'assetmove');
    if (!show) { hideGhost(); return; }
    const g = ghostMedia(ui.brush.url, ui.brush.kind);
    if (g.bad) { hideGhost(); return; }
    const p = view.toTable(lastPointer.x, lastPointer.y);
    const w = ui.assetCells * grid().size * zoom() * view.ppi;
    const L = ui.assetLook;
    g.el.classList.remove('is-token');
    showGhost(g, {
      left: `${p.x * view.ppi}px`, top: `${p.y * view.ppi}px`, width: `${w}px`, height: 'auto', opacity: String(0.5 * L.opacity),
      transform: `translate(-50%, -50%) rotate(${ui.assetRot}deg) scaleX(${L.flip ? -1 : 1})`, filter: L.dark > 0 ? `brightness(${1 - L.dark})` : '',
    });
  }
  // the size a drop gives it (placeAsset: 256 pixels a square), a token on the square it snaps to (dropAsset)
  function placeDropGhost() {
    const { asset: a, x, y } = dropGhost;
    if (!S || !S.map) { hideGhost(); return; }
    const g = ghostMedia(a.url || UI.pathToUrl(a.path), a.kind);
    const cell = grid().size * zoom() * view.ppi;
    if (a.role === 'token') {
      const m = view.toMap(x, y);
      const sp = Geom.snap(grid(), m.x, m.y, 1);
      const t = view.mapToTable(sp.x, sp.y);
      g.el.classList.add('is-token');
      showGhost(g, { left: `${t.x * view.ppi}px`, top: `${t.y * view.ppi}px`, width: `${cell}px`, height: `${cell}px`, opacity: '0.5', transform: 'translate(-50%, -50%)', filter: '' });
      return;
    }
    if (!g.w0 && !g.bad) { hideGhost(); return; } // its size is known once it has loaded
    const p = view.toTable(x, y);
    const w = clamp((g.w0 || 512) / 256, 0.25, 8) * cell;
    g.el.classList.remove('is-token');
    showGhost(g, { left: `${p.x * view.ppi}px`, top: `${p.y * view.ppi}px`, width: `${w}px`, height: 'auto', opacity: '0.5', transform: 'translate(-50%, -50%)', filter: '' });
  }
  function opacityRange(list) {
    const input = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: list[0].opacity ?? 1, 'aria-label': 'Opacity' });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (list.length === 1) send(`op-${list[0].id}`, 'layer.update', { id: list[0].id, opacity: v });
      else send('op-many', 'layer.many', { patches: list.map((a) => ({ id: a.id, opacity: v })) });
    });
    return h('label', { class: 'card-range', 'data-tip': 'Opacity' }, iconEl('circle-half-2'), input);
  }
  function lockAssets(list) {
    if (!list.length) return;
    if (list.length === 1) cmd('layer.update', { id: list[0].id, locked: true }); else cmd('layer.many', { patches: list.map((a) => ({ id: a.id, locked: true })) });
    setAssetSelection([]);
    toast(`${list.length === 1 ? list[0].name : `${list.length} assets`} locked. Unlock in the Assets panel or in Layers.`, { undo: () => cmd('history.undo'), ms: 6000 });
  }
  // Prototype 23: where an asset lies: under the effects (the ground), in front of them (Prototype 18), above the tokens
  const ASSET_LEVELS = [
    { id: 'under', label: 'Under the effects', icon: 'stack-2', tip: 'Mist and smoke drift over it (the ground, rugs, furniture)', patch: { front: false, over: false } },
    { id: 'front', label: 'In front of the effects', icon: 'stack-front', tip: 'Mist and smoke stay under it; tokens stand on top', patch: { front: true, over: false } },
    { id: 'over', label: 'Above the tokens', icon: 'trees', tip: 'Tree tops, roofs, bridges. On the table it opens where a token stands under it', patch: { over: true, front: false } },
  ];
  const levelOf = (a) => (a.over ? 'over' : a.front ? 'front' : 'under');
  function levelMenu(e, items) {
    const cur = items.length === 1 ? levelOf(items[0]) : null;
    const x = e.currentTarget ? e.currentTarget.getBoundingClientRect().left : e.clientX;
    const y = e.currentTarget ? e.currentTarget.getBoundingClientRect().bottom + 6 : e.clientY;
    openMenu(x, y, [{ header: items.length === 1 ? 'Level' : `Level of ${items.length} assets` },
      ...ASSET_LEVELS.map((L) => ({ icon: cur === L.id ? 'check' : L.icon, checked: cur === L.id, label: L.label, tip: L.tip,
        action: () => (items.length === 1 ? cmd('layer.update', { id: items[0].id, ...L.patch, stepLabel: L.label }) : cmd('layer.many', { patches: items.map((a) => ({ id: a.id, ...L.patch })), stepLabel: L.label })) }))]);
  }
  function assetCard(a) {
    return [
      h('span', { class: 'card-title ellipsis', 'data-tip': a.name }, iconEl('trees'), a.name),
      ib('minus', 'Smaller', () => cmd('layer.update', { id: a.id, w: round(a.w / 1.2, 3) }), { key: '[' }),
      ib('plus', 'Bigger', () => cmd('layer.update', { id: a.id, w: round(a.w * 1.2, 3) }), { key: ']' }),
      cardSep(),
      ib('rotate-clockwise', 'Turn 15° (or Ctrl + wheel)', () => cmd('layer.update', { id: a.id, rotation: normAngle((a.rotation || 0) + 15) })),
      ib('flip-vertical', 'Mirror', () => cmd('layer.update', { id: a.id, flip: !a.flip }), { on: a.flip }),
      ib('shadow', a.shadow ? 'Casts a shadow. Click to remove it' : 'Cast a shadow', () => cmd('layer.update', { id: a.id, shadow: !a.shadow }), { on: a.shadow }),
      // 4.8: an animated asset: its frames prepared (light to play), or the video itself (sharp at any size, heavier)
      a.kind === 'video' ? ib('movie', a.asVideo ? 'Plays as a video (sharp, heavier). Click for prepared frames again' : 'Play as a video: sharper for big animations, but heavier', () => setAsVideo(a, !a.asVideo), { on: !!a.asVideo }) : null,
      opacityRange([a]),
      cardSep(),
      ib('copy', 'Duplicate', async () => { const r = await cmd('layer.duplicate', { id: a.id, dx: grid().size, dy: 0 }); if (r.selected) selectAsset(r.selected); }),
      ib('arrow-bar-to-down', 'Send to the back', () => cmd('layer.order', { id: a.id, to: 'back' })),
      ib('stack-front', `${ASSET_LEVELS.find((x) => x.id === levelOf(a)).label}. Click to change`, (e) => levelMenu(e, [a]), { on: levelOf(a) !== 'under' }), // Prototype 18 / 23
      ib('lock', 'Lock it in place (clicks go through it)', () => lockAssets([a])),
      ib(a.hidden ? 'eye-off' : 'eye', a.hidden ? 'Hidden. Click to show players' : 'Hide from players', () => cmd('layer.update', { id: a.id, hidden: !a.hidden }), { on: a.hidden, key: 'H' }),
      ib('trash', 'Remove', () => undoable('layer.remove', { id: a.id }), { danger: true, key: 'Del' }),
    ].filter(Boolean);
  }
  function assetsCard(items) {
    const many = (patch) => cmd('layer.many', { patches: items.map((a) => ({ id: a.id, ...(typeof patch === 'function' ? patch(a) : patch) })) });
    const hidden = items.every((a) => a.hidden);
    return [
      h('span', { class: 'card-title' }, iconEl('trees'), `${items.length} assets`),
      ib('minus', 'Smaller', () => many((a) => ({ w: round(a.w / 1.2, 3) })), { key: '[' }),
      ib('plus', 'Bigger', () => many((a) => ({ w: round(a.w * 1.2, 3) })), { key: ']' }),
      cardSep(),
      ib('rotate-clockwise', 'Turn each 15° (or Ctrl + wheel)', () => many((a) => ({ rotation: normAngle((a.rotation || 0) + 15) }))),
      ib('flip-vertical', 'Mirror', () => many((a) => ({ flip: !a.flip }))),
      ib('shadow', 'Shadows on or off', () => many({ shadow: !items.every((a) => a.shadow) }), { on: items.every((a) => a.shadow) }),
      ib('stack-front', 'Level: under the effects, in front of them, or above the tokens', (e) => levelMenu(e, items), { on: items.every((a) => levelOf(a) !== 'under') }), // Prototype 18 / 23
      opacityRange(items),
      cardSep(),
      ib('lock', 'Lock them in place', () => lockAssets(items)),
      ib(hidden ? 'eye-off' : 'eye', hidden ? 'Hidden. Click to show players' : 'Hide from players', () => many({ hidden: !hidden }), { on: hidden, key: 'H' }),
      ib('trash', 'Remove', () => { undoable('layer.removeMany', { ids: items.map((a) => a.id) }); setAssetSelection([]); }, { danger: true, key: 'Del' }),
    ];
  }
  // the look of the selected assets, or of the next one you stamp
  function assetLookSection() {
    const sel = () => ui.selAssets.map(layer).filter(Boolean);
    const head = h('div', { class: 'look-head' });
    bind(() => {
      const list = sel();
      const sig = list.map((a) => a.id).join();
      if (head.dataset.sig === sig && head.childNodes.length) return;
      head.dataset.sig = sig;
      head.innerHTML = '';
      head.append(...[h('span', { class: 'grow' }, list.length ? (list.length === 1 ? UI.wrapName(list[0].name, '', 'b') : h('b', {}, `${list.length} selected`)) : 'Look of the next one you place'),
        list.length ? h('button', { class: 'btn ghost small', onclick: () => setAssetSelection([]) }, iconEl('x'), 'Done') : null].filter(Boolean));
    });
    const get = (k, d) => { const list = sel(); return list.length ? (list[0][k] ?? d) : ui.assetLook[k]; };
    const set = (k, v, key) => {
      const list = sel();
      if (!list.length) { ui.assetLook[k] = v; updateAssetGhost(); refreshPop(); return; }
      const patches = list.map((a) => ({ id: a.id, [k]: v }));
      if (key) send(key, 'layer.many', { patches }); else cmd('layer.many', { patches });
    };
    const lockBox = h('div', {}, toggle({ label: 'Locked (clicks go through it)', get: () => false, set: (v) => { if (v) lockAssets(sel()); } }));
    bind(() => { lockBox.hidden = !sel().length; });
    return h('div', { class: 'stack look' }, head,
      slider({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, get: () => get('opacity', 1), set: (v, k) => set('opacity', v, k), fmt: pct }),
      slider({ label: 'Darken', min: 0, max: 0.8, step: 0.05, get: () => get('dark', 0), set: (v, k) => set('dark', v, k), fmt: (v) => (v < 0.01 ? 'Off' : pct(v)) }),
      slider({ label: 'Turn', min: -180, max: 180, step: 5,
        get: () => { const list = sel(); return list.length ? (list[0].rotation || 0) : ui.assetRot; },
        set: (v, k) => { const list = sel(); if (list.length) send(k, 'layer.many', { patches: list.map((a) => ({ id: a.id, rotation: v })) }); else { ui.assetRot = v; updateAssetGhost(); } }, fmt: (v) => `${v}°` }),
      toggle({ label: 'Shadow', get: () => get('shadow', false), set: (v) => set('shadow', v) }),
      toggle({ label: 'Mirror', get: () => get('flip', false), set: (v) => set('flip', v) }),
      lockBox);
  }
  function setAsVideo(a, on) {
    cmd('layer.update', { id: a.id, asVideo: !!on });
    toast(on ? `${a.name} plays as a video: sharp, but heavier to play` : `${a.name} uses prepared frames again`, { ms: 2600 });
  }
  function assetRadial(a, x, y) {
    selectAsset(a.id);
    Radial.open(x, y, [
      { icon: 'rotate-clockwise', label: 'Turn 45°', run: () => cmd('layer.update', { id: a.id, rotation: normAngle((a.rotation || 0) + 45) }) },
      { icon: 'plus', label: 'Bigger', run: () => cmd('layer.update', { id: a.id, w: round(a.w * 1.25, 3) }) },
      { icon: 'flip-vertical', label: 'Mirror', run: () => cmd('layer.update', { id: a.id, flip: !a.flip }) },
      { icon: 'copy', label: 'Duplicate', run: () => cmd('layer.duplicate', { id: a.id, dx: grid().size, dy: 0 }) },
      { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('layer.remove', { id: a.id }) },
      { icon: 'arrow-bar-to-down', label: 'To back', run: () => cmd('layer.order', { id: a.id, to: 'back' }) },
      { icon: 'stack-front', label: 'Level …', run: () => levelMenu({ clientX: x, clientY: y }, [a]) }, // Prototype 18 / 23
      { icon: a.hidden ? 'eye' : 'eye-off', label: a.hidden ? 'Show' : 'Hide', run: () => cmd('layer.update', { id: a.id, hidden: !a.hidden }) },
      { icon: 'minus', label: 'Smaller', run: () => cmd('layer.update', { id: a.id, w: round(a.w / 1.25, 3) }) },
      a.kind === 'video' ? { icon: 'movie', label: a.asVideo ? 'Prepared frames' : 'Sharp video', run: () => setAsVideo(a, !a.asVideo) } : null, // 4.8
    ].filter(Boolean), a.name);
  }
  function buildAssetPop() {
    const brushRow = h('div', { class: 'brush-row', dataset: { flash: 'brush' } });
    bind(() => {
      const b = ui.brush;
      if (brushRow.dataset.path === (b ? b.path : '')) return;
      brushRow.dataset.path = b ? b.path : '';
      brushRow.innerHTML = '';
      brushRow.append(h('span', { class: 'brush-thumb' }, b ? Thumbs.img(b.path, b.kind) : iconEl('trees')),
        b ? UI.wrapName(b.name, 'grow') : h('span', { class: 'grow' }, 'No asset picked yet'),
        btn(b ? 'Change' : 'Pick one', 'photo', () => Drawer.open({ cat: 'assets', purpose: 'brush', back: { pop: 'asset', tool: 'asset' } }), { kind: b ? '' : 'primary' }));
    });
    const recent = h('div', { class: 'brush-recent' });
    bind(() => {
      const list = (ui.recentBrushes || []).slice(0, 8);
      const sig = list.map((b) => b.path).join('|') + (ui.brush ? ui.brush.path : '');
      if (recent.dataset.sig === sig) return;
      recent.dataset.sig = sig;
      recent.innerHTML = '';
      recent.hidden = list.length < 2;
      for (const b of list) recent.append(h('button', { class: `brush-pick ${ui.brush && ui.brush.path === b.path ? 'on' : ''}`, 'data-tip': b.name, 'aria-label': b.name, onclick: () => setBrush(b) }, Thumbs.img(b.path, b.kind)));
    });
    const scatterBox = h('div', { class: 'stack' },
      slider({ label: 'Brush size', min: 1, max: 12, step: 0.5, get: () => ui.scatterIn, set: (v) => { ui.scatterIn = v; updateBrushCursor(); }, fmt: (v) => `${v}″` }),
      slider({ label: 'Spacing', min: 0.4, max: 3, step: 0.05, get: () => ui.scatterGap, set: (v) => { ui.scatterGap = v; }, fmt: (v) => (v < 0.8 ? 'Dense' : v > 1.8 ? 'Sparse' : 'Normal') }),
      slider({ label: 'Size varies', min: 0, max: 0.6, step: 0.05, get: () => ui.scatterVary, set: (v) => { ui.scatterVary = v; }, fmt: (v) => `±${Math.round(v * 100)}%` }),
      toggle({ label: 'Random turn', get: () => ui.scatterTurn, set: (v) => { ui.scatterTurn = v; } }));
    bind(() => { scatterBox.hidden = ui.assetMode !== 'scatter'; });
    const unlock = h('div', { class: 'ctl-row' });
    bind(() => {
      const locked = map().layers.filter((l) => l.role === 'asset' && l.locked);
      if (unlock.dataset.n === String(locked.length)) return;
      unlock.dataset.n = String(locked.length);
      unlock.innerHTML = '';
      unlock.hidden = !locked.length;
      if (locked.length) unlock.append(h('span', { class: 'grow hint' }, `${locked.length} locked`), btn('Unlock all', 'lock-open', () => { const ls = map().layers.filter((l) => l.role === 'asset' && l.locked); cmd('layer.many', { patches: ls.map((l) => ({ id: l.id, locked: false })) }); }));
    });
    return h('div', { class: 'stack' },
      brushRow, recent,
      seg({ options: [{ value: 'stamp', label: 'Stamp', icon: 'pointer', tip: 'One per click' }, { value: 'scatter', label: 'Scatter', icon: 'spray', tip: 'Drag to paint many, turned and sized at random' }],
        get: () => ui.assetMode, set: (v) => { ui.assetMode = v; refreshPop(); updateBrushCursor(); updateAssetGhost(); } }),
      slider({ label: 'Size', min: 0.25, max: 8, step: 0.25, get: () => ui.assetCells, set: (v) => { ui.assetCells = v; updateAssetGhost(); }, fmt: (v) => `${v} ${v === 1 ? 'square' : 'squares'}` }),
      scatterBox,
      assetLookSection(),
      unlock);
  }

  function flushBrush(d = drag) {
    if (!d || d.kind !== 'brush' || !d.buf.length) return;
    const pts = d.buf;
    d.buf = [];
    cmd('fog.stroke', { id: d.id, mode: d.mode, r: d.r, pts, coalesce: d.id });
  }
  function flushPaint(d = drag) {
    if (!d || d.kind !== 'paint' || !d.buf.length) return;
    const pts = d.buf;
    d.buf = [];
    const L = ui.look;
    cmd('fx.stroke', { id: d.id, preset: d.preset, sid: d.sid, r: d.r, pts, coalesce: d.sid, color: L.color, intensity: L.intensity, density: L.density, speed: L.speed });
  }
  function rectOf(d, p) { return { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) }; }
  function updateRect(d, p) {
    const r = rectOf(d, p);
    const a = view.mapToPx(r.x, r.y);
    const k = view.ppi * zoom();
    Object.assign(d.rect.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${r.w * k}px`, height: `${r.h * k}px`, borderWidth: `${2 / view.cam.s}px` });
  }

  // ---------- match the map's printed grid (only the grid changes) ----------
  function startAlign() {
    if (!S.map || !S.map.bg) { toast('Load a background first.'); return; }
    closePop();
    ui.align = { cells: (ui.align && ui.align.cells) || 3 };
    document.body.classList.add('aligning');
    renderTopbar();
  }
  function stopAlign() {
    ui.align = null;
    document.body.classList.remove('aligning');
    view.setGridPreview(null);
    renderTopbar();
  }
  const norm = (a, period) => ((((a + period / 2) % period) + period) % period) - period / 2;
  // Square: the drag is the diagonal of an n×n block. Hex: the drag joins two centres n steps apart.
  function alignGrid(p0, p1, n) {
    const g = grid();
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) / D2R;
    if (Geom.isHex(g)) {
      return { ...g, size: len / n, angle: round(norm(ang - (g.type === 'hex-flat' ? 90 : 0), 60), 3), ox: p0.x, oy: p0.y, show: true };
    }
    return { ...g, size: len / (n * Math.SQRT2), angle: round(norm(ang - 45, 90), 3), ox: p0.x, oy: p0.y, show: true };
  }
  function updateAlign(d, pt) {
    const a = view.mapToPx(d.p0.x, d.p0.y); const b = view.mapToPx(pt.x, pt.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    Object.assign(d.line.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${len}px`, transform: `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`, height: `${Math.max(2, 3 / view.cam.s)}px` });
    if (len * view.cam.s > 12) view.setGridPreview(alignGrid(d.p0, pt, ui.align.cells));
  }
  async function finishAlign(p0, p1) {
    const n = ui.align ? ui.align.cells : 3;
    stopAlign();
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) * zoom() < 0.2) return;
    const g = alignGrid(p0, p1, n);
    await cmd('grid.update', { type: g.type, size: g.size, angle: g.angle, ox: g.ox, oy: g.oy, show: true, coalesce: `align-${Date.now()}` });
    const phys = g.size * zoom();
    toast(`Grid matched${Math.abs(g.angle) > 0.2 ? ` (tilted ${round(g.angle, 1)}°)` : ''}. One cell is ${round(phys, 2)}″ on the table${Math.abs(phys - 1) > 0.05 ? ': use "Make grid squares 1 inch" for miniatures' : ''}.`, { undo: () => cmd('history.undo'), ms: 8000 });
  }

  // =====================================================================
  // Drag and drop: library tiles and files from Explorer
  // =====================================================================
  function bindDrops() {
    const vp = els.viewport;
    // 2.6: an asset or a token dragged over the map shows where it lands and how big, half see-through
    UI.DragPic.zone({
      test: (e) => !!(view && view.root.contains(e.target)),
      move: (e, a) => {
        if (!S || !S.map || !a || (a.role !== 'asset' && a.role !== 'token') || (a.kind !== 'image' && a.kind !== 'video')) return false;
        dropGhost = { asset: a, x: e.clientX, y: e.clientY };
        updateAssetGhost();
        return true;
      },
      leave: () => { if (!dropGhost) return; dropGhost = null; updateAssetGhost(); },
    });
    vp.addEventListener('dragover', (e) => {
      const types = [...e.dataTransfer.types];
      if (types.includes('application/x-ts-asset') || types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; vp.classList.add('drop-ok'); }
    });
    vp.addEventListener('dragleave', () => vp.classList.remove('drop-ok'));
    vp.addEventListener('drop', async (e) => {
      e.preventDefault();
      vp.classList.remove('drop-ok');
      document.body.classList.remove('dragging-asset');
      if (!S || !S.map) return;
      const pt = view.toMap(e.clientX, e.clientY);
      const asset = parseAsset(e.dataTransfer);
      if (asset) { dropAsset(asset.path, asset.kind, asset.role, pt, asset.name); return; }
      for (const f of [...e.dataTransfer.files]) {
        const p = ts.pathForFile(f);
        if (!p) continue;
        const kind = kindOfName(p);
        if (!kind) { toast(`${f.name} is not an image, video or sound file.`, { kind: 'error' }); continue; }
        const role = await classify(p, kind, f.name);
        // a copy goes into the library first, so the map keeps working when the original is moved
        const lp = await toLibrary(p, role);
        dropAsset(lp, kind, role, pt, f.name);
      }
    });
    // dropping files anywhere else should never navigate the window away
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }
  // a file from outside the library: copied into the right folder (a walls file with the same name comes along)
  const ROLE_CAT = { map: 'maps', token: 'tokens', asset: 'assets', overlay: 'overlays', sound: 'sounds', portrait: 'portraits', handout: 'handouts' };
  async function toLibrary(p, role) {
    try {
      const r = await ts.library('import', { files: [p], cat: ROLE_CAT[role] || 'maps' });
      if (r && r.ok && r.items[0]) {
        if (r.copied) toast(`${r.items[0].name} copied into ${r.items[0].rel.split('/').slice(0, -1).join('/')}`, { ms: 3500 });
        return r.items[0].path;
      }
    } catch {}
    return p;
  }
  async function dropAsset(path, kind, role, pt, name) {
    if (role === 'map') { if (S.map.bg) await undoable('bg.set', { path }, 'Background replaced'); else await cmd('bg.set', { path }); return; }
    if (role === 'token') {
      const p = Geom.snap(grid(), pt.x, pt.y, 1);
      const r = await cmd('layer.add', { path, role: 'token', x: p.x, y: p.y, tag: (ui.tok && ui.tok.tag) || 'off' });
      if (r.selected) { setTool('select'); ui.selected = r.selected; view.setSelected(r.selected); placeCard(); }
      return;
    }
    if (role === 'asset') { await placeAsset({ path, kind, name }, pt); return; }
    if (role === 'overlay') {
      const a = anchorFor(name || path);
      await cmd('layer.add', { path, role: 'overlay', anchor: a });
      toast(a === 'table' ? 'Weather overlay added (fixed to the table)' : 'Overlay added');
      return;
    }
    if (role === 'sound') { await cmd('layer.add', { path, role: 'audio' }); toast('Sound added to this map'); }
    if (role === 'portrait') await TB.talkToggle({ path, kind, name });
    if (role === 'handout') await cmd('handout.show', { path });
  }
  function kindOfName(p) {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
    if (['.webm', '.mp4', '.m4v', '.mov'].includes(ext)) return 'video';
    if (['.mp3', '.ogg', '.opus', '.wav', '.flac', '.m4a'].includes(ext)) return 'audio';
    return null;
  }
  // Smart default for files dropped from outside the library.
  async function classify(path, kind, name) {
    if (kind === 'audio') return 'sound';
    const n = name.toLowerCase();
    if (/token|npc|monster|creature|mini/.test(n)) return 'token';
    if (/overlay|fx|effect|rain|snow|fog|mist|dust|ember|fire|smoke|spark|light|ray|leaves|alpha/.test(n)) return 'overlay';
    const info = await probe(path, kind);
    if (!info) return kind === 'video' ? 'map' : 'token';
    if (kind === 'video') return info.alpha ? 'overlay' : 'map';
    if (info.alpha) return Math.max(info.w, info.h) <= 1400 ? 'token' : 'overlay';
    return Math.max(info.w, info.h) >= 1000 ? 'map' : 'token';
  }
  function probe(path, kind) {
    return new Promise((resolve) => {
      const url = UI.pathToUrl(path);
      const check = (el, w, hh) => {
        try {
          const c = document.createElement('canvas');
          c.width = 48; c.height = 48;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(el, 0, 0, 48, 48);
          const d = ctx.getImageData(0, 0, 48, 48).data;
          let alpha = false;
          for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
          resolve({ w, h: hh, alpha });
        } catch { resolve(null); }
      };
      setTimeout(() => resolve(null), 5000);
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.preload = 'auto';
        v.addEventListener('loadeddata', () => check(v, v.videoWidth, v.videoHeight), { once: true });
        v.addEventListener('error', () => resolve(null));
        v.src = url;
      } else {
        const img = new Image();
        img.onload = () => check(img, img.naturalWidth, img.naturalHeight);
        img.onerror = () => resolve(null);
        img.src = url;
      }
    });
  }

  // =====================================================================
  // Keyboard
  // =====================================================================
  function bindKeys() {
    // 4.0.1: a field that takes Enter often lets go of the keyboard (the HP of a goblin, a wheel entry, the spell
    // search); what is typed next for a moment is not a shortcut
    const isField = (x) => x && x.tagName && (/TEXTAREA|SELECT/.test(x.tagName) || (x.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(x.type)));
    let typedAt = 0;
    // (only Enter: it may close the field while you keep typing; Esc or a click is leaving on purpose and ends it)
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') typedAt = 0; else if (isField(e.target) && e.key === 'Enter') typedAt = Date.now(); }, true);
    window.addEventListener('pointerdown', () => { typedAt = 0; }, true);
    window.addEventListener('keydown', (e) => {
      if (!S || S.screen !== 'play' || document.body.dataset.screen !== 'play' || document.querySelector('.modal-back:not(.help)')) return;
      if (App.helpOpen()) return; // 4.0.1: the Guide is open: the keys are for it, not for the map behind it
      const a = document.activeElement;
      // where the key went, not what has focus now: a field may already have handled Enter and blurred itself
      const typing = isField(e.target) || isField(a);
      if (e.key === 'Escape') {
        if (Walls.key('escape')) return;
        if (Party.cancel()) return;
        if (ui.areaPts) { cancelArea(); return; }
        if (Radial.isOpen) Radial.close();
        else if (menuOpen()) closeMenu();
        else if (App.helpOpen()) App.toggleHelp(false);
        else if (ui.momentAim) aimMoment(null);
        else if (ui.align) stopAlign();
        else if (ui.aimFrom) { ui.aimFrom = null; updateGhost(); renderTopbar(); }
        else if (popId) closePop();
        else if (ui.drawer) Drawer.cancel();
        else if (ui.selected) { ui.selected = null; view.setSelected(null); placeCard(); }
        else if (ui.selSpell) selectSpell(null);
        else if (ui.selFx) selectFx(null);
        else if (ui.selAsset) selectAsset(null);
        else if (ui.selMark) Tools.selectMark(null);
        Tools.spotOff();
        if (typing) a.blur();
        return;
      }
      if (typing) return;
      if (!e.ctrlKey && !e.metaKey && (e.key.length === 1 || e.key === 'Enter') && Date.now() - typedAt < 900) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); cmd('history.undo'); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); cmd('history.redo'); }
        else if (k === 'd' && ui.selected) { e.preventDefault(); const l = layer(ui.selected); if (l) duplicateToken(l); }
        // Ctrl + 1 to 9: the Spotify moods
        else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey) { e.preventDefault(); Spot.playNumber(Number(e.code.slice(5))); }
        return;
      }
      if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
      // F1 to F8: the snapshots of the map on the table (or of this one); maps without any: the older cues
      if (/^F[1-8]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key.slice(1));
        Snaps.playBy({ n }).then((r) => {
          if (r && (r.ok || r.canceled)) return;
          const cq = Show.cues().find((x) => x.slot === n);
          if (cq && r && r.none) Show.playCue(cq);
          else toast(r && r.error ? `${r.error} (Toolbox → Snapshots)` : `No snapshot ${n}`, { ms: 2200 });
        });
        return;
      }
      // Shift + 1 to 9: the starred moments (+ and − keep sizing a spell, on keyboards where they need Shift)
      if (e.shiftKey && /^Digit[1-9]$/.test(e.code) && !(ui.tool === 'spell' && /^[+\-=_]$/.test(e.key))) {
        e.preventDefault();
        const d = Show.starredList()[Number(e.code.slice(5)) - 1];
        if (d) Show.play(d.id); else toast('Star screen effects in the Toolbox to play them with Shift + a number', { ms: 2600 });
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); toggleRoster(); return; }
      if (e.key === '?') { App.toggleHelp(); return; }
      // Alt + 1 to 9: a map of this chapter
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const ch = viewChapter();
        const m = ch && ch.maps[Number(e.code.slice(5)) - 1];
        if (m) cmd('edit.open', { id: m.id });
        return;
      }
      // 1 to 0: the hotbar
      if (!e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) {
        e.preventDefault();
        const n = Number(e.code.slice(5));
        if (Hot && S.map) Hot.press(n === 0 ? 9 : n - 1);
        return;
      }
      if (!S.map) return;
      // the party walks one square with the arrow keys
      if (ui.tool === 'party' && /^Arrow/.test(e.key)) { if (Party.key(e)) e.preventDefault(); return; }
      switch (k) {
        case 'v': setTool('select'); closePop(); break;
        case 'u': setTool('party'); if (popId !== 'party') openPop('party'); break;
        case 'm': setTool('map'); if (popId !== 'map') openPop('map'); break;
        case 'r': ui.fogMode = 'reveal'; setTool('fog'); if (popId !== 'fog') openPop('fog'); break;
        case 'c': ui.fogMode = 'cover'; setTool('fog'); if (popId !== 'fog') openPop('fog'); break;
        case 'e': setTool('fx'); if (popId !== 'fx') openPop('fx'); break;
        case 'a': setTool('spell'); if (popId !== 'spell') openPop('spell'); break;
        case 's': setTool('asset'); if (popId !== 'asset') openPop('asset'); break;
        case 'p': case 'd': {
          const t = k === 'p' ? 'point' : 'draw';
          if (ui.tool === t) { const name = Tools.cycle(t); renderRail(); if (name) toast(name, { ms: 1200 }); } else { setTool(t); if (popId !== t) openPop(t); }
          break;
        }
        case 'n': setTool('token'); if (popId !== 'token') openPop('token'); break;
        case 'w':
          if (ui.tool === 'walls') { const name = Walls.cycle(); if (name) toast(name, { ms: 1200 }); } else { setTool('walls'); if (popId !== 'walls') openPop('walls'); }
          break;
        case 'o': togglePop('talk'); break;
        case 'q': if (popId === 'toolbox') closePop(); else { ui.tb = 'home'; openPop('toolbox'); } break;
        case 'i': TB.togglePanel(e.shiftKey ? 'chars' : 'init'); break;
        case 'x': setTool('mark'); if (popId !== 'mark') openPop('mark'); break;
        case 'j': setTool('notes'); if (popId !== 'notes') openPop('notes'); break;
        case 'enter':
          if (a && a !== document.body && a.tagName === 'BUTTON') break; // Enter on a focused button clicks that button
          e.preventDefault();
          if (Walls.key('enter')) break; // ends a line of walls
          if (ui.tool === 'fog' && finishArea()) break; // ends an area
          Tools.nextRound();
          break;
        case 'l': if (e.shiftKey) Drawer.open({ full: true }); else Drawer.toggle(); break;
        case 'k': togglePop('layers'); break;
        case 'g': cmd('grid.update', { show: !S.map.grid.show }); break;
        case 'f': if (e.shiftKey) fitAll(); else view.fit(); break;
        case 't': if (!isLive()) cmd('table.send'); break;
        case 'b': if (S.table.open) cmd('table.blackout'); break;
        case '+': case '=': case '-': case '_':
          if (ui.tool === 'spell') setSpell({ size: stepIn(SIZES, ui.spell.size, k === '+' || k === '=' ? 1 : -1) });
          break;
        case '[': case ']':
          if (ui.tool === 'asset') {
            const a = ui.selAsset && layer(ui.selAsset);
            if (ui.selAssets.length > 1) cmd('layer.many', { patches: ui.selAssets.map(layer).filter(Boolean).map((x) => ({ id: x.id, w: round(x.w * (k === ']' ? 1.15 : 1 / 1.15), 3) })), coalesce: 'size-many' });
            else if (a) cmd('layer.update', { id: a.id, w: round(a.w * (k === ']' ? 1.15 : 1 / 1.15), 3), coalesce: `size-${a.id}` });
            else { ui.assetCells = clamp(ui.assetCells + (k === ']' ? 0.25 : -0.25), 0.25, 8); updateAssetGhost(); }
          } else if (ui.tool === 'fx') { ui.paintIn = clamp(ui.paintIn + (k === ']' ? 0.5 : -0.5), 0.5, 8); }
          else ui.brushIn = clamp(ui.brushIn + (k === ']' ? 0.5 : -0.5), 0.5, 8);
          refreshPop(); updateBrushCursor();
          break;
        case 'h': toggleSelHidden(); break;
        case 'delete': case 'backspace':
          if (Walls.key(k)) break;
          if (ui.areaPts && ui.areaPts.length) { ui.areaPts.length -= 2; view.setAreaDraft(ui.areaPts.length ? ui.areaPts.slice() : null); if (!ui.areaPts.length) ui.areaPts = null; break; }
          if (ui.selected) undoable('layer.remove', { id: ui.selected });
          else if (ui.selMark) Tools.removeSelected();
          else if (ui.selAssets.length > 1) { undoable('layer.removeMany', { ids: ui.selAssets.slice() }); setAssetSelection([]); }
          else if (ui.selAsset) undoable('layer.remove', { id: ui.selAsset });
          else if (ui.selSpell) undoable('spell.remove', { id: ui.selSpell });
          else if (ui.selFx) undoable('fx.remove', { id: ui.selFx });
          break;
        default:
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  }

  // Away from the maps (the campaign page, the start screen) the GM's map stops drawing and its videos pause,
  // so the page stays smooth; back on the maps it plays on.
  let active = true;
  function setActive(on) {
    if (on === active) return;
    active = on;
    if (view) view.setPlaying(on);
  }

  return {
    helpSections, showToolHint, mount, update, setActive, setTool, openPop, closePop, Drawer, view: () => view, ui, state: () => S,
    offTable: () => [...offTable().entries()].map(([id, o]) => ({ id, ...o })), fitAll, aimMoment, Show, get TB() { return TB; }, get Floats() { return Floats; },
    simFps: (r) => { const n = typeof r === 'number' ? r : r.fps; ui.tableFps = n; ui.fpsSimAt = Date.now(); fpsWatch(n, r.hitches || 0, r.heavy || null); }, bigPreview, setPreviewWidth,
    openRadial, startAlign, finishAlign, alignGrid, castAt, cast, spellFromPointer, setSpell, pickSpell, oneInch, fitView, selectFx: (id) => selectFx(id),
    get Snaps() { return Snaps; }, get Hot() { return Hot; }, captureMap, hotRun, pinnable: (id) => !UNPINNED.has(id),
    hotActions: () => Object.keys(DO_HOT).map((k) => doHot(k)), // (for the self-test: every single action)
    holdBake: (on) => { bakeHeld = !!on; if (!on && S && S.map) maybeBakeFog(S.map); },
    tokPref: (k) => Tools.tokPref(k), setTokPref: (k, v) => Tools.setTokPref(k, v), // 4.10: Options → Tokens
  };
})();
