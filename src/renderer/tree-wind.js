/* tree-wind.js — layered top-down trees that move in the wind.
 *
 * The engine of the living trees (Beta 3.20), as it came with the approved preview. Changed for Tablescape only where
 * marked "Tablescape:" (and "footprintLayer" for the palm, from the second tree package): a plain script instead of an ES module (the windows load scripts from disk), mip levels on
 * WebGL 2 (a tree is often drawn much smaller than its pictures: without them the leaves glitter), shadow pictures at
 * half their size (they are blurred: the same look for a quarter of the memory), and an asset's own colour turn and
 * darkening on top of the tree's variation.
 *
 * Plain WebGL1, no dependencies.
 * A tree is a stack of crown images (biggest at the bottom). Every layer is drawn as a
 * textured quad; the effect comes from four movements:
 *   1. sway      – each layer drifts with the wind; higher layers further and later (trunk bending)
 *   2. branches  – each layer rocks/turns slightly, and parts of the crown turn by different
 *                  amounts (shader warp), so branch-sized chunks swing on their own
 *   3. rustle    – small noise warp + light flicker that drifts downwind
 *   4. lean      – gusty push downwind; every layer is a damped spring, so lulls let it swing
 *                  back (past upright in heavy wind)
 * plus baked soft shadows (layer onto layer, crown onto ground) and per-tree / per-layer
 * variation (rotation, mirroring, size/offset jitter, colour, swapped layers) derived from the
 * tree's seed, so every tree looks different but always the same after reloading.
 *
 * Usage:
 *   const tw = new TreeWind(gl);
 *   await tw.loadVariant('assets/trees/oak_dark_green/');      // reads tree.json + layer images
 *   tw.wind = { dir: 30, strength: 1, lean: 0, branches: 1, rustle: 1 };   // change any time
 *   each frame:
 *     tw.update(dtSeconds, trees);
 *     tw.draw(trees, { width, height, matrix: [a, b, c, d, e, f] });
 *   tree object: { id, variant, x, y, size, rotation = 0, seed = 0, base = 0, opacity = 1 }
 *     x/y/size are map units; size = width of the tree's footprint layer: the bottom layer, or the layer
 *     tree.json names in "footprintLayer" (a palm whose widest crown sits near the top); rotation in radians;
 *     base = index of the bottom layer (0 = full tree; higher = younger/smaller tree)
 *   view.matrix maps map units to canvas pixels: px = a*x + c*y + e, py = b*x + d*y + f
 */

const WIND_DEFAULTS = Object.freeze({ dir: 30, strength: 1, lean: 0, branches: 1, rustle: 1 });

/* used when a tree.json has no "variation" block */
const VARIATION_DEFAULTS = Object.freeze({
  rotation: 180,        // ± degrees per layer (180 = any angle)
  mirror: true,         // random horizontal flip per layer
  scale: 0.05,          // ± size per layer (bottom layer keeps its size)
  offset: 0.03,         // layer centre offset, fraction of the layer's radius (bottom layer stays put)
  hue: 5,               // ± degrees hue shift per tree
  saturation: 0.08,     // ± per tree
  brightness: 0.06,     // ± per tree
  layerHue: 2,          // extra ± degrees per layer
  layerBrightness: 0.03,// extra ± per layer
  heightLight: 0.08,    // top layers brighter / bottom darker by this (not random: adds depth)
  heightWarm: 0.04,     // top layers warmer / bottom cooler by this (not random)
  patchHue: 4,          // ± degrees of soft colour patches inside a layer
  patchBrightness: 0.04,// ± brightness of those patches
  swap: [],             // groups of similar-size layer indices that may trade places, e.g. [[7,8]]
});

