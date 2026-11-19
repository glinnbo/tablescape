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
  const wallsOf = (t) => M(t).walls.filter((w) => w.os);
  const clear = async (t) => { t.handle('os.clear', { mapId: own }); await t.settle(); await baked(t); };
  // the picture of what is drawn now has come back from the GM screen
  const baked = (t, ms = 30000) => t.until(async () => {
    const m = M(t); if (!m || !m.os) return false;
    const want = await t.g(`Play.OS.hashOf(${JSON.stringify({ os: m.os, grid: m.grid })})`);
    if (!m.os.items.length) return !m.bg ? true : false;
    return m.bg && m.bg.os === want && fs.existsSync(m.bg.path) && m;
  }, ms, 'the picture of the drawing');
  const room = (x0, y0, x1, y1, extra = {}) => ({ kind: 'area', shape: 'rect', pts: [[x0 * k, y0 * k], [x1 * k, y1 * k]], tile: { rel: 'Tiles/Tablescape/Old cobblestone.webp' }, edge: 'walls', mat: 'stone_wall', level: 0, ...extra });

  area.before(async (K) => {
    await K.openDemo();
    await K.until(() => K.g('!!document.createElement("canvas").getContext("webgl2")'), 8000, 'WebGL on your screen');
  });

  area.quick('the tiles come with the app: eleven floors in Library → Tiles, five materials for walls, rock and cliffs', async (t) => {
    const list = t.lib('tiles').filter((x) => x.builtin);
    t.eq(list.length, 11, 'floors in the library');
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
    t.eq(await t.count('.os-tools .tile'), 11, 'its tools');
    t.ok(await t.count('.os-floors .tile[data-v]') >= 11, 'the floors of the app');
    t.ok(await t.g(`!!document.querySelector('.map-tile[data-id="${own}"] .tile-thumb .i')`), 'its tile in the strip shows a pencil');
  });

  area.quick('a room dragged on the grid becomes the map\'s picture, on the TV too; its outline the walls for sight', async (t) => {
    await t.cmd('edit.open', { id: own });
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await t.clickSel('.os-tools .tile[data-v="room"]');
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
  }, { ms: 90000 });

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
  }, { ms: 90000 });

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
  }, { ms: 60000 });

  area.deep('the Draw panel: each tool, a floor, the edge, where the light comes from', async (t) => {
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await t.g(`localStorage.removeItem('osPrefs')`);
    for (const id of ['shape', 'round', 'corridor', 'brush', 'erase', 'floor', 'wall', 'pillar', 'stairs', 'door', 'room']) {
      await t.clickSel(`.os-tools .tile[data-v="${id}"]`);
      t.eq(await t.g('Play.ui.os.tool'), id, `tool ${id}`);
    }
    await t.clickSel('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]');
    t.eq(await t.g('Play.ui.os.floor.rel'), 'Tiles/Tablescape/Slate.webp', 'a floor picked');
    t.ok(await t.g(`document.querySelector('.os-floors .tile[data-v="Tiles/Tablescape/Slate.webp"]').classList.contains('on')`), 'shown as picked');
    await t.clickText('#pop .seg-btn', 'Cliff');
    t.eq(await t.g('Play.ui.os.edge'), 'cliff', 'the edge');
    t.ok(await t.count('.os-mats .tile') >= 2, 'what the cliff is made of');
    await t.clickText('#pop .seg-btn', 'Walls');
    const sun = M(t).os.sun;
    t.handle('os.set', { mapId: own, sun: (sun + 90) % 360 });
    await t.settle();
    t.eq(M(t).os.sun, (sun + 90) % 360, 'the light from elsewhere');
    await baked(t);
  }, { ms: 90000 });

  area.deep('a shape clicked corner by corner, closed with Enter; a corridor along the grid; a door on a wall line', async (t) => {
    await clear(t);
    await t.g(`Play.setTool('oldschool'), Play.openPop('oldschool')`);
    await t.clickSel('.os-tools .tile[data-v="shape"]');
    for (const [x, y] of [[15, 3], [21, 3], [21, 8], [15, 8]]) { const p = await t.scr(x * k, y * k); await t.click(p.x, p.y); }
    t.gm().webContents.focus();
    await t.key('Enter');
    await t.until(() => M(t).os.items.length === 1, 4000, 'the shape');
    t.eq(M(t).os.items[0].shape, 'poly', 'a shape');
    t.eq(M(t).os.items[0].pts.length, 4, 'four corners');
    await t.clickSel('.os-tools .tile[data-v="corridor"]');
    const a = await t.scr(21.5 * k, 5.5 * k); const b = await t.scr(27.5 * k, 5.5 * k);
    await t.drag(a, b, 14);
    await t.until(() => M(t).os.items.length === 2, 4000, 'the corridor');
    const c = M(t).os.items[1];
    t.eq([c.shape, c.r], ['path', 0.5 * k], 'one square wide', c);
    t.ok(c.pts.every((q) => Math.abs(q[1] - 5.5 * k) < 1e-3), 'along the middle of a row of squares', c.pts);
    await baked(t);
    const n = wallsOf(t).length;
    await t.clickSel('.os-tools .tile[data-v="door"]');
    const d = await t.scr(21 * k, 5.4 * k);
    await t.click(d.x, d.y);
    await t.until(() => M(t).os.doors.length === 1, 4000, 'the door');
    const door = M(t).os.doors[0];
    t.eq([door.x1, door.x2, door.y1, door.y2], [21 * k, 21 * k, 5 * k, 6 * k], 'one square of the wall line', door);
    await baked(t);
    const dw = wallsOf(t).filter((w) => w.door);
    t.eq(dw.length, 1, 'a door where the corridor opens into the room: it closes it');
    t.ok(wallsOf(t).length > 0 && n > 0, 'walls');
  }, { ms: 90000 });

  area.deep('walls block sight; a ledge or a cliff does not, rock and walls do; a door can be shut', async (t) => {
    await clear(t);
    t.handle('os.add', { mapId: own, items: [room(3, 3, 9, 9), room(12, 3, 18, 9), { kind: 'area', shape: 'path', pts: [[9 * k, 6.5 * k], [12 * k, 6.5 * k]], r: 0.5 * k, tile: { rel: 'Tiles/Tablescape/Slate.webp' }, edge: 'walls', mat: 'stone_wall', level: 0 }] });
    t.handle('os.door', { mapId: own, x1: 9 * k, y1: 6 * k, x2: 9 * k, y2: 7 * k, door: 1 });
    await t.settle();
    await baked(t);
    const dw = wallsOf(t).filter((w) => w.door);
    t.eq(dw.length, 1, 'the door is a door in the walls for sight', wallsOf(t).length);
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'party', x: 6 * k, y: 6 * k, r: 20 * k });
    t.handle('vision.update', { mapId: own, on: true });
    t.handle('wall.door', { mapId: own, id: dw[0].id, open: false });
    await t.send(own);
    await t.settle(); await t.sleep(800);
    const sees = (x, y) => t.t(`window.__table.sees(${x * k}, ${y * k})`);
    t.eq(await sees(5, 5), true, 'inside the room');
    t.eq(await sees(15, 6), false, 'not the other room through the walls and the shut door');
    t.handle('wall.door', { mapId: own, id: dw[0].id, open: true });
    await t.settle(); await t.sleep(600);
    t.eq(await sees(15, 6.5), true, 'through the open door and the corridor');
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
  }, { ms: 150000 });

  area.deep('the picture: the floor\'s tile inside, dark void outside, the walls raised and lit from one side', async (t) => {
    const m = M(t);
    const px = await t.g(`(async () => {
      const m = Play.state().map; const b = m.bg;
      const img = new Image(); img.src = UI.pathToUrl(b.path); await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const at = (x, y) => { const u = Math.round((x - b.x) / b.scale); const v = Math.round((y - b.y) / b.scale); return [...g.getImageData(u, v, 1, 1).data]; };
      const k = m.grid.size;
      return { floor: at(15 * k, 5 * k), void: at(b.x + 0.2 * k, b.y + 0.2 * k), wall: at(18.15 * k, 6 * k), size: [img.naturalWidth, img.naturalHeight] };
    })()`);
    const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
    t.ok(px.void[3] < 10, 'outside: see-through (the table\'s dark shows)', px.void);
    t.ok(lum(px.floor) > 45, 'inside: the floor', px.floor);
    t.ok(Math.abs(lum(px.wall) - lum(px.floor)) > 6, 'the wall differs from the floor', [px.wall, px.floor]);
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
    await t.until(() => t.rect('.os-more'), 4000, 'More');
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
  }, { ms: 60000 });

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
    await baked(t, 60000);
    t.handle('vision.update', { mapId: own, on: false });
    t.handle('fog.enabled', { mapId: own, enabled: false });
    await t.send(own);
    await t.g(`Play.setTool('select'), Play.closePop()`);
    await t.settle(); await t.sleep(1500);
    await t.shot(t.gm(), 'oldschool-gm');
    await t.shot(t.tv(), 'oldschool-tv');
    t.ok(true, 'pictures taken');
  }, { ms: 150000 });
};
