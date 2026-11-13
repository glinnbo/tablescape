// Procedural effects: atmosphere, lights, weather and spell looks.
// Everything is stateless: a particle's position is a function of time and its
// index, so the GM window and the table window always show the same thing and
// nothing builds up over a long session. Drawing units are inches.
'use strict';

const FX = (() => {
  const TAU = Math.PI * 2;
  const fract = (x) => x - Math.floor(x);
  const h = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const seedOf = (id) => { let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 100003; return s; };

  // ---------- colours and sprites ----------
  function rgb(hex) {
    const n = parseInt((hex || '#ffffff').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const sprites = new Map();
  // soft round dot; hard = 0 is a pure gradient, hard = 0.5 keeps a solid core
  function sprite(hex, hard = 0) {
    const key = `${hex}|${hard}`;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(hex, 1));
    if (hard > 0) gr.addColorStop(hard, rgba(hex, 0.9));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    sprites.set(key, c);
    return c;
  }
  function dot(ctx, img, x, y, r, a, sx = 1) {
    if (a <= 0.004 || r <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, x - r * sx, y - r, 2 * r * sx, 2 * r);
  }
  const ease01 = (u) => 1 - (1 - clamp(u, 0, 1)) ** 3;
  const flicker = (t, s) => 0.86 + 0.08 * Math.sin(t * 13.1 + s) + 0.05 * Math.sin(t * 27.3 + s * 1.7) + 0.04 * Math.sin(t * 5.3 + s * 0.3);
  // Beta 2: how a light lives (Light sources, flames): 'pulse' breathes slowly; 'sputter' is a dying torch that
  // gutters and nearly goes out now and then. 1 = its full strength.
  function waveOf(f, t) {
    if (!f || !f.wave) return 1;
    const s = seedOf(f.id || 'w');
    if (f.wave === 'pulse') return 0.55 + 0.45 * Math.sin(t * 1.6 + s);
    const per = 2.6; const k = Math.floor(t / per + h(s)); const u = fract(t / per + h(s));
    const shake = 0.9 + 0.1 * Math.sin(t * 31 + s) * Math.sin(t * 17.3);
    if (h(k * 7.3 + s) > 0.42) return shake;
    // a dip: it sinks, flutters near nothing, catches again
    const d = u < 0.25 ? 1 - u / 0.25 * 0.85 : u < 0.6 ? 0.15 + 0.12 * Math.abs(Math.sin(t * 23 + s)) : 0.15 + (u - 0.6) / 0.4 * 0.85;
    return Math.min(1, d) * shake;
  }

  // mix two colours: t = 0 gives a, t = 1 gives b
  function mix(a, b, t) {
    const x = rgb(a); const y = rgb(b);
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  // effects quality (Options → Performance): fewer particles on weaker computers
  let Q = 1;
  const setQuality = (q) => { Q = q === 'low' ? 0.45 : q === 'medium' ? 0.7 : 1; };
  const count = (base, fx) => Math.max(1, Math.round(base * Q * Math.min(4, Math.max(0.1, fx.density ?? 1))));

  // =====================================================================
  // Atmosphere: point emitters
  // fx: { preset, r, color?, intensity, density, speed }
  // =====================================================================
  function emitter(ctx, fx, x, y, t, k = 1) {
    const s = seedOf(fx.id);
    const r = (fx.r || 1) * k;
    const I = (fx.intensity ?? 1) * (fx.wave ? waveOf(fx, t) : 1) * (fx.outK ?? 1);
    const C = fx.color || null;
    t *= fx.speed ?? 1;
    ctx.globalCompositeOperation = 'lighter';
    switch (fx.preset) {
      case 'torch':
      case 'campfire':
      case 'candle': {
        const big = fx.preset === 'campfire';
        const glow = C || '#ff8a2a';
        const core = C ? mix(C, '#ffffff', 0.6) : '#ffd27a';
        const fA = C || '#ff9a2e'; const fB = C ? mix(C, '#ffffff', 0.45) : '#ffd36b';
        const ember = C ? mix(C, '#ffffff', 0.3) : '#ffb347';
        const fl = flicker(t, s);
        dot(ctx, sprite(glow), x, y, r * 2.6 * fl, 0.32 * I);
        dot(ctx, sprite(core, 0.2), x, y - r * 0.1, r * 0.75 * fl, 0.55 * I);
        const n = count(big ? 14 : fx.preset === 'candle' ? 3 : 7, fx);
        for (let i = 0; i < n; i++) {
          const ph = fract(t * (big ? 1.4 : 1.8) + h(s + i));
          const px = x + (h(s + i * 3) - 0.5) * r * (big ? 0.9 : 0.45) + Math.sin(t * 7 + i) * r * 0.05;
          const py = y - ph * r * (big ? 1.5 : 1.1);
          dot(ctx, sprite(i % 2 ? fA : fB), px, py, r * (big ? 0.42 : 0.36) * (1 - ph * 0.7), (1 - ph) * 0.65 * I);
        }
        const ne = fx.preset === 'candle' ? 0 : count(big ? 14 : 6, fx);
        for (let i = 0; i < ne; i++) {
          const ph = fract(t * 0.42 + h(s + i * 7));
          const px = x + (h(s + i * 11) - 0.5) * r * 0.7 + Math.sin(t * 2.1 + i) * r * 0.35 * ph;
          const py = y - ph * r * (big ? 4.5 : 3.2);
          dot(ctx, sprite(ember, 0.4), px, py, r * 0.06, (1 - ph) * 0.9 * I);
        }
        if (big) smoke(ctx, s, x, y - r * 1.2, r * 0.8, t, 0.6 * I, '#8a8a8e', 10);
        break;
      }
      case 'glow': {
        const p = 0.82 + 0.18 * Math.sin(t * 1.7 + s);
        dot(ctx, sprite(C || '#7fa8ff'), x, y, r * 2.2 * p, 0.42 * I);
        dot(ctx, sprite(C ? mix(C, '#ffffff', 0.7) : '#ffffff'), x, y, r * 0.5 * p, 0.35 * I);
        break;
      }
      case 'smoke':
        smoke(ctx, s, x, y, r, t, I, C || '#8a8a8e', count(10, fx));
        break;
      case 'steam': {
        ctx.globalCompositeOperation = 'source-over';
        const n = count(9, fx);
        for (let i = 0; i < n; i++) {
          const ph = fract(t * 0.45 + h(s + i));
          const px = x + (h(s + i * 5) - 0.5) * r * 0.5 + Math.sin(t + i) * r * 0.2 * ph;
          const py = y - ph * r * 2.2;
          dot(ctx, sprite(C || '#f2f5f8'), px, py, r * (0.3 + ph * 0.7), 0.22 * Math.sin(ph * Math.PI) * I);
        }
        break;
      }
      case 'sparkles': {
        const n = count(18, fx);
        for (let i = 0; i < n; i++) {
          const px = x + (h(s + i) - 0.5) * r * 2;
          const py = y + (h(s + i * 2) - 0.5) * r * 2;
          const tw = Math.max(0, Math.sin(t * (1.4 + h(s + i * 3) * 2) + h(s + i * 4) * TAU)) ** 4;
          dot(ctx, sprite(C || '#ffe9a8', 0.3), px, py, r * 0.1, tw * I);
        }
        break;
      }
      case 'fireflies': {
        const glow = C || '#d6ff6a'; const core = C ? mix(C, '#ffffff', 0.7) : '#f6ffcf';
        const n = count(12, fx);
        for (let i = 0; i < n; i++) {
          const a = h(s + i) * 9; const b = h(s + i * 2) * 7;
          const px = x + r * Math.sin(t * 0.31 * (1 + h(s + i * 3)) + a) * Math.cos(t * 0.17 * (1 + h(s + i * 4)) + b);
          const py = y + r * Math.sin(t * 0.23 * (1 + h(s + i * 5)) + b) * Math.cos(t * 0.13 + a);
          const bl = (0.5 + 0.5 * Math.sin(t * 2.6 + i * 3.1)) ** 2;
          dot(ctx, sprite(glow), px, py, r * 0.12, 0.35 * bl * I);
          dot(ctx, sprite(core, 0.5), px, py, r * 0.035, bl * I);
        }
        break;
      }
      // ---------- Beta 2 ----------
      case 'runes': { // a ring of runes turning slowly, a star inside turning the other way, pulsing
        const col = C || '#7fb2ff'; const hi = mix(col, '#ffffff', 0.65);
        const pulse = 0.72 + 0.28 * Math.sin(t * 1.3 + s);
        const dir = h(s + 0.1) < 0.5 ? 1 : -1;
        const rot = t * 0.12 * dir;
        dot(ctx, sprite(col), x, y, r * 1.3, 0.16 * I * pulse);
        const lines = (fn, w) => {
          for (const [lw, c, al] of [[w * 3.2, col, 0.22], [w, hi, 0.9]]) {
            ctx.globalAlpha = Math.min(1, al * I * pulse);
            ctx.strokeStyle = c; ctx.lineWidth = lw;
            ctx.beginPath(); fn(); ctx.stroke();
          }
        };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        lines(() => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); ctx.moveTo(x + r * 0.78, y); ctx.arc(x, y, r * 0.78, 0, TAU); }, r * 0.018);
        // the star: seven points, every third joined
        lines(() => {
          for (let i = 0; i <= 7; i++) {
            const a = ((i * 3) % 7) / 7 * TAU - rot * 0.6;
            const px = x + Math.cos(a) * r * 0.74; const py = y + Math.sin(a) * r * 0.74;
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.moveTo(x + r * 0.28, y); ctx.arc(x, y, r * 0.28, 0, TAU);
        }, r * 0.012);
        // runes between the two rings, read from the middle outwards (the same from every side of the table)
        const N = 18; const G = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
        lines(() => {
          for (let i = 0; i < N; i++) {
            const a = (i / N) * TAU + rot;
            const cx = x + Math.cos(a) * r * 0.89; const cy = y + Math.sin(a) * r * 0.89;
            const sz = r * 0.055; const ca = Math.cos(a); const sa = Math.sin(a);
            const P = ([u, v]) => [cx + (v * ca - u * sa) * sz, cy + (v * sa + u * ca) * sz];
            for (let k = 0; k < 3; k++) {
              const p1 = P(G[Math.floor(h(s + i * 7 + k * 3.1) * 9)]); const p2 = P(G[Math.floor(h(s + i * 11 + k * 5.3) * 9)]);
              ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
            }
          }
        }, r * 0.012);
        const n = count(14, fx);
        for (let i = 0; i < n; i++) {
          const ph = fract(t * 0.25 + h(s + i * 3));
          const a = h(s + i) * TAU + rot;
          const d = r * (0.8 + ph * 0.35);
          dot(ctx, sprite(hi, 0.4), x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.025, Math.sin(Math.PI * ph) * 0.9 * I);
        }
        break;
      }
      case 'portal': { // a dark eye, spiral arms turning into it, a bright rim, sparks flung off the rim
        const col = C || '#a070ff'; const hi = mix(col, '#ffffff', 0.6); const dark = mix(col, '#000000', 0.88);
        ctx.globalCompositeOperation = 'source-over';
        dot(ctx, sprite(dark, 0.55), x, y, r * 0.95, 0.9 * I);
        ctx.globalCompositeOperation = 'lighter';
        const spin = t * 1.3;
        ctx.lineCap = 'round';
        for (let j = 0; j < 5; j++) {
          ctx.strokeStyle = j % 2 ? col : hi;
          for (let k = 0; k < 20; k++) {
            const f0 = k / 20; const f1 = (k + 1) / 20;
            const P = (f) => { const rr = r * (0.12 + 0.82 * f); const a = (j / 5) * TAU + f * 3.4 - spin; return [x + Math.cos(a) * rr, y + Math.sin(a) * rr]; };
            const [x0, y0] = P(f0); const [x1, y1] = P(f1);
            ctx.globalAlpha = Math.min(1, (0.15 + 0.5 * f0) * I);
            ctx.lineWidth = r * (0.012 + 0.045 * f0);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          }
        }
        // the rim: a wobbling bright ring with a glow
        for (const [lw, c, al] of [[r * 0.16, col, 0.25], [r * 0.035, hi, 0.9]]) {
          ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.globalAlpha = Math.min(1, al * I);
          ctx.beginPath();
          for (let k = 0; k <= 48; k++) {
            const a = (k / 48) * TAU;
            const rr = r * (0.94 + 0.035 * Math.sin(a * 5 + t * 3) + 0.02 * Math.sin(a * 11 - t * 4.3));
            if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.stroke();
        }
        const n = count(22, fx);
        for (let i = 0; i < n; i++) {
          const ph = fract(t * 0.9 + h(s + i * 1.7));
          const a0 = h(s + i) * TAU - spin;
          const tx = -Math.sin(a0); const ty = Math.cos(a0);
          const px = x + Math.cos(a0) * r * 0.95 + (tx * 0.9 + Math.cos(a0) * 0.35) * ph * r;
          const py = y + Math.sin(a0) * r * 0.95 + (ty * 0.9 + Math.sin(a0) * 0.35) * ph * r;
          dot(ctx, sprite(hi, 0.4), px, py, r * 0.03 * (1 - ph * 0.5), (1 - ph) * I);
        }
        break;
      }
      case 'shaft': { // a beam through a window: brighter where it comes in, soft at its sides, dust floating in it
        const col = C || '#fff1c9';
        const ang = ((fx.angle ?? 35) * Math.PI) / 180;
        const W0 = r; const L = r * 4.5;
        const dust = Math.max(0.05, fx.dust ?? 1); // 4.3.2: how big the floating dust is
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.globalAlpha = Math.min(1, 0.55 * I * (0.94 + 0.06 * Math.sin(t * 0.3 + s)));
        ctx.drawImage(beamSprite(col), 0, -W0 * SHAFT_V, L, W0 * SHAFT_V * 2);
        const n = count(30, fx);
        for (let i = 0; i < n; i++) {
          const u = fract(h(s + i) + t * 0.02 * (0.5 + h(s + i * 3)));
          const v = (h(s + i * 5) - 0.5) * (0.5 + 0.18 * u) * W0 * 1.6 + Math.sin(t * 0.4 + i) * W0 * 0.05;
          const tw = 0.4 + 0.6 * Math.max(0, Math.sin(t * (0.8 + h(s + i * 7)) + i)) ** 2;
          dot(ctx, sprite('#ffffff', 0.4), u * L * 0.95, v, r * 0.025 * dust, tw * (1 - u) * 0.9 * I);
        }
        ctx.restore();
        break;
      }
      case 'window': { // 4.9: sunlight through a window: the patch on the floor with the shadows of the bars, haze and dust above it
        const col = C || WINDOW_COLOR;
        const ang = ((fx.angle ?? WINDOW_ANGLE) * Math.PI) / 180;
        const sp = windowSprites(fx.shape, fx.grid);
        const R = windowRect(fx, r, sp);
        const dust = Math.max(0.05, fx.dust ?? 1);
        const drift = 0.93 + 0.04 * Math.sin(t * 0.21 + s) + 0.03 * Math.sin(t * 0.077 + s * 2); // now and then a thin cloud
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        const soft = tinted(sp.soft, col);
        // the light in the air, from the window down to the floor
        for (let i = 1; i <= 5; i++) { const l = i / 6; ctx.globalAlpha = Math.min(1, 0.07 * I * drift); ctx.drawImage(soft, R.x * l, R.y, R.w * l, R.h); }
        // where it falls: the panes bright, the bars dark, a soft glow around it
        ctx.globalAlpha = Math.min(1, 0.16 * I * drift);
        ctx.drawImage(soft, R.x, R.y, R.w, R.h);
        ctx.globalAlpha = Math.min(1, 0.42 * I * drift);
        ctx.drawImage(tinted(sp.patch, col), R.x, R.y, R.w, R.h);
        // dust: it shows only where the light catches it, so it winks out in the shadows of the bars
        const n = count(40, fx); const N = sp.N; const white = sprite('#ffffff', 0.4);
        for (let i = 0; i < n; i++) {
          const b = fract(h(s + i) + t * 0.012 * (0.4 + h(s + i * 3))); // along the window, drifting
          const a = fract(h(s + i * 5) + Math.sin(t * 0.3 + i) * 0.015 + t * 0.003 * (h(s + i * 13) - 0.5)); // across
          const lit = sp.look[Math.min(N - 1, Math.floor(a * N)) * N + Math.min(N - 1, Math.floor(b * N))];
          if (lit < 0.05) continue;
          const lam = 0.3 + 0.7 * h(s + i * 11); // how far down the beam (1: on the floor)
          const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * (0.7 + h(s + i * 7)) + i)) ** 2;
          dot(ctx, white, lam * (R.u0 + b * R.hp), (a - 0.5) * R.wd, r * 0.022 * dust, tw * lit * 0.85 * I);
        }
        ctx.restore();
        break;
      }
      case 'arcs': { // electricity jumping between two ends, flickering, now and then a big one
        const col = C || '#9fc8ff';
        const ang = ((fx.angle ?? 0) * Math.PI) / 180;
        const ca = Math.cos(ang); const sa = Math.sin(ang);
        const ax = x - ca * r; const ay = y - sa * r; const bx = x + ca * r; const by = y + sa * r;
        const fl = 0.6 + 0.4 * Math.sin(t * 37 + s) * Math.sin(t * 23);
        for (const [ex, ey] of [[ax, ay], [bx, by]]) { dot(ctx, sprite(col), ex, ey, r * 0.3, 0.35 * fl * I); dot(ctx, sprite('#ffffff', 0.5), ex, ey, r * 0.07, 0.9 * I); }
        const k = Math.floor(t * 14);
        const big = fract(t / 1.7 + h(s)) < 0.12; // every so often a heavy discharge
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let b = 0; b < (big ? 4 : 3); b++) {
          if (h(k * 7 + b + s) < 0.3 && !big) continue;
          const seg = 12; const path = [];
          for (let i = 0; i <= seg; i++) {
            const f = i / seg;
            const j = (h(k * 13 + b * 5 + i + s) - 0.5) * r * 0.55 * Math.sin(Math.PI * f);
            path.push(ax + (bx - ax) * f - sa * j, ay + (by - ay) * f + ca * j);
          }
          for (const [w, c, al] of [[r * (big ? 0.12 : 0.06), col, 0.28], [r * (big ? 0.03 : 0.015), '#ffffff', 0.95]]) {
            ctx.globalAlpha = Math.min(1, al * I);
            ctx.strokeStyle = c; ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(path[0], path[1]);
            for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
            ctx.stroke();
          }
        }
        if (big) dot(ctx, sprite(col), x, y, r * 1.1, 0.2 * I);
        const n = count(10, fx);
        for (let i = 0; i < n; i++) {
          const ph = fract(t * 2.2 + h(s + i * 3));
          const e = i % 2 ? [ax, ay] : [bx, by];
          const a = h(s + i * 5 + Math.floor(t * 2.2 + h(s + i * 3))) * TAU;
          dot(ctx, sprite('#ffffff', 0.5), e[0] + Math.cos(a) * ph * r * 0.35, e[1] + Math.sin(a) * ph * r * 0.35, r * 0.02, (1 - ph) * I);
        }
        break;
      }
      case 'vent': { // bursts every few seconds: steam, gas or fire; a thin wisp in between
        const kind = fx.variant || 'steam';
        const L = ventLevel(fx, t / (fx.speed ?? 1));
        const per = VENT_PER; const cyc = t / per + h(s); const age = (cyc - Math.floor(cyc)) * per;
        const a0 = h(s + 0.4) * TAU; const wx = Math.cos(a0); const wy = Math.sin(a0);
        if (kind === 'fire') {
          const fA = C || '#ff7a1f'; const fB = C ? mix(C, '#ffffff', 0.45) : '#ffd36b';
          dot(ctx, sprite(fA), x, y, r * (0.4 + 1.6 * L), (0.16 + 0.3 * L) * I);
          const n = count(26, fx);
          for (let i = 0; i < n; i++) {
            const ph = fract(t * 2.4 + h(s + i * 1.3));
            const a = h(s + i * 3.1) * TAU; const d = ph * r * (0.25 + 1.4 * L);
            dot(ctx, sprite(i % 2 ? fA : fB), x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.12 + 0.3 * L) * (1 - ph * 0.6), (1 - ph) * (0.2 + 0.7 * L) * I);
          }
          const ne = count(10, fx);
          for (let i = 0; i < ne; i++) {
            const ph = fract(t * 0.5 + h(s + i * 7));
            dot(ctx, sprite('#ffb347', 0.4), x + wx * ph * r * 2 + Math.sin(t + i) * r * 0.2, y + wy * ph * r * 2 + Math.cos(t + i) * r * 0.2, r * 0.035, (1 - ph) * (0.3 + 0.6 * L) * I);
          }
        } else {
          ctx.globalCompositeOperation = 'source-over';
          const col = C || (kind === 'gas' ? '#8fd14f' : '#eef2f6');
          const life = kind === 'gas' ? 3.2 : 2.2;
          dot(ctx, sprite(kind === 'gas' ? '#1d2414' : '#16191c'), x, y, r * 0.32, 0.38 * I); // the vent's dark mouth, under the puffs
          const n = count(16, fx);
          for (let j = 0; j < n; j++) {
            const born = (j / n) * 1.5; const u = (age - born) / life;
            if (u < 0 || u > 1) continue;
            const a = h(s + j * 3.7 + Math.floor(cyc)) * TAU;
            const d = r * (0.15 + u * 1.3);
            const px = x + Math.cos(a) * d * 0.6 + wx * u * r * 1.4; const py = y + Math.sin(a) * d * 0.6 + wy * u * r * 1.4;
            dot(ctx, sprite(col), px, py, r * (0.35 + u * 1.1), (kind === 'gas' ? 0.3 : 0.34) * Math.sin(Math.PI * Math.min(1, u * 1.4)) * I);
          }
          if (L > 0) dot(ctx, sprite(mix(col, '#ffffff', 0.5)), x, y, r * 0.5, 0.35 * L * I);
          // in between: a thin wisp, so the table always sees where it is
          for (let j = 0; j < 4; j++) {
            const ph = fract(t * 0.3 + j / 4);
            dot(ctx, sprite(col), x + wx * ph * r * 0.8, y + wy * ph * r * 0.8, r * (0.2 + ph * 0.35), 0.17 * Math.sin(Math.PI * ph) * I);
          }
        }
        break;
      }
      case 'falls': { // where water lands: churned water, rings spreading out, spray and drifting mist
        const col = C || '#e3f5ff'; const deep = C ? mix(C, '#000000', 0.45) : '#2a83b5';
        ctx.globalCompositeOperation = 'source-over';
        dot(ctx, sprite(deep), x, y, r * 1.25, 0.28 * I);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        for (let k = 0; k < 4; k++) {
          const ph = fract(t * 0.55 + k / 4);
          ctx.globalAlpha = Math.min(1, (1 - ph) * 0.55 * I);
          ctx.lineWidth = r * 0.035 * (1 - ph * 0.6);
          ctx.beginPath(); ctx.arc(x, y, r * (0.25 + ph * 1.0), 0, TAU); ctx.stroke();
        }
        const fk = Math.floor(t * 10);
        const n = count(30, fx);
        for (let i = 0; i < n; i++) {
          const a = h(s + i * 2.1 + fk * 0.37) * TAU; const d = Math.sqrt(h(s + i * 4.3 + fk * 0.71)) * r * 0.42;
          dot(ctx, sprite('#ffffff', 0.4), x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.03 + 0.05 * h(s + i)), 0.7 * I);
        }
        for (let i = 0; i < count(18, fx); i++) {
          const ph = fract(t * 1.3 + h(s + i * 5));
          const a = h(s + i * 7 + Math.floor(t * 1.3 + h(s + i * 5))) * TAU;
          dot(ctx, sprite(col, 0.4), x + Math.cos(a) * ph * r * 1.1, y + Math.sin(a) * ph * r * 1.1, r * 0.025, (1 - ph) * 0.9 * I);
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 6; i++) {
          const ph = fract(t * 0.12 + i / 6);
          const a = h(s + i * 9) * TAU;
          dot(ctx, sprite('#ffffff'), x + Math.cos(a) * ph * r * 1.6, y + Math.sin(a) * ph * r * 1.6, r * (0.5 + ph * 0.8), 0.1 * Math.sin(Math.PI * ph) * I);
        }
        break;
      }
      default:
        dot(ctx, sprite(C || '#ffffff'), x, y, r, 0.3 * I);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // a soft beam (light shaft): bright where it comes in, fading along it, soft at both sides; one per colour
  // 4.9: the beam's own haze, worked out pixel by pixel (shaftMasks below): no hard start, soft sides
  function beamSprite(col) { return tinted(shaftHaze(), col); }
  // a vent's burst right now: 0 between bursts, up to 1 at its height (also for the light a fire vent throws)
  const VENT_PER = 5.5; // seconds from one burst to the next (at speed 1)
  function ventLevel(fx, t) {
    const sp = fx.speed ?? 1;
    const cyc = (t * sp) / VENT_PER + h(seedOf(fx.id || 'v'));
    const age = (cyc - Math.floor(cyc)) * VENT_PER;
    if (age > 1.9) return 0;
    return Math.min(1, age / 0.15) * (age > 1.1 ? 1 - (age - 1.1) / 0.8 : 1);
  }

  function smoke(ctx, s, x, y, r, t, I, col, n) {
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < n; i++) {
      const ph = fract(t * 0.16 + h(s + i));
      const px = x + (h(s + i * 5) - 0.5) * r * 0.4 + Math.sin(t * 0.6 + i) * r * 0.45 * ph;
      const py = y - ph * r * 3.2;
      dot(ctx, sprite(col), px, py, r * (0.35 + ph * 1.2), 0.2 * Math.sin(ph * Math.PI) * I);
    }
    ctx.globalCompositeOperation = 'lighter';
  }

  // =====================================================================
  // Atmosphere: painted areas. Particles start at painted points, so the
  // edges stay soft without any clipping.
  // =====================================================================
  // ---------- painted areas: the area itself as a mask, and textures ----------
  // The painted area (round strokes) as a canvas in device pixels, soft-edged; cached per area and view.
  const maskCache = new Map();
  function strokeSig(fx) { let n = 0; for (const st of fx.strokes || []) n += st.pts.length; return `${(fx.strokes || []).length}:${n}`; }
  function drawStrokes(g, strokes, grow = 0, minR = 0) {
    for (const st of strokes) {
      const r = Math.max(minR, st.r + grow);
      if (r <= 0 || !st.pts.length) continue;
      if (st.pts.length === 2) { g.beginPath(); g.arc(st.pts[0], st.pts[1], r, 0, TAU); g.fill(); continue; }
      g.lineWidth = 2 * r;
      g.beginPath();
      g.moveTo(st.pts[0], st.pts[1]);
      for (let i = 2; i < st.pts.length; i += 2) g.lineTo(st.pts[i], st.pts[i + 1]);
      g.stroke();
    }
  }
  // soft: width of the soft edge (inches); grow: how far the shape is grown (negative: the edge fades inside the brush)
  function regionMask(ctx, fx, soft, grow = -(soft || 0) * 0.5) {
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const key = `${W}x${H}|${m.a.toFixed(4)},${m.e.toFixed(1)},${m.f.toFixed(1)}|${strokeSig(fx)}|${soft}|${grow}`;
    const id = `${fx.id}|${soft}|${grow}`; // one per softness: the water under the surf has its own
    let e = maskCache.get(id);
    if (e && e.key === key) return e.c;
    const c = (e && e.c) || document.createElement('canvas');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.filter = soft > 0 ? `blur(${Math.max(0.5, soft * m.a).toFixed(1)}px)` : 'none';
    g.setTransform(m);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    drawStrokes(g, fx.strokes || [], grow);
    g.filter = 'none';
    if (maskCache.size > 60) maskCache.clear();
    maskCache.set(id, { key, c });
    return c;
  }
  // scratch canvases the size of the layer
  // Only the part of the layer the area covers is worked on (B: a box in device pixels), which keeps this cheap.
  const scratches = [];
  function scratch(i, W, H, B) {
    let c = scratches[i];
    if (!c) { c = document.createElement('canvas'); scratches[i] = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.filter = 'none';
    g.clearRect(B.x, B.y, B.w, B.h);
    return { c, g, B };
  }
  // the box an area covers on the layer (device pixels), with some room around it; null when off screen
  function regionBox(ctx, fx, pad = 0.5) {
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const st of fx.strokes || []) {
      const r = st.r + pad;
      for (let i = 0; i < st.pts.length; i += 2) {
        const x = st.pts[i]; const y = st.pts[i + 1];
        if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r; if (y - r < y0) y0 = y - r; if (y + r > y1) y1 = y + r;
      }
    }
    if (!(x1 > x0)) return null;
    const ax = Math.max(0, Math.floor(m.a * x0 + m.e)); const ay = Math.max(0, Math.floor(m.d * y0 + m.f));
    const bx = Math.min(W, Math.ceil(m.a * x1 + m.e)); const by = Math.min(H, Math.ceil(m.d * y1 + m.f));
    return bx > ax && by > ay ? { x: ax, y: ay, w: bx - ax, h: by - ay } : null;
  }
  // put a finished scratch canvas onto the layer, cut to the painted area
  function stamp(ctx, sc, mask, op = 'source-over', alpha = 1) {
    const B = sc.B;
    sc.g.setTransform(1, 0, 0, 1, 0, 0);
    sc.g.globalAlpha = 1;
    sc.g.globalCompositeOperation = 'destination-in';
    sc.g.drawImage(mask, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(sc.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    ctx.restore();
  }
  // Caustics: the bright net of light that ripples on shallow water (tileable, one per colour)
  const tiles = new Map();
  function causticTile(color) {
    const key = `c|${color}`;
    if (tiles.has(key)) return tiles.get(key);
    const N = 256; const G = 6; const cell = N / G;
    const pts = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + 0.15 + 0.7 * h(i * 31 + j * 7 + 1)) * cell, (j + 0.15 + 0.7 * h(i * 13 + j * 17 + 2)) * cell]);
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const [cr, cg, cb] = rgb(color);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ci = Math.floor(x / cell); const cj = Math.floor(y / cell);
        let f1 = 1e9; let f2 = 1e9;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = (ci + di + G) % G; const jj = (cj + dj + G) % G;
            const p = pts[jj * G + ii];
            const px = p[0] + (ci + di - ii) * cell; const py = p[1] + (cj + dj - jj) * cell;
            const d = Math.hypot(px - x, py - y);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
        }
        const e = f2 - f1;
        const v = Math.max(0, 1 - e / 9) ** 2.2;
        const o = (y * N + x) * 4;
        img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = Math.round(v * 255);
      }
    }
    g.putImageData(img, 0, 0);
    tiles.set(key, c);
    return c;
  }
  // soft value noise (tileable), white with the noise in its alpha
  function noiseTile() {
    if (tiles.has('noise')) return tiles.get('noise');
    const N = 128; const G = 8; const cell = N / G;
    const v = (i, j) => h(((i + G) % G) * 57 + ((j + G) % G) * 131 + 9);
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const sm = (x) => x * x * (3 - 2 * x);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = x / cell; const fy = y / cell; const i = Math.floor(fx); const j = Math.floor(fy);
        const u = sm(fx - i); const w = sm(fy - j);
        const a = v(i, j) * (1 - u) + v(i + 1, j) * u; const b = v(i, j + 1) * (1 - u) + v(i + 1, j + 1) * u;
        const n = a * (1 - w) + b * w;
        const o = (y * N + x) * 4;
        img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = Math.round(n * 255);
      }
    }
    g.putImageData(img, 0, 0);
    tiles.set('noise', c);
    return c;
  }
  // a texture in one colour (its alpha kept)
  const tints = new WeakMap(); // tile -> Map(colour -> tinted canvas)
  function tinted(tile, color) {
    let byColor = tints.get(tile);
    if (!byColor) { byColor = new Map(); tints.set(tile, byColor); }
    if (byColor.has(color)) return byColor.get(color);
    const c = document.createElement('canvas'); c.width = tile.width; c.height = tile.height;
    const g = c.getContext('2d');
    g.drawImage(tile, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    byColor.set(color, c);
    return c;
  }

  // =====================================================================
  // 4.9: soft light masks. A light shaft and a window light carry a picture of where their light falls; the dark is
  // cut away with it, so their sides fade smoothly instead of the hard steps of clipped shapes.
  //   L.mask = { img, ang, u0, v0, len, wid }: drawn turned by ang around the light's point, from (u0, v0), len × wid
  // =====================================================================
  const smoothstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function alphaSprite(key, w, hgt, fn) {
    if (tiles.has(key)) return tiles.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const g = c.getContext('2d');
    const im = g.createImageData(w, hgt);
    for (let j = 0; j < hgt; j++) {
      for (let i = 0; i < w; i++) {
        const o = (j * w + i) * 4;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = 255;
        im.data[o + 3] = Math.round(255 * Math.min(1, Math.max(0, fn((i + 0.5) / w, ((j + 0.5) / hgt) * 2 - 1))));
      }
    }
    g.putImageData(im, 0, 0);
    tiles.set(key, c);
    return c;
  }
  // a light shaft: u along it (0 where it comes in, 1 = 4.5 sizes on), v across (-1..1 = SHAFT_V sizes either side)
  const SHAFT_V = 1.2;
  const shaftHalf = (u) => 0.42 + 0.12 * u; // half its width in sizes, a little wider further on
  // where it lights the dark: a soft start, soft sides, fading out along its length
  const shaftCut = () => alphaSprite('shaft|cut', 256, 128, (u, v) => {
    const hw = shaftHalf(u); const d = Math.abs(v) * SHAFT_V;
    return smoothstep(0, 0.07, u) * (1 - smoothstep(0.4, 1, u)) ** 0.7 * (1 - smoothstep(hw * 0.62, hw * 1.5, d));
  });
  // its haze in the air: brightest where it comes in, thinning out
  const HAZE = [[0, 0.9], [0.12, 0.75], [0.6, 0.35], [1, 0]];
  const hazeAlong = (u) => { for (let i = 1; i < HAZE.length; i++) if (u <= HAZE[i][0]) { const [u0, a0] = HAZE[i - 1]; const [u1, a1] = HAZE[i]; return a0 + ((u - u0) / (u1 - u0)) * (a1 - a0); } return 0; };
  const shaftHaze = () => alphaSprite('shaft|haze', 256, 128, (u, v) => smoothstep(0, 0.05, u) * hazeAlong(u) * (1 - smoothstep(0, shaftHalf(u) * 2, Math.abs(v) * SHAFT_V)));

  // ---- window light ----
  const WINDOW_COLOR = '#ffe7b8';
  const WINDOW_ANGLE = 60;
  const winShape = (id) => FXDATA.WINDOW_SHAPES.find((x) => x.id === id) || FXDATA.WINDOW_SHAPES.find((x) => x.id === 'arched');
  const winGrid = (id) => FXDATA.WINDOW_GRIDS.find((x) => x.id === id) || FXDATA.WINDOW_GRIDS.find((x) => x.id === 'cross');
  // the window's outline; x runs from the sill (x0) to its top (x0 + NX), the way the light reaches into the room, y across
  function windowPath(g, id, x0, y0, NX, NY) {
    if (id === 'round') { g.ellipse(x0 + NX / 2, y0 + NY / 2, NX / 2, NY / 2, 0, 0, TAU); return; }
    if (id === 'arched') {
      const R = NY / 2; const xs = x0 + NX - R;
      g.moveTo(x0, y0); g.lineTo(xs, y0); g.arc(xs, y0 + R, R, -Math.PI / 2, Math.PI / 2); g.lineTo(x0, y0 + NY); g.closePath(); return;
    }
    if (id === 'gothic') {
      const Ha = NY * 0.95; const xs = x0 + NX - Ha;
      g.moveTo(x0, y0); g.lineTo(xs, y0);
      g.bezierCurveTo(xs + Ha * 0.55, y0, xs + Ha * 0.92, y0 + NY * 0.28, x0 + NX, y0 + NY / 2);
      g.bezierCurveTo(xs + Ha * 0.92, y0 + NY * 0.72, xs + Ha * 0.55, y0 + NY, xs, y0 + NY);
      g.lineTo(x0, y0 + NY); g.closePath(); return;
    }
    g.rect(x0, y0, NX, NY);
  }
  // the pictures of one kind of window: patch (the light on the floor, the bars' shadows soft), soft (its glow),
  // cut (what it takes out of the dark: the patch and some light around it), look (how lit each spot is, for the dust)
  function windowSprites(shapeId, gridId) {
    const S = winShape(shapeId); const G = winGrid(gridId);
    const key = `win|${S.id}|${G.id}`;
    if (tiles.has(key)) return tiles.get(key);
    const NX = 200; const NY = Math.round((NX * S.w) / S.h); const P = Math.round(Math.max(NX, NY) * 0.28);
    const W = NX + 2 * P; const H = NY + 2 * P;
    const blank = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const raw = blank(); const g = raw.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath(); windowPath(g, S.id, P, P, NX, NY); g.fill();
    // the bars: cut out of the light
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000'; g.lineCap = 'square';
    g.lineWidth = Math.max(2, Math.min(NX, NY) * (G.thin ? 0.028 : 0.05));
    g.beginPath();
    if (G.diamond) { // leaded diamonds, taller than wide
      const dy = NY / 3.2; const dx = dy * 1.5;
      for (let k = -Math.ceil(NY / dy) - 1; k <= Math.ceil(NX / dx) + Math.ceil(NY / dy) + 1; k++) {
        const ya = -4; const yb = NY + 4;
        g.moveTo(P + (k + 0.5 - ya / dy) * dx, P + ya); g.lineTo(P + (k + 0.5 - yb / dy) * dx, P + yb);
        g.moveTo(P + (k + 0.5 + ya / dy) * dx, P + ya); g.lineTo(P + (k + 0.5 + yb / dy) * dx, P + yb);
      }
    } else {
      // a wide window gets its panes the other way round, so they stay upright
      const cols = S.w > S.h ? G.rows : G.cols; const rows = S.w > S.h ? G.cols : G.rows;
      for (let k = 1; k < cols; k++) { const y = P + (NY * k) / cols; g.moveTo(P - 4, y); g.lineTo(P + NX + 4, y); }
      for (let k = 1; k < rows; k++) { const x = P + (NX * k) / rows; g.moveTo(x, P - 4); g.lineTo(x, P + NY + 4); }
    }
    g.stroke();
    const blurred = (px) => { const c = blank(); const x = c.getContext('2d'); x.filter = `blur(${px}px)`; x.drawImage(raw, 0, 0); x.filter = 'none'; return c; };
    const patch = blurred(Math.max(1, Math.min(NX, NY) * 0.022));
    const soft = blurred(Math.min(NX, NY) * 0.12);
    const cut = blank(); // in the dark: the patch, and the light it throws back into the room around it
    { const x = cut.getContext('2d'); x.globalAlpha = 0.6; x.drawImage(soft, 0, 0); x.globalAlpha = 1; x.drawImage(patch, 0, 0); }
    const N = 40; const look = new Float32Array(N * N);
    {
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d'); x.drawImage(patch, P, P, NX, NY, 0, 0, N, N);
      const d = x.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) look[i] = d[i * 4 + 3] / 255;
    }
    const out = { raw, patch, soft, cut, look, N, NX, NY, P, W, H, padX: P / NX, padY: P / NY };
    tiles.set(key, out);
    return out;
  }
  // the window and its bars as a little upright picture, for the effect's options (a data URL)
  const winIcons = new Map();
  function windowIcon(shapeId, gridId) {
    const S = winShape(shapeId); const G = winGrid(gridId);
    const key = `${S.id}|${G.id}`;
    if (winIcons.has(key)) return winIcons.get(key);
    const sp = windowSprites(S.id, G.id);
    const Z = 64; const c = document.createElement('canvas'); c.width = c.height = Z;
    const g = c.getContext('2d');
    const k = (Z * 0.84) / Math.max(sp.NX, sp.NY);
    g.translate(Z / 2, Z / 2); g.rotate(-Math.PI / 2); // the top of the window up
    g.drawImage(tinted(sp.raw, '#ffd98a'), -(sp.NX / 2 + sp.P) * k, -(sp.NY / 2 + sp.P) * k, sp.W * k, sp.H * k);
    const url = c.toDataURL();
    winIcons.set(key, url);
    return url;
  }
  // where a window's light lies, in its own turned frame: it starts a little way from the window and reaches
  // h × stretch along the light; wd across
  function windowRect(fx, r, sp) {
    const S = winShape(fx.shape);
    const st = Math.min(3, Math.max(1, fx.stretch ?? 1.5));
    const wd = S.w * r; const hp = S.h * r * st; const u0 = r * 0.2 * st;
    return { u0, hp, wd, x: u0 - sp.padX * hp, y: -wd / 2 - sp.padY * wd, w: hp * (1 + 2 * sp.padX), h: wd * (1 + 2 * sp.padY) };
  }
  // the mask a light shaft or a window light lights a dark map with (r: its size in map inches)
  function lightMask(f, r) {
    if (f.preset === 'shaft') return { img: shaftCut(), ang: ((f.angle ?? 35) * Math.PI) / 180, u0: 0, v0: -r * SHAFT_V, len: r * 4.5, wid: 2 * r * SHAFT_V, reach: r * 4.5 };
    if (f.preset === 'window') {
      const sp = windowSprites(f.shape, f.grid); const R = windowRect(f, r, sp);
      return { img: sp.cut, ang: ((f.angle ?? WINDOW_ANGLE) * Math.PI) / 180, u0: R.x, v0: R.y, len: R.w, wid: R.h, reach: R.u0 + R.hp };
    }
    return null;
  }
  function drawMask(ctx, L, img, a) {
    if (a <= 0.004) return;
    const M = L.mask;
    ctx.save();
    ctx.translate(L.x, L.y); ctx.rotate(M.ang);
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, M.u0, M.v0, M.len, M.wid);
    ctx.restore();
  }
  // a pattern laid over the map: tileIn inches per tile, moved by (ox, oy) inches, turned by rot degrees,
  // stretched sx times along its turned x axis
  function patternAt(g, tile, m, tileIn, ox, oy, rot = 0, sx = 1) {
    const pat = g.createPattern(tile, 'repeat');
    const k = (m.a * tileIn) / tile.width;
    // only the offset within one tile matters. Animation time is large (millions of seconds), and an
    // unwrapped offset loses so much precision on the graphics card that the texture turns into blocks
    const r = (rot * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
    let u = ox * c + oy * s; let v = -ox * s + oy * c;
    const pu = tileIn * sx;
    u -= Math.floor(u / pu) * pu; v -= Math.floor(v / tileIn) * tileIn;
    pat.setTransform(new DOMMatrix().translateSelf(m.e + (u * c - v * s) * m.a, m.f + (u * s + v * c) * m.a).rotateSelf(rot).scaleSelf(k * sx, k));
    return pat;
  }
  // water: a tint for depth, two drifting nets of caustic light and a few glints
  function waterBody(ctx, fx, t, opt = {}) {
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const I = fx.intensity ?? 1; const C = fx.color || null;
    const deep = C || '#2f8fbf'; const hi = C ? mix(C, '#ffffff', 0.7) : '#c9f1ff';
    const B = regionBox(ctx, fx, 0.4);
    if (!B) return;
    const sc = scratch(0, W, H, B);
    const g = sc.g;
    g.fillStyle = rgba(deep, 0.26 * I * (opt.tint ?? 1));
    g.fillRect(B.x, B.y, B.w, B.h);
    const tile = causticTile(hi);
    const size = (opt.angle != null ? 1.7 : 2.6) / Math.min(2.5, Math.max(0.4, fx.density ?? 1));
    const flow = opt.flow || [0, 0];
    const ang = opt.angle ?? null; const sx = opt.stretch || 1; // flowing water: the light lies stretched along the flow
    const still = ang == null ? 1 : 0.25; // a river barely drifts sideways
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, 0.42 * I * (opt.caustics ?? 1));
    g.fillStyle = patternAt(g, tile, m, size, t * 0.11 * still + flow[0] * t, t * 0.05 * still + flow[1] * t, ang ?? 0, sx);
    g.fillRect(B.x, B.y, B.w, B.h);
    g.globalAlpha = Math.min(1, 0.32 * I * (opt.caustics ?? 1));
    g.fillStyle = patternAt(g, tile, m, size * 1.37, -t * 0.08 * still + flow[0] * t * 0.8, t * 0.1 * still + flow[1] * t * 0.8, ang == null ? 33 : ang + 7, sx * 0.9);
    g.fillRect(B.x, B.y, B.w, B.h);
    stamp(ctx, sc, regionMask(ctx, fx, 0.3));
  }
  // ---------- strokes as smooth curves ----------
  // A hand-painted stroke wobbles and turns in small corners. Things that travel along it (river streaks,
  // surf fronts) follow an evenly spaced, smoothed copy instead, so they turn gradually instead of snapping.
  const smoothCache = new Map(); // area id + stroke -> { sig, f }
  function smoothLine(st, key) {
    const p = st.pts;
    const sig = `${p.length}|${st.r}|${p[0]},${p[1]}|${p[p.length - 2]},${p[p.length - 1]}`;
    const hit = smoothCache.get(key);
    if (hit && hit.sig === sig) return hit.f;
    // evenly spaced points
    const step = Math.max(0.06, Math.min(0.25, st.r * 0.15));
    const P = [[p[0], p[1]]];
    let carry = 0;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2]; const ay = p[i - 1]; const bx = p[i]; const by = p[i + 1];
      const d = Math.hypot(bx - ax, by - ay);
      if (!(d > 0)) continue;
      let k = step - carry;
      for (; k <= d; k += step) P.push([ax + ((bx - ax) * k) / d, ay + ((by - ay) * k) / d]);
      carry = d - (k - step);
    }
    const lx = p[p.length - 2]; const ly = p[p.length - 1]; const lp = P[P.length - 1];
    if (P.length < 2 || Math.hypot(lx - lp[0], ly - lp[1]) > step * 0.3) P.push([lx, ly]);
    // two moving averages over about the brush radius; the ends stay where they were painted
    const w = Math.max(1, Math.round((st.r * 0.9) / step));
    let Q = P;
    for (let pass = 0; pass < 2; pass++) {
      const n = Q.length; const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const k = Math.min(w, i, n - 1 - i);
        let x = 0; let y = 0;
        for (let j = i - k; j <= i + k; j++) { x += Q[j][0]; y += Q[j][1]; }
        out[i] = [x / (2 * k + 1), y / (2 * k + 1)];
      }
      Q = out;
    }
    const L = [0];
    for (let i = 1; i < Q.length; i++) L.push(L[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
    const T = Q.map((_, i) => {
      const a = Q[Math.max(0, i - 1)]; const b = Q[Math.min(Q.length - 1, i + 1)];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    });
    const f = { st, P: Q, T, L, len: L[L.length - 1] };
    if (smoothCache.size > 300) smoothCache.clear();
    smoothCache.set(key, { sig, f });
    return f;
  }
  function flowLines(fx) {
    return (fx.strokes || []).map((st, i) => (st.pts.length >= 4 ? smoothLine(st, `${fx.id}|${st.sid || i}`) : null)).filter((f) => f && f.len > 0.05);
  }
  // a point on the curve and its direction, both changing smoothly
  function along(f, d) {
    const L = f.L; const P = f.P; const T = f.T;
    d = clamp(d, 0, f.len);
    let lo = 0; let hi = L.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= d) lo = mid; else hi = mid; }
    const u = clamp((d - L[lo]) / (L[hi] - L[lo] || 1), 0, 1);
    let dx = T[lo][0] + (T[hi][0] - T[lo][0]) * u; let dy = T[lo][1] + (T[hi][1] - T[lo][1]) * u;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    return { x: P[lo][0] + (P[hi][0] - P[lo][0]) * u, y: P[lo][1] + (P[hi][1] - P[lo][1]) * u, dx, dy };
  }
  // the direction over a stretch of the curve: a wave front spans the whole stroke, so it turns with the average
  function heading(f, d, span) {
    let x = 0; let y = 0;
    for (let i = -4; i <= 4; i++) { const q = along(f, d + (i / 4) * span); x += q.dx; y += q.dy; }
    const l = Math.hypot(x, y) || 1;
    return { dx: x / l, dy: y / l };
  }
  // blood: drawn once into its own canvas (it does not move), except while a fresh stroke spreads
  const bloodCache = new Map();
  // seconds since a stroke was painted (strokes remember when; older files don't, they count as old)
  const strokeAge = (st) => (st.t0 ? Math.max(0, (Date.now() - st.t0) / 1000) : 99);
  function blood(ctx, fx) {
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const I = fx.intensity ?? 1; const base = fx.color || '#5d0909';
    const ages = (fx.strokes || []).map(strokeAge);
    const spreading = ages.some((a) => a < 1.7);
    const key = `${W}x${H}|${m.a.toFixed(4)},${m.e.toFixed(1)},${m.f.toFixed(1)}|${strokeSig(fx)}|${base}|${I}|${fx.density ?? 1}`;
    const cached = bloodCache.get(fx.id);
    const B = regionBox(ctx, fx, Math.max(...(fx.strokes || []).map((st) => st.r), 0.2) * 5.5); // room for the spatter and trails
    if (!B) return;
    if (!spreading && cached && cached.key === key) { drawFlat(ctx, cached.c, B); return; }
    const c = (cached && cached.c) || document.createElement('canvas');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(m);
    const s0 = seedOf(fx.id);
    const dark = mix(base, '#000000', 0.45);
    const drops = Math.min(4, Math.max(0.2, fx.density ?? 1));
    (fx.strokes || []).forEach((st, si) => {
      const grow = ages[si] >= 1.6 ? 1 : 1 - (1 - Math.min(1, ages[si] / 1.6)) ** 2; // spreads out when freshly painted
      const r = st.r * (0.35 + 0.65 * grow);
      // points along the stroke, a little apart
      const pts = [];
      const step = Math.max(0.05, st.r * 0.35);
      for (let i = 0; i < st.pts.length; i += 2) {
        const x = st.pts[i]; const y = st.pts[i + 1];
        if (i >= 2) {
          const px = st.pts[i - 2]; const py = st.pts[i - 1]; const d = Math.hypot(x - px, y - py);
          for (let k = step; k < d; k += step) pts.push([px + ((x - px) * k) / d, py + ((y - py) * k) / d]);
        }
        pts.push([x, y]);
      }
      const ss = s0 + si * 97 + (st.sid ? seedOf(String(st.sid)) : 0);
      // the pool (Beta 2.4): its width wanders along the stroke (thick, thin, sometimes breaking up into drops),
      // it drifts to the sides, lumps bulge out and short runs reach out of the edge, so it never reads as a tube
      const vn = (x, sd) => { const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f); return h(sd + i * 1.37) * (1 - u) + h(sd + (i + 1) * 1.37) * u; };
      const discs = []; // [x, y, radius] of the pool
      let along = 0;
      pts.forEach(([x, y], j) => {
        if (j) along += Math.hypot(x - pts[j - 1][0], y - pts[j - 1][1]);
        const a = pts[Math.max(0, j - 1)]; const b = pts[Math.min(pts.length - 1, j + 1)];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const tx = (b[0] - a[0]) / tl; const ty = (b[1] - a[1]) / tl;
        const k = along / (st.r * 2);
        const thick = vn(k, ss + 1.1) * 0.75 + vn(k * 2.7, ss + 5.3) * 0.25;
        const off = (vn(k * 1.3, ss + 2.9) - 0.5) * r * 0.8;
        const cx = x - ty * off; const cy = y + tx * off;
        if (pts.length > 3 && thick < 0.3) { // here it breaks up into a few drops
          if (h(ss + j * 2.1) < 0.55) discs.push([cx + (h(ss + j * 4.3) - 0.5) * r * 0.6, cy + (h(ss + j * 6.1) - 0.5) * r * 0.6, r * (0.1 + 0.22 * h(ss + j * 8.9))]);
          return;
        }
        discs.push([cx, cy, r * (0.2 + 1.1 * thick ** 1.6) * (0.85 + 0.3 * h(ss + j * 3.1))]);
      });
      // lumps bulging out (a single dab gets several, so it is never a round ball)
      const base0 = discs.slice();
      base0.forEach(([x, y, rr], j) => {
        const nl = pts.length <= 3 ? 5 + Math.floor(h(ss + j) * 4) : h(ss + j * 4.7) < 0.22 ? 1 + Math.floor(h(ss + j * 5.9) * 2) : 0;
        for (let q = 0; q < nl; q++) {
          const a = h(ss + j * 7.1 + q * 2.7) * TAU; const d = rr * (0.45 + 0.5 * h(ss + j * 9.3 + q));
          discs.push([x + Math.cos(a) * d, y + Math.sin(a) * d, rr * (0.25 + 0.45 * h(ss + j * 3.7 + q * 1.9))]);
        }
      });
      g.globalAlpha = Math.min(1, 0.92 * I);
      g.fillStyle = base;
      g.beginPath();
      for (const [x, y, rr] of discs) { g.moveTo(x + rr, y); g.arc(x, y, rr, 0, TAU); }
      // short runs reaching out of the edge
      discs.forEach(([x, y, rr], j) => {
        if (rr < r * 0.25 || h(ss + j * 12.7) > 0.35) return;
        const a = h(ss + j * 14.3) * TAU; const len = rr * (0.3 + 0.5 * h(ss + j * 15.1)); const w = rr * (0.07 + 0.1 * h(ss + j * 16.7));
        const ex = x + Math.cos(a) * (rr * 0.9 + len * 0.5); const ey = y + Math.sin(a) * (rr * 0.9 + len * 0.5);
        g.moveTo(ex + Math.cos(a) * len * 0.5, ey + Math.sin(a) * len * 0.5); g.ellipse(ex, ey, len * 0.5 + w, w, a, 0, TAU);
      });
      g.fill();
      g.globalAlpha = Math.min(1, 0.5 * I);
      g.fillStyle = dark;
      g.filter = `blur(${Math.max(1, r * 0.3 * m.a).toFixed(1)}px)`; // a soft darker middle where it is deep
      g.beginPath();
      for (const [x, y, rr] of discs) { if (rr < r * 0.3) continue; const dr = rr * 0.5; g.moveTo(x + dr, y); g.arc(x, y, dr, 0, TAU); }
      g.fill();
      g.filter = 'none';
      if (grow > 0.5) { // drops of every size around it, and a few trails of drops getting smaller
        g.globalAlpha = Math.min(1, 0.9 * I * Math.min(1, (grow - 0.5) * 2));
        g.fillStyle = base;
        g.beginPath();
        pts.forEach(([x, y], j) => {
          const n = Math.floor(h(ss + j * 7.3) * 2.6 * drops);
          for (let q = 0; q < n; q++) {
            const a = h(ss + j * 11.1 + q * 3.3) * TAU; const d = st.r * (0.9 + 1.4 * h(ss + j * 13.7 + q) ** 1.3);
            const dr = st.r * (0.025 + 0.2 * h(ss + j * 17.9 + q) ** 3);
            const ex = x + Math.cos(a) * d; const ey = y + Math.sin(a) * d;
            g.moveTo(ex + dr * 1.4, ey); g.ellipse(ex, ey, dr * (1 + 0.6 * h(ss + j * 19.3 + q)), dr, a, 0, TAU);
          }
        });
        const trails = Math.max(1, Math.round((1 + pts.length / 6) * Math.min(2, drops)));
        for (let q = 0; q < trails; q++) {
          const [x, y] = pts[Math.floor(h(ss + q * 21.7) * pts.length)];
          const a = h(ss + q * 23.3) * TAU; const curve = (h(ss + q * 25.1) - 0.5) * 0.5;
          let d = st.r * (0.8 + 0.4 * h(ss + q * 27.9)); let dr = st.r * (0.08 + 0.1 * h(ss + q * 29.3));
          const nd = 4 + Math.floor(h(ss + q * 31.1) * 6);
          for (let k = 0; k < nd && dr > 0.008 && d < st.r * 5; k++) {
            const ak = a + curve * k * 0.3;
            const ex = x + Math.cos(ak) * d; const ey = y + Math.sin(ak) * d;
            g.moveTo(ex + dr, ey); g.arc(ex, ey, dr, 0, TAU);
            d += dr * 2 + st.r * (0.12 + 0.25 * h(ss + q * 33 + k));
            dr *= 0.68 + 0.2 * h(ss + q * 35 + k);
          }
        }
        g.fill();
      }
      // fine spatter: many tiny drops further out, some drawn out into a tail pointing away from the pool.
      // It lands at once (only the pool spreads) and Amount sets how much there is.
      const spat = Math.round((14 + pts.length * 4) * drops);
      g.globalAlpha = Math.min(1, 0.95 * I * Math.min(1, ages[si] / 0.2));
      g.fillStyle = base;
      g.beginPath();
      for (let q = 0; q < spat; q++) {
        const [x, y] = pts[Math.floor(h(ss + q * 5.3 + 0.7) * pts.length)];
        const a = h(ss + q * 7.7 + 0.3) * TAU;
        const d = st.r * (0.95 + 2.3 * h(ss + q * 9.1 + 0.1) ** 1.6);
        const dr = Math.max(0.01, st.r * (0.012 + 0.09 * h(ss + q * 3.9 + 0.9) ** 3));
        const cx = x + Math.cos(a) * d; const cy = y + Math.sin(a) * d;
        if (h(ss + q * 2.3 + 0.5) < 0.4) { // a tail: the drop was still flying outwards when it hit
          const tl = dr * (2.5 + 3.5 * h(ss + q * 6.1 + 0.2));
          g.moveTo(cx + Math.cos(a) * (tl + dr), cy + Math.sin(a) * (tl + dr));
          g.ellipse(cx + Math.cos(a) * tl * 0.5, cy + Math.sin(a) * tl * 0.5, tl * 0.5 + dr, dr * 0.5, a, 0, TAU);
        }
        g.moveTo(cx + dr, cy); g.arc(cx, cy, dr, 0, TAU);
      }
      g.fill();
      // a wet sheen
      g.globalAlpha = Math.min(1, 0.09 * I);
      g.fillStyle = '#ffffff';
      g.filter = `blur(${Math.max(0.5, r * 0.05 * m.a).toFixed(1)}px)`;
      pts.forEach(([x, y], j) => { if (j % 5) return; const rr = r * 0.07; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.3, rr * 2.2, rr, -0.6, 0, TAU); g.fill(); });
      g.filter = 'none';
    });
    g.globalAlpha = 1;
    bloodCache.set(fx.id, { key: spreading ? '' : key, c });
    drawFlat(ctx, c, B);
  }
  function drawFlat(ctx, c, B) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    ctx.restore();
  }
  // the middle of a painted area (for things that turn around it)
  function centreOf(fx) {
    let x = 0; let y = 0; let n = 0;
    for (const st of fx.strokes || []) for (let i = 0; i < st.pts.length; i += 2) { x += st.pts[i]; y += st.pts[i + 1]; n++; }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }

  // ---------- Beta 2: helpers for the new painted areas ----------
  // points along the painted strokes, about step × brush radius apart: [x, y, r]
  function samples(fx, step = 0.5) {
    const out = [];
    for (const st of fx.strokes || []) {
      const p = st.pts; const d0 = Math.max(0.05, st.r * step);
      for (let i = 0; i < p.length; i += 2) {
        if (i >= 2) {
          const px = p[i - 2]; const py = p[i - 1]; const d = Math.hypot(p[i] - px, p[i + 1] - py);
          for (let k = d0; k < d; k += d0) out.push([px + ((p[i] - px) * k) / d, py + ((p[i + 1] - py) * k) / d, st.r]);
        }
        out.push([p[i], p[i + 1], st.r]);
      }
    }
    return out;
  }
  // a part of an area that does not move, drawn once into its own small canvas (the box the area covers)
  const flatCache = new Map();
  function flat(ctx, fx, tag, pad, draw) {
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const B = regionBox(ctx, fx, pad);
    if (!B) return null;
    flatPad.set(fx.id, pad);
    const key = `${W}x${H}|${m.a.toFixed(4)},${m.e.toFixed(1)},${m.f.toFixed(1)}|${B.x},${B.y},${B.w},${B.h}|${strokeSig(fx)}|${fx.color}|${fx.intensity ?? 1}|${fx.density ?? 1}`;
    const id = `${fx.id}|${tag}`;
    let e = flatCache.get(id);
    if (!e || e.key !== key) {
      const c = (e && e.c) || document.createElement('canvas');
      if (c.width !== B.w || c.height !== B.h) { c.width = B.w; c.height = B.h; }
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      g.clearRect(0, 0, B.w, B.h);
      g.setTransform(m.a, m.b, m.c, m.d, m.e - B.x, m.f - B.y);
      g.lineCap = 'round'; g.lineJoin = 'round';
      draw(g, m, B);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
      if (flatCache.size > 60) flatCache.clear();
      e = { key, c };
      flatCache.set(id, e);
    }
    return { c: e.c, B };
  }
  // the box of the flat canvas being drawn (cutTo needs it inside flat's draw)
  const F0 = (ctx, fx) => regionBox(ctx, fx, flatPad.get(fx.id) ?? 0.4);
  const flatPad = new Map();
  // cut a flat canvas to the painted area (the area's own soft mask)
  function cutTo(g, mask, B) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, B.x, B.y, B.w, B.h, 0, 0, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
  }
  function putFlat(ctx, F, op = 'source-over', alpha = 1, dx = 0, dy = 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(F.c, F.B.x + dx, F.B.y + dy);
    ctx.restore();
  }
  // the way a painted area "flows" (river, wind over grass): the average direction of its strokes
  function flowDir(fx, s) {
    let x = 0; let y = 0;
    for (const f of flowLines(fx)) { const P = f.P; x += P[P.length - 1][0] - P[0][0]; y += P[P.length - 1][1] - P[0][1]; }
    const l = Math.hypot(x, y);
    if (l > 0.3) return [x / l, y / l];
    const a = h(s + 0.77) * TAU;
    return [Math.cos(a), Math.sin(a)];
  }
  // a rainbow film (oil): colour changes with a soft noise, tileable
  function filmTile() {
    if (tiles.has('film')) return tiles.get('film');
    const n = noiseTile();
    const N = n.width;
    const src = n.getContext('2d').getImageData(0, 0, N, N).data;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = src[i * 4 + 3] / 255;
      const hue = (v * 2.2) % 1; // two turns of the colour wheel across the noise
      const k = (q) => { const x = (q + hue * 6) % 6; return Math.max(0, Math.min(1, Math.abs(x - 3) - 1)); };
      img.data[i * 4] = Math.round(255 * (0.35 + 0.65 * k(0)));
      img.data[i * 4 + 1] = Math.round(255 * (0.35 + 0.65 * k(4)));
      img.data[i * 4 + 2] = Math.round(255 * (0.35 + 0.65 * k(2)));
      img.data[i * 4 + 3] = Math.round(255 * (0.25 + 0.75 * Math.abs(Math.sin(v * 9))));
    }
    g.putImageData(img, 0, 0);
    tiles.set('film', c);
    return c;
  }
  // lights a painted area throws on a dark map (lava, burning ground): points along it, a few inches apart
  function regionLightsRaw(fx) {
    if (fx.preset !== 'lava' && fx.preset !== 'burning' && fx.preset !== 'glow') return [];
    const pts = samples(fx, 1.6);
    const step = Math.max(1, Math.ceil(pts.length / 24));
    const out = [];
    const glowing = fx.preset === 'glow';
    const col = fx.color || (fx.preset === 'lava' ? '#ff6a1a' : glowing ? '#8fe3ff' : '#ff8a2a');
    for (let i = 0; i < pts.length; i += step) {
      const [x, y, r] = pts[i];
      out.push({ x, y, B: r * (glowing ? 0.6 : 0.9), D: r * (glowing ? 1.4 : 1.9) + (glowing ? 0.6 : 1.2), color: col, sat: glowing ? 0.65 : 0.45, flicker: fx.preset === 'burning', strength: Math.min(1, (fx.intensity ?? 1) * (glowing ? 0.5 : 0.85)), s: seedOf(fx.id) + i });
    }
    return out;
  }

  // 4.5: a painted area is drawn in grid squares: its ripples, cracks, glints and soft edges shrink and grow
  // with the map's grid (k: the size of one square), the way placed effects do. The strokes are scaled down
  // into squares once (cached) and the canvas scaled up by k.
  const unitStrokes = new WeakMap();
  function inSquares(fx, k) {
    if (!(k > 0) || Math.abs(k - 1) < 1e-6 || !fx.strokes) return fx;
    const sig = strokeSig(fx);
    let e = unitStrokes.get(fx.strokes);
    if (!e || e.k !== k || e.sig !== sig) {
      e = { k, sig, strokes: fx.strokes.map((st) => ({ ...st, r: st.r / k, pts: st.pts.map((v) => v / k) })) };
      unitStrokes.set(fx.strokes, e);
    }
    return { ...fx, strokes: e.strokes };
  }
  function region(ctx, fx, t, k = 1) {
    const u = inSquares(fx, k);
    if (u === fx) { regionRaw(ctx, fx, t); return; }
    ctx.save();
    ctx.scale(k, k);
    try { regionRaw(ctx, u, t); } finally { ctx.restore(); }
  }
  function regionLights(fx, k = 1) {
    const u = inSquares(fx, k);
    const out = regionLightsRaw(u);
    if (u !== fx) for (const L of out) { L.x *= k; L.y *= k; L.B *= k; L.D *= k; }
    return out;
  }
  function regionRaw(ctx, fx, t) {
    const pts = [];
    for (const st of fx.strokes || []) for (let i = 0; i < st.pts.length; i += 2) pts.push([st.pts[i], st.pts[i + 1], st.r]);
    if (!pts.length) return;
    const s = seedOf(fx.id);
    const I = fx.intensity ?? 1;
    const C = fx.color || null;
    t *= fx.speed ?? 1;
    const n = Math.min(160, count(8 + pts.length * 2, fx));
    const at = (i, salt) => {
      const p = pts[Math.floor(h(s + i * 13 + salt) * pts.length)];
      const a = h(s + i * 17 + salt) * TAU; const d = Math.sqrt(h(s + i * 19 + salt)) * p[2];
      return [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, p[2]];
    };
    switch (fx.preset) {
      case 'mist': { // drifting wisps and slow puffs, kept to the painted area
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const col = C || '#dfe4ec';
        const B = regionBox(ctx, fx, 0.9);
        if (!B) break;
        const sc = scratch(0, W, H, B); const g = sc.g;
        const a0 = h(s + 0.5) * TAU; const wx = Math.cos(a0); const wy = Math.sin(a0); // the way this mist drifts
        const tn = tinted(noiseTile(), col);
        // two layers of wisps drifting at different speeds and angles; only where both are thick is the mist
        // thick, so its shape keeps changing instead of sliding past as one picture
        g.globalAlpha = Math.min(1, 0.8 * I);
        g.fillStyle = patternAt(g, tn, m, 5.5, wx * t * 0.17, wy * t * 0.17, 20);
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = patternAt(g, tn, m, 3.6, (wx * 0.8 - wy * 0.55) * t * 0.11, (wy * 0.8 + wx * 0.55) * t * 0.11, -35);
        g.fillRect(B.x, B.y, B.w, B.h);
        // a thin, even haze underneath
        g.globalCompositeOperation = 'destination-over';
        g.fillStyle = rgba(col, Math.min(1, 0.12 * I));
        g.fillRect(B.x, B.y, B.w, B.h);
        // puffs that drift along, swell and fade
        g.globalCompositeOperation = 'source-over';
        g.setTransform(m);
        const puff = sprite(col);
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 0);
          const life = fract(t / (8 + 7 * h(s + i * 3)) + h(s + i * 5));
          const dd = (life - 0.5) * 1.4 * Math.min(1.6, r);
          dot(g, puff, px + wx * dd, py + wy * dd, r * (0.45 + 0.5 * life) * (0.75 + 0.5 * h(s + i)), 0.16 * Math.sin(Math.PI * life) * I);
        }
        stamp(ctx, sc, regionMask(ctx, fx, 0.6, 0.15));
        break;
      }
      case 'water': { // shallow water: caustic light, glints
        waterBody(ctx, fx, t);
        ctx.globalCompositeOperation = 'lighter';
        const gl = C ? mix(C, '#ffffff', 0.8) : '#eafcff';
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 1);
          const sh = Math.max(0, Math.sin(t * (1.1 + h(s + i * 3)) + h(s + i * 7) * TAU)) ** 8;
          dot(ctx, sprite(gl, 0.5), px, py, r * 0.05, 0.9 * sh * I, 2.4);
        }
        break;
      }
      case 'current': { // a river: the water moves the way the stroke was painted, foam streaks ride along
        const lines = flowLines(fx);
        let fdx = 0; let fdy = 0; let tl = 0;
        for (const f of lines) { const P = f.P; fdx += P[P.length - 1][0] - P[0][0]; fdy += P[P.length - 1][1] - P[0][1]; tl += f.len; }
        const fl = Math.hypot(fdx, fdy) || 1;
        const straight = tl > 0 ? Math.min(1, fl / tl) : 0; // a winding river gets less stretched light
        const v = 0.9; // inches per second at speed 1
        waterBody(ctx, fx, t, { flow: [(fdx / fl) * v * 0.6, (fdy / fl) * v * 0.6], caustics: 0.7,
          angle: (Math.atan2(fdy, fdx) * 180) / Math.PI, stretch: 1 + 1.6 * straight });
        ctx.globalCompositeOperation = 'source-over';
        const foam = C ? mix(C, '#ffffff', 0.85) : '#f2fbff';
        const f0 = rgba(foam, 0); const fm = rgba(foam, 0.75); const f1 = rgba(foam, 1);
        const minW = 1 / Math.max(1e-6, ctx.getTransform().a); // never thinner than a pixel
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        lines.forEach((f, li) => {
          const r = f.st.r;
          const k = Math.min(180, count(Math.ceil(f.len * 3.5 * Math.max(1, r)), fx));
          for (let i = 0; i < k; i++) {
            const sd = s + li * 71 + i * 13;
            const life = fract(h(sd) + (t * v) / f.len * (0.7 + 0.6 * h(sd + 5)));
            const lat = (h(sd + 3) - 0.5) * 1.5 * r;
            const A = I * Math.min(1, 1.6 * Math.sin(Math.PI * life)) * (1 - Math.abs(lat) / (r * 0.9));
            if (A <= 0.02) continue;
            const len = (0.35 + 0.65 * h(sd + 7)) * Math.min(1, r);
            const d0 = life * f.len - len;
            // the streak bends with the river and fades in at its tail and out at its head
            const path = new Path2D(); let x0 = 0; let y0 = 0; let x1 = 0; let y1 = 0;
            for (let j = 0; j <= 5; j++) {
              const q = along(f, d0 + (len * j) / 5);
              const x = q.x - q.dy * lat; const y = q.y + q.dx * lat;
              if (j) path.lineTo(x, y); else { path.moveTo(x, y); x0 = x; y0 = y; }
              x1 = x; y1 = y;
            }
            if (Math.hypot(x1 - x0, y1 - y0) < 0.02) continue;
            const gr = ctx.createLinearGradient(x0, y0, x1, y1);
            gr.addColorStop(0, f0); gr.addColorStop(0.3, fm); gr.addColorStop(0.65, f1); gr.addColorStop(1, f0);
            ctx.strokeStyle = gr;
            ctx.globalAlpha = Math.min(1, A);
            ctx.lineWidth = Math.max(minW, 0.02 + 0.025 * h(sd + 9));
            ctx.stroke(path);
          }
        });
        break;
      }
      case 'surf': { // waves roll in the way the stroke was painted and break at its end (paint from the sea to the shore)
        waterBody(ctx, fx, t, { caustics: 0.5, tint: 1.25 });
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const B = regionBox(ctx, fx, 0.4);
        if (!B) break;
        const sc = scratch(1, W, H, B); const g = sc.g;
        const foam = C ? mix(C, '#ffffff', 0.85) : '#ffffff';
        g.setTransform(m);
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = foam;
        const v = 0.55 * (fx.speed ?? 1); // inches per second
        flowLines(fx).forEach((f, li) => {
          const r = f.st.r;
          const nw = Math.max(2, Math.round(f.len / 1.5));
          for (let k = 0; k < nw; k++) {
            const u = fract((t * v) / f.len + k / nw + h(s + li * 3));
            const q = along(f, u * f.len);
            const hd = heading(f, u * f.len, 1.3 * r); // the front faces the average way over its width
            const nx = -hd.dy; const ny = hd.dx;
            const a = Math.min(1, u / 0.15) * (u > 0.86 ? Math.max(0, 1 - (u - 0.86) / 0.14) : 1);
            if (a <= 0.02) continue;
            // the wave front: a soft band across the stroke, bulging forward, thicker as it nears the shore
            const front = new Path2D();
            for (let j = 0; j <= 16; j++) {
              const sl = (j / 16 - 0.5) * 2.4 * r;
              const bulge = 0.3 * r * (1 - (sl / (1.2 * r)) ** 2) + 0.025 * Math.sin(j * 1.3 + k * 2.3 + t * 1.5);
              const x = q.x + nx * sl + hd.dx * bulge; const y = q.y + ny * sl + hd.dy * bulge;
              if (j) front.lineTo(x, y); else front.moveTo(x, y);
            }
            const w = 0.06 + 0.13 * u * u;
            const A = Math.min(1, (0.3 + 0.6 * u) * a * I);
            for (const [lw, al] of [[3.6, 0.22], [1.7, 0.55], [0.7, 1]]) { g.globalAlpha = A * al; g.lineWidth = w * lw; g.stroke(front); }
            // breaking: spray along the front
            if (u > 0.72) {
              const br = (u - 0.72) / 0.28;
              for (let j = 0; j < 10; j++) {
                const sl = (h(s + k * 31 + j) - 0.5) * 2.2 * r;
                dot(g, sprite(foam), q.x + nx * sl + hd.dx * 0.15, q.y + ny * sl + hd.dy * 0.15, 0.12 + 0.25 * br, 0.5 * a * br * I);
              }
            }
          }
          // foam that stays where the waves end
          const end = along(f, f.len); const eh = heading(f, f.len, 1.3 * r);
          for (let j = 0; j < 16; j++) {
            const sl = (h(s + li * 7 + j * 3) - 0.5) * 2.2 * r; const back = h(s + j * 11) * r * 0.5;
            dot(g, sprite(foam), end.x - eh.dy * sl - eh.dx * back, end.y + eh.dx * sl - eh.dy * back, 0.1 + 0.12 * h(s + j), (0.25 + 0.2 * Math.sin(t * 1.3 + j)) * I);
          }
        });
        // foam is never a clean line: drifting noise breaks it up
        const nz = scratch(2, W, H, B); const ng = nz.g;
        ng.fillStyle = patternAt(ng, noiseTile(), m, 0.9, t * 0.04, t * 0.03, 25);
        ng.fillRect(B.x, B.y, B.w, B.h);
        ng.fillStyle = 'rgba(255,255,255,0.35)';
        ng.fillRect(B.x, B.y, B.w, B.h);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(nz.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
        stamp(ctx, sc, regionMask(ctx, fx, 0.15));
        break;
      }
      case 'blood':
        blood(ctx, fx);
        break;
      case 'acid': { // a green pool that bubbles and fumes
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const base = C || '#7bd63a'; const glow = C ? mix(C, '#ffffff', 0.55) : '#d9ff8a';
        const B = regionBox(ctx, fx, 0.4);
        if (!B) break;
        const sc = scratch(0, W, H, B); const g = sc.g;
        g.fillStyle = rgba(mix(base, '#000000', 0.25), 0.5 * I);
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, 0.35 * I);
        g.fillStyle = patternAt(g, causticTile(glow), m, 1.8, t * 0.03, -t * 0.02, 12);
        g.fillRect(B.x, B.y, B.w, B.h);
        stamp(ctx, sc, regionMask(ctx, fx, 0.25));
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 6);
          const ph = fract(t * 0.55 + h(s + i * 5));
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = Math.min(1, (1 - ph) * 0.7 * I);
          ctx.strokeStyle = glow;
          ctx.lineWidth = Math.max(0.01, r * 0.025);
          ctx.beginPath(); ctx.arc(px, py, r * 0.09 * (0.25 + ph), 0, TAU); ctx.stroke();
          if (ph > 0.85) { ctx.globalCompositeOperation = 'lighter'; dot(ctx, sprite(glow, 0.3), px, py, r * 0.12, (ph - 0.85) * 4 * I); }
          const fph = fract(t * 0.12 + h(s + i * 11));
          ctx.globalCompositeOperation = 'source-over';
          dot(ctx, sprite(glow), px + Math.sin(t * 0.3 + i) * r * 0.3, py - fph * r * 0.6, r * (0.3 + fph * 0.5), 0.07 * Math.sin(Math.PI * fph) * I);
        }
        break;
      }
      case 'darkness': { // magical darkness: black ink, fully opaque where painted, faint swirls turning inside
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const ink = C ? mix(C, '#000000', 0.55) : '#020104'; const swirl = C ? mix(C, '#000000', 0.25) : '#160c24';
        const ctr = centreOf(fx);
        const B = regionBox(ctx, fx, 0.9);
        if (!B) break;
        const sc = scratch(0, W, H, B); const g = sc.g;
        g.fillStyle = rgba(ink, Math.min(1, I));
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalCompositeOperation = 'source-atop';
        const tn = tinted(noiseTile(), swirl);
        for (const [k, dir, a] of [[2.6, 1, 0.42], [1.4, -1.6, 0.28]]) {
          const pat = g.createPattern(tn, 'repeat');
          const sk = (m.a * k) / tn.width;
          pat.setTransform(new DOMMatrix().translateSelf(m.e + ctr.x * m.a, m.f + ctr.y * m.a).rotateSelf((t * 3 * dir) % 360).scaleSelf(sk, sk));
          g.globalAlpha = a;
          g.fillStyle = pat;
          g.fillRect(B.x, B.y, B.w, B.h);
        }
        // the soft edge lies outside the brush: everything painted is fully dark
        stamp(ctx, sc, regionMask(ctx, fx, 0.15, 0.22));
        break;
      }
      case 'lava': {
        ctx.globalCompositeOperation = 'lighter';
        const base = C || '#ff5a1a'; const hot = C ? mix(C, '#ffffff', 0.6) : '#ffd36b'; const em = C ? mix(C, '#ffffff', 0.35) : '#ffb347';
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 2);
          const pulse = 0.7 + 0.3 * Math.sin(t * 0.8 + i);
          dot(ctx, sprite(base), px, py, r * 0.8, 0.12 * pulse * I);
          const ph = fract(t * 0.5 + h(s + i * 3));
          dot(ctx, sprite(hot, 0.5), px, py, r * 0.12 * ph, (1 - ph) * 0.8 * I);
          const eph = fract(t * 0.35 + h(s + i * 9));
          dot(ctx, sprite(em, 0.4), px + Math.sin(t + i) * r * 0.2, py - eph * r * 1.5, r * 0.04, (1 - eph) * 0.7 * I);
        }
        break;
      }
      case 'swamp': {
        ctx.globalCompositeOperation = 'source-over';
        const base = C || '#6f8a3a'; const bub = C ? mix(C, '#ffffff', 0.5) : '#c8e68a';
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 3);
          dot(ctx, sprite(base), px + Math.sin(t * 0.1 + i) * r * 0.4, py, r * 0.9, 0.08 * I);
          const ph = fract(t * 0.4 + h(s + i * 5));
          ctx.globalAlpha = Math.min(1, (1 - ph) * 0.5 * I);
          ctx.strokeStyle = bub;
          ctx.lineWidth = r * 0.02;
          ctx.beginPath(); ctx.arc(px, py, r * 0.08 * (0.3 + ph), 0, TAU); ctx.stroke();
        }
        break;
      }
      case 'dust':
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 4);
          const dx = Math.sin(t * 0.2 + i * 1.3) * r * 0.5; const dy = Math.cos(t * 0.15 + i) * r * 0.5;
          dot(ctx, sprite(C || '#f1e2c4', 0.4), px + dx, py + dy, r * 0.03, (0.35 + 0.3 * Math.sin(t + i)) * I);
        }
        break;
      // ---------- Beta 2 ----------
      case 'ice': { // a frozen surface: a pale sheen, frost, cracks (drawn once), a glint sliding over it
        const tint = C || '#a9d8f5';
        const mask = regionMask(ctx, fx, 0.2);
        // the sheen in one piece (overlapping strokes would show darker seams), then what lies on it
        const F1 = flat(ctx, fx, 'iceBase', 0.4, (g) => { g.fillStyle = g.strokeStyle = tint; drawStrokes(g, fx.strokes || [], 0); cutTo(g, mask, F0(ctx, fx)); });
        if (F1) putFlat(ctx, F1, 'source-over', Math.min(1, 0.3 * I));
        const F = flat(ctx, fx, 'ice', 0.4, (g, m) => {
          // frost: fine light speckles and a few soft whiter patches
          const sp = samples(fx, 0.35);
          g.fillStyle = rgba('#ffffff', Math.min(1, 0.22 * I));
          for (let i = 0; i < sp.length * 4; i++) {
            const [x, y, r] = sp[Math.floor(h(s + i * 1.7) * sp.length)];
            const a = h(s + i * 2.9) * TAU; const d = Math.sqrt(h(s + i * 4.1)) * r;
            g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.008 + 0.02 * h(s + i * 6.3) ** 2, 0, TAU); g.fill();
          }
          // glossy streaks: long soft highlights all lying the same way, as on polished ice
          const ga = h(s + 0.9) * Math.PI;
          for (let i = 0; i < sp.length; i += 2) {
            const [x, y, r] = sp[i];
            const L = r * (0.8 + 0.8 * h(s + i * 5)); const w = r * (0.05 + 0.06 * h(s + i * 7));
            g.save(); g.translate(x + (h(s + i) - 0.5) * r, y + (h(s + i * 3) - 0.5) * r); g.rotate(ga + (h(s + i * 9) - 0.5) * 0.2);
            const gr = g.createLinearGradient(-L, 0, L, 0);
            gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${Math.min(1, 0.28 * I)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr;
            g.beginPath(); g.ellipse(0, 0, L, w, 0, 0, TAU); g.fill();
            g.restore();
          }
          // cracks: jagged lines with a few branches, a light edge over a darker line
          const nc = Math.max(3, Math.round(sp.length * 0.6 * Math.min(3, fx.density ?? 1)));
          const cracks = [];
          for (let i = 0; i < nc; i++) {
            const [x, y, r] = sp[Math.floor(h(s + i * 3.3) * sp.length)];
            let a = h(s + i * 5.1) * TAU; let px = x; let py = y;
            const pts = [[px, py]];
            const segs = 4 + Math.floor(h(s + i * 7.7) * 5);
            for (let k = 0; k < segs; k++) {
              a += (h(s + i * 11 + k) - 0.5) * 1.1;
              const st = r * (0.12 + 0.2 * h(s + i * 13 + k));
              px += Math.cos(a) * st; py += Math.sin(a) * st;
              pts.push([px, py]);
              if (h(s + i * 17 + k) > 0.72) { const ba = a + (h(s + i * 19 + k) > 0.5 ? 1 : -1) * (0.6 + 0.5 * h(s + i * 23 + k)); cracks.push([[px, py], [px + Math.cos(ba) * st * 1.4, py + Math.sin(ba) * st * 1.4]]); }
            }
            cracks.push(pts);
          }
          const px1 = 1 / m.a;
          for (const [col, w, al] of [['#24506f', 2.6, 0.5], ['#ffffff', 1.2, 0.9]]) {
            g.strokeStyle = rgba(col, Math.min(1, al * I));
            g.lineWidth = Math.max(px1 * w, 0.01 * w);
            g.beginPath();
            for (const pts of cracks) { pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); }
            g.stroke();
          }
          cutTo(g, mask, F0(ctx, fx));
        });
        if (!F) break;
        putFlat(ctx, F);
        // the glint: a soft bright band that slides across every few seconds
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const B = F.B;
        const u = fract(t / 7 + h(s + 0.3));
        if (u < 0.45) {
          const sc = scratch(0, W, H, B); const g = sc.g;
          const k = u / 0.45;
          const x0 = B.x - B.h + (B.w + B.h * 2) * k;
          const gr = g.createLinearGradient(x0 - B.h * 0.25, B.y, x0 + B.h * 0.25, B.y + B.h * 0.4);
          const a = 0.32 * Math.sin(Math.PI * k) * I;
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${Math.min(1, a)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(B.x, B.y, B.w, B.h);
          stamp(ctx, sc, mask, 'lighter');
        }
        ctx.setTransform(m);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < Math.min(40, n); i++) {
          const [px, py, r] = at(i, 31);
          const sh = Math.max(0, Math.sin(t * (0.7 + h(s + i * 3)) + h(s + i * 7) * TAU)) ** 10;
          dot(ctx, sprite('#ffffff', 0.5), px, py, r * 0.045, 0.9 * sh * I);
        }
        break;
      }
      case 'burning': { // flames across the area, flickering in place, embers drifting off, soot underneath
        const F = flat(ctx, fx, 'soot', 0.6, (g, m) => {
          g.filter = `blur(${Math.max(1, 0.25 * m.a).toFixed(1)}px)`;
          g.fillStyle = g.strokeStyle = '#140c08';
          drawStrokes(g, fx.strokes || [], 0.12);
          g.filter = 'none';
          const sp = samples(fx, 0.6);
          for (let i = 0; i < sp.length; i++) { const [x, y, r] = sp[i]; dot(g, sprite('#050302'), x + (h(s + i) - 0.5) * r, y + (h(s + i * 3) - 0.5) * r, r * (0.4 + 0.4 * h(s + i * 5)), 0.5); }
        });
        if (F) putFlat(ctx, F, 'source-over', Math.min(1, 0.55 * I));
        const fA = C || '#ff6a10'; const fB = C ? mix(C, '#ffffff', 0.45) : '#ffd36b';
        const em = C ? mix(C, '#ffffff', 0.3) : '#ffb347';
        const a0 = h(s + 0.4) * TAU; const wx = Math.cos(a0); const wy = Math.sin(a0); // the way the heat drifts
        // the flames: two layers of turbulent fire racing along the heat, cut into tongues by a third
        {
          const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
          const B = regionBox(ctx, fx, 0.4);
          if (B) {
            const sc = scratch(0, W, H, B); const g = sc.g;
            const v = 0.55;
            g.globalAlpha = Math.min(1, 0.85 * I);
            g.fillStyle = patternAt(g, tinted(noiseTile(), fA), m, 2.4, wx * t * v, wy * t * v, 10);
            g.fillRect(B.x, B.y, B.w, B.h);
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = Math.min(1, 0.75 * I);
            g.fillStyle = patternAt(g, tinted(noiseTile(), fB), m, 1.25, wx * t * v * 1.7 - wy * t * 0.2, wy * t * v * 1.7 + wx * t * 0.2, -25);
            g.fillRect(B.x, B.y, B.w, B.h);
            // cut twice by a slower noise: tongues of flame with dark gaps between them
            g.globalCompositeOperation = 'destination-in';
            g.globalAlpha = 1;
            g.fillStyle = patternAt(g, noiseTile(), m, 1.9, -wx * t * 0.3 + wy * t * 0.25, -wy * t * 0.3 - wx * t * 0.25, 40);
            g.fillRect(B.x, B.y, B.w, B.h);
            g.fillStyle = patternAt(g, noiseTile(), m, 2.7, wx * t * 0.18, wy * t * 0.18, -60);
            g.fillRect(B.x, B.y, B.w, B.h);
            stamp(ctx, sc, regionMask(ctx, fx, 0.45), 'lighter');
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        const nf = Math.min(150, count(10 + pts.length * 3, fx));
        for (let i = 0; i < nf; i++) {
          const [px, py, r] = at(i, 41);
          const fl = flicker(t * 1.3, s + i);
          // bright licks of flame that flare and die where the fire is hottest
          const ph = fract(t * 1.7 + h(s + i * 2.3));
          const ang = h(s + i * 4.7) * TAU;
          const d = ph * r * 0.15;
          const x = px + Math.cos(ang) * d + wx * ph * r * 0.1; const y = py + Math.sin(ang) * d + wy * ph * r * 0.1;
          dot(ctx, sprite(i % 2 ? fA : fB, 0.3), x, y, r * 0.1 * (1 - ph * 0.6), (1 - ph) * 0.55 * I);
          if (i % 3 === 0) dot(ctx, sprite('#fff1c0', 0.4), px, py, r * 0.045 * fl, 0.4 * I);
        }
        for (let i = 0; i < Math.round(nf * 0.6); i++) {
          const [px, py, r] = at(i, 43);
          const ph = fract(t * 0.4 + h(s + i * 7));
          const x = px + wx * ph * r * 1.6 + Math.sin(t * 2 + i) * r * 0.1; const y = py + wy * ph * r * 1.6 + Math.cos(t * 1.7 + i) * r * 0.1;
          dot(ctx, sprite(em, 0.4), x, y, r * 0.03, (1 - ph) * 0.9 * I);
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < Math.round(nf * 0.15); i++) {
          const [px, py, r] = at(i, 47);
          const ph = fract(t * 0.12 + h(s + i * 9));
          dot(ctx, sprite('#3a3634'), px + wx * ph * r * 2.2, py + wy * ph * r * 2.2, r * (0.4 + ph * 0.9), 0.14 * Math.sin(ph * Math.PI) * I);
        }
        break;
      }
      case 'web': { // strands strung across the area (drawn once), a little sway, dew glinting on them
        const col = C || '#e9ecf2';
        const mask = regionMask(ctx, fx, 0.25);
        const F = flat(ctx, fx, 'web', 0.4, (g, m) => {
          const sp = samples(fx, 0.9);
          const px1 = 1 / m.a;
          g.strokeStyle = rgba(col, Math.min(1, 0.55 * I));
          g.lineWidth = Math.max(px1, 0.009);
          g.beginPath();
          const dens = Math.min(3, Math.max(0.3, fx.density ?? 1));
          sp.forEach(([x, y, r], i) => {
            if (h(s + i * 1.9) < 0.4) {
              // an orb web: spokes and a spiral that sags between them
              const R = r * (0.55 + 0.4 * h(s + i * 3.1));
              const cx = x + (h(s + i * 5.3) - 0.5) * r * 0.5; const cy = y + (h(s + i * 7.1) - 0.5) * r * 0.5;
              const ns = 9 + Math.floor(h(s + i * 9.7) * 5);
              const ang = []; for (let k = 0; k < ns; k++) ang.push(((k + (h(s + i * 11 + k) - 0.5) * 0.5) / ns) * TAU);
              const len = ang.map((_, k) => R * (0.75 + 0.35 * h(s + i * 13 + k)));
              ang.forEach((a, k) => { g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len[k], cy + Math.sin(a) * len[k]); });
              const turns = Math.round(6 * dens);
              for (let q = 1; q <= turns; q++) {
                const f = q / (turns + 1);
                for (let k = 0; k <= ns; k++) {
                  const a = ang[k % ns]; const d = len[k % ns] * f;
                  const x1 = cx + Math.cos(a) * d; const y1 = cy + Math.sin(a) * d;
                  if (k === 0) { g.moveTo(x1, y1); continue; }
                  const pa = ang[(k - 1) % ns]; const pd = len[(k - 1) % ns] * f;
                  const mx = cx + Math.cos((a + pa + (k === ns ? TAU : 0)) / 2) * (d + pd) * 0.42; const my = cy + Math.sin((a + pa + (k === ns ? TAU : 0)) / 2) * (d + pd) * 0.42;
                  g.quadraticCurveTo(mx, my, x1, y1);
                }
              }
            } else {
              // a tangle: sagging strands between nearby points
              const k = Math.round((4 + 5 * h(s + i * 15.1)) * dens);
              for (let q = 0; q < k; q++) {
                const a1 = h(s + i * 17 + q) * TAU; const a2 = a1 + Math.PI + (h(s + i * 19 + q) - 0.5) * 1.6;
                const d1 = r * (0.3 + 0.9 * h(s + i * 21 + q)); const d2 = r * (0.3 + 0.9 * h(s + i * 23 + q));
                const x1 = x + Math.cos(a1) * d1; const y1 = y + Math.sin(a1) * d1; const x2 = x + Math.cos(a2) * d2; const y2 = y + Math.sin(a2) * d2;
                const sag = (h(s + i * 25 + q) - 0.5) * r * 0.35;
                const nx = -(y2 - y1); const ny = x2 - x1; const nl = Math.hypot(nx, ny) || 1;
                g.moveTo(x1, y1); g.quadraticCurveTo((x1 + x2) / 2 + (nx / nl) * sag, (y1 + y2) / 2 + (ny / nl) * sag, x2, y2);
              }
            }
          });
          g.stroke();
          // a faint grey haze where the strands are thickest
          for (let i = 0; i < sp.length; i += 2) { const [x, y, r] = sp[i]; dot(g, sprite(col), x, y, r * 0.8, 0.05 * I); }
          cutTo(g, mask, F0(ctx, fx));
        });
        if (!F) break;
        const m = ctx.getTransform();
        putFlat(ctx, F, 'source-over', 1, Math.sin(t * 0.7 + s) * 0.012 * m.a, Math.cos(t * 0.53 + s) * 0.009 * m.a);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < Math.min(50, n); i++) {
          const [px, py, r] = at(i, 51);
          const sh = Math.max(0, Math.sin(t * (0.5 + h(s + i * 3) * 0.6) + h(s + i * 7) * TAU)) ** 12;
          dot(ctx, sprite('#ffffff', 0.5), px, py, r * 0.025, 0.8 * sh * I);
        }
        break;
      }
      case 'glow': { // light from below: a soft glow that breathes, drifting brighter patches, motes
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const col = C || '#8fe3ff';
        const B = regionBox(ctx, fx, 0.8);
        if (!B) break;
        const sc = scratch(0, W, H, B); const g = sc.g;
        const br = 0.75 + 0.25 * Math.sin(t * 0.9 + s);
        g.fillStyle = rgba(col, Math.min(1, 0.22 * I * br));
        g.fillRect(B.x, B.y, B.w, B.h);
        const tn = tinted(noiseTile(), col);
        g.globalAlpha = Math.min(1, 0.5 * I);
        g.fillStyle = patternAt(g, tn, m, 3.2, t * 0.05, t * 0.03, 15);
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalCompositeOperation = 'destination-in';
        g.globalAlpha = 1;
        g.fillStyle = patternAt(g, noiseTile(), m, 2.1, -t * 0.04, t * 0.05, -40);
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalCompositeOperation = 'destination-over';
        g.fillStyle = rgba(col, Math.min(1, 0.16 * I * br));
        g.fillRect(B.x, B.y, B.w, B.h);
        stamp(ctx, sc, regionMask(ctx, fx, 0.7, 0.1), 'lighter');
        ctx.globalCompositeOperation = 'lighter';
        const core = mix(col, '#ffffff', 0.6);
        for (let i = 0; i < n; i++) {
          const [px, py, r] = at(i, 61);
          const life = fract(t / (3 + 3 * h(s + i * 3)) + h(s + i * 5));
          const a = h(s + i * 7) * TAU;
          const x = px + Math.cos(a) * life * r * 0.25; const y = py + Math.sin(a) * life * r * 0.25;
          dot(ctx, sprite(core, 0.4), x, y, r * 0.035, Math.sin(Math.PI * life) * 0.85 * I);
        }
        break;
      }
      case 'grass': { // waves of wind roll over the meadow the way the strokes were painted
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const B = regionBox(ctx, fx, 0.4);
        if (!B) break;
        const [dx, dy] = flowDir(fx, s);
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const v = 1.1; // inches per second at speed 1
        const sc = scratch(0, W, H, B); const g = sc.g;
        const sheen = C || '#f6f0c8';
        g.globalAlpha = Math.min(1, 0.3 * I);
        g.fillStyle = patternAt(g, tinted(noiseTile(), sheen), m, 4.2, dx * v * t, dy * v * t, ang, 0.45);
        g.fillRect(B.x, B.y, B.w, B.h);
        // the troughs between the waves, a little darker
        g.globalAlpha = Math.min(1, 0.22 * I);
        g.fillStyle = patternAt(g, tinted(noiseTile(), '#0b1606'), m, 4.2, dx * v * t + dx * 2.1, dy * v * t + dy * 2.1, ang, 0.45);
        g.fillRect(B.x, B.y, B.w, B.h);
        // a finer shiver on top
        g.globalAlpha = Math.min(1, 0.14 * I);
        g.fillStyle = patternAt(g, tinted(noiseTile(), sheen), m, 0.9, dx * v * 1.6 * t, dy * v * 1.6 * t, ang + 20, 0.6);
        g.fillRect(B.x, B.y, B.w, B.h);
        stamp(ctx, sc, regionMask(ctx, fx, 0.5));
        break;
      }
      case 'oil': { // a dark slick, a rainbow film drifting slowly on it
        const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
        const mask = regionMask(ctx, fx, 0.2);
        const base = C ? mix(C, '#000000', 0.7) : '#0d0a08';
        const F = flat(ctx, fx, 'oil', 0.4, (g) => {
          g.fillStyle = g.strokeStyle = base;
          drawStrokes(g, fx.strokes || [], 0);
          cutTo(g, mask, F0(ctx, fx));
        });
        if (!F) break;
        putFlat(ctx, F, 'source-over', Math.min(1, 0.68 * I));
        const B = F.B;
        const sc = scratch(0, W, H, B); const g = sc.g;
        g.globalAlpha = Math.min(1, 0.13 * I);
        g.fillStyle = patternAt(g, filmTile(), m, 3.4, t * 0.04, -t * 0.03, 25);
        g.fillRect(B.x, B.y, B.w, B.h);
        g.globalCompositeOperation = 'destination-in';
        g.globalAlpha = 1;
        g.fillStyle = patternAt(g, noiseTile(), m, 1.6, -t * 0.03, t * 0.02, -15);
        g.fillRect(B.x, B.y, B.w, B.h);
        stamp(ctx, sc, mask, 'lighter');
        break;
      }
      default:
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // =====================================================================
  // Lighting: a darkness layer with holes where lights are.
  // lights: [{ x, y, B, D (inches), color, flicker, strength, s }]
  // opts: { tint, seen (a canvas mask of explored ground, already blurred) }
  // =====================================================================
  // a light that stops at walls: everything after this only paints inside its polygon (restore() ends it)
  function clipTo(ctx, poly) {
    if (!poly || poly.length < 6) return false;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
    ctx.clip();
    return true;
  }
  // a light's shapes: its whole circle; or (Beta 2) a cone or a beam in a few widening steps, so its sides are soft
  const shapesOf = (L) => L.shapes || [{ poly: L.shape || null, k: 1 }];
  // Prototype 15: lights that overlap don't add up: each spot gets the light of its strongest source. They are drawn
  // as opaque greys (or premultiplied colours) on a small canvas with 'lighten' (the brighter one wins), read back once
  // and turned into alpha. Only when some lights overlap; apart they look exactly as before.
  const MAX_RES = 0.42;
  const MX = {};
  function maxCanvas(key, W, H) {
    let o = MX[key];
    if (!o) {
      const c = document.createElement('canvas'); const out = document.createElement('canvas');
      o = MX[key] = { c, g: c.getContext('2d', { willReadFrequently: true }), out, og: out.getContext('2d') };
    }
    if (o.c.width !== W || o.c.height !== H) { o.c.width = o.out.width = W; o.c.height = o.out.height = H; }
    return o;
  }
  function maxLights(key, ctx, w, hgt, lights, paint, colour) {
    const W = Math.max(1, Math.round(w * MAX_RES)); const H = Math.max(1, Math.round(hgt * MAX_RES));
    const o = maxCanvas(key, W, H); const g = o.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const m = ctx.getTransform(); const sx = W / w; const sy = H / hgt;
    g.setTransform(m.a * sx, m.b * sy, m.c * sx, m.d * sy, m.e * sx, m.f * sy);
    g.globalCompositeOperation = 'lighten';
    for (const L of lights) paint(g, L);
    g.globalCompositeOperation = 'source-over';
    const id = g.getImageData(0, 0, W, H); const d = id.data;
    if (colour) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]; const gg = d[i + 1]; const b = d[i + 2];
        const mm = r > gg ? (r > b ? r : b) : (gg > b ? gg : b);
        if (!mm) { d[i + 3] = 0; continue; }
        const k = 255 / mm; d[i] = r * k; d[i + 1] = gg * k; d[i + 2] = b * k; d[i + 3] = mm;
      }
    } else for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
    o.og.putImageData(id, 0, 0);
    return o.out;
  }
  // do any two of these lights reach into each other?
  function overlapping(lights) {
    for (let i = 0; i < lights.length; i++) {
      const A = lights[i];
      for (let j = i + 1; j < lights.length; j++) { const B = lights[j]; if (Math.hypot(A.x - B.x, A.y - B.y) < A.D + B.D) return true; }
    }
    return false;
  }
  // a cone's widening steps together (each step lies inside the next): the step's own share of the whole
  function unionK(shapes, a = 1) {
    const out = new Array(shapes.length); let keep = 1;
    for (let i = shapes.length - 1; i >= 0; i--) { keep *= 1 - Math.min(1, a * shapes[i].k); out[i] = 1 - keep; }
    return out;
  }
  const grey = (a) => { const v = Math.round(255 * Math.min(1, Math.max(0, a))); return `rgb(${v},${v},${v})`; };
  const premul = (hex, a) => { const [r, g, b] = rgb(hex); const k = Math.min(1, Math.max(0, a)); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; };
  function paintDim(g, L, t) {
    const f = L.flicker ? 0.965 + 0.025 * Math.sin(t * 11 + L.s) + 0.015 * Math.sin(t * 23 + L.s * 1.3) : 1;
    const D = L.D * f; const B = Math.min(L.B * f, D * 0.98);
    const k = B / D;
    const sh = shapesOf(L); const U = unionK(sh);
    sh.forEach((x, i) => {
      const S = Math.min(1, Math.max(0, (L.strength ?? 1) * U[i]));
      const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, D);
      gr.addColorStop(0, grey(S));
      gr.addColorStop(k * 0.8, grey(S));
      gr.addColorStop(k, grey(0.78 * S));
      gr.addColorStop(Math.min(0.999, k + (1 - k) * 0.6), grey(0.38 * S));
      gr.addColorStop(1, '#000');
      g.fillStyle = gr;
      const clipped = clipTo(g, L.poly); const shaped = clipTo(g, x.poly);
      g.fillRect(L.x - D, L.y - D, D * 2, D * 2);
      if (shaped) g.restore();
      if (clipped) g.restore();
    });
  }
  // Coloured light: the colour every light throws on the map, on its own layer that the windows blend in
  // 'color' mode, so the floor under a green torch turns green but keeps its stones and shadows.
  // L.sat (0..1) is how strongly; in daylight it is gentler than in the dark.
  function glow(ctx, w, hgt, level, lights, t, xform) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    xform();
    ctx.globalCompositeOperation = 'source-over';
    let n = 0;
    const alphaOf = (L) => Math.min(1, (L.sat ?? 0.25) * (0.5 + 0.5 * level) * Math.min(1, L.strength ?? 1));
    const plain = lights.filter((L) => !L.mask && L.color && alphaOf(L) >= 0.02);
    if (plain.length > 1 && overlapping(plain)) { // (Prototype 15: overlapping lights don't stack their colour)
      const img = maxLights('glow', ctx, w, hgt, plain, (g, L) => {
        const a = alphaOf(L);
        const f = L.flicker ? 0.97 + 0.02 * Math.sin(t * 11 + L.s) + 0.01 * Math.sin(t * 23 + L.s * 1.3) : 1;
        const D = L.D * f;
        const sh = shapesOf(L); const U = unionK(sh, a);
        sh.forEach((x, i) => {
          const ak = U[i];
          const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, D);
          gr.addColorStop(0, premul(L.color, ak));
          gr.addColorStop(0.5, premul(L.color, ak * 0.8));
          gr.addColorStop(0.85, premul(L.color, ak * 0.25));
          gr.addColorStop(1, '#000');
          g.fillStyle = gr;
          const clipped = clipTo(g, L.poly); const shaped = clipTo(g, x.poly);
          g.fillRect(L.x - D, L.y - D, D * 2, D * 2);
          if (shaped) g.restore();
          if (clipped) g.restore();
        });
      }, true);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, w, hgt); ctx.restore();
      n += plain.length;
      lights = lights.filter((L) => L.mask);
    }
    for (const L of lights) {
      const a = alphaOf(L);
      if (a < 0.02 || !L.color) continue;
      const f = L.flicker ? 0.97 + 0.02 * Math.sin(t * 11 + L.s) + 0.01 * Math.sin(t * 23 + L.s * 1.3) : 1;
      if (L.mask) { drawMask(ctx, L, tinted(L.mask.img, L.color), a); n++; continue; }
      const D = L.D * f;
      for (const sh of shapesOf(L)) {
        const ak = a * sh.k;
        const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, D);
        g.addColorStop(0, rgba(L.color, ak));
        g.addColorStop(0.5, rgba(L.color, ak * 0.8));
        g.addColorStop(0.85, rgba(L.color, ak * 0.25));
        g.addColorStop(1, rgba(L.color, 0));
        ctx.fillStyle = g;
        const clipped = clipTo(ctx, L.poly); const shaped = clipTo(ctx, sh.poly);
        ctx.fillRect(L.x - D, L.y - D, D * 2, D * 2);
        if (shaped) ctx.restore();
        if (clipped) ctx.restore();
      }
      n++;
    }
    return n;
  }
  function darkness(ctx, w, hgt, level, lights, t, xform, opts = {}) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    if (level <= 0) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(opts.tint || '#03040a', level);
    ctx.fillRect(0, 0, w, hgt);
    if (opts.seen) {
      // explored ground: some of the darkness lifts, like a faint memory of the place
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(opts.seen, 0, 0, w, hgt);
      ctx.globalAlpha = 1;
    }
    xform();
    ctx.globalCompositeOperation = 'destination-out';
    const plain = lights.filter((L) => !L.mask);
    if (plain.length > 1 && overlapping(plain)) { // (Prototype 15: overlapping lights don't add up: the strongest one counts)
      const img = maxLights('dark', ctx, w, hgt, plain, (g, L) => paintDim(g, L, t), false);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, w, hgt); ctx.restore();
      lights = lights.filter((L) => L.mask);
    }
    for (const L of lights) {
      if (L.mask) { // 4.9: a soft picture of the light (stronger than full: once more, lighter)
        const S = Math.max(0, L.strength ?? 1);
        const clipped = clipTo(ctx, L.poly);
        drawMask(ctx, L, L.mask.img, S);
        if (S > 1) drawMask(ctx, L, L.mask.img, S - 1);
        if (clipped) ctx.restore();
        continue;
      }
      const f = L.flicker ? 0.965 + 0.025 * Math.sin(t * 11 + L.s) + 0.015 * Math.sin(t * 23 + L.s * 1.3) : 1;
      const D = L.D * f; const B = Math.min(L.B * f, D * 0.98);
      const k = B / D;
      for (const sh of shapesOf(L)) {
        const S = Math.min(1, Math.max(0, (L.strength ?? 1) * sh.k));
        const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, D);
        g.addColorStop(0, `rgba(0,0,0,${S})`);
        g.addColorStop(k * 0.8, `rgba(0,0,0,${S})`);
        g.addColorStop(k, `rgba(0,0,0,${0.78 * S})`);
        g.addColorStop(Math.min(0.999, k + (1 - k) * 0.6), `rgba(0,0,0,${0.38 * S})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        const clipped = clipTo(ctx, L.poly); const shaped = clipTo(ctx, sh.poly);
        ctx.fillRect(L.x - D, L.y - D, D * 2, D * 2);
        if (shaped) ctx.restore();
        if (clipped) ctx.restore();
      }
    }
    // (Prototype 15: no extra warm light added on top any more: a light shows the map at most as bright as it is;
    // its colour comes from the glow layer)
    ctx.globalCompositeOperation = 'source-over';
  }

  // =====================================================================
  // Weather: a mix of layers over the whole table, in table inches.
  // weather: { layers: [{ id, type, amount, opacity, size, speed, color, dir, gust, hidden, born, dying }], fade (s) }
  // =====================================================================
  const D2R = Math.PI / 180;
  let wtypes = null;
  const wtype = (id) => (wtypes || (wtypes = Object.fromEntries(FXDATA.WEATHER_TYPES.map((x) => [x.id, x]))))[id] || {};
  // Gusts (Beta 2.2): the wind blows steadily; every few seconds a gust front rolls across the table the way the
  // wind blows. Where it passes, things are shoved ahead (quickly, GR s) and then fall back to their steady pace
  // (slowly, GD s), so they rush in the gust and dawdle behind it, never moving backwards. The shove is at most
  // GUST_MAX inches and drawn after the wrap margin grows by as much, so the wrap stays off the table. Gusts slider:
  // how strong the shove is and how many fronts come (a weak setting lets many of them pass by).
  const GUST_PER = 7.5; // s between fronts (each one a little early or late)
  const GUST_CROSS = 2.6; // s a front takes across the table
  const GR = 0.5; const GD = 3; // s: the shove, the falling back
  const GUST_MAX = 2.5; // inches
  function gustFronts(t, g, s, ang) {
    const out = [];
    if (g <= 0) return out;
    const k0 = Math.floor(t / GUST_PER);
    for (let k = k0 - 1; k <= k0; k++) {
      const age = t - (k * GUST_PER + h(k * 1.31 + s) * 2.5);
      if (age <= 0 || age > GUST_CROSS * 1.5 + GR + GD) continue;
      const a = clamp((0.25 + 0.75 * g - h(k * 2.17 + s)) / 0.2, 0, 1) * (0.65 + 0.35 * h(k * 3.7 + s));
      if (a <= 0) continue;
      const da = ang + (h(k * 5.3 + s) - 0.5) * 0.25; // each gust pushes a little to one side
      out.push({ age, a, cx: Math.cos(da), cy: Math.sin(da) });
    }
    return out;
  }
  const wrap = (v, lo, span) => lo + ((((v - lo) % span) + span) % span);
  // a layer fades in when added and out when removed (weather.fade seconds)
  function layerAlpha(L, now, fadeMs) {
    if (L.hidden) return 0;
    let a = clamp(L.opacity ?? 1, 0, 1);
    if (L.fs) fadeMs = L.fs * 1000; // a snapshot that fades in brings its own time
    if (fadeMs > 0) {
      if (L.born) a *= clamp((now - L.born) / fadeMs, 0, 1);
      if (L.dying) a *= clamp(1 - (now - L.dying) / fadeMs, 0, 1);
    } else if (L.dying) a = 0;
    return a;
  }
  // a particle carried by the wind: the layer's travel (P.T, anchored, so a change of speed or direction never makes
  // anything jump) times its own speed, plus the shove of a gust front passing over it; wrapped around the table with
  // a margin. Returns x, y, q (how much a gust has hold of it, 0 – 1) and v (its speed now, in times its steady speed).
  const NOGUST = { q: 0, v: 1 };
  function drift(P, i, sp, m = 1) {
    const mm = m + GUST_MAX;
    const sx = P.W + 2 * mm; const sy = P.H + 2 * mm;
    const bx = h(i + P.s) * sx + P.T.x * sp; const by = h(i * 5 + P.s) * sy + P.T.y * sp;
    if (!P.fronts.length) return { x: wrap(bx, -mm, sx), y: wrap(by, -mm, sy), ...NOGUST };
    const D = P.g * Math.min(sp * P.speed, GUST_MAX); // the biggest shove, for this particle
    const u = wrap(bx, -mm, sx) * P.dx + wrap(by, -mm, sy) * P.dy;
    let ox = 0; let oy = 0; let dv = 0; let q = 0;
    for (const F of P.fronts) {
      const tau = F.age - (u - P.u0) / P.uc; // seconds since this front reached it
      if (tau <= 0 || tau >= GR + GD) continue;
      let b; let db;
      if (tau < GR) { const z = tau / GR; b = z * z * (3 - 2 * z); db = (6 * z * (1 - z)) / GR; } else { const z = (tau - GR) / GD; b = 1 - z * z * (3 - 2 * z); db = (-6 * z * (1 - z)) / GD; }
      ox += F.a * b * F.cx; oy += F.a * b * F.cy; dv += F.a * db; q = Math.max(q, F.a * (tau < GR ? 1 : b));
    }
    return { x: wrap(bx + D * ox, -mm, sx), y: wrap(by + D * oy, -mm, sy), q: q * P.g, v: Math.max(0.2, 1 + (D * dv) / Math.max(0.01, sp * P.speed)) };
  }
  // lightning: flashes at random moments, more often with a higher amount
  function flashOf(L, t, amt = L.amount ?? 1, s = seedOf(L.id || 'bolt')) {
    const per = 7 / clamp(amt, 0.1, 4);
    const k = Math.floor(t / per);
    if (h(k * 13 + s) < 0.3) return null;
    const ph = t - k * per - h(k * 7 + s) * Math.max(0, per - 0.8);
    if (ph < 0 || ph > 0.55) return null;
    const a = ph < 0.06 ? 0.55 : ph > 0.12 && ph < 0.18 ? 0.42 : Math.max(0, 0.28 - ph * 0.5);
    return { k, ph, a, id: `${L.id}:${k}` };
  }
  // a branching bolt somewhere on the table, seen from above
  function bolt(ctx, W, H, seed, a, size, col) {
    const chains = [];
    // jagged: every step swings around the main direction, branches fork off now and then
    const grow = (x, y, ang, len, depth, salt) => {
      const n = depth ? 9 : 18;
      const pts = [[x, y]];
      chains.push({ pts, depth });
      let px = x; let py = y;
      for (let i = 0; i < n; i++) {
        const na = ang + (h(salt + i * 1.7) - 0.5) * 1.7;
        const step = (len / n) * (0.6 + h(salt + i * 2.9) * 0.8);
        px += Math.cos(na) * step; py += Math.sin(na) * step;
        pts.push([px, py]);
        if (depth < 2 && h(salt + i * 3.3) > 0.8) grow(px, py, ang + (h(salt + i) > 0.5 ? 1 : -1) * (0.4 + h(salt + i * 5) * 0.6), len * (0.3 + h(salt + i * 7) * 0.2), depth + 1, salt * 1.3 + i + 1);
      }
    };
    // centred on a point in the middle of the table, so the bolt crosses it instead of running off an edge
    const len = (3 + h(seed * 9.1) * 3) * size; const ang = h(seed * 7.7) * TAU;
    const cx = (0.25 + 0.5 * h(seed * 3.1)) * W; const cy = (0.25 + 0.5 * h(seed * 5.3)) * H;
    grow(cx - (Math.cos(ang) * len) / 2, cy - (Math.sin(ang) * len) / 2, ang, len, 0, seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, al, c] of [[0.45, 0.08, col], [0.16, 0.22, col], [0.045, 1, '#ffffff']]) {
      ctx.strokeStyle = rgba(c, al * a);
      for (const ch of chains) {
        ctx.lineWidth = (w * size) / (1 + ch.depth * 1.2);
        ctx.beginPath();
        ch.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // "Strike now": one big flash on demand
  function strike(ctx, W, H, age, seed, col = '#e6eeff') {
    if (age < 0 || age > 0.9) return;
    const a = age < 0.07 ? 0.7 : age > 0.14 && age < 0.22 ? 0.5 : Math.max(0, 0.32 - age * 0.38);
    ctx.fillStyle = rgba(col, a);
    ctx.fillRect(-1, -1, W + 2, H + 2);
    // the bolt flickers twice and lingers a moment, big enough to read across the table
    const ba = age < 0.1 ? 1 : age < 0.16 ? 0.35 : age < 0.26 ? 1 : Math.max(0, 1 - (age - 0.26) / 0.4);
    if (ba > 0) bolt(ctx, W, H, seed, ba, Math.max(1.6, Math.min(W, H) / 9), col);
  }

  const WDRAW = {
    rain(ctx, P) {
      const n = Math.floor(320 * P.amt * P.dens * Q);
      ctx.lineWidth = 0.022 * P.size;
      ctx.lineCap = 'round';
      const stretch = Math.min(3, 0.6 + 0.4 * P.speed);
      const calm = new Path2D(); const gust = new Path2D(); // in a gust: longer and brighter
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 26 + h(i * 3) * 12);
        const len = (0.45 + h(i * 7) * 0.35) * P.size * stretch * (1 + 0.6 * p.q);
        const path = p.q > 0.3 ? gust : calm;
        path.moveTo(p.x, p.y);
        path.lineTo(p.x - P.dx * len, p.y - P.dy * len);
      }
      ctx.strokeStyle = rgba(P.col, 0.42 * P.A); ctx.stroke(calm);
      ctx.strokeStyle = rgba(P.col, Math.min(1, 0.68 * P.A)); ctx.stroke(gust);
    },
    splash(ctx, P) {
      const n = Math.floor(70 * P.amt * Q);
      ctx.strokeStyle = P.col;
      ctx.fillStyle = P.col;
      ctx.lineWidth = 0.012 * P.size;
      for (let i = 0; i < n; i++) {
        const u = P.ts / (0.45 + h(i * 3) * 0.4) + h(i * 11);
        const k = Math.floor(u); const ph = u - k;
        const x = h(i * 7 + k * 1.37 + P.s) * P.W; const y = h(i * 13 + k * 2.71 + P.s) * P.H;
        ctx.globalAlpha = (1 - ph) * 0.55 * P.A;
        ctx.beginPath(); ctx.arc(x, y, (0.025 + ph * 0.11) * P.size, 0, TAU); ctx.stroke();
        if (ph < 0.25) { ctx.globalAlpha = (0.25 - ph) * 2 * P.A; ctx.beginPath(); ctx.arc(x, y, 0.012 * P.size, 0, TAU); ctx.fill(); }
      }
    },
    hail(ctx, P) {
      const n = Math.floor(150 * P.amt * P.dens * Q);
      const img = sprite(P.col, 0.6);
      const pts = [];
      ctx.strokeStyle = rgba(P.col, 0.35 * P.A);
      ctx.lineWidth = 0.016 * P.size;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 30 + h(i * 3) * 10);
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - P.dx * 0.18 * P.size, p.y - P.dy * 0.18 * P.size);
        pts.push(p);
      }
      ctx.stroke();
      pts.forEach((p, i) => dot(ctx, img, p.x, p.y, (0.025 + h(i * 9) * 0.02) * P.size, 0.9 * P.A));
    },
    snow(ctx, P, L) {
      const ash = L.type === 'ash';
      const n = Math.floor((ash ? 150 : 190) * P.amt * P.dens * Q);
      const img = sprite(P.col, 0.35);
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, (ash ? 0.5 : 0.9) * (0.6 + h(i * 3) * 0.7), 0.5);
        const sw = Math.sin(P.t * 0.8 + i) * 0.35; // sway across the wind
        const x = p.x - P.dy * sw; const y = p.y + P.dx * sw;
        dot(ctx, img, x, y, (0.03 + h(i * 9) * 0.05) * P.size, (ash ? 0.6 : 0.85) * P.A);
        if (ash && i % 9 === 0) {
          ctx.globalCompositeOperation = 'lighter';
          dot(ctx, sprite('#ff8a2a', 0.4), x, y, 0.05 * P.size, (0.5 + 0.5 * Math.sin(P.t * 5 + i)) * P.A);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    },
    embers(ctx, P) {
      ctx.globalCompositeOperation = 'lighter';
      const n = Math.floor(120 * P.amt * P.dens * Q);
      const glow = sprite(P.col); const core = sprite(mix(P.col, '#fff2c0', 0.6), 0.5);
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 0.8 * (0.6 + h(i * 3)), 0.5);
        const sw = Math.sin(P.t * 1.3 + i) * 0.45;
        const x = p.x - P.dy * sw; const y = p.y + P.dx * sw;
        const fl = 0.55 + 0.45 * Math.sin(P.t * 6 + i);
        dot(ctx, glow, x, y, 0.12 * P.size, 0.25 * fl * P.A);
        dot(ctx, core, x, y, 0.035 * P.size, 0.9 * fl * P.A);
      }
    },
    leaves(ctx, P, L) {
      const petals = L.type === 'petals';
      const n = Math.floor((petals ? 70 : 45) * P.amt * P.dens * Q);
      const cols = L.color ? [L.color] : petals ? ['#f6b8c9', '#f9d6e0', '#eea3bb', '#fff0f4'] : ['#a0522d', '#c58b2b', '#6b8e23', '#8b3a1a'];
      const rx = (petals ? 0.07 : 0.14) * P.size;
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 0.7 * (0.6 + h(i * 3) * 0.6), 0.5);
        const sw = Math.sin(P.t * 0.9 + i) * 0.6;
        ctx.save();
        ctx.translate(p.x - P.dy * sw, p.y + P.dx * sw);
        ctx.rotate(P.t * (0.8 + h(i * 7)) * 2 + i);
        ctx.globalAlpha = 0.85 * P.A;
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, rx * 0.43 * Math.abs(Math.cos(P.t * 2 + i)) + rx * 0.1, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    },
    sand(ctx, P) {
      const haze = sprite(P.col);
      for (let i = 0; i < 8; i++) { const p = drift(P, i + 900, 1.1, 5); dot(ctx, haze, p.x, p.y, (3.5 + h(i * 3) * 2) * P.size, (0.1 + 0.1 * p.q) * P.A, 1.6); }
      const n = Math.floor(380 * P.amt * P.dens * Q);
      ctx.lineWidth = 0.014 * P.size;
      const calm = new Path2D(); const gust = new Path2D();
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 3.5 + h(i * 3) * 2.5, 0.5);
        const wob = Math.sin(P.t * 1.6 + i) * 0.08;
        // faster grains draw longer streaks (instead of jumping from frame to frame)
        const len = (0.2 + h(i * 7) * 0.2) * P.size * clamp(0.6 + 0.4 * P.speed * p.v, 0.6, 6);
        const x = p.x - P.dy * wob; const y = p.y + P.dx * wob;
        const path = p.q > 0.3 ? gust : calm;
        path.moveTo(x, y); path.lineTo(x - P.dx * len, y - P.dy * len);
      }
      ctx.strokeStyle = rgba(P.col, 0.45 * P.A); ctx.stroke(calm);
      ctx.strokeStyle = rgba(P.col, Math.min(1, 0.75 * P.A)); ctx.stroke(gust);
    },
    fog(ctx, P) {
      const img = sprite(P.col);
      const n = Math.max(1, Math.round(12 * P.amt));
      for (let i = 0; i < n; i++) {
        const r = (2.2 + h(i * 3) * 2.6) * P.size;
        const p = drift(P, i, 0.22 + h(i * 7) * 0.12, r * 1.4);
        dot(ctx, img, p.x, p.y, r * (0.85 + 0.15 * Math.sin(P.t * 0.2 + i * 1.7)), 0.2 * P.A, 1.4);
      }
    },
    clouds(ctx, P) {
      const img = sprite(P.col);
      const n = Math.max(1, Math.round(5 * P.amt));
      for (let i = 0; i < n; i++) {
        const R = (3 + h(i * 3) * 3) * P.size;
        const c = drift(P, i, 0.32 + h(i * 7) * 0.12, R * 1.8);
        for (let j = 0; j < 4; j++) {
          const a = h(i * 17 + j * 5) * TAU; const d = R * 0.55 * h(i * 19 + j * 3);
          dot(ctx, img, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.7, R * (0.55 + 0.35 * h(i * 23 + j)), 0.2 * P.A, 1.3);
        }
      }
    },
    lightning(ctx, P, L) {
      const f = flashOf(L, P.t, P.amt, P.s);
      if (!f) return;
      ctx.fillStyle = rgba(P.col, f.a * P.A);
      ctx.fillRect(-1, -1, P.W + 2, P.H + 2);
      if (f.ph < 0.22) bolt(ctx, P.W, P.H, f.k + P.s, (1 - f.ph / 0.22) * P.A, P.size, P.col);
    },
    fireflies(ctx, P) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = sprite(P.col); const core = sprite(mix(P.col, '#ffffff', 0.5), 0.5);
      const n = Math.floor(40 * P.amt * Q);
      const tt = P.ts * 0.25;
      for (let i = 0; i < n; i++) {
        const x = h(i + P.s) * P.W + Math.sin(tt * (0.7 + h(i * 3)) + i) * 0.9 + Math.sin(tt * 2.3 + i * 1.3) * 0.25;
        const y = h(i * 5 + P.s) * P.H + Math.cos(tt * (0.6 + h(i * 7)) + i * 2) * 0.7 + Math.sin(tt * 1.9 + i) * 0.25;
        const b = Math.max(0, Math.sin(P.ts * (0.9 + h(i * 11) * 0.8) + i * 2.1)) ** 3;
        dot(ctx, glow, x, y, 0.22 * P.size, 0.35 * b * P.A);
        dot(ctx, core, x, y, 0.035 * P.size, 0.95 * b * P.A);
      }
    },
    spores(ctx, P) {
      const img = sprite(P.col, 0.3);
      const n = Math.floor(90 * P.amt * P.dens * Q);
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 0.12 + h(i * 3) * 0.12, 0.5);
        const w1 = Math.sin(P.t * 0.6 + i) * 0.3;
        dot(ctx, img, p.x - P.dy * w1, p.y + P.dx * w1, (0.018 + h(i * 9) * 0.025) * P.size, (0.35 + 0.3 * Math.sin(P.t + i)) * P.A);
      }
    },
    // ---------- Beta 2 ----------
    // light rippling over the whole table, as on the bottom of shallow water
    caustics(ctx, P) {
      const m = ctx.getTransform();
      const tile = causticTile(P.col);
      const v = 0.18;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, 0.07 * P.A);
      ctx.fillStyle = '#1e6f9a';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      const sz = 7.5 * P.size;
      ctx.globalAlpha = Math.min(1, 0.17 * P.A * Math.min(2, P.amt));
      ctx.fillStyle = patternAt(ctx, tile, m, sz, P.T.x * v, P.T.y * v, 0);
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalAlpha = Math.min(1, 0.14 * P.A * Math.min(2, P.amt));
      ctx.fillStyle = patternAt(ctx, tile, m, sz * 1.41, -P.T.y * v * 0.8, P.T.x * v * 0.8, 33);
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    },
    // bubbles come up here and there, wobble, and pop
    bubbles(ctx, P) {
      const n = Math.floor(120 * P.amt * Q);
      const hi = sprite('#ffffff', 0.5);
      ctx.strokeStyle = P.col;
      for (let i = 0; i < n; i++) {
        const u = P.ts / (2.4 + h(i * 3) * 2) + h(i * 11 + P.s);
        const k = Math.floor(u); const ph = u - k;
        const x = h(i * 7 + k * 1.37 + P.s) * P.W + P.dx * ph * 0.4 + Math.sin(P.t * 3 + i) * 0.03;
        const y = h(i * 13 + k * 2.71 + P.s) * P.H + P.dy * ph * 0.4 + Math.cos(P.t * 2.7 + i) * 0.03;
        const r = (0.06 + 0.15 * h(i * 5 + k) ** 1.5) * P.size * (0.4 + 0.6 * Math.min(1, ph / 0.8));
        if (ph < 0.86) {
          ctx.globalAlpha = Math.min(1, 0.8 * P.A * Math.min(1, ph * 6));
          ctx.lineWidth = Math.max(0.014, r * 0.16);
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          dot(ctx, hi, x - r * 0.35, y - r * 0.35, r * 0.3, 0.7 * P.A);
        } else { // pop: a ring that opens and is gone
          const q = (ph - 0.86) / 0.14;
          ctx.globalAlpha = Math.min(1, (1 - q) * 0.5 * P.A);
          ctx.lineWidth = 0.006;
          ctx.beginPath(); ctx.arc(x, y, r * (1 + q * 1.8), 0, TAU); ctx.stroke();
        }
      }
    },
    // the wind itself: long thin streaks rushing past, bowing a little
    wind(ctx, P) {
      const n = Math.floor(120 * P.amt * P.dens * Q);
      ctx.lineCap = 'round';
      ctx.strokeStyle = P.col;
      ctx.lineWidth = 0.028 * P.size;
      for (let i = 0; i < n; i++) {
        const p = drift(P, i, 4.5 + h(i * 3) * 3, 3);
        const k = 1 - 0.45 * P.g + 1.6 * p.q; // with gusts: fainter between them, strong where one blows
        const stretch = clamp(0.7 + 0.3 * P.speed * p.v, 0.7, 3.5);
        const life = fract(P.t * (0.22 + h(i * 7) * 0.18) + h(i * 9));
        const a = Math.sin(Math.PI * life) ** 2;
        if (a < 0.03) continue;
        const len = (1.2 + h(i * 5) * 1.8) * P.size * stretch;
        const bow = (h(i * 13) - 0.5) * 0.5 + Math.sin(P.t * 0.8 + i) * 0.15;
        const x1 = p.x - P.dx * len; const y1 = p.y - P.dy * len;
        ctx.globalAlpha = Math.min(1, 0.55 * a * P.A * k);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((p.x + x1) / 2 - P.dy * bow, (p.y + y1) / 2 + P.dx * bow, p.x, p.y);
        ctx.stroke();
      }
    },
    // heat rising off the ground: faint bands of brighter and darker air wavering upwards (a shimmer, not a
    // real distortion of the picture: that would cost the TV too much)
    haze(ctx, P) {
      const m = ctx.getTransform();
      const ang = (Math.atan2(P.dy, P.dx) * 180) / Math.PI + 90;
      const v = 0.7;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const Wd = ctx.canvas.width; const Hd = ctx.canvas.height;
      ctx.globalAlpha = Math.min(1, 0.05 * P.A * P.amt);
      ctx.fillStyle = P.col;
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, 0.09 * P.A * P.amt);
      ctx.fillStyle = patternAt(ctx, tinted(noiseTile(), P.col), m, 1.6 * P.size, P.T.x * v, P.T.y * v, ang, 2.5);
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, 0.045 * P.A * P.amt);
      ctx.fillStyle = patternAt(ctx, tinted(noiseTile(), '#2a1a08'), m, 1.15 * P.size, P.T.x * v * 1.3 + 0.4, P.T.y * v * 1.3, ang + 8, 2.2);
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.restore();
    },
  };
  WDRAW.ash = WDRAW.snow;
  WDRAW.petals = WDRAW.leaves;

  function weather(ctx, w, W, H, t, now = Date.now()) {
    if (!w || !Array.isArray(w.layers)) return;
    const fadeMs = (w.fade || 0) * 1000;
    for (const L of w.layers) {
      const A = layerAlpha(L, now, fadeMs);
      if (A <= 0.003 || !WDRAW[L.type]) continue;
      const def = wtype(L.type);
      const s = seedOf(L.id || L.type);
      const speed = clamp(L.speed ?? 1, 0.05, 10);
      const g = def.nogust ? 0 : clamp(L.gust || 0, 0, 1);
      const ang = (L.dir ?? def.dir ?? 90) * D2R;
      const dx = Math.cos(ang); const dy = Math.sin(ang);
      const tr = FXDATA.wxTravel(L, t); // T: where the wind has carried things (anchored); ts: how far
      // gust fronts start just upwind of the table and cross it in GUST_CROSS seconds
      const u0 = Math.min(0, W * dx) + Math.min(0, H * dy) - 1; const u1 = Math.max(0, W * dx) + Math.max(0, H * dy) + 1;
      const P = {
        W, H, t, T: tr, ts: tr.s, A, s, g, speed, dx, dy,
        fronts: gustFronts(t, g, s % 7, ang), u0, uc: (u1 - u0) / GUST_CROSS,
        dens: ((W + 2 + 2 * GUST_MAX) * (H + 2 + 2 * GUST_MAX)) / ((W + 2) * (H + 2)), // the wider wrap margin, made up for
        amt: clamp(L.amount ?? 1, 0.05, 4), size: clamp(L.size ?? 1, 0.2, 4),
        col: L.color || def.color || '#ffffff',
      };
      ctx.save();
      ctx.globalAlpha = 1;
      WDRAW[L.type](ctx, P, L);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // lightning flashes going on right now (the table plays thunder for them)
  function flashes(w, t, now = Date.now()) {
    const out = [];
    if (!w || !Array.isArray(w.layers)) return out;
    const fadeMs = (w.fade || 0) * 1000;
    for (const L of w.layers) {
      if (L.type !== 'lightning' || L.thunder === false || layerAlpha(L, now, fadeMs) < 0.2) continue;
      const f = flashOf(L, t);
      if (f && f.ph < 0.2) out.push({ ...f, size: L.size ?? 1 });
    }
    return out;
  }
  const weatherOn = (w) => !!(w && Array.isArray(w.layers) && w.layers.some((l) => !l.hidden));

  // =====================================================================
  // Spell areas
  // =====================================================================
  // Deterministic point inside the template.
  function inside(tpl, i, salt) {
    const [x0, y0, x1, y1] = tpl.bbox;
    for (let k = 0; k < 10; k++) {
      const x = x0 + h(i * 31 + k * 7 + salt) * (x1 - x0);
      const y = y0 + h(i * 37 + k * 11 + salt * 3) * (y1 - y0);
      if (tpl.contains(x, y)) return [x, y];
    }
    return [tpl.cx, tpl.cy];
  }

  // envelope: how strong the spell is right now (cast flash, steady loop, fade out)
  function envelope(sp, now) {
    const tb = Math.max(0, (now - sp.t0) / 1000);
    const intro = Math.min(1, tb / 0.35);
    const level = sp.mode === 'stay' ? 0.85 : tb < 1.4 ? 1 : Math.max(0.35, 1 - (tb - 1.4) * 0.35);
    const fade = sp.expires ? clamp((sp.expires - now) / 1200, 0, 1) : 1;
    return { tb, intro, level, A: intro * fade };
  }

  // the look of a spell, with its own colour if the GM picked one
  function skinOf(sp) {
    const base = FXDATA.SKINS[sp.skin] || FXDATA.SKINS.arcane;
    return sp.color ? { ...base, c: sp.color, l: mix(sp.color, '#ffffff', 0.6), d: mix(sp.color, '#000000', 0.7) } : base;
  }

  function spell(ctx, sp, tpl, cells, now, opts = {}) {
    const sk = skinOf(sp);
    const env = envelope(sp, now);
    const { tb, level } = env;
    const A = env.A * (opts.alpha ?? 1);
    if (A <= 0.003) return;
    const t = now / 1000;
    const S = tpl.S || tpl.extent;
    const s = seedOf(sp.id);
    const lw = opts.px || 0.02; // one screen pixel in inches

    // affected squares under everything
    if (cells && cells.length && opts.squares) {
      ctx.beginPath();
      for (const c of cells) { ctx.moveTo(c.poly[0], c.poly[1]); for (let i = 2; i < c.poly.length; i += 2) ctx.lineTo(c.poly[i], c.poly[i + 1]); ctx.closePath(); }
      ctx.fillStyle = rgba(sk.c, 0.2 * A);
      ctx.fill();
      ctx.strokeStyle = rgba(sk.l, 0.45 * A);
      ctx.lineWidth = lw * 1.5;
      ctx.stroke();
    }

    ctx.save();
    Geom.tracePath(ctx, tpl);
    ctx.clip();
    // body
    const dark = sp.skin === 'darkness';
    const g = ctx.createRadialGradient(tpl.origin.x, tpl.origin.y, 0, tpl.origin.x, tpl.origin.y, tpl.extent);
    g.addColorStop(0, rgba(dark ? sk.d : sk.c, (dark ? 0.9 : 0.3) * A * (0.6 + 0.4 * level)));
    g.addColorStop(1, rgba(dark ? sk.c : sk.d, (dark ? 0.86 : 0.16) * A * (0.6 + 0.4 * level)));
    ctx.fillStyle = g;
    ctx.fillRect(tpl.bbox[0], tpl.bbox[1], tpl.bbox[2] - tpl.bbox[0], tpl.bbox[3] - tpl.bbox[1]);
    particles(ctx, sp, tpl, sk, t, tb, S, s, A * level, lw);
    // cast flash
    if (tb < 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(sk.l, 0.55 * (1 - tb / 0.5) * A);
      ctx.fillRect(tpl.bbox[0], tpl.bbox[1], tpl.bbox[2] - tpl.bbox[0], tpl.bbox[3] - tpl.bbox[1]);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // shockwave from the point of origin while casting
    if (tb < 0.8) {
      const ph = tb / 0.8;
      ctx.globalAlpha = (1 - ph) * A;
      ctx.strokeStyle = sk.l;
      ctx.lineWidth = Math.max(lw * 2, S * 0.015);
      ctx.beginPath();
      ctx.arc(tpl.origin.x, tpl.origin.y, Math.max(0.01, ph * S), 0, TAU);
      ctx.save();
      Geom.tracePath(ctx, tpl);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(tpl.origin.x, tpl.origin.y, Math.max(0.01, ph * S), 0, TAU);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // outline
    Geom.tracePath(ctx, tpl);
    ctx.strokeStyle = rgba(opts.selected ? '#e3963e' : sk.l, (opts.selected ? 1 : 0.75) * A);
    ctx.lineWidth = opts.selected ? lw * 3 : lw * 2;
    if (opts.selected) ctx.setLineDash([lw * 8, lw * 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function particles(ctx, sp, tpl, sk, t, tb, S, s, A, lw) {
    const P = (i, salt = 0) => inside(tpl, i + s, salt);
    switch (sp.skin) {
      case 'fire': {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 46; i++) {
          const [x, y] = P(i);
          const ph = fract(t * 1.2 + h(s + i));
          dot(ctx, sprite(i % 3 ? sk.c : sk.l), x + Math.sin(t * 6 + i) * S * 0.01, y - ph * S * 0.12, S * 0.075 * (1 - ph * 0.6), (1 - ph) * 0.55 * A);
        }
        for (let i = 0; i < 24; i++) {
          const [x, y] = P(i, 5);
          const ph = fract(t * 0.6 + h(s + i * 3));
          dot(ctx, sprite('#ffd27a', 0.5), x + Math.sin(t * 2 + i) * S * 0.03, y - ph * S * 0.3, Math.max(lw * 1.5, S * 0.006), (1 - ph) * A);
        }
        break;
      }
      case 'cold': {
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 10; i++) {
          const [x, y] = P(i, 2);
          dot(ctx, sprite('#dff3ff'), x + Math.sin(t * 0.3 + i) * S * 0.04, y, S * 0.16, 0.12 * A);
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(lw, S * 0.002);
        for (let i = 0; i < 44; i++) {
          const [x, y] = P(i, 4);
          const tw = Math.max(0, Math.sin(t * 2.2 + h(s + i) * TAU)) ** 3;
          const r = S * 0.012 * (0.5 + h(s + i * 9));
          ctx.globalAlpha = tw * A;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3 + i; ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
          ctx.stroke();
          dot(ctx, sprite(sk.c), x, y, r * 2.2, 0.35 * tw * A);
        }
        break;
      }
      case 'lightning': {
        ctx.globalCompositeOperation = 'lighter';
        const k = Math.floor(t * 11);
        for (let b = 0; b < 3; b++) {
          if (h(k * 7 + b + s) < 0.25 && tb > 0.5) continue;
          let a; let z;
          if (sp.shape === 'line') {
            // from the caster to the far end of the line
            a = [tpl.origin.x, tpl.origin.y];
            z = [(tpl.poly[2] + tpl.poly[4]) / 2, (tpl.poly[3] + tpl.poly[5]) / 2];
          } else { a = P(k * 3 + b, 11); z = P(k * 3 + b, 23); }
          const seg = 9;
          const dx = z[0] - a[0]; const dy = z[1] - a[1]; const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len; const ny = dx / len;
          const path = [];
          for (let i = 0; i <= seg; i++) {
            const f = i / seg;
            const j = i === 0 || i === seg ? 0 : (h(k * 13 + b * 5 + i) - 0.5) * Math.min(len * 0.16, S * 0.3);
            path.push(a[0] + dx * f + nx * j, a[1] + dy * f + ny * j);
          }
          for (const [w, c, al] of [[S * 0.03, sk.c, 0.3], [S * 0.008, sk.l, 0.95]]) {
            ctx.globalAlpha = al * A;
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(lw, w);
            ctx.beginPath();
            ctx.moveTo(path[0], path[1]);
            for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
            ctx.stroke();
          }
        }
        break;
      }
      case 'thunder': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = sk.l;
        for (let k = 0; k < 3; k++) {
          const ph = fract(t * 0.8 + k / 3);
          ctx.globalAlpha = (1 - ph) * 0.55 * A;
          ctx.lineWidth = Math.max(lw * 2, S * 0.012);
          ctx.beginPath();
          ctx.arc(tpl.origin.x, tpl.origin.y, Math.max(0.01, ph * S), 0, TAU);
          ctx.stroke();
        }
        dust(ctx, P, s, S, t, A, '#cfd8ea');
        break;
      }
      case 'acid':
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 34; i++) {
          const [x, y] = P(i, 3);
          const ph = fract(t * 0.7 + h(s + i));
          const r = S * 0.03 * ph + lw;
          ctx.globalAlpha = (1 - ph) * 0.8 * A;
          ctx.strokeStyle = sk.l;
          ctx.lineWidth = Math.max(lw, S * 0.003);
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          dot(ctx, sprite(sk.c), x, y, r * 1.6, 0.25 * (1 - ph) * A);
        }
        break;
      case 'poison':
      case 'cloud': {
        ctx.globalCompositeOperation = 'source-over';
        const n = sp.skin === 'cloud' ? 26 : 20;
        for (let i = 0; i < n; i++) {
          const [x, y] = P(i, 6);
          const dx = Math.sin(t * 0.25 + i) * S * 0.05; const dy = Math.cos(t * 0.2 + i * 2) * S * 0.03;
          dot(ctx, sprite(i % 3 ? sk.c : sk.l), x + dx, y + dy, S * (sp.skin === 'cloud' ? 0.2 : 0.16), (sp.skin === 'cloud' ? 0.4 : 0.24) * A);
        }
        break;
      }
      case 'necrotic':
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 16; i++) {
          const [x, y] = P(i, 7);
          const ph = fract(t * 0.18 + h(s + i));
          dot(ctx, sprite('#140a22'), x + Math.sin(t * 0.4 + i) * S * 0.04, y - ph * S * 0.15, S * 0.14 * (0.5 + ph), 0.45 * Math.sin(ph * Math.PI) * A);
        }
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 18; i++) {
          const [x, y] = P(i, 8);
          const tw = Math.max(0, Math.sin(t * 1.6 + h(s + i * 3) * TAU)) ** 2;
          dot(ctx, sprite(sk.l, 0.3), x, y, Math.max(lw, S * 0.008), tw * A);
        }
        break;
      case 'radiant': {
        ctx.globalCompositeOperation = 'lighter';
        const cx = tpl.kind === 'circle' ? tpl.cx : tpl.origin.x; const cy = tpl.kind === 'circle' ? tpl.cy : tpl.origin.y;
        ctx.strokeStyle = sk.l;
        ctx.lineWidth = S * 0.035;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + t * 0.15;
          ctx.globalAlpha = (0.08 + 0.06 * Math.sin(t * 2 + i)) * A;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * S, cy + Math.sin(a) * S); ctx.stroke();
        }
        dot(ctx, sprite(sk.c), cx, cy, S * 0.5, 0.3 * A);
        for (let i = 0; i < 30; i++) {
          const [x, y] = P(i, 9);
          const tw = Math.max(0, Math.sin(t * 2.4 + h(s + i * 3) * TAU)) ** 4;
          dot(ctx, sprite(sk.l, 0.4), x, y, Math.max(lw, S * 0.01), tw * A);
        }
        break;
      }
      case 'force': {
        ctx.globalCompositeOperation = 'lighter';
        const hs = S * 0.07;
        const [x0, y0, x1, y1] = tpl.bbox;
        ctx.strokeStyle = sk.l;
        ctx.lineWidth = Math.max(lw, S * 0.003);
        const dx = hs * 1.5; const dy = hs * Math.sqrt(3);
        let n = 0;
        for (let i = 0; x0 + i * dx <= x1 + hs && n < 700; i++) {
          for (let j = -1; y0 + j * dy <= y1 + hs && n < 700; j++) {
            const x = x0 + i * dx; const y = y0 + j * dy + (i % 2 ? dy / 2 : 0);
            n++;
            const d = Math.hypot(x - tpl.origin.x, y - tpl.origin.y);
            ctx.globalAlpha = (0.12 + 0.3 * Math.max(0, Math.sin((d / S) * 9 - t * 3))) * A;
            ctx.beginPath();
            for (let k = 0; k <= 6; k++) { const a = (k * Math.PI) / 3; const px = x + Math.cos(a) * hs * 0.95; const py = y + Math.sin(a) * hs * 0.95; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
            ctx.stroke();
          }
        }
        break;
      }
      case 'psychic': {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 44; i++) {
          const [x, y] = P(i, 10);
          const a = h(s + i) * TAU + t * (0.8 + h(s + i * 2) * 0.8);
          const rr = S * 0.06 * (0.4 + h(s + i * 3));
          dot(ctx, sprite(i % 2 ? sk.c : sk.l, 0.3), x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(lw, S * 0.012), (0.5 + 0.5 * Math.sin(t * 3 + i)) * A);
        }
        ctx.strokeStyle = sk.c;
        ctx.lineWidth = Math.max(lw, S * 0.006);
        for (let k = 0; k < 3; k++) {
          const ph = fract(t * 0.45 + k / 3);
          ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.35 * A;
          ctx.beginPath();
          ctx.arc(tpl.cx, tpl.cy, Math.max(0.01, ph * S * 0.6), 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'nature': {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = sk.c;
        ctx.lineWidth = Math.max(lw, S * 0.008);
        for (let i = 0; i < 14; i++) {
          const [x, y] = P(i, 12);
          const sw = Math.sin(t * 0.8 + i) * S * 0.03;
          ctx.globalAlpha = 0.8 * A;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.bezierCurveTo(x + S * 0.06 + sw, y - S * 0.05, x - S * 0.05, y - S * 0.1 + sw, x + sw, y - S * 0.16);
          ctx.stroke();
          ctx.fillStyle = sk.l;
          ctx.beginPath(); ctx.ellipse(x + sw, y - S * 0.16, S * 0.018, S * 0.008, i, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'darkness':
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 10; i++) {
          const [x, y] = P(i, 13);
          dot(ctx, sprite('#000000'), x + Math.sin(t * 0.3 + i) * S * 0.05, y, S * 0.25, 0.5 * A);
        }
        break;
      // ---------- Beta 2 ----------
      case 'water': {
        const round = tpl.kind === 'circle';
        ctx.globalCompositeOperation = 'lighter';
        if (round) { // a whirl: foam arcs turning round the middle
          ctx.strokeStyle = sk.l;
          for (let j = 0; j < 7; j++) {
            const rr = S * (0.2 + 0.11 * j);
            const a0 = (t * (1.4 - j * 0.12) + h(s + j) * TAU) % TAU; // (spells run on the clock's seconds: the graphics card rounds big angles)
            ctx.globalAlpha = (0.45 + 0.2 * Math.sin(t * 2 + j)) * A;
            ctx.lineWidth = Math.max(lw * 1.5, S * 0.02);
            ctx.beginPath(); ctx.arc(tpl.cx, tpl.cy, rr, a0, a0 + 1.6 + h(s + j * 3)); ctx.stroke();
          }
        } else { // foam streaks running away from the caster
          ctx.strokeStyle = sk.l;
          ctx.lineCap = 'round';
          for (let i = 0; i < 26; i++) {
            const [x, y] = P(i, 21);
            const dx = x - tpl.origin.x; const dy = y - tpl.origin.y; const l = Math.hypot(dx, dy) || 1;
            const ph = fract(t * 0.9 + h(s + i));
            const len = S * 0.08;
            const ox = (dx / l) * ph * S * 0.15; const oy = (dy / l) * ph * S * 0.15;
            ctx.globalAlpha = Math.sin(Math.PI * ph) * 0.6 * A;
            ctx.lineWidth = Math.max(lw, S * 0.01);
            ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + (dx / l) * len, y + oy + (dy / l) * len); ctx.stroke();
          }
        }
        // ripples, churned foam, spray when it lands
        ctx.strokeStyle = sk.l;
        for (let i = 0; i < 10; i++) {
          const [x, y] = P(i, 22);
          const ph = fract(t * 0.6 + h(s + i * 3));
          ctx.globalAlpha = (1 - ph) * 0.45 * A;
          ctx.lineWidth = Math.max(lw, S * 0.006);
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, S * 0.07 * ph), 0, TAU); ctx.stroke();
        }
        const fk = Math.floor(t * 9);
        for (let i = 0; i < 30; i++) {
          const [x, y] = P(i + fk * 31, 23);
          dot(ctx, sprite('#ffffff', 0.4), x, y, Math.max(lw, S * 0.01), 0.55 * A);
        }
        if (tb < 1.3) {
          for (let i = 0; i < 40; i++) {
            const [x, y] = P(i, 24);
            const u = tb / 1.3;
            const dx = x - tpl.origin.x; const dy = y - tpl.origin.y;
            dot(ctx, sprite(sk.l, 0.4), tpl.origin.x + dx * ease01(u * 1.6), tpl.origin.y + dy * ease01(u * 1.6), Math.max(lw, S * 0.012), (1 - u) * A);
          }
        }
        break;
      }
      case 'earth': {
        // cracks from where it starts, then stones bursting up and settling, dust
        ctx.globalCompositeOperation = 'source-over';
        const o = tpl.kind === 'circle' ? { x: tpl.cx, y: tpl.cy } : tpl.origin;
        const grow = ease01(tb / 0.5);
        for (const [c, w, al] of [[sk.d, 0.016, 0.7], [sk.l, 0.006, 0.45]]) {
          ctx.strokeStyle = c; ctx.lineWidth = Math.max(lw, S * w); ctx.globalAlpha = al * A;
          ctx.beginPath();
          for (let j = 0; j < 9; j++) {
            let a = h(s + j * 3.1) * TAU; let x = o.x; let y = o.y;
            ctx.moveTo(x, y);
            for (let k = 0; k < 6; k++) { a += (h(s + j * 7 + k) - 0.5) * 0.9; const st = S * 0.16 * grow * (0.6 + h(s + j * 11 + k)); x += Math.cos(a) * st; y += Math.sin(a) * st; ctx.lineTo(x, y); }
          }
          ctx.stroke();
        }
        const pop = (i) => { const q = tb - 0.1 - h(s + i * 5) * 0.4; return q <= 0 ? 0 : q < 0.25 ? 1.3 * ease01(q / 0.25) : 1 + 0.3 * Math.max(0, 1 - (q - 0.25) / 0.3); };
        for (let i = 0; i < 18; i++) {
          const [x, y] = P(i, 25);
          const k = pop(i);
          if (k <= 0) continue;
          const r = S * (0.035 + 0.05 * h(s + i * 9)) * k;
          ctx.globalAlpha = 0.95 * A;
          ctx.fillStyle = sk.d;
          ctx.beginPath();
          for (let q = 0; q <= 7; q++) { const a = (q / 7) * TAU; const rr = r * (0.75 + 0.35 * h(s + i * 13 + q)); if (q) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = sk.c;
          ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.5, 0, TAU); ctx.fill();
        }
        for (let i = 0; i < 14; i++) {
          const [x, y] = P(i, 26);
          const ph = fract(t * 0.25 + h(s + i * 3));
          const burst = tb < 2 ? 1 - tb / 2 : 0;
          dot(ctx, sprite(sk.l), x + Math.sin(t * 0.4 + i) * S * 0.03, y, S * (0.08 + 0.1 * ph + 0.12 * burst), (0.12 + 0.3 * burst) * Math.sin(Math.PI * ph) * A);
        }
        break;
      }
      case 'swarm': {
        // a cloud of insects: specks buzzing round their spots, a faint shadow where they are thickest
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 9; i++) { const [x, y] = P(i, 27); dot(ctx, sprite(sk.d), x + Math.sin(t * 0.5 + i) * S * 0.05, y + Math.cos(t * 0.4 + i) * S * 0.05, S * 0.2, 0.18 * A); }
        ctx.fillStyle = sk.d;
        for (let i = 0; i < 150; i++) {
          const [hx, hy] = P(i, 28);
          const x = hx + Math.sin(t * 7.1 + i * 1.3) * S * 0.03 + Math.sin(t * 13.3 + i * 2.1) * S * 0.012 + Math.sin(t * 0.7 + i) * S * 0.04;
          const y = hy + Math.cos(t * 6.3 + i * 1.7) * S * 0.03 + Math.sin(t * 11.9 + i * 0.7) * S * 0.012 + Math.cos(t * 0.6 + i * 2) * S * 0.04;
          const r = Math.max(lw * 0.9, S * 0.0045);
          ctx.globalAlpha = 0.9 * A;
          ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, (t * 9 + i) % TAU, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 30; i++) { // wings catching the light
          const [hx, hy] = P(i, 29);
          const tw = Math.max(0, Math.sin(t * 19 + i * 3.7)) ** 6;
          dot(ctx, sprite(sk.l, 0.4), hx + Math.sin(t * 7.1 + i) * S * 0.03, hy + Math.cos(t * 6.3 + i) * S * 0.03, Math.max(lw, S * 0.006), tw * 0.6 * A);
        }
        break;
      }
      default: // arcane
        ctx.globalCompositeOperation = 'lighter';
        dot(ctx, sprite(sk.c), tpl.cx, tpl.cy, S * 0.55, (0.18 + 0.08 * Math.sin(t * 2)) * A);
        for (let i = 0; i < 34; i++) {
          const [x, y] = P(i, 14);
          const ph = fract(t * 0.3 + h(s + i));
          dot(ctx, sprite(sk.l, 0.4), x + Math.sin(t + i) * S * 0.02, y - ph * S * 0.08, Math.max(lw, S * 0.009), Math.sin(ph * Math.PI) * A);
        }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Preview while placing: affected squares and a dashed outline, no animation.
  function ghost(ctx, sp, tpl, cells, px) {
    const sk = skinOf(sp);
    if (cells && cells.length) {
      ctx.beginPath();
      for (const c of cells) { ctx.moveTo(c.poly[0], c.poly[1]); for (let i = 2; i < c.poly.length; i += 2) ctx.lineTo(c.poly[i], c.poly[i + 1]); ctx.closePath(); }
      ctx.fillStyle = rgba(sk.c, 0.22);
      ctx.fill();
    }
    Geom.tracePath(ctx, tpl);
    ctx.fillStyle = rgba(sk.c, 0.12);
    ctx.fill();
    ctx.strokeStyle = '#e3963e';
    ctx.lineWidth = px * 2.5;
    ctx.setLineDash([px * 10, px * 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    // point of origin
    ctx.beginPath();
    ctx.arc(tpl.origin.x, tpl.origin.y, px * 5, 0, TAU);
    ctx.fillStyle = '#e3963e';
    ctx.fill();
  }

  function dust(ctx, P, s, S, t, A, col) {
    for (let i = 0; i < 14; i++) {
      const [x, y] = P(i, 15);
      dot(ctx, sprite(col, 0.4), x + Math.sin(t + i) * S * 0.02, y + Math.cos(t * 0.7 + i) * S * 0.02, S * 0.008, 0.6 * A);
    }
  }

  // how much things travelling along a painted stroke turn per step (degrees): for the self-test
  function flowTurn(st, step = 0.01, span = 0) {
    const f = smoothLine(st, `turn|${Math.random()}`);
    let max = 0; let prev = null;
    for (let d = 0; d <= f.len; d += step) {
      const q = span ? heading(f, d, span) : along(f, d);
      const a = Math.atan2(q.dy, q.dx);
      if (prev != null) { let da = Math.abs(a - prev); if (da > Math.PI) da = TAU - da; max = Math.max(max, da); }
      prev = a;
    }
    return (max * 180) / Math.PI;
  }
  // Beta 3.1: Sway. The map picture itself moves where the area is painted, as if the wind moved it: the picture under
  // the area is copied (sharp, at the layer's pixels), cut into thin strips across the wind and every strip pushed a
  // little along it and sideways by waves that travel with the wind (the way the strokes were painted); the moved copy
  // is laid over the map, cut to the painted area with a soft edge, so nothing outside it moves.
  //   bg: { el, x, y, w, h, turn, key } the map picture and where it lies (map units), k: one grid square (map units)
  const swaySrc = new Map();
  function sway(ctx, fx, t, k, bg) {
    const el = bg && bg.el;
    if (!el || !(fx.strokes || []).length) return;
    const video = el.tagName === 'VIDEO';
    if (video ? el.readyState < 2 : !(el.complete && el.naturalWidth)) return;
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const px = m.a; // layer pixels per map unit
    const I = fx.intensity ?? 1;
    const amp = 0.09 * k * I; // how far it moves at most (map units): about a tenth of a square at Strength 100 %
    const B = regionBox(ctx, fx, 0.5 * k);
    if (!B || !(px > 0)) return;
    const grow = Math.ceil(amp * px * 1.7) + 2;
    const P = { x: Math.max(0, B.x - grow), y: Math.max(0, B.y - grow) };
    P.w = Math.min(W, B.x + B.w + grow) - P.x; P.h = Math.min(H, B.y + B.h + grow) - P.y;
    if (P.w <= 0 || P.h <= 0) return;
    // 1. the picture under the area (a still picture is kept until the view or the area changes)
    const key = `${bg.key}|${m.a.toFixed(5)},${m.e.toFixed(2)},${m.f.toFixed(2)}|${P.x},${P.y},${P.w},${P.h}|${bg.x},${bg.y},${bg.w},${bg.h},${bg.turn || 0}`;
    let e = swaySrc.get(fx.id);
    if (!e) { e = { key: '', c: document.createElement('canvas') }; swaySrc.set(fx.id, e); if (swaySrc.size > 40) swaySrc.delete(swaySrc.keys().next().value); }
    const src = e.c;
    if (video || e.key !== key) {
      if (src.width !== P.w || src.height !== P.h) { src.width = P.w; src.height = P.h; }
      const g = src.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, P.w, P.h);
      g.setTransform(m.a, m.b, m.c, m.d, m.e - P.x, m.f - P.y);
      if (bg.turn) { const cx = bg.x + bg.w / 2; const cy = bg.y + bg.h / 2; g.translate(cx, cy); g.rotate((bg.turn * Math.PI) / 180); g.translate(-cx, -cy); }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      try { g.drawImage(el, bg.x, bg.y, bg.w, bg.h); } catch { return; }
      e.key = video ? '' : key;
    }
    // 2. the moved copy, in strips across the wind
    const s = seedOf(fx.id);
    const T = t * (fx.speed ?? 1);
    const [dx, dy] = flowDir(fx, s);
    const cols = Math.abs(dx) >= Math.abs(dy); // the wind blows mostly across: columns, else rows
    const len = cols ? P.w : P.h;
    const strip = Math.max(Math.max(2, Math.round(3 / Q)), Math.ceil(len / 420)); // finer on Full, never more than ~420 strips
    const lam = (1.8 * k) / Math.min(4, Math.max(0.25, fx.density ?? 1)); // the length of one gust wave (map units); Amount: finer waves
    const sc = scratch(7, W, H, B); // (a scratch canvas of its own: the Sway layer is sharper than the others)
    const g = sc.g;
    const gust = 0.72 + 0.28 * Math.sin(T * 0.53 + s) * Math.sin(T * 0.31 + s * 0.7); // the wind comes and goes
    const sign = cols ? Math.sign(dx) || 1 : Math.sign(dy) || 1; // waves travel downwind
    for (let u = 0; u < len; u += strip) {
      const um = ((cols ? P.x : P.y) + u + strip / 2 - (cols ? m.e : m.f)) / px * sign; // map units along the wind
      const ph = (TAU * um) / lam - T * 1.9;
      const along = amp * gust * (0.62 * Math.sin(ph + s) + 0.38 * Math.sin(2.7 * ph - T * 1.3 + s * 1.7));
      const side = amp * gust * 0.45 * Math.sin(1.6 * ph + T * 0.7 + s * 0.3);
      const ox = (along * dx - side * dy) * px; const oy = (along * dy + side * dx) * px;
      const w = Math.min(strip + 1, len - u); // one pixel more, so no seam shows between strips
      if (cols) g.drawImage(src, u, 0, w, P.h, P.x + u + ox, P.y + oy, w, P.h);
      else g.drawImage(src, 0, u, P.w, w, P.x + ox, P.y + u + oy, P.w, w);
    }
    stamp(ctx, sc, regionMask(ctx, fx, 0.35 * k));
  }

  // Beta 3.1: Roof. The weather is cut away where it is painted (with a soft edge), so it rains outside the house
  // and not in it. Strength under 100 % lets some of it through. On the GM screen a faint blue tint shows where it is.
  function roof(ctx, fx, k, gm) {
    if (!(fx.strokes || []).length) return;
    const B = regionBox(ctx, fx, 0.4 * k);
    if (!B) return;
    const mask = regionMask(ctx, fx, 0.2 * k);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(fx.intensity ?? 1, 0, 1);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    ctx.restore();
    if (gm) {
      const sc = scratch(8, ctx.canvas.width, ctx.canvas.height, B);
      sc.g.fillStyle = '#96beff';
      sc.g.fillRect(B.x, B.y, B.w, B.h);
      stamp(ctx, sc, mask, 'source-over', 0.24);
    }
  }

  return { setQuality, emitter, waveOf, ventLevel, region, regionLights, sway, roof, lightMask, windowIcon, darkness, glow, weather, flashes, strike, weatherOn, spell, ghost, envelope, seedOf, sprite, rgba, mix, skinOf, flowTurn };
})();
