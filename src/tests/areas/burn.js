// The handout burn (Beta 3.7): drawn by the graphics card. On a machine without one (most test machines) this area
// runs with WebGL in software (scripts/run-tests.js), which is slow to start, so it is kept apart from the rest.
'use strict';
const path = require('path');

module.exports = (area) => {
  area.title('Handout burn');
  let A = null;
  area.before(async (K) => {
    await K.openDemo(); await K.send();
    A = K.pic('handouts');
    // (the fire is compiled ahead of the first handout; in software that takes a few seconds)
    await K.until(() => K.t('!!document.createElement("canvas").getContext("webgl2")'), 5000, 'WebGL on the TV');
    await K.sleep(4000);
  });
  const onTv = (t) => t.t(`[...document.querySelectorAll('.tv-handout .ho-item')].map((it) => { const i = it.querySelector('img'); return { w: Math.round(i.offsetWidth), burning: !!it.querySelector('.ho-burn'), seen: getComputedStyle(i).visibility !== 'hidden' }; })`);
  const dbg = (t) => t.t('window.__table.debug().over.handout');
  const away = async (t) => { t.handle('handout.hide', {}); await t.until(async () => (await onTv(t)).length === 0, 15000, 'the table to be empty'); };

  area.quick('a handout burns in and burns away, drawn by the graphics card at its full sharpness, in the table style\'s colour', async (t) => {
    delete t.settings.handoutLayout; await away(t);
    const hold = (v) => t.t(`window.__burnHold = ${v == null ? 'undefined' : v}`); // (the fire stops at one moment, to look at it without a race)
    await hold(0.5);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { x: 0.5, y: 0.5, rot: 0, size: 0.8 } });
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 15000, 'the handout to burn in');
    const d = await dbg(t);
    t.ok(d && d.gl && d.burning === 1, 'the fire is drawn by the graphics card (not the plain fade)', d);
    t.eq(d.style, t.settings.tableStyle || 'ink', 'in the table style');
    const cv = await t.t(`(() => { const c = document.querySelector('.tv-handout .ho-burn'); const i = document.querySelector('.tv-handout .ho-one img'); return c ? { w: c.width, img: i.offsetWidth, dpr: devicePixelRatio, seen: getComputedStyle(i).visibility } : null; })()`);
    t.ok(cv && cv.w >= cv.img * cv.dpr * 0.99, 'at the handout\'s full sharpness', cv);
    t.eq(cv.seen, 'hidden', 'the fire has taken the picture\'s place meanwhile');
    await hold(null);
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && !x[0].burning && x[0].seen; }, 15000, 'the fire to end and the handout to lie there');
    await hold(0.5);
    t.handle('handout.hide', {});
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 15000, 'the handout to burn away');
    t.eq(t.state.handouts.length, 0, 'handouts on the table meanwhile');
    await hold(null);
    await t.until(async () => (await onTv(t)).length === 0, 15000, 'the handout to be gone');
    const after = await t.t('window.__table.debug().over');
    t.ok(!after.handout, 'nothing left on the TV', after.handout);
  });

  area.quick('the fire has the colour of the table style: green for Jungle', async (t) => {
    await away(t);
    const was = t.settings.tableStyle;
    await t.g(`window.ts.settings({ tableStyle: 'jungle' })`);
    await t.until(() => t.settings.tableStyle === 'jungle', 3000, 'the Jungle style');
    await t.t('window.__burnHold = 0.45'); // (the fire stops in the middle of the burn, to look at it)
    t.handle('handout.show', { path: A });
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 15000, 'the handout to burn in');
    const d = await dbg(t);
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const glow = hex(d.fire[1]);
    t.ok(d.style === 'jungle' && glow[1] > glow[0] + 60 && glow[1] > glow[2] + 60, 'its fire is green', d);
    await t.sleep(800);
    // green light on the TV's picture itself
    const shot = await t.tv().webContents.capturePage();
    const bmp = shot.toBitmap(); // (blue, green, red, alpha)
    let n = 0;
    for (let i = 0; i < bmp.length; i += 16) if (bmp[i + 1] > 170 && bmp[i + 1] > bmp[i + 2] + 30 && bmp[i + 1] > bmp[i] + 30) n++;
    const px = { n, size: shot.getSize() };
    await t.t('window.__burnHold = undefined');
    t.ok(px && px.n > 30, 'green fire is on the handout', px);
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && !x[0].burning; }, 15000, 'the fire to end');
    await t.g(`window.ts.settings({ tableStyle: ${JSON.stringify(was || 'ink')} })`);
    await away(t);
  });
};
