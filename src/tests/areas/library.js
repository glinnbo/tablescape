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
};
