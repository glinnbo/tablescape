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

  // Second Builder (second-conversation-stage; second-conversation-rework, Glinn 21 Nov 2026): portraits may be as tall
  // as wanted, over the far band and the far side's copies, also in the middle; their feet stay in their band
  area.quick('both sides: a tall portrait reaches over the far band (in front of it), in the middle too; never below its band', async (t) => {
    const p = faces(t)[0];
    t.eq(t.settings.seats || 'both', 'both', 'players on both sides');
    if (t.state.talk) await t.cmd('talk.off', {});
    await t.cmd('talk.size', { path: p.path, scale: 2 });
    await t.g(`window.ts.settings({ talk: { size: 0.46, pos: 1 } })`);
    const look = () => t.t(`(() => { const n = [...document.querySelectorAll('.tv-talk .talk-npc:not(.out)')]; const z = (sel) => +getComputedStyle(document.querySelector(sel)).zIndex;
      const fr = document.querySelector('.talk-layer.inkf.near .talk-ink-front'); const base = document.querySelector('.talk-layer.inkl.near .talk-ink');
      return { n: n.length, far: n.filter((x) => x.closest('.far')).length, hs: n.map((x) => x.getBoundingClientRect().height), bottoms: n.filter((x) => !x.closest('.far')).map((x) => x.getBoundingClientRect().bottom), H: innerHeight, cast: z('.talk-layer.castl.far'), ink: z('.talk-layer.inkl.near'), front: z('.talk-layer.inkf.near'),
        clipFront: fr ? fr.style.clipPath : '', clipBase: base ? base.style.clipPath : '' }; })()`);
    try {
      await t.cmd('talk.toggle', { path: p.path });
      const r = await t.until(async () => { const x = await look(); return x.n === 2 && x.hs.every((hh) => hh > 50) && x; }, 5000, 'the portrait on both sides');
      t.eq(r.far, 1, 'one copy for the far side');
      t.ok(r.hs.every((hh) => hh > r.H * 0.87) && Math.abs(r.hs[0] - r.hs[1]) < 2, 'standing at the side: taller than the room between the bands, both the same', r);
      t.ok(r.cast > r.ink && r.front > r.cast, 'the portraits over the bands; each band\'s own copy over its own portraits\' feet', r);
      t.ok(/polygon/.test(r.clipFront) && /polygon/.test(r.clipBase), 'the band cut in two: in front where the portraits stand, behind elsewhere', r);
      await t.g(`window.ts.settings({ talk: { pos: 0.5 } })`);
      await t.sleep(900); // (it glides there)
      const m = await look();
      t.ok(m.hs.every((hh) => hh > m.H * 0.87), 'in the middle too: as tall (the near and the far copy may cover each other)', m);
      // never below its band: a nudge down is kept at 0
      const o = await t.cmd('talk.offset', { path: p.path, x: 0, y: -0.3 });
      t.eq(o.y, 0, 'a nudge down is not kept');
      await t.cmd('talk.size', { path: p.path, scale: 4.5 });
      t.eq(t.settings.portraitSize[p.path], 4, 'up to 400 %');
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.size', { path: p.path, scale: 1 });
      await t.cmd('talk.offset', { path: p.path, x: 0, y: 0 });
      await t.g(`window.ts.settings({ talk: { size: 0.34, pos: 1 } })`);
    }
  });

  area.quick('five portraits stand there at most: a sixth sends the oldest out', async (t) => {
    if (t.state.talk) await t.cmd('talk.off', {});
    const pics = [...faces(t), ...['tokens', 'maps', 'assets'].flatMap((c) => t.lib(c).filter((x) => x.kind === 'image'))].slice(0, 6); // (the demo has two portraits: other pictures of the library stand in)
    t.eq(pics.length, 6, 'six pictures to bring in');
    try {
      for (const x of pics) await t.cmd('talk.toggle', { path: x.path });
      t.eq(t.state.talk.cast.map((c) => c.path), pics.slice(1).map((x) => x.path), 'the five newest; the first one stepped out');
    } finally { await t.cmd('talk.off', {}); }
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
      // (Second Builder (second-conversation-rework)) the small TV is drawn: the map blurred, the bands, the portraits
      // (near and far); it asks for no picture of the TV
      const drawn = await t.g(`(() => { const st = document.querySelector('.fp[data-id="talk"] .cs-stage'); return { tv: st.querySelectorAll('img.cs-tv').length, bg: st.querySelectorAll('.cs-bg-img').length, bands: st.querySelectorAll('.cs-layer:not([hidden]) .cs-band').length, npcs: st.querySelectorAll('.cs-layer:not([hidden]) .cs-npc').length, want: TalkStage.wantWidth() }; })()`);
      t.eq(drawn, { tv: 0, bg: 1, bands: 4, npcs: 4, want: 0 }, 'drawn: the map, both sides\' bands (each in two parts) and portraits; no picture of the TV asked for');
      // drag the speaker sideways: the small TV follows at once, the TV only when let go
      const pos0 = (t.settings.talk || {}).pos;
      const frontLeft = () => t.g(`document.querySelector('.fp[data-id="talk"] .cs-frame.front').getBoundingClientRect().left`);
      const l0 = await frontLeft();
      await t.g(`(() => { const f = [...document.querySelectorAll('.fp[data-id="talk"] .cs-frame')].find((x) => x.classList.contains('front')); const r = f.getBoundingClientRect(); window.__o = (dx) => ({ bubbles: true, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, button: 0, pointerId: 1 }); window.__f = f;
        f.dispatchEvent(new PointerEvent('pointerdown', __o(0))); for (let k = 1; k <= 8; k++) f.dispatchEvent(new PointerEvent('pointermove', __o(-k * 12))); })()`);
      await t.sleep(400);
      t.ok((await frontLeft()) < l0 - 40, 'while dragging: the small TV follows');
      t.eq((t.settings.talk || {}).pos, pos0, 'and the TV not yet');
      await t.g(`__f.dispatchEvent(new PointerEvent('pointerup', __o(-96)))`);
      await t.until(() => (t.settings.talk || {}).pos < (pos0 == null ? 1 : pos0) - 0.05, 3000, 'let go: the TV has it, they stand further left');
      // a top corner: the size, the same way
      const sz0 = ((t.settings.portraitSize || {})[cast()[1]]) || 1;
      await t.g(`(() => { const hd = document.querySelector('.fp[data-id="talk"] .cs-frame.front .cs-h.tr'); const f = hd.closest('.cs-frame'); const r = hd.getBoundingClientRect(); window.__o = (dy) => ({ bubbles: true, clientX: r.left + 4, clientY: r.top + 4 + dy, button: 0, pointerId: 1 }); window.__f = f;
        hd.dispatchEvent(new PointerEvent('pointerdown', __o(0))); for (let k = 1; k <= 6; k++) f.dispatchEvent(new PointerEvent('pointermove', __o(-k * 8))); })()`);
      await t.sleep(300);
      t.ok(/%/.test(await t.g(`(document.querySelector('.fp[data-id="talk"] .cs-frame.front .cs-size:not([hidden])') || {}).textContent || ''`)), 'while pulling: how big it gets');
      t.eq(((t.settings.portraitSize || {})[cast()[1]]) || 1, sz0, 'the TV not yet');
      await t.g(`__f.dispatchEvent(new PointerEvent('pointerup', __o(-48)))`);
      await t.until(() => (((t.settings.portraitSize || {})[cast()[1]]) || 1) > sz0 + 0.1, 3000, 'let go: bigger on the TV');
      await t.cmd('talk.size', { path: cast()[1], scale: 1 });
      // the window's own corner: the small TV grows with it, the thumbnails keep their size
      const box = () => t.g(`(() => { const fp = document.querySelector('.fp[data-id="talk"]'); return { w: fp.getBoundingClientRect().width, st: fp.querySelector('.cs-stage').getBoundingClientRect().width, th: fp.querySelector('.talk-pick').getBoundingClientRect().width }; })()`);
      const b0 = await box();
      const cr = await t.rect('.fp[data-id="talk"] .cs-corner');
      await t.drag({ x: cr.cx, y: cr.cy }, { x: cr.cx - 80, y: cr.cy });
      const b1 = await box();
      t.ok(Math.abs(b1.w - (b0.w - 80)) < 4 && Math.abs(b1.st - (b0.st - 80)) < 4, 'the window and the small TV narrower by as much', { b0, b1 });
      t.eq(Math.round(b1.th), Math.round(b0.th), 'the thumbnails the same size');
      await t.drag({ x: cr.cx - 80, y: cr.cy }, { x: cr.cx, y: cr.cy });
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

  // Second Builder (second-conversation-rework): no right-click popup; on a thumbnail, the eye brings a portrait in
  // Hidden (the TV never shows it uncovered), and one on the TV shows a big ✕ that takes it off
  area.quick('thumbnails: the eye brings a portrait in Hidden, the big ✕ takes it off; no right-click popup', async (t) => {
    const p = faces(t)[0];
    if (t.state.talk) await t.cmd('talk.off', {});
    try {
      if (!(await t.g(`!!document.querySelector('.fp[data-id="talk"]')`))) { t.gm().webContents.focus(); await t.key('O'); }
      const sel = `.fp[data-id="talk"] .talk-pick[data-flash=${JSON.stringify(p.path)}]`;
      await t.until(() => t.count(`${sel} .talk-hidden-in`), 4000, 'the portrait with its eye');
      await t.rightClickSel(sel);
      await t.sleep(300);
      t.eq(await t.count('.talk-sizepop'), 0, 'a right-click opens nothing');
      t.eq(await t.count(`${sel} .talk-off`), 0, 'not on the TV: no ✕');
      await t.g(`document.querySelector(${JSON.stringify(`${sel} .talk-hidden-in`)}).click()`);
      await t.until(() => t.state.talk && t.state.talk.cast.some((c) => c.path === p.path), 3000, 'it comes in');
      t.eq((t.settings.portraitFx[p.path] || {}).hidden, true, 'Hidden');
      await t.until(async () => { const x = await talk(t); return x && x.looks && x.looks[0] && x.looks[0].hidden; }, 6000, 'hidden on the TV');
      await t.until(() => t.count(`${sel} .talk-off`), 3000, 'on the TV: its ✕');
      t.eq(await t.count(`${sel} .talk-hidden-in`), 0, 'and no eye');
      let k = 0; // (the list is drawn again as the TV answers: hover once more until it stays)
      const x = await t.until(async () => { const th = await t.rect(sel); await t.mouse('mouseMove', th.cx + (k++ % 2), th.cy); await t.sleep(200);
        const v = await t.g(`(() => { const b = document.querySelector(${JSON.stringify(`${sel} .talk-off`)}); const r = b.getBoundingClientRect(); return { op: +getComputedStyle(b).opacity, w: r.width }; })()`); return v.op > 0.9 && v; }, 4000, 'the ✕ on hover').catch(() => ({ op: 0, w: 0 }));
      t.ok(x.op > 0.9 && x.w >= 30, 'hovered: a big ✕', x);
      await t.shot(t.gm(), 'thumb-take-off');
      await t.g(`document.querySelector(${JSON.stringify(`${sel} .talk-off`)}).click()`);
      await t.until(() => !t.state.talk || !t.state.talk.cast.some((c) => c.path === p.path), 3000, 'the ✕ takes it off');
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.fx', { path: p.path, reset: true });
    }
  });

  // Beta 3.56 (Glinn): the small TV green while it runs, End in its corner, no count; the party's tokens on its edge
  area.quick('Beta 3.56: green while it runs, End in its corner, no count; the party\'s tokens on the small TV\'s edge bring in their cut-out (greyed without one)', async (t) => {
    const p = faces(t)[0];
    const party0 = [...((t.store.cur && t.store.cur.meta.party) || [])];
    if (t.state.talk) await t.cmd('talk.off', {});
    t.handle('party.set', { names: ['Mira', 'Thorin'] });
    t.handle('char.set', { name: 'Mira', patch: { token: t.pic('tokens', /Hero/i), sprite: p.path, color: '#6cc3ff' } });
    t.handle('char.set', { name: 'Thorin', patch: { token: t.pic('tokens', /Goblin/i), color: '#ffb35c' } });
    const W = '.fp[data-id="talk"]';
    try {
      if (!(await t.g(`!!document.querySelector('${W}')`))) { t.gm().webContents.focus(); await t.key('O'); }
      await t.until(() => t.count(`${W} .cs-pc`).then((n) => n === 2), 4000, 'the party\'s two tokens');
      const look = () => t.g(`(() => { const w = document.querySelector('${W}'); const st = w.querySelector('.cs-stage'); const end = w.querySelector('.cs-end'); const pcs = [...w.querySelectorAll('.cs-pc')];
        const sr = st.getBoundingClientRect(); const pr = pcs[0].getBoundingClientRect();
        return { live: st.classList.contains('live'), end: !!end && !end.hidden, status: w.querySelectorAll('.cs-status, .cs-count, .cs-dot').length, on: pcs.map((x) => [x.dataset.name, [...x.classList].join(' ')]), onEdge: pr.top < sr.bottom && pr.bottom > sr.bottom }; })()`);
      let v = await look();
      t.ok(!v.live && !v.end && v.status === 0, 'no conversation: no green, no End, no count', v);
      t.ok(v.onEdge, 'the tokens sit on the small TV\'s bottom edge', v);
      t.ok(/\boff\b/.test(v.on.find((x) => x[0] === 'Thorin')[1]) && !/\boff\b/.test(v.on.find((x) => x[0] === 'Mira')[1]), 'Thorin greyed (no cut-out), Mira not', v.on);
      await t.clickSel(`${W} .cs-pc[data-name="Mira"]`);
      await t.until(() => t.state.talk && t.state.talk.cast.some((c) => c.path === p.path), 3000, 'Mira\'s cut-out comes in');
      await t.until(async () => { v = await look(); return v.live && v.end; }, 3000, 'green, with End');
      await t.until(async () => /\bspeak\b/.test((await look()).on.find((x) => x[0] === 'Mira')[1]), 3000, 'her token lit: speaking');
      await t.clickSel(`${W} .cs-pc[data-name="Thorin"]`); await t.sleep(300);
      t.eq(t.state.talk.cast.length, 1, 'Thorin without a cut-out brings in nothing');
      await t.clickSel(`${W} .cs-end`);
      await t.until(() => !t.state.talk, 3000, 'End ends it');
      await t.until(async () => !(await look()).live, 3000, 'no longer green');
    } finally {
      if (t.state.talk) await t.cmd('talk.off', {});
      t.handle('party.set', { names: party0 });
    }
  });

  // Second Builder (second-conversation-sliders): four smooth upright sliders (Height, Size, Blood, Shade), no words
  // beside them; while one moves only the small TV follows (the bar is not drawn anew under your hand), let go: the TV
  area.quick('the bar: Height, Size, Blood and Shade as smooth upright sliders without words; the TV gets each when let go; Ctrl + wheel sizes too', async (t) => {
    const p = faces(t)[0];
    const W = '.fp[data-id="talk"]';
    if (t.state.talk) await t.cmd('talk.off', {});
    try {
      if (!(await t.g(`!!document.querySelector('${W}')`))) { t.gm().webContents.focus(); await t.key('O'); }
      await t.cmd('talk.toggle', { path: p.path });
      await t.until(() => t.count(`${W} .cs-blood input`).then((n) => n === 1), 4000, 'the bar with its sliders');
      const fx = () => (t.settings.portraitFx || {})[p.path] || {};
      t.eq(await t.g(`[...document.querySelectorAll('${W} .cs-picked .cs-vs-l')].map((x) => x.textContent)`), ['Height', 'Size', 'Blood', 'Shade'], 'four sliders, in this order');
      t.eq(await t.g(`[...document.querySelectorAll('${W} .cs-picked input[type=range]')].map((i) => [i.min, i.max, i.step])`), [['0', '1000', '1'], ['0', '1000', '1'], ['0', '1000', '1'], ['0', '1000', '1']], 'smooth: a thousand steps each');
      const words = await t.g(`document.querySelector('${W} .cs-picked').textContent`);
      t.ok(!/%|Soaked|Heavy|Light|Clean/.test(words) && !(await t.count(`${W} .cs-ticks`)), 'no notch names, no percent', words);
      // while it moves: the same slider stays in the hand, the TV waits; let go: the TV has it
      const move = (cls, v) => t.g(`(() => { const i = document.querySelector('${W} ${cls} input'); window.__in = i; i.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); i.value = ${v}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      const letGo = (cls) => t.g(`(() => { const i = document.querySelector('${W} ${cls} input'); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
      const same = (cls) => t.g(`document.querySelector('${W} ${cls} input') === window.__in`);
      await move('.cs-blood', 650);
      await t.sleep(500);
      t.ok(!fx().bloodOn, 'Blood moving: the TV not yet');
      t.ok(await same('.cs-blood'), 'and the slider is still the one in the hand');
      const red = await t.until(() => t.g(`(() => { const cv = document.querySelector('${W} .cs-layer.cs-cast.near .cs-npc canvas'); if (!cv || cv.classList.contains('blank')) return 0; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let k = 0; k < d.length; k += 16) if (d[k + 3] > 200 && d[k] > 1.7 * d[k + 1] && d[k] > 1.7 * d[k + 2] && d[k] > 60) n++; return n; })()`), 4000, 'the blood on the small TV');
      t.ok(red > 10, 'the small TV shows the blood already', red);
      await letGo('.cs-blood');
      await t.until(() => fx().blood === 0.65 && fx().bloodOn === true, 3000, 'let go: 65 % on the TV');
      await move('.cs-shade', 1000); await letGo('.cs-shade');
      await t.until(() => fx().shade === 1 && fx().shadeOn === true, 3000, 'Shade 100 %');
      // at 100 % the head is black: the top of the figure has no light left
      const top = await t.g(`(async () => { const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = ${JSON.stringify(p.url)}; });
        const c = await PortraitFx.compose(im, { shadeOn: true, shade: 1 }, {}); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data;
        let y0 = -1; for (let y = 0; y < c.height && y0 < 0; y++) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 200) { y0 = y; break; }
        let max = 0; const y1 = y0 + Math.round(c.height * 0.12); for (let y = y0; y < y1; y++) for (let x = 0; x < c.width; x++) { const k = (y * c.width + x) * 4; if (d[k + 3] > 200) max = Math.max(max, d[k], d[k + 1], d[k + 2]); } return max; })()`);
      t.ok(top <= 6, 'the head black at 100 %', top);
      // Height: raised half way (40 %); Size: 200 % (finer near 100 %)
      const frameBottom = () => t.g(`document.querySelector('${W} .cs-frame').getBoundingClientRect().bottom`);
      const b0 = await frameBottom();
      await move('.cs-height', 500);
      await t.sleep(300);
      t.ok((await frameBottom()) < b0 - 10, 'Height moving: the small TV raises it');
      t.ok(!((t.settings.portraitOffset || {})[p.path]), 'the TV not yet');
      await letGo('.cs-height');
      await t.until(() => ((t.settings.portraitOffset || {})[p.path] || {}).y === 0.4, 3000, 'let go: raised 40 % on the TV');
      const u2 = Math.round((Math.log(2 / 0.3) / Math.log(4 / 0.3)) * 1000);
      await move('.cs-size-s', u2);
      await t.until(async () => /200 %/.test(await t.g(`(document.querySelector('${W} .cs-frame .cs-size:not([hidden])') || {}).textContent || ''`)), 2000, '200 % shown on the small TV');
      t.eq(((t.settings.portraitSize || {})[p.path]) || 1, 1, 'the TV not yet');
      await letGo('.cs-size-s');
      await t.until(() => Math.abs(((t.settings.portraitSize || {})[p.path] || 1) - 2) < 0.011, 3000, 'let go: 200 % on the TV');
      await t.cmd('talk.size', { path: p.path, scale: 1 });
      await t.cmd('talk.offset', { path: p.path, x: 0, y: 0 });
      await t.clickText(`${W} .cs-picked .cs-look`, 'Hidden');
      await t.until(() => fx().hidden === true, 3000, 'Hidden');
      // Ctrl + wheel: the small TV at once, the TV once the wheel rests; the Size slider follows
      await t.sleep(1700);
      const sz0 = ((t.settings.portraitSize || {})[p.path]) || 1;
      await t.g(`(() => { const st = document.querySelector('${W} .cs-stage'); const r = st.getBoundingClientRect(); for (let k = 0; k < 3; k++) st.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`);
      await t.until(async () => /115 %/.test(await t.g(`(document.querySelector('${W} .cs-frame .cs-size:not([hidden])') || {}).textContent || ''`)), 2000, 'the size shown on the small TV');
      t.eq(((t.settings.portraitSize || {})[p.path]) || 1, sz0, 'the TV not yet');
      await t.until(() => Math.abs((((t.settings.portraitSize || {})[p.path]) || 1) - (sz0 + 0.15)) < 0.001, 3000, 'once it rests: 115 % on the TV');
      const uWant = Math.round((Math.log(1.15 / 0.3) / Math.log(4 / 0.3)) * 1000);
      await t.until(async () => Math.abs(Number(await t.g(`document.querySelector('${W} .cs-size-s input').value`)) - uWant) <= 2, 3000, 'the Size slider follows');
    } finally {
      await t.cmd('talk.off', {});
      await t.cmd('talk.fx', { path: p.path, reset: true });
      await t.cmd('talk.size', { path: p.path, scale: 1 });
      await t.cmd('talk.offset', { path: p.path, x: 0, y: 0 });
    }
  });

  area.quick('Library is as tall as the chips beside it, also when they take several lines', async (t) => {
    const W = '.fp[data-id="talk"]';
    if (!(await t.g(`!!document.querySelector('${W}')`))) { t.gm().webContents.focus(); await t.key('O'); }
    await t.until(() => t.count(`${W} .cs-chip`).then((n) => n >= 1), 4000, 'the chips');
    const m = () => t.g(`(() => { const l = document.querySelector('${W} .cs-chips .cs-lib').getBoundingClientRect(); const c = document.querySelector('${W} .cs-chip-list').getBoundingClientRect(); return { lib: [Math.round(l.top), Math.round(l.bottom)], chips: [Math.round(c.top), Math.round(c.bottom)], right: Math.round(l.right), box: Math.round(document.querySelector('${W} .cs-chips').getBoundingClientRect().right) }; })()`);
    const one = await m();
    t.eq(one.lib, one.chips, 'one line of chips: as tall', one);
    t.ok(Math.abs(one.right - one.box) <= 1, 'on the right', one);
    // (folders as chips: many of them wrap onto more lines)
    await t.g(`(() => { const l = document.querySelector('${W} .cs-chip-list'); for (let k = 0; k < 14; k++) { const b = document.createElement('button'); b.className = 'cs-chip probe'; b.textContent = 'Folder ' + k; l.append(b); } return true; })()`);
    const many = await m();
    t.ok(many.chips[1] - many.chips[0] > 50, 'the chips take several lines', many);
    t.eq(many.lib, many.chips, 'Library as tall as all of them', many);
    await t.g(`document.querySelectorAll('${W} .cs-chip.probe').forEach((b) => b.remove())`);
  });

  area.quick('Beta 3.56: chips and Library over one row of portraits that does not wrap', async (t) => {
    const W = '.fp[data-id="talk"]';
    if (!(await t.g(`!!document.querySelector('${W}')`))) { t.gm().webContents.focus(); await t.key('O'); }
    await t.until(() => t.count(`${W} .cs-chip`).then((n) => n >= 1), 4000, 'the chips');
    const v = await t.g(`(() => { const w = document.querySelector('${W}'); const row = w.querySelector('.cs-one'); const cs = getComputedStyle(row);
      return { chips: [...w.querySelectorAll('.cs-chip')].map((x) => x.textContent), on: (w.querySelector('.cs-chip.on') || {}).textContent, lib: !!w.querySelector('.cs-chips .cs-lib'), wrap: cs.flexWrap, ox: cs.overflowX,
        tops: [...row.querySelectorAll('.talk-pick')].map((x) => Math.round(x.getBoundingClientRect().top)), list: w.querySelectorAll('.btn.wide').length }; })()`);
    t.ok(v.chips.includes('All') && v.on && v.lib && v.list === 0, 'chips, one of them on, Library beside them; no List … under the row', v);
    t.ok(v.wrap === 'nowrap' && v.ox === 'auto' && new Set(v.tops).size <= 1, 'one row that scrolls sideways', v);
    await t.clickSel(`${W} .cs-lib`);
    await t.until(() => t.count('.fp[data-id="talklist"]').then((n) => n === 1), 3000, 'Library: all portraits in a window');
    await t.clickSel(`${W} .cs-lib`);
    await t.until(() => t.count('.fp[data-id="talklist"]').then((n) => n === 0), 3000, 'and closed again');
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
