// Second Builder (portrait looks): how a portrait looks in a conversation, drawn into the picture itself.
//   Bloodied  stains from looks/blood/, more of them the higher the amount; the same ones stay where they are
//   Shaded    darker from the top of the head down (the strength is how dark the very top is), gone by the middle
//   Hidden    the whole figure black: only its outline shows
// They stack in that order: the blood first, the shade over it, the silhouette over everything.
// The result is a picture of the same size as the portrait, so the TV's entry and exit animations, the mirror,
// the size and the place all work on it as on the portrait itself. Used by the TV (table-overlays.js) and by the
// preview in the GM's portrait popup (toolbox.js).
'use strict';
window.PortraitFx = (() => {
  // the eight stains (Higgsfield, gpt_image_2_6): how far each may turn (drips run down, so hardly), how big against
  // the figure's width, and how much of it lies over the figure at most
  const STAINS = [
    { f: 'blood-0', turn: 180, size: [0.34, 0.5] }, // a big splash with drops round it
    { f: 'blood-1', turn: 180, size: [0.36, 0.55] }, // a wiped smear
    { f: 'blood-2', turn: 12, size: [0.3, 0.46] }, // runs down in drips
    { f: 'blood-3', turn: 180, size: [0.4, 0.6] }, // a fine spray
    { f: 'blood-4', turn: 180, size: [0.3, 0.46] }, // soaked into cloth
    { f: 'blood-5', turn: 180, size: [0.3, 0.44] }, // a few splats
    { f: 'blood-6', turn: 60, size: [0.4, 0.6] }, // the streak of a slash
    { f: 'blood-7', turn: 40, size: [0.26, 0.38] }, // an old handprint
  ];
  const MOST = 16; // stains at 100 %
  const BIG = 1800; // the longest side a composed picture gets (the TV is 4K at most; portraits are rarely taller)

  const base = new URL('looks/blood/', document.baseURI).href;
  let texP = null;
  function textures() {
    if (!texP) {
      texP = Promise.all(STAINS.map((s) => new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => res(null);
        im.src = `${base}${s.f}.webp`;
      })));
    }
    return texP;
  }

  // ---------- what is set ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
  // settings.portraitFx[path] → the three looks as numbers; bloodOn / shadeOn keep the slider's value while switched off
  function norm(fx) {
    const o = fx || {};
    return {
      blood: o.bloodOn ? clamp(o.blood == null ? 0.4 : o.blood, 0, 1) : 0,
      shade: o.shadeOn ? clamp(o.shade == null ? 0.5 : o.shade, 0, 0.9) : 0,
      hidden: !!o.hidden,
    };
  }
  const active = (fx) => { const n = norm(fx); return n.blood > 0 || n.shade > 0 || n.hidden; };
  const keyOf = (url, fx, opaque) => { const n = norm(fx); return `${url}|${n.blood.toFixed(2)}|${n.shade.toFixed(2)}|${n.hidden ? 1 : 0}|${opaque ? 1 : 0}`; };

  // ---------- a fixed pattern per portrait ----------
  const hash = (s) => [...String(s)].reduce((a, ch) => Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // where the figure is: its box, and a test whether a point lies on it (from a small copy of the alpha)
  function figure(img, w, h, opaque) {
    const ellipse = (x, y) => ((x / w - 0.5) / 0.46) ** 2 + ((y / h - 0.46) / 0.48) ** 2 < 1; // (the TV's mask for portraits without transparency)
    if (opaque) return { box: { x: w * 0.04, y: h * 0.0, w: w * 0.92, h: h * 0.98 }, on: ellipse };
    const N = 96; const sw = Math.max(1, Math.round((N * w) / Math.max(w, h))); const sh = Math.max(1, Math.round((N * h) / Math.max(w, h)));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, sw, sh);
    let d = null;
    try { d = g.getImageData(0, 0, sw, sh).data; } catch { d = null; } // (a picture it may not read: then the whole picture counts)
    if (!d) return { box: { x: 0, y: 0, w, h }, on: () => true };
    let x0 = sw; let y0 = sh; let x1 = -1; let y1 = -1;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d[(y * sw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { box: { x: 0, y: 0, w, h }, on: () => true };
    const fx = w / sw; const fy = h / sh;
    return {
      box: { x: x0 * fx, y: y0 * fy, w: (x1 - x0 + 1) * fx, h: (y1 - y0 + 1) * fy },
      on: (x, y) => { const i = (Math.min(sh - 1, Math.max(0, Math.floor(y / fy))) * sw + Math.min(sw - 1, Math.max(0, Math.floor(x / fx)))) * 4 + 3; return d[i] > 160; },
    };
  }

  // the stains for one portrait, always the same list: a higher amount only uses more of it
  function plan(seedKey, fig) {
    const r = rng(hash(seedKey));
    const order = STAINS.map((s, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const b = fig.box; const out = [];
    for (let k = 0; k < MOST; k++) {
      const t = order[k % order.length]; const s = STAINS[t];
      // on the figure, mostly between the head and the knees (not the bottom edge, where the band covers it)
      let x = 0; let y = 0;
      for (let n = 0; n < 40; n++) {
        x = b.x + b.w * (0.08 + 0.84 * r()); y = b.y + b.h * (0.04 + 0.78 * r() ** 1.15);
        if (fig.on(x, y)) break;
      }
      const size = b.w * (s.size[0] + (s.size[1] - s.size[0]) * r()) * (k < 3 ? 1 : 0.85);
      out.push({ t, x, y, size, rot: ((r() * 2 - 1) * s.turn * Math.PI) / 180, flip: r() < 0.5, a: 0.82 + 0.18 * r() });
    }
    return out;
  }

  // ---------- drawing ----------
  async function compose(img, fx, o = {}) {
    const n = norm(fx);
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const k = Math.min(1, BIG / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)); const h = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const fig = figure(img, w, h, o.opaque);
    if (n.blood > 0) {
      const tex = await textures();
      const list = plan(o.seed || '', fig).slice(0, Math.max(1, Math.ceil(n.blood * MOST)));
      const b = document.createElement('canvas'); b.width = w; b.height = h;
      const bg = b.getContext('2d');
      for (const s of list) {
        const im = tex[s.t]; if (!im) continue;
        bg.save(); bg.globalAlpha = s.a; bg.translate(s.x, s.y); bg.rotate(s.rot); if (s.flip) bg.scale(-1, 1);
        bg.drawImage(im, -s.size / 2, -s.size / 2, s.size, s.size);
        bg.restore();
      }
      bg.globalCompositeOperation = 'destination-in'; // only on the figure
      bg.drawImage(img, 0, 0, w, h);
      // the blood soaks in (multiply keeps the folds and the light of the picture) and still shows on dark cloth
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.75; g.drawImage(b, 0, 0); g.restore();
      g.save(); g.globalAlpha = 0.72; g.drawImage(b, 0, 0); g.restore();
    }
    if (n.shade > 0) {
      // (full strength on the top of the head, still most of it over the face, gone by the middle of the figure)
      const top = fig.box.y; const end = top + fig.box.h * 0.6;
      const gr = g.createLinearGradient(0, top, 0, end);
      gr.addColorStop(0, `rgba(0,0,0,${n.shade})`);
      gr.addColorStop(0.3, `rgba(0,0,0,${(n.shade * 0.72).toFixed(3)})`);
      gr.addColorStop(0.65, `rgba(0,0,0,${(n.shade * 0.25).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
    }
    if (n.hidden) { g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#050406'; g.fillRect(0, 0, w, h); g.restore(); }
    return c;
  }

  // a composed picture as a URL for an <img>; the last few are kept so going back and forth is quick
  const cache = new Map();
  function load(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
  }
  async function url(src, fx, o = {}) {
    if (!active(fx)) return src;
    const key = keyOf(src, fx, o.opaque);
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const img = await load(src);
    const c = await compose(img, fx, { ...o, seed: o.seed || src });
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.95));
    const out = URL.createObjectURL(blob);
    cache.set(key, out);
    while (cache.size > 16) { const [k0, v0] = cache.entries().next().value; cache.delete(k0); URL.revokeObjectURL(v0); }
    return out;
  }

  return { norm, active, keyOf, compose, url, textures, STAINS };
})();
