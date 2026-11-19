// Oldschool maps (Beta 3.22): a map drawn on the grid instead of a picture.
//
// What the GM drew (map.os, see mapstate.js) becomes one picture here, on the GM screen: the floors with their tiles,
// the edges (a ledge, built walls, solid rock or a cliff into darkness), wall lines, pillars, stairs and doors, all with
// light from one side, shadows thrown by what stands higher, and darker corners. Every drawn thing has a height; the
// graphics card works out light and shadow from those heights (WebGL 2). The TV only gets the finished picture, so a
// drawn map costs no more at the table than a picture map. The same drawing gives the walls for line of sight.
//
// Steps: (1) the drawing is painted flat with Canvas 2D (floors with their tiles; what each area is: its edge, material
// and level; wall lines and pillars; stairs); (2) the graphics card finds for every dot the nearest floor and how far
// it is (jump flooding), (3) builds the heights and (4) lights them. Without WebGL 2 the picture is the flat painting.
'use strict';

const Oldschool = (() => {
  const DATA = typeof TILE_DATA === 'object' ? TILE_DATA : { tiles: [] };
  const DIR = new URL('tiles/', document.baseURI).href;
  const byId = new Map(DATA.tiles.map((t) => [t.id, t]));
  const FLOORS = DATA.tiles.filter((t) => t.kind === 'floor');
  const MATERIALS = DATA.tiles.filter((t) => t.kind === 'material');
  const EDGES = ['walls', 'rock', 'ledge', 'cliff'];
  const EDGE_CODE = { ledge: 1, walls: 2, rock: 3, cliff: 4 };
  const DEFAULT_MAT = { walls: 'stone_wall', rock: 'rock', cliff: 'cliff', ledge: 'stone_wall' };
  const relOf = (t) => `Tiles/Tablescape/${t.label}.webp`;
  const builtinByRel = new Map(DATA.tiles.map((t) => [relOf(t), t]));
  const PX = 80; // dots per square in the picture (the TV shows about this many per inch)
  const MAX_PX = 12e6; // dots in the picture at most (a huge map gets fewer per square)
  const MARGIN = 3; // squares around what was drawn (rock and cliffs reach out)

  // ---------- tiles ----------
  // a tile reference ({ rel, path }) → what to paint with: url, squares (null: not set yet)
  // squares: how many squares the tile spans; off: where its joints lie ([across, down], a fraction of a square from
  // its left and top edge; Beta 3.24). The library's list (lib) carries what the GM adjusted.
  function tileInfo(ref, lib) {
    if (!ref) return null;
    const b = builtinByRel.get(ref.rel);
    if (b) {
      const o = lib && lib.find((x) => x.builtin && x.rel === ref.rel);
      return { url: DIR + b.file, small: DIR + b.small, squares: (o && o.squares) || b.squares, off: (o && o.off) || b.off || [0, 0], label: b.label, builtin: true, id: b.id };
    }
    const it = lib && lib.find((x) => (ref.rel && x.rel === ref.rel) || (ref.path && x.path === ref.path));
    const p = (it && it.path) || ref.path;
    if (!p) return null;
    return { url: it ? it.url : UI.pathToUrl(p), small: it && it.thumb ? it.thumb : null, squares: it ? it.squares : null, off: (it && it.off) || [0, 0], label: it ? it.name : String(p).split(/[\\/]/).pop(), path: p };
  }
  // Beta 3.24: where the joints of a tile lie, for n squares across: the dark thin lines, folded over one square
  function findJoints(img, n) {
    const N = 384; const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const L = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    const out = [];
    for (const axis of [0, 1]) {
      const prof = new Float32Array(N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) prof[axis ? y : x] += L[y * N + x] / N;
      // darker than its surroundings (a joint), then folded over one square
      const r = Math.max(2, Math.round(N / n / 3)); const dark = new Float32Array(N);
      for (let i = 0; i < N; i++) { let sum = 0; for (let k = -r; k <= r; k++) sum += prof[(i + k + N) % N]; dark[i] = Math.max(0, sum / (2 * r + 1) - prof[i]); }
      const B = 96; const fold = new Float32Array(B); const cnt = new Float32Array(B); const P = N / n;
      for (let i = 0; i < N; i++) { const b = Math.floor((((i + 0.5) % P) / P) * B) % B; fold[b] += dark[i]; cnt[b]++; }
      let best = 0; let at = 0;
      for (let b = 0; b < B; b++) { let v = 0; for (let k = -2; k <= 2; k++) { const j = (b + k + B) % B; v += cnt[j] ? fold[j] / cnt[j] : 0; } if (v > best) { best = v; at = b; } }
      out.push(Math.round(((at + 0.5) / B) * 1000) / 1000);
    }
    return out;
  }
  const matInfo = (id) => { const t = byId.get(id) || byId.get('stone_wall'); return t ? { url: DIR + t.file, squares: t.squares, id: t.id } : null; };
  const images = new Map(); // url → Promise<Image>
  function image(url) {
    if (!images.has(url)) images.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => { images.delete(url); rej(new Error(`tile picture ${url}`)); }; i.src = url; }));
    return images.get(url);
  }
  // a tile scaled down well (halving steps) to the size it is painted at
  function scaled(img, px) {
    px = Math.max(8, Math.round(px));
    let src = img; let w = img.naturalWidth || img.width;
    while (w / 2 >= px * 1.05) {
      const c = document.createElement('canvas'); c.width = c.height = Math.round(w / 2);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
      if (src !== img) src.width = src.height = 0; // (let go at once: a canvas can hold memory of the graphics card)
      src = c; w = c.width;
    }
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, px, px);
    if (src !== img) src.width = src.height = 0;
    return c;
  }

  // ---------- what was drawn: its box, and how to paint each thing ----------
  function itemBox(it) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of it.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = it.kind === 'line' ? it.w / 2 : it.kind === 'pillar' ? it.r : it.shape === 'path' || it.shape === 'brush' ? it.r : 0;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  function bounds(os) {
    let b = null;
    for (const it of os.items) {
      if (it.kind === 'cut') continue;
      const q = itemBox(it);
      b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q;
    }
    return b;
  }
  // a path in picture dots for an area or cut; T: map inches → dots
  function shapePath(it, T) {
    const p = new Path2D();
    const P = it.pts.map(([x, y]) => T(x, y));
    if (it.shape === 'rect') { const [a, b] = P; p.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
    else if (it.shape === 'round') { const [a, b] = P; p.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2); }
    else if (it.shape === 'poly') { P.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); }
    return p;
  }
  // corridors and brush strokes are drawn as thick lines
  function stroke(g, it, T, k, style) {
    const P = it.pts.map(([x, y]) => T(x, y));
    g.save();
    g.lineWidth = Math.max(1, it.r * 2 * k);
    g.lineCap = it.shape === 'path' ? 'square' : 'round'; g.lineJoin = it.shape === 'path' ? 'miter' : 'round'; g.miterLimit = 3;
    g.strokeStyle = style;
    g.beginPath();
    if (P.length === 1) { g.moveTo(P[0][0], P[0][1]); g.lineTo(P[0][0] + 0.01, P[0][1]); } else P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.restore();
  }
  // fill (or erase) one area/cut with a style
  function paintArea(g, it, T, k, style, erase) {
    g.save();
    if (erase) g.globalCompositeOperation = 'destination-out';
    if (it.shape === 'path' || it.shape === 'brush') stroke(g, it, T, k, erase ? '#000' : style);
    else { g.fillStyle = erase ? '#000' : style; g.fill(shapePath(it, T)); }
    g.restore();
  }
  // wall lines and pillars
  function paintSolid(g, it, T, k, style, erase) {
    g.save();
    if (erase) g.globalCompositeOperation = 'destination-out';
    g.fillStyle = g.strokeStyle = erase ? '#000' : style;
    if (it.kind === 'line') {
      const P = it.pts.map(([x, y]) => T(x, y));
      g.lineWidth = Math.max(1, it.w * k); g.lineCap = 'square'; g.lineJoin = 'miter';
      g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    } else if (it.kind === 'pillar') {
      const [x, y] = T(it.pts[0][0], it.pts[0][1]); const r = it.r * k;
      g.beginPath();
      if (it.round) g.arc(x, y, r, 0, Math.PI * 2); else g.rect(x - r, y - r, 2 * r, 2 * r);
      g.fill();
    }
    g.restore();
  }
  const stairsBox = (it, T) => { const [a, b] = it.pts.map(([x, y]) => T(x, y)); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]; };

  // ---------- a fingerprint of what the picture depends on ----------
  function hash(map, lib) {
    const os = map.os;
    const tiles = new Set();
    for (const it of os.items) if (it.tile) { const t = tileInfo(it.tile, lib); tiles.add(`${it.tile.rel || it.tile.path}=${t ? `${t.squares}@${t.off}` : '?'}`); }
    const s = JSON.stringify([os.items, os.doors, os.sun, os.sight, !!os.depth, map.grid.size, map.grid.ox, map.grid.oy, [...tiles].sort(), 7]);
    let h1 = 0x811c9dc5; let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }

  // ---------- WebGL 2 ----------
  let GLC = null;
  function gl2() {
    if (GLC === false) return null;
    if (GLC && !GLC.gl.isContextLost()) return GLC;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) { GLC = false; return null; }
      GLC = { gl, canvas: c, progs: new Map() };
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      GLC.buf = buf;
      return GLC;
    } catch { GLC = false; return null; }
  }
  const VS = `#version 300 es
in vec2 a; out vec2 v_uv; void main(){ v_uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;
  function prog(C, name, fs) {
    if (C.progs.has(name)) return C.progs.get(name);
    const { gl } = C;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`oldschool shader ${name}: ${gl.getShaderInfoLog(s)}`); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`oldschool program ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    const out = { p, u }; C.progs.set(name, out); return out;
  }
  function tex(gl, w, h, src, { repeat = false, mip = false, nearest = false } = {}) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    return t;
  }
  function target(gl, w, h) {
    const t = tex(gl, w, h, null, { nearest: true });
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb };
  }
  function run(C, P, w, h, fb, uniforms, textures) {
    const { gl } = C;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h);
    gl.useProgram(P.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, C.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let unit = 0;
    for (const [name, t] of Object.entries(textures || {})) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); if (P.u[name]) gl.uniform1i(P.u[name], unit); unit++; }
    for (const [name, v] of Object.entries(uniforms || {})) {
      const loc = P.u[name]; if (!loc) continue;
      if (Array.isArray(v)) { if (v.length === 2) gl.uniform2f(loc, v[0], v[1]); else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]); else gl.uniform1fv(loc, v); } else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  // the heavy passes in bands of rows, with a breath in between: one huge draw can make a weak graphics card (or the
  // browser's watchdog) give up, and the screen stays smooth while the picture is made
  // The graphics card is given the work in portions, and the next one only when it has done the last (a fence): a
  // portion queued on top of another is done in one go, and one go that lasts too long makes the browser give up on
  // the graphics card (it happened on slow ones). The portion grows while the card keeps up easily.
  function pacer(gl) {
    let budget = 260000; let since = 0; // heavy dots between waits
    return {
      band: (w) => Math.max(8, Math.floor(budget / Math.max(1, w))),
      async add(n) {
        since += n; if (since < budget) return;
        since = 0;
        const t0 = performance.now();
        const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        try {
          for (let i = 0; i < 6000; i++) {
            const st = gl.clientWaitSync(f, 0, 0);
            if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break;
            await new Promise((r) => setTimeout(r, i < 4 ? 0 : 4));
            if (gl.isContextLost()) throw new Error('the graphics card stopped');
          }
        } finally { gl.deleteSync(f); }
        const ms = performance.now() - t0;
        if (ms < 15) budget = Math.min(budget * 2, 64e6); else if (ms > 300) budget = Math.max(40000, budget / 2);
      },
    };
  }
  async function runBands(C, P, w, h, fb, uniforms, textures, pace) {
    const { gl } = C;
    run(C, P, w, 0, fb, uniforms, textures); // (binds everything; draws nothing)
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    try {
      for (let y = 0; y < h;) {
        const band = Math.min(pace.band(w), h - y);
        gl.scissor(0, y, w, band);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        y += band;
        await pace.add(w * band);
        if (gl.isContextLost()) throw new Error('the graphics card stopped');
      }
    } finally { gl.disable(gl.SCISSOR_TEST); }
  }

  // jump flooding: for every dot, the nearest seed (a dot where the mask says so) and how far it is. Coordinates are
  // kept in 8-bit channels (x in red and green, y in blue and alpha); 65535 means none yet.
  const FS_SEED = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D m; uniform vec2 size; uniform float ch; uniform float inv;
