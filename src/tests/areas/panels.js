// The Toolbox's panels: each one opens as its own small window, with content, and closes again
'use strict';

const PANELS = [['init', 'Initiative'], ['chars', 'Character cards'], ['timer', 'Countdown'], ['dice', 'Dice'], ['moments', 'Screen effects'], ['snaps', 'Snapshots'], ['sound', 'Soundboard'],
  ['spotify', 'Spotify'], ['handouts', 'Handouts'], ['notes', 'Session log'], ['break', 'Break'], ['lights', 'Room lights'], ['players', 'Player phones'], ['remote', 'Remote']];

module.exports = (area) => {
  area.title('Toolbox panels');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  area.quick('the Toolbox lists every panel and map tool', async (t) => {
    t.gm().webContents.focus();
    await t.key('Q');
    await t.until(() => t.popTitle(), 3000, 'the Toolbox');
    const tiles = await t.g(`[...document.querySelectorAll('#pop .tb-tile')].map((x) => x.textContent.trim())`);
    const known = await t.g(`Play.TB.PANELS.map((p) => p.id)`);
    t.eq([...known].sort(), [...PANELS.map((p) => p[0]), 'mapnotes'].sort(), 'the panels the app knows (a new one needs a check here)');
    t.ok(tiles.length >= known.length + 10, 'a tile for every panel and map tool', tiles.length);
  });

  for (const [id, label] of PANELS) {
    area.quick(`${label} opens from the Toolbox and closes again`, async (t) => {
      await t.g(`document.querySelector('.rail-btn[data-id="toolbox"]').click()`);
      await t.until(() => t.popTitle(), 3000, 'the Toolbox');
      const short = await t.g(`(() => { const p = Play.TB.PANELS.find((x) => x.id === ${JSON.stringify(id)}); return p ? [p.label, p.short || p.label] : null; })()`);
      t.ok(short, `the app knows the panel ${id}`);
      t.eq(short[0], label, 'the name of the panel');
      const ok = await t.g(`(() => { const want = ${JSON.stringify(short)}; const b = [...document.querySelectorAll('#pop .tb-tile')].find((x) => want.some((w) => x.textContent.trim() === w || x.textContent.trim().startsWith(w))); if (!b) return false; b.click(); return true; })()`);
      t.ok(ok, `the Toolbox has a ${label} tile`);
      const p = await t.until(async () => (await t.panels()).find((x) => x.id === id), 4000, `the ${label} panel`);
      t.ok(p.title && p.title.length > 1, 'the panel has a title', p);
      await t.sleep(400);
      const chars = await t.g(`document.querySelector('.fp[data-id="${id}"]').textContent.length`);
      t.ok(chars > p.title.length + 8, 'the panel has content', chars);
      const box = await t.rect(`.fp[data-id="${id}"]`);
      t.ok(box.w > 150 && box.h > 60 && box.x >= 0 && box.y >= 0 && box.x + box.w <= (await t.g('innerWidth')) + 1, 'the panel lies inside the window', box);
      await t.g(`Play.Floats.hide(${JSON.stringify(id)})`);
      await t.until(async () => !(await t.panels()).some((x) => x.id === id), 3000, 'the panel to close');
    });
  }

  area.quick('several panels stay open side by side', async (t) => {
    for (const id of ['init', 'timer', 'dice']) await t.g(`Play.TB.openPanel(${JSON.stringify(id)})`);
    await t.sleep(400);
    const ids = (await t.panels()).map((x) => x.id);
    for (const id of ['init', 'timer', 'dice']) t.has(ids, id, 'open panels');
  });

  area.quick('J picks Map notes', async (t) => {
    t.gm().webContents.focus();
    await t.key('J');
    await t.sleep(300);
    t.eq(await t.tool(), 'notes', 'the tool after J');
  });
};
