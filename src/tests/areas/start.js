// The start screen and the campaign's page
'use strict';
const PKG = require('../../../package.json');
const LABEL = PKG.releaseLabel || PKG.version;

module.exports = (area) => {
  area.title('Start screen and campaign page');

  area.quick('the start screen lists the demo campaign', async (t) => {
    t.eq(await t.g('document.body.dataset.screen'), 'home', 'the screen at the start');
    t.ok(await t.count('.camp:not(.camp-new)') >= 1, 'a campaign card is shown');
    t.ok(!!t.demo(), 'the demo campaign exists');
  });

  area.quick('the release shows on the start screen, in the title and in About', async (t) => {
    t.eq(await t.text('.wordmark .release'), LABEL, 'the release beside the name');
    t.eq(t.gm().getTitle(), `Tablescape ${LABEL}`, 'the window title');
    const about = await t.g(`window.ts.app('about')`);
    t.eq(about && about.version, PKG.version, 'the version in About');
  });

  area.quick('Discord and Toss a coin sit beside the Guide on the start screen (Beta 3.0)', async (t) => {
    const btns = await t.g(`[...document.querySelectorAll('.home-actions .btn')].map((b) => b.textContent.trim())`);
    t.ok(btns.includes('Discord') && btns.includes('Toss a coin') && btns.includes('Guide'), 'the buttons on the start screen', btns);
  });

  // the box beside "Check for updates": every state a new version goes through
  const upd = async (t, u, want) => {
    t.state.update = u; t.broadcast();
    return t.until(async () => { const x = await t.text('.upd'); return x && want.test(x) && x; }, 3000, `the update box to say ${want}`);
  };
  // Beta 3.9: Check for updates stays in the line whatever it says; the offer of a new version leads to GitHub too
  const updBtns = (t) => t.g(`[...document.querySelectorAll('.upd .btn')].map((b) => ({ text: b.textContent.trim(), off: b.disabled, link: b.dataset.link || null }))`);
  area.quick('Check for updates is always in the line; a new version can be looked at on GitHub first (Beta 3.9)', async (t) => {
    const seen = {};
    const states = { idle: [{ status: 'idle' }, /Check for updates/], latest: [{ status: 'latest' }, /Check for updates/], checking: [{ status: 'checking' }, /Looking/],
      available: [{ status: 'available', version: '9.9.9', label: 'Prototype 99', notes: null }, /is available/], quiet: [{ status: 'available', version: '9.9.9', label: 'Prototype 99', notes: null, quiet: true }, /Prototype 99 available/],
      downloading: [{ status: 'downloading', version: '9.9.9', label: 'Prototype 99', percent: 10 }, /10 %/], ready: [{ status: 'ready', version: '9.9.9', label: 'Prototype 99' }, /is ready/], error: [{ status: 'error', error: 'no network' }, /Couldn't check/] };
    for (const [name, [u, want]] of Object.entries(states)) { await upd(t, u, want); seen[name] = await updBtns(t); }
    const check = (name) => seen[name].find((b) => b.text === 'Check for updates');
    t.eq(Object.keys(states).filter((n) => !check(n)), [], 'the states without Check for updates', seen);
    t.eq(Object.keys(states).filter((n) => check(n) && check(n).off), ['checking', 'downloading', 'ready'], 'where it can\'t be pressed (nothing to look for then)');
    t.eq(Object.keys(states).filter((n) => seen[n].some((b) => b.text === 'Check on GitHub' && b.link === 'release')), ['available', 'quiet'], 'where Check on GitHub is offered');
    t.eq(await t.g(`window.ts.app('link.open', { to: 'release' })`), { ok: true, url: 'https://github.com/glinnbo/tablescape/releases/latest' }, 'where it leads');
    t.state.update = { status: 'idle' }; t.broadcast();
  });
  area.quick('a new version asks first: Install now? Yes / Not now', async (t) => {
    const text = await upd(t, { status: 'available', version: '9.9.9', label: 'Prototype 99', notes: null }, /Prototype 99 is available\. Install now\?/);
    t.ok(/Yes/.test(text) && /Not now/.test(text), 'both answers are offered', text);
    await upd(t, { status: 'available', version: '9.9.9', label: 'Prototype 99', notes: 'New things', quiet: true }, /Prototype 99 available/);
    t.state.update = { status: 'idle' }; t.broadcast();
  });
  area.quick('while it downloads the box shows the progress; when it is done it asks Restart now?', async (t) => {
    await upd(t, { status: 'downloading', version: '9.9.9', label: 'Prototype 99', percent: 42 }, /Prototype 99 · 42 %/);
    t.ok(await t.rect('.upd .upd-track'), 'the maid runs along a track');
    const text = await upd(t, { status: 'ready', version: '9.9.9', label: 'Prototype 99' }, /Prototype 99 is ready\. Restart now\?/);
    t.ok(/Restart now/.test(text) && /Later/.test(text), 'both answers are offered', text);
    t.ok(await t.rect('.upd .upd-cheer'), 'the maid cheers');
    await t.clickText('.upd .btn', 'Later');
    await t.until(async () => /installs when you close Tablescape/.test(await t.text('.upd')), 3000, 'the box after Later');
    await upd(t, { status: 'error', error: 'no network' }, /Couldn't check for updates/);
    t.state.update = { status: 'idle' }; t.broadcast();
  });

  area.quick('a click on the campaign opens its page; Prepare the maps opens the maps', async (t) => {
    await t.clickSel('.camp:not(.camp-new)');
    await t.until(() => t.state.screen === 'campaign', 5000, 'the campaign page');
    t.ok(await t.rect('.cp-prep'), 'the page has Prepare the maps');
    await t.clickSel('.cp-prep');
    await t.until(() => t.state.screen === 'play', 5000, 'the maps');
    t.ok(t.store.allMapIds().length >= 2, 'the demo campaign has its maps', t.store.allMapIds().length);
    t.ok(await t.count('.rail-btn') > 10, 'the tool rail is there');
  });

  area.quick('the campaign button leads back to its page, and from there to the start screen', async (t) => {
    await t.openDemo();
    await t.clickSel('.rail-btn[data-id="home"]');
    await t.until(() => t.state.screen === 'campaign', 5000, 'the campaign page');
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the start screen');
  });

  area.quick('a new campaign starts with a chapter and a map', async (t) => {
    const before = t.store.list().length;
    const r = t.handle('campaign.create', { name: 'Test campaign' });
    await t.sleep(600);
    t.eq(t.store.list().length, before + 1, 'campaigns after creating one');
    t.ok(t.store.cur && t.store.cur.meta.name === 'Test campaign', 'the new campaign is open', r);
    t.eq(t.store.cur.meta.chapters.length, 1, 'chapters of a new campaign');
    t.eq(t.store.allMapIds().length, 1, 'maps of a new campaign');
  });
};
