// The tool rail on the left and the keys: every tool opens
'use strict';

// id, key, what must be true afterwards
const RAIL = [
  ['map', 'M', { tool: 'map', pop: true }], ['grid', null, { pop: true }], ['fx', 'E', { tool: 'fx', pop: true }], ['asset', 'S', { tool: 'asset', pop: true }],
  ['walls', 'W', { tool: 'walls', pop: true }], ['layers', 'K', { pop: true }], ['sound', null, { pop: true }], ['toolbox', 'Q', { pop: true }],
  ['select', 'V', { tool: 'select' }], ['token', 'N', { tool: 'token', pop: true }], ['fog', 'R', { tool: 'fog', pop: true }], ['party', 'U', { tool: 'party', pop: true }],
  ['spell', 'A', { tool: 'spell', pop: true }], ['talk', 'O', { win: true }], // (Second Builder, second-conversation-stage: Conversation is a window of its own)
];
// the map tools in the Toolbox: label, tool, mode
const MAP_TOOLS = [['Ping', 'point', 'ping'], ['Laser', 'point', 'laser'], ['Spotlight', 'point', 'spot'], ['Ruler', 'point', 'measure'], ['Chalk', 'draw', 'chalk'], ['Pen', 'draw', 'pen'],
  ['Erase', 'draw', 'erase'], ['Marks', 'mark', 'marker']]; // (Third Builder (third-marks-tool): Text and Counter are kinds in Marks)