const VS = `
attribute vec2 aCorner;
uniform mat3 uView;
uniform vec2 uCenter, uSize, uAnchor, uOffset;
uniform float uScale, uTreeScale, uRot, uFlip;
varying vec2 vTex; varying vec2 vNoise;
void main(){
  vec2 tex = aCorner*uSize - uAnchor;             // texture px relative to crown centre
  vec2 local = vec2(tex.x*uFlip, tex.y)*uScale;   // map units (mirrored if uFlip = -1)
  float c = cos(uRot), s = sin(uRot);
  vec2 world = uCenter + vec2(c*local.x - s*local.y, s*local.x + c*local.y) + uOffset;
  vTex = tex;
  vNoise = (world - uCenter)/uTreeScale;          // shared tree space: rustle/flicker stay one wave across layers
  vec3 p = uView*vec3(world, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

const FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize, uAnchor;
uniform float uScale, uTreeScale, uRot, uFlip;
uniform float uRadius;                             // crown radius, texture px
uniform float uTime, uRustleT, uBranchT;           // clocks (rustle/branch clocks run with the wind)
uniform vec2 uWind;                                // wind direction, map space
uniform float uRustleAmt, uRustleScale, uLight;
uniform float uBranchAmt, uLobes, uSeed, uTreeSeed;
uniform float uShadow, uAlpha;
uniform float uHue, uSat, uBright, uWarm, uPatchHue, uPatchBri;
uniform mat3 uHueM;                                // (Tablescape: the asset's own Hue, turned as the browser turns it)
uniform vec3 uTint; uniform float uTintAmt;
uniform mat4 uLookM; uniform vec4 uLookO; uniform float uLookOn;  // the map's colours (Natural, Vivid, Muted...)
varying vec2 vTex; varying vec2 vNoise;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
float fbm(vec2 p){ return n(p)*0.6 + n(p*2.1 + 3.7)*0.3 + n(p*4.3 - 1.3)*0.1; }
void main(){
  vec2 L = vTex;
  float r = clamp(length(L)/uRadius, 0.0, 1.0);
  // branch warp: angular sectors turn around the centre by different amounts, stronger at the edge
  float phi = atan(L.y, L.x);
  vec2 q = vec2(cos(phi), sin(phi))*uLobes + vec2(uSeed, uSeed*1.7);
  float nb = fbm(q + vec2(uBranchT, -uBranchT*0.8)) - 0.5;
  float wob = sin(uTime*1.21 + phi*2.0 + uSeed)*0.35;
  float th = uBranchAmt*(nb*2.0 + wob*nb*2.0)*smoothstep(0.12, 1.0, r);
  float c = cos(th), s = sin(th);
  vec2 L2 = vec2(c*L.x - s*L.y, s*L.x + c*L.y);
  vec2 seedOff = vec2(uTreeSeed*97.0, uTreeSeed*61.0);
  if (uShadow < 0.5) {
    // leaf rustle: noise field in tree space drifting downwind, stronger toward the crown edge
    vec2 p = (vNoise + seedOff)*uRustleScale*0.35 - uWind*uRustleT;
    float amp = uRustleAmt*(0.35 + 0.65*r*r);
    vec2 d = vec2(fbm(p) - 0.5, fbm(p + 17.3) - 0.5)*2.0*amp;     // tree space
    float cr = cos(-uRot), sr = sin(-uRot);
    d = vec2(cr*d.x - sr*d.y, sr*d.x + cr*d.y);                     // -> layer's own space
    L2 += vec2(d.x*uFlip, d.y)*(uTreeScale/uScale);
  }
  vec2 uv = (L2 + uAnchor)/uSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 col = texture2D(uTex, uv);
  if (uShadow > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, col.a*uAlpha); return; }
  vec2 p2 = (vNoise + seedOff)*uRustleScale*0.9 - uWind*uRustleT*1.6;
  vec3 rgb = col.rgb*(1.0 + (fbm(p2) - 0.5)*2.0*uLight);
  // colour variation: soft patches stuck to the leaves + per tree/layer hue, saturation, brightness, warmth
  float pn = n(L*0.009 + vec2(uSeed*13.0, uSeed*7.0)) - 0.5;      // one octave is enough for soft patches
  float hue = uHue + pn*2.0*uPatchHue;
  float Y = dot(rgb, vec3(0.299, 0.587, 0.114));
  float I = dot(rgb, vec3(0.596, -0.274, -0.322));
  float Q = dot(rgb, vec3(0.211, -0.523, 0.312));
  float ch = cos(hue), sh = sin(hue);
  vec2 iq = vec2(I*ch - Q*sh, I*sh + Q*ch)*uSat;
  rgb = vec3(Y + 0.956*iq.x + 0.621*iq.y, Y - 0.272*iq.x - 0.647*iq.y, Y - 1.106*iq.x + 1.703*iq.y);
  rgb = uHueM*rgb;                                  // (linear, so it works on premultiplied colour as it is)
  rgb *= uBright*(1.0 + pn*2.0*uPatchBri);
  rgb *= vec3(1.0 + uWarm*0.6, 1.0 + uWarm*0.25, 1.0 - uWarm*0.6);
  rgb = clamp(rgb, 0.0, col.a);                     // stay valid premultiplied colour
  if (uLookOn > 0.5 && col.a > 0.002) {             // the map's colour matrix, on the colour itself (not premultiplied)
    vec4 u = uLookM*vec4(rgb/col.a, col.a) + uLookO;
    rgb = clamp(u.rgb, 0.0, 1.0)*col.a;
  }
  rgb = mix(rgb, uTint*col.a, uTintAmt);
  gl_FragColor = vec4(rgb, col.a)*uAlpha;           // premultiplied alpha
}`;

