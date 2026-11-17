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
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the start screen');
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
    const want = await t.t(`window.__table.atlasProject(${at(0.5, 0.5).x}, ${at(0.5, 0.5).y})`);
    t.near(st[0].x, want.x, 1, 'the place stands on its spot');
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
    t.eq((await t.panels()).find((p) => p.id === 'atlas').title, 'Map table', 'its title');
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
    // a second route, ended by a double click (its second click adds no point)
    const more = [[0.5, 0.7], [0.6, 0.7]].map(([fx, fy]) => at(fx, fy));
    for (const p of more) { const q = await scr(t, p); await t.click(q.x, q.y); await t.sleep(450); }
    const end = await scr(t, at(0.65, 0.75));
    await t.click(end.x, end.y); await t.mouse('mouseDown', end.x, end.y); await t.mouse('mouseUp', end.x, end.y);
    await t.until(async () => (await W(t, 'w.debug().routeId')) === null, 3000, 'the double click to end the route');
    await t.sleep(300);
    const second = M(t, world).marks.filter((m) => m.kind === 'route')[1];
    t.eq(second.pts.length / 2, 3, 'three points: the double click set the last one once', second.pts);
    t.handle('mark.remove', { mapId: world, id: second.id });
    await tool(t, 'route');
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
    t.eq(await t.g(`[...document.querySelectorAll('.radial-item span')].map((x) => x.textContent)`), ['Place here', 'Route from here', 'Write here', 'Asset here', 'TV looks here'], 'what can be made here');
    await t.clickText('.radial-item', 'Place here');
    const made = await t.until(() => M(t, world).marks.find((m) => m.kind === 'place' && m.id !== gate), 4000, 'the place');
    t.near(made.x, at(0.3, 0.7).x, R.w * 0.005, 'where the right-click was');
    // right-click on a place: what can be done with it
    await t.sleep(300);
    await t.click(s.x, s.y - 14, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the round menu of the place');
    t.eq(await t.g(`[...document.querySelectorAll('.radial-item span')].map((x) => x.textContent)`), ['Open The north', 'Hide', 'Remove'], 'open its map, hide it, remove it');
    await t.clickText('.radial-item', 'Hide');
    await t.until(() => M(t, world).marks.find((m) => m.id === gate).hidden === true, 3000, 'the place to be hidden');
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 8000, 'off the TV');
    await t.g(`Play.Floats.hide('atlas')`);
  }, { ms: 80000 });

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
