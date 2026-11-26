// I3 (Glinn): Command search. One line always at the top of the GM screen: Ctrl K or / from anywhere, a few letters,
// Enter; Tab for another thing to do with the same line. It finds tokens, maps, spells, effects, the time of day, sounds,
// panels, the table's actions and the settings, and it understands dice and times.
'use strict';

module.exports = (area) => {
  area.title('Command search');
  area.before(async (K) => { await K.openDemo(); await K.send(); });
  const box = '#cmdk .ck-input';
  const type = async (t, q) => { await t.g(`(() => { Play.Search.focus(); const i = document.querySelector('${box}'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`); await t.sleep(150); };
  const press = (t, key, shift = false) => t.g(`document.querySelector('${box}').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`);
  const first = (t) => t.g(`(() => { const r = document.querySelector('#cmdk .ck-row.on'); return r ? { label: r.querySelector('b').textContent, verb: (r.querySelector('.ck-verb') || {}).textContent || '' } : null; })()`);
  const M = (t) => t.store.map(t.state.editMapId);
  const L = (t) => M(t).layers;

  area.quick('always at the top; Ctrl K and / open it, Esc closes it; typing in it is not for the map\'s keys', async (t) => {
    await t.g(`Play.closePop(); Play.setTool('select')`);
    const r = await t.rect('#cmdk .ck-bar');
    t.ok(r && r.y < 60 && r.w > 200, 'one line at the top of the GM screen', r);
    t.eq(await t.text('#cmdk .ck-kbd'), 'Ctrl K', 'it says how to reach it');
    t.gm().webContents.focus();
    await t.key('K', ['control']);
    await t.until(() => t.g(`document.activeElement === document.querySelector('${box}')`), 2000, 'Ctrl K: in it');
    t.ok(await t.g(`!document.querySelector('#cmdk .ck-list').hidden`), 'its list shows');
    t.ok((await t.text('#cmdk .ck-list')).includes('Try'), 'with nothing typed: what it can do');
    await t.key('H');
    t.eq((await t.g(`document.querySelector('${box}').value`)).toLowerCase(), 'h', 'a letter goes into the box …');
    t.ok(!L(t).some((l) => l.role === 'token' && l.hidden && /Goblin/.test(l.name || '')), '… and hides nothing on the map');
    await t.key('Escape');
    await t.until(() => t.g(`document.activeElement !== document.querySelector('${box}') && document.querySelector('#cmdk .ck-list').hidden`), 2000, 'Esc: back to the map');
    t.eq(await t.g(`document.querySelector('${box}').value`), '', 'and the box is empty again');
    await t.key('/');
    await t.until(() => t.g(`document.activeElement === document.querySelector('${box}')`), 2000, '/: in it too');
    await t.key('Escape');
  });

  area.quick('"gob": the goblins on this map first; Enter selects one, Tab picks Hide from the players', async (t) => {
    await type(t, 'gob');
    const f = await first(t);
    t.ok(f && /^Goblin \d/.test(f.label) && /^Select/.test(f.verb), 'a goblin on this map, Select', f);
    const gob = L(t).find((l) => l.role === 'token' && `${l.name} ${l.n}` === f.label);
    await press(t, 'Enter');
    await t.until(() => t.g(`Play.ui.selected === ${JSON.stringify(gob.id)}`), 2000, 'Enter: it is selected');
    t.ok(await t.g(`document.querySelector('#cmdk .ck-list').hidden`), 'and the list goes');
    await type(t, f.label);
    await press(t, 'Tab');
    t.ok((await first(t)).verb.includes('Hide from the players'), 'Tab: the next thing to do', await first(t));
    await press(t, 'Enter');
    await t.until(() => L(t).find((l) => l.id === gob.id).hidden === true, 2000, 'it is hidden from the players');
    t.handle('layer.update', { id: gob.id, hidden: false });
  });

  area.quick('dice, a countdown, the time of day, a spell, a panel and another map, each with Enter', async (t) => {
    await type(t, '2d6+3');
    t.eq((await first(t)).label, 'Roll 2d6 + 3', 'dice');
    await press(t, 'Enter');
    const roll = () => (t.state.dice && (t.state.dice.roll || t.state.dice)) || null;
    await t.until(() => roll() && roll().dice && roll().dice.length === 2, 3000, 'two dice rolled');
    t.eq(roll().total, roll().dice.reduce((x, d) => x + d.value, 0) + 3, 'plus 3');
    await t.cmd('dice.clear', {});
    await type(t, '5 min');
    await press(t, 'Enter');
    await t.until(() => t.state.timer, 3000, 'a countdown');
    t.ok(Math.abs((t.state.timer.total || t.state.timer.seconds || 300) - 300) < 2, 'of five minutes', t.state.timer);
    await t.cmd('timer.stop', {}).catch(() => {});
    await type(t, 'night');
    t.eq((await first(t)).label, 'Night', 'the time of day first');
    await press(t, 'Enter');
    await t.until(() => (M(t).light || {}).mood === 'night', 3000, 'this map at night');
    await type(t, 'fireball');
    await press(t, 'Enter');
    await t.until(() => t.g(`Play.ui.tool === 'spell' && Play.ui.spell.name === 'Fireball'`), 3000, 'Fireball in hand: a click on the map casts it');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    await type(t, 'soundboard');
    await press(t, 'Enter');
    await t.until(async () => (await t.panels()).some((x) => x.id === 'sound'), 3000, 'the Soundboard opens');
    await t.g(`Play.Floats.hide('sound')`);
    const ids = t.store.cur.meta.chapters.flatMap((c) => c.maps.map((m) => m.id || m));
    const other = t.store.map(ids.find((id) => id !== t.state.editMapId));
    await type(t, other.name);
    await press(t, 'Enter');
    await t.until(() => t.state.editMapId === other.id, 3000, `Go to: ${other.name}`);
  });

  area.quick('with nothing typed: what was used last comes first', async (t) => {
    await type(t, '');
    const txt = await t.text('#cmdk .ck-list');
    t.ok(txt.includes('Just now'), 'a group of what was used last', txt);
    t.eq((await first(t)).label, M(t).name, 'the last one on top');
    await press(t, 'Escape');
  });
  // (found while building I3) the number keys each keep their own job: Alt opens a map of this chapter, Ctrl + Shift
  // plays a starred Soundboard sound (it had taken Alt by mistake), Ctrl a Spotify mood, Shift a starred screen effect
  area.quick('number keys: Alt + 1 opens a map of this chapter, Ctrl + Shift + 1 plays a starred Soundboard sound', async (t) => {
    const ids = t.store.cur.meta.chapters.find((c) => c.maps.some((m) => (m.id || m) === t.state.editMapId)).maps.map((m) => m.id || m);
    const want = ids[1] || ids[0];
    t.gm().webContents.focus();
    await t.key(String(ids.indexOf(want) + 1), ['alt']);
    await t.until(() => t.state.editMapId === want, 3000, 'Alt + a number: that map of the chapter');
    const pad = await t.g(`(async () => { await Play.TB.loadLib(true); const p = Play.TB.boardPads()[0]; if (!p) return null; for (const f of p.files) await window.ts.library('fav', { path: f.path, on: true }); await Play.TB.loadLib(true); return p.key; })()`);
    t.ok(pad, 'a Soundboard sound to star');
    const n0 = (await t.sound()).board.length;
    await t.key('1', ['control', 'shift']);
    await t.until(async () => (await t.sound()).board.length > n0, 4000, 'Ctrl + Shift + 1: the starred sound plays');
    t.eq(t.state.editMapId, want, 'and the map stays');
    await t.g(`(async () => { const p = Play.TB.boardPads().find((x) => x.key === ${JSON.stringify(pad)}); for (const f of p.files) await window.ts.library('fav', { path: f.path, on: false }); })()`);
    await t.cmd('sound.stop');
  });

  // ---------- UI audit of 25 Nov 2026, group UI 3 (Open Points VC) ----------
  area.quick('VC2: "-" alone throws nothing; Ctrl K works from a field', async (t) => {
    await t.calm();
    const e0 = t.errors.length;
    await type(t, '-');
    t.eq(t.errors.length, e0, 'no error with "-"', t.errors.slice(e0));
    t.ok(!(await t.g(`document.querySelector('#cmdk .ck-list').hidden`)), 'the list shows');
    await type(t, '_');
    t.eq(t.errors.length, e0, 'nor with "_"', t.errors.slice(e0));
    await press(t, 'Escape');
    await t.g(`Play.Drawer.open({})`);
    await t.until(() => t.g(`document.activeElement === document.querySelector('#drawer .lib-search')`), 4000, 'the Library\'s search has the keyboard');
    t.gm().webContents.focus();
    await t.key('K', ['control']);
    await t.until(() => t.g(`document.activeElement === document.querySelector('${box}')`), 2000, 'Ctrl K from the Library\'s search');
    await press(t, 'Escape');
    await t.g(`Play.Drawer.close()`);
  });

  area.quick('VC3: a single setting is found, its section opens and its line lights up; the list is made once per opening', async (t) => {
    await t.calm();
    await type(t, 'calibrate');
    const f = await first(t);
    t.ok(f && /Calibrate/.test(f.label), 'a setting by its own name', f);
    await press(t, 'Escape');
    const n0 = await t.g(`Play.Search._made()`);
    await type(t, 'g'); await type(t, 'ga'); await type(t, 'gam'); await type(t, 'gamma');
    await press(t, 'ArrowDown'); await press(t, 'ArrowDown'); await press(t, 'ArrowUp'); await press(t, 'ArrowUp');
    const made = (await t.g(`Play.Search._made()`)) - n0;
    t.ok(made >= 1 && made <= 2, 'the list of everything is made once (twice when the library arrives meanwhile), not on every key', made);
    t.eq((await first(t)).label, 'Gamma', 'Gamma');
    await press(t, 'Enter');
    await t.until(() => t.g(`!!document.querySelector('.modal.options') && document.querySelector('.opt-body').dataset.id === 'picture'`), 4000, 'Tablescape settings → Picture');
    await t.until(() => t.g(`[...document.querySelectorAll('.opt-body .flash')].some((x) => /Gamma/.test(x.textContent))`), 3000, 'the Gamma line lights up');
    await t.g(`App.closeOptions()`);
  });

  area.quick('VC1: a panel dragged under the search line stops below it, and Conversation opens clear of it', async (t) => {
    await t.calm();
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    await t.g(`Play.TB.openPanel('dice')`);
    await t.until(() => t.rect('.fp[data-id="dice"] .fp-head'), 3000, 'the Dice panel');
    await t.sleep(300);
    const bar = await t.rect('#cmdk .ck-bar'); const head = await t.rect('.fp[data-id="dice"] .fp-head');
    await t.drag({ x: head.x + 60, y: head.cy }, { x: bar.cx, y: 3 }, 12);
    const h2 = await t.rect('.fp[data-id="dice"] .fp-head');
    t.ok(h2.x < bar.x + bar.w && h2.x + h2.w > bar.x, 'the panel is where the search line is', [h2, bar]);
    t.ok(!hit(h2, bar) && h2.y >= bar.y + bar.h, 'and its title bar is below it', [h2, bar]);
    await t.g(`Play.Floats.closeAll()`);
    t.gm().webContents.focus();
    await t.key('O');
    await t.until(() => t.rect('.fp[data-id="talk"] .fp-head'), 4000, 'the Conversation panel');
    await t.sleep(400);
    const th = await t.rect('.fp[data-id="talk"] .fp-head');
    t.ok(!hit(th, await t.rect('#cmdk .ck-bar')), 'Conversation\'s title bar is not under the search line', th);
    await t.g(`Play.Floats.closeAll()`);
  });

  area.deep('VC3: every setting a section shows is one the search knows', async (t) => {
    await t.calm();
    const own = `(x) => [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')`;
    const lines = await t.g(`App.settingLines().map((x) => x.id + '|' + x.label)`);
    const secs = await t.g(`App.optionSections().map((s) => ({ id: s.id, scope: s.scope }))`);
    const missing = []; const gone = [];
    for (const s of secs) {
      await t.g(`${s.scope === 'camp' ? 'App.openCampaignSettings' : 'App.openOptions'}(${JSON.stringify(s.id)})`);
      await t.sleep(450);
      const shown = await t.g(`[...document.querySelectorAll('.opt-body .ctl-label')].map(${own}).filter(Boolean)`);
      for (const l of shown) if (!lines.includes(`${s.id}|${l}`)) missing.push(`${s.id}: ${l}`);
      const all = await t.g(`[...document.querySelectorAll('.opt-body *')].map(${own})`); // (any text of the section: which element carries a word may change with what is picked)
      for (const l of lines.filter((x) => x.startsWith(`${s.id}|`))) if (!all.includes(l.slice(s.id.length + 1))) gone.push(l);
    }
    await t.g(`App.closeOptions()`);
    t.eq(missing, [], 'labels the search does not know yet (SETTING_LINES in gm.js)');
    t.eq(gone, [], 'lines in SETTING_LINES that no section shows any more');
  }, { ms: 60000 });
};
