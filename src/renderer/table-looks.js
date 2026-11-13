// 4.4: the looks of a map change and of Talk, besides Ink (table.js, table-overlays.js):
//   Smoke      smoke rolls in from both long sides and clears again on the new map; Talk: portraits form out of smoke
//   Parchment  a sheet unrolls over the table, then rolls away (4.6.1: without the map's name); Talk: a parchment banner (4.5.1: without a name)
//   Embers     the old map burns away from the long sides, the new one burns through the char; Talk: warm firelight
//   Stone      (Prototype 9) two rock slabs grind in from the long sides and meet in a cloud of dust; Talk: a rock ledge
//   Meadow     (Prototype 9) tall grass grows in from the long sides, the wind blows leaves across; Talk: grass, drifting leaves
//   City       (Prototype 9) two heraldic banners with the crest slide in on brass rods; Talk: a banner of cloth
//   Winter     (Prototype 10) mist rolls in from the long sides, snow falls; Talk: a snow bank, mist, snowflakes. Christmas: night blue, warm lights
//   Sand       (Prototype 10) a sandstorm sweeps across from one end; Talk: a dune, blowing sand. Ash: grey ash falls, embers glow
//   Dungeon    (Prototype 27) two iron gates with a portcullis along their front slam shut from the long sides, sparks and dust; Talk: an iron ledge, chains on the wall behind, the shadows of bars
//   Necrotic   (Prototype 27) green mist creeps in from the long sides over heaps of bones, wisps rise; Talk: bones, mist, wisps, a green light from below
//   Forest     (Prototype 27) spruce and beech branches close over the table, needles and leaves fall; Talk: forest floor, the shadows of tall trunks, shafts of light.
//              Jungle: big leaves and lianas, petals and fireflies
// The first four are drawn here (canvas, CSS); the last three use pictures from looks/ (stone, grass, leaves, cloth, crest,
// planks). Their variants (Ice, Autumn, Slums) are CSS on <body data-v-map / data-v-talk>. The TV uses this; the GM's screen does not.
'use strict';

