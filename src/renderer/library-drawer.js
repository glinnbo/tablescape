// The library: a two-pane drawer (or full screen) with big categories, smart
// shelves, your folders (4.11: a tree, a path, folder cards), search by name and folder, map variants stacked into one card,
// a display that suits each kind of file, and the shelf with the chapter's Ready list.
'use strict';

const LibraryDrawer = (() => {
  const { h, iconEl, $, toast, openMenu, Thumbs } = UI;

  const CATS = [
    { id: 'all', label: 'All', icon: 'layout-grid' },
    { id: 'maps', label: 'Maps', icon: 'map-2' },
    { id: 'tokens', label: 'Tokens', icon: 'user' },
    { id: 'assets', label: 'Assets', icon: 'trees' },
    { id: 'overlays', label: 'Overlays', icon: 'sparkles' },
    { id: 'sounds', label: 'Sounds', icon: 'music' },
    { id: 'portraits', label: 'Portraits', icon: 'messages' },
    { id: 'party', label: 'Party', icon: 'users-group' }, // 4.7: the players' characters
    { id: 'handouts', label: 'Handouts', icon: 'script' },
  ];
  const SHELVES = [
    { id: 'fav', label: 'Favourites', icon: 'star' },
    { id: 'recent', label: 'Recent', icon: 'clock' },
    { id: 'campaign', label: 'This campaign', icon: 'book-2' },
    { id: 'fits', label: 'Fits this map', icon: 'wand' },
  ];
  const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
  const CAT_ICON = Object.fromEntries(CATS.map((c) => [c.id, c.icon]));
  const ROLE = { maps: 'map', tokens: 'token', assets: 'asset', overlays: 'overlay', sounds: 'sound', portraits: 'portrait', party: 'token', handouts: 'handout' };

  // ---------- words, tags and variants ----------
  const STOP = new Set(('the and of a an with by for in on at to from maps map tokens token assets asset props prop effects effect ' +
    'overlays overlay audio sounds sound packs pack static animated gridless grid nogrid hd uhd png jpg jpeg webp webm mp4 ogg mp3 wav ' +
    'final copy version ver free patreon alpha loop').split(' '));
  function words(str) {
    return String(str).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9äöüéèàç]+/)
      .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !/^\d+x\d+$/.test(w) && !/^\d+px$/.test(w) && !STOP.has(w));
  }
  function tagsOf(it) {
    if (!it._tags) it._tags = [...new Set(words(it.rel.replace(/\.[^.]+$/, '')))];
    return it._tags;
  }
  const VARIANT_WORDS = new Set(('day night dawn dusk evening morning noon midnight rain rainy storm stormy snow snowy winter summer autumn fall ' +
    'spring fog foggy mist misty dark light lit unlit torchlit torchlight lanterns flooded flood dry burning burned burnt fire ruined destroyed ' +
    'intact blood bloody clean dirty empty furnished alt alternate variant var open closed frozen ice lava sunny cloudy overcast moonlit ' +
    'underwater daytime nighttime grid gridless nogrid').split(' '));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function variantOf(it) {
    if (it._var) return it._var;
    const ws = it.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const isVar = (w) => VARIANT_WORDS.has(w) || /^v\d+$/.test(w);
    const base = ws.filter((w) => !isVar(w)).join(' ');
    const vars = ws.filter(isVar);
    it._var = { base, label: vars.length ? cap(vars.join(' ')) : 'Base' };
    return it._var;
  }
  // maps that only differ by day / night / rain / grid... become one card
  function stackMaps(list) {
    const out = [];
    const byKey = new Map();
    for (const it of list) {
      const v = variantOf(it);
      if (!v.base) { out.push({ items: [it] }); continue; }
      const key = `${it.pack || ''}|${v.base}`;
      let st = byKey.get(key);
      if (!st) { st = { items: [] }; byKey.set(key, st); out.push(st); }
      st.items.push(it);
    }
    for (const st of out) st.items.sort((a, b) => (variantOf(a).label === 'Base' ? -1 : variantOf(b).label === 'Base' ? 1 : variantOf(a).label.localeCompare(variantOf(b).label)));
    // the same map as a still picture and as a video (e.g. a Dungeon Alchemist export): tell them apart
    for (const st of out) {
      const seen = new Map();
      for (const it of st.items) seen.set(variantOf(it).label, (seen.get(variantOf(it).label) || 0) + 1);
      for (const it of st.items) {
        const v = variantOf(it);
        if (seen.get(v.label) > 1 && !v.split) {
          const anim = it.kind === 'video';
          v.label = v.label === 'Base' ? (anim ? 'Animated' : 'Still') : `${v.label} (${anim ? 'animated' : 'still'})`;
          v.split = true;
        }
      }
    }
    return out;
  }
  // 4.11: an item's folders below its category's own folder: Tokens/Oterians/Fleet Chaplain/x.png → ['Oterians', 'Fleet Chaplain'].
  // Maps: Static and Animated are not folders of their own (variants of one map often live in both); a pack is a folder
  // each category's own folder in the library (and a level inside it that only sorts: Maps/Static, Effects/Overlays)
  const CAT_ROOT = { maps: ['Maps'], tokens: ['Tokens'], assets: ['Assets', 'Props'], overlays: ['Effects'], portraits: ['Portraits'], party: ['Party'], handouts: ['Handouts'], sounds: ['Audio'] };
  const CAT_SKIP = { maps: /^(static|animated)$/i, overlays: /^overlays$/i };
  function foldersOf(it) {
    if (it._dirs) return it._dirs;
    const parts = String(it.rel || '').split('/');
    if (it.pack) it._dirs = [`Pack: ${it.pack}`, ...parts.slice(2, -1)];
    else {
      let from = (CAT_ROOT[it.cat] || []).includes(parts[0]) ? 1 : 0; // (a folder of its own beside them keeps its name)
      if (from && CAT_SKIP[it.cat] && CAT_SKIP[it.cat].test(parts[1] || '') && parts.length > 2) from = 2;
      it._dirs = parts.slice(from, -1);
    }
    return it._dirs;
  }
  const dirKey = (dirs) => dirs.join('/');
  // 4.11: inside its folder a file's name without the folder's name: Archivist-Surveyor_3 in Archivist-Surveyor → "3"
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function shortName(it) {
    if (it._short !== undefined) return it._short;
    const dirs = foldersOf(it);
    const last = String(dirs[dirs.length - 1] || '').replace(/^Pack: /, '');
    const ws = last.split(/[^A-Za-z0-9äöüÄÖÜéèàçß]+/).filter(Boolean);
    let out = it.name;
    if (ws.length) {
      const m = it.name.match(new RegExp(`^[\\s_.\\-]*${ws.map(escRe).join('[\\s_.\\-]*')}[\\s_.\\-]*`, 'i'));
      if (m) { const rest = it.name.slice(m[0].length).replace(/_/g, ' ').trim(); if (rest) out = rest; }
    }
    it._short = out;
    return out;
  }

  function create(ctx) {
    const { ui, cmd, undoable } = ctx;
    const D = () => ctx.els.drawer;
    const S = () => ctx.state();
    let items = [];
    let loaded = false;
    let limit = 160;
    const lib = ui.lib || (ui.lib = { cat: 'all', shelf: null, query: '', tags: [], kind: null, full: false });
    // 4.11: the folder each category was left in (kept between sessions), the folders opened in the tree, everything inside at once
    if (!lib.folders) { try { lib.folders = JSON.parse(localStorage.getItem('libFolders') || '{}') || {}; } catch { lib.folders = {}; } }
    if (!lib.open) lib.open = {};
    const folderNow = () => (lib.cat !== 'all' && !lib.shelf ? lib.folders[lib.cat] || '' : '');
    function goFolder(cat, key) {
      lib.cat = cat; lib.shelf = null; lib.tags = []; lib.deep = false;
      lib.folders[cat] = key || '';
      try { localStorage.setItem('libFolders', JSON.stringify(lib.folders)); } catch {}
      // the tree opens down to it
      const segs = (key || '').split('/').filter(Boolean);
      const open = lib.open[cat] || (lib.open[cat] = new Set());
      for (let i = 1; i <= segs.length; i++) open.add(segs.slice(0, i).join('/'));
      limit = 160;
      render();
      const c = $('.lib-content', D()); if (c) c.scrollTop = 0;
    }

    // ---------- open / close ----------
    async function open(opts = {}) {
      ctx.closePop();
      const cat = opts.cat || opts.filter;
      // back: the menu that sent us here ({ pop, tool }); after picking (or Cancel) it opens again
      ui.drawer = { purpose: opts.purpose || null, at: opts.at || null, chapterId: opts.chapterId || null, index: opts.index, back: opts.back || null };
      if (cat) { lib.cat = cat === 'packs' ? 'all' : cat; lib.shelf = null; lib.tags = []; lib.kind = null; }
      if ('full' in opts) lib.full = !!opts.full;
      limit = 160;
      ctx.renderRail();
      build();
      D().classList.add('on');
      await reload();
      // 4.11: picking a sound for something opens the folder for it (Ambience, Music, SFX) when there is one
      const p = opts.purpose || '';
      const nat = p === 'ambience' || p === 'mapSound' ? 'Ambience' : p === 'fight' ? 'Music' : p.startsWith('sfx:') || p.startsWith('moment:') ? 'SFX' : null;
      if (nat && lib.cat === 'sounds' && nodeAt('sounds', nat)) goFolder('sounds', nat);
      const s = $('.lib-search', D());
      if (s) s.focus({ preventScroll: true });
    }
    function close() {
      ui.drawer = null;
      picked.clear();
      D().classList.remove('on', 'full');
      stopPreview();
      ctx.renderRail();
    }
    function toggle() { if (ui.drawer) cancel(); else open({}); }
    // picked: back to the menu that opened the library, with the new thing lit for a moment
    function done(key) {
      const back = ui.drawer && ui.drawer.back;
      close();
      if (back) ctx.returnTo(back, key);
    }
    // Cancel or Esc: back to that menu without picking anything
    function cancel() { done(null); }
    async function reload() {
      items = await window.ts.library('list');
      trees.clear();
      loaded = true;
      render();
    }
    // 4.11: the folders of a category, with how many files each holds (its subfolders' too) and a few to show on its card
    const trees = new Map();
    function treeOf(cat) {
      if (trees.has(cat)) return trees.get(cat);
      const root = { name: '', key: '', kids: new Map(), n: 0, own: 0, sample: [] };
      for (const it of items) {
        if (it.cat !== cat) continue;
        let node = root; root.n++;
        for (const d of foldersOf(it)) {
          let k = node.kids.get(d);
          if (!k) { k = { name: d, key: node.key ? `${node.key}/${d}` : d, kids: new Map(), n: 0, own: 0, sample: [], pack: d.startsWith('Pack: ') }; node.kids.set(d, k); }
          k.n++;
          if (k.sample.length < 4 && it.kind !== 'audio') k.sample.push(it);
          node = k;
        }
        node.own++;
      }
      trees.set(cat, root);
      return root;
    }
    function nodeAt(cat, key) {
      let node = treeOf(cat);
      for (const seg of (key || '').split('/').filter(Boolean)) { node = node.kids.get(seg); if (!node) return null; }
      return node;
    }
    const sortKids = (node) => [...node.kids.values()].sort((a, b) => (a.pack - b.pack) || a.name.localeCompare(b.name, undefined, { numeric: true }));

    const PURPOSE = {
      newMap: 'Pick a map to add it to this chapter',
      replace: 'Pick a new background for this map',
      place: 'Pick what to place where you clicked',
      ambience: 'Pick the ambience for this chapter',
      brush: 'Pick an asset to place on the map',
      tokenBrush: 'Pick a token, then click the map to drop it (again and again)',
      mapSound: 'Pick a sound to play while this map is on the table',
      fight: 'Pick the fight music for this chapter',
      talk: 'Pick a portrait to bring into the conversation',
      addToken: 'Pick a token to put in the middle of the map',
    };
    const purposeText = (p) => (p && p.startsWith('sfx:') ? `Pick a sound for ${(FXDATA.SKINS[p.slice(4)] || {}).label || ''} spells`
      : p && p.startsWith('moment:') ? `Pick a sound for the ${((Moments.BY[p.slice(7)] || {}).label || 'screen effect').toLowerCase()}` : PURPOSE[p]);
    // which section new files from the PC belong to, for what is being picked
    const catFor = (p) => {
      if (!p) return null;
      if (p === 'newMap' || p === 'replace') return 'maps';
      if (p === 'place' || p === 'addToken' || p === 'tokenBrush') return 'tokens';
      if (p === 'brush') return 'assets';
      if (p === 'talk') return 'portraits';
      if (p === 'ambience' || p === 'mapSound' || p === 'fight' || p.startsWith('sfx:') || p.startsWith('moment:')) return 'sounds';
      return null;
    };

    // ---------- Add from PC: files from anywhere are copied into the library, then used ----------
    async function addFromPc(files) {
      const d = ui.drawer || {};
      let cat = catFor(d.purpose) || (lib.cat !== 'all' ? lib.cat : null);
      if (!cat && files && files.length) cat = files.every((f) => /\.(mp3|ogg|opus|wav|flac|m4a)$/i.test(f)) ? 'sounds' : 'maps';
      const folder = d.purpose === 'ambience' ? 'Audio/Ambience' : d.purpose === 'fight' ? 'Audio/Music' : null;
      const r = await window.ts.library('import', { files: files || undefined, cat: cat || 'maps', folder });
      if (!r || !r.ok) { if (r && r.error) toast(r.error, { kind: 'error' }); return null; }
      await reload();
      const got = r.items.map((x) => items.find((i) => i.path === x.path) || x);
      const where = got[0] ? got[0].rel.split('/').slice(0, -1).join('/') : '';
      toast(r.copied ? `${got.length === 1 ? got[0].name : `${got.length} files`} copied into ${where || 'the library'}${r.walls ? ' (with walls)' : ''}` : `${got.length === 1 ? got[0].name : `${got.length} files`} already in the library`);
      if (d.purpose === 'newMap') {
        for (const it of got.filter((x) => x.cat === 'maps')) await cmd('map.add', { chapterId: d.chapterId || (ctx.viewChapter() || {}).id, path: it.path, index: d.index });
        done(null);
      } else if (d.purpose && got[0]) use(got[0]);
      else flashTiles(got.map((x) => x.path));
      return got;
    }
    function flashTiles(paths) {
      requestAnimationFrame(() => {
        for (const el of D().querySelectorAll('.lt')) if (paths.includes(el.dataset.path)) { el.classList.add('flash'); el.scrollIntoView({ block: 'nearest' }); setTimeout(() => el.classList.remove('flash'), 1700); }
      });
    }
    // files dragged in from Explorer onto the library
    function bindFileDrop(box) {
      box.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('drop-files'); } });
      box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop-files'); });
      box.addEventListener('drop', (e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault(); e.stopPropagation();
        box.classList.remove('drop-files');
        const files = [...e.dataTransfer.files].map((f) => window.ts.pathForFile(f)).filter(Boolean);
        if (files.length) addFromPc(files);
      });
    }

    // ---------- skeleton ----------
    function build() {
      const d = D();
      d.innerHTML = '';
      d.classList.toggle('full', lib.full);
      const input = h('input', { class: 'lib-search', type: 'search', placeholder: 'Search: cave night goblin', value: lib.query, 'aria-label': 'Search the library', spellcheck: 'false' });
      input.addEventListener('input', () => { lib.query = input.value; limit = 160; renderMain(); renderNav(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; lib.query = ''; renderMain(); renderNav(); } });
      d.append(...[
        h('div', { class: 'drawer-head' }, iconEl('photo'), h('span', { class: 'pop-title' }, 'Library'), input,
          h('button', { class: 'btn small lib-add', 'aria-label': 'Add from PC', 'data-tip': 'Add files from this computer (or drop them here)', onclick: () => addFromPc() }, iconEl('folder-plus'), 'Add from PC'),
          h('button', { class: 'icon-btn', 'aria-label': 'Refresh', 'data-tip': 'Look for new files', onclick: reload }, iconEl('refresh')),
          h('button', { class: 'icon-btn', 'aria-label': 'Open folder', 'data-tip': 'Open the library folder', onclick: () => window.ts.library('open') }, iconEl('folder')),
          h('button', { class: 'icon-btn lib-full-btn', 'aria-label': 'Full screen', 'data-tip': lib.full ? 'Back to the side' : 'Full screen', 'data-key': 'Shift L', onclick: () => { lib.full = !lib.full; build(); render(); } }, iconEl(lib.full ? 'arrows-minimize' : 'arrows-maximize')),
          h('button', { class: 'icon-btn', 'aria-label': 'Close', 'data-tip': 'Close', 'data-key': 'Esc', onclick: cancel }, iconEl('x'))),
        ui.drawer && ui.drawer.purpose ? h('div', { class: 'drawer-purpose' }, h('span', { class: 'grow' }, purposeText(ui.drawer.purpose)),
          ui.drawer.back ? h('button', { class: 'btn small ghost drawer-cancel', 'data-key': 'Esc', onclick: cancel }, iconEl('arrow-back-up'), 'Cancel') : null) : null,
        h('div', { class: 'lib-body' }, h('nav', { class: 'lib-nav', 'aria-label': 'Library sections' }), h('div', { class: 'lib-main' }, h('div', { class: 'lib-chips' }), h('div', { class: 'lib-content' }))),
        h('div', { class: 'lib-tray' })].filter(Boolean));
      bindTrayDrop($('.lib-tray', d));
      if (!d.dataset.fileDrop) { d.dataset.fileDrop = '1'; bindFileDrop(d); }
    }
    function render() { if (!ui.drawer) return; renderNav(); renderMain(); renderTray(); renderPicks(); }

    // ---------- scope: which items are we looking at ----------
    const inCat = (it, cat) => cat === 'all' || it.cat === cat;
    function shelfItems(id) {
      if (id === 'fav') return items.filter((it) => it.fav);
      if (id === 'recent') return items.filter((it) => it.recent >= 0).sort((a, b) => a.recent - b.recent);
      if (id === 'campaign') return items.filter((it) => it.inCampaign);
      if (id === 'fits') return fits();
      return items;
    }
    // things that share words with the map being edited (its name, chapter, background)
    function fits() {
      const s = S();
      if (!s || !s.map) return [];
      const ch = s.campaign && s.campaign.chapters.find((c) => c.maps.some((m) => m.id === s.map.id));
      const ctxWords = new Set([...words(s.map.name), ...(ch ? words(ch.name) : []), ...(s.map.bg ? words((s.map.bg.rel || s.map.bg.name || '').replace(/\.[^.]+$/, '')) : [])]);
      if (!ctxWords.size) return [];
      return items.map((it) => ({ it, score: tagsOf(it).filter((w) => ctxWords.has(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.it.fav - a.it.fav) || ((a.it.recent < 0 ? 99 : a.it.recent) - (b.it.recent < 0 ? 99 : b.it.recent)))
        .map((x) => x.it);
    }
    function matches(it) {
      const q = words(lib.query);
      if (q.length) { const t = tagsOf(it); const n = it.name.toLowerCase(); if (!q.every((w) => n.includes(w) || t.some((x) => x.startsWith(w)))) return false; }
      if (lib.tags.length && !lib.tags.every((w) => tagsOf(it).includes(w))) return false;
      if (lib.kind && it.kind !== lib.kind) return false;
      return true;
    }
    const scopeItems = () => (lib.shelf ? shelfItems(lib.shelf) : items).filter((it) => inCat(it, lib.cat));

    // ---------- navigation ----------
    function renderNav() {
      const nav = $('.lib-nav', D());
      if (!nav) return;
      nav.innerHTML = '';
      const navBtn = (o, active, count, onclick) => h('button', { class: `lib-nav-btn ${active ? 'on' : ''}`, onclick, 'aria-pressed': String(active) },
        iconEl(o.icon), h('span', { class: 'grow' }, o.label), h('b', {}, count == null ? '' : String(count)));
      for (const c of CATS) {
        const n = c.id === 'all' ? items.length : items.filter((it) => it.cat === c.id).length;
        const here = !lib.shelf && lib.cat === c.id;
        // 4.11: a click on the open category goes back to its top; another category opens where it was left
        nav.append(navBtn(c, here && !folderNow(), loaded ? n : null, () => { lib.kind = null; if (here) goFolder(c.id, ''); else { const k = lib.folders[c.id] || ''; goFolder(c.id, loaded && k && !nodeAt(c.id, k) ? '' : k); } }));
        if (here && c.id !== 'all' && loaded) nav.append(folderTree(c.id));
      }
      nav.append(h('div', { class: 'lib-nav-sep' }, 'Shelves'));
      for (const sh of SHELVES) {
        const n = shelfItems(sh.id).length;
        nav.append(navBtn(sh, lib.shelf === sh.id, loaded ? n : null, () => { lib.shelf = sh.id; lib.cat = 'all'; lib.tags = []; lib.kind = null; limit = 160; render(); }));
      }
    }

    // 4.11: the folders of the open category as a tree (opened down to where you are)
    function folderTree(cat) {
      const box = h('div', { class: 'lib-tree' });
      const cur = folderNow();
      const open = lib.open[cat] || (lib.open[cat] = new Set());
      const add = (node, depth) => {
        for (const k of sortKids(node)) {
          const has = k.kids.size > 0;
          const isOpen = open.has(k.key) || cur === k.key || cur.startsWith(`${k.key}/`);
          const row = h('div', { class: `lib-tree-row ${cur === k.key ? 'on' : ''}`, style: `--d:${depth}`, role: 'button', tabindex: '0', 'data-key': k.key, 'data-tip': k.key.replace(/\//g, ' › '), 'data-tip-side': 'right',
            onclick: () => goFolder(cat, k.key), onkeydown: (e) => { if (e.key === 'Enter') goFolder(cat, k.key); } },
          has ? h('button', { class: `lib-tree-tw ${isOpen ? 'open' : ''}`, 'aria-label': isOpen ? 'Fold' : 'Unfold', onclick: (e) => { e.stopPropagation(); if (isOpen) { open.delete(k.key); if (cur.startsWith(`${k.key}/`)) goFolder(cat, k.key); else renderNav(); } else { open.add(k.key); renderNav(); } } }, iconEl('chevron-right')) : h('span', { class: 'lib-tree-tw none' }),
          iconEl(k.pack ? 'package' : 'folder'), h('span', { class: 'grow' }, k.pack ? k.name.slice(6) : k.name), h('b', {}, String(k.n)));
          box.append(row);
          if (has && isOpen) add(k, depth + 1);
        }
      };
      add(treeOf(cat), 0);
      return box;
    }

    // ---------- chips: animated or still (4.11: the word tags are gone; folders and search find things) ----------
    function renderChips(scope) {
      const box = $('.lib-chips', D());
      box.innerHTML = '';
      const chip = (label, on, onclick, icon) => h('button', { class: `chip ${on ? 'on' : ''}`, onclick }, icon ? iconEl(icon) : null, label);
      if (lib.cat === 'maps' || lib.cat === 'overlays') {
        box.append(chip('Animated', lib.kind === 'video', () => { lib.kind = lib.kind === 'video' ? null : 'video'; renderMain(); }, 'player-play'),
          chip('Still', lib.kind === 'image', () => { lib.kind = lib.kind === 'image' ? null : 'image'; renderMain(); }, 'photo'));
      }
      box.hidden = !box.children.length;
    }

    // ---------- content ----------
    function renderMain() {
      const content = $('.lib-content', D());
      if (!content) return;
      content.innerHTML = '';
      stopHoverVideos();
      if (!loaded) { content.append(UI.loader('Reading your library …')); return; }
      const scope = scopeItems();
      renderChips(scope);
      const list = scope.filter(matches);
      const overview = lib.cat === 'all' && !lib.shelf && !lib.query.trim() && !lib.tags.length;
      if (overview) { renderOverview(content); return; }
      if (!list.length) {
        content.append(h('div', { class: 'drawer-empty' },
          h('p', {}, lib.query || lib.tags.length ? 'Nothing matches.' : lib.shelf === 'fav' ? 'Star things to keep them here.' : lib.shelf === 'fits' ? 'Nothing shares a word with this map yet.' : 'Nothing here yet.'),
          lib.shelf ? null : h('button', { class: 'btn', onclick: () => window.ts.library('open') }, iconEl('folder'), 'Open the library folder')));
        return;
      }
      // 4.11: a category without a search: its folders, browsed (a path, the subfolders as cards, the files in this one)
      const q = lib.query.trim();
      if (lib.cat !== 'all' && !lib.shelf && !q) { renderFolder(content, list); return; }
      // a search (or a shelf): headings by folder (a click goes there); in All by category and folder
      const groups = new Map();
      for (const it of list) {
        const key = q || lib.cat !== 'all' ? `${it.cat}|${dirKey(foldersOf(it))}` : it.cat;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }
      const keys = [...groups.keys()];
      const catIdx = (k) => CATS.findIndex((c) => c.id === k.split('|')[0]);
      keys.sort((a, b) => catIdx(a) - catIdx(b) || (q ? 0 : a.localeCompare(b, undefined, { numeric: true })));
      let shown = 0;
      for (const key of keys) {
        if (shown >= limit) break;
        const g = groups.get(key).slice(0, Math.max(0, limit - shown));
        shown += g.length;
        const [cat, dk] = key.split('|');
        if (dk == null) content.append(h('div', { class: 'lib-group' }, iconEl(CAT_ICON[cat]), CAT_LABEL[cat], h('span', {}, String(groups.get(key).length))));
        else {
          const path = [lib.cat === 'all' ? CAT_LABEL[cat] : null, ...dk.split('/').filter(Boolean)].filter(Boolean);
          content.append(h('button', { class: 'lib-group lib-group-go', 'data-tip': 'Open this folder', onclick: () => { lib.query = ''; const inp = $('.lib-search', D()); if (inp) inp.value = ''; goFolder(cat, dk); } },
            iconEl(lib.cat === 'all' ? CAT_ICON[cat] : 'folder'), path.length ? path.join(' › ') : CAT_LABEL[cat], h('span', {}, String(groups.get(key).length))));
        }
        content.append(tilesFor(g, false, dk != null && dk !== ''));
      }
      if (list.length > shown) content.append(h('button', { class: 'btn wide', onclick: () => { limit += 400; renderMain(); } }, `Show ${list.length - shown} more`));
    }
    // 4.11: one folder of a category: where you are (each step a link back), its subfolders as cards with a few of
    // their files, then its own files; "All N inside" shows everything below it under folder headings
    function renderFolder(content, list) {
      const cat = lib.cat;
      let key = folderNow();
      let node = nodeAt(cat, key);
      if (!node) { key = ''; node = treeOf(cat); }
      const segs = key.split('/').filter(Boolean);
      const crumbs = h('div', { class: 'lib-path' },
        h('button', { class: `lib-crumb ${segs.length ? '' : 'on'}`, onclick: () => goFolder(cat, '') }, iconEl(CAT_ICON[cat]), CAT_LABEL[cat]),
        ...segs.flatMap((sg, i) => [iconEl('chevron-right', 'lib-crumb-sep'), h('button', { class: `lib-crumb ${i === segs.length - 1 ? 'on' : ''}`, onclick: () => goFolder(cat, segs.slice(0, i + 1).join('/')) }, sg.replace(/^Pack: /, ''))]),
        node.kids.size ? h('button', { class: `chip lib-deep ${lib.deep ? 'on' : ''}`, 'data-tip': lib.deep ? 'Back to the folders' : 'Every file in here and in its folders, under headings',
          onclick: () => { lib.deep = !lib.deep; limit = 160; renderMain(); } }, iconEl(lib.deep ? 'folder' : 'layout-grid'), lib.deep ? 'Folders' : `All ${node.n} inside`) : null);
      content.append(crumbs);
      const below = list.filter((it) => { const d = foldersOf(it); return segs.every((sg, i) => d[i] === sg); });
      if (lib.deep && node.kids.size) {
        const groups = new Map();
        for (const it of below) { const k = dirKey(foldersOf(it)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
        let shown = 0;
        for (const k of [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
          if (shown >= limit) break;
          const g = groups.get(k).slice(0, Math.max(0, limit - shown)); shown += g.length;
          const rest = k.split('/').slice(segs.length).filter(Boolean);
          content.append(h('button', { class: 'lib-group lib-group-go', 'data-tip': 'Open this folder', onclick: () => goFolder(cat, k) }, iconEl('folder'), rest.length ? rest.join(' › ').replace(/Pack: /g, '') : 'In this folder', h('span', {}, String(groups.get(k).length))));
          content.append(tilesFor(g, false, true));
        }
        if (below.length > shown) content.append(h('button', { class: 'btn wide', onclick: () => { limit += 400; renderMain(); } }, `Show ${below.length - shown} more`));
        return;
      }
      const kids = sortKids(node);
      if (kids.length) content.append(h('div', { class: 'lib-folders' }, ...kids.map((k) => folderCard(cat, k))));
      const own = below.filter((it) => foldersOf(it).length === segs.length);
      if (own.length) {
        if (kids.length) content.append(h('div', { class: 'lib-group' }, iconEl('folder'), segs.length ? `In ${segs[segs.length - 1].replace(/^Pack: /, '')}` : `In ${CAT_LABEL[cat]}`, h('span', {}, String(own.length))));
        content.append(tilesFor(own.slice(0, limit), false, segs.length > 0));
        if (own.length > limit) content.append(h('button', { class: 'btn wide', onclick: () => { limit += 400; renderMain(); } }, `Show ${own.length - limit} more`));
      } else if (!kids.length) content.append(h('div', { class: 'drawer-empty' }, h('p', {}, lib.kind ? 'Nothing like that in here.' : 'Nothing in this folder.')));
    }
    function folderCard(cat, node) {
      const pics = node.sample.slice(0, 4);
      const go = () => goFolder(cat, node.key);
      const el = h('div', { class: 'lf-card', role: 'button', tabindex: '0', 'data-key': node.key, 'aria-label': `Folder ${node.name}`, onclick: go, onkeydown: (e) => { if (e.key === 'Enter') go(); } },
        h('span', { class: `lf-mosaic n${pics.length}` }, ...(pics.length ? pics.map((it) => h('span', { class: `lf-pic ${cat === 'tokens' || cat === 'party' ? 'round' : ''}` }, Thumbs.img(it.path, it.kind, it.thumb))) : [iconEl(cat === 'sounds' ? 'music' : 'folder')])),
        h('span', { class: 'lf-name' }, iconEl(node.pack ? 'package' : 'folder'), h('span', { class: 'ellipsis' }, node.pack ? node.name.slice(6) : node.name), h('b', {}, String(node.n))));
      // drop library files onto it? (not yet): the card is a way in
      return el;
    }
    // "All" without a search: shelves first, then a row of each category
    function renderOverview(content) {
      const row = (title, icon, list, more) => {
        if (!list.length) return;
        content.append(h('div', { class: 'lib-group' }, iconEl(icon), title, h('span', {}, String(list.length)),
          more ? h('button', { class: 'lib-more', onclick: more }, 'All', iconEl('chevron-right')) : null));
        content.append(tilesFor(list.slice(0, lib.full ? 12 : 6), true));
      };
      row('Fits this map', 'wand', fits(), () => { lib.shelf = 'fits'; render(); });
      row('Favourites', 'star', shelfItems('fav'), () => { lib.shelf = 'fav'; render(); });
      row('Recent', 'clock', shelfItems('recent'), () => { lib.shelf = 'recent'; render(); });
      for (const c of CATS.slice(1)) row(c.label, c.icon, items.filter((it) => it.cat === c.id), () => { lib.cat = c.id; render(); });
      if (!items.length) content.append(h('div', { class: 'drawer-empty' }, h('p', {}, 'Your library is empty.'), h('button', { class: 'btn', onclick: () => window.ts.library('open') }, iconEl('folder'), 'Open the library folder')));
    }

    // tiles for a mixed or single-category list; maps become variant stacks
    function tilesFor(list, compact, short) {
      const wrap = h('div', { class: `lib-tiles ${compact ? 'compact' : ''}` });
      const runs = [];
      for (const it of list) {
        const last = runs[runs.length - 1];
        if (last && last.cat === it.cat) last.items.push(it); else runs.push({ cat: it.cat, items: [it] });
      }
      for (const r of runs) {
        const grid = h('div', { class: `lib-grid g-${r.cat}` });
        if (r.cat === 'maps') for (const st of stackMaps(r.items)) grid.append(mapCard(st));
        else if (r.cat === 'sounds') for (const it of r.items) grid.append(soundRow(it, short));
        else for (const it of r.items) grid.append(tile(it, short));
        wrap.append(grid);
      }
      return wrap;
    }

    // ---------- tiles ----------
    // 2.2: Ctrl-click tokens and portraits to pick several, then put them on this chapter's Ready list at once
    const picked = new Map(); // path -> item
    function togglePick(it, el) {
      if (picked.has(it.path)) picked.delete(it.path); else picked.set(it.path, it);
      for (const x of D().querySelectorAll('.lt.lt-tokens, .lt.lt-portraits')) if (x.dataset.path === it.path) x.classList.toggle('picked', picked.has(it.path)); // (it may show twice)
      el.classList.toggle('picked', picked.has(it.path));
      renderPicks();
    }
    function renderPicks() {
      const d = D();
      let bar = $('.lib-picks', d);
      if (!picked.size) { if (bar) bar.remove(); return; }
      if (!bar) { bar = h('div', { class: 'lib-picks' }); const body = $('.lib-body', d); if (body) body.before(bar); else d.append(bar); }
      const ch = ctx.ready.chapter();
      bar.replaceChildren(h('span', { class: 'grow' }, `${picked.size} picked`),
        h('button', { class: 'btn small primary', disabled: !ch, onclick: async () => {
          const list = [...picked.values()];
          for (const kind of ctx.ready.KINDS) { const these = list.filter((x) => ctx.ready.kindOf(x.cat) === kind && x.cat !== 'maps'); if (these.length) await ctx.ready.add(kind, these); }
          clearPicks();
        } }, iconEl('checklist'), h('span', {}, `Ready for ${ch ? ch.name : 'this chapter'}`)),
        h('button', { class: 'btn small ghost', onclick: clearPicks }, 'Clear'));
    }
    function clearPicks() {
      picked.clear();
      for (const el of D().querySelectorAll('.lt.picked')) el.classList.remove('picked');
      renderPicks();
    }
    function common(el, it) {
      el.draggable = true;
      el.dataset.path = it.path;
      if (it.cat !== 'maps') { // (Prototype 26: anything but a map can go on the Ready list)
        if (picked.has(it.path)) el.classList.add('picked');
        // a Ctrl-click picks it (instead of using it)
        el.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) { e.stopImmediatePropagation(); e.preventDefault(); togglePick(it, el); } }, true);
      }
      el.dataset.tip = it.rel;
      el.dataset.tipSide = 'right';
      el.addEventListener('dragstart', (e) => {
        const a = { path: it.path, kind: it.kind, role: ROLE[it.cat], name: it.name, cat: it.cat };
        e.dataTransfer.setData('application/x-ts-asset', JSON.stringify(a));
        e.dataTransfer.effectAllowed = 'copy';
        UI.DragPic.start(e, a, el); // 2.6: the map shows it half see-through, true size
        document.body.classList.add('dragging-asset');
      });
      el.addEventListener('dragend', () => document.body.classList.remove('dragging-asset'));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(it, e.clientX, e.clientY); });
      return el;
    }
    const star = (it) => h('button', {
      class: `lib-star ${it.fav ? 'on' : ''}`, 'aria-label': it.fav ? 'Remove from favourites' : 'Add to favourites', 'data-tip': it.fav ? 'Favourite' : 'Add to favourites',
      onclick: (e) => { e.stopPropagation(); setFav(it, !it.fav); },
    }, iconEl('star', it.fav ? 'fill' : ''));
    function thumbBox(it, cls) {
      const box = h('span', { class: `lt-thumb ${cls || ''}` }, it.kind === 'audio' ? iconEl('music') : Thumbs.img(it.path, it.kind, it.thumb));
      if (it.kind === 'video') {
        box.append(h('span', { class: 'lt-badge' }, iconEl('player-play')));
        hoverPlay(box, it);
      }
      if (it.walls) box.append(h('span', { class: 'lt-walls', 'data-tip': 'Comes with walls and doors' }, iconEl('wall')));
      return box;
    }
    function tile(it, short) {
      const weather = it.cat === 'overlays' && ctx.anchorFor(it.name) === 'table';
      const el = h('div', { class: `lt lt-${it.cat}`, role: 'button', tabindex: '0', onclick: () => use(it), onkeydown: (e) => { if (e.key === 'Enter') use(it); } },
        thumbBox(it, it.cat === 'assets' || it.cat === 'portraits' || it.cat === 'handouts' ? 'checker' : ''),
        h('span', { class: 'lt-name' }, short ? shortName(it) : it.name), // (4.11: inside its folder, without the folder's name)
        weather ? h('span', { class: 'lt-tag' }, 'Weather') : null,
        star(it));
      return common(el, it);
    }
    function mapCard(st) {
      const s = S();
      const cur = s && s.map && s.map.bg ? s.map.bg.path : null;
      const isCur = st.items.some((x) => x.path === cur);
      let it = st.items.find((x) => x.path === cur) || st.items[0];
      const el = h('div', { class: `lt lt-maps ${isCur ? 'is-current' : ''}`, role: 'button', tabindex: '0' });
      const fill = () => {
        el.innerHTML = '';
        el.append(thumbBox(it), h('span', { class: 'lt-name' }, st.items.length > 1 ? variantOf(it).base.replace(/^./, (c) => c.toUpperCase()) : it.name));
        if (isCur) el.append(h('span', { class: 'lt-tag cur' }, 'This map'));
        if (st.items.length > 1) {
          el.append(h('span', { class: 'lt-variants' }, ...st.items.map((v) => h('button', {
            class: `lt-var ${v === it ? 'on' : ''}`, 'data-tip': isCur ? `Show ${variantOf(v).label} on this map (grid and fog stay)` : `${variantOf(v).label}`,
            onclick: (e) => { e.stopPropagation(); if (isCur && v.path !== cur) { useVariant(v); return; } it = v; fill(); },
          }, variantOf(v).label))));
        }
        el.append(star(it));
      };
      fill();
      el.addEventListener('click', () => use(it));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(it); });
      return common(el, it);
    }
    function soundRow(it, short) {
      const play = h('button', { class: 'icon-btn lt-play', 'aria-label': `Listen to ${it.name}`, 'data-tip': 'Listen', onclick: (e) => { e.stopPropagation(); togglePreview(it, play); } }, iconEl('player-play'));
      const dur = h('span', { class: 'lt-dur' }, durations.has(it.path) ? fmtDur(durations.get(it.path)) : '');
      if (!durations.has(it.path)) queueDuration(it, dur);
      const folder = short ? '' : foldersOf(it).join(' › ').replace(/Pack: /g, ''); // (4.11: a heading names it already)
      const el = h('div', { class: 'lt lt-sounds', role: 'button', tabindex: '0', onclick: () => use(it), onkeydown: (e) => { if (e.key === 'Enter') use(it); } },
        play, h('span', { class: 'lt-name grow' }, short ? shortName(it) : it.name), folder ? h('span', { class: 'lt-folder' }, folder) : null, dur, star(it));
      return common(el, it);
    }

    // ---------- previews ----------
    let hoverVideos = [];
    function hoverPlay(box, it) {
      let v = null;
      box.addEventListener('pointerenter', () => {
        if (v) return;
        v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.className = 'lt-video';
        v.src = UI.pathToUrl(it.path);
        v.play().catch(() => {});
        box.append(v);
        hoverVideos.push(v);
      });
      box.addEventListener('pointerleave', () => { if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); v = null; } });
    }
    function stopHoverVideos() { for (const v of hoverVideos) { v.pause(); v.removeAttribute('src'); } hoverVideos = []; }
    let preview = null;
    function togglePreview(it, btnEl) {
      if (preview && preview.path === it.path) { stopPreview(); return; }
      stopPreview();
      const a = new Audio(UI.pathToUrl(it.path));
      a.volume = 0.8;
      a.play().catch(() => {});
      a.addEventListener('ended', stopPreview);
      preview = { path: it.path, audio: a, btn: btnEl };
      btnEl.innerHTML = '';
      btnEl.append(iconEl('player-pause'));
      btnEl.classList.add('on');
    }
    function stopPreview() {
      if (!preview) return;
      preview.audio.pause();
      if (preview.btn) { preview.btn.innerHTML = ''; preview.btn.append(iconEl('player-play')); preview.btn.classList.remove('on'); }
      preview = null;
    }
    const durations = new Map();
    const durQueue = [];
    let durBusy = false;
    const fmtDur = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
    function queueDuration(it, el) { durQueue.push({ it, el }); pumpDur(); }
    function pumpDur() {
      if (durBusy || !durQueue.length) return;
      durBusy = true;
      const { it, el } = durQueue.shift();
      const a = new Audio();
      a.preload = 'metadata';
      const done = () => { durations.set(it.path, a.duration); if (el.isConnected) el.textContent = fmtDur(a.duration); a.removeAttribute('src'); durBusy = false; pumpDur(); };
      a.addEventListener('loadedmetadata', done, { once: true });
      a.addEventListener('error', () => { durBusy = false; pumpDur(); }, { once: true });
      a.src = UI.pathToUrl(it.path);
    }

    // ---------- favourites, recent ----------
    async function setFav(it, on) {
      await window.ts.library('fav', { path: it.path, on });
      it.fav = on;
      render();
    }
    function touch(it) {
      window.ts.library('touch', it.path);
      const r = it.recent;
      for (const x of items) if (x.recent >= 0 && (r < 0 || x.recent < r)) x.recent++;
      it.recent = 0;
    }

    // ---------- context menu ----------
    function itemMenu(it, x, y) {
      const ch = ctx.viewChapter();
      const inTray = trayList().some((t) => t.path === it.path);
      const base = {
        maps: [
          { icon: 'plus', label: 'New map from this', action: () => use(it, 'newMap') },
          { icon: 'refresh', label: 'Background of this map', action: () => use(it, 'replace') },
          { icon: 'arrows-shuffle', label: 'Show as a variant of this map (keeps grid and fog)', action: () => useVariant(it) },
        ],
        tokens: [{ icon: 'user', label: 'Place as token', action: () => use(it, 'token') }],
        assets: [
          { icon: 'trees', label: 'Use as asset brush', action: () => use(it, 'brush') },
          { icon: 'user', label: 'Place as token instead', action: () => use(it, 'token') },
        ],
        overlays: [
          { icon: 'sparkles', label: 'Overlay that moves with the map', action: () => use(it, 'overlay', 'map') },
          { icon: 'cloud-rain', label: 'Weather overlay (fixed to the table)', action: () => use(it, 'overlay', 'table') },
        ],
        portraits: [{ icon: 'messages', label: 'Bring into the conversation', action: () => use(it, 'talk') }],
        handouts: [{ icon: 'script', label: 'Show on the table', action: () => use(it, 'handout') }],
        sounds: [
          { icon: 'player-play', label: 'Play once on the table (soundboard)', action: () => cmd('sound.play', { path: it.path }) },
          { icon: 'music', label: 'Add to this map', action: () => use(it, 'sound') },
          { icon: 'book-2', label: `Ambience for ${ch ? ch.name : 'this chapter'}`, action: () => use(it, 'ambience') },
        ],
      }[it.cat] || [];
      const hot = Hotbar.fromAsset({ path: it.path, kind: it.kind, cat: it.cat, name: it.name });
      openMenu(x, y, [...base, '-',
        ...(hot ? [Hotbar.menuItem(hot)] : []),
        // Prototype 26: one Ready list per chapter for anything (it was Ready for tokens and portraits, and the Tonight tray)
        ...(it.cat !== 'maps' ? [{ icon: 'checklist', label: inTray ? 'Take off the Ready list' : `Ready for ${(ctx.ready.chapter() || {}).name || 'this chapter'}`, action: () => (inTray ? trayRemove(it.path) : trayAdd(it)) }] : []),
        { icon: 'star', label: it.fav ? 'Remove from favourites' : 'Add to favourites', action: () => setFav(it, !it.fav) },
        { icon: 'folder', label: 'Show in folder', action: () => window.ts.library('reveal', it.path) }]);
    }

    // ---------- using things ----------
    function actionFor(it, purpose) {
      const c = it.cat;
      if (purpose === 'newMap' || purpose === 'replace') return c === 'maps' ? purpose : null;
      if (purpose === 'place') return c === 'tokens' ? 'token' : c === 'assets' ? 'assetAt' : null;
      if (purpose === 'ambience') return c === 'sounds' ? 'ambience' : null;
      if (purpose && purpose.startsWith('sfx:')) return c === 'sounds' ? 'sfx' : null;
      if (purpose && purpose.startsWith('moment:')) return c === 'sounds' ? 'momentSound' : null;
      if (purpose === 'brush') return c === 'assets' ? 'brush' : null;
      if (purpose === 'tokenBrush') return c === 'tokens' ? 'tokenBrush' : null;
      if (purpose === 'mapSound') return c === 'sounds' ? 'sound' : null;
      if (purpose === 'fight') return c === 'sounds' ? 'fight' : null;
      if (purpose === 'talk') return c === 'portraits' ? 'talk' : null;
      if (purpose === 'addToken') return c === 'tokens' ? 'token' : null;
      // with the Tokens tool on, a token becomes the one you drop with a click
      if (!purpose && c === 'tokens' && ui.tool === 'token') return 'tokenBrush';
      return null;
    }
    async function use(it, as, anchor) {
      const d = ui.drawer || {};
      const s = S();
      const action = as || actionFor(it, d.purpose) || { maps: 'newMap', tokens: 'token', assets: 'brush', overlays: 'overlay', sounds: 'sound', portraits: 'talk', handouts: 'handout' }[it.cat];
      const ch = ctx.viewChapter();
      touch(it);
      const back = d.back && d.purpose ? d.back : null; // opened from a menu to pick one thing
      switch (action) {
        case 'newMap': {
          const r = await cmd('map.add', { chapterId: d.chapterId || (ch && ch.id), path: it.path, index: d.index });
          if (r.ok) { toast(`${it.name} added as a new map`); done(null); }
          break;
        }
        case 'replace':
          if (s.map) { await undoable('bg.set', { path: it.path }, 'Background replaced'); done('bg'); }
          break;
        case 'token': {
          if (!s.map) break;
          const at = (d.purpose === 'place' && d.at) || ctx.viewCenter();
          await ctx.placeToken(it.path, at);
          if (d.purpose === 'place' || back) done(null);
          break;
        }
        case 'assetAt':
          if (s.map) { await ctx.placeAsset(it, d.at || ctx.viewCenter()); close(); }
          break;
        case 'brush':
          done(null);
          ctx.setBrush(it);
          break;
        case 'tokenBrush':
          close();
          ctx.setTokenBrush(it);
          break;
        case 'talk':
          await ctx.talkToggle(it);
          if (back) done(it.path);
          break;
        case 'handout': {
          const r = await cmd('handout.show', { path: it.path });
          if (r && r.ok) toast(r.shown ? `${it.name} is on the table (click it again to put it away)` : `${it.name} put away`);
          break;
        }
        case 'overlay': {
          const a = anchor || ctx.anchorFor(it.name);
          await cmd('layer.add', { path: it.path, role: 'overlay', anchor: a });
          toast(a === 'table' ? `${it.name} covers the whole table` : `${it.name} added to the map`);
          break;
        }
        case 'sound': {
          const r = await cmd('layer.add', { path: it.path, role: 'audio' });
          toast(`${it.name} plays while this map is on the table`);
          if (back) done(r && r.selected);
          break;
        }
        case 'ambience':
          if (ch) { await cmd('chapter.ambience', { id: ch.id, path: it.path }); toast(`${it.name} is the ambience for ${ch.name}`); done('ambience'); }
          break;
        case 'fight':
          if (ch) { await cmd('chapter.fight', { id: ch.id, path: it.path }); toast(`${it.name} plays when a fight starts in ${ch.name}`); done('fight'); }
          break;
        case 'momentSound': {
          const id = d.purpose.slice(7);
          await window.ts.settings({ momentSound: { id, path: it.path } });
          toast(`${(Moments.BY[id] || {}).label || 'The screen effect'} now plays ${it.name}`);
          done(`moment:${id}`);
          break;
        }
        case 'sfx': {
          const skin = d.purpose.slice(4);
          await window.ts.settings({ sfxFor: { skin, path: it.path } });
          toast(`${(FXDATA.SKINS[skin] || {}).label || skin} spells now play ${it.name}`);
          done(`sfx:${skin}`);
          break;
        }
        default:
      }
    }
    async function useVariant(it) {
      const s = S();
      if (!s.map) return;
      touch(it);
      await undoable('bg.set', { path: it.path, keep: true }, `${variantOf(it).label} shown`);
      render();
    }
    // from the radial Ready ring: drop it where the GM right-clicked
    async function useAt(t, pt) {
      const it = items.find((x) => x.path === t.path) || { ...t, url: UI.pathToUrl(t.path) };
      if (t.cat === 'tokens') return ctx.placeToken(t.path, pt);
      if (t.cat === 'assets') return ctx.placeAsset(it, pt);
      if (t.cat === 'overlays') return cmd('layer.add', { path: t.path, role: 'overlay', anchor: ctx.anchorFor(t.name) });
      if (t.cat === 'sounds') { await cmd('layer.add', { path: t.path, role: 'audio' }); toast(`${t.name} plays while this map is on the table`); }
      if (t.cat === 'portraits') return ctx.talkToggle(it);
      if (t.cat === 'handouts') return cmd('handout.show', { path: t.path });
      return null;
    }

    // ---------- the shelf: the chapter's Ready list (Prototype 26: it was the "Tonight" tray) ----------
    const trayList = () => ctx.ready.all();
    function trayAdd(it) {
      if (!ctx.ready.chapter()) { toast('Open a map first: the Ready list belongs to its chapter', { kind: 'error' }); return; }
      ctx.ready.add(ctx.ready.kindOf(it.cat), [{ path: it.path, name: it.name }]);
    }
    function trayRemove(p) { const k = ctx.ready.kindWith(p); if (k) ctx.ready.remove(k, p); }
    function renderTray() {
      const box = $('.lib-tray', D());
      if (!box) return;
      box.innerHTML = '';
      const list = trayList();
      traySig = JSON.stringify(list.map((x) => x.path));
      const ch = ctx.ready.chapter();
      box.append(h('span', { class: 'lib-tray-label', 'data-tip': ch ? `Ready for ${ch.name}` : '' }, iconEl('checklist'), 'Ready'));
      const strip = h('div', { class: 'lib-tray-strip' });
      for (const t of list) {
        const it = items.find((x) => x.path === t.path) || t;
        const el = h('button', {
          class: `tray-slot ${t.missing ? 'missing' : ''}`, 'data-tip': `${t.name} (right-click to remove)`, 'aria-label': t.name,
          onclick: () => use(it), oncontextmenu: (e) => { e.preventDefault(); trayRemove(t.path); },
        }, t.kind === 'audio' ? iconEl('music') : Thumbs.img(t.path, t.kind, it.thumb));
        strip.append(el);
      }
      strip.append(h('span', { class: 'tray-slot add' }, iconEl('plus')));
      box.append(strip, h('span', { class: 'hint' }, list.length ? 'Right-click the map → Ready to drop these in.' : 'Drag things here while you prep.'));
    }
    function bindTrayDrop(box) {
      box.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-ts-asset')) { e.preventDefault(); box.classList.add('drop-ok'); } });
      box.addEventListener('dragleave', () => box.classList.remove('drop-ok'));
      box.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        box.classList.remove('drop-ok');
        document.body.classList.remove('dragging-asset');
        try { const a = JSON.parse(e.dataTransfer.getData('application/x-ts-asset')); const it = items.find((x) => x.path === a.path); if (it) trayAdd(it); } catch {}
      });
    }

    // called on every state change: only redraw what changed
    let ctxSig = '';
    let traySig = '';
    function refreshPurpose() {
      const s = S();
      const sig = s && s.map ? `${s.map.id}|${s.map.bg && s.map.bg.path}|${s.map.name}` : '';
      if (sig !== ctxSig) { ctxSig = sig; render(); return; }
      const t = JSON.stringify(trayList().map((x) => x.path));
      if (t !== traySig) renderTray();
    }
    return { open, close, cancel, toggle, use, useAt, refreshPurpose, render, addFromPc, get isOpen() { return !!ui.drawer; }, get items() { return items; } };
  }

  return { create, variantOf, tagsOf, stackMaps, foldersOf, shortName };
})();
