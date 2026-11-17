// A world or regional map as an immersive view (the Cartographer; Beta 3.11, redone in Beta 3.12).
//
// On the TV a map of the campaign's atlas lies over the battlemap: tilted away from the side it faces, bulged like a
// globe, sharp in the middle and soft toward the far and the near edge. The same drawing runs in the GM's Map table
// (atlas-panel.js), flat while the GM works on it or "as on the TV". It is drawn in three parts:
//   the surface   the picture, the grid, still assets, pen strokes, labels and routes, painted flat into one canvas
//                 and bent as a whole: by the graphics card (WebGL 2: one shader does the tilt, the bulge, the blur,
//                 the weather and the mist), or without it by a mesh of small triangles on a plain canvas (the same
//                 bend; the mist worked out coarsely, the blur by two soft bands, no weather)
//   what moves    animated assets: each its own small moving picture laid onto the map and bent with it (at most
//                 LIVE_MAX at once; the rest, and all of them without the graphics card, lie still in the surface)
//   what stands   places, markers, route labels and tokens stand upright on it (plain elements, placed by the same
//                 geometry each frame), so they stay readable however the map lies
// The geometry (geo) is the one thing all parts and the shaders share: map inches -> view -> screen and back.
//
// THE MIST (Beta 3.12). The map never ends in a line: where it would, it goes over into mist of one colour (white
// "cloud" or black "dark mist", kept with each map), and the same mist lies beyond it. For every dot of the screen one
// number says how much mist lies there (0: clear map, 1 and more: only mist); it is the largest of
//   1  how many screen pixels of map are left before the picture ends, in the direction where it ends soonest
//      (the distance to the picture's side divided by how fast that distance changes from pixel to pixel): a band
//      as wide on the screen at the far edge as at the near one. In Beta 3.11 the band had a width on the map, which
//      the tilt squeezed to a line far away
//   2  how strongly the map is squeezed there (the horizon, and far land that would only flicker)
//   3  how near the rim of the screen it is (its own strength; 0: not at all)
// and a slow, large, soft pattern pushes where 1 and 3 begin in and out, so the boundary is soft bays, never straight.
// What stands on the map fades by the same number.
'use strict';

