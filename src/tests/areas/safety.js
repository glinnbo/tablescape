// Keeping the user's work safe: backups, earlier versions, damaged files, and a problem report without secrets
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

module.exports = (area) => {
  area.title('Backups, damaged files and the problem report');
  area.before(async (K) => { await K.openDemo(); });

  const reopen = async (t, id) => {
    t.store.flush();
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the home screen');
    t.handle('campaign.open', { id }); t.handle('campaign.play');
    await t.until(() => t.g(`document.body.dataset.screen === 'play' && !!Play.state() && !!Play.state().map`), 8000, 'the campaign to open again');
    await t.sleep(300);
  };
  const backups = (t, id) => t.g(`window.ts.app('backups.list', { id: ${JSON.stringify(id)} })`);

  area.quick('a backup is made when a changed campaign is opened again', async (t) => {
    const id = t.store.cur.meta.id;
    const n0 = (await backups(t, id)).length;
    t.handle('map.add', { chapterId: t.store.cur.meta.chapters[0].id, name: 'New cellar' });
    await reopen(t, id);
    const list = await backups(t, id);
    t.ok(list.length === n0 + 1, 'one more backup', [n0, list.length]);
    t.ok(fs.existsSync(path.join(t.store.cur.dir, '.backups')), 'the backups lie in the campaign\'s folder');
    await reopen(t, id);
    t.eq((await backups(t, id)).length, n0 + 1, 'opening again without a change makes no new backup');
  });

  area.deep('Earlier versions brings an older state back', async (t) => {
    const id = t.store.cur.meta.id;
    const maps0 = t.store.allMapIds().length;
    t.handle('map.add', { chapterId: t.store.cur.meta.chapters[0].id, name: 'Added later' });
    await reopen(t, id);
    // (the newest backup is the state before this opening: with the added map; the one before it is without)
    t.handle('map.add', { chapterId: t.store.cur.meta.chapters[0].id, name: 'Added last' });
    await reopen(t, id);
    const list = await backups(t, id);
    t.ok(list.length >= 2, 'backups to choose from', list.length);
    const older = list.find((b) => b.maps === maps0 + 1) || list[list.length - 1];
    const r = await t.g(`window.ts.app('backups.restore', { id: ${JSON.stringify(id)}, backup: ${JSON.stringify(older.id || older.name || older.dir)} })`);
    t.ok(r && r.ok !== false, 'the restore', r);
    await t.sleep(500);
    t.handle('campaign.open', { id }); t.handle('campaign.play');
    await t.until(() => t.g(`document.body.dataset.screen === 'play' && !!Play.state().map`), 8000, 'the campaign to open');
    t.eq(t.store.allMapIds().length, older.maps, 'maps after restoring');
    t.ok((await backups(t, id)).length >= list.length, 'the state before restoring was kept as a backup too');
  });

  area.deep('a damaged map file is shown as damaged and never written over; Start it over makes it usable again', async (t) => {
    const id = t.store.cur.meta.id;
    const mid = t.store.allMapIds()[1];
    t.store.flush();
    const file = path.join(t.store.cur.dir, 'maps', `${mid}.json`);
    const junk = '{ "name": "half writ';
    fs.writeFileSync(file, junk);
    t.handle('campaign.home'); await t.sleep(300);
    t.handle('campaign.open', { id }); t.handle('campaign.play'); await t.sleep(500);
    t.handle('edit.open', { id: mid });
    await t.until(() => t.rect('.empty-card.broken'), 5000, 'the word that this map is damaged');
    t.ok(!!t.store.map(mid).broken, 'the app knows it is damaged');
    t.store.touch(mid); t.store.flush();
    t.eq(fs.readFileSync(file, 'utf8'), junk, 'the damaged file on disk after a save');
    await t.clickText('.empty-card.broken .btn', 'Start it over');
    await t.until(() => t.findText('.modal .btn.danger', 'Start over'), 3000, 'the question before starting over');
    await t.clickText('.modal .btn.danger', 'Start over');
    await t.until(() => !t.store.map(mid).broken, 4000, 'the map to be usable again');
    t.store.flush();
    t.ok(/"id"/.test(fs.readFileSync(file, 'utf8')), 'the file is a proper map again');
  }, { allow: /damaged|broken|JSON|parse|Unexpected/i });

  area.deep('a damaged campaign shows on the start screen with its earlier versions; restoring one brings it back', async (t) => {
    const bdir = path.join(t.library.root, 'Campaigns', 'Half written');
    fs.mkdirSync(path.join(bdir, '.backups', '2026-01-01 120000'), { recursive: true });
    fs.writeFileSync(path.join(bdir, 'campaign.json'), '{ "id": "c_half", "name": "Hal');
    fs.writeFileSync(path.join(bdir, '.backups', '2026-01-01 120000', 'campaign.json'), JSON.stringify({ app: 'tablescape', version: 2, id: 'c_half', name: 'Half written', chapters: [{ id: 'ch1', name: 'One', maps: [] }] }));
    fs.writeFileSync(path.join(bdir, '.backups', '2026-01-01 120000', 'backup.json'), JSON.stringify({ made: Date.now() - 5000, hash: 'h', name: 'Half written', chapters: 1, maps: 0, files: 1 }));
    t.handle('campaign.home');
    await t.until(() => t.rect('.hm-slot.broken'), 6000, 'the damaged campaign among the campaigns on the home screen');
    const listed = (t.handle('campaign.list').campaigns || []).filter((c) => c.broken);
    t.ok(listed.length === 1 && listed[0].backups >= 1, 'it is listed as damaged, with an earlier version', listed);
    await t.clickSel('.hm-slot.broken'); // (Beta 3.17: picked, it offers its backups where PLAY is)
    await t.until(async () => (await t.text('.hm-item[data-id="backups"]')) === 'Backups', 3000, 'Backups instead of Play');
    await t.clickSel('.hm-item[data-id="backups"]');
    await t.until(async () => (await t.count('.modal .dlg-row')) >= 1, 4000, 'its earlier versions');
    await t.clickText('.modal .dlg-btns .btn, .modal .dlg-row .btn', 'Restore');
    await t.until(() => (t.handle('campaign.list').campaigns || []).some((c) => c.name === 'Half written' && !c.broken), 6000, 'the campaign to be whole again');
    await t.openDemo();
  }, { allow: /damaged|broken|JSON|parse|Unexpected/i });

  area.deep('the problem report holds no key, pass or code, in any of its files', async (t) => {
    await t.openDemo();
    const ph = await t.phonesOn();
    const A = await ph.pair(t.settings.remote.playerKey, 'st-a', 'Phone A');
    const D = await ph.pair(t.settings.remote.key, 'st-dm', 'DM phone');
    t.settings.roomLights = t.settings.roomLights || {};
    const old = { goveeKey: t.settings.roomLights.goveeKey, tradfri: t.settings.roomLights.tradfri };
    t.settings.roomLights.goveeKey = 'GOVEE-SECRET-123'; t.settings.roomLights.tradfri = { host: '192.168.1.50', identity: 'tradfri-identity-abc', psk: 'tradfri-psk-xyz' };
    try {
      const rep = await t.g(`window.ts.app('report.make', { note: 'self-test: secrets' })`);
      t.ok(rep && rep.file && fs.existsSync(rep.file), 'the report is written', rep);
      const zip = fs.readFileSync(rep.file);
      // (the report's own zip: local headers, stored or deflated)
      const files = {};
      let i = 0;
      while (i + 30 < zip.length && zip.readUInt32LE(i) === 0x04034b50) {
        const method = zip.readUInt16LE(i + 8); const csize = zip.readUInt32LE(i + 18); const nlen = zip.readUInt16LE(i + 26); const xlen = zip.readUInt16LE(i + 28);
        const name = zip.slice(i + 30, i + 30 + nlen).toString('utf8'); const body = zip.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
        try { files[name] = (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8'); } catch { files[name] = ''; }
        i += 30 + nlen + xlen + csize;
      }
      t.ok(Object.keys(files).length >= 3 && (files['settings.json'] || '').length > 100, 'the report has its files, the settings among them', Object.keys(files));
      const secrets = { 'the DM\'s code': t.settings.remote.key, 'the players\' code': t.settings.remote.playerKey, 'a player phone\'s pass': A.token, 'the DM phone\'s pass': D.token, 'the Govee key': 'GOVEE-SECRET-123', 'the IKEA identity': 'tradfri-identity-abc', 'the IKEA key': 'tradfri-psk-xyz' };
      const leaks = [];
      for (const [name, text] of Object.entries(files)) for (const [what, v] of Object.entries(secrets)) if (v && text.includes(v)) leaks.push(`${what} in ${name}`);
      t.eq(leaks, [], 'secrets found in the report');
      t.ok(files['settings.json'].includes('192.168.1.50'), 'the lamp bridge\'s address stays (it helps to find a problem)');
    } finally {
      t.settings.roomLights.goveeKey = old.goveeKey || ''; t.settings.roomLights.tradfri = old.tradfri || null;
      t.settings.remote.devices = [];
    }
  });

  // J1 (open point): a campaign whose changes don't save is not closed: Home and opening another campaign are refused
  // with the reason, the changes stay in memory; once the save works again, Home goes
  area.quick('changes that can\'t be saved keep the campaign open: Home is refused with the reason, nothing is lost', async (t) => {
    const id = t.store.cur.meta.id;
    const flush = t.store.flush;
    const name = `Unsaved map ${Date.now()}`;
    t.handle('map.add', { chapterId: t.store.cur.meta.chapters[0].id, name });
    try {
      t.store.flush = function () { this.lastError = Object.assign(new Error('busy'), { code: 'EBUSY' }); return false; };
      const r = t.handle('campaign.home');
      t.ok(r && r.ok === false && /couldn't be saved/.test(r.error) && /sync tool or an antivirus/.test(r.error), 'Home is refused, with the reason', r);
      t.ok(t.store.cur && t.store.cur.meta.id === id, 'the campaign stays open');
      t.ok(t.store.allMapIds().some((m) => (t.store.map(m) || {}).name === name), 'with the change still in it');
    } finally { t.store.flush = flush; }
    t.ok(t.store.flush(), 'saving works again');
    await reopen(t, id);
    t.ok(t.store.allMapIds().some((m) => (t.store.map(m) || {}).name === name), 'and the change was kept');
  });

  // J2 (open point): one unreadable campaign in Recently deleted doesn't break the list
  area.quick('a damaged campaign in Recently deleted is listed as damaged; the campaign list still works', async (t) => {
    const key = `Broken test-${Date.now()}`;
    const dir = path.join(t.store.trashDir, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'campaign.json'), '{ "name": "half writ');
    try {
      const del = t.handle('campaign.deleted');
      t.ok(del.ok && del.list.some((x) => x.key === key && x.broken), 'listed as damaged', del.list);
      const all = t.handle('campaign.list');
      t.ok(all && all.ok && all.campaigns.length > 0, 'the campaign list still works');
    } finally { t.handle('campaign.purge', { key }); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // J3 (open point): backups are kept by age too: the last 10, one a day for two weeks, one a week for twelve weeks
  area.quick('backups: the last 10, and one a day for two weeks and one a week for three months', async (t) => {
    const B = require('../../backups');
    const D = 864e5; const now = Date.now();
    const all = [];
    for (let d = 0; d < 120; d++) for (let k = 0; k < 3; k++) all.push({ id: `${d}-${k}`, made: now - d * D - k * 3600e3 });
    all.sort((a, b) => b.made - a.made);
    const keep = B.keptOf(all, now);
    const days = (id) => Math.floor((now - all.find((b) => b.id === id).made) / D);
    t.ok(all.slice(0, 10).every((b) => keep.has(b.id)), 'the last 10');
    for (let d = 0; d < 14; d++) t.ok([...keep].some((id) => days(id) === d), `one from ${d} days ago`);
    t.ok([...keep].some((id) => days(id) >= 70), 'one from ten weeks ago', [...keep].map(days));
    t.ok(![...keep].some((id) => days(id) >= 84), 'none older than twelve weeks');
    t.ok(keep.size <= 40, 'not all of them', keep.size);
    t.eq(B.restore(t.store.cur.dir, '../../x'), { ok: false, error: 'That backup is gone.' }, 'a restore takes only a backup\'s own name');
  });

  // J5 (open point): the turn order is kept with the campaign: a running fight comes back after the campaign reopens
  area.quick('a running fight is kept with the campaign and comes back when it opens again', async (t) => {
    const id = t.store.cur.meta.id;
    const mapId = t.state.editMapId;
    t.handle('init.start', { mapId, list: [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }, { name: 'Ogre', init: 7 }] });
    t.handle('init.next', {});
    const turn = t.state.init.turn;
    try {
      t.ok(t.store.cur.meta.init && t.store.cur.meta.init.running, 'kept in the campaign');
      await reopen(t, id);
      const I = t.state.init;
      t.ok(I && I.running && I.entries.length === 3 && I.turn === turn, 'the fight, its three and whose turn it is', I);
    } finally { t.handle('init.end', {}); }
    t.ok(!t.store.cur.meta.init, 'an ended fight is gone from the campaign');
  });

  // J6 (open point): Recently deleted lies in Campaigns/.trash (not in .cache, which is "safe to delete"); what was
  // left in .cache/trash moves over
  area.quick('Recently deleted lies in Campaigns/.trash; what was left in .cache/trash moves there', async (t) => {
    t.ok(/[\\/]Campaigns[\\/]\.trash$/.test(t.store.trashDir), 'in the campaigns folder', t.store.trashDir);
    const key = `Old trash test-${Date.now()}`;
    const old = path.join(t.library.root, '.cache', 'trash', key);
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'campaign.json'), JSON.stringify({ id: 'cOldTrash', name: 'Old trash test', chapters: [] }));
    try {
      t.store.trashFrom = null;
      const del = t.handle('campaign.deleted');
      t.ok(del.list.some((x) => x.key === key), 'listed', del.list);
      t.ok(fs.existsSync(path.join(t.store.trashDir, key)) && !fs.existsSync(old), 'moved over');
    } finally { t.handle('campaign.purge', { key }); fs.rmSync(old, { recursive: true, force: true }); }
  });

  // J8 (open point): Add from PC copies a different file with the same name and size; the very same file is not copied twice
  area.quick('Add from PC: a different file with the same name and size is copied, the same file is not', async (t) => {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-j8-'));
    const folder = `Packs/J8 test ${Date.now()}`;
    try {
      const a = path.join(tmp, 'a'); const b = path.join(tmp, 'b');
      fs.mkdirSync(a); fs.mkdirSync(b);
      const png = (n) => { const buf = Buffer.alloc(64, n); buf.write('\x89PNG', 0, 'latin1'); return buf; };
      fs.writeFileSync(path.join(a, 'Same name.png'), png(1));
      fs.writeFileSync(path.join(b, 'Same name.png'), png(2));
      const one = t.library.importFiles([path.join(a, 'Same name.png')], { folder });
      const again = t.library.importFiles([path.join(a, 'Same name.png')], { folder });
      const other = t.library.importFiles([path.join(b, 'Same name.png')], { folder });
      t.eq(path.basename(again[0].path), path.basename(one[0].path), 'the very same file: not copied again');
      t.ok(other[0].path !== one[0].path && /\(2\)/.test(path.basename(other[0].path)), 'a different file, same name and size: copied under a new name', other[0].path);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(t.library.root, ...folder.split('/')), { recursive: true, force: true }); }
  });

  // Q1 (open point): undo steps are kept within a size: 64 MB a map, 256 MB for all; the maps touched longest ago give first
  area.quick('undo steps stay within a size: per map, and for all maps together', async (t) => {
    const MS = require('../../mapstate');
    const pool = { bytes: 0, list: new Set() };
    const big = 'x'.repeat(4e6); // (about 8 MB a copy: a big baked fog picture)
    const mk = () => ({ layers: [], fog: { mask: big }, light: {}, fx: [], spells: [], weather: {}, draw: [], marks: [], walls: [], areas: [] });
    const hs = []; const maps = [];
    for (let i = 0; i < 6; i++) { hs.push(new MS.History(pool)); maps.push(mk()); }
    for (let i = 0; i < 20; i++) hs[0].before(maps[0], null, 'x');
    t.ok(hs[0].bytes <= MS.HIST_MAP_MAX && hs[0].undo.length >= 5, 'one map: within 64 MB, still several steps', [hs[0].undo.length, hs[0].bytes]);
    for (let k = 1; k < 6; k++) for (let i = 0; i < 12; i++) hs[k].before(maps[k], null, 'x');
    t.ok(pool.bytes <= MS.HIST_POOL_MAX, 'all maps: within 256 MB', pool.bytes);
    t.ok(hs[5].undo.length >= hs[0].undo.length, 'the map touched last kept the most', hs.map((h) => h.undo.length));
    const n = hs[5].undo.length;
    hs[5].step(maps[5], 'undo');
    t.eq([hs[5].undo.length, hs[5].redo.length], [n - 1, 1], 'Undo still works');
    t.ok(Math.abs(pool.bytes - [...pool.list].reduce((a, h) => a + h.bytes, 0)) < 1, 'the sizes add up');
  });

  // T3 (open point): what the release copies to the public repo: never this workshop's private files, never a builder's
  // patch or a self-test probe; and the release notes find this version's What's new lines
  area.quick('the public copy leaves the private files out; the release notes find this version', async (t) => {
    const S = require('../../../scripts/sync-public.js');
    const files = S.released().map((f) => f[0]);
    t.ok(files.length > 100, 'the files of this version', files.length);
    const priv = files.filter((f) => f.split('/').pop() === 'CLAUDE.md' || f.split('/').includes('.claude') || f.startsWith('notes/') || f.startsWith('.github/'));
    t.eq(priv, [], 'private files in the public copy');
    t.ok(files.includes('README.md') && files.includes('src/main.js'), 'the front page and the app are in it');
    for (const p of ['CLAUDE.md', 'src/x/CLAUDE.md', '.claude/settings.local.json', 'notes/a.md']) t.ok(S.LEAVE_OUT(p), `${p}: left out`);
    for (const p of ['second-x.patch', 'src/tests/areas/zz.js']) t.ok(S.NEVER(p), `${p}: stops the copy`);
    // (the notes script, run as the release runs it: Electron's own Node, as plain Node)
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', '..', 'scripts', 'release-notes.js')], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const label = require('../../../package.json').releaseLabel;
    t.ok(r.status === 0 && r.stdout.includes(`## ${label}`) && /\n- \S/.test(r.stdout), `the release notes of ${label}`, (r.stdout || r.stderr || '').slice(0, 160));
  });

  // U3 (open point): a duplicated map gets its own snapshot pictures (it shared the original's, gone with it)
  area.quick('a duplicated map has its own snapshot pictures', async (t) => {
    const mid = t.store.allMapIds()[0];
    const m = t.store.map(mid);
    const dir = path.join(t.store.cur.dir, 'snaps');
    fs.mkdirSync(dir, { recursive: true });
    const name = `qU3test-${Date.now().toString(36)}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const snaps0 = m.snaps;
    m.snaps = [...(m.snaps || []), { id: 'qU3test', name: 'U3 test', thumb: name, data: {} }];
    let copyId = null;
    try {
      const r = t.store.structure('map.duplicate', { id: mid });
      copyId = r.id;
      const s = (t.store.map(copyId).snaps || []).find((x) => x.name === 'U3 test');
      t.ok(s && s.thumb && s.thumb !== name && fs.existsSync(path.join(dir, s.thumb)), 'its own picture file', s);
    } finally {
      m.snaps = snaps0;
      if (copyId) t.handle('map.remove', { id: copyId });
      fs.rmSync(path.join(dir, name), { force: true });
    }
  });
};
