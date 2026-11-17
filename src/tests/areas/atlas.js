// The Cartographer (Beta 3.11): the campaign's atlas, its world and regional maps on the TV as an immersive view
'use strict';

module.exports = (area) => {
  area.title('Cartographer: world and regional maps');
  let world = null; let region = null; let battle = null;
  const A = (t) => t.store.atlas();
  const M = (t, id) => t.store.map(id);
  const tvA = (t) => t.t(`window.__table.debug().atlas`);
  const shownOn = async (t, id) => t.until(async () => { const a = await tvA(t); return a && a.on && a.id === id && a.ready && a.cover < 0.05 && a; }, 12000, 'the map on the TV, its clouds open');
  area.before(async (K) => {
    await K.openDemo();
    battle = await K.newMap('Battle (atlas test)', { tv: true });
    const pic = K.lib('maps').find((x) => x.kind === 'image');
    world = K.handle('atlas.add', { path: pic.path, name: 'The world', open: false }).id;
    region = K.handle('atlas.add', { path: pic.path, name: 'The north', open: false }).id;
    await K.settle();
  });

  area.quick('the atlas belongs to the campaign: in no chapter, there again after closing, and it travels with an export', async (t) => {
    const fs = require('fs'); const path = require('path');
    t.eq(A(t).maps.map((x) => x.id), [world, region], 'its maps, in the order they came'); t.eq(A(t).world, world, 'the first one is the world map');
    t.eq(t.store.cur.meta.chapters.flatMap((c) => c.maps).filter((id) => id === world || id === region), [], 'no chapter lists them');
    t.eq(M(t, world).grid.show, false, 'a world map starts without a grid drawn over it');
    t.eq((await t.g(`Play.state().atlas.maps.map((x) => [x.name, x.found])`)), [['The world', false], ['The north', false]], 'what the GM screen knows');
    // an export of the whole campaign takes them along, one chapter alone does not
    const Transfer = require('../../transfer');
    t.store.flush();
    const full = Transfer.plan(t.store.cur.dir, { kind: 'full' });
    const names = full.json.map((x) => x.name);
    t.ok(names.includes(`campaign/maps/${world}.json`) && names.includes(`campaign/maps/${region}.json`), 'the whole campaign brings its atlas', names.length);
    const one = Transfer.plan(t.store.cur.dir, { kind: 'full', chapterId: t.store.cur.meta.chapters[0].id });
    t.ok(!one.json.some((x) => x.name === `campaign/maps/${world}.json`), 'a single chapter does not');
    t.eq(JSON.parse(one.json[0].data).atlas, undefined, 'nor the list of them');
    // closed and opened again
    const id = t.store.cur.meta.id; const dir = t.store.cur.dir;
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the start screen');
    t.ok(fs.existsSync(path.join(dir, 'maps', `${world}.json`)), 'its file is kept');
    t.handle('campaign.open', { id }); t.handle('campaign.play');
    await t.until(() => t.g(`document.body.dataset.screen === 'play' && !!Play.state().map`), 8000, 'the campaign to open again');
    t.eq(A(t).maps.map((x) => x.id), [world, region], 'the atlas after opening again');
    t.ok(M(t, world) && M(t, world).bg, 'the world map with its picture');
    await t.send(battle);
  });

  area.quick('a world map goes on the TV over the battlemap, and off again: the battlemap is as it was', async (t) => {
    await t.send(battle);
    const r = t.handle('table.send', { id: world }); // (Send to table works for it too)
    t.ok(r && r.ok, 'on the table', r);
    t.eq(t.state.liveMapId, battle, 'the battlemap stays the map on the table underneath');
    t.eq(t.state.editMapId, world, 'the GM works on the world map');
    const a = await shownOn(t, world);
    t.ok(a.surface && a.surface.w > 500, 'its picture is painted', a.surface);
    t.eq(A(t).maps.find((x) => x.id === world).found, true, 'a map on the table is a map the party has found');
    await t.until(async () => /On the table/.test(await t.g(`document.querySelector('#frame') ? document.querySelector('#frame').textContent : ''`)), 3000, 'the frame on the GM screen to say On the table').catch(() => {});
    t.eq(await t.g(`!!document.querySelector('.bar-prep')`), false, 'no "not on the table yet" over it');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return x && !x.on; }, 6000, 'the map to leave the TV');
    t.eq(t.state.editMapId, battle, 'the GM is back on the battlemap'); t.eq(t.state.liveMapId, battle, 'which is still on the table');
    // a battlemap sent to the table takes the world map off it
    t.handle('atlas.show', { id: world }); await shownOn(t, world);
    await t.send(battle);
    t.eq(t.state.atlas, null, 'a battlemap sent to the table takes it off');
  });

  area.quick('the view: the camera looks at the middle of the table frame and flies there; turned, the whole view turns', async (t) => {
    t.handle('atlas.look', { look: { tilt: 0.6, bulge: 0.6, turn: 0 } });
    t.handle('atlas.show', { id: world });
    const a = await shownOn(t, world);
    const size = await t.t(`({ w: innerWidth, h: innerHeight })`);
    const mid = await t.t(`window.__table.atlasProject(${a.cam.cx}, ${a.cam.cy})`);
    t.near(mid.x, size.w / 2, 1, 'the spot it looks at is in the middle (across)'); t.near(mid.y, size.h / 2, 1, 'and down');
    const back = await t.t(`window.__table.atlasUnproject(${size.w * 0.3}, ${size.h * 0.7})`);
    const again = await t.t(`window.__table.atlasProject(${back.x}, ${back.y})`);
    t.near(again.x, size.w * 0.3, 0.5, 'screen to map and back is the same spot (across)'); t.near(again.y, size.h * 0.7, 0.5, 'and down');
    // tilted: an inch far away is smaller on the screen than an inch near
    const span = async (y) => { const p = await t.t(`[window.__table.atlasProject(${a.cam.cx - 0.5}, ${y}), window.__table.atlasProject(${a.cam.cx + 0.5}, ${y})]`); return p[1].x - p[0].x; };
    const far = await span(a.cam.cy - a.cam.S * 0.8); const near = await span(a.cam.cy + a.cam.S * 0.6);
    t.ok(far < near * 0.75, 'the far side is smaller than the near side', [far, near]);
    // the frame moved: the camera flies there
    const v = M(t, world).view;
    t.handle('view.update', { mapId: world, x: v.x - 3 * v.zoom, y: v.y, zoom: v.zoom });
    await t.until(async () => { const x = await tvA(t); return Math.abs(x.cam.cx - (a.cam.cx + 3)) < 0.02 && x; }, 6000, 'the camera to arrive three inches to the right');
    t.handle('view.update', { mapId: world, ...v });
    // turned a quarter: what lay toward the near side lies toward the left
    t.handle('atlas.look', { look: { turn: 90 } });
    await t.until(async () => Math.abs((await tvA(t)).look.turn - 90) < 0.5, 6000, 'the view to turn');
    const b = await tvA(t);
    const p = await t.t(`window.__table.atlasProject(${b.cam.cx}, ${b.cam.cy + b.cam.S * 0.5})`);
    t.ok(p.x < size.w / 2 - 20 && Math.abs(p.y - size.h / 2) < 3, 'the near side faces the left of the TV', p);
    t.handle('atlas.look', { look: { turn: 0 } });
    t.handle('atlas.hide', {});
  });

  area.quick('places and routes: named places stand on the map, a route counts its grid cells in what one cell stands for', async (t) => {
    t.handle('atlas.show', { id: world });
    const a = await shownOn(t, world);
    const R = a.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, type: 'hex-flat', size: 1, ox: 0, oy: 0, unit: { n: 1, name: 'day of travel' } });
    const place = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Kintsugi', sub: 'Seat of the shogun', note: 'The gates close at dusk.', to: region, ...at(0.5, 0.5) }).selected;
    const route = t.handle('mark.add', { mapId: world, kind: 'route', title: 'The pilgrim road', ...at(0.4, 0.6) }).selected;
    const g = M(t, world).grid; const Geom = require('../../renderer/geom');
    const c0 = Geom.hexAt(g, at(0.4, 0.6).x, at(0.4, 0.6).y);
    const h1 = Geom.hexCenter(g, c0.q + 4, c0.r); const h2 = Geom.hexCenter(g, c0.q + 4, c0.r - 3);
    t.handle('mark.route', { mapId: world, id: route, x: h1.x, y: h1.y }); t.handle('mark.route', { mapId: world, id: route, x: h2.x, y: h2.y });
    t.eq(Geom.routeLabel(g, M(t, world).marks.find((m) => m.id === route)), '7 days of travel', 'four hexes and three more');
    // on the GM's flat map
    await t.until(async () => (await t.g(`[...document.querySelectorAll('.sv-mark.kind-route .sv-place-sub')].map((e) => e.textContent)`)).includes('7 days of travel'), 4000, 'the route\'s length on the GM screen');
    t.eq(await t.g(`[...document.querySelectorAll('.sv-mark.kind-place .sv-place-title')].map((e) => e.textContent)`), ['Kintsugi'], 'the place on the GM screen');
    // standing on the TV
    const st = await t.until(async () => { const x = (await tvA(t)).standing; return x.length === 2 && x.every((s) => s.shown) && x; }, 5000, 'both to stand on the TV');
    t.eq(st.map((s) => [s.kind, s.title, s.sub]), [['place', 'Kintsugi', 'Seat of the shogun'], ['route', 'The pilgrim road', '7 days of travel']], 'what stands there');
    const want = await t.t(`window.__table.atlasProject(${at(0.5, 0.5).x}, ${at(0.5, 0.5).y})`);
    t.near(st[0].x, want.x, 1, 'the place stands on its spot');
    // its note, next to it; once more puts it away
    t.handle('atlas.note', { id: place });
    await t.until(async () => (await tvA(t)).standing[0].note === 'The gates close at dusk.', 4000, 'its note on the TV');
    t.eq(await t.t(`(document.querySelector('.atl-note') || {}).textContent`), 'The gates close at dusk.', 'as written');
    t.handle('atlas.note', { id: place });
    await t.until(async () => !(await tvA(t)).standing[0].note, 4000, 'the note to go');
    // it leads to a regional map: the TV changes to it through the clouds, and back to the world
    t.handle('atlas.show', { id: M(t, world).marks.find((m) => m.id === place).to });
    await shownOn(t, region);
    t.eq(t.state.editMapId, region, 'the GM is on the region too');
    t.handle('atlas.show', { id: A(t).world });
    await shownOn(t, world);
    t.handle('atlas.hide', {});
  });

  area.quick('the Mark tool sets places and draws routes on an atlas map only; the Cartographer panel lists the atlas', async (t) => {
    const modes = () => t.g(`[...document.querySelectorAll('#pop .seg-btn')].map((b) => b.textContent.trim())`);
    t.gm().webContents.focus();
    t.handle('edit.open', { id: battle }); await t.settle();
    await t.g(`(Play.setTool('mark'), Play.openPop('mark'))`);
    await t.until(async () => (await t.tool()) === 'mark' && (await modes()).length >= 2, 4000, 'the Mark tool');
    t.eq((await modes()).filter((x) => x === 'Place' || x === 'Route'), [], 'not on a battlemap');
    t.handle('edit.open', { id: world }); await t.settle();
    await t.until(async () => (await modes()).includes('Route'), 4000, 'Place and Route on a world map');
    // a route by clicks: each one a point, Esc ends it (the card of the route stays out of the way while it is drawn)
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, type: 'square', size: 1, ox: 0, oy: 0, unit: { n: 6, name: 'mile' } });
    await t.clickText('#pop .seg-btn', 'Route');
    const rect = await t.g(`Play.view().tableRectInMap()`);
    const pts = [[0.35, 0.45], [0.45, 0.45], [0.55, 0.45], [0.55, 0.6]].map(([fx, fy]) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy }));
    for (const p of pts) { const s = await t.scr(p.x, p.y); await t.click(s.x, s.y); await t.sleep(260); }
    await t.key('Escape');
    const routes = M(t, world).marks.filter((m) => m.kind === 'route');
    t.eq(routes.length, 1, 'one route'); t.eq(routes[0].pts.length / 2, 4, 'a point for every click', routes[0].pts);
    t.ok(/miles$/.test(require('../../renderer/geom').routeLabel(M(t, world).grid, routes[0])), 'counted in miles', require('../../renderer/geom').routeLabel(M(t, world).grid, routes[0]));
    // the panel
    await t.g(`Play.TB.openPanel('atlas')`);
    await t.until(async () => (await t.count('.fp[data-id="atlas"] .atl-row')) === 2, 4000, 'the panel with both maps');
    t.eq(await t.g(`[...document.querySelectorAll('.fp[data-id="atlas"] .atl-name b')].map((b) => b.textContent)`), ['The world', 'The north'], 'their names');
    t.eq(await t.g(`document.querySelector('.atl-unit').value + '|' + document.querySelector('.atl-n').value`), 'mile|6', 'what one grid cell stands for');
    await t.g(`document.querySelector('.fp[data-id="atlas"] .fp-close, .fp[data-id="atlas"] [aria-label="Close"]')?.click()`);
    t.handle('edit.open', { id: battle });
  });

  area.deep('what one grid cell stands for: the words, and what is refused', async (t) => {
    const Geom = require('../../renderer/geom');
    t.eq(['day of travel', 'mile', 'km', 'hex', 'foot', 'league', 'city'].map((n) => Geom.plural(n)), ['days of travel', 'miles', 'km', 'hexes', 'feet', 'leagues', 'cities'], 'more than one');
    t.eq(Geom.unitLabel({ type: 'hex-flat', size: 1, unit: { n: 1, name: 'day of travel' } }, 1), '1 day of travel', 'one');
    t.eq(Geom.unitLabel({ type: 'hex-flat', size: 1, unit: { n: 0.5, name: 'day' } }, 17), '8.5 days', 'halves');
    t.eq(Geom.unitLabel({ type: 'square', size: 1 }, 3), '3 squares', 'no unit set: cells');
    const set = (u) => { t.handle('grid.update', { mapId: world, unit: u }); return M(t, world).grid.unit; };
    t.eq(set({ n: 2, name: '  league ' }), { n: 2, name: 'league' }, 'tidied');
    t.eq(set({ n: 0, name: 'mile' }), undefined, 'nothing of something is no unit'); t.eq(set({ n: 1, name: '' }), undefined, 'no name, no unit'); t.eq(set(null), undefined, 'taken away');
  });

  area.deep('a map taken out of the atlas comes back with Undo; the world map passes on and comes back', async (t) => {
    t.handle('atlas.found', { id: region, found: true });
    const r = t.handle('atlas.remove', { id: world });
    t.ok(r.ok && r.undo, 'taken out, with a way back', r);
    t.eq(A(t).maps.map((x) => x.id), [region], 'gone from the atlas'); t.eq(A(t).world, region, 'the next one is the world map now');
    t.handle(r.undo.type, r.undo.payload);
    t.eq(A(t).maps.map((x) => x.id), [world, region], 'back in its place'); t.eq(A(t).world, world, 'and the world map again');
    t.eq(A(t).maps.find((x) => x.id === region).found, true, 'what was found stays found');
    // the look is kept within its limits
    t.handle('atlas.look', { look: { tilt: 5, bulge: -1, turn: 45 } });
    t.eq([A(t).look.tilt, A(t).look.bulge, A(t).look.turn], [1, 0, 0], 'tilt and bulge from 0 to 1, turns in quarters');
    t.handle('atlas.look', { look: { tilt: 0.6, bulge: 0.6 } });
    // a place's handout comes from the library and goes onto the table
    const ho = t.pic('handouts');
    const p = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Old mill', ho: { path: ho }, x: 5, y: 5 }).selected;
    const mk = M(t, world).marks.find((m) => m.id === p);
    t.ok(mk.ho && mk.ho.path === ho && mk.ho.rel, 'its handout is a library reference (it travels with the campaign)', mk.ho);
    t.handle('mark.remove', { mapId: world, id: p });
  });
};
