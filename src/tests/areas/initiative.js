// The turn order
'use strict';

module.exports = (area) => {
  area.title('Initiative');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const start = (t) => t.handle('init.start', { mapId: t.L().id, list: [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Ogre', init: 7 }] });
  const turnName = (t) => { const I = t.state.init; const e = I && I.entries.find((x) => x.id === I.turn); return e && e.name; };

  area.quick('a fight starts with the highest roll, Next goes down the order and round 2 begins after the last', async (t) => {
    const r = start(t);
    t.ok(t.state.init && t.state.init.running, 'the fight runs', r);
    t.eq(turnName(t), 'Mira', 'the first turn');
    t.handle('init.next', {});
    t.eq(turnName(t), 'Goblin', 'the second turn');
    t.handle('init.next', {});
    t.eq(turnName(t), 'Ogre', 'the third turn');
    const round0 = t.L().round.n || 0;
    t.handle('init.next', {});
    t.eq(turnName(t), 'Mira', 'back to the first after the last');
    t.eq(t.L().round.n, round0 + 1, 'the round after the last turn');
    t.handle('init.prev', {});
    t.eq(turnName(t), 'Ogre', 'Previous goes back');
    t.handle('init.end', {});
    t.ok(!t.state.init || !t.state.init.running, 'the fight ended');
  });

  area.quick('I opens the Initiative panel with the turn order in it', async (t) => {
    start(t);
    t.gm().webContents.focus();
    await t.key('I');
    const p = await t.until(async () => (await t.panels()).find((x) => x.id === 'init'), 3000, 'the Initiative panel');
    const text = await t.text('.fp[data-id="init"]');
    for (const name of ['Mira', 'Goblin', 'Ogre']) t.ok(text.includes(name), `${name} is in the panel`, text.slice(0, 200));
    t.handle('init.end', {});
  });

  area.quick('the turn order shows on the TV while the fight runs', async (t) => {
    start(t);
    await t.until(() => t.t(`!!document.querySelector('.tv-init, .init-hud, [class*="init"]')`), 4000, 'the turn order on the TV');
    const text = await t.t(`document.body.textContent`);
    t.ok(/Mira/.test(text), 'the TV names whose turn it is', text.replace(/\s+/g, ' ').slice(0, 200));
    t.handle('init.end', {});
  });

  // ---------- deep ----------
  const I = (t) => t.state.init;
  const E = (t, name) => I(t).entries.find((e) => e.name === name);
  const fresh = async (t) => {
    if (I(t) && I(t).running) t.handle('init.end', {});
    t.handle('init.clear', {});
    t.handle('party.set', { names: ['Ayla', 'Bo'] });
    for (const n of t.store.cur.meta.away || []) t.handle('party.away', { name: n, away: false });
    await t.settle();
  };
  // the HP column (added if the campaign has none yet)
  const hpCol = async (t) => {
    const find = () => (t.store.cur.meta.initCols || []).find((c) => c.kind === 'hp');
    if (!find()) await t.cmd('init.col', { add: { kind: 'hp' } });
    return find();
  };
  const fight = (t, list) => t.handle('init.start', { mapId: t.L().id, list });

  area.deep('getting ready: the players who are here and one row for each token on the map; nothing runs yet', async (t) => {
    await fresh(t);
    await t.cmd('init.prepare', {});
    const toks = t.L().layers.filter((l) => l.role === 'token');
    t.eq(I(t).running, false, 'the fight runs');
    t.eq(I(t).entries.filter((e) => e.pc).map((e) => e.name).sort(), ['Ayla', 'Bo'], 'the players in the list');
    const rows = I(t).entries.filter((e) => e.tokens.length);
    t.ok(rows.length >= 1 && rows.every((e) => e.tokens.length === 1), 'one row per token', rows.map((e) => [e.name, e.tokens.length]));
    t.ok(rows.length <= toks.length, 'no more rows than tokens', [rows.length, toks.length]);
  });

  area.deep('Roll enemies gives every enemy a number (d20 plus its bonus) and leaves the players empty', async (t) => {
    await fresh(t);
    await t.cmd('init.prepare', {});
    await t.cmd('init.add', { name: 'Skeleton', bonus: 2 });
    const r = await t.cmd('init.roll', {});
    t.ok(r.ok !== false, 'the roll', r);
    const npcs = I(t).entries.filter((e) => !e.pc);
    t.ok(npcs.length >= 1 && npcs.every((e) => e.init != null), 'every enemy has a number', npcs.map((e) => [e.name, e.init]));
    t.ok(I(t).entries.filter((e) => e.pc).every((e) => e.init == null), 'the players have none yet');
    const sk = E(t, 'Skeleton');
    t.ok(sk.roll && sk.roll.d20 >= 1 && sk.roll.d20 <= 20 && sk.init === sk.roll.d20 + 2, 'the Skeleton\'s number is its d20 plus 2', sk);
    const again = t.handle('init.roll', {});
    t.ok(again.ok === false, 'a second Roll enemies has nothing to roll', again);
  });

  area.deep('the list sorts from the highest number down; a new number moves its row', async (t) => {
    await fresh(t);
    fight(t, [{ name: 'A', init: 5 }, { name: 'B', init: 18 }, { name: 'C', init: 11 }]);
    t.eq(I(t).entries.map((e) => e.name), ['B', 'C', 'A'], 'the order at the start');
    t.handle('init.end', {});
    await fresh(t);
    await t.cmd('init.prepare', {});
    await t.cmd('init.add', { name: 'Rat' }); await t.cmd('init.add', { name: 'Cat' });
    await t.cmd('init.set', { id: E(t, 'Rat').id, init: 3 });
    await t.cmd('init.set', { id: E(t, 'Cat').id, init: 14 });
    await t.cmd('init.sort', {});
    const names = I(t).entries.filter((e) => e.init != null).map((e) => e.name);
    t.eq(names, ['Cat', 'Rat'], 'the order after sorting');
  });

  area.deep('HP: damage and healing add up, healing stops at the maximum, at 0 an enemy is down and its turn is skipped', async (t) => {
    await fresh(t);
    fight(t, [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Ogre', init: 7 }]);
    await t.settle();
    const col = await hpCol(t);
    t.ok(col, 'the turn order has an HP column');
    const g = () => E(t, 'Goblin');
    const hp = () => (g().vals[col.id] || {}).cur;
    t.handle('init.set', { id: g().id, vals: { [col.id]: { cur: 12, max: 12 } } });
    t.handle('init.set', { id: g().id, vals: { [col.id]: { delta: -7 } } });
    t.eq(hp(), 5, 'HP after 7 damage');
    t.handle('init.set', { id: g().id, vals: { [col.id]: { delta: 20 } } });
    t.eq(hp(), 12, 'healing stops at the maximum');
    t.handle('init.set', { id: g().id, vals: { [col.id]: { delta: -30 } } });
    t.ok(hp() <= 0, 'down to 0', hp());
    t.eq(turnName(t), 'Mira', 'whose turn it is');
    t.handle('init.next', {});
    t.eq(turnName(t), 'Ogre', 'Next skips the enemy at 0 HP');
    t.handle('init.end', {});
  });

  area.deep('Make group: its members share one turn and one number', async (t) => {
    await fresh(t);
    fight(t, [{ name: 'Mira', init: 15, pc: true }, { name: 'Skeleton 1', init: 12 }, { name: 'Skeleton 2', init: 9 }, { name: 'Ogre', init: 4 }]);
    const ids = ['Skeleton 1', 'Skeleton 2'].map((n) => E(t, n).id);
    const r = t.handle('init.group', { ids });
    t.ok(r.ok !== false, 'the group', r);
    const a = E(t, 'Skeleton 1'); const b = E(t, 'Skeleton 2');
    t.ok(a.group && a.group === b.group, 'both are in one group', [a.group, b.group]);
    t.eq(a.init, b.init, 'they share one number');
    const seen = [turnName(t)];
    for (let i = 0; i < 3; i++) { t.handle('init.next', {}); seen.push(turnName(t)); }
    t.eq(seen.filter((n) => /^Skeleton/.test(n)).length, 1, 'the group takes one turn in a round', seen);
    t.eq(seen[seen.length - 1], 'Mira', 'after the Ogre the round starts over', seen);
    t.handle('init.end', {});
  });

  area.deep('the TV shows names only; an enemy hidden from the players is left out; switched off, nothing shows', async (t) => {
    await fresh(t);
    fight(t, [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Lurker', init: 7 }]);
    await t.settle();
    const col = await hpCol(t);
    if (col) t.handle('init.set', { id: E(t, 'Goblin').id, vals: { [col.id]: { cur: 7, max: 7 } } });
    await t.cmd('init.set', { id: E(t, 'Lurker').id, hidden: true });
    await t.cmd('init.update', { show: true });
    const text = await t.until(async () => { const x = await t.t(`(() => { const e = document.querySelector('.tv-init'); return e && e.classList.contains('on') ? e.textContent : null; })()`); return x && /Mira/.test(x) && x; }, 4000, 'the turn order on the TV');
    t.ok(/Goblin/.test(text), 'the enemy the players know is named', text.slice(0, 200));
    t.ok(!/Lurker/.test(text), 'the hidden enemy is not named', text.slice(0, 200));
    t.ok(!/\b7\b/.test(text.replace(/Round \d+/g, '')), 'no HP on the TV', text.slice(0, 200));
    await t.cmd('init.update', { show: false });
    await t.until(() => t.t(`!document.querySelector('.tv-init').classList.contains('on')`), 4000, 'the turn order to leave the TV');
    t.ok(I(t).running, 'the fight still runs for the GM');
    await t.cmd('init.update', { show: true });
    t.handle('init.end', {});
  });

  area.deep('an entry taken out can be brought back; ending the fight gets the list ready for the next one', async (t) => {
    await fresh(t);
    fight(t, [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Rat', init: 3 }]);
    await t.cmd('init.remove', { id: E(t, 'Rat').id });
    t.ok(!E(t, 'Rat'), 'the Rat is out');
    await t.cmd('init.restore', {});
    t.ok(!!E(t, 'Rat') && I(t).running, 'the Rat is back and the fight still runs');
    await t.cmd('init.end', {});
    t.ok(!I(t) || !I(t).running, 'the fight is over');
    await t.cmd('init.prepare', {});
    t.eq(I(t).entries.filter((e) => e.pc).map((e) => e.name).sort(), ['Ayla', 'Bo'], 'the players are ready for the next fight');
    t.ok(I(t).entries.filter((e) => e.pc).every((e) => e.init == null), 'without numbers');
  });
};
