// Baked animations (2.3), the windows' side (main: anim-cache.js).
//   AnimCache  both screens: the frame sheets a window draws, loaded once and shared by every copy of an asset,
//              with their shadows (worked out once, not every frame)
//   AnimBaker  GM screen: plays each animated asset the maps use once and keeps its frames in a sheet
//   AnimPill   GM screen: the little maid running along while that happens
'use strict';

const AnimCache = (() => {
  const ts = window.ts || {};
  // 2.5: an animation's frames come in pieces of a few dozen. A short one keeps all of them; a long one only the
  // pieces being shown and the next (loaded just ahead), so it keeps its full size and speed with little memory.
  let WHOLE_PX = 8e6; // all pieces kept up to this many pixels of frames (about 32 MB)
  // Beta 1: a ceiling for all kept frames of this window, from the computer's memory (main: view.memGB). Past it,
  // the pieces no one has shown for longest go, and animations that kept all their pieces stream like long ones.
  // A window has a few hundred MB on an 8 GB laptop and 1.5 GB at most, so the two windows and the graphics
  // process together stay well inside the memory, instead of ending in a blank window.
  let BUDGET_PX = 160e6; // pixels (4 bytes each): about 640 MB until the memory is known
  let usedPx = 0; // pixels of the pieces kept right now (their shadows counted at a quarter)
  let idleFree = false; // the GM's "Still": a drawn frame stays on its canvas, so pieces may go after a while
  const entries = new Map(); // path -> { path, tier, urls, meta, whole, demoted, pieces: [{ img, loading, used, shadow, px }], users, freeTimer, ready }
  const loading = new Map(); // `${path}|${tier}` -> Promise
  const subs = new Set(); // fn(path, what): a sheet came ('ready') or a shadow is done ('shadow')
  const tell = (path, what) => { for (const fn of subs) { try { fn(path, what); } catch (err) { console.error(err); } } };
  let videosOnly = false; // the benchmark's "as videos" half (2.4): baked animations play as videos for a while
  const stats = { loads: 0, frees: 0, misses: 0, demotions: 0, reclaimed: 0, get usedPx() { return usedPx; }, get budgetPx() { return BUDGET_PX; } };
  const pxOf = (en, p) => Math.max(1, Math.min(en.meta.per, en.meta.n - p * en.meta.per)) * en.meta.fw * en.meta.fh;
  const streamed = (en) => !en.whole || en.demoted || idleFree;
  function setMemory(gb) {
    if (!(gb > 0)) return;
    const bytes = Math.min(1.5 * 2 ** 30, Math.max(192 * 2 ** 20, (gb * 2 ** 30) / 12));
    BUDGET_PX = Math.round(bytes / 4);
  }
  // room for px more: the pieces shown longest ago go first (never one shown in the last moment)
  function reclaim(px) {
    if (usedPx + px <= BUDGET_PX) return true;
    const now = performance.now();
    const all = [];
    for (const en of entries.values()) en.pieces.forEach((pc, i) => { if (pc.img && !pc.loading && now - pc.used > 250) all.push({ en, pc, i }); });
    all.sort((a, b) => a.pc.used - b.pc.used);
    for (const { en, pc } of all) {
      if (usedPx + px <= BUDGET_PX) break;
      if (en.whole && !en.demoted) { en.demoted = true; stats.demotions++; }
      dropPiece(pc);
      stats.reclaimed++;
    }
    return usedPx + px <= BUDGET_PX;
  }
  function dropPiece(pc) {
    if (!pc.img) return;
    if (pc.img.close) pc.img.close();
    pc.img = null; pc.shadow = null;
    usedPx -= pc.px || 0; pc.px = 0;
    if (usedPx < 0) usedPx = 0;
  }
  if (ts.onAnim) {
    ts.onAnim((e) => {
      if (!e) return;
      if (e.op === 'ready') tell(e.path, 'ready');
      if (e.op === 'cleared') { for (const [p, en] of entries) if (!en.users) forget(p); }
      if (e.op === 'videos' && videosOnly !== !!e.on) { videosOnly = !!e.on; tell(null, 'mode'); }
    });
  }
  function loadImg(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = async () => {
        try { if (im.decode) await im.decode(); } catch {}
        try { resolve(window.createImageBitmap ? await createImageBitmap(im) : im); } catch { resolve(im); }
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
  }
  function loadPiece(en, p) {
    const pc = en.pieces[p];
    if (!pc || pc.img || pc.loading) return pc ? pc.loading : null;
    stats.loads++;
    const px = pxOf(en, p) * (en.wantShadow ? 1.25 : 1);
    reclaim(px);
    usedPx += px; pc.px = px; // counted from now, so several loads at once see each other
    pc.loading = loadImg(en.urls[p]).then((img) => {
      pc.loading = null;
      if (en.dead || !img) { if (img && img.close) img.close(); usedPx -= pc.px || 0; pc.px = 0; if (usedPx < 0) usedPx = 0; return null; }
      pc.img = img;
      if (en.wantShadow) makeShadow(en, p);
      return img;
    });
    return pc.loading;
  }
  // the best sheet for a file at this size (null: not baked yet). A smaller one already here is used until a
  // bigger one is baked.
  function get(path, tier) {
    const cur = entries.get(path);
    if (cur && cur.tier >= tier) return Promise.resolve(cur);
    const k = `${path}|${tier}`;
    if (loading.has(k)) return loading.get(k);
    const p = (async () => {
      const r = ts.anim ? await ts.anim('get', { path, tier }).catch(() => null) : null;
      const now = entries.get(path);
      if (!r || !r.meta || !Array.isArray(r.urls) || !r.urls.length) return now || null;
      if (now && now.urls[0] === r.urls[0]) return now;
      const m = r.meta;
      const total = m.n * m.fw * m.fh;
      const en = { path, tier: r.tier, urls: r.urls, meta: m, whole: total <= WHOLE_PX && usedPx + total <= BUDGET_PX, demoted: false, pieces: r.urls.map(() => ({ img: null, loading: null, used: 0, shadow: null, px: 0 })), users: 0, freeTimer: 0, ready: false, wantShadow: false };
      const first = await loadPiece(en, 0);
      if (en.whole) await Promise.all(en.pieces.map((_, i) => loadPiece(en, i)));
      else if (en.pieces.length > 1) loadPiece(en, 1);
      if (!first) { free(en); return now || null; }
      en.ready = true;
      const again = entries.get(path);
      if (again && again.tier >= en.tier && again.ready) { free(en); return again; }
      if (again) { again.old = true; if (!again.users) free(again); }
      entries.set(path, en);
      return en;
    })().finally(() => loading.delete(k));
    loading.set(k, p);
    return p;
  }
  // the picture with frame piece p (and the next one on its way); null while it is still being read
  function piece(en, p) {
    const pc = en.pieces[p];
    if (!pc) return null;
    pc.used = performance.now();
    if (streamed(en) && en.pieces.length > 1) { const nx = (p + 1) % en.pieces.length; en.pieces[nx].used = pc.used; loadPiece(en, nx); }
    if (!pc.img) { stats.misses++; loadPiece(en, p); return null; }
    return pc.img;
  }
  // a sheet read again (after the cache was cleared and baked anew, or a test): the copies showing it switch over
  function reload(path) {
    const en = entries.get(path);
    if (!en) return Promise.resolve(null);
    const tier = en.tier;
    free(en);
    return get(path, tier).then((n) => { if (n) tell(path, 'ready'); return n; });
  }
  // pieces of long animations no one has shown for a few seconds go (they come back when needed); over the
  // ceiling (it shrank, or the memory became known late), the oldest go now
  setInterval(() => {
    const now = performance.now();
    if (usedPx > BUDGET_PX) reclaim(0);
    for (const en of entries.values()) {
      if (!streamed(en)) continue;
      for (const pc of en.pieces) {
        if (pc.img && !pc.loading && now - pc.used > 3000) { dropPiece(pc); stats.frees++; }
      }
    }
  }, 1500);
  const peek = (path) => entries.get(path) || null;
  function hold(en) { if (!en) return; en.users++; clearTimeout(en.freeTimer); }
  // a sheet no one shows any more goes after a while (the map may come back soon)
  function drop(en) {
    if (!en) return;
    en.users = Math.max(0, en.users - 1);
    if (en.users) return;
    clearTimeout(en.freeTimer);
    en.freeTimer = setTimeout(() => { if (!en.users) free(en); }, en.old ? 0 : 60000);
  }
  function free(en) {
    if (entries.get(en.path) === en) entries.delete(en.path);
    en.dead = true; en.ready = false;
    for (const pc of en.pieces) dropPiece(pc);
  }
  function forget(path) { const en = entries.get(path); if (en) free(en); }

  // The shadow of every frame, worked out once per piece (at half size: it is soft anyway): the frame's outline in
  // black, blurred, 70 % strong, as the drop shadow of a picture asset.
  function shadowGeom(en) {
    if (en.sg) return en.sg;
    const m = en.meta;
    const fw = Math.max(4, Math.round(m.fw / 2)); const fh = Math.max(4, Math.round(m.fh / 2));
    const sigma = 0.03 * fw; // a drop shadow blurred by 6 % of the width
    const pad = Math.ceil(sigma * 3) + 1;
    en.sg = { fw, fh, pad, cw: fw + 2 * pad, ch: fh + 2 * pad, sigma };
    return en.sg;
  }
  function makeShadow(en, p) {
    const pc = en.pieces[p];
    if (!pc || !pc.img || pc.shadow) return;
    const m = en.meta; const g = shadowGeom(en);
    const cv = document.createElement('canvas');
    cv.width = g.cw * m.cols; cv.height = g.ch * m.rows;
    pc.shadow = { canvas: cv, ready: false };
    const ctx = cv.getContext('2d');
    const count = Math.min(m.per, m.n - p * m.per);
    let next = 0;
    const step = () => {
      if (!pc.img || pc.shadow === null) return;
      ctx.filter = `brightness(0) blur(${g.sigma.toFixed(2)}px)`;
      ctx.globalAlpha = 0.7;
      const end = Math.min(count, next + 16);
      for (; next < end; next++) {
        const cx = next % m.cols; const cy = Math.floor(next / m.cols);
        ctx.drawImage(pc.img, cx * m.fw, cy * m.fh, m.fw, m.fh, cx * g.cw + g.pad, cy * g.ch + g.pad, g.fw, g.fh);
      }
      if (next < count) { setTimeout(step, 0); return; }
      ctx.filter = 'none';
      if (pc.shadow) pc.shadow.ready = true;
      if (p === 0) tell(en.path, 'shadow');
    };
    setTimeout(step, 0);
  }
  // the shadow geometry once any copy wants a shadow (the first piece's shadow being ready = it can be drawn)
  function shadow(en) {
    if (!en || !en.ready) return null;
    if (!en.wantShadow) { en.wantShadow = true; en.pieces.forEach((pc, i) => { if (pc.img) makeShadow(en, i); }); }
    const pc0 = en.pieces[0];
    return pc0 && pc0.shadow && pc0.shadow.ready ? shadowGeom(en) : null;
  }
  function shadowPiece(en, p) { const pc = en.pieces[p]; if (pc && pc.img && !pc.shadow && en.wantShadow) makeShadow(en, p); return pc && pc.shadow && pc.shadow.ready ? pc.shadow.canvas : null; }
  function on(fn) { subs.add(fn); return () => subs.delete(fn); }
  const debug = () => [...entries.values()].map((e) => ({ path: e.path, tier: e.tier, n: e.meta.n, fps: e.meta.fps, fw: e.meta.fw, fh: e.meta.fh, pieces: e.pieces.length, kept: e.pieces.filter((x) => x.img).length, whole: e.whole, demoted: e.demoted, users: e.users, shadow: !!(e.pieces[0].shadow && e.pieces[0].shadow.ready) }));
  return {
    get, peek, hold, drop, shadow, shadowPiece, piece, on, forget, reload, debug, stats, setMemory,
    get videosOnly() { return videosOnly; },
    setIdleFree: (on) => { idleFree = !!on; },
    setWholeLimit: (px) => { WHOLE_PX = px; }, setBudget: (px) => { BUDGET_PX = px; }, // (the self-test streams small ones, and squeezes the budget)
  };
})();

// ---------- GM screen: baking ----------
const AnimBaker = (() => {
  const ts = window.ts || {};
  // 2.5: the file's own speed (up to 30 frames a second) at the size the TV needs. The frames are kept in pieces
  // of a few dozen (AnimCache keeps only the pieces being shown of a long one), so length costs disk, not memory.
  // Only very long and big ones get smaller frames (down to 40 %), and fewer only past that.
  const MAX_FPS = 30;
  const PIECE_PX = 2.4e6; // pixels in one piece (about 10 MB in memory)
  const TOTAL_PX = 60e6; // pixels of all frames of one animation (on the disk)
  let status = null;
  let busy = null; // the job being baked: { path, name, tier, progress }
  const subs = new Set();
  const stats = { baked: 0, failed: 0, last: null };
  const tell = () => { for (const fn of subs) { try { fn(status, busy); } catch (err) { console.error(err); } } };
  let host = null;
  function hostEl() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.className = 'anim-bake-host';
    document.body.appendChild(host);
    return host;
  }
  function start() {
    if (!ts.onAnim || ts.role !== 'gm') return;
    ts.onAnim((e) => { if (e && e.op === 'status') { status = e; tell(); pump(); } });
    ts.anim('status').then((e) => { if (e && !status) { status = e; tell(); pump(); } }).catch(() => {});
  }
  async function pump() {
    if (busy || !status || !status.queue || !status.queue.length) return;
    if (typeof Bench === 'object' && Bench.running) return; // not while the benchmark measures (it goes on after)
    if (window.__tsMoving) return; // 4.8: not while the map moves (kicked again when it rests)
    const job = status.queue[0];
    busy = { ...job, progress: 0 };
    tell();
    let res = null; let why = null;
    try { res = await bake(job, (p) => { if (busy) { busy.progress = p; tell(); } }); } catch (err) { why = String((err && err.message) || err || 'could not be read'); }
    try {
      if (res) {
        await ts.anim('put', { path: job.path, tier: job.tier, pieces: res.pieces, meta: res.meta, name: job.name, ms: res.ms });
        stats.baked++; stats.last = { name: job.name, ...res.meta, bytes: res.pieces.reduce((a, x) => a + x.length, 0), ms: res.ms };
      } else {
        stats.failed++;
        await ts.anim('fail', { path: job.path, why });
      }
    } catch (err) { console.error(err); }
    busy = null;
    // main's new list may have come while this one was still being saved: go on with it (without this one)
    if (status && status.queue) status = { ...status, queue: status.queue.filter((q) => !(q.path === job.path && q.tier <= job.tier)) };
    tell();
    pump();
  }
  function once(el, ok, bad, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { done(); reject(new Error('timed out')); }, ms);
      const yes = () => { done(); resolve(); };
      const no = () => { done(); reject(new Error('could not be read')); };
      const done = () => { clearTimeout(t); el.removeEventListener(ok, yes); el.removeEventListener(bad, no); };
      el.addEventListener(ok, yes); el.addEventListener(bad, no);
    });
  }
  // How many frames a second the file has (the shortest step between its first pictures, played slowly so none
  // is skipped) and how many pictures a second this screen shows (a busy or slow screen skips video frames).
  async function probe(v) {
    if (!v.requestVideoFrameCallback) return { src: 30, screen: 60 };
    // how many pictures a second this screen shows now (a slow or busy one gets a slower probe)
    const screen0 = await new Promise((resolve) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 250) requestAnimationFrame(f); else resolve((n * 1000) / (t - t0)); }; requestAnimationFrame(f); });
    const times = [];
    let ticks = 0; let ticking = true;
    const t0 = performance.now();
    const raf = () => { if (!ticking) return; ticks++; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    v.playbackRate = Math.min(0.2, Math.max(0.07, (0.35 * screen0) / 60)); // (the browser plays no slower than 1/16)
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 9000);
      const frame = (now, md) => {
        times.push(md.mediaTime);
        if (times.length >= 10 || (times.length >= 4 && performance.now() - t0 > 4000)) { clearTimeout(t); resolve(); return; }
        v.requestVideoFrameCallback(frame);
      };
      v.requestVideoFrameCallback(frame);
      v.play().catch(() => { clearTimeout(t); resolve(); });
    });
    ticking = false;
    const screen = (ticks * 1000) / Math.max(1, performance.now() - t0);
    v.pause();
    v.playbackRate = 1;
    let step = Infinity;
    for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0.004 && d < step) step = d; }
    // timestamps are often whole milliseconds (24 a second: 41 and 42 ms): the usual rates are taken when close
    const snap = (x) => { const near = [8, 10, 12, 15, 24, 25, 30, 48, 50, 60].find((r) => Math.abs(x - r) / r < 0.035); return near || Math.round(x * 2) / 2; };
    let src = snap(Number.isFinite(step) ? Math.min(60, Math.max(4, 1 / step)) : 30);
    // a check against the frames the decoder counted: pictures skipped while probing would make it look slower
    try {
      const q = v.getVideoPlaybackQuality && v.getVideoPlaybackQuality();
      const est = q && v.currentTime > 0.15 ? Math.max(0, q.totalVideoFrames - 2) / v.currentTime : 0; // (the decoder reads a few ahead)
      if (est > src * 1.4) src = snap(Math.min(60, est));
    } catch {}
    v.currentTime = 0;
    await once(v, 'seeked', 'error', 5000).catch(() => {});
    return { src, screen: Math.max(screen, screen0) };
  }
  // how a file is kept: the size of a frame, how many, how many a second, how many in one piece
  function plan({ sw, sh, dur, src, tier }) {
    const want = Math.min(tier, Math.max(sw, sh)); // the longer side the TV needs
    const dims = (L) => { const k = L / Math.max(sw, sh); return { fw: Math.max(8, Math.round(sw * k)), fh: Math.max(8, Math.round(sh * k)) }; };
    const area = (L) => { const d = dims(L); return d.fw * d.fh; };
    let fps = Math.min(MAX_FPS, src);
    let n = Math.max(1, Math.round(dur * fps));
    let L = want;
    // 4.8: the big sizes (768, 1024: an asset that is really that big on the TV) may use twice the pixels before
    // they get smaller frames, and never go below 512 for it
    const total = tier > 512 ? TOTAL_PX * 2 : TOTAL_PX;
    const floor = tier > 512 ? Math.min(want, 512) : want * 0.4;
    if (n * area(L) > total) L = Math.max(floor, want * Math.sqrt(total / (n * area(want)))); // very long and big: smaller
    L = Math.max(16, Math.round(L));
    const { fw, fh } = dims(L);
    if (n * fw * fh > total) { n = Math.max(8, Math.floor(total / (fw * fh))); fps = n / dur; } // past that: fewer a second
    const per = Math.max(1, Math.min(n, 64, Math.floor(PIECE_PX / (fw * fh)) || 1));
    const cols = Math.max(1, Math.ceil(Math.sqrt((per * fh) / fw)));
    const rows = Math.ceil(per / cols);
    return { fw, fh, n, fps, per, cols, rows, pieces: Math.ceil(n / per), blend: false };
  }
  // play the file once and keep a frame every 1/fps second (each frame takes the picture shown at its time)
  async function bake(job, progress) {
    const t0 = performance.now();
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false; v.disablePictureInPicture = true;
    hostEl().appendChild(v);
    try {
      v.src = job.url;
      if (v.readyState < 1) await once(v, 'loadedmetadata', 'error', 15000);
      const tl = performance.now();
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) throw new Error('no length');
      if (dur > 30) throw new Error('longer than 30 seconds');
      const sw = v.videoWidth; const sh = v.videoHeight;
      if (!sw || !sh) throw new Error('no picture');
      const pr = await probe(v);
      const src = pr.src;
      const { fw, fh, cols, rows, n, fps, per, pieces, blend } = plan({ sw, sh, dur, src, tier: job.tier });
      // one canvas per piece; frame i is cell (i mod per) of piece (i div per)
      const cvs = [];
      const piece = (p) => {
        if (!cvs[p]) { const c = document.createElement('canvas'); c.width = cols * fw; c.height = rows * fh; cvs[p] = { c, ctx: c.getContext('2d') }; }
        return cvs[p];
      };
      const draw = (i) => { const p = piece(Math.floor(i / per)); const j = i % per; p.ctx.clearRect((j % cols) * fw, Math.floor(j / cols) * fh, fw, fh); p.ctx.drawImage(v, (j % cols) * fw, Math.floor(j / cols) * fh, fw, fh); };
      // a screen that shows fewer pictures a second than the frames needed: the video plays slower meanwhile
      const rate = Math.min(1, Math.max(0.1, (0.85 * pr.screen) / Math.min(fps, src)));
      const late = new Float32Array(n); // how far after its time each frame's picture was
      let next = 0;
      await new Promise((resolve, reject) => {
        let last = performance.now();
        let over = false;
        const finish = (err) => {
          if (over) return;
          over = true;
          clearInterval(watch);
          v.removeEventListener('ended', ended);
          if (err) reject(err); else resolve();
        };
        const watch = setInterval(() => { if (performance.now() - last > 10000) finish(new Error('the video stopped')); }, 1000);
        const take = (t) => {
          while (next < n && next / fps <= t + 0.5 / fps) { draw(next); late[next] = t - next / fps; next++; }
          progress(0.9 * (next / n));
        };
        const ended = () => { last = performance.now(); while (next < n) { draw(next); late[next] = dur - next / fps; next++; } finish(); };
        v.addEventListener('ended', ended);
        v.playbackRate = rate;
        if (v.requestVideoFrameCallback) {
          const frame = (now, md) => {
            if (over) return;
            last = performance.now();
            take(md.mediaTime);
            if (next >= n) { finish(); return; }
            v.requestVideoFrameCallback(frame);
          };
          v.requestVideoFrameCallback(frame);
        } else {
          const tick = () => { if (over) return; last = performance.now(); take(v.currentTime); if (next >= n) finish(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }
        v.play().catch(finish);
      });
      v.pause();
      // frames whose picture came too late (skipped while playing): fetched one by one
      const miss = [];
      for (let i = 0; i < n; i++) if (late[i] > 1.5 / src + 0.004 && i / fps < dur - 1.5 / src) miss.push(i);
      if (miss.length && miss.length <= Math.max(90, n * 0.5)) {
        for (let j = 0; j < miss.length; j++) {
          const i = miss[j];
          v.currentTime = Math.min(dur - 0.001, i / fps + 0.0005);
          try { await once(v, 'seeked', 'error', 5000); draw(i); } catch {}
          progress(0.9 + (0.1 * (j + 1)) / miss.length);
        }
      }
      stats.capture = { rate: Math.round(rate * 100) / 100, screen: Math.round(pr.screen), missed: miss.length };
      const t1 = performance.now();
      const out = [];
      for (let p = 0; p < pieces; p++) {
        const pc = piece(p);
        const blob = await new Promise((resolve) => pc.c.toBlob(resolve, 'image/webp', 0.86));
        if (!blob) throw new Error('the frames could not be saved');
        out.push(new Uint8Array(await blob.arrayBuffer()));
        pc.c.width = 1; pc.c.height = 1;
      }
      stats.times = { load: Math.round(tl - t0), play: Math.round(t1 - tl), encode: Math.round(performance.now() - t1) };
      return { pieces: out, meta: { fw, fh, cols, rows, n, per, fps: Math.round(fps * 1000) / 1000, dur, sw, sh, src: Math.round(src * 100) / 100, blend }, ms: Math.round(performance.now() - t0) };
    } finally {
      v.pause(); v.removeAttribute('src'); v.load(); v.remove();
    }
  }
  const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  return { start, on, kick: () => pump(), get status() { return status; }, get busy() { return busy; }, stats, plan };
})();

