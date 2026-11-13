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
    { id: 'earthquake', label: 'Earthquake', icon: 'wave-saw-tool', dur: 3400, spot: false, tip: 'The map shakes, dust falls', words: ['earthquake', 'quake', 'rumble', 'tremor'] },
    { id: 'explosion', label: 'Explosion', icon: 'bomb', dur: 2800, spot: true, tip: 'A white flash, a shockwave and embers', words: ['explosion', 'explode', 'blast', 'boom', 'bomb'] },
    { id: 'blood', label: 'Blood splatter', icon: 'droplets', dur: 6500, spot: true, tip: 'Splats hit, drip, dry and fade', words: ['blood', 'splat', 'gore', 'squelch'] },
    { id: 'gas', label: 'Poison gas', icon: 'biohazard', dur: null, spot: true, tip: 'Green gas pours in and hangs until you stop it', words: ['gas', 'hiss', 'poison', 'toxic'] },
    { id: 'lightning', label: 'Lightning', icon: 'bolt', dur: 1200, spot: false, tip: 'One flash, thunder follows', words: [] },
    { id: 'roar', label: 'Dragon roar', icon: 'dragon', dur: 3400, spot: false, tip: 'A hard shake and a fiery edge', words: ['dragon', 'roar'] },
    { id: 'dread', label: 'Dread', icon: 'activity-heartbeat', dur: null, spot: false, tip: 'The light drains, a dark edge beats like a heart', words: ['heartbeat', 'heart', 'dread', 'fear'] },
    { id: 'frost', label: 'Frost', icon: 'snowflake', dur: null, spot: false, tip: 'Ice creeps in from the edges', words: ['frost', 'freeze', 'ice', 'cold'] },
    { id: 'holy', label: 'Holy light', icon: 'sun-high', dur: 4800, spot: true, tip: 'Golden rays and rising motes', words: ['holy', 'choir', 'angel', 'heaven', 'divine', 'bless'] },
    { id: 'madness', label: 'Madness', icon: 'spiral', dur: null, spot: false, tip: 'Colours drift, ink crawls at the edges', words: ['whisper', 'madness', 'insanity', 'psychic', 'voices'] },
    { id: 'timestop', label: 'Time stop', icon: 'clock-pause', dur: null, spot: false, tip: 'Colours drain and every effect stands still', words: ['clock', 'tick', 'time'] },
    { id: 'nat20', label: 'Natural 20', icon: 'confetti', dur: 2800, spot: false, tip: 'Gold sparks burst across the table', words: ['fanfare', 'victory', 'success', 'tada', 'critical'] },
    // Beta 2
    { id: 'teleport', label: 'Teleport', icon: 'sparkle', dur: 2000, spot: true, tip: 'Sparks pull inward and vanish in a flash: Misty Step, something appearing', words: ['teleport', 'blink', 'warp', 'shimmer'] },
    { id: 'puff', label: 'Smoke puff', icon: 'cloud', dur: 2400, spot: true, tip: 'A puff of smoke: someone vanishes or appears', words: ['puff', 'poof', 'smoke', 'vanish'] },
    { id: 'lightsout', label: 'Lights out', icon: 'bulb-off', dur: null, spot: false, tip: 'Every light and flame gutters and dies, one by one; they catch again when you stop it', words: ['gust', 'wind', 'extinguish', 'lights out'] },
    { id: 'rockfall', label: 'Rockfall', icon: 'meteor', dur: 3200, spot: true, tip: 'Stones fall, dust bursts up, the ground jolts', words: ['rockfall', 'cave-in', 'collapse', 'rubble', 'rocks'] },
    { id: 'flood', label: 'Flood', icon: 'ripple-up', dur: 7500, spot: false, tip: 'A wave sweeps across the table and drains away', words: ['flood', 'wave', 'water', 'rush', 'tide'] },
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
    let k = inMs ? smooth(age / inMs) : 1;
    if (m.stop) k *= 1 - smooth((now - m.stop) / FADE_OUT);
    if (d && d.dur && !m.stop) { const left = m.t0 + d.dur - now; if (left < 900) k *= smooth(left / 900); }
    return clamp(k, 0, 1);
  }
  const alive = (m, now) => { const d = BY[m.id]; if (!d) return false; if (m.stop) return now - m.stop < FADE_OUT; return !d.dur || now - m.t0 < d.dur; };

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
        const e = (age < 0.12 ? age / 0.12 : 1) * (1 - age / dur) ** 1.4 * amp;
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
  function draw(ctx, W, H, list, now, at, { gm = false } = {}) {
    for (const m of list) {
      if (!alive(m, now)) continue;
      const fn = DRAW[m.id];
      if (!fn) continue;
      const k = level(m, now) * (gm ? 0.75 : 1);
      if (k <= 0.003) continue;
      const p = m.x != null && at ? at(m) : null;
      ctx.save();
      fn(ctx, { W, H, age: (now - m.t0) / 1000, k, s: m.seed || 1, p, cx: p ? p.x : W / 2, cy: p ? p.y : H / 2, min: Math.min(W, H) });
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

  const DRAW = {
    // dust puffs where the ceiling cracks, small stones, the light trembling
    earthquake(ctx, P) {
      const { W, H, age, k, s } = P;
      ctx.fillStyle = `rgba(0,0,0,${(0.16 * k * Math.max(0, 1 - age / 3) * (0.6 + 0.4 * Math.sin(age * 23 + s))).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const dust = sprite(214, 198, 172);
      const n = Math.round(56 * Q);
      for (let i = 0; i < n; i++) {
        const born = hs(s + i * 1.3) * 2.2;
        const u = (age - born) / 1.6;
        if (u < 0 || u > 1) continue;
        const x = hs(s + i * 3.7) * W; const y = hs(s + i * 5.9) * H;
        blob(ctx, dust, x, y, 0.3 + ease(u) * (0.8 + hs(i * 2.2) * 0.9), (1 - u) * 0.62 * k);
        // a few pebbles bounce out of the puff
        ctx.fillStyle = 'rgba(70,60,48,0.9)';
        for (let j = 0; j < 3; j++) {
          const a = hs(i * 9 + j) * TAU; const d = ease(u) * (0.4 + hs(i * 4 + j) * 0.5);
          ctx.globalAlpha = (1 - u) * k;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.035 + hs(i + j * 5) * 0.03, 0, TAU); ctx.fill();
        }
      }
    },
    // a white flash, a fireball, a shockwave ring, embers and smoke
    explosion(ctx, P) {
      const { W, H, age, k, s, cx, cy, min } = P;
      const flash = age < 0.07 ? 0.85 : Math.max(0, 0.85 * (1 - (age - 0.07) / 0.45));
      if (flash > 0) { ctx.fillStyle = `rgba(255,240,215,${(flash * k).toFixed(3)})`; ctx.fillRect(-1, -1, W + 2, H + 2); }
      ctx.globalCompositeOperation = 'lighter';
      const fr = ease(age / 0.35) * min * 0.22;
      const fa = Math.max(0, 1 - Math.max(0, age - 0.25) / 1.1);
      if (fa > 0 && fr > 0.05) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
        g.addColorStop(0, `rgba(255,255,230,${0.95 * fa * k})`);
        g.addColorStop(0.3, `rgba(255,200,80,${0.8 * fa * k})`);
        g.addColorStop(0.7, `rgba(240,90,20,${0.45 * fa * k})`);
        g.addColorStop(1, 'rgba(160,30,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, fr, 0, TAU); ctx.fill();
      }
      const ring = ease(age / 0.9) * Math.hypot(W, H) * 0.55;
      const ra = Math.max(0, 1 - age / 0.9);
      if (ra > 0) {
        ctx.strokeStyle = `rgba(255,236,200,${0.55 * ra * k})`;
        ctx.lineWidth = 0.12 + 0.3 * ra;
        ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU); ctx.stroke();
      }
      const ember = sprite(255, 150, 40, 0.3);
      const n = Math.round(90 * Q);
      for (let i = 0; i < n; i++) {
        const a = hs(s + i * 1.7) * TAU; const v = 3 + hs(s + i * 2.9) * 9;
        const u = age / (1.4 + hs(i * 3.3) * 1.2);
        if (u > 1) continue;
        const d = v * (1 - Math.exp(-age * 2.2)) / 2.2 * 1.6;
        blob(ctx, ember, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.07 + hs(i) * 0.07, (1 - u) * k);
      }
      ctx.globalCompositeOperation = 'source-over';
      const smoke = sprite(70, 66, 62);
      for (let i = 0; i < Math.round(14 * Q); i++) {
        const u = (age - 0.35) / 2.3;
        if (u < 0 || u > 1) continue;
        const a = hs(s + i * 4.1) * TAU; const d = ease(u) * min * (0.1 + hs(i * 6.1) * 0.12);
        blob(ctx, smoke, cx + Math.cos(a) * d, cy + Math.sin(a) * d, min * (0.05 + ease(u) * 0.09), Math.sin(u * Math.PI) * 0.45 * k);
      }
    },
    // splats land one after another, drip outward, dry darker and fade
    blood(ctx, P) {
      const { W, H, age, k, s, p } = P;
      const n = p ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const born = i * (p ? 0.09 : 0.16);
        const u = (age - born) / 0.14;
        if (u < 0) continue;
        const grow = ease(u);
        let x; let y;
        if (p) { const a = hs(s + i * 2.1) * TAU; const d = i ? 0.5 + hs(s + i) * 1.1 : 0; x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; }
        else {
          // mostly towards the edges and corners, out of the middle where the minis stand
          const e = hs(s + i * 7.3); const along = hs(s + i * 3.1);
          const band = 0.12 + hs(s + i * 5.5) * 0.18;
          if (e < 0.5) { x = along * W; y = e < 0.25 ? band * H : (1 - band) * H; } else { y = along * H; x = e < 0.75 ? band * W * 0.6 : (1 - band * 0.6) * W; }
        }
        const r = (p ? (i ? 0.5 : 1.15) : 0.85 + hs(s + i * 9.1) * 0.9) * (0.4 + 0.6 * grow);
        const dry = clamp((age - 2.2) / 3, 0, 1);
        const col = `rgb(${Math.round(120 - 55 * dry)},${Math.round(8 + 4 * dry)},${Math.round(10 + 2 * dry)})`;
        ctx.globalAlpha = k * (0.92 - 0.25 * dry);
        ctx.fillStyle = col;
        lumpy(ctx, x, y, r, s + i * 13, 16, 0.45);
        ctx.fill();
        // droplets thrown out around it, and runs that stretch outward
        const out = Math.atan2(y - H / 2, x - W / 2);
        for (let j = 0; j < 10; j++) {
          const a = (p ? hs(s + i * 31 + j) * TAU : out + (hs(s + i * 31 + j) - 0.5) * 2.2);
          const d = r * (1.15 + hs(s + i * 17 + j) * 1.6) * grow;
          const dr = r * (0.06 + hs(s + i * 23 + j) * 0.12);
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, dr, 0, TAU); ctx.fill();
        }
        const run = clamp((age - born - 0.4) / 2.5, 0, 1);
        if (run > 0) {
          for (let j = 0; j < 3; j++) {
            const a = out + (hs(s + i * 41 + j) - 0.5) * 0.9;
            const len = r * (0.6 + hs(s + i * 43 + j) * 1.2) * ease(run);
            const w = r * (0.12 + hs(s + i * 47 + j) * 0.1);
            ctx.save();
            ctx.translate(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
            ctx.rotate(a);
            ctx.beginPath(); ctx.ellipse(len / 2, 0, len / 2 + w, w, 0, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(len + w * 0.4, 0, w * 1.25, 0, TAU); ctx.fill();
            ctx.restore();
          }
        }
        // a wet shine while it is fresh
        if (dry < 0.6) {
          ctx.globalAlpha = k * 0.22 * (1 - dry / 0.6);
          ctx.fillStyle = '#ff9a8a';
          ctx.beginPath(); ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.28, r * 0.12, -0.6, 0, TAU); ctx.fill();
        }
      }
    },
    // green gas rolls in from the edges (or swells from a spot) and hangs, swirling slowly
    gas(ctx, P) {
      const { W, H, age, k, s, p, min } = P;
      ctx.fillStyle = `rgba(90,150,40,${(0.07 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const cols = [sprite(124, 182, 52), sprite(92, 150, 38), sprite(170, 214, 90)];
      const n = Math.round((p ? 60 : 110) * Q);
      for (let i = 0; i < n; i++) {
        const c = cols[i % 3];
        const sw = 0.25 + hs(i * 1.9) * 0.35;
        let x; let y; let r;
        if (p) {
          const R = Math.min(min * 0.33, 0.8 + age * 1.6);
          const a = hs(s + i * 2.3) * TAU + age * sw * (hs(i) < 0.5 ? 1 : -1) * 0.4;
          const d = Math.sqrt(hs(s + i * 5.1)) * R;
          x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
          r = 0.6 + hs(i * 3.3) * 1.2 + R * 0.12;
        } else {
          // a band along the edges that creeps inward
          const depth = Math.min(min * 0.28, 0.5 + age * 0.7);
          const e = i % 4; const along = hs(s + i * 3.7);
          const inw = Math.sqrt(hs(s + i * 6.1)) * depth;
          const wob = Math.sin(age * sw + i) * 0.4;
          if (e === 0) { x = along * W + wob; y = inw; } else if (e === 1) { x = along * W + wob; y = H - inw; } else if (e === 2) { x = inw; y = along * H + wob; } else { x = W - inw; y = along * H + wob; }
          r = 0.9 + hs(i * 3.3) * 1.5;
        }
        blob(ctx, c, x, y, r, (0.22 + hs(i * 7.7) * 0.16) * k);
      }
    },
    // the fiery edge of a dragon's roar
    roar(ctx, P) {
      const { W, H, age, k, s } = P;
      const pulse = 0.65 + 0.35 * Math.sin(age * 9);
      const fade = Math.max(0, 1 - Math.max(0, age - 1.8) / 1.4);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(255,90,20,0)');
      g.addColorStop(0.6, `rgba(220,60,10,${0.25 * pulse * fade * k})`);
      g.addColorStop(1, `rgba(120,10,0,${0.7 * pulse * fade * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      ctx.globalCompositeOperation = 'lighter';
      const ember = sprite(255, 130, 30, 0.3);
      const n = Math.round(70 * Q);
      for (let i = 0; i < n; i++) {
        const u = fract(age / (1.2 + hs(i) * 0.8) + hs(s + i * 2.7));
        const e = i % 4; const along = hs(s + i * 3.1) * (e < 2 ? W : H);
        const d = u * (1.2 + hs(i * 5.3) * 1.8);
        const x = e === 2 ? d : e === 3 ? W - d : along; const y = e === 0 ? d : e === 1 ? H - d : along;
        blob(ctx, ember, x, y, 0.05 + hs(i * 7) * 0.06, (1 - u) * fade * k);
      }
    },
    // the light drains; a dark edge beats like a heart (lub-dub)
    dread(ctx, P) {
      const { W, H, age, k } = P;
      const per = 1.15; const ph = fract(age / per);
      const beat = Math.exp(-((ph - 0.08) ** 2) / 0.0018) + 0.65 * Math.exp(-((ph - 0.27) ** 2) / 0.0022);
      const inner = Math.min(W, H) * (0.36 - 0.07 * beat);
      const g = ctx.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, `rgba(20,0,0,${(0.45 + 0.15 * beat) * k})`);
      g.addColorStop(1, `rgba(40,0,0,${(0.85 + 0.1 * beat) * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      ctx.fillStyle = `rgba(120,0,0,${(0.08 * beat * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
    },
    // ice creeps in from the edges in an uneven, smooth band, with fine crystals and a glitter
    frost(ctx, P) {
      const { W, H, age, k, s } = P;
      ctx.fillStyle = `rgba(160,205,255,${(0.08 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      const grow = ease(age / 4);
      const edges = [[0, 0, W, 0, 0, 1], [0, H, W, H, 0, -1], [0, 0, 0, H, 1, 0], [W, 0, W, H, -1, 0]];
      edges.forEach(([x0, y0, x1, y1, nx, ny], e) => {
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(24, Math.round(L * 5));
        // how deep the ice reaches here: big slow waves, smaller ones, a fine ragged edge
        const depthAt = (u) => grow * (0.35 + 1.7 * vnoise(u * L * 0.18, s + e * 31) ** 1.5 + 0.45 * vnoise(u * L * 0.9, s + e * 57) + 0.08 * hs(Math.floor(u * L * 9) + e * 7));
        for (const [shrink, alpha] of [[1, 0.35], [0.72, 0.5], [0.42, 0.65]]) {
          const g = ctx.createLinearGradient(x0, y0, x0 + nx * 2.4, y0 + ny * 2.4);
          g.addColorStop(0, `rgba(240,250,255,${alpha * k})`);
          g.addColorStop(1, `rgba(170,215,255,${alpha * 0.25 * k})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          for (let i = 0; i <= n; i++) { const u = i / n; const d = depthAt(u) * shrink; ctx.lineTo(x0 + (x1 - x0) * u + nx * d, y0 + (y1 - y0) * u + ny * d); }
          ctx.lineTo(x1, y1);
          ctx.closePath();
          ctx.fill();
        }
        // crystals: fine branches growing in from the edge
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * k})`;
        ctx.lineWidth = 0.02;
        ctx.beginPath();
        const nc = Math.round(L * 1.6 * Q);
        for (let i = 0; i < nc; i++) {
          const u = hs(s + e * 13 + i * 1.9);
          const bx = x0 + (x1 - x0) * u; const by = y0 + (y1 - y0) * u;
          const len = depthAt(u) * (0.6 + hs(i * 3.1 + e) * 0.6);
          const a = Math.atan2(ny, nx) + (hs(i * 5.7 + e) - 0.5) * 0.9;
          const ex = bx + Math.cos(a) * len; const ey = by + Math.sin(a) * len;
          ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
          for (const f of [0.35, 0.6, 0.8]) {
            const mx = bx + Math.cos(a) * len * f; const my = by + Math.sin(a) * len * f;
            const bl = len * (0.28 - f * 0.18);
            for (const side of [-1, 1]) { ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a + side * 0.75) * bl, my + Math.sin(a + side * 0.75) * bl); }
          }
        }
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'lighter';
      const glint = sprite(220, 240, 255, 0.4);
      for (let i = 0; i < Math.round(50 * Q); i++) {
        const tw = Math.max(0, Math.sin(age * (2 + hs(i) * 3) + i * 7));
        const e = i % 4; const along = hs(s + i * 2.3); const d = hs(s + i * 4.4) * 1.4 * grow;
        const x = e < 2 ? along * W : e === 2 ? d : W - d; const y = e >= 2 ? along * H : e === 0 ? d : H - d;
        blob(ctx, glint, x, y, 0.07, tw * 0.9 * k);
      }
    },
    // golden rays turning slowly around a warm glow, motes rising out of it
    holy(ctx, P) {
      const { age, k, s, cx, cy, min } = P;
      ctx.globalCompositeOperation = 'lighter';
      const R = min * 0.62;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
      g.addColorStop(0, `rgba(255,236,170,${0.55 * k})`);
      g.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, TAU); ctx.fill();
      const rays = 11;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + age * 0.12 + hs(s + i) * 0.3;
        const w = 0.08 + hs(s + i * 3) * 0.08;
        const len = R * (0.7 + 0.3 * hs(s + i * 5)) * ease(age / 0.8);
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
        gr.addColorStop(0, `rgba(255,230,150,${0.42 * k})`);
        gr.addColorStop(1, 'rgba(255,210,120,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, len, a - w, a + w); ctx.closePath(); ctx.fill();
      }
      const mote = sprite(255, 225, 140, 0.35);
      for (let i = 0; i < Math.round(60 * Q); i++) {
        const u = fract(age / (2 + hs(i) * 1.5) + hs(s + i * 2.1));
        const a = hs(s + i * 3.9) * TAU; const d = (0.2 + u) * R * 0.6;
        blob(ctx, mote, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.05 + hs(i * 3) * 0.05, Math.sin(u * Math.PI) * k);
      }
    },
    // ink crawls in at the edges and breathes
    madness(ctx, P) {
      const { W, H, age, k, s } = P;
      ctx.fillStyle = `rgba(30,0,40,${(0.12 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      ctx.fillStyle = `rgba(14,4,22,${(0.85 * k).toFixed(3)})`;
      ctx.strokeStyle = `rgba(150,60,200,${(0.45 * k).toFixed(3)})`;
      ctx.lineWidth = 0.05;
      ctx.shadowColor = `rgba(130,40,190,${(0.8 * k).toFixed(3)})`;
      ctx.shadowBlur = 12;
      const n = Math.round(26 * Q) + 6;
      for (let i = 0; i < n; i++) {
        const e = i % 4; const along = hs(s + i * 2.9) * (e < 2 ? W : H);
        const breathe = 0.5 + 0.5 * Math.sin(age * (0.7 + hs(i) * 0.6) + i);
        const len = (0.8 + hs(s + i * 4.1) * 2.2) * (0.6 + 0.4 * breathe) * ease(age / 2);
        const w = 0.18 + hs(i * 6.7) * 0.25;
        // inward from the edge (n), and along it (t)
        const nx = e === 2 ? 1 : e === 3 ? -1 : 0; const ny = e === 0 ? 1 : e === 1 ? -1 : 0;
        const tx = ny !== 0 ? 1 : 0; const ty = nx !== 0 ? 1 : 0;
        const bx = e === 2 ? 0 : e === 3 ? W : along; const by = e === 0 ? 0 : e === 1 ? H : along;
        const steps = 12;
        const left = []; const right = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          const sway = Math.sin(t * 5 + age * 1.6 + i) * 0.35 * t;
          const x = bx + nx * len * t + tx * sway; const y = by + ny * len * t + ty * sway;
          const ww = w * (1 - t * 0.92);
          left.push([x + tx * ww, y + ty * ww]); right.push([x - tx * ww, y - ty * ww]);
        }
        // a tapering tendril
        ctx.beginPath();
        left.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
    // one pale ring as time stops; the rest is the grey filter and the stillness
    timestop(ctx, P) {
      const { W, H, age, k } = P;
      ctx.fillStyle = `rgba(150,180,230,${(0.08 * k).toFixed(3)})`;
      ctx.fillRect(-1, -1, W + 2, H + 2);
      if (age < 1.2) {
        const r = ease(age / 1.1) * Math.hypot(W, H) * 0.6;
        ctx.strokeStyle = `rgba(220,235,255,${(0.6 * (1 - age / 1.2) * k).toFixed(3)})`;
        ctx.lineWidth = 0.18;
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.stroke();
      }
    },
    // gold sparks burst from the middle, with a golden ring
    nat20(ctx, P) {
      const { W, H, age, k, s, min } = P;
      const cx = W / 2; const cy = H / 2;
      const flash = Math.max(0, 0.3 * (1 - age / 0.5));
      if (flash > 0) { ctx.fillStyle = `rgba(255,220,120,${(flash * k).toFixed(3)})`; ctx.fillRect(-1, -1, W + 2, H + 2); }
      ctx.globalCompositeOperation = 'lighter';
      const rr = ease(age / 1.2) * min * 0.5;
      ctx.strokeStyle = `rgba(255,215,110,${(0.7 * Math.max(0, 1 - age / 1.4) * k).toFixed(3)})`;
      ctx.lineWidth = 0.14;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      const n = Math.round(150 * Q);
      for (let i = 0; i < n; i++) {
        const a = hs(s + i * 1.3) * TAU; const v = 4 + hs(s + i * 2.1) * 10;
        const life = 1.6 + hs(i * 3.9) * 1.1;
        const u = age / life;
        if (u > 1) continue;
        const d = (v * (1 - Math.exp(-age * 2.4))) / 2.4 * 1.5;
        const x = cx + Math.cos(a) * d; const y = cy + Math.sin(a) * d;
        const tw = 0.6 + 0.4 * Math.sin(age * 18 + i);
        const r = (0.06 + hs(i * 5) * 0.06) * tw;
        ctx.globalAlpha = (1 - u) * k;
        ctx.fillStyle = i % 3 ? '#ffd75e' : '#fff2c0';
        // a little four-pointed star
        ctx.beginPath();
        ctx.moveTo(x, y - r * 2.2); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 2.2, y); ctx.lineTo(x + r * 0.5, y + r * 0.5);
        ctx.lineTo(x, y + r * 2.2); ctx.lineTo(x - r * 0.5, y + r * 0.5); ctx.lineTo(x - r * 2.2, y); ctx.lineTo(x - r * 0.5, y - r * 0.5);
        ctx.closePath(); ctx.fill();
      }
    },
    // ---------- Beta 2 ----------
    // sparks spiral in to a point and vanish in a flash; a few motes linger
    teleport(ctx, P) {
      const { age, k, s, cx, cy } = P;
      ctx.globalCompositeOperation = 'lighter';
      const R = 1.7; const pull = 0.85;
      const spark = sprite(170, 190, 255, 0.35); const core = sprite(235, 240, 255, 0.4);
      if (age < pull) {
        const u = age / pull;
        blob(ctx, sprite(140, 150, 255), cx, cy, 0.4 + u * 1.1, 0.5 * u * k);
        blob(ctx, core, cx, cy, 0.12 + u * 0.3, 0.8 * u * k);
        // sparks streaking inward along a spiral, each with a short tail
        const n = Math.round(70 * Q);
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const v = clamp(u * (0.8 + hs(s + i) * 0.4), 0, 1);
          const P = (q) => { const a = hs(s + i * 2.3) * TAU + q * 2.6; const d = R * (0.5 + 0.7 * hs(s + i * 3.7)) * (1 - q * q); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; };
          const [x, y] = P(v); const [x0, y0] = P(Math.max(0, v - 0.12));
          ctx.globalAlpha = Math.min(1, (0.5 + 0.5 * v) * k);
          ctx.strokeStyle = i % 3 ? 'rgba(170,190,255,0.9)' : 'rgba(240,245,255,1)';
          ctx.lineWidth = 0.035 + 0.02 * hs(i);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
          blob(ctx, i % 3 ? spark : core, x, y, 0.07 + 0.04 * hs(i), (0.5 + 0.5 * v) * k);
        }
      } else {
        const v = (age - pull) / 0.7;
        if (v < 1) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.6 + v * 2);
          g.addColorStop(0, `rgba(245,248,255,${(1 * (1 - v) * k).toFixed(3)})`);
          g.addColorStop(0.35, `rgba(160,170,255,${(0.65 * (1 - v) * k).toFixed(3)})`);
          g.addColorStop(1, 'rgba(120,120,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(cx, cy, 0.6 + v * 2, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(215,225,255,${(0.85 * (1 - v) * k).toFixed(3)})`;
          ctx.lineWidth = 0.1 * (1 - v) + 0.015;
          ctx.beginPath(); ctx.arc(cx, cy, 0.3 + ease(v) * 2.2, 0, TAU); ctx.stroke();
        }
        const n = Math.round(24 * Q);
        for (let i = 0; i < n; i++) {
          const w = (age - pull) / (0.8 + hs(i * 3) * 0.6);
          if (w > 1) continue;
          const a = hs(s + i * 5.1) * TAU; const d = 0.2 + ease(w) * (0.6 + hs(s + i) * 0.8);
          blob(ctx, spark, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.04, (1 - w) * 0.8 * k);
        }
      }
    },
    // a puff of grey smoke swelling from a point, thinning out
    puff(ctx, P) {
      const { age, k, s, cx, cy } = P;
      if (age < 0.12) { ctx.fillStyle = `rgba(255,255,255,${(0.25 * (1 - age / 0.12) * k).toFixed(3)})`; ctx.beginPath(); ctx.arc(cx, cy, 0.9, 0, TAU); ctx.fill(); }
      const cols = [sprite(150, 150, 158), sprite(118, 116, 124), sprite(190, 188, 196)];
      const n = Math.round(26 * Q) + 6;
      for (let i = 0; i < n; i++) {
        const u = clamp(age / (1.6 + hs(i * 2.7) * 0.8), 0, 1);
        if (u >= 1) continue;
        const a = hs(s + i * 1.9) * TAU + u * 0.6 * (hs(i) < 0.5 ? 1 : -1);
        const d = ease(u) * (0.5 + hs(s + i * 3.1) * 1.1);
        blob(ctx, cols[i % 3], cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.35 + ease(u) * (0.6 + hs(i * 5) * 0.6), Math.min(1, (1 - u) * 1.6) * 0.42 * k);
      }
    },
    // a gust sweeps across as the lights die (the lights themselves go out in the light layer, scene-view.js)
    lightsout(ctx, P) {
      const { W, H, age, s } = P;
      const v = age / 1.6;
      if (v > 1) return;
      const side = Math.floor(hs(s + 0.3) * 4);
      const along = side < 2 ? W : H;
      const x = ease(v) * (along + 6) - 3;
      const horiz = side < 2;
      const dirx = side === 1 ? -1 : 1;
      const g = horiz
        ? ctx.createLinearGradient(dirx > 0 ? x - 3 : W - x + 3, 0, dirx > 0 ? x + 1 : W - x - 1, 0)
        : ctx.createLinearGradient(0, side === 3 ? H - x + 3 : x - 3, 0, side === 3 ? H - x - 1 : x + 1);
      const a = 0.22 * Math.sin(Math.PI * v);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, `rgba(4,6,12,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, W + 2, H + 2);
    },
    // stones fall (their shadows grow as they come), land, dust bursts up, pebbles scatter; they lie a while
    rockfall(ctx, P) {
      const { age, k, s, cx, cy } = P;
      const n = 7;
      const rocks = [];
      for (let i = 0; i < n; i++) {
        const a = hs(s + i * 2.9) * TAU; const d = i ? 0.3 + hs(s + i * 4.3) * 1.1 : 0;
        const land = ROCK_HIT - 0.4 + hs(s + i * 6.1) * 0.4 + (i ? 0.05 : 0);
        rocks.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: (i ? 0.16 + hs(s + i * 7.7) * 0.2 : 0.36), land, i });
      }
      for (const R of rocks) {
        if (age < R.land) { // its shadow, growing darker as the stone comes down
          const u = clamp(age / R.land, 0, 1);
          ctx.globalAlpha = 0.55 * u * u * k;
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.ellipse(R.x, R.y, R.r * (2.4 - 1.4 * u), R.r * (2 - 1.1 * u), 0, 0, TAU); ctx.fill();
        }
      }
      const dust = sprite(158, 148, 134);
      for (const R of rocks) {
        const a = age - R.land;
        if (a < 0) continue;
        // the dust it throws up
        const n2 = Math.round(10 * Q) + 2;
        for (let j = 0; j < n2; j++) {
          const u = a / (1.4 + hs(R.i * 13 + j) * 0.9);
          if (u > 1) continue;
          const an = hs(s + R.i * 17 + j * 3.1) * TAU; const d = ease(u) * (0.3 + hs(R.i * 19 + j) * 0.6) * (R.r * 3);
          blob(ctx, dust, R.x + Math.cos(an) * d, R.y + Math.sin(an) * d, R.r * (1 + ease(u) * 2.4), (1 - u) * 0.5 * k);
        }
        // the stone: a rough grey lump with a lighter top
        ctx.globalAlpha = k;
        ctx.fillStyle = '#5b544c';
        lumpy(ctx, R.x, R.y, R.r, s + R.i * 23, 9, 0.5); ctx.fill();
        ctx.fillStyle = '#8a8178';
        lumpy(ctx, R.x - R.r * 0.15, R.y - R.r * 0.15, R.r * 0.55, s + R.i * 29, 7, 0.4); ctx.fill();
        // pebbles
        ctx.fillStyle = '#4a443e';
        for (let j = 0; j < 5; j++) {
          const u = clamp(a / 0.45, 0, 1);
          const an = hs(s + R.i * 31 + j) * TAU; const d = R.r * (1.2 + ease(u) * (1 + hs(R.i * 37 + j) * 2));
          ctx.beginPath(); ctx.arc(R.x + Math.cos(an) * d, R.y + Math.sin(an) * d, 0.025 + hs(R.i * 41 + j) * 0.035, 0, TAU); ctx.fill();
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
      // a point at distance d from the side the water comes from, w across it
      const pt = (d, w) => (side === 0 ? [d, w] : side === 1 ? [W - d, w] : side === 2 ? [w, d] : [w, H - d]);
      const front = (w) => reach - 0.5 + 0.5 * vnoise(w * 0.6 + age * 0.8, s) + 0.25 * vnoise(w * 2.1 - age * 1.3, s + 9);
      const steps = Math.max(24, Math.round(Wd * 3));
      ctx.beginPath();
      { const [x, y] = pt(-1, -1); ctx.moveTo(x, y); }
      for (let i = 0; i <= steps; i++) { const w = (i / steps) * (Wd + 2) - 1; const [x, y] = pt(front(w), w); ctx.lineTo(x, y); }
      { const [x, y] = pt(-1, Wd + 1); ctx.lineTo(x, y); }
      ctx.closePath();
      const [gx0, gy0] = pt(0, 0); const [gx1, gy1] = pt(Math.max(1, reach), 0);
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, `rgba(24,74,110,${(0.5 * A).toFixed(3)})`);
      g.addColorStop(1, `rgba(52,120,160,${(0.38 * A).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fill();
      // foam riding the front, and streaks in the water behind it
      ctx.lineCap = 'round';
      for (const [off, w0, al] of [[0, 0.32, 0.6], [0.05, 0.14, 0.9], [-0.3, 0.16, 0.45], [-0.9, 0.07, 0.25]]) {
        ctx.strokeStyle = `rgba(240,250,255,${(al * A).toFixed(3)})`;
        ctx.lineWidth = w0;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) { const w = (i / steps) * (Wd + 2) - 1; const [x, y] = pt(front(w) + off + 0.12 * Math.sin(w * 3 + age * 4), w); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      // streaks of foam carried along in the water behind the front
      ctx.strokeStyle = `rgba(220,240,255,${(0.35 * A).toFixed(3)})`;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (let i = 0; i < Math.round(40 * Q); i++) {
        const w = hs(s + i * 4.1) * Wd; const d0 = fract(hs(s + i * 6.7) + age * 0.25) * Math.max(0.5, reach - 0.6);
        const len = 0.4 + hs(i * 3.3) * 0.9;
        const [x0, y0] = pt(d0, w); const [x1, y1] = pt(Math.min(reach - 0.4, d0 + len), w + 0.1 * Math.sin(age + i));
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const spray = sprite(225, 242, 255, 0.35);
      const n = Math.round(80 * Q);
      for (let i = 0; i < n; i++) {
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
