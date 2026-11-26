// Tokens on the map
'use strict';

module.exports = (area) => {
  area.title('Tokens');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  // a token of the check's own, on a free square
  const add = (t, cx = 4, cy = 4) => {
    const m = t.L(); const s = m.grid.size;
    const r = t.handle('layer.add', { mapId: m.id, path: t.pic('tokens', /Goblin/i), role: 'token', x: (cx + 0.5) * s, y: (cy + 0.5) * s, size: 1 });
    return r.selected;
  };
  const tok = (t, id) => t.L().layers.find((l) => l.id === id);

  area.quick('dragging a token moves it and snaps it to its square', async (t) => {
    const id = add(t);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    const r = await t.rect(`.sv-token[data-id="${id}"]`);
    const a = { ...tok(t, id) };
    await t.drag({ x: r.cx, y: r.cy }, { x: r.cx + 88, y: r.cy + 56 }, 8);
    const b = tok(t, id);
    const s = t.L().grid.size;
    t.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0.5, 'the token moved', [a.x, a.y, b.x, b.y]);
    const centred = (v) => Math.abs((((v / s) % 1) + 1) % 1 - 0.5) < 0.01;
    t.ok(centred(b.x) && centred(b.y), 'the token sits in the middle of a square', [b.x / s, b.y / s]);
    // (Glinn) its sheet opens on a click only, not when it is dragged
    await t.sleep(300);
    t.ok(!(await t.g(`!!document.querySelector('#token-sheet.on')`)), 'a drag leaves the sheet shut');
    const r2 = await t.rect(`.sv-token[data-id="${id}"]`);
    await t.click(r2.cx, r2.cy);
    await t.until(() => t.g(`!!document.querySelector('#token-sheet.on')`), 3000, 'a click opens it');
  });

  area.quick('a click selects a token and shows its sheet; H hides it from the players only', async (t) => {
    const id = add(t, 6, 4);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    await t.clickSel(`.sv-token[data-id="${id}"]`);
    await t.until(() => t.g(`!!document.querySelector('#token-sheet.on')`), 3000, 'the token sheet');
    await t.sleep(250);
    t.ok((await t.g(`(() => { const a = [...document.querySelectorAll('#token-sheet .ts-bar')].flatMap((b) => b.getAnimations()); return a.filter((x) => x.playState === 'running').length; })()`)) > 0, 'a quarter of a second in, the lines are still sliding out (redraws no longer cut it short)');
    // Beta 3.68: as it comes, four lines: the name, conditions, the light (an NPC), More; no toolbar
    t.eq(await t.g(`[...document.querySelectorAll('#token-sheet .ts-bar')].map((b) => b.classList[1])`), ['ts-name', 'ts-conds', 'ts-sight', 'ts-more'], 'four lines: name, conditions, light, More');
    t.ok(!(await t.g(`document.getElementById('token-card').classList.contains('on')`)), 'no toolbar above the token');
    const v0 = (await t.tvDebug()).tokensVisible;
    await t.key('H');
    await t.until(() => tok(t, id).hidden === true, 3000, 'H to hide the token');
    await t.until(async () => (await t.tvDebug()).tokensVisible === v0 - 1, 3000, 'the token to leave the TV');
    t.ok(await t.rect(`.sv-token[data-id="${id}"]`), 'the GM still sees it');
    await t.key('H');
    await t.until(async () => (await t.tvDebug()).tokensVisible === v0, 3000, 'the token to come back on the TV');
  });

  area.quick('Delete removes the selected token; the Undo button on the message brings it back', async (t) => {
    const id = add(t, 8, 4);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    await t.clickSel(`.sv-token[data-id="${id}"]`);
    await t.key('Delete');
    await t.until(() => !tok(t, id), 3000, 'the token to go');
    await t.until(() => t.rect('.toast .toast-undo'), 3000, 'the message with Undo');
    await t.clickSel('.toast .toast-undo');
    await t.until(() => !!tok(t, id), 3000, 'the token to come back');
  });

  // D3 (open point): conditions are kept on the token, show as small animations on the TV, and the turn order shows and
  // changes the same list. Beta 3.68 (Glinn): the token sheet took the wheel's place: a right-click opens the sheet with
  // More open (hit points, armour class, the turn order, size, hide, rename … Lines …, Remove); conditions on their line
  area.quick('a token\'s sheet: a right-click opens More; conditions on their line show on the TV and in the turn order; hit points and AC on the token', async (t) => {
    const id = add(t, 7, 3);
    const has = (c) => JSON.stringify(tok(t, id).cond || []) === JSON.stringify(c);
    const tv = () => t.t(`(() => { const e = document.querySelector('.tv-layer.shown .sv-token[data-id="${id}"]'); const b = document.querySelector('.tv-layer.shown .sv-tagbox[data-id="${id}"]'); return e && b && { bub: b.querySelectorAll('.sv-conds .cd-bub').length, prone: e.classList.contains('cd-prone') }; })()`);
    const typeIn = async (v) => {
      await t.until(() => t.g(`!!document.querySelector('.modal-back form input')`), 3000, 'the field to type in');
      await t.g(`(() => { const i = document.querySelector('.modal-back form input'); i.value = ${JSON.stringify(v)}; i.closest('form').requestSubmit(); })()`);
      await t.until(() => t.g(`!document.querySelector('.modal-back')`), 3000, 'the field to close');
    };
    try {
      await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
      t.gm().webContents.focus();
      await t.key('V');
      const more = async () => {
        await t.rightClickSel(`.sv-token[data-id="${id}"]`);
        return t.until(() => t.menu(), 3000, 'the sheet with More open');
      };
      const inOrder = () => t.state.init && t.state.init.entries.some((e) => e.tokens.includes(id));
      const items = await more();
      t.ok(await t.g(`!!document.querySelector('#token-sheet.on .ts-more')`), 'the right-click opened the sheet');
      t.ok((await t.g(`(() => { const a = [...document.querySelectorAll('#token-sheet .ts-bar')].flatMap((b) => b.getAnimations()); return a.filter((x) => x.playState === 'running').length; })()`)) > 0, 'after a right-click the lines slide out as after a left click');
      // (Beta 3.68, Glinn: in Sharp the menu had scroll bars: its corner lines stuck out of it)
      t.ok(await t.g(`(() => { const m = document.getElementById('menu'); return m.scrollWidth <= m.clientWidth && m.scrollHeight <= m.clientHeight; })()`), 'More has nothing to scroll');
      // (Glinn) it drops down right under its line
      await t.sleep(1000); // (the lines are still sliding out after a right-click)
      const mg = await t.g(`(() => { const m = document.getElementById('menu').getBoundingClientRect(); const b = document.querySelector('#token-sheet .ts-more').getBoundingClientRect(); return { dy: Math.round(m.top - b.bottom), left: Math.round(m.left - b.left), right: Math.round(b.right - m.right) }; })()`);
      t.ok(Math.abs(mg.dy) <= 2 && Math.abs(mg.right) <= 1, 'More drops down right under its line, the right edges in line', mg);
      for (const want of ['Hit points', 'Armour class', 'Size', 'Hide from players', 'Ping', 'Duplicate', 'Lines', 'Remove']) t.ok(items.some((x) => x.startsWith(want)), `More has ${want}`, items);
      // one place for each: what a line shows (conditions, its light) and the name things (the name line) are not in More
      for (const not of ['Conditions', 'Carry a light', 'Turn 45°', 'Name', 'Rename']) t.ok(!items.some((x) => x.startsWith(not)), `More has no ${not}`, items);
      if (inOrder()) { // (a prepared turn order takes the map's tokens by itself)
        await t.menuPick('In the turn order');
        await t.until(() => !inOrder(), 3000, 'the token out of the turn order');
        await more();
      }
      // hit points on the token, as long as it is not in the turn order
      await t.menuPick('Hit points');
      await typeIn('7');
      await t.until(() => tok(t, id).hp && tok(t, id).hp.cur === 7 && tok(t, id).hp.max === 7, 3000, 'the first number: 7 of 7');
      await more(); await t.menuPick('Hit points'); await typeIn('-3');
      await t.until(() => tok(t, id).hp.cur === 4, 3000, 'minus 3: 4 of 7');
      await more(); await t.menuPick('Armour class'); await typeIn('15');
      await t.until(() => tok(t, id).ac === 15, 3000, 'armour class 15 on the token');
      // into the turn order: it brings them; a change there comes back onto the token
      await more(); await t.menuPick('Into the turn order');
      await t.until(() => inOrder(), 3000, 'the token in the turn order');
      const ent = await t.until(() => t.g(`(() => { const I = Play.state().init; const hc = I && I.cols.find((x) => x.kind === 'hp'); const ac = I && I.cols.find((x) => x.kind === 'ac'); const e = I && I.entries.find((q) => (q.tokens || []).includes(${JSON.stringify(id)})); return e && hc && ac && { id: e.id, hc: hc.id, hp: e.vals[hc.id], ac: e.vals[ac.id] }; })()`), 3000, 'its line in the turn order');
      t.eq([ent.hp, ent.ac], [{ cur: 4, max: 7 }, 15], 'the turn order takes its hit points and AC');
      t.handle('init.set', { id: ent.id, vals: { [ent.hc]: { delta: -2 } } });
      await t.until(() => tok(t, id).hp.cur === 2, 3000, 'damage in the turn order: on the token too');
      // conditions: + on their line opens the grid, which stays open for several
      await t.key('Escape');
      await t.clickSel(`.sv-token[data-id="${id}"]`);
      await t.until(() => t.rect('#token-sheet.on .ts-conds .ts-add'), 3000, 'the conditions line');
      await t.clickSel('#token-sheet .ts-conds .ts-add');
      await t.until(() => t.rect('#cond-pick'), 3000, 'the conditions');
      t.eq(await t.count('#cond-pick .cond-chip'), 16, 'all sixteen');
      await t.clickText('#cond-pick .cond-chip', 'Poisoned');
      await t.clickText('#cond-pick .cond-chip', 'Prone');
      await t.until(() => has(['Poisoned', 'Prone']), 3000, 'two conditions on the token');
      t.ok(await t.rect('#cond-pick'), 'the grid stays open for more');
      await t.key('Escape');
      await t.until(async () => !(await t.rect('#cond-pick')), 2000, 'Esc closes it');
      await t.until(async () => (await t.count('#token-sheet .ts-conds .ts-cond')) === 2, 3000, 'both on the sheet');
      await t.until(async () => { const v = await tv(); return v && v.bub === 3 && v.prone; }, 3000, 'bubbles rising and the token lying down on the TV');
      // the turn order shows them; a change there reaches the token, in one undo step
      const view = await t.until(() => t.g(`(() => { const I = Play.state().init; const c = I && I.cols.find((x) => x.kind === 'cond'); const e = c && I.entries.find((q) => (q.tokens || []).includes(${JSON.stringify(id)})); return e && { id: e.id, col: c.id, v: e.vals[c.id] }; })()`), 3000, 'the turn order\'s Conditions column');
      t.eq(view.v, ['Poisoned', 'Prone'], 'the turn order shows the token\'s conditions');
      t.handle('init.set', { id: view.id, vals: { [view.col]: ['Stunned'] } });
      await t.until(() => has(['Stunned']), 3000, 'set in the turn order: on the token');
      t.handle('history.undo', {});
      await t.until(() => has(['Poisoned', 'Prone']), 3000, 'Undo brings the two back');
      // Campaign settings → Tokens on the table: off
      await t.g(`window.ts.settings({ tokens: { conds: false } })`);
      await t.until(async () => { const v = await tv(); return v && !v.bub && !v.prone; }, 3000, 'switched off: nothing on the token');
      await t.g(`window.ts.settings({ tokens: { conds: true } })`);
      await t.until(async () => { const v = await tv(); return v && v.bub === 3; }, 3000, 'on again');
      // Lines …: Hit points switched on brings its line; As it came takes it away again
      await more(); await t.menuPick('Lines');
      await t.until(() => t.rect('#sheet-lines'), 3000, 'Lines');
      await t.g(`document.querySelector('#sheet-lines .sl-row[data-v="hp"]').click()`);
      await t.until(() => (t.settings.tokens.sheet.npc || []).includes('hp'), 3000, 'Hit points on for NPCs');
      await t.until(() => t.g(`(() => { const b = document.querySelector('#token-sheet .ts-hp b'); return !!b && b.textContent.split(' ').join('') === '2/7'; })()`), 3000, 'its line on the sheet: 2 / 7');
      t.eq(t.settings.tokens.sheet.pc, ['conds', 'sight'], 'the players\' lines stay as they were');
      await t.key('Escape');
      const items2 = await more();
      t.ok(!items2.some((x) => x.startsWith('Hit points')), 'its line on: Hit points leaves More', items2);
      await t.menuPick('Lines');
      await t.until(() => t.rect('#sheet-lines'), 3000, 'Lines again');
      await t.g(`document.querySelector('#sheet-lines .sl-back').click()`);
      await t.until(() => JSON.stringify(t.settings.tokens.sheet.npc) === '["conds","sight"]', 3000, 'As it came');
      await t.key('Escape');
      // Rename: a click on the name
      await t.g(`document.querySelector('#token-sheet .ts-namebtn').click()`);
      await t.until(() => t.menu(), 3000, 'the name menu');
      await t.menuPick('Rename');
      await typeIn('Grimgor');
      await t.until(() => tok(t, id).name === 'Grimgor', 3000, 'the token renamed');
    } finally {
      await t.g(`window.ts.settings({ tokens: { conds: true, sheet: { pc: ['conds', 'sight'], npc: ['conds', 'sight'] } } })`);
      const e = t.state.init && t.state.init.entries.find((q) => q.tokens.includes(id));
      if (e) t.handle('init.remove', { ids: [e.id] });
      t.handle('layer.remove', { mapId: t.L().id, id });
    }
  });

  // Beta 3.2: Show to the table (table-show.js)
  const onTv = (t) => t.t(`document.querySelectorAll('#table-show .show-item').length`);
  const aside = (t, id) => t.t(`(() => { const e = document.querySelector('.tv-layer.shown .sv-token[data-id="${id}"]'); return !!e && e.classList.contains('on-show'); })()`);
  area.quick('Show to the table: the token flies to the middle of the TV and turns; a click on the GM screen brings it back', async (t) => {
    const id = add(t, 5, 6);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    await t.rightClickSel(`.sv-token[data-id="${id}"]`);
    await t.until(() => t.menu(), 3000, 'the token\'s sheet with More open');
    await t.menuPick('Show');
    await t.until(() => t.state.show && t.state.show.ids.includes(id), 3000, 'the show to start');
    await t.until(async () => (await onTv(t)) === 1, 3000, 'the picture on the TV');
    t.ok(await aside(t, id), 'the token itself steps aside on the TV');
    // T2 (open point): waits until it has landed in the middle (a fixed 1.3 s before)
    const c = await t.until(async () => { const v = await t.t(`(() => { const r = document.querySelector('#table-show .show-pic').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, W: innerWidth, H: innerHeight }; })()`); return Math.abs(v.x - v.W / 2) < v.W * 0.05 && Math.abs(v.y - v.H / 2) < v.H * 0.05 && v && v; }, 5000, 'the picture to land in the middle');
    t.ok(Math.abs(c.x - c.W / 2) < c.W * 0.05 && Math.abs(c.y - c.H / 2) < c.H * 0.05 && c.w <= Math.min(c.W, c.H) * 0.67, 'big, in the middle of the TV', c);
    t.ok(await t.t(`document.querySelector('#table-show .show-spot').classList.contains('on')`), 'the map dims round it');
    t.ok(await t.g(`!!document.querySelector('.sv-token.on-show') && !!document.querySelector('.show-pill')`), 'the GM screen marks it');
    // it faces the near long side first, then the far one (a wide TV: upright, then upside down), a while each
    const angle = () => t.t(`(() => { const a = (el) => { const x = getComputedStyle(el).transform; if (!x || x === 'none') return 0; const m = new DOMMatrix(x); return Math.atan2(m.b, m.a) * 180 / Math.PI; }; const p = document.querySelector('#table-show .show-pic').parentElement; return ((a(p) + a(p.parentElement)) % 360 + 360) % 360; })()`);
    const off = (a, want) => Math.abs((((a - want) % 360) + 540) % 360 - 180);
    const sh = t.state.show;
    t.ok(sh.sides === 2 && sh.turn > 7000, 'one turn with a stop at each long side', sh);
    const near = await angle();
    t.ok(off(near, 0) < 6, 'it faces the near side first', near);
    const until = async (ms) => { const w = sh.at + ms - Date.now(); if (w > 0) await t.sleep(w); };
    await until(1000 + 2000 + 1800 + 1000); // in the middle of the stop at the far side
    const far = await angle();
    t.ok(off(far, 180) < 6, 'then the far side', far);
    const at = { ...tok(t, id) };
    const vp = await t.rect('#viewport');
    await t.click(vp.x + vp.w * 0.5, vp.y + vp.h * 0.6);
    await t.until(() => !t.state.show || t.state.show.phase === 'back', 2000, 'the click to bring it back');
    await t.until(async () => (await onTv(t)) === 0, 3000, 'the picture to land');
    t.ok(!(await aside(t, id)), 'the token is back on the TV');
    await t.until(() => !t.state.show, 2000, 'the show to end');
    t.ok(!(await t.g(`!!document.querySelector('.show-pill')`)), 'the pill goes');
    t.eq([tok(t, id).x, tok(t, id).y], [at.x, at.y], 'the click did nothing else');
  });

  area.quick('Show and reveal: a hidden token joins the show and stays shown; the two line up side by side', async (t) => {
    const m = t.L();
    const a = add(t, 3, 9); const b = add(t, 6, 9);
    t.handle('layer.update', { mapId: m.id, id: b, hidden: true });
    t.ok(t.handle('show.start', { id: a }).ok, 'the first one shown');
    await t.sleep(300);
    const r = t.handle('show.start', { id: b, reveal: true });
    t.ok(r.ok && r.ids.length === 2, 'the second joins it', r);
    t.eq(tok(t, b).hidden, false, 'revealed on the map');
    await t.until(async () => (await onTv(t)) === 2, 3000, 'both on the TV');
    t.ok(await aside(t, b), 'the revealed one waits off the map until it lands');
    // T2: waits until both have landed side by side (a fixed 1.5 s before)
    const R = await t.until(async () => { const v = await t.t(`[...document.querySelectorAll('#table-show .show-item')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })`); return v.length === 2 && Math.abs(v[0].y - v[1].y) < 4 && v; }, 5000, 'both to land side by side');
    t.ok(Math.abs(R[0].y - R[1].y) < 4 && Math.abs(R[0].x - R[1].x) > R[0].w * 0.9, 'side by side', R);
    t.handle('show.end');
    await t.until(async () => (await onTv(t)) === 0, 3000, 'both to land');
    await t.until(() => !t.state.show, 2000, 'the show to end');
    t.ok(!(await aside(t, b)), 'the revealed one is on the map');
    t.eq(tok(t, b).hidden, false, 'it stays shown');
  });

  area.deep('a token shown to the table comes back by itself after one turn', async (t) => {
    const id = add(t, 9, 9);
    t.ok(t.handle('show.start', { id }).ok, 'shown');
    await t.until(async () => (await onTv(t)) === 1, 3000, 'the picture on the TV');
    await t.until(() => !t.state.show, 14000, 'the show to end by itself');
    await t.until(async () => (await onTv(t)) === 0, 2000, 'the picture to land');
    t.ok(!(await aside(t, id)), 'the token is back on the TV');
  });

  area.quick('N opens Tokens; picking one and clicking the map drops it there', async (t) => {
    t.gm().webContents.focus();
    await t.key('N');
    t.eq(await t.tool(), 'token', 'the tool after N');
    t.eq(await t.popTitle(), 'Tokens', 'the panel after N');
    // the panel offers the chapter's Ready list
    const ch = t.store.chapterOf(t.L().id);
    t.handle('ready.set', { chapterId: ch.id, kind: 'tokens', items: [{ path: t.pic('tokens', /Goblin/i) }] });
    await t.until(() => t.rect('#pop .tok-pick'), 5000, 'the Ready tokens to pick from');
    // (the panel can still be drawn again by the Ready list arriving, which drops a pick made just before: pick until it holds)
    await t.until(async () => {
      if (await t.g(`!!document.querySelector('#pop .tok-pick.on')`)) return true;
      await t.clickSel('#pop .tok-pick');
      await t.sleep(250);
      return t.g(`!!document.querySelector('#pop .tok-pick.on')`);
    }, 5000, 'the Goblin to be picked');
    const n0 = t.L().layers.filter((l) => l.role === 'token').length;
    const s = t.L().grid.size;
    const p = await t.scr(10.5 * s, 3.5 * s);
    await t.click(p.x, p.y);
    await t.until(() => t.L().layers.filter((l) => l.role === 'token').length === n0 + 1, 3000, 'the new token');
  });

  area.quick('copies of a token are numbered on the TV', async (t) => {
    const a = add(t, 3, 7); const b = add(t, 4, 7);
    await t.sleep(500);
    const nums = (await t.tvDebug()).tokenNumbers;
    t.ok(nums.length >= 2, 'numbers on the copies', nums);
    for (const id of [a, b]) t.handle('layer.remove', { mapId: t.L().id, id });
  });

  // ---------- deep: exact results on a map of its own ----------
  let own = null;
  const ownMap = async (t) => {
    if (own && t.store.map(own)) { if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); } } else { own = await t.newMap('Tokens (test)', { tv: true }); t.handle('fog.enabled', { mapId: own, enabled: false }); }
    // an empty map each time
    const m = t.store.map(own);
    for (const l of m.layers.filter((x) => x.role === 'token')) t.handle('layer.remove', { mapId: own, id: l.id });
    for (const f of [...m.fx]) t.handle('fx.remove', { mapId: own, id: f.id });
    await t.settle();
    return t.store.map(own);
  };
  const put = (t, cx, cy, extra = {}) => { const m = t.store.map(own); const s = m.grid.size; return t.handle('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: (cx + 0.5) * s, y: (cy + 0.5) * s, size: 1, ...extra }).selected; };
  const get = (t, id) => t.store.map(own).layers.find((l) => l.id === id);
  const label = (l) => `${l.name}${l.n ? ` ${l.n}` : ''}`;

  area.deep('copies of a token are numbered 1, 2, 3; removing one leaves the others their numbers; the TV shows the numbers', async (t) => {
    await ownMap(t);
    const a = put(t, 6, 4); const b = put(t, 8, 4); const c = put(t, 10, 4);
    await t.settle();
    t.eq([get(t, a).n, get(t, b).n, get(t, c).n], [1, 2, 3], 'the numbers of three copies');
    await t.until(async () => (await t.tvDebug()).tokenNumbers.length === 3, 3000, 'three numbers on the TV');
    t.eq((await t.tvDebug()).tokenNumbers.sort(), ['1', '2', '3'], 'the numbers on the TV');
    await t.cmd('layer.remove', { mapId: own, id: b });
    t.eq([get(t, a).n, get(t, c).n], [1, 3], 'the numbers after removing the second');
    const d = put(t, 12, 4);
    t.ok(![1, 3].includes(get(t, d).n), 'a new copy gets a number of its own', get(t, d).n);
  });

  area.deep('a name tag set to Players too shows on the TV, Only me only on the GM screen, and a hidden token never shows its name', async (t) => {
    await ownMap(t);
    const a = put(t, 6, 4, { tag: 'all' }); const b = put(t, 9, 4, { tag: 'all' });
    await t.until(async () => (await t.tvDebug()).tags.length === 2, 4000, 'two name tags on the TV');
    const tags = (await t.tvDebug()).tags.map((x) => x.text).sort();
    t.eq(tags, [label(get(t, a)), label(get(t, b))].sort(), 'the names on the TV');
    await t.cmd('layer.update', { mapId: own, id: b, tag: 'gm' });
    await t.until(async () => !(await t.tvDebug()).tags.some((x) => x.text === label(get(t, b))), 3000, 'the Only me tag to leave the TV');
    const gmTags = await t.g(`[...document.querySelectorAll('.sv-token-tag')].filter((e) => e.style.display !== 'none').map((e) => ({ text: e.dataset.name, mine: e.classList.contains('gm-only') }))`);
    t.eq(gmTags.find((x) => x.text === label(get(t, b))), { text: label(get(t, b)), mine: true }, 'the Only me tag on the GM screen');
    t.eq(gmTags.find((x) => x.text === label(get(t, a))), { text: label(get(t, a)), mine: false }, 'the Players too tag on the GM screen');
    await t.cmd('layer.update', { mapId: own, id: a, hidden: true });
    await t.until(async () => !(await t.tvDebug()).tags.some((x) => x.text === label(get(t, a))), 3000, 'a hidden token\'s name to leave the TV');
  });

  area.deep('renaming one token through its sheet gives it a name of its own, without a number', async (t) => {
    await ownMap(t);
    const a = put(t, 12, 4, { tag: 'all' }); put(t, 14, 4, { tag: 'all' });
    await t.until(() => t.rect(`.sv-token[data-id="${a}"]`), 3000, 'the token');
    t.gm().webContents.focus();
    await t.key('V');
    await t.clickSel(`.sv-token[data-id="${a}"]`);
    await t.until(() => t.rect('#token-sheet.on .ts-namebtn'), 3000, 'the token sheet');
    await t.g(`document.querySelector('#token-sheet .ts-namebtn').click()`);
    const menu = await t.until(() => t.menu(), 3000, 'the name menu');
    t.ok(menu.some((x) => /^Rename this/.test(x)) && menu.some((x) => /^Rename all/.test(x)), 'the menu offers this one and all copies', menu);
    await t.menuPick('Rename this');
    await t.until(() => t.rect('.modal input'), 3000, 'the name field');
    await t.g(`(() => { const i = document.querySelector('.modal input'); i.value = 'Grimgor'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.modal .btn.primary').click(); })()`);
    await t.until(() => get(t, a).name === 'Grimgor', 3000, 'the new name');
    t.ok(get(t, a).named && !get(t, a).n, 'a name of its own, out of the numbering', get(t, a));
    await t.until(async () => (await t.tvDebug()).tags.some((x) => x.text === 'Grimgor'), 3000, 'the new name on the TV');
  });

  area.deep('a Large token snaps to a grid corner, a Medium one to the middle of a square', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    const big = t.handle('layer.add', { mapId: own, path: t.pic('tokens', /Ogre/i), role: 'token', x: 13 * s, y: 6 * s, size: 2 }).selected;
    const med = put(t, 16, 9);
    await t.until(() => t.rect(`.sv-token[data-id="${big}"]`), 3000, 'the Large token');
    t.gm().webContents.focus();
    await t.key('V');
    for (const id of [big, med]) {
      const r = await t.rect(`.sv-token[data-id="${id}"]`);
      await t.drag({ x: r.cx, y: r.cy }, { x: r.cx + 47, y: r.cy + 29 }, 8);
    }
    // (the grid of a map need not start at the map's corner)
    const g = t.store.map(own).grid;
    const frac = (v, o) => ((((v - (o || 0)) / s) % 1) + 1) % 1;
    const B = get(t, big); const M = get(t, med);
    t.ok(Math.hypot(B.x - 13 * s, B.y - 6 * s) > 0.3 * s, 'the Large token moved');
    t.ok(Math.min(frac(B.x, g.ox), 1 - frac(B.x, g.ox)) < 0.01 && Math.min(frac(B.y, g.oy), 1 - frac(B.y, g.oy)) < 0.01, 'the Large token sits on a corner', [frac(B.x, g.ox), frac(B.y, g.oy)]);
    t.ok(Math.abs(frac(M.x, g.ox) - 0.5) < 0.01 && Math.abs(frac(M.y, g.oy) - 0.5) < 0.01, 'the Medium token sits in a square', [frac(M.x, g.ox), frac(M.y, g.oy)]);
  });

  area.deep('a duplicate lies beside the original and gets the next number', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    const a = put(t, 12, 8);
    const r = await t.cmd('layer.duplicate', { mapId: own, id: a, dx: s, dy: 0 });
    const c = get(t, r.selected);
    t.ok(c && c.id !== a, 'a second token', r);
    t.near(c.x - get(t, a).x, s, 0.001, 'one square to the right');
    t.eq([get(t, a).n, c.n], [1, 2], 'the numbers of the two');
  });

  area.deep('a light carried by a token moves with it, and leaves the TV when the token is hidden', async (t) => {
    const m = await ownMap(t); const s = m.grid.size;
    const a = put(t, 12, 8);
    const fx = t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: get(t, a).x, y: get(t, a).y, r: 4 * s, attachTo: a });
    await t.settle();
    const light = t.store.map(own).fx.find((f) => f.attachTo === a);
    t.ok(light, 'the token carries a light', fx);
    await t.until(() => t.t(`window.__table.fxShown(${JSON.stringify(light.id)})`), 3000, 'the light on the TV');
    await t.cmd('layer.update', { mapId: own, id: a, x: get(t, a).x + 3 * s });
    const where = await t.g(`(() => { const v = Play.view(); const f = v.map.fx.find((x) => x.id === ${JSON.stringify(light.id)}); const p = v.fxPos ? v.fxPos(f) : null; return p; })()`);
    if (where) t.near(where.x, get(t, a).x, 0.01, 'the light is where the token is');
    await t.cmd('layer.update', { mapId: own, id: a, hidden: true });
    await t.until(async () => !(await t.t(`window.__table.fxShown(${JSON.stringify(light.id)})`)), 3000, 'the light to leave the TV with the hidden token');
    t.ok(await t.rect(`.sv-token[data-id="${a}"]`), 'the GM still sees the token');
  });

  // Beta 3.68 (Glinn): a player's token has its own sheet: their name and who plays them, conditions, their sight,
  // darkvision and the light they carry; More holds their phone and own light, the character card, Not a player token
  area.quick('a player\'s token sheet: their name, sight, darkvision and light; More has the player\'s rows', async (t) => {
    const party0 = (t.store.cur.meta.party || []).slice();
    t.handle('party.set', { names: [...new Set([...party0, 'Mira'])] });
    t.handle('char.set', { name: 'Mira', patch: { token: t.pic('tokens', /Hero/i), dark: 60, color: '#6cc3ff' } });
    const id = add(t, 9, 5);
    t.handle('layer.update', { mapId: t.L().id, id, player: 'Mira' });
    const mira = () => (t.g(`(Play.state().chars || []).find((c) => c.name === 'Mira')`));
    try {
      await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token');
      t.gm().webContents.focus();
      await t.key('V');
      await t.clickSel(`.sv-token[data-id="${id}"]`);
      await t.until(() => t.g(`!!document.querySelector('#token-sheet.on .ts-dot')`), 3000, 'a player\'s sheet');
      t.eq(await t.text('#token-sheet .ts-namebtn b'), 'Mira', 'their name');
      t.eq(await t.g(`[...document.querySelectorAll('#token-sheet .ts-bar')].map((b) => b.classList[1])`), ['ts-name', 'ts-conds', 'ts-sight', 'ts-more'], 'as it comes: name, conditions, sight and light, More');
      t.eq(await t.g(`[...document.querySelectorAll('#token-sheet .ts-sight .ts-chip')].map((b) => b.textContent.trim())`), ['Sight', 'No light'], 'sight and the light they carry (darkvision: on the character card)');
      // the lines: at the token's edge, all one length, no big picture of the token
      await t.sleep(1000); // (once they have slid out)
      const geo = await t.g(`(() => { const tk = document.querySelector('.sv-token[data-id="${id}"] .sv-token-pic').getBoundingClientRect(); const bs = [...document.querySelectorAll('#token-sheet .ts-bar')].map((b) => b.getBoundingClientRect()); return { gap: Math.round(bs[0].left - tk.right), widths: [...new Set(bs.map((b) => Math.round(b.width)))], ring: !!document.querySelector('#token-sheet img, .ts-ring') }; })()`);
      t.ok(Math.abs(geo.gap) <= 2 && geo.widths.length === 1 && !geo.ring, 'at the token\'s edge, one length, no ring', geo);
      // Ctrl + wheel turns it
      const r0 = tok(t, id).rotation || 0; const tr = await t.rect(`.sv-token[data-id="${id}"]`);
      t.gm().webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(tr.cx), y: Math.round(tr.cy), deltaX: 0, deltaY: -120, modifiers: ['control'] });
      await t.until(() => (tok(t, id).rotation || 0) !== r0, 3000, 'Ctrl + wheel turns the token');
      t.eq(Math.abs(((tok(t, id).rotation - r0) % 360 + 360) % 360 - 180), 165, 'by 15°', tok(t, id).rotation);
      const eye0 = (await mira()).eye;
      await t.clickSel('#token-sheet .ts-sight .ts-eye');
      await t.until(async () => (await mira()).eye === !eye0, 3000, 'a click on Sight switches it');
      await t.clickSel('#token-sheet .ts-sight .ts-eye');
      await t.until(async () => (await mira()).eye === eye0, 3000, 'and back');
      await t.clickSel('#token-sheet .ts-more');
      const items = await t.until(() => t.menu(), 3000, 'More');
      for (const want of ['Phone', 'Character card', 'Lines']) t.ok(items.some((x) => x.startsWith(want)), `More has ${want}`, items);
      for (const not of ['Duplicate', 'Armour class', 'Not a player token']) t.ok(!items.some((x) => x.startsWith(not)), `More has no ${not} (a player's AC: on the card; not a player: the name line)`, items);
      await t.clickSel('#token-sheet .ts-more');
      await t.until(async () => !(await t.g(`!!document.querySelector('#menu.on')`)), 2000, 'a second click on More closes it');
      await t.sleep(200);
      t.ok(!(await t.g(`!!document.querySelector('#menu.on')`)), 'and it stays closed');
      await t.g(`document.querySelector('#token-sheet .ts-namebtn').click()`);
      const nm = await t.until(() => t.menu(), 3000, 'the name menu');
      t.ok(nm.some((x) => x.startsWith('Not a player token')) && nm.some((x) => x.startsWith('Rename')), 'the name line: rename, name tag, not a player token', nm);
      await t.key('Escape');
    } finally {
      t.handle('layer.remove', { mapId: t.L().id, id });
      t.handle('party.set', { names: party0 });
    }
  });
};
