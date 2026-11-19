// Oldschool maps (Beta 3.22): a map drawn on the grid instead of a picture.
//
// What the GM drew (map.os, see mapstate.js) becomes one picture here, on the GM screen: the floors with their tiles,
// the edges (a ledge, built walls, solid rock or a cliff into darkness, or a floor fading into it), wall lines, pillars, stairs and doors, all with
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
  const EDGES = ['walls', 'rock', 'ledge', 'cliff', 'fade']; // (Beta 3.28: Fade, the floor fading into the dark)
  const EDGE_CODE = { ledge: 1, walls: 2, rock: 3, cliff: 4, fade: 5 };
  const DEFAULT_MAT = { walls: 'stone_wall', rock: 'rock', cliff: 'cliff', ledge: 'stone_wall', fade: 'stone_wall' };
  const relOf = (t) => `Tiles/Tablescape/${t.label}.webp`;
  const builtinByRel = new Map(DATA.tiles.map((t) => [relOf(t), t]));
  const PX = 80; // dots per square in the picture (the TV shows about this many per inch)
  const MAX_PX = 12e6; // dots in the picture at most (a huge map gets fewer per square)
  const MARGIN = 3; // squares around what was drawn (rock and cliffs reach out)
  // Beta 3.25: the sharp layer. The picture above (80 dots a square at most) is the base; on top of it lie tiles made
  // with as many dots a square as the TV shows (the base was stretched there, and looked blurry). A tile is made again
  // only when something near it changed (its key), so a pillar costs one or two tiles, not the whole picture.
  const SHARP_MAX = 60e6; // dots in all the sharp tiles at most (a huge map gets fewer per square)
  // squares: how far a change reaches into the picture (Beta 3.31: worked out for each thing, see reaches; it was 6.6
  // for every floor); a door: the wall line it opens
  const HALO_SOLID = 3.4;
  const REACH = 3.4; // squares: how far what is drawn shows beyond itself (a tile further away is empty)
  const VERSION = 19; // (19: Beta 3.34, no frames: doorways through the wall, windows in a niche; 18: Beta 3.33, door and window frames of the wall's material, on the wall band; 17: Beta 3.31, the base at half size under sharp tiles, tiles of 1000 dots; 16: Beta 3.30, each square its own soft patch of the old floor, the new floor along the joints; 15: Beta 3.29, Fade outward, squares and joints, stairs; 14: Beta 3.28, cliffs that show, Fade, joints; 13: Beta 3.27, floors mix by opacity; 12: 3.26; 11: Beta 3.25, sharp tiles, the 2D look)
  let sharpWant = 0; // dots a square for the sharp tiles (0: none); the Draw tool sets it from the TV
  function setSharp(p) { const v = p > 0 && !api.noSharp ? Math.round(Math.min(200, Math.max(100, p))) : 0; const ch = v !== sharpWant; sharpWant = v; return ch; }

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
  // Beta 3.29: a Fade floor's tile goes on beyond its edge (the shaders fade it out there): the area grown by R dots
  const FADE_R = 1.7; // (squares: a little more than the fade's square and a half)
  function paintHalo(g, it, T, k, style, R) {
    g.save();
    if (it.shape === 'path' || it.shape === 'brush') stroke(g, { ...it, shape: 'brush', r: it.r + R / k }, T, k, style);
    else { const p = shapePath(it, T); g.fillStyle = style; g.strokeStyle = style; g.lineWidth = 2 * R; g.lineJoin = 'round'; g.fill(p); g.stroke(p); }
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

  // ---------- the picture's box: whole squares around what was drawn, plus a margin; its dots a square ----------
  function boxOf(map) {
    const os = map.os; const grid = map.grid;
    const g = grid.size || 1; const ox = grid.ox || 0; const oy = grid.oy || 0;
    const b = bounds(os);
    if (!b) return null;
    const sx0 = Math.floor((b[0] - ox) / g) - MARGIN; const sy0 = Math.floor((b[1] - oy) / g) - MARGIN;
    const sx1 = Math.ceil((b[2] - ox) / g) + MARGIN; const sy1 = Math.ceil((b[3] - oy) / g) + MARGIN;
    const nsx = sx1 - sx0; const nsy = sy1 - sy0;
    const P = Math.max(16, Math.min(PX, Math.floor(Math.sqrt(MAX_PX / (nsx * nsy)))));
    let sharp = null;
    if (sharpWant) {
      const PH = Math.min(sharpWant, Math.floor(Math.sqrt(SHARP_MAX / (nsx * nsy))));
      // (a tile: at most 1000 dots across. Beta 3.31, was 1600: a change re-makes fewer dots)
      if (PH >= P * 1.2) sharp = { P: PH, ts: Math.max(4, Math.floor(1000 / PH)) };
    }
    // Beta 3.31: with sharp tiles on top the base is only the light, the distances and the picture shown while they
    // come: it is made with half the dots a square from the start (it was made in full and then halved)
    return { g, ox, oy, sx0, sy0, sx1, sy1, nsx, nsy, P: sharp ? Math.max(16, Math.round(P / 2)) : P, sharp };
  }

  // ---------- a fingerprint of what the picture depends on ----------
  function fingerprint(s) {
    let h1 = 0x811c9dc5; let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  const tileKeys = (items, lib) => {
    const tiles = new Set();
    for (const it of items) if (it.tile) { const t = tileInfo(it.tile, lib); tiles.add(`${it.tile.rel || it.tile.path}=${t ? `${t.squares}@${t.off}` : '?'}`); }
    return [...tiles].sort();
  };
  function hash(map, lib) {
    const os = map.os; const bx = boxOf(map);
    const sharp = bx && bx.sharp ? [bx.sharp.P, bx.sharp.ts] : 0;
    return fingerprint(JSON.stringify([os.items, os.doors.map(noLeaf), os.sun, os.shadows || 'short', os.sight, map.grid.size, map.grid.ox, map.grid.oy, tileKeys(os.items, lib), sharp, VERSION]));
  }
  // Beta 3.31: how far a change of each thing can change the picture around it, in squares (it was 6.6 for every
  // floor). Outside a floor: what its edge builds there (any floor's edge may take the place: the widest counts) and
  // the shadows; through mixing: its own soft line, and that of any mixing floor drawn after it that it touches (three of
  // its blurs, and the square; floors drawn before it do not look at it).
  const EDGE_REACH = { walls: 0.5, rock: 3.0, cliff: 3.2, ledge: 0.3, fade: 1.8 };
  const mixes = (it) => (it.kind === 'area' && it.mixW > 0 && !(it.level || 0)) || it.kind === 'paint';
  function reaches(os, g) {
    const S = SHADOWS[os.shadows] || SHADOWS.short; const light = Math.max(0.7, S.tan ? 2.2 / S.tan : 0);
    let edge = 0; for (const it of os.items) if (it.kind === 'area') edge = Math.max(edge, EDGE_REACH[it.edge] ?? 3.2);
    const mixers = []; os.items.forEach((it, n) => { if (mixes(it)) mixers.push({ n, box: itemBox(it), pad: (it.kind === 'paint' ? 1.2 * (it.r / g) : 1.35 * it.mixW) + 0.85 }); });
    const out = new Map();
    os.items.forEach((it, n) => {
      if (it.kind === 'line' || it.kind === 'pillar') { out.set(it, light + 0.4); return; }
      const b = itemBox(it); let mix = 0;
      for (const m of mixers) { const p = m.pad * g; if (m.n >= n && m.pad > mix && m.box[0] - p < b[2] && m.box[2] + p > b[0] && m.box[1] - p < b[3] && m.box[3] + p > b[1]) mix = m.pad; }
      out.set(it, Math.max(edge + light, mix) + 0.3);
    });
    return out;
  }
  const itemKeys = new WeakMap(); // (a thing's own fingerprint, worked out once: tiles ask for it again and again)
  const itemKey = (it) => { let h = itemKeys.get(it); if (!h) { h = fingerprint(JSON.stringify(it)); itemKeys.set(it, h); } return h; };
  // one sharp tile's key: what lies near it (in drawing order), the light, the grid, the dots a square
  const noLeaf = (d) => { const { leaf, ...rest } = d; return rest; }; // (Beta 3.33: the leaf is drawn live)
  function tileKey(map, lib, bx, c, r) {
    const os = map.os; const { g, ox, oy, sharp } = bx;
    if (!bx.reach) { bx.reach = reaches(os, g); bx.boxes = new Map(os.items.map((it) => [it, itemBox(it)])); }
    const x0 = ox + c * sharp.ts * g; const y0 = oy + r * sharp.ts * g; const x1 = x0 + sharp.ts * g; const y1 = y0 + sharp.ts * g;
    const near = (q, m) => q[0] < x1 + m && q[2] > x0 - m && q[1] < y1 + m && q[3] > y0 - m;
    const items = os.items.filter((it) => near(bx.boxes.get(it), bx.reach.get(it) * g));
    if (!items.some((it) => it.kind !== 'cut' && near(bx.boxes.get(it), REACH * g))) return null; // (nothing shows here)
    const doors = os.doors.map(noLeaf).filter((d) => near([Math.min(d.x1, d.x2), Math.min(d.y1, d.y2), Math.max(d.x1, d.x2), Math.max(d.y1, d.y2)], HALO_SOLID * g)); // (a door opens a wall line)
    return fingerprint(JSON.stringify([items.map(itemKey), doors, os.sun, os.shadows || 'short', g, ox, oy, tileKeys(items, lib), bx.P, sharp.P, sharp.ts, c, r, VERSION]));
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
  // (0 void, 1 floor, 2 wall band, 3 rock, 4 cliff, 5 wall line or pillar, 6 stairs, 7 ledge rim, 8 a Fade floor beyond its
// edge) and its material in alpha.
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
  vec2 q = (px + 0.5 - org) / P; // (in squares from the grid's origin: the rock's roughness lies the same on every tile)
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
    float rough = noise(q / 0.35) * 0.18 * P + noise(q / 0.12) * 0.07 * P;
    float R = 2.3 * P + (noise(q / 0.7) - 0.5) * 0.9 * P + (noise(q / 0.2) - 0.5) * 0.25 * P;
    if (dOut > R) { h = base - 2.0 * P; kind = 0.0; }
    else {
      float rise = smoothstep(0.0, 0.3 * P + rough, dOut) * (1.0 - smoothstep(R - 0.35 * P, R, dOut) * 0.6);
      h = base + 1.4 * P * rise + lum(c) * 0.35 * P; kind = 3.0;
    }
  } else if (edge == 4) { // a cliff: rock falling away into darkness
    vec3 c = matCol(mi, px);
    if (dOut > 3.2 * P) { h = base - 3.0 * P; kind = 0.0; }
    else { h = base - dOut * 0.9 + lum(c) * 0.3 * P + noise(q / 0.4) * 0.15 * P; kind = 4.0; }
  } else if (edge == 5 && dOut < 1.6 * P) { // (Beta 3.29) Fade: the floor's tile beyond its edge, flat, fading out
    h = base; kind = 8.0;
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

  // Beta 3.25, the 2D look (the same on the base and on the sharp tiles; q: squares from the grid's origin, P: dots a
  // square, d...: distances in dots)
  const LOOK = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
// floors not stamped: gentle light and dark patches; along walls and rock some grime, and a shadow where they meet
vec3 floorLook(vec3 c, vec2 q, float dIn, int edge, float P){
  float pa = noise(q / 3.7) * 0.6 + noise(q / 1.3 + 17.0) * 0.4;
  c *= 0.9 + 0.2 * pa;
  if (edge == 2 || edge == 3) {
    float gr = (1.0 - smoothstep(0.0, 0.75 * P, dIn)) * (0.55 + 0.45 * noise(q / 0.45 + 5.0));
    c = mix(c, c * vec3(0.70, 0.66, 0.62), gr * 0.5);
    c *= 0.6 + 0.4 * smoothstep(0.0, 0.13 * P, dIn);
  }
  if (edge == 4) c *= 1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.07 * P, dIn)); // (a cliff's top edge catches the light)
  return c;
}
// built walls: their top's edge toward the floor a little lit, a dark line along their outer edge
vec3 wallLook(vec3 c, float dOut, float P){
  c *= 1.0 + 0.3 * (1.0 - smoothstep(0.02 * P, 0.07 * P, dOut));
  c *= 0.42 + 0.58 * smoothstep(0.0, 0.05 * P, 0.45 * P - dOut);
  return c;
}
// Beta 3.28: a cliff that shows: a rough rock face falling away from the floor (bright at its top, in layers along the
// edge, half a square to a square wide, unevenly), then down into the dark over about a square
float cliffR(vec2 q, float P){ return (0.5 + 0.45 * noise(q / 0.8) + 0.2 * noise(q / 0.23)) * P; }
vec3 cliffCol(vec3 c, vec2 q, float dOut, float P, float light, vec3 dark){
  float R = cliffR(q, P); float t = clamp(dOut / R, 0.0, 1.0);
  float layers = 0.84 + 0.16 * sin(dOut / (0.06 * P) + noise(q / 0.45) * 7.0);
  vec3 f = c * layers * mix(1.2, 0.3, pow(t, 0.8)) * (0.6 + 0.4 * min(light, 1.1)) * (0.85 + 0.3 * noise(q / 0.14));
  return mix(f, dark, smoothstep(0.9 * R, R + 0.7 * P, dOut));
}
float cliffAlpha(vec2 q, float dOut, float P){ float R = cliffR(q, P); return 1.0 - smoothstep(R + 0.35 * P, R + 0.9 * P, dOut); }
// Fade (Beta 3.28; 3.29 outward and softer): the floor's tile goes on beyond its edge and fades into the dark over a
// square and a half, on a soft curve, a little unevenly (not at the edge itself: no seam there)
float fadeOut(vec2 q, float dOut, float P){
  float d = dOut + (noise(q / 1.3) - 0.5) * 0.4 * P * smoothstep(0.0, 0.6 * P, dOut);
  float t = clamp(d / (1.5 * P), 0.0, 1.0);
  return exp(-2.8 * t * t) * (1.0 - smoothstep(0.75, 1.0, t)); // (gentle at the edge, a long tail, nothing at 1½)
}
`;
  // light, shadows and darker corners
  const FS_SHADE = `#version 300 es
precision highp float; in vec2 v_uv; layout(location = 0) out vec4 o; layout(location = 1) out vec4 o2;
uniform sampler2D hT, floorT, attrT, haloT, outJ, inJ, mtl0, mtl1, mtl2, mtl3, mtl4;
uniform vec2 size; uniform float P; uniform vec2 org; uniform float matSq[5]; uniform vec3 L; uniform vec3 voidC; uniform float shT; uniform float shK;
vec2 dec(vec4 c){ c = floor(c * 255.0 + 0.5); return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a); }
${LOOK}
float K(vec2 p){ p = clamp(p, vec2(0.0), size - 1.0); return floor(texelFetch(hT, ivec2(p), 0).b * 255.0 + 0.5); }
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
  vec2 si2 = dec(texelFetch(inJ, ip, 0)); float dIn = si2.x > 65000.0 ? 1e5 : length(si2 - px);
  vec2 q = (px + 0.5 - org) / P;
  // what it looks like
  vec3 alb;
  if (kind == 1.0 || kind == 6.0 || kind == 7.0) alb = fl.rgb;
  else if (kind == 8.0) alb = floorLook(texelFetch(haloT, ip, 0).rgb, q, 1e5, 5, P);
  else if (kind == 0.0) alb = voidC;
  else alb = matCol(mi, px);
  if (kind == 7.0) alb = alb * 1.12 + 0.025; // the ledge's rim: the floor, a little lighter
  int fe = int(floor(texelFetch(attrT, ip, 0).r * 255.0 / 40.0 + 0.5)); // (a floor's own edge)
  if (kind == 1.0 || kind == 6.0 || kind == 7.0) alb = floorLook(alb, q, dIn, fe, P);
  if (kind == 2.0) alb = wallLook(alb, dOut, P);
  if (kind == 5.0 && (K(px + vec2(1.5, 0.0)) != 5.0 || K(px - vec2(1.5, 0.0)) != 5.0 || K(px + vec2(0.0, 1.5)) != 5.0 || K(px - vec2(0.0, 1.5)) != 5.0)) alb *= 0.5; // (wall lines and pillars: a dark edge)
  // its slope: from the heights, plus the picture's own bumps on rock and walls
  float e = 1.5;
  float hx = H(px + vec2(e, 0.0)) - H(px - vec2(e, 0.0));
  float hy = H(px + vec2(0.0, e)) - H(px - vec2(0.0, e));
  float bump = (kind >= 2.0 && kind <= 5.0) ? 0.9 : 0.25;
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0 / max(bump, 0.2)));
  float lam = max(dot(n, L), 0.0) / L.z;
  // shadows: does anything between here and the sun rise above the sun's ray? (Beta 3.25: their length of its own,
  // shT; soft further from what throws them, so their edges are not steps)
  float sh = 0.0;
  if (shT > 0.0) {
    vec2 d2 = normalize(L.xy); float reach = 2.2 * P / shT;
    for (int i = 1; i <= 56; i++) {
      float t = float(i) / 56.0; t = t * t * reach + 1.0;
      float above = H(px + d2 * t) - (h + t * shT);
      sh = max(sh, clamp(above / (1.5 + t * 0.3), 0.0, 1.0));
    }
  }
  // darker where it is surrounded by what is higher
  float ao = 0.0; float rr = 0.3 * P;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236; float r = (i % 2 == 0) ? rr : rr * 2.2;
    ao += clamp((H(px + vec2(cos(a), sin(a)) * r) - h) / (0.9 * P), 0.0, 1.0);
  }
  ao = 1.0 - 0.45 * ao / 12.0;
  float light = (0.5 + 0.5 * lam) * (1.0 - shK * sh) * ao;
  o2 = vec4(clamp(light * 0.5, 0.0, 1.0), 0.0, 0.0, 1.0); // (the light alone, halved: the sharp tiles take it)
  vec3 c = alb * light;
  // the cliff fades into darkness; beyond the drawing the picture is see-through (the table's own dark shows there)
  float a = 1.0;
  if (kind == 4.0) { c = cliffCol(alb, q, dOut, P, light, voidC); a = cliffAlpha(q, dOut, P); }
  if (kind == 8.0) a = fadeOut(q, dOut, P) * texelFetch(haloT, ip, 0).a;
  if (kind == 0.0) { c = voidC; a = 0.0; }
  o = vec4(clamp(c, 0.0, 1.0), a);
}`;

  // Beta 3.25: a sharp tile. The floors, wall lines and pillars are painted at its own size (sharp); what lies outside
  // the floors (walls, rock, cliffs) is worked out again here from the base's distances, and the light comes from the
  // base (it changes slowly, so it is smooth when stretched).
  const FS_SHARP = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o;
uniform sampler2D floorH, solidH, haloH, outJ, inJ, attrT, lightT, mtl0, mtl1, mtl2, mtl3, mtl4;
uniform vec2 size; uniform vec2 tileO; uniform vec2 loSize; uniform vec2 orgLo; uniform float s; uniform float P; uniform float matSq[5]; uniform vec3 voidC; uniform vec3 L;
vec2 dec(vec4 c){ c = floor(c * 255.0 + 0.5); return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a); }
${LOOK}
float SA(vec2 p){ return texelFetch(solidH, ivec2(clamp(p, vec2(0.0), size - 1.0)), 0).a; }
vec3 matCol(int i, vec2 q){ vec2 uv = q / matSq[i];
  if (i == 0) return texture(mtl0, uv).rgb; if (i == 1) return texture(mtl1, uv).rgb; if (i == 2) return texture(mtl2, uv).rgb; if (i == 3) return texture(mtl3, uv).rgb; return texture(mtl4, uv).rgb; }
void main(){
  vec2 px = floor(v_uv * size); ivec2 ip = ivec2(px);
  vec2 gh = px + 0.5 + tileO;  // this dot's middle, in sharp dots from the grid's origin
  vec2 q = gh / P;             // in squares
  vec2 lo = orgLo + gh / s;    // in the base's dots
  if (lo.x < 0.0 || lo.y < 0.0 || lo.x >= loSize.x || lo.y >= loSize.y) { o = vec4(voidC, 0.0); return; }
  vec4 fl = texelFetch(floorH, ip, 0); vec4 so = texelFetch(solidH, ip, 0);
  // the nearest floor and the nearest dot outside (in sharp dots), from the seeds of the base's four nearest dots
  float dOut = 1e5; vec2 sOut = vec2(-1.0); float dIn = 1e5;
  ivec2 b0 = ivec2(floor(lo - 0.5)); ivec2 lim = ivec2(loSize) - 1;
  for (int j = 0; j < 4; j++) {
    ivec2 n = clamp(b0 + ivec2(j & 1, j >> 1), ivec2(0), lim);
    vec2 a = dec(texelFetch(outJ, n, 0)); if (a.x < 65000.0) { float d = length(a + 0.5 - lo) * s; if (d < dOut) { dOut = d; sOut = a; } }
    vec2 b = dec(texelFetch(inJ, n, 0)); if (b.x < 65000.0) dIn = min(dIn, length(b + 0.5 - lo) * s);
  }
  vec4 here = texelFetch(attrT, clamp(ivec2(floor(lo)), ivec2(0), lim), 0);
  vec4 na = (fl.a >= 0.5 && here.a >= 0.5) || sOut.x < 0.0 ? here : texelFetch(attrT, ivec2(sOut), 0);
  int edge = int(floor(na.r * 255.0 / 40.0 + 0.5));
  int mi = clamp(int(floor(na.b * 255.0 / 40.0 + 0.5)) - 1, 0, 4);
  // outside the floors: what the edge makes of it (as in the heights)
  vec3 cOut = voidC; float aOut = 0.0; float rel = 1.0;
  if (edge == 2) { if (dOut < 0.45 * P) { cOut = wallLook(matCol(mi, q), dOut, P); aOut = 1.0; } }
  else if (edge == 3) {
    float R = 2.3 * P + (noise(q / 0.7) - 0.5) * 0.9 * P + (noise(q / 0.2) - 0.5) * 0.25 * P;
    if (dOut <= R) {
      cOut = matCol(mi, q); aOut = 1.0;
      // (Beta 3.31) the rock's fine relief, from its picture's own light and dark as in the heights: the base, at half
      // size now, carries only the broad light
      float e2 = 0.012;
      float sx = 0.35 * (dot(matCol(mi, q + vec2(e2, 0.0)) - matCol(mi, q - vec2(e2, 0.0)), vec3(0.299, 0.587, 0.114))) / (2.0 * e2);
      float sy = 0.35 * (dot(matCol(mi, q + vec2(0.0, e2)) - matCol(mi, q - vec2(0.0, e2)), vec3(0.299, 0.587, 0.114))) / (2.0 * e2);
      vec3 n = normalize(vec3(-sx, -sy, 1.0 / 0.9));
      rel = mix(1.0, 0.5 + 0.5 * max(dot(n, L), 0.0) / L.z, 0.7);
    }
  } else if (edge == 4) {
    if (dOut <= 3.2 * P) { cOut = matCol(mi, q); aOut = cliffAlpha(q, dOut, P); }
  } else if (edge == 5) { // (Beta 3.29) Fade: its tile beyond the edge, fading out
    if (dOut < 1.6 * P) { vec4 hc = texelFetch(haloH, ip, 0); aOut = fadeOut(q, dOut, P) * hc.a; cOut = floorLook(hc.rgb, q, 1e5, 5, P); }
  }
  // the floor (a ledge's rim a little lighter)
  vec3 cIn = fl.rgb;
  if (edge == 1 && dIn < 0.26 * P) cIn = cIn * 1.12 + 0.025;
  cIn = floorLook(cIn, q, dIn, edge, P);
  // the light, a little smoothed (its steps are the base's dots)
  vec2 lu = lo / loSize; vec2 e = 0.7 / loSize;
  float li = 2.0 * (2.0 * texture(lightT, lu).r + texture(lightT, lu + e).r + texture(lightT, lu - e).r + texture(lightT, lu + vec2(e.x, -e.y)).r + texture(lightT, lu + vec2(-e.x, e.y)).r) / 6.0;
  cOut = edge == 4 ? cliffCol(cOut, q, dOut, P, li, voidC) : cOut * li * rel;
  vec3 col = mix(cOut, cIn * li, fl.a); float a = mix(aOut, 1.0, fl.a);
  // wall lines and pillars: a dark edge, and a shadow at their foot
  int ms = clamp(int(floor(so.b * 255.0 / 40.0 + 0.5)) - 1, 0, 4);
  float r1 = max(1.5, 0.025 * P); float r2 = max(2.0, 0.08 * P);
  float nIn = min(min(SA(px + vec2(r1, 0.0)), SA(px - vec2(r1, 0.0))), min(SA(px + vec2(0.0, r1)), SA(px - vec2(0.0, r1))));
  float nOut = max(max(SA(px + vec2(r2, 0.0)), SA(px - vec2(r2, 0.0))), max(SA(px + vec2(0.0, r2)), SA(px - vec2(0.0, r2))));
  if (so.a < 0.5 && nOut > 0.5) col *= 0.72;
  if (so.a > 0.0) { vec3 sc = matCol(ms, q) * li; if (nIn < 0.5) sc *= 0.5; col = mix(col, sc, so.a); a = max(a, so.a); }
  o = vec4(clamp(col, 0.0, 1.0), a);
}`;

  // ---------- Beta 3.25: ground (water, lava, acid, swamp) ----------
  // Its surface is made here (a seamless painting four squares across, at the picture's dots a square); a dark rim
  // inside its edge makes it lie lower than the floor. The effect of the same kind moves on top (mapstate: syncGround).
  const GROUND = {
    water: { a: '#123b46', b: '#2c7482', hi: '#8fd6e0', alpha: 0.82 },
    lava: { a: '#2a0d06', b: '#4d1a0a', hi: '#ff7a22', hot: '#ffd36b', alpha: 1 },
    acid: { a: '#2c560d', b: '#6db02a', hi: '#c8f27a', alpha: 0.95 },
    swamp: { a: '#22281a', b: '#4a5428', hi: '#6f8a34', alpha: 0.95 },
  };
  const surfaces = new Map();
  function surface(kind, P) {
    const N = Math.max(64, Math.min(1024, Math.round(4 * P))); const key = `${kind}@${N}`;
    if (surfaces.has(key)) return surfaces.get(key);
    const L = GROUND[kind] || GROUND.water;
    // seamless value noise: random values on a grid that wraps, smoothly between
    const grid = (n, seed) => { const v = new Float32Array(n * n); let x = seed * 9301 + 49297; for (let i = 0; i < v.length; i++) { x = (x * 9301 + 49297) % 233280; v[i] = x / 233280; } return v; };
    const octs = [[4, grid(4, 1), 0.5], [8, grid(8, 2), 0.3], [16, grid(16, 3), 0.2]];
    const at = (u, v) => { let s = 0; for (const [n, g, w] of octs) { const x = u * n; const y = v * n; const i = Math.floor(x); const j = Math.floor(y); const fx = x - i; const fy = y - j; const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy); const G = (a, b) => g[((b % n) + n) % n * n + ((a % n) + n) % n]; s += w * ((G(i, j) * (1 - sx) + G(i + 1, j) * sx) * (1 - sy) + (G(i, j + 1) * (1 - sx) + G(i + 1, j + 1) * sx) * sy); } return s; };
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const A = hex(L.a); const B = hex(L.b); const HI = hex(L.hi); const HOT = L.hot ? hex(L.hot) : HI;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'); const img = g.createImageData(N, N); const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = at(x / N, y / N); const n2 = at(x / N + 0.37, y / N + 0.61);
        let col = A.map((v, i) => v + (B[i] - v) * Math.min(1, Math.max(0, (n - 0.25) * 1.8)));
        if (kind === 'lava') { const r = 1 - Math.abs(2 * n2 - 1); const t = Math.min(1, Math.max(0, (r - 0.8) / 0.17)); col = col.map((v, i) => v + ((t > 0.6 ? HOT : HI)[i] - v) * t); }
        else if (kind === 'water') { const t = Math.max(0, (n2 - 0.72) / 0.28) * 0.35; col = col.map((v, i) => v + (HI[i] - v) * t); }
        else { const t = Math.max(0, (n2 - 0.62) / 0.38) * 0.6; col = col.map((v, i) => v + (HI[i] - v) * t); }
        const o = (y * N + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    surfaces.set(key, c);
    if (surfaces.size > 12) surfaces.delete(surfaces.keys().next().value);
    return c;
  }
  function paintGround(fg, it, T, k, P, org) {
    const L = GROUND[it.preset] || GROUND.water;
    // worked on in a small painting of its own (its box, clipped to the picture)
    const q = itemBox(it); const a = T(q[0], q[1]); const b = T(q[2], q[3]); const pad = Math.ceil(P * 0.4);
    const x0 = Math.max(-pad, Math.floor(Math.min(a[0], b[0])) - pad); const y0 = Math.max(-pad, Math.floor(Math.min(a[1], b[1])) - pad);
    const x1 = Math.min(fg.canvas.width + pad, Math.ceil(Math.max(a[0], b[0])) + pad); const y1 = Math.min(fg.canvas.height + pad, Math.ceil(Math.max(a[1], b[1])) + pad);
    const w = x1 - x0; const h = y1 - y0; if (w < 1 || h < 1) return;
    const T2 = (x, y) => { const [u, v] = T(x, y); return [u - x0, v - y0]; };
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const Lc = mk(); const lg = Lc.getContext('2d'); const Mc = mk(); const mg = Mc.getContext('2d');
    const pat = lg.createPattern(surface(it.preset, P), 'repeat');
    const S = 4 * P / surface(it.preset, P).width; // (the painting spans four squares)
    pat.setTransform(new DOMMatrix().translate(org[0] - x0, org[1] - y0).scale(S));
    paintArea(lg, it, T2, k, pat, false);
    paintArea(mg, it, T2, k, '#fff', false);
    // darker toward its edge, inside: it lies lower than the floor
    const E = mk(); const eg = E.getContext('2d');
    eg.fillStyle = 'rgba(0,0,0,0.62)'; eg.fillRect(0, 0, w, h);
    eg.globalCompositeOperation = 'destination-out'; eg.filter = `blur(${Math.max(1, P * 0.16).toFixed(1)}px)`; eg.drawImage(Mc, 0, 0); eg.filter = 'none';
    lg.globalCompositeOperation = 'source-atop'; lg.drawImage(E, 0, 0);
    fg.save(); fg.globalAlpha = L.alpha; fg.drawImage(Lc, x0, y0); fg.restore();
    // a wet rim just outside
    fg.save(); fg.globalAlpha = 0.5; fg.globalCompositeOperation = 'source-atop';
    const R = mk(); const rg = R.getContext('2d'); rg.filter = `blur(${Math.max(1, P * 0.04).toFixed(1)}px)`; rg.drawImage(Mc, 0, 0); rg.filter = 'none';
    rg.globalCompositeOperation = 'source-in'; rg.fillStyle = 'rgba(0,0,0,0.5)'; rg.fillRect(0, 0, w, h);
    rg.globalCompositeOperation = 'destination-out'; rg.drawImage(Mc, 0, 0);
    fg.drawImage(R, x0, y0); fg.restore();
    for (const c of [Lc, Mc, E, R]) c.width = c.height = 0;
  }

  // ---------- Beta 3.27: floors that mix into the floor already there, by opacity alone ----------
  // Glinn's three rules, as one opacity mask for the new floor: (1) a soft line, 0 to 100 % across the edge as drawn,
  // over w dots (a paint stroke: its rim); (2) the line made uneven: a slow wave moves it in and out (mixU); (3) Tiled
  // (mixT; Beta 3.30, measured from his goal picture): near the line every square keeps the old floor as a soft patch
  // of its own, and the new floor runs along the joints between them. The mask is worked out at 16 dots a square and
  // stretched. Where there was no floor, a new floor is laid as drawn (a paint stroke adds none). In squares from the
  // grid's origin: the base and the sharp tiles agree.
  const h2 = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, y) => {
    const i = Math.floor(x); const j = Math.floor(y); let fx = x - i; let fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h2(i, j); const b = h2(i + 1, j); const c = h2(i, j + 1); const d = h2(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // Beta 3.31: a floor's mask is worked out once, in the grid's own dots (DQ a square, whatever the picture's size), and
  // kept: the base, every sharp tile and later pictures only stretch it. It is found again by the floor's shape and its
  // mixing, and the shapes of the floors drawn before it that it touches.
  const MASKS = new Map(); let maskPx = 0; const MASK_MAX = 24e6; // (dots kept in all; the oldest go first)
  const shapeKeys = new WeakMap(); const maskNow = new WeakMap();
  const shapeKey = (o) => { let h = shapeKeys.get(o); if (!h) { h = fingerprint(JSON.stringify([o.kind, o.shape, o.pts, o.r, o.mixW, o.mixU, o.mixT])); shapeKeys.set(o, h); } return h; };
  function mixArea(fg, it, T, k, P, org, pat, w, paintOnly, before) {
    const tm0 = performance.now();
    try {
      const W = fg.canvas.width; const H = fg.canvas.height;
      // (within one picture a floor is asked for again by every tile: its mask is at hand)
      let m0 = maskNow.get(it);
      if (!m0 || m0.items !== before.items || m0.n !== before.n) { m0 = { items: before.items, n: before.n, M: maskOf(it, T, k, P, org, w, paintOnly, before) }; maskNow.set(it, m0); }
      const M = m0.M;
      const ds = P / M.dq; // (picture dots a mask dot)
      // what is worked on: the mask's own box (the floor and the room its soft line takes) within the picture
      const x0 = Math.max(0, Math.floor(org[0] + M.tx0 * ds)); const y0 = Math.max(0, Math.floor(org[1] + M.ty0 * ds));
      const x1 = Math.min(W, Math.ceil(org[0] + M.tx1 * ds)); const y1 = Math.min(H, Math.ceil(org[1] + M.ty1 * ds));
      if (x1 > x0 && y1 > y0) {
        const mk = (cw, ch) => { const c = document.createElement('canvas'); c.width = Math.max(1, cw); c.height = Math.max(1, ch); return c; };
        const ww = x1 - x0; const hh = y1 - y0;
        const A = mk(ww, hh); const ag = A.getContext('2d');
        ag.imageSmoothingEnabled = true; ag.imageSmoothingQuality = 'high';
        // (only the part of the mask that lies here, and a dot more around it)
        const u0 = Math.max(0, Math.floor((x0 - org[0]) / ds - M.lx) - 2); const v0 = Math.max(0, Math.floor((y0 - org[1]) / ds - M.ly) - 2);
        const u1 = Math.min(M.nw, Math.ceil((x1 - org[0]) / ds - M.lx) + 2); const v1 = Math.min(M.nh, Math.ceil((y1 - org[1]) / ds - M.ly) + 2);
        if (u1 > u0 && v1 > v0) ag.drawImage(M.cv, u0, v0, u1 - u0, v1 - v0, org[0] + (M.lx + u0) * ds - x0, org[1] + (M.ly + v0) * ds - y0, (u1 - u0) * ds, (v1 - v0) * ds);
        // the new floor through the mask, over the floor that is there
        const nf = mk(ww, hh); const ng = nf.getContext('2d'); ng.translate(-x0, -y0); ng.fillStyle = pat; ng.fillRect(x0, y0, ww, hh); ng.setTransform(1, 0, 0, 1, 0, 0);
        ng.globalCompositeOperation = 'destination-in'; ng.drawImage(A, 0, 0);
        fg.save(); fg.globalCompositeOperation = 'source-atop'; fg.drawImage(nf, x0, y0); fg.restore();
        A.width = A.height = 0; nf.width = nf.height = 0;
      }
      // where there was no floor: the new floor as drawn
      if (!paintOnly) { fg.save(); fg.globalCompositeOperation = 'destination-over'; paintArea(fg, it, T, k, pat, false); fg.restore(); }
    } finally { prof.mix += performance.now() - tm0; prof.mixN++; }
  }
  function maskOf(it, T, k, P, org, w, paintOnly, before) {
    // the grid, from the picture's own measures: g inches a square, its origin in map inches
    const g = P / k; const t00 = T(0, 0); const ox = (org[0] - t00[0]) / k; const oy = (org[1] - t00[1]) / k;
    const q = itemBox(it);
    const sq0 = [(q[0] - ox) / g, (q[1] - oy) / g, (q[2] - ox) / g, (q[3] - oy) / g]; // (its box in squares)
    const wS = w / P; // (the mix width in squares)
    const U = Math.min(1, Math.max(0, it.mixU ?? 0.5)); const Tl = Math.min(1, Math.max(0, it.mixT ?? 0.5));
    // 16 dots a square (the patches' soft edges and the joints need them); 8 for a floor too big for that
    const padS = (paintOnly ? wS * 0.4 : wS * 0.45) * 3 + U * 0.8 + 0.15;
    let DQ = 16; if ((sq0[2] - sq0[0] + 2 * padS + 2) * (sq0[3] - sq0[1] + 2 * padS + 2) * DQ * DQ > 9e6) DQ = 8;
    const sig = (paintOnly ? wS * 0.4 : wS * 0.45) * DQ; // (the soft line: about w across, from one floor to the other)
    const pad = Math.ceil(padS * DQ); // (room for the soft line and its wave)
    const bx0 = Math.floor(sq0[0] * DQ) - pad; const by0 = Math.floor(sq0[1] * DQ) - pad;
    const bx1 = Math.ceil(sq0[2] * DQ) + pad; const by1 = Math.ceil(sq0[3] * DQ) + pad;
    const pd = Math.ceil(0.6 * DQ) + 2; // (and room around it for the squares' middles)
    const lx = bx0 - pd; const ly = by0 - pd; const nw = bx1 + pd - lx; const nh = by1 + pd - ly;
    // the floors drawn before it that lie in this box (their shapes are part of what the mask is)
    const prior = [];
    const X0 = ox + (lx / DQ) * g; const Y0 = oy + (ly / DQ) * g; const X1 = X0 + (nw / DQ) * g; const Y1 = Y0 + (nh / DQ) * g;
    for (let n = 0; n < before.n; n++) {
      const o = before.items[n];
      if (o.kind !== 'area' && o.kind !== 'ground' && o.kind !== 'cut') continue;
      const b = itemBox(o); if (b[0] < X1 && b[2] > X0 && b[1] < Y1 && b[3] > Y0) prior.push(o);
    }
    const key = fingerprint(JSON.stringify([shapeKey(it), paintOnly ? 1 : 0, round4(w / P), prior.map(shapeKey), round4(g), round4(ox), round4(oy), DQ]));
    const had = MASKS.get(key);
    if (had) { MASKS.delete(key); MASKS.set(key, had); prof.maskKept++; return had; }
    prof.maskMade++;
    const mk = (cw, ch) => { const c = document.createElement('canvas'); c.width = Math.max(1, cw); c.height = Math.max(1, ch); return c; };
    const kx = lx; const ky = ly; // (mask dot u is the (kx + u)th DQth of a square from the grid's origin)
    // (1) the soft line: of the floor around a place (the floor there and the new one), how much is new. So the line runs
    // along the edge between the two floors, and where both end at the dark or a wall nothing fades
    const kq = DQ / g; const Tl0 = (x, y) => [(x - ox) * kq - lx, (y - oy) * kq - ly];
    const Hc = mk(nw, nh); paintArea(Hc.getContext('2d', CPU), paintOnly ? { ...it, r: it.r * 0.7 } : it, Tl0, kq, '#fff', false); // (a brush: full in its middle)
    // (the floor drawn before it, from the drawing itself: the same on every tile, also beyond its edge)
    const Fc = mk(nw, nh); const fgc = Fc.getContext('2d', CPU);
    for (const o of prior) { if (o.kind === 'cut') paintArea(fgc, o, Tl0, kq, null, true); else paintArea(fgc, o, Tl0, kq, '#fff', false); }
    fgc.drawImage(Hc, 0, 0);
    const blurred = (src) => { const c = mk(nw, nh); const g2 = c.getContext('2d', CPU); g2.filter = `blur(${Math.max(0.3, sig).toFixed(3)}px)`; g2.drawImage(src, 0, 0); g2.filter = 'none'; return c; };
    const Hb = blurred(Hc); const Fb = blurred(Fc);
    const fd = Fb.getContext('2d', CPU).getImageData(0, 0, nw, nh).data;
    const bg = Hb.getContext('2d', CPU); const Bc = Hb;
    const img = bg.getImageData(0, 0, nw, nh); const d = img.data;
    const N = nw * nh; const S0 = new Float32Array(N); // (1) of the floor around each place, how much is new
    for (let i = 0; i < N; i++) { const f = fd[i * 4 + 3] / 255; S0[i] = f > 0.02 ? Math.min(1, d[i * 4 + 3] / 255 / f) : 0; }
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const ss = (a0, b0, x) => { const t = clamp((x - a0) / (b0 - a0), 0, 1); return t * t * (3 - 2 * t); };
    const waveAt = (gx, gy) => (vnoise(gx / 2.4 + 3.1, gy / 2.4 + 7.7) - 0.5) * 2 + (vnoise(gx / 0.9 + 1.3, gy / 0.9 + 4.2) - 0.5) * 0.6;
    const T2 = Math.min(1, 2 * Tl);
    // (3) Beta 3.30, measured from Glinn's goal picture. Near the line every square keeps the old floor as a soft patch
    // of its own: how far it reaches toward the new floor (most a little, some are eaten into: the new floor's whole
    // squares; Uneven moves them with the wave) and how opaque it is where the new floor already rules. The new floor
    // runs along the joints between the patches, here strongly, there not at all.
    const c0 = Math.floor(kx / DQ) - 1; const r0 = Math.floor(ky / DQ) - 1;
    const cols = Math.floor((kx + nw - 1) / DQ) + 1 - c0 + 1; const rows = Math.floor((ky + nh - 1) / DQ) + 1 - r0 + 1;
    const SA = new Float32Array(cols * rows).fill(1); const SS = new Float32Array(cols * rows);
    if (T2 > 0) {
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const sx = c0 + cx; const sy = r0 + cy;
        const u = clamp(sx * DQ + DQ / 2 - kx, 0, nw - 1); const v = clamp(sy * DQ + DQ / 2 - ky, 0, nh - 1);
        const co = 1 - S0[v * nw + u]; // (the old floor's share at the square's middle)
        const r1 = h2(sx + 0.37, sy + 0.71); const r2 = h2(sx + 0.91, sy + 0.17); const r3 = h2(sx + 0.13, sy + 0.29);
        const sh = (r3 < 0.1 + 0.5 * Tl ? 0.3 + 0.35 * r1 : (r1 - 0.5) * 0.1) - clamp(waveAt(sx + 0.5, sy + 0.5) * U * 0.25, -0.12, 0.12);
        SS[cy * cols + cx] = clamp(sh, -0.08, 0.62); // (within these the floors stay whole away from the line)
        SA[cy * cols + cx] = 1 - (1 - ss(0.35, 0.6, co)) * clamp(1.4 * Tl * r2, 0, 1);
      }
    }
    const JS = 0.09; const EB = 0.186; // (a joint's half width in squares; how much a square's edge dot takes from its neighbour)
    for (let v = 0; v < nh; v++) {
      const qy = ky + v; const gy = (qy + 0.5) / DQ; const sy = Math.floor(qy / DQ); const my = qy - sy * DQ; const cy = sy - r0;
      const ny = my === 0 ? -1 : my === DQ - 1 ? 1 : 0; const ry = Math.round(gy); const dyj = Math.abs(gy - ry);
      for (let u = 0; u < nw; u++) {
        const i = v * nw + u; const s0 = S0[i];
        let al;
        if (s0 <= 0) al = 0; else if (s0 >= 0.996) al = 1; // (away from the line: the floors as they are)
        else {
          const qx = kx + u; const gx = (qx + 0.5) / DQ; const sx = Math.floor(qx / DQ); const mx = qx - sx * DQ; const cx = sx - c0;
          // (2) the line, uneven: a slow wave (two scales) moves it in and out, within the soft band
          const e0 = clamp(s0 + waveAt(gx, gy) * U * 0.42 * Math.min(1, 10 * s0 * (1 - s0)), 0, 1);
          al = clamp((e0 - 0.5) * 1.25 + 0.5, 0, 1);
          if (T2 > 0) {
            // this square's patch (a little of its neighbour's at its very edge: soft across the joints)
            const nx = mx === 0 ? -1 : mx === DQ - 1 ? 1 : 0; const j0 = cy * cols + cx;
            let pa = SA[j0]; let ps = SS[j0];
            if (nx) { pa += (SA[j0 + nx] - pa) * EB; ps += (SS[j0 + nx] - ps) * EB; }
            if (ny) {
              let qa = SA[j0 + ny * cols]; let qs = SS[j0 + ny * cols];
              if (nx) { qa += (SA[j0 + ny * cols + nx] - qa) * EB; qs += (SS[j0 + ny * cols + nx] - qs) * EB; }
              pa += (qa - pa) * EB; ps += (qs - ps) * EB;
            }
            const o = 1 - s0;
            let old = pa * ss(0.1 + ps, 0.3 + ps, o + (vnoise(gx / 0.3 + 5.1, gy / 0.3 + 2.3) - 0.5) * 0.05);
            if (old > 0.003) { // the new floor along the joints
              const rx = Math.round(gx); const dxj = Math.abs(gx - rx); let jl = 0;
              if (dxj < 0.3) { const sv = ss(0.15, 0.55, vnoise(rx * 7.3 + 1.7, gy / 1.1 + rx * 3.1)); if (sv > 0) jl = sv * Math.exp(-((dxj / (JS * (0.8 + 0.6 * vnoise(rx * 3.3, gy / 1.7)))) ** 2)); }
              if (dyj < 0.3) { const sv = ss(0.15, 0.55, vnoise(gx / 1.1 + ry * 3.1, ry * 7.3 + 1.7)); if (sv > 0) jl = Math.max(jl, sv * Math.exp(-((dyj / (JS * (0.8 + 0.6 * vnoise(gx / 1.7, ry * 3.3)))) ** 2))); }
              old *= 1 - jl * Math.min(1, 12 * o * (1 - o)) * (0.6 + 0.4 * Tl);
            }
            al = (1 - T2) * al + T2 * (1 - old);
          }
        }
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(al * 255);
      }
    }
    bg.putImageData(img, 0, 0);
    // a touch softer; kept (the oldest masks make room)
    const cv = mk(nw, nh); { const sg = cv.getContext('2d', CPU); sg.filter = 'blur(0.4px)'; sg.drawImage(Bc, 0, 0); sg.filter = 'none'; }
    for (const c of [Hc, Fc, Hb, Fb]) c.width = c.height = 0;
    const M = { cv, lx, ly, nw, nh, dq: DQ, tx0: bx0, ty0: by0, tx1: bx1, ty1: by1, px: nw * nh };
    MASKS.set(key, M); maskPx += M.px;
    for (const [k0, m0] of MASKS) { if (maskPx <= MASK_MAX || k0 === key) break; MASKS.delete(k0); maskPx -= m0.px; } // (a picture being made may still hold one: it is let go when nothing does)
    return M;
  }
  const round4 = (v) => Math.round(v * 1e4) / 1e4;

  // ---------- making the picture ----------
  // The drawing painted flat: floors with their tiles (fg), what each area is (ag: edge, level, material), wall lines and
  // pillars (sg), stairs (tg). T: map inches → dots, k: dots an inch, P: dots a square, org: the grid's origin in dots.
  // ag and tg may be left out (the sharp tiles need only the floors and the solids).
  function paint(os, lib, T, k, P, org, loaded, cx, pats) {
    const { fg, ag, sg, tg, hg } = cx; // (hg: the Fade floors' tiles beyond their edge, Beta 3.29)
    const patOf = (t) => {
      if (!t || !loaded.has(t.url)) return '#5a5650';
      const off = t.off || [0, 0];
      const key = `${t.url}@${t.squares || 4}@${off}@${P}`;
      if (!pats.has(key)) pats.set(key, { cv: scaled(loaded.get(t.url), (t.squares || 4) * P), off });
      const e = pats.get(key);
      const pat = fg.createPattern(e.cv, 'repeat');
      pat.setTransform(new DOMMatrix().translate(org[0] - e.off[0] * P, org[1] - e.off[1] * P)); // (its joints on the grid)
      return pat;
    };
    const matCode = (id) => { const i = MATERIALS.findIndex((m) => m.id === id); return (i < 0 ? 1 : i + 1) * 40; };
    for (let n = 0; n < os.items.length; n++) {
      const it = os.items[n]; const before = { items: os.items, n }; // (what was drawn before it: for mixing)
      if (it.kind === 'area') {
        const t = tileInfo(it.tile, lib) || tileInfo({ rel: relOf(FLOORS[0]) });
        if (it.mixW > 0 && !(it.level || 0)) mixArea(fg, it, T, k, P, org, patOf(t), it.mixW * P, false, before); // (Beta 3.27)
        else paintArea(fg, it, T, k, patOf(t), false);
        if (hg && it.edge === 'fade') paintHalo(hg, it, T, k, patOf(t), FADE_R * P);
        if (ag) paintArea(ag, it, T, k, `rgb(${EDGE_CODE[it.edge] * 40},${128 + it.level * 30},${matCode(it.mat || DEFAULT_MAT[it.edge])})`, false);
        if (tg) paintArea(tg, it, T, k, '#000', true); // (a floor drawn over stairs takes them away)
      } else if (it.kind === 'cut') {
        for (const c of [fg, ag, tg]) if (c) paintArea(c, it, T, k, null, true);
        sg.save(); sg.globalCompositeOperation = 'destination-out'; if (it.shape === 'path' || it.shape === 'brush') stroke(sg, it, T, k, '#000'); else sg.fill(shapePath(it, T)); sg.restore();
      } else if (it.kind === 'line' || it.kind === 'pillar') {
        paintSolid(sg, it, T, k, `rgb(255,${Math.round((it.h || 1) * 100)},${matCode(it.mat)})`, false);
      } else if (it.kind === 'paint') { // (Beta 3.26) a floor painted into the floors under the brush
        const t = tileInfo(it.tile, lib) || tileInfo({ rel: relOf(FLOORS[0]) });
        mixArea(fg, it, T, k, P, org, patOf(t), it.r * k, true, before);
      } else if (it.kind === 'ground') { // (Beta 3.25) a pool of water, lava, acid or swamp; magical darkness is the effect alone
        if (it.preset !== 'darkness') paintGround(fg, it, T, k, P, org);
        if (ag) { ag.save(); ag.globalCompositeOperation = 'destination-over'; paintArea(ag, it, T, k, `rgb(${EDGE_CODE.ledge * 40},128,${matCode('stone_wall')})`, false); ag.restore(); } // (on nothing: a pool in the dark)
      } else if (it.kind === 'stairs') {
        const [x, y, w, h] = stairsBox(it, T);
        const len = it.dir % 2 === 0 ? w : h; const steps = Math.max(2, Math.round((len / P) * 2)); // (Beta 3.29: two steps a square)
        if (tg) {
          const gr = it.dir === 0 ? tg.createLinearGradient(x, 0, x + w, 0) : it.dir === 2 ? tg.createLinearGradient(x + w, 0, x, 0) : it.dir === 1 ? tg.createLinearGradient(0, y, 0, y + h) : tg.createLinearGradient(0, y + h, 0, y);
          gr.addColorStop(0, `rgb(0,255,${steps})`); gr.addColorStop(1, `rgb(255,255,${steps})`);
          tg.fillStyle = gr; tg.fillRect(x, y, w, h);
        }
        // the steps themselves (Beta 3.29: of the floor picked, stairs from before of their material): from dark at the
        // bottom to bright at the top, each step's front (the riser, toward the bottom of the stairs) a dark band with a
        // soft shadow, its edge (the nosing) a light line
        const look = it.tile ? patOf(tileInfo(it.tile, lib) || tileInfo({ rel: relOf(FLOORS[0]) })) : patOf(matInfo(it.mat));
        fg.save();
        const along = it.dir % 2 === 0 ? w : h; const depth = along / steps;
        const rect = (a0, a1) => { // a band from a0 to a1 along the climb (0 = bottom of the stairs)
          const lo = Math.min(a0, a1); const len2 = Math.abs(a1 - a0);
          if (it.dir === 0) return [x + lo, y, len2, h];
          if (it.dir === 2) return [x + w - lo - len2, y, len2, h];
          if (it.dir === 1) return [x, y + lo, w, len2];
          return [x, y + h - lo - len2, w, len2];
        };
        const at = (a) => (it.dir === 0 ? [x + a, 0] : it.dir === 2 ? [x + w - a, 0] : it.dir === 1 ? [0, y + a] : [0, y + h - a]); // (a point on the climb)
        const grad = (a0, a1, stops) => { const g0 = at(a0); const g1 = at(a1); const gr = fg.createLinearGradient(g0[0], g0[1], g1[0], g1[1]); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; };
        for (let i = 0; i < steps; i++) {
          const a0 = i * depth;
          fg.filter = `brightness(${(0.55 + (0.6 * i) / Math.max(1, steps - 1)).toFixed(3)})`; // (dark down, bright up)
          fg.fillStyle = look; fg.fillRect(...rect(a0, a0 + depth));
          fg.filter = 'none';
          if (i > 0) { // (the lowest step meets the floor)
            // the step above throws a soft shadow onto this one's back, and its edge catches the light
            fg.fillStyle = grad(a0 - depth * 0.45, a0, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.62)']]); fg.fillRect(...rect(a0 - depth * 0.45, a0));
            fg.fillStyle = grad(a0, a0 + depth * 0.16, [[0, 'rgba(255,244,228,0.34)'], [1, 'rgba(255,244,228,0)']]); fg.fillRect(...rect(a0, a0 + depth * 0.16));
          }
        }
        // its sides a little dark (the stairs stand apart from the floor)
        const side = Math.max(1, P * 0.05);
        fg.fillStyle = 'rgba(0,0,0,0.35)';
        if (it.dir % 2 === 0) { fg.fillRect(x, y, w, side); fg.fillRect(x, y + h - side, w, side); } else { fg.fillRect(x, y, side, h); fg.fillRect(x + w - side, y, side, h); }
        fg.restore();
        // stairs count as floor, at the level of the floor they stand on
        if (ag) {
          const W = ag.canvas.width; const Hh = ag.canvas.height;
          const id = ag.getImageData(Math.max(0, Math.min(W - 1, Math.round(x + w / 2))), Math.max(0, Math.min(Hh - 1, Math.round(y + h / 2))), 1, 1).data;
          ag.fillStyle = id[3] > 128 ? `rgb(${id[0]},${id[1]},${id[2]})` : `rgb(80,128,${matCode('stone_wall')})`; ag.fillRect(x, y, w, h);
        }
      }
    }
    // doors: an opening in wall lines (the door itself is drawn on top at the end). Beta 3.34: not a window (it sits
    // in a niche of the wall) nor a secret door (the wall shows whole)
    for (const d of os.doors) {
      if (d.kind === 'window' || d.door === 2) continue;
      const [x1, y1] = T(d.x1, d.y1); const [x2, y2] = T(d.x2, d.y2);
      sg.save(); sg.globalCompositeOperation = 'destination-out'; sg.lineWidth = P * 1.2; sg.lineCap = 'butt'; sg.beginPath(); sg.moveTo(x1, y1); sg.lineTo(x2, y2); sg.stroke(); sg.restore();
    }
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const CPU = { willReadFrequently: true }; // (read back: kept in memory)
  // (Beta 3.31: a picture without anything see-through is saved as JPEG, which is made several times faster)
  const encode = (c, jpg) => new Promise((res) => c.toBlob(res, jpg ? 'image/jpeg' : 'image/webp', jpg ? 0.92 : 0.88));

  // map: the map (os, grid). lib: library items (for tiles of the library). prev: the sharp tiles the picture has now
  // ({ P, ts, tiles: [{ c, r, h }] }): those whose key is the same are kept. Resolves to { empty } or
  // { blob, x, y, scale, nw, nh, walls, sharp: { P, ts, tiles: [{ c, r, h, blob? }] } | null }.
  const stats = { last: null }; // (how long the last picture took, and its tiles: for the self-test and the log)
  const prof = { mix: 0, mixN: 0, maskMade: 0, maskKept: 0, tPaint: 0, tGl: 0, tEnc: 0 }; // (Beta 3.31: where the time goes, in ms)
  async function bake(map, lib, prev, onProgress) {
    const os = map.os;
    const bx = boxOf(map);
    if (!bx) return { empty: true, walls: [] };
    // (Beta 3.32) how far along it is, 0 to 1, for the GM's progress pill: painting, light and shade, the sharp tiles
    const ph = bx.sharp ? [0.08, 0.3, 0.97] : [0.2, 0.95, 0.95];
    const say = (k) => { if (onProgress) try { onProgress(Math.min(1, Math.max(0, k))); } catch { /* */ } };
    say(0.01);
    const t0 = performance.now(); Object.assign(prof, { mix: 0, mixN: 0, maskMade: 0, maskKept: 0, tPaint: 0, tGl: 0, tEnc: 0 });
    const { g, ox, oy, sx0, sy0, sx1, sy1, nsx, nsy, P } = bx;
    const W = nsx * P; const Hh = nsy * P;
    const X0 = ox + sx0 * g; const Y0 = oy + sy0 * g; const k = P / g;
    const T = (x, y) => [(x - X0) * k, (y - Y0) * k];
    const org = [(ox - X0) * k, (oy - Y0) * k]; // where the grid starts, in dots (tiles line up with it)
    // the pictures it needs
    const want = new Map();
    for (const it of os.items) {
      if (it.kind === 'area' && it.tile) { const t = tileInfo(it.tile, lib); if (t && t.url) want.set(t.url, t); }
      if (it.kind === 'stairs') { const t = it.tile ? tileInfo(it.tile, lib) : matInfo(it.mat); if (t && t.url) want.set(t.url, t); }
    }
    const loaded = new Map();
    await Promise.all([...want.values()].map(async (t) => { try { loaded.set(t.url, await image(t.url)); } catch (err) { console.error(err); } }));
    // (Beta 3.31) their dots are unpacked now, all at once and off the drawing thread (after a pause they would be
    // unpacked one by one while painting)
    await Promise.all([...loaded.values()].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    const pats = new Map(); // tile at a size → its scaled painting
    const floorC = canvas(W, Hh); const attrC = canvas(W, Hh); const solidC = canvas(W, Hh); const stairsC = canvas(W, Hh);
    const anyFade = os.items.some((it) => it.kind === 'area' && it.edge === 'fade');
    const haloC = anyFade ? canvas(W, Hh) : canvas(1, 1);
    paint(os, lib, T, k, P, org, loaded, { fg: floorC.getContext('2d'), ag: attrC.getContext('2d', CPU), sg: solidC.getContext('2d'), tg: stairsC.getContext('2d'), hg: anyFade ? haloC.getContext('2d') : null }, pats);
    const tm = { paint: Math.round(performance.now() - t0), mixBase: Math.round(prof.mix) }; let tl = performance.now();
    say(ph[0]);
    // ---- light and shadow (WebGL 2) ----
    const C = gl2();
    let out = null; let sharp = null; let saved = null;
    if (C) {
      try {
        const r = await shade(C, W, Hh, P, org, os, { floorC, attrC, solidC, stairsC, haloC, say: (f) => say(ph[0] + (ph[1] - ph[0]) * f) }, async (R) => {
          for (const c of [floorC, attrC, solidC, stairsC, haloC]) c.width = c.height = 0; // (let go before the tiles)
          tm.light = Math.round(performance.now() - tl); tl = performance.now();
          // (Beta 3.31) the base's file is made while the tiles are painted
          drawDoors(R.outC.getContext('2d'), os, T, P, doorPaints(os, lib, P, org, loaded, pats, g)); saved = { cv: R.outC, blob: encode(R.outC) };
          if (bx.sharp) sharp = await sharpTiles(C, R, { map, lib, bx, loaded, pats, W, Hh, org, prev, anyFade, say: (f) => say(ph[1] + (ph[2] - ph[1]) * f) });
          tm.tiles = Math.round(performance.now() - tl); tl = performance.now();
        });
        out = r;
      } catch (err) { console.error(err); out = null; sharp = null; }
    }
    if (!out) { // no graphics card: the flat painting with simple dark edges
      if (!floorC.width) { floorC.width = W; floorC.height = Hh; solidC.width = W; solidC.height = Hh; paint(os, lib, T, k, P, org, loaded, { fg: floorC.getContext('2d'), sg: solidC.getContext('2d') }, pats); }
      out = canvas(W, Hh); const o = out.getContext('2d', CPU);
      o.save(); o.shadowColor = 'rgba(0,0,0,0.9)'; o.shadowBlur = P * 0.25; o.drawImage(floorC, 0, 0); o.restore();
      o.drawImage(solidC, 0, 0);
    }
    const base = out; const bk = 1; // (Beta 3.31: with sharp tiles the base is half size already, see boxOf)
    let blob = null;
    if (saved && saved.cv === out) blob = await saved.blob;
    else { drawDoors(out.getContext('2d'), os, T, P, doorPaints(os, lib, P, org, loaded, pats, g)); blob = await encode(base); }
    tm.base = Math.round(performance.now() - tl);
    // the big paintings are let go at once: canvases can hold memory of the graphics card until they are collected,
    // and a drawing session makes many pictures
    for (const c of [floorC, attrC, solidC, stairsC, haloC, out, base]) c.width = c.height = 0;
    for (const p of pats.values()) if (p && p.cv) p.cv.width = p.cv.height = 0;
    say(ph[2]);
    const tw0 = performance.now();
    const walls = sightWalls(os, map, lib, { X0, Y0, nsx, nsy, g });
    tm.sight = Math.round(performance.now() - tw0);
    stats.last = { ms: Math.round(performance.now() - t0), ...tm, mix: Math.round(prof.mix), mixN: prof.mixN, maskMade: prof.maskMade, maskKept: prof.maskKept, tilePaint: Math.round(prof.tPaint), tileGl: Math.round(prof.tGl), tileEnc: Math.round(prof.tEnc), dots: W * Hh, P, sharpP: sharp ? sharp.P : 0, made: sharp ? sharp.tiles.filter((x) => x.blob).length : 0, kept: sharp ? sharp.tiles.filter((x) => !x.blob).length : 0 };
    return { blob, x: X0, y: Y0, scale: (g / P) * bk, nw: Math.round(W / bk), nh: Math.round(Hh / bk), walls, sharp };
  }

  // the base's light and shadow; then (more) is given what the sharp tiles need while it is still on the card
  async function shade(C, W, Hh, P, org, os, cv, more) {
    const { gl } = C;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (W > max || Hh > max) return null;
    if (C.canvas.width !== 1) C.canvas.width = C.canvas.height = 1; // (everything is drawn off screen)
    const tFloor = tex(gl, W, Hh, cv.floorC, { nearest: true });
    const tAttr = tex(gl, W, Hh, cv.attrC, { nearest: true });
    const tSolid = tex(gl, W, Hh, cv.solidC, { nearest: true });
    const tStairs = tex(gl, W, Hh, cv.stairsC, { nearest: true });
    const tHalo = tex(gl, cv.haloC.width, cv.haloC.height, cv.haloC, { nearest: true });
    const M = await matTextures(C, P);
    // floors (and stairs) are inside; distances both ways, and inside wall lines
    const merged = target(gl, W, Hh);
    run(C, prog(C, 'inside', `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D a, s; uniform vec2 size;
void main(){ ivec2 p = ivec2(floor(v_uv * size)); float f = max(texelFetch(a, p, 0).a, texelFetch(s, p, 0).g); o = vec4(0.0, 0.0, 0.0, f >= 0.5 ? 1.0 : 0.0); }`), W, Hh, merged.fb, { size: [W, Hh] }, { a: tFloor, s: tStairs });
    const pace = pacer(gl);
    const say = cv.say || (() => {});
    const outJ = await flood(C, W, Hh, merged.t, 0, 0, pace); // seeds: inside → for outside dots, the nearest floor
    say(0.15);
    const inJ = await flood(C, W, Hh, merged.t, 0, 1, pace); // seeds: outside → for floor dots, the nearest edge
    say(0.3);
    const solJ = await flood(C, W, Hh, tSolid, 1, 1, pace); // inside wall lines: how far to their side
    say(0.4);
    gl.deleteTexture(merged.t); gl.deleteFramebuffer(merged.fb); // (what is no longer needed goes at once: a big map needs the room)
    const Ht = target(gl, W, Hh);
    await runBands(C, prog(C, 'height', FS_HEIGHT), W, Hh, Ht.fb, { size: [W, Hh], P, org, matSq: M.sq }, { floorT: tFloor, attrT: tAttr, solidT: tSolid, stairsT: tStairs, outJ, inJ, solJ, ...M.t }, pace);
    for (const t of [tSolid, tStairs, solJ]) gl.deleteTexture(t);
    say(0.6);
    const a = ((os.sun ?? 135) * Math.PI) / 180; const el = (40 * Math.PI) / 180;
    const L = [Math.cos(a) * Math.cos(el), -Math.sin(a) * Math.cos(el), Math.sin(el)];
    const S = SHADOWS[os.shadows] || SHADOWS.short; // (Beta 3.25: short, soft shadows unless the map wants long ones)
    // the picture and (a second output) the light alone
    const Sh = target(gl, W, Hh); const Lt = tex(gl, W, Hh, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, Sh.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, Lt, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    await runBands(C, prog(C, 'shade', FS_SHADE), W, Hh, Sh.fb, { size: [W, Hh], P, org, matSq: M.sq, L, voidC: VOID, shT: S.tan, shK: S.k }, { hT: Ht.t, floorT: tFloor, attrT: tAttr, haloT: tHalo, outJ, inJ, ...M.t }, pace);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    say(1);
    // read back into a painting in memory (rows come out top first, as the paintings went in)
    const outC = document.createElement('canvas'); outC.width = W; outC.height = Hh;
    {
      gl.bindFramebuffer(gl.FRAMEBUFFER, Sh.fb); gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      outC.getContext('2d', CPU).putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, Hh), 0, 0);
    }
    gl.deleteTexture(Sh.t); gl.deleteFramebuffer(Sh.fb);
    for (const t of [tFloor, tHalo, Ht.t, ...M.list]) gl.deleteTexture(t);
    gl.deleteFramebuffer(Ht.fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // the light is stretched smoothly on the tiles
    gl.bindTexture(gl.TEXTURE_2D, Lt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    try { if (more) await more({ outJ, inJ, attrT: tAttr, lightT: Lt, pace, outC }); }
    finally { for (const t of [outJ, inJ, tAttr, Lt]) gl.deleteTexture(t); }
    return outC;
  }
  const VOID = [0, 0, 0]; // (Beta 3.25: black, as the table around: a drop ends in it without a seam)
  // Beta 3.25: how long the shadows are (the tangent of the sun's height for them) and how dark; the light on slopes
  // keeps its 40° (walls keep their relief)
  const SHADOWS = { short: { tan: Math.tan((62 * Math.PI) / 180), k: 0.42 }, long: { tan: Math.tan((40 * Math.PI) / 180), k: 0.5 }, off: { tan: 0, k: 0 } };
  // the materials (repeating, at their own squares), painted at P dots a square
  async function matTextures(C, P) {
    const { gl } = C; const list = [];
    for (const m of MATERIALS) { const img = await image(DIR + m.file); const sc = scaled(img, m.squares * P); list.push(tex(gl, 0, 0, sc, { repeat: true, mip: true })); sc.width = sc.height = 0; }
    const ts = list.slice(); while (ts.length < 5) ts.push(ts[0]);
    const sq = MATERIALS.slice(0, 5).map((m) => m.squares); while (sq.length < 5) sq.push(4);
    return { list, sq, t: { mtl0: ts[0], mtl1: ts[1], mtl2: ts[2], mtl3: ts[3], mtl4: ts[4] } };
  }

  // Beta 3.25: the sharp tiles. Tiles lie on whole squares from the grid's origin (ts squares across), so they stay
  // where they are when the drawing grows. A tile whose key is unchanged is kept as it is.
  async function sharpTiles(C, R, a) {
    const { gl } = C; const { map, lib, bx, loaded, pats, W, Hh, org, prev, anyFade } = a; const say = a.say || (() => {});
    const os = map.os; const { g, ox, oy, sx0, sy0, sx1, sy1 } = bx; const { P: PH, ts } = bx.sharp;
    const TD = ts * PH; const kH = PH / g; const s = PH / bx.P;
    const sunA = ((os.sun ?? 135) * Math.PI) / 180; const sunE = (40 * Math.PI) / 180; const L = [Math.cos(sunA) * Math.cos(sunE), -Math.sin(sunA) * Math.cos(sunE), Math.sin(sunE)];
    const keep = new Set(prev && prev.P === PH && prev.ts === ts ? (prev.tiles || []).map((t) => t.h) : []);
    const tiles = []; let M = null; const saving = [];
    // the tiles there are, and which of them must be made (for how far along it is)
    const all = [];
    for (let r = Math.floor(sy0 / ts); r <= Math.floor((sy1 - 1) / ts); r++) {
      for (let c = Math.floor(sx0 / ts); c <= Math.floor((sx1 - 1) / ts); c++) {
        const h = tileKey(map, lib, bx, c, r);
        if (h) all.push({ c, r, h }); // (nothing shows where it has no key)
      }
    }
    const toMake = all.filter((t) => !keep.has(t.h)).length; let madeN = 0;
    try {
      for (const { c, r, h } of all) {
        {
          if (keep.has(h)) { tiles.push({ c, r, h }); continue; }
          M = M || await matTextures(C, PH);
          const tx0 = ox + c * ts * g; const ty0 = oy + r * ts * g;
          const T = (x, y) => [(x - tx0) * kH, (y - ty0) * kH];
          const tp0 = performance.now();
          const fc = canvas(TD, TD); const sc = canvas(TD, TD); const hc = anyFade ? canvas(TD, TD) : canvas(1, 1);
          paint(os, lib, T, kH, PH, [(ox - tx0) * kH, (oy - ty0) * kH], loaded, { fg: fc.getContext('2d'), sg: sc.getContext('2d'), hg: anyFade ? hc.getContext('2d') : null }, pats);
          const tF = tex(gl, TD, TD, fc, { nearest: true }); const tS = tex(gl, TD, TD, sc, { nearest: true }); const tH = tex(gl, hc.width, hc.height, hc, { nearest: true });
          fc.width = fc.height = 0; sc.width = sc.height = 0; hc.width = hc.height = 0;
          const tp1 = performance.now(); prof.tPaint += tp1 - tp0;
          const O = target(gl, TD, TD);
          await runBands(C, prog(C, 'sharp', FS_SHARP), TD, TD, O.fb, { size: [TD, TD], tileO: [c * ts * PH, r * ts * PH], loSize: [W, Hh], orgLo: org, s, P: PH, matSq: M.sq, voidC: VOID, L }, { floorH: tF, solidH: tS, haloH: tH, outJ: R.outJ, inJ: R.inJ, attrT: R.attrT, lightT: R.lightT, ...M.t }, R.pace);
          const px = new Uint8Array(TD * TD * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, O.fb); gl.readPixels(0, 0, TD, TD, gl.RGBA, gl.UNSIGNED_BYTE, px);
          gl.deleteTexture(tF); gl.deleteTexture(tS); gl.deleteTexture(tH); gl.deleteTexture(O.t); gl.deleteFramebuffer(O.fb);
          const oc = canvas(TD, TD); const o = oc.getContext('2d', CPU);
          o.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), TD, TD), 0, 0);
          drawDoors(o, os, T, PH, doorPaints(os, lib, PH, [(ox - tx0) * kH, (oy - ty0) * kH], loaded, pats, g));
          let jpg = true; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { jpg = false; break; }
          const tp2 = performance.now(); prof.tGl += tp2 - tp1;
          // (Beta 3.31) its file is made while the next tiles are painted, a few at a time
          const tile = { c, r, h, jpg, blob: null };
          const job = encode(oc, jpg).then((b) => { tile.blob = b; oc.width = oc.height = 0; });
          saving.push(job); tiles.push(tile);
          if (saving.length >= 6) await saving.shift();
          prof.tEnc += performance.now() - tp2;
          say(++madeN / Math.max(1, toMake));
        }
      }
    } finally {
      if (M) for (const t of M.list) gl.deleteTexture(t);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const te = performance.now(); await Promise.all(saving); prof.tEnc += performance.now() - te;
    return { P: PH, ts, tiles };
  }
  // ---------- Beta 3.33: doors and windows of any length ----------
  // Where a door sits in its wall. A door lies on a grid line; on a room's edge the wall lies outside the floor, so the
  // door goes onto the middle of that wall band (0.225 squares out); in a wall line, on its middle. thick: the wall's
  // thickness; `empty`: nothing lies beyond the wall there (the doorway fades into the dark); `bandFloor`: another
  // floor lies over the wall there (no wall to open). Used by the picture and by the live leaves (scene-view.js).
  function doorPlace(os, d, g) {
    const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1; const ux = (d.x2 - d.x1) / L; const uy = (d.y2 - d.y1) / L;
    const nx = -uy; const ny = ux; const mx = (d.x1 + d.x2) / 2; const my = (d.y1 + d.y2) / 2;
    // a wall line along it
    for (const it of os.items) {
      if (it.kind !== 'line') continue;
      for (let k2 = 0; k2 + 1 < it.pts.length; k2++) {
        const [ax, ay] = it.pts[k2]; const [bx, by] = it.pts[k2 + 1]; const lx = bx - ax; const ly = by - ay; const ll = Math.hypot(lx, ly) || 1;
        if (Math.abs((lx * uy - ly * ux) / ll) > 0.05) continue; // (not along it)
        const t2 = ((mx - ax) * lx + (my - ay) * ly) / (ll * ll); const off = ((ax - mx) * nx + (ay - my) * ny);
        if (t2 > -0.01 && t2 < 1.01 && Math.abs(off) < it.w / 2) return { off, thick: it.w, mat: it.mat || 'stone_wall', side: 0, line: true };
      }
    }
    // a room's edge: which side has floor just beyond the door's ends (the doorway itself may have floor on both)
    const at = (x, y) => areaAt(os, x, y);
    let pos = 0; let neg = 0; let room = null;
    for (const [ex, ey] of [[d.x1 - ux * 0.3 * g, d.y1 - uy * 0.3 * g], [d.x2 + ux * 0.3 * g, d.y2 + uy * 0.3 * g], [mx, my]]) {
      const a = at(ex + nx * 0.2 * g, ey + ny * 0.2 * g); const b = at(ex - nx * 0.2 * g, ey - ny * 0.2 * g);
      if (a) { pos++; room = room || a; } if (b) { neg++; room = room || b; }
    }
    if (!room) return { off: 0, thick: 0.45 * g, mat: 'stone_wall', side: 0 };
    const sgn = pos > neg ? -1 : neg > pos ? 1 : 0; // (the wall lies on the side with less floor)
    const inside = sgn ? at(mx - nx * sgn * 0.2 * g, my - ny * sgn * 0.2 * g) || room : room;
    const mat = inside.edge === 'walls' || inside.edge === 'rock' ? inside.mat || DEFAULT_MAT[inside.edge] : 'stone_wall';
    const empty = sgn !== 0 && !at(mx + nx * sgn * 0.8 * g, my + ny * sgn * 0.8 * g);
    const bandFloor = sgn !== 0 && !!at(mx + nx * sgn * 0.225 * g, my + ny * sgn * 0.225 * g); // (another floor lies over the wall there)
    return { off: sgn * 0.225 * g, thick: 0.45 * g, mat, side: sgn, empty, floor: inside, bandFloor };
  }
  // Beta 3.34: no frame (Glinn: "the frame is too much"), just the door. Where a door lies on a wall the wall opens:
  // the room's floor runs through it, and the cut ends of the wall shade the doorway (more on the side away from the
  // sun). A window sits in a niche: the wall's own stone, the part the window sits in shaded as if deeper down, with a
  // stop at each end holding it. Secret doors show nothing. The leaves are drawn live on both screens (scene-view.js).
  const NICHE = { stop: 0.09, stopW: 0.21 }; // (squares: how far a window's stops reach along it, and across)
  function drawDoors(o, os, T, P, dc) {
    if (!dc) return;
    const { g, org, floorPat } = dc;
    const sun = (((os.sun ?? 135) * Math.PI) / 180); const sx = Math.cos(sun); const sy = -Math.sin(sun); // (toward the light)
    const k = P / g;
    for (const d of os.doors) {
      if (d.door === 2) continue;
      const pl = doorPlace(os, d, g); const win = d.kind === 'window';
      if (!pl.line && (!pl.side || pl.bandFloor)) continue; // (no wall here: floor on both sides, or another floor over it)
      const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1); if (L * k < 2) continue;
      const ux = (d.x2 - d.x1) / L; const uy = (d.y2 - d.y1) / L;
      const [ax, ay] = T(d.x1 - uy * pl.off, d.y1 + ux * pl.off);
      const S = L * k; const bd = pl.thick * k; const ang = Math.atan2(uy, ux);
      const lsx = sx * Math.cos(-ang) - sy * Math.sin(-ang); // (the sun along it)
      o.save(); o.translate(ax, ay); o.rotate(ang);
      if (win) windowNiche(o, S, bd, P, sx, sy);
      else doorway(o, pl, S, bd, P, lsx, new DOMMatrix().rotate((-ang * 180) / Math.PI).translate(org[0] - ax, org[1] - ay), floorPat);
      o.restore();
    }
  }
  // a doorway through the wall (in a wall line the line is cut already, see paint)
  function doorway(o, pl, S, bd, P, lsx, onGrid, floorPat) {
    if (!pl.line && pl.floor) {
      const fp = floorPat(o, pl.floor, onGrid);
      if (fp) {
        o.fillStyle = fp; o.fillRect(0, -bd / 2, S, bd); o.fillStyle = 'rgba(0,0,0,0.3)'; o.fillRect(0, -bd / 2, S, bd);
        if (pl.empty) { // (toward the dark beyond: the floor fades into it, as the wall's edge does)
          const out = pl.side > 0 ? bd / 2 : -bd / 2; const f = 0.16 * P; const gr = o.createLinearGradient(0, out - Math.sign(out) * f, 0, out);
          gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.7)'); o.fillStyle = gr; o.fillRect(0, Math.min(out, out - Math.sign(out) * f), S, f);
        }
      }
    }
    // the cut ends of the wall: their shadow into the doorway (more on the side away from the sun), a dark seam
    const w = 0.18 * P; const seam = 1.5 * P / 140;
    for (const [x0, dir, a] of [[0, 1, 0.42 + 0.33 * Math.max(0, -lsx)], [S, -1, 0.42 + 0.33 * Math.max(0, lsx)]]) {
      const gr = o.createLinearGradient(x0, 0, x0 + dir * w, 0); gr.addColorStop(0, `rgba(0,0,0,${a.toFixed(3)})`); gr.addColorStop(0.45, `rgba(0,0,0,${(a * 0.35).toFixed(3)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = gr; o.fillRect(Math.min(x0, x0 + dir * w), -bd / 2, w, bd);
      o.fillStyle = 'rgba(8,7,6,0.7)'; o.fillRect(dir > 0 ? x0 : x0 - seam, -bd / 2, seam, bd);
    }
  }
  // a window's niche in the wall (Glinn's sketch, 19 November 2026): across the wall's whole thickness, a stop at each
  // end; the wall there darker, and the wall around it casts its shadow in, away from the sun
  function windowNiche(o, S, bd, P, sx, sy) {
    const e = NICHE.stop * P; const h = Math.min(bd * 0.7, NICHE.stopW * P) / 2; const t = bd / 2;
    const niche = new Path2D();
    niche.moveTo(-e, -t); niche.lineTo(S + e, -t); niche.lineTo(S + e, -h); niche.lineTo(S, -h); niche.lineTo(S, h); niche.lineTo(S + e, h);
    niche.lineTo(S + e, t); niche.lineTo(-e, t); niche.lineTo(-e, h); niche.lineTo(0, h); niche.lineTo(0, -h); niche.lineTo(-e, -h); niche.closePath();
    o.save(); o.clip(niche);
    o.fillStyle = 'rgba(0,0,0,0.5)'; o.fillRect(-e, -t, S + 2 * e, bd); // (deeper down: darker)
    const around = new Path2D(); around.rect(-e - P, -t - P, S + 2 * e + 2 * P, bd + 2 * P); around.addPath(niche);
    o.shadowColor = 'rgba(0,0,0,0.6)'; o.shadowBlur = Math.max(1, 0.035 * P); o.shadowOffsetX = -sx * 0.05 * P; o.shadowOffsetY = -sy * 0.05 * P;
    o.fillStyle = '#000'; o.fill(around, 'evenodd'); // (only its shadow lands inside: the wall around casts it in)
    o.restore();
    o.lineWidth = Math.max(1, P / 140); o.strokeStyle = 'rgba(10,9,8,0.55)'; o.stroke(niche);
  }
  // what drawDoors needs to paint with: the floors' tiles as patterns, on the grid
  function doorPaints(os, lib, P, org, loaded, pats, g) {
    const scaledOf = (url, squares) => {
      const key = `${url}@${squares}@door@${P}`;
      if (!pats.has(key)) { const im = loaded.get(url); if (!im) return null; pats.set(key, { cv: scaled(im, squares * P) }); }
      return pats.get(key).cv;
    };
    return {
      g, org,
      floorPat: (o, area, m) => {
        const t = area.tile && tileInfo(area.tile, lib); if (!t) return null;
        const cv = scaledOf(t.url, t.squares || 4); if (!cv) return null;
        const p = o.createPattern(cv, 'repeat'); const off = t.off || [0, 0]; p.setTransform(m.translate(-off[0] * P, -off[1] * P)); return p;
      },
    };
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
    // Beta 3.25: the walls for sight lie in the middle of what is built, so the players see the near half of the walls
    // (and not only darkness under the fog; the fog's soft edge shows a little more): the middle of a wall band (rock:
    // of its first half square), between two floors the middle of the band that parts them, wall lines along their middle.
    const N = W * H;
    const floor = new Uint8Array(N); const code = new Uint8Array(N);
    for (let i = 0; i < N; i++) { floor[i] = F[i * 4 + 3] >= 128 ? 1 : 0; code[i] = A[i * 4 + 3] >= 128 ? Math.round(A[i * 4] / 40) : 0; }
    // small holes in a floor (where brush strokes almost meet, or a little bit erased) are a lump of wall in the
    // picture: for sight they are like a pillar, a small block in their middle (not walls all round)
    const holes = [];
    {
      const seen = new Uint8Array(N); const small = 3 * Q * Q; // (up to three squares)
      for (let i0 = 0; i0 < N; i0++) {
        if (floor[i0] || seen[i0]) continue;
        const comp = [i0]; seen[i0] = 1; let border = false; let near = 0;
        for (let c = 0; c < comp.length; c++) {
          const i = comp[c]; const x = i % W; const y = (i - x) / W;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
          for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
            if (j < 0) continue;
            if (floor[j]) { near = code[j] || near; continue; }
            if (!seen[j]) { seen[j] = 1; comp.push(j); }
          }
        }
        if (!border && comp.length <= small) { holes.push(comp); for (const i of comp) { floor[i] = 1; code[i] = near; } }
      }
    }
    const BAND = { [EDGE_CODE.walls]: 0.225 * Q + 0.5, [EDGE_CODE.rock]: 0.275 * Q + 0.5 }; // (half the band the picture draws)
    const TMAX = 0.55 * Q + 2;
    // for the dots near a floor: the nearest floor dot (seed) and how far it is (spread outward, nearest first)
    const seed = new Int32Array(N).fill(-1); const dist = new Float32Array(N).fill(1e9);
    let queue = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!floor[i]) continue;
      seed[i] = i; dist[i] = 0;
      if ((x > 0 && !floor[i - 1]) || (x < W - 1 && !floor[i + 1]) || (y > 0 && !floor[i - W]) || (y < H - 1 && !floor[i + W])) queue.push(i);
    }
    while (queue.length) {
      const next = [];
      for (const i of queue) {
        const x = i % W; const y = (i - x) / W; const s0 = seed[i]; const sx = s0 % W; const sy = (s0 - sx) / W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; const yy = y + dy; if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx; if (floor[j]) continue;
          const d = Math.hypot(xx - sx, yy - sy); if (d > TMAX || d >= dist[j] - 1e-6) continue;
          dist[j] = d; seed[j] = s0; next.push(j);
        }
      }
      queue = next;
    }
    const inB = new Uint8Array(N); // the near half of the built band: walls, the first of the rock
    for (let i = 0; i < N; i++) if (!floor[i] && seed[i] >= 0) { const t = BAND[code[seed[i]]]; if (t && dist[i] <= t) inB[i] = 1; }
    const isB = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inB[y * W + x] === 1;
    const inV = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (floor[y * W + x] === 1 || inB[y * W + x] === 1);
    const inS = (x, y) => x >= 0 && y >= 0 && x < W && y < H && S[(y * W + x) * 4 + 3] >= 128;
    const out = [];
    const toMap = (x, y) => [X0 + x / k, Y0 + y / k];
    const addLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = toMap(pts[i][0], pts[i][1]); const [x2, y2] = toMap(pts[i + 1][0], pts[i + 1][1]); out.push([x1, y1, x2, y2]); } };
    const TOL = 1.4; // (about a ninth of a square: smooth, few corners, and still inside the band)
    // (a) the middle of the walls: the outline of floors + near halves where the half is inside it
    for (const loop of contours(W, H, inV)) {
      const n = loop.length - 1; // (closed: the last corner is the first)
      const keep = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const [ax, ay] = loop[i]; const [bx, by] = loop[i + 1];
        const mx = (ax + bx) / 2 - (by - ay) * 0.5; const my = (ay + by) / 2 + (bx - ax) * 0.5; // (the dot on the inside, to the right)
        keep[i] = isB(Math.floor(mx), Math.floor(my)) ? 1 : 0;
      }
      if (keep.every((v) => v)) { addLine(simplify(loop, TOL)); continue; }
      let s0 = keep.indexOf(0); // (start where it is not kept, so a run never wraps)
      let run = null;
      for (let t = 1; t <= n; t++) {
        const i = (s0 + t) % n;
        if (keep[i]) { if (!run) run = [loop[i]]; run.push(loop[i + 1]); }
        else if (run) { addLine(rdp(run, TOL)); run = null; }
      }
      if (run) addLine(rdp(run, TOL));
    }
    // (b) between two floors parted by one band: its middle (where the nearest floor jumps from one side to the other)
    // (and the two floors lie on either side: not just a step along one curved edge, which only gives a little tick)
    const far = (i, j) => {
      const a = seed[i]; const b = seed[j]; if (a < 0 || b < 0) return false;
      const ax = a % W; const ay = (a - ax) / W; const bx = b % W; const by = (b - bx) / W;
      if (Math.hypot(ax - bx, ay - by) <= 2.6) return false;
      const xi = i % W; const xj = j % W; const mx = (xi + xj) / 2; const my = ((i - xi) / W + (j - xj) / W) / 2;
      return (ax - mx) * (bx - mx) + (ay - my) * (by - my) < 0;
    };
    const ridge = new Map(); const rk = (x, y) => x * 100003 + y;
    const link = (ax, ay, bx, by) => { for (const [p, q] of [[[ax, ay], [bx, by]], [[bx, by], [ax, ay]]]) { const key = rk(p[0], p[1]); if (!ridge.has(key)) ridge.set(key, []); ridge.get(key).push(q); } };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!inB[i]) continue;
      if (x + 1 < W && inB[i + 1] && far(i, i + 1)) link(x + 1, y, x + 1, y + 1);
      if (y + 1 < H && inB[i + W] && far(i, i + W)) link(x, y + 1, x + 1, y + 1);
    }
    const take = (key, to) => { const l = ridge.get(key); const at = l.findIndex((q) => q[0] === to[0] && q[1] === to[1]); if (at >= 0) l.splice(at, 1); };
    const walk = (startKey) => {
      const sx = Math.floor(startKey / 100003); const pts = [[sx, startKey - sx * 100003]]; let key = startKey;
      for (let guard = 0; guard < 1e6; guard++) {
        const l = ridge.get(key); if (!l || !l.length) break;
        const q = l.pop(); take(rk(q[0], q[1]), pts[pts.length - 1]); pts.push(q); key = rk(q[0], q[1]);
      }
      if (pts.length > 2) addLine(rdp(pts, TOL)); else if (pts.length === 2) addLine(pts);
    };
    for (const [key, l] of ridge) if (l.length === 1) walk(key); // (lines first, from their ends)
    for (const [key, l] of ridge) while (l.length) walk(key); // (then the rest)
    // (c) wall lines along their middle (where they stand: an erased bit or a door lets through); pillars as a smaller block
    for (const it of os.items) {
      if (it.kind === 'line') {
        for (let i = 0; i < it.pts.length - 1; i++) {
          const [a, b] = [T(...it.pts[i]), T(...it.pts[i + 1])]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / 0.5));
          let from = null;
          for (let s2 = 0; s2 <= n; s2++) {
            const u = s2 / n; const x = a[0] + (b[0] - a[0]) * u; const y = a[1] + (b[1] - a[1]) * u;
            const on = inS(Math.min(W - 1, Math.floor(x)), Math.min(H - 1, Math.floor(y)));
            if (on && !from) from = [x, y];
            if ((!on || s2 === n) && from) { const end = on ? [x, y] : [a[0] + (b[0] - a[0]) * ((s2 - 1) / n), a[1] + (b[1] - a[1]) * ((s2 - 1) / n)]; if (Math.hypot(end[0] - from[0], end[1] - from[1]) > 0.5) addLine([from, end]); from = null; }
          }
        }
      } else if (it.kind === 'pillar') {
        const [[cx, cy]] = it.pts; const [px, py] = T(cx, cy);
        if (!inS(Math.floor(px), Math.floor(py))) continue;
        const r = it.r * 0.6; const n = it.round ? 6 : 4; const ring = [];
        for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2 + (it.round ? 0 : Math.PI / 4); const rr = it.round ? r : r * Math.SQRT2; ring.push(T(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)); }
        addLine(ring);
      }
    }
    for (const comp of holes) {
      const set = new Uint8Array(N); let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
      for (const i of comp) { set[i] = 1; const x = i % W; const y = (i - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const core = (x, y) => { // (two and a half dots in from its rim)
        if (x < x0 || y < y0 || x > x1 || y > y1 || !set[y * W + x]) return false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; const yy = y + dy; if (dx * dx + dy * dy > 6.5) continue; if (xx < 0 || yy < 0 || xx >= W || yy >= H || !set[yy * W + xx]) return false; }
        return true;
      };
      for (const loop of contours(W, H, core)) addLine(simplify(loop, TOL));
    }
    // doors: the walls they lie on are cut there; the door is a wall of its own, and where it meets a band, the band
    // goes on beside it (its jambs: no looking around a shut door through the wall's thickness)
    const walls = [];
    const doors = os.doors.map((d) => ({ ...d }));
    for (const s2 of out) for (const piece of cutByDoors(s2, doors, g)) walls.push({ c: piece, key: `s${piece.map((v) => Math.round(v * 100)).join(',')}` });
    const J = 0.25 * g; // (to the middle of the wall beside the door)
    for (const d of doors) {
      walls.push({ c: [d.x1, d.y1, d.x2, d.y2], door: d.kind === 'window' ? 0 : d.door, kind: d.kind === 'window' ? 'window' : undefined, key: `d${d.id}` });
      const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1; const ux = (d.x2 - d.x1) / L; const uy = (d.y2 - d.y1) / L;
      for (const [ex, ey, sg2] of [[d.x1, d.y1, -1], [d.x2, d.y2, 1]]) {
        const fx = ex + ux * J * sg2; const fy = ey + uy * J * sg2;
        const [mx, my] = T((ex + fx) / 2, (ey + fy) / 2); const nx = -uy * 1.5; const ny = ux * 1.5;
        if (isB(Math.floor(mx + nx), Math.floor(my + ny)) || isB(Math.floor(mx - nx), Math.floor(my - ny))) walls.push({ c: [ex, ey, fx, fy], key: `j${d.id}${sg2 > 0 ? 'b' : 'a'}` });
      }
    }
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

  // (noSharp: the self-test's software graphics are slow; it switches the sharp tiles off where they are not the point.
  // noPill: and the progress pill, whose running maid would keep its window drawing all the while)
  const api = { DATA, FLOORS, MATERIALS, EDGES, relOf, tileInfo, findJoints, matInfo, bounds, hash, bake, areaAt, doorPlace, setSharp, stats, noSharp: false, noPill: false, sharpOf: (map) => { const b = boxOf(map); return b && b.sharp; }, supported: () => !!gl2(), DEFAULT_MAT };
  return api;
})();