module.exports = (area) => {
  area.title('Tools and keys');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  // Beta 3.2: Build no longer folds by itself while the map is on the table; folded by hand, it stays folded
  area.quick('Build stays open on the table until you fold it; folded, it stays folded on other maps', async (t) => {
    const folded = () => t.g(`document.querySelector('.g-build').classList.contains('folded')`);
    t.gm().webContents.focus();
    await t.key('V');
    if (await folded()) { await t.clickSel('.rail-btn[data-id="build"]'); await t.until(async () => !(await folded()), 2000, 'Build open to start with'); }
    t.ok(t.state.liveMapId === t.state.editMapId, 'the map is on the table');
    t.ok(!(await folded()), 'Build is open while the map is on the table');
    await t.clickSel('.g-build .rail-fold-btn');
    await t.until(folded, 2000, 'Build to fold');
    const other = t.store.allMapIds().find((id) => id !== t.state.editMapId);
    t.handle('edit.open', { id: other });
    await t.until(() => t.g(`Play.state().map && Play.state().map.id === ${JSON.stringify(other)}`), 5000, 'the other map');
    t.ok(await folded(), 'still folded on another map');
    await t.clickSel('.rail-btn[data-id="build"]');
    await t.until(async () => !(await folded()), 2000, 'Build to open again');
    t.eq(await t.g(`localStorage.getItem('buildFolded')`), '0', 'remembered open');
    t.handle('edit.open', { id: t.state.liveMapId });
    await t.until(() => t.g(`Play.state().map && Play.state().map.id === ${JSON.stringify(t.state.liveMapId)}`), 5000, 'back on the map on the table');
    t.ok(!(await folded()), 'open on the map on the table');
  });

  const win = (id) => `.fp[data-id="${id}"]`;
  const after = async (t, id, want, open = true) => {
    if (want.win) { // a window of its own: the rail opens it, its key opens and closes it
      if (!open) { await t.until(async () => !(await t.count(win(id))), 3000, `the ${id} window to close`); return; }
      await t.until(() => t.count(win(id)), 3000, `the ${id} window`);
      const chars = await t.g(`document.querySelector('${win(id)} .fp-body').textContent.length`);
      t.ok(chars > 10, `the ${id} window has content`, chars);
      return;
    }
    if (want.tool) t.eq(await t.tool(), want.tool, `the tool after picking ${id}`);
    if (want.pop) {
      const title = await t.until(() => t.popTitle(), 3000, `the ${id} panel`);
      t.ok(title && title.length > 1, `the ${id} panel has a title`);
      const chars = await t.g(`document.querySelector('#pop.on').textContent.length`);
      t.ok(chars > title.length + 10, `the ${id} panel has content`, chars);
    }
  };

  for (const [id, key, want] of RAIL) {
    area.quick(`${id}: a click on the rail opens it${key ? `, and so does ${key}` : ''}`, async (t) => {
      t.ok(await t.count(`.rail-btn[data-id="${id}"]`) === 1, `the rail has a ${id} button`);
      await t.g(`document.querySelector('.rail-btn[data-id="${id}"]').click()`);
      await t.sleep(250);
      await after(t, id, want);
      if (!key) return;
      await t.calm();
      t.gm().webContents.focus();
      await t.key(key);
      await t.sleep(250);
      await after(t, id, want);
      if (want.win) { await t.key(key); await after(t, id, want, false); }
    });
  }

  area.quick('C picks the fog tool set to cover', async (t) => {
    t.gm().webContents.focus();
    await t.key('C');
    t.eq(await t.tool(), 'fog', 'the tool after C');
    t.eq(await t.g('Play.ui.fogMode'), 'cover', 'the fog mode after C');
    await t.key('R');
    t.eq(await t.g('Play.ui.fogMode'), 'reveal', 'the fog mode after R');
  });

  area.quick('L opens the library drawer with pictures, and closes it', async (t) => {
    t.gm().webContents.focus();
    await t.key('L');
    await t.until(() => t.g('Play.Drawer.isOpen'), 3000, 'the library drawer');
    await t.until(async () => (await t.g('Play.Drawer.items.length')) > 5, 5000, 'the library to list its files');
    await t.key('Escape');
    await t.until(async () => !(await t.g('Play.Drawer.isOpen')), 3000, 'the drawer to close with Esc');
  });

  area.quick('G shows and hides the grid', async (t) => {
    const m = () => t.E();
    const g0 = !!m().grid.show;
    t.gm().webContents.focus();
    await t.key('G');
    t.eq(!!m().grid.show, !g0, 'the grid after G');
    await t.key('G');
    t.eq(!!m().grid.show, g0, 'the grid after G again');
  });

  area.quick('Ctrl + , opens Options and ? opens the Guide', async (t) => {
    t.gm().webContents.focus();
    await t.key(',', ['control']);
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options');
    await t.g('App.closeOptions()');
    await t.g(`document.querySelector('.rail-btn[data-id="help"]').click()`);
    await t.until(() => t.g('Guide.isOpen()'), 3000, 'the Guide');
  });

  for (const [label, tool, mode] of MAP_TOOLS) {
    area.quick(`Toolbox → ${label} picks the map tool`, async (t) => {
      await t.g(`document.querySelector('.rail-btn[data-id="toolbox"]').click()`);
      await t.until(() => t.popTitle(), 3000, 'the Toolbox');
      const ok = await t.g(`(() => { const b = [...document.querySelectorAll('#pop .tb-tile')].find((x) => (x.querySelector('.tb-name, span') || x).textContent.trim() === ${JSON.stringify(label)} || x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
      t.ok(ok, `the Toolbox has a ${label} tile`);
      await t.sleep(250);
      t.eq(await t.tool(), tool, `the tool after ${label}`);
      const got = await t.g(`(() => { const u = Play.ui; return u.tool === 'point' ? u.point.mode : u.tool === 'mark' ? (u.mark.mode === 'counter' ? 'counter' : 'marker') : u.draw.mode; })()`);
      t.eq(got, mode, `the mode after ${label}`);
    });
  }

  area.quick('picking a tool shows its keys for a moment', async (t) => {
    await t.g(`localStorage.removeItem('toolHints')`);
    t.gm().webContents.focus();
    await t.key('R');
    const hint = await t.until(() => t.g(`(() => { const e = document.querySelector('#toolhint'); return e && e.classList.contains('on') ? e.textContent : null; })()`), 3000, 'the tool hint');
    t.ok(hint.length > 10, 'the hint says something', hint);
  });

  area.quick('undo and redo sit on the rail and work', async (t) => {
    const m = t.E();
    const n0 = m.layers.length;
    t.handle('layer.add', { mapId: m.id, path: t.pic('tokens'), role: 'token', x: m.grid.size * 2.5, y: m.grid.size * 2.5, size: 1 });
    t.eq(t.E().layers.length, n0 + 1, 'layers after adding a token');
    t.gm().webContents.focus();
    await t.key('Z', ['control']);
    await t.until(() => t.E().layers.length === n0, 3000, 'Ctrl + Z to take the token away');
    await t.key('Y', ['control']);
    await t.until(() => t.E().layers.length === n0 + 1, 3000, 'Ctrl + Y to bring it back');
    await t.key('Z', ['control']);
  });

  // Third Builder (third-small-labels): open points C2, C3, C7, C9, D2, D6, E1, H3 (Party marker)
  area.quick('labels say what they do and one thing has one name: Layers, Map, Grid, Walls, Tokens, Spells, the rail', async (t) => {
    const pop = async (tool, id, ms = 400) => { await t.g(`${tool ? `Play.setTool(${JSON.stringify(tool)}); ` : ''}Play.openPop(${JSON.stringify(id)})`); await t.sleep(ms); };
    const btns = () => t.g(`[...document.querySelectorAll('#pop .btn')].map((b) => b.textContent.trim())`);
    await pop(null, 'layers');
    const lay = await btns();
    for (const l of ['+ Token', '+ Effect', 'Ambience …']) t.ok(lay.includes(l), `Layers has "${l}"`, lay);
    await pop('map', 'map');
    const mp = await btns();
    t.ok(mp.includes('Squares 1 inch') && !mp.includes('Grid squares = 1 inch'), 'the Map panel names 1 inch as the Grid panel does', mp);
    await pop(null, 'grid');
    t.eq((await btns()).slice(0, 2), ['Match the print', 'Squares 1 inch'], 'the Grid panel has its two set-up buttons side by side (Beta 3.61)');
    await pop('walls', 'walls');
    t.ok((await btns()).includes('Remove all'), 'Walls: "Remove all" is a labelled button in the foot (Beta 3.61)', await btns());
    await pop('token', 'token');
    const tagRow = await t.g(`(() => { const r = document.querySelector('#pop .tag-all'); return r && r.parentElement.querySelector('.ctl-label').textContent; })()`);
    t.eq(tagRow, 'Name tags', 'Tokens: the row for all tokens is called Name tags');
    await pop('spell', 'spell');
    const look = () => t.g(`(document.querySelector('#pop .skin-grid .skin.on em') || {}).textContent`); // (Beta 3.61: every look has its name on its tile)
    await t.g(`document.querySelector('#pop .skin-grid .skin[data-v="psychic"]').click()`);
    await t.until(async () => (await look()) === 'Psychic', 2000, 'Spells: the picked look by name');
    await t.g(`document.querySelector('#pop .skin-grid .skin[data-v="fire"]').click()`);
    await t.until(async () => (await look()) === 'Fire', 2000, 'and again after another pick');
    t.eq(await t.count('#pop .skin-grid .skin em'), 17, 'all 17 looks are named');
    await t.g(`Play.closePop()`);
    t.eq(await t.g(`(document.querySelector('.rail-btn[data-id="party"] .rail-label') || {}).textContent`), 'Party', 'the rail: Party marker is short for Party (third-marks-tool: no tool is called Marker any more)');
    const tb = await t.g(`(() => { Play.openPop('toolbox'); const b = document.querySelector('#pop [data-id="atlas"]'); const r = b && [b.textContent.trim(), b.dataset.tip || '']; Play.closePop(); return r; })()`);
    t.ok(tb && tb[0].includes('Cartographer') && !/Atlas|Map table/.test(tb.join(' ')), 'the Toolbox tile says Cartographer and nothing else', tb);
  });

  // Third Builder (third-marks-tool): one Marks tool: kinds, text on a mark, Only me, labels and notes, one list, one Clear
  area.quick('Marks: pin with words, label, Only me, a note to the table and back, one list, one Clear; Sketch has no Text', async (t) => {
    const E = () => t.E();
    const tvCaps = () => t.t(`[...document.querySelectorAll('.sv-mark-cap')].map((e) => e.textContent)`);
    const clickAt = async (x, y) => { const p = await t.scr(x, y); await t.click(p.x, p.y); await t.sleep(250); };
    const n0 = { marks: E().marks.length, texts: E().draw.filter((d) => d.kind === 'text').length };
    t.gm().webContents.focus();
    await t.key('D');
    await t.until(() => t.popTitle(), 3000, 'the Sketch panel');
    t.eq(await t.popTitle(), 'Sketch', 'D opens Sketch');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .tile')].map((b) => b.textContent.trim())`), ['Chalk', 'Pen', 'Erase'], 'Sketch: no Text any more');
    await t.key('X');
    await t.until(async () => (await t.popTitle()) === 'Marks', 3000, 'the Marks panel');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .mk-kinds .tile')].map((b) => b.textContent.trim())`), ['Pin', 'Cross', 'Number', 'Label', 'Counter'], 'the kinds');
    // a pin that says something; the Text box is empty again afterwards
    await t.g(`Play.ui.mark.me = false; document.querySelector('#pop .mk-kinds .tile[data-v="pin"]').click()`);
    await t.sleep(200);
    await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Text"]'); i.value = 'Old well'; i.dispatchEvent(new Event('input')); })()`);
    await clickAt(6, 5);
    const pin = E().marks.find((m) => m.kind === 'pin' && m.text === 'Old well');
    t.ok(pin && !pin.hidden, 'a pin that says "Old well", on the table', E().marks.slice(-1));
    t.eq(await t.g(`document.querySelector('#pop input[aria-label="Text"]').value`), '', 'the Text box is empty again');
    await t.until(async () => (await tvCaps()).includes('Old well'), 3000, 'the TV shows what the pin says');
    // Only me: a number the TV never shows, with a dashed edge on the GM screen
    await t.g(`document.querySelector('#pop .mk-kinds .tile[data-v="dot"]').click()`);
    await t.g(`document.querySelector('#pop .mk-who .seg-btn[data-v="me"]').click()`);
    await t.sleep(200);
    await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Text"]'); i.value = 'Trap'; i.dispatchEvent(new Event('input')); })()`);
    await clickAt(9, 5);
    const dot = E().marks.find((m) => m.kind === 'dot' && m.text === 'Trap');
    t.ok(dot && dot.hidden, 'a number for Only me is hidden', dot);
    await t.sleep(400);
    t.ok(!(await tvCaps()).includes('Trap'), 'not on the TV');
    t.ok(await t.g(`!!document.querySelector('.sv-mark.kind-dot.is-hidden .sv-mark-cap')`), 'on the GM screen, marked as only yours');
    // a label for Only me is a note; its eye puts it on the table as a label, and back
    await t.g(`document.querySelector('#pop .mk-kinds .tile[data-v="label"]').click()`);
    await t.sleep(200);
    await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Text"]'); i.value = 'Silver key opens this door'; i.dispatchEvent(new Event('input')); })()`);
    await clickAt(12, 5);
    const note = E().marks.find((m) => m.kind === 'note' && m.text === 'Silver key opens this door');
    t.ok(note, 'Label + Only me makes a note', E().marks.slice(-1));
    const rowEye = (id) => t.g(`document.querySelector('#pop .mk-row[data-id="${id}"] .icon-btn').click()`);
    await rowEye(note.id);
    await t.until(() => E().draw.some((d) => d.kind === 'text' && d.text === 'Silver key opens this door' && !d.hidden), 3000, 'its eye: a label on the table');
    t.ok(!E().marks.some((m) => m.id === note.id), 'the note is gone');
    await t.until(async () => (await t.tvDebug()).texts.includes('Silver key opens this door'), 3000, 'the TV shows the label');
    const lab = E().draw.find((d) => d.kind === 'text' && d.text === 'Silver key opens this door');
    await rowEye(lab.id);
    await t.until(() => E().marks.some((m) => m.kind === 'note' && m.text === 'Silver key opens this door'), 3000, 'its eye again: back to a note only you see');
    // a label on the table
    await t.g(`document.querySelector('#pop .mk-who .seg-btn[data-v="table"]').click()`);
    await t.sleep(150);
    await t.g(`(() => { const i = document.querySelector('#pop input[aria-label="Text"]'); i.value = 'The Sunken Hall'; i.dispatchEvent(new Event('input')); })()`);
    await clickAt(15, 5);
    t.ok(E().draw.some((d) => d.kind === 'text' && d.text === 'The Sunken Hall' && !d.hidden), 'Label on the table: a label');
    // the list has every mark and label of this map; one Clear takes them all, Ctrl + Z brings them back
    const rows = await t.g(`[...document.querySelectorAll('#pop .mk-row .mk-text')].map((b) => b.textContent)`);
    for (const r of ['Old well', 'Silver key opens this door', 'The Sunken Hall']) t.ok(rows.includes(r), `the list has "${r}"`, rows);
    t.ok(rows.some((x) => / · Trap$/.test(x)), 'and the number that says Trap', rows);
    await t.clickText('#pop .btn', 'Clear');
    await t.until(() => !E().marks.some((m) => ['pin', 'x', 'dot', 'counter', 'note'].includes(m.kind)) && !E().draw.some((d) => d.kind === 'text'), 3000, 'Clear takes every mark and label');
    await t.key('Z', ['control']);
    await t.until(() => E().draw.filter((d) => d.kind === 'text').length === n0.texts + 1 && E().marks.length === n0.marks + 3, 3000, 'Ctrl + Z brings them back');
    // an old hotbar item for Draw → Text opens Marks → Label
    await t.g(`Play.hotRun({ kind: 'tool', ref: 'draw:text' })`);
    await t.sleep(300);
    t.eq([await t.tool(), await t.g('Play.ui.mark.mode')], ['mark', 'label'], 'Draw → Text from before is Marks → Label');
    await t.key('Escape'); await t.key('V');
  });
};
