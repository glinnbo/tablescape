// Countdown timers on the TV.
//   normal:   a small clock at the top of the table, a soft tick in the last ten seconds, a chime at zero
//   dramatic: a big number in the middle of the table; every second a dull pulse that gets darker
//             and deeper the less time is left, the screen darkening around it; a low boom at zero
// The pulses are synthesised with WebAudio, so no sound files are needed.
'use strict';

const Countdown = (() => {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // ---------------------------------------------------------------------
  // Sound (synth.js). On the table the sounds go to the sound window, which plays everything
  // the table hears; on the GM screen they play here, so the GM can listen to them first.
  // ---------------------------------------------------------------------
  let local = null;
  function play(name, ...args) {
    if (window.ts && window.ts.role === 'table' && window.ts.soundEvent) { window.ts.soundEvent({ kind: 'synth', name, args }); return true; }
    if (!local) { try { const ctx = new AudioContext({ latencyHint: 'interactive' }); local = { ctx, s: Synth.make(ctx, ctx.destination) }; } catch { return false; } }
    local.s[name](...args);
    return true;
  }
  const pulse = (d, vol = 0.7) => play('pulse', clamp01(d), vol);
  const boom = (vol = 0.7) => play('boom', vol);
  const tick = (vol = 0.7) => play('tick', vol);
  const chime = (vol = 0.7) => play('chime', vol);
  // for the GM: hear how the pulse darkens towards zero
  function demo(vol = 0.7) {
    [0, 0.35, 0.65, 0.85, 1].forEach((d, i) => setTimeout(() => pulse(d, vol), i * 950));
    setTimeout(() => boom(vol), 5 * 950);
  }

  // how close to zero: the share of time gone, and always the whole way down in the last ten seconds
  function depth(secs, total) {
    const gone = 1 - Math.min(secs, total) / Math.max(1, total);
    const close = secs <= 10 ? 1 - (secs - 1) / 10 : 0;
    return clamp01(Math.max(gone, close));
  }
  const fmt = (secs) => (secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs));
  const leftMs = (t, now = Date.now()) => (t.endsAt ? Math.max(0, t.endsAt - now) : Math.max(0, t.left || 0));

  // ---------------------------------------------------------------------
  // The overlay on the TV
  // ---------------------------------------------------------------------
  // A round countdown dial: the remaining time as a ring that empties clockwise, the time written
  // twice (one facing each long side of the table) or once. Used by the calm timer and the break screen.
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const calmColor = (frac, secs) => (secs <= 10 ? '#e4675e' : frac <= 0.25 ? '#e3963e' : '#eadcbc');
  function makeDial(cls = '') {
    const el = document.createElement('div');
    el.className = `tt-dial ${cls}`;
    el.innerHTML = '<div class="tt-ring"></div><div class="tt-disc"></div>'
      + '<div class="tt-face a"><b class="tt-time"></b><span class="tt-label"></span></div>'
      + '<div class="tt-face b"><b class="tt-time"></b><span class="tt-label"></span></div>';
    const times = el.querySelectorAll('.tt-time');
    const labels = el.querySelectorAll('.tt-label');
    function update(frac, text, label, color) {
      el.style.setProperty('--p', String(Math.round(clamp01(frac) * 1000) / 1000));
      el.style.setProperty('--c', color);
      for (const t of times) if (t.textContent !== text) t.textContent = text;
      for (const l of labels) if (l.textContent !== (label || '')) l.textContent = label || '';
    }
    return { el, update };
  }

  // ---------------------------------------------------------------------
  // The overlay on the TV
  // ---------------------------------------------------------------------
  function mount(host) {
    host.innerHTML = `
      <div class="tt-dramatic"><div class="tt-veil"></div><div class="tt-flash"></div>
        <div class="tt-big a"><div class="tt-num"></div><div class="tt-label"></div></div>
        <div class="tt-big b"><div class="tt-num"></div><div class="tt-label"></div></div></div>
      <div class="tt-normal"></div>`;
    const dr = host.querySelector('.tt-dramatic');
    const nr = host.querySelector('.tt-normal');
    const nums = [...dr.querySelectorAll('.tt-num')];
    const dLabels = [...dr.querySelectorAll('.tt-label')];
    const flash = dr.querySelector('.tt-flash');
    const dial = makeDial('timer');
    nr.append(dial.el);
    let cur = null; // timer from main
    let sound = { on: true, volume: 0.7 };
    let lastId = null;
    let lastSecs = null;
    let ended = false;
    let loop = 0;
    const stats = { beats: 0, pulses: 0, booms: 0, ticks: 0, chimes: 0, audio: null };

    const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

    function set(t, snd, opts = {}) {
      if (snd) sound = snd;
      cur = t;
      host.classList.toggle('one-side', opts.seats === 'one');
      if (opts.tin) host.style.setProperty('--tin', `${opts.tin}px`);
      if (opts.hud) host.style.setProperty('--hud', String(opts.hud));
      if (!t) {
        host.classList.remove('on');
        lastId = null; lastSecs = null; ended = false;
        clearInterval(loop); loop = 0;
        return;
      }
      if (t.id !== lastId) {
        lastId = t.id; lastSecs = null; ended = false;
        dr.classList.remove('end'); nr.classList.remove('end');
        for (const n of nums) n.classList.remove('end');
      }
      host.classList.add('on');
      host.dataset.mode = t.mode;
      host.dataset.side = ['left', 'center'].includes(t.side) ? t.side : 'right';
      for (const l of dLabels) l.textContent = t.label || '';
      frame();
      if (!loop) loop = setInterval(frame, 50);
    }

    function frame() {
      const t = cur;
      if (!t) return;
      const ms = leftMs(t);
      const secs = Math.ceil(ms / 1000);
      const paused = !t.endsAt;
      const d = depth(Math.max(1, secs), t.total);
      const frac = ms / 1000 / Math.max(1, t.total);
      host.classList.toggle('paused', paused);
      const vol = sound.volume ?? 0.7;
      const loud = t.sound && sound.on !== false;
      if (t.mode === 'dramatic') {
        dr.style.setProperty('--d', String(Math.round((secs === 0 ? 1 : d) * 1000) / 1000));
        for (const n of nums) { if (n.textContent !== fmt(secs)) n.textContent = fmt(secs); n.classList.toggle('long', secs >= 60); }
      } else {
        dial.update(secs > 0 ? frac : 0, secs > 0 ? clock(secs) : 'Time', t.label, secs > 0 ? calmColor(frac, secs) : '#e4675e');
        dial.el.classList.toggle('last', secs <= 10 && secs > 0);
      }
      if (paused || secs === lastSecs) return;
      const first = lastSecs == null;
      lastSecs = secs;
      if (secs > 0) {
        if (t.mode === 'dramatic') {
          for (const n of nums) retrigger(n, 'beat');
          retrigger(flash, 'beat');
          stats.beats++;
          if (loud && pulse(d, vol)) stats.pulses++;
        } else if (secs <= 10) {
          retrigger(dial.el, 'beat');
          if (loud && tick(vol)) stats.ticks++;
        }
      } else if (!ended && !(first && ms <= 0 && t.endsAt && Date.now() - t.endsAt > 1500)) {
        ended = true;
        if (t.mode === 'dramatic') {
          dr.classList.add('end');
          for (const n of nums) n.classList.add('end');
          if (loud && boom(vol)) stats.booms++;
        } else {
          nr.classList.add('end');
          if (loud && chime(vol)) stats.chimes++;
        }
      }
      stats.audio = window.ts && window.ts.role === 'table' ? 'sound window' : local ? local.ctx.state : null;
    }

    function debug() {
      const t = cur;
      return t ? {
        on: host.classList.contains('on'), mode: t.mode, paused: !t.endsAt,
        text: t.mode === 'dramatic' ? nums[0].textContent : dial.el.querySelector('.tt-time').textContent, label: t.label, ended,
        faces: t.mode === 'dramatic' ? [...dr.querySelectorAll('.tt-big')].filter((x) => getComputedStyle(x).display !== 'none').length
          : [...dial.el.querySelectorAll('.tt-face')].filter((x) => getComputedStyle(x).display !== 'none').length,
        ring: t.mode === 'dramatic' ? null : Number(dial.el.style.getPropertyValue('--p')),
        d: Number(dr.style.getPropertyValue('--d') || 0), ...stats,
      } : { on: false, ...stats };
    }
    return { set, debug };
  }

  return { mount, makeDial, clock, calmColor, pulse, boom, tick, chime, demo, depth, fmt, leftMs };
})();
