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

  // G6 (open point): Keys has Print; the sheet the printer gets is one page, the keys in black on white
  area.quick('Keys: Print makes a cheat sheet of one page', async (t) => {
    await open(t, 'keys');
    t.ok(await t.g(`!!document.querySelector('.keys-print')`), 'a Print button on Keys');
    await t.g('Guide.keySheet(true)');
    try {
      const pdf = await t.gm().webContents.printToPDF({ landscape: true, pageSize: 'A4', preferCSSPageSize: true, printBackground: true });
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      t.eq(pages, 1, 'the keys fit on one page');
      t.ok(pdf.length > 5000, 'and the page has the keys on it', pdf.length);
    } finally { await t.g('Guide.keySheet(false)'); }
    t.ok(!(await t.g(`!!document.getElementById('print-sheet')`)), 'gone again from the screen');
  });

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
    // G5: from Beta 3.67 on, every version has two or three highlights (the third part of its entry), short and plain
    const bad = await t.g(`Guide.NEWS.filter(([v, , top]) => Number((v.match(/(\\d+)\\.(\\d+)/) || [0, 0, 0])[2]) >= 67 && Number((v.match(/(\\d+)\\./) || [0, 0])[1]) >= 3 && !(Array.isArray(top) && top.length >= 2 && top.length <= 3 && top.every((x) => x.length <= 70))).map((x) => x[0])`);
    t.eq(bad, [], 'versions without two or three short highlights');
  });

  // G5 (open point): the newest version with its highlights and every change folded; older versions folded
  area.quick('What\'s new: the highlights on top, everything else folded; after an update the card shows them once', async (t) => {
    const had = await t.g('Guide.NEWS[0].length > 2');
    if (!had) await t.g(`Guide.NEWS[0][2] = ['First highlight (test)', 'Second highlight (test)']`);
    try {
      await open(t, 'news');
      const v = await t.g(`(() => { const b = document.querySelector('.guide-body'); return { top: b.querySelectorAll('.news-now .news-top li').length, all: (b.querySelector('.news-now > details.news-fold > summary') || {}).textContent, closed: [...b.querySelectorAll('details.news-fold')].every((d) => !d.open), old: b.querySelectorAll('.news-older > details.news-old').length }; })()`);
      const n = await t.g('Guide.NEWS.length');
      const count = await t.g('Guide.NEWS[0][1].length');
      t.eq(v, { top: had ? v.top : 2, all: `All ${count} changes`, closed: true, old: n - 1 }, 'highlights, then "All … changes" and every older version folded');
      await t.g('Guide.close()');
      await t.g('App.previewUpdateDone()');
      const card = await t.until(() => t.g(`(() => { const d = document.querySelector('.upd-done'); return d && { h: d.querySelector('h2').textContent, li: d.querySelectorAll('.upd-done-top li').length, btns: [...d.querySelectorAll('.modal-actions .btn')].map((b) => b.textContent.trim()) }; })()`), 3000, 'the card after an update');
      t.eq(card, { h: `Now on ${LABEL}`, li: had ? card.li : 2, btns: ['All changes', 'OK'] }, 'the card: the version, its highlights, All changes and OK');
      await t.clickText('.upd-done .modal-actions .btn', 'All changes');
      await t.until(() => t.g(`Guide.isOpen() && Guide.tab === 'news'`), 3000, 'All changes opens What\'s new');
      await t.g('Guide.close()');
    } finally { if (!had) await t.g('Guide.NEWS[0].length = 2'); }
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
