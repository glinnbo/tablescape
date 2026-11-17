// The Cartographer drawn by the graphics card (Beta 3.11). The other areas run without WebGL (the fallback draws the
// map there); this one runs with software GL, as "Handout burn" does: slow, so it is kept short.
'use strict';

module.exports = (area) => {
  area.title('Cartographer by the graphics card');
  let world = null;
  area.before(async (K) => {
    await K.openDemo();
    await K.send();
    world = K.handle('atlas.add', { path: K.lib('maps').find((x) => x.kind === 'image').path, name: 'The world', open: false }).id;
    await K.settle();
  });
  area.quick('the shader draws the map in the middle and clouds round the edge', async (t) => {
    t.handle('atlas.look', { look: { tilt: 0.6, bulge: 0.6, blur: 0.6, clouds: 1, turn: 0 } });
    t.handle('atlas.show', { id: world });
    const a = await t.until(async () => { const x = await t.t(`window.__table.debug().atlas`); return x && x.on && x.ready && x.cover <= 0 && x; }, 40000, 'the map on the TV, its clouds open');
    t.eq(a.gl, true, 'drawn by the graphics card');
    await t.sleep(600);
    const img = await t.tv().webContents.capturePage();
    const size = img.getSize(); const bmp = img.toBitmap(); // (blue, green, red, alpha)
    const px = (fx, fy) => { const x = Math.min(size.width - 1, Math.round(size.width * fx)); const y = Math.min(size.height - 1, Math.round(size.height * fy)); const o = (y * size.width + x) * 4; return [bmp[o + 2], bmp[o + 1], bmp[o]]; };
    const bright = (c) => Math.min(...c);
    const corners = [px(0.01, 0.02), px(0.99, 0.02), px(0.01, 0.98), px(0.99, 0.98)];
    t.ok(corners.every((c) => bright(c) > 150), 'the corners are cloud', corners);
    const mid = [px(0.5, 0.5), px(0.45, 0.55), px(0.55, 0.45)];
    t.ok(mid.some((c) => bright(c) < 140), 'the middle shows the map', mid);
    t.handle('atlas.hide', {});
  });
};
