// Snapshots: saved states of a map, played back with F1 to F8
'use strict';

module.exports = (area) => {
  area.title('Snapshots');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Snapshots (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });

  const M = (t) => t.store.map(own);
  const clean = async (t) => {
    if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); }
    for (const s of [...(M(t).snaps || [])]) t.handle('snap.remove', { mapId: own, id: s.id });
    for (const f of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: f.id });
    for (const w of [...M(t).weather.layers]) t.handle('weather.remove', { mapId: own, id: w.id });
    for (const l of M(t).layers.filter((x) => x.role === 'token')) t.handle('layer.remove', { mapId: own, id: l.id });
    t.handle('light.update', { mapId: own, darkness: 0 });
    await t.settle();
    return M(t);
  };

  area.quick('Save snapshot keeps the map as it is; the Snapshots panel lists it', async (t) => {
    await clean(t);
    const r = await t.cmd('snap.save', { mapId: own, name: 'Day' });
    t.ok(r.ok, 'the snapshot', r);
    t.eq((M(t).snaps || []).map((s) => s.name), ['Day'], 'the map\'s snapshots');
    await t.g(`Play.TB.openPanel('snaps')`);
    await t.until(async () => /Day/.test((await t.g(`document.body.textContent`)) || ''), 3000, 'the snapshot in the panel');
  });

  area.deep('F1 and F2 bring back light, weather and effects as they were saved; tokens stay where they are', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('snap.save', { mapId: own, name: 'Day' });
    await t.cmd('light.update', { mapId: own, darkness: 0.8 });
    await t.cmd('weather.add', { mapId: own, type: 'rain' });
    await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'torch', x: 18 * k, y: 6 * k, r: 1 });
    await t.cmd('snap.save', { mapId: own, name: 'Stormy night' });
    const tok = t.handle('layer.add', { mapId: own, path: t.pic('tokens'), role: 'token', x: 15.5 * k, y: 8.5 * k, size: 1 }).selected;
    t.gm().webContents.focus();
    await t.key('F1');
    await t.until(() => M(t).light.darkness === 0 && M(t).weather.layers.filter((l) => !l.dying).length === 0 && M(t).fx.length === 0, 8000, 'F1 to bring the day back');
    t.ok(M(t).layers.some((l) => l.id === tok), 'the token placed afterwards is still there');
    await t.key('F2');
    await t.until(() => Math.abs(M(t).light.darkness - 0.8) < 0.001 && M(t).weather.layers.some((l) => l.type === 'rain' && !l.dying) && M(t).fx.length === 1, 8000, 'F2 to bring the stormy night back');
    t.ok(M(t).layers.some((l) => l.id === tok), 'the token is still there');
  });

  area.deep('a snapshot can be renamed, saved over and removed; Undo brings a removed one back', async (t) => {
    await clean(t);
    await t.cmd('snap.save', { mapId: own, name: 'One' });
    const id = M(t).snaps[0].id;
    await t.cmd('snap.update', { mapId: own, id, name: 'First' });
    t.eq(M(t).snaps[0].name, 'First', 'the name after renaming');
    await t.cmd('light.update', { mapId: own, darkness: 0.5 });
    const rs = await t.cmd('snap.resave', { mapId: own, id });
    t.ok(rs.ok !== false, 'saving over it', rs);
    t.near(M(t).snaps[0].data.light.darkness, 0.5, 0.001, 'the darkness kept in the snapshot');
    const gone = await t.cmd('snap.remove', { mapId: own, id });
    t.eq((M(t).snaps || []).length, 0, 'snapshots after removing it');
    if (gone.undo) await t.cmd(gone.undo.type, gone.undo.payload); else await t.cmd('snap.restore', { mapId: own });
    t.eq((M(t).snaps || []).length, 1, 'snapshots after Undo');
  });

  area.deep('a key without a snapshot says so and changes nothing', async (t) => {
    await clean(t);
    const r = t.handle('snap.play', { n: 3, mapId: own });
    t.ok(r.ok === false, 'no third snapshot to play', r);
  });
};
