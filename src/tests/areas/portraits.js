// Portraits (NPCs on the TV) and the home screen
'use strict';

module.exports = (area) => {
  area.title('Conversation and the home screen');
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

  // Beta 3.19: with players on both sides, a big portrait stays clear of the other side's band, on both sides alike
  area.quick('both sides: a big portrait stays below the other side\'s band; the bands lie over both sides\' portraits', async (t) => {
    const p = faces(t)[0];
    t.eq(t.settings.seats || 'both', 'both', 'players on both sides');
    if (t.state.talk) await t.cmd('talk.off', {});
    await t.cmd('talk.size', { path: p.path, scale: 2 });
    await t.g(`window.ts.settings({ talk: { size: 0.7 } })`);
    try {
      await t.cmd('talk.toggle', { path: p.path });
      const look = () => t.t(`(() => { const n = [...document.querySelectorAll('.tv-talk .talk-npc:not(.out)')]; const z = (sel) => +getComputedStyle(document.querySelector(sel)).zIndex;
        return { n: n.length, far: n.filter((x) => x.closest('.far')).length, hs: n.map((x) => x.getBoundingClientRect().height), H: innerHeight, cast: z('.talk-layer.castl.far'), ink: z('.talk-layer.inkl.near') }; })()`);
      const r = await t.until(async () => { const x = await look(); return x.n === 2 && x.hs.every((hh) => hh > 50) && x; }, 5000, 'the portrait on both sides');
      t.eq(r.far, 1, 'one copy for the far side');
      t.ok(r.hs.every((hh) => hh <= r.H * 0.87) && Math.abs(r.hs[0] - r.hs[1]) < 2, 'both no taller than the room between the bands, the same size', r);
      t.ok(r.ink > r.cast, 'the near band lies over the far side\'s portrait as the far band over the near one', r);
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.size', { path: p.path, scale: 1 });
      await t.g(`window.ts.settings({ talk: { size: 0.34 } })`);
    }
  });

  // Second Builder: a portrait's looks (Bloodied, Shaded, Hidden), drawn into its picture on the TV; they stack
  // (blood, then the shade, then the silhouette), and when Hidden goes off the old picture fades slowly over the new one
  const tvPixels = (t) => t.t(`(() => {
    const f = [...document.querySelectorAll('.tv-talk .talk-side.near ~ .talk-layer.castl.near .talk-npc:not(.out) img, .tv-talk .talk-layer.castl.near .talk-npc:not(.out) img')][0];
    if (!f || !f.naturalWidth) return null;
    const draw = (im) => { const c = document.createElement('canvas'); c.width = 120; c.height = Math.round(120 * im.naturalHeight / im.naturalWidth); const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height).data; };
    return new Promise((res) => { const o = new Image(); o.onload = () => {
      const a = draw(o); const b = draw(f); const n = Math.min(a.length, b.length);
      let red0 = 0; let red1 = 0; let on = 0; let lum0 = 0; let lum1 = 0; let topOn = 0; let top0 = 0; let top1 = 0; let most = 0;
      const rows = n / 4 / 120; let first = -1;
      for (let i = 0; i < n; i += 4) { if (a[i + 3] > 200) { first = Math.floor(i / 4 / 120); break; } }
      for (let i = 0; i < n; i += 4) {
        if (a[i + 3] < 200) continue; on++;
        const L0 = a[i] + a[i + 1] + a[i + 2]; const L1 = b[i] + b[i + 1] + b[i + 2];
        lum0 += L0; lum1 += L1; most = Math.max(most, L1);
        if (a[i] > 1.7 * a[i + 1] && a[i] > 1.7 * a[i + 2] && a[i] > 60) red0++;
        if (b[i] > 1.7 * b[i + 1] && b[i] > 1.7 * b[i + 2] && b[i] > 60) red1++;
        const row = Math.floor(i / 4 / 120);
        if (row >= first && row < first + rows * 0.06) { topOn++; top0 += L0; top1 += L1; }
      }
      res({ on, red0: red0 / on, red1: red1 / on, lum: lum1 / Math.max(1, lum0), top: top1 / Math.max(1, top0), most });
    }; o.src = f.closest('.talk-npc').dataset.src; });
  })()`);
  area.quick('looks: Bloodied, Shaded and Hidden stack on the TV; Hidden off fades the figure in', async (t) => {
    const p = faces(t)[0];
    const looks = async () => { const x = await talk(t); return x && x.looks && x.looks[0]; };
    if (t.state.talk) await t.cmd('talk.off', {});
    try {
      t.ok((await t.cmd('talk.fx', { path: p.path, bloodOn: true, blood: 0.8 })).ok, 'Bloodied at 80 %');
      t.eq(t.settings.portraitFx[p.path], { bloodOn: true, blood: 0.8 }, 'kept for this portrait');
      await t.cmd('talk.toggle', { path: p.path });
      await t.until(async () => { const l = await looks(); return l && l.composed && l.blood === 0.8; }, 8000, 'the bloodied picture on the TV');
      await t.sleep(1600); // (its entry animation)
      const b = await tvPixels(t);
      t.ok(b && b.red1 > b.red0 + 0.04, 'clearly more blood red on the figure than in the portrait itself', b);
      await t.shot(t.tv(), 'looks-bloodied');
      await t.cmd('talk.fx', { path: p.path, shadeOn: true, shade: 0.6 });
      await t.until(async () => { const l = await looks(); return l && l.shade === 0.6 && !l.veil; }, 6000, 'shaded as well');
      await t.sleep(300);
      const s = await tvPixels(t);
      t.ok(s.top < 0.75 && s.red1 > s.red0, 'the top of the head darker, the blood still there', s);
      await t.shot(t.tv(), 'looks-bloodied-shaded');
      await t.cmd('talk.fx', { path: p.path, hidden: true });
      await t.until(async () => { const l = await looks(); return l && l.hidden && !l.veil; }, 6000, 'hidden');
      await t.sleep(300);
      const k = await tvPixels(t);
      t.ok(k.most < 40, 'only a black silhouette: no light pixel left on the figure', k);
      await t.shot(t.tv(), 'looks-hidden');
      await t.cmd('talk.fx', { path: p.path, hidden: false });
      await t.until(async () => { const l = await looks(); return l && !l.hidden && l.veil; }, 3000, 'the dark picture lying over the new one');
      await t.sleep(700);
      t.ok((await looks()).veil, 'still fading after 0.7 s (a slow reveal)');
      await t.until(async () => { const l = await looks(); return l && !l.veil; }, 3000, 'the reveal to finish');
      await t.cmd('talk.fx', { path: p.path, reset: true });
      t.ok(!(t.settings.portraitFx || {})[p.path], 'Clear: nothing kept for it');
      await t.until(async () => { const l = await looks(); return l && !l.composed; }, 6000, 'the plain portrait again');
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.fx', { path: p.path, reset: true });
    }
  });

  area.deep('looks: right-click a portrait in Conversation: switches, sliders and a preview', async (t) => {
    const p = faces(t)[0];
    const ch = t.store.cur.meta.chapters.find((c) => (c.maps || []).some((m) => (m.id || m) === t.state.editMapId)) || t.store.cur.meta.chapters[0];
    t.ok(t.handle('ready.set', { chapterId: ch.id, kind: 'portraits', items: [{ path: p.path, name: p.name }] }).ok, 'the portrait on the Ready list');
    try {
      if (!(await t.popTitle())) { t.gm().webContents.focus(); await t.key('O'); }
      const sel = `#pop.on .talk-pick[data-flash=${JSON.stringify(p.path)}]`;
      await t.until(() => t.count(sel), 4000, 'the portrait in the panel');
      await t.rightClickSel(sel);
      await t.until(() => t.count('.talk-sizepop .tsp-looks'), 3000, 'the popup with its looks');
      t.eq(await t.g(`[...document.querySelectorAll('.talk-sizepop .tsp-sw .ctl-label')].map((x) => x.textContent)`), ['Bloodied', 'Shaded', 'Hidden'], 'the three looks');
      t.eq(await t.g(`[...document.querySelectorAll('.talk-sizepop .tsp-looks input[type=range]')].map((x) => x.disabled)`), [true, true], 'their sliders wait until they are switched on');
      await t.g(`document.querySelectorAll('.talk-sizepop .tsp-sw input')[0].click()`);
      await t.until(() => (t.settings.portraitFx[p.path] || {}).bloodOn === true, 2000, 'Bloodied on');
      await t.g(`(() => { const r = document.querySelectorAll('.talk-sizepop .tsp-looks input[type=range]')[0]; r.value = 65; r.dispatchEvent(new Event('input')); })()`);
      await t.until(() => (t.settings.portraitFx[p.path] || {}).blood === 0.65, 2000, 'its amount from the slider');
      await t.g(`document.querySelectorAll('.talk-sizepop .tsp-sw input')[2].click()`);
      await t.until(() => (t.settings.portraitFx[p.path] || {}).hidden === true, 2000, 'Hidden on');
      const dark = () => t.g(`(() => { const c = document.querySelector('.talk-sizepop .tsp-preview'); if (!c || c.width < 10) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let most = 0; let on = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { on++; most = Math.max(most, d[i] + d[i + 1] + d[i + 2]); } return on > 50 && most < 40; })()`);
      await t.until(dark, 4000, 'the preview: a black silhouette');
      await t.shot(t.gm(), 'looks-popup');
      await t.g(`document.querySelector('.talk-sizepop .tsp-sec .tg-clear').click()`);
      await t.until(() => !(t.settings.portraitFx || {})[p.path], 2000, 'Clear takes all looks off');
      await t.key('Escape');
      t.ok(!(await t.count('.talk-sizepop')), 'Esc closes the popup');
    } finally {
      await t.cmd('talk.fx', { path: p.path, reset: true });
      t.handle('ready.set', { chapterId: ch.id, kind: 'portraits', items: [] });
    }
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

  area.deep('portraits need the table: from the home screen the app says so instead of showing one', async (t) => {
    t.handle('campaign.page');
    await t.until(() => t.state.screen === 'campaign', 4000, 'the home screen');
    const r = t.handle('talk.toggle', { path: faces(t)[0].path });
    t.ok(r.ok === false && /Start the table first/.test(r.error || ''), 'the app says to start the table first', r);
    await t.openDemo();
  });

  area.deep('the home screen: a player marked as not here today is left out of the turn order', async (t) => {
    await t.cmd('party.set', { names: ['Ayla', 'Bo', 'Cy'] });
    await t.cmd('party.away', { name: 'Cy', away: true });
    t.has(t.store.cur.meta.away || [], 'Cy', 'who is away');
    if (t.state.init) t.handle('init.clear', {});
    await t.cmd('init.prepare', {});
    t.eq(t.state.init.entries.filter((e) => e.pc).map((e) => e.name).sort(), ['Ayla', 'Bo'], 'the players in the turn order');
    await t.cmd('party.away', { name: 'Cy', away: false });
    t.handle('init.clear', {});
  });

  area.deep('Start session opens the maps and shows the title on the TV; the home screen lists the party', async (t) => {
    await t.cmd('party.set', { names: ['Ayla', 'Bo'] });
    t.handle('campaign.page');
    await t.until(() => t.g(`document.body.dataset.screen === 'campaign'`), 4000, 'the home screen');
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
