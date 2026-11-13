// Table styles: every style changes maps, shows portraits and dresses the turn order and the round
'use strict';

// style -> the look it is built on (a style of its own, or a variant of another)
const STYLES = { ink: 'ink', blood: 'ink', smoke: 'smoke', arcane: 'smoke', parchment: 'parchment', old: 'parchment', embers: 'embers', witchfire: 'embers', stone: 'stone', ice: 'stone',
  meadow: 'meadow', autumn: 'meadow', city: 'city', slums: 'city', winter: 'winter', christmas: 'winter', sand: 'sand', ash: 'sand', dungeon: 'dungeon', necro: 'necro', bloodcrypt: 'necro', forest: 'forest', jungle: 'forest' };
// the quick level runs the newest ones and the plain one; the deep level all the others
const QUICK = ['ink', 'dungeon', 'necro', 'forest', 'jungle'];

module.exports = (area) => {
  area.title('Table styles');
  let style0 = null;
  area.before(async (K) => { await K.openDemo(); await K.send(); style0 = K.settings.tableStyle; });

  area.quick('Options → Looks offers every style, and the app knows no other', async (t) => {
    await t.g(`App.openOptions('looks')`);
    const cards = await t.until(async () => { const c = await t.g(`[...document.querySelectorAll('.style-grid .style-card')].map((b) => b.dataset.v)`); return c.length && c; }, 4000, 'the style cards');
    t.eq([...cards].sort(), Object.keys(STYLES).sort(), 'the styles on offer (a new one needs its check here)');
  });

  const run = async (t, id) => {
    const base = STYLES[id];
    await t.g(`window.ts.settings({ tableStyle: ${JSON.stringify(id)}, looks: { map: 'style', talk: 'style', init: 'style', round: 'style' } })`);
    const ds = await t.until(async () => { const d = await t.t(`Object.assign({}, document.body.dataset)`); return d.lookInit === base && d; }, 5000, `the style ${id} to reach the TV`);
    t.eq([ds.lookInit, ds.lookRound], [base, base], 'the look of the turn order and the round');
    t.eq([ds.vMap || '', ds.vTalk || '', ds.vInit || ''], id === base ? ['', '', ''] : [id, id, id], 'the variant on the TV');
    // a map change in this style: it covers the table, the new map is there, and it clears again
    const runs0 = ((await t.tvDebug()).mapLook || {}).runs || 0;
    const next = t.store.allMapIds().find((x) => x !== t.state.liveMapId);
    await t.cmd('edit.open', { id: next });
    await t.send(next);
    if (base !== 'ink') {
      const look = await t.until(async () => { const d = (await t.tvDebug()).mapLook; return d && d.runs > runs0 && d.phase === 'idle' && d; }, 12000, 'the map change to run and clear');
      t.eq(look.kind, base, 'the map change that ran');
      t.eq(await t.t(`document.querySelector('#table-maplook').childElementCount`), 0, 'what is left of it on the TV');
    }
    t.eq((await t.tvDebug()).liveId, next, 'the map on the TV');
    // portraits in this style
    await t.cmd('talk.toggle', { path: t.lib('portraits')[0].path });
    await t.until(() => t.t(`!!document.querySelector('.tv-talk.on.look-${base}')`), 5000, `the Conversation screen in the ${base} look`);
    // tall trees stand behind the portraits in the woods, and nowhere else
    const trees = await t.until(async () => { const n = await t.t(`[...document.querySelectorAll('.tv-talk .talk-back')].map((b) => b.querySelectorAll('svg.tb-trees polygon, svg.tb-trees path').length)`); return (base !== 'forest' || n.every((x) => x > 0)) && n; }, 4000, 'the trees behind the portraits');
    t.ok(trees.length >= 1 && trees.every((x) => (base === 'forest' ? x > 3 : x === 0)), `trees behind the portraits only in the woods (${trees.join(', ')})`);
    const band = await t.until(async () => { const n = await t.t(`(document.querySelector('.tv-talk .talk-ink') || {}).innerHTML.length || 0`); return n > 20 && n; }, 4000, 'the band the portraits stand in');
    t.ok(band > 20, 'the band is drawn', band);
    await t.until(() => t.t(`(() => { const i = document.querySelector('.tv-talk .talk-npc img'); return !!i && i.complete && i.naturalWidth > 0; })()`), 5000, 'the portrait');
    await t.cmd('talk.off', {});
    await t.until(async () => !(await t.t(`!!document.querySelector('.tv-talk.on:not(.leaving)')`)), 5000, 'the portraits to leave');
  };

  for (const id of Object.keys(STYLES)) {
    const what = `${id}: the map change runs and clears, portraits stand in its band, the turn order wears it`;
    if (QUICK.includes(id)) area.quick(what, (t) => run(t, id), { ms: 60000 }); else area.deep(what, (t) => run(t, id), { ms: 60000 });
  }

  area.quick('every picture a style uses is there', async (t) => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'renderer');
    const used = new Set();
    for (const f of ['styles.css', 'table-looks.js', 'gm.js']) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/looks\/([a-z0-9]+)\.webp/g)) used.add(m[1]);
    for (const m of fs.readFileSync(path.join(dir, 'table-looks.js'), 'utf8').matchAll(/pic\('([a-z0-9]+)'\)/g)) used.add(m[1]);
    for (const m of fs.readFileSync(path.join(dir, 'gm.js'), 'utf8').matchAll(/pic: '([a-z0-9]+)'/g)) used.add(m[1]);
    const missing = [...used].filter((n) => !fs.existsSync(path.join(dir, 'looks', `${n}.webp`)));
    t.eq(missing, [], 'pictures named in the code but not in looks/');
    t.ok(used.size >= 25, 'the styles use their pictures', used.size);
  });

  area.quick('the style chosen before is back', async (t) => {
    await t.g(`window.ts.settings({ tableStyle: ${JSON.stringify(style0 || 'ink')} })`);
    await t.until(() => t.settings.tableStyle === (style0 || 'ink'), 3000, 'the setting');
  });
};