// Tablescape (second-tree-hue-solid): an asset's own Hue turns a living tree's colours exactly as the browser's
// hue-rotate() turns every other asset, the placing preview and the still trees on a PC without a graphics card (the
// matrix of the CSS/SVG filter spec). The tree's own small natural variation above stays in YIQ. Column-major for GL.
const HUE_ID = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const hueCache = new Map();
function hueMatrix(rad) {
  if (!rad) return HUE_ID;
  const k = Math.round(rad * 1e4);
  let m = hueCache.get(k);
  if (m) return m;
  const c = Math.cos(rad); const s = Math.sin(rad);
  const r = [ // rows
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]];
  m = new Float32Array([r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]]);
  if (hueCache.size > 200) hueCache.clear();
  hueCache.set(k, m);
  return m;
}

const DEBUG_TINTS = [[.95,.3,.3],[.95,.65,.2],[.9,.9,.25],[.3,.85,.4],[.3,.6,.95],[.75,.4,.95],[.95,.4,.7],[.4,.9,.9],[.6,.6,.6]];
const UNIFORMS = ['uView','uCenter','uSize','uAnchor','uOffset','uScale','uTreeScale','uRot','uFlip','uTex','uRadius','uTime',
  'uRustleT','uBranchT','uWind','uRustleAmt','uRustleScale','uLight','uBranchAmt','uLobes','uSeed','uTreeSeed','uShadow','uAlpha',
  'uHue','uSat','uBright','uWarm','uPatchHue','uPatchBri','uHueM','uTint','uTintAmt','uLookM','uLookO','uLookOn'];
const DEG = Math.PI/180;

/* 1-D value noise for gusts */
function vn(x) { const i = Math.floor(x), f = x - i, u = f*f*(3 - 2*f);
  const hh = k => { const s = Math.sin(k*127.1 + 311.7)*43758.5453; return s - Math.floor(s); };
  return hh(i) + (hh(i + 1) - hh(i))*u; }
function gustEnv(t, seed) { return 0.62 + 0.38*(0.5 + 0.5*Math.sin(t*0.21 + seed)*Math.sin(t*0.13 + seed*2.3)); }
/* deterministic random numbers from (seed, layer, channel): 0..1 and -1..1 */
function rnd(seed, i, k) { const s = Math.sin(seed*12.9898 + i*78.233 + k*37.719 + 0.5)*43758.5453; return s - Math.floor(s); }
const sym = (seed, i, k) => rnd(seed, i, k)*2 - 1;

class TreeWind {
  constructor(gl) {
    this.gl = gl;
    this.variants = new Map();          // id -> variant (config + GPU textures)
    this.wind = { ...WIND_DEFAULTS };
    this.variation = 1;                 // 0 = every tree of a variant identical, 1 = tuned variation
    this.shadows = true;
    this.debugLayers = false;           // tint each layer a different colour
    this.animate = true;                // false = freeze all movement (static trees)
    this.time = 0; this.rustleT = 0; this.branchT = 0; this.gustT = 0;
    this._lean = { x: 0, y: 0 };        // eased lean vector (direction * amount)
    this._springs = new Map();          // treeId -> [{x,y,vx,vy}] per layer slot
    this._looks = new Map();            // treeId -> cached variation (rebuilt when seed/variant/base/variation change)
    this._initGL();
  }

