/*
 * Second Builder (second-spell-looks): spell areas drawn by the graphics card.
 *
 * Each damage type (FXDATA.SKINS) has its own look in one fragment shader: flames that roll and lick out of the
 * area, frost that grows in crystals, branching bolts, a pressure wave with dust, a bubbling pool, rolling gas
 * with light and shadow, a miasma with wisps, beams of light, a shimmering field, a psychic swirl, thick fog,
 * vines and thorns, inky darkness, an arcane nebula, water with caustics and foam, broken ground and dust, a
 * swarm of insects. FX.spell (fx.js) draws a spell's area with it when it can, at the spell layer's own pixels,
 * and keeps drawing the outline, the squares and the selection itself. No graphics card: the old drawing.
 *
 * Two passes for every spell, both onto the 2D spell layer:
 *   body   what lies on the map and hides it (smoke, frost, water, vines), drawn normally
 *   light  what glows (flames, bolts, beams, sparks), added on top ('lighter'), so it lights the map under it
 * The skin's three colours come in as uniforms, so a colour the GM picks for a spell works here too.
 */
'use strict';
const SpellGL = (() => {
  const SKIN_IDS = { fire: 0, cold: 1, lightning: 2, thunder: 3, acid: 4, poison: 5, necrotic: 6, radiant: 7, force: 8, psychic: 9, cloud: 10, nature: 11, darkness: 12, arcane: 13, water: 14, earth: 15, swarm: 16 };

  const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec4 uBox; // x, y, w, h in map units
out vec2 vP;
void main() { vP = uBox.xy + aPos * uBox.zw; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;

  const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform int uSkin, uKind, uN, uPass, uBurst, uShape; // uShape: 0 round, 1 cone, 2 line, 3 cube
uniform vec3 uCirc; uniform vec2 uPoly[4];
uniform vec2 uO, uDir;      // the point of origin; the way it points (cone, line, cube)
uniform float uCell;        // map units a 5 ft square
uniform float uT, uAge, uLevel, uA, uLen; // seconds (running), seconds since cast, how strong now, alpha, length (squares)
uniform vec3 uC, uL, uD;    // the skin's colours: main, light, dark
uniform vec2 uSeed;
const float TAU = 6.2831853;

// ---------- noise ----------
float h1(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h2(vec2 p) { float n = h1(p); return vec2(n, h1(p + n + 19.19)); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.7; a *= 0.5; } return s / 0.96875; }
float fbm3(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; } return s / 0.875; }
float ridge(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * (1.0 - abs(vn(p) * 2.0 - 1.0)); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 5.3; a *= 0.5; } return s / 0.9375; }
// cells: x nearest, y second nearest, zw the nearest cell's id
vec4 vor(vec2 p, float jit) {
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y); vec2 c = g + 0.5 + (h2(i + g) - 0.5) * jit; float d = length(c - f);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  return vec4(d1, d2, id);
}
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// ---------- the area ----------
float sdPoly(vec2 p) {
  float d = 1e9; float s = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uN) break;
    int j = i == 0 ? uN - 1 : i - 1;
    vec2 a = uPoly[i], b = uPoly[j];
    vec2 e = b - a, w = p - a;
    vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(q, q));
    bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
float sdArea(vec2 p) { return uKind == 0 ? length(p - uCirc.xy) - uCirc.z : sdPoly(p); }

// ---------- shared pieces ----------
vec3 ramp3(float x, vec3 a, vec3 b, vec3 c) { return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0); }
// rolling gas: density 0..1 and how it is lit (light from the top left)
vec2 gas(vec2 p, vec2 flow, float t, float scale) {
  vec2 q = p * scale + uSeed;
  vec2 w = vec2(fbm3(q * 0.7 + flow * t * 0.6), fbm3(q * 0.7 + vec2(4.1, 2.7) - flow.yx * t * 0.5));
  vec2 r = q + 1.6 * w + flow * t;
  float n = fbm(r);
  float n2 = fbm(r + vec2(0.18, 0.18));
  return vec2(n, sat(0.5 + (n - n2) * 4.0));
}
// sparks: points in cells that twinkle; returns brightness
float sparkle(vec2 p, float scale, float t, float speed, float sharp) {
  vec2 q = p * scale; vec2 i = floor(q), f = fract(q);
  vec2 r = h2(i + uSeed * 3.0);
  vec2 c = 0.2 + 0.6 * r;
  float tw = pow(sat(sin(t * speed * (0.6 + r.x) + r.y * TAU)), sharp);
  float d = length(f - c);
  return tw * smoothstep(0.12, 0.0, d) + tw * 0.35 * smoothstep(0.32, 0.0, d);
}
// insects / embers: points that wander round their cell
float specks(vec2 p, float scale, float t, float wander, float size, out float glint) {
  vec2 q = p * scale; vec2 i = floor(q); float best = 0.0; glint = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = i + vec2(x, y); vec2 r = h2(g + uSeed);
    vec2 c = g + 0.5 + wander * vec2(sin(t * (2.0 + 3.0 * r.x) + r.y * 9.0) + 0.5 * sin(t * 7.3 * r.y + r.x * 4.0), cos(t * (1.7 + 3.0 * r.y) + r.x * 7.0) + 0.5 * cos(t * 6.1 * r.x));
    vec2 d = q - c;
    float a = t * 9.0 * (r.x - 0.5) + r.y * 6.0; d = rot(d, a);
    float e = length(d * vec2(1.0, 1.8));
    float v = smoothstep(size, size * 0.3, e);
    best = max(best, v);
    glint = max(glint, v * pow(sat(sin(t * 31.0 * (0.7 + r.x) + r.y * 20.0)), 8.0));
  }
  return best;
}

// light on a height field h (in squares of height), from the top left: screen derivatives turned into map slopes
float shade(float h, vec2 p, float k) {
  vec2 dp = vec2(dFdx(p.x), dFdy(p.y));
  vec2 g = vec2(dFdx(h) / (abs(dp.x) > 1e-6 ? dp.x : 1e-6), dFdy(h) / (abs(dp.y) > 1e-6 ? dp.y : 1e-6));
  vec3 n = normalize(vec3(-g * k, 1.0));
  return dot(n, normalize(vec3(-0.6, -0.7, 0.9)));
}
float glossOf(float h, vec2 p, float k, float sharp) {
  vec2 dp = vec2(dFdx(p.x), dFdy(p.y));
  vec2 g = vec2(dFdx(h) / (abs(dp.x) > 1e-6 ? dp.x : 1e-6), dFdy(h) / (abs(dp.y) > 1e-6 ? dp.y : 1e-6));
  vec3 n = normalize(vec3(-g * k, 1.0));
  vec3 hv = normalize(normalize(vec3(-0.6, -0.7, 0.9)) + vec3(0.0, 0.0, 1.0));
  return pow(sat(dot(n, hv)), sharp);
}
// a flow map: the same pattern carried along v (squares a cycle) without ever tearing; f(q) is sampled twice
#define FLOW2(F, P, V, T, RATE) (mix(F((P) - (V) * fract((T) * (RATE))), F((P) - (V) * fract((T) * (RATE) + 0.5) + 3.7), abs(1.0 - 2.0 * fract((T) * (RATE)))))

