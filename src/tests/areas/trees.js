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

  area.quick('the living kinds come with the app: sixteen of them in three groups, each in its sizes, known by name', async (t) => {
    const list = t.lib('assets').filter((x) => x.builtin);
    t.eq(list.length, 47, 'every kind in every size it has (the rust dead tree has no small one)');
    t.ok(list.every((x) => x.rel.startsWith('Assets/Living trees/') && x.tree && fs.existsSync(x.path) && x.thumb), 'each with its still picture', list[0]);
    t.eq([...new Set(list.map((x) => x.tree.v))].length, 16, 'kinds');
    t.eq(await t.g('Trees.groups().map((g) => g.name + " " + g.ids.length).join(", ")'), 'Trees 12, Bushes 1, Mushrooms 3', 'by group');
    t.eq(await t.g('[Trees.squares("fungus_pale", "large"), Trees.squares("fungus_pale", "small"), Trees.squares("oak_dark_green", "medium"), Trees.squares("shrub_feathery", "large")].join()'), '2,1,3,2.5', 'each kind its own squares');
    t.eq(await t.g('Trees.sizesOf("dead_tree_rust").join()'), 'medium,large', 'sizes a kind has');
    // the palm: its widest crown sits near the top, and that crown is its box (and its still picture)
    const palm = await t.g('(() => { const v = Trees.variant("palm"); return { box: Trees.boxOf({ v: "palm", base: 0 }), w4: v.layers[4].w, w0: v.layers[0].w, fp: v.footprintLayer }; })()');
    t.ok(palm.fp === 4 && palm.box.w === palm.w4 && palm.w4 > palm.w0 * 2, 'the palm is as wide as its widest crown', palm);
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
  }, { ms: 60000 });

  // Second Builder (second-tree-hue-solid): on your screen the crown is solid now (it used to be at 70 %), and opens
  // round a token as on the TV, right where the token is; also round a token hidden from the table (only you see it)
  area.quick('on your screen too: a tree above the tokens is solid and opens round a token, hidden ones as well', async (t) => {
    await clear(t);
    const tok = mapNow(t).layers.find((l) => l.role === 'token' && !l.hidden);
    const id = add(t, 'Dark green clumps large', { x: tok.x, y: tok.y });
    await t.send();
    t.eq(await t.g(`getComputedStyle(document.querySelector('.sv-trees-over')).opacity`), '1', 'solid on your screen');
    const where = () => t.g(`(() => { const c = Play.view().tcv.over; if (!c || !c.mask) return null;
      const m = /at (-?\\d+)px (-?\\d+)px/.exec(c.mask); const cr = c.el.getBoundingClientRect(); const k = cr.width / c.el.offsetWidth;
      const te = document.querySelector('.sv-token[data-id="${tok.id}"]') || document.querySelector('[data-id="${tok.id}"]'); const tr = te.getBoundingClientRect();
      return { mx: +m[1], my: +m[2], tx: (tr.left + tr.width / 2 - cr.left) / k, ty: (tr.top + tr.height / 2 - cr.top) / k, r: tr.width / k }; })()`);
    const w = await t.until(where, 15000, 'a window in the crown on your screen');
    t.ok(Math.hypot(w.mx - w.tx, w.my - w.ty) < Math.max(4, w.r * 0.15), 'right round the token', w);
    t.handle('layer.update', { id: tok.id, hidden: true });
    await t.sleep(400);
    t.ok(await where(), 'a token hidden from the table opens it on your screen too');
    await t.until(async () => !(await tv(t)).mask, 8000, 'the TV to close its window (the token is hidden from the table)'); // (not after a fixed wait: software graphics draw the TV's trees slowly)
    t.ok(!(await tv(t)).mask, 'but not on the TV');
    t.handle('layer.update', { id: tok.id, hidden: false });
    t.handle('layer.removeMany', { ids: [id] });
  }, { ms: 60000 });

  // Second Builder (second-tree-hue-solid): a tree's own Hue turns its colours as the browser turns every other asset and
  // the placing preview (CSS hue-rotate). The tree engine used to turn them its own way, the other way round
  area.quick('Hue on a living tree: the same colour as the placing preview and any other asset', async (t) => {
    await clear(t);
    const at = { x: 6, y: 6 };
    const id = add(t, 'Oak (dark green) large', at, { over: false });
    await t.send();
    await t.until(() => t.t(`window.__table.treeProbe(${JSON.stringify(at)})`), 8000, 'the map on the TV');
    const px = async (what) => (await t.until(async () => { const x = await tv(t); return x && x.drawn === 1 && x.px && x.px[3] > 200 && x; }, 30000, what)).px;
    const p0 = await px('the oak drawn');
    t.handle('layer.update', { id, hue: -90 });
    await t.sleep(600);
    const p1 = await px('the oak turned');
    const css = (c, d) => { const a = (d * Math.PI) / 180; const C = Math.cos(a); const S = Math.sin(a);
      const M = [[0.213 + C * 0.787 - S * 0.213, 0.715 - C * 0.715 - S * 0.715, 0.072 - C * 0.072 + S * 0.928], [0.213 - C * 0.213 + S * 0.143, 0.715 + C * 0.285 + S * 0.140, 0.072 - C * 0.072 - S * 0.283], [0.213 - C * 0.213 - S * 0.787, 0.715 - C * 0.715 + S * 0.715, 0.072 + C * 0.928 + S * 0.072]];
      return M.map((r) => Math.max(0, Math.min(255, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))); };
    const want = css(p0, -90);
    const off = Math.max(...want.map((v, i) => Math.abs(v - p1[i])));
    t.ok(off < 14, 'the turned oak has the colour the browser\'s hue-rotate(-90deg) gives it', { p0, p1, want });
    t.ok(p1[0] > p1[2], 'leaf green at -90 degrees turns warm (reddish brown), not teal', p1);
    t.handle('layer.removeMany', { ids: [id] });
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

  area.quick('Assets → Living: the kinds as tiles by group, Small to Large or mixed, each placed turned at random; Another look; the wind lives here, no longer under Weather or in the library', async (t) => {
    await clear(t);
    t.gm().webContents.focus();
    const gs = mapNow(t).grid.size;
    // (Beta 3.60) Effects → Scene shows the wind in one line with Storm; setting it by hand is in its fold. The box
    // with its heading stays here in Living
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'weather'; Play.openPop('fx')`);
    await t.until(() => t.count('#pop .wx-presets'), 4000, 'the Scene group');
    t.eq(await t.count('#pop .wind-box'), 0, 'no Wind box in Scene');
    t.ok(await t.count('#pop .fx-wind .wind-now') && await t.findText('#pop .fx-wind button', 'Storm'), 'Scene: the wind now, and Storm');
    // the library: no Living trees folder (the Cartographer still finds them there)
    await t.g(`Play.Drawer.open({ cat: 'assets' })`);
    await t.until(() => t.findText('#drawer span', 'Nature'), 6000, 'the library\'s Assets');
    t.ok(!(await t.findText('#drawer span', 'Living trees')), 'no Living trees folder in the library');
    await t.key('Escape');
    // the Assets panel: Library | Living
    await t.g(`Play.setTool('asset'); Play.openPop('asset')`);
    await t.until(() => t.count('#pop .as-groups'), 4000, 'the groups at the side (Beta 3.61)');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .as-groups .tile')].map((b) => b.textContent).join('|')`), 'Library|Living', 'Library | Living');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .as-tools .tile')].map((b) => b.textContent).join('|')`), 'Stamp|Scatter', 'Stamp | Scatter beside them');
    await t.g(`document.querySelector('#pop .as-groups [data-v="living"]').click()`);
    await t.until(() => t.count('#pop .living-tiles .tile'), 4000, 'the Living tab');
    t.eq(await t.count('#pop .living-tiles .tile'), 16, 'every kind as a tile');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .living-group')].map((x) => x.textContent).join()`), 'Trees,Bushes,Mushrooms', 'by group');
    const pick = await t.g(`(() => { const b = document.querySelector('#pop .living-pick'); return { h: b.clientHeight, all: b.scrollHeight }; })()`);
    t.ok(pick.h < 240 && pick.all > pick.h + 100, 'two rows show, the rest scrolls', pick);
    t.eq(await t.count('#pop .wind-box'), 0, 'no wind box here any more: the wind is in Effects → Scene (Beta 3.61)');
    t.ok(await t.count('#pop .as-ban .cap b') && (await t.text('#pop .as-ban .cap b')).length > 2, 'the banner names the tree in hand', await t.text('#pop .as-ban .cap'));
    // free spots on the map, well apart, clear of the tokens and the panel
    const spots = await t.g(`(() => {
      const v = Play.view(); const pop = document.getElementById('pop').getBoundingClientRect();
      const toClient = (p) => { const q = v.mapToTable(p.x, p.y); const d = document.createElement('div'); d.style.cssText = 'position:absolute;width:0;height:0;left:' + q.x * v.ppi + 'px;top:' + q.y * v.ppi + 'px'; v.marks.appendChild(d); const r = d.getBoundingClientRect(); d.remove(); return { x: r.x, y: r.y }; };
      const m = Play.state().map; const g = m.grid.size; const toks = m.layers.filter((l) => l.role === 'token');
      const a = v.toMap(pop.right + 60, 140); const b = v.toMap(innerWidth - 60, innerHeight - 220);
      const out = [];
      for (let y = Math.min(a.y, b.y) + g; y < Math.max(a.y, b.y) - g && out.length < 8; y += 5 * g) {
        for (let x = Math.min(a.x, b.x) + g; x < Math.max(a.x, b.x) - g && out.length < 8; x += 5 * g) {
          if (toks.some((k) => Math.hypot(k.x - x, k.y - y) < 2.5 * g)) continue;
          const c = toClient({ x, y }); if (c.x > pop.right + 30 && c.x < innerWidth - 30 && c.y > 100 && c.y < innerHeight - 160) out.push({ x, y, cx: c.x, cy: c.y });
        }
      }
      return out;
    })()`);
    t.ok(spots.length >= 7, 'room on the map', spots.length);
    // a tile may lie below the first two rows: scrolled into view, then clicked
    const tile = async (v) => { await t.g(`document.querySelector('#pop .living-tiles [data-v="${v}"]').scrollIntoView({ block: 'nearest' })`); await t.clickSel(`#pop .living-tiles [data-v="${v}"]`); };
    // Pine, Small: two squares
    await tile('pine');
    await t.clickSel('#pop .living-sizes [data-v="small"]');
    t.ok(await t.findText('#pop .ctl-slider', '2 squares'), 'Small: two squares');
    await t.click(spots[0].cx, spots[0].cy);
    const pine = await t.until(() => trees(t).find((l) => l.tree.v === 'pine'), 5000, 'a pine placed by a click');
    t.ok(Math.abs(pine.w - 2 * gs) < 0.01 && /Pine small/.test(pine.rel) && Math.abs(pine.rotation) <= 40, 'small, turned no more than a pine may', pine);
    // a mushroom: its own squares; the rust dead tree has no small one
    await tile('fungus_pale');
    await t.clickSel('#pop .living-sizes [data-v="large"]');
    t.ok(await t.findText('#pop .ctl-slider', '2 squares'), 'a large mushroom: two squares');
    await tile('dead_tree_rust');
    t.ok(await t.g(`document.querySelector('#pop .living-sizes [data-v="small"]').disabled`), 'no Small for the rust dead tree');
    // Oak, Mixed: each one a size of its own, each turned its own way
    await tile('oak_dark_green');
    await t.clickSel('#pop .living-sizes [data-v="mixed"]');
    for (const p of spots.slice(1, 7)) { await t.click(p.cx, p.cy); await new Promise((r) => setTimeout(r, 120)); }
    const oaks = await t.until(() => { const l = trees(t).filter((x) => x.tree.v === 'oak_dark_green'); return l.length === 6 && l; }, 6000, 'six oaks');
    const ws = [...new Set(oaks.map((l) => Math.round(l.w / gs)))];
    t.ok(ws.length >= 2 && ws.every((w) => [2, 3, 4].includes(w)), 'mixed sizes', ws);
    t.ok(new Set(oaks.map((l) => l.rotation)).size >= 4 && oaks.every((l) => Math.abs(l.rotation) <= 70), 'each turned its own way, within what an oak allows', oaks.map((l) => l.rotation));
    // a placed tree selected: Another look in the panel, no Height, Shadow or Mirror, no Mirror on its card
    const id = oaks[0].id; const seed = oaks[0].tree.seed;
    const r = await t.until(() => t.rect(`.sv-asset[data-id="${id}"] .sv-treebox`), 6000, 'the tree\'s box');
    await t.click(r.cx, r.cy);
    await t.until(() => t.g(`[...document.querySelectorAll('#pop .as-look .btn')].some((b) => b.offsetParent && /Another look/.test(b.textContent))`), 5000, 'Another look in the panel');
    t.ok(/Oak/.test(await t.text('#pop .as-ban .cap b')) && (await t.text('#pop .as-ban .fx-ban-tag')) === 'picked', 'the panel is the picked tree\'s card (Beta 3.61)', await t.text('#pop .as-ban'));
    t.eq(await t.count('#pop .living-tiles, #pop .as-tools'), 0, 'no tiles and no Stamp or Scatter while one is picked');
    t.eq(await t.count('[data-tip="Mirror"]'), 0, 'no Mirror for a tree');
    t.ok(await t.g(`[...document.querySelectorAll('.as-look .ctl-label')].filter((x) => x.offsetParent && /^(Height|Shadow|Mirror)$/.test(x.textContent)).length === 0`), 'no Height, Shadow or Mirror in its look');
    t.ok(await t.g(`['Hue', 'Darken', 'Turn'].every((k) => [...document.querySelectorAll('.as-look .ctl-label')].some((x) => x.offsetParent && x.textContent === k))`), 'Hue, Darken and Turn for it');
    t.eq(await t.count('.sv-gizmo.no-sides'), 1, 'its frame: corners and the knob');
    await t.clickText('#pop .as-look .btn', 'Another look');
    await t.until(() => trees(t).find((l) => l.id === id).tree.seed !== seed, 4000, 'another look');
    // a living tree from the hotbar: the Living tab picks it
    const b = t.lib('assets').find((x) => x.builtin && x.name === 'Palm medium');
    await t.g(`Play.hotRun({ kind: 'asset', ref: ${JSON.stringify({ path: b.path, rel: b.rel, name: b.name })}, label: ${JSON.stringify(b.name)} })`);
    await t.until(async () => (await t.g('Play.ui.assetTab + " " + Play.ui.living.v + " " + Play.ui.living.size')) === 'living palm medium', 5000, 'the palm, medium, picked');
    await t.until(async () => (await t.g(`(document.querySelector('#pop .living-tiles .tile.on') || { dataset: {} }).dataset.v`)) === 'palm', 4000, 'the picked tree is let go: the tiles are back, on the palm');
    // the Library tab keeps its own pick
    await t.g(`document.getElementById('pop').scrollTop = 0`);
    await t.g(`document.querySelector('#pop .as-groups [data-v="library"]').click()`);
    await t.until(async () => (await t.count('#pop .as-ban')) && !(await t.count('#pop .living-tiles')), 4000, 'the Library group');
    t.eq(await t.count('#pop .living-tiles, #pop .wind-box'), 0, 'no trees and no wind there');
    await t.g('Play.closePop()'); await t.g(`Play.setTool('select')`);
  }, { ms: 120000 });

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

  // Beta 3.58 (Glinn): grass painted in Effects → Paint grows the living blades of Oldschool maps on a picture map
  area.deep('Beta 3.58: grass painted on a picture map grows living blades (no waves); its card has Thickness; a colour, hidden, no graphics card', async (t) => {
    const was = t.state.editMapId;
    const own = await t.newMap('Grass (test)', { tv: true });
    t.handle('fog.enabled', { mapId: own, enabled: false });
    const M = () => t.store.map(own); const k = M().grid.size;
    t.ok(M().bg && M().bg.kind === 'image' && !M().bg.os, 'a map that is a picture', M().bg);
    t.handle('wind.set', { mapId: own, auto: false, dir: 20, strength: 1.6, lean: 0.4 });
    await t.cmd('fx.shape', { mapId: own, id: 'grass1', sid: 'a', preset: 'grass', shape: 'rect', x: 4 * k, y: 4 * k, w: 6 * k, h: 4 * k, dx: 1, dy: 0 });
    const s = await t.until(async () => { const x = await t.g('Play.view().stats.living'); return x && x.on && x.blades > 0 && x; }, 30000, 'blades on the GM screen');
    t.ok(s.kinds.grass && !s.kinds.water && s.blades > 24 * 250 && s.blades < 24 * 630, 'grass blades, some hundred a square', s);
    await t.until(async () => (await t.g('Play.view().stats.regions')) === 0, 4000, 'no waves of light under the blades');
    const spots = (list) => t.g(`(async () => { const v = Play.view(); v.livingProbe = ${JSON.stringify(list.map(([x, y]) => ({ x: x * k, y: y * k })))}; await new Promise((r) => setTimeout(r, 900)); const s = v.stats.living; v.livingProbe = null; return (s && s.px) || []; })()`);
    const [inA, inB, out] = await spots([[7, 6], [9, 7], [15, 6]]);
    t.ok(inA && inA[3] > 60 && inB && inB[3] > 60 && out && out[3] === 0, 'blades where it was painted, nothing beside it', [inA, inB, out]);
    // Effects → Paint → Grass: the map's grass card (with Thickness) instead of Strength, Amount and Speed
    await t.g(`(() => { Play.setTool('fx'); Play.ui.fxMode = 'paint'; Play.ui.region = 'grass'; Play.ui.fxFly = true; Play.openPop('fx'); })()`); // (Beta 3.60: Elements → Grass, its settings card)
    await t.sleep(400);
    const labels = await t.g(`[...document.querySelectorAll('#pop .ctl-label')].filter((e) => e.offsetParent).map((e) => e.textContent.trim())`);
    for (const l of ['Amount', 'Length', 'Thickness', 'Between gusts', 'Colour variety', 'Grows on']) t.has(labels, l, 'the grass card');
    t.ok(!labels.includes('Strength') && !labels.includes('Speed'), 'no Strength or Speed for blades', labels);
    await t.g(`Play.ui.fxFly = false; Play.closePop(); Play.setTool('select')`);
    await t.cmd('live.set', { mapId: own, fx: 'grass', set: { thick: 3 } });
    t.eq(M().live.grass.thick, 3, 'Thickness 300 %');
    await t.cmd('live.set', { mapId: own, fx: 'grass', set: { thick: 9 } });
    t.eq(M().live.grass.thick, 3, 'not beyond 300 %');
    // a colour of its own: the blades grow again in it
    await t.cmd('fx.update', { mapId: own, id: 'grass1', color: '#d9b45a' });
    const tinted = await t.until(async () => { const [q] = await spots([[7, 6]]); return q && q[3] > 60 && q[0] > q[2] + 30 && q; }, 15000, 'wheat-coloured blades');
    t.ok(tinted[0] > tinted[2] + 30, 'its own colour', tinted);
    // the TV shows them; hidden from the players, it doesn't
    await t.until(async () => { const d = (await t.tvDebug()).living; return d && d.on && d.blades > 0; }, 30000, 'blades on the TV');
    await t.cmd('fx.update', { mapId: own, id: 'grass1', hidden: true });
    await t.until(async () => { const d = (await t.tvDebug()).living; return d && !d.on; }, 15000, 'no blades on the TV once hidden');
    t.ok((await t.g('Play.view().stats.living')).on, 'still on your screen');
    // without a graphics card: the waves of light as before
    await soft(t, false); t.handle('wind.set', { mapId: own, auto: false, dir: 25, strength: 1.6, lean: 0.4 }); await t.settle();
    await t.until(async () => (await t.g('Play.view().stats.regions')) === 1, 6000, 'the waves without a graphics card');
    await soft(t, true);
    t.handle('fx.remove', { mapId: own, id: 'grass1' });
    t.handle('edit.open', { id: was }); await t.send(was);
  }, { ms: 120000 }); // (Beta 3.60: Elements draws its picture tiles when it opens, slow on software graphics)

  // Beta 3.65 (open point C12): the one engine for surfaces
  area.deep('Beta 3.65: Water painted on a picture map is drawn by the engine (no net of light over it), in its own colour, with the map\'s water card; Ember glow, Shimmer, Pulse and Ripple are tiles and areas of the engine; without a graphics card Water is drawn as before', async (t) => {
    const was = t.state.editMapId;
    const own = await t.newMap('Engine (test)', { tv: true });
    t.handle('fog.enabled', { mapId: own, enabled: false });
    const M = () => t.store.map(own); const k = M().grid.size;
    t.ok(M().bg && M().bg.kind === 'image' && !M().bg.os, 'a map that is a picture', M().bg);
    await t.cmd('fx.shape', { mapId: own, id: 'w1', sid: 'a', preset: 'water', shape: 'rect', x: 4 * k, y: 4 * k, w: 6 * k, h: 4 * k });
    const s = await t.until(async () => { const x = await t.g('Play.view().stats.living'); return x && x.on && x.kinds && x.kinds.water && x; }, 30000, 'the engine\'s water on the GM screen');
    t.ok(s.kinds.water && !s.kinds.grass && !s.kinds.lava && !s.kinds.glow, 'water, and nothing else', s);
    await t.until(async () => (await t.g('Play.view().stats.regions')) === 0, 4000, 'no net of light drawn over it');
    const spots = (list) => t.g(`(async () => { const v = Play.view(); v.livingProbe = ${JSON.stringify(list.map(([x, y]) => ({ x: x * k, y: y * k })))}; await new Promise((r) => setTimeout(r, 900)); const s = v.stats.living; v.livingProbe = null; return (s && s.px) || []; })()`);
    const [inA, out] = await spots([[7, 6], [15, 6]]);
    t.ok(inA && inA[3] > 200 && out && out[3] === 0, 'the map drawn again where it was painted, nothing beside it', [inA, out]);
    // a colour of its own
    await t.cmd('fx.update', { mapId: own, id: 'w1', color: '#c0392b' });
    const red = await t.until(async () => { const [q] = await spots([[7, 6]]); return q && q[3] > 200 && q[0] > q[2] + 12 && q; }, 15000, 'red water');
    t.ok(red[0] > red[2] + 12, 'its own colour', red);
    await t.cmd('fx.update', { mapId: own, id: 'w1', color: null });
    // its card: the map's water (as Draw's), not Strength, Amount and Speed of the net of light
    await t.g(`(() => { Play.setTool('fx'); Play.ui.looks = {}; Play.ui.fxFam = 'all'; Play.ui.fxMode = 'paint'; Play.ui.region = 'water'; Play.ui.paintShape = 'box'; Play.ui.fxFly = true; Play.openPop('fx'); })()`);
    await t.sleep(500);
    const labels = await t.g(`[...document.querySelectorAll('.fx-fly .ctl-label')].map((e) => e.textContent.trim())`);
    t.eq(labels, ['Transparency', 'Speed'], 'the water card: Transparency and Speed, for all the water of the map');
    await t.cmd('live.set', { mapId: own, fx: 'water', set: { clear: 0.8 } });
    t.eq(M().live.water.clear, 0.8, 'Transparency 80 %');
    // the tiles
    const tiles = await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.dataset.v)`);
    t.ok(tiles.length === 43 && tiles.indexOf('r:ember') === tiles.indexOf('r:lava') + 1 && ['r:shimmer', 'r:pulse', 'r:ripple'].every((x) => tiles.includes(x)), 'Ember glow beside Lava; Shimmer, Pulse, Ripple in Magic: 43 tiles', tiles.length);
    await t.g(`document.querySelector('#pop .fx-gal .fx-t[data-v="r:ember"]').click()`); await t.sleep(400);
    t.eq(await t.g(`[[...document.querySelectorAll('.fx-fly .ctl-label')].map((e) => e.textContent.trim()), !!document.querySelector('#pop .swatches'), document.querySelector('#pop .fx-ban .cap').textContent]`), [['Glow', 'Embers', 'Heat shimmer', 'Speed', 'Pick-up range'], false, 'Ember glowa box · lights up the map picture'], 'Ember glow: its card, no colour of its own, what it does on the banner');
    await t.g(`Play.ui.fxFly = false; Play.closePop(); Play.setTool('select')`);
    // the areas
    t.handle('fx.shape', { mapId: own, id: 'e1', sid: 'a', preset: 'ember', shape: 'round', x: 12 * k, y: 4 * k, w: 4 * k, h: 4 * k });
    t.handle('fx.shape', { mapId: own, id: 'g1', sid: 'a', preset: 'shimmer', shape: 'rect', x: 4 * k, y: 10 * k, w: 3 * k, h: 3 * k });
    t.handle('fx.shape', { mapId: own, id: 'g2', sid: 'a', preset: 'pulse', shape: 'rect', x: 8 * k, y: 10 * k, w: 3 * k, h: 3 * k });
    t.handle('fx.shape', { mapId: own, id: 'g3', sid: 'a', preset: 'ripple', shape: 'rect', x: 12 * k, y: 10 * k, w: 3 * k, h: 3 * k });
    const all = await t.until(async () => { const x = await t.g('Play.view().stats.living'); return x && x.on && x.kinds && x.kinds.lava && x.kinds.glow && x.kinds.water && x; }, 30000, 'ember glow and the glows on the engine');
    t.ok(all.kinds.lava && all.kinds.glow, 'Ember glow, Shimmer, Pulse and Ripple are the engine\'s', all.kinds);
    t.eq(await t.g('Play.view().stats.regions'), 0, 'none of them is drawn by the effects layer');
    await t.until(async () => { const d = (await t.tvDebug()).living; return d && d.on && d.kinds && d.kinds.water && d.kinds.glow; }, 30000, 'the same on the TV');
    // a whirlpool that swirls the water turns the engine's water (the map picture turned under it would be covered)
    t.handle('fx.add', { mapId: own, id: 'wh1', kind: 'emitter', preset: 'whirl', x: 7 * k, y: 6 * k, r: 1.5 * k, spin: 1, swirl: true, variant: 'whirlpool' });
    await t.until(async () => { const x = await t.g('Play.view().stats.living'); return x && x.on && x.whirls === 1; }, 8000, 'the whirlpool turns the water');
    t.handle('fx.update', { mapId: own, id: 'wh1', swirl: false });
    await t.until(async () => { const x = await t.g('Play.view().stats.living'); return x && x.on && x.whirls === 0; }, 8000, 'not with Swirl the water off');
    t.handle('fx.remove', { mapId: own, id: 'wh1' });
    // without a graphics card: Water as before (the net of light), the map's own light effects not at all, their tiles gone
    await soft(t, false); await t.settle();
    await t.until(async () => (await t.g('Play.view().stats.regions')) === 1, 6000, 'the net of light without a graphics card');
    await t.g(`(() => { Play.setTool('fx'); Play.ui.fxFam = 'all'; Play.ui.fxMode = 'paint'; Play.ui.region = 'water'; Play.ui.fxFly = true; Play.openPop('fx'); })()`); await t.sleep(500);
    const plain = await t.g(`[document.querySelectorAll('#pop .fx-gal .fx-t').length, [...document.querySelectorAll('.fx-fly .ctl-label')].map((e) => e.textContent.trim())]`);
    t.ok(plain[0] === 39 && plain[1].includes('Strength') && !plain[1].includes('Transparency'), 'no graphics card: 39 tiles, Water has Strength, Amount and Speed again', plain);
    await t.g(`Play.ui.fxFly = false; Play.closePop(); Play.setTool('select')`);
    await soft(t, true);
    for (const id of ['w1', 'e1', 'g1', 'g2', 'g3']) t.handle('fx.remove', { mapId: own, id });
    t.handle('edit.open', { id: was }); await t.send(was);
  }, { ms: 180000 });
};
