// Dice on the TV: a dramatic roll, the wheel of luck and death saves (state.dice from main.js).
// One canvas over the whole table. Everything is drawn from the roll's start time, so it looks the same
// however late the window joins. All three are the same slot machine: a reel per die (stopping one after
// the other), one wide reel of the wheel's entries, one d20 reel for the death save; the times come from
// main.js (roll.stops, roll.reveal). The sounds (synth.js) come as the moments happen: the reels rattling
// and locking, the result.
// Results face both long sides of the table (players sit on both), or one side.
'use strict';

const DiceFX = (() => {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeBack = (u) => { u = clamp(u, 0, 1); const c = 1.7; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
  // a small seeded random, so every window draws the same reel
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  // the numbers 1..n in a mixed order (a reel that counts up would give the result away as it slows)
  function mixed(n, seed) {
    const R = rng(seed); const a = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function mount(el, { sound }) {
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    const ctx = cv.getContext('2d');
    let roll = null; let opts = { seats: 'both', hud: 1, volume: 0.7 };
    let raf = 0; let W = 0; let H = 0; let dpr = 1;
    const fired = new Set(); // sounds already played (roll id + moment)
    const stats = { frames: 0, kind: null, phase: null, ticks: 0, sounds: [], cells: [] };

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    }
    addEventListener('resize', resize);
    resize();

    function set(r, o = {}) {
      opts = { ...opts, ...o };
      if (r && (!roll || roll.id !== r.id)) { roll = r; stats.kind = r.kind; stats.ticks = 0; stats.sounds = []; stats.cells = []; start(); }
      else if (!r && roll) { roll = null; stats.kind = null; }
      el.classList.toggle('on', !!roll);
      if (!roll) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
    }
    function start() { if (!raf) raf = requestAnimationFrame(frame); }
    // a sound once, only while its moment is fresh (a window that joins late stays quiet)
    function once(key, at, t, name, args) {
      if (t < at || t > at + 350) return;
      const k = `${roll.id}:${key}`;
      if (fired.has(k)) return;
      fired.add(k);
      if (fired.size > 400) fired.clear();
      stats.sounds.push(name);
      sound(name, [...(args || []), opts.volume]);
    }
    function frame() {
      raf = 0;
      if (!roll) return;
      const now = Date.now();
      const t = now - roll.t0;
      if (t > roll.dur) { roll = null; el.classList.remove('on'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = 'round'; // outlined text without spikes
      const fade = t > roll.dur - 700 ? clamp((roll.dur - t) / 700, 0, 1) : 1;
      ctx.globalAlpha = fade;
      if (t >= 0) {
        if (roll.kind === 'dice') drawDice(t);
        else if (roll.kind === 'wheel') drawWheel(t);
        else if (roll.kind === 'death') drawDeath(t);
      }
      ctx.globalAlpha = 1;
      stats.frames++;
      raf = requestAnimationFrame(frame);
    }

    // ---------- shared ----------
    // a big word or number with a small line under it
    function words(main, sub, x, y, s, color, glow) {
      if (s <= 0.5) return;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${s}px "Alegreya", Georgia, serif`;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = s * 0.3; }
      ctx.lineWidth = s * 0.08; ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'; ctx.strokeText(main, x, y);
      ctx.fillStyle = color; ctx.fillText(main, x, y);
      ctx.shadowBlur = 0;
      if (sub) {
        const fs = Math.max(14, s * 0.24);
        ctx.font = `600 ${fs}px "Inter", system-ui, sans-serif`;
        ctx.lineWidth = fs * 0.18; ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; ctx.strokeText(sub, x, y + s * 0.62);
        ctx.fillStyle = 'rgba(239, 227, 200, 0.92)'; ctx.fillText(sub, x, y + s * 0.62);
      }
    }
    function veil(a) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, `rgba(0, 0, 0, ${a * 0.45})`); g.addColorStop(1, `rgba(0, 0, 0, ${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // draw once for each long side (the far copy turned around), or once in the middle
    function sides(draw) {
      ctx.save(); draw(false); ctx.restore();
      if (opts.seats !== 'one') { ctx.save(); ctx.translate(W, H); ctx.rotate(Math.PI); draw(true); ctx.restore(); }
    }

    // ---------- the slot machine: a reel per die, a wide reel of entries for the wheel ----------
    // Where a reel's strip stands at time t (in cells, 0 = the first): fast at first, slowing into its stop over
    // the last few cells (the anticipation), then a small catch as it locks. The strip runs downwards.
    function reelPos(cells, value, stop, t, rate = 13) {
      const target = value - 1 + cells * Math.max(6, Math.ceil(80 / cells));
      const travel = Math.max(8, Math.round((stop / 1000) * rate));
      if (t < stop) return target - travel * (1 - clamp(t / stop, 0, 1)) ** 3;
      const a = t - stop;
      return target + (a < 700 ? 0.2 * Math.sin(a / 38) * Math.exp(-a / 110) : 0);
    }
    // a soft rattle while any reel turns (one stream, however many reels): fast at first, then cell by cell
    function rattle(reels) {
      let moved = false;
      reels.forEach((r, i) => {
        if (!r.spinning) return;
        const cell = Math.floor(r.p + 0.5);
        if (stats.cells[i] !== cell) { if (stats.cells[i] != null) moved = true; stats.cells[i] = cell; }
      });
      if (moved && Date.now() - (stats.lastTick || 0) > 50) { stats.lastTick = Date.now(); stats.ticks++; sound('reel', [opts.volume]); }
    }
    const mod = (a, n) => ((a % n) + n) % n;
    // shorten a label to a width
    function fit(text, maxW) {
      let t = String(text);
      if (ctx.measureText(t).width <= maxW) return t;
      while (t.length > 2 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
      return `${t.trimEnd()}…`;
    }
    // The machine: dark iron with a brass edge, a window per reel, a name under each, a bonus at the end.
    // reels: [{ sides, p, spinning, glow, tint, dropped } | { labels: [{ text, color }], wide, p, spinning, glow }]
    // returns where it ends at the bottom.
    function machine(top, reels, { h, bonus = 0, names = null }) {
      const n = reels.length;
      const rw = (r) => r.wide || 1;
      const units = reels.reduce((a, r) => a + rw(r), 0) + (n - 1) * 0.16 + (bonus ? 0.16 + 0.95 : 0) + 0.52;
      const w = Math.min(h * 0.8, (W * 0.9) / units);
      h = w / 0.8;
      const gap = w * 0.16; const pad = w * 0.26; const nameH = h * 0.17;
      const bodyW = units * w; const bodyH = h + pad * 2 + nameH;
      const left = W / 2 - bodyW / 2;
      const y0 = top + pad; const cy = y0 + h / 2;
      // the body
      const g = ctx.createLinearGradient(0, top, 0, top + bodyH);
      g.addColorStop(0, '#2b231c'); g.addColorStop(1, '#120e0b');
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'; ctx.shadowBlur = h * 0.25;
      ctx.beginPath(); ctx.roundRect(left, top, bodyW, bodyH, pad * 0.9); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.lineWidth = Math.max(2, h * 0.022); ctx.strokeStyle = '#6e5836'; ctx.stroke();
      ctx.beginPath(); ctx.roundRect(left + h * 0.035, top + h * 0.035, bodyW - h * 0.07, bodyH - h * 0.07, pad * 0.7);
      ctx.lineWidth = Math.max(1, h * 0.008); ctx.strokeStyle = 'rgba(162, 130, 78, 0.35)'; ctx.stroke();
      // the pay line: a brass mark at each end
      ctx.fillStyle = '#a2824e';
      const m = pad * 0.32;
      ctx.beginPath(); ctx.moveTo(left + pad * 0.25, cy - m); ctx.lineTo(left + pad * 0.25 + m * 1.1, cy); ctx.lineTo(left + pad * 0.25, cy + m); ctx.fill();
      ctx.beginPath(); ctx.moveTo(left + bodyW - pad * 0.25, cy - m); ctx.lineTo(left + bodyW - pad * 0.25 - m * 1.1, cy); ctx.lineTo(left + bodyW - pad * 0.25, cy + m); ctx.fill();
      let x = left + pad;
      reels.forEach((r, i) => {
        const ww = rw(r) * w;
        ctx.save();
        if (r.dropped) ctx.globalAlpha *= 0.38;
        ctx.beginPath(); ctx.roundRect(x, y0, ww, h, w * 0.12);
        if (r.glow) { ctx.save(); ctx.shadowColor = r.glow; ctx.shadowBlur = h * 0.35; ctx.fillStyle = r.glow; ctx.fill(); ctx.restore(); }
        ctx.save();
        ctx.clip();
        const wg = ctx.createLinearGradient(0, y0, 0, y0 + h);
        const mid = r.tint || '#231d17';
        wg.addColorStop(0, '#0a0806'); wg.addColorStop(0.5, mid); wg.addColorStop(1, '#0a0806');
        ctx.fillStyle = wg; ctx.fillRect(x, y0, ww, h);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const base = Math.floor(r.p);
        const a0 = ctx.globalAlpha;
        if (r.labels) {
          // entries: each on a band of its colour
          const s = h * 0.5;
          const fs = Math.min(h * 0.26, ww * 0.12);
          ctx.font = `700 ${fs}px "Alegreya", Georgia, serif`;
          for (let k = -2; k <= 2; k++) {
            const j = base + k;
            const y = cy + (r.p - j) * s;
            const e = r.labels[mod(j, r.labels.length)] || { text: '' };
            ctx.globalAlpha = a0 * 0.7;
            ctx.fillStyle = e.color || '#3a2f25';
            ctx.fillRect(x, y - s / 2 + s * 0.06, ww, s * 0.88);
            ctx.globalAlpha = a0 * (r.spinning ? 0.85 : 1);
            ctx.fillStyle = '#efe3c8';
            const txt = fit(e.text, ww * 0.86);
            if (r.spinning) { ctx.globalAlpha = a0 * 0.25; ctx.fillText(txt, x + ww / 2, y - s * 0.12); ctx.globalAlpha = a0 * 0.85; }
            ctx.fillText(txt, x + ww / 2, y);
          }
        } else {
          const s = h * 0.56; // one number to the next on the strip
          const digits = String(r.sides).length;
          const fs = Math.min(h * 0.5, w * (digits >= 3 ? 0.4 : digits === 2 ? 0.55 : 0.66));
          ctx.font = `800 ${fs}px "Alegreya", Georgia, serif`;
          for (let k = -2; k <= 2; k++) {
            const j = base + k;
            const y = cy + (r.p - j) * s;
            const txt = String(r.order ? r.order[mod(j, r.sides)] : mod(j, r.sides) + 1);
            ctx.fillStyle = '#efe3c8';
            if (r.spinning) { ctx.globalAlpha = a0 * 0.28; ctx.fillText(txt, x + ww / 2, y - s * 0.14); ctx.globalAlpha = a0 * 0.85; }
            else ctx.globalAlpha = a0;
            ctx.fillText(txt, x + ww / 2, y);
          }
        }
        ctx.globalAlpha = a0;
        // the reel is round: dark at the top and the bottom
        const sh = ctx.createLinearGradient(0, y0, 0, y0 + h);
        sh.addColorStop(0, 'rgba(0, 0, 0, 0.92)'); sh.addColorStop(0.3, 'rgba(0, 0, 0, 0)'); sh.addColorStop(0.7, 'rgba(0, 0, 0, 0)'); sh.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
        ctx.fillStyle = sh; ctx.fillRect(x, y0, ww, h);
        ctx.restore();
        ctx.lineWidth = Math.max(1.5, h * 0.018); ctx.strokeStyle = r.glow || '#5a4730'; ctx.stroke();
        if (r.dropped) {
          ctx.strokeStyle = 'rgba(216, 200, 162, 0.85)'; ctx.lineWidth = Math.max(2, h * 0.025);
          ctx.beginPath(); ctx.moveTo(x + ww * 0.12, y0 + h * 0.12); ctx.lineTo(x + ww * 0.88, y0 + h * 0.88); ctx.stroke();
        }
        ctx.font = `600 ${nameH * 0.62}px "Inter", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8c7350';
        ctx.fillText(fit(names ? names[i] : `d${r.sides}`, ww), x + ww / 2, y0 + h + nameH * 0.55);
        ctx.restore();
        x += ww + gap;
      });
      if (bonus) {
        const bw = w * 0.95;
        ctx.beginPath(); ctx.roundRect(x, y0 + h * 0.2, bw, h * 0.6, w * 0.12);
        ctx.fillStyle = '#0d0a08'; ctx.fill();
        ctx.lineWidth = Math.max(1.5, h * 0.018); ctx.strokeStyle = '#5a4730'; ctx.stroke();
        ctx.font = `800 ${w * 0.4}px "Alegreya", Georgia, serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c9a66a';
        ctx.fillText(`${bonus > 0 ? '+' : '−'}${Math.abs(bonus)}`, x + bw / 2, cy);
        ctx.font = `600 ${nameH * 0.62}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = '#8c7350';
        ctx.fillText('bonus', x + bw / 2, y0 + h + nameH * 0.55);
      }
      return { bottom: top + bodyH, h, bodyH };
    }
    // where the machine and the result sit: below the middle for each side, or in the middle for one side
    function place(big) {
      const both = opts.seats !== 'one';
      const hud = opts.hud || 1;
      const h = both ? Math.min(H * (big ? 0.17 : 0.14) * hud, H * (big ? 0.19 : 0.16)) : Math.min(H * (big ? 0.26 : 0.2) * hud, H * 0.3);
      const top = both ? H * 0.515 : H * 0.5 - h * 1.05;
      return { h, top };
    }

    // ---------- dice: a reel for each die, stopping one after the other ----------
    function drawDice(t) {
      const dice = roll.dice || [];
      const stops = roll.stops || dice.map((_, i) => 2400 + i * 800);
      const reveal = roll.reveal ?? stops[stops.length - 1] + 500;
      veil(0.6 * clamp(t / 400, 0, 1));
      const revealed = t >= reveal;
      const reels = dice.map((d, i) => {
        const st = stops[i] ?? stops[stops.length - 1];
        const crit = revealed && roll.crit && d.sides === 20 && !d.dropped;
        return { sides: d.sides, p: reelPos(d.sides, d.value, st, t), spinning: t < st, dropped: revealed && d.dropped,
          glow: crit ? (roll.crit === 'nat20' ? '#e8c56a' : '#c8473a') : null };
      });
      rattle(reels);
      dice.forEach((d, i) => once(`stop${i}`, stops[i] ?? 0, t, 'stop'));
      stats.phase = revealed ? 'result' : 'rolling';
      const c = roll.crit;
      const P = place(false);
      sides(() => {
        const m = machine(P.top, reels, { h: P.h, bonus: roll.bonus });
        if (revealed) {
          const appear = clamp((t - reveal) / 380, 0, 1);
          const size = m.h * 0.74 * easeBack(appear);
          words(String(roll.total), c === 'nat20' ? 'Natural 20!' : c === 'nat1' ? 'Natural 1' : roll.label, W / 2, m.bottom + m.h * 0.56, size,
            c === 'nat20' ? '#e8c56a' : c === 'nat1' ? '#d9604f' : '#efe3c8', c === 'nat20' ? '#b8860b' : c === 'nat1' ? '#8b0000' : null);
        }
      });
      if (revealed) once('reveal', reveal, t, c === 'nat20' ? 'crit' : c === 'nat1' ? 'fumble' : 'chime');
    }

    // the result under the machine, as big as fits
    function result(text, sub, m, appear, color, glow, scale = 0.74) {
      ctx.font = `800 100px "Alegreya", Georgia, serif`;
      const k = (W * 0.8) / Math.max(1, ctx.measureText(text).width) * 100;
      const size = Math.min(m.h * scale, k) * easeBack(appear);
      words(text, sub, W / 2, m.bottom + Math.min(m.h * scale, k) * 0.76, size, color, glow);
    }

    // ---------- the wheel: one wide reel of the entries (each as often as its weight) ----------
    function drawWheel(t) {
      const list = roll.entries || [];
      const strip = roll.strip || list.map((_, i) => i);
      const st = roll.stops ? roll.stops[0] : 5000;
      const reveal = roll.reveal ?? st + 500;
      veil(0.6 * clamp(t / 400, 0, 1));
      const revealed = t >= reveal;
      const labels = strip.map((i) => ({ text: (list[i] || {}).label || '', color: (list[i] || {}).color || null }));
      const reel = { labels, wide: 3.4, p: reelPos(strip.length, (roll.cell ?? 0) + 1, st, t, 11), spinning: t < st, glow: revealed ? '#c9a66a' : null };
      rattle([reel]);
      once('stop0', st, t, 'stop');
      stats.phase = revealed ? 'result' : 'spinning';
      const P = place(false);
      sides(() => {
        const m = machine(P.top, [reel], { h: P.h, names: [roll.title || ''] });
        if (revealed) result(roll.label || '', roll.title || null, m, clamp((t - reveal) / 380, 0, 1), '#efe3c8', (list[roll.index] || {}).color || null, 0.62);
      });
      if (revealed) once('reveal', reveal, t, 'good');
    }

    // ---------- the death save: one d20 reel, the same machine, slowing to its number ----------
    function drawDeath(t) {
      const st = roll.stops ? roll.stops[0] : 5200;
      const reveal = roll.reveal ?? st + 500;
      veil(0.72 * clamp(t / 500, 0, 1));
      const v = roll.value; const good = v >= 10;
      const revealed = t >= reveal;
      const col = v === 20 ? '#e8c56a' : v === 1 ? '#c8473a' : good ? '#6fbf7f' : '#c8473a';
      const order = mixed(20, roll.seed || 1);
      const reel = { sides: 20, order, p: reelPos(20, order.indexOf(v) + 1, st, t), spinning: t < st, glow: revealed ? col : null, tint: revealed ? (good ? '#17301f' : '#3a1512') : null };
      rattle([reel]);
      once('stop0', st, t, 'stop');
      stats.phase = revealed ? 'result' : 'rolling';
      const P = place(true);
      sides(() => {
        const m = machine(P.top, [reel], { h: P.h, names: ['Death save'] });
        if (revealed) result(v === 20 ? 'Natural 20' : v === 1 ? 'Natural 1' : good ? 'Success' : 'Failure', null, m, clamp((t - reveal) / 380, 0, 1), col, col, 0.5);
      });
      if (revealed) once('result', reveal, t, v === 20 ? 'crit' : v === 1 ? 'fumble' : good ? 'good' : 'bad');
    }

    function debug() {
      return { on: !!roll, kind: stats.kind, phase: roll ? stats.phase : null, frames: stats.frames, ticks: stats.ticks, sounds: stats.sounds.slice(-40), id: roll ? roll.id : null };
    }
    return { set, debug };
  }
  return { mount };
})();
