// Spotify on the GM screen (main: spotify.js). Tablescape is a remote for the GM's own Spotify (Premium).
// All of it is in one floating panel, Toolbox → Spotify:
//   not linked          an empty panel with Connect Spotify, then a short how-to (the developer site, the exact
//                       redirect address, the Client ID)
//   linked              what plays with play / pause, skip and the volume; the settings behind the gear (where it
//                       plays, how the ambience dips under it, unlink); moods (Tablescape's own little
//                       playlists: songs, or playlists and albums) to play with a click; the GM's Spotify library
//   under the preview   what plays now, with play / pause and skip (the mouse wheel sets the volume)
// A chapter's fight music can be a mood (Sound → Combat), and a snapshot's transition can start one.
'use strict';

const SpotifyPanel = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const ts = window.ts;

  function create(ctx) {
    const { ui } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const sp = () => (S() && S().spotify) || { linked: false, moods: [] };
    const moods = () => sp().moods || [];
    const call = (a, p) => ts.spotify(a, p);
    ui.spotify = { tab: 'playlists', lists: {}, q: '', open: null, editing: null, songsOf: null, busy: false };
    const U = ui.spotify;

    // ---------- moods (saved in the settings) ----------
    const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const saveMoods = (list) => ts.settings({ spotify: { moods: list } });
    async function newMood(first) {
      const name = await askText('New mood', first ? first.name : '', { ok: 'Create', placeholder: 'Battle, Tavern, Boss fight …' });
      if (!name) return null;
      const m = { id: uid(), name: name.trim().slice(0, 60), shuffle: true, items: first ? [slim(first)] : [] };
      await saveMoods([...moods(), m]);
      toast(first ? `${m.name}: ${first.name} added` : `${m.name} created. Add music from your library below.`, { ms: 2600 });
      return m;
    }
    const slim = (it) => ({ uri: it.uri, kind: it.kind, name: it.name, sub: it.sub || '', image: it.image || null });
    async function addTo(mood, it) {
      const list = moods().map((m) => (m.id === mood.id ? { ...m, items: m.items.some((x) => x.uri === it.uri) ? m.items : [...m.items, slim(it)] } : m));
      await saveMoods(list);
      toast(`${it.name} → ${mood.name}`, { ms: 1800 });
    }
    function addMenu(it, x, y) {
      openMenu(x, y, [{ header: `Add ${it.kind === 'track' ? 'this song' : `this ${it.kind}`} to a mood` },
        ...moods().map((m) => ({ icon: 'playlist', label: `${m.name} (${m.items.length})`, checked: m.items.some((q) => q.uri === it.uri), action: () => addTo(m, it) })),
        { icon: 'plus', label: 'New mood …', action: () => newMood(it) }]);
    }
    async function playMood(m) {
      if (!m.items.length) { toast(`${m.name} has no music yet: add some from your library below`, { ms: 2800 }); return; }
      U.busy = true; ctx.refresh();
      const r = await call('play', { mood: m.id });
      U.busy = false; ctx.refresh();
      report(r, `${m.name}${r && r.device ? ` on ${r.device}` : ''}`);
    }
    async function playOne(it) {
      const r = await call('play', { items: [slim(it)], name: it.name, shuffle: false });
      report(r, `${it.name}${r && r.device ? ` on ${r.device}` : ''}`);
    }
    function report(r, okText) {
      if (r && r.ok) { if (okText) toast(okText, { ms: 1800 }); return; }
      if (r && r.noDevice) toast(r.error, { ms: 6000, action: { label: 'Open Spotify', run: () => call('open', { what: 'app' }) } });
      else if (r && r.error) toast(r.error, { kind: 'error', ms: 5000 });
    }
    function moodMenu(m, x, y) {
      const i = moods().findIndex((q) => q.id === m.id);
      openMenu(x, y, [
        { icon: 'pencil', label: 'Rename', action: async () => { const n = await askText('Rename mood', m.name); if (n) saveMoods(moods().map((q) => (q.id === m.id ? { ...q, name: n } : q))); } },
        { icon: 'arrows-shuffle', label: 'Shuffle', checked: m.shuffle !== false, action: () => saveMoods(moods().map((q) => (q.id === m.id ? { ...q, shuffle: q.shuffle === false } : q))) },
        { icon: 'list', label: U.editing === m.id ? 'Close the list' : 'What is in it', action: () => { U.editing = U.editing === m.id ? null : m.id; ctx.refresh(); } },
        { icon: 'chevron-up', label: 'Move up', disabled: i <= 0, action: () => { const l = [...moods()]; l.splice(i - 1, 0, l.splice(i, 1)[0]); saveMoods(l); } },
        { icon: 'trash', label: 'Delete', action: () => { const old = moods(); saveMoods(old.filter((q) => q.id !== m.id)); toast(`${m.name} deleted`, { undo: () => saveMoods(old) }); } },
      ]);
    }

    // ---------- the library ----------
    async function load(kind, more) {
      const cur = U.lists[kind];
      if (cur && cur.loading) return;
      const off = more && cur ? cur.items.length : 0;
      U.lists[kind] = { ...(cur || { items: [] }), loading: true, error: null };
      ctx.refresh();
      const r = kind === 'search' ? await call('library', { kind, q: U.q }) : kind.startsWith('pl:') ? await call('library', { kind: 'playlist', id: kind.slice(3), offset: off }) : await call('library', { kind, offset: off });
      U.lists[kind] = r && r.ok ? { items: more && cur ? [...cur.items, ...r.items] : r.items, next: !!r.next, loading: false, error: null }
        : { items: (cur && cur.items) || [], loading: false, error: (r && r.error) || 'Spotify did not answer' };
      ctx.refresh();
    }
    function itemRow(it, o = {}) {
      const img = it.image ? h('img', { class: 'sp-cover', src: it.image, alt: '', loading: 'lazy', onerror: (e) => { e.target.replaceWith(h('span', { class: 'sp-cover none' }, iconEl(KIND_ICON[it.kind] || 'music'))); } })
        : h('span', { class: 'sp-cover none' }, iconEl(KIND_ICON[it.kind] || 'music'));
      return h('div', { class: 'sp-row', dataset: { uri: it.uri } }, img,
        h('div', { class: 'sp-text grow' }, h('span', { class: 'ellipsis' }, it.name), h('small', { class: 'ellipsis' }, [KIND_WORD[it.kind], it.sub].filter(Boolean).join(' · '))),
        o.songs ? h('button', { class: 'icon-btn', 'aria-label': `Songs of ${it.name}`, 'data-tip': 'Show its songs', onclick: o.songs }, iconEl('list')) : null,
        h('button', { class: 'icon-btn', 'aria-label': `Play ${it.name}`, 'data-tip': 'Play it now', onclick: () => playOne(it) }, iconEl('player-play')),
        o.remove ? h('button', { class: 'icon-btn', 'aria-label': `Take ${it.name} out`, 'data-tip': 'Take it out of the mood', onclick: o.remove }, iconEl('x'))
          : h('button', { class: 'icon-btn sp-add', 'aria-label': `Add ${it.name} to a mood`, 'data-tip': 'Add to a mood', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(it, r.left, r.bottom + 4); } }, iconEl('playlist-add')));
    }
    const KIND_ICON = { track: 'music', playlist: 'playlist', album: 'disc' };
    const keyOf = (m) => { const i = moods().findIndex((q) => q.id === m.id); return i >= 0 && i < 9 ? ` · Ctrl + ${i + 1}` : ''; };
    const KIND_WORD = { track: '', playlist: 'Playlist', album: 'Album' };

    // ---------- the floating panel (Toolbox → Spotify) ----------
    // Not linked: an empty panel with Connect Spotify, then the three steps.
    // Linked: what plays (with the volume), the moods, your Spotify; the settings fold out behind the gear.
    const mode = () => { const s = sp(); return s.linked ? 'linked' : s.waiting ? 'waiting' : U.connect ? 'howto' : 'empty'; };
    function buildPanel() {
      const built = mode();
      const { bind } = c();
      // a different state needs a different panel: build it again
      bind(() => { if (mode() !== built) setTimeout(() => ctx.rebuild(), 0); });
      if (built === 'linked') return linkedView();
      return h('div', { class: 'stack sp-panel sp-unlinked' }, setupView(built));
    }
    function errorLine() {
      const p = h('p', { class: 'hint danger-text sp-error' });
      c().bind(() => { const e = sp().error; p.hidden = !e; p.textContent = e || ''; });
      return p;
    }
    function setupView(m) {
      const { btn, row, hint } = c();
      const s = sp();
      if (m === 'empty') {
        return h('div', { class: 'stack sp-empty' },
          h('div', { class: 'sp-empty-icon' }, iconEl('brand-spotify')),
          h('p', { class: 'sp-lead' }, 'Play your Spotify from here: moods, your playlists and songs. Needs Spotify Premium.'),
          errorLine(),
          row(btn('Connect Spotify', 'brand-spotify', () => { U.connect = true; ctx.rebuild(); }, { kind: 'primary wide' })));
      }
      if (m === 'waiting') {
        return h('div', { class: 'stack' },
          h('p', { class: 'sp-wait' }, iconEl('brand-spotify'), 'Waiting for Spotify in your browser … allow Tablescape there, then come back.'),
          row(btn('Cancel', 'x', () => call('cancel'), { kind: 'ghost' })));
      }
      // the three steps
      const id = h('input', { type: 'text', class: 'sp-client', placeholder: 'Client ID (32 letters and digits)', 'aria-label': 'Client ID', spellcheck: 'false', value: s.clientId || '' });
      const go = async () => { const r = await call('link', { clientId: id.value }); if (r && !r.ok) toast(r.error, { kind: 'error', ms: 6000 }); };
      id.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div', { class: 'stack sp-setup' },
        errorLine(),
        h('p', { class: 'sp-lead' }, 'Link your Spotify (Premium) once, in three steps:'),
        h('ol', { class: 'sp-steps' },
          h('li', {}, h('span', {}, 'Open the Spotify developer site and log in with your Spotify account.'), btn('Open the developer site', 'external-link', () => call('open', { what: 'dashboard' }), { kind: 'small' })),
          h('li', {}, h('span', {}, 'Click ', h('b', {}, 'Create app'), '. Any name and description (Tablescape). As ', h('b', {}, 'Redirect URI'), ' add exactly:'),
            h('div', { class: 'sp-uri' }, h('code', {}, s.redirect), h('button', { class: 'icon-btn', 'aria-label': 'Copy the redirect address', 'data-tip': 'Copy', onclick: () => { call('copy', { text: s.redirect }); toast('Copied', { ms: 1200 }); } }, iconEl('clipboard-copy'))),
            h('span', {}, 'Tick ', h('b', {}, 'Web API'), ', agree and Save.')),
          h('li', {}, h('span', {}, 'On your app\'s page copy the ', h('b', {}, 'Client ID'), ' and paste it here:'), id, btn('Link Spotify', 'brand-spotify', go, { kind: 'primary' }))),
        hint('Your browser asks you to allow Tablescape, then come back here. Spotify\'s own guide:'),
        row(btn('How Spotify apps work', 'external-link', () => call('open', { what: 'guide' }), { kind: 'small ghost' }),
          btn('Back', 'arrow-left', () => { U.connect = false; ctx.rebuild(); }, { kind: 'small ghost' })));
    }

    // the volume of the Spotify device: right away while dragging, kept as the level moods play at
    let volT = 0;
    function setVolume(v) {
      U.vol = v; U.volAt = Date.now();
      clearTimeout(volT);
      volT = setTimeout(() => { call('control', { action: 'volume', volume: v }); ts.settings({ spotify: { volume: v } }); }, 120);
    }
    const volumeNow = () => (U.volAt && Date.now() - U.volAt < 4000 ? U.vol : (sp().now && sp().now.volume != null ? sp().now.volume : sp().volume ?? 70));

    function linkedView() {
      const { bind, btn, row, hint, seg, slider } = c();
      // what plays, with play / pause, skip, the volume and the gear for the settings
      const player = h('div', { class: 'sp-player' });
      bind(() => {
        const s = sp(); const n = s.now || {};
        const sig = JSON.stringify([n.track, n.artist, n.playing, n.image, U.settings]);
        if (player.dataset.sig === sig) return;
        player.dataset.sig = sig;
        player.innerHTML = '';
        player.append(
          n.image ? h('img', { class: 'sp-player-cover', src: n.image, alt: '', onerror: (e) => e.target.replaceWith(h('span', { class: 'sp-player-cover none' }, iconEl('brand-spotify'))) })
            : h('span', { class: 'sp-player-cover none' }, iconEl('brand-spotify')),
          h('div', { class: 'sp-text grow' }, h('span', { class: 'ellipsis' }, n.track || 'Nothing playing'), h('small', { class: 'ellipsis' }, n.artist || 'Pick a mood or something from your Spotify')),
          h('button', { class: 'icon-btn', 'aria-label': 'Previous song', 'data-tip': 'Previous song', onclick: () => call('control', { action: 'previous' }) }, iconEl('player-track-prev')),
          h('button', { class: 'icon-btn sp-play', 'aria-label': n.playing ? 'Pause Spotify' : 'Play Spotify', 'data-tip': n.playing ? 'Pause' : 'Play', onclick: () => (n.playing ? call('stop', {}) : call('control', { action: 'resume' }).then((r) => report(r))) }, iconEl(n.playing ? 'player-pause' : 'player-play')),
          h('button', { class: 'icon-btn', 'aria-label': 'Next song', 'data-tip': 'Next song', onclick: () => call('control', { action: 'next' }) }, iconEl('player-track-next')),
          h('button', { class: 'icon-btn', 'aria-label': 'Open Spotify', 'data-tip': 'Open the Spotify app', onclick: () => call('open', { what: 'app' }) }, iconEl('external-link')), // 4.3.2
          h('button', { class: `icon-btn sp-gear ${U.settings ? 'on' : ''}`, 'aria-label': 'Spotify settings', 'data-tip': 'Settings: where it plays, the ambience under it, unlink', onclick: () => { U.settings = !U.settings; ctx.refresh(); } }, iconEl('settings')));
      });
      const volume = slider({ label: 'Volume', min: 0, max: 100, step: 1, get: () => volumeNow(), set: (v) => setVolume(v), fmt: (v) => `${Math.round(v)}%` });
      volume.classList.add('sp-volume');
      // the settings, folded out behind the gear
      const settings = h('div', { class: 'stack sp-settings' });
      const devBox = h('div', { class: 'stack' });
      bind(() => {
        settings.hidden = !U.settings;
        const s = sp();
        const devs = s.devices || [];
        const sig = JSON.stringify([s.user, s.device, devs.map((d) => [d.id, d.name, d.active])]);
        if (devBox.dataset.sig === sig) return;
        devBox.dataset.sig = sig;
        devBox.innerHTML = '';
        const sel = h('select', { 'aria-label': 'Spotify plays on', onchange: (e) => { const d = devs.find((x) => x.id === e.target.value); ts.settings({ spotify: { device: e.target.value, deviceName: d ? d.name : '' } }); if (s.now && s.now.playing && d) call('control', { action: 'transfer', device: d.id, deviceName: d.name }); } },
          h('option', { value: '' }, 'Where Spotify plays now'), ...devs.map((d) => h('option', { value: d.id }, `${d.name} (${d.type})${d.active ? ' · playing' : ''}`)));
        sel.value = devs.some((d) => d.id === s.device) ? s.device : '';
        devBox.append(
          h('div', { class: 'ctl-row sp-user' }, iconEl('brand-spotify'), h('span', { class: 'grow' }, 'Linked as ', h('b', {}, s.user || 'you')),
            btn('Unlink', 'unlink', async () => { await call('unlink'); U.connect = false; U.settings = false; toast('Spotify unlinked'); }, { kind: 'small ghost' })),
          h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Plays on'), h('div', { class: 'ctl-row sp-dev' }, sel,
            h('button', { class: 'icon-btn', 'aria-label': 'Look for Spotify devices', 'data-tip': 'Look again (Spotify open on the laptop, a phone or a speaker)', onclick: () => call('devices') }, iconEl('refresh')))));
        if (!devs.length) devBox.append(h('div', { class: 'ctl-row' }, h('span', { class: 'hint grow' }, 'No Spotify open right now.'), btn('Open Spotify', 'brand-spotify', () => call('open', { what: 'app' }), { kind: 'small' })));
      });
      settings.append(devBox,
        slider({ label: 'Ambience while Spotify plays', min: 0, max: 1, step: 0.05, get: () => sp().duck, set: (v) => ctx.settingsLater({ spotify: { duck: v } }), fmt: (v) => (v >= 0.99 ? 'Unchanged' : v <= 0.01 ? 'Silent' : `${Math.round(v * 100)}%`) }));
      if (!(sp().devices || []).length) call('devices');
      // moods
      const grid = h('div', { class: 'sp-moods' });
      const editor = h('div', { class: 'stack sp-editor' });
      bind(() => {
        const s = sp();
        const sig = JSON.stringify([s.moods, s.playingMood, s.now && s.now.playing, U.busy, U.editing]);
        if (grid.dataset.sig === sig) return;
        grid.dataset.sig = sig;
        grid.innerHTML = '';
        for (const m of s.moods) {
          const on = s.playingMood === m.id && s.now && s.now.playing;
          grid.append(Hotbar.offer(h('div', { class: `sp-mood ${on ? 'on' : ''}`, dataset: { id: m.id } },
            h('button', { class: 'sp-mood-main', 'data-tip': on ? `Playing. Click to pause it${keyOf(m)}` : `Play ${m.name}${m.shuffle !== false ? ' (shuffled)' : ''}${keyOf(m)}`, disabled: U.busy,
              onclick: () => (on ? call('stop', {}) : playMood(m)) },
            iconEl(on ? 'player-stop' : 'player-play'), h('span', { class: 'ellipsis' }, m.name), h('small', {}, `${m.items.length}`)),
            h('button', { class: 'icon-btn', 'aria-label': `More for ${m.name}`, 'data-tip': 'Rename, shuffle, what is in it, delete', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); moodMenu(m, r.left, r.bottom + 4); } }, iconEl('dots'))), { kind: 'mood', ref: m.id, label: m.name, icon: 'brand-spotify' }));
        }
        grid.append(h('button', { class: 'sp-mood sp-mood-new', 'data-tip': 'A mood: a few songs, or playlists and albums, played with one click', onclick: () => newMood() }, iconEl('plus'), h('span', {}, 'New mood')));
        // what is in the open mood
        editor.innerHTML = '';
        const m = s.moods.find((q) => q.id === U.editing);
        if (m) {
          editor.append(h('div', { class: 'ctl-label' }, `${m.name}: ${m.items.length ? `${m.items.length} in it` : 'empty'}`));
          for (const it of m.items) editor.append(itemRow(it, { remove: () => saveMoods(moods().map((q) => (q.id === m.id ? { ...q, items: q.items.filter((x) => x.uri !== it.uri) } : q))) }));
        }
      });
      // the library
      const tabs = seg({ cls: 'seg-4 sp-tabs', options: [
        { value: 'playlists', label: 'Playlists', icon: 'playlist' }, { value: 'liked', label: 'Liked', icon: 'heart' },
        { value: 'albums', label: 'Albums', icon: 'disc' }, { value: 'search', label: 'Search', icon: 'search' }],
      get: () => U.tab, set: (v) => { U.tab = v; U.songsOf = null; ctx.refresh(); if (v !== 'search' && !U.lists[v]) load(v); } });
      const search = h('input', { type: 'search', class: 'sp-search', placeholder: 'Songs, playlists, albums', 'aria-label': 'Search Spotify', value: U.q, spellcheck: 'false' });
      let st = 0;
      search.addEventListener('input', () => { U.q = search.value; clearTimeout(st); st = setTimeout(() => load('search'), 350); });
      const list = h('div', { class: 'sp-list' });
      bind(() => {
        search.hidden = U.tab !== 'search';
        const key = U.songsOf ? `pl:${U.songsOf.id}` : U.tab;
        const L = U.lists[key];
        const sig = JSON.stringify([key, L && L.items.length, L && L.loading, L && L.error, L && L.next]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        if (U.songsOf) list.append(h('button', { class: 'btn small ghost sp-back', onclick: () => { U.songsOf = null; ctx.refresh(); } }, iconEl('arrow-left'), `Back · ${U.songsOf.name}`));
        if (!L) { if (key !== 'search') setTimeout(() => load(key), 0); list.append(key === 'search' ? hint('Type to search Spotify.') : UI.loader('Asking Spotify …')); return; }
        if (L.error) list.append(h('p', { class: 'hint danger-text' }, L.error));
        for (const it of L.items) {
          list.append(itemRow(it, { songs: it.kind === 'playlist' && it.own ? () => { U.songsOf = { id: it.id, name: it.name }; ctx.refresh(); } : null }));
        }
        if (L.loading) list.append(UI.loader('Asking Spotify …'));
        else if (!L.items.length && !L.error) list.append(hint(key === 'search' ? (U.q ? 'Nothing found.' : 'Type to search Spotify.') : 'Nothing here yet.'));
        if (L.next && !L.loading) list.append(row(btn('More', 'chevron-down', () => load(key, true), { kind: 'ghost wide' })));
      });
      return h('div', { class: 'stack sp-panel' },
        errorLine(), player, volume, settings,
        h('div', { class: 'pop-sep' }),
        h('div', { class: 'ctl-label' }, 'Moods'), grid, editor,
        h('div', { class: 'pop-sep' }),
        h('div', { class: 'ctl-label' }, 'Your Spotify'), tabs, search, list);
    }

    // ---------- under the table preview: what plays ----------
    function renderNow(box) {
      const s = sp();
      const n = s.linked ? s.now : null;
      const sig = JSON.stringify(n ? [n.track, n.artist, n.playing, n.image, s.playingMood] : null);
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.innerHTML = '';
      if (!n || (!n.track && !n.playing)) return;
      const mood = moods().find((m) => m.id === s.playingMood);
      if (!box.dataset.wheel) {
        box.dataset.wheel = '1';
        box.addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.max(0, Math.min(100, Math.round(volumeNow() + (e.deltaY < 0 ? 5 : -5)))); setVolume(v); toast(`Spotify ${v}%`, { ms: 900 }); }, { passive: false });
        box.dataset.tip = 'Mouse wheel: volume';
      }
      box.append(
        h('button', { class: 'sp-now-open', 'aria-label': 'Open the Spotify panel', 'data-tip': 'Spotify: moods and your library', onclick: () => ctx.openPanel() },
          n.image ? h('img', { src: n.image, alt: '', onerror: (e) => e.target.replaceWith(iconEl('brand-spotify')) }) : iconEl('brand-spotify')),
        h('div', { class: 'sp-now-text grow', 'data-tip': [n.track, n.artist].filter(Boolean).join(' · ') },
          h('span', { class: 'ellipsis' }, n.track || 'Spotify'), h('small', { class: 'ellipsis' }, mood && n.playing ? `${mood.name} · ${n.artist || ''}` : n.artist || '')),
        h('button', { class: 'icon-btn', 'aria-label': n.playing ? 'Pause Spotify' : 'Play Spotify', 'data-tip': n.playing ? 'Pause' : 'Play', onclick: () => (n.playing ? call('stop', {}) : call('control', { action: 'resume' }).then((r) => report(r))) }, iconEl(n.playing ? 'player-pause' : 'player-play')),
        h('button', { class: 'icon-btn', 'aria-label': 'Next song', 'data-tip': 'Next song', onclick: () => call('control', { action: 'next' }) }, iconEl('player-track-next')));
    }

    // ---------- Sound → Combat: a Spotify mood as the chapter's fight music ----------
    function fightMoodCtl(ch, cmd) {
      if (!sp().linked) return null;
      const sel = h('select', { 'aria-label': 'Fight music from Spotify', onchange: (e) => cmd('chapter.fight', { id: ch.id, mood: e.target.value || null }) },
        h('option', { value: '' }, 'No, the file above'), ...moods().map((m) => h('option', { value: m.id }, m.name)));
      sel.value = moods().some((m) => m.id === ch.fightMood) ? ch.fightMood : '';
      return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, iconEl('brand-spotify'), 'Or a Spotify mood'), sel);
    }

    // Ctrl + 1 to 9: the moods in their order (a playing one pauses when its key is pressed again)
    function playNumber(n) {
      const s = sp();
      if (!s.linked) { toast('Connect Spotify first: Toolbox → Spotify', { ms: 2600 }); return; }
      const m = moods()[n - 1];
      if (!m) { toast(`No mood ${n} yet (Toolbox → Spotify)`, { ms: 2200 }); return; }
      if (s.playingMood === m.id && s.now && s.now.playing) { call('stop', {}); toast(`${m.name} paused`, { ms: 1600 }); return; }
      playMood(m);
    }

    // the hotbar: a mood by its id (a playing one pauses)
    function toggleMood(id) {
      const s = sp();
      if (!s.linked) { toast('Connect Spotify first: Toolbox → Spotify', { ms: 2600 }); return; }
      const m = moods().find((x) => x.id === id);
      if (!m) { toast('This mood is gone', { kind: 'error' }); return; }
      if (s.playingMood === m.id && s.now && s.now.playing) { call('stop', {}); toast(`${m.name} paused`, { ms: 1600 }); return; }
      playMood(m);
    }
    return { buildPanel, renderNow, fightMoodCtl, playMood, playNumber, toggleMood, moods, newMood, load };
  }
  return { create };
})();
