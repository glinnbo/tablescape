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

  area.deep('a countdown can be paused, goes on where it stopped, and takes extra time', async (t) => {
    await t.cmd('timer.start', { seconds: 60, mode: 'normal' });
    await t.sleep(1100);
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
};
