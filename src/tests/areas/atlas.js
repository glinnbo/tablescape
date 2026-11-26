// The Cartographer (Beta 3.11; redone in Beta 3.12): the campaign's atlas, its world and regional maps on the TV as an
// immersive view, and the Map table, the window they are worked on in
'use strict';

module.exports = (area) => {
  area.title('Cartographer: world and regional maps');
  let world = null; let region = null; let battle = null;
  const A = (t) => t.store.atlas();
  const M = (t, id) => t.store.map(id);
  const tvA = (t) => t.t(`window.__table.debug().atlas`);
  const shownOn = async (t, id) => t.until(async () => { const a = await tvA(t); return a && a.on && a.id === id && a.ready && !a.busy && a; }, 15000, 'the map on the TV');
  const W = (t, code) => t.g(`(() => { const w = Play.Atlas.win; return w ? (${code}) : null; })()`);
  // the Map table, open on a map, its picture painted
  const openTable = async (t, id) => {
    t.gm().webContents.focus();
    await t.g(`Play.TB.openPanel('atlas')`);
    t.handle('atlas.open', { id });
    return t.until(async () => { const d = await W(t, 'w.debug()'); return d && d.map === id && d.ed && d.ed.ready && d; }, 12000, 'the Map table with its map');
  };
  const tool = async (t, id) => { const r = await t.rect(`.mt-tool[data-id="${id}"]`); await t.click(r.cx, r.cy); await t.until(async () => (await W(t, 'w.debug().tool')) === id, 3000, `the ${id} tool`); };
  const scr = (t, p) => W(t, `w.screen(${p.x}, ${p.y})`);
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
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the home screen');
    t.ok(fs.existsSync(path.join(dir, 'maps', `${world}.json`)), 'its file is kept');
    t.handle('campaign.open', { id }); t.handle('campaign.play');
    await t.until(() => t.g(`document.body.dataset.screen === 'play' && !!Play.state().map`), 8000, 'the campaign to open again');
    t.eq(A(t).maps.map((x) => x.id), [world, region], 'the atlas after opening again');
    t.ok(M(t, world) && M(t, world).bg, 'the world map with its picture');
    await t.send(battle);
  });

  area.quick('a world map goes on the TV with the table\'s map change, the battlemap rests under it; off again, it is as it was', async (t) => {
    await t.send(battle);
    const runs0 = (await t.tvDebug()).mapInk.runs;
    const r = t.handle('table.send', { id: world }); // (Send to table works for it too)
    t.ok(r && r.ok, 'on the table', r);
    t.eq(t.state.liveMapId, battle, 'the battlemap stays the map on the table underneath');
    t.eq(t.state.editMapId, battle, 'and the map the battlemap editor works on');
    t.eq(t.state.atlasEdit, world, 'the Map table works on the world map');
    const a = await shownOn(t, world);
    t.ok(a.surface && a.surface.w > 500, 'its picture is painted', a.surface);
    t.eq((await t.tvDebug()).mapInk.runs, runs0 + 1, 'the map change ran once (ink, the style of this table)');
    await t.until(async () => (await tvA(t)).resting, 4000, 'the battlemap to rest');
    t.eq(await t.t(`getComputedStyle(document.getElementById('table-stage')).visibility`), 'hidden', 'nothing of the battlemap is drawn');
    t.eq(A(t).maps.find((x) => x.id === world).found, true, 'a map on the table is a map the party has found');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return x && !x.on && !x.busy && !x.resting; }, 8000, 'the map to leave the TV');
    t.eq((await t.tvDebug()).mapInk.runs, runs0 + 2, 'it left with the map change too');
    t.eq(await t.t(`getComputedStyle(document.getElementById('table-stage')).visibility`), 'visible', 'the battlemap is drawn again');
    t.eq(t.state.liveMapId, battle, 'which is still on the table');
    // a battlemap sent to the table takes the world map off it
    t.handle('atlas.show', { id: world }); await shownOn(t, world);
    await t.send(battle);
    t.eq(t.state.atlas, null, 'a battlemap sent to the table takes it off');
    await t.until(async () => { const x = await tvA(t); return x && !x.on && !x.resting; }, 8000, 'the world map to be gone from the TV');
    // a plain fade when the table changes maps that way
    const was = t.settings.looks; const style = t.settings.tableStyle;
    await t.g(`window.ts.settings({ looks: { map: 'fade', talk: 'style', init: 'style', round: 'style' } })`);
    await t.until(() => (t.settings.looks || {}).map === 'fade', 3000, 'the setting');
    await t.sleep(300);
    const runs1 = (await t.tvDebug()).mapInk.runs;
    t.handle('atlas.show', { id: world }); await shownOn(t, world);
    t.eq((await t.tvDebug()).mapInk.runs, runs1, 'no ink with the plain fade');
    t.handle('atlas.hide', {});
    await t.until(async () => !(await tvA(t)).on, 6000, 'the map to fade away');
    await t.g(`window.ts.settings(${JSON.stringify({ looks: was, tableStyle: style })})`);
    await t.sleep(300);
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

  area.quick('places and routes stand on the TV: a medallion, a diamond or a pin with its icon; a route counts its cells; a hidden place stays away', async (t) => {
    t.handle('atlas.show', { id: world });
    const a = await shownOn(t, world);
    const R = a.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, type: 'hex-flat', size: 1, ox: 0, oy: 0, unit: { n: 1, name: 'day of travel' } });
    const place = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Kintsugi', sub: 'Seat of the shogun', note: 'The gates close at dusk.', to: region, ...at(0.5, 0.5) }).selected;
    t.eq([M(t, world).marks[0].style, M(t, world).marks[0].icon], ['medallion', 'flag'], 'a place starts as a medallion with a flag');
    const dia = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Hollow Reach', style: 'diamond', icon: 'harbour', color: '#6fb4ff', ...at(0.6, 0.45) }).selected;
    const pin = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Secret cove', style: 'pin', icon: 'no such icon!', hidden: true, ...at(0.45, 0.55) }).selected;
    t.eq(M(t, world).marks.find((m) => m.id === pin).icon, 'flag', 'an icon the app does not know becomes the flag');
    t.handle('mark.update', { mapId: world, id: pin, style: 'banner', icon: 'cave' });
    t.eq([M(t, world).marks.find((m) => m.id === pin).style, M(t, world).marks.find((m) => m.id === pin).icon], ['pin', 'cave'], 'a marker the app does not know is refused, the icon taken');
    const route = t.handle('mark.add', { mapId: world, kind: 'route', title: 'The pilgrim road', ...at(0.4, 0.6) }).selected;
    const g = M(t, world).grid; const Geom = require('../../renderer/geom');
    const c0 = Geom.hexAt(g, at(0.4, 0.6).x, at(0.4, 0.6).y);
    const h1 = Geom.hexCenter(g, c0.q + 4, c0.r); const h2 = Geom.hexCenter(g, c0.q + 4, c0.r - 3);
    t.handle('mark.route', { mapId: world, id: route, x: h1.x, y: h1.y }); t.handle('mark.route', { mapId: world, id: route, x: h2.x, y: h2.y });
    t.eq(Geom.routeLabel(g, M(t, world).marks.find((m) => m.id === route)), '7 days of travel', 'four hexes and three more');
    // standing on the TV (the hidden one is the GM's to know)
    const st = await t.until(async () => { const x = (await tvA(t)).standing; return x.length === 3 && x.every((s) => s.shown) && x; }, 6000, 'the two places and the route to stand on the TV');
    t.eq(st.map((s) => [s.kind, s.title, s.sub, s.style || null, s.icon || null]), [['place', 'Kintsugi', 'Seat of the shogun', 'medallion', 'flag'], ['place', 'Hollow Reach', '', 'diamond', 'harbour'], ['route', 'The pilgrim road', '7 days of travel', null, null]], 'what stands there');
    // (measured once the camera rests: while it still glides, the place and its spot are read a moment apart)
    await t.until(async () => { const x = await tvA(t); return Math.abs(x.cam.cx - x.camT.cx) + Math.abs(x.cam.cy - x.camT.cy) + Math.abs(x.cam.S - x.camT.S) < 1e-3; }, 6000, 'the camera to rest');
    const both = await t.t(`(() => { const s = window.__table.debug().atlas.standing[0]; const w = window.__table.atlasProject(${at(0.5, 0.5).x}, ${at(0.5, 0.5).y}); return [s.x, w.x]; })()`);
    t.near(both[0], both[1], 1, 'the place stands on its spot');
    const dom = await t.t(`[...document.querySelectorAll('#table-atlas .atl-s.kind-place')].map((e) => [(e.className.match(/st-[a-z]+/) || [''])[0], !!e.querySelector('.atl-shape'), !!e.querySelector('.atl-ico svg'), (e.querySelector('.atl-plate b, .atl-words b') || {}).textContent])`);
    t.eq(dom, [['st-medallion', true, true, 'Kintsugi'], ['st-diamond', true, true, 'Hollow Reach']], 'each drawn as its marker, with its icon and its name');
    t.handle('mark.update', { mapId: world, id: pin, hidden: false });
    await t.until(async () => (await tvA(t)).standing.some((s) => s.title === 'Secret cove' && s.style === 'pin' && s.icon === 'cave'), 4000, 'the place shown now, as a pin with a cave');
    t.handle('mark.remove', { mapId: world, id: pin }); t.handle('mark.remove', { mapId: world, id: dia });
    // its note, next to it; once more puts it away
    t.handle('atlas.note', { id: place });
    await t.until(async () => (await tvA(t)).standing[0].note === 'The gates close at dusk.', 4000, 'its note on the TV');
    t.eq(await t.t(`(document.querySelector('.atl-note') || {}).textContent`), 'The gates close at dusk.', 'as written');
    t.handle('atlas.note', { id: place });
    await t.until(async () => !(await tvA(t)).standing[0].note, 4000, 'the note to go');
    // it leads to a regional map: the TV changes to it, and back to the world
    t.handle('atlas.show', { id: M(t, world).marks.find((m) => m.id === place).to });
    await shownOn(t, region);
    t.eq(t.state.atlasEdit, region, 'the Map table follows to the region'); t.eq(t.state.editMapId, battle, 'the battlemap editor stays where it is');
    t.handle('atlas.show', { id: A(t).world });
    await shownOn(t, world);
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
  });

  area.quick('the mist and sunshine are kept with each map, within their limits; its weather is the battlemap\'s and falls on the TV', async (t) => {
    t.eq(M(t, world).atlas, undefined, 'a map starts without any (cloud, half way in, a little at the screen\'s edge)');
    t.handle('atlasmap.set', { mapId: world, mist: 'dark', reach: 0.8, rim: 7, weather: { sun: 0.6, rain: 0.7, fire: 1 } });
    t.eq(M(t, world).atlas, { mist: 'dark', reach: 0.8, rim: 1, weather: { sun: 0.6 } }, 'kept, tidied (sunshine is the one weather a world map keeps here)');
    t.handle('atlasmap.set', { mapId: world, mist: 'purple', weather: { sun: 0 } });
    t.eq(M(t, world).atlas, { mist: 'cloud', reach: 0.8, rim: 1, weather: {} }, 'an unknown mist is cloud; sunshine set to nothing is taken away');
    t.eq(M(t, region).atlas, undefined, 'the other map keeps its own');
    t.handle('history.undo', { mapId: world });
    t.eq(M(t, world).atlas.weather, { sun: 0.6 }, 'Undo for this map takes the last change back');
    t.eq(t.state.editMapId, battle, 'the battlemap is untouched by it');
    t.handle('atlas.show', { id: world });
    await shownOn(t, world);
    const air = (await tvA(t)).air;
    t.eq([air.dark, air.reach, air.rim, air.sun], [true, 0.8, 1, 0.6], 'what the TV draws');
    // the weather: a mix as on a battlemap, drawn over the world map
    t.eq((await tvA(t)).wx, false, 'no weather yet');
    const FXDATA = require('../../renderer/fx-data');
    const storm = FXDATA.WEATHER.find((w) => w.id === 'storm');
    t.handle('weather.preset', { mapId: world, name: storm.label, layers: storm.layers });
    t.eq(M(t, world).weather.layers.map((l) => l.type), ['rain', 'splash', 'clouds', 'lightning'], 'a thunderstorm on the world map');
    t.eq(M(t, battle).weather.layers.length, 0, 'none of it on the battlemap');
    await t.until(async () => (await tvA(t)).wx === true, 5000, 'the weather to be drawn on the TV');
    const drawn = await t.until(async () => { const n = await t.t(`(() => { const c = document.querySelector('#table-atlas .atl-wx'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++; return n; })()`); return n > 40 && n; }, 6000, 'rain on its canvas');
    t.ok(drawn > 40, 'it rains over the map', drawn);
    t.handle('weather.preset', { mapId: world, name: 'None', layers: [] });
    await t.until(async () => (await tvA(t)).wx === false, 5000, 'the weather to stop');
    t.handle('atlasmap.set', { mapId: world, mist: 'cloud', reach: 0.5, rim: 0.3, weather: { sun: 0 } });
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
  });

  area.quick('the Cartographer opens the Map table: a window of its own; the battlemap editor keeps its map and rests meanwhile', async (t) => {
    t.handle('edit.open', { id: battle }); await t.settle();
    t.eq(await t.g(`Play.view().playing`), true, 'the battlemap plays');
    const d = await openTable(t, world);
    t.eq((await t.panels()).find((p) => p.id === 'atlas').title, 'Cartographer', 'its title (one name: E1)');
    t.eq([d.mode, d.ed.plain], ['flat', true], 'it opens on the flat map');
    t.eq(t.state.editMapId, battle, 'the battlemap editor still has its map');
    t.eq(await t.g(`Play.state().map.id`), battle, 'and shows it');
    t.eq(await t.g(`Play.view().playing`), false, 'which rests while the window is open');
    // a world map is never opened in the battlemap editor
    const r = t.handle('edit.open', { id: region });
    t.ok(r && r.ok && r.atlas, 'asked to edit a regional map', r);
    t.eq([t.state.editMapId, t.state.atlasEdit], [battle, region], 'the Map table takes it, the editor stays');
    await t.until(async () => (await W(t, 'w.debug().map')) === region, 4000, 'the window to show the region');
    // the list of the atlas
    t.eq(await t.g(`[...document.querySelectorAll('.mt-tool')].map((b) => b.dataset.id)`), ['move', 'place', 'route', 'draw', 'write', 'erase', 'maps', 'assets', 'grid', 'view', 'weather'], 'the tools: what is used all the time first, what is set once for a map last');
    const gap = await t.g(`document.querySelector('.mt-tool[data-id="maps"]').getBoundingClientRect().top - document.querySelector('.mt-tool[data-id="erase"]').getBoundingClientRect().bottom`);
    t.ok(gap > 20, 'the two groups stand apart', gap);
    await tool(t, 'maps');
    await t.until(async () => (await t.count('.fp[data-id="atlas"] .atl-row')) === 2, 4000, 'both maps in the list');
    t.eq(await t.g(`[...document.querySelectorAll('.fp[data-id="atlas"] .atl-name b')].map((b) => b.textContent)`), ['The world', 'The north'], 'their names');
    t.eq(await t.g(`document.querySelector('.fp[data-id="atlas"] .atl-row.on').dataset.id`), region, 'the one being worked on is marked');
    const row = await t.rect(`.fp[data-id="atlas"] .atl-row[data-id="${world}"] .atl-open`);
    await t.click(row.cx, row.cy);
    await t.until(async () => (await W(t, 'w.debug().map')) === world, 4000, 'a click on the world map to open it');
    // every tool has its choices at the side
    for (const id of ['move', 'place', 'route', 'draw', 'write', 'erase', 'assets', 'grid', 'view', 'weather']) {
      await tool(t, id);
      t.ok((await t.count('.mt-opts > *')) >= 2, `${id}: its choices stand at the side`, await t.text('.mt-opts'));
    }
    const wx = await t.g(`({ mixes: [...document.querySelectorAll('.mt-opts .wx-presets .tile')].map((e) => e.textContent.trim()), last: [...document.querySelectorAll('.mt-opts .ctl-label')].pop().textContent })`);
    t.ok(wx.mixes.includes('Thunderstorm') && wx.mixes.includes('Blizzard'), 'the weather: the battlemap\'s mixes', wx.mixes);
    t.eq(wx.last, 'Sunshine', 'and sunshine');
    await t.clickText('.mt-opts .wx-presets .tile', 'Snow');
    await t.until(() => M(t, world).weather.layers.some((l) => l.type === 'snow'), 3000, 'a click on Snow to make it snow on the world map');
    t.eq(M(t, battle).weather.layers.length, 0, 'not on the battlemap');
    t.handle('weather.preset', { mapId: world, name: 'None', layers: [] });
    t.eq(await t.badText(), [], 'nothing odd written anywhere');
    // closed: the battlemap plays again
    await t.g(`Play.Floats.hide('atlas')`);
    await t.until(async () => (await t.g(`Play.view().playing`)) === true, 3000, 'the battlemap to play again');
    t.eq(await t.g(`Play.Atlas.isOpen()`), false, 'the window is gone');
  });

  area.quick('in the Map table: a place by a click, named and dressed at the side; a route by clicks; drawn and rubbed out; Undo', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('draw.clear', { mapId: world });
    t.handle('grid.update', { mapId: world, type: 'square', size: 1, ox: 0, oy: 0, unit: { n: 6, name: 'mile' } });
    const d = await openTable(t, world);
    const R = d.ed.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    // a place
    await tool(t, 'place');
    const p0 = at(0.4, 0.4); const s0 = await scr(t, p0);
    await t.click(s0.x, s0.y);
    const pl = await t.until(() => M(t, world).marks.find((m) => m.kind === 'place'), 4000, 'the place');
    t.near(pl.x, p0.x, R.w * 0.004, 'where the click was (across)'); t.near(pl.y, p0.y, R.w * 0.004, 'and down');
    await t.until(() => t.g(`document.activeElement && document.activeElement.classList.contains('mt-title')`), 3000, 'its name to be ready for typing');
    await t.type('Emberfall');
    await t.until(() => M(t, world).marks.find((m) => m.id === pl.id).title === 'Emberfall', 3000, 'the name typed');
    if (!(await t.g(`document.querySelector('.mt-opts details.mt-look').open`))) { const fold = await t.rect('.mt-opts details.mt-look > summary'); await t.click(fold.cx, fold.cy); } // (Second Builder (second-cartographer-polish): how it looks is folded under Look)
    await t.clickText('.mt-opts .seg-btn', 'Diamond');
    const ic = await t.rect('.mt-opts .mt-icon[data-v="tower"]'); await t.click(ic.cx, ic.cy);
    await t.until(() => { const m = M(t, world).marks.find((x) => x.id === pl.id); return m.style === 'diamond' && m.icon === 'tower'; }, 3000, 'a diamond with a tower');
    await t.until(async () => (await W(t, 'w.debug().ed.standing')).some((s) => s.title === 'Emberfall' && s.style === 'diamond' && s.shown), 4000, 'it stands in the picture');
    // locked, it stays where it is (but it is picked); unlocked, it is dragged somewhere else
    const s1 = await scr(t, { x: pl.x, y: pl.y }); const p2 = at(0.3, 0.5); const s2 = await scr(t, p2);
    await tool(t, 'move');
    t.eq(await W(t, 'w.debug().locks'), [true, true], 'markers and routes are locked at first');
    const was = { x: M(t, world).marks.find((m) => m.id === pl.id).x, y: M(t, world).marks.find((m) => m.id === pl.id).y };
    await t.drag({ x: s1.x, y: s1.y - 14 }, { x: s2.x, y: s2.y - 14 });
    t.eq([M(t, world).marks.find((m) => m.id === pl.id).x, M(t, world).marks.find((m) => m.id === pl.id).y], [was.x, was.y], 'locked: dragging it moves nothing');
    t.eq((await W(t, 'w.debug().sel')).id, pl.id, 'but it is picked');
    const lk = await t.rect('.mt-lock[data-k="lockMarks"]'); await t.click(lk.cx, lk.cy);
    await t.until(async () => (await W(t, 'w.debug().locks'))[0] === false, 3000, 'the markers\' lock to open');
    await t.drag({ x: s1.x, y: s1.y - 14 }, { x: s2.x, y: s2.y - 14 });
    await t.until(() => Math.abs(M(t, world).marks.find((m) => m.id === pl.id).x - p2.x) < R.w * 0.006, 4000, 'the place to follow the drag');
    t.near(M(t, world).marks.find((m) => m.id === pl.id).y, p2.y, R.w * 0.006, 'down too');
    // a route: every click a point, Enter ends it
    await tool(t, 'route');
    const pts = [[0.5, 0.45], [0.6, 0.45], [0.7, 0.45], [0.7, 0.6]].map(([fx, fy]) => at(fx, fy));
    for (const p of pts) { const s = await scr(t, p); await t.click(s.x, s.y); await t.sleep(320); }
    await t.key('Enter');
    const routes = M(t, world).marks.filter((m) => m.kind === 'route');
    t.eq(routes.length, 1, 'one route'); t.eq(routes[0].pts.length / 2, 4, 'a point for every click', routes[0].pts);
    await t.until(async () => { const x = await W(t, 'w.debug()'); return x.tool === 'move' && x.sel && x.sel.id === routes[0].id; }, 3000, 'the Move tool to be back, with the route picked');
    // a second route, ended by a double click (its second click adds no point)
    await tool(t, 'route');
    const more = [[0.5, 0.7], [0.6, 0.7]].map(([fx, fy]) => at(fx, fy));
    for (const p of more) { const q = await scr(t, p); await t.click(q.x, q.y); await t.sleep(450); }
    const end = await scr(t, at(0.65, 0.75));
    await t.click(end.x, end.y); await t.mouse('mouseDown', end.x, end.y); await t.mouse('mouseUp', end.x, end.y);
    await t.until(async () => (await W(t, 'w.debug().routeId')) === null, 3000, 'the double click to end the route');
    await t.sleep(300);
    const second = M(t, world).marks.filter((m) => m.kind === 'route')[1];
    t.eq(second.pts.length / 2, 3, 'three points: the double click set the last one once', second.pts);
    t.handle('mark.remove', { mapId: world, id: second.id });
    // a third, ended by a right-click: no round menu, the Move tool is back; one with a single point is taken away again
    await tool(t, 'route');
    for (const p of [at(0.2, 0.2), at(0.3, 0.2)]) { const q = await scr(t, p); await t.click(q.x, q.y); await t.sleep(450); }
    const rc = await scr(t, at(0.4, 0.3)); await t.click(rc.x, rc.y, 'right');
    await t.until(async () => { const x = await W(t, 'w.debug()'); return x.routeId === null && x.tool === 'move'; }, 3000, 'the right-click to end the route');
    t.eq(await t.g(`!!document.querySelector('#radial')`), false, 'without the round menu');
    const third = M(t, world).marks.filter((m) => m.kind === 'route')[1];
    t.eq(third.pts.length / 2, 2, 'the right-click added no point', third.pts);
    t.handle('mark.remove', { mapId: world, id: third.id });
    await tool(t, 'route');
    { const q = await scr(t, at(0.2, 0.25)); await t.click(q.x, q.y); await t.sleep(450); await t.click(q.x + 30, q.y, 'right'); }
    await t.until(async () => (await W(t, 'w.debug().tool')) === 'move', 3000, 'the route to end');
    await t.until(() => M(t, world).marks.filter((m) => m.kind === 'route').length === 1, 3000, 'a route of one point to be taken away');
    t.ok(/miles$/.test(require('../../renderer/geom').routeLabel(M(t, world).grid, routes[0])), 'counted in miles', require('../../renderer/geom').routeLabel(M(t, world).grid, routes[0]));
    t.eq(await W(t, 'w.debug().routeId'), null, 'Enter ended it');
    // drawn with the pen, rubbed out, and back with Undo
    await tool(t, 'draw');
    const a = at(0.2, 0.8); const b = at(0.35, 0.8); const sa = await scr(t, a); const sb = await scr(t, b);
    await t.drag(sa, sb);
    const pen = await t.until(() => M(t, world).draw.find((x) => x.kind === 'pen'), 4000, 'the stroke');
    t.ok(pen.pts.length >= 6, 'a line of points', pen.pts.length);
    t.near(pen.pts[0], a.x, R.w * 0.004, 'from where the drag began'); t.near(pen.pts[pen.pts.length - 2], b.x, R.w * 0.006, 'to where it ended');
    await tool(t, 'erase');
    const mid = await scr(t, at(0.275, 0.8));
    await t.click(mid.x, mid.y);
    await t.until(() => !M(t, world).draw.length, 4000, 'the stroke to be rubbed out');
    const un = await t.rect('.mt-bar .icon-btn[aria-label^="Undo"]'); await t.click(un.cx, un.cy);
    await t.until(() => M(t, world).draw.length === 1, 4000, 'Undo to bring it back');
    t.eq(M(t, battle).draw.length, 0, 'the battlemap has none of it');
    await t.g(`Play.Floats.hide('atlas')`);
  });

  area.quick('the TV\'s frame is moved in the Map table; "As on the TV" shows it tilted, and the mouse moves the TV\'s camera there', async (t) => {
    t.handle('atlas.look', { look: { tilt: 0.6, bulge: 0.6, turn: 0 } });
    const d = await openTable(t, world);
    await tool(t, 'move');
    const v0 = { ...M(t, world).view };
    const tab = await t.until(() => t.rect('.mt-tv-knob'), 3000, 'the handle of the TV\'s frame');
    const inch = d.ed.cam.S / (d.size.H / 2); // inches of the map for a pixel of the picture
    await t.drag({ x: tab.cx, y: tab.cy }, { x: tab.cx + 60, y: tab.cy + 30 });
    await t.until(() => Math.abs(M(t, world).view.x - v0.x) > 0.01, 4000, 'the frame to move');
    const v1 = { ...M(t, world).view };
    t.near((v0.x - v1.x) / v1.zoom, 60 * inch, 60 * inch * 0.08 + 0.01, 'by as much as it was dragged (across)'); t.near((v0.y - v1.y) / v1.zoom, 30 * inch, 30 * inch * 0.1 + 0.01, 'and down');
    t.near(v1.zoom, v0.zoom, 1e-6, 'as big as before');
    t.eq(M(t, battle).view.x === v1.x && M(t, battle).view.y === v1.y, false, 'the battlemap\'s frame is another one');
    // as on the TV
    await t.clickText('.mt-bar .seg-btn', 'As on the TV');
    const e = await t.until(async () => { const x = await W(t, 'w.debug()'); return x.mode === 'tv' && !x.ed.plain && Math.abs(x.ed.look.tilt - 0.6) < 0.01 && x; }, 5000, 'the picture as on the TV');
    const tin = t.g(`(() => { const v = Play.state().view; return v.world.h / v.ppi; })()`);
    t.near(e.ed.cam.S, (await tin) / (2 * v1.zoom), 0.01, 'its camera is the TV\'s');
    t.near(e.size.W / e.size.H, await t.g(`Play.state().view.world.w / Play.state().view.world.h`), 0.02, 'in the shape of the TV');
    t.eq(await t.g(`document.querySelector('.mt-tv').hidden`), true, 'no frame there: the whole picture is the TV');
    const box = await t.rect('.mt-wrap');
    const from = { x: box.x + box.w * 0.5, y: box.y + box.h * 0.9 }; // (an empty spot: on a place or a label the drag would move that)
    await t.drag(from, { x: from.x - 50, y: from.y });
    await t.until(() => Math.abs(M(t, world).view.x - v1.x) / v1.zoom > 0.05, 4000, 'the TV\'s camera to follow the drag');
    t.ok(M(t, world).view.x < v1.x, 'dragged to the left, the map moves left (the TV looks further right)', [v1.x, M(t, world).view.x]);
    await t.clickText('.mt-bar .seg-btn', 'Flat');
    t.handle('view.update', { mapId: world, ...v0 });
    await t.g(`Play.Floats.hide('atlas')`);
  });

  area.quick('a double click on a place opens the map behind it: asked first, then the TV dives in; Zoom out goes back; right-click makes things', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('atlas.show', { id: world });
    const a = await shownOn(t, world);
    const R = a.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    const gate = t.handle('mark.add', { mapId: world, kind: 'place', title: 'North gate', to: region, ...at(0.6, 0.4) }).selected;
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    await tool(t, 'move');
    t.eq(await t.g(`document.querySelector('.mt-out').hidden`), true, 'no Zoom out on the world map');
    // a double click on the place: asked first
    const s = await scr(t, at(0.6, 0.4));
    await t.mouse('mouseMove', s.x, s.y - 14); await t.mouse('mouseDown', s.x, s.y - 14); await t.mouse('mouseUp', s.x, s.y - 14);
    await t.mouse('mouseDown', s.x, s.y - 14); await t.mouse('mouseUp', s.x, s.y - 14);
    await t.until(async () => (await t.text('.modal h2')) === 'Open The north?', 4000, 'the question');
    t.eq(t.state.atlas.id, world, 'nothing opened yet');
    await t.clickText('.modal .btn', 'Open');
    await t.until(() => t.state.atlas.id === region, 3000, 'the region to be opened');
    t.eq([t.state.atlas.via.dir, t.state.atlas.via.x, t.state.atlas.via.y], ['in', M(t, world).marks.find((m) => m.id === gate).x, M(t, world).marks.find((m) => m.id === gate).y], 'the TV is told to dive into the place');
    const runs = (await t.tvDebug()).mapInk.runs;
    const seen = new Set();
    const b = await t.until(async () => { const x = await tvA(t); if (x.trip) seen.add(x.trip); return x.id === region && !x.trip && x.ready && x; }, 12000, 'the TV to arrive on the region');
    t.ok(seen.has('leave') || seen.has('wait') || seen.has('arrive'), 'it travelled there (dive, mist, the new map)', [...seen]);
    t.eq((await t.tvDebug()).mapInk.runs, runs, 'through the mist, not with the table\'s map change');
    t.near(b.veil, 0, 0.001, 'the mist has opened again'); t.near(b.cam.S, b.camT.S, 0.01, 'the camera has settled on the region\'s view');
    await t.until(async () => (await W(t, 'w.debug().map')) === region, 4000, 'the Map table to follow');
    // Zoom out: back to the world map, through the mist, to the view it had
    const out = await t.until(async () => { const r = await t.rect('.mt-out'); return r && r.w > 10 && r; }, 4000, 'Zoom out on the regional map');
    await t.click(out.cx, out.cy);
    await t.until(() => t.state.atlas.id === world, 3000, 'the world map to be asked for');
    t.eq(t.state.atlas.via.dir, 'out', 'the TV is told to pull back out');
    t.near(t.state.atlas.via.x, at(0.6, 0.4).x, 0.01, 'to the place that leads there');
    const c = await t.until(async () => { const x = await tvA(t); return x.id === world && !x.trip && x.ready && x; }, 12000, 'the TV to be back on the world map');
    t.near(c.cam.cx, a.cam.cx, 0.02, 'where it looked before (across)'); t.near(c.cam.S, a.cam.S, 0.02, 'as far away as before');
    // right-click on empty map: a round menu to make things; "Place here" sets a place there
    await t.until(async () => (await W(t, 'w.debug().map')) === world, 4000, 'the Map table back on the world map');
    const e = await scr(t, at(0.3, 0.7));
    await t.click(e.x, e.y, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the round menu');
    t.eq(await t.g(`[...document.querySelectorAll('.radial-item span')].map((x) => x.textContent)`), ['Place here', 'Route from here', 'Write here', 'How far from here', 'Asset here', 'TV looks here'], 'what can be made here'); // (Second Builder (second-cartographer-polish): How far from here)
    await t.clickText('.radial-item', 'Place here');
    const made = await t.until(() => M(t, world).marks.find((m) => m.kind === 'place' && m.id !== gate), 4000, 'the place');
    t.near(made.x, at(0.3, 0.7).x, R.w * 0.005, 'where the right-click was');
    // right-click on a place: what can be done with it
    await t.sleep(300);
    await t.click(s.x, s.y - 14, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the round menu of the place');
    t.eq(await t.g(`[...document.querySelectorAll('.radial-item span')].map((x) => x.textContent)`), ['Open The north', 'How far from here', 'Hide', 'Remove'], 'open its map, hide it, remove it');
    await t.clickText('.radial-item', 'Hide');
    await t.until(() => M(t, world).marks.find((m) => m.id === gate).hidden === true, 3000, 'the place to be hidden');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  area.quick('a route: a slim line with its look; its points snap to the grid, are dragged, added and taken out; its label stands at its middle', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, type: 'square', size: 1, ox: 0, oy: 0, show: true, unit: { n: 1, name: 'day of travel' } });
    // what is kept with it, within limits
    const id = t.handle('mark.add', { mapId: world, kind: 'route', x: 2.5, y: 2.5, look: 'zigzag', width: 9, arrow: false }).selected;
    const R0 = () => M(t, world).marks.find((m) => m.id === id);
    t.eq([R0().look, R0().width, R0().arrow, R0().round, R0().walked], ['dash', 3, false, true, 0], 'a route starts dashed and rounded; an unknown line is dashed, a width stays within thin … bold');
    t.handle('mark.update', { mapId: world, id, look: 'dots', width: 1, arrow: true, round: false, walked: 3 });
    t.eq([R0().look, R0().width, R0().arrow, R0().round, R0().walked], ['dots', 1, true, false, 1], 'its look changed; it cannot be walked further than its end');
    t.handle('mark.update', { mapId: world, id, look: 'dash', width: 2, round: true, walked: 0.4 });
    for (const [x, y] of [[6.5, 2.5], [6.5, 6.5]]) t.handle('mark.route', { mapId: world, id, x, y });
    t.eq([R0().x, R0().y], [6.5, 2.5], 'its label stands at its middle, measured along it');
    t.handle('mark.route', { mapId: world, id, at: 1, x: 8.5, y: 2.5 });
    t.eq(R0().pts, [2.5, 2.5, 8.5, 2.5, 6.5, 6.5], 'a point moved');
    t.handle('mark.route', { mapId: world, id, insert: 1, x: 4.5, y: 3.5 });
    t.eq(R0().pts, [2.5, 2.5, 4.5, 3.5, 8.5, 2.5, 6.5, 6.5], 'a point put in');
    t.handle('mark.route', { mapId: world, id, remove: 2 });
    t.eq(R0().pts, [2.5, 2.5, 4.5, 3.5, 6.5, 6.5], 'a point taken out');
    t.handle('mark.route', { mapId: world, id, at: 9, x: 1, y: 1 }); t.handle('mark.route', { mapId: world, id, remove: -1 }); t.handle('mark.route', { mapId: world, id, insert: 7, x: 1, y: 1 });
    t.eq(R0().pts, [2.5, 2.5, 4.5, 3.5, 6.5, 6.5], 'a point that is not there changes nothing');
    t.handle('mark.remove', { mapId: world, id });
    // in the Map table: clicks snap to the middle of the cells
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const R = d.ed.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    await tool(t, 'route');
    t.eq(await t.g(`[...document.querySelectorAll('.mt-opts .ctl-label')].map((e) => e.textContent)`), ['Colour', 'Line', 'Width', 'Arrow at the end', 'Rounded bends'], 'how the next route is drawn');
    await t.clickText('.mt-opts .seg-btn', 'Solid');
    const clicks = [at(0.3, 0.3), at(0.5, 0.3), at(0.5, 0.5)];
    for (const p of clicks) { const q = await scr(t, p); await t.click(q.x, q.y); await t.sleep(450); }
    // (the pointer moved on: what the next leg would add stands next to it)
    const hov = await scr(t, at(0.6, 0.5)); await t.mouse('mouseMove', hov.x, hov.y);
    const say = await t.until(async () => { const x = await t.text('.mt-count'); return /^\+\d+ · \d+ days of travel$/.test(x || '') && x; }, 3000, 'what the next leg adds');
    t.ok(/^\+\d+ · \d+ days of travel$/.test(say), 'counted while drawing', say);
    await t.key('Enter');
    const r = M(t, world).marks.find((m) => m.kind === 'route');
    t.eq(r.look, 'solid', 'drawn the way that was chosen');
    const frac = (v) => Math.abs(((v % 1) + 1) % 1 - 0.5);
    t.ok(r.pts.every((v) => frac(v) < 0.002), 'every point on the middle of a cell', r.pts);
    t.near(r.pts[0], clicks[0].x, 0.51, 'in the cell that was clicked');
    // picked, it glows; with the routes\' lock open its points are handles
    await tool(t, 'move');
    await t.g(`Play.Atlas.win.select({ kind: 'mark', id: ${JSON.stringify(r.id)} })`);
    await t.until(() => t.g(`getComputedStyle(document.querySelector('.mt-rglow')).display !== 'none'`), 3000, 'the glow of the picked route');
    t.eq(await t.count('.mt-rh:not([hidden])'), 0, 'locked: no handles');
    const lk = await t.rect('.mt-lock[data-k="lockRoutes"]'); await t.click(lk.cx, lk.cy);
    await t.until(async () => (await t.count('.mt-rh:not([hidden])')) === 3, 3000, 'a handle for every point');
    const h1 = await t.rect('.mt-rh[data-i="1"]'); const to = await scr(t, at(0.6, 0.2));
    await t.drag({ x: h1.cx, y: h1.cy }, to);
    await t.until(() => Math.abs(M(t, world).marks.find((m) => m.id === r.id).pts[2] - at(0.6, 0.2).x) < 1.01, 4000, 'the point to follow its handle'); // (the cell under the pointer, or its neighbour when the pointer ends on their border)
    t.ok(M(t, world).marks.find((m) => m.id === r.id).pts.every((v) => frac(v) < 0.002), 'and to land on the middle of a cell', M(t, world).marks.find((m) => m.id === r.id).pts);
    // a click on its line puts a point in; a right-click on a handle takes one out
    const a0 = M(t, world).marks.find((m) => m.id === r.id).pts; const midPt = await scr(t, { x: (a0[0] + a0[2]) / 2, y: (a0[1] + a0[3]) / 2 });
    await t.click(midPt.x, midPt.y);
    await t.until(() => M(t, world).marks.find((m) => m.id === r.id).pts.length === 8, 4000, 'one more point, on the line');
    const h0 = await t.rect('.mt-rh[data-i="3"]'); await t.click(h0.cx, h0.cy, 'right');
    await t.until(() => M(t, world).marks.find((m) => m.id === r.id).pts.length === 6, 4000, 'a point to be taken out');
    // the side: its look, and how far the party has come
    t.eq(await t.g(`[...document.querySelectorAll('.mt-opts .ctl-label')].map((e) => e.textContent)`), ['Colour', 'Line', 'Width', 'Arrow at the end', 'Rounded bends', 'Travelled'], 'what can be changed about a route');
    await t.click(lk.cx, lk.cy);
    // on the TV: its label on a plate at its middle
    t.handle('mark.update', { mapId: world, id: r.id, title: 'The pilgrim road' });
    t.handle('atlas.show', { id: world });
    await shownOn(t, world);
    const st = await t.until(async () => { const x = (await tvA(t)).standing.find((s) => s.kind === 'route'); return x && x.shown && x.title && x; }, 5000, 'the route\'s label on the TV'); // (Second Builder (second-cartographer-polish): with its name, not the moment before)
    t.ok(/days of travel$/.test(st.sub) && st.title === 'The pilgrim road', 'its name and its length', st);
    t.eq(await t.t(`!!document.querySelector('#table-atlas .atl-s.kind-route .atl-plate.dark b')`), true, 'on a plate');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
    t.handle('grid.update', { mapId: world, show: false });
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  area.quick('finishing touches: Move is the tool to come back to; markers are picked with any tool, only where they are painted; a route by its line; the round menu closes easily', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, show: false });
    let d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const R = d.ed.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    const place = t.handle('mark.add', { mapId: world, kind: 'place', title: 'Kanbari village of the long name', style: 'medallion', icon: 'crown', ...at(0.5, 0.5) }).selected;
    const route = t.handle('mark.add', { mapId: world, kind: 'route', ...at(0.2, 0.8) }).selected;
    t.handle('mark.route', { mapId: world, id: route, ...at(0.6, 0.8) });
    // the window opens with Move, whatever was used last
    await tool(t, 'weather');
    await t.g(`Play.Floats.hide('atlas')`);
    d = await openTable(t, world);
    t.eq(d.tool, 'move', 'opened again: the Move tool');
    // with another tool open (Weather), a click on a marker picks it and brings Move back
    await tool(t, 'weather');
    await t.until(async () => (await t.count('.mt-view .atl-s.kind-place .atl-plate')) === 1, 4000, 'the place in the picture');
    const shape = await t.rect('.mt-view .atl-s.kind-place .atl-shape'); const plate = await t.rect('.mt-view .atl-s.kind-place .atl-plate');
    await t.click(shape.cx, shape.y + shape.h * 0.35);
    await t.until(async () => { const x = await W(t, 'w.debug()'); return x.tool === 'move' && x.sel && x.sel.id === place; }, 3000, 'the marker to be picked, with the Move tool');
    await t.key('Escape');
    await t.until(async () => (await W(t, 'w.debug().sel')) === null, 3000, 'Esc to let go of it');
    // only what is painted counts: beside the marker, under the wide plate, there is nothing to click
    t.ok(plate.w > shape.w + 40, 'the plate is wider than the marker', [plate.w, shape.w]);
    await t.click(plate.x + 6, shape.y + shape.h * 0.5);
    await t.sleep(300);
    t.eq(await W(t, 'w.debug().sel'), null, 'a click beside the marker, under the plate\'s end, picks nothing');
    await t.click(plate.x + 6, plate.cy);
    await t.until(async () => { const x = await W(t, 'w.debug().sel'); return x && x.id === place; }, 3000, 'a click on the plate to pick it');
    // locked, it cannot be dragged: its lock flashes to say why
    if (!(await W(t, 'w.debug().locks'))[0]) { const lk = await t.rect('.mt-lock[data-k="lockMarks"]'); await t.click(lk.cx, lk.cy); await t.until(async () => (await W(t, 'w.debug().locks'))[0], 3000, 'the markers to be locked'); } // (an earlier check opened it)
    await t.drag({ x: shape.cx, y: shape.y + shape.h * 0.35 }, { x: shape.cx + 60, y: shape.y + shape.h * 0.35 + 20 });
    t.eq(await t.g(`document.querySelector('.mt-lock[data-k="lockMarks"]').classList.contains('flash')`), true, 'the markers\' lock flashes');
    t.near(M(t, world).marks.find((m) => m.id === place).x, at(0.5, 0.5).x, 0.002, 'and the marker stayed');
    // a route is picked by a click on its line
    await t.key('Escape');
    const on = await scr(t, at(0.3, 0.8));
    await t.click(on.x, on.y + 2);
    await t.until(async () => { const x = await W(t, 'w.debug().sel'); return x && x.id === route; }, 3000, 'a click on the route\'s line to pick it');
    await t.key('Escape');
    await t.click(on.x, on.y + 30);
    await t.sleep(300);
    t.eq(await W(t, 'w.debug().sel'), null, 'a click well beside the line picks nothing');
    // the round menu: a second right-click closes it (and opens no new one); so do Esc and a click on its middle
    const empty = await scr(t, at(0.75, 0.3)); const other = await scr(t, at(0.3, 0.3));
    const menu = () => t.g(`!!document.querySelector('#radial')`);
    await t.click(empty.x, empty.y, 'right'); await t.until(menu, 3000, 'the round menu');
    await t.click(other.x, other.y, 'right'); await t.sleep(400);
    t.eq(await menu(), false, 'a right-click again closes it');
    await t.sleep(300);
    await t.click(empty.x, empty.y, 'right'); await t.until(menu, 3000, 'the round menu again');
    await t.key('Escape'); await t.sleep(200);
    t.eq(await menu(), false, 'Esc closes it');
    await t.click(empty.x, empty.y, 'right'); await t.until(menu, 3000, 'the round menu once more');
    const mid = await t.rect('.radial-center'); await t.click(mid.cx, mid.cy); await t.sleep(200);
    t.eq(await menu(), false, 'a click on its middle closes it');
    // a click beside it closes it and does nothing else (with the Place tool it would have set a place)
    await tool(t, 'place');
    const n0 = M(t, world).marks.length;
    await t.click(empty.x, empty.y, 'right'); await t.until(menu, 3000, 'the round menu with the Place tool');
    await t.click(other.x, other.y); await t.sleep(400);
    t.eq([await menu(), M(t, world).marks.length], [false, n0], 'closed, and no place was set by that click');
    await t.click(other.x, other.y);
    await t.until(() => M(t, world).marks.length === n0 + 1, 3000, 'the next click to set a place');
    t.eq(await W(t, 'w.debug().tool'), 'move', 'one place set: the Move tool is back');
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  // ---------- Second Builder (second-cartographer-polish) ----------
  area.quick('a route\'s name keeps off the places on its road; dragged, it slides along the road and stays; back by itself again', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('grid.update', { mapId: world, show: false, unit: { n: 1, name: 'day of travel' } });
    t.handle('atlas.look', { look: { tilt: 0.5, bulge: 0.3, turn: 0 } });
    t.handle('atlas.show', { id: world });
    const a = await shownOn(t, world);
    const R = a.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    const mid = at(0.5, 0.5);
    t.handle('mark.add', { mapId: world, kind: 'place', title: 'Kintsugi', sub: 'Seat of the shogun', ...mid });
    const r = t.handle('mark.add', { mapId: world, kind: 'route', title: 'The pilgrim road', ...at(0.3, 0.5) }).selected;
    t.handle('mark.route', { mapId: world, id: r, ...at(0.7, 0.5) });
    const plate = async () => t.until(async () => { const x = (await tvA(t)).standing.find((s) => s.kind === 'route'); return x && x.shown && x.title && x; }, 6000, 'the route\'s plate on the TV');
    const onMap = async (x) => t.t(`window.__table.atlasUnproject(${x.x}, ${x.y})`); // (the TV says where on its screen; back onto the map)
    const p1 = await onMap(await plate());
    const S = a.cam.S; // (half the TV's height, in inches of the map)
    t.ok(Math.abs(p1.x - mid.x) > 0.1 * S, 'it does not stand on the place in the middle of its road', { plate: p1, place: mid, S });
    t.near(p1.y, mid.y, 0.01, 'it stands on its road');
    // pulled along its road (the GM's Map table): it slides along it and stays there; the road itself stays put
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const pts0 = [...M(t, world).marks.find((m) => m.id === r).pts];
    const pr = await t.until(() => t.rect('.mt-view .atl-s.kind-route .atl-plate'), 4000, 'the plate in the Map table');
    const to = await scr(t, at(0.36, 0.42)); // (above the road, nearer its start)
    await t.drag({ x: pr.cx, y: pr.cy }, { x: to.x, y: pr.cy + (to.y - pr.cy) });
    const got = await t.until(() => { const m = M(t, world).marks.find((x) => x.id === r); return typeof m.labelAt === 'number' && m; }, 4000, 'where the plate was put');
    t.ok(got.labelAt < 0.4, 'nearer the start of the road, where it was pulled', got.labelAt);
    t.eq(got.pts, pts0, 'the road itself stays where it is (routes are locked)');
    const p2 = await t.until(async () => { const x = await onMap(await plate()); return Math.abs(x.x - (R.x + R.w * (0.3 + 0.4 * got.labelAt))) < 0.05 && x; }, 6000, 'the TV to follow');
    t.near(p2.y, mid.y, 0.01, 'still on its road');
    // the side has a button to give it back
    t.ok(await t.findText('.mt-opts .btn', 'Name plate back by itself'), 'the picked route offers to put its name back');
    await t.clickText('.mt-opts .btn', 'Name plate back by itself');
    await t.until(() => M(t, world).marks.find((x) => x.id === r).labelAt === null, 3000, 'by itself again');
    const p3 = await t.until(async () => { const x = await onMap(await plate()); return Math.abs(x.x - p1.x) < 0.05 && x; }, 6000, 'the plate back where it found room');
    t.ok(p3, 'where it was before');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  area.quick('the Map table: How far from here keeps nothing; − and + walk a route on by a cell; keys pick the tools; Remove has an Undo', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    for (const x of [...M(t, world).draw]) t.handle('draw.remove', { mapId: world, id: x.id });
    t.handle('grid.update', { mapId: world, show: true, type: 'square', size: 1, ox: 0, oy: 0, unit: { n: 1, name: 'day of travel' } });
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const R = d.ed.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    const before = JSON.stringify([M(t, world).marks, M(t, world).draw]);
    // How far from here: right-click, then the pointer shows the distance; a click adds a bend; Esc ends it, nothing kept
    // (the middle of a cell: the points snap to cells, and a start 4 px from a cell's edge made this count depend on the panel's layout)
    const c0 = { x: Math.floor(at(0.3, 0.6).x) + 0.5, y: Math.floor(at(0.3, 0.6).y) + 0.5 };
    const a0 = await scr(t, c0);
    await t.click(a0.x, a0.y, 'right');
    await t.until(() => t.findText('.radial-item', 'How far from here'), 3000, 'the round menu');
    await t.clickText('.radial-item', 'How far from here');
    const a1 = await scr(t, { x: c0.x + 5, y: c0.y });
    await t.mouse('mouseMove', a1.x, a1.y);
    const say = await t.until(async () => { const x = await t.text('.mt-count'); return x && /days? of travel/.test(x) && x; }, 3000, 'how far it is, next to the pointer');
    t.eq(say, '5 days of travel', 'five cells to the right');
    await t.click(a1.x, a1.y);
    const a2 = await scr(t, { x: c0.x + 5, y: c0.y - 3 });
    await t.mouse('mouseMove', a2.x, a2.y);
    await t.until(async () => (await t.text('.mt-count')) === '8 days of travel', 3000, 'a bend and three more cells');
    await t.key('Escape');
    t.eq(await t.g(`getComputedStyle(document.querySelector('.mt-measure')).display`), 'none', 'Esc ends it');
    t.eq(JSON.stringify([M(t, world).marks, M(t, world).draw]), before, 'and nothing was kept on the map');
    // the keys pick the tools
    for (const [k, id] of [['P', 'place'], ['R', 'route'], ['D', 'draw'], ['T', 'write'], ['E', 'erase'], ['V', 'move']]) {
      await t.key(k);
      t.eq(await W(t, 'w.debug().tool'), id, `${k} picks ${id}`);
    }
    // a route walked on by one cell at a time
    const r = t.handle('mark.add', { mapId: world, kind: 'route', title: 'The road', ...at(0.2, 0.3) }).selected;
    t.handle('mark.route', { mapId: world, id: r, x: at(0.2, 0.3).x + 4, y: at(0.2, 0.3).y });
    await t.g(`Play.Atlas.win.select({ kind: 'mark', id: ${JSON.stringify(r)} })`);
    await t.until(() => t.text('.mt-days'), 3000, 'how far the party has come');
    t.eq(await t.text('.mt-days'), '0 of 4 days of travel', 'nobody has walked it yet');
    const plus = await t.rect('.mt-dayrow .icon-btn:last-child'); await t.click(plus.cx, plus.cy); await t.click(plus.cx, plus.cy);
    await t.until(() => M(t, world).marks.find((x) => x.id === r).walked === 0.5, 3000, 'two cells of four walked');
    t.eq(await t.text('.mt-days'), '2 of 4 days of travel', 'said in days');
    const minus = await t.rect('.mt-dayrow .icon-btn:first-child'); await t.click(minus.cx, minus.cy);
    await t.until(() => M(t, world).marks.find((x) => x.id === r).walked === 0.25, 3000, 'one cell back');
    // Delete removes it, and the note that says so has an Undo
    const pr = await t.rect('.mt-stage'); await t.click(pr.x + 6, pr.y + pr.h - 6, 'left'); // (focus in the window, on empty map: lets go of the route)
    await t.g(`Play.Atlas.win.select({ kind: 'mark', id: ${JSON.stringify(r)} })`);
    await t.key('Delete');
    await t.until(() => !M(t, world).marks.some((x) => x.id === r), 3000, 'the route to go');
    await t.until(() => t.rect('.toast .toast-undo'), 3000, 'a note with Undo');
    t.ok(/The road removed/.test(await t.g(`document.getElementById('toasts').textContent`)), 'it names what went');
    await t.clickSel('.toast .toast-undo');
    await t.until(() => M(t, world).marks.some((x) => x.id === r), 3000, 'Undo brings it back');
    t.handle('grid.update', { mapId: world, show: false });
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  area.quick('the Map table: the places of a map in a list; a place that leads to a map wears a door (yours only); off the TV it opens without asking; no backpack; an asset dropped lies there', async (t) => {
    for (const m of [...M(t, world).marks]) t.handle('mark.remove', { mapId: world, id: m.id });
    t.handle('atlas.hide', {});
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const R = d.ed.surface.rect; const at = (fx, fy) => ({ x: R.x + R.w * fx, y: R.y + R.h * fy });
    const gate = t.handle('mark.add', { mapId: world, kind: 'place', title: 'North gate', to: region, ...at(0.8, 0.2) }).selected;
    t.handle('mark.add', { mapId: world, kind: 'place', title: 'Ashford', ...at(0.2, 0.7) });
    t.handle('mark.add', { mapId: world, kind: 'place', title: 'Secret cove', hidden: true, ...at(0.5, 0.9) });
    await W(t, `w.setTool('move')`);
    const names = await t.until(async () => { const x = await t.g(`[...document.querySelectorAll('.mt-places .mt-pgo')].map((b) => b.textContent)`); return x && x.length === 3 && x; }, 3000, 'the list of places');
    t.eq(names, ['Ashford', 'North gate', 'Secret cove'], 'by name');
    t.eq(await t.count('.mt-places .mt-prow.is-hidden'), 1, 'the hidden one is marked');
    // a click shows it in the middle of the window and picks it
    await t.clickText('.mt-places .mt-pgo', 'Ashford');
    const w = await W(t, 'w.debug()');
    const c = await W(t, `w.screen(${at(0.2, 0.7).x}, ${at(0.2, 0.7).y})`); const st = await t.rect('.mt-wrap');
    t.near(c.x, st.x + st.w / 2, 3, 'Ashford in the middle of the window (across)'); t.near(c.y, st.y + st.h / 2, 3, 'and down');
    t.eq(w.sel && w.sel.kind, 'mark', 'and picked');
    // the door: on the GM's place that leads somewhere, never on the TV
    t.eq(await t.count(`.mt-view .atl-s[data-id="${gate}"] .atl-door`), 1, 'North gate wears a door in the Map table');
    t.eq(await t.count('.mt-view .atl-door'), 1, 'only that one');
    t.handle('atlas.show', { id: world }); await shownOn(t, world);
    t.eq(await t.t(`document.querySelectorAll('#table-atlas .atl-door').length`), 0, 'the TV shows no door');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
    // no backpack in the list of maps
    await W(t, `w.setTool('maps')`);
    await t.until(() => t.count('.atl-row'), 3000, 'the maps');
    t.eq(await t.g(`[...document.querySelectorAll('.atl-row .icon-btn')].filter((b) => /found/i.test(b.dataset.tip || '')).length`), 0, 'no "found" button');
    // an asset dragged from the library onto the map lies where it is dropped
    const pic = t.lib('assets').find((x) => x.kind === 'image');
    const n0 = M(t, world).layers.filter((l) => l.role === 'asset').length;
    const spot = at(0.6, 0.6); const sp = await scr(t, spot);
    await t.g(`(() => { const dt = new DataTransfer(); dt.setData('application/x-ts-asset', JSON.stringify({ path: ${JSON.stringify(pic.path)}, kind: 'image', name: 'Dropped', cat: 'assets' }));
      const el = document.querySelector('.mt-wrap'); const o = { bubbles: true, cancelable: true, clientX: ${sp.x}, clientY: ${sp.y}, dataTransfer: dt };
      el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o)); return true; })()`);
    const l = await t.until(() => { const x = M(t, world).layers.filter((y) => y.role === 'asset'); return x.length === n0 + 1 && x[x.length - 1]; }, 4000, 'the asset on the map');
    t.near(l.x, spot.x, R.w * 0.01, 'where it was dropped (across)'); t.near(l.y, spot.y, R.w * 0.01, 'and down');
    t.handle('layer.remove', { mapId: world, id: l.id });
    // off the TV a double click on North gate opens the north at once
    await W(t, `w.setTool('move')`);
    await t.clickText('.mt-places .mt-pgo', 'North gate'); // (shown in the middle of the window)
    await t.g(`Play.Atlas.win.select(null)`);
    const g = await t.until(() => t.rect(`.mt-view .atl-s[data-id="${gate}"] .atl-plate`), 3000, 'North gate');
    await t.mouse('mouseMove', g.cx, g.cy); await t.mouse('mouseDown', g.cx, g.cy); await t.mouse('mouseUp', g.cx, g.cy);
    await t.mouse('mouseDown', g.cx, g.cy); await t.mouse('mouseUp', g.cx, g.cy);
    await t.until(async () => (await W(t, 'w.debug().map')) === region, 4000, 'the north opened');
    t.eq(await t.count('.modal'), 0, 'without asking');
    t.eq(t.state.atlas, null, 'and the TV was not touched');
    t.handle('atlas.open', { id: world });
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

  area.quick('without a map in the atlas the Map table shows one thing: Add a map', async (t) => {
    t.handle('atlas.hide', {});
    const r1 = t.handle('atlas.remove', { id: region }); const r2 = t.handle('atlas.remove', { id: world });
    t.ok(r1.ok && r2.ok, 'the atlas emptied for this check');
    t.gm().webContents.focus();
    await t.g(`Play.TB.openPanel('atlas')`);
    await t.until(() => t.rect('.mt-none .btn'), 4000, 'the empty window');
    t.eq(await t.g(`getComputedStyle(document.querySelector('.mt-strip')).visibility`), 'hidden', 'no tools');
    t.eq(await t.g(`getComputedStyle(document.querySelector('.mt-opts')).visibility`), 'hidden', 'no side');
    const box = await t.rect('.mt-none'); const win = await t.rect('.fp[data-id="atlas"] .mt');
    t.ok(box.w >= win.w - 2 && box.h >= win.h - 2, 'the empty state fills the window', [box, win]);
    t.eq(await t.g(`[...document.querySelectorAll('.fp[data-id="atlas"] *')].filter((e) => e.children.length === 0 && /No world map yet/.test(e.textContent) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length`), 1, '"No world map yet" once');
    t.ok(/Add a map/.test(await t.text('.mt-none .btn')), 'and Add a map');
    await t.g(`Play.Floats.hide('atlas')`);
    t.handle(r2.undo.type, r2.undo.payload); t.handle(r1.undo.type, r1.undo.payload);
    t.eq(A(t).maps.map((x) => x.id), [world, region], 'the atlas as it was');
  });

  area.deep('an asset lies on the world map: added from the Map table, picked, moved, sized by its handle', async (t) => {
    const d = await openTable(t, world);
    await t.g(`Play.Atlas.win.setMode('flat')`);
    const R = d.ed.surface.rect;
    const it = t.lib('assets').find((x) => x.kind === 'image');
    await t.g(`Play.Atlas.addAsset(${JSON.stringify({ path: it.path })})`);
    const l = { ...(await t.until(() => M(t, world).layers.find((x) => x.role === 'asset'), 4000, 'the asset on the world map')) };
    t.eq(M(t, battle).layers.filter((x) => x.role === 'asset' && x.path === l.path && x.id === l.id).length, 0, 'not on the battlemap');
    t.near(l.w, Math.max(R.w, R.h) * 0.12, 0.01, 'an eighth of the map wide');
    await t.until(async () => { const x = await W(t, 'w.debug()'); return x.tool === 'assets' && x.sel && x.sel.id === l.id; }, 4000, 'it is picked, with the Assets tool');
    const hs = await t.until(async () => { const r = await t.rect('.mt-h.size'); return r && r.w > 4 && r; }, 5000, 'its handle');
    const c = await scr(t, l);
    await t.drag({ x: hs.cx, y: hs.cy }, { x: hs.cx + (hs.cx - c.x) * 0.5, y: hs.cy + (hs.cy - c.y) * 0.5 });
    await t.until(() => M(t, world).layers.find((x) => x.id === l.id).w > l.w * 1.3, 4000, 'pulled by its corner it grows');
    t.near(M(t, world).layers.find((x) => x.id === l.id).w, l.w * 1.5, l.w * 0.12, 'half as big again');
    await t.drag(c, { x: c.x + 40, y: c.y + 20 });
    await t.until(() => M(t, world).layers.find((x) => x.id === l.id).x > l.x, 4000, 'dragged, it moves');
    t.gm().webContents.focus(); await t.g(`document.querySelector('.mt-stage').focus()`);
    await t.key('Delete');
    await t.until(() => !M(t, world).layers.some((x) => x.id === l.id), 4000, 'Delete removes it');
    await t.g(`Play.Floats.hide('atlas')`);
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
