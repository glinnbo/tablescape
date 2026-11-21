// Effects, light, darkness and weather
'use strict';

module.exports = (area) => {
  area.title('Effects, light and weather');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Light (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });

  const M = (t) => t.store.map(own);
  const clean = async (t) => {
    if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); }
    for (const f of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: f.id });
    for (const w of [...M(t).weather.layers]) t.handle('weather.remove', { mapId: own, id: w.id });
    t.handle('light.update', { mapId: own, darkness: 0 });
    await t.settle();
    return M(t);
  };
  // (Beta 3.60) Effects → Elements: pick an effect by its tile ('r:mist', 'e:smoke'), a shape tool at the side
  const element = async (t, key) => { await t.g(`(() => { Play.setTool('fx'); if (Play.ui.fxMode !== 'place' && Play.ui.fxMode !== 'paint') Play.ui.fxMode = 'paint'; if (Play.ui.region === 'roof') Play.ui.region = 'mist'; Play.ui.fxFam = 'all'; Play.openPop('fx'); document.querySelector('#pop .fx-gal .fx-t[data-v="${key}"]').click(); })()`); await t.sleep(250); };
  const shape = async (t, v) => { await t.g(`document.querySelector('#pop .os-tabs2 .tile[data-v="fxt-${v}"]').click()`); await t.sleep(250); };
  // how dark the TV is at a point of the map: 0 (lit) to 255 (black)
  const dark = async (t, x, y) => { const p = await t.t(`window.__table.probeMap('light', ${x}, ${y})`); return p ? p[3] : null; };

  area.quick('E opens Effects; a click on the map places a torch that gives light (Beta 3.54: Light sources → Flame)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.key('E');
    t.eq(await t.tool(), 'fx', 'the tool after E');
    t.eq(await t.popTitle(), 'Effects', 'the panel after E');
    await t.g(`Object.assign(Play.ui.lt, { group: 'flame', flame: 'torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    const at = await t.scr(18 * k, 6 * k);
    await t.click(at.x, at.y);
    await t.until(() => M(t).fx.length === 1, 3000, 'the effect');
    const torch = M(t).fx[0];
    t.eq(torch.preset, 'torch', 'what was placed');
    t.ok(torch.bright > 0, 'it gives light', torch);
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && (d.fx.emitters >= 1 || d.fx.lights >= 1 || d.fx.particles > 0); }, 4000, 'the torch on the TV').catch(async (e) => { throw new Error(`${e.message} (the TV says ${JSON.stringify((await t.tvDebug()).fx)})`); });
  });

  area.quick('an effect\'s marker can be dragged to move it', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const r = await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'torch', x: 18 * k, y: 6 * k, r: 1 });
    t.gm().webContents.focus();
    await t.key('E');
    const id = M(t).fx[0].id;
    const h = await t.until(() => t.rect(`.sv-handle[data-id="${id}"]`), 3000, 'the marker');
    const a = { ...M(t).fx[0] };
    await t.drag({ x: h.cx, y: h.cy }, { x: h.cx + 60, y: h.cy + 30 }, 6);
    const b = M(t).fx[0];
    t.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0.2 * k, 'the effect moved', [a.x, a.y, b.x, b.y, r]);
  });

  // Beta 3.9: a map turned with everything on it. A painted area away from the middle kept its old cut-out (its
  // points moved, their number did not), so it showed nothing at its new place.
  area.quick('painted areas follow when the map is turned, also away from the middle (Beta 3.9)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const geo = await t.g(`(() => { const v = Play.view(); const p = v.bgPlacement(); const r = v.tableRectInMap(); return { p, r }; })()`);
    const piv = { x: geo.r.x + geo.r.w / 2, y: geo.r.y + geo.r.h / 2 };
    const cen = { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h / 2 };
    const rot0 = m.bg.rotation || 0;
    const a = { x: piv.x + 5 * k, y: piv.y };
    const areas = { water: 'atmo', mist: 'atmo', ice: 'atmo', darkness: 'veil', sway: 'sway' };
    for (const preset of Object.keys(areas)) t.handle('fx.stroke', { mapId: own, id: `turn-${preset}`, preset, sid: 's1', r: 1.2 * k, pts: [a.x - 0.5 * k, a.y, a.x + 0.5 * k, a.y] });
    const drawn = (x, y) => t.t(`(() => { const o = {}; for (const [p, L] of ${JSON.stringify(Object.entries(areas))}) { const q = window.__table.probeMap(L, ${x}, ${y}); o[L] = Math.max(o[L] || 0, q ? q[3] : 0); } return o; })()`);
    const all = (d) => d && Object.values(d).every((v) => v > 0);
    try {
      await t.until(async () => all(await drawn(a.x, a.y)), 6000, 'the areas on the TV');
      t.handle('bg.turn', { mapId: own, to: rot0 + 90, mode: 'all', pivot: piv, center: cen });
      const s = M(t).fx.find((f) => f.id === 'turn-water').strokes[0].pts;
      const b = { x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 };
      t.near(b.x, piv.x, 0.01, 'a quarter turn round the middle of the table: the area lies below it now'); t.near(b.y, piv.y + 5 * k, 0.01, 'five squares below');
      await t.until(async () => all(await drawn(b.x, b.y)), 6000, 'every area to be drawn at its new place').catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await drawn(b.x, b.y))}`); });
      t.eq(Object.values(await drawn(a.x, a.y)).filter((v) => v > 0).length, 0, 'layers that still show something at the old place');
    } finally {
      t.handle('bg.turn', { mapId: own, to: rot0, mode: 'all', pivot: piv, center: cen });
    }
  });

  area.quick('Sway moves the map picture where it is painted, and nothing else (Beta 3.1)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.handle('fx.stroke', { mapId: own, id: 'sway-test', preset: 'sway', sid: 's1', r: 2 * k, pts: [6 * k, 6 * k, 10 * k, 6.5 * k, 14 * k, 6 * k] });
    await t.until(async () => (await t.t(`window.__table.coverage('sway')`)) > 0.005, 6000, 'the Sway layer on the TV');
    const probe = (x, y) => t.t(`window.__table.probeMap('sway', ${x}, ${y})`);
    const at = [[8 * k, 6 * k], [10 * k, 6.3 * k], [12 * k, 6 * k], [9 * k, 5.5 * k]];
    const a = []; for (const [x, y] of at) a.push(await probe(x, y));
    t.ok(a.every((p) => p && p[3] > 200), 'inside the painted area the layer shows the map picture', a);
    await t.sleep(700);
    const b = []; for (const [x, y] of at) b.push(await probe(x, y));
    const moved = a.some((p, i) => p && b[i] && Math.abs(p[0] - b[i][0]) + Math.abs(p[1] - b[i][1]) + Math.abs(p[2] - b[i][2]) > 6);
    t.ok(moved, 'it moves', { a, b });
    const out = await probe(24 * k, 14 * k);
    t.ok(!out || out[3] === 0, 'outside the painted area nothing is drawn', out);
    // (Beta 3.2) the map's colours (Build → Map) go over the moving picture too, so Sway doesn't change the colours
    t.handle('bg.look', { mapId: own, sat: 0.3, warm: 0.5 });
    const looks = () => t.t(`(() => { const L = document.querySelector('.tv-layer.shown'); return [L.querySelector('.sv-bg').style.filter, L.querySelector('.sv-sway').style.filter]; })()`);
    await t.until(async () => { const [a1, b1] = await looks(); return !!a1 && a1 === b1; }, 3000, 'the map\'s colours on the Sway layer too');
    t.handle('bg.look', { mapId: own, bright: 1, contrast: 1, sat: 1, warm: 0 });
    await t.until(async () => { const [a1, b1] = await looks(); return !a1 && !b1; }, 3000, 'plain colours on both again');
    t.handle('fx.remove', { mapId: own, id: 'sway-test' });
    await t.until(async () => (await t.t(`window.__table.coverage('sway')`)) === 0, 4000, 'the layer empty again');
  });

  area.quick('Roof keeps the weather off where it is painted, and only there (Beta 3.1)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    // (underwater light: it covers the whole map; fog banks and sand drift in patches and made the check flaky)
    t.handle('weather.preset', { mapId: own, name: 'Underwater', layers: [{ type: 'caustics', amount: 2, opacity: 1, speed: 1 }] });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) > 0.05, 6000, 'the weather on the TV');
    // how many of 35 points in a box (in squares) have weather on them
    const hits = (x0, y0, x1, y1) => t.t(`(() => { let n = 0; for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) { const p = window.__table.probeMap('weather', ${x0 * k} + (${(x1 - x0) * k}) * (i + 0.5) / 7, ${y0 * k} + (${(y1 - y0) * k}) * (j + 0.5) / 5); if (p && p[3] > 3) n++; } return n; })()`);
    const roofBox = [7, 5.5, 13, 9]; const outBox = [14, 5.5, 20, 9];
    await t.until(async () => (await hits(...roofBox)) >= 4, 6000, 'before: the weather over the house too'); // (it drifts in)
    t.handle('fx.stroke', { mapId: own, id: 'roof-test', preset: 'roof', sid: 's1', r: 3 * k, pts: [6 * k, 7.25 * k, 14 * k, 7.25 * k] });
    await t.until(async () => (await hits(...roofBox)) === 0, 6000, 'no weather under the roof');
    await t.until(async () => (await hits(...outBox)) >= 4 && (await hits(...roofBox)) === 0, 6000, 'the weather to go on outside it (and stay off under it)'); // (the drifting weather is patchy)
    t.handle('fx.remove', { mapId: own, id: 'roof-test' });
    t.handle('weather.preset', { mapId: own, name: 'None', layers: [] });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) === 0, 6000, 'the weather gone again');
  });

  area.deep('in the dark a light opens a hole: lit near the torch, dark far from it; at 100 % the rest is pitch black', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 10 * k, y: 8 * k, r: 4 * k });
    await t.cmd('light.update', { mapId: own, darkness: 0.7 });
    const far = await t.until(async () => { const v = await dark(t, 24 * k, 14 * k); return v > 120 && v; }, 15000, 'the darkness on the TV');
    const near = await dark(t, 10 * k, 8 * k);
    t.ok(near < far - 60, 'it is clearly lighter at the torch', [near, far]);
    t.ok(far < 250, 'at 70 % the map still shows through', far);
    await t.cmd('light.update', { mapId: own, darkness: 1 });
    await t.until(async () => (await dark(t, 24 * k, 14 * k)) >= 250, 15000, 'pitch black far from the light');
    t.ok(await dark(t, 10 * k, 8 * k) < 150, 'the torch still cuts through', await dark(t, 10 * k, 8 * k));
  }, { ms: 60000 });

  // Beta 3.49: the lights that come with the app (a picture with the app's own flame or glow on it), from Light sources
  // on any map: a lamp post where clicked, a wall torch on the wall near the click; a wall stops its light
  area.deep('Beta 3.49: Light sources → With its holder: a lamp post where clicked gives light; a wall torch sits on the wall near the click and the wall stops its light', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'wall_torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .light-card .tile')].map((b) => b.textContent.trim())`), ['Wall torch', 'Wall lantern', 'Lamp post', 'Street lamp', 'Candles', 'Cooking fire'], 'Holder: the six lights with their holder');
    await t.clickText('#pop .light-card .tile', 'Lamp post');
    let at = await t.scr(10 * k, 8 * k); await t.click(at.x, at.y);
    const lamp = await t.until(() => M(t).fx.find((f) => f.holder), 4000, 'a lamp post');
    const glow = lamp;
    t.eq([lamp.holder, glow.kind, glow.preset, glow.bright, glow.dim, glow.hidden, glow.lit], ['lamp_post', 'emitter', 'glow', 30, 60, false, undefined], 'one light: its holder and a glow with a lantern\'s light', glow);
    t.ok(Math.abs(lamp.x - 10 * k) < 0.1 * k && Math.abs(lamp.y - 8 * k) < 0.1 * k && !M(t).layers.some((l) => l.fixture), 'where clicked; no picture of its own', [lamp.x, lamp.y]);
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${lamp.id}"]`)) === 1, 3000, 'its holder drawn on your screen');
    await t.cmd('light.update', { mapId: own, darkness: 1 });
    await t.until(async () => (await dark(t, 24 * k, 14 * k)) >= 250, 15000, 'pitch black far from the lamp');
    t.ok(await dark(t, 10.5 * k, 8.5 * k) < 150, 'the lamp cuts through the dark', await dark(t, 10.5 * k, 8.5 * k));
    // a wall, and a wall torch clicked beside it: on the wall, turned to it; no light behind the wall
    t.handle('fx.remove', { mapId: own, id: lamp.id });
    t.eq(M(t).fx.length, 0, 'the lamp gone with its glow');
    t.handle('wall.add', { mapId: own, segs: [[16 * k, 4 * k, 16 * k, 12 * k]] });
    await t.settle();
    await t.clickText('#pop .light-card .tile', 'Wall torch');
    at = await t.scr(16.4 * k, 8 * k); await t.click(at.x, at.y);
    const torch = await t.until(() => M(t).fx.find((f) => f.holder), 4000, 'a wall torch');
    t.ok(torch.x > 16.1 * k && torch.x < 16.5 * k && Math.abs(Math.abs(torch.rotation) - 90) < 1, 'on the wall\'s side that was clicked, turned to the wall', [torch.x / k, torch.rotation]);
    await t.until(async () => (await dark(t, 17.5 * k, 8 * k)) < 150, 15000, 'light in front of the wall');
    t.ok(await dark(t, 14 * k, 8 * k) >= 250, 'none behind it', await dark(t, 14 * k, 8 * k));
    t.ok(torch.wall && M(t).walls.some((w) => w.id === torch.wall), 'hung on that wall', torch.wall);
    t.handle('fx.remove', { mapId: own, id: torch.id });
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
  }, { ms: 90000 });

  // Beta 3.51 (Glinn): by day a light in its own colour throws no colour on the map (only its flame burns); it comes in
  // with the dark. A light given a colour colours the map by day too. For every light: flames, presets, the app's lights
  area.deep('Beta 3.51: by day a light in its own colour throws no colour on the map; it comes in with the dark; a picked colour shows by day too', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const glow = async (x, y) => { const p = await t.t(`window.__table.probeMap('glow', ${x}, ${y})`); return p ? p[3] : 0; };
    await t.cmd('fx.fixture', { mapId: own, kind: 'lamp_post', x: 8 * k, y: 8 * k });
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'lantern', x: 8 * k, y: 16 * k, bright: 30, dim: 60, color: '#ffd28a' });
    await t.cmd('fx.fixture', { mapId: own, kind: 'lamp_post', x: 24 * k, y: 8 * k, color: '#55ff55' });
    await t.sleep(1200);
    const day = [await glow(9 * k, 9 * k), await glow(9 * k, 17 * k), await glow(25 * k, 9 * k)];
    t.ok(day[0] < 6 && day[1] < 6, 'daylight: no colour from the lamp of the app nor from the Lantern preset, each in its own colour', day);
    t.ok(day[2] > 12, 'daylight: the green one colours the map', day);
    await t.cmd('light.update', { mapId: own, darkness: 0.2 });
    const dusk = await t.until(async () => { const v = await glow(9 * k, 9 * k); return v > 3 && v; }, 15000, 'a little colour at dusk');
    await t.cmd('light.update', { mapId: own, darkness: 0.6 });
    const dark = await t.until(async () => { const v = await glow(9 * k, 9 * k); return v > dusk + 6 && v; }, 15000, 'its colour in the dark');
    t.ok((await glow(9 * k, 17 * k)) > 12, 'the Lantern preset as well', [dusk, dark]);
    // a reach of its own, and changed afterwards
    const lamp = M(t).fx.find((x) => x.holder);
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, bright: 10 });
    const f = M(t).fx.find((x) => x.id === lamp.id);
    t.eq([f.bright, f.dim], [10, 20], 'Reach: bright and dim together');
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, color: '#3366ff' });
    t.eq([f.color, f.sat], ['#3366ff', 0.7], 'a colour picked afterwards: strong');
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, color: '' });
    t.eq([f.color, f.sat], ['#ffd28a', undefined], 'back to its own colour');
    for (const x of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: x.id });
  }, { ms: 90000 });

  // Beta 3.54 (Glinn: a flame removed in Effects left its holder behind, which could not be removed): a light is one
  // thing. Maps from before fold the picture and its flame together when they open (and after any change).
  area.quick('Beta 3.54: lights from before (a picture and its flame) become one light; a picture whose flame was removed becomes a light that is put out', async (t) => {
    const ms = require('../../mapstate');
    const old = { name: 'old', grid: { size: 1 }, layers: [
      { id: 'la', role: 'asset', kind: 'image', x: 5, y: 3.278, w: 0.171, rotation: 90, name: 'Wall torch', fixture: { kind: 'wall_torch', fx: 'xa' } },
      { id: 'lb', role: 'asset', kind: 'image', x: 8, y: 8, w: 0.329, rotation: 0, hidden: true, name: 'Lamp post', fixture: { kind: 'lamp_post', fx: 'xgone' } },
      { id: 'lc', role: 'asset', kind: 'image', x: 9, y: 9, w: 0.342, rotation: 0, name: 'Wall torch', fixture: { kind: 'wall_torch', fx: 'xa' } }], // (a copy that shared its flame)
    fx: [
      { id: 'xa', kind: 'emitter', preset: 'torch', x: 5, y: 3.278, r: 0.2, color: '#55ff55', sat: 0.7, hidden: true, bright: 15, dim: 30, flicker: true, fixture: 'la' },
      { id: 'xz', kind: 'emitter', preset: 'glow', x: 1, y: 1, r: 0.3, hidden: false, bright: 30, dim: 60, fixture: 'lgone' }, // (its picture was gone)
      { id: 'xs', kind: 'emitter', preset: 'smoke', x: 2, y: 2, r: 1, hidden: false }] };
    const m = ms.normalize(JSON.parse(JSON.stringify(old)));
    t.eq(m.layers.length, 0, 'the pictures are gone');
    const a = m.fx.find((f) => f.id === 'xa');
    t.eq([a.holder, a.x, a.y, a.rotation, a.lit, a.hidden, a.color, a.bright, a.fixture], ['wall_torch', 5, 3.278, 90, false, false, '#55ff55', 15, undefined], 'picture and flame: one light, put out as it was, in its colour', a);
    const b = m.fx.find((f) => f.holder === 'lamp_post');
    t.ok(b && b.lit === false && b.hidden === true && b.x === 8 && b.preset === 'glow' && b.bright === 30, 'a picture without its flame: a lamp post, put out, hidden as its picture was', b);
    const c = m.fx.filter((f) => f.holder === 'wall_torch');
    t.ok(c.length === 2 && c[1].id !== 'xa' && c[1].x === 9 && c[1].hs === 2, 'a copied picture: a light of its own (made twice as big: its holder too)', c.map((x) => [x.id, x.x, x.hs]));
    t.ok(!m.fx.some((f) => f.id === 'xz') && m.fx.some((f) => f.id === 'xs'), 'a flame whose picture was gone goes; other effects stay');
    // a map that is open: the next change folds it too
    const m2 = ms.normalize({ name: 'open' });
    m2.layers.push(JSON.parse(JSON.stringify(old.layers[0]))); m2.fx.push(JSON.parse(JSON.stringify(old.fx[0])));
    ms.apply(m2, 'fx.update', { id: 'xa', intensity: 1 });
    t.ok(!m2.layers.length && m2.fx.length === 1 && m2.fx[0].holder === 'wall_torch', 'folded after a change', m2.fx);
    // one thing: removed, nothing is left; put out and hidden apart
    t.eq(ms.apply(m2, 'fx.lit', { id: 'xa', on: true }).changed, 'all', 'lit');
    t.eq([m2.fx[0].lit, m2.fx[0].hidden], [undefined, false], 'lit, not hidden');
    ms.apply(m2, 'fx.remove', { id: 'xa' });
    t.ok(!m2.fx.length && !m2.layers.length, 'removed: nothing left behind');
  });

  area.quick('Beta 3.54: on a drawn map a wall light goes with its wall (another wall right there keeps it); Undo brings both back; a light standing free stays', async (t) => {
    const ms = require('../../mapstate');
    const media = () => ({});
    const m = ms.normalize({ name: 'drawn', grid: { size: 1 }, os: { items: [] } });
    const walls = (list) => ms.apply(m, 'os.result', { walls: list.map(([key, c]) => ({ key, c })) }, media);
    walls([['top', [0, 0, 10, 0]], ['left', [0, 0, 0, 10]]]);
    const wid = (key) => (m.walls.find((w) => w.os === key) || {}).id;
    const top = ms.apply(m, 'fx.fixture', { kind: 'wall_torch', x: 5, y: 0.5, wall: wid('top') }).id;
    const left = ms.apply(m, 'fx.fixture', { kind: 'wall_lantern', x: 0.5, y: 5, wall: wid('left') }).id;
    const lamp = ms.apply(m, 'fx.fixture', { kind: 'lamp_post', x: 5, y: 5 }).id;
    const ids = () => m.fx.map((f) => f.id);
    const h = new ms.History();
    h.before(m, null, 'os.add', 'Erased'); // (the drawing changed: an undo step; its walls come after, without one)
    walls([['top', [0, 0, 10, 0]]]);
    t.ok(ids().includes(top) && !ids().includes(left) && ids().includes(lamp), 'the left wall gone: its lantern goes; the torch on the top wall and the lamp post stay', ids());
    walls([['top2', [0, 0.1, 10, 0.1]]]);
    t.ok(ids().includes(top) && m.fx.find((f) => f.id === top).wall === wid('top2'), 'the top wall made anew right there: the torch is hung on it', m.fx.find((f) => f.id === top));
    h.step(m, 'undo');
    t.ok(ids().includes(left) && ids().includes(top) && m.walls.some((w) => w.id === m.fx.find((f) => f.id === left).wall), 'Undo: the wall and its lantern back', ids());
    walls([]);
    t.eq(ids(), [lamp], 'no walls at all: only the lamp post is left');
  });

  area.deep('Beta 3.54: a light is one thing: the Light panel picks and changes it; put out it keeps its holder; hidden it leaves the TV; one row in Layers; Delete in Effects takes it all; Place has no torches; only the Select tool asks', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    const fxNow = (id) => M(t).fx.find((f) => f.id === id);
    // Place: no torches, campfires or candles any more (they are lights)
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'place'; Play.ui.fxFam = 'all'; Play.openPop('fx')`);
    const place = await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent.trim())`);
    t.ok(!['Torch', 'Campfire', 'Candles'].some((x) => place.includes(x)) && place.includes('Smoke') && place.includes('Magic glow'), 'Elements keeps the rest', place);
    // Light sources: Holder, Flame, Just light
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'cooking_fire', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    const tilesNow = () => t.g(`[...document.querySelectorAll('#pop .lt-kinds .tile')].map((b) => b.textContent.trim())`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].map((b) => b.textContent.trim())`), ['Holder', 'Flame', 'Just light'], 'three kinds of light');
    await t.clickText('#pop .lt-groups .seg-btn', 'Flame');
    t.eq(await tilesNow(), ['Torch', 'Campfire', 'Candles'], 'Flame');
    await t.clickText('#pop .lt-groups .seg-btn', 'Just light');
    t.eq(await tilesNow(), ['Candle', 'Torch', 'Lantern', 'Light cantrip', 'Moonlight', 'Bullseye lantern'], 'Just light');
    await t.clickText('#pop .lt-groups .seg-btn', 'Holder');
    t.eq((await tilesNow()).length, 6, 'Holder');
    let at = await t.scr(10 * k, 8 * k); await t.click(at.x, at.y);
    const fire = await t.until(() => M(t).fx.find((f) => f.holder === 'cooking_fire'), 4000, 'a cooking fire');
    // its marker picks it: the same rows now change it
    const hm = await t.until(() => t.rect(`.sv-handle[data-id="${fire.id}"]`), 3000, 'its marker');
    await t.click(hm.cx, hm.cy);
    await t.until(() => t.g('Play.ui.selFx').then((v) => v === fire.id), 3000, 'picked');
    await t.until(async () => (await t.count('#pop .lt-remove')) === 1, 3000, 'the panel of the picked light');
    t.eq([await t.text('#pop .look-head b'), await t.count('#pop .lt-kinds')], ['Cooking fire', 0], 'its name, no kinds');
    await t.send(own);
    // put out: no flame and no light, the holder stays; not hidden
    await t.clickText('#pop .lt-lit .seg-btn', 'Unlit');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'put out');
    t.eq(fxNow(fire.id).hidden, false, 'not hidden: the players see the cold fire');
    await t.until(async () => (await t.t(`[...document.querySelectorAll('.sv-holder')].filter((e) => e.style.display !== 'none').length`)) === 1, 4000, 'its holder on the TV');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 0; }, 4000, 'no flame on the TV');
    await t.clickText('#pop .lt-lit .seg-btn', 'Lit');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 1; }, 4000, 'its flame on the TV again');
    // hidden (the eye): holder and flame leave the TV; it stays lit
    t.handle('fx.update', { mapId: own, id: fire.id, hidden: true });
    await t.until(async () => (await t.t(`[...document.querySelectorAll('.sv-holder')].filter((e) => e.style.display !== 'none').length`)) === 0, 4000, 'hidden: its holder gone from the TV');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 0; }, 4000, 'and its flame');
    t.eq(fxNow(fire.id).lit, undefined, 'still lit');
    t.handle('fx.update', { mapId: own, id: fire.id, hidden: false });
    // Layers: one row, with a bulb
    await t.g(`Play.openPop('layers')`);
    await t.until(async () => (await t.count('#pop .layer-row')) >= 1, 3000, 'Layers');
    const rows = await t.g(`[...document.querySelectorAll('#pop .layer-list > *')].map((e) => e.textContent.trim()).filter(Boolean)`);
    t.ok(rows.includes('Lights') && rows.filter((r) => r.startsWith('Cooking fire')).length === 1 && (await t.count('#pop .layer-row .lt-bulb.on')) === 1, 'one row under Lights, lit', rows);
    await t.clickSel('#pop .layer-row .lt-bulb');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'the bulb puts it out');
    await t.clickSel('#pop .layer-row .lt-bulb');
    await t.until(() => fxNow(fire.id).lit !== false, 3000, 'and lights it');
    // Delete in Effects takes the whole light (in 3.53 it left the holder behind)
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    const hm2 = await t.until(() => t.rect(`.sv-handle[data-id="${fire.id}"]`), 3000, 'its marker');
    await t.click(hm2.cx, hm2.cy);
    await t.until(() => t.g('Play.ui.selFx').then((v) => v === fire.id), 3000, 'picked again');
    t.gm().webContents.focus();
    await t.key('Delete');
    await t.until(() => !M(t).fx.length, 3000, 'Delete: the light gone');
    await t.until(async () => (await t.count('.sv-holder')) === 0, 3000, 'its holder too, on your screen');
    t.ok(!M(t).layers.some((l) => l.role === 'asset'), 'no picture left behind');
    await t.cmd('history.undo', {});
    await t.until(() => fxNow(fire.id), 3000, 'Undo brings it back whole');
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${fire.id}"]`)) === 1, 3000, 'with its holder');
    // only the Select tool asks: a fog stroke that starts on it does its job
    await t.g(`Play.setTool('fog')`);
    at = await t.scr(fire.x, fire.y); await t.click(at.x, at.y); await t.sleep(300);
    t.eq(await t.count('.light-ask'), 0, 'the Fog tool does not ask');
    await t.g(`Play.setTool('select')`);
    await t.click(at.x, at.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'the Select tool asks');
    t.eq(await t.text('.light-ask b'), 'Put out the cooking fire?', 'it asks');
    await t.clickText('.light-ask .btn', 'Yes');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'put out');
    // a flame and just light ask too
    const fl = (await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'campfire', x: 16 * k, y: 8 * k, r: 1.2 * k, bright: 20, dim: 40 })).selected;
    at = await t.scr(16 * k, 8 * k); await t.click(at.x, at.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'a campfire asks');
    t.eq(await t.text('.light-ask b'), 'Put out the campfire?', 'the campfire');
    await t.clickText('.light-ask .btn', 'No');
    t.ok(fxNow(fl).lit !== false, 'No: it burns on');
    for (const x of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: x.id });
  }, { ms: 120000 });

  area.deep('without darkness the light layer leaves the map alone', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.sleep(600);
    t.ok(await dark(t, 24 * k, 14 * k) < 20, 'no darkness is drawn', await dark(t, 24 * k, 14 * k));
  });

  area.deep('rain covers the whole TV and stops when the layer is removed', async (t) => {
    await clean(t);
    const r = await t.cmd('weather.add', { mapId: own, type: 'rain' });
    t.eq(M(t).weather.layers.map((l) => l.type), ['rain'], 'the weather on the map');
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) > 0.002, 8000, 'rain on the TV');
    await t.cmd('weather.remove', { mapId: own, id: r.selected });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) < 0.0005, 8000, 'the rain to stop');
  });

  area.deep('mist painted with the mouse becomes an area on the map and drifts on the TV', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.key('E');
    await element(t, 'r:mist'); await shape(t, 'brush');
    await t.drag(await t.scr(15 * k, 9 * k), await t.scr(22 * k, 10 * k), 12);
    const mist = await t.until(() => M(t).fx.find((f) => f.kind === 'region' && f.preset === 'mist'), 3000, 'the mist area');
    t.ok(mist.strokes.length === 1 && mist.strokes[0].pts.length / 2 >= 4, 'one stroke that follows the mouse', mist.strokes.map((s) => s.pts.length / 2));
    await t.until(async () => (await t.t(`window.__table.coverage('atmo')`)) > 0.002, 8000, 'the mist on the TV');
  });

  area.deep('Beta 3.41: Paint → Box and Round snap to the grid; Erase takes painted effects away, with the brush or (Alt) with a box', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    // (in squares of the map's grid, which need not begin at the map's corner)
    const ox = m.grid.ox || 0; const oy = m.grid.oy || 0; const X = (n) => ox + n * k; const Y = (n) => oy + n * k;
    const sq = (pts) => pts.map((v, i) => Math.round(((v - (i % 2 ? oy : ox)) / k) * 100) / 100);
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'paint'; Play.ui.paintShape = 'brush'; Play.openPop('fx')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.textContent)`), ['Box', 'Round', 'Brush', 'Erase'], 'four ways, at the side (Beta 3.60)');
    t.ok(await t.findText('#pop .ctl-label', 'Brush size'), 'the brush has a size');
    await element(t, 'r:acid');
    await shape(t, 'box');
    t.ok(!(await t.findText('#pop .ctl-label', 'Brush size')), 'no brush size for a box');
    // a drag that begins and ends a little off the grid's lines: the box lies on them
    await t.drag(await t.scr(X(16.2), Y(5.1)), await t.scr(X(20.9), Y(8.8)), 8);
    const acid = () => M(t).fx.find((f) => f.kind === 'region' && f.preset === 'acid');
    await t.until(() => acid(), 3000, 'the box of acid');
    const outline = acid().strokes[0];
    t.ok(outline.poly && !outline.cut, 'an outline, filled');
    t.eq(sq(outline.pts), [16, 5, 21, 5, 21, 9, 16, 9], 'on the grid\'s lines');
    t.ok(outline.line && outline.line[2] > outline.line[0] && outline.line[1] === outline.line[3], 'it flows along its longer side, the way it was dragged', outline.line);
    const alpha = (x, y) => t.t(`(window.__table.probeMap('atmo', ${X(x)}, ${Y(y)}) || [0, 0, 0, 0])[3]`);
    await t.until(async () => (await alpha(18.5, 7)) > 40, 8000, 'the acid on the TV');
    t.ok((await alpha(22.5, 7)) < 8 && (await alpha(18.5, 10.5)) < 8 && (await alpha(14.5, 7)) < 8, 'nothing of it outside the box', [await alpha(22.5, 7), await alpha(18.5, 10.5), await alpha(14.5, 7)]);
    // a round with Shift: a circle; it joins the same area
    await shape(t, 'round');
    await t.drag(await t.scr(X(23), Y(5)), await t.scr(X(25.9), Y(9.2)), 8, ['shift']);
    await t.until(() => acid().strokes.filter((st) => st.poly).length === 2, 3000, 'the round');
    const ring = acid().strokes.filter((st) => st.poly)[1].pts; const xs = ring.filter((_, i) => i % 2 === 0); const ys = ring.filter((_, i) => i % 2 === 1);
    t.eq(sq([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]), [23, 5, 27, 9], 'a circle four squares across (the longer side of the drag)');
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 1, 'box and round are one area');
    // Alt with Box erases a box: the middle of the acid goes, its rim stays
    await shape(t, 'box');
    await t.drag(await t.scr(X(17.5), Y(6)), await t.scr(X(19.5), Y(8)), 8, ['alt']);
    await t.until(() => acid().strokes.some((st) => st.cut), 3000, 'the erased box');
    const cut = acid().strokes.find((st) => st.cut);
    t.eq(sq(cut.pts), [17.5, 6, 19.5, 6, 19.5, 8, 17.5, 8], 'half squares too');
    await t.until(async () => (await alpha(18.5, 7)) < 8, 8000, 'the middle free of acid on the TV');
    t.ok((await alpha(16.6, 7)) > 40 && (await alpha(20.4, 7)) > 40, 'the rest stays', [await alpha(16.6, 7), await alpha(20.4, 7)]);
    // Erase: the brush takes the round away altogether, in one step that undo brings back
    await shape(t, 'erase');
    t.eq([await t.text('#pop .fx-ban .cap b'), await t.count('#pop .fx-panel .swatches'), await t.count('#pop .fx-gal .fx-t.on')], ['Erase', 0, 0], 'erasing: no effect in hand, no colour');
    await t.g('Play.ui.paintIn = 8'); // (a brush as wide as the round, on a table zoomed as it is)
    const r0 = await t.g(`Play.ui.paintIn / 2 / Play.state().map.view.zoom`);
    for (let y = 5; y <= 9; y += Math.max(0.5, (r0 / k) * 1.2)) await t.drag(await t.scr(X(22.5), Y(y)), await t.scr(X(27.5), Y(y)), 6);
    await t.until(async () => (await alpha(25, 7)) < 8, 8000, 'the round gone from the TV');
    t.ok((await alpha(16.6, 7)) > 40, 'the box is still there', await alpha(16.6, 7));
    // what is erased everywhere leaves no empty area behind
    t.handle('fx.cut', { mapId: own, sid: 'all', shape: 'rect', x: X(10), y: Y(2), w: 22 * k, h: 12 * k });
    await t.settle();
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 0, 'an area with nothing left goes');
    t.handle('history.undo', { mapId: own }); await t.settle();
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 1, 'undo brings it back');
    await t.g(`Play.ui.paintIn = 2; Play.ui.paintShape = 'box'`);
  }, { ms: 120000 });

  area.deep('Beta 3.60: Effects in three groups: Scene (time of day, weather, wind, Indoors), Lights, Elements (picture tiles by family); each effect keeps its own look; letting go places nothing; another colour starts a new area', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.fxMode = 'weather'; Play.ui.fxMoreWx = false; Play.ui.fxMoreLight = false; Play.ui.looks = {}; Play.ui.fxFam = 'all'; Play.ui.fxFly = false; Play.ui.paintShape = 'box'`);
    await t.key('E');
    const groups = () => t.g(`[...document.querySelectorAll('#pop .fx-groups .tile')].map((b) => b.textContent + (b.classList.contains('open') ? '*' : ''))`);
    const group = async (g) => { await t.g(`document.querySelector('#pop .fx-groups .tile[data-g="${g}"]').click()`); await t.sleep(300); };
    t.eq(await groups(), ['Scene*', 'Lights', 'Elements'], 'three groups at the side, Scene open');
    // Scene: the whole map on one screen
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-moods .tile')].map((b) => b.textContent)`), ['Day', 'Dawn', 'Dusk', 'Night', 'Cave'], 'time of day, five in a row');
    t.ok((await t.count('#pop .wx-presets .tile')) >= 14 && (await t.count('#pop .wx-add')) === 0, 'the mixes, no single-layer tiles');
    await t.g(`document.querySelector('#pop .fx-moods .tile[data-v="night"]').click()`);
    await t.clickText('#pop .wx-presets .tile', 'Rain');
    await t.until(() => M(t).light.mood === 'night' && M(t).weather.layers.length === 2, 4000, 'night and rain: two clicks on one screen');
    t.ok(await t.count('#pop .fx-wind .wind-now') && await t.findText('#pop .fx-wind button', 'Storm'), 'the wind now, and Storm');
    t.ok(await t.g(`[...document.querySelectorAll('#pop .fx-fold')].every((d) => !d.open)`), 'the rest is folded');
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreWx"] summary').click()`);
    await t.until(async () => (await t.count('#pop .fx-fold[data-v="fxMoreWx"] .wx-list .layer-row')) === 2, 3000, 'Fine-tune the weather: this mix\'s layers');
    await t.clickSel('#pop .fx-addlayer');
    t.ok(((await t.menu()) || []).includes('Lightning') && (await t.menu()).length === 18, 'Add a layer: the 18 kinds in a menu', await t.menu());
    await t.menuPick('Lightning');
    await t.until(() => M(t).weather.layers.some((l) => l.type === 'lightning'), 3000, 'lightning in the mix');
    await t.until(() => t.g(`(() => { const b = document.querySelector('#pop .wx-strike'); return !!b && !b.closest('[hidden]'); })()`), 3000, 'the Lightning button');
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreWx"] summary').click()`);
    // Indoors: the Roof of before; the shape tools come out, the group stays Scene
    await t.g(`document.querySelector('#pop .fx-indoors').click()`); await t.sleep(300);
    t.eq([await t.g('[Play.ui.fxMode, Play.ui.region].join()'), await t.count('#pop .os-tabs2 .tile'), (await groups())[0]], ['paint,roof', 4, 'Scene*'], 'Indoors paints roofs, in Scene');
    await t.drag(await t.scr(16 * k, 9 * k), await t.scr(19 * k, 11 * k), 6);
    await t.until(() => M(t).fx.some((f) => f.kind === 'region' && f.preset === 'roof'), 3000, 'a roof');
    await t.g(`document.querySelector('#pop .fx-indoors').click()`); await t.sleep(300);
    t.eq([await t.g('Play.ui.fxMode'), await t.count('#pop .os-tabs2 .tile')], ['weather', 0], 'Indoors off again');
    // Lights: the Light panel
    await group('lights');
    t.eq([await groups(), await t.count('#pop .lt-groups'), await t.count('#pop .lt-kinds .tile') > 0], [['Scene', 'Lights*', 'Elements'], 1, true], 'Lights: the Light panel');
    // Elements: every effect a tile with a picture, sorted by family; a chip narrows them
    await group('elements');
    t.eq(await t.count('#pop .fx-gal .fx-t'), 29, 'every element on one screen');
    await t.until(() => t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t img')].filter((i) => /^data:image/.test(i.src)).length >= 20`), 15000, 'their pictures, drawn by the effects themselves');
    const gal = await t.g(`(() => { const g = document.querySelector('#pop .fx-gal'); const t0 = g.querySelector('.fx-t'); return { rows: Math.round(g.clientHeight / (t0.offsetHeight + 5)), scrolls: g.scrollHeight > g.clientHeight + 10, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length }; })()`);
    t.eq(gal, { rows: 4, scrolls: true, cols: 5 }, 'five in a row, four rows show, the rest scrolls');
    await t.g(`[...document.querySelectorAll('#pop .fx-chips .cs-chip')].find((b) => b.textContent === 'Fire').click()`); await t.sleep(250);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent)`), ['Lava', 'Burning ground', 'Vent', 'Smoke', 'Steam'], 'the chip Fire');
    // the effect knows how it goes down: Smoke with a click (no shape tools), Mist with a box
    await element(t, 'e:smoke');
    t.eq([await t.count('#pop .os-tabs2'), await t.text('#pop .fx-ban .cap b'), await t.findText('#pop .ctl-label', 'Size') !== null], [0, 'Smoke', true], 'Smoke: a click, its size');
    t.ok(!(await t.findText('#pop .ctl-label', 'Flames flicker')), 'no flame switch on effects without one');
    // each effect its own look: red smoke does not make the portal red
    await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#ff3344"]').click()`); await t.sleep(150);
    const at = await t.scr(18 * k, 5 * k); await t.click(at.x, at.y);
    const smoke = await t.until(() => M(t).fx.find((f) => f.preset === 'smoke'), 3000, 'the smoke');
    t.eq(smoke.color, '#ff3344', 'red smoke');
    await element(t, 'e:portal');
    t.ok(await t.g(`document.querySelector('#pop .fx-panel .swatch.own').classList.contains('on')`), 'the portal still has its own colour');
    const at2 = await t.scr(23 * k, 5 * k); await t.click(at2.x, at2.y);
    const portal = await t.until(() => M(t).fx.find((f) => f.preset === 'portal'), 3000, 'the portal');
    t.ok(portal.color !== '#ff3344', 'in its own colour', portal.color);
    await element(t, 'e:smoke');
    t.ok(await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#ff3344"]').classList.contains('on')`), 'Smoke remembers its red');
    // picked: the panel is its card; a click on the empty map lets go and places nothing
    const mk = await t.rect(`.sv-handle[data-id="${portal.id}"]`); await t.click(mk.cx, mk.cy); await t.sleep(400);
    t.eq([await t.text('#pop .fx-ban-tag'), await t.text('#pop .fx-ban .cap b'), await t.count('#pop .fx-gal'), await t.count('#pop .fx-ban-acts .icon-btn')], ['picked', 'Portal', 0, 3], 'the portal picked: its card, with eye, copy and bin');
    const n0 = M(t).fx.length;
    const free = await t.scr(26 * k, 9 * k); await t.click(free.x, free.y); await t.sleep(400);
    t.eq([M(t).fx.length, await t.g('Play.ui.selFx'), await t.count('#pop .fx-gal'), await t.text('#pop .fx-gal .fx-t.on')], [n0, null, 1, 'Smoke'], 'a click beside it lets go: nothing placed, the tiles back, Smoke in hand again');
    // painted: strokes of one look join; another colour starts a new area by itself
    await element(t, 'r:mist');
    t.eq([await t.count('#pop .os-tabs2 .tile'), await t.count('#pop .os-tabs2 .tile.on[data-v="fxt-box"]'), await t.findText('#pop .btn', 'Start a new area')], [4, 1, null], 'Mist: the shape tools, a box first; no "Start a new area"');
    const mists = () => M(t).fx.filter((f) => f.kind === 'region' && f.preset === 'mist');
    await t.drag(await t.scr(16 * k, 4 * k), await t.scr(18 * k, 6 * k), 6);
    await t.until(() => mists().length === 1, 3000, 'mist');
    await t.drag(await t.scr(20 * k, 4 * k), await t.scr(22 * k, 6 * k), 6);
    await t.until(() => mists().length === 1 && mists()[0].strokes.filter((st) => st.poly).length === 2, 3000, 'the second box joins it');
    await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#5f9dff"]').click()`); await t.sleep(150);
    await t.drag(await t.scr(24 * k, 4 * k), await t.scr(26 * k, 6 * k), 6);
    await t.until(() => mists().length === 2, 3000, 'blue mist is an area of its own');
    t.eq(mists().map((f) => f.color), [null, '#5f9dff'], 'each in its colour');
    // the settings card, behind its button
    t.eq(await t.count('#pop .fx-fly'), 0, 'no card until asked');
    await t.g(`document.querySelector('#pop .os-fxset').click()`); await t.sleep(300);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-fly .ctl-label')].filter((e) => e.offsetParent).map((e) => e.textContent)`), ['Strength', 'Amount', 'Speed'], 'Mist settings');
    await t.g(`Play.ui.fxFly = false; Play.ui.looks = {}; Play.closePop(); Play.setTool('select')`);
  }, { ms: 120000 });

  area.deep('on the TV the effects lie under the fog, the weather above it', async (t) => {
    await clean(t);
    const order = await t.t(`(() => { const w = document.querySelector('.tv-layer.shown .sv-world'); return [...w.querySelectorAll('canvas')].map((e) => (e.className.baseVal ?? e.className).split(' ').pop()); })()`);
    const at = (name) => order.findIndex((x) => x.includes(name));
    t.ok(at('atmo') >= 0 && at('fog') >= 0 && at('weather') >= 0, 'the TV has its layers', order);
    t.ok(at('atmo') < at('fog'), 'effects under the fog', order);
    t.ok(at('fog') < at('weather'), 'weather above the fog', order);
  });
};
