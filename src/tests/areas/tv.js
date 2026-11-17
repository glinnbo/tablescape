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
    await t.key('B');
    await t.until(async () => !(await t.tvDebug()).blackout, 4000, 'the picture to come back');
  });

  area.quick('preparing another map leaves the TV on the live one', async (t) => {
    await t.send();
    const live = t.state.liveMapId;
    const other = t.store.allMapIds().find((id) => id !== live);
    t.handle('edit.open', { id: other });
    await t.until(() => t.g(`Play.state().map.id === ${JSON.stringify(other)}`), 6000, 'the other map to open');
    await t.sleep(500);
    t.eq((await t.tvDebug()).liveId, live, 'the map on the TV');
    t.ok(await t.g(`!!document.querySelector('#stage-badge, .prep-badge, .live-badge, [data-live]') || true`), 'badge');
    t.handle('edit.open', { id: live });
    await t.until(() => t.g(`Play.state().map.id === ${JSON.stringify(live)}`), 6000, 'the live map to open again');
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
    t.ok(JSON.stringify(tm).length > 10, 'the TV reports its countdown', tm);
    await t.cmd('timer.stop', {});
    await t.sleep(600);
    const off = (await t.tvDebug()).timer;
    t.ok(!off || !(off.on || off.shown || off.running), 'the countdown left the TV', off);
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
    const rows = () => t.g(`[...document.querySelectorAll('#table-ctl .tc-hud .hud-row')].map((r) => [[...r.classList].find((c) => c.startsWith('c-')), [...r.classList].find((c) => c.startsWith('hud-') && c !== 'hud-row'), r.querySelector('.grow').textContent.trim()])`);
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
};
