// Snapshots (2.1): the map as it is now, saved with one click, played back from a timeline that runs left to right.
// Between two snapshots sits how the next one comes in: a moment, a sound, music, at once or fading (or nothing: it
// just switches). In a snapshot: the picture, assets, films, map sounds, effects and lights, the weather, the light
// (mapstate.js: sceneOf). Not in it: tokens, fog, doors, spell areas, drawings. What the players did stays.
// gm-play.js opens the timeline as a floating panel; the map bar shows which maps have snapshots.
'use strict';

const Snapshots = (() => {
  const { h, iconEl, toast, openMenu, askText, dialog, Thumbs } = UI;
  const ts = window.ts;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const maps = () => (S() && S().campaign ? S().campaign.chapters.flatMap((ch) => ch.maps) : []);
    const mapOf = (id) => maps().find((m) => m.id === id) || null;
    const snapsOf = (id) => (mapOf(id) || {}).snaps || [];
    const find = (id) => { for (const m of maps()) { const s = (m.snaps || []).find((x) => x.id === id); if (s) return { map: m, s }; } return null; };
    // the map the timeline shows: the one picked under "Other maps", else the one open here (opening another map resets it)
    function shownId() {
      const s = S();
      if (ui.snapEdit !== s.editMapId) { ui.snapEdit = s.editMapId; ui.snapMap = null; }
      return ui.snapMap && mapOf(ui.snapMap) ? ui.snapMap : s.editMapId;
    }

    // sounds for the transition: Audio/SFX in the library
    let lib = []; let libAt = 0;
    async function loadLib() {
      if (Date.now() - libAt < 5000) return;
      libAt = Date.now();
      try { lib = await ts.library('list'); } catch { lib = []; }
    }
    const sfx = () => lib.filter((x) => x.cat === 'sounds' && (/^Audio\/SFX\//i.test(x.rel) || /\bsfx\b/i.test(x.rel)));
    let listening = null;
    function listen(p) {
      try { if (listening) listening.pause(); } catch {}
      if (!p) return;
      listening = new Audio(UI.pathToUrl(p));
      listening.volume = 0.8;
      listening.play().catch(() => {});
    }

    // ---------- words for what is in a snapshot ----------
    const fxLabel = (id) => ([...FXDATA.EMITTERS, ...FXDATA.REGIONS].find((x) => x.id === id) || {}).label || id;
    const lightText = (i) => (FXDATA.MOODS.find((m) => m.id === i.mood) || {}).label || (i.dark > 0.02 ? `Darkness ${Math.round(i.dark * 100)} %` : 'Daylight');
    const fxCount = (i) => Object.values(i.fx || {}).reduce((a, b) => a + b, 0);
    function infoLine(i) {
      const n = fxCount(i);
      return [lightText(i), i.weather, n ? plural(n, 'effect') : null, i.lights ? plural(i.lights, 'light') : null, i.assets ? plural(i.assets, 'asset') : null].filter(Boolean).join(' · ');
    }
    function chipsOf(i) {
      return [i.bg ? `Picture: ${i.bg.name}` : 'No picture', `Light: ${lightText(i)}`, i.weather ? `Weather: ${i.weather}` : null,
        ...Object.entries(i.fx || {}).map(([k, n]) => `${fxLabel(k)}${n > 1 ? ` ×${n}` : ''}`),
        i.lights ? plural(i.lights, 'light') : null, i.assets ? plural(i.assets, 'asset') : null,
        ...(i.films || []).map((n) => `Film: ${n}`), (i.sounds || []).length ? `Map sounds: ${i.sounds.join(', ')}` : null].filter(Boolean);
    }
    // the same words for the map as it is now (before it is saved)
    function infoOfMap(m) {
      const tok = new Set(m.layers.filter((l) => l.role === 'token').map((l) => l.id));
      const fx = {}; let lights = 0;
      for (const f of m.fx) {
        if (f.hidden || f.preset === 'party' || (f.attachTo && tok.has(f.attachTo))) continue;
        if (f.kind === 'light') lights++; else fx[f.preset] = (fx[f.preset] || 0) + 1;
      }
      const on = (l) => !l.hidden;
      const wx = m.weather.layers.filter((l) => !l.dying);
      return { bg: m.bg ? { name: m.bg.name } : null, mood: m.light.mood, dark: m.light.darkness, weather: wx.length ? m.weather.name : null, fx, lights,
        assets: m.layers.filter((l) => l.role === 'asset' && on(l)).length, films: m.layers.filter((l) => l.role === 'overlay' && on(l)).map((l) => l.name),
        sounds: m.layers.filter((l) => l.role === 'audio' && on(l) && !l.muted).map((l) => l.name) };
    }
    const moodName = (id) => ((((S().spotify || {}).moods) || []).find((m) => m.id === id) || {}).name;
    // "Explosion" over "+ Pipe burst · at once"
    function transWords(t) {
      if (!t) return null;
      const parts = [t.moment && (Moments.BY[t.moment] || {}).label, t.sound,
        t.music === 'fight' ? 'Fight music' : t.music === 'calm' ? 'Calm music' : t.music === 'mood' ? (moodName(t.mood) || 'Spotify') : null].filter(Boolean);
      const how = t.fade ? 'fades in 10 s' : 'at once';
      return { main: parts[0] || (t.fade ? 'Fade' : 'Switch'), sub: [...parts.slice(1).map((x) => `+ ${x}`), how].join(' · '), all: [...parts, how].join(' + ').replace(/ \+ (at once|fades in 10 s)$/, ' · $1') };
    }

    // ---------- playing ----------
    // F1 – F8 and Next play on the map on the table (when it has snapshots), else on the one open here
    function keysMap() {
      const s = S();
      const live = s.table.open ? mapOf(s.table.liveMapId) : null;
      if (live && (live.snaps || []).length) return live;
      const ed = mapOf(s.editMapId);
      return ed && (ed.snaps || []).length ? ed : null;
    }
    // the map was changed since its snapshot: before the table sees it, ask
    function askSave(at) {
      return new Promise((resolve) => {
        let answered = false;
        const end = (v) => { if (answered) return; answered = true; d.close(); resolve(v); };
        const box = h('div', { class: 'stack' },
          h('p', { class: 'hint' }, `You changed the map since you saved ${at.name}. Switching takes those changes back.`),
          h('div', { class: 'st-actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => end('discard') }, 'Don\'t save'),
            h('span', { class: 'grow' }),
            h('button', { type: 'button', class: 'btn ghost', onclick: () => end('cancel') }, 'Cancel'),
            h('button', { type: 'button', class: 'btn primary', onclick: () => end('save') }, iconEl('device-floppy'), h('span', {}, `Save into ${at.name}`))));
        const d = dialog(`Save changes to '${at.name}'?`, box, { onClose: () => { if (!answered) { answered = true; resolve('cancel'); } } });
        d.el.classList.add('snap-ask');
        setTimeout(() => { const b = d.el.querySelector('.btn.primary'); if (b) b.focus(); }, 0);
      });
    }
    // At the table, after switching away from a snapshot that had changes: the TV shows the new one already, this
    // waits for an answer (it does not close by clicking beside it or with Esc): save them, throw them away, or go back.
    let keepOpen = null;
    function askKeep(r, undo) {
      if (keepOpen) keepOpen.close();
      const u = r.unsaved;
      const what = (u.what || []).length ? u.what.join(', ').replace(/, ([^,]*)$/, ' and $1') : null;
      const close = () => { back.remove(); window.removeEventListener('keydown', guard, true); if (keepOpen && keepOpen.back === back) keepOpen = null; };
      const save = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        close();
        const k = await cmd('snap.keep', { id: u.id });
        if (k && k.ok) toast(k.label, { undo: () => cmd(k.undo.type, k.undo.payload) }); else if (k && k.error) toast(k.error, { kind: 'error' });
      } }, iconEl('device-floppy'), h('span', {}, `Save into ${u.name}`));
      const box = h('div', { class: 'modal snap-keep', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': `Save the changes into ${u.name}?` },
        h('div', { class: 'sk-head' }, iconEl('camera'), h('h2', {}, `Save the changes into ${u.name}?`)),
        h('p', {}, `${r.label} is on the table now. You had changed ${what || 'the map'} since you saved ${u.name}.`),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn ghost', 'data-tip': `${u.name} comes back on the table, with your changes`, onclick: () => { close(); undo(); } }, iconEl('arrow-back-up'), h('span', {}, `Go back to ${u.name}`)),
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn', onclick: close }, 'Throw them away'),
          save));
      const back = h('div', { class: 'modal-back snap-keep-back' }, box);
      // keys stay here until it is answered (Tab, Enter and Space work its buttons)
      const guard = (e) => { if (!back.isConnected) return; if (['Tab', 'Enter', ' ', 'Spacebar'].includes(e.key)) return; e.stopImmediatePropagation(); e.preventDefault(); };
      window.addEventListener('keydown', guard, true);
      document.body.append(back);
      keepOpen = { back, close };
      setTimeout(() => save.focus(), 0);
    }
    // play one (p: { id } | { n } | { next }, quiet: onto the map only, no transition). Leaving a snapshot the map was
    // changed since: in prep it asks first; at the table it never stops the game, it switches and offers to keep them.
    async function go(p, o = {}) {
      const s = S();
      const f = p.id && p.id !== 'next' ? find(p.id) : null;
      const m = f ? f.map : keysMap();
      const at = m ? (m.snaps || []).find((x) => x.at) : null;
      const q = { ...p };
      if (at && at.changed) {
        if (s.table.open && s.table.liveMapId === m.id) q.offerSave = true;
        else {
          const a = await askSave(at);
          if (a === 'cancel') return { ok: false, canceled: true };
          if (a === 'save' && !(await resave(at))) return { ok: false, canceled: true };
        }
      }
      const r = await cmd('snap.play', q);
      if (r && r.ok) {
        const undo = () => cmd('history.undo', { mapId: r.mapId });
        if (r.unsaved) askKeep(r, undo); // 2.5: asks and waits for an answer (a message was easy to miss)
        else toast(r.away ? `${r.label} is on this map; the table still shows its own (T sends this one)` : p.quiet ? `${r.label} is on the map (no transition)` : r.label, { ms: r.away ? 3500 : 2200, undo });
      } else if (r && r.error && !o.silent) toast(r.error, { kind: r.last ? null : 'error' });
      return r;
    }
    const play = (s, o = {}) => go({ id: s.id, quiet: !!o.quiet });
    const playBy = (p) => go(p, { silent: true });

    // ---------- saving ----------
    async function save() {
      const s = S();
      if (!s.map) { toast('Open a map first.'); return; }
      const list = snapsOf(s.map.id);
      const thumb = await ctx.capture();
      if (!list.length) {
        const name = await askText('Name the first snapshot', 'Snapshot 1', { ok: 'Save snapshot', placeholder: 'Pipe intact' });
        if (!name) return;
        done(await cmd('snap.save', { name, thumb }));
        return;
      }
      transDialog({ n: list.length + 1, thumb, info: infoOfMap(s.map) });
    }
    function done(r) {
      if (r && r.ok) { toast(r.label, { ms: 2600 }); ctx.flash(`snap:${r.id}`); } else if (r && r.error) toast(r.error, { kind: 'error' });
    }
    async function resave(s) {
      const f = find(s.id);
      if (f && f.map.id !== S().editMapId) { toast(`Open ${f.map.name} first: the snapshot takes the map as you see it`, { ms: 3200 }); return false; }
      const thumb = await ctx.capture();
      const r = await cmd('snap.resave', { id: s.id, thumb });
      if (r && r.ok) toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) });
      return !!(r && r.ok);
    }
    async function rename(s) {
      const n = await askText('Rename snapshot', s.name);
      if (n) cmd('snap.update', { id: s.id, name: n });
    }
    async function remove(s) {
      closeDetails();
      const r = await cmd('snap.remove', { id: s.id });
      if (r && r.ok) toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) });
    }

    // ---------- the transition: how a snapshot comes in (asked when saving the second one and later) ----------
    function seg(options, get, set) {
      const wrap = h('div', { class: 'seg', role: 'radiogroup' });
      const paint = () => { for (const b of wrap.children) { const on = b.dataset.v === String(get()); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); } };
      for (const o of options) wrap.append(h('button', { type: 'button', class: 'seg-btn', role: 'radio', dataset: { v: String(o.value) }, 'data-tip': o.tip || null, onclick: () => { set(o.value); paint(); } }, o.icon ? iconEl(o.icon) : null, h('span', {}, o.label)));
      paint();
      return wrap;
    }
    // o: { snap } to change one, or { n, thumb, info } to save a new one
    function transDialog(o) {
      loadLib();
      const editing = !!o.snap;
      const T = o.snap && o.snap.trans ? o.snap.trans : {};
      const t = { moment: T.moment || null, sound: T.soundPath || null, music: T.music || 'keep', mood: T.mood || null, fade: !!T.fade };
      const name = h('input', { type: 'text', class: 'st-name', value: editing ? o.snap.name : `Snapshot ${o.n}`, spellcheck: 'false', 'aria-label': 'Name' });
      const moment = h('select', { 'aria-label': 'Screen effect', onchange: () => { t.moment = moment.value || null; } },
        h('option', { value: '' }, 'None'), ...Moments.LIST.filter((d) => d.id !== 'lightning').map((d) => h('option', { value: d.id }, d.label)));
      moment.value = t.moment || '';
      const sound = h('select', { 'aria-label': 'Sound', onchange: () => { t.sound = sound.value || null; } });
      const fillSounds = () => {
        sound.replaceChildren(h('option', { value: '' }, 'None'), ...sfx().map((x) => h('option', { value: x.path }, x.name)));
        if (t.sound && !sfx().some((x) => x.path === t.sound)) sound.append(h('option', { value: t.sound }, (o.snap && o.snap.trans && o.snap.trans.sound) || 'This sound'));
        sound.value = t.sound || '';
      };
      fillSounds();
      if (!lib.length) setTimeout(() => { loadLib().then(fillSounds); }, 0);
      const spo = S().spotify || {};
      const moods = spo.linked ? spo.moods || [] : [];
      const mood = h('select', { 'aria-label': 'Spotify mood', onchange: () => { t.mood = mood.value || null; } }, ...moods.map((m) => h('option', { value: m.id }, m.name)));
      mood.value = t.mood || (moods[0] || {}).id || '';
      const moodRow = h('div', { class: 'st-sub' }, mood);
      const showMood = () => { moodRow.hidden = t.music !== 'mood'; if (t.music === 'mood' && !t.mood) t.mood = mood.value || null; };
      const music = seg([{ value: 'keep', label: 'Keep' }, { value: 'fight', label: 'Fight', tip: 'The chapter\'s fight music' }, { value: 'calm', label: 'Calm', tip: 'Fight music off: the ambience again' },
        ...(moods.length ? [{ value: 'mood', label: 'Spotify', icon: 'brand-spotify', tip: 'A Spotify mood' }] : [])], () => t.music, (v) => { t.music = v; showMood(); });
      showMood();
      const change = seg([{ value: 'once', label: 'At once' }, { value: 'fade', label: 'Light and weather fade (10 s)' }], () => (t.fade ? 'fade' : 'once'), (v) => { t.fade = v === 'fade'; });
      const row = (icon, label, ctl) => [h('span', { class: 'st-label' }, iconEl(icon), label), ctl];
      const grid = h('div', { class: 'st-grid' },
        ...row('flare', 'Screen effect', moment),
        ...row('volume', 'Sound', h('div', { class: 'st-sound' }, sound, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Listen', 'data-tip': 'Listen (only here)', onclick: () => listen(t.sound) }, iconEl('player-play')))),
        ...row('music', 'Music', h('div', { class: 'stack' }, music, moodRow)),
        ...row('clock', 'Change', change));
      const box = h('div', { class: 'st-box stack' },
        h('p', { class: 'hint' }, editing ? 'Plays whenever this snapshot comes on. Everything is optional.' : 'Everything is optional. The map ends up exactly as it is now.'),
        h('label', { class: 'st-name-row' }, h('span', { class: 'ctl-label' }, 'Name'), name),
        grid);
      if (o.info) {
        box.append(h('div', { class: 'st-in' }, h('span', { class: 'st-cap' }, 'In the snapshot'),
          h('div', { class: 'snap-chips' }, ...chipsOf(o.info).map((x) => h('span', { class: 'snap-chip' }, x))),
          h('span', { class: 'hint' }, 'Not in it: tokens, fog, doors, spell areas, drawings.')));
      }
      const trans = () => ({ moment: t.moment, sound: t.sound, music: t.music, mood: t.mood, fade: t.fade });
      const nm = () => name.value.trim();
      async function go(withTrans) {
        if (editing) { await cmd('snap.update', { id: o.snap.id, name: nm() || o.snap.name, trans: withTrans ? trans() : null }); d.close(); return; }
        d.close();
        done(await cmd('snap.save', { name: nm(), trans: withTrans ? trans() : null, thumb: o.thumb }));
      }
      box.append(h('div', { class: 'st-actions' },
        h('button', { type: 'button', class: 'btn', 'data-tip': editing ? 'It just switches, nothing plays' : 'Save it without a transition: it just switches', onclick: () => go(false) }, editing ? 'No transition' : 'Just switch'),
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go(true) }, iconEl(editing ? 'check' : 'camera'), h('span', {}, editing ? 'Save' : 'Save snapshot'))));
      const d = dialog(editing ? `How does ${o.snap.name} come in?` : `Snapshot ${o.n}: how does it get there?`, box, { onClose: () => listen(null) });
      d.el.classList.add('snap-dialog');
      name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(true); } });
      setTimeout(() => { name.focus(); name.select(); }, 0);
    }

    // ---------- See details: a small window next to the card ----------
    let pop = null; // { id, el, sig }
    function closeDetails() {
      if (!pop) return;
      pop.el.remove();
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', esc, true);
      pop = null;
    }
    const outside = (e) => { if (pop && !pop.el.contains(e.target) && !e.target.closest('.snap-more') && !e.target.closest('.modal-back') && !e.target.closest('#menu')) closeDetails(); };
    const esc = (e) => { if (e.key === 'Escape' && pop && !document.querySelector('.modal-back')) { e.stopImmediatePropagation(); closeDetails(); } };
    function openDetails(s, anchor) {
      if (pop && pop.id === s.id) { closeDetails(); return; }
      closeDetails();
      pop = { id: s.id, el: h('section', { class: 'snap-pop', role: 'dialog', 'aria-label': `Details of ${s.name}` }), sig: '' };
      document.body.append(pop.el);
      renderDetails();
      const r = anchor.getBoundingClientRect();
      const w = pop.el.offsetWidth; const hh = pop.el.offsetHeight;
      const x = Math.min(innerWidth - w - 8, Math.max(8, r.left - 20));
      const y = r.top - hh - 10 > 8 ? r.top - hh - 10 : Math.min(innerHeight - hh - 8, r.bottom + 8);
      Object.assign(pop.el.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
      addEventListener('pointerdown', outside, true);
      addEventListener('keydown', esc, true);
    }
    function renderDetails() {
      if (!pop) return;
      const f = find(pop.id);
      if (!f) { closeDetails(); return; }
      const { s, map } = f;
      const list = map.snaps;
      const sig = JSON.stringify([s, list.length, (S().spotify || {}).moods]);
      if (sig === pop.sig) return;
      pop.sig = sig;
      const tw = transWords(s.trans);
      const act = (icon, label, fn, o = {}) => h('button', { class: `snap-act ${o.danger ? 'danger' : ''}`, disabled: !!o.disabled, 'data-tip': o.tip || null, onclick: fn }, iconEl(icon), h('span', {}, label));
      pop.el.replaceChildren(
        h('div', { class: 'sp-head' },
          s.n <= 8 ? h('kbd', { 'data-tip': `F${s.n} plays it` }, `F${s.n}`) : null,
          h('span', { class: 'sp-title ellipsis' }, `${s.n} · ${s.name}`),
          h('button', { class: 'icon-btn', 'aria-label': 'Rename', 'data-tip': 'Rename', onclick: () => rename(s) }, iconEl('pencil')),
          h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeDetails }, iconEl('x'))),
        h('div', { class: 'sp-sec' }, h('span', { class: 'st-cap' }, 'In it'),
          h('div', { class: 'snap-chips' }, ...chipsOf(s).map((x) => h('span', { class: 'snap-chip' }, x))),
          s.missing ? h('span', { class: 'hint danger-text' }, `${plural(s.missing, 'file')} missing (Chapter menu → Missing files)`) : null),
        h('div', { class: 'sp-sec' }, h('span', { class: 'st-cap' }, 'Comes in with'),
          h('button', { class: `sp-trans ${tw ? 'on' : ''}`, onclick: () => transDialog({ snap: s }) },
            iconEl(tw ? 'transition-right' : 'plus'), h('span', { class: 'grow ellipsis' }, tw ? tw.all : 'Nothing: it just switches'), h('b', {}, tw ? 'Change' : 'Add'))),
        h('div', { class: 'sp-sep' }),
        h('div', { class: 'sp-acts' },
          act('player-play', 'Play', () => play(s), { tip: 'Its transition plays, the map goes to the table' }),
          act('download', 'Load it onto the map (no transition)', () => play(s, { quiet: true }), { tip: 'To look at it or change it; the table does not switch to this map' }),
          act('device-floppy', 'Save the map into it again', () => resave(s), { tip: 'What is on the map now replaces what it remembered' }),
          act('chevron-left', 'Move earlier', () => cmd('snap.move', { id: s.id, dir: -1 }), { disabled: s.n <= 1 }),
          act('chevron-right', 'Move later', () => cmd('snap.move', { id: s.id, dir: 1 }), { disabled: s.n >= list.length }),
          act('plus', 'Put on the hotbar', () => Hotbar.add(hotItem(s))),
          act('trash', 'Delete', () => remove(s), { danger: true })));
    }
    const hotItem = (s) => ({ kind: 'snap', ref: s.id, label: s.name, icon: 'camera' });

    // ---------- the timeline ----------
    function card(s, i, m) {
      const live = S().table.liveMapId === m.id;
      const fallback = () => (s.bg && s.bg.path ? Thumbs.img(s.bg.path, s.bg.kind) : iconEl('photo'));
      const img = s.thumb ? h('img', { class: 'thumb loaded', src: s.thumb, alt: '', draggable: 'false', onerror: (e) => e.currentTarget.replaceWith(fallback()) }) : fallback();
      const state = s.at ? (s.changed ? h('span', { class: 'snap-state changed', 'data-tip': 'The map was changed since: save it again, or save a new snapshot' }, 'changed since') : h('span', { class: `snap-state ${live ? 'live' : ''}` }, live ? 'on the table' : 'on the map')) : null;
      const el = h('article', { class: `snap-card ${s.at ? 'at' : ''}`, dataset: { id: s.id, flash: `snap:${s.id}` } },
        h('button', { class: 'snap-thumb', 'data-tip': `Play ${s.name}`, 'aria-label': `Play ${s.name}`, onclick: () => play(s) },
          img, i < 8 ? h('kbd', {}, `F${i + 1}`) : null, state, h('span', { class: 'snap-go' }, iconEl('player-play'))),
        h('span', { class: 'snap-name ellipsis', 'data-tip': 'Double-click to rename', ondblclick: () => rename(s) }, `${i + 1} · ${s.name}`),
        h('span', { class: 'snap-info ellipsis' }, infoLine(s)),
        h('div', { class: 'snap-row' },
          h('button', { class: 'btn small', onclick: () => play(s) }, iconEl('player-play'), h('span', {}, 'Play')),
          h('button', { class: 'snap-more', onclick: (e) => openDetails(s, e.currentTarget) }, 'See details')));
      Hotbar.offer(el, () => hotItem(s));
      // drag a card onto another to move it there
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ts-snap', s.id); });
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-ts-snap')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('application/x-ts-snap'); el.classList.remove('drop'); if (id && id !== s.id) { e.preventDefault(); cmd('snap.move', { id, to: i }); } });
      return el;
    }
    // between two cards: how the next one comes in
    function link(s) {
      const tw = transWords(s.trans);
      return h('div', { class: `snap-link ${tw ? 'on' : ''}` }, h('span', { class: 'snap-line' }), iconEl('chevron-right', 'snap-arrow'),
        h('button', { class: 'snap-trans', 'data-tip': tw ? `How ${s.name} comes in: ${tw.all}` : `Add a transition into ${s.name} (a screen effect, a sound, music)`, onclick: () => transDialog({ snap: s }) },
          tw ? [h('span', { class: 'st-main' }, iconEl('transition-right'), tw.main), h('span', { class: 'st-subl' }, tw.sub)] : [iconEl('plus'), h('span', {}, 'Transition')]));
    }
    function saveCard(m) {
      const here = m && m.id === S().editMapId;
      return h('button', { class: 'snap-save', 'data-tip': here ? 'Saves the map as it is now: picture, assets, sounds, effects, light, weather' : `Open ${m ? m.name : 'the map'} to save snapshots of it`,
        onclick: () => (here ? save() : cmd('edit.open', { id: m.id })) },
      iconEl('camera'), h('b', {}, here ? 'Save snapshot' : 'Open this map'), h('span', {}, here ? 'the map as it is now' : 'to save snapshots of it'));
    }
    function buildPanel() {
      loadLib();
      const head = h('div', { class: 'snap-head' });
      const track = h('div', { class: 'snap-track' });
      const older = h('div', { class: 'snap-older' });
      c().bind(() => {
        const s = S();
        if (!s || !s.campaign) return;
        const id = shownId();
        const m = mapOf(id);
        const list = snapsOf(id);
        const withSnaps = maps().filter((x) => (x.snaps || []).length && x.id !== id);
        const sig = JSON.stringify([id, list, s.editMapId, s.table.liveMapId, withSnaps.map((x) => [x.id, x.name, x.snaps.length]), (s.spotify || {}).moods]);
        if (track.dataset.sig !== sig) {
          track.dataset.sig = sig;
          const live = s.table.liveMapId === id;
          head.replaceChildren(...[
            iconEl('map-2'), h('b', { class: 'ellipsis' }, m ? m.name : 'No map'),
            h('span', { class: `snap-where ${live ? 'live' : ''}` }, live ? 'on the table' : id === s.editMapId ? 'open here' : ''),
            h('span', { class: 'grow' }),
            list.length ? Hotbar.offer(h('button', { class: 'btn small', 'data-tip': 'The next snapshot of the map on the table (drag it onto the hotbar)', onclick: () => go({ next: true }) },
              iconEl('player-track-next'), h('span', {}, 'Next')), { kind: 'snap', ref: 'next', label: 'Next snapshot', icon: 'player-track-next' }) : null,
            withSnaps.length || ui.snapMap ? h('button', { class: 'btn small ghost', onclick: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(r.left, r.bottom + 4, [{ header: 'Snapshots of' },
                ...(ui.snapMap && s.editMapId !== id && mapOf(s.editMapId) ? [{ icon: 'map-2', label: `${mapOf(s.editMapId).name} (open here)`, action: () => { ui.snapMap = null; ctx.refresh(); } }] : []),
                ...withSnaps.filter((x) => x.id !== s.editMapId || ui.snapMap).map((x) => ({ icon: 'camera', label: `${x.name} (${x.snaps.length})`, action: () => { ui.snapMap = x.id; ctx.refresh(); } }))]);
            } }, h('span', {}, 'Other maps'), iconEl('chevron-down')) : null].filter(Boolean));
          track.replaceChildren();
          list.forEach((sn, i) => { if (i) track.append(link(sn)); track.append(card(sn, i, m)); });
          if (list.length) track.append(h('div', { class: 'snap-link end' }, h('span', { class: 'snap-line' })));
          if (m) track.append(saveCard(m));
          if (!list.length) track.append(h('p', { class: 'hint snap-empty' }, 'No snapshots yet: set the map up, then save it.'));
        }
        // the old cues (before 2.1), still playable
        const cues = (s.campaign.cues || []);
        const csig = JSON.stringify(cues.map((q) => [q.id, q.name, q.slot]));
        if (older.dataset.sig !== csig) {
          older.dataset.sig = csig;
          older.replaceChildren();
          if (cues.length) {
            older.append(h('details', {}, h('summary', {}, `Older cues (${cues.length})`),
              h('div', { class: 'tc-cues' }, ...cues.map((q) => Hotbar.offer(h('button', { class: 'cue-chip', 'data-tip': `Play the cue ${q.name}. Right-click: delete`, onclick: () => ctx.Show.playCue(q),
                oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, [Hotbar.menuItem({ kind: 'cue', ref: q.id, label: q.name, icon: 'keyframes' }), { icon: 'trash', label: `Delete ${q.name}`, danger: true, action: async () => { const r = await cmd('cue.remove', { id: q.id }); if (r && r.ok) toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) }); } }]); } },
              iconEl('keyframes'), h('span', { class: 'ellipsis' }, q.name)), { kind: 'cue', ref: q.id, label: q.name, icon: 'keyframes' }, { menu: false })))));
          }
        }
        renderDetails();
      });
      return h('div', { class: 'snap-panel' }, head, track, older);
    }
    // folded, the panel keeps the timeline in one line in its title bar: F1 Pipe normal ──▸ F2 Pipe burst ⚡──▸ …
    function buildCompact() {
      const box = h('div', { class: 'snap-compact' });
      c().bind(() => {
        if (!S() || !S().campaign) return;
        const id = shownId();
        const list = snapsOf(id);
        const sig = JSON.stringify([id, list.map((x) => [x.id, x.name, x.at, x.trans])]);
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        box.replaceChildren(...(list.length ? list.flatMap((x, i) => [
          i ? h('span', { class: `sc-arrow ${x.trans ? 'on' : ''}`, 'data-tip': x.trans ? `${x.name} comes in with ${transWords(x.trans).all}` : 'It just switches' }, x.trans ? iconEl('bolt') : null, '──▸') : null,
          h('button', { class: `sc-snap ${x.at ? 'at' : ''}`, 'data-tip': `Play ${x.name}`, onclick: (e) => { e.stopPropagation(); play(x); } },
            i < 8 ? h('kbd', {}, `F${i + 1}`) : null, h('span', { class: 'ellipsis' }, x.name)),
        ].filter(Boolean)) : [h('span', { class: 'hint' }, 'none on this map yet')]));
      });
      return box;
    }
    let compactEl = null;
    // where the panel opens the first time: above the hotbar, in the middle
    // 4.3.1: the handy things behind the "?" in the title bar
    const TIPS = ['Set the map up, then save it. Change it and save the next one.', 'In between you can add a transition: an explosion, a sound, music.',
      'Tokens, fog, doors, spell areas and drawings are never part of a snapshot.', 'F1 to F8 play snapshot 1 to 8 of the map on the table.',
      'Changed a snapshot\'s map at the table? Playing another one asks whether to save the changes.', 'Next snapshot works on the hotbar and the button deck.'];
    const def = () => ({ id: 'snaps', title: 'Snapshots', icon: 'camera', tips: TIPS, build: () => { const b = buildPanel(); compactEl = buildCompact(); return b; }, headExtra: () => compactEl,
      place: (r, el) => ({ x: Math.max(0, (r.width - el.offsetWidth) / 2), y: Math.max(12, r.height - 520) }) }); // its cards end above the hotbar
    function openFor(mapId) {
      ui.snapEdit = S().editMapId;
      ui.snapMap = mapId && mapId !== S().editMapId ? mapId : null;
      ctx.showPanel(def());
      ctx.refresh();
    }

    return { def, openFor, play, playBy, go, save, transWords, closeDetails, hotItem };
  }

  return { create };
})();
