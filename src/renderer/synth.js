// Synthesised table sounds: the countdown's pulse and boom, the quiet tick and the chime.
// Made with WebAudio, so no sound files are needed. Used by the sound window (what the table hears)
// and by the GM window (to listen to them before using them).
'use strict';

const Synth = (() => {
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // ctx: an AudioContext; dest: where the sounds go (the context's destination or a bus)
  function make(ctx, dest) {
    // soft saturation adds overtones, so the bass is still felt on small TV speakers
    const satCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; satCurve[i] = Math.tanh(2.4 * x) / Math.tanh(2.4); }
    const noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < nd.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); nd[i] = b * 6; } // brownish noise: dull, no hiss

    const wake = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    function chain(vol, cutoff) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = satCurve;
      shaper.oversample = '2x';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      lp.Q.value = 0.6;
      const out = ctx.createGain();
      out.gain.value = vol;
      shaper.connect(lp).connect(out).connect(dest);
      return shaper;
    }
    function env(g, t0, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    }
    function thump(into, t0, f0, f1, glide, peak, decay) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + glide);
      const g = ctx.createGain();
      env(g, t0, peak, 0.006, decay);
      o.connect(g).connect(into);
      o.start(t0);
      o.stop(t0 + decay + 0.1);
    }
    function knock(into, t0, freq, q, peak, decay) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = ctx.createGain();
      env(g, t0, peak, 0.003, decay);
      n.connect(bp).connect(g).connect(into);
      n.start(t0, Math.random() * 2);
      n.stop(t0 + decay + 0.05);
    }

    // One pulse. d: 0 = plenty of time left ... 1 = the last second (darker, deeper, longer)
    function pulse(d, vol = 0.7) {
      wake();
      d = clamp01(d);
      const t0 = ctx.currentTime + 0.02;
      const into = chain(vol, lerp(1000, 165, d));
      const f = lerp(88, 40, d);
      const decay = lerp(0.3, 1.1, d);
      thump(into, t0, f * 2.3, f, 0.07, lerp(0.5, 0.95, d), decay);
      if (d > 0.2) thump(into, t0, f, f / 2, 0.12, (d - 0.2) * 0.85, decay * 1.25); // sub rumble near the end
      knock(into, t0, lerp(620, 170, d), 1.1, lerp(0.5, 0.18, d), lerp(0.08, 0.16, d));
    }
    // zero: one long, very low boom
    function boom(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.02;
      const into = chain(vol, 150);
      thump(into, t0, 95, 27, 0.9, 1, 3.4);
      thump(into, t0, 46, 22, 1.4, 0.7, 3.8);
      knock(into, t0, 90, 0.7, 0.9, 2.6);
    }
    // normal timer: a quiet tick in the last seconds, a two-note chime at zero
    function tick(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.01;
      const g = ctx.createGain();
      g.gain.value = vol * 0.6;
      g.connect(dest);
      knock(g, t0, 1900, 4, 0.5, 0.03);
    }
    function chime(vol = 0.7) {
      wake();
      const out = ctx.createGain();
      out.gain.value = vol * 0.35;
      out.connect(dest);
      [[659.3, 0], [987.8, 0.16]].forEach(([f, dt]) => {
        for (const [mul, a] of [[1, 1], [2.01, 0.25]]) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * mul;
          const g = ctx.createGain();
          env(g, ctx.currentTime + 0.02 + dt, a, 0.01, 1.6);
          o.connect(g).connect(out);
          o.start(ctx.currentTime + dt);
          o.stop(ctx.currentTime + dt + 1.8);
        }
      });
    }
    // ---------- dice, the wheel, death saves (dice-fx.js asks for them as the TV shows them) ----------
    const out = (vol) => { const g = ctx.createGain(); g.gain.value = vol; g.connect(dest); return g; };
    function tone(into, t0, f, type, peak, attack, decay, glideTo) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + attack + decay);
      const g = ctx.createGain();
      env(g, t0, peak, attack, decay);
      o.connect(g).connect(into);
      o.start(t0);
      o.stop(t0 + attack + decay + 0.1);
    }
    // a die hits the table: two or three hard little knocks (s: how hard, 0..1)
    function clack(s = 0.8, vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.005;
      const g = out(vol * (0.35 + 0.65 * clamp01(s)));
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) knock(g, t0 + i * (0.012 + Math.random() * 0.02), 1500 + Math.random() * 2600, 6 + Math.random() * 6, 0.9 - i * 0.25, 0.025 + Math.random() * 0.02);
      knock(g, t0, 420 + Math.random() * 200, 2, 0.35 * s, 0.06); // the table under it
    }
    // the wheel's peg passes the pointer
    function whtick(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.004;
      const g = out(vol * 0.55);
      knock(g, t0, 2600 + Math.random() * 300, 9, 0.8, 0.018);
      knock(g, t0, 900, 3, 0.25, 0.03);
    }
    // a slot reel turning: a soft, dry rattle tick
    function reel(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.004;
      const g = out(vol * 0.4);
      knock(g, t0, 1500 + Math.random() * 400, 5, 0.6, 0.016);
      knock(g, t0, 520, 2, 0.18, 0.022);
    }
    // a reel stops: a short mechanical clunk
    function stop(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.005;
      const into = chain(vol * 0.8, 700);
      thump(into, t0, 170, 85, 0.05, 0.8, 0.2);
      const g = out(vol * 0.7);
      knock(g, t0, 2300, 4, 0.7, 0.028);
      knock(g, t0 + 0.012, 760, 2, 0.45, 0.06);
    }
    // a heartbeat: lub-dub
    function heart(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.01;
      const into = chain(vol * 1.1, 140);
      thump(into, t0, 70, 38, 0.09, 0.95, 0.32);
      thump(into, t0 + 0.24, 62, 34, 0.09, 0.7, 0.36);
    }
    // the result: good (bright, rising), bad (low, uneasy), a natural 20 (a shimmering cascade), a natural 1 (a crack)
    function good(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.02;
      const g = out(vol * 0.32);
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => { tone(g, t0 + i * 0.07, f, 'sine', 0.9, 0.01, 1.3); tone(g, t0 + i * 0.07, f * 2.003, 'sine', 0.18, 0.01, 0.8); });
    }
    function bad(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.02;
      const into = chain(vol * 0.9, 420);
      thump(into, t0, 110, 52, 0.5, 0.9, 1.4);
      const g = out(vol * 0.18);
      tone(g, t0 + 0.05, 233.1, 'triangle', 0.8, 0.02, 1.6, 220);
      tone(g, t0 + 0.05, 246.9, 'triangle', 0.6, 0.02, 1.6, 233);
    }
    function crit(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.02;
      const g = out(vol * 0.28);
      for (let i = 0; i < 9; i++) { const f = 880 * 2 ** ([0, 4, 7, 12, 16, 19, 24, 19, 24][i] / 12); tone(g, t0 + i * 0.055, f, 'sine', 0.85, 0.005, 1.1); }
      const into = chain(vol * 0.6, 300);
      thump(into, t0, 90, 45, 0.3, 0.7, 0.9);
    }
    function fumble(vol = 0.7) {
      wake();
      const t0 = ctx.currentTime + 0.01;
      const g = out(vol * 0.9);
      knock(g, t0, 3200, 1.2, 0.9, 0.05);
      knock(g, t0 + 0.04, 1400, 1.5, 0.6, 0.12);
      const into = chain(vol * 0.9, 200);
      thump(into, t0 + 0.03, 80, 30, 0.6, 0.9, 1.2);
    }
    return { pulse, boom, tick, chime, clack, whtick, reel, stop, heart, good, bad, crit, fumble };
  }

  return { make, NAMES: ['pulse', 'boom', 'tick', 'chime', 'clack', 'whtick', 'reel', 'stop', 'heart', 'good', 'bad', 'crit', 'fumble'] };
})();
