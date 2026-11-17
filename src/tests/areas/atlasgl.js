// The Cartographer drawn by the graphics card (Beta 3.11, 3.12). The other areas run without WebGL (the fallback draws
// the map there); this one runs with software GL, as "Handout burn" does: slow, so it is kept short.
'use strict';

module.exports = (area) => {
  area.title('Cartographer by the graphics card');
  let world = null;
  const tvA = (t) => t.t(`window.__table.debug().atlas`);
  area.before(async (K) => {
    await K.openDemo();
    await K.send();
    world = K.handle('atlas.add', { path: K.lib('maps').find((x) => x.kind === 'image').path, name: 'The world', open: false }).id;
    await K.settle();
  });
  // a picture of the TV, taken again until it shows what is waited for (software GL takes its time with a frame)
  const grab = async (t, ok = () => true, ms = 25000) => {
    const end = Date.now() + ms; let px = null;
    do {
      t.tv().webContents.invalidate(); await t.sleep(600);
      const img = await t.tv().webContents.capturePage();
      const size = img.getSize(); const bmp = img.toBitmap(); // (blue, green, red, alpha)
      px = (fx, fy) => { const x = Math.min(size.width - 1, Math.round(size.width * fx)); const y = Math.min(size.height - 1, Math.round(size.height * fy)); const o = (y * size.width + x) * 4; return [bmp[o + 2], bmp[o + 1], bmp[o]]; };
    } while (!ok(px) && Date.now() < end);
    return px;
  };
  const CORNERS = [[0.01, 0.02], [0.99, 0.02], [0.01, 0.98], [0.99, 0.98]]; const MID = [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45]];

  area.quick('the shader draws the map in the middle and mist where it ends: white cloud, or dark mist', async (t) => {
    t.handle('atlas.look', { look: { tilt: 0.6, bulge: 0.6, blur: 0.6, turn: 0 } });
    t.handle('atlasmap.set', { mapId: world, mist: 'cloud', reach: 0.6, rim: 0.4 });
    t.handle('atlas.show', { id: world });
    const a = await t.until(async () => { const x = await tvA(t); return x && x.on && x.ready && !x.busy && x.resting && x; }, 40000, 'the map on the TV');
    t.eq(a.gl, true, 'drawn by the graphics card');
    await t.until(async () => (await t.tvDebug()).mapInk.phase === 'idle', 20000, 'the map change to clear');
    const bright = (c) => Math.min(...c); const dark = (c) => Math.max(...c);
    let px = await grab(t, (q) => CORNERS.every((p) => bright(q(...p)) > 150));
    t.ok(CORNERS.every((p) => bright(px(...p)) > 150), 'cloud: the corners are white', CORNERS.map((p) => px(...p)));
    t.ok(MID.some((p) => bright(px(...p)) < 140), 'the middle shows the map', MID.map((p) => px(...p)));
    t.handle('atlasmap.set', { mapId: world, mist: 'dark' });
    await t.until(async () => (await tvA(t)).air.dark, 10000, 'the dark mist');
    px = await grab(t, (q) => CORNERS.every((p) => dark(q(...p)) < 70));
    t.ok(CORNERS.every((p) => dark(px(...p)) < 70), 'dark mist: the corners are dark', CORNERS.map((p) => px(...p)));
    t.ok(MID.some((p) => dark(px(...p)) > 60), 'the middle still shows the map', MID.map((p) => px(...p)));
    t.handle('atlasmap.set', { mapId: world, mist: 'cloud' });
  }, { ms: 120000 });

  area.quick('an animated asset lies on the map as a moving picture of its own; the Map table draws with the card too', async (t) => {
    const a = await t.until(async () => { const x = await tvA(t); return x && x.on && x.ready && x; }, 20000, 'the map on the TV');
    const R = a.surface.rect; const at = { x: a.cam.cx, y: a.cam.cy };
    const before = (await grab(t))(0.5, 0.5);
    const orb = t.lib('assets').find((x) => x.kind === 'video');
    const id = t.handle('layer.add', { mapId: world, role: 'asset', path: orb.path, x: at.x, y: at.y, w: R.w * 0.25 }).selected;
    await t.until(async () => (await tvA(t)).live === 1, 20000, 'the asset to be drawn as a moving picture');
    const differs = (c) => Math.abs(c[0] - before[0]) + Math.abs(c[1] - before[1]) + Math.abs(c[2] - before[2]) > 24;
    const after = (await grab(t, (q) => differs(q(0.5, 0.5))))(0.5, 0.5);
    t.ok(differs(after), 'it is drawn where it lies', [before, after]);
    // the GM's window
    t.gm().webContents.focus();
    await t.g(`Play.TB.openPanel('atlas')`);
    const d = await t.until(async () => { const x = await t.g(`Play.Atlas.win ? Play.Atlas.win.debug() : null`); return x && x.map === world && x.ed.ready && x; }, 30000, 'the Map table');
    t.eq(d.ed.gl, true, 'the Map table is drawn by the graphics card');
    t.eq(d.ed.live, 0, 'flat, assets stand still (they move on the TV and in "As on the TV")');
    await t.g(`Play.Atlas.win.setMode('tv')`);
    await t.until(async () => (await t.g(`Play.Atlas.win.debug().ed.live`)) === 1, 20000, 'the asset to move in "As on the TV"');
    await t.g(`Play.Atlas.win.setMode('flat'); Play.Floats.hide('atlas')`);
    t.handle('layer.remove', { mapId: world, id });
    t.handle('atlas.hide', {});
    await t.until(async () => { const x = await tvA(t); return !x.on && !x.busy; }, 30000, 'off the TV');
  }, { ms: 150000 });
};
