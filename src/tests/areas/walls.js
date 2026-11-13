// Walls, doors and line of sight
'use strict';

module.exports = (area) => {
  area.title('Walls, doors and line of sight');
  let own = null; let k = 1; let door = null; let party = null;
  const M = (t) => t.store.map(own);
  // one wall down the map at 12 squares from the left, with a door in the middle; the party stands to the left of it
  area.before(async (K) => {
    await K.openDemo();
    own = await K.newMap('Walls (test)', { tv: true });
    k = K.store.map(own).grid.size;
    K.handle('wall.add', { mapId: own, segs: [[12 * k, 1 * k, 12 * k, 7 * k]] });
    K.handle('wall.add', { mapId: own, segs: [[12 * k, 7 * k, 12 * k, 9 * k]], door: 1 });
    K.handle('wall.add', { mapId: own, segs: [[12 * k, 9 * k, 12 * k, 15 * k]] });
    door = K.store.map(own).walls.find((w) => w.door);
    K.handle('fx.add', { mapId: own, kind: 'light', preset: 'party', x: 8.5 * k, y: 8.5 * k, r: 6 * k });
    party = K.store.map(own).fx.find((f) => f.preset === 'party');
    K.handle('vision.update', { mapId: own, on: true });
    K.handle('fog.base', { mapId: own, base: 'cover' });
    await K.settle();
    await K.sleep(1200);
  });

  const sees = (t, x, y) => t.t(`window.__table.sees(${x * k}, ${y * k})`);
  const fogAt = (t, x, y) => t.t(`window.__table.fogAt(${x * k}, ${y * k})`);
  const shut = async (t) => { await t.cmd('wall.door', { mapId: own, id: door.id, open: false }); await t.sleep(500); };

  area.quick('the map has its walls, a door and the party', async (t) => {
    t.eq(M(t).walls.length, 3, 'walls on the map');
    t.ok(door && !door.open, 'a closed door', door);
    t.ok(party, 'the party marker', M(t).fx.map((f) => f.preset));
    t.eq(M(t).vision.on, true, 'line of sight is on');
  });

  area.quick('W opens Walls with its modes', async (t) => {
    t.gm().webContents.focus();
    await t.key('W');
    t.eq(await t.tool(), 'walls', 'the tool after W');
    t.eq(await t.popTitle(), 'Walls and doors', 'the panel after W');
    const modes = await t.count('#pop .wl-modes .seg-btn, #pop .wl-modes button');
    t.ok(modes >= 4, 'the ways to draw walls', modes);
  });

  area.quick('Walls → Kind: the button clicked lights up at once (Beta 3.1)', async (t) => {
    t.gm().webContents.focus();
    if ((await t.tool()) !== 'walls') await t.key('W');
    await t.until(() => t.popTitle(), 3000, 'the Walls panel');
    const lit = () => t.g(`[...document.querySelectorAll('#pop .seg:not(.wl-modes) .seg-btn.on')].map((b) => b.dataset.v)`);
    for (const kind of ['invisible', 'window', 'wall']) {
      await t.g(`document.querySelector('#pop .seg:not(.wl-modes) .seg-btn[data-v="${kind}"]').click()`);
      const on = await lit();
      t.ok(on.includes(kind), `${kind} is lit right after the click`, on);
      t.ok(!['invisible', 'window', 'wall'].filter((x) => x !== kind).some((x) => on.includes(x)), 'and only that kind', on);
    }
  });

  area.quick('a window opens and closes like a door: open the party sees through it, closed not; never shown on the TV (Beta 3.1)', async (t) => {
    await shut(t);
    const top = M(t).walls.find((w) => !w.door && w.y1 < 2 * k); // the wall above the door becomes a window
    await t.cmd('wall.update', { mapId: own, id: top.id, kind: 'window' });
    await t.until(() => sees(t, 16.5, 4.5), 6000, 'the party to see through the window');
    t.eq(await t.t(`document.querySelector('.sv-glass') ? document.querySelector('.sv-glass').childElementCount : 0`), 0, 'no line of glass on the TV');
    t.gm().webContents.focus();
    await t.key('V'); // a Play tool: doors and windows show their markers
    await t.until(() => t.rect(`.sv-door.win[data-id="${top.id}"]`), 4000, 'the window icon on your screen');
    const r = await t.cmd('wall.door', { mapId: own, id: top.id });
    t.ok(r && /Window closed/.test(r.label || ''), 'the window is closed', r);
    await t.until(async () => !(await sees(t, 16.5, 4.5)), 6000, 'the closed window to block the view');
    t.ok(M(t).walls.find((w) => w.id === top.id).shut, 'it is stored as closed');
    await t.cmd('wall.door', { mapId: own, id: top.id, open: true });
    await t.until(() => sees(t, 16.5, 4.5), 6000, 'the open window to let the view through again');
    await t.cmd('wall.update', { mapId: own, id: top.id, kind: null });
    await t.until(async () => !(await sees(t, 16.5, 4.5)), 6000, 'a wall again');
    await t.cmd('fog.base', { mapId: own, base: 'cover' }); // what the party saw through the window is covered again for the next checks
    await t.sleep(600);
  });

  area.deep('the party sees its own side of the wall and not what lies behind it', async (t) => {
    await shut(t);
    await t.until(() => sees(t, 9.5, 8.5), 6000, 'the party to see beside itself');
    t.eq(await sees(t, 6.5, 5.5), true, 'a point on its side');
    t.eq(await sees(t, 16.5, 4.5), false, 'a point behind the wall');
    t.eq(await sees(t, 16.5, 8.5), false, 'a point behind the closed door');
  });

  area.deep('what the party sees is revealed on the TV; behind the wall stays covered', async (t) => {
    await shut(t);
    await t.until(async () => (await fogAt(t, 9.5, 8.5)) < 60, 8000, 'the ground beside the party to be revealed');
    t.ok(await fogAt(t, 16.5, 4.5) > 200, 'behind the wall it stays covered', await fogAt(t, 16.5, 4.5));
    t.ok(await fogAt(t, 16.5, 8.5) > 200, 'behind the closed door it stays covered', await fogAt(t, 16.5, 8.5));
  });

  area.deep('opening the door lets the party see through it, and only through it', async (t) => {
    await shut(t);
    await t.cmd('wall.door', { mapId: own, id: door.id, open: true });
    await t.until(() => sees(t, 16.5, 8.5), 6000, 'the party to see through the open door');
    t.eq(await sees(t, 16.5, 3.5), false, 'the wall beside the door still blocks');
    await t.until(async () => (await fogAt(t, 15.5, 8.5)) < 60, 8000, 'the ground behind the door to be revealed');
    await shut(t);
    await t.until(async () => !(await sees(t, 16.5, 8.5)), 6000, 'the closed door to block again');
    t.ok(await fogAt(t, 15.5, 8.5) < 230, 'what was seen stays explored', await fogAt(t, 15.5, 8.5));
  });

  area.deep('a light does not shine through a wall: the same spot is lit from its own side and dark from the other', async (t) => {
    await shut(t);
    // a spot the party can see, out of reach of its own light; a torch four squares from it, first behind the wall, then on its side
    const W = [10.5, 1.6];
    await t.cmd('fog.enabled', { mapId: own, enabled: false });
    await t.cmd('light.update', { mapId: own, darkness: 0.95 });
    const dark = async (x, y) => { const p = await t.t(`window.__table.probeMap('light', ${x * k}, ${y * k})`); return p ? p[3] : null; };
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 14.5 * k, y: 1.6 * k, r: 5 * k });
    const torch = M(t).fx.find((f) => f.preset === 'torch');
    await t.until(async () => (await dark(22, 13)) > 200, 15000, 'the darkness on the TV');
    await t.sleep(800);
    const behind = await dark(W[0], W[1]);
    await t.cmd('fx.update', { mapId: own, id: torch.id, x: 6.5 * k, y: 1.6 * k, final: true });
    const lit = await t.until(async () => { const v = await dark(W[0], W[1]); return v < behind - 60 && v + 1; }, 8000, `the spot to be lit from its own side (behind the wall it was ${behind})`);
    t.ok(behind > 150, 'with the torch behind the wall the spot is dark', [behind, lit - 1]);
    await t.cmd('fx.remove', { mapId: own, id: torch.id });
    await t.cmd('light.update', { mapId: own, darkness: 0 });
    await t.cmd('fog.enabled', { mapId: own, enabled: true });
  }, { ms: 60000 });

  area.deep('a door can be put into a wall, and a wall removed; Undo brings it back', async (t) => {
    const n0 = M(t).walls.length;
    const w = M(t).walls.find((x) => !x.door);
    const r = await t.cmd('wall.add', { mapId: own, segs: [[2 * k, 12 * k, 6 * k, 12 * k]] });
    t.eq(M(t).walls.length, n0 + 1, 'walls after adding one');
    const added = M(t).walls[M(t).walls.length - 1];
    await t.cmd('wall.remove', { mapId: own, id: added.id });
    t.eq(M(t).walls.length, n0, 'walls after removing it');
    await t.cmd('history.undo');
    t.eq(M(t).walls.length, n0 + 1, 'walls after Undo');
    await t.cmd('wall.remove', { mapId: own, id: M(t).walls[M(t).walls.length - 1].id });
    t.ok(w && r, 'done');
  });
};