struct Look { vec4 body; vec3 light; };

// The coordinates every look gets:
//   p    map position in squares (moves with the map, so the pattern stays put)
//   r    distance from the point of origin, squares;  rc: from the middle (round areas), squares
//   al   along the way it points (cones, lines, cubes), squares from the origin; ac: across it
//   ed   how far inside the edge, squares (0 at the edge)
//   R    the area's size in squares (radius, or length)

float flameN(vec2 q) {
  float t = uT;
  vec2 w = vec2(fbm3(q * 0.9 + vec2(0.0, t * 0.35)), fbm3(q * 0.9 + vec2(5.2, 1.3) - vec2(t * 0.3, 0.0)));
  float n = fbm(q * 2.0 + 2.8 * w + vec2(t * 0.25, -t * 0.4));
  float n2 = fbm(q * 4.4 + 3.4 * w - vec2(-t * 0.6, t * 0.9) + 9.0);
  float tongues = pow(ridge(q * 1.5 + 2.0 * w + vec2(0.0, t * 0.3)), 2.0);
  return n * 0.62 + n2 * 0.3 + tongues * 0.4 - 0.16;
}
Look fire(vec2 p, float r, float al, float ed, float R, float t, float age) {
  Look L;
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  vec2 v = uShape == 0 ? (p - c) * 0.45 : uDir * max(1.5, R * 0.35); // flames pour outwards / away from the caster
  vec2 q = p * 1.1 + uSeed;
  float heat = FLOW2(flameN, q, v * 1.1, t, 0.32);
  float core = uShape == 0 ? 1.0 - sat(r / max(R, 0.5)) : 1.0 - sat(abs(al / max(R, 0.5) - 0.4) * 1.3);
  heat += 0.16 * core - 0.04 + (uShape == 1 ? 0.08 : 0.0);
  heat *= 0.55 + 0.45 * sat(ed / max(0.25, R * 0.12)); // (the edge fades over a share of the area, so a small cone burns too)
  // the cast: a wall of flame runs out from the caster, bright, then settles
  float front = R * 1.15 * sat(age / 0.45);
  float d0 = uShape == 0 ? r : al;
  float arrived = smoothstep(front + 0.6, front - 0.4, d0);
  float flash = exp(-age * 2.6) * smoothstep(1.4, 0.0, abs(d0 - front)) * 1.3 + exp(-age * 3.5) * 0.5;
  heat = heat * arrived + flash * 0.45 * arrived;
  heat *= 0.45 + 0.55 * uLevel;
  vec3 col = mix(uD * 0.3, uD, smoothstep(0.3, 0.44, heat));
  col = mix(col, uC, smoothstep(0.44, 0.6, heat));
  col = mix(col, uL, smoothstep(0.6, 0.76, heat));
  col = mix(col, vec3(1.0, 0.98, 0.92), smoothstep(0.8, 0.98, heat));
  float glow = smoothstep(0.3, 0.62, heat);
  L.light = col * glow * 1.2 + uC * 0.12 * smoothstep(0.15, 0.45, heat) * arrived;
  // charred ground and smoke between the flames
  float soot = sat(0.35 + 0.55 * fbm3(p * 1.3 + 3.0) - glow * 0.6) * arrived * smoothstep(-0.2, 0.6, ed);
  L.body = vec4(vec3(0.05, 0.03, 0.02), soot * 0.7 * (0.5 + 0.5 * uLevel));
  float gl; float em = specks(p - v * fract(t * 0.32) * 1.4, 2.2, t, 0.3, 0.07, gl);
  L.light += mix(uL, vec3(1.0, 0.9, 0.6), 0.5) * em * 1.8 * (0.4 + gl) * arrived * (0.3 + 0.7 * uLevel);
  return L;
}

Look cold(vec2 p, float r, float al, float ed, float R, float t, float age) {
  Look L;
  bool stream = uShape == 1 || uShape == 2;
  // frost grows out from the caster when cast
  float d0 = uShape == 0 ? r : al;
  float grow = smoothstep(R * 1.2 * sat(age / 0.8) + 0.5, R * 1.2 * sat(age / 0.8) - 0.8, d0);
  // crystals: cells with bright edges, at two sizes, and feathery frost along them
  vec4 c1 = vor(p * 2.6 + uSeed, 1.0); vec4 c2 = vor(p * 7.0 + uSeed * 2.0, 1.0);
  float edge1 = smoothstep(0.08, 0.0, c1.y - c1.x); float edge2 = smoothstep(0.06, 0.0, c2.y - c2.x);
  float feather = ridge(p * 9.0 + c1.zw * 3.0);
  float frost = sat(0.35 + 0.65 * fbm(p * 1.4 + uSeed)) * grow;
  float crystal = (edge1 * 0.8 + edge2 * 0.45 + pow(feather, 4.0) * 0.6) * frost;
  vec3 ice = mix(uD, uC, 0.7);
  float a = frost * (0.28 + 0.18 * fbm3(p * 3.0)) + crystal * 0.45;
  vec3 col = mix(ice, vec3(0.93, 0.97, 1.0), sat(crystal * 1.2 + 0.1));
  // cold mist drifting (along the cone / line, round and about in a sphere)
  vec2 flow = stream ? uDir * 1.6 : vec2(0.25, 0.12);
  vec2 g = gas(p, flow, t, stream ? 0.9 : 0.55);
  float mist = smoothstep(0.38, 0.85, g.x) * (stream ? 0.85 : 0.5) * (0.5 + 0.5 * uLevel);
  if (stream) mist *= grow;
  vec3 mcol = mix(uC * 0.65 + 0.25, vec3(0.97, 0.99, 1.0), g.y);
  L.body.rgb = mix(col, mcol, mist / max(0.001, a + mist));
  L.body.a = sat(a + mist * 0.75) * sat(ed * 2.0 + 0.3);
  L.body.rgb *= 1.0; // straight colour
  // glints on the ice, a cold glow at the cast
  float sp = sparkle(p, 3.5, t, 2.2, 6.0) * frost;
  L.light = vec3(0.85, 0.95, 1.0) * sp * 1.3 + uC * 0.25 * exp(-age * 1.5) * grow;
  return L;
}

