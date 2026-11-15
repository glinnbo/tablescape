// Phones: the DM's remote and the players' phones, asked over the network the way a real phone does
'use strict';

module.exports = (area) => {
  area.title('Phones');
  let ph = null; let A = null; let B = null; let D = null; let sa = null; let sb = null;
  let mapId = null; let tMira = null; let s = 1; let cx = 0; let cy = 0; let HO = null;
  area.before(async (K) => {
    await K.openDemo();
    mapId = await K.newMap('Phones (test)', { tv: true });
    const M = K.store.map(mapId);
    // (in the middle of a square, wherever this map's grid starts)
    s = M.grid.size || 1; cx = (M.grid.ox || 0) + 10.5 * s; cy = (M.grid.oy || 0) + 10.5 * s;
    K.handle('fog.enabled', { mapId, enabled: false });
    K.handle('party.set', { names: ['Mira', 'Thorin'] });
    K.handle('char.set', { name: 'Mira', patch: { token: K.pic('tokens', /Hero/i), dark: 60, color: '#6cc3ff' } });
    K.handle('char.set', { name: 'Thorin', patch: { token: K.pic('tokens', /Goblin/i), dark: 0, color: '#ffb35c' } });
    tMira = K.handle('layer.add', { mapId, path: K.pic('tokens', /Hero/i), role: 'token', x: cx, y: cy, size: 1 }).selected;
    K.handle('layer.add', { mapId, path: K.pic('tokens', /Goblin/i), role: 'token', x: cx + 3 * s, y: cy, size: 1 });
    K.handle('wall.add', { mapId, segs: [[cx - 2 * s, cy - 1.5 * s, cx + 2 * s, cy - 1.5 * s]] });
    ph = await K.phonesOn();
    await K.g(`window.ts.players('set', { on: true, pace: 'free', rest: 0, pings: true, eyes: true, trace: true })`);
    A = await ph.pair(K.settings.remote.playerKey, 'st-a', 'Phone A');
    B = await ph.pair(K.settings.remote.playerKey, 'st-b', 'Phone B');
    D = await ph.pair(K.settings.remote.key, 'st-dm', 'DM phone');
    sa = ph.stream(A.token); sb = ph.stream(B.token);
    await K.until(() => sa.last && sb.last, 5000, 'the phones to get their first state');
    HO = K.pic('handouts');
  });

  const mira = (t) => t.store.map(mapId).layers.find((l) => l.id === tMira);
  const at = (t) => [Math.round((mira(t).x - cx) / s), Math.round((mira(t).y - cy) / s)];

  area.quick('the phone app is served from the PC', async (t) => {
    const page = await ph.get('/');
    t.eq(page.status, 200, 'the page');
    t.ok(/html/.test(page.type) && /<script/.test(page.text || ''), 'it is a web page with the app in it', page.type);
    for (const f of ['/app.js', '/app.css', '/icons.js']) { const r = await ph.get(f); t.eq(r.status, 200, f); t.ok(r.bytes > 500, `${f} has content`, r.bytes); }
  });

  area.quick('a phone pairs with the players\' code as a player, with the DM\'s code as the remote; a wrong code is refused', async (t) => {
    t.eq([A.role, B.role, D.role], ['player', 'player', 'dm'], 'what the three phones are');
    t.ok(A.token && A.token !== B.token, 'each phone has its own pass');
    const bad = await ph.pair('000000', 'st-x', 'Stranger');
    t.ok(!bad.token && bad.status >= 400, 'a wrong code gets no pass', bad);
  });

  area.quick('a player\'s phone cannot do what the DM\'s phone does', async (t) => {
    const r = await ph.run(A.token, 'lights', { do: 'toggle' });
    t.ok(r.status === 403 || r.ok === false, 'the player is turned away', r);
    t.ok(!('scene' in sa.last), 'a player\'s phone is not told what the DM sees');
  });

  area.quick('a player picks a character and moves its token one square; a wall stops it', async (t) => {
    const pk = await ph.run(A.token, 'pick', { name: 'Mira' });
    t.ok(pk.ok, 'Mira can be picked', pk);
    const again = await ph.run(B.token, 'pick', { name: 'Mira' });
    t.ok(!again.ok, 'a second phone cannot take the same character', again);
    const p0 = at(t);
    // (a phone may not step faster than a few times a second)
    const step = async (dir) => { await t.sleep(250); const before = at(t); const r = await ph.run(A.token, 'move', { dir }); if (r.ok) await t.until(() => JSON.stringify(at(t)) !== JSON.stringify(before), 3000, `the step ${dir}`); else await t.sleep(250); return r; };
    const e = await step('e');
    t.ok(e.ok, 'the step east is allowed', e);
    t.eq(at(t), [p0[0] + 1, p0[1]], 'where the token stands after a step east');
    const n1 = await step('n');
    t.ok(n1.ok, 'the first step north is allowed', n1);
    t.eq(at(t), [p0[0] + 1, p0[1] - 1], 'where the token stands after a step north');
    const n2 = await step('n');
    t.ok(!n2.ok, 'the wall stops the second step north', n2);
    t.eq(at(t), [p0[0] + 1, p0[1] - 1], 'where the token stands in front of the wall');
  });

  area.quick('a handout marked for everyone reaches every player\'s phone at once, with its picture, without lying on the table', async (t) => {
    t.handle('handout.hide', {});
    t.handle('handout.share', { path: HO, to: 'all' });
    await t.until(() => (sa.last.handouts || []).length === 1 && (sb.last.handouts || []).length === 1, 4000, 'the handout on both phones');
    t.eq(t.state.handouts.length, 0, 'handouts on the table');
    const h = sa.last.handouts[0];
    t.ok(h.name && h.url, 'it has a name and a picture', h);
    const pic = await ph.get(`${h.url}${h.url.includes('?') ? '&' : '?'}t=${encodeURIComponent(A.token)}`);
    t.eq(pic.status, 200, 'the picture loads on the phone');
    t.ok(/image|video/.test(pic.type) && pic.bytes > 1000, 'it is a picture', [pic.type, pic.bytes]);
    const none = await ph.get(h.url);
    t.ok(none.status >= 400, 'without a pass the picture is not given out', none.status);
    t.handle('handout.share', { path: HO, to: null });
    await t.until(() => !(sa.last.handouts || []).length && !(sb.last.handouts || []).length, 4000, 'Take it back to remove it from the phones');
  });

  area.quick('a handout only for one player reaches only that player\'s phone', async (t) => {
    await ph.run(A.token, 'pick', { name: 'Mira' });
    await ph.run(B.token, 'pick', { name: 'Thorin' });
    t.handle('handout.share', { path: HO, to: ['Mira'] });
    await t.until(() => (sa.last.handouts || []).length === 1, 4000, 'the handout on Mira\'s phone');
    await t.sleep(300);
    t.eq((sb.last.handouts || []).length, 0, 'handouts on Thorin\'s phone');
    t.handle('handout.share', { path: HO, to: null });
    await t.until(() => !(sa.last.handouts || []).length, 4000, 'the handout to leave Mira\'s phone');
  });

  // Beta 3.7: a table with miniatures: no tokens on the map, moving by phone off
  area.quick('with moving by phone off and no token on the map, a phone still says who it is and gets the handout only for that player', async (t) => {
    await ph.run(A.token, 'unpick', {}); await ph.run(B.token, 'unpick', {});
    await t.g(`window.ts.players('set', { on: false })`);
    const bare = await t.newMap('Miniatures (test)', { tv: true });
    await t.until(() => sa.last && sa.last.ctl && sa.last.ctl.on === false && !sa.last.ctl.me, 4000, 'the phone to know that moving is off');
    t.ok((sa.last.ctl.chars || []).some((c) => c.name === 'Thorin'), 'it still offers the party to pick from', sa.last.ctl.chars);
    const r = await ph.run(B.token, 'pick', { name: 'Thorin' });
    t.ok(r.ok, 'picking a character is allowed', r);
    await t.until(() => sb.last.ctl && sb.last.ctl.me && sb.last.ctl.me.name === 'Thorin', 4000, 'the phone to be Thorin');
    t.ok(!sb.last.ctl.me.token, 'Thorin has no token on this map', sb.last.ctl.me);
    const no = await ph.run(B.token, 'move', { dir: 'e' });
    t.ok(!no.ok, 'moving stays off', no);
    t.handle('handout.share', { path: HO, to: ['Thorin'] });
    await t.until(() => (sb.last.handouts || []).length === 1, 4000, 'the handout on Thorin\'s phone');
    await t.sleep(300);
    t.eq((sa.last.handouts || []).length, 0, 'handouts on the other phone');
    t.eq(t.state.handouts.length, 0, 'handouts on the table');
    t.handle('handout.share', { path: HO, to: null });
    await ph.run(B.token, 'unpick', {});
    await t.g(`window.ts.players('set', { on: true })`);
    t.handle('edit.open', { id: mapId }); t.handle('table.send', { id: mapId });
    t.handle('map.remove', { id: bare });
    await t.until(() => sa.last && sa.last.ctl && sa.last.ctl.on === true, 4000, 'moving by phone on again');
  });

  area.deep('the real phone app shows a Handouts button; a tap shows the handout big', async (t) => {
    const { BrowserWindow } = require('electron');
    const C = await ph.pair(t.settings.remote.playerKey, 'st-c', 'Phone C');
    const w = new BrowserWindow({ show: false, width: 390, height: 780, webPreferences: { partition: 'phone-test' } });
    const errs = [];
    w.webContents.on('console-message', (e, lvl, msg) => { const level = typeof e.level === 'string' ? e.level : lvl; if (level === 'error' || level === 3) errs.push(e.message || msg); });
    try {
      await w.loadURL(`http://127.0.0.1:${ph.port}/#t=${C.token}`);
      const js = (code) => w.webContents.executeJavaScript(code);
      await t.until(() => js(`!!document.querySelector('.pl-ho')`), 8000, 'the player view on the phone');
      t.eq(await js(`document.querySelector('.pl-ho').hidden`), true, 'no Handouts button while there are none');
      t.handle('handout.share', { path: HO, to: 'all', send: true });
      await t.until(() => js(`!document.querySelector('.pl-ho').hidden`), 5000, 'the Handouts button on the phone');
      await js(`document.querySelector('.pl-ho').click()`);
      await t.until(() => js(`!!document.querySelector('.ho-view img, .ho-view video')`), 4000, 'the handout big on the phone');
      await t.until(() => js(`(() => { const i = document.querySelector('.ho-view img'); return !i || (i.complete && i.naturalWidth > 0); })()`), 5000, 'its picture to load');
      // Beta 3.7: handled like a photo in a gallery
      const box = () => js(`(() => { const r = document.querySelector('.ho-view img').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, z: document.querySelector('.ho-view').debug().z, W: innerWidth, H: innerHeight }; })()`);
      const fit = await box();
      t.ok(fit.z === 1 && fit.w <= fit.W + 1 && fit.h <= fit.H + 1, 'at first the whole of it fits the screen', fit);
      const touch = (type, id, x, y) => js(`document.querySelector('.ho-stage').dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { pointerId: ${id}, clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch', isPrimary: ${id === 1} }))`);
      const cx = fit.W / 2; const cy = fit.H / 2;
      // two fingers moving apart: bigger, around the spot between them
      await touch('pointerdown', 1, cx - 40, cy); await touch('pointerdown', 2, cx + 40, cy);
      for (let i = 1; i <= 5; i++) { await touch('pointermove', 1, cx - 40 - i * 16, cy); await touch('pointermove', 2, cx + 40 + i * 16, cy); }
      await touch('pointerup', 1, cx - 120, cy); await touch('pointerup', 2, cx + 120, cy);
      const big = await box();
      t.near(big.z, 3, 0.2, 'three times as far apart: three times as big');
      t.near(big.x + big.w / 2, cx, 3, 'the spot between the fingers stayed there');
      // one finger drags it; it never leaves the screen
      await touch('pointerdown', 1, cx, cy);
      for (let i = 1; i <= 6; i++) await touch('pointermove', 1, cx + i * 300, cy);
      await touch('pointerup', 1, cx + 1800, cy);
      await t.sleep(400);
      const moved = await box();
      t.ok(moved.x > big.x + 20, 'a finger moves it', [big.x, moved.x]);
      t.ok(moved.x <= 1, 'but its edge stops at the edge of the screen', moved);
      // a double tap: back to the whole of it
      for (let i = 0; i < 2; i++) { await touch('pointerdown', 1, cx, cy); await touch('pointerup', 1, cx, cy); await t.sleep(60); }
      await t.until(async () => (await box()).z === 1, 2000, 'a double tap to show the whole of it again');
      t.eq(errs, [], 'errors in the phone app');
    } finally {
      t.handle('handout.share', { path: HO, to: null });
      w.destroy();
    }
  });

  area.deep('the DM\'s phone gets the remote\'s list and can black the TV out', async (t) => {
    const sd = ph.stream(D.token);
    await t.until(() => sd.last, 4000, 'the remote\'s state');
    t.eq(sd.last.role, 'dm', 'the role');
    t.ok(!('ctl' in sd.last), 'the remote has no player controls');
    const q0 = !!t.state.quiet;
    const q = await ph.run(D.token, 'sound', { do: 'quiet' });
    t.ok(q.ok && !!t.state.quiet === !q0, 'Mute from the phone', [q, t.state.quiet]);
    await ph.run(D.token, 'sound', { do: 'quiet' });
    t.eq(!!t.state.quiet, q0, 'and back');
    const b0 = !!t.state.blackout;
    const r = await ph.run(D.token, 'run', { item: { kind: 'do', ref: 'blackout', label: 'Blackout', icon: 'screen-share-off' } });
    await t.sleep(300);
    t.ok(r.ok !== false && !!t.state.blackout === !b0, 'Blackout from the phone', [r, t.state.blackout]);
    await ph.run(D.token, 'run', { item: { kind: 'do', ref: 'blackout', label: 'Blackout', icon: 'screen-share-off' } });
    await t.sleep(300);
    t.eq(!!t.state.blackout, b0, 'and back');
    sd.close();
  });
};
