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
  const FLOOR = { 'region|rapids': 'clear_water-small.webp', 'region|bubbling': 'old_cobblestone-small.webp', 'emitter|whirl': 'deep_water-small.webp', 'emitter|geyser': 'old_cobblestone-small.webp' };
  // what makes a faint effect read at this size: [size or strength, strength or amount, amount or colour]
  const E_BOOST = { smoke: [1.6, 2.2, 1.5], steam: [1.3, 1.6, 1.3], fireflies: [0.7, 2, 3], sparkles: [1, 1.6, 2], glow: [1.2, 1.5, 1], vent: [1.2, 1.4, 1.4] };
  const R_BOOST = { bubbling: [1.5, 1.4, null], dust: [2, 3, '#e8d9b0'], grass: [2, 1, '#8fbf4a'], lava: [1.5, 2, null], swamp: [1.6, 2, null], mist: [1.2, 1, null] };
  // draw one effect on g (w × h dots, ppi dots a square) at time t; look: { color, variant }
  function draw(g, w, h, ppi, kind, id, t, look = {}, bg = null) {
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
        FX.emitter(g, { id: `th-${id}`, kind: 'emitter', preset: id, r: d.r * B[0], intensity: B[1], density: B[2], speed: 1, color: look.color || d.color || null, flicker: true,
          ...(d.turn ? { angle: id === 'shaft' ? 35 : id === 'window' ? 60 : 0 } : {}), ...(d.kinds ? { variant: look.variant || d.kinds[0][0] } : {}),
          ...(id === 'window' ? { shape: 'arched', grid: 'cross', stretch: 1.5, dust: 1 } : {}), ...(id === 'shaft' ? { dust: 1 } : {}) }, W / 2, H / 2 + 0.3,
          id === 'geyser' && typeof Creatures === 'object' ? Creatures.eruptionAt({ id: `th-${id}` }) : t); // (second-water-works: a geyser is shown erupting)
      } else {
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
      cache.set(key, ground(FLOOR[`${kind}|${id}`]).then((bg) => new Promise((res) => {
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
  return { url, img, draw };
})();