// distance to a jagged bolt along x (lateral y), bolt from 0 to len; seed changes it
float boltDist(vec2 q, float len, float seed, float amp) {
  float x = clamp(q.x, 0.0, len);
  float off = (fbm3(vec2(x * 0.9, seed)) - 0.5) * amp * 2.0 + (vn(vec2(x * 4.0, seed + 3.0)) - 0.5) * amp * 0.35;
  float taper = smoothstep(0.0, 0.6, x) * smoothstep(len, len - 0.6, x);
  float dx = q.x - x;
  return length(vec2(dx, q.y - off * taper));
}
Look lightning(vec2 p, float r, float al, float ac, float ed, float R, float t, float age) {
  Look L;
  float k = floor(t * 13.0); float flick = step(0.22, h1(vec2(k, uSeed.x))) ;
  float strike = exp(-age * 3.0);
  float on = max(flick, step(age, 0.5)) * (0.45 + 0.55 * uLevel);
  float core = 0.0, halo = 0.0;
  vec2 lp = vec2(al, ac);
  if (uShape == 2) { // a line: the bolt runs its whole length, branches fork off it
    float d = boltDist(lp, uLen, k * 1.7 + uSeed.y, 0.55);
    core += exp(-d * 18.0); halo += exp(-d * 3.2);
    for (int b = 0; b < 3; b++) {
      float fb = float(b);
      float x0 = uLen * (0.2 + 0.25 * fb + 0.1 * h1(vec2(k, fb)));
      float side = h1(vec2(fb, k + 7.0)) < 0.5 ? -1.0 : 1.0;
      vec2 q = rot(lp - vec2(x0, (fbm3(vec2(x0 * 0.9, k * 1.7 + uSeed.y)) - 0.5) * 1.1), side * 0.55);
      float bd = boltDist(q, 1.4 + 1.6 * h1(vec2(fb, k)), k + fb * 13.0, 0.35);
      core += exp(-bd * 26.0) * 0.7; halo += exp(-bd * 5.0) * 0.4;
    }
  } else { // bolts from the middle (or the caster) out in every direction
    vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
    vec2 d = p - c; float rr = length(d); float an = atan(d.y, d.x);
    for (int b = 0; b < 6; b++) {
      float fb = float(b);
      float a0 = (fb + h1(vec2(fb, k))) * TAU / 6.0;
      if (uShape != 0) a0 = atan(uDir.y, uDir.x) + (h1(vec2(fb, k)) - 0.5) * 0.9;
      vec2 q = rot(d, -a0);
      float len = R * (0.55 + 0.45 * h1(vec2(fb, k + 3.0)));
      float bd = boltDist(q, len, k * 2.3 + fb * 7.0, 0.45);
      core += exp(-bd * 22.0); halo += exp(-bd * 4.0) * 0.6;
    }
    core += exp(-rr * 3.0) * (0.6 + 2.0 * strike); halo += exp(-rr * 0.8) * (0.4 + strike);
  }
  // scorched ground, crackling all over
  float crackle = pow(ridge(p * 3.0 + vec2(k * 0.37, k * 0.11)), 6.0);
  L.body = vec4(vec3(0.05, 0.05, 0.08), (0.18 + 0.2 * fbm3(p * 2.0)) * sat(ed * 2.0));
  L.light = (vec3(1.0) * core * 1.6 + uL * core * 0.5 + uC * halo * 0.55) * on + uC * crackle * 0.35 * (0.4 + 0.6 * flick) + uL * strike * 0.5;
  return L;
}

Look thunder(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  // rings of pressure run out from the origin: a bright leading edge, a dark trough behind it
  float bright = 0.0, dark = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float ph = uBurst == 1 && age < 1.4 ? sat(age / 0.9 - fk * 0.18) : fract(t * 0.45 + fk / 3.0);
    float front = ph * R * 1.1;
    float x = r - front;
    float fade = (1.0 - ph) * (uBurst == 1 && age < 1.4 ? 1.4 : 0.6);
    bright += exp(-x * x * 18.0) * fade;
    dark += exp(-(x + 0.45) * (x + 0.45) * 7.0) * fade;
  }
  // dust thrown up and blown outwards
  vec2 out2 = normalize(p - uO / uCell + 1e-4);
  vec2 g = gas(p - out2 * t * 0.25, vec2(0.0), t, 1.1);
  float dust = smoothstep(0.42, 0.8, g.x) * (0.35 + 0.65 * exp(-age * 0.6)) * (0.4 + 0.6 * uLevel);
  vec3 dcol = mix(vec3(0.32, 0.3, 0.28), vec3(0.72, 0.7, 0.66), g.y);
  float gl; float deb = specks(p - out2 * sat(age) * 1.2, 4.5, t, 0.08, 0.1, gl) * exp(-age * 0.8);
  L.body = vec4(mix(dcol, vec3(0.05, 0.06, 0.08), sat(dark * 0.7)), sat(dust * 0.5 + dark * 0.28 + deb * 0.8) * sat(ed * 2.0 + 0.2));
  L.light = mix(uL, vec3(1.0), 0.4) * bright * 0.55 + uC * exp(-age * 4.0) * 0.4;
  return L;
}

float acidH(vec2 q) { return fbm3(q * 0.9 + vec2(uT * 0.05, -uT * 0.04)); }
Look acid(vec2 p, float ed, float t, float age) {
  Look L;
  vec2 q = p * 1.2 + uSeed;
  float n = acidH(q);
  // bubbles rise, swell and pop; they are domes on the surface
  vec4 cb = vor(p * 2.6 + uSeed, 0.9);
  float ph = fract(t * (0.3 + 0.45 * h1(cb.zw)) + h1(cb.zw + 3.0));
  float br = (0.08 + 0.26 * ph) * h1(cb.zw + 7.0);
  float live = step(ph, 0.93) * step(0.35, h1(cb.zw + 11.0));
  float dome = sqrt(sat(1.0 - pow(cb.x / max(br, 1e-3), 2.0))) * live;
  float pop = smoothstep(0.93, 1.0, ph) * smoothstep(0.05, 0.0, abs(cb.x - (0.05 + (ph - 0.93) * 5.0))) * step(0.35, h1(cb.zw + 11.0));
  float hgt = n * 0.25 + dome * br * 1.2;
  float lit = shade(hgt, p, 0.8);
  float gloss = glossOf(hgt, p, 0.8, 90.0);
  float spread = smoothstep(-0.2, 0.5, ed) * sat(age / 0.5 + 0.2);
  float depth = sat(ed * 0.5) * (0.6 + 0.4 * n);
  vec2 sw = q * 0.8 + vec2(fbm3(q * 0.6 + t * 0.04), fbm3(q * 0.6 + 4.0 - t * 0.03)) * 2.0;
  float swirl = fbm(sw);
  vec3 liquid = mix(uC * 0.95, uD * 0.7, sat(depth * 0.9 + 0.1 + (swirl - 0.5) * 0.9));
  float scum = smoothstep(0.58, 0.8, fbm(sw * 1.7 + 2.0)) + dome * 0.4;          // (pale froth drifting on it)
  liquid = mix(liquid, mix(uL, vec3(0.95, 1.0, 0.8), 0.3), sat(scum) * 0.55);
  float sheen = pow(1.0 - abs(fbm3(sw * 1.3 + t * 0.05) * 2.0 - 1.0), 5.0) * 0.12; // (an oily glint in streaks)
  liquid *= 0.8 + 0.35 * lit;
  liquid = mix(liquid, mix(uC, uL, 0.4), dome * 0.25);
  float rim = smoothstep(0.3, 0.0, ed) * smoothstep(-0.05, 0.08, ed);
  liquid = mix(liquid, uD * 0.3, rim * 0.6);
  vec2 g = gas(p, vec2(0.08, -0.12), t, 0.8);
  float fume = smoothstep(0.58, 0.92, g.x) * 0.3;
  liquid = mix(liquid, mix(uC, uL, g.y), fume);
  L.body = vec4(liquid, (0.55 + 0.3 * depth) * spread);
  L.light = (vec3(0.9, 1.0, 0.85) * (gloss * 0.6 + sheen * 0.35) + uL * pop * 0.7) * spread + uC * 0.07 * spread;
  return L;
}