const TableAtlas = (() => {
  const D2R = Math.PI / 180;
  const CAM_D = 2.3; const TILT_MAX = 58; const BULGE_MAX = 0.72; const KR_MAX = 1.45; const LIVE_MAX = 20;
  const REACH = 0.3; // the mist's band at full reach, as a part of the screen's height
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // the icons a place can wear (id: [name in the list, icon])
  const ICONS = { city: ['City', 'building-community'], village: ['Village', 'home'], castle: ['Castle', 'building-castle'], tower: ['Tower', 'tower'], harbour: ['Harbour', 'anchor'], ship: ['Ship', 'sailboat'],
    camp: ['Camp', 'tent'], inn: ['Inn', 'beer'], temple: ['Temple', 'building-church'], ruin: ['Ruin', 'building-monument'], bridge: ['Bridge', 'building-bridge'], mine: ['Mine', 'pick'], cave: ['Cave', 'door'],
    mountain: ['Mountain', 'mountain'], forest: ['Forest', 'trees'], market: ['Market', 'building-store'], battle: ['Battle', 'swords'], danger: ['Danger', 'skull'], treasure: ['Treasure', 'diamond'],
    quest: ['Quest', 'exclamation-mark'], crown: ['Crown', 'crown'], key: ['Key', 'key'], star: ['Star', 'star'], flag: ['Flag', 'flag'] };
  const STYLES = { medallion: 'Medallion', diamond: 'Diamond', pin: 'Pin' };
  const iconOf = (id) => (ICONS[id] || ICONS.flag)[1];
  // how light a colour is (0 black … 1 white): an icon on it is drawn dark or white
  const lightOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

  // ---------- the geometry ----------
  function geo(L, cam, W, H) {
    const tau = clamp(L.tilt, 0, 1) * TILT_MAX * D2R; const c = Math.cos(tau); const s = Math.sin(tau);
    const kb = clamp(L.bulge, 0, 1) * BULGE_MAX; const tr = L.turn * D2R; const ct = Math.cos(tr); const st = Math.sin(tr); const hh = H / 2;
    return {
      c, s, kb, tr, W, H,
      toScreen(mx, my) {
        const u = (mx - cam.cx) / cam.S; const v = (my - cam.cy) / cam.S;
        const den = CAM_D - v * s;
        if (den < 0.05) return null; // (nearer than the eye)
        const x = (u * CAM_D) / den; const y = (v * c * CAM_D) / den;
        const r2 = Math.hypot(x, y);
        const k = kb > 0.001 && r2 > 1e-6 ? Math.atan(kb * r2) / (kb * r2) : 1;
        const qx = x * k; const qy = y * k;
        const px = ct * qx - st * qy; const py = st * qx + ct * qy;
        return { x: W / 2 + px * hh, y: H / 2 + py * hh, qx, qy, px, py, scale: (k * CAM_D) / den };
      },
      toMap(sx, sy) {
        const px = (sx - W / 2) / hh; const py = (sy - H / 2) / hh;
        const qx = ct * px + st * py; const qy = -st * px + ct * py;
        const r = Math.hypot(qx, qy); let k = 1;
        if (kb > 0.001 && r > 1e-6) { const kr = kb * r; if (kr > KR_MAX) return null; k = Math.tan(kr) / kr; }
        const x = qx * k; const y = qy * k;
        const den = c * CAM_D + y * s;
        if (den < 0.06) return null; // (beyond the horizon)
        const v = (y * CAM_D) / den; const u = (x * (CAM_D - v * s)) / CAM_D;
        return { x: cam.cx + cam.S * u, y: cam.cy + cam.S * v, qx, qy };
      },
      soft(qx, qy, blur) { return blur * clamp(sstep(0.18, 1.0, -qy) + 0.8 * sstep(0.45, 1.05, qy) + 0.5 * sstep(0.9, 1.9, Math.hypot(qx, qy)), 0, 1.6); },
      // the mist at the rim of the screen (point 3), without its bays
      rim(px, py, rim) { if (rim < 0.01) return 0; const inner = 1.3 + (0.5 - 1.3) * rim; return (Math.hypot(px / (W / H), py) - inner) / 0.5; },
    };
  }

  // ---------- the shaders ----------
  const NOISE = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
// the spot of the map under a dot of the screen (p), the geometry above backwards. q: the dot turned to the map's own
// up and down; gone: 1 where there is no map under it (past the horizon, round the bulge)
vec2 mapAt(vec2 p, out vec2 q, out float gone) {
  float ct = cos(uTurn); float st = sin(uTurn);
  q = vec2(ct * p.x + st * p.y, -st * p.x + ct * p.y);
  float r = length(q);
  gone = 0.0;
  vec2 q2 = q;
  if (uKb > 0.001 && r > 0.00001) { float kr = uKb * r; gone = smoothstep(${(KR_MAX - 0.32).toFixed(2)}, ${(KR_MAX - 0.02).toFixed(2)}, kr); q2 = q * (tan(min(kr, ${KR_MAX.toFixed(2)})) / kr); }
  float den = uTilt.x * D + q2.y * uTilt.y;
  gone = max(gone, 1.0 - smoothstep(0.06, 0.5, den));
  float v = q2.y * D / max(den, 0.06);
  float u = q2.x * (D - v * uTilt.y) / D;
  return uCam.xy + uCam.z * vec2(u, v);
}
// how much mist lies on this dot: 0 clear map, 1 and more only mist (m: its spot on the map, p: on the screen)
float mistAt(vec2 m, vec2 p, float asp, float gone) {
  vec2 dd = 0.5 * uRect.zw - abs(m - (uRect.xy + 0.5 * uRect.zw)); // inches to the picture's sides (outside: negative)
  if (uPlain > 0.5) return min(dd.x, dd.y) < 0.0 ? 2.0 : 0.0;     // (the GM's flat map: no mist, the picture simply ends)
  float W = max(1.0, uMist.x * uRes.y * ${REACH.toFixed(2)});
  // 1: screen pixels of map left before it ends, toward the side where it ends soonest
  float a = dd.x / (length(vec2(dFdx(dd.x), dFdy(dd.x))) + 1e-7); float b = dd.y / (length(vec2(dFdx(dd.y), dFdy(dd.y))) + 1e-7);
  float k = 0.3 * W; float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  float left = mix(b, a, h) - k * h * (1.0 - h);                    // (the nearer of the two, with a round corner)
  float bays = fbm(p * 1.15 + vec2(uTime * 0.010, -uTime * 0.006)) - 0.47; // big, slow, soft
  float e1 = 1.0 - (left + bays * W * 1.2) / W;
  // 2: squeezed land
  float e2 = smoothstep(3.5, 9.0, max(length(dFdx(m)), length(dFdy(m))) / (uCam.z / (0.5 * uRes.y))) * 1.3;
  // 3: the rim of the screen
  float e3 = uMist.y < 0.01 ? 0.0 : (length(p / vec2(asp, 1.0)) - mix(1.3, 0.5, uMist.y) + bays * 0.4) / 0.5;
  float raw = max(max(max(e1, e2), e3), gone * 2.0);
  // (Beta 3.13) the mist closing over everything while the TV travels from one map into another
  return uVeil > 0.001 ? mix(max(raw, -1.2), 1.9 + bays * 0.9, uVeil) : raw;
}
// its colour there: the mist itself, and what lies beyond it (faint slow clouds, or a drift of smoke in the dark)
vec3 mistCol(vec2 p, float raw) {
  float deep = smoothstep(1.0, 2.4, raw);
  float n = fbm(p * 1.6 + vec2(uTime * 0.014, uTime * 0.005));
  if (uMist.z > 0.5) return mix(vec3(0.030, 0.034, 0.045), vec3(0.085, 0.095, 0.12) * smoothstep(0.38, 0.75, n), deep);
  return mix(vec3(0.955, 0.965, 0.985), mix(vec3(0.74, 0.80, 0.91), vec3(0.98, 0.985, 1.0), smoothstep(0.34, 0.7, n)), deep);
}`;
  const HEAD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec4 uRect; uniform vec3 uCam; uniform float uTurn; uniform float uKb; uniform vec2 uTilt;
uniform float uTime; uniform float uPlain; uniform vec3 uMist; // reach, rim, dark
uniform float uVeil; // 0 … 1: the mist closing over the whole picture (travelling from map to map)
const float D = ${CAM_D.toFixed(2)};`;
  const VS = '#version 300 es\nin vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';
  const FS = `${HEAD}
uniform sampler2D uTex; uniform float uBlur; uniform float uReady;
uniform float uSun; // sunshine
out vec4 o;
${NOISE}
void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y); p.y = -p.y;
  vec2 q; float gone;
  vec2 m = mapAt(p, q, gone);
  float r = length(q);
  vec2 uv = (m - uRect.xy) / uRect.zw;
  // (what the dots need from their neighbours is worked out first: after that, whole parts are skipped where they do not show)
  vec2 dx = dFdx(uv); vec2 dy = dFdy(uv);
  float raw = uReady > 0.5 ? mistAt(m, p, asp, gone) : 2.0;
  float mist = uPlain > 0.5 ? step(1.0, raw) : smoothstep(0.0, 1.0, raw);
  vec3 col = vec3(0.0);
  float far = smoothstep(0.18, 1.0, -q.y);
  if (mist < 0.999) {
    // depth of field: sharp in the middle, soft toward the far and the near edge
    float b = uBlur * clamp(far + 0.8 * smoothstep(0.45, 1.05, q.y) + 0.5 * smoothstep(0.9, 1.9, r), 0.0, 1.6);
    float R = b * uRes.y * 0.0075;
    if (R < 0.4) col = textureGrad(uTex, uv, dx, dy).rgb;
    else {
      float wide = 1.0 + R * 0.5;
      for (int i = 0; i < 9; i++) {
        float ang = float(i) * 2.39996; float rr = sqrt((float(i) + 0.5) / 9.0) * R;
        col += textureGrad(uTex, uv + dx * (cos(ang) * rr) + dy * (sin(ang) * rr), dx * wide, dy * wide).rgb;
      }
      col /= 9.0;
    }
    if (uPlain < 0.5) {
      col = mix(col, vec3(0.80, 0.86, 0.92), far * 0.22 * uTilt.y * (1.0 - uMist.z)); // the far side pales, as land does toward the horizon
      col = col * mix(vec3(1.0), vec3(1.12, 1.05, 0.90), uSun) + uSun * 0.06 * vec3(1.0, 0.92, 0.7); // sunshine: warm and bright
    }
  }
  // ---- the mist ----
  if (uPlain > 0.5) col = mix(col, vec3(0.075, 0.085, 0.10), mist);
  else if (mist > 0.001) col = mix(col, mistCol(p, raw), mist);
  o = vec4(col, 1.0);
}`;
  // An animated asset: a moving picture laid onto the map. It is drawn the way the map is: for every dot of the screen
  // inside the box it can lie in, the spot of the map under it is worked out, and what the asset shows there. (Beta 3.12
  // bent a small grid forward instead; where an asset reached below the screen its corners flew off and it was drawn
  // as long streaks.)
  const AVS = '#version 300 es\nin vec2 aPos; uniform vec4 uBounds; void main() { gl_Position = vec4(mix(uBounds.xy, uBounds.zw, aPos * 0.5 + 0.5), 0.0, 1.0); }';
  const AFS = `${HEAD}
uniform sampler2D uTex; uniform vec3 uLook; // opacity, darken, hue (radians)
uniform vec4 uBox; uniform vec3 uRot;       // its middle and half its size (map inches); cos, sin, mirrored
out vec4 o;
${NOISE}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y); p.y = -p.y;
  vec2 q; float gone;
  vec2 m = mapAt(p, q, gone);
  float ms = mistAt(m, p, uRes.x / uRes.y, gone);
  vec2 d = m - uBox.xy;
  vec2 uv = vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y) / (2.0 * uBox.zw) + 0.5;
  if (gone > 0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  if (uRot.z > 0.5) uv.x = 1.0 - uv.x;
  vec4 c = textureLod(uTex, uv, 0.0); // (its colours come multiplied by how solid it is)
  if (c.a < 0.004) discard;
  vec3 rgb = c.rgb / c.a;
  if (abs(uLook.z) > 0.001) { // its colours turned round the colour wheel
    float co = cos(uLook.z); float si = sin(uLook.z); vec3 k = vec3(0.57735);
    rgb = rgb * co + cross(k, rgb) * si + k * dot(k, rgb) * (1.0 - co);
  }
  rgb *= 1.0 - uLook.y;
  float a = c.a * uLook.x * (1.0 - smoothstep(0.0, 1.0, ms));
  o = vec4(clamp(rgb, 0.0, 1.0) * a, a);
}`;

  // the mist without the graphics card: the same billows, worked out coarsely on the processor
  const hash2 = (x, y) => { let px = (x * 123.34) % 1; let py = (y * 456.21) % 1; if (px < 0) px += 1; if (py < 0) py += 1; const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; const v = (px * py) % 1; return v < 0 ? v + 1 : v; };
  const vnoise = (x, y) => { const ix = Math.floor(x); const iy = Math.floor(y); let fx = x - ix; let fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy); const b = hash2(ix + 1, iy); const c = hash2(ix, iy + 1); const d = hash2(ix + 1, iy + 1); return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy; };
  const fbm = (x, y, oct = 4) => { let a = 0.5; let s = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; } return s; };

  // ---------- what stands: how a place looks ----------
  const DEFS = '<svg width="0" height="0" style="position:absolute"><defs>'
    + '<linearGradient id="atlg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe7a8"/><stop offset=".5" stop-color="#c9973a"/><stop offset="1" stop-color="#7c5a1c"/></linearGradient>'
    + '<radialGradient id="atlg-shade" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>'
    + '<linearGradient id="atlg-pin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>'
    + '</defs></svg>';
  const SHAPE = {
    // a coin with a gold rim on a short point (the spot it marks is at 0, 0; one unit is a 26th of its size)
    medallion: '<svg viewBox="-40 -108 80 110" class="atl-shape"><ellipse cx="0" cy="0" rx="20" ry="6" fill="rgba(0,0,0,.45)"/><path d="M-9 -34L0 -2L9 -34z" fill="url(#atlg-gold)" stroke="#2f2209" stroke-width="1.5"/>'
      + '<circle cx="0" cy="-68" r="38" fill="url(#atlg-gold)" stroke="#2f2209" stroke-width="2"/><circle cx="0" cy="-68" r="30" fill="var(--c)"/><circle cx="0" cy="-68" r="30" fill="url(#atlg-shade)" stroke="#2f2209" stroke-width="1.5"/></svg>',
    // a slim diamond on a line over a ring on the ground
    diamond: '<svg viewBox="-40 -126 80 136" class="atl-shape"><ellipse class="atl-ground" cx="0" cy="0" rx="26" ry="8" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="5"/><ellipse class="atl-ground" cx="0" cy="0" rx="26" ry="8" fill="none" stroke="var(--c)" stroke-width="2.5"/>'
      + '<line x1="0" y1="-2" x2="0" y2="-52" stroke="rgba(0,0,0,.5)" stroke-width="5"/><line x1="0" y1="-2" x2="0" y2="-52" stroke="var(--c)" stroke-width="2"/>'
      + '<g transform="translate(0,-86) rotate(45)"><rect x="-27" y="-27" width="54" height="54" rx="6" fill="#0f1a24" stroke="rgba(0,0,0,.9)" stroke-width="5"/><rect x="-27" y="-27" width="54" height="54" rx="6" fill="#0f1a24" fill-opacity=".9" stroke="var(--c)" stroke-width="2.5"/></g></svg>',
    // a pin with a dark eye
    pin: '<svg viewBox="-40 -100 80 102" class="atl-shape"><ellipse cx="0" cy="0" rx="18" ry="5.5" fill="rgba(0,0,0,.45)"/><path d="M0 -2C-4 -18 -30 -38 -30 -62a30 30 0 0 1 60 0c0 24-26 44-30 60z" fill="var(--c)" stroke="#2a1d08" stroke-width="2.5"/>'
      + '<path d="M0 -2C-4 -18 -30 -38 -30 -62a30 30 0 0 1 60 0c0 24-26 44-30 60z" fill="url(#atlg-pin)"/><circle cx="0" cy="-62" r="20" fill="#1b1d22" stroke="#2a1d08" stroke-width="1.5"/></svg>',
  };
  const SIMPLE = {
    pin: '<svg viewBox="0 0 24 32" class="pin"><path d="M12 31c-1-4-9-11-9-18a9 9 0 0 1 18 0c0 7-8 14-9 18z" fill="var(--c)" stroke="rgba(0,0,0,0.6)" stroke-width="1.5"/><circle cx="12" cy="12.5" r="3.6" fill="rgba(255,255,255,0.92)"/></svg>',
    x: '<svg viewBox="0 0 24 24" class="xmark"><path d="M5 5l14 14M19 5L5 19" stroke="rgba(0,0,0,0.6)" stroke-width="7" stroke-linecap="round"/><path d="M5 5l14 14M19 5L5 19" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/></svg>',
  };

  // opts.edit: the GM's Map table (no fade of its own, what stands can be clicked, a camera and a plain look of its own)
  function mount(root, opts = {}) {
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    let cv = el('canvas', 'atl-cv'); const mistCv = el('canvas', 'atl-clouds'); const dof = el('div', 'atl-dof'); const tint = el('div', 'atl-tint'); const labels = el('div', 'atl-labels');
    const veilEl = el('div', 'atl-veil'); const wxCv = el('canvas', 'atl-wx'); // the mist closing while it travels (without the card); the weather falling over it all
    dof.append(el('i', 'far'), el('i', 'near'));
    const defs = el('div'); defs.innerHTML = DEFS;
    root.append(defs, cv, dof, mistCv, tint, labels, wxCv, veilEl);
    root.classList.add('atl-root'); if (opts.edit) root.classList.add('edit');
    const surf = document.createElement('canvas'); // the flat map
    let gl = null; let glBad = false; let prog = null; let aprog = null; let tex = null; let quad = null; let uni = {}; let auni = {}; let maxTex = 2048;
    let cur = null; let viewInfo = null; let dead = false;
    let running = false; let raf = 0; let lastT = 0; const t0 = performance.now();
    let cam = null; let camT = null; let look = null; let lookT = null;
    let edit = null; // the GM's own way of looking at it: { cam: { cx, cy, S }, plain: true } (null: as on the TV)
    let selected = null; let onDraw = null;
    let surfRect = null; let surfPpi = 1; let surfSig = ''; let surfOk = false; let texDirty = false;
    let drawnSig = ''; let mistSig = ''; let labelSig = '';
    let quality = 1; let slow = 0; let lastDraw = 0;
    // (Beta 3.13) travelling from one map into another: the camera dives into a place (or pulls away), the mist closes
    // over everything, the maps change under it, and the mist opens on the new one
    let trip = null; let lastTrip = 0; let veil = 0;
    let wxOn = false; const heard = new Set(); // the weather drawn over it; the flashes whose thunder was asked for
    const media = new Map(); // url -> { el, ok, w, h, kind, tex }
    const nodes = new Map(); // what stands: id -> element
    let live = []; // the animated assets drawn as moving pictures this frame
    let liveVideo = false; let lastVideoT = 0; let waiters = [];

    // ---------- pictures ----------
    function pic(url, kind) {
      if (!url) return null;
      let m = media.get(url);
      if (m) return m;
      m = { el: null, ok: false, w: 0, h: 0, kind, tex: null };
      const done = (w, h) => { m.ok = w > 0 && h > 0; m.w = w; m.h = h; surfSig = ''; };
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.addEventListener('loadeddata', () => { done(v.videoWidth, v.videoHeight); v.play().catch(() => {}); });
        m.el = v;
      } else {
        const i = new Image();
        i.onload = () => done(i.naturalWidth, i.naturalHeight);
        i.onerror = () => done(0, 0);
        i.src = url;
        m.el = i;
      }
      media.set(url, m);
      return m;
    }

    // ---------- where the camera looks: the middle of the map's table frame ----------
    const frameOf = (v) => { const w = viewInfo.world.w / viewInfo.ppi / v.zoom; const hh = viewInfo.world.h / viewInfo.ppi / v.zoom; return { x: -v.x / v.zoom, y: -v.y / v.zoom, w, h: hh }; };
    const camOf = (v) => { const r = frameOf(v); return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, S: r.h / 2 }; };
    const air = () => { const a = (cur && cur.map.atlas) || {}; return { dark: a.mist === 'dark', reach: a.reach ?? 0.5, rim: a.rim ?? 0.3, sun: (a.weather && a.weather.sun) || 0 }; };
    const plain = () => !!(edit && edit.plain);

    // where the picture lies on the map (as scene-view.js places it), and the box it takes up turned
    function bgPlace(map) {
      const bg = map.bg; const m = bg && pic(bg.url, bg.kind);
      if (!bg || !m || !m.ok) return null;
      let p;
      if (bg.scale == null && bg.span) { const sc = bg.span / m.w; p = { x: bg.x || 0, y: bg.y || 0, w: bg.span, h: m.h * sc }; }
      else if (bg.scale == null) { const r = frameOf({ x: 0, y: 0, zoom: 1 }); const s = Math.min(r.w / m.w, r.h / m.h); p = { x: r.x + (r.w - m.w * s) / 2, y: r.y + (r.h - m.h * s) / 2, w: m.w * s, h: m.h * s }; } // (never placed by hand: it fills the table at its first size, wherever the frame went since)
      else p = { x: bg.x, y: bg.y, w: m.w * bg.scale, h: m.h * bg.scale };
      const a = (bg.rotation || 0) * D2R; const co = Math.abs(Math.cos(a)); const si = Math.abs(Math.sin(a));
      const cx = p.x + p.w / 2; const cy = p.y + p.h / 2; const bw = p.w * co + p.h * si; const bh = p.w * si + p.h * co;
      return { ...p, cx, cy, rot: bg.rotation || 0, box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, m };
    }
    // the animated assets that get a moving picture of their own (with the graphics card, the first LIVE_MAX of them)
    const liveAssets = (map) => (gl && !plain() ? (map.layers || []).filter((l) => l.role === 'asset' && !l.hidden && l.kind === 'video').slice(0, LIVE_MAX) : []); // (on the GM's flat map they lie still, painted with the rest)

    // ---------- the surface: the map painted flat ----------
    function paintSurface() {
      const map = cur.map;
      const P = bgPlace(map);
      if (map.bg && !map.bg.missing && !P) return false; // (its picture is not there yet)
      const R = P ? P.box : frameOf({ x: 0, y: 0, zoom: 1 });
      const cap = gl ? Math.min(opts.edit ? 3072 : 4096, maxTex) : 2048; // (the GM's window is smaller than the TV, and it is painted anew while things are dragged)
      const want = P ? Math.max(P.m.w, P.m.h, 1600) : 1600;
      const ppi = Math.min(cap, want) / Math.max(R.w, R.h);
      const w = Math.max(2, Math.round(R.w * ppi)); const hh = Math.max(2, Math.round(R.h * ppi));
      if (surf.width !== w || surf.height !== hh) { surf.width = w; surf.height = hh; }
      const g = surf.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.filter = 'none'; g.shadowColor = 'transparent';
      g.fillStyle = '#2a2f36'; g.fillRect(0, 0, w, hh);
      g.setTransform(ppi, 0, 0, ppi, -R.x * ppi, -R.y * ppi); // from here on: map inches
      liveVideo = false;
      if (P) {
        g.save(); g.translate(P.cx, P.cy); g.rotate(P.rot * D2R);
        try { g.drawImage(P.m.el, -P.w / 2, -P.h / 2, P.w, P.h); } catch {}
        g.restore();
        if (P.m.kind === 'video') liveVideo = true;
      }
      const gr = map.grid;
      const drawGrid = () => {
        if (!gr || !gr.show || gr.size * ppi < 4) return;
        g.beginPath();
        if (!Geom.isHex(gr)) {
          const cs = [Geom.toLocal(gr, R.x, R.y), Geom.toLocal(gr, R.x + R.w, R.y), Geom.toLocal(gr, R.x, R.y + R.h), Geom.toLocal(gr, R.x + R.w, R.y + R.h)];
          const u0 = Math.min(...cs.map((q) => q.u)); const u1 = Math.max(...cs.map((q) => q.u)); const v0 = Math.min(...cs.map((q) => q.v)); const v1 = Math.max(...cs.map((q) => q.v));
          const s = gr.size;
          for (let i = Math.floor(u0 / s); i <= Math.ceil(u1 / s); i++) { const a = Geom.fromLocal(gr, i * s, v0); const b = Geom.fromLocal(gr, i * s, v1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
          for (let j = Math.floor(v0 / s); j <= Math.ceil(v1 / s); j++) { const a = Geom.fromLocal(gr, u0, j * s); const b = Geom.fromLocal(gr, u1, j * s); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
        } else Geom.eachCell(gr, R.x, R.y, R.x + R.w, R.y + R.h, (cell) => { const p = cell.poly; g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.lineTo(p[6], p[7]); });
        g.globalAlpha = gr.opacity; g.strokeStyle = gr.color; g.lineWidth = Math.max(1, (gr.width || 1) * 1.2) / ppi; g.lineCap = 'round';
        g.stroke(); g.globalAlpha = 1;
      };
      if (gr && gr.under) drawGrid();
      // assets lie on the map (the animated ones with a moving picture of their own are not painted here)
      const moving = new Set(liveAssets(map).map((l) => l.id));
      for (const l of map.layers || []) {
        if (l.role !== 'asset' || l.hidden || moving.has(l.id)) continue;
        const m = pic(l.url, l.kind);
        if (!m || !m.ok) continue;
        const aw = l.w || 1; const ah = ((aw * m.h) / m.w) * (l.stretch || 1);
        g.save();
        g.translate(l.x, l.y); g.rotate((l.rotation || 0) * D2R); g.scale(l.flip ? -1 : 1, 1);
        g.globalAlpha = l.opacity ?? 1;
        g.filter = [l.hue ? `hue-rotate(${l.hue}deg)` : '', l.dark > 0 ? `brightness(${1 - l.dark})` : ''].filter(Boolean).join(' ') || 'none';
        if (l.shadow) { g.shadowColor = 'rgba(0, 0, 0, 0.6)'; g.shadowBlur = aw * 0.06 * ppi; g.shadowOffsetX = aw * 0.05 * ppi; g.shadowOffsetY = aw * 0.08 * ppi; }
        try { g.drawImage(m.el, -aw / 2, -ah / 2, aw, ah); } catch {}
        g.restore();
      }
      if (gr && !gr.under) drawGrid();
      // pen strokes and labels: written on the map
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const d of map.draw || []) {
        if (d.hidden) continue;
        if (d.kind === 'pen' && d.pts && d.pts.length >= 2) {
          const path = () => { g.beginPath(); g.moveTo(d.pts[0], d.pts[1]); for (let i = 2; i + 1 < d.pts.length; i += 2) g.lineTo(d.pts[i], d.pts[i + 1]); if (d.pts.length === 2) g.lineTo(d.pts[0] + 0.001, d.pts[1]); };
          const lw = Math.max(1 / ppi, d.w);
          path(); g.strokeStyle = lightOf(d.color) < 0.4 ? 'rgba(250, 242, 222, 0.45)' : 'rgba(0, 0, 0, 0.5)'; g.lineWidth = lw + Math.max(2 / ppi, lw * 0.6); g.stroke();
          path(); g.strokeStyle = d.color; g.lineWidth = lw; g.stroke();
        } else if (d.kind === 'text' && d.text) {
          g.font = `700 ${d.size}px Alegreya, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = d.size * 0.16; g.strokeStyle = lightOf(d.color) < 0.4 ? 'rgba(250, 242, 222, 0.8)' : 'rgba(0, 0, 0, 0.75)'; g.strokeText(d.text, d.x, d.y); // (dark ink gets a light edge, light ink a dark one)
          g.fillStyle = d.color; g.fillText(d.text, d.x, d.y);
        }
      }
      // routes: dotted from point to point
      const dot = Math.max(R.w, R.h) * 0.0032;
      for (const m of map.marks || []) {
        if (m.kind !== 'route' || m.hidden || !m.pts || m.pts.length < 2) continue;
        const path = () => { g.beginPath(); g.moveTo(m.pts[0], m.pts[1]); for (let i = 2; i + 1 < m.pts.length; i += 2) g.lineTo(m.pts[i], m.pts[i + 1]); };
        g.setLineDash([0.001, dot * 2.6]);
        path(); g.strokeStyle = 'rgba(0, 0, 0, 0.55)'; g.lineWidth = dot * 1.7; g.stroke();
        path(); g.strokeStyle = m.color; g.lineWidth = dot; g.stroke();
        g.setLineDash([]);
        for (let i = 0; i + 1 < m.pts.length; i += 2) { g.beginPath(); g.arc(m.pts[i], m.pts[i + 1], dot * 1.15, 0, Math.PI * 2); g.fillStyle = m.color; g.fill(); g.lineWidth = dot * 0.35; g.strokeStyle = 'rgba(0, 0, 0, 0.6)'; g.stroke(); }
      }
      surfRect = R; surfPpi = ppi; surfOk = true; texDirty = true; drawnSig = '';
      for (const w8 of waiters.splice(0)) w8(true);
      return true;
    }
    const surfaceSig = (map) => { const mov = new Set(liveAssets(map).map((l) => l.id)); return JSON.stringify([map.bg && [map.bg.url, map.bg.x, map.bg.y, map.bg.scale, map.bg.span, map.bg.rotation, (pic(map.bg.url, map.bg.kind) || {}).ok], map.grid,
      (map.layers || []).filter((l) => l.role === 'asset' && !mov.has(l.id)).map((l) => [l.url, l.x, l.y, l.w, l.rotation, l.flip, l.stretch, l.hue, l.dark, l.opacity, l.shadow, l.hidden, (pic(l.url, l.kind) || {}).ok]),
      [...mov], map.draw, (map.marks || []).filter((m) => m.kind === 'route'), gl ? 1 : 0, plain() ? 1 : 0]); };

    // ---------- the graphics card ----------
    function initGl() {
      if (gl || glBad) return;
      try {
        const g = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', premultipliedAlpha: true });
        if (!g) { glBad = true; root.classList.add('flat'); return; }
        const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader'); return s; };
        const link = (vs, fs) => { const p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.bindAttribLocation(p, 0, 'aPos'); g.linkProgram(p); if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) || 'link'); return p; };
        const names = (p, list) => Object.fromEntries(list.map((n) => [n, g.getUniformLocation(p, n)]));
        const shared = ['uRes', 'uRect', 'uCam', 'uTurn', 'uKb', 'uTilt', 'uTime', 'uPlain', 'uMist', 'uVeil', 'uTex'];
        const p = link(VS, FS); const ap = link(AVS, AFS);
        uni = names(p, [...shared, 'uBlur', 'uReady', 'uSun']); auni = names(ap, [...shared, 'uBox', 'uRot', 'uLook', 'uBounds']);
        quad = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, quad); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
        g.enableVertexAttribArray(0);
        tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        const an = g.getExtension('EXT_texture_filter_anisotropic');
        if (an) g.texParameterf(g.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([42, 47, 54, 255]));
        maxTex = g.getParameter(g.MAX_TEXTURE_SIZE) || 2048;
        gl = g; prog = p; aprog = ap;
        // the card gone mid-game: a fresh canvas, drawn without it from here on
        cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; glBad = true; surfSig = ''; drawnSig = ''; for (const m of media.values()) m.tex = null; const fresh = el('canvas', 'atl-cv'); cv.replaceWith(fresh); cv = fresh; root.classList.add('flat'); });
      } catch (e) { gl = null; glBad = true; console.warn('[atlas] no graphics card drawing:', e && e.message); }
      root.classList.toggle('flat', !gl);
    }
    function shared(u, G, t, A) {
      const R = surfRect || { x: 0, y: 0, w: 1, h: 1 };
      gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uRes, cv.width, cv.height);
      gl.uniform4f(u.uRect, R.x, R.y, R.w, R.h); gl.uniform3f(u.uCam, cam.cx, cam.cy, cam.S);
      gl.uniform1f(u.uTurn, G.tr); gl.uniform1f(u.uKb, G.kb); gl.uniform2f(u.uTilt, G.c, G.s);
      gl.uniform1f(u.uTime, t / 1000); gl.uniform1f(u.uPlain, plain() ? 1 : 0); gl.uniform3f(u.uMist, A.reach, A.rim, A.dark ? 1 : 0);
      gl.uniform1f(u.uVeil, plain() ? 0 : veil);
    }
    function drawGl(G, t, L) {
      const A = air();
      gl.viewport(0, 0, cv.width, cv.height);
      gl.disable(gl.BLEND);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (texDirty && surfOk) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surf); gl.generateMipmap(gl.TEXTURE_2D); texDirty = false; }
      shared(uni, G, t, A);
      gl.uniform1f(uni.uBlur, L.blur); gl.uniform1f(uni.uReady, surfOk ? 1 : 0);
      gl.uniform1f(uni.uSun, A.sun);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // animated assets: each a small moving picture laid onto the map
      if (!live.length || !surfOk) return;
      gl.useProgram(aprog);
      shared(auni, G, t, A);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      for (const l of live) {
        const m = pic(l.url, 'video');
        if (!m || !m.ok || m.el.readyState < 2) continue;
        if (!m.tex) { m.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, m.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); m.at = -1; }
        gl.bindTexture(gl.TEXTURE_2D, m.tex);
        if (m.at !== m.el.currentTime) { try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, m.el); m.at = m.el.currentTime; } catch { continue; } }
        const aw = l.w || 1; const ah = ((aw * m.h) / m.w) * (l.stretch || 1); const a = (l.rotation || 0) * D2R; const co = Math.cos(a); const si = Math.sin(a);
        // the box of the screen it can lie in: round its outline (the whole screen when a part of it lies nearer than the eye)
        let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9; let whole = false;
        for (let i = 0; i < 32 && !whole; i++) {
          const e = i >> 3; const f = (i & 7) / 8;
          const lx = ((e === 0 ? -1 + 2 * f : e === 1 ? 1 : e === 2 ? 1 - 2 * f : -1) * aw) / 2; const ly = ((e === 0 ? -1 : e === 1 ? -1 + 2 * f : e === 2 ? 1 : 1 - 2 * f) * ah) / 2;
          const q = G.toScreen(l.x + lx * co - ly * si, l.y + lx * si + ly * co);
          if (!q) whole = true; else { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        }
        if (whole) { x0 = 0; y0 = 0; x1 = G.W; y1 = G.H; }
        const pad = 4 + 0.06 * Math.max(x1 - x0, y1 - y0);
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(G.W, x1 + pad); y1 = Math.min(G.H, y1 + pad);
        if (x1 <= x0 || y1 <= y0) continue; // (off the screen)
        gl.uniform4f(auni.uBounds, (x0 / G.W) * 2 - 1, 1 - (y1 / G.H) * 2, (x1 / G.W) * 2 - 1, 1 - (y0 / G.H) * 2);
        gl.uniform4f(auni.uBox, l.x, l.y, aw / 2, ah / 2); gl.uniform3f(auni.uRot, co, si, l.flip ? 1 : 0);
        gl.uniform3f(auni.uLook, l.opacity ?? 1, l.dark || 0, (l.hue || 0) * D2R);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // ---------- without it: the same bend with a mesh of small triangles, a coarse mist, two soft bands ----------
    function tri(g, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
      const den = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
      if (Math.abs(den) < 1e-6) return;
      const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / den; const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / den;
      const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / den; const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / den;
      const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / den; const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / den;
      const mx = (x0 + x1 + x2) / 3; const my = (y0 + y1 + y2) / 3; const grow = (x, y) => { const dx = x - mx; const dy = y - my; const l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * 0.8, y + (dy / l) * 0.8]; }; // (a hair bigger: no seams)
      const A = grow(x0, y0); const B = grow(x1, y1); const C = grow(x2, y2);
      g.save(); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.closePath(); g.clip();
      g.setTransform(a, b, c, d, e, f); g.drawImage(surf, 0, 0); g.restore();
    }
    function drawFlat(G) {
      const sig = JSON.stringify([cam, G.c, G.kb, G.tr, cv.width, cv.height, surfOk, surfSig, plain()]);
      if (sig === drawnSig) return;
      drawnSig = sig;
      const g = cv.getContext('2d');
      const W = cv.width; const H = cv.height;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = plain() ? '#13161a' : (air().dark ? '#08090c' : '#f3f6fa'); g.fillRect(0, 0, W, H);
      if (!surfOk) return;
      const NX = 40; const NY = 24; const R = surfRect; const k = surfPpi;
      const row = (j) => { const out = []; for (let i = 0; i <= NX; i++) { const m = G.toMap((i / NX) * G.W, (j / NY) * G.H); out.push(m ? [(m.x - R.x) * k, (m.y - R.y) * k] : null); } return out; };
      let top = row(0);
      const inside = (p) => p[0] > -surf.width && p[0] < 2 * surf.width && p[1] > -surf.height && p[1] < 2 * surf.height;
      for (let j = 0; j < NY; j++) {
        const bot = row(j + 1);
        const y0 = (j / NY) * H; const y1 = ((j + 1) / NY) * H;
        for (let i = 0; i < NX; i++) {
          const a = top[i]; const b = top[i + 1]; const c = bot[i]; const d = bot[i + 1];
          if (!a || !b || !c || !d || !(inside(a) || inside(b) || inside(c) || inside(d))) continue;
          const x0 = (i / NX) * W; const x1 = ((i + 1) / NX) * W;
          tri(g, x0, y0, x1, y0, x0, y1, a[0], a[1], b[0], b[1], c[0], c[1]);
          tri(g, x1, y0, x1, y1, x0, y1, b[0], b[1], d[0], d[1], c[0], c[1]);
        }
        top = bot;
      }
    }
    // the mist as a coarse picture over the map: the same three measures, counted from one coarse dot to the next
    function drawMist(G) {
      const A = air();
      const sig = JSON.stringify([cam, look, A.reach, A.rim, A.dark, surfOk, surfRect, G.W, G.H, plain()]);
      if (sig === mistSig) return;
      mistSig = sig;
      const w = Math.max(40, Math.round(G.W / 10)); const hh = Math.max(24, Math.round(G.H / 10));
      if (mistCv.width !== w || mistCv.height !== hh) { mistCv.width = w; mistCv.height = hh; }
      const g = mistCv.getContext('2d'); const img = g.createImageData(w, hh); const d = img.data;
      if (plain() || !surfOk) { g.putImageData(img, 0, 0); return; }
      const R = surfRect; const half = G.H / 2; const step = G.W / w; const W = Math.max(1, A.reach * G.H * REACH);
      const ax = new Float32Array(w * hh); const ay = new Float32Array(w * hh); const mxs = new Float32Array(w * hh); const mys = new Float32Array(w * hh); const ok = new Uint8Array(w * hh);
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
        const m = G.toMap((i + 0.5) * step, ((j + 0.5) / hh) * G.H); const o = j * w + i;
        if (!m) continue;
        ok[o] = 1; mxs[o] = m.x; mys[o] = m.y;
        ax[o] = R.w / 2 - Math.abs(m.x - (R.x + R.w / 2)); ay[o] = R.h / 2 - Math.abs(m.y - (R.y + R.h / 2));
      }
      const s0 = cam.S / half; const col = A.dark ? [8, 9, 12] : [244, 246, 251];
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
        const o = j * w + i; const px = ((i + 0.5) * step - G.W / 2) / half; const py = (((j + 0.5) / hh) * G.H - G.H / 2) / half;
        let raw = 2;
        const i1 = Math.min(w - 1, i + 1); const i0 = Math.max(0, i - 1); const j1 = Math.min(hh - 1, j + 1); const j0 = Math.max(0, j - 1);
        if (ok[o] && ok[j * w + i1] && ok[j * w + i0] && ok[j1 * w + i] && ok[j0 * w + i]) {
          const gx = (arr) => Math.hypot((arr[j * w + i1] - arr[j * w + i0]) / ((i1 - i0) * step), (arr[j1 * w + i] - arr[j0 * w + i]) / ((j1 - j0) * step)) + 1e-7;
          const left = Math.min(ax[o] / gx(ax), ay[o] / gx(ay));
          const bays = fbm(px * 1.15, py * 1.15) - 0.47;
          const sq = Math.max(Math.hypot(mxs[j * w + i1] - mxs[j * w + i0], mys[j * w + i1] - mys[j * w + i0]) / ((i1 - i0) * step), Math.hypot(mxs[j1 * w + i] - mxs[j0 * w + i], mys[j1 * w + i] - mys[j0 * w + i]) / ((j1 - j0) * step));
          raw = Math.max(1 - (left + bays * W * 1.2) / W, sstep(3.5, 9, sq / s0) * 1.3, A.rim < 0.01 ? 0 : G.rim(px, py, A.rim) + bays * 0.8);
        }
        d[o * 4] = col[0]; d[o * 4 + 1] = col[1]; d[o * 4 + 2] = col[2]; d[o * 4 + 3] = Math.round(sstep(0, 1, raw) * 255);
      }
      g.putImageData(img, 0, 0);
    }

    // ---------- what stands on the map ----------
    function standing(map) {
      const out = [];
      for (const m of map.marks || []) {
        if (m.kind === 'note' || (m.hidden && !opts.edit)) continue;
        if (m.kind === 'route') { if (m.pts && m.pts.length >= 2) out.push({ id: m.id, kind: 'route', x: m.x, y: m.y, color: m.color, title: m.title || '', sub: m.pts.length >= 4 ? Geom.routeLabel(map.grid, m) : '', hidden: !!m.hidden }); continue; }
        out.push({ id: m.id, kind: m.kind, x: m.x, y: m.y, color: m.color || '#e3963e', title: m.title || m.label || '', sub: m.kind === 'counter' ? String(m.value) : m.sub || '', n: m.n, style: STYLES[m.style] ? m.style : 'medallion', icon: m.icon || 'flag',
          note: cur.note && cur.note.id === m.id ? m.note : '', hidden: !!m.hidden, leads: !!m.to });
      }
      for (const l of map.layers || []) if (l.role === 'token' && !l.hidden) out.push({ id: l.id, kind: 'token', x: l.x, y: l.y, url: l.url, size: (l.size || 1) * ((map.grid && map.grid.size) || 1) });
      if (opts.edit) for (const d of map.draw || []) if (d.kind === 'text') out.push({ id: d.id, kind: 'text', x: d.x, y: d.y }); // (the GM grabs a written label by a small handle)
      return out;
    }
    function buildNode(it) {
      const e = el('div', `atl-s kind-${it.kind}${it.hidden ? ' is-hidden' : ''}`);
      e.dataset.id = it.id;
      const inner = el('div', 'atl-s-in'); e.append(inner);
      const words = (cls) => { const p = el('div', cls); if (it.title) { const t = el('b'); t.textContent = it.title; p.append(t); } if (it.kind === 'route' && it.title && it.sub) p.append(el('i', 'atl-rule')); if (it.sub) { const s = el('span'); s.textContent = it.sub; p.append(s); } return p; };
      if (it.kind === 'place') {
        e.classList.add(`st-${it.style}`);
        if (it.style === 'diamond') { const p = words('atl-words'); if (it.sub && it.title) p.insertBefore(el('i', 'atl-rule'), p.lastChild); inner.append(p); }
        else inner.append(words(`atl-plate ${it.style === 'medallion' ? 'parch' : 'dark'}`));
        const body = el('div', 'atl-body'); body.innerHTML = SHAPE[it.style] + `<span class="atl-ico">${typeof icon === 'function' ? icon(iconOf(it.icon)) : ''}</span>`;
        inner.append(body);
        if (it.note) { const n = el('div', 'atl-note'); n.textContent = it.note; e.append(n); }
      } else if (it.kind === 'route') inner.append(words('atl-words'));
      else if (it.kind === 'pin') inner.innerHTML = SIMPLE.pin;
      else if (it.kind === 'x') inner.innerHTML = SIMPLE.x;
      else if (it.kind === 'dot') { const b = el('b', 'atl-dot'); b.textContent = String(it.n ?? ''); inner.append(b); }
      else if (it.kind === 'counter') { const a = el('span', 'atl-count'); const t = el('span'); t.textContent = it.title; const v = el('b'); v.textContent = it.sub; a.append(t, v); inner.append(a); }
      else if (it.kind === 'token') { const i = el('img', 'atl-tok'); i.alt = ''; i.draggable = false; i.src = it.url || ''; inner.append(i); }
      else if (it.kind === 'text') inner.append(el('i', 'atl-grab'));
      return e;
    }
    let items = [];
    function syncNodes() {
      items = cur ? standing(cur.map) : [];
      const sig = JSON.stringify(items.map((it) => [it.id, it.kind, it.color, it.title, it.sub, it.n, it.note, it.url, it.style, it.icon, it.hidden]));
      if (sig !== labelSig) {
        labelSig = sig;
        labels.innerHTML = ''; nodes.clear();
        for (const it of items) { const e = buildNode(it); e.style.setProperty('--c', it.color || '#e3963e'); e.style.setProperty('--ink', lightOf(it.color || '#e3963e') > 0.62 ? '#1d1a14' : '#fff'); nodes.set(it.id, e); labels.append(e); }
      }
      for (const [id, e] of nodes) e.classList.toggle('sel', id === selected);
    }
    // how much mist lies on a spot of the map (as the shader counts it, without the bays): what stands fades by it
    function mistOn(G, p, x, y, A) {
      if (plain() || !surfRect) return 0;
      const R = surfRect; const cx = clamp(x, R.x, R.x + R.w); const cy = clamp(y, R.y, R.y + R.h);
      const dl = cx - R.x; const dr = R.x + R.w - cx; const dt = cy - R.y; const db = R.y + R.h - cy; const least = Math.min(dl, dr, dt, db);
      const edge = least === dl ? [R.x, cy] : least === dr ? [R.x + R.w, cy] : least === dt ? [cx, R.y] : [cx, R.y + R.h];
      const q = G.toScreen(edge[0], edge[1]);
      const left = q ? Math.hypot(q.x - p.x, q.y - p.y) : 1e6;
      const W = Math.max(1, A.reach * G.H * REACH);
      return Math.max(1 - left / W, sstep(3.5, 9, 1 / Math.max(p.scale, 1e-3)) * 1.3, G.rim(p.px, p.py, A.rim));
    }
    // Each is written once at its biggest size and then only moved, turned and scaled (never set in a new size):
    // that costs the graphics card next to nothing while the camera flies, and the letters never have to be made anew.
    function placeNodes(G, L) {
      const BIG = 1.7; const base = G.H * 0.021 * BIG; const tok = G.H * 0.12; const A = air();
      for (const it of items) {
        const e = nodes.get(it.id); if (!e) continue;
        const p = G.toScreen(it.x, it.y);
        const m = 0.25;
        if (!p || p.x < -G.W * m || p.x > G.W * (1 + m) || p.y < -G.H * m || p.y > G.H * (1 + m)) { e.style.display = 'none'; continue; }
        const op = (1 - sstep(0.35, 0.9, mistOn(G, p, it.x, it.y, A))) * (plain() ? 1 : 1 - veil);
        if (op < 0.02) { e.style.display = 'none'; continue; }
        const soft = plain() ? 0 : G.soft(p.qx, p.qy, L.blur) * G.H * 0.0045;
        const full = it.kind === 'token' ? tok : base;
        const k = it.kind === 'token' ? clamp(it.size * (G.H / 2 / cam.S) * p.scale, G.H * 0.012, tok) / tok : (plain() ? 0.62 : clamp(p.scale, 0.42, BIG) / BIG);
        const fs = `${full.toFixed(2)}px`;
        if (e.style.fontSize !== fs) e.style.fontSize = fs;
        e.style.display = '';
        e.style.opacity = op.toFixed(3);
        e.style.zIndex = String(1000 + Math.round(p.qy * 400));
        e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${L.turn.toFixed(2)}deg) scale(${k.toFixed(4)})`;
        const blur = soft > 0.6 ? `blur(${(soft / k).toFixed(1)}px)` : '';
        if (e.style.filter !== blur) e.style.filter = blur;
        e.style.setProperty('--flat', G.c.toFixed(3)); // (the ring on the ground lies as flat as the map leans)
      }
    }

    // ---------- the weather (Beta 3.13): the battlemap's own, falling over the map in front of it ----------
    // (fx.js draws it, as on a battlemap: rain with splashes, snow, fog banks, lightning … in the table's inches)
    function drawWx(G) {
      const w = cur.map.weather;
      const on = !plain() && typeof FX === 'object' && FX.weatherOn(w);
      if (!on) { if (wxOn) { wxOn = false; wxCv.getContext('2d').clearRect(0, 0, wxCv.width, wxCv.height); } return; }
      wxOn = true;
      const cw = Math.max(2, Math.min(1280, Math.round(G.W))); const ch = Math.max(2, Math.round((cw * G.H) / G.W));
      if (wxCv.width !== cw || wxCv.height !== ch) { wxCv.width = cw; wxCv.height = ch; }
      const Wt = viewInfo.world.w / viewInfo.ppi; const Ht = (Wt * G.H) / G.W; const k = cw / Wt;
      const now = Date.now(); const t = now / 1000 - FXDATA.TBASE;
      const g = wxCv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, cw, ch);
      g.setTransform(k, 0, 0, k, 0, 0);
      FX.weather(g, w, Wt, Ht, t, now);
      // thunder follows lightning (only the TV plays it)
      if (opts.onThunder) for (const f of FX.flashes(w, t, now)) { if (heard.has(f.id)) continue; heard.add(f.id); if (heard.size > 200) heard.clear(); opts.onThunder(f); }
    }

    // ---------- travelling from map to map ----------
    function stepTrip(now) {
      const T = trip; const u = clamp((now - T.t0) / T.ms, 0, 1);
      if (T.phase === 'leave') { // into the place (or away from the map), the mist closing
        const e = u * u * (3 - 2 * u);
        cam.S = T.cam0.S * Math.pow(T.k, e);
        if (T.dir === 'in' && T.x != null) { cam.cx = T.cam0.cx + (T.x - T.cam0.cx) * e; cam.cy = T.cam0.cy + (T.y - T.cam0.cy) * e; }
        veil = sstep(0.3, 1, u);
        if (u < 1) return;
        // under the mist: the other map
        cur = { ...T.next }; lookT = { ...FLAT, ...cur.look }; camT = camOf(cur.map.view);
        surfSig = ''; surfOk = false; labelSig = ''; drawnSig = ''; mistSig = '';
        // into a region: it is seen from further away at first and comes nearer; back out: the world map is seen close
        // at the place that led there, and the camera pulls back to where it was
        T.cam0 = T.dir === 'in' ? { cx: camT.cx, cy: camT.cy, S: camT.S * 1.9 } : { cx: T.x ?? camT.cx, cy: T.y ?? camT.cy, S: camT.S * (T.x != null ? 0.25 : 0.45) };
        cam = { ...T.cam0 }; T.phase = 'wait'; T.t0 = now; veil = 1;
      } else if (T.phase === 'wait') { // until its picture is painted
        veil = 1;
        if (surfOk || now - T.t0 > 4000) { T.phase = 'arrive'; T.t0 = now; T.ms = 1300; }
      } else { // the mist opens, the camera settles
        const o = 1 - Math.pow(1 - u, 3);
        cam.cx = T.cam0.cx + (camT.cx - T.cam0.cx) * o; cam.cy = T.cam0.cy + (camT.cy - T.cam0.cy) * o; cam.S = T.cam0.S * Math.pow(camT.S / T.cam0.S, o);
        veil = 1 - sstep(0, 0.7, u);
        if (u >= 1) { trip = null; veil = 0; cam = { ...camT }; }
      }
    }

    // ---------- every frame ----------
    function size() {
      const r = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const k = Math.min(1, 2880 / Math.max(1, r.width * dpr)) * dpr * (gl ? quality : 1);
      const w = Math.max(2, Math.round(r.width * k)); const hh = Math.max(2, Math.round(r.height * k));
      if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; drawnSig = ''; }
      return { W: r.width || 1, H: r.height || 1 };
    }
    const ease = (v, to, k) => (Math.abs(to - v) < 1e-4 ? to : v + (to - v) * k);
    const FLAT = { tilt: 0, bulge: 0, blur: 0, turn: 0 };
    function frame(t) {
      raf = 0;
      if (!running || dead) return;
      if (!root.isConnected) { stop(); return; } // (the GM's window was closed)
      if (!cur || !viewInfo) { running = false; return; }
      const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016); lastT = t;
      const { W, H } = size();
      if (W < 4 || H < 4) { raf = requestAnimationFrame(frame); return; }
      // the camera flies, the look glides (the GM's own flat view follows the hand at once)
      const k = 1 - Math.exp(-dt / 0.3);
      if (edit && edit.cam) { cam = { ...edit.cam }; }
      else if (trip) stepTrip(t);
      else { cam.cx = ease(cam.cx, camT.cx, k); cam.cy = ease(cam.cy, camT.cy, k); cam.S = ease(cam.S, camT.S, k); }
      for (const key of ['tilt', 'bulge', 'blur']) look[key] = ease(look[key], lookT[key], k);
      const dTurn = ((lookT.turn - look.turn + 540) % 360) - 180; // (the short way round)
      look.turn = Math.abs(dTurn) < 0.05 ? lookT.turn : look.turn + dTurn * k;
      const L = plain() ? FLAT : look;
      // the surface, when the map changed (a video picture: a few times a second)
      const sig = surfaceSig(cur.map);
      if (sig !== surfSig || (liveVideo && t - lastVideoT > 80)) { surfSig = sig; lastVideoT = t; if (!paintSurface()) surfOk = false; }
      live = liveAssets(cur.map);
      const A = air();
      const G = geo(L, cam, W, H);
      const still = !live.length && !trip && !(edit && edit.cam) && Math.abs(cam.cx - camT.cx) + Math.abs(cam.cy - camT.cy) + Math.abs(cam.S - camT.S) < 1e-3 && Math.abs(dTurn) < 0.05 && ['tilt', 'bulge', 'blur'].every((key) => look[key] === lookT[key]);
      if (gl) {
        if (!still || texDirty || t - lastDraw > 30) {
          const gap = t - lastDraw; lastDraw = t;
          // too slow for a while (a frame taking far longer than asked for): three quarters of the pixels
          slow = gap > (still ? 60 : 45) && gap < 1000 ? slow + 1 : Math.max(0, slow - 1);
          if (slow > 24 && quality > 0.4) { quality = Math.max(0.4, quality * 0.75); slow = 0; }
          drawGl(G, t - t0, L);
        }
      } else {
        drawFlat(G); drawMist(G);
        dof.style.transform = `rotate(${L.turn.toFixed(2)}deg)`;
        dof.style.setProperty('--b', (L.blur * H * 0.006 * (0.4 + 0.6 * L.tilt)).toFixed(1));
        // (without the card sunshine is a tint, and the mist that closes while it travels a plain veil)
        const sun = plain() ? 0 : A.sun;
        tint.style.background = sun > 0.01 ? `rgba(255, 196, 96, ${(0.12 * sun).toFixed(2)})` : 'transparent';
        veilEl.style.background = A.dark ? '#08090c' : '#f4f6fb'; veilEl.style.opacity = plain() ? '0' : veil.toFixed(3);
      }
      drawWx(G);
      syncNodes(); placeNodes(G, L);
      if (onDraw) { try { onDraw(G); } catch (e) { console.warn('[atlas]', e); } }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (dead) return;
      initGl();
      if (running) return;
      running = true; lastT = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; for (const m of media.values()) if (m.kind === 'video' && m.el) { try { m.el.pause(); } catch {} } }

    // the newest state. The map changes at once: on the TV the table's map-switch animation covers it meanwhile (table.js)
    function set(s) {
      viewInfo = s.view || viewInfo;
      const want = s.atlas && s.atlas.map && viewInfo ? s.atlas : null;
      const same = cur && want && cur.id === want.id;
      if (!want) { cur = null; trip = null; veil = 0; root.classList.remove('on'); labels.innerHTML = ''; nodes.clear(); labelSig = ''; quality = 1; slow = 0; stop(); for (const w8 of waiters.splice(0)) w8(false); return; }
      // travelling (Beta 3.13): a map opened from a place, or left with Zoom out, while another one lies there
      if (trip && trip.phase === 'leave') { if (want.id === trip.next.id) { trip.next = { ...want }; return; } trip = null; veil = 0; } // (the newest state is taken under the mist; another map meanwhile: at once)
      else if (trip && want.id !== cur.id) { trip = null; veil = 0; }
      const via = want.via;
      if (!opts.edit && cur && cam && cur.id !== want.id && via && via.at === want.at && via.at !== lastTrip) {
        lastTrip = via.at;
        const out = via.dir === 'out';
        trip = { dir: out ? 'out' : 'in', phase: 'leave', t0: performance.now(), ms: 950, k: out ? 2.6 : 0.2, x: via.x, y: via.y, cam0: { ...cam }, next: { ...want } };
        start();
        return;
      }
      cur = { ...want };
      lookT = { ...FLAT, ...cur.look }; camT = camOf(cur.map.view);
      if (!same) { cam = { ...camT }; look = { ...lookT }; surfSig = ''; surfOk = false; labelSig = ''; drawnSig = ''; mistSig = ''; }
      root.classList.add('on');
      for (const m of media.values()) if (m.kind === 'video' && m.el && m.el.paused && m.ok) m.el.play().catch(() => {});
      start();
    }
    // once its picture is painted (or the time is up)
    const ready = (ms = 4000) => new Promise((resolve) => { if (!cur || surfOk) { resolve(!!cur); return; } waiters.push(resolve); setTimeout(() => resolve(false), ms); });
    // the map moving on the GM screen: the camera follows while it moves
    function viewLive(d) { if (cur && d && d.mapId === cur.id && d.view && viewInfo) { cur.map.view = { ...cur.map.view, ...d.view }; camT = camOf(cur.map.view); } }
    const G0 = () => { if (!cur || !cam) return null; const r = root.getBoundingClientRect(); return geo(plain() ? FLAT : look, cam, r.width || 1, r.height || 1); };
    function debug() {
      const G = G0();
      if (!G) return { on: false, id: null };
      const A = air();
      return {
        on: root.classList.contains('on'), id: cur.id, gl: !!gl, quality, px: [cv.width, cv.height], ready: surfOk, plain: plain(), cam: { ...cam }, camT: { ...camT }, look: { ...look }, air: A, live: live.length, trip: trip ? trip.phase : null, veil, wx: wxOn,
        surface: surfOk ? { w: surf.width, h: surf.height, rect: surfRect } : null,
        standing: items.map((it) => { const e = nodes.get(it.id); const p = G.toScreen(it.x, it.y); return { id: it.id, kind: it.kind, title: it.title, sub: it.sub, style: it.style, icon: it.icon, note: it.note || '', shown: !!e && e.style.display !== 'none', opacity: e ? Number(e.style.opacity) : 0, x: p ? p.x : null, y: p ? p.y : null }; }),
      };
    }
    const project = (x, y) => { const G = G0(); const p = G && G.toScreen(x, y); return p ? { x: p.x, y: p.y, scale: p.scale } : null; };
    const unproject = (x, y) => { const G = G0(); const m = G && G.toMap(x, y); return m ? { x: m.x, y: m.y } : null; };
    // a small picture of what lies there (for the room lights): the flat map
    function sample(g, w, hh) { if (surfOk) { try { g.drawImage(surf, 0, 0, w, hh); } catch {} } }
    function destroy() { dead = true; stop(); for (const m of media.values()) if (m.kind === 'video' && m.el) { try { m.el.removeAttribute('src'); m.el.load(); } catch {} } media.clear(); if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } root.innerHTML = ''; }
    return {
      set, viewLive, debug, project, unproject, ready, destroy, sample,
      get on() { return !!cur; },
      // the GM's Map table
      setEdit(e) { edit = e; drawnSig = ''; mistSig = ''; }, setSelected(id) { selected = id; }, setOnDraw(fn) { onDraw = fn; },
      frame: () => (cur && viewInfo ? frameOf(cur.map.view) : null), rect: () => (surfOk ? surfRect : null), map: () => (cur ? cur.map : null),
      assetSize: (l) => { const m = pic(l.url, l.kind); return m && m.ok ? { w: l.w || 1, h: (((l.w || 1) * m.h) / m.w) * (l.stretch || 1) } : null; },
    };
  }
  return { mount, geo, ICONS, STYLES, LIVE_MAX };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TableAtlas;
