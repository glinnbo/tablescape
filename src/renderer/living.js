/*
 * Living effects on Oldschool maps (Beta 3.42; 3.43: drawn over any floor instead of belonging to a tile).
 *
 * The picture of an Oldschool map comes with a small map of where effects were drawn (oldschool.js, four parts side by
 * side: a = red water, green lava, blue grass; b = red glow; c = the glow's rhythm and a ripple's rings; d = the colour
 * picked for the grass). One see-through WebGL 2 canvas right above the map picture draws
 *   water  the bed (the map picture itself) seen through moving water: it wobbles, gets darker and bluer away from the
 *          bank, light ripples run over it, a faint line lies at the bank. The shadows baked into the picture stay
 *   lava   only light: what is red-hot in the picture pulses and flickers, and its glow spills on what is near. The
 *          floor itself is not drawn again, so it stays as sharp as the tiles around it
 *   glow   only light as well: bright, saturated colours of any hue shine and bloom. Three rhythms: each spot on its
 *          own (glow), all of the map breathing together (pulse), rings running out from the middle of what was
 *          drawn (ripple)
 *   grass  blades, each a flat shape of its own rooted at one spot (Glinn's sketch): seen from above an upright blade
 *          is a dot; the wind lays it over, so it shows its length, swings a little about the wind's direction and is
 *          the more opaque the more it leans. Its colour is the floor's under its root, or the colour picked for it
 * with the map's wind, the same the living trees are in (trees.js). No graphics card: nothing is drawn, the map shows
 * as it is.
 */
