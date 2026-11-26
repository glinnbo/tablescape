// The map tools from the Toolbox: pointer, ruler, chalk, pen, text, eraser, markers and counters
'use strict';

module.exports = (area) => {
  area.title('Map tools');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Map tools (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });

  const M = (t) => t.store.map(own);
  // A10 (open point): a map's thumbnail menu has Replace the picture: that map opens, the Library asks for a new picture
  area.quick('a map\'s thumbnail menu: Replace the picture opens that map and the Library to pick a new one', async (t) => {
    const other = await t.g(`([...document.querySelectorAll('.map-tile')].map((x) => x.dataset.id).find((id) => id !== Play.state().editMapId)) || null`);
    t.ok(other, 'another map\'s thumbnail');
    await t.rightClickSel(`.map-tile[data-id="${other}"]`);
    const items = await t.until(() => t.menu(), 3000, 'the thumbnail\'s menu');
    t.ok(items.some((x) => /Replace the picture/.test(x)), 'Replace the picture is in the menu', items);
    await t.menuPick('Replace the picture');
    await t.until(() => t.state.editMapId === other, 4000, 'that map open');
    await t.until(() => t.g('Play.Drawer.isOpen'), 4000, 'the Library to pick a picture');
    await t.g('Play.Drawer.close()');
    t.handle('edit.open', { id: own }); await t.settle();
  });
  const clean = async (t) => {
    if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); }
    t.handle('draw.clear', { mapId: own }); t.handle('mark.clear', { mapId: own });
    await t.settle();
    return M(t);
  };
  // a tool picked from the Toolbox, as at the table
  const tile = async (t, label) => {
    await t.g(`document.querySelector('.rail-btn[data-id="toolbox"]').click()`);
    await t.until(() => t.popTitle(), 3000, 'the Toolbox');
    const ok = await t.g(`(() => { const b = [...document.querySelectorAll('#pop .tb-tile')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    t.ok(ok, `the Toolbox has ${label}`);
    await t.sleep(250);
  };
  // (the tool's panel lies over the left of the map: everything is done to the right of it)
  const cell = (t, cx, cy) => { const g = M(t).grid; return t.scr((g.ox || 0) + cx * g.size, (g.oy || 0) + cy * g.size); };

  area.quick('the Ruler measures a drag in feet and shows it on the TV', async (t) => {
    await clean(t);
    await tile(t, 'Ruler');
    // from the middle of one square to the middle of the sixth one over
    const a = await cell(t, 14.5, 8.5); const b = await cell(t, 20.5, 8.5);
    await t.mouse('mouseMove', a.x, a.y); await t.mouse('mouseDown', a.x, a.y);
    for (let i = 1; i <= 8; i++) await t.mouse('mouseMove', a.x + ((b.x - a.x) * i) / 8, a.y, 'left', { modifiers: ['leftButtonDown'] });
    // (read while the button is still held, once the TV has caught up with the last move)
    let shown = null;
    await t.until(async () => { shown = (await t.tvDebug()).measure; return shown && /\b30\s*ft\b/.test(shown); }, 4000, 'the TV to show 30 ft for 6 squares').catch((e) => { throw new Error(`${e.message} (it shows ${JSON.stringify(shown)})`); });
    await t.mouse('mouseUp', b.x, b.y);
  });

  area.quick('a Pen line stays on the map and shows on the TV', async (t) => {
    await clean(t);
    await tile(t, 'Pen');
    await t.drag(await cell(t, 14, 9), await cell(t, 21, 10), 12);
    const pen = await t.until(() => M(t).draw.find((d) => d.kind === 'pen'), 3000, 'the line');
    t.ok(pen.pts.length / 2 >= 4, 'the line follows the mouse', pen.pts.length / 2);
    await t.until(async () => (await t.tvDebug()).pens >= 1, 3000, 'the line on the TV');
  });

  area.deep('the Spotlight darkens the TV except around the mouse; Esc ends it', async (t) => {
    await clean(t);
    await tile(t, 'Spotlight');
    const p = await cell(t, 18, 8);
    await t.mouse('mouseMove', p.x, p.y); await t.sleep(80); await t.mouse('mouseMove', p.x + 12, p.y + 4);
    await t.until(async () => (await t.tvDebug()).spot === true, 3000, 'the spotlight on the TV');
    await t.key('Escape');
    await t.until(async () => (await t.tvDebug()).spot === false, 3000, 'the spotlight to end');
  });

  area.deep('Chalk shows on the TV and is not kept with the map', async (t) => {
    await clean(t);
    await tile(t, 'Chalk');
    const n0 = M(t).draw.length;
    await t.drag(await cell(t, 14, 6), await cell(t, 21, 7), 12);
    await t.until(async () => (await t.tvDebug()).chalk >= 1, 3000, 'the chalk on the TV');
    t.eq(M(t).draw.length, n0, 'drawings kept with the map');
  });

  area.deep('Marks → Label: a click, a few words and Enter put a label on the map and the TV', async (t) => { // (Third Builder (third-marks-tool): Text moved from Draw into Marks)
    await clean(t);
    await tile(t, 'Marks');
    await t.g(`Play.ui.mark.me = false; Play.ui.mark.text = ''; document.querySelector('#pop .mk-kinds .tile[data-v="label"]').click()`);
    await t.sleep(200);
    const p = await cell(t, 17, 5);
    await t.click(p.x, p.y);
    await t.sleep(250);
    t.gm().webContents.focus();
    await t.type('The old well');
    await t.key('Enter');
    const tx = await t.until(() => M(t).draw.find((d) => d.kind === 'text'), 3000, 'the label');
    t.eq(tx.text, 'The old well', 'what it says');
    await t.until(async () => (await t.tvDebug()).texts.includes('The old well'), 3000, 'the label on the TV');
  });

  area.deep('Erase removes a pen line it is dragged across; Ctrl + Z brings the line back', async (t) => {
    await clean(t);
    await tile(t, 'Pen');
    await t.drag(await cell(t, 14, 9), await cell(t, 21, 9), 12);
    await t.until(() => M(t).draw.filter((d) => d.kind === 'pen').length === 1, 3000, 'the line');
    await tile(t, 'Erase');
    await t.drag(await cell(t, 17.5, 7.5), await cell(t, 17.6, 10.5), 10);
    await t.until(() => M(t).draw.filter((d) => d.kind === 'pen').length === 0, 3000, 'the line to be erased');
    t.gm().webContents.focus();
    await t.key('Z', ['control']);
    await t.until(() => M(t).draw.filter((d) => d.kind === 'pen').length === 1, 3000, 'the line to come back');
  });

  area.deep('a pin placed with a click shows on the TV; Clear removes it and Undo brings it back', async (t) => {
    await clean(t);
    await tile(t, 'Marks'); // (Third Builder (third-marks-tool): was Marker)
    await t.g(`Play.ui.mark.me = false; Play.ui.mark.text = ''; document.querySelector('#pop .mk-kinds .tile[data-v="pin"]').click()`);
    await t.sleep(200);
    const p = await cell(t, 19, 5);
    await t.click(p.x, p.y);
    const mk = await t.until(() => M(t).marks.find((m) => m.kind !== 'note' && m.kind !== 'counter'), 3000, 'the marker');
    await t.until(async () => (await t.tvDebug()).marks.includes(mk.kind), 3000, 'the marker on the TV');
    await t.cmd('mark.clear', { mapId: own });
    t.eq(M(t).marks.length, 0, 'markers after Clear');
    await t.cmd('history.undo');
    t.eq(M(t).marks.length, 1, 'markers after Undo');
  });

  area.deep('a Counter set to count down goes down by one each round and shows its number on the TV', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('mark.add', { mapId: own, kind: 'counter', x: 18 * k, y: 6 * k, label: 'Ritual', value: 3, auto: 'down' });
    await t.until(async () => (await t.tvDebug()).counters.includes('Ritual=3'), 3000, 'the counter on the TV');
    await t.cmd('round.next', { mapId: own });
    t.eq(M(t).marks[0].value, 2, 'the counter after a round');
    await t.until(async () => (await t.tvDebug()).counters.includes('Ritual=2'), 3000, 'the new number on the TV');
    await t.cmd('mark.add', { mapId: own, kind: 'counter', x: 20 * k, y: 6 * k, label: 'Still', value: 5 });
    await t.cmd('round.next', { mapId: own });
    t.eq(M(t).marks.find((x) => x.label === 'Still').value, 5, 'a counter that does not follow the rounds stays');
  });

  // N1 (open point): Undo in a toast after switching map undoes the map it was done on, not the one open now
  area.quick('Undo in a toast after a switch of map undoes the map it was done on', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const id = (await t.cmd('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: 6.5 * k, y: 6.5 * k, size: 1 })).selected;
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token');
    await t.g(`Play.undoable('layer.remove', { id: ${JSON.stringify(id)} })`);
    await t.until(() => !M(t).layers.some((l) => l.id === id), 3000, 'the token removed');
    const other = t.store.allMapIds().find((x) => x !== own);
    const n0 = t.store.map(other).layers.length; const w0 = t.store.map(other).walls.length;
    t.handle('wall.add', { mapId: other, segs: [[1, 1, 2, 1]] }); // (something to undo on the other map)
    t.handle('edit.open', { id: other });
    await t.until(() => t.g(`Play.state().map.id === ${JSON.stringify(other)}`), 4000, 'the other map open');
    await t.until(() => t.rect('.toast .toast-undo'), 3000, 'the toast with Undo still there');
    await t.clickSel('.toast .toast-undo');
    await t.until(() => M(t).layers.some((l) => l.id === id), 3000, 'Undo brings the token back on its own map');
    t.eq([t.store.map(other).layers.length, t.store.map(other).walls.length], [n0, w0 + 1], 'the open map untouched');
    t.handle('edit.open', { id: own });
  });

  // N2 (open point): with no map, the map's panels don't open (they broke); the Toolbox still does
  area.quick('with no map open, the map\'s panels stay shut without an error', async (t) => {
    await clean(t);
    const before = t.state.editMapId;
    t.state.editMapId = null; t.broadcast();
    try {
      await t.until(() => t.g('!Play.state().map'), 3000, 'no map open');
      for (const id of ['walls', 'fog', 'party', 'fx']) {
        await t.g(`Play.openPop(${JSON.stringify(id)})`);
        t.ok(!(await t.g(`!!document.querySelector('#pop .pop-error, #pop .pop-fail')`)) && !(await t.g(`document.querySelector('#pop') && document.querySelector('#pop').textContent.includes('ran into a problem')`)), `${id}: no "ran into a problem"`);
      }
    } finally { t.handle('edit.open', { id: before || own }); await t.until(() => t.g('!!Play.state().map'), 3000, 'the map back'); }
  });

  // N5, N7, N8, N9 (open points): token Bigger snaps to the 5e sizes; X after J puts marks on the table again; Esc with
  // nothing else to close goes back to Select; a painted area's wheel says Stronger / Weaker
  area.quick('token made Large sits on the grid; X after J; Esc back to Select; Stronger and Weaker for a painted area', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const id = (await t.cmd('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: 8.5 * k, y: 8.5 * k, size: 1 })).selected;
    try {
      await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token');
      t.gm().webContents.focus(); await t.key('V');
      await t.rightClickSel(`.sv-token[data-id="${id}"]`);
      await t.until(() => t.menu(), 3000, 'the token sheet with More open'); // (Beta 3.68: the token sheet took the wheel's place)
      await t.menuPick('Size');
      await t.until(async () => (await t.menu() || []).some((x) => x.startsWith('Large')), 3000, 'the sizes');
      await t.menuPick('Large');
      const l = await t.until(() => { const x = M(t).layers.find((q) => q.id === id); return x && x.size !== 1 && x; }, 3000, 'bigger');
      t.eq(l.size, 2, 'Medium → Large (was 1.5)');
      const g = M(t).grid; const off = (v, o) => { const q = (v - (o || 0)) / g.size; return Math.abs(q - Math.round(q)); };
      t.ok(off(l.x, g.ox) < 0.01 && off(l.y, g.oy) < 0.01, 'a Large token sits on grid lines (its middle on a corner)', [off(l.x, g.ox), off(l.y, g.oy)]);
    } finally { await t.cmd('layer.remove', { mapId: own, id }); }
    // N7
    await t.key('J'); await t.sleep(200);
    t.ok(await t.g('!!Play.ui.mark.me'), 'J: a note only you see');
    await t.key('X'); await t.sleep(200);
    t.ok(await t.g('!Play.ui.mark.me'), 'X afterwards: marks go on the table again');
    // N8
    await t.key('W'); await t.until(() => t.g(`Play.ui.tool === 'walls'`), 3000, 'Walls');
    await t.key('Escape'); await t.sleep(150);
    if (await t.g(`Play.ui.tool !== 'select'`)) { await t.key('Escape'); await t.sleep(150); }
    t.eq(await t.g('Play.ui.tool'), 'select', 'Esc, with nothing else to close: back to Select');
    // N9
    const rid = (await t.cmd('fx.add', { mapId: own, kind: 'region', preset: 'mist', intensity: 1, density: 1, speed: 1, strokes: [{ sid: 'a', r: 2 * k, pts: [12 * k, 12 * k, 16 * k, 12 * k] }] })).selected;
    try {
      await t.g(`Play.openFxRadial(${JSON.stringify(rid)}, 400, 300)`);
      const labels = await t.until(async () => { const x = await t.g(`[...document.querySelectorAll('#radial .radial-item > span')].map((s) => s.textContent)`); return x.length && x; }, 3000, 'the area\'s wheel');
      t.has(labels, 'Stronger', 'the area\'s wheel'); t.has(labels, 'Weaker', 'the area\'s wheel');
    } finally { await t.g(`document.querySelector('#radial .radial-center') && document.querySelector('#radial .radial-center').click()`); if (rid) t.handle('fx.remove', { mapId: own, id: rid }); }
  });

  area.deep('a note is for the GM alone: on the GM screen, never on the TV', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('mark.add', { mapId: own, kind: 'note', x: 18 * k, y: 9 * k, text: 'Trap under the rug' });
    await t.sleep(300);
    const d = await t.tvDebug();
    t.eq(d.notes, 0, 'notes on the TV');
    t.ok(!(await t.t(`document.body.textContent.includes('Trap under the rug')`)), 'its words are nowhere on the TV');
    t.ok(await t.g(`document.querySelectorAll('.sv-mark.kind-note, .sv-note').length >= 1`), 'the GM sees the note');
  });
};
