// Beta 3.61: eight panels in the frame of Effects and Draw. Tools and groups stand on tabs at the panel's side, a
// banner shows what is in hand, rare settings fold away, a card of settings stands beside the panel, a foot says what
// is on the map. Every one fits the window before anything is unfolded.
'use strict';

module.exports = (area) => {
  area.title('Panels in the new frame');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const open = async (t, tool, id, pre = '') => { await t.g(`(() => { ${pre} Play.closePop(); ${tool ? `Play.setTool(${JSON.stringify(tool)}); ` : ''}Play.openPop(${JSON.stringify(id)}); })()`); await t.until(() => t.popTitle(), 3000, `the ${id} panel`); await t.sleep(250); };
  const tabs = (t, cls) => t.g(`[...document.querySelectorAll('#pop ${cls} .tile')].map((b) => b.textContent.trim())`);
  const tab = (t, cls, v) => t.g(`document.querySelector('#pop ${cls} .tile[data-v="${v}"]').click()`);
  const lit = (t, cls) => t.g(`[...document.querySelectorAll('#pop ${cls} .tile.on, #pop ${cls} .tile.open')].map((b) => b.dataset.v).join()`);
  // the panel with its foot inside the window, and nothing to scroll
  const fits = (t) => t.g(`(() => { const p = document.getElementById('pop'); const b = p.querySelector('.pop-body'); const r = p.getBoundingClientRect(); return { bottom: Math.round(r.bottom), win: innerHeight, scroll: b ? b.scrollHeight - b.clientHeight : 0, sides: p.classList.contains('with-sides') }; })()`);
  const checkFits = async (t, what) => { const f = await fits(t); t.ok(f.sides && f.bottom <= f.win && f.scroll <= 1, `${what} fits the window, nothing to scroll`, f); };
  const folds = (t) => t.g(`[...document.querySelectorAll('#pop details.fx-fold')].map((d) => d.querySelector('summary').textContent + (d.open ? ' (open)' : ''))`);

  area.quick('Spells: the shapes by name at the side, a banner, named looks, the card "When it is cast"', async (t) => {
    await open(t, 'spell', 'spell', 'Play.ui.spellFly = false;');
    t.eq(await tabs(t, '.sp-shapes'), ['Sphere', 'Cone', 'Line', 'Cube', 'Cylinder', 'Aura'], 'the six shapes, by name');
    await t.clickText('#pop .spell-row', 'Fireball');
    t.eq(await lit(t, '.sp-shapes'), 'sphere', 'Fireball lights Sphere');
    t.ok(/^Fireball.*sphere · fire · a burst$/.test(await t.text('#pop .sp-ban .cap')), 'the banner: the spell, its area, its look, a burst', await t.text('#pop .sp-ban .cap'));
    await checkFits(t, 'Spells');
    await tab(t, '.sp-shapes', 'line');
    await t.until(async () => (await t.g('Play.ui.spell.shape')) === 'line', 2000, 'Line picked at the side');
    t.ok(/line/.test(await t.text('#pop .sp-ban .cap')) && (await t.g(`document.querySelector('#pop .sp-art').dataset.shape`)) === 'line', 'the banner follows', await t.text('#pop .sp-ban .cap'));
    t.eq(await t.count('#pop .spell-row.on'), 0, 'a shape of your own: no preset is lit');
    await checkFits(t, 'Spells with the Width row of a line');
    t.eq(await t.count('#pop .pop-fly'), 0, 'the card is shut');
    for (const l of ['Count rounds', 'Spell sounds', 'Bursts fade after']) t.ok(!(await t.findText('#pop .pop-body .ctl-label', l)), `"${l}" is not in the panel`);
    t.ok(await t.findText('#pop .spell-pop .os-fxset', 'When it is cast'), 'the button "When it is cast"');
    await t.g(`document.querySelector('#pop .spell-pop .os-fxset').click()`); // (not by the mouse: the panel has just grown by the Width row and is moving up)
    await t.until(() => t.count('#pop .pop-fly'), 3000, 'the card beside the panel');
    const card = await t.g(`[...document.querySelectorAll('#pop .pop-fly .ctl-label')].map((x) => x.textContent)`);
    for (const l of ['Screen effect when cast', 'Players see the affected squares', 'Count rounds', 'Lasts', 'Spell sounds', 'Bursts fade after']) t.ok(card.includes(l), `the card has "${l}"`, card);
    await t.g(`document.querySelector('#pop .pop-fly .os-fly-head .icon-btn').click()`);
    await t.until(async () => !(await t.count('#pop .pop-fly')), 3000, 'the card shuts');
    // the foot counts the areas; Clear takes them
    const m = t.E(); const k = m.grid.size;
    t.ok(await t.g(`document.querySelector('#pop .sp-clear').disabled`) || m.spells.length > 0, 'Clear rests while there is nothing to clear');
    t.handle('spell.add', { mapId: m.id, name: 'Test area', shape: 'cube', size: 15, x: 6 * k, y: 6 * k, mode: 'stay' });
    await t.until(async () => /1 spell area on this map/.test(await t.text('#pop .os-status')), 3000, 'the foot counts it');
    await t.g(`document.querySelector('#pop .sp-clear').click()`);
    await t.until(() => t.E().spells.length === 0, 3000, 'Clear in the foot');
    await t.g(`Play.pickSpell(FXDATA.SPELLS.find((s) => s.name === 'Fireball')); Play.closePop(); Play.setTool('select')`);
  });

  area.quick('Map: the looks as pictures of the map, the sliders folded, Original and Reset in the foot', async (t) => {
    await open(t, 'map', 'map', 'Play.ui.mapFine = false; Play.ui.mapTurn = false;');
    t.ok((await t.text('#pop .map-ban .cap b')).length > 2 && /on the table/.test(await t.text('#pop .map-ban .cap')), 'the banner: its name and its size on the table', await t.text('#pop .map-ban .cap'));
    t.ok(await t.findText('#pop .map-ban .btn', 'Replace'), 'Replace on the banner');
    await t.until(async () => (await t.g(`[...document.querySelectorAll('#pop .look-presets .look-chip img')].filter((i) => i.getAttribute('src') && !i.hidden).length`)) === 6, 9000, 'six looks, each a picture of this map');
    t.eq(await folds(t), ['Fine-tune the colours', 'Turn the map'], 'two folds, both shut');
    await checkFits(t, 'Map');
    await t.g(`document.querySelector('#pop .look-chip[data-v="grim"]').click()`);
    await t.until(() => (t.E().look || {}).preset === 'grim', 3000, 'Grim');
    await t.until(async () => (await t.text('#pop .look-now')) === 'Colours: grim', 3000, 'the foot names the look');
    t.ok(!(await t.g(`document.querySelector('#pop .look-reset').disabled`)), 'Reset is ready');
    await t.g(`document.querySelector('#pop details[data-v="mapFine"] summary').click()`);
    await t.until(() => t.g(`[...document.querySelectorAll('#pop details[data-v="mapFine"] .ctl-label')].map((x) => x.textContent).join()`).then((x) => x === 'Brightness,Contrast,Saturation,Warmth'), 2000, 'the four sliders in their fold');
    await t.g(`document.querySelector('#pop .look-reset').click()`);
    await t.until(() => !t.E().look, 3000, 'Reset: the picture as it is');
    await t.until(async () => (await t.text('#pop .look-now')) === 'Colours: natural', 3000, 'natural again');
    await t.g(`Play.ui.mapFine = false; Play.closePop(); Play.setTool('select')`);
  });

  area.quick('Walls, Fog and Grid: tools at the side, tiles, folds', async (t) => {
    await open(t, 'walls', 'walls', `Play.ui.walls.mode = 'wall'; Play.ui.wallsMore = false;`);
    t.eq(await tabs(t, '.wl-modes'), ['Walls', 'Room', 'Door', 'Edit', 'Erase'], 'Walls: its five tools at the side');
    t.eq(await tabs(t, '.wl-kinds'), ['Wall', 'Window', 'Invisible'], 'the kind as three tiles');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .hint')].filter((e) => e.offsetParent && e.textContent.length > 40).length`), 0, 'no explanation texts in the panel');
    await checkFits(t, 'Walls');
    await tab(t, '.wl-modes', 'door');
    await t.until(async () => (await t.g('Play.ui.walls.mode')) === 'door', 2000, 'Door');
    t.eq(await tabs(t, '.wl-kinds'), ['Door', 'Secret door'], 'a door\'s two kinds');
    await tab(t, '.wl-kinds', '2');
    t.eq(await t.g('Play.ui.walls.door'), 2, 'Secret door picked');
    await tab(t, '.wl-kinds', '1');
    await tab(t, '.wl-modes', 'erase');
    await t.until(async () => (await t.g('Play.ui.walls.mode')) === 'erase', 2000, 'Erase');
    t.eq(await t.count('#pop .wl-kinds'), 0, 'no kind to pick for Erase');
    const m = t.E(); const k = m.grid.size; const n0 = m.walls.length;
    t.handle('wall.add', { mapId: m.id, segs: [[2 * k, 2 * k, 5 * k, 2 * k]] });
    await t.until(async () => new RegExp(`${n0 + 1} wall`).test(await t.text('#pop .wl-status')), 3000, 'the foot counts the walls');
    t.ok(await t.findText('#pop .os-status .btn', 'Load') && await t.findText('#pop .os-status .btn', 'Remove all'), 'Load and Remove all in the foot');
    t.handle('history.undo');
    await tab(t, '.wl-modes', 'wall');
    // Fog
    await open(t, 'fog', 'fog', `Play.ui.fogShape = 'brush'; Play.ui.fogMode = 'reveal'; Play.ui.fogAreasSet = false;`);
    t.eq(await tabs(t, '.fog-shapes'), ['Brush', 'Box', 'Room'], 'Fog: Brush, Box, Room at the side');
    t.eq(await tabs(t, '.fog-modes'), ['Reveal', 'Cover'], 'Reveal and Cover as two tiles');
    await checkFits(t, 'Fog');
    await tab(t, '.fog-shapes', 'rect');
    t.eq(await t.g('Play.ui.fogShape'), 'rect', 'Box');
    t.ok(await t.g(`!document.querySelector('#pop .ctl-slider').offsetParent`), 'no brush size for a box');
    await tab(t, '.fog-modes', 'cover');
    t.eq([await t.g('Play.ui.fogMode'), await lit(t, '.fog-modes')], ['cover', 'cover'], 'Cover, lit at once');
    await tab(t, '.fog-modes', 'reveal'); await tab(t, '.fog-shapes', 'brush');
    const areas = (m.areas || []).length;
    t.eq(await t.g(`document.querySelector('#pop details[data-v="fogAreas"]').open`), areas > 0, 'Marked areas: folded while there are none');
    t.handle('area.add', { mapId: m.id, name: 'Vault', rings: [[2 * k, 2 * k, 5 * k, 2 * k, 5 * k, 5 * k, 2 * k, 5 * k]] });
    await t.until(async () => new RegExp(`Marked areas · ${areas + 1}`).test(await t.text('#pop details[data-v="fogAreas"] summary')), 3000, 'the fold counts them');
    await open(t, 'fog', 'fog');
    t.ok(await t.g(`document.querySelector('#pop details[data-v="fogAreas"]').open`), 'and stands open once there is one');
    t.handle('history.undo');
    // Grid
    await open(t, null, 'grid', 'Play.ui.gridNudge = false; Play.ui.gridLook = false;');
    t.eq(await tabs(t, '.grid-kinds'), ['Squares', 'Hex rows', 'Hex columns'], 'Grid: the kind as three tiles');
    t.eq(await folds(t), ['Nudge it', 'Look'], 'tilt and shift, colour and opacity: folded');
    const g0 = t.E().grid.type;
    await tab(t, '.grid-kinds', 'hex-pointy');
    await t.until(() => t.E().grid.type === 'hex-pointy', 3000, 'Hex rows');
    await tab(t, '.grid-kinds', g0);
    await t.until(() => t.E().grid.type === g0, 3000, 'and back');
    await t.g(`Play.closePop(); Play.setTool('select')`);
  });

  area.quick('Ambience: one screen of three cards; the one that sounds says Playing', async (t) => {
    await open(t, null, 'sound');
    t.eq(await t.count('#pop .sound-tabs'), 0, 'no tabs');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .snd-card')].filter((c) => !c.hidden).map((c) => c.querySelector('header b').textContent)`), ['Chapter', 'This map', 'Fight'], 'Chapter, This map, Fight');
    await checkFits(t, 'Ambience');
    const chOf = () => t.g(`(() => { const S = Play.state(); const c = S.campaign.chapters.find((x) => x.maps.some((m) => m.id === S.editMapId)); return c ? { id: c.id, amb: c.ambience && c.ambience.name, vol: c.ambience && c.ambience.volume, fight: c.fight && c.fight.name } : null; })()`);
    const ch = await chOf();
    t.ok(ch && ch.amb, 'the demo chapter has an ambience', ch);
    {
      t.ok((await t.text('#pop .snd-card[data-v="chapter"] .snd-item')).includes(ch.amb), 'the chapter\'s ambience by name', ch.amb);
      await t.until(async () => (await t.text('#pop .snd-card[data-v="chapter"] .snd-state')) === 'Playing', 4000, 'the map is on the table: the chapter card says Playing');
      t.eq(await t.text('#pop .snd-now'), ch.amb, 'the foot names what plays');
      // Mute all
      await t.clickText('#pop .os-status .btn', 'Mute all');
      await t.until(async () => (await t.text('#pop .snd-card[data-v="chapter"] .snd-state')) === 'Muted', 3000, 'Mute all: the card says Muted');
      t.eq(await t.text('#pop .snd-now'), 'Everything is muted', 'and the foot');
      await t.clickText('#pop .os-status .btn', 'Unmute');
      await t.until(async () => (await t.text('#pop .snd-card[data-v="chapter"] .snd-state')) === 'Playing', 3000, 'Unmute brings it back');
      // its volume
      await t.g(`(() => { const i = document.querySelector('#pop .snd-card[data-v="chapter"] input.snd-vol'); i.value = 0.3; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await t.until(async () => Math.abs((await chOf()).vol - 0.3) < 0.011, 3000, 'the volume slider sets the ambience');
      t.eq(await t.text('#pop .snd-card[data-v="chapter"] .snd-vol2 output'), '30%', 'and says so');
      t.handle('chapter.ambience', { id: ch.id, volume: ch.vol });
    }
    // fight music: its item, Play it now, and the card that says Playing while the chapter waits
    const track = t.library.listLibrary().find((x) => /\.(ogg|mp3|wav)$/i.test(x.path) && x.name !== ch.amb); // (the starter sounds are .wav since I8)
    t.ok(await t.findText('#pop .snd-card[data-v="fight"] .snd-add', 'Choose fight music'), 'Fight: one dashed button while there is none');
    t.handle('chapter.fight', { id: ch.id, path: track.path });
    await t.until(async () => (await t.text('#pop .snd-card[data-v="fight"] .snd-item')).includes(track.name), 3000, 'the fight music by name');
    await t.clickText('#pop .snd-card[data-v="fight"] .btn', 'Play it now');
    await t.until(async () => (await t.text('#pop .snd-card[data-v="fight"] .snd-state')) === 'Playing', 4000, 'Play it now: the Fight card says Playing');
    t.eq([await t.text('#pop .snd-card[data-v="chapter"] .snd-state'), await t.text('#pop .snd-now')], ['Waits', track.name], 'the chapter waits; the foot names the fight music');
    await t.clickText('#pop .snd-card[data-v="fight"] .btn', 'Stop the fight music');
    await t.until(async () => (await t.text('#pop .snd-card[data-v="chapter"] .snd-state')) === 'Playing', 4000, 'stopped: the chapter plays again');
    t.handle('chapter.fight', { id: ch.id, path: null });
    // Start with Initiative: a switch right here
    const auto0 = await t.g('Play.state().settings.fightAuto !== false');
    await t.g(`document.querySelector('#pop .snd-card[data-v="fight"] .ctl-toggle input').click()`);
    await t.until(async () => (await t.g('Play.state().settings.fightAuto !== false')) === !auto0, 3000, 'the switch sets Start with Initiative');
    await t.g(`document.querySelector('#pop .snd-card[data-v="fight"] .ctl-toggle input').click()`);
    await t.until(async () => (await t.g('Play.state().settings.fightAuto !== false')) === auto0, 3000, 'and back');
    t.ok(await t.findText('#pop .snd-card[data-v="map"] .snd-add', 'Add a sound'), 'This map: Add a sound');
    await t.g('Play.closePop()');
  });

  area.quick('Tokens: four groups at the side, a banner, sizes by name, All tokens', async (t) => {
    await open(t, 'token', 'token', 'Play.ui.tokMore = false;');
    t.eq(await tabs(t, '.tok-groups'), ['Ready', 'Party', 'Recent', 'Starred'], 'the four groups');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .seg-sizes .seg-btn')].map((b) => b.textContent)`), ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Garg.'], 'sizes by name');
    t.eq(await folds(t), ['More'], 'Place hidden and Name tags fold under More');
    await checkFits(t, 'Tokens');
    // a token in hand: the banner names it, and it is in Recent
    const tk = t.lib('tokens')[0];
    await t.g(`Play.hotRun({ kind: 'token', ref: ${JSON.stringify({ path: tk.path, name: tk.name })}, label: ${JSON.stringify(tk.name)} })`);
    await t.until(async () => (await t.text('#pop .tok-ban .cap b')) === tk.name, 4000, 'the banner names the token in hand');
    t.ok(/a click · Medium/.test(await t.text('#pop .tok-ban .cap')), 'a click, its size', await t.text('#pop .tok-ban .cap'));
    await tab(t, '.tok-groups', 'recent');
    await t.until(() => t.count('#pop .tok-row .tok-pick.on'), 3000, 'Recent has it, lit');
    await t.g(`document.querySelector('#pop .seg-sizes [data-v="large"]').click()`);
    await t.until(async () => /a click · Large/.test(await t.text('#pop .tok-ban .cap')), 2000, 'Large: the banner follows');
    await t.g(`document.querySelector('#pop .seg-sizes [data-v="medium"]').click()`);
    // closed and opened again: the first group that has tokens
    await open(t, 'token', 'token', `Play.ui.tok.group = 'starred';`);
    t.ok((await t.count('#pop .tok-row .tok-pick')) > 0 && (await lit(t, '.tok-groups')) !== '', 'opened on a group that has tokens', await lit(t, '.tok-groups'));
    await t.clickText('#pop .os-status .btn', 'All tokens');
    await t.until(async () => (await t.panels()).some((p) => p.id === 'toklist'), 4000, 'All tokens: the list, with its folders');
    await t.clickText('#pop .os-status .btn', 'All tokens');
    await t.until(async () => !(await t.panels()).some((p) => p.id === 'toklist'), 4000, 'and away again');
    await t.g(`Play.closePop(); Play.setTool('select')`);
  });

  area.quick('Assets: groups and tools at the side, the Look card, a picked asset is the panel\'s card', async (t) => {
    await open(t, 'asset', 'asset', `Play.ui.assetTab = 'library'; Play.ui.assetFly = false; Play.ui.assetMode = 'stamp';`);
    t.eq([await tabs(t, '.as-groups'), await tabs(t, '.as-tools')], [['Library', 'Living'], ['Stamp', 'Scatter']], 'Library and Living, Stamp and Scatter');
    const a = t.lib('assets').find((x) => !x.builtin) || t.lib('assets')[0];
    await t.g(`Play.hotRun({ kind: 'asset', ref: ${JSON.stringify({ path: a.path, rel: a.rel, name: a.name })}, label: ${JSON.stringify(a.name)} })`);
    await t.until(async () => (await t.text('#pop .as-ban .cap b')) === a.name, 4000, 'the banner names the asset in hand');
    t.ok(/^a stamp · /.test((await t.text('#pop .as-ban .cap')).slice(a.name.length).trim()), 'a stamp, its squares', await t.text('#pop .as-ban .cap'));
    await checkFits(t, 'Assets');
    await tab(t, '.as-tools', 'scatter');
    await t.until(async () => /scatter · /.test(await t.text('#pop .as-ban .cap')), 2000, 'Scatter: the banner follows');
    t.ok(await t.g(`[...document.querySelectorAll('#pop .ctl-label')].some((x) => x.offsetParent && x.textContent === 'Spacing')`), 'and its rows show');
    await tab(t, '.as-tools', 'stamp');
    // one placed and picked: the panel is its card
    const m = t.E(); const g = m.grid.size;
    const r = t.handle('layer.add', { mapId: m.id, path: a.path, role: 'asset', x: 15 * g, y: 9 * g, w: 2 * g });
    const box = await t.until(() => t.rect(`.sv-asset[data-id="${r.selected}"]`), 5000, 'the asset on the map');
    await t.click(box.cx, box.cy);
    await t.until(() => t.count('#pop .as-ban .fx-ban-tag'), 4000, 'picked: the panel is its card');
    t.eq(await t.count('#pop .as-tools'), 0, 'no Stamp or Scatter for a picked one');
    t.ok(await t.g(`['Opacity', 'Darken', 'Hue', 'Turn'].every((k) => [...document.querySelectorAll('#pop .as-look .ctl-label')].some((x) => x.offsetParent && x.textContent === k))`), 'its look in the panel');
    await t.clickText('#pop .btn', 'All assets');
    await t.until(async () => !(await t.count('#pop .as-ban .fx-ban-tag')) && (await t.count('#pop .as-tools')), 4000, 'All assets lets go of it');
    t.handle('layer.remove', { mapId: m.id, id: r.selected });
    await t.g(`Play.closePop(); Play.setTool('select')`);
  });
  // Beta 3.68 (Glinn): the rail's panels lie behind the rail and slide out from under it, also when another one opens
  // from an open one (only the first slid before); the same panel built anew does not slide
  area.quick('a rail panel slides out from behind the rail, also when another one opens', async (t) => {
    const slides = () => t.g(`document.getElementById('pop').getAnimations().some((a) => a.animationName === 'pop-slide')`);
    await t.g(`Play.closePop(); Play.setTool('map'); Play.openPop('map')`);
    t.ok(await slides(), 'opened from closed: it slides');
    await t.sleep(500);
    const r = await t.g(`(() => { const p = document.getElementById('pop').getBoundingClientRect(); const rail = document.getElementById('rail').getBoundingClientRect(); return { gap: Math.round(p.left - rail.right), left: getComputedStyle(document.getElementById('pop')).borderLeftWidth }; })()`);
    t.ok(Math.abs(r.gap) <= 1 && r.left === '0px', 'against the rail, no border there', r);
    await t.g(`Play.openPop('grid')`);
    t.ok(await slides(), 'another panel from an open one: it slides again');
    await t.sleep(500);
    await t.g(`Play.openPop('grid')`);
    t.ok(!(await slides()), 'the same panel built anew: no slide');
    await t.g(`Play.closePop()`);
  });
};
