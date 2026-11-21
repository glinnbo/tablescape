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
 * Beta 3.58 (Glinn): grass painted in Effects → Paint grows the same blades on any map, a picture map too. paint()
 * draws its strokes into a living map of the same kind here, in the window (no bake); on an Oldschool map over the
 * baked one.
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
uniform sampler2D uPic, uA, uB, uC, uD;
uniform vec4 uRect; uniform float uG;
uniform vec2 uPicSize;   // the picture, in dots
uniform float uP, uPm;   // dots a square: of the picture, of the living map
uniform float uT, uRipMax;
uniform vec2 uWind;      // where the wind blows to, times its strength
// (Beta 3.46) each kind of effect has its own settings (the cards in Draw)
uniform vec2 uWater;     // how clear (0 dyed … 1 almost clear), its own time
uniform vec4 uLava;      // glow, embers, heat, pick-up range
uniform float uLavaT;
uniform vec3 uGPow, uGTime, uGRange; // shimmer, pulse, ripple: intensity, its own time, pick-up range
in vec2 vUV; in vec2 vQ; out vec4 o;
${NOISE}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float max3(vec3 c) { return max(c.r, max(c.g, c.b)); }
// how red-hot a colour is; the range: how much of the floor counts (0.5 as it always was)
float hot(vec3 c, float range) { return clamp((c.r - 1.25 * c.b - mix(0.38, 0.02, range)) * 2.4, 0.0, 1.0); }
// how much a colour is one that shines: bright and saturated (any hue), or very bright
float shine(vec3 c, float range) {
  float mx = max3(c); float mn = min(c.r, min(c.g, c.b)); float sat = (mx - mn) / max(mx, 0.001);
  float s0 = mix(0.56, 0.08, range); float b0 = mix(0.58, 0.10, range);
  return max(smoothstep(s0, s0 + 0.36, sat) * smoothstep(b0, b0 + 0.38, mx), 0.7 * smoothstep(mix(0.92, 0.68, range), 0.97, mx));
}
// embers: sparks that leave the hot places and drift with the wind, each alive for a moment
vec3 embers(vec2 q, float t, float range) {
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 2; L++) {
    float cs = L == 0 ? 0.5 : 0.31; float fl = float(L);
    vec2 id0 = floor(q / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(float(i), float(j));
      float r1 = hash(id + fl * 17.0), r2 = hash(id * 1.7 + 3.1 + fl), r3 = hash(id * 2.3 + 9.7);
      float life = 1.5 + 2.4 * r3;
      float clock = t / life + r1; float ph = fract(clock); float gen = floor(clock);
      vec2 rr = vec2(hash(id + gen * 0.37 + fl), hash(id * 1.3 + gen * 0.71));
      vec2 p0 = (id + 0.15 + 0.7 * rr) * cs;                                      // where it leaves the lava
      vec2 way = uWind * (0.35 + 0.5 * rr.y) + (rr - 0.5) * 0.55;                   // downwind, and a little anywhere
      vec2 p = p0 + way * ph * (0.5 + 0.9 * r2) + vec2(sin(ph * 9.0 + r2 * 6.28), cos(ph * 7.0 + r1 * 6.28)) * 0.035;
      float size = 0.05 * (0.6 + 0.8 * r1) * (1.0 - 0.5 * ph); float dq = length(q - p);
      float sp = (smoothstep(size, 0.0, dq) + 0.3 * smoothstep(size * 3.2, 0.0, dq)) * smoothstep(0.0, 0.07, ph) * (1.0 - ph) * (1.0 - ph) * step(0.25, r2); // (a bright core and a little glow round it)
      if (sp > 0.002) {
        vec2 ub = (p0 * uG - uRect.xy) / uRect.zw;
        float hb = hot(textureLod(uPic, ub, log2(max(1.0, 0.1 * uP))).rgb, range) * textureLod(uA, ub, 1.0).g;
        acc += mix(vec3(1.0, 0.45, 0.10), vec3(1.0, 0.85, 0.45), (1.0 - ph) * r1) * sp * smoothstep(0.08, 0.5, hb) * 2.0;
      }
    }
  }
  return acc;
}
void main() {
  vec4 m = texture(uA, vUV);
  float near = textureLod(uA, vUV, log2(max(1.0, 0.9 * uPm))).g; // (lava near here)
  float gs = texture(uB, vUV).r;
  if (m.r + m.g + near + gs < 0.004) discard;
  vec4 pic = texture(uPic, vUV);
  vec3 col = pic.rgb; vec2 q = vQ; vec2 px = vUV * uPicSize;
  float cover = 0.0; float dark = 0.0; vec3 add = vec3(0.0);
  if (m.r > 0.003) { // water: the bed drawn again, moving
    float t = uWater.y;
    float depth = smoothstep(0.5, 1.0, textureLod(uA, vUV, log2(max(1.0, 0.6 * uPm))).r); // (far from the bank)
    vec2 wob = vec2(fbm(q * 2.2 + vec2(t * 0.33, t * 0.26)) - 0.5, fbm(q * 2.2 + vec2(-t * 0.29, t * 0.38) + 7.3) - 0.5);
    vec2 off = wob * (0.05 + 0.08 * depth) * uP;
    float there = texture(uA, (px + off) / uPicSize).r;
    vec3 bed = mix(col, texture(uPic, (px + off) / uPicSize).rgb, there);
    // its colour: the one picked for this water, or the usual teal; the picked one mostly as a hue (a dark colour
    // gives a darker water, but not a black one)
    vec3 C = texture(uD, vUV).rgb;
    C = C.r + C.g + C.b < 0.09 ? vec3(0.34, 0.60, 0.66) : mix(C / max(max3(C), 0.05) * 0.66, C, 0.35);
    vec3 w = bed * mix(mix(vec3(1.0), C, 0.3), C, depth);
    w = mix(w, C * 0.35 * (0.4 + lum(bed)), 0.22 * depth);
    w = mix(bed, w, 1.0 - 0.92 * uWater.x);                                      // (how clear it is)
    float c1 = 1.0 - abs(2.0 * vn(q * 3.0 + wob * 0.9 + vec2(t * 0.21, t * 0.14)) - 1.0);
    float c2 = 1.0 - abs(2.0 * vn(q * 4.1 - wob * 0.7 - vec2(t * 0.16, -t * 0.2) + 11.0) - 1.0);
    w *= 1.0 + pow(c1 * c2, 2.6) * 1.5 * (1.0 - 0.45 * depth);
    w += vec3(0.07, 0.10, 0.11) * smoothstep(0.52, 0.8, fbm(q * 0.8 + vec2(t * 0.07, -t * 0.05))) * (0.25 + lum(bed));
    float shore = smoothstep(0.2, 0.02, depth) * (0.55 + 0.45 * sin(depth * 46.0 - t * 1.7 + fbm(q * 2.6) * 7.0));
    w += vec3(0.16, 0.18, 0.17) * shore * (0.3 + lum(bed));
    col = w; cover = m.r;
  }
  // lava: light only, on the floor as it is (it stays sharp)
  float lt = uLavaT;
  float pulse = 0.5 + 0.5 * sin(lt * 0.8 + fbm(q * 0.7) * 9.0);
  if (m.g > 0.003) {
    float e = hot(pic.rgb, uLava.w);
    float bright = smoothstep(0.3, 0.95, max3(pic.rgb));                           // (the brighter the floor, the more it glows)
    float flick = fbm(q * 2.6 + vec2(lt * 0.11, lt * 0.42));
    float crawl = smoothstep(0.25, 0.75, fbm(q * 1.4 + vec2(lt * 0.06, -lt * 0.05))); // (the heat wanders slowly through it)
    float k = pulse * flick * (0.55 + 0.9 * crawl);
    vec3 g1 = pic.rgb * e * (0.12 + 0.85 * k) + vec3(1.0, 0.42, 0.06) * e * e * 0.42 * k;
    g1 += vec3(1.0, 0.58, 0.16) * e * bright * bright * (0.30 + 0.55 * k);        // white-hot where the floor is bright
    vec3 wide = textureLod(uPic, vUV, log2(max(1.0, 0.3 * uP))).rgb; float we = hot(wide, uLava.w);
    g1 += vec3(1.0, 0.40, 0.08) * we * (0.14 + 0.22 * pulse);                     // its light spills from the hot parts
    add += g1 * m.g * uLava.x;
    // heat: a shimmer of light running over it. The floor is not bent (that would draw it again, softer)
    float hz = fbm(vec2(q.x * 5.0 + sin(q.y * 3.1 + lt * 1.3) * 0.45, q.y * 2.3 - lt * 0.9)) - 0.5;
    float hk = uLava.z * m.g * (0.25 + 0.75 * max(e, we));
    add += pic.rgb * max(hz, 0.0) * 0.6 * hk; dark += max(-hz, 0.0) * 0.4 * hk;
  }
  add += vec3(1.0, 0.36, 0.06) * near * (0.10 + 0.12 * pulse) * (1.0 - 0.7 * m.g) * uLava.x;
  if (near > 0.01 && uLava.y > 0.0) add += embers(q, lt, uLava.w) * uLava.y * smoothstep(0.01, 0.12, near);
  // shimmer, pulse, ripple: light only; which of them from the living map
  if (gs > 0.003) {
    vec3 cm = texture(uC, vUV).rgb;
    float wP = smoothstep(0.45, 0.55, cm.g); float wR = smoothstep(0.8, 0.9, cm.g);
    vec3 w3 = vec3(1.0 - wP, wP - wR, wR);
    float own = mix(0.5 + 0.5 * sin(uGTime.x * 0.9 + fbm(q * 0.6) * 10.0), fbm(q * 1.3 + vec2(uGTime.x * 0.12, -uGTime.x * 0.09)), 0.35);
    float beat = 0.5 - 0.5 * cos(uGTime.y * 1.2566); beat = beat * beat * (3.0 - 2.0 * beat); // (in and out once in five seconds)
    float d = cm.b * uRipMax + (fbm(q * 1.1) - 0.5) * 0.35;
    float ring = pow(0.5 + 0.5 * cos(6.2832 * (d / 3.0 - uGTime.z / 3.2)), 3.0);              // (rings three squares apart, about a square a second)
    float r = dot(w3, vec3(own, beat, ring)); float pw = dot(w3, uGPow); float rg = dot(w3, uGRange);
    vec3 wide = textureLod(uPic, vUV, log2(max(1.0, 0.22 * uP))).rgb;                         // (its light a little beyond itself)
    add += (pic.rgb * shine(pic.rgb, rg) * (0.15 + 0.95 * r) + wide * shine(wide, rg) * (0.07 + 0.42 * r)) * gs * pw;
  }
  float a = max(cover, dark * (1.0 - cover));
  o = vec4((col * cover + add) * pic.a, a * pic.a);
}`;
  // ---- the blades
  const BVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUV;    // along the blade 0..1, across it -1..1
layout(location = 1) in vec2 aRoot;  // where it stands, map units
layout(location = 2) in vec4 aRnd;
layout(location = 3) in vec4 aCol;   // its colour, and how long this kind of grass is (below zero: a colour of its own, see show)
uniform vec4 uMat; uniform vec2 uView, uWind;
uniform float uG, uT, uGustT, uWindS, uLen, uWide, uCalm, uVary, uMaxA, uDot;
out vec3 vCol; out float vA, vLean; out vec2 vUV;
${NOISE}
void main() {
  vec2 q = aRoot / uG;
  float along = dot(q, uWind), across = dot(q, vec2(-uWind.y, uWind.x));
  float g = smoothstep(0.36, 0.66, fbm(vec2(along * 0.26 - uGustT * 0.5, across * 0.2)));       // gusts and lulls, running downwind
  float fine = vn(vec2(along * 2.4 - uGustT * 2.4, across * 1.7));
  float gust = (0.04 + 0.96 * g * (0.5 + 0.5 * fine)) * uWindS * 1.25 * mix(0.7, 1.15, aRnd.x);
  // (Beta 3.46) between the gusts the grass does not vanish: some blades stay up a little, more of them in a
  // stronger wind (Glinn: nothing at all between the gusts is too hard a contrast)
  float calm = uCalm * clamp(uWindS / 1.5, 0.25, 1.0) * mix(0.3, 1.0, aRnd.w);
  float lean = clamp(max(gust, calm), 0.0, 1.0);
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
  vCol = aCol.rgb * mix(1.0 - 0.6 * uVary, 1.0 + 0.6 * uVary, aRnd.x) * mix(vec3(1.0), vec3(1.14, 1.0, 0.78), (aRnd.z - 0.5) * 1.6 * uVary); vLean = lean; vUV = aUV; // (Colour variety: lighter and darker, yellower and bluer)
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
  const sizeOf = (x) => [x.naturalWidth || x.videoWidth || x.width || 0, x.naturalHeight || x.videoHeight || x.height || 0]; // (a picture, a video or a canvas)
  // a picture or video on the page, once it can be drawn
  const ready = (el) => new Promise((res, rej) => {
    if (!el) { rej(new Error('no map picture')); return; }
    const ok = () => (el.tagName === 'VIDEO' ? el.readyState >= 2 && el.videoWidth > 0 : el.complete && el.naturalWidth > 0);
    if (ok()) { res(el); return; }
    const done = () => { clearTimeout(t); el.removeEventListener('load', done); el.removeEventListener('loadeddata', done); if (ok()) res(el); else rej(new Error('the map picture did not load')); };
    const t = setTimeout(done, 10000);
    el.addEventListener('load', done); el.addEventListener('loadeddata', done);
  });
  const plane = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d', { willReadFrequently: true }) }; };
  // Beta 3.58: the grass areas painted in Effects → Paint as a living map (a b over c d, as oldschool.js bakes it):
  // a = blue where the grass stands (its edge soft, so the blades thin out and get shorter there), d = the colour picked
  // for an area (black: the map's own colour under it). Every area is drawn on its own first, so that its Erase strokes
  // take away only its own grass.
  //   o: { pic (the map picture: a url, or an img or video on the page), baked (an Oldschool map's living map: a url,
  //        or null), regions [{ strokes, color }], x, y, w, h (where the picture lies, map units), g (a square), P }
  // → a promise of { pic, mask, P } (P: the picture's dots a square)
  async function paint(o) {
    if (!(typeof FX === 'object' && FX.drawStrokes)) throw new Error('no painted strokes');
    let pic; let P = o.P; let W; let H; let base = null;
    if (o.baked) {
      [pic, base] = await Promise.all([typeof o.pic === 'string' ? image(o.pic) : ready(o.pic), image(o.baked)]);
      W = base.naturalWidth >> 1; H = base.naturalHeight >> 1;
    } else {
      const src = typeof o.pic === 'string' ? await image(o.pic) : await ready(o.pic);
      const sqx = o.w / o.g; const sqy = o.h / o.g;
      const Pm = Math.max(4, Math.min(24, 2048 / Math.max(1, sqx), 2048 / Math.max(1, sqy))); // (dots a square: enough for blades, at most 2048 across)
      W = Math.max(8, Math.round(sqx * Pm)); H = Math.max(8, Math.round(sqy * Pm));
      const small = plane(W, H); small.g.drawImage(src, 0, 0, W, H); pic = small.c; P = W / sqx;
    }
    if (W < 1 || H < 1) throw new Error('the living map is empty');
    const M = plane(W * 2, H * 2); M.g.fillStyle = '#000'; M.g.fillRect(0, 0, W * 2, H * 2);
    if (base) M.g.drawImage(base, 0, 0);
    const k = W / o.w; const soft = 0.35 * o.g; const one = plane(W, H);
    const draw = (f, col, blur) => {
      const g = one.g;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, W, H);
      g.filter = blur ? `blur(${Math.max(0.5, soft * k).toFixed(1)}px)` : 'none';
      g.setTransform(k, 0, 0, k, -o.x * k, -o.y * k);
      g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
      FX.drawStrokes(g, f.strokes || [], blur ? -soft * 0.5 : 0);
      g.filter = 'none'; g.setTransform(1, 0, 0, 1, 0, 0);
    };
    for (const f of o.regions || []) {
      draw(f, '#0000ff', true); M.g.globalCompositeOperation = 'lighter'; M.g.drawImage(one.c, 0, 0);
      draw(f, /^#[0-9a-f]{6}$/i.test(String(f.color || '')) ? f.color : '#000000', false); M.g.globalCompositeOperation = 'source-over'; M.g.drawImage(one.c, W, H);
    }
    M.g.globalCompositeOperation = 'source-over';
    one.c.width = one.c.height = 0;
    return { pic, mask: M.c, P };
  }

  class Layer {
    constructor(el, onChange) {
      this.el = el; this.onChange = onChange; this.dead = false; this.drawn = false; this.src = null; this.want = ''; this.time = 0; this.gustT = 0; this.n = 0; this.kinds = { water: false, lava: false, grass: false, glow: false };
      this.clock = { water: 0, lava: 0, shimmer: 0, pulse: 0, ripple: 0 }; this.data = null; this.growKey = ''; this.growAt = 0; // (Beta 3.46: each effect at its own speed; the grass grown by its card's rule)
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
      this.tex = [null, null, null, null, null]; this.blades = null; this.ok = true; this.growKey = '';
    }
    // what to show: { key, pic, mask (urls), x, y, w, h (where the picture lies, map units), g (a square, map units), P (the picture's dots a square) }
    // (Beta 3.58) or { key, make, x, y, w, h, g, P }: make() gives a promise of { pic, mask, P } (paint(): painted grass)
    source(s) {
      this.wantSrc = s;
      if (!s) { this.want = ''; this.src = null; this.state = 'off'; return; }
      if (s.key === this.want) { if (this.src && !s.make) Object.assign(this.src, { x: s.x, y: s.y, w: s.w, h: s.h, g: s.g, P: s.P }); return; }
      this.want = s.key; this.state = 'loading';
      const got = s.make ? s.make() : Promise.all([image(s.pic), image(s.mask)]).then(([pic, mask]) => ({ pic, mask, P: s.P }));
      got.then(({ pic, mask, P }) => {
        if (this.dead || this.want !== s.key || !this.ok) return;
        try { this.load({ ...s, P }, pic, mask); this.state = 'ready'; } catch (err) { console.error(err); this.src = null; this.state = `failed: ${err && err.message}`; }
        this.onChange();
      }, (err) => {
        console.error(err); this.state = `failed: ${err && err.message}`;
        if (s.make) setTimeout(() => { if (this.want === s.key) this.want = ''; }, 3000); // (a video not playing yet: try again)
      });
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
      const [mw, mh] = sizeOf(mask); const [pw, ph] = sizeOf(pic);
      const W = mw >> 1; const H = mh >> 1;
      if (W < 1 || H < 1) throw new Error('the living map is empty');
      const part = (n) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(mask, (n % 2) * W, Math.floor(n / 2) * H, W, H, 0, 0, W, H); return { c, g }; };
      const A = part(0); const B = part(1); const C = part(2); const D = part(3);
      this.tex = [up(0, pic, this.tex[0], true), up(1, A.c, this.tex[1], true), up(2, B.c, this.tex[2], true), up(3, C.c, this.tex[3], false), up(4, D.c, this.tex[4], false)];
      // read once: what kinds there are; kept for the blades (they are grown again when the grass's rule changes)
      const md = A.g.getImageData(0, 0, W, H).data; const bd = B.g.getImageData(0, 0, W, H).data; const td = D.g.getImageData(0, 0, W, H).data;
      A.g.clearRect(0, 0, W, H); A.g.drawImage(pic, 0, 0, W, H); const pd = A.g.getImageData(0, 0, W, H).data;
      for (const x of [A, B, C, D]) x.c.width = x.c.height = 0;
      const kinds = { water: false, lava: false, grass: false, glow: false };
      for (let i = 0; i < md.length; i += 4 * 7) { if (md[i] > 40) kinds.water = true; if (md[i + 1] > 40) kinds.lava = true; if (md[i + 2] > 40) kinds.grass = true; if (bd[i] > 40) kinds.glow = true; }
      const Pm = (s.P * W) / pw; // the map's dots a square
      this.kinds = kinds;
      this.src = { ...s, pw, ph, Pm };
      this.data = kinds.grass ? { W, H, md, pd, td, Pm } : null;
      this.growKey = ''; this.grow(this.lastGrass || {});
    }
    // The blades. Where they stand and how long they are follows the grass card's "Grows on" (Beta 3.46, Glinn):
    //   all     everywhere the effect was drawn
    //   bright  most and longest where the floor is brightest, least where it is darkest (measured near by, so each
    //           tile is judged against itself)
    //   dark    the other way round
    //   colour  where the floor is close to a colour picked from it (Range: how close)
    grow(G) {
      const gl = this.gl; const s = this.src; const D = this.data;
      const rule = ['bright', 'dark', 'colour'].includes(G.grow) ? G.grow : 'all';
      this.growKey = `${rule}|${rule === 'colour' ? `${G.growColor}|${G.range}` : ''}`; this.growAt = performance.now();
      if (this.blades) { gl.deleteVertexArray(this.blades.vao); gl.deleteBuffer(this.blades.vb); gl.deleteBuffer(this.blades.ib); this.blades = null; }
      this.n = 0;
      if (!D || !s) return;
      const { W, H, md, pd, td, Pm } = D;
      const sqx = Math.ceil(W / Pm); const sqy = Math.ceil(H / Pm);
      const lumAt = (k) => (pd[k] * 0.3 + pd[k + 1] * 0.59 + pd[k + 2] * 0.11) / 255;
      // bright / dark: the darkest and brightest of the floor under the grass, in fields of three squares
      const CELL = 3; const cx = Math.ceil(sqx / CELL) + 1; const cy = Math.ceil(sqy / CELL) + 1; let lo = null; let hi = null;
      if (rule === 'bright' || rule === 'dark') {
        lo = new Float32Array(cx * cy).fill(-1); hi = new Float32Array(cx * cy);
        const step = Math.max(1, Math.round(Pm / 10)); const hist = new Uint32Array(32);
        for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
          hist.fill(0); let n = 0;
          const x0 = Math.max(0, Math.round((i - 0.5) * CELL * Pm)); const x1 = Math.min(W, Math.round((i + 0.5) * CELL * Pm)); const y0 = Math.max(0, Math.round((j - 0.5) * CELL * Pm)); const y1 = Math.min(H, Math.round((j + 0.5) * CELL * Pm));
          for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const k = (y * W + x) * 4; if (md[k + 2] > 40 && pd[k + 3] > 128) { hist[Math.min(31, Math.floor(lumAt(k) * 32))]++; n++; } }
          if (n < 12) continue;
          let a = 0; let c = 0; while (a < 31 && c + hist[a] < n * 0.08) c += hist[a++];
          let b = 31; c = 0; while (b > 0 && c + hist[b] < n * 0.08) c += hist[b--];
          lo[j * cx + i] = a / 32; hi[j * cx + i] = (b + 1) / 32;
        }
      }
      const span = (fx, fy) => { // (the darkest and brightest near a spot, between the fields around it)
        const u = fx / CELL; const v = fy / CELL; const i0 = Math.floor(u); const j0 = Math.floor(v); let a = 0; let b = 0; let wsum = 0;
        for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
          const i = Math.min(cx - 1, i0 + di); const j = Math.min(cy - 1, j0 + dj); const q = j * cx + i; if (lo[q] < 0) continue;
          const w = (di ? u - i0 : 1 - (u - i0)) * (dj ? v - j0 : 1 - (v - j0)) + 1e-3; a += lo[q] * w; b += hi[q] * w; wsum += w;
        }
        return wsum ? [a / wsum, b / wsum] : [0, 1];
      };
      const hex = /^#[0-9a-f]{6}$/.test(String(G.growColor || '')) ? G.growColor : '#5c8a34';
      const tc = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
      const range = Math.min(1, Math.max(0.05, Number(G.range) || 0.5));
      let grassSq = 0; // (how many squares of grass, roughly: to stay under the most blades a map may have)
      for (let y = 0; y < sqy; y++) for (let x = 0; x < sqx; x++) { const k = (Math.min(H - 1, Math.round((y + 0.5) * Pm)) * W + Math.min(W - 1, Math.round((x + 0.5) * Pm))) * 4; if (md[k + 2] > 40) grassSq += md[k + 2] > 190 ? 1 : SHORT / TALL; }
      const thin = Math.min(1, MAX / Math.max(1, grassSq * TALL));
      let seed = 12345; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const out = [];
      for (let sy = 0; sy < sqy; sy++) for (let sx = 0; sx < sqx; sx++) {
        const kc = (Math.min(H - 1, Math.round((sy + 0.5) * Pm)) * W + Math.min(W - 1, Math.round((sx + 0.5) * Pm))) * 4;
        // (a square without grass at its middle and corners is skipped quickly)
        const probe = (fx, fy) => md[(Math.min(H - 1, Math.max(0, Math.round((sy + fy) * Pm))) * W + Math.min(W - 1, Math.max(0, Math.round((sx + fx) * Pm)))) * 4 + 2] > 40;
        if (!(md[kc + 2] > 40 || probe(0.1, 0.1) || probe(0.9, 0.1) || probe(0.1, 0.9) || probe(0.9, 0.9))) continue;
        const n = Math.round(TALL * thin);
        for (let i = 0; i < n; i++) {
          const fx = sx + rnd(); const fy = sy + rnd(); const r0 = rnd(); const r1 = rnd(); const r2 = rnd(); const r3 = rnd(); const r4 = rnd();
          const x = Math.min(W - 2, Math.max(1, Math.round(fx * Pm))); const y = Math.min(H - 2, Math.max(1, Math.round(fy * Pm))); const k = (y * W + x) * 4;
          const b = md[k + 2]; if (b < 40 || md[k] > 8 || md[k + 1] > 8 || pd[k + 3] < 128) continue; // (grass, and a floor under it: none in the void)
          let len = b / 255; if (len < 0.75 && i >= n * (SHORT / TALL)) continue; // (short grass: fewer)
          let cr = 0; let cg = 0; let cb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = ((y + dy) * W + x + dx) * 4; cr += pd[j]; cg += pd[j + 1]; cb += pd[j + 2]; }
          cr /= 2295; cg /= 2295; cb /= 2295;
          // where the grass's rule wants it: most and longest where it fits best, a little even where it fits least
          let fit = 1;
          if (rule === 'bright' || rule === 'dark') { const [a, z] = span(fx, fy); const t = Math.min(1, Math.max(0, (cr * 0.3 + cg * 0.59 + cb * 0.11 - a) / Math.max(0.05, z - a))); fit = rule === 'bright' ? t : 1 - t; }
          else if (rule === 'colour') { const d = Math.sqrt(0.3 * (cr - tc[0]) ** 2 + 0.59 * (cg - tc[1]) ** 2 + 0.11 * (cb - tc[2]) ** 2); const t = Math.min(1, Math.max(0, (d - 0.3 * range) / (0.3 * range))); fit = 1 - t * t * (3 - 2 * t); }
          if (rule !== 'all') { if (r4 > 0.05 + 0.95 * fit * fit) continue; len *= 0.4 + 0.6 * fit; }
          // its colour: the floor's under it, or the one picked for this grass, lighter and darker with the floor
          const own = td[k] + td[k + 1] + td[k + 2] > 24;
          if (own) { const l = 0.55 + 0.9 * (cr * 0.3 + cg * 0.59 + cb * 0.11); cr = (td[k] / 255) * l; cg = (td[k + 1] / 255) * l; cb = (td[k + 2] / 255) * l; } else { cr *= 1.1; cg *= 1.12; cb *= 1.05; }
          out.push(s.x + (fx / sqx) * (sqx * Pm / W) * s.w, s.y + (fy / sqy) * (sqy * Pm / H) * s.h, r0, r1, r2, r3, Math.min(1, cr), Math.min(1, cg), Math.min(1, cb), own ? -len : len);
        }
      }
      // (in no order, so that drawing fewer of them thins the grass evenly)
      const N = out.length / 10; const arr = new Float32Array(out);
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); for (let c = 0; c < 10; c++) { const t = arr[i * 10 + c]; arr[i * 10 + c] = arr[j * 10 + c]; arr[j * 10 + c] = t; } }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const strip = []; for (let i = 0; i <= SEG; i++) strip.push(i / SEG, -1, i / SEG, 1);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const at = (l, n, o) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 40, o); gl.vertexAttribDivisor(l, 1); };
      at(1, 2, 0); at(2, 4, 8); at(3, 4, 24);
      gl.bindVertexArray(null);
      this.blades = { vao, vb, ib, n: N };
      this.n = N;
    }
    // one frame. wind: { dir (degrees, where it blows to), strength }; matrix [k, e, f]: map units → canvas dots;
    // set: the map's settings for what moves (map.live: grass, water, lava, shimmer, pulse, ripple); few: fewer
    // blades (Effects quality Low)
    frame({ dt, wind, matrix, set, few }) {
      const gl = this.gl; const s = this.src;
      if (!this.ok || gl.isContextLost()) return false;
      const S = set || {}; const num = (o, k, d, a, b) => { const v = o && Number(o[k]); return Number.isFinite(v) && o[k] != null ? Math.min(b, Math.max(a, v)) : d; };
      const G = S.grass || {}; const Wt = S.water || {}; const Lv = S.lava || {};
      const storm = Math.min(1, Math.max(0, ((wind.strength || 0) - 1) / 1.5));
      this.time += dt; this.gustT += dt * (1 + 0.7 * storm);
      for (const fx of ['water', 'lava', 'shimmer', 'pulse', 'ripple']) this.clock[fx] += dt * num(S[fx], 'speed', 1, 0.2, 3);
      // the grass's rule changed: it grows again (not at every step of a slider)
      this.lastGrass = G;
      if (s && this.data) { const rule = ['bright', 'dark', 'colour'].includes(G.grow) ? G.grow : 'all'; const key = `${rule}|${rule === 'colour' ? `${G.growColor}|${G.range}` : ''}`; if (key !== this.growKey && performance.now() - this.growAt > 250) this.grow(G); }
      gl.viewport(0, 0, this.el.width, this.el.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawn = true;
      if (!s) return false;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (let i = 0; i < 5; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[i]); }
      const [k, e, f] = matrix; const a = ((wind.dir || 0) * Math.PI) / 180;
      if (this.kinds.water || this.kinds.lava || this.kinds.glow) {
        const P = this.pp; gl.useProgram(P.p); gl.bindVertexArray(this.quad);
        gl.uniform4f(P.u('uRect'), s.x, s.y, s.w, s.h); gl.uniform4f(P.u('uMat'), k, 0, e, f); gl.uniform2f(P.u('uView'), this.el.width, this.el.height);
        gl.uniform1f(P.u('uG'), s.g); gl.uniform1i(P.u('uPic'), 0); gl.uniform1i(P.u('uA'), 1); gl.uniform1i(P.u('uB'), 2); gl.uniform1i(P.u('uC'), 3); gl.uniform1i(P.u('uD'), 4); gl.uniform2f(P.u('uPicSize'), s.pw, s.ph);
        gl.uniform1f(P.u('uP'), s.P); gl.uniform1f(P.u('uPm'), s.Pm); gl.uniform1f(P.u('uT'), this.time); gl.uniform1f(P.u('uRipMax'), s.ripMax || 16);
        const ws = Math.min(1.6, (wind.strength || 0) * 0.6); gl.uniform2f(P.u('uWind'), Math.cos(a) * ws, Math.sin(a) * ws);
        gl.uniform2f(P.u('uWater'), num(Wt, 'clear', 0.25, 0, 1), this.clock.water);
        gl.uniform4f(P.u('uLava'), num(Lv, 'glow', 1, 0, 2), num(Lv, 'embers', 1, 0, 2), num(Lv, 'heat', 0.5, 0, 1), num(Lv, 'range', 0.5, 0, 1)); gl.uniform1f(P.u('uLavaT'), this.clock.lava);
        gl.uniform3f(P.u('uGPow'), num(S.shimmer, 'power', 1, 0, 2), num(S.pulse, 'power', 1, 0, 2), num(S.ripple, 'power', 1, 0, 2));
        gl.uniform3f(P.u('uGTime'), this.clock.shimmer, this.clock.pulse, this.clock.ripple);
        gl.uniform3f(P.u('uGRange'), num(S.shimmer, 'range', 0.5, 0, 1), num(S.pulse, 'range', 0.5, 0, 1), num(S.ripple, 'range', 0.5, 0, 1));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      let shown = 0;
      if (this.kinds.grass && this.blades && this.blades.n) {
        const B = this.bp; gl.useProgram(B.p); gl.bindVertexArray(this.blades.vao);
        shown = Math.round(this.blades.n * (num(G, 'amount', 1, 0, 1.5) / 1.5) * (few ? 0.5 : 1));
        gl.uniform4f(B.u('uMat'), k, 0, e, f); gl.uniform2f(B.u('uView'), this.el.width, this.el.height); gl.uniform2f(B.u('uWind'), Math.cos(a), Math.sin(a));
        gl.uniform1f(B.u('uG'), s.g); gl.uniform1f(B.u('uT'), this.time); gl.uniform1f(B.u('uGustT'), this.gustT); gl.uniform1f(B.u('uWindS'), wind.strength || 0);
        gl.uniform1f(B.u('uLen'), 0.3 * s.g * num(G, 'length', 1, 0.2, 3)); gl.uniform1f(B.u('uWide'), 0.013 * s.g * num(G, 'thick', 1, 0.5, 3)); // (Beta 3.58: Thickness)
        gl.uniform1f(B.u('uCalm'), num(G, 'calm', 0.35, 0, 1)); gl.uniform1f(B.u('uVary'), num(G, 'vary', 0.3, 0, 1)); gl.uniform1f(B.u('uMaxA'), 0.8); gl.uniform1f(B.u('uDot'), 1 / k);
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
  return { supported, layer, paint };
})();
