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

  area.quick('Esc closes Options', async (t) => {
    await t.g(`App.openOptions('tv')`);
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options');
    t.gm().webContents.focus();
    await t.key('Escape');
    await t.until(async () => !(await t.g('App.optionsOpen()')), 3000, 'Options to close');
  });
};
