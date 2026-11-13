// Start screen and the campaign's page.
//   Start screen   continue the last campaign, or pick one; a campaign opens on its page, not on the maps
//   Campaign page  Start session (the title on the TV, then the maps), Prepare the maps (the TV stays dark);
//                  the players and who is here today (only they join Initiative); the campaign's screens on
//                  the TV (the title, the break, the blackout); a table check before you start
'use strict';

const Home = (() => {
  const { h, iconEl, Thumbs, toast, openMenu, askText, relTime, dialog } = UI;
  const cmd = (type, payload) => window.ts.cmd(type, payload);
  let root;
  let renderedFor = '';

  function mount(el) {
    root = el;
  }

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
  function sessionsLine(c) {
    const parts = [c.lastSession ? `Last played ${ago(c.lastSession)}` : 'Not played yet'];
    if (c.players) parts.push(plural(c.players, 'player', 'players'));
    return parts.join(' · ');
  }

  // =====================================================================
  // Start screen
  // =====================================================================
  async function show(force) {
    const res = await cmd('campaign.list');
    const tips = await window.ts.app('tips').catch(() => null);
    const about = await window.ts.app('about').catch(() => null);
    const sig = JSON.stringify([res.campaigns.map((c) => [c.id, c.name, c.updated, c.coverThumb, c.lastSession, c.players, c.broken, c.backups]), tips, res.deleted]);
    if (!force && sig === renderedFor && root.childElementCount && !pageFor) return;
    renderedFor = sig;
    pageFor = null;
    render(res.campaigns, res.lastId, tips, about, res.deleted || 0);
  }

  function cover(c, cls) {
    if (!c.coverPath) return h('div', { class: `${cls} cover-empty` }, iconEl('map-2'));
    return h('div', { class: cls }, Thumbs.img(c.coverPath, c.coverKind, c.coverThumb, 'cover-img'));
  }

  // three first steps, ticked off as they are done; gone once all are done or dismissed
  function firstSteps(tips, hasDemo) {
    if (!tips || tips.hidden || (tips.tv && tips.calib && tips.sent)) return null;
    const step = (done, title, text, action) => h('li', { class: `fs-step ${done ? 'done' : ''}` },
      iconEl(done ? 'circle-check' : 'circle'), h('div', {}, h('b', {}, title), h('span', {}, text)), done || !action ? null : action);
    return h('section', { class: 'first-steps' },
      h('div', { class: 'fs-head' }, h('h2', {}, 'First steps'),
        h('button', { class: 'icon-btn', 'aria-label': 'Hide the first steps', 'data-tip': 'Hide', onclick: async () => { await window.ts.app('tips.hide'); show(true); } }, iconEl('x'))),
      h('ol', {},
        step(tips.tv, 'Open the table on your TV', 'Options → TV: pick the TV; the table window opens full screen on it.', h('button', { class: 'btn small', onclick: () => App.openOptions('tv') }, iconEl('device-tv'), 'Choose the TV')),
        step(tips.calib, 'Make one inch one inch', 'Hold a bank card against the TV and match the outline, so the grid fits your miniatures.', h('button', { class: 'btn small', onclick: () => App.openOptions('tv') }, iconEl('credit-card'), 'Calibrate')),
        step(tips.sent, 'Send a map to the table', `Open ${hasDemo ? 'the demo campaign' : 'a campaign'} below, then Prepare the maps, pick a map and press T (Send to table).`, null)));
  }
  function header(about, back) {
    return h('header', { class: 'home-head' },
      back ? h('div', { class: 'cp-headl' }, h('button', { class: 'btn ghost back-btn', onclick: back, 'data-tip': 'All your campaigns' }, iconEl('arrow-left'), 'Campaigns'))
        : h('h1', { class: 'wordmark' }, 'Tablescape', about ? h('span', { class: 'release' }, about.label) : null),
      h('div', { class: 'home-actions' },
        // Beta 3.0: the community and the tip jar, on the start screen only (never on the map screen)
        h('button', { class: 'btn ghost home-link', 'data-tip': 'Tablescape on Discord: help, bug reports, ideas, news', onclick: () => window.ts.app('link.open', { to: 'discord' }) }, iconEl('logo-discord'), 'Discord'),
        h('button', { class: 'btn ghost home-link', 'data-tip': 'Support Tablescape on Ko-fi', onclick: () => window.ts.app('link.open', { to: 'kofi' }) }, iconEl('logo-kofi'), 'Toss a coin'),
        h('span', { class: 'home-sep', 'aria-hidden': 'true' }),
        h('button', { class: 'btn ghost', 'data-tip': 'Guide: first evening, keys, what\'s new, report a problem (?)', onclick: () => Guide.open('start') }, iconEl('book'), 'Guide'),
        h('button', { class: 'btn ghost', 'data-tip': 'Open the folder with your maps, tokens and effects', onclick: () => window.ts.library('open') }, iconEl('folder'), 'Library folder'),
        h('button', { class: 'btn ghost', 'data-tip': 'The TV and its size, picture, sound, performance (Ctrl ,)', onclick: () => App.openOptions() }, iconEl('settings'), 'Options')),
      // Prototype 21: updates. Beta 3.0: in a row of their own under the title, only while there is something to say
      // (beside the title they pushed the buttons off a smaller window)
      h('div', { class: 'upd-slot' }));
  }
  function render(list, lastId, tips, about, deletedN = 0) {
    setTimeout(() => { if (window.App && App.updateSlot) App.updateSlot(); }, 0); // (Prototype 21: the update display into the new header)
    root.innerHTML = '';
    root.classList.remove('on-page');
    const last = list.find((c) => c.id === lastId) || null;
    const parts = [header(about)];
    const fs = firstSteps(tips, list.some((c) => /^Demo:/.test(c.name || '')));
    if (fs) parts.push(fs);

    if (last) {
      parts.push(h('div', { class: 'hero', role: 'button', tabindex: '0', onclick: () => open(last.id), onkeydown: (e) => { if (e.key === 'Enter') open(last.id); } },
        cover(last, 'hero-bg'), h('div', { class: 'hero-shade' }),
        h('div', { class: 'hero-text' },
          h('span', { class: 'hero-label' }, 'Continue'),
          h('span', { class: 'hero-name' }, last.name),
          h('span', { class: 'hero-meta' }, sessionsLine(last)),
          h('span', { class: 'btn primary hero-btn' }, iconEl('player-play'), 'Open the campaign'))));
    }

    const grid = h('div', { class: 'camp-grid' });
    for (const c of list) {
      if (c.broken) { grid.append(brokenTile(c)); continue; }
      const more = h('button', {
        class: 'icon-btn camp-more', 'aria-label': `More for ${c.name}`, 'data-tip': 'More',
        onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); campaignMenu(c, r.left, r.bottom + 4); },
      }, iconEl('dots'));
      grid.append(h('div', {
        class: 'camp', tabindex: '0', role: 'button', dataset: { id: c.id },
        onclick: () => open(c.id),
        onkeydown: (e) => { if (e.key === 'Enter') open(c.id); },
        oncontextmenu: (e) => { e.preventDefault(); campaignMenu(c, e.clientX, e.clientY); },
      },
      h('div', { class: 'camp-top' }, cover(c, 'camp-cover'), h('span', { class: 'camp-name' }, c.name)),
      h('div', { class: 'camp-text' },
        h('span', { class: 'camp-meta' }, sessionsLine(c)),
        h('span', { class: 'camp-meta faint' }, `${plural(c.chapters, 'chapter', 'chapters')}, ${plural(c.maps, 'map', 'maps')} · ${relTime(c.updated)}`)),
      more));
    }
    grid.append(h('button', { class: 'camp camp-new', onclick: create }, iconEl('plus'), h('span', {}, 'New campaign')),
      h('button', { class: 'camp camp-new camp-import', onclick: () => TransferUI.importPick(), 'data-tip': 'A .tablescape file from another DM or another PC' }, iconEl('file-import'), h('span', {}, 'Import a campaign'))); // 4.6

    parts.push(h('section', { class: 'home-section' }, h('h2', {}, 'Campaigns'), grid,
      deletedN ? h('button', { class: 'btn ghost small del-link', onclick: recentlyDeleted }, iconEl('trash'), `Recently deleted (${deletedN})`) : null));
    root.append(h('div', { class: 'home-inner' }, ...parts));
  }

  // Beta 1: a campaign whose campaign.json can't be read any more: its backups are still there
  function brokenTile(c) {
    const more = h('button', {
      class: 'icon-btn camp-more', 'aria-label': `More for ${c.name}`, 'data-tip': 'More',
      onclick: (e) => {
        e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
        openMenu(r.left, r.bottom + 4, [
          { icon: 'history', label: 'Backups…', action: () => earlier(c) },
          { icon: 'folder', label: 'Show the folder', action: () => window.ts.app('folder.show', { path: c.folder }) },
        ]);
      },
    }, iconEl('dots'));
    return h('div', {
      class: 'camp camp-broken', tabindex: '0', role: 'button', dataset: { id: c.id }, 'data-tip': 'Its campaign.json could not be read (half written, or changed by hand)',
      onclick: () => earlier(c), onkeydown: (e) => { if (e.key === 'Enter') earlier(c); },
    },
    h('div', { class: 'camp-top' }, h('div', { class: 'camp-cover cover-empty' }, iconEl('alert-triangle')), h('span', { class: 'camp-name' }, c.name)),
    h('div', { class: 'camp-text' },
      h('span', { class: 'camp-meta' }, 'This campaign\'s file is damaged'),
      h('span', { class: 'camp-meta faint' }, c.backups ? `${plural(c.backups, 'earlier version', 'earlier versions')} kept: click to bring one back` : 'No earlier versions kept')),
    more);
  }

  async function open(id) {
    const r = await UI.withLoader('Opening the campaign …', () => cmd('campaign.open', { id }));
    if (!r.ok) toast(r.error || 'That campaign could not be opened.', { kind: 'error' });
  }

  async function create() {
    const name = await askText('Name your campaign', '', { ok: 'Create campaign', placeholder: 'Curse of the Ashen Crown' });
    if (!name) return;
    await cmd('campaign.create', { name });
  }

  function campaignMenu(c, x, y) {
    openMenu(x, y, [
      { icon: 'player-play', label: 'Open', action: () => open(c.id) },
      { icon: 'pencil', label: 'Rename', action: async () => {
        const name = await askText('Rename campaign', c.name);
        if (name) { await cmd('campaign.rename', { id: c.id, name }); show(true); }
      } },
      { icon: 'folder', label: 'Show in folder', action: () => window.ts.library('open', c.folder) },
      { icon: 'history', label: 'Backups…', action: () => earlier(c) },
      { icon: 'file-export', label: 'Export…', action: () => TransferUI.exportDialog(c) }, // 4.6
      '-',
      { icon: 'trash', label: 'Delete…', danger: true, action: () => askDelete(c) },
    ]);
  }

  // 2.4: deleting asks first (the little maid is worried); a deleted campaign waits under Recently deleted
  function askDelete(c) {
    const keep = h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Keep it');
    const del = h('button', { class: 'btn danger', onclick: async () => {
      dlg.close();
      const r = await cmd('campaign.delete', { id: c.id });
      show(true);
      if (r.ok) toast(`${c.name} deleted`, { undo: async () => { await cmd(r.undo.type, r.undo.payload); show(true); } });
    } }, iconEl('trash'), 'Delete');
    const dlg = UI.dialog(`Delete ${c.name}?`, h('div', { class: 'del-ask' },
      h('p', { class: 'del-what' }, `${plural(c.chapters, 'chapter', 'chapters')}, ${plural(c.maps, 'map', 'maps')} · ${c.lastSession ? `last played ${ago(c.lastSession)}` : 'not played yet'}`),
      h('p', { class: 'faint' }, 'Your library files stay. The campaign waits under Recently deleted.'),
      h('div', { class: 'modal-actions' }, del, keep)), { onClose: null });
    dlg.el.classList.add('del-dialog');
    // 2.5: the little maid stands beside it, worried; question marks rise above her like bubbles
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
      const list = (r && r.list) || [];
      dlg.body.innerHTML = '';
      if (!list.length) { dlg.body.append(h('p', { class: 'hint' }, 'Nothing here.')); return; }
      dlg.body.append(h('div', { class: 'del-list' }, ...list.map((d) => h('div', { class: 'del-row' },
        h('div', { class: 'grow' }, h('b', {}, d.name), h('span', { class: 'faint' }, `${plural(d.chapters, 'chapter', 'chapters')}, ${plural(d.maps, 'map', 'maps')} · deleted ${ago(d.deleted)}`)),
        h('button', { class: 'btn small primary', onclick: async () => { const x = await cmd('campaign.undelete', { key: d.key }); if (x.ok) toast(`${d.name} is back`); show(true); fill(); } }, iconEl('restore'), 'Restore'),
        h('button', { class: 'btn small danger', 'data-tip': 'Delete it for good: this cannot be undone', onclick: async (e) => {
          const b = e.currentTarget;
          if (!b.classList.contains('sure')) { b.classList.add('sure'); b.lastChild.textContent = 'Sure? Delete for good'; return; }
          await cmd('campaign.purge', { key: d.key }); show(true); fill();
        } }, iconEl('trash'), h('span', {}, 'Delete for good'))))),
        h('p', { class: 'hint' }, 'Kept in the library folder under .cache/trash.'));
    };
    fill();
  }

  // backups made each time the campaign was opened; restoring keeps a copy of the current state first
  async function earlier(c) {
    const dlg = dialog(`Backups of ${c.name}`, UI.loader('Looking …'), { wide: true });
    const list = await window.ts.app('backups.list', { id: c.id });
    dlg.body.innerHTML = '';
    if (!list.length) { dlg.body.append(h('div', { class: 'dlg-empty' }, 'No backups yet. One is made each time you open the campaign.')); return; }
    dlg.body.append(h('div', { class: 'hint' }, 'A copy is made each time you open the campaign; the last 10 are kept. Restoring keeps a copy of how it is now.'));
    for (const b of list) {
      const when = new Date(b.made).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      dlg.body.append(h('div', { class: 'dlg-row' },
        h('div', { class: 'dlg-title' }, iconEl('history'), h('span', { class: 'grow' }, when), b.label ? h('span', { class: 'dlg-sub' }, b.label) : null),
        h('div', { class: 'dlg-sub' }, `${plural(b.chapters, 'chapter', 'chapters')}, ${plural(b.maps, 'map', 'maps')}`),
        h('div', { class: 'dlg-btns' }, h('button', { class: 'btn small', onclick: async () => {
          const r = await window.ts.app('backups.restore', { id: c.id, backup: b.id });
          dlg.close();
          if (r && r.ok) { toast(`${c.name} is back to ${when}. The version before is kept under Backups.`, { ms: 7000 }); show(true); } else toast((r && r.error) || 'That did not work.', { kind: 'error' });
        } }, iconEl('restore'), 'Restore this version'))));
    }
  }

  // =====================================================================
  // The campaign's page
  // =====================================================================
  let pageFor = null; // the campaign id the page was built for
  let refs = [];
  let S = null;
  let devices = null; // the speakers the sound window knows (for the table check)
  let screenTab = 'title';
  const bind = (fn) => { refs.push(fn); fn(); };
  const C = () => S.campaign;

  function page(s, force) {
    S = s;
    if (!s.campaign) return;
    if (force || pageFor !== s.campaign.id || !root.querySelector('.cp')) buildPage();
    for (const f of refs) f();
  }

  async function loadDevices() {
    devices = (await window.ts.sound('devices').catch(() => null)) || null;
    for (const f of refs) f();
  }

  function buildPage() {
    pageFor = S.campaign.id;
    tvOn = false;
    renderedFor = '';
    refs = [];
    root.innerHTML = '';
    root.classList.add('on-page');
    loadDevices();

    // ---------- the top: cover, name, sessions, Start session ----------
    const bg = h('div', { class: 'cp-hero-bg' });
    bind(() => {
      const c = C();
      const m = c.chapters.flatMap((ch) => ch.maps).find((x) => x.bgPath && !x.missing && x.bgKind !== 'audio');
      const key = m ? m.bgPath : '';
      if (bg.dataset.key === key) return;
      bg.dataset.key = key;
      bg.replaceChildren(...(m ? [Thumbs.img(m.bgPath, m.bgKind, null, 'cover-img')] : []));
    });
    const name = h('h1', { class: 'cp-name' });
    const meta = h('div', { class: 'cp-meta' });
    bind(() => {
      const c = C();
      name.textContent = c.name;
      const maps = c.chapters.reduce((n, ch) => n + ch.maps.length, 0);
      const parts = [c.lastSession ? `Last played ${ago(c.lastSession)}` : 'Not played yet'];
      parts.push(`${plural(c.chapters.length, 'chapter', 'chapters')}, ${plural(maps, 'map', 'maps')}`);
      meta.textContent = parts.join(' · ');
    });
    const start = h('button', { class: 'btn primary big cp-start', onclick: startOrBack });
    const prep = h('button', { class: 'btn big cp-prep', onclick: () => cmd('campaign.play'), 'data-tip': 'Open the maps without starting: the table stays as it is' }, iconEl('map-2'), 'Prepare the maps');
    const running = h('span', { class: 'cp-running' });
    bind(() => {
      const c = C();
      start.replaceChildren(iconEl('player-play'), c.session ? 'Back to the table' : 'Start session');
      start.dataset.tip = c.session ? 'The maps, as you left them' : 'The title shows on the table until you send the first map (T)';
      prep.hidden = !!c.session;
      running.hidden = !c.session;
      if (c.session) running.textContent = `The session is running, since ${new Date(c.session.started).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    });
    const nameMenu = h('button', { class: 'icon-btn cp-more', 'aria-label': 'More for this campaign', 'data-tip': 'Rename, folder, earlier versions, export', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const c = C();
      openMenu(r.left, r.bottom + 4, [
        { icon: 'pencil', label: 'Rename', action: async () => { const n = await askText('Rename campaign', c.name); if (n) await cmd('campaign.rename', { id: c.id, name: n }); } },
        { icon: 'folder', label: 'Show in folder', action: () => window.ts.library('open', c.folder) },
        { icon: 'history', label: 'Backups…', action: () => earlier({ id: c.id, name: c.name }) },
        { icon: 'file-export', label: 'Export…', action: () => TransferUI.exportDialog({ id: c.id, name: c.name }) }, // 4.6
      ]);
    } }, iconEl('dots'));
    const hero = h('section', { class: 'cp-hero' }, bg, h('div', { class: 'cp-hero-shade' }),
      h('div', { class: 'cp-hero-text' },
        h('span', { class: 'cp-label' }, 'Campaign'),
        h('div', { class: 'cp-name-row' }, name, nameMenu),
        meta,
        h('div', { class: 'cp-actions' }, start, prep, running)));

    const cols = h('div', { class: 'cp-cols' }, playersCard(), screensCard(), checkCard());
    root.append(h('div', { class: 'home-inner cp' }, header(null, () => cmd('campaign.home')), hero, cols));
    if (window.App && App.updateSlot) App.updateSlot(); // (Prototype 21)
  }
  async function startOrBack() {
    if (C().session) { cmd('campaign.play'); return; }
    const r = await cmd('session.start');
    if (r && r.ok && r.label) toast(r.label, { ms: 5000 });
  }

  function card(icon, title, ...kids) {
    const head = h('div', { class: 'cp-card-head' }, iconEl(icon), h('h2', {}, title));
    return { el: h('section', { class: 'cp-card' }, head, ...kids), head };
  }

  // ---------- players: who plays, who is here today ----------
  function playersCard() {
    const count = h('span', { class: 'cp-count' });
    const list = h('div', { class: 'pl-list' });
    bind(() => {
      const c = C();
      const away = new Set(c.away || []);
      const sig = JSON.stringify([c.party, c.away]);
      count.textContent = c.party.length ? `${c.party.length - c.party.filter((n) => away.has(n)).length} of ${c.party.length} here` : '';
      if (list.dataset.sig === sig) return;
      list.dataset.sig = sig;
      list.innerHTML = '';
      if (!c.party.length) list.append(h('p', { class: 'hint' }, 'No players yet. Add them once: they join Initiative by themselves.'));
      for (const n of c.party) {
        const here = !away.has(n);
        list.append(h('div', { class: `pl-row ${here ? '' : 'away'}`, dataset: { name: n } },
          h('button', { class: `pl-here ${here ? 'on' : ''}`, role: 'switch', 'aria-checked': String(here), 'aria-label': `${n} is here today`, 'data-tip': here ? 'Here today (click: not here today)' : 'Not here today (click: here)', onclick: () => cmd('party.away', { name: n, away: here }) },
            iconEl(here ? 'user-check' : 'user-off')),
          h('span', { class: 'grow ellipsis pl-name' }, n),
          here ? null : h('span', { class: 'pl-tag' }, 'not here today'),
          h('button', { class: 'icon-btn', 'aria-label': `Character card of ${n}`, 'data-tip': 'Character card', onclick: () => Characters.openEditor({ state: () => S, name: n }) }, iconEl('id-badge-2')),
          h('button', { class: 'icon-btn', 'aria-label': `Rename ${n}`, 'data-tip': 'Rename', onclick: async () => { const v = await askText('Rename player', n); if (v && v.trim() !== n) { const r = await cmd('char.rename', { from: n, to: v }); if (r && r.error) toast(r.error, { kind: 'error' }); } } }, iconEl('pencil')),
          h('button', { class: 'icon-btn', 'aria-label': `Remove ${n}`, 'data-tip': 'Remove from the campaign', onclick: () => removePlayer(n) }, iconEl('x'))));
      }
    });
    // 4.3.1: asks first (a player has a card and settings now)
    function removePlayer(n) {
      const dlg = UI.dialog(`Remove ${n}?`, h('div', { class: 'stack' },
        h('p', {}, `${n} leaves this campaign.`),
        h('p', { class: 'hint' }, `The character card is kept: add ${n} again and it comes back.`),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => dlg.close() }, 'Keep'),
          h('button', { class: 'btn danger', onclick: () => { dlg.close(); cmd('party.set', { names: C().party.filter((x) => x !== n) }); } }, iconEl('trash'), `Remove ${n}`))));
    }
    const add = h('input', { type: 'text', class: 'pl-add', placeholder: 'Add a player character', 'aria-label': 'New player', spellcheck: 'false' });
    const addIt = () => { const v = add.value.trim(); if (!v) return; cmd('party.set', { names: [...C().party, v] }); add.value = ''; };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    const k = card('users', 'Players', list,
      h('div', { class: 'ctl-row' }, add, h('button', { class: 'btn', onclick: addIt }, iconEl('plus'), 'Add')),
      h('p', { class: 'hint' }, 'Those here today join Initiative by themselves.'));
    k.head.append(count);
    return k.el;
  }

  // ---------- screens: the title, the break, the blackout ----------
  function screensCard() {
    const tabs = h('div', { class: 'seg seg-3 cp-tabs', role: 'tablist' });
    const TABS = [{ v: 'title', label: 'Title', icon: 'typography' }, { v: 'brk', label: 'Break', icon: 'coffee' }, { v: 'blackout', label: 'Blackout', icon: 'moon' }];
    const body = h('div', { class: 'stack' });
    const fill = () => {
      tabs.replaceChildren(...TABS.map((t) => h('button', { class: `seg-btn ${screenTab === t.v ? 'on' : ''}`, role: 'tab', dataset: { v: t.v }, onclick: () => {
        if (screenTab === t.v) return;
        screenTab = t.v; refs = refs.filter((f) => !f.screens); fill();
        if (tvOn) cmd('screens.preview', { which: screenTab }); // the TV shows the screen of the open tab
      } }, iconEl(t.icon), h('span', {}, t.label))));
      body.replaceChildren(...(screenTab === 'brk' ? breakForm() : screenTab === 'blackout' ? blackoutForm() : titleForm()));
    };
    fill();
    return card('device-tv', 'Screens on the table', tabs, body).el;
  }
  // "Show it on the TV": the TV shows the screen of the open tab (only that one) until it is switched off or the
  // page is left
  let tvOn = false;
  // binds that belong to the current screens tab (dropped when the tab changes)
  const sbind = (fn) => { fn.screens = true; bind(fn); };
  const sc = (which) => C().screens[which];
  const set = (which, patch) => cmd('screens.set', { which, patch });
  function field(label, which, key, placeholder) {
    const input = h('input', { type: 'text', spellcheck: 'false', 'aria-label': label, dataset: { k: key }, onchange: (e) => set(which, { [key]: e.target.value }), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
    sbind(() => {
      if (document.activeElement !== input) input.value = sc(which)[key] || '';
      input.placeholder = typeof placeholder === 'function' ? placeholder() : placeholder;
    });
    return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), input);
  }
  function segField(label, which, key, options) {
    const wrap = h('div', { class: `seg seg-${options.length}`, role: 'radiogroup', 'aria-label': label, dataset: { k: key } },
      ...options.map((o) => h('button', { class: 'seg-btn', role: 'radio', dataset: { v: o.value }, 'data-tip': o.tip || null, onclick: () => set(which, { [key]: o.value }) }, h('span', {}, o.label))));
    sbind(() => { const v = sc(which)[key]; for (const b of wrap.children) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-checked', String(b.dataset.v === v)); } });
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), wrap);
  }
  // a picture: the little maid (the default), none, one of this campaign's maps, or one from the PC (copied into the library)
  const picValue = (p) => (!p || p.builtin ? '' : p.none ? '__none' : p.path || '');
  function pictureField(which, extra) {
    const sel = h('select', { 'aria-label': 'Picture', class: 'cp-pic', onchange: (e) => {
      const v = e.target.value;
      if (v === '__pick') { e.target.value = picValue(sc(which).pic); pick(which); return; }
      set(which, v === '__none' ? { pic: 'none' } : v ? { pic: { path: v }, ...(extra || {}) } : { pic: null, ...(extra || {}) });
    } });
    sbind(() => {
      const c = C();
      const cur = sc(which).pic;
      const maps = c.chapters.flatMap((ch) => ch.maps).filter((m) => m.bgPath && !m.missing);
      const sig = JSON.stringify([maps.map((m) => m.bgPath), picValue(cur)]);
      if (sel.dataset.sig === sig) return;
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      sel.append(h('option', { value: '' }, 'The little maid (default)'), h('option', { value: '__none' }, 'No picture'));
      if (cur && cur.path && !maps.some((m) => m.bgPath === cur.path)) sel.append(h('option', { value: cur.path }, `${cur.name}${cur.missing ? ' (file missing)' : ''}`));
      if (maps.length) sel.append(h('optgroup', { label: 'This campaign\'s maps' }, ...maps.map((m) => h('option', { value: m.bgPath }, m.name))));
      sel.append(h('option', { value: '__pick' }, 'A picture from the PC …'));
      sel.value = picValue(cur);
    });
    return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Picture'), sel);
  }
  async function pick(which) {
    const r = await cmd('screens.pick', { which });
    if (r && !r.ok && r.error) toast(r.error, { kind: 'error' });
  }
  // a small picture of the TV with the screen on it (one side; the TV shows it for both long sides)
  function preview(which) {
    const box = h('div', { class: `cp-tv cp-tv-${which}` });
    sbind(() => {
      const c = C();
      const x = sc(which);
      const sig = JSON.stringify([which, x, c.name]);
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.innerHTML = '';
      // a small copy only (a big map as a full picture here made the page slow)
      const pic = (p) => (!p || p.none || p.missing ? null : p.builtin ? h('img', { class: 'cp-tv-pic fit', src: p.small, alt: '' }) : Thumbs.img(p.path, p.kind, null, 'cp-tv-pic cover-img'));
      if (which === 'title') {
        box.append(pic(x.pic) || h('span'), h('div', { class: 'cp-tv-veil' }),
          h('div', { class: 'cp-tv-title' }, h('b', {}, x.title.trim() || c.name), h('i', {}), x.sub.trim() ? h('span', {}, x.sub.trim()) : null));
      } else if (which === 'brk') {
        box.dataset.bg = x.bg;
        box.append(x.bg === 'picture' ? pic(x.pic) || h('span') : x.bg === 'map' ? h('div', { class: 'cp-tv-map' }) : h('span'), h('div', { class: 'cp-tv-veil' }),
          h('div', { class: 'cp-tv-dial' }, h('b', {}, '9:41'), h('span', {}, x.label.trim() || 'Break')), x.text.trim() ? h('div', { class: 'cp-tv-note' }, x.text.trim()) : ''); // (append would write "null")
      } else {
        box.dataset.style = x.style;
        box.append(x.style === 'picture' ? pic(x.pic) || h('span') : h('span'),
          h('div', { class: 'cp-tv-black' }, x.style === 'title' ? h('b', {}, c.name) : null, x.text.trim() ? h('span', {}, x.text.trim()) : null));
      }
    });
    return box;
  }
  function onTv() {
    const b = h('button', { class: 'btn wide cp-ontv' });
    sbind(() => { b.classList.toggle('primary', !tvOn); b.replaceChildren(iconEl(tvOn ? 'eye-off' : 'eye'), tvOn ? 'Take it off the table' : 'Show it on the table'); });
    b.addEventListener('click', () => {
      tvOn = !tvOn;
      cmd('screens.preview', { which: tvOn ? screenTab : null });
      for (const f of refs) f();
    });
    return b;
  }
  function titleForm() {
    return [preview('title'),
      field('Title', 'title', 'title', () => C().name),
      field('Line under it', 'title', 'sub', 'Nothing (or: Chapter 2, The Sunken Keep)'),
      pictureField('title'),
      onTv(),
      h('p', { class: 'hint' }, 'Shown on the table from Start session until you send the first map.')];
  }
  function breakForm() {
    const picRow = pictureField('brk', { bg: 'picture' });
    sbind(() => { picRow.hidden = sc('brk').bg !== 'picture'; });
    return [preview('brk'),
      field('On the dial', 'brk', 'label', 'Break'),
      field('A line of text', 'brk', 'text', 'Snacks are in the kitchen'),
      segField('Behind it', 'brk', 'bg', [{ value: 'map', label: 'Blurred map' }, { value: 'picture', label: 'Picture' }, { value: 'dark', label: 'Dark' }]),
      picRow,
      onTv(),
      h('p', { class: 'hint' }, 'At the table: Toolbox → Break, 5 to 30 minutes.')];
  }
  function blackoutForm() {
    const picRow = pictureField('blackout', { style: 'picture' });
    sbind(() => { picRow.hidden = sc('blackout').style !== 'picture'; });
    return [preview('blackout'),
      segField('Looks like', 'blackout', 'style', [{ value: 'black', label: 'Black' }, { value: 'title', label: 'Campaign name', tip: 'The campaign\'s name, faintly' }, { value: 'picture', label: 'Dark picture' }]),
      field('A line of text', 'blackout', 'text', 'Nothing (or: We\'ll be right back)'),
      picRow,
      onTv(),
      h('p', { class: 'hint' }, 'At the table: B or the Blackout button under the table preview.')];
  }

  // ---------- table check: is everything ready before the players sit down ----------
  function checkCard() {
    const list = h('div', { class: 'chk-list' });
    bind(() => {
      const rows = checks();
      const sig = JSON.stringify(rows.map((r) => [r.id, r.state, r.text, r.sub]));
      if (list.dataset.sig === sig) return;
      list.dataset.sig = sig;
      list.innerHTML = '';
      for (const r of rows) {
        list.append(h('div', { class: `chk-row ${r.state}`, dataset: { id: r.id } },
          iconEl(r.state === 'ok' ? 'circle-check' : r.state === 'warn' ? 'alert-triangle' : 'circle-dashed'),
          h('div', { class: 'grow chk-text' }, h('b', {}, r.text), r.sub ? h('span', {}, r.sub) : null),
          r.action ? h('button', { class: 'btn small', onclick: r.action.fn }, r.action.icon ? iconEl(r.action.icon) : null, r.action.label) : null));
      }
    });
    const k = card('checklist', 'Table check', list,
      h('div', { class: 'ctl-row' }, h('button', { class: 'btn small ghost', onclick: loadDevices, 'data-tip': 'Look for the speakers again' }, iconEl('refresh'), 'Check again')));
    return k.el;
  }
  function checks() {
    const s = S; const c = s.campaign; const st = s.settings || {}; const v = s.view;
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
    let missing = 0;
    for (const ch of c.chapters) { missing += ch.maps.filter((m) => m.missing).length; if (ch.ambience && ch.ambience.missing) missing++; if (ch.fight && ch.fight.missing) missing++; }
    rows.push(missing
      ? { id: 'files', state: 'warn', text: `${plural(missing, 'file is', 'files are')} missing`, sub: 'Open its map to find it again' }
      : { id: 'files', state: 'ok', text: 'All maps and sounds are there' });
    const here = c.party.filter((n) => !(c.away || []).includes(n)).length;
    rows.push(c.party.length
      ? { id: 'players', state: 'ok', text: `${here} of ${plural(c.party.length, 'player', 'players')} here today` }
      : { id: 'players', state: 'off', text: 'No players yet', sub: 'Add them on the left' });
    return rows;
  }

  return { mount, show, page, earlier };
})();
