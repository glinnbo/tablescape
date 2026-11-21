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
  // how dark the TV is at a point of the map: 0 (lit) to 255 (black)
  const dark = async (t, x, y) => { const p = await t.t(`window.__table.probeMap('light', ${x}, ${y})`); return p ? p[3] : null; };

  area.quick('E opens Effects; a click on the map places a torch that gives light', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.key('E');
    t.eq(await t.tool(), 'fx', 'the tool after E');
    t.eq(await t.popTitle(), 'Effects', 'the panel after E');
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
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.ui.look.color = null; Play.openPop('fx')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .light-card .tile')].map((b) => b.textContent.trim()).slice(-6)`), ['Wall torch', 'Wall lantern', 'Lamp post', 'Street lamp', 'Candles', 'Cooking fire'], 'the six lights with their holder, after the plain ones');
    await t.clickText('#pop .light-card .tile', 'Lamp post');
    let at = await t.scr(10 * k, 8 * k); await t.click(at.x, at.y);
    const lamp = await t.until(() => M(t).layers.find((l) => l.fixture), 4000, 'a lamp post');
    const glow = M(t).fx.find((f) => f.id === lamp.fixture.fx);
    t.eq([lamp.fixture.kind, lamp.role, glow.kind, glow.preset, glow.bright, glow.dim, glow.hidden], ['lamp_post', 'asset', 'emitter', 'glow', 30, 60, false], 'its picture and a glow with a lantern\'s light', glow);
    t.ok(Math.abs(lamp.x - 10 * k) < 0.1 * k && Math.abs(lamp.y - 8 * k) < 0.1 * k && glow.x === lamp.x && glow.y === lamp.y, 'where clicked, the glow on it', [lamp.x, lamp.y]);
    await t.cmd('light.update', { mapId: own, darkness: 1 });
    await t.until(async () => (await dark(t, 24 * k, 14 * k)) >= 250, 15000, 'pitch black far from the lamp');
    t.ok(await dark(t, 10.5 * k, 8.5 * k) < 150, 'the lamp cuts through the dark', await dark(t, 10.5 * k, 8.5 * k));
    // a wall, and a wall torch clicked beside it: on the wall, turned to it; no light behind the wall
    t.handle('layer.remove', { mapId: own, id: lamp.id });
    t.eq(M(t).fx.length, 0, 'the lamp gone with its glow');
    t.handle('wall.add', { mapId: own, segs: [[16 * k, 4 * k, 16 * k, 12 * k]] });
    await t.settle();
    await t.clickText('#pop .light-card .tile', 'Wall torch');
    at = await t.scr(16.4 * k, 8 * k); await t.click(at.x, at.y);
    const torch = await t.until(() => M(t).layers.find((l) => l.fixture), 4000, 'a wall torch');
    t.ok(torch.x > 16.1 * k && torch.x < 16.5 * k && Math.abs(Math.abs(torch.rotation) - 90) < 1, 'on the wall\'s side that was clicked, turned to the wall', [torch.x / k, torch.rotation]);
    await t.until(async () => (await dark(t, 17.5 * k, 8 * k)) < 150, 15000, 'light in front of the wall');
    t.ok(await dark(t, 14 * k, 8 * k) >= 250, 'none behind it', await dark(t, 14 * k, 8 * k));
    t.handle('layer.remove', { mapId: own, id: torch.id });
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    await t.g(`Play.ui.light = 'torch'`);
  }, { ms: 90000 });

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
    await t.clickText('#pop .seg-btn, #pop .seg button', 'Paint');
    await t.clickText('#pop .tile', 'Mist');
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
    t.eq(await t.g(`[...document.querySelectorAll('#pop .seg-sub .seg-btn')].map((b) => b.textContent)`), ['Brush', 'Box', 'Round', 'Erase'], 'four ways under Paint');
    await t.clickText('#pop .tile', 'Acid');
    await t.clickText('#pop .seg-sub .seg-btn', 'Box');
    t.eq(await t.g(`(() => { const l = [...document.querySelectorAll('#pop *')].filter((e) => !e.children.length && /^Brush size/.test(e.textContent)); return [l.length > 0, l.every((e) => !!e.closest('[hidden]'))]; })()`), [true, true], 'no brush size for a box');
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
    await t.clickText('#pop .seg-sub .seg-btn', 'Round');
    await t.drag(await t.scr(X(23), Y(5)), await t.scr(X(25.9), Y(9.2)), 8, ['shift']);
    await t.until(() => acid().strokes.filter((st) => st.poly).length === 2, 3000, 'the round');
    const ring = acid().strokes.filter((st) => st.poly)[1].pts; const xs = ring.filter((_, i) => i % 2 === 0); const ys = ring.filter((_, i) => i % 2 === 1);
    t.eq(sq([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]), [23, 5, 27, 9], 'a circle four squares across (the longer side of the drag)');
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 1, 'box and round are one area');
    // Alt with Box erases a box: the middle of the acid goes, its rim stays
    await t.clickText('#pop .seg-sub .seg-btn', 'Box');
    await t.drag(await t.scr(X(17.5), Y(6)), await t.scr(X(19.5), Y(8)), 8, ['alt']);
    await t.until(() => acid().strokes.some((st) => st.cut), 3000, 'the erased box');
    const cut = acid().strokes.find((st) => st.cut);
    t.eq(sq(cut.pts), [17.5, 6, 19.5, 6, 19.5, 8, 17.5, 8], 'half squares too');
    await t.until(async () => (await alpha(18.5, 7)) < 8, 8000, 'the middle free of acid on the TV');
    t.ok((await alpha(16.6, 7)) > 40 && (await alpha(20.4, 7)) > 40, 'the rest stays', [await alpha(16.6, 7), await alpha(20.4, 7)]);
    // Erase: the brush takes the round away altogether, in one step that undo brings back
    await t.clickText('#pop .seg-sub .seg-btn', 'Erase');
    t.ok(await t.g(`document.querySelector('#pop .tiles').hidden`), 'no effects to pick while erasing');
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
    await t.g(`Play.ui.paintIn = 2; Play.ui.paintShape = 'brush'`);
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
