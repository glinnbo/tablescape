// Benchmark (2.4): the TV window and the GM window count their frames for a while; main watches the processor
// and the memory of every window meanwhile and keeps the results (main.js: bench). Options → Performance shows them.
'use strict';

const Bench = (() => {
  const ts = window.ts || {};
  let info = () => null; // what this window shows (table.js, gm-play.js)
  let begin = () => {}; // 2.5: the window starts counting its animations' pictures
  const subs = new Set(); // GM: the Performance panel follows a run
  let last = null; // GM: the newest progress or result
  let running = false; // GM: a benchmark is measuring (no baking meanwhile, anim.js)
  if (ts.onBench) {
    ts.onBench((e) => {
      if (!e) return;
      if (e.op === 'measure') measure(e);
      else {
        last = e;
        running = e.op === 'progress';
        if (!running && typeof AnimBaker === 'object') AnimBaker.kick();
        for (const fn of subs) { try { fn(e); } catch (err) { console.error(err); } }
        if (e.op === 'done') picked = e.picked || null;
        if (ts.role === 'gm' && e.op === 'done' && typeof UI === 'object') UI.toast(summary(e.results), { ms: 9000 });
        if (ts.role === 'gm' && e.op === 'error' && typeof UI === 'object') UI.toast(e.error, { kind: 'error' });
      }
    });
  }
  // every frame's time for ms milliseconds (the browser draws a frame when it can: a slow one shows here)
  function measure({ id, ms }) {
    try { begin(); } catch (err) { console.error(err); }
    const gaps = [];
    let prev = 0;
    const t0 = performance.now();
    const tick = (now) => {
      if (prev) gaps.push(now - prev);
      prev = now;
      if (now - t0 < ms) requestAnimationFrame(tick); else finish();
    };
    requestAnimationFrame(tick);
    function finish() {
      const n = gaps.length;
      const total = gaps.reduce((a, b) => a + b, 0);
      const sorted = gaps.slice().sort((a, b) => a - b);
      const p99 = n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0;
      const r1 = (v) => Math.round(v * 10) / 10;
      const out = {
        id, frames: n, fps: n && total ? r1((n * 1000) / total) : 0, low: p99 ? r1(1000 / p99) : 0,
        worst: Math.round(n ? sorted[n - 1] : 0), stutters: gaps.filter((g) => g > 50).length,
      };
      try { out.info = info(); } catch {}
      if (ts.bench) ts.bench('result', out).catch(() => {});
    }
  }
  const pct = (v) => (v == null ? '–' : `${Math.round(v)} %`);
  let picked = null; // Beta 1: what the draw benchmark chose
  function summary(list) {
    const r = (list || []).slice(-1)[0];
    if (!r) return 'Benchmark done';
    if ((list || []).length === 2 && list[0].label === 'videos') {
      const [a, b] = list;
      const ra = a.motion && a.motion.tv; const rb = b.motion && b.motion.tv;
      return `Benchmark: animations on the TV as videos ${ra && ra.count ? `${ra.ratio} %` : '–'}, baked ${rb && rb.count ? `${rb.ratio} %` : '–'} of their speed (Options → Performance)`;
    }
    if ((list || []).length === 2 && list[0].label === 'gpu') { // Beta 1: drawn by the graphics card, then the processor; the better one stays
      const [a, b] = list;
      const st = (x) => (x.tv ? `${x.tv.fps} fps, ${x.tv.stutters} stutter${x.tv.stutters === 1 ? '' : 's'}` : 'no answer');
      return `Benchmark: graphics card ${st(a)}; processor ${st(b)}. ${picked === 'gpu' ? 'The graphics card' : 'The processor'} draws the animations from now on (Options → Performance).`;
    }
    const mo = r.motion && r.motion.tv;
    return `Benchmark: the TV ${r.tv ? `${r.tv.fps} fps` : 'did not answer'}${mo && mo.count ? ` · animations ${mo.ratio} % of their speed` : ''} · processor ${pct(r.cpu && r.cpu.all)} (Options → Performance)`;
  }
  return {
    setInfo: (fn) => { info = fn; },
    setStart: (fn) => { begin = fn; },
    on: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    get last() { return last; },
    get running() { return running; },
    summary,
  };
})();