// ---------- GM screen: the little maid runs along while animations are baked ----------
const AnimPill = (() => {
  const { h } = UI;
  let el = null; let bar = null; let fill = null; let maid = null; let text = null; let list = null;
  let hideTimer = 0; let shown = false; let ok = false;
  function build() {
    maid = h('img', { class: 'anim-maid', src: 'maid-run.webp', alt: '' });
    fill = h('span', { class: 'anim-fill' });
    bar = h('span', { class: 'anim-track' }, fill, maid);
    text = h('span', { class: 'anim-text' });
    list = h('div', { class: 'anim-list' });
    el = h('div', { class: 'anim-pill', role: 'status', 'aria-live': 'polite', hidden: true }, bar, text, list);
    document.body.appendChild(el);
  }
  function render(st, busy) {
    if (!el) build();
    const left = st ? st.left || 0 : 0;
    const total = st ? st.total || 0 : 0;
    const done = st ? st.done || 0 : 0;
    if (left > 0 && st.paused === 'disk') { // 2.5: the library's disk is almost full: no baking until there is room
      clearTimeout(hideTimer); hideTimer = 0; ok = false;
      el.hidden = false; shown = true;
      el.classList.remove('done', 'out');
      el.classList.add('paused');
      if (!maid.src.endsWith('maid.webp')) maid.src = 'maid.webp';
      const mb = st.free != null ? Math.round(st.free / 1048576) : null;
      text.textContent = `Preparing paused: the disk is almost full${mb != null ? ` (${mb} MB free)` : ''}`;
      list.replaceChildren(h('b', {}, 'Preparing paused'), h('p', { class: 'anim-hint' }, `${left} animation${left === 1 ? '' : 's'} wait${left === 1 ? 's' : ''}. They play as videos meanwhile. Preparing goes on by itself once the disk with your library has more than 500 MB free.`));
      return;
    }
    el.classList.remove('paused');
    if (left > 0) {
      clearTimeout(hideTimer); hideTimer = 0;
      ok = false;
      const part = busy ? Math.min(1, Math.max(0, busy.progress || 0)) : 0;
      const k = total ? Math.min(1, (done + part) / total) : 0;
      el.hidden = false; shown = true;
      el.classList.remove('done', 'out');
      if (!maid.src.endsWith('maid-run.webp')) maid.src = 'maid-run.webp';
      text.textContent = `Preparing animations ${Math.min(total, done + 1)} / ${total}`;
      el.style.setProperty('--k', k.toFixed(3));
      // hovered: what is being baked now and what comes next
      const q = (st.queue || []);
      list.replaceChildren(...[h('b', {}, 'Preparing animations'),
        ...q.slice(0, 8).map((it) => h('div', { class: `anim-li ${busy && busy.path === it.path ? 'now' : ''}` },
          h('span', { class: 'anim-li-name' }, it.name), h('span', { class: 'anim-li-where' }, it.where || ''),
          busy && busy.path === it.path ? h('span', { class: 'anim-li-pct' }, `${Math.round((busy.progress || 0) * 100)} %`) : null)),
        q.length > 8 ? h('div', { class: 'anim-li more' }, `and ${left - 8} more`) : null,
        h('p', { class: 'anim-hint' }, 'Each animated asset a map uses is played once and kept as frames, so the TV and your screen draw it instead of playing the video. Done once per file and size.')].filter(Boolean));
      return;
    }
    if (shown && !ok) {
      ok = true;
      const failed = st && st.failed ? st.failed.length : 0;
      el.style.setProperty('--k', '1');
      el.classList.add('done');
      maid.src = 'maid.webp'; // she has arrived
      text.textContent = failed ? `Animations ready ✓ (${failed} play${failed === 1 ? 's' : ''} as video)` : 'All animations ready ✓';
      list.replaceChildren(...[h('b', {}, 'All animations ready'), failed ? h('p', { class: 'anim-hint' }, `${failed === 1 ? 'One file' : `${failed} files`} could not be prepared and play${failed === 1 ? 's' : ''} as video: ${st.failed.map((f) => f.name).join(', ')}. Options → Performance: Prepare now tries again.`) : null].filter(Boolean));
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.classList.add('out');
        hideTimer = setTimeout(() => { el.hidden = true; shown = false; el.classList.remove('out', 'done'); }, 600);
      }, 2600);
    }
  }
  function start() {
    if (!window.ts || window.ts.role !== 'gm') return;
    AnimBaker.on(render);
  }
  return { start, get el() { return el; } };
})();
