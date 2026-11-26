// Fog of war
'use strict';

module.exports = (area) => {
  area.title('Fog');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  area.quick('R opens Fog of war; a brush stroke with the mouse reveals, reaches the TV, and Ctrl + Z takes it back', async (t) => {
    t.gm().webContents.focus();
    await t.key('R');
    t.eq(await t.tool(), 'fog', 'the tool after R');
    t.eq(await t.popTitle(), 'Fog of war', 'the panel after R');
    const m = t.L();
    const n0 = m.fog.ops.length;
    const vp = await t.viewport();
    const bx = vp.x + vp.w * 0.45; const by = vp.y + vp.h * 0.55;
    await t.mouse('mouseMove', bx, by);
    await t.mouse('mouseDown', bx, by);
    for (let i = 1; i <= 14; i++) await t.mouse('mouseMove', bx + i * 22, by - i * 6, 'left', { modifiers: ['leftButtonDown'] });
    await t.mouse('mouseUp', bx + 308, by - 84);
    await t.until(() => t.L().fog.ops.length === n0 + 1, 3000, 'the stroke to become one fog step');
    await t.until(() => { const op = t.L().fog.ops[n0]; return op && op.pts && op.pts.length / 2 >= 4; }, 3000, 'the stroke to follow the mouse');
    t.eq(t.L().fog.ops.length, n0 + 1, 'one stroke is one fog step');
    await t.until(async () => (await t.tvDebug()).fogOps === n0 + 1, 3000, 'the stroke on the TV');
    await t.key('Z', ['control']);
    await t.until(() => t.L().fog.ops.length === n0, 3000, 'Ctrl + Z to take the stroke back');
    await t.until(async () => (await t.tvDebug()).fogOps === n0, 3000, 'the TV to follow the undo');
  });

  area.quick('right-click on the map: the radial menu; Reveal here reveals and closes it', async (t) => {
    t.gm().webContents.focus();
    await t.key('V');
    const vp = await t.viewport();
    await t.click(vp.x + vp.w * 0.62, vp.y + vp.h * 0.6, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the radial menu');
    const items = await t.g(`[...document.querySelectorAll('.radial-item > span')].map((s) => s.textContent)`);
    t.eq(items.length, 6, 'six slots (wheel overhaul)', items);
    for (const want of ['Reveal here', 'Cover here', 'Cast spell', 'More …']) t.has(items, want, 'the radial menu');
    // More … opens the rest as a menu
    await t.clickText('.radial-item', 'More');
    const more = await t.until(() => t.menu(), 3000, 'More … as a menu');
    for (const want of ['Effect', 'Light', 'Undo']) t.has(more, want, 'under More …');
    await t.key('Escape');
    await t.g(`document.getElementById('menu').classList.remove('on')`);
    await t.click(vp.x + vp.w * 0.62, vp.y + vp.h * 0.6, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the radial menu again');
    const n0 = t.L().fog.ops.length;
    await t.clickText('.radial-item', 'Reveal here');
    await t.until(() => t.L().fog.ops.length === n0 + 1, 3000, 'the reveal');
    t.ok(!(await t.g(`!!document.querySelector('#radial.on')`)), 'the radial menu closed');
  });

  area.quick('fog can be switched off and on without losing it', async (t) => {
    const m = t.L();
    const n0 = m.fog.ops.length;
    t.handle('fog.enabled', { mapId: m.id, enabled: false });
    await t.sleep(300);
    t.eq(t.L().fog.enabled, false, 'fog off');
    t.eq(t.L().fog.ops.length, n0, 'fog steps while it is off');
    t.handle('fog.enabled', { mapId: m.id, enabled: true });
    await t.sleep(300);
    t.eq(t.L().fog.enabled, true, 'fog on again');
    t.eq((await t.tvDebug()).fogOps, n0, 'fog steps on the TV');
  });

  // ---------- deep: exact results on a map of its own ----------
  let own = null;
  const ownMap = async (t) => {
    if (own && t.store.map(own)) { if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); } } else own = await t.newMap('Fog (test)', { tv: true });
    await t.cmd('fog.base', { mapId: own, base: 'cover' });
    return t.store.map(own);
  };
  const fogAt = (t, x, y) => t.t(`window.__table.fogAt(${x}, ${y})`);
  // (the TV fades a reveal in: wait for it)
  const clear = (t, x, y, what) => t.until(async () => (await fogAt(t, x, y)) < 30, 6000, `${what} to be clear on the TV`);
  const covered = (t, x, y, what) => t.until(async () => (await fogAt(t, x, y)) > 200, 6000, `${what} to be covered on the TV`);

  area.deep('Cover everything covers the whole map on the TV; a revealed circle is clear inside and covered around it', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    await covered(t, 10 * s, 10 * s, 'the middle');
    await covered(t, 3 * s, 3 * s, 'a corner');
    await t.cmd('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: 10 * s, y: 10 * s, r: 2 * s });
    await clear(t, 10 * s, 10 * s, 'the middle of the circle');
    await clear(t, 11.2 * s, 10 * s, 'a point inside the circle');
    t.ok(await fogAt(t, 13.5 * s, 10 * s) > 200, 'outside the circle it stays covered', await fogAt(t, 13.5 * s, 10 * s));
    t.ok(await fogAt(t, 10 * s, 6.5 * s) > 200, 'above the circle it stays covered');
  });

  area.deep('a covered rectangle hides again what was revealed; a revealed one opens exactly its squares', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    await t.cmd('fog.op', { mapId: m.id, mode: 'reveal', shape: 'rect', x: 4 * s, y: 4 * s, w: 6 * s, h: 4 * s });
    await clear(t, 5 * s, 5 * s, 'inside the rectangle');
    await clear(t, 9.5 * s, 7.5 * s, 'its far corner');
    t.ok(await fogAt(t, 11 * s, 5 * s) > 200, 'right of the rectangle it stays covered');
    t.ok(await fogAt(t, 5 * s, 9 * s) > 200, 'below the rectangle it stays covered');
    await t.cmd('fog.op', { mapId: m.id, mode: 'cover', shape: 'rect', x: 4 * s, y: 4 * s, w: 3 * s, h: 4 * s });
    await covered(t, 5 * s, 5 * s, 'the part covered again');
    t.ok(await fogAt(t, 9 * s, 5 * s) < 30, 'the rest of the rectangle stays clear');
  });

  area.deep('Reveal everything clears the map; Undo walks back through the fog one step at a time', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    await t.cmd('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: 6 * s, y: 6 * s, r: 1.5 * s });
    await t.cmd('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: 14 * s, y: 6 * s, r: 1.5 * s });
    await clear(t, 14 * s, 6 * s, 'the second circle');
    await t.cmd('history.undo');
    t.eq(t.store.map(own).fog.ops.length, 1, 'fog steps after one Undo');
    await covered(t, 14 * s, 6 * s, 'the second circle after Undo');
    t.ok(await fogAt(t, 6 * s, 6 * s) < 30, 'the first circle is still clear');
    await t.cmd('history.redo');
    await clear(t, 14 * s, 6 * s, 'the second circle after Redo');
    await t.cmd('fog.base', { mapId: m.id, base: 'clear' });
    await clear(t, 3 * s, 3 * s, 'a corner after Reveal everything');
    await clear(t, 18 * s, 10 * s, 'the far side after Reveal everything');
    t.eq(t.store.map(own).fog.ops.length, 0, 'fog steps after Reveal everything');
  });

  area.deep('a brush stroke reveals along its path and nowhere else', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    t.gm().webContents.focus();
    await t.key('R');
    // (to the right of the Fog panel, which lies over the left of the map)
    const a = await t.scr(12 * s, 8 * s); const b = await t.scr(20 * s, 8 * s);
    await t.drag(a, b, 14);
    await t.until(() => t.store.map(own).fog.ops.length === 1, 3000, 'the stroke');
    await clear(t, 16 * s, 8 * s, 'the middle of the stroke');
    await clear(t, 12.2 * s, 8 * s, 'its start');
    const r = t.store.map(own).fog.ops[0].r;
    t.ok(await fogAt(t, 16 * s, 8 * s + r + 1.2 * s) > 200, 'beside the stroke it stays covered', r / s);
    t.ok(await fogAt(t, 20 * s + r + 1.5 * s, 8 * s) > 200, 'beyond its end it stays covered');
  });

  area.deep('switching fog off shows the whole map on the TV without changing the fog; on again covers it as before', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    await t.cmd('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: 10 * s, y: 10 * s, r: 2 * s });
    await clear(t, 10 * s, 10 * s, 'the circle');
    const seen = (x, y) => t.t(`(() => { const d = window.__table.debug(); const f = document.querySelector('.tv-layer.shown .sv-fog, .tv-layer.shown canvas.fog, .tv-layer.shown [class*="fog"]'); return f ? getComputedStyle(f).display !== 'none' && getComputedStyle(f).visibility !== 'hidden' && Number(getComputedStyle(f).opacity) > 0.05 : null; })()`);
    t.eq(await seen(), true, 'the fog is drawn on the TV');
    await t.cmd('fog.enabled', { mapId: m.id, enabled: false });
    await t.until(async () => (await seen()) === false, 4000, 'the fog to be taken off the TV');
    t.eq(t.store.map(own).fog.ops.length, 1, 'fog steps while it is off');
    await t.cmd('fog.enabled', { mapId: m.id, enabled: true });
    await t.until(async () => (await seen()) === true, 4000, 'the fog to be back on the TV');
    await covered(t, 16 * s, 4 * s, 'the covered ground');
    t.ok(await fogAt(t, 10 * s, 10 * s) < 30, 'the circle is still clear');
  });

  area.deep('a long fog is folded into one picture after a quiet moment; the TV shows the same fog', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    // 256 small holes in a grid: more steps than the app keeps one by one
    for (let i = 0; i < 256; i++) t.handle('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: (2 + (i % 16)) * s, y: (1 + Math.floor(i / 16) * 0.75) * s, r: 0.3 * s });
    await t.settle();
    await clear(t, 2 * s, 1 * s, 'the first hole');
    await clear(t, 17 * s, 12.25 * s, 'the last hole');
    const pts = [[2, 1], [9, 4], [17, 12.25], [2.5, 1.375], [9.5, 4.375], [12.5, 6.625], [21, 14]];
    const read = async () => { const out = []; for (const [x, y] of pts) out.push((await fogAt(t, x * s, y * s)) > 128); return out; };
    const before = await read();
    t.eq(before, [false, false, false, true, true, true, true], 'clear holes and covered ground before folding');
    await t.until(() => t.store.map(own).fog.ops.length < 256 && t.store.map(own).fog.ops[0].shape === 'mask', 20000, 'the fog to be folded');
    t.ok(t.store.map(own).fog.ops.length <= 31, 'the newest 30 steps stay, the rest is one picture', t.store.map(own).fog.ops.length);
    await t.sleep(1000);
    t.eq(await read(), before, 'the same holes and ground after folding');
  }, { ms: 60000 });

  // Speed 5 (Open Point WE6, first half): player steps keep the fog small
  area.quick('WE6: on a dark map one player\'s step records only what changed: the other tokens, standing still and seeing the same, add nothing; after the GM covers something they record again', async (t) => {
    const MS = require('../../mapstate'); const V = require('../../renderer/vision');
    const id = await t.newMap('WE6 (test)', { blank: true });
    const M = () => t.store.map(id);
    const k = M().grid.size;
    try {
      t.handle('light.update', { mapId: id, darkness: 0.9 });
      t.handle('fog.enabled', { mapId: id, enabled: true });
      // four player tokens far apart, each seeing for itself, with a candle (light for two squares)
      const at = [[2, 2], [2, 14], [24, 2], [13, 8]];
      const toks = at.map(([x, y]) => t.handle('layer.add', { mapId: id, path: t.pic('tokens'), role: 'token', x: (x + 0.5) * k, y: (y + 0.5) * k, size: 1 }).selected);
      for (const tok of toks) t.handle('fx.add', { mapId: id, kind: 'light', preset: 'party', attachTo: tok, carry: 'candle' }); // (a party light on the token: the app takes a player's eye away from a token that is no player's)
      await t.settle();
      const sights = () => M().fog.ops.filter((o) => o.shape === 'sight');
      const eyeOf = (tok) => M().fx.find((x) => x.attachTo === tok && x.preset === 'party').id;
      t.eq([V.eyes(M()).length, V.isDark(M())], [4, true], 'eyes on the map; the map is dark');
      t.ok(toks.every((tok) => sights().some((o) => o.eye === eyeOf(tok))), 'each of them has a record of what it sees', sights().length);
      // twenty steps of the fourth, a square to and fro
      const n0 = sights().length; const s0 = { ...MS.sightStats }; const bytes0 = JSON.stringify(M().fog.ops).length;
      for (let i = 0; i < 20; i++) t.handle('layer.update', { mapId: id, id: toks[3], x: (13.5 + (i % 2 ? 0 : 1)) * k, final: true });
      const made = sights().slice(n0);
      t.eq([made.length, made.every((o) => o.eye === eyeOf(toks[3])), MS.sightStats.made - s0.made, MS.sightStats.same - s0.same], [20, true, 20, 60], 'records for 20 steps: all of the token that stepped; made; left out because they said nothing new');
      t.note('20 steps with four tokens: ' + made.length + ' records, ' + Math.round((JSON.stringify(M().fog.ops).length - bytes0) / 1024) + ' KB more fog (before: 80 records)');
      // every eye's newest record still says what it sees now
      const rnd = (pts) => pts.map((v) => Math.round(v * 100) / 100);
      const walled = V.on(M()); const sig = walled ? V.wallSig(M()) : 'open';
      const right = V.eyes(M()).every((e) => { const o = sights().filter((x) => x.eye === e.id).pop(); const now = V.sight(M(), e, sig, walled); return JSON.stringify([o.pts, o.lit]) === JSON.stringify([rnd(now.pts), now.lit ? now.lit.map(rnd) : null]); });
      t.ok(right, 'the newest record of each token is what it sees now');
      // the GM covers what the first token sees: with the next step it is recorded again (the fog as it always came out)
      t.handle('fog.op', { mapId: id, mode: 'cover', shape: 'circle', x: 2.5 * k, y: 2.5 * k, r: 3 * k });
      const n1 = sights().length;
      t.handle('layer.update', { mapId: id, id: toks[3], x: 14.5 * k, final: true });
      const after = sights().slice(n1).map((o) => o.eye).sort();
      t.eq(after, [eyeOf(toks[3]), ...toks.slice(0, 3).map(eyeOf)].sort(), 'after a cover: every token records what it sees once more');
      const n2 = sights().length;
      t.handle('layer.update', { mapId: id, id: toks[3], x: 13.5 * k, final: true });
      t.eq(sights().slice(n2).map((o) => o.eye), [eyeOf(toks[3])], 'and with the step after that, only the one that stepped again');
      // a token that comes near another: its candle lights what the other sees, so the other records too
      const n3 = sights().length;
      t.handle('layer.update', { mapId: id, id: toks[3], x: 4.5 * k, y: 2.5 * k, final: true });
      const near = sights().slice(n3).map((o) => o.eye);
      t.ok(near.includes(eyeOf(toks[3])) && near.includes(eyeOf(toks[0])) && !near.includes(eyeOf(toks[1])) && !near.includes(eyeOf(toks[2])), 'next to the first token: the two of them record, the two far away do not', near.length);
    } finally {
      for (const l of M().layers.filter((x) => x.role === 'token')) t.handle('layer.remove', { mapId: id, id: l.id });
      t.handle('fog.enabled', { mapId: id, enabled: false });
      await t.settle();
    }
  });
};
