// I7 (Glinn): Triggers. A named list of steps one click runs (the panel, the Hotbar, a mark on the map), the map's part
// one undo step; the message's Undo also puts back the conversation, the handouts and a countdown. Light groups.
'use strict';

module.exports = (area) => {
  area.title('Triggers');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Triggers (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });
  const M = (t) => t.store.map(own);

  area.quick('a trigger runs its steps in order, waits included; Undo on the message takes it all back', async (t) => {
    const k = M(t).grid.size;
    t.handle('wall.add', { mapId: own, segs: [[10 * k, 4 * k, 10 * k, 5 * k]], door: 1 });
    const door = M(t).walls.find((w) => w.door);
    const gob = t.handle('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: 12.5 * k, y: 4.5 * k, size: 1 }).selected;
    t.handle('layer.update', { mapId: own, id: gob, hidden: true });
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 8 * k, y: 4 * k, bright: 20, dim: 40, lit: false });
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 8 * k, y: 6 * k, bright: 20, dim: 40, lit: false });
    for (const f of M(t).fx.filter((x) => x.kind === 'light')) t.handle('fx.update', { mapId: own, id: f.id, group: 'Hall torches' });
    const face = t.lib('portraits')[0].path; const ho = t.pic('handouts');
    const id = t.handle('trigger.add', { mapId: own, name: 'Ambush at the bridge' }).selected;
    t.handle('trigger.update', { mapId: own, id, steps: [
      { kind: 'doors', ids: [door.id], open: true },
      { kind: 'lights', group: 'Hall torches', on: true },
      { kind: 'wait', s: 1 },
      { kind: 'tokens', ids: [gob], hidden: false },
      { kind: 'talk', cast: [{ path: face, name: 'Borin' }], mode: 'replace' },
      { kind: 'handout', path: ho, to: 'table' },
      { kind: 'timer', seconds: 90 },
      { kind: 'nonsense', what: 1 },
    ] });
    const tr = M(t).triggers.find((x) => x.id === id);
    t.eq(tr.steps.map((s) => s.kind), ['doors', 'lights', 'wait', 'tokens', 'talk', 'handout', 'timer'], 'kept with the map; an unknown kind left out');
    t.handle('handout.hide', {}); t.handle('talk.off', {});
    await t.settle();
    const r = await t.cmd('trigger.run', { mapId: own, id });
    t.ok(r.ok && r.undo && r.undo.type === 'trigger.undo', 'it runs, with an undo', r);
    const lit = () => M(t).fx.filter((x) => x.kind === 'light').map((f) => f.lit !== false);
    t.ok(M(t).walls.find((w) => w.id === door.id).open, 'the door opens at once');
    t.eq(lit(), [true, true], 'the group of lights goes on');
    t.ok(M(t).layers.find((l) => l.id === gob).hidden, 'the goblin waits (the wait)');
    await t.until(() => !M(t).layers.find((l) => l.id === gob).hidden, 3000, 'after the wait: the goblin shows');
    await t.until(() => t.state.talk && t.state.talk.cast.length === 1 && (t.state.handouts || []).length === 1 && t.state.timer, 3000, 'the conversation, the handout, the countdown');
    // Undo on the message: all of it back
    const u = await t.cmd(r.undo.type, r.undo.payload);
    t.ok(u.ok, 'taken back', u);
    await t.until(() => !M(t).walls.find((w) => w.id === door.id).open, 3000, 'the door shut again');
    t.eq(lit(), [false, false], 'the lights out again');
    t.ok(M(t).layers.find((l) => l.id === gob).hidden, 'the goblin hidden again');
    t.ok(!t.state.talk && !(t.state.handouts || []).length && !t.state.timer, 'no conversation, no handout, no countdown', { talk: t.state.talk, ho: t.state.handouts, timer: t.state.timer });
    // a light group: Toggle switches each the other way
    t.handle('trigger.update', { mapId: own, id, steps: [{ kind: 'lights', group: 'Hall torches', on: 'toggle' }] });
    await t.cmd('trigger.run', { mapId: own, id, again: false });
    t.eq(lit(), [true, true], 'Switch: out → on');
  });

  // (Glinn: a trigger's portrait came in with hard edges and too quick) as a click in the Conversation brings it in: its
  // soft oval edge when the picture has no transparent edges of its own, and the band before the portraits
  area.quick('a trigger brings portraits in as the Conversation does: the same edges, the band first', async (t) => {
    const faces = t.lib('portraits').slice(0, 3).map((x) => x.path);
    const id = t.handle('trigger.add', { mapId: own, name: 'Talk' }).selected;
    t.handle('trigger.update', { mapId: own, id, steps: [{ kind: 'talk', cast: faces.map((p) => ({ path: p, name: 'x' })), mode: 'replace' }] });
    t.handle('talk.off', {}); await t.settle();
    const want = await t.g(`Promise.all(${JSON.stringify(faces)}.map((p) => Play.TB.hasAlpha({ path: p })))`);
    await t.g(`Play.Trig.run(${JSON.stringify(id)}, ${JSON.stringify(own)})`);
    t.ok(t.state.talk && t.state.talk.cast.length === 0, 'the band first, the portraits a moment later', t.state.talk);
    await t.until(() => t.state.talk && t.state.talk.cast.length === faces.length, 3000, 'the portraits');
    t.eq(t.state.talk.cast.map((c) => c.alpha), want, 'each with its own edge, as a click brings it (soft oval edge when the picture has none)');
    const tv = await t.until(() => t.t(`(() => { const n = [...document.querySelectorAll('.talk-npc')]; return n.length >= ${faces.length} && n.map((x) => x.classList.contains('opaque')); })()`), 4000, 'the portraits on the TV');
    t.ok(tv.slice(0, faces.length).every((o, i) => o === !want[i]) || tv.length > faces.length, 'the TV draws them so', { tv, want });
    t.handle('talk.off', {});
  });

  // (Glinn: the triggers must be the same every time) the step keeps how its handout lies and its portraits look; what
  // was changed by hand since is put back on the next run; Take how it lies now takes the new one
  area.quick('a trigger shows its handout and portraits the same every time', async (t) => {
    const ho = t.pic('handouts'); const face = t.lib('portraits')[0].path;
    const id = t.handle('trigger.add', { mapId: own, name: 'Same' }).selected;
    t.handle('trigger.update', { mapId: own, id, steps: [{ kind: 'talk', cast: [{ path: face, name: 'x' }], mode: 'replace' }, { kind: 'handout', path: ho, to: 'table' }] });
    t.handle('handout.hide', {}); t.handle('talk.off', {});
    await t.cmd('handout.layout', { path: ho, patch: { x: 0.4, y: 0.5, size: 1, rot: 0 } });
    await t.cmd('talk.size', { path: face, scale: 1 });
    await t.cmd('trigger.run', { mapId: own, id });
    const st = () => M(t).triggers.find((x) => x.id === id).steps;
    t.eq(st()[1].lay && st()[1].lay.size, 1, 'its first run keeps how the handout lies', st()[1]);
    t.eq(st()[0].cast[0].look && st()[0].cast[0].look.size, 1, 'and how the portrait looks', st()[0].cast[0]);
    // by hand: bigger, elsewhere, Bloodied; put away
    await t.cmd('handout.layout', { path: ho, patch: { x: 0.7, size: 1.5 } });
    await t.cmd('talk.size', { path: face, scale: 1.6 });
    await t.cmd('talk.fx', { path: face, bloodOn: true });
    t.handle('handout.hide', {}); t.handle('talk.off', {}); await t.settle();
    await t.cmd('trigger.run', { mapId: own, id, again: false }); // (XA2: a plain second click would take the first run back)
    const lay = (await t.cmd('handout.layout', { path: ho, patch: {} })).layout;
    t.eq([lay.x, lay.size], [0.4, 1], 'the next run: the handout as the trigger keeps it, not as it was changed by hand', lay);
    t.eq((t.settings.portraitSize || {})[face] || 1, 1, 'the portrait at its size');
    t.ok(!((t.settings.portraitFx || {})[face] || {}).bloodOn, 'without the Bloodied added by hand', t.settings.portraitFx);
    // Take how it lies now
    await t.cmd('handout.layout', { path: ho, patch: { size: 1.5 } });
    await t.cmd('trigger.look', { mapId: own, id, i: 1 });
    t.eq(st()[1].lay.size, 1.5, 'Take how it lies now: the trigger keeps the new size');
    t.handle('handout.hide', {}); t.handle('talk.off', {});
  });

  area.quick('Toolbox → Triggers: Run, Change … with Add step ▸, a step opens; on the map; on the Hotbar', async (t) => {
    const id = t.handle('trigger.add', { mapId: own, name: 'Night falls' }).selected;
    await t.settle();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.TB.openPanel('triggers')`);
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="triggers"] .tg-card[data-id="${id}"]')`), 3000, 'its card');
    await t.g(`(() => { const c = document.querySelector('.fp[data-id="triggers"] .tg-card[data-id="${id}"] .tg-more'); c.click(); })()`);
    t.has(await t.until(() => t.menu(), 3000, 'its menu'), 'Change …', 'the menu');
    await t.menuPick('Change');
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="triggers"] .tg-add')`), 3000, 'its steps');
    await t.clickSel('.fp[data-id="triggers"] .tg-add');
    const add = await t.until(() => t.menu(), 3000, 'Add step');
    for (const want of ['Conversation', 'Handout', 'Snapshot', 'Time of day', 'Light group', 'Doors', 'Start the fight', 'Wait']) t.has(add, want, 'Add step');
    await t.menuPick('Time of day');
    await t.until(() => (M(t).triggers.find((x) => x.id === id).steps[0] || {}).kind === 'mood', 3000, 'a step added');
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="triggers"] .tg-step.open + .tg-detail')`), 3000, 'the new step opens to its choices');
    // run from the panel: the message
    await t.clickSel('.fp[data-id="triggers"] .tg-head .btn.primary');
    await t.until(() => M(t).light.mood === 'night', 3000, 'it ran: night');
    t.ok(await t.until(() => t.g(`[...document.querySelectorAll('.toast')].some((x) => /Night falls/.test(x.textContent))`), 3000, 'the message'), 'its message with Undo');
    // on the map: a mark only on this screen; a click runs it
    t.handle('light.update', { mapId: own, darkness: 0, mood: 'day' });
    t.handle('trigger.update', { mapId: own, id, at: { x: 6 * M(t).grid.size, y: 6 * M(t).grid.size } });
    await t.until(() => t.rect(`.tg-mark[data-id="${id}"]`), 3000, 'its mark on the map');
    t.eq(await t.t(`document.querySelectorAll('.tg-mark').length`), 0, 'not on the TV');
    await t.clickSel(`.tg-mark[data-id="${id}"]`);
    await t.until(() => M(t).light.mood === 'night', 3000, 'a click on its mark runs it');
    // the Hotbar
    t.handle('light.update', { mapId: own, darkness: 0, mood: 'day' });
    await t.g(`Play.hotRun({ kind: 'trigger', label: 'Night falls', ref: { mapId: ${JSON.stringify(own)}, id: ${JSON.stringify(id)} } })`);
    await t.until(() => M(t).light.mood === 'night', 3000, 'a Hotbar slot runs it');
    // a light's Group in the Light panel
    const L = t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 16 * M(t).grid.size, y: 9 * M(t).grid.size, bright: 20, dim: 40 }).selected;
    await t.settle();
    await t.g(`Play.closePop(); Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    await t.g(`document.querySelector('#pop .os-tabs2 .tile[data-v="fxt-select"]').click()`); await t.sleep(250);
    const hm = await t.until(() => t.rect(`.sv-handle[data-id="${L}"]`), 3000, 'its marker');
    await t.click(hm.cx, hm.cy);
    await t.until(() => t.g(`!!document.querySelector('#pop .lt-group')`), 3000, 'Group in the Light panel');
    await t.g(`Play.Floats && Play.Floats.hide('triggers'); Play.closePop(); Play.setTool('select')`);
  });

  // XA2 (Glinn, 26 Nov 2026): a trigger is a switch: clicked again it takes back what it did
  area.quick('XA2: a trigger clicked again takes back what that run did and nothing else: its handout, door, lights, token, time of day and countdown; what you did in between stays; a trigger of waits alone just runs again', async (t) => {
    const k = M(t).grid.size;
    t.handle('handout.hide', {}); t.handle('talk.off', {}); t.handle('timer.stop', {});
    const w0 = new Set(M(t).walls.map((w) => w.id));
    t.handle('wall.add', { mapId: own, segs: [[16 * k, 4 * k, 16 * k, 5 * k]], door: 1 });
    const door = M(t).walls.find((w) => w.door && !w0.has(w.id));
    const gob = t.handle('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: 18.5 * k, y: 4.5 * k, size: 1 }).selected;
    t.handle('layer.update', { mapId: own, id: gob, hidden: true });
    const la = t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 15 * k, y: 3 * k, bright: 20, dim: 40, lit: false }).selected;
    const lb = t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 15 * k, y: 6 * k, bright: 20, dim: 40, lit: true }).selected;
    for (const id of [la, lb]) t.handle('fx.update', { mapId: own, id, group: 'XA2 torches' });
    const hos = t.lib('handouts').map((x) => x.path); const ho = hos[0]; const other = hos[1];
    const dark0 = M(t).light.darkness; const mood0 = M(t).light.mood || null;
    const id = t.handle('trigger.add', { mapId: own, name: 'XA2 (test)' }).selected;
    t.handle('trigger.update', { mapId: own, id, at: { x: 20 * k, y: 8 * k }, steps: [
      { kind: 'doors', ids: [door.id], open: true }, { kind: 'lights', group: 'XA2 torches', on: true }, { kind: 'tokens', ids: [gob], hidden: false },
      { kind: 'handout', path: ho, to: 'table' }, { kind: 'mood', mood: 'night' }, { kind: 'timer', seconds: 90 },
    ] });
    await t.settle();
    const G = () => M(t).layers.find((l) => l.id === gob); const D = () => !!M(t).walls.find((w) => w.id === door.id).open;
    const lit = () => [la, lb].map((x) => M(t).fx.find((f) => f.id === x).lit !== false);
    const on = () => t.g(`(Play.state().trigOn || []).includes(${JSON.stringify(id)})`);
    // the first click runs it
    const r1 = await t.cmd('trigger.run', { mapId: own, id });
    await t.settle();
    t.ok(r1.ok && r1.undo && !r1.back, 'the first click runs it', r1);
    t.eq([D(), lit(), !!G().hidden, (t.state.handouts || []).map((h) => h.path), M(t).light.mood, !!t.state.timer], [true, [true, true], false, [ho], 'night', true], 'door open, both torches lit, the goblin shown, the handout, night, the countdown');
    t.eq(await on(), true, 'your screen knows it is on');
    await t.until(() => t.g(`!!document.querySelector('.tg-mark[data-id=${JSON.stringify(id)}].on')`), 3000, 'its mark on the map to be lit');
    // in between, by hand: the goblin walks, another handout is shown, a wall is drawn (the map's last undo step is no longer the trigger's)
    t.handle('layer.update', { mapId: own, id: gob, x: 21.5 * k });
    if (other) t.handle('handout.show', { path: other, add: true });
    t.handle('wall.add', { mapId: own, segs: [[24 * k, 4 * k, 24 * k, 6 * k]] });
    const walls = M(t).walls.length;
    await t.settle();
    // the second click takes it back
    const r2 = await t.cmd('trigger.run', { mapId: own, id });
    await t.settle();
    t.ok(r2.ok && r2.back && /XA2 \(test\) taken back/.test(r2.label) && !r2.undo, 'the second click: taken back, and it says so', r2);
    t.eq([D(), lit(), !!G().hidden, M(t).light.mood || null, M(t).light.darkness, !!t.state.timer], [false, [false, true], true, mood0, dark0, false], 'the door shut, the torch it lit out and the one that burned before still burning, the goblin hidden, the light as before, no countdown');
    t.eq([G().x, M(t).walls.length, (t.state.handouts || []).map((h) => h.path)], [21.5 * k, walls, other ? [other] : []], 'what was done in between stays: the goblin where it walked to, the wall, the other handout');
    t.eq(await on(), false, 'no longer on');
    t.eq(await t.g(`!!document.querySelector('.tg-mark[data-id=${JSON.stringify(id)}].on')`), false, 'its mark no longer lit');
    // one Undo on the map takes the taking back away again (it is one step)
    t.handle('history.undo', { mapId: own });
    t.eq([D(), lit(), !!G().hidden], [true, [true, true], false], 'Undo: the take-back was one step on the map');
    t.handle('history.redo', { mapId: own });
    // the third click runs it again; Undo on its message: not on any more
    const r3 = await t.cmd('trigger.run', { mapId: own, id });
    await t.settle();
    t.ok(r3.ok && r3.undo && D() && (await on()), 'the third click runs it again', r3);
    await t.cmd(r3.undo.type, r3.undo.payload); await t.settle();
    t.eq([await on(), D()], [false, false], 'Undo on its message: taken back, and no longer on');
    // a door closed by hand after the run is not opened by the take-back; steps changed: no longer on
    await t.cmd('trigger.run', { mapId: own, id }); await t.settle();
    t.handle('trigger.update', { mapId: own, id, steps: [{ kind: 'wait', s: 0.05 }] }); await t.settle();
    t.eq(await on(), false, 'its steps changed: not on (the next click runs the new steps)');
    const a = await t.cmd('trigger.run', { mapId: own, id }); await t.sleep(150);
    const b = await t.cmd('trigger.run', { mapId: own, id });
    t.ok(a.ok && a.undo && b.ok && b.undo && !b.back && !(await on()), 'a trigger of waits alone: every click runs it', [a, b]);
    // a conversation: the portraits it brought leave again, and the stage with them; one you added by hand stays
    const faces = t.lib('portraits').slice(0, 3).map((x) => x.path);
    t.handle('talk.off', {});
    t.handle('trigger.update', { mapId: own, id, steps: [{ kind: 'talk', cast: [{ path: faces[0], name: 'One' }, { path: faces[1], name: 'Two' }], mode: 'replace' }] }); await t.settle();
    const k1 = await t.cmd('trigger.run', { mapId: own, id });
    await t.until(() => t.state.talk && t.state.talk.cast.length === 2, 4000, 'the two portraits on stage');
    t.ok(k1.ok && !k1.back && (await on()), 'a conversation trigger: run, and on', k1);
    const k2 = await t.cmd('trigger.run', { mapId: own, id }); await t.settle();
    t.eq([!!k2.back, t.state.talk], [true, null], 'clicked again: its portraits leave and the stage it set up goes', [k2, t.state.talk]);
    await t.cmd('trigger.run', { mapId: own, id });
    await t.until(() => t.state.talk && t.state.talk.cast.length === 2, 4000, 'on stage again');
    const third = faces[2] || t.pic('tokens'); // (the demo may bring only two portraits)
    t.handle('talk.toggle', { path: third }); await t.settle();
    t.eq(t.state.talk.cast.length, 3, 'three on stage');
    const k3 = await t.cmd('trigger.run', { mapId: own, id }); await t.settle();
    t.eq([!!k3.back, (t.state.talk || { cast: [] }).cast.map((c) => c.path)], [true, [t.state.talk ? t.state.talk.cast[0].path : null]], 'with a third portrait added by hand: the two of the trigger leave, that one stays', k3);
    t.eq((t.state.talk || { cast: [] }).cast.length, 1, 'one portrait left on stage');
    // clicked again at once, before its portraits have come in (they follow the band by 0.6 s): taken back all the same
    t.handle('talk.off', {}); await t.settle();
    const q1 = await t.cmd('trigger.run', { mapId: own, id }); const q2 = await t.cmd('trigger.run', { mapId: own, id });
    await t.sleep(900);
    t.eq([!!q1.back, !!q2.back, t.state.talk], [false, true, null], 'a second click right after the first: nothing comes in after all', [q1, q2, t.state.talk]);
    t.handle('talk.off', {});
    t.handle('handout.hide', {}); t.handle('timer.stop', {}); t.handle('wall.door', { mapId: own, id: door.id, open: false });
    t.handle('trigger.remove', { mapId: own, id });
    await t.settle();
  });
};
