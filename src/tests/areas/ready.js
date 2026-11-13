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
