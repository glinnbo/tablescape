// The hotbar: anything on a slot, used with 1 – 0
'use strict';

module.exports = (area) => {
  area.title('Hotbar');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const set = async (t, slots) => { const r = await t.cmd('hotbar.set', { slots }); await t.sleep(150); return r; };
  const saved = (t) => t.store.cur.meta.hotbar || [];
  const press = async (t, k) => { t.gm().webContents.focus(); await t.key(k); await t.sleep(150); await t.settle(); };
  const slotMenu = async (t, i) => {
    const r = await t.g(`(() => { const r = document.querySelectorAll('.hb-slot')[${i}].getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await t.click(r.x, r.y, 'right');
    if (!(await t.menu())) await t.g(`document.querySelectorAll('.hb-slot')[${i}].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${r.x}, clientY: ${r.y} }))`);
    return t.until(() => t.menu(), 3000, 'the slot menu');
  };

  area.quick('the hotbar shows ten slots with their keys', async (t) => {
    await set(t, []);
    t.eq(await t.count('.hb-slot'), 10, 'slots');
  });

  area.quick('tools on slots: the key picks the tool', async (t) => {
    await set(t, [{ kind: 'tool', ref: 'point:ping', label: 'Ping', icon: 'target' }, { kind: 'tool', ref: 'point:measure', label: 'Ruler', icon: 'ruler-measure' },
      { kind: 'tool', ref: 'walls', label: 'Walls', icon: 'wall' }, { kind: 'tool', ref: 'select', label: 'Select', icon: 'pointer' }]);
    t.eq(saved(t).slice(0, 4).map((x) => `${x.kind}:${x.ref}`), ['tool:point:ping', 'tool:point:measure', 'tool:walls', 'tool:select'], 'the saved slots');
    await press(t, '1'); t.eq([await t.tool(), await t.g('Play.ui.point.mode')], ['point', 'ping'], 'after 1');
    await press(t, '2'); t.eq([await t.tool(), await t.g('Play.ui.point.mode')], ['point', 'measure'], 'after 2');
    await press(t, '3'); t.eq(await t.tool(), 'walls', 'after 3');
    await press(t, '4'); t.eq(await t.tool(), 'select', 'after 4');
  });

  area.quick('actions on slots: Blackout, Mute, Grid and Next turn', async (t) => {
    await set(t, [{ kind: 'do', ref: 'blackout', label: 'Blackout', icon: 'screen-share-off' }, { kind: 'do', ref: 'quiet', label: 'Mute', icon: 'volume-off' }, { kind: 'do', ref: 'grid', label: 'Grid on/off', icon: 'grid-4x4' }]);
    await press(t, '1'); t.eq(t.state.blackout, true, 'blackout after 1');
    await press(t, '1'); t.eq(t.state.blackout, false, 'blackout after 1 again');
    await press(t, '2'); t.eq(!!t.state.quiet, true, 'mute after 2');
    await press(t, '2'); t.eq(!!t.state.quiet, false, 'mute after 2 again');
    const g0 = !!t.L().grid.show;
    await press(t, '3'); t.eq(!!t.L().grid.show, !g0, 'the grid after 3');
    await press(t, '3'); t.eq(!!t.L().grid.show, g0, 'the grid after 3 again');
  });

  area.quick('actions with a value: a countdown, a break and darkness', async (t) => {
    await set(t, [{ kind: 'do', ref: 'timer:90', label: 'Countdown 1:30', icon: 'hourglass' }, { kind: 'do', ref: 'break:5', label: 'Break 5 min', icon: 'coffee' }, { kind: 'do', ref: 'dark:60', label: 'Darkness 60 %', icon: 'moon' }]);
    await press(t, '1'); t.ok(t.state.timer && t.state.timer.total === 90, 'a 90 second countdown runs', t.state.timer);
    await press(t, '1'); t.ok(!t.state.timer, 'the same key stops it');
    await press(t, '2'); t.ok(!!t.state.brk, 'the break runs');
    await press(t, '2'); t.ok(!t.state.brk, 'the same key ends it');
    const d0 = t.L().light.darkness;
    await press(t, '3'); t.near(t.L().light.darkness, 0.6, 0.011, 'darkness after 3');
    t.handle('light.set', { mapId: t.L().id, patch: { darkness: d0 } });
  });

  area.quick('a panel on a slot opens and closes it', async (t) => {
    await set(t, [{ kind: 'panel', ref: 'timer', label: 'Countdown', icon: 'hourglass' }]);
    await press(t, '1');
    await t.until(async () => (await t.panels()).some((p) => p.id === 'timer'), 3000, 'the Countdown panel');
    await press(t, '1');
    await t.until(async () => !(await t.panels()).some((p) => p.id === 'timer'), 3000, 'the panel to close');
  });

  area.quick('a door on a slot opens and closes that door', async (t) => {
    const m = t.L();
    t.handle('wall.add', { mapId: m.id, segs: [[m.grid.size * 2, m.grid.size * 2, m.grid.size * 3, m.grid.size * 2]], door: 1 });
    const door = t.L().walls.find((w) => w.door);
    t.ok(door, 'a door on the map');
    await set(t, [{ kind: 'door', ref: { map: m.id, id: door.id }, label: 'Door', icon: 'door' }]);
    const open = () => !!t.L().walls.find((w) => w.id === door.id).open;
    const o0 = open();
    await press(t, '1'); t.eq(open(), !o0, 'the door after 1');
    await press(t, '1'); t.eq(open(), o0, 'the door after 1 again');
  });

  area.quick('right-click an empty slot: Add to slot … opens the list, the search finds Ruler and a click puts it there', async (t) => {
    await set(t, []);
    const menu = await slotMenu(t, 0);
    t.ok(menu.some((x) => /^Add to slot 1/.test(x)), 'the menu offers Add to slot 1', menu);
    await t.menuPick('Add to slot 1');
    await t.until(() => t.rect('.hot-pick'), 4000, 'the list');
    const groups = await t.until(async () => { const g = await t.g(`[...document.querySelectorAll('.hot-pick .dk-grp > summary')].map((x) => x.textContent.replace(/\\d+$/, '').trim())`); return g.length >= 5 && g; }, 5000, 'the groups of the list');
    for (const want of ['Tools', 'Map tools', 'Panels']) t.ok(groups.some((g) => g.startsWith(want)), `the list has ${want}`, groups);
    await t.g(`(() => { const q = document.querySelector('.hot-pick input'); q.value = 'ruler'; q.dispatchEvent(new Event('input')); })()`);
    await t.sleep(250);
    const found = await t.g(`[...document.querySelectorAll('.hot-pick .dk-item')].map((x) => x.textContent.trim())`);
    t.ok(found.length >= 1 && found.every((x) => /ruler/i.test(x)), 'the search narrows the list to Ruler', found);
    await t.clickSel('.hot-pick .dk-item');
    await t.until(() => saved(t)[0] && saved(t)[0].ref === 'point:measure', 3000, 'Ruler on slot 1');
    t.ok(!(await t.rect('.hot-pick')), 'the list closed');
  });

  area.quick('right-click a tool on the rail: Put on the hotbar takes the first free slot', async (t) => {
    await set(t, []);
    await t.rightClickSel('.rail-btn[data-id="fog"]');
    const menu = await t.until(() => t.menu(), 3000, 'the menu');
    t.has(menu, 'Put on the hotbar', 'the menu');
    await t.menuPick('Put on the hotbar');
    await t.until(() => saved(t)[0] && saved(t)[0].kind === 'tool' && saved(t)[0].ref === 'fog', 3000, 'Fog on slot 1');
  });

  area.quick('a slot whose thing is gone shows it and does nothing harmful', async (t) => {
    await set(t, [{ kind: 'door', ref: { map: t.L().id, id: 'no-such-door' }, label: 'Old door', icon: 'door' }, { kind: 'token', ref: { path: '/no/such/file.png' }, label: 'Gone', icon: 'user' }]);
    const cls = await t.g(`[...document.querySelectorAll('.hb-slot')].slice(0, 2).map((e) => e.className)`);
    t.ok(cls.every((c) => /missing/.test(c)), 'both slots are marked as missing', cls);
    await press(t, '1'); await press(t, '2');
  });

  // ---------- deep ----------
  area.deep('every single action can sit on a slot and runs without an error, twice', async (t) => {
    const all = await t.g('Play.hotActions()');
    t.ok(all.length >= 20, 'the actions the app knows', all.length);
    t.ok(all.every((a) => a.label && a.icon), 'each has a name and an icon', all.filter((a) => !a.label || !a.icon));
    // (Send to table and the pages are checked on their own)
    const list = all.filter((a) => !['send', 'page-next', 'page-prev'].includes(a.ref));
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    const ran = [];
    for (let i = 0; i < list.length; i += 10) {
      const part = list.slice(i, i + 10);
      await set(t, part);
      t.eq(saved(t).slice(0, part.length).map((x) => x && x.ref), part.map((x) => x.ref), 'the saved slots');
      for (let k = 0; k < part.length; k++) { await press(t, keys[k]); await press(t, keys[k]); ran.push(part[k].ref); await t.calm(); }
    }
    t.note(`ran: ${ran.join(', ')}`);
    if (t.state.init && t.state.init.running) t.handle('init.end', {});
    if (t.state.blackout) t.handle('table.blackout', {});
    if (t.state.quiet) t.handle('sound.quiet', {});
  }, { ms: 120000 });

  area.deep('three pages of ten: the page keys turn the pages, a slot on page 2 runs from there', async (t) => {
    const slots = new Array(30).fill(null);
    slots[0] = { kind: 'do', ref: 'page-next', label: 'Next page', icon: 'chevron-down' };
    slots[10] = { kind: 'do', ref: 'page-prev', label: 'Previous page', icon: 'chevron-up' };
    slots[11] = { kind: 'tool', ref: 'walls', label: 'Walls', icon: 'wall' };
    await set(t, slots);
    await t.g('Play.Hot.setPage(0)');
    await press(t, '1');
    t.eq(await t.g('Play.Hot.page()'), 1, 'the page after Next page');
    await press(t, '2');
    t.eq(await t.tool(), 'walls', 'slot 2 of page 2 picks Walls');
    await press(t, '1');
    t.eq(await t.g('Play.Hot.page()'), 0, 'the page after Previous page');
    await t.g(`document.querySelector('[aria-label="Hotbar page down"]').click()`);
    t.eq(await t.g('Play.Hot.page()'), 1, 'the page after the arrow');
    await t.g('Play.Hot.setPage(0)');
  });

  area.deep('things from the library on slots: a token is picked up, a sound plays, a handout shows, a map goes on the TV', async (t) => {
    const tok = t.pic('tokens', /Goblin/i); const sfx = (t.lib('sfx')[0] || t.library.listLibrary().find((x) => /SFX/.test(x.path))).path; const ho = t.pic('handouts');
    const other = t.store.allMapIds().find((id) => id !== t.state.liveMapId);
    await set(t, [{ kind: 'token', ref: { path: tok }, label: 'Goblin', icon: 'user' }, { kind: 'sound', ref: { path: sfx }, label: 'Sound', icon: 'volume' }, { kind: 'handout', ref: { path: ho }, label: 'Letter', icon: 'script' },
      { kind: 'map', ref: other, label: 'Other map', icon: 'map-2' }]);
    const kinds = saved(t).slice(0, 4).map((x) => x && x.kind);
    t.eq(kinds, ['token', 'sound', 'handout', 'map'], 'the saved slots');
    await press(t, '1');
    t.eq(await t.tool(), 'token', 'the tool after the token slot');
    t.eq(await t.g('Play.ui.tok.brush && Play.ui.tok.brush.path'), tok, 'the token in hand');
    await t.until(() => t.W().sound, 8000, 'the sound window');
    const n0 = (await t.sound()).board.length;
    await press(t, '2');
    await t.until(async () => (await t.sound()).board.length === n0 + 1, 4000, 'the sound to play');
    await press(t, '3');
    await t.until(() => t.state.handouts.length === 1, 3000, 'the handout on the table');
    await press(t, '3');
    await t.until(() => t.state.handouts.length === 0, 3000, 'the same key to put it away');
    const live = t.state.liveMapId;
    await press(t, '4');
    await t.until(() => t.state.liveMapId === other || t.state.editMapId === other, 5000, 'the map slot to bring up the other map');
    t.handle('edit.open', { id: live }); await t.send(live);
  });

  area.deep('a slot dragged onto another swaps the two; right-click → Take off the hotbar empties it, Undo puts it back', async (t) => {
    await set(t, [{ kind: 'tool', ref: 'walls', label: 'Walls', icon: 'wall' }, { kind: 'tool', ref: 'fog', label: 'Fog', icon: 'cloud-fog' }]);
    const r = await t.g(`[...document.querySelectorAll('.hb-slot')].slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`);
    await t.g(`(() => { const s = document.querySelectorAll('.hb-slot'); const dt = new DataTransfer(); const ev = (type, el, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      ev('dragstart', s[0], ${r[0].x}, ${r[0].y}); ev('dragenter', s[1], ${r[1].x}, ${r[1].y}); ev('dragover', s[1], ${r[1].x}, ${r[1].y}); ev('drop', s[1], ${r[1].x}, ${r[1].y}); ev('dragend', s[0], ${r[1].x}, ${r[1].y}); })()`);
    await t.until(() => saved(t)[0] && saved(t)[0].ref === 'fog' && saved(t)[1] && saved(t)[1].ref === 'walls', 3000, 'the two slots to swap');
    const menu = await slotMenu(t, 0);
    for (const want of ['Use', 'Change …', 'Rename …', 'Take off the hotbar']) t.has(menu, want, 'the menu of a filled slot');
    await t.menuPick('Take off the hotbar');
    await t.until(() => !saved(t)[0], 3000, 'slot 1 to be empty');
    await t.until(() => t.rect('.toast .toast-undo'), 3000, 'the message with Undo');
    await t.clickSel('.toast .toast-undo');
    await t.until(() => saved(t)[0] && saved(t)[0].ref === 'fog', 3000, 'Undo to put it back');
  });

  area.deep('the hotbar takes four shapes and keeps its ten slots in each', async (t) => {
    await set(t, []);
    const shape0 = await t.g('Play.Hot.shape()');
    for (const sh of ['5x2', '2x5', '1x10', '10x1']) {
      await t.g(`Play.Hot.setShape(${JSON.stringify(sh)})`);
      await t.sleep(200);
      t.eq(await t.g('Play.Hot.shape()'), sh, 'the shape');
      t.eq(await t.count('.hb-slot'), 10, `slots in ${sh}`);
      const box = await t.g(`(() => { const rs = [...document.querySelectorAll('.hb-slot')].map((e) => e.getBoundingClientRect()); const cols = new Set(rs.map((r) => Math.round(r.x))).size; const rows = new Set(rs.map((r) => Math.round(r.y))).size; return cols + 'x' + rows; })()`);
      t.eq(box, sh, 'how the slots lie');
    }
    await t.g(`Play.Hot.setShape(${JSON.stringify(shape0)})`);
  });

  area.deep('a slot saved under an old name shows today\'s name', async (t) => {
    await set(t, [{ kind: 'panel', ref: 'moments', label: 'Moments', icon: 'flare' }, { kind: 'panel', ref: 'chars', label: 'Characters', icon: 'id-badge-2' }]);
    const names = await t.g(`[...document.querySelectorAll('.hb-slot')].slice(0, 2).map((e) => e.textContent.replace(/^[0-9]/, '').trim())`);
    t.ok(/Screen effects/.test(names[0]) && /Character cards/.test(names[1]), 'the names on the slots', names);
  });
};