const Looks = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => 1 - (1 - u) ** 3; // out
  const easeIn = (u) => u * u;
  function rnd(seed) {
    let a = seed >>> 0 || 1;
    return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // Prototype 9: the pictures the region looks use, loaded once when first needed
  const pics = {};
  const pic = (name) => { if (!pics[name]) { const im = new Image(); im.src = `looks/${name}.webp`; pics[name] = im; } return pics[name]; };
  const ready = (im) => im && im.complete && im.naturalWidth > 0;
  const LEAVES = 11; // leaves.webp: 11 leaves side by side, 96 px each
  const GREEN = [0, 1, 2, 4, 6, 9, 10]; const BROWN = [3, 7, 8]; // (5 is a broken one)
  const leafSet = (autumn) => (autumn ? BROWN : GREEN);
  const PETALS = [0, 3, 5, 6, 7, 9, 10, 11]; // petals.webp: 12 cells of 96 px; these are whole (Prototype 27, the jungle)
  // a ragged edge (a broken rock face) as a clip-path polygon: the top edge of a box, 0..100%
  function ragged(R, n, depth) {
    const pts = ['0% 100%'];
    for (let i = 0; i <= n; i++) pts.push(`${((i / n) * 100).toFixed(1)}% ${(R() * depth).toFixed(1)}%`);
    pts.push('100% 100%');
    return `polygon(${pts.join(', ')})`;
  }

  // ---------- textures, made once ----------
  // old paper: a warm base, darker blotches, fibres, grain, browned edges
  const paper = new Map();
  function parchment(w = 1024, h = 512) {
    const key = `${w}x${h}`;
    if (paper.has(key)) return paper.get(key);
    const c = canvas(w, h); const g = c.getContext('2d');
    const R = rnd(7331);
    g.fillStyle = '#d9c49a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { // blotches
      const x = R() * w; const y = R() * h; const r = (0.04 + R() * 0.22) * Math.max(w, h);
      const dark = R() < 0.65;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, dark ? `rgba(120, 88, 45, ${0.05 + R() * 0.08})` : `rgba(255, 244, 214, ${0.05 + R() * 0.08})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 1400; i++) { // fibres
      const x = R() * w; const y = R() * h; const a = (R() - 0.5) * 0.6; const l = 4 + R() * 22;
      g.strokeStyle = `rgba(${R() < 0.5 ? '90, 64, 30' : '255, 248, 225'}, ${0.04 + R() * 0.07})`;
      g.lineWidth = 0.5 + R() * 1.1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const img = g.getImageData(0, 0, w, h); const d = img.data; // grain
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
    g.putImageData(img, 0, 0);
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75); // browned edges
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(92, 58, 22, 0.42)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    const url = c.toDataURL('image/jpeg', 0.86);
    paper.set(key, url);
    return url;
  }
  // a soft, ragged puff of smoke (a few variants)
  let puffs = null;
  const tonePuffs = new Map(); // (Prototype 10) the same puffs in other colours: snow, sand, ash
  function puffSprites(tone) {
    if (tone) {
      if (tonePuffs.has(tone.key)) return tonePuffs.get(tone.key);
      const list = [];
      for (let k = 0; k < 4; k++) {
        const S = 256; const c = canvas(S, S); const g = c.getContext('2d');
        const R = rnd(91 + k * 17);
        g.filter = 'blur(10px)';
        for (let i = 0; i < 16; i++) {
          const a = R() * TAU; const d = R() * S * 0.22; const x = S / 2 + Math.cos(a) * d; const y = S / 2 + Math.sin(a) * d;
          const r = S * (0.14 + R() * 0.16); const v = (R() - 0.5) * tone.vary;
          const col = `${Math.round(tone.rgb[0] + v)}, ${Math.round(tone.rgb[1] + v)}, ${Math.round(tone.rgb[2] + v)}`;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, `rgba(${col}, ${tone.a})`); gr.addColorStop(1, `rgba(${col}, 0)`);
          g.fillStyle = gr; g.fillRect(0, 0, S, S);
        }
        list.push(c);
      }
      tonePuffs.set(tone.key, list);
      return list;
    }
    if (puffs) return puffs;
    puffs = [];
    for (let k = 0; k < 4; k++) {
      const S = 256; const c = canvas(S, S); const g = c.getContext('2d');
      const R = rnd(91 + k * 17);
      g.filter = 'blur(10px)';
      for (let i = 0; i < 16; i++) {
        const a = R() * TAU; const d = R() * S * 0.22; const x = S / 2 + Math.cos(a) * d; const y = S / 2 + Math.sin(a) * d;
        const r = S * (0.14 + R() * 0.16); const l = 44 + Math.round(R() * 40); // grey smoke: it shows over dark maps too
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${l}, ${l + 2}, ${l + 6}, 0.9)`); gr.addColorStop(1, `rgba(${l}, ${l + 2}, ${l + 6}, 0)`);
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
      }
      puffs.push(c);
    }
    return puffs;
  }

  // =====================================================================
  // A map change: cover() resolves once the table is covered; reveal() takes it away again
  // =====================================================================
  function makeCover(host) {
    let el = null; let raf = 0; let run = null; let phase = 'idle'; let timer = 0;
    const stats = { runs: 0, covers: 0, reveals: 0, kind: null };
    const ensure = () => { if (!el) { el = document.createElement('div'); el.id = 'table-maplook'; host.after(el); } return el; };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    function finish() { stop(); phase = 'idle'; stats.reveals++; if (el) { el.className = ''; el.innerHTML = ''; } run = null; }

    // ---- smoke (canvas, half resolution: smoke is soft anyway) ----
    function smoke() {
      const W = Math.round(innerWidth / 2); const H = Math.round(innerHeight / 2);
      const c = canvas(W, H); c.className = 'ml-canvas';
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const sp = puffSprites();
      const list = [];
      for (let i = 0; i < 110; i++) {
        const far = i % 2 === 1;
        const x0 = R() * W; const yEdge = far ? -H * 0.15 : H * 1.15;
        const y1 = far ? R() * H * 0.66 : H - R() * H * 0.66;
        list.push({ x0, y0: yEdge, x1: x0 + (R() - 0.5) * W * 0.18, y1, d: R() * 0.38, r0: H * 0.08, r1: H * (0.24 + R() * 0.2), s: sp[i % sp.length], rot: R() * TAU, spin: (R() - 0.5) * 0.6, far });
      }
      const draw = (p, out) => {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, W, H);
        // under the puffs, a dark fill makes sure nothing shows while the maps swap
        const fill = out ? 1 - clamp(p / 0.35, 0, 1) : clamp((p - 0.72) / 0.28, 0, 1);
        if (fill > 0) { g.globalAlpha = fill; g.fillStyle = '#2a2d33'; g.fillRect(0, 0, W, H); }
        for (const q of list) {
          let x; let y; let r; let a;
          if (!out) {
            const u = ease(clamp((p - q.d) / (1 - q.d), 0, 1));
            x = q.x0 + (q.x1 - q.x0) * u; y = q.y0 + (q.y1 - q.y0) * u; r = q.r0 + (q.r1 - q.r0) * u; a = Math.min(1, u * 1.7) * 0.96;
          } else {
            const u = clamp(p * 1.15 - q.d * 0.3, 0, 1);
            const drift = easeIn(u) * H * 0.55 * (q.far ? -1 : 1);
            x = q.x1 + (q.x1 - W / 2) * u * 0.25; y = q.y1 + drift; r = q.r1 * (1 + u * 0.9); a = (1 - u) ** 1.4 * 0.96;
          }
          if (a <= 0.01) continue;
          g.globalAlpha = a;
          g.setTransform(1, 0, 0, 1, x, y); g.rotate(q.rot + q.spin * p);
          g.drawImage(q.s, -r, -r, r * 2, r * 2);
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
      };
      return { draw, coverMs: 1100, revealMs: 1700 };
    }

    // ---- embers (a burn mask at low resolution, sparks at full) ----
    function embers() {
      const W = innerWidth; const H = innerHeight;
      const gw = 256; const gh = Math.max(32, Math.round((gw * H) / W));
      const c = canvas(W, H); c.className = 'ml-canvas';
      const m = canvas(gw, gh); const mg = m.getContext('2d');
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      // value noise in a few octaves: where the fire runs ahead or lags behind
      const noise = (() => {
        const grids = [8, 16, 32].map((n) => { const a = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < a.length; i++) a[i] = R(); return { n, a }; });
        return (x, y) => {
          let v = 0; let wsum = 0; let w = 1;
          for (const { n, a } of grids) {
            const fx = x * n; const fy = y * n; const ix = Math.floor(fx); const iy = Math.floor(fy); const tx = fx - ix; const ty = fy - iy;
            const at = (i, j) => a[Math.min(n, j) * (n + 1) + Math.min(n, i)];
            const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
            const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx; const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
            v += (top + (bot - top) * sy) * w; wsum += w; w *= 0.5;
          }
          return v / wsum;
        };
      })();
      const Tin = new Float32Array(gw * gh); const Tout = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const fromEdge = Math.min(j, gh - 1 - j) / (gh / 2); // 0 at a long side, 1 in the middle
        const n = noise(i / gw, j / gh);
        Tin[j * gw + i] = clamp(fromEdge * 0.75 + n * 0.45 - 0.1, 0, 1);
        Tout[j * gw + i] = clamp((1 - fromEdge) * 0.7 + noise(1 - i / gw, j / gh + 0.37) * 0.5 - 0.1, 0, 1);
      }
      const img = mg.createImageData(gw, gh); const D = img.data;
      const sparks = [];
      const EDGE = 0.045; const COOL = 0.13;
      // one cell: burnt time e since the fire passed; cover: old map, edge, embers, char; reveal: char, edge, glow, the new map
      function shade(q, e, out) {
        let r = 0; let gg = 0; let b = 0; let a = 0;
        if (!out) {
          if (e < 0) { a = 0; } else if (e < EDGE) { const k = e / EDGE; r = 255; gg = 230 - k * 90; b = 120 - k * 90; a = 255; } else if (e < COOL) { const k = (e - EDGE) / (COOL - EDGE); r = 200 - k * 186; gg = 70 - k * 60; b = 14 - k * 6; a = 255; } else { r = 14; gg = 10; b = 8; a = 255; }
        } else if (e < 0) { r = 14; gg = 10; b = 8; a = 255; } else if (e < EDGE) { const k = e / EDGE; r = 255; gg = 210 - k * 80; b = 100 - k * 70; a = 255; } else if (e < COOL) { const k = (e - EDGE) / (COOL - EDGE); r = 230; gg = 90 - k * 50; b = 20; a = 255 * (1 - k) * 0.85; }
        D[q] = r; D[q + 1] = gg; D[q + 2] = b; D[q + 3] = a;
      }
      const draw = (p, out, dt) => {
        const P = p * 1.2; // the front passes every cell (T up to 1) and the embers cool behind it
        const T = out ? Tout : Tin;
        for (let k = 0, q = 0; k < T.length; k++, q += 4) {
          const e = P - T[k];
          shade(q, e, out);
          // sparks fly off the burning front
          if (e >= 0 && e < EDGE * 0.5 && R() < 0.012 && sparks.length < 420) {
            const x = ((k % gw) + R()) / gw * W; const y = (Math.floor(k / gw) + R()) / gh * H;
            const up = y < H / 2 ? 1 : -1; // towards the middle of the table (the fire runs that way)
            sparks.push({ x, y, vx: (R() - 0.5) * 60, vy: up * (40 + R() * 120), life: 0.5 + R() * 0.9, age: 0, r: 1 + R() * 2.4 });
          }
        }
        mg.putImageData(img, 0, 0);
        g.clearRect(0, 0, W, H);
        g.imageSmoothingEnabled = true;
        g.drawImage(m, 0, 0, W, H);
        g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(10px)'; g.globalAlpha = 0.55; g.drawImage(m, 0, 0, W, H); g.restore(); // the glow
        // sparks
        const step = Math.min(0.05, Math.max(0, dt || 0.016));
        g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.age += step; s.x += s.vx * step; s.y += s.vy * step; s.vx += (R() - 0.5) * 80 * step;
          if (s.age > s.life) { sparks.splice(i, 1); continue; }
          const a = 1 - s.age / s.life;
          g.globalAlpha = a; g.fillStyle = a > 0.6 ? '#ffe2a0' : '#ff8a2a';
          g.beginPath(); g.arc(s.x, s.y, s.r * (0.6 + a * 0.6), 0, TAU); g.fill();
        }
        g.restore();
        if (!out && p >= 1) { g.fillStyle = 'rgb(14, 10, 8)'; g.fillRect(0, 0, W, H); } // covered: nothing of the old map left
      };
      return { draw, coverMs: 1500, revealMs: 1700, tail: 500 };
    }

    // ---- parchment (DOM: two sheets unroll from the long sides; 4.6.1: no name on them) ----
    function parchmentRun(name) {
      const url = parchment(1024, 512);
      const esc = (t) => String(t || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      ensure().innerHTML = ['near', 'far'].map((side) => `<div class="pm-sheet ${side}" style="background-image:url(${url})"><div class="pm-name"></div><div class="pm-roll"></div></div>`).join('');
      return { dom: true, coverMs: 950, revealMs: 1000, hold: 650 };
    }

    // ---- Prototype 9: stone (DOM: two slabs with a broken edge grind in, dust where they meet) ----
    function stoneRun() {
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const dust = Array.from({ length: 26 }, (_, i) => `<i style="left:${((i / 25) * 104 - 2).toFixed(1)}%;--s:${(9 + R() * 12).toFixed(1)}vh;--dx:${((R() - 0.5) * 8).toFixed(1)}vh;--dy:${((R() - 0.5) * 10).toFixed(1)}vh;animation-delay:${(0.68 + R() * 0.14).toFixed(2)}s"></i>`).join('');
      // Prototype 10: the slabs' faces in one of two rocks, and boulders of the supplied rock pictures along the broken edge, every time others
      const rocks = () => { let x = -6; let out = ''; while (x < 104) { const h = 18 + R() * 16; out += `<img src="looks/rock${1 + Math.floor(R() * 4)}.webp" alt="" style="left:${x.toFixed(1)}%;height:${h.toFixed(1)}vh;margin-bottom:${(-h * (0.5 + R() * 0.18)).toFixed(1)}vh;transform:scaleX(${R() < 0.5 ? -1 : 1})">`; x += 9 + R() * 12; } return out; };
      const glints = () => Array.from({ length: 22 }, () => `<i style="left:${(R() * 100).toFixed(1)}%;top:${(R() * 100).toFixed(1)}%;animation-delay:${(R() * 2).toFixed(2)}s"></i>`).join('');
      ensure().innerHTML = ['near', 'far'].map((side) => `<div class="st-half ${side}"><div class="st-slab t${R() < 0.5 ? 1 : 2}" style="clip-path:${ragged(R, 28, 7)};background-position:${Math.round(R() * 100)}% ${Math.round(R() * 100)}%"></div><div class="st-rocks">${rocks()}</div><div class="st-glints">${glints()}</div></div>`).join('') + `<div class="st-dust">${dust}</div>`;
      return { dom: true, coverMs: 900, revealMs: 1050, hold: 450 };
    }
    // ---- Prototype 9: city (DOM: two banners of cloth with the crest slide in on their rods) ----
    function cityRun() {
      ensure().innerHTML = ['near', 'far'].map((side) => `<div class="ct-sheet ${side}"><div class="ct-trim"></div><div class="ct-crest"></div><div class="ct-rod"></div></div>`).join('');
      return { dom: true, coverMs: 950, revealMs: 1000, hold: 600 };
    }
    // ---- Prototype 27: deep dungeon (DOM: two iron gates, a portcullis along the front of each, slam shut; sparks and dust where they meet) ----
    function dungeonRun() {
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const sparks = Array.from({ length: 34 }, () => `<i style="left:${(R() * 100).toFixed(1)}%;--dx:${((R() - 0.5) * 16).toFixed(1)}vh;--dy:${((R() - 0.5) * 22).toFixed(1)}vh;--s:${(0.25 + R() * 0.45).toFixed(2)}vh;animation-delay:${(0.76 + R() * 0.1).toFixed(2)}s"></i>`).join('');
      const dust = Array.from({ length: 20 }, (_, i) => `<b style="left:${((i / 19) * 104 - 2).toFixed(1)}%;--s:${(8 + R() * 10).toFixed(1)}vh;--dx:${((R() - 0.5) * 8).toFixed(1)}vh;--dy:${((R() - 0.5) * 9).toFixed(1)}vh;animation-delay:${(0.78 + R() * 0.14).toFixed(2)}s"></b>`).join('');
      ensure().innerHTML = ['near', 'far'].map((side) => `<div class="dg-half ${side}"><div class="dg-door" style="background-position:${Math.round(R() * 100)}% ${Math.round(R() * 100)}%"></div><div class="dg-grate" style="background-position-x:${Math.round(R() * 100)}%"></div></div>`).join('')
        + `<div class="dg-sparks">${sparks}</div><div class="dg-dust">${dust}</div>`;
      return { dom: true, coverMs: 900, revealMs: 1100, hold: 500 };
    }

    // ---- Prototype 27: necrotic (canvas, half resolution: green mist from both long sides over heaps of bones, wisps rise) ----
    function necro() {
      const W = Math.round(innerWidth / 2); const H = Math.round(innerHeight / 2);
      const c = canvas(W, H); c.className = 'ml-canvas';
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const blood = document.body.dataset.vMap === 'bloodcrypt'; // (the red variant)
      const sp = puffSprites(blood ? { key: 'blood', rgb: [104, 20, 18], vary: 26, a: 0.9 } : { key: 'necro', rgb: [40, 84, 50], vary: 28, a: 0.9 });
      const fillCol = blood ? '#1c0b0b' : '#0f1b11';
      const soul = blood ? ['255, 214, 196', '255, 78, 54', '226, 36, 26', '#ff6248'] : ['190, 255, 205', '90, 240, 130', '60, 220, 110', '#6cf08c'];
      const tex = pic('crypt2'); let ground = null;
      if (ready(tex)) { const tc = canvas(384, 384); const tg = tc.getContext('2d'); tg.drawImage(tex, 0, 0, 384, 384); tg.fillStyle = blood ? 'rgba(46, 4, 4, 0.62)' : 'rgba(4, 20, 8, 0.6)'; tg.fillRect(0, 0, 384, 384); ground = g.createPattern(tc, 'repeat'); }
      let bones = pic('bones'); const off = R() * 1000;
      if (blood && ready(bones)) { // (warmer bones: the picture has a green cast)
        const bc = canvas(bones.naturalWidth >> 1, bones.naturalHeight >> 1); const bg = bc.getContext('2d');
        bg.filter = 'sepia(0.55) hue-rotate(-24deg) saturate(1.35) brightness(0.9)'; bg.drawImage(bones, 0, 0, bc.width, bc.height);
        bc.naturalWidth = bc.width; bc.naturalHeight = bc.height; bones = bc;
      }
      const strip = (y, hgt, flip) => {
        if (!bones || !bones.naturalWidth) return;
        const w = hgt * (bones.naturalWidth / bones.naturalHeight);
        g.save(); g.translate(0, y); if (flip) g.scale(1, -1);
        for (let x = -(off % w) - w; x < W + w; x += w) g.drawImage(bones, x, -hgt, w, hgt);
        g.restore();
      };
      const puffsL = [];
      for (let i = 0; i < 110; i++) {
        const far = i % 2 === 1; const x0 = R() * W;
        puffsL.push({ x0, y0: far ? -H * 0.15 : H * 1.15, x1: x0 + (R() - 0.5) * W * 0.18, y1: far ? R() * H * 0.66 : H - R() * H * 0.66, d: R() * 0.38, r0: H * 0.08, r1: H * (0.24 + R() * 0.2), s: sp[i % sp.length], rot: R() * TAU, spin: (R() - 0.5) * 0.8, far });
      }
      // souls: small lights that rise and waver, each with a short tail
      const wisps = Array.from({ length: 54 }, () => ({ x: R() * W, y: R() * H, r: H * (0.004 + R() * 0.008), v: H * (0.05 + R() * 0.11), ph: R() * TAU, f: 0.8 + R() * 1.6, far: R() < 0.5 }));
      let t = 0;
      const draw = (p, out, dt) => {
        const step = Math.min(0.05, Math.max(0, dt || 0.016)); t += step;
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, W, H);
        const fill = out ? 1 - clamp(p / 0.35, 0, 1) : clamp((p - 0.72) / 0.28, 0, 1);
        if (fill > 0) { g.globalAlpha = fill; g.fillStyle = ground || fillCol; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
        // the crypt floor and its bones grow in from both long sides
        const u = out ? 1 - easeIn(clamp(p * 1.1, 0, 1)) : ease(p);
        const reach = (H / 2 + H * 0.04) * u; const bh = H * 0.2;
        if (reach > 0) {
          g.fillStyle = ground || fillCol;
          g.fillRect(0, H - Math.max(0, reach - bh * 0.45), W, H); g.fillRect(0, 0, W, Math.max(0, reach - bh * 0.45));
          strip(H - reach + bh * 0.55, bh, false); strip(reach - bh * 0.55, bh, true);
        }
        for (const q of puffsL) {
          let x; let y; let r; let a;
          if (!out) {
            const k = ease(clamp((p - q.d) / (1 - q.d), 0, 1));
            x = q.x0 + (q.x1 - q.x0) * k; y = q.y0 + (q.y1 - q.y0) * k; r = q.r0 + (q.r1 - q.r0) * k; a = Math.min(1, k * 1.7);
          } else {
            const k = clamp(p * 1.15 - q.d * 0.3, 0, 1);
            x = q.x1 + (q.x1 - W / 2) * k * 0.25; y = q.y1 + easeIn(k) * H * 0.55 * (q.far ? -1 : 1); r = q.r1 * (1 + k * 0.9); a = (1 - k) ** 1.4;
          }
          a *= 0.32; // (thin over the bones)
          if (a <= 0.01) continue;
          g.globalAlpha = a;
          g.setTransform(1, 0, 0, 1, x, y); g.rotate(q.rot + q.spin * p);
          g.drawImage(q.s, -r, -r, r * 2, r * 2);
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        const all = out ? 1 - clamp((p - 0.5) / 0.5, 0, 1) : clamp(p / 0.3, 0, 1);
        g.globalCompositeOperation = 'lighter';
        for (const w of wisps) {
          // each side's souls rise toward the middle of the table (away from the players of that side)
          w.y += (w.far ? w.v : -w.v) * step; if (w.y < -8) w.y = H + 8; if (w.y > H + 8) w.y = -8;
          const x = w.x + Math.sin(t * w.f + w.ph) * W * 0.012;
          const a = all * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2 * w.f + w.ph)));
          if (a < 0.02) continue;
          const tail = w.r * 9 * (w.far ? -1 : 1);
          const gr = g.createRadialGradient(x, w.y, 0, x, w.y, w.r * 5);
          gr.addColorStop(0, `rgba(${soul[0]}, ${a})`); gr.addColorStop(0.3, `rgba(${soul[1]}, ${a * 0.5})`); gr.addColorStop(1, `rgba(${soul[2]}, 0)`);
          g.fillStyle = gr; g.fillRect(x - w.r * 5, w.y - w.r * 5, w.r * 10, w.r * 10);
          g.globalAlpha = a * 0.35; g.strokeStyle = soul[3]; g.lineWidth = w.r; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, w.y); g.lineTo(w.x + Math.sin((t - 0.25) * w.f + w.ph) * W * 0.012, w.y + tail); g.stroke();
          g.globalAlpha = 1;
        }
        g.globalCompositeOperation = 'source-over';
        if (!out && p >= 1) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = ground || fillCol; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; } // covered: nothing of the old map shows
      };
      return { draw, coverMs: 1400, revealMs: 1800 };
    }

    // ---- Prototype 27: forest and jungle (canvas, half resolution: branches reach in from both long sides and close like a canopy) ----
    //   forest   spruce and beech, needles and leaves fall
    //   jungle   palm fronds, big leaves and lianas; petals drift, fireflies
    function woods() {
      const W = Math.round(innerWidth / 2); const H = Math.round(innerHeight / 2);
      const c = canvas(W, H); c.className = 'ml-canvas';
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const jungle = document.body.dataset.vMap === 'jungle';
      const top = pic(jungle ? 'jcanopy' : 'canopy'); const bitsImg = pic(jungle ? 'petals' : 'leaves');
      const set = jungle ? PETALS : GREEN;
      const dark = jungle ? '#08160c' : '#0b150a'; const mid = jungle ? '#12301a' : '#18280f';
      // three rows a side: the hindmost reaches furthest and is darkest (it is in the shade of the ones in front)
      const rows = [0, 1, 2].map((k) => ({ h: H * (0.5 - k * 0.07), lead: (2 - k) * H * 0.045, off: R() * W * 2, sway: 0.5 + R() * 0.8, shade: 0.5 + k * 0.25 }));
      const flock = Array.from({ length: jungle ? 22 : 26 }, () => ({ x: R() * W, y: R() * H, vx: W * (0.05 + R() * 0.12), vy: H * (0.1 + R() * 0.18) * (R() < 0.5 ? -1 : 1), s: H * (jungle ? 0.022 + R() * 0.024 : 0.018 + R() * 0.022), rot: R() * TAU, spin: (R() - 0.5) * 3.2, k: set[Math.floor(R() * set.length)], bob: R() * TAU }));
      const needles = jungle ? [] : Array.from({ length: 90 }, () => ({ x: R() * W, y: R() * H, v: H * (0.18 + R() * 0.3) * (R() < 0.5 ? -1 : 1), len: H * (0.006 + R() * 0.008), a: R() * TAU, spin: (R() - 0.5) * 5 }));
      const flies = jungle ? Array.from({ length: 34 }, () => ({ x: R() * W, y: R() * H, r: 0.8 + R() * 1.4, ph: R() * TAU, f: 0.5 + R() * 1.2 })) : [];
      let t = 0;
      const strip = (edge, row, far, sway) => {
        if (!ready(top)) return;
        const hgt = row.h; const w = hgt * (top.naturalWidth / top.naturalHeight);
        g.save();
        // the picture hangs from its upper edge: on the far side as it is, on the near side turned over
        if (far) g.translate(0, edge - hgt); else { g.translate(0, edge + hgt); g.scale(1, -1); }
        g.transform(1, 0, sway, 1, 0, 0);
        for (let x = -(row.off % w) - w; x < W + w; x += w) g.drawImage(top, x, 0, w, hgt);
        g.restore();
      };
      const draw = (p, out, dt) => {
        const step = Math.min(0.05, dt || 0.016); t += step;
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
        g.clearRect(0, 0, W, H);
        const u = out ? 1 - easeIn(p) : ease(p);
        const reach = (H / 2 + H * 0.05) * u; // how far the leaves' tips reach in from each long side
        // the deep shade behind the branches
        for (const far of [false, true]) {
          const solid = Math.max(0, reach - H * 0.2);
          const gr = g.createLinearGradient(0, far ? 0 : H, 0, far ? solid : H - solid);
          gr.addColorStop(0, dark); gr.addColorStop(1, mid);
          g.fillStyle = gr;
          if (far) g.fillRect(0, 0, W, solid); else g.fillRect(0, H - solid, W, solid);
        }
        const wind = Math.sin(t * 1.3) * 0.05 + (out ? p * 0.25 : 0);
        rows.forEach((row, k) => {
          const sway = wind * row.sway + Math.sin(t * 1.9 + k) * 0.02;
          // behind the foremost branches more of them, back to the edge of the table (in deeper shade): no bare ground shows
          for (let back = 2; back >= 0; back--) {
            const d = back * row.h * 0.62;
            if (back && reach + row.lead - d < -row.h * 0.2) continue;
            g.filter = `brightness(${(row.shade * (1 - back * 0.22)).toFixed(2)})`;
            const shift = back * row.h * 1.3; const r2 = { ...row, off: row.off + shift };
            strip(H - reach - row.lead + d, r2, false, sway);
            strip(reach + row.lead - d, r2, true, -sway);
          }
        });
        g.filter = 'none';
        const all = out ? 1 - clamp((p - 0.55) / 0.45, 0, 1) : clamp(p / 0.35, 0, 1);
        // needles rain off the branches (toward the middle from each side)
        if (needles.length) {
          g.strokeStyle = '#2f4a22'; g.lineCap = 'round'; g.lineWidth = Math.max(1, H * 0.0022);
          for (const n of needles) {
            n.y += n.v * step; n.a += n.spin * step;
            if (n.y > H + 6) n.y = -6; if (n.y < -6) n.y = H + 6;
            g.globalAlpha = all * 0.8;
            g.beginPath(); g.moveTo(n.x - Math.cos(n.a) * n.len, n.y - Math.sin(n.a) * n.len); g.lineTo(n.x + Math.cos(n.a) * n.len, n.y + Math.sin(n.a) * n.len); g.stroke();
          }
        }
        // leaves (the jungle: petals) tumble across
        if (ready(bitsImg)) {
          for (const L of flock) {
            L.x += L.vx * step * (out ? 1.4 : 1); L.y += L.vy * step * 0.5; L.rot += L.spin * step;
            if (L.x > W + L.s * 2) { L.x = -L.s * 2; L.y = R() * H; }
            if (L.y > H + L.s * 2) L.y = -L.s * 2; if (L.y < -L.s * 2) L.y = H + L.s * 2;
            const f = clamp((L.x + L.s * 2) / (W * 0.18), 0, 1) * clamp((W + L.s * 2 - L.x) / (W * 0.22), 0, 1);
            const a = all * f * f * 0.95;
            if (a < 0.02) continue;
            g.globalAlpha = a;
            g.setTransform(1, 0, 0, 1, L.x + Math.sin(t * 1.6 + L.bob) * W * 0.012, L.y); g.rotate(L.rot);
            g.drawImage(bitsImg, L.k * 96, 0, 96, 96, -L.s, -L.s, L.s * 2, L.s * 2);
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
        if (flies.length) {
          g.globalCompositeOperation = 'lighter';
          for (const f of flies) {
            const x = f.x + Math.sin(t * f.f + f.ph) * W * 0.03; const y = f.y + Math.cos(t * f.f * 0.8 + f.ph) * H * 0.04;
            const a = all * Math.max(0, Math.sin(t * 1.7 * f.f + f.ph)) ** 2;
            if (a < 0.03) continue;
            const gr = g.createRadialGradient(x, y, 0, x, y, f.r * 5);
            gr.addColorStop(0, `rgba(235, 255, 150, ${a})`); gr.addColorStop(0.35, `rgba(190, 240, 90, ${a * 0.4})`); gr.addColorStop(1, 'rgba(160, 220, 60, 0)');
            g.fillStyle = gr; g.fillRect(x - f.r * 5, y - f.r * 5, f.r * 10, f.r * 10);
          }
          g.globalCompositeOperation = 'source-over';
        }
        g.globalAlpha = 1;
        if (!out && p >= 1) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = mid; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; } // covered: nothing of the old map shows
      };
      return { draw, coverMs: 1400, revealMs: 1600 };
    }

    // ---- Prototype 9: meadow (canvas, half resolution: grass grows in from both long sides, leaves on the wind) ----
    function meadow() {
      const W = Math.round(innerWidth / 2); const H = Math.round(innerHeight / 2);
      const c = canvas(W, H); c.className = 'ml-canvas';
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const grass = pic('grass'); const leaves = pic('leaves');
      // the grass a little greener than the picture; Autumn: dry and orange, brown leaves, brown ground
      const autumn = document.body.dataset.vMap === 'autumn'; const set = leafSet(autumn);
      let tinted = null;
      if (ready(grass)) { tinted = canvas(grass.naturalWidth >> 1, grass.naturalHeight >> 1); const tg = tinted.getContext('2d'); tg.filter = autumn ? 'hue-rotate(-6deg) saturate(1.3) brightness(0.9)' : 'hue-rotate(38deg) saturate(0.9) brightness(0.92)'; tg.drawImage(grass, 0, 0, tinted.width, tinted.height); }
      const rows = [0, 1, 2].map((k) => ({ h: H * (0.34 - k * 0.06), off: R() * W, sway: 0.6 + R() * 0.8, shade: 0.55 + k * 0.22 }));
      const flock = Array.from({ length: 26 }, () => ({ x: R() * W, y: R() * H, v: W * (0.22 + R() * 0.3), s: H * (0.02 + R() * 0.025), rot: R() * TAU, spin: (R() - 0.5) * 4, k: set[Math.floor(R() * set.length)], bob: R() * TAU }));
      let t = 0;
      const strip = (y, hgt, flip, row, sway) => {
        if (!tinted) return;
        const w = hgt * (tinted.width / tinted.height);
        g.save();
        g.translate(0, y); if (flip) g.scale(1, -1);
        g.transform(1, 0, sway, 1, 0, 0); // the wind bends the tops
        for (let x = -((row.off) % w) - w; x < W + w; x += w) g.drawImage(tinted, x, -hgt, w, hgt);
        g.restore();
      };
      const draw = (p, out, dt) => {
        t += Math.min(0.05, dt || 0.016);
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
        const u = out ? 1 - easeIn(p) : ease(p); // how far the meadow reaches (1: it meets in the middle)
        const reach = (H / 2 + H * 0.06) * u;
        // the ground, dark green to gold
        for (const far of [false, true]) {
          const gr = g.createLinearGradient(0, far ? 0 : H, 0, far ? reach : H - reach);
          gr.addColorStop(0, autumn ? '#26150a' : '#1d2611'); gr.addColorStop(1, autumn ? '#4a3014' : '#3d4520');
          g.fillStyle = gr;
          if (far) g.fillRect(0, 0, W, Math.max(0, reach - H * 0.08)); else g.fillRect(0, H - Math.max(0, reach - H * 0.08), W, H);
        }
        g.globalAlpha = 1;
        // grass along the front of each side, three rows, the nearest brightest
        const wind = Math.sin(t * 1.7) * 0.08 + (out ? p * 0.35 : 0);
        rows.forEach((row, k) => {
          const sway = wind * row.sway + Math.sin(t * 2.3 + k) * 0.03;
          g.globalAlpha = row.shade;
          strip(H - reach + row.h * 0.55 + k * H * 0.02, row.h, false, row, sway);
          strip(reach - row.h * 0.55 - k * H * 0.02, row.h, true, row, -sway);
        });
        g.globalAlpha = 1;
        // leaves on the wind, left to right (more of them when it all blows away)
        // (Prototype 10: softer: they fade in and out, at the ends of their way and at the start and the end of the change)
        if (ready(leaves)) {
          const all = out ? 1 - clamp((p - 0.55) / 0.45, 0, 1) : clamp(p / 0.35, 0, 1);
          for (const L of flock) {
            L.x += L.v * Math.min(0.05, dt || 0.016) * (out ? 1.3 : 1); L.rot += L.spin * (dt || 0.016);
            if (L.x > W + L.s * 2) { L.x = -L.s * 2; L.y = R() * H; }
            const f = clamp((L.x + L.s * 2) / (W * 0.18), 0, 1) * clamp((W + L.s * 2 - L.x) / (W * 0.22), 0, 1);
            const a = all * f * f * 0.9;
            if (a < 0.02) continue;
            const y = L.y + Math.sin(t * 2 + L.bob) * H * 0.03;
            g.globalAlpha = a;
            g.setTransform(1, 0, 0, 1, L.x, y); g.rotate(L.rot);
            g.drawImage(leaves, L.k * 96, 0, 96, 96, -L.s, -L.s, L.s * 2, L.s * 2);
          }
          g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
        }
        if (!out && p >= 1) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = autumn ? '#33200e' : '#2b3318'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; } // covered: nothing of the old map shows
      };
      return { draw, coverMs: 1300, revealMs: 1500 };
    }

    // ---- Prototype 10: winter and sand (canvas, half resolution): puffs of mist or sand, and what the wind carries ----
    //   winter     mist rolls in from both long sides, snow falls; Christmas: a night-blue table, warm lights twinkle in the snow
    //   sand       a sandstorm sweeps in from one end, grains streak past, it blows on and away; Ash: grey ash falls, embers rise
    function weather(kind) {
      const W = Math.round(innerWidth / 2); const H = Math.round(innerHeight / 2);
      const c = canvas(W, H); c.className = 'ml-canvas';
      ensure().replaceChildren(c);
      const g = c.getContext('2d');
      const R = rnd(1 + Math.floor(Math.random() * 1e6));
      const v = document.body.dataset.vMap || '';
      const snow = kind === 'winter'; const xmas = snow && v === 'christmas'; const ash = !snow && v === 'ash';
      const tone = snow ? (xmas ? { key: 'xmas', rgb: [58, 72, 104], vary: 26, a: 0.88 } : { key: 'snow', rgb: [138, 150, 166], vary: 30, a: 0.85 }) // (a dark room: soft grey-blue mist, Christmas a night-blue one)
        : ash ? { key: 'ash', rgb: [86, 82, 80], vary: 30, a: 0.9 } : { key: 'sand', rgb: [196, 160, 106], vary: 34, a: 0.88 };
      const fillCol = xmas ? '#1f2a40' : snow ? '#6c7886' : ash ? '#2a2624' : '#9a7a48';
      const sp = puffSprites(tone);
      // Prototype 10: the supplied pictures: the ground under it all (snow, sand, ash), toned for a dark room; the snow bank (and the
      // Christmas garland on it) grows in from both long sides; big snowflakes drift among the small ones
      const texImg = pic(snow ? 'snow' : ash ? 'ashground' : 'sand');
      let ground = null;
      if (ready(texImg)) {
        const tc = canvas(384, 384); const tg = tc.getContext('2d');
        tg.drawImage(texImg, 0, 0, 384, 384);
        tg.fillStyle = xmas ? 'rgba(8, 14, 34, 0.72)' : snow ? 'rgba(16, 26, 42, 0.5)' : ash ? 'rgba(0, 0, 0, 0.15)' : 'rgba(40, 24, 8, 0.28)';
        tg.fillRect(0, 0, 384, 384);
        ground = g.createPattern(tc, 'repeat');
      }
      const bank = snow ? pic('snowbank') : null; const garland = xmas ? pic('garland') : null; const flakeImg = snow ? pic('flakes') : null;
      const bankOff = R() * 1000;
      const big = snow ? Array.from({ length: 22 }, () => ({ x: R() * W, y: R() * H, s: H * (0.012 + R() * 0.022), k: Math.floor(R() * 10), rot: R() * TAU, spin: (R() - 0.5) * 0.8, vy: H * (0.04 + R() * 0.07), ph: R() * TAU })) : [];
      const groundFill = (a) => { if (a <= 0) return; g.globalAlpha = a; g.fillStyle = ground || fillCol; g.fillRect(0, 0, W, H); g.globalAlpha = 1; };
      const strip = (im, y, hgt, flip, alpha) => {
        if (!ready(im) || alpha <= 0) return;
        const w = hgt * (im.naturalWidth / im.naturalHeight);
        g.save(); g.globalAlpha = alpha; g.translate(0, y); if (flip) g.scale(1, -1);
        for (let x = -(bankOff % w) - w; x < W + w; x += w) g.drawImage(im, x, -hgt, w, hgt);
        g.restore();
      };
      const puffsL = [];
      for (let i = 0; i < 110; i++) {
        if (snow) { // like smoke: from both long sides
          const far = i % 2 === 1; const x0 = R() * W;
          puffsL.push({ x0, y0: far ? -H * 0.15 : H * 1.15, x1: x0 + (R() - 0.5) * W * 0.18, y1: far ? R() * H * 0.66 : H - R() * H * 0.66, d: R() * 0.38, r0: H * 0.08, r1: H * (0.24 + R() * 0.2), s: sp[i % sp.length], rot: R() * TAU, spin: (R() - 0.5) * 0.4, far });
        } else { // from the left end, across
          const y = R() * H;
          puffsL.push({ x0: -W * (0.25 + R() * 0.5), y0: y, x1: R() * W * 1.08, y1: y + (R() - 0.5) * H * 0.2, d: R() * 0.3, r0: H * 0.1, r1: H * (0.24 + R() * 0.2), s: sp[i % sp.length], rot: R() * TAU, spin: (R() - 0.5) * 0.8 });
        }
      }
      // what the wind carries: snowflakes, grains of sand, flakes of ash; Christmas lights; embers over the ash
      const bits = Array.from({ length: snow ? 240 : ash ? 200 : 260 }, () => ({ x: R() * W, y: R() * H, r: snow ? 0.6 + R() * 1.8 : ash ? 0.6 + R() * 1.4 : 0.4 + R() * 0.8, vx: snow ? (R() - 0.3) * W * 0.04 : ash ? W * (0.02 + R() * 0.05) : W * (0.7 + R() * 0.9), vy: snow ? H * (0.06 + R() * 0.14) : ash ? H * (0.04 + R() * 0.08) : (R() - 0.5) * H * 0.05, len: snow || ash ? 0 : 6 + R() * 22, ph: R() * TAU, a: 0.35 + R() * 0.6 }));
      const lights = xmas ? Array.from({ length: 46 }, () => ({ x: R() * W, y: R() * H, r: 2.5 + R() * 6, col: ['255, 200, 110', '255, 90, 70', '120, 220, 140', '255, 230, 170'][Math.floor(R() * 4)], f: 0.8 + R() * 2.2, ph: R() * TAU })) : [];
      const sparks = ash ? Array.from({ length: 50 }, () => ({ x: R() * W, y: H * (0.3 + R() * 0.7), r: 0.8 + R() * 1.6, vy: -H * (0.05 + R() * 0.12), ph: R() * TAU })) : [];
      let t = 0;
      const draw = (p, out, dt) => {
        const step = Math.min(0.05, Math.max(0, dt || 0.016)); t += step;
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
        const fill = out ? 1 - clamp(p / 0.35, 0, 1) : clamp((p - 0.72) / 0.28, 0, 1);
        groundFill(fill);
        // the snow bank from both long sides, the snow behind it (Christmas: the garland along its edge)
        if (snow) {
          const u = out ? 1 - easeIn(clamp(p * 1.1, 0, 1)) : ease(p);
          const reach = (H / 2 + H * 0.04) * u; const bh = H * 0.3;
          if (reach > 0) {
            g.globalAlpha = 1; g.fillStyle = ground || fillCol;
            g.fillRect(0, H - Math.max(0, reach - bh * 0.5), W, H); g.fillRect(0, 0, W, Math.max(0, reach - bh * 0.5));
            strip(bank, H - reach + bh * 0.5, bh, false, xmas ? 0.75 : 0.95);
            strip(bank, reach - bh * 0.5, bh, true, xmas ? 0.75 : 0.95);
            if (garland) { strip(garland, H - reach + bh * 0.62, bh * 0.42, false, 1); strip(garland, reach - bh * 0.62, bh * 0.42, true, 1); }
          }
        }
        for (const q of puffsL) {
          let x; let y; let r; let a;
          if (!out) {
            const u = ease(clamp((p - q.d) / (1 - q.d), 0, 1));
            x = q.x0 + (q.x1 - q.x0) * u; y = q.y0 + (q.y1 - q.y0) * u; r = q.r0 + (q.r1 - q.r0) * u; a = Math.min(1, u * 1.7) * 0.94;
          } else {
            const u = clamp(p * 1.15 - q.d * 0.3, 0, 1);
            if (snow) { x = q.x1 + (q.x1 - W / 2) * u * 0.25; y = q.y1 + easeIn(u) * H * 0.55 * (q.far ? -1 : 1); } else { x = q.x1 + easeIn(u) * W * 1.3; y = q.y1; } // (sand blows on, the way it came)
            r = q.r1 * (1 + u * 0.9); a = (1 - u) ** 1.4 * 0.94;
          }
          if (snow) a *= 0.55; // (the mist thinner over the snow bank)
          if (a <= 0.01) continue;
          g.globalAlpha = a;
          g.setTransform(1, 0, 0, 1, x, y); g.rotate(q.rot + q.spin * p);
          g.drawImage(q.s, -r, -r, r * 2, r * 2);
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        const all = out ? 1 - clamp((p - 0.5) / 0.5, 0, 1) : clamp(p / 0.3, 0, 1); // (they fade in and out with the change)
        if (xmas) { // warm lights, twinkling, under the snow
          g.globalCompositeOperation = 'lighter';
          for (const L of lights) {
            const a = all * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * L.f + L.ph)));
            const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 2.2);
            gr.addColorStop(0, `rgba(${L.col}, ${a})`); gr.addColorStop(0.35, `rgba(${L.col}, ${a * 0.45})`); gr.addColorStop(1, `rgba(${L.col}, 0)`);
            g.fillStyle = gr; g.fillRect(L.x - L.r * 2.2, L.y - L.r * 2.2, L.r * 4.4, L.r * 4.4);
          }
          g.globalCompositeOperation = 'source-over';
        }
        g.fillStyle = snow ? '#ffffff' : ash ? '#9a9490' : '#f0d8a8'; g.strokeStyle = '#f0d8a8'; g.lineCap = 'round';
        for (const b of bits) {
          b.x += (b.vx + (snow ? Math.sin(t * 1.3 + b.ph) * W * 0.02 : 0)) * step; b.y += b.vy * step;
          if (b.y > H + 4) b.y = -4; if (b.y < -4) b.y = H + 4; if (b.x > W + 30) b.x = -30; if (b.x < -30) b.x = W + 30;
          const a = all * b.a; if (a < 0.02) continue;
          g.globalAlpha = a;
          if (b.len) { g.lineWidth = b.r; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - b.len, b.y - b.len * 0.04); g.stroke(); } else { g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); }
        }
        if (ready(flakeImg)) { // big snowflakes, turning slowly as they fall
          for (const f of big) {
            f.y += f.vy * step; f.rot += f.spin * step; if (f.y > H + f.s * 2) f.y = -f.s * 2;
            const x = f.x + Math.sin(t * 0.9 + f.ph) * W * 0.02;
            g.globalAlpha = all * 0.85; g.setTransform(1, 0, 0, 1, x, f.y); g.rotate(f.rot);
            g.drawImage(flakeImg, f.k * 96, 0, 96, 96, -f.s, -f.s, f.s * 2, f.s * 2);
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
        if (ash) {
          g.globalCompositeOperation = 'lighter';
          for (const s of sparks) {
            s.y += s.vy * step; s.x += Math.sin(t * 2 + s.ph) * W * 0.01 * step; if (s.y < -4) s.y = H + 4;
            g.globalAlpha = all * (0.5 + 0.5 * Math.sin(t * 3 + s.ph)); g.fillStyle = '#ff8a2a';
            g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
          }
          g.globalCompositeOperation = 'source-over';
        }
        g.globalAlpha = 1;
        if (!out && p >= 1) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = ground || fillCol; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; } // covered: nothing of the old map shows
      };
      return { draw, coverMs: snow ? 1300 : 1200, revealMs: 1800 };
    }

    function animate(r, out, done) {
      stop();
      const t0 = performance.now(); let last = t0;
      const dur = out ? r.revealMs + (r.tail || 0) : r.coverMs;
      const frame = (now) => {
        const p = clamp((now - t0) / (out ? r.revealMs : r.coverMs), 0, out ? 1 + (r.tail || 0) / r.revealMs : 1);
        r.draw(Math.min(p, 1), out, (now - last) / 1000);
        last = now;
        if (now - t0 >= dur) { raf = 0; done(); return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    function cover(kind, name) {
      if (phase === 'covering' || phase === 'covered') return run.coverP;
      clearTimeout(timer); stop();
      const r = kind === 'smoke' ? smoke() : kind === 'embers' ? embers() : kind === 'stone' ? stoneRun() : kind === 'city' ? cityRun() : kind === 'meadow' ? meadow() : kind === 'winter' || kind === 'sand' ? weather(kind)
        : kind === 'dungeon' ? dungeonRun() : kind === 'necro' ? necro() : kind === 'forest' ? woods() : parchmentRun(name); // (Prototype 27: dungeon, necro, forest)
      run = { r, kind };
      stats.runs++; stats.kind = kind;
      phase = 'covering';
      el.className = `on ${kind} in`;
      run.coverP = new Promise((resolve) => {
        const covered = () => { phase = 'covered'; stats.covers++; el.classList.add('full'); resolve(); };
        if (r.dom) timer = setTimeout(covered, r.coverMs + (r.hold || 0));
        else animate(r, false, covered);
      });
      return run.coverP;
    }
    function reveal() {
      if (phase !== 'covered' || !run) return;
      phase = 'revealing';
      el.className = `on ${run.kind} out`;
      if (run.r.dom) timer = setTimeout(finish, run.r.revealMs + 50);
      else animate(run.r, true, finish);
    }
    return { cover, reveal, debug: () => ({ phase, ...stats }) };
  }

  // =====================================================================
  // Talk: the band along each long side the portraits stand in, in one of the looks
  // =====================================================================
  function talkBand(look, w, hgt, seed) {
    const R = rnd(seed);
    if (look === 'smoke') {
      let blobs = '';
      for (let i = 0; i < 16; i++) {
        const x = (i / 15) * 110 - 5 + (R() - 0.5) * 6; const s = 22 + R() * 26;
        blobs += `<i style="left:${x.toFixed(1)}%;width:${s.toFixed(1)}vh;height:${s.toFixed(1)}vh;animation-delay:${(-R() * 14).toFixed(1)}s;animation-duration:${(10 + R() * 8).toFixed(1)}s"></i>`;
      }
      return `<div class="tb-smoke">${blobs}</div>`;
    }
    if (look === 'parchment') {
      // 4.5: the banner unrolls upward from a rod and rolls back down onto it when they leave
      return `<div class="tb-parch" style="background-image:url(${parchment(1024, 256)})"></div><div class="tb-roll"></div>`; // (4.5.1: no name: it gave away unknown NPCs and odd file names)
    }
    // Prototype 9: a rock ledge with a broken top edge, dust where it settles
    if (look === 'stone') {
      const dust = Array.from({ length: 14 }, (_, i) => `<i style="left:${((i / 13) * 100).toFixed(1)}%;--s:${(5 + R() * 6).toFixed(1)}vh;animation-delay:${(0.45 + R() * 0.2).toFixed(2)}s"></i>`).join('');
      const rock = (side) => `<img class="tb-rock ${side}" src="looks/rock${1 + Math.floor(R() * 4)}.webp" alt="" style="transform:scaleX(${R() < 0.5 ? -1 : 1})">`; // (Prototype 10: a boulder at each end, every time another)
      return `<div class="tb-stone t${R() < 0.5 ? 1 : 2}" style="clip-path:${ragged(R, 36, 26)};background-position:${Math.round(R() * 100)}% 50%"></div>${rock('l')}${rock('r')}<div class="tb-dust">${dust}</div>`;
    }
    // Prototype 9: tall grass the portraits stand in, swaying; leaves drift across
    if (look === 'meadow') {
      const set = leafSet(document.body.dataset.vTalk === 'autumn');
      const drift = Array.from({ length: 7 }, () => `<b style="--k:${set[Math.floor(R() * set.length)]};top:${(-40 + R() * 90).toFixed(0)}%;animation-delay:${(-R() * 12).toFixed(1)}s;animation-duration:${(9 + R() * 7).toFixed(1)}s;--r:${Math.round((R() - 0.5) * 720)}deg"></b>`).join('');
      return `<div class="tb-meadow"><div class="tb-grass back"></div><div class="tb-grass front"></div>${drift}</div>`;
    }
    // Prototype 9: a banner of cloth with gold trim and the crest at both ends, on a brass rod (it unrolls like the parchment)
    // Prototype 10: a snow bank, low mist, snowflakes (Christmas: a string of warm lights along the snow)
    if (look === 'winter') {
      const mist = Array.from({ length: 10 }, (_, i) => `<i style="left:${((i / 9) * 110 - 5).toFixed(1)}%;width:${(20 + R() * 22).toFixed(1)}vh;height:${(14 + R() * 12).toFixed(1)}vh;animation-delay:${(-R() * 14).toFixed(1)}s"></i>`).join('');
      const flakes = Array.from({ length: 46 }, () => `<b style="left:${(R() * 100).toFixed(1)}%;--s:${(0.25 + R() * 0.5).toFixed(2)}vh;--dx:${((R() - 0.5) * 6).toFixed(1)}vh;animation-delay:${(-R() * 9).toFixed(2)}s;animation-duration:${(6 + R() * 6).toFixed(1)}s"></b>`).join('');
      const big = Array.from({ length: 9 }, () => `<b class="f" style="left:${(R() * 100).toFixed(1)}%;--k:${Math.floor(R() * 10)};--s:${(2 + R() * 2.2).toFixed(1)}vh;--dx:${((R() - 0.5) * 8).toFixed(1)}vh;--r:${Math.round((R() - 0.5) * 360)}deg;animation-delay:${(-R() * 11).toFixed(2)}s;animation-duration:${(9 + R() * 6).toFixed(1)}s"></b>`).join('');
      const pos = `background-position-x:${Math.round(R() * 100)}%`;
      // (Prototype 10: the supplied snow bank and garland instead of the drawn ones)
      return `<div class="tb-winter">${mist}<div class="tb-snowbank" style="${pos}"></div><div class="tb-garland" style="${pos}"></div>${flakes}${big}</div>`;
    }
    // Prototype 10: a dune, sand blowing across (Ash: a grey heap, ash falling, a few embers)
    if (look === 'sand') {
      const streaks = Array.from({ length: 34 }, () => `<s style="top:${(-60 + R() * 150).toFixed(0)}%;width:${(2 + R() * 6).toFixed(1)}vh;animation-delay:${(-R() * 3).toFixed(2)}s;animation-duration:${(1.4 + R() * 1.6).toFixed(2)}s"></s>`).join('');
      const flakes = Array.from({ length: 36 }, () => `<b style="left:${(R() * 100).toFixed(1)}%;--s:${(0.2 + R() * 0.35).toFixed(2)}vh;--dx:${(R() * 8).toFixed(1)}vh;animation-delay:${(-R() * 9).toFixed(2)}s;animation-duration:${(7 + R() * 6).toFixed(1)}s"></b>`).join('');
      const sparks = Array.from({ length: 14 }, () => `<i style="left:${(R() * 100).toFixed(1)}%;animation-delay:${(-R() * 4).toFixed(2)}s;animation-duration:${(2.6 + R() * 2.6).toFixed(2)}s;--dx:${((R() - 0.5) * 8).toFixed(1)}vh;--s:${(0.2 + R() * 0.35).toFixed(2)}vh"></i>`).join('');
      return `<div class="tb-sand"><div class="tb-dunepic" style="background-position-x:${Math.round(R() * 100)}%"></div>${streaks}${flakes}${sparks}</div>`; // (Prototype 10: the supplied dune and ash heap)
    }
    // Prototype 27: an iron ledge with a portcullis along it (the chains on the wall behind are in talkBack, the shadows of bars in styles.css)
    if (look === 'dungeon') {
      const sparks = Array.from({ length: 10 }, () => `<i style="left:${(R() * 100).toFixed(1)}%;animation-delay:${(-R() * 6).toFixed(2)}s;animation-duration:${(3 + R() * 4).toFixed(2)}s;--dx:${((R() - 0.5) * 6).toFixed(1)}vh;--s:${(0.2 + R() * 0.3).toFixed(2)}vh"></i>`).join('');
      return `<div class="tb-dungeon"><div class="tb-iron" style="background-position:${Math.round(R() * 100)}% ${Math.round(R() * 100)}%"></div><div class="tb-grate" style="background-position-x:${Math.round(R() * 100)}%"></div>${sparks}</div>`;
    }
    // Prototype 27: heaps of bones on crypt stone, green mist, souls that rise
    if (look === 'necro') {
      const mist = Array.from({ length: 11 }, (_, i) => `<i style="left:${((i / 10) * 110 - 5).toFixed(1)}%;width:${(22 + R() * 24).toFixed(1)}vh;height:${(15 + R() * 13).toFixed(1)}vh;animation-delay:${(-R() * 14).toFixed(1)}s"></i>`).join('');
      const wisps = Array.from({ length: 26 }, () => `<b style="left:${(R() * 100).toFixed(1)}%;--s:${(0.35 + R() * 0.55).toFixed(2)}vh;--dx:${((R() - 0.5) * 7).toFixed(1)}vh;animation-delay:${(-R() * 8).toFixed(2)}s;animation-duration:${(5 + R() * 5).toFixed(1)}s"></b>`).join('');
      return `<div class="tb-necro">${mist}<div class="tb-bones" style="background-position-x:${Math.round(R() * 100)}%"></div>${wisps}</div>`;
    }
    // Prototype 27: the forest floor (moss, ferns, roots), leaves drifting down, dust in the light; the jungle: undergrowth, petals, fireflies
    // (the shadows of the trunks and the shafts of light are in styles.css: they lie behind the portraits)
    if (look === 'forest') {
      const jungle = document.body.dataset.vTalk === 'jungle';
      const set = jungle ? PETALS : GREEN;
      const drift = Array.from({ length: jungle ? 6 : 8 }, () => `<b style="--k:${set[Math.floor(R() * set.length)]};left:${(R() * 100).toFixed(1)}%;animation-delay:${(-R() * 14).toFixed(1)}s;animation-duration:${(10 + R() * 8).toFixed(1)}s;--dx:${((R() - 0.5) * 22).toFixed(1)}vh;--r:${Math.round((R() - 0.5) * 540)}deg"></b>`).join('');
      const motes = Array.from({ length: jungle ? 22 : 18 }, () => `<i style="left:${(R() * 100).toFixed(1)}%;bottom:${(20 + R() * 260).toFixed(0)}%;--s:${(0.22 + R() * 0.3).toFixed(2)}vh;--dx:${((R() - 0.5) * 9).toFixed(1)}vh;--dy:${((R() - 0.5) * 7).toFixed(1)}vh;animation-delay:${(-R() * 9).toFixed(2)}s;animation-duration:${(5 + R() * 6).toFixed(1)}s"></i>`).join('');
      const pos = `background-position-x:${Math.round(R() * 100)}%`;
      return `<div class="tb-forest${jungle ? ' j' : ''}"><div class="tb-floor back" style="background-position-x:${Math.round(R() * 100)}%"></div><div class="tb-floor front" style="${pos}"></div>${drift}${motes}</div>`;
    }
    if (look === 'city') return '<div class="tb-cloth"><i class="l"></i><i class="r"></i></div><div class="tb-roll tb-brass"></div>';
    if (look === 'embers') {
      let sparks = '';
      for (let i = 0; i < 46; i++) {
        sparks += `<i style="left:${(R() * 100).toFixed(1)}%;animation-delay:${(-R() * 4).toFixed(2)}s;animation-duration:${(2.2 + R() * 2.6).toFixed(2)}s;--dx:${((R() - 0.5) * 8).toFixed(1)}vh;--s:${(0.25 + R() * 0.45).toFixed(2)}vh"></i>`;
      }
      return `<div class="tb-embers"><div class="tb-glow"></div>${sparks}</div>`;
    }
    return null;
  }

  // =====================================================================
  // Prototype 27: what stands behind the portraits. Forest: the silhouettes of tall spruces and beeches, in two depths
  // (the far ones paler, as in haze). Jungle: giants with broad crowns, palms and hanging lianas. Drawn new for every talk.
  // =====================================================================
  function talkBack(look, w, hgt, seed) {
    if (!(w > 0) || !(hgt > 0)) return null;
    const R = rnd((seed ^ 0x5f3759df) >>> 0);
    // Deep dungeon: chains on the wall behind the portraits, two at each end. Each hangs from a wall plate, ends in a ring just above the ledge and swings a little
    if (look === 'dungeon') {
      const one = (side, at, len) => `<b class="tb-hang" style="${side}:${at.toFixed(1)}%;--len:${len.toFixed(2)}"><i style="animation-duration:${(4.6 + R() * 2.6).toFixed(2)}s;animation-delay:${(-R() * 6).toFixed(2)}s"></i></b>`;
      const pair = (side) => { const long = R() < 0.5; return one(side, -1 + R() * 1.2, long ? 0.62 + R() * 0.1 : 0.42 + R() * 0.1) + one(side, 5.5 + R() * 2, long ? 0.4 + R() * 0.1 : 0.6 + R() * 0.12); };
      return `<div class="tb-wall">${pair('left')}${pair('right')}</div>`;
    }
    if (look !== 'forest') return null;
    const jungle = document.body.dataset.vTalk === 'jungle';
    const f = (v) => v.toFixed(1);
    // a spruce: a narrow crown of many drooping, ragged tiers down to a short bare trunk
    const spruce = (x, hh, ww) => {
      const top = hgt - hh; const n = 13 + Math.floor(R() * 7); const foot = hgt - hh * 0.06; const step = (foot - top) / n;
      const L = []; const Rt = [];
      for (let i = 1; i <= n; i++) {
        const k = i / n; const y = top + (foot - top) * k; const half = ww * 0.5 * (0.06 + 0.94 * k ** 0.9);
        const l = half * (0.72 + R() * 0.5); const r = half * (0.72 + R() * 0.5);
        // each tier: out to a drooping tip, a small notch, back in under it
        L.push(`${f(x - l * 0.7)},${f(y - step * 0.05)} ${f(x - l)},${f(y + step * (0.3 + R() * 0.3))} ${f(x - l * 0.62)},${f(y + step * 0.12)} ${f(x - l * 0.34)},${f(y + step * 0.02)}`);
        Rt.unshift(`${f(x + r * 0.34)},${f(y + step * 0.02)} ${f(x + r * 0.62)},${f(y + step * 0.12)} ${f(x + r)},${f(y + step * (0.3 + R() * 0.3))} ${f(x + r * 0.7)},${f(y - step * 0.05)}`);
      }
      const tw = ww * 0.06;
      return `<polygon points="${f(x)},${f(top)} ${L.join(' ')} ${f(x - tw)},${f(foot)} ${f(x - tw * 1.5)},${f(hgt)} ${f(x + tw * 1.5)},${f(hgt)} ${f(x + tw)},${f(foot)} ${Rt.join(' ')}"/>`;
    };
    // a beech (the jungle: a giant): a trunk that flares at the foot and forks, limbs, a crown of many small rounds in a few clumps
    const broad = (x, hh, ww) => {
      const tw = ww * (jungle ? 0.1 : 0.075); const fork = hgt - hh * (0.4 + R() * 0.12); const lean = (R() - 0.5) * ww * 0.14; const flare = jungle ? 2.4 : 1.6;
      let out = `<path d="M${f(x - tw * flare)},${f(hgt)} Q${f(x - tw * 0.7)},${f(hgt - hh * 0.07)} ${f(x - tw * 0.6 + lean * 0.4)},${f((hgt + fork) / 2)} L${f(x - tw * 0.42 + lean)},${f(fork)} L${f(x + tw * 0.42 + lean)},${f(fork)} L${f(x + tw * 0.6 + lean * 0.4)},${f((hgt + fork) / 2)} Q${f(x + tw * 0.7)},${f(hgt - hh * 0.07)} ${f(x + tw * flare)},${f(hgt)} Z"/>`;
      const cy = hgt - hh * 0.74; const clumps = 5 + Math.floor(R() * 4);
      for (let c = 0; c < clumps; c++) {
        const a = -Math.PI * (0.02 + 0.96 * ((c + R() * 0.8) / clumps)); const d = 0.45 + R() * 0.55;
        const cx = x + lean + Math.cos(a) * d * ww * 0.44; const ccy = cy + Math.sin(a) * d * hh * 0.2 + (R() - 0.3) * hh * 0.08;
        // the limb that carries this clump
        out += `<path d="M${f(x + lean)},${f(fork + hh * 0.02)} Q${f(x + lean + (cx - x - lean) * 0.25)},${f(fork - (fork - ccy) * 0.75)} ${f(cx)},${f(ccy)}" fill="none" stroke="currentColor" stroke-width="${f(tw * (0.75 - d * 0.3))}" stroke-linecap="round"/>`;
        const n = 6 + Math.floor(R() * 5);
        for (let i = 0; i < n; i++) {
          const b = R() * TAU; const e = Math.sqrt(R());
          out += `<ellipse cx="${f(cx + Math.cos(b) * e * ww * 0.15)}" cy="${f(ccy + Math.sin(b) * e * hh * 0.075)}" rx="${f(ww * (0.045 + R() * 0.06))}" ry="${f(hh * (0.022 + R() * 0.03))}"/>`;
        }
      }
      return out;
    };
    // a palm: a leaning trunk, fronds that arch out and droop
    const palm = (x, hh, ww) => {
      const lean = (R() - 0.5) * ww * 0.5; const tx = x + lean; const ty = hgt - hh; const tw = ww * 0.05;
      let out = `<path d="M${f(x)},${f(hgt)} Q${f(x + lean * 0.15)},${f(hgt - hh * 0.55)} ${f(tx)},${f(ty)}" fill="none" stroke="currentColor" stroke-width="${f(tw * 2)}" stroke-linecap="round"/>`;
      const n = 8 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * (0.06 + (i / (n - 1)) * 0.88) + (R() - 0.5) * 0.18; const len = ww * (0.42 + R() * 0.2);
        const ex = tx + Math.cos(a) * len; const ey = ty + Math.sin(a) * len * 0.55 + len * 0.42; // (the tip droops)
        const mx = tx + Math.cos(a) * len * 0.55; const my = ty + Math.sin(a) * len * 0.75;
        out += `<path d="M${f(tx)},${f(ty)} Q${f(mx)},${f(my - len * 0.16)} ${f(ex)},${f(ey)} Q${f(mx)},${f(my + len * 0.1)} ${f(tx)},${f(ty)} Z"/>`;
      }
      return out;
    };
    const liana = (x, len) => `<path d="M${f(x)},0 Q${f(x + (R() - 0.5) * hgt * 0.08)},${f(len * 0.6)} ${f(x + (R() - 0.5) * hgt * 0.05)},${f(len)}" fill="none" stroke="currentColor" stroke-width="${f(Math.max(1.5, hgt * 0.006))}" stroke-linecap="round"/>`;
    // two depths; the trees spread along the TV, each a little off its place
    const row = (count, hMin, hMax, wide) => {
      let out = '';
      for (let i = 0; i < count; i++) {
        const x = ((i + 0.5 + (R() - 0.5) * 0.7) / count) * w; const hh = hgt * (hMin + R() * (hMax - hMin));
        const pick = R();
        out += jungle ? (pick < 0.45 ? palm(x, hh, hh * wide * 1.15) : broad(x, hh, hh * wide * 1.5)) : (pick < 0.6 ? spruce(x, hh, hh * wide) : broad(x, hh, hh * wide * 1.35));
      }
      return out;
    };
    // (the near ones are taller than the band: mostly trunks and low branches show, their crowns are lost in the dark above)
    const far = row(Math.max(6, Math.round(w / (hgt * 0.36))), 0.5, 0.86, 0.3);
    const near = row(Math.max(3, Math.round(w / (hgt * 0.75))), 1.15, 1.8, 0.3);
    const lianas = jungle ? Array.from({ length: 9 }, () => liana(R() * w, hgt * (0.25 + R() * 0.5))).join('') : '';
    return `<svg class="tb-trees${jungle ? ' j' : ''}" viewBox="0 0 ${Math.round(w)} ${Math.round(hgt)}" preserveAspectRatio="none" aria-hidden="true"><g class="far">${far}</g><g class="near">${near}${lianas}</g></svg>`;
  }

  const preload = () => { for (const n of ['grass', 'leaves', 'rock1', 'rock2', 'rock3', 'rock4', 'snow', 'snowbank', 'flakes', 'garland', 'sand', 'ashground', 'canopy', 'jcanopy', 'petals', 'bones', 'crypt2']) pic(n); };
  return { makeCover, talkBand, talkBack, parchment, preload, debug: () => ({ paper: paper.size, puffs: puffs ? puffs.length : 0 }) };
})();
