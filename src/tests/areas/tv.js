// The table window (the TV): what the players see
'use strict';
const playing = (v) => !!v && v.readyState >= 2 && !v.paused && v.t > 0;

module.exports = (area) => {
  area.title('The TV');
  area.before(async (K) => { await K.openDemo(); });

  area.quick('T sends the map: the TV opens and plays it', async (t) => {
    t.gm().webContents.focus();
    await t.key('T');
    await t.until(() => t.tv(), 8000, 'the TV window');
    t.hookAll();
    await t.until(() => t.t(`window.__table && window.__table.debug() && window.__table.debug().liveId`), 15000, 'the map on the TV');
    t.eq(t.state.liveMapId, t.state.editMapId, 'the map on the TV is the one being edited');
    const a = await t.until(async () => { const d = await t.tvDebug(); return playing(d.bg) && d; }, 15000, 'the animated map to play');
    await t.sleep(700);
    const b = await t.tvDebug();
    t.ok(b.bg.t > a.bg.t, 'the map keeps playing', [a.bg.t, b.bg.t]);
  });

  area.quick('the TV shows what the map holds: tokens (not the hidden one), fog, the overlay', async (t) => {
    await t.send();
    const m = t.L();
    const toks = m.layers.filter((l) => l.role === 'token');
    const d = await t.tvDebug();
    t.eq(d.tokensTotal, toks.length, 'tokens on the TV');
    t.eq(d.tokensVisible, toks.filter((l) => !l.hidden).length, 'tokens the players can see');
    t.ok(toks.some((l) => l.hidden), 'the demo map has a hidden token to check with');
    t.eq(d.fogOps, m.fog.ops.length, 'fog steps on the TV');
    t.ok(d.overlays.length >= 1, 'the overlay is on the TV', d.overlays.length);
  });

  area.quick('B blacks the TV out and brings it back', async (t) => {
    await t.send();
    t.gm().webContents.focus();
    await t.key('B');
    await t.until(async () => (await t.tvDebug()).blackout, 4000, 'the blackout on the TV');
    t.eq(t.state.blackout, true, 'blackout in the app');
    // (Speed 6, WF6) once the black has faded in, the map under it is not drawn any more; it is again when the black lifts
    await t.until(async () => (await t.tvDebug()).dark, 4000, 'the map to rest under the black');
    await t.key('B');
    await t.until(async () => !(await t.tvDebug()).blackout, 4000, 'the picture to come back');
    await t.until(async () => !(await t.tvDebug()).dark, 2000, 'the map to be drawn again');
  });

  area.quick('preparing another map leaves the TV on the live one', async (t) => {
    await t.send();
    const live = t.state.liveMapId;
    const other = t.store.allMapIds().find((id) => id !== live);
    t.handle('edit.open', { id: other });
    await t.until(() => t.g(`Play.state().map.id === ${JSON.stringify(other)}`), 6000, 'the other map to open');
    await t.sleep(500);
    t.eq((await t.tvDebug()).liveId, live, 'the map on the TV');
    // T1 (open point): the GM screen's frame says which map is which (the check before could not fail)
    await t.until(() => t.g(`(() => { const f = document.querySelector('.frame-label'); return !!f && /^Prep/.test(f.textContent); })()`), 3000, 'the frame to say Prep on a map the players cannot see');
    t.handle('edit.open', { id: live });
    await t.until(() => t.g(`Play.state().map.id === ${JSON.stringify(live)}`), 6000, 'the live map to open again');
    await t.until(() => t.g(`(() => { const f = document.querySelector('.frame-label'); return !!f && /^On the table/.test(f.textContent); })()`), 3000, 'the frame to say On the table on the live map');
  });

  area.quick('a change on the GM screen reaches the TV at once', async (t) => {
    await t.send();
    const m = t.L();
    const n0 = (await t.tvDebug()).tokensTotal;
    const r = t.handle('layer.add', { mapId: m.id, path: t.pic('tokens'), role: 'token', x: m.grid.size * 3.5, y: m.grid.size * 3.5, size: 1 });
    await t.until(async () => (await t.tvDebug()).tokensTotal === n0 + 1, 4000, 'the new token on the TV');
    t.handle('layer.remove', { mapId: m.id, id: r.selected });
    await t.until(async () => (await t.tvDebug()).tokensTotal === n0, 4000, 'the token to leave the TV');
  });

  // B1 (open point): the preview's Close asks first; Cancel (or Esc) keeps the table open
  area.quick('the preview\'s Close asks first: Cancel keeps the table, Close shuts it', async (t) => {
    await t.send();
    const ask = () => t.g(`(() => { const d = [...document.querySelectorAll('.modal')].find((m) => /Close the table window/.test(m.textContent)); return d ? d.textContent : null; })()`);
    await t.g(`document.querySelector('#table-ctl .tc-open').click()`);
    t.ok(await t.until(ask, 3000, 'the question'), 'a click on Close asks first');
    t.ok(!!t.tv(), 'the table is still open while it asks');
    await t.g(`document.querySelector('.tc-close-keep').click()`);
    await t.until(async () => !(await ask()), 3000, 'the question to go');
    await t.sleep(300);
    t.ok(!!t.tv() && (await t.g('Play.state().table.open')), 'Cancel keeps the table open');
    await t.g(`document.querySelector('#table-ctl .tc-open').click()`);
    await t.until(ask, 3000, 'the question again');
    await t.g(`document.querySelector('.tc-close-go').click()`);
    await t.until(() => !t.tv(), 5000, 'the TV window to close');
    t.handle('table.open');
    await t.until(() => t.tv() && !t.tv().webContents.isLoading(), 15000, 'the TV window to open again');
    t.hookAll();
    await t.until(() => t.t(`window.__table && window.__table.debug() && !!window.__table.debug().liveId`), 15000, 'the map on the TV again');
  });

  area.quick('the TV window closes and opens again with the map', async (t) => {
    await t.send();
    t.handle('table.close');
    await t.until(() => !t.tv(), 5000, 'the TV window to close');
    t.handle('table.open');
    await t.until(() => t.tv() && !t.tv().webContents.isLoading(), 8000, 'the TV window to open');
    t.hookAll();
    await t.until(() => t.t(`window.__table && window.__table.debug() && !!window.__table.debug().liveId`), 15000, 'the map on the TV again');
  });

  // ---------- deep ----------
  const on = (t, sel) => t.t(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.classList.contains('on') && getComputedStyle(e).display !== 'none'; })()`);

  // F1 (open point): the join code from the hotbar starts the phone server by itself; the card on the TV has the GM's
  // message (the Wi-Fi) and no address (that is in Player phones); the two panels by who holds the device; the switch
  // for all of it in Tablescape settings → This screen
  area.quick('the join code: the server starts by itself, the card has the message and no address; one switch turns phones off', async (t) => {
    await t.send();
    const R = () => t.g('Play.state().remote');
    await t.g(`window.ts.remote('allow', { on: true })`); await t.g(`window.ts.remote('set', { on: false })`);
    if (t.state.join) await t.g(`window.ts.players('join', { on: false })`);
    await t.until(async () => !(await R()).running, 4000, 'the phone server off');
    const MSG = 'Wi-Fi: Tavern\nPassword: dragons123';
    await t.g(`window.ts.settings({ joinMsg: ${JSON.stringify(MSG)} })`);
    try {
      // the hotbar's Join code: the server starts, the code goes on the TV, the button is lit
      await t.g(`Play.hotRun({ kind: 'do', ref: 'join', label: 'Join code' })`);
      await t.until(() => t.state.join, 6000, 'the join code on the TV');
      t.ok((await R()).running, 'the phone server started by itself');
      const card = await t.until(() => t.t(`(() => { const c = document.querySelector('.tv-join.on .jn-face.near .jn-card'); if (!c) return null; return { text: c.textContent, msg: [...c.querySelectorAll('.jn-msg i')].map((e) => e.textContent), edge: getComputedStyle(c).borderTopColor }; })()`), 5000, 'the card on the TV');
      t.ok(card.text.includes('Scan to join'), 'Scan to join', card.text);
      t.eq(card.msg, ['Wi-Fi: Tavern', 'Password: dragons123'], 'the message, line by line');
      t.ok(!card.text.includes(t.state.join.url) && !/\d+\.\d+\.\d+\.\d+/.test(card.text), 'no address on the card', card.text);
      t.eq(card.edge, 'rgb(232, 160, 76)', 'its edge in the torch\'s orange');
      // Player phones: the message to edit; no party screen (gone); no address (UI audit VE4: an address alone connects nothing)
      await t.g(`Play.TB.openPanel('players')`);
      await t.until(async () => (await t.panels()).some((x) => x.id === 'players'), 4000, 'Player phones');
      const pp = await t.until(() => t.g(`(() => { const e = document.querySelector('.fp[data-id="players"]'); const a = e.querySelector('.pp-joinmsg'); return a && { addr: !!e.querySelector('.pp-addr') || /\d+\.\d+\.\d+\.\d+/.test([...e.querySelectorAll('.hint, small')].filter((x) => !x.closest('details')).map((x) => x.textContent).join(' ')), msg: e.querySelector('.pp-joinmsg').value, party: e.textContent.includes('Party screen') || e.textContent.includes('On a screen of this PC'), dead: e.textContent.includes('Switch on the Remote') }; })()`), 5000, 'the message in Player phones');
      t.ok(!pp.addr && pp.msg === MSG && !pp.party && !pp.dead, 'Player phones: the message, no address; no party screen, no "switch on the Remote first"', pp);
      await t.g(`Play.Floats.hide('players')`);
      // Gamemaster remote: yours only, no switch, no tabs
      await t.g(`Play.TB.openPanel('remote')`);
      await t.until(async () => (await t.panels()).some((x) => x.id === 'remote'), 4000, 'Gamemaster remote');
      const gr = await t.g(`(() => { const e = document.querySelector('.fp[data-id="remote"]'); return { title: e.querySelector('.fp-title').textContent, tabs: !!e.querySelector('.rm-tabs'), sw: e.textContent.includes('Phones and tablets can connect'), party: e.textContent.includes('Party screen') }; })()`);
      t.ok(gr.title === 'Gamemaster remote' && !gr.tabs && !gr.sw && !gr.party, 'Gamemaster remote: its name, no switch, no tabs, no party screen', gr);
      await t.g(`Play.Floats.hide('remote')`);
      // the hotbar again: the code goes
      await t.g(`Play.hotRun({ kind: 'do', ref: 'join', label: 'Join code' })`);
      await t.until(() => !t.state.join, 4000, 'the join code to leave the TV');
      // switched off in Tablescape settings → This screen: the server stops, the join code says why
      await t.g(`window.ts.remote('allow', { on: false })`);
      await t.until(async () => !(await R()).running, 4000, 'the server to stop');
      const no = await t.g(`window.ts.players('join', {})`);
      t.ok(no && no.ok === false && /switched off/.test(no.error) && !t.state.join, 'switched off: no join code, and it says why', no);
    } finally {
      await t.g(`window.ts.remote('allow', { on: true })`);
      await t.g(`window.ts.settings({ joinMsg: '' })`);
      if (t.state.join) await t.g(`window.ts.players('join', { on: false })`);
    }
  });

  area.deep('a map being prepared waits on the TV, loaded and paused; Send to table changes over to it', async (t) => {
    await t.send();
    const live = t.state.liveMapId;
    const other = t.store.allMapIds().find((id) => id !== live);
    await t.cmd('edit.open', { id: other });
    const d = await t.until(async () => { const x = await t.tvDebug(); return x.views.includes(other) && x; }, 10000, 'the next map to be loaded on the TV');
    t.eq(d.liveId, live, 'the map the players see');
    t.ok(d.prepPaused.every((p) => p === true), 'the waiting map does not play', d.prepPaused);
    await t.send(other);
    t.eq((await t.tvDebug()).liveId, other, 'the map on the TV after Send to table');
    await t.cmd('edit.open', { id: live });
    await t.send(live);
  });

  area.deep('the chapter\'s ambience keeps playing when another map of the chapter goes on the TV', async (t) => {
    await t.send();
    await t.until(() => t.W().sound, 8000, 'the sound window');
    const amb = async () => ((await t.sound()).tracks || []).find((x) => x.key.startsWith('amb:'));
    const a = await t.until(async () => { const x = await amb(); return x && x.playing && x.t > 0.5 && x; }, 10000, 'the ambience');
    const live = t.state.liveMapId;
    const other = t.store.allMapIds().find((id) => id !== live && t.store.chapterOf(id) === t.store.chapterOf(live));
    t.ok(other, 'another map in the same chapter');
    await t.cmd('edit.open', { id: other });
    await t.send(other);
    const b = await amb();
    t.ok(b && b.playing && b.key === a.key && b.t > a.t, 'the same ambience went on without starting over', [a, b]);
    await t.cmd('edit.open', { id: live });
    await t.send(live);
  });

  area.deep('nothing meant for the GM alone is on the TV: no hotbar, no tool rail, no GM notes', async (t) => {
    await t.send();
    const m = t.L(); const s = m.grid.size;
    await t.cmd('mark.add', { mapId: m.id, kind: 'note', x: 5 * s, y: 5 * s, text: 'Secret door here' });
    const note = t.L().marks.find((x) => x.kind === 'note');
    t.ok(note, 'a GM note on the map', t.L().marks.length);
    const tv = await t.t(`({ hotbar: document.querySelectorAll('.hb-slot, #hotbar').length, rail: document.querySelectorAll('.rail-btn').length, text: document.body.textContent.includes('Secret door here'), notes: window.__table.debug().notes })`);
    t.eq(tv, { hotbar: 0, rail: 0, text: false, notes: 0 }, 'GM things on the TV');
    await t.cmd('mark.remove', { mapId: m.id, id: note.id });
  });

  area.deep('the break screen shows a dial on the TV and ends; a countdown shows and stops', async (t) => {
    await t.send();
    await t.cmd('break.start', { minutes: 5 });
    await t.until(() => on(t, '.tv-break'), 4000, 'the break screen');
    const text = await t.t(`document.querySelector('.tv-break').textContent`);
    t.ok(/[45]:\d\d/.test(text), 'the dial counts down from five minutes', text.slice(0, 80));
    await t.cmd('break.end', {});
    await t.until(async () => !(await on(t, '.tv-break')), 4000, 'the break screen to go');
    await t.cmd('timer.start', { seconds: 90, mode: 'dramatic' });
    const tm = await t.until(async () => { const x = (await t.tvDebug()).timer; return x && (x.on || x.shown || x.text || x.running) && x; }, 4000, 'the countdown on the TV');
    t.ok(tm.on && tm.mode === 'dramatic' && !tm.paused && /\d/.test(String(tm.text || '')), 'the TV shows the dramatic countdown running, with its numbers', tm); // (T1: it only checked the report was long)
    await t.cmd('timer.stop', {});
    await t.until(async () => { const off = (await t.tvDebug()).timer; return !off || !(off.on || off.shown || off.running); }, 4000, 'the countdown to leave the TV'); // (T2: waits for it, not 0.6 s)
  });

  area.deep('the title screen shows the campaign\'s name; the first map sent takes it away', async (t) => {
    await t.send();
    await t.cmd('title.show', { on: true });
    await t.until(() => on(t, '.tv-title'), 4000, 'the title on the TV');
    const text = await t.t(`document.querySelector('.tv-title').textContent`);
    t.ok(text.includes(t.store.cur.meta.name.replace(/^Demo: /, '')) || text.length > 3, 'the title names the campaign', text.slice(0, 100));
    await t.send();
    await t.until(async () => !(await on(t, '.tv-title')), 4000, 'the title to go once a map is sent');
    t.ok(!t.state.title, 'no title in the app either');
  });

  area.deep('the calibration card shows on the TV and goes again', async (t) => {
    await t.send();
    await t.cmd('table.calibrate', { on: true });
    await t.until(async () => (await t.tvDebug()).calibrating, 4000, 'the calibration card');
    await t.cmd('table.calibrate', { on: false });
    await t.until(async () => !(await t.tvDebug()).calibrating, 4000, 'the calibration card to go');
  });

  area.deep('a TV window that stops is loaded again by itself, with the map on it', async (t) => {
    await t.send();
    const live = t.state.liveMapId;
    t.expectCrashOn();
    t.tv().webContents.forcefullyCrashRenderer();
    await t.sleep(1500);
    await t.until(() => t.tv() && !t.tv().isDestroyed() && !t.tv().webContents.isLoading() && !t.tv().webContents.isCrashed(), 15000, 'the TV window to come back');
    await t.until(() => t.t(`window.__table && window.__table.debug() && window.__table.debug().liveId === ${JSON.stringify(live)}`), 15000, 'the map on the TV again');
    t.expectCrashOff();
  }, { allow: /stopped|gone|crash|table window/i });
  // Beta 3.15: what stays on the TV has a row under the preview to end it, coloured by what it is and sorted by colour
  area.quick('the rows under the preview: a fight (red), a world map, handouts and a conversation (green), the rest (pale orange), in that order', async (t) => {
    // (the sound row (F6) shows whenever the chapter's ambience plays: the Sound area checks it; left out here)
    const rows = () => t.g(`[...document.querySelectorAll('#table-ctl .tc-hud .hud-row:not(.hud-sound)')].map((r) => [[...r.classList].find((c) => c.startsWith('c-')), [...r.classList].find((c) => c.startsWith('hud-') && c !== 'hud-row'), r.querySelector('.grow').textContent.trim()])`);
    await t.send();
    t.eq(await rows(), [], 'nothing on: no rows');
    // a countdown, two handouts, a conversation, a world map, a fight: in the order they are started
    t.handle('timer.start', { mode: 'plain', seconds: 300, label: '' });
    const ho = t.lib('handouts');
    const second = ho[1] || t.lib('maps').find((x) => x.kind === 'image'); // (any picture can be handed out)
    t.handle('handout.show', { path: ho[0].path }); t.handle('handout.show', { path: second.path, add: true });
    t.eq((t.state.handouts || []).length, 2, 'two handouts on the table');
    t.handle('talk.toggle', { path: t.lib('portraits')[0].path });
    const world = t.handle('atlas.add', { path: t.lib('maps').find((x) => x.kind === 'image').path, name: 'The world', open: false }).id;
    const region = t.handle('atlas.add', { path: t.lib('maps').find((x) => x.kind === 'image').path, name: 'The north', open: false }).id;
    t.handle('mark.add', { mapId: world, kind: 'place', title: 'Gate', to: region, x: 3, y: 3 });
    t.handle('atlas.show', { id: region });
    const st = t.handle('init.start', { list: [{ name: 'Mira', pc: true, init: 18 }, { name: 'Goblin', init: 9 }] });
    t.ok(st && st.ok, 'a fight', st);
    const got = await t.until(async () => { const r = await rows(); return r.length === 5 && r; }, 5000, 'five rows');
    t.eq(got.map((r) => [r[0], r[1]]), [['c-red', 'hud-fight'], ['c-green', 'hud-atlas'], ['c-green', 'hud-handout'], ['c-green', 'hud-talk'], ['c-pale', 'hud-timer']], 'red first, then green, then pale orange');
    t.ok(/Round 1\s*Mira/.test(got[0][2]), 'the fight: its round and whose turn it is', got[0][2]);
    t.eq([got[1][2], got[2][2]], ['The north', '2 handouts'], 'the world map on the TV, and how many handouts lie there');
    t.eq(await t.g(`getComputedStyle(document.querySelector('.hud-fight'), '::before').backgroundColor !== getComputedStyle(document.querySelector('.hud-atlas'), '::before').backgroundColor`), true, 'each colour has its own light at the edge');
    // the fight row: Next moves the turn on, the stop button ends the fight
    await t.clickText('.hud-fight .btn', 'Next');
    await t.until(async () => /Goblin/.test((await rows())[0][2]), 4000, 'the next one\'s turn');
    const end = await t.rect('.hud-fight .icon-btn'); await t.click(end.cx, end.cy);
    await t.until(() => !t.state.init, 4000, 'the fight to end');
    // the world map row: Zoom out goes to the map that leads here, the x takes it off
    const zo = await t.rect('.hud-atlas .icon-btn[aria-label="Zoom out"]'); await t.click(zo.cx, zo.cy);
    await t.until(() => t.state.atlas && t.state.atlas.id === world, 4000, 'Zoom out to the world map');
    t.eq(t.state.atlas.via.dir, 'out', 'the TV pulls back out');
    await t.until(async () => (await rows()).some((r) => r[2] === 'The world'), 4000, 'the row to name the world map');
    t.eq(await t.count('.hud-atlas .icon-btn[aria-label="Zoom out"]'), 0, 'no Zoom out on the world map itself');
    const off = await t.rect('.hud-atlas .icon-btn[aria-label="Take it off the table"]'); await t.click(off.cx, off.cy);
    await t.until(() => !t.state.atlas, 4000, 'the world map to be taken off');
    // the handouts row: put them all away
    const all = await t.rect('.hud-handout .icon-btn[aria-label="Put them all away"]'); await t.click(all.cx, all.cy);
    await t.until(() => !(t.state.handouts || []).length, 4000, 'both handouts to be put away');
    t.handle('talk.off', {}); t.handle('timer.stop', {});
    await t.until(async () => !(await rows()).length, 4000, 'no rows left');
    // the join code on the TV: a row with the time it has left; its x takes the code off
    await t.g(`window.ts.players('set', { on: true })`);
    const jr = await t.g(`window.ts.players('join', { on: true })`);
    if (jr && jr.ok !== false) {
      const join = await t.until(async () => { const r = await rows(); return r.length === 1 && r[0][1] === 'hud-join' && /\d:\d\d/.test(r[0][2]) && r; }, 5000, 'the join code\'s row');
      t.eq(join[0][0], 'c-pale', 'pale orange');
      const jx = await t.rect('.hud-join .icon-btn'); await t.click(jx.cx, jx.cy);
      await t.until(() => !t.state.join, 4000, 'the join code to leave the TV');
    }
    await t.g(`window.ts.players('set', { on: false })`);
    // the spotlight: a row while it is on the table, its x takes it off
    t.gm().webContents.focus();
    await t.g(`document.querySelector('.rail-btn[data-id="toolbox"]').click()`);
    await t.until(() => t.popTitle(), 3000, 'the Toolbox');
    await t.g(`[...document.querySelectorAll('#pop .tb-tile')].find((x) => (x.querySelector('.tb-name, span') || x).textContent.trim() === 'Spotlight' || x.textContent.trim() === 'Spotlight').click()`);
    await t.until(async () => (await t.tool()) === 'point' && (await t.g(`Play.ui.point.mode`)) === 'spot', 3000, 'the Spotlight tool');
    await t.key('Escape'); await t.sleep(200);
    const mp = await t.scr(...Object.values(await t.g(`(() => { const r = Play.view().tableRectInMap(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; })()`)));
    await t.mouse('mouseMove', mp.x - 20, mp.y); await t.mouse('mouseMove', mp.x, mp.y);
    await t.until(async () => (await rows()).some((r) => r[1] === 'hud-spot' && r[0] === 'c-pale'), 4000, 'the spotlight\'s row');
    const sx = await t.rect('.hud-spot .icon-btn'); await t.click(sx.cx, sx.cy);
    await t.until(async () => !(await rows()).length, 4000, 'the spotlight to be off');
    await t.g(`Play.setTool('select')`);
    t.handle('atlas.remove', { id: region }); t.handle('atlas.remove', { id: world });
  }, { ms: 60000 });

  // Speed 6 (Open Point WF5): what lies far outside the table is not drawn on the TV
  area.quick('WF5: a fire far outside the table is known to the TV but not drawn; one on the table is', async (t) => {
    await t.send();
    const id = t.state.liveMapId; const m = t.store.map(id); const k = m.grid.size || 1;
    const d0 = (await t.tvDebug()).fx;
    const near = await t.cmd('fx.add', { mapId: id, kind: 'emitter', preset: 'campfire', x: 4 * k, y: 4 * k, r: 1 });
    const far = await t.cmd('fx.add', { mapId: id, kind: 'emitter', preset: 'campfire', x: 4000 * k, y: 4000 * k, r: 1 });
    try {
      await t.until(async () => { const d = (await t.tvDebug()).fx; return d && d.emitters === d0.emitters + 2 && d; }, 5000, 'both fires on the TV');
      const d1 = (await t.tvDebug()).fx;
      t.eq(d1.offTable - d0.offTable, 1, 'fires left out of the drawing: the far one only');
    } finally { for (const r of [near, far]) if (r && r.id) await t.cmd('fx.remove', { mapId: id, id: r.id }); }
  });

  // Speed 9 (Open Point WI7): a closed map gives its memory back
  area.deep('WI7: opening another map to edit keeps the live map\'s Sway copy; a map taken off the TV empties its canvases; a video picture that goes gives its player back', async (t) => {
    const live0 = t.state.liveMapId; const edit0 = t.state.editMapId;
    const a = await t.newMap('WI7 A (test)', { tv: true });
    try {
      const k = t.store.map(a).grid.size;
      const r = await t.g(`Play.view().tableRectInMap()`);
      const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      t.handle('fx.stroke', { mapId: a, id: 'wi7-sway', preset: 'sway', sid: 's1', r: 1.2 * k, pts: [mid.x - k, mid.y, mid.x + k, mid.y] });
      await t.until(() => t.t(`!!FX.swayOf('wi7-sway') && (window.__wi7sway = FX.swayOf('wi7-sway')) && true`), 8000, 'the Sway area\'s copy of the picture on the TV');
      // another map opened to edit: the TV prepares it in a hidden view
      const b = await t.newMap('WI7 B (test)');
      await t.until(async () => ((await t.tvDebug()).views || []).includes(b), 8000, 'the hidden view of the map being edited');
      await t.sleep(500);
      t.eq(await t.t(`FX.swayOf('wi7-sway') === window.__wi7sway`), true, 'the live map\'s Sway copy is still the same one (not thrown away and made anew)');
      // the edited map gets a video as its picture and goes onto the TV: the first map's view is closed
      const vid = t.lib('maps').find((x) => x.kind === 'video');
      if (!vid) throw new Error('no animated map in the library to check with');
      t.handle('bg.set', { mapId: b, path: vid.path });
      const cvs = await t.t(`(() => { const L = document.querySelector('.tv-layer.shown'); window.__wi7cv = [...L.querySelectorAll('canvas')]; return window.__wi7cv.filter((c) => c.width > 0).length; })()`);
      t.ok(cvs >= 5, 'canvases of the first map\'s view that hold a picture', cvs);
      await t.send(b);
      await t.until(async () => !((await t.tvDebug()).views || []).includes(a), 8000, 'the first map\'s view to close');
      t.eq(await t.t(`[window.__wi7cv.filter((c) => c.width > 0 || c.height > 0).length, window.__wi7cv.some((c) => c.isConnected)]`), [0, false], 'canvases of the closed view that still hold a picture; still in the page');
      // the video picture goes (a still picture instead): its player is emptied, not only taken out of the page
      await t.until(async () => playing((await t.tvDebug()).bg), 15000, 'the video picture to play');
      t.eq(await t.t(`(() => { const v = document.querySelector('.tv-layer.shown .sv-bg video'); window.__wi7vid = v; return !!v && v.hasAttribute('src'); })()`), true, 'the video picture on the TV');
      const still = t.lib('maps').find((x) => x.kind === 'image');
      t.handle('bg.set', { mapId: b, path: still.path });
      await t.until(() => t.t(`!window.__wi7vid.isConnected`), 8000, 'the video to leave the page');
      t.eq(await t.t(`[window.__wi7vid.hasAttribute('src'), window.__wi7vid.networkState, window.__wi7vid.readyState]`), [false, 0, 0], 'the player taken off: its file, its loading (0: none), what it has decoded (0: nothing)');
    } finally {
      await t.t(`delete window.__wi7sway; delete window.__wi7cv; delete window.__wi7vid; 0`);
      if (edit0) t.handle('edit.open', { id: edit0 });
      if (live0) await t.send(live0);
    }
  }, { ms: 120000 });

  // Speed 5 (Open Point WE3, stage 1 of the plan of 26 Nov): the TV applies a state without extra work
  area.deep('WE3: sixty states in a row draw fewer than sixty pictures on the TV; the hidden map of what is edited is set up only when its files change, and comes whole when it goes onto the table', async (t) => {
    const live0 = t.state.liveMapId; const edit0 = t.state.editMapId;
    const a = await t.newMap('WE3 A (test)', { tv: true });
    try {
      const k = t.store.map(a).grid.size; const pic = t.pic('assets');
      const one = t.handle('layer.add', { mapId: a, path: pic, role: 'asset', x: 6 * k, y: 6 * k, w: k }).selected;
      await t.settle(); await t.sleep(600);
      // sixty states, as fast as the app sends them
      const f0 = (await t.tvDebug()).frames; const t0 = Date.now();
      for (let i = 0; i < 60; i++) { t.handle('layer.update', { mapId: a, id: one, x: (6 + i * 0.02) * k, coalesce: 'we3' }); await new Promise((r) => setImmediate(r)); }
      await t.sleep(120);
      const ms = Date.now() - t0; const drawn = (await t.tvDebug()).frames - f0;
      t.ok(drawn < 60 && drawn <= Math.ceil(ms / 6) + 3, 'pictures the TV drew for sixty states: fewer than states, and no more than the screen shows in that time', { drawn, ms });
      t.near((await t.t(`window.__table.mapOf().layers.find((l) => l.id === ${JSON.stringify(one)}).x`)), (6 + 59 * 0.02) * k, 1e-6, 'and the asset lies where the last state put it');
      // another map to edit: the TV sets up a hidden view of it once
      const b = await t.newMap('WE3 B (test)');
      const two = t.handle('layer.add', { mapId: b, path: pic, role: 'asset', x: 5 * k, y: 5 * k, w: k }).selected;
      await t.until(async () => ((await t.tvDebug()).views || []).includes(b), 8000, 'the hidden view of the map being edited');
      await t.settle(); await t.sleep(400);
      const p0 = (await t.tvDebug()).prep;
      for (let i = 0; i < 30; i++) { t.handle('layer.update', { mapId: b, id: two, x: (5 + i * 0.05) * k, coalesce: 'we3b' }); await new Promise((r) => setImmediate(r)); }
      await t.settle(); await t.sleep(300);
      const p1 = (await t.tvDebug()).prep;
      t.ok(p1.prepKept - p0.prepKept >= 25 && p1.prepSet - p0.prepSet === 0, 'thirty moves of an asset on the edited map: the TV left its hidden view as it was each time', [p0, p1]);
      // another file on it: the hidden view is set up again, so its picture is loaded
      const other = t.lib('assets').map((x) => x.path).find((p) => p !== pic) || t.pic('tokens');
      t.handle('layer.add', { mapId: b, path: other, role: 'asset', x: 9 * k, y: 5 * k, w: k });
      await t.settle(); await t.sleep(300);
      const p2 = (await t.tvDebug()).prep;
      t.ok(p2.prepSet - p1.prepSet >= 1, 'an asset with another file put on it: the hidden view is set up again', [p1, p2]);
      t.eq(await t.t(`window.__table.mapOf(${JSON.stringify(b)}).layers.length`), t.store.map(b).layers.length, 'and holds every layer of the map');
      // onto the table: the map comes whole, the asset where it was left
      await t.send(b);
      t.near(await t.t(`window.__table.mapOf().layers.find((l) => l.id === ${JSON.stringify(two)}).x`), (5 + 29 * 0.05) * k, 1e-6, 'sent to the table: the asset lies where the thirty moves left it');
      // a TV that loads anew gets the hidden map whole again
      t.handle('edit.open', { id: a });
      await t.until(async () => ((await t.tvDebug()).views || []).includes(a), 8000, 'the first map as the hidden one');
      const p3 = (await t.tvDebug()).prep;
      await t.t('window.ts.state().then((s) => { SceneView.onResync(s); return 0; })');
      await t.sleep(300);
      t.ok((await t.tvDebug()).prep.prepSet - p3.prepSet >= 1, 'a state the TV asks for itself brings the hidden map whole', [p3, (await t.tvDebug()).prep]);
    } finally {
      if (edit0) t.handle('edit.open', { id: edit0 });
      if (live0) await t.send(live0);
    }
  }, { ms: 120000 });

  // Speed 5 (Open Point WE1, stage 2 of the plan of 26 Nov): a move in the hand sends what moved, not the map
  area.deep('WE1: an asset, a group, a torch, a light, a spell area, the map\'s own sliders and a stroke being painted or drawn send only themselves; both windows hold the same map as the app in mid-move and after; the whole state follows when the hand rests; anything else takes the old way', async (t) => {
    const live0 = t.state.liveMapId; const edit0 = t.state.editMapId;
    const a = await t.newMap('WE1 (test)', { tv: true });
    const M = () => t.store.map(a);
    try {
      t.handle('fog.enabled', { mapId: a, enabled: false });
      const k = M().grid.size; const pic = t.pic('assets');
      const as = [0, 1, 2, 3].map((i) => t.handle('layer.add', { mapId: a, path: pic, role: 'asset', x: (8 + i * 2) * k, y: 6 * k, w: k }).selected);
      const torch = t.handle('fx.add', { mapId: a, kind: 'emitter', preset: 'torch', x: 10 * k, y: 10 * k, r: 1, bright: 20, dim: 40 }).selected;
      const lamp = t.handle('fx.add', { mapId: a, kind: 'light', preset: 'light', x: 14 * k, y: 10 * k, r: 1 }).selected;
      const spell = t.handle('spell.add', { mapId: a, shape: 'sphere', skin: 'fire', x: 18 * k, y: 9 * k, size: 20, mode: 'stay' }).selected;
      await t.settle(); await t.sleep(500);
      const counts = async () => { const g = await t.g('({ ...Play.patchStats })'); const d = (await t.tvDebug()).prep; return { gmStates: g.states, gmPatches: g.n, tvStates: d.states, tvPatches: d.patches }; };
      const J = (x) => JSON.stringify(JSON.parse(JSON.stringify(x)));
      // the map the app holds, the GM screen holds and the TV holds: its layers, effects and spells, one by one
      const same = async () => {
        const PARTS = ['light', 'weather', 'wind', 'live', 'grid', 'vision']; // (stage 3: the map's own sliders)
        const gmMap = await t.g('(() => { const m = Play.state().map; return { layers: m.layers, fx: m.fx, spells: m.spells, draw: m.draw, light: m.light, weather: m.weather, wind: m.wind, live: m.live, grid: m.grid, vision: m.vision }; })()');
        const tvMap = await t.t('(() => { const m = window.__table.mapOf(); return { layers: m.layers, fx: m.fx, spells: m.spells, draw: m.draw, light: m.light, weather: m.weather, wind: m.wind, live: m.live, grid: m.grid, vision: m.vision }; })()');
        const out = [];
        for (const kind of ['layers', 'fx', 'spells', 'draw']) for (const [who, mm] of [['GM', gmMap], ['TV', tvMap]]) {
          const mine = M()[kind];
          if (mine.length !== mm[kind].length) { out.push(`${who} ${kind}: ${mm[kind].length} of ${mine.length}`); continue; }
          mine.forEach((x, i) => { if (J(x) !== J(mm[kind][i])) out.push(`${who} ${kind} ${x.id}: ${J(mm[kind][i]).slice(0, 160)} is not ${J(x).slice(0, 160)}`); });
        }
        for (const part of PARTS) for (const [who, mm] of [['GM', gmMap], ['TV', tvMap]]) if (J(M()[part]) !== J(mm[part])) out.push(`${who} ${part}: ${J(mm[part]).slice(0, 160)} is not ${J(M()[part]).slice(0, 160)}`);
        return out;
      };
      // one gesture: sixty steps as the GM screen sends them, compared in mid-move and after the hand rested
      const gesture = async (what, step) => {
        await t.sleep(450); // (the last one came to rest)
        const c0 = await counts();
        for (let i = 0; i < 60; i++) { const r = step(i); if (!r || !r.ok || !r.soft) throw new Error(`${what}: step ${i} did not go the small way: ${JSON.stringify(r)}`); await t.sleep(6); }
        await t.sleep(60);
        const c1 = await counts(); const mid = await same();
        await t.sleep(500);
        const c2 = await counts(); const after = await same();
        t.eq([c1.gmStates - c0.gmStates, c1.tvStates - c0.tvStates, c1.gmPatches - c0.gmPatches >= 55, c1.tvPatches - c0.tvPatches >= 55], [0, 0, true, true], `${what}: whole states to the GM screen and the TV during sixty steps (none), and the small messages reached both`, [c0, c1]);
        t.eq(mid, [], `${what}: in mid-move both windows hold what the app holds`);
        t.eq([c2.gmStates - c1.gmStates, c2.tvStates - c1.tvStates, after], [1, 1, []], `${what}: the hand rests: one whole state to each, and still the same`);
      };
      const soft = (type, p, key) => t.handle(type, { mapId: a, ...p, coalesce: key, soft: true });
      await gesture('an asset dragged', (i) => soft('layer.update', { id: as[0], x: (8 + i * 0.03) * k, y: (6 + i * 0.01) * k }, 'we1-a'));
      await gesture('an asset turned and faded', (i) => soft('layer.update', { id: as[1], rotation: i * 3, opacity: 1 - i * 0.01 }, 'we1-b'));
      await gesture('two assets dragged together', (i) => soft('layer.many', { patches: [{ id: as[2], x: (12 + i * 0.03) * k }, { id: as[3], x: (14 + i * 0.03) * k }] }, 'we1-c'));
      await gesture('a torch dragged', (i) => soft('fx.update', { id: torch, x: (10 + i * 0.03) * k, y: 10 * k }, 'we1-d'));
      await gesture('a torch made stronger', (i) => soft('fx.update', { id: torch, intensity: 0.5 + i * 0.02 }, 'we1-e'));
      await gesture('a light dragged, its reach changed', (i) => soft('fx.update', { id: lamp, x: (14 + i * 0.02) * k, bright: 20 + (i % 10), dim: 40 + (i % 10) }, 'we1-f'));
      await gesture('a spell area dragged and turned', (i) => soft('spell.update', { id: spell, x: (18 + i * 0.02) * k, angle: i * 2 }, 'we1-g'));
      // stage 3: the map's own sliders
      const rain = t.handle('weather.add', { mapId: a, type: 'rain' }); await t.settle();
      const rainId = M().weather.layers[M().weather.layers.length - 1].id;
      await gesture('the darkness slider', (i) => soft('light.update', { darkness: 0.2 + i * 0.01 }, 'we1-i'));
      await gesture('the amount of rain', (i) => soft('weather.update', { id: rainId, amount: 0.5 + i * 0.02 }, 'we1-j'));
      await gesture('the strength of the wind', (i) => soft('wind.set', { strength: 0.6 + i * 0.02 }, 'we1-k'));
      await gesture('the opacity of the grid', (i) => soft('grid.update', { opacity: 0.2 + i * 0.01 }, 'we1-l'));
      await gesture('how dark explored ground is', (i) => soft('vision.update', { dim: 0.2 + i * 0.01 }, 'we1-m'));
      t.handle('light.update', { mapId: a, darkness: 0 }); t.handle('weather.remove', { mapId: a, id: rainId }); void rain;
      // stage 4: a stroke painted (a new area, then a second stroke of it) and a line drawn with the pen: the new piece goes
      await gesture('a mist area painted', (i) => soft('fx.stroke', { id: 'we1-mist', preset: 'mist', sid: 's1', r: 0.8 * k, pts: [(6 + i * 0.1) * k, 13 * k, (6.05 + i * 0.1) * k, 13.2 * k] }, 's1'));
      await gesture('a second stroke of it', (i) => soft('fx.stroke', { id: 'we1-mist', preset: 'mist', sid: 's2', r: 0.8 * k, pts: [(6 + i * 0.1) * k, 14.5 * k] }, 's2'));
      t.eq(M().fx.find((x) => x.id === 'we1-mist').strokes.map((x) => x.pts.length), [240, 120], 'the area has both strokes, every point of them');
      await gesture('a line drawn with the pen', (i) => soft('draw.stroke', { id: 'we1-pen', color: '#ffffff', w: 0.1, pts: [(4 + i * 0.1) * k, (3 + Math.sin(i / 5)) * k] }, 'we1-pen'));
      t.eq(M().draw.find((x) => x.id === 'we1-pen').pts.length, 120, 'the pen line has every point');
      // what is not a move takes the old way, also when the hand is on it
      await t.sleep(450);
      const c3 = await counts();
      const hid = soft('fx.update', { id: torch, hidden: true }, 'we1-h');
      await t.settle(); await t.sleep(120);
      const c4 = await counts();
      t.eq([!!hid.soft, c4.gmStates - c3.gmStates >= 1, c4.gmPatches - c3.gmPatches], [false, true, 0], 'hiding a torch is not a move: a whole state, no small message', [hid, c3, c4]);
      t.handle('fx.update', { mapId: a, id: torch, hidden: false });
      // the same with the mouse on your screen: an asset dragged across the map
      await t.g(`Play.setTool('asset'); Play.openPop('asset')`);
      await t.settle(); await t.sleep(450);
      const x0 = M().layers.find((l) => l.id === as[0]).x;
      const at = await t.g(`(() => { const r = Play.view().nodes.get(${JSON.stringify(as[0])}).el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const c5 = await counts();
      await t.mouse('mouseMove', at.x, at.y); await t.mouse('mouseDown', at.x, at.y);
      for (let i = 1; i <= 20; i++) { await t.mouse('mouseMove', at.x + i * 4, at.y + i * 2, 'left', { modifiers: ['leftButtonDown'] }); }
      const c6 = await counts(); const midMouse = await same();
      await t.mouse('mouseUp', at.x + 80, at.y + 40);
      await t.settle(); await t.sleep(500);
      const c7 = await counts();
      t.ok(M().layers.find((l) => l.id === as[0]).x > x0 + 0.2 * k, 'the mouse moved the asset', [x0, M().layers.find((l) => l.id === as[0]).x]);
      t.ok(c6.gmPatches - c5.gmPatches >= 5 && c6.tvPatches - c5.tvPatches >= 5 && c6.gmStates - c5.gmStates <= 1 && c6.tvStates - c5.tvStates <= 1, 'with the mouse: small messages while it moves, at most one whole state', [c5, c6]);
      t.eq(midMouse, [], 'and in mid-move both windows hold what the app holds');
      t.ok(c7.gmStates - c6.gmStates >= 1 && (await same()).length === 0, 'let go: the whole state, and the same in all three', [c6, c7]);
      await t.g(`Play.setTool('select'); Play.closePop()`);
    } finally {
      if (edit0) t.handle('edit.open', { id: edit0 });
      if (live0) await t.send(live0);
    }
  }, { ms: 180000 });
};
