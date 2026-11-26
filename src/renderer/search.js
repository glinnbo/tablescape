// I3 (Glinn): Command search. One line always at the top of the GM screen (Ctrl K or / from anywhere): type a few
// letters, Enter, done. It finds what is on this map (tokens), the campaign (maps, chapters, triggers, snapshots), the
// library (tokens, assets, portraits, handouts, sounds), spells, effects, weather, the time of day, screen effects,
// Soundboard sounds, panels, tools, the table's actions and the settings; and it understands dice (2d6+3) and times
// (5 min). Each line has one thing it does on Enter; Tab picks another (a goblin: Select, Show to the players, Into the
// turn order, Remove). Order: this map first, then the campaign, then the rest; what was used lately comes higher.
// Every action goes through what the buttons and the Hotbar use (ctx.*), so the search does exactly what they do.
'use strict';

const CommandSearch = (() => {
  const { h, iconEl, Thumbs } = UI;
  const RECENT_KEY = 'ts.search.recent';
  const PER_GROUP = 3; const MAX_ROWS = 12;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const niceName = (n) => String(n).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------- what a few letters say: dice and times ----------
  function parseDice(q) {
    const m = /^(\d{0,2})\s*d\s*(\d{1,3})\s*(?:([+-])\s*(\d{1,3}))?$/i.exec(q.trim());
    if (!m) return null;
    const n = Math.max(1, Math.min(20, Number(m[1] || 1))); const sides = Number(m[2]);
    if (![4, 6, 8, 10, 12, 20, 100].includes(sides)) return null;
    const bonus = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
    return { n, sides, bonus, text: `${n}d${sides}${bonus ? ` ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}` : ''}` };
  }
  function parseTime(q) {
    const t = q.trim().toLowerCase();
    let m = /^(\d{1,3}):(\d{2})$/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /^(\d{1,4}(?:[.,]\d+)?)\s*(m|min|mins|minute|minutes|s|sec|secs|second|seconds|h|hour|hours)$/.exec(t);
    if (!m) return null;
    const v = Number(m[1].replace(',', '.')); const u = m[2][0];
    const s = Math.round(u === 'h' ? v * 3600 : u === 'm' ? v * 60 : v);
    return s >= 1 && s <= 6 * 3600 ? s : null;
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function create(ctx) {
    const S = () => ctx.state();
    let lib = []; let libAt = 0;
    async function loadLib() {
      if (Date.now() - libAt < 4000) return;
      libAt = Date.now();
      try { lib = await window.ts.library('list'); } catch { lib = []; }
      fresh();
      if (open) render();
    }
    // ---------- what was used lately (on this computer) ----------
    // (UI audit VC3: read once per opening, not for every line on every key)
    let recentNow = null;
    const recent = () => { if (!recentNow) { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); recentNow = Array.isArray(r) ? r : []; } catch { recentNow = []; } } return recentNow; };
    function remember(key) { const r = [key, ...recent().filter((k) => k !== key)].slice(0, 30); recentNow = r; try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* full */ } }
    // UI audit VC3: the list of everything is made once per opening (it was made again on every key, every arrow and
    // every line the mouse passed), and what a text finds is kept until the text changes
    let itemsNow = null; let foundFor = null; let foundNow = null;
    const fresh = () => { itemsNow = null; foundFor = null; foundNow = null; recentNow = null; };
    const allItems = () => itemsNow || (itemsNow = items());
    const found = (q) => { if (foundFor !== q || !foundNow) { foundNow = results(q); foundFor = q; } return foundNow; };

    // ---------- everything it can find, each with what it does ----------
    const act = (label, run) => ({ label, run });
    let made = 0; // (for the self-test: how often the list was made)
    function items() {
      made++;
      const s = S(); const out = [];
      const put = (o) => { out.push(o); return o; };
      if (!s) return out;
      const m = s.map; const camp = s.campaign;
      // tokens on this map
      if (m) {
        for (const l of m.layers || []) {
          if (l.role !== 'token') continue;
          const label = `${l.name || 'Token'}${l.n ? ` ${l.n}` : ''}`;
          put({ key: `tok:${l.id}`, group: 'On this map', rank: 0, label, sub: `${m.name}${l.hidden ? ' · hidden from the players' : ''}`, thumb: l.path, thumbKind: l.kind === 'video' ? 'video' : 'image', round: true,
            acts: [act('Select', () => ctx.selectToken(l.id)), act(l.hidden ? 'Show to the players' : 'Hide from the players', () => ctx.cmd('layer.update', { id: l.id, hidden: !l.hidden })),
              act('Turn order', () => ctx.toggleTurn(l)), act('Remove', () => ctx.removeToken(l))] });
        }
        for (const tr of m.triggers || []) put({ key: `trg:${tr.id}`, group: 'On this map', rank: 0.5, label: tr.name, sub: `Trigger · ${tr.steps.length} step${tr.steps.length === 1 ? '' : 's'}`, icon: 'bolt', acts: [act('Run', () => ctx.runTrigger(tr.id))] });
        for (const sn of m.snaps || []) put({ key: `snap:${sn.id}`, group: 'On this map', rank: 0.6, label: sn.name, sub: 'Snapshot', icon: 'camera', acts: [act('Play', () => ctx.hot({ kind: 'snap', ref: sn.id, label: sn.name }))] });
      }
      // the campaign: chapters and maps
      if (camp) {
        const liveId = s.table && s.table.liveMapId;
        for (const ch of camp.chapters || []) {
          if ((ch.maps || []).length) put({ key: `ch:${ch.id}`, group: 'Campaign', rank: 1, label: ch.name, sub: `Chapter · ${ch.maps.length} map${ch.maps.length === 1 ? '' : 's'}`, icon: 'book', acts: [act('Go to', () => ctx.cmd('edit.open', { id: ch.maps[0].id }))] });
          for (const mp of ch.maps || []) {
            put({ key: `map:${mp.id}`, group: 'Campaign', rank: 1, label: mp.name, sub: `Map · ${ch.name}${mp.id === liveId ? ' · on the table' : ''}`, icon: 'map-2',
              acts: [act('Go to', () => ctx.cmd('edit.open', { id: mp.id })), act('Send to the table', () => ctx.hot({ kind: 'map', ref: mp.id, label: mp.name }))] });
          }
        }
      }
      // spells
      for (const sp of ctx.spells()) put({ key: `spell:${sp.name}`, group: 'Spells', rank: 2, label: sp.name, sub: `${sp.size} ft ${sp.shape} · ${(FXDATA.SKINS[sp.skin] || {}).label || sp.skin}`, icon: (FXDATA.SKINS[sp.skin] || {}).icon || 'wand', acts: [act('Cast', () => ctx.hot({ kind: 'spell', ref: sp.name, label: sp.name }))] });
      // effects, weather, the time of day
      if (m) {
        for (const e of FXDATA.ELEMENTS || []) {
          if (!e.label || !(e.kind === 'region' || e.kind === 'emitter')) continue;
          put({ key: `fx:${e.kind}:${e.id}`, group: 'Effects', rank: 2.5, label: e.label, sub: `Effects · ${e.kind === 'region' ? 'you paint it' : 'you place it'}`, icon: e.icon || 'flame', acts: [act(e.kind === 'region' ? 'Paint' : 'Place', () => ctx.armEffect(e))] });
        }
        for (const w of FXDATA.WEATHER || []) if (w.id !== 'none') put({ key: `wx:${w.id}`, group: 'Effects', rank: 2.4, label: w.label, sub: 'Weather · this map', icon: w.icon || 'cloud', acts: [act('Set', () => ctx.hot({ kind: 'weather', ref: w.layers || [], label: w.label }))] });
        for (const md of FXDATA.MOODS || []) put({ key: `mood:${md.id}`, group: 'Effects', rank: 2.3, label: md.label, sub: 'Time of day · this map', icon: md.icon || 'sun', acts: [act('Set', () => ctx.hot({ kind: 'light', ref: md.id, label: md.label }))] });
      }
      // screen effects, Soundboard sounds
      for (const d of Moments.LIST) put({ key: `mo:${d.id}`, group: 'Screen effects', rank: 2.6, label: d.label, sub: `Screen effect${d.dur ? '' : ' · until stopped'}`, icon: d.icon, acts: [act('Play', () => ctx.hot({ kind: 'moment', ref: d.id, label: d.label }))] });
      for (const p of ctx.boardPads()) put({ key: `pad:${p.key}`, group: 'Sounds', rank: 2.7, label: p.name, sub: `Soundboard${p.files.length > 1 ? ` · one of ${p.files.length}` : ''}`, icon: 'volume', acts: [act('Play', () => ctx.playPad(p))] });
      // the library
      const LIB = { tokens: ['Tokens', 'Place', (x) => ctx.place(x, 'token')], assets: ['Assets', 'Place', (x) => ctx.place(x, 'asset')],
        portraits: ['Portraits', 'Into the Conversation', (x) => ctx.talk(x)], handouts: ['Handouts', 'Show on the table', (x) => ctx.cmd('handout.show', { path: x.path })],
        overlays: ['Overlays', 'On this map', (x) => ctx.hot({ kind: 'overlay', ref: { path: x.path, kind: x.kind, cat: x.cat }, label: niceName(x.name) })],
        sounds: ['Sounds', 'Play on this map', (x) => ctx.hot({ kind: 'sound', ref: { path: x.path, kind: 'audio', cat: 'sounds' }, label: niceName(x.name) })] };
      for (const x of lib) {
        const L = LIB[x.cat];
        if (!L || (x.cat === 'sounds' && /^Audio\/SFX\//i.test(x.rel))) continue; // (Audio/SFX: the Soundboard's pads above)
        if ((x.cat === 'tokens' || x.cat === 'assets' || x.cat === 'overlays') && !m) continue;
        put({ key: `lib:${x.rel || x.path}`, group: 'Library', rank: 4, label: niceName(x.name), sub: `${L[0]}${x.rel ? ` · ${x.rel.split('/').slice(1, -1).join(' / ') || L[0]}` : ''}`.replace(/ · (\w+)$/, (a, b) => (b === L[0] ? '' : a)),
          thumb: x.kind === 'image' ? x.path : null, round: x.cat === 'tokens', icon: x.cat === 'sounds' ? 'volume' : x.cat === 'portraits' ? 'user' : x.cat === 'handouts' ? 'script' : 'photo', acts: [act(L[1], () => L[2](x))] });
      }
      // panels, tools, the table's actions, settings
      for (const p of ctx.panels()) put({ key: `panel:${p.id}`, group: 'Panels and tools', rank: 3, label: p.label, sub: 'Panel', icon: p.icon, acts: [act('Open', () => ctx.openPanel(p.id))] });
      for (const t of ctx.tools()) put({ key: `tool:${t.id}`, group: 'Panels and tools', rank: 3, label: t.label, sub: 'Tool', icon: t.icon, acts: [act('Open', () => ctx.pressRail(t.id))] });
      for (const [k, d] of Object.entries(ctx.doActions())) put({ key: `do:${k}`, group: 'Panels and tools', rank: 3.2, label: d.label, sub: 'On the table', icon: d.icon, acts: [act('Do it', () => ctx.hot({ kind: 'do', ref: k, label: d.label }))] });
      for (const o of ctx.settings()) put({ key: `set:${o.id}`, group: 'Settings', rank: 5, label: o.title || o.label, sub: `Settings${o.scope === 'camp' ? ' · this campaign' : ''}`, icon: o.icon || 'settings', acts: [act('Open', () => ctx.openSettings(o.id))] });
      // (UI audit VC3) and every single setting: its section opens and the line lights up
      for (const o of (ctx.settingLines ? ctx.settingLines() : [])) put({ key: `setl:${o.id}:${o.label}`, group: 'Settings', rank: 5.3, label: o.label, sub: `${o.scope === 'camp' ? 'Campaign settings' : 'Tablescape settings'} · ${o.section}`, icon: o.icon || 'settings', acts: [act('Open', () => ctx.openSettings(o.id, o.label))] });
      return out;
    }

    // ---------- how well a line fits what is typed ----------
    // (Speed 4, WD8: each name was made plain three times for every key typed)
    const plain = new Map();
    const normOf = (v) => { const k = String(v || ''); let n = plain.get(k); if (n === undefined) { if (plain.size > 30000) plain.clear(); n = norm(k); plain.set(k, n); } return n; };
    function score(it, q) {
      const L = normOf(it.label); const sub = normOf(it.sub);
      const words = q.split(' ').filter(Boolean);
      let sc = 0;
      for (const w of words) {
        let best = 0;
        if (L === w) best = 100; else if (L.startsWith(w)) best = 80;
        else if (` ${L}`.includes(` ${w}`)) best = 62; else if (L.includes(w)) best = 42;
        else if (` ${sub}`.includes(` ${w}`)) best = 18;
        if (!best) return 0;
        sc += best;
      }
      sc /= words.length;
      if (L === q) sc += 30;
      sc -= it.rank * 4;
      const r = recent().indexOf(it.key); if (r >= 0) sc += 14 - Math.min(10, r);
      return sc;
    }
    function results(qRaw) {
      const q = norm(qRaw);
      const rows = [];
      const dice = parseDice(qRaw);
      if (dice) rows.push({ key: 'dice', group: '', label: `Roll ${dice.text}`, sub: 'On the table, with the dice', icon: 'dice', acts: [act('Roll', () => ctx.cmd('dice.roll', { pool: { [dice.sides]: dice.n }, bonus: dice.bonus }))] });
      const secs = parseTime(qRaw);
      if (secs) rows.push({ key: 'timer', group: '', label: `Countdown ${clock(secs)}`, sub: 'On the table', icon: 'hourglass', acts: [act('Start', () => ctx.cmd('timer.start', { seconds: secs }))] });
      if (!q) return { lead: rows, groups: [] }; // (UI audit VC2: "-" or "_" alone is no text to look for; the plain list made the drawing throw)
      const all = allItems().map((it) => ({ it, sc: score(it, q) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
      const groups = new Map();
      for (const { it, sc } of all) { if (!groups.has(it.group)) groups.set(it.group, { best: sc, list: [] }); groups.get(it.group).list.push(it); }
      return { lead: rows, groups: [...groups.entries()].sort((a, b) => b[1].best - a[1].best) };
    }

    // ---------- the bar ----------
    let open = false; let active = 0; let alt = 0; let rowsNow = []; let expanded = new Set();
    const input = h('input', { type: 'text', class: 'ck-input', placeholder: 'Find or do anything …', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Find or do anything' });
    const kbd = h('span', { class: 'ck-kbd' }, 'Ctrl K');
    const list = h('div', { class: 'ck-list', role: 'listbox', hidden: true });
    const bar = h('div', { id: 'cmdk', class: 'ck' }, h('label', { class: 'ck-bar' }, iconEl('search'), input, kbd), list);
    const TRY = [['search', 'a name', 'a token, a map, a spell, a sound, a panel, a setting'], ['dice', 'd20, 2d6+3', 'to roll'], ['hourglass', '5 min, 90 s', 'a countdown']];
    function render() {
      const q = input.value;
      list.replaceChildren(); rowsNow = [];
      const row = (it, hl) => {
        const i = rowsNow.length; rowsNow.push(it);
        const on = i === active;
        const pic = it.thumb ? Thumbs.img(it.thumb, it.thumbKind || 'image', null, 'ck-pic') : iconEl(it.icon || 'search'); // (VC3: the small copy, not the original file)
        const label = hl ? highlight(it.label, hl) : [it.label];
        const r = h('div', { class: `ck-row ${on ? 'on' : ''}`, role: 'option', 'aria-selected': String(on), dataset: { key: it.key },
          onmousemove: () => { if (active !== i) { active = i; alt = 0; render(); } }, onmousedown: (e) => e.preventDefault(), onclick: () => run(i, 0) },
        h('span', { class: `ck-ic ${it.round ? 'round' : ''}` }, pic), h('div', { class: 'ck-txt' }, h('b', {}, ...label), it.sub ? h('small', {}, it.sub) : null),
        it.acts && it.acts.length ? h('span', { class: 'ck-verb' }, it.acts[on ? alt : 0].label, on ? ' ⏎' : '') : null);
        list.append(r);
        if (on && it.acts && it.acts.length > 1) {
          list.append(h('div', { class: 'ck-alts' }, 'Tab', ...it.acts.map((a, k) => h('button', { class: k === alt ? 'on' : '', onmousedown: (e) => e.preventDefault(), onclick: () => run(i, k) }, a.label))));
        }
      };
      if (!q.trim()) {
        const all = allItems(); const byKey = new Map(all.map((x) => [x.key, x]));
        const rec = recent().map((k) => byKey.get(k)).filter(Boolean).slice(0, 5);
        if (rec.length) { list.append(h('div', { class: 'ck-grp' }, 'Just now')); rec.forEach((it) => row(it)); }
        list.append(h('div', { class: 'ck-grp' }, 'Try'));
        for (const [icon, b, sm] of TRY) list.append(h('div', { class: 'ck-row ck-try' }, h('span', { class: 'ck-ic' }, iconEl(icon)), h('div', { class: 'ck-txt' }, h('b', {}, b), h('small', {}, sm))));
      } else {
        const res = found(q);
        for (const it of res.lead) row(it);
        let n = rowsNow.length;
        for (const [g, { list: its }] of res.groups) {
          if (n >= MAX_ROWS) break;
          list.append(h('div', { class: 'ck-grp' }, g));
          const show = expanded.has(g) ? its.slice(0, MAX_ROWS) : its.slice(0, PER_GROUP);
          for (const it of show) { row(it, norm(q)); n++; }
          if (its.length > show.length) {
            const more = its.slice(show.length);
            list.append(h('button', { class: 'ck-more', onmousedown: (e) => e.preventDefault(), onclick: () => { expanded.add(g); render(); } }, `and ${more.length} more: ${more.slice(0, 3).map((x) => x.label).join(', ')}${more.length > 3 ? ' …' : ''}`));
          }
        }
        if (!rowsNow.length) list.append(h('div', { class: 'ck-none' }, `Nothing called "${q.trim()}".`));
      }
      if (active >= rowsNow.length) active = Math.max(0, rowsNow.length - 1);
      list.append(h('div', { class: 'ck-foot' }, h('span', {}, h('b', {}, '↑ ↓'), ' pick'), h('span', {}, h('b', {}, '⏎'), ' do it'), h('span', {}, h('b', {}, 'Tab'), ' other things to do'), h('span', {}, h('b', {}, 'Esc'), ' back to the map')));
      list.hidden = !open;
      const on = list.querySelector('.ck-row.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    // the letters typed, marked in the name
    function highlight(label, q) {
      const L = norm(label); const words = q.split(' ').filter(Boolean).sort((a, b) => b.length - a.length);
      const mark = new Array(label.length).fill(false);
      for (const w of words) { const i = L.indexOf(w); if (i >= 0 && L.length === label.length) for (let k = i; k < i + w.length; k++) mark[k] = true; }
      const out = []; let cur = ''; let curOn = false;
      for (let i = 0; i < label.length; i++) { if (mark[i] !== curOn && cur) { out.push(curOn ? h('u', {}, cur) : cur); cur = ''; } curOn = mark[i]; cur += label[i]; }
      if (cur) out.push(curOn ? h('u', {}, cur) : cur);
      return out;
    }
    async function run(i, k) {
      const it = rowsNow[i];
      if (!it || !it.acts || !it.acts[k]) return;
      remember(it.key);
      close(true);
      try { await it.acts[k].run(); } catch (e) { UI.toast(`${it.label}: ${(e && e.message) || 'that did not work'}`, { kind: 'error' }); }
    }
    function openIt() {
      if (open) return;
      open = true; active = 0; alt = 0; expanded = new Set();
      fresh();
      bar.classList.add('on'); kbd.textContent = 'Esc';
      loadLib(); render();
    }
    function close(clear) {
      open = false; bar.classList.remove('on'); kbd.textContent = 'Ctrl K'; list.hidden = true;
      if (clear) input.value = '';
      if (document.activeElement === input) input.blur();
    }
    input.addEventListener('focus', openIt);
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(false); }, 120));
    input.addEventListener('input', () => { active = 0; alt = 0; expanded = new Set(); render(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here is for the search, not for the map's keys
      const n = rowsNow.length;
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { active = (active + 1) % n; alt = 0; render(); } return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { active = (active - 1 + n) % n; alt = 0; render(); } return; }
      if (e.key === 'Tab') { e.preventDefault(); const it = rowsNow[active]; if (it && it.acts && it.acts.length > 1) { alt = (alt + (e.shiftKey ? -1 : 1) + it.acts.length) % it.acts.length; render(); } return; }
      if (e.key === 'Enter') { e.preventDefault(); run(active, alt); }
    });
    function focus() { input.focus(); input.select(); }
    return { el: bar, focus, close, isOpen: () => open, _made: () => made, _results: (q) => { fresh(); const r = results(q); return r.lead ? [...r.lead, ...r.groups.flatMap(([, g]) => g.list)].map((x) => ({ key: x.key, label: x.label, group: x.group, acts: (x.acts || []).map((a) => a.label) })) : r.map((x) => ({ key: x.key, label: x.label, acts: x.acts.map((a) => a.label) })); }, _loadLib: async () => { libAt = 0; await loadLib(); }, parseDice, parseTime };
  }
  return { create, parseDice, parseTime };
})();