Look cloudy(vec2 p, float ed, float R, float t, float age, vec2 flow, float thick, vec3 lo, vec3 hi, vec3 dk, float scale) {
  Look L;
  vec2 g = gas(p, flow, t, scale);
  vec2 g2 = gas(p * 1.9 + 3.0, flow * 1.3, t, scale);
  float dens = sat((g.x * 0.75 + g2.x * 0.35 - 0.3) * 1.9);
  float grow = sat(age / 0.9 + 0.15);
  dens *= smoothstep(-0.1, 0.9 * grow + 0.2, ed + (g.x - 0.5) * 0.8);
  vec3 col = mix(lo, hi, g.y);
  col = mix(col, dk, sat((0.55 - g2.x) * 1.5) * 0.5);
  L.body = vec4(col, sat(dens * thick + thick * 0.22 * smoothstep(0.0, 0.6, ed)));
  L.light = vec3(0.0);
  return L;
}

float wispN(vec2 w) { float n = fbm3(w + vec2(fbm3(w * 0.7 + uT * 0.08), 0.0) * 1.5); return smoothstep(0.08, 0.0, abs(n - 0.5)) * smoothstep(0.3, 0.7, fbm3(w * 0.5 + 3.0)); }
Look necrotic(vec2 p, float r, float ed, float R, float t, float age) {
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  Look L = cloudy(p, ed, R, t, age, vec2(0.03, -0.05), 0.78, uD * 0.55 + 0.015, uC * 0.6, vec3(0.0), 0.7);
  // the ground withers: dark veins creep through it
  vec2 wq = p * 1.1 + uSeed + 0.5 * vec2(fbm3(p * 0.9), fbm3(p * 0.9 + 4.0));
  float vein = smoothstep(0.04, 0.0, abs(fbm(wq) - 0.5)) * smoothstep(0.0, 0.6, ed);
  // pale wisps of life, drawn in towards the middle
  float wisp = FLOW2(wispN, p * 0.9 + uSeed, (c - p) * 0.3, t, 0.18);
  L.body.rgb = mix(L.body.rgb, vec3(0.015, 0.0, 0.02), vein * 0.85);
  L.body.a = max(L.body.a, vein * 0.75);
  float pulse = 0.55 + 0.45 * sin(t * 1.1 + r * 0.7);
  L.light = mix(uC, uL, 0.6) * wisp * 0.4 * (0.5 + 0.5 * uLevel) + uC * vein * 0.18 * pulse + uC * 0.35 * exp(-age * 2.0);
  return L;
}

Look radiant(vec2 p, float r, float al, float ac, float ed, float R, float t, float age) {
  Look L;
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  vec2 d = p - c; float rr = length(d); float an = atan(d.y, d.x);
  float base, rays;
  if (uShape == 2) { // a beam: brightest down its middle, light streaming along it
    base = exp(-ac * ac * 2.0) * 1.0 + 0.3;
    rays = pow(fbm3(vec2(al * 0.5 - t * 1.6, ac * 2.5)), 2.0) * 1.4;
  } else {
    float rn = rr / max(R, 0.5);
    base = exp(-rn * rn * 3.0) * 1.15 + 0.3 * (1.0 - rn);
    vec2 ua = vec2(cos(an), sin(an));
    float a1 = fbm3(ua * 3.0 + vec2(t * 0.12, -t * 0.09));
    float a2 = fbm3(ua * 6.5 + vec2(-t * 0.08, t * 0.1) + 4.0);
    rays = pow(sat(a1 * 0.75 + a2 * 0.55 - 0.32), 2.2) * 2.4 * (1.0 - rn * 0.55);
  }
  // a few big motes drifting up through the light, softly
  float m1 = sparkle(p + vec2(0.0, t * 0.15), 1.6, t, 1.2, 2.0);
  float m2 = sparkle(p * 1.3 + vec2(4.0, t * 0.1), 1.6, t, 1.7, 2.0) * 0.7;
  float shim = 0.88 + 0.12 * sin(t * 1.7 + fbm3(p * 1.5) * 6.0);
  float castF = exp(-age * 2.0);
  vec3 warm = mix(uC, uL, 0.55);
  L.light = (warm * base * 0.75 + uL * rays * 0.55) * shim * (0.55 + 0.45 * uLevel) + uL * (m1 + m2) * 0.45 + vec3(1.0, 0.98, 0.9) * castF * 1.0 * exp(-rr * 0.35);
  L.light *= sat(ed * 1.8 + 0.1);
  L.body = vec4(uL, 0.1 * sat(ed * 2.0));
  return L;
}

float hexEdge(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5; vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 ab = abs(g);
  float d = max(dot(ab, s * 0.5), ab.x);
  return 0.5 - d;
}
Look force(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  vec2 warp = vec2(fbm3(p * 0.8 + t * 0.2), fbm3(p * 0.8 + 3.0 - t * 0.2)) - 0.5;
  float hx = hexEdge((p + warp * 0.3) * 1.6);
  float line = smoothstep(0.05, 0.0, hx);
  float wave = 0.5 + 0.5 * sin(r * 2.4 - t * 3.0);
  float ripple = exp(-pow(r - fract(age * 0.35 + t * 0.12) * R * 1.3, 2.0) * 2.0);
  float rim = exp(-ed * 2.2);
  float castF = exp(-age * 2.5);
  float shimmer = fbm(p * 2.0 + vec2(t * 0.4, -t * 0.3));
  vec3 c = mix(uC, uL, 0.35);
  L.light = c * (line * (0.18 + 0.4 * wave * shimmer + 0.6 * ripple) + rim * 0.55 + shimmer * 0.08) * (0.5 + 0.5 * uLevel) + uL * castF * 0.7;
  L.body = vec4(mix(uD, uC, 0.5), (0.12 + 0.1 * shimmer) * sat(ed * 3.0));
  return L;
}

Look psychic(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  vec2 d = p - c; float rr = length(d) + 1e-3; float an = atan(d.y, d.x);
  vec2 w = vec2(fbm3(p * 0.9 + t * 0.15), fbm3(p * 0.9 + 5.0 - t * 0.12));
  float sp = sin(an * 3.0 + log(rr) * 5.0 - t * 1.6 + w.x * 5.0);
  float sp2 = sin(an * 5.0 - log(rr) * 7.0 + t * 1.1 + w.y * 6.0);
  float bands = pow(0.5 + 0.5 * sp, 6.0) + pow(0.5 + 0.5 * sp2, 8.0) * 0.6;
  float pulse = pow(0.5 + 0.5 * sin(rr * 2.0 - t * 2.4), 4.0);
  float neur = pow(ridge(p * 2.2 + w * 2.0 + t * 0.1), 5.0);
  float castF = exp(-age * 2.0);
  L.light = (mix(uC, uL, bands * 0.5) * bands * 0.45 + uL * neur * 0.6 + uC * pulse * 0.18) * (0.5 + 0.5 * uLevel) + uL * castF * 0.6;
  L.light *= sat(ed * 2.0 + 0.1);
  L.body = vec4(uD, (0.22 + 0.15 * w.x) * sat(ed * 2.0));
  return L;
}

