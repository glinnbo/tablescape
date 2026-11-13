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
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the start screen');
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
    await t.until(() => t.rect('.camp-broken'), 6000, 'the damaged campaign on the start screen');
    const listed = (t.handle('campaign.list').campaigns || []).filter((c) => c.broken);
    t.ok(listed.length === 1 && listed[0].backups >= 1, 'it is listed as damaged, with an earlier version', listed);
    await t.clickSel('.camp-broken');
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
};
