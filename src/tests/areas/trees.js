// Living trees (Beta 3.20): trees of crown layers that move in the wind, drawn by the graphics card (trees.js,
// tree-wind.js). On a machine without one (most test machines) this area runs with WebGL in software
// (scripts/run-tests.js) and tells the windows to draw the trees all the same; the still pictures are checked too.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (area) => {
  area.title('Living trees');
  const L = require('../../library');
  const still = (name) => L.resolveRef({ rel: `Assets/Living trees/${name}.webp` });
  const mapNow = (t) => t.store.map(t.state.editMapId);
  const trees = (t) => mapNow(t).layers.filter((l) => l.tree);
  const tv = async (t) => (await t.tvDebug()).trees;
  const gm = (t) => t.g('Play.view().stats.trees');
  const soft = async (t, on) => { await t.g(`Trees.allowSoft(${on})`); await t.t(`Trees.allowSoft(${on})`); };
  const clear = async (t) => { const ids = trees(t).map((l) => l.id); if (ids.length) t.handle('layer.removeMany', { ids }); t.handle('wind.set', { auto: true, storm: false }); t.handle('weather.preset', { name: 'None', layers: [] }); await t.settle(); };
  const add = (t, name, at, extra = {}) => t.handle('layer.add', { path: still(name), role: 'asset', x: at.x, y: at.y, w: 3 * mapNow(t).grid.size, ...extra }).selected;

  area.before(async (K) => {
    await K.openDemo(); await K.send();
    K.handle('fog.enabled', { enabled: false });
    await K.until(() => K.t('!!document.createElement("canvas").getContext("webgl2")'), 8000, 'WebGL on the TV');
    await K.g('Trees.allowSoft(true)'); await K.t('Trees.allowSoft(true)');
  });

  area.quick('the library has the living trees under Assets: seven kinds in three sizes, part of the app', async (t) => {
    const list = t.lib('assets').filter((x) => x.builtin);
    t.eq(list.length, 21, 'living trees in the library');
    t.ok(list.every((x) => x.rel.startsWith('Assets/Living trees/') && x.tree && fs.existsSync(x.path) && x.thumb), 'each with its still picture', list[0]);
    t.eq([...new Set(list.map((x) => x.tree.v))].length, 7, 'kinds');
    t.eq(L.toRef(still('Pine small')).rel, 'Assets/Living trees/Pine small.webp', 'known by its name, wherever the app lies');
    t.ok(!path.relative(L.root, still('Pine small')).startsWith('Assets'), 'not a file of the library folder');
  });

  area.quick('a living tree placed: a tree of its own, above the tokens, turned only as far as its kind allows; a copy and "Another look" are other trees', async (t) => {
    await clear(t);
    const id = add(t, 'Pine large', { x: 4, y: 4 }, { rotation: 180 });
    const l = mapNow(t).layers.find((x) => x.id === id);
    t.ok(l.tree && l.tree.v === 'pine' && l.tree.base === 0 && l.tree.seed >= 1, 'it is a tree', l.tree);
    t.ok(l.over === true && !l.flip && !l.shadow && !l.stretch, 'above the tokens, its own shape and shadows', l);
    t.ok(Math.abs(l.rotation) <= 40, 'a pine turns 40° at most', l.rotation);
    const seed = l.tree.seed;
    const copy = t.handle('layer.duplicate', { id, dx: 3, dy: 0 }).selected;
    const c = mapNow(t).layers.find((x) => x.id === copy);
    t.ok(c.tree.seed !== seed && c.tree.v === 'pine', 'the copy has a seed of its own', [seed, c.tree]);
    const r = t.handle('layer.reroll', { id });
    t.ok(r.ok && mapNow(t).layers.find((x) => x.id === id).tree.seed !== seed, 'Another look: a new seed', r);
    t.handle('history.undo', {});
    t.eq(mapNow(t).layers.find((x) => x.id === id).tree.seed, seed, 'undo brings the old look back');
    t.handle('layer.update', { id, stretch: 2 });
    t.ok(!mapNow(t).layers.find((x) => x.id === id).stretch, 'it cannot be made flat or long');
    const sid = add(t, 'Oak (dark green) small', { x: 8, y: 8 });
    const small = mapNow(t).layers.find((x) => x.id === sid);
    t.eq(small.tree.base, 2, 'a small tree starts at a higher layer');
  });

  area.quick('the TV and your screen draw the trees with the graphics card, level by level, and they move', async (t) => {
    await clear(t);
    const at = { x: 5, y: 5 };
    const a = add(t, 'Oak (dark green) large', at);
    add(t, 'Autumn (orange) medium', { x: 11, y: 5 }, { over: false });
    await t.send();
    await t.until(() => t.t(`window.__table.treeProbe(${JSON.stringify(at)})`), 8000, 'the map on the TV');
    const d = await t.until(async () => { const x = await tv(t); return x && x.drawn === 2 && x.px && x.px[3] > 200 && x; }, 30000, 'both trees drawn on the TV');
    t.eq(d.levels, ['ground', 'over'], 'one on the ground, one above the tokens');
    t.ok(d.px[1] > d.px[0] && d.px[1] > d.px[2], 'green leaves where the oak stands', d.px);
    t.ok(await t.t(`(() => { const c = document.querySelector('.sv-trees-over'); const tok = document.querySelector('.sv-tokens').parentNode; const li = document.querySelector('.sv-light'); const pos = (x, y) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING); return !!c && pos(tok, c) && pos(c, li) && pos(c, document.querySelector('.sv-fog')); })()`), 'its canvas lies above the tokens, under the light and the fog');
    t.ok(await t.t(`(() => { const g = document.querySelector('.sv-trees-ground'); return !!g && !!(g.compareDocumentPosition(document.querySelector('.sv-gridc')) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'the one on the ground lies under the grid');
    const t0 = d.time;
    await t.until(async () => (await tv(t)).time > t0 + 0.3, 15000, 'the wind to go on');
    const g = await t.until(async () => { const x = await gm(t); return x && x.drawn === 2 && x; }, 15000, 'your screen draws them too');
    t.eq(g.n, 2, 'on your screen');
    t.ok(await t.g(`!!document.querySelector('.sv-asset[data-id="${a}"] .sv-treebox') && !document.querySelector('.sv-asset[data-id="${a}"] img')`), 'the tree itself is a box to click (no picture of its own)');
    // hidden from the players: not on the TV, still on yours
    t.handle('layer.update', { id: a, hidden: true });
    await t.until(async () => (await tv(t)).n === 1, 8000, 'the hidden tree off the TV');
    t.eq((await gm(t)).n, 2, 'still on your screen');
    t.handle('layer.update', { id: a, hidden: false });
  }, { ms: 90000 });

  area.quick('on the TV a tree above the tokens opens where a token stands under it', async (t) => {
    await clear(t);
    const tok = mapNow(t).layers.find((l) => l.role === 'token' && !l.hidden);
    const was = { x: tok.x, y: tok.y };
    add(t, 'Dark green clumps large', { x: was.x, y: was.y });
    await t.send();
    const d = await t.until(async () => { const x = await tv(t); return x && x.drawn === 1 && x.mask && x; }, 30000, 'a window in the crown');
    t.ok(/radial-gradient/.test(d.mask), 'round the token', d.mask);
    t.handle('layer.update', { id: tok.id, x: was.x + 12, y: was.y + 9 });
    await t.until(async () => (await tv(t)).mask === '', 8000, 'the crown closes when the token walks off');
    t.handle('layer.update', { id: tok.id, ...was });
    t.eq(await t.g(`getComputedStyle(document.querySelector('.sv-trees-over')).opacity`), '0.7', 'see-through on your screen, so the tokens under it show');
  }, { ms: 60000 });

  area.quick('the wind follows the weather; a wind of your own and Storm go over it', async (t) => {
    await clear(t);
    add(t, 'Light green medium', { x: 6, y: 6 });
    const wind = async () => (await gm(t)).wind;
    await t.until(async () => { const w = await wind(); return w && w.from === 'calm' && w.strength === 1; }, 10000, 'a breeze without weather');
    const storm = t.g('JSON.parse(JSON.stringify(FXDATA.WEATHER.find((x) => x.id === "storm")))');
    const st = await storm;
    t.handle('weather.preset', { name: st.label, layers: st.layers.map((l) => ({ dir: 100, ...l })) });
    const w = await t.until(async () => { const x = await wind(); return x && x.from === 'weather' && x; }, 8000, 'the thunderstorm in the trees');
    t.ok(w.strength > 2 && w.lean > 0.5 && w.dir === 100, 'hard, leaning, the way the rain goes', w);
    t.handle('weather.preset', { name: 'Snow', layers: [{ type: 'snow', dir: 95 }] });
    const s = await t.until(async () => { const x = await wind(); return x && x.strength < 1.3 && x; }, 8000, 'snow: gentle');
    t.eq(s.lean, 0, 'no lean in gentle wind');
    t.handle('wind.set', { auto: false, dir: 270, strength: 1.7, lean: 0.3 });
    const o = await t.until(async () => { const x = await wind(); return x && x.from === 'own' && x; }, 8000, 'your own wind');
    t.eq([o.dir, o.strength, o.lean], [270, 1.7, 0.3], 'as set, whatever the weather');
    // the Storm button (also on the hotbar): on, and off again
    t.gm().webContents.focus();
    await t.g(`Play.hotRun({ kind: 'do', ref: 'storm' })`);
    const x = await t.until(async () => { const y = await wind(); return y && y.from === 'storm' && y; }, 8000, 'the storm');
    t.ok(x.strength >= 2.4 && x.dir === 270 && mapNow(t).wind.storm, 'a storm from where your wind blows', x);
    t.ok(await t.g(`Play.hotLive({ kind: 'do', ref: 'storm' })`), 'the button is lit');
    await t.g(`Play.hotRun({ kind: 'do', ref: 'storm' })`);
    await t.until(async () => (await wind()).from === 'own', 8000, 'the storm has passed');
    t.eq((await t.g('Play.hotActions().filter((a) => a.ref === "storm").length')), 1, 'Storm is among the hotbar\'s actions');
  }, { ms: 60000 });

  area.quick('your tools: a tree brush takes four, three or two squares; the card gives Another look and leaves Mirror out; the Wind section shows while the map has trees', async (t) => {
    await clear(t);
    t.gm().webContents.focus();
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'weather'; Play.openPop('fx')`);
    await t.until(() => t.count('.wind-box'), 4000, 'the weather panel');
    t.ok(await t.g(`document.querySelector('.wind-box').hidden`), 'no Wind section on a map without trees');
    const items = t.lib('assets').filter((x) => x.builtin);
    const it = items.find((x) => x.name === 'Autumn (orange) medium');
    await t.g(`Play.Drawer.open({ cat: 'assets' })`);
    await t.until(() => t.findText('span', 'Living trees'), 6000, 'the Living trees folder');
    await t.key('Escape');
    await t.g(`Play.setTool('asset')`);
    await t.g(`Play.ui.brush = null`);
    const far = mapNow(t).layers.filter((l) => l.role === 'token').sort((p, q) => q.x - p.x)[0]; // (clear of the panel on the left)
    await t.cmd('layer.add', { path: it.path, role: 'asset', x: far.x - 3 * mapNow(t).grid.size, y: far.y + 2 * mapNow(t).grid.size, w: 2 * mapNow(t).grid.size });
    const id = trees(t)[0].id; const seed = trees(t)[0].tree.seed;
    await t.g(`Play.openPop('asset')`);
    const r = await t.until(() => t.rect(`.sv-asset[data-id="${id}"] .sv-treebox`), 6000, 'the tree\'s box');
    await t.click(r.cx, r.cy);
    await t.until(() => t.count('.sel-card [data-tip^="Another look"], .card [data-tip^="Another look"], [data-tip^="Another look"]'), 5000, 'the card');
    t.eq(await t.count('[data-tip="Mirror"]'), 0, 'no Mirror for a tree');
    t.ok(await t.g(`[...document.querySelectorAll('.look .ctl-label')].filter((x) => x.offsetParent && /^(Height|Shadow|Mirror)$/.test(x.textContent)).length === 0`), 'no Height, Shadow or Mirror in its look');
    t.ok(await t.g(`[...document.querySelectorAll('.look .ctl-label')].some((x) => x.offsetParent && x.textContent === 'Hue')`), 'Hue and Darken stay');
    t.eq(await t.count('.sv-gizmo.no-sides'), 1, 'its frame: corners and the knob');
    await t.clickSel('[data-tip^="Another look"]');
    await t.until(() => trees(t)[0].tree.seed !== seed, 4000, 'another look');
    // the brush: its size by the tree's size
    for (const [name, n] of [['Pine large', 4], ['Pine medium', 3], ['Pine small', 2]]) {
      const b = items.find((x) => x.name === name);
      await t.g(`Play.hotRun({ kind: 'asset', ref: ${JSON.stringify({ path: b.path, rel: b.rel, name: b.name })}, label: ${JSON.stringify(b.name)} })`);
      await t.until(async () => (await t.g('Play.ui.assetCells')) === n && (await t.g('Play.ui.brush && Play.ui.brush.name')) === name, 5000, `${name}: ${n} squares`);
    }
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'weather'; Play.openPop('fx')`);
    await t.until(async () => (await t.count('.wind-box')) && !(await t.g(`document.querySelector('.wind-box').hidden`)), 5000, 'the Wind section, now that the map has a tree');
    t.ok(await t.findText('.wind-box', 'Follows the weather') && await t.findText('.wind-box button', 'Storm'), 'Follows the weather, and Storm');
    t.ok(await t.g(`[...document.querySelectorAll('.wind-box .compass')].every((x) => !x.offsetParent)`), 'no direction to set while it follows the weather');
    t.handle('wind.set', { auto: false });
    await t.until(() => t.g(`[...document.querySelectorAll('.wind-box .compass')].some((x) => x.offsetParent)`), 4000, 'your own wind: a direction and a strength');
    t.handle('wind.set', { auto: true });
    await t.g('Play.closePop()'); await t.g(`Play.setTool('select')`);
  }, { ms: 90000 });

  area.quick('without a graphics card the trees are still pictures, like any asset', async (t) => {
    await clear(t);
    const id = add(t, 'Frosted (white) large', { x: 6, y: 6 });
    await t.send();
    await t.until(async () => (await tv(t)).drawn === 1, 30000, 'drawn by the graphics card first');
    await soft(t, false);
    try {
      await t.until(async () => { const x = await tv(t); return x && !x.live && x.n === 0; }, 8000, 'no live trees on the TV');
      const img = await t.until(() => t.t(`(() => { const i = document.querySelector('.sv-asset[data-id="${id}"] img'); return i && i.naturalWidth ? { src: i.src, w: i.offsetWidth } : null; })()`), 8000, 'its still picture on the TV');
      t.ok(/trees\/frosted_white\/still-large\.webp$/.test(img.src) && img.w > 20, 'the tree\'s own still picture', img);
      t.ok(await t.g(`!!document.querySelector('.sv-asset[data-id="${id}"] img')`), 'and on your screen');
    } finally { await soft(t, true); }
    await t.until(async () => (await tv(t)).drawn === 1, 30000, 'and live again');
  }, { ms: 90000 });

  area.quick('a campaign keeps a tree by its name: an export takes no file for it, and it is found again', async (t) => {
    await clear(t);
    const id = add(t, 'Frost (blue) medium', { x: 5, y: 9 });
    t.store.flush();
    const Transfer = require('../../transfer');
    const plan = Transfer.plan(t.store.cur.dir, { kind: 'full' });
    t.ok(!plan.lib.some((f) => /Living trees|still-/.test(f.rel)), 'no tree picture in the package', plan.lib.map((f) => f.rel));
    const m = plan.json.map((j) => JSON.parse(j.data)).find((j) => Array.isArray(j.layers) && j.layers.some((l) => l.id === id));
    const l = m.layers.find((x) => x.id === id);
    t.ok(l.rel === 'Assets/Living trees/Frost (blue) medium.webp' && !l.path && l.tree && l.tree.v === 'frost_blue', 'its name and its tree go along', l);
    // read on another PC (another place for the app): found by its name, the tree as it was; a stray "tree" is dropped
    const { hydrateMap } = require('../../campaigns');
    const MapState = require('../../mapstate');
    const back = hydrateMap(MapState.normalize(JSON.parse(JSON.stringify({ ...m, layers: [{ ...l, path: 'C:/elsewhere/still-medium.webp' }, { id: 'x1', role: 'asset', kind: 'image', rel: 'Assets/Nature/Oak tree.png', x: 0, y: 0, w: 1, tree: { v: 'pine', base: 0, seed: 5 } }] }))));
    t.ok(back.layers[0].path === still('Frost (blue) medium') && !back.layers[0].missing && back.layers[0].tree.seed === l.tree.seed, 'found again, the same tree', back.layers[0]);
    t.ok(!back.layers[1].tree, 'an ordinary picture is no living tree');
  });
};