// one layer of vines: the lines where a noise crosses a level are long winding curves; each is a round stem
vec2 vines(vec2 q, float w, float lev) {
  float n = fbm3(q);
  float g = length(vec2(dFdx(n), dFdy(n))) / max(1e-5, length(vec2(dFdx(q.x), dFdy(q.y)))); // (how fast the noise changes, to keep the stems the same width)
  float d = abs(n - lev) / max(g, 0.05);
  float stem = sat(1.0 - d / w);
  return vec2(sqrt(stem), d);
}
Look nature(vec2 p, float ed, float t, float age) {
  Look L;
  float grow = sat(age / 1.2);
  vec2 sway = vec2(sin(t * 0.7 + p.y * 0.6), cos(t * 0.6 + p.x * 0.5)) * 0.03;
  vec2 q = p + sway + uSeed;
  // three tangles of vines, from thick to thin, one over the other
  vec2 a1 = vines(q * 0.55, 0.11, 0.5);
  vec2 a2 = vines(rot(q, 1.3) * 0.8 + 7.0, 0.075, 0.45);
  vec2 a3 = vines(rot(q, 2.4) * 1.1 + 13.0, 0.05, 0.55);
  vec2 a4 = vines(rot(q, 0.7) * 1.4 + 21.0, 0.04, 0.5);
  float h = max(max(a1.x * 0.3, a2.x * 0.22), max(a3.x * 0.16, a4.x * 0.12));
  float stem = step(0.001, h);
  // leaves on the stems: pointed ovals, each turned its own way
  vec4 c = vor(q * 4.0, 1.0);
  vec2 cellP = q * 4.0 - (c.zw + 0.5 + (h2(c.zw) - 0.5));
  vec2 lq = rot(cellP, h1(c.zw + 4.0) * TAU);
  float leafShape = 1.0 - (abs(lq.y) * 3.2 + pow(abs(lq.x), 1.4) * 2.6);
  float nearStem = smoothstep(0.35, 0.0, min(min(a1.y, a2.y), min(a3.y, a4.y)) * 0.6);
  float leaf = smoothstep(0.0, 0.15, leafShape) * nearStem * step(0.3, h1(c.zw + 9.0));
  float lh = leaf * (0.1 + 0.15 * sat(leafShape));
  float hgt = max(h, lh);
  float lit = shade(hgt, p, 0.9);
  float thorn = smoothstep(0.06, 0.0, vor(q * 9.0, 1.0).x) * step(0.2, h) * smoothstep(0.0, 0.5, ed);
  vec3 stemC = mix(uD * 0.75, mix(uC, uD, 0.35), sat(h * 3.0));
  vec3 leafC = mix(uD, uC, 0.5 + 0.5 * h1(c.zw + 2.0));
  vec3 col = (lh > h ? leafC : stemC) * (0.45 + 0.75 * sat(lit));
  col = mix(col, mix(uL, vec3(0.85, 0.8, 0.6), 0.5), thorn * 0.8);
  float plant = sat(max(stem, leaf));
  float ground = (0.3 + 0.25 * fbm3(q * 0.8)) * smoothstep(-0.1, 0.5, ed); // (trampled, shadowed ground under it)
  L.body = vec4(mix(uD * 0.3, col, plant), sat(plant * 0.97 + ground) * grow * smoothstep(-0.1, 0.4, ed + 0.15));
  L.light = vec3(0.0);
  return L;
}

Look darkness(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  vec2 d = p - c; float rr = length(d);
  vec2 q = rot(d, t * 0.05 + 0.4 / (0.6 + rr * 0.3)) + uSeed;
  float n = fbm(q * 0.8 + vec2(t * 0.06, 0.0));
  float tendril = fbm(q * 2.2 - t * 0.1);
  float edge = smoothstep(-0.15, 0.9, ed + (tendril - 0.5) * 1.1);
  float grow = sat(age / 0.6 + 0.1);
  edge *= smoothstep(R * grow + 0.5, R * grow - 0.8, uShape == 0 ? rr : 0.0);
  vec3 col = mix(vec3(0.0), uD + uC * 0.25, smoothstep(0.55, 0.85, n) * 0.6);
  L.body = vec4(col, sat(edge * (0.9 + 0.08 * n)));
  float glint = pow(1.0 - abs(fbm(q * 1.6 + t * 0.07) * 2.0 - 1.0), 18.0);
  L.light = uL * glint * 0.25 * edge;
  return L;
}

Look arcane(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  vec2 g = gas(p, vec2(0.05, -0.08), t, 0.7);
  vec2 g2 = gas(p * 1.7 + 9.0, vec2(-0.06, 0.03), t, 0.9);
  float neb = smoothstep(0.35, 0.9, g.x * 0.7 + g2.x * 0.5);
  float filaments = pow(ridge(p * 1.3 + g.xy * 2.0), 6.0);
  float stars = sparkle(p, 4.0, t, 2.0, 5.0) + sparkle(p * 1.6 + 2.0, 4.0, t, 3.1, 7.0) * 0.7;
  float rim = exp(-ed * 3.0);
  float castF = exp(-age * 2.0);
  vec3 c = mix(uC, uL, g2.y * 0.6);
  L.light = (c * neb * 0.45 + uL * filaments * 0.5 + uC * rim * 0.35) * (0.5 + 0.5 * uLevel) + vec3(1.0, 0.97, 1.0) * stars * 1.1 + uL * castF * 0.6;
  L.light *= sat(ed * 3.0 + 0.2);
  L.body = vec4(uD, (0.18 + 0.25 * neb) * sat(ed * 2.0));
  return L;
}

float waveH(vec2 q) { return fbm3(q * 0.7) * 0.7 + fbm3(q * 1.6 + 4.0) * 0.3; }
float foamN(vec2 q) { return fbm(q * 2.2 + 5.0); }
Look water(vec2 p, float r, float al, float ed, float R, float t, float age) {
  Look L;
  vec2 c = uShape == 0 ? uCirc.xy / uCell : uO / uCell;
  vec2 d = p - c; float rr = length(d);
  // a whirl (round) or a surge away from the caster: the surface is carried along without tearing
  vec2 v = uShape == 0 ? vec2(-d.y, d.x) * (1.2 / (0.6 + rr * 0.25)) - d * 0.12 : uDir * 3.0;
  vec2 q = p + uSeed;
  float hw = FLOW2(waveH, q, v, t, 0.25);
  float fn = FLOW2(foamN, q, v, t, 0.25);
  float crest = uShape == 0 ? 0.0 : pow(0.5 + 0.5 * sin(al * 2.0 - t * 4.0 + hw * 3.0), 8.0);
  float lit = shade(hw * 0.3, p, 1.0);
  float gloss = glossOf(hw * 0.3, p, 1.0, 70.0);
  vec4 v1 = vor(q * 1.8 + vec2(t * 0.12, 0.0), 1.0);
  vec4 v2 = vor(q * 2.5 - vec2(0.0, t * 0.1) + 3.0, 1.0);
  float caus = pow(smoothstep(0.32, 0.0, v1.y - v1.x), 2.0) * 0.6 + pow(smoothstep(0.28, 0.0, v2.y - v2.x), 2.0) * 0.4;
  float foam = smoothstep(0.6, 0.78, fn + crest * 0.45) * 0.9 + smoothstep(0.4, 0.0, ed) * smoothstep(0.45, 0.65, fn) * 0.8;
  if (uShape == 0) foam *= 0.6 + 0.6 * smoothstep(R * 0.2, R * 0.8, rr);
  float depth = uShape == 0 ? sat(1.0 - rr / max(R, 0.5)) * 0.7 + sat(ed * 0.4) * 0.3 : sat(ed * 0.6);
  float spread = sat(age / 0.6 + 0.1);
  vec3 wcol = mix(mix(uC, uL, 0.15), uD, depth * 0.85);
  wcol *= 0.8 + 0.35 * lit;
  L.body = vec4(mix(wcol, vec3(0.93, 0.97, 1.0), sat(foam)), (0.48 + 0.35 * depth + 0.35 * sat(foam)) * spread * sat(ed * 3.0 + 0.3));
  L.light = (uL * caus * 0.22 * (1.0 - depth * 0.6) + vec3(1.0) * gloss * 0.45) * spread;
  return L;
}

