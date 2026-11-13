// Spell areas
'use strict';

module.exports = (area) => {
  area.title('Spells');
  area.before(async (K) => { await K.openDemo(); await K.send(); K.handle('fog.enabled', { enabled: false }); });

  area.quick('A opens Spells; Fireball cast with a click lands on a grid corner and shows on the TV', async (t) => {
    t.gm().webContents.focus();
    await t.key('A');
    t.eq(await t.tool(), 'spell', 'the tool after A');
    t.eq(await t.popTitle(), 'Spells', 'the panel after A');
    await t.clickText('#pop .spell-row', 'Fireball');
    const k = t.L().grid.size;
    const n0 = t.L().spells.length;
    const at = await t.scr(14.3 * k, 9.8 * k);
    await t.click(at.x, at.y);
    await t.until(() => t.L().spells.length === n0 + 1, 3000, 'the spell');
    const fb = t.L().spells[n0];
    t.eq(fb.name, 'Fireball', 'the spell cast');
    t.eq(fb.shape, 'sphere', 'its shape');
    const onCorner = (v) => Math.abs(v / k - Math.round(v / k)) < 0.001;
    t.ok(onCorner(fb.x) && onCorner(fb.y), 'it sits on a grid corner', [fb.x / k, fb.y / k]);
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.spells >= 1; }, 3000, 'the spell on the TV');
  });

  area.quick('the search finds a spell by name; Enter picks it', async (t) => {
    t.gm().webContents.focus();
    await t.key('A');
    await t.g(`(() => { const s = document.querySelector('#pop .spell-search'); s.value = ''; s.dispatchEvent(new Event('input')); s.focus(); })()`);
    await t.type('burning');
    await t.key('Enter');
    t.eq(await t.g('Play.ui.spell && Play.ui.spell.name'), 'Burning Hands', 'the spell picked');
  });

  area.quick('Clear all spell areas empties the map; Undo brings them back', async (t) => {
    const m = t.L(); const k = m.grid.size;
    t.handle('spell.add', { mapId: m.id, name: 'Test area', shape: 'cube', size: 15, x: 6 * k, y: 6 * k, mode: 'stay', color: '#ff7a3c' });
    await t.sleep(200);
    const n = t.L().spells.length;
    t.ok(n >= 1, 'a spell area to clear', n);
    t.handle('spell.clear', { mapId: m.id });
    await t.sleep(200);
    t.eq(t.L().spells.length, 0, 'spell areas after Clear');
    t.handle('history.undo');
    await t.sleep(200);
    t.eq(t.L().spells.length, n, 'spell areas after Undo');
  });

  // ---------- deep: exact results on a map of its own ----------
  let own = null;
  const ownMap = async (t) => {
    if (own && t.store.map(own)) { if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); } } else { own = await t.newMap('Spells (test)', { tv: true }); t.handle('fog.enabled', { mapId: own, enabled: false }); }
    const m = t.store.map(own);
    t.handle('spell.clear', { mapId: own });
    for (const l of m.layers.filter((x) => x.role === 'token')) t.handle('layer.remove', { mapId: own, id: l.id });
    await t.settle();
    return t.store.map(own);
  };
  const sp = (t) => t.store.map(own).spells;
  const last = (t) => sp(t)[sp(t).length - 1];
  const cells = (t, id) => t.g(`(() => { const v = Play.view(); return v.spellGeom(v.map.spells.find((s) => s.id === ${JSON.stringify(id)})).cells.length; })()`);
  const pick = async (t, q) => {
    t.gm().webContents.focus();
    await t.key('A');
    await t.g(`(() => { const s = document.querySelector('#pop .spell-search'); s.value = ''; s.dispatchEvent(new Event('input')); s.focus(); })()`);
    await t.type(q);
    await t.key('Enter');
  };
  // (the Spells panel lies over the left of the map: everything is cast to the right of it)

  area.deep('Fireball (20 ft radius) covers the squares the rules give it', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    await pick(t, 'fireball');
    const at = await t.scr((m.grid.ox || 0) + 20 * k, (m.grid.oy || 0) + 8 * k);
    await t.click(at.x, at.y);
    await t.until(() => sp(t).length === 1, 3000, 'the spell');
    const fb = last(t);
    t.eq([fb.name, fb.shape], ['Fireball', 'sphere'], 'the spell');
    const n = await cells(t, fb.id);
    t.ok(n >= 44 && n <= 60, 'a 20 ft sphere covers between 44 and 60 squares', n);
    t.ok(await t.g(`!!document.querySelector('#token-card.on .card-title')`), 'the cast spell shows its card');
  });

  area.deep('a cone is aimed by dragging; Shift snaps the aim to steps of 15°', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    await pick(t, 'burning');
    t.eq(await t.g('Play.ui.spell.name'), 'Burning Hands', 'the spell picked');
    await t.drag(await t.scr(16.2 * k, 9 * k), await t.scr(20.5 * k, 9 * k), 8);
    await t.until(() => sp(t).length === 1, 3000, 'the cone');
    const cone = last(t);
    t.eq(cone.shape, 'cone', 'its shape');
    t.near(cone.angle, 0, 1.5, 'it points where it was dragged (east)');
    const n = await cells(t, cone.id);
    t.ok(n >= 3 && n <= 12, 'a 15 ft cone covers between 3 and 12 squares', n);
    await pick(t, 'lightning bolt');
    const a = await t.scr(17 * k, 3 * k);
    const b = await t.scr(17 * k + 5 * k * Math.cos(0.65), 3 * k + 5 * k * Math.sin(0.65));
    await t.drag(a, b, 8, ['shift']);
    await t.until(() => sp(t).length === 2, 3000, 'the bolt');
    const bolt = last(t);
    t.eq(bolt.name, 'Lightning Bolt', 'the second spell');
    t.near(Math.abs(bolt.angle) % 15, 0, 0.001, 'its aim is a multiple of 15°');
    t.ok(Math.abs(bolt.angle) > 1, 'and not simply east', bolt.angle);
  });

  area.deep('an aura cast on a token stays with the token when it moves', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    const tok = t.handle('layer.add', { mapId: own, path: t.pic('tokens', /Hero/i), role: 'token', x: 18.5 * k, y: 8.5 * k, size: 1 }).selected;
    await t.until(() => t.rect(`.sv-token[data-id="${tok}"]`), 3000, 'the token');
    await pick(t, 'spirit guardians');
    const L0 = t.store.map(own).layers.find((l) => l.id === tok);
    const p = await t.scr(L0.x, L0.y);
    await t.click(p.x, p.y);
    await t.until(() => sp(t).length === 1, 3000, 'the aura');
    const aura = last(t);
    t.eq(aura.attachTo, tok, 'the aura belongs to the token');
    await t.cmd('layer.update', { mapId: own, id: tok, x: L0.x + 3 * k, y: L0.y - 2 * k });
    const c = await t.g(`(() => { const v = Play.view(); const g = v.spellGeom(v.map.spells.find((s) => s.id === ${JSON.stringify(aura.id)})).tpl; return { x: g.cx, y: g.cy }; })()`);
    const L1 = t.store.map(own).layers.find((l) => l.id === tok);
    t.ok(Math.hypot(c.x - L1.x, c.y - L1.y) < 0.01, 'the aura is centred on the token after the move', [c, L1.x, L1.y]);
  });

  area.deep('right-click a spell area: its own menu; Round +1 counts its rounds and the TV shows them', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    await t.cmd('spell.add', { mapId: own, name: 'Wall of test', shape: 'cube', size: 20, x: 18 * k, y: 8 * k, mode: 'stay', color: '#6cc3ff' });
    t.eq(sp(t).length, 1, 'a lasting spell area');
    t.gm().webContents.focus();
    await t.key('V');
    const g = await t.g(`(() => { const v = Play.view(); const g = v.spellGeom(v.map.spells[0]).tpl; return { x: g.cx, y: g.cy }; })()`);
    const p = await t.scr(g.x, g.y);
    await t.click(p.x, p.y, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the spell\'s menu');
    const items = await t.g(`[...document.querySelectorAll('#radial.on .radial-item span')].map((x) => x.textContent)`);
    for (const want of ['Cast again', 'Remove', 'Round +1']) t.has(items, want, 'the spell\'s menu');
    await t.clickText('.radial-item', 'Round +1');
    await t.until(() => sp(t)[0] && sp(t)[0].rounds === 1, 3000, 'the round to be counted');
    await t.until(() => t.t(`document.querySelectorAll('.tv-layer.shown .sv-spell-label b').length >= 1`), 3000, 'the round on the TV');
  });

  area.deep('a spell that lasts two rounds ends when its time is up', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    await t.cmd('spell.add', { mapId: own, name: 'Short spell', shape: 'cube', size: 10, x: 18 * k, y: 8 * k, mode: 'stay', rounds: 0, duration: 2 });
    const s0 = last(t);
    t.ok(s0 && s0.duration === 2 && s0.rounds === 0, 'a spell lasting two rounds', s0);
    await t.cmd('round.next', { mapId: own });
    await t.cmd('round.next', { mapId: own });
    t.eq(sp(t).length, 1, 'still there in its second round');
    await t.cmd('round.next', { mapId: own });
    t.eq(sp(t).length, 0, 'gone after its second round');
  });

  area.deep('a burst fades from the map on its own; a lasting area stays', async (t) => {
    const m = await ownMap(t); const k = m.grid.size;
    await t.g('window.ts.settings({ burstSeconds: 2 })');
    await t.cmd('spell.add', { mapId: own, name: 'Stays', shape: 'cube', size: 10, x: 22 * k, y: 4 * k, mode: 'stay' });
    await pick(t, 'shatter');
    const at = await t.scr(18 * k, 9 * k);
    await t.click(at.x, at.y);
    await t.until(() => sp(t).some((x) => x.name === 'Shatter'), 3000, 'the burst');
    await t.until(() => !sp(t).some((x) => x.name === 'Shatter'), 8000, 'the burst to fade');
    t.ok(sp(t).some((x) => x.name === 'Stays'), 'the lasting area is still there');
    await t.g('window.ts.settings({ burstSeconds: 8 })');
  });
};
