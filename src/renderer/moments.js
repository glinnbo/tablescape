// Screen moments: short effects over the whole TV, played with one click like the soundboard
// (Toolbox → Moments). Earthquake, poison gas, blood, an explosion, dread, frost, holy light,
// madness, time stop, a dragon's roar, a natural 20.
//
// main.js keeps the moments that are playing: { key, id, seed, x, y (map inches, or null for the
// whole table), mapId, t0, dur (ms, or null until stopped), stop (ms when stopped) }. Both windows
// draw them from that list, so the GM sees what the players see. Like the other effects, every
// particle is a function of time and its index: nothing builds up, both windows agree.
// Drawing units are table inches (like the weather); a moment at a spot is placed through the map.
//
// The definitions are shared with the main process (durations, sounds); the drawing only runs in
// the windows.
'use strict';

(function (root) {
  const TAU = Math.PI * 2;
  const fract = (x) => x - Math.floor(x);
  const hs = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (u) => 1 - (1 - clamp(u, 0, 1)) ** 3;
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  // smooth noise 0..1 along a line
  const vnoise = (x, seed) => { const i = Math.floor(x); const f = smooth(x - i); return hs(i * 1.31 + seed) * (1 - f) + hs((i + 1) * 1.31 + seed) * f; };

  // dur: how long it plays (ms); null: until stopped. spot: can be placed on the map.
  // words: a sound in Audio/SFX with one of these in its name plays with it (else the built-in one)
  const LIST = [
    { id: 'earthquake', label: 'Earthquake', icon: 'wave-saw-tool', dur: 4200, spot: false, tip: 'The map shakes, dust falls', words: ['earthquake', 'quake', 'rumble', 'tremor'] },
    { id: 'explosion', label: 'Explosion', icon: 'bomb', dur: 4000, spot: true, tip: 'A white flash, a shockwave and embers', words: ['explosion', 'explode', 'blast', 'boom', 'bomb'] },
    { id: 'blood', label: 'Blood splatter', icon: 'droplets', dur: 6500, spot: true, cols: ['#8e1010', '#3f8a2a', '#1a1a1a', '#2a4f9a'], tip: 'Splats hit, drip, dry and fade', words: ['blood', 'splat', 'gore', 'squelch'] },
    { id: 'gas', label: 'Poison gas', icon: 'biohazard', dur: null, spot: true, cols: ['#80a03a', '#8a5cc4', '#b8a43c', '#3c3c38', '#b04a3c'], tip: 'Green gas pours in and hangs until you stop it', words: ['gas', 'hiss', 'poison', 'toxic'] },
    { id: 'lightning', label: 'Lightning', icon: 'bolt', dur: 1200, spot: false, tip: 'One flash, thunder follows', words: [] },
    { id: 'roar', label: 'Dragon roar', icon: 'dragon', dur: 3400, spot: false, tip: 'A hard shake and a fiery edge', words: ['dragon', 'roar'] },
    { id: 'dread', label: 'Dread', icon: 'activity-heartbeat', dur: null, spot: false, loopSound: true, tip: 'The light drains, a dark edge beats like a heart', words: ['heartbeat', 'heart', 'dread', 'fear'] },
    { id: 'frost', label: 'Frost', icon: 'snowflake', dur: null, spot: false, cols: ['#cfe6ff', '#bfffee', '#d8c8ff'], tip: 'Ice creeps in from the edges', words: ['frost', 'freeze', 'ice', 'cold'] },
    { id: 'holy', label: 'Holy light', icon: 'sun-high', dur: 4800, spot: true, cols: ['#ffe0a0', '#f4f6ff', '#9cc4ff', '#a8e09a'], tip: 'Golden rays and rising motes', words: ['holy', 'choir', 'angel', 'heaven', 'divine', 'bless'] },
    { id: 'madness', label: 'Madness', icon: 'spiral', dur: null, spot: false, cols: ['#461868', '#7a1a1a', '#1d5a3a', '#1c2f6e'], tip: 'Colours drift, ink crawls at the edges', words: ['whisper', 'madness', 'insanity', 'psychic', 'voices'] },
    { id: 'timestop', label: 'Time stop', icon: 'clock-pause', dur: null, spot: false, tip: 'Colours drain and every effect stands still', words: ['clock', 'tick', 'time'] },
    { id: 'nat20', label: 'Natural 20', icon: 'confetti', dur: 3200, spot: false, tip: 'Gold sparks burst across the table', words: ['fanfare', 'victory', 'success', 'tada', 'critical'] },
    // Beta 2
    { id: 'teleport', label: 'Teleport', icon: 'sparkle', dur: 2000, spot: true, cols: ['#a8b4ff', '#c79cff', '#8fe0b0', '#ffd27a', '#ff8a7a'], tip: 'Sparks pull inward and vanish in a flash: Misty Step, something appearing', words: ['teleport', 'blink', 'warp', 'shimmer'] },
    { id: 'puff', label: 'Smoke puff', icon: 'cloud', dur: 2400, spot: true, cols: ['#a8a6ac', '#3a3838', '#e8e6ea', '#8a5cc4', '#6fa04a'], tip: 'A puff of smoke: someone vanishes or appears', words: ['puff', 'poof', 'smoke', 'vanish'] },
    { id: 'lightsout', label: 'Lights out', icon: 'bulb-off', dur: null, spot: false, tip: 'Every light and flame gutters and dies, one by one; they catch again when you stop it', words: ['gust', 'wind', 'extinguish', 'lights out'] },
    { id: 'rockfall', label: 'Rockfall', icon: 'meteor', dur: 4500, spot: true, tip: 'Stones fall, dust bursts up, the ground jolts', words: ['rockfall', 'cave-in', 'collapse', 'rubble', 'rocks'] },
    { id: 'flood', label: 'Flood', icon: 'ripple-up', dur: 7500, spot: false, tip: 'A wave sweeps across the table and drains away', words: ['flood', 'wave', 'water', 'rush', 'tide'] },
    // Second Builder (second-birds): drawn by creatures.js
    { id: 'birds', label: 'Birds take flight', icon: 'feather', dur: 4200, spot: true, tip: 'A flock bursts up and flies off', words: ['birds', 'flock', 'wings', 'flap'] },
    { id: 'bats', label: 'Bat swarm', icon: 'bat', dur: 6500, spot: true, tip: 'Bats pour out and scatter', words: ['bats', 'bat', 'screech', 'flap'] }, // (second-bats-insects)
  ];
  const BY = Object.fromEntries(LIST.map((m) => [m.id, m]));
  const ROCK_HIT = 0.75; // seconds until the stones of a rockfall land
  const FADE_OUT = 1500; // ms a stopped moment takes to go

  // how strongly a moment shows right now: 0..1 (fades in, holds, fades out)
  function level(m, now) {
    const d = BY[m.id];
    const age = now - m.t0;
    if (age < 0) return 0;
    const inMs = { gas: 2500, frost: 1800, dread: 1400, madness: 1600, timestop: 500, lightsout: 1800 }[m.id] || 0;
    let k = inMs ? smooth(age / (inMs * ((m.o && m.o.len) || 1))) : 1;
    if (m.stop) k *= 1 - smooth((now - m.stop) / FADE_OUT);
    const dur = m.dur !== undefined ? m.dur : d && d.dur;
    if (dur && !m.stop) { const left = m.t0 + dur - now; if (left < 900) k *= smooth(left / 900); }
    return clamp(k, 0, 1);
  }
  const alive = (m, now) => { const d = BY[m.id]; if (!d) return false; if (m.stop) return now - m.stop < FADE_OUT; const dur = m.dur !== undefined ? m.dur : d.dur; return !dur || now - m.t0 < dur; };

  // ---------- what the whole picture does: shake, a colour filter, frozen effects ----------
  // returns { x, y } shake in table inches, a CSS filter, and the time effects stand still at (time stop)
  function screen(list, now) {
    let sx = 0; let sy = 0; const filters = []; let freeze = null;
    for (const m of list) {
      if (!alive(m, now)) continue;
      const age = (now - m.t0) / 1000;
      const k = level(m, now);
      const shake = (amp, dur, from = 0) => {
        const age = (now - m.t0) / 1000 - from;
        if (age < 0 || age > dur) return;
        const e = (age < 0.12 ? age / 0.12 : 1) * (1 - age / dur) ** 1.4 * amp * ((m.o && m.o.str) || 1); // (I8: Strength)
        sx += e * (Math.sin(age * 61 + m.seed) * 0.6 + Math.sin(age * 37.3 + m.seed * 1.7) * 0.4);
        sy += e * (Math.sin(age * 53 + m.seed * 2.3) * 0.6 + Math.sin(age * 29.1 + m.seed * 0.7) * 0.4);
      };
      if (m.id === 'earthquake') shake(0.3, 3.1);
      if (m.id === 'roar') shake(0.38, 2.2);
      if (m.id === 'explosion') shake(0.16, 0.8);
      if (m.id === 'rockfall') shake(0.1, 0.7, ROCK_HIT);
      if (m.id === 'dread') filters.push(`saturate(${(1 - 0.5 * k).toFixed(3)}) brightness(${(1 - 0.1 * k).toFixed(3)})`);
      if (m.id === 'madness') filters.push(`hue-rotate(${(Math.sin(age * 0.9 + m.seed) * 28 * k).toFixed(1)}deg) saturate(${(1 + 0.3 * k).toFixed(3)})`);
      if (m.id === 'timestop') { filters.push(`grayscale(${(0.85 * k).toFixed(3)}) contrast(${(1 + 0.06 * k).toFixed(3)})`); if (!m.stop) freeze = m.t0; }
      if (m.id === 'frost') filters.push(`saturate(${(1 - 0.25 * k).toFixed(3)})`);
    }
    return { x: sx, y: sy, filter: filters.length ? filters.join(' ') : '', freeze };
  }

  // ---------- drawing (windows only) ----------
  let Q = 1;
  const setQuality = (q) => { Q = q === 'low' ? 0.45 : q === 'medium' ? 0.7 : 1; };
  const sprites = new Map();
  function sprite(r, g, b, hard = 0) {
    const key = `${r},${g},${b},${hard}`;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    if (hard) gr.addColorStop(hard, `rgba(${r},${g},${b},0.85)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    sprites.set(key, c);
    return c;
  }
  function blob(ctx, img, x, y, r, a) {
    if (a <= 0.004 || r <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, x - r, y - r, 2 * r, 2 * r);
  }

  // ctx: transformed to table inches; W, H: the table in inches; at(m): where a spot moment is (table inches)
  function draw(ctx, W, H, list, now, at, { gm = false, sq = 1, lights = null } = {}) { // (second-birds: sq, table units in a grid square)
    for (const m of list) {
      if (!alive(m, now)) continue;
      const fn = DRAW[m.id];
      if (!fn) continue;
      const k = level(m, now) * (gm ? 0.75 : 1);
      if (k <= 0.003) continue;
      const p = m.x != null && at ? at(m) : null;
      ctx.save();
      const o = m.o || {}; const d = BY[m.id]; const str = o.str || 1; const len = o.len || 1;
      fn(ctx, { W, H, age: ((now - m.t0) / 1000) / (d.dur ? len : 1), k: k * (str < 1 ? str : 1 + (str - 1) * 0.6), str, col: o.col || null, slow: d.dur ? 1 : len, s: m.seed || 1, p, cx: p ? p.x : W / 2, cy: p ? p.y : H / 2, min: Math.min(W, H), sq, lights: m.id === 'lightsout' && lights ? lights() : null });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // an uneven blob outline (blood, gas edges)
  function lumpy(ctx, x, y, r, seed, n = 14, rough = 0.35) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const rr = r * (1 - rough / 2 + rough * hs(seed + (i % n) * 3.1));
      const px = x + Math.cos(a) * rr; const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else { const am = ((i - 0.5) / n) * TAU; const rm = r * (1 - rough / 2 + rough * hs(seed + i * 7.7)); ctx.quadraticCurveTo(x + Math.cos(am) * rm * 1.08, y + Math.sin(am) * rm * 1.08, px, py); }
    }
    ctx.closePath();
  }

  // ---------- I8 (Glinn: some effects were outdated): pictures and textures ----------
  // Glinn's frames (moments/: frost, its haze, dread, madness), the blood of the portraits (looks/blood/), stones cut
  // out of the rock tile, and soft clouds with a texture of their own for smoke, gas and dust
  const pics = new Map();
  function pic(src) {
    let e = pics.get(src);
    if (!e) { e = new Image(); e.decoding = 'async'; e.src = new URL(src, document.baseURI).href; pics.set(src, e); }
    return e.complete && e.naturalWidth ? e : null;
  }
  // a soft cloud, ragged at its edge and uneven inside (white; four of them)
  const clouds = [];
  function cloudTex(v) {
    if (clouds[v]) return clouds[v];
    const N = 128; const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'); const img = g.createImageData(N, N);
    const sd = 17 + v * 31;
    const vn2 = (x, y, f) => {
      const xi = Math.floor(x); const yi = Math.floor(y); const u = smooth(x - xi); const w = smooth(y - yi);
      const r = (i, j) => hs(i * 57.3 + j * 113.7 + sd * f);
      return (r(xi, yi) * (1 - u) + r(xi + 1, yi) * u) * (1 - w) + (r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u) * w;
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = ((x + 0.5) / N) * 2 - 1; const dy = ((y + 0.5) / N) * 2 - 1;
        const n = 0.5 * vn2(x / 22, y / 22, 1) + 0.3 * vn2(x / 10, y / 10, 2) + 0.2 * vn2(x / 5, y / 5, 3);
        const d = Math.hypot(dx, dy) + (n - 0.5) * 0.55;
        const a = clamp(1 - d, 0, 1) ** 1.6 * (0.55 + 0.6 * n);
        const o = (y * N + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * clamp(a, 0, 1));
      }
    }
    g.putImageData(img, 0, 0);
    return (clouds[v] = c);
  }
  // a white picture (or one with its own colours) in a colour, its transparency kept; made once
  const tintC = new Map();
  function tint(src, key, col, amount = 1) {
    const k = `${key}|${col}|${amount}`; const had = tintC.get(k);
    if (had) return had;
    const c = document.createElement('canvas'); c.width = src.naturalWidth || src.width; c.height = src.naturalHeight || src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.globalAlpha = amount; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    if (tintC.size > 80) tintC.delete(tintC.keys().next().value);
    tintC.set(k, c);
    return c;
  }
  function cloud(ctx, x, y, r, a, rot, col, v) {
    if (a <= 0.004 || r <= 0) return;
    const img = tint(cloudTex(v & 3), `cloud${v & 3}`, col);
    ctx.globalAlpha = Math.min(1, a);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(img, -r, -r, 2 * r, 2 * r); ctx.restore();
  }
  // a stone: cut out of the rock tile, lit from the top left (eight of them); grey lumps until the tile is there
  const stoneC = [];
  function stoneTex(v) {
    if (stoneC[v]) return stoneC[v];
    const tex = pic('tiles/rock-small.webp');
    if (!tex) return null;
    const N = 96; const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.translate(N / 2, N / 2);
    lumpy(g, 0, 0, N * 0.42, 31 + v * 17, 9, 0.5);
    g.save(); g.clip();
    const sw = tex.naturalWidth; const sh = tex.naturalHeight; const cut = Math.min(sw, sh) * 0.45;
    g.drawImage(tex, hs(v * 3.3) * (sw - cut), hs(v * 5.1) * (sh - cut), cut, cut, -N / 2, -N / 2, N, N);
    g.fillStyle = 'rgba(120,92,64,0.28)'; g.fillRect(-N / 2, -N / 2, N, N); // (warmer: the tile is a cold grey)
    const lit = g.createLinearGradient(-N * 0.4, -N * 0.4, N * 0.4, N * 0.4);
    lit.addColorStop(0, 'rgba(255,245,225,0.4)'); lit.addColorStop(0.5, 'rgba(0,0,0,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = lit; g.fillRect(-N / 2, -N / 2, N, N);
    g.restore();
    g.strokeStyle = 'rgba(20,16,12,0.75)'; g.lineWidth = 2.2; g.stroke();
    return (stoneC[v] = c);
  }
  function stone(ctx, x, y, r, rot, v, a) {
    if (a <= 0.004) return;
    const img = stoneTex(v & 7);
    ctx.globalAlpha = Math.min(1, a);
    if (!img) { ctx.fillStyle = '#5b544c'; lumpy(ctx, x, y, r, 31 + v * 17, 9, 0.5); ctx.fill(); return; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(img, -r * 1.19, -r * 1.19, r * 2.38, r * 2.38); ctx.restore();
  }
  // a stone's shadow on the ground (grows darker and smaller as it comes down)
  function shade(ctx, x, y, r, a) {
    if (a <= 0.004) return;
    ctx.globalAlpha = Math.min(1, a); ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.35, r, r * 0.8, 0, 0, TAU); ctx.fill();
  }
  // a crack in the ground: a jagged line from a point both ways, with forks; grow 0 … 1 draws it out
  function crack(ctx, x, y, ang, len, seed, grow, w, a) {
    if (grow <= 0 || a <= 0.004) return;
    const lines = [];
    const walk = (px, py, an, L, depth, salt, start) => {
      const n = depth ? 6 : 14; const pts = [[px, py]]; lines.push({ pts, depth, start });
      for (let i = 0; i < n; i++) {
        const na = an + (hs(salt + i * 1.7) - 0.5) * 0.9;
        const st = (L / n) * (0.6 + hs(salt + i * 2.9) * 0.8);
        px += Math.cos(na) * st; py += Math.sin(na) * st; pts.push([px, py]);
        if (depth < 2 && hs(salt + i * 3.3) > 0.72) walk(px, py, an + (hs(salt + i) > 0.5 ? 1 : -1) * (0.5 + hs(salt + i * 5) * 0.5), L * (0.22 + hs(salt + i * 7) * 0.25), depth + 1, salt * 1.37 + i + 1, start + ((1 - start) * (i + 1)) / n);
      }
    };
    walk(x, y, ang, len, 0, seed, 0);
    walk(x, y, ang + Math.PI + (hs(seed + 4) - 0.5) * 0.6, len * 0.6, 0, seed + 77, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [dx, col, wk] of [[0.025, 'rgba(210,195,170,', 0.45], [0, 'rgba(10,8,6,', 1]]) {
      for (const L of lines) {
        const u = clamp((grow - L.start) / (1 - L.start + 0.001), 0, 1);
        const m = Math.floor(u * (L.pts.length - 1));
        if (m < 1) continue;
        ctx.strokeStyle = `${col}${(a * (dx ? 0.35 : 0.9)).toFixed(3)})`;
        ctx.lineWidth = (w * wk) / (1 + L.depth * 1.3);
        ctx.beginPath();
        for (let i = 0; i <= m; i++) { const [px, py] = L.pts[i]; if (i) ctx.lineTo(px + dx, py + dx); else ctx.moveTo(px + dx, py + dx); }
        ctx.stroke();
      }
    }
  }
  // one of Glinn's frames over the whole table, d table inches beyond its edges (it creeps in as d shrinks)
  function frame(ctx, img, W, H, d, a) {
    if (!img || a <= 0.004) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, -d, -d, W + 2 * d, H + 2 * d);
  }
  // a soft ring (a shock wave, a sound wave): bright at r, fading to both sides over w
  function ring(ctx, cx, cy, r, w, col, a) {
    if (a <= 0.004 || r <= 0) return;
    const r0 = Math.max(0, r - w); const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r + w);
    const mid = (r - r0) / (r + w - r0);
    g.addColorStop(0, `${col}0)`); g.addColorStop(mid, `${col}${Math.min(1, a).toFixed(3)})`); g.addColorStop(1, `${col}0)`);
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r + w, 0, TAU); ctx.fill();
  }
  // how big a spot effect is: a number of grid squares, kept readable on any map
  const spotR = (P, squares, lo, hi) => clamp(squares * Math.sqrt(P.str || 1) * (P.sq || 1), lo, Math.min(hi, P.min * 0.4)); // (Strength: a bigger area too)
  // a colour, lighter (f > 0, towards white) or darker (f < 0); 'rgb(…)', or 'rgba(…,' to finish with an alpha
  const hexRgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function shadeCol(hex, f = 0, open = false) {
    const [r, g, b] = hexRgb(hex);
    const m = (c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
    return open ? `rgba(${m(r)},${m(g)},${m(b)},` : `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  const SHOW_20 = false;
  const OUT_FROST = 1.8; const OUT_DREAD = 2.2; // table inches the frames lie beyond the edges once in
  // the first version's tendrils: tapering ink that crawls in from the edges, breathes and sways
  function tendrils(ctx, P) {
    const { W, H, age, k, s } = P;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(14,4,22,${(0.85 * k).toFixed(3)})`;
    const tc = P.col || '#461868';
    ctx.strokeStyle = `${shadeCol(tc, 0.35, true)}${(0.45 * k).toFixed(3)})`;
    ctx.lineWidth = 0.05;
    ctx.shadowColor = `${shadeCol(tc, 0.25, true)}${(0.8 * k).toFixed(3)})`;
    ctx.shadowBlur = 12;
    const n = Math.round(26 * Q) + 6;
    for (let i = 0; i < n; i++) {
      const e = i % 4; const along = hs(s + i * 2.9) * (e < 2 ? W : H);
      const breathe = 0.5 + 0.5 * Math.sin(age * (0.7 + hs(i) * 0.6) + i);
      const len = (0.8 + hs(s + i * 4.1) * 2.2) * (0.6 + 0.4 * breathe) * ease(age / (2 * (P.slow || 1)));
      const w = 0.18 + hs(i * 6.7) * 0.25;
      const nx = e === 2 ? 1 : e === 3 ? -1 : 0; const ny = e === 0 ? 1 : e === 1 ? -1 : 0;
      const tx = ny !== 0 ? 1 : 0; const ty = nx !== 0 ? 1 : 0;
      const bx = e === 2 ? 0 : e === 3 ? W : along; const by = e === 0 ? 0 : e === 1 ? H : along;
      const left = []; const right = [];
      for (let j = 0; j <= 12; j++) {
        const t = j / 12;
        const sway = Math.sin(t * 5 + age * 1.6 + i) * 0.35 * t;
        const x = bx + nx * len * t + tx * sway; const y = by + ny * len * t + ty * sway;
        const ww = w * (1 - t * 0.92);
        left.push([x + tx * ww, y + ty * ww]); right.push([x - tx * ww, y - ty * ww]);
      }
      ctx.beginPath();
      left.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  const FIRE = ['rgb(255,250,225)', 'rgb(255,214,110)', 'rgb(255,150,45)', 'rgb(214,78,18)', 'rgb(120,34,10)'];

  const DRAW = {
    birds(ctx, P) { if (typeof Creatures === 'object') Creatures.burst(ctx, P, 'birds'); }, // (second-birds)
    bats(ctx, P) { if (typeof Creatures === 'object') Creatures.burst(ctx, P, 'bats'); }, // (second-bats-insects)
    // the ground cracks open in a few places, stones drop from above (their shadows first), dust bursts where they land
    earthquake(ctx, P) {
      const { W, H, age, k, s, min } = P;
      ctx.fillStyle = `rgba(0,0,0,${(0.16 * k * Math.max(0, 1 - age / 3) * (0.6 + 0.4 * Math.sin(age * 23 + s))).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      for (let i = 0; i < 3; i++) {
        const x = (0.2 + 0.6 * hs(s + i * 3.1)) * W; const y = (0.2 + 0.6 * hs(s + i * 4.7)) * H;
        crack(ctx, x, y, hs(s + i * 5.3) * TAU, min * (0.22 + 0.16 * hs(s + i * 6.1)), s + i * 19, ease((age - 0.15 - i * 0.35) / 0.9), 0.14, k);
      }
      const dust = 'rgb(196,182,158)';
      const n = Math.round(30 * Q);
      for (let i = 0; i < n; i++) {
        const land = 0.35 + hs(s + i * 1.3) * 2.2; const fall = 0.5;
        const x = hs(s + i * 3.7) * W; const y = hs(s + i * 5.9) * H; const r = 0.16 + hs(s + i * 2.3) * 0.26;
        const u = (age - land + fall) / fall;
        if (u < 0) continue;
        if (u < 1) { shade(ctx, x, y, r * (2.2 - 1.2 * u), 0.5 * u * u * k); continue; }
        const a = age - land;
        stone(ctx, x, y, r, hs(i * 7.1) * TAU, i, k);
        for (let j = 0; j < 3; j++) {
          const v = a / (1.1 + hs(i * 13 + j) * 0.6);
          if (v > 1) continue;
          const an = hs(s + i * 17 + j * 3.1) * TAU;
          cloud(ctx, x + Math.cos(an) * ease(v) * r * 3, y + Math.sin(an) * ease(v) * r * 3, r * (1.8 + ease(v) * 3.5), (1 - v) * 0.55 * k, an, dust, i + j);
        }
      }
      // dust shaken off the walls
      for (let i = 0; i < Math.round(10 * Q); i++) {
        const v = (age - hs(s + i * 9.1) * 1.8) / 1.8;
        if (v < 0 || v > 1) continue;
        const e = i % 4; const along = hs(s + i * 2.9);
        const x = e < 2 ? along * W : e === 2 ? 0.6 : W - 0.6; const y = e >= 2 ? along * H : e === 0 ? 0.6 : H - 0.6;
        cloud(ctx, x, y, 1 + ease(v) * 2.2, Math.sin(v * Math.PI) * 0.4 * k, i, dust, i);
      }
    },
    // a white flash; a ball of fire that boils up and turns to smoke; a shock wave and a ring of dust thrown out;
    // embers; a scorch mark that stays a while
    explosion(ctx, P) {
      const { W, H, age, k, s, cx, cy } = P;
      const R = spotR(P, 3, 2.2, 9);
      // the scorch mark, under all of it
      const sc = clamp((age - 0.12) / 0.3, 0, 1);
      if (sc > 0) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
        g.addColorStop(0, `rgba(8,6,4,${(0.8 * sc * k).toFixed(3)})`); g.addColorStop(0.55, `rgba(20,14,8,${(0.45 * sc * k).toFixed(3)})`); g.addColorStop(1, 'rgba(20,14,8,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; lumpy(ctx, cx, cy, R * 0.75, s, 18, 0.3); ctx.fill();
      }
      const flash = age < 0.06 ? 0.75 : Math.max(0, 0.75 * (1 - (age - 0.06) / 0.4));
      if (flash > 0) { ctx.globalAlpha = 1; ctx.fillStyle = `rgba(255,240,215,${(flash * k).toFixed(3)})`; ctx.fillRect(-1, -1, W + 2, H + 2); }
      // the dust thrown out along the ground
      for (let i = 0; i < Math.round(18 * Q); i++) {
        const v = age / (1.4 + hs(i * 2.1) * 0.6);
        if (v > 1) continue;
        const an = (i / 18) * TAU + hs(s + i) * 0.3;
        const d = R * (0.5 + ease(v) * 1.3);
        cloud(ctx, cx + Math.cos(an) * d, cy + Math.sin(an) * d, R * (0.25 + 0.3 * ease(v)), Math.sin(Math.PI * Math.min(1, v * 1.5)) * 0.35 * k, an, 'rgb(150,136,118)', i);
      }
      // the fireball: puffs that start white hot and cool through orange and red to smoke
      const n = Math.round(26 * Q) + 6;
      for (const pass of ['smoke', 'fire']) {
        ctx.globalCompositeOperation = pass === 'fire' ? 'lighter' : 'source-over';
        for (let i = 0; i < n; i++) {
          const born = hs(s + i * 1.1) * 0.14; const a0 = age - born;
          if (a0 < 0) continue;
          const an = hs(s + i * 2.3) * TAU; const far = Math.sqrt(hs(s + i * 3.7));
          const d = R * 0.55 * far * ease(a0 / 0.45) + a0 * 0.15 * R * far;
          const x = cx + Math.cos(an) * d; const y = cy + Math.sin(an) * d;
          const r = R * (0.2 + 0.22 * hs(i * 4.1)) * (0.45 + 0.75 * ease(a0 / 0.5) + a0 * 0.12);
          const heat = clamp(1 - a0 / (0.55 + hs(i * 5.3) * 0.5), 0, 1);
          const rot = an + a0 * (hs(i) - 0.5);
          if (pass === 'smoke') cloud(ctx, x, y, r * (1.35 + a0 * 0.25), (1 - heat) * clamp(1 - (a0 - 1.2) / 2.6, 0, 1) * 0.8 * k, rot, 'rgb(46,41,38)', i);
          else if (heat > 0) cloud(ctx, x, y, r, heat * 0.85 * k, rot, FIRE[Math.min(4, Math.floor((1 - heat) * 5))], i);
        }
      }
      { const c = Math.max(0, 1 - age / 0.5); if (c > 0) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6); g.addColorStop(0, `rgba(255,250,230,${(0.9 * c * k).toFixed(3)})`); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, TAU); ctx.fill(); } }
      ctx.globalCompositeOperation = 'source-over';
      // the shock wave
      ring(ctx, cx, cy, ease(age / 0.6) * R * 2.6, R * 0.25, 'rgba(255,236,200,', 0.4 * Math.max(0, 1 - age / 0.6) * k);
      // embers flying out, each a short streak
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < Math.round(70 * Q); i++) {
        const u = age / (1.3 + hs(i * 3.3) * 1.2);
        if (u > 1) continue;
        const an = hs(s + i * 1.7) * TAU; const v = (0.8 + hs(s + i * 2.9) * 2.2) * R;
        const d = (v * (1 - Math.exp(-age * 2.6))) / 2.6; const d0 = (v * (1 - Math.exp(-Math.max(0, age - 0.05) * 2.6))) / 2.6;
        ctx.globalAlpha = (1 - u) * k; ctx.strokeStyle = i % 3 ? '#ffb347' : '#ffe6a0'; ctx.lineWidth = 0.05 + hs(i) * 0.04;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * d0, cy + Math.sin(an) * d0); ctx.lineTo(cx + Math.cos(an) * d, cy + Math.sin(an) * d); ctx.stroke();
      }
    },
    // Glinn's blood: a big splat, a spray thrown one way, drops after it; they land one after another and darken
    blood(ctx, P) {
      const { W, H, age, k, s, p } = P;
      const pieces = [];
      const put = (x, y, f, size, turn, born) => pieces.push({ x, y, f, size, turn, born });
      const group = (x, y, R, dir, t0, salt) => {
        put(x + Math.cos(dir) * R * 0.9, y + Math.sin(dir) * R * 0.9, 'blood-spray', R * 2.6, dir, t0 + 0.05);
        put(x, y, hs(salt) < 0.5 ? 'blood-8' : 'blood-9', R * 1.3, hs(salt + 1) * TAU, t0);
        for (let j = 0; j < 3; j++) { const d = R * (1.2 + j * 0.55 + hs(salt + j) * 0.3); const sd = (hs(salt + j * 3) - 0.5) * 0.6; put(x + Math.cos(dir + sd) * d, y + Math.sin(dir + sd) * d, `blood-${Math.floor(hs(salt + j * 5) * 8)}`, R * (0.3 + hs(salt + j * 7) * 0.3), hs(salt + j * 9) * TAU, t0 + 0.1 + j * 0.06); }
      };
      if (p) group(p.x, p.y, spotR(P, 1.3, 1, 4), hs(s) * TAU, 0, s);
      else {
        // along the edges and in the corners, out of the middle where the minis stand
        for (let i = 0; i < 5; i++) {
          const e = hs(s + i * 7.3); const along = 0.1 + 0.8 * hs(s + i * 3.1); const band = 0.1 + hs(s + i * 5.5) * 0.12;
          const x = e < 0.5 ? along * W : e < 0.75 ? band * W : (1 - band) * W; const y = e < 0.25 ? band * H : e < 0.5 ? (1 - band) * H : along * H;
          group(x, y, 1.1 + hs(s + i * 9.1) * 0.9, Math.atan2(y - H / 2, x - W / 2) + (hs(s + i) - 0.5), i * 0.16, s + i * 13);
        }
      }
      const dry = clamp((age - 1.8) / 3.5, 0, 1);
      if (dry > 0.01) ctx.filter = `brightness(${(1 - 0.4 * dry).toFixed(3)})`;
      for (const q of pieces) {
        const u = (age - q.born) / 0.12;
        const im0 = pic(`looks/blood/${q.f}.webp`);
        if (u < 0 || !im0) continue;
        const img = P.col && P.col !== '#8e1010' ? tint(im0, q.f, P.col, 0.8) : im0;
        const sz = q.size * (1.18 - 0.18 * ease(u)); const ar = img.naturalHeight / img.naturalWidth;
        ctx.globalAlpha = Math.min(1, u) * 0.95 * k;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.turn); ctx.drawImage(img, -sz / 2, (-sz * ar) / 2, sz, sz * ar); ctx.restore();
      }
      ctx.filter = 'none';
    },
    // thick sickly gas, rolling in from the edges (or swelling from a spot), drifting and turning slowly
    gas(ctx, P) {
      const { W, H, age, k, s, p, min } = P;
      const base = P.col || '#80a03a';
      ctx.fillStyle = `${shadeCol(base, -0.3, true)}${(0.08 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const cols = [shadeCol(base), shadeCol(base, -0.22), shadeCol(base, 0.22)];
      const n = Math.round((p ? 46 : 90) * Q) + 8;
      const wx = Math.cos(hs(s + 0.5) * TAU) * 0.12; const wy = Math.sin(hs(s + 0.5) * TAU) * 0.12;
      for (let i = 0; i < n; i++) {
        const sw = (hs(i * 1.9) - 0.5) * 0.25;
        let x; let y; let r;
        if (p) {
          const R = Math.min(spotR(P, 4, 2.5, 9), spotR(P, 1.5, 1.2, 4) + age * 1.4);
          const a = hs(s + i * 2.3) * TAU + age * sw;
          const d = Math.sqrt(hs(s + i * 5.1)) * R;
          x = p.x + Math.cos(a) * d + wx * age; y = p.y + Math.sin(a) * d + wy * age;
          r = R * (0.35 + hs(i * 3.3) * 0.35);
        } else {
          const depth = Math.min(min * 0.3, 0.6 + (age / P.slow) * 0.8);
          const e = i % 4; const along = hs(s + i * 3.7);
          const inw = Math.sqrt(hs(s + i * 6.1)) * depth;
          const wob = Math.sin(age * (0.2 + Math.abs(sw)) + i) * 0.6;
          if (e === 0) { x = along * W + wob; y = inw; } else if (e === 1) { x = along * W + wob; y = H - inw; } else if (e === 2) { x = inw; y = along * H + wob; } else { x = W - inw; y = along * H + wob; }
          r = 1.6 + hs(i * 3.3) * 2.2;
        }
        cloud(ctx, x, y, r, (0.2 + hs(i * 7.7) * 0.14) * k, hs(i * 2.7) * TAU + age * sw, cols[i % 3], i);
      }
    },
    // the roar: the table shakes, waves of sound roll out, the edges glow like a furnace and embers fly in
    roar(ctx, P) {
      const { W, H, age, k, s } = P;
      const fade = Math.max(0, 1 - Math.max(0, age - 1.8) / 1.4);
      ctx.fillStyle = `rgba(0,0,0,${(0.22 * fade * k * Math.max(0, 1 - age / 1.2)).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const D = Math.hypot(W, H);
      for (let i = 0; i < 3; i++) { const v = (age - i * 0.28) / 1.3; if (v > 0 && v < 1) ring(ctx, W / 2, H / 2, ease(v) * D * 0.6, 1.6, 'rgba(255,180,120,', 0.16 * (1 - v) * k); }
      const pulse = 0.7 + 0.3 * Math.sin(age * 9);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, D * 0.55);
      g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(0.65, `rgba(200,50,10,${(0.22 * pulse * fade * k).toFixed(3)})`); g.addColorStop(1, `rgba(110,12,0,${(0.65 * pulse * fade * k).toFixed(3)})`);
      ctx.fillStyle = g; ctx.fillRect(-1, -1, W + 2, H + 2);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Math.round(22 * Q); i++) { // fire licking along the edges
        const e = i % 4; const along = hs(s + i * 3.1) * (e < 2 ? W : H);
        const x = e === 2 ? 0 : e === 3 ? W : along; const y = e === 0 ? 0 : e === 1 ? H : along;
        cloud(ctx, x, y, 1.4 + hs(i * 5) * 1.6, (0.25 + 0.2 * Math.sin(age * 7 + i)) * fade * k, age * 0.6 + i, FIRE[2 + (i % 3)], i);
      }
      ctx.lineCap = 'round';
      for (let i = 0; i < Math.round(80 * Q); i++) {
        const u = fract(age / (1 + hs(i) * 0.8) + hs(s + i * 2.7));
        const e = i % 4; const along = hs(s + i * 3.1) * (e < 2 ? W : H);
        const d = u * (1.5 + hs(i * 5.3) * 3); const d0 = Math.max(0, d - 0.25);
        const nx = e === 2 ? 1 : e === 3 ? -1 : 0; const ny = e === 0 ? 1 : e === 1 ? -1 : 0;
        const bx = e === 2 ? 0 : e === 3 ? W : along; const by = e === 0 ? 0 : e === 1 ? H : along;
        ctx.globalAlpha = (1 - u) * fade * k; ctx.strokeStyle = i % 3 ? '#ff9a3c' : '#ffd890'; ctx.lineWidth = 0.05;
        ctx.beginPath(); ctx.moveTo(bx + nx * d0, by + ny * d0); ctx.lineTo(bx + nx * d, by + ny * d); ctx.stroke();
      }
    },
    // Glinn's tentacles close in from the edges and squeeze with each heartbeat (lub-dub); the light drains
    dread(ctx, P) {
      const { W, H, age, k } = P;
      const per = 1.15; const ph = fract(age / per);
      const beat = Math.exp(-((ph - 0.08) ** 2) / 0.0018) + 0.65 * Math.exp(-((ph - 0.27) ** 2) / 0.0022);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(30,0,0,${((0.55 + 0.15 * beat) * k).toFixed(3)})`);
      ctx.fillStyle = g; ctx.fillRect(-1, -1, W + 2, H + 2);
      frame(ctx, pic('moments/dread.webp'), W, H, OUT_DREAD + (1 - ease(age / (2.2 * P.slow))) * 6 + 0.45 * (1 - Math.min(1, beat)), k); // (Glinn: further out, at the edges)
      ctx.globalAlpha = 1; ctx.fillStyle = `rgba(120,0,0,${(0.07 * beat * k).toFixed(3)})`; ctx.fillRect(-1, -1, W + 2, H + 2);
    },
    // Glinn's frost: a white haze and the ice crystals over it grow in from the edges; glints wink in the ice
    frost(ctx, P) {
      const { W, H, age, k, s } = P;
      ctx.fillStyle = `rgba(160,205,255,${(0.07 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const d = OUT_FROST + (1 - ease(age / (3.5 * P.slow))) * 7; // (Glinn: further out, at the edges)
      const fr = (n) => { const im = pic(`moments/${n}.webp`); return im && P.col && P.col !== '#cfe6ff' ? tint(im, n, P.col, 0.45) : im; };
      frame(ctx, fr('frost-haze'), W, H, d * 1.15, 0.6 * k);
      frame(ctx, fr('frost'), W, H, d, 0.85 * k);
      ctx.globalCompositeOperation = 'lighter';
      const glint = sprite(220, 240, 255, 0.4);
      for (let i = 0; i < Math.round(50 * Q); i++) {
        const tw = Math.max(0, Math.sin(age * (2 + hs(i) * 3) + i * 7)) ** 3;
        const e = i % 4; const along = hs(s + i * 2.3); const dd = 0.2 + hs(s + i * 4.4) * 1.4 - (d - OUT_FROST);
        if (dd < 0) continue;
        const x = e < 2 ? along * W : e === 2 ? dd : W - dd; const y = e >= 2 ? along * H : e === 0 ? dd : H - dd;
        blob(ctx, glint, x, y, 0.09, tw * 0.9 * k);
      }
    },
    // light falls from above: soft shafts that turn slowly, a glow on the ground, motes rising out of it
    holy(ctx, P) {
      const { age, k, s, cx, cy, min, p } = P;
      ctx.globalCompositeOperation = 'lighter';
      const R = p ? spotR(P, 4.5, 3, 12) : min * 0.55;
      const up = ease(age / 0.9);
      const hc = P.col || '#ffe0a0'; const H1 = shadeCol(hc, 0.3, true); const H2 = shadeCol(hc, -0.1, true);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      g.addColorStop(0, `${H1}${(0.62 * up * k).toFixed(3)})`); g.addColorStop(0.5, `${H2}${(0.18 * up * k).toFixed(3)})`); g.addColorStop(1, `${H2}0)`);
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.75, 0, TAU); ctx.fill();
      ctx.filter = `blur(${Math.max(2, Math.round(R * 0.6))}px)`;
      for (let i = 0; i < 18; i++) {
        const a = hs(s + i * 1.3) * TAU + age * (0.05 + 0.08 * hs(s + i * 2.1)) * (i % 2 ? 1 : -1);
        const w = 0.03 + hs(s + i * 3) * 0.07;
        const len = R * (0.55 + 0.6 * hs(s + i * 5)) * up;
        const flick = 0.7 + 0.3 * Math.sin(age * (0.8 + hs(i) * 1.2) + i);
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
        gr.addColorStop(0, `${H1}${(0.36 * flick * k).toFixed(3)})`); gr.addColorStop(1, `${H2}0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, len, a - w, a + w); ctx.closePath(); ctx.fill();
      }
      ctx.filter = 'none';
      const mote = sprite(...hexRgb(hc), 0.35);
      for (let i = 0; i < Math.round(70 * Q); i++) {
        const u = fract(age / (2 + hs(i) * 1.5) + hs(s + i * 2.1));
        const a = hs(s + i * 3.9) * TAU; const d = Math.sqrt(hs(s + i * 6.3)) * R * 0.6;
        blob(ctx, mote, cx + Math.cos(a) * d, cy + Math.sin(a) * d - u * 0.6, 0.04 + hs(i * 3) * 0.05, Math.sin(u * Math.PI) * up * k);
      }
    },
    // Glinn's tendrils, tinted, breathe at the edges and sway; colours drift (the filter in screen())
    madness(ctx, P) {
      const { W, H, age, k } = P;
      ctx.fillStyle = `rgba(30,0,40,${(0.12 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const im = pic('moments/madness.webp');
      if (!im) return;
      const img = tint(im, 'madness', P.col ? shadeCol(P.col) : 'rgb(70,24,104)', 0.5);
      const d = (1 - ease(age / (2.4 * P.slow))) * 6 + 0.5 + 0.3 * Math.sin(age * 0.8);
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(0.012 * Math.sin(age * 0.37)); ctx.translate(-W / 2, -H / 2);
      frame(ctx, img, W, H, d, k);
      ctx.restore();
      tendrils(ctx, P); // (Glinn: the moving tendrils of the first version, back over the frame)
    },
    // as time stops a pale wave rolls out and the dust hangs where it was (the grey and the stillness: screen())
    timestop(ctx, P) {
      const { W, H, age, k, s } = P;
      ctx.fillStyle = `rgba(150,180,230,${(0.08 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      if (age < 1.4) ring(ctx, W / 2, H / 2, ease(age / 1.3) * Math.hypot(W, H) * 0.6, 1.2, 'rgba(225,238,255,', 0.35 * (1 - age / 1.4) * k);
      ctx.globalCompositeOperation = 'lighter';
      const mote = sprite(225, 235, 255, 0.4);
      const n = Math.round(90 * Q);
      for (let i = 0; i < n; i++) {
        const x = hs(s + i * 1.7) * W; const y = hs(s + i * 2.9) * H;
        const show = clamp((age - Math.hypot(x - W / 2, y - H / 2) / 25) / 0.4, 0, 1);
        blob(ctx, mote, x, y, 0.035 + hs(i * 3.1) * 0.04, (0.35 + 0.4 * hs(i * 5.7)) * show * k);
      }
    },
    // a golden burst and confetti tumbling out
    nat20(ctx, P) {
      const { W, H, age, k, s, min } = P;
      const cx = W / 2; const cy = H / 2;
      const flash = Math.max(0, 0.3 * (1 - age / 0.5));
      if (flash > 0) { ctx.fillStyle = `rgba(255,220,120,${(flash * k).toFixed(3)})`; ctx.fillRect(-1, -1, W + 2, H + 2); }
      ctx.globalCompositeOperation = 'lighter';
      const R = min * 0.5;
      const burst = Math.max(0, 1 - age / 1.6);
      if (burst > 0) {
        ctx.filter = 'blur(6px)';
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + hs(s + i) * 0.2 + age * 0.1; const w = 0.04 + hs(s + i * 3) * 0.05;
          const len = R * (0.6 + 0.5 * hs(s + i * 5)) * ease(age / 0.4);
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
          gr.addColorStop(0, `rgba(255,220,120,${(0.4 * burst * k).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,200,90,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, len, a - w, a + w); ctx.closePath(); ctx.fill();
        }
        ctx.filter = 'none';
      }
      ctx.globalCompositeOperation = 'source-over';
      const cols = ['#ffd75e', '#fff2c0', '#e0a92e', '#c0392b', '#f4f1e8'];
      for (let i = 0; i < Math.round(140 * Q); i++) {
        const life = 2 + hs(i * 3.9) * 1;
        const u = age / life;
        if (u > 1) continue;
        const a = hs(s + i * 1.3) * TAU; const v = 5 + hs(s + i * 2.1) * 12;
        const d = (v * (1 - Math.exp(-age * 2.2))) / 2.2;
        const x = cx + Math.cos(a) * d + Math.sin(age * 3 + i) * 0.15; const y = cy + Math.sin(a) * d + age * 0.5;
        const spin = Math.cos(age * (6 + hs(i) * 6) + i);
        ctx.globalAlpha = Math.min(1, (1 - u) * 1.5) * k; ctx.fillStyle = cols[i % 5];
        ctx.save(); ctx.translate(x, y); ctx.rotate(hs(i * 7) * TAU + age * 2); ctx.fillRect(-0.09, -0.05 * Math.abs(spin) - 0.005, 0.18, 0.1 * Math.abs(spin) + 0.01); ctx.restore();
      }
      // (Glinn: no big 20 any more)
      const t = clamp(age / 0.35, 0, 1); const out = clamp((age - 1.5) / 0.9, 0, 1);
      if (SHOW_20 && out < 1) {
        const size = min * 0.32 * (0.6 + 0.4 * ease(t));
        ctx.globalAlpha = t * (1 - out) * k;
        ctx.font = `500 ${size.toFixed(3)}px Alegreya, Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const gy = cy - out * 0.8;
        const gg = ctx.createLinearGradient(0, gy - size / 2, 0, gy + size / 2);
        gg.addColorStop(0, '#fff6d0'); gg.addColorStop(0.5, '#ffd257'); gg.addColorStop(1, '#b97a14');
        ctx.shadowColor = 'rgba(255,200,80,0.9)'; ctx.shadowBlur = 30;
        ctx.fillStyle = gg; ctx.fillText('20', cx, gy);
        ctx.shadowBlur = 0; ctx.lineWidth = size * 0.02; ctx.strokeStyle = 'rgba(90,50,0,0.8)'; ctx.strokeText('20', cx, gy);
      }
    },
    // ---------- Beta 2 ----------
    // a circle of runes lights up, sparks spiral in to a point and vanish in a flash; a few motes linger
    teleport(ctx, P) {
      const { age, k, s, cx, cy } = P;
      ctx.globalCompositeOperation = 'lighter';
      const R = spotR(P, 1.8, 1.4, 5); const pull = 0.85;
      const tcol = P.col || '#a8b4ff'; const [tr, tg, tb] = hexRgb(tcol);
      const spark = sprite(tr, tg, tb, 0.35); const core = sprite(235, 240, 255, 0.4);
      // the circle of runes on the ground
      const ra = clamp(age / 0.4, 0, 1) * (1 - clamp((age - pull - 0.1) / 0.9, 0, 1));
      if (ra > 0) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(age * 0.6);
        ctx.strokeStyle = `${shadeCol(tcol, 0.1, true)}${(0.75 * ra * k).toFixed(3)})`; ctx.lineWidth = R * 0.025;
        ctx.shadowColor = `${shadeCol(tcol, 0, true)}0.9)`; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, TAU); ctx.stroke();
        ctx.lineWidth = R * 0.02;
        for (let i = 0; i < 16; i++) { // a rune between the rings: two or three strokes each
          const a = (i / 16) * TAU; const c = Math.cos(a); const sn = Math.sin(a); const rr = R * 0.865;
          const px = c * rr; const py = sn * rr; const u = R * 0.055;
          ctx.beginPath();
          ctx.moveTo(px - sn * u, py + c * u); ctx.lineTo(px + sn * u, py - c * u);
          const b = hs(s + i) > 0.5 ? 1 : -1;
          ctx.moveTo(px + c * u * b, py + sn * u * b); ctx.lineTo(px - sn * u * 0.6, py + c * u * 0.6);
          if (hs(s + i * 3) > 0.5) { ctx.moveTo(px - c * u, py - sn * u); ctx.lineTo(px + sn * u * 0.8 - c * u * 0.2, py - c * u * 0.8 - sn * u * 0.2); }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (age < pull) {
        const u = age / pull;
        blob(ctx, sprite(Math.round(tr * 0.85), Math.round(tg * 0.85), Math.round(tb * 0.95)), cx, cy, R * (0.25 + u * 0.6), 0.5 * u * k);
        blob(ctx, core, cx, cy, R * (0.08 + u * 0.18), 0.8 * u * k);
        const n = Math.round(70 * Q);
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const v = clamp(u * (0.8 + hs(s + i) * 0.4), 0, 1);
          const at = (q) => { const a = hs(s + i * 2.3) * TAU + q * 2.6; const d = R * (0.5 + 0.7 * hs(s + i * 3.7)) * (1 - q * q); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; };
          const [x, y] = at(v); const [x0, y0] = at(Math.max(0, v - 0.12));
          ctx.globalAlpha = Math.min(1, (0.5 + 0.5 * v) * k);
          ctx.strokeStyle = i % 3 ? `${shadeCol(tcol, 0, true)}0.9)` : 'rgba(240,245,255,1)';
          ctx.lineWidth = R * (0.02 + 0.012 * hs(i));
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
          blob(ctx, i % 3 ? spark : core, x, y, R * (0.04 + 0.025 * hs(i)), (0.5 + 0.5 * v) * k);
        }
      } else {
        const v = (age - pull) / 0.7;
        if (v < 1) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.35 + v * 1.2));
          g.addColorStop(0, `rgba(245,248,255,${(1 - v) * k})`); g.addColorStop(0.35, `${shadeCol(tcol, -0.05, true)}${0.65 * (1 - v) * k})`); g.addColorStop(1, `${shadeCol(tcol, -0.2, true)}0)`);
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * (0.35 + v * 1.2), 0, TAU); ctx.fill();
        }
        for (let i = 0; i < Math.round(24 * Q); i++) {
          const w = (age - pull) / (0.8 + hs(i * 3) * 0.6);
          if (w > 1) continue;
          const a = hs(s + i * 5.1) * TAU; const d = R * (0.1 + ease(w) * (0.4 + hs(s + i) * 0.5));
          blob(ctx, spark, cx + Math.cos(a) * d, cy + Math.sin(a) * d - w * 0.3, R * 0.025, (1 - w) * 0.8 * k);
        }
      }
    },
    // a cloud of smoke billows out of a point and thins away
    puff(ctx, P) {
      const { age, k, s, cx, cy } = P;
      const R = spotR(P, 1.6, 1.3, 4.5);
      if (age < 0.12) { ctx.fillStyle = `rgba(255,255,255,${(0.25 * (1 - age / 0.12) * k).toFixed(3)})`; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, TAU); ctx.fill(); }
      const pb = P.col || '#a8a6ac'; const cols = [shadeCol(pb), shadeCol(pb, -0.24), shadeCol(pb, 0.2)];
      const n = Math.round(22 * Q) + 8;
      for (let i = 0; i < n; i++) {
        const u = clamp(age / (1.5 + hs(i * 2.7) * 0.9), 0, 1);
        if (u >= 1) continue;
        const a = hs(s + i * 1.9) * TAU + u * 0.6 * (hs(i) < 0.5 ? 1 : -1);
        const d = ease(u) * R * (0.4 + hs(s + i * 3.1) * 0.9);
        cloud(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d - u * 0.3, R * (0.3 + ease(u) * (0.45 + hs(i * 5) * 0.4)), Math.min(1, (1 - u) * 1.6) * 0.5 * k, a + u, cols[i % 3], i);
      }
    },
    // the lights die (scene-view.js does that); a gust sweeps across and a thread of smoke rises from each flame
    lightsout(ctx, P) {
      const { W, H, age, k, s } = P;
      const v = age / 1.6;
      if (v <= 1) {
        const side = Math.floor(hs(s + 0.3) * 4);
        const along = side < 2 ? W : H;
        const x = ease(v) * (along + 6) - 3;
        const dirx = side === 1 ? -1 : 1;
        const g = side < 2
          ? ctx.createLinearGradient(dirx > 0 ? x - 3 : W - x + 3, 0, dirx > 0 ? x + 1 : W - x - 1, 0)
          : ctx.createLinearGradient(0, side === 3 ? H - x + 3 : x - 3, 0, side === 3 ? H - x - 1 : x + 1);
        const a = 0.22 * Math.sin(Math.PI * v);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, `rgba(4,6,12,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(-1, -1, W + 2, H + 2);
      }
      const L = (P.lights || []).slice(0, 40);
      L.forEach((l, j) => {
        for (let i = 0; i < 6; i++) {
          const u = (age - 0.4 - hs(j * 7 + 1) * 1.4 - i * 0.25) / 2.6;
          if (u < 0 || u > 1) continue;
          cloud(ctx, l.x + Math.sin(u * 5 + i + j) * 0.25 + u * 0.6, l.y - u * 2.2, 0.25 + u * 0.8, Math.sin(Math.PI * u) * 0.5 * k, u * 2 + i, 'rgb(180,180,186)', i + j);
        }
      });
    },
    // stones fall (their shadows first), land with a burst of dust and a crack, and lie there a while
    rockfall(ctx, P) {
      const { age, k, s, cx, cy } = P;
      const R = spotR(P, 1.6, 1.2, 4);
      crack(ctx, cx, cy, hs(s + 2) * TAU, R * 1.6, s + 5, ease((age - ROCK_HIT) / 0.5), 0.07, k);
      const rocks = [];
      for (let i = 0; i < 9; i++) {
        const a = hs(s + i * 2.9) * TAU; const d = i ? R * (0.3 + hs(s + i * 4.3) * 1) : 0;
        rocks.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: R * (i ? 0.14 + hs(s + i * 7.7) * 0.18 : 0.42), land: ROCK_HIT - 0.4 + hs(s + i * 6.1) * 0.4 + (i ? 0.05 : 0), i });
      }
      for (const q of rocks) if (age < q.land) { const u = clamp(age / q.land, 0, 1); shade(ctx, q.x, q.y, q.r * (2.2 - 1.2 * u), 0.55 * u * u * k); }
      for (const q of rocks) {
        const a = age - q.land;
        if (a < 0) continue;
        shade(ctx, q.x, q.y, q.r, 0.4 * k);
        stone(ctx, q.x, q.y, q.r, hs(q.i * 3.7) * TAU, q.i + s, k);
      }
      for (const q of rocks) { // the dust over them
        const a = age - q.land;
        if (a < 0) continue;
        for (let j = 0; j < 4; j++) {
          const u = a / (1.3 + hs(q.i * 13 + j) * 0.9);
          if (u > 1) continue;
          const an = hs(s + q.i * 17 + j * 3.1) * TAU; const d = ease(u) * q.r * 3;
          cloud(ctx, q.x + Math.cos(an) * d, q.y + Math.sin(an) * d, q.r * (1.4 + ease(u) * 3), (1 - u) * 0.5 * k, an, 'rgb(168,156,138)', q.i + j);
        }
      }
    },
    // a wave sweeps in from one side, foam on its front, covers the table a moment, then drains away
    flood(ctx, P) {
      const { W, H, age, k, s } = P;
      const side = Math.floor(hs(s + 0.6) * 4); // 0 left, 1 right, 2 top, 3 bottom
      const L = side < 2 ? W : H; const Wd = side < 2 ? H : W;
      const drain = smooth((age - 4.2) / 3);
      const reach = smooth(age / 3.4) * (L + 2) * (1 - 0.55 * drain);
      const A = k * (1 - drain);
      if (A <= 0.003) return;
      const pt = (d, w) => (side === 0 ? [d, w] : side === 1 ? [W - d, w] : side === 2 ? [w, d] : [w, H - d]);
      const front = (w) => reach - 0.5 + 0.5 * vnoise(w * 0.6 + age * 0.8, s) + 0.25 * vnoise(w * 2.1 - age * 1.3, s + 9);
      const steps = Math.max(24, Math.round(Wd * 3));
      const shape = new Path2D();
      { const [x, y] = pt(-1, -1); shape.moveTo(x, y); }
      for (let i = 0; i <= steps; i++) { const w = (i / steps) * (Wd + 2) - 1; const [x, y] = pt(front(w), w); shape.lineTo(x, y); }
      { const [x, y] = pt(-1, Wd + 1); shape.lineTo(x, y); }
      shape.closePath();
      // the water: the Deep water tile, moving with the flow, over a dark blue
      const [gx0, gy0] = pt(0, 0); const [gx1, gy1] = pt(Math.max(1, reach), 0);
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, `rgba(16,52,80,${(0.55 * A).toFixed(3)})`); g.addColorStop(1, `rgba(40,100,140,${(0.4 * A).toFixed(3)})`);
      ctx.fillStyle = g; ctx.fill(shape);
      const tex = pic('tiles/deep_water-small.webp');
      if (tex) {
        const pat = ctx.createPattern(tex, 'repeat');
        const sc = 6 / tex.naturalWidth; const flow = age * 0.9;
        const [fx, fy] = side === 0 ? [flow, 0] : side === 1 ? [-flow, 0] : side === 2 ? [0, flow] : [0, -flow];
        pat.setTransform(new DOMMatrix([sc, 0, 0, sc, fx % 6, fy % 6]));
        ctx.globalAlpha = 0.5 * A; ctx.fillStyle = pat; ctx.fill(shape); ctx.globalAlpha = 1;
      }
      ctx.lineCap = 'round';
      for (const [off, w0, al] of [[0, 0.32, 0.6], [0.05, 0.14, 0.9], [-0.3, 0.16, 0.45], [-0.9, 0.07, 0.25]]) {
        ctx.strokeStyle = `rgba(240,250,255,${(al * A).toFixed(3)})`;
        ctx.lineWidth = w0;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) { const w = (i / steps) * (Wd + 2) - 1; const [x, y] = pt(front(w) + off + 0.12 * Math.sin(w * 3 + age * 4), w); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      // foam riding the front
      for (let i = 0; i < Math.round(30 * Q); i++) {
        const w = hs(s + i * 1.7) * Wd; const [x, y] = pt(front(w) - 0.15, w);
        cloud(ctx, x, y, 0.35 + hs(i * 3) * 0.4, 0.4 * A, i + age, 'rgb(235,245,255)', i);
      }
      ctx.globalCompositeOperation = 'lighter';
      const spray = sprite(225, 242, 255, 0.35);
      for (let i = 0; i < Math.round(80 * Q); i++) {
        const w = hs(s + i * 1.7) * Wd; const ph = fract(age * 1.4 + hs(s + i * 2.9));
        const [x, y] = pt(front(w) + 0.2 + ph * 0.5, w + (hs(i * 3) - 0.5) * 0.3);
        blob(ctx, spray, x, y, 0.05 + 0.05 * hs(i), (1 - ph) * 0.6 * A);
      }
    },
  };

  const api = { LIST, BY, FADE_OUT, level, alive, screen, draw, setQuality };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Moments = api;
})(typeof window !== 'undefined' ? window : globalThis);
