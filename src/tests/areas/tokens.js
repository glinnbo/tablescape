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
  });

  area.quick('a click selects a token and shows its card; H hides it from the players only', async (t) => {
    const id = add(t, 6, 4);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    await t.clickSel(`.sv-token[data-id="${id}"]`);
    await t.until(() => t.g(`!!document.querySelector('#token-card.on')`), 3000, 'the token card');
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

  // Beta 3.2: Show to the table (table-show.js)
  const onTv = (t) => t.t(`document.querySelectorAll('#table-show .show-item').length`);
  const aside = (t, id) => t.t(`(() => { const e = document.querySelector('.tv-layer.shown .sv-token[data-id="${id}"]'); return !!e && e.classList.contains('on-show'); })()`);
  area.quick('Show to the table: the token flies to the middle of the TV and turns; a click on the GM screen brings it back', async (t) => {
    const id = add(t, 5, 6);
    await t.until(() => t.rect(`.sv-token[data-id="${id}"]`), 3000, 'the token on the GM screen');
    t.gm().webContents.focus();
    await t.key('V');
    await t.rightClickSel(`.sv-token[data-id="${id}"]`);
    await t.until(() => t.g(`!!document.querySelector('#radial.on')`), 3000, 'the token\'s menu');
    await t.clickText('#radial.on .radial-item', 'Show to the table');
    await t.until(() => t.state.show && t.state.show.ids.includes(id), 3000, 'the show to start');
    await t.until(async () => (await onTv(t)) === 1, 3000, 'the picture on the TV');
    t.ok(await aside(t, id), 'the token itself steps aside on the TV');
    await t.sleep(1300); // landed
    const c = await t.t(`(() => { const r = document.querySelector('#table-show .show-pic').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, W: innerWidth, H: innerHeight }; })()`);
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
    await t.sleep(1500);
    const R = await t.t(`[...document.querySelectorAll('#table-show .show-item')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })`);
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

  area.deep('renaming one token through its card gives it a name of its own, without a number', async (t) => {
    await ownMap(t);
    const a = put(t, 12, 4, { tag: 'all' }); put(t, 14, 4, { tag: 'all' });
    await t.until(() => t.rect(`.sv-token[data-id="${a}"]`), 3000, 'the token');
    t.gm().webContents.focus();
    await t.key('V');
    await t.clickSel(`.sv-token[data-id="${a}"]`);
    await t.until(() => t.rect('#token-card.on .card-name'), 3000, 'the token card');
    await t.g(`document.querySelector('#token-card .card-name').click()`);
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
};
