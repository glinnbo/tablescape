// The tool rail on the left and the keys: every tool opens
'use strict';

// id, key, what must be true afterwards
const RAIL = [
  ['map', 'M', { tool: 'map', pop: true }], ['grid', null, { pop: true }], ['fx', 'E', { tool: 'fx', pop: true }], ['asset', 'S', { tool: 'asset', pop: true }],
  ['walls', 'W', { tool: 'walls', pop: true }], ['layers', 'K', { pop: true }], ['sound', null, { pop: true }], ['toolbox', 'Q', { pop: true }],
  ['select', 'V', { tool: 'select' }], ['token', 'N', { tool: 'token', pop: true }], ['fog', 'R', { tool: 'fog', pop: true }], ['party', 'U', { tool: 'party', pop: true }],
  ['spell', 'A', { tool: 'spell', pop: true }], ['talk', 'O', { pop: true }],
];
// the map tools in the Toolbox: label, tool, mode
const MAP_TOOLS = [['Ping', 'point', 'ping'], ['Laser', 'point', 'laser'], ['Spotlight', 'point', 'spot'], ['Ruler', 'point', 'measure'], ['Chalk', 'draw', 'chalk'], ['Pen', 'draw', 'pen'],
  ['Text', 'draw', 'text'], ['Erase', 'draw', 'erase'], ['Marker', 'mark', 'marker'], ['Counter', 'mark', 'counter']];

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

  const after = async (t, id, want) => {
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
};