Look earth(vec2 p, float r, float ed, float R, float t, float age) {
  Look L;
  float shake = uBurst == 1 ? exp(-age * 2.0) : 0.35 * (0.5 + 0.5 * sin(t * 13.0));
  vec2 j = (h2(vec2(floor(t * 20.0), 1.0)) - 0.5) * 0.05 * shake;
  vec2 q = p + j + uSeed;
  vec2 wq = q + 0.35 * vec2(fbm3(q * 1.3), fbm3(q * 1.3 + 5.0)); // (jagged, not polygons)
  vec4 c = vor(wq * 1.2, 1.0);
  float gap = c.y - c.x;
  float rise = sat(age / 0.35);
  // each slab heaves up by its own amount and tilts; the edges are broken off; the cracks are deep
  vec2 tilt = (h2(c.zw) - 0.5) * 0.5;
  float slab = (0.15 + 0.3 * h1(c.zw + 3.0)) * rise * (uBurst == 1 ? 0.6 + 0.4 * exp(-age * 0.6) : 1.0);
  float bevel = smoothstep(0.0, 0.18, gap);
  float hgt = (slab + dot(wq * 1.2 - (c.zw + 0.5), tilt) * 0.25) * bevel + fbm(q * 3.0) * 0.05;
  float lit = shade(hgt, p, 1.3);
  float crack = 1.0 - smoothstep(0.0, 0.07, gap);
  vec3 ground = mix(uD, uC, 0.35 + 0.4 * fbm3(q * 2.6)) * (0.6 + 0.65 * sat(lit));
  vec3 col = mix(ground, uD * 0.12, crack);
  // rubble thrown up, dust
  float gl; float rub = specks(p, 3.0, 0.0, 0.0, 0.2, gl);
  col = mix(col, mix(uD, uL, 0.45) * (0.7 + 0.3 * lit), rub * 0.7);
  vec2 g = gas(p, vec2(0.15, -0.1), t, 0.8);
  float dust = smoothstep(0.45, 0.85, g.x) * (uBurst == 1 ? 0.2 + 0.6 * exp(-age * 0.5) : 0.3);
  col = mix(col, mix(uC, uL, 0.3 + 0.5 * g.y), dust);
  float a = (0.75 + 0.25 * crack) * rise * sat(ed * 2.5 + 0.2);
  L.body = vec4(col, sat(a + dust * 0.4));
  L.light = vec3(0.0);
  return L;
}

Look swarm(vec2 p, float ed, float R, float t, float age) {
  Look L;
  vec2 flow = vec2(sin(t * 0.3), cos(t * 0.23)) * 0.4;
  vec2 g = gas(p, vec2(0.12, 0.05), t * 1.5, 0.6);
  float thick = smoothstep(0.25, 0.7, g.x) * sat(ed * 1.5 + 0.2);
  float g1, g2, g3;
  float b1 = specks(p + flow, 4.2, t * 1.3, 0.55, 0.26, g1);
  float b2 = specks(p * 1.2 - flow + 3.0, 4.2, t * 1.6, 0.6, 0.24, g2);
  float b3 = specks(p * 0.85 + flow * 0.5 + 7.0, 4.2, t * 1.1, 0.5, 0.28, g3);
  float bugs = max(max(b1, b2 * step(0.3, thick)), b3 * step(0.12, thick)) * sat(thick * 2.0 + 0.2);
  float shadow = thick * 0.45;
  L.body = vec4(uD, sat(bugs * 0.95 + shadow) * sat(age / 0.6 + 0.1));
  L.light = uL * (g1 + g2 + g3) * 0.45 * thick;
  return L;
}

