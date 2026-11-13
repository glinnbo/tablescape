// Portraits (NPCs on the TV) and the campaign page
'use strict';

module.exports = (area) => {
  area.title('Conversation and the campaign page');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  const talk = async (t) => ((await t.tvDebug()).over || {}).talk;
  const faces = (t) => t.lib('portraits');

  area.quick('O opens Conversation; a portrait clicked there rises on the TV, clicked again it leaves', async (t) => {
    t.gm().webContents.focus();
    await t.key('O');
    t.eq(await t.popTitle(), 'Conversation', 'the panel after O');
    const p = faces(t)[0];
    t.ok(p, 'the library has a portrait');
    const r = await t.cmd('talk.toggle', { path: p.path });
    t.ok(r.ok, 'the portrait comes in', r);
    t.eq(t.state.talk.cast.map((c) => c.path), [p.path], 'who is on the TV');
    await t.until(async () => !!(await talk(t)), 5000, 'the portrait on the TV');
    await t.cmd('talk.toggle', { path: p.path });
    await t.cmd('talk.off', {});
    await t.until(async () => !(await talk(t)), 5000, 'the portrait to leave the TV');
  });

  area.deep('two portraits stand together; ending the talk clears the TV', async (t) => {
    const list = faces(t);
    t.ok(list.length >= 2, 'the library has two portraits', list.length);
    await t.cmd('talk.toggle', { path: list[0].path });
    await t.cmd('talk.toggle', { path: list[1].path });
    t.eq(t.state.talk.cast.length, 2, 'portraits on the TV');
    await t.until(async () => { const x = await talk(t); return x && JSON.stringify(x).length > 10; }, 5000, 'the talk on the TV');
    await t.cmd('talk.off', {});
    t.ok(!t.state.talk, 'the talk is over');
    await t.until(async () => !(await talk(t)), 5000, 'the TV to be clear');
  });

  area.deep('portraits need the table: from the campaign page the app says so instead of showing one', async (t) => {
    t.handle('campaign.page');
    await t.until(() => t.state.screen === 'campaign', 4000, 'the campaign page');
    const r = t.handle('talk.toggle', { path: faces(t)[0].path });
    t.ok(r.ok === false && /Start the table first/.test(r.error || ''), 'the app says to start the table first', r);
    await t.openDemo();
  });

  area.deep('the campaign page: a player marked as not here today is left out of the turn order', async (t) => {
    await t.cmd('party.set', { names: ['Ayla', 'Bo', 'Cy'] });
    await t.cmd('party.away', { name: 'Cy', away: true });
    t.has(t.store.cur.meta.away || [], 'Cy', 'who is away');
    if (t.state.init) t.handle('init.clear', {});
    await t.cmd('init.prepare', {});
    t.eq(t.state.init.entries.filter((e) => e.pc).map((e) => e.name).sort(), ['Ayla', 'Bo'], 'the players in the turn order');
    await t.cmd('party.away', { name: 'Cy', away: false });
    t.handle('init.clear', {});
  });

  area.deep('Start session opens the maps and shows the title on the TV; the page lists the party', async (t) => {
    await t.cmd('party.set', { names: ['Ayla', 'Bo'] });
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the campaign page');
    const text = await t.g(`document.body.textContent`);
    t.ok(/Ayla/.test(text) && /Bo/.test(text), 'the page names the players');
    const r = await t.cmd('session.start', {});
    t.ok(r.ok !== false, 'the session starts', r);
    await t.until(() => t.state.screen === 'play', 4000, 'the maps');
    t.ok(!!t.state.session, 'a session runs');
    await t.until(() => t.tv() && !t.tv().webContents.isLoading(), 8000, 'the TV window');
    t.hookAll();
    await t.until(async () => { const d = await t.tvDebug(); return d && d.over && d.over.title && d.over.title.shown; }, 8000, 'the title on the TV');
    await t.send();
    await t.until(async () => { const d = await t.tvDebug(); return !(d.over.title && d.over.title.shown); }, 6000, 'the first map to take the title away');
  });
};
