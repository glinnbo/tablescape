// Handouts: letters, maps and pictures shown big on the table
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (area) => {
  area.title('Handouts');
  let A = null; let B = null;
  area.before(async (K) => {
    await K.openDemo(); await K.send();
    A = K.pic('handouts');
    // a second handout to show beside the first
    B = path.join(path.dirname(A), `Old map${path.extname(A)}`);
    if (!fs.existsSync(B)) fs.copyFileSync(A, B);
    await K.sleep(300);
  });

  // what lies on the TV: each handout's box (as drawn, turned), its picture's own size, its turn, and whether it still burns
  const onTv = (t) => t.t(`[...document.querySelectorAll('.tv-handout .ho-item')].map((it) => { const f = it.querySelector('.ho-one'); const i = it.querySelector('img'); const r = f.getBoundingClientRect(); const m = new DOMMatrix(getComputedStyle(f).transform); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(i.offsetWidth), h: Math.round(i.offsetHeight), rot: Math.round(((Math.atan2(m.b, m.a) * 180 / Math.PI) + 360) % 360), burning: !!it.querySelector('.ho-burn'), seen: getComputedStyle(i).visibility !== 'hidden', z: Number(it.style.zIndex) }; })`);
  const settled = async (t, n) => t.until(async () => { const x = await onTv(t); return x.length === n && x.every((i) => i.w > 20 && !i.burning && i.seen) && x; }, 6000, `${n} handout${n === 1 ? '' : 's'} lying on the TV`);
  const away = async (t) => { t.handle('handout.hide', {}); await t.until(async () => (await onTv(t)).length === 0, 4000, 'the table to be empty'); };
  const forget = (t) => { delete t.settings.handoutLayout; };
  const lay = (t, p) => { const all = t.settings.handoutLayout || {}; const k = Object.keys(all).find((x) => p.endsWith(x) || x.endsWith(path.basename(p))); return k ? all[k] : null; };
  const win = (t) => t.t('({ w: innerWidth, h: innerHeight })');

  area.quick('a handout burns in on the TV, one copy near the middle and a little tilted, and burns away again', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 4000, 'the handout to burn in');
    const dbg = await t.t('window.__table.debug().over.handout');
    t.ok(dbg && dbg.burning === 1 && dbg.style === (t.settings.tableStyle || 'ink'), 'it burns in the table style\'s colour', dbg);
    const tv = await settled(t, 1);
    const w = await win(t);
    t.eq(t.state.handouts.length, 1, 'handouts on the table');
    t.near(tv[0].x, w.w / 2, w.w * 0.08, 'near the middle (from the left)');
    t.near(tv[0].y, w.h / 2, w.h * 0.09, 'near the middle (from the top)');
    const l = lay(t, A);
    t.ok(l && l.v === 2 && l.size === 0.7 && (l.rot <= 7 || l.rot >= 353), 'its place is remembered: tossed, a little tilted', l);
    t.near(Math.max(tv[0].w, tv[0].h), 0.7 * Math.min(w.w, w.h), 3, 'its longer side: 70% of the TV\'s short side');
    t.handle('handout.hide', {});
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 3000, 'the handout to burn away');
    t.eq(t.state.handouts.length, 0, 'handouts on the table afterwards');
    await t.until(async () => (await onTv(t)).length === 0, 4000, 'the handout to leave the TV');
  });

  area.quick('a second handout can lie with the first; each goes away on its own', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    await settled(t, 2);
    t.eq(t.state.handouts.map((x) => x.name), [path.parse(A).name, 'Old map'], 'the handouts on the table');
    t.handle('handout.hide', { path: A });
    await t.until(async () => (await onTv(t)).length === 1, 4000, 'one handout to stay');
    t.eq(t.state.handouts.map((x) => x.name), ['Old map'], 'the handout left on the table');
    await away(t);
  });

  area.quick('showing a handout alone replaces what lies there', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B });
    await t.sleep(300);
    t.eq(t.state.handouts.map((x) => x.name), ['Old map'], 'the handouts on the table');
    await away(t);
  });

  area.quick('placed, sized and turned to any angle, a handout lies so on the TV; the layout is remembered', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: B });
    t.handle('handout.layout', { path: B, patch: { x: 0.25, y: 0.6, rot: 37, size: 0.4 } });
    const w = await win(t);
    const one = (await settled(t, 1))[0];
    t.near(one.x, w.w * 0.25, w.w * 0.02, 'its centre from the left');
    t.near(one.y, w.h * 0.6, w.h * 0.02, 'its centre from the top');
    t.eq(one.rot, 37, 'its turn');
    t.near(Math.max(one.w, one.h), 0.4 * Math.min(w.w, w.h), 3, 'its size');
    await away(t);
    t.handle('handout.show', { path: B });
    const again = (await settled(t, 1))[0];
    t.near(again.x, w.w * 0.25, w.w * 0.02, 'its place when shown again');
    t.eq(again.rot, 37, 'its turn when shown again');
    await away(t);
  });

  area.quick('ten handouts lie on the table at once, the eleventh is refused; the one touched lies on top', async (t) => {
    forget(t); await away(t);
    const dir = path.dirname(A); const more = [];
    for (let i = 1; i <= 11; i++) { const f = path.join(dir, `Page ${i}${path.extname(A)}`); if (!fs.existsSync(f)) fs.copyFileSync(A, f); more.push(f); }
    for (const f of more.slice(0, 10)) t.ok(t.handle('handout.show', { path: f, add: true }).ok, `${path.parse(f).name} shown`);
    t.eq(t.state.handouts.length, 10, 'handouts on the table');
    const no = t.handle('handout.show', { path: more[10], add: true });
    t.ok(!no.ok && /10 handouts/.test(no.error || ''), 'the eleventh is refused, with a reason', no);
    await settled(t, 10);
    t.handle('handout.front', { path: more[2] });
    t.eq(t.state.handouts[9].path, more[2], 'the one touched is the last in the list');
    await t.until(async () => { const x = await onTv(t); return x.length === 10 && Math.max(...x.map((i) => i.z)) === 10; }, 3000, 'the order on the TV');
    await away(t);
    for (const f of more) try { fs.unlinkSync(f); } catch {}
  });

  // ---------- the Handout table (the big picture of the TV on the GM screen) ----------
  const HT = '.fp[data-id="hotable"]';
  const table = async (t) => {
    await t.g(`Play.TB.openPanel('handouts')`);
    await t.until(async () => (await t.panels()).some((p) => p.id === 'handouts'), 3000, 'the Handouts panel');
    if (!(await t.panels()).some((p) => p.id === 'hotable')) await t.clickText('.fp[data-id="handouts"] .btn', 'Handout table');
    await t.until(() => t.rect(`${HT} .hot-stage`), 3000, 'the Handout table');
  };
  const closeTable = (t) => t.g(`(() => { const b = document.querySelector('${HT} .fp-close'); if (b) b.click(); })()`);

  area.quick('the Handout table shows what lies on the TV; dragging a handout there moves it on the TV while you drag', async (t) => {
    forget(t); await away(t); await table(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { x: 0.3, y: 0.3, rot: 0, size: 0.3 } });
    await settled(t, 1);
    await t.until(() => t.rect(`${HT} .hot-item`), 4000, 'the handout in the picture of the TV');
    await t.sleep(200);
    const st = await t.rect(`${HT} .hot-stage`);
    t.ok(st.w >= 600, 'the picture of the TV is big', st);
    const it = await t.rect(`${HT} .hot-item`);
    t.near(it.cx, st.x + st.w * 0.3, st.w * 0.02, 'it lies there as on the TV');
    // press, move, and look at the TV before letting go
    const from = { x: it.cx, y: it.cy }; const to = { x: st.x + st.w * 0.7, y: st.y + st.h * 0.65 };
    await t.mouse('mouseMove', from.x, from.y, 'left');
    await t.mouse('mouseDown', from.x, from.y, 'left');
    for (let i = 1; i <= 6; i++) { await t.mouse('mouseMove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, 'left', { modifiers: ['leftButtonDown'] }); await t.sleep(40); }
    const w = await win(t);
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && Math.abs(x[0].x - w.w * 0.7) < w.w * 0.03; }, 3000, 'the TV to follow while the button is still down');
    t.ok(Math.abs(lay(t, A).x - 0.7) < 0.03, 'main knows the place already', lay(t, A));
    await t.mouse('mouseUp', to.x, to.y, 'left');
    await t.until(() => { const l = lay(t, A); return l && Math.abs(l.x - 0.7) < 0.03 && Math.abs(l.y - 0.65) < 0.04; }, 3000, 'the layout to be saved on letting go');
    await away(t); await closeTable(t);
  });

  area.quick('in the Handout table a corner sizes a handout and the knob turns it, catching when a quarter round', async (t) => {
    forget(t); await away(t); await table(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { x: 0.5, y: 0.5, rot: 0, size: 0.3 } });
    await settled(t, 1);
    await t.until(() => t.rect(`${HT} .hot-item`), 4000, 'the handout in the picture of the TV');
    await t.clickSel(`${HT} .hot-item img`);
    await t.until(() => t.rect(`${HT} .hot-item.sel .hot-h.se`), 3000, 'its corners once it is picked');
    const it = await t.rect(`${HT} .hot-item`);
    const se = await t.rect(`${HT} .hot-item.sel .hot-h.se`);
    // twice as far from its middle: twice as big
    await t.drag({ x: se.cx, y: se.cy }, { x: it.cx + (se.cx - it.cx) * 2, y: it.cy + (se.cy - it.cy) * 2 }, 6);
    await t.until(() => { const l = lay(t, A); return l && Math.abs(l.size - 0.6) < 0.05; }, 3000, 'twice the size', lay(t, A));
    await t.sleep(200);
    const now = await t.rect(`${HT} .hot-item`);
    const knob = await t.rect(`${HT} .hot-item.sel .hot-turn`);
    // the knob is above it: pulled round to its right side (and a little off) it catches at a quarter turn
    const r = now.cy - knob.cy;
    await t.drag({ x: knob.cx, y: knob.cy }, { x: now.cx + r, y: now.cy + r * 0.06 }, 8);
    await t.until(() => { const l = lay(t, A); return l && l.rot === 90; }, 3000, 'a quarter turn, caught', lay(t, A));
    const tv = (await settled(t, 1))[0];
    t.eq(tv.rot, 90, 'turned on the TV too');
    await t.clickSel(`${HT} .hot-item.sel .hot-x`);
    await t.until(() => t.state.handouts.length === 0, 3000, 'the ✕ to put it away');
    await away(t); await closeTable(t);
  });

  area.quick('a spread keeps what lies on the table, each in its place, and brings it back with one click', async (t) => {
    forget(t); await away(t); await table(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    t.handle('handout.layout', { path: A, patch: { x: 0.2, y: 0.3, rot: 15, size: 0.35 } });
    t.handle('handout.layout', { path: B, patch: { x: 0.75, y: 0.6, rot: 200, size: 0.5 } });
    const saved = t.handle('handout.spread.save', { name: 'The evidence' });
    t.ok(saved.ok, 'saved', saved);
    t.eq((t.store.cur.meta.handoutSpreads || []).map((x) => [x.name, x.items.length]), [['The evidence', 2]], 'the campaign\'s spreads');
    await away(t);
    // moved meanwhile: the spread puts them back
    t.handle('handout.layout', { path: A, patch: { x: 0.9, y: 0.9, rot: 0, size: 1 } });
    await t.clickText(`${HT} .btn`, 'Spreads');
    const menu = await t.until(() => t.menu(), 3000, 'the Spreads menu');
    t.ok(menu.some((x) => /^The evidence \(2\)/.test(x)) && menu.some((x) => /^Save what lies here/.test(x)), 'the spread and Save are offered', menu);
    await t.menuPick('The evidence (2)');
    const tv = await settled(t, 2);
    const w = await win(t);
    t.eq(t.state.handouts.map((x) => x.name), [path.parse(A).name, 'Old map'], 'both are back on the table');
    t.near(tv[0].x, w.w * 0.2, w.w * 0.02, 'the first lies where it lay');
    t.eq([tv[0].rot, tv[1].rot], [15, 200], 'turned as they were');
    t.ok(t.handle('handout.spread.remove', { id: saved.id }).ok, 'removed');
    t.eq((t.store.cur.meta.handoutSpreads || []).length, 0, 'spreads left');
    await away(t); await closeTable(t);
  });

  area.quick('the Handouts panel says what lies on the table; Put everything away clears it', async (t) => {
    forget(t); await away(t);
    await t.g(`Play.TB.openPanel('handouts')`);
    await t.until(async () => (await t.panels()).some((p) => p.id === 'handouts'), 3000, 'the Handouts panel');
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    await t.until(() => t.g(`/^2 on the table/.test((document.querySelector('.fp[data-id="handouts"] .ho-none') || {}).textContent || '')`), 4000, 'the panel to count them');
    await t.clickText('.fp[data-id="handouts"] .btn', 'Put everything away');
    await t.until(() => t.state.handouts.length === 0, 3000, 'the table to be cleared');
    await away(t);
  });

  area.quick('a handout shown is noted under Shown so far and in the session log', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    await t.sleep(300);
    t.ok((t.state.handoutSeen || []).some((x) => x.path === A), 'it is among the handouts shown so far');
    const log = (t.store.cur.meta.notes || {}).text || '';
    t.ok(log.includes(`Handout shown: ${path.parse(A).name}`), 'the session log has a line for it', log.slice(-160));
    await away(t);
  });

  area.quick('marked for everyone, a handout is ready for the phones once it has been shown', async (t) => {
    forget(t); await away(t);
    t.handle('handout.share', { path: A, to: 'all' });
    const share = () => Object.values(t.store.cur.meta.handoutShare || {})[0];
    t.eq(share() && share().to, 'all', 'who may see it');
    t.ok(!share().sent, 'not sent before it is shown');
    t.handle('handout.show', { path: A });
    await t.sleep(300);
    t.ok(!!share().sent, 'sent once it is shown', share());
    t.handle('handout.share', { path: A, to: null });
    t.ok(!Object.keys(t.store.cur.meta.handoutShare || {}).length, 'taken back', t.store.cur.meta.handoutShare);
    await away(t);
  });

  // ---------- deep ----------
  const P = '.fp[data-id="handouts"]';
  const panel = async (t) => { await t.g(`Play.TB.openPanel('handouts')`); await t.until(async () => (await t.panels()).some((p) => p.id === 'handouts'), 3000, 'the Handouts panel'); };

  area.deep('in the Handout table the turn buttons turn in quarter steps, the wheel sizes and Shift + wheel turns', async (t) => {
    forget(t); await away(t); await table(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { x: 0.5, y: 0.5, rot: 20, size: 0.3 } });
    await settled(t, 1);
    await t.until(() => t.rect(`${HT} [data-tip="Turn it a quarter to the right"]`), 4000, 'the turn buttons');
    await t.clickSel(`${HT} [data-tip="Turn it a quarter to the right"]`);
    await t.until(() => lay(t, A).rot === 90, 3000, 'to the next quarter on the right', lay(t, A));
    await t.clickSel(`${HT} [data-tip="Turn it a quarter to the right"]`);
    await t.until(() => lay(t, A).rot === 180, 3000, 'another quarter');
    await t.clickSel(`${HT} [data-tip="Turn it a quarter to the left"]`);
    await t.until(() => lay(t, A).rot === 90, 3000, 'a quarter back');
    const it = await t.rect(`${HT} .hot-item`);
    const gm = t.gm().webContents;
    gm.sendInputEvent({ type: 'mouseMove', x: Math.round(it.cx), y: Math.round(it.cy) });
    for (let i = 0; i < 5; i++) { gm.sendInputEvent({ type: 'mouseWheel', x: Math.round(it.cx), y: Math.round(it.cy), deltaX: 0, deltaY: 100 }); await t.sleep(30); }
    await t.until(() => lay(t, A).size > 0.38, 3000, 'the wheel to make it bigger', lay(t, A));
    for (let i = 0; i < 2; i++) { gm.sendInputEvent({ type: 'mouseWheel', x: Math.round(it.cx), y: Math.round(it.cy), deltaX: 0, deltaY: 100, modifiers: ['shift'] }); await t.sleep(30); }
    await t.until(() => lay(t, A).rot !== 90, 3000, 'Shift + wheel to turn it', lay(t, A));
    await away(t); await closeTable(t);
  });

  area.deep('while the Handout table is open a click on a handout adds it; a handout shown for the first time keeps the place it was tossed to', async (t) => {
    forget(t); await away(t); await table(t);
    t.state.handoutSeen = []; // (the pages of the check before: the panel stays short, the Ready list in view)
    const ch = t.store.cur.meta.chapters.find((c) => (c.maps || []).some((m) => (m.id || m) === t.state.editMapId)) || t.store.cur.meta.chapters[0];
    t.ok(t.handle('ready.set', { chapterId: ch.id, kind: 'handouts', items: [{ path: A, name: path.parse(A).name }, { path: B, name: 'Old map' }] }).ok, 'both put on the Ready list');
    await t.until(() => t.findText(`${P} .talk-pick .talk-name`, 'Old map'), 4000, 'both handouts ready in the panel');
    await t.clickText(`${P} .talk-pick .talk-name`, path.parse(A).name);
    await t.until(() => t.state.handouts.length === 1, 3000, 'the first on the table');
    await t.clickText(`${P} .talk-pick .talk-name`, 'Old map');
    await t.until(() => t.state.handouts.length === 2, 3000, 'the second with it (not instead of it)');
    const first = { ...lay(t, B) };
    t.ok(first.v === 2, 'the second got a place of its own', { keys: Object.keys(t.settings.handoutLayout || {}), on: t.state.handouts.map((x) => x.path), B });
    await away(t);
    t.handle('handout.show', { path: B });
    t.eq(lay(t, B), first, 'shown again it lies as before');
    await away(t); await closeTable(t);
  });

  area.deep('a handout burns in the colour of the table style: green for Jungle', async (t) => {
    forget(t); await away(t);
    const was = t.settings.tableStyle;
    await t.g(`window.ts.settings({ tableStyle: 'jungle' })`);
    await t.until(() => t.settings.tableStyle === 'jungle', 3000, 'the Jungle style');
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { x: 0.5, y: 0.5, rot: 0, size: 0.8 } });
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].burning; }, 4000, 'the handout to burn in');
    // the fire's own light, in the middle of the burn: more green than red or blue
    await t.sleep(350);
    const px = await t.t(`(() => { const c = document.querySelector('.tv-handout .ho-burn'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 16) { if (d[i + 3] > 200 && d[i + 1] > 150 && d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } } return { n, r: n ? r / n : 0, g: n ? g / n : 0, b: n ? b / n : 0 }; })()`);
    t.ok(px && px.n > 20, 'green fire on the handout', px);
    await settled(t, 1);
    await t.g(`window.ts.settings({ tableStyle: ${JSON.stringify(was || 'ink')} })`);
    await away(t);
  });

  area.deep('the phone button offers Everyone, single players and Take it back; List … opens beside the panel', async (t) => {
    forget(t); await away(t); await table(t);
    t.handle('party.set', { names: ['Mira', 'Thorin'] });
    t.handle('handout.show', { path: A });
    await t.until(() => t.rect(`${HT} .hot-bar [aria-label="On the phones"]`), 4000, 'the phone button under the picture of the TV');
    await t.clickSel(`${HT} .hot-bar [aria-label="On the phones"]`);
    const menu = await t.until(() => t.menu(), 3000, 'the phone menu');
    t.ok(menu.some((x) => /^Everyone/.test(x)), 'Everyone', menu);
    t.ok(menu.some((x) => /Mira/.test(x)) && menu.some((x) => /Thorin/.test(x)), 'each player by name', menu);
    await t.menuPick('Everyone');
    await t.until(() => Object.values(t.store.cur.meta.handoutShare || {}).some((x) => x.to === 'all'), 3000, 'the handout marked for everyone');
    await t.clickSel(`${HT} .hot-bar [aria-label="On the phones"]`);
    const menu2 = await t.until(() => t.menu(), 3000, 'the phone menu again');
    t.ok(menu2.some((x) => /Take it back/.test(x)), 'Take it back is offered once it is marked', menu2);
    await t.menuPick('Take it back');
    await t.until(() => !Object.keys(t.store.cur.meta.handoutShare || {}).length, 3000, 'the mark to go');
    await t.clickText(`${P} .btn`, 'List');
    const list = await t.until(async () => (await t.panels()).find((p) => p.id === 'handlist'), 3000, 'the list of all handouts');
    t.eq(list.title, 'All handouts', 'its title');
    const a = await t.rect(P); const b = await t.rect('.fp[data-id="handlist"]');
    t.ok(b.x >= a.x + a.w - 2 || b.x + b.w <= a.x + 2 || b.y >= a.y + a.h - 2 || b.y + b.h <= a.y + 2, 'the list lies beside the panel, not on it', [a, b]);
    await away(t);
  });

  area.deep('with the session log switched off, showing a handout writes no line', async (t) => {
    forget(t); await away(t);
    await t.g(`window.ts.settings({ handout: { log: false } })`);
    await t.until(() => t.settings.handout && t.settings.handout.log === false, 3000, 'the setting');
    const before = ((t.store.cur.meta.notes || {}).text || '').length;
    t.handle('handout.show', { path: B });
    await t.sleep(300);
    t.eq(((t.store.cur.meta.notes || {}).text || '').length, before, 'the length of the session log');
    await t.g(`window.ts.settings({ handout: { log: true } })`);
    await away(t);
  });
};
