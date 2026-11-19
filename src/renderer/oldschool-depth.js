// Oldschool maps, Beta 3.23: the depth view. A camera hangs above the middle of the table; what stands high (walls,
// pillars, rock, raised floors) leans away from that middle, so their inner faces show on every side, as in a
// photo taken from above. When the map moves, they lean around the new middle.
//
// The GM screen makes the drawing's picture (oldschool.js) and, with the depth view on, a height map next to it
// (<picture>-h.png: height in red and green, what the dot is and its material in blue). Here, on both screens, the
// graphics card looks along each ray from the camera through the table: the first thing it meets is what that dot
// shows. The tops come from the picture (already lit, with its shadows); the faces from the materials, lit by the
// same sun and darker toward their foot. Without WebGL 2 the picture is shown as it is.
// Tokens, the grid, the fog and line of sight stay on the floor plan.
'use strict';

const OldschoolDepth = (() => {
  const DATA = typeof TILE_DATA === 'object' ? TILE_DATA : { tiles: [] };
  const DIR = new URL('tiles/', document.baseURI).href;
  const MATERIALS = DATA.tiles.filter((t) => t.kind === 'material');
  const LEAN = 1.6; // the camera's height: this many times half the table's diagonal (lower: more lean)

  const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float; out vec4 o;
uniform sampler2D colT, hT, mtl0, mtl1, mtl2, mtl3, mtl4;
uniform vec2 size; uniform float outH; uniform float k; uniform vec2 C; uniform float Hc; uniform float P; uniform vec2 org;
uniform float matSq[5]; uniform vec3 L;
float H(vec2 g){
  if (g.x < 0.0 || g.y < 0.0 || g.x >= size.x || g.y >= size.y) return -1e5;
  vec4 c = floor(texelFetch(hT, ivec2(g), 0) * 255.0 + 0.5);
  return c.r * 256.0 + c.g - 32768.0;
}
float info(vec2 g){ return floor(texelFetch(hT, ivec2(clamp(g, vec2(0.0), size - 1.0)), 0).b * 255.0 + 0.5); }
vec3 matCol(int i, vec2 uv){
  if (i == 0) return texture(mtl0, uv).rgb; if (i == 1) return texture(mtl1, uv).rgb; if (i == 2) return texture(mtl2, uv).rgb;
  if (i == 3) return texture(mtl3, uv).rgb; return texture(mtl4, uv).rgb; }
void main(){
  vec2 s = vec2(gl_FragCoord.x, outH - gl_FragCoord.y) / k;          // this dot, in the picture's own dots
  vec2 ds = vec2(dFdx(s.x), dFdy(s.y));
  vec2 d = s - C;
  float zT = 2.8 * P; float zB = -1.6 * P;
  const int N = 44;
  float zp = zT; float z = zT; bool hit = false;
  for (int i = 1; i <= N; i++) {
    z = mix(zT, zB, float(i) / float(N));
    if (H(C + d * (Hc - z) / Hc) >= z) { hit = true; break; }
    zp = z;
  }
  if (!hit) { vec2 g = C + d * (Hc - zB) / Hc; o = textureGrad(colT, g / size, vec2(ds.x, 0.0) / size, vec2(0.0, ds.y) / size); return; }
  float lo = zp; float hi = z; // (lo: still above; hi: inside)
  for (int j = 0; j < 7; j++) { float m = 0.5 * (lo + hi); if (H(C + d * (Hc - m) / Hc) >= m) hi = m; else lo = m; }
  z = hi;
  vec2 g = C + d * (Hc - z) / Hc;
  float h = H(g);
  vec4 top = textureGrad(colT, g / size, vec2(ds.x, 0.0) / size, vec2(0.0, ds.y) / size);
  if (h - z < max(2.0, 0.04 * P)) { o = top; return; } // the top: the picture itself
  // a face: which way it looks (out of what it belongs to), what it is made of, its light
  vec2 gr = vec2(H(g + vec2(2.0, 0.0)) - H(g - vec2(2.0, 0.0)), H(g + vec2(0.0, 2.0)) - H(g - vec2(0.0, 2.0)));
  vec2 n = length(gr) > 1.0 ? -normalize(gr) : -normalize(d + vec2(1e-3));
  float b = info(g); float kind = floor(b / 8.0); int mi = int(mod(b, 8.0));
  vec3 col;
  if (kind == 2.0 || kind == 3.0 || kind == 5.0) {
    float sq = matSq[mi] * P; vec2 t = vec2(-n.y, n.x);
    col = matCol(mi, vec2(dot(g - org, t), h - z) / sq);
  } else col = top.rgb * 0.92;                                         // the edge of a raised floor: the floor itself
  float hb = H(g + n * 3.0); if (hb < -1e4) hb = z - P;
  float up = clamp((z - hb) / max(h - hb, 1.0), 0.0, 1.0);              // 0 at its foot, 1 at its top
  float lam = max(dot(vec3(n, 0.0), L), 0.0) / max(length(L.xy), 0.2);
  float light = (0.42 + 0.62 * lam) * (0.55 + 0.45 * up);
  if (h - z < 0.08 * P) light *= 1.12;                                  // its upper edge catches the light
  o = vec4(clamp(col * light, 0.0, 1.0), 1.0);
}`;

  const gl2Ok = (() => { let r = null; return () => { if (r === null) { try { r = !!document.createElement('canvas').getContext('webgl2'); } catch { r = false; } } return r; }; })();
  const imgOf = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`depth picture ${url}`)); i.src = url; });

  // one per scene view
  class Depth {
    constructor(sv) {
      this.sv = sv;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sv-depth';
      this.gl = null; this.prog = null; this.u = {};
      this.colUrl = null; this.hmUrl = null; this.tex = {}; this.mats = null;
      this.want = null; this.sig = ''; this.raf = 0; this.loading = null; this.failed = false;
      this.stats = { renders: 0, ms: 0, k: 0 };
      this.budget = 200000; // dots drawn before waiting for the graphics card
    }
    // the GL side, made once
    init() {
      if (this.gl) return !this.gl.isContextLost();
      const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) return false;
      // (lost for real: the flat picture shows; let go on purpose (dispose): nothing to say)
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (this.disposed) return; this.failed = true; this.sv.depthFailed(); });
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`depth shader: ${gl.getShaderInfoLog(s)}`); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`depth program: ${gl.getProgramInfoLog(p)}`);
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); const name = a.name.replace(/\[0\]$/, ''); this.u[name] = gl.getUniformLocation(p, a.name); }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.gl = gl; this.prog = p;
      return true;
    }
    upload(src, { repeat = false, mip = false, nearest = false } = {}, old = null) {
      const gl = this.gl;
      if (old) gl.deleteTexture(old);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, nearest ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      // faces are seen at a slant: the materials stay sharp along them
      const an = repeat && (gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'));
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      return t;
    }
    // what to show: the picture (its <img>, loaded), its height map and where it lies. Answers false when it cannot.
    set(w) {
      if (this.failed || !gl2Ok()) return false;
      try { if (!this.init()) { this.failed = true; return false; } } catch (err) { console.error(err); this.failed = true; return false; }
      this.want = w;
      this.schedule();
      return true;
    }
    schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
    async load(w) {
      const gl = this.gl;
      if (!this.mats) {
        this.mats = [];
        for (const m of MATERIALS.slice(0, 5)) {
          const img = await imgOf(DIR + m.file);
          const c = document.createElement('canvas'); c.width = c.height = 768; // (faces are narrow on the screen: half size is plenty)
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, 768, 768);
          this.mats.push(this.upload(c, { repeat: true, mip: true }));
          c.width = c.height = 0;
        }
        while (this.mats.length < 5) this.mats.push(this.mats[0]);
      }
      if (this.hmUrl !== w.hmUrl) { const hm = await imgOf(w.hmUrl); this.tex.h = this.upload(hm, { nearest: true }, this.tex.h); this.hmUrl = w.hmUrl; this.hmSize = [hm.naturalWidth, hm.naturalHeight]; }
      if (this.colUrl !== w.colUrl) { this.tex.c = this.upload(w.img, { mip: true }, this.tex.c); this.colUrl = w.colUrl; }
      void gl;
    }
    // one drawing at a time; what was asked meanwhile is drawn right after
    async draw() {
      if (this.drawing) { this.again = true; return; }
      this.drawing = true;
      try { await this.drawNow(); } catch (err) { console.error(err); } finally { this.drawing = false; }
      if (this.again && this.gl) { this.again = false; this.schedule(); }
    }
    async drawNow() {
      const w = this.want; if (!w || !this.gl || this.failed) return;
      if (this.colUrl !== w.colUrl || this.hmUrl !== w.hmUrl || !this.mats) {
        if (this.bad === `${w.colUrl}|${w.hmUrl}`) return; // (it could not be read: the flat picture shows until the next one)
        try { await this.load(w); } catch (err) { console.warn(err); this.bad = `${w.colUrl}|${w.hmUrl}`; this.sv.depthShown(null); return; }
        if (!this.gl) return; // (let go meanwhile)
        if (this.want !== w) { this.again = true; return; }
      }
      const gl = this.gl; const sv = this.sv;
      const p = w.place; const r = sv.tableRectInMap();
      // how many of the picture's dots one dot on the screen shows: drawn at that size (less work, and no shimmer)
      const disp = p.scale * sv.ppi * sv.v.zoom * (sv.gm ? sv.cam.s : 1) * (window.devicePixelRatio || 1);
      const k = Math.max(0.25, Math.min(1, Math.round(disp * 8) / 8));
      const C = [((r.x + r.w / 2) - p.x) / p.scale, ((r.y + r.h / 2) - p.y) / p.scale];
      const Hc = (LEAN * 0.5 * Math.hypot(r.w, r.h)) / p.scale;
      const sig = JSON.stringify([w.colUrl, w.hmUrl, k, C.map((x) => Math.round(x)), Math.round(Hc), w.sun, p.x, p.y, p.scale]);
      if (sig === this.sig) return;
      this.sig = sig;
      const t0 = performance.now();
      const ow = Math.max(1, Math.round(p.nw * k)); const oh = Math.max(1, Math.round(p.nh * k));
      if (this.canvas.width !== ow || this.canvas.height !== oh) { this.canvas.width = ow; this.canvas.height = oh; }
      // drawn off screen in bands of rows (a breath in between: one huge draw can make a weak graphics card give up),
      // then shown at once
      if (!this.fb || this.fbW !== ow || this.fbH !== oh) {
        if (this.fb) { gl.deleteFramebuffer(this.fb); gl.deleteTexture(this.fbT); }
        this.fbT = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.fbT);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ow, oh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbT, 0);
        this.fbW = ow; this.fbH = oh;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.viewport(0, 0, ow, oh);
      gl.useProgram(this.prog);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tx = { colT: this.tex.c, hT: this.tex.h, mtl0: this.mats[0], mtl1: this.mats[1], mtl2: this.mats[2], mtl3: this.mats[3], mtl4: this.mats[4] };
      let unit = 0;
      for (const [name, t] of Object.entries(tx)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); if (this.u[name]) gl.uniform1i(this.u[name], unit); unit++; }
      const a = ((w.sun ?? 135) * Math.PI) / 180; const el = (40 * Math.PI) / 180;
      const U = this.u;
      gl.uniform2f(U.size, p.nw, p.nh); gl.uniform1f(U.outH, oh); gl.uniform1f(U.k, ow / p.nw);
      gl.uniform2f(U.C, C[0], C[1]); gl.uniform1f(U.Hc, Hc); gl.uniform1f(U.P, w.P);
      gl.uniform2f(U.org, w.org[0], w.org[1]);
      gl.uniform1fv(U.matSq, MATERIALS.slice(0, 5).map((m) => m.squares).concat([4, 4, 4, 4, 4]).slice(0, 5));
      gl.uniform3f(U.L, Math.cos(a) * Math.cos(el), -Math.sin(a) * Math.cos(el), Math.sin(el));
      // a band at a time, the next when the graphics card has done the last (a fence); bands grow while it keeps up
      gl.enable(gl.SCISSOR_TEST);
      for (let y = 0; y < oh;) {
        const band = Math.min(Math.max(8, Math.floor(this.budget / ow)), oh - y);
        gl.scissor(0, y, ow, band);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        y += band;
        if (y < oh) {
          const t0 = performance.now();
          const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
          for (let i = 0; i < 6000; i++) {
            const st = gl.clientWaitSync(f, 0, 0);
            if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED) break;
            await new Promise((r) => setTimeout(r, i < 4 ? 0 : 4));
            if (!this.gl || gl.isContextLost()) break;
          }
          if (this.gl && !gl.isContextLost()) gl.deleteSync(f);
          const ms = performance.now() - t0;
          if (ms < 15) this.budget = Math.min(this.budget * 2, 32e6); else if (ms > 300) this.budget = Math.max(40000, this.budget / 2);
          if (!this.gl || gl.isContextLost() || this.want !== w) { if (this.gl && !gl.isContextLost()) gl.disable(gl.SCISSOR_TEST); this.sig = ''; this.again = true; return; }
          // (nothing else draws with this context: what was bound stays bound)
        }
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, ow, oh, 0, 0, ow, oh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // it lies where the picture lies (the picture itself is hidden while this shows)
      const ppi = sv.ppi;
      Object.assign(this.canvas.style, { width: `${p.nw}px`, height: `${p.nh}px`, transform: `translate(${p.x * ppi}px, ${p.y * ppi}px) scale(${p.scale * ppi})` });
      this.stats = { renders: this.stats.renders + 1, ms: Math.round(performance.now() - t0), k };
      sv.depthShown(w.colUrl);
    }
    // a pixel of what is shown, for the self-test: [r, g, b, a] at a map point
    probe(x, y) {
      const w = this.want; if (!w || !this.gl) return null;
      const p = w.place; const k = this.canvas.width / p.nw;
      const px = Math.round(((x - p.x) / p.scale) * k); const py = Math.round(((y - p.y) / p.scale) * k);
      if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return null;
      const out = new Uint8Array(4); const gl = this.gl;
      gl.readPixels(px, this.canvas.height - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [...out];
    }
    dispose() {
      if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
      this.want = null; this.sig = '';
      this.canvas.remove();
      const gl = this.gl;
      if (gl && !gl.isContextLost()) {
        for (const t of [this.tex.c, this.tex.h, this.fbT, ...new Set(this.mats || [])]) if (t) gl.deleteTexture(t);
        if (this.fb) gl.deleteFramebuffer(this.fb);
        this.disposed = true;
        const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
      this.gl = null; this.tex = {}; this.mats = null; this.colUrl = null; this.hmUrl = null; this.fb = null; this.fbT = null;
      this.canvas.width = this.canvas.height = 0;
    }
  }
  return { create: (sv) => new Depth(sv), supported: gl2Ok, LEAN };
})();
