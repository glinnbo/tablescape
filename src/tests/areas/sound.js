// Sound: everything the table hears is played by the sound window
'use strict';

module.exports = (area) => {
  area.title('Sound');
  area.before(async (K) => { await K.openDemo(); await K.send(); await K.until(() => K.W().sound, 8000, 'the sound window'); });

  const amb = (d) => (d.tracks || []).find((x) => x.key.startsWith('amb:'));

  area.quick('the chapter\'s ambience plays once the map is on the TV', async (t) => {
    const d = await t.until(async () => { const x = await t.sound(); const a = amb(x); return x.state === 'running' && a && a.playing && a.t > 0 && x; }, 10000, 'the ambience to play');
    t.eq(d.errors, [], 'errors of the sound window');
  });

  area.quick('Mute fades all table sound out and brings it back', async (t) => {
    const g0 = (await t.sound()).gains.master;
    t.ok(g0 > 0.5, 'sound is on before', g0);
    t.handle('sound.quiet', {});
    await t.until(async () => (await t.sound()).gains.master < 0.05, 6000, 'the sound to fade out');
    t.eq(!!t.state.quiet, true, 'Mute in the app');
    t.handle('sound.quiet', {});
    await t.until(async () => (await t.sound()).gains.master > 0.5, 6000, 'the sound to come back');
  });

  area.quick('a sound from the Soundboard is played on the table', async (t) => {
    const sfx = t.lib('sfx')[0] || t.library.listLibrary().find((x) => /SFX/.test(x.path));
    t.ok(sfx, 'the library has a sound effect');
    const n0 = (await t.sound()).board.length;
    const r = t.handle('sound.play', { path: sfx.path });
    t.ok(r.ok, 'the sound is accepted', r);
    await t.until(async () => (await t.sound()).board.length === n0 + 1, 4000, 'the sound to be played');
  });

  area.quick('a spell with a sound is heard when it is cast', async (t) => {
    t.gm().webContents.focus();
    await t.key('A');
    await t.clickText('#pop .spell-row', 'Fireball');
    const k = t.L().grid.size;
    const n0 = (await t.sound()).spells.length;
    const at = await t.scr(14 * k, 10 * k);
    await t.click(at.x, at.y);
    const d = await t.until(async () => { const x = await t.sound(); return x.spells.length > n0 && x; }, 5000, 'the spell\'s sound');
    t.has(d.spells, 'fire', 'the sounds played for spells');
  });

  area.deep('fight music fades in over the ambience while a fight runs, and out when it ends', async (t) => {
    const music = t.library.listLibrary().find((x) => /Music/.test(x.path) && x.kind === 'audio') || t.library.listLibrary().find((x) => x.kind === 'audio');
    t.ok(music, 'the library has music');
    const ch = t.store.chapterOf(t.L().id);
    const r = t.handle('chapter.fight', { id: ch.id, path: music.path });
    t.ok(r && r.ok !== false, 'fight music is set for the chapter', r);
    t.handle('init.start', { mapId: t.L().id, list: [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }] });
    const d = await t.until(async () => { const x = await t.sound(); const f = (x.tracks || []).find((y) => y.key.startsWith('fight:')); return f && f.playing && x.gains.music < 0.3 && x; }, 8000, 'the fight music to take over');
    t.ok(d.gains.fight > 0.5, 'the fight music is up', d.gains);
    t.handle('init.end', {});
    await t.until(async () => (await t.sound()).gains.music > 0.95, 8000, 'the ambience to come back');
    t.handle('chapter.fight', { id: ch.id, path: null });
  });

  area.deep('while a Soundboard sound plays the ambience dips, and comes back afterwards', async (t) => {
    await t.until(async () => { const a = amb(await t.sound()); return a && a.playing; }, 10000, 'the ambience');
    const sfx = t.lib('sfx')[0] || t.library.listLibrary().find((x) => /SFX/.test(x.path));
    t.near((await t.sound()).gains.duck, 1, 0.05, 'the ambience at full before');
    t.handle('sound.play', { path: sfx.path });
    await t.until(async () => { const d = await t.sound(); return d.ducking || d.gains.duck < 0.9; }, 4000, 'the ambience to dip');
    await t.until(async () => { const d = await t.sound(); return !d.ducking && d.gains.duck > 0.95; }, 20000, 'the ambience to come back');
  }, { ms: 60000 });

  area.deep('a sound placed on the map plays with it, follows its volume and mute, and stops when removed', async (t) => {
    const m = t.L();
    const file = t.library.listLibrary().find((x) => x.kind === 'audio' && /Ambience/.test(x.path) && !(m.layers || []).some((l) => l.path === x.path)) || t.library.listLibrary().find((x) => x.kind === 'audio');
    const keys0 = ((await t.sound()).tracks || []).map((x) => x.key);
    const r = await t.cmd('layer.add', { mapId: m.id, path: file.path, role: 'audio' });
    const id = r.selected;
    const mine = async () => ((await t.sound()).tracks || []).find((x) => !keys0.includes(x.key));
    const tr = await t.until(async () => { const x = await mine(); return x && x.playing && x; }, 8000, 'the map sound to play');
    await t.cmd('layer.update', { mapId: m.id, id, volume: 0.2 });
    await t.until(async () => { const x = await mine(); return x && Math.abs((x.volume ?? x.gain ?? x.vol ?? -1) - 0.2) < 0.06; }, 5000, 'the volume to follow').catch(async (e) => { throw new Error(`${e.message} (the track says ${JSON.stringify(await mine())})`); });
    await t.cmd('layer.remove', { mapId: m.id, id });
    await t.until(async () => { const x = await mine(); return !x || !x.playing; }, 8000, 'the map sound to stop');
    t.ok(tr.key, 'the track has a name', tr);
  });

  // F5 (open point): a sound put into Audio/SFX shows in the Soundboard by itself, and goes again (no Refresh)
  area.quick('the Soundboard follows the Sounds folder: a new file shows by itself, a removed one goes', async (t) => {
    const fs = require('fs'); const path = require('path');
    const src = t.lib('sfx')[0] || t.library.listLibrary().find((x) => /SFX/.test(x.path));
    const dst = path.join(t.library.root, 'Audio', 'SFX', `Watched sound test${path.extname(src.path)}`);
    await t.g(`Play.TB.openPanel('sound')`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'sound'), 4000, 'the Soundboard');
    t.ok(!(await t.g(`document.querySelector('.fp[data-id="sound"]').textContent`)).includes('Refresh'), 'no Refresh button');
    const has = () => t.g(`document.querySelector('.fp[data-id="sound"]').textContent.includes('Watched sound test')`);
    try {
      fs.copyFileSync(src.path, dst);
      await t.until(has, 6000, 'the new sound in the Soundboard by itself');
      fs.rmSync(dst, { force: true });
      await t.until(async () => !(await has()), 6000, 'the removed sound to go by itself');
    } finally { fs.rmSync(dst, { force: true }); await t.g(`Play.Floats.hide('sound')`); }
  });

  // F6 (open point): a row under the preview says what sounds on the table; ✕ stops a map's own sound
  area.quick('a row under the preview shows what sounds on the table; its ✕ stops the map\'s sound', async (t) => {
    const m = t.L();
    const row = () => t.g(`(() => { const r = document.querySelector('#table-ctl .hud-sound'); if (!r) return null; const s = r.querySelector('[data-from]'); return { text: r.textContent, from: s && s.dataset.from, tip: s && s.dataset.tip, x: !!r.querySelector('.icon-btn[aria-label="Stop it"]'), green: r.classList.contains('c-green') }; })()`);
    const ch = t.store.chapterOf(m.id);
    if (ch && ch.ambience) {
      const a = await t.until(row, 6000, 'the chapter\'s ambience in a row');
      t.ok(a.text.includes(ch.ambience.name) && a.from === 'chapter' && /chapter's ambience/.test(a.tip) && a.green && !a.x, 'the chapter\'s ambience: its name, its volume, green, no ✕ (it is the chapter\'s)', a);
    }
    const file = t.library.listLibrary().find((x) => x.kind === 'audio' && /Ambience/.test(x.path) && !(m.layers || []).some((l) => l.path === x.path)) || t.library.listLibrary().find((x) => x.kind === 'audio');
    const id = (await t.cmd('layer.add', { mapId: m.id, path: file.path, role: 'audio' })).selected;
    try {
      const r = await t.until(async () => { const x = await row(); return x && x.from === 'map' && x.x && x; }, 6000, 'the map\'s sound in the row');
      t.ok(/%/.test(r.text), 'with its volume', r);
      await t.g(`document.querySelector('#table-ctl .hud-sound .icon-btn[aria-label="Stop it"]').click()`);
      await t.until(() => (t.L().layers.find((l) => l.id === id) || {}).muted === true, 4000, '✕ mutes it');
      await t.until(async () => !(await row()), 4000, 'nothing sounds: no row');
    } finally { await t.cmd('layer.remove', { mapId: m.id, id }); }
  });

  area.deep('the ambience\'s volume slider is heard: quieter in the sound window', async (t) => {
    const ch = t.store.chapterOf(t.L().id);
    const v0 = ch.ambience.volume;
    const read = async () => { const a = amb(await t.sound()); return a && (a.volume ?? a.gain ?? a.vol); };
    await t.cmd('chapter.ambience', { id: ch.id, volume: 0.1 });
    await t.until(async () => Math.abs((await read()) - 0.1) < 0.06, 6000, 'the ambience to get quieter').catch(async (e) => { throw new Error(`${e.message} (the track says ${JSON.stringify(amb(await t.sound()))})`); });
    await t.cmd('chapter.ambience', { id: ch.id, volume: v0 });
  });
};