'use strict';
const Living = (() => {
  const NOISE = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }`;
  // ---- the picture where water or lava lies (a quad over the map picture; map units → canvas dots by uMat)
  const PVS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec4 uRect; uniform vec4 uMat; uniform vec2 uView; uniform float uG;
out vec2 vUV; out vec2 vQ;
void main() {
  vec2 p = uRect.xy + aPos * uRect.zw; vUV = aPos; vQ = p / uG;
  vec2 c = p * uMat.x + uMat.zw;
  gl_Position = vec4(c.x / uView.x * 2.0 - 1.0, 1.0 - c.y / uView.y * 2.0, 0.0, 1.0);
}`;
  const PFS = `#version 300 es
precision highp float;
uniform sampler2D uPic, uA, uB, uC;
uniform vec2 uPicSize;   // the picture, in dots
uniform float uP, uPm;   // dots a square: of the picture, of the living map
uniform float uT, uGT;   // time; the glow's own time (Glow speed)
uniform float uGlow, uRipMax;
in vec2 vUV; in vec2 vQ; out vec4 o;
${NOISE}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float hot(vec3 c) { return clamp((c.r - 1.25 * c.b - 0.2) * 2.4, 0.0, 1.0); }
// how much a colour is one that shines: bright and saturated (any hue), or very bright
float shine(vec3 c) { float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float sat = (mx - mn) / max(mx, 0.001);
  return max(smoothstep(0.32, 0.68, sat) * smoothstep(0.34, 0.72, mx), 0.7 * smoothstep(0.80, 0.97, mx)); }
void main() {
  vec4 m = texture(uA, vUV);
  float near = textureLod(uA, vUV, log2(max(1.0, 0.9 * uPm))).g; // (lava near here)
  float gs = texture(uB, vUV).r;
  if (m.r + m.g + near + gs < 0.004) discard;
  vec4 pic = texture(uPic, vUV);
  vec3 col = pic.rgb; vec2 q = vQ; vec2 px = vUV * uPicSize;
  float cover = 0.0; vec3 add = vec3(0.0);
  if (m.r > 0.003) { // water: the bed drawn again, moving
    float depth = smoothstep(0.5, 1.0, textureLod(uA, vUV, log2(max(1.0, 0.6 * uPm))).r); // (far from the bank)
    vec2 wob = vec2(fbm(q * 2.2 + vec2(uT * 0.33, uT * 0.26)) - 0.5, fbm(q * 2.2 + vec2(-uT * 0.29, uT * 0.38) + 7.3) - 0.5);
    vec2 off = wob * (0.05 + 0.08 * depth) * uP;
    float there = texture(uA, (px + off) / uPicSize).r;
    vec3 bed = mix(col, texture(uPic, (px + off) / uPicSize).rgb, there);
    vec3 w = bed * mix(vec3(0.80, 0.97, 0.95), vec3(0.34, 0.60, 0.66), depth);
    w = mix(w, vec3(0.04, 0.20, 0.26) * (0.4 + lum(bed)), 0.22 * depth);
    float c1 = 1.0 - abs(2.0 * vn(q * 3.0 + wob * 0.9 + vec2(uT * 0.21, uT * 0.14)) - 1.0);
    float c2 = 1.0 - abs(2.0 * vn(q * 4.1 - wob * 0.7 - vec2(uT * 0.16, -uT * 0.2) + 11.0) - 1.0);
    w *= 1.0 + pow(c1 * c2, 2.6) * 1.5 * (1.0 - 0.45 * depth);
    w += vec3(0.07, 0.10, 0.11) * smoothstep(0.52, 0.8, fbm(q * 0.8 + vec2(uT * 0.07, -uT * 0.05))) * (0.25 + lum(bed));
    float shore = smoothstep(0.2, 0.02, depth) * (0.55 + 0.45 * sin(depth * 46.0 - uT * 1.7 + fbm(q * 2.6) * 7.0));
    w += vec3(0.16, 0.18, 0.17) * shore * (0.3 + lum(bed));
    col = w; cover = m.r;
  }
  // lava: light only, on the floor as it is (it stays sharp)
  float pulse = 0.5 + 0.5 * sin(uT * 0.8 + fbm(q * 0.7) * 9.0);
  if (m.g > 0.003) {
    float e = hot(pic.rgb);
    float flick = fbm(q * 2.6 + vec2(uT * 0.11, uT * 0.42));
    float crawl = smoothstep(0.25, 0.75, fbm(q * 1.4 + vec2(uT * 0.06, -uT * 0.05))); // (the heat wanders slowly through it)
    float k = pulse * flick * (0.55 + 0.9 * crawl);
    add += (pic.rgb * e * (0.12 + 0.85 * k) + vec3(1.0, 0.42, 0.06) * e * e * 0.42 * k) * m.g;
  }
  add += vec3(1.0, 0.36, 0.06) * near * (0.10 + 0.12 * pulse) * (1.0 - 0.7 * m.g);
  // glow: light only; its rhythm from the living map
  if (gs > 0.003) {
    vec3 cm = texture(uC, vUV).rgb;
    float own = mix(0.5 + 0.5 * sin(uGT * 0.9 + fbm(q * 0.6) * 10.0), fbm(q * 1.3 + vec2(uGT * 0.12, -uGT * 0.09)), 0.35);
    float beat = 0.5 - 0.5 * cos(uGT * 1.2566); beat = beat * beat * (3.0 - 2.0 * beat);      // (in and out once in five seconds)
    float d = cm.b * uRipMax + (fbm(q * 1.1) - 0.5) * 0.35;
    float ring = pow(0.5 + 0.5 * cos(6.2832 * (d / 3.0 - uGT / 3.2)), 3.0);                   // (rings three squares apart, about a square a second)
    float r = mix(mix(own, beat, smoothstep(0.45, 0.55, cm.g)), ring, smoothstep(0.8, 0.9, cm.g));
    vec3 wide = textureLod(uPic, vUV, log2(max(1.0, 0.22 * uP))).rgb;                         // (its light a little beyond itself)
    add += (pic.rgb * shine(pic.rgb) * (0.15 + 0.95 * r) + wide * shine(wide) * (0.07 + 0.42 * r)) * gs * uGlow;
  }
  o = vec4((col * cover + add) * pic.a, cover * pic.a);
}`;
  // ---- the blades
  const BVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUV;    // along the blade 0..1, across it -1..1
layout(location = 1) in vec2 aRoot;  // where it stands, map units
layout(location = 2) in vec4 aRnd;
layout(location = 3) in vec4 aCol;   // its colour, and how long this kind of grass is (below zero: a colour of its own, see show)
uniform vec4 uMat; uniform vec2 uView, uWind;
uniform float uG, uT, uGustT, uWindS, uLen, uWide, uShow, uMaxA, uDot;
out vec3 vCol; out float vA, vLean; out vec2 vUV;
${NOISE}
void main() {
  vec2 q = aRoot / uG;
  float along = dot(q, uWind), across = dot(q, vec2(-uWind.y, uWind.x));
  float g = smoothstep(0.36, 0.66, fbm(vec2(along * 0.26 - uGustT * 0.5, across * 0.2)));       // gusts and lulls, running downwind
  float fine = vn(vec2(along * 2.4 - uGustT * 2.4, across * 1.7));
  float lean = clamp((0.04 + 0.96 * g * (0.5 + 0.5 * fine)) * uWindS * 1.25 * uShow * mix(0.7, 1.15, aRnd.x), 0.0, 1.0);
  // (Beta 3.43) grass in a colour of its own (wheat on a meadow) is a field one must always see: it never lies quite
  // unseen, as blades in the floor's own colour do when the wind drops
  float show = mix(lean, max(lean, 0.5), step(aCol.a, 0.0));
  float L = abs(aCol.a) * uLen * mix(0.7, 1.3, aRnd.y) * (0.10 + 0.90 * show);                  // stretch
  float wa = atan(uWind.y, uWind.x) + (aRnd.z - 0.5) * 0.9 + 0.32 * sin(uT * (2.2 + 2.5 * aRnd.w) + aRnd.x * 40.0) * (0.35 + 0.65 * lean); // sway
  float a0 = aRnd.z * 6.2832;                                                                    // (upright: it points anywhere)
  vec2 dir = normalize(mix(vec2(cos(a0), sin(a0)), vec2(cos(wa), sin(wa)), smoothstep(0.02, 0.45, lean)));
  float u = aUV.x; float leaf = 2.3 * pow(u, 0.4) * pow(1.0 - u, 1.1);                           // (widest near the root, a long tip)
  float w = uWide * mix(0.8, 1.25, aRnd.y) * leaf;
  float fat = max(w, 0.75 * uDot * leaf); float keep = w / max(fat, 1e-6);                      // (never under a dot and a half wide: fainter then)
  vec2 p = aRoot + dir * (u * L) + vec2(-dir.y, dir.x) * (aUV.y * fat + (aRnd.w > 0.5 ? 1.0 : -1.0) * 0.22 * L * u * u);
  vec2 c = p * uMat.x + uMat.zw;
  gl_Position = vec4(c.x / uView.x * 2.0 - 1.0, 1.0 - c.y / uView.y * 2.0, 0.0, 1.0);
  vCol = aCol.rgb * mix(0.82, 1.2, aRnd.x); vLean = lean; vUV = aUV;
  vA = (0.03 + 0.97 * smoothstep(0.04, 0.6, show)) * uMaxA * mix(1.0, keep, 0.6);                // the more wind, the more it shows
}`;
  const BFS = `#version 300 es
precision highp float;
in vec3 vCol; in float vA, vLean; in vec2 vUV; out vec4 o;
void main() {
  float a = vA * (1.0 - smoothstep(0.5, 1.0, abs(vUV.y)));
  o = vec4(vCol * mix(0.68, 1.0, vUV.x) * (1.0 + 0.38 * vLean * vUV.x) * a, a);
}`;
  const SEG = 6; // (a blade: six pieces along it)
  const TALL = 630; const SHORT = 225; const MAX = 600000; // blades a square at the most (Grass at its top; fewer where the grass thins out at a soft edge), and on a map
  const ATTRS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  const supported = () => typeof Trees === 'object' && Trees.supported();
  const image = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`picture ${url}`)); i.src = url; });

  class Layer {
    constructor(el, onChange) {
      this.el = el; this.onChange = onChange; this.dead = false; this.drawn = false; this.src = null; this.want = ''; this.time = 0; this.gustT = 0; this.n = 0; this.kinds = { water: false, lava: false, grass: false, glow: false }; this.glowT = 0;
      this.gl = el.getContext('webgl2', ATTRS);
      if (!this.gl) throw new Error('no WebGL 2 for the living tiles');
      this.lost = (e) => { e.preventDefault(); this.ok = false; };
      this.back = () => { this.start(); const w = this.wantSrc; this.want = ''; if (w) this.source(w); this.onChange(); };
      el.addEventListener('webglcontextlost', this.lost); el.addEventListener('webglcontextrestored', this.back);
      this.start();
    }
    start() {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u = {}; return { p, u: (n) => (n in u ? u[n] : (u[n] = gl.getUniformLocation(p, n))) }; };
      this.pp = prog(PVS, PFS); this.bp = prog(BVS, BFS);
      this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
      const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.tex = [null, null, null, null]; this.blades = null; this.ok = true;
    }
    // what to show: { key, pic, mask (urls), x, y, w, h (where the picture lies, map units), g (a square, map units), P (the picture's dots a square) }
    source(s) {
      this.wantSrc = s;
      if (!s) { this.want = ''; this.src = null; this.state = 'off'; return; }
      if (s.key === this.want) { if (this.src) Object.assign(this.src, { x: s.x, y: s.y, w: s.w, h: s.h, g: s.g, P: s.P }); return; }
      this.want = s.key; this.state = 'loading';
      Promise.all([image(s.pic), image(s.mask)]).then(([pic, mask]) => {
        if (this.dead || this.want !== s.key || !this.ok) return;
        try { this.load(s, pic, mask); this.state = 'ready'; } catch (err) { console.error(err); this.src = null; this.state = `failed: ${err && err.message}`; }
        this.onChange();
      }, (err) => { console.error(err); this.state = `failed: ${err && err.message}`; });
    }
    load(s, pic, mask) {
      const gl = this.gl;
      const up = (unit, img, old, mips) => {
        if (old) gl.deleteTexture(old);
        const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        return t;
      };
      // the living map's four parts (a b over c d), each a picture of its own (so that none bleeds into its neighbour)
      const W = mask.naturalWidth >> 1; const H = mask.naturalHeight >> 1;
      if (W < 1 || H < 1) throw new Error('the living map is empty');
      const part = (n) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(mask, (n % 2) * W, Math.floor(n / 2) * H, W, H, 0, 0, W, H); return { c, g }; };
      const A = part(0); const B = part(1); const C = part(2); const D = part(3);
      this.tex = [up(0, pic, this.tex[0], true), up(1, A.c, this.tex[1], true), up(2, B.c, this.tex[2], true), up(3, C.c, this.tex[3], false)];
      // read once: what kinds there are, the colours for the blades
      const md = A.g.getImageData(0, 0, W, H).data; const bd = B.g.getImageData(0, 0, W, H).data; const td = D.g.getImageData(0, 0, W, H).data;
      A.g.clearRect(0, 0, W, H); A.g.drawImage(pic, 0, 0, W, H); const pd = A.g.getImageData(0, 0, W, H).data;
      for (const x of [A, B, C, D]) x.c.width = x.c.height = 0;
      const kinds = { water: false, lava: false, grass: false, glow: false };
      for (let i = 0; i < md.length; i += 4 * 7) { if (md[i] > 40) kinds.water = true; if (md[i + 1] > 40) kinds.lava = true; if (md[i + 2] > 40) kinds.grass = true; if (bd[i] > 40) kinds.glow = true; }
      const Pm = (s.P * W) / pic.naturalWidth; // the map's dots a square
      const sqx = Math.ceil(W / Pm); const sqy = Math.ceil(H / Pm);
      let grassSq = 0; // (how many squares of grass, roughly: to stay under the most blades a map may have)
      if (kinds.grass) for (let y = 0; y < sqy; y++) for (let x = 0; x < sqx; x++) { const k = (Math.min(H - 1, Math.round((y + 0.5) * Pm)) * W + Math.min(W - 1, Math.round((x + 0.5) * Pm))) * 4; if (md[k + 2] > 40) grassSq += md[k + 2] > 190 ? 1 : SHORT / TALL; }
      const thin = Math.min(1, MAX / Math.max(1, grassSq * TALL));
      let seed = 12345; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const out = [];
      if (kinds.grass) for (let sy = 0; sy < sqy; sy++) for (let sx = 0; sx < sqx; sx++) {
        const kc = (Math.min(H - 1, Math.round((sy + 0.5) * Pm)) * W + Math.min(W - 1, Math.round((sx + 0.5) * Pm))) * 4;
        // (a square without grass at its middle and corners is skipped quickly)
        const probe = (fx, fy) => md[(Math.min(H - 1, Math.max(0, Math.round((sy + fy) * Pm))) * W + Math.min(W - 1, Math.max(0, Math.round((sx + fx) * Pm)))) * 4 + 2] > 40;
        if (!(md[kc + 2] > 40 || probe(0.1, 0.1) || probe(0.9, 0.1) || probe(0.1, 0.9) || probe(0.9, 0.9))) continue;
        const n = Math.round(TALL * thin);
        for (let i = 0; i < n; i++) {
          const fx = sx + rnd(); const fy = sy + rnd(); const r0 = rnd(); const r1 = rnd(); const r2 = rnd(); const r3 = rnd();
          const x = Math.min(W - 2, Math.max(1, Math.round(fx * Pm))); const y = Math.min(H - 2, Math.max(1, Math.round(fy * Pm))); const k = (y * W + x) * 4;
          const b = md[k + 2]; if (b < 40 || md[k] > 8 || md[k + 1] > 8 || pd[k + 3] < 128) continue; // (grass, and a floor under it: none in the void)
          const len = b / 255; if (len < 0.75 && i >= n * (SHORT / TALL)) continue; // (short grass: fewer)
          let cr = 0; let cg = 0; let cb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = ((y + dy) * W + x + dx) * 4; cr += pd[j]; cg += pd[j + 1]; cb += pd[j + 2]; }
          cr /= 2295; cg /= 2295; cb /= 2295;
          // (Beta 3.43) its colour: the floor's under it, or the one picked for this grass, lighter and darker with the floor
          const own = td[k] + td[k + 1] + td[k + 2] > 24;
          if (own) { const l = 0.55 + 0.9 * (cr * 0.3 + cg * 0.59 + cb * 0.11); cr = (td[k] / 255) * l; cg = (td[k + 1] / 255) * l; cb = (td[k + 2] / 255) * l; } else { cr *= 1.1; cg *= 1.12; cb *= 1.05; }
          out.push(s.x + (fx / sqx) * (sqx * Pm / W) * s.w, s.y + (fy / sqy) * (sqy * Pm / H) * s.h, r0, r1, r2, r3, Math.min(1, cr), Math.min(1, cg), Math.min(1, cb), own ? -len : len);
        }
      }
      // (in no order, so that drawing fewer of them thins the grass evenly)
      const N = out.length / 10; const arr = new Float32Array(out);
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); for (let c = 0; c < 10; c++) { const t = arr[i * 10 + c]; arr[i * 10 + c] = arr[j * 10 + c]; arr[j * 10 + c] = t; } }
      if (this.blades) { gl.deleteVertexArray(this.blades.vao); gl.deleteBuffer(this.blades.vb); gl.deleteBuffer(this.blades.ib); }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const strip = []; for (let i = 0; i <= SEG; i++) strip.push(i / SEG, -1, i / SEG, 1);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const at = (l, n, o) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 40, o); gl.vertexAttribDivisor(l, 1); };
      at(1, 2, 0); at(2, 4, 8); at(3, 4, 24);
      gl.bindVertexArray(null);
      this.blades = { vao, vb, ib, n: N };
      this.kinds = kinds; this.n = N;
      this.src = { ...s, pw: pic.naturalWidth, ph: pic.naturalHeight, Pm };
    }
    // one frame. wind: { dir (degrees, where it blows to), strength }; matrix [k, e, f]: map units → canvas dots;
    // set: { amount, length, breeze } each about 1; few: fewer blades (Effects quality Low)
    frame({ dt, wind, matrix, set, few }) {
      const gl = this.gl; const s = this.src;
      if (!this.ok || gl.isContextLost()) return false;
      const storm = Math.min(1, Math.max(0, ((wind.strength || 0) - 1) / 1.5));
      this.time += dt; this.gustT += dt * (1 + 0.7 * storm); this.glowT += dt * Math.min(3, Math.max(0.2, set.speed ?? 1));
      gl.viewport(0, 0, this.el.width, this.el.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawn = true;
      if (!s) return false;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (let i = 0; i < 4; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[i]); }
      const [k, e, f] = matrix; const a = ((wind.dir || 0) * Math.PI) / 180;
      if (this.kinds.water || this.kinds.lava || this.kinds.glow) {
        const P = this.pp; gl.useProgram(P.p); gl.bindVertexArray(this.quad);
        gl.uniform4f(P.u('uRect'), s.x, s.y, s.w, s.h); gl.uniform4f(P.u('uMat'), k, 0, e, f); gl.uniform2f(P.u('uView'), this.el.width, this.el.height);
        gl.uniform1f(P.u('uG'), s.g); gl.uniform1i(P.u('uPic'), 0); gl.uniform1i(P.u('uA'), 1); gl.uniform1i(P.u('uB'), 2); gl.uniform1i(P.u('uC'), 3); gl.uniform2f(P.u('uPicSize'), s.pw, s.ph);
        gl.uniform1f(P.u('uP'), s.P); gl.uniform1f(P.u('uPm'), s.Pm); gl.uniform1f(P.u('uT'), this.time); gl.uniform1f(P.u('uGT'), this.glowT);
        gl.uniform1f(P.u('uGlow'), Math.min(2, Math.max(0, set.glow ?? 1))); gl.uniform1f(P.u('uRipMax'), s.ripMax || 16);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      let shown = 0;
      if (this.kinds.grass && this.blades && this.blades.n) {
        const B = this.bp; gl.useProgram(B.p); gl.bindVertexArray(this.blades.vao);
        const amount = Math.min(1.5, Math.max(0, set.amount ?? 1)) / 1.5;
        shown = Math.round(this.blades.n * amount * (few ? 0.5 : 1));
        gl.uniform4f(B.u('uMat'), k, 0, e, f); gl.uniform2f(B.u('uView'), this.el.width, this.el.height); gl.uniform2f(B.u('uWind'), Math.cos(a), Math.sin(a));
        gl.uniform1f(B.u('uG'), s.g); gl.uniform1f(B.u('uT'), this.time); gl.uniform1f(B.u('uGustT'), this.gustT); gl.uniform1f(B.u('uWindS'), wind.strength || 0);
        gl.uniform1f(B.u('uLen'), 0.3 * s.g * Math.min(3, Math.max(0.2, set.length ?? 1))); gl.uniform1f(B.u('uWide'), 0.013 * s.g);
        gl.uniform1f(B.u('uShow'), Math.min(3, Math.max(0.2, set.breeze ?? 1))); gl.uniform1f(B.u('uMaxA'), 0.8); gl.uniform1f(B.u('uDot'), 1 / k);
        if (shown) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, shown);
      }
      gl.bindVertexArray(null); gl.disable(gl.BLEND);
      this.shown = shown;
      return true;
    }
    clear() {
      if (!this.drawn || !this.ok || this.gl.isContextLost()) return;
      this.gl.viewport(0, 0, this.el.width, this.el.height); this.gl.clearColor(0, 0, 0, 0); this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.drawn = false;
    }
    // the colour at a canvas dot, right after frame() (the self-test)
    read(x, y) { const px = new Uint8Array(4); try { this.gl.readPixels(Math.round(x), Math.round(this.el.height - 1 - y), 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px); } catch { return null; } return [...px]; }
    destroy() { this.dead = true; this.el.removeEventListener('webglcontextlost', this.lost); this.el.removeEventListener('webglcontextrestored', this.back); const x = this.gl.getExtension('WEBGL_lose_context'); if (x) try { x.loseContext(); } catch { /* */ } }
  }
  // null where it cannot be drawn (the map then shows as it is)
  function layer(el, onChange) { if (!supported()) return null; try { return new Layer(el, onChange); } catch (err) { console.error(err); return null; } }
  return { supported, layer };
})();
