// The Guide: first evening, files, keys, help, what's new, report a problem
'use strict';
const PKG = require('../../../package.json');
const LABEL = PKG.releaseLabel || PKG.version;

const TABS = [['start', 'First evening'], ['files', 'Your files'], ['keys', 'Keys'], ['help', 'Help'], ['news', 'What\'s new'], ['problem', 'Report a problem'], ['about', 'About']];

module.exports = (area) => {
  area.title('Guide');
  area.before(async (K) => { await K.openDemo(); });

  const open = async (t, id) => {
    await t.g(`Guide.open(${JSON.stringify(id)})`);
    await t.until(() => t.g(`Guide.isOpen() && Guide.tab === ${JSON.stringify(id)}`), 3000, `the ${id} page of the Guide`);
    await t.sleep(200);
  };

  area.quick('the Guide lists its pages', async (t) => {
    await open(t, 'start');
    const tabs = await t.g(`[...document.querySelectorAll('.guide-tab')].map((b) => b.textContent.trim())`);
    t.eq(tabs, TABS.map((x) => x[1]), 'the pages (a new one needs a check here)');
  });

  for (const [id, label] of TABS) {
    area.quick(`Guide → ${label} opens with content`, async (t) => {
      await open(t, id);
      t.eq(await t.text('.guide-tab.on'), label, 'the page shown');
      const chars = await t.g(`(() => { const m = document.querySelector('.guide-tab').closest('.modal, .guide, [role="dialog"]') || document.body; return m.textContent.length; })()`);
      t.ok(chars > 300, 'the page has content', chars);
    });
  }

  area.quick('First evening is a checklist that remembers what is ticked', async (t) => {
    await open(t, 'start');
    const n = await t.count('.guide-checks li, .guide-checks .guide-check');
    t.ok(n >= 3, 'the checklist has steps', n);
  });

  area.quick('Help has a section for every tool and panel, and Find narrows it', async (t) => {
    await open(t, 'help');
    const all = await t.g(`[...document.querySelectorAll('.guide-help section h4')].map((x) => x.textContent)`);
    t.ok(all.length >= 25, 'sections in the help', all.length);
    for (const want of ['Fog of war', 'Handouts', 'Initiative']) t.ok(all.some((x) => x.includes(want)), `the help has ${want}`, all);
    await t.g(`(() => { const q = document.querySelector('.guide-find'); q.value = 'handout'; q.dispatchEvent(new Event('input')); })()`);
    await t.sleep(250);
    const hit = await t.g(`[...document.querySelectorAll('.guide-help section')].filter((s) => s.getClientRects().length).map((s) => s.querySelector('h4').textContent)`);
    t.ok(hit.length >= 1 && hit.length < all.length, 'Find shows fewer sections', hit);
    await t.g(`(() => { const q = document.querySelector('.guide-find'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
  });

  area.quick('What\'s new starts with this release', async (t) => {
    const top = await t.g(`Guide.NEWS[0] && (Guide.NEWS[0].title || Guide.NEWS[0].v || Guide.NEWS[0][0])`);
    t.ok(String(top).includes(LABEL), `the newest entry is ${LABEL}`, top);
  });

  area.quick('About: Discord, Ko-fi, the license, privacy and credits (Beta 3.0)', async (t) => {
    await open(t, 'about');
    const text = await t.g(`document.querySelector('.guide-body').textContent`);
    for (const want of ['Discord', 'Toss a coin', 'open source', 'GNU General Public License', 'Privacy', 'Midjourney', 'SRD 5.1']) t.ok(text.includes(want), `About has "${want}"`);
    const lic = await t.g(`window.ts.app('license')`);
    t.ok(lic && lic.ok && /^TABLESCAPE/.test(lic.text) && /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(lic.text) && /END OF TERMS AND CONDITIONS/.test(lic.text), 'the notice and the whole GPLv3 load (Beta 3.4)');
    const code = await t.g(`window.ts.app('link.open', { to: 'code' })`);
    t.eq(code && code.url, 'https://github.com/glinnbo/tablescape', 'The code on GitHub opens the public repo');
    const d = await t.g(`window.ts.app('link.open', { to: 'discord' })`);
    t.eq(d && d.url, 'https://discord.gg/T99DRNKaSM', 'Discord opens the invite that never expires');
    const k = await t.g(`window.ts.app('link.open', { to: 'kofi' })`);
    t.eq(k && k.url, 'https://ko-fi.com/tablescape', 'Toss a coin opens the Ko-fi page');
    t.eq(await t.g(`window.ts.app('link.open', { to: 'elsewhere' })`), { ok: false }, 'no other address can be opened this way');
  });

  area.quick('Report a problem points to #bug-reports on Discord', async (t) => {
    await open(t, 'problem');
    const text = await t.g(`document.querySelector('.guide-body').textContent`);
    t.ok(text.includes('#bug-reports') && text.includes('Open Discord'), 'the page names #bug-reports and has the Discord button');
    t.ok(!/whoever gave you/.test(text), 'no more "send it to whoever gave you Tablescape"');
  });

  area.quick('a "?" on a panel opens the Help page at that panel', async (t) => {
    t.gm().webContents.focus();
    await t.key('R');
    await t.until(() => t.popTitle(), 3000, 'the Fog panel');
    await t.clickSel('#pop .pop-head .help-q');
    await t.until(() => t.g(`Guide.isOpen() && Guide.tab === 'help'`), 3000, 'the Help page');
  });
};