void main() {
  float d = sdArea(vP);              // map units, < 0 inside
  if (d > 0.02 * uCell) discard;
  vec2 p = vP / uCell;
  float ed = -d / uCell;             // squares inside the edge
  vec2 c0 = uKind == 0 ? uCirc.xy : uO;
  float r = length(vP - uO) / uCell;
  float R = uKind == 0 ? uCirc.z / uCell : uLen;
  vec2 rel = (vP - uO) / uCell;
  float al = uShape == 0 ? r : dot(rel, uDir);
  float ac = uShape == 0 ? 0.0 : dot(rel, vec2(-uDir.y, uDir.x));
  float t = uT; float age = uAge;
  Look L;
  if (uSkin == 0) L = fire(p, r, al, ed, R, t, age);
  else if (uSkin == 1) L = cold(p, r, al, ed, R, t, age);
  else if (uSkin == 2) L = lightning(p, r, al, ac, ed, R, t, age);
  else if (uSkin == 3) L = thunder(p, r, ed, R, t, age);
  else if (uSkin == 4) L = acid(p, ed, t, age);
  else if (uSkin == 5) L = cloudy(p, ed, R, t, age, vec2(0.1, -0.06), 0.66, mix(uD, uC, 0.5), uL * 0.9 + uC * 0.15, uD * 0.6, 0.7);
  else if (uSkin == 6) L = necrotic(p, r, ed, R, t, age);
  else if (uSkin == 7) L = radiant(p, r, al, ac, ed, R, t, age);
  else if (uSkin == 8) L = force(p, r, ed, R, t, age);
  else if (uSkin == 9) L = psychic(p, r, ed, R, t, age);
  else if (uSkin == 10) L = cloudy(p, ed, R, t, age, (uShape == 2 ? uDir * 1.4 : vec2(0.07, -0.04)), 0.85, mix(uD, uC, 0.75), vec3(0.98), uD, 0.6);
  else if (uSkin == 11) L = nature(p, ed, t, age);
  else if (uSkin == 12) L = darkness(p, r, ed, R, t, age);
  else if (uSkin == 13) L = arcane(p, r, ed, R, t, age);
  else if (uSkin == 14) L = water(p, r, al, ed, R, t, age);
  else if (uSkin == 15) L = earth(p, r, ed, R, t, age);
  else L = swarm(p, ed, R, t, age);
  float inside = smoothstep(-0.02, 0.18, ed);
  if (uPass == 0) {
    float a = sat(L.body.a) * inside * uA;
    o = vec4(L.body.rgb, a);
  } else {
    vec3 e = max(L.light, 0.0) * inside * uA;
    float m = max(max(e.r, e.g), max(e.b, 1e-4));
    o = vec4(e / m, min(1.0, m)); // (straight alpha: drawn with 'lighter' it adds e, up to white)
  }
}`;

  const stats = { drawn: 0, px: 0, why: '' };
  let gl = null; let prog = null; let U = null; let canvas = null; let buf = null;
  // Second Builder (second-spell-warmup): the program is built without making the window wait. Built on the first
  // spell, on Windows it held the GM window for about ten seconds (DirectX translates this big program slowly). Now
  // warm() starts it while the start screen shows (KHR_parallel_shader_compile: the graphics process builds it, the
  // window goes on); until it is ready every spell is drawn the old way. Software graphics, no WebGL 2, a graphics
  // card too slow for it (timed once when built) or the GM's switch in Options → Performance: the old drawing.
  // state: idle → building → ready, or slow / off / failed (all three: the old drawing)
  let state = 'idle'; let soft = false; let off = false; let ext = null; let fsh = null; let t0 = 0; let pollT = 0;
  let renderer = ''; let waiters = [];
  const info = { buildMs: 0, testMs: 0, parallel: false };
  const SOFTWARE = /swiftshader|llvmpipe|software|basic render|softpipe/i; // (as trees.js)
  const SLOW_MS = 40; // three looks, each at the most pixels a spell takes (both passes): slower than this, the old drawing
  const role = /role=table/.test(location.search) ? 'table' : 'gm';
  const note = (text) => { try { if (window.ts && window.ts.app) window.ts.app('note', { text: `[${role}] spells: ${text}` }).catch(() => {}); } catch { /* */ } };
  // the GM screen tells the main process how far its build is: the TV waits for it (see the end of this file)
  const report = () => { if (role !== 'gm') return; try { if (window.ts && window.ts.app) window.ts.app('spells', { state }).catch(() => {}); } catch { /* */ } };
  function settle() { report(); const w = waiters; waiters = []; for (const f of w) f(status()); }
  function quit(next, why) {
    clearTimeout(pollT);
    state = next; stats.why = String(why || '').slice(0, 300);
    if (next !== 'slow') { gl = null; prog = null; } // (slow: the program stays, Try again times it once more)
    note(`the old drawing (${stats.why})`);
    settle();
  }
  function begin() {
    if (state !== 'idle') return;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: false, failIfMajorPerformanceCaveat: !soft });
      if (!gl) { quit('off', 'no WebGL 2 with a graphics card'); return; }
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (!soft && SOFTWARE.test(renderer)) { quit('off', `software graphics: ${renderer}`); return; }
      ext = gl.getExtension('KHR_parallel_shader_compile'); info.parallel = !!ext;
      const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
      t0 = performance.now();
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, (fsh = sh(gl.FRAGMENT_SHADER, FS)));
      gl.linkProgram(prog); // (no status asked here: asking would wait for the build)
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); quit('failed', 'the graphics card reset'); });
      state = 'building'; report();
      pollT = setTimeout(poll, ext ? 50 : 0); // (without the extension the first status waits for the build: once, here)
    } catch (err) { quit('failed', (err && err.message) || err); }
  }
  function poll() {
    if (state !== 'building' || !gl) return;
    if (ext && !gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) { pollT = setTimeout(poll, 50); return; }
    try {
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getShaderInfoLog(fsh) || gl.getProgramInfoLog(prog) || 'the program did not build');
      U = {};
      for (const n of ['uBox', 'uSkin', 'uKind', 'uN', 'uPass', 'uBurst', 'uShape', 'uCirc', 'uPoly', 'uO', 'uDir', 'uCell', 'uT', 'uAge', 'uLevel', 'uA', 'uLen', 'uC', 'uL', 'uD', 'uSeed']) U[n] = gl.getUniformLocation(prog, n);
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
      info.buildMs = Math.round(performance.now() - t0);
      timeIt();
    } catch (err) { quit('failed', (err && err.message) || err); }
  }
  // how long this graphics card takes: three looks, the fastest of two runs each, at a quarter of the most pixels a
  // spell takes (times four). One draw a turn, so the window never waits long even on a very slow card; a first look
  // far too slow ends it at once. (Not on the self-test's software graphics: always slow, they still check the drawing.)
  function timeIt() {
    const side = Math.floor(Math.sqrt(MAXPX / 4)); const px = new Uint8Array(4);
    const skins = [SKIN_IDS.fire ?? 0, SKIN_IDS.cloud ?? 10, SKIN_IDS.water ?? 14];
    const runs = [-1, 0, 0, 1, 1, 2, 2]; const best = [Infinity, Infinity, Infinity]; let i = 0;
    const done = (ms) => {
      info.testMs = Math.round(ms * 10) / 10;
      if (ms > SLOW_MS) { quit('slow', `this graphics card is too slow for it: ${info.testMs} ms a spell`); return; }
      state = 'ready'; stats.why = '';
      note(`drawn by the graphics card (built in ${info.buildMs} ms${info.parallel ? ' in the background' : ''}, ${soft ? 'not timed' : `${info.testMs} ms a spell`}; ${renderer})`);
      settle();
    };
    if (soft) { done(0); return; }
    const step = () => {
      if (state !== 'building' || !gl) return;
      try {
        const k = runs[i++];
        setTest(skins[Math.max(0, k)]);
        const a = performance.now();
        if (k < 0) paint(64, 64); else paint(side, side);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // (waits until the card is done)
        if (k >= 0) {
          best[k] = Math.min(best[k], (performance.now() - a) * 4);
          if (best[k] > SLOW_MS * 3) { done(best[k]); return; }
        }
        if (i < runs.length) { pollT = setTimeout(step, 0); return; }
        done(Math.max(...best));
      } catch (err) { quit('failed', (err && err.message) || err); }
    };
    step();
  }
  function setTest(skin) {
    gl.useProgram(prog);
    gl.uniform4f(U.uBox, 0, 0, 10, 10); gl.uniform1i(U.uSkin, skin); gl.uniform1i(U.uKind, 0); gl.uniform1i(U.uShape, 0); gl.uniform1i(U.uBurst, 0);
    gl.uniform3f(U.uCirc, 5, 5, 5); gl.uniform1i(U.uN, 0); gl.uniform2f(U.uO, 5, 5); gl.uniform2f(U.uDir, 1, 0); gl.uniform1f(U.uCell, 1); gl.uniform1f(U.uLen, 5);
    gl.uniform1f(U.uT, 12.3); gl.uniform1f(U.uAge, 4); gl.uniform1f(U.uLevel, 1); gl.uniform1f(U.uA, 1);
    gl.uniform3f(U.uC, 1, 0.5, 0.15); gl.uniform3f(U.uL, 1, 0.85, 0.5); gl.uniform3f(U.uD, 0.3, 0.08, 0.02); gl.uniform2f(U.uSeed, 1.37, 2.11);
  }
  // both passes side by side: body on the left, light on the right (W × H each)
  function paint(W, H) {
    if (canvas.width < 2 * W || canvas.height < H) { canvas.width = Math.max(canvas.width, 2 * W); canvas.height = Math.max(canvas.height, H); }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, W, H);
    gl.uniform1i(U.uPass, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.viewport(W, 0, W, H);
    gl.uniform1i(U.uPass, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function status() { return { state, why: stats.why, renderer, buildMs: info.buildMs, testMs: info.testMs, parallel: info.parallel, off }; }
  // start building (if not yet) and wait until it is ready or given up
  function warm() {
    begin();
    if (state !== 'building') return Promise.resolve(status());
    return new Promise((res) => waiters.push(res));
  }
  // Options → Performance: time it once more (after "too slow"), or try again after a failure
  function retry() {
    if (state === 'slow' && gl) { state = 'building'; timeIt(); return warm(); }
    if (state === 'building') return warm();
    state = 'idle'; gl = null; prog = null;
    return warm();
  }
  const rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const MAXPX = 700000; // (the most pixels one spell takes; bigger ones are drawn coarser and scaled: they are soft anyway)

  // ctx: the 2D spell layer, in map units (its transform); sp: the spell; tpl: Geom.template; sk: skinOf(sp)
  // env: FX.envelope; opts.cell: map units a square
  function draw(ctx, sp, tpl, sk, env, now, opts = {}) {
    if (!(sp.skin in SKIN_IDS) && sp.skin) { /* unknown look: arcane */ }
    if (off) return false;
    if (state === 'idle') begin(); // (Second Builder, second-spell-warmup: never waits for the build)
    if (state !== 'ready') return false;
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b); // layer pixels a map unit
    const cell = opts.cell || cellOf(sp, tpl);
    const pad = 0.05 * cell;
    const x0 = tpl.bbox[0] - pad; const y0 = tpl.bbox[1] - pad; const w = tpl.bbox[2] - tpl.bbox[0] + 2 * pad; const hgt = tpl.bbox[3] - tpl.bbox[1] + 2 * pad;
    // Effects quality: High at the layer's own pixels, Medium and Low coarser (the looks are soft, the outline stays sharp)
    const q = opts.quality || 1; const lin = q >= 1 ? 1 : q >= 0.7 ? 0.8 : 0.6;
    let W = Math.max(2, Math.ceil(w * k * lin)); let H = Math.max(2, Math.ceil(hgt * k * lin));
    const over = (W * H) / MAXPX;
    if (over > 1) { const f = Math.sqrt(over); W = Math.ceil(W / f); H = Math.ceil(H / f); }
    gl.useProgram(prog);
    const shape = { sphere: 0, cylinder: 0, aura: 0, cone: 1, line: 2, cube: 3 }[sp.shape] ?? 0;
    const a = ((sp.angle || 0) * Math.PI) / 180;
    gl.uniform4f(U.uBox, x0, y0, w, hgt);
    gl.uniform1i(U.uSkin, SKIN_IDS[sp.skin] ?? 13);
    gl.uniform1i(U.uKind, tpl.kind === 'circle' ? 0 : 1);
    gl.uniform1i(U.uShape, shape);
    gl.uniform1i(U.uBurst, sp.mode === 'burst' ? 1 : 0);
    if (tpl.kind === 'circle') { gl.uniform3f(U.uCirc, tpl.cx, tpl.cy, tpl.R); gl.uniform1i(U.uN, 0); } else {
      const n = Math.min(4, tpl.poly.length / 2);
      const P = new Float32Array(8); for (let i = 0; i < n * 2; i++) P[i] = tpl.poly[i];
      gl.uniform2fv(U.uPoly, P); gl.uniform1i(U.uN, n); gl.uniform3f(U.uCirc, tpl.cx, tpl.cy, 0);
    }
    gl.uniform2f(U.uO, tpl.origin.x, tpl.origin.y);
    gl.uniform2f(U.uDir, Math.cos(a), Math.sin(a));
    gl.uniform1f(U.uCell, cell);
    const lenSq = tpl.kind === 'circle' ? tpl.R / cell : (sp.size / 5);
    gl.uniform1f(U.uLen, lenSq);
    gl.uniform1f(U.uT, ((now - (sp.t0 || 0)) / 1000) % 14400 + 7.3); // (M4: a spell's time from its own start, wrapped every four hours: still exact to a millisecond as a 32-bit number; an hour made a long-lasting spell jump once an hour)
    gl.uniform1f(U.uAge, env.tb);
    gl.uniform1f(U.uLevel, env.level);
    gl.uniform1f(U.uA, 1);
    const [c, l, d] = [rgb(sk.c), rgb(sk.l), rgb(sk.d)];
    gl.uniform3f(U.uC, ...c); gl.uniform3f(U.uL, ...l); gl.uniform3f(U.uD, ...d);
    const s = opts.seed || 0;
    gl.uniform2f(U.uSeed, (s % 97) * 1.37, (s % 89) * 2.11);
    const alpha = opts.alpha ?? 1;
    // both passes side by side in one picture, handed to the 2D layer once (what costs most is that hand-over)
    const put = (sx, op) => {
      ctx.save();
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, sx, canvas.height - H, W, H, x0, y0, w, hgt);
      ctx.restore();
    };
    paint(W, H);
    put(0, 'source-over');
    put(W, 'lighter');
    stats.drawn++; stats.px = W * H;
    return true;
  }
  // a square's size from the spell itself (when the caller does not say): its size in feet against its template
  function cellOf(sp, tpl) {
    const ft = Math.max(5, sp.size || 5);
    if (tpl.kind === 'circle') return sp.shape === 'aura' ? (tpl.R / (ft / 5 + 0.5)) : tpl.R / (ft / 5);
    const P = tpl.poly; const L = Math.hypot(P[2] - P[0], P[3] - P[1]);
    if (sp.shape === 'cone') return Math.hypot((P[2] + P[4]) / 2 - P[0], (P[3] + P[5]) / 2 - P[1]) / (ft / 5);
    return L / (ft / 5);
  }
  const supported = () => { begin(); return state === 'ready'; }; // (never waits: warm() does)
  // Second Builder (second-spell-warmup): the GM's switch; tests on software graphics (as Trees.allowSoft)
  const setOff = (v) => { off = !!v; };
  const allowSoft = (v) => { soft = !!v; if (soft && state === 'off') { state = 'idle'; gl = null; prog = null; } return soft; };
  return { draw, supported, stats, SKIN_IDS, cellOf, warm, retry, status, setOff, allowSoft };
})();
// Second Builder (second-spell-warmup): build it from the start, in the background (the start screen waits for it)
// The TV builds the program only once the GM screen's build is over. A build from nothing takes ~20 s on Windows;
// the GM and the TV both building it at the start doubled that, and a TV window closed while its build still ran
// left the next one frozen (invisible, not loading) until the graphics process was done with it. Built once, the
// program is in the graphics process's cache, and the TV's own build takes ~0.1 s. Until then: the old drawing.
if (/role=table/.test(location.search)) {
  const t0 = Date.now();
  const wait = async () => {
    let gm = 'idle'; try { gm = await window.ts.app('spells'); } catch { /* */ }
    if ((gm === 'idle' || gm === 'building') && Date.now() - t0 < 90000) { setTimeout(wait, 1000); return; }
    SpellGL.warm();
  };
  setTimeout(wait, 0);
} else if (!/role=sound/.test(location.search)) setTimeout(() => SpellGL.warm(), 0);
