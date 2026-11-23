// The Ready list: what the GM wants at hand in a chapter
'use strict';

module.exports = (area) => {
  area.title('Ready list');
  area.before(async (K) => { await K.openDemo(); });

  const chapter = (t) => t.store.cur.meta.chapters[0];
  const ready = (t) => t.g(`(Play.state().campaign.chapters.find((c) => c.id === ${JSON.stringify(chapter(t).id)}) || {}).ready`);

  for (const [kind, cat] of [['tokens', 'tokens'], ['portraits', 'portraits'], ['handouts', 'handouts'], ['other', 'assets']]) {
    area.quick(`${kind}: a thing put on the Ready list is listed for the chapter and can be taken off`, async (t) => {
      const p = t.pic(cat);
      t.handle('ready.set', { chapterId: chapter(t).id, kind, items: [{ path: p }] });
      await t.until(async () => { const r = await ready(t); return r && (r[kind] || []).some((x) => x.path === p); }, 3000, 'the thing on the Ready list');
      t.handle('ready.set', { chapterId: chapter(t).id, kind, items: [] });
      await t.until(async () => { const r = await ready(t); return r && !(r[kind] || []).length; }, 3000, 'the Ready list to be empty');
    });
  }

  area.quick('the library drawer shows the Ready list as its shelf', async (t) => {
    const p = t.pic('tokens');
    t.handle('ready.set', { chapterId: chapter(t).id, kind: 'tokens', items: [{ path: p }] });
    t.gm().webContents.focus();
    await t.key('L');
    await t.until(() => t.g('Play.Drawer.isOpen'), 3000, 'the library drawer');
    const text = await t.until(async () => { const x = await t.text('#drawer'); return x && /Ready/.test(x) && x; }, 4000, 'the Ready shelf in the drawer');
    t.ok(text.length > 20, 'the drawer has content');
    t.handle('ready.set', { chapterId: chapter(t).id, kind: 'tokens', items: [] });
  });

  // H1 (open point): one list per chapter, named so; the same tick everywhere; with nothing ready a panel shows everything
  area.quick('one Ready list per chapter: its name on the shelf, the tick in the Library, no "Nothing ready yet" in the panels', async (t) => {
    const ch = chapter(t);
    const clearAll = () => { for (const k of ['tokens', 'portraits', 'handouts', 'other']) t.handle('ready.set', { chapterId: ch.id, kind: k, items: [] }); };
    const list = async (kind) => ((await ready(t)) || {})[kind] || [];
    clearAll(); await t.settle();
    try {
      // the Library: the shelf is "Ready for <chapter>", a tile's tick puts it on the list
      await t.g(`Play.Drawer.open({ cat: 'tokens' })`);
      await t.until(() => t.g('Play.Drawer.isOpen'), 3000, 'the library drawer');
      await t.until(() => t.g(`!!document.querySelector('#drawer .lt-tick')`), 5000, 'a tick on the tiles');
      t.ok((await t.text('#drawer .lib-tray-label')).includes(`Ready for ${ch.name}`), 'the shelf has the chapter\'s name', await t.text('#drawer .lib-tray-label'));
      t.ok(!/Drag things here while you prep/.test(await t.text('#drawer')), 'no explanation under it');
      await t.g(`document.querySelector('#drawer .lt-tick').click()`);
      await t.until(async () => (await list('tokens')).length === 1, 3000, 'the token on the Ready list');
      await t.until(() => t.g(`!!document.querySelector('#drawer .lt-tick.on')`), 3000, 'its tick lit');
      t.gm().webContents.focus(); await t.key('Escape');
      clearAll(); await t.settle();
      // Tokens: Ready empty: every token, with the tick; one ticked: Ready · <chapter>
      await t.g(`Play.openPop('token')`);
      await t.until(() => t.g(`!!document.querySelector('#pop .tok-row')`), 4000, 'the Tokens panel');
      await t.g(`[...document.querySelectorAll('#pop .tok-groups button, #pop .tok-groups [role="tab"], #pop .tok-groups .tile')].find((b) => /Ready/.test(b.textContent)).click()`);
      const tk = await t.until(() => t.g(`(() => { const g = document.querySelector('#pop .tok-group'); const ticks = document.querySelectorAll('#pop .tok-pick .pl-tick'); return g && ticks.length && { title: g.textContent, ticks: ticks.length, dead: document.querySelector('#pop').textContent.includes('Nothing ready yet') }; })()`), 5000, 'all tokens with ticks');
      t.ok(/All tokens/.test(tk.title) && !tk.dead, 'Tokens: nothing ready yet shows every token, no dead end', tk);
      await t.g(`document.querySelector('#pop .tok-pick .pl-tick').click()`);
      await t.until(async () => (await list('tokens')).length === 1, 3000, 'a token ticked');
      await t.until(async () => (await t.text('#pop .tok-group')).includes(`Ready · ${ch.name}`), 3000, 'Tokens on Ready now');
      await t.g(`Play.closePop()`);
      // Handouts: Ready empty: every handout, with the tick
      await t.g(`Play.TB.openPanel('handouts')`);
      const ho = await t.until(() => t.g(`(() => { const p = document.querySelector('.fp[data-id="handouts"]'); const tick = p && p.querySelector('.talk-pick .pl-tick'); return tick && { text: p.textContent }; })()`), 6000, 'every handout with a tick');
      t.ok(/All handouts/.test(ho.text) && !/Nothing ready yet/.test(ho.text), 'Handouts: every handout, no dead end');
      await t.g(`document.querySelector('.fp[data-id="handouts"] .talk-pick .pl-tick').click()`);
      await t.until(async () => (await list('handouts')).length === 1, 3000, 'a handout ticked');
      await t.until(async () => (await t.g(`document.querySelector('.fp[data-id="handouts"]').textContent`)).includes(`Ready · ${ch.name}`), 3000, 'Handouts on Ready now');
      await t.g(`Play.Floats.hide('handouts')`);
      // Conversation: no Ready chip while nothing is ready, All on, the tick on the portraits
      clearAll(); await t.settle();
      await t.g(`Play.TB.openPanel('talk')`);
      const cv = await t.until(() => t.g(`(() => { const w = document.querySelector('.fp[data-id="talk"]'); if (!w || !w.querySelector('.talk-pick .pl-tick')) return null; return { chips: [...w.querySelectorAll('.cs-chip')].map((x) => x.textContent), on: (w.querySelector('.cs-chip.on') || {}).textContent, dead: w.textContent.includes('Nothing ready') }; })()`), 6000, 'Conversation with ticks');
      t.ok(!cv.chips.includes('Ready') && cv.on === 'All' && !cv.dead, 'Conversation: All, no empty Ready chip', cv);
      await t.g(`Play.Floats.hide('talk')`);
    } finally { clearAll(); await t.settle(); }
  });

  area.deep('a campaign saved with the old tray gets its things on the first chapter\'s Ready list', async (t) => {
    const c = t.store.cur;
    const tok = t.pic('tokens'); const ho = t.pic('handouts');
    for (const k of ['tokens', 'portraits', 'handouts', 'other']) t.handle('ready.set', { chapterId: chapter(t).id, kind: k, items: [] });
    // (the tray kept library references; one by its path alone must find its kind too)
    c.meta.tray = [t.library.toRef(tok), { path: ho }];
    delete c.meta.trayMoved;
    t.store.flush();
    t.handle('campaign.home');
    await t.sleep(300);
    await t.openDemo();
    const r = await ready(t);
    t.ok((r.tokens || []).some((x) => x.path === tok), 'the token from the tray is on the Ready list', r);
    t.ok((r.handouts || []).some((x) => x.path === ho), 'the handout from the tray is on the Ready list', r);
    t.ok(!(t.store.cur.meta.tray || []).length, 'the old tray is empty afterwards');
  });
};
