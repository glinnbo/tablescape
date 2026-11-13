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

  const onTv = (t) => t.t(`[...document.querySelectorAll('.tv-handout .ho-item')].map((it) => ({ cls: it.className, imgs: [...it.querySelectorAll('img')].map((i) => { const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }) }))`);
  const away = async (t) => { t.handle('handout.hide', {}); await t.sleep(250); };
  const forget = (t) => { delete t.settings.handoutLayout; };

  area.quick('a handout shows on the TV with a copy for each long side, and goes away again', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    const tv = await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].imgs.length === 2 && x[0].imgs[0].w > 50 && x; }, 5000, 'the handout on the TV');
    t.eq(t.state.handouts.length, 1, 'handouts on the table');
    const [a, b] = tv[0].imgs;
    t.ok(Math.abs(a.w - b.w) < 3 && Math.abs(a.h - b.h) < 3, 'both copies have the same size', tv[0].imgs);
    await away(t);
    await t.until(async () => (await onTv(t)).length === 0, 3000, 'the handout to leave the TV');
    t.eq(t.state.handouts.length, 0, 'handouts on the table afterwards');
  });

  area.quick('a second handout can lie beside the first; each goes away on its own', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    await t.until(async () => (await onTv(t)).length === 2, 5000, 'two handouts on the TV');
    t.eq(t.state.handouts.map((x) => x.name), [path.parse(A).name, 'Old map'], 'the handouts on the table');
    t.handle('handout.hide', { path: A });
    await t.until(async () => (await onTv(t)).length === 1, 3000, 'one handout to stay');
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

  area.quick('one copy, placed and turned, lies where it was put; the layout is remembered', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: B });
    t.handle('handout.layout', { path: B, patch: { both: false, x: 0.25, y: 0.5, rot: 90, size: 0.8 } });
    const win = await t.t('({ w: innerWidth, h: innerHeight })');
    const one = async () => { const x = await onTv(t); return x.length === 1 && x[0].imgs.length === 1 && /\bone\b/.test(x[0].cls) && x[0].imgs[0]; };
    const img = await t.until(one, 5000, 'one copy on the TV');
    t.near(img.x, win.w * 0.25, win.w * 0.03, 'its centre from the left');
    t.near(img.y, win.h * 0.5, win.h * 0.03, 'its centre from the top');
    await away(t);
    t.handle('handout.show', { path: B });
    const again = await t.until(one, 5000, 'the handout shown again as one copy');
    t.near(again.x, win.w * 0.25, win.w * 0.03, 'its place when shown again');
    await away(t);
  });

  area.quick('the Handouts panel shows a picture of the TV with what lies on it; Put everything away clears it', async (t) => {
    forget(t); await away(t);
    await t.g(`Play.TB.openPanel('handouts')`);
    await t.until(async () => (await t.panels()).some((p) => p.id === 'handouts'), 3000, 'the Handouts panel');
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    await t.until(async () => (await t.count('.fp[data-id="handouts"] .ho-stage .ho-thumb')) >= 2, 4000, 'both handouts in the picture of the TV');
    await t.clickText('.fp[data-id="handouts"] .btn', 'Put everything away');
    await t.until(() => t.state.handouts.length === 0, 3000, 'the table to be cleared');
  });

  area.quick('dragging a handout in the picture of the TV moves it on the TV', async (t) => {
    forget(t); await away(t);
    await t.g(`Play.TB.openPanel('handouts')`);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { both: false, x: 0.3, y: 0.3, rot: 0, size: 0.4 } });
    await t.until(() => t.rect('.fp[data-id="handouts"] .ho-stage .ho-thumb'), 4000, 'the handout in the picture of the TV');
    await t.sleep(300);
    const th = await t.rect('.fp[data-id="handouts"] .ho-stage .ho-thumb');
    const st = await t.rect('.fp[data-id="handouts"] .ho-stage');
    await t.drag({ x: th.cx, y: th.cy }, { x: st.x + st.w * 0.7, y: st.y + st.h * 0.65 }, 6);
    const lay = Object.values(t.settings.handoutLayout || {})[0];
    t.ok(lay, 'the layout was saved');
    t.near(lay.x, 0.7, 0.06, 'its place from the left after dragging');
    t.near(lay.y, 0.65, 0.08, 'its place from the top after dragging');
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
  const lay = (t, p) => { const all = t.settings.handoutLayout || {}; const k = Object.keys(all).find((x) => p.endsWith(x) || x.endsWith(path.basename(p))); return k ? all[k] : null; };
  const panel = async (t) => { await t.g(`Play.TB.openPanel('handouts')`); await t.until(async () => (await t.panels()).some((p) => p.id === 'handouts'), 3000, 'the Handouts panel'); };

  area.deep('the quick layouts: Both sides, One direction and Lengthwise set the handout as they say, and the TV follows', async (t) => {
    forget(t); await away(t); await panel(t);
    t.handle('handout.show', { path: A });
    await t.until(() => t.findText(`${P} .chip`, 'One direction'), 4000, 'the quick layouts in the panel');
    await t.clickText(`${P} .chip`, 'One direction');
    await t.until(() => { const l = lay(t, A); return l && l.both === false && (l.rot || 0) === 0; }, 3000, 'One direction: one upright copy');
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].imgs.length === 1; }, 4000, 'one copy on the TV');
    const up = (await onTv(t))[0].imgs[0];
    await t.clickText(`${P} .chip`, 'Lengthwise');
    await t.until(() => { const l = lay(t, A); return l && l.both === false && Math.abs(l.rot) === 90; }, 3000, 'Lengthwise: turned a quarter');
    await t.sleep(500);
    const side = (await onTv(t))[0].imgs[0];
    t.ok((up.w > up.h) !== (side.w > side.h) || Math.abs(up.w - up.h) < 4, 'on the TV it lies the other way round', [up, side]);
    await t.clickText(`${P} .chip`, 'Both sides');
    await t.until(() => { const l = lay(t, A); return l && l.both === true; }, 3000, 'Both sides: a copy for each long side');
    await t.until(async () => { const x = await onTv(t); return x.length === 1 && x[0].imgs.length === 2; }, 4000, 'two copies on the TV');
    await away(t);
  });

  area.deep('the turn buttons turn a single copy in quarter steps; the size slider makes it bigger on the TV', async (t) => {
    forget(t); await away(t); await panel(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.layout', { path: A, patch: { both: false, x: 0.5, y: 0.5, rot: 0, size: 0.3 } });
    await t.until(() => t.rect(`${P} [data-tip="Turn it a quarter to the right"]`), 4000, 'the turn buttons');
    await t.clickSel(`${P} [data-tip="Turn it a quarter to the right"]`);
    await t.until(() => lay(t, A).rot === 90, 3000, 'a quarter to the right');
    await t.clickSel(`${P} [data-tip="Turn it a quarter to the right"]`);
    await t.until(() => lay(t, A).rot === 180, 3000, 'another quarter');
    await t.clickSel(`${P} [data-tip="Turn it a quarter to the left"]`);
    await t.until(() => lay(t, A).rot === 90, 3000, 'a quarter back');
    await t.cmd('handout.layout', { path: A, patch: { rot: 0, size: 0.3 } });
    await t.sleep(400);
    const small = (await onTv(t))[0].imgs[0];
    await t.cmd('handout.layout', { path: A, patch: { size: 0.9 } });
    await t.until(async () => { const b = (await onTv(t))[0].imgs[0]; return b.w > small.w * 1.5; }, 4000, 'the bigger handout on the TV');
    await away(t);
  });

  area.deep('two handouts shown without a place of their own do not lie on top of each other', async (t) => {
    forget(t); await away(t);
    t.handle('handout.show', { path: A });
    t.handle('handout.show', { path: B, add: true });
    const tv = await t.until(async () => { const x = await onTv(t); return x.length === 2 && x.every((i) => i.imgs.length && i.imgs[0].w > 30) && x; }, 5000, 'both handouts on the TV');
    const a = tv[0].imgs[0]; const b = tv[1].imgs[0];
    const apartX = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 4; const apartY = Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - 4;
    t.ok(apartX || apartY, 'the two do not overlap', [a, b]);
    await away(t);
  });

  area.deep('the phone button offers Everyone, single players and Take it back; List … opens beside the panel', async (t) => {
    forget(t); await away(t); await panel(t);
    t.handle('party.set', { names: ['Mira', 'Thorin'] });
    t.handle('handout.show', { path: A });
    await t.until(() => t.rect(`${P} .ho-ctl [aria-label="On the phones"], ${P} [aria-label="On the phones"]`), 4000, 'the phone button');
    await t.clickSel(`${P} [aria-label="On the phones"]`);
    const menu = await t.until(() => t.menu(), 3000, 'the phone menu');
    t.ok(menu.some((x) => /^Everyone/.test(x)), 'Everyone', menu);
    t.ok(menu.some((x) => /Mira/.test(x)) && menu.some((x) => /Thorin/.test(x)), 'each player by name', menu);
    await t.menuPick('Everyone');
    await t.until(() => Object.values(t.store.cur.meta.handoutShare || {}).some((x) => x.to === 'all'), 3000, 'the handout marked for everyone');
    await t.clickSel(`${P} [aria-label="On the phones"]`);
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
