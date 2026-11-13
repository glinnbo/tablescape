// GM side of Talk mode and the Toolbox.
//   Talk      NPC portraits from the library rise out of an ink band on the TV; click to bring one in or out
//   Toolbox   On the map: point, laser, spotlight, ruler, chalk, pen, text, eraser (switch the mouse to it).
//             Panels: Initiative, Countdown, Soundboard, Break, Notes. Each opens as a floating panel
//             (float-panels.js): drag it anywhere, keep several open.
// gm-play.js owns the popover; these functions build what goes in it.
'use strict';

const Toolbox = (() => {
  const { h, iconEl, toast, Thumbs, clamp, round, openMenu, askText } = UI;
  const ts = window.ts;

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    ui.tb = ui.tb || null; // which toolbox panel is open
    let lib = []; // library items (portraits, sounds)
    let libAt = 0;
    async function loadLib(force) {
      if (!force && Date.now() - libAt < 4000) return;
      libAt = Date.now();
      try { lib = await ts.library('list'); } catch { lib = []; }
      ctx.refreshPop();
    }

    // =====================================================================
    // Talk
    // =====================================================================
    const alphaOf = new Map(); // path -> true when the picture has a transparent background
    function hasAlpha(it) {
      if (alphaOf.has(it.path)) return Promise.resolve(alphaOf.get(it.path));
      return new Promise((resolve) => {
        const img = new Image();
        const done = (v) => { alphaOf.set(it.path, v); resolve(v); };
        img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = 32; cv.height = 32;
            const g = cv.getContext('2d', { willReadFrequently: true });
            g.drawImage(img, 0, 0, 32, 32);
            const d = g.getImageData(0, 0, 32, 32).data;
            // look at the border: a cut-out has transparent pixels there
            let clear = 0; let n = 0;
            for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
              if (x > 2 && x < 29 && y > 2) continue;
              n++;
              if (d[(y * 32 + x) * 4 + 3] < 200) clear++;
            }
            done(clear / n > 0.3);
          } catch { done(true); }
        };
        img.onerror = () => done(true);
        img.src = it.url || UI.pathToUrl(it.path);
      });
    }
    async function talkToggle(it) {
      const alpha = await hasAlpha(it);
      const r = await cmd('talk.toggle', { path: it.path, alpha });
      if (r && r.ok) ts.library('touch', it.path);
      else if (r && r.error) toast(r.error, { kind: 'error', ms: 3500 }); // (Prototype 14: not from the campaign page)
      return r;
    }
    const onStage = (path) => { const t = S().talk; return t ? t.cast.findIndex((x) => x.path === path) : -1; };
    // 4.7: the small panel shows the party and this chapter's Ready list; List … opens all portraits in a window of its own
    function portraits() {
      const out = [];
      const party = Characters.talkItems(S()); // 4.2: their Talk sprites (campaign page → Players → the card)
      if (party.length) out.push(['The party', party, { party: true }]);
      const ch = ctx.ready.chapter();
      if (ch) out.push([`Ready · ${ch.name}`, ctx.ready.list('portraits').filter((t) => !party.some((x) => x.path === t.path)), { ready: true }]); // (4.10.1: missing ones too, greyed, to take off)
      return out;
    }
    const mirrorBtn = (it) => {
      const mirror = (S().settings && S().settings.portraitMirror) || {};
      return h('button', { class: `icon-btn talk-mirror ${mirror[it.path] ? 'on' : ''}`, 'aria-label': 'Mirror', 'data-tip': 'Mirror (face the other way)',
        onclick: (e) => { e.stopPropagation(); cmd('talk.mirror', { path: it.path }); } }, iconEl('flip-horizontal'));
    };
    // Prototype 12: each portrait's own size in Talk: right-click → a slider; a small badge when it isn't 100 %
    const sizeOf = (path) => ((S().settings && S().settings.portraitSize) || {})[path] || 1;
    const offOf = (path) => ((S().settings && S().settings.portraitOffset) || {})[path] || { x: 0, y: 0 }; // (Prototype 13)
    const sizeBadge = (it) => {
      const v = sizeOf(it.path); const o = offOf(it.path); const sized = Math.abs(v - 1) > 0.001; const moved = !!(o.x || o.y);
      if (!sized && !moved) return null;
      const tip = [sized ? `${Math.round(v * 100)} % of the portrait size` : null, moved ? `moved ${o.y ? `${o.y > 0 ? 'up' : 'down'} ${Math.abs(Math.round(o.y * 100))} %` : ''}${o.x && o.y ? ', ' : ''}${o.x ? `${o.x > 0 ? 'right' : 'left'} ${Math.abs(Math.round(o.x * 100))} %` : ''}` : null].filter(Boolean).join('; ');
      return h('b', { class: 'talk-scale', 'data-tip': `${it.name}: ${tip} (right-click to change)` }, sized ? iconEl(v > 1 ? 'arrows-maximize' : 'arrows-minimize') : null, sized ? `${Math.round(v * 100)}%` : null, moved ? iconEl('arrows-move') : null);
    };
    let sizePop = null;
    function closeSizePop() { if (sizePop) { sizePop.remove(); sizePop = null; document.removeEventListener('pointerdown', outSizePop, true); document.removeEventListener('keydown', escSizePop, true); } }
    const outSizePop = (e) => { if (sizePop && !sizePop.contains(e.target)) closeSizePop(); };
    const escSizePop = (e) => { if (e.key === 'Escape' && sizePop) { e.stopPropagation(); closeSizePop(); } };
    function openSizePop(e, it) {
      e.preventDefault(); closeSizePop();
      const out = h('output', {}, `${Math.round(sizeOf(it.path) * 100)} %`);
      const input = h('input', { type: 'range', min: 50, max: 200, step: 5, value: Math.round(sizeOf(it.path) * 100), 'aria-label': `Size of ${it.name}` });
      let sendT = 0;
      input.addEventListener('input', () => { out.textContent = `${input.value} %`; clearTimeout(sendT); sendT = setTimeout(() => cmd('talk.size', { path: it.path, scale: Number(input.value) / 100 }), 40); });
      const i = onStage(it.path);
      // (Prototype 13) up / down and left / right, a share of its own height and width
      const o0 = offOf(it.path); let ox = o0.x || 0; let oy = o0.y || 0; let offT = 0;
      const sendOff = () => { clearTimeout(offT); offT = setTimeout(() => cmd('talk.offset', { path: it.path, x: ox, y: oy }), 40); };
      const fmtY = (v) => (v ? `${v > 0 ? 'up' : 'down'} ${Math.abs(v)} %` : '0');
      const fmtX = (v) => (v ? `${v > 0 ? 'right' : 'left'} ${Math.abs(v)} %` : '0');
      const outY = h('output', {}, fmtY(Math.round(oy * 100))); const outX = h('output', {}, fmtX(Math.round(ox * 100)));
      const inY = h('input', { type: 'range', min: -40, max: 40, step: 1, value: Math.round(oy * 100), 'aria-label': `${it.name} up or down` });
      const inX = h('input', { type: 'range', min: -50, max: 50, step: 1, value: Math.round(ox * 100), 'aria-label': `${it.name} left or right` });
      inY.addEventListener('input', () => { oy = Number(inY.value) / 100; outY.textContent = fmtY(Number(inY.value)); sendOff(); });
      inX.addEventListener('input', () => { ox = Number(inX.value) / 100; outX.textContent = fmtX(Number(inX.value)); sendOff(); });
      for (const [inp, zero] of [[inY, () => { oy = 0; outY.textContent = '0'; }], [inX, () => { ox = 0; outX.textContent = '0'; }]]) inp.addEventListener('dblclick', () => { inp.value = 0; zero(); sendOff(); }); // (a double-click: back to 0)
      sizePop = h('div', { class: 'talk-sizepop', role: 'dialog', 'aria-label': `Size and place of ${it.name}` },
        h('div', { class: 'tsp-head' }, h('b', { class: 'grow ellipsis' }, it.name)),
        h('div', { class: 'tsp-lab' }, h('span', { class: 'grow' }, 'Size'), out), input,
        h('div', { class: 'tsp-lab' }, h('span', { class: 'grow' }, 'Up / down'), outY), inY,
        h('div', { class: 'tsp-lab' }, h('span', { class: 'grow' }, 'Left / right'), outX), inX,
        h('div', { class: 'tsp-row' },
          h('button', { class: 'btn small ghost', 'data-tip': '100 %, in its place', onclick: () => { input.value = 100; out.textContent = '100 %'; inY.value = 0; inX.value = 0; ox = 0; oy = 0; outY.textContent = '0'; outX.textContent = '0'; cmd('talk.size', { path: it.path, scale: 1 }); cmd('talk.offset', { path: it.path, x: 0, y: 0 }); } }, iconEl('refresh'), 'Reset'),
          h('span', { class: 'grow' }),
          i >= 0 ? h('button', { class: 'btn small ghost', onclick: () => { closeSizePop(); cmd('talk.toggle', { path: it.path, out: true }); } }, iconEl('x'), 'Take out') : null));
      document.body.append(sizePop);
      const r = sizePop.getBoundingClientRect();
      sizePop.style.left = `${Math.max(6, Math.min(innerWidth - r.width - 6, e.clientX))}px`;
      sizePop.style.top = `${Math.max(6, Math.min(innerHeight - r.height - 6, e.clientY))}px`;
      setTimeout(() => { document.addEventListener('pointerdown', outSizePop, true); document.addEventListener('keydown', escSizePop, true); }, 0);
      input.focus();
    }
    const tipFor = (it, i, t) => (i < 0 ? `${it.name}: click to bring in` : i === t.cast.length - 1 ? `${it.name}: in front. Click to take out` : `${it.name}: on the table. Click to bring to the front`);
    const readyAdd = (it) => ctx.ready.add('portraits', [{ path: it.path, name: it.name }]);
    // Talk → List: every portrait in the library; click: in or out of the conversation, tick: ready for this chapter
    const talkListDef = () => ({
      id: 'talklist', title: 'Conversation', icon: 'messages',
      tips: ['Click a portrait to bring it into the conversation, click it again to take it out.', 'The tick puts it on this chapter\'s Ready list, or takes it off.',
        'The chips are the folders in Portraits: make folders like Villains or Town.', 'The party\'s pictures belong in the Party folder: their cards pick from there.'],
      build: () => {
        loadLib(true);
        return PickList.build({
          bind: c().bind,
          items: () => lib.filter((x) => x.cat === 'portraits' && x.kind === 'image'),
          pathOf: PickList.pathOf, shortName: PickList.shortName, rootLabel: 'Portraits', memKey: 'portraits', // (4.11: its folders, all of them)
          shelves: [{ id: 'on', label: 'In the conversation', icon: 'messages', has: (it) => onStage(it.path) >= 0 }, { id: 'fav', label: 'Favourites', icon: 'star', has: (it) => !!it.fav }],
          pick: (it) => talkToggle(it),
          state: (it) => { const i = onStage(it.path); const t = S().talk; return { on: i >= 0, badge: i < 0 ? null : i === t.cast.length - 1 ? 'Speaking' : 'On', tip: tipFor(it, i, t) }; },
          ready: { chapter: () => ctx.ready.chapter(), has: (p) => ctx.ready.list('portraits').some((x) => x.path === p), toggle: (it, on) => (on ? readyAdd(it) : ctx.ready.remove('portraits', it.path)) },
          menu: (e, it) => openSizePop(e, it), // (right-click a portrait: its size)
          extra: (it) => h('span', { class: 'talk-extras' }, mirrorBtn(it), sizeBadge(it)), extraSig: (it) => [!!((S().settings && S().settings.portraitMirror) || {})[it.path], sizeOf(it.path), offOf(it.path)],
          dragCat: 'portraits',
          empty: 'No portraits yet. Put PNG busts into the Portraits folder of your library.',
          foot: [c().btn('From this PC …', 'folder', async () => { const r = await ts.library('import', { cat: 'portraits' }); if (r && r.ok) { loadLib(true); toast(`${r.items.length} portrait${r.items.length === 1 ? '' : 's'} added`, { ms: 2000 }); } else if (r && r.error) toast(r.error, { kind: 'error' }); }, { kind: 'small', tip: 'Copy pictures from anywhere on this PC into Portraits' }),
            c().btn('Library folder', 'folder', () => ts.library('open'), { kind: 'small ghost' })],
        });
      },
    });
    function buildTalkPop() {
      loadLib();
      const toggleBtn = h('button', { class: 'btn wide', onclick: async () => { const r = await cmd(S().talk ? 'talk.off' : 'talk.on'); if (r && r.error) toast(r.error, { kind: 'error', ms: 3500 }); } });
      c().bind(() => {
        const on = !!S().talk;
        if (toggleBtn.dataset.on === String(on)) return;
        toggleBtn.dataset.on = String(on);
        toggleBtn.className = `btn wide ${on ? 'danger' : 'primary'}`;
        toggleBtn.innerHTML = '';
        toggleBtn.append(iconEl(on ? 'player-stop' : 'messages'), on ? 'End the conversation' : 'Start a conversation');
      });
      const strip = h('div', { class: 'talk-strip' });
      c().bind(() => {
        const groups = portraits();
        const t = S().talk;
        const mirror = (S().settings && S().settings.portraitMirror) || {};
        const sig = JSON.stringify([groups.map(([g, l]) => [g, l.map((x) => x.path)]), t && t.cast.map((x) => x.path), mirror, (S().settings && S().settings.portraitSize) || {}, (S().settings && S().settings.portraitOffset) || {}]);
        if (strip.dataset.sig === sig) return;
        strip.dataset.sig = sig;
        strip.innerHTML = '';
        if (!groups.length) { strip.append(c().hint('Open List … to pick portraits; tick them there to have them ready here.')); return; }
        for (const [title, list, o] of groups) {
          strip.append(h('div', { class: 'tok-group' }, h('span', { class: 'grow ellipsis' }, title),
            o.ready && list.length ? h('button', { class: 'tg-clear', 'data-tip': 'Empty this chapter\'s Ready list', onclick: () => ctx.ready.clear('portraits') }, 'Clear') : null));
          const row = h('div', { class: `talk-row ${o.ready ? 'ready-row' : ''}` });
          if (o.ready) {
            if (!list.length) row.append(h('p', { class: 'hint ready-empty' }, 'Nothing ready yet: tick portraits in List …'));
            ctx.ready.drop(row, 'portraits');
          }
          for (const it of list.slice(0, 48)) {
            const i = onStage(it.path);
            const use = () => (it.missing ? toast(`${it.name} is no longer in the library: ✕ takes it off the Ready list`, { ms: 3500 }) : talkToggle(it));
            row.append(h('div', { class: `talk-pick ${i >= 0 ? 'on' : ''} ${it.missing ? 'missing' : ''}`, dataset: { flash: it.path }, role: 'button', tabindex: '0', oncontextmenu: (e) => { if (!it.missing) openSizePop(e, it); }, 'data-tip': it.missing ? `${it.name}: no longer in the library (✕ takes it off)` : `${tipFor(it, i, t || { cast: [] })} · right-click: its size and place`, 'aria-label': it.name,
              onclick: use, onkeydown: (e) => { if (e.key === 'Enter') use(); } },
            h('span', { class: 'talk-thumb' }, it.missing ? iconEl('alert-triangle') : Thumbs.img(it.path, it.kind || 'image', it.thumb)),
            h('span', { class: 'talk-name' }, it.name),
            i >= 0 ? h('b', { class: 'talk-badge' }, i === t.cast.length - 1 ? 'Speaking' : 'On') : null,
            mirrorBtn(it),
            sizeBadge(it),
            o.ready ? h('button', { class: 'icon-btn ready-x', 'aria-label': `Take ${it.name} off the Ready list`, 'data-tip': 'Take it off the Ready list', onclick: (e) => { e.stopPropagation(); ctx.ready.remove('portraits', it.path); } }, iconEl('x')) : null));
          }
          strip.append(row);
        }
      });
      const set = (patch) => ts.settings({ talk: patch });
      const prefs = () => (S().settings && S().settings.talk) || { size: 0.34, pos: 1, blur: 0.5, look: 'ink' };
      const posOf = (p) => (Number.isFinite(p.pos) ? p.pos : { left: 0, center: 0.5, right: 1 }[p.anchor] ?? 1);
      const listBtn = c().btn('List …', 'layout-grid', () => ctx.togglePanel(talkListDef()), { kind: 'wide', tip: 'All portraits: click one to bring it in, tick it to have it ready here' });
      c().bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen('talklist')));
      return h('div', { class: 'stack' },
        toggleBtn, strip, listBtn,
        c().sep(),
        c().slider({ label: 'Size', min: 0.1, max: 0.7, step: 0.01, get: () => prefs().size, set: (v) => set({ size: v }), fmt: (v) => `${Math.round(v * 100)}% of the TV height` }),
        // 4.7: anywhere from the left end to the right end (was Left / Middle / Right)
        c().slider({ label: 'Stand at', min: 0, max: 1, step: 0.01, get: () => posOf(prefs()), set: (v) => set({ pos: v }), fmt: (v) => (v < 0.04 ? 'Left' : v > 0.96 ? 'Right' : Math.abs(v - 0.5) < 0.03 ? 'Middle' : `${Math.round(v * 100)}% from the left`) }),
        c().slider({ label: 'Blur the map behind', min: 0, max: 1, step: 0.05, get: () => prefs().blur, set: (v) => set({ blur: v }), fmt: (v) => (v < 0.05 ? 'Off' : `${Math.round(v * 100)}%`) }));
    }

    // =====================================================================
    // Toolbox home
    // =====================================================================
    const PANELS = [
      { id: 'init', label: 'Initiative', icon: 'list-numbers', tip: 'Turn order with rolls, HP, AC and conditions' },
      { id: 'timer', label: 'Countdown', icon: 'hourglass', tip: 'A calm dial or a dramatic countdown on the table' },
      { id: 'sound', label: 'Soundboard', icon: 'speakerphone', tip: 'Sounds from Audio/SFX, played once on the table' },
      { id: 'moments', label: 'Screen effects', icon: 'flare', tip: 'Earthquake, poison gas, blood, an explosion … over the whole table' },
      { id: 'snaps', label: 'Snapshots', short: 'Snaps', icon: 'camera', tip: 'Saved states of a map, played back with F1 to F8' },
      { id: 'spotify', label: 'Spotify', icon: 'brand-spotify', tip: 'Your Spotify: moods, playlists and the volume' },
      { id: 'dice', label: 'Dice', icon: 'dice', tip: 'A dramatic roll, the wheel of luck and death saves on the table' },
      { id: 'handouts', label: 'Handouts', icon: 'script', tip: 'Letters, maps and pictures shown big on the table' }, // Prototype 25
      { id: 'break', label: 'Break', icon: 'coffee', tip: 'A break screen with a countdown' },
      { id: 'notes', label: 'Session log', short: 'Log', icon: 'notes', tip: 'Notes during the session, saved with the campaign' },
      { id: 'lights', label: 'Room lights', short: 'Lights', icon: 'bulb', tip: 'Govee and IKEA lamps around the table follow the game' },
      { id: 'chars', label: 'Character cards', short: 'Cards', icon: 'id-badge-2', tip: 'The party at a glance, only for you (Shift + I)' },
      { id: 'remote', label: 'Remote', short: 'Remote', icon: 'device-mobile', tip: 'Your phone or tablet as a remote or a player screen' },
      { id: 'players', label: 'Player phones', short: 'Players', icon: 'device-gamepad-2', tip: 'Players move their own tokens from their phones' },
      { id: 'mapnotes', label: 'Map notes', short: 'Notes', icon: 'note', tool: true, tip: 'Notes pinned on the map, only you see them (J)' }, // Prototype 14: from the rail
    ];
    // Prototype 14: one grid in a fixed order (no groups); the favourites (a star) above it
    const ORDER = ['init', 'chars', 'timer', 'dice', 'moments', 'snaps', 'sound', 'spotify', 'handouts', 'mapnotes', 'notes', 'break', 'lights', 'players', 'remote'];
    let favs = [];
    try { const v = JSON.parse(localStorage.getItem('toolboxFavs') || 'null'); if (Array.isArray(v)) favs = v.filter((x) => typeof x === 'string'); } catch {}
    function toggleFav(id) {
      favs = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
      try { localStorage.setItem('toolboxFavs', JSON.stringify(favs)); } catch {}
      ctx.openPop('toolbox'); // built anew: the favourites on top
    }
    // tools that change what the mouse does on the map (P and D switch between them too)
    const ON_MAP = [
      { t: 'point', mode: 'ping', label: 'Ping', icon: 'target', tip: 'Click to ping a spot, drag for a laser (P)' },
      { t: 'point', mode: 'laser', label: 'Laser', icon: 'pointer', tip: 'A red dot that follows the mouse' },
      { t: 'point', mode: 'spot', label: 'Spotlight', icon: 'focus-2', tip: 'The table goes dark except around the mouse' },
      { t: 'point', mode: 'measure', label: 'Ruler', icon: 'ruler-measure', tip: 'Measure in feet' },
      { t: 'draw', mode: 'chalk', label: 'Chalk', icon: 'scribble', tip: 'Draw something; it fades after a few seconds (D)' },
      { t: 'draw', mode: 'pen', label: 'Pen', icon: 'ballpen', tip: 'Lines that stay on the map' },
      { t: 'draw', mode: 'text', label: 'Text', icon: 'typography', tip: 'A label on the map' },
      { t: 'draw', mode: 'erase', label: 'Erase', icon: 'eraser', tip: 'Erase pen lines and labels' },
      { t: 'mark', mode: 'marker', label: 'Marker', icon: 'map-pin', tip: 'Pins, crosses and numbered markers on the map (X)' },
      { t: 'mark', mode: 'counter', label: 'Counter', icon: 'plus-minus', tip: 'A number on the map, e.g. rounds until the ritual completes' },
    ];
    function running(id) {
      const s = S();
      return { lights: !!(s.lights && s.lights.started && s.lights.on && s.lights.lamps.length), init: !!(s.init && s.init.running), timer: !!s.timer, break: !!s.brk, handouts: !!s.handout, sound: false, notes: false, moments: (s.moments || []).some((m) => !m.stop), dice: !!s.dice, spotify: !!(s.spotify && s.spotify.now && s.spotify.now.playing), remote: !!(s.remote && s.remote.devices.some((d) => d.connected)) }[id];
    }
    // the launcher: tools for the map switch the mouse to them; panels open as floating windows
    function buildToolbox() {
      // Prototype 16: the tools for the map (Ping … Counter) and the panels in one grid, in a fixed order; any of them
      // can be a favourite (a star) and then stands on top
      const mapOn = (m) => ui.tool === m.t && (m.t === 'point' ? ui.point.mode : m.t === 'mark' ? (ui.mark.mode === 'counter' ? 'counter' : 'marker') : ui.draw.mode) === m.mode;
      const tiles = []; const mapTiles = [];
      const starOf = (id) => {
        const fav = favs.includes(id);
        return h('i', { class: `tb-star ${fav ? 'on' : ''}`, 'data-tip': fav ? 'Not a favourite' : 'Favourite: at the top', onclick: (e) => { e.stopPropagation(); toggleFav(id); } }, iconEl('star', fav ? 'fill' : ''));
      };
      const favItem = (id) => { const fav = favs.includes(id); return { icon: fav ? 'star-off' : 'star', label: fav ? 'Not a favourite' : 'Favourite (at the top)', action: () => toggleFav(id) }; };
      // a tool for the map: switches the mouse to it
      const mapTile = (m) => {
        const id = `${m.t}:${m.mode}`;
        const b = h('button', { class: 'tb-tile', dataset: { id, t: m.t, mode: m.mode }, 'data-tip': m.tip, 'aria-label': m.label, onclick: () => ctx.useTool(m.t, m.mode) },
          iconEl(m.icon), h('span', {}, m.label), starOf(id));
        const item = ctx.toolHot(id, m.label, m.icon); // Prototype 24: a map tool on the hotbar
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [{ header: m.label }, favItem(id), Hotbar.menuItem(item)]); });
        mapTiles.push([b, m]);
        return Hotbar.offer(b, item, { menu: false });
      };
      // a panel's tile: right-click pins it to the rail (one click away) or puts it on the hotbar
      const tile = (p) => {
        const item = { kind: 'panel', ref: p.id, label: p.label, icon: p.icon };
        const b = h('button', { class: 'tb-tile', dataset: { id: p.id }, 'data-tip': p.tip, onclick: () => { if (p.tool) { openPanel(p.id); return; } openPanel(p.id); ctx.closePop(); } },
          iconEl(p.icon), h('span', {}, p.label), h('i', { class: 'tb-live' }), h('i', { class: 'tb-pin' }, iconEl('pinned')), starOf(p.id));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const on = ctx.pins().includes(p.id);
          openMenu(e.clientX, e.clientY, [{ header: p.label }, favItem(p.id),
            p.id === 'init' ? null : { icon: on ? 'pinned-off' : 'pin', label: on ? 'Take off the rail' : 'Pin to the rail', action: () => ctx.togglePin(p.id) }, // 4.3.1: Initiative stays in Fight
            Hotbar.menuItem(item)].filter(Boolean)); // (Prototype 24: Map notes too)
        });
        tiles.push(Hotbar.offer(b, item, { menu: false }));
        return b;
      };
      const mapOf = (id) => ON_MAP.find((m) => `${m.t}:${m.mode}` === id);
      const panelOf = (id) => PANELS.find((x) => x.id === id);
      const make = (id) => (mapOf(id) ? mapTile(mapOf(id)) : panelOf(id) ? tile(panelOf(id)) : null);
      const all = [...ON_MAP.map((m) => `${m.t}:${m.mode}`), ...ORDER];
      const favIds = favs.filter((id) => all.includes(id));
      const rest = all.filter((id) => !favIds.includes(id));
      const favRow = favIds.length ? h('div', { class: 'tb-grid tb-panels tb-favs' }, ...favIds.map(make).filter(Boolean)) : null;
      const grid = h('div', { class: 'tb-grid tb-panels' }, ...rest.map(make).filter(Boolean));
      c().bind(() => {
        for (const [b, m] of mapTiles) b.classList.toggle('on', mapOn(m));
        for (const b of tiles) { b.classList.toggle('live', !!running(b.dataset.id)); b.classList.toggle('open', b.dataset.id === 'mapnotes' ? ui.tool === 'notes' : ctx.panelOpen(b.dataset.id)); b.classList.toggle('pinned', ctx.pins().includes(b.dataset.id)); }
      });
      return h('div', { class: 'stack' },
        favRow ? c().ctlLabel('Favourites') : null, favRow,
        favRow ? c().ctlLabel('All') : null, grid);
    }
    const panelInfo = (id) => PANELS.find((x) => x.id === id) || null;
    // 4.3.1: each panel's handy things behind the "?" in its title bar
    const PANEL_TIPS = {
      init: ['Enter: next turn. After the last one a new round starts.', 'Players come from the campaign page, enemies from the tokens on this map or + Enemy.',
        'Roll enemies: d20 + bonus for every enemy without a number (a group rolls once).', 'HP: type 12, 12/20, −7 or +5.', 'Column adds HP, AC, conditions, notes or your own.',
        'The gear opens Options → Initiative.'],
      timer: ['Normal: a round dial at a short end or in the middle of the TV.', 'Dramatic: a big number in the middle, pulsing darker towards zero.', 'A running dial can still move to another end.'],
      sound: ['Each sound plays once on the sound effects speaker (Options → Sound).', 
        'Star a sound to keep it at the top.', 'Drag a sound onto the hotbar to play it with a number key.', 'Subfolders of Audio/SFX become groups.'],
      moments: ['Click to play one on the table.', 'Gas, dread, frost, madness and time stop stay until you click them again.', 'Shift + 1 to 9 play the starred ones.', 'The target button puts one where you click on the map.'],
      spotify: ['Music plays in the Spotify app, through its speaker.', 'Ctrl + 1 to 9 play the first nine moods.', 'A chapter\'s fight music can be a mood (Ambience → Combat), and so can a snapshot\'s transition.',
        'A mood plays its songs, or one of its playlists or albums.', 'Smooth changes between songs: turn on Crossfade in the Spotify app (Settings → Playback).'],
      dice: ['Dice: click a die to add it, right-click to take one out.', 'Wheel: more weight puts an entry on the reel more often.',
        'Death save: 10 or more is a success, below 10 a failure.'],
      handouts: ['Click a handout to show it on the table; click it again (or Put it away) to take it off. + adds it to what lies there.',
        'The picture of the TV: drag a handout to where it should lie. Both sides, One direction and Lengthwise set it up with one click; each handout remembers its layout.',
        'The phone button: Everyone or single players can look at it on their phones, once it was shown or at once with Send to the phones now.',
        'List … has every handout: tick one to keep it ready here for this chapter.',
        'Shown so far keeps what the players have seen this session, to bring it back with one click.', 'Drag a handout onto the hotbar to show it with a number key.'],
      break: ['The map blurs and a dial counts down on the table.', 'At zero a soft chime plays and the map comes back.', '+5 min adds time while it runs.'],
      notes: ['Saved with the campaign as you type.', 'Time stamp writes the time, the map and the round where the cursor is.', 'Export writes it into a text file in the campaign\'s Notes folder.'],
      lights: ['The lamps take the colours of the TV and flash with lightning, explosions and spells.', 'Room light: warm and bright. Off: the lamps switch off. Let go: they go back to how they were.', '−20 % and +20 % work on the hotbar too (right-click them).'],
      chars: ['Only you see this.', 'HP and conditions come from the turn order; inspiration, exhaustion and death saves stay with the campaign.'],
      players: ['A player scans the join code, picks their character and moves its token with a stick on the phone.', 'Steps stop at walls, closed doors and other tokens; in a fight each moves on their own turn.',
        'Hand a token: any token on the table (a familiar, a summoned beast) for a phone.', 'Right-click a phone: movement again, take the character away.'],
      remote: ['Windows may ask once whether Tablescape may use the network: allow it on private networks.', 'A tablet at the table: set its Auto-Lock to Never.', 'Right-click a device in the list to choose which deck it shows.'],
    };
    const defOf = (id) => {
      const p = PANELS.find((x) => x.id === id) || PANELS[0];
      return { id: p.id, title: p.label, icon: p.icon, build: () => panel(p.id), tips: PANEL_TIPS[p.id] };
    };
    function openPanel(id) { if (id === 'mapnotes') { ctx.mapNotes(false); return; } if (id === 'snaps') { ctx.snaps(false); return; } ctx.showPanel(defOf(id)); }
    function togglePanel(id) { if (id === 'mapnotes') { ctx.mapNotes(true); return; } if (id === 'snaps') { ctx.snaps(true); return; } ctx.togglePanel(defOf(id)); }
    function panel(id) {
      const body = id === 'handouts' ? buildHandouts() : id === 'init' ? buildInit() : id === 'timer' ? ctx.Tools.buildTimerPop() : id === 'sound' ? buildSound() : id === 'notes' ? buildNotes()
        : id === 'moments' ? ctx.Show.buildMoments() : id === 'spotify' ? ctx.Spot.buildPanel() : id === 'dice' ? ctx.Dice.buildPanel() : id === 'lights' ? ctx.Lights.buildPanel() : id === 'remote' ? ctx.Remote.buildPanel() : id === 'players' ? ctx.Players.buildPanel() : id === 'chars' ? ctx.Chars.buildPanel() : buildBreak();
      return h('div', { class: 'stack' }, body);
    }
    function strikeNow() {
      cmd('strike.now', {});
      toast('Lightning!', { ms: 1200 });
    }

    // =====================================================================
    // Soundboard
    // =====================================================================
    // one sound per row with its whole name ("Enemy_Wave-02" reads "Enemy Wave 02"), starred ones on top,
    // a search box once the list gets long
    const niceName = (n) => String(n).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    let boardQuery = '';
    function buildSound() {
      loadLib();
      const list = h('div', { class: 'sb-list' });
      const search = h('input', { type: 'search', class: 'sb-search', placeholder: 'Find a sound', value: boardQuery, 'aria-label': 'Find a sound', spellcheck: 'false' });
      search.addEventListener('input', () => { boardQuery = search.value; list.dataset.sig = ''; ctx.refreshPop(); });
      c().bind(() => {
        const all = lib.filter((x) => x.cat === 'sounds' && (/^Audio\/SFX\//i.test(x.rel) || /\bsfx\b/i.test(x.rel)));
        search.hidden = all.length <= 12;
        const q = boardQuery.trim().toLowerCase();
        const sounds = q && !search.hidden ? all.filter((x) => niceName(x.name).toLowerCase().includes(q) || x.rel.toLowerCase().includes(q)) : all;
        const sig = JSON.stringify([sounds.map((x) => [x.path, x.fav]), q]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        if (!all.length) { list.append(c().hint('No sounds yet. Put short sound files into Audio/SFX in your library.')); return; }
        if (!sounds.length) { list.append(c().hint(`Nothing called "${boardQuery}".`)); return; }
        const groups = new Map();
        const starred = sounds.filter((x) => x.fav);
        if (starred.length) groups.set('Starred', starred);
        for (const x of sounds) {
          if (x.fav) continue; // already at the top
          const g = x.rel.split('/').slice(2, -1).join(' / ') || 'Sounds';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(x);
        }
        for (const [g, items] of groups) {
          list.append(h('div', { class: 'tok-group' }, g));
          for (const it of items) {
            const name = niceName(it.name);
            list.append(Hotbar.offer(h('div', { class: 'sb-btn', role: 'button', tabindex: '0', 'data-tip': `${name}: play once on the table`, 'aria-label': name, onclick: () => cmd('sound.play', { path: it.path }), onkeydown: (e) => { if (e.key === 'Enter') cmd('sound.play', { path: it.path }); } },
              iconEl('player-play'), h('span', { class: 'sb-name' }, name),
              h('button', { class: `sb-star ${it.fav ? 'on' : ''}`, 'aria-label': it.fav ? `Unstar ${name}` : `Star ${name}`, 'data-tip': it.fav ? 'Starred: always at the top' : 'Star it to keep it at the top',
                onclick: async (e) => { e.stopPropagation(); await ts.library('fav', { path: it.path, on: !it.fav }); it.fav = !it.fav; list.dataset.sig = ''; ctx.refreshPop(); } }, iconEl('star', it.fav ? 'fill' : ''))),
              { kind: 'sound', ref: { path: it.path, kind: 'audio', cat: 'sounds' }, label: name, icon: 'volume' }));
          }
        }
      });
      return h('div', { class: 'stack' },
        c().slider({ label: 'Volume', min: 0, max: 1, step: 0.01, get: () => S().settings && S().settings.boardVolume, set: (v) => ts.settings({ boardVolume: v }), fmt: (v) => `${Math.round(v * 100)}%` }),
        search,
        list,
        c().row(c().btn('Stop all', 'player-stop', () => cmd('sound.stop')), c().btn('Refresh', 'refresh', () => loadLib(true), { tip: 'Look for new files' })));
    }

    // =====================================================================
    // Notes: saved with the campaign as you type; export writes a text file
    // =====================================================================
    const notes = () => (S().campaign && S().campaign.notes) || { text: '', dirty: false };
    // "19:42 · Lower hall · Round 3"
    function stampText() {
      const s = S();
      const d = new Date();
      const parts = [`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`];
      const live = s.table && s.table.liveName;
      if (live) parts.push(live); else if (s.map) parts.push(s.map.name);
      if (s.combat && s.combat.n != null) parts.push(`Round ${s.combat.n}`);
      return `[${parts.join(' · ')}] `;
    }
    function buildNotes() {
      const ta = h('textarea', { class: 'notes-text', placeholder: 'What happened, names, loot, ideas for next time …', 'aria-label': 'Session log', spellcheck: 'true' });
      const status = h('span', { class: 'hint grow notes-status' });
      let timer = 0; let dirty = false;
      const save = () => {
        clearTimeout(timer); timer = 0;
        if (!dirty) return;
        dirty = false;
        cmd('notes.set', { text: ta.value });
      };
      ta.addEventListener('input', () => { dirty = true; status.textContent = 'Saving …'; clearTimeout(timer); timer = setTimeout(save, 500); });
      ta.addEventListener('blur', save);
      // typing here is for the notes, not for the map shortcuts
      ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') ta.blur(); });
      c().bind(() => {
        const n = notes();
        if (!dirty && document.activeElement !== ta && ta.value !== n.text) ta.value = n.text;
        if (!dirty && !timer) status.textContent = !n.text ? 'Saved with the campaign as you type' : n.dirty ? 'Saved with the campaign' : 'Saved and exported';
      });
      const stamp = () => {
        const t = stampText();
        const at = ta.selectionStart ?? ta.value.length;
        const before = ta.value.slice(0, at); const after = ta.value.slice(ta.selectionEnd ?? at);
        const lead = before && !before.endsWith('\n') ? '\n' : '';
        ta.value = before + lead + t + after;
        const pos = (before + lead + t).length;
        ta.focus(); ta.setSelectionRange(pos, pos);
        dirty = true; save();
      };
      const exportIt = async () => {
        save();
        const r = await cmd('notes.export');
        if (r && r.ok) toast(`Session log exported to ${r.name}`, { ms: 6000, action: { label: 'Show', run: () => ts.library('reveal', r.file) } });
      };
      return h('div', { class: 'stack notes' }, ta,
        c().row(c().btn('Time stamp', 'clock-edit', stamp, { tip: 'Writes the time, the map and the round where the cursor is' }),
          c().btn('Export', 'file-export', exportIt, { tip: 'Writes it into a text file in the campaign\'s Notes folder' })),
        status,
        c().toggle({ label: 'Ask to export when closing Tablescape', get: () => !S().settings || S().settings.askNotes !== false, set: (v) => ts.settings({ askNotes: v }) }));
    }

    // =====================================================================
    // Handouts (Prototype 25): the chapter's Ready list, what was shown so far, List … with all.
    // Prototype 26: several at once. A click shows a handout alone (or puts it away), + adds it to what lies there.
    // The panel draws the TV: drag a handout to where it should lie. Each one remembers its layout (a copy for each
    // long side, or one copy placed and turned) and can be marked for the players' phones.
    // =====================================================================
    const handList = () => S().handouts || [];
    const handOn = (path) => handList().some((x) => x.path === path);
    const handLay = (path) => handList().find((x) => x.path === path) || null;
    const shareOf = (path) => (S().handoutShare || []).find((x) => x.path === path) || null;
    const layout = (path, patch) => cmd('handout.layout', { path, patch });
    const handToggle = async (it, add) => { const r = await cmd('handout.show', { path: it.path, add: !!add }); if (r && r.error) toast(r.error, { kind: 'error' }); };
    // who may look at it on their phone
    function shareMenu(e, it) {
      const sh = shareOf(it.path);
      const to = sh ? sh.to : null;
      const names = ((S().campaign && S().campaign.party) || []);
      const set = (next, send) => cmd('handout.share', { path: it.path, to: next, send: !!send });
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, [{ header: `${it.name} on the phones` },
        { icon: 'users', label: 'Everyone', checked: to === 'all', action: () => set(to === 'all' ? null : 'all') },
        ...names.map((n) => ({ icon: 'user', label: `Only for ${n}`, checked: Array.isArray(to) && to.includes(n),
          action: () => { const cur = Array.isArray(to) ? to : []; const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]; set(next.length ? next : null); } })),
        ...(sh ? ['-', ...(sh.sent ? [] : [{ icon: 'send', label: 'Send to the phones now', action: () => set(to, true) }]),
          { icon: 'arrow-back-up', label: 'Take it back', action: () => set(null) }] : [])]);
    }
    const phoneBtn = (it, label) => {
      const sh = shareOf(it.path);
      return h('button', { class: `icon-btn ho-phone ${sh ? 'on' : ''}`, 'aria-label': label, 'data-tip': sh ? `${sh.to === 'all' ? 'Everyone' : sh.to.join(', ')} can look at it on the phone${sh.sent ? '' : ' once it is shown'}` : 'Let players look at it on their phones',
        onclick: (e) => { e.stopPropagation(); shareMenu(e, it); } }, iconEl('device-mobile'));
    };
    const handListDef = () => ({
      id: 'handlist', title: 'All handouts', icon: 'script',
      // it opens beside the Handouts panel, not over it
      place: (r, el) => { const hp = document.querySelector('.fp[data-id="handouts"]'); if (!hp) return { x: Math.max(12, r.width - 212 - 24 - 300 - 12 - el.offsetWidth - 12), y: 12 }; const b = hp.getBoundingClientRect(); const left = b.left - r.left - el.offsetWidth - 10; return { x: left >= 8 ? left : b.right - r.left + 10, y: b.top - r.top }; },
      build: () => {
        loadLib(true);
        return PickList.build({
          bind: c().bind,
          items: () => lib.filter((x) => x.cat === 'handouts'),
          pathOf: PickList.pathOf, shortName: PickList.shortName, rootLabel: 'Handouts', memKey: 'handouts',
          shelves: [{ id: 'on', label: 'On the table', icon: 'cast', has: (it) => handOn(it.path) }, { id: 'seen', label: 'Shown so far', icon: 'history', has: (it) => (S().handoutSeen || []).some((x) => x.path === it.path) },
            { id: 'fav', label: 'Favourites', icon: 'star', has: (it) => !!it.fav }],
          pick: (it) => handToggle(it),
          state: (it) => ({ on: handOn(it.path), badge: handOn(it.path) ? 'On the table' : null, tip: handOn(it.path) ? `${it.name}: on the table. Click to put it away` : `${it.name}: click to show it` }),
          ready: { chapter: () => ctx.ready.chapter(), has: (p) => ctx.ready.list('handouts').some((x) => x.path === p), toggle: (it, on) => (on ? ctx.ready.add('handouts', [{ path: it.path, name: it.name }]) : ctx.ready.remove('handouts', it.path)) },
          dragCat: 'handouts',
          empty: 'No handouts yet. Put pictures into the Handouts folder of your library.',
          foot: [c().btn('From this PC …', 'folder', async () => { const r = await ts.library('import', { cat: 'handouts' }); if (r && r.ok) { loadLib(true); toast(`${r.items.length} handout${r.items.length === 1 ? '' : 's'} added`, { ms: 2000 }); } }, { kind: 'small' }),
            c().btn('Library folder', 'folder', () => ts.library('open'), { kind: 'small ghost' })],
        });
      },
    });
    function buildHandouts() {
      loadLib();
      // ---------- the picture of the TV ----------
      const stage = h('div', { class: 'ho-stage' });
      const empty = h('p', { class: 'hint ho-none' }, 'Nothing on the table. Click a handout to show it.');
      const ctl = h('div', { class: 'ho-ctl stack' });
      const sel = () => { const l = handList(); return l.find((x) => x.path === ui.hoSel) || l[l.length - 1] || null; };
      const world = () => (S().view && S().view.world) || { w: 16, h: 9 };
      let dragging = null;
      // a thumbnail lies and is sized as the handout on the TV (table-overlays.js: placeHandouts)
      function placeThumb(el, d) {
        const W = stage.clientWidth || 280; const H = stage.clientHeight || 158;
        const size = d.size || 1;
        if (!d.both) {
          const side = d.rot === 90 || d.rot === 270;
          const img = el.firstChild;
          img.style.maxWidth = `${(side ? H : W) * 0.94 * size}px`; img.style.maxHeight = `${(side ? W : H) * 0.94 * size}px`;
          el.style.left = `${d.x * 100}%`; el.style.top = `${d.y * 100}%`;
          el.style.transform = `translate(-50%, -50%) rotate(${d.rot || 0}deg)`;
          return;
        }
        let w = 0;
        for (const img of el.querySelectorAll('img')) { img.style.maxWidth = `${(W * 0.76 * size) / (d.share || 1)}px`; img.style.maxHeight = `${H * 0.45 * size}px`; w = Math.max(w, img.offsetWidth || 0); }
        const room = Math.max(0, (W - w) / 2 - W * 0.02);
        el.style.left = `${W / 2 + Math.max(-room, Math.min(room, (d.x - 0.5) * W))}px`;
      }
      function drawStage() {
        const list = handList();
        const wd = world();
        stage.style.aspectRatio = `${wd.w} / ${wd.h}`;
        const cur = sel();
        const sig = JSON.stringify([list.map((d) => [d.path, d.both, d.x, d.y, d.size, d.rot, d.share]), cur && cur.path, wd.w, wd.h]);
        if (stage.dataset.sig === sig || dragging) return;
        stage.dataset.sig = sig;
        stage.replaceChildren(...list.map((d) => {
          const img = () => { const i = h('img', { src: d.url, alt: '', draggable: 'false' }); i.addEventListener('load', () => placeThumb(el, d)); return i; };
          const el = h('div', { class: `ho-thumb ${d.both ? 'pair' : 'one'} ${cur && cur.path === d.path ? 'sel' : ''}`, 'data-tip': `${d.name}: drag it to where it should lie`, dataset: { path: d.path } },
            ...(d.both ? [h('span', { class: 'far' }, img()), h('span', { class: 'near' }, img())] : [img()]));
          el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            ui.hoSel = d.path;
            const r = stage.getBoundingClientRect(); const b = el.getBoundingClientRect();
            // (where the thumbnail was grabbed, measured from its middle)
            dragging = { el, d: { ...d }, dx: e.clientX - (b.left + b.width / 2), dy: e.clientY - (b.top + b.height / 2), r, moved: false };
            el.setPointerCapture(e.pointerId);
            for (const x of stage.children) x.classList.toggle('sel', x === el);
          });
          el.addEventListener('pointermove', (e) => {
            const g = dragging;
            if (!g || g.el !== el) return;
            g.moved = true;
            g.d.x = Math.min(1, Math.max(0, (e.clientX - g.dx - g.r.left) / g.r.width));
            if (!g.d.both) g.d.y = Math.min(1, Math.max(0, (e.clientY - g.dy - g.r.top) / g.r.height));
            placeThumb(el, g.d);
          });
          const done = () => {
            const g = dragging;
            if (!g || g.el !== el) return;
            dragging = null;
            if (g.moved) layout(d.path, g.d.both ? { x: g.d.x } : { x: g.d.x, y: g.d.y }); else { stage.dataset.sig = ''; drawStage(); drawCtl(); }
          };
          el.addEventListener('pointerup', done);
          el.addEventListener('pointercancel', done);
          requestAnimationFrame(() => placeThumb(el, d));
          return el;
        }));
        empty.hidden = list.length > 0;
        stage.hidden = !list.length;
      }
      // ---------- how the picked handout lies ----------
      function drawCtl() {
        const d = sel();
        const sh = d ? shareOf(d.path) : null;
        const sig = d ? JSON.stringify([d.path, d.both, d.rot, d.size, handList().length, sh && [sh.to, sh.sent]]) : '';
        if (ctl.dataset.sig === sig) return;
        ctl.dataset.sig = sig;
        if (!d) { ctl.replaceChildren(); return; }
        const chip = (label, tip, on, patch) => h('button', { class: `chip ${on ? 'on' : ''}`, 'data-tip': tip, onclick: () => layout(d.path, patch) }, label);
        const side = d.rot === 90 || d.rot === 270;
        const turn = (by, icon, tip) => h('button', { class: 'icon-btn', 'aria-label': tip, 'data-tip': tip, disabled: d.both || null, onclick: () => layout(d.path, { rot: (d.rot || 0) + by }) }, iconEl(icon));
        const size = h('input', { type: 'range', min: 0.2, max: 1, step: 0.02, 'aria-label': 'Size' });
        size.value = d.size;
        const out = h('output', {}, `${Math.round(d.size * 100)}%`);
        size.addEventListener('input', () => { out.textContent = `${Math.round(Number(size.value) * 100)}%`; });
        size.addEventListener('change', () => layout(d.path, { size: Number(size.value) }));
        ctl.replaceChildren(
          h('div', { class: 'ho-name' }, h('b', { class: 'grow ellipsis' }, d.name), phoneBtn(d, 'On the phones'),
            c().btn('Put it away', 'player-stop', () => cmd('handout.hide', { path: d.path }), { kind: 'danger small' })),
          h('div', { class: 'ho-chips' },
            chip('Both sides', 'A copy for each long side of the table', d.both, { both: true }),
            chip('One direction', 'One big copy, upright for one side', !d.both && !side, { both: false, rot: 0 }),
            chip('Lengthwise', 'One copy along the TV: a scroll, a stone tablet, a long map', !d.both && side, { both: false, rot: 90 }),
            h('span', { class: 'grow' }),
            turn(-90, 'rotate', 'Turn it a quarter to the left'), turn(90, 'rotate-clockwise', 'Turn it a quarter to the right')),
          h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, 'Size'), size, out));
      }
      const awayAll = c().btn('Put everything away', 'player-stop', () => cmd('handout.hide', {}), { kind: 'small ghost' });
      c().bind(() => { drawStage(); drawCtl(); awayAll.hidden = handList().length < 2; });

      // ---------- what is at hand: the chapter's Ready list, and what was shown so far ----------
      const strip = h('div', { class: 'talk-strip' });
      c().bind(() => {
        const ch = ctx.ready.chapter();
        const ready = ch ? ctx.ready.list('handouts') : [];
        const seen = (S().handoutSeen || []).filter((x) => !ready.some((r) => r.path === x.path));
        const sig = JSON.stringify([ch && ch.id, ready.map((x) => [x.path, x.missing]), seen.map((x) => x.path), handList().map((x) => x.path), (S().handoutShare || []).map((x) => [x.path, x.to, x.sent])]);
        if (strip.dataset.sig === sig) return;
        strip.dataset.sig = sig;
        strip.innerHTML = '';
        const tile = (it, isReady) => {
          const on = handOn(it.path);
          const use = () => (it.missing ? toast(`${it.name} is no longer in the library: ✕ takes it off the Ready list`, { ms: 3500 }) : handToggle(it));
          const el = h('div', { class: `talk-pick ${on ? 'on' : ''} ${it.missing ? 'missing' : ''}`, dataset: { flash: it.path }, role: 'button', tabindex: '0', 'data-tip': it.missing ? `${it.name} is missing` : on ? `${it.name}: click to put it away` : `${it.name}: click to show it`,
            onclick: use, onkeydown: (e) => { if (e.key === 'Enter') use(); } },
          ...[h('span', { class: 'talk-thumb' }, it.missing ? iconEl('alert-triangle') : Thumbs.img(it.path, it.kind || 'image', it.thumb)),
            h('span', { class: 'talk-name' }, it.name),
            on ? h('b', { class: 'talk-badge' }, 'On') : null,
            !it.missing && !on && handList().length ? h('button', { class: 'icon-btn ho-add', 'aria-label': `Show ${it.name} beside what lies there`, 'data-tip': 'Add it to what lies on the table', onclick: (e) => { e.stopPropagation(); handToggle(it, true); } }, iconEl('plus')) : null,
            it.missing ? null : phoneBtn(it, `${it.name} on the phones`),
            isReady ? h('button', { class: 'icon-btn ready-x', 'aria-label': `Take ${it.name} off the Ready list`, 'data-tip': 'Take it off the Ready list', onclick: (e) => { e.stopPropagation(); ctx.ready.remove('handouts', it.path); } }, iconEl('x')) : null].filter(Boolean));
          return it.missing ? el : Hotbar.offer(el, { kind: 'handout', label: it.name, ref: { path: it.path, kind: it.kind || 'image', cat: 'handouts' } });
        };
        if (ch) {
          strip.append(h('div', { class: 'tok-group' }, ...[h('span', { class: 'grow ellipsis' }, `Ready · ${ch.name}`),
            ready.length ? h('button', { class: 'tg-clear', 'data-tip': 'Empty this chapter\'s Ready list', onclick: () => ctx.ready.clear('handouts') }, 'Clear') : null].filter(Boolean)));
          const row = h('div', { class: 'talk-row ready-row' });
          if (!ready.length) row.append(h('p', { class: 'hint ready-empty' }, 'Nothing ready yet: tick handouts in List …'));
          ctx.ready.drop(row, 'handouts');
          for (const it of ready.slice(0, 48)) row.append(tile(it, true));
          strip.append(row);
        }
        if (seen.length) {
          strip.append(h('div', { class: 'tok-group' }, h('span', { class: 'grow ellipsis' }, 'Shown so far')));
          const row = h('div', { class: 'talk-row' });
          for (const it of seen) row.append(tile(it, false));
          strip.append(row);
        }
      });
      const prefs = () => (S().settings && S().settings.handout) || { size: 1, pos: 0.5, log: true };
      const listBtn = c().btn('List …', 'layout-grid', () => ctx.togglePanel(handListDef()), { kind: 'wide', tip: 'All handouts: click one to show it, tick it to have it ready here' });
      c().bind(() => listBtn.classList.toggle('on', !!ctx.panelOpen('handlist')));
      return h('div', { class: 'stack' },
        stage, empty, ctl, awayAll, strip, listBtn,
        c().sep(),
        c().toggle({ label: 'Write "Handout shown" into the session log', get: () => prefs().log !== false, set: (v) => ts.settings({ handout: { log: v } }) }));
    }

    // Break
    // =====================================================================
    function buildBreak() {
      ui.brkMin = ui.brkMin || 10;
      const setup = h('div', { class: 'stack' });
      const live = h('div', { class: 'stack' });
      const chips = h('div', { class: 'chips' }, ...[5, 10, 15, 20, 30].map((m) => h('button', { class: 'chip', dataset: { v: String(m) }, onclick: () => { ui.brkMin = m; ctx.refreshPop(); } }, `${m} min`)));
      c().bind(() => { for (const b of chips.children) b.classList.toggle('on', Number(b.dataset.v) === ui.brkMin); });
      setup.append(chips,
        c().btn('Start the break', 'coffee', () => cmd('break.start', { minutes: ui.brkMin }), { kind: 'primary wide' }));
      const big = h('div', { class: 'timer-big' });
      live.append(big, c().row(c().btn('+5 min', null, () => cmd('break.start', { minutes: Math.ceil(Math.max(0, S().brk.endsAt - Date.now()) / 60000) + 5 })), c().btn('End the break', 'player-stop', () => cmd('break.end'), { kind: 'danger' })));
      const paint = () => {
        const b = S().brk;
        setup.hidden = !!b; live.hidden = !b;
        if (b) { const s = Math.ceil(Math.max(0, b.endsAt - Date.now()) / 1000); big.textContent = s > 0 ? Countdown.clock(s) : 'Time!'; }
      };
      c().bind(paint);
      return h('div', { class: 'stack' }, setup, live);
    }

    // =====================================================================
    // Initiative: one list to prepare the fight and to run it (main.js keeps it, see initInfo)
    // =====================================================================
    const CONDITIONS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhausted', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
      'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
    // one grid for the whole list (the rows are subgrids): the names column is as wide as the longest name, the pop-up as wide as its columns
    const COL_W = { hp: '86px', ac: '44px', cond: 'fit-content(260px)', notes: '150px', num: '54px', text: '120px' };
    const COL_ICON = { hp: 'heart', ac: 'shield', cond: 'tags', notes: 'note', num: 'hash', text: 'typography' };
    const COL_PRESETS = [
      { kind: 'hp', label: 'HP', tip: 'Hit points: type 12, 12/20, -7 or +5' },
      { kind: 'ac', label: 'AC', tip: 'Armour class' },
      { kind: 'cond', label: 'Conditions', tip: 'Poisoned, Prone, Stunned … as little tags' },
      { kind: 'notes', label: 'Notes', tip: 'A short note per fighter' },
      { kind: 'num', label: 'Your own number …', tip: 'A number column with your name for it (spell slots, legendary actions …)' },
      { kind: 'text', label: 'Your own text …', tip: 'A text column with your name for it' },
    ];
    const baseOf = (n) => String(n).replace(/\s*\d+$/, '').trim() || String(n);
    const numOrNull = (v) => { const t = String(v ?? '').trim(); return t === '' || !Number.isFinite(Number(t)) ? null : Math.round(Number(t)); };
    const sgn = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '+0');
    let iniFocus = null; // after the list redraws, this field gets the keyboard: { f, value?, pos? }

    function buildInit() {
      const box = h('div', { class: 'ini' });
      let sig = '';
      let asking = false;
      c().bind(() => {
        const s = S();
        if (!s.init && !asking) { asking = true; cmd('init.prepare', {}).finally(() => { asking = false; }); }
        const I = s.init;
        const nsig = JSON.stringify([I, s.combat && s.combat.n, (s.campaign && s.campaign.away) || []]);
        if (nsig === sig) return;
        sig = nsig;
        // a field being typed in keeps the keyboard and what was typed
        const a = document.activeElement;
        if (!iniFocus && a && box.contains(a) && a.dataset.f) iniFocus = { f: a.dataset.f, value: a.value !== a.defaultValue ? a.value : undefined, pos: a.selectionStart };
        box.innerHTML = '';
        if (!I) { box.append(UI.loader('Getting the fighters …')); return; }
        renderInit(box, I, s);
        if (iniFocus) {
          const f = box.querySelector(`[data-f="${CSS.escape(iniFocus.f)}"]`);
          if (f) {
            if (iniFocus.value !== undefined) f.value = iniFocus.value;
            f.focus();
            try { if (iniFocus.pos != null) f.setSelectionRange(iniFocus.pos, iniFocus.pos); else f.select(); } catch {}
          }
          iniFocus = null;
        }
      });
      return box;
    }

    function renderInit(box, I, s) {
      const byId = new Map(I.entries.map((e) => [e.id, e]));
      const curIds = I.cur >= 0 && I.units[I.cur] ? new Set(I.units[I.cur].ids) : new Set();
      const tpl = ['20px', 'fit-content(240px)', '82px', ...I.cols.map((col) => COL_W[col.kind]), '26px', 'minmax(0, 1fr)'].join(' '); // the last one only takes what's left over
      const missing = I.entries.filter((e) => e.init == null).length;
      const npcMissing = I.entries.filter((e) => !e.pc && e.init == null).length;

      // ---- top: preparing / the fight ----
      // (Prototype 7) one button: Options → Initiative has the TV, the round, sorting and the phones
      const opts = h('button', { class: 'icon-btn', 'aria-label': 'Initiative options', 'data-tip': 'Options: on the table or hidden, what it shows, the round, sorting', onclick: () => App.openOptions('init') }, iconEl('settings'));
      const hid = I.show ? null : h('small', { class: 'ini-offtv', 'data-tip': 'The players don\'t see the turn order (Options → Initiative)' }, iconEl('eye-off'), 'not on the table');
      let top;
      if (!I.running) {
        top = h('div', { class: 'ini-top' },
          h('span', { class: 'grow ini-status' }, h('b', {}, 'Getting ready'), h('small', {}, missing ? ` · ${missing} without a number` : ` · ${I.entries.length} in the list`)),
          hid, opts,
          c().btn('Start the fight', 'swords', () => cmd('init.start', {}).then((r) => { if (r && r.ok) toast('Round 1. Next turn: Enter'); else if (r && r.error) toast(r.error, { kind: 'error' }); }), { kind: 'primary', tip: 'Round 1 begins with the first in the list' }));
      } else {
        const u = I.units[I.cur];
        top = h('div', { class: 'ini-top run' },
          h('span', { class: 'ini-round' }, h('small', {}, 'Round'), h('b', {}, String((s.combat && s.combat.n) || 1))),
          h('span', { class: 'grow ellipsis ini-now' }, u ? u.name : ''),
          hid, opts,
          c().btn('', 'player-skip-back', () => cmd('init.prev'), { tip: 'Back one turn' }),
          c().btn('Next', 'player-track-next', () => ctx.nextTurn(), { kind: 'primary', key: 'Enter', tip: 'Next turn. After the last one a new round starts' }),
          h('button', { class: 'icon-btn danger', 'aria-label': 'End the fight', 'data-tip': 'End the fight', onclick: () => cmd('init.end').then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore') })) }, iconEl('player-stop')));
      }

      // ---- toolbar ----
      const rollAll = c().btn('Roll enemies', 'dice', () => cmd('init.roll', {}).then((r) => { if (r && !r.ok && r.error) toast(r.error); }), { kind: 'small', tip: 'd20 + bonus for every enemy without a number (a group rolls once)' });
      rollAll.disabled = !npcMissing;
      const sortBtn = c().btn('Sort', 'sort-descending', () => cmd('init.sort'), { kind: 'small', tip: 'Highest first. Ties: the higher bonus, then the players' });
      const tools = h('div', { class: 'ini-tools' },
        c().btn('Enemy', 'plus', () => enemyDialog(), { kind: 'small', tip: 'Enemies without a token: name, how many, bonus, AC and HP' }),
        playerBtn(I),
        rollAll, sortBtn,
        h('span', { class: 'grow' }),
        c().btn('Column', 'column-insert-right', (e) => { const r = e.currentTarget.getBoundingClientRect(); colAddMenu(I, r.left, r.bottom + 4); }, { kind: 'small ghost', tip: 'HP, AC, conditions, notes or your own' }));

      // ---- the list ----
      const table = h('div', { class: 'ini-table', role: 'list', style: `grid-template-columns:${tpl}` });
      const head = h('div', { class: 'ini-row ini-head' },
        h('span'), h('span', {}, 'Name'), h('span', { class: 'ini-c' }, 'Init'),
        ...I.cols.map((col) => h('button', { class: 'ini-colhead', 'data-tip': `${col.name}: click to rename, move or remove`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); colMenu(I, col, r.left, r.bottom + 4); } }, iconEl(COL_ICON[col.kind]), h('span', { class: 'ellipsis' }, col.name))),
        h('span'));
      table.append(head);
      for (const u of I.units) {
        const list = u.ids.map((id) => byId.get(id)).filter(Boolean);
        if (u.gid) {
          table.append(groupBar(I, u, list, tpl, curIds.has(list[0].id)));
          for (const e of list) table.append(entryRow(I, e, tpl, curIds.has(e.id), true));
        } else table.append(entryRow(I, list[0], tpl, curIds.has(list[0].id), false));
      }
      if (!I.entries.length) table.append(c().hint('Nobody yet. Players come from the campaign page, enemies from tokens or + Enemy.'));

      // ---- under the list ----
      const foot = h('div', { class: 'ini-foot' });
      if (I.fresh && I.fresh.length) {
        foot.append(h('div', { class: 'ini-note' }, iconEl('user-plus'), h('span', { class: 'grow ellipsis' }, `New on the map: ${I.fresh.map((t) => t.name).join(', ')}`),
          h('button', { class: 'link-btn', onclick: () => cmd('init.addTokens', {}) }, I.fresh.length > 1 ? 'Add them' : 'Add')));
      }
      const down = I.entries.filter((e) => !e.pc && e.down).length;
      if (down) foot.append(h('div', { class: 'ini-note' }, iconEl('skull'), h('span', { class: 'grow' }, `${down} defeated`),
        h('button', { class: 'link-btn', onclick: () => cmd('init.remove', { defeated: true }).then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore') })) }, 'Remove the defeated')));

      if (!I.running && I.entries.length) foot.append(h('div', { class: 'ini-note quiet' }, h('span', { class: 'grow' }), h('button', { class: 'link-btn', 'data-tip': 'Empties the list; players and this map\'s tokens come back fresh', onclick: () => cmd('init.clear').then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore') })) }, 'Start over')));
      box.append(top, tools, table);
      if (foot.children.length) box.append(foot);
    }

    // ---- one fighter ----
    function entryRow(I, e, tpl, cur, member) {
      const row = h('div', { class: `ini-row ${cur ? 'cur' : ''} ${e.pc ? 'pc' : ''} ${e.hidden ? 'hid' : ''} ${e.down ? 'down' : ''} ${member ? 'member' : ''}`, role: 'listitem', dataset: { id: e.id, group: e.group || '' } });
      const grip = h('span', { class: 'ini-grip', 'aria-label': `Move ${e.name}`, 'data-tip': 'Drag to change the order' }, iconEl('grip-vertical'));
      grip.addEventListener('pointerdown', (ev) => dragRow(ev, { id: e.id }, row));
      const icon = e.down ? (e.pc ? 'heart-broken' : 'skull') : e.pc ? 'user-check' : 'user';
      const name = h('button', { class: 'ini-name', 'data-tip': e.down && e.pc ? `${e.name} is at 0 HP: death saves on their turn` : `${e.name}: click for more`, onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); entryMenu(I, e, r.left, r.bottom + 4); } },
        iconEl(icon, `ini-ico ${icon}`), h('span', { class: 'ellipsis' }, e.name), e.hidden ? iconEl('eye-off', 'ini-hid') : null);
      const cells = [grip, name, member ? h('span', { class: 'ini-c ini-shared', 'data-tip': 'The group shares one initiative' }, '·') : initCell(I, e, null)];
      for (const col of I.cols) cells.push(colCell(I, e, col));
      cells.push(h('button', { class: 'icon-btn ini-x', 'aria-label': `Take ${e.name} out`, 'data-tip': 'Take out of the turn order', onclick: () => cmd('init.remove', { id: e.id }).then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore'), ms: 4000 })) }, iconEl('x')));
      row.append(...cells);
      return row;
    }
    // a group: one bar with the shared initiative, the members below it
    function groupBar(I, u, list, tpl, cur) {
      const lead = list[0];
      const row = h('div', { class: `ini-row ini-gbar ${cur ? 'cur' : ''} ${u.out ? 'down' : ''}`, dataset: { gid: u.gid } });
      const grip = h('span', { class: 'ini-grip', 'aria-label': `Move ${u.name}`, 'data-tip': 'Drag to move the whole group' }, iconEl('grip-vertical'));
      grip.addEventListener('pointerdown', (ev) => dragRow(ev, { gid: u.gid }, row));
      row.append(grip,
        h('button', { class: 'ini-name', 'data-tip': 'They share one turn: click for more', onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); groupMenu(I, u, list, r.left, r.bottom + 4); } },
          iconEl(u.out ? 'skull' : 'users'), h('span', { class: 'ellipsis' }, u.name), /×\d+$/.test(u.name) ? null : h('small', { class: 'ini-count' }, `${list.length}`)),
        initCell(I, lead, u.gid),
        h('span', { class: 'ini-gfill', style: `grid-column: span ${I.cols.length + 1}` }));
      return row;
    }
    // the initiative field, and the die for enemies
    function initCell(I, e, gid) {
      const key = gid ? `g:${gid}` : e.id;
      const tip = e.roll ? `Rolled ${e.roll.d20} ${sgn(e.roll.bonus)}` : null;
      const num = h('input', { type: 'text', inputmode: 'numeric', class: `ini-num ${e.roll && e.roll.d20 === 20 ? 'nat20' : e.roll && e.roll.d20 === 1 ? 'nat1' : ''}`, value: e.init ?? '', placeholder: '–', 'aria-label': `Initiative of ${e.name}`, 'data-tip': tip, dataset: { f: `init:${key}` }, spellcheck: 'false' });
      const commit = (jump) => {
        const v = numOrNull(num.value);
        const same = v === (e.init ?? null);
        if (jump) { // the next one without a number gets the keyboard
          const fields = [...document.querySelectorAll('.fp[data-id="init"] .ini-num')];
          const next = fields.slice(fields.indexOf(num) + 1).concat(fields.slice(0, fields.indexOf(num))).find((f) => f.value === '' && f !== num);
          iniFocus = next ? { f: next.dataset.f } : null;
          if (same && next) { next.focus(); iniFocus = null; }
          if (!next) num.blur();
        }
        if (!same) cmd('init.set', gid ? { gid, init: v } : { id: e.id, init: v });
      };
      num.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(true); } else if (ev.key === 'Escape') { num.value = e.init ?? ''; num.blur(); } });
      num.addEventListener('change', () => commit(false));
      num.addEventListener('focus', () => num.select());
      const die = e.pc ? h('span', { class: 'ini-die-pad' })
        : h('button', { class: 'icon-btn ini-die', 'aria-label': `Roll for ${e.name}`, 'data-tip': `Roll d20 ${sgn(e.bonus || 0)}`, onclick: () => cmd('init.roll', { id: e.id }) }, iconEl('dice'));
      return h('span', { class: 'ini-c ini-initcell' }, num, die);
    }
    // 4.0.1: Enter in a column: the same column one row down gets the keyboard (the last row lets go)
    const colNext = (inp, colId) => {
      const all = [...document.querySelectorAll('.fp[data-id="init"] input[data-f]')].filter((x) => x.dataset.f.endsWith(`:${colId}`));
      const n = all[all.indexOf(inp) + 1];
      if (n) n.focus(); else inp.blur();
    };
    // one cell of a column
    function colCell(I, e, col) {
      const v = e.vals[col.id];
      const f = `col:${e.id}:${col.id}`;
      const set = (val) => cmd('init.set', { id: e.id, vals: { [col.id]: val } });
      if (col.kind === 'cond') {
        const cell = h('span', { class: 'ini-cond' });
        for (const t of v || []) cell.append(h('button', { class: 'ini-chip', 'data-tip': `${t}: click to take it off`, onclick: () => set((v || []).filter((x) => x !== t)) }, t));
        cell.append(h('button', { class: 'icon-btn ini-chip-add', 'aria-label': `Conditions of ${e.name}`, 'data-tip': 'Add a condition',
          onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, CONDITIONS.map((t) => ({ icon: 'tag', label: t, checked: (v || []).includes(t), action: () => set((v || []).includes(t) ? v.filter((x) => x !== t) : [...(v || []), t]) }))); } }, iconEl('plus')));
        return cell;
      }
      if (col.kind === 'hp') {
        const text = v ? `${v.cur ?? '?'}${v.max != null ? `/${v.max}` : ''}` : '';
        const hurt = v && v.max ? (v.cur <= 0 ? 'zero' : v.cur <= v.max / 2 ? 'hurt' : '') : v && v.cur <= 0 ? 'zero' : '';
        const inp = h('input', { type: 'text', class: `ini-in ini-hp ${hurt}`, value: text, placeholder: '–', 'aria-label': `HP of ${e.name}`, 'data-tip': 'HP: type 12, 12/20 (with the maximum), -7 for damage, +5 for healing', dataset: { f }, spellcheck: 'false' });
        inp.addEventListener('focus', () => inp.select());
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); colNext(inp, col.id); } else if (ev.key === 'Escape') { inp.value = text; inp.blur(); } });
        inp.addEventListener('change', () => {
          const t = inp.value.replace(/\s+/g, '').replace('−', '-');
          let m;
          if (t === '') set({ cur: null, max: null });
          else if ((m = /^([+-])(\d+)$/.exec(t))) set({ delta: (m[1] === '-' ? -1 : 1) * Number(m[2]) });
          else if ((m = /^(-?\d+)\/(\d+)$/.exec(t))) set({ cur: Number(m[1]), max: Number(m[2]) });
          else if ((m = /^\/(\d+)$/.exec(t))) set({ max: Number(m[1]) });
          else if ((m = /^(\d+)$/.exec(t))) set(v && v.max != null ? { cur: Number(m[1]) } : Number(m[1]) > 0 ? { cur: Number(m[1]), max: Number(m[1]) } : { cur: 0 });
          else { inp.value = text; toast('HP: a number, 12/20, -7 or +5'); }
        });
        return inp;
      }
      const numeric = col.kind === 'ac' || col.kind === 'num';
      const inp = h('input', { type: 'text', inputmode: numeric ? 'numeric' : null, class: `ini-in ${numeric ? 'num' : ''}`, value: v ?? '', placeholder: numeric ? '–' : '', 'aria-label': `${col.name} of ${e.name}`, dataset: { f }, spellcheck: 'false' });
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); colNext(inp, col.id); } else if (ev.key === 'Escape') { inp.value = v ?? ''; inp.blur(); } });
      inp.addEventListener('change', () => set(numeric ? numOrNull(inp.value) : inp.value));
      return inp;
    }

    // ---- menus ----
    function entryMenu(I, e, x, y) {
      const items = [];
      if (I.running && !(I.units[I.cur] && I.units[I.cur].ids.includes(e.id))) items.push({ icon: 'player-play', label: 'Make it their turn', action: () => cmd('init.update', { turn: e.id }) });
      items.push({ icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText(e.pc ? 'Rename the player (everywhere)' : 'Rename', e.name); if (n) { const r = await cmd('init.set', { id: e.id, name: n }); if (r && r.error) toast(r.error, { kind: 'error' }); } } });
      if (!e.pc) {
        if (!e.group) items.push({ icon: 'dice', label: `Initiative bonus: ${sgn(e.bonus || 0)} …`, action: () => askBonus(e.name, e.bonus, (b) => cmd('init.set', { id: e.id, bonus: b })) });
        items.push(e.tokHidden ? { icon: 'eye-off', label: 'Hidden on the map', disabled: true, action: () => {} }
          : { icon: e.hidden ? 'eye' : 'eye-off', label: e.hidden ? 'Show to the players' : 'Hide from the players', action: () => cmd('init.set', { id: e.id, hidden: !e.hidden }) });
        // 4.1: the player screen shows "??" and a silhouette until the GM names them
        items.push({ icon: e.shown ? 'user-question' : 'user', label: e.shown ? 'Player screen: back to "??"' : 'Player screen: show name and picture', action: () => cmd('init.set', { id: e.id, shown: !e.shown }) });
      }
      items.push('-');
      if (e.group) items.push({ icon: 'users-minus', label: 'Leave the group', action: () => cmd('init.ungroup', { id: e.id }) });
      else {
        // the same kind (Goblin 1, Goblin 2 …) without a group of their own
        const kin = I.entries.filter((x) => x.id !== e.id && !x.group && !x.pc === !e.pc && baseOf(x.name).toLowerCase() === baseOf(e.name).toLowerCase());
        if (kin.length) items.push({ icon: 'users-group', label: `Make a group of all ${baseOf(e.name)} (${kin.length + 1})`, action: () => cmd('init.group', { ids: [e.id, ...kin.map((x) => x.id)] }).then((r) => r && r.ok && toast(r.label)) });
        const ui0 = I.units.findIndex((u) => u.ids.includes(e.id));
        const below = I.units[ui0 + 1];
        if (below) items.push({ icon: 'link', label: `Make a group with ${below.name}`, action: () => cmd('init.group', { ids: [e.id, ...below.ids] }).then((r) => r && r.ok && toast(r.label)) });
      }
      if (!e.pc) {
        const hpCol = I.cols.find((col) => col.kind === 'hp'); const acCol = I.cols.find((col) => col.kind === 'ac');
        items.push({ icon: 'copy', label: `One more ${baseOf(e.name)}`, action: () => cmd('init.add', { name: baseOf(e.name), bonus: e.bonus, ac: acCol ? e.vals[acCol.id] : null, hp: hpCol && e.vals[hpCol.id] ? e.vals[hpCol.id].max : null, hidden: e.hidden }) });
      }
      items.push('-', { icon: 'trash', label: 'Take out of the turn order', danger: true, action: () => cmd('init.remove', { id: e.id }).then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore') })) });
      openMenu(x, y, items);
    }
    function groupMenu(I, u, list, x, y) {
      const lead = list[0];
      const hidden = list.every((e) => e.hidden);
      const items = [];
      if (I.running && I.units[I.cur] !== u && !(I.units[I.cur] && I.units[I.cur].gid === u.gid)) items.push({ icon: 'player-play', label: 'Make it their turn', action: () => cmd('init.update', { turn: lead.id }) });
      items.push({ icon: 'pencil', label: 'Name the group …', action: async () => { const n = await askText('Name the group', (I.groups[u.gid] && I.groups[u.gid].name) || '', { placeholder: u.name }); if (n != null) cmd('init.set', { gid: u.gid, name: n }); } });
      if (!lead.pc) {
        items.push({ icon: 'dice', label: `Initiative bonus: ${sgn(lead.bonus || 0)} …`, action: () => askBonus(u.name, lead.bonus, (b) => cmd('init.set', { gid: u.gid, bonus: b })) });
        items.push({ icon: hidden ? 'eye' : 'eye-off', label: hidden ? 'Show them to the players' : 'Hide them from the players', action: () => cmd('init.set', { gid: u.gid, hidden: !hidden }) });
        const shown = list.some((x) => x.shown);
        items.push({ icon: shown ? 'user-question' : 'user', label: shown ? 'Player screen: back to "??"' : 'Player screen: show name and picture', action: () => cmd('init.set', { gid: u.gid, shown: !shown }) });
      }
      items.push('-', { icon: 'users-minus', label: 'Split the group', action: () => cmd('init.ungroup', { gid: u.gid }) },
        { icon: 'trash', label: `Take all ${list.length} out`, danger: true, action: () => cmd('init.remove', { gid: u.gid }).then((r) => r && r.ok && toast(r.label, { undo: () => cmd('init.restore') })) });
      openMenu(x, y, items);
    }
    async function askBonus(name, now, done) {
      const t = await askText(`Initiative bonus of ${name}`, String(now || 0), { placeholder: '+2' });
      if (t == null) return;
      const n = numOrNull(String(t).replace('+', '').replace('−', '-'));
      if (n == null) { toast('A number, like 2 or -1'); return; }
      done(n);
    }
    // Prototype 6: a player back into the turn order (one taken out earlier), also while the fight runs
    function playerBtn(I) {
      const out = I.out || [];
      const b = c().btn('Player', 'plus', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const party = (S().campaign && S().campaign.party) || [];
        openMenu(r.left, r.bottom + 4, [
          ...out.map((n) => ({ icon: 'user', label: n, action: () => cmd('init.addPc', { name: n }).then((x) => { if (x && x.ok && x.label) toast(x.label, { undo: () => cmd('init.restore') }); else if (x && x.error) toast(x.error, { kind: 'error' }); }) })),
          ...(out.length ? ['-'] : [{ icon: 'check', label: 'Everyone in the party is in the list', disabled: true }, '-']),
          { icon: 'user-plus', label: 'A new player for the party …', action: async () => { const n = await askText('A new player', '', { ok: 'Add', placeholder: 'Their character\'s name' }); if (n) cmd('party.set', { names: [...party, n] }); } },
        ]);
      }, { kind: 'small', tip: out.length ? `Back into the turn order: ${out.join(', ')}` : 'Players of the party who are not in the list; a new player' });
      if (out.length) b.classList.add('has-out');
      return b;
    }
    function colAddMenu(I, x, y) {
      openMenu(x, y, COL_PRESETS.map((pr) => ({
        icon: COL_ICON[pr.kind], label: pr.label, disabled: !['num', 'text'].includes(pr.kind) && I.cols.some((col) => col.kind === pr.kind),
        action: async () => {
          let name = null;
          if (pr.kind === 'num' || pr.kind === 'text') { name = await askText('Name of the column', '', { ok: 'Add', placeholder: pr.kind === 'num' ? 'Slots, Legendary …' : 'Concentration on …' }); if (!name) return; }
          const r = await cmd('init.col', { add: { kind: pr.kind, name } });
          if (r && !r.ok && r.error) toast(r.error);
        },
      })));
    }
    function colMenu(I, col, x, y) {
      const i = I.cols.indexOf(col);
      openMenu(x, y, [
        { icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText('Rename the column', col.name); if (n) cmd('init.col', { rename: { id: col.id, name: n } }); } },
        { icon: 'chevron-left', label: 'Move left', disabled: i <= 0, action: () => cmd('init.col', { move: { id: col.id, by: -1 } }) },
        { icon: 'chevron-right', label: 'Move right', disabled: i >= I.cols.length - 1, action: () => cmd('init.col', { move: { id: col.id, by: 1 } }) },
        '-',
        { icon: 'trash', label: 'Remove the column', danger: true, action: () => cmd('init.col', { remove: col.id }) },
      ]);
    }

    // ---- + Enemy ----
    function enemyDialog() {
      const foes = (S().campaign && S().campaign.foes) || [];
      const field = (label, el) => h('label', { class: 'ini-field' }, h('span', {}, label), el);
      const name = h('input', { type: 'text', placeholder: 'Goblin', spellcheck: 'false', 'aria-label': 'Name', list: 'ini-foes' });
      const count = h('input', { type: 'number', min: 1, max: 20, value: 1, 'aria-label': 'How many' });
      const bonus = h('input', { type: 'number', min: -10, max: 20, placeholder: '+0', 'aria-label': 'Initiative bonus' });
      const ac = h('input', { type: 'number', min: 0, max: 40, placeholder: '–', 'aria-label': 'AC' });
      const hp = h('input', { type: 'number', min: 0, max: 999, placeholder: '–', 'aria-label': 'HP' });
      const group = h('input', { type: 'checkbox', 'aria-label': 'They share one turn' });
      const hidden = h('input', { type: 'checkbox', 'aria-label': 'Hidden from the players' });
      const groupRow = h('label', { class: 'ini-check' }, group, h('span', {}, 'They share one turn (a group)'));
      const fill = (f) => { name.value = f.name; bonus.value = f.bonus ?? ''; ac.value = f.ac ?? ''; hp.value = f.hp ?? ''; };
      name.addEventListener('input', () => { const f = foes.find((x) => x.name.toLowerCase() === name.value.trim().toLowerCase()); if (f) fill(f); });
      const syncGroup = () => { groupRow.hidden = !(Number(count.value) > 1); };
      count.addEventListener('input', syncGroup);
      syncGroup();
      const known = foes.length ? h('div', { class: 'ini-foes' }, h('span', { class: 'ctl-label' }, 'Used before'),
        ...foes.slice(0, 14).map((f) => h('button', { type: 'button', class: 'ini-chip', 'data-tip': `${f.name}: bonus ${sgn(f.bonus || 0)}${f.ac != null ? `, AC ${f.ac}` : ''}${f.hp != null ? `, HP ${f.hp}` : ''}`, onclick: () => { fill(f); count.focus(); count.select(); } }, f.name))) : null;
      const form = h('form', { class: 'ini-enemy', onsubmit: async (ev) => {
        ev.preventDefault();
        if (!name.value.trim()) { name.focus(); return; }
        const r = await cmd('init.add', { name: name.value.trim(), count: Number(count.value) || 1, bonus: numOrNull(bonus.value) || 0, ac: numOrNull(ac.value), hp: numOrNull(hp.value), group: group.checked, hidden: hidden.checked });
        if (r && r.ok) { dlg.close(); toast(r.label); } else if (r && r.error) toast(r.error, { kind: 'error' });
      } },
      h('datalist', { id: 'ini-foes' }, ...foes.map((f) => h('option', { value: f.name }))),
      h('div', { class: 'ini-fields' }, field('Name', name), field('How many', count)),
      h('div', { class: 'ini-fields' }, field('Initiative bonus', bonus), field('AC', ac), field('HP', hp)),
      groupRow,
      h('label', { class: 'ini-check' }, hidden, h('span', {}, 'Hidden from the players (not in the turn order on the table)')),
      known,
      h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, iconEl('plus'), 'Add')));
      const dlg = UI.dialog('Add enemies', form);
      dlg.el.classList.add('ini-dlg');
      name.focus();
    }

    // ---- drag and drop: the grip moves a fighter (or a whole group); the turn stays where it is ----
    function dragRow(ev, what, rowEl) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const table = rowEl.closest('.ini-table');
      const scroller = rowEl.closest('.fp-body');
      const all = [...table.querySelectorAll('.ini-row[data-id], .ini-row[data-gid]')];
      const moving = what.gid ? all.filter((r) => r.dataset.gid === what.gid || r.dataset.group === what.gid) : [rowEl];
      for (const r of moving) r.classList.add('dragging');
      const line = h('div', { class: 'ini-drop' });
      table.append(line);
      let before = null; let moved = false;
      const y0 = ev.clientY;
      const at = (cy) => {
        const cands = all.filter((r) => r.dataset.id && !moving.includes(r));
        let target = null;
        for (const r of cands) { const b = r.getBoundingClientRect(); if (cy < b.top + b.height / 2) { target = r; break; } }
        before = target ? target.dataset.id : null;
        // in front of a group's first member: the line goes above the group's bar
        let mark = target;
        if (target && target.dataset.group) { const bar = table.querySelector(`.ini-gbar[data-gid="${CSS.escape(target.dataset.group)}"]`); if (bar && bar.nextElementSibling === target) mark = bar; }
        const tb = table.getBoundingClientRect();
        const last = cands[cands.length - 1];
        const yy = mark ? mark.getBoundingClientRect().top : last ? last.getBoundingClientRect().bottom : tb.bottom;
        line.style.top = `${yy - tb.top + table.scrollTop - 1}px`;
        line.classList.toggle('in', !!(target && target.dataset.group && mark === target)); // joins that group
      };
      const move = (e) => {
        if (!moved && Math.abs(e.clientY - y0) < 3) return;
        moved = true;
        line.classList.add('on');
        at(e.clientY);
        if (scroller) { const sb = scroller.getBoundingClientRect(); if (e.clientY < sb.top + 24) scroller.scrollTop -= 12; else if (e.clientY > sb.bottom - 24) scroller.scrollTop += 12; }
      };
      const up = (e) => {
        removeEventListener('pointermove', move, true);
        removeEventListener('pointerup', up, true);
        removeEventListener('pointercancel', up, true);
        for (const r of moving) r.classList.remove('dragging');
        line.remove();
        if (!moved || e.type === 'pointercancel') return;
        cmd('init.move', what.gid ? { gid: what.gid, before } : { id: what.id, before });
      };
      addEventListener('pointermove', move, true);
      addEventListener('pointerup', up, true);
      addEventListener('pointercancel', up, true);
    }

    return { buildTalkPop, buildToolbox, openPanel, togglePanel, talkToggle, strikeNow, loadLib, PANELS, PANEL_TIPS, panelInfo, running };
  }

  return { create };
})();
