// The TV: a world or regional map as an immersive view (Beta 3.11, the Cartographer).
//
// A map of the campaign's atlas lies over the battlemap: tilted away from the side it faces, bulged like a globe,
// sharp in the middle and soft toward the far and the near edge, with clouds round the edge that hide where the
// picture ends. It is drawn in two parts:
//   the surface   the picture, the grid, assets, pen strokes, labels and routes, painted flat into one canvas (as on
//                 the GM's flat map) and bent as a whole: by the graphics card (WebGL 2: one shader does the tilt,
//                 the bulge, the blur and the clouds), or without it by a mesh of small triangles on a plain canvas
//                 (the same bend; clouds worked out coarsely, the blur by two soft bands)
//   what stands   places, markers, route labels and tokens stand upright on it (plain elements, placed by the same
//                 geometry each frame), so they stay readable however the map lies
// The geometry (geo) is the one thing both parts and the shader share: map inches -> view -> screen and back.
//   turn    which side of the TV the view faces (it turns as a whole, what stands turns with it)
//   bulge   a fisheye: toward the edge the screen shows more and more of the map
//   tilt    the map leans away: the far side is small and shows a lot, the near side is big
// The camera looks at the middle of the table frame of the map (its view, as on the GM screen) and flies there when it
// moves. A change of map (the world to a region) goes through clouds: they close, the map changes, they open.
'use strict';

const TableAtlas = (() => {
  const D2R = Math.PI / 180;
  const CAM_D = 2.3; const TILT_MAX = 58; const BULGE_MAX = 0.72; const KR_MAX = 1.45;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

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
      // how soft a spot of the view is drawn (0 sharp), and how far the clouds reach it without their billows (0 to 1)
      soft(qx, qy, blur) { return blur * clamp(sstep(0.18, 1.0, -qy) + 0.8 * sstep(0.45, 1.05, qy) + 0.5 * sstep(0.9, 1.9, Math.hypot(qx, qy)), 0, 1.6); },
      edge(px, py, clouds) { if (clouds < 0.01) return 0; const d = Math.hypot(px / (W / H), py); const inner = 1.25 + (0.45 - 1.25) * clouds; return sstep(inner, inner + 0.45, d); },
      // the clouds also lie over the rim of the picture, a little way in, so its straight edge never shows (d: how far outside, in view units; inside is negative)
      rim(d) { return sstep(-0.14, 0.2, d); },
    };
  }

  const VS = '#version 300 es\nin vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';
  const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uRect;   // the surface on the map: x, y, w, h (inches)
