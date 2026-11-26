// The library drawer: maps, tokens, overlays and sounds
'use strict';

module.exports = (area) => {
  area.title('Library');
  area.before(async (K) => { await K.openDemo(); });

  const open = async (t) => {
    await t.g(`Play.ui.lib.cat = 'all'; Play.ui.lib.shelf = null; Play.ui.lib.full = false`);
    t.gm().webContents.focus();
    await t.key('L');
    await t.until(() => t.g(`!!document.querySelector('#drawer.on')`), 3000, 'the library drawer');
    await t.until(async () => (await t.count('#drawer .lt')) >= 3, 5000, 'the library\'s files');
  };

  area.quick('L opens the library with a card for each file and their pictures', async (t) => {
    await open(t);
    const tiles = await t.count('#drawer .lt');
    t.ok(tiles >= 5, 'cards in the library', tiles);
    await t.until(async () => (await t.count('#drawer .lt .thumb.loaded')) >= 3, 15000, 'the pictures to load');
  });

  area.quick('a token dragged from the library onto the map is placed there', async (t) => {
    await open(t);
    const n0 = t.E().layers.filter((l) => l.role === 'token').length;
    const vp = await t.viewport();
    const at = { x: Math.round(vp.x + vp.w * 0.7), y: Math.round(vp.y + vp.h * 0.3) };
    const r = await t.g(`(() => {
      const tile = [...document.querySelectorAll('#drawer .lt')].find((x) => x.textContent.includes('Ogre'));
      if (!tile) return 'no Ogre card';
      const dt = new DataTransfer();
      tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const vp = document.getElementById('viewport');
      const o = { bubbles: true, cancelable: true, clientX: ${at.x}, clientY: ${at.y}, dataTransfer: dt };
      vp.dispatchEvent(new DragEvent('dragover', o));
      vp.dispatchEvent(new DragEvent('drop', o));
      return 'dropped';
    })()`);
    t.eq(r, 'dropped', 'the drag');
    await t.until(() => t.E().layers.filter((l) => l.role === 'token').length === n0 + 1, 4000, 'the new token');
    const tok = t.E().layers.filter((l) => l.role === 'token').pop();
    t.ok(/Ogre/.test(tok.name), 'it is the Ogre', tok.name);
  });

  area.deep('the search narrows the library to what matches and comes back when emptied', async (t) => {
    await open(t);
    const all = await t.count('#drawer .lt');
    await t.g(`(() => { const q = document.querySelector('#drawer input[type="search"], #drawer .lib-search input, #drawer input'); q.focus(); q.value = 'goblin'; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const hit = await t.until(async () => { const n = await t.count('#drawer .lt'); return n >= 1 && n < all && n; }, 4000, 'fewer cards for "goblin"');
    const names = await t.g(`[...document.querySelectorAll('#drawer .lt')].map((x) => x.textContent.trim())`);
    t.ok(names.every((n) => /goblin/i.test(n)), 'every card matches', names);
    await t.g(`(() => { const q = document.querySelector('#drawer input[type="search"], #drawer .lib-search input, #drawer input'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await t.until(async () => (await t.count('#drawer .lt')) > hit, 4000, 'all cards to come back');
  });

  area.deep('every kind of file is listed under its category', async (t) => {
    const cats = {};
    for (const x of t.library.listLibrary()) cats[x.cat] = (cats[x.cat] || 0) + 1;
    for (const want of ['maps', 'tokens', 'handouts', 'portraits', 'overlays']) t.ok(cats[want] >= 1, `the demo library has ${want}`, cats);
    t.ok(Object.keys(cats).every((c) => c && c !== 'undefined'), 'no file without a category', cats);
  });

  area.deep('a Ready token deleted from the library: a quiet word when the app is looked at again, greyed in Tokens, Take them off clears it', async (t) => {
    const fs = require('fs'); const path = require('path');
    const src = t.pic('tokens', /Goblin/i);
    const tmp = path.join(path.dirname(src), `Vanishing${path.extname(src)}`);
    fs.copyFileSync(src, tmp);
    await t.sleep(300);
    const ch = t.store.cur.meta.chapters[0];
    await t.cmd('ready.set', { chapterId: ch.id, kind: 'tokens', items: [{ path: tmp }] });
    fs.unlinkSync(tmp);
    // (the app looks for missing files when its window is looked at again)
    await t.g(`document.querySelectorAll('.toast').forEach((x) => x.remove()); window.dispatchEvent(new Event('focus')); 1`);
    const toast = await t.until(() => t.g(`(() => { const x = [...document.querySelectorAll('.toast')].find((e) => /Take them off/.test(e.textContent)); return x ? { text: x.textContent, error: x.classList.contains('error') } : null; })()`), 8000, 'the word about the missing file');
    t.eq(toast.error, false, 'it is not shown as an error');
    t.gm().webContents.focus();
    await t.key('N');
    await t.until(() => t.g(`document.querySelectorAll('#pop .ready-row .tok-pick.missing').length === 1`), 5000, 'the token greyed on the Ready row');
    await t.key('Escape');
    await t.g(`[...document.querySelectorAll('.toast button')].find((b) => /Take them off/.test(b.textContent)).click()`);
    await t.until(() => !((t.store.cur.meta.chapters[0].ready || {}).tokens || []).length, 4000, 'the Ready list to be cleared of it');
  });
  // I8 (Glinn's own sound effects): a library gets the new starter sounds; an old starter sound still as it came moves to
  // Audio/Old sounds (not deleted); every screen effect's built-in sound is there
  area.quick('the Soundboard starter sounds: the new ones come, an untouched old one moves to Audio/Old sounds', async (t) => {
    const fs = require('fs'); const path = require('path'); const os = require('os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-lib-'));
    const root0 = t.library.root; // (the library goes back to its own folder afterwards: the checks after this one found it empty)
    try {
      fs.mkdirSync(path.join(root, 'Audio', 'SFX'), { recursive: true });
      fs.writeFileSync(path.join(root, 'Audio', 'SFX', 'Thunder.ogg'), Buffer.alloc(32511)); // as the old one came
      fs.writeFileSync(path.join(root, 'Audio', 'SFX', 'Door creak.ogg'), Buffer.alloc(100)); // one the GM changed: it stays
      fs.copyFileSync(path.join(__dirname, '..', '..', 'renderer', 'sfx', 'moment-timestop.wav'), path.join(root, 'Audio', 'SFX', 'Horror hit 1.wav')); // its first name
      t.library.ensureLibrary(root, null);
      for (const f of ['Thunder.wav', 'Door creak.wav', 'Monster roar 1.wav', 'Monster roar 2.wav', 'Footsteps.wav', 'Heartbeat.wav', 'Horror strike.wav', 'Horror drums.wav', 'Horror boom.wav', 'Dragon roar.wav', 'Explosion.wav', 'Choir hit.wav', 'Bell.wav']) t.ok(fs.existsSync(path.join(root, 'Audio', 'SFX', f)), `${f} is there`);
      t.ok(!fs.existsSync(path.join(root, 'Audio', 'SFX', 'Thunder.ogg')) && fs.existsSync(path.join(root, 'Audio', 'Old sounds', 'Thunder.ogg')), 'the old Thunder moved to Audio/Old sounds');
      t.ok(fs.existsSync(path.join(root, 'Audio', 'SFX', 'Door creak.ogg')), 'a changed one stays where it was');
      t.ok(!fs.existsSync(path.join(root, 'Audio', 'SFX', 'Horror hit 1.wav')), 'Horror hit 1 is now Horror strike (a pad of its own)');
    } finally { if (root0) t.library.ensureLibrary(root0, null); fs.rmSync(root, { recursive: true, force: true }); }
    const ids = require('../../renderer/moments.js').LIST.map((d) => d.id).filter((id) => id !== 'lightning');
    const sfx = path.join(__dirname, '..', '..', 'renderer', 'sfx');
    const missing = ids.filter((id) => !fs.existsSync(path.join(sfx, `moment-${id}.wav`)) && !fs.existsSync(path.join(sfx, `moment-${id}.ogg`)));
    t.eq(missing, [], 'every screen effect has its built-in sound (Birds and Bat swarm too)');
    t.ok(fs.existsSync(path.join(sfx, 'thunder-roll.wav')), 'the thunder after a lightning strike');
    const skins = await t.g(`Object.keys(FXDATA.SKINS).map((k) => [k, FXDATA.spellSound(k)])`);
    t.eq(skins.filter(([, f]) => !fs.existsSync(path.join(__dirname, '..', '..', 'renderer', f))).map(([k]) => k), [], 'every spell look has its sound');
  });

  // UI audit VJ3 (Open Points): the Library renames, moves and deletes; the open campaign follows
  area.quick('VJ3: a file renamed or moved in the Library is followed by the open campaign; Delete asks when it is used and goes to the bin, never for good', async (t) => {
    const fs = require('fs'); const path = require('path'); const library = require('../../library');
    const lib = (a, arg) => t.g(`window.ts.library(${JSON.stringify(a)}, ${JSON.stringify(arg)})`);
    const src = t.pic('tokens', /Goblin/i); const ext = path.extname(src);
    const dir = path.join(library.root, 'Tokens', 'VJ3 test'); const dir2 = path.join(library.root, 'Tokens', 'VJ3 moved');
    fs.mkdirSync(dir, { recursive: true });
    const f0 = path.join(dir, `Vj3 raider${ext}`); const spare = path.join(dir, `Vj3 spare${ext}`); const taken = path.join(dir, `Vj3 taken${ext}`);
    for (const f of [f0, spare, taken]) fs.copyFileSync(src, f);
    const mapId = t.state.editMapId;
    const id = t.handle('layer.add', { mapId, path: f0, role: 'token', x: 3, y: 3, size: 1 }).selected;
    const layer = () => t.store.map(mapId).layers.find((l) => l.id === id);
    const ch = t.store.cur.meta.chapters[0]; const ready0 = ((ch.ready || {}).tokens || []).map((r) => ({ path: library.resolveRef(r) }));
    await t.cmd('ready.set', { chapterId: ch.id, kind: 'tokens', items: [...ready0, { path: f0 }] });
    await lib('fav', { path: f0, on: true });
    const bin = path.join(path.resolve(process.env.TS_TEST_DIR), 'bin');
    try {
      t.eq(layer().rel, 'Tokens/VJ3 test/Vj3 raider' + ext, 'the token on the map names the file by its place in the library');
      // rename
      t.ok(!(await lib('rename', { path: f0, name: 'a/b' })).ok, 'a name with a slash is turned away');
      const clash = await lib('rename', { path: f0, name: 'Vj3 taken' });
      t.ok(!clash.ok && /already there/.test(clash.error || '') && fs.existsSync(f0), 'a name that is taken is turned away, the file stays', clash);
      const r = await lib('rename', { path: f0, name: 'Vj3 chief' });
      t.ok(r.ok && r.uses >= 2, 'renamed; the campaign follows in at least two places (the map, the Ready list)', r);
      t.eq([fs.existsSync(f0), fs.existsSync(r.path)], [false, true], 'the file under its new name');
      t.eq([layer().rel, layer().missing, path.basename(layer().path)], ['Tokens/VJ3 test/Vj3 chief' + ext, false, 'Vj3 chief' + ext], 'the token on the map follows and is not missing');
      t.ok(((t.store.cur.meta.chapters[0].ready || {}).tokens || []).some((x) => x.rel === 'Tokens/VJ3 test/Vj3 chief' + ext), 'the Ready list follows');
      t.eq(library.listLibrary().find((x) => x.path === r.path).fav, true, 'it keeps its star');
      // move, into a new folder
      const m = await lib('move', { path: r.path, folder: 'Tokens', newFolder: 'VJ3 moved' });
      t.ok(m.ok && m.folder === 'Tokens/VJ3 moved' && fs.existsSync(m.path) && !fs.existsSync(r.path), 'moved into a new folder', m);
      t.eq([layer().rel, layer().missing], ['Tokens/VJ3 moved/Vj3 chief' + ext, false], 'the token on the map follows the move');
      t.ok(!(await lib('move', { path: m.path, folder: '../outside' })).ok, 'a place outside the library is turned away');
      // delete: a file the campaign uses asks first and says where
      const ask = await lib('trash', { path: m.path });
      t.ok(!ask.ok && ask.ask && ask.uses.length >= 1 && fs.existsSync(m.path), 'used by the campaign: it asks, with where, and the file stays', ask);
      const gone = await lib('trash', { path: m.path, sure: true });
      t.ok(gone.ok && !fs.existsSync(m.path), 'said yes: it leaves the library', gone);
      t.ok(fs.existsSync(bin) && fs.readdirSync(bin).some((n) => n.endsWith('Vj3 chief' + ext)), 'and lies in the bin (the self-test\'s own), not deleted for good');
      // a file nobody uses goes without a question; what is not the library's own is never touched
      const quick = await lib('trash', { path: spare });
      t.ok(quick.ok && !quick.ask && !fs.existsSync(spare), 'an unused file goes to the bin without a question', quick);
      const app = await lib('trash', { path: path.join(__dirname, '..', '..', '..', 'package.json'), sure: true });
      t.ok(!app.ok && fs.existsSync(path.join(__dirname, '..', '..', '..', 'package.json')), 'a file outside the library is never touched', app);
    } finally {
      t.handle('layer.remove', { mapId, id });
      await t.cmd('ready.set', { chapterId: ch.id, kind: 'tokens', items: ready0 });
      for (const d of [dir, dir2, bin]) fs.rmSync(d, { recursive: true, force: true }); // (the check's own copies in the self-test's library)
    }
  });

  area.quick('VJ3: a file\'s right-click menu in the Library has Rename, Move to and Delete; what comes with the app has none of them', async (t) => {
    await open(t);
    await t.g(`(() => { const b = [...document.querySelectorAll('#drawer .lib-nav-btn')].find((x) => /Tokens/.test(x.textContent)); if (b) b.click(); })()`);
    await t.until(() => t.rect('#drawer .lt'), 4000, 'the tokens');
    await t.sleep(300);
    const tile = await t.rect('#drawer .lt');
    await t.click(tile.cx, tile.cy, 'right');
    const menu = await t.until(() => t.menu(), 3000, 'the file\'s menu');
    t.eq(['Rename …', 'Move to …', 'Delete …'].filter((x) => !menu.includes(x)), [], 'missing from the menu');
    await t.menuPick('Move to …');
    const to = await t.until(async () => { const m = await t.menu(); return m && m.includes('New folder …') && m; }, 3000, 'where to move it');
    t.ok(to.includes('Tokens'), 'the category\'s own folder is offered', to);
    await t.key('Escape');
    await t.g(`Play.Drawer.close()`);
  });

  area.quick('VJ3: Rename from the menu: the name box, the new name on the card, Undo brings the old one back; Delete an unused file from the menu', async (t) => {
    const fs = require('fs'); const path = require('path'); const library = require('../../library');
    const src = t.pic('tokens', /Goblin/i); const ext = path.extname(src);
    const dir = path.join(library.root, 'Tokens', 'VJ3 menu');
    fs.mkdirSync(dir, { recursive: true });
    const f0 = path.join(dir, `Vjthree raider${ext}`);
    fs.copyFileSync(src, f0);
    const bin = path.join(path.resolve(process.env.TS_TEST_DIR), 'bin');
    const find = async (q) => { await t.g(`(() => { const i = document.querySelector('#drawer .lib-search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await t.sleep(400); };
    const cards = () => t.g(`[...document.querySelectorAll('#drawer .lt')].map((x) => (x.getAttribute('aria-label') || x.textContent || '').trim())`);
    const toasts = () => t.g(`[...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent)`);
    try {
      await t.g(`Play.Drawer.close()`).catch(() => {});
      await open(t);
      await find('Vjthree');
      await t.until(async () => (await cards()).length === 1, 5000, 'the one file');
      let tile = await t.rect('#drawer .lt');
      await t.click(tile.cx, tile.cy, 'right');
      await t.until(() => t.menu(), 3000, 'its menu');
      await t.menuPick('Rename …');
      await t.until(() => t.rect('.modal-back .modal input'), 3000, 'the name box');
      t.eq(await t.g(`document.querySelector('.modal-back .modal input').value`), 'Vjthree raider', 'the box starts with the file\'s name, without its ending');
      await t.g(`(() => { const i = document.querySelector('.modal-back .modal input'); i.value = 'Vjthree chief'; i.closest('form').requestSubmit(); })()`);
      await t.until(() => fs.existsSync(path.join(dir, `Vjthree chief${ext}`)) && !fs.existsSync(f0), 4000, 'the file under its new name');
      await t.until(async () => (await cards()).some((x) => x.includes('Vjthree chief')), 4000, 'the card with the new name');
      await t.until(async () => (await toasts()).some((x) => x.includes('Renamed to Vjthree chief')), 3000, 'a word about it');
      await t.g(`[...document.querySelectorAll('#toasts .toast')].find((x) => x.textContent.includes('Renamed to')).querySelector('.toast-undo').click()`);
      await t.until(() => fs.existsSync(f0), 4000, 'Undo gives the old name back');
      await t.until(async () => (await cards()).some((x) => x.includes('Vjthree raider')), 4000, 'the card with the old name');
      // Delete: nobody uses it: to the bin, with a word
      tile = await t.rect('#drawer .lt');
      await t.click(tile.cx, tile.cy, 'right');
      await t.until(() => t.menu(), 3000, 'its menu again');
      await t.menuPick('Delete …');
      await t.until(() => !fs.existsSync(f0), 4000, 'the file gone from the library');
      await t.until(async () => (await toasts()).some((x) => x.includes('is in the Windows bin')), 3000, 'a word where it went');
      t.eq((await cards()).length, 0, 'cards left for it');
    } finally {
      await find('').catch(() => {});
      await t.g(`document.querySelectorAll('#toasts .toast').forEach((x) => x.remove()); Play.Drawer.close()`).catch(() => {});
      for (const d of [dir, bin]) fs.rmSync(d, { recursive: true, force: true }); // (the check's own copies)
    }
  });

  // ---------- Speed 4 (Open Points WD1, WD2, WD3): the library is walked once and the list is kept ----------
  area.quick('WD1: the library is walked once for many askers; a star, a new file from outside and its going show at once', async (t) => {
    const L = require('../../library'); const fsx = require('fs'); const pathx = require('path');
    L.listDirty();
    const w0 = L.listStats.walks;
    const a = L.listLibrary(); const b = L.listLibrary(); const c = L.listLibrary().filter((x) => x.cat === 'sounds');
    t.eq([L.listStats.walks - w0, JSON.stringify(a) === JSON.stringify(b), c.length > 0], [1, true, true], 'walks for three lists, and the lists the same');
    a[0].name = 'changed by the asker';
    t.ok(L.listLibrary()[0].name !== 'changed by the asker', 'a list handed out belongs to the asker: changing it changes no other');
    // a star: the library's own action, known at once
    const one = a.find((x) => !x.builtin && x.cat === 'tokens') || a.find((x) => !x.builtin);
    const was = one.fav;
    L.setFavourite(one.path, !was);
    t.eq(L.listLibrary().find((x) => x.path === one.path).fav, !was, 'a star set: the next list has it');
    L.setFavourite(one.path, was);
    // a file put there from outside (as from the Explorer): the watcher tells
    const file = pathx.join(pathx.dirname(one.path), 'zz from outside.png');
    fsx.copyFileSync(one.path, file);
    try {
      await t.until(() => L.listLibrary().some((x) => x.path === file), 5000, 'the new file in the list');
      const w1 = L.listStats.walks;
      L.listLibrary(); L.listLibrary();
      t.eq(L.listStats.walks - w1, 0, 'and then the list is kept again');
    } finally { fsx.rmSync(file, { force: true }); }
    await t.until(() => !L.listLibrary().some((x) => x.path === file), 5000, 'the file gone from the list');
  });

  // Speed 3 (Open Point WC3, with Glinn's yes): small pictures of the cache that belong to no file any more are removed
  area.quick('WC3: a small picture without its file goes once it is a week old; a fresh one, one of a file that is there, one of a file named to keep and anything else in the folder stay', async (t) => {
    const L = require('../../library'); const fsx = require('fs'); const pathx = require('path');
    const dir = pathx.join(L.root, '.cache', 'thumbs'); fsx.mkdirSync(dir, { recursive: true });
    const list = L.listLibrary().filter((x) => !x.builtin && x.kind === 'image');
    const mine = list[0]; const kept = list[1];
    const mk = (name, daysOld) => { const p = pathx.join(dir, name); fsx.writeFileSync(p, 'x'); const at = new Date(Date.now() - daysOld * 864e5); fsx.utimesSync(p, at, at); return p; };
    const oldOrphan = mk('0123456789abcdef0123.webp', 30);
    const newOrphan = mk('abcdef0123456789abcd.webp', 1);
    const other = mk('notes of mine.txt', 30);
    // a small picture of a file of the library, and one of a file outside it that is named to keep (as a campaign's are)
    L.putThumb(mine.path, 'data:image/webp;base64,AAAA'); const ofMine = require('url').fileURLToPath(L.thumbUrl(mine.path));
    const outside = pathx.join(pathx.dirname(L.root), 'zz outside.png'); fsx.copyFileSync(kept.path, outside);
    try {
      L.putThumb(outside, 'data:image/webp;base64,AAAA'); const ofOutside = require('url').fileURLToPath(L.thumbUrl(outside));
      for (const p of [ofMine, ofOutside]) { const at = new Date(Date.now() - 30 * 864e5); fsx.utimesSync(p, at, at); }
      const r = await L.sweepThumbs([outside]);
      t.eq([fsx.existsSync(oldOrphan), fsx.existsSync(newOrphan), fsx.existsSync(other), fsx.existsSync(ofMine), fsx.existsSync(ofOutside)], [false, true, true, true, true], 'still there: the old one without a file (no), the fresh one, another file, the one of a library file, the one of a kept file', r);
      t.ok(r.removed >= 1, 'removed', r);
      const r2 = await L.sweepThumbs([]);
      t.eq(fsx.existsSync(ofOutside), false, 'not named to keep any more: the old small picture of the file outside goes too', r2);
    } finally { for (const p of [newOrphan, other, outside]) fsx.rmSync(p, { force: true }); }
  });

  // Speed 4 (Open Point WD5): the state is built without asking the disk each time
  area.quick('WD5: a state asks the disk about its Ready, Hotbar, screen and handout files once, not each time; a file that goes shows as missing, one that comes back as there', async (t) => {
    const L = require('../../library'); const fsx = require('fs'); const pathx = require('path');
    const c = t.store.cur; const ch = c.meta.chapters[0];
    const ready0 = ((ch.ready || {}).tokens || []).map((r) => ({ path: L.resolveRef(r) })); const hot0 = (c.meta.hotbar || []).slice();
    const toks = t.lib('tokens').filter((x) => !x.builtin).slice(0, 3);
    const mine = pathx.join(pathx.dirname(toks[0].path), 'zz wd5.png'); fsx.copyFileSync(toks[0].path, mine);
    // a file outside the library: no watcher sees it go
    const outside = pathx.join(pathx.dirname(L.root), 'zz wd5 outside.png'); fsx.copyFileSync(toks[0].path, outside);
    const real = fsx.existsSync; let n = -1;
    const pull = async () => { n = 0; const st = await t.g('window.ts.state()'); const got = n; n = -1; return { st, got }; };
    const of = (st, p) => st.campaign.chapters[0].ready.tokens.find((x) => x.path === p);
    try {
      t.handle('ready.set', { chapterId: ch.id, kind: 'tokens', items: [...toks.map((x) => ({ path: x.path })), { path: mine }, { path: outside }] });
      t.handle('hotbar.set', { slots: toks.map((x) => ({ kind: 'token', ref: { path: x.path }, label: 'T' })) });
      t.handle('screens.set', { which: 'brk', patch: { pic: { path: toks[1].path } } });
      t.handle('handout.share', { path: toks[2].path, to: 'all' });
      await t.settle();
      fsx.existsSync = function (...a) { if (n >= 0) n++; return real.apply(this, a); };
      L.thereForget();
      const a = await pull(); const b = await pull(); const d = await pull();
      t.ok(a.got >= 5, 'the first state after forgetting asks the disk', a.got);
      t.eq([b.got, d.got], [0, 0], 'the next two ask it nothing');
      t.eq([of(b.st, mine).missing, of(b.st, outside).missing, b.st.campaign.hotbar.filter((x) => x && x.missing).length, !!b.st.campaign.screens.brk.pic.missing], [false, false, 0, false], 'and say the same: all there');
      // a file of the library goes, as from the Explorer: the watcher on the library's folder tells
      fsx.rmSync(mine, { force: true });
      await t.until(async () => of((await pull()).st, mine).missing === true, 5000, 'the file gone from the library to show as missing');
      fsx.copyFileSync(toks[0].path, mine);
      await t.until(async () => of((await pull()).st, mine).missing === false, 5000, 'the file back in the library to show as there');
      // a file outside the library goes: known when a window gets the focus (thereForget), at the latest after 5 s
      fsx.rmSync(outside, { force: true });
      L.thereForget();
      t.eq(of((await pull()).st, outside).missing, true, 'a file outside the library that went: missing after the kept answers were forgotten');
    } finally {
      fsx.existsSync = real;
      for (const p of [mine, outside]) fsx.rmSync(p, { force: true });
      t.handle('ready.set', { chapterId: ch.id, kind: 'tokens', items: ready0 });
      t.handle('hotbar.set', { slots: hot0 });
      t.handle('screens.set', { which: 'brk', patch: { pic: null } });
      t.handle('handout.share', { path: toks[2].path, to: null });
      L.thereForget();
      await t.settle();
    }
  });

  // Speed 4 (Open Point WD6, the half about the walls): a Universal VTT file is unpacked once
  area.quick('WD6: a Universal VTT file is read once: the library unpacks its picture and keeps its walls; as a map\'s picture it is not read again; a changed file is', async (t) => {
    const L = require('../../library'); const W = require('../../walls-import'); const fsx = require('fs'); const pathx = require('path');
    const pic = t.lib('maps').find((x) => x.kind === 'image' && /\.(png|jpe?g|webp)$/i.test(x.path));
    const vtt = (extra) => JSON.stringify({
      format: 0.3, resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 12, y: 8 }, pixels_per_grid: 70 },
      line_of_sight: [[{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 5 }], [{ x: 8, y: 2 }, { x: 8, y: 6 }], ...extra],
      objects_line_of_sight: [[{ x: 2, y: 6 }, { x: 4, y: 6 }]],
      portals: [{ position: { x: 6, y: 3 }, bounds: [{ x: 6, y: 2.5 }, { x: 6, y: 3.5 }], closed: true }, { position: { x: 8, y: 4 }, bounds: [{ x: 8, y: 3.5 }, { x: 8, y: 4.5 }], closed: false }],
      lights: [{ position: { x: 3, y: 3 }, range: 4, intensity: 0.8, color: 'ffaa5500' }],
      environment: { baked_lighting: false }, image: fsx.readFileSync(pic.path).toString('base64'),
    });
    const file = pathx.join(pathx.dirname(pic.path), 'zz wd6.dd2vtt');
    const edit0 = t.state.editMapId; let own = null;
    const real = fsx.readFileSync; let reads = 0;
    fsx.readFileSync = function (...a) { if (pathx.resolve(String(a[0])) === pathx.resolve(file)) reads++; return real.apply(this, a); };
    try {
      fsx.writeFileSync(file, vtt([]));
      // the library sees it: one reading, for the picture and the walls
      L.listDirty();
      const it = L.listLibrary().find((x) => x.path === file);
      t.ok(it && /[\\/]\.cache[\\/]vtt[\\/]/.test(require('url').fileURLToPath(it.url)) && it.walls === true, 'in the library, shown through its unpacked picture, known to bring walls', it && it.url);
      t.eq(reads, 1, 'readings of the file when the library first sees it');
      const fresh = W.readVtt(file); reads = 0;
      const k0 = { ...L.vttStats };
      const kept = L.vttWalls(file);
      t.eq([reads, L.vttStats.kept - k0.kept, L.vttStats.read - k0.read], [0, 1, 0], 'asked for its walls: readings of the file, answers from what was kept, answers from the file');
      t.eq(JSON.parse(JSON.stringify(kept)), JSON.parse(JSON.stringify(fresh)), 'and what was kept is what the file says');
      t.ok(kept.walls.length >= 4 && kept.walls.some((w) => w[4]) && kept.lights.length === 1, 'walls, a door and a light', [kept.walls.length, kept.lights.length]);
      // as a map's picture: its walls come, and the file is not read
      own = await t.newMap('WD6 (test)', { blank: true });
      reads = 0;
      t.handle('bg.set', { mapId: own, path: file });
      await t.until(() => (t.store.map(own).walls || []).length > 0, 8000, 'the walls on the map');
      const m = t.store.map(own);
      t.eq([reads, m.walls.filter((w) => w.door).length >= 1, /[\\/]\.cache[\\/]vtt[\\/]/.test(require('url').fileURLToPath(m.bg.url))], [0, true, true], 'readings of the file; a door among the walls; the map shows the unpacked picture');
      // the file changed (another wall): read anew, once, and kept again
      await t.sleep(1100);
      fsx.writeFileSync(file, vtt([[{ x: 10, y: 1 }, { x: 10, y: 7 }]]));
      reads = 0;
      const k1 = { ...L.vttStats };
      const again = L.vttWalls(file); const twice = L.vttWalls(file);
      t.eq([reads, L.vttStats.read - k1.read, L.vttStats.kept - k1.kept, again.walls.length - kept.walls.length, twice.walls.length === again.walls.length], [1, 1, 1, 1, true], 'a changed file: readings; from the file; from what was kept; one wall more; the same both times');
    } finally {
      fsx.readFileSync = real;
      fsx.rmSync(file, { force: true });
      if (edit0) t.handle('edit.open', { id: edit0 });
      L.listDirty();
      await t.settle();
    }
  });

  // XA6 (Glinn, 26 Nov 2026): the sign "Adding to the library" shows the maid running, and smaller
  area.quick('XA6: the big sign while something takes a moment shows the running maid at 96 px without the hop; the small one in a list is as it was', async (t) => {
    const out = await t.g(`(async () => {
      let seen = null;
      await UI.withLoader('Adding to the library …', async () => { await new Promise((r) => setTimeout(r, 120)); const el = document.querySelector('.loader-back .loader-maid'); const cs = el && getComputedStyle(el); seen = el ? [el.getAttribute('src'), cs.height, cs.animationName, document.querySelector('.loader-back .loader span').textContent] : null; }, 10);
      const small = UI.loader('Loading …').querySelector('img').getAttribute('src');
      return { seen, small, gone: !document.querySelector('.loader-back') };
    })()`);
    t.eq(out.seen, ['maid-run.webp', '96px', 'none', 'Adding to the library'], 'the big sign: her running picture, its height, no hop, its words');
    t.eq([out.small, out.gone], ['maid.webp', true], 'the small loader keeps the standing maid; the sign is gone when the work is done');
  });
};
