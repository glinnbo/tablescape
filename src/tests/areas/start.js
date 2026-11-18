// The home screen (Beta 3.17: one screen like a game's main menu, for all campaigns) and the start
'use strict';
const fs = require('fs');
const path = require('path');
const PKG = require('../../../package.json');
const LABEL = PKG.releaseLabel || PKG.version;

module.exports = (area) => {
  area.title('Home screen');

  // the home with no campaign open (as at the start), the demo picked
  const home = async (t) => {
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home' && !!document.querySelector('.hm-slot:not(.new)')`), 5000, 'the home screen');
    const demo = t.demo();
    await t.g(`(() => { const b = document.querySelector('.hm-slot[data-id="${demo.id}"]'); if (b) b.click(); })()`);
    await t.until(async () => (await t.text('.hm-name')) === demo.name, 3000, 'the demo picked');
    return demo;
  };
  const drawerKind = (t) => t.g(`(() => { const d = document.querySelector('.hm-dr'); return d ? d.dataset.kind : null; })()`);

  area.quick('the start: the home screen with the campaigns along the bottom', async (t) => {
    t.eq(await t.g('document.body.dataset.screen'), 'home', 'the screen at the start');
    t.ok(await t.count('.hm-slot:not(.new)') >= 1, 'a campaign slot is shown');
    t.ok(!!t.demo(), 'the demo campaign exists');
    t.ok(await t.g(`!document.getElementById('boot') && document.body.classList.contains('after-splash')`), 'the splash is gone (the self-test skips its wait)');
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
    t.ok(/class="splash-logo"/.test(html) && /icon\.png/.test(html), 'the splash shows the name and the icon');
  });

  area.quick('the release shows under the name, in the title and in About', async (t) => {
    t.eq(await t.text('.hm-brand .wordmark'), 'Tablescape', 'the name');
    t.eq(await t.text('.hm-brand .release'), LABEL, 'the release');
    const [nm, rel] = [await t.rect('.hm-brand .wordmark'), await t.rect('.hm-brand .release')];
    t.ok(rel.y > nm.y + nm.h * 0.6 && Math.abs(rel.cx - nm.cx) < 6, 'under the name, centred', { nm, rel });
    t.eq(t.gm().getTitle(), `Tablescape ${LABEL}`, 'the window title');
    const about = await t.g(`window.ts.app('about')`);
    t.eq(about && about.version, PKG.version, 'the version in About');
  });

  area.quick('the top: Tutorial, Guide, Library, Discord and Ko-fi; no Options there (it is in the menu)', async (t) => {
    const btns = await t.g(`[...document.querySelectorAll('.hm-actions .btn')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())`);
    for (const b of ['Tutorial', 'Guide', 'Library', 'Discord', 'Ko-fi']) t.has(btns, b, `${b} at the top`);
    t.ok(!btns.includes('Options'), 'Options is not at the top', btns);
    await t.clickText('.hm-actions .btn', 'Tutorial');
    await t.until(async () => /coming soon/i.test(await t.g(`document.getElementById('toasts').textContent`)), 3000, 'the Tutorial says it is coming soon');
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

  area.quick('the picked campaign fills the screen: name, PLAY, PREPARE THE MAPS, the menu with Options, the status line', async (t) => {
    const demo = await home(t);
    t.ok(!t.store.cur, 'nothing is open yet');
    t.ok(/PLAY/.test(await t.text('.hm-play')), 'PLAY');
    t.ok(/PREPARE\s*THE MAPS/.test(await t.text('.hm-prep')), 'PREPARE THE MAPS');
    t.eq(await t.g(`[...document.querySelectorAll('.hm-menu .hm-item')].map((b) => b.textContent.trim())`), ['Players', 'Screens on the table', 'Campaign settings', 'Options'], 'the menu');
    t.eq(await t.count('.hm-status .hm-st'), 3, 'the status line: the TV, the speakers, the size');
    const [opt, st] = [await t.rect('.hm-item[data-id="options"]'), await t.rect('.hm-status')];
    t.ok(st.y - (opt.y + opt.h) >= 20, 'room between Options and the status line', { opt, st });
    t.ok(/maps?/.test(await t.text('.hm-meta')), 'the line under the name', await t.text('.hm-meta'));
    t.eq(t.settings.lastCampaignId, demo.id, 'the pick is remembered for the next start');
  });

  area.quick('PREPARE THE MAPS opens the picked campaign on its maps', async (t) => {
    await home(t);
    await t.clickSel('.hm-prep');
    await t.until(() => t.state.screen === 'play', 5000, 'the maps');
    t.ok(t.store.allMapIds().length >= 2, 'the demo campaign has its maps', t.store.allMapIds().length);
    t.ok(!t.state.session, 'no session started');
    t.ok(await t.count('.rail-btn') > 10, 'the tool rail is there');
  });

  area.quick('the campaign button on the maps leads back to the home screen with that campaign; campaign.home closes it', async (t) => {
    await t.openDemo();
    await t.clickSel('.rail-btn[data-id="home"]');
    await t.until(() => t.state.screen === 'campaign', 5000, 'the home screen with the campaign open');
    t.eq(await t.text('.hm-name'), t.store.cur.meta.name, 'its name');
    t.handle('campaign.home');
    await t.until(() => t.g(`document.body.dataset.screen === 'home'`), 5000, 'the home screen, nothing open');
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

  area.quick('a slot only shows its campaign (nothing opens); the others are greyed out; arrows move between them', async (t) => {
    if (!t.store.list().some((c) => c.name === 'Test campaign')) t.handle('campaign.create', { name: 'Test campaign' });
    const demo = await home(t);
    const other = t.store.list().find((c) => c.name === 'Test campaign');
    await t.clickSel(`.hm-slot[data-id="${other.id}"]`);
    await t.until(async () => (await t.text('.hm-name')) === 'Test campaign', 3000, 'the other campaign shown');
    t.ok(!t.store.cur, 'still nothing open');
    const look = await t.g(`[...document.querySelectorAll('.hm-slot:not(.new)')].map((b) => ({ on: b.classList.contains('on'), op: +getComputedStyle(b).opacity, f: getComputedStyle(b).filter }))`);
    t.ok(look.filter((x) => x.on).length === 1 && look.filter((x) => !x.on).every((x) => Math.abs(x.op - 0.5) < 0.05 && /grayscale/.test(x.f)), 'one picked, the others half greyed out', look);
    const ids = t.handle('campaign.list').campaigns.map((c) => c.id);
    const i = ids.indexOf(other.id);
    await t.g(`document.activeElement && document.activeElement.blur()`);
    await t.key(i > 0 ? 'Left' : 'Right');
    await t.until(async () => (await t.g(`(document.querySelector('.hm-slot.on') || {}).dataset.id`)) === ids[i > 0 ? i - 1 : i + 1], 3000, 'the arrow key picks the next campaign');
    await t.key('Down');
    t.ok(await t.g(`document.activeElement && document.activeElement.classList.contains('hm-play')`), 'the down arrow starts at PLAY');
    await t.key('Down');
    t.ok(await t.g(`document.activeElement && document.activeElement.classList.contains('hm-prep')`), 'then PREPARE THE MAPS');
    await home(t);
    t.eq(t.settings.lastCampaignId, demo.id, 'the demo is picked again');
  });

  area.quick('PLAY starts the session of the picked campaign: the title on the TV, then BACK TO THE TABLE', async (t) => {
    await home(t);
    await t.clickSel('.hm-play');
    await t.until(() => t.state.screen === 'play' && !!t.state.session, 6000, 'the session');
    t.ok(!!t.state.title, 'the title on the table');
    t.handle('campaign.page');
    await t.until(async () => /BACK TO\s*THE TABLE/.test(await t.text('.hm-play')), 3000, 'BACK TO THE TABLE');
    t.ok(await t.g(`document.querySelector('.hm-prep').hidden`), 'PREPARE THE MAPS hides while a session runs');
    await t.clickSel('.hm-play');
    await t.until(() => t.state.screen === 'play', 4000, 'back on the maps');
    t.ok(!!t.state.session, 'the same session');
  });

  area.quick('the pop-ups slide in from the right with the orange edge: Players, Screens, Campaign settings, the table check; Esc closes', async (t) => {
    await t.openDemo();
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the home screen');
    for (const [id, kind] of [['players', 'players'], ['screens', 'screens'], ['settings', 'settings']]) {
      await t.clickSel(`.hm-item[data-id="${id}"]`);
      await t.until(async () => (await drawerKind(t)) === kind, 3000, `the ${kind} pop-up`);
      const W = await t.g('innerWidth');
      await t.until(async () => { const r = await t.rect('.hm-dr'); return r && Math.abs(r.x + r.w - W) < 3; }, 2000, `${kind}: against the right edge`);
      t.ok(await t.rect('.hm-dr-edge line.line'), `${kind}: the orange edge`);
      t.ok(await t.g(`document.querySelector('.hm-item[data-id="${id}"]').classList.contains('on')`), `${kind}: marked in the menu`);
      await t.key('Escape');
      await t.until(async () => !(await drawerKind(t)), 3000, `${kind} closes with Esc`);
    }
    await t.clickSel('.hm-st');
    await t.until(async () => (await drawerKind(t)) === 'check', 3000, 'a click on the status line opens the table check');
    t.ok(await t.count('.hm-dr .chk-row') >= 5, 'the table check rows');
    await t.key('Escape');
  });

  area.quick('Players: several at once with commas; who is here today', async (t) => {
    await t.openDemo();
    await t.cmd('party.set', { names: [] });
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the home screen');
    await t.clickSel('.hm-item[data-id="players"]');
    await t.until(() => t.rect('.hm-dr .pl-add'), 3000, 'the Players pop-up');
    await t.clickSel('.hm-dr .pl-add');
    await t.type('Ayla, Bo, Cy');
    await t.key('Enter');
    await t.until(() => (t.store.cur.meta.party || []).length === 3, 3000, 'three players added');
    t.eq(t.store.cur.meta.party, ['Ayla', 'Bo', 'Cy'], 'the party');
    await t.until(() => t.count('.hm-dr .hm-pl-row'), 3000, 'their rows');
    await t.clickSel('.hm-dr .hm-pl-row[data-name="Bo"] .hm-switch');
    await t.until(() => (t.store.cur.meta.away || []).includes('Bo'), 3000, 'Bo is not here today');
    await t.until(async () => (await t.count('.hm-party .hm-pc.away')) === 1, 3000, 'Bo greyed out under the name');
    await t.key('Escape');
    await t.cmd('party.away', { name: 'Bo', away: false });
  });

  area.quick('Campaign settings: a cover picture chosen becomes the background; The first map goes back to it', async (t) => {
    await t.openDemo();
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the home screen');
    await t.clickSel('.hm-item[data-id="settings"]');
    await t.until(() => t.rect('.hm-set-row[data-id="cover"]'), 3000, 'Campaign settings');
    t.eq(await t.g(`[...document.querySelectorAll('.hm-set-row')].map((b) => b.dataset.id)`), ['rename', 'cover', 'folder', 'backups', 'export', 'delete'], 'the rows');
    await t.clickSel('.hm-set-row[data-id="cover"]');
    await t.until(async () => (await t.count('.hm-cover')) >= 3, 3000, 'the maps to choose from');
    const maps = t.store.allMapIds().map((id) => t.store.map(id)).filter((m) => m.bg && m.bg.path);
    const second = maps[1];
    await t.clickSel('.hm-cover:nth-child(3)');
    await t.until(() => t.store.cur.meta.coverPick && t.store.cur.meta.coverPick.path === second.bg.path, 3000, 'the second map as the cover');
    await t.until(async () => decodeURIComponent((await t.g(`(document.querySelector('.hm-bg .hm-pic:not(.out)') || {}).src || ''`))).endsWith(path.basename(second.bg.path)), 4000, 'the background shows it');
    await t.clickSel('.hm-cover:nth-child(1)');
    await t.until(() => !t.store.cur.meta.coverPick, 3000, 'back to the first map');
    await t.key('Escape');
  });

  area.quick('Continue opens the map that was on the table; the latest maps are listed', async (t) => {
    await t.openDemo();
    const [a, b] = t.store.allMapIds();
    t.handle('table.send', { id: a });
    t.handle('edit.open', { id: b });
    t.handle('campaign.page');
    await t.until(async () => /On the table when you stopped/.test(await t.text('.hm-cont')), 4000, 'Continue');
    t.ok((await t.text('.hm-cont')).includes(t.store.map(a).name), 'Continue names the map that was on the table');
    t.ok((await t.text('.hm-right')).includes(t.store.map(b).name), 'the other among the latest maps');
    await t.clickSel('.hm-cont');
    await t.until(() => t.state.screen === 'play' && t.state.editMapId === a, 4000, 'its map open');
    const listed = t.handle('campaign.list').campaigns.find((c) => c.id === t.store.cur.meta.id);
    t.ok(listed.preview && listed.preview.cont && listed.preview.cont.id === a, 'the home knows it without opening the campaign', listed.preview);
  });

  area.quick('Options slides in from the right, on the home screen and on the maps', async (t) => {
    await t.openDemo();
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the home screen');
    await t.clickSel('.hm-item[data-id="options"]');
    await t.until(() => t.g('App.optionsOpen()'), 3000, 'Options open');
    const look = async () => t.g(`(() => { const p = document.querySelector('.modal.options').getBoundingClientRect(); return { right: Math.round(p.right), w: innerWidth, top: Math.round(p.top), edge: !!document.querySelector('.options-back .opt-edge'), title: document.querySelector('.opt-big').textContent }; })()`);
    let l = await t.until(async () => { const x = await look(); return Math.abs(x.right - x.w) < 3 && x; }, 2000, 'Options against the right edge');
    t.ok(l.top === 0 && l.edge && l.title === 'Options', 'on the home screen', l);
    await t.key('Escape');
    await t.until(async () => !(await t.g('App.optionsOpen()')), 3000, 'closed');
    t.handle('campaign.play');
    await t.until(() => t.state.screen === 'play', 3000, 'the maps');
    await t.g(`App.openOptions('tv')`);
    l = await t.until(async () => { const x = await look(); return Math.abs(x.right - x.w) < 3 && x; }, 2000, 'Options on the maps against the right edge');
    t.ok(l.edge, 'on the maps the same', l);
    await t.g('App.closeOptions()');
  });

  area.quick('a small window: the home screen shrinks as a whole and everything stays in view', async (t) => {
    await home(t);
    const win = t.gm();
    const was = win.getContentSize();
    try {
      win.setContentSize(1100, 680);
      await t.sleep(700);
      const r = await t.g(`(() => { const inView = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; };
        return { hs: +getComputedStyle(document.getElementById('home')).getPropertyValue('--hs'), play: inView('.hm-play'), options: inView('.hm-item[data-id="options"]'), status: inView('.hm-status'), slot: inView('.hm-slot.on'), right: inView('.hm-right'), top: inView('.hm-actions') }; })()`);
      t.ok(r.hs > 0.6 && r.hs < 0.8, 'scaled down', r);
      t.ok(r.play && r.options && r.status && r.slot && r.right && r.top, 'all in view', r);
    } finally { win.setContentSize(was[0], was[1]); await t.sleep(400); }
  });
};
