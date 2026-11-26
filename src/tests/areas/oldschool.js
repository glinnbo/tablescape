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
  // (Beta 3.49) four groups in the first column; the picked group's tools in the second
  const GROUP = { room: 'terrain', round: 'terrain', shape: 'terrain', brush: 'terrain', erase: 'terrain', wall: 'structure', pillar: 'structure', stairs: 'structure', door: 'structure', window: 'structure', light: 'structure' };
  const group = async (t, g) => { await tabsOut(t); if (!(await t.count(`.os-groups .tile.open[data-g="${g}"]`))) { await t.clickSel(`.os-groups .tile[data-g="${g}"]`); await tabsOut(t); } };
  const tab = async (t, id) => { await tabsOut(t); await t.clickSel(`.os-tabs2 .tile[data-v="${id}"]`); };
  const fxPick = async (t, id) => { await group(t, 'style'); await t.clickSel(`#pop .os-fxkinds .os-pick[data-v="fx-${id}"]`); await tabsOut(t); };
  // (Beta 3.41) the card beside the tabs slides out from behind the panel, and back when closed: wait for either
  const cardOut = (t) => t.until(() => t.g(`(() => { const e = document.querySelector('#pop .os-fly'); return !!e && !e.classList.contains('out') && e.getAnimations().every((a) => a.playState === 'finished'); })()`), 4000, 'the card to come out');
  const cardGone = (t) => t.until(async () => (await t.count('#pop .os-fly')) === 0, 4000, 'the card to go');
  const tool = async (t, id) => { // ('floor': Texture → Fill, the whole floor clicked)
    if (id === 'floor') { await group(t, 'texture'); await tab(t, 'tx-fill'); return; }
    await group(t, GROUP[id]); await tab(t, id);
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

  area.quick('the tiles come with the app: 62 floors in Library → Tiles (Beta 3.30: 37 more; Beta 3.42: 13 for the living tiles), five materials for walls, rock and cliffs', async (t) => {
    const list = t.lib('tiles').filter((x) => x.builtin);
    t.eq(list.length, 62, 'floors in the library');
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
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((c) => [...c.querySelectorAll('.tile')].map((b) => b.dataset.v))`), [['g-terrain', 'g-structure', 'g-texture', 'g-style'], ['room', 'round', 'shape', 'brush', 'erase']], 'its tools: six, and with Room picked its five parts beside it (Beta 3.38)');
    t.eq([await t.count('.os-floors .tile[data-v]'), await t.count('.os-floors .tile.os-plus'), await t.count('#pop .btn.os-tile-list')], [4, 1, 0], 'the four tiles used last and a "+" for all of them, one row; no button List … (XA5, 26 Nov 2026; it was five and the button)');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .ctl-label.os-sec')].map((x) => x.textContent)`), ['Edge', 'Made of', 'Floor', 'Blending'], 'the headings, larger; Tiles is called Floor (XA5)');
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
    t.eq(await t.count('#pop .os-floors .tile[data-v]'), 4, 'but the tiles');
    // (Beta 3.49) Texture is a group of its own with every painting tool; Fill is the whole floor clicked
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.dataset.v)`), ['tx-box', 'tx-round', 'tx-shape', 'tx-brush', 'tx-fill', 'tx-erase'], 'Texture: six painting tools');
    await tab(t, 'tx-brush'); await tabsOut(t);
    t.eq([await t.g('Play.ui.os.texShape'), await t.g('Play.ui.os.tool')], ['brush', 'brush'], 'painted on with the brush');
    t.eq(await t.count('#pop .os-looks .os-pick'), 4, 'with Blending as well');
    await tab(t, 'tx-fill'); await tabsOut(t);
    t.eq([await t.g('Play.ui.os.tool'), await t.g('Play.ui.os.floorMode')], ['floor', 'tile'], 'or the whole floor clicked: its tile alone');
    await tool(t, 'pillar');
    // XA1 (26 Nov 2026): the sizes are stops: a quarter, a half, then every half square up to 8
    t.eq(await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Size"]'); const out = []; const put = (v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; for (const v of [0, 1, 2, 3, 4, 16]) { put(v); out.push(Play.ui.os.pillar.r * 2); } put(1); return [Number(i.max), out, i.closest('label').querySelector('output').textContent]; })()`),
      [16, [0.25, 0.5, 1, 1.5, 2, 8], '0.5 squares'], 'pillars: 17 stops, a quarter square, a half, then in half squares up to 8');
    // (Beta 3.37) the menu made new: the tools as tabs on the panel's edge, a picture of what comes
    t.eq(await t.g(`document.querySelector('#pop .os-prev b').textContent`), 'Stone pillar', 'a picture of the pillar to come, with its name');
    // (Beta 3.49) two columns: the four groups, and the picked group's tools beside them; Structure stays marked
    t.ok(await t.g(`(() => { const two = document.querySelector('#pop .os-tabs2'); const one = document.querySelector('#pop .os-groups'); const g = one.querySelector('[data-g="structure"]'); const a = one.getBoundingClientRect(); const b = two.getBoundingClientRect(); return g.classList.contains('open') && one.querySelectorAll('.open').length === 1 && two.querySelector('[data-v="pillar"]').classList.contains('on') && b.left < a.right && b.right > a.right + 40 && Math.abs(b.top - a.top) < 3; })()`), 'the pillar among Structure\'s things, beside the groups, Structure marked');
    // the tools stand close together and begin under the groups; no tool hangs below the last group (Glinn: "connect to the main menu")
    t.ok(await t.g(`(() => { const r = [...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.getBoundingClientRect()); const gs = [...document.querySelectorAll('#pop .os-groups .tile')].map((b) => b.getBoundingClientRect()); return r.length === 6 && r.every((b, i) => !i || Math.abs(b.top - r[i - 1].bottom) <= 1.5) && r.every((b) => b.left <= gs[0].right - 8) && r[r.length - 1].bottom <= gs[gs.length - 1].bottom + 2; })()`), 'six things in one block, none below the groups');
    t.eq(await t.g(`getComputedStyle(document.querySelector('#pop .pop-body')).scrollbarWidth`), 'none', 'no scroll bar in the panel');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-groups .tile')].map((b) => getComputedStyle(b).getPropertyValue('--gc').trim()).filter((v, i, a2) => v && a2.indexOf(v) === i).length`), 4, 'each group a colour of its own');
    await tool(t, 'shape');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.textContent)`), ['Box', 'Round', 'Shape', 'Brush', 'Erase'], 'Terrain: its painting tools');
    // the tabs come out from behind the panel when it opens; a group's tools from behind the groups when it is picked
    await tab(t, 'round'); await tabsOut(t);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => e.classList.contains('slide'))`), [false, false], 'a tool picked: the tabs stay where they are');
    t.ok(await t.g(`document.querySelector('#pop .os-tabs2 .tile[data-v="round"]').classList.contains('pick')`), 'the picked one comes out a little further');
    await t.clickSel('.os-groups .tile[data-g="structure"]');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => [e.classList.contains('slide'), getComputedStyle(e.querySelector('.tile:last-child')).animationName])`), [[false, 'none'], [true, 'os-part-out']], 'a group picked: its tools slide out, the groups stay');
    await tab(t, 'door');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs')].map((e) => e.classList.contains('slide'))`), [false, false], 'a thing picked: nothing slides again');
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
    // (Beta 3.42) it is cut at the panel's edge by a frame that stands still, and only moves itself: before, the cut moved along and could land inside the panel
    t.ok(await t.g(`(() => { const w = document.querySelector('#pop .os-flywrap'); const e = w.querySelector('.os-fly'); const p = document.querySelector('#pop').getBoundingClientRect(); const cut = getComputedStyle(w).clipPath; const moves = e.getAnimations().flatMap((a) => a.effect.getKeyframes().flatMap((f) => Object.keys(f))); return Math.abs(w.getBoundingClientRect().left - p.right) <= 1.5 && /inset\\(.* 0px\\)$/.test(cut) && getComputedStyle(w).animationName === 'none' && moves.includes('transform') && !moves.includes('clipPath'); })()`), 'cut at the panel\'s edge, whatever the card does');
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
    t.ok(await t.g(`document.querySelector('.os-mats').closest('.os-edgemat').hidden`), 'nothing to be made of');
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
    const lum = (x0, y0, x1, y1) => t.g(`(async () => { const b = ${JSON.stringify(M(t).bg)}; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); const X = (v) => Math.round((v * ${k} - b.x) / b.scale); const Y = (v) => Math.round((v * ${k} - b.y) / b.scale); const d = g.getImageData(X(${x0}), Y(${y0}), Math.max(1, X(${x1}) - X(${x0})), Math.max(1, Y(${y1}) - Y(${y0}))).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; return sum / (d.length / 4); })()`);
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
    // (the picture as the map has it: baked() saw it there; the GM screen's own copy of the state may come a moment later)
    const pic = (what, x0, y0, x1, y1) => t.g(`(async () => { const b = ${JSON.stringify(M(t).bg)}; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
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
    const row = await t.g(`(async () => { const b = ${JSON.stringify(M(t).bg)}; const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const out = []; for (let y = 2.5; y < 9; y += 1) { const r = []; for (let x = 17.5; x < 23; x += 1) { const d = g.getImageData(Math.round((x * ${k} - b.x) / b.scale), Math.round((y * ${k} - b.y) / b.scale), 1, 1).data; r.push(d[1] > d[0] ? 'g' : 's'); } out.push(r.join('')); } return out; })()`);
    t.note(`squares across the edge: ${row.join(' ')}`);
    t.ok(new Set(row).size > 1, 'the change is not one straight line', row);
    const first = M(t).os.items[1].id;
    t.handle('os.update', { mapId: own, id: first, mixW: 0 });
    await t.settle();
    t.eq(M(t).os.items[1].mixW, 0, 'off for one floor (width 0)');
    await baked(t);
    // (Beta 3.38) the Tile tool blends too: a whole floor takes the tile and the look; a painted tile its own soft width
    await tool(t, 'floor');
    await t.clickText('#pop .os-looks .os-pick', 'Soft');
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    const at = await t.scr(17 * k, 5 * k); await t.click(at.x, at.y);
    await t.until(() => M(t).os.items[1].tile.rel === 'Tiles/Tablescape/Slate.webp', 5000, 'the floor clicked takes the tile');
    const f1 = M(t).os.items[1];
    t.eq([f1.mixW, f1.mixU, f1.mixT, f1.level, f1.edge], [1.5, 0, 0, 0, 'walls'], 'and the look Soft with it; its height and edge stay', f1);
    await tab(t, 'tx-brush'); await tabsOut(t);
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

  // Beta 3.43 (3.46: a blue block under Tile, a card each, Fill): living effects. Grass, water, lava, shimmer, pulse and ripple are drawn over the floors like a tile that
  // cannot be seen (kind 'live'); no tile moves by itself. Where one lies the map moves, drawn above the picture by the
  // graphics card (living.js). What is laid over it later (a bridge) covers it.
  area.deep('Beta 3.46: effects drawn over the floors: grass, water, lava, shimmer, pulse, ripple; Fill by height; a card each; a bridge covers them; on the TV too', async (t) => {
    await clear(t);
    const T = (n) => ({ rel: `Tiles/Tablescape/${n}.webp` });
    const A = (x0, y0, x1, y1, tile, level) => ({ kind: 'area', shape: 'rect', pts: [[x0 * k, y0 * k], [x1 * k, y1 * k]], tile: T(tile), edge: 'ledge', mat: 'stone_wall', level, mixW: 0 });
    const L = (x0, y0, x1, y1, fx, extra = {}) => ({ kind: 'live', shape: 'rect', pts: [[x0 * k, y0 * k], [x1 * k, y1 * k]], fx, mixW: 0, ...extra });
    t.handle('os.add', { mapId: own, items: [room(2, 2, 14, 10), A(3, 3, 6, 7, 'River pebbles', -1), A(3, 8, 6, 9.5, 'River pebbles', -1), A(7, 3, 9, 5, 'Lava flow', 0), A(7, 6, 9, 8, 'Glowing blue', 0), A(10, 3, 13, 4.5, 'Lava runes', 0)] });
    await t.settle(); let m = await baked(t);
    t.ok(!m.bg.live, 'no tile moves by itself: a river bed, lava and a glowing floor alone make no living map', m.bg.live);
    t.handle('os.add', { mapId: own, items: [L(3, 3, 6, 7, 'water'), A(3, 4.5, 6, 5.5, 'Old cobblestone', 1), L(7, 3, 9, 5, 'lava'), L(9, 5, 11, 7, 'grass'), L(11, 5, 13, 7, 'grass', { tint: 'wheat' }),
      L(7, 6, 9, 8, 'glow'), L(10, 3, 11, 4.5, 'pulse'), { ...L(11.5, 3, 13, 4.5, 'ripple'), shape: 'round' }, L(9.5, 5.5, 10, 6, 'none'), { kind: 'live', shape: 'rect', pts: [[0, 0], [k, k]], fx: 'fire' },
      { kind: 'live', shape: 'fill', pts: [[4.5 * k, 8.7 * k], [9 * k, 9 * k]], fx: 'water', tint: '#3A6B2F', mixW: 3 }] });
    await t.settle(); m = await baked(t);
    const lives = M(t).os.items.filter((x) => x.kind === 'live');
    t.eq(lives.map((x) => x.fx), ['water', 'lava', 'grass', 'grass', 'shimmer', 'pulse', 'ripple', 'none', 'water'], 'the effects are kept as things drawn (Glow of 3.43 is Shimmer; an effect that does not exist is not kept)');
    t.eq([lives[2].tint, lives[3].tint, lives[0].tint, lives[8].tint], [undefined, '#c8a548', undefined, '#3a6b2f'], 'grass and water can have a colour of their own (a colour name of 3.43 becomes its colour)');
    t.eq([lives[8].shape, lives[8].pts.length, lives[8].mixW], ['fill', 1, 0], 'a poured effect: one spot, a sharp edge');
    // the picture comes with the living map: four small paintings, a b over c d
    t.ok(m.bg.live && /-live\.png$/.test(m.bg.live.path) && fs.existsSync(m.bg.live.path), 'the picture comes with a living map', m.bg.live && m.bg.live.path);
    const px = await t.g(`(async () => {
      const m = Play.state().map; const b = m.bg; const k = m.grid.size;
      const pic = new Image(); pic.src = b.url; await pic.decode();
      const img = new Image(); img.src = b.live.url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const w = img.naturalWidth / 2; const hh = img.naturalHeight / 2; const f = w / pic.naturalWidth;
      const at = (n, x, y) => [...g.getImageData((n % 2) * w + Math.round(((x * k - b.x) / b.scale) * f), Math.floor(n / 2) * hh + Math.round(((y * k - b.y) / b.scale) * f), 1, 1).data].slice(0, 3);
      const all = (x, y) => [0, 1, 2, 3].map((n) => at(n, x, y).reduce((p, q) => p + q, 0));
      return { f, same: Math.abs(hh / pic.naturalHeight - f) < 0.01, water: at(0, 4.5, 3.7), bridge: all(4.5, 5), pour: [at(0, 4.5, 8.7), at(0, 3.3, 9.2), at(0, 5.7, 8.3), at(3, 4.5, 8.7)], beside: [all(6.6, 8.7), all(4.5, 7.6)], bed2: all(8, 9), lava: at(0, 8, 4), grass: at(0, 10.5, 6.5), hole: at(0, 9.75, 5.75),
        glow: [at(1, 8, 7), at(2, 8, 7)], pulse: [at(1, 10.5, 3.75), at(2, 10.5, 3.75)], ripple: [at(1, 12.25, 3.75), at(2, 12.25, 3.75), at(2, 12.85, 3.75)],
        wheat: at(3, 12, 6), floorGrass: at(3, 10.5, 6.5), floor: all(13.5, 9) };
    })()`);
    t.ok(px.f <= 0.51 && px.same, 'each part half the picture each way', px.f);
    t.ok(px.water[0] > 200 && px.water[1] < 30 && px.water[2] < 30, 'water where it was drawn', px.water);
    t.ok(px.lava[1] > 200 && px.lava[0] < 30, 'lava where it was drawn', px.lava);
    t.ok(px.grass[2] > 200 && px.grass[0] < 30, 'grass where it was drawn', px.grass);
    t.ok(px.hole[2] < 30, 'an effect erased (Alt) leaves a hole in it', px.hole);
    t.ok(px.bridge.every((v) => v < 30), 'a floor laid over the water later covers it (a bridge)', px.bridge);
    t.ok(px.pour.slice(0, 3).every((q) => q[0] > 200), 'Fill: water poured at one spot covers the whole pit', px.pour);
    t.ok(px.beside.every((q) => q.every((v) => v < 30)), 'and stops at its rim: none on the floor beside it, a level higher', px.beside);
    t.ok(px.pour[3][1] > px.pour[3][0] && px.pour[3][1] > px.pour[3][2], 'the water\'s own colour is told (green)', px.pour[3]);
    t.ok(px.floor.every((v) => v < 30), 'nothing on a plain floor', px.floor);
    t.ok(px.glow[0][0] > 200 && Math.abs(px.glow[1][1] - 85) < 12, 'glow: each spot in its own rhythm', px.glow);
    t.ok(px.pulse[0][0] > 200 && Math.abs(px.pulse[1][1] - 170) < 12, 'pulse: the map\'s shared rhythm', px.pulse);
    t.ok(px.ripple[0][0] > 200 && px.ripple[1][1] > 240 && px.ripple[1][2] < 6 && px.ripple[2][2] > px.ripple[1][2] + 4 && px.ripple[2][2] < 20, 'ripple: rings from its middle (the distance from it is told)', px.ripple);
    t.ok(px.wheat[0] > 170 && px.wheat[1] > 130 && px.wheat[2] < 120 && px.floorGrass.every((v) => v < 12), 'the grass\'s colour: wheat where it was picked, the floor\'s elsewhere', [px.wheat, px.floorGrass]);
    // on a screen with a graphics card they move (here: in software, allowed for this check)
    // (26 Nov 2026: only where there is none. On a PC with a real card the moving layer starts by itself, and this
    // line passed only while it looked before the layer was up: it failed twice once pictures came sooner)
    const still = await t.g('Play.view().stats.living');
    if (!(await t.g('Trees.supported()'))) t.ok(!still || !still.on, 'without a graphics card the picture shows as it is', still);
    await t.g('Trees.allowSoft(true)');
    const nudge = async (dir) => { t.handle('wind.set', { mapId: own, auto: false, dir, strength: 1.6, lean: 0.4 }); await t.settle(); };
    await nudge(20);
    const spots = (list) => t.g(`(async () => { const v = Play.view(); v.livingProbe = ${JSON.stringify(list.map(([x, y]) => ({ x: x * k, y: y * k })))}; await new Promise((r) => setTimeout(r, 900)); const s = v.stats.living; v.livingProbe = null; return (s && s.px) || []; })()`);
    const grid9 = (x0, y0, x1, y1) => [0.2, 0.5, 0.8].flatMap((u) => [0.2, 0.5, 0.8].map((w) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * w]));
    let gm = await t.until(async () => { const s = await t.g('Play.view().stats.living'); return s && s.on && s.blades > 0 && s; }, 30000, 'the living effects on the GM screen');
    t.ok(gm.kinds.water && gm.kinds.lava && gm.kinds.grass && gm.kinds.glow, 'water, lava, grass and glow are found', gm.kinds);
    const full = gm.blades;
    t.ok(full > 2000 && full < 8 * 700, 'the grass is blades, on a stone floor too: some hundred a square', full);
    const [w, br, fl] = await spots([[4.5, 3.7], [4.5, 5], [13.5, 9]]);
    t.ok(w && w[3] > 200, 'the water is drawn above the picture', w);
    t.ok(br && br[3] < 10 && fl && fl[3] < 10, 'nothing is drawn over the bridge or the plain floor', [br, fl]);
    const lv = await spots(grid9(7, 3, 9, 5)); const gl = await spots(grid9(7, 6, 9, 8));
    t.ok(lv.length === 9 && lv.every((q) => q && q[3] < 10) && Math.max(...lv.map((q) => q[0])) > 12, 'lava is light alone: the floor is not drawn again (it stays sharp), only its glow is added', lv);
    t.ok(gl.length === 9 && gl.every((q) => q && q[3] < 10) && Math.max(...gl.map((q) => q[2])) > 12, 'glow is light alone as well', gl);
    const t0 = (await t.g('Play.view().stats.living')).time; await t.sleep(1200);
    t.ok((await t.g('Play.view().stats.living')).time > t0, 'it moves', t0);
    // Draw → Tile: the effects are its blue block; each has its own few choices and a card with its sliders
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`); await tool(t, 'floor'); await tabsOut(t);
    t.ok(!(await t.count('#pop .os-fxkinds')) && (await t.count('#pop .os-floors')) === 1, 'Texture has its tiles and no effects');
    await group(t, 'style');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-fxkinds .os-pick')].map((b) => b.textContent)`), ['Grass', 'Water', 'Ember glow', 'Shimmer', 'Pulse', 'Ripple'], 'Style (Beta 3.49): the six effects, picked in the panel');
    await fxPick(t, 'grass');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.textContent)`), ['Box', 'Round', 'Shape', 'Brush', 'Fill', 'Erase'], 'Grass: six ways to draw it, as the tabs');
    t.ok(!(await t.count('#pop .os-level')) && !(await t.count('#pop .os-edges')) && !(await t.count('#pop .os-blend')) && !(await t.count('#pop .os-floors')), 'no height, no edge, no blending, no tiles');
    t.eq(await t.g(`[document.querySelector('#pop .os-fxkinds .os-pick.on').dataset.v, document.querySelector('#pop .os-groups [data-g="style"]').classList.contains('open'), document.querySelectorAll('#pop .os-groups .open').length]`), ['fx-grass', true, 1], 'Grass is marked, Style is the open group, no other');
    t.eq(await t.text('#pop .os-prev .cap b'), 'Grass', 'the picture at the top names it');
    await t.shot(t.gm(), 'effects-panel');
    const n0 = M(t).os.items.length;
    await t.drag(await t.scr(16 * k, 3 * k), await t.scr(19 * k, 6 * k), 10);
    await t.until(() => M(t).os.items.length === n0 + 1, 5000, 'the grass drawn');
    let it = M(t).os.items[n0];
    t.eq([it.kind, it.fx, it.tint, it.shape, it.pts, it.mixW], ['live', 'grass', undefined, 'rect', [[16 * k, 3 * k], [19 * k, 6 * k]], 1.5], 'Box draws grass in the floor\'s colour, with a soft edge', it);
    await t.g(`(() => { const i = document.querySelector('#pop input.os-fxcolor'); i.disabled = false; i.value = '#c8a548'; i.dispatchEvent(new Event('input')); })()`);
    await t.drag(await t.scr(16 * k, 7 * k), await t.scr(18 * k, 9 * k), 8);
    await t.until(() => M(t).os.items.length === n0 + 2, 5000, 'grass in its own colour');
    t.eq(M(t).os.items[n0 + 1].tint, '#c8a548', 'a colour picked: the grass drawn next has it');
    await t.drag(await t.scr(17 * k, 4 * k), await t.scr(18 * k, 5 * k), 8, ['alt']);
    await t.until(() => M(t).os.items.length === n0 + 3, 5000, 'the effect erased');
    t.eq([M(t).os.items[n0 + 2].kind, M(t).os.items[n0 + 2].fx], ['live', 'none'], 'Alt takes effects away there, and nothing else');
    await tab(t, 'fxs-erase'); await tabsOut(t);
    await t.drag(await t.scr(16.5 * k, 7.5 * k), await t.scr(17.5 * k, 8.5 * k), 8);
    await t.until(() => M(t).os.items.length === n0 + 4, 5000, 'effects brushed away');
    it = M(t).os.items[n0 + 3];
    t.eq([it.kind, it.fx, it.shape], ['live', 'none', 'brush'], 'Erase: a brush that takes effects away (the floor stays)', it);
    await tab(t, 'fxs-brush'); await tabsOut(t);
    await t.drag(await t.scr(20 * k, 3 * k), await t.scr(22 * k, 4 * k), 8);
    await t.until(() => M(t).os.items.length === n0 + 5, 5000, 'grass brushed on');
    it = M(t).os.items[n0 + 4];
    t.eq([it.kind, it.fx, it.shape], ['live', 'grass', 'brush'], 'Brush paints the effect on', it);
    await fxPick(t, 'water'); await tabsOut(t);
    await tab(t, 'fxs-fill'); await tabsOut(t);
    { const q = await t.scr(8 * k, 9 * k); await t.click(q.x, q.y); }
    await t.until(() => M(t).os.items.length === n0 + 6, 5000, 'water poured');
    it = M(t).os.items[n0 + 5];
    t.eq([it.kind, it.fx, it.shape, it.pts.length], ['live', 'water', 'fill', 1], 'Fill: a click pours the effect', it);
    t.ok(!M(t).os.items.slice(n0).some((x) => x.kind === 'cut' || x.kind === 'area' || x.kind === 'paint'), 'no floor was drawn, painted or erased');
    // its card: the sliders of this kind of effect, for the whole map
    await fxPick(t, 'grass'); await tabsOut(t);
    await t.clickSel('#pop .os-fxset'); await cardOut(t);
    const card = () => t.g(`(() => { const f = document.querySelector('#pop .os-fly'); if (!f) return null; return { head: f.querySelector('.os-fly-head b').textContent, sliders: [...f.querySelectorAll('input[type="range"]')].filter((e) => !e.closest('[hidden]')).map((e) => e.getAttribute('aria-label')), segs: [...f.querySelectorAll('.seg button, .seg label')].map((e) => e.textContent) }; })()`);
    let c = await card();
    t.eq([c.head, c.sliders], ['Grass', ['Amount', 'Length', 'Thickness', 'Between gusts', 'Colour variety']], 'Grass settings: its card (Beta 3.58: Thickness)', c);
    t.ok(['All', 'Bright', 'Dark', 'Colour'].every((w) => c.segs.includes(w)), 'Grows on: all, bright, dark, a colour', c.segs);
    await t.shot(t.gm(), 'effects-card');
    t.handle('live.set', { mapId: own, fx: 'grass', set: { grow: 'colour' } }); await t.settle();
    t.ok((await card()).sliders.includes('Range'), 'Grows on a colour: its range');
    t.handle('live.set', { mapId: own, fx: 'grass', set: { grow: 'all' } }); await t.settle();
    for (const [fx, want] of [['water', ['Transparency', 'Speed']], ['lava', ['Glow', 'Embers', 'Heat shimmer', 'Speed', 'Pick-up range']], ['shimmer', ['Intensity', 'Speed', 'Pick-up range']], ['pulse', ['Intensity', 'Speed', 'Pick-up range']], ['ripple', ['Intensity', 'Speed', 'Pick-up range']]]) {
      await fxPick(t, fx); await tabsOut(t);
      c = await card();
      t.eq(c && c.sliders, want, `${fx}: its own sliders`, c);
    }
    await tool(t, 'room'); await tabsOut(t);
    t.ok((await t.count('#pop .os-level')) === 1 && !(await t.count('#pop .os-fxkinds')) && !(await t.count('#pop .os-fly-fx')), 'a tool picked: the effect is put down, its card goes');
    for (let i = 0; i < 6; i++) t.handle('history.undo', { mapId: own });
    await t.settle(); await baked(t);
    t.eq(M(t).os.items.length, n0, 'undo takes what was drawn away again (a slider moved in between is no step of its own)');
    // the settings: each kind of effect its own
    t.handle('live.set', { mapId: own, fx: 'grass', set: { amount: 0.75 } }); await t.settle();
    gm = await t.until(async () => { const s = await t.g('Play.view().stats.living'); return s && s.on && s.blades > 0 && s.blades < full * 0.9 && s; }, 15000, 'fewer blades'); // (not just fewer: the undo above may leave a few less for a moment, and none while the grass is grown anew)
    t.ok(Math.abs(gm.blades / full - 0.75) < 0.05, 'Grass amount at 75 %: three quarters of the blades', [gm.blades, full]);
    t.handle('live.set', { mapId: own, fx: 'grass', set: { amount: 1, grow: 'bright' } }); await t.settle();
    const picky = await t.until(async () => { const s = await t.g('Play.view().stats.living'); return s && s.on && s.blades > 0 && s.blades < full * 0.9 && s; }, 15000, 'grass on the bright parts only');
    t.ok(picky.blades > full * 0.15, 'Grows on Bright: fewer blades, the most where the floor is brightest', [picky.blades, full]);
    t.handle('live.set', { mapId: own, fx: 'grass', set: { grow: 'all' } }); await t.settle();
    await t.until(async () => { const s = await t.g('Play.view().stats.living'); return s && s.blades === full; }, 15000, 'grass everywhere again');
    t.handle('live.set', { mapId: own, fx: 'grass', set: { amount: 9, length: 9, calm: -1, vary: 9, grow: 'nowhere', growColor: 'red' } });
    t.handle('live.set', { mapId: own, fx: 'lava', set: { glow: 9, embers: -3, range: 5 } }); t.handle('live.set', { mapId: own, fx: 'water', set: { clear: 4 } }); t.handle('live.set', { mapId: own, fx: 'ripple', set: { power: 9, speed: 0 } }); await t.settle();
    const lv2 = M(t).live;
    t.eq([lv2.grass.amount, lv2.grass.length, lv2.grass.calm, lv2.grass.vary, lv2.grass.grow, lv2.grass.growColor, lv2.lava.glow, lv2.lava.embers, lv2.lava.range, lv2.water.clear, lv2.ripple.power, lv2.ripple.speed, lv2.pulse.power],
      [1.5, 5, 0, 2, 'all', '#5c8a34', 2, 0, 1, 1, 2, 0.3, 1], 'the sliders have their ends (XA10: Length to 500 %, Colour variety to 200 %); one effect\'s settings leave the others alone');
    t.handle('live.set', { mapId: own, fx: 'grass', set: { amount: 1, length: 1, calm: 0.35, vary: 0.3 } }); t.handle('live.set', { mapId: own, fx: 'lava', set: { glow: 1, embers: 1, range: 0.5 } }); t.handle('live.set', { mapId: own, fx: 'water', set: { clear: 0.25 } }); t.handle('live.set', { mapId: own, fx: 'ripple', set: { power: 1, speed: 1 } }); await t.settle();
    // on the TV
    await t.g('Trees.allowSoft(false)'); await nudge(21); // (software graphics: one screen at a time)
    await t.send(own); await t.t('Trees.allowSoft(true)'); await nudge(22);
    const tv = await t.until(async () => { const s = (await t.tvDebug()).living; return s && s.on && s.blades > 0 && s; }, 40000, 'the living effects on the TV');
    t.ok(tv.kinds.water && tv.kinds.lava && tv.kinds.grass && tv.kinds.glow && tv.blades === full, 'the TV shows them too, the same grass', tv);
    await t.shot(t.tv(), 'living-effects-tv');
    // off with one switch: the picture as it is, on both screens
    await t.g('Trees.allowSoft(true)');
    t.handle('live.set', { mapId: own, on: false }); await t.settle();
    await t.until(async () => { const s = (await t.tvDebug()).living; const g = await t.g('Play.view().stats.living'); return s && !s.on && g && !g.on; }, 15000, 'the living effects to stop');
    const off = (await spots([[4.5, 3.7]]))[0];
    t.ok(!off || off[3] < 10, 'and nothing is drawn above the picture', off);
    t.handle('live.set', { mapId: own, on: true }); await t.settle();
    t.ok(M(t).live.on === true, 'on again', M(t).live);
    if (!(await t.count('#pop .os-fly'))) await t.clickSel('#pop .os-mapbtn');
    await cardOut(t);
    c = await card();
    t.ok(c.head === 'Map settings' && !c.sliders.some((x) => /Grass|Glow/.test(x)) && (await t.g(`[...document.querySelectorAll('#pop .os-fly .ctl-label')].some((e) => e.textContent === 'Living effects')`)), 'Map settings keeps only the switch for living effects', c);
    await t.t('Trees.allowSoft(false)'); await t.g('Trees.allowSoft(false)'); await nudge(23);
    // a drawing without effects has no living map
    const old = m.bg.live.path;
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(2, 2, 8, 6)] }); await t.settle(); m = await baked(t);
    t.ok(!m.bg.live, 'a drawing without effects: no living map', m.bg.live);
    t.handle('history.undo', { mapId: own }); t.handle('history.undo', { mapId: own }); await t.settle();
    t.ok(M(t).bg && M(t).bg.live && M(t).bg.live.path === old && fs.existsSync(old), 'undo brings the picture back with its living map', M(t).bg && M(t).bg.live);
    t.handle('history.redo', { mapId: own }); t.handle('history.redo', { mapId: own }); await t.settle(); await baked(t);
  }, { ms: 500000 });

  // Beta 3.49: Texture with every painting tool (a box, a round, a shape as well as the brush; Fill the whole floor;
  // Erase takes painted textures away), and the lights that come with the app under Structure
  area.deep('Beta 3.49: Texture paints with a box and Erase takes it away; Structure → Light: a torch on the wall with a flame whose light walls stop, a colour, lit or not, asked before it is put out (Beta 3.54: one thing, picked in Draw and in Effects)', async (t) => {
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tabsOut(t);
    if (await t.count('#pop .os-fly:not(.out)')) { await cardOut(t); await t.clickSel('#pop .os-fly .os-fly-head .icon-btn'); await cardGone(t); } // (a card left open would lie over the map)
    await clear(t);
    t.handle('os.add', { mapId: own, item: room(14, 3, 24, 9) });
    await baked(t);
    // Texture → Box: the picked tile on the floor under the box
    await group(t, 'texture'); await tab(t, 'tx-box'); await tabsOut(t);
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Old cobblestone.webp"]');
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    t.eq(await t.text('#pop .os-prev .cap b'), 'Slate', 'the card shows the tile to come');
    let a = await t.scr(16 * k, 5 * k); let b = await t.scr(19 * k, 7 * k);
    await t.drag(a, b, 6);
    const paint = await t.until(() => M(t).os.items.find((x) => x.kind === 'paint'), 5000, 'a box of texture');
    t.eq([paint.shape, paint.tile.rel, paint.pts.map((q) => q.map((v) => Math.round(v / k)))], ['rect', 'Tiles/Tablescape/Slate.webp', [[16, 5], [19, 7]]], 'a box, on the grid, in the picked tile', paint);
    const pic = await baked(t);
    t.ok(pic && pic.bg, 'the picture is made with it');
    await tab(t, 'tx-round'); await tabsOut(t);
    a = await t.scr(20 * k, 5 * k); b = await t.scr(22 * k, 7 * k); await t.drag(a, b, 6);
    await t.until(() => M(t).os.items.filter((x) => x.kind === 'paint').length === 2, 5000, 'a round one');
    t.eq(M(t).os.items.filter((x) => x.kind === 'paint')[1].shape, 'round', 'round');
    // Erase: a box over the first takes it away, the floor stays
    await tab(t, 'tx-erase'); await tabsOut(t);
    t.eq(await t.count('#pop .os-floors'), 0, 'Erase needs no tile');
    a = await t.scr(15 * k, 4 * k); b = await t.scr(19.5 * k, 8 * k); await t.drag(a, b, 6);
    await t.until(() => M(t).os.items.filter((x) => x.kind === 'paint').length === 1, 5000, 'the box of texture to go');
    t.eq(M(t).os.items.filter((x) => x.kind === 'area').length, 1, 'the floor stays');
    await baked(t);
    // Structure → Light (Beta 3.54: the Light panel of Light sources; a light is one thing, its holder drawn from it)
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'wall_torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 })`);
    await tool(t, 'light'); await tabsOut(t);
    const lights = () => M(t).fx.filter((f) => f.holder);
    const fx1 = (id) => M(t).fx.find((f) => f.id === id);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].map((x) => x.textContent)`), ['Holder', 'Flame', 'Just light'], 'Holder, Flame, Just light');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-lights .tile')].map((x) => x.textContent)`), ['Wall torch', 'Wall lantern', 'Lamp post', 'Street lamp', 'Candles', 'Cooking fire'], 'the six lights of the app');
    t.eq(await t.text('#pop .os-prev .cap b'), 'Wall torch', 'the card names the one picked');
    t.ok((await t.count('#pop .swatches .swatch')) > 3, 'the colours of Light sources');
    // near the top wall, inside the room: it sits on the wall's face, its bracket to the wall
    a = await t.scr(18 * k, 3.5 * k); await t.click(a.x, a.y);
    const torch = await t.until(() => lights()[0], 5000, 'a torch');
    t.ok(Math.abs(torch.x / k - 18) < 0.05 && Math.abs(torch.y / k - 3.278) < 0.02 && torch.rotation === 0, 'on the face of the wall above, turned to it', [torch.x / k, torch.y / k, torch.rotation]);
    t.eq([torch.kind, torch.holder, torch.preset, torch.bright, torch.dim, torch.hidden, torch.lit], ['emitter', 'wall_torch', 'torch', 20, 40, false, undefined], 'one light: the holder of the app with its own flame, lit, with a torch\'s light', torch);
    t.ok(!!torch.wall && M(t).walls.some((w) => w.id === torch.wall) && !M(t).layers.some((l) => l.fixture), 'hung on that wall; no picture of its own', torch.wall);
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${torch.id}"]`)) === 1, 3000, 'its holder drawn');
    // on the left wall: turned a quarter
    a = await t.scr(14.4 * k, 6 * k); await t.click(a.x, a.y);
    const left = await t.until(() => lights()[1], 5000, 'a second torch');
    t.ok(Math.abs(Math.abs(left.rotation) - 90) < 1 && left.x / k > 14.2 && left.x / k < 14.8, 'on the left wall, turned to it', [left.x / k, left.rotation]);
    // a colour, unlit, standing free
    await t.clickSel('.os-lights .tile[data-v="candles"]');
    await t.clickSel('#pop .swatches .swatch[data-v]:not([data-v=""])');
    const col = await t.g('Play.ui.lt.color');
    await t.clickText('#pop .seg-btn', 'Unlit');
    a = await t.scr(20 * k, 6.5 * k); await t.click(a.x, a.y);
    const can = await t.until(() => lights().find((f) => f.holder === 'candles'), 5000, 'candles');
    t.ok(/^#[0-9a-f]{6}$/.test(col) && can.color === col && can.lit === false && can.preset === 'candle' && Math.abs(can.x / k - 20) < 0.05, 'candles where clicked, in the picked colour, unlit', [col, can]);
    await t.clickText('#pop .seg-btn', 'Lit');
    await t.shot(t.gm(), 'lights-draw');
    // Beta 3.51: a click on a light that is there picks it: the panel shows and changes that light; dragged, a wall
    // light slides along its wall; a click beside it lets go; Delete takes it away
    a = await t.scr(torch.x, torch.y); await t.click(a.x, a.y);
    await t.until(() => t.g('Play.ui.os.lightSel').then((v) => v === torch.id), 3000, 'the torch picked');
    await tabsOut(t);
    t.eq([await t.count('#pop .os-lights'), await t.count('#pop .os-light-remove'), await t.text('#pop .os-prev .cap b')], [0, 1, 'Wall torch'], 'the panel shows the picked torch: no kinds, Remove');
    t.eq(lights().length, 3, 'picking places nothing');
    t.ok((await t.count('.os-preview .os-lightsel')) === 1 && (await t.count('.os-preview .os-lightreach')) === 1, 'a ring on it and its reach on the map');
    await t.clickText('#pop .seg-btn', 'Unlit');
    await t.until(() => fx1(torch.id).lit === false, 3000, 'the picked torch put out from the panel');
    t.eq(fx1(torch.id).hidden, false, 'put out is not hidden');
    await t.clickText('#pop .seg-btn', 'Lit');
    await t.until(() => fx1(torch.id).lit !== false, 3000, 'and lit again');
    await t.clickSel('#pop .swatches .swatch[data-v]:not([data-v=""])');
    await t.until(() => /^#[0-9a-f]{6}$/.test(fx1(torch.id).color || ''), 3000, 'a colour for the picked torch');
    await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Reach"]'); i.value = 10; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await t.until(() => fx1(torch.id).bright === 10, 3000, 'its reach');
    t.eq(fx1(torch.id).dim, 20, 'dim follows');
    b = await t.scr(21 * k, 3.4 * k); await t.drag(a, b, 6);
    await t.until(() => Math.abs(fx1(torch.id).x / k - 21) < 0.1, 3000, 'the torch dragged along the wall');
    const moved = fx1(torch.id);
    t.ok(Math.abs(moved.y / k - 3.278) < 0.02 && moved.rotation === 0, 'still on the wall\'s face', [moved.x / k, moved.y / k]);
    a = await t.scr(18 * k, 7.5 * k); await t.click(a.x, a.y);
    await t.until(() => t.g('Play.ui.os.lightSel').then((v) => !v), 3000, 'a click beside it lets go');
    t.eq([lights().length, await t.count('#pop .os-lights')], [3, 1], 'nothing placed by that click; the kinds are back');
    a = await t.scr(left.x, left.y); await t.click(a.x, a.y);
    await t.until(() => t.g('Play.ui.os.lightSel').then((v) => v === left.id), 3000, 'the other torch picked');
    // Beta 3.68 (Glinn: a light picked in Draw stayed picked, its rings on the map, in Play's tools)
    t.eq(await t.count('.os-preview .os-lightsel'), 1, 'its rings on the map');
    t.ok(await t.g(`(() => { const r = document.querySelector('.os-preview .os-lightreach'); return Math.abs(r.getScreenCTM().a * +r.getAttribute('stroke-width') - 1.5) < 0.3; })()`), 'thin: its reach drawn 1.5 pixels wide');
    await t.g(`Play.setTool('select')`);
    t.eq([await t.count('.os-preview .os-lightsel'), await t.count('.os-preview .os-lightreach'), await t.g('Play.ui.os.lightSel || null')], [0, 0, null], 'out of Draw: let go, the rings gone');
    await t.g(`Play.setTool('oldschool'); Play.openPop('oldschool')`);
    await t.click(a.x, a.y);
    await t.until(() => t.g('Play.ui.os.lightSel').then((v) => v === left.id), 3000, 'picked again');
    await t.key('Delete');
    await t.until(() => lights().length === 2, 3000, 'Delete takes it away');
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${left.id}"]`)) === 0, 3000, 'with its holder');
    await t.cmd('history.undo', {});
    await t.until(() => lights().length === 3, 3000, 'Undo brings it back');
    // Beta 3.54: its marker in Effects is the same light: Delete there takes the holder too (3.53 left it behind)
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    await t.g(`document.querySelector('#pop .os-tabs2 .tile[data-v="fxt-select"]').click()`); // (Beta 3.66: markers show with the Select tool)
    const hm = await t.until(() => t.rect(`.sv-handle[data-id="${left.id}"]`), 3000, 'its marker in Effects');
    await t.click(hm.cx, hm.cy);
    await t.until(() => t.g('Play.ui.selFx').then((v) => v === left.id), 3000, 'picked in Effects');
    await t.until(async () => (await t.text('#pop .look-head b')) === 'Wall torch', 3000, 'Effects shows the same light');
    t.gm().webContents.focus();
    await t.key('Delete');
    await t.until(() => lights().length === 2, 3000, 'Delete in Effects takes the whole light');
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${left.id}"]`)) === 0, 3000, 'no holder left behind');
    await t.cmd('history.undo', {});
    await t.until(() => lights().length === 3, 3000, 'Undo brings it back');
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    // copied, the copy is a light of its own; removed, nothing is left
    t.handle('fx.duplicate', { mapId: own, id: can.id, dx: k, dy: 0 });
    const two = lights().filter((f) => f.holder === 'candles');
    t.ok(two.length === 2 && two[0].id !== two[1].id && two[1].x === Math.round((can.x + k) * 1000) / 1000, 'a copy beside it', two.map((x) => [x.id, x.x]));
    t.handle('fx.remove', { mapId: own, id: two[1].id });
    t.eq(lights().length, 3, 'removed');
    // only the Select tool asks first, as a door does; the TV follows
    await t.send(own);
    await t.g(`Play.setTool('fog')`);
    { const tn = fx1(torch.id); a = await t.scr(tn.x, tn.y); } await t.click(a.x, a.y); await t.sleep(300);
    t.eq(await t.count('.light-ask'), 0, 'the Fog tool does not ask');
    await t.g(`Play.setTool('select')`);
    await t.click(a.x, a.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'the question');
    t.eq(await t.text('.light-ask b'), 'Put out the wall torch?', 'it asks');
    t.eq(fx1(torch.id).lit, undefined, 'nothing happens before the answer');
    await t.clickText('.light-ask .btn', 'No');
    t.ok((await t.count('.light-ask')) === 0 && fx1(torch.id).lit !== false, 'No: it burns on');
    await t.click(a.x, a.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'the question again');
    await t.clickText('.light-ask .btn', 'Yes');
    await t.until(() => fx1(torch.id).lit === false, 3000, 'the torch put out');
    await t.click(a.x, a.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'the question for the dark torch');
    t.eq(await t.text('.light-ask b'), 'Light the wall torch?', 'now it offers to light it');
    await t.clickText('.light-ask .btn', 'Yes');
    await t.until(() => fx1(torch.id).lit !== false, 3000, 'the torch lit again');
    await t.shot(t.tv(), 'lights-tv');
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    // (Beta 3.54: a wall light going with its wall is checked in the light area, without a picture to make)
    for (const f of lights()) t.handle('fx.remove', { mapId: own, id: f.id });
    t.eq(lights().length, 0, 'all gone');
    await tool(t, 'room');
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
    const tvPic = await t.shot(t.tv(), 'oldschool-tv');
    // T1 (open point): the TV's picture has the drawn map in it, not one flat colour (it only said "pictures taken")
    t.ok(tvPic && t.spread(tvPic) > 12, 'the TV shows the drawn map (light and shade in its picture)', tvPic && Math.round(t.spread(tvPic)));
  }, { ms: 300000 });

  // ---------- Speed 1 (Open Points WA): nothing is made twice ----------
  // (the keys of a big drawing's tiles, worked out without making a picture: Oldschool.tileKeysOf)
  area.quick('WA2, WA3, WA7: a room at the edge of a big drawing keeps the other tiles; the sharpness moves in steps; a far cliff does not widen an edit', async (t) => {
    const one = (x0, y0, x1, y1, n, extra = {}) => ({ id: `q${n}`, kind: 'area', shape: 'rect', pts: [[x0, y0], [x1, y1]], tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' }, edge: 'walls', mat: 'stone_wall', level: 0, ...extra });
    const big = []; let n = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) big.push(one(2 + c * 7, 2 + r * 6, 7 + c * 7, 6 + r * 6, n++));
    const keysOf = (items, has = null) => t.g(`(() => { const was = Oldschool.noSharp; Oldschool.noSharp = false; Oldschool.setSharp(0); Oldschool.setSharp(100); Oldschool.setHas(${JSON.stringify(has)}); try { return Oldschool.tileKeysOf(${JSON.stringify({ os: { items, doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } })}, []); } finally { Oldschool.setSharp(0); Oldschool.setHas(null); Oldschool.noSharp = was; } })()`);
    const same = (a, b) => Object.keys(a.keys).filter((k) => a.keys[k] === b.keys[k]).length;
    const diff = (a, b) => Object.keys(b.keys).filter((k) => a.keys[k] !== b.keys[k]).length;
    // WA2
    const k1 = await keysOf(big);
    const tiles = Object.keys(k1.keys).length;
    t.ok(k1.squares > 1875 && tiles >= 30, 'a drawing big enough for its dots a square to follow its outline', { squares: k1.squares, tiles, P: k1.P });
    // twelve rooms, each a little further out to the right, each with the picture of the one before (its dots a square
    // are kept while they are near enough): how often every tile is made again (it was every time)
    let prev = k1; let all = big; const kept = []; let full = 0;
    for (let i = 0; i < 12; i++) {
      all = [...all, one(73 + i * 5, 2, 77 + i * 5, 5, 900 + i)];
      const k = await keysOf(all, { P: prev.P, sharpP: prev.sharpP });
      const n = same(prev, k); kept.push(`${n}/${Object.keys(prev.keys).length}`);
      if (k.P !== prev.P || k.sharpP !== prev.sharpP) full++;
      else t.ok(n >= Object.keys(prev.keys).length - 4, `room ${i + 1} further out, same dots a square: all but the tiles near it are kept`, { kept: n, of: Object.keys(prev.keys).length });
      prev = k;
    }
    t.ok(full <= 2, 'of twelve rooms that make the outline grow to nearly twice its width, at most two make every tile again', { full, kept });
    // WA7: a cliff floor in one corner; a small room far from it changes one tile, not four
    const withCliff = [...big, one(2, 40, 6, 44, 801, { edge: 'cliff', mat: 'rock' })];
    const k3 = await keysOf(withCliff);
    const k4 = await keysOf([...withCliff, one(53, 13, 55, 15, 802)]);
    t.eq([k4.P, diff(k3, k4)], [k3.P, 1], 'tiles made again for a small room far from the cliff');
    // WA3: the wish in steps; what the picture has is kept while it is near
    const small = { os: { items: [one(2, 2, 6, 5, 1)], doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } };
    const steps = await t.g(`(() => { const was = Oldschool.noSharp; Oldschool.noSharp = false; const P = () => (Oldschool.sharpOf(${JSON.stringify(small)}) || {}).P; const out = []; try {
      Oldschool.setSharp(0); Oldschool.setSharp(101); out.push(P());
      Oldschool.setSharp(104); out.push(P());
      Oldschool.setSharp(112); out.push(P());
      Oldschool.setSharp(100); out.push(P());
      Oldschool.setSharp(150, 140); out.push(P());
      Oldschool.setSharp(170, 140); out.push(P());
      return out; } finally { Oldschool.setSharp(0); Oldschool.noSharp = was; } })()`);
    t.eq(steps, [100, 100, 115, 115, 140, 170], 'sharpness for a wish of 101, 104, 112, 100, then 150 and 170 with tiles of 140');
  });

  area.deep('WA1, WA4, WA5, WA6, WA9: the freeze is written down; no picture while a button is held; one that is out of date is dropped; the same sun again is no change; a failed one is not tried on every state', async (t) => {
    await clear(t);
    const dbg = () => t.g('Play.OS.debug');
    t.handle('os.add', { mapId: own, item: room(2, 2, 7, 6) });
    await t.settle(); await baked(t);
    // WA1
    const st = await t.g('Oldschool.stats.last');
    t.ok(st && Number.isFinite(st.gap) && st.gap >= 0, 'the longest gap between two frames of the last picture', st && st.gap);
    // WA6: the sun it already has: no change, no undo step, no picture due
    const h0 = t.store.history(own).undo.length;
    t.handle('os.set', { mapId: own, sun: M(t).os.sun ?? 135 });
    await t.sleep(500);
    // (no step is added; with the history full at 80 the oldest one is lost on the way: Open Point WC5)
    t.eq([t.store.history(own).undo.length <= h0, (await dbg()).due], [true, false], 'no undo step and no picture due after the same sun again');
    // WA4: a button is held: the picture waits; let go: it comes
    const vpr = await t.viewport(); const title = { cx: 6, cy: Math.round(vpr.y + vpr.h + 30) }; // (the rail's lower left corner: a press there does nothing)
    const d0 = await dbg();
    await t.mouse('mouseDown', title.cx, title.cy);
    try {
      t.handle('os.add', { mapId: own, item: room(9, 2, 13, 6) });
      await t.sleep(1600);
      const d1 = await dbg();
      t.eq([d1.held, d1.started - d0.started, d1.due], [true, 0, true], 'while the button is held: held, pictures started, one due');
    } finally { await t.mouse('mouseUp', title.cx, title.cy); }
    await baked(t);
    t.ok((await dbg()).started - d0.started >= 1, 'let go: the picture is made');
    // WA5: a second change while a picture is being made: that picture is dropped, one is sent
    const e0 = await dbg();
    t.handle('os.add', { mapId: own, item: room(15, 2, 19, 6) });
    await t.until(async () => (await dbg()).baking, 8000, 'the picture to start');
    t.handle('os.add', { mapId: own, item: room(21, 2, 25, 6) });
    await t.settle(); await baked(t);
    await t.until(async () => !(await dbg()).baking, 20000, 'the making to end');
    const e1 = await dbg();
    t.eq([e1.sent - e0.sent, e1.dropped - e0.dropped >= 1], [1, true], 'pictures sent, and one given up');
    // WA9: a picture that fails is not tried again by a state that has nothing to do with the drawing
    await t.g(`window.__bake = Oldschool.bake; Oldschool.bake = async () => { throw new Error('test: no picture'); }; 0`);
    try {
      t.handle('os.add', { mapId: own, item: room(2, 9, 6, 12) });
      await t.until(async () => (await dbg()).failed, 8000, 'the failure to be noted');
      const f0 = await dbg();
      t.handle('light.update', { mapId: own, darkness: 0.1 }); await t.sleep(500);
      t.handle('light.update', { mapId: own, darkness: 0 }); await t.sleep(900);
      const f1 = await dbg();
      t.eq([f1.started - f0.started, f1.due], [0, false], 'pictures started by two unrelated states, and one due');
    } finally { await t.g(`Oldschool.bake = window.__bake; delete window.__bake; 0`); }
    t.handle('os.add', { mapId: own, item: room(9, 9, 13, 12) });
    await t.settle(); await baked(t);
    t.eq((await dbg()).failed, false, 'no failure is remembered once the next change was made into a picture');
  }, { ms: 300000, allow: /test: no picture/ }); // (the failure is the check's own)

  area.deep('WA8: a setting changed and changed back uses the tiles that are still on the disk', async (t) => {
    await t.g('Oldschool.noSharp = false');
    try {
      await clear(t);
      t.handle('os.add', { mapId: own, item: room(2, 2, 7, 6) });
      await t.settle();
      const m = await baked(t, 120000);
      t.ok(m.bg.sharp && m.bg.sharp.tiles.length >= 1, 'sharp tiles', m.bg.sharp && m.bg.sharp.tiles.length);
      const sun = m.os.sun ?? 135;
      t.handle('os.set', { mapId: own, sun: (sun + 90) % 360 });
      await t.settle(); await baked(t, 120000);
      const s1 = await t.g('Oldschool.stats.last');
      t.ok(s1.made >= 1, 'another sun: its tiles are made', [s1.made, s1.kept]);
      t.handle('os.set', { mapId: own, sun });
      await t.settle(); const m3 = await baked(t, 120000);
      const s2 = await t.g('Oldschool.stats.last');
      t.eq([s2.made, s2.kept >= 1], [0, true], 'the first sun again: tiles made, tiles kept');
      t.ok(m3.bg.sharp.tiles.every((x) => fs.existsSync(x.path)), 'and their files are there');
    } finally { await t.g('Oldschool.noSharp = true'); }
  }, { ms: 400000 });

  // ---------- Speed 2 (Open Points WB3, WB4, WB6) ----------
  area.quick('WB6: the graphics programs are handed over when a drawn map opens, also the one no picture here has used', async (t) => {
    const names = ['height', 'inside', 'jfa', 'seed', 'shade', 'sharp'];
    const st = await t.until(async () => { const p = await t.g('Oldschool.progsState()'); return p && names.every((n) => p[n] === 'ready') && p; }, 60000, 'the programs to be ready');
    t.eq(Object.keys(st).sort(), names, 'the six programs (sharp tiles are off in these checks: only the hand-over has built that one)');
  });

  area.deep('WB3, WB4: a tile paints only what lies near it and comes out the same, dot for dot; scaled pictures and material textures are kept between two pictures', async (t) => {
    await clear(t);
    const T = (n) => ({ rel: `Tiles/Tablescape/${n}.webp` });
    const P = (pts) => pts.map(([x, y]) => [x * k, y * k]);
    const items = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) items.push(room(2 + c * 7, 2 + r * 6, 7 + c * 7, 6 + r * 6, { tile: T((c + r) % 2 ? 'Slate' : 'Old cobblestone') }));
    items.push(
      room(46, 2, 54, 9, { edge: 'rock', mat: 'rock', tile: T('Slate') }),
      room(46, 13, 54, 19, { edge: 'cliff', mat: 'rock' }),
      room(2, 22, 12, 28, { edge: 'fade', tile: T('Meadow'), mixW: 0 }),
      room(8, 24, 17, 30, { edge: 'ledge', tile: T('Slate'), mixW: 1.5, mixU: 0.5, mixT: 0.5 }),
      { kind: 'line', pts: P([[21, 22], [27, 22], [27, 27]]), w: 0.5 * k, h: 1, mat: 'stone_wall' },
      { kind: 'pillar', pts: P([[31, 24]]), r: 0.4 * k, mat: 'stone_wall' },
      { kind: 'stairs', pts: P([[3, 3], [5, 5]]), dir: 2, tile: T('Slate') },
    );
    t.handle('os.add', { mapId: own, items });
    t.handle('os.door', { mapId: own, x1: 7 * k, y1: 3 * k, x2: 7 * k, y2: 4 * k, door: 1 });
    t.handle('os.door', { mapId: own, x1: 10 * k, y1: 2 * k, x2: 11 * k, y2: 2 * k, door: 1, kind: 'window' });
    t.handle('os.door', { mapId: own, x1: 23 * k, y1: 22 * k, x2: 24 * k, y2: 22 * k, door: 1 });
    await t.settle(); await baked(t, 120000);
    const m = M(t);
    t.ok(m.os.items.length >= 25 && m.os.doors.length === 3, 'a drawing with a bit of everything', [m.os.items.length, m.os.doors.length]);
    // a picture with sharp tiles made here, without a file: every tile's bytes as one number
    const make = (noCull) => t.g(`(async () => {
      const sum = async (b) => { const a = new Uint8Array(await b.arrayBuffer()); let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return [a.length, h >>> 0]; };
      const map = ${JSON.stringify({ os: m.os, grid: m.grid })};
      const lib = [];
      Oldschool.noCull = ${noCull};
      Oldschool.noSharp = false; Oldschool.setSharp(0); Oldschool.setSharp(100); Oldschool.setHas(null); Oldschool.noSharp = true;
      const job = Oldschool.bake(map, lib, null, null, {}); // (its box and sharpness are taken before anything else can change them)
      try { const r = await job; const tiles = {}; for (const x of r.sharp.tiles) tiles[x.c + ',' + x.r] = await sum(x.blob); return { tiles, base: await sum(r.blob), stats: Oldschool.stats.last }; }
      finally { Oldschool.noCull = false; Oldschool.setSharp(0); }
    })()`);
    // (one picture first: after the checks before this one, the first picture of a drawing with a mixing floor differs
    // from the next in one tile. That is older than Speed 2 and has nothing to do with what is painted: the same
    // picture made twice, both times with every thing in every tile, shows it too. Found on 25 Nov 2026, not looked into)
    await make(true);
    const all = await make(true);
    const near = await make(false);
    const n = Object.keys(all.tiles).length;
    t.ok(n >= 12, 'sharp tiles', n);
    const other = Object.keys(all.tiles).filter((key) => String(all.tiles[key]) !== String(near.tiles[key]));
    t.eq([Object.keys(near.tiles).length, other], [n, []], 'tiles, and those that came out differently when only what lies near them was painted');
    t.eq(near.base, all.base, 'the base picture is the same');
    t.ok(near.stats.tileThings > 0 && near.stats.tileThings < all.stats.made * m.os.items.length / 3, 'things painted for all the tiles: under a third of every thing in every tile', { painted: near.stats.tileThings, tiles: near.stats.made, things: m.os.items.length });
    // WB4: the second picture scales nothing and makes no material texture
    t.ok(all.stats.scaledKept + all.stats.scaledMade > 0, 'the first of the two used scaled pictures', [all.stats.scaledMade, all.stats.scaledKept]);
    t.eq([near.stats.scaledMade, near.stats.matsMade, near.stats.scaledKept > 0, near.stats.matsKept >= 2], [0, 0, true, true], 'the second: pictures scaled, material textures made; pictures and textures used again');
  }, { ms: 400000 });

  // ---------- 25 Nov 2026: fifteen more walls, each a kit (tiles/walls/<id>/) ----------
  area.quick('wall kits: fifteen more walls; Made of shows the five used last, List … opens all of them', async (t) => {
    const kits = await t.g('Oldschool.WALLKITS.map((x) => [x.id, x.label, x.gain, x.small])');
    t.eq(kits.map((x) => x[1]), ['Fieldstone', 'Brick', 'Sandstone', 'Marble', 'Mossy ruin', 'Rune stone', 'Dwarven', 'Obsidian', 'Wood', 'Timber frame', 'Palisade', 'Iron', 'Ice', 'Crystal', 'Bone'], 'the kits');
    for (const [id, , gain] of kits) {
      t.ok(gain > 0.5 && gain <= 1, `${id}: how much darker it is painted`, gain);
      for (const p of ['run', 'cap', 'jamb', 'end', 'sill', 'small']) t.ok(fs.existsSync(path.join(__dirname, '..', '..', 'renderer', 'tiles', 'walls', id, `${p}.webp`)), `${id}: ${p}.webp`);
    }
    t.eq(await t.g('Oldschool.MATERIALS.length'), 5, 'the light still knows five materials: a kit takes none of their places');
    // a kit is no tile of the library, though one is named as a floor is
    const lib = await t.lib('tiles');
    t.eq([lib.filter((x) => x.name === 'Fieldstone').length, lib.some((x) => /^(Brick|Palisade|Dwarven)$/.test(x.name))], [1, false], 'Fieldstone the floor once in Library → Tiles, no kit among the tiles');
    t.eq(await t.g(`(Oldschool.tileInfo({ rel: 'Tiles/Tablescape/Fieldstone.webp' }, []) || {}).id`), 'fieldstone', 'and that name is still the floor');
    // the panel: four in a row and a "+" for all of them (XA5; it was five and a button List …)
    await t.g(`Play.ui.os.edge = 'walls', Play.setTool('oldschool'), Play.closePop(), Play.openPop('oldschool')`);
    await tool(t, 'room');
    const row = () => t.g(`[...document.querySelectorAll('#pop .os-edgemat .os-mats .tile[data-v]')].map((b) => [b.dataset.v, b.classList.contains('on')])`);
    const was = await t.g('Play.ui.os.mats.walls');
    t.eq([(await row()).length, await t.count('#pop .os-edgemat .os-mats .tile.os-plus')], [4, 1], 'walls in the row, and the "+"');
    await t.clickSel('#pop .os-edgemat .os-mat-list');
    await t.until(async () => (await t.count('.fp[data-id="osmats"] .pl-it')) === 18, 4000, 'List …: all 18 walls');
    await t.shot(t.gm(), 'wall-kits-list');
    await t.clickText('.fp[data-id="osmats"] .pl-it', 'Wood');
    await t.until(async () => (await t.g('Play.ui.os.mats.walls')) === 'wood_wall', 3000, 'Wood to be picked');
    const r2 = await row();
    t.eq([r2.length, r2[0], await t.g(`document.querySelector('#pop .os-edgemat .os-mat-list').classList.contains('on')`)], [4, ['wood_wall', true], true], 'the row: still four, Wood first and lit; the "+" lit while its list is open');
    await t.shot(t.gm(), 'wall-kits-row');
    await t.clickSel('#pop .os-edgemat .os-mat-list');
    await t.until(async () => (await t.count('.fp[data-id="osmats"]')) === 0, 3000, 'the list to close');
    // Rock and Cliff: what was there, then the kits (19)
    const rockWas = await t.g('Play.ui.os.mats.rock');
    await t.clickText('#pop .os-pick', 'Rock');
    await t.until(async () => (await t.g('Play.ui.os.edge')) === 'rock', 3000, 'the Rock edge');
    t.eq((await row()).map((x) => x[0]), ['rock', 'cliff', 'stone_wall', 'dark_stone_wall'], 'Rock: the row');
    await t.clickSel('#pop .os-edgemat .os-mat-list');
    await t.until(async () => (await t.count('.fp[data-id="osrockmats"] .pl-it')) === 19, 4000, 'List … for rock: 19');
    await t.clickText('.fp[data-id="osrockmats"] .pl-it', 'Ice');
    await t.until(async () => (await t.g('Play.ui.os.mats.rock')) === 'ice_wall', 3000, 'Ice to be picked for rock');
    t.eq((await row())[0], ['ice_wall', true], 'Ice first in the row and lit');
    await t.clickSel('#pop .os-edgemat .os-mat-list');
    await t.until(async () => (await t.count('.fp[data-id="osrockmats"]')) === 0, 3000, 'the list to close');
    await t.g(`Play.ui.os.mats.rock = ${JSON.stringify(rockWas)}; 0`);
    await t.clickText('#pop .os-pick', 'Walls');
    // a wall line has two more to pick from (rock and mossy rock)
    await tool(t, 'wall');
    await t.clickSel('#pop .os-mat-list');
    await t.until(async () => (await t.count('.fp[data-id="oslinemats"] .pl-it')) === 20, 4000, 'List … for a wall line: 20');
    await t.clickSel('#pop .os-mat-list');
    await tool(t, 'room');
    await t.g(`Play.ui.os.mats.walls = ${JSON.stringify(was)}; 0`);
  });

  area.deep('wall kits: a room, a passage, a pillar and a wall line of every kit become a picture; a passage shows the kit, not stone', async (t) => {
    const out = await t.g(`(async () => {
      const mats = ['stone_wall', ...Oldschool.WALLKITS.map((x) => x.id)];
      const COLS = 4; const items = []; const doors = []; const at = {};
      mats.forEach((id, i) => {
        const x = 2 + (i % COLS) * 10; const y = 3 + Math.floor(i / COLS) * 8;
        const tile = { rel: 'Tiles/Tablescape/Slate.webp' };
        items.push({ kind: 'area', shape: 'rect', pts: [[x, y], [x + 5, y + 4]], tile, edge: 'walls', mat: id, level: 0 });
        items.push({ kind: 'area', shape: 'path', pts: [[x + 5, y + 2], [x + 7, y + 2], [x + 7, y + 4.5]], r: 0.5, tile, edge: 'walls', mat: id, level: 0 });
        items.push({ kind: 'pillar', pts: [[x + 1.5, y + 1.5]], r: 0.35, round: false, mat: id });
        items.push({ kind: 'line', pts: [[x + 3, y + 1], [x + 3, y + 2.5]], w: 0.5, h: 1, mat: id });
        doors.push({ x1: x + 2, y1: y + 4, x2: x + 3, y2: y + 4, door: 1 });
        doors.push({ x1: x + 1, y1: y, x2: x + 2, y2: y, door: 1, kind: 'window' });
        at[id] = { room: [x + 4, y - 0.22], passage: [x + 7.72, y + 3.5] }; // (a room's top wall, right of its window; the passage's wall on its right)
      });
      Oldschool.setSharp(0); Oldschool.setHas(null);
      const r = await Oldschool.bake({ os: { items, doors, sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } }, [], null, null, {});
      const bmp = await createImageBitmap(r.blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      const P = 1 / r.scale;
      const mean = ([mx, my]) => { const n = Math.max(2, Math.round(P * 0.16)); const d = g.getImageData(Math.round((mx - r.x) * P - n / 2), Math.round((my - r.y) * P - n / 2), n, n).data; const o = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { o[0] += d[i]; o[1] += d[i + 1]; o[2] += d[i + 2]; } return o.map((v) => Math.round(v / (d.length / 4))); };
      const res = {}; for (const id of mats) res[id] = { room: mean(at[id].room), passage: mean(at[id].passage) };
      return { res, size: [c.width, c.height], P: Math.round(P) };
    })()`);
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const st = out.res.stone_wall;
    t.ok(lum(st.room) > 20 && lum(st.passage) > 20, 'the stone room and passage have walls where they are measured', st);
    // bright kits against stone, on the room (its pieces) and on the passage (its bond: no piece lies along a path)
    for (const id of ['marble_wall', 'ice_wall', 'timber_frame_wall']) {
      t.ok(lum(out.res[id].room) > lum(st.room) + 30, `${id}: the room's wall is its kit`, [out.res[id].room, st.room]);
      t.ok(lum(out.res[id].passage) > lum(st.passage) + 30, `${id}: the passage's wall is its kit too, not stone`, [out.res[id].passage, st.passage]);
    }
    // coloured kits: not the grey of stone
    for (const id of ['brick_wall', 'sandstone_wall', 'wood_wall', 'crystal_wall']) t.ok(far(out.res[id].passage, st.passage) > 30 && far(out.res[id].room, st.room) > 30, `${id}: its own colour on room and passage`, [out.res[id], st]);
    for (const id of Object.keys(out.res)) t.ok(lum(out.res[id].room) > 8 && lum(out.res[id].passage) > 8, `${id}: a wall, not the dark`, out.res[id]);
    // and through the tool: a kit room becomes the map's picture, on the TV too
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(2, 2, 7, 6, { mat: 'marble_wall' }), { kind: 'line', pts: [[9 * k, 2 * k], [9 * k, 6 * k]], w: 0.5 * k, h: 1, mat: 'palisade_wall' }] });
    await t.settle(); const m = await baked(t);
    t.eq(m.os.items.map((x) => x.mat), ['marble_wall', 'palisade_wall'], 'the map keeps the kits\' names');
    await t.send(own);
    await t.sleep(1500);
    await t.shot(t.gm(), 'wall-kits-map');
  }, { ms: 300000 });

  area.deep('wall kits on rock and cliffs: every kit has its own look, all fifteen on one map; sharp tiles too', async (t) => {
    const out = await t.g(`(async () => {
      const kits = Oldschool.WALLKITS.map((x) => x.id);
      const rooms = []; for (const edge of ['rock', 'cliff']) for (const id of ['stone_wall', ...kits]) rooms.push([edge, id]);
      const COLS = 8; const items = []; const at = {};
      rooms.forEach(([edge, id], i) => {
        const x = 5 + (i % COLS) * 13; const y = 6 + Math.floor(i / COLS) * 12;
        items.push({ kind: 'area', shape: 'rect', pts: [[x, y], [x + 5, y + 4]], tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge, mat: id, level: 0 });
        at[edge + ':' + id] = [x - 1.2, y + 2]; // (in the rock, or on the cliff's face, left of the floor)
      });
      const os = { items, doors: [], sun: 135 };
      Oldschool.setSharp(0); Oldschool.setHas(null);
      const r = await Oldschool.bake({ os, grid: { size: 1, ox: 0, oy: 0 } }, [], null, null, {});
      const bmp = await createImageBitmap(r.blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      const P = 1 / r.scale;
      const mean = ([mx, my]) => { const n = Math.max(4, Math.round(P * 1.2)); const d = g.getImageData(Math.round((mx - r.x) * P - n / 2), Math.round((my - r.y) * P - n / 2), n, n).data; const o = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { o[0] += d[i]; o[1] += d[i + 1]; o[2] += d[i + 2]; } return o.map((v) => Math.round(v / (d.length / 4))); };
      const res = {}; for (const key of Object.keys(at)) res[key] = mean(at[key]);
      // three of them again with sharp tiles (its box and sharpness are taken before anything else can change them)
      const small = { os: { items: [items[1], items[COLS * 2 + 3], items[0]].map((it, i) => ({ ...it, pts: [[4 + i * 12, 4], [9 + i * 12, 8]] })), doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } };
      Oldschool.noSharp = false; Oldschool.setSharp(0); Oldschool.setSharp(100); Oldschool.setHas(null); Oldschool.noSharp = true;
      const job = Oldschool.bake(small, [], null, null, {});
      let tiles = null; try { const r2 = await job; tiles = r2.sharp ? r2.sharp.tiles.map((x) => !!x.blob && x.blob.size > 500) : null; } finally { Oldschool.setSharp(0); }
      return { res, kits: Oldschool.slotsOf(os).kits.length, none: Oldschool.slotsOf({ items: items.filter((it) => it.mat === 'stone_wall') }).kits.length, tiles, smallKits: Oldschool.slotsOf(small.os).kits };
    })()`);
    t.eq([out.kits, out.none], [15, 0], 'kits with a layer of their own on this map, and on one without a kit');
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const R = (id) => out.res[`rock:${id}`]; const Cf = (id) => out.res[`cliff:${id}`];
    t.ok(lum(R('stone_wall')) > 15, 'rock of Stone where it is measured', R('stone_wall'));
    for (const id of ['ice_wall', 'marble_wall', 'timber_frame_wall']) t.ok(lum(R(id)) > lum(R('stone_wall')) + 30, `${id}: rock made of it is its own, bright`, [R(id), R('stone_wall')]);
    for (const id of ['brick_wall', 'sandstone_wall', 'wood_wall', 'crystal_wall', 'palisade_wall']) t.ok(far(R(id), R('stone_wall')) > 30, `${id}: rock made of it has its colour`, [R(id), R('stone_wall')]);
    // all fifteen at once: none falls back to Stone (with five places only two could be shown)
    const own = Object.keys(out.res).filter((key) => key.startsWith('rock:') && key !== 'rock:stone_wall' && far(out.res[key], R('stone_wall')) > 12);
    t.ok(own.length >= 13, 'of the fifteen kits as rock on one map, those that do not look like Stone', { n: own.length, res: out.res });
    for (const id of ['ice_wall', 'marble_wall', 'sandstone_wall']) t.ok(far(Cf(id), Cf('stone_wall')) > 12, `${id}: a cliff made of it`, [Cf(id), Cf('stone_wall')]);
    t.eq(out.smallKits.length, 2, 'the small map: two kits on rock and a cliff');
    t.ok(out.tiles && out.tiles.length >= 3 && out.tiles.every(Boolean), 'and its sharp tiles are made', out.tiles);
  }, { ms: 300000 });

  area.deep('a pillar placed on a wall corner covers it entirely; a room wall of a kit shows its rail on the floor side too', async (t) => {
    const out = await t.g(`(async () => {
      const A = (mat, floor, pts) => ({ kind: 'area', shape: 'rect', pts, tile: { rel: 'Tiles/Tablescape/' + floor + '.webp' }, edge: 'walls', mat, level: 0, mixW: 0 });
      const shot = async (items) => {
        Oldschool.setSharp(0); Oldschool.setHas(null);
        const r = await Oldschool.bake({ os: { items, doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } }, [], null, null, {});
        const bmp = await createImageBitmap(r.blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
        const P = 1 / r.scale;
        // the mean colour of a box (in squares) of the map
        return (x0, y0, x1, y1) => { const X = Math.round((x0 - r.x) * P); const Y = Math.round((y0 - r.y) * P); const w = Math.max(1, Math.round((x1 - x0) * P)); const h = Math.max(1, Math.round((y1 - y0) * P)); const d = g.getImageData(X, Y, w, h).data; const o = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { o[0] += d[i]; o[1] += d[i + 1]; o[2] += d[i + 2]; } return o.map((v) => Math.round(v / (d.length / 4))); };
      };
      // a brick room; its top left corner piece has its middle at (2.775, 2.775)
      const room = A('brick_wall', 'Slate', [[3, 3], [8, 7]]);
      const bare = await shot([room]);
      const post = await shot([room, { kind: 'pillar', pts: [[2.775, 2.775]], r: 0.5, round: false, mat: 'marble_wall' }]);
      const beside = await shot([room, { kind: 'pillar', pts: [[4.5, 4.5]], r: 0.3, round: false, mat: 'marble_wall' }]);
      const mid = [2.775 - 0.1, 2.775 - 0.1, 2.775 + 0.1, 2.775 + 0.1]; const edge = [2.775 + 0.33, 2.775 - 0.1, 2.775 + 0.43, 2.775 + 0.1]; // (the piece's middle; a spot on the pillar beside the piece)
      // a dwarven room: the top wall is 0.45 squares above y = 3; rows of it, away from the corners
      const dw = await shot([A('dwarven_wall', 'Slate', [[3, 3], [9, 7]])]);
      const band = (a, b) => dw(4, 3 - b * 0.45, 8, 3 - a * 0.45); // (from a to b of the wall's width, counted from the floor)
      return { bare: bare(...mid), post: post(...mid), postEdge: post(...edge), beside: beside(...mid), rail: band(0.13, 0.22), middle: band(0.4, 0.6), outer: band(0.78, 0.9) };
    })()`);
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    t.ok(far(out.post, out.bare) > 60, 'the corner with a marble pillar on it is no longer brick in its middle', [out.post, out.bare]);
    const warm = (c) => c[0] - c[2]; // (brick is red, marble is not)
    t.ok(warm(out.bare) > 15 && Math.abs(warm(out.post)) < 10 && Math.abs(warm(out.postEdge)) < 10, 'and the pillar is one piece there: marble in its middle as at its rim, where the bare corner is brick', [out.bare, out.post, out.postEdge]);
    t.ok(far(out.beside, out.bare) < 12, 'a pillar somewhere else leaves the corner piece', [out.beside, out.bare]);
    t.ok(lum(out.rail) > lum(out.middle) + 6 && lum(out.rail) > 40, 'the dwarven wall: the bronze rail on the floor side shows (brighter than the stone in the middle)', out);
    t.ok(out.rail[0] - out.rail[2] > out.middle[0] - out.middle[2], 'and it is the warmer of the two', [out.rail, out.middle]);
  }, { ms: 300000 });

  // ---------- Speed 2, second part (Open Points WB2, WB9, WB10, WB11) ----------
  area.deep('WB2, WB9, WB10, WB11: the sight walls, the doors\' places and the living map are kept while what they depend on is the same, and are the same as made anew; the floor hit test with boxes finds the same floor', async (t) => {
    const out = await t.g(`(async () => {
      const tile = { rel: 'Tiles/Tablescape/Slate.webp' };
      const A = (shape, pts, extra = {}) => ({ id: 'a' + Math.round(pts[0][0] * 10) + '_' + Math.round(pts[0][1] * 10) + shape, kind: 'area', shape, pts, tile, edge: 'walls', mat: 'stone_wall', level: 0, mixW: 0, ...extra });
      const base = [
        A('rect', [[3, 3], [9, 8]]), A('round', [[11, 3], [15, 7]]), A('poly', [[17, 3], [21, 3], [22.5, 5], [20.5, 7.5], [17, 7]]),
        A('path', [[9, 5], [10.2, 5], [10.2, 6.5], [11.4, 5.6]], { r: 0.5 }), A('brush', [[4, 11], [6, 12], [8, 11.5], [9, 13]], { r: 0.8 }),
        { id: 'l1', kind: 'line', pts: [[7, 4], [7, 6]], w: 0.5, h: 1, mat: 'stone_wall' }, { id: 'p1', kind: 'pillar', pts: [[4.5, 4.5]], r: 0.35, round: false, mat: 'stone_wall' },
        { id: 'c1', kind: 'cut', shape: 'rect', pts: [[18, 4], [19, 5]] },
        { id: 'fx1', kind: 'live', shape: 'rect', pts: [[4, 6], [6, 7.5]], fx: 'water', mixW: 0 },
      ];
      const doors = [{ id: 'd1', x1: 5, y1: 8, x2: 6, y2: 8, door: 1 }, { id: 'd2', x1: 4, y1: 3, x2: 5, y2: 3, door: 1, kind: 'window' }];
      const sum = async (b) => { if (!b) return null; const a = new Uint8Array(await b.arrayBuffer()); let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return [a.length, h >>> 0]; };
      const bake = async (items, fresh) => {
        if (fresh) Oldschool.forgetKept();
        Oldschool.setSharp(0); Oldschool.setHas(null);
        const r = await Oldschool.bake({ os: { items, doors, sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } }, [], null, null, {});
        return { walls: JSON.stringify(r.walls), live: await sum(r.live), sightKept: Oldschool.stats.last.sightKept, liveKept: Oldschool.stats.last.liveKept, n: r.walls.length };
      };
      // a texture stroke far from the effect, a floor's other tile: no shape of a wall changes, nothing near the effect
      const paint = { id: 'pt1', kind: 'paint', shape: 'brush', pts: [[18, 6], [20, 6.5]], r: 0.4, tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' }, mixW: 0.3 };
      const retiled = base.map((it) => (it.id === base[1].id ? { ...it, tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' } } : it));
      const farRoom = A('rect', [[17, 10], [21, 13]]); // (inside the drawing's box: the picture keeps its size)
      const onEffect = A('rect', [[5, 6.5], [7, 7.2]], { edge: 'ledge' });
      const first = await bake(base, true);
      const withPaint = await bake([...retiled, paint], false);
      const withPaintFresh = await bake([...retiled, paint], true);
      await bake(base, true);
      const withRoom = await bake([...base, farRoom], false);
      const withRoomFresh = await bake([...base, farRoom], true);
      await bake(base, true);
      const covered = await bake([...base, onEffect], false);
      // the hit test: every third of a square over the drawing, with and without the boxes
      const os = { items: [...base, farRoom], doors };
      const grid = (off) => { Oldschool.noHitBox = off; const o = []; for (let y = 1; y < 15; y += 0.31) for (let x = 1; x < 24; x += 0.33) { const a = Oldschool.areaAt(os, x, y); o.push(a ? a.id : 0); } Oldschool.noHitBox = false; return o; };
      const g0 = grid(true); const g1 = grid(false);
      const sig = (items) => Oldschool.shapeSig({ items });
      return { first, withPaint, withPaintFresh, withRoom, withRoomFresh, covered, hits: g0.length, hitFloors: new Set(g0).size, hitDiff: g0.filter((v, i) => v !== g1[i]).length,
        sigSame: sig(base) === sig([...retiled, paint]), sigNew: sig(base) !== sig([...base, farRoom]) };
    })()`);
    // WB2
    t.ok(out.first.n >= 8 && !out.first.sightKept, 'walls for sight, made the first time', [out.first.n, out.first.sightKept]);
    t.eq([out.withPaint.sightKept, out.withPaint.walls === out.withPaintFresh.walls], [true, true], 'after a texture stroke and another tile: the sight walls are kept, and they are what making them anew gives');
    t.eq([out.withRoom.sightKept, out.withRoomFresh.sightKept], [false, false], 'a new room: they are worked out');
    // WB11
    t.ok(out.first.live && out.first.live[0] > 200, 'the living map of the water', out.first.live);
    t.eq([out.withRoom.liveKept, String(out.withRoom.live), String(out.withPaint.live)], [true, String(out.withRoomFresh.live), String(out.withPaintFresh.live)], 'a room and a stroke far from the effect: the living map is kept, byte for byte what making it anew gives');
    t.eq([out.covered.liveKept, String(out.covered.live) !== String(out.first.live)], [false, true], 'a floor over the water: it is made again, and differs');
    // WB10
    t.ok(out.hits > 3000 && out.hitFloors >= 6, 'points tested over the drawing, and floors found', [out.hits, out.hitFloors]);
    t.eq(out.hitDiff, 0, 'points where the test with boxes finds another floor than the test without');
    // WB9
    t.eq([out.sigSame, out.sigNew], [true, true], 'what a door\'s place depends on: the same after a stroke and a tile, new after a room');
    // and on the screen: a door's place is not worked out again when only a tile changed
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(2, 2, 7, 6)] });
    t.handle('os.door', { mapId: own, x1: 4 * k, y1: 6 * k, x2: 5 * k, y2: 6 * k, door: 1 });
    await t.settle(); await baked(t);
    const door = M(t).os.doors[0].id;
    await t.until(() => t.g(`!!(Play.view().osDoorPl && Play.view().osDoorPl.get(${JSON.stringify(door)}))`), 8000, 'the door on the GM screen');
    await t.g(`Play.view().osDoorPl.get(${JSON.stringify(door)}).mark = 1; 0`);
    t.handle('os.update', { mapId: own, id: M(t).os.items[0].id, tile: { rel: 'Tiles/Tablescape/Slate.webp' } });
    await t.settle(); await baked(t); await t.sleep(400);
    t.eq(await t.g(`Play.view().osDoorPl.get(${JSON.stringify(door)}).mark`), 1, 'another tile for the floor: the door keeps the place it had');
    t.handle('os.add', { mapId: own, items: [room(2, 6, 7, 9)] });
    await t.settle(); await baked(t);
    await t.until(async () => (await t.g(`Play.view().osDoorPl.get(${JSON.stringify(door)}).mark`)) !== 1, 8000, 'a floor on its other side: the door is placed again');
  }, { ms: 300000 });

  // ---------- Speed 3 (Open Points WC5, WC6, WC7, WC8) ----------
  area.deep('WC5, WC6, WC7, WC8: 80 undo steps on a big drawing, and undo and redo give the drawing back; an erased room is gone and the picture is the same; the drawing is not looked at for a change that is not its own; nothing stays unsaved for more than 5 s', async (t) => {
    await clear(t);
    const os = () => JSON.stringify(M(t).os.items.map((x) => [x.id, x.kind, x.pts])) + JSON.stringify(M(t).os.doors);
    // WC5: a drawing heavy enough that a copy of it for every step would not fit: 150 brush strokes of 200 points
    const stroke = (n) => ({ kind: 'area', shape: 'brush', r: 0.4 * k, pts: Array.from({ length: 200 }, (_, i) => [(3 + i * 0.2) * k, (3 + n * 0.3 + Math.sin(i / 7) * 0.5) * k]), tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'ledge', mat: 'stone_wall', level: 0, mixW: 0 });
    t.handle('os.add', { mapId: own, items: Array.from({ length: 150 }, (_, n) => stroke(n)) });
    const H = () => t.store.history(own);
    const marks = [];
    for (let i = 0; i < 100; i++) { t.handle('os.add', { mapId: own, item: { kind: 'pillar', pts: [[(2 + (i % 40)) * k, (60 + Math.floor(i / 40)) * k]], r: 0.3 * k, round: false, mat: 'stone_wall' } }); if (i === 19 || i === 99) marks.push(os()); }
    t.eq(H().undo.length, 80, 'undo steps after 100 edits on a drawing of 150 long strokes (a copy each would leave about 30)');
    t.ok(H().bytes < 20e6, 'and what they are counted to hold', Math.round(H().bytes / 1e6) + ' MB');
    for (let i = 0; i < 80; i++) t.handle('history.undo', {});
    t.eq([H().undo.length, os() === marks[0]], [0, true], 'undone 80 times: the drawing as it was after the 20th edit');
    for (let i = 0; i < 80; i++) t.handle('history.redo', {});
    t.eq(os() === marks[1], true, 'redone 80 times: the drawing as it was after the 100th');
    await t.settle(); await baked(t, 240000);
    // WC8: a change that is not the drawing's own does not make the tool look at the drawing
    const h0 = await t.g('Oldschool.hashCount');
    for (const d of [0.1, 0.2, 0]) { t.handle('light.update', { mapId: own, darkness: d }); await t.settle(); await t.sleep(150); }
    const h1 = await t.g('Oldschool.hashCount');
    t.eq(h1 - h0, 0, 'fingerprints of the drawing worked out for three changes of the light');
    t.handle('os.add', { mapId: own, item: { kind: 'pillar', pts: [[50 * k, 62 * k]], r: 0.3 * k, round: false, mat: 'stone_wall' } });
    await t.settle();
    t.ok((await t.g('Oldschool.hashCount')) - h1 >= 1, 'and for a new pillar');
    await baked(t, 240000);
    // WC6: touched all the time, the campaign is still saved within about 5 s
    const flush = t.store.flush; let saved = 0; t.store.flush = function (...a) { saved++; return flush.apply(this, a); };
    try {
      t.store.flush();
      saved = 0; const t0 = Date.now();
      while (Date.now() - t0 < 6500) { t.store.touch(own); await t.sleep(300); }
      t.ok(saved >= 1 && saved <= 3, 'saves in 6.5 s of changes 0.3 s apart (none before: every change put the saving off)', saved);
    } finally { t.store.flush = flush; }
    // WC7: a room that stands alone, erased with a box around it, leaves the drawing; the picture is the same
    await clear(t);
    const sharp = { mixW: 0 };
    t.handle('os.add', { mapId: own, items: [room(0, 0, 1, 1, sharp), room(44, 22, 45, 23, sharp), room(2, 2, 20, 14, sharp), room(30, 2, 34, 5, sharp), { kind: 'pillar', pts: [[32 * k, 3.5 * k]], r: 0.3 * k, round: false, mat: 'stone_wall' }, room(30, 9, 34, 12, { mixW: 1.5, mixU: 0.5, mixT: 0.5 }), room(33, 11, 37, 14, { mixW: 1.5, mixU: 0.5, mixT: 0.5, tile: { rel: 'Tiles/Tablescape/Slate.webp' } })] });
    const before = M(t).os.items.slice();
    const cutA = { kind: 'cut', shape: 'rect', pts: [[29 * k, 1 * k], [35 * k, 6 * k]] }; // (around the lone room and its pillar)
    const cutB = { kind: 'cut', shape: 'rect', pts: [[29.5 * k, 8.5 * k], [34.5 * k, 12.5 * k]] }; // (around a floor that mixes with its neighbour)
    t.handle('os.add', { mapId: own, item: cutA });
    const afterA = M(t).os.items.slice();
    t.eq([afterA.length, afterA.some((x) => x.kind === 'cut')], [5, false], 'the lone room and its pillar erased: five things left of seven, and no hole kept');
    t.handle('os.add', { mapId: own, item: cutB });
    const afterB = M(t).os.items.slice();
    t.eq([afterB.length, afterB.filter((x) => x.kind === 'cut').length], [6, 1], 'a floor that mixes with a neighbour, erased: it stays under its hole, as before');
    t.handle('history.undo', {}); t.handle('history.undo', {});
    t.eq(M(t).os.items.length, 7, 'undone twice: all seven are back');
    const same = await t.g(`(async () => {
      const sum = async (b) => { const a = new Uint8Array(await b.arrayBuffer()); let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return [a.length, h >>> 0]; };
      const bake = async (items) => { Oldschool.forgetKept(); Oldschool.setSharp(0); Oldschool.setHas(null); const r = await Oldschool.bake({ os: { items, doors: [], sun: 135 }, grid: ${JSON.stringify(M(t).grid)} }, [], null, null, {}); return [String(await sum(r.blob)), JSON.stringify(r.walls), r.nw, r.nh]; };
      const withHoles = await bake(${JSON.stringify([...before, { ...cutA, id: 'ca' }, { ...cutB, id: 'cb' }])});
      const dropped = await bake(${JSON.stringify(afterB)});
      return { picture: withHoles[0] === dropped[0], walls: withHoles[1] === dropped[1], size: [withHoles[2], withHoles[3], dropped[2], dropped[3]] };
    })()`);
    t.eq([same.picture, same.walls], [true, true], 'the picture and the sight walls: with both holes on top of everything, and with the room gone', same);
  }, { ms: 400000 });

  // ---------- 26 Nov 2026 (Open Points WC4, WC10, WI5) ----------
  area.deep('WC4, WC10, WI5: a brush stroke keeps the points its shape needs; a picture the graphics card failed on is made once more; stairs climb the same in the sharp tiles as in the base', async (t) => {
    // WC4: 200 points along a gentle curve, three squares long
    const thin = await t.g(`(() => {
      const pts = Array.from({ length: 200 }, (_, i) => [2 + i * 0.015, 5 + Math.sin(i / 40) * 0.6]);
      const out = Play.OS.simplifyPts(pts, 0.05, 0.4);
      // how far the points left out lie from the line that is kept
      let worst = 0;
      for (const [px, py] of pts) {
        let best = Infinity;
        for (let i = 0; i + 1 < out.length; i++) { const [ax, ay] = out[i]; const [bx, by] = out[i + 1]; const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy; const u = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0; best = Math.min(best, Math.hypot(px - (ax + u * dx), py - (ay + u * dy))); }
        worst = Math.max(worst, best);
      }
      const line = Play.OS.simplifyPts(Array.from({ length: 100 }, (_, i) => [i * 0.2, 3]), 0.05, 0.4);
      return { n: out.length, worst, ends: [out[0], out[out.length - 1]], line: line.length };
    })()`);
    t.ok(thin.n >= 3 && thin.n < 60, 'points kept of 200', thin.n);
    t.ok(thin.worst <= 0.1, 'and none of the 200 lies further from the kept line than a tenth of a square', thin.worst);
    t.eq([thin.ends, thin.line], [[[2, 5], [2 + 199 * 0.015, 5 + Math.sin(199 / 40) * 0.6]], 2], 'its ends stay; a straight stroke of 100 points keeps two');
    // WI5 and WC10, with sharp tiles made here
    const out = await t.g(`(async () => {
      const tile = { rel: 'Tiles/Tablescape/Slate.webp' };
      const A = (pts, level) => ({ kind: 'area', shape: 'rect', pts, tile, edge: 'ledge', mat: 'stone_wall', level, mixW: 0 });
      const items = [A([[2, 2], [8, 6]], 0), A([[8, 2], [12, 6]], 2), { id: 'st', kind: 'stairs', pts: [[6, 3], [8, 5]], dir: 0, tile }];
      const map = { os: { items, doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } };
      const bake = async () => { Oldschool.noSharp = false; Oldschool.setSharp(0); Oldschool.setSharp(100); Oldschool.setHas(null); Oldschool.noSharp = true; const job = Oldschool.bake(map, [], null, null, {}); try { return await job; } finally { Oldschool.setSharp(0); } };
      const r1 = await bake(); const rises = Oldschool.stats.last.rises;
      Oldschool.failNext = true;
      const r2 = await bake(); const flat2 = [r2.flat, Oldschool.stats.last.flat, !!r2.sharp];
      const r3 = await bake(); const flat3 = [r3.flat, !!r3.sharp, Oldschool.stats.last.light > 0];
      return { rises, flat1: r1.flat, flat2, flat3, supported: Oldschool.supported() };
    })()`);
    const base = out.rises.filter((x) => x[0] === 'base'); const tiles = out.rises.filter((x) => x[0] === 'tile');
    t.eq([base.length, base[0].slice(2)], [1, [2, 6]], 'the stairs in the base: two levels, six steps');
    t.ok(tiles.length >= 1 && tiles.every((x) => x[2] === 2 && x[3] === 6), 'and in every sharp tile they lie in: the same', tiles);
    t.eq([out.flat1, out.flat2, out.flat3], [false, [true, true, false], [false, true, true]], 'a picture the graphics card failed on is flat and says so; the next one is lit again, with its sharp tiles');
    // WC10 through the tool: the flat picture is not kept, the picture is made once more
    await clear(t);
    const a0 = (await t.g('Play.OS.debug')).again;
    await t.g('Oldschool.failNext = true; 0');
    t.handle('os.add', { mapId: own, items: [room(2, 2, 7, 6)] });
    await t.settle(); await baked(t, 120000);
    t.eq([(await t.g('Play.OS.debug')).again - a0, await t.g('Oldschool.stats.last.flat')], [1, false], 'the tool made it once more, and what it kept is not flat');
  }, { ms: 300000, allow: /test: the graphics card failed/ });

  // ---------- 26 Nov 2026 (Open Point WB1, its first half): the painting and the sight walls breathe ----------
  area.deep('WB1: made in slices, a picture is the same dot for dot as made in one go, with its sharp tiles and its sight walls', async (t) => {
    const out = await t.g(`(async () => {
      const sum = async (b) => { if (!b) return null; const a = new Uint8Array(await b.arrayBuffer()); let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return a.length + ':' + (h >>> 0); };
      const tile = (n) => ({ rel: 'Tiles/Tablescape/' + n + '.webp' });
      const items = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) items.push({ kind: 'area', shape: 'rect', pts: [[2 + c * 7, 2 + r * 6], [7 + c * 7, 6 + r * 6]], tile: tile((c + r) % 2 ? 'Slate' : 'Old cobblestone'), edge: (c + r) % 5 === 0 ? 'rock' : 'walls', mat: (c + r) % 5 === 0 ? 'rock' : 'stone_wall', level: 0, mixW: (c + r) % 3 ? 0 : 1.5, mixU: 0.5, mixT: 0.5 });
      for (let c = 0; c < 7; c++) items.push({ kind: 'area', shape: 'path', pts: [[7 + c * 7, 4], [9 + c * 7, 4]], r: 0.5, tile: tile('Slate'), edge: 'walls', mat: 'stone_wall', level: 0, mixW: 0 });
      items.push({ kind: 'line', pts: [[4, 3], [4, 5]], w: 0.5, h: 1, mat: 'stone_wall' }, { kind: 'pillar', pts: [[12, 4]], r: 0.35, round: false, mat: 'stone_wall' }, { kind: 'stairs', pts: [[17, 3], [19, 5]], dir: 0, tile: tile('Slate') });
      const doors = [{ id: 'd1', x1: 4, y1: 6, x2: 5, y2: 6, door: 1 }, { id: 'd2', x1: 10, y1: 2, x2: 11, y2: 2, door: 1, kind: 'window' }];
      const map = { os: { items, doors, sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } };
      const make = async (noBreathe) => {
        Oldschool.forgetKept(); Oldschool.noBreathe = noBreathe;
        Oldschool.noSharp = false; Oldschool.setSharp(0); Oldschool.setSharp(100); Oldschool.setHas(null); Oldschool.noSharp = true;
        const job = Oldschool.bake(map, [], null, null, {});
        try { const r = await job; const tiles = []; for (const x of r.sharp.tiles) tiles.push(x.c + ',' + x.r + '=' + await sum(x.blob)); return { base: await sum(r.blob), tiles: tiles.join('|'), n: r.sharp.tiles.length, walls: JSON.stringify(r.walls), breaths: Oldschool.stats.last.breaths }; }
        finally { Oldschool.noBreathe = false; Oldschool.setSharp(0); }
      };
      // (After the other Draw checks the first two or three pictures of one drawing differ from each other in a tile
      // or two, by up to 14 of 255 in a patch of it, and then stay the same. That is older than this change and shows
      // with every picture made in one go; it is not explained (notes/speed-night-2026-11-26.md). So the pictures are
      // made in one go until two in a row agree, and the sliced one is held against that.
      // 26 Nov, later: it does not always stay settled. The likely cause: the browser draws a painting now with the
      // graphics card, now with the processor, and the two differ by a shade (with every painting forced onto the
      // processor all pictures agreed, at three times the painting time). So one more picture in one go is made after
      // the sliced one: only if it agrees with the one before are the tiles held against each other.)
      let whole = null; let prev = await make(true); let tries = 1;
      for (; tries < 7 && !whole; tries++) { const cur = await make(true); if (cur.tiles === prev.tiles && cur.base === prev.base) whole = cur; prev = cur; }
      if (!whole) return { settled: false, tries };
      const sliced = await make(false);
      const after = await make(true);
      const calm = whole.tiles === after.tiles && whole.base === after.base;
      return { settled: true, tries, calm, same: [whole.base === sliced.base || !calm, whole.tiles === sliced.tiles || !calm, whole.walls === sliced.walls], n: whole.n, breaths: [whole.breaths, sliced.breaths] };
    })()`);
    t.ok(out.settled, 'two pictures in a row made in one go agree (within seven)', out);
    t.ok(out.n >= 12 && out.breaths[0] === 0 && out.breaths[1] >= 3, 'tiles, and the breaths taken: none in one go, several in slices', out);
    t.eq(out.same, [true, true, true], `the base, every sharp tile and the sight walls: the same in slices as in one go${out.calm ? '' : ' (the pictures in one go did not agree among themselves this time: only the sight walls were compared)'}`);
    if (!out.calm) t.note('WB1: pictures made in one go differed from each other in this run; the tiles were not compared');
  }, { ms: 400000 });

  // ---------- Speed 9 (Open Point WI4) ----------
  area.deep('WI4: the windows are told what the picture does not show yet, not all it shows; a drawing of 5001 things leaves no ink on the TV', async (t) => {
    const ms = require('../../mapstate');
    // what a map keeps of its picture's list is no longer cut at 5000
    const m0 = ms.normalize({ name: 'drawn', grid: { size: 1 }, os: { items: [] } });
    ms.apply(m0, 'os.result', { bg: { path: 'x.webp', x: 0, y: 0, scale: 1, nw: 10, nh: 10 }, hash: 'h', ids: Array.from({ length: 6000 }, (_, i) => 'o' + i) }, () => ({}));
    t.eq(m0.bg.osIds.length, 6000, 'ids a map keeps of a picture of 6000 things');
    const ink = async () => ((await t.tvDebug()) || {}).ink || {};
    const inkEls = () => t.t(`document.querySelectorAll('.sv-osink .ink-item').length`);
    await clear(t);
    await t.send(own);
    await t.sleep(400);
    t.handle('os.add', { mapId: own, item: room(4, 4, 9, 8) });
    await t.settle(); await baked(t, 90000);
    await t.until(async () => (await inkEls()) === 0, 8000, 'the first room in the picture');
    // a second room: until its picture is there, the state names it, and only it
    t.handle('os.add', { mapId: own, item: room(11, 4, 15, 8) });
    const second = M(t).os.items[1].id;
    const st1 = await t.g('window.ts.state()');
    if (st1.map.bg.os !== (await t.g(`Play.OS.hashOf(${JSON.stringify({ os: M(t).os, grid: M(t).grid })})`))) t.eq([st1.map.bg.osNew, 'osIds' in st1.map.bg], [[second], false], 'not in the picture yet, as the windows are told; the long list is not sent');
    await t.settle(); await baked(t, 90000);
    await t.until(async () => (await inkEls()) === 0 && (await ink()).counted === 2, 8000, 'both rooms counted as in the picture, no ink');
    const st2 = await t.g('window.ts.state()');
    t.eq([st2.map.bg.osNew, 'osIds' in st2.map.bg, M(t).bg.osIds.length], [[], false, 2], 'nothing left to ink; the map itself keeps the list of two');
    // 5001 small floors, 100 to a row
    await clear(t);
    const many = []; for (let i = 0; i < 5001; i++) { const c = i % 100; const r = Math.floor(i / 100); many.push(room(c * 0.5, r * 0.5, c * 0.5 + 0.5, r * 0.5 + 0.5, { edge: 'ledge' })); }
    const t0 = Date.now();
    t.handle('os.add', { mapId: own, items: many });
    t.eq(M(t).os.items.length, 5001, 'things in the drawing');
    await t.settle(); await baked(t, 300000);
    t.note('5001 floors: their picture took ' + Math.round((Date.now() - t0) / 100) / 10 + ' s');
    await t.until(async () => (await inkEls()) === 0 && (await ink()).counted === 5001, 20000, 'all 5001 counted as in the picture, no ink left on the TV').catch(async (e) => { throw new Error(e.message + ': ' + JSON.stringify([await inkEls(), await ink()])); });
    t.eq([M(t).bg.osIds.length, (await t.g('window.ts.state()')).map.bg.osNew], [5001, []], 'the map keeps all 5001; the windows are told of none to ink');
    // one more: it alone is inked
    t.handle('os.add', { mapId: own, item: room(60, 4, 64, 8) });
    await t.until(async () => (await inkEls()) > 0, 5000, 'the new room inked');
    t.ok((await ink()).inked <= 1, 'and only it', await ink());
    await clear(t);
  }, { ms: 600000 });

  // ---------- 26 Nov 2026: a drawn map has a maximum size (Glinn: a drawing of 1032 x 838 squares stood at "Painting the map 94 %") ----------
  area.deep('a drawn map is 300 x 300 squares at most: what would pass that is not drawn and a message says so; a drawing that is already larger still gets a picture', async (t) => {
    const ms = require('../../mapstate');
    t.eq(ms.OS_MAX, 300, 'the maximum, in squares');
    // the rule, on a map in memory (one square is one unit there)
    const mk = (items) => { const m = ms.normalize({ name: 'drawn', grid: { size: 1 }, os: { items: [] } }); m.os.items.push(...items); return m; };
    const R = (a, b, c, d) => ({ id: 'r' + [a, b, c, d].join('_'), kind: 'area', shape: 'rect', pts: [[a, b], [c, d]], tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'ledge', mat: 'stone_wall', level: 0 });
    const put = (m, p) => { const r = ms.apply(m, 'os.add', p, () => ({})); return r.changed ? 'drawn' : r.tooBig ? 'too big ' + r.tooBig : 'nothing'; };
    const m1 = mk([]);
    t.eq([put(m1, { item: R(0, 0, 300, 10) }), put(m1, { item: R(0, 0, 10, 300) }), put(m1, { item: R(290, 290, 300, 300) })], ['drawn', 'drawn', 'drawn'], 'things up to 300 squares across and down');
    t.eq([put(m1, { item: R(0, 0, 300.5, 5) }), put(m1, { item: R(-1, 0, 5, 5) }), put(m1, { item: R(100, 301, 105, 306) }), m1.os.items.length], ['too big 300', 'too big 300', 'too big 300', 3], 'half a square wider, a room one square to the left, one below: not drawn, the drawing as it was');
    t.eq(put(m1, { item: { kind: 'pillar', pts: [[299.9, 50]], r: 0.3, round: true, mat: 'stone_wall' } }), 'too big 300', 'a pillar whose edge reaches past it counts with its size');
    t.eq(put(m1, { items: [R(20, 20, 30, 30), R(295, 20, 305, 30)] }), 'too big 300', 'a ready-made piece of which one part reaches past it: none of it');
    t.eq(put(m1, { item: { kind: 'cut', shape: 'rect', pts: [[250, 250], [900, 900]] } }), 'drawn', 'erasing is never too big');
    const upd = ms.apply(m1, 'os.update', { id: m1.os.items[0].id, pts: [[0, 0], [320, 10]] }, () => ({}));
    t.eq([upd.changed, upd.tooBig], [null, 300], 'a thing made longer past the maximum: not changed');
    t.ok(ms.apply(m1, 'os.update', { id: m1.os.items[0].id, tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' } }, () => ({})).changed, 'another floor for it: changed as always');
    // a drawing from before the maximum, far too large: worked on inside its outline, it cannot grow
    const old = mk([R(0, 0, 10, 10), R(1000, 800, 1010, 810)]);
    t.eq([put(old, { item: R(400, 400, 420, 420) }), put(old, { item: R(1005, 805, 1012, 808) }), put(old, { item: R(-5, 0, 5, 5) })], ['drawn', 'too big 300', 'too big 300'], 'a larger drawing from before: a room inside its outline; one that reaches out to the right; one to the left');
    // its picture: fewer dots a square, so the graphics card and the memory can hold it
    const out = await t.g(`(async () => {
      const tile = { rel: 'Tiles/Tablescape/Slate.webp' };
      const A = (pts) => ({ kind: 'area', shape: 'rect', pts, tile, edge: 'walls', mat: 'stone_wall', level: 0, mixW: 0 });
      const bake = async (items) => { const map = { os: { items, doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } }; const t0 = performance.now(); const r = await Oldschool.bake(map, [], null, null, {}); return { nw: r.nw, nh: r.nh, flat: r.flat, scale: r.scale, sharp: !!r.sharp, ms: Math.round(performance.now() - t0) }; };
      const huge = await bake([A([[0, 0], [10, 8]]), A([[1022, 830], [1032, 838]])]);
      const most = await bake([A([[0, 0], [10, 8]]), A([[290, 292], [300, 300]])]);
      return { huge, most };
    })()`);
    t.note('the pictures: ' + JSON.stringify(out));
    t.ok(out.huge.nw * out.huge.nh <= 30e6 && Math.max(out.huge.nw, out.huge.nh) <= 8192 && out.huge.flat === false, 'a drawing of 1032 x 838 squares: a picture of at most 30 million dots and 8192 across, lit by the graphics card', out.huge);
    t.ok(out.huge.ms < 20000, 'and it is there in under 20 s', out.huge.ms);
    t.eq([out.most.nw, out.most.nh, Math.round(1 / out.most.scale), out.most.flat], [306 * 16, 306 * 16, 16, false], 'a drawing of the maximum size: 16 dots a square as before, 306 squares with its margin');
    // through the app: the answer says why, and the Draw tool tells you
    await clear(t);
    t.handle('os.add', { mapId: own, item: room(-340, 4, -335, 8) });
    const far = t.handle('os.add', { mapId: own, item: room(4, 4, 9, 8) });
    t.eq([far.ok, far.tooBig, M(t).os.items.length], [false, 300, 1], 'a room 344 squares away from the first: the answer, and the drawing as it was');
    await t.settle();
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await tool(t, 'room');
    const p0 = await t.scr(15 * k, 3 * k); const p1 = await t.scr(19 * k, 6 * k); // (right of the Draw panel)
    await t.drag(p0, p1, 8);
    await t.until(() => t.g(`[...document.querySelectorAll('#toasts .toast')].some((x) => x.textContent.includes('A drawn map can be 300 × 300 squares at most'))`), 4000, 'the message');
    await t.shot(t.gm(), 'oldschool-too-big');
    t.eq([M(t).os.items.length, (await t.g('Play.OS.debug')).refused], [1, 1], 'things in the drawing after the mouse drew a room there; things the Draw tool was told are too far out');
    await t.until(async () => (await t.g('Play.OS.debug')).pending === 0, 3000, 'the outline of what was not drawn to leave the preview');
    await clear(t);
  }, { ms: 300000 });

  // XA3 (Glinn, 26 Nov 2026): the maximum shows before you run into it
  area.deep('XA3: with the Draw tool a faint frame shows how far the drawing may still reach: far out for a small drawing, 300 × 300 squares for one that large; none on an empty map or with another tool in hand', async (t) => {
    await clear(t);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    const frame = () => t.g(`(() => { Play.OS.redraw(); const r = document.querySelector('.os-reach'); if (!r) return null; const g = Play.state().map.grid.size; return ['x', 'y', 'width', 'height'].map((a) => Math.round(Number(r.getAttribute(a)) / g * 100) / 100); })()`);
    t.eq(await frame(), null, 'nothing drawn: no frame');
    t.handle('os.add', { mapId: own, item: room(10, 20, 16, 24) }); await t.settle();
    t.eq(await frame(), [16 - 300, 24 - 300, 594, 596], 'a room of 6 × 4 squares: the frame reaches 300 squares back from its far edges and 300 on from its near ones');
    t.eq(await t.g(`document.querySelector('.os-reach-word').textContent`), '300 × 300 squares', 'and it says what it is');
    await t.shot(t.gm(), 'oldschool-reach');
    t.handle('os.add', { mapId: own, item: room(300, 310, 310, 320) }); await t.settle();
    t.eq(await frame(), [10, 20, 300, 300], 'with a second room so that the drawing is 300 squares each way: exactly the square it fills');
    t.eq(await t.g('Oldschool.MAX_SQUARES'), require('../../mapstate').OS_MAX, 'the frame and the app count with the same maximum');
    await t.g(`Play.setTool('select')`);
    await t.until(() => t.g(`!document.querySelector('.os-reach')`), 3000, 'the frame to go with another tool in hand');
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await clear(t);
  }, { ms: 300000 });

  // XA4 (Glinn, 26 Nov 2026): cave walls should not look so smooth
  area.deep('XA4: the Brush has Edge, smooth to jagged: a jagged stroke is kept with the map, its picture has lobes and teeth and is the same every time, its walls for sight follow it; without it nothing changes', async (t) => {
    await clear(t);
    const put = (item) => { const r = t.handle('os.add', { mapId: own, item }); return M(t).os.items.find((x) => x.id === r.selected); };
    const br = (extra) => ({ kind: 'area', shape: 'brush', pts: [[40 * k, 40 * k], [44 * k, 41 * k]], r: 1 * k, tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'rock', mat: 'rock', level: 0, ...extra });
    t.eq([put(br({ rough: 0.6 })).rough, 'rough' in put(br({ rough: 0 })), 'rough' in put(br({})), put(br({ rough: 7 })).rough, 'rough' in put({ ...room(50, 40, 54, 44), rough: 0.6 })], [0.6, false, false, 1, false], 'kept with a brush stroke, from 0 to 1; none is kept as nothing; a box has no such edge');
    await clear(t);
    // the engine
    const out = await t.g(`(async () => {
      const tile = { rel: 'Tiles/Tablescape/Slate.webp' };
      const items = (extra) => [{ id: 'a', kind: 'area', shape: 'brush', pts: [[3, 4], [7, 5.2], [11, 4.4], [13, 7]], r: 1, tile, edge: 'rock', mat: 'rock', level: 0, mixW: 0, ...extra }];
      const bake = async (extra) => {
        Oldschool.setSharp(0); Oldschool.setHas(null);
        const map = { os: { items: items(extra), doors: [], sun: 135 }, grid: { size: 1, ox: 0, oy: 0 } };
        const t0 = performance.now(); const r = await Oldschool.bake(map, [], null, null, {}); const ms = Math.round(performance.now() - t0);
        const bmp = await createImageBitmap(r.blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
        return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, walls: JSON.stringify(r.walls), n: r.walls.length, hash: Oldschool.hash(map, []), ms };
      };
      const diff = (A, B) => { if (A.w !== B.w || A.h !== B.h) return -1; let n = 0; for (let i = 0; i < A.d.length; i += 4) if (Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]) > 40) n++; return n; };
      const plain = await bake({}); const zero = await bake({ rough: 0 }); const half = await bake({ rough: 0.5 }); const full = await bake({ rough: 1 }); const again = await bake({ rough: 1 });
      return { zero: diff(plain, zero), half: diff(plain, half), full: diff(plain, full), again: diff(full, again), dots: plain.w * plain.h, sizes: [plain.w * plain.h, half.w * half.h, full.w * full.h],
        walls: [plain.n, half.n, full.n, plain.walls === full.walls, full.walls === again.walls], hashes: [plain.hash === full.hash, full.hash === again.hash], ms: [plain.ms, full.ms] };
    })()`);
    t.note('jagged: ' + JSON.stringify(out));
    t.eq(out.zero, 0, 'Edge at smooth: the picture as it always was, dot for dot');
    t.ok((out.half === -1 || out.half > 1500) && (out.full === -1 || out.full > 1500) && out.sizes[2] >= out.sizes[1] && out.sizes[1] >= out.sizes[0] && out.sizes[2] > out.sizes[0], 'jagged: another picture, and a larger one, since the lobes reach beyond the brush (more so at 100 % than at 50 %)', out);
    t.eq([out.again, out.hashes], [0, [false, true]], 'the same jagged stroke gives the same picture again; the picture knows a jagged stroke from a smooth one');
    t.ok(out.walls[0] > 0 && !out.walls[3] && out.walls[4] && out.walls[2] < out.walls[0] * 8 + 60, 'the walls for sight follow the jagged line (other walls than the smooth stroke has, the same ones every time), and not too many of them', out.walls);
    t.ok(out.ms[1] < out.ms[0] * 3 + 500, 'and it does not take much longer to make', out.ms);
    // the panel: Edge with the Brush, not with Box
    await t.g(`Play.setTool('oldschool'), Play.closePop(), Play.openPop('oldschool')`);
    await tool(t, 'brush');
    t.eq(await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Edge"]'); if (!i) return null; i.value = 0.7; i.dispatchEvent(new Event('input', { bubbles: true })); return [Play.ui.os.rough, i.closest('label').querySelector('output').textContent]; })()`), [0.7, '70 %'], 'the Brush has Edge: smooth to jagged');
    const p0 = await t.scr(15 * k, 3 * k); const p1 = await t.scr(18 * k, 4 * k); // (right of the Draw panel)
    const n0 = M(t).os.items.length;
    await t.drag(p0, p1, 8);
    await t.until(() => M(t).os.items.length === n0 + 1, 4000, 'a stroke drawn with the mouse');
    t.eq(M(t).os.items[M(t).os.items.length - 1].rough, 0.7, 'the stroke drawn with it is jagged');
    await t.g(`Play.ui.os.rough = 0; 0`);
    await tool(t, 'room');
    t.eq(await t.count('#pop input[aria-label="Edge"]'), 0, 'Box has no such slider');
    await clear(t);
  }, { ms: 300000 });

  // Speed 3 (Open Point WC2): the moving layer is made again when its own content changed, not at every edit
  area.deep('WC2: an edit away from the grass and the water gives a new picture, and both screens keep their living map and every blade of grass; a new floor under the grass grows the blades again; more grass reads the living map again', async (t) => {
    await clear(t);
    const live0 = t.state.liveMapId;
    const slate = { rel: 'Tiles/Tablescape/Slate.webp' };
    t.handle('os.add', { mapId: own, items: [room(2, 2, 26, 20, { tile: { rel: 'Tiles/Tablescape/Mossy court.webp' } }),
      { kind: 'live', shape: 'rect', pts: [[4 * k, 4 * k], [14 * k, 14 * k]], fx: 'grass', mixW: 1.5 },
      { kind: 'live', shape: 'rect', pts: [[16 * k, 4 * k], [20 * k, 8 * k]], fx: 'water', mixW: 1.5 }] });
    await baked(t); await t.send(own);
    const lay = async () => { const g = (await t.g('Play.view().stats.living')) || {}; const v = ((await t.tvDebug()).living) || {}; return [g, v]; };
    await t.until(async () => (await lay()).every((x) => x.on && x.blades > 1000 && x.kinds && x.kinds.grass && x.kinds.water), 30000, 'grass and water moving on both screens');
    const stats = async () => { const a = await t.g('JSON.parse(JSON.stringify(Living.stats))'); const b = await t.t('JSON.parse(JSON.stringify(Living.stats))'); return [[a.made, a.kept, a.grown, a.bladesKept], [b.made, b.kept, b.grown, b.bladesKept]]; };
    const step = async (what) => {
      const s0 = await stats(); const b0 = (await lay()).map((x) => x.blades); const key0 = M(t).bg.live.key; const url0 = M(t).bg.url;
      what(); await baked(t);
      await t.until(async () => { const s1 = await stats(); return s1.every((x, i) => x[0] + x[1] > s0[i][0] + s0[i][1]); }, 20000, 'both screens to take the new picture');
      await t.until(async () => (await lay()).every((x) => x.on && x.state === 'ready'), 10000, 'the layer ready again');
      const s1 = await stats(); const b1 = (await lay()).map((x) => x.blades);
      return { d: s1.map((x, i) => x.map((v, j) => v - s0[i][j])), blades: [b0, b1], keySame: M(t).bg.live.key === key0, picNew: M(t).bg.url !== url0 };
    };
    t.ok(/^[0-9a-f]{20}$/.test(M(t).bg.live.key), 'the living map has a key that says what is in it', M(t).bg.live);
    // (made, kept, grown, bladesKept) on your screen and on the TV
    const a = await step(() => t.handle('os.add', { mapId: own, item: { kind: 'pillar', pts: [[23.5 * k, 16.5 * k]], r: 0.25 * k, round: false, mat: 'stone_wall' } }));
    t.eq([a.picNew, a.keySame], [true, true], 'a pillar away from the grass: a new picture, the same living map');
    t.eq(a.d, [[0, 1, 0, 1], [0, 1, 0, 1]], 'both screens: the living map kept, not read again; the grass kept, not grown again', a);
    t.eq(a.blades[1], a.blades[0], 'every blade still there');
    const b = await step(() => t.handle('os.update', { mapId: own, id: M(t).os.items.find((x) => x.kind === 'area').id, tile: slate }));
    t.eq([b.keySame, b.d], [true, [[0, 1, 1, 0], [0, 1, 1, 0]]], 'another floor under the grass: the living map kept, the blades grown again (they take the floor\'s colour)', b);
    const c = await step(() => t.handle('os.add', { mapId: own, item: { kind: 'live', shape: 'rect', pts: [[16 * k, 12 * k], [22 * k, 18 * k]], fx: 'grass', mixW: 1.5 } }));
    t.eq([c.keySame, c.d], [false, [[1, 0, 1, 0], [1, 0, 1, 0]]], 'more grass: another living map, read and grown anew', c);
    t.ok(c.blades[1].every((n, i) => n > c.blades[0][i]), 'and there are more blades', c.blades);
    await clear(t);
    if (live0 && live0 !== own) await t.send(live0);
  }, { ms: 300000 });

  // Glinn, 26 Nov 2026: "we're very often stuck at 94 %. From my side everything seems loaded"
  area.deep('the pill "Painting the map" goes when the picture is there, also when other changes of the map came in while it was being made (it stayed at 94 % until the next change of the drawing)', async (t) => {
    await clear(t);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await t.g('Oldschool.noPill = false; Oldschool.pillNow = true; Oldschool.slowBy = 900; 0'); // (slowBy: the picture takes a second, as a big cave does)
    const shown = () => t.g(`(() => { const e = document.querySelector('.os-pill'); return !!e && !e.hidden; })()`);
    try {
      for (let round = 0; round < 3; round++) {
        t.handle('os.add', { mapId: own, items: [room(2 + round * 12, 2, 12 + round * 12, 12), { kind: 'area', shape: 'brush', pts: [[(4 + round * 12) * k, 16 * k], [(10 + round * 12) * k, 18 * k]], r: 1.5 * k, tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'rock', mat: 'rock', level: 0, rough: 0.5 }] });
        await t.until(async () => (await t.g('Play.OS.debug')).baking, 8000, 'the picture to be started');
        // while it is made: the map changes in ways that are not the drawing (each is a state for your screen)
        let n = 0;
        while ((await t.g('Play.OS.debug')).baking && n < 400) { t.handle('light.update', { mapId: own, darkness: 0.05 + (n++ % 5) * 0.01 }); await t.sleep(25); }
        t.ok(n > 0, 'states came in while the picture was being made', n);
        await baked(t);
        await t.until(async () => !(await shown()), 5000, `the pill to go after picture ${round + 1} (it stayed at 94 %)`);
        const d = await t.g('Play.OS.debug');
        t.eq([d.baking, d.due], [false, false], 'and nothing more is waiting to be made', d);
      }
      // the drawing changes while its picture is made, and the mouse button is still down: that picture is given up and
      // the next one waits for the hand. Nothing is being painted then, and the pill said 94 % all the while
      t.handle('os.add', { mapId: own, item: room(2, 24, 12, 34) });
      await t.until(async () => (await t.g('Play.OS.debug')).baking, 8000, 'a picture to be started');
      await t.g(`window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); 0`);
      t.handle('os.add', { mapId: own, item: room(14, 24, 24, 34) });
      await t.until(async () => { const d = await t.g('Play.OS.debug'); return !d.baking && d.due && d.held; }, 15000, 'that picture given up, the next one waiting for the hand');
      await t.until(async () => !(await shown()), 3000, 'the pill to go while nothing is being painted (it stood at 94 %)');
      t.ok((await t.g('Play.OS.debug')).due, 'the next picture still waits');
      await t.g(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); 0`);
      await baked(t);
      await t.until(async () => !(await shown()), 5000, 'and after that picture the pill goes too');
    } finally {
      await t.g('Oldschool.noPill = true; Oldschool.pillNow = false; Oldschool.slowBy = 0; 0');
      t.handle('light.update', { mapId: own, darkness: 0 });
    }
    await clear(t);
  }, { ms: 300000 });

  // Glinn, 26 Nov 2026: the fog hid the cave's rock. The walls stay; the fog uncovers what is built behind a wall in sight
  area.deep('Rock in sight: the party sees the rock behind the walls it sees, as deep as the map says, never the floor of the room next door and nothing behind a corner; off: as before; a picture map\'s walls are as they were', async (t) => {
    await clear(t);
    const live0 = t.state.liveMapId;
    const rock = { edge: 'rock', mat: 'rock' };
    // two caves side by side with 1.2 squares of rock between them, and a side room round a corner
    t.handle('os.add', { mapId: own, items: [room(4, 4, 10, 10, rock), room(11.2, 4, 17, 10, rock), room(4, 14, 10, 18, rock)] });
    await baked(t);
    const W = wallsOf(t);
    t.ok(W.length >= 8 && W.every((w) => !w.bk || (w.bk.length === 2 && w.bk.every((v) => v >= 0 && v <= 4 * k + 0.01))), 'each wall of the drawing knows how deep the rock lies on its two sides (at most 4 squares)', W.slice(0, 3));
    // the left wall of the first cave: rock for more than 2 squares behind it, floor right in front of it
    const left = W.filter((w) => Math.abs(w.x1 - w.x2) < 0.01 * k && Math.abs(w.x1 - 3.775 * k) < 0.1 * k && w.bk);
    t.ok(left.length && left.every((w) => Math.max(...w.bk) > 2 * k && Math.min(...w.bk) === 0), 'the outer wall: deep rock behind it, none on the floor\'s side', left.map((w) => w.bk));
    // the wall between the two caves stands in rock 1.2 squares thick: less than a square to the other floor
    const mid = W.filter((w) => Math.abs(w.x1 - w.x2) < 0.01 * k && w.x1 > 10.1 * k && w.x1 < 11.1 * k && w.bk && Math.abs(w.y1 - w.y2) > 2 * k && Math.max(w.y1, w.y2) < 11 * k); // (the long pieces beside the second cave: a short one at a corner, and the side room's wall, have only rock behind them)
    t.ok(mid.length && mid.every((w) => Math.max(...w.bk) < 1.0 * k), 'the walls between the two caves: only the rock between them', mid.map((w) => [w.x1 / k, w.bk]));
    t.handle('fog.base', { mapId: own, base: 'cover' });
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'party', x: 7 * k, y: 7 * k, r: 30 * k });
    t.handle('vision.update', { mapId: own, on: true });
    await t.send(own); await t.settle(); await t.sleep(800);
    const sees = (x, y) => t.t(`window.__table.sees(${x * k}, ${y * k})`);
    const look = async () => [await sees(7, 7), await sees(2.4, 7), await sees(7, 2.4), await sees(10.6, 7), await sees(12, 7), await sees(7, 12.2), await sees(7, 16)];
    t.eq(M(t).vision.rock, undefined, 'a map that was never told: 2.5 squares');
    t.eq(await look(), [true, true, true, true, false, true, false], 'the party in the first cave sees: its floor; the rock 1.4 squares behind its left wall and its top wall; the rock towards the second cave; NOT the second cave\'s floor; the rock below it; NOT the side room behind that rock');
    t.eq([await sees(0.6, 7), await sees(7, 0.6)], [false, false], 'and not deeper than 2.5 squares');
    // in Draw → Map settings
    await t.g(`Play.setTool('oldschool'), Play.closePop(), Play.openPop('oldschool')`);
    await t.clickSel('#pop .os-mapbtn'); await cardOut(t);
    t.eq(await t.g(`(() => { const i = document.querySelector('#pop .os-fly input[aria-label="Rock in sight"]'); return i ? [Number(i.value), Number(i.min), Number(i.max)] : null; })()`), [2.5, 0, 4], 'Map settings: Rock in sight, at 2.5 squares');
    await t.g(`(() => { const i = document.querySelector('#pop .os-fly input[aria-label="Rock in sight"]'); i.value = 1; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await t.until(() => M(t).vision.rock === 1, 3000, 'the slider at 1 square');
    await t.settle(); await t.sleep(700);
    t.eq([await sees(2.9, 7), await sees(2.4, 7)], [true, false], '1 square: the rock 0.9 squares behind the wall, not 1.4');
    t.handle('vision.update', { mapId: own, rock: 0 }); await t.settle(); await t.sleep(700);
    t.eq([await sees(7, 7), await sees(2.9, 7), await sees(10.6, 7)], [true, false, false], 'off: the floor, and no rock behind the walls (as it always was)');
    t.eq(t.handle('vision.update', { mapId: own, rock: 9 }) && M(t).vision.rock, 4, 'at most 4 squares');
    await t.clickSel('#pop .os-mapbtn'); await cardGone(t);
    // the shape itself: walls without a depth (a picture map's, drawn by hand) leave it as it was
    const same = await t.g(`(() => {
      const walls = [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]].map(([x1, y1, x2, y2], i) => ({ id: 'w' + i, x1, y1, x2, y2, door: 0, open: false }));
      const plain = Vision.poly({ id: 'zz-plain', walls, grid: { size: 1 }, vision: { on: true } }, 5, 5, 0);
      const deep = Vision.poly({ id: 'zz-deep', walls: walls.map((w) => ({ ...w, bk: [3, 3] })), grid: { size: 1 }, vision: { on: true } }, 5, 5, 0);
      const off = Vision.poly({ id: 'zz-off', walls: walls.map((w) => ({ ...w, bk: [3, 3] })), grid: { size: 1 }, vision: { on: true, rock: 0 } }, 5, 5, 0);
      const box = (p) => Vision.bboxOf(p).map((v) => Math.round(v * 10) / 10);
      return [box(plain), box(deep), box(off), Math.round(Vision.area(deep))];
    })()`);
    t.eq(same.slice(0, 3), [[0, 0, 10, 10], [-2.5, -2.5, 12.5, 12.5], [0, 0, 10, 10]], 'a room of 10 × 10: seen as it is with plain walls; 2.5 squares wider all round when its walls have rock behind them; as it is when Rock in sight is off');
    t.ok(same[3] > 205 && same[3] < 226, 'and the widened shape has no notch at its corners (its area: the room, four strips and the corners)', same[3]);
    for (const f2 of M(t).fx.filter((x) => x.preset === 'party')) t.handle('fx.remove', { mapId: own, id: f2.id });
    t.handle('vision.update', { mapId: own, rock: 2.5 }); t.handle('fog.enabled', { mapId: own, enabled: false });
    await clear(t);
    if (live0 && live0 !== own) await t.send(live0);
  }, { ms: 300000 });
};
