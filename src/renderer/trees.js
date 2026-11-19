// Living trees (Beta 3.20): trees made of crown layers that move in the wind, drawn by the graphics card.
//
// A living tree on a map is an asset whose picture is the tree's still picture and that carries a "tree": its variant,
// the layer it starts at (its size) and a seed (its look and its movement). Where the graphics card can draw them
// (hardware WebGL), a map view draws its trees itself, on one canvas per level (on the ground, in front of the
// effects, above the tokens), with the engine in tree-wind.js; everywhere else the still picture shows, like any asset.
//
// This file: the tree pictures (loaded once per window), a drawing level (one canvas, one engine), and the wind the
// trees are in (it follows the map's weather unless the map has its own).
'use strict';

const Trees = (() => {
  const DATA = typeof TREE_DATA === 'object' ? TREE_DATA : { order: [], variants: {} };
  const DIR = new URL('trees/', document.baseURI).href;
  const variant = (id) => DATA.variants[id] || null;
  // the layer that gives a tree of that size its box on the map: its bottom layer, or the one its tree.json names
  // (Beta 3.21: the palm's widest crown sits near the top); its picture's width and height
  function footprint(v, base) { const fp = v.footprintLayer; return fp != null && fp >= base && fp < v.layers.length ? fp : base; }
  function boxOf(tree) {
    const v = tree && variant(tree.v);
    const L = v && (v.layers[footprint(v, tree.base || 0)] || v.layers[0]);
    return L ? { w: L.w, h: L.h } : null;
  }

  // a library picture that is a living tree's still: which tree ({ v, size }); how many squares a new one takes
  function ofPath(p) {
    const m = /[\\/]trees[\\/]([a-z0-9_]+)[\\/]still-([a-z]+)\.webp$/i.exec(String(p || '').split('?')[0]);
    return m && variant(m[1]) ? { v: m[1], size: m[2] } : null;
  }
  const CELLS = { large: 4, medium: 3, small: 2 };
  // Beta 3.21: a kind's own number of squares for a size (mushrooms are smaller than trees), and the sizes it has
  const squares = (id, size) => { const v = variant(id); const s = v && v.sizes.find((x) => x.id === size); return (s && s.squares) || CELLS[size] || 3; };
  const SIZES = ['small', 'medium', 'large'];
  const sizesOf = (id) => { const v = variant(id); return v ? SIZES.filter((k) => v.sizes.some((x) => x.id === k)) : []; };
  const cells = (p) => { const t = ofPath(p); return t ? squares(t.v, t.size) : null; };
  // the still picture of a kind and size: its address in this window, and its library name (what a map keeps)
  const stillUrl = (id, size) => `${DIR}${id}/still-${size}.webp`;
  const relOf = (id, size) => { const v = variant(id); return v ? `Assets/Living trees/${v.label} ${size}.webp` : null; };
  // the kinds by group (Trees, Bushes, Mushrooms), in the order they are listed
  function groups() {
    const out = []; const at = new Map();
    for (const id of DATA.order) {
      const g = (variant(id) && variant(id).group) || 'Trees';
      if (!at.has(g)) { at.set(g, { name: g, ids: [] }); out.push(at.get(g)); }
      at.get(g).ids.push(id);
    }
    const rank = (g) => { const i = (DATA.groups || []).indexOf(g.name); return i < 0 ? 99 : i; };
    return out.sort((a, b) => rank(a) - rank(b));
  }
  // how far a kind may be turned (degrees each way): the pictures have a little light baked in from one side
  const turnOf = (id) => { const v = variant(id); return Math.min(180, (v && v.variation && v.variation.rotation) || 180); };

  // ---------- can this PC draw them? ----------
  // Only with a real graphics card: drawn by the processor (no acceleration, a remote desktop) a single tree costs more
  // than the rest of the map. soft: the self-test's PCs have no graphics card and still check the drawing.
  let ok = null; let soft = false; let broken = false; let renderer = '';
  function supported() {
    if (broken || !window.TreeWind) return false;
    if (ok === null) {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
        ok = !!gl;
        if (gl) { // (a software renderer picked on purpose does not count as a caveat: its name gives it away)
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
          if (/swiftshader|llvmpipe|software|basic render|softpipe/i.test(renderer)) ok = false;
        }
        const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      } catch { ok = false; }
    }
    return ok || soft;
  }
  const listeners = new Set(); // views to draw again when "supported" changes or pictures arrive
  const changed = () => { for (const f of listeners) { try { f(); } catch { /* */ } } };

  // ---------- the pictures ----------
  const pics = new Map(); // variant id → { imgs: [Image] | null, promise }
  function pictures(id) {
    let e = pics.get(id);
    if (e) return e;
    const v = variant(id);
    e = { imgs: null, failed: false, promise: null };
    e.promise = !v ? Promise.resolve(null) : Promise.all(v.layers.map((L) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`tree picture ${id}/${L.file}`)); i.src = `${DIR}${id}/${L.file}`;
    }))).then((imgs) => { e.imgs = imgs; return imgs; }, (err) => { e.failed = true; console.error(err); return null; });
    pics.set(id, e);
    return e;
  }

  // ---------- a drawing level: one canvas, one engine ----------
  const ATTRS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  class Level {
    constructor(el, onChange) {
      this.el = el; this.onChange = onChange; this.gl = null; this.tw = null; this.loading = new Set(); this.dead = false; this.drawn = false;
      this.lost = (e) => { e.preventDefault(); this.tw = null; };
      this.back = () => { this.start(); this.onChange(); };
      el.addEventListener('webglcontextlost', this.lost);
      el.addEventListener('webglcontextrestored', this.back);
      const a = ATTRS;
      this.gl = el.getContext('webgl2', a) || el.getContext('webgl', a);
      if (!this.gl) throw new Error('no WebGL for the trees');
      this.start();
    }
    start() { this.tw = new window.TreeWind(this.gl); this.loading.clear(); }
    // the variants these trees need: loaded when they come, let go when no tree uses them any more
    want(ids) {
      const tw = this.tw; if (!tw) return;
      for (const id of [...tw.variants.keys()]) if (!ids.has(id)) tw.removeVariant(id);
      for (const id of ids) {
        if (tw.variants.has(id) || this.loading.has(id) || !variant(id)) continue;
        const e = pictures(id);
        const add = (imgs) => { this.loading.delete(id); if (imgs && !this.dead && this.tw === tw && !tw.variants.has(id)) { try { tw.addVariant(variant(id), imgs); } catch (err) { console.error(err); } this.onChange(); } };
        if (e.imgs) add(e.imgs); else { this.loading.add(id); e.promise.then(add); }
      }
    }
    // one frame: trees in drawing order; matrix: map inches → canvas pixels
    frame(trees, { dt, wind, shadows, animate, matrix, look }) {
      const tw = this.tw; const gl = this.gl;
      if (!tw || gl.isContextLost()) return false;
      this.want(new Set(trees.map((t) => t.variant)));
      tw.wind = wind; tw.shadows = shadows; tw.animate = animate; tw.look = look || null; // (Beta 3.28: the map's colours)
      tw.update(dt, trees);
      gl.viewport(0, 0, this.el.width, this.el.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      tw.draw(trees, { width: this.el.width, height: this.el.height, matrix });
      this.drawn = true;
      return true;
    }
    clear() {
      if (!this.drawn || !this.gl || this.gl.isContextLost()) return;
      this.gl.viewport(0, 0, this.el.width, this.el.height);
      this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.drawn = false;
      if (this.tw) this.want(new Set());
    }
    // the colour at a canvas pixel, right after frame() (the self-test: is a tree really drawn there)
    read(x, y) {
      const gl = this.gl; const px = new Uint8Array(4);
      try { gl.readPixels(Math.round(x), Math.round(this.el.height - 1 - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } catch { return null; }
      return [...px];
    }
    // how many of its trees can be drawn now (their pictures are there)
    ready(trees) { return this.tw ? trees.filter((t) => this.tw.variants.has(t.variant)).length : 0; }
    free() {
      this.dead = true;
      this.el.removeEventListener('webglcontextlost', this.lost);
      this.el.removeEventListener('webglcontextrestored', this.back);
      if (this.tw) for (const id of [...this.tw.variants.keys()]) this.tw.removeVariant(id);
      const ext = this.gl && this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      this.tw = null;
    }
  }
  function level(el, onChange) {
    if (!supported()) return null;
    try { return new Level(el, onChange); } catch (err) { console.error(err); broken = true; changed(); return null; }
  }

  // ---------- the wind ----------
  // dir: degrees, where it blows to (0 = right, 90 = down), like the weather's. strength: 1 a breeze, 2.4 a storm.
  const CALM = { dir: 30, strength: 1, lean: 0, branches: 1, rustle: 1 };
  const STORM = { strength: 2.4, lean: 0.85, branches: 2, rustle: 1.8 };
  // what blows in a weather layer: how much of its speed is wind (0: it says nothing about the wind)
  const CARRIES = { wind: 1.1, sand: 1.1, rain: 1, hail: 1, leaves: 0.9, petals: 0.8, snow: 0.7, ash: 0.6, fog: 0.3, clouds: 0.25 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // the rest from how hard it blows: the stronger, the more the trees lean and the more their branches and leaves move
  function fromStrength(dir, s) {
    return { dir, strength: s, lean: clamp((s - 1.3) / 1.3, 0, 0.85), branches: clamp(1 + (s - 1) * 0.7, 0.6, 2), rustle: clamp(1 + (s - 1) * 0.57, 0.6, 1.8) };
  }
  function fromWeather(weather) {
    const types = (typeof FXDATA === 'object' && FXDATA.WEATHER_TYPES) || [];
    let best = null; let thunder = false;
    for (const L of (weather && weather.layers) || []) {
      if (!L || L.dying || L.hidden) continue;
      if (L.type === 'lightning') { thunder = true; continue; }
      const k = CARRIES[L.type];
      if (!k) continue;
      const def = types.find((x) => x.id === L.type) || {};
      const e = k * clamp(Number(L.speed ?? 1) || 1, 0.05, 10) * (0.5 + 0.5 * clamp(Number(L.amount ?? 1) || 0, 0, 2)) + 0.8 * clamp(Number(L.gust) || 0, 0, 1);
      if (!best || e > best.e) best = { e, dir: L.dir ?? def.dir ?? 90 };
    }
    if (!best) return thunder ? fromStrength(CALM.dir, 1.6) : null;
    return fromStrength(best.dir, clamp(0.5 + 0.75 * best.e + (thunder ? 0.3 : 0), 0.4, 2.6));
  }
  // the wind the trees of this map are in, and where it comes from ('weather' | 'calm' | 'own' | 'storm')
  function windOf(map) {
    const w = (map && map.wind) || { auto: true };
    let out; let from;
    if (w.auto !== false) { const x = fromWeather(map && map.weather); out = x || { ...CALM }; from = x ? 'weather' : 'calm'; }
    else { out = { dir: w.dir ?? CALM.dir, strength: w.strength ?? 1, lean: w.lean ?? 0, branches: w.branches ?? 1, rustle: w.rustle ?? 1 }; from = 'own'; }
    if (w.storm) { out = { dir: out.dir, strength: Math.max(out.strength, STORM.strength), lean: Math.max(out.lean, STORM.lean), branches: Math.max(out.branches, STORM.branches), rustle: Math.max(out.rustle, STORM.rustle) }; from = 'storm'; }
    return { ...out, from };
  }
  // from the wind as it is towards the wind as it should be, a step of dt seconds (it turns the short way round)
  function ease(now, to, dt) {
    if (!now) return { dir: to.dir, strength: to.strength, lean: to.lean, branches: to.branches, rustle: to.rustle };
    const k = 1 - Math.exp(-Math.max(0, dt) / 1.6);
    const d = ((((to.dir - now.dir) % 360) + 540) % 360) - 180;
    const out = { dir: now.dir + d * k };
    for (const key of ['strength', 'lean', 'branches', 'rustle']) out[key] = now[key] + (to[key] - now[key]) * k;
    return out;
  }
  const settled = (a, b) => !!a && Math.abs(((((b.dir - a.dir) % 360) + 540) % 360) - 180) < 0.2 && ['strength', 'lean', 'branches', 'rustle'].every((k) => Math.abs(a[k] - b[k]) < 0.004);

  return {
    DATA, variant, boxOf, ofPath, cells, squares, sizesOf, SIZES, stillUrl, relOf, groups, turnOf, supported, level, windOf, ease, settled, fromStrength, CALM, STORM,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    // the self-test: draw them without a graphics card too (true), or never (false: the still pictures)
    allowSoft(on) { soft = !!on; broken = false; changed(); },
    never(on) { broken = !!on; changed(); },
    state: () => ({ ok, soft, broken, renderer, pics: [...pics.keys()].filter((k) => pics.get(k).imgs) }),
  };
})();
