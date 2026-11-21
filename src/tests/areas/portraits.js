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
    // (Second Builder, second-conversation-stage: Conversation is a window of its own, with the small TV)
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="talk"] .cs-stage')`), 3000, 'the Conversation window after O');
    t.eq(await t.g(`document.querySelector('.fp[data-id="talk"] .fp-title').textContent`), 'Conversation', 'its title');
    const p = faces(t)[0];
    t.ok(p, 'the library has a portrait');
    const r = await t.cmd('talk.toggle', { path: p.path });
    t.ok(r.ok, 'the portrait comes in', r);
    t.eq(t.state.talk.cast.map((c) => c.path), [p.path], 'who is on the TV');
    await t.until(async () => !!(await talk(t)), 5000, 'the portrait on the TV');
    await t.cmd('talk.toggle', { path: p.path });
    await t.cmd('talk.off', {});
    await t.until(async () => !(await talk(t)), 5000, 'the portrait to leave the TV');
    await t.key('O');
    await t.until(() => t.g(`!document.querySelector('.fp[data-id="talk"]')`), 3000, 'O again closes it');
  });

  // Second Builder (second-conversation-stage), Glinn 21 Nov 2026: a tall portrait may reach over the far side's band,
  // away from the players who look at it (in front of that band); its feet still rise out of its own band. Where it
  // would meet the far copy (standing in the middle) it keeps below the bands as before (Beta 3.19)
  area.quick('both sides: a tall portrait reaches over the far band (in front of it); in the middle it keeps below the bands', async (t) => {
    const p = faces(t)[0];
    t.eq(t.settings.seats || 'both', 'both', 'players on both sides');
    if (t.state.talk) await t.cmd('talk.off', {});
    await t.cmd('talk.size', { path: p.path, scale: 2 });
    await t.g(`window.ts.settings({ talk: { size: 0.46, pos: 1 } })`);
    const look = () => t.t(`(() => { const n = [...document.querySelectorAll('.tv-talk .talk-npc:not(.out)')]; const z = (sel) => +getComputedStyle(document.querySelector(sel)).zIndex;
      const fr = document.querySelector('.talk-layer.inkf.near .talk-ink-front'); const base = document.querySelector('.talk-layer.inkl.near .talk-ink');
      return { n: n.length, far: n.filter((x) => x.closest('.far')).length, hs: n.map((x) => x.getBoundingClientRect().height), H: innerHeight, cast: z('.talk-layer.castl.far'), ink: z('.talk-layer.inkl.near'), front: z('.talk-layer.inkf.near'),
        clipFront: fr ? fr.style.clipPath : '', clipBase: base ? base.style.clipPath : '' }; })()`);
    try {
      await t.cmd('talk.toggle', { path: p.path });
      const r = await t.until(async () => { const x = await look(); return x.n === 2 && x.hs.every((hh) => hh > 50) && x; }, 5000, 'the portrait on both sides');
      t.eq(r.far, 1, 'one copy for the far side');
      t.ok(r.hs.every((hh) => hh > r.H * 0.87) && Math.abs(r.hs[0] - r.hs[1]) < 2, 'standing at the side: taller than the room between the bands, both the same', r);
      t.ok(r.cast > r.ink && r.front > r.cast, 'the portraits over the bands; each band\'s own copy over its own portraits\' feet', r);
      t.ok(/polygon/.test(r.clipFront) && /polygon/.test(r.clipBase), 'the band cut in two: in front where the portraits stand, behind elsewhere', r);
      await t.g(`window.ts.settings({ talk: { pos: 0.5 } })`);
      const m = await t.until(async () => { const x = await look(); return x.hs.every((hh) => hh <= x.H * 0.87) && x; }, 4000, 'in the middle: below the bands');
      t.ok(m.hs.every((hh) => hh <= m.H * 0.87), 'in the middle (where it meets the far copy): no taller than the room between the bands', m);
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.size', { path: p.path, scale: 1 });
      await t.g(`window.ts.settings({ talk: { size: 0.34, pos: 1 } })`);
    }
  });

  // Second Builder (second-conversation-stage): the Conversation window. A click brings a portrait in and lets it speak,
  // never takes it out; ✕ and Delete do. The small TV lays them out as the TV does, the speaker drags sideways
  area.quick('Conversation window: a click brings in and lets speak, never takes out; ✕ and Delete do; the small TV matches the TV', async (t) => {
    const list = faces(t);
    t.ok(list.length >= 2, 'two portraits in the library', list.length);
    if (t.state.talk) await t.cmd('talk.off', {});
    await t.g(`App && Play; TalkStage.pick(null)`);
    t.gm().webContents.focus();
    if (!(await t.g(`!!document.querySelector('.fp[data-id="talk"]')`))) await t.key('O');
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="talk"] .cs-stage')`), 3000, 'the window');
    const click = (path) => t.g(`(() => { const el = [...document.querySelectorAll('.fp[data-id="talk"] .talk-pick')].find((x) => x.dataset.flash === ${JSON.stringify(path)}); if (el) el.click(); return !!el; })()`);
    const cast = () => (t.state.talk ? t.state.talk.cast.map((c) => c.path) : []);
    try {
      t.ok(!(await t.g(`!!document.querySelector('.fp[data-id="talk"] .btn.primary')`)), 'no Start button: the first portrait starts it');
      t.ok(await click(list[0].path), 'the first portrait in the window');
      await t.until(() => cast().length === 1, 3000, 'it comes in');
      await click(list[0].path); await t.sleep(400);
      t.eq(cast(), [list[0].path], 'clicked again while speaking: it stays');
      await click(list[1].path);
      await t.until(() => cast().length === 2, 3000, 'the second comes in');
      t.eq(cast()[1], list[1].path, 'and speaks');
      // the small TV: a frame on each, as the TV lays them out
      await t.until(() => t.g(`document.querySelectorAll('.fp[data-id="talk"] .cs-frame').length === 2`), 3000, 'two frames on the small TV');
      await t.sleep(1800);
      const g = await t.g(`(() => { const st = document.querySelector('.fp[data-id="talk"] .cs-stage').getBoundingClientRect(); return [...document.querySelectorAll('.fp[data-id="talk"] .cs-frame')].map((f) => { const r = f.getBoundingClientRect(); return { p: f.dataset.path, x: (r.left - st.left) / st.width, w: r.width / st.width, h: r.height / st.height }; }); })()`);
      const tv = await t.t(`(() => [...document.querySelectorAll('.tv-talk .talk-layer.castl.near .talk-npc:not(.out)')].map((n) => { const r = n.getBoundingClientRect(); return { p: n.dataset.src, x: r.left / innerWidth, w: r.width / innerWidth, h: r.height / innerHeight }; }))()`);
      const near = (a, b) => Math.abs(a - b) < 0.03;
      const pairs = g.map((f, i) => [f, tv[i]]);
      t.ok(tv.length === 2 && pairs.every(([f, v]) => v && near(f.x, v.x) && near(f.w, v.w) && near(f.h, v.h)), 'each frame where its portrait stands on the TV', { g, tv });
      // a click on the one behind: it speaks
      await t.g(`(() => { const f = [...document.querySelectorAll('.fp[data-id="talk"] .cs-frame')].find((x) => x.dataset.path === ${JSON.stringify(list[0].path)}); const r = f.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1 };
        f.dispatchEvent(new PointerEvent('pointerdown', o)); f.dispatchEvent(new PointerEvent('pointerup', o)); })()`);
      await t.until(() => cast()[1] === list[0].path, 3000, 'the one clicked on the small TV to speak');
      // drag the speaker sideways: where they all stand
      const pos0 = (t.settings.talk || {}).pos;
      await t.g(`(() => { const f = [...document.querySelectorAll('.fp[data-id="talk"] .cs-frame')].find((x) => x.classList.contains('front')); const r = f.getBoundingClientRect(); const o = (dx) => ({ bubbles: true, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, button: 0, pointerId: 1 });
        f.dispatchEvent(new PointerEvent('pointerdown', o(0))); for (let k = 1; k <= 8; k++) f.dispatchEvent(new PointerEvent('pointermove', o(-k * 12))); f.dispatchEvent(new PointerEvent('pointerup', o(-96))); })()`);
      await t.until(() => (t.settings.talk || {}).pos < (pos0 == null ? 1 : pos0) - 0.05, 3000, 'dragged left: they stand further left');
      // ✕ on the picked one, then Delete
      await t.g(`document.querySelector('.fp[data-id="talk"] .cs-frame.picked .cs-x').click()`);
      await t.until(() => cast().length === 1, 3000, '✕ takes it out');
      await t.until(() => t.g(`document.querySelectorAll('.fp[data-id="talk"] .cs-frame').length === 1`), 3000, 'the small TV to follow');
      await t.g(`(() => { const st = document.querySelector('.fp[data-id="talk"] .cs-stage'); st.focus(); st.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); })()`);
      await t.until(() => cast().length === 0, 3000, 'Delete takes the last one out');
    } finally {
      await t.cmd('talk.off', {});
      await t.g(`window.ts.settings({ talk: { pos: 1 } })`);
    }
  });

  area.quick('Conversation ⚙: the speaker\'s name on the band for every look; a JPG portrait\'s top edge fades', async (t) => {
    const p = faces(t)[0];
    if (t.state.talk) await t.cmd('talk.off', {});
    if (!(await t.g(`!!document.querySelector('.fp[data-id="talk"]')`))) { t.gm().webContents.focus(); await t.key('O'); }
    await t.until(() => t.g(`!!document.querySelector('.fp[data-id="talk"] .cs-gear')`), 3000, 'the ⚙ in the title bar');
    await t.g(`document.querySelector('.fp[data-id="talk"] .cs-gear').click()`);
    t.ok(await t.g(`!document.querySelector('.fp[data-id="talk"] .cs-gear-box').hidden`), '⚙ opens the look settings');
    await t.g(`window.ts.settings({ talk: { names: true } })`);
    try {
      await t.cmd('talk.toggle', { path: p.path });
      const nm = await t.until(() => t.t(`(() => { const n = document.querySelector('.talk-layer.inkf.near .talk-speaker'); return n && !n.hidden && n.textContent; })()`), 5000, 'the name on the band');
      t.eq(nm, p.name.replace(/[_-]+/g, ' '), 'the speaker\'s name');
      const mask = await t.t(`(() => { const w = document.createElement('div'); w.className = 'talk-npc opaque'; const i = document.createElement('img'); w.append(i); document.body.append(w); const m = getComputedStyle(i).maskImage || getComputedStyle(i).webkitMaskImage; w.remove(); return m; })()`);
      t.ok(/linear-gradient/.test(mask) && /radial-gradient/.test(mask), 'a portrait without transparency: the oval and a fade at the top', mask);
    } finally {
      await t.cmd('talk.off', {});
      await t.g(`window.ts.settings({ talk: { names: false } })`);
      await t.g(`(() => { const b = document.querySelector('.fp[data-id="talk"] .cs-gear'); if (b && b.classList.contains('on')) b.click(); })()`);
    }
  });

  // Second Builder: a portrait's looks (Bloodied, Shaded, Hidden), drawn into its picture on the TV; they stack
  // (blood, then the shade, then the silhouette), and when Hidden goes off the old picture fades slowly over the new one
  const tvPixels = (t) => t.t(`(() => {
    const f = [...document.querySelectorAll('.tv-talk .talk-side.near ~ .talk-layer.castl.near .talk-npc:not(.out) img, .tv-talk .talk-layer.castl.near .talk-npc:not(.out) img')][0];
    if (!f || !f.naturalWidth) return null;
    const draw = (im) => { const c = document.createElement('canvas'); c.width = 120; c.height = Math.round(120 * im.naturalHeight / im.naturalWidth); const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height).data; };
    return new Promise((res) => { const o = new Image(); o.onerror = () => res(null); o.onload = () => {
      if (!f.naturalWidth || !f.naturalHeight || !o.naturalHeight) { res(null); return; } // (Second Builder, second-bloodied-darken: a picture swapping in)
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
  // Second Builder (second-bloodied-darken): Glinn's splats and hand-made spray, blended with Darken (blood never makes
  // the picture lighter, so no shine), coming in by stages: at 30 % only the upper third, from 70 % the spray below
  area.quick('Bloodied: blended with Darken (never lighter), by stages: the upper third first, the spray below from 70 %', async (t) => {
    const r = await t.t(`(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 600;
      const g = c.getContext('2d'); g.fillStyle = '#d8d2c8'; g.fillRect(40, 20, 220, 560); // (a light figure on transparency)
      const src = g.getImageData(0, 0, 300, 600).data;
      const measure = async (amount) => {
        const out = await PortraitFx.compose(c, { bloodOn: true, blood: amount }, { seed: 'stages' });
        const d = out.getContext('2d').getImageData(0, 0, 300, 600).data;
        let up = 0; let low = 0; let upN = 0; let lowN = 0; let lighter = 0;
        for (let y = 20; y < 580; y++) for (let x = 40; x < 260; x++) {
          const i = (y * 300 + x) * 4; const red = d[i] > d[i + 1] * 1.6 && d[i] > 60 ? 1 : 0;
          if (y < 20 + 560 / 3) { up += red; upN++; } else { low += red; lowN++; }
          if (d[i] > src[i] + 2 || d[i + 1] > src[i + 1] + 2 || d[i + 2] > src[i + 2] + 2) lighter++;
        }
        return { up: up / upN, low: low / lowN, lighter };
      };
      return { a30: await measure(0.3), a70: await measure(0.7), a100: await measure(1) };
    })()`);
    t.ok(r.a30.up > 0.03, 'at 30 % blood on the upper third', r.a30);
    t.ok(r.a30.low < r.a30.up * 0.35, 'at 30 % hardly any below (the spray comes later)', r.a30);
    t.ok(r.a70.low > r.a30.low + 0.03, 'at 70 % the spray over the lower two thirds', r.a70);
    t.ok(r.a100.up >= r.a70.up && r.a100.low >= r.a70.low * 0.95, 'at 100 % at least as much', r.a100);
    t.eq(r.a30.lighter + r.a70.lighter + r.a100.lighter, 0, 'no pixel lighter than the portrait (Darken: no shine)');
  });

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
      // (Second Builder, second-bloodied-darken: each look waits for its picture on the TV: swapping it in can take a moment)
      const seen = (ok, what) => t.until(async () => { const x = await tvPixels(t); return x && ok(x) ? x : null; }, 4000, what).catch(() => tvPixels(t));
      const b = await seen((x) => x.red1 > x.red0 + 0.04, 'the bloodied picture');
      t.ok(b && b.red1 > b.red0 + 0.04, 'clearly more blood red on the figure than in the portrait itself', b);
      await t.shot(t.tv(), 'looks-bloodied');
      await t.cmd('talk.fx', { path: p.path, shadeOn: true, shade: 0.6 });
      await t.until(async () => { const l = await looks(); return l && l.shade === 0.6 && !l.veil; }, 6000, 'shaded as well');
      const s = await seen((x) => x.top < 0.75, 'the shaded picture');
      t.ok(s && s.top < 0.75 && s.red1 > s.red0, 'the top of the head darker, the blood still there', s);
      await t.shot(t.tv(), 'looks-bloodied-shaded');
      await t.cmd('talk.fx', { path: p.path, hidden: true });
      await t.until(async () => { const l = await looks(); return l && l.hidden && !l.veil; }, 6000, 'hidden');
      const k = await seen((x) => x.most < 40, 'the silhouette');
      t.ok(k && k.most < 40, 'only a black silhouette: no light pixel left on the figure', k);
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
      if (!(await t.g(`!!document.querySelector('.fp[data-id="talk"]')`))) { t.gm().webContents.focus(); await t.key('O'); } // (Second Builder, second-conversation-stage: a window now)
      const sel = `.fp[data-id="talk"] .talk-pick[data-flash=${JSON.stringify(p.path)}]`;
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
