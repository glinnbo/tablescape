// What is kept: saving, opening again, backups, deleting and bringing back
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (area) => {
  area.title('Saving and campaigns');
  area.before(async (K) => { await K.openDemo(); });

  const r2 = (v) => Math.round(v * 100) / 100;
  const sig = (t) => t.store.allMapIds().map((id) => { const m = t.store.map(id); return [id, m.name, m.fog.ops.length, m.layers.length, m.fx.length, m.spells.length, m.walls.length, m.grid.type, r2(m.grid.size), r2(m.view.zoom), m.marks.length, m.draw.length]; });

  area.quick('changes are saved: after closing and opening the campaign everything is as it was', async (t) => {
    const m = t.E(); const s = m.grid.size;
    t.handle('layer.add', { mapId: m.id, path: t.pic('tokens'), role: 'token', x: 5.5 * s, y: 5.5 * s, size: 1 });
    t.handle('fog.op', { mapId: m.id, mode: 'reveal', shape: 'circle', x: 6 * s, y: 6 * s, r: 2 * s });
    t.handle('wall.add', { mapId: m.id, segs: [[2 * s, 2 * s, 4 * s, 2 * s]] });
    t.handle('hotbar.set', { slots: [{ kind: 'tool', ref: 'fog', label: 'Fog', icon: 'cloud-fog' }] });
    const before = sig(t);
    const id = t.store.cur.meta.id;
    t.store.flush();
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the start screen');
    t.handle('campaign.open', { id });
    t.handle('campaign.play');
    await t.until(() => t.g(`document.body.dataset.screen === 'play' && !!Play.state().map`), 8000, 'the campaign to open again');
    t.eq(sig(t), before, 'the maps after opening again');
    t.eq((t.store.cur.meta.hotbar || []).map((x) => x && x.ref), ['fog'], 'the hotbar after opening again');
  });

  area.quick('the campaign\'s files are where the app says: one file per map', async (t) => {
    t.store.flush();
    const dir = path.join(t.store.cur.dir, 'maps');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const id of t.store.allMapIds()) t.has(files, `${id}.json`, 'the map files');
    for (const f of files) JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  });

  area.quick('a map can be added, renamed, duplicated and removed; Undo brings a removed map back', async (t) => {
    const n0 = t.store.allMapIds().length;
    const ch = t.store.cur.meta.chapters[0];
    const a = t.handle('map.add', { chapterId: ch.id, name: 'Cellar' });
    t.eq(t.store.allMapIds().length, n0 + 1, 'maps after adding one');
    t.handle('map.rename', { id: a.id, name: 'Wine cellar' });
    t.eq(t.store.map(a.id).name, 'Wine cellar', 'the name after renaming');
    const d = t.handle('map.duplicate', { id: a.id });
    t.eq(t.store.allMapIds().length, n0 + 2, 'maps after duplicating');
    const gone = t.handle('map.remove', { id: d.id });
    t.eq(t.store.allMapIds().length, n0 + 1, 'maps after removing the copy');
    t.ok(gone.undo, 'removing a map offers Undo', gone);
    t.handle(gone.undo.type, gone.undo.payload);
    t.eq(t.store.allMapIds().length, n0 + 2, 'maps after bringing it back');
    t.handle('map.remove', { id: d.id }); t.handle('map.remove', { id: a.id });
  });

  area.quick('a chapter can be added, renamed and removed', async (t) => {
    const n0 = t.store.cur.meta.chapters.length;
    const r = t.handle('chapter.add', { name: 'Act two' });
    t.eq(t.store.cur.meta.chapters.length, n0 + 1, 'chapters after adding one');
    const ch = t.store.cur.meta.chapters[n0];
    t.handle('chapter.rename', { id: ch.id, name: 'Act 2' });
    t.eq(t.store.cur.meta.chapters[n0].name, 'Act 2', 'the name after renaming');
    t.handle('chapter.remove', { id: ch.id });
    t.eq(t.store.cur.meta.chapters.length, n0, 'chapters after removing it', r);
  });

  area.deep('a deleted campaign waits under Recently deleted and can be brought back', async (t) => {
    t.handle('campaign.home');
    const made = t.handle('campaign.create', { name: 'To be deleted' });
    const id = t.store.cur.meta.id;
    t.handle('campaign.home');
    await t.sleep(300);
    const n0 = t.store.list().length;
    const del = t.handle('campaign.delete', { id });
    t.ok(del && del.ok !== false, 'the campaign can be deleted', del);
    t.eq(t.store.list().length, n0 - 1, 'campaigns after deleting');
    const gone = t.handle('campaign.deleted', {});
    const list = (gone && (gone.list || gone.items || gone)) || [];
    t.ok(Array.isArray(list) && list.some((x) => x.name === 'To be deleted'), 'it waits under Recently deleted', gone);
    const item = list.find((x) => x.name === 'To be deleted');
    const back = t.handle('campaign.undelete', { id: item.id, key: item.key, dir: item.dir });
    t.ok(back && back.ok !== false, 'it can be brought back', back);
    t.eq(t.store.list().length, n0, 'campaigns after bringing it back', made);
    await t.openDemo();
  });

  // Beta 3.1: the demo a new user gets (demo/Demo.tablescape), imported into a library of its own so the test library stays as it is
  area.quick('the demo package imports: the maid\'s cottage with its maps, characters and pictures', async (t) => {
    const fs = require('fs'); const path = require('path'); const os = require('os');
    const library = require('../../library'); const Transfer = require('../../transfer');
    const pkg = path.join(__dirname, '..', '..', '..', 'demo', 'Demo.tablescape');
    t.ok(fs.existsSync(pkg), 'the demo package is there', pkg);
    const keep = library.root;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-demo-'));
    try {
      library.ensureLibrary(path.join(tmp, 'library'));
      const camps = path.join(tmp, 'library', 'Campaigns');
      const out = await Transfer.importFrom(pkg, camps);
      t.ok(out && out.ok, 'imported', out);
      t.eq(out.maps, 3, 'its maps');
      const dir = fs.readdirSync(camps).map((d) => path.join(camps, d)).find((d) => fs.existsSync(path.join(d, 'campaign.json')));
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'campaign.json'), 'utf8'));
      t.ok(/^Demo:/.test(meta.name), 'the start screen knows it as the demo', meta.name);
      t.ok(!meta.lastSession, 'not played yet');
      t.ok(meta.characters && meta.characters['The Little Maid'], 'the Little Maid is in the party', Object.keys(meta.characters || {}));
      const maps = fs.readdirSync(path.join(dir, 'maps')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'maps', f), 'utf8')));
      t.eq(maps.map((m) => m.name).sort(), ['Calm Cottage', 'Nighttime Cottage', 'Scene Example'], 'the maps');
      for (const m of maps) t.ok(m.bg && m.bg.path && fs.existsSync(m.bg.path), `${m.name}: its picture is in the library`, m.bg);
      const chPortrait = meta.characters['The Little Maid'].portrait;
      t.ok(chPortrait && chPortrait.path && fs.existsSync(chPortrait.path), 'the maid\'s portrait is in the library', chPortrait);
    } finally {
      library.ensureLibrary(keep);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
    t.eq(library.root, keep, 'the test library is back');
  });
};
