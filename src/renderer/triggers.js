// I7 (Glinn): Triggers. A named list of steps a click runs: a conversation, handouts, a snapshot, the time of day, the
// weather, a screen effect, a group of lights, room lights, a sound, fight music, a Spotify mood, doors, a revealed
// area, hidden tokens shown, a fight, a countdown, a wait. Kept with the map (map.triggers, mapstate.js); run by
// main.js (trigger.run): the map's part is one undo step, and the message's Undo also puts back the conversation, the
// handouts, the fight music, a countdown and the turn order.
// Toolbox → Triggers lists the map's triggers (Run, ⋯); Change … shows the steps (Add step ▸, a step opens to its few
// choices). A trigger can stand on the map as a mark only the GM sees (a click runs it) and on the Hotbar.
// Fires only on a click: never on its own.
'use strict';

const Triggers = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const ts = window.ts;

  // the kinds of step: name, icon, group in Add step ▸
  const KINDS = [
    ['Story', [['talk', 'Conversation', 'messages'], ['handout', 'Handout', 'script']]],
    ['Scene', [['snap', 'Snapshot', 'camera'], ['mood', 'Time of day', 'sun-moon'], ['weather', 'Weather', 'cloud-rain'], ['moment', 'Screen effect', 'flare']]],
    ['Lights · sound', [['lights', 'Light group', 'bulb'], ['room', 'Room lights', 'home'], ['sound', 'Sound', 'volume'], ['music', 'Fight music', 'music'], ['spotify', 'Spotify mood', 'brand-spotify']]],
    ['Map', [['doors', 'Doors', 'door'], ['reveal', 'Reveal an area', 'eye'], ['tokens', 'Hidden tokens', 'ghost'], ['fight', 'Start the fight', 'swords'], ['timer', 'Countdown', 'hourglass']]],
    ['Flow', [['wait', 'Wait', 'clock']]],
  ];
  const KIND = Object.fromEntries(KINDS.flatMap(([, l]) => l.map(([k, label, icon]) => [k, { label, icon }])));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const NEW = {
    talk: { cast: [], mode: 'replace' }, handout: { path: null, to: 'table' }, snap: { snap: null }, mood: { mood: 'night' }, weather: { name: 'Rain' },
    moment: { id: null }, lights: { group: '', on: true }, room: { scene: null }, sound: { path: null }, music: { on: true }, spotify: { mood: null },
    doors: { ids: [], open: true }, reveal: { rings: [] }, tokens: { ids: [], hidden: false }, fight: { ids: [] }, timer: { seconds: 60 }, wait: { s: 2 },
  };

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const map = () => (S() && S().map) || null;
    const list = () => ((map() && map().triggers) || []);
    const trig = (id) => list().find((x) => x.id === id) || null;
    const isOn = (id) => !!(S() && (S().trigOn || []).includes(id)); // (XA2: it ran and can be taken back: the next click does that)

    // ---------- running one ----------
    async function run(id, mapId) {
      const m = mapId || (S() && S().editMapId);
      // (Glinn: a portrait from a trigger came in with hard edges and too quick) whether each portrait has its own
      // transparent edges, found out as a click in the Conversation finds out: one without gets the soft oval edge
      const mp = ((S() && S().campaign && S().campaign.chapters) || []).flatMap((ch) => ch.maps).find((x) => x.id === m);
      const tt = ((mp && mp.triggers) || list()).find((x) => x.id === id);
      const alphas = {};
      for (const s of (tt ? tt.steps : []).filter((x) => x.kind === 'talk')) for (const c of s.cast) if (!(c.path in alphas)) alphas[c.path] = await ctx.hasAlpha({ path: c.path });
      const r = await cmd('trigger.run', { id, mapId: m, alphas });
      if (r && r.ok && r.back) toast(r.label); // (XA2: clicked again: taken back)
      else if (r && r.ok) toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) });
      else if (r && r.error) toast(r.error, { kind: 'error' });
      return r;
    }

    // ---------- what each step says, in one line ----------
    const lib = { list: [], at: 0 };
    async function loadLib() { if (Date.now() - lib.at < 5000) return; lib.at = Date.now(); try { lib.list = await ts.library('list'); } catch { lib.list = []; } ctx.refresh(); }
    const nameOfPath = (p) => (p ? String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : '');
    const snapOf = (id) => ((map() && map().snaps) || []).find((x) => x.id === id) || null;
    const groupsOf = () => [...new Set(((map() && map().fx) || []).filter((f) => f.group && FXDATA.isLight(f)).map((f) => f.group))].sort();
    function sub(s) {
      switch (s.kind) {
        case 'talk': return s.cast.length ? `${s.cast.map((c) => c.name || nameOfPath(c.path)).join(', ')}${s.mode === 'add' ? ' · added' : ''}` : 'nobody yet';
        case 'handout': return s.path ? `${s.name || nameOfPath(s.path)} · ${s.to === 'phones' ? 'to the phones' : 'to the table'}` : 'none picked yet';
        case 'snap': { const x = snapOf(s.snap); return x ? x.name : 'none picked yet'; }
        case 'mood': { const d = FXDATA.MOODS.find((x) => x.id === s.mood); return d ? d.label : s.mood; }
        case 'weather': return s.name;
        case 'moment': { const d = typeof Moments === 'object' && Moments.BY[s.id]; return d ? d.label : 'none picked yet'; }
        case 'lights': return s.group ? `${s.group} · ${s.on === 'toggle' ? 'switch' : s.on ? 'on' : 'off'}` : 'no group picked yet';
        case 'room': return s.name || (s.scene ? s.scene : 'none picked yet');
        case 'sound': return s.path ? (s.name || nameOfPath(s.path)) : 'none picked yet';
        case 'music': return s.on ? 'on' : 'off';
        case 'spotify': return s.name || (s.mood ? s.mood : 'none picked yet');
        case 'doors': return s.ids.length ? `${plural(s.ids.length, 'door')} · ${s.open ? 'open' : 'close'}` : 'none picked yet';
        case 'reveal': return s.rings.length ? (s.name || 'an area') : 'none picked yet';
        case 'tokens': return s.ids.length ? `${plural(s.ids.length, 'token')} · ${s.hidden ? 'hide' : 'show'}` : 'none picked yet';
        case 'fight': return s.ids.length ? `with ${plural(s.ids.length, 'token')}` : 'with the turn order as it is';
        case 'timer': return `${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, '0')}`;
        case 'wait': return `wait ${s.s} s`;
        default: return '';
      }
    }
    const tokName = (id) => { const l = ((map() && map().layers) || []).find((x) => x.id === id); return l ? `${l.name}${l.n ? ` ${l.n}` : ''}` : null; };

    // ---------- changing one ----------
    const save = (t, steps) => cmd('trigger.update', { id: t.id, steps });
    const setStep = (t, i, patch) => save(t, t.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    // (Glinn: the same every time) the step takes how its portraits look or its handout lies right now (main.js withLook)
    const takeLook = async (t, i, patch) => { if (patch) await setStep(t, i, patch); return cmd('trigger.look', { id: t.id, i }); };
    const menuBelow = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 4]; };
    function addStep(e, t) {
      const [x, y] = menuBelow(e);
      openMenu(x, y, KINDS.flatMap(([head, l]) => [{ header: head }, ...l.map(([k, label, icon]) => ({ icon, label, action: () => { ui.trigOpen = t.steps.length; save(t, [...t.steps, { kind: k, ...structuredClone(NEW[k]) }]); } }))]));
    }
    // a step's few choices
    function detail(t, i, s) {
      const c = ctx.ctl; const box = h('div', { class: 'tg-detail' }); const add = (...k) => box.append(...k.filter(Boolean)); // (append would write a null out)
      const pick = (label, items) => h('button', { class: 'btn small', onclick: (e) => { const [x, y] = menuBelow(e); openMenu(x, y, items.length ? items : [{ header: 'Nothing to pick yet' }]); } }, iconEl('chevron-down'), label);
      const seg = (opts, get, set) => c.seg({ options: opts.map(([value, label]) => ({ value, label })), get, set });
      switch (s.kind) {
        case 'talk':
          add(h('div', { class: 'tg-cast' }, ...s.cast.map((p, k) => h('button', { class: 'tg-face', 'data-tip': `${p.name || nameOfPath(p.path)}: click to take off`, onclick: () => setStep(t, i, { cast: s.cast.filter((_, q) => q !== k) }) },
            h('img', { src: UI.pathToUrl(p.path), alt: '' }))), s.cast.length ? null : h('span', { class: 'hint' }, 'Nobody yet')),
          h('div', { class: 'row' }, h('button', { class: 'btn small', 'data-tip': 'Who stands in the Conversation right now', onclick: () => { const cast = ((S().talk || {}).cast || []).map((p) => ({ path: p.path, name: p.name, alpha: p.alpha !== false })); if (!cast.length) { toast('Nobody is on stage: open a Conversation first'); return; } takeLook(t, i, { cast }); } }, iconEl('users'), 'Take who is on stage now')),
          seg([['replace', 'Replace'], ['add', 'Add to them']], () => s.mode, (v) => setStep(t, i, { mode: v })));
          break;
        case 'handout': loadLib();
          add(pick(s.path ? (s.name || nameOfPath(s.path)) : 'Pick a handout', lib.list.filter((x) => x.cat === 'handouts').slice(0, 80).map((x) => ({ icon: 'script', label: x.name, action: () => takeLook(t, i, { path: x.path, name: x.name, lay: null }) }))),
            seg([['table', 'To the table'], ['phones', 'To the phones']], () => s.to, (v) => setStep(t, i, { to: v })),
            s.path && s.to !== 'phones' ? h('div', { class: 'row' }, h('button', { class: 'btn small', 'data-tip': 'Its place, size and turn on the table right now', onclick: () => takeLook(t, i).then(() => toast('The trigger shows it so from now on')) }, iconEl('pin'), 'Take how it lies now')) : null);
          break;
        case 'snap': add(pick(snapOf(s.snap) ? snapOf(s.snap).name : 'Pick a snapshot', ((map() && map().snaps) || []).map((x) => ({ icon: 'camera', label: x.name, action: () => setStep(t, i, { snap: x.id, name: x.name }) })))); break;
        case 'mood': add(pick(sub(s), FXDATA.MOODS.map((d) => ({ icon: d.icon, label: d.label, action: () => setStep(t, i, { mood: d.id }) })))); break;
        case 'weather': add(pick(s.name, [{ icon: 'sun', label: 'None', action: () => setStep(t, i, { name: 'None' }) }, ...FXDATA.WEATHER.map((w) => ({ icon: w.icon, label: w.label, action: () => setStep(t, i, { name: w.label }) }))])); break;
        case 'moment': add(pick(sub(s), (typeof Moments === 'object' ? Moments.LIST : []).map((d) => ({ icon: d.icon || 'flare', label: d.label, action: () => setStep(t, i, { id: d.id }) })))); break;
        case 'lights':
          add(pick(s.group || 'Pick a group', groupsOf().map((g) => ({ icon: 'bulb', label: g, action: () => setStep(t, i, { group: g }) }))),
            seg([[true, 'On'], [false, 'Off'], ['toggle', 'Switch']], () => s.on, (v) => setStep(t, i, { on: v })),
            groupsOf().length ? null : h('p', { class: 'hint' }, 'No groups yet: pick a light, then Group in its panel.'));
          break;
        case 'room': add(pick(s.name || 'Pick a scene', ((S().lights && S().lights.scenes) || []).map((x) => ({ icon: 'home', label: x.name, action: () => setStep(t, i, { scene: x.id, name: x.name }) })))); break;
        case 'sound': loadLib(); add(pick(s.path ? (s.name || nameOfPath(s.path)) : 'Pick a sound', lib.list.filter((x) => x.cat === 'sounds').slice(0, 120).map((x) => ({ icon: 'volume', label: x.name, action: () => setStep(t, i, { path: x.path, name: x.name }) })))); break;
        case 'music': add(seg([[true, 'On'], [false, 'Off']], () => s.on, (v) => setStep(t, i, { on: v }))); break;
        case 'spotify': add(pick(s.name || 'Pick a mood', ((S().spotify && S().spotify.moods) || []).map((x) => ({ icon: 'brand-spotify', label: x.name || x.id, action: () => setStep(t, i, { mood: x.id, name: x.name || x.id }) })))); break;
        case 'doors': case 'tokens': case 'fight': case 'reveal': {
          const picking = ui.trigPick && ui.trigPick.id === t.id && ui.trigPick.i === i;
          const what = { doors: 'Click doors on the map', tokens: 'Click tokens on the map', fight: 'Click tokens on the map', reveal: 'Click inside a room or a marked area' }[s.kind];
          add(h('div', { class: 'row' }, h('button', { class: `btn small ${picking ? 'primary' : ''}`, onclick: () => { ui.trigPick = picking ? null : { id: t.id, i, kind: s.kind }; ctx.refresh(); } }, iconEl(picking ? 'check' : 'pointer'), picking ? 'Done' : 'Pick on the map')),
            picking ? h('p', { class: 'hint' }, `${what}: a click adds or takes away.`) : null,
            s.kind === 'tokens' || s.kind === 'fight' ? (s.ids.length ? h('p', { class: 'hint' }, s.ids.map(tokName).filter(Boolean).join(', ')) : null) : null,
            s.kind === 'doors' ? seg([[true, 'Open'], [false, 'Close']], () => s.open, (v) => setStep(t, i, { open: v })) : null,
            s.kind === 'tokens' ? seg([[false, 'Show'], [true, 'Hide']], () => s.hidden, (v) => setStep(t, i, { hidden: v })) : null);
          break;
        }
        case 'timer': add(c.stepper({ name: 'Countdown', label: 'How long', get: () => s.seconds, set: (v) => setStep(t, i, { seconds: v }), fmt: (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`, prev: (v) => Math.max(5, v - (v > 60 ? 30 : 5)), next: (v) => Math.min(5999, v + (v >= 60 ? 30 : 5)) })); break;
        case 'wait': add(c.stepper({ name: 'Wait', label: 'Wait', get: () => s.s, set: (v) => setStep(t, i, { s: v }), fmt: (v) => `${v} s`, prev: (v) => Math.max(0.5, v - 0.5), next: (v) => Math.min(30, v + 0.5) })); break;
        default:
      }
      return box;
    }
    // a click on the map while a step is picking: true when it took the click
    function pickAt(clientX, clientY, pt, helpers) {
      const P = ui.trigPick; if (!P) return false;
      const t = trig(P.id); const s = t && t.steps[P.i];
      if (!s) { ui.trigPick = null; return false; }
      const tog = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
      if (s.kind === 'doors') {
        const el = document.elementsFromPoint(clientX, clientY).find((x) => x.classList && x.classList.contains('sv-door'));
        const w = el ? map().walls.find((x) => x.id === el.dataset.id) : helpers.wallNear(pt);
        if (!w) { toast('Click a door', { ms: 1200 }); return true; }
        setStep(t, P.i, { ids: tog(s.ids, w.id) }); return true;
      }
      if (s.kind === 'tokens' || s.kind === 'fight') {
        const l = helpers.tokenUnder(clientX, clientY);
        if (!l) { toast('Click a token', { ms: 1200 }); return true; }
        setStep(t, P.i, { ids: tog(s.ids, l.id) }); return true;
      }
      if (s.kind === 'reveal') {
        const a = helpers.areaAt(pt); const room = a ? null : helpers.roomAt(pt);
        if (!a && !room) { toast('Click inside a room or a marked area', { ms: 1600 }); return true; }
        setStep(t, P.i, { rings: a ? a.rings : room.rings, name: a ? a.name : 'a room' });
        ui.trigPick = null; ctx.refresh(); return true;
      }
      return false;
    }

    // ---------- the panel ----------
    function cardMenu(e, t) {
      const [x, y] = menuBelow(e);
      openMenu(x, y, [
        { icon: 'pencil', label: 'Change …', action: () => { ui.trigEdit = t.id; ui.trigOpen = null; ctx.refresh(); } },
        { icon: 'map-pin', label: t.at ? 'Move its mark on the map' : 'Put on the map', action: () => { ui.trigPlace = t.id; toast('Click the map where its mark goes', { ms: 2200 }); } },
        ...(t.at ? [{ icon: 'x', label: 'Off the map', action: () => cmd('trigger.update', { id: t.id, at: null }) }] : []),
        { icon: 'keyboard', label: 'On the Hotbar', action: () => ctx.hotAdd(hotItem(t)) },
        { icon: 'copy', label: 'Duplicate', action: () => cmd('trigger.duplicate', { id: t.id }) },
        '-',
        { icon: 'trash', label: 'Remove', danger: true, action: async () => { const r = await cmd('trigger.remove', { id: t.id }); if (r && r.ok) toast(r.label || 'Removed', { undo: () => cmd('history.undo', { mapId: r.mapId }) }); } },
      ]);
    }
    const hotItem = (t) => ({ kind: 'trigger', label: t.name.slice(0, 40), icon: 'bolt', ref: { mapId: S().editMapId, id: t.id } });
    function buildList() {
      const box = h('div', { class: 'stack tg-panel' });
      ctx.ctl.bind(() => {
        const sig = JSON.stringify([S().editMapId, list().map((t) => [t.id, t.name, t.steps.map((s) => s.kind), !!t.at, isOn(t.id)]), ui.trigEdit]);
        if (box.dataset.sig === sig) return; box.dataset.sig = sig;
        if (ui.trigEdit && trig(ui.trigEdit)) { box.replaceChildren(...buildEdit(trig(ui.trigEdit))); return; }
        ui.trigEdit = null;
        box.replaceChildren(...[
          h('div', { class: 'tg-sec' }, (map() && map().name) || ''),
          ...list().map((t) => h('div', { class: 'tg-card', dataset: { id: t.id } },
            h('b', { class: 'ellipsis' }, t.name),
            isOn(t.id) ? h('button', { class: 'btn small tg-run on', 'data-tip': 'Take back what it did', onclick: () => run(t.id) }, iconEl('arrow-back-up'), 'Take back')
              : h('button', { class: 'btn small primary tg-run', 'data-tip': 'Run it (again takes it back)', onclick: () => run(t.id) }, iconEl('player-play'), 'Run'),
            h('button', { class: 'icon-btn tg-more', 'aria-label': `More for ${t.name}`, 'data-tip': 'Change, on the map, on the Hotbar …', onclick: (e) => cardMenu(e, t) }, iconEl('dots')),
            h('span', { class: 'tg-steps' }, ...t.steps.filter((s) => s.kind !== 'wait').slice(0, 7).map((s) => iconEl(KIND[s.kind].icon)), h('small', {}, plural(t.steps.filter((s) => s.kind !== 'wait').length, 'step')), t.at ? iconEl('map-pin', 'tg-on-map') : null))),
          list().length ? null : h('p', { class: 'hint' }, 'None on this map yet.'),
          h('button', { class: 'btn wide tg-new', onclick: async () => { const n = await askText('A new trigger', '', { ok: 'Make it', placeholder: 'Ambush at the bridge' }); if (!n) return; const r = await cmd('trigger.add', { name: n }); if (r && r.selected) { ui.trigEdit = r.selected; ui.trigOpen = null; ctx.refresh(); } } }, iconEl('plus'), 'New trigger')].filter(Boolean));
      });
      return box;
    }
    function buildEdit(t) {
      const steps = h('div', { class: 'tg-list' });
      ctx.ctl.bind(() => {
        const tt = trig(t.id); if (!tt) return;
        const sig = JSON.stringify([tt.steps, ui.trigOpen, ui.trigPick, lib.at, S().talk && S().talk.cast.length, groupsOf()]);
        if (steps.dataset.sig === sig) return; steps.dataset.sig = sig;
        let dragFrom = null;
        steps.replaceChildren(...tt.steps.flatMap((s, i) => {
          const open = ui.trigOpen === i;
          // (UI audit VH10) a step is dragged by its grip only (the whole row was the handle), and a line shows where it
          // will land; Esc cancels, as for every drag of this kind
          const unmark = () => { for (const x of steps.querySelectorAll('.drop-here')) x.classList.remove('drop-here'); };
          const row = h('div', { class: `tg-step ${open ? 'open' : ''} ${s.kind === 'wait' ? 'wait' : ''}`, dataset: { i: String(i), kind: s.kind },
            ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; },
            ondragover: (e) => { e.preventDefault(); if (dragFrom != null && dragFrom !== i && !row.classList.contains('drop-here')) { unmark(); row.classList.add('drop-here'); } },
            ondragend: () => { row.draggable = false; dragFrom = null; unmark(); },
            ondrop: (e) => { e.preventDefault(); unmark(); if (dragFrom == null || dragFrom === i) return; const l = tt.steps.slice(); const [x] = l.splice(dragFrom, 1); l.splice(i, 0, x); ui.trigOpen = null; save(tt, l); } },
          iconEl('grip-vertical', 'tg-grip'), h('span', { class: 'tg-ic' }, iconEl(KIND[s.kind].icon)),
          h('button', { class: 'tg-what', onclick: () => { ui.trigOpen = open ? null : i; ui.trigPick = null; steps.dataset.sig = ''; ctx.refresh(); } }, s.kind === 'wait' ? null : h('b', {}, KIND[s.kind].label), h('small', {}, sub(s))),
          h('button', { class: 'icon-btn tg-x', 'aria-label': 'Take this step out', 'data-tip': 'Take this step out', onclick: () => { ui.trigOpen = null; save(tt, tt.steps.filter((_, j) => j !== i)); } }, iconEl('x')));
          const grip = row.querySelector('.tg-grip');
          if (grip) { grip.addEventListener('pointerdown', () => { row.draggable = true; }); grip.addEventListener('pointerup', () => { row.draggable = false; }); }
          return open ? [row, detail(tt, i, s)] : [row];
        }), ...(tt.steps.length ? [] : [h('p', { class: 'hint' }, 'No steps yet.')]));
      });
      return [
        h('div', { class: 'row tg-head' }, h('button', { class: 'btn small ghost', onclick: () => { ui.trigEdit = null; ui.trigPick = null; ctx.refresh(); } }, iconEl('arrow-left'), 'All'),
          h('button', { class: 'tg-name grow', 'data-tip': 'Rename', onclick: async () => { const n = await askText('Rename', t.name, { ok: 'Rename' }); if (n) cmd('trigger.update', { id: t.id, name: n }); } }, h('span', { class: 'ellipsis' }, t.name), iconEl('pencil')),
          h('button', { class: 'btn small primary', onclick: () => run(t.id) }, iconEl('player-play'), 'Run')),
        steps,
        h('button', { class: 'btn wide tg-add', onclick: (e) => addStep(e, trig(t.id)) }, iconEl('plus'), 'Add step', iconEl('chevron-right')),
      ];
    }
    const TIPS = ['A trigger runs its steps with one click: in this panel, on the Hotbar, or its mark on the map (only you see it).',
      'A second click takes back what it did: its handout, portraits, doors, lights, tokens, the time of day, the weather, a countdown. What you did in between stays.',
      'Undo on the message puts everything back as it was before: the map, the conversation, the handouts, the fight music, a countdown and the turn order.',
      'Change …: Add step ▸, then a click on a step opens its choices. Drag a step to move it.',
      'Light groups: pick a light, then Group in its panel.', 'Triggers belong to the map. Nothing fires on its own.'];
    const def = () => ({ id: 'triggers', title: 'Triggers', icon: 'bolt', tips: TIPS, build: () => buildList() });

    // ---------- marks on the map (only on this screen) ----------
    let layer = null; const els = new Map();
    function drawMarks() {
      const v = ctx.view(); if (!v || !v.marks) return;
      if (!layer) { layer = h('div', { class: 'tg-marks' }); }
      if (layer.parentNode !== v.marks) v.marks.appendChild(layer);
      const want = list().filter((t) => t.at);
      for (const [id, el] of els) if (!want.some((t) => t.id === id)) { el.remove(); els.delete(id); }
      for (const t of want) {
        let el = els.get(t.id);
        if (!el) {
          el = h('button', { class: 'tg-mark', dataset: { id: t.id } }, iconEl('bolt'));
          el.addEventListener('pointerdown', (e) => markDown(e, t.id));
          layer.append(el); els.set(t.id, el);
        }
        const p = v.mapToPx(t.at.x, t.at.y);
        el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
        const on = isOn(t.id); el.classList.toggle('on', on); // (XA2: lit while it is on)
        el.dataset.tip = `${t.name}: a click ${on ? 'takes it back' : 'runs it'} · drag to move`;
        el.setAttribute('aria-label', `${on ? 'Take back' : 'Run'} ${t.name}`);
      }
    }
    function markDown(e, id) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const v = ctx.view(); const sx = e.clientX; const sy = e.clientY; let moved = false;
      const el = els.get(id);
      const mv = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) moved = true; if (!moved) return; const r = el.parentNode.getBoundingClientRect(); el.style.left = `${ev.clientX - r.left}px`; el.style.top = `${ev.clientY - r.top}px`; };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        if (moved) { const q = v.toMap(ev.clientX, ev.clientY); cmd('trigger.update', { id, at: { x: q.x, y: q.y } }); } else run(id);
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    }
    // Put on the map: the next click places its mark
    function placeAt(pt) { const id = ui.trigPlace; if (!id) return false; ui.trigPlace = null; cmd('trigger.update', { id, at: { x: pt.x, y: pt.y } }); return true; }

    return { def, run, pickAt, placeAt, drawMarks, hotItem, KINDS, sub };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Triggers;
