// What plays over the whole TV: countdown, break, dice, the wheel of luck, death saves, screen effects
'use strict';

module.exports = (area) => {
  area.title('Countdown, dice and screen effects');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const tv = (t) => t.tvDebug();

  area.quick('a dice roll shows on the TV; the total is the dice plus the bonus', async (t) => {
    const r = await t.cmd('dice.roll', { pool: { 6: 2, 8: 1 }, bonus: 3 });
    t.ok(r.ok, 'the roll', r);
    const roll = t.state.dice && t.state.dice.roll ? t.state.dice.roll : (r.roll || t.state.dice);
    t.ok(roll && roll.dice && roll.dice.length === 3, 'three dice were rolled', roll);
    t.eq(roll.total, roll.dice.reduce((a, d) => a + d.value, 0) + 3, 'the total');
    t.ok(roll.dice.every((d) => d.value >= 1 && d.value <= d.sides), 'every die shows a number it has', roll.dice);
    await t.until(async () => { const d = (await tv(t)).dice; return d && d.on && d.kind === 'dice'; }, 4000, 'the dice on the TV');
    await t.cmd('dice.clear', {});
    await t.until(async () => { const d = (await tv(t)).dice; return !d || !d.on; }, 4000, 'the dice to leave the TV');
  });

  area.quick('a screen effect plays on the TV and ends by itself', async (t) => {
    const r = await t.cmd('moment.play', { id: 'earthquake' });
    t.ok(r.ok, 'the earthquake', r);
    await t.until(async () => { const m = (await tv(t)).moments; return m && (m.drawn.includes('earthquake') || /translate|rotate/.test(m.transform || '')); }, 5000, 'the earthquake on the TV');
    await t.until(() => !t.state.moments.some((m) => m.id === 'earthquake'), 20000, 'the earthquake to end');
  }, { ms: 40000 });

  area.deep('advantage rolls two d20 and drops the lower; disadvantage drops the higher', async (t) => {
    for (const [adv, pick] of [['adv', Math.max], ['dis', Math.min]]) {
      const r = await t.cmd('dice.roll', { pool: { 20: 1 }, bonus: 0, adv });
      const roll = t.state.dice.roll || r.roll;
      t.eq(roll.dice.length, 2, `two d20 with ${adv}`);
      const kept = roll.dice.filter((d) => !d.dropped);
      t.eq(kept.length, 1, 'one of them counts');
      t.eq(kept[0].value, pick(roll.dice[0].value, roll.dice[1].value), `the one that counts with ${adv}`);
      t.eq(roll.total, kept[0].value, 'the total');
      await t.cmd('dice.clear', {});
    }
    const none = t.handle('dice.roll', { pool: {} });
    t.ok(none.ok === false && /Pick some dice/.test(none.error), 'no dice picked is said so', none);
  });

  area.deep('a death save: a d20, 10 or more is a success', async (t) => {
    for (let i = 0; i < 4; i++) {
      await t.cmd('death.roll', {});
      const roll = t.state.dice.roll || t.state.dice;
      t.ok(roll.value >= 1 && roll.value <= 20, 'a number from 1 to 20', roll);
      t.eq(roll.good, roll.value >= 10, 'success from 10');
      t.eq(roll.label, roll.value >= 10 ? 'Success' : 'Failure', 'what it says');
    }
    await t.until(async () => { const d = (await tv(t)).dice; return d && d.on && d.kind === 'death'; }, 4000, 'the death save on the TV');
    await t.cmd('dice.clear', {});
  });

  area.deep('the wheel of luck lands on one of its entries', async (t) => {
    const wheels = await t.g(`(Play.state().wheels || (Play.state().campaign || {}).wheels || [])`);
    t.ok(wheels && wheels.length >= 1, 'the campaign has a wheel to spin', wheels);
    const w = wheels[0];
    const r = await t.cmd('wheel.spin', { id: w.id });
    t.ok(r.ok, 'the spin', r);
    const roll = t.state.dice.roll || t.state.dice;
    t.eq(roll.kind, 'wheel', 'what is on the TV');
    const labels = roll.entries.map((e) => e.label);
    const got = roll.result || roll.label || (roll.entries[roll.index] || {}).label;
    t.ok(labels.includes(typeof got === 'string' ? got : (got && got.label)), 'it landed on one of its entries', [got, labels]);
    await t.until(async () => { const d = (await tv(t)).dice; return d && d.on && d.kind === 'wheel'; }, 4000, 'the wheel on the TV');
    await t.cmd('dice.clear', {});
  });

  area.deep('a lasting screen effect stays until it is clicked again; Stop effects ends everything', async (t) => {
    await t.cmd('moment.play', { id: 'gas' });
    t.ok(t.state.moments.some((m) => m.id === 'gas' && !m.stop), 'the poison gas is on');
    await t.sleep(1500);
    t.ok(t.state.moments.some((m) => m.id === 'gas' && !m.stop), 'it is still on a moment later');
    const r = await t.cmd('moment.play', { id: 'gas' });
    t.ok(r.stopped, 'a second click stops it', r);
    await t.cmd('moment.play', { id: 'gas' });
    await t.cmd('moment.stop', {});
    await t.until(() => !t.state.moments.some((m) => !m.stop), 6000, 'Stop effects to end it');
  });

  area.deep('every screen effect starts without an error', async (t) => {
    const ids = await t.g(`Moments.LIST.map((m) => m.id)`);
    t.ok(ids.length >= 16, 'the screen effects the app knows', ids.length);
    for (const id of ids) {
      const r = await t.cmd('moment.play', { id, toggle: false });
      t.ok(r.ok, `${id} starts`, r);
      await t.sleep(350);
    }
    await t.cmd('moment.stop', {});
    await t.sleep(500);
  }, { ms: 60000 });

  // I8 (Glinn: some effects were outdated): frost, dread and madness are his frames; blood is the portraits' blood;
  // stones are cut from the rock tile. Each is there and each effect draws with it, without an error
  area.deep('the pictures the screen effects use are there, and every effect draws with them', async (t) => {
    const srcs = ['moments/frost.webp', 'moments/frost-haze.webp', 'moments/dread.webp', 'moments/madness.webp', 'looks/blood/blood-8.webp', 'looks/blood/blood-spray.webp', 'tiles/rock-small.webp', 'tiles/deep_water-small.webp'];
    const ok = await t.t(`Promise.all(${JSON.stringify(srcs)}.map((s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = s; })))`);
    t.eq(ok, srcs.map(() => true), 'each picture loads on the TV', srcs);
    const errs = await t.t(`(() => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 450; const ctx = c.getContext('2d'); const out = [];
      for (const d of Moments.LIST) for (const age of [0.2, 0.9, 2.5]) {
        try { ctx.setTransform(20, 0, 0, 20, 0, 0); Moments.draw(ctx, 40, 22.5, [{ key: 'k', id: d.id, seed: 7, x: d.spot ? 10 : null, y: d.spot ? 8 : null, t0: Date.now() - age * 1000, dur: d.dur, stop: null }], Date.now(), d.spot ? () => ({ x: 10, y: 8 }) : null, { sq: 1, lights: () => [{ x: 5, y: 5 }] }); }
        catch (e) { out.push(d.id + ': ' + e.message); }
      }
      return out;
    })()`);
    t.eq(errs, [], 'every effect draws, early, midway and late');
  });

  area.deep('a countdown can be paused, goes on where it stopped, and takes extra time', async (t) => {
    await t.cmd('timer.start', { seconds: 60, mode: 'normal' });
    await t.until(() => t.state.timer && t.state.timer.endsAt - Date.now() < 59000, 3000, 'a second to pass'); // (T2: waits for it, not 1.1 s)
    await t.cmd('timer.pause', {});
    const left = t.state.timer.left;
    t.ok(left > 55000 && left < 59500, 'paused with about 59 seconds left', left);
    await t.sleep(700);
    t.eq(t.state.timer.left, left, 'the time stands still while paused');
    await t.cmd('timer.resume', {});
    t.ok(t.state.timer.endsAt && Math.abs(t.state.timer.endsAt - Date.now() - left) < 400, 'it goes on from there', [t.state.timer.endsAt - Date.now(), left]);
    await t.cmd('timer.add', { seconds: 30 });
    t.ok(t.state.timer.endsAt - Date.now() > left + 25000, 'thirty seconds more', t.state.timer.endsAt - Date.now());
    await t.cmd('timer.stop', {});
    t.ok(!t.state.timer, 'stopped');
  });

  area.deep('a countdown that reaches zero leaves the TV by itself a little later', async (t) => {
    await t.cmd('timer.start', { seconds: 1, mode: 'dramatic' });
    t.ok(!!t.state.timer, 'the countdown runs');
    await t.until(() => !t.state.timer, 15000, 'the finished countdown to be cleared');
  }, { ms: 30000 });
  // I8 (Glinn): the Screen effects panel as pads. Starred, Once, Until stopped; a lasting one glows while it is on; a
  // right-click sets it up (Strength, Colour, Stays / Comes in) and it plays so on the TV; a pad dragged onto the map
  // plays there
  const gasLook = (t) => ((t.settings.momentLook || {}).gas || {});
  area.quick('Screen effects are pads: Starred, Once, Until stopped; one that is on glows; a right-click sets it up', async (t) => {
    await t.cmd('moment.stop', {});
    await t.g(`Play.closePop(); Play.setTool('select'); Play.TB.openPanel('moments')`);
    await t.until(() => t.rect('.fp[data-id="moments"] .mo-pad[data-id="frost"]'), 3000, 'the pads');
    t.eq(await t.g(`[...document.querySelectorAll('.fp[data-id="moments"] .tok-group')].map((x) => x.textContent)`), ['Starred', 'Once', 'Until stopped'], 'three sections');
    await t.clickSel('.fp[data-id="moments"] .mo-pad[data-id="frost"]');
    await t.until(() => t.state.moments.some((m) => m.id === 'frost' && !m.stop), 3000, 'a click plays it');
    await t.until(() => t.g(`document.querySelector('.fp[data-id="moments"] .mo-pad[data-id="frost"]').classList.contains('on')`), 3000, 'its pad glows while it is on');
    await t.clickSel('.fp[data-id="moments"] .mo-pad[data-id="frost"]');
    await t.until(() => !t.state.moments.some((m) => m.id === 'frost' && !m.stop), 3000, 'a click again stops it');
    try {
      const r = await t.rect('.fp[data-id="moments"] .mo-pad[data-id="gas"]');
      await t.g(`document.querySelector('.fp[data-id="moments"] .mo-pad[data-id="gas"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${r.cx}, clientY: ${r.cy} }))`);
      await t.until(() => t.rect('.pad-sheet'), 3000, 'its sheet');
      const pick = (label) => t.g(`[...document.querySelectorAll('.pad-sheet .seg-btn')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
      await pick('Strong');
      await t.until(() => gasLook(t).str === 1.6, 3000, 'Strong');
      await t.sleep(150);
      await t.g(`document.querySelectorAll('.pad-sheet .ps-sw button')[1].click()`);
      await t.until(() => gasLook(t).col === '#8a5cc4', 3000, 'another colour');
      await t.sleep(150);
      await pick('Slowly');
      await t.until(() => gasLook(t).len === 2, 3000, 'Comes in slowly');
      await t.key('Escape');
      t.ok(!(await t.rect('.pad-sheet')), 'Escape closes the sheet');
      await t.cmd('moment.play', { id: 'gas' });
      const m = t.state.moments.find((x) => x.id === 'gas' && !x.stop);
      t.eq(m && m.o, { str: 1.6, col: '#8a5cc4', len: 2 }, 'it plays as it was set up');
      await t.until(async () => (await tv(t)).moments.drawn.includes('gas'), 4000, 'and the TV draws it');
      await t.cmd('moment.stop', {});
      // a burst that stays longer
      await t.g(`ts.settings({ momentLook: { id: 'explosion', look: { len: 1.6 } } })`);
      await t.until(() => ((t.settings.momentLook || {}).explosion || {}).len === 1.6, 3000, 'Stays: Long');
      await t.cmd('moment.play', { id: 'explosion' });
      t.eq(t.state.moments.filter((x) => x.id === 'explosion').pop().dur, Math.round(Moments_dur(t, 'explosion') * 1.6), 'a long one lasts longer');
    } finally {
      await t.g(`ts.settings({ momentLook: { id: 'gas', look: null } }); ts.settings({ momentLook: { id: 'explosion', look: null } })`);
      await t.cmd('moment.stop', {});
      await t.g(`Play.Floats.hide('moments')`);
    }
  });
  const Moments_dur = (t, id) => require('../../renderer/moments.js').BY[id].dur;

  area.quick('a Screen effects pad dragged onto the map plays there; one for the whole table plays everywhere', async (t) => {
    await t.cmd('moment.stop', {});
    const drop = (id) => t.g(`(() => {
      const vp = document.getElementById('viewport'); const r = vp.getBoundingClientRect();
      const dt = new DataTransfer(); dt.setData('application/x-ts-moment', ${JSON.stringify(id)});
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5, dataTransfer: dt };
      vp.dispatchEvent(new DragEvent('dragover', at)); vp.dispatchEvent(new DragEvent('drop', at));
    })()`);
    await drop('explosion');
    await t.until(() => t.state.moments.some((m) => m.id === 'explosion'), 3000, 'the explosion');
    const ex = t.state.moments.filter((m) => m.id === 'explosion').pop();
    t.ok(ex.x != null && ex.y != null, 'where it was let go', ex);
    t.ok(!(await t.rect('.mo-aim')), 'its ring is gone once let go');
    await drop('earthquake');
    await t.until(() => t.state.moments.some((m) => m.id === 'earthquake'), 3000, 'the earthquake');
    t.ok(t.state.moments.filter((m) => m.id === 'earthquake').pop().x == null, 'over the whole table');
    await t.cmd('moment.stop', {});
  });
};