vec4 enc(vec2 p){ return vec4(floor(p.x/256.0), mod(p.x,256.0), floor(p.y/256.0), mod(p.y,256.0))/255.0; }
void main(){
  vec2 px = floor(v_uv * size);
  vec4 s = texelFetch(m, ivec2(px), 0);
  float v = ch < 0.5 ? s.a : (ch < 1.5 ? s.r : s.g);
  bool seed = inv > 0.5 ? v < 0.5 : v >= 0.5;
  o = seed ? enc(px) : vec4(1.0);
}`;
  const FS_JFA = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D j; uniform vec2 size; uniform float step;
vec2 dec(vec4 c){ c = floor(c * 255.0 + 0.5); return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a); }
vec4 enc(vec2 p){ return vec4(floor(p.x/256.0), mod(p.x,256.0), floor(p.y/256.0), mod(p.y,256.0))/255.0; }
void main(){
  vec2 px = floor(v_uv * size);
  vec2 best = vec2(65535.0); float bd = 1e20;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    vec2 q = px + vec2(float(dx), float(dy)) * step;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= size.x || q.y >= size.y) continue;
    vec2 s = dec(texelFetch(j, ivec2(q), 0));
    if (s.x > 65000.0) continue;
    float d = dot(s - px, s - px);
    if (d < bd) { bd = d; best = s; }
  }
  o = best.x > 65000.0 ? vec4(1.0) : enc(best);
}`;
  async function flood(C, w, h, mask, ch, inv, pace) {
    const { gl } = C;
    const A = target(gl, w, h); const B = target(gl, w, h);
    const pass = (w * h) / 6; // (a pass reads nine dots: lighter than the light and shade)
    run(C, prog(C, 'seed', FS_SEED), w, h, A.fb, { size: [w, h], ch, inv }, { m: mask });
    await pace.add(pass);
    let src = A; let dst = B;
    for (let s = 2 ** Math.ceil(Math.log2(Math.max(w, h))) / 2; s >= 1; s /= 2) {
      run(C, prog(C, 'jfa', FS_JFA), w, h, dst.fb, { size: [w, h], step: s }, { j: src.t });
      [src, dst] = [dst, src];
      await pace.add(pass);
    }
    // (one more pass at step 1 smooths the last errors)
    run(C, prog(C, 'jfa', FS_JFA), w, h, dst.fb, { size: [w, h], step: 1 }, { j: src.t });
    await pace.add(pass);
    gl.deleteFramebuffer(src.fb); gl.deleteTexture(src.t); gl.deleteFramebuffer(dst.fb);
    return dst.t;
  }

  // the heights: floors at their level (a ledge's rim raised), built walls, rock and cliffs outside, wall lines and
  // pillars, stairs. Heights are in dots; stored as 16 bits (red, green) around 32768, with what the dot is in blue
  // (0 void, 1 floor, 2 wall band, 3 rock, 4 cliff, 5 wall line or pillar, 6 stairs, 7 ledge rim) and its material in alpha.
  const FS_HEIGHT = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D floorT, attrT, solidT, stairsT, outJ, inJ, solJ, mtl0, mtl1, mtl2, mtl3, mtl4;
