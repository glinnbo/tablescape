// Oldschool maps (Beta 3.22): a map drawn on the grid like on the big squared paper of old, with tiles that come with
// the app. The GM screen makes its picture with the graphics card (renderer/oldschool.js): on a machine without one
// this area runs with WebGL in software (scripts/run-tests.js).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (area) => {
  area.title('Oldschool maps');
  const L = require('../../library');
  let own = null; let k = 1;
  const M = (t) => t.store.map(own);
  // (Beta 3.38) Wall, Pillar, Stairs, Door and Window come out of Room: pick Room first when they are not showing
  const PARTS = ['wall', 'pillar', 'stairs', 'door', 'window'];
  // (the tabs slide out from behind the panel: a click waits until they have arrived)
  const tabsOut = (t) => t.until(() => t.g(`document.getAnimations().every((a) => { const e = a.effect && a.effect.target; return !(e && e.closest && e.closest('#pop .os-tabs')) || a.playState === 'finished'; })`), 4000, 'the tabs to come out');
  const tab = async (t, id) => { await tabsOut(t); await t.clickSel(`.os-tools .tile[data-v="${id}"]`); };
  // (Beta 3.41) the card beside the tabs slides out from behind the panel, and back when closed: wait for either
  const cardOut = (t) => t.until(() => t.g(`(() => { const e = document.querySelector('#pop .os-fly'); return !!e && !e.classList.contains('out') && e.getAnimations().every((a) => a.playState === 'finished'); })()`), 4000, 'the card to come out');
  const cardGone = (t) => t.until(async () => (await t.count('#pop .os-fly')) === 0, 4000, 'the card to go');
  const tool = async (t, id) => {
    if (PARTS.includes(id) && !(await t.count(`.os-tabs2 .tile[data-v="${id}"]`))) await tab(t, 'room');
    await tab(t, id);
  };
  const wallsOf = (t) => M(t).walls.filter((w) => w.os);
  const clear = async (t) => { t.handle('os.clear', { mapId: own }); await t.settle(); await baked(t); };
  // the picture of what is drawn now has come back from the GM screen
  const baked = (t, ms = 90000) => t.until(async () => {
    const m = M(t); if (!m || !m.os) return false;
    const want = await t.g(`Play.OS.hashOf(${JSON.stringify({ os: m.os, grid: m.grid })})`);
    if (!m.os.items.length) return !m.bg ? true : false;
    return m.bg && m.bg.os === want && fs.existsSync(m.bg.path) && m;
  }, ms, 'the picture of the drawing');
  const room = (x0, y0, x1, y1, extra = {}) => ({ kind: 'area', shape: 'rect', pts: [[x0 * k, y0 * k], [x1 * k, y1 * k]], tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' }, edge: 'walls', mat: 'stone_wall', level: 0, ...extra });

  area.before(async (K) => {
    await K.openDemo();
    await K.until(() => K.g('!!document.createElement("canvas").getContext("webgl2")'), 8000, 'WebGL on your screen');
    await K.g('Oldschool.noSharp = true'); // (software graphics here: the sharp tiles only where they are the point)
    await K.g('Oldschool.noPill = true'); // (and no running maid: drawing it all the while starves the picture here)
  });

  area.quick('the tiles come with the app: 49 floors in Library → Tiles (Beta 3.30: 37 more), five materials for walls, rock and cliffs', async (t) => {
    const list = t.lib('tiles').filter((x) => x.builtin);
    t.eq(list.length, 49, 'floors in the library');
    t.eq(L.tileOf({ rel: 'Tiles/Tablescape/Grassy flagstones.webp' }).squares, 7, 'a new one, known by name');
    t.ok(list.every((x) => x.rel.startsWith('Tiles/Tablescape/') && fs.existsSync(x.path) && x.thumb && x.squares > 0), 'each with its picture, a small one and its squares', list[0]);
    t.ok(!list.some((x) => /stone_wall|hedge|Mossy rock/i.test(x.name)), 'the materials are not floors', list.map((x) => x.name));
    t.eq(await t.g('Oldschool.MATERIALS.map((m) => m.label).join()'), 'Stone,Dark stone,Hedge,Rock,Mossy rock', 'materials');
    t.ok(!path.relative(L.root, list[0].path).startsWith('Tiles'), 'not files of the library folder');
    t.eq(L.tileOf({ rel: 'Tiles/Tablescape/Slate.webp' }).squares, 6, 'known by name');
  });

  area.quick('Add map → Oldschool map: a drawn map without a picture, the Draw tool in hand', async (t) => {
    t.gm().webContents.focus();
    await t.clickSel('.map-tile.add-tile');
    t.eq(await t.menu(), ['From the library', 'Oldschool map (draw it)'], 'Add map offers both');
    const before = new Set(t.store.allMapIds());
    await t.menuPick('Oldschool map');
    own = await t.until(() => t.store.allMapIds().find((id) => !before.has(id)), 6000, 'the new map');
    await t.until(() => t.state.editMapId === own, 6000, 'it opens');
    k = M(t).grid.size;
    t.ok(M(t).os && !M(t).bg && M(t).os.items.length === 0, 'drawn, nothing yet', M(t).os);
    t.eq(M(t).name, 'Drawn map', 'its name');
    await t.until(async () => (await t.tool()) === 'oldschool', 4000, 'the Draw tool');
    t.eq(await t.popTitle(), 'Draw', 'its panel');
    t.ok(await t.g(`!document.querySelector('#empty.on')`), 'no "no background" card in the way');
    t.ok(await t.g(`(() => { const b = document.querySelector('#rail [data-id="oldschool"]'); return !!b && !b.hidden && b.offsetParent !== null; })()`), 'Draw is on the rail');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((c) => [...c.querySelectorAll('.tile')].map((b) => b.dataset.v))`), [['room', 'shape', 'round', 'brush', 'floor', 'erase'], ['wall', 'pillar', 'stairs', 'door', 'window']], 'its tools: six, and with Room picked its five parts beside it (Beta 3.38)');
    t.eq(await t.count('.os-floors .tile[data-v]'), 8, 'the last 8 tiles used (Beta 3.35)');
    await t.clickSel('.os-tile-list');
    await t.until(async () => (await t.count('.fp[data-id="ostiles"] .pl-it')) >= 11, 4000, 'List …: all the tiles of the app');
    t.ok(await t.g(`(() => { const g = document.querySelector('.fp[data-id="ostiles"] .pl-grid').getBoundingClientRect(); return [...document.querySelectorAll('.fp[data-id="ostiles"] .pl-it')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= g.top - 1 && r.bottom <= g.bottom + 1; }).length; })()`) >= 15, 'as wide as the Tokens list: rows of five (Beta 3.37)');
    // (Beta 3.38) the list in an order of your choice: by name, by colour, the newest first; kept for next time
    const names = () => t.g(`[...document.querySelectorAll('.fp[data-id="ostiles"] .pl-it')].map((e) => e.getAttribute('aria-label'))`);
    const sorted = (l) => [...l].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
    t.eq(await t.g(`[...document.querySelectorAll('.fp[data-id="ostiles"] .pl-sort .seg-btn')].map((b) => [b.textContent, b.classList.contains('on')])`), [['Name', true], ['Colour', false], ['Newest', false]], 'a switch: Name, Colour, Newest');
    const byName = await names();
    t.eq(byName, sorted(byName), 'by name at first');
    await t.clickText('.fp[data-id="ostiles"] .pl-sort .seg-btn', 'Colour');
    await t.until(async () => (await t.g(`Object.keys(JSON.parse(localStorage.getItem('osTileTints') || '{}')).length`)) >= byName.length, 8000, 'every tile\'s colour read');
    await t.sleep(300);
    const byColour = await names();
    t.ok(byColour.join() !== byName.join() && sorted(byColour).join() === byName.join(), 'by colour: the same tiles in another order', byColour.slice(0, 6));
    t.ok(byColour.indexOf('Slate') < byColour.indexOf('Mossy court') && byColour.indexOf('Slate') < byColour.indexOf('Lava field'), 'greys first', byColour.slice(0, 8));
    await t.clickText('.fp[data-id="ostiles"] .pl-sort .seg-btn', 'Newest');
    const byNew = await names();
    t.ok(byNew.indexOf('Old cobblestone') > byNew.indexOf('Lava field'), 'the newest first: the tiles that came last before the first ones', byNew.slice(0, 5));
    t.eq(await t.g(`localStorage.getItem('pickSort:ostiles')`), 'newest', 'the order is kept');
    await t.clickText('.fp[data-id="ostiles"] .pl-sort .seg-btn', 'Name');
    await t.clickSel('.fp[data-id="ostiles"] .fp-close');
    t.ok(await t.g(`!!document.querySelector('.map-tile[data-id="${own}"] .tile-thumb .i')`), 'its tile in the strip shows a pencil');
  });

  area.quick('a room dragged on the grid becomes the map\'s picture, on the TV too; its outline the walls for sight', async (t) => {
    await t.cmd('edit.open', { id: own });
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tool(t, 'room');
    const a = await t.scr(15 * k, 3 * k); const b = await t.scr(21 * k, 7 * k);
    await t.drag(a, b, 12);
    await t.until(() => M(t).os.items.length === 1, 5000, 'the room drawn');
    const it = M(t).os.items[0];
    t.eq([it.kind, it.shape, it.pts], ['area', 'rect', [[15 * k, 3 * k], [21 * k, 7 * k]]], 'a room from corner to corner, on the grid', it);
    t.eq(it.tile && it.tile.rel, 'Tiles/Tablescape/Old cobblestone.webp', 'with the first floor');
    const m = await baked(t);
    t.ok(/[\\/]drawn[\\/]/.test(m.bg.path) && m.bg.kind === 'image', 'its picture, kept with the campaign', m.bg);
    t.ok(m.bg.x < 15 * k && m.bg.y < 3 * k && m.bg.nw * m.bg.scale > 6 * k, 'the picture covers the room with a margin', m.bg);
    const w = wallsOf(t);
    t.ok(w.length >= 4, 'walls round the room', w.length);
    const xs = w.flatMap((x) => [x.x1, x.x2]); const ys = w.flatMap((x) => [x.y1, x.y2]);
    t.ok(Math.min(...xs) >= 14.5 * k && Math.max(...xs) <= 21.5 * k && Math.min(...ys) >= 2.5 * k && Math.max(...ys) <= 7.5 * k, 'along its edge', [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
    await t.send(own);
    await t.until(() => t.state.liveMapId === own, 5000, 'on the table');
    await t.until(() => t.t(`(() => { const i = [...document.querySelectorAll('img, video')].find((x) => (x.currentSrc || x.src || '').includes('/drawn/')); return !!i && i.complete && i.naturalWidth > 0; })()`), 10000, 'the picture on the TV');
    t.eq(await t.badText(), [], 'nothing reads null or undefined');
  }, { ms: 180000 });

  area.quick('undo takes the last thing drawn back at once, its picture too; redo brings it again', async (t) => {
    const first = M(t).bg.path;
    t.handle('os.add', { mapId: own, item: room(21, 4, 25, 6) });
    await t.settle();
    const m2 = await baked(t);
    t.ok(m2.bg.path !== first, 'a new picture', m2.bg.path);
    t.handle('history.undo', { mapId: own });
    await t.settle();
    t.eq(M(t).os.items.length, 1, 'one room again');
    t.eq(M(t).bg.path, first, 'its picture back at once');
    t.ok(fs.existsSync(first), 'still there');
    t.handle('history.redo', { mapId: own });
    await t.settle();
    t.eq(M(t).os.items.length, 2, 'redo');
    await baked(t);
  }, { ms: 180000 });

  area.quick('library tiles of your own: Library → Tiles; how many squares one spans is asked once and kept', async (t) => {
    const dir = path.join(L.root, 'Tiles');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Test flagstones.webp');
    fs.copyFileSync(L.resolveRef({ rel: 'Tiles/Tablescape/Slate.webp' }), file);
    let it = t.lib('tiles').find((x) => x.path === file);
    t.ok(it && !it.builtin && it.squares == null, 'listed under Tiles, its squares not known yet', it);
    L.setTileSquares(file, 5);
    it = t.lib('tiles').find((x) => x.path === file);
    t.eq(it.squares, 5, 'known now');
    t.handle('os.add', { mapId: own, item: room(3, 8, 7, 11, { tile: { rel: it.rel } }) });
    await t.settle();
    await baked(t);
    t.ok(M(t).os.items.some((x) => x.tile && x.tile.rel === it.rel), 'a floor of your own tile');
  }, { ms: 120000 });

  area.deep('the Draw panel: each tool, a floor, the edge, where the light comes from', async (t) => {
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await t.g(`localStorage.removeItem('osPrefs')`);
    for (const id of ['shape', 'round', 'brush', 'floor', 'erase', 'wall', 'pillar', 'stairs', 'door', 'window', 'room']) {
      await tool(t, id);
      t.eq(await t.g('Play.ui.os.tool'), id, `tool ${id}`);
    }
    // (Beta 3.35) the choices come first; the door's leaf follows Door / Secret; a window has a tool of its own
    await tool(t, 'door');
    await t.clickText('#pop .seg-btn', 'Iron');
    t.eq(await t.g('Play.ui.os.doorLeaf'), 'metal', 'an iron door');
    await t.clickText('#pop .seg-btn', 'Secret');
    t.ok(await t.g(`document.querySelector('#pop .os-leaf').hidden`), 'a secret door has no leaf to pick');
    await t.clickText('#pop .seg-btn', 'Door');
    t.ok(await t.g(`!document.querySelector('#pop .os-leaf').hidden`), 'a door has');
    t.eq(await t.count('#pop .os-floors'), 0, 'no tiles for doors');
    await tool(t, 'window');
    await t.clickText('#pop .seg-btn', 'Bars');
    t.eq(await t.g('Play.ui.os.windowLeaf'), 'bars', 'bars in a window');
    // (Beta 3.37) the Tile tool changes a floor's tile and nothing else
    await tool(t, 'floor');
    t.eq(await t.count('#pop .os-level'), 0, 'the Tile tool has no level to pick');
    t.eq(await t.count('#pop .os-looks .os-pick'), 4, 'but Blending, also for the whole floor (Beta 3.38)');
    t.eq(await t.count('#pop .os-floors .tile[data-v]'), 8, 'but the tiles');
    await t.clickText('#pop .seg-btn', 'Brush');
    t.eq(await t.g('Play.ui.os.floorHow'), 'paint', 'painted on with the brush');
    t.eq(await t.count('#pop .os-looks .os-pick'), 4, 'with Blending as well');
    await t.clickText('#pop .seg-btn', 'Whole floor');
    t.eq([await t.g('Play.ui.os.floorHow'), await t.g('Play.ui.os.floorMode')], ['click', 'tile'], 'or the whole floor clicked: its tile alone');
    await tool(t, 'pillar');
    t.eq(await t.g(`Number(document.querySelector('#pop input[aria-label="Size"]').max)`), 8, 'pillars up to 8 squares');
    // (Beta 3.37) the menu made new: the tools as tabs on the panel's edge, a picture of what comes
    t.eq(await t.g(`document.querySelector('#pop .os-prev b').textContent`), 'Stone pillar', 'a picture of the pillar to come, with its name');
    // (Beta 3.38) Room's parts: a second column while Room or one of them is picked, Room stays marked
    t.ok(await t.g(`(() => { const two = document.querySelector('#pop .os-tabs2'); const one = document.querySelector('#pop .os-tabs:not(.os-tabs2)'); const room = one.querySelector('[data-v="room"]'); const a = one.getBoundingClientRect(); const b = two.getBoundingClientRect(); return room.classList.contains('open') && !room.classList.contains('on') && two.querySelector('[data-v="pillar"]').classList.contains('on') && b.left < a.right && b.right > a.right + 40 && Math.abs(b.top - a.top) < 3; })()`), 'the pillar among Room\'s parts, beside the tools, Room marked as open');
    // (Beta 3.41) Room's parts stand close together and begin under the tools, so nothing of the map shows between; no scroll bar beside the tabs
    t.ok(await t.g(`(() => { const r = [...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.getBoundingClientRect()); const one = document.querySelector('#pop .os-tabs:not(.os-tabs2) [data-v="shape"]').getBoundingClientRect(); return r.length === 5 && r.every((b, i) => !i || Math.abs(b.top - r[i - 1].bottom) <= 1.5) && r.every((b) => b.left <= one.right - 8); })()`), 'the parts in one block, filled up to the tools');
    t.eq(await t.g(`getComputedStyle(document.querySelector('#pop .pop-body')).scrollbarWidth`), 'none', 'no scroll bar in the panel');
    t.eq(await t.g(`getComputedStyle(document.querySelector('#pop .os-tabs2 .tile:not(.on)')).color === getComputedStyle(document.querySelector('.g-build .rail-head')).color`), true, 'the parts in the blue of Build');
    await tool(t, 'shape');
    t.eq(await t.count('#pop .os-tabs2'), 0, 'another tool: the parts go');
    // (Beta 3.38) the tabs come out from behind the panel when it opens; Room's parts from behind the tools when Room is picked
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => e.classList.contains('slide'))`), [false], 'a tool picked: the tabs stay where they are');
    t.ok(await t.g(`document.querySelector('#pop .os-tabs .tile[data-v="shape"]').classList.contains('pick')`), 'the picked one comes out a little further');
    await tab(t, 'room');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => [e.classList.contains('slide'), getComputedStyle(e.querySelector('.tile:last-child')).animationName])`), [[false, 'none'], [true, 'os-part-out']], 'Room picked: its parts slide out, the tools stay');
    await tab(t, 'door');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => e.classList.contains('slide'))`), [false, false], 'a part picked: nothing slides again');
    await t.g(`Play.closePop(), Play.openPop('oldschool')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => [e.classList.contains('slide'), getComputedStyle(e.querySelector('.tile')).animationName])`), [[true, 'os-tab-out'], [true, 'os-part-out']], 'the panel opened anew: all of them come out from behind it');
    t.ok(await t.g(`(() => { const p = document.querySelector('#pop').getBoundingClientRect(); return [...document.querySelectorAll('#pop .os-tabs')].every((e) => /inset/.test(getComputedStyle(e).clipPath)) && document.querySelector('#pop .os-tabs').getBoundingClientRect().left >= p.right - 2; })()`), 'cut at the panel\'s edge, so they come from behind it');
    await tool(t, 'shape');
    await tool(t, 'room');
    t.ok(await t.g(`(() => { const p = document.querySelector('#pop'); const at = (sel) => [...p.querySelectorAll('*')].indexOf(p.querySelector(sel)); return at('.os-prev') < at('.os-level') && at('.os-level') < at('.os-floors') && at('.os-floors') < at('.os-mapbtn'); })()`), 'the picture, the choices, the tiles, then the button to the map\'s settings');
    // (Beta 3.38) Blending: four looks; the sliders behind a small button, in a card
    t.eq(await t.count('#pop .os-rail'), 0, 'no rail of sliders any more');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-looks .os-pick')].map((b) => [b.textContent, b.classList.contains('on'), !!b.querySelector('.os-look')])`), [['Sharp', false, true], ['Soft', false, true], ['Natural', true, true], ['Tiled', false, true]], 'Blending: four looks as pictures, Natural at first');
    await t.clickText('#pop .os-looks .os-pick', 'Sharp');
    t.eq(await t.g('Play.ui.os.mixW'), 0, 'Sharp: no soft line');
    await t.clickText('#pop .os-looks .os-pick', 'Tiled');
    t.eq(await t.g('[Play.ui.os.mixW, Play.ui.os.mixU, Play.ui.os.mixT]'), [1.5, 0.5, 1], 'Tiled: stone by stone');
    await t.clickSel('#pop .os-fine');
    t.ok(await t.g(`document.querySelector('#pop .os-fly').classList.contains('slide')`), 'the card slides out from behind the panel (Beta 3.41)');
    await cardOut(t);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-fly input[type=range]')].map((x) => x.getAttribute('aria-label'))`), ['Mix width', 'Uneven', 'Tiled'], 'the small button: the three sliders in a card');
    await t.g(`(() => { const i = document.querySelector('#pop .os-fly input[aria-label="Uneven"]'); i.value = '0.8'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    t.eq([await t.g('Play.ui.os.mixU'), await t.count('#pop .os-looks .os-pick.on')], [0.8, 0], 'fine-tuned: none of the four looks');
    await t.clickText('#pop .os-looks .os-pick', 'Natural');
    t.eq(await t.g('[Play.ui.os.mixW, Play.ui.os.mixU, Play.ui.os.mixT]'), [1.5, 0.5, 0.5], 'and Natural again');
    await t.clickSel('#pop .os-fly .icon-btn');
    t.ok(await t.g(`(() => { const e = document.querySelector('#pop .os-fly'); return !e || e.classList.contains('out'); })()`), 'closed: it slides back behind the panel');
    await cardGone(t);
    t.eq(await t.count('#pop .os-fly'), 0, 'the card away');
    t.ok(await t.g(`(() => { const p = document.querySelector('#pop').getBoundingClientRect(); const tb = document.querySelector('#pop .os-tabs').getBoundingClientRect(); return Math.abs(tb.left - p.right) < 3 && tb.bottom <= p.bottom + 2; })()`), 'tabs along its right edge');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-level .os-pick')].map((b) => [b.textContent, !!b.querySelector('svg')])`), [['Lower', true], ['Floor', true], ['Higher', true]], 'the height as three little drawings');
    // (Beta 3.38) heights stack: Higher and Lower step a level, the middle shows it and puts it back
    await t.clickSel('#pop .os-level [data-v="higher"]'); await t.clickSel('#pop .os-level [data-v="higher"]');
    t.eq([await t.g('Play.ui.os.level'), await t.g(`document.querySelector('#pop .os-level-now').textContent`), await t.g(`document.querySelector('#pop .os-prev .cap').textContent.includes('2 levels up')`)], [2, '+2', true], 'twice Higher: two levels up, shown in the middle and under the picture');
    t.ok(!(await t.g(`document.querySelector('#pop .os-blend').hidden`)), 'Blending stays for a floor off floor level (Beta 3.40: it blends with the floors at its own height)');
    await t.clickSel('#pop .os-level [data-v="higher"]'); await t.clickSel('#pop .os-level [data-v="higher"]');
    t.eq([await t.g('Play.ui.os.level'), await t.g(`document.querySelector('#pop .os-level [data-v="higher"]').disabled`)], [3, true], 'three up is the top');
    await t.clickSel('#pop .os-level [data-v="now"]');
    t.eq([await t.g('Play.ui.os.level'), await t.g(`document.querySelector('#pop .os-level-now').textContent`)], [0, 'Floor'], 'the middle: back to floor level');
    for (let i = 0; i < 4; i++) await t.g(`document.querySelector('#pop .os-level [data-v="lower"]').click()`);
    t.eq([await t.g('Play.ui.os.level'), await t.g(`document.querySelector('#pop .os-level-now').textContent`)], [-3, '\u22123'], 'three down is the bottom');
    await t.clickSel('#pop .os-level [data-v="now"]');
    t.eq(await t.count('#pop .os-edges .os-pick .os-art'), 5, 'the five edges as pictures');
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    t.eq(await t.g('Play.ui.os.floor.rel'), 'Tiles/Tablescape/Slate.webp', 'a floor picked');
    t.ok(await t.g(`document.querySelector('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]').classList.contains('on')`), 'shown as picked');
    await t.clickText('#pop .os-pick', 'Cliff');
    t.eq(await t.g('Play.ui.os.edge'), 'cliff', 'the edge');
    t.ok(await t.count('.os-mats .tile') >= 2, 'what the cliff is made of');
    await t.clickText('#pop .os-pick', 'Fade');
    t.eq(await t.g('Play.ui.os.edge'), 'fade', 'Fade (Beta 3.28)');
    t.ok(await t.g(`document.querySelector('.os-mats').parentNode.hidden`), 'nothing to be made of');
    await t.clickText('#pop .os-pick', 'Walls');
    const sun = M(t).os.sun;
    t.handle('os.set', { mapId: own, sun: (sun + 90) % 360 });
    await t.settle();
    t.eq(M(t).os.sun, (sun + 90) % 360, 'the light from elsewhere');
    // (Beta 3.35) the light on a dial; how long the shadows are, and shadows all around (caves), on sliders
    t.eq(await t.count('#pop .os-sun-dial'), 0, 'the map\'s settings out of the way at first (Beta 3.37)');
    await t.clickSel('#pop .os-mapbtn');
    await cardOut(t);
    t.ok(await t.g(`!!document.querySelector('#pop .os-fly .os-sun-dial')`), 'behind their button: the light on a dial');
    t.ok(await t.g(`['Shadow length', 'Shadows all around', 'Walls for sight', 'Clear'].every((l) => document.querySelector('#pop .os-fly').textContent.includes(l))`), 'the shadows, walls for sight and Clear with it');
    t.ok(await t.g(`(() => { const f = document.querySelector('#pop .os-fly').getBoundingClientRect(); const tb = document.querySelector('#pop .os-tabs').getBoundingClientRect(); const p = document.querySelector('#pop').getBoundingClientRect(); const docked = Math.abs(f.left - p.right) <= 2 && f.top >= tb.bottom && Math.abs(f.bottom - p.bottom) <= 2; return (docked || f.left >= tb.right) && f.right <= innerWidth && f.top >= 0; })()`), 'in a card lined up with the panel under the tabs (Beta 3.41), or beside the tabs where the panel is short');
    await t.clickSel('#pop .os-fly .icon-btn');
    await cardGone(t);
    t.eq(await t.count('#pop .os-fly'), 0, 'and away again');
    t.eq([M(t).os.shadowLen, M(t).os.shadowAll], [0.35, 0], 'shadows of the length of "short" at first, none all around');
    t.handle('os.set', { mapId: own, shadowLen: 0.75, shadowAll: 0.6 });
    await t.settle();
    t.eq([M(t).os.shadowLen, M(t).os.shadowAll], [0.75, 0.6], 'longer, and all around');
    t.handle('os.set', { mapId: own, shadows: 'off' });
    await t.settle();
    t.eq(M(t).os.shadowLen, 0, 'Off of before: no length');
    t.handle('os.set', { mapId: own, shadowLen: 0.35, shadowAll: 0 });
    await t.settle();
    await baked(t, 150000);
    t.note(`made in ${JSON.stringify(await t.g('Oldschool.stats.last'))}`);
  }, { ms: 180000 });

  area.deep('a shape clicked corner by corner, closed with Enter; a passage drawn on; a door on a wall line', async (t) => {
    await clear(t);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tool(t, 'shape');
    for (const [x, y] of [[15, 3], [21, 3], [21, 8], [15, 8]]) { const p = await t.scr(x * k, y * k); await t.click(p.x, p.y); }
    t.gm().webContents.focus();
    await t.key('Enter');
    await t.until(() => M(t).os.items.length === 1, 4000, 'the shape');
    t.eq(M(t).os.items[0].shape, 'poly', 'a shape');
    t.eq(M(t).os.items[0].pts.length, 4, 'four corners');
    // (Beta 3.28: the Corridor tool is gone; a passage drawn before still draws)
    t.handle('os.add', { mapId: own, item: { kind: 'area', shape: 'path', pts: [[21.5 * k, 5.5 * k], [27.5 * k, 5.5 * k]], r: 0.5 * k, tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' }, edge: 'walls', mat: 'stone_wall', level: 0 } });
    await t.until(() => M(t).os.items.length === 2, 4000, 'the passage');
    await baked(t);
    const n = wallsOf(t).length;
    await tool(t, 'door');
    const d = await t.scr(21 * k, 5.4 * k);
    await t.click(d.x, d.y);
    await t.until(() => M(t).os.doors.length === 1, 4000, 'the door');
    const door = M(t).os.doors[0];
    t.eq([door.x1, door.x2, door.y1, door.y2], [21 * k, 21 * k, 5 * k, 6 * k], 'one square of the wall line', door);
    await baked(t);
    const dw = wallsOf(t).filter((w) => w.door);
    t.eq(dw.length, 1, 'a door where the passage opens into the room: it closes it');
    t.ok(wallsOf(t).length > 0 && n > 0, 'walls');
  }, { ms: 180000 });

  area.deep('walls block sight; a ledge or a cliff does not, rock and walls do; a door can be shut', async (t) => {
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(3, 3, 9, 9), room(12, 3, 18, 9), { kind: 'area', shape: 'path', pts: [[9 * k, 6.5 * k], [12 * k, 6.5 * k]], r: 0.5 * k, tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'walls', mat: 'stone_wall', level: 0 }] });
    t.handle('os.door', { mapId: own, x1: 9 * k, y1: 6 * k, x2: 9 * k, y2: 7 * k, door: 1 });
    await t.settle();
    await baked(t);
    const dw = wallsOf(t).filter((w) => w.door);
    t.eq(dw.length, 1, 'the door is a door in the walls for sight', wallsOf(t).length);
    // (Beta 3.36.1) it snaps: each end of the door meets another wall exactly, and the walls run straight along the
    // middle of the wall band (0.225 squares out), their corners square
    const meets = (x, y) => wallsOf(t).some((w) => w !== dw[0] && Math.min(Math.hypot(w.x1 - x, w.y1 - y), Math.hypot(w.x2 - x, w.y2 - y)) < 0.001 * k);
    t.ok(meets(dw[0].x1, dw[0].y1) && meets(dw[0].x2, dw[0].y2), 'the door joins the walls at both ends', JSON.stringify([dw[0].x1, dw[0].y1, dw[0].x2, dw[0].y2]));
    t.ok(wallsOf(t).some((w) => Math.abs(w.y1 - 2.775 * k) < 0.001 * k && Math.abs(w.y2 - 2.775 * k) < 0.001 * k && Math.abs(w.x1 - w.x2) > 5 * k), 'a room\'s wall straight along the middle of its band');
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'party', x: 6 * k, y: 6 * k, r: 20 * k });
    t.handle('vision.update', { mapId: own, on: true });
    t.handle('wall.door', { mapId: own, id: dw[0].id, open: false });
    await t.send(own);
    await t.settle(); await t.sleep(800);
    const sees = (x, y) => t.t(`window.__table.sees(${x * k}, ${y * k})`);
    t.eq(await sees(5, 5), true, 'inside the room');
    t.eq(await sees(15, 6), false, 'not the other room through the walls and the shut door');
    // (Beta 3.25) the door's leaf is drawn live: across the doorway, and it swings open
    const leaf = () => t.t(`(() => { const g = document.querySelector('.sv-osdoors .osdoor > g'); return g ? g.getAttribute('transform') : null; })()`);
    t.ok(/rotate\(0 /.test(await leaf() || ''), 'the leaf across the doorway on the TV', await leaf());
    t.handle('wall.door', { mapId: own, id: dw[0].id, open: true });
    await t.settle(); await t.sleep(600);
    t.eq(await sees(15, 6.5), true, 'through the open door and the corridor');
    await t.until(async () => /rotate\(80/.test(await leaf() || ''), 4000, 'the leaf swung open');
    // a re-made picture keeps the door open
    t.handle('os.set', { mapId: own, sun: 200 });
    await t.settle(); await baked(t);
    t.eq(wallsOf(t).find((w) => w.door).open, true, 'still open after the picture is made again');
    const first = M(t).os.items[0].id;
    t.handle('os.update', { mapId: own, id: first, edge: 'ledge' });
    await t.settle(); await baked(t);
    t.ok(!wallsOf(t).some((w) => w.x1 <= 3.6 * k && w.x2 <= 3.6 * k && w.y1 > 4 * k && w.y1 < 8 * k), 'a ledge has no walls for sight', wallsOf(t).length);
    t.handle('os.update', { mapId: own, id: first, edge: 'cliff', mat: 'cliff' });
    await t.settle(); await baked(t);
    t.ok(!wallsOf(t).some((w) => w.x1 <= 3.6 * k && w.x2 <= 3.6 * k && w.y1 > 4 * k && w.y1 < 8 * k), 'nor has a cliff');
    t.handle('os.update', { mapId: own, id: first, edge: 'rock', mat: 'rock' });
    await t.settle(); await baked(t);
    t.ok(wallsOf(t).some((w) => Math.min(w.x1, w.x2) < 3.6 * k), 'rock has', wallsOf(t).length);
    t.handle('os.set', { mapId: own, sight: false });
    await t.settle(); await baked(t);
    t.eq(wallsOf(t).length, 0, 'walls for sight from the drawing switched off');
    t.handle('os.set', { mapId: own, sight: true });
    await t.settle(); await baked(t);
  }, { ms: 300000 });

  area.deep('the picture: the floor\'s tile inside, dark void outside, the walls raised and lit from one side', async (t) => {
    const m = M(t);
    const px = await t.g(`(async () => {
      const m = Play.state().map; const b = m.bg;
      const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const at = (x, y) => { const u = Math.round((x - b.x) / b.scale); const v = Math.round((y - b.y) / b.scale); return [...g.getImageData(u, v, 1, 1).data]; };
      const k = m.grid.size;
      return { floor: at(16 * k, 5 * k), void: at(b.x + 0.2 * k, b.y + 0.2 * k), wall: at(18.15 * k, 6 * k), size: [img.naturalWidth, img.naturalHeight] };
    })()`);
    const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
    t.ok(px.void[3] < 10, 'outside: see-through (the table\'s dark shows)', px.void);
    t.ok(lum(px.floor) > 45, 'inside: the floor', px.floor);
    t.ok(px.wall.slice(0, 3).reduce((n, v, i) => n + Math.abs(v - px.floor[i]), 0) > 20, 'the wall differs from the floor', [px.wall, px.floor]);
    t.ok(px.size[0] <= 4096 * 2 && m.bg.scale > 0, 'a sensible size', px.size);
  });

  area.deep('a campaign handed on: the drawing goes along, its tiles by name (no files), its picture is made again', async (t) => {
    const T = require('../../transfer');
    const P = T.plan(t.store.cur.dir, { kind: 'full' });
    const mine = P.json.find((j) => j.name === `campaign/maps/${own}.json`);
    const m = JSON.parse(mine.data);
    t.ok(m.os && m.os.items.length >= 1, 'the drawing', m.os && m.os.items.length);
    t.eq(m.bg, null, 'no picture (made again when opened)');
    t.ok(!P.lib.some((x) => /Tablescape|drawn|Old cobblestone|Slate/i.test(x.rel)), 'no tile files of the app, no drawn pictures', P.lib.map((x) => x.rel));
    t.ok(!P.extra.some((x) => x.rel.startsWith('drawn/')), 'the drawn folder stays home');
  });

  area.deep('Draw → More opens Library → Tiles; a tile of your own asks once how many squares it spans', async (t) => {
    const file = path.join(L.root, 'Tiles', 'Test pebbles.webp');
    fs.copyFileSync(L.resolveRef({ rel: 'Tiles/Tablescape/Ice.webp' }), file);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tool(t, 'room');
    await t.clickSel('.os-tile-list'); // (Beta 3.35: Tiles → List … → Library …)
    await t.until(() => t.rect('.os-more'), 4000, 'Library …');
    await t.g(`document.querySelector('.os-more').scrollIntoView({ block: 'center' })`);
    await t.clickSel('.os-more');
    await t.until(() => t.g(`!!(Play.ui.drawer && Play.ui.drawer.purpose === 'tile')`), 4000, 'the library, to pick a tile');
    const sel = `.lt[data-path=${JSON.stringify(file)}]`;
    await t.until(() => t.rect(sel), 6000, 'the tile of your own in it');
    t.ok(await t.g(`[...document.querySelectorAll('#drawer *')].some((e) => e.children.length === 0 && e.textContent.trim() === 'Tablescape')`), 'the tiles of the app in their folder');
    await t.sleep(600);
    await t.shot(t.gm(), 'oldschool-library');
    await t.g(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
    await t.clickSel(sel);
    await t.until(() => t.rect('.os-squares canvas'), 5000, 'the question how many squares');
    await t.sleep(400);
    await t.shot(t.gm(), 'oldschool-squares');
    await t.clickText('.os-squares .btn', 'Use it');
    await t.until(() => t.lib('tiles').find((x) => x.path === file).squares > 0, 4000, 'its squares kept');
    t.eq(await t.g('Play.ui.os.floor.rel'), 'Tiles/Test pebbles.webp', 'the floor to draw with now');
    t.eq(await t.popTitle(), 'Draw', 'back in Draw');
    t.ok(await t.g(`!!document.querySelector('.os-floors .tile[data-v="Tiles/Test pebbles.webp"]')`), 'among the last used');
    if (await t.g(`!!document.querySelector('.fp[data-id="ostiles"]')`)) await t.clickSel('.fp[data-id="ostiles"] .fp-close');
  }, { ms: 120000 });

  area.deep('sharp tiles: as many dots a square as the TV shows; something drawn makes only the tiles near it again', async (t) => {
    await t.g('Oldschool.noSharp = false');
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(2, 2, 10, 9), room(40, 4, 46, 10)] });
    await t.settle();
    const m = await baked(t, 120000);
    const sh = m.bg.sharp;
    t.ok(sh && sh.P >= 100 && sh.ts >= 4, 'sharp tiles on top of the picture', sh && { P: sh.P, ts: sh.ts });
    t.ok(sh.P > 1 / (m.bg.scale / k) * 1.1, 'sharper than the picture', { P: sh.P, base: k / m.bg.scale });
    t.ok(sh.tiles.length >= 2 && sh.tiles.every((x) => fs.existsSync(x.path)), 'a file each', sh.tiles.length);
    t.ok(!sh.tiles.some((x) => x.c > 0 && x.c * sh.ts > 12 && (x.c + 1) * sh.ts < 38), 'none where nothing shows', sh.tiles.map((x) => [x.c, x.r]));
    const before = new Map(sh.tiles.map((x) => [`${x.c},${x.r}`, x.h]));
    t.handle('os.add', { mapId: own, items: [{ kind: 'pillar', pts: [[6 * k, 5.5 * k]], r: 0.4 * k, mat: 'stone_wall' }] });
    await t.settle();
    const m2 = await baked(t, 120000);
    const after = new Map(m2.bg.sharp.tiles.map((x) => [`${x.c},${x.r}`, x.h]));
    const far = [...after].filter(([pos]) => Number(pos.split(',')[0]) * sh.ts >= 30);
    const near = [...after].filter(([pos]) => Number(pos.split(',')[0]) * sh.ts < 16);
    t.ok(far.length && far.every(([pos, h]) => before.get(pos) === h), 'the far room\'s tiles are kept', far);
    t.ok(near.length && near.some(([pos, h]) => before.get(pos) !== h), 'the tiles under the pillar are made again', near);
    t.ok(m2.bg.sharp.tiles.every((x) => fs.existsSync(x.path)), 'their files there');
    // on the TV: the tiles over the picture, all shown
    await t.send(own);
    await t.until(async () => (await t.t(`(() => { const im = [...document.querySelectorAll('.sv-sharp img')]; return im.length >= ${m2.bg.sharp.tiles.length} && im.every((i) => i.complete && i.naturalWidth > 0 && i.style.visibility !== 'hidden'); })()`)), 30000, 'the sharp tiles on the TV');
    t.eq(await t.t(`document.querySelector('.sv-sharp img').naturalWidth`), m2.bg.sharp.ts * m2.bg.sharp.P, 'a tile is ts squares of P dots');
    await t.sleep(600);
    await t.shot(t.tv(), 'oldschool-sharp-tv');
    t.note(`made in ${JSON.stringify(await t.g('Oldschool.stats.last'))}`);
    await t.g('Oldschool.noSharp = true');
  }, { ms: 300000 });

  area.deep('Beta 3.29: Ground is gone (a pool from before and its effect leave when the map is read); stairs are of the picked floor', async (t) => {
    await clear(t);
    const MS = require('../../mapstate');
    const old = MS.normalize({ ...MS.emptyMap('x'), os: { items: [room(2, 2, 8, 8), { kind: 'ground', shape: 'rect', pts: [[3 * k, 3 * k], [5 * k, 5 * k]], preset: 'lava' }] }, fx: [{ id: 'oggone', kind: 'region', preset: 'lava', strokes: [], os: 'gone' }, { id: 'f1', kind: 'fire' }] });
    t.eq(old.os.items.map((x) => x.kind), ['area'], 'the pool is gone');
    t.eq(old.fx.map((f) => f.id), ['f1'], 'its effect too, the others stay');
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    t.ok(!(await t.g(`!!document.querySelector('.os-tools .tile[data-v="ground"]')`)), 'no Ground tool');
    await tool(t, 'stairs');
    t.ok(!(await t.g(`document.querySelector('#pop').textContent.includes('Steps of')`)), 'no "Steps of": they take the floor');
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    t.handle('os.add', { mapId: own, items: [room(14, 2, 24, 9)] });
    const a = await t.scr(16 * k, 3 * k); const b = await t.scr(18 * k, 7 * k);
    await t.drag(a, b, 10);
    await t.until(() => M(t).os.items.some((x) => x.kind === 'stairs'), 5000, 'the stairs');
    const st = M(t).os.items.find((x) => x.kind === 'stairs');
    t.eq(st.tile && st.tile.rel, 'Tiles/Tablescape/Slate.webp', 'of the picked floor', st);
    await baked(t);
    await t.shot(t.gm(), 'oldschool-stairs');
    await tool(t, 'room');
  }, { ms: 300000 });

  area.deep('Beta 3.39: a step between floors of different height shows on every side, also the one the sun shines on', async (t) => {
    await clear(t);
    // a platform one up on a floor of the same tile; the sun stands top left, so its shadow falls to the bottom right only
    const sunWas = M(t).os.sun; // (a check before this one turned the light)
    t.handle('os.set', { mapId: own, sun: 135 });
    t.handle('os.add', { mapId: own, items: [room(12, 2, 28, 14, { edge: 'ledge', mixW: 0 }), room(17, 5, 23, 11, { edge: 'ledge', level: 1, mixW: 0 })] });
    await t.settle();
    await baked(t);
    // (how light a strip of the picture is, in squares)
    const lum = (x0, y0, x1, y1) => t.g(`(async () => { const b = Play.state().map.bg; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); const X = (v) => Math.round((v * ${k} - b.x) / b.scale); const Y = (v) => Math.round((v * ${k} - b.y) / b.scale); const d = g.getImageData(X(${x0}), Y(${y0}), Math.max(1, X(${x1}) - X(${x0})), Math.max(1, Y(${y1}) - Y(${y0}))).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; return sum / (d.length / 4); })()`);
    const far = await lum(17.5, 3.4, 22.5, 3.9);
    const footTop = await lum(17.5, 4.86, 22.5, 4.97); const footLeft = await lum(16.86, 5.5, 16.97, 10.5);
    t.note(`the floor: ${Math.round(far)} away from the platform, ${Math.round(footTop)} at its foot on the sun's side (top), ${Math.round(footLeft)} (left)`);
    t.ok(footTop < far * 0.85 && footLeft < far * 0.85, 'the floor is darker at the platform\'s foot on the sides the sun shines on (no shadow falls there)', [far, footTop, footLeft]);
    const edgeTop = await lum(17.5, 5.02, 22.5, 5.1); const edgeBottom = await lum(17.5, 10.9, 22.5, 10.98); const mid = await lum(19, 7, 21, 9);
    t.note(`the platform: ${Math.round(mid)} in its middle, ${Math.round(edgeTop)} along its top edge, ${Math.round(edgeBottom)} along its bottom edge`);
    t.ok(edgeTop > edgeBottom * 1.15, 'its edge toward the sun is lighter than the one away from it (bevelled)', [edgeTop, edgeBottom]);
    t.ok(mid > far * 1.01, 'and it is a touch lighter than the floor it stands on', [mid, far]);
    t.handle('os.set', { mapId: own, sun: sunWas });
    await t.settle();
  }, { ms: 300000 });

  area.deep('Beta 3.40: stairs climb every level between the floors they join; floors at one height blend, a step stays between heights', async (t) => {
    await clear(t);
    const T = (n) => ({ rel: `Tiles/Tablescape/${n}.webp` });
    const sunWas = M(t).os.sun;
    t.handle('os.set', { mapId: own, sun: 135 });
    const flat = { edge: 'ledge', mixW: 0 }; const MIX = { mixW: 1.5, mixU: 0.5, mixT: 0.5 };
    const stairs = (x0, y0, x1, y1) => ({ kind: 'stairs', pts: [[x0 * k, y0 * k], [x1 * k, y1 * k]], dir: 2, tile: T('Slate') });
    t.handle('os.add', { mapId: own, items: [
      room(10, 1, 32, 16, { ...flat, tile: T('Meadow'), edge: 'fade' }),
      // a platform one up and one three up, each with stairs two squares long
      room(11.5, 2.5, 15, 6.5, { ...flat, tile: T('Slate'), level: 1 }), stairs(15, 3.5, 17, 5.5),
      room(19.5, 2.5, 23, 6.5, { ...flat, tile: T('Slate'), level: 3 }), stairs(23, 3.5, 25, 5.5),
      // grass over cobbles, both one up; and the same with the grass another level up
      room(11.5, 9, 20, 14, { ...flat, level: 1 }), room(16, 9, 20, 14, { ...flat, level: 1, tile: T('Mossy court'), ...MIX }),
      room(22, 9, 30.5, 14, { ...flat, level: 1 }), room(26.5, 9, 30.5, 14, { ...flat, level: 2, tile: T('Mossy court'), ...MIX }),
    ] });
    await t.settle();
    await baked(t);
    // (the picture, read in squares: how many risers a strip crosses from left to right; how green a patch is)
    const pic = (what, x0, y0, x1, y1) => t.g(`(async () => { const b = Play.state().map.bg; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const X = (v) => Math.round((v * ${k} - b.x) / b.scale); const Y = (v) => Math.round((v * ${k} - b.y) / b.scale); const w = X(${x1}) - X(${x0}); const h = Y(${y1}) - Y(${y0}); const d = g.getImageData(X(${x0}), Y(${y0}), w, h).data;
      if (${JSON.stringify(what)} === 'green') { let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i + 1] - d[i]; return sum / (d.length / 4); }
      const col = []; for (let x = 0; x < w; x++) { let sum = 0; for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; } col.push(sum / h); }
      let n = 0; for (let i = 0; i + 3 < col.length;) { if (col[i + 3] - col[i] < -25) { n++; i += 5; } else i++; } return n; })()`);
    const one = await pic('risers', 14.9, 3.8, 17.1, 5.2); const three = await pic('risers', 22.9, 3.8, 25.1, 5.2);
    t.note(`steps in stairs two squares long: ${one} to one level up, ${three} to three up`);
    t.eq(one, 4, 'one level up: four steps, as before');
    t.ok(three >= 8, 'three levels up: more steps, they climb all three', three);
    const near = await pic('green', 15.1, 9.5, 15.9, 13.5); const inside = await pic('green', 12, 9.5, 14, 13.5);
    const near2 = await pic('green', 25.6, 9.5, 26.3, 13.5); const inside2 = await pic('green', 22.5, 9.5, 24.5, 13.5);
    t.note(`how green the cobbles are next to the grass: ${Math.round(near - inside)} more than further in at one height, ${Math.round(near2 - inside2)} with a step between`);
    t.ok(near - inside > 8, 'two floors at the same height (one up) blend', [near, inside]);
    t.ok(Math.abs(near2 - inside2) < 6, 'a floor another level up does not: a step stays', [near2, inside2]);
    t.handle('os.set', { mapId: own, sun: sunWas });
    await t.settle();
  }, { ms: 300000 });

  area.deep('Beta 3.40: a door or a window on any wall: a slanted side, a round room, a slanted wall line; on the grid as before', async (t) => {
    await clear(t);
    const P = (pts) => pts.map(([x, y]) => [x * k, y * k]);
    t.handle('os.add', { mapId: own, items: [
      { ...room(0, 0, 1, 1, { mixW: 0 }), shape: 'poly', pts: P([[14, 2], [17, 2], [19, 4], [19, 7], [17, 9], [14, 9], [12, 7], [12, 4]]) },
      { ...room(0, 0, 1, 1, { mixW: 0 }), shape: 'round', pts: P([[21, 3], [26, 8]]) },
      { kind: 'line', pts: P([[13.5, 5], [17.5, 8]]), w: 0.5 * k, h: 1, mat: 'stone_wall' },
    ] });
    await t.settle();
    await baked(t);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    const doors = () => M(t).os.doors; const sq = (d) => [d.x1, d.y1, d.x2, d.y2].map((v) => v / k);
    const near = (a, b, tol = 0.02) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const click = async (x, y) => { const p = await t.scr(x * k, y * k); await t.click(p.x, p.y); await t.settle(); };
    await tool(t, 'door');
    // the slanted side from (17, 2) to (19, 4): a click a little off it gives a door of one square in its middle
    await click(18.1, 2.9);
    await t.until(() => doors().length === 1, 4000, 'the door on the slanted side');
    const h = Math.SQRT1_2 / 2;
    t.ok(near(sq(doors()[0]), [18 - h, 3 - h, 18 + h, 3 + h]), 'one square long, along the slanted side, in its middle', sq(doors()[0]));
    // the straight side beside it is on a grid line: as before
    await click(19, 5.4);
    await t.until(() => doors().length === 2, 4000, 'the door on the straight side');
    t.eq(sq(doors()[1]), [19, 5, 19, 6], 'a wall on a grid line: the square of the line, as before');
    // a drag along the slanted wall line: two squares of it
    const a = await t.scr(14.78 * k, 5.96 * k); const b = await t.scr(16.22 * k, 7.04 * k);
    await t.drag(a, b, 8);
    await t.until(() => doors().length === 3, 4000, 'the door in the wall line');
    t.ok(near(sq(doors()[2]), [14.7, 5.9, 16.3, 7.1]), 'two squares of the slanted wall line', sq(doors()[2]));
    // a window in the round room (middle 23.5 5.5, two and a half squares to its wall)
    await tool(t, 'window');
    await click(23.5 + 2.6 * Math.SQRT1_2, 5.5 + 2.6 * Math.SQRT1_2);
    await t.until(() => doors().length === 4, 4000, 'the window in the round room');
    const w = doors()[3]; const far = (x, y) => Math.hypot(x / k - 23.5, y / k - 5.5);
    t.eq(w.kind, 'window', 'a window');
    t.ok(Math.abs(far(w.x1, w.y1) - 2.5) < 0.02 && Math.abs(far(w.x2, w.y2) - 2.5) < 0.02, 'both its ends on the round wall', [far(w.x1, w.y1), far(w.x2, w.y2)]);
    t.ok(Math.abs(Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / k - 1) < 0.02, 'one square long', sq(w));
    await baked(t);
    const dw = wallsOf(t).filter((x) => x.door);
    t.eq(dw.length, 3, 'the three doors are doors in the walls for sight (the window is none)');
    t.ok(dw.some((x) => Math.abs(Math.abs(x.x2 - x.x1) - Math.abs(x.y2 - x.y1)) < 0.05 * k && Math.abs(x.x2 - x.x1) > 0.5 * k), 'one of them slanted, as its wall', dw.map((x) => sq(x)));
    // a click on a door on a slanted wall takes it away
    await tool(t, 'door');
    await click(18.1, 2.9);
    await t.until(() => doors().length === 3, 4000, 'the door on the slanted side gone');
    t.ok(!doors().some((d) => near(sq(d), [18 - h, 3 - h, 18 + h, 3 + h])), 'a click on it again: it goes');
    await baked(t);
    await tool(t, 'room');
  }, { ms: 300000 });

  area.deep('floors mix by opacity: a soft line, uneven, tiled along the grid (insides and joints); off', async (t) => {
    await clear(t);
    const T = (n) => ({ rel: `Tiles/Tablescape/${n}.webp` });
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tool(t, 'room');
    t.eq(await t.g('[Play.ui.os.mixW, Play.ui.os.mixU, Play.ui.os.mixT]'), [1.5, 0.5, 0.5], 'width 1½, uneven and tiled at a half at first');
    t.eq(await t.g(`(document.querySelector('#pop .os-looks .os-pick.on') || {}).textContent`), 'Natural', 'which is the look Natural');
    t.handle('os.add', { mapId: own, items: [room(14, 2, 26, 9, { tile: T('Desert sand') }), room(14, 2, 20, 9, { tile: T('Mossy court') })] });
    await t.settle();
    const items = M(t).os.items;
    t.ok(items.every((x) => x.mixW === 1.5 && x.mixU === 0.5 && x.mixT === 0.5), 'a floor drawn mixes as the panel says', items.map((x) => [x.mixW, x.mixU, x.mixT]));
    await baked(t);
    // across the edge between grass and sand: squares of both, not a straight line
    const row = await t.g(`(async () => { const b = Play.state().map.bg; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const out = []; for (let y = 2.5; y < 9; y += 1) { const r = []; for (let x = 17.5; x < 23; x += 1) { const d = g.getImageData(Math.round((x * ${k} - b.x) / b.scale), Math.round((y * ${k} - b.y) / b.scale), 1, 1).data; r.push(d[1] > d[0] ? 'g' : 's'); } out.push(r.join('')); } return out; })()`);
    t.note(`squares across the edge: ${row.join(' ')}`);
    t.ok(new Set(row).size > 1, 'the change is not one straight line', row);
    const first = M(t).os.items[1].id;
    t.handle('os.update', { mapId: own, id: first, mixW: 0 });
    await t.settle();
    t.eq(M(t).os.items[1].mixW, 0, 'off for one floor (width 0)');
    await baked(t);
    // (Beta 3.38) the Tile tool blends too: a whole floor takes the tile and the look; a painted tile its own soft width
    await tool(t, 'floor');
    await t.clickText('#pop .seg-btn', 'Whole floor');
    await t.clickText('#pop .os-looks .os-pick', 'Soft');
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    const at = await t.scr(17 * k, 5 * k); await t.click(at.x, at.y);
    await t.until(() => M(t).os.items[1].tile.rel === 'Tiles/Tablescape/Slate.webp', 5000, 'the floor clicked takes the tile');
    const f1 = M(t).os.items[1];
    t.eq([f1.mixW, f1.mixU, f1.mixT, f1.level, f1.edge], [1.5, 0, 0, 0, 'walls'], 'and the look Soft with it; its height and edge stay', f1);
    await t.clickText('#pop .seg-btn', 'Brush');
    await t.clickText('#pop .os-looks .os-pick', 'Sharp');
    const p0 = await t.scr(22 * k, 4 * k); const p1 = await t.scr(24 * k, 6 * k);
    await t.drag(p0, p1, 8);
    await t.until(() => M(t).os.items.some((x) => x.kind === 'paint'), 5000, 'a tile painted on');
    t.eq(M(t).os.items.find((x) => x.kind === 'paint').mixW, 0, 'with a sharp edge, as the look says');
    await baked(t);
    await t.clickText('#pop .os-looks .os-pick', 'Natural');
    await tool(t, 'room');
  }, { ms: 300000 });

  area.deep('the TV inks what is drawn: a pen traces it, its tile fills in, then the picture takes over; a secret door never shows', async (t) => {
    await clear(t);
    await t.send(own);
    await t.sleep(400);
    t.handle('os.add', { mapId: own, item: room(4, 4, 9, 8) });
    await t.settle();
    await t.until(() => t.t(`document.querySelectorAll('.sv-osink .ink-item').length > 0`), 3000, 'the ink on the TV');
    t.ok(await t.t(`!!document.querySelector('.sv-osink .ink-pen') && !!document.querySelector('.sv-osink .ink-fill')`), 'a pen and its fill');
    await t.sleep(250);
    await t.shot(t.tv(), 'oldschool-ink-tv');
    t.ok(await t.t(`(() => { const s = document.querySelector('.sv-osink'); const f = document.querySelector('.sv-fog, .sv-fogc'); return !f || !!(s.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'under the fog');
    t.eq(await t.g(`document.querySelectorAll('.sv-osink').length`), 0, 'not on your screen (you have the preview)');
    await baked(t, 90000);
    await t.until(() => t.t(`document.querySelectorAll('.sv-osink .ink-item').length === 0`), 6000, 'the picture takes over');
    t.handle('os.add', { mapId: own, item: { kind: 'area', shape: 'path', pts: [[9 * k, 6.5 * k], [14 * k, 6.5 * k]], r: 0.5 * k, tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'walls', mat: 'stone_wall', level: 0 } });
    await t.settle();
    await t.until(() => t.t(`!!document.querySelector('.sv-osink .ink-paint')`), 3000, 'a corridor painted along');
    await baked(t, 90000);
    await t.until(() => t.t(`document.querySelectorAll('.sv-osink .ink-item').length === 0`), 6000, 'gone again');
    t.handle('os.door', { mapId: own, x1: 4 * k, y1: 5 * k, x2: 4 * k, y2: 6 * k, door: 2 });
    await t.settle(); await t.sleep(300);
    t.eq(await t.t(`document.querySelectorAll('.sv-osink .ink-item').length`), 0, 'no ink for a secret door');
    await baked(t, 90000);
  }, { ms: 300000 });

  area.deep('a picture for the morning: the GM screen and the TV', async (t) => {
    await clear(t);
    const T = (n) => ({ rel: `Tiles/Tablescape/${n}.webp` });
    const sq = (pts) => pts.map(([x, y]) => [x * k, y * k]);
    t.handle('os.set', { mapId: own, sun: 135 });
    t.handle('os.add', { mapId: own, items: [
      room(2, 2, 10, 9), // the hall
      { kind: 'area', shape: 'rect', pts: sq([[4, 4], [8, 7]]), tile: T('Wood parquet'), edge: 'ledge', mat: 'stone_wall', level: 1 }, // a dais
      ...[[3.5, 3.5], [8.5, 3.5], [3.5, 7.5], [8.5, 7.5]].map((p, i) => ({ kind: 'pillar', pts: sq([p]), r: 0.3 * k, round: i % 2 === 1, mat: 'stone_wall' })),
      { kind: 'area', shape: 'path', pts: sq([[10, 5.5], [15, 5.5], [15, 10]]), r: 1 * k, tile: T('Dark cobblestone'), edge: 'walls', mat: 'dark_stone_wall', level: 0 }, // a corridor
      { kind: 'stairs', pts: sq([[14, 7], [16, 9]]), dir: 1, mat: 'stone_wall' },
      { kind: 'area', shape: 'round', pts: sq([[11, 10], [19, 16]]), tile: T('Mossy court'), edge: 'rock', mat: 'cliff', level: 0 }, // a mossy cave
      { kind: 'area', shape: 'brush', pts: sq([[19, 13], [22, 12], [25, 9], [28, 7], [31, 6]]), r: 1.3 * k, tile: T('Slate'), edge: 'cliff', mat: 'rock', level: 0 }, // a ledge path above the deep
      { kind: 'area', shape: 'rect', pts: sq([[24, 12], [31, 18]]), tile: T('Desert sand'), edge: 'walls', mat: 'hedge', level: 0 }, // a hedged garden
      { kind: 'line', pts: sq([[27.5, 13], [27.5, 16]]), w: 0.5 * k, h: 1, mat: 'hedge' },
    ] });
    t.handle('os.door', { mapId: own, x1: 5 * k, y1: 2 * k, x2: 6 * k, y2: 2 * k, door: 1, kind: 'window' });
    t.handle('os.door', { mapId: own, x1: 10 * k, y1: 5 * k, x2: 10 * k, y2: 6 * k, door: 1 });
    await t.settle();
    await baked(t, 90000);
    t.handle('vision.update', { mapId: own, on: false });
    t.handle('fog.enabled', { mapId: own, enabled: false });
    await t.send(own);
    await t.g(`Play.setTool('select'), Play.closePop()`);
    await t.settle(); await t.sleep(1500);
    await t.shot(t.gm(), 'oldschool-gm');
    await t.shot(t.tv(), 'oldschool-tv');
    t.ok(true, 'pictures taken');
  }, { ms: 300000 });
};
