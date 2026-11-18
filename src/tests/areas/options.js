// Options
'use strict';

// Beta 3.18: two panels, Tablescape settings (for every campaign) and Campaign settings (kept in the campaign)
const SECTIONS = [['check', 'Table check'], ['tv', 'TV'], ['picture', 'Picture'], ['tokens', 'Tokens'], ['sound', 'Sound'], ['perf', 'Performance'], ['screen', 'This screen'], ['library', 'Library']];
const CAMP = [['campaign', 'Campaign'], ['screens', 'Screens'], ['looks', 'Looks'], ['init', 'Initiative'], ['players', 'Players'], ['tabletok', 'Tokens']];

module.exports = (area) => {
  area.title('Options');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const tabs = (t) => t.g(`[...document.querySelectorAll('.opt-tab')].map((b) => [b.dataset.id, b.textContent.trim()])`);
  area.quick('Tablescape settings lists the sections the app knows', async (t) => {
    await t.g(`App.openOptions()`);
    await t.until(() => t.g('App.optionsScope() === "app"'), 3000, 'Tablescape settings');
    t.eq(await tabs(t), SECTIONS, 'the sections (a new one needs a check here)');
    t.eq([await t.text('.opt-big'), await t.text('.opt-caption')], ['Tablescape settings', 'For every campaign'], 'its title');
  });

  area.quick('Campaign settings lists its sections; the link under them goes to Tablescape settings and back', async (t) => {
    await t.g(`App.openCampaignSettings()`);
    await t.until(() => t.g('App.optionsScope() === "camp"'), 3000, 'Campaign settings');
    t.eq(await tabs(t), CAMP, 'the sections (a new one needs a check here)');
    t.eq([await t.text('.opt-big'), await t.text('.opt-caption')], ['Campaign settings', t.store.cur.meta.name], 'its title, the campaign above it');
    await t.clickSel('.opt-other');
    await t.until(() => t.g('App.optionsScope() === "app"'), 3000, 'Tablescape settings');
    await t.clickSel('.opt-other');
    await t.until(() => t.g('App.optionsScope() === "camp"'), 3000, 'Campaign settings again');
    await t.g('App.closeOptions()');
  });

  for (const [id, label] of [...SECTIONS, ...CAMP]) {
    area.quick(`${CAMP.some((x) => x[0] === id) ? 'Campaign settings' : 'Tablescape settings'} → ${label} opens with its controls`, async (t) => {
      await t.g(`App.openOptions(${JSON.stringify(id)})`);
      await t.until(() => t.g(`App.optionsOpen() && document.querySelector('.opt-tab.on') && document.querySelector('.opt-tab.on').dataset.id === ${JSON.stringify(id)}`), 3000, `the ${label} section`);
      await t.sleep(250);
      t.ok((await t.text('.opt-title')).startsWith(label), 'the title of the section', await t.text('.opt-title'));
      const info = await t.g(`(() => { const b = document.querySelector('.opt-body'); return { chars: b.textContent.length, controls: b.querySelectorAll('button, input, select, .seg, .toggle').length }; })()`);
      t.ok(info.chars > 40 && info.controls >= 1, 'the section has content and controls', info);
    });
  }

  area.quick('Performance → Load on this computer sets animations and effects together', async (t) => {
    await t.g(`App.openOptions('perf')`);
    await t.until(() => t.findText('.opt-body', 'Load on this computer'), 3000, 'the Load switch');
    for (const [name, v] of [['Light', 'still'], ['Full', 'smooth'], ['Balanced', 'light']]) {
      await t.clickText('.opt-body .seg button, .opt-body .seg-btn, .opt-body [role="radio"]', name);
      await t.until(() => t.settings.gmAnim === v && t.settings.gmFx === v, 3000, `${name} to set both`);
    }
  });

  area.quick('a setting made in Options is saved', async (t) => {
    const v0 = t.settings.gmAnim;
    await t.g(`window.ts.settings({ gmAnim: 'still' })`);
    await t.until(() => t.settings.gmAnim === 'still', 3000, 'the setting');
    await t.g(`window.ts.settings({ gmAnim: ${JSON.stringify(v0)} })`);
    await t.until(() => t.settings.gmAnim === v0, 3000, 'the setting to go back');
  });

  // Beta 3.17: the demo a new install starts with, for anyone who wants the newest one (or deleted theirs)
  area.quick('Library → Add the demo campaign brings the demo in next to the other campaigns', async (t) => {
    const fs = require('fs'); const path = require('path');
    const root = require('../../library').root;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'Campaigns' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    const before = new Set(walk(root));
    const ids0 = new Set(t.store.list().map((c) => c.id));
    let added = null;
    try {
      await t.g(`App.openOptions('library')`);
      await t.until(() => t.findText('.opt-body', 'Add the demo campaign'), 3000, 'the button');
      await t.clickText('.opt-body button', 'Add the demo campaign');
      await t.until(() => t.g(`!!document.querySelector('.tr-back.done')`), 30000, 'the demo to be unpacked');
      added = t.store.list().find((c) => !ids0.has(c.id));
      t.ok(added && /^Demo: the maid's cottage/.test(added.name), 'a new demo campaign', added && added.name);
      t.ok(/Imported/.test(await t.text('.tr-back .tr-title')) && /7 maps/.test(await t.text('.tr-back .tr-line')), 'it says so', await t.text('.tr-back'));
      await t.clickText('.tr-back .tr-actions button', 'Done');
      await t.until(async () => !(await t.g(`!!document.querySelector('.tr-back')`)), 3000, 'the ring to close');
      t.ok(await t.g('App.optionsOpen()'), 'Options stay open');
    } finally {
      // what it brought goes again, so the later areas find the library as it was
      if (added) { const dir = t.store.findDir(added.id); if (dir) fs.rmSync(dir, { recursive: true, force: true }); }
      for (const f of walk(root)) if (!before.has(f)) fs.rmSync(f, { force: true });
      await t.g(`Home.refresh()`);
    }
  });

  // Beta 3.18: they live in the campaign and travel with it; switching campaigns switches them
  area.quick('Looks, Initiative, seats, phones, tokens on the table and the remote\'s buttons belong to the campaign; a new one starts like the last played', async (t) => {
    const fs = require('fs'); const path = require('path');
    const set = (p) => t.g(`window.ts.settings(${JSON.stringify(p)})`);
    const tb = () => (t.store.cur && t.store.cur.meta.table) || {};
    const A = t.store.cur.meta.id;
    const was = JSON.parse(JSON.stringify(tb()));
    const deck0 = JSON.parse(JSON.stringify(t.settings.remote.decks.phone));
    const speed0 = (t.settings.players && t.settings.players.speed) || 30;
    let B = null;
    try {
      await set({ tableStyle: 'meadow', initFoes: 'enemy', seats: 'one', tokens: { shadow: true } });
      await t.g(`window.ts.players('set', { speed: 45 })`);
      await t.g(`window.ts.remote('deck.set', { which: 'phone', deck: ${JSON.stringify({ ...deck0, pages: [[{ kind: 'moment', ref: 'nat20', label: 'Nat 20', icon: null }]] })} })`);
      const nat = (pages) => !!(pages && pages[0] && pages[0][0] && pages[0][0].ref === 'nat20');
      await t.until(() => tb().tableStyle === 'meadow' && tb().initFoes === 'enemy' && tb().seats === 'one' && tb().tokens && tb().tokens.shadow === true && tb().phones && tb().phones.speed === 45 && tb().deck && nat(tb().deck.phone), 3000, 'kept in the campaign');
      // a new campaign: like the one played last
      t.handle('campaign.create', { name: 'Settings test' });
      B = t.store.cur.meta.id;
      t.ok(B !== A, 'a new campaign is open');
      t.eq([tb().tableStyle, tb().seats, tb().phones.speed, nat(tb().deck.phone)], ['meadow', 'one', 45, true], 'it starts like the one played last');
      await set({ tableStyle: 'ice', seats: 'both', tokens: { shadow: false } });
      await t.until(() => tb().tableStyle === 'ice' && tb().seats === 'both', 3000, 'its own');
      // each campaign brings its own back
      t.handle('campaign.open', { id: A });
      await t.until(() => t.settings.tableStyle === 'meadow' && t.settings.seats === 'one' && t.settings.tokens.shadow === true && t.settings.players.speed === 45 && nat(t.settings.remote.decks.phone.pages), 3000, 'the first campaign\'s again');
      await t.until(async () => (await t.g('App.state.settings.tableStyle')) === 'meadow', 3000, 'the GM window knows it');
      t.handle('campaign.open', { id: B });
      await t.until(() => t.settings.tableStyle === 'ice' && t.settings.seats === 'both' && t.settings.tokens.shadow === false, 3000, 'the second\'s again');
      // a campaign without them (saved before Beta 3.18) takes the ones set now
      t.handle('campaign.open', { id: A });
      const f = path.join(t.store.findDir(B), 'campaign.json');
      const m = JSON.parse(fs.readFileSync(f, 'utf8')); delete m.table; fs.writeFileSync(f, JSON.stringify(m));
      t.handle('campaign.open', { id: B });
      await t.until(() => tb().tableStyle === 'meadow' && t.settings.tableStyle === 'meadow', 3000, 'an older campaign takes the ones set now');
      // an adventure takes the looks, not this table's remote, phones and seats; a full copy takes all
      const Transfer = require('../../transfer');
      const out = (kind) => JSON.parse(Transfer.plan(t.store.findDir(A), { kind }).json[0].data).table || {};
      const adv = out('adventure'); const full = out('full');
      t.ok(adv.tableStyle === 'meadow' && adv.initFoes === 'enemy' && !adv.deck && !adv.phones && !adv.seats, 'as an adventure: the looks only', adv);
      t.ok(full.tableStyle === 'meadow' && full.seats === 'one' && full.phones && nat(full.deck && full.deck.phone), 'a full copy: all of it', full);
    } finally {
      await t.openDemo();
      await set({ tableStyle: was.tableStyle || 'ink', initFoes: was.initFoes || 'names', seats: was.seats || 'both', tokens: { shadow: !!(was.tokens && was.tokens.shadow) } });
      await t.g(`window.ts.players('set', { speed: ${speed0} })`);
      await t.g(`window.ts.remote('deck.set', { which: 'phone', deck: ${JSON.stringify(deck0)} })`);
      if (B) {
        t.handle('campaign.delete', { id: B });
        for (const d of t.store.deleted().filter((x) => x.name === 'Settings test')) t.handle('campaign.purge', { key: d.key });
      }
      await t.send();
    }
    t.eq(t.settings.tableStyle, was.tableStyle || 'ink', 'the demo as it was');
  });

  // Beta 3.19: up and down go through the sections of both panels (a slider keeps its arrows)
  area.quick('the arrow keys go through the sections; a slider keeps them', async (t) => {
    const on = () => t.g(`(document.querySelector('.opt-tab.on') || {}).dataset.id`);
    await t.g(`App.openOptions('tv')`);
    await t.until(async () => (await on()) === 'tv', 3000, 'TV');
    t.gm().webContents.focus();
    await t.g(`document.activeElement && document.activeElement.blur()`);
    await t.key('Down');
    await t.until(async () => (await on()) === 'picture', 2000, 'down: Picture');
    await t.key('Up'); await t.key('Up');
    await t.until(async () => (await on()) === 'check', 2000, 'up twice: Table check');
    await t.key('Up');
    await t.until(async () => (await on()) === 'library', 2000, 'and round to the last');
    await t.g(`App.openOptions('screen')`);
    await t.until(async () => (await on()) === 'screen', 2000, 'This screen');
    await t.g(`document.querySelector('.opt-body input[type="range"]').focus()`);
    await t.key('Down');
    await t.sleep(300);
    t.eq(await on(), 'screen', 'a slider with the focus keeps the arrows');
    await t.g(`document.activeElement && document.activeElement.blur()`);
    await t.g(`App.openCampaignSettings('looks')`);
    await t.until(async () => (await on()) === 'looks', 2000, 'Campaign settings → Looks');
    await t.key('Down');
    await t.until(async () => (await on()) === 'init', 2000, 'down: Initiative');
    await t.g('App.closeOptions()');
  });

  area.quick('Esc closes Options', async (t) => {
    await t.g(`App.openOptions('tv')`);
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options');
    t.gm().webContents.focus();
    await t.key('Escape');
    await t.until(async () => !(await t.g('App.optionsOpen()')), 3000, 'Options to close');
  });
};