uniform vec3 uCam;    // where the camera looks (map inches) and how many inches half the screen's height shows
uniform float uTurn;  // radians
uniform float uKb;    // bulge
uniform vec2 uTilt;   // cos, sin
uniform float uBlur; uniform float uClouds; uniform float uCover; uniform float uTime; uniform float uReady;
out vec4 o;
const float D = ${CAM_D.toFixed(2)};
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y); p.y = -p.y;
  float ct = cos(uTurn); float st = sin(uTurn);
  vec2 q = vec2(ct * p.x + st * p.y, -st * p.x + ct * p.y);
  float r = length(q);
  float gone = 0.0;
  vec2 q2 = q;
  // (where the bulge or the tilt runs out, the map goes softly into cloud: no hard rim)
  if (uKb > 0.001 && r > 0.00001) { float kr = uKb * r; gone = smoothstep(${(KR_MAX - 0.32).toFixed(2)}, ${(KR_MAX - 0.02).toFixed(2)}, kr); q2 = q * (tan(min(kr, ${KR_MAX.toFixed(2)})) / kr); }
  float den = uTilt.x * D + q2.y * uTilt.y;
  gone = max(gone, 1.0 - smoothstep(0.06, 0.5, den));
  float v = q2.y * D / max(den, 0.06);
  float u = q2.x * (D - v * uTilt.y) / D;
  vec2 m = uCam.xy + uCam.z * vec2(u, v);
  vec2 uv = (m - uRect.xy) / uRect.zw;
  // depth of field: sharp in the middle, soft toward the far and the near edge
  float far = smoothstep(0.18, 1.0, -q.y);
  float b = uBlur * clamp(far + 0.8 * smoothstep(0.45, 1.05, q.y) + 0.5 * smoothstep(0.9, 1.9, r), 0.0, 1.6);
  vec2 dx = dFdx(uv); vec2 dy = dFdy(uv);
  float R = b * uRes.y * 0.0075;
  vec3 col = vec3(0.0);
  // (the slopes are handed to every lookup: inside a branch the card may not work them out itself)
  if (R < 0.4) col = textureGrad(uTex, uv, dx, dy).rgb;
  else {
    float wide = 1.0 + R * 0.5;
    for (int i = 0; i < 9; i++) {
      float ang = float(i) * 2.39996; float rr = sqrt((float(i) + 0.5) / 9.0) * R;
      col += textureGrad(uTex, uv + dx * (cos(ang) * rr) + dy * (sin(ang) * rr), dx * wide, dy * wide).rgb;
    }
    col /= 9.0;
  }
  col = mix(col, vec3(0.80, 0.86, 0.92), far * 0.3 * uTilt.y); // the far side pales, as land does toward the horizon
  // where the picture ends, and round the edge of the screen: clouds
  vec2 dv = max(uRect.xy - m, m - (uRect.xy + uRect.zw));
  float sd = (length(max(dv, vec2(0.0))) + min(max(dv.x, dv.y), 0.0)) / uCam.z; // how far outside the picture (inside: negative)
  float outside = max(gone, smoothstep(-0.14, 0.2, sd));
  float d = length(p / vec2(asp, 1.0));
  float inner = mix(1.25, 0.45, uClouds);
  float edge = uClouds < 0.01 ? 0.0 : smoothstep(inner, inner + 0.45, d);
  float mk = max(max(edge, outside), max(uCover, 1.0 - uReady));
  float n = fbm(p * 2.1 + vec2(uTime * 0.012, uTime * 0.006));
  float n2 = fbm(p * 7.0 - vec2(uTime * 0.02, 0.0));
  float al = clamp(mk * 2.25 - (1.0 - (n * 0.75 + n2 * 0.25)) * 1.25, 0.0, 1.0);
  al = smoothstep(0.0, 0.55, al);
  float sp = step(0.9, hash(floor(p * 300.0))) * smoothstep(0.0, 0.25, al) * (1.0 - smoothstep(0.3, 0.8, al)) * (1.0 - uCover); // a spray of flakes at their rim
  vec3 cc = mix(vec3(0.72, 0.76, 0.84), vec3(1.0), smoothstep(0.3, 0.72, n * 0.7 + n2 * 0.3));
  o = vec4(mix(col, cc, clamp(al + sp * 0.4, 0.0, 1.0)), 1.0);
}`;

  // the clouds without the graphics card: the same billows, worked out coarsely on the processor
  const hash2 = (x, y) => { let px = (x * 123.34) % 1; let py = (y * 456.21) % 1; if (px < 0) px += 1; if (py < 0) py += 1; const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; const v = (px * py) % 1; return v < 0 ? v + 1 : v; };
  const vnoise = (x, y) => { const ix = Math.floor(x); const iy = Math.floor(y); let fx = x - ix; let fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy); const b = hash2(ix + 1, iy); const c = hash2(ix, iy + 1); const d = hash2(ix + 1, iy + 1); return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy; };
  const fbm = (x, y, oct = 4) => { let a = 0.5; let s = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; } return s; };

  const PIN = '<svg viewBox="0 0 24 32" class="pin"><path d="M12 31c-1-4-9-11-9-18a9 9 0 0 1 18 0c0 7-8 14-9 18z" fill="var(--c)" stroke="rgba(0,0,0,0.6)" stroke-width="1.5"/><circle cx="12" cy="12.5" r="3.6" fill="rgba(255,255,255,0.92)"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" class="xmark"><path d="M5 5l14 14M19 5L5 19" stroke="rgba(0,0,0,0.6)" stroke-width="7" stroke-linecap="round"/><path d="M5 5l14 14M19 5L5 19" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/></svg>';

  function mount(root) {
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    let cv = el('canvas', 'atl-cv'); const cloudCv = el('canvas', 'atl-clouds'); const dof = el('div', 'atl-dof'); const labels = el('div', 'atl-labels');
    dof.append(el('i', 'far'), el('i', 'near'));
    root.append(cv, dof, cloudCv, labels);
    const surf = document.createElement('canvas'); // the flat map
    let gl = null; let glBad = false; let prog = null; let tex = null; let uni = {}; let maxTex = 2048;
    let target = null; let cur = null; let viewInfo = null;
    let running = false; let raf = 0; let lastT = 0; let t0 = performance.now();
    let cover = 1; let shown = false;
    let cam = null; let camT = null; let look = null; let lookT = null;
    let surfRect = null; let surfPpi = 1; let surfSig = ''; let surfDirty = false; let surfOk = false; let texDirty = false;
    let drawnSig = ''; let cloudSig = ''; let labelSig = '';
    // the graphics card's share: at rest the clouds are drawn 30 times a second (they drift slowly), in full flight
    // every frame; a card that can't keep up gets fewer pixels to fill (quality), never a stutter
    let quality = 1; let slow = 0; let lastDraw = 0; let under = false; let shownAt = 0;
    const media = new Map(); // url -> { el, ok, w, h }
    const nodes = new Map(); // what stands: id -> element
    let liveVideo = false; let lastVideoT = 0;

    // ---------- pictures ----------
    function pic(url, kind) {
      if (!url) return null;
      let m = media.get(url);
      if (m) return m;
      m = { el: null, ok: false, w: 0, h: 0, kind };
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

    // where the picture lies on the map (as scene-view.js places it), and the box it takes up turned
    function bgPlace(map) {
      const bg = map.bg; const m = bg && pic(bg.url, bg.kind);
      if (!bg || !m || !m.ok) return null;
      let p;
      if (bg.scale == null && bg.span) { const sc = bg.span / m.w; p = { x: bg.x || 0, y: bg.y || 0, w: bg.span, h: m.h * sc }; }
      else if (bg.scale == null) { const r = frameOf(map.view); const s = Math.min(r.w / m.w, r.h / m.h); p = { x: r.x + (r.w - m.w * s) / 2, y: r.y + (r.h - m.h * s) / 2, w: m.w * s, h: m.h * s }; }
      else p = { x: bg.x, y: bg.y, w: m.w * bg.scale, h: m.h * bg.scale };
      const a = (bg.rotation || 0) * D2R; const co = Math.abs(Math.cos(a)); const si = Math.abs(Math.sin(a));
      const cx = p.x + p.w / 2; const cy = p.y + p.h / 2; const bw = p.w * co + p.h * si; const bh = p.w * si + p.h * co;
      return { ...p, cx, cy, rot: bg.rotation || 0, box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, m };
    }

    // ---------- the surface: the map painted flat ----------
    function paintSurface() {
      const map = cur.map;
      const P = bgPlace(map);
      if (map.bg && !P) return false; // (its picture is not there yet)
      const R = P ? P.box : frameOf(map.view);
      const cap = gl ? Math.min(4096, maxTex) : 2048;
      const want = P ? Math.max(P.m.w, P.m.h, 1600) : 1600;
      const long = Math.min(cap, want);
      const ppi = long / Math.max(R.w, R.h);
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
      const grid = map.grid;
      const drawGrid = () => {
        if (!grid || !grid.show || grid.size * ppi < 4) return;
        g.beginPath();
        if (!Geom.isHex(grid)) {
          const cs = [Geom.toLocal(grid, R.x, R.y), Geom.toLocal(grid, R.x + R.w, R.y), Geom.toLocal(grid, R.x, R.y + R.h), Geom.toLocal(grid, R.x + R.w, R.y + R.h)];
          const u0 = Math.min(...cs.map((q) => q.u)); const u1 = Math.max(...cs.map((q) => q.u)); const v0 = Math.min(...cs.map((q) => q.v)); const v1 = Math.max(...cs.map((q) => q.v));
          const s = grid.size;
          for (let i = Math.floor(u0 / s); i <= Math.ceil(u1 / s); i++) { const a = Geom.fromLocal(grid, i * s, v0); const b = Geom.fromLocal(grid, i * s, v1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
          for (let j = Math.floor(v0 / s); j <= Math.ceil(v1 / s); j++) { const a = Geom.fromLocal(grid, u0, j * s); const b = Geom.fromLocal(grid, u1, j * s); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
        } else Geom.eachCell(grid, R.x, R.y, R.x + R.w, R.y + R.h, (cell) => { const p = cell.poly; g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.lineTo(p[6], p[7]); });
        g.globalAlpha = grid.opacity; g.strokeStyle = grid.color; g.lineWidth = Math.max(1, (grid.width || 1) * 1.2) / ppi; g.lineCap = 'round';
        g.stroke(); g.globalAlpha = 1;
      };
      if (grid && grid.under) drawGrid();
      // assets lie on the map
      for (const l of map.layers || []) {
        if (l.role !== 'asset' || l.hidden) continue;
        const m = pic(l.url, l.kind);
        if (!m || !m.ok) continue;
        const aw = l.w || 1; const ah = ((aw * m.h) / m.w) * (l.stretch || 1);
        g.save();
        g.translate(l.x, l.y); g.rotate((l.rotation || 0) * D2R); g.scale(l.flip ? -1 : 1, 1);
        g.globalAlpha = l.opacity ?? 1;
        const f = [l.hue ? `hue-rotate(${l.hue}deg)` : '', l.dark > 0 ? `brightness(${1 - l.dark})` : ''].filter(Boolean).join(' ');
        g.filter = f || 'none';
        if (l.shadow) { g.shadowColor = 'rgba(0, 0, 0, 0.6)'; g.shadowBlur = aw * 0.06 * ppi; g.shadowOffsetX = aw * 0.05 * ppi; g.shadowOffsetY = aw * 0.08 * ppi; }
        try { g.drawImage(m.el, -aw / 2, -ah / 2, aw, ah); } catch {}
        g.restore();
      }
      if (grid && !grid.under) drawGrid();
      // pen strokes and labels: written on the map
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const d of map.draw || []) {
        if (d.hidden) continue;
        if (d.kind === 'pen' && d.pts && d.pts.length >= 2) {
          const path = () => { g.beginPath(); g.moveTo(d.pts[0], d.pts[1]); for (let i = 2; i + 1 < d.pts.length; i += 2) g.lineTo(d.pts[i], d.pts[i + 1]); if (d.pts.length === 2) g.lineTo(d.pts[0] + 0.001, d.pts[1]); };
          const lw = Math.max(1 / ppi, d.w);
          path(); g.strokeStyle = 'rgba(0, 0, 0, 0.5)'; g.lineWidth = lw + Math.max(2 / ppi, lw * 0.6); g.stroke();
          path(); g.strokeStyle = d.color; g.lineWidth = lw; g.stroke();
        } else if (d.kind === 'text' && d.text) {
          g.font = `700 ${d.size}px Alegreya, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = d.size * 0.16; g.strokeStyle = 'rgba(0, 0, 0, 0.75)'; g.strokeText(d.text, d.x, d.y);
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
      return true;
    }
    const surfaceSig = (map) => JSON.stringify([map.bg && [map.bg.url, map.bg.x, map.bg.y, map.bg.scale, map.bg.span, map.bg.rotation, (pic(map.bg.url, map.bg.kind) || {}).ok], map.bg && map.bg.scale == null ? map.view : 0, map.grid,
      (map.layers || []).filter((l) => l.role === 'asset').map((l) => [l.url, l.x, l.y, l.w, l.rotation, l.flip, l.stretch, l.hue, l.dark, l.opacity, l.shadow, l.hidden, (pic(l.url, l.kind) || {}).ok]),
      map.draw, (map.marks || []).filter((m) => m.kind === 'route'), gl ? 1 : 0]);

    // ---------- the graphics card ----------
    function initGl() {
      if (gl || glBad) return;
      try {
        const g = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
        if (!g) { glBad = true; root.classList.add('flat'); return; }
        const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader'); return s; };
        const p = g.createProgram();
        g.attachShader(p, sh(g.VERTEX_SHADER, VS)); g.attachShader(p, sh(g.FRAGMENT_SHADER, FS)); g.linkProgram(p);
        if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) || 'link');
        const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
        const loc = g.getAttribLocation(p, 'aPos'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
        g.useProgram(p);
        for (const n of ['uTex', 'uRes', 'uRect', 'uCam', 'uTurn', 'uKb', 'uTilt', 'uBlur', 'uClouds', 'uCover', 'uTime', 'uReady']) uni[n] = g.getUniformLocation(p, n);
        tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        const an = g.getExtension('EXT_texture_filter_anisotropic');
        if (an) g.texParameterf(g.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([42, 47, 54, 255]));
        maxTex = g.getParameter(g.MAX_TEXTURE_SIZE) || 2048;
        gl = g; prog = p;
        // the card gone mid-game: a fresh canvas, drawn without it from here on
        cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; glBad = true; surfSig = ''; drawnSig = ''; const fresh = el('canvas', 'atl-cv'); cv.replaceWith(fresh); cv = fresh; root.classList.add('flat'); });
      } catch (e) { gl = null; glBad = true; console.warn('[atlas] no graphics card drawing:', e && e.message); }
      root.classList.toggle('flat', !gl);
    }
    function drawGl(G, t) {
      if (texDirty && surfOk) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surf);
        gl.generateMipmap(gl.TEXTURE_2D);
        texDirty = false;
      }
      gl.viewport(0, 0, cv.width, cv.height);
      const R = surfRect || { x: 0, y: 0, w: 1, h: 1 };
      gl.uniform1i(uni.uTex, 0); gl.uniform2f(uni.uRes, cv.width, cv.height);
      gl.uniform4f(uni.uRect, R.x, R.y, R.w, R.h); gl.uniform3f(uni.uCam, cam.cx, cam.cy, cam.S);
      gl.uniform1f(uni.uTurn, G.tr); gl.uniform1f(uni.uKb, G.kb); gl.uniform2f(uni.uTilt, G.c, G.s);
      gl.uniform1f(uni.uBlur, look.blur); gl.uniform1f(uni.uClouds, look.clouds); gl.uniform1f(uni.uCover, cover); gl.uniform1f(uni.uTime, t / 1000); gl.uniform1f(uni.uReady, surfOk ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---------- without it: the same bend with a mesh of small triangles, coarse clouds, two soft bands ----------
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
      const sig = JSON.stringify([cam, look.tilt, look.bulge, look.turn, cv.width, cv.height, surfOk, surfSig]);
      if (sig === drawnSig) return;
      drawnSig = sig;
      const g = cv.getContext('2d');
      const W = cv.width; const H = cv.height;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#d6dae1'; g.fillRect(0, 0, W, H);
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
    function drawClouds(G) {
      const sig = JSON.stringify([cam, look, Math.round(cover * 40), surfOk, surfRect, G.W, G.H]);
      if (sig === cloudSig) return;
      cloudSig = sig;
      const w = Math.max(40, Math.round(G.W / 10)); const hh = Math.max(24, Math.round(G.H / 10));
      if (cloudCv.width !== w || cloudCv.height !== hh) { cloudCv.width = w; cloudCv.height = hh; }
      const g = cloudCv.getContext('2d'); const img = g.createImageData(w, hh); const d = img.data;
      const R = surfRect; const half = G.H / 2;
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
        const sx = ((i + 0.5) / w) * G.W; const sy = ((j + 0.5) / hh) * G.H;
        const px = (sx - G.W / 2) / half; const py = (sy - G.H / 2) / half;
        let outside = 1;
        if (surfOk && R) { const m = G.toMap(sx, sy); if (m) { const ax = Math.max(R.x - m.x, m.x - (R.x + R.w)); const ay = Math.max(R.y - m.y, m.y - (R.y + R.h)); outside = G.rim((Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0)) / cam.S); } }
        const mk = Math.max(G.edge(px, py, look.clouds), outside, cover);
        const n = fbm(px * 2.1, py * 2.1) * 0.8 + fbm(px * 7, py * 7, 3) * 0.2;
        const al = sstep(0, 0.55, clamp(mk * 2.25 - (1 - n) * 1.25, 0, 1));
        const lit = 184 + 71 * sstep(0.3, 0.72, n); const o = (j * w + i) * 4;
        d[o] = lit; d[o + 1] = Math.min(255, lit + 6); d[o + 2] = Math.min(255, lit + 14); d[o + 3] = Math.round(al * 255);
      }
      g.putImageData(img, 0, 0);
    }

    // ---------- what stands on the map ----------
    function standing(map) {
      const out = [];
      for (const m of map.marks || []) {
        if (m.hidden || m.kind === 'note') continue;
        if (m.kind === 'route') { if (m.pts && m.pts.length >= 4) out.push({ id: m.id, kind: 'route', x: m.x, y: m.y, color: m.color, title: m.title || '', sub: Geom.routeLabel(map.grid, m) }); continue; }
        out.push({ id: m.id, kind: m.kind, x: m.x, y: m.y, color: m.color || '#e3963e', title: m.title || m.label || '', sub: m.kind === 'counter' ? String(m.value) : m.sub || '', n: m.n, note: cur.note && cur.note.id === m.id ? m.note : '' });
      }
      for (const l of map.layers || []) if (l.role === 'token' && !l.hidden) out.push({ id: l.id, kind: 'token', x: l.x, y: l.y, url: l.url, size: (l.size || 1) * ((map.grid && map.grid.size) || 1) });
      return out;
    }
    function buildNode(it) {
      const e = el('div', `atl-s kind-${it.kind}`);
      e.dataset.id = it.id;
      const inner = el('div', 'atl-s-in'); e.append(inner);
      if (it.kind === 'place' || it.kind === 'route') {
        if (it.title) { const t = el('b', 'atl-title'); t.textContent = it.title; inner.append(t); }
        if (it.sub) { const s = el('span', 'atl-sub'); s.textContent = it.sub; inner.append(s); }
        if (it.kind === 'place') { inner.append(el('i', 'atl-tip')); e.append(el('i', 'atl-ring')); }
        if (it.note) { const n = el('div', 'atl-note'); n.textContent = it.note; e.append(n); }
      } else if (it.kind === 'pin') inner.innerHTML = PIN;
      else if (it.kind === 'x') inner.innerHTML = CROSS;
      else if (it.kind === 'dot') { const b = el('b', 'atl-dot'); b.textContent = String(it.n ?? ''); inner.append(b); }
      else if (it.kind === 'counter') { const a = el('span', 'atl-count'); const t = el('span'); t.textContent = it.title; const v = el('b'); v.textContent = it.sub; a.append(t, v); inner.append(a); }
      else if (it.kind === 'token') { const i = el('img', 'atl-tok'); i.alt = ''; i.draggable = false; i.src = it.url || ''; inner.append(i); }
      return e;
    }
    let items = [];
    function syncNodes() {
      items = cur ? standing(cur.map) : [];
      const sig = JSON.stringify(items.map((it) => [it.id, it.kind, it.color, it.title, it.sub, it.n, it.note, it.url]));
      if (sig === labelSig) return;
      labelSig = sig;
      labels.innerHTML = ''; nodes.clear();
      for (const it of items) { const e = buildNode(it); e.style.setProperty('--c', it.color || '#e3963e'); nodes.set(it.id, e); labels.append(e); }
    }
    // Each is written once at its biggest size and then only moved, turned and scaled (never set in a new size):
    // that costs the graphics card next to nothing while the camera flies, and the letters never have to be made anew.
    function placeNodes(G) {
      const BIG = 1.7; const base = G.H * 0.021 * BIG; const tok = G.H * 0.12;
      for (const it of items) {
        const e = nodes.get(it.id); if (!e) continue;
        const p = G.toScreen(it.x, it.y);
        const m = 0.25;
        if (!p || p.x < -G.W * m || p.x > G.W * (1 + m) || p.y < -G.H * m || p.y > G.H * (1 + m)) { e.style.display = 'none'; continue; }
        const hid = Math.max(G.edge(p.px, p.py, look.clouds), cover);
        const op = 1 - sstep(0.3, 0.75, hid);
        if (op < 0.02) { e.style.display = 'none'; continue; }
        const soft = G.soft(p.qx, p.qy, look.blur) * G.H * 0.0045;
        const full = it.kind === 'token' ? tok : base;
        const k = it.kind === 'token' ? clamp(it.size * (G.H / 2 / cam.S) * p.scale, G.H * 0.012, tok) / tok : clamp(p.scale, 0.42, BIG) / BIG;
        const fs = `${full.toFixed(2)}px`;
        if (e.style.fontSize !== fs) e.style.fontSize = fs;
        e.style.display = '';
        e.style.opacity = op.toFixed(3);
        e.style.zIndex = String(1000 + Math.round(p.qy * 400));
        e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${look.turn.toFixed(2)}deg) scale(${k.toFixed(4)})`;
        const blur = soft > 0.6 ? `blur(${(soft / k).toFixed(1)}px)` : '';
        if (e.style.filter !== blur) e.style.filter = blur;
        e.style.setProperty('--flat', G.c.toFixed(3)); // (the ring on the ground lies as flat as the map leans)
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
    function frame(t) {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016); lastT = t;
      // which map: a change goes through the clouds
      const want = target && viewInfo ? target : null;
      const change = !!cur !== !!want || (cur && want && cur.id !== want.id);
      if (change) {
        if (under) { under = false; if (root.parentElement) root.parentElement.classList.remove('atlas-on'); } // (it shows again while the clouds close)
        cover = Math.min(1, cover + dt / 0.7);
        if (cover >= 1 || !cur) {
          if (!cur && want) shownAt = t;
          cur = want ? { ...want } : null; surfSig = ''; surfOk = false; labelSig = ''; drawnSig = ''; cloudSig = '';
          if (cur) { cam = camOf(cur.map.view); camT = { ...cam }; look = look || { ...cur.look }; lookT = { ...cur.look }; look.turn = lookT.turn; cover = 1; }
        }
      } else if (cur) {
        cover = surfOk ? Math.max(0, cover - dt / 1.3) : 1;
      }
      if (!cur) { // nothing to show any more: fade away and rest
        quality = 1; slow = 0;
        if (under) { under = false; if (root.parentElement) root.parentElement.classList.remove('atlas-on'); }
        if (shown) { shown = false; root.classList.remove('on'); }
        running = false; labels.innerHTML = ''; nodes.clear(); labelSig = '';
        return;
      }
      if (!shown) { shown = true; root.classList.add('on'); }
      // the battlemap underneath is not drawn while the map covers it for good (its videos and effects cost nothing then)
      const covers = !change && surfOk && t - shownAt > 900;
      if (covers !== under) { under = covers; if (root.parentElement) root.parentElement.classList.toggle('atlas-on', under); }
      const { W, H } = size();
      // the camera flies, the look glides
      const k = 1 - Math.exp(-dt / 0.3);
      cam.cx = ease(cam.cx, camT.cx, k); cam.cy = ease(cam.cy, camT.cy, k); cam.S = ease(cam.S, camT.S, k);
      for (const key of ['tilt', 'bulge', 'blur', 'clouds']) look[key] = ease(look[key], lookT[key], k);
      let dTurn = ((lookT.turn - look.turn + 540) % 360) - 180; // (the short way round)
      look.turn = Math.abs(dTurn) < 0.05 ? lookT.turn : look.turn + dTurn * k;
      // the surface, when the map changed (a video picture: a few times a second)
      const sig = surfaceSig(cur.map);
      if (sig !== surfSig || (liveVideo && t - lastVideoT > 80)) { surfSig = sig; lastVideoT = t; if (!paintSurface()) surfOk = false; }
      const G = geo(look, cam, W, H);
      const still = !change && cover <= 0 && camT && Math.abs(cam.cx - camT.cx) + Math.abs(cam.cy - camT.cy) + Math.abs(cam.S - camT.S) < 1e-3 && Math.abs(dTurn) < 0.05 && ['tilt', 'bulge', 'blur', 'clouds'].every((key) => look[key] === lookT[key]);
      if (gl) {
        if (!still || texDirty || t - lastDraw > 30) {
          const gap = t - lastDraw; lastDraw = t;
          // too slow for a while (a frame taking far longer than asked for): three quarters of the pixels
          slow = gap > (still ? 60 : 45) && gap < 1000 ? slow + 1 : Math.max(0, slow - 1);
          if (slow > 24 && quality > 0.4) { quality = Math.max(0.4, quality * 0.75); slow = 0; }
          drawGl(G, t - t0);
        }
      } else {
        drawFlat(G); drawClouds(G);
        dof.style.transform = `rotate(${look.turn.toFixed(2)}deg)`;
        dof.style.setProperty('--b', (look.blur * H * 0.006 * (0.4 + 0.6 * look.tilt)).toFixed(1));
      }
      syncNodes(); placeNodes(G);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      initGl();
      running = true; lastT = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function set(s) {
      viewInfo = s.view || viewInfo;
      target = s.atlas && s.atlas.map ? s.atlas : null;
      if (target && cur && target.id === cur.id) { // the same map, changed: it follows at once
        cur = { ...target };
        camT = camOf(cur.map.view); lookT = { ...cur.look };
      }
      if (target || cur) start();
    }
    // the map moving on the GM screen: the camera follows while it moves
    function viewLive(d) { if (cur && d && d.mapId === cur.id && d.view && viewInfo) { cur.map.view = { ...cur.map.view, ...d.view }; camT = camOf(cur.map.view); } }
    function debug() {
      if (!cur || !cam) return { on: false, id: null };
      const r = root.getBoundingClientRect();
      const G = geo(look, cam, r.width || 1, r.height || 1);
      return {
        on: shown, id: cur.id, gl: !!gl, quality, px: [cv.width, cv.height], cover: Math.round(cover * 1000) / 1000, ready: surfOk, cam: { ...cam }, camT: { ...camT }, look: { ...look },
        surface: surfOk ? { w: surf.width, h: surf.height, rect: surfRect } : null,
        standing: items.map((it) => { const e = nodes.get(it.id); const p = G.toScreen(it.x, it.y); return { id: it.id, kind: it.kind, title: it.title, sub: it.sub, note: it.note || '', shown: !!e && e.style.display !== 'none', x: p ? p.x : null, y: p ? p.y : null }; }),
      };
    }
    const project = (x, y) => { if (!cur || !cam) return null; const r = root.getBoundingClientRect(); const p = geo(look, cam, r.width || 1, r.height || 1).toScreen(x, y); return p ? { x: p.x, y: p.y, scale: p.scale } : null; };
    const unproject = (x, y) => { if (!cur || !cam) return null; const r = root.getBoundingClientRect(); const m = geo(look, cam, r.width || 1, r.height || 1).toMap(x, y); return m ? { x: m.x, y: m.y } : null; };
    return { set, viewLive, debug, project, unproject, get on() { return !!cur; } };
  }
  return { mount, geo };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TableAtlas;
