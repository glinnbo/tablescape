// Play tools on the GM screen:
//   Tokens  drop NPCs with a click: numbered copies, 5e sizes, hidden if you like
//   Point   ping, laser pointer, spotlight, ruler
//   Sketch  chalk (fades), pen (stays with the map), eraser (the tool is still called 'draw' inside)
//   Marks   pins, crosses, numbers (each can say something), labels, counters; on the table or only for the GM
//           (Third Builder, third-marks-tool: Text from Draw and the Map notes joined the Marker tool)
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
  const DRAW_MODES = ['chalk', 'pen', 'erase']; // (Third Builder (third-marks-tool): Text moved to Marks)

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
      mark: { mode: 'marker', shape: 'pin', color: '#e3963e', label: 'Counter', value: 3, auto: null, text: '', me: false, ink: '#ffffff' }, // (Third Builder (third-marks-tool): text, me = Only me, ink = a label's colour)
      timer: { mode: 'dramatic', seconds: 30, label: '', sound: true, side: 'right' },
    };
    try {
      const p = JSON.parse(localStorage.getItem('playPrefs') || 'null');
      if (p) for (const k of Object.keys(prefs)) if (p[k]) Object.assign(prefs[k], p[k]);
      // 2.2: notes have their own tool (Build → Notes); a new counter only moves on Next round when ticked
      if (prefs.mark.mode === 'note') prefs.mark.mode = 'marker';
      if (prefs.draw.mode === 'text') { prefs.draw.mode = 'chalk'; prefs.mark.mode = 'label'; } // (Third Builder (third-marks-tool): Text is a kind of mark now)
      if (localStorage.getItem('markAuto22') !== '1') { prefs.mark.auto = null; localStorage.setItem('markAuto22', '1'); }
      // Prototype 30: new tokens come without a name tag (a choice remembered from Beta 4.7 kept showing names); Options → Tokens → New tokens still sets it
      if (localStorage.getItem('tokTagOff30') !== '1') { prefs.tok.tag = 'off'; localStorage.setItem('tokTagOff30', '1'); }
    } catch {}
    Object.assign(ui, prefs, { selMark: null });
    // 4.10: Options → Tokens
    const tokSet = () => { const st = S(); return (st && st.settings && st.settings.tokens) || { pic: Geom.PIC_DEFAULT, snap: true }; };
    const snapOn = () => tokSet().snap !== false;
    const save = () => { try { localStorage.setItem('playPrefs', JSON.stringify(Object.fromEntries(Object.keys(prefs).map((k) => [k, ui[k]])))); } catch {} };

    // Beta 3.11: on a world or regional map (the atlas) the Mark tool also sets places and draws routes
    const onAtlas = () => { const st = S(); return !!(st && st.atlas && st.atlas.maps.some((x) => x.id === st.editMapId)); };
    const markMode = () => (ui.mark.mode === 'counter' ? 'counter' : ui.mark.mode === 'label' ? 'label' : onAtlas() && (ui.mark.mode === 'place' || ui.mark.mode === 'route') ? ui.mark.mode : 'marker');
    let routeId = null; // the route being drawn: every click adds a point
    const routeNow = () => (routeId && map() ? map().marks.find((m) => m.id === routeId && m.kind === 'route') || null : null);
    function routeEnd() { if (!routeId) return false; const id = routeId; routeId = null; if (map() && map().marks.some((m) => m.id === id)) selectMark(id); ctx.refreshPop(); return true; } // (picked once it is done: its card would lie in the way of the next click)
    async function routeClick(pt, e) {
      if (e.detail >= 2) { routeEnd(); return; } // (a double click ends it)
      const at = e.altKey ? pt : Geom.snap(grid(), pt.x, pt.y, 1);
      const r = routeNow();
      if (r) { cmd('mark.route', { id: r.id, x: at.x, y: at.y, coalesce: `route-${r.id}` }); return; }
      const res = await cmd('mark.add', { kind: 'route', x: at.x, y: at.y, color: ui.mark.color });
      if (res && res.selected) { routeId = res.selected; if (ui.selMark) selectMark(null); ctx.refreshPop(); }
    }
    const markOf = (id) => (map() && id ? map().marks.find((m) => m.id === id) || map().draw.find((d) => d.id === id && d.kind === 'text') || null : null);
    const isText = (m) => m && m.kind === 'text';
    function selectMark(id) {
      ui.selMark = id;
      view().setSelectedMark(id);
      ctx.placeCard();
    }
    // Third Builder (third-marks-tool): one Marks tool. What the next click places (a kind) and who sees it (On the table / Only me)
    const KINDS = [
      { id: 'pin', label: 'Pin', icon: 'map-pin', tip: 'A pin; it can say something' },
      { id: 'x', label: 'Cross', icon: 'x', tip: 'A cross; it can say something' },
      { id: 'dot', label: 'Number', icon: 'circle-number-1', tip: 'Numbered: 1, 2, 3 …; it can say something' },
      { id: 'label', label: 'Label', icon: 'typography', tip: 'Words on the map' },
      { id: 'counter', label: 'Counter', icon: 'plus-minus', tip: 'A number that counts, e.g. rounds until the ritual completes' }];
    const ATLAS_KINDS = [
      { id: 'place', label: 'Place', icon: 'flag', tip: 'A named place: it can lead to a regional map, and bring a note or a handout' },
      { id: 'route', label: 'Route', icon: 'route', tip: 'A path from click to click; its length shows in its label' }];
    const markKind = () => { const m = markMode(); return m === 'marker' ? (['pin', 'x', 'dot'].includes(ui.mark.shape) ? ui.mark.shape : 'pin') : m; };
    function setMarkKind(v) {
      if (v !== 'route') routeEnd();
      if (['pin', 'x', 'dot'].includes(v)) { ui.mark.mode = 'marker'; ui.mark.shape = v; } else ui.mark.mode = v;
      save(); ctx.refreshPop();
    }
    function noteMode() { routeEnd(); ui.mark.mode = 'label'; ui.mark.me = true; save(); } // (J: a note only you see)
    // old names still on a hotbar or the rail: Draw → Text and Map notes open Marks
    const normTool = (t, mode) => (t === 'draw' && mode === 'text' ? ['mark', 'label'] : t === 'notes' ? ['mark', 'label'] : [t, mode]);
    const isMe = (m) => m.kind === 'note' || !!m.hidden;
    // who sees it: hidden for the others; a label for Only me becomes a note, and a note on the table a label (mapstate)
    async function setWho(m, me) {
      const r = await cmd(isText(m) ? 'draw.update' : 'mark.update', { id: m.id, hidden: me, ...(isText(m) ? { asNote: me } : m.kind === 'note' ? { asLabel: !me } : {}) });
      if (r && r.selected && ui.selMark === m.id) selectMark(r.selected);
    }
    const markName = (m) => (isText(m) || m.kind === 'note' ? m.text : m.kind === 'counter' ? `${m.label}: ${m.value}` : m.kind === 'dot' ? (m.text ? `${m.n} · ${m.text}` : `Number ${m.n}`)
      : m.kind === 'place' ? m.title : m.kind === 'route' ? (m.title || 'Route') : (m.text || (m.kind === 'x' ? 'Cross' : 'Pin')));
    const markIcon = (m) => (isText(m) ? 'typography' : { pin: 'map-pin', x: 'x', dot: 'circle-number-1', counter: 'plus-minus', note: 'note', place: 'flag', route: 'route' }[m.kind] || 'map-pin');
    const allMarks = () => (map() ? [...map().marks.filter((m) => onAtlas() || (m.kind !== 'place' && m.kind !== 'route')), ...map().draw.filter((d) => d.kind === 'text')] : []);
    let markTextEl = null; // the Text box of the Marks panel (emptied once its words are on the map)
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
    // (Beta 3.61) four groups stand at the panel's side: Ready (this chapter's), Party, Recent, Starred. A banner shows
    // the token in hand, the group's tokens lie in one tray; every token with its folders is in All tokens (the List)
    const TOK_GROUPS = [
      { value: 'ready', label: 'Ready', icon: 'checklist', tip: 'The tokens you ticked for this chapter' },
      { value: 'party', label: 'Party', icon: 'users', tip: 'The party\'s own tokens, from their cards' },
      { value: 'recent', label: 'Recent', icon: 'clock', tip: 'The tokens you picked last' },
      { value: 'starred', label: 'Starred', icon: 'star', tip: 'Your favourites: the star in All tokens' }];
    function tokenGroup(id) {
      if (id === 'party') return (S().chars || []).filter((c) => c.here && c.token).map((c) => ({ path: c.token.path, name: c.name, kind: 'image', url: c.token.url }));
      if (id === 'ready') return ctx.ready.chapter() ? ctx.ready.list('tokens') : [];
      if (id === 'starred') return libTokens.filter((t) => t.fav);
      const mine = ui.tok.recent || []; const has = new Set(mine.map((b) => b.path));
      return [...mine, ...libTokens.filter((t) => t.recent >= 0 && !has.has(t.path)).sort((x, y) => x.recent - y.recent)].slice(0, 15);
    }
    let tokSides = null;
    function buildTokenPop(o = {}) {
      loadLibTokens();
      // (opened afresh: the first group that has tokens, so the tray is never empty where another one has some)
      if (!TOK_GROUPS.some((g) => g.value === ui.tok.group)) ui.tok.group = 'ready';
      if (!o.again && !tokenGroup(ui.tok.group).length) ui.tok.group = (TOK_GROUPS.find((g) => tokenGroup(g.value).length) || { value: ui.tok.group }).value;
      tokSides = { els: [c().sideTabs(TOK_GROUPS, () => ui.tok.group, (v) => { ui.tok.group = v; ctx.refreshPop(); }, { groups: true, cls: 'pop-groups tok-groups', again: o.again, label: 'Tokens' })] };
      const strip = h('div', { class: 'tok-strip' });
      c().bind(() => {
        const g = ui.tok.group; const ready = g === 'ready'; const ch = ctx.ready.chapter();
        const list = tokenGroup(g);
        const sig = JSON.stringify([g, ch && ch.name, list.map((x) => [x.path, !!x.missing]), ui.tok.brush && ui.tok.brush.path]);
        if (strip.dataset.sig === sig) return;
        strip.dataset.sig = sig;
        strip.innerHTML = '';
        const title = ready ? (ch ? `Ready · ${ch.name}` : 'Ready') : g === 'party' ? 'The party' : g === 'recent' ? 'Recent' : 'Favourites';
        strip.append(h('div', { class: 'tok-group' }, h('span', { class: 'grow ellipsis' }, title),
          ready && list.length ? h('button', { class: 'tg-clear', 'data-tip': 'Empty this chapter\'s Ready list', onclick: () => ctx.ready.clear('tokens') }, 'Clear') : null));
        const row = h('div', { class: `tok-row ${ready ? 'ready-row' : ''}` });
        for (const it of list.slice(0, 48)) {
          row.append(h('button', {
            class: `tok-pick ${ui.tok.brush && ui.tok.brush.path === it.path ? 'on' : ''} ${it.missing ? 'missing' : ''}`, 'data-tip': it.missing ? `${it.name}: no longer in the library (✕ takes it off)` : it.name, 'aria-label': it.name,
            onclick: () => (it.missing ? toast(`${it.name} is no longer in the library: ✕ takes it off the Ready list`, { ms: 3500 }) : setTokenBrush(it)),
          }, it.missing ? h('span', { class: 'miss-thumb' }, iconEl('alert-triangle')) : Thumbs.img(it.path, it.kind, it.thumb), h('span', {}, it.name),
          ready ? h('span', { class: 'ready-x', role: 'button', 'aria-label': `Take ${it.name} off the Ready list`, 'data-tip': 'Take it off the Ready list', onclick: (e) => { e.stopPropagation(); ctx.ready.remove('tokens', it.path); } }, iconEl('x')) : null));
        }
        if (!list.length) row.append(h('p', { class: `hint tok-empty ${ready ? 'ready-empty' : ''}` }, ready ? 'Nothing ready yet: tick tokens in All tokens' : g === 'party' ? 'No party tokens yet: they come from the character cards' : g === 'recent' ? 'No token picked yet: All tokens has every one' : 'No favourites yet: the star in All tokens'));
        if (ready && ch) ctx.ready.drop(row, 'tokens');
        strip.append(row);
      });
      const listBtn = c().btn('All tokens', 'layout-grid', () => ctx.togglePanel(tokListDef()), { kind: 'small tok-all', tip: 'Every token, by folder: click one to pick it up, tick it to have it ready here' });
      c().bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen('toklist')));
      // the banner: what the next click on the map places
      const cap = h('div', { class: 'cap' });
      const ban = h('div', { class: 'os-prev pop-ban tok-ban' });
      c().bind(() => {
        const b = ui.tok.brush; const size = (SIZES.find((x) => x.id === ui.tok.size) || SIZES[2]).label;
        const text = b ? ['a click', size, ui.tok.hidden ? 'hidden' : null].filter(Boolean).join(' · ') : 'pick one below, or in All tokens';
        const sig = JSON.stringify([b && b.path, text]);
        if (ban.dataset.sig === sig) return;
        ban.dataset.sig = sig; ban.dataset.path = b ? b.path : '';
        cap.replaceChildren(h('b', { class: 'ellipsis' }, b ? b.name : 'No token in hand'), text);
        ban.replaceChildren(b ? Thumbs.img(b.path, b.kind) : h('span', { class: 'pop-ban-none' }, iconEl('user')), cap);
      });
      const count = h('span', { class: 'grow hint' });
      c().bind(() => { const n = map() ? map().layers.filter((l) => l.role === 'token').length : 0; count.textContent = n ? `${n} token${n === 1 ? '' : 's'} on this map` : 'No tokens on this map yet'; });
      return h('div', { class: 'stack tok-pop' },
        ban, strip,
        c().seg({ label: 'Size', cls: 'seg-sizes named', options: SIZES.map((x) => ({ value: x.id, label: x.id === 'garg' ? 'Garg.' : x.label, tip: `${x.label}: ${x.cells === 0.5 ? 'half a square' : `${x.cells} × ${x.cells} squares`}` })),
          get: () => ui.tok.size, set: (v) => { ui.tok.size = v; save(); ctx.refreshPop(); updateGhost(); } }),
        c().popFold('tokMore', 'More',
          c().toggle({ label: 'Place hidden (players don\'t see it yet)', get: () => ui.tok.hidden, set: (v) => { ui.tok.hidden = v; save(); ctx.refreshPop(); updateGhost(); } }),
          allTags()),
        c().popFoot(count, listBtn));
    }
    // all tokens on this map at once: no name tags, mine only, or for the players too (one undo step)
    function allTags() {
      const set = (t) => {
        const list = map() ? map().layers.filter((l) => l.role === 'token') : [];
        if (!list.length) { toast('No tokens on this map yet.'); return; }
        cmd('layer.many', { patches: list.map((l) => ({ id: l.id, tag: t })), stepLabel: 'Name tags' });
        toast(t === 'off' ? 'Name tags off on this map' : t === 'gm' ? 'Name tags on your screen' : 'Name tags on the table too', { ms: 1800 });
      };
      return h('div', { class: 'ctl', 'data-tip': 'For all tokens on this map at once' }, h('span', { class: 'ctl-label' }, 'Name tags'), // Third Builder (third-small-labels): D2, say what Off turns off
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
      const fresh = !spotLast;
      spotLast = { mapId: S().editMapId, kind: 'spot', x: pt.x, y: pt.y, r: ui.point.spotR, dim: ui.point.spotDim };
      ts.ping(spotLast);
      if (fresh && ctx.renderCtl) ctx.renderCtl(); // (Beta 3.15: its row under the preview)
      if (!spotTimer) spotTimer = setInterval(() => { if (spotLast) ts.ping(spotLast); }, 1000); // keep it alive while the pointer rests
    }
    function spotOff() {
      if (!spotLast) return;
      ts.ping({ mapId: spotLast.mapId, kind: 'spot', off: true });
      spotLast = null;
      clearInterval(spotTimer); spotTimer = 0;
      if (ctx.renderCtl) ctx.renderCtl();
    }
    function measureMsg(a, b, free, done) {
      const m = Geom.measure(grid(), a, b, ui.point.rule, free);
      // (Beta 3.11: a map whose grid cells stand for something, "1 day of travel", measures in that)
      const label = grid().unit ? Geom.unitLabel(grid(), Math.round(m.cells * 10) / 10) : `${ui.point.rule === 'real' && !Geom.isHex(grid()) ? '≈ ' : ''}${m.ft} ft`;
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
    function buildDrawPop() { // (Third Builder (third-marks-tool): Sketch: Chalk, Pen, Erase; labels are in Marks)
      const extra = h('div', { class: 'stack' });
      c().bind(() => {
        if (extra.dataset.mode === ui.draw.mode) return;
        extra.dataset.mode = ui.draw.mode;
        extra.innerHTML = '';
        const m = ui.draw.mode;
        if (m === 'chalk' || m === 'pen') {
          extra.append(c().seg({ label: 'Line', options: WIDTHS.map((w) => ({ value: w.id, label: w.label })), get: () => ui.draw.width, set: (v) => { ui.draw.width = v; save(); } }));
        }
      });
      const count = h('span', { class: 'grow hint' });
      c().bind(() => { const n = map().draw.filter((d) => d.kind === 'pen').length; count.textContent = n ? `${n} line${n === 1 ? '' : 's'} on this map` : 'No lines on this map'; });
      return h('div', { class: 'stack' },
        c().tiles([
          { id: 'chalk', label: 'Chalk', icon: 'scribble', tip: 'Fades after a few seconds' },
          { id: 'pen', label: 'Pen', icon: 'ballpen', tip: 'Stays on the map' },
          { id: 'erase', label: 'Erase', icon: 'eraser', tip: 'Erase pen lines' }], () => ui.draw.mode, (v) => { ui.draw.mode = v; save(); ctx.refreshPop(); ctx.updateCursor(); }),
        swatchRow(() => ui.draw.color, (v) => { ui.draw.color = v; save(); ctx.refreshPop(); }),
        extra,
        c().sep(),
        c().row(count, c().btn('Clear', 'trash', () => undoable('draw.clear', { kinds: ['pen'] }), { kind: 'danger', tip: 'Remove every pen line from this map' })));
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
    // pen lines the eraser touched on its way from a to b, in map inches (Third Builder (third-marks-tool): labels are no longer erased here)
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
      return hits;
    }
    async function editText(d) {
      const text = await askText('Change the label', d.text, { ok: 'Save' });
      if (text == null) return;
      if (!text.trim()) undoable('draw.remove', { id: d.id }, 'Label removed');
      else cmd('draw.update', { id: d.id, text: text.trim() });
    }

    // =====================================================================
    // Marks (Toolbox, X; J: a note only you see). Third Builder (third-marks-tool): pins, crosses, numbers, labels, counters
    // (and places and routes on a world map) in one tool, one list, one Clear
    // =====================================================================
    function buildMarkPop() {
      const kinds = h('div', {});
      c().bind(() => {
        const atlas = onAtlas();
        if (kinds.dataset.atlas === String(atlas)) return;
        kinds.dataset.atlas = String(atlas);
        const t = c().tiles(atlas ? [...KINDS, ...ATLAS_KINDS] : KINDS, markKind, setMarkKind);
        t.classList.add('mk-kinds');
        kinds.replaceChildren(t);
      });
      const extra = h('div', { class: 'stack' });
      c().bind(() => {
        const k = markKind();
        const sig = `${k}|${ui.mark.auto}|${routeNow() ? 1 : 0}`;
        if (extra.dataset.sig === sig) return;
        extra.dataset.sig = sig;
        extra.innerHTML = '';
        markTextEl = null;
        if (k === 'pin' || k === 'x' || k === 'dot' || k === 'label') {
          markTextEl = h('input', { type: 'text', value: ui.mark.text || '', maxlength: k === 'label' ? '200' : '80', 'aria-label': 'Text',
            placeholder: k === 'label' ? 'The old well (or type it after the click)' : 'Old well, Trap … (or nothing)', oninput: (e) => { ui.mark.text = e.target.value; save(); } });
          extra.append(h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Text'), markTextEl));
        }
        if (k === 'label') extra.append(c().seg({ label: 'Text size', options: TEXT_SIZES.map((w) => ({ value: w.id, label: w.label })), get: () => ui.draw.textSize, set: (v) => { ui.draw.textSize = v; save(); } }));
        if (k === 'counter') {
          const name = h('input', { type: 'text', value: ui.mark.label, placeholder: 'Ritual, Reinforcements, Torches …', 'aria-label': 'Counter name', oninput: (e) => { ui.mark.label = e.target.value; save(); } });
          extra.append(...[
            h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Name'), name),
            c().stepper({ name: 'Start', label: 'Starts at', get: () => ui.mark.value, prev: (v) => v - 1, next: (v) => v + 1, set: (v) => { ui.mark.value = v; save(); ctx.refreshPop(); }, fmt: (v) => String(v) }),
            c().toggle({ label: 'Moves on Next round', get: () => !!ui.mark.auto, set: (v) => { ui.mark.auto = v ? 'down' : null; save(); ctx.refreshPop(); } }),
            ui.mark.auto ? c().seg({ options: [{ value: 'down', label: 'Count down', icon: 'trending-down' }, { value: 'up', label: 'Count up', icon: 'trending-up' }],
              get: () => ui.mark.auto, set: (v) => { ui.mark.auto = v; save(); ctx.refreshPop(); } }) : null].filter(Boolean)); // (append would write "null")
        }
        if (k === 'route') {
          extra.append(c().row(c().btn('Finish the route', 'check', () => routeEnd(), { kind: routeNow() ? 'primary' : 'ghost', tip: 'Also: double click, or Esc' }),
            c().btn('One point back', 'arrow-back-up', () => { const r = routeNow(); if (r) cmd('mark.route', { id: r.id, back: true }); }, { kind: 'ghost' })));
        }
        extra.append(k === 'label' ? swatchRow(() => ui.mark.ink || '#ffffff', (v) => { ui.mark.ink = v; save(); ctx.refreshPop(); })
          : swatchRow(() => ui.mark.color, (v) => { ui.mark.color = v; save(); ctx.refreshPop(); }));
      });
      const who = c().seg({ cls: 'mk-who', options: [
        { value: 'table', label: 'On the table', icon: 'device-tv', tip: 'The players see the next mark' },
        { value: 'me', label: 'Only me', icon: 'eye-off', tip: 'Only on your screen, never on the TV (J)' }],
      get: () => (ui.mark.me ? 'me' : 'table'), set: (v) => { ui.mark.me = v === 'me'; save(); ctx.refreshPop(); } });
      const list = h('div', { class: 'mk-list' });
      c().bind(() => {
        const items = allMarks();
        const sig = JSON.stringify([items.map((m) => [m.id, markName(m), isMe(m), m.color]), ui.selMark]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        if (!items.length) { list.append(c().hint('Nothing marked on this map yet.')); return; }
        for (const m of items) {
          const me = isMe(m);
          list.append(h('div', { class: `mk-row ${me ? 'me' : ''} ${ui.selMark === m.id ? 'on' : ''}`, dataset: { flash: m.id, id: m.id } },
            h('span', { class: 'mk-ico', style: `color:${m.kind === 'note' ? '#e2b44f' : m.color || '#ffffff'}` }, iconEl(markIcon(m))),
            h('button', { class: 'mk-text', 'data-tip': 'Show it on the map', onclick: () => { selectMark(m.id); if (ctx.showPoint) ctx.showPoint(m.x, m.y); } }, markName(m)),
            c().ib(me ? 'eye-off' : 'eye', me ? 'Only you see it. Click: on the table' : 'On the table. Click: only you', () => setWho(m, !me), { on: me }),
            c().ib('trash', 'Remove', () => { undoable(isText(m) ? 'draw.remove' : 'mark.remove', { id: m.id }); if (ui.selMark === m.id) selectMark(null); }, { danger: true })));
        }
      });
      const count = h('span', { class: 'grow hint' });
      c().bind(() => {
        const all = allMarks(); const me = all.filter(isMe).length;
        count.textContent = all.length ? `${all.length} mark${all.length === 1 ? '' : 's'}${me ? ` · ${me} only for you` : ''}` : 'No marks on this map';
      });
      return h('div', { class: 'stack' },
        kinds,
        extra,
        who,
        c().sep(),
        h('span', { class: 'ctl-label' }, 'On this map'),
        list,
        c().row(count, c().btn('Clear', 'trash', () => { undoable('mark.clear', { kinds: ['pin', 'x', 'dot', 'counter', 'note'], labels: true }, 'Marks cleared'); selectMark(null); },
          { kind: 'danger', tip: 'Remove every mark and label from this map (Ctrl + Z brings them back)' })));
    }
    async function placeMark(pt, mode = markMode()) {
      const m = ui.mark;
      const hidden = !!m.me;
      const said = String(m.text || '').trim();
      const used = () => { if (!said) return; m.text = ''; save(); if (markTextEl) markTextEl.value = ''; }; // (the words went on the map; the next mark starts empty)
      let p = null;
      if (mode === 'note') { // (an old hotbar item or key)
        const text = await askText('Note (only you see it)', '', { ok: 'Pin note', placeholder: 'Silver key opens this door' });
        if (!text) return;
        p = { kind: 'note', text, color: '#e2b44f' };
      } else if (mode === 'label') {
        const text = said || await askText(hidden ? 'Note (only you see it)' : 'Write on the map', '', { ok: hidden ? 'Pin note' : 'Place label', placeholder: hidden ? 'Silver key opens this door' : 'The old well' });
        if (!text) return;
        used();
        const r = hidden ? await cmd('mark.add', { kind: 'note', text, x: pt.x, y: pt.y, color: '#e2b44f', size: textIn(), ink: m.ink || '#ffffff' })
          : await cmd('draw.add', { x: pt.x, y: pt.y, text, color: m.ink || '#ffffff', size: textIn() });
        if (r && r.selected) selectMark(r.selected);
        return;
      } else if (mode === 'counter') p = { kind: 'counter', label: (m.label || 'Counter').trim() || 'Counter', value: m.value, auto: m.auto || null, color: m.color, hidden };
      else if (mode === 'place') {
        const title = await askText('Name the place', '', { ok: 'Place it', placeholder: 'Kintsugi' });
        if (!title) return;
        p = { kind: 'place', title, color: m.color, hidden };
      } else { p = { kind: ['pin', 'x', 'dot'].includes(m.shape) ? m.shape : 'pin', color: m.color, text: said || undefined, hidden }; used(); }
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
        const m = ui.draw.mode; // (Third Builder (third-marks-tool): labels are picked and moved in Marks now)
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
        const d = { kind: 'erase', key: `erase-${Date.now()}`, gone: new Set(), last: pt };
        eraseAt(d, pt, e);
        return d;
      }
      if (t === 'mark' || t === 'notes') {
        const textEl = e.target.closest('.sv-text'); // (Third Builder (third-marks-tool): a label is a mark now)
        if (textEl) {
          const d = markOf(textEl.dataset.id);
          if (!d) return null;
          selectMark(d.id);
          return { kind: 'textmove', id: d.id, dx: d.x - pt.x, dy: d.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `tx-${d.id}-${Date.now()}`, edit: false };
        }
        const el = e.target.closest(t === 'notes' ? '.sv-note' : '.sv-mark, .sv-note');
        if (el) {
          const m = markOf(el.dataset.id);
          if (!m) return null;
          selectMark(m.id);
          return { kind: 'markmove', id: m.id, dx: m.x - pt.x, dy: m.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `mk-${m.id}-${Date.now()}` };
        }
        if (t === 'mark' && markMode() === 'route') { routeClick(pt, e); return null; } // (Beta 3.11)
        placeMark(pt, t === 'notes' ? 'note' : markMode()); // (Esc deselects; a click on the map always places the next one)
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
      if (t !== 'mark' && t !== 'notes' && ui.selMark) { ui.selMark = null; view().setSelectedMark(null); } // (Third Builder (third-marks-tool): labels belong to Marks)
      if (t !== 'mark') routeId = null;
      document.body.dataset.pointMode = ui.point.mode;
      document.body.dataset.drawMode = ui.draw.mode;
      updateGhost();
    }
    // P and D pressed again step through their modes
    function setMode(t, v) {
      if (t === 'point') { setPointMode(v); return; }
      if (t === 'mark') { // (Third Builder (third-marks-tool): also a kind: pin, x, dot, label)
        if (v !== 'route') routeId = null;
        if (['pin', 'x', 'dot'].includes(v)) { ui.mark.mode = 'marker'; ui.mark.shape = v; } else ui.mark.mode = ['counter', 'place', 'route', 'label'].includes(v) ? v : 'marker';
        save(); ctx.refreshPop(); return;
      }
      if (t === 'draw') { if (!DRAW_MODES.includes(v)) return; ui.draw.mode = v; save(); document.body.dataset.drawMode = v; ctx.refreshPop(); if (ctx.updateCursor) ctx.updateCursor(); }
    }
    function cycle(t) {
      if (t === 'point') { setPointMode(POINT_MODES[(POINT_MODES.indexOf(ui.point.mode) + 1) % POINT_MODES.length]); return { ping: 'Ping', laser: 'Laser pointer', spot: 'Spotlight', measure: 'Ruler' }[ui.point.mode]; }
      if (t === 'draw') { ui.draw.mode = DRAW_MODES[(DRAW_MODES.indexOf(ui.draw.mode) + 1) % DRAW_MODES.length]; save(); document.body.dataset.drawMode = ui.draw.mode; ctx.refreshPop(); return { chalk: 'Chalk', pen: 'Pen', erase: 'Eraser' }[ui.draw.mode]; }
      return null;
    }

    // =====================================================================
    // Card for a selected marker, counter, note or label
    // =====================================================================
    function cardTarget() {
      const m = markOf(ui.selMark);
      if (!m) return null;
      if (!(ui.tool === 'mark' || (ui.tool === 'notes' && m.kind === 'note'))) return null; // (Third Builder (third-marks-tool): labels too)
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
      const hide = ib(isMe(m) ? 'eye-off' : 'eye', isMe(m) ? 'Only you see it. Click: on the table' : 'On the table. Click: only you', () => setWho(m, !isMe(m)), { on: isMe(m), key: 'H' }); // (Third Builder (third-marks-tool))
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
          ib('pencil', 'Edit the note', async () => { const text = await askText('Note (only you see it)', m.text, { ok: 'Save' }); if (text != null) upd({ text }); }), cardSep(), hide, del]; // (Third Builder (third-marks-tool): the eye puts it on the table as a label)
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
      if (m.kind === 'place') { // (Beta 3.11) a place on a world or regional map
        const st = S(); const A = (st && st.atlas) || { maps: [] };
        const dest = m.to ? A.maps.find((x) => x.id === m.to) : null;
        const others = A.maps.filter((x) => x.id !== st.editMapId);
        const onTv = A.on === st.editMapId;
        const leadMenu = (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 6, [
          ...others.map((x) => ({ icon: x.id === m.to ? 'check' : 'map-2', checked: x.id === m.to, label: x.name, action: () => upd({ to: x.id }) })),
          ...(others.length ? [] : [{ icon: 'info-circle', label: 'No other map in the atlas yet', disabled: true }]),
          ...(m.to ? [{ sep: true }, { icon: 'x', label: 'Leads nowhere', action: () => upd({ to: null }) }] : [])]); };
        const hoMenu = async (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          let list = []; try { list = (await ts.library('list')).filter((x) => x.cat === 'handouts'); } catch {}
          openMenu(r.left, r.bottom + 6, [
            ...list.slice(0, 60).map((x) => ({ icon: m.ho && m.ho.path === x.path ? 'check' : 'script', checked: !!(m.ho && m.ho.path === x.path), label: x.name, action: () => upd({ ho: { path: x.path, name: x.name } }) })),
            ...(list.length ? [] : [{ icon: 'info-circle', label: 'No handouts in the library yet', disabled: true }]),
            ...(m.ho ? [{ sep: true }, { icon: 'x', label: 'No handout', action: () => upd({ ho: null }) }] : [])]);
        };
        const out = [h('span', { class: 'card-title ellipsis' }, iconEl('flag'), m.title),
          ib('pencil', 'Rename', async () => { const n = await askText('Name the place', m.title, { ok: 'Save' }); if (n) upd({ title: n }); }),
          ib('typography', m.sub ? `Line under the name: ${m.sub}` : 'A line under the name', async () => { const n = await askText('The line under the name (empty: none)', m.sub || '', { ok: 'Save', placeholder: 'Capital of the Ashen Coasts', allowEmpty: true }); if (n != null) upd({ sub: n }); }, { on: !!m.sub }),
          col, cardSep(),
          ib('map-2', dest ? `Leads to ${dest.name}. Click to change` : 'Lead to a regional map', leadMenu, { on: !!dest }),
          ib('note', m.note ? 'Its note. Click to change' : 'Give it a note', async () => { const n = await askText('The note the table can read (empty: none)', m.note || '', { ok: 'Save', allowEmpty: true }); if (n != null) upd({ note: n }); }, { on: !!m.note }),
          ib('script', m.ho ? `Its handout: ${m.ho.name}. Click to change` : 'Give it a handout', hoMenu, { on: !!m.ho })];
        const acts = [];
        if (dest) acts.push(c().btn(`Open ${dest.name}`, 'door-enter', () => cmd('atlas.show', { id: dest.id }), { kind: 'small primary', tip: 'The TV flies into this map' }));
        if (m.note) acts.push(ib('message', onTv ? (A.note === m.id ? 'Its note is on the TV. Click to put it away' : 'Show its note on the TV') : 'Its note shows once this map is on the TV', () => cmd('atlas.note', { id: m.id }), { on: A.note === m.id }));
        if (m.ho) acts.push(ib('cast', 'Show its handout on the table', () => cmd('handout.show', { path: m.ho.path, add: true })));
        if (acts.length) out.push(cardSep(), ...acts);
        out.push(cardSep(), hide, del);
        return out;
      }
      if (m.kind === 'route') {
        return [h('span', { class: 'card-title ellipsis' }, iconEl('route'), m.title || Geom.routeLabel(grid(), m) || 'Route'),
          ib('pencil', 'Name it', async () => { const n = await askText('Name the route (empty: none)', m.title || '', { ok: 'Save', placeholder: 'The pilgrim road', allowEmpty: true }); if (n != null) upd({ title: n }); }),
          ib('route', 'Draw on: every click adds a point', () => { routeId = m.id; ui.mark.mode = 'route'; save(); ctx.refreshPop(); }, { on: routeId === m.id }),
          ib('arrow-back-up', 'One point back', () => cmd('mark.route', { id: m.id, back: true })),
          col, cardSep(), hide, del];
      }
      const name = markName(m); // (Third Builder (third-marks-tool): what it says, if anything)
      const out = [h('span', { class: 'card-title ellipsis' }, iconEl(m.kind === 'x' ? 'x' : m.kind === 'dot' ? 'circle-number-1' : 'map-pin'), name),
        ib('pencil', m.text ? 'Change what it says' : 'Make it say something', async () => { const n = await askText('What it says (empty: nothing)', m.text || '', { ok: 'Save', placeholder: 'Old well, Trap …', allowEmpty: true }); if (n != null) upd({ text: n }); })];
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
        { icon: isMe(m) ? 'eye' : 'eye-off', label: isMe(m) ? 'On the table' : 'Only me', run: () => setWho(m, !isMe(m)) }, // (Third Builder (third-marks-tool))
        { icon: 'trash', label: 'Remove', danger: true, run: () => { undoable(isText(m) ? 'draw.remove' : 'mark.remove', { id: m.id }); selectMark(null); } },
        { icon: 'target', label: 'Ping', run: () => ts.ping({ mapId: S().editMapId, x: m.x, y: m.y }) },
      ];
      if (m.kind === 'counter') items.unshift({ icon: 'plus', label: '+1', run: () => counterStep(m.id, 1) }, { icon: 'minus', label: '−1', run: () => counterStep(m.id, -1) });
      if (isText(m)) items.unshift({ icon: 'pencil', label: 'Edit', run: () => editText(m) });
      if (m.kind === 'note') items.unshift({ icon: 'pencil', label: 'Edit', run: async () => { const text = await askText('Note (only you see it)', m.text, { ok: 'Save' }); if (text != null) upd({ text }); } });
      if (m.kind === 'pin' || m.kind === 'x' || m.kind === 'dot') items.unshift({ icon: 'pencil', label: 'Text', run: async () => { const n = await askText('What it says (empty: nothing)', m.text || '', { ok: 'Save', allowEmpty: true }); if (n != null) upd({ text: n }); } }); // (Third Builder (third-marks-tool))
      if (m.kind === 'place' && m.to) items.unshift({ icon: 'door-enter', label: 'Open', run: () => cmd('atlas.show', { id: m.to }) });
      ctx.Radial.open(x, y, items, isText(m) ? 'Label' : m.kind === 'counter' ? m.label : m.kind === 'note' ? 'Note' : m.kind === 'place' ? m.title : m.kind === 'route' ? 'Route' : 'Marker');
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
      setWho(m, !isMe(m)); // (Third Builder (third-marks-tool): a label goes to Only me as a note, a note to the table as a label)
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
    // Beta 3.15: every row has a colour (red: combat; green: what lies on the TV: a world map, handouts, a conversation;
    // pale orange: the rest), they are sorted by it, and a row that has just come is brighter for a moment. New rows:
    // the fight, a world map on the TV, several handouts, the spotlight, the join code, tokens shown to the table.
    let hudKeys = new Set();
    function renderHud(box) {
      const s = S();
      const cb = s.combat;
      const t = s.timer;
      const I = s.init;
      const talk = s.talk;
      const fight = !!(I && I.running);
      const A = s.atlas; const world = A && A.on ? A.maps.find((x) => x.id === A.on) : null;
      const hos = s.handouts || [];
      const sh = s.show && s.show.phase === 'show' ? s.show : null;
      const join = s.players && s.players.join ? s.players : null;
      const unit = fight && I.cur >= 0 ? I.units[I.cur] : null;
      const sig = JSON.stringify([cb, t && [t.id, t.mode, !!t.endsAt], fight && [unit && unit.name, I.cur], talk && talk.cast.map((x) => x.name), hos.map((x) => x.path), s.brk && s.brk.id,
        world && [world.id, world.name, A.world], sh && sh.ids, !!spotLast, !!join]);
      if (box.dataset.sig !== sig) {
        box.dataset.sig = sig;
        box.innerHTML = '';
        const keys = new Set();
        const add = (key, colour, cls, ...kids) => { keys.add(key); box.append(h('div', { class: `hud-row ${cls} c-${colour}${hudKeys.has(key) ? '' : ' arrive'}` }, ...kids.filter(Boolean))); };
        const ib = (ic, label, tip, run) => h('button', { class: 'icon-btn', 'aria-label': label, 'data-tip': tip, onclick: run }, iconEl(ic));
        // ---- red: combat
        if (fight) {
          add('fight', 'red', 'hud-fight', iconEl('swords'),
            // (two short lines: the box is narrow, and whose turn it is must stay readable)
            h('span', { class: 'grow hud-fight-text', 'data-tip': `The fight${cb && cb.n != null ? `: round ${cb.n}` : ''}${unit ? `, ${unit.name}'s turn` : ''}` },
              h('small', {}, cb && cb.n != null ? `Round ${cb.n}` : 'Fight'), h('span', { class: 'ellipsis' }, unit ? unit.name : '')),
            ib('player-stop', 'End the fight', 'End the fight (it can be brought back)', () => cmd('init.end').then((r) => { if (r && r.ok) toast(r.label, { undo: () => cmd('init.restore') }); })),
            h('button', { class: 'btn primary small hud-next', 'data-tip': 'Next turn (Enter)', onclick: nextRound }, 'Next', iconEl('player-track-next')));
        }
        // 2.2: no "Count rounds" button here (Enter starts counting); while rounds are counted outside a fight, this row shows the round
        if (cb && !fight && cb.n != null) {
          add('round', 'red', 'hud-round',
            h('span', { class: 'grow hud-label', 'data-tip': cb.show ? `Round ${cb.n}, shown on the table` : `Round ${cb.n}, hidden from players` }, h('small', { class: 'hud-r' }, 'Round'), ' ', h('b', {}, String(cb.n)), cb.show ? null : iconEl('eye-off', 'hud-hid')),
            ib('drag-drop-2', 'Round on the table', 'Where and how big the round shows on the table', () => ctx.openPop('round')),
            ib('x', 'Stop counting', 'Stop counting rounds', () => cmd('round.set', { mapId: cb.mapId, n: null })),
            Hotbar.offer(h('button', { class: 'btn primary small hud-next', 'data-tip': 'Next round: counts spell areas and counters along', 'data-key': 'Enter', onclick: nextRound }, 'Next', iconEl('player-track-next')), ctx.doHot('next')));
        }
        // ---- green: what lies on the TV
        if (world) {
          // (a regional map is left the way the Map table's Zoom out leaves it: to the map whose place leads here, the world map first)
          const lead = A.maps.filter((x) => x.id !== world.id && (x.to || []).includes(world.id));
          const back = world.id === A.world ? null : (lead.find((x) => x.id === A.world) || lead[0] || A.maps.find((x) => x.id === A.world && x.id !== world.id) || null);
          add('atlas', 'green', 'hud-atlas', iconEl('world'), h('span', { class: 'grow ellipsis' }, world.name),
            back ? ib('zoom-out', 'Zoom out', `Zoom out to ${back.name}`, () => cmd('atlas.show', { id: back.id, via: 'out' })) : null,
            ib('x', 'Take it off the table', 'Take the world map off the table: the battlemap is there again', () => cmd('atlas.hide')));
        }
        if (hos.length > 1) {
          add('handouts', 'green', 'hud-handout', iconEl('script'), h('span', { class: 'grow ellipsis', 'data-tip': hos.map((x) => x.name).join(', ') }, `${hos.length} handouts`),
            ib('layout-board', 'Handout table', 'Open the Handout table', () => ctx.openPanel('handouts')),
            ib('x', 'Put them all away', 'Put all handouts away', () => cmd('handout.hide')));
        } else if (s.handout) {
          add('handouts', 'green', 'hud-handout', iconEl('script'), h('span', { class: 'grow ellipsis' }, s.handout.name),
            ib('x', 'Put it away', 'Put the handout away', () => cmd('handout.hide')));
        }
        if (talk) {
          add('talk', 'green', 'hud-talk', iconEl('messages'),
            h('span', { class: 'grow ellipsis' }, talk.cast.length ? talk.cast.map((x) => x.name).reverse().join(', ') : 'Conversation: nobody on stage yet'),
            ib('user-circle', 'Conversation', 'Choose portraits', () => ctx.openPop('talk')),
            ib('player-stop', 'End the conversation', 'End the conversation', () => cmd('talk.off')));
        }
        // ---- pale orange: the rest
        if (sh) {
          const live = s.map && s.map.id === sh.mapId ? s.map : null;
          const names = sh.ids.map((id) => { const l = live && live.layers.find((x) => x.id === id); return l ? `${l.name || 'Token'}${l.n ? ` ${l.n}` : ''}` : null; }).filter(Boolean);
          add('show', 'pale', 'hud-show', iconEl('users'), h('span', { class: 'grow ellipsis' }, `Shown: ${names.length ? names.join(', ') : `${sh.ids.length} token${sh.ids.length === 1 ? '' : 's'}`}`),
            ib('x', 'Put them back', 'Back to the map', () => cmd('show.end')));
        }
        if (spotLast) {
          add('spot', 'pale', 'hud-spot', iconEl('focus-2'), h('span', { class: 'grow ellipsis' }, 'Spotlight is on'),
            ib('x', 'Spotlight off', 'Take the spotlight off the table', () => spotOff()));
        }
        if (join) {
          add('join', 'pale', 'hud-join', iconEl('qrcode'), h('span', { class: 'grow ellipsis' }, 'Join code on the TV ', h('b', { class: 'hud-join-t' })),
            ib('x', 'Take the code off the table', 'Take the join code off the table', () => ts.players('join', { on: false })));
        }
        if (s.brk) {
          add('brk', 'pale', 'hud-break', iconEl('coffee'), h('span', {}, 'Break'), h('b', { class: 'hud-brk grow' }),
            ib('player-stop', 'End the break', 'End the break', () => cmd('break.end')));
        }
        if (t) {
          add('timer', 'pale', `hud-timer ${t.mode}`, iconEl(t.mode === 'dramatic' ? 'heartbeat' : 'clock'), h('b', { class: 'hud-time grow' }),
            ib(t.endsAt ? 'player-pause' : 'player-play', t.endsAt ? 'Pause' : 'Resume', t.endsAt ? 'Pause the countdown' : 'Resume', () => cmd(t.endsAt ? 'timer.pause' : 'timer.resume')),
            ib('player-stop', 'Stop', 'Stop and remove it from the table', () => cmd('timer.stop')));
        }
        hudKeys = keys;
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
      const j = S() && S().players && S().players.join ? S().players.joinUntil : null; // (the join code leaves the TV by itself)
      const joinOut = box.querySelector('.hud-join-t');
      if (joinOut && j) joinOut.textContent = clock(Math.ceil(Math.max(0, j - Date.now()) / 1000));
      const inPop = ctx.popId() === 'timer' || ctx.popId() === 'toolbox';
      if (popTick && inPop) popTick();
      if (inPop && ctx.tick) ctx.tick();
      if ((t || b || j) && !hudTimer) hudTimer = setInterval(() => tickHud(box), 250);
      if (!t && !b && !j && hudTimer) { clearInterval(hudTimer); hudTimer = 0; if (popTick && inPop) popTick(); if (inPop && ctx.tick) ctx.tick(); }
    }

    function update() {
      if (ui.selMark && !markOf(ui.selMark)) { ui.selMark = null; view().setSelectedMark(null); }
    }

    document.body.dataset.pointMode = ui.point.mode;
    document.body.dataset.drawMode = ui.draw.mode;

    return {
      buildTokenPop, tokenAround: () => tokSides, buildPointPop, buildDrawPop, buildMarkPop, buildTimerPop, noteMode, normTool, markKind, // (Third Builder (third-marks-tool): no Map notes panel; noteMode for J, normTool for old hotbar items)
      pointerDown, pointerMove, pointerUp, hover, leave, toolChanged, cycle, setMode, owns: (k) => OWN.has(k),
      cardTarget, cardAnchor, card, markRadial, removeSelected, toggleSelectedHidden, selectMark, routeEnd, onAtlas,
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
