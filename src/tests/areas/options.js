// Options
'use strict';

const SECTIONS = [['tv', 'TV'], ['picture', 'Picture'], ['players', 'Seating'], ['looks', 'Looks'], ['init', 'Initiative'], ['tokens', 'Tokens'], ['sound', 'Sound'], ['perf', 'Performance'], ['screen', 'This screen'], ['library', 'Library']];

module.exports = (area) => {
  area.title('Options');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  area.quick('Options lists the sections the app knows', async (t) => {
    await t.g(`App.openOptions()`);
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options');
    const tabs = await t.g(`[...document.querySelectorAll('.opt-tab')].map((b) => [b.dataset.id, b.textContent.trim()])`);
    t.eq(tabs, SECTIONS, 'the sections (a new one needs a check here)');
  });

  for (const [id, label] of SECTIONS) {
    area.quick(`Options → ${label} opens with its controls`, async (t) => {
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

  area.quick('Esc closes Options', async (t) => {
    await t.g(`App.openOptions('tv')`);
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options');
    t.gm().webContents.focus();
    await t.key('Escape');
    await t.until(async () => !(await t.g('App.optionsOpen()')), 3000, 'Options to close');
  });
};