  /* ---------- loading ---------- */
  /** Load a variant folder (must contain tree.json + the layer images).
   *  opts.fetchJson(url) / opts.loadImage(url) can be supplied (e.g. for file:// in Electron). */
  async loadVariant(baseUrl, opts = {}) {
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const fetchJson = opts.fetchJson || (u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }));
    const loadImage = opts.loadImage || (u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + u)); i.src = u; }));
    const cfg = await fetchJson(baseUrl + 'tree.json');
    const imgs = await Promise.all(cfg.layers.map(l => loadImage(baseUrl + l.file)));
    return this.addVariant(cfg, imgs);
  }

  /** Register a variant from an already-parsed tree.json and loaded images (same order as cfg.layers). */
  addVariant(cfg, images) {
    const fpI = cfg.footprintLayer ?? 0;               // the ground-shadow layer gets the softer blur
    const baseW = cfg.layers[fpI].w;
    const layers = cfg.layers.map((L, i) => {
      const img = images[i];
      const blur = baseW*cfg.shadow.blur*(i === fpI ? 1.8 : 1);
      return { ...L, tex: this._texture(img), sh: this._shadowTexture(img, blur) };
    });
    const v = { ...cfg, variation: { ...VARIATION_DEFAULTS, ...(cfg.variation || {}) }, layers };
    this.removeVariant(cfg.id);
    this.variants.set(cfg.id, v);
    this._looks.clear();
    return v;
  }

  /** Free GPU memory of one variant. */
  removeVariant(id) {
    const v = this.variants.get(id); if (!v) return;
    for (const L of v.layers) { this.gl.deleteTexture(L.tex); this.gl.deleteTexture(L.sh.tex); }
    this.variants.delete(id);
  }

  /* ---------- variation ---------- */
  /** How this tree's layers are arranged and coloured. Pure function of (variant, seed, base, variation). */
  lookOf(tree, v) {
    const seed = tree.seed || 0, base = tree.base || 0, V = this.variation;
    const key = v.id + '|' + seed + '|' + base + '|' + V;
    const cached = this._looks.get(tree.id);
    if (cached && cached.key === key) return cached;
    const va = v.variation, n = v.layers.length, top = Math.max(1, n - 1 - base);
    // which image sits in which slot (similar-size layers may trade places; never the bottom one)
    const order = v.layers.map((_, i) => i);
    if (V > 0) (va.swap || []).forEach((grp, g) => {
      if (grp.some(i => i <= base || i >= n)) return;
      const k = Math.floor(rnd(seed, g, 11)*grp.length);              // rotate the group by k
      const imgs = grp.map(i => order[i]);
      grp.forEach((slot, j) => { order[slot] = imgs[(j + k) % grp.length]; });
    });
    const hueT = sym(seed, 0, 6)*va.hue*V, satT = 1 + sym(seed, 0, 7)*va.saturation*V, briT = 1 + sym(seed, 0, 8)*va.brightness*V;
    const slots = order.map((img, i) => {
      const hgt = i < base ? 0 : (i - base)/top, isBase = i === base;
      const L = v.layers[img];
      const offR = isBase ? 0 : rnd(seed, i, 5)*va.offset*V*L.radius, offA = rnd(seed, i, 4)*2*Math.PI;
      return {
        img,
        rot: sym(seed, i, 1)*va.rotation*DEG*V,
        flip: va.mirror && V > 0 && rnd(seed, i, 2) < 0.5 ? -1 : 1,
        scl: isBase ? 1 : 1 + sym(seed, i, 3)*va.scale*V,
        offX: Math.cos(offA)*offR, offY: Math.sin(offA)*offR,         // texture px, tree orientation
        hue: (hueT + sym(seed, i, 9)*va.layerHue*V)*DEG,
        sat: satT,
        bright: briT*(1 + sym(seed, i, 10)*va.layerBrightness*V)*(1 + va.heightLight*(hgt*2 - 1)),
        warm: va.heightWarm*(hgt*2 - 1),
      };
    });
    const look = { key, slots, patchHue: va.patchHue*V*DEG, patchBri: va.patchBrightness*V };
    this._looks.set(tree.id, look);
    return look;
  }

  /* ---------- simulation ---------- */
  /** Advance the wind simulation. Call once per frame with all trees that exist (also off-screen ones). */
  update(dt, trees) {
    if (!this.animate) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const W = this.wind, storm = Math.min(1, Math.max(0, (W.strength - 1)/1.5));
    this.time += dt;
    this.rustleT += dt*(0.5 + 0.5*W.strength);
    this.branchT += dt*(0.6 + 0.4*W.strength);
    this.gustT += dt*(1 + 0.7*storm);
    // lean target eases in, so turning the wind swings the trees over instead of snapping
    const a = W.dir*DEG, k = 1 - Math.exp(-dt*1.4);
    this._lean.x += (Math.cos(a)*W.lean - this._lean.x)*k;
    this._lean.y += (Math.sin(a)*W.lean - this._lean.y)*k;

    const seen = new Set();
    for (const t of trees) {
      const v = this.variants.get(t.variant); if (!v) continue;
      seen.add(t.id);
      this._stepSprings(t, v, dt, storm);
    }
    for (const id of this._springs.keys()) if (!seen.has(id)) this._springs.delete(id);
    for (const id of this._looks.keys()) if (!seen.has(id)) this._looks.delete(id);
  }

  _stepSprings(tree, v, dt, storm) {
    const ln = v.lean, W = this.wind, seed = tree.seed || 0;
    const base = tree.base || 0, n = v.layers.length, top = Math.max(1, n - 1 - base);
    let st = this._springs.get(tree.id);
    if (!st || st.length !== n) { st = v.layers.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 })); this._springs.set(tree.id, st); }
    const varAmt = Math.min(1.35, ln.gustVar + ln.gustVarWind*Math.max(0, W.strength - 1));
    const zeta = ln.damping + (ln.dampingStorm - ln.damping)*storm;
    const speed = 1 + 0.25*Math.max(0, W.strength - 1);
    const steps = 4, h = dt/steps;
    for (let i = base; i < n; i++) {
      const hgt = (i - base)/top, sp = st[i];
      const w = 2*Math.PI/(ln.period*(1 + (ln.periodTop - 1)*hgt))*speed;
      const gt = (this.gustT - hgt*0.35)*ln.gustRate;
      const g01 = vn(gt + seed*7.3)*0.55 + vn(gt*2.3 + seed*3.1 + 50)*0.3 + vn(gt*5.1 + seed + 90)*0.15;
      const gust = Math.pow(g01, 1.6 + 0.8*storm)*(1.9 + 0.3*storm);
      const push = ln.top*(0.06 + 0.94*Math.pow(hgt, ln.curve))*((1 - varAmt) + varAmt*gust);
      const tx = this._lean.x*push, ty = this._lean.y*push;
      for (let s = 0; s < steps; s++) {
        sp.vx += (w*w*(tx - sp.x) - 2*zeta*w*sp.vx)*h; sp.vy += (w*w*(ty - sp.y) - 2*zeta*w*sp.vy)*h;
        sp.x += sp.vx*h; sp.y += sp.vy*h;
      }
    }
  }

  /** Per-layer offset (map units) and extra rotation from the wind, for layer slot i of one tree. */
  layerMotion(tree, v, i) {
    const W = this.wind, t = this.time, seed = tree.seed || 0, size = tree.size;
    const base = tree.base || 0, n = v.layers.length, top = Math.max(1, n - 1 - base);
    const hgt = (i - base)/top, sw = v.sway, br = v.branches;
    const k = 0.12 + 0.88*Math.pow(hgt, 1.25);
    const a = W.dir*DEG, wx = Math.cos(a), wy = Math.sin(a);
    const w = 2*Math.PI/sw.period, ph = hgt*sw.lag + seed;
    const amp = size*sw.topAmplitude*W.strength*k*gustEnv(t, seed);
    const along = 0.45 + 0.55*Math.sin(w*t - ph) + 0.12*Math.sin(w*2.7*t - ph*1.7);
    const across = sw.cross*Math.sin(w*1.63*t - ph*1.3 + 1.1);
    const wb = 2*Math.PI/br.period, ls = seed*3.1 + i*1.93;
    const turn = br.layerTurn*W.branches*(0.35 + 0.65*hgt)*(0.5 + 0.5*W.strength)*
                 (Math.sin(wb*t + ls)*0.7 + Math.sin(wb*1.73*t + ls*1.4)*0.3)*gustEnv(t, seed + i);
    let lx = 0, ly = 0;
    const sp = this._springs.get(tree.id)?.[i];
    if (sp) {   // soft limit so the strongest gusts never push the top outside the tree
      const m = Math.hypot(sp.x, sp.y), lim = v.lean.maxBend, f = m > 1e-6 ? lim*Math.tanh(m/lim)/m : 1;
      lx = sp.x*f*size; ly = sp.y*f*size;
    }
    return { x: (wx*along - wy*across)*amp + lx, y: (wy*along + wx*across)*amp + ly,
             rot: sw.twist*W.strength*k*Math.sin(w*0.8*t - ph + 0.5)*gustEnv(t, seed + 4) + turn };
  }

  /** Layer slot that defines the tree's size and casts the ground shadow: tree.json "footprintLayer"
   *  (when the tree starts at or below it), else the bottom layer of this size. */
  footprintSlot(tree, v) {
    const base = tree.base || 0, fp = v.footprintLayer;
    return (fp != null && fp >= base && fp < v.layers.length) ? fp : base;
  }

  /* ---------- drawing ---------- */
  /** Draw trees in the given order (sort them yourself, e.g. small/back first).
   *  view = { width, height, matrix:[a,b,c,d,e,f] }  (canvas pixels; matrix maps map units -> canvas px) */
  draw(trees, view) {
    const gl = this.gl, U = this._u;
    const [a, b, c, d, e, f] = view.matrix, Wd = view.width, Hd = view.height;
    const zoom = Math.sqrt(Math.abs(a*d - b*c));
    gl.useProgram(this._prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.enableVertexAttribArray(this._aCorner);
    gl.vertexAttribPointer(this._aCorner, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.uTex, 0);
    // map units -> clip space (column-major mat3)
    gl.uniformMatrix3fv(U.uView, false, [a*2/Wd, -b*2/Hd, 0, c*2/Wd, -d*2/Hd, 0, e*2/Wd - 1, 1 - f*2/Hd, 1]);
    gl.uniform1f(U.uTime, this.time); gl.uniform1f(U.uRustleT, this.rustleT); gl.uniform1f(U.uBranchT, this.branchT);
    const wa = this.wind.dir*DEG; gl.uniform2f(U.uWind, Math.cos(wa), Math.sin(wa));
    // the map's colours: a colour matrix as feColorMatrix takes it (20 values, row by row), or none
    const L = Array.isArray(this.look) && this.look.length === 20 ? this.look : null;
    gl.uniform1f(U.uLookOn, L ? 1 : 0);
    if (L) {
      gl.uniformMatrix4fv(U.uLookM, false, [0, 1, 2, 3].flatMap((j) => [L[j], L[5 + j], L[10 + j], L[15 + j]]));
      gl.uniform4f(U.uLookO, L[4], L[9], L[14], L[19]);
    }

    for (const tree of trees) {
      const v = this.variants.get(tree.variant); if (!v) continue;
      // cull trees that are fully off-screen
      const px = a*tree.x + c*tree.y + e, py = b*tree.x + d*tree.y + f, R = tree.size*zoom*1.2;
      if (px < -R || py < -R || px > Wd + R || py > Hd + R) continue;
      this._drawTree(tree, v);
    }
  }

  _drawTree(tree, v) {
    const gl = this.gl, U = this._u, W = this.wind, sd = v.shadow;
    const base = tree.base || 0, n = v.layers.length;
    const look = this.lookOf(tree, v);
    const fp = this.footprintSlot(tree, v);
    const baseL = v.layers[look.slots[fp].img];       // the footprint layer (bottom layer unless footprintLayer)
    const scale = tree.size/baseL.w;                  // map units per texture px
    const rot0 = tree.rotation || 0, alpha = tree.opacity ?? 1, seed = tree.seed || 0;
    gl.uniform1f(U.uTreeScale, scale);
    gl.uniform1f(U.uTreeSeed, seed);
    gl.uniform1f(U.uRustleAmt, v.rustle.amount*baseL.w*W.rustle*(0.4 + 0.6*Math.min(W.strength, 1.5)));
    gl.uniform1f(U.uRustleScale, v.rustle.scale);
    gl.uniform1f(U.uLight, v.rustle.light*W.rustle);
    gl.uniform1f(U.uBranchAmt, v.branches.sectorTurn*W.branches*(0.45 + 0.55*Math.min(W.strength, 2)));
    gl.uniform1f(U.uLobes, v.branches.lobes);
    gl.uniform1f(U.uPatchHue, look.patchHue); gl.uniform1f(U.uPatchBri, look.patchBri);
    gl.uniform2f(U.uCenter, tree.x, tree.y);
    const sun = [0.62, 0.78];                          // shadow direction in map space
    const cr = Math.cos(rot0), sr = Math.sin(rot0);
    for (let i = base; i < n; i++) {
      const S = look.slots[i], L = v.layers[S.img], m = this.layerMotion(tree, v, i);
      const rot = rot0 + S.rot + m.rot;
      // static layer offset (variation) in map units, turned with the whole tree
      const ox = (cr*S.offX - sr*S.offY)*scale, oy = (sr*S.offX + cr*S.offY)*scale;
      gl.uniform1f(U.uSeed, seed*5.3 + i*2.7);
      gl.uniform1f(U.uRadius, L.radius);
      gl.uniform1f(U.uRot, rot);
      gl.uniform1f(U.uFlip, S.flip);
      gl.uniform1f(U.uScale, scale*S.scl);
      if (this.shadows) {
        const isGround = i === fp;                    // the footprint layer shades the ground (and what lies under it)
        const dd = tree.size*(isGround ? sd.groundOffset : sd.layerOffset*(1 + (i - base)*0.25));
        const follow = isGround ? 0.6 : 1;
        gl.bindTexture(gl.TEXTURE_2D, L.sh.tex);
        gl.uniform2f(U.uSize, L.sh.w, L.sh.h);
        gl.uniform2f(U.uAnchor, L.cx + L.sh.pad, L.cy + L.sh.pad);
        gl.uniform2f(U.uOffset, ox + m.x*follow + sun[0]*dd, oy + m.y*follow + sun[1]*dd);
        gl.uniform1f(U.uShadow, 1);
        gl.uniform1f(U.uAlpha, (isGround ? sd.groundAlpha : sd.layerAlpha)*alpha);
        gl.uniform1f(U.uTintAmt, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.bindTexture(gl.TEXTURE_2D, L.tex);
      gl.uniform2f(U.uSize, L.w, L.h);
      gl.uniform2f(U.uAnchor, L.cx, L.cy);
      gl.uniform2f(U.uOffset, ox + m.x, oy + m.y);
      gl.uniform1f(U.uShadow, 0);
      gl.uniform1f(U.uAlpha, alpha);
      gl.uniform1f(U.uHue, S.hue); gl.uniformMatrix3fv(U.uHueM, false, hueMatrix(tree.hue || 0)); gl.uniform1f(U.uSat, S.sat); gl.uniform1f(U.uBright, S.bright*(tree.bright ?? 1)); gl.uniform1f(U.uWarm, S.warm); // (Tablescape: the asset's own colour turn and darkening)
      gl.uniform3fv(U.uTint, DEBUG_TINTS[(i - base) % DEBUG_TINTS.length]);
      gl.uniform1f(U.uTintAmt, this.debugLayers ? 0.38 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  /* ---------- GL helpers ---------- */
  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this._prog = p;
    this._u = {}; for (const n of UNIFORMS) this._u[n] = gl.getUniformLocation(p, n);
    this._aCorner = gl.getAttribLocation(p, 'aCorner');
    this._buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
  }
  _texture(src) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Tablescape: mip levels where the context can make them for any picture size (WebGL 2)
    const mips = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /* soft shadow = blurred copy of the layer, padded so the blur isn't clipped */
  _shadowTexture(img, blurPx) {
    // Tablescape: drawn at half size (w, h and pad stay in the layer's own pixels, which is all the shader needs)
    const pad = Math.ceil(blurPx*2.5), c = document.createElement('canvas'), k = 0.5;
    const w = img.width + pad*2, h = img.height + pad*2;
    c.width = Math.max(1, Math.round(w*k)); c.height = Math.max(1, Math.round(h*k));
    const x = c.getContext('2d'); x.scale(c.width/w, c.height/h); x.filter = `blur(${blurPx*k}px)`; x.drawImage(img, pad, pad);
    return { tex: this._texture(c), w, h, pad };
  }
}

if (typeof window !== 'undefined') { window.TreeWind = TreeWind; window.TREE_WIND_DEFAULTS = WIND_DEFAULTS; }
