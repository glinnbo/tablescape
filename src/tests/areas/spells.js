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

  // Second Builder (second-spell-looks): with a graphics card the areas are drawn by spell-gl.js, each damage type its
  // own look; a colour the GM picks still colours it; the outline stays where it was
  area.quick('spell looks are drawn by the graphics card: fire burns orange, cold is blue, a picked colour is used', async (t) => {
    const m = t.L(); const k = m.grid.size;
    t.handle('spell.clear', { mapId: m.id });
    await t.t('SpellGL.allowSoft(true)'); // (Second Builder, second-spell-warmup: software graphics only in the self-test)
    const st = await t.t('SpellGL.warm()');
    const gl = st && st.state === 'ready';
    if (!gl) { t.ok(true, `no WebGL 2 here (${st && st.state}: ${st && st.why}): the old drawing is used (checked by the other spell checks)`); return; }
    const cast = async (skin, at, color) => {
      t.handle('spell.add', { mapId: m.id, name: `Look ${skin}`, shape: 'sphere', size: 15, skin, x: at.x * k, y: at.y * k, mode: 'stay', ...(color ? { color } : {}) });
      await t.sleep(150);
    };
    await cast('fire', { x: 6, y: 6 });
    await cast('cold', { x: 16, y: 6 });
    await cast('fire', { x: 11, y: 14 }, '#3cff6e');
    const n0 = await t.t('SpellGL.stats.drawn');
    await t.until(async () => (await t.t('SpellGL.stats.drawn')) > n0 + 6, 8000, 'the TV drawing the spells with the graphics card');
    await t.sleep(1200); // (past the cast)
    // the average colour over the middle of each area
    const avg = (x, y) => t.t(`(() => { let r = 0, g = 0, b = 0, n = 0; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const p = window.__table.probeMap('spell', (${x} + i * 0.25) * ${k}, (${y} + j * 0.25) * ${k}); if (p) { r += p[0] * p[3] / 255; g += p[1] * p[3] / 255; b += p[2] * p[3] / 255; n++; } } return [r / n, g / n, b / n]; })()`);
    const fire = await avg(6, 6); const cold = await avg(16, 6); const green = await avg(11, 14);
    await t.shot(t.tv(), 'spell-looks-tv');
    t.ok(fire[0] > 60 && fire[0] > fire[2] * 1.6, 'the fire is orange-red where it burns', fire);
    t.ok(cold[2] >= cold[0] && cold[2] > 30, 'the cold is blue-white', cold);
    t.ok(green[1] > green[0] && green[1] > green[2], 'a fire the GM made green burns green', green);
    t.handle('spell.clear', { mapId: m.id });
  });

  // Second Builder (second-spell-warmup): the spells' program is built in the background from the start; a spell
  // never waits for it (before, the first spell held the GM window for ten seconds on Windows), each window writes
  // what it found into the log, and Options → Performance switches the realistic spell areas off on both screens
  area.quick('the spells\' program builds in the background: a spell never waits for it; the log says how it went', async (t) => {
    const how = await t.g('SpellGL.warm()');
    t.ok(how && ['ready', 'slow', 'off', 'failed'].includes(how.state), 'the GM window settled on a way to draw spells', how);
    const logFile = (await t.g('window.ts.app("about")')).log;
    const log = () => require('fs').readFileSync(logFile, 'utf8');
    t.ok(/\[gm\] spells: /.test(log()), 'the GM window wrote how it draws spells into the log');
    await t.until(() => /\[table\] spells: /.test(log()), 8000, 'the TV writing it too');
    // built again from nothing (software graphics allowed): asking right away returns at once, the old drawing meanwhile
    await t.t('SpellGL.allowSoft(true)');
    const r = await t.t(`(() => { SpellGL.retry(); const a = performance.now(); const ok = SpellGL.supported(); return { ok, ms: performance.now() - a, state: SpellGL.status().state }; })()`);
    t.ok(r.ms < 50, 'asking while it builds does not wait', r);
    t.ok(!r.ok || r.state === 'ready', 'while it builds, the old drawing', r);
    const after = await t.t('SpellGL.warm()');
    t.ok(['ready', 'off', 'failed'].includes(after.state), 'then it is ready (or there are no graphics for it here)', after);
  });

  area.quick('Options → Performance: Realistic spell areas off draws the simple ones on both screens', async (t) => {
    await t.g('window.ts.settings({ spellGpu: false })');
    await t.until(() => t.settings.spellGpu === false, 3000, 'the setting');
    await t.until(async () => (await t.t('SpellGL.status().off')) && (await t.g('SpellGL.status().off')), 5000, 'both screens to switch to the simple spells');
    const m = t.L(); const k = m.grid.size;
    t.handle('spell.add', { mapId: m.id, name: 'Simple', shape: 'sphere', size: 15, skin: 'fire', x: 8 * k, y: 8 * k, mode: 'stay' });
    const n0 = await t.t('SpellGL.stats.drawn');
    await t.sleep(600);
    t.eq(await t.t('SpellGL.stats.drawn'), n0, 'nothing drawn by the graphics card while it is off');
    const px = await t.t(`window.__table.probeMap('spell', ${8 * k}, ${8 * k})`);
    t.ok(px && px[3] > 0, 'the spell still shows on the TV (the simple drawing)', px);
    await t.g('window.ts.settings({ spellGpu: true })');
    await t.until(async () => !(await t.t('SpellGL.status().off')), 5000, 'the realistic spells back');
    t.handle('spell.clear', { mapId: m.id });
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

  // Glinn's log, 26 Nov 2026: the TV found his graphics card "too slow" for the spells twice (it was busy with the map)
  area.quick('a graphics card found "too slow" for the spells while it was busy is timed again by itself and draws them after all; one that stays slow is left alone after three more tries; nothing waits for any of it', async (t) => {
    const st0 = await t.t('SpellGL.warm()');
    if (st0.state !== 'ready') { t.note('no graphics card for the spells here: ' + JSON.stringify(st0)); t.ok(true, 'nothing to time here'); return; }
    try {
      // busy at the first two timings, free at the third
      const first = await t.t(`(async () => { SpellGL.TEST.follow = false; SpellGL.TEST.waits = [250, 250, 250]; SpellGL.TEST.fakeSlow = 2; const a = performance.now(); const st = await SpellGL.retry(); return { state: st.state, why: st.why, ok: SpellGL.supported(), ms: Math.round(performance.now() - a) }; })()`);
      t.eq([first.state, first.ok], ['slow', false], 'found too slow: the old drawing for now, and whoever waited is told at once', first);
      t.ok(/too slow/.test(first.why), 'it says why', first.why);
      const back = await t.until(async () => { const st = await t.t('SpellGL.status()'); return st.state === 'ready' && st; }, 6000, 'it to be timed again by itself and found fast enough');
      t.eq([back.state, await t.t('SpellGL.supported()'), await t.t('SpellGL.TEST.fakeSlow')], ['ready', true, 0], 'timed again twice: the third time it is free, and the spells are drawn by the card', back);
      // a card that really is too slow: three more tries, then it is left alone
      const slow = await t.t(`(async () => { SpellGL.TEST.fakeSlow = 9; const st = await SpellGL.retry(); return st.state; })()`);
      t.eq(slow, 'slow', 'slow at once');
      await t.until(async () => (await t.t('SpellGL.TEST.fakeSlow')) === 5, 6000, 'three more timings after the first');
      await t.sleep(1200);
      t.eq([await t.t('SpellGL.TEST.fakeSlow'), (await t.t('SpellGL.status()')).state], [5, 'slow'], 'and then no more: four timings in all, the old drawing stays');
    } finally {
      await t.t(`(async () => { SpellGL.TEST.fakeSlow = 0; SpellGL.TEST.waits = [5000, 15000, 45000]; SpellGL.TEST.follow = true; await SpellGL.retry(); return 0; })()`);
    }
    t.eq((await t.t('SpellGL.status()')).state, 'ready', 'left as it was found: drawn by the card');
    // Glinn, 27 Nov 2026 (laptop and TV): the GM screen draws them by the card, the TV found itself too slow while it
    // painted the table. Same graphics card: the TV follows the GM screen
    if ((await t.g('SpellGL.status()')).state === 'ready') {
      const fol = await t.t(`(async () => { SpellGL.TEST.follow = true; SpellGL.TEST.fakeSlow = 1; const st = await SpellGL.retry(); return [st.state, SpellGL.supported(), SpellGL.status().testMs]; })()`);
      t.eq([fol[0], fol[1], fol[2]], ['ready', true, 999], 'the TV timed slow while the GM screen draws them by the card: the TV draws them by the card too');
      const logFile = (await t.g('window.ts.app("about")')).log;
      await t.until(() => /\[table\] spells: drawn by the graphics card .*the TV's own timing \(999 ms\)/.test(require('fs').readFileSync(logFile, 'utf8')), 4000, 'the log to say why');
    }
    await t.t(`(async () => { SpellGL.TEST.fakeSlow = 0; await SpellGL.retry(); return 0; })()`);
  });
};
