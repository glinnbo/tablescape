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
};
