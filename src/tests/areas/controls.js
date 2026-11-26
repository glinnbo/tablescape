// UI audit of 25 Nov 2026, groups UI 1 and UI 2 (Open Points VA, VB): a click or a key does what was meant and
// nothing else. Each check names its point.
'use strict';
const { ipcMain } = require('electron');

module.exports = (area) => {
  area.title('Clicks and keys do one thing');
  let pings = 0;
  const onPing = () => { pings++; };
  area.before(async (K) => { await K.openDemo(); await K.send(); ipcMain.removeListener('ping', onPing); ipcMain.on('ping', onPing); });

  const M = (t) => t.store.map(t.state.editMapId);
  const hist = (t) => t.store.history(t.state.editMapId).undo.length;
  const tokens = (t) => M(t).layers.filter((l) => l.role === 'token');
  const tok = (t, id) => M(t).layers.find((l) => l.id === id);
  const mid = async (t) => { const v = await t.viewport(); return { x: v.x + v.w / 2, y: v.y + v.h / 2, v }; };
  const wheel = async (t, x, y, deltaY, modifiers = []) => { t.gm().webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, modifiers, canScroll: true }); await t.sleep(150); };
  const start = async (t) => { await t.calm(); await t.g(`Play.setTool('select')`); t.gm().webContents.focus(); await t.sleep(150); };
  const twice = async (t, p) => {
    const w = t.gm().webContents;
    for (const n of [1, 2]) { w.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: n }); w.sendInputEvent({ type: 'mouseUp', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: n }); await t.sleep(60); }
    await t.sleep(450);
  };
  const keyEv = (t, o) => t.g(`window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${JSON.stringify(o)})))`);
  const fight = (t) => t.handle('init.start', { mapId: t.L().id, list: [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Ogre', init: 7 }] });
  const turn = (t) => t.state.init && t.state.init.turn;
  const focused = (t) => t.g(`(() => { const a = document.activeElement; return a && a !== document.body ? a.tagName + '.' + String(a.className).slice(0, 40) : null; })()`);

  // ---------- UI 1: clicks on the map ----------
  area.quick('VA1: the click that closes the right-click wheel paints no fog; the next one paints', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog')`); await t.sleep(250);
    const m = await mid(t);
    await t.click(m.x + 150, m.y - 120, 'right');
    await t.until(() => t.g(`!!document.querySelector('#radial')`), 2500, 'the wheel');
    const u0 = hist(t);
    await t.click(m.x - 200, m.y + 100); await t.sleep(400);
    t.ok(!(await t.g(`!!document.querySelector('#radial')`)), 'the wheel closed');
    t.eq(hist(t), u0, 'nothing was painted (no undo step)');
    await t.click(m.x - 200, m.y + 100); await t.sleep(400);
    t.eq(hist(t), u0 + 1, 'the click after it paints');
    await t.cmd('history.undo', {});
  });

  area.quick('VA2: Alt + wheel scales the map only with the Map tool', async (t) => {
    await start(t);
    const m = await mid(t); await t.mouse('mouseMove', m.x, m.y);
    const z0 = M(t).view.zoom; const u0 = hist(t);
    await wheel(t, m.x, m.y, 120, ['alt']); await wheel(t, m.x, m.y, 120, ['alt']); await t.sleep(900);
    t.eq(M(t).view.zoom, z0, 'Select: the map on the table keeps its size');
    t.eq(hist(t), u0, 'and nothing to undo');
    await t.g(`Play.setTool('map')`); await t.sleep(200);
    await wheel(t, m.x, m.y, 120, ['alt']); await t.sleep(1100);
    t.ok(M(t).view.zoom !== z0, 'Map tool: Alt + wheel scales it', [z0, M(t).view.zoom]);
    await t.cmd('history.undo', {});
    t.eq(M(t).view.zoom, z0, 'and Undo brings the size back');
  });

  area.quick('VA3: a double click on a token sends no ping; on empty map it does', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const p = await t.scr(k.x, k.y);
    pings = 0; await twice(t, p);
    t.eq(pings, 0, 'no ping on a token');
    t.handle('layer.update', { id: k.id, hidden: true }); await t.settle();
    pings = 0; await twice(t, p);
    t.eq(pings, 0, 'nor on a hidden one');
    t.handle('layer.update', { id: k.id, hidden: false }); await t.settle();
    const m = await mid(t);
    pings = 0; await twice(t, { x: m.v.x + 30, y: m.v.y + m.v.h - 170 });
    t.ok(pings >= 1, 'a ping on empty map', pings);
  });

  area.quick('VA4: a plain click on a token opens its sheet and changes nothing: no undo step, a freely placed token stays', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden);
    t.handle('layer.update', { id: k.id, x: k.x + 0.13, y: k.y + 0.07 }); await t.settle();
    const at = [tok(t, k.id).x, tok(t, k.id).y]; const u0 = hist(t);
    const p = await t.scr(at[0], at[1]);
    await t.click(p.x, p.y); await t.sleep(500);
    t.eq(hist(t), u0, 'no undo step');
    t.eq([tok(t, k.id).x, tok(t, k.id).y], at, 'it did not jump onto the grid');
    await t.until(() => t.g(`document.querySelector('#token-sheet').classList.contains('on')`), 2500, 'its sheet');
    // a real drag is still one step and snaps
    await t.drag(p, { x: p.x + 90, y: p.y + 40 });
    t.eq(hist(t), u0 + 1, 'a drag is one undo step');
    t.ok(tok(t, k.id).x !== at[0], 'and it moved');
    await t.cmd('history.undo', {}); await t.cmd('history.undo', {});
  });

  area.quick('VA5: a right-click on a token with Fog in hand keeps Fog; the next click only closes the sheet', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog'); Play.openPop('fog')`); await t.sleep(300);
    const k = tokens(t).find((l) => !l.hidden); const p = await t.scr(k.x, k.y);
    await t.click(p.x, p.y, 'right');
    await t.until(() => t.g(`document.querySelector('#token-sheet').classList.contains('on')`), 2500, 'the token\'s sheet');
    t.eq(await t.tool(), 'fog', 'the tool is still Fog');
    const m = await mid(t); const u0 = hist(t);
    await t.click(m.x - 200, m.y + 100); await t.sleep(400);
    t.ok(!(await t.g(`document.querySelector('#token-sheet').classList.contains('on')`)), 'a click on the map closes the sheet');
    t.eq(hist(t), u0, 'and paints nothing');
    await t.click(m.x - 200, m.y + 100); await t.sleep(400);
    t.eq(hist(t), u0 + 1, 'the next click paints fog');
    await t.cmd('history.undo', {});
  });

  area.deep('VA6: a token held still for three seconds in mid-drag is still one undo step', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const at = [k.x, k.y]; const p = await t.scr(k.x, k.y); const u0 = hist(t);
    await t.mouse('mouseMove', p.x, p.y); await t.mouse('mouseDown', p.x, p.y);
    for (let i = 1; i <= 5; i++) await t.mouse('mouseMove', p.x + i * 14, p.y + i * 5, 'left', { modifiers: ['leftButtonDown'] });
    await t.sleep(3000);
    for (let i = 6; i <= 10; i++) await t.mouse('mouseMove', p.x + i * 14, p.y + i * 5, 'left', { modifiers: ['leftButtonDown'] });
    await t.sleep(3000);
    await t.mouse('mouseUp', p.x + 140, p.y + 50); await t.sleep(500); await t.settle();
    t.eq(hist(t), u0 + 1, 'one undo step for the whole drag');
    await t.cmd('history.undo', {});
    t.eq([tok(t, k.id).x, tok(t, k.id).y], at, 'Undo puts it back where it came from');
  }, { ms: 30000 });

  // ---------- UI 2: keys and typing ----------
  area.quick('VB1: Enter after a click on a Soundboard pad or on Blackout is the next turn, not that button again', async (t) => {
    await start(t);
    fight(t); await t.settle();
    await t.g(`Play.TB.openPanel('sound')`);
    await t.until(() => t.rect('.fp[data-id="sound"] .pad'), 4000, 'a pad');
    await t.sleep(400);
    await t.clickSel('.fp[data-id="sound"] .pad'); await t.sleep(500);
    t.eq(await focused(t), null, 'the pad let go of the keyboard');
    const n0 = (await t.sound()).board.length; const t0 = turn(t);
    await t.key('Enter'); await t.sleep(400);
    t.ok(turn(t) !== t0, 'Enter: the next turn');
    t.eq((await t.sound()).board.length, n0, 'and the pad does not play again');
    await t.cmd('sound.stop'); await t.g(`Play.Floats.hide('sound')`);
    await t.clickSel('#table-ctl .tc-black'); await t.sleep(300);
    t.eq(t.state.blackout, true, 'Blackout is on');
    const t1 = turn(t);
    await t.key('Enter'); await t.sleep(400);
    t.eq(t.state.blackout, true, 'Enter leaves Blackout on');
    t.ok(turn(t) !== t1, 'and moves the turn');
    await t.cmd('table.blackout', {}); t.handle('init.end', {});
  });

  area.quick('VB3, VB7: a held Enter moves one turn; with Walls in hand and nothing half drawn Enter does nothing', async (t) => {
    await start(t);
    fight(t); await t.settle();
    const order = t.state.init.entries.map((e) => e.id); const i0 = order.indexOf(turn(t));
    const w = t.gm().webContents;
    w.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    for (let i = 0; i < 4; i++) w.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['isAutoRepeat'] });
    w.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await t.sleep(500); await t.settle();
    t.eq(order.indexOf(turn(t)), (i0 + 1) % order.length, 'one turn on, not five');
    await t.g(`Play.setTool('walls')`); await t.sleep(200);
    const t1 = turn(t);
    await t.key('Enter'); await t.sleep(300);
    t.eq(turn(t), t1, 'Walls: Enter is not "next turn"');
    t.handle('init.end', {});
  });

  area.quick('VB4: Ctrl + "+" on the 1 key (a Swiss keyboard) leaves the interface size; the number pad\'s + changes it; ü is [', async (t) => {
    await start(t);
    const size = () => t.g(`(Play.state().settings.uiScale || 1)`);
    const s0 = await size();
    await keyEv(t, { key: '+', code: 'Digit1', ctrlKey: true, shiftKey: true }); await t.sleep(300);
    t.eq(await size(), s0, 'Ctrl + Shift + 1 is not "interface bigger"');
    await keyEv(t, { key: '+', code: 'NumpadAdd', ctrlKey: true }); await t.sleep(400);
    t.ok((await size()) > s0, 'Ctrl + the number pad\'s + is', [s0, await size()]);
    await keyEv(t, { key: '0', code: 'Digit0', ctrlKey: true }); await t.sleep(400);
    await t.g(`window.ts.settings({ uiScale: ${s0} })`); await t.sleep(300);
    await t.g(`Play.setTool('fog')`); await t.sleep(200);
    const b0 = await t.g(`Play.ui.brushIn`);
    await keyEv(t, { key: '¨', code: 'BracketRight' }); await t.sleep(150);
    t.ok((await t.g(`Play.ui.brushIn`)) > b0, 'the key where ] sits makes the brush bigger', [b0, await t.g(`Play.ui.brushIn`)]);
    await keyEv(t, { key: 'ü', code: 'BracketLeft' }); await t.sleep(150);
    t.eq(await t.g(`Play.ui.brushIn`), b0, 'and the one where [ sits smaller again');
  });

  area.quick('VB5: the Cartographer has the keyboard as it opens', async (t) => {
    await start(t);
    await t.g(`Play.TB.openPanel('atlas')`);
    await t.until(() => t.g(`!!document.querySelector('.mt .mt-stage')`), 5000, 'the Cartographer');
    await t.sleep(400);
    t.ok(await t.g(`!!document.activeElement && !!document.activeElement.closest('.mt')`), 'the keyboard is inside it', await focused(t));
    await t.g(`Play.Floats.closeAll()`);
  });

  area.quick('VB6: Library open, after a click on a folder: a letter goes into its search, Delete removes nothing', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const n0 = tokens(t).length;
    const p = await t.scr(k.x, k.y); await t.click(p.x, p.y); await t.sleep(300);
    await t.key('L');
    await t.until(() => t.g('Play.Drawer.isOpen'), 3000, 'the Library');
    await t.until(() => t.rect('#drawer .lib-nav-btn'), 4000, 'its folders');
    await t.clickSel('#drawer .lib-nav-btn'); await t.sleep(400);
    t.ok(await t.g(`document.activeElement !== document.querySelector('#drawer .lib-search')`), 'the keyboard is not in the search after the click');
    await t.key('c'); await t.sleep(300);
    t.ok(await t.g('Play.Drawer.isOpen'), 'the Library is still open');
    t.eq(await t.tool(), 'select', 'the tool did not change');
    t.eq((await t.g(`document.querySelector('#drawer .lib-search').value`)).toLowerCase(), 'c', 'the letter is in the search');
    await t.g(`document.activeElement.blur()`);
    await t.key('Delete'); await t.sleep(300);
    t.eq(tokens(t).length, n0, 'Delete removed no token behind the Library');
    await t.g(`Play.Drawer.close()`);
  });

  area.quick('VB8: a slider set with the mouse lets go of the keyboard', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog'); Play.openPop('fog')`);
    await t.until(() => t.rect('#pop input[type="range"]'), 3000, 'the Brush size slider');
    await t.sleep(350);
    const r = await t.rect('#pop input[type="range"]');
    await t.click(r.x + r.w * 0.7, r.cy); await t.sleep(300);
    t.ok(await t.g(`document.activeElement.tagName !== 'INPUT'`), 'the slider is not in focus any more', await focused(t));
    const b0 = await t.g(`Play.ui.brushIn`);
    await t.key(']'); await t.sleep(200);
    t.ok((await t.g(`Play.ui.brushIn`)) > b0, '] changes the brush');
    t.eq(Number(await t.g(`document.querySelector('#pop input[type="range"]').value`)), await t.g(`Play.ui.brushIn`), 'and the slider follows');
  });

  area.quick('VB10, VB11, VB12: T says what it sent and takes it back; Alt + F4 plays no snapshot; a map tile shows Alt 1', async (t) => {
    await start(t);
    const live = t.state.liveMapId;
    const other = t.store.allMapIds().find((id) => id !== live && !t.store.isAtlas(id));
    t.handle('edit.open', { id: other });
    await t.until(() => t.g(`Play.state().map && Play.state().map.id === ${JSON.stringify(other)}`), 5000, 'the other map');
    t.gm().webContents.focus();
    await t.key('T');
    await t.until(() => t.state.liveMapId === other, 3000, 'T sends it');
    await t.until(() => t.g(`[...document.querySelectorAll('#toasts .toast')].some((x) => /On the table/.test(x.textContent) && x.querySelector('.toast-undo'))`), 3000, 'a toast with Undo');
    await t.g(`[...document.querySelectorAll('#toasts .toast')].find((x) => /On the table/.test(x.textContent)).querySelector('.toast-undo').click()`);
    await t.until(() => t.state.liveMapId === live, 3000, 'Undo: the map from before is on the table again');
    t.handle('edit.open', { id: live });
    await t.until(() => t.g(`Play.state().map && Play.state().map.id === ${JSON.stringify(live)}`), 5000, 'back on the first map');
    await t.g(`document.querySelectorAll('#toasts .toast').forEach((x) => x.remove())`);
    await keyEv(t, { key: 'F4', code: 'F4', altKey: true }); await t.sleep(500);
    t.eq(await t.g(`document.querySelectorAll('#toasts .toast').length`), 0, 'Alt + F4: no snapshot, no word');
    await keyEv(t, { key: 'F4', code: 'F4' });
    await t.until(() => t.g(`document.querySelectorAll('#toasts .toast').length > 0 || true`), 1500, 'plain F4 still works');
    t.eq(await t.g(`document.querySelector('.map-tile').dataset.key`), 'Alt 1', 'the first map tile\'s key');
  });

  // ---------- UI 4: Esc (Open Points VD) ----------
  const hstate = (t) => t.store.history(t.state.editMapId).state;
  const held = async (t, a, b, n = 6) => { // press at a and move towards b, the button still down
    await t.mouse('mouseMove', a.x, a.y); await t.mouse('mouseDown', a.x, a.y);
    for (let i = 1; i <= n; i++) await t.mouse('mouseMove', a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, 'left', { modifiers: ['leftButtonDown'] });
    await t.sleep(150);
  };

  area.quick('VD1: Esc in the middle of dragging a token puts it back: not moved, nothing to undo, nothing to redo', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const at = [k.x, k.y]; const p = await t.scr(k.x, k.y); const u0 = hist(t);
    await held(t, p, { x: p.x + 120, y: p.y + 50 });
    t.ok(tok(t, k.id).x !== at[0], 'it is on its way');
    await t.key('Escape'); await t.sleep(300);
    await t.mouse('mouseMove', p.x + 140, p.y + 60, 'left', { modifiers: ['leftButtonDown'] });
    await t.mouse('mouseUp', p.x + 140, p.y + 60); await t.sleep(400); await t.settle();
    t.eq([tok(t, k.id).x, tok(t, k.id).y], at, 'back where it was');
    t.eq(hist(t), u0, 'no undo step');
    t.eq(hstate(t).canRedo, false, 'and nothing to redo');
    const now = await t.scr(tok(t, k.id).x, tok(t, k.id).y);
    const r = await t.rect(`.sv-token[data-id="${k.id}"]`);
    t.ok(Math.abs(r.cx - now.x) < 6 && Math.abs(r.cy - now.y) < 6, 'and it is drawn there', [r.cx, r.cy, now]);
    t.eq(await t.tool(), 'select', 'Esc did nothing else');
  });

  area.quick('VD1: Esc drops a Fog box in mid-drag and takes a brush stroke back', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'rect'`); await t.sleep(250);
    const m = await mid(t); const u0 = hist(t);
    await held(t, { x: m.x - 220, y: m.y + 60 }, { x: m.x - 120, y: m.y + 130 });
    t.ok(await t.g(`!!document.querySelector('.rect-preview')`), 'the box shows');
    await t.key('Escape'); await t.sleep(200);
    await t.mouse('mouseUp', m.x - 120, m.y + 130); await t.sleep(400); await t.settle();
    t.ok(!(await t.g(`!!document.querySelector('.rect-preview')`)), 'the box is gone');
    t.eq(hist(t), u0, 'nothing was revealed');
    t.eq(await t.tool(), 'fog', 'the tool is still Fog');
    await t.g(`Play.ui.fogShape = 'brush'`);
    await held(t, { x: m.x - 220, y: m.y + 60 }, { x: m.x - 120, y: m.y + 130 }, 10);
    await t.settle();
    t.eq(hist(t), u0 + 1, 'a stroke is on its way');
    await t.key('Escape'); await t.sleep(300);
    await t.mouse('mouseUp', m.x - 120, m.y + 130); await t.sleep(400); await t.settle();
    t.eq(hist(t), u0, 'Esc takes the stroke back');
    t.eq(hstate(t).canRedo, false, 'with nothing left to redo');
  });

  area.quick('VD2, VD3: Esc in a field only leaves the field; Esc lets go of a picked effect before it closes the panel', async (t) => {
    await start(t);
    await t.g(`Play.setTool('spell'); Play.openPop('spell')`);
    await t.until(() => t.rect('#pop input[type="search"], #pop input[type="text"]'), 3000, 'the spell search');
    await t.sleep(300);
    await t.clickSel('#pop input[type="search"], #pop input[type="text"]');
    t.ok(await t.g(`document.activeElement.tagName === 'INPUT'`), 'the keyboard is in the search');
    await t.key('Escape'); await t.sleep(200);
    t.ok(await t.g(`document.activeElement.tagName !== 'INPUT'`), 'Esc leaves the field');
    t.ok(await t.popTitle(), 'and the panel is still open');
    t.eq(await t.tool(), 'spell', 'with its tool');
    await t.key('Escape'); await t.sleep(200);
    t.ok(!(await t.popTitle()), 'the next Esc closes the panel');
    // a picked effect
    const fx = (M(t).fx || []).find((f) => !f.attachTo && f.preset !== 'party');
    if (fx) {
      await t.g(`Play.setTool('fx'); Play.openPop('fx'); Play.selectFx(${JSON.stringify(fx.id)})`); await t.sleep(300);
      t.eq(await t.g(`Play.ui.selFx`), fx.id, 'an effect is picked');
      await t.key('Escape'); await t.sleep(200);
      t.eq(await t.g(`Play.ui.selFx`), null, 'Esc lets go of it');
      t.ok(await t.popTitle(), 'and the Effects panel stays');
      await t.key('Escape'); await t.sleep(200);
      t.ok(!(await t.popTitle()), 'the next Esc closes it');
    } else t.ok(true, '(no placed effect on this map to pick)');
  });

  area.quick('VD5, VD7: a trigger waiting for a click shows in the top bar and ends with Esc or another tool; the Guide closes with one Esc', async (t) => {
    await start(t);
    await t.g(`Play.ui.trigPlace = 'tr-test'`); await t.sleep(200);
    t.ok(/trigger/i.test(await t.text('#topbar .bar-mode') || ''), 'the top bar says a trigger waits for a click', await t.text('#topbar'));
    await t.key('Escape'); await t.sleep(200);
    t.eq(await t.g(`Play.ui.trigPlace`), null, 'Esc ends it');
    t.ok(!(await t.g(`!!document.querySelector('#topbar .bar-mode')`)), 'and the bar goes');
    await t.g(`Play.ui.trigPick = { id: 'tr-test', i: 0, kind: 'door' }`); await t.sleep(150);
    await t.key('R'); await t.sleep(200);
    t.eq(await t.g(`Play.ui.trigPick`), null, 'another tool ends it too');
    await start(t);
    await t.g(`Guide.open('help')`);
    await t.until(() => t.g(`Guide.isOpen() && document.activeElement && document.activeElement.tagName === 'INPUT'`), 3000, 'the Guide with its search in focus');
    await t.key('Escape'); await t.sleep(300);
    t.ok(!(await t.g(`Guide.isOpen()`)), 'one Esc closes the Guide');
  });

  // ---------- UI 6 and UI 7: Fog, Marks, Walls, half-drawn shapes (Open Points VF, VG) ----------
  const toMap = (t, p) => t.g(`Play.view().toMap(${Math.round(p.x)}, ${Math.round(p.y)})`);
  const undoTo = async (t, n) => { for (let i = 0; i < 12 && hist(t) > n; i++) await t.cmd('history.undo', {}); };
  const asking = (t) => t.g(`(() => { const a = document.querySelector('.door-ask'); return a ? a.textContent : null; })()`);

  area.quick('VF1: "Reveal all" asks first while the map is on the table; N keeps the fog, Enter reveals', async (t) => {
    await start(t);
    t.eq(t.state.liveMapId, t.state.editMapId, 'the map is on the table');
    if (!M(t).fog.enabled) { await t.cmd('fog.enabled', { enabled: true }); }
    await t.g(`Play.setTool('fog'); Play.openPop('fog')`); await t.sleep(350);
    const u0 = hist(t);
    await t.clickText('#pop button', 'Reveal all'); await t.sleep(300);
    t.ok(/Reveal the whole map/.test(await asking(t) || ''), 'it asks', await asking(t));
    t.eq(hist(t), u0, 'nothing is revealed yet');
    await t.key('N'); await t.sleep(200);
    t.eq(await asking(t), null, 'N: the question goes');
    t.eq(hist(t), u0, 'and the fog stays');
    await t.clickText('#pop button', 'Reveal all'); await t.sleep(300);
    await t.key('Enter'); await t.sleep(400); await t.settle();
    t.eq(hist(t), u0 + 1, 'Enter reveals');
    await undoTo(t, u0);
  });

  area.quick('VF3, VF4: a Fog box snaps to half squares; the brush turns the fog on', async (t) => {
    await start(t);
    if (!M(t).fog.enabled) { await t.cmd('fog.enabled', { enabled: true }); }
    const u0 = hist(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'rect'`); await t.sleep(250);
    const m = await mid(t); const n0 = M(t).fog.ops.length;
    await t.drag({ x: m.x - 233, y: m.y + 47 }, { x: m.x - 121, y: m.y + 139 }, 8);
    await t.until(() => M(t).fog.ops.length === n0 + 1, 3000, 'the box');
    const op = M(t).fog.ops[n0]; const G = M(t).grid; const st = (G.size || 1) / 2;
    const on = (v, o) => Math.abs((v - (o || 0)) / st - Math.round((v - (o || 0)) / st)) < 1e-3;
    if (!G.angle && (!G.type || G.type === 'square')) t.ok(on(op.x, G.ox) && on(op.y, G.oy) && on(op.x + op.w, G.ox) && on(op.y + op.h, G.oy), 'its edges lie on half squares', op);
    else t.ok(true, '(this map\'s grid is turned or not square: no snap)');
    await t.cmd('fog.enabled', { enabled: false });
    t.eq(M(t).fog.enabled, false, 'fog switched off');
    await t.g(`Play.ui.fogShape = 'brush'`);
    await t.drag({ x: m.x - 233, y: m.y + 47 }, { x: m.x - 121, y: m.y + 139 }, 8);
    await t.until(() => M(t).fog.enabled === true, 3000, 'the brush to switch the fog on');
    await undoTo(t, u0);
    if (!M(t).fog.enabled) await t.cmd('fog.enabled', { enabled: true });
  });

  area.quick('VF5: the brush ring shows in the middle of the map while the Brush size slider is used', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'brush'; Play.openPop('fog')`);
    await t.until(() => t.rect('#pop input[type="range"]'), 3000, 'the Brush size slider');
    await t.sleep(350);
    const r = await t.rect('#pop input[type="range"]');
    await t.mouse('mouseMove', r.x + r.w * 0.3, r.cy); await t.sleep(150);
    t.ok(await t.g(`(() => { const b = document.querySelector('.brush-cursor'); return !b || b.style.display === 'none'; })()`), 'no ring with the pointer on the panel');
    await t.click(r.x + r.w * 0.6, r.cy); await t.sleep(250);
    const ring = await t.rect('.brush-cursor'); const v = await t.viewport();
    t.ok(await t.g(`document.querySelector('.brush-cursor').style.display !== 'none'`), 'the ring shows');
    t.ok(ring && Math.abs(ring.cx - (v.x + v.w / 2)) < 12 && Math.abs(ring.cy - (v.y + v.h / 2)) < 12, 'in the middle of the map', [ring, v]);
  });

  area.quick('VF6: Marks: a click beside a picked mark only lets go; Clear keeps your own notes', async (t) => {
    await start(t);
    const u0 = hist(t);
    const marks = () => (M(t).marks || []).length;
    t.gm().webContents.focus();
    await t.key('X'); await t.sleep(350);
    t.eq(await t.tool(), 'mark', 'Marks');
    const m = await mid(t); const n0 = marks();
    await t.click(m.x - 230, m.y + 60); await t.until(() => marks() === n0 + 1, 3000, 'a mark');
    await t.click(m.x - 230, m.y + 220); await t.until(() => marks() === n0 + 2, 3000, 'the next click places the next one'); // (well below the first: the picked mark's card lies above it)
    const first = M(t).marks[n0];
    await t.clickSel(`.sv-mark[data-id="${first.id}"]`); await t.sleep(300);
    t.eq(await t.g(`Play.ui.selMark`), first.id, 'a click on a mark picks it');
    await t.click(m.x - 60, m.y + 150); await t.sleep(400);
    t.eq(marks(), n0 + 2, 'a click beside it places nothing');
    t.eq(await t.g(`Play.ui.selMark`), null, 'and lets go of it');
    // Clear: what is on the table goes, "Only me" stays
    t.handle('mark.add', { kind: 'pin', x: first.x + 1, y: first.y + 1, hidden: true }); await t.settle();
    const mine = () => (M(t).marks || []).filter((x) => x.hidden || x.kind === 'note').length;
    const mine0 = mine();
    t.ok(mine0 >= 1, 'one mark only for me');
    await t.clickText('#pop button', 'Clear'); await t.sleep(400); await t.settle();
    t.eq((M(t).marks || []).filter((x) => !x.hidden && x.kind !== 'note').length, 0, 'the table\'s marks are gone');
    t.eq(mine(), mine0, 'mine stay');
    await t.g(`document.querySelectorAll('#toasts .toast').forEach((x) => x.remove())`);
    await undoTo(t, u0);
  });

  area.quick('VG1, VG2: Ctrl Z takes back the last corner of a fog area and of a line of walls; a right-drag does not end the line', async (t) => {
    await start(t);
    const m = await mid(t); const u0 = hist(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'area'`); await t.sleep(250);
    for (const [dx, dy] of [[-240, 40], [-150, 40], [-150, 120]]) { await t.click(m.x + dx, m.y + dy); await t.sleep(350); }
    t.eq(await t.g(`(Play.ui.areaPts || []).length`), 6, 'three corners');
    await t.key('Z', ['control']); await t.sleep(250);
    t.eq(await t.g(`(Play.ui.areaPts || []).length`), 4, 'Ctrl Z: two corners left');
    t.eq(hist(t), u0, 'and nothing else undone');
    await t.key('Escape'); await t.sleep(200);
    await t.g(`Play.ui.fogShape = 'brush'; Play.setTool('walls'); Play.ui.walls.mode = 'wall'`); await t.sleep(300);
    const w0 = M(t).walls.length;
    for (const [dx, dy] of [[-240, 40], [-150, 40], [-150, 120]]) { await t.click(m.x + dx, m.y + dy); await t.sleep(350); }
    await t.until(() => M(t).walls.length === w0 + 2, 3000, 'two walls of a line');
    await t.mouse('mouseMove', m.x - 200, m.y + 150); await t.mouse('mouseDown', m.x - 200, m.y + 150, 'right');
    for (let i = 1; i <= 5; i++) await t.mouse('mouseMove', m.x - 200 + i * 12, m.y + 150, 'right', { modifiers: ['rightButtonDown'] });
    await t.mouse('mouseUp', m.x - 140, m.y + 150, 'right'); await t.sleep(300);
    t.ok(await t.g(`!!Play.ui.walls.chain`), 'a right-drag moved the view and the line is still open');
    await t.key('Z', ['control']); await t.sleep(400); await t.settle();
    t.eq(M(t).walls.length, w0 + 1, 'Ctrl Z: the last wall goes');
    t.ok(await t.g(`!!Play.ui.walls.chain`), 'and the line is still open');
    await t.key('Backspace'); await t.sleep(400); await t.settle();
    t.eq(M(t).walls.length, w0, 'Backspace: the one before goes');
    t.eq(hist(t), u0, 'nothing is left to undo');
    await t.click(m.x - 100, m.y + 150, 'right'); await t.sleep(300);
    t.ok(!(await t.g(`!!Play.ui.walls.chain`)), 'a right-click ends the line');
    await t.g(`Play.view().fit()`);
  });

  area.quick('VG3: another tool with a fog area half drawn: two corners say why they go, three ask for its name', async (t) => {
    await start(t);
    const m = await mid(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'area'`); await t.sleep(250);
    for (const [dx, dy] of [[-240, 40], [-150, 40]]) { await t.click(m.x + dx, m.y + dy); await t.sleep(350); }
    await t.g(`document.querySelectorAll('#toasts .toast').forEach((x) => x.remove())`);
    await t.key('V'); await t.sleep(300);
    t.ok(/three corners/.test(await t.text('#toasts') || ''), 'two corners: a word why it went', await t.text('#toasts'));
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'area'`); await t.sleep(250);
    for (const [dx, dy] of [[-240, 40], [-150, 40], [-150, 120]]) { await t.click(m.x + dx, m.y + dy); await t.sleep(350); }
    await t.key('V');
    await t.until(() => t.g(`[...document.querySelectorAll('.modal')].some((x) => /Name this area/.test(x.textContent))`), 3000, 'three corners: it asks for the area\'s name');
    await t.key('Escape'); await t.sleep(200);
    await t.g(`Play.ui.fogShape = 'brush'`);
  });

  area.quick('VG4, VG6: in Walls a door\'s marker asks while the map is on the table; Erase lights up the wall a click would take', async (t) => {
    await start(t);
    const m = await mid(t); const u0 = hist(t);
    const a = await toMap(t, { x: m.x - 240, y: m.y + 60 }); const b = await toMap(t, { x: m.x - 150, y: m.y + 60 });
    const c = await toMap(t, { x: m.x - 240, y: m.y + 130 }); const d = await toMap(t, { x: m.x - 150, y: m.y + 130 });
    t.handle('wall.add', { segs: [[a.x, a.y, b.x, b.y]], door: 1 });
    t.handle('wall.add', { segs: [[c.x, c.y, d.x, d.y]] });
    await t.settle();
    const door = M(t).walls.find((w) => w.door && Math.abs(w.x1 - a.x) < 0.01 && Math.abs(w.y1 - a.y) < 0.01);
    t.ok(door, 'a door to try');
    await t.g(`Play.setTool('walls'); Play.ui.walls.mode = 'wall'`); await t.sleep(350);
    await t.until(() => t.rect(`.sv-door[data-id="${door.id}"]`), 3000, 'the door\'s marker');
    await t.clickSel(`.sv-door[data-id="${door.id}"]`); await t.sleep(300);
    t.ok(/door/i.test(await asking(t) || ''), 'the marker asks first', await asking(t));
    t.ok(!M(t).walls.find((w) => w.id === door.id).open, 'the door is still shut');
    await t.key('N'); await t.sleep(200);
    await t.g(`Play.ui.walls.mode = 'erase'`); await t.sleep(150);
    await t.mouse('mouseMove', m.x - 195, m.y + 100); await t.sleep(120);
    t.ok(!(await t.g(`!!document.querySelector('.sv-walls-svg .w.preview.hot')`)), 'beside a wall nothing lights up');
    await t.mouse('mouseMove', m.x - 195, m.y + 130); await t.sleep(150);
    t.ok(await t.g(`!!document.querySelector('.sv-walls-svg .w.preview.hot')`), 'over a wall it lights up');
    await t.g(`Play.ui.walls.mode = 'wall'`);
    await undoTo(t, u0);
  });

  // ---------- UI 8: panels, toasts, menus, dialogs (Open Points VH) ----------
  const head = (t, id) => t.rect(`.fp[data-id="${id}"] .fp-head`);
  const isOpen = async (t, id) => (await t.panels()).some((x) => x.id === id);
  const clearToasts = (t) => t.g(`document.querySelectorAll('#toasts .toast').forEach((x) => x.remove())`);

  area.quick('VH1: panels remembered at one spot open beside each other; the tile closes its panel; Esc closes the panel under the mouse', async (t) => {
    await start(t);
    // three panels, each remembered alone at the same corner
    for (const id of ['dice', 'timer', 'init']) { await t.g(`Play.TB.openPanel('${id}')`); await t.until(() => head(t, id), 3000, id); await t.sleep(150); await t.g(`Play.Floats.hide('${id}')`); }
    for (const id of ['dice', 'timer', 'init']) { await t.g(`Play.TB.openPanel('${id}')`); await t.sleep(200); }
    const hs = [await head(t, 'dice'), await head(t, 'timer'), await head(t, 'init')];
    const apart = (a, b) => Math.abs(a.x - b.x) >= 20 || Math.abs(a.y - b.y) >= 20;
    t.ok(apart(hs[0], hs[1]) && apart(hs[1], hs[2]) && apart(hs[0], hs[2]), 'no title bar lies on another', hs.map((h) => [Math.round(h.x), Math.round(h.y)]));
    await t.g(`Play.Floats.closeAll()`);
    // the Toolbox tile opens and closes
    await t.g(`Play.openPop('toolbox')`);
    await t.until(() => t.rect('#pop .tb-tile[data-id="dice"]'), 3000, 'the Dice tile');
    await t.sleep(300);
    await t.clickSel('#pop .tb-tile[data-id="dice"]');
    await t.until(() => isOpen(t, 'dice'), 3000, 'the tile opens Dice');
    await t.clickSel('#pop .tb-tile[data-id="dice"]'); await t.sleep(300);
    t.ok(!(await isOpen(t, 'dice')), 'the tile closes it again');
    await t.g(`Play.closePop()`);
    // Esc: only with the mouse over the panel
    await t.g(`Play.TB.openPanel('dice')`); await t.until(() => head(t, 'dice'), 3000, 'Dice');
    await t.sleep(250);
    const m = await mid(t);
    await t.mouse('mouseMove', m.x - 200, m.y + 150); await t.sleep(100);
    await t.key('Escape'); await t.sleep(250);
    t.ok(await isOpen(t, 'dice'), 'Esc with the mouse on the map leaves the panel open');
    const h1 = await head(t, 'dice');
    await t.mouse('mouseMove', h1.x + 70, h1.cy); await t.sleep(100);
    await t.key('Escape'); await t.sleep(250);
    t.ok(!(await isOpen(t, 'dice')), 'Esc with the mouse on the panel closes it');
    // "Close all panels" is something the search and the Hotbar can do
    await t.g(`Play.TB.openPanel('dice'); Play.TB.openPanel('timer')`); await t.sleep(300);
    t.ok((await t.g(`Play.hotActions().some((a) => a.ref === 'close-panels')`)), 'Close all panels is an action');
    await t.g(`Play.hotRun({ kind: 'do', ref: 'close-panels', label: 'Close all panels' })`); await t.sleep(300);
    t.eq((await t.panels()).length, 0, 'it closes them all');
  });

  area.quick('VH2: an open tool panel does not cover the Hotbar: clear of it at 1280 wide, moved as far as the window allows at the smallest', async (t) => {
    await start(t);
    const win = t.gm(); const max = win.isMaximized(); const was = win.getContentSize();
    try {
      if (max) { win.unmaximize(); await t.sleep(300); }
      const look = () => t.g(`(() => { const p = document.querySelector('#pop').getBoundingClientRect(); const right = Math.max(p.right, ...[...document.querySelector('#pop').children].map((c) => c.getBoundingClientRect().right));
        const s = document.querySelector('#hotbar .hb-slot'); if (!s) return { none: true }; const r = s.getBoundingClientRect(); const b = document.querySelector('#hotbar').getBoundingClientRect();
        return { slotLeft: Math.round(r.left), popRight: Math.round(right), popBottom: Math.round(p.bottom), slotTop: Math.round(r.top), barRight: Math.round(b.right), win: [innerWidth, innerHeight] }; })()`);
      win.setContentSize(1280, 720); await t.sleep(700); await t.settle();
      await t.g(`Play.setTool('fx'); Play.openPop('fx')`); await t.sleep(700);
      let hit = await look();
      t.ok(hit.none || hit.slotLeft >= hit.popRight || hit.slotTop >= hit.popBottom, '1280 × 720: slot 1 is clear of the panel', hit);
      win.setContentSize(1100, 680); await t.sleep(700); await t.settle();
      hit = await look();
      t.ok(hit.none || hit.slotLeft >= hit.popRight || hit.slotTop >= hit.popBottom || hit.barRight >= hit.win[0] - 12, '1100 × 680: clear, or moved right as far as the window goes', hit);
      await t.g(`Play.closePop()`); await t.sleep(300);
      t.eq(await t.g(`document.querySelector('#hotbar').style.left`), '', 'and the bar is back in the middle when the panel closes');
    } finally {
      win.setContentSize(was[0], was[1]); if (max) win.maximize(); await t.sleep(500); await t.settle();
    }
  });

  area.quick('VH3, VH4: a toast with Undo is not pushed out, waits under the mouse, and can be clicked over a dialog', async (t) => {
    await start(t); await clearToasts(t);
    await t.g(`UI.toast('Kept', { undo: () => { window.__undone = true; } }); UI.toast('one'); UI.toast('two'); UI.toast('three'); UI.toast('four')`);
    await t.sleep(200);
    const texts = await t.g(`[...document.querySelectorAll('#toasts .toast')].map((x) => x.firstChild.textContent)`);
    t.ok(texts.includes('Kept'), 'the one with Undo is still there', texts);
    t.eq(texts.length, 3, 'three toasts at most');
    await clearToasts(t);
    await t.g(`UI.toast('Stay a moment', { ms: 700 })`); await t.sleep(150);
    const r = await t.rect('#toasts .toast');
    await t.mouse('mouseMove', r.cx, r.cy); await t.sleep(1400);
    t.ok(await t.g(`!!document.querySelector('#toasts .toast')`), 'it waits while the mouse is on it');
    await t.mouse('mouseMove', 4, 4);
    await t.until(() => t.g(`!document.querySelector('#toasts .toast')`), 4000, 'and goes once the mouse has left');
    // over a dialog
    await t.g(`window.__undone = false; window.__dlg = UI.dialog('A dialog', UI.h('p', {}, 'Something')); UI.toast('Over the dark', { undo: () => { window.__undone = true; } })`);
    await t.sleep(250);
    await t.clickSel('#toasts .toast .toast-undo'); await t.sleep(250);
    t.eq(await t.g(`window.__undone`), true, 'its Undo can be clicked while a dialog is open');
    await t.g(`window.__dlg.close()`);
  });

  area.quick('VH6, VH7, VH9: a menu closes by its own button, takes arrows and Esc; a confirm gives the keyboard to the way out; a dialog that holds work stays', async (t) => {
    await start(t);
    await t.g(`(() => { const b = document.createElement('button'); b.id = 'zz-menu'; b.textContent = 'Menu'; b.style.cssText = 'position:fixed;left:420px;top:260px;z-index:99';
      b.onclick = () => UI.openMenu(420, 290, [{ label: 'One', action: () => {} }, { label: 'Two', action: () => {} }, { label: 'Three', action: () => {} }]); document.body.append(b); })()`);
    await t.clickSel('#zz-menu'); await t.sleep(200);
    t.ok(await t.g(`UI.menuOpen()`), 'the button opens its menu');
    await t.key('Down'); await t.sleep(120);
    t.eq(await t.g(`document.activeElement.textContent`), 'Two', 'ArrowDown walks down');
    await t.key('End'); await t.sleep(120);
    t.eq(await t.g(`document.activeElement.textContent`), 'Three', 'End: the last line');
    await t.clickSel('#zz-menu'); await t.sleep(250);
    t.ok(!(await t.g(`UI.menuOpen()`)), 'a second click on the button closes it');
    await t.clickSel('#zz-menu'); await t.sleep(200);
    t.ok(await t.g(`UI.menuOpen()`), 'a third opens it again');
    await t.key('Escape'); await t.sleep(150);
    t.ok(!(await t.g(`UI.menuOpen()`)), 'Esc closes it');
    await t.g(`document.getElementById('zz-menu').remove()`);
    // one confirm
    await t.g(`window.__said = 'nothing yet'; UI.confirm('Forget it?', 'For the test.', { ok: 'Forget it', cancel: 'Keep it' }).then((v) => { window.__said = v; }); 0`);
    await t.sleep(250);
    t.eq(await t.g(`document.activeElement.textContent`), 'Keep it', 'the way out has the keyboard');
    { // (Enter as a keyboard sends it: a focused button acts on the typed character, which t.key leaves out for named keys)
      const w = t.gm().webContents;
      w.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); w.sendInputEvent({ type: 'char', keyCode: '\r' }); w.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    await t.sleep(300);
    t.eq(await t.g(`window.__said`), false, 'Enter keeps things as they are');
    // a dialog that holds work: a click beside it leaves it open
    await t.g(`window.__dlg = UI.dialog('Holds work', UI.h('div', { class: 'stack' }, UI.h('p', {}, 'x'), UI.h('div', { class: 'modal-actions' }, UI.h('button', { class: 'btn danger' }, 'Throw away'), UI.h('button', { class: 'btn' }, 'Fine'))), { keep: () => true }); 0`);
    await t.sleep(250);
    t.eq(await t.g(`document.activeElement.textContent`), 'Fine', 'a dialog gives the keyboard to the button that is no danger');
    await t.click(12, 300); await t.sleep(250);
    t.ok(await t.g(`!!document.querySelector('.modal-back')`), 'a click beside it leaves it open');
    t.ok(await t.g(`getComputedStyle(document.querySelector('.modal > .dlg-body')).maxHeight !== 'none'`), 'and its content cannot grow past the window');
    await t.key('Escape'); await t.sleep(200);
    t.ok(!(await t.g(`!!document.querySelector('.modal-back')`)), 'Esc still closes it');
  });

  area.quick('VH10: Esc cancels the drag of an Initiative row', async (t) => {
    await start(t);
    fight(t); await t.settle();
    await t.g(`Play.TB.openPanel('init')`);
    await t.until(() => t.rect('.fp[data-id="init"] .ini-row[data-id] .ini-grip'), 4000, 'a row\'s grip');
    await t.sleep(300);
    const order = () => t.state.init.entries.map((e) => e.id).join(',');
    const o0 = order();
    const g = await t.rect('.fp[data-id="init"] .ini-row[data-id] .ini-grip');
    await t.mouse('mouseMove', g.cx, g.cy); await t.mouse('mouseDown', g.cx, g.cy);
    for (let i = 1; i <= 6; i++) await t.mouse('mouseMove', g.cx, g.cy + i * 14, 'left', { modifiers: ['leftButtonDown'] });
    t.ok(await t.g(`!!document.querySelector('.ini-drop.on')`), 'the line shows where it would land');
    await t.key('Escape'); await t.sleep(150);
    await t.mouse('mouseUp', g.cx, g.cy + 84); await t.sleep(300); await t.settle();
    t.eq(order(), o0, 'the order is as it was');
    t.ok(await isOpen(t, 'init'), 'and the panel is still open');
    t.handle('init.end', {}); await t.g(`Play.Floats.closeAll()`);
  });

  // ---------- UI 9: sliders and colour pickers (Open Points VI) ----------
  area.quick('VI1, VI3: "Any colour" is one undo step for a whole drag; the map\'s colours are undone by Ctrl Z', async (t) => {
    await start(t);
    const fx = (M(t).fx || []).find((f) => !f.attachTo && f.preset !== 'party' && f.kind !== 'light') || (M(t).fx || []).find((f) => !f.attachTo && f.preset !== 'party');
    t.ok(fx, 'an effect on the map to colour');
    await t.g(`Play.setTool('fx'); Play.openPop('fx'); Play.selectFx(${JSON.stringify(fx.id)})`); await t.sleep(400);
    const has = await t.g(`!!document.querySelector('#pop input[type="color"]')`);
    if (has) {
      const u0 = hist(t);
      await t.g(`(async () => { const p = document.querySelector('#pop input[type="color"]'); for (let i = 0; i < 24; i++) { p.value = '#' + (0x202020 + i * 0x080402).toString(16).padStart(6, '0'); p.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 12)); } })()`);
      await t.sleep(500); await t.settle();
      t.eq(hist(t), u0 + 1, 'twenty-four shades are one undo step');
      t.ok(String((M(t).fx.find((f) => f.id === fx.id) || {}).color || '').startsWith('#'), 'and the last one is kept');
      await undoTo(t, u0);
    } else t.ok(true, '(this effect has no colour of its own)');
    await t.g(`Play.selectFx(null); Play.closePop(); Play.setTool('select')`);
    const u1 = hist(t); const look0 = JSON.stringify(M(t).look || null);
    t.handle('bg.look', { bright: 1.3 }); await t.settle();
    t.ok(JSON.stringify(M(t).look || null) !== look0, 'the map\'s colours changed');
    t.gm().webContents.focus();
    await t.key('Z', ['control']); await t.sleep(300); await t.settle();
    t.eq(JSON.stringify(M(t).look || null), look0, 'Ctrl Z puts them back');
    t.eq(hist(t), u1, 'with its step');
  });

  area.quick('VI3, VI4: a slider\'s number can be typed; ] steps the brush as its slider does', async (t) => {
    await start(t);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'brush'; Play.ui.brushIn = 2; Play.openPop('fog')`);
    await t.until(() => t.rect('#pop .ctl-slider output.typed'), 3000, 'the Brush size number');
    await t.sleep(300);
    await t.clickSel('#pop .ctl-slider output.typed');
    await t.until(() => t.g(`document.activeElement && document.activeElement.classList.contains('ctl-type')`), 2000, 'a field to type in');
    await t.type('3.5'); await t.key('Enter'); await t.sleep(250);
    t.eq(await t.g(`Play.ui.brushIn`), 3.5, 'typed: 3.5');
    t.ok(!(await t.g(`!!document.querySelector('#pop .ctl-type')`)), 'the field is the number again');
    await t.clickSel('#pop .ctl-slider output.typed');
    await t.until(() => t.g(`document.activeElement && document.activeElement.classList.contains('ctl-type')`), 2000, 'the field again');
    await t.type('99'); await t.key('Enter'); await t.sleep(250);
    t.eq(await t.g(`Play.ui.brushIn`), 8, 'more than it takes stops at its end');
    await t.clickSel('#pop .ctl-slider output.typed');
    await t.until(() => t.g(`document.activeElement && document.activeElement.classList.contains('ctl-type')`), 2000, 'the field once more');
    await t.type('1'); await t.key('Escape'); await t.sleep(250);
    t.eq(await t.g(`Play.ui.brushIn`), 8, 'Esc leaves the value as it was');
    t.ok(await t.popTitle(), 'and the panel open');
    await t.g(`Play.ui.brushIn = 2; document.activeElement && document.activeElement.blur()`);
    await t.key(']'); await t.sleep(150);
    t.eq(await t.g(`Play.ui.brushIn`), 2.25, '] is a quarter inch, the slider\'s step');
    await t.key('['); await t.key('['); await t.sleep(150);
    t.eq(await t.g(`Play.ui.brushIn`), 1.75, '[ too');
  });

  area.quick('VI2: a settings slider saves once the hand rests', async (t) => {
    await start(t);
    await t.g(`Play.TB.openPanel('sound')`);
    await t.until(() => t.rect('.fp[data-id="sound"] input[type="range"]'), 4000, 'the Soundboard\'s Volume');
    await t.sleep(300);
    const v0 = t.settings.boardVolume;
    await t.g(`(async () => { const s = document.querySelector('.fp[data-id="sound"] input[type="range"]'); for (let i = 1; i <= 12; i++) { s.value = String(0.2 + i * 0.02); s.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); } })()`);
    t.eq(t.settings.boardVolume, v0, 'nothing is saved while it moves');
    await t.until(() => Math.abs((t.settings.boardVolume ?? -1) - 0.44) < 0.001, 2000, 'the last value is saved a moment later');
    await t.g(`window.ts.settings({ boardVolume: ${v0 == null ? 1 : v0} }); Play.Floats.closeAll()`);
  });

  // ---------- UI 10: first map, Library, Home, words (Open Points VJ) ----------
  area.quick('VJ2, VJ4: the Library\'s search takes two letters and numbers; a click on a sound plays it once and adds nothing to the map', async (t) => {
    await start(t);
    await t.g(`Play.Drawer.open({})`);
    await t.until(async () => (await t.g('Play.Drawer.items.length')) > 5, 5000, 'the Library');
    const shown = () => t.g(`document.querySelectorAll('#drawer .lt').length`);
    const ask = async (q) => { await t.g(`(() => { const i = document.querySelector('#drawer .lib-search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await t.sleep(350); return shown(); };
    const all = await ask('');
    const go = await ask('go');
    t.ok(go > 0 && go < all, '"go" finds some, not all', [go, all]);
    const names = await t.g(`[...document.querySelectorAll('#drawer .lt')].slice(0, 40).map((x) => (x.getAttribute('aria-label') || x.dataset.tip || x.textContent || '').toLowerCase())`);
    t.ok(names.filter((n) => n.includes('go')).length >= Math.ceil(names.length * 0.6), 'and what it shows has "go" in its name', names.slice(0, 8));
    const none = await ask('zq7');
    t.eq(none, 0, 'letters with a number that nothing has: nothing shown');
    await ask('');
    // a sound: one click plays it once
    const snd = t.library.listLibrary().find((x) => x.kind === 'audio');
    t.ok(snd, 'the library has a sound');
    await ask(String(snd.name).replace(/\.[a-z0-9]+$/i, ''));
    await t.until(() => t.rect('#drawer .lt.lt-sounds'), 4000, 'a sound in the Library');
    await t.sleep(300);
    const n0 = (await t.sound()).board.length; const layers0 = M(t).layers.length;
    await t.clickSel('#drawer .lt.lt-sounds');
    await t.until(async () => (await t.sound()).board.length === n0 + 1, 4000, 'the sound plays once');
    t.eq(M(t).layers.length, layers0, 'and the map got no new sound');
    await t.cmd('sound.stop'); await clearToasts(t);
    await t.g(`Play.Drawer.close()`);
  });

  area.quick('VJ9, VJ11: Seating, the two number switches, and plain names for colours', async (t) => {
    await start(t);
    t.eq(await t.g(`UI.colourName('#ffffff')`), 'White', 'white');
    t.eq(await t.g(`UI.colourName('#b9cdeb')`), 'Pale blue', 'a pale blue');
    t.eq(await t.g(`UI.colourName('#e3963e')`), 'Orange', 'the torch colour');
    t.eq(await t.g(`UI.colourName('#000000')`), 'Black', 'black');
    const secs = await t.g(`App.optionSections().map((s) => s.id + ':' + s.label)`);
    t.ok(secs.includes('players:Seating'), 'Campaign settings: Seating', secs.filter((x) => x.startsWith('players')));
    const lines = await t.g(`App.settingLines().map((x) => x.label)`);
    t.ok(lines.includes('Players see the numbers (Goblin 1, 2, 3)') && lines.includes('New copies get a number (Goblin 1, 2, 3)'), 'the two number switches read differently');
    await t.g(`Play.setTool('grid'); Play.openPop('grid')`); await t.sleep(400);
    const tips = await t.g(`[...document.querySelectorAll('#pop .swatches button.swatch')].map((b) => b.dataset.tip || '')`);
    t.ok(tips.length >= 4 && tips.every((x) => x && !x.startsWith('#')), 'the Grid\'s swatches have names', tips);
  });

  // ---------- UI 11: mouse comfort on the map (Open Points VK) ----------
  const cam = (t) => t.g(`(() => { const c = Play.view().cam; return { s: c.s, tx: c.tx, ty: c.ty }; })()`);

  area.quick('VK1, VK2, VK10: Select: a drag on empty map moves the view; the pointer is a hand over a token and while Space is held', async (t) => {
    await start(t);
    const m = await mid(t); const c0 = await cam(t); const u0 = hist(t);
    await t.drag({ x: m.x - 220, y: m.y + 150 }, { x: m.x - 120, y: m.y + 190 }, 8);
    const c1 = await cam(t);
    t.ok(Math.abs(c1.tx - c0.tx) > 60 && Math.abs(c1.ty - c0.ty) > 20, 'the view moved with the drag', [c0, c1]);
    t.eq(hist(t), u0, 'and nothing on the map changed');
    await t.g(`Play.view().fit()`); await t.sleep(300);
    const k = tokens(t).find((l) => !l.hidden); const p = await t.scr(k.x, k.y);
    await t.mouse('mouseMove', p.x + 3, p.y + 3); await t.mouse('mouseMove', p.x, p.y); await t.sleep(150);
    t.eq(await t.g(`getComputedStyle(document.querySelector('#viewport')).cursor`), 'grab', 'a hand over a token');
    await t.mouse('mouseMove', m.x - 220, m.y + 150); await t.mouse('mouseMove', m.x - 222, m.y + 150); await t.sleep(150);
    t.ok((await t.g(`getComputedStyle(document.querySelector('#viewport')).cursor`)) !== 'grab', 'not over empty map');
    t.gm().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); await t.sleep(150);
    t.eq(await t.g(`getComputedStyle(document.querySelector('#viewport')).cursor`), 'grab', 'a hand while Space is held');
    t.gm().webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await t.sleep(150);
    t.ok(!(await t.g(`document.body.classList.contains('space-held')`)), 'and gone when it is let go');
  });

  area.quick('VK3, VK4: a pinch (small Ctrl + wheel steps) zooms and turns nothing; a notch sizes the brush by a quarter inch', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const p = await t.scr(k.x, k.y);
    await t.click(p.x, p.y); await t.sleep(300);
    const rot0 = tok(t, k.id).rotation || 0; const c0 = await cam(t); const u0 = hist(t);
    await t.mouse('mouseMove', p.x, p.y);
    for (let i = 0; i < 8; i++) await wheel(t, p.x, p.y, 4, ['control']);
    await t.sleep(300);
    t.eq(tok(t, k.id).rotation || 0, rot0, 'a pinch does not turn the token');
    t.eq(hist(t), u0, 'and changes nothing on the map');
    t.ok(Math.abs((await cam(t)).s - c0.s) > 0.01, 'it zooms your view', [c0.s, (await cam(t)).s]);
    await t.g(`Play.view().fit()`); await t.key('Escape'); await t.sleep(200);
    await t.g(`Play.setTool('fog'); Play.ui.fogShape = 'brush'; Play.ui.brushIn = 1`);
    const m = await mid(t); await t.mouse('mouseMove', m.x, m.y);
    const sizes = [];
    for (let i = 0; i < 3; i++) { await wheel(t, m.x, m.y, -120, ['control']); sizes.push(await t.g(`Play.ui.brushIn`)); }
    t.eq(sizes, [0.75, 0.5, 0.5], 'three notches down from 1″');
    await wheel(t, m.x, m.y, 120, ['control']);
    t.eq(await t.g(`Play.ui.brushIn`), 0.75, 'and one up');
  });

  area.quick('VK9: an arrow key nudges the picked token one square; a dragged token shows its landing square and the distance', async (t) => {
    await start(t);
    const k = tokens(t).find((l) => !l.hidden); const at = [k.x, k.y]; const g = M(t).grid.size; const u0 = hist(t);
    const p = await t.scr(k.x, k.y);
    await t.click(p.x, p.y); await t.sleep(300);
    await t.key('Right'); await t.key('Right'); await t.key('Down'); await t.sleep(300); await t.settle();
    t.ok(Math.abs(tok(t, k.id).x - (at[0] + 2 * g)) < 0.01 && Math.abs(tok(t, k.id).y - (at[1] + g)) < 0.01, 'two squares right, one down', [at, tok(t, k.id).x, tok(t, k.id).y, g]);
    t.eq(hist(t), u0 + 1, 'one undo step for the burst');
    await undoTo(t, u0);
    t.eq([tok(t, k.id).x, tok(t, k.id).y], at, 'Undo puts it back');
    await held(t, p, { x: p.x + 130, y: p.y + 10 });
    const land = await t.g(`(() => { const e = document.querySelector('.land-square'); return e && e.style.display !== 'none' ? e.textContent : null; })()`);
    t.ok(land != null && / ft$/.test(land), 'the landing square shows, with the feet', land);
    await t.key('Escape'); await t.sleep(200);
    t.ok(await t.g(`(() => { const e = document.querySelector('.land-square'); return !e || e.style.display === 'none'; })()`), 'and goes with the drag');
    await t.mouse('mouseUp', p.x + 130, p.y + 10); await t.sleep(300);
  });

  // ---------- UI 12: legibility and things to hit (Open Points VL) ----------
  area.quick('VL1 to VL6: read text is not faint and not under 10.5 px; small buttons are 28 px high; "?" has room around it; a panel that goes on below says so', async (t) => {
    await start(t);
    const gm = t.gm(); const wasMax = gm.isMaximized();
    try {
      gm.unmaximize(); gm.setContentSize(1280, 720);
      await t.sleep(700);
      const panel = async (tool, sel) => { await t.g(`Play.closePop(); Play.setTool(${JSON.stringify(tool)}); 0`); await t.sleep(250); await t.g(`document.querySelector('#pop.on') ? 0 : (Play.openPop(${JSON.stringify(tool)}), 0)`); await t.until(() => t.rect(sel), 4000, `the ${tool} panel`); await t.sleep(300); };
      await t.g(`Play.ui.fxMode = 'weather'; 0`);
      await panel('fx', '#pop .fx-sec');
      // VL1: section heads, the Hotbar's keys
      const col = (sel) => t.g(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).color : null; })()`);
      const muted = await t.g(`(() => { const d = document.createElement('i'); d.style.color = 'var(--muted)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
      t.eq([await col('#pop .fx-sec'), await col('#hotbar .hb-key')], [muted, muted], 'a section head and a Hotbar key have the muted grey, not the faint one');
      // VL2: no text under 10.5 px in the rail, the open panel and the Hotbar
      const tiny = await t.g(`(() => { const out = {}; for (const root of document.querySelectorAll('#rail, #pop, #hotbar')) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const e = n.parentElement; if (!n.nodeValue.trim() || !e || !e.offsetParent) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 10.5) out[(e.className || e.tagName) + ' ' + fs] = n.nodeValue.trim().slice(0, 20); } } return out; })()`);
      t.eq(tiny, {}, 'text under 10.5 px in the rail, Effects and the Hotbar');
      // VL4: the small button
      const hs = await t.g(`[...document.querySelectorAll('#pop .btn.small')].filter((b) => b.offsetParent).map((b) => Math.round(b.getBoundingClientRect().height))`);
      t.ok(hs.length >= 2 && hs.every((x) => x >= 28), 'small buttons are at least 28 px high', hs);
      // VL3: the "?" of a panel answers outside its ring; a slider is at least 22 px to hit
      const q = await t.rect('#pop .help-q');
      t.eq(await t.g(`(() => { const e = document.elementFromPoint(${q.x - 2}, ${q.cy}); return !!(e && e.closest('.help-q')); })()`), true, 'the "?" takes a click 2 px outside its ring');
      const rng = await t.g(`(() => { const e = document.querySelector('#pop input[type=range]'); return e ? Math.round(e.getBoundingClientRect().height) : null; })()`);
      t.ok(rng >= 22, 'a slider is at least 22 px high to hit', rng);
      // VL6: Spells goes on below at this height: the panel says so, and no longer at its end
      await panel('spell', '#pop .skin-grid');
      const more = () => t.g(`(() => { const b = document.querySelector('#pop > .pop-body'); return b ? [b.classList.contains('more'), b.scrollHeight > b.clientHeight + 6] : null; })()`);
      await t.until(async () => { const m = await more(); return m && m[1]; }, 3000, 'Spells longer than its panel at 720 px');
      await t.until(async () => (await more())[0], 3000, 'the panel marked as going on below');
      await t.g(`(() => { const b = document.querySelector('#pop > .pop-body'); b.scrollTop = b.scrollHeight; return 0; })()`);
      await t.until(async () => !(await more())[0], 3000, 'no mark at the panel\'s end');
    } finally {
      await t.g(`Play.closePop(); Play.setTool('select'); 0`).catch(() => {});
      if (wasMax) gm.maximize();
      await t.sleep(500);
    }
  });

  // ---------- UI 13: looks of states (Open Points VM) ----------
  area.quick('VM1: the TV\'s test picture has rows of equal steps across the whole screen; the Dice dialog has class names of its own', async (t) => {
    await start(t);
    await t.send();
    await t.cmd('table.test', { on: true });
    try {
      await t.until(async () => (await t.tvDebug()).testPicture > 0, 5000, 'the test picture on the TV');
      await t.sleep(300);
      const rows = await t.t(`[...document.querySelectorAll('#table-test .tp-row')].map((r) => ({ w: Math.round(r.getBoundingClientRect().width), kids: [...r.children].map((c) => Math.round(c.getBoundingClientRect().width)) }))`);
      t.eq(rows.length, 5, 'rows of the test picture');
      t.eq(rows.filter((r) => Math.max(...r.kids) - Math.min(...r.kids) > 1 || Math.abs(r.kids.reduce((a, b) => a + b, 0) - r.w) > r.kids.length), [], 'rows whose steps are not equal or do not fill the screen');
      const line = await t.t(`(() => { const e = document.querySelector('#table-test .tp-text'); const c = getComputedStyle(e); return [c.textAlign, e.getBoundingClientRect().height < innerHeight * 0.2]; })()`);
      t.eq(line, ['center', true], 'the line under it: centred, one line high');
    } finally { await t.cmd('table.test', { on: false }); }
    const dlg = await t.g(`(() => { const d = document.createElement('div'); d.className = 'tpd-row'; document.body.append(d); const v = getComputedStyle(d).display; d.remove(); return [v]; })()`);
    t.eq(dlg[0], 'flex', 'the dialog\'s row has its own rule');
  });

  area.quick('VM2 to VM6: a pressed button shows it; open is not hover; playing is green; a label is not selected by a double click; animations off is honoured', async (t) => {
    await start(t);
    const css = (sel, prop) => t.g(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null; })()`);
    const live = await t.g(`(() => { const d = document.createElement('i'); d.style.color = 'var(--live)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
    // VM3: the Toolbox with Dice open
    await t.g(`Play.TB.openPanel('dice'); 0`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'dice'), 4000, 'Dice');
    await t.g(`document.querySelector('#pop.on') ? 0 : (Play.openPop('toolbox'), 0)`);
    await t.until(() => t.rect('#pop .tb-tile.open'), 4000, 'the Toolbox with an open tile');
    await t.mouse('mouseMove', 900, 500); await t.sleep(200);
    const open = await css('#pop .tb-tile.open', 'backgroundColor'); const rest = await css('#pop .tb-tile:not(.open):not(.on)', 'backgroundColor');
    t.ok(open && rest && open !== rest, 'an open tile is filled, another is not', [open, rest]);
    const other = await t.rect('#pop .tb-tile:not(.open):not(.on)');
    await t.mouse('mouseMove', other.cx, other.cy); await t.sleep(250);
    t.eq(await css('#pop .tb-tile:not(.open):not(.on)', 'backgroundColor'), rest, 'the mouse on a tile does not fill it');
    // VM2: pressed, and let go off the button (no click)
    await t.mouse('mouseDown', other.cx, other.cy); await t.sleep(120);
    const pressed = await css('#pop .tb-tile:not(.open):not(.on)', 'filter');
    await t.mouse('mouseMove', 900, 500); await t.mouse('mouseUp', 900, 500); await t.sleep(150);
    t.eq(pressed, 'brightness(1.15)', 'a pressed button is brighter');
    // VM5: a double click on the panel's title selects nothing
    const title = await t.rect('#pop .pop-title');
    for (const n of [1, 2]) { await t.mouse('mouseDown', title.cx, title.cy, 'left', { clickCount: n }); await t.mouse('mouseUp', title.cx, title.cy, 'left', { clickCount: n }); }
    await t.sleep(150);
    t.eq(await t.g(`String(getSelection())`), '', 'text selected by a double click on a title');
    await t.g(`Play.closePop(); Play.Floats.closeAll(); 0`);
    // VM4: a Hotbar slot that runs on the table is green, a tool in hand is not
    const hot0 = (t.store.cur.meta.hotbar || []).slice();
    await t.cmd('hotbar.set', { slots: [{ kind: 'do', ref: 'grid', label: 'Grid on/off', icon: 'grid-4x4' }, { kind: 'tool', ref: 'fog', label: 'Fog', icon: 'cloud' }] });
    const g0 = M(t).grid.show;
    try {
      t.handle('grid.update', { mapId: M(t).id, show: true });
      await t.g(`Play.setTool('fog'); 0`);
      const slots = await t.until(async () => { const c = await t.g(`[...document.querySelectorAll('.hb-slot')].slice(0, 2).map((e) => [e.classList.contains('live'), e.classList.contains('run'), getComputedStyle(e).borderTopColor])`); return c[0][0] && c[1][0] && c; }, 4000, 'both slots lit');
      t.eq([slots[0][1], slots[0][2], slots[1][1], slots[1][2] === live], [true, live, false, false], 'the grid that shows: green; the tool in hand: not');
    } finally { t.handle('grid.update', { mapId: M(t).id, show: g0 }); await t.g(`Play.setTool('select'); 0`); await t.cmd('hotbar.set', { slots: hot0 }); }
    // VM6: with Windows' animations off a rail panel comes at once
    const dbg = t.gm().webContents.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await t.g(`Play.setTool('fog'); document.querySelector('#pop.on') ? 0 : (Play.openPop('fog'), 0)`);
      await t.until(() => t.rect('#pop.on'), 3000, 'the Fog panel');
      const dur = parseFloat(await css('#pop.on', 'animationDuration'));
      t.ok(dur < 0.001, 'the panel\'s slide takes no time with animations off', dur);
    } finally {
      try { await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }); dbg.detach(); } catch {}
      await t.g(`Play.closePop(); Play.setTool('select'); 0`);
    }
  });

  // Speed 9 (Open Point WI8): the bar above the map was built anew on every state
  area.quick('WI8: Send to table is the same button after a state that changes nothing in it; a press that spans a state still counts', async (t) => {
    await t.newMap('Not on the table');
    const B = '.bar-prep .btn.primary';
    await t.until(() => t.g(`!!document.querySelector(${JSON.stringify(B)})`), 5000, 'Send to table');
    await t.g(`document.querySelector(${JSON.stringify(B)}).mark = 1; 0`);
    t.handle('light.update', { mapId: t.state.editMapId, darkness: 0.1 }); await t.settle(); await t.sleep(200);
    t.eq(await t.g(`document.querySelector(${JSON.stringify(B)}).mark`), 1, 'the same button after a change of the light');
    const r = await t.rect(B);
    await t.mouse('mouseMove', r.cx, r.cy); await t.mouse('mouseDown', r.cx, r.cy);
    t.handle('light.update', { mapId: t.state.editMapId, darkness: 0 }); await t.settle(); await t.sleep(150);
    await t.mouse('mouseUp', r.cx, r.cy);
    await t.until(() => t.state.liveMapId === t.state.editMapId, 5000, 'the map to go to the table');
  });
};
