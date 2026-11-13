// The table window: what the players see. Nothing to click, nothing to read.
// Keeps the live map playing, preloads the map the GM is preparing (paused),
// and changes maps under a sweep of ink (or with a crossfade) when a new map is sent.
'use strict';

const Table = (() => {
  const FADE_MS = 800;
  let stage; let black; let calib; let timer; let overlays; let testEl; let dice; let show;
  // Sound is played by the sound window (sound-engine.js, its own process); the table only asks it
  // for thunder after a lightning flash and for the countdown's pulses and chimes.
  const events = { strikes: 0, thunders: 0 };
  const views = new Map(); // mapId -> { view, layer }
  let liveId = null;
  let last = null;

  function start() {
    document.body.classList.add('table');
    const root = document.getElementById('table-root');
    root.hidden = false;
    stage = document.getElementById('table-stage');
    black = document.getElementById('table-black');
    calib = document.getElementById('table-calib');
    testEl = document.getElementById('table-test');
    timer = Countdown.mount(document.getElementById('table-timer'));
    overlays = TableOverlays.mount(document.getElementById('table-overlays'));
    show = TableShow.mount(document.getElementById('table-show')); // Beta 3.2: a token shown to the table
    // dice, the wheel of luck, death saves (dice-fx.js); their sounds come from the sound window
    dice = DiceFX.mount(document.getElementById('table-dice'), { sound: (name, args) => window.ts.soundEvent({ kind: 'synth', name, args }) });
    window.ts.onEvent(onEvent);
    window.ts.onTableState(apply);
    window.ts.onFog((d) => SceneView.fogDelta(d, [...views.values()].map((x) => x.view)));
    window.ts.onDrag((d) => { const v = views.get(d.mapId); if (v) v.view.dragLive(d.id, d.x, d.y); }); // Prototype 14
    window.ts.onView((d) => { const v = views.get(d.mapId); if (v) v.view.setViewLive(d.view); }); // 4.4: the map moving
    window.ts.onPing((p) => { const v = views.get(liveId); if (v && p.mapId === liveId) v.view.ping(p); });
    // 4.11.1: the room lights' picture of the table, drawn here when main asks (a capture of the window made it flicker)
    const amb = document.createElement('canvas');
    window.ts.onAmbSample(() => {
      const w = 32; const hh = Math.max(8, Math.round((32 * (innerHeight || 9)) / (innerWidth || 16)));
      if (amb.width !== w || amb.height !== hh) { amb.width = w; amb.height = hh; }
      const g = amb.getContext('2d', { willReadFrequently: true });
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.fillStyle = '#000'; g.fillRect(0, 0, w, hh);
      const lv = views.get(liveId);
      if (lv && !(last && last.blackout)) {
        lv.view.ambientSample(g, w, hh);
        // the map dimmed behind Talk, a handout or the break screen
        const st = document.getElementById('table-stage');
        if (st && st.classList.contains('soft')) { const dim = Number(st.style.getPropertyValue('--soft-dim')) || 1; if (dim < 1) { g.fillStyle = `rgba(0, 0, 0, ${1 - dim})`; g.fillRect(0, 0, w, hh); } }
      }
      let d = null;
      try { d = g.getImageData(0, 0, w, hh).data; } catch { window.ts.ambFrame(null); return; } // (a picture it may not read)
      const out = new Uint8Array(d.length); // in the order of a screen capture: blue, green, red
      for (let i = 0; i < d.length; i += 4) { out[i] = d[i + 2]; out[i + 1] = d[i + 1]; out[i + 2] = d[i]; out[i + 3] = 255; }
      window.ts.ambFrame({ w, h: hh, data: out });
    });
    SceneView.onResync = apply;
    window.ts.state().then(apply);
    measureFps();
    // the benchmark (bench.js) asks what the TV shows
    Bench.setStart(() => { const lv = views.get(liveId); if (lv) lv.view.animMeasureStart(); });
    Bench.setInfo(() => { const lv = views.get(liveId); return lv ? { anim: lv.view.animInfo(), motion: lv.view.animMeasureStop(), heavy: heaviest() } : null; });
    addEventListener('resize', () => { if (last) { drawCalibration(last); overlays.set(last, last.view); } });
  }

  function ensureView(map, viewInfo, playing) {
    let v = views.get(map.id);
    if (!v) {
      const layer = document.createElement('div');
      layer.className = 'tv-layer';
      stage.appendChild(layer);
      const view = new SceneView(layer, { gm: false });
      view.playing = playing;
      if (prepMove) view.prepareMove(true); // 4.8
      view.on('thunder', (f) => { if (map.id === liveId) thunder(0.5 + Math.random() * 1.6, 0.55 + 0.25 * Math.min(1, f.size || 1)); });
      v = { view, layer };
      views.set(map.id, v);
    }
    v.view.setView(viewInfo);
    v.view.setMap(map);
    return v;
  }

  async function apply(s) {
    last = s;
    applyStyles(s.styles); // (Prototype 10: first: a map change and Talk below are drawn in them; before, they used the style picked before)
    // ---- live map ----
    if (s.live) {
      if (s.live.id !== liveId) {
        const prevId = liveId;
        liveId = s.live.id;
        // ink: two brush strokes sweep in from both long sides, the maps change underneath, the ink drips away
        // (4.4: or smoke, parchment, embers: table-looks.js)
        const kind = s.transition || 'ink';
        const ink = kind !== 'fade' && prevId && views.has(prevId) && !s.blackout;
        const look = kind === 'ink' ? Ink : (Look || (Look = Looks.makeCover(stage)));
        const covered = ink ? look.cover(kind, s.live.name) : null;
        // smoke, parchment, embers: the new map is loaded once the table is covered (loading it would stall them)
        if (ink && kind !== 'ink') {
          waitCover = s.live.id;
          await covered;
          waitCover = null;
          if (liveId !== s.live.id) return;
          const old = views.get(prevId); if (old) old.view.setPlaying(false); // hidden now: it rests
        }
        const v = ensureView(s.live, s.view, true);
        v.view.setPlaying(true);
        stage.appendChild(v.layer); // on top
        await v.view.ready();
        if (liveId !== s.live.id) return; // superseded while loading
        if (ink) {
          await covered;
          if (liveId !== s.live.id) return;
          for (const [id, x] of views) {
            if (id === liveId) continue;
            x.layer.classList.add('instant'); x.layer.classList.remove('shown');
            if (!last.prep || last.prep.id !== id) { x.view.destroy(); x.layer.remove(); views.delete(id); } else x.view.setPlaying(false);
          }
          v.layer.classList.add('instant', 'shown');
          requestAnimationFrame(() => requestAnimationFrame(() => { for (const x of views.values()) x.layer.classList.remove('instant'); }));
          look.reveal();
          return finishApply(last); // the newest state: more may have arrived while the ink covered the table
        }
        requestAnimationFrame(() => v.layer.classList.add('shown'));
        if (prevId && views.has(prevId)) {
          const old = views.get(prevId);
          setTimeout(() => {
            old.layer.classList.remove('shown');
            if (prevId !== liveId && (!last.prep || last.prep.id !== prevId)) { old.view.destroy(); old.layer.remove(); views.delete(prevId); }
            else old.view.setPlaying(false);
          }, FADE_MS + 50);
        }
      } else if (waitCover !== s.live.id) { // (while smoke or parchment covers the table, the new map waits)
        ensureView(s.live, s.view, true);
      }
    } else if (liveId) {
      const oldId = liveId;
      const old = views.get(oldId);
      liveId = null;
      if (old) {
        old.layer.classList.add('fading');
        old.layer.classList.remove('shown');
        setTimeout(() => {
          old.layer.classList.remove('fading');
          if (liveId === oldId) return;
          if (last.prep && last.prep.id === oldId) { old.view.setPlaying(false); return; }
          old.view.destroy(); old.layer.remove(); views.delete(oldId);
        }, FADE_MS + 50);
      }
    }

    finishApply(s);
  }
  function finishApply(s) {
    // ---- preload the map the GM is preparing (hidden and paused) ----
    if (s.prep) {
      const v = ensureView(s.prep, s.view, false);
      if (s.prep.id !== liveId) { v.view.setPlaying(false); v.layer.classList.remove('shown'); }
    }

    // ---- drop views that are neither live nor prep ----
    for (const [id, v] of views) {
      if (id === liveId || (s.prep && id === s.prep.id)) continue;
      if (v.layer.classList.contains('shown') || v.layer.classList.contains('fading')) continue; // still fading out
      v.view.destroy();
      v.layer.remove();
      views.delete(id);
    }

    black.classList.toggle('on', !!s.blackout);
    black.classList.toggle('one-side', s.seats === 'one');
    setBlackLook(s.blackoutLook || null);
    const k = Math.min(innerWidth / s.view.world.w, innerHeight / s.view.world.h);
    timer.set(s.timer || null, { on: true, volume: s.sfx ? s.sfx.volume : 0.7 }, { seats: s.seats, tin: s.view.ppi * k, hud: s.hud || 1 });
    overlays.set(s, s.view);
    show.set(s.show || null, liveId && views.has(liveId) ? views.get(liveId).view : null);
    dice.set(s.dice || null, { seats: s.seats, hud: s.hud || 1, volume: s.sfx ? s.sfx.volume : 0.7 });
    FX.setQuality(s.quality);
    Moments.setQuality(s.quality);
    for (const [id, v] of views) { v.view.setQuality(s.quality); v.view.setRoundLook(s.roundLook); v.view.setHud(s.hud || 1, s.seats); v.view.setTokenLook(s.tokens); v.view.setMoments(s.moments || [], id === liveId); v.view.setDrawMode(s.animDraw); v.view.setTrails(s.trails || []); }
    if (typeof AnimCache === 'object' && s.view) AnimCache.setMemory(s.view.memGB);
    const lvw = views.get(liveId);
    if (lvw) lvw.view.setTurn(s.init ? s.init.glow : [], !!s.init);
    soundOut(s.soundOut || '');
    drawCalibration(s);
    applyPicture(s.picture);
    drawTestPicture(s.testPicture);
  }

  // ---- the picture of this TV: brightness, contrast, gamma, saturation, warmth, black level (Options → Picture) ----
  // Plain CSS filters while only brightness, contrast and saturation change (cheap for the graphics card);
  // an SVG filter once gamma, warmth or the black level come in.
  let picSig = '';
  function applyPicture(pic) {
    const p = { brightness: 1, contrast: 1, gamma: 1, saturation: 1, warmth: 0, black: 0, ...(pic || {}) };
    const sig = JSON.stringify(p);
    if (sig === picSig) return;
    picSig = sig;
    const root = document.getElementById('table-root');
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const simple = Math.abs(p.gamma - 1) < 0.005 && Math.abs(p.warmth) < 0.005 && Math.abs(p.black) < 0.002;
    if (simple) {
      const f = [];
      if (Math.abs(p.brightness - 1) > 0.002) f.push(`brightness(${r3(p.brightness)})`);
      if (Math.abs(p.contrast - 1) > 0.002) f.push(`contrast(${r3(p.contrast)})`);
      if (Math.abs(p.saturation - 1) > 0.002) f.push(`saturate(${r3(p.saturation)})`);
      root.style.filter = f.join(' ');
      return;
    }
    let svg = document.getElementById('tv-picture-svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'tv-picture-svg';
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.innerHTML = '<filter id="tv-picture" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">'
        + '<feComponentTransfer class="gam"><feFuncR type="gamma"/><feFuncG type="gamma"/><feFuncB type="gamma"/></feComponentTransfer>'
        + '<feComponentTransfer class="lin"><feFuncR type="linear"/><feFuncG type="linear"/><feFuncB type="linear"/></feComponentTransfer>'
        + '<feColorMatrix type="saturate" values="1"/></filter>';
      document.body.append(svg);
    }
    // gamma first (above 1 lifts the middle tones), then brightness and contrast around the middle, warmth per colour, black level
    const ex = r3(1 / p.gamma);
    for (const f of svg.querySelectorAll('.gam > *')) { f.setAttribute('amplitude', '1'); f.setAttribute('exponent', String(ex)); f.setAttribute('offset', '0'); }
    const gain = { R: 1 + 0.12 * p.warmth, G: 1 + 0.02 * p.warmth, B: 1 - 0.14 * p.warmth };
    for (const f of svg.querySelectorAll('.lin > *')) {
      const ch = f.tagName.slice(-1).toUpperCase();
      f.setAttribute('slope', String(r3(p.brightness * p.contrast * gain[ch])));
      f.setAttribute('intercept', String(r3(0.5 * (1 - p.contrast) + p.black)));
    }
    svg.querySelector('feColorMatrix').setAttribute('values', String(r3(p.saturation)));
    root.style.filter = 'url(#tv-picture)';
  }
  // ---- a test picture to set it by: grey steps, the darkest and brightest steps, colours; or the reference picture ----
  function drawTestPicture(on) {
    if (!on) { if (testEl.classList.contains('on')) { testEl.classList.remove('on'); testEl.innerHTML = ''; delete testEl.dataset.kind; } return; }
    const kind = on === 'reference' ? 'reference' : 'pattern';
    if (testEl.classList.contains('on') && testEl.dataset.kind === kind) return;
    testEl.classList.add('on');
    testEl.dataset.kind = kind;
    if (kind === 'reference') {
      // real maps (dark, fire, deep water, forest), a character, black and white: Options → Picture shows what to look for
      testEl.innerHTML = '<img class="tp-ref" alt="" src="calib/reference.webp">';
      return;
    }
    const grey = (v) => `rgb(${v},${v},${v})`;
    const steps = Array.from({ length: 11 }, (_, i) => Math.round((i / 10) * 255));
    const darks = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];
    const lights = [88, 90, 92, 94, 95, 96, 97, 98, 99, 100];
    const pc = (n) => Math.round((n / 100) * 255);
    const swatch = (c, label, dark) => `<div class="tp-sw" style="background:${c};color:${dark ? '#000' : '#fff'}"><span>${label}</span></div>`;
    testEl.innerHTML = `
      <div class="tp-row tp-ramp">${steps.map((v, i) => `<div style="background:${grey(v)};color:${v > 140 ? '#000' : '#fff'}"><span>${i * 10}</span></div>`).join('')}</div>
      <div class="tp-row tp-darks">${darks.map((n) => `<div style="background:${grey(pc(n))}"><span>${n}</span></div>`).join('')}</div>
      <div class="tp-row tp-lights">${lights.map((n) => `<div style="background:${grey(pc(n))}"><span>${n}</span></div>`).join('')}</div>
      <div class="tp-row tp-colours">${swatch('#ffffff', 'White', true)}${swatch('#ffff00', 'Yellow', true)}${swatch('#00ffff', 'Cyan', true)}${swatch('#00ff00', 'Green', true)}${swatch('#ff00ff', 'Magenta')}${swatch('#ff0000', 'Red')}${swatch('#0000ff', 'Blue')}</div>
      <div class="tp-row tp-colours">${swatch('#e8d3a9', 'Parchment', true)}${swatch('#c99a7c', 'Skin', true)}${swatch('#8d5a3f', 'Skin', false)}${swatch('#7d7a74', 'Stone')}${swatch('#4f6b35', 'Grass')}${swatch('#2f4f6f', 'Water')}${swatch('#3b2a1e', 'Wood')}</div>
      <div class="tp-text">Darkest row: 0 should be black and 2 just visible. Brightest row: 98 and 100 should still differ.</div>`;
  }

  // ---- frames per second on the TV, every two seconds to the GM (shown under the table preview) ----
  // with the frames that took too long (a visible hitch) and what on the map costs the most
  let fps = 0; let hitches = 0;
  function measureFps() {
    let n = 0; let t0 = performance.now(); let last = 0; let hitch = 0;
    const tick = (now) => {
      n++;
      if (last && now - last > 50) hitch++;
      last = now;
      if (now - t0 >= 2000) {
        fps = Math.round((n * 1000) / (now - t0)); hitches = hitch;
        n = 0; hitch = 0; t0 = now;
        try { window.ts.reportFps({ fps, hitches, heavy: heaviest() }); } catch {}
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const WEIGHT = { rain: 2, splash: 1, hail: 1.5, snow: 2, clouds: 2, fog: 2.6, lightning: 0.6, sand: 2.6, ash: 1.5, embers: 1.3, leaves: 1.2, petals: 1.2, fireflies: 1, spores: 1.2 };
  // the thing on the live map that is probably the hardest work for the TV, or null
  function heaviest() {
    const lv = views.get(liveId);
    if (!lv || !lv.view.map) return null;
    const v = lv.view; const m = v.map;
    const c = [];
    const b = v.bgNode;
    if (b && b.kind === 'video' && b.el.videoWidth) { const px = b.el.videoWidth * b.el.videoHeight; c.push([px / 2.07e6 * 2, px > 4e6 ? 'the 4K video map' : 'the video map']); }
    const ov = [...v.overlaysEl.children, ...v.tableOv.children].filter((x) => x.tagName === 'VIDEO').length;
    if (ov) c.push([ov * 1.3, ov === 1 ? 'the video overlay' : `${ov} video overlays`]);
    for (const L of (m.weather && m.weather.layers) || []) {
      if (L.hidden || L.dying) continue;
      const d = FXDATA.WEATHER_TYPES.find((x) => x.id === L.type);
      c.push([(WEIGHT[L.type] || 1) * (L.amount || 1), d ? d.label : 'the weather']);
    }
    const regions = m.fx.filter((f) => f.kind === 'region' && !f.hidden);
    const strokes = regions.reduce((a, f) => a + f.strokes.length, 0);
    if (regions.length) c.push([regions.length * 0.5 + strokes * 0.12, regions.length === 1 ? 'the painted effect' : `${regions.length} painted effects`]);
    const em = m.fx.filter((f) => f.kind === 'emitter' && !f.hidden).length;
    if (em) c.push([em * 0.22, `${em} effects`]);
    if (v.stats.shadowed && m.walls.length) c.push([v.stats.shadowed * (0.4 + m.walls.length / 300), `${v.stats.shadowed} lights with shadows`]);
    const mo = v.myMoments(Date.now()).length;
    if (mo) c.push([mo * 1.2, 'the screen effect']);
    c.sort((a, z) => z[0] - a[0]);
    return c.length && c[0][0] >= 1.5 ? c[0][1] : null;
  }

  let Look = null; // 4.4: smoke, parchment, embers (table-looks.js)
  let waitCover = null; // the map waiting for the table to be covered
  // ---- the ink that sweeps over the table while the map changes ----
  const Ink = (() => {
    let el = null; let phase = 'idle'; let coverP = null; let timer = 0;
    const stats = { runs: 0, covers: 0, reveals: 0 };
    function ensure() {
      if (!el) { el = document.createElement('div'); el.id = 'table-mapink'; stage.after(el); }
      return el;
    }
    // ink drips: thin runs hanging from the edge of a band (they stretch while the ink pulls back)
    function drips(w, hgt, seed) {
      let a = seed >>> 0 || 1;
      const R = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
      const base = hgt * 0.5; const n = Math.round(w / 70);
      let out = '';
      for (let i = 0; i < n; i++) {
        const x = R() * w; const dw = 3 + R() * R() * 14; const len = hgt * (0.12 + R() * 0.3);
        out += `<rect class="mi-drip" x="${(x - dw / 2).toFixed(1)}" y="${(base - len).toFixed(1)}" width="${dw.toFixed(1)}" height="${len.toFixed(1)}" rx="${(dw / 2).toFixed(1)}" style="animation-delay:${(R() * 0.18).toFixed(2)}s"/>`
          + `<circle class="mi-drip" cx="${x.toFixed(1)}" cy="${(base - len).toFixed(1)}" r="${(dw * 0.75).toFixed(1)}" style="animation-delay:${(R() * 0.18).toFixed(2)}s"/>`;
      }
      return `<svg class="mi-drips" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">${out}</svg>`;
    }
    function build() {
      // two strokes, each a little over half the table; a solid fill makes sure nothing shows while the maps swap
      const w = innerWidth; const hgt = Math.round(innerHeight * 0.82);
      const seed = 1 + Math.floor(Math.random() * 1e6);
      ensure().innerHTML = '<div class="mi-fill"></div>' + ['near', 'far'].map((side, i) => `<div class="mi-band ${side}" style="height:${hgt}px">${drips(w, hgt, seed + i * 31)}${TableOverlays.inkBand(w, hgt, seed + i * 7, { sweep: 0.55, unit: 0.06 })}</div>`).join('');
    }
    // resolves once the table is fully covered
    function cover() {
      if (phase === 'covering' || phase === 'covered') return coverP;
      clearTimeout(timer);
      build();
      phase = 'covering';
      stats.runs++;
      el.className = 'on in';
      coverP = new Promise((resolve) => { timer = setTimeout(() => { phase = 'covered'; stats.covers++; el.classList.add('full'); resolve(); }, 700); });
      return coverP;
    }
    function reveal() {
      if (phase !== 'covered') return;
      phase = 'revealing';
      el.className = 'on out';
      timer = setTimeout(() => { phase = 'idle'; stats.reveals++; el.className = ''; el.innerHTML = ''; }, 1000);
    }
    return { cover, reveal, debug: () => ({ phase, ...stats }) };
  })();

  // Prototype 7: the table's style. The look and its variant of every part, as data on <body> (styles.css draws them)
  let parchSet = false; let tryingStyle = false;
  function applyStyles(st) {
    if (tryingStyle) return; // a try shows its own for a moment
    const g = (k) => (st && st[k]) || { base: 'ink', variant: null };
    const d = document.body.dataset;
    const want = { vMap: g('map').variant || '', vTalk: g('talk').variant || '', vInit: g('init').variant || '', vRound: g('round').variant || '', lookInit: g('init').base, lookRound: g('round').base };
    for (const k in want) if (d[k] !== want[k]) d[k] = want[k];
    if (st && Object.values(st).some((x) => x && ['meadow', 'stone', 'necro', 'forest'].includes(x.base))) Looks.preload(); // (Prototype 9: the grass and leaves the meadow draws, ready before the first map change)
    if (!parchSet && (want.lookInit === 'parchment' || want.lookRound === 'parchment')) { parchSet = true; document.body.style.setProperty('--parch', `url(${Looks.parchment(1024, 256)})`); }
  }
  let peekT = 0;
  let prepMove = false; // 4.8: the GM holds the Map tool
  // 4.5: Options → Looks on the TV → Try: the look runs over the map that is there, nothing changes
  let tryStyleT = 0;
  function tryLook(e) {
    events.tries = (events.tries || 0) + 1;
    // (Prototype 7) the style of the try for a moment, should it differ from the one that is set
    if (['map', 'talk', 'init', 'round'].includes(e.what) && e.look !== 'fade') {
      const d = document.body.dataset; const K = e.what[0].toUpperCase() + e.what.slice(1);
      d[`v${K}`] = e.variant || '';
      if (e.what === 'init' || e.what === 'round') { d[`look${K}`] = e.look; if (e.look === 'parchment' && !parchSet) { parchSet = true; document.body.style.setProperty('--parch', `url(${Looks.parchment(1024, 256)})`); } }
      clearTimeout(tryStyleT); tryingStyle = true;
      tryStyleT = setTimeout(() => { tryingStyle = false; if (last) applyStyles(last.styles); }, 4500);
    }
    if (e.what === 'talk') { overlays.tryTalk(e.look, e.size); return; }
    if (e.what === 'init') { overlays.tryInit(); return; } // (Prototype 7) a sample turn order, unless the real one is there
    const v = liveId && views.get(liveId);
    if (!v || waitCover) return;
    if (e.what === 'round') { v.view.announceRound(last && last.live && last.live.round ? last.live.round.n : 1); return; }
    if (e.look === 'fade') {
      v.layer.classList.remove('shown');
      setTimeout(() => { if (views.get(liveId) === v) v.layer.classList.add('shown'); }, FADE_MS + 150);
      return;
    }
    const look = e.look === 'ink' ? Ink : (Look || (Look = Looks.makeCover(stage)));
    if (look.debug().phase !== 'idle') return;
    look.cover(e.look, last && last.live ? last.live.name : '').then(() => setTimeout(() => look.reveal(), e.look === 'ink' ? 150 : 350));
  }
  // ---- one-off events: lightning on demand (its thunder comes from the sound window) ----
  function onEvent(e) {
    if (e.kind === 'lookTry') { tryLook(e); return; }
    if (e.kind === 'prepMove') { prepMove = !!e.on; for (const x of views.values()) x.view.prepareMove(prepMove); return; } // 4.8
    if (e.kind === 'lookPeek') { // 4.5: the map without its colours while the GM holds the button (never stuck: 15 s at most)
      clearTimeout(peekT);
      for (const x of views.values()) x.view.setPeek(e.on);
      if (e.on) peekT = setTimeout(() => { for (const x of views.values()) x.view.setPeek(false); }, 15000);
      return;
    }
    if (e.kind === 'strike') {
      const v = views.get(liveId);
      if (v) v.view.strike(e.seed);
      events.strikes++;
    }
  }
  // a lightning flash in the weather: thunder follows a moment later
  function thunder(delay, volume) {
    events.thunders++;
    window.ts.soundEvent({ kind: 'thunder', delay, volume });
  }
  // background videos with sound play where the rest of the table's sound plays
  function soundOut(id) {
    for (const v of document.querySelectorAll('video')) if (v.setSinkId && (v.sinkId || '') !== id) v.setSinkId(id).catch(() => {});
  }

  // ---- calibration: a bank-card frame and an inch ruler, drawn at the current scale ----
  function drawCalibration(s) {
    if (!s.calibrating) { calib.classList.remove('on'); calib.innerHTML = ''; return; }
    calib.classList.add('on');
    const k = Math.min(innerWidth / s.view.world.w, innerHeight / s.view.world.h);
    const px = s.view.ppi * k;
    const cw = s.calibrating.cardWidthIn * px;
    const chh = cw * (53.98 / 85.6);
    const squares = Array.from({ length: 6 }, (_, i) => `<span style="width:${px}px;height:${px}px"></span>`).join('');
    calib.innerHTML = `
      <div class="calib-card" style="width:${cw}px;height:${chh}px"></div>
      <div class="calib-text">Hold a bank card inside the frame</div>
      <div class="calib-ruler">${squares}</div>
      <div class="calib-text small">Each square should be one inch</div>`;
  }

  // The blackout: plain black, the campaign's name faintly, or a dark picture; a line of text if the GM set one.
  let blackSig = '';
  function setBlackLook(look) {
    const sig = look ? JSON.stringify([look.style, look.text, look.title, look.pic && look.pic.url]) : blackSig; // keep it while fading out
    if (sig === blackSig) return;
    blackSig = sig;
    black.innerHTML = '';
    black.dataset.style = look.style;
    if (look.style === 'picture' && look.pic) {
      const m = look.pic.kind === 'video' ? Object.assign(document.createElement('video'), { muted: true, loop: true, autoplay: true, src: look.pic.url }) : Object.assign(document.createElement('img'), { alt: '', src: look.pic.url });
      m.className = `blk-pic ${look.pic.builtin ? 'fit' : ''}`;
      black.append(m);
    }
    for (const side of ['near', 'far']) {
      const f = document.createElement('div');
      f.className = `blk-face ${side}`;
      if (look.style === 'title') { const n = document.createElement('div'); n.className = 'blk-title'; n.textContent = look.title || ''; f.append(n); }
      if (look.text) { const t = document.createElement('div'); t.className = 'blk-text'; t.textContent = look.text; f.append(t); }
      black.append(f);
    }
  }

  // Read-only snapshot for the self-test.
  function debug() {
    if (!black) return null; // not started yet
    const lv = views.get(liveId);
    const media = (v) => v && { t: v.currentTime, paused: v.paused, readyState: v.readyState };
    return {
      liveId,
      dice: dice ? dice.debug() : null,
      views: [...views.keys()],
      shown: [...views.entries()].filter(([, v]) => v.layer.classList.contains('shown')).map(([id]) => id),
      bg: lv && lv.view.bgNode ? media(lv.view.bgNode.el) : null,
      overlays: lv ? [...lv.view.overlaysEl.children, ...lv.view.tableOv.children].map((o) => ({ ...media(o), blend: getComputedStyle(o).mixBlendMode })) : [],
      tokensVisible: lv ? [...lv.view.tokensEl.children].filter((t) => t.style.display !== 'none').length : 0,
      tokensTotal: lv ? lv.view.tokensEl.children.length : 0,
      tags: lv ? [...lv.view.tagsEl.querySelectorAll('.sv-token-tag')].filter((t) => t.style.display !== 'none' && t.parentNode.style.display !== 'none').map((t) => ({ text: t.dataset.name, far: t.dataset.both === '1' })) : [],
      prepPaused: [...views.entries()].filter(([id]) => id !== liveId).map(([, v]) => (v.view.bgNode && v.view.bgNode.kind === 'video' ? v.view.bgNode.el.paused : true)),
      blackout: black.classList.contains('on'),
      blackLook: black.classList.contains('on') ? { style: black.dataset.style || 'black', title: (black.querySelector('.blk-title') || {}).textContent || null, text: (black.querySelector('.blk-text') || {}).textContent || null, pic: !!black.querySelector('.blk-pic') } : null,
      calibrating: calib.classList.contains('on'),
      fogOps: lv && lv.view.map ? lv.view.map.fog.ops.length : 0,
      fx: lv ? { ...lv.view.stats, animating: !!lv.view.raf } : null,
      assets: lv ? [...lv.view.assetsEl.children, ...lv.view.assetsFrontEl.children].filter((el) => el.style.display !== 'none').length : 0,
      // 2.3: animated assets drawn from frame sheets, videos still playing, assets resting off the table
      anim: lv ? lv.view.animInfo() : null,
      mapView: lv && lv.view.map ? { ...lv.view.map.view, bg: lv.view.map.bg ? { path: lv.view.map.bg.path, x: lv.view.map.bg.x, y: lv.view.map.bg.y, scale: lv.view.map.bg.scale, rotation: lv.view.map.bg.rotation || 0 } : null, grid: { size: lv.view.map.grid.size, ox: lv.view.map.grid.ox, oy: lv.view.map.grid.oy } } : null,
      // 0.5: numbers on tokens, drawings, markers, ink, round, countdown
      tokenNumbers: lv ? [...lv.view.tokensEl.querySelectorAll('.sv-token')].filter((t) => t.style.display !== 'none').map((t) => t.querySelector('.sv-token-n').textContent).filter(Boolean) : [],
      pens: lv ? lv.view.penSvg.querySelectorAll('g').length : 0,
      texts: lv ? [...lv.view.annoEl.querySelectorAll('.sv-text')].map((t) => t.textContent) : [],
      marks: lv ? [...lv.view.annoEl.querySelectorAll('.sv-mark')].map((m) => m.className.match(/kind-(\w+)/)[1]) : [],
      counters: lv ? [...lv.view.annoEl.querySelectorAll('.sv-mark.kind-counter')].map((m) => `${m.querySelector('.sv-counter-label').textContent}=${m.querySelector('.sv-counter-val').textContent}`) : [],
      notes: lv ? lv.view.notesEl.children.length : 0,
      chalk: lv ? lv.view.chalk.size : 0,
      // what is really on screen, not just in memory
      spot: lv ? !!lv.view.spot && getComputedStyle(lv.view.spotEl).display !== 'none' : false,
      measure: lv && lv.view.measureState && getComputedStyle(lv.view.measureEl).display !== 'none' ? lv.view.measureEl.textContent : null,
      round: lv && lv.view.roundEl.style.display !== 'none' ? lv.view.roundEl.textContent : null,
      timer: timer.debug(),
      // 0.6: talk, handouts, break, initiative, soundboard, lightning
      over: overlays.debug(),
      events: { strikes: events.strikes, thunders: events.thunders },
      turnGlow: lv ? lv.view.tokensEl.querySelectorAll('.sv-token.is-turn').length : 0,
      weather: lv ? lv.view.stats.weather : null,
      vision: lv ? lv.view.visionInfo() : null,
      strokeAges: lv && lv.view.map ? lv.view.map.fx.filter((f) => f.kind === 'region').map((f) => [f.preset, f.strokes.map((st) => (st.t0 ? Date.now() - st.t0 : null))]) : null,
      hud: lv ? { scale: lv.view.hud, round: [lv.view.roundEl, lv.view.roundEl2].filter((e) => e.style.display !== 'none' && e.textContent).length, roundPx: parseFloat(lv.view.roundEl.style.fontSize) || 0 } : null,
      // 0.9: where the round sits, its banner, the light now, rooms revealed, the ink between maps
      roundAt: lv ? [lv.view.roundEl, lv.view.roundEl2].map((e) => (e.style.display === 'none' ? null : { x: Math.round(parseFloat(e.style.left)), y: Math.round(parseFloat(e.style.top)) })) : null,
      roundBanner: lv ? lv.view.roundBanners.filter((b) => b.classList.contains('go')).map((b) => b.textContent) : [],
      banners: lv ? lv.view.stats.banners || 0 : 0,
      world: lv ? { w: lv.view.W, h: lv.view.H } : null,
      light: lv && lv.view.map ? { ...Vision.lightNow(lv.view.map.light), drawn: lv.view.stats.darkness, mood: lv.view.map.light.mood || null } : null,
      gridUnder: lv ? lv.view.cv.grid.el.nextElementSibling === lv.view.mapA2 : null,
      mapInk: Ink.debug(), mapLook: Look ? Look.debug() : null, liveMap: liveId, liveMoves: lv ? lv.view.stats.liveMoves || 0 : 0, viewLive: !!(lv && lv.view.live), // 4.4
      fps,
      hitches,
      heavy: heaviest(),
      quality: lv ? { level: lv.view.quality, atmoW: lv.view.cv.atmo.el.width, gap: lv.view.frameGap || 0 } : null,
      // 1.3: picture settings, test picture, screen moments
      picture: { filter: document.getElementById('table-root').style.filter, svg: (() => { const f = document.querySelector('#tv-picture .lin feFuncR'); return f ? { slope: Number(f.getAttribute('slope')), intercept: Number(f.getAttribute('intercept')) } : null; })() },
      testPicture: testEl.classList.contains('on') ? (testEl.dataset.kind === 'reference' ? 'reference' : testEl.querySelectorAll('.tp-row > div').length) : 0,
      refLoaded: (() => { const i = testEl.querySelector('.tp-ref'); return i ? i.complete && i.naturalWidth > 0 : null; })(),
      moments: lv ? { drawn: lv.view.stats.moments || [], transform: lv.view.root.style.transform, filter: lv.view.root.style.filter, frozen: !!lv.view.freezeAt, cover: coverage('moment') } : null,
    };
  }
  // line of sight on the TV: does the party see this point (map inches)?
  function sees(x, y) { const lv = views.get(liveId); return lv ? lv.view.seesPoint(x, y) : null; }
  // how dark the fog is at a map point (0 clear .. 255 covered), from the composed fog canvas
  function fogAt(x, y) {
    const lv = views.get(liveId);
    if (!lv) return null;
    const v = lv.view; const c = v.fogEl;
    const p = v.mapToPx(x, y);
    const d = c.getContext('2d').getImageData(Math.round((p.x + 40) * 0.5), Math.round((p.y + 40) * 0.5), 1, 1).data;
    return d[3];
  }

  // Pixel probe for the self-test: RGBA of a canvas layer of the live map at table pixel (x, y).
  function probe(layer, x, y) {
    const lv = views.get(liveId);
    if (!lv) return null;
    const c = layer === 'fog' ? { el: lv.view.fogEl, res: 0.5, off: lv.view.fogM || 40 } : { ...lv.view.cv[layer], off: 0 }; // (4.8: a wide margin while the Map tool is in hand)
    const d = c.el.getContext('2d').getImageData(Math.round((x + c.off) * c.res), Math.round((y + c.off) * c.res), 1, 1).data;
    return [...d];
  }

  // the same at a point in map inches
  function probeMap(layer, x, y) {
    const lv = views.get(liveId);
    if (!lv) return null;
    const p = lv.view.mapToPx(x, y);
    return probe(layer, p.x, p.y);
  }

  // Share of non-transparent pixels in a canvas layer of the live map (sampled).
  function coverage(layer) {
    const lv = views.get(liveId);
    if (!lv) return 0;
    const el = layer === 'fog' ? lv.view.fogEl : lv.view.cv[layer].el;
    const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let n = 0; let hit = 0;
    for (let i = 3; i < d.length; i += 16) { n++; if (d[i] > 8) hit++; }
    return n ? hit / n : 0;
  }

  // self-test: whether the TV shows an effect or light of the live map
  function fxShown(id) { const lv = views.get(liveId); const f = lv && lv.view.map && lv.view.map.fx.find((x) => x.id === id); return f ? lv.view.shown(f) : null; }
  return { start, debug, probe, probeMap, coverage, sees, fogAt, fxShown };
})();
window.__table = { debug: () => Table.debug(), probe: (l, x, y) => Table.probe(l, x, y), probeMap: (l, x, y) => Table.probeMap(l, x, y), coverage: (l) => Table.coverage(l), sees: (x, y) => Table.sees(x, y), fogAt: (x, y) => Table.fogAt(x, y), fxShown: (id) => Table.fxShown(id) };