uniform vec2 size; uniform float P; uniform vec2 org; uniform float matSq[5];
vec2 dec(vec4 c){ c = floor(c * 255.0 + 0.5); return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 matCol(int i, vec2 px){ vec2 uv = (px - org) / (matSq[i] * P);
  if (i == 0) return texture(mtl0, uv).rgb; if (i == 1) return texture(mtl1, uv).rgb; if (i == 2) return texture(mtl2, uv).rgb; if (i == 3) return texture(mtl3, uv).rgb; return texture(mtl4, uv).rgb; }
vec4 encH(float h, float kind, float m){ float v = clamp(h + 32768.0, 0.0, 65535.0); return vec4(floor(v/256.0)/255.0, mod(floor(v),256.0)/255.0, kind/255.0, m/255.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 px = floor(v_uv * size); ivec2 ip = ivec2(px);
  vec4 fl = texelFetch(floorT, ip, 0); vec4 at = texelFetch(attrT, ip, 0); vec4 so = texelFetch(solidT, ip, 0); vec4 st = texelFetch(stairsT, ip, 0);
  float LV = 0.35 * P;                       // one level up or down
  float inside = fl.a;
  vec2 so2 = dec(texelFetch(outJ, ip, 0)); float dOut = so2.x > 65000.0 ? 1e5 : length(so2 - px); // to the nearest floor
  vec2 si2 = dec(texelFetch(inJ, ip, 0)); float dIn = si2.x > 65000.0 ? 1e5 : length(si2 - px);   // to the nearest dot outside
  // what the nearest area is: its edge, material and level
  vec4 na = inside >= 0.5 || so2.x > 65000.0 ? at : texelFetch(attrT, ivec2(so2), 0);
  int edge = int(floor(na.r * 255.0 / 40.0 + 0.5));
  int mi = int(floor(na.b * 255.0 / 40.0 + 0.5)); mi = clamp(mi - 1, 0, 4);
  float level = (na.g * 255.0 - 128.0) / 30.0;
  float base = level * LV;
  float h; float kind; float m = float(mi);
  if (inside >= 0.5) {
    h = (at.g * 255.0 - 128.0) / 30.0 * LV; kind = 1.0;
    if (edge == 1) { // ledge: a rim of the floor itself along the edge, raised and rounded
      float r = 0.26 * P;
      if (dIn < r) { float t = clamp(dIn / r, 0.0, 1.0); h += 0.22 * P * sqrt(clamp((1.0 - t) * 3.0, 0.0, 1.0)) * smoothstep(0.0, 0.35, t); kind = 7.0; }
    }
    if (st.g > 0.5) { // stairs: steps up toward where they climb
      float steps = max(2.0, floor(st.b * 255.0));
      h = base + floor(st.r * steps) / steps * LV + LV / steps; kind = 6.0;
    }
  } else if (edge == 2) { // built walls: a band outside the floor
    float T = 0.45 * P;
    if (dOut < T) { float bev = min(smoothstep(0.0, 0.07 * P, dOut + 0.5), smoothstep(0.0, 0.07 * P, T - dOut)); h = base + 1.6 * P * (0.82 + 0.18 * bev); kind = 2.0; }
    else { h = base - 2.0 * P; kind = 0.0; }
  } else if (edge == 3) { // solid rock around the floor, rough where it meets it and where it ends in darkness
    vec3 c = matCol(mi, px);
    float rough = noise(px / (0.35 * P)) * 0.18 * P + noise(px / (0.12 * P)) * 0.07 * P;
    float R = 2.3 * P + (noise(px / (0.7 * P)) - 0.5) * 0.9 * P + (noise(px / (0.2 * P)) - 0.5) * 0.25 * P;
    if (dOut > R) { h = base - 2.0 * P; kind = 0.0; }
    else {
      float rise = smoothstep(0.0, 0.3 * P + rough, dOut) * (1.0 - smoothstep(R - 0.35 * P, R, dOut) * 0.6);
      h = base + 1.4 * P * rise + lum(c) * 0.35 * P; kind = 3.0;
    }
  } else if (edge == 4) { // a cliff: rock falling away into darkness
    vec3 c = matCol(mi, px);
    if (dOut > 3.2 * P) { h = base - 3.0 * P; kind = 0.0; }
    else { h = base - dOut * 0.9 + lum(c) * 0.3 * P + noise(px / (0.4 * P)) * 0.15 * P; kind = 4.0; }
  } else { // ledge: nothing beyond it but darkness
    h = base - 3.0 * P; kind = 0.0;
  }
  if (so.r > 0.5) { // wall lines and pillars
    vec2 ss = dec(texelFetch(solJ, ip, 0)); float ds = ss.x > 65000.0 ? 1e5 : length(ss - px);
    float bev = smoothstep(0.0, 0.07 * P, ds);
    float sh = so.g * 255.0 / 100.0; // its height (1 = a full wall)
    h = max(h, (inside >= 0.5 ? (at.g * 255.0 - 128.0) / 30.0 * LV : base) + 1.6 * P * sh * (0.82 + 0.18 * bev)); kind = 5.0;
    m = clamp(floor(so.b * 255.0 / 40.0 + 0.5) - 1.0, 0.0, 4.0);
  }
  o = encH(h, kind, m);
}`;

  // light, shadows and darker corners
  const FS_SHADE = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D hT, floorT, outJ, inJ, mtl0, mtl1, mtl2, mtl3, mtl4;
uniform vec2 size; uniform float P; uniform vec2 org; uniform float matSq[5]; uniform vec3 L; uniform vec3 voidC;
vec2 dec(vec4 c){ c = floor(c * 255.0 + 0.5); return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a); }
float H(vec2 p){ p = clamp(p, vec2(0.0), size - 1.0); vec4 c = texelFetch(hT, ivec2(p), 0); return floor(c.r*255.0+0.5)*256.0 + floor(c.g*255.0+0.5) - 32768.0; }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 matCol(int i, vec2 px){ vec2 uv = (px - org) / (matSq[i] * P);
  if (i == 0) return texture(mtl0, uv).rgb; if (i == 1) return texture(mtl1, uv).rgb; if (i == 2) return texture(mtl2, uv).rgb; if (i == 3) return texture(mtl3, uv).rgb; return texture(mtl4, uv).rgb; }
void main(){
  vec2 px = floor(v_uv * size); ivec2 ip = ivec2(px);
  vec4 hc = texelFetch(hT, ip, 0);
  float kind = floor(hc.b * 255.0 + 0.5); int mi = int(floor(hc.a * 255.0 + 0.5));
  float h = H(px);
  vec4 fl = texelFetch(floorT, ip, 0);
  vec2 so2 = dec(texelFetch(outJ, ip, 0)); float dOut = so2.x > 65000.0 ? 1e5 : length(so2 - px);
  // what it looks like
  vec3 alb;
  if (kind == 1.0 || kind == 6.0 || kind == 7.0) alb = fl.rgb;
  else if (kind == 0.0) alb = voidC;
  else alb = matCol(mi, px);
  if (kind == 7.0) alb = alb * 1.12 + 0.025; // the ledge's rim: the floor, a little lighter
  // its slope: from the heights, plus the picture's own bumps on rock and walls
  float e = 1.5;
  float hx = H(px + vec2(e, 0.0)) - H(px - vec2(e, 0.0));
  float hy = H(px + vec2(0.0, e)) - H(px - vec2(0.0, e));
  float bump = (kind >= 2.0 && kind <= 5.0) ? 0.9 : 0.25;
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0 / max(bump, 0.2)));
  float lam = max(dot(n, L), 0.0) / L.z;
  // shadows: does anything between here and the sun rise above the sun's ray?
  float tanE = L.z / length(L.xy); vec2 d2 = normalize(L.xy);
  float sh = 0.0; float reach = 2.2 * P / tanE;
  for (int i = 1; i <= 56; i++) {
    float t = float(i) / 56.0; t = t * t * reach + 1.0;
    float above = H(px + d2 * t) - (h + t * tanE);
    sh = max(sh, clamp(above / (2.0 + t * 0.12), 0.0, 1.0));
  }
  // darker where it is surrounded by what is higher
  float ao = 0.0; float rr = 0.3 * P;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236; float r = (i % 2 == 0) ? rr : rr * 2.2;
    ao += clamp((H(px + vec2(cos(a), sin(a)) * r) - h) / (0.9 * P), 0.0, 1.0);
  }
  ao = 1.0 - 0.45 * ao / 12.0;
  float light = (0.5 + 0.5 * lam) * (1.0 - 0.5 * sh) * ao;
  vec3 c = alb * light;
  // the cliff fades into darkness; beyond the drawing the picture is see-through (the table's own dark shows there)
  float a = 1.0;
  if (kind == 4.0) { c = mix(voidC, c, exp(-dOut / (0.42 * P))); a = 1.0 - smoothstep(2.0 * P, 2.8 * P, dOut); }
  if (kind == 0.0) { c = voidC; a = 0.0; }
  o = vec4(clamp(c, 0.0, 1.0), a);
}`;

  // ---------- making the picture ----------
  // map: the map (os, grid). lib: library items (for tiles of the library). Resolves to { empty } or
  // { blob, x, y, scale, nw, nh, walls }.
  async function bake(map, lib) {
    const os = map.os; const grid = map.grid;
    const g = grid.size || 1; const ox = grid.ox || 0; const oy = grid.oy || 0;
    const b = bounds(os);
    if (!b) return { empty: true, walls: [] };
    // the picture's box: whole squares around what was drawn, plus a margin
    const sx0 = Math.floor((b[0] - ox) / g) - MARGIN; const sy0 = Math.floor((b[1] - oy) / g) - MARGIN;
    const sx1 = Math.ceil((b[2] - ox) / g) + MARGIN; const sy1 = Math.ceil((b[3] - oy) / g) + MARGIN;
    const nsx = sx1 - sx0; const nsy = sy1 - sy0;
    const P = Math.max(16, Math.min(PX, Math.floor(Math.sqrt(MAX_PX / (nsx * nsy)))));
    const W = nsx * P; const Hh = nsy * P;
    const X0 = ox + sx0 * g; const Y0 = oy + sy0 * g; const k = P / g;
    const T = (x, y) => [(x - X0) * k, (y - Y0) * k];
    const org = [(ox - X0) * k, (oy - Y0) * k]; // where the grid starts, in dots (tiles line up with it)
    // the pictures it needs
    const want = new Map();
    for (const it of os.items) {
      if (it.kind === 'area' && it.tile) { const t = tileInfo(it.tile, lib); if (t && t.url) want.set(t.url, t); }
      if (it.kind === 'stairs') { const t = matInfo(it.mat); if (t) want.set(t.url, t); }
    }
    const loaded = new Map();
    await Promise.all([...want.values()].map(async (t) => { try { loaded.set(t.url, await image(t.url)); } catch (err) { console.error(err); } }));
    const pats = new Map(); // url → pattern at its size
    const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const CPU = { willReadFrequently: true }; // (read back: kept in memory)
    const floorC = canvas(W, Hh); const fg = floorC.getContext('2d');
    const attrC = canvas(W, Hh); const ag = attrC.getContext('2d', CPU);
    const solidC = canvas(W, Hh); const sg = solidC.getContext('2d');
    const stairsC = canvas(W, Hh); const tg = stairsC.getContext('2d');
    const patOf = (t) => {
      if (!t || !loaded.has(t.url)) return '#5a5650';
      const off = t.off || [0, 0];
      const key = `${t.url}@${t.squares || 4}@${off}`;
      if (!pats.has(key)) {
        const s = (t.squares || 4) * P;
        const cv = scaled(loaded.get(t.url), s);
        const pat = fg.createPattern(cv, 'repeat');
        pat.setTransform(new DOMMatrix().translate(org[0] - off[0] * P, org[1] - off[1] * P)); // (its joints on the grid)
        pats.set(key, { pat, cv });
      }
      return pats.get(key).pat;
    };
    const matCode = (id) => { const i = MATERIALS.findIndex((m) => m.id === id); return (i < 0 ? 1 : i + 1) * 40; };
    for (const it of os.items) {
      if (it.kind === 'area') {
        const t = tileInfo(it.tile, lib) || tileInfo({ rel: relOf(FLOORS[0]) });
        paintArea(fg, it, T, k, patOf(t), false);
        paintArea(ag, it, T, k, `rgb(${EDGE_CODE[it.edge] * 40},${128 + it.level * 30},${matCode(it.mat || DEFAULT_MAT[it.edge])})`, false);
        paintArea(tg, it, T, k, '#000', true); // (a floor drawn over stairs takes them away)
      } else if (it.kind === 'cut') {
        for (const c of [fg, ag, tg]) paintArea(c, it, T, k, null, true);
        sg.save(); sg.globalCompositeOperation = 'destination-out'; if (it.shape === 'path' || it.shape === 'brush') stroke(sg, it, T, k, '#000'); else sg.fill(shapePath(it, T)); sg.restore();
      } else if (it.kind === 'line' || it.kind === 'pillar') {
        paintSolid(sg, it, T, k, `rgb(255,${Math.round((it.h || 1) * 100)},${matCode(it.mat)})`, false);
      } else if (it.kind === 'stairs') {
        const [x, y, w, h] = stairsBox(it, T);
        const len = it.dir % 2 === 0 ? w : h; const steps = Math.max(2, Math.round((len / P) * 3));
        const gr = it.dir === 0 ? tg.createLinearGradient(x, 0, x + w, 0) : it.dir === 2 ? tg.createLinearGradient(x + w, 0, x, 0) : it.dir === 1 ? tg.createLinearGradient(0, y, 0, y + h) : tg.createLinearGradient(0, y + h, 0, y);
        gr.addColorStop(0, `rgb(0,255,${steps})`); gr.addColorStop(1, `rgb(255,255,${steps})`);
        tg.fillStyle = gr; tg.fillRect(x, y, w, h);
        // the steps themselves: the stairs' material; every step a little lighter than the one below, its front (the
        // riser, toward the bottom of the stairs) a dark band, its edge (the nosing) a light line
        fg.save(); fg.fillStyle = patOf(matInfo(it.mat)); fg.fillRect(x, y, w, h);
        const along = it.dir % 2 === 0 ? w : h; const depth = along / steps;
        const rect = (a0, a1) => { // a band from a0 to a1 along the climb (0 = bottom of the stairs)
          const lo = Math.min(a0, a1); const len2 = Math.abs(a1 - a0);
          if (it.dir === 0) return [x + lo, y, len2, h];
          if (it.dir === 2) return [x + w - lo - len2, y, len2, h];
          if (it.dir === 1) return [x, y + lo, w, len2];
          return [x, y + h - lo - len2, w, len2];
        };
        for (let i = 0; i < steps; i++) {
          const a0 = i * depth;
          fg.fillStyle = `rgba(0,0,0,${(0.34 * (steps - 1 - i)) / Math.max(1, steps - 1)})`; fg.fillRect(...rect(a0, a0 + depth)); // lower steps darker
          fg.fillStyle = 'rgba(0,0,0,0.5)'; fg.fillRect(...rect(a0, a0 + depth * 0.2)); // the riser
          fg.fillStyle = 'rgba(255,240,220,0.22)'; fg.fillRect(...rect(a0 + depth * 0.2, a0 + depth * 0.2 + Math.max(1, P * 0.025))); // the nosing
        }
        fg.restore();
        // stairs count as floor, at the level of the floor they stand on
        const id = ag.getImageData(Math.max(0, Math.min(W - 1, Math.round(x + w / 2))), Math.max(0, Math.min(Hh - 1, Math.round(y + h / 2))), 1, 1).data;
        ag.fillStyle = id[3] > 128 ? `rgb(${id[0]},${id[1]},${id[2]})` : `rgb(80,128,${matCode('stone_wall')})`; ag.fillRect(x, y, w, h);
      }
    }
    // doors: an opening in wall lines, and the door itself drawn on top at the end
    for (const d of os.doors) {
      const [x1, y1] = T(d.x1, d.y1); const [x2, y2] = T(d.x2, d.y2);
      sg.save(); sg.globalCompositeOperation = 'destination-out'; sg.lineWidth = P * 1.2; sg.lineCap = 'butt'; sg.beginPath(); sg.moveTo(x1, y1); sg.lineTo(x2, y2); sg.stroke(); sg.restore();
    }
    // ---- light and shadow (WebGL 2) ----
    const C = gl2();
    let out = null; let hC = null;
    if (C) {
      try { const r = await shade(C, W, Hh, P, org, os, { floorC, attrC, solidC, stairsC }); out = r.out; hC = r.hC; } catch (err) { console.error(err); out = null; }
    }
    if (!out) { // no graphics card: the flat painting with simple dark edges
      out = canvas(W, Hh); const o = out.getContext('2d', CPU);
      o.save(); o.shadowColor = 'rgba(0,0,0,0.9)'; o.shadowBlur = P * 0.25; o.drawImage(floorC, 0, 0); o.restore();
      o.drawImage(solidC, 0, 0);
    }
    drawDoors(out.getContext('2d'), os, T, P, k);
    const blob = await new Promise((res) => out.toBlob(res, 'image/webp', 0.88));
    // (Beta 3.23) with the depth view on: the heights too, without loss (PNG)
    const hblob = hC ? await new Promise((res) => hC.toBlob(res, 'image/png')) : null;
    if (hC) hC.width = hC.height = 0;
    // the big paintings are let go at once: canvases can hold memory of the graphics card until they are collected,
    // and a drawing session makes many pictures
    for (const c of [floorC, attrC, solidC, stairsC, out]) c.width = c.height = 0;
    for (const p of pats.values()) if (p && p.cv) p.cv.width = p.cv.height = 0;
    const walls = sightWalls(os, map, lib, { X0, Y0, nsx, nsy, g });
    return { blob, hblob, x: X0, y: Y0, scale: g / P, nw: W, nh: Hh, walls };
  }

  async function shade(C, W, Hh, P, org, os, cv) {
    const { gl } = C;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (W > max || Hh > max) return null;
    if (C.canvas.width !== 1) C.canvas.width = C.canvas.height = 1; // (everything is drawn off screen)
    const tFloor = tex(gl, W, Hh, cv.floorC, { nearest: true });
    const tAttr = tex(gl, W, Hh, cv.attrC, { nearest: true });
    const tSolid = tex(gl, W, Hh, cv.solidC, { nearest: true });
    const tStairs = tex(gl, W, Hh, cv.stairsC, { nearest: true });
    // the materials (repeating, at their own squares)
    const mats = [];
    for (const m of MATERIALS) { const img = await image(DIR + m.file); const sc = scaled(img, m.squares * P); mats.push(tex(gl, 0, 0, sc, { repeat: true, mip: true })); sc.width = sc.height = 0; } // (at the size they are painted)
    while (mats.length < 5) mats.push(mats[0]);
    const matSq = MATERIALS.slice(0, 5).map((m) => m.squares); while (matSq.length < 5) matSq.push(4);
    const matT = { mtl0: mats[0], mtl1: mats[1], mtl2: mats[2], mtl3: mats[3], mtl4: mats[4] };
    // floors (and stairs) are inside; distances both ways, and inside wall lines
    const merged = target(gl, W, Hh);
    run(C, prog(C, 'inside', `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D a, s; uniform vec2 size;
void main(){ ivec2 p = ivec2(floor(v_uv * size)); float f = max(texelFetch(a, p, 0).a, texelFetch(s, p, 0).g); o = vec4(0.0, 0.0, 0.0, f >= 0.5 ? 1.0 : 0.0); }`), W, Hh, merged.fb, { size: [W, Hh] }, { a: tFloor, s: tStairs });
    const pace = pacer(gl);
    const outJ = await flood(C, W, Hh, merged.t, 0, 0, pace); // seeds: inside → for outside dots, the nearest floor
    const inJ = await flood(C, W, Hh, merged.t, 0, 1, pace); // seeds: outside → for floor dots, the nearest edge
    const solJ = await flood(C, W, Hh, tSolid, 1, 1, pace); // inside wall lines: how far to their side
    gl.deleteTexture(merged.t); gl.deleteFramebuffer(merged.fb); // (what is no longer needed goes at once: a big map needs the room)
    const Ht = target(gl, W, Hh);
    await runBands(C, prog(C, 'height', FS_HEIGHT), W, Hh, Ht.fb, { size: [W, Hh], P, org, matSq }, { floorT: tFloor, attrT: tAttr, solidT: tSolid, stairsT: tStairs, outJ, inJ, solJ, ...matT }, pace);
    for (const t of [tAttr, tSolid, tStairs, solJ]) gl.deleteTexture(t);
    const a = ((os.sun ?? 135) * Math.PI) / 180; const el = (40 * Math.PI) / 180;
    const L = [Math.cos(a) * Math.cos(el), -Math.sin(a) * Math.cos(el), Math.sin(el)];
    const Sh = target(gl, W, Hh);
    await runBands(C, prog(C, 'shade', FS_SHADE), W, Hh, Sh.fb, { size: [W, Hh], P, org, matSq, L, voidC: [0.015, 0.016, 0.02] }, { hT: Ht.t, floorT: tFloor, outJ, inJ, ...matT }, pace);
    // read back into a painting in memory (rows come out top first, as the paintings went in)
    const outC = document.createElement('canvas'); outC.width = W; outC.height = Hh;
    {
      gl.bindFramebuffer(gl.FRAMEBUFFER, Sh.fb);
      const px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      outC.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, Hh), 0, 0);
    }
    gl.deleteTexture(Sh.t); gl.deleteFramebuffer(Sh.fb);
    // (Beta 3.23) the heights for the depth view: height in red and green, what the dot is (×8) and its material in
    // blue, fully opaque so nothing is lost on the way (rows come out top first: the paintings were uploaded that way)
    let hC = null;
    if (os.depth) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, Ht.fb);
      const px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < px.length; i += 4) { px[i + 2] = Math.min(255, px[i + 2] * 8 + px[i + 3]); px[i + 3] = 255; }
      hC = document.createElement('canvas'); hC.width = W; hC.height = Hh;
      hC.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, Hh), 0, 0);
    }
    for (const t of [tFloor, outJ, inJ, Ht.t, ...new Set(mats)]) gl.deleteTexture(t);
    gl.deleteFramebuffer(Ht.fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { out: outC, hC };
  }
  // doors: a wooden leaf with stone posts (secret doors show nothing; windows a strip of glass)
  function drawDoors(o, os, T, P) {
    for (const d of os.doors) {
      if (d.door === 2) continue;
      const [x1, y1] = T(d.x1, d.y1); const [x2, y2] = T(d.x2, d.y2);
      const len = Math.hypot(x2 - x1, y2 - y1); if (len < 2) continue;
      o.save(); o.translate(x1, y1); o.rotate(Math.atan2(y2 - y1, x2 - x1));
      const th = d.kind === 'window' ? P * 0.12 : P * 0.2; const post = P * 0.16;
      if (d.kind === 'window') {
        o.fillStyle = 'rgba(150,200,230,0.75)'; o.fillRect(post, -th / 2, len - 2 * post, th);
        o.strokeStyle = 'rgba(20,30,40,0.8)'; o.lineWidth = Math.max(1, P * 0.02); o.strokeRect(post, -th / 2, len - 2 * post, th);
      } else {
        o.shadowColor = 'rgba(0,0,0,0.7)'; o.shadowBlur = P * 0.12; o.shadowOffsetX = P * 0.05; o.shadowOffsetY = P * 0.07;
        const gr = o.createLinearGradient(0, -th / 2, 0, th / 2); gr.addColorStop(0, '#8a5d34'); gr.addColorStop(0.5, '#6e4625'); gr.addColorStop(1, '#4c2f18');
        o.fillStyle = gr; o.fillRect(post * 0.6, -th / 2, len - post * 1.2, th);
        o.shadowColor = 'transparent';
        o.strokeStyle = '#2a1a0d'; o.lineWidth = Math.max(1, P * 0.025); o.strokeRect(post * 0.6, -th / 2, len - post * 1.2, th);
        for (let i = 1; i < 4; i++) { const xx = post * 0.6 + ((len - post * 1.2) * i) / 4; o.beginPath(); o.moveTo(xx, -th / 2); o.lineTo(xx, th / 2); o.stroke(); }
        o.fillStyle = '#c9a25a'; o.beginPath(); o.arc(len * 0.72, 0, P * 0.035, 0, Math.PI * 2); o.fill();
      }
      o.fillStyle = '#6f6a63'; o.strokeStyle = '#2b2925'; o.lineWidth = Math.max(1, P * 0.02);
      for (const px of [0, len - post]) { o.fillRect(px, -post * 0.75, post, post * 1.5); o.strokeRect(px, -post * 0.75, post, post * 1.5); }
      o.restore();
    }
  }

  // ---------- walls for line of sight ----------
  // Where floors meet built walls or rock, the outline blocks sight; wall lines and pillars do too. Ledges and cliffs
  // do not (one sees across a drop). Doors sit in the walls as doors. Worked out on a small painting (12 dots a square):
  // its outlines, straightened.
  function sightWalls(os, map, lib, box) {
    const Q = 12; const { X0, Y0, nsx, nsy, g } = box; const k = Q / g;
    const W = nsx * Q; const H = nsy * Q;
    const T = (x, y) => [(x - X0) * k, (y - Y0) * k];
    // red: floors; green: what blocks (wall lines, pillars); blue: what edge the area there has
    const fl = document.createElement('canvas'); fl.width = W; fl.height = H; const fg = fl.getContext('2d', { willReadFrequently: true });
    const at = document.createElement('canvas'); at.width = W; at.height = H; const ag = at.getContext('2d', { willReadFrequently: true });
    const so = document.createElement('canvas'); so.width = W; so.height = H; const sg = so.getContext('2d', { willReadFrequently: true });
    for (const it of os.items) {
      if (it.kind === 'area') { paintArea(fg, it, T, k, '#fff', false); paintArea(ag, it, T, k, `rgb(${EDGE_CODE[it.edge] * 40},0,0)`, false); }
      else if (it.kind === 'cut') { paintArea(fg, it, T, k, null, true); paintArea(ag, it, T, k, null, true); sg.save(); sg.globalCompositeOperation = 'destination-out'; if (it.shape === 'path' || it.shape === 'brush') stroke(sg, it, T, k, '#000'); else sg.fill(shapePath(it, T)); sg.restore(); }
      else if (it.kind === 'line' || it.kind === 'pillar') paintSolid(sg, it, T, k, '#fff', false);
      else if (it.kind === 'stairs') { const [x, y, w, h] = stairsBox(it, T); fg.fillStyle = '#fff'; fg.fillRect(x, y, w, h); }
    }
    for (const d of os.doors) { const [x1, y1] = T(d.x1, d.y1); const [x2, y2] = T(d.x2, d.y2); sg.save(); sg.globalCompositeOperation = 'destination-out'; sg.lineWidth = Q * 1.2; sg.beginPath(); sg.moveTo(x1, y1); sg.lineTo(x2, y2); sg.stroke(); sg.restore(); }
    const F = fg.getImageData(0, 0, W, H).data; const A = ag.getImageData(0, 0, W, H).data; const S = sg.getImageData(0, 0, W, H).data;
    const inF = (x, y) => x >= 0 && y >= 0 && x < W && y < H && F[(y * W + x) * 4 + 3] >= 128;
    const inS = (x, y) => x >= 0 && y >= 0 && x < W && y < H && S[(y * W + x) * 4 + 3] >= 128;
    const edgeAt = (x, y) => { // the edge style of the floor nearest to (x, y) inside
      for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.round(x + dx); const yy = Math.round(y + dy);
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && A[(yy * W + xx) * 4 + 3] >= 128) return Math.round(A[(yy * W + xx) * 4] / 40);
      }
      return 0;
    };
    const out = [];
    const toMap = (x, y) => [X0 + x / k, Y0 + y / k];
    const add = (pts, keep) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        if (keep && !keep((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
        const [x1, y1] = toMap(a[0], a[1]); const [x2, y2] = toMap(b[0], b[1]);
        out.push([x1, y1, x2, y2]);
      }
    };
    // floors: their outlines where the edge is built walls or rock
    for (const loop of contours(W, H, inF)) {
      const pts = simplify(loop, 0.6);
      add(pts, (mx, my) => { const e = edgeAt(mx, my); return e === EDGE_CODE.walls || e === EDGE_CODE.rock; });
    }
    for (const loop of contours(W, H, inS)) add(simplify(loop, 0.6));
    // doors: the outline walls they lie on are cut there; the door is a wall of its own
    const walls = [];
    const doors = os.doors.map((d) => ({ ...d }));
    for (const s of out) for (const piece of cutByDoors(s, doors, g)) walls.push({ c: piece, key: `s${piece.map((v) => Math.round(v * 100)).join(',')}` });
    for (const d of doors) walls.push({ c: [d.x1, d.y1, d.x2, d.y2], door: d.kind === 'window' ? 0 : d.door, kind: d.kind === 'window' ? 'window' : undefined, key: `d${d.id}` });
    return walls;
  }
  // the outlines of where inside(x, y) is true: closed loops along the dots' edges, the inside on the right
  function contours(W, H, inside) {
    const out = new Map(); // corner → corners its edges lead to
    const add = (ax, ay, bx, by) => { const k = ax * 100003 + ay; let l = out.get(k); if (!l) out.set(k, (l = [])); l.push([bx, by]); };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inside(x, y)) continue;
        if (!inside(x, y - 1)) add(x, y, x + 1, y);
        if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!inside(x - 1, y)) add(x, y + 1, x, y);
      }
    }
    const loops = [];
    for (const [k0, list0] of out) {
      while (list0.length) {
        const sx = Math.floor(k0 / 100003); const sy = k0 - sx * 100003;
        const loop = [[sx, sy]]; let k = k0; let guard = 0;
        while (guard++ < 4e6) {
          const l = out.get(k); if (!l || !l.length) break;
          const e = l.pop(); loop.push(e); k = e[0] * 100003 + e[1];
          if (k === k0) break;
        }
        if (loop.length > 3) loops.push(loop);
      }
    }
    return loops;
  }
  // Ramer–Douglas–Peucker: fewer points, the same outline (tolerance in dots). A closed loop is cut in two at the
  // point farthest from its start first.
  function simplify(pts, tol) {
    const [sx, sy] = pts[0]; const [ex, ey] = pts[pts.length - 1];
    if (pts.length > 3 && sx === ex && sy === ey) {
      let m = 1; let best = -1;
      for (let i = 1; i < pts.length - 1; i++) { const d = (pts[i][0] - sx) ** 2 + (pts[i][1] - sy) ** 2; if (d > best) { best = d; m = i; } }
      return [...rdp(pts.slice(0, m + 1), tol), ...rdp(pts.slice(m), tol).slice(1)];
    }
    return rdp(pts, tol);
  }
  function rdp(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [i, j] = st.pop(); const [ax, ay] = pts[i]; const [bx, by] = pts[j];
      const L = Math.hypot(bx - ax, by - ay) || 1e-9; let best = -1; let bi = -1;
      for (let m = i + 1; m < j; m++) { const d = Math.abs((bx - ax) * (ay - pts[m][1]) - (ax - pts[m][0]) * (by - ay)) / L; if (d > best) { best = d; bi = m; } }
      if (best > tol) { keep[bi] = 1; st.push([i, bi], [bi, j]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // a wall piece minus the doors lying on it
  function cutByDoors(s, doors, g) {
    let pieces = [s];
    for (const d of doors) {
      const next = [];
      for (const [x1, y1, x2, y2] of pieces) {
        const dx = x2 - x1; const dy = y2 - y1; const L = Math.hypot(dx, dy); if (L < 1e-6) continue;
        const ux = dx / L; const uy = dy / L;
        const off = (px, py) => Math.abs((px - x1) * uy - (py - y1) * ux);
        if (off(d.x1, d.y1) > g * 0.2 || off(d.x2, d.y2) > g * 0.2) { next.push([x1, y1, x2, y2]); continue; }
        let a = (d.x1 - x1) * ux + (d.y1 - y1) * uy; let b = (d.x2 - x1) * ux + (d.y2 - y1) * uy; if (a > b) [a, b] = [b, a];
        if (b <= 0 || a >= L) { next.push([x1, y1, x2, y2]); continue; }
        if (a > 0.01) next.push([x1, y1, x1 + ux * a, y1 + uy * a]);
        if (b < L - 0.01) next.push([x1 + ux * b, y1 + uy * b, x2, y2]);
      }
      pieces = next;
    }
    return pieces;
  }

  // ---------- where the pointer is: which area (for the Floor tool) ----------
  let hitC = null;
  function areaAt(os, x, y) {
    hitC = hitC || document.createElement('canvas').getContext('2d');
    const T = (px, py) => [px, py];
    for (let i = os.items.length - 1; i >= 0; i--) {
      const it = os.items[i];
      if (it.kind !== 'area' && it.kind !== 'cut') continue;
      let hit;
      if (it.shape === 'path' || it.shape === 'brush') {
        const p = new Path2D(); it.pts.forEach(([px, py], j) => (j ? p.lineTo(px, py) : p.moveTo(px, py)));
        if (it.pts.length === 1) p.lineTo(it.pts[0][0] + 0.001, it.pts[0][1]);
        hitC.lineWidth = it.r * 2; hitC.lineCap = it.shape === 'path' ? 'square' : 'round'; hitC.lineJoin = it.shape === 'path' ? 'miter' : 'round';
        hit = hitC.isPointInStroke(p, x, y);
      } else hit = hitC.isPointInPath(shapePath(it, T), x, y);
      if (hit) return it.kind === 'area' ? it : null;
    }
    return null;
  }

  return { DATA, FLOORS, MATERIALS, EDGES, relOf, tileInfo, findJoints, matInfo, bounds, hash, bake, areaAt, supported: () => !!gl2(), DEFAULT_MAT };
})();
