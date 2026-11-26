// The home screen (Beta 3.17): one screen like a game's main menu, for all campaigns.
//   The picked campaign fills it: its name, its party, PLAY and PREPARE THE MAPS, a menu (Players, Screens on the table,
//   Campaign settings, Options), a line that says whether the table is ready, Continue and the latest maps on the
//   right, its cover map drifting slowly behind. The other campaigns wait as slots along the bottom.
//   Picking a slot only shows that campaign; it opens when it is played or changed. Players, Screens, Campaign
//   settings and the table check slide in from the right, their edge the orange diagonal.
//   The layout is drawn for 1500 x 880 and scaled to the window, like a game.
'use strict';

const Home = (() => {
  const { h, iconEl, Thumbs, toast, openMenu, askText, dialog } = UI;
  const cmd = (type, payload) => window.ts.cmd(type, payload);
  const W0 = 1500; const H0 = 900; // the size the screen is drawn for
  let root = null;
  let S = null; // the GM state
  let list = null; // campaign.list: the campaigns with what the home shows of each
  let listBusy = null;
  let selId = null; // the campaign picked on the home screen (opens only when played or changed)
  let about = null;
  let devices = null; // the speakers the sound window knows (the status line and the table check)
  const el = {};

  // "today", "yesterday", "3 days ago"
  function ago(ts) {
    if (!ts) return '';
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((day(Date.now()) - day(ts)) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fileUrl = (p) => (window.ts.fileUrl ? window.ts.fileUrl(p) : UI.pathToUrl(p));
  const sig = (node, v) => { const s = JSON.stringify(v); if (node.dataset.sig === s) return false; node.dataset.sig = s; return true; };

  // =====================================================================
  // The frame: built once
  // =====================================================================
  function mount(elRoot) {
    root = elRoot;
    root.classList.add('hm');
    el.bg = h('div', { class: 'hm-bg', 'aria-hidden': 'true' });
    el.shade = h('div', { class: 'hm-shade', 'aria-hidden': 'true' });

    // the top: the name with the release under it; on the right updates, Tutorial, Guide, Library, Discord, Ko-fi
    el.release = h('span', { class: 'release' });
    const top = h('header', { class: 'hm-top' },
      h('div', { class: 'hm-brand' }, h('h1', { class: 'wordmark' }, 'Tablescape'), el.release),
      h('div', { class: 'hm-actions' },
        h('div', { class: 'upd-slot' }),
        // (P6: the Tutorial button comes back with the tutorial; it only said "coming soon")
        h('button', { class: 'btn hm-tb', 'data-tip': 'Guide: first evening, keys, what\'s new, report a problem (?)', onclick: () => Guide.open('start') }, iconEl('book'), 'Guide'),
        h('button', { class: 'btn hm-tb', 'data-tip': 'Open the folder with your maps, tokens and effects', onclick: () => window.ts.library('open') }, iconEl('folder'), 'Library folder'), // (UI audit VJ9, Glinn: the rail's "Library" is the drawer; this one opens the Windows folder)
        h('button', { class: 'btn hm-tb hm-ic', 'aria-label': 'Discord', 'data-tip': 'Tablescape on Discord: help, bug reports, ideas, news', onclick: () => window.ts.app('link.open', { to: 'discord' }) }, iconEl('logo-discord')),
        h('button', { class: 'btn hm-tb hm-ic', 'aria-label': 'Ko-fi', 'data-tip': 'Support Tablescape on Ko-fi', onclick: () => window.ts.app('link.open', { to: 'kofi' }) }, iconEl('logo-kofi'))));

    // the left: the campaign
    el.label = h('div', { class: 'hm-label' }, 'Campaign');
    el.name = h('h1', { class: 'hm-name' });
    el.meta = h('div', { class: 'hm-meta' });
    el.party = h('div', { class: 'hm-party' });
    el.menu = h('nav', { class: 'hm-menu', 'aria-label': 'Campaign' }); // (Beta 3.19: Play and Prepare the maps are lines of it)
    const left = h('div', { class: 'hm-left' }, el.label, el.name, el.meta, el.party, el.menu);

    // the right: Continue, the latest maps
    el.right = h('aside', { class: 'hm-right' });

    // the bottom: the campaigns
    el.slots = h('div', { class: 'hm-slots', role: 'listbox', 'aria-label': 'Campaigns' });
    el.deleted = h('button', { class: 'btn ghost small hm-deleted', onclick: recentlyDeleted });
    const foot = h('footer', { class: 'hm-foot' }, el.slots, el.deleted);

    el.drawers = h('div', { class: 'hm-drawers' });
    el.top = top; el.main = h('div', { class: 'hm-main' }, left, el.right); el.foot = foot;
    el.stage = h('div', { class: 'hm-stage' }, top, el.main, foot, el.drawers);
    root.append(el.bg, el.shade, el.stage);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey, true);
    window.ts.app('about').then((a) => { about = a; el.release.textContent = a ? a.label : ''; }).catch(() => {});
  }
  // scaled to the window like a game: drawn for W0 x H0; a wider or taller window gets more room, not bigger type.
  // The campaign and its menu keep at least AIR above and below: a short window makes it all a bit smaller instead.
  const AIR = 110;
  function needH() {
    const st = el.stage;
    if (!st || !st.offsetHeight) return H0; // not shown yet
    const cs = getComputedStyle(st);
    const n = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + el.top.offsetHeight + el.main.offsetHeight + el.foot.offsetHeight + 2 * AIR;
    return Math.max(H0, Math.ceil(n));
  }
  function fit() {
    if (!root) return;
    const s = Math.min(window.innerWidth / W0, window.innerHeight / needH());
    const v = String(Math.max(0.4, Math.round(s * 1000) / 1000));
    if (root.style.getPropertyValue('--hs') !== v) root.style.setProperty('--hs', v);
  }

  // =====================================================================
  // State
  // =====================================================================
  // gm.js: on the home screen (no campaign open) and on a campaign's page (one open)
  function update(s, prevScreen) {
    const was = S;
    S = s;
    const openId = s.campaign ? s.campaign.id : null;
    const entering = prevScreen !== 'home' && prevScreen !== 'campaign';
    if (openId && (entering || !was || !was.campaign || was.campaign.id !== openId)) selId = openId;
    if (entering) { devices = null; navSel = null; loadDevices(); arrive(); }
    if (entering || !list || (was && was.campaign && s.campaign && was.campaign.name !== s.campaign.name) || (!!openId !== !!(list && list.open)) || (list && openId && list.open !== openId)) refresh();
    paint();
  }
  // (kept for transfer-ui.js and older callers: the list again, e.g. after an import)
  function show() { refresh(); }
  function page(s) { update(s, S && S.screen); }
  async function refresh() {
    if (listBusy) return listBusy;
    listBusy = cmd('campaign.list').then((r) => { list = r && r.ok ? r : list; listBusy = null; paint(); return list; }).catch(() => { listBusy = null; });
    return listBusy;
  }
  async function loadDevices() {
    devices = (await window.ts.sound('devices').catch(() => null)) || null;
    paint();
  }
  // a slow fade in each time the home screen comes back (from the maps, after the splash)
  function arrive() {
    if (!root) return;
    root.classList.remove('hm-arrive'); void root.offsetWidth; root.classList.add('hm-arrive');
    setTimeout(() => { fitName(); fit(); }, 0);
  }

  const items = () => (list && list.campaigns) || [];
  function selItem() {
    const all = items();
    return all.find((c) => c.id === selId) || all.find((c) => list && c.id === list.lastId && !c.broken) || all.find((c) => !c.broken) || all[0] || null;
  }
  const isOpen = (id) => !!(S && S.campaign && S.campaign.id === id);
  // the picked campaign as the home shows it: from the open campaign while it is open (live), else from the list
  function view() {
    const it = selItem();
    if (!it) return null;
    if (isOpen(it.id)) {
      const c = S.campaign;
      return { id: c.id, item: it, live: true, broken: false, name: c.name, lastSession: c.lastSession, chapters: c.chapters.length,
        maps: c.chapters.reduce((n, ch) => n + ch.maps.length, 0), players: c.party.length, session: c.session, pv: c.preview || it.preview || {} };
    }
    return { id: it.id, item: it, live: false, broken: !!it.broken, name: it.name, lastSession: it.lastSession, chapters: it.chapters, maps: it.maps,
      players: it.players, session: null, pv: it.preview || {} };
  }

  // =====================================================================
  // Painting
  // =====================================================================
  function paint() {
    if (!root || !list) return;
    const v = view();
    root.classList.toggle('hm-empty', !v);
    paintBg(v);
    paintLeft(v);
    paintRight(v);
    paintSlots(v);
    for (const f of refs) f();
    if (window.App && App.updateSlot) App.updateSlot();
    fit(); // the party or the menu may have grown
  }

  // the cover map behind it all, full size, drifting slowly; a new campaign's fades in over the last
  function paintBg(v) {
    const pic = v && v.pv && v.pv.cover;
    const key = pic ? pic.path : '';
    if (el.bg.dataset.key === key) return;
    el.bg.dataset.key = key;
    for (const old of [...el.bg.children]) { old.classList.add('out'); setTimeout(() => old.remove(), 900); }
    if (!pic) return;
    const url = fileUrl(pic.path);
    const node = pic.kind === 'video'
      ? h('video', { class: 'hm-pic', src: url, autoplay: true, muted: true, loop: true, playsinline: true })
      : h('img', { class: 'hm-pic', src: url, alt: '', draggable: 'false' });
    if (node.tagName === 'VIDEO') { node.muted = true; node.play().catch(() => {}); }
    const done = () => node.classList.add('in');
    node.addEventListener(pic.kind === 'video' ? 'loadeddata' : 'load', done, { once: true });
    node.addEventListener('error', () => node.remove(), { once: true });
    el.bg.append(node);
  }

  function paintLeft(v) {
    if (!v) {
      el.label.textContent = 'Tablescape';
      el.name.textContent = 'No campaign yet';
      el.meta.textContent = 'Start one, or bring one in from a .tablescape file.';
      el.party.replaceChildren();
      paintMenu(null);
      return;
    }
    el.label.textContent = 'Campaign';
    if (el.name.textContent !== v.name) { el.name.textContent = v.name; fitName(); }
    if (v.broken) {
      el.meta.textContent = 'This campaign\'s file is damaged';
      el.party.replaceChildren();
      paintMenu(v);
      return;
    }
    el.meta.textContent = [v.lastSession ? `Last played ${ago(v.lastSession)}` : 'Not played yet', plural(v.players, 'player', 'players'), plural(v.maps, 'map', 'maps')].join(' · ');
    paintParty(v);
    paintMenu(v);
  }

  // a long name gets smaller type until it fits on one line
  function fitName() {
    el.name.style.fontSize = '';
    requestAnimationFrame(() => {
      if (!el.name.clientWidth) return; // (hidden: fitted when the home comes back)
      let px = 80;
      while (px > 46 && el.name.scrollWidth > el.name.clientWidth + 1) { px -= 4; el.name.style.fontSize = `${px}px`; }
    });
  }

  function paintParty(v) {
    const party = (v.pv && v.pv.party) || [];
    if (!sig(el.party, [v.id, party])) return;
    const MAX = 8;
    const faces = party.slice(0, MAX).map((p) => h('button', { class: `hm-pc ${p.away ? 'away' : ''}`, 'data-tip': p.away ? `${p.name}: not here today` : p.name, onclick: () => drawer('players') },
      p.face ? h('img', { src: p.face, alt: '', draggable: 'false' }) : h('span', { class: 'hm-pc-initial' }, (p.name || '?').slice(0, 1).toUpperCase()),
      h('span', { class: 'hm-pc-name' }, p.name)));
    if (party.length > MAX) faces.push(h('button', { class: 'hm-pc more', onclick: () => drawer('players') }, h('span', { class: 'hm-pc-initial' }, `+${party.length - MAX}`), h('span', { class: 'hm-pc-name' }, 'more')));
    faces.push(h('button', { class: 'hm-pc add', 'data-tip': 'Add a player character', onclick: () => drawer('players', { focusAdd: true }) }, h('span', { class: 'hm-pc-initial' }, iconEl('plus')), h('span', { class: 'hm-pc-name' }, 'Add')));
    el.party.replaceChildren(...faces);
  }

  // Beta 3.19: one list like a game's menu, Play first and glowing; the mouse and the arrow keys move one marker
  let navSel = null; // the id of the marked line
  const openSettings = () => { closeDrawer(true); App.openOptions(problems().length ? 'check' : undefined); };
  function menuItems(v) {
    const settingsLine = { id: 'options', label: 'Tablescape settings', run: openSettings, gap: true };
    if (!v) return [{ id: 'new', label: 'New campaign', run: create, main: true }, { id: 'import', label: 'Import', run: () => TransferUI.importPick(), tip: 'A .tablescape file from another DM or another PC' }, settingsLine];
    if (v.broken) return [{ id: 'backups', label: 'Backups', run: () => earlier(v.item), main: true, tip: 'This campaign\'s file is damaged: bring back a backup' }, settingsLine];
    return [
      { id: 'play', label: v.session ? 'Back to the table' : 'Play', run: () => play(), main: true, tip: v.session ? 'The maps, as you left them' : 'Start the session: the title shows on the table until you send the first map (T)' },
      ...(v.session ? [] : [{ id: 'prep', label: 'Prepare the maps', run: () => prepare(), tip: 'Open the maps without starting: the table stays as it is' }]),
      { id: 'players', label: 'Players', run: () => drawer('players') },
      { id: 'settings', label: 'Campaign settings', run: () => campaignSettings() },
      settingsLine,
    ];
  }
  function paintMenu(v) {
    const list = menuItems(v);
    if (sig(el.menu, list.map((m) => [m.id, m.label, m.tip || '']))) {
      el.menu.replaceChildren(...list.map((m) => h('button', { class: `hm-item hm-nav ${m.main ? 'main' : ''} ${m.gap ? 'gap' : ''}`, dataset: { id: m.id }, 'data-tip': m.tip || null,
        onpointerenter: () => mark(m.id) }, h('span', {}, m.label))));
    }
    for (const b of el.menu.children) { const m = list.find((x) => x.id === b.dataset.id); if (m) b.onclick = () => { mark(m.id); m.run(); }; } // (they change with the campaign)
    mark(list.some((m) => m.id === navSel) ? navSel : list[0].id);
    paintDot();
  }
  function mark(id) {
    navSel = id;
    for (const b of el.menu.querySelectorAll('.hm-item')) b.classList.toggle('sel', b.dataset.id === id);
  }

  // is the table ready (the TV, the speakers, one inch is one inch): the whole check is in Tablescape settings; the
  // home shows a dot on Tablescape settings while something needs a look (Beta 3.19: no status line any more)
  function statusRows() {
    if (!S || !S.view) return [];
    const v = S.view; const st = S.settings || {};
    const known = (id) => !id || !devices || devices.some((x) => x.id === id);
    return [
      S.table && S.table.open ? (v.windowed ? { state: 'warn', text: 'Table in a window' } : { state: 'ok', text: 'TV ready' }) : { state: 'off', text: 'Table window closed' }, // (Play opens it)
      known(st.soundOut) && (st.fxOut == null || known(st.fxOut)) ? { state: 'ok', text: 'Speakers' } : { state: 'warn', text: 'A speaker is missing' },
      v.calibrated ? { state: 'ok', text: 'Calibrated' } : { state: 'warn', text: 'Not calibrated' },
    ];
  }
  const problems = () => statusRows().filter((r) => r.state === 'warn').map((r) => r.text);
  function paintDot() {
    const b = el.menu.querySelector('.hm-item[data-id="options"]');
    if (!b) return;
    const p = problems();
    let dot = b.querySelector('.hm-dot');
    if (p.length && !dot) { dot = h('i', { class: 'hm-dot', 'aria-hidden': 'true' }); b.append(dot); } else if (!p.length && dot) dot.remove();
    const tip = p.length ? `Table check: ${p.join(' · ')}` : null;
    if ((b.dataset.tip || null) !== tip) { if (tip) b.dataset.tip = tip; else delete b.dataset.tip; }
    b.classList.toggle('warn', !!p.length);
  }

  function picEl(pic, cls) {
    if (!pic) return h('div', { class: `${cls} hm-nopic` }, iconEl('map-2'));
    return h('div', { class: cls }, Thumbs.img(pic.path, pic.kind, pic.thumb, 'cover-img'));
  }
  function paintRight(v) {
    const pv = (v && !v.broken && v.pv) || {};
    if (!sig(el.right, [v && v.id, pv.cont, pv.recent, v && v.maps])) return;
    const parts = [];
    if (pv.cont) {
      parts.push(h('div', { class: 'hm-caps' }, 'Continue'),
        h('button', { class: 'hm-cont', onclick: () => openMap(pv.cont.id) }, picEl(pv.cont.pic, 'hm-cont-pic'),
          h('span', { class: 'hm-cont-text' }, h('b', {}, pv.cont.name), h('span', {}, pv.cont.live ? 'On the table when you stopped' : 'Last opened'))));
    }
    if (pv.recent && pv.recent.length) {
      parts.push(h('div', { class: 'hm-caps' }, 'Latest maps'),
        ...pv.recent.map((m) => h('button', { class: 'hm-recent', onclick: () => openMap(m.id) }, picEl(m.pic, 'hm-recent-pic'), h('span', { class: 'ellipsis' }, m.name))));
    }
    if (parts.length && v && v.maps) parts.push(h('button', { class: 'hm-all', onclick: () => prepare() }, `All ${plural(v.maps, 'map', 'maps')}`, iconEl('chevron-right')));
    el.right.replaceChildren(...parts);
  }

  function paintSlots(v) {
    const all = items();
    const deletedN = (list && list.deleted) || 0;
    el.deleted.hidden = !deletedN;
    el.deleted.replaceChildren(iconEl('trash'), `Recently deleted (${deletedN})`);
    const openName = S && S.campaign ? S.campaign.name : null;
    const cov = (c) => (isOpen(c.id) && v && v.id === c.id ? (v.pv && v.pv.cover) : c.coverPath ? { path: c.coverPath, kind: c.coverKind, thumb: c.coverThumb } : null);
    if (!sig(el.slots, [all.map((c) => [c.id, isOpen(c.id) ? openName : c.name, c.broken, cov(c)]), v && v.id])) return;
    const slots = all.map((c) => {
      const on = !!v && c.id === v.id;
      const pic = cov(c);
      return h('button', {
        class: `hm-slot ${on ? 'on' : ''} ${c.broken ? 'broken' : ''}`, role: 'option', 'aria-selected': String(on), dataset: { id: c.id },
        onclick: () => pick(c.id), ondblclick: () => { if (!c.broken) { const v = view(); if (v && v.session) play(); else prepare(); } }, // (UI audit VJ8, Glinn: a double click opens the maps and starts no session; a session that runs: back to the table)
        oncontextmenu: (e) => { e.preventDefault(); campaignMenu(c, e.clientX, e.clientY); },
      },
      c.broken ? h('div', { class: 'hm-slot-pic hm-nopic' }, iconEl('alert-triangle')) : picEl(pic, 'hm-slot-pic'),
      h('span', { class: 'hm-slot-name' }, isOpen(c.id) && openName ? openName : c.name));
    });
    slots.push(h('button', { class: 'hm-slot new', onclick: create }, iconEl('plus'), h('span', {}, 'New')),
      h('button', { class: 'hm-slot new', onclick: () => TransferUI.importPick(), 'data-tip': 'A .tablescape file from another DM or another PC' }, iconEl('file-import'), h('span', {}, 'Import')));
    el.slots.replaceChildren(...slots);
    const on = el.slots.querySelector('.hm-slot.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // =====================================================================
  // Actions
  // =====================================================================
  function pick(id) {
    if (list && list.lastId !== id) { list.lastId = id; cmd('campaign.select', { id }); } // (remembered for the next start)
    if (selId === id && view() && view().id === id) return;
    selId = id;
    closeDrawer();
    paint();
  }
  // the picked campaign opens (another one open closes first: its session ends)
  async function ensureOpen() {
    const v = view();
    if (!v || v.broken) return false;
    if (isOpen(v.id)) return true;
    const ending = S && S.campaign && S.campaign.session ? S.campaign.name : null;
    // (UI audit VJ6: a look at another campaign ended the running session without a word)
    if (ending && !(await UI.confirm(`End the session of ${ending}?`, `Opening ${v.name} ends it. The table goes back to its title.`, { ok: 'End it and open', cancel: 'Keep playing', danger: true }))) return false;
    const r = await UI.withLoader('Opening the campaign …', () => cmd('campaign.open', { id: v.id }));
    if (!r || !r.ok) { toast((r && r.error) || 'That campaign could not be opened.', { kind: 'error' }); return false; }
    for (let i = 0; i < 40 && !isOpen(v.id); i++) await new Promise((res) => setTimeout(res, 50)); // (its state is on its way)
    if (ending) toast(`The session of ${ending} has ended`, { ms: 3500 });
    return isOpen(v.id);
  }
  async function play() {
    const v = view();
    if (!v || v.broken) return;
    if (v.session) { cmd('campaign.play'); return; }
    if (!(await ensureOpen())) return;
    const r = await cmd('session.start');
    if (r && r.ok && r.label) toast(r.label, { ms: 5000 });
  }
  async function prepare() {
    if (!(await ensureOpen())) return;
    cmd('campaign.play');
  }
  async function openMap(id) {
    if (!(await ensureOpen())) return;
    await cmd('edit.open', { id });
    cmd('campaign.play');
  }
  async function create() {
    const name = await askText('Name your campaign', '', { ok: 'Create campaign', placeholder: 'Curse of the Ashen Crown' });
    if (!name) return;
    const made = await cmd('campaign.create', { name });
    if (made && made.ok === false) toast(made.error || 'The campaign could not be made.', { kind: 'error' }); // (UI audit VJ7: it said nothing)
    refresh();
  }

  function campaignMenu(c, x, y) {
    if (c.broken) {
      openMenu(x, y, [
        { icon: 'history', label: 'Backups…', action: () => earlier(c) },
        { icon: 'folder', label: 'Show the folder', action: () => window.ts.app('folder.show', { path: c.folder }) },
      ]);
      return;
    }
    openMenu(x, y, [
      { icon: 'player-play', label: 'Play', action: () => { pick(c.id); play(); } },
      { icon: 'pencil', label: 'Rename', action: () => rename(c) },
      { icon: 'folder', label: 'Show in folder', action: () => window.ts.library('open', c.folder) },
      { icon: 'history', label: 'Backups…', action: () => earlier(c) },
      { icon: 'file-export', label: 'Export…', action: () => TransferUI.exportDialog(c) },
      '-',
      { icon: 'trash', label: 'Delete…', danger: true, action: () => askDelete(c) },
    ]);
  }
  async function rename(c) {
    const cur = isOpen(c.id) ? S.campaign.name : c.name;
    const name = await askText('Rename campaign', cur);
    if (name && name !== cur) { await cmd('campaign.rename', { id: c.id, name }); refresh(); }
  }

  // deleting asks first (the little maid is worried); a deleted campaign waits under Recently deleted
  function askDelete(c) {
    const keep = h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Keep it');
    const del = h('button', { class: 'btn danger', onclick: async () => {
      dlg.close();
      closeDrawer();
      const r = await cmd('campaign.delete', { id: c.id });
      if (selId === c.id) selId = null;
      await refresh();
      if (r.ok) toast(`${c.name} deleted`, { undo: async () => { await cmd(r.undo.type, r.undo.payload); selId = c.id; refresh(); } });
      else toast((r && r.error) || `${c.name} could not be deleted.`, { kind: 'error' }); // (UI audit VJ7)
    } }, iconEl('trash'), 'Delete');
    const dlg = UI.dialog(`Delete ${c.name}?`, h('div', { class: 'del-ask' },
      h('p', { class: 'del-what' }, `${plural(c.chapters, 'chapter', 'chapters')}, ${plural(c.maps, 'map', 'maps')} · ${c.lastSession ? `last played ${ago(c.lastSession)}` : 'not played yet'}`),
      h('p', { class: 'faint' }, 'Your library files stay. The campaign waits under Recently deleted.'),
      h('div', { class: 'modal-actions' }, del, keep)), { onClose: null });
    dlg.el.classList.add('del-dialog');
    dlg.el.append(h('div', { class: 'del-maid-box', 'aria-hidden': 'true' },
      h('img', { class: 'del-maid', src: 'maid-worried.webp', alt: '' }),
      ...[1, 2, 3].map((i) => h('span', { class: `del-q q${i}` }, '?'))));
    setTimeout(() => keep.focus(), 0);
  }

  // the campaigns deleted before: back with Restore, or gone for good
  async function recentlyDeleted() {
    const dlg = UI.dialog('Recently deleted', UI.loader('Looking …'), { wide: true });
    const fill = async () => {
      const r = await cmd('campaign.deleted');
      const rows = (r && r.list) || [];
      dlg.body.innerHTML = '';
      if (!rows.length) { dlg.body.append(h('p', { class: 'hint' }, 'Nothing here.')); return; }
      dlg.body.append(h('div', { class: 'del-list' }, ...rows.map((d) => h('div', { class: 'del-row' },
        h('div', { class: 'grow' }, h('b', {}, d.name), h('span', { class: 'faint' }, `${plural(d.chapters, 'chapter', 'chapters')}, ${plural(d.maps, 'map', 'maps')} · deleted ${ago(d.deleted)}`)),
        h('button', { class: 'btn small primary', onclick: async () => { const x = await cmd('campaign.undelete', { key: d.key }); if (x.ok) { toast(`${d.name} is back`); if (x.id) selId = x.id; } else toast((x && x.error) || `${d.name} could not be brought back.`, { kind: 'error' }); refresh(); fill(); } }, iconEl('restore'), 'Restore'),
        h('button', { class: 'btn small danger', 'data-tip': 'Delete it for good: this cannot be undone', onclick: async (e) => {
          const b = e.currentTarget;
          if (!b.classList.contains('sure')) { b.classList.add('sure'); b.lastChild.textContent = 'Sure? Delete for good'; b.dataset.at = String(performance.now()); return; }
          if (performance.now() - Number(b.dataset.at || 0) < 800) return; // (UI audit VH8: a double click is not a "yes": this cannot be undone)
          await cmd('campaign.purge', { key: d.key }); refresh(); fill();
        } }, iconEl('trash'), h('span', {}, 'Delete for good'))))),
        h('p', { class: 'hint' }, 'Kept in the library folder under Campaigns/.trash.'));
    };
    fill();
  }

  // backups made each time the campaign was opened; restoring keeps a copy of the current state first
  async function earlier(c) {
    const dlg = dialog(`Backups of ${c.name}`, UI.loader('Looking …'), { wide: true });
    let rows = null;
    try { rows = await window.ts.app('backups.list', { id: c.id }); } catch { rows = null; }
    dlg.body.innerHTML = '';
    if (!Array.isArray(rows)) { dlg.body.append(h('div', { class: 'dlg-empty' }, 'The backups could not be read.')); return; } // (UI audit VJ7: it stayed on "Looking …")
    if (!rows.length) { dlg.body.append(h('div', { class: 'dlg-empty' }, 'No backups yet. One is made each time you open the campaign.')); return; }
    // (R8: what is kept and that a restore keeps a copy of now: in the Guide and the tips of Campaign settings)
    for (const b of rows) {
      const when = new Date(b.made).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      dlg.body.append(h('div', { class: 'dlg-row' },
        h('div', { class: 'dlg-title' }, iconEl('history'), h('span', { class: 'grow' }, when), b.label ? h('span', { class: 'dlg-sub' }, b.label) : null),
        h('div', { class: 'dlg-sub' }, `${plural(b.chapters, 'chapter', 'chapters')}, ${plural(b.maps, 'map', 'maps')}`),
        h('div', { class: 'dlg-btns' }, h('button', { class: 'btn small', onclick: async () => {
          const r = await window.ts.app('backups.restore', { id: c.id, backup: b.id });
          dlg.close();
          closeDrawer();
          if (r && r.ok) { toast(`${c.name} is back to ${when}. The version before is kept under Backups.`, { ms: 7000 }); refresh(); } else toast((r && r.error) || 'That did not work.', { kind: 'error' });
        } }, iconEl('restore'), 'Restore this version'))));
    }
  }

  // =====================================================================
  // The pop-ups: they slide in from the right, the orange diagonal their edge
  // =====================================================================
  let cur = null; // { kind, back }
  let refs = []; // the open pop-up's binds, run on every state
  let tvOn = false; // Screens on the table: the TV shows the open tab's screen
  let screenTab = 'title';
  const bind = (fn) => { refs.push(fn); fn(); };
  let ext = null; // (Beta 3.18) building a section of Campaign settings (gm.js): its bind, refill and refresh
  const B = (fn) => (ext ? ext.bind(fn) : bind(fn));
  const C = () => S.campaign;
  // Beta 3.18: Campaign settings is a panel like Tablescape settings (gm.js); the home opens the campaign first
  async function campaignSettings(section) {
    if (!(await ensureOpen())) return;
    closeDrawer(true);
    App.openCampaignSettings(section);
  }
  function see(s) { if (!document.getElementById('home') || document.getElementById('home').hidden) S = s; }
  function screensOff() { if (tvOn) { tvOn = false; cmd('screens.preview', { which: null }); } }
  const isDrawerOpen = () => !!cur;

  // the frame every pop-up shares; returns its body
  function frame(kind, title, wide) {
    const close = h('button', { class: 'icon-btn hm-dr-x', 'aria-label': 'Close', 'data-tip': 'Close', 'data-key': 'Esc', onclick: () => closeDrawer() }, iconEl('x'));
    const head = h('div', { class: 'hm-dr-head' },
      h('div', { class: 'hm-dr-top' }, h('span', { class: 'hm-caps' }, S && S.campaign ? S.campaign.name : ''), close),
      h('h2', { class: 'hm-dr-title' }, title));
    const body = h('div', { class: 'hm-dr-body' });
    const panel = h('div', { class: `hm-dr ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title, dataset: { kind } }, head, body);
    const back = h('div', { class: 'hm-dr-back', onpointerdown: (e) => { if (e.target === back) closeDrawer(); } },
      edge(), panel);
    el.drawers.replaceChildren(back);
    cur = { kind, back, head, body };
    return { head, body };
  }
  // the orange line along the panel's slanted edge
  function edge() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'hm-dr-edge');
    svg.setAttribute('aria-hidden', 'true');
    for (const cls of ['glow', 'line']) {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', '90'); l.setAttribute('y1', '0'); l.setAttribute('x2', '0'); l.setAttribute('y2', '100%');
      l.setAttribute('class', cls);
      svg.append(l);
    }
    return svg;
  }
  let leaving = null;
  async function drawer(kind, opts = {}) {
    if (kind === 'check') { closeDrawer(true); App.openOptions('check'); return; } // (Beta 3.19: Tablescape settings → Table check)
    if (!(await ensureOpen())) return;
    closeDrawer(true);
    if (leaving) { leaving.remove(); leaving = null; } // (one still sliding out: gone at once)
    refs = [];
    if (kind === 'screens' || kind === 'settings') { campaignSettings(kind === 'screens' ? 'screens' : 'campaign'); return; } // (Beta 3.18: in Campaign settings)
    if (kind === 'players') playersDrawer(opts);
    if (el.menu.querySelector(`.hm-item[data-id="${kind}"]`)) mark(kind);
  }
  function closeDrawer(quick) {
    if (!cur) return;
    if (tvOn) { tvOn = false; cmd('screens.preview', { which: null }); }
    const { back } = cur;
    cur = null;
    refs = [];
    if (quick) { back.remove(); return; }
    // (Beta 3.38) it slides out the way it came; one still on its way out goes at once when the next one closes
    if (leaving) leaving.remove();
    leaving = back;
    back.classList.add('out');
    setTimeout(() => { back.remove(); if (leaving === back) leaving = null; }, 380);
  }

  // ---------- Players: who plays, who is here today ----------
  function playersDrawer(opts) {
    const { head, body } = frame('players', 'Players');
    const count = h('div', { class: 'hm-dr-sub' });
    head.append(count);
    const rows = h('div', { class: 'hm-pl' });
    bind(() => {
      const c = C(); if (!c) return;
      const away = new Set(c.away || []);
      count.textContent = c.party.length ? `${c.party.length - c.party.filter((n) => away.has(n)).length} of ${c.party.length} here today` : 'No players yet';
      const faces = Object.fromEntries((S.chars || []).map((x) => [x.name, x.face]));
      if (!sig(rows, [c.party, c.away, faces])) return;
      rows.replaceChildren(...c.party.map((n) => {
        const here = !away.has(n);
        return h('div', { class: `hm-pl-row ${here ? '' : 'away'}`, dataset: { name: n } },
          faces[n] ? h('img', { class: 'hm-pl-face', src: faces[n], alt: '' }) : h('span', { class: 'hm-pl-face hm-pc-initial' }, n.slice(0, 1).toUpperCase()),
          h('div', { class: 'grow hm-pl-text' }, h('b', { class: 'pl-name' }, n), h('span', {}, here ? 'Here today' : 'Not here today')),
          h('button', { class: `hm-switch pl-here ${here ? 'on' : ''}`, role: 'switch', 'aria-checked': String(here), 'aria-label': `${n} is here today`, 'data-tip': here ? 'Here today (click: not here today)' : 'Not here today (click: here)', onclick: () => cmd('party.away', { name: n, away: here }) }, h('i')),
          h('button', { class: 'icon-btn', 'aria-label': `Character card of ${n}`, 'data-tip': 'Character card', onclick: () => Characters.openEditor({ state: () => S, name: n }) }, iconEl('id-badge-2')),
          h('button', { class: 'icon-btn faint-btn', 'aria-label': `Rename ${n}`, 'data-tip': 'Rename', onclick: async () => { const nv = await askText('Rename player', n); if (nv && nv.trim() !== n) { const r = await cmd('char.rename', { from: n, to: nv }); if (r && r.error) toast(r.error, { kind: 'error' }); } } }, iconEl('pencil')),
          h('button', { class: 'icon-btn faint-btn', 'aria-label': `Remove ${n}`, 'data-tip': 'Remove from the campaign', onclick: () => removePlayer(n) }, iconEl('x')));
      }));
    });
    function removePlayer(n) {
      const dlg = UI.dialog(`Remove ${n}?`, h('div', { class: 'stack' },
        h('p', {}, `${n} leaves this campaign.`),
        h('p', { class: 'hint' }, `The character card is kept: add ${n} again and it comes back.`),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => dlg.close() }, 'Keep'),
          h('button', { class: 'btn danger', onclick: () => { dlg.close(); cmd('party.set', { names: C().party.filter((x) => x !== n) }); } }, iconEl('trash'), `Remove ${n}`))));
    }
    // several at once, with commas: "Ayla, Bo, Cy"
    const add = h('input', { type: 'text', class: 'pl-add', placeholder: 'Add a player character', 'aria-label': 'New player', spellcheck: 'false' });
    const addIt = () => {
      const names = add.value.split(',').map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && !C().party.includes(x));
      if (!names.length) { add.value = ''; return; }
      cmd('party.set', { names: [...C().party, ...names] }); add.value = '';
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } e.stopPropagation(); });
    body.append(rows, h('div', { class: 'hm-pl-add' }, add, h('button', { class: 'btn', onclick: addIt }, iconEl('plus'), 'Add')));
    if (opts.focusAdd) setTimeout(() => add.focus(), 60);
  }

  // ---------- Screens on the table: the title, the break, the blackout ----------
  // Beta 3.18: a section of Campaign settings (gm.js builds the panel; E: its bind, refill, refresh)
  function screensSection(E) {
    const was = ext; ext = E;
    try {
      const TABS = [{ v: 'title', label: 'Title', icon: 'typography' }, { v: 'brk', label: 'Break', icon: 'coffee' }, { v: 'blackout', label: 'Blackout', icon: 'moon' }];
      const tabs = h('div', { class: 'seg seg-3 cp-tabs', role: 'tablist' }, ...TABS.map((t) => h('button', { class: `seg-btn ${screenTab === t.v ? 'on' : ''}`, role: 'tab', dataset: { v: t.v }, onclick: () => {
        if (screenTab === t.v) return;
        screenTab = t.v;
        if (tvOn) cmd('screens.preview', { which: screenTab }); // the TV shows the screen of the open tab
        E.refill();
      } }, iconEl(t.icon), h('span', {}, t.label))));
      return h('div', { class: 'stack cp-screens' }, tabs, ...(screenTab === 'brk' ? breakForm() : screenTab === 'blackout' ? blackoutForm() : titleForm()));
    } finally { ext = was; }
  }
  const sbind = (fn) => { fn.screens = true; B(fn); };
  const sc = (which) => C().screens[which];
  const set = (which, patch) => cmd('screens.set', { which, patch });
  function field(label, which, key, placeholder) {
    const input = h('input', { type: 'text', spellcheck: 'false', 'aria-label': label, dataset: { k: key }, onchange: (e) => set(which, { [key]: e.target.value }), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); } });
    sbind(() => {
      if (!C()) return;
      if (document.activeElement !== input) input.value = sc(which)[key] || '';
      input.placeholder = typeof placeholder === 'function' ? placeholder() : placeholder;
    });
    return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), input);
  }
  function segField(label, which, key, options) {
    const wrap = h('div', { class: `seg seg-${options.length}`, role: 'radiogroup', 'aria-label': label, dataset: { k: key } },
      ...options.map((o) => h('button', { class: 'seg-btn', role: 'radio', dataset: { v: o.value }, 'data-tip': o.tip || null, onclick: () => set(which, { [key]: o.value }) }, h('span', {}, o.label))));
    sbind(() => { if (!C()) return; const v = sc(which)[key]; for (const b of wrap.children) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-checked', String(b.dataset.v === v)); } });
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), wrap);
  }
  // a picture: the little maid (the default), none, one of this campaign's maps, or one from the PC (copied into the library)
  const picValue = (p) => (!p || p.builtin ? '' : p.none ? '__none' : p.path || '');
  function pictureField(which, extra) {
    const sel = h('select', { 'aria-label': 'Picture', class: 'cp-pic', onchange: (e) => {
      const v = e.target.value;
      if (v === '__pick') { e.target.value = picValue(sc(which).pic); pickPic(which); return; }
      set(which, v === '__none' ? { pic: 'none' } : v ? { pic: { path: v }, ...(extra || {}) } : { pic: null, ...(extra || {}) });
    } });
    sbind(() => {
      const c = C(); if (!c) return;
      const cur0 = sc(which).pic;
      const maps = c.chapters.flatMap((ch) => ch.maps).filter((m) => m.bgPath && !m.missing);
      if (!sig(sel, [maps.map((m) => m.bgPath), picValue(cur0)])) return;
      sel.innerHTML = '';
      sel.append(h('option', { value: '' }, 'The little maid (default)'), h('option', { value: '__none' }, 'No picture'));
      if (cur0 && cur0.path && !maps.some((m) => m.bgPath === cur0.path)) sel.append(h('option', { value: cur0.path }, `${cur0.name}${cur0.missing ? ' (file missing)' : ''}`));
      if (maps.length) sel.append(h('optgroup', { label: 'This campaign\'s maps' }, ...maps.map((m) => h('option', { value: m.bgPath }, m.name))));
      sel.append(h('option', { value: '__pick' }, 'A picture from the PC …'));
      sel.value = picValue(cur0);
    });
    return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Picture'), sel);
  }
  async function pickPic(which) {
    const r = await cmd('screens.pick', { which });
    if (r && !r.ok && r.error) toast(r.error, { kind: 'error' });
  }
  // a small picture of the TV with the screen on it (one side; the TV shows it for both long sides)
  function preview(which) {
    const box = h('div', { class: `cp-tv cp-tv-${which}` });
    sbind(() => {
      const c = C(); if (!c) return;
      const x = sc(which);
      if (!sig(box, [which, x, c.name])) return;
      box.innerHTML = '';
      const pic = (p) => (!p || p.none || p.missing ? null : p.builtin ? h('img', { class: 'cp-tv-pic fit', src: p.small, alt: '' }) : Thumbs.img(p.path, p.kind, null, 'cp-tv-pic cover-img'));
      if (which === 'title') {
        box.append(pic(x.pic) || h('span'), h('div', { class: 'cp-tv-veil' }),
          h('div', { class: 'cp-tv-title' }, h('b', {}, x.title.trim() || c.name), h('i', {}), x.sub.trim() ? h('span', {}, x.sub.trim()) : null));
      } else if (which === 'brk') {
        box.dataset.bg = x.bg;
        box.append(x.bg === 'picture' ? pic(x.pic) || h('span') : x.bg === 'map' ? h('div', { class: 'cp-tv-map' }) : h('span'), h('div', { class: 'cp-tv-veil' }),
          h('div', { class: 'cp-tv-dial' }, h('b', {}, '9:41'), h('span', {}, x.label.trim() || 'Break')), x.text.trim() ? h('div', { class: 'cp-tv-note' }, x.text.trim()) : '');
      } else {
        box.dataset.style = x.style;
        box.append(x.style === 'picture' ? pic(x.pic) || h('span') : h('span'),
          h('div', { class: 'cp-tv-black' }, x.style === 'title' ? h('b', {}, c.name) : null, x.text.trim() ? h('span', {}, x.text.trim()) : null));
      }
    });
    return box;
  }
  function onTv() {
    const E = ext;
    const b = h('button', { class: 'btn wide cp-ontv' });
    sbind(() => { b.classList.toggle('primary', !tvOn); b.replaceChildren(iconEl(tvOn ? 'eye-off' : 'eye'), tvOn ? 'Take it off the table' : 'Show it on the table'); });
    b.addEventListener('click', () => {
      tvOn = !tvOn;
      cmd('screens.preview', { which: tvOn ? screenTab : null });
      if (E) E.refresh(); else for (const f of refs) f();
    });
    return b;
  }
  function titleForm() {
    return [preview('title'),
      field('Title', 'title', 'title', () => C().name),
      field('Line under it', 'title', 'sub', 'Nothing (or: Chapter 2, The Sunken Keep)'),
      pictureField('title'),
      onTv()];
  }
  function breakForm() {
    const picRow = pictureField('brk', { bg: 'picture' });
    sbind(() => { if (C()) picRow.hidden = sc('brk').bg !== 'picture'; });
    return [preview('brk'),
      field('On the dial', 'brk', 'label', 'Break'),
      field('A line of text', 'brk', 'text', 'Snacks are in the kitchen'),
      segField('Behind it', 'brk', 'bg', [{ value: 'map', label: 'Blurred map' }, { value: 'picture', label: 'Picture' }, { value: 'dark', label: 'Dark' }]),
      picRow,
      onTv()];
  }
  function blackoutForm() {
    const picRow = pictureField('blackout', { style: 'picture' });
    sbind(() => { if (C()) picRow.hidden = sc('blackout').style !== 'picture'; });
    return [preview('blackout'),
      segField('Looks like', 'blackout', 'style', [{ value: 'black', label: 'Black' }, { value: 'title', label: 'Campaign name', tip: 'The campaign\'s name, faintly' }, { value: 'picture', label: 'Dark picture' }]),
      field('A line of text', 'blackout', 'text', 'Nothing (or: We\'ll be right back)'),
      picRow,
      onTv()];
  }

  // ---------- Campaign settings → Campaign: rename, cover, folder, backups, export, delete (Beta 3.18: in the panel) ----------
  let coverOpen = false; // the cover picker instead of the rows
  function campaignSection(E) {
    const was = ext; ext = E;
    try { return coverOpen ? coverPicker(E) : campaignRows(); } finally { ext = was; }
  }
  function campaignRows() {
    const E = ext;
    const sub = h('div', { class: 'hm-dr-sub hm-set-sub' });
    const rowsEl = h('div', { class: 'hm-set' });
    // (UI audit VJ10: tip: what a second line used to explain; a second line is for a value, like the campaign's name)
    const row = (id, icon, title, subText, run, danger, tip) => h('button', { class: `hm-set-row ${danger ? 'danger' : ''}`, dataset: { id }, 'data-tip': tip || null, onclick: run },
      iconEl(icon), h('span', { class: 'grow hm-set-text' }, h('b', {}, title), subText ? h('span', {}, subText) : null), iconEl('chevron-right'));
    B(() => {
      const c = C(); if (!c) return;
      const maps = c.chapters.reduce((n, ch) => n + ch.maps.length, 0);
      sub.textContent = `${plural(c.chapters.length, 'chapter', 'chapters')} · ${plural(maps, 'map', 'maps')}`;
      const coverName = c.coverPick && c.coverPick.name ? c.coverPick.name : 'The first map';
      const it = items().find((x) => x.id === c.id) || { id: c.id, name: c.name, chapters: c.chapters.length, maps, lastSession: c.lastSession, folder: c.folder };
      if (!sig(rowsEl, [c.name, coverName, c.folder, maps])) return;
      rowsEl.replaceChildren(
        row('rename', 'pencil', 'Rename', c.name, () => rename({ id: c.id, name: c.name })),
        row('cover', 'photo', 'Cover picture', coverName, () => { coverOpen = true; E.refill(); }),
        row('folder', 'folder', 'Show in folder', null, () => window.ts.library('open', c.folder)),
        row('backups', 'history', 'Backups', null, () => earlier({ id: c.id, name: c.name }), false, 'A copy each time it opens; kept for three months'),
        row('export', 'file-export', 'Export', null, () => TransferUI.exportDialog({ id: c.id, name: c.name }), false, 'One file to share or keep'),
        h('div', { class: 'hm-set-gap' }),
        row('delete', 'trash', 'Delete campaign…', null, () => askDelete(it), true, 'Kept under Recently deleted until you empty it'));
    });
    return h('div', { class: 'stack hm-set-wrap' }, sub, rowsEl);
  }
  // the cover: any map of the campaign, or the first map (the default)
  function coverPicker(E) {
    const grid = h('div', { class: 'hm-cover-grid' });
    const back = h('button', { class: 'btn ghost small hm-back', onclick: () => { coverOpen = false; E.refill(); } }, iconEl('arrow-left'), 'Campaign');
    B(() => {
      const c = C(); if (!c) return;
      const chosen = c.coverPick && c.coverPick.path;
      const maps = c.chapters.flatMap((ch) => ch.maps).filter((m) => m.bgPath && !m.missing && m.bgKind !== 'audio');
      if (!sig(grid, [maps.map((m) => m.bgPath), chosen])) return;
      const tile = (on, label, pic, run) => h('button', { class: `hm-cover ${on ? 'on' : ''}`, onclick: run }, pic, h('span', { class: 'ellipsis' }, label));
      grid.replaceChildren(
        tile(!chosen, 'The first map', h('div', { class: 'hm-cover-pic hm-nopic' }, iconEl('map-2')), () => cmd('campaign.cover', { path: null })),
        ...maps.map((m) => tile(chosen === m.bgPath, m.name, h('div', { class: 'hm-cover-pic' }, Thumbs.img(m.bgPath, m.bgKind, null, 'cover-img')), () => cmd('campaign.cover', { path: m.bgPath, name: m.name }))));
    });
    return h('div', { class: 'stack' }, back, h('div', { class: 'hm-caps hm-cover-h' }, 'Cover picture'), grid);
  }

  // ---------- the table check: is everything ready before the players sit down ----------
  // Beta 3.19: Tablescape settings → Table check (gm.js builds the panel; E: its bind, refill, refresh)
  function checkSection(E) {
    const was = ext; ext = E;
    try { return checkBody(E); } finally { ext = was; }
  }
  function checkBody(E) {
    const listEl = h('div', { class: 'chk-list' });
    const again = async () => { await loadDevices(); E.refresh(); };
    again();
    B(() => {
      const rows = checks();
      if (!sig(listEl, rows.map((r) => [r.id, r.state, r.text, r.sub]))) return;
      listEl.replaceChildren(...rows.map((r) => h('div', { class: `chk-row ${r.state}`, dataset: { id: r.id } },
        iconEl(r.state === 'ok' ? 'circle-check' : r.state === 'warn' ? 'alert-triangle' : 'circle-dashed'),
        h('div', { class: 'grow chk-text' }, h('b', {}, r.text), r.sub ? h('span', {}, r.sub) : null),
        r.action ? h('button', { class: 'btn small', onclick: r.action.fn }, r.action.icon ? iconEl(r.action.icon) : null, r.action.label) : null)));
    });
    return h('div', { class: 'stack' }, listEl, h('div', { class: 'ctl-row' }, h('button', { class: 'btn small ghost', onclick: again, 'data-tip': 'Look for the speakers again' }, iconEl('refresh'), 'Check again')));
  }
  function checks() {
    const s = S; const c = s.screen !== 'home' ? s.campaign : null; const st = s.settings || {}; const v = s.view;
    const rows = [];
    const d = v.displays.find((x) => x.id === v.playerDisplayId);
    const tvName = d ? d.name.replace(/ – this screen$/, '') : 'the TV';
    rows.push(s.table.open
      ? { id: 'tv', state: v.windowed ? 'warn' : 'ok', text: v.windowed ? 'The table is a window on this screen' : `The table is open on ${tvName}`, sub: v.windowed ? 'Only one screen is connected' : null }
      : { id: 'tv', state: 'warn', text: 'The table window is closed', action: { label: 'Open it', icon: 'device-tv', fn: () => cmd('table.open') } });
    rows.push(v.calibrated
      ? { id: 'size', state: 'ok', text: 'One inch is one inch', sub: `Calibrated: ${Math.round(v.ppi * 10) / 10} pixels an inch` }
      : { id: 'size', state: 'warn', text: 'Not calibrated', sub: 'The size comes from the screen diagonal', action: { label: 'Calibrate', icon: 'credit-card', fn: () => App.openOptions('tv') } });
    const known = (id) => !id || !devices || devices.some((x) => x.id === id);
    const music = st.soundOut ? st.soundOutLabel || 'The chosen speaker' : 'The system\'s speaker';
    rows.push({ id: 'music', state: known(st.soundOut) ? 'ok' : 'warn', text: `Ambience and music: ${music}`, sub: known(st.soundOut) ? null : 'Not connected right now', action: { label: 'Test', icon: 'volume', fn: () => window.ts.sound('test', { which: 'music' }) } });
    const fxSame = st.fxOut == null;
    const fx = fxSame ? 'the same speaker' : st.fxOut ? st.fxOutLabel || 'The chosen speaker' : 'The system\'s speaker';
    rows.push({ id: 'fx', state: fxSame || known(st.fxOut) ? 'ok' : 'warn', text: `Effects: ${fx}`, sub: fxSame || known(st.fxOut) ? null : 'Not connected right now', action: { label: 'Test', icon: 'volume', fn: () => window.ts.sound('test', { which: 'fx' }) } });
    const sp = s.spotify || {};
    rows.push(sp.linked
      ? { id: 'spotify', state: 'ok', text: `Spotify: linked${sp.user ? ` as ${sp.user}` : ''}`, sub: sp.deviceName ? `Plays on ${sp.deviceName}` : 'Plays on the Spotify app that is open' }
      : { id: 'spotify', state: 'off', text: 'Spotify: not linked', sub: 'Optional: Toolbox → Spotify' });
    if (c) {
      let missing = 0;
      for (const ch of c.chapters) { missing += ch.maps.filter((m) => m.missing).length; if (ch.ambience && ch.ambience.missing) missing++; if (ch.fight && ch.fight.missing) missing++; }
      rows.push(missing
        ? { id: 'files', state: 'warn', text: `${plural(missing, 'file is', 'files are')} missing`, sub: 'On the map screen: the chapter\'s menu → Missing files …' }
        : { id: 'files', state: 'ok', text: 'All maps and sounds are there' });
      const here = c.party.filter((n) => !(c.away || []).includes(n)).length;
      rows.push(c.party.length
        ? { id: 'players', state: 'ok', text: `${here} of ${plural(c.party.length, 'player', 'players')} here today` }
        : { id: 'players', state: 'off', text: 'No players yet', sub: '', action: s.screen === 'play' ? null : { label: 'Players', icon: 'users', fn: () => { App.closeOptions(); drawer('players', { focusAdd: true }); } } });
    }
    return rows;
  }

  // =====================================================================
  // Keys, like a game's menu: up and down through PLAY … Options, left and right through the campaigns, Esc closes
  // =====================================================================
  function onKey(e) {
    if (!root || root.hidden || !S || (S.screen !== 'home' && S.screen !== 'campaign')) return;
    if (e.key === 'Escape' && cur && !document.querySelector('.modal-back') && !(window.App && App.optionsOpen && App.optionsOpen()) && !(window.Guide && Guide.isOpen())) { e.preventDefault(); e.stopImmediatePropagation(); closeDrawer(); return; }
    const t = e.target;
    if (cur || e.ctrlKey || e.altKey || e.metaKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) return;
    if (document.querySelector('.modal-back') || (window.App && App.optionsOpen && App.optionsOpen()) || (window.Guide && Guide.isOpen()) || UI.menuOpen()) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const nav = [...el.menu.querySelectorAll('.hm-item')].filter((b) => !b.hidden && b.offsetParent);
      if (!nav.length) return;
      e.preventDefault();
      const i = nav.findIndex((b) => b.dataset.id === navSel);
      const n = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + nav.length) % nav.length;
      mark(nav[n].dataset.id);
      nav[n].focus({ preventScroll: true });
    } else if ((e.key === 'Enter' || e.key === ' ') && !(t && t.tagName === 'BUTTON' && !t.classList.contains('hm-item'))) {
      const b = el.menu.querySelector(`.hm-item[data-id="${navSel}"]`);
      if (!b) return;
      e.preventDefault();
      b.click();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const all = items();
      if (!all.length) return;
      e.preventDefault();
      const v = view();
      const i = Math.max(0, all.findIndex((c) => v && c.id === v.id));
      const n = Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)));
      if (n !== i) pick(all[n].id);
    }
  }

  // a video cover rests while the maps are open (the home is hidden then)
  function active(on) {
    if (!el.bg) return;
    for (const v of el.bg.querySelectorAll('video')) { if (on) v.play().catch(() => {}); else v.pause(); }
  }

  return { picked: () => { const v = view(); return v && !v.broken ? v.id : null; }, mount, update, show, page, earlier, refresh, isDrawerOpen, closeDrawer, drawer, active, see, screensOff, screensSection, campaignSection, campaignSettings, checkSection, coverBack: () => { coverOpen = false; } };
})();
