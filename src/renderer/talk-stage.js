// Second Builder (second-conversation-stage; drawn instead of photographed in second-conversation-rework): the small TV
// at the top of the Conversation window (toolbox.js builds the window around it). It draws what matters of the TV and
// nothing else: the map on the TV (blurred), the bands in their look and the portraits with their looks (Bloodied,
// Shaded, Hidden), still, without the animations, the weather or the effects. talk-layout.js lays them out exactly as
// the TV does. A frame on each portrait of the near side:
//   click a portrait            it speaks (steps to the front) and is picked
//   drag the speaker sideways   where they all stand (settings.talk.pos; partly off the TV is fine)
//   drag one up or down         its own nudge (talk.offset; never below its band); a portrait behind: sideways too
//   pull a top corner           its own size (talk.size, 30 to 400 %; past the top of the TV is fine)
//   ✕ on it, or Delete          it leaves (a click never takes anyone out)
// While dragging only this small TV changes, at once; on letting go one change goes to the TV, which glides there.
// The window's own bottom right corner sizes it: the small TV fills its width, the list of portraits below gets the
// rest of its height (the thumbnails keep their size).
// Beta 3.56 (Glinn): while a conversation runs the small TV has a green frame and End in its corner; the party's
// tokens sit on its bottom edge (toolbox.js); under them the picked portrait: Take out, Mirror, Hidden, and its looks
// as two small upright sliders (Blood in four notches, Shade up to 100 %). Ctrl + wheel on the small TV sizes the
// picked portrait (the TV gets it once the wheel rests).
'use strict';
window.TalkStage = (() => {
  const { h, iconEl, clamp, Thumbs } = UI;
  const KEY_W = 'talkWinW'; const KEY_H = 'talkStripH'; // (the window's width; the list's height, 0: as it comes)
  let width = 600; let stripH = 0;
  try { width = Number(localStorage.getItem(KEY_W)) || 600; stripH = Number(localStorage.getItem(KEY_H)) || 0; } catch {}
  let picked = null; // the picked portrait's path (else the speaker)
  const stages = new Set(); // { stage, draw } of the open ones
  const aspects = new Map(); // url → width / height (0 while loading)
  let sizeNow = null; // { v, t }: the ⚙ Size slider while it moves (the TV gets it once it rests)

  function aspectOf(url, done) {
    if (aspects.has(url)) return aspects.get(url);
    aspects.set(url, 0);
    const im = new Image();
    im.onload = () => { aspects.set(url, im.naturalWidth / Math.max(1, im.naturalHeight)); done(); };
    im.onerror = () => aspects.set(url, 0.8);
    im.src = url;
    return 0;
  }
  const live = () => { for (const s of [...stages]) if (!s.stage.isConnected) stages.delete(s); return [...stages]; };
  // (second-conversation-rework: the small TV no longer shows the TV's picture, so it asks for none)
  function preview() {}
  function wantWidth() { return 0; }
  // the window: as wide as it was left; the list of portraits as high
  const KEEP = { min: 380 };
  function applySize(fp) {
    if (!fp) return;
    fp.style.width = `${Math.round(clamp(width, KEEP.min, Math.max(KEEP.min, window.innerWidth - 120)))}px`;
    if (stripH) fp.style.setProperty('--cs-strip-h', `${Math.round(stripH)}px`); else fp.style.removeProperty('--cs-strip-h');
  }
  // its bottom right corner: wider and narrower, taller and shorter
  function corner(fp) {
    if (!fp || fp.querySelector(':scope > .cs-corner')) return;
    const grip = h('span', { class: 'cs-corner', 'data-tip': 'Drag: the window bigger or smaller', 'aria-hidden': 'true' }, iconEl('arrows-diagonal'));
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX; const y0 = e.clientY; const w0 = fp.getBoundingClientRect().width;
      const strip = fp.querySelector('.talk-strip'); const h0 = strip ? strip.getBoundingClientRect().height : 300;
      grip.setPointerCapture(e.pointerId);
      fp.classList.add('sizing');
      const move = (ev) => {
        width = clamp(w0 + (ev.clientX - x0), KEEP.min, Math.max(KEEP.min, window.innerWidth - 120));
        stripH = clamp(h0 + (ev.clientY - y0), 110, Math.max(110, window.innerHeight - 260));
        applySize(fp);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        fp.classList.remove('sizing');
        try { localStorage.setItem(KEY_W, String(Math.round(width))); localStorage.setItem(KEY_H, String(Math.round(stripH))); } catch {}
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    fp.append(grip);
  }

  // the band of each look, as high as on the TV (table-overlays.js drawInk)
  const BAND_H = { parchment: 0.1, city: 0.1, ink: 0.14, stone: 0.13, meadow: 0.22, winter: 0.17, sand: 0.15, dungeon: 0.12, necro: 0.16, forest: 0.24 };
  const LOOKS = ['ink', 'smoke', 'parchment', 'embers', 'stone', 'meadow', 'city', 'winter', 'sand', 'dungeon', 'necro', 'forest'];
  function bandSvg(look, W, hgt, seed) {
    try {
      if (look === 'ink') return TableOverlays.inkBand(W, hgt, seed, { sweep: 0.45, unit: 0.1, every: 95 });
      return (typeof Looks !== 'undefined' && Looks.talkBand(look, W, hgt, seed)) || '';
    } catch { return ''; }
  }

  // o: { S, cmd, toast, bind, bringIn (item), fx: { of (path), send (path, patch) } }
  function build(o) {
    const S = o.S;
    const world = () => (S().view && S().view.world) || { w: 16, h: 9 };
    const bg = h('div', { class: 'cs-bg' });
    // the TV's layers, as on the TV: both bands under all portraits, each side's copy of its band in front of its own
    // portraits' feet, the speaker's name on top; the far side's layers turned round
    const sides = ['near', 'far'].map((s) => {
      const layer = (k) => h('div', { class: `cs-layer cs-${k} ${s}` });
      const base = layer('base'); const cast = layer('cast'); const front = layer('front'); const name = layer('name');
      return { s, base, cast, front, name, plate: h('div', { class: 'cs-speaker' }), nodes: new Map(), bandKey: '' };
    });
    for (const sd of sides) sd.name.append(sd.plate);
    const scene = h('div', { class: 'cs-scene' }, ...sides.map((x) => x.base), ...sides.map((x) => x.cast), ...sides.map((x) => x.front), ...sides.map((x) => x.name));
    const frames = h('div', { class: 'cs-frames' });
    const hint = h('p', { class: 'cs-hint' }, 'Click a portrait below, or drag one here');
    const endBtn = h('button', { class: 'cs-end', 'data-tip': 'End the conversation', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); o.cmd('talk.off'); } }, iconEl('player-stop'), 'End');
    const stage = h('div', { class: 'cs-stage', tabindex: '0', 'aria-label': 'The conversation on the TV' }, bg, scene, frames, hint, endBtn);
    const me = { stage, draw: () => { redraw(); barSig = ''; drawBar(); } };
    stages.add(me);

    // what is being dragged, and what it shows until the TV has it (sent once, when let go)
    let act = null; let local = null;
    const talk = () => S().talk || null;
    const cast = () => (talk() ? talk().cast : []);
    const prefs = () => (S().settings && S().settings.talk) || { size: 0.34, pos: 1 };
    const seats = () => (S().settings && S().settings.seats === 'one' ? 'one' : 'both');
    const sizeOf = (path) => ((S().settings && S().settings.portraitSize) || {})[path] || 1;
    const offOf = (path) => ((S().settings && S().settings.portraitOffset) || {})[path] || null;
    const lookOf = () => { const l = (talk() && talk().look) || prefs().look; return LOOKS.includes(l) ? l : 'ink'; };

    function geometry() {
      const r = stage.getBoundingClientRect(); const W = r.width || 400; const H = r.height || (W * world().h) / world().w;
      const list = cast();
      const lv = local && (act || Date.now() - local.t < 1500) ? local : null;
      const size = sizeNow && Date.now() - sizeNow.t < 1500 ? sizeNow.v : prefs().size;
      const L = TalkLayout.compute({ W, H, size, pos: lv && lv.pos != null ? lv.pos : prefs().pos, anchor: prefs().anchor,
        items: list.map((c) => ({ aspect: aspectOf(c.url, redraw), scale: lv && lv.scale && lv.scale.path === c.path ? lv.scale.v : sizeOf(c.path), offset: lv && lv.off && lv.off.path === c.path ? lv.off.v : offOf(c.path) })) });
      return { W, H, list, L };
    }
    // the map on the TV, blurred behind everything
    let bgKey = '';
    function drawBg() {
      const id = S().table && S().table.liveMapId;
      let m = null;
      for (const ch of (S().campaign && S().campaign.chapters) || []) { m = (ch.maps || []).find((x) => x.id === id); if (m) break; }
      const key = m && m.bgPath ? `${m.bgPath}|${m.bgKind}` : '';
      if (key === bgKey) return;
      bgKey = key;
      bg.replaceChildren(...(m && m.bgPath ? [Thumbs.img(m.bgPath, m.bgKind || 'image', null, 'cs-bg-img')] : []));
    }
    // a portrait's picture with its looks (portrait-fx.js composes them, as on the TV)
    function setPicture(n, c) {
      const key = PortraitFx.keyOf(c.url, c.fx, !c.alpha);
      if (key === n.key) return;
      n.key = key;
      Promise.resolve(PortraitFx.url(c.url, c.fx, { opaque: !c.alpha, seed: c.path })).catch(() => c.url).then((src) => { if (n.key === key && n.img.getAttribute('src') !== src) n.img.src = src; });
    }
    const nodes = new Map(); // path → frame
    function redraw() {
      if (!stage.isConnected) return;
      const { W, H, list, L } = geometry();
      const on = list.length > 0;
      hint.hidden = on;
      stage.classList.toggle('empty', !on);
      stage.style.setProperty('--cs-h', `${H}px`);
      drawBg();
      if (picked && !list.some((c) => c.path === picked)) picked = null;
      const pick = picked || (on ? list[list.length - 1].path : null);
      // the scene: both sides (the far one only with players on both sides)
      const look = lookOf(); const hgt = Math.round(H * (BAND_H[look] || 0.2));
      const t = talk(); const seed = [...String((t && t.id) || 'k')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const both = seats() === 'both';
      const names = t ? !!t.names : !!prefs().names;
      const speaker = on ? list[list.length - 1] : null;
      const nm = speaker ? String(speaker.name || '').replace(/[_-]+/g, ' ') : '';
      const clip = TalkLayout.clips(L.spans, W);
      for (const sd of sides) {
        const shown = on && (sd.s === 'near' || both);
        for (const x of [sd.base, sd.cast, sd.front, sd.name]) x.hidden = !shown;
        if (!shown) continue;
        // (the looks are sized in vh, the TV's height: drawn as big as a TV as high as this screen, then shrunk to fit)
        const k = H / Math.max(1, window.innerHeight);
        const bandKey = `${look}|${Math.round(W)}x${hgt}|${seed}|${window.innerHeight}`;
        if (sd.bandKey !== bandKey) {
          sd.bandKey = bandKey;
          const bw = Math.round(W / k); const bh = Math.round(hgt / k);
          const svg = bandSvg(look, bw, bh, seed);
          for (const x of [sd.base, sd.front]) {
            x.innerHTML = `<div class="cs-band">${svg}</div>`;
            Object.assign(x.firstChild.style, { width: `${bw}px`, height: `${bh}px`, transform: `scale(${k})` });
            for (const g of x.querySelectorAll('svg')) { try { g.pauseAnimations(); } catch {} } // (still: no animations)
          }
        }
        sd.front.style.clipPath = clip.front;
        sd.base.style.clipPath = clip.base;
        // the portraits
        for (const [p, n] of sd.nodes) if (!list.some((c) => c.path === p)) { n.wrap.remove(); sd.nodes.delete(p); }
        list.forEach((c, i) => {
          let n = sd.nodes.get(c.path);
          if (!n) { n = { wrap: h('div', { class: 'cs-npc' }), img: h('img', { alt: '' }), key: null }; n.wrap.append(n.img); sd.cast.append(n.wrap); sd.nodes.set(c.path, n); }
          const b = L.items[i];
          Object.assign(n.wrap.style, { left: `${b.left}px`, width: `${b.width}px`, height: `${b.height}px`, bottom: `${H * 0.01}px`, translate: b.dx || b.dy ? `${b.dx}px ${b.dy}px` : '', zIndex: String(10 + i) });
          n.wrap.classList.toggle('back', !b.front);
          n.wrap.classList.toggle('opaque', !c.alpha);
          n.img.style.transform = c.mirror ? 'scaleX(-1)' : '';
          setPicture(n, c);
        });
        // the speaker's name: on the band (every look but the parchment, which has its own plate in the band)
        const fb = L.items[list.length - 1];
        const show = names && nm && look !== 'parchment';
        sd.plate.hidden = !show;
        if (show) { if (sd.plate.textContent !== nm) sd.plate.textContent = nm; sd.plate.style.left = `${fb.left + fb.dx + fb.width / 2}px`; sd.plate.style.bottom = `${hgt * 0.42}px`; sd.plate.style.fontSize = `${H * 0.034}px`; }
        for (const plate of [...sd.base.querySelectorAll('.tb-parch-name'), ...sd.front.querySelectorAll('.tb-parch-name')]) {
          if (plate.textContent !== nm) plate.textContent = nm;
          plate.style.left = `${fb.left + fb.width / 2}px`;
          plate.hidden = !nm;
        }
      }
      // the frames to grab (the near side)
      for (const [p, f] of nodes) if (!list.some((c) => c.path === p)) { f.remove(); nodes.delete(p); }
      list.forEach((c, i) => {
        let f = nodes.get(c.path);
        if (!f) {
          f = h('div', { class: 'cs-frame', dataset: { path: c.path } },
            h('span', { class: 'cs-h tl', dataset: { h: 'tl' } }), h('span', { class: 'cs-h tr', dataset: { h: 'tr' } }),
            h('button', { class: 'cs-x', 'aria-label': `Take ${c.name} out`, 'data-tip': 'Take out (Delete)', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); takeOut(c.path); } }, iconEl('x')),
            h('span', { class: 'cs-tag' }), h('span', { class: 'cs-size' }));
          f.addEventListener('pointerdown', (e) => down(e, c.path));
          nodes.set(c.path, f); frames.append(f);
        }
        const b = L.items[i];
        Object.assign(f.style, { left: `${b.left + b.dx}px`, bottom: `${H * 0.01 - b.dy}px`, width: `${b.width}px`, height: `${b.height}px`, zIndex: String(10 + i) });
        f.classList.toggle('front', b.front);
        f.classList.toggle('picked', c.path === pick);
        const tag = f.querySelector('.cs-tag');
        const tt = b.front ? `${c.name} · speaking` : c.name;
        if (tag.textContent !== tt) tag.textContent = tt;
        // while its size is pulled: how big, and where it was
        const sz = f.querySelector('.cs-size');
        const pulling = ((act && act.moved && act.hnd) || Date.now() - wheelAt < 900) && local && local.scale && local.scale.path === c.path;
        sz.hidden = !pulling;
        if (pulling) sz.textContent = `${Math.round(local.scale.v * 100)} %`;
        f.classList.toggle('pulling', !!pulling);
      });
      if (act && act.moved && act.ghost) {
        const g = act.ghost; Object.assign(g.style, { left: `${act.b.left + act.b.dx}px`, bottom: `${H * 0.01 - act.b.dy}px`, width: `${act.b.width}px`, height: `${act.b.height}px` });
        if (!g.isConnected) frames.append(g);
      }
    }
    function takeOut(path) { if (picked === path) picked = null; o.cmd('talk.toggle', { path, out: true }); }
    // Beta 3.56: Ctrl + wheel sizes the picked portrait (the speaker when none is picked) in steps of 5 %: this small TV
    // at once, the TV once the wheel rests
    let wheelAt = 0; let wheelT = 0;
    stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      const list = cast(); const p = picked && list.some((c) => c.path === picked) ? picked : list.length ? list[list.length - 1].path : null;
      if (!p) return;
      e.preventDefault(); e.stopPropagation();
      const cur = local && local.scale && local.scale.path === p && Date.now() - local.t < 1500 ? local.scale.v : sizeOf(p);
      const v = clamp(Math.round((cur + (e.deltaY < 0 ? 0.05 : -0.05)) * 20) / 20, 0.3, 4);
      local = { scale: { path: p, v }, t: Date.now() };
      wheelAt = Date.now();
      redraw();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => { if (local && local.scale && local.scale.path === p) local.t = Date.now(); o.cmd('talk.size', { path: p, scale: v }); setTimeout(redraw, 950); }, 300);
    }, { passive: false });
    // ---------- the pointer: only this small TV changes while dragging; the TV gets it when let go ----------
    function down(e, path) {
      if (e.button !== 0) return;
      e.preventDefault(); stage.focus({ preventScroll: true });
      const { W, list, L } = geometry();
      const i = list.findIndex((c) => c.path === path); if (i < 0) return;
      const b = L.items[i]; const hnd = e.target.dataset && e.target.dataset.h;
      act = { path, x0: e.clientX, y0: e.clientY, moved: false, axis: null, hnd, front: b.front, b, W, scale0: sizeOf(path), off0: offOf(path) || { x: 0, y: 0 }, ghost: h('div', { class: 'cs-ghost' }) };
      e.currentTarget.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - act.x0; const dy = ev.clientY - act.y0;
        if (!act.moved && Math.hypot(dx, dy) < 5) return;
        act.moved = true;
        if (act.hnd) { // a top corner: its size (pulling up makes it bigger)
          const v = clamp(Math.round(act.scale0 * ((act.b.height - dy) / act.b.height) * 20) / 20, 0.3, 4);
          local = { scale: { path, v }, t: Date.now() };
        } else {
          if (!act.axis) act.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          if (act.axis === 'x' && act.front) local = { pos: TalkLayout.posFor(act.W, act.b.left + dx, act.b.width), t: Date.now() }; // the speaker sideways: where they all stand
          else { // its own nudge (never below its band)
            const v = { x: act.axis === 'x' ? clamp(act.off0.x + dx / act.b.width, -1, 1) : act.off0.x, y: act.axis === 'y' ? clamp(act.off0.y - dy / act.b.height, 0, 0.8) : act.off0.y };
            v.x = Math.round(v.x * 100) / 100; v.y = Math.round(v.y * 100) / 100;
            local = { off: { path, v }, t: Date.now() };
          }
        }
        redraw();
      };
      const up = () => {
        const f = nodes.get(path); if (f) { f.removeEventListener('pointermove', move); f.removeEventListener('pointerup', up); f.removeEventListener('pointercancel', up); }
        const a = act; act = null;
        if (a && a.ghost) a.ghost.remove();
        if (a && !a.moved) { // a click: it speaks, and is picked
          picked = path;
          if (!a.front) o.cmd('talk.toggle', { path }); else me.draw();
        } else if (local) { // let go: the TV gets it now, once
          local.t = Date.now();
          if (local.scale) o.cmd('talk.size', { path: local.scale.path, scale: local.scale.v });
          else if (local.off) o.cmd('talk.offset', { path: local.off.path, x: local.off.v.x, y: local.off.v.y });
          else if (local.pos != null) ts.settings({ talk: { pos: Math.round(local.pos * 1000) / 1000 } });
        }
        redraw();
      };
      const f = nodes.get(path);
      f.addEventListener('pointermove', move); f.addEventListener('pointerup', up); f.addEventListener('pointercancel', up);
    }
    stage.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const list = cast(); const p = picked || (list.length ? list[list.length - 1].path : null);
      if (p) { e.preventDefault(); e.stopPropagation(); takeOut(p); }
    });
    // a portrait dragged here from a list comes in
    stage.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-ts-asset')) { e.preventDefault(); e.stopPropagation(); stage.classList.add('drop-ok'); } });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop-ok'));
    stage.addEventListener('drop', (e) => {
      stage.classList.remove('drop-ok');
      let a = null;
      try { a = JSON.parse(e.dataTransfer.getData('application/x-ts-asset') || 'null'); } catch {}
      if (!a || !a.path || (a.cat && a.cat !== 'portraits' && a.cat !== 'party')) return;
      e.preventDefault(); e.stopPropagation();
      o.bringIn(a);
    });

    // ---------- under the picture: the picked one (Beta 3.56: no count any more; the frame is green while it runs) ----------
    const bar = h('div', { class: 'cs-picked' });
    let barSig = '';
    // a small upright slider with its notches written beside it (the one set lit); ticksOf (k) → [[text, lit], …] top first
    function upright(label, cls, n, idx, ticksOf, set) {
      const input = h('input', { type: 'range', min: '0', max: String(n - 1), step: '1', value: String(idx), 'aria-label': label });
      const ticks = h('span', { class: 'cs-ticks' });
      const paint = (k) => ticks.replaceChildren(...ticksOf(k).map(([t, lit]) => h('span', { class: lit ? 'on' : '' }, t)));
      paint(idx);
      let tm = 0;
      input.addEventListener('input', () => { const k = Number(input.value); paint(k); clearTimeout(tm); tm = setTimeout(() => set(k), 60); });
      return h('div', { class: `cs-vs ${cls}` }, h('span', { class: 'cs-vs-l' }, label), h('div', { class: 'cs-vs-b' }, input, ticks));
    }
    function drawBar() {
      const list = cast();
      const on = list.length > 0;
      stage.classList.toggle('live', !!talk());
      endBtn.hidden = !talk();
      const path = picked && list.some((c) => c.path === picked) ? picked : on ? list[list.length - 1].path : null;
      const c = path ? list.find((x) => x.path === path) : null;
      const raw = c ? (o.fx.of(c.path) || {}) : {};
      const mirror = c && !!((S().settings && S().settings.portraitMirror) || {})[c.path];
      const moved = c && (Math.abs(sizeOf(c.path) - 1) > 0.001 || !!offOf(c.path));
      const sig = JSON.stringify([c && c.path, c && list[list.length - 1].path === c.path, raw, mirror, moved, c && sizeOf(c.path)]);
      if (sig === barSig) return;
      barSig = sig;
      bar.hidden = !c;
      if (!c) { bar.replaceChildren(); return; }
      const front = list[list.length - 1].path === c.path;
      const n = PortraitFx.norm(raw);
      const sz = sizeOf(c.path);
      // Blood: four notches (Clean, Light, Heavy, Soaked); Shade: 0 to 100 % in steps of 5 (the head black at the top)
      const blood = upright('Blood', 'cs-blood', 4, PortraitFx.bloodStep(raw), (k) => ['Soaked', 'Heavy', 'Light', 'Clean'].map((t, i) => [t, 3 - i === k]),
        (k) => { const v = PortraitFx.BLOOD_STEPS[k]; o.fx.send(c.path, { blood: v, bloodOn: v > 0 }); });
      const shade = upright('Shade', 'cs-shade', 21, Math.round(n.shade * 20), (k) => [['100 %', k === 20], [k > 0 && k < 20 ? `${k * 5} %` : '', true], ['0', k === 0]],
        (k) => o.fx.send(c.path, { shade: k / 20, shadeOn: k > 0 }));
      bar.replaceChildren(
        h('div', { class: 'cs-bar-l' },
          h('b', { class: 'ellipsis' }, c.name, front ? h('small', {}, ' speaking') : null, Math.abs(sz - 1) > 0.001 ? h('small', { class: 'cs-pct' }, ` ${Math.round(sz * 100)} %`) : null),
          h('div', { class: 'cs-row' },
            h('button', { class: 'btn small danger', onclick: () => takeOut(c.path) }, iconEl('x'), 'Take out'),
            h('button', { class: `btn small ${mirror ? 'on' : ''}`, 'data-tip': 'Mirror (face the other way)', onclick: () => o.cmd('talk.mirror', { path: c.path }) }, iconEl('flip-horizontal'), 'Mirror'),
            moved ? h('button', { class: 'icon-btn', 'aria-label': 'Back to 100 %, in its place', 'data-tip': 'Back to 100 %, in its place', onclick: () => { o.cmd('talk.size', { path: c.path, scale: 1 }); o.cmd('talk.offset', { path: c.path, x: 0, y: 0 }); } }, iconEl('arrow-back-up')) : null),
          h('div', { class: 'cs-row' },
            h('button', { class: `cs-look ${raw.hidden ? 'on' : ''}`, 'aria-pressed': String(!!raw.hidden), 'data-tip': 'Hidden: a black figure; off, it fades in', onclick: () => o.fx.send(c.path, { hidden: !raw.hidden }) }, iconEl('eye-off'), 'Hidden'))),
        h('div', { class: 'cs-bar-r' }, blood, shade));
    }
    o.bind(() => { redraw(); drawBar(); });
    let rT = 0;
    if (window.ResizeObserver) new ResizeObserver(() => { if (!rT) rT = requestAnimationFrame(() => { rT = 0; redraw(); }); }).observe(stage);
    requestAnimationFrame(() => { const fp = stage.closest('.fp'); applySize(fp); corner(fp); redraw(); });
    return h('div', { class: 'cs stack' }, stage, o.party || null, bar); // (Beta 3.56: the party's tokens on the small TV's edge)
  }
  const pick = (path) => { picked = path || null; };
  // draw the open ones again (a portrait picked from the list below)
  const refresh = () => { for (const s of live()) s.draw(); };
  // the ⚙ Size slider: this small TV follows at once, the TV once the slider rests (toolbox.js sends it)
  const size = (v) => { sizeNow = { v, t: Date.now() }; for (const s of live()) s.draw(); };
  const shownSize = () => (sizeNow && Date.now() - sizeNow.t < 1500 ? sizeNow.v : null);
  return { build, preview, wantWidth, pick, refresh, size, shownSize, picked: () => picked, KEY_W };
})();
