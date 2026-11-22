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

  // ---------- the hooks fx.js calls for presets it does not know ----------
  function emitter(ctx, fx, x, y, t, r, I, C) {
    switch (fx.preset) {
      case 'whirl': whirl(ctx, fx, x, y, t, r, I, C); return true;
      case 'geyser': geyser(ctx, fx, x, y, t, r, I, C); return true;
      default: return false;
    }
  }
  function region(ctx, fx, t, o) {
    switch (fx.preset) {
      case 'rapids': rapids(ctx, fx, t, o); return true;
      case 'bubbling': bubbling(ctx, fx, t, o); return true;
      default: return false;
    }
  }
  // how far into an eruption a geyser is right now (0 before and after, for a sound or the TV's stats)
  function erupting(fx, t) { const c = geyserState(fx, t * (fx.speed ?? 1)); return c.since < 4.5 ? 1 : 0; }
  // a moment (seconds, at speed 1) when this geyser is `since` seconds into an eruption (for still pictures)
  function eruptionAt(fx, since = 1.2) { for (let t = 0; t < GEYSER_PER * 3; t += 0.05) if (Math.abs(geyserState(fx, t).since - since) < 0.03) return t; return 0; }

  return { emitter, region, swirl, wind, cycle, erupting, eruptionAt, GEYSER_PER };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Creatures;
