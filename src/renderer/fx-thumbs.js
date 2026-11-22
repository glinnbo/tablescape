// Beta 3.60: small pictures of the effects, drawn once by the effects' own code (fx.js) over a stone floor, for the
// tiles and the banner of Effects → Elements. A picture is made when it is first asked for and kept while the app runs.
// Only on the GM screen.
'use strict';
const FxThumbs = (() => {
  const cache = new Map(); // key → Promise<data url | null>
  const floors = {};
  const ground = (file = 'old_cobblestone-small.webp') => {
    if (!floors[file]) floors[file] = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = new URL(`tiles/${file}`, document.baseURI).href; });
    return floors[file];
  };
  // Second Builder (second-water-works): effects that belong on water are shown on water
  const FLOOR = { 'region|rapids': 'clear_water-small.webp', 'region|bubbling': 'old_cobblestone-small.webp', 'emitter|whirl': 'deep_water-small.webp', 'emitter|geyser': 'old_cobblestone-small.webp', 'emitter|circling': 'meadow-small.webp', 'emitter|insects': 'meadow-small.webp', 'region|fish': 'clear_water-small.webp', 'region|dapple': 'tall_grass-small.webp', 'region|drift': 'dune_sand-small.webp', 'emitter|devil': 'desert_sand-small.webp', 'region|critters': 'old_cobblestone-small.webp', 'emitter|bats': 'old_cobblestone-small.webp',
    'region|water': 'clear_water-small.webp', 'region|ember': 'lava_flow-small.webp', 'region|shimmer': 'glowing_cave-small.webp', 'region|pulse': 'lava_runes-small.webp', 'region|ripple': 'glowing_blue-small.webp' }; // (Beta 3.65: what moves the map's own picture is shown on a picture that has it) // (second-birds: and animals on grass)
  // what makes a faint effect read at this size: [size or strength, strength or amount, amount or colour]
  const E_CELL = { insects: 3.2, bats: 1.8 }; // (second-bats-insects)
  const E_BOOST = { circling: [0.55, 1, 1], bats: [0.9, 1, 1], insects: [0.75, 1, 1], smoke: [1.6, 2.2, 1.5], steam: [1.3, 1.6, 1.3], fireflies: [0.7, 2, 3], sparkles: [1, 1.6, 2], glow: [1.2, 1.5, 1], vent: [1.2, 1.4, 1.4] };
  const R_BOOST = { bubbling: [1.5, 1.4, null], dust: [2, 3, '#e8d9b0'], grass: [2, 1, '#8fbf4a'], lava: [1.5, 2, null], swamp: [1.6, 2, null], mist: [1.2, 1, null] };
  // draw one effect on g (w × h dots, ppi dots a square) at time t; look: { color, variant }
  // (Beta 3.64: look.play: seconds the playing picture has run; an effect that only shows now and then (a geyser, a
  // dust devil, a stream of bats) plays that moment over and over)
  function draw(g, w, h, ppi, kind, id, t, look = {}, bg = null) {
    FX.scratchSet('thumb'); // (canvases of its own: the map's layers keep theirs at their size)
    try { drawOn(g, w, h, ppi, kind, id, t, look, bg); } finally { FX.scratchSet(''); }
  }
  // Beta 3.65: Ember glow, Shimmer, Pulse and Ripple are drawn by the engine (living.js) from the map picture. Their
  // small pictures imitate that here: the floor's own picture added to itself where the effect is, in its rhythm
  const LIGHTS = { ember: 1, shimmer: 1, pulse: 1, ripple: 1 };
  const tmp = {};
  const plane = (n, w, h) => { let c = tmp[n]; if (!c) { c = document.createElement('canvas'); tmp[n] = c; } if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, w, h); return { c, g }; };
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  function mapLight(g, w, h, ppi, id, t, bg) {
    if (!bg) return;
    const W = w / ppi; const H = h / ppi;
    // where it is: the wavy band the painted effects' pictures use, its edge soft
    const A = plane('a', w, h);
    A.g.filter = `blur(${Math.max(1, ppi * 0.12).toFixed(1)}px)`; A.g.setTransform(ppi, 0, 0, ppi, 0, 0);
    A.g.strokeStyle = '#fff'; A.g.lineCap = 'round'; A.g.lineJoin = 'round'; A.g.lineWidth = 2 * Math.min(1.25, H * 0.3);
    A.g.beginPath(); const n = Math.max(10, Math.round(W * 2)); for (let i = 0; i <= n; i++) { const x = 0.9 + (W - 1.8) * (i / n); const y = H / 2 + Math.sin(i * 0.9 * (10 / n)) * 0.35; if (i) A.g.lineTo(x, y); else A.g.moveTo(x, y); } A.g.stroke();
    A.g.filter = 'none';
    // its rhythm: how strongly each spot shines right now
    const R = plane('r', w, h); const rg = R.g; rg.setTransform(ppi, 0, 0, ppi, 0, 0);
    const blob = (x, y, r, a) => { const q = rg.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(255,255,255,${a})`); q.addColorStop(1, 'rgba(255,255,255,0)'); rg.fillStyle = q; rg.beginPath(); rg.arc(x, y, r, 0, 6.2832); rg.fill(); };
    if (id === 'pulse') { const b = 0.5 - 0.5 * Math.cos(t * 1.2566); rg.fillStyle = `rgba(255,255,255,${0.15 + 0.85 * b * b * (3 - 2 * b)})`; rg.fillRect(0, 0, W, H); }
    else if (id === 'ripple') { for (let k = 0; k < 6; k++) { const d = ((t / 1.6 + k) % 6) * 0.9; rg.strokeStyle = `rgba(255,255,255,${0.9 * Math.max(0, 1 - d / 5)})`; rg.lineWidth = 0.32; rg.beginPath(); rg.arc(W / 2, H / 2, d + 0.05, 0, 6.2832); rg.stroke(); } rg.fillStyle = 'rgba(255,255,255,0.12)'; rg.fillRect(0, 0, W, H); }
    else { const m = Math.round(W * 3.2); for (let i = 0; i < m; i++) blob(hash(i + 1) * W, hash(i + 31) * H, 0.5 + 0.5 * hash(i + 77), 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * (id === 'ember' ? 0.8 : 0.9) + hash(i + 5) * 40))); }
    // the floor's own picture, kept where the band and the rhythm are, then added to what is there
    const P = plane('p', w, h); const k = (ppi / 34) * 0.55;
    P.g.save(); P.g.scale(k, k); P.g.fillStyle = P.g.createPattern(bg, 'repeat'); P.g.fillRect(0, 0, w / k, h / k); P.g.restore();
    P.g.globalCompositeOperation = 'destination-in'; P.g.drawImage(A.c, 0, 0); P.g.drawImage(R.c, 0, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'lighter';
    g.globalAlpha = id === 'ember' ? 1 : 0.9; g.drawImage(P.c, 0, 0); if (id === 'ember') { g.globalAlpha = 0.7; g.drawImage(P.c, 0, 0); }
    g.restore();
    if (id === 'ember') { // a few embers drifting off
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) { const ph = (t * (0.25 + 0.2 * hash(i + 3)) + hash(i + 9)) % 1; const x = 0.9 + hash(i + 13) * (W - 1.8) + ph * 0.5; const y = H / 2 + (hash(i + 17) - 0.5) * 1.6 - ph * 0.4; g.fillStyle = `rgba(255,${150 + Math.round(80 * hash(i))},70,${0.9 * (1 - ph) * Math.min(1, ph * 8)})`; g.beginPath(); g.arc(x, y, 0.035, 0, 6.2832); g.fill(); }
      g.restore();
    }
  }
  // the moment such an effect shows (looked up once in a while, not at every frame)
  const whens = new Map();
  function when(fn, id, since) {
    const key = `${fn}|${id}|${since}`; const e = whens.get(key); const now = performance.now();
    if (e && now - e.at < 5000) return e.v;
    const v = Creatures[fn]({ id: `th-${id}` }, since); whens.set(key, { v, at: now }); return v;
  }
  function drawOn(g, w, h, ppi, kind, id, t, look, bg) {
    const play = look.play;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.fillStyle = '#2a2622'; g.fillRect(0, 0, w, h);
    if (bg) { const k = (ppi / 34) * 0.55; g.save(); g.scale(k, k); g.fillStyle = g.createPattern(bg, 'repeat'); g.fillRect(0, 0, w / k, h / k); g.restore(); }
    g.fillStyle = `rgba(4,6,12,${kind === 'region' && id === 'darkness' ? 0.2 : 0.45})`; g.fillRect(0, 0, w, h);
    g.save(); g.setTransform(ppi, 0, 0, ppi, 0, 0);
    try {
      const W = w / ppi; const H = h / ppi;
      if (kind === 'emitter') {
        const d = FXDATA.EMITTERS.find((x) => x.id === id); if (!d) return;
        const B = E_BOOST[id] || [1.1, 1, 1];
        const big = E_CELL[id] && typeof Creatures === 'object'; // (second-bats-insects: small creatures drawn larger on their tile)
        const stream = id === 'bats' && look.variant === 'stream';
        if (big) Creatures.scene({ cell: E_CELL[id] });
        try {
        FX.emitter(g, { id: `th-${id}`, kind: 'emitter', preset: id, r: d.r * B[0], intensity: B[1], density: B[2], speed: 1, color: look.color || d.color || null, flicker: true,
          ...(d.turn ? { angle: id === 'shaft' ? 35 : id === 'window' ? 60 : 0 } : {}), ...(d.kinds ? { variant: look.variant || d.kinds[0][0] } : {}),
          ...(id === 'window' ? { shape: 'arched', grid: 'cross', stretch: 1.5, dust: 1 } : {}), ...(id === 'shaft' ? { dust: 1 } : {}) }, stream ? W * 0.12 : W / 2, H / 2 + 0.3,
          id === 'geyser' && typeof Creatures === 'object' ? when('eruptionAt', id, play == null ? 1.2 : 0.1) + (play == null ? 0 : (play % 7) - 1) : id === 'devil' && typeof Creatures === 'object' ? when('devilAt', id, play == null ? 6 : 0.5) + (play == null ? 0 : play % 11) : stream ? when('streamAt', id, play == null ? 1.3 : 0.2) + (play == null ? 0 : play % 6) : t); // (second-water-works: a geyser is shown erupting; second-bats-insects: a stream pouring out)
        } finally { if (big) Creatures.scene(null); }
      } else if (LIGHTS[id]) mapLight(g, w, h, ppi, id, t, bg);
      else {
        const B = R_BOOST[id] || [1, 1, null];
        const pts = []; const n = Math.max(10, Math.round(W * 2)); for (let i = 0; i <= n; i++) pts.push(0.9 + (W - 1.8) * (i / n), H / 2 + Math.sin(i * 0.9 * (10 / n)) * 0.35);
        FX.region(g, { id: `th-${id}-${Math.round(w)}`, kind: 'region', preset: id, intensity: B[0], density: B[1], speed: 1, color: look.color || B[2], ...(look.variant ? { variant: look.variant } : {}), strokes: [{ sid: 'a', r: Math.min(1.25, H * 0.3), pts, t0: 0 }] }, t + 2, 1);
      }
    } catch (err) { console.warn(`effect picture ${kind} ${id}: ${err && err.message}`); } finally { g.restore(); }
  }
  // a picture as a data url (null where it cannot be made); o: { w, h (CSS px), color, variant }
  function url(kind, id, o = {}) {
    const w = Math.round((o.w || 104) * 2); const h = Math.round((o.h || 72) * 2);
    const key = `${kind}|${id}|${w}x${h}|${o.color || ''}|${o.variant || ''}`;
    if (!cache.has(key)) {
      const pics = typeof Creatures === 'object' && Creatures.ready ? Creatures.ready() : Promise.resolve(); // (second-birds: the painted creatures)
      cache.set(key, Promise.all([ground(FLOOR[`${kind}|${id}`]), pics]).then(([bg]) => new Promise((res) => {
        const run = () => {
          try {
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            draw(c.getContext('2d'), w, h, (w / 208) * 34 * (o.zoom || 1), kind, id, 7.3, o, bg);
            res(c.toDataURL('image/webp', 0.88));
          } catch (err) { console.warn(`effect picture ${kind} ${id}: ${err && err.message}`); res(null); }
        };
        (window.requestIdleCallback || ((f) => setTimeout(f, 0)))(run, { timeout: 400 });
      })));
      if (cache.size > 160) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  // an <img> that gets its picture when it is ready
  function img(kind, id, o) {
    const el = document.createElement('img'); el.alt = ''; el.draggable = false; el.className = 'fx-pic blank';
    url(kind, id, o).then((u) => { if (u) { el.src = u; el.classList.remove('blank'); } });
    return el;
  }
  // Beta 3.64: the same picture playing: a canvas that draws the effect as time goes by, about 24 times a second,
  // while it is on the page (it stops by itself once it is taken off). o as for img()
  function play(kind, id, o = {}) {
    const w = Math.round((o.w || 284) * 2); const h = Math.round((o.h || 86) * 2);
    const el = document.createElement('canvas'); el.width = w; el.height = h; el.className = 'fx-pic fx-play blank';
    const g = el.getContext('2d'); let bg = null; let ready = false; let seen = false; let last = 0; const t0 = performance.now();
    const pics = typeof Creatures === 'object' && Creatures.ready ? Creatures.ready() : Promise.resolve();
    Promise.all([ground(FLOOR[`${kind}|${id}`]), pics]).then(([im]) => { bg = im; ready = true; });
    const tick = (ms) => {
      if (el.isConnected) seen = true; else if (seen || ms - t0 > 3000) return; // (taken off the page: over)
      requestAnimationFrame(tick);
      if (!ready || !el.isConnected || ms - last < 40 || document.hidden) return;
      last = ms; const sec = (ms - t0) / 1000;
      try { draw(g, w, h, (w / 208) * 34 * (o.zoom || 1), kind, id, 7.3 + sec, { ...o, play: sec }, bg); el.classList.remove('blank'); } catch (err) { /* (drawn again at the next frame) */ }
    };
    requestAnimationFrame(tick);
    return el;
  }
  return { url, img, draw, play };
})();
