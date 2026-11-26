// Phones: the DM's remote and the players' phones, asked over the network the way a real phone does
'use strict';
const path = require('path');

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
    // L4 (open point): what the DM's phone is told and a player's is not (the check before looked at a key no state has)
    const sd = ph.stream(D.token);
    try {
      await t.until(() => sd.last, 4000, 'the DM phone\'s state');
      const dmOnly = Object.keys(sd.last).filter((k) => !['role', 'campaign', 'party', 'fight', 'handouts', 'ctl', 'msg'].includes(k));
      t.ok(dmOnly.length >= 3, 'the DM phone has its own things', dmOnly);
      t.eq(dmOnly.filter((k) => k in sa.last), [], 'of them on a player\'s phone');
      t.eq(sa.last.role, 'player', 'the player phone\'s role');
    } finally { sd.close(); }
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
    t.ok(!!h.url, 'it has a picture', h);
    // Beta 3.8: the file's name is the DM's own label, often a spoiler: nothing of it reaches the phone
    const stem = path.parse(HO).name;
    t.eq(Object.keys(h), ['url'], 'only the picture\'s address is sent');
    t.ok(!JSON.stringify(sa.last).includes(stem) && !h.url.includes(encodeURIComponent(stem)) && !h.url.includes(stem), `"${stem}" is nowhere in what the phone gets`, h);
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
      // Beta 3.8: no name on the handout
      const words = await js(`(() => { const v = document.querySelector('.ho-view'); return { text: v.querySelector('.ho-cap').textContent.trim(), alt: v.querySelector('img').alt, label: v.getAttribute('aria-label') }; })()`);
      t.eq(words, { text: '', alt: 'Handout', label: 'Handout' }, 'the handout shows without its file name');
      t.eq(errs, [], 'errors in the phone app');
    } finally {
      t.handle('handout.share', { path: HO, to: null });
      w.destroy();
    }
  });

  // L2/L3 (open points): a handout's picture can be fetched only by the phones it is shown to, and only while it is
  // shown; a forgotten phone is shut out; a picture outside the library is never given out (L1)
  area.quick('a handout\'s picture: only for its phones, gone once taken back; a forgotten phone is shut out; nothing outside the library', async (t) => {
    const fs = require('fs'); const os = require('os');
    const fetchAs = (url, tok) => ph.get(`${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(tok)}`);
    await ph.run(A.token, 'pick', { name: 'Mira' });
    await ph.run(B.token, 'pick', { name: 'Thorin' });
    t.handle('handout.share', { path: HO, to: ['Mira'] });
    const url = (await t.until(() => (sa.last.handouts || [])[0], 4000, 'the handout on Mira\'s phone')).url;
    t.eq((await fetchAs(url, A.token)).status, 200, 'Mira\'s phone gets the picture');
    t.ok((await fetchAs(url, B.token)).status >= 400, 'Thorin\'s phone, not shown it, doesn\'t', url);
    const pic = await fetchAs(url, A.token);
    t.ok(/no-cache|no-store/.test(pic.cache) && !/max-age=86400/.test(pic.cache), 'the phone asks again each time (no 24-hour copy)', pic.cache);
    t.handle('handout.share', { path: HO, to: null });
    await t.until(() => !(sa.last.handouts || []).length, 4000, 'taken back');
    await t.until(async () => (await fetchAs(url, A.token)).status >= 400, 4000, 'the picture can\'t be fetched once taken back');
    // a portrait outside the library (as a crafted adventure file could name): its address leads nowhere
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-l1-'));
    const out = path.join(tmp, 'outside.png');
    fs.copyFileSync(t.pic('tokens', /Hero/i), out);
    const face0 = ((sb.last.party || []).find((p) => p.name === 'Thorin') || {}).face || null;
    try {
      t.handle('char.set', { name: 'Thorin', patch: { portrait: out } }); // (a portrait comes first: the phones' face)
      const face = (await t.until(() => (sb.last.party || []).find((p) => p.name === 'Thorin' && p.face && p.face !== face0), 8000, 'Thorin\'s new face named on the phone')).face;
      t.ok((await fetchAs(face, B.token)).status >= 400, 'a picture outside the library is not given out', face);
    } finally { t.handle('char.set', { name: 'Thorin', patch: { portrait: null } }); fs.rmSync(tmp, { recursive: true, force: true }); }
    // a forgotten phone is shut out
    const E = await ph.pair(t.settings.remote.playerKey, 'st-e', 'Phone E');
    t.ok(E.token, 'a fifth phone pairs');
    const dev = (t.settings.remote.devices || []).find((d) => d.name === 'Phone E');
    await t.g(`window.ts.remote('forget', { id: ${JSON.stringify(dev && dev.id)} })`);
    const r = await ph.run(E.token, 'pick', { name: 'Mira' });
    t.ok(r.status >= 400 && r.status < 500, 'its pass no longer works', r);
  });

  // P2/P3/P5 (open points): the GM remote's tile glows only for a GM device; a card without a speed walks 30 ft (an old
  // campaign speed no longer counts); a forgotten device comes back with Undo
  area.quick('the GM remote tile glows only for GM devices; a card without a speed walks 30 ft; Forget can be undone', async (t) => {
    t.ok(sa.last && sb.last, 'two player phones connected');
    await t.g(`Play.openPop('toolbox')`);
    const tile = await t.until(() => t.g(`(() => { const b = document.querySelector('#pop [data-id="remote"]'); return b ? { live: b.classList.contains('live') } : null; })()`), 3000, 'the Gamemaster remote tile');
    t.eq(tile.live, false, 'the tile glows with only players\' phones connected');
    const sd = ph.stream(D.token);
    try {
      await t.until(() => t.g(`!!document.querySelector('#pop [data-id="remote"].live')`), 4000, 'it glows once the GM phone connects');
    } finally { sd.close(); await t.g('Play.closePop()'); }
    // P3
    const old = t.settings.players.speed;
    t.settings.players.speed = 25; // (a campaign speed kept from before F4)
    t.handle('char.set', { name: 'Thorin', patch: { speed: null } });
    try {
      const mv = await t.until(() => t.g(`(() => { const p = Play.state().players; return p && p.moves && p.moves.Thorin; })()`), 3000, 'Thorin in the players\' list');
      t.eq(mv.speed, 30, 'a card without a speed walks 30 ft');
    } finally { if (old === undefined) delete t.settings.players.speed; else t.settings.players.speed = old; }
    // P5: Forget, then Undo
    const F = await ph.pair(t.settings.remote.key, 'st-f', 'Undo phone');
    const dev = (t.settings.remote.devices || []).find((d) => d.name === 'Undo phone');
    const r = await t.g(`window.ts.remote('forget', { id: ${JSON.stringify(dev.id)} })`);
    t.ok(r && r.ok && r.back, 'forgotten, with a way back', r);
    t.ok((await ph.run(F.token, 'ping', {})).status >= 400, 'its pass stops working');
    t.ok((await t.g(`window.ts.remote('unforget', { id: ${JSON.stringify(r.back)} })`)).ok, 'Undo');
    t.ok((await ph.run(F.token, 'ping', {})).ok, 'its pass works again');
    await t.g(`window.ts.remote('forget', { id: ${JSON.stringify(dev.id)} })`);
  });

  // L5 (open point): the players' turn order on their phones: hidden fighters left out, unshown ones as ?? without a face
  area.quick('the players\' turn order: hidden enemies left out, unshown ones as ?? without a face, nothing while it is hidden', async (t) => {
    t.handle('init.start', { mapId, list: [{ name: 'Mira', init: 18, pc: true }, { name: 'Goblin', init: 14 }, { name: 'Assassin', init: 10, hidden: true }] });
    try {
      t.handle('init.update', { show: true });
      const f = await t.until(() => sa.last.fight && sa.last.fight.cards.length && sa.last.fight, 4000, 'the turn order on the phone');
      const names = f.cards.map((c) => c.name);
      t.ok(!names.includes('Assassin') && !JSON.stringify(sa.last).includes('Assassin'), 'the hidden one is nowhere on the phone', names);
      t.ok(names.includes('Mira'), 'the player by name', names);
      const gob = f.cards.find((c) => !c.pc);
      t.ok(gob && gob.name === '??' && !gob.known && !gob.face, 'an enemy not shown yet: ?? without a face', gob);
      t.ok(!JSON.stringify(sa.last).includes('Goblin'), 'its name is nowhere on the phone');
      t.handle('init.update', { show: false });
      await t.until(() => !sa.last.fight, 4000, 'no turn order on the phone while it is hidden from the table');
    } finally { t.handle('init.end', {}); }
  });

  // O1/O4/O5 (open points): the real phone page as a player holds it sideways: pick a character, the seat set-up survives
  // moving being switched off and on, every button on the screen, still connected after the map changes
  area.deep('the real phone page sideways: pick, a seat set-up that can\'t get stuck, every button on screen, still on after a map change', async (t) => {
    const { BrowserWindow } = require('electron');
    await ph.run(A.token, 'unpick', {}); await ph.run(B.token, 'unpick', {});
    const P = await ph.pair(t.settings.remote.playerKey, 'st-p', 'Phone P');
    const w = new BrowserWindow({ show: false, width: 667, height: 320, webPreferences: { partition: 'phone-test-o' } }); // (a small phone held sideways, its browser bars taken off)
    const errs = [];
    w.webContents.on('console-message', (e, lvl, msg) => { const level = typeof e.level === 'string' ? e.level : lvl; if (level === 'error' || level === 3) errs.push(e.message || msg); });
    const js = (code) => w.webContents.executeJavaScript(code);
    try {
      await w.loadURL(`http://127.0.0.1:${ph.port}/#t=${P.token}`);
      await t.until(() => js(`[...document.querySelectorAll('.pick-card')].some((b) => b.textContent.includes('Mira'))`), 8000, 'Who are you? with Mira');
      await js(`[...document.querySelectorAll('.pick-card')].find((b) => b.textContent.includes('Mira')).click()`);
      await t.until(() => js(`!!document.querySelector('.ctl.calib')`), 5000, 'the seat set-up');
      // O1: moving switched off meanwhile: the phone follows (it stayed on the set-up for good)
      await t.g(`window.ts.players('set', { on: false })`);
      await t.until(() => js(`!!document.querySelector('.ctl.wait')`), 5000, 'the phone to say moving is off');
      await t.g(`window.ts.players('set', { on: true })`);
      await t.until(() => js(`!!document.querySelector('.ctl.calib, .ctl.drive')`), 5000, 'back to the set-up once moving is on');
      if (await js(`!!document.querySelector('.ctl.calib')`)) await js(`[...document.querySelectorAll('.ctl.calib .pbtn')].pop().click()`); // (Skip)
      await t.until(() => js(`!!document.querySelector('.ctl.drive')`), 5000, 'the controller');
      // O4: sideways, every button on the screen
      await t.until(() => js(`document.querySelectorAll('.ctl-acts .abtn').length >= 2`), 4000, 'its buttons');
      const off = await js(`[...document.querySelectorAll('.ctl-acts .abtn')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), bottom: Math.round(r.bottom), right: Math.round(r.right) }; }).filter((x) => x.bottom > innerHeight + 1 || x.right > innerWidth + 1)`);
      t.eq(off, [], 'buttons off the screen of a small phone held sideways (667 × 320)');
      // O5: the map changes; the page still gets its state
      const other = await t.newMap('Phones other (test)', { tv: true });
      try {
        await t.until(() => js(`document.body.dataset.conn === 'on' && !!document.querySelector('.ctl')`), 5000, 'still connected after the map changed');
      } finally { t.handle('edit.open', { id: mapId }); t.handle('table.send', { id: mapId }); t.handle('map.remove', { id: other }); }
      t.eq(errs, [], 'errors in the phone app');
    } finally { w.destroy(); await ph.run(P.token, 'unpick', {}); }
  });

  // O2/O5 (open points): the DM's phone page: a quick double tap on the turn arrow gives one next turn, not two
  area.deep('the GM remote page: a double tap on the turn arrow is one next turn', async (t) => {
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, width: 390, height: 780, webPreferences: { partition: 'phone-test-d' } });
    const js = (code) => w.webContents.executeJavaScript(code);
    t.handle('init.start', { mapId, list: [{ name: 'Mira', init: 18, pc: true }, { name: 'Goblin', init: 14 }, { name: 'Ogre', init: 9 }] });
    try {
      await w.loadURL(`http://127.0.0.1:${ph.port}/#t=${D.token}`);
      await t.until(() => js(`!!document.querySelector('.st-arrow')`), 8000, 'the turn strip on the GM remote');
      const order = t.state.init.entries.map((e) => e.id);
      const at0 = order.indexOf(t.state.init.turn);
      await js(`(() => { const b = document.querySelector('.st-arrow'); b.click(); b.click(); })()`);
      await t.sleep(800);
      t.eq(order.indexOf(t.state.init.turn), (at0 + 1) % order.length, 'one turn on, not two');
    } finally { t.handle('init.end', {}); w.destroy(); }
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

  // ---------- UI audit, group UI 5: Phones (Open Points VE) ----------
  const devOf = (t, x) => (t.settings.remote.devices || []).find((d) => d.token === x.token);
  const fresh = (t) => t.g(`window.ts.players('set', {})`); // (the GM's state anew)
  const only = async (t, who, name) => { await ph.run(A.token, 'unpick', {}); await ph.run(B.token, 'unpick', {}); const r = await ph.run(who.token, 'pick', { name }); t.ok(r.ok, `${name} picked`, r); };

  area.quick('VE6, VE8: a phone is called by its character until the GM names it; one that left gives its character to the next pick at once; the seat glow is counted per phone', async (t) => {
    await only(t, A, 'Mira');
    const dA = devOf(t, A);
    const rows = async () => { await fresh(t); return t.g(`Play.state().players.phones.map((d) => [d.name, d.char, d.connected])`); };
    t.ok((await rows()).some((x) => x[0] === 'Mira\'s Phone A'), 'in the GM\'s list: Mira\'s Phone A', await rows());
    const no = await ph.run(B.token, 'pick', { name: 'Mira' });
    t.ok(!no.ok && /another phone/.test(no.error || ''), 'while Phone A is connected Phone B is turned away', no);
    try {
      await t.g(`window.ts.remote('rename', { id: ${JSON.stringify(dA.id)}, name: 'Anna' })`);
      t.ok((await rows()).some((x) => x[0] === 'Anna' && x[1] === 'Mira'), 'renamed by the GM: that name stays', await rows());
      t.ok(/on Anna/.test((await ph.run(B.token, 'pick', { name: 'Mira' })).error || ''), 'and it is the name a player is told');
      // the seat: two phones look for theirs, one finds it: the edge still glows for the other
      t.ok((await ph.run(B.token, 'pick', { name: 'Thorin' })).ok, 'Phone B is Thorin');
      await ph.run(A.token, 'calib', { on: true }); await ph.run(B.token, 'calib', { on: true });
      t.eq(t.state.calib, true, 'the TV\'s edge glows');
      await ph.run(A.token, 'calib', { on: false });
      t.eq(t.state.calib, true, 'still glowing for the second phone');
      await ph.run(B.token, 'calib', { on: false });
      t.eq(t.state.calib, false, 'out when the last one is done');
      await ph.run(B.token, 'unpick', {});
      // Phone A leaves (a dead battery): its character goes to the next phone that picks it, at once
      sa.close();
      await t.until(async () => (await rows()).some((x) => x[0] === 'Anna' && !x[2]), 5000, 'Phone A away');
      t.eq(sb.last.ctl.chars.find((c) => c.name === 'Mira').taken, null, 'Mira is not shown as taken');
      const yes = await ph.run(B.token, 'pick', { name: 'Mira' });
      t.ok(yes.ok, 'Phone B takes Mira without waiting a minute', yes);
      t.eq(dA.char, undefined, 'Phone A has no character any more');
    } finally {
      delete dA.named; dA.name = 'Phone A';
      sa = ph.stream(A.token);
      await t.until(() => sa.last, 5000, 'Phone A back');
      await ph.run(B.token, 'unpick', {});
    }
  });

  area.quick('VE7: an aim that arrives after its step or let-go is dropped; one that came too soon is shown a moment later', async (t) => {
    await only(t, A, 'Mira');
    const aims = () => t.g(`[...document.querySelectorAll('#viewport .sv-aim-cell')].map((e) => [Math.round(parseFloat(e.style.left)), Math.round(parseFloat(e.style.top))])`);
    const n0 = Date.now();
    await t.sleep(400);
    await ph.run(A.token, 'aim', { dir: 's', n: n0 + 1 });
    const south = await t.until(async () => { const a = await aims(); return a.length === 1 && a[0]; }, 3000, 'the aim on the map');
    await ph.run(A.token, 'aim', { dir: null, n: n0 + 10 });
    await t.until(async () => (await aims()).length === 0, 3000, 'the aim gone when the stick is let go');
    await ph.run(A.token, 'aim', { dir: 'e', n: n0 + 5 }); // (sent before the let-go, here after it)
    await t.sleep(300);
    t.eq((await aims()).length, 0, 'aims on the map from before the let-go');
    // two within a moment: the second one is the one that stays
    await t.sleep(100);
    await Promise.all([ph.run(A.token, 'aim', { dir: 's', n: n0 + 20 }), ph.run(A.token, 'aim', { dir: 'w', n: n0 + 21 })]);
    await t.sleep(350);
    const west = (await aims())[0];
    t.ok(west && west[0] < south[0] && west[1] < south[1], 'the last of two quick aims is the one shown (west, not south)', [west, south]);
    // a step, then an aim from before it
    const p0 = at(t);
    await t.sleep(250);
    const st = await ph.run(A.token, 'move', { dir: 's', n: n0 + 30 });
    t.ok(st.ok, 'a step south', st);
    await t.until(() => at(t)[1] === p0[1] + 1, 3000, 'the token a square south');
    await ph.run(A.token, 'aim', { dir: 'w', n: n0 + 25 });
    await t.sleep(300);
    t.eq((await aims()).length, 0, 'aims on the map from before the step');
    await ph.run(A.token, 'aim', { dir: 'n', n: n0 + 40 });
    await t.until(async () => (await aims()).length === 1, 3000, 'a new aim right after the step');
    await t.sleep(250);
    await ph.run(A.token, 'move', { dir: 'n', n: n0 + 50 });
    await t.until(() => at(t)[1] === p0[1], 3000, 'the token back');
  });

  area.quick('VE11, VE13: an old code is answered without a panel that does not exist; a rest is told as the time left', async (t) => {
    const bad = await ph.pair('000001', 'st-y', 'Stranger');
    t.ok(/join code/.test(bad.error || '') && /Gamemaster remote/.test(bad.error || '') && !/→ Remote\b/.test(bad.error || ''), 'what an old code is told', bad.error);
    await only(t, A, 'Mira');
    const p0 = at(t);
    await t.g(`window.ts.players('set', { rest: 5 })`);
    try {
      await t.sleep(250);
      t.ok((await ph.run(A.token, 'move', { dir: 's' })).ok, 'a step');
      const me = await t.until(() => sa.last.ctl && sa.last.ctl.me && sa.last.ctl.me.restLeft > 0 && sa.last.ctl.me, 4000, 'the rest on the phone');
      t.ok(me.restLeft > 2500 && me.restLeft <= 5000 && !('restUntil' in me) && me.rest === 5, 'the time left in milliseconds, no clock time of the PC', [me.restLeft, me.rest]);
    } finally {
      await t.g(`window.ts.players('set', { rest: 0 })`);
      await t.sleep(250);
      await ph.run(A.token, 'move', { dir: 'n' });
      await t.until(() => at(t)[1] === p0[1], 3000, 'the token back');
    }
  });

  area.deep('VE1, VE3, VE5, VE8, VE12, VE13: the real phone page: a touch taken away is no step; Cancel keeps the seat; Back closes the menu; a lost line says so; no campaign: it waits as Mira', async (t) => {
    const { BrowserWindow } = require('electron');
    await ph.run(A.token, 'unpick', {}); await ph.run(B.token, 'unpick', {});
    const Q = await ph.pair(t.settings.remote.playerKey, 'st-q', 'Phone Q');
    const w = new BrowserWindow({ show: false, width: 390, height: 780, webPreferences: { partition: 'phone-test-q' } });
    const errs = [];
    w.webContents.on('console-message', (e, lvl, msg) => { const level = typeof e.level === 'string' ? e.level : lvl; if (level === 'error' || level === 3) errs.push(e.message || msg); });
    const js = (code) => w.webContents.executeJavaScript(code);
    // a thumb on the stick: fx, fy from its middle (1 = the rim)
    const stick = (type, fx, fy) => js(`(() => { const el = document.querySelector('.ctl .stick'); const b = el.getBoundingClientRect(); const R = b.width / 2; el.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { pointerId: 7, clientX: b.left + R + ${fx} * R * 0.7, clientY: b.top + R + ${fy} * R * 0.7, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true })); return 0; })()`);
    const aims = () => t.g(`document.querySelectorAll('#viewport .sv-aim').length`);
    try {
      await w.loadURL(`http://127.0.0.1:${ph.port}/#t=${Q.token}`);
      await t.until(() => js(`[...document.querySelectorAll('.pick-card')].some((b) => b.textContent.includes('Mira'))`), 8000, 'Who are you? with Mira');
      // VE12: the cards stay the same cards while states come in
      await js(`window.__card = document.querySelector('.pick-card'); 0`);
      await t.g(`window.ts.players('set', { pings: false })`); await t.g(`window.ts.players('set', { pings: true })`);
      await t.sleep(1300);
      t.eq(await js(`window.__card === document.querySelector('.pick-card')`), true, 'Who are you? is not built anew with every state');
      await js(`[...document.querySelectorAll('.pick-card')].find((b) => b.textContent.includes('Mira')).click()`);
      await t.until(() => js(`!!document.querySelector('.ctl.calib')`), 5000, 'the seat set-up');
      t.eq(await js(`[...document.querySelectorAll('.ctl.calib .pbtn')].pop().textContent`), 'Skip (it is away from me)', 'no seat yet: Skip');
      // the seat: the TV's top edge is to the right of this player
      await stick('pointerdown', 1, 0); await stick('pointerup', 1, 0);
      await t.until(() => js(`!!document.querySelector('.ctl.drive')`), 5000, 'the controller');
      t.eq(await js(`localStorage.getItem('ts.remote.seat')`), '90', 'the seat');
      // VE8: Seat again, then Cancel: the seat stays
      await js(`document.querySelector('.abtn.seat').click()`);
      await t.until(() => js(`!!document.querySelector('.ctl.calib')`), 4000, 'the seat set-up again');
      t.eq(await js(`[...document.querySelectorAll('.ctl.calib .pbtn')].pop().textContent`), 'Cancel', 'with a seat: Cancel');
      await js(`[...document.querySelectorAll('.ctl.calib .pbtn')].pop().click()`);
      await t.until(() => js(`!!document.querySelector('.ctl.drive')`), 4000, 'the controller again');
      t.eq(await js(`localStorage.getItem('ts.remote.seat')`), '90', 'the seat after Cancel');
      await t.until(() => !t.state.calib, 3000, 'the TV\'s edge dark again');
      // VE5: the touch is taken away (a call, a swipe from the edge): no step
      const p0 = at(t);
      await t.sleep(400);
      await stick('pointerdown', -1, 0); // (left on this phone: south on the table, from this seat)
      await t.until(async () => (await aims()) === 1, 3000, 'the aim on the map');
      await stick('pointercancel', -1, 0);
      await t.until(async () => (await aims()) === 0, 3000, 'the aim gone');
      await t.sleep(500);
      t.eq(at(t), p0, 'where the token stands after a touch that was taken away');
      t.eq(await js(`document.querySelector('.stick .knob').style.transform`), 'translate(0px, 0px)', 'the knob is back in the middle');
      // a finger lifted is a step; VE12: the picture and the buttons stay the same ones; VE13: the rest counts on the phone
      await t.g(`window.ts.players('resetChar', { name: 'Mira' })`); // (a rest left over from the check before)
      await t.g(`window.ts.players('set', { rest: 4 })`);
      await js(`window.__face = document.querySelector('.ctl-face'); window.__seat = document.querySelector('.abtn.seat'); 0`);
      await stick('pointerdown', -1, 0); await t.sleep(150); await stick('pointerup', -1, 0);
      await t.until(() => at(t)[1] === p0[1] + 1, 3000, 'a step south');
      await t.until(() => js(`!!document.querySelector('.stick-centre.rest')`), 4000, 'the rest in the middle of the stick');
      const left = Number(await js(`document.querySelector('.stick-centre.rest b').textContent`));
      t.ok(left >= 2 && left <= 4, 'seconds of rest left', left);
      await t.sleep(1200);
      t.eq(await js(`[window.__face === document.querySelector('.ctl-face'), window.__seat === document.querySelector('.abtn.seat')]`), [true, true], 'the picture and the buttons are the same ones after a step and a second of rest');
      await t.g(`window.ts.players('set', { rest: 0 })`);
      await t.sleep(400);
      await stick('pointerdown', 1, 0); await t.sleep(150); await stick('pointerup', 1, 0);
      await t.until(() => at(t)[1] === p0[1], 3000, 'the step back');
      // VE13: Back closes the menu and the page stays; closed by its own button, Back is not used up
      const sheet = () => js(`!!document.querySelector('.sheet-back')`);
      await js(`document.querySelector('.pl-more').click()`);
      t.eq(await sheet(), true, 'the menu');
      await js(`history.back(); 0`);
      await t.until(async () => !(await sheet()), 3000, 'Back closes the menu');
      t.ok(await js(`location.hash.startsWith('#t=') && !!document.querySelector('.ctl.drive')`), 'and the controller is still there');
      await js(`document.querySelector('.pl-more').click()`);
      await js(`document.querySelector('.sheet-head .ib').click()`);
      await t.sleep(300);
      t.eq(await sheet(), false, 'closed by its own button');
      await js(`document.querySelector('.pl-more').click()`);
      await js(`history.back(); 0`);
      await t.until(async () => !(await sheet()), 3000, 'Back closes the next one too');
      t.ok(await js(`!!document.querySelector('.ctl.drive')`), 'the controller is still there');
      // VE1: no campaign open on the PC: the phone waits and is still Mira afterwards
      t.handle('campaign.home');
      await t.until(() => js(`!!document.querySelector('.ctl.wait') && document.querySelector('.ctl.wait').textContent`), 6000, 'the phone waits');
      t.ok(/Mira/.test(await js(`document.querySelector('.ctl.wait').textContent`)) && /Waiting for the GM/.test(await js(`document.querySelector('.ctl.wait').textContent`)), 'it says who it is and that it waits', await js(`document.querySelector('.ctl.wait').textContent`));
      await t.openDemo(); t.handle('edit.open', { id: mapId }); t.handle('table.send', { id: mapId });
      await t.until(() => js(`!!document.querySelector('.ctl.drive') && document.querySelector('.ctl-names').textContent === 'Mira'`), 8000, 'Mira again, without picking');
      // VE3: the line is lost: the page says so and takes no taps; back when Tablescape is heard again
      const port = ph.port;
      await t.g(`window.ts.remote('set', { on: false })`);
      await t.until(() => js(`document.body.dataset.conn === 'lost'`), 8000, 'the phone notices the lost line');
      const lost = await js(`({ chip: getComputedStyle(document.querySelector('.conn-chip')).display, text: document.querySelector('.conn-chip').textContent, stick: getComputedStyle(document.querySelector('.stick')).pointerEvents })`);
      t.eq([lost.chip !== 'none', lost.text, lost.stick], [true, 'Reconnecting …', 'none'], 'Reconnecting … shows, the stick takes no touch');
      await t.g(`window.ts.remote('set', { on: true })`);
      await t.until(() => t.g(`Play.state().remote && Play.state().remote.port`), 8000, 'the phones\' server again');
      t.eq(await t.g(`Play.state().remote.port`), port, 'on the same port');
      await t.until(() => js(`document.body.dataset.conn === 'on'`), 15000, 'connected again by itself');
      t.eq(await js(`getComputedStyle(document.querySelector('.conn-chip')).display`), 'none', 'the chip is gone');
      t.eq(errs.filter((x) => !/Failed to load resource|ERR_CONNECTION|ERR_EMPTY|net::/.test(x)), [], 'errors in the phone app');
    } finally {
      w.destroy();
      await t.g(`window.ts.players('set', { rest: 0 })`).catch(() => {});
      if (!(await t.g(`Play.state().remote && Play.state().remote.running`).catch(() => false))) await t.g(`window.ts.remote('set', { on: true })`);
      await t.sleep(500);
      sa.close(); sb.close(); sa = ph.stream(A.token); sb = ph.stream(B.token);
      await t.until(() => sa.last && sb.last, 6000, 'the two phones back');
      await ph.run(Q.token, 'unpick', {});
    }
  });

  // (the last one: it goes back to Home)
  area.quick('VE1: back at Home a phone keeps its character, is told to wait, and moves nothing', async (t) => {
    await only(t, A, 'Mira');
    const dA = devOf(t, A);
    t.handle('campaign.home');
    try {
      await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the home screen');
      const c = await t.until(() => sa.last.ctl && sa.last.ctl.closed && sa.last.ctl, 5000, 'the phone told that no campaign is open');
      t.eq([c.mine, c.me, c.chars], ['Mira', null, []], 'who it is, and nothing to pick');
      const r = await ph.run(A.token, 'move', { dir: 'e' });
      t.ok(!r.ok && r.why === 'closed', 'a step is turned away', r);
      t.eq(dA.char, 'Mira', 'the phone\'s character after all that');
    } finally {
      await t.openDemo(); t.handle('edit.open', { id: mapId }); t.handle('table.send', { id: mapId });
    }
    const me = await t.until(() => sa.last.ctl && sa.last.ctl.me, 8000, 'Mira again once the campaign is open');
    t.eq(me.name, 'Mira', 'without picking again');
  });
};
