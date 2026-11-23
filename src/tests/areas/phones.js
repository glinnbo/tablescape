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
};
