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

  area.deep('on the TV the effects lie under the fog, the weather above it', async (t) => {
    await clean(t);
    const order = await t.t(`(() => { const w = document.querySelector('.tv-layer.shown .sv-world'); return [...w.querySelectorAll('canvas')].map((e) => (e.className.baseVal ?? e.className).split(' ').pop()); })()`);
    const at = (name) => order.findIndex((x) => x.includes(name));
    t.ok(at('atmo') >= 0 && at('fog') >= 0 && at('weather') >= 0, 'the TV has its layers', order);
    t.ok(at('atmo') < at('fog'), 'effects under the fog', order);
    t.ok(at('fog') < at('weather'), 'weather above the fog', order);
  });
};
