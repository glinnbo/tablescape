// Second Builder (second-water-works): living effects that are not plain particles: Rapids, Bubbling pool,
// Whirlpool (with its swirl of the map's own water) and Geyser. Later packages add the creatures (birds, fish,
// bats, critters, insects) here, hence the name. The rules are fx.js's: everything is a function of time, a seed
// and an index, so the GM window and the TV show the same moment and nothing builds up over a session.
// Painted areas are drawn in grid squares (fx.js scales them); placed ones in map units, sized by fx.r.
'use strict';

const Creatures = (() => {
  const TAU = Math.PI * 2;
  const fract = (x) => x - Math.floor(x);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const F = () => FX; // (fx.js is loaded first; read it late so a test page may load the files in any order)
  const h = (n) => F().h(n);

  // ---------- the wind (the same one the living trees and grass use; scene-view hands it over each frame) ----------
  let WIND = null;
  function wind(w) { WIND = w || null; }
  // where the wind blows to (unit vector) and how hard (1: a breeze); without one, a seeded calm drift
  function windVec(s) {
    if (WIND && WIND.dir != null) { const a = (WIND.dir * Math.PI) / 180; return [Math.cos(a), Math.sin(a), WIND.strength ?? 1]; }
    const a = h(s + 0.77) * TAU;
    return [Math.cos(a), Math.sin(a), 0.6];
  }

  // ---------- events that happen now and then ----------
  // Event n happens at (n + jitter × h(n)) × period (+ a seeded start). Returns how long since the last one and how
  // long until the next, so a build-up before an event and an afterglow after it need no state.
  function cycle(t, period, seed, jitter = 0) {
    const off = h(seed + 0.31);
    const at = (n) => (n + off + jitter * (h(seed + n * 7.13) - 0.5)) * period;
    const n0 = Math.floor(t / period - off);
    let last = -Infinity; let next = Infinity; let n = n0;
    for (let k = n0 - 2; k <= n0 + 2; k++) { const e = at(k); if (e <= t && e > last) { last = e; n = k; } if (e > t && e < next) next = e; }
    return { n, since: t - last, until: next - t };
  }

  // ---------- small pictures, drawn once ----------
  const pics = new Map();
  function pic(key, size, draw) {
    let c = pics.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    if (pics.size > 120) pics.clear();
    pics.set(key, c);
    return c;
  }
  // a glossy bubble seen from above: lit from the top left, a dark rim to the bottom right, a soft contact shadow
  function domePic(body, hi, dark, gloss, solid = 0.35) {
    return pic(`dome|${body}|${hi}|${dark}|${gloss}|${solid}`, 128, (g, N) => {
      const c = N / 2; const R = N * 0.36;
      const { rgba, mix } = F();
      let gr = g.createRadialGradient(c + R * 0.18, c + R * 0.22, R * 0.6, c + R * 0.18, c + R * 0.22, R * 1.32);
      gr.addColorStop(0, rgba(dark, 0.55)); gr.addColorStop(1, rgba(dark, 0));
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
      gr = g.createRadialGradient(c - R * 0.42, c - R * 0.45, R * 0.05, c, c, R);
      // the film: see-through in the middle (the surface it rises from shows), shaded toward the bottom right
      gr.addColorStop(0, rgba(mix(body, hi, 0.5), solid * 0.9)); gr.addColorStop(0.5, rgba(body, solid)); gr.addColorStop(0.85, rgba(mix(body, dark, 0.6), Math.min(1, solid + 0.35))); gr.addColorStop(1, rgba(dark, Math.min(1, solid + 0.55)));
      g.fillStyle = gr; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
      // a thin bright edge on the lit side (the film catching the light)
      g.strokeStyle = rgba(hi, 0.35 * gloss); g.lineWidth = N * 0.012;
      g.beginPath(); g.arc(c, c, R * 0.94, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
      // the highlight
      g.save(); g.translate(c - R * 0.38, c - R * 0.42); g.rotate(-0.7);
      gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
      gr.addColorStop(0, `rgba(255,255,255,${0.95 * gloss})`); gr.addColorStop(0.45, `rgba(255,255,255,${0.45 * gloss})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.scale(1.5, 0.75); g.beginPath(); g.arc(0, 0, R * 0.34, 0, TAU); g.fill();
      g.restore();
      // a small second glint at the bottom right (light through the film)
      gr = g.createRadialGradient(c + R * 0.45, c + R * 0.5, 0, c + R * 0.45, c + R * 0.5, R * 0.22);
      gr.addColorStop(0, rgba(hi, 0.3 * gloss)); gr.addColorStop(1, rgba(hi, 0));
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    });
  }
  // a clear bubble (water): a thin ring with a glint
  function clearPic(col) {
    return pic(`clear|${col}`, 64, (g, N) => {
      const c = N / 2; const R = N * 0.38; const { rgba } = F();
      let gr = g.createRadialGradient(c, c, R * 0.55, c, c, R);
      gr.addColorStop(0, rgba(col, 0.05)); gr.addColorStop(0.8, rgba(col, 0.25)); gr.addColorStop(1, rgba(col, 0.7));
      g.fillStyle = gr; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
      gr = g.createRadialGradient(c - R * 0.4, c - R * 0.4, 0, c - R * 0.4, c - R * 0.4, R * 0.35);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    });
  }
  function put(ctx, img, x, y, r, a) { // img's circle (R = 0.36..0.38 of its size) at radius r
    if (a <= 0.004 || r <= 0) return;
    const s = r / 0.37;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  }
  // a thin ring spreading on a surface
  function ring(ctx, x, y, r, a, col, lw) {
    if (a <= 0.004 || r <= 0) return;
    ctx.globalAlpha = Math.min(1, a); ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }

  // =====================================================================
  // Painted effects (drawn in grid squares)
  // =====================================================================
  const POOLS = { // body, highlight, shadow, gloss, bubble size (squares), seconds per bubble, rings
    mud: { body: '#6e4c2f', hi: '#e8c79c', dark: '#24160b', gloss: 0.75, size: [0.14, 0.32], per: [3.5, 6.5], solid: 0.26 },
    bog: { body: '#46522a', hi: '#d8e6a0', dark: '#0e1407', gloss: 0.7, size: [0.12, 0.28], per: [3, 6], gas: '#a9b97a', solid: 0.22 },
    spring: { body: '#9fe4ef', hi: '#ffffff', dark: '#1d5a66', gloss: 1, size: [0.04, 0.09], per: [1.6, 3], steam: '#eef4f8' },
    tar: { body: '#141110', hi: '#ffffff', dark: '#000000', gloss: 1, size: [0.22, 0.42], per: [8, 13], solid: 0.92 },
  };
  const sampleCache = new Map();
  function samplesOf(fx) {
    const sig = F().strokeSig(fx); const e = sampleCache.get(fx.id);
    if (e && e.sig === sig && e.st === fx.strokes) return e.S;
    const S = F().samples(fx, 0.8);
    if (sampleCache.size > 80) sampleCache.clear();
    sampleCache.set(fx.id, { sig, st: fx.strokes, S });
    return S;
  }
  function bubbling(ctx, fx, t, o) {
    const { dot, sprite, mix, rgba, regionMask, regionBox } = F();
    const kind = POOLS[fx.variant] ? fx.variant : 'mud';
    const K = POOLS[kind]; const { s, I } = o;
    const body = o.C || K.body; const hi = K.hi; const dark = o.C ? mix(o.C, '#000000', 0.7) : K.dark;
    // a light tint of the kind's colour only when Strength goes over 100 %
    if (I > 1.02) {
      const B = regionBox(ctx, fx, 0.3);
      if (B) {
        const mask = regionMask(ctx, fx, 0.4);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(0.92, (I - 1) * 1.15);
        const tc = document.createElement('canvas'); // (rare: only above 100 %)
        tc.width = B.w; tc.height = B.h; const tg = tc.getContext('2d');
        tg.fillStyle = body; tg.fillRect(0, 0, B.w, B.h); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, B.x, B.y, B.w, B.h, 0, 0, B.w, B.h);
        ctx.drawImage(tc, B.x, B.y); ctx.restore();
      }
    }
    const A = Math.min(1, I);
    const [wx, wy, ws] = windVec(s);
    // spots spread evenly over the painted area (not only where the brush's points lie)
    const S = samplesOf(fx);
    if (!S.length) return;
    o = { ...o, at: (i, salt) => { const p = S[Math.floor(h(s + i * 13 + salt) * S.length)]; const a = h(s + i * 17 + salt) * TAU; const d = Math.sqrt(h(s + i * 19 + salt)) * p[2] * 0.9; return [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, p[2]]; }, pts: S };
    const area = S.reduce((q, p) => q + 1.6 * p[2] * p[2], 0); // about the area in squares (samples lie 0.8 brush radii apart)
    if (kind === 'spring') { spring(ctx, fx, t, o, K, wx, wy, ws, A); return; }
    const nb = Math.min(kind === 'tar' ? 10 : 36, F().count(Math.max(2, Math.round(area * (kind === 'tar' ? 0.2 : 0.5))), fx));
    const dome = domePic(body, hi, dark, K.gloss, K.solid);
    const rimCol = mix(body, '#000000', 0.55); const ringCol = mix(body, hi, kind === 'tar' ? 0.35 : 0.3);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < nb; i++) {
      const per = K.per[0] + (K.per[1] - K.per[0]) * h(s + i * 3.7);
      const ph = t / per + h(s + i * 5.3); const round = Math.floor(ph); const u = ph - round;
      const p = o.at(i + round * 97, 21);
      const R = (K.size[0] + (K.size[1] - K.size[0]) * h(s + i * 9.1 + round * 1.3)) * Math.min(1.6, Math.max(0.6, p[2]));
      const x = p[0]; const y = p[1];
      const SW = 0.8; const POP = 0.86; // swell until 0.8, burst until 0.86, then the crater relaxes
      if (u < SW) {
        const g = u / SW; const rr = R * (0.15 + 0.85 * Math.pow(g, 0.55)) * (1 + 0.04 * Math.sin(t * 9 + i) * g);
        // a dark ring of the surface pulled up round the dome
        ring(ctx, x + rr * 0.08, y + rr * 0.1, rr * 1.12, 0.22 * A * g, rimCol, rr * 0.18);
        put(ctx, dome, x, y, rr, A * Math.min(1, g * 4));
      } else {
        const g = (u - SW) / (1 - SW); // 0..1 after the burst
        // the ring of the burst, spreading and thinning
        ring(ctx, x, y, R * (1 + 1.8 * Math.sqrt(g)), A * 0.55 * (1 - g), ringCol, R * (kind === 'tar' ? 0.22 : 0.12) * (1 - g * 0.6));
        // the crater: a dark hollow with a lit rim, closing up
        if (u > POP - 0.04) {
          const c = 1 - sm(0, 1, (u - POP) / (1 - POP));
          ring(ctx, x, y, R * 0.7 * c, A * 0.5 * c, rimCol, R * 0.25 * c);
          ring(ctx, x - R * 0.06, y - R * 0.06, R * 0.55 * c, A * 0.3 * c, ringCol, R * 0.08 * c);
        }
        // droplets flung out on short arcs (the burst only)
        if (u < POP + 0.05 && kind !== 'tar') {
          const q = clamp((u - SW) / (POP + 0.05 - SW), 0, 1);
          const nd = 4 + Math.floor(h(s + i * 2.9 + round) * 5);
          for (let j = 0; j < nd; j++) {
            const a = h(s + i * 11 + j * 3.3 + round * 0.7) * TAU; const d = R * (1 + 2 * h(s + j * 5.1 + round) ) * q;
            const lift = Math.sin(Math.PI * q) * R * 0.5;
            dot(ctx, sprite(mix(body, hi, 0.3), 0.6), x + Math.cos(a) * d, y + Math.sin(a) * d - lift * 0.2, R * (0.09 + 0.05 * Math.sin(Math.PI * q)), A * 0.9 * (1 - q * 0.5));
          }
        }
        // a bog breathes out a puff of gas that drifts away with the wind
        if (K.gas && h(s + i * 1.9 + round * 3.1) < 0.5) {
          const q = g; const d = q * (0.6 + 0.6 * ws);
          dot(ctx, sprite(K.gas), x + wx * d, y + wy * d, R * (1.5 + 4 * q), 0.16 * A * Math.sin(Math.PI * Math.min(1, q * 1.1)));
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  // a hot spring: streams of small clear bubbles, steam lifting off and drifting with the wind
  function spring(ctx, fx, t, o, K, wx, wy, ws, A) {
    const { dot, sprite } = F(); const { s } = o;
    const bub = clearPic('#ffffff');
    const nv = Math.min(16, F().count(Math.max(3, Math.round(o.pts.length * 0.5)), fx));
    ctx.globalCompositeOperation = 'source-over';
    for (let v = 0; v < nv; v++) {
      const p = o.at(v, 31); const rate = 0.9 + 0.8 * h(s + v * 3.3);
      const nb = 7;
      for (let j = 0; j < nb; j++) {
        const u = fract(t * rate * 0.5 + j / nb + h(s + v * 7 + j) * 0.1);
        const jx = (h(s + v * 13 + j * 1.7 + Math.floor(t * rate * 0.5 + j / nb)) - 0.5) * 0.18;
        const jy = (h(s + v * 17 + j * 2.3 + Math.floor(t * rate * 0.5 + j / nb)) - 0.5) * 0.18;
        const x = p[0] + jx + Math.sin(t * 2 + j) * 0.02 * u; const y = p[1] + jy + Math.cos(t * 2.3 + j) * 0.02 * u;
        const r = (K.size[0] + (K.size[1] - K.size[0]) * h(s + v + j * 0.37)) * (0.5 + 0.6 * u);
        if (u < 0.9) put(ctx, bub, x, y, r, A * 0.85 * Math.min(1, u * 6));
        else ring(ctx, x, y, r * (1 + (u - 0.9) * 25), A * 0.6 * (1 - (u - 0.9) * 10), 'rgba(255,255,255,1)', r * 0.25);
      }
      // a faint glow of warmer water over the vent
      dot(ctx, sprite('#dff7fb'), p[0], p[1], 0.35, 0.08 * A);
    }
    // steam: wisps that rise (grow), drift with the wind and thin out
    const ns = Math.min(28, F().count(Math.max(5, Math.round(o.pts.length * 0.8)), fx));
    for (let i = 0; i < ns; i++) {
      const life = 5 + 3 * h(s + i * 4.1);
      const ph = t / life + h(s + i * 6.7); const u = fract(ph); const n = Math.floor(ph);
      const p = o.at(i * 3 + n * 53, 41);
      const d = u * (0.5 + 0.8 * ws);
      const x = p[0] + wx * d + Math.sin(t * 0.7 + i) * 0.12 * u; const y = p[1] + wy * d + Math.cos(t * 0.6 + i) * 0.12 * u;
      dot(ctx, sprite(K.steam), x, y, 0.35 + 0.9 * u, 0.3 * A * Math.sin(Math.PI * u));
    }
    ctx.globalAlpha = 1;
  }

  // Rapids: whitewater racing downstream, standing waves that stay and churn, V-shaped breakers behind hidden rocks
  function rapids(ctx, fx, t, o) {
    const { flowLines, along, flowDir, regionBox, regionMask, scratch, stamp, patternAt, noiseTile, tinted, mix, rgba, dot, sprite, count } = F();
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const B = regionBox(ctx, fx, 0.5);
    if (!B) return;
    const { s, I, C } = o; const A = Math.min(1.4, I);
    const foam = C ? mix(C, '#ffffff', 0.85) : '#f4fbff';
    const lines = flowLines(fx);
    const [fdx, fdy] = flowDir(fx, s);
    const ang = (Math.atan2(fdy, fdx) * 180) / Math.PI;
    const v = 2.1; // squares per second at speed 1 (River current: 0.9)
    const sc = scratch(9, W, H, B); const g = sc.g;
    // 1. churned water: two noise layers racing downstream; foam only where both are thick
    const tn = tinted(noiseTile(), foam);
    g.globalAlpha = Math.min(1, 0.85 * A);
    g.fillStyle = patternAt(g, tn, m, 1.5, fdx * v * t * 0.8, fdy * v * t * 0.8, ang, 2.4);
    g.fillRect(B.x, B.y, B.w, B.h);
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.fillStyle = patternAt(g, noiseTile(), m, 0.9, fdx * v * t * 0.55, fdy * v * t * 0.55, ang + 20, 1.6);
    g.fillRect(B.x, B.y, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
    g.setTransform(m);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const minW = 1 / Math.max(1e-6, m.a);
    const f0 = rgba(foam, 0); const fm = rgba(foam, 0.7); const f1 = rgba(foam, 1);
    const cap = Math.max(20, Math.floor(180 / Math.max(1, lines.length)));
    // 2. streaks: about twice River current's, longer and faster, shaking across the flow
    lines.forEach((f, li) => {
      const r = f.st.r;
      const k = Math.min(cap, count(Math.ceil(f.len * 7 * Math.max(1, r)), fx));
      for (let i = 0; i < k; i++) {
        const sd = s + li * 71 + i * 13;
        const life = fract(h(sd) + (t * v) / f.len * (0.75 + 0.5 * h(sd + 5)));
        const lat0 = (h(sd + 3) - 0.5) * 1.6 * r;
        const a = A * Math.min(1, 1.8 * Math.sin(Math.PI * life)) * (1 - Math.abs(lat0) / (r * 0.95));
        if (a <= 0.03) continue;
        const len = (0.5 + 0.9 * h(sd + 7)) * Math.min(1.2, r);
        const d0 = life * (f.len + len) - len;
        const path = new Path2D(); let x0 = 0; let y0 = 0; let x1 = 0; let y1 = 0;
        for (let j = 0; j <= 6; j++) {
          const dd = d0 + (len * j) / 6;
          const q = along(f, dd);
          const lat = lat0 + Math.sin(dd * 1.3 + h(sd + 1) * 9 + t * 0.9) * 0.05 * r;
          const x = q.x - q.dy * lat; const y = q.y + q.dx * lat;
          if (j) path.lineTo(x, y); else { path.moveTo(x, y); x0 = x; y0 = y; }
          x1 = x; y1 = y;
        }
        if (Math.hypot(x1 - x0, y1 - y0) < 0.03) continue;
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, f0); gr.addColorStop(0.35, fm); gr.addColorStop(0.75, f1); gr.addColorStop(1, f0);
        g.strokeStyle = gr;
        const lw = 0.05 + 0.07 * h(sd + 9);
        g.globalAlpha = Math.min(1, a * 0.22); g.lineWidth = Math.max(minW, lw * 3); g.stroke(path);
        g.globalAlpha = Math.min(1, a * 0.75); g.lineWidth = Math.max(minW, lw); g.stroke(path);
      }
    });
    // 3. standing waves: short bands of foam across the flow that stay where they are and churn in shape
    lines.forEach((f, li) => {
      const r = f.st.r; const gap = 1.35;
      const nw = Math.max(1, Math.floor(f.len / gap));
      for (let w = 0; w < nw; w++) {
        const sd = s + li * 37 + w * 11;
        const d = (w + 0.5 + (h(sd) - 0.5) * 0.6) * gap;
        if (d > f.len - 0.3) continue;
        const nb = 2 + Math.floor(h(sd + 1) * 2);
        for (let b = 0; b < nb; b++) {
          const db = d + b * 0.2 + (h(sd + b * 3) - 0.5) * 0.08;
          const q = along(f, db);
          const span = r * (0.5 + 0.45 * h(sd + b * 5)); const off = (h(sd + b * 7) - 0.5) * r * 0.6;
          const band = new Path2D();
          for (let j = 0; j <= 10; j++) {
            const sl = off + (j / 10 - 0.5) * 2 * span;
            const e = sl / span - off / span; // -1..1 along the band
            const bulge = -0.12 * (1 - e * e) + 0.04 * Math.sin(t * (2.1 + h(sd + b)) + j * 0.6 + b) + 0.015 * Math.sin(t * 3.3 + j * 0.9);
            const x = q.x - q.dy * sl + q.dx * bulge; const y = q.y + q.dx * sl + q.dy * bulge;
            if (j) band.lineTo(x, y); else band.moveTo(x, y);
          }
          const fl = 0.75 + 0.25 * Math.sin(t * 3.1 + w * 1.3 + b * 2);
          const aa = A * fl * (0.55 + 0.35 * h(sd + b * 9));
          g.strokeStyle = 'rgba(10,25,35,1)'; g.globalAlpha = 0.18 * aa; g.lineWidth = 0.16; // the trough in front of it
          g.save(); g.translate(-q.dx * 0.09, -q.dy * 0.09); g.stroke(band); g.restore();
          g.strokeStyle = foam;
          for (const [lw, al] of [[0.3, 0.18], [0.15, 0.35], [0.06, 0.6]]) { g.globalAlpha = Math.min(1, aa * al); g.lineWidth = Math.max(minW, lw); g.stroke(band); }
        }
      }
    });
    // 4. breakers: a V of foam behind a rock under the surface, foam running down its arms, spray puffing off
    const total = lines.reduce((q, f) => q + f.len, 0);
    const nbk = lines.length ? Math.min(12, count(Math.max(1, Math.round(total / 2.4)), fx)) : 0;
    for (let i = 0; i < nbk; i++) {
      const sd = s + i * 29 + 5;
      let pick = h(sd) * total; let f = lines[0];
      for (const L of lines) { if (pick <= L.len) { f = L; break; } pick -= L.len; }
      const r = f.st.r; const d = clamp(pick, 0.2, Math.max(0.2, f.len - 1.2));
      const q = along(f, d); const lat = (h(sd + 1) - 0.5) * 1.1 * r;
      const rx = q.x - q.dy * lat; const ry = q.y + q.dx * lat;
      const size = 0.75 + 0.5 * h(sd + 2);
      // the cushion of white water piled up in front of the rock and the rock's dark hump
      dot(g, sprite('#0b1a22'), rx + q.dx * 0.04, ry + q.dy * 0.04, 0.2 * size, 0.28 * A);
      dot(g, sprite(foam, 0.35), rx - q.dx * 0.05, ry - q.dy * 0.05, 0.16 * size * (1 + 0.08 * Math.sin(t * 7 + i)), 0.85 * A);
      // the two arms
      const armLen = (0.9 + 0.7 * h(sd + 3)) * size; const spread = 0.32 + 0.12 * h(sd + 4);
      for (const side of [-1, 1]) {
        const arm = new Path2D(); const P = [];
        for (let j = 0; j <= 8; j++) {
          const u = j / 8; const qq = along(f, d + u * armLen);
          const sl = lat + side * (0.05 + u * armLen * spread) + Math.sin(u * 6 + t * 2.4 + side) * 0.025 * u;
          const x = qq.x - qq.dy * sl; const y = qq.y + qq.dx * sl;
          P.push([x, y]);
          if (j) arm.lineTo(x, y); else arm.moveTo(x, y);
        }
        g.strokeStyle = foam;
        for (const [lw, al] of [[0.16, 0.18], [0.07, 0.45], [0.03, 0.8]]) { g.globalAlpha = Math.min(1, A * al); g.lineWidth = Math.max(minW, lw * size); g.stroke(arm); }
        // foam riding down the arm while the V stays
        for (let j = 0; j < 6; j++) {
          const u = fract(t * 1.1 + j / 6 + h(sd + side * 3 + j));
          const P0 = P[Math.min(7, Math.floor(u * 8))]; const P1 = P[Math.min(8, Math.floor(u * 8) + 1)]; const w = u * 8 - Math.floor(u * 8);
          dot(g, sprite(foam, 0.4), P0[0] + (P1[0] - P0[0]) * w, P0[1] + (P1[1] - P0[1]) * w, 0.05 * size * (1 - u * 0.5), A * 0.8 * (1 - u));
        }
      }
      // spray puffs off the rock, drifting downstream
      for (let j = 0; j < 4; j++) {
        const u = fract(t * 0.7 + j / 4 + h(sd + j * 7));
        const qq = along(f, d + u * 0.9);
        const sl = lat + (h(sd + j * 11 + Math.floor(t * 0.7 + j / 4 + h(sd + j * 7))) - 0.5) * 0.3;
        dot(g, sprite('#ffffff'), qq.x - qq.dy * sl, qq.y + qq.dx * sl, 0.12 + 0.25 * u, 0.3 * A * Math.sin(Math.PI * u));
      }
    }
    // foam is never clean lines: a noise racing downstream eats holes into all of it
    const nz = scratch(10, W, H, B); const ng = nz.g;
    ng.fillStyle = patternAt(ng, noiseTile(), m, 0.7, fdx * v * t * 0.7, fdy * v * t * 0.7, ang, 1.8);
    ng.fillRect(B.x, B.y, B.w, B.h);
    ng.fillStyle = 'rgba(255,255,255,0.38)';
    ng.fillRect(B.x, B.y, B.w, B.h);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.drawImage(nz.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
    stamp(ctx, sc, regionMask(ctx, fx, 0.35));
  }

  // =====================================================================
  // Placed effects (map units; r: the effect's size)
  // =====================================================================
  // where a piece of the whirlpool's water is: u = 0 at the rim, 1 in the eye; it turns faster the further in it is
  function spiralAt(r, u, theta0, spin, rot) {
    const rho = r * (0.97 - 0.86 * Math.pow(u, 0.8));
    const th = theta0 + spin * (rot + 1.7 * Math.log(r / (rho + r * 0.07)));
    return [rho, th];
  }
  // The whirlpool's foam as a picture, made once: patchy foam laid along a log spiral. Turned as a whole, a log spiral
  // seems to run inward (as a barber's pole seems to climb), so the foam flows into the eye without winding up.
  // Turned at different speeds in three soft rings, the middle overtakes the rim.
  const foamPics = new Map();
  function vnoise(seed) { // periodic value noise: n(u, v), period 1 in u (round the whirlpool)
    const G = 64; const g = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) g[i] = h(seed + i * 0.6180339);
    const at = (i, j) => g[(((j % G) + G) % G) * G + (((i % G) + G) % G)];
    return (u, v, fu, fv) => {
      const x = u * fu; const y = v * fv; const i = Math.floor(x); const j = Math.floor(y); const a = x - i; const b = y - j;
      const sa = a * a * (3 - 2 * a); const sb = b * b * (3 - 2 * b);
      const wrap = (k) => ((k % fu) + fu) % fu; // so u = 0 and u = 1 meet
      const p = at(wrap(i), j); const q = at(wrap(i + 1), j); const r2 = at(wrap(i), j + 1); const w = at(wrap(i + 1), j + 1);
      return p + (q - p) * sa + (r2 - p) * sb + (p - q - r2 + w) * sa * sb;
    };
  }
  function foamPic(mael, spin, col) {
    const key = `${mael}|${spin}|${col}`; let c = foamPics.get(key); if (c) return c;
    const N = 320; c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    const img = g.createImageData(N, N); const d = img.data;
    const n1 = vnoise(17.3); const n2 = vnoise(41.9); const n3 = vnoise(73.1);
    const twist = mael ? 0.42 : 0.3; const arms = mael ? 5 : 4;
    const [cr, cg, cb] = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const dx = (px + 0.5) / N * 2 - 1; const dy = (py + 0.5) / N * 2 - 1; const rho = Math.hypot(dx, dy);
      if (rho > 1) continue;
      const th = Math.atan2(dy, dx) / TAU; // -0.5..0.5
      const u = fract(th + spin * twist * Math.log(rho + 0.04));
      // broad patches gathered into arms, long thin streaks along the spiral, and a fine breakup
      const arm = 0.5 + 0.5 * Math.cos(TAU * (u * arms + 0.35 * n3(u, rho, 3, 2)));
      const patch = n1(u, rho, 7, 5) * 0.65 + n1(u, rho, 15, 11) * 0.35;
      const streak = n2(u, rho, 64, 3.5) * 0.7 + n2(u, rho, 128, 7) * 0.3;
      let f = sm(0.58, 0.85, patch * (0.5 + 0.65 * arm)) * 0.6 + sm(0.6, 0.78, streak) * (0.3 + 0.55 * arm);
      f *= sm(0.07, 0.24, rho) * (1 - sm(0.82, 1, rho)); // no foam in the eye, thinning at the rim
      f *= 0.8 + 0.4 * n3(u, rho, 30, 20);
      const k = (py * N + px) * 4; d[k] = cr; d[k + 1] = cg; d[k + 2] = cb; d[k + 3] = Math.round(255 * clamp(f, 0, 1));
    }
    g.putImageData(img, 0, 0);
    foamPics.set(key, c); if (foamPics.size > 12) foamPics.delete(foamPics.keys().next().value);
    return c;
  }
  let work = null; // (the whirlpool's work canvas, made on first use)
  function whirl(ctx, fx, x, y, t, r, I, C) {
    const { dot, sprite, mix, rgba } = F();
    const s = F().seedOf(fx.id || 'w');
    const mael = fx.variant === 'maelstrom';
    const spin = fx.spin === -1 ? -1 : 1; // 1: clockwise on the table
    const A = Math.min(1.3, I);
    const foam = C ? mix(C, '#ffffff', 0.85) : '#eef8fb';
    const deep = C ? mix(C, '#000000', 0.75) : mael ? '#020609' : '#05202a';
    const rot = t * (mael ? 0.55 : 0.32);
    const life = mael ? 6 : 9; // seconds from the rim to the eye (debris)
    ctx.globalCompositeOperation = 'source-over';
    const m = ctx.getTransform(); const Rd = r * Math.hypot(m.a, m.b); // the whirlpool's radius in pixels
    const cx = m.a * x + m.c * y + m.e; const cy = m.b * x + m.d * y + m.f;
    const S = Math.max(8, Math.ceil(Rd * 2 + 4));
    const w0 = work || (work = document.createElement('canvas'));
    if (w0.width < S || w0.height < S) { w0.width = Math.max(w0.width, S); w0.height = Math.max(w0.height, S); }
    const g0 = w0.getContext('2d');
    const o = S / 2; // the middle of the work canvases
    const blit = (alpha) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(w0, 0, 0, S, S, cx - o, cy - o, S, S); ctx.restore(); };
    const ring = (g, r0, r1, r2, r3) => { // keep only a soft ring: in from r0 to r1, out from r2 to r3 (fractions of the radius)
      const gr = g.createRadialGradient(o, o, 0, o, o, Rd);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(Math.max(0.001, r0), 'rgba(0,0,0,0)'); gr.addColorStop(r1, 'rgba(0,0,0,1)');
      gr.addColorStop(r2, 'rgba(0,0,0,1)'); gr.addColorStop(Math.min(1, r3), 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
    };
    // 1. the water sinks toward the middle: deeper and darker, a dark eye
    let gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(deep, (mael ? 0.96 : 0.78) * Math.min(1, A)));
    gr.addColorStop(mael ? 0.14 : 0.09, rgba(deep, (mael ? 0.85 : 0.55) * Math.min(1, A)));
    gr.addColorStop(0.35, rgba(deep, (mael ? 0.38 : 0.2) * Math.min(1, A)));
    gr.addColorStop(0.75, rgba(deep, (mael ? 0.12 : 0.05) * Math.min(1, A)));
    gr.addColorStop(1, rgba(deep, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    // 2. the funnel's walls catch the light: the far (bottom-right) wall lit, the near (top-left) one in shadow
    g0.setTransform(1, 0, 0, 1, 0, 0); g0.clearRect(0, 0, S, S);
    gr = g0.createLinearGradient(o - Rd * 0.5, o - Rd * 0.5, o + Rd * 0.5, o + Rd * 0.5);
    gr.addColorStop(0, 'rgba(0,10,16,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(235,250,255,0.4)');
    g0.fillStyle = gr; g0.fillRect(0, 0, S, S);
    ring(g0, 0.06, 0.16, 0.42, 0.78);
    blit(A * (mael ? 0.85 : 0.6));
    // 3. foam: one spiral picture in three soft rings, the inner ones turning faster
    const pic = foamPic(mael, spin, foam);
    const bands = mael ? [[0, 0.1, 0.3, 0.45, 2.4], [0.28, 0.42, 0.6, 0.75, 1.55], [0.55, 0.7, 1, 1, 1]] : [[0, 0.1, 0.3, 0.45, 2.2], [0.28, 0.42, 0.6, 0.75, 1.45], [0.55, 0.7, 1, 1, 1]];
    const w = (mael ? 0.62 : 0.4); // radians a second at the rim
    bands.forEach(([a0, a1, a2, a3, k], i) => {
      g0.setTransform(1, 0, 0, 1, 0, 0); g0.clearRect(0, 0, S, S);
      g0.translate(o, o); g0.rotate(spin * w * k * t + h(s + i) * TAU); g0.drawImage(pic, -Rd, -Rd, Rd * 2, Rd * 2); // (each ring starts turned its own way)
      g0.setTransform(1, 0, 0, 1, 0, 0);
      ring(g0, a0, a1, a2, a3);
      blit(A * (mael ? 0.9 : 0.72));
    });
    // loose flecks of foam circling in
    const nf = F().count(mael ? 40 : 28, fx);
    for (let i = 0; i < nf; i++) {
      const u = fract(t / (life * 1.2) + h(s + i * 3.3));
      const [rho, th] = spiralAt(r, u, h(s + i * 5.1) * TAU, spin, rot);
      dot(ctx, sprite(foam, 0.5), x + Math.cos(th) * rho, y + Math.sin(th) * rho, r * 0.018 * (1.2 - u * 0.6), A * 0.8 * Math.min(1, u / 0.1) * (1 - sm(0.8, 1, u)));
    }
    // debris: leaves and twigs (Whirlpool) or planks (Maelstrom), always going in, gone in the eye
    const nd = mael ? 6 : 7;
    for (let i = 0; i < nd; i++) {
      const L = life * (1.6 + 0.8 * h(s + i * 9.7));
      const ph = t / L + h(s + i * 4.4); const u = fract(ph); const n = Math.floor(ph);
      const [rho, th] = spiralAt(r, u * 0.92, h(s + i * 6.6 + n * 1.7) * TAU, spin, rot);
      const px = x + Math.cos(th) * rho; const py = y + Math.sin(th) * rho;
      const fade = Math.min(1, u / 0.08) * (1 - sm(0.7, 0.95, u));
      if (fade <= 0.01) continue;
      const turn = th + spin * Math.PI / 2 + Math.sin(t * 1.3 + i) * 0.3 + h(s + i) * 2;
      ctx.save(); ctx.translate(px, py); ctx.rotate(turn); ctx.globalAlpha = Math.min(1, fade * Math.min(1, A));
      const sc = 1 - u * 0.35; // sinking: a little smaller
      if (mael) {
        const lw = r * 0.2 * (0.7 + 0.6 * h(s + i * 2)) * sc; const ww = r * 0.05 * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-lw / 2 + ww * 0.3, -ww / 2 + ww * 0.35, lw, ww);
        ctx.fillStyle = ['#6b4a2b', '#7a5532', '#5a3d22'][i % 3]; ctx.fillRect(-lw / 2, -ww / 2, lw, ww);
        ctx.fillStyle = 'rgba(255,230,190,0.25)'; ctx.fillRect(-lw / 2, -ww / 2, lw, ww * 0.3);
      } else {
        const lw = r * 0.07 * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(lw * 0.12, lw * 0.15, lw, lw * 0.45, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = ['#7a8a3a', '#a07a32', '#5d7030', '#8a5a2a'][i % 4]; ctx.beginPath(); ctx.ellipse(0, 0, lw, lw * 0.45, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(30,20,10,0.5)'; ctx.lineWidth = lw * 0.08; ctx.beginPath(); ctx.moveTo(-lw, 0); ctx.lineTo(lw, 0); ctx.stroke();
      }
      ctx.restore();
    }
    // the Maelstrom's rim: churning white water and spray
    if (mael) {
      const ns = F().count(46, fx);
      for (let i = 0; i < ns; i++) {
        const a = (i / ns) * TAU + spin * rot * 0.6 + h(s + i) * 0.2;
        const k = Math.floor(t * 3 + h(s + i * 3) * 5);
        const rr = r * (0.9 + 0.2 * h(s + i * 7 + k));
        dot(ctx, sprite('#ffffff', 0.3), x + Math.cos(a) * rr, y + Math.sin(a) * rr, r * (0.03 + 0.05 * h(s + i * 5 + k)), A * 0.55 * (0.5 + 0.5 * Math.sin(t * 5 + i * 2.1)));
      }
      for (let i = 0; i < 10; i++) {
        const ph = fract(t * 0.35 + i / 10); const a = h(s + i * 13) * TAU + spin * rot * 0.6;
        dot(ctx, sprite('#ffffff'), x + Math.cos(a) * r * (0.95 + ph * 0.25), y + Math.sin(a) * r * (0.95 + ph * 0.25), r * (0.08 + ph * 0.15), 0.14 * A * Math.sin(Math.PI * ph));
      }
    }
    ctx.globalAlpha = 1;
  }

  // Swirl the water: the map picture under a whirlpool turns, faster toward the middle. Drawn on the sharp Sway layer.
  // Two copies, each turning for a while from rest, fade into each other (as flow maps do), so the water keeps
  // turning one way and never winds up into a smear.
  const swirlSrc = new Map();
  function swirl(ctx, fx, x, y, t, bg) {
    const el = bg && bg.el;
    if (!el || fx.swirl === false) return;
    const video = el.tagName === 'VIDEO';
    if (video ? el.readyState < 2 : !(el.complete && el.naturalWidth)) return;
    const { scratch } = F();
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const R = (fx.r || 1) * m.a; // device pixels
    const cx = m.a * x + m.e; const cy = m.d * y + m.f;
    const P = { x: Math.max(0, Math.floor(cx - R - 2)), y: Math.max(0, Math.floor(cy - R - 2)) };
    P.w = Math.min(W, Math.ceil(cx + R + 2)) - P.x; P.h = Math.min(H, Math.ceil(cy + R + 2)) - P.y;
    if (P.w <= 4 || P.h <= 4) return;
    const key = `${bg.key}|${m.a.toFixed(5)},${m.e.toFixed(2)},${m.f.toFixed(2)}|${P.x},${P.y},${P.w},${P.h}|${bg.x},${bg.y},${bg.w},${bg.h},${bg.turn || 0}`;
    let e = swirlSrc.get(fx.id);
    if (!e) { e = { key: '', c: document.createElement('canvas') }; swirlSrc.set(fx.id, e); if (swirlSrc.size > 20) swirlSrc.delete(swirlSrc.keys().next().value); }
    const src = e.c;
    if (video || e.key !== key) {
      if (src.width !== P.w || src.height !== P.h) { src.width = P.w; src.height = P.h; }
      const g = src.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, P.w, P.h);
      g.setTransform(m.a, m.b, m.c, m.d, m.e - P.x, m.f - P.y);
      if (bg.turn) { const bx = bg.x + bg.w / 2; const by = bg.y + bg.h / 2; g.translate(bx, by); g.rotate((bg.turn * Math.PI) / 180); g.translate(-bx, -by); }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      try { g.drawImage(el, bg.x, bg.y, bg.w, bg.h); } catch { return; }
      e.key = video ? '' : key;
    }
    const spin = fx.spin === -1 ? -1 : 1;
    const mael = fx.variant === 'maelstrom';
    const T = t * (fx.speed ?? 1);
    const per = mael ? 6 : 9; // seconds one copy turns before it has faded out
    const turnMax = (mael ? 0.5 : 0.32) * Math.min(1.5, fx.intensity ?? 1); // small, so the two copies never show double // radians at the middle over one copy's life
    const N = Math.max(8, Math.round(Math.min(18, R / 14)));
    const sc = scratch(12, W, H, P); const g = sc.g;
    const lcx = cx; const lcy = cy;
    for (const [off, top] of [[0.5, false], [0, true]]) {
      const ph = fract(T / per + off + h(F().seedOf(fx.id || 's')));
      const w = 1 - Math.abs(2 * ph - 1); // 0 at either end of its life, 1 halfway
      g.globalAlpha = top ? w : 1;
      for (let i = N - 1; i >= 0; i--) {
        const r0 = (i / N) * R; const r1 = ((i + 1) / N) * R + 1;
        const q = (i + 0.5) / N; // 0 in the middle, 1 at the rim
        const ang = spin * turnMax * (ph - 0.5) * 2 * Math.pow(1 - q, 1.6) / (q + 0.25) * 0.25;
        g.save();
        g.beginPath(); g.arc(lcx, lcy, r1, 0, TAU); if (r0 > 0) g.arc(lcx, lcy, r0, 0, TAU, true); g.clip('evenodd');
        g.translate(lcx, lcy); g.rotate(ang); g.translate(-lcx, -lcy);
        // only the square round this ring (turned, it still covers the ring), not the whole picture
        const e2 = r1 * 1.42 + 2; const sx = Math.max(0, Math.floor(lcx - e2 - P.x)); const sy = Math.max(0, Math.floor(lcy - e2 - P.y));
        const sw = Math.min(P.w, Math.ceil(lcx + e2 - P.x)) - sx; const sh = Math.min(P.h, Math.ceil(lcy + e2 - P.y)) - sy;
        if (sw > 0 && sh > 0) g.drawImage(src, sx, sy, sw, sh, P.x + sx, P.y + sy, sw, sh);
        g.restore();
      }
    }
    // a soft round edge, so the turning water melts into the still water round it
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    const gr = g.createRadialGradient(lcx, lcy, R * 0.7, lcx, lcy, R);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(P.x, P.y, P.w, P.h);
    g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(sc.c, P.x, P.y, P.w, P.h, P.x, P.y, P.w, P.h);
    ctx.restore();
  }

  // Geyser: a pool that bubbles, builds up, erupts (seen from above: a white burst, spray flung out and falling back,
  // mist), splashes back and steams. Every erupts on its own clock, the same on both screens.
  const GEYSER_PER = 60; // seconds between eruptions at speed 1 (Speed: how often)
  function geyserState(fx, t) {
    const s = F().seedOf(fx.id || 'g');
    return cycle(t, GEYSER_PER, s, 0.5);
  }
  function geyser(ctx, fx, x, y, t, r, I, C) {
    const { dot, sprite, mix, rgba } = F();
    const s = F().seedOf(fx.id || 'g');
    const A = Math.min(1.3, I);
    const water = C || '#6cc0d2';
    const deep = mix(water, '#000000', 0.72); const sinter = '#e9dcc0';
    const { since, until } = geyserState(fx, t);
    const ERUPT = 4.5; const BUILD = 8;
    const build = until < BUILD ? 1 - until / BUILD : 0; // 0..1 as it builds up
    const erupt = since < ERUPT ? since / ERUPT : -1;
    const [wx, wy, ws] = windVec(s);
    ctx.globalCompositeOperation = 'source-over';
    // the vent: pale mineral crust round a deep blue pool, wet and darker for a while after an eruption
    const wet = since < 25 ? 1 - since / 25 : 0;
    for (let i = 0; i < 14; i++) { // a ragged crust, never a clean ring
      const a = (i / 14) * TAU + h(s + i * 2.7) * 0.5; const d = r * (0.42 + 0.22 * h(s + i * 3.9));
      dot(ctx, sprite(sinter), x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.14 + 0.16 * h(s + i * 5.3)), 0.2 * A);
    }
    let gr;
    if (wet > 0) { dot(ctx, sprite(deep), x, y, r * (1.1 + 0.6 * (1 - wet)), 0.35 * wet * A); }
    gr = ctx.createRadialGradient(x - r * 0.08, y - r * 0.08, 0, x, y, r * 0.45);
    gr.addColorStop(0, rgba(deep, 0.9 * Math.min(1, A))); gr.addColorStop(0.55, rgba(mix(water, '#000000', 0.5), 0.6 * Math.min(1, A))); gr.addColorStop(1, rgba(mix(water, '#000000', 0.3), 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
    // bubbles in the pool: a few when calm, quick and many as it builds up
    const bub = clearPic('#ffffff');
    const nb = Math.round(3 + 14 * build);
    for (let i = 0; i < nb; i++) {
      const rate = 0.5 + 2.5 * build;
      const ph = t * rate * (0.8 + 0.4 * h(s + i)) + h(s + i * 3); const u = fract(ph); const n = Math.floor(ph);
      const a = h(s + i * 7 + n * 1.3) * TAU; const d = Math.sqrt(h(s + i * 11 + n * 0.7)) * r * 0.3;
      const bx = x + Math.cos(a) * d; const by = y + Math.sin(a) * d; const br = r * (0.025 + 0.03 * h(s + i + n));
      if (u < 0.85) put(ctx, bub, bx, by, br * (0.5 + u), 0.7 * A);
      else ring(ctx, bx, by, br * (1.5 + (u - 0.85) * 20), 0.5 * A * (1 - (u - 0.85) / 0.15), '#ffffff', br * 0.3);
    }
    // the build-up: the water domes (a bright swelling) and rings run out
    if (build > 0) {
      ctx.globalCompositeOperation = 'lighter';
      dot(ctx, sprite(mix(water, '#ffffff', 0.6)), x, y, r * (0.2 + 0.2 * build), 0.35 * build * build * A * (0.8 + 0.2 * Math.sin(t * 9)));
      ctx.globalCompositeOperation = 'source-over';
      for (let k = 0; k < 3; k++) {
        const ph = fract(t * (0.6 + build) + k / 3);
        ring(ctx, x, y, r * (0.25 + 0.6 * ph), 0.55 * build * (1 - ph) * A, '#ffffff', r * 0.015);
      }
    }
    // the eruption
    if (erupt >= 0) {
      const q = erupt; const surge = Math.sin(Math.PI * Math.min(1, q * 1.15)) * (0.85 + 0.15 * Math.sin(since * 23));
      // the column seen from above: a churning boss of white water, mist round it, the pool heaving
      dot(ctx, sprite(mix(water, '#ffffff', 0.55)), x, y, r * (0.9 + 0.9 * surge), 0.4 * surge * A);
      const fk = Math.floor(since * 12);
      for (let i = 0; i < 26; i++) { // froth: blobs boiling in the column, a new pattern 12 times a second
        const a = h(s + i * 3.1 + fk * 0.37) * TAU; const d = Math.sqrt(h(s + i * 4.7 + fk * 0.71)) * r * 0.42 * (0.5 + surge);
        dot(ctx, sprite(i % 3 ? '#ffffff' : mix(water, '#ffffff', 0.75), 0.45), x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.07 + 0.1 * h(s + i + fk)), 0.85 * surge * A);
      }
      dot(ctx, sprite('#ffffff', 0.55), x, y, r * (0.22 + 0.18 * surge), 0.95 * surge * A);
      for (let k = 0; k < 3; k++) { // the pool heaving out in rings
        const ph = fract(since * 1.3 + k / 3);
        ring(ctx, x, y, r * (0.5 + 0.9 * ph), 0.5 * (1 - ph) * surge * A, '#ffffff', r * 0.035 * (1 - ph * 0.5));
      }
    }
    // spray: droplets launched during the eruption fly out on arcs and fall back (bigger while they are high up)
    if (since < ERUPT + 2.6) {
      const nd = F().count(80, fx);
      for (let i = 0; i < nd; i++) {
        const t0 = (i / nd) * ERUPT * 0.9; const age = since - t0;
        const vz = 3.2 + 1.6 * h(s + i * 1.7); const air = (2 * vz) / 6.5; // seconds in the air
        if (age < 0 || age > air) continue;
        const a = h(s + i * 2.3) * TAU; const vh = r * (0.5 + 1.0 * h(s + i * 5.9));
        const z = vz * age - 3.25 * age * age; // height
        const d = vh * age;
        const px = x + Math.cos(a) * d + wx * ws * age * r * 0.2; const py = y + Math.sin(a) * d + wy * ws * age * r * 0.2;
        const k = age / air;
        dot(ctx, sprite('#ffffff', 0.5), px, py, r * (0.025 + 0.022 * z), A * 0.9 * (1 - k * 0.4));
        if (k > 0.92) ring(ctx, px, py, r * 0.06 * (1 + (k - 0.92) * 20), 0.5 * A, '#ffffff', r * 0.01); // it lands
      }
    }
    // falling back: splash rings all round where the water comes down
    if (since > 1.5 && since < ERUPT + 4) {
      const q = clamp((since - 1.5) / (ERUPT + 2.5), 0, 1);
      for (let i = 0; i < 14; i++) {
        const ph = fract(since * 1.4 + h(s + i * 9)); const n = Math.floor(since * 1.4 + h(s + i * 9));
        const a = h(s + i * 13 + n * 3.7) * TAU; const d = r * (0.6 + 0.9 * h(s + i * 17 + n));
        ring(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.04 * (1 + ph * 3), 0.6 * (1 - ph) * A * Math.sin(Math.PI * q), '#ffffff', r * 0.012);
      }
    }
    // mist and steam: a cloud spreads during the eruption, then drifts off with the wind and thins out
    if (since < 30) {
      for (let i = 0; i < 16; i++) {
        const born = (i / 16) * ERUPT; const age = since - born;
        if (age < 0) continue;
        const L = 14 + 10 * h(s + i * 3.3); const k = age / L;
        if (k > 1) continue;
        const a = h(s + i * 7.7) * TAU; const out = r * (0.3 + 1.2 * Math.sqrt(Math.min(1, age / 3)));
        const drift = age * (0.25 + 0.35 * ws) * r * 0.5;
        dot(ctx, sprite('#f4f7f8'), x + Math.cos(a) * out + wx * drift, y + Math.sin(a) * out + wy * drift, r * (0.6 + 1.6 * Math.sqrt(k)), 0.26 * A * (1 - k) * Math.min(1, age * 2));
      }
    }
    // between eruptions: a thin wisp of steam, so the table can see something lives there
    for (let j = 0; j < 3; j++) {
      const ph = fract(t * 0.12 + j / 3 + h(s));
      dot(ctx, sprite('#eef3f5'), x + wx * ph * r * 1.2, y + wy * ph * r * 1.2, r * (0.25 + 0.5 * ph), 0.1 * A * Math.sin(Math.PI * ph));
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================
  // Second Builder (second-birds): painted creatures. One top-down picture per creature (Higgsfield, gpt_image_2_6, head
  // to the right, wings spread), animated here: wings beat by folding the wing parts in toward the body; a bird that
  // banks shortens its inner wing. Sizes in grid squares (`cell`: map units in one square; table drawings pass their own).
  // =====================================================================
  // size: wingspan in squares (the picture's height); body: half the body's band (of the height); lo: how far the wings
  // fold in a beat (1 = not at all); hz: beats a second; glide: share of the time gliding; burst: seconds per burst
  const SPR = {
    sparrow: { size: 0.35, body: 0.1, lo: 0.25, hz: 8, glide: 0.4, burst: 1.4 },
    crow: { size: 0.8, body: 0.09, lo: 0.35, hz: 3.2, glide: 0.5, burst: 3 },
    gull: { size: 1.1, body: 0.08, lo: 0.5, hz: 2.2, glide: 0.8, burst: 4.5 },
    dove: { size: 0.6, body: 0.1, lo: 0.3, hz: 6, glide: 0.15, burst: 2 },
    goose: { size: 1.4, body: 0.09, lo: 0.45, hz: 3, glide: 0, burst: 1 },
    vulture: { size: 1.6, body: 0.12, lo: 0.88, hz: 0.6, glide: 0.85, burst: 7 },
    eagle: { size: 1.5, body: 0.1, lo: 0.86, hz: 0.7, glide: 0.8, burst: 6 },
    bat: { size: 0.34, body: 0.12, lo: 0.2, hz: 9, glide: 0, burst: 1, rim: '#b4c2ea', dim: 0.6 }, // (Beta 3.63, Glinn: darker, so they stand out on stone and earth by day) // (second-bats-insects: rim, a pale edge that shows it in the dark)
    // Second Builder (second-bats-insects): insects, drawn larger than life so they read from a chair (14–30 px on the TV)
    butterfly: { size: 0.15, body: 0.05, lo: 0.1, hz: 4, glide: 0, burst: 1 },
    bee: { size: 0.15, body: 0.17, lo: 0.75, hz: 0, glide: 0, burst: 1 }, // (Beta 3.63, Glinn: bees, moths and flies half again as big)
    dragonfly: { size: 0.22, body: 0.05, lo: 0.82, hz: 0, glide: 0, burst: 1 },
    moth: { size: 0.2, body: 0.1, lo: 0.3, hz: 8, glide: 0, burst: 1 },
    fly: { size: 0.105, body: 0.15, lo: 0.75, hz: 0, glide: 0, burst: 1 },
  };
  const imgs = {};
  // the picture, once it has loaded (null until then: nothing is drawn, the next frame draws it)
  function img(n) {
    let e = imgs[n];
    if (!e) {
      e = imgs[n] = new Image();
      e.onload = () => { // where the body runs (the picture's weighted middle row): the wings fold toward it
        try {
          const c = document.createElement('canvas'); c.width = 64; c.height = Math.max(8, Math.round((64 * e.naturalHeight) / e.naturalWidth));
          const g = c.getContext('2d'); g.drawImage(e, 0, 0, c.width, c.height);
          const d = g.getImageData(0, 0, c.width, c.height).data; let sw = 0; let sy = 0;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const a = d[(y * c.width + x) * 4 + 3]; sw += a; sy += a * (y + 0.5); }
          e.cy = sw ? sy / sw / c.height : 0.5;
        } catch { e.cy = 0.5; }
      };
      e.src = new URL(`creatures/${n}.webp`, document.baseURI).href;
    }
    return e.complete && e.naturalWidth ? e : null;
  }
  // a promise that the pictures have loaded (the tile pictures wait for it)
  function ready(names = [...Object.keys(SPR), ...Object.keys(GROUND)]) { // (second-ground-life: and the fish and critters)
    return Promise.all(names.map((n) => new Promise((res) => { img(n); const e = imgs[n]; if (e.complete) res(); else { e.addEventListener('load', res, { once: true }); e.addEventListener('error', res, { once: true }); } })));
  }
  // the same picture in black, blurred once: its shadow on the ground
  const shades = new Map();
  function shadowOf(n) {
    let c = shades.get(n); if (c) return c;
    const im = img(n); if (!im) return null;
    const w = im.naturalWidth; const hh = im.naturalHeight;
    c = document.createElement('canvas'); c.width = w; c.height = hh; c.cy = im.cy;
    const g = c.getContext('2d'); const b = Math.max(w, hh) * 0.03;
    g.filter = `blur(${b.toFixed(1)}px)`; g.drawImage(im, b, b, w - 2 * b, hh - 2 * b); g.filter = 'none';
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, w, hh);
    shades.set(n, c); return c;
  }
  // Second Builder (second-bats-insects): smaller copies of a picture, each half the one before, made once. A 512 px
  // picture drawn at 15 px flickers as it moves; the copy just above the size it is drawn at does not.
  const mips = new Map();
  function mip(key, im, px) {
    let L = mips.get(key);
    if (!L || L[0] !== im) {
      L = [im];
      let src = im; let w = im.naturalWidth || im.width; let hh = im.naturalHeight || im.height;
      while (hh > 24) {
        w = Math.max(1, Math.round(w / 2)); hh = Math.max(1, Math.round(hh / 2));
        const c = document.createElement('canvas'); c.width = w; c.height = hh; c.cy = im.cy;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, hh);
        L.push(c); src = c;
      }
      mips.set(key, L);
    }
    let best = L[0];
    for (const c of L) { if ((c.naturalHeight || c.height) >= px * 1.3) best = c; else break; }
    return best;
  }
  // how many device pixels one unit is on this canvas just now
  const devK = (g) => { const m = g.getTransform(); return Math.hypot(m.a, m.b) || 1; };
  // how far the wings are open (lo … 1): beats in bursts, held open while gliding
  function wingOpen(K, t, seed) {
    const beat = 0.5 + 0.5 * Math.cos((t * K.hz + h(seed)) * TAU);
    let open = K.lo + (1 - K.lo) * beat;
    if (K.glide > 0) {
      const u = fract(t / K.burst + h(seed + 1.7)); // a burst of beats, then a glide
      const g = sm(1 - K.glide - 0.08, 1 - K.glide + 0.02, u) * (1 - sm(0.96, 1, u));
      open = open * (1 - g) + g;
    }
    return open;
  }
  // a flyer at the origin heading +x: the body as it is, each wing folded in by `open` (bank > 0: the right wing shorter)
  function flapBody(g, im, K, open, span, bank = 0) {
    const w = im.naturalWidth || im.width; const hh = im.naturalHeight || im.height;
    const sc = span / hh; const W = w * sc; const cy = (im.cy ?? 0.5) * hh; const b = K.body * hh;
    const up = open * (1 - Math.max(0, -bank) * 0.45); const dn = open * (1 - Math.max(0, bank) * 0.45);
    const top = cy - b; const bot = hh - (cy + b);
    g.drawImage(im, 0, top, w, 2 * b, -W / 2, -b * sc, W, 2 * b * sc);
    if (top > 0) g.drawImage(im, 0, 0, w, top, -W / 2, -b * sc - top * sc * up, W, top * sc * up);
    if (bot > 0) g.drawImage(im, 0, cy + b, w, bot, -W / 2, b * sc, W, bot * sc * dn);
  }
  // one flyer: o.sq units in a square, o.height (squares) for its shadow, o.alpha, o.bank, o.dark (the scene's darkness)
  function flyer(g, n, x, y, ang, open, o) {
    const K = SPR[n]; let im = img(n); if (!K || !im) return;
    const span = K.size * (o.size || 1) * o.sq;
    if (o.tint) im = tinted(n, im, o.tint); // (second-bats-insects: a butterfly in another colour)
    else if (K.dim) im = dimmed(n, im, K.dim); // (Beta 3.63: a bat is nearly black)
    im = mip(o.tint ? `${n}|${o.tint}` : K.dim ? `${n}|dim` : n, im, span * devK(g)); // (second-bats-insects)
    g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = o.alpha ?? 1;
    const rk = K.rim ? sm(0.2, 0.6, o.dark || 0) : 0; // (second-bats-insects: in the dark a bat has a pale edge, as if the moon caught it)
    if (rk > 0.02) { const rim = rimOf(n); if (rim) { g.globalAlpha = (o.alpha ?? 1) * rk * 0.85; g.scale(1.14, 1.14); flapBody(g, mip(`${n}|rim`, rim, span * 1.14 * devK(g)), K, open, span, o.bank || 0); g.scale(1 / 1.14, 1 / 1.14); g.globalAlpha = o.alpha ?? 1; flapBody(g, im, K, open, span, o.bank || 0); } } // (the body twice: its thin wings do not let the rim through)
    flapBody(g, im, K, open, span, o.bank || 0);
    g.restore();
  }
  // (Beta 3.63, main Builder) the picture darkened toward black, made once
  const dims = new Map();
  function dimmed(n, im, k) {
    let c = dims.get(n); if (c) return c;
    c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height; c.cy = im.cy;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(16,12,18,${k})`; g.fillRect(0, 0, c.width, c.height);
    dims.set(n, c); return c;
  }
  // its silhouette in its rim colour (second-bats-insects)
  const rims = new Map();
  function rimOf(n) {
    let c = rims.get(n); if (c) return c;
    const im = img(n); if (!im) return null;
    c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.cy = im.cy;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = SPR[n].rim; g.fillRect(0, 0, c.width, c.height);
    rims.set(n, c); return c;
  }
  function flyerShadow(g, n, x, y, ang, open, o) {
    const sh = (o.alpha ?? 1) * 0.36 * (1 - sm(0.3, 0.6, o.dark || 0)); // no shadows in the dark
    if (sh <= 0.01 || !o.height) return;
    const K = SPR[n]; let im = shadowOf(n); if (!K || !im) return;
    const span = K.size * (o.size || 1) * o.sq;
    im = mip(`${n}|shadow`, im, span * devK(g)); // (second-bats-insects)
    g.save(); g.translate(x + o.height * 0.22 * o.sq, y + o.height * 0.32 * o.sq); g.rotate(ang); g.globalAlpha = sh; // (the sun high in the top left)
    flapBody(g, im, K, open, span, o.bank || 0);
    g.restore();
  }

  // the scene each pass draws in: how dark it is, how many map units a square is (scene-view sets it every frame)
  let SCENE = { dark: 0, cell: 1 };
  function scene(s) { SCENE = { dark: 0, cell: 1, ...(s || {}) }; }

  // ---------- Birds: a weather layer (Scene → Weather → Add a layer), drawn on the fly layer ----------
  // Every so often a flock crosses the table and leaves. The flocks come by distance travelled (FXDATA.wxTravel's s,
  // anchored), so a change of Speed never makes them jump.
  const FLOCKS = {
    small: { pic: 'sparrow', n: [6, 14], v: 3.4, form: 'loose', spread: 1.3 },
    crows: { pic: 'crow', n: [3, 7], v: 2.3, form: 'loose', spread: 2.6 },
    gulls: { pic: 'gull', n: [2, 5], v: 2.4, form: 'loose', spread: 3.2, bank: true },
    doves: { pic: 'dove', n: [8, 16], v: 3.8, form: 'tight', spread: 0.9 },
    geese: { pic: 'goose', n: [5, 11], v: 2.7, form: 'v', spread: 1.1 },
    bats: { pic: 'bat', n: [4, 10], v: 3.6, form: 'erratic', spread: 1.8 },
  };
  const FLOCK_GAP = 22; // seconds between flocks at Amount 1 and Speed 1
  function sky(ctx, w, W, H, t, now, o) {
    if (!w || !Array.isArray(w.layers)) return 0;
    let drawn = 0;
    const fadeMs = (w.fade || 0) * 1000;
    for (const L of w.layers) {
      if (L.type !== 'birds') continue;
      const A = F().layerAlpha(L, now, fadeMs);
      if (A <= 0.003) continue;
      const K = FLOCKS[L.variant] || FLOCKS.small; const S = SPR[K.pic];
      const s = F().seedOf(L.id || 'birds');
      const size = clamp(L.size ?? 1, 0.2, 4); const amt = clamp(L.amount ?? 1, 0.05, 4);
      const tr = FXDATA.wxTravel(L, t); // s: how far the wind has carried things, at this layer's speed (anchored)
      const v = K.v * o.sq; // table units a second at Speed 1
      const M = S.size * size * o.sq * 3 + K.spread * size * o.sq * 2; // margin: a whole flock is off the table
      const D = Math.hypot(W, H) + 2 * M; // a crossing
      const lap = D + (v * FLOCK_GAP) / amt; // a crossing and the gap after it
      const dist = tr.s * v + h(s) * lap;
      const n = Math.floor(dist / lap); const p = dist - n * lap;
      const birds = []; // this flock and, while it is still leaving, the one before
      for (const [k, pp] of [[n, p], [n - 1, p + lap]]) {
        if (pp > D + M) continue;
        const sd = s + k * 17.3;
        const base = ((L.dir ?? 200) + (h(sd) - 0.5) * 120) * (Math.PI / 180); // each flock ±60°
        const dx = Math.cos(base); const dy = Math.sin(base);
        const lat = (h(sd + 1) - 0.5) * 0.7 * (Math.abs(dx) * H + Math.abs(dy) * W);
        const x0 = W / 2 - dy * lat - dx * (D / 2); const y0 = H / 2 + dx * lat - dy * (D / 2);
        const fx = x0 + dx * pp; const fy = y0 + dy * pp;
        const cnt = F().count(Math.round(K.n[0] + (K.n[1] - K.n[0]) * h(sd + 2)), { density: 1 });
        const turn = K.form === 'tight' ? Math.sin(t * 0.7 + h(sd) * 6) * 0.35 : 0; // a dove flock turns as one
        for (let j = 0; j < Math.min(40, cnt); j++) {
          let al; let ac; // along and across the heading, in squares
          if (K.form === 'v') { const r = Math.ceil(j / 2); al = -r * K.spread * 0.9; ac = (j % 2 ? 1 : -1) * r * K.spread * 0.75; }
          else { const a = h(sd + j * 3.1) * TAU; const rr = Math.sqrt(h(sd + j * 5.7)) * K.spread * (K.form === 'tight' ? 1 : 1.6); al = Math.cos(a) * rr; ac = Math.sin(a) * rr; }
          // each bird wanders a little in its place
          const wob = K.form === 'erratic' ? 0.6 : 0.18;
          al += Math.sin(t * (1.3 + h(sd + j)) + j) * wob; ac += Math.cos(t * (1.1 + h(sd + j * 2)) + j * 2) * wob;
          const ca = Math.cos(turn); const sa = Math.sin(turn);
          const ax = al * ca - ac * sa; const ay = al * sa + ac * ca;
          const bx = fx + (dx * ax - dy * ay) * size * o.sq; const by = fy + (dy * ax + dx * ay) * size * o.sq;
          let ang = base + turn + (K.form === 'erratic' ? Math.sin(t * 3 + j * 1.7) * 0.5 : Math.sin(t * 0.8 + j) * 0.06);
          const bank = K.bank ? Math.sin(t * 0.4 + j * 1.3) * 0.5 : 0;
          if (K.bank) ang += bank * 0.15;
          birds.push({ x: bx, y: by, ang, open: wingOpen(S, t, sd + j * 1.37), bank });
        }
      }
      const op = { sq: o.sq, size, height: 3, dark: o.dark, alpha: A };
      for (const b of birds) flyerShadow(ctx, K.pic, b.x, b.y, b.ang, b.open, { ...op, bank: b.bank });
      for (const b of birds) flyer(ctx, K.pic, b.x, b.y, b.ang, b.open, { ...op, bank: b.bank });
      drawn += birds.length;
    }
    return drawn;
  }

  // ---------- Circling birds (a click): 1–6 birds circle a spot ----------
  const CIRCLERS = { vultures: { pic: 'vulture', n: 3, v: 0.9 }, eagle: { pic: 'eagle', n: 1, v: 1 }, gulls: { pic: 'gull', n: 4, v: 1.3 }, crows: { pic: 'crow', n: 4, v: 1.4 } };
  function circling(ctx, fx, x, y, t, r, I) {
    const K = CIRCLERS[fx.variant] || CIRCLERS.vultures; const S = SPR[K.pic];
    const s = F().seedOf(fx.id || 'c'); const cell = SCENE.cell;
    const n = Math.max(1, Math.min(6, Math.round(K.n * (fx.density ?? 1))));
    const dir = h(s + 0.3) < 0.5 ? 1 : -1; // which way round this spot's birds go
    const cx = x + Math.sin(t * 0.05 + s) * r * 0.15; const cy = y + Math.cos(t * 0.04 + s * 2) * r * 0.15; // the circle drifts
    const birds = [];
    for (let i = 0; i < n; i++) {
      const R = r * (0.65 + 0.45 * h(s + i * 3.1)) * (1 + 0.12 * Math.sin(t * 0.13 + i * 2));
      // (Beta 3.63, main Builder: all go round at one rate and keep their places, each drifting a little in its own;
      // at a rate of its own every bird flew through the others)
      const w = (K.v * cell) / (r * 0.87); // radians a second
      const gap = TAU / n;
      const a = dir * w * t + i * gap + ((h(s + i) - 0.5) * 0.3 + 0.1 * Math.sin(t * 0.07 + i * 1.9 + s)) * (n > 1 ? gap : 1);
      const bx = cx + Math.cos(a) * R; const by = cy + Math.sin(a) * R * (0.92 + 0.08 * Math.sin(t * 0.07 + i));
      birds.push({ x: bx, y: by, ang: a + dir * (Math.PI / 2), open: wingOpen(S, t, s + i * 1.7), bank: dir * 0.6 });
    }
    const op = { sq: cell, size: 1, height: 4, dark: SCENE.dark, alpha: Math.min(1, I) };
    for (const b of birds) flyerShadow(ctx, K.pic, b.x, b.y, b.ang, b.open, { ...op, bank: b.bank });
    for (const b of birds) flyer(ctx, K.pic, b.x, b.y, b.ang, b.open, { ...op, bank: b.bank });
  }

  // ---------- Birds take flight (a moment, moments.js): a flock bursts up from a spot and flies off ----------
  // P: the moment's drawing (table units): age (s), k (0..1 how strongly it shows), s (seed), cx, cy, W, H, sq
  function burst(ctx, P, kind = 'birds') {
    ctx.globalCompositeOperation = 'source-over'; // (second-bats-insects: pictures, whatever the moment before left set)
    const sq = P.sq || 1; const s = P.s;
    const bats = kind === 'bats'; const pic = bats ? 'bat' : 'sparrow'; const S = SPR[pic];
    const n = bats ? 30 + Math.floor(h(s) * 50) : 10 + Math.floor(h(s) * 14);
    // away from the middle of the table (or a seeded way when it is right there)
    const ax = P.cx - P.W / 2; const ay = P.cy - P.H / 2;
    const away = Math.hypot(ax, ay) > 1 ? Math.atan2(ay, ax) : h(s + 3) * TAU;
    const out = [];
    for (let i = 0; i < n; i++) {
      const delay = h(s + i * 1.9) * (bats ? 1.2 : 0.35);
      const age = P.age - delay; if (age <= 0) continue;
      const a = away + (h(s + i * 3.7) - 0.5) * (bats ? 1.6 : 2.1) + (bats ? Math.sin(age * 1.5 + i) * 0.4 * Math.min(1, age) : 0); // a fan (bats swirl as they go)
      const v = (bats ? 4.5 : 5.5) * (0.75 + 0.5 * h(s + i * 5.3)) * sq; // table units a second, once going
      const d = v * (age - 0.35 * (1 - Math.exp(-age / 0.35))) + sq * 0.4 * Math.min(1, age * 3) * h(s + i); // a slow start, then away
      const rise = bats ? 0.5 : Math.min(1, age / 0.5); // up off the ground first
      const height = 0.3 + 3 * rise + age * 0.6;
      const scale = bats ? 1 : 0.75 + 0.45 * Math.sin(Math.min(1, age / 1.6) * Math.PI * 0.75); // bigger as they rise, smaller as they climb away
      const x = P.cx + Math.cos(a) * d; const y = P.cy + Math.sin(a) * d;
      out.push({ x, y, ang: a + Math.sin(age * 6 + i) * 0.15, open: S.lo + (1 - S.lo) * (0.5 + 0.5 * Math.cos((age * (bats ? 11 : 12) + h(s + i)) * TAU)), height, scale });
    }
    const op = { sq, dark: SCENE.dark, alpha: P.k };
    for (const b of out) flyerShadow(ctx, pic, b.x, b.y, b.ang, b.open, { ...op, size: b.scale, height: b.height });
    for (const b of out) flyer(ctx, pic, b.x, b.y, b.ang, b.open, { ...op, size: b.scale });
  }

  // =====================================================================
  // Second Builder (second-bats-insects): Bats (a click; Flutter or Stream from here), Insects (a click; butterflies,
  // bees, dragonflies, moths, flies), Moths round the lights (Scene → Time of day → More) and the moment Bat swarm
  // (burst above). All on the fly layer, under the darkness: by a lit light they show, in the dark they do not.
  // =====================================================================
  // a picture in another colour: its coloured parts take the colour, its black veins and white spots stay (made once)
  const tints = new Map();
  function tinted(n, im, hex) {
    const key = `${n}|${hex}`; let c = tints.get(key); if (c) return c;
    const w = im.naturalWidth || im.width; const hh = im.naturalHeight || im.height;
    c = document.createElement('canvas'); c.width = w; c.height = hh; c.cy = im.cy;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    try {
      const v = parseInt(String(hex).replace('#', ''), 16);
      const tr = (v >> 16) & 255; const tg = (v >> 8) & 255; const tb = v & 255;
      const D = g.getImageData(0, 0, w, hh); const d = D.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const r = d[i]; const gg = d[i + 1]; const b = d[i + 2];
        const mx = Math.max(r, gg, b); const mn = Math.min(r, gg, b);
        const wgt = sm(0.15, 0.55, mx ? (mx - mn) / mx : 0); // how coloured this pixel is: veins and spots are not
        const k = Math.min(1.5, (0.3 * r + 0.59 * gg + 0.11 * b) / 150); // its own light and shade, in the new colour
        d[i] = r + (Math.min(255, tr * k) - r) * wgt;
        d[i + 1] = gg + (Math.min(255, tg * k) - gg) * wgt;
        d[i + 2] = b + (Math.min(255, tb * k) - b) * wgt;
      }
      g.putImageData(D, 0, 0);
    } catch { /* a picture we may not read: its own colours */ }
    tints.set(key, c); return c;
  }
  const BUTTERFLY_MIX = [null, '#f4d23a', '#f6f1df', '#9cc6ec', null, '#f4d23a']; // orange (its own), yellow, white, pale blue
  // a smooth wander inside a circle of radius 1: two slow sines a coordinate (the sum stays inside)
  function roam(tau, s, f = 1) {
    return {
      x: 0.58 * Math.sin(tau * 0.53 * f + s * 6.1) + 0.34 * Math.sin(tau * 0.87 * f + s * 2.3),
      y: 0.58 * Math.sin(tau * 0.47 * f + s * 4.7) + 0.34 * Math.sin(tau * 0.91 * f + s * 8.9),
    };
  }
  const dirOf = (a, b, fallback = 0) => (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 ? Math.atan2(b.y - a.y, b.x - a.x) : fallback);
  // a point in the circle (radius 1) for hop k of insect s
  const spot = (s, k) => { const a = h(s + k * 1.71) * TAU; const r = Math.sqrt(h(s + k * 2.93)) * 0.92; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; };
  // a wing blur: fast wings seen from above (a new value 30 times a second)
  const blur = (lo, t, s) => lo + (1 - lo) * h(Math.floor(t * 30) * 0.618 + s);
  const angLerp = (a, b, k) => a + (((((b - a) % TAU) + TAU * 1.5) % TAU) - Math.PI) * k;

  const SWARMS = {
    butterflies: { pic: 'butterfly', n: 4, height: 0.6 },
    bees: { pic: 'bee', n: 7, height: 0.35, hover: 1.4, hop: 0.45, zig: 0.12, jit: 0.035 },
    dragonflies: { pic: 'dragonfly', n: 2, height: 0.5, hover: 2.4, hop: 0.32, zig: 0, jit: 0.012 },
    moths: { pic: 'moth', n: 4, height: 0.6 },
    flies: { pic: 'fly', n: 10, height: 0.3 },
  };
  // one insect of a swarm, around (0, 0); R: how far it roams (map units), cell: map units in a square
  function bug(kind, i, s, t, R, cell) {
    const K = SWARMS[kind]; const S = SPR[K.pic]; const sd = s + i * 7.77;
    if (kind === 'butterflies') { // flutters about, lands now and then and rests, wings slowly opening and closing
      const fly = 6 + 5 * h(sd); const rest = 2.5 + 4 * h(sd + 1); const P = fly + rest;
      const u = t + h(sd + 2) * P * 3; const k = Math.floor(u / P); const ph = u - k * P;
      const tau = k * fly + Math.min(ph, fly); const resting = ph > fly;
      const f = 1.6 * (0.8 + 0.4 * h(sd + 3)) / Math.max(0.5, R / cell);
      const a = roam(tau, sd, f); const b = roam(tau - 0.06, sd, f);
      const bob = resting ? 0 : Math.sin(t * 7.3 + i) * 0.04 * cell;
      const ang = dirOf(b, a, h(sd) * TAU) + (resting ? 0 : Math.sin(t * 2.1 + i * 3) * 0.3);
      const open = resting ? 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(t * 0.9 * TAU + i)) : S.lo + (1 - S.lo) * (0.5 + 0.5 * Math.cos((t * (3.6 + h(sd + 4)) + Math.sin(t * 1.7 + i) * 0.4) * TAU));
      const up = sm(0, 0.5, ph) * (1 - sm(fly - 0.5, fly, ph));
      return { x: a.x * R - Math.sin(ang) * bob, y: a.y * R + Math.cos(ang) * bob, ang, open, height: 0.03 + (K.height - 0.03) * up, tint: BUTTERFLY_MIX[Math.floor(h(sd + 5) * BUTTERFLY_MIX.length)] };
    }
    if (kind === 'bees' || kind === 'dragonflies') { // hover at a spot, dart (bees zig-zag) to the next
      const P = (K.hover + K.hop) * (0.7 + 0.6 * h(sd)); const hop = K.hop * (0.8 + 0.4 * h(sd + 1)); const hover = P - hop;
      const u = t + h(sd + 2) * P * 7; const k = Math.floor(u / P); const ph = u - k * P;
      const p0 = spot(sd, k); const p1 = spot(sd, k + 1); const pm = spot(sd, k - 1);
      const go = dirOf(p0, p1); const came = dirOf(pm, p0);
      let x; let y; let ang;
      if (ph < hover) {
        x = p0.x * R + Math.sin(t * 5.3 + sd) * K.jit * cell + Math.sin(t * 0.7 + sd) * K.jit * 2 * cell;
        y = p0.y * R + Math.cos(t * 4.1 + sd * 2) * K.jit * cell + Math.cos(t * 0.6 + sd) * K.jit * 2 * cell;
        ang = angLerp(came, go, sm(0.55, 1, ph / hover)) + Math.sin(t * 3.1 + i) * 0.12;
      } else {
        const q = sm(0, 1, (ph - hover) / hop); const zz = Math.sin(q * Math.PI * 4) * Math.sin(q * Math.PI) * K.zig * cell;
        x = (p0.x + (p1.x - p0.x) * q) * R - Math.sin(go) * zz; y = (p0.y + (p1.y - p0.y) * q) * R + Math.cos(go) * zz;
        ang = go;
      }
      return { x, y, ang, open: blur(S.lo, t, sd), height: K.height };
    }
    if (kind === 'moths') return orbitMoth(i, sd, t, R * (0.3 + 0.4 * h(sd + 6)), cell);
    // flies: a tight buzzing cloud
    const r = R * 0.45; const f = 2.2 + h(sd) * 1.2;
    const at = (tt) => ({ x: (0.55 * Math.sin(tt * f + sd * 3) + 0.45 * Math.sin(tt * f * 2.31 + sd * 7)) * r, y: (0.55 * Math.sin(tt * f * 1.13 + sd * 5) + 0.45 * Math.sin(tt * f * 1.97 + sd * 11)) * r });
    const a = at(t); const b = at(t - 0.03);
    return { x: a.x, y: a.y, ang: dirOf(b, a), open: blur(S.lo, t, sd), height: K.height };
  }
  // a moth circling a point erratically
  function orbitMoth(i, sd, t, R, cell) {
    const dir = h(sd + 0.4) < 0.5 ? 1 : -1;
    const w = (2.2 + 1.6 * h(sd)) * (0.9 + 0.3 * Math.sin(t * 0.8 + i));
    const a = dir * (t * w + Math.sin(t * 1.9 + sd) * 0.8) + h(sd + 1) * TAU;
    const rr = R * (1 + 0.28 * Math.sin(t * 2.3 + i * 2) + 0.12 * Math.sin(t * 6.1 + sd));
    const jx = Math.sin(t * 9.1 + sd) * 0.05 * cell; const jy = Math.cos(t * 7.7 + sd * 2) * 0.05 * cell;
    const S = SPR.moth;
    return { x: Math.cos(a) * rr + jx, y: Math.sin(a) * rr + jy, ang: a + dir * (Math.PI / 2) + Math.sin(t * 5 + i) * 0.5, open: S.lo + (1 - S.lo) * (0.5 + 0.5 * Math.cos((t * S.hz + h(sd)) * TAU)), height: 0.5 };
  }
  function drawBugs(ctx, pic, list, op) {
    for (const b of list) flyerShadow(ctx, pic, b.x, b.y, b.ang, b.open, { ...op, height: b.height });
    for (const b of list) flyer(ctx, pic, b.x, b.y, b.ang, b.open, { ...op, tint: b.tint || op.tint || null });
  }
  // Insects (a click): Size the area they keep to, Amount how many (at most 14), a colour for butterflies
  function insects(ctx, fx, x, y, t, r, I) {
    const kind = SWARMS[fx.variant] ? fx.variant : 'butterflies'; const K = SWARMS[kind];
    const s = F().seedOf(fx.id || 'i'); const cell = SCENE.cell;
    const n = Math.max(1, Math.min(14, Math.round(K.n * (fx.density ?? 1))));
    const list = [];
    for (let i = 0; i < n; i++) { const b = bug(kind, i, s, t, r, cell); b.x += x; b.y += y; if (kind === 'butterflies' && fx.color) b.tint = fx.color; list.push(b); }
    drawBugs(ctx, K.pic, list, { sq: cell, dark: SCENE.dark, alpha: Math.min(1, I) });
  }

  // Bats (a click). Flutter: 3–8 bats flit round the spot. Stream from here: now and then a ribbon of bats pours out the
  // way the effect faces (about every 3 minutes at Speed 1, for 15 s), a few stragglers at the mouth between.
  const STREAM_PER = 180; const STREAM_LEN = 15;
  function flutterBat(i, sd, t, R, cell) {
    const f = (1.5 + 0.5 * h(sd)) / Math.max(0.6, R / cell);
    const at = (tt) => { const a = roam(tt * 2.4, sd, f); return { x: a.x * R, y: a.y * R }; };
    const a = at(t); const b = at(t - 0.04);
    const S = SPR.bat;
    return { x: a.x, y: a.y, ang: dirOf(b, a) + Math.sin(t * 6 + i) * 0.35, open: S.lo + (1 - S.lo) * (0.5 + 0.5 * Math.cos((t * (8.5 + 3 * h(sd + 1)) + h(sd)) * TAU)), height: 2.5 };
  }
  function streamState(fx, t) { return cycle(t, STREAM_PER, F().seedOf(fx.id || 'b') + 0.77, 0.5); }
  function bats(ctx, fx, x, y, t, r, I) {
    const s = F().seedOf(fx.id || 'b'); const cell = SCENE.cell; const S = SPR.bat;
    const stream = fx.variant === 'stream';
    const list = [];
    const nf = stream ? Math.max(1, Math.min(4, Math.round(2 * (fx.density ?? 1)))) : Math.max(1, Math.min(8, Math.round(5 * (fx.density ?? 1))));
    for (let i = 0; i < nf; i++) { const b = flutterBat(i, s + i * 5.3, t, stream ? r * 0.4 : r, cell); b.x += x; b.y += y; list.push(b); }
    if (stream) {
      const c = streamState(fx, t);
      const A = ((fx.angle ?? 0) * Math.PI) / 180; const dx = Math.cos(A); const dy = Math.sin(A);
      // bats a second out of the mouth: at most 40 in the air at once (each is seen for about 6 s)
      const rate = Math.max(1.5, Math.min(6, 5 * (fx.density ?? 1))); const total = Math.floor(rate * STREAM_LEN);
      const j0 = Math.max(0, Math.floor((c.since - 7) * rate)); const j1 = Math.min(total - 1, Math.floor(c.since * rate + 1));
      for (let j = j0; j <= j1; j++) {
        const sd = s + 100 + j * 3.3 + c.n * 0.37;
        const age = c.since - j / rate - (h(sd) - 0.5) * 0.3;
        if (age <= 0) continue;
        const v = 4 * (0.85 + 0.3 * h(sd + 1)) * cell; const d = v * age; const dq = d / cell;
        if (dq > 26) continue;
        // the ribbon twists slowly and widens as it goes
        const lat = (Math.sin(dq * 0.2 + c.since * 0.35 + s) * dq * 0.12 + (h(sd + 2) - 0.5) * (0.4 + dq * 0.09)) * cell;
        const dl = Math.cos(dq * 0.2 + c.since * 0.35 + s) * 0.2 * 0.12 * dq + Math.sin(dq * 0.2 + c.since * 0.35 + s) * 0.12;
        const k = Math.min(1, age / 0.35) * (1 - sm(14, 26, dq)); // out of the mouth, then thinning to nothing
        if (k <= 0.01) continue;
        list.push({ x: x + dx * d - dy * lat, y: y + dy * d + dx * lat, ang: A + Math.atan(dl) + Math.sin(t * 5 + j) * 0.25, open: S.lo + (1 - S.lo) * (0.5 + 0.5 * Math.cos((t * (9 + 3 * h(sd + 3)) + h(sd)) * TAU)), height: 1 + Math.min(3, dq * 0.4), size: 0.85 + 0.3 * h(sd + 4), k });
      }
    }
    const op = { sq: cell, dark: SCENE.dark };
    const A = Math.min(1, I);
    for (const b of list) flyerShadow(ctx, 'bat', b.x, b.y, b.ang, b.open, { ...op, alpha: A * (b.k ?? 1), size: b.size || 1, height: b.height });
    for (const b of list) flyer(ctx, 'bat', b.x, b.y, b.ang, b.open, { ...op, alpha: A * (b.k ?? 1), size: b.size || 1 });
  }
  // a moment (seconds, at speed 1) when this Stream is `since` seconds in (for still pictures and the checks)
  function streamAt(fx, since = 4) { for (let t = 0; t < STREAM_PER * 3; t += 0.05) if (Math.abs(streamState(fx, t).since - since) < 0.03) return t; return 0; }

  // Moths round the lights: 2–4 moths circle each lit light (40 in all). lights: [{ x, y, id }] in map units
  function moths(ctx, lights, t, o) {
    ctx.globalCompositeOperation = 'source-over';
    const cell = o.cell; const list = []; let left = 40;
    for (const L of lights) {
      if (left <= 0) break;
      const s = F().seedOf(`${L.id || 'l'}|moths`);
      const n = Math.min(left, 2 + Math.floor(h(s) * 3)); left -= n;
      for (let i = 0; i < n; i++) { const sd = s + i * 9.1; const b = orbitMoth(i, sd, t, cell * (0.22 + 0.3 * h(sd + 2)), cell); b.x += L.x; b.y += L.y; b.height = 0.2; list.push(b); }
    }
    drawBugs(ctx, 'moth', list, { sq: cell, dark: o.dark, alpha: 1 });
    return list.length;
  }

  // =====================================================================
  // Second Builder (second-ground-life): Fish and Critters, painted areas. The same painted pictures (head to the right),
  // bent in strips as they swim or run. They keep to the painted area by walking a tour of it: the area's sample points
  // joined to their neighbours, a tree through them walked out and back (so a path never leaves the paint).
  // =====================================================================
  // len: length in squares (the picture's width)
  const GROUND = { minnow: { len: 0.3 }, koi: { len: 0.8 }, trout: { len: 0.62 }, eel: { len: 1.3 }, rat: { len: 0.55 }, mouse: { len: 0.34 }, roach: { len: 0.2 }, spider: { len: 0.34 }, lizard: { len: 0.55 } };
  // a creature at (x, y) heading ang: its picture in N strips along its length, each strip moved sideways by bend(u)
  // (u: 0 the tail end, 1 the head; squares)
  const bodyTmp = document.createElement('canvas');
  function body(g, pic, key, x, y, ang, len, bend, alpha = 1) {
    if (!pic) return;
    const w0 = pic.naturalWidth || pic.width; const h0 = pic.naturalHeight || pic.height;
    const H = (len * h0) / w0;
    const im = mip(key, pic, H * devK(g));
    const iw = im.naturalWidth || im.width; const ih = im.naturalHeight || im.height;
    g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = alpha;
    const N = bend ? Math.min(10, Math.round((len * devK(g)) / 9)) : 1; // strips of about 9 px: fewer on a small one (thin strips comb)
    if (N < 3) g.drawImage(im, -len / 2, -H / 2 + (bend ? bend(0.5) : 0), len, H);
    else if (alpha < 0.97) {
      // (Beta 3.63, main Builder: the strips overlap a little, and a faint one showed that as dark bars (the Big shadow,
      // a hidden area on the GM screen): put together solid first, then drawn faint as one)
      const k = devK(g); const pad = Math.max(H * 0.6, len * 0.14);
      const tw = Math.max(2, Math.ceil(len * 1.1 * k) + 2); const th = Math.max(2, Math.ceil((H + 2 * pad) * k) + 2);
      const c = bodyTmp; if (c.width < tw) c.width = tw; if (c.height < th) c.height = th;
      const q = c.getContext('2d'); q.setTransform(1, 0, 0, 1, 0, 0); q.globalAlpha = 1; q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, tw, th);
      q.setTransform(k, 0, 0, k, 1, 1 + (pad + H / 2) * k);
      for (let i = 0; i < N; i++) {
        const u0 = i / N; const sx = Math.floor(u0 * iw); const sw = Math.min(iw - sx, Math.ceil(iw / N) + 1);
        q.drawImage(im, sx, 0, sw, ih, u0 * len, -H / 2 + bend(u0 + 0.5 / N), (len / N) * 1.08, H);
      }
      g.drawImage(c, 0, 0, tw, th, -len / 2 - 1 / k, -H / 2 - pad - 1 / k, tw / k, th / k);
    } else {
      for (let i = 0; i < N; i++) {
        const u0 = i / N; const sx = Math.floor(u0 * iw); const sw = Math.min(iw - sx, Math.ceil(iw / N) + 1);
        g.drawImage(im, sx, 0, sw, ih, -len / 2 + u0 * len, -H / 2 + bend(u0 + 0.5 / N), (len / N) * 1.08, H);
      }
    }
    g.restore();
  }
  // ---------- the tour of an area ----------
  const tours = new Map();
  function tourOf(fx, tag, keep, variant) {
    const key = `${fx.id}|${tag}|${variant}`; const sig = `${F().strokeSig(fx)}|${fx.strokes && fx.strokes.length}`;
    const e = tours.get(key); if (e && e.sig === sig) return e.T;
    const S = samplesOf(fx).filter(keep);
    let T = null;
    if (S.length) {
      const n = S.length; const nb = Array.from({ length: n }, () => []);
      // (Beta 3.63, main Builder: the dots of a Box or a Round lie 0.9 squares apart with small radii: they join their
      // neighbours too (also across a corner), else every fish of a Box circled one dot)
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]); if (d < (S[i][2] + S[j][2]) * 0.62 || (S[i][3] && S[j][3] && d < 1.35)) { nb[i].push(j); nb[j].push(i); } }
      const sd = F().seedOf(fx.id || 't') + variant * 7.31;
      const root = Math.floor(h(sd) * n); const seen = new Uint8Array(n); const path = [root]; const stack = [[root, 0]]; seen[root] = 1;
      for (const q of nb) q.sort((a, b) => h(sd + a * 1.3) - h(sd + b * 1.3));
      while (stack.length) {
        const top = stack[stack.length - 1]; const [v, k] = top;
        if (k < nb[v].length) { top[1]++; const w = nb[v][k]; if (!seen[w]) { seen[w] = 1; path.push(w); stack.push([w, 0]); } }
        else { stack.pop(); if (stack.length) path.push(stack[stack.length - 1][0]); }
      }
      // (a dot's radius is its room up to the edge, 0.55 at most: the way through a Box is as wide as the room allows,
      // and off the grid a little, so that nothing walks on rails)
      let P = path.map((i) => (S[i][3] ? [S[i][0] + (h(sd + i * 3.7) - 0.5) * 0.5 * S[i][2], S[i][1] + (h(sd + i * 5.9) - 0.5) * 0.5 * S[i][2], S[i][2] * 1.6] : S[i]));
      if (P.length < 3) { const c = S[root]; P = []; for (let k = 0; k <= 12; k++) { const a = (k / 12) * TAU; P.push([c[0] + Math.cos(a) * c[2] * 0.5, c[1] + Math.sin(a) * c[2] * 0.5, c[2]]); } }
      const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      // (Beta 3.63, main Builder: the real area, however it was painted; it was the sum of the samples' discs, which
      // counted a Box as 0.4 of its squares and a brush line as twice its area)
      T = { P, cum, L: Math.max(1e-3, cum[cum.length - 1]), area: F().areaOf(fx, tag, tag === 'wide' ? (st) => st.poly || st.r > THIN : null) };
    }
    if (tours.size > 360) tours.clear();
    tours.set(key, { sig, T }); return T;
  }
  function tourAt(T, s) {
    s = ((s % T.L) + T.L) % T.L; const c = T.cum; let lo = 0; let hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const a = T.P[lo]; const b = T.P[hi]; const k = c[hi] > c[lo] ? (s - c[lo]) / (c[hi] - c[lo]) : 0;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  // smoothed: the corners of the tour rounded off (a U-turn at a branch's end becomes a loop)
  function tourSmooth(T, s, w) {
    let x = 0; let y = 0; let r = 0; const W = [1, 4, 6, 4, 1];
    for (let k = -2; k <= 2; k++) { const p = tourAt(T, s + k * w * 0.5); const q = W[k + 2] / 16; x += p[0] * q; y += p[1] * q; r += p[2] * q; }
    return [x, y, r];
  }
  // where a walker is: s along the tour, side (−1…1 of the local half width), heading the way it moves
  function walker(T, s, side, w = 0.6) {
    const p = tourSmooth(T, s, w); const a = tourSmooth(T, s - 0.06, w); const b = tourSmooth(T, s + 0.06, w);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) || 0; const off = side * p[2] * 0.45;
    return { x: p[0] - Math.sin(ang) * off, y: p[1] + Math.cos(ang) * off, ang, r: p[2] };
  }
  // run and rest: how far a walker has gone after t seconds (runs of `run` s at v, rests of `rest` s)
  function gone(t, run, rest, v, ph = 0) {
    const P = run + rest; const u = t + ph * P; const k = Math.floor(u / P); const f = u - k * P;
    return v * run * (k + sm(0, 1, Math.min(1, f / run)));
  }
  const isRun = (t, run, rest, ph = 0) => { const P = run + rest; const f = ((t + ph * P) % P + P) % P; return f < run; };

  // ---------- Fish (paint): under the surface; no water of its own ----------
  const WET = new Map();
  // the picture as seen through water: a little blurred, less contrast, tinted toward the water (made once)
  function wet(n, tintK, dark, blurPx, hex) {
    const key = `${n}|wet|${tintK}|${dark}|${blurPx}|${hex || ''}`; let c = WET.get(key); if (c) return c;
    let im = img(n); if (!im) return null;
    if (hex) im = tinted(n, im, hex);
    const w = im.naturalWidth || im.width; const hh = im.naturalHeight || im.height; const pad = Math.ceil(blurPx * 3);
    c = document.createElement('canvas'); c.width = w + pad * 2; c.height = hh + pad * 2; c.cy = 0.5;
    const g = c.getContext('2d');
    g.filter = `blur(${blurPx}px) saturate(${1 - tintK * 0.8}) contrast(${1 - tintK * 0.5}) brightness(${1 - dark})`;
    g.drawImage(im, pad, pad); g.filter = 'none';
    g.globalCompositeOperation = 'source-atop'; g.globalAlpha = tintK; g.fillStyle = '#2c5c66'; g.fillRect(0, 0, c.width, c.height);
    WET.set(key, c); return c;
  }
  const lows = new Map();
  function lowRes(c, w) {
    if (!c) return null; let e = lows.get(c); if (e) return e;
    e = document.createElement('canvas'); e.width = w; e.height = Math.max(4, Math.round((w * c.height) / c.width)); e.cy = 0.5;
    const g = e.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, e.width, e.height);
    lows.set(c, e); return e;
  }
  const FISH = {
    small: { pic: 'minnow', v: 0.9, school: [4, 8], per: 6, tint: 0.2, dark: 0, blur: 1, alpha: 0.85, wave: 0.07, hz: 3.2, shade: 0.18 },
    koi: { pic: 'koi', v: 0.3, school: [1, 2], per: 10, lag: 2.2, tint: 0.08, dark: 0, blur: 0.5, alpha: 0.95, wave: 0.06, hz: 0.9, shade: 0.28, rings: true },
    trout: { pic: 'trout', v: 0, school: [1, 1], per: 5, tint: 0.28, dark: 0.05, blur: 1, alpha: 0.85, wave: 0.05, hz: 1.7, shade: 0.15 },
    eels: { pic: 'eel', v: 0.22, school: [1, 1], per: 12, tint: 0.35, dark: 0.2, blur: 1.5, alpha: 0.85, wave: 0.09, hz: 0.45, shade: 0 },
    shadow: { pic: 'trout', v: 0.35, school: [1, 1], per: 1e9, tint: 0, dark: 1, blur: 0, alpha: 0.3, wave: 0.03, hz: 0.25, shade: 0 },
  };
  function fishWave(K, len, t, sd, k = 1) {
    if (K.pic === 'eel') return (u) => K.wave * len * k * Math.sin(t * K.hz * TAU + sd - u * TAU * 1.3) * (0.45 + 0.55 * (1 - u));
    return (u) => K.wave * len * k * Math.pow(1 - u, 1.6) * Math.sin(t * K.hz * TAU + sd - u * 4);
  }
  // the painted lines of an area, in squares, with their lengths (for trout and the critters' runs)
  function linesOf(fx, maxR = Infinity) {
    const out = [];
    for (const st of fx.strokes || []) {
      if (st.poly || st.cut || !st.pts || st.pts.length < 4 || st.r > maxR) continue;
      const p = st.pts; const cum = [0];
      for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
      const L = cum[cum.length - 1]; if (L > 0.8) out.push({ p, cum, L, r: st.r });
    }
    return out;
  }
  function lineAt(l, d) {
    d = clamp(d, 0, l.L); let i = 1; while (i < l.cum.length - 1 && l.cum[i] < d) i++;
    const a = l.cum[i - 1]; const k = l.cum[i] > a ? (d - a) / (l.cum[i] - a) : 0; const p = l.p;
    const x0 = p[(i - 1) * 2]; const y0 = p[(i - 1) * 2 + 1]; const x1 = p[i * 2]; const y1 = p[i * 2 + 1];
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, ang: Math.atan2(y1 - y0, x1 - x0) };
  }
  function fish(ctx, fx, t, o) {
    const { regionBox, regionMask, scratch } = F();
    const kind = FISH[fx.variant] ? fx.variant : 'small'; const K = FISH[kind];
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const B = regionBox(ctx, fx, 0.3); if (!B) return 0;
    const T0 = tourOf(fx, 'all', () => true, 0); if (!T0) return 0;
    const s = o.s; const A = Math.min(1, o.I); const size = 1; const len = GROUND[K.pic].len * size * (kind === 'shadow' ? 6 : 1);
    const pic = kind === 'shadow' ? lowRes(shadowOf(K.pic), 40) : wet(K.pic, K.tint, K.dark, K.blur, o.C); // (the big shadow: a small picture drawn huge, so it is soft)
    if (!pic) return 0;
    const sc = scratch(13, W, H, B); const g = sc.g; g.setTransform(m);
    const list = []; // { x, y, ang, len, wave, sd }
    const lines = kind === 'trout' ? linesOf(fx) : [];
    const groups = kind === 'shadow' ? 1 : Math.min(30, F().count(Math.max(1, Math.round(T0.area / K.per)), fx));
    let n = 0;
    for (let i = 0; i < groups && n < 30; i++) {
      const sd = s + i * 11.3;
      const T = i % 3 ? tourOf(fx, 'all', () => true, i % 3) || T0 : T0; // (Beta 3.63: three ways round, so the groups do not follow one another)
      if (kind === 'trout' && lines.length) { // holds its place facing upstream (against the way it was painted), darts up, drifts back
        const l = lines[Math.floor(h(sd) * lines.length)]; const d0 = (0.15 + 0.7 * h(sd + 1)) * l.L;
        const P = 6 + 5 * h(sd + 2); const f = fract(t / P + h(sd + 3));
        const d = d0 - (f < 0.07 ? 0.6 * sm(0, 0.07, f) : 0.6 * (1 - (f - 0.07) / 0.93));
        const q = lineAt(l, d); const side = (h(sd + 4) - 0.5) * l.r * 0.9 + Math.sin(t * 0.4 + sd) * 0.05;
        list.push({ x: q.x - Math.sin(q.ang) * side, y: q.y + Math.cos(q.ang) * side, ang: q.ang + Math.PI + Math.sin(t * 0.7 + sd) * 0.08, len: len * (0.85 + 0.3 * h(sd + 5)), sd, k: f < 0.07 ? 2 : 1 });
        n++; continue;
      }
      let a = 1;
      if (kind === 'shadow') { const c = cycle(t, 80, sd, 0.5); a = sm(0, 6, c.since) * (1 - sm(28, 34, c.since)); if (a <= 0.01) continue; }
      const v = Math.max(0.05, K.v) * (0.8 + 0.4 * h(sd + 1));
      // forward along the tour, slower and faster; small fish dart now and then
      let sp = v * t + v * 1.6 * Math.sin(t * 0.23 + sd) + h(sd + 2) * T.L;
      if (kind === 'small') { const P = 5 + 4 * h(sd + 3); const u = t / P + h(sd + 4); sp += 1.2 * (Math.floor(u) + sm(0, 0.12, fract(u))); }
      const side = Math.sin(t * 0.11 + sd * 3) * 0.8;
      const cnt = Math.round(K.school[0] + (K.school[1] - K.school[0]) * h(sd + 5));
      for (let j = 0; j < cnt && n < 30; j++, n++) {
        // a school: each one a little behind and to the side of the one it follows, in a loose bunch (not a file)
        const lag = j ? (0.08 + 0.5 * h(sd + j * 2.1)) * (K.lag || 1) : 0;
        const w = walker(T, sp - lag, side, kind === 'eels' ? 1 : 0.6);
        const off = j ? ((h(sd + j * 3.3) - 0.5) * 0.75 + Math.sin(t * 0.6 + j * 2) * 0.04) * (K.lag || 1) : 0;
        w.x -= Math.sin(w.ang) * off; w.y += Math.cos(w.ang) * off;
        list.push({ x: w.x, y: w.y, ang: w.ang + Math.sin(t * 1.3 + j + sd) * 0.05, len: len * (0.85 + 0.3 * h(sd + j * 7.7)), sd: sd + j, a, k: 1 });
      }
    }
    // a faint shadow on the bottom (shallow fish), then the fish
    if (K.shade > 0) {
      const sh = shadowOf(K.pic);
      if (sh) for (const f of list) body(g, sh, `${K.pic}|shadow`, f.x + 0.07 * f.len / 0.3, f.y + 0.1 * f.len / 0.3, f.ang, f.len, fishWave(K, f.len, t, f.sd, f.k), K.shade * A);
    }
    const key = `${K.pic}|wet|${kind}|${o.C || ''}`;
    // seen through moving water: each one wavers a little (it looks submerged by itself, whatever is drawn over it)
    for (const f of list) {
      const wx = Math.sin(t * 1.9 + f.sd * 3) * 0.012 + Math.sin(t * 3.7 + f.sd) * 0.006; const wy = Math.cos(t * 2.3 + f.sd * 5) * 0.012;
      body(g, pic, key, f.x + wx, f.y + wy, f.ang + Math.sin(t * 1.3 + f.sd * 2) * 0.03, f.len * (1 + 0.025 * Math.sin(t * 2.7 + f.sd)), fishWave(K, f.len, t, f.sd, f.k), K.alpha * A * (f.a ?? 1) * (0.93 + 0.07 * Math.sin(t * 1.1 + f.sd)));
    }
    // koi now and then mouth the surface: a ring at the head
    if (K.rings) {
      g.globalCompositeOperation = 'source-over';
      for (const f of list) {
        const c = cycle(t, 14, f.sd + 0.7, 0.8); if (c.since > 1.8) continue;
        const hx = f.x + Math.cos(f.ang) * f.len * 0.45; const hy = f.y + Math.sin(f.ang) * f.len * 0.45;
        ring(g, hx, hy, 0.05 + c.since * 0.18, A * 0.55 * (1 - c.since / 1.8), '#e8f6f4', 0.025);
      }
      g.globalAlpha = 1;
    }
    // fade at the bank: only inside the painted area
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.drawImage(regionMask(ctx, fx, 0.4), B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(sc.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h); ctx.restore();
    return list.length;
  }

  // ---------- Critters (paint): wander in a wide area; run along a thin stroke and vanish at its ends ----------
  // n: how many in an area of about 16 squares (fewer than the spec, Glinn's choice); v: squares a second running;
  // run, rest: seconds
  const CRITS = {
    rats: { pic: 'rat', n: 3, cap: 12, v: 2.2, run: [0.5, 1.2], rest: [0.8, 2.6], tail: 0.07, sniff: true },
    mice: { pic: 'mouse', n: 3, cap: 12, v: 2.6, run: [0.3, 0.7], rest: [0.6, 1.8], tail: 0.07, sniff: true },
    roaches: { pic: 'roach', n: 7, cap: 20, v: 2.4, run: [0.4, 1], rest: [0.2, 0.8], skitter: true },
    spiders: { pic: 'spider', n: 2, cap: 8, v: 0.55, run: [1.4, 3], rest: [3, 8], gait: true },
    lizards: { pic: 'lizard', n: 2, cap: 8, v: 3.4, run: [0.25, 0.55], rest: [2, 5], wiggle: 0.09 },
  };
  const THIN = 0.6; // brush radius (squares) up to which a stroke is a run, not a home
  function critBend(K, len, t, moving, sd) {
    if (K.wiggle) return (u) => (moving ? K.wiggle : 0.012) * len * Math.sin(t * (moving ? 7 : 0.8) * TAU * 0.5 + sd - u * 5) * (1 - u * 0.6);
    if (K.tail) return (u) => (u < 0.45 ? K.tail * len * ((0.45 - u) / 0.45) * Math.sin(t * (moving ? 5 : 1.3) * TAU * 0.5 + sd - u * 6) : 0) + (K.sniff && !moving && u > 0.85 ? 0.012 * len * Math.sin(t * 9 * TAU * 0.5 + sd) : 0);
    return null;
  }
  function critters(ctx, fx, t, o) {
    const kind = CRITS[fx.variant] ? fx.variant : 'rats'; const K = CRITS[kind]; const S0 = GROUND[K.pic];
    const s = o.s; const A = Math.min(1, o.I);
    let pic = img(K.pic); if (!pic) return 0;
    if (o.C) pic = tinted(K.pic, pic, o.C);
    const key = o.C ? `${K.pic}|${o.C}` : K.pic; const sh = shadowOf(K.pic);
    const home = (p) => p[3] || p[2] > THIN; // (Beta 3.63: a Box or a Round is always a home; its dots are small)
    const T0 = tourOf(fx, 'wide', home, 0);
    const lines = linesOf(fx, THIN);
    const area = (T0 ? T0.area : 0) + lines.reduce((q, l) => q + l.L * 0.8, 0);
    const n = Math.min(K.cap, F().count(Math.max(1, Math.round(K.n * clamp(area / 16, 0.5, 3))), fx));
    ctx.globalCompositeOperation = 'source-over';
    const out = [];
    for (let i = 0; i < n; i++) {
      const sd = s + i * 9.7;
      const T = T0 && i % 3 ? tourOf(fx, 'wide', home, i % 3) || T0 : T0; // (three ways round: they do not all take one path)
      const run = K.run[0] + (K.run[1] - K.run[0]) * h(sd); const rest = K.rest[0] + (K.rest[1] - K.rest[0]) * h(sd + 1);
      const v = K.v * (0.85 + 0.3 * h(sd + 2)); const ph = h(sd + 3);
      const onLine = lines.length && (!T || h(sd + 4) < lines.length / (lines.length + 1.5));
      const moving = isRun(t, run, rest, ph);
      let x; let y; let ang; let a = 1;
      if (onLine) { // along the stroke from one end to the other, then into the hole; back later
        const l = lines[Math.floor(h(sd + 5) * lines.length)];
        const speed = (v * run) / (run + rest); const P = l.L / speed * 1.15 + 4 + 8 * h(sd + 6);
        const c = Math.floor(t / P + h(sd + 7)); const tc = (t / P + h(sd + 7) - c) * P;
        const d = gone(tc, run, rest, v, 0); if (d >= l.L) continue;
        const fwd = h(sd + c * 1.7) < 0.5;
        const q = lineAt(l, fwd ? d : l.L - d);
        x = q.x; y = q.y; ang = q.ang + (fwd ? 0 : Math.PI);
        a = sm(0, 0.3, d) * sm(0, 0.3, l.L - d); // out of a hole, into the other
      } else if (T) {
        const w = walker(T, gone(t, run, rest, v, ph) + h(sd + 8) * T.L, Math.sin(t * 0.05 + sd) * 0.9, 0.35);
        x = w.x; y = w.y; ang = w.ang;
      } else continue;
      // something always moves: a sniff, a twitch, the gait
      if (K.sniff && !moving) ang += Math.sin(t * 2.3 + sd) * 0.18;
      if (K.skitter) ang += moving ? Math.sin(t * 31 + sd) * 0.1 : (fract(t * 0.4 + h(sd)) < 0.06 ? 0.2 : 0);
      if (K.gait && moving) ang += Math.sin(t * 9 + sd) * 0.05;
      out.push({ x, y, ang, a, moving, sd });
    }
    const len = S0.len;
    for (const c of out) if (sh) body(ctx, sh, `${K.pic}|shadow`, c.x + 0.025, c.y + 0.04, c.ang, len, critBend(K, len, t, c.moving, c.sd), 0.4 * A * c.a);
    for (const c of out) body(ctx, pic, key, c.x, c.y, c.ang, len * (K.gait && c.moving ? 1 + 0.03 * Math.sin(t * 18 + c.sd) : 1), critBend(K, len, t, c.moving, c.sd), A * c.a);
    ctx.globalAlpha = 1;
    return out.length;
  }

  // =====================================================================
  // Second Builder (second-sun-sand-gears): Sun through leaves and Drifting sand (painted, light: two soft noise layers
  // and a few puffs, no per-dot loops; candidates for the one engine later), Dust devil (a click, on the fly layer),
  // a moment (seconds, at speed 1) when this dust devil is `since` seconds into a life (for its tile and the checks)
  function devilAt(fx, since = 6) { const s = F().seedOf(fx.id || 'd'); const per = 26 / Math.max(0.3, Wd().strength - 0.2); for (let t = 0; t < per * 3; t += 0.05) if (Math.abs(cycle(t, per, s, 0.6).since - since) < 0.03) return t; return 0; }
  // Tumbleweeds (a weather layer, on the fly layer) and Turning parts (a Round turns, a Box rolls the map picture, on the
  // sharp Sway layer)
  // =====================================================================
  const Wd = () => WIND || { dir: 30, strength: 1, from: 'calm' }; // the map's wind (scene-view hands it over each frame)
  // two noise layers drifting their own ways, kept where both are thick (patches), tinted; into scratch g over box B
  function patches(g, m, B, col, a, o) {
    const { patternAt, noiseTile, tinted } = F();
    g.globalAlpha = a;
    g.fillStyle = patternAt(g, tinted(noiseTile(), col), m, o.s1, o.x1, o.y1, o.ang1, o.st1 || 1); g.fillRect(B.x, B.y, B.w, B.h);
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.fillStyle = patternAt(g, noiseTile(), m, o.s2, o.x2, o.y2, o.ang2, o.st2 || 1); g.fillRect(B.x, B.y, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
  }
  function finish(ctx, fx, g, c, B, soft) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in';
    g.drawImage(F().regionMask(ctx, fx, soft), B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h);
    g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h); ctx.restore();
  }
  // Sun through leaves: soft spots of light under a canopy that shift as the leaves move (faster in a storm), a light
  // shade between them. Moonlight: the same, cool and faint. Rays: soft beams slanting from the top-left, dust in them
  const DAPPLE = { sunlight: { light: '#fff0c2', shade: '#0c1606', la: 0.55, sa: 0.28 }, moonlight: { light: '#c9dcff', shade: '#02050c', la: 0.45, sa: 0.32 }, rays: { light: '#fff1cc', shade: '#0c1606', la: 0.45, sa: 0.1 } };
  function dapple(ctx, fx, t, o) {
    const { regionBox, scratch, dot, sprite } = F();
    const K = DAPPLE[fx.variant] || DAPPLE.sunlight; const I = Math.min(1.6, o.I);
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const B = regionBox(ctx, fx, 0.6); if (!B) return;
    const wind = Wd().strength || 1; const sway = t * (0.35 + 0.3 * wind);
    const light = o.C || K.light;
    const sc = scratch(14, W, H, B); const g = sc.g;
    // the shade
    g.globalAlpha = K.sa * I; g.fillStyle = K.shade; g.fillRect(B.x, B.y, B.w, B.h); g.globalAlpha = 1;
    // the spots: soft round patches of light, each swaying a little with the leaves and breathing; cut out of the shade,
    // then lit (a few dozen sprite stamps, no per-dot work)
    const S = samplesOf(fx); if (!S.length) return;
    const spots = scratch(15, W, H, B); const sg = spots.g; sg.setTransform(m);
    const spr = F().sprite('#ffffff');
    const area = S.reduce((q, p) => q + 1.6 * p[2] * p[2], 0);
    const n = Math.min(220, Math.round(area * 2.2 * (fx.density ?? 1)));
    const big = fx.variant === 'rays' ? 1.6 : 1;
    for (let i = 0; i < n; i++) {
      const p = S[Math.floor(h(o.s + i * 3.7) * S.length)]; const a0 = h(o.s + i * 5.1) * TAU; const d0 = Math.sqrt(h(o.s + i * 6.9)) * p[2];
      const x = p[0] + Math.cos(a0) * d0 + Math.sin(sway * (0.8 + h(o.s + i)) + i) * 0.06; const y = p[1] + Math.sin(a0) * d0 + Math.cos(sway * (0.7 + h(o.s + i * 2)) + i * 2) * 0.06;
      const r = (0.12 + 0.3 * h(o.s + i * 8.3)) * big / Math.sqrt(Math.max(0.4, fx.density ?? 1));
      F().dot(sg, spr, x, y, r, 0.55 + 0.45 * Math.sin(sway * 1.3 + i * 1.7));
    }
    sg.setTransform(1, 0, 0, 1, 0, 0);
    if (light !== '#ffffff') { sg.globalCompositeOperation = 'source-atop'; sg.fillStyle = light; sg.fillRect(B.x, B.y, B.w, B.h); sg.globalCompositeOperation = 'source-over'; }
    if (fx.variant !== 'rays') { g.globalCompositeOperation = 'destination-out'; g.drawImage(spots.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h); g.globalCompositeOperation = 'source-over'; }
    g.globalAlpha = K.la * I * (0.9 + 0.1 * Math.sin(t * 1.7 * wind)); g.drawImage(spots.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h); g.globalAlpha = 1;
    if (fx.variant === 'rays') { // soft beams from the top-left, slowly breathing, motes drifting in them
      g.setTransform(m);
      if (S.length) {
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; for (const p of S) { x0 = Math.min(x0, p[0] - p[2]); y0 = Math.min(y0, p[1] - p[2]); x1 = Math.max(x1, p[0] + p[2]); y1 = Math.max(y1, p[1] + p[2]); }
        const n = 5; const span = Math.hypot(x1 - x0, y1 - y0);
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n; const cx = x0 + (x1 - x0) * u; const cy = y0 + (y1 - y0) * (1 - u);
          const w = span * (0.06 + 0.06 * h(o.s + i)); const a = 0.34 * I * (0.6 + 0.4 * Math.sin(t * 0.3 + i * 1.7));
          g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
          const gr = g.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, `rgba(255,240,200,${a})`); gr.addColorStop(1, 'rgba(255,240,200,0)');
          g.fillStyle = gr; g.fillRect(-span, -w, span * 2, w * 2); g.restore();
        }
        const motes = Math.min(40, Math.round(S.length * 0.8)); const spr = sprite('#fff6dc');
        for (let i = 0; i < motes; i++) { const p = S[Math.floor(h(o.s + i * 3.1) * S.length)]; const x = p[0] + (h(o.s + i * 5.3) - 0.5) * p[2] * 2 + Math.sin(t * 0.2 + i) * 0.3; const y = p[1] + (h(o.s + i * 7.9) - 0.5) * p[2] * 2 + Math.cos(t * 0.17 + i * 2) * 0.3; dot(g, spr, x, y, 0.05, 0.5 * I * (0.5 + 0.5 * Math.sin(t * 0.9 + i))); }
        g.globalCompositeOperation = 'source-over';
      }
    }
    finish(ctx, fx, g, sc.c, B, 1.2);
  }
  // Drifting sand: low streamers sliding over the painted dunes the way the wind blows (the way it was painted when the
  // air is calm), a fine shimmer, puffs lifting off. Snow and Ash kinds
  const DRIFT = { sand: { col: '#e3c48c', puff: '#f0dcb0' }, snow: { col: '#f4f8ff', puff: '#ffffff' }, ash: { col: '#8d8a86', puff: '#b9b4ae' } };
  function drift(ctx, fx, t, o) {
    const { regionBox, scratch, dot, sprite, flowDir } = F();
    const K = DRIFT[fx.variant] || DRIFT.sand; const col = o.C || K.col; const I = Math.min(1.6, o.I);
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const B = regionBox(ctx, fx, 0.5); if (!B) return;
    let dx; let dy; const ws = Wd().strength || 0;
    if (Wd().from && Wd().from !== 'calm') { dx = Math.cos((Wd().dir * Math.PI) / 180); dy = Math.sin((Wd().dir * Math.PI) / 180); } else [dx, dy] = flowDir(fx, o.s);
    const v = 0.6 + 0.9 * Math.max(0.5, ws); const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const sc = scratch(16, W, H, B); const g = sc.g;
    // streamers: long, thin, racing downwind
    patches(g, m, B, col, Math.min(1, I), { s1: 1.4, x1: dx * v * t, y1: dy * v * t, ang1: ang, st1: 5, s2: 0.9, x2: dx * v * t * 0.6, y2: dy * v * t * 0.6, ang2: ang + 8, st2: 3 });
    // the shimmer: a fine sliding layer
    const sh = scratch(17, W, H, B); patches(sh.g, m, B, col, 0.5 * I, { s1: 0.35, x1: dx * v * t * 0.3, y1: dy * v * t * 0.3, ang1: ang, st1: 2.5, s2: 0.5, x2: -dy * 0.1 * Math.sin(t * 0.3), y2: dx * 0.1 * Math.sin(t * 0.3), ang2: ang, st2: 2 });
    g.globalAlpha = 0.6; g.drawImage(sh.c, B.x, B.y, B.w, B.h, B.x, B.y, B.w, B.h); g.globalAlpha = 1;
    // puffs blowing off at seeded points
    g.setTransform(m);
    const S = samplesOf(fx); const spr = sprite(K.puff);
    const n = Math.min(24, F().count(Math.max(2, Math.round(S.length * 0.4)), fx));
    for (let i = 0; i < n && S.length; i++) {
      const P = 2.5 + 2 * h(o.s + i); const u = fract(t / P + h(o.s + i * 1.3)); const k = Math.floor(t / P + h(o.s + i * 1.3));
      const p = S[Math.floor(h(o.s + i * 3.7 + k * 0.71) * S.length)];
      const d = u * v * 1.6; const x = p[0] + dx * d + (h(o.s + i * 2.1 + k) - 0.5) * p[2]; const y = p[1] + dy * d + (h(o.s + i * 4.3 + k) - 0.5) * p[2];
      dot(g, spr, x, y, 0.12 + u * 0.35, 0.35 * I * Math.sin(u * Math.PI));
    }
    finish(ctx, fx, g, sc.c, B, 1.4);
  }
  // Dust devil (a click): a little whirl of dust rising, its foot wandering round its spot and leaning with the wind; it
  // grows, lives a while and falls apart, then comes again. Calm air: rare
  const DEVIL = { dust: ['#d9bf8f', '#b99b6a', '#efe0bd'], ash: ['#8e8b87', '#6c6966', '#bdb8b2'], leaves: ['#b9862f', '#8a6a24', '#c9a24a'] };
  function devil(ctx, fx, x, y, t, r, I) {
    const s = F().seedOf(fx.id || 'd'); const cell = SCENE.cell;
    const cols = DEVIL[fx.variant] || DEVIL.dust; const ws = Wd().strength || 1;
    const per = 26 / Math.max(0.3, ws - 0.2); const life = Math.min(per - 4, 14 + 6 * h(s)); // seconds
    const c = cycle(t, per, s, 0.6); const age = c.since;
    if (age > life) return;
    const k = sm(0, 2, age) * (1 - sm(life - 3, life, age)); // grows 2 s, falls apart 3 s
    const fade = 1 - sm(life - 3, life, age);
    const wr = (Wd().dir * Math.PI) / 180;
    const fx0 = x + Math.sin(t * 0.31 + s) * r * 1.2 + Math.cos(wr) * age * 0.15 * cell; const fy0 = y + Math.cos(t * 0.27 + s * 2) * r * 1.2 + Math.sin(wr) * age * 0.15 * cell;
    const lean = 0.35 * Math.min(2, ws); // how far the top drifts downwind (of its height)
    // (Beta 3.63, main Builder, after Glinn's look: it read as a ring of puffs with a hole. Now a whirl seen from above:
    // a soft picture of three arms of dust curling out of a dense middle (made once), drawn three times, each turning
    // at its own rate: wide and slow at the foot, small and fast at the top, which leans downwind; a few specks ride round)
    const { rgba } = F();
    const leaves = fx.variant === 'leaves';
    const A = Math.min(1, I) * k; if (A <= 0.004) return;
    const R = r * (0.35 + 0.65 * k); const spin = t * 3.6;
    const top = (z) => [fx0 + Math.cos(wr) * lean * z * r * 1.3, fy0 + Math.sin(wr) * lean * z * r * 1.3 - z * r * 0.2];
    const pic = whirlPic(DEVIL[fx.variant] ? fx.variant : 'dust', cols);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // its shadow on the ground (it stands up from the table: on sand the dust alone hardly shows)
    const hx = fx0 + R * 0.3; const hy = fy0 + R * 0.38;
    const gs = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 1.25 + 1e-3);
    gs.addColorStop(0, `rgba(30,22,12,${0.26 * A})`); gs.addColorStop(0.6, `rgba(30,22,12,${0.1 * A})`); gs.addColorStop(1, 'rgba(30,22,12,0)');
    ctx.fillStyle = gs; ctx.beginPath(); ctx.arc(hx, hy, R * 1.25 + 1e-3, 0, TAU); ctx.fill();
    const g0 = ctx.createRadialGradient(fx0, fy0, 0, fx0, fy0, R * 1.45 + 1e-3);
    g0.addColorStop(0, rgba(cols[1], 0.22 * A)); g0.addColorStop(0.55, rgba(cols[1], 0.1 * A)); g0.addColorStop(1, rgba(cols[1], 0));
    ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(fx0, fy0, R * 1.45 + 1e-3, 0, TAU); ctx.fill();
    const turn = (z, size, rate, ph, al) => {
      const [qx, qy] = top(z); const d = R * size;
      ctx.save(); ctx.translate(qx, qy); ctx.rotate(spin * rate + ph + s); ctx.globalAlpha = al * A;
      ctx.drawImage(pic, -d, -d * 0.92, d * 2, d * 1.84); ctx.restore();
    };
    turn(0, 1.5, 0.55, 0, leaves ? 0.6 : 0.8);
    turn(0.5, 1.05, 1, 1.3, leaves ? 0.6 : 0.85);
    // what it carries: specks riding round, lifted from the foot toward the top
    const n = Math.min(90, F().count(Math.round((leaves ? 46 : 26) * (fx.density ?? 1)), { density: 1 }));
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const u = fract(h(s + i * 1.7) + t * (0.12 + 0.08 * h(s + i))); // from the middle (0) out to the rim (1), rising
      const rad = R * (0.15 + 1.05 * Math.pow(u, 0.8)) * (0.85 + 0.3 * h(s + i * 5.3));
      const a = spin * (1.5 - 0.9 * u) + h(s + i * 2.9) * TAU;
      const al = A * (leaves ? 0.95 : 0.5) * sm(0, 0.12, u) * (1 - sm(0.6, 1, u));
      if (al < 0.02) continue;
      const [ox, oy] = top(0.7 * (1 - u));
      ctx.globalAlpha = al; ctx.strokeStyle = cols[leaves ? i % 3 : i % 2];
      ctx.lineWidth = (leaves ? 0.05 : 0.024) * cell * (0.7 + 0.6 * h(s + i * 4.1));
      const arc = (leaves ? 0.05 : 0.07) / (0.35 + u);
      ctx.beginPath(); ctx.ellipse(ox, oy, rad, rad * 0.92, 0, a - arc, a); ctx.stroke();
    }
    turn(1, 0.62, 1.7, 2.9, leaves ? 0.7 : 0.95);
    ctx.globalAlpha = 1;
  }
  // the whirl's picture: three arms of soft dust curling out of a dense middle (the outer end of an arm trails)
  const whirls = new Map();
  function whirlPic(key, cols) {
    let c = whirls.get(key); if (c) return c;
    const { rgba } = F(); const N = 224; const M = N / 2;
    c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d');
    const blob = (x, y, rr, col, al) => { const q = g.createRadialGradient(x, y, 0, x, y, rr); q.addColorStop(0, rgba(col, al)); q.addColorStop(0.5, rgba(col, al * 0.45)); q.addColorStop(1, rgba(col, 0)); g.fillStyle = q; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); };
    const sd = key.length * 3.7;
    for (let arm = 0; arm < 3; arm++) {
      for (let i = 0; i < 80; i++) {
        const u = i / 79; const a = (arm * TAU) / 3 - u * 4.4 + (h(sd + arm * 9 + i * 1.3) - 0.5) * 0.3 * (0.4 + u);
        const rad = M * (0.06 + 0.8 * Math.pow(u, 0.9)) * (0.94 + 0.12 * h(sd + i * 2.1 + arm));
        blob(M + Math.cos(a) * rad, M + Math.sin(a) * rad, M * (0.07 + 0.13 * u) * (0.8 + 0.5 * h(sd + i * 3.3 + arm * 2)), cols[i % 3 === 1 ? 1 : (arm + i) % 2 ? 2 : 0], 0.3 * Math.pow(1 - u, 1.2) + 0.015);
      }
    }
    // thin dust between the arms, and the dense middle (lighter at its very top)
    for (let i = 0; i < 60; i++) { const a = h(sd + i * 7.1) * TAU; const rad = M * 0.6 * Math.sqrt(h(sd + i * 4.7)); blob(M + Math.cos(a) * rad, M + Math.sin(a) * rad, M * (0.1 + 0.12 * h(sd + i)), cols[i % 3], 0.05); }
    blob(M, M, M * 0.34, cols[1], 0.5); blob(M, M, M * 0.2, cols[0], 0.55); blob(M - M * 0.02, M - M * 0.03, M * 0.1, cols[2], 0.5);
    whirls.set(key, c); return c;
  }
  // Tumbleweeds (a weather layer, Scene → Weather → Add a layer): now and then one rolls across the table with the
  // wind, bouncing, spinning, and is gone. Drawn in table units (sq: a square), on the fly layer
  const weeds = new Map();
  function weedPic(seed) {
    const key = Math.floor(seed * 4) % 4; let c = weeds.get(key); if (c) return c;
    c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.translate(64, 64); g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const a0 = h(key * 31 + i) * TAU; const r0 = 52 * Math.sqrt(h(key * 17 + i * 1.3)); const a1 = a0 + (h(key + i * 2.7) - 0.5) * 2.2; const r1 = 52 * Math.sqrt(h(key * 5 + i * 3.1));
      const lit = 0.5 + 0.5 * Math.cos(a0 + 2.4); // light from the top-left
      g.strokeStyle = `rgba(${Math.round(110 + 70 * lit)},${Math.round(80 + 50 * lit)},${Math.round(40 + 30 * lit)},0.9)`; g.lineWidth = 1.2 + 1.6 * h(i * 9.1 + key);
      g.beginPath(); g.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0); g.quadraticCurveTo(Math.cos((a0 + a1) / 2) * 60 * h(i + key * 3), Math.sin((a0 + a1) / 2) * 60 * h(i * 1.1 + key), Math.cos(a1) * r1, Math.sin(a1) * r1); g.stroke();
    }
    weeds.set(key, c); return c;
  }
  function tumble(ctx, w, W, H, t, now, o) {
    if (!w || !Array.isArray(w.layers)) return 0;
    let drawn = 0; const fadeMs = (w.fade || 0) * 1000;
    for (const L of w.layers) {
      if (L.type !== 'tumble') continue;
      const A = F().layerAlpha(L, now, fadeMs); if (A <= 0.003) continue;
      const ws = Wd().from && Wd().from !== 'calm' ? Wd().strength : 0; // calm air: none come
      if (ws < 0.3) continue;
      const s = F().seedOf(L.id || 'tumble'); const size = clamp(L.size ?? 1, 0.3, 3); const amt = clamp(L.amount ?? 1, 0.1, 4);
      const R = 0.45 * size * o.sq; const v = (1.6 + 1.2 * ws) * clamp(L.speed ?? 1, 0.1, 5) * o.sq; // table units a second
      const dir = (Wd().dir * Math.PI) / 180; const dx = Math.cos(dir); const dy = Math.sin(dir);
      const D = Math.abs(dx) * W + Math.abs(dy) * H + 4 * R; const cross = D / v; const per = Math.max(cross + 2, 20 / amt);
      for (const back of [0, 1]) {
        const c = cycle(t, per, s, 0.7); const n = c.n - back; const since = c.since + back * per;
        if (since > cross) continue;
        const lat = (h(s + n * 3.7) - 0.5) * 0.8 * (Math.abs(dx) * H + Math.abs(dy) * W);
        const d = since * v - D / 2; const bx = W / 2 + dx * d - dy * lat; const by = H / 2 + dy * d + dx * lat;
        const hop = Math.abs(Math.sin(since * (2.2 + h(s + n)) * Math.PI * 0.5)) * R * 0.9 * (0.6 + 0.4 * h(s + n * 2)); // bounces
        const spin = (since * v) / R;
        // the shadow parts from it as it bounces
        const shK = 1 - 0.3 * (hop / R);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = A * 0.32 * shK * (1 - sm(0.3, 0.6, o.dark || 0));
        const gr = ctx.createRadialGradient(bx + R * 0.2, by + R * 0.3, 0, bx + R * 0.2, by + R * 0.3, R * shK);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(bx + R * 0.2, by + R * 0.3, R * shK, 0, TAU); ctx.fill();
        ctx.save(); ctx.globalAlpha = A; ctx.translate(bx - hop * 0.3, by - hop); ctx.rotate(spin * (dx >= 0 ? 1 : -1));
        const pic = weedPic(h(s + n)); ctx.drawImage(pic, -R, -R, 2 * R, 2 * R); ctx.restore();
        drawn++;
      }
    }
    ctx.globalAlpha = 1;
    return drawn;
  }
  // Turning parts (a Round turns the map picture about its middle, a Box rolls it in a loop the way it was dragged).
  // Steady: at Speed. Ticking: a step a second with a little overshoot. Windmill: with the map's wind, from an anchor the
  // GM stores whenever the wind or the Speed changes (fx.anc: { at (ms), a (turns then), r0, r1 (turns a second then, and
  // where it is heading) }), so both screens show the same angle and nothing jumps. Angles in turns (1 = once round)
  const MILL_TAU = 1.6; // seconds the sails take to follow a change of wind (as the trees)
  const millRate = (strength) => 0.045 * Math.max(0, (strength ?? 1) - 0.15); // turns a second at a wind strength (a breeze: about 26 s a turn; a storm: 10 s)
  function millTurns(anc, nowMs) { // the rate eases from r0 to r1
    const dt = Math.max(0, (nowMs - anc.at) / 1000); const r0 = anc.r0 || 0; const r1 = anc.r1 || 0;
    return (anc.a || 0) + r1 * dt + (r0 - r1) * MILL_TAU * (1 - Math.exp(-dt / MILL_TAU));
  }
  function turnsOf(fx, t, nowMs) {
    const spin = fx.spin === -1 ? -1 : 1; const v = fx.speed ?? 1;
    if (fx.variant === 'windmill') return spin * (fx.anc ? millTurns(fx.anc, nowMs) : millRate(Wd().strength) * v * (nowMs / 1000));
    const T = t * v; // (t is the effects' clock)
    if (fx.variant === 'ticking') { const k = Math.floor(T); const f = T - k; const e = f < 0.3 ? 1 + 0.12 * Math.sin((f / 0.3) * Math.PI) * (1 - f / 0.3) - Math.pow(1 - f / 0.3, 3) : 1; return (spin * (k + e)) / 12; }
    return spin * T * 0.08;
  }
  // the anchor to store now, heading for the rate r1 (the GM sends it when the wind or the Speed changes)
  function millAnchor(fx, nowMs, r1) {
    const A = fx.anc;
    const a = A ? millTurns(A, nowMs) : r1 * (nowMs / 1000);
    const r0 = A ? (A.r1 || 0) + ((A.r0 || 0) - (A.r1 || 0)) * Math.exp(-Math.max(0, (nowMs - A.at) / 1000) / MILL_TAU) : r1;
    return { at: Math.round(nowMs), a: Math.round((((a % 1) + 1) % 1) * 1e5) / 1e5, r0: Math.round(r0 * 1e5) / 1e5, r1: Math.round(r1 * 1e5) / 1e5 };
  }
  const turnSrc = new Map();
  // the map picture under a part, copied once (every frame for a video map), in device pixels
  function underPic(id, ctx, bg, P) {
    const el = bg && bg.el; if (!el) return null;
    const video = el.tagName === 'VIDEO';
    if (video ? el.readyState < 2 : !(el.complete && el.naturalWidth)) return null;
    const m = ctx.getTransform();
    const key = `${bg.key}|${m.a.toFixed(5)},${m.e.toFixed(2)},${m.f.toFixed(2)}|${P.x},${P.y},${P.w},${P.h}|${bg.x},${bg.y},${bg.w},${bg.h},${bg.turn || 0}`;
    let e = turnSrc.get(id);
    if (!e) { e = { key: '', c: document.createElement('canvas') }; turnSrc.set(id, e); if (turnSrc.size > 30) turnSrc.delete(turnSrc.keys().next().value); }
    if (video || e.key !== key) {
      const src = e.c; if (src.width !== P.w || src.height !== P.h) { src.width = P.w; src.height = P.h; }
      const g = src.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, P.w, P.h);
      g.setTransform(m.a, m.b, m.c, m.d, m.e - P.x, m.f - P.y);
      if (bg.turn) { const bx = bg.x + bg.w / 2; const by = bg.y + bg.h / 2; g.translate(bx, by); g.rotate((bg.turn * Math.PI) / 180); g.translate(-bx, -by); }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      try { g.drawImage(el, bg.x, bg.y, bg.w, bg.h); } catch { return null; }
      e.key = video ? '' : key;
    }
    return e.c;
  }
  // ctx: the Sway layer in map units; fx in map units; cell: map units in a square (its outline strokes: a Round has many corners, a Box four)
  function turnPart(ctx, fx, t, bg, cell = 1) {
    const { scratch } = F();
    const m = ctx.getTransform(); const W = ctx.canvas.width; const H = ctx.canvas.height;
    const turns = turnsOf(fx, t, Date.now()); let n = 0;
    (fx.strokes || []).forEach((st, si) => {
      if (!st.poly || st.cut || !st.pts || st.pts.length < 8) return;
      const q = st.pts; const k = q.length / 2;
      let cx = 0; let cy = 0; let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (let i = 0; i < q.length; i += 2) { cx += q[i]; cy += q[i + 1]; x0 = Math.min(x0, q[i]); y0 = Math.min(y0, q[i + 1]); x1 = Math.max(x1, q[i]); y1 = Math.max(y1, q[i + 1]); }
      cx /= k; cy /= k;
      const round = k > 6;
      const dx0 = m.a * x0 + m.e; const dy0 = m.d * y0 + m.f; const dx1 = m.a * x1 + m.e; const dy1 = m.d * y1 + m.f;
      const P = { x: Math.max(0, Math.floor(dx0 - 2)), y: Math.max(0, Math.floor(dy0 - 2)) };
      P.w = Math.min(W, Math.ceil(dx1 + 2)) - P.x; P.h = Math.min(H, Math.ceil(dy1 + 2)) - P.y;
      if (P.w <= 4 || P.h <= 4) return;
      const src = round ? underPic(`${fx.id}|${si}`, ctx, bg, P) : null; if (round && !src) return;
      const sc = scratch(18, W, H, P); const g = sc.g;
      const A = Math.min(1, fx.intensity ?? 1);
      if (round) {
        const R = ((x1 - x0 + y1 - y0) / 4) * m.a; const ccx = m.a * cx + m.e; const ccy = m.d * cy + m.f;
        g.save(); g.translate(ccx, ccy); g.rotate(turns * TAU); g.translate(-ccx, -ccy);
        g.drawImage(src, P.x, P.y); g.restore(); // (the circle lies inside the square however it is turned)
        // a soft edge, about 3 % of the radius
        g.globalCompositeOperation = 'destination-in';
        const gr = g.createRadialGradient(ccx, ccy, R * 0.94, ccx, ccy, R); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(P.x, P.y, P.w, P.h); g.globalCompositeOperation = 'source-over';
      } else {
        // a Box: the picture flows through it the way it was dragged. Two copies slide a short way each and fade into
        // each other (as the swirl does), so there is never a seam
        const ln = st.line; const horiz = ln ? Math.abs(ln[2] - ln[0]) >= Math.abs(ln[3] - ln[1]) : P.w >= P.h;
        const sgn = ln ? Math.sign(horiz ? ln[2] - ln[0] : ln[3] - ln[1]) || 1 : 1;
        const M = Math.max(8, 0.6 * (cell || 1) * m.a); // device pixels one copy slides
        const Q = { x: Math.max(0, P.x - (horiz ? Math.ceil(M) : 0)), y: Math.max(0, P.y - (horiz ? 0 : Math.ceil(M))) };
        Q.w = Math.min(W, P.x + P.w + (horiz ? Math.ceil(M) : 0)) - Q.x; Q.h = Math.min(H, P.y + P.h + (horiz ? 0 : Math.ceil(M))) - Q.y;
        const wide = underPic(`${fx.id}|${si}|box`, ctx, bg, Q); if (!wide) return;
        const ph0 = turns * 10 * sgn;
        g.save(); g.beginPath(); g.rect(P.x, P.y, P.w, P.h); g.clip();
        for (const [off, top] of [[0.5, false], [0, true]]) {
          const ph = (((ph0 + off) % 1) + 1) % 1; const d = (ph - 0.5) * M;
          g.globalAlpha = top ? 1 - Math.abs(2 * ph - 1) : 1;
          g.drawImage(wide, Q.x + (horiz ? d : 0), Q.y + (horiz ? 0 : d));
        }
        g.restore(); g.globalAlpha = 1;
        // feather the two ends
        g.globalCompositeOperation = 'destination-in';
        const L = horiz ? P.w : P.h;
        const gr = horiz ? g.createLinearGradient(P.x, 0, P.x + P.w, 0) : g.createLinearGradient(0, P.y, 0, P.y + P.h);
        const f = Math.min(0.15, 10 / L);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(f, 'rgba(0,0,0,1)'); gr.addColorStop(1 - f, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(P.x, P.y, P.w, P.h); g.globalCompositeOperation = 'source-over';
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = A; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sc.c, P.x, P.y, P.w, P.h, P.x, P.y, P.w, P.h); ctx.restore();
      n++;
    });
    return n;
  }

  // ---------- the hooks fx.js calls for presets it does not know ----------
  function emitter(ctx, fx, x, y, t, r, I, C) {
    switch (fx.preset) {
      case 'whirl': whirl(ctx, fx, x, y, t, r, I, C); return true;
      case 'geyser': geyser(ctx, fx, x, y, t, r, I, C); return true;
      // (second-bats-insects: painted creatures are pictures, not light: fx.js has set 'lighter', which made overlapping
      // birds brighter and drew them washed out on an opaque canvas)
      case 'circling': ctx.globalCompositeOperation = 'source-over'; circling(ctx, fx, x, y, t, r, I); return true; // (second-birds)
      case 'bats': ctx.globalCompositeOperation = 'source-over'; bats(ctx, fx, x, y, t, r, I); return true; // (second-bats-insects)
      case 'insects': ctx.globalCompositeOperation = 'source-over'; insects(ctx, fx, x, y, t, r, I); return true; // (second-bats-insects)
      case 'devil': devil(ctx, fx, x, y, t, r, I); return true; // (second-sun-sand-gears)
      default: return false;
    }
  }
  function region(ctx, fx, t, o) {
    switch (fx.preset) {
      case 'rapids': rapids(ctx, fx, t, o); return true;
      case 'bubbling': bubbling(ctx, fx, t, o); return true;
      case 'fish': fish(ctx, fx, t, o); return true; // (second-ground-life)
      case 'critters': critters(ctx, fx, t, o); return true; // (second-ground-life)
      case 'dapple': dapple(ctx, fx, t, o); return true; // (second-sun-sand-gears)
      case 'drift': drift(ctx, fx, t, o); return true; // (second-sun-sand-gears)
      default: return false;
    }
  }
  // how far into an eruption a geyser is right now (0 before and after, for a sound or the TV's stats)
  function erupting(fx, t) { const c = geyserState(fx, t * (fx.speed ?? 1)); return c.since < 4.5 ? 1 : 0; }
  // a moment (seconds, at speed 1) when this geyser is `since` seconds into an eruption (for still pictures)
  function eruptionAt(fx, since = 1.2) { for (let t = 0; t < GEYSER_PER * 3; t += 0.05) if (Math.abs(geyserState(fx, t).since - since) < 0.03) return t; return 0; }

  return { emitter, region, swirl, wind, cycle, erupting, eruptionAt, GEYSER_PER, scene, sky, burst, ready, SPR, FLOCKS, CIRCLERS, SWARMS, moths, streamAt, STREAM_PER, GROUND, FISH, CRITS, tumble, turnPart, turnsOf, millAnchor, millRate, devilAt, tourOf }; // (second-ground-life: GROUND, FISH, CRITS; second-sun-sand-gears: tumble … millRate) // (second-birds: scene … CIRCLERS; second-bats-insects: SWARMS … STREAM_PER)
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Creatures;
