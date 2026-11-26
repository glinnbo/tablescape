// Effects, light, darkness and weather
'use strict';

module.exports = (area) => {
  area.title('Effects, light and weather');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Light (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });

  const M = (t) => t.store.map(own);
  // as on a PC without a graphics card (true), on any PC (trees.js has the same): the engine's tiles and water drop out
  const noCard = async (t, on) => { await t.g(`Trees.never(${on})`); await t.t(`Trees.never(${on})`); await t.settle(); };
  const clean = async (t) => {
    if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); }
    for (const f of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: f.id });
    for (const w of [...M(t).weather.layers]) t.handle('weather.remove', { mapId: own, id: w.id });
    t.handle('light.update', { mapId: own, darkness: 0 });
    await t.settle();
    return M(t);
  };
  // (Beta 3.60) Effects → Elements: pick an effect by its tile ('r:mist', 'e:smoke'), a shape tool at the side
  const element = async (t, key) => { await t.g(`(() => { Play.setTool('fx'); if (Play.ui.fxMode !== 'place' && Play.ui.fxMode !== 'paint') Play.ui.fxMode = 'paint'; if (Play.ui.region === 'roof') Play.ui.region = 'mist'; if (Play.ui.emitter === 'window' || Play.ui.emitter === 'shaft') Play.ui.emitter = 'smoke'; Play.ui.fxFam = 'all'; Play.openPop('fx'); document.querySelector('#pop .fx-gal .fx-t[data-v="${key}"]').click(); })()`); await t.sleep(250); }; // (Beta 3.64: a daylight in hand is Lights)
  const select = async (t) => { await t.g(`(() => { if (!document.querySelector('#pop .os-tabs2')) { Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx'); } const b = document.querySelector('#pop .os-tabs2 .tile[data-v="fxt-select"]'); if (b && !b.classList.contains('on')) b.click(); })()`); await t.sleep(250); }; // (Beta 3.66: markers and outlines show with the Select tool, and only it picks)
  const shape = async (t, v) => { await t.g(`document.querySelector('#pop .os-tabs2 .tile[data-v="fxt-${v}"]').click()`); await t.sleep(250); };
  // how dark the TV is at a point of the map: 0 (lit) to 255 (black)
  const dark = async (t, x, y) => { const p = await t.t(`window.__table.probeMap('light', ${x}, ${y})`); return p ? p[3] : null; };

  area.quick('E opens Effects; a click on the map places a torch that gives light (Beta 3.54: Light sources → Flame)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.key('E');
    t.eq(await t.tool(), 'fx', 'the tool after E');
    t.eq(await t.popTitle(), 'Effects', 'the panel after E');
    await t.g(`Object.assign(Play.ui.lt, { group: 'flame', flame: 'torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    const at = await t.scr(18 * k, 6 * k);
    await t.click(at.x, at.y);
    await t.until(() => M(t).fx.length === 1, 3000, 'the effect');
    const torch = M(t).fx[0];
    t.eq(torch.preset, 'torch', 'what was placed');
    t.ok(torch.bright > 0, 'it gives light', torch);
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && (d.fx.emitters >= 1 || d.fx.lights >= 1 || d.fx.particles > 0); }, 4000, 'the torch on the TV').catch(async (e) => { throw new Error(`${e.message} (the TV says ${JSON.stringify((await t.tvDebug()).fx)})`); });
  });

  area.quick('an effect\'s marker can be dragged to move it', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const r = await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'torch', x: 18 * k, y: 6 * k, r: 1 });
    t.gm().webContents.focus();
    await t.key('E');
    const id = M(t).fx[0].id;
    t.eq(await t.count(`.sv-handle[data-id="${id}"]`), 0, 'no marker without the Select tool (Beta 3.66)');
    await select(t);
    const h = await t.until(() => t.rect(`.sv-handle[data-id="${id}"]`), 3000, 'the marker');
    const a = { ...M(t).fx[0] };
    await t.drag({ x: h.cx, y: h.cy }, { x: h.cx + 60, y: h.cy + 30 }, 6);
    const b = M(t).fx[0];
    t.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0.2 * k, 'the effect moved', [a.x, a.y, b.x, b.y, r]);
  });

  // M2 (open point): an effect's Speed changed: its own clock goes on from where it was (no jump), at the new pace
  area.quick('changing an effect\'s Speed doesn\'t make it jump: its clock goes on from where it was', async (t) => {
    const F = require('../../renderer/fx-data');
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'torch', x: 14 * k, y: 7 * k, r: 1, bright: 20, dim: 20 });
    const id = M(t).fx[0].id;
    const now = () => Date.now() / 1000 - F.TBASE;
    for (const sp of [2.5, 0.35, 1.7]) {
      const before = F.phaseT(M(t).fx.find((f) => f.id === id), now());
      t.handle('fx.update', { mapId: own, id, speed: sp });
      const fx = M(t).fx.find((f) => f.id === id);
      const after = F.phaseT(fx, now());
      t.ok(Math.abs(after - before) < 0.05, `to Speed ${sp}: the clock goes on where it was`, [before, after]);
      t.near(F.phaseT(fx, now() + 1) - F.phaseT(fx, now()), sp, 0.01, `and runs at ${sp}`);
    }
  });

  // M1 (open point): a geyser building up: two frames close together look nearly the same (before, the bubbles and
  // rings jumped to new places every frame, as their rate rose with the time multiplied in)
  area.quick('a geyser building up changes little from one frame to the next', async (t) => {
    const r = await t.g(`(() => {
      const fx = { id: 'm1-geyser', kind: 'emitter', preset: 'geyser', r: 3, intensity: 1, speed: 1 };
      // (at the real clock, millions of seconds: where the old rate × time jumped most) the next eruption from now
      const T = Date.now() / 1000 - 1.7e9; let te = null;
      for (let tt = T; tt < T + 200 && te == null; tt += 0.05) if (Creatures.erupting(fx, tt) && !Creatures.erupting(fx, tt - 0.05)) te = tt;
      const tb = te - 3; // three seconds before it erupts
      const shot = (tt) => { const c = document.createElement('canvas'); c.width = 240; c.height = 240; const g = c.getContext('2d'); g.setTransform(30, 0, 0, 30, 0, 0); FX.emitter(g, fx, 4, 4, tt, 1); return g.getImageData(0, 0, 240, 240).data; };
      const a = shot(tb); const b = shot(tb + 1 / 120);
      let moved = 0; let lit = 0;
      for (let i = 3; i < a.length; i += 4) { if (a[i] > 20 || b[i] > 20) lit++; if (Math.abs(a[i] - b[i]) > 60) moved++; }
      return { moved, lit, share: lit ? moved / lit : 0 };
    })()`);
    t.ok(r.lit > 200, 'the geyser is drawn', r);
    t.ok(r.share < 0.015, 'what changed in 1/120 s of the build-up (the old code: about 3 %; the new about 1 %)', r); // (Beta 3.68: was 0.01, failed now and then at 1.05 %)
  });

  // K6 (open point): a fire that is put out draws nothing, so with nothing else moving the TV stops redrawing
  area.quick('a fire put out lets the TV rest; lit again, it moves again', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'torch', x: 14 * k, y: 7 * k, r: 1, bright: 20, dim: 20 });
    const id = M(t).fx[0].id;
    await t.until(async () => (await t.tvDebug()).fx.animating, 4000, 'the TV draws the flame');
    await t.cmd('fx.lit', { mapId: own, id, on: false });
    await t.until(async () => !(await t.tvDebug()).fx.animating, 4000, 'put out: the TV rests');
    await t.cmd('fx.lit', { mapId: own, id, on: true });
    await t.until(async () => (await t.tvDebug()).fx.animating, 4000, 'lit again: it moves');
  });

  // K1/K2 (open points): a painted mist makes its fill patterns and its mask once, not again every frame. Drawn here
  // straight onto a canvas, 20 frames (a test TV behind the GM window draws nothing: the browser rests covered windows)
  area.quick('a painted mist makes no new fill patterns or masks from frame to frame', async (t) => {
    const r = await t.g(`(() => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360; const ctx = c.getContext('2d');
      ctx.setTransform(20, 0, 0, 20, 0, 0);
      const f = { id: 'k2-test', kind: 'region', preset: 'mist', intensity: 1, density: 1, speed: 1, strokes: [{ sid: 'a', r: 2, pts: [6, 8, 24, 8] }] };
      const P = CanvasRenderingContext2D.prototype; const cp = P.createPattern; const mk = document.createElement; let pats = 0; let cans = 0;
      FX.region(ctx, f, 1e8, 1); // (warm: its tiles, patterns and mask)
      P.createPattern = function (...a) { pats++; return cp.apply(this, a); };
      document.createElement = function (tag, ...a) { if (String(tag).toLowerCase() === 'canvas') cans++; return mk.call(this, tag, ...a); };
      try { for (let i = 1; i <= 20; i++) FX.region(ctx, f, 1e8 + i / 30, 1); } finally { P.createPattern = cp; document.createElement = mk; }
      return { pats, cans };
    })()`);
    t.eq(r, { pats: 0, cans: 0 }, 'new patterns and new canvases in 20 frames of mist (were 2 to 4 patterns a frame)');
  });

  // a light a token carries: its marker is a badge on the token's rim (upper left), not on its face; a click picks it
  area.quick('a carried light\'s marker sits on the token\'s rim, upper left, and a click picks the light', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const tid = (await t.cmd('layer.add', { mapId: own, path: t.pic('tokens', /Goblin/i), role: 'token', x: 12.5 * k, y: 8.5 * k, size: 1 })).selected;
    try {
      await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'torch', attachTo: tid, x: 12.5 * k, y: 8.5 * k, bright: 20, dim: 20 });
      const fid = M(t).fx.find((f) => f.attachTo === tid).id;
      t.gm().webContents.focus();
      await t.key('E');
      await select(t);
      const h = await t.until(() => t.rect(`.sv-handle.rim[data-id="${fid}"]`), 3000, 'the marker on the rim');
      const tk = await t.rect(`.sv-token[data-id="${tid}"]`);
      const d = Math.hypot(h.cx - tk.cx, h.cy - tk.cy);
      t.ok(h.cx < tk.cx && h.cy < tk.cy && d > tk.w * 0.4, 'upper left, out on the rim (not on the face)', { h, tk, d });
      await t.click(h.cx, h.cy);
      await t.until(() => t.g(`Play.ui.selFx === ${JSON.stringify(fid)}`), 3000, 'a click picks the light');
    } finally { await t.cmd('layer.remove', { mapId: own, id: tid }); }
  });

  // Beta 3.9: a map turned with everything on it. A painted area away from the middle kept its old cut-out (its
  // points moved, their number did not), so it showed nothing at its new place.
  area.quick('painted areas follow when the map is turned, also away from the middle (Beta 3.9)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const geo = await t.g(`(() => { const v = Play.view(); const p = v.bgPlacement(); const r = v.tableRectInMap(); return { p, r }; })()`);
    const piv = { x: geo.r.x + geo.r.w / 2, y: geo.r.y + geo.r.h / 2 };
    const cen = { x: geo.p.x + geo.p.w / 2, y: geo.p.y + geo.p.h / 2 };
    const rot0 = m.bg.rotation || 0;
    const a = { x: piv.x + 5 * k, y: piv.y };
    const areas = { water: 'atmo', mist: 'atmo', ice: 'atmo', darkness: 'veil', sway: 'sway' };
    for (const preset of Object.keys(areas)) t.handle('fx.stroke', { mapId: own, id: `turn-${preset}`, preset, sid: 's1', r: 1.2 * k, pts: [a.x - 0.5 * k, a.y, a.x + 0.5 * k, a.y] });
    const drawn = (x, y) => t.t(`(() => { const o = {}; for (const [p, L] of ${JSON.stringify(Object.entries(areas))}) { const q = window.__table.probeMap(L, ${x}, ${y}); o[L] = Math.max(o[L] || 0, q ? q[3] : 0); } return o; })()`);
    const all = (d) => d && Object.values(d).every((v) => v > 0);
    try {
      await t.until(async () => all(await drawn(a.x, a.y)), 6000, 'the areas on the TV');
      t.handle('bg.turn', { mapId: own, to: rot0 + 90, mode: 'all', pivot: piv, center: cen });
      const s = M(t).fx.find((f) => f.id === 'turn-water').strokes[0].pts;
      const b = { x: (s[0] + s[2]) / 2, y: (s[1] + s[3]) / 2 };
      t.near(b.x, piv.x, 0.01, 'a quarter turn round the middle of the table: the area lies below it now'); t.near(b.y, piv.y + 5 * k, 0.01, 'five squares below');
      await t.until(async () => all(await drawn(b.x, b.y)), 6000, 'every area to be drawn at its new place').catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await drawn(b.x, b.y))}`); });
      t.eq(Object.values(await drawn(a.x, a.y)).filter((v) => v > 0).length, 0, 'layers that still show something at the old place');
    } finally {
      t.handle('bg.turn', { mapId: own, to: rot0, mode: 'all', pivot: piv, center: cen });
    }
  });

  area.quick('Sway moves the map picture where it is painted, and nothing else (Beta 3.1)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.handle('fx.stroke', { mapId: own, id: 'sway-test', preset: 'sway', sid: 's1', r: 2 * k, pts: [6 * k, 6 * k, 10 * k, 6.5 * k, 14 * k, 6 * k] });
    await t.until(async () => (await t.t(`window.__table.coverage('sway')`)) > 0.005, 6000, 'the Sway layer on the TV');
    const probe = (x, y) => t.t(`window.__table.probeMap('sway', ${x}, ${y})`);
    const at = [[8 * k, 6 * k], [10 * k, 6.3 * k], [12 * k, 6 * k], [9 * k, 5.5 * k]];
    const a = []; for (const [x, y] of at) a.push(await probe(x, y));
    t.ok(a.every((p) => p && p[3] > 200), 'inside the painted area the layer shows the map picture', a);
    await t.sleep(700);
    const b = []; for (const [x, y] of at) b.push(await probe(x, y));
    const moved = a.some((p, i) => p && b[i] && Math.abs(p[0] - b[i][0]) + Math.abs(p[1] - b[i][1]) + Math.abs(p[2] - b[i][2]) > 6);
    t.ok(moved, 'it moves', { a, b });
    const out = await probe(24 * k, 14 * k);
    t.ok(!out || out[3] === 0, 'outside the painted area nothing is drawn', out);
    // (Beta 3.2) the map's colours (Build → Map) go over the moving picture too, so Sway doesn't change the colours
    t.handle('bg.look', { mapId: own, sat: 0.3, warm: 0.5 });
    const looks = () => t.t(`(() => { const L = document.querySelector('.tv-layer.shown'); return [L.querySelector('.sv-bg').style.filter, L.querySelector('.sv-sway').style.filter]; })()`);
    await t.until(async () => { const [a1, b1] = await looks(); return !!a1 && a1 === b1; }, 3000, 'the map\'s colours on the Sway layer too');
    t.handle('bg.look', { mapId: own, bright: 1, contrast: 1, sat: 1, warm: 0 });
    await t.until(async () => { const [a1, b1] = await looks(); return !a1 && !b1; }, 3000, 'plain colours on both again');
    t.handle('fx.remove', { mapId: own, id: 'sway-test' });
    await t.until(async () => (await t.t(`window.__table.coverage('sway')`)) === 0, 4000, 'the layer empty again');
  });

  area.quick('Roof keeps the weather off where it is painted, and only there (Beta 3.1)', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    // (underwater light: it covers the whole map; fog banks and sand drift in patches and made the check flaky)
    t.handle('weather.preset', { mapId: own, name: 'Underwater', layers: [{ type: 'caustics', amount: 2, opacity: 1, speed: 1 }] });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) > 0.05, 6000, 'the weather on the TV');
    // how many of 35 points in a box (in squares) have weather on them
    const hits = (x0, y0, x1, y1) => t.t(`(() => { let n = 0; for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) { const p = window.__table.probeMap('weather', ${x0 * k} + (${(x1 - x0) * k}) * (i + 0.5) / 7, ${y0 * k} + (${(y1 - y0) * k}) * (j + 0.5) / 5); if (p && p[3] > 3) n++; } return n; })()`);
    const roofBox = [7, 5.5, 13, 9]; const outBox = [14, 5.5, 20, 9];
    await t.until(async () => (await hits(...roofBox)) >= 4, 6000, 'before: the weather over the house too'); // (it drifts in)
    t.handle('fx.stroke', { mapId: own, id: 'roof-test', preset: 'roof', sid: 's1', r: 3 * k, pts: [6 * k, 7.25 * k, 14 * k, 7.25 * k] });
    await t.until(async () => (await hits(...roofBox)) === 0, 6000, 'no weather under the roof');
    await t.until(async () => (await hits(...outBox)) >= 4 && (await hits(...roofBox)) === 0, 6000, 'the weather to go on outside it (and stay off under it)'); // (the drifting weather is patchy)
    t.handle('fx.remove', { mapId: own, id: 'roof-test' });
    t.handle('weather.preset', { mapId: own, name: 'None', layers: [] });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) === 0, 6000, 'the weather gone again');
  });

  area.deep('in the dark a light opens a hole: lit near the torch, dark far from it; at 100 % the rest is pitch black', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 10 * k, y: 8 * k, r: 4 * k });
    await t.cmd('light.update', { mapId: own, darkness: 0.7 });
    const far = await t.until(async () => { const v = await dark(t, 24 * k, 14 * k); return v > 120 && v; }, 15000, 'the darkness on the TV');
    const near = await dark(t, 10 * k, 8 * k);
    t.ok(near < far - 60, 'it is clearly lighter at the torch', [near, far]);
    t.ok(far < 250, 'at 70 % the map still shows through', far);
    await t.cmd('light.update', { mapId: own, darkness: 1 });
    await t.until(async () => (await dark(t, 24 * k, 14 * k)) >= 250, 15000, 'pitch black far from the light');
    t.ok(await dark(t, 10 * k, 8 * k) < 150, 'the torch still cuts through', await dark(t, 10 * k, 8 * k));
  }, { ms: 60000 });

  // Beta 3.68 (Glinn: a wall torch beside a door lit the whole far side through the thin wall line): a light on a wall
  // lights only its own side of that wall; doors and windows in the same wall let none of it through
  area.quick('Beta 3.68: a wall torch beside an open door lights only its own side of the wall', async (t) => {
    const r = await t.g(`(() => {
      const walls = [{ id: 'a', x1: 5, y1: 0, x2: 5, y2: 2 }, { id: 'd', x1: 5, y1: 2, x2: 5, y2: 3, door: 1, open: true },
        { id: 'b', x1: 5, y1: 3, x2: 5, y2: 6 }, { id: 'win', x1: 5, y1: 6, x2: 5, y2: 7, kind: 'window' }, { id: 'c', x1: 5, y1: 7, x2: 5, y2: 9 }];
      const map = { id: 'zz-walltorch', grid: { size: 1 }, vision: { on: true }, walls, layers: [], fx: [] };
      const torch = { id: 't', kind: 'emitter', holder: 'wall_torch', wall: 'b', x: 4.6, y: 3.3, rotation: 90 };
      const onLine = { ...torch, id: 't2', x: 5, y: 4.5 };
      const at = (p, x, y) => !!p && Vision.inPoly(p, x, y);
      const T = Vision.lightPoly(map, torch.x, torch.y, 12, torch);
      const plain = Vision.lightPoly(map, torch.x, torch.y, 12, { id: 'p', kind: 'light', x: torch.x, y: torch.y });
      const L = Vision.lightPoly(map, onLine.x, onLine.y, 12, onLine);
      return { room: at(T, 3, 1), roomBelow: at(T, 3, 8), door: at(T, 8, 0.5), window: at(T, 5.5, 10.5), plainDoor: at(plain, 8, 0.5),
        lineRoom: at(L, 3, 4.5), lineFar: at(L, 7, 4.5) };
    })()`);
    t.ok(r.room && r.roomBelow, 'it lights its own room', r);
    t.ok(!r.door && !r.window, 'nothing through the open door or the window beside it', r);
    t.ok(r.plainDoor, 'a light that is not on a wall still shines through the open door', r);
    t.ok(r.lineRoom && !r.lineFar, 'a wall torch right on the line: its side from the way it is turned', r);
  });

  // Beta 3.49: the lights that come with the app (a picture with the app's own flame or glow on it), from Light sources
  // on any map: a lamp post where clicked, a wall torch on the wall near the click; a wall stops its light
  area.deep('Beta 3.49: Light sources → With its holder: a lamp post where clicked gives light; a wall torch sits on the wall near the click and the wall stops its light', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'wall_torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .light-card .tile')].map((b) => b.textContent.trim())`), ['Wall torch', 'Wall lantern', 'Lamp post', 'Street lamp', 'Candles', 'Cooking fire'], 'Holder: the six lights with their holder');
    await t.clickText('#pop .light-card .tile', 'Lamp post');
    let at = await t.scr(10 * k, 8 * k); await t.click(at.x, at.y);
    const lamp = await t.until(() => M(t).fx.find((f) => f.holder), 4000, 'a lamp post');
    const glow = lamp;
    t.eq([lamp.holder, glow.kind, glow.preset, glow.bright, glow.dim, glow.hidden, glow.lit], ['lamp_post', 'emitter', 'glow', 30, 60, false, undefined], 'one light: its holder and a glow with a lantern\'s light', glow);
    t.ok(Math.abs(lamp.x - 10 * k) < 0.1 * k && Math.abs(lamp.y - 8 * k) < 0.1 * k && !M(t).layers.some((l) => l.fixture), 'where clicked; no picture of its own', [lamp.x, lamp.y]);
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${lamp.id}"]`)) === 1, 3000, 'its holder drawn on your screen');
    await t.cmd('light.update', { mapId: own, darkness: 1 });
    await t.until(async () => (await dark(t, 24 * k, 14 * k)) >= 250, 15000, 'pitch black far from the lamp');
    t.ok(await dark(t, 10.5 * k, 8.5 * k) < 150, 'the lamp cuts through the dark', await dark(t, 10.5 * k, 8.5 * k));
    // a wall, and a wall torch clicked beside it: on the wall, turned to it; no light behind the wall
    t.handle('fx.remove', { mapId: own, id: lamp.id });
    t.eq(M(t).fx.length, 0, 'the lamp gone with its glow');
    t.handle('wall.add', { mapId: own, segs: [[16 * k, 4 * k, 16 * k, 12 * k]] });
    await t.settle();
    await t.clickText('#pop .light-card .tile', 'Wall torch');
    at = await t.scr(16.4 * k, 8 * k); await t.click(at.x, at.y);
    const torch = await t.until(() => M(t).fx.find((f) => f.holder), 4000, 'a wall torch');
    t.ok(torch.x > 16.1 * k && torch.x < 16.5 * k && Math.abs(Math.abs(torch.rotation) - 90) < 1, 'on the wall\'s side that was clicked, turned to the wall', [torch.x / k, torch.rotation]);
    await t.until(async () => (await dark(t, 17.5 * k, 8 * k)) < 150, 15000, 'light in front of the wall');
    t.ok(await dark(t, 14 * k, 8 * k) >= 250, 'none behind it', await dark(t, 14 * k, 8 * k));
    t.ok(torch.wall && M(t).walls.some((w) => w.id === torch.wall), 'hung on that wall', torch.wall);
    t.handle('fx.remove', { mapId: own, id: torch.id });
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
  }, { ms: 90000 });

  // Beta 3.68 (Glinn): Layers: a section folds at its title; two or more of a kind are one row (folded) that opens to each
  area.quick('Beta 3.68: Layers: sections fold, and three candles are one row that opens to each', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (let i = 0; i < 3; i++) t.handle('fx.add', { mapId: own, kind: 'light', preset: 'candle', x: (4 + i) * k, y: 4 * k, bright: 5, dim: 10 });
    t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 9 * k, y: 4 * k, bright: 20, dim: 40 });
    await t.settle();
    await t.g(`Play.ui.lyFold = {}; Play.setTool('select'); Play.openPop('layers')`);
    await t.until(async () => (await t.count('#pop .layer-kind')) === 1, 3000, 'Layers with one kind row');
    const kindRow = () => t.g(`(() => { const r = document.querySelector('#pop .layer-kind'); return r && { text: r.querySelector('.layer-main').textContent.trim(), n: r.querySelector('.layer-n').textContent }; })()`);
    const kr = await kindRow();
    t.ok(kr && kr.n === '3' && !/Torch/.test(kr.text), 'the three candles: one row with 3', kr);
    t.eq(await t.count('#pop .layer-row.in-kind'), 0, 'folded at first');
    t.eq(await t.count('#pop .layer-row:not(.layer-kind):not(.in-kind)'), 1, 'the torch has its own row');
    await t.clickSel('#pop .layer-kind .layer-main');
    await t.until(async () => (await t.count('#pop .layer-row.in-kind')) === 3, 3000, 'opened: each candle');
    await t.clickSel('#pop .layer-kind .lt-bulb');
    await t.until(() => M(t).fx.filter((f) => f.preset === 'candle').every((f) => f.lit === false), 3000, 'its bulb puts them all out');
    t.ok(M(t).fx.find((f) => f.preset === 'torch').lit !== false, 'the torch stays lit');
    await t.clickSel('#pop .layer-kind .icon-btn[aria-label^="Hide them all"]');
    await t.until(() => M(t).fx.filter((f) => f.preset === 'candle').every((f) => f.hidden), 3000, 'its eye hides them all');
    await t.clickSel('#pop .layer-group[data-g="Lights"]');
    await t.until(async () => (await t.count('#pop .layer-row')) === 0, 3000, 'Lights folded: no rows');
    t.eq(await t.text('#pop .layer-group[data-g="Lights"] .layer-n'), '4', 'the folded section says how many');
    await t.clickSel('#pop .layer-group[data-g="Lights"]');
    await t.until(async () => (await t.count('#pop .layer-row.in-kind')) === 3, 3000, 'open again, as it was left');
    await t.clickSel('#pop .layer-kind .icon-btn[aria-label="Remove them all"]');
    await t.until(() => M(t).fx.length === 1, 3000, 'its trash removes the three');
    await t.cmd('history.undo', { mapId: own });
    await t.until(() => M(t).fx.length === 4, 3000, 'one Undo brings all three back');
    await t.g(`Play.closePop()`);
  });

  // Beta 3.68 (Glinn): Effects → Lights shows where a click puts the light, as Draw does; Select and Place beside it
  // are solid (the one on was see-through)
  area.deep('Beta 3.68: Effects → Lights shows where the next light goes; Select and Place are solid', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    t.handle('wall.add', { mapId: own, segs: [[16 * k, 4 * k, 16 * k, 12 * k]] });
    await t.settle();
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'wall_torch', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.ui.fxSel = false; Play.openPop('fx')`);
    await t.sleep(400);
    const bg = await t.g(`[...document.querySelectorAll('.os-tabs2.g-lights .tile')].map((b) => getComputedStyle(b).backgroundImage !== 'none' || !/rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(b).backgroundColor))`);
    t.ok(bg.length === 2 && bg.every(Boolean), 'Select and Place: both solid', bg);
    const ghost = async (x, y) => { const at = await t.scr(x, y); await t.mouse('mouseMove', at.x, at.y); await t.sleep(150);
      return t.g(`(() => { const b = document.querySelector('.lt-ghost .lt-ghost-box'); const r = document.querySelector('.lt-ghost .lt-ghost-ring');
        if (!r) return null; const v = Play.view(); const q = (e) => { const c = e.getBoundingClientRect(); return v.toMap(c.left + c.width / 2, c.top + c.height / 2); };
        return { box: b ? q(b) : null, ring: q(r), faint: r.getAttribute('opacity'), px: Math.round(r.getScreenCTM().a * +r.getAttribute('stroke-width') * 10) / 10 }; })()`); };
    let g1 = await ghost(16.4 * k, 8 * k);
    t.ok(g1 && Math.abs(g1.px - 1.5) < 0.3, 'thin: the ring drawn 1.5 pixels wide', g1);
    t.ok(g1 && g1.box && g1.box.x > 16.05 * k && g1.box.x < 16.5 * k && Math.abs(g1.box.y - 8 * k) < 0.1 * k && g1.faint === '1', 'a wall torch: its box on the wall\'s face where the click would put it', g1);
    g1 = await ghost(10 * k, 8 * k);
    t.ok(g1 && g1.box && g1.faint === '0.4', 'no wall near: faint', g1);
    await t.g(`Object.assign(Play.ui.lt, { group: 'plain', plain: 'torch' }); Play.openPop('fx')`);
    g1 = await ghost(10 * k, 6 * k);
    t.ok(g1 && !g1.box && Math.abs(g1.ring.x - 10 * k) < 0.1 * k && Math.abs(g1.ring.y - 6 * k) < 0.1 * k, 'just light: a ring at the pointer', g1);
    await t.g(`Play.ui.fxSel = true; Play.openPop('fx')`);
    t.eq(await ghost(10 * k, 6 * k), null, 'none with the Select tool');
    await t.g(`Play.ui.fxSel = false; Play.setTool('select')`);
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
  }, { ms: 60000 });

  // Beta 3.51 (Glinn): by day a light in its own colour throws no colour on the map (only its flame burns); it comes in
  // with the dark. A light given a colour colours the map by day too. For every light: flames, presets, the app's lights
  area.deep('Beta 3.51: by day a light in its own colour throws no colour on the map; it comes in with the dark; a picked colour shows by day too', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const glow = async (x, y) => { const p = await t.t(`window.__table.probeMap('glow', ${x}, ${y})`); return p ? p[3] : 0; };
    await t.cmd('fx.fixture', { mapId: own, kind: 'lamp_post', x: 8 * k, y: 8 * k });
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'lantern', x: 8 * k, y: 16 * k, bright: 30, dim: 60, color: '#ffd28a' });
    await t.cmd('fx.fixture', { mapId: own, kind: 'lamp_post', x: 24 * k, y: 8 * k, color: '#55ff55' });
    await t.sleep(1200);
    const day = [await glow(9 * k, 9 * k), await glow(9 * k, 17 * k), await glow(25 * k, 9 * k)];
    t.ok(day[0] < 6 && day[1] < 6, 'daylight: no colour from the lamp of the app nor from the Lantern preset, each in its own colour', day);
    t.ok(day[2] > 12, 'daylight: the green one colours the map', day);
    await t.cmd('light.update', { mapId: own, darkness: 0.2 });
    const dusk = await t.until(async () => { const v = await glow(9 * k, 9 * k); return v > 3 && v; }, 15000, 'a little colour at dusk');
    await t.cmd('light.update', { mapId: own, darkness: 0.6 });
    const dark = await t.until(async () => { const v = await glow(9 * k, 9 * k); return v > dusk + 6 && v; }, 15000, 'its colour in the dark');
    t.ok((await glow(9 * k, 17 * k)) > 12, 'the Lantern preset as well', [dusk, dark]);
    // a reach of its own, and changed afterwards
    const lamp = M(t).fx.find((x) => x.holder);
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, bright: 10 });
    const f = M(t).fx.find((x) => x.id === lamp.id);
    t.eq([f.bright, f.dim], [10, 20], 'Reach: bright and dim together');
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, color: '#3366ff' });
    t.eq([f.color, f.sat], ['#3366ff', 0.7], 'a colour picked afterwards: strong');
    await t.cmd('fx.lightSet', { mapId: own, id: lamp.id, color: '' });
    t.eq([f.color, f.sat], ['#ffd28a', undefined], 'back to its own colour');
    for (const x of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: x.id });
  }, { ms: 90000 });

  // Beta 3.54 (Glinn: a flame removed in Effects left its holder behind, which could not be removed): a light is one
  // thing. Maps from before fold the picture and its flame together when they open (and after any change).
  area.quick('Beta 3.54: lights from before (a picture and its flame) become one light; a picture whose flame was removed becomes a light that is put out', async (t) => {
    const ms = require('../../mapstate');
    const old = { name: 'old', grid: { size: 1 }, layers: [
      { id: 'la', role: 'asset', kind: 'image', x: 5, y: 3.278, w: 0.171, rotation: 90, name: 'Wall torch', fixture: { kind: 'wall_torch', fx: 'xa' } },
      { id: 'lb', role: 'asset', kind: 'image', x: 8, y: 8, w: 0.329, rotation: 0, hidden: true, name: 'Lamp post', fixture: { kind: 'lamp_post', fx: 'xgone' } },
      { id: 'lc', role: 'asset', kind: 'image', x: 9, y: 9, w: 0.342, rotation: 0, name: 'Wall torch', fixture: { kind: 'wall_torch', fx: 'xa' } }], // (a copy that shared its flame)
    fx: [
      { id: 'xa', kind: 'emitter', preset: 'torch', x: 5, y: 3.278, r: 0.2, color: '#55ff55', sat: 0.7, hidden: true, bright: 15, dim: 30, flicker: true, fixture: 'la' },
      { id: 'xz', kind: 'emitter', preset: 'glow', x: 1, y: 1, r: 0.3, hidden: false, bright: 30, dim: 60, fixture: 'lgone' }, // (its picture was gone)
      { id: 'xs', kind: 'emitter', preset: 'smoke', x: 2, y: 2, r: 1, hidden: false }] };
    const m = ms.normalize(JSON.parse(JSON.stringify(old)));
    t.eq(m.layers.length, 0, 'the pictures are gone');
    const a = m.fx.find((f) => f.id === 'xa');
    t.eq([a.holder, a.x, a.y, a.rotation, a.lit, a.hidden, a.color, a.bright, a.fixture], ['wall_torch', 5, 3.278, 90, false, false, '#55ff55', 15, undefined], 'picture and flame: one light, put out as it was, in its colour', a);
    const b = m.fx.find((f) => f.holder === 'lamp_post');
    t.ok(b && b.lit === false && b.hidden === true && b.x === 8 && b.preset === 'glow' && b.bright === 30, 'a picture without its flame: a lamp post, put out, hidden as its picture was', b);
    const c = m.fx.filter((f) => f.holder === 'wall_torch');
    t.ok(c.length === 2 && c[1].id !== 'xa' && c[1].x === 9 && c[1].hs === 2, 'a copied picture: a light of its own (made twice as big: its holder too)', c.map((x) => [x.id, x.x, x.hs]));
    t.ok(!m.fx.some((f) => f.id === 'xz') && m.fx.some((f) => f.id === 'xs'), 'a flame whose picture was gone goes; other effects stay');
    // a map that is open: the next change folds it too
    const m2 = ms.normalize({ name: 'open' });
    m2.layers.push(JSON.parse(JSON.stringify(old.layers[0]))); m2.fx.push(JSON.parse(JSON.stringify(old.fx[0])));
    ms.apply(m2, 'fx.update', { id: 'xa', intensity: 1 });
    t.ok(!m2.layers.length && m2.fx.length === 1 && m2.fx[0].holder === 'wall_torch', 'folded after a change', m2.fx);
    // one thing: removed, nothing is left; put out and hidden apart
    t.eq(ms.apply(m2, 'fx.lit', { id: 'xa', on: true }).changed, 'all', 'lit');
    t.eq([m2.fx[0].lit, m2.fx[0].hidden], [undefined, false], 'lit, not hidden');
    ms.apply(m2, 'fx.remove', { id: 'xa' });
    t.ok(!m2.fx.length && !m2.layers.length, 'removed: nothing left behind');
  });

  area.quick('Beta 3.54: on a drawn map a wall light goes with its wall (another wall right there keeps it); Undo brings both back; a light standing free stays', async (t) => {
    const ms = require('../../mapstate');
    const media = () => ({});
    const m = ms.normalize({ name: 'drawn', grid: { size: 1 }, os: { items: [] } });
    const walls = (list) => ms.apply(m, 'os.result', { walls: list.map(([key, c]) => ({ key, c })) }, media);
    walls([['top', [0, 0, 10, 0]], ['left', [0, 0, 0, 10]]]);
    const wid = (key) => (m.walls.find((w) => w.os === key) || {}).id;
    const top = ms.apply(m, 'fx.fixture', { kind: 'wall_torch', x: 5, y: 0.5, wall: wid('top') }).id;
    const left = ms.apply(m, 'fx.fixture', { kind: 'wall_lantern', x: 0.5, y: 5, wall: wid('left') }).id;
    const lamp = ms.apply(m, 'fx.fixture', { kind: 'lamp_post', x: 5, y: 5 }).id;
    const ids = () => m.fx.map((f) => f.id);
    const h = new ms.History();
    h.before(m, null, 'os.add', 'Erased'); // (the drawing changed: an undo step; its walls come after, without one)
    walls([['top', [0, 0, 10, 0]]]);
    t.ok(ids().includes(top) && !ids().includes(left) && ids().includes(lamp), 'the left wall gone: its lantern goes; the torch on the top wall and the lamp post stay', ids());
    walls([['top2', [0, 0.1, 10, 0.1]]]);
    t.ok(ids().includes(top) && m.fx.find((f) => f.id === top).wall === wid('top2'), 'the top wall made anew right there: the torch is hung on it', m.fx.find((f) => f.id === top));
    h.step(m, 'undo');
    t.ok(ids().includes(left) && ids().includes(top) && m.walls.some((w) => w.id === m.fx.find((f) => f.id === left).wall), 'Undo: the wall and its lantern back', ids());
    walls([]);
    t.eq(ids(), [lamp], 'no walls at all: only the lamp post is left');
  });

  area.deep('Beta 3.54: a light is one thing: the Light panel picks and changes it; put out it keeps its holder; hidden it leaves the TV; one row in Layers; Delete in Effects takes it all; Place has no torches; only the Select tool asks', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    for (const w of [...M(t).walls]) t.handle('wall.remove', { mapId: own, id: w.id });
    const fxNow = (id) => M(t).fx.find((f) => f.id === id);
    // Place: no torches, campfires or candles any more (they are lights)
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'place'; Play.ui.fxFam = 'all'; Play.openPop('fx')`);
    const place = await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent.trim())`);
    t.ok(!['Torch', 'Campfire', 'Candles'].some((x) => place.includes(x)) && place.includes('Smoke') && place.includes('Magic glow'), 'Elements keeps the rest', place);
    // Light sources: Holder, Flame, Just light
    await t.g(`Object.assign(Play.ui.lt, { group: 'holder', holder: 'cooking_fire', color: '', lit: true, reach: null, sat: null, intensity: 1, size: 1 }); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    const tilesNow = () => t.g(`[...document.querySelectorAll('#pop .lt-kinds .tile')].map((b) => b.textContent.trim())`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].map((b) => b.textContent.trim())`), ['Holder', 'Flame', 'Just light', 'Daylight'], 'four kinds of light (Beta 3.64: Daylight)');
    await t.clickText('#pop .lt-groups .seg-btn', 'Flame');
    t.eq(await tilesNow(), ['Torch', 'Campfire', 'Candles'], 'Flame');
    await t.clickText('#pop .lt-groups .seg-btn', 'Just light');
    t.eq(await tilesNow(), ['Candle', 'Torch', 'Lantern', 'Light cantrip', 'Moonlight', 'Bullseye lantern'], 'Just light');
    await t.clickText('#pop .lt-groups .seg-btn', 'Holder');
    t.eq((await tilesNow()).length, 6, 'Holder');
    let at = await t.scr(10 * k, 8 * k); await t.click(at.x, at.y);
    const fire = await t.until(() => M(t).fx.find((f) => f.holder === 'cooking_fire'), 4000, 'a cooking fire');
    // its marker picks it: the same rows now change it
    await select(t);
    const hm = await t.until(() => t.rect(`.sv-handle[data-id="${fire.id}"]`), 3000, 'its marker');
    await t.click(hm.cx, hm.cy);
    await t.until(() => t.g('Play.ui.selFx').then((v) => v === fire.id), 3000, 'picked');
    await t.until(async () => (await t.count('#pop .lt-remove')) === 1, 3000, 'the panel of the picked light');
    t.eq([await t.text('#pop .look-head b'), await t.count('#pop .lt-kinds')], ['Cooking fire', 0], 'its name, no kinds');
    await t.send(own);
    // put out: no flame and no light, the holder stays; not hidden
    await t.clickText('#pop .lt-lit .seg-btn', 'Unlit');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'put out');
    t.eq(fxNow(fire.id).hidden, false, 'not hidden: the players see the cold fire');
    await t.until(async () => (await t.t(`[...document.querySelectorAll('.sv-holder')].filter((e) => e.style.display !== 'none').length`)) === 1, 4000, 'its holder on the TV');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 0; }, 4000, 'no flame on the TV');
    await t.clickText('#pop .lt-lit .seg-btn', 'Lit');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 1; }, 4000, 'its flame on the TV again');
    // hidden (the eye): holder and flame leave the TV; it stays lit
    t.handle('fx.update', { mapId: own, id: fire.id, hidden: true });
    await t.until(async () => (await t.t(`[...document.querySelectorAll('.sv-holder')].filter((e) => e.style.display !== 'none').length`)) === 0, 4000, 'hidden: its holder gone from the TV');
    await t.until(async () => { const d = await t.tvDebug(); return d.fx && d.fx.emitters === 0; }, 4000, 'and its flame');
    t.eq(fxNow(fire.id).lit, undefined, 'still lit');
    t.handle('fx.update', { mapId: own, id: fire.id, hidden: false });
    // Layers: one row, with a bulb
    await t.g(`Play.openPop('layers')`);
    await t.until(async () => (await t.count('#pop .layer-row')) >= 1, 3000, 'Layers');
    const rows = await t.g(`[...document.querySelectorAll('#pop .layer-list > *')].map((e) => e.textContent.trim()).filter(Boolean)`);
    t.ok(rows.includes('Lights') && rows.filter((r) => r.startsWith('Cooking fire')).length === 1 && (await t.count('#pop .layer-row .lt-bulb.on')) === 1, 'one row under Lights, lit', rows);
    await t.clickSel('#pop .layer-row .lt-bulb');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'the bulb puts it out');
    await t.clickSel('#pop .layer-row .lt-bulb');
    await t.until(() => fxNow(fire.id).lit !== false, 3000, 'and lights it');
    // Delete in Effects takes the whole light (in 3.53 it left the holder behind)
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'light'; Play.ui.lightTab = 'sources'; Play.openPop('fx')`);
    await select(t);
    const hm2 = await t.until(() => t.rect(`.sv-handle[data-id="${fire.id}"]`), 3000, 'its marker');
    await t.click(hm2.cx, hm2.cy);
    await t.until(() => t.g('Play.ui.selFx').then((v) => v === fire.id), 3000, 'picked again');
    t.gm().webContents.focus();
    await t.key('Delete');
    await t.until(() => !M(t).fx.length, 3000, 'Delete: the light gone');
    await t.until(async () => (await t.count('.sv-holder')) === 0, 3000, 'its holder too, on your screen');
    t.ok(!M(t).layers.some((l) => l.role === 'asset'), 'no picture left behind');
    await t.cmd('history.undo', {});
    await t.until(() => fxNow(fire.id), 3000, 'Undo brings it back whole');
    await t.until(async () => (await t.count(`.sv-holder[data-id="h-${fire.id}"]`)) === 1, 3000, 'with its holder');
    // only the Select tool asks: a fog stroke that starts on it does its job
    await t.g(`Play.setTool('fog')`);
    at = await t.scr(fire.x, fire.y); await t.click(at.x, at.y); await t.sleep(300);
    t.eq(await t.count('.light-ask'), 0, 'the Fog tool does not ask');
    await t.g(`Play.setTool('select')`);
    await t.click(at.x, at.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'the Select tool asks');
    t.eq(await t.text('.light-ask b'), 'Put out the cooking fire?', 'it asks');
    await t.clickText('.light-ask .btn', 'Yes');
    await t.until(() => fxNow(fire.id).lit === false, 3000, 'put out');
    // a flame and just light ask too
    const fl = (await t.cmd('fx.add', { mapId: own, kind: 'emitter', preset: 'campfire', x: 16 * k, y: 8 * k, r: 1.2 * k, bright: 20, dim: 40 })).selected;
    at = await t.scr(16 * k, 8 * k); await t.click(at.x, at.y);
    await t.until(async () => (await t.count('.light-ask')) === 1, 3000, 'a campfire asks');
    t.eq(await t.text('.light-ask b'), 'Put out the campfire?', 'the campfire');
    await t.clickText('.light-ask .btn', 'No');
    t.ok(fxNow(fl).lit !== false, 'No: it burns on');
    for (const x of [...M(t).fx]) t.handle('fx.remove', { mapId: own, id: x.id });
  }, { ms: 120000 });

  area.deep('without darkness the light layer leaves the map alone', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    await t.sleep(600);
    t.ok(await dark(t, 24 * k, 14 * k) < 20, 'no darkness is drawn', await dark(t, 24 * k, 14 * k));
  });

  area.deep('rain covers the whole TV and stops when the layer is removed', async (t) => {
    await clean(t);
    const r = await t.cmd('weather.add', { mapId: own, type: 'rain' });
    t.eq(M(t).weather.layers.map((l) => l.type), ['rain'], 'the weather on the map');
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) > 0.002, 8000, 'rain on the TV');
    await t.cmd('weather.remove', { mapId: own, id: r.selected });
    await t.until(async () => (await t.t(`window.__table.coverage('weather')`)) < 0.0005, 8000, 'the rain to stop');
  });

  area.deep('mist painted with the mouse becomes an area on the map and drifts on the TV', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.key('E');
    await element(t, 'r:mist'); await shape(t, 'brush');
    await t.drag(await t.scr(15 * k, 9 * k), await t.scr(22 * k, 10 * k), 12);
    const mist = await t.until(() => M(t).fx.find((f) => f.kind === 'region' && f.preset === 'mist'), 3000, 'the mist area');
    t.ok(mist.strokes.length === 1 && mist.strokes[0].pts.length / 2 >= 4, 'one stroke that follows the mouse', mist.strokes.map((s) => s.pts.length / 2));
    await t.until(async () => (await t.t(`window.__table.coverage('atmo')`)) > 0.002, 8000, 'the mist on the TV');
  });

  area.deep('Beta 3.41: Paint → Box and Round snap to the grid; Erase takes painted effects away, with the brush or (Alt) with a box', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    // (in squares of the map's grid, which need not begin at the map's corner)
    const ox = m.grid.ox || 0; const oy = m.grid.oy || 0; const X = (n) => ox + n * k; const Y = (n) => oy + n * k;
    const sq = (pts) => pts.map((v, i) => Math.round(((v - (i % 2 ? oy : ox)) / k) * 100) / 100);
    await t.g(`Play.setTool('fx'); Play.ui.fxMode = 'paint'; Play.ui.paintShape = 'brush'; Play.openPop('fx')`);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.textContent)`), ['Select', 'Box', 'Round', 'Brush', 'Erase'], 'Select and four ways to paint, at the side (Beta 3.60; 3.66: Select)');
    t.ok(await t.findText('#pop .ctl-label', 'Brush size'), 'the brush has a size');
    await element(t, 'r:acid');
    await shape(t, 'box');
    t.ok(!(await t.findText('#pop .ctl-label', 'Brush size')), 'no brush size for a box');
    // a drag that begins and ends a little off the grid's lines: the box lies on them
    await t.drag(await t.scr(X(16.2), Y(5.1)), await t.scr(X(20.9), Y(8.8)), 8);
    const acid = () => M(t).fx.find((f) => f.kind === 'region' && f.preset === 'acid');
    await t.until(() => acid(), 3000, 'the box of acid');
    const outline = acid().strokes[0];
    t.ok(outline.poly && !outline.cut, 'an outline, filled');
    t.eq(sq(outline.pts), [16, 5, 21, 5, 21, 9, 16, 9], 'on the grid\'s lines');
    t.ok(outline.line && outline.line[2] > outline.line[0] && outline.line[1] === outline.line[3], 'it flows along its longer side, the way it was dragged', outline.line);
    const alpha = (x, y) => t.t(`(window.__table.probeMap('atmo', ${X(x)}, ${Y(y)}) || [0, 0, 0, 0])[3]`);
    await t.until(async () => (await alpha(18.5, 7)) > 40, 8000, 'the acid on the TV');
    t.ok((await alpha(22.5, 7)) < 8 && (await alpha(18.5, 10.5)) < 8 && (await alpha(14.5, 7)) < 8, 'nothing of it outside the box', [await alpha(22.5, 7), await alpha(18.5, 10.5), await alpha(14.5, 7)]);
    // a round with Shift: a circle; it joins the same area
    await shape(t, 'round');
    await t.drag(await t.scr(X(23), Y(5)), await t.scr(X(25.9), Y(9.2)), 8, ['shift']);
    await t.until(() => acid().strokes.filter((st) => st.poly).length === 2, 3000, 'the round');
    const ring = acid().strokes.filter((st) => st.poly)[1].pts; const xs = ring.filter((_, i) => i % 2 === 0); const ys = ring.filter((_, i) => i % 2 === 1);
    t.eq(sq([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]), [23, 5, 27, 9], 'a circle four squares across (the longer side of the drag)');
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 1, 'box and round are one area');
    // Alt with Box erases a box: the middle of the acid goes, its rim stays
    await shape(t, 'box');
    await t.drag(await t.scr(X(17.5), Y(6)), await t.scr(X(19.5), Y(8)), 8, ['alt']);
    await t.until(() => acid().strokes.some((st) => st.cut), 3000, 'the erased box');
    const cut = acid().strokes.find((st) => st.cut);
    t.eq(sq(cut.pts), [17.5, 6, 19.5, 6, 19.5, 8, 17.5, 8], 'half squares too');
    await t.until(async () => (await alpha(18.5, 7)) < 8, 8000, 'the middle free of acid on the TV');
    t.ok((await alpha(16.6, 7)) > 40 && (await alpha(20.4, 7)) > 40, 'the rest stays', [await alpha(16.6, 7), await alpha(20.4, 7)]);
    // Erase: the brush takes the round away altogether, in one step that undo brings back
    await shape(t, 'erase');
    t.eq([await t.text('#pop .fx-ban .cap b'), await t.count('#pop .fx-panel .swatches'), await t.count('#pop .fx-gal .fx-t.on')], ['Erase', 0, 0], 'erasing: no effect in hand, no colour');
    await t.g('Play.ui.paintIn = 8'); // (a brush as wide as the round, on a table zoomed as it is)
    const r0 = await t.g(`Play.ui.paintIn / 2 / Play.state().map.view.zoom`);
    for (let y = 5; y <= 9; y += Math.max(0.5, (r0 / k) * 1.2)) await t.drag(await t.scr(X(22.5), Y(y)), await t.scr(X(27.5), Y(y)), 6);
    await t.until(async () => (await alpha(25, 7)) < 8, 8000, 'the round gone from the TV');
    t.ok((await alpha(16.6, 7)) > 40, 'the box is still there', await alpha(16.6, 7));
    // what is erased everywhere leaves no empty area behind
    t.handle('fx.cut', { mapId: own, sid: 'all', shape: 'rect', x: X(10), y: Y(2), w: 22 * k, h: 12 * k });
    await t.settle();
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 0, 'an area with nothing left goes');
    t.handle('history.undo', { mapId: own }); await t.settle();
    t.eq(M(t).fx.filter((f) => f.kind === 'region').length, 1, 'undo brings it back');
    await t.g(`Play.ui.paintIn = 2; Play.ui.paintShape = 'box'`);
  }, { ms: 120000 });

  area.deep('Beta 3.60: Effects in three groups: Scene (time of day, weather, wind, Indoors), Lights, Elements (picture tiles by family); each effect keeps its own look; letting go places nothing; another colour starts a new area', async (t) => {
    await noCard(t, true); try { // (written for a PC without a graphics card: with one the engine draws these, see Trees)
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.fxMode = 'weather'; Play.ui.fxMoreWx = false; Play.ui.fxMoreLight = false; Play.ui.looks = {}; Play.ui.fxFam = 'all'; Play.ui.fxFly = false; Play.ui.paintShape = 'box'`);
    await t.key('E');
    const groups = () => t.g(`[...document.querySelectorAll('#pop .fx-groups .tile')].map((b) => b.textContent + (b.classList.contains('open') ? '*' : ''))`);
    const group = async (g) => { await t.g(`document.querySelector('#pop .fx-groups .tile[data-g="${g}"]').click()`); await t.sleep(300); };
    t.eq(await groups(), ['Scene*', 'Lights', 'Elements'], 'three groups at the side, Scene open');
    // Scene: the whole map on one screen
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-moods .tile')].map((b) => b.textContent)`), ['Day', 'Dawn', 'Dusk', 'Night', 'Cave'], 'time of day, five in a row');
    t.ok((await t.count('#pop .wx-presets .tile')) >= 14 && (await t.count('#pop .wx-add')) === 0, 'the mixes, no single-layer tiles');
    await t.g(`document.querySelector('#pop .fx-moods .tile[data-v="night"]').click()`);
    await t.clickText('#pop .wx-presets .tile', 'Rain');
    await t.until(() => M(t).light.mood === 'night' && M(t).weather.layers.length === 2, 4000, 'night and rain: two clicks on one screen');
    t.eq([await t.count('#pop .fx-wind'), await t.count('#pop .fx-wind input[type="range"]'), await t.count('#pop .fx-fold[data-v="fxMoreWind"]'), !!(await t.findText('#pop .fx-fold[data-v="fxMoreWind"] button', 'Storm'))], [1, 1, 1, true], 'one Wind slider; Storm and the rest under Advanced wind (Beta 3.66)');
    t.ok(await t.g(`[...document.querySelectorAll('#pop .fx-fold')].every((d) => !d.open)`), 'the rest is folded');
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreWx"] summary').click()`);
    await t.until(async () => (await t.count('#pop .fx-fold[data-v="fxMoreWx"] .wx-list .layer-row')) === 2, 3000, 'Fine-tune the weather: this mix\'s layers');
    await t.clickSel('#pop .fx-addlayer');
    t.ok(((await t.menu()) || []).includes('Lightning') && (await t.menu()).length === 20, 'Add a layer: the 20 kinds in a menu', await t.menu()); // (second-birds: 18 and Birds; second-sun-sand-gears: Tumbleweeds)
    await t.menuPick('Lightning');
    await t.until(() => M(t).weather.layers.some((l) => l.type === 'lightning'), 3000, 'lightning in the mix');
    await t.until(() => t.g(`(() => { const b = document.querySelector('#pop .wx-strike'); return !!b && !b.closest('[hidden]'); })()`), 3000, 'the Lightning button');
    // H5 (open point): a layer's trash shows Undo, and Undo brings the layer back
    const lit = () => M(t).weather.layers.some((l) => l.type === 'lightning' && !l.dying);
    await t.g(`[...document.querySelectorAll('#pop .wx-list .layer-row')].find((r) => r.textContent.includes('Lightning')).querySelector('.icon-btn[aria-label="Remove"]').click()`);
    await t.until(() => !lit(), 3000, 'the trash to take Lightning out');
    await t.until(() => t.rect('.toast .toast-undo'), 3000, 'a note with Undo');
    await t.clickSel('.toast .toast-undo');
    await t.until(lit, 3000, 'Undo to bring Lightning back');
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreWx"] summary').click()`);
    // Indoors: the Roof of before; the shape tools come out, the group stays Scene
    await t.g(`document.querySelector('#pop .fx-indoors').click()`); await t.sleep(300);
    t.eq([await t.g('[Play.ui.fxMode, Play.ui.region].join()'), await t.count('#pop .os-tabs2 .tile'), (await groups())[0]], ['paint,roof', 5, 'Scene*'], 'Indoors paints roofs, in Scene (Beta 3.66: Select and the four ways to paint)');
    await t.drag(await t.scr(16 * k, 9 * k), await t.scr(19 * k, 11 * k), 6);
    await t.until(() => M(t).fx.some((f) => f.kind === 'region' && f.preset === 'roof'), 3000, 'a roof');
    await t.g(`document.querySelector('#pop .fx-indoors').click()`); await t.sleep(300);
    t.eq([await t.g('Play.ui.fxMode'), await t.count('#pop .os-tabs2 .tile')], ['weather', 0], 'Indoors off again');
    // Lights: the Light panel
    await group('lights');
    t.eq([await groups(), await t.count('#pop .lt-groups'), await t.count('#pop .lt-kinds .tile') > 0], [['Scene', 'Lights*', 'Elements'], 1, true], 'Lights: the Light panel');
    // Elements: every effect a tile with a picture, sorted by family; a chip narrows them
    await group('elements');
    t.eq(await t.count('#pop .fx-gal .fx-t'), 40, 'every element on one screen'); // (Beta 3.66: and Bats, painted) // (Beta 3.64: 41 less Light shaft and Window light, now Lights → Daylight) // (Beta 3.63: 42 less Sun through leaves, held back for the one engine) // (second-water-works: 29 and Rapids, Whirlpool, Bubbling pool, Geyser; second-birds: Circling birds; second-bats-insects: Bats, Insects; second-ground-life: Fish, Critters; second-sun-sand-gears: Turning parts, Sun through leaves, Drifting sand, Dust devil)
    await t.until(() => t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t img')].filter((i) => /^data:image/.test(i.src)).length >= 20`), 15000, 'their pictures, drawn by the effects themselves');
    const gal = await t.g(`(() => { const g = document.querySelector('#pop .fx-gal'); const t0 = g.querySelector('.fx-t'); return { rows: Math.round(g.clientHeight / (t0.offsetHeight + 5)), scrolls: g.scrollHeight > g.clientHeight + 10, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length }; })()`);
    t.eq(gal, { rows: 4, scrolls: true, cols: 5 }, 'five in a row, four rows show, the rest scrolls');
    await t.g(`[...document.querySelectorAll('#pop .fx-chips .cs-chip')].find((b) => b.textContent === 'Fire').click()`); await t.sleep(250);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent)`), ['Lava', 'Burning ground', 'Vent', 'Smoke', 'Steam'], 'the chip Fire');
    // the effect knows how it goes down: Smoke with a click (no shape tools), Mist with a box
    await element(t, 'e:smoke');
    t.eq([await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join()`), await t.text('#pop .fx-ban .cap b'), await t.findText('#pop .ctl-label', 'Size') !== null], ['Select,Place*', 'Smoke', true], 'Smoke: a click (Beta 3.66: Select and Place at the side), its size');
    t.ok(!(await t.findText('#pop .ctl-label', 'Flames flicker')), 'no flame switch on effects without one');
    // each effect its own look: red smoke does not make the portal red
    await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#ff3344"]').click()`); await t.sleep(150);
    const at = await t.scr(18 * k, 5 * k); await t.click(at.x, at.y);
    const smoke = await t.until(() => M(t).fx.find((f) => f.preset === 'smoke'), 3000, 'the smoke');
    t.eq(smoke.color, '#ff3344', 'red smoke');
    await element(t, 'e:portal');
    t.ok(await t.g(`document.querySelector('#pop .fx-panel .swatch.own').classList.contains('on')`), 'the portal still has its own colour');
    const at2 = await t.scr(23 * k, 5 * k); await t.click(at2.x, at2.y);
    const portal = await t.until(() => M(t).fx.find((f) => f.preset === 'portal'), 3000, 'the portal');
    t.ok(portal.color !== '#ff3344', 'in its own colour', portal.color);
    await element(t, 'e:smoke');
    t.ok(await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#ff3344"]').classList.contains('on')`), 'Smoke remembers its red');
    // picked: the panel is its card; a click on the empty map lets go and places nothing
    await select(t);
    const mk = await t.rect(`.sv-handle[data-id="${portal.id}"]`); await t.click(mk.cx, mk.cy); await t.sleep(400);
    t.eq([await t.text('#pop .fx-ban-tag'), await t.text('#pop .fx-ban .cap b'), await t.count('#pop .fx-gal'), await t.count('#pop .fx-ban-acts .icon-btn')], ['picked', 'Portal', 0, 3], 'the portal picked: its card, with eye, copy and bin');
    const n0 = M(t).fx.length;
    const free = await t.scr(26 * k, 9 * k); await t.click(free.x, free.y); await t.sleep(400);
    t.eq([M(t).fx.length, await t.g('Play.ui.selFx'), await t.count('#pop .fx-gal'), await t.text('#pop .fx-gal .fx-t.on')], [n0, null, 1, 'Smoke'], 'a click beside it lets go: nothing placed, the tiles back, Smoke in hand again');
    // painted: strokes of one look join; another colour starts a new area by itself
    await element(t, 'r:mist');
    t.eq([await t.count('#pop .os-tabs2 .tile'), await t.count('#pop .os-tabs2 .tile.on[data-v="fxt-box"]'), await t.findText('#pop .btn', 'Start a new area')], [5, 1, null], 'Mist: Select and the shape tools, a box in hand; no "Start a new area"');
    const mists = () => M(t).fx.filter((f) => f.kind === 'region' && f.preset === 'mist');
    await t.drag(await t.scr(16 * k, 4 * k), await t.scr(18 * k, 6 * k), 6);
    await t.until(() => mists().length === 1, 3000, 'mist');
    await t.drag(await t.scr(20 * k, 4 * k), await t.scr(22 * k, 6 * k), 6);
    await t.until(() => mists().length === 1 && mists()[0].strokes.filter((st) => st.poly).length === 2, 3000, 'the second box joins it');
    await t.g(`document.querySelector('#pop .fx-panel .swatch[data-v="#5f9dff"]').click()`); await t.sleep(150);
    await t.drag(await t.scr(24 * k, 4 * k), await t.scr(26 * k, 6 * k), 6);
    await t.until(() => mists().length === 2, 3000, 'blue mist is an area of its own');
    t.eq(mists().map((f) => f.color), [null, '#5f9dff'], 'each in its colour');
    // the settings card, behind its button
    t.eq(await t.count('#pop .fx-fly'), 0, 'no card until asked');
    await t.g(`document.querySelector('#pop .os-fxset').click()`); await t.sleep(300);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-fly .ctl-label')].filter((e) => e.offsetParent).map((e) => e.textContent)`), ['Strength', 'Amount', 'Speed'], 'Mist settings');
    await t.g(`Play.ui.fxFly = false; Play.ui.looks = {}; Play.closePop(); Play.setTool('select')`);
  } finally { await noCard(t, false); } }, { ms: 120000 });

  // Second Builder (second-water-works)
  area.deep('Water: Rapids, Whirlpool (its direction, Swirl the water), Bubbling pool (a kind per area) and a Geyser; they draw the same moment the same way', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false; Play.ui.paintShape = 'box'; Play.ui.look = { ...Play.ui.look, variant: 'steam' }`);
    await t.key('E');
    await t.g(`document.querySelector('#pop .fx-groups .tile[data-g="elements"]').click()`); await t.sleep(300);
    await t.g(`[...document.querySelectorAll('#pop .fx-chips .cs-chip')].find((b) => b.textContent === 'Water').click()`); await t.sleep(250);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent)`), ['Water', 'River current', 'Surf', 'Swamp', 'Ice', 'Falling water', 'Rapids', 'Whirlpool', 'Bubbling pool', 'Geyser'], 'the chip Water');
    // Bubbling pool: its kinds (a Vent's "steam" in hand does not reach it); each kind an area of its own
    await element(t, 'r:bubbling');
    const kinds = () => t.g(`(() => { const l = [...document.querySelectorAll('#pop .ctl-label')].find((e) => e.textContent === 'Kind'); const c = l && l.closest('.ctl'); return c ? [...c.querySelectorAll('.seg-btn')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) : null; })()`);
    t.eq(await kinds(), ['Mud*', 'Bog', 'Hot spring', 'Tar'], 'Kind: Mud first');
    const pools = () => M(t).fx.filter((f) => f.kind === 'region' && f.preset === 'bubbling');
    await t.drag(await t.scr(16 * k, 4 * k), await t.scr(19 * k, 6 * k), 6);
    await t.until(() => pools().length === 1 && pools()[0].variant === 'mud', 3000, 'a mud pool');
    await t.g(`(() => { const l = [...document.querySelectorAll('#pop .ctl-label')].find((e) => e.textContent === 'Kind'); [...l.closest('.ctl').querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Tar').click(); })()`); await t.sleep(150);
    await t.drag(await t.scr(21 * k, 4 * k), await t.scr(24 * k, 6 * k), 6);
    await t.until(() => pools().length === 2, 3000, 'tar is an area of its own');
    t.eq(pools().map((f) => f.variant), ['mud', 'tar'], 'each with its kind');
    // Rapids: painted like River current
    await element(t, 'r:rapids');
    await t.drag(await t.scr(16 * k, 8 * k), await t.scr(26 * k, 10 * k), 6);
    await t.until(() => M(t).fx.some((f) => f.preset === 'rapids'), 3000, 'rapids');
    // Whirlpool: a click; Turns and Swirl the water on its card
    await element(t, 'e:whirl');
    t.eq(await kinds(), ['Whirlpool*', 'Maelstrom'], 'Kind: Whirlpool or Maelstrom');
    await t.g(`document.querySelector('#pop .os-fxset').click()`); await t.sleep(300);
    const labels = await t.g(`[...document.querySelectorAll('#pop .fx-fly .ctl-label')].filter((e) => e.offsetParent).map((e) => e.textContent)`);
    t.ok(labels.includes('Turns') && labels.includes('Swirl the water'), 'its card: which way it turns, whether the water turns', labels);
    await t.g(`(() => { const l = [...document.querySelectorAll('#pop .fx-fly .ctl-label')].find((e) => e.textContent === 'Turns'); [...l.closest('.ctl').querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Anticlockwise').click(); })()`); await t.sleep(150);
    const at = await t.scr(22 * k, 13 * k); await t.click(at.x, at.y);
    const w = await t.until(() => M(t).fx.find((f) => f.preset === 'whirl'), 3000, 'a whirlpool');
    t.eq([w.variant, w.spin, w.swirl], ['whirlpool', -1, undefined], 'anticlockwise, the water turning with it');
    await t.g(`Play.ui.fxFly = false; Play.ui.look.spin = 1; Play.ui.looks = {}; Play.closePop(); Play.setTool('select')`);
    t.handle('fx.update', { mapId: own, id: w.id, swirl: false }); await t.settle();
    t.eq(M(t).fx.find((f) => f.id === w.id).swirl, false, 'Swirl the water off');
    // drawn: the same moment the same way (both screens), something on the canvas, a geyser erupting is a moment to see
    const r = await t.g(`(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
      const draw = (fx, t, kind) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 300); g.setTransform(40, 0, 0, 40, 0, 0); if (kind === 'r') FX.region(g, fx, t, 1); else FX.emitter(g, fx, 5, 3.75, t); return c.toDataURL(); };
      const ink = () => { const d = g.getImageData(0, 0, 400, 300).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; };
      const st = [{ sid: 'a', r: 1.2, pts: [1, 3.75, 4, 3.5, 7, 4, 9, 3.75], t0: 0 }];
      const out = {};
      for (const [name, fx, kind] of [['rapids', { id: 'tr', kind: 'region', preset: 'rapids', strokes: st }, 'r'], ['mud', { id: 'tb', kind: 'region', preset: 'bubbling', variant: 'mud', strokes: st }, 'r'], ['spring', { id: 'ts', kind: 'region', preset: 'bubbling', variant: 'spring', strokes: st }, 'r'], ['whirl', { id: 'tw', kind: 'emitter', preset: 'whirl', r: 2 }, 'e'], ['maelstrom', { id: 'tm', kind: 'emitter', preset: 'whirl', variant: 'maelstrom', r: 2, spin: -1 }, 'e']]) {
        const a = draw(fx, 12.3, kind); const n = ink(); const b = draw(fx, 12.3, kind);
        out[name] = [a === b, n > 500];
      }
      // foam on the whirlpool: light pixels over dark water
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#063040'; g.fillRect(0, 0, 400, 300); g.setTransform(40, 0, 0, 40, 0, 0);
      FX.emitter(g, { id: 'tw', kind: 'emitter', preset: 'whirl', r: 3 }, 5, 3.75, 95342390);
      { const d = g.getImageData(0, 0, 400, 300).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 90) n++; out.foam = n > 1500; }
      const gy = { id: 'tg', kind: 'emitter', preset: 'geyser', r: 1.5 };
      const te = Creatures.eruptionAt(gy, 1.2);
      const a1 = draw(gy, te, 'e'); const erupt = ink();
      out.geyser = [erupt > 2000 && a1 === draw(gy, te, 'e'), Creatures.erupting(gy, te), Creatures.erupting(gy, te - 15)];
      return out;
    })()`);
    t.eq(r, { rapids: [true, true], mud: [true, true], spring: [true, true], whirl: [true, true], maelstrom: [true, true], foam: true, geyser: [true, 1, 0] }, 'each draws, the same moment the same way; the geyser erupts now and then');
  }, { ms: 90000 });

  // C13, C14, C15 (Glinn): Rapids without the ladder of lines across it; Circling birds over a painted area, with a Height;
  // Size of the animals for every animal effect; webs that move (each on its own) and a spider now and then
  area.quick('C13–C15: Rapids has no long lines across the river; birds keep to their area; Size of the animals; webs move', async (t) => {
    // (the birds' pictures load on first use)
    await t.g(`(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const g = c.getContext('2d'); for (const v of ['gulls', 'vultures']) { FX.emitter(g, { id: 'w' + v, kind: 'emitter', preset: 'circling', variant: v, r: 1 }, 1, 1, 1); } })()`);
    await t.sleep(800);
    const r = await t.g(`(() => {
      const W = 400; const H = 300;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
      const clear = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(40, 0, 0, 40, 0, 0); };
      const px = () => g.getImageData(0, 0, W, H).data;
      const out = {};
      // Rapids: a river along x at y = 3.75, 1.2 squares to each side: the longest bright run straight across it
      const river = { id: 'c13', kind: 'region', preset: 'rapids', intensity: 1.4, strokes: [{ sid: 'a', r: 1.2, pts: [0.5, 3.75, 9.5, 3.75], t0: 0 }] };
      let worst = 0;
      for (const tt of [3.1, 7.9, 12.3, 20.5, 33.2]) {
        clear(); FX.region(g, river, tt, 1); const d = px();
        for (let x = 40; x < 360; x++) { let run = 0; for (let y = 102; y < 198; y++) { const i = (y * W + x) * 4; if (d[i + 3] > 120 && d[i] > 190) { run++; worst = Math.max(worst, run); } else run = 0; } }
      }
      out.rapidsRun = worst; // in pixels, of 96 across
      // Circling birds over an area (low, so their shadows stay close): the ink outside the area and a square round it
      const area = { id: 'c14a', kind: 'region', preset: 'birdflight', variant: 'gulls', height: 0, density: 2, strokes: [{ sid: 'b', r: 1.5, pts: [3, 3.75, 7, 3.75], t0: 0 }] };
      let inside = 0; let outside = 0;
      for (const tt of [2, 9, 17, 26, 41]) {
        clear(); FX.region(g, area, tt, 1); const d = px();
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (d[(y * W + x) * 4 + 3] < 40) continue; const mx = x / 40; const my = y / 40; if (mx > 0.5 && mx < 9.5 && my > 1.25 && my < 6.25) inside++; else outside++; }
      }
      out.birdsInside = inside > 200 && outside < inside * 0.1;
      out.birds = [inside, outside];
      // Size of the animals: twice as big draws about four times the ink
      const ink = (fx) => { clear(); FX.emitter(g, fx, 5, 3.75, 12.3); const d = px(); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
      const v1 = ink({ id: 'c14b', kind: 'emitter', preset: 'circling', r: 2.5, height: 0.6 });
      const v2 = ink({ id: 'c14b', kind: 'emitter', preset: 'circling', r: 2.5, height: 0.6, critter: 2 });
      out.size = v2 > v1 * 2.5;
      out.sizes = [v1, v2];
      // webs move: what changes from one second to the next
      const web = { id: 'c15', kind: 'region', preset: 'web', strokes: [{ sid: 'c', r: 1.5, pts: [2, 3.75, 8, 3.75], t0: 0 }] };
      clear(); FX.region(g, web, 40, 1); const a = px().slice(); clear(); FX.region(g, web, 41, 1); const b = px();
      let moved = 0; let lit = 0; for (let i = 3; i < a.length; i += 4) { if (a[i] > 30 || b[i] > 30) lit++; if (Math.abs(a[i] - b[i]) > 60) moved++; }
      out.webMoves = lit > 500 && moved / lit > 0.15;
      out.web = [moved, lit];
      return out;
    })()`);
    t.ok(r.rapidsRun < 50, 'Rapids: no bright line runs more than half way across the river', r.rapidsRun);
    t.ok(r.birdsInside, 'Circling birds over an area keep to it', r.birds);
    t.ok(r.size, 'Size of the animals 2×: about four times as much bird', r.sizes);
    t.ok(r.webMoves, 'webs move from one second to the next', r.web);
    // the panel: How they fly, Size of the animals, Height
    await t.g(`Play.closePop(); Play.setTool('fx'); Play.ui.fxMode = 'place'; Play.ui.emitter = 'circling'; Play.ui.fxEl = { kind: 'emitter', id: 'circling' }; Play.ui.fxSel = false; Play.openPop('fx')`);
    await t.until(() => t.g(`!!document.querySelector('#pop .seg[aria-label="How they fly"]')`), 3000, 'How they fly');
    t.ok(await t.g(`[...document.querySelectorAll('#pop .ctl-label')].some((x) => x.textContent === 'Size of the animals')`), 'Size of the animals');
    await t.g(`document.querySelector('#pop .seg[aria-label="How they fly"] .seg-btn[data-v="birdflight"]').click()`);
    await t.until(() => t.g(`Play.ui.fxMode === 'paint' && Play.ui.region === 'birdflight'`), 3000, 'Over an area: painted');
    t.ok(await t.g(`!!document.querySelector('#pop .fx-t.on[data-v="e:circling"]')`), 'still the Circling birds tile');
    // (Glinn) every effect's Kind fits the panel: five kinds (Insects, Fish, Critters) in rows of three
    for (const [kind, id] of [['emitter', 'insects'], ['region', 'fish'], ['region', 'critters']]) {
      await t.g(`Play.closePop(); Play.ui.fxEl = { kind: '${kind}', id: '${id}' }; ${kind === 'emitter' ? `Play.ui.fxMode = 'place'; Play.ui.emitter = '${id}'` : `Play.ui.fxMode = 'paint'; Play.ui.region = '${id}'`}; Play.openPop('fx')`);
      const fit = await t.until(() => t.g(`(() => { const sg = document.querySelector('#pop .seg[aria-label="Kind"]'); if (!sg) return null; const r = sg.getBoundingClientRect(); return [...sg.querySelectorAll('.seg-btn')].every((b) => { const q = b.getBoundingClientRect(); return q.right <= r.right + 1 && q.left >= r.left - 1 && b.scrollWidth <= b.clientWidth + 1; }) ? 'fits' : 'cut'; })()`), 3000, `${id}: its kinds`);
      t.eq(fit, 'fits', `${id}: every kind fits, none cut off`);
    }
    await t.g(`Play.closePop(); Play.setTool('select')`);
  });

  // Second Builder (second-birds)
  area.deep('Birds: a weather layer with a kind (a flock now and then, on the fly layer, Indoors does not cut it), Circling birds in Animals, the moment Birds take flight', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false`);
    // the layer: in Add a layer, its card has a Kind and no Colour; the kind is kept (and in a snapshot's keys)
    const r = await t.cmd('weather.add', { mapId: own, type: 'birds', dir: 200 });
    const L = () => M(t).weather.layers.find((l) => l.type === 'birds');
    await t.until(() => L(), 3000, 'a Birds layer');
    t.handle('weather.update', { mapId: own, id: L().id, variant: 'geese' }); await t.settle();
    t.eq(L().variant, 'geese', 'its kind kept');
    t.ok(await t.g(`FXDATA.WEATHER_TYPES.some((d) => d.id === 'birds' && d.sky && d.kinds.length === 6)`), 'six kinds, drawn in the sky');
    t.ok(await t.g(`!!ICON_PATHS.feather`), 'the feather icon is in the app (no question mark on the tiles)');
    // a flock within 30 s at Amount 1, the same at the same moment, nothing on the weather layer
    const sky = await t.g(`(() => {
      const L = Play.view().map.weather.layers.find((l) => l.type === 'birds'); const w = { layers: [{ ...L, born: 0 }] };
      const c = document.createElement('canvas'); c.width = 600; c.height = 340; const g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(20, 0, 0, 20, 0, 0);
      let first = null; for (let t = 1000; t < 1030; t += 0.5) { if (Creatures.sky(g, w, 30, 17, t, 1e15, { sq: 1, dark: 0 }) > 0) { first = t; break; } }
      const at = first ?? 1000;
      const a = (g.setTransform(1, 0, 0, 1, 0, 0), g.clearRect(0, 0, 600, 340), g.setTransform(20, 0, 0, 20, 0, 0), Creatures.sky(g, w, 30, 17, at + 2, 1e15, { sq: 1, dark: 0 }), c.toDataURL());
      const b = (g.setTransform(1, 0, 0, 1, 0, 0), g.clearRect(0, 0, 600, 340), g.setTransform(20, 0, 0, 20, 0, 0), Creatures.sky(g, w, 30, 17, at + 2, 1e15, { sq: 1, dark: 0 }), c.toDataURL());
      return { first: first != null, same: a === b, wx: !!FX.weatherOn(Play.view().map.weather) };
    })()`);
    t.eq(sky, { first: true, same: true, wx: true }, 'a flock crosses within 30 s; the same moment the same way');
    // Indoors over the whole map: the fly layer still has the birds
    const R = await t.g(`Play.view().tableRectInMap()`);
    t.handle('fx.shape', { mapId: own, id: 'roof-all', preset: 'roof', sid: 'r1', shape: 'rect', x: R.x, y: R.y, w: R.w, h: R.h });
    await t.settle(); await t.sleep(300);
    // Circling birds: in Animals, with its kinds; drawn on the fly layer (not the effects layer)
    await t.g(`Play.ui.look = { ...Play.ui.look, variant: 'steam' }`);
    await element(t, 'e:circling');
    await t.g(`[...document.querySelectorAll('#pop .fx-chips .cs-chip')].find((b) => b.textContent === 'Animals').click()`); await t.sleep(200);
    t.eq(await t.g(`[...document.querySelectorAll('#pop .fx-gal .fx-t')].map((b) => b.textContent)`), ['Fish', 'Circling birds', 'Bats', 'Bat stream', 'Critters', 'Insects'], 'the chip Animals'); // (Beta 3.66: Bats is painted, the old one is Bat stream) // (second-bats-insects: and Bats, Insects; second-ground-life: Fish, Critters)
    const at = await t.scr(20 * k, 8 * k); await t.click(at.x, at.y);
    const c = await t.until(() => M(t).fx.find((f) => f.preset === 'circling'), 3000, 'circling birds');
    t.eq(c.variant, 'vultures', 'Vultures first (a Vent\'s steam in hand does not reach it)');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    const st = await t.until(() => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.fly >= 1 ? { fly: v.stats.fly, emitters: v.stats.emitters } : null; })()`), 4000, 'the fly layer draws');
    t.ok(st.fly >= 1 && st.emitters === 0, 'circling birds on the fly layer, not the effects layer (Indoors over the map)', st);
    // the moment: in the list, draws, gone after its time
    const mo = await t.g(`(() => {
      const d = Moments.LIST.find((x) => x.id === 'birds');
      const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(20, 0, 0, 20, 0, 0);
      const now = Date.now(); const m = { key: 'x', id: 'birds', seed: 3, x: 0, y: 0, t0: now - 1000 };
      Moments.draw(g, 30, 20, [m], now, () => ({ x: 15, y: 10 }), { sq: 1 });
      const d1 = g.getImageData(0, 0, 600, 400).data; let n = 0; for (let i = 3; i < d1.length; i += 4) if (d1[i] > 20) n++;
      return { dur: d.dur, spot: d.spot, ink: n > 200, over: !Moments.alive({ ...m, t0: now - 5000 }, now) };
    })()`);
    t.eq(mo, { dur: 4200, spot: true, ink: true, over: true }, 'Birds take flight: a spot, draws, over after 4.2 s');
  }, { ms: 90000 });

  // Second Builder (second-bats-insects)
  area.deep('Bats and insects: Bats (Flutter; a Stream pours out the way it faces), Insects (five kinds, a colour for butterflies only), Moths round the lights only in the dark, the moment Bat swarm', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false; Play.ui.fxMoreLight = false`);
    t.ok(await t.g(`!!ICON_PATHS.bat && !!ICON_PATHS.butterfly`), 'the bat and butterfly icons are in the app');
    // Insects: its kinds; the colour row only for butterflies
    await element(t, 'e:insects');
    const kindSeg = (sel) => t.g(`(() => { const s = [...document.querySelectorAll('#pop .seg')].find((x) => x.getAttribute('aria-label') === 'Kind'); return s ? ${sel} : null; })()`);
    t.eq(await kindSeg(`[...s.querySelectorAll('.seg-btn')].map((b) => b.textContent)`), ['Butterflies', 'Bees', 'Dragonflies', 'Moths', 'Flies'], 'Insects: five kinds');
    const colourShown = () => t.g(`(() => { const r = document.querySelector('#pop .color-row'); return !!r && !r.closest('[hidden]'); })()`);
    t.ok(await colourShown(), 'butterflies: a colour row');
    await kindSeg(`[...s.querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Bees').click()`); await t.sleep(300);
    t.ok(!(await colourShown()), 'bees: no colour row');
    const at = await t.scr(20 * k, 8 * k); await t.click(at.x, at.y);
    const ins = await t.until(() => M(t).fx.find((f) => f.preset === 'insects'), 3000, 'insects placed');
    t.eq(ins.variant, 'bees', 'placed as bees');
    // Bat stream (Beta 3.66: a Stream first, the way it faces; Flutter second)
    await element(t, 'e:bats');
    const at2 = await t.scr(22 * k, 10 * k); await t.click(at2.x, at2.y);
    const bat = await t.until(() => M(t).fx.find((f) => f.preset === 'bats'), 3000, 'bats placed');
    t.eq([bat.variant, bat.angle], ['stream', 0], 'a Stream first, facing right');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    const st = await t.until(() => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.fly >= 2 ? { fly: v.stats.fly, emitters: v.stats.emitters } : null; })()`), 4000, 'the fly layer draws them');
    t.eq(st, { fly: 2, emitters: 0 }, 'both on the fly layer, not the effects layer');
    const draw = await t.g(`(async () => {
      await Creatures.ready();
      const c = document.createElement('canvas'); c.width = 600; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
      Creatures.scene({ cell: 1, dark: 0 });
      // ink left and right of the spot (x = 15 squares, the middle): more than 2 squares off it
      const ink = (fx, t) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 600, 300); g.setTransform(20, 0, 0, 20, 0, 0); FX.emitter(g, fx, 15, 7.5, t);
        const d = g.getImageData(0, 0, 600, 300).data; let L = 0; let R = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 30) { const x = ((i - 3) / 4) % 600; if (x < 260) L++; else if (x > 340) R++; } return { L, R, url: c.toDataURL() }; };
      const s = { id: 'tb', kind: 'emitter', preset: 'bats', variant: 'stream', angle: 0, r: 1.5, intensity: 1, density: 1, speed: 1 };
      const T = Creatures.streamAt(s, 3);
      const a = ink(s, T); const b = ink(s, T); const before = ink(s, T - 100);
      const left = ink({ ...s, angle: 180 }, T);
      const fl = ink({ ...s, variant: 'flutter' }, 50);
      const bees = ink({ id: 'ti', kind: 'emitter', preset: 'insects', variant: 'bees', r: 1.5, intensity: 1, density: 1, speed: 1 }, 20);
      const bf = { id: 'ti', kind: 'emitter', preset: 'insects', variant: 'butterflies', r: 1.5, intensity: 1, density: 1, speed: 1 };
      const own = ink(bf, 20); const blue = ink({ ...bf, color: '#3060ff' }, 20);
      const kinds = ['dragonflies', 'moths', 'flies'].map((v) => { const x = ink({ ...bf, variant: v }, 20); return x.L + x.R > 0 || x.url.length > 3000; });
      Creatures.scene(null);
      return { stream: a.R > 60 && before.R === 0, same: a.url === b.url, way: left.L > 60 && left.R === 0 && a.L === 0, flutter: fl.url !== before.url, bees: bees.url.length > 3000, tint: own.url !== blue.url, kinds };
    })()`);
    t.eq(draw, { stream: true, same: true, way: true, flutter: true, bees: true, tint: true, kinds: [true, true, true] }, 'a Stream pours out the way it faces (and not 100 s before), the same each time; flutter, bees, butterflies in a colour, the other kinds draw');
    // Moths round the lights: a switch in Scene → Time of day → More; only in the dark, round each lit light
    await t.cmd('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 10 * k, y: 8 * k, r: 4 * k });
    await t.cmd('light.update', { mapId: own, darkness: 0.74 });
    await t.key('E'); await t.sleep(300);
    await t.g(`document.querySelector('#pop .fx-groups .tile[data-g="scene"]').click()`); await t.sleep(300);
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreLight"] summary').click()`); await t.sleep(300);
    await t.g(`[...document.querySelectorAll('#pop .ctl-toggle')].find((l) => l.textContent.includes('Moths round the lights')).querySelector('input').click()`);
    await t.until(() => M(t).light.moths === true, 3000, 'the switch sets it');
    await t.g(`Play.closePop()`);
    const moths = () => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.moths; })()`);
    const n = await t.until(async () => { const x = await moths(); return x >= 2 && x; }, 4000, 'moths round the torch');
    t.ok(n >= 2 && n <= 4, '2 to 4 moths round the one light', n);
    // (Glinn: they moved far too fast) at today's time (about 1e8 s) a moth goes only a little way from frame to frame
    const step = await t.g(`(() => { const t0 = Date.now() / 1000 - 1.7e9; let max = 0; for (let i = 0; i < 4; i++) { let p = Creatures._orbitMoth(i, 11.3 + i * 9.1, t0, 0.4, 1); for (let f = 1; f <= 240; f++) { const q = Creatures._orbitMoth(i, 11.3 + i * 9.1, t0 + f / 60, 0.4, 1); max = Math.max(max, Math.hypot(q.x - p.x, q.y - p.y)); p = q; } } return max; })()`);
    t.ok(step < 0.06, 'a moth goes at most a few hundredths of a square from frame to frame', step);
    await t.cmd('light.update', { mapId: own, darkness: 0 });
    await t.until(async () => (await moths()) === 0, 3000, 'none by day');
    await t.cmd('light.update', { mapId: own, darkness: 0.74, moths: false });
    await t.until(async () => (await moths()) === 0, 3000, 'none with the switch off');
    // the moment
    const mo = await t.g(`(async () => {
      await Creatures.ready();
      const d = Moments.LIST.find((x) => x.id === 'bats');
      const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(20, 0, 0, 20, 0, 0);
      const now = Date.now(); const m = { key: 'x', id: 'bats', seed: 3, x: 0, y: 0, t0: now - 1500 };
      Moments.draw(g, 30, 20, [m], now, () => ({ x: 15, y: 10 }), { sq: 1 });
      const d1 = g.getImageData(0, 0, 600, 400).data; let n = 0; for (let i = 3; i < d1.length; i += 4) if (d1[i] > 20) n++;
      return { label: d.label, dur: d.dur, spot: d.spot, ink: n > 200, over: !Moments.alive({ ...m, t0: now - 7000 }, now) };
    })()`);
    t.eq(mo, { label: 'Bat swarm', dur: 6500, spot: true, ink: true, over: true }, 'Bat swarm: a spot, draws, over after 6.5 s');
  }, { ms: 90000 });

  // Second Builder (second-ground-life)
  area.deep('Fish and critters: painted areas with a kind; fish stay in the paint (under water painted over them), critters on their own layer wander a wide area and run along a thin stroke', async (t) => {
    await noCard(t, true); try { // (written for a PC without a graphics card: with one the engine draws these, see Trees)
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false`);
    t.ok(await t.g(`!!ICON_PATHS.fish && !!ICON_PATHS.paw`), 'the fish and paw icons are in the app');
    const kinds = async (key) => { await element(t, key); return t.g(`(() => { const s = [...document.querySelectorAll('#pop .seg')].find((x) => x.getAttribute('aria-label') === 'Kind'); return s ? [...s.querySelectorAll('.seg-btn')].map((b) => b.textContent) : null; })()`); };
    t.eq(await kinds('r:fish'), ['Small fish', 'Koi', 'Trout (river)', 'Eels', 'Big shadow'], 'Fish: five kinds');
    t.eq(await kinds('r:critters'), ['Rats', 'Mice', 'Roaches', 'Spiders', 'Lizards'], 'Critters: five kinds');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    // on the map: fish under a Water area, critters on their own layer
    t.handle('fx.stroke', { mapId: own, id: 'fish-t', preset: 'fish', variant: 'koi', sid: 's1', r: 1.5 * k, pts: [6 * k, 6 * k, 14 * k, 6 * k] });
    t.handle('fx.stroke', { mapId: own, id: 'water-t', preset: 'water', sid: 's1', r: 1.5 * k, pts: [6 * k, 6 * k, 14 * k, 6 * k] });
    t.handle('fx.stroke', { mapId: own, id: 'crit-t', preset: 'critters', variant: 'roaches', sid: 's1', r: 1.5 * k, pts: [6 * k, 11 * k, 12 * k, 11 * k] });
    await t.settle();
    t.eq([M(t).fx.find((f) => f.id === 'fish-t').variant, M(t).fx.find((f) => f.id === 'crit-t').variant], ['koi', 'roaches'], 'their kinds kept');
    const st = await t.until(() => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.critters >= 1 ? { critters: v.stats.critters, regions: v.stats.regions } : null; })()`), 4000, 'the critters layer draws');
    t.eq(st, { critters: 1, regions: 2 }, 'critters on their own layer; fish and water on the effects layer');
    const order = await t.g(`(() => { const v = Play.view(); const all = v.map.fx.filter((f) => f.kind === 'region' && f.preset !== 'critters'); all.sort((a, b) => (b.preset === 'fish') - (a.preset === 'fish')); return all.map((f) => f.preset); })()`);
    t.eq(order, ['fish', 'water'], 'fish are drawn first, under the water');
    const draw = await t.g(`(async () => {
      await Creatures.ready();
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
      // ink at moment t, and how much of it lies outside a box (in squares, 20 px a square)
      const ink = (fx, tt, box) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 300); g.setTransform(20, 0, 0, 20, 0, 0); FX.region(g, fx, tt, 1);
        const d = g.getImageData(0, 0, 400, 300).data; let n = 0; let out = 0; let line = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) { n++; const x = ((i - 3) / 4) % 400 / 20; const y = Math.floor((i - 3) / 4 / 400) / 20; if (box && !box(x, y)) out++; if (Math.abs(y - 11) < 0.7) line++; }
        return { n, out, line, url: c.toDataURL() }; };
      const R = (id, preset, variant, strokes) => ({ id, kind: 'region', preset, variant, intensity: 1, density: 1, speed: 1, strokes });
      const pond = R('tf', 'fish', 'koi', [{ sid: 'a', r: 1.5, pts: [5, 5, 15, 5] }]);
      const inPond = (x, y) => x > 3.3 && x < 16.7 && y > 3.3 && y < 6.7;
      const fishAt = [10, 37, 81, 140, 222, 333].map((tt) => ink(pond, tt, inPond));
      const same = ink(pond, 81, inPond).url === fishAt[2].url;
      const kinds = ['small', 'trout', 'eels'].map((v) => ink({ ...pond, variant: v }, 30, inPond)).map((r) => r.n > 30 && r.out === 0);
      const big = [0, 20, 40, 60, 80, 100].some((tt) => ink({ ...pond, variant: 'shadow' }, tt).n > 100);
      // critters: a wide home (y 5) and a thin run (y 11)
      const crit = (v) => R('tc', 'critters', v, [{ sid: 'a', r: 1.4, pts: [5, 5, 15, 5] }, { sid: 'b', r: 0.25, pts: [4, 11, 16, 11] }]);
      const inCrit = (x, y) => (x > 3.2 && x < 16.8 && y > 3.2 && y < 6.8) || (x > 3.6 && x < 16.4 && y > 10.3 && y < 11.7);
      const ck = ['rats', 'mice', 'roaches', 'spiders', 'lizards'].map((v) => { let n = 0; let out = 0; let line = 0; for (let tt = 5; tt < 200; tt += 13) { const r = ink(crit(v), tt, inCrit); n += r.n; out += r.out; line += r.line; } return n > 200 && out === 0 && line > 0; });
      const cs = ink(crit('rats'), 50, inCrit).url === ink(crit('rats'), 50, inCrit).url;
      return { fish: fishAt.every((r) => r.n > 100 && r.out === 0), same, kinds, big, critters: ck, cs };
    })()`);
    t.eq(draw, { fish: true, same: true, kinds: [true, true, true], big: true, critters: [true, true, true, true, true], cs: true }, 'koi never outside the paint (six moments), the same each time; the other fish draw; the big shadow comes now and then; every critter kind keeps to its home and its run, and runs the thin stroke');
  } finally { await noCard(t, false); } }, { ms: 90000 });

  // Second Builder (second-sun-sand-gears)
  area.deep('Sun, sand and gears: Turning parts (a Round or a Box, no brush; a windmill follows the wind from an anchor the GM stores), Sun through leaves, Drifting sand, a Dust devil, Tumbleweeds with the wind', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false`);
    t.ok(await t.g(`!!ICON_PATHS['circle-dotted'] && FXDATA.WEATHER_TYPES.some((d) => d.id === 'tumble')`), 'Tumbleweeds in Add a layer, with its icon');
    const nature = await t.g(`FXDATA.ELEMENTS.filter((e) => e.family === 'nature').map((e) => e.id)`);
    t.ok(nature.indexOf('turn') === nature.indexOf('sway') + 1 && nature.slice(-2).join() === 'drift,devil' && !nature.includes('dapple'), 'Nature: Turning parts after Sway; Drifting sand, Dust devil at the end; Sun through leaves has no tile yet (Beta 3.63: it waits for the one engine)', nature);
    // Turning parts: only Round and Box
    await t.g(`Play.ui.paintShape = 'brush'`);
    await element(t, 'r:turn');
    const tools = await t.g(`[Play.ui.paintShape, [...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.dataset.v)]`);
    t.eq(tools, ['round', ['fxt-select', 'fxt-box', 'fxt-round', 'fxt-erase']], 'no brush for Turning parts: the brush in hand becomes a Round');
    t.eq(await t.g(`(() => { const s = [...document.querySelectorAll('#pop .seg')].find((x) => x.getAttribute('aria-label') === 'Kind'); return s ? [...s.querySelectorAll('.seg-btn')].map((b) => b.textContent) : null; })()`), ['Steady', 'Windmill', 'Ticking'], 'three kinds');
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.paintShape = 'box'`);
    // a windmill: the GM stores its anchor, and a new one when the wind changes
    t.handle('fx.shape', { mapId: own, id: 'mill', preset: 'turn', variant: 'windmill', sid: 's1', shape: 'round', x: 8 * k, y: 5 * k, w: 3 * k, h: 3 * k });
    t.handle('fx.shape', { mapId: own, id: 'belt', preset: 'turn', variant: 'steady', sid: 's1', shape: 'rect', x: 14 * k, y: 5 * k, w: 4 * k, h: 1 * k, dx: 1, dy: 0 });
    const a1 = await t.until(() => { const f = M(t).fx.find((x) => x.id === 'mill'); return f && f.anc; }, 4000, 'the windmill\'s anchor');
    await t.cmd('wind.set', { mapId: own, auto: false, strength: 2.4 });
    const a2 = await t.until(() => { const f = M(t).fx.find((x) => x.id === 'mill'); return f && f.anc && f.anc.r1 > a1.r1 + 0.01 && f.anc; }, 4000, 'a new anchor in the gale');
    t.ok(a2.r0 <= a2.r1 && a2.at >= a1.at, 'it speeds up from where it was', [a1, a2]);
    const mill = M(t).fx.find((x) => x.id === 'mill');
    const now = Date.now();
    const gm = await t.g(`Creatures.turnsOf(${JSON.stringify(mill)}, 10, ${now})`); const tv = await t.t(`Creatures.turnsOf(${JSON.stringify(mill)}, 10, ${now})`);
    t.ok(Math.abs(gm - tv) < 1e-9, 'the GM and the TV turn it the same', [gm, tv]);
    const st = await t.until(() => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.turning >= 2 ? v.stats.turning : null; })()`), 6000, 'both parts on the Sway layer');
    t.eq(st, 2, 'the Round and the Box turn the map picture');
    t.eq(M(t).fx.filter((f) => f.preset === 'turn').map((f) => !!f.anc), [true, false], 'only the windmill has an anchor');
    // the rest draws, the same at the same moment; tumbleweeds only with wind
    const draw = await t.g(`(async () => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
      const ink = (fn) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 300); g.setTransform(20, 0, 0, 20, 0, 0); fn(); const d = g.getImageData(0, 0, 400, 300).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 12) n++; return { n, url: c.toDataURL() }; };
      const R = (preset, variant) => ({ id: 'ts-' + preset + variant, kind: 'region', preset, variant, intensity: 1, density: 1, speed: 1, strokes: [{ sid: 'a', r: 2, pts: [6, 7, 14, 7] }] });
      Creatures.wind({ dir: 0, strength: 1.8, from: 'own' }); Creatures.scene({ cell: 1, dark: 0 });
      const regions = ['dapple:sunlight', 'dapple:moonlight', 'dapple:rays', 'drift:sand', 'drift:snow', 'drift:ash'].map((x) => { const [p, v] = x.split(':'); const a = ink(() => FX.region(g, R(p, v), 30, 1)); const b = ink(() => FX.region(g, R(p, v), 30, 1)); return a.n > 300 && a.url === b.url; });
      const dv = { id: 'ts-devil', kind: 'emitter', preset: 'devil', variant: 'dust', r: 0.8, intensity: 1, density: 1, speed: 1 };
      const devil = ink(() => FX.emitter(g, dv, 10, 7, Creatures.devilAt(dv, 5))).n > 200;
      const w = { layers: [{ id: 'ts-tw', type: 'tumble', amount: 2, size: 1, speed: 1, born: 0 }] };
      const rolls = (from) => { Creatures.wind({ dir: 0, strength: 1.8, from }); for (let tt = 100; tt < 160; tt += 0.5) if (Creatures.tumble(g, w, 20, 15, tt, 1e15, { sq: 1, dark: 0 }) > 0) return true; return false; };
      const tumble = [rolls('own'), rolls('calm')];
      Creatures.scene(null);
      return { regions, devil, tumble };
    })()`);
    t.eq(draw, { regions: [true, true, true, true, true, true], devil: true, tumble: [true, false] }, 'Sun through leaves and Drifting sand (each kind) draw, the same each time; a dust devil; tumbleweeds roll in a wind and none come in calm air');
  }, { ms: 90000 });

  // Beta 3.63 (main Builder): what the review of the four ambient-life packages turned up
  area.deep('Beta 3.63: an area counts its real size however it was painted; fish and critters live in a Box or a Round; circling birds keep their places; the Big shadow is one soft shape; the creature layers hide while empty; seven family chips fit', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false`);
    // empty map: the two creature layers take no part in the picture
    const hid = await t.until(() => t.t(`(() => { const f = document.querySelector('.sv-fly'); const c = document.querySelector('.sv-crit'); return f && c && getComputedStyle(f).display === 'none' && getComputedStyle(c).display === 'none'; })()`), 5000, 'both layers hidden on the TV');
    t.ok(hid, 'no flyer and no critter: the fly and the critters layers are not shown');
    // the same pond as a Box, as a Round and scrubbed with the brush
    t.handle('fx.shape', { mapId: own, id: 'p-box', preset: 'fish', variant: 'koi', sid: 'a', shape: 'rect', x: 4 * k, y: 4 * k, w: 5 * k, h: 3 * k });
    t.handle('fx.shape', { mapId: own, id: 'p-round', preset: 'fish', variant: 'small', sid: 'a', shape: 'round', x: 12 * k, y: 4 * k, w: 5 * k, h: 3 * k });
    t.handle('fx.shape', { mapId: own, id: 'p-rats', preset: 'critters', variant: 'rats', sid: 'a', shape: 'rect', x: 4 * k, y: 10 * k, w: 5 * k, h: 3 * k });
    for (let p = 0; p < 5; p++) { const pts = []; for (let i = 0; i <= 40; i++) pts.push((12.6 + 3.8 * (i / 40)) * k, (10.6 + 0.45 * p + 0.1 * Math.sin(i)) * k); t.handle('fx.stroke', { mapId: own, id: 'p-brush', preset: 'fish', variant: 'koi', sid: 's' + p, r: 0.6 * k, pts }); }
    await t.settle();
    const fxs = M(t).fx.filter((f) => /^p-/.test(f.id)).map((f) => ({ ...f, strokes: f.strokes.map((s) => ({ ...s, r: s.r / k, pts: s.pts.map((v) => v / k) })) }));
    const shown = await t.until(() => t.t(`getComputedStyle(document.querySelector('.sv-crit')).display !== 'none'`), 5000, 'the critters layer shows once rats live on the map');
    t.ok(shown, 'with rats on the map the critters layer is shown again');
    const res = await t.g(`(async () => {
      await Creatures.ready();
      const FXS = ${JSON.stringify(fxs)}; const F = (id) => FXS.find((f) => f.id === id);
      const area = { box: FX.areaOf(F('p-box'), 't'), round: FX.areaOf(F('p-round'), 't'), brush: FX.areaOf(F('p-brush'), 't') };
      const c = document.createElement('canvas'); c.width = 440; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
      // where the ink lies at a moment (20 px a square): its box, and how many pixels
      const ink = (fn, min = 40) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 440, 300); g.setTransform(20, 0, 0, 20, 0, 0); fn();
        const d = g.getImageData(0, 0, 440, 300).data; let n = 0; let x0 = 1e9; let x1 = -1; let y0 = 1e9; let y1 = -1; let top = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > top) top = d[i]; if (d[i] > min) { n++; const x = ((i - 3) / 4) % 440; const y = Math.floor((i - 3) / 4 / 440); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        return { n, x0: x0 / 20, x1: x1 / 20, y0: y0 / 20, y1: y1 / 20, top }; };
      // koi in the Box: over many moments they are seen all over it, never outside (its soft edge is a quarter square)
      let bx0 = 1e9; let bx1 = -1; let by0 = 1e9; let by1 = -1; let koiOut = 0; let koiN = 0;
      for (let tt = 5; tt < 400; tt += 9) { const r = ink(() => FX.region(g, F('p-box'), tt, 1)); if (!r.n) continue; koiN++; bx0 = Math.min(bx0, r.x0); bx1 = Math.max(bx1, r.x1); by0 = Math.min(by0, r.y0); by1 = Math.max(by1, r.y1); if (r.x0 < 3.75 || r.x1 > 9.25 || r.y0 < 3.75 || r.y1 > 7.25) koiOut++; }
      const small = ink(() => FX.region(g, F('p-round'), 30, 1)).n;
      // rats in the Box: they draw, and they wander (not one spot)
      let rx0 = 1e9; let rx1 = -1; let ratN = 0; let ratFar = 0;
      for (let tt = 5; tt < 300; tt += 7) { const r = ink(() => FX.region(g, F('p-rats'), tt, 1)); if (r.n) ratN++; rx0 = Math.min(rx0, r.x0); rx1 = Math.max(rx1, r.x1); if (r.x0 < 3.4 || r.x1 > 9.6 || r.y0 < 9.4 || r.y1 > 13.6) ratFar++; }
      const ways = [0, 1, 2].map((v) => Creatures.tourOf(F('p-rats'), 'wide', (p) => p[3] || p[2] > 0.6, v)).map((T) => T.P.slice(0, 6).map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
      // the Big shadow: one soft shape, nowhere darker than its own shade (overlapping strips showed as bars)
      let shTop = 0; let shN = 0; const sea = { ...F('p-box'), id: 'p-sea', variant: 'shadow' };
      for (let tt = 0; tt < 200; tt += 4) { const r = ink(() => FX.region(g, sea, tt, 1), 20); if (r.n > shN) { shN = r.n; shTop = r.top; } }
      // circling vultures (Beta 3.66: each at its own height, so they may pass over one another): three of them, and at the real time of day they glide (no jumps)
      const pos = (tt) => { const out = []; const q = document.createElement('canvas').getContext('2d'); const seen = new Set(); q.drawImage = function () { const m = this.getTransform(); const key = m.e.toFixed(2) + '|' + m.f.toFixed(2); if (!seen.has(key)) { seen.add(key); out.push([m.e, m.f]); } }; // (a bird is three pieces at one place)
        Creatures.scene({ dark: 0.7, cell: 1 }); q.setTransform(1, 0, 0, 1, 0, 0); FX.emitter(q, { id: 'tc-vult', kind: 'emitter', preset: 'circling', variant: 'vultures', r: 2, intensity: 1, density: 1, speed: 1 }, 10, 7, tt); Creatures.scene(null); return out; };
      let near = 0; let birds = 1e9; let apart = 1e9; const NOW = Date.now() / 1000 - 1.7e9;
      for (let tt = NOW; tt < NOW + 900; tt += 3.7) { const P = pos(tt); const Q = pos(tt + 1 / 30); birds = Math.min(birds, P.length); for (const p of P) near = Math.max(near, Math.min(...Q.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))); for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) apart = Math.min(apart, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])); } // (near: the furthest any bird moves in a frame; apart: the closest two come)
      return { area, koi: { n: koiN, out: koiOut, w: bx1 - bx0, h: by1 - by0 }, small, rats: { n: ratN, far: ratFar, w: rx1 - rx0 }, ways, sh: { n: shN, top: shTop }, near, birds, apart };
    })()`);
    t.ok(Math.abs(res.area.box - 15) < 0.4 && Math.abs(res.area.round - 11.8) < 0.5 && res.area.brush > 12 && res.area.brush < 18, 'a Box of 5 × 3 counts 15 squares, the Round its ellipse, the scrubbed pond what it covers (not each pass again)', res.area);
    t.ok(res.koi.n > 30 && res.koi.out === 0 && res.koi.w > 3.5 && res.koi.h > 1.8, 'koi in a Box swim all through it and never leave it', res.koi);
    t.ok(res.small > 20, 'small fish in a Round draw', res.small);
    t.ok(res.rats.n > 35 && res.rats.far === 0 && res.rats.w > 3.5, 'rats in a Box are there, wander through it and stay with it', res.rats);
    t.ok(new Set(res.ways).size === 3, 'three ways round an area, so they do not all take one path', res.ways);
    t.ok(res.sh.n > 100 && res.sh.top < 110, 'the Big shadow is one faint shape (no darker bars where its strips overlap)', res.sh);
    t.ok(res.birds === 3 && res.near < 0.15 && res.apart > 1.2, 'three vultures circle: none jumps from one frame to the next, and they keep apart round the circle', [res.birds, res.near, res.apart]);
    // the family chips
    await t.g(`(() => { Play.setTool('fx'); Play.ui.fxMode = 'place'; Play.ui.fxFam = 'all'; Play.openPop('fx'); })()`);
    await t.until(async () => (await t.count('#pop .fx-chips .cs-chip')) >= 7, 4000, 'the family chips');
    const chips = await t.g(`(() => { const b = document.querySelector('#pop .pop-body').getBoundingClientRect(); return [...document.querySelectorAll('#pop .fx-chips .cs-chip')].map((c) => { const r = c.getBoundingClientRect(); return [c.textContent, r.right <= b.right + 0.5 && c.scrollWidth <= c.clientWidth]; }); })()`);
    t.ok(chips.length === 7 && chips.every((c) => c[1]), 'All and six families: every chip inside the panel, none cut off', chips);
    await t.g(`Play.closePop(); Play.setTool('select')`);
  }, { ms: 120000 });

  // Beta 3.64 (Effects step 2, open point C11)
  area.deep('Beta 3.64 and 3.66: painted areas show an outline with the Select tool only; a click inside one picks it, a second click the one under it; with any other tool a click or a drag paints or places; the outlines follow a zoom; the banner plays; Daylight is in Lights', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    await t.g(`Play.closePop(); Play.setTool('select'); Play.ui.looks = {}; Play.ui.fxFly = false; Play.ui.ltDay = false`);
    t.handle('fx.shape', { mapId: own, id: 'p-water', preset: 'water', sid: 'a', shape: 'round', x: 11 * k, y: 3 * k, w: 6 * k, h: 5 * k });
    t.handle('fx.shape', { mapId: own, id: 'p-mist', preset: 'mist', sid: 'a', shape: 'rect', x: 18 * k, y: 2 * k, w: 7 * k, h: 7 * k });
    t.handle('fx.stroke', { mapId: own, id: 'p-blood', preset: 'blood', sid: 's1', r: 0.6 * k, pts: [20 * k, 5 * k, 21 * k, 5.6 * k, 21.6 * k, 5 * k] });
    t.handle('fx.shape', { mapId: own, id: 'p-lava', preset: 'lava', sid: 'a', shape: 'rect', x: 12 * k, y: 10 * k, w: 5 * k, h: 3 * k });
    t.handle('fx.cut', { mapId: own, sid: 'c1', shape: 'round', x: 13.5 * k, y: 10.5 * k, w: 2 * k, h: 2 * k });
    await t.settle();
    const edge = () => t.g(`(() => { const c = document.querySelector('.sv-edge'); if (!c || getComputedStyle(c).display === 'none') return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; return n; })()`);
    t.eq(await edge(), 0, 'no outlines outside Effects');
    await element(t, 'r:mist'); await shape(t, 'box');
    await t.sleep(400);
    t.eq([await edge(), await t.g(`Play.ui.fxSel`), await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.dataset.v + (b.classList.contains('on') ? '*' : ''))`)], [0, false, ['fxt-select', 'fxt-box*', 'fxt-round', 'fxt-brush', 'fxt-erase']], 'Elements with the Box in hand: no outlines (Beta 3.66), Select is the first tool');
    // a click inside an area with the Box in hand picks nothing
    const pw0 = await t.scr(14 * k, 5.5 * k); await t.mouse('mouseMove', pw0.x, pw0.y); await t.click(pw0.x, pw0.y); await t.sleep(300);
    t.eq([await t.g(`Play.ui.selFx`), await t.g(`document.body.classList.contains('fx-pick')`)], [null, false], 'the Box in hand: a click inside an area picks nothing, no hand');
    await select(t);
    const lines = await t.until(async () => { const n = await edge(); return n > 300 ? n : 0; }, 4000, 'the outlines with Select');
    t.ok(lines > 300 && await t.g(`Play.ui.fxSel === true && document.body.classList.contains('fx-select')`), 'Select: the painted areas are outlined', lines);
    // the outlines follow a zoom (in 3.64 they stayed where they were until something else redrew them)
    const box = async () => { const b = await t.g(`(() => { const c = document.querySelector('.sv-edge'); const r = c.getBoundingClientRect(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = 1e9; let x1 = -1; let y0 = 1e9; let y1 = -1; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) { const x = ((i - 3) / 4) % c.width; const y = Math.floor((i - 3) / 4 / c.width); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } const kx = r.width / c.width; const ky = r.height / c.height; return [r.left + x0 * kx, r.top + y0 * ky, r.left + x1 * kx, r.top + y1 * ky]; })()`); const a = await t.scr(11 * k, 2 * k); const z = await t.scr(25 * k, 13 * k); return [b, [a.x, a.y, z.x, z.y]]; };
    const off = ([b, w]) => Math.max(...b.map((v, i) => Math.abs(v - w[i])));
    const fit0 = await box();
    const v0 = { ...M(t).view };
    await t.cmd('view.update', { mapId: own, ...v0, zoom: v0.zoom * 0.8 }); await t.sleep(500);
    const fit1 = await box();
    await t.cmd('view.update', { mapId: own, ...v0 }); await t.sleep(500);
    t.ok(off(fit0) < 8 && off(fit1) < 8 && Math.abs(fit1[1][0] - fit0[1][0]) + Math.abs(fit1[1][2] - fit0[1][2]) > 20, 'the outlines lie on their areas, also after a zoom', [fit0, fit1]);
    // the point is in the area (and not where it was erased)
    const hit = await t.g(`(() => { const fx = Play.state().map.fx; const F = (id) => fx.find((f) => f.id === id); const k = ${k}; return [FX.hits(F('p-water'), 14 * k, 5.5 * k), FX.hits(F('p-water'), 11.3 * k, 3.3 * k), FX.hits(F('p-lava'), 12.5 * k, 10.5 * k), FX.hits(F('p-lava'), 14.5 * k, 11.5 * k), FX.hits(F('p-blood'), 21 * k, 5.5 * k)]; })()`);
    t.eq(hit, [true, false, true, false, true], 'in a Round, outside its corner, in a Box, in its erased hole, on a brush line');
    // hover and click
    const pw = await t.scr(14 * k, 5.5 * k); await t.mouse('mouseMove', pw.x, pw.y);
    const hov = await t.until(() => t.g(`Play.view().hoverArea === 'p-water' && document.body.classList.contains('fx-pick')`), 3000, 'the water lights up under the pointer');
    t.ok(hov, 'the area a click would pick lights up, the pointer is a hand');
    await t.click(pw.x, pw.y);
    await t.until(() => t.g(`Play.ui.selFx === 'p-water'`), 3000, 'the click picks the water');
    t.ok(await t.until(() => t.g(`!!document.querySelector('#pop .fx-ban-tag') && !document.querySelector('#pop .fx-gal')`), 3000, 'its card'), 'a click inside the water picks it: the panel is its card');
    const pb = await t.scr(21 * k, 5.5 * k); await t.click(pb.x, pb.y);
    await t.until(() => t.g(`Play.ui.selFx === 'p-blood'`), 3000, 'the blood, the smaller of the two there');
    await t.click(pb.x, pb.y);
    await t.until(() => t.g(`Play.ui.selFx === 'p-mist'`), 3000, 'a second click takes the mist under it');
    const ph = await t.scr(14.5 * k, 11.5 * k); await t.click(ph.x, ph.y);
    await t.until(() => t.g(`Play.ui.selFx == null`), 3000, 'a click in the erased hole lets go');
    t.ok(await t.until(() => t.g(`!!document.querySelector('#pop .fx-gal')`), 3000, 'the tiles again'), 'the smallest area first, then the one under it; a click on no area lets go');
    // Select draws nothing; the Box draws again and picks nothing
    const strokes = () => M(t).fx.reduce((n, f) => n + (f.strokes ? f.strokes.length : 0), 0);
    let n0 = strokes();
    await t.drag(await t.scr(26 * k, 11 * k), await t.scr(28 * k, 13 * k)); await t.sleep(400);
    t.eq(strokes(), n0, 'a drag with Select draws nothing');
    await shape(t, 'box');
    t.eq([await t.g(`Play.ui.fxSel`), await edge()], [false, 0], 'the Box in hand again: no outlines');
    await t.drag(await t.scr(26 * k, 11 * k), await t.scr(28 * k, 13 * k));
    await t.until(() => strokes() > n0, 4000, 'the box is drawn');
    t.eq(await t.g(`Play.ui.selFx`), null, 'a drag draws and picks nothing');
    // the brush paints inside an area; a click effect is placed inside an area
    await shape(t, 'brush'); n0 = strokes();
    await t.click(pw.x, pw.y);
    await t.until(() => strokes() > n0, 4000, 'a dab of the brush');
    t.eq(await t.g(`Play.ui.selFx`), null, 'the brush paints inside an area (it picks nothing)');
    await element(t, 'e:smoke'); const e0 = M(t).fx.length;
    await t.click(pw.x, pw.y);
    await t.until(() => M(t).fx.length === e0 + 1, 4000, 'the smoke is placed');
    t.eq(await t.g(`Play.ui.selFx`), null, 'a click effect is placed inside an area');
    // the banner plays, with canvases of its own
    const ban = await t.until(() => t.g(`(() => { const c = document.querySelector('#pop .fx-ban canvas.fx-play:not(.blank)'); return c ? c.toDataURL().length : 0; })()`), 5000, 'the playing banner');
    await t.sleep(600);
    const ban2 = await t.g(`document.querySelector('#pop .fx-ban canvas.fx-play').toDataURL().length`);
    t.ok(ban > 2000 && ban !== ban2, 'the banner is a playing picture', [ban, ban2]);
    // Lights → Daylight
    t.eq(await t.g(`FXDATA.ELEMENTS.filter((e) => e.id === 'shaft' || e.id === 'window').length`), 0, 'Light shaft and Window light are no Elements tiles');
    await t.g(`document.querySelector('[data-v="fxg-lights"]').click()`);
    await t.until(() => t.g(`!!document.querySelector('#pop .lt-groups')`), 3000, 'the Light panel');
    t.eq(await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].map((b) => b.textContent)`), ['Holder', 'Flame', 'Just light', 'Daylight'], 'four kinds of light');
    t.eq([await edge(), await t.g(`[...document.querySelectorAll('#pop .os-tabs2 .tile')].map((b) => b.dataset.v + (b.classList.contains('on') ? '*' : ''))`)], [0, ['fxt-select', 'fxt-place*']], 'no outlines in Lights; its tools are Select and Place');
    await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].find((b) => b.textContent === 'Daylight').click()`);
    await t.until(() => t.g(`document.querySelectorAll('#pop .lt-day .tile').length === 2`), 3000, 'the two daylights');
    t.eq(await t.g(`[[...document.querySelectorAll('#pop .lt-day .tile')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')), document.querySelector('[data-v="fxg-lights"]').classList.contains('open'), [...document.querySelectorAll('#pop .win-picks')].length]`), [['Window light*', 'Light shaft'], true, 2], 'Daylight: Window light in hand, in Lights, with its window and bars');
    const pd = await t.scr(20 * k, 12 * k); await t.click(pd.x, pd.y);
    const win = await t.until(() => M(t).fx.find((f) => f.preset === 'window'), 4000, 'a window light on the map');
    t.ok(win.shape === 'arched' && win.grid === 'cross', 'a click places it', win);
    await t.g(`Play.selectFx(${JSON.stringify(win.id)})`);
    t.ok(await t.until(() => t.g(`document.querySelector('[data-v="fxg-lights"]').classList.contains('open') && !!document.querySelector('#pop .fx-back') && !document.querySelector('#pop .lt-day')`), 3000, 'the picked window light'), 'picked: its card, in Lights');
    await t.g(`Play.selectFx(null)`);
    t.ok(await t.until(() => t.g(`document.querySelector('[data-v="fxg-lights"]').classList.contains('open') && document.querySelectorAll('#pop .lt-day .tile').length === 2`), 3000, 'Daylight again'), 'let go: Daylight again');
    await t.g(`[...document.querySelectorAll('#pop .lt-groups .seg-btn')].find((b) => b.textContent === 'Holder').click()`);
    t.ok(await t.until(() => t.g(`!!document.querySelector('#pop .light-card') && Play.ui.fxMode === 'light'`), 3000, 'the holders'), 'Holder brings the Light panel back');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    t.eq(await edge(), 0, 'outlines gone with the tool');
  }, { ms: 120000 });

  area.deep('on the TV the effects lie under the fog, the weather above it', async (t) => {
    await clean(t);
    const order = await t.t(`(() => { const w = document.querySelector('.tv-layer.shown .sv-world'); return [...w.querySelectorAll('canvas')].map((e) => (e.className.baseVal ?? e.className).split(' ').pop()); })()`);
    const at = (name) => order.findIndex((x) => x.includes(name));
    t.ok(at('atmo') >= 0 && at('fog') >= 0 && at('weather') >= 0, 'the TV has its layers', order);
    t.ok(at('atmo') < at('fog'), 'effects under the fog', order);
    t.ok(at('fog') < at('weather'), 'weather above the fog', order);
  });
  // Beta 3.66 (Glinn's nine points on Effects)
  area.deep('Beta 3.66: one Wind slider makes the wind the map\'s own; Bats painted over an area fly on the fly layer and glide at the real time; a tour is a round trip with no about-turn; the whirlpool\'s twist is steady; a canvas turns smoothly at the real time', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    t.gm().webContents.focus();
    t.handle('wind.set', { mapId: own, auto: true, storm: false }); await t.settle();
    // Scene: the one slider
    await t.g(`(() => { Play.closePop(); Play.setTool('fx'); Play.openPop('fx'); document.querySelector('[data-v="fxg-scene"]').click(); })()`);
    await t.until(() => t.count('#pop .fx-wind input'), 3000, 'the Wind slider');
    t.eq(await t.g(`[document.querySelector('#pop .fx-wind .ctl-label').textContent, [...document.querySelectorAll('#pop .fx-fold > summary')].map((x) => x.textContent.trim()).filter((x) => /wind/i.test(x)), document.querySelector('#pop .fx-fold[data-v="fxMoreWind"]').open]`), ['Wind', ['Advanced wind'], false], 'Wind, and Advanced wind folded');
    await t.g(`(() => { const i = document.querySelector('#pop .fx-wind input'); i.value = 2; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const w = await t.until(() => { const x = M(t).wind; return x && x.auto === false && Math.abs(x.strength - 2) < 0.01 ? x : null; }, 3000, 'the wind is the map\'s own');
    t.ok(w.lean > 0 && w.branches > 0 && w.rustle > 0 && !w.storm, 'the slider sets the strength, and lean, branches and leaves with it', w);
    t.eq(await t.g(`document.querySelector('#pop .fx-wind output').textContent`), 'A gale', 'said in a word');
    await t.g(`document.querySelector('#pop .fx-fold[data-v="fxMoreWind"] summary').click()`);
    t.eq(await t.g(`(() => { const f = document.querySelector('#pop .fx-fold[data-v="fxMoreWind"]'); return [[...f.querySelectorAll('.ctl-slider .ctl-label')].map((x) => x.textContent), !!f.querySelector('.compass, .wind-compass, [class*="compass"]'), [...f.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Storm')]; })()`), [['Lean', 'Branches', 'Leaves'], true, true], 'Advanced wind: follow the weather, Storm, the direction, Lean, Branches, Leaves');
    t.handle('wind.set', { mapId: own, auto: true, storm: false }); await t.settle();
    // Bats, painted: a tile of its own, on the fly layer
    await element(t, 'r:batflight'); await shape(t, 'box');
    t.eq(await t.g(`[document.querySelector('#pop .fx-gal .fx-t[data-v="r:batflight"]').textContent, document.querySelector('#pop .fx-gal .fx-t[data-v="e:bats"]').textContent]`), ['Bats', 'Bat stream'], 'Bats is painted; the old one is Bat stream');
    await t.drag(await t.scr(12 * k, 3 * k), await t.scr(20 * k, 8 * k));
    const bats = await t.until(() => M(t).fx.find((f) => f.preset === 'batflight'), 4000, 'the bats\' area');
    await t.g(`Play.closePop(); Play.setTool('select')`);
    const st = await t.until(() => t.g(`(() => { const v = Play.view(); v.drawFrame(); return v.stats.fly >= 1 ? { fly: v.stats.fly, layer: getComputedStyle(v.cv.fly.el).display !== 'none' } : null; })()`), 4000, 'the fly layer draws them');
    t.ok(st.fly >= 1 && st.layer, 'painted bats fly on the fly layer (over the trees)', st);
    const fxs = M(t).fx.map((f) => ({ ...f, strokes: f.strokes && f.strokes.map((q) => ({ ...q, r: q.r / k, pts: q.pts.map((v) => v / k), ...(q.line ? { line: q.line.map((v) => v / k), lr: q.lr / k } : {}) })) }));
    const res = await t.g(`(async () => {
      await Creatures.ready();
      const F = ${JSON.stringify(fxs)}.find((f) => f.preset === 'batflight');
      const NOW = Date.now() / 1000 - 1.7e9;
      // where the pictures are drawn (a bat is a few pieces at one place)
      const pos = (tt) => { const out = []; const q = document.createElement('canvas').getContext('2d'); const seen = new Set(); q.drawImage = function () { const m = this.getTransform(); const key = m.e.toFixed(2) + '|' + m.f.toFixed(2); if (!seen.has(key)) { seen.add(key); out.push([m.e, m.f]); } };
        Creatures.scene({ dark: 0, cell: 1 }); q.setTransform(1, 0, 0, 1, 0, 0); FX.region(q, F, tt, 1); Creatures.scene(null); return out; };
      let step = 0; let n = 1e9; let x0 = 1e9; let x1 = -1e9;
      for (let tt = NOW; tt < NOW + 40; tt += 1.3) { const P = pos(tt); const Q = pos(tt + 1 / 30); n = Math.min(n, P.length); for (const p of P) { step = Math.max(step, Math.min(...Q.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); } }
      // a tour: a round trip, and no two steps in a row turn about
      // (the way itself has short kinks where its lanes meet; what a walker does on it, rounded off, is what shows)
      const tours = [0, 1, 2].map((v) => Creatures.tourOf(F, 'all', () => true, v)).filter(Boolean).map((T) => { const P = T.P; let worst = 0; let prev = null;
        for (let u = 0; u < T.L; u += 0.02) { const a = Creatures.walker(T, u, 0, 0.6).ang; if (prev != null) { let d = Math.abs(a - prev) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; worst = Math.max(worst, d); } prev = a; }
        return { n: P.length, closed: Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6, worst }; });
      // the whirlpool's twist: steady from one frame to the next, and never more than it may be
      const wh = { id: 'tw', spin: 1, variant: 'maelstrom', intensity: 1, speed: 1 }; let dT = 0; let top = 0;
      for (let i = 0; i < 300; i++) { const a = Creatures.twistOf(wh, NOW + i / 30); const b = Creatures.twistOf(wh, NOW + (i + 1) / 30); dT = Math.max(dT, Math.abs(b - a)); top = Math.max(top, Math.abs(a)); }
      // a canvas turned by a very large angle (the time of day times a rate) lands where the same angle within one turn
      // lands: the browser's own rotate() stood still there for most of a turn, then jumped (boot.js)
      const rc = document.createElement('canvas'); rc.width = rc.height = 200; const rg = rc.getContext('2d', { willReadFrequently: true });
      const mark = (a) => { rg.setTransform(1, 0, 0, 1, 0, 0); rg.clearRect(0, 0, 200, 200); rg.translate(100, 100); rg.rotate(a); rg.fillStyle = '#fff'; rg.fillRect(78, -2, 4, 4);
        const d = rg.getImageData(0, 0, 200, 200).data; let sx = 0; let sy = 0; let m = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 100) { const p = (i - 3) / 4; sx += p % 200; sy += Math.floor(p / 200); m++; } return m ? Math.atan2(sy / m - 100, sx / m - 100) : 9; };
      let turnOff = 0; for (let j = 0; j < 12; j++) { const a = NOW * 0.52 + j * 0.2; let d = Math.abs(mark(a) - mark(a % (2 * Math.PI))); if (d > Math.PI) d = 2 * Math.PI - d; turnOff = Math.max(turnOff, d); }
      let turnStep = 0; for (let j = 0; j < 12; j++) { let d = Math.abs(mark(NOW * 0.52 + (j + 1) * 0.2) - mark(NOW * 0.52 + j * 0.2)); if (d > Math.PI) d = 2 * Math.PI - d; turnStep = Math.max(turnStep, Math.abs(d - 0.2)); }
      return { n, step, w: x1 - x0, tours, dT, top, back: Creatures.twistOf({ ...wh, spin: -1 }, NOW) < 0, turnOff, turnStep };
    })()`);
    t.ok(res.n >= 2 && res.step < 0.3 && res.w > 3, 'bats over the whole area, and none jumps from one frame to the next (at the real time of day)', [res.n, res.step, res.w]);
    t.ok(res.tours.length === 3 && res.tours.every((T) => T.closed && T.n > 8 && T.worst < 0.2), 'a way round an area is a round trip, and a walker on it never turns about in one step (fish and critters flipped at every dead end)', res.tours);
    t.ok(res.dT < 0.01 && res.top <= 1.5 && res.top > 0.5 && res.back, 'the whirlpool twists the water steadily, the other way when turned about', [res.dT, res.top]);
    t.ok(res.turnOff < 0.02 && res.turnStep < 0.03, 'a canvas turns smoothly at the real time of day: by 0.2 for every 0.2 (a whirlpool, a dust devil and a gear stood still, then jumped)', [res.turnOff, res.turnStep]);
  });

  // ---------- 26 Nov 2026 (Open Points WI1, WI2) ----------
  // WI1: six effects jumped once when a setting changed, because their pace (which follows that setting) was multiplied
  // by the time. Each is drawn at the real time of day, the setting is moved a little, and it is drawn a thirtieth of
  // a second later: every creature must be about where it was.
  area.quick('WI1: circling birds, butterflies, bats, a dust devil, tumbleweeds, a flock of birds and drifting sand go on from where they are when Size, the wind or the zoom of the map changes; the webs count Speed once', async (t) => {
    const res = await t.g(`(async () => {
      const NOW = Date.now() / 1000 - 1.7e9; const DT = 1 / 30;
      await Creatures.ready();
      Creatures._runForget();
      // where things are drawn (a creature is several pieces: every piece counts)
      const spy = (fn) => { const out = []; const q = document.createElement('canvas').getContext('2d'); q.drawImage = function (...a) { const m = this.getTransform(); const dx = a.length >= 9 ? a[5] : (a[1] || 0); const dy = a.length >= 9 ? a[6] : (a[2] || 0); out.push([m.a * dx + m.c * dy + m.e, m.b * dx + m.d * dy + m.f]); }; q.setTransform(1, 0, 0, 1, 0, 0); fn(q); return out; };
      // the furthest any piece of the first picture is from the nearest piece of the second
      const far = (A, B) => { if (!A.length || !B.length) return 999; let worst = 0; for (const p of A) { let best = 1e9; for (const q of B) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1])); worst = Math.max(worst, best); } return worst; };
      const out = {};
      // Size: circling birds, butterflies, bats
      Creatures.wind({ dir: 0, strength: 1, from: 'own' });
      for (const [name, fx, step] of [['circling', { preset: 'circling', variant: 'vultures', r: 4.5 }, 1.02], ['butterflies', { preset: 'insects', variant: 'butterflies', r: 1.5, density: 2 }, 1.02], ['bats', { preset: 'bats', variant: 'flutter', r: 1.5, density: 1.5 }, 1.02]]) {
        const F = { id: 'wi1-' + name, kind: 'emitter', intensity: 1, density: 1, speed: 1, ...fx };
        const draw = (f, tt) => spy((q) => { Creatures.scene({ dark: 0, cell: 1 }); FX.emitter(q, f, 10, 7, tt); Creatures.scene(null); });
        const a = draw(F, NOW); const same = draw(F, NOW + DT); const b = draw({ ...F, r: F.r * step }, NOW + 2 * DT);
        out[name] = { n: a.length, still: far(a, same), moved: far(same, b) };
      }
      // the wind: a dust devil (three of them, each six seconds old)
      out.devil = [];
      for (const id of ['wi1-d1', 'wi1-d2', 'wi1-d3']) {
        const F = { id, kind: 'emitter', preset: 'devil', variant: 'dust', r: 0.8, intensity: 1, density: 1, speed: 1 };
        Creatures.wind({ dir: 0, strength: 1.2, from: 'own' });
        const per = 26 / (1.2 - 0.2); const sd = FX.seedOf(id); let tt = NOW;
        for (; tt < NOW + per * 3; tt += 0.05) if (Math.abs(Creatures.cycle(tt, per, sd, 0.6).since - 6) < 0.03) break;
        const draw = (t2) => spy((q) => { Creatures.scene({ dark: 0, cell: 1 }); FX.emitter(q, F, 10, 7, t2); Creatures.scene(null); });
        const a = draw(tt); const same = draw(tt + DT);
        Creatures.wind({ dir: 0, strength: 1.23, from: 'own' });
        const b = draw(tt + 2 * DT);
        Creatures.wind({ dir: 0, strength: 2.2, from: 'own' });
        const gale = draw(tt + 3 * DT);
        out.devil.push({ n: a.length, still: far(a, same), moved: far(same, b), gale: gale.length });
      }
      // the wind: tumbleweeds (three layers, each with a weed on its way across)
      out.tumble = [];
      for (const id of ['wi1-t1', 'wi1-t2', 'wi1-t3']) {
        const w = { layers: [{ id, type: 'tumble', amount: 4, size: 1, speed: 1, born: 0 }] }; // (Amount 4: the next one then comes by how long a crossing takes, which follows the wind)
        Creatures.wind({ dir: 0, strength: 1.8, from: 'own' });
        const draw = (t2) => spy((q) => Creatures.tumble(q, w, 20, 15, t2, 1e15, { sq: 1, dark: 0 }));
        let tt = NOW; for (; tt < NOW + 120; tt += 0.25) if (draw(tt).length && draw(tt + 1.5).length) break;
        const a = draw(tt); const same = draw(tt + DT);
        Creatures.wind({ dir: 0, strength: 1.85, from: 'own' });
        const b = draw(tt + 2 * DT);
        out.tumble.push({ n: a.length, still: far(a, same), moved: far(same, b) });
      }
      // the zoom of the map: a flock of birds
      out.birds = [];
      for (const id of ['wi1-b1', 'wi1-b2', 'wi1-b3']) {
        const w = { layers: [{ id, type: 'birds', variant: 'geese', amount: 4, size: 1, speed: 1, dir: 200, born: 0 }] };
        const draw = (t2, sq) => spy((q) => Creatures.sky(q, w, 40, 22, t2, 1e15, { sq, dark: 0 }));
        let tt = NOW; for (; tt < NOW + 120; tt += 0.25) if (draw(tt, 1).length && draw(tt + 2, 1).length) break;
        const a = draw(tt, 1); const same = draw(tt + DT, 1); const b = draw(tt + 2 * DT, 1.02);
        out.birds.push({ n: a.length, still: far(a, same), moved: far(same, b) });
      }
      // the wind: drifting sand, by its picture (how much of it changes from one picture to the next)
      {
        const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
        const F = { id: 'wi1-sand', kind: 'region', preset: 'drift', variant: 'sand', intensity: 1.4, density: 1, speed: 1, strokes: [{ sid: 'a', r: 3, pts: [5, 7, 15, 7] }] };
        const shot = (tt) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 300); g.setTransform(20, 0, 0, 20, 0, 0); FX.region(g, F, tt, 1); return g.getImageData(0, 0, 400, 300).data; };
        const diff = (A, B) => { let d = 0; for (let i = 3; i < A.length; i += 4) d += Math.abs(A[i] - B[i]); return d / (A.length / 4); };
        Creatures.wind({ dir: 0, strength: 1, from: 'own' }); Creatures.scene({ dark: 0, cell: 1 });
        const a = shot(NOW); const same = shot(NOW + DT);
        Creatures.wind({ dir: 0, strength: 1.03, from: 'own' });
        const b = shot(NOW + 2 * DT);
        Creatures.scene(null);
        let ink = 0; for (let i = 3; i < a.length; i += 4) if (a[i] > 12) ink++;
        out.sand = { ink, still: diff(a, same), moved: diff(same, b) };
      }
      // the webs: Speed counts once. Two webs, one at twice the Speed with its clock set to the same moment: the same picture
      {
        const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d', { willReadFrequently: true });
        const W = (extra) => ({ id: 'wi1-web', kind: 'region', preset: 'web', intensity: 1.6, density: 1, speed: 1, strokes: [{ sid: 'a', r: 2.5, pts: [6, 7, 14, 7] }], ...extra });
        const shot = (fx, tt) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 300); g.setTransform(20, 0, 0, 20, 0, 0); FX.region(g, fx, tt, 1); return g.getImageData(0, 0, 400, 300).data; };
        const diff = (A, B) => { let d = 0; for (let i = 3; i < A.length; i += 4) d += Math.abs(A[i] - B[i]); return d / (A.length / 4); };
        Creatures.wind({ dir: 0, strength: 1, from: 'own' }); Creatures.scene({ dark: 0, cell: 1 });
        const one = W({}); const p = FXDATA.phaseT(one, NOW);
        const two = W({ speed: 2, panc: { at: Math.round((NOW + 1.7e9) * 1000), p } }); // (Speed moved to 2 at this very moment)
        const tAt = Math.round((NOW + 1.7e9) * 1000) / 1000 - 1.7e9;
        const a = shot(one, tAt); const b = shot(two, tAt); const later = shot(one, tAt + 3);
        Creatures.scene(null);
        let ink = 0; for (let i = 3; i < a.length; i += 4) if (a[i] > 12) ink++;
        out.web = { ink, sameMoment: diff(a, b), threeSecondsOn: diff(a, later) };
      }
      Creatures.wind(null); Creatures._runForget();
      return out;
    })()`);
    t.note(JSON.stringify(res));
    for (const [name, lim] of [['circling', 0.4], ['butterflies', 0.25], ['bats', 0.4]]) {
      const r = res[name];
      t.ok(r.n >= 3 && r.still < lim && r.moved < lim, `${name}: a step of Size (2 %) moves none of them further than ${lim} squares in a thirtieth of a second`, r);
    }
    t.ok(res.devil.every((r) => r.n >= 3 && r.moved < Math.max(0.3, r.still * 3) && r.gale >= 3), 'three dust devils, six seconds old: a little more wind leaves each where it is, and in a gale each still stands (it was gone, or stood there half grown)', res.devil);
    t.ok(res.tumble.every((r) => r.n >= 1 && r.moved < 0.6), 'three tumbleweeds on their way across: a little more wind leaves each on its way', res.tumble);
    t.ok(res.birds.every((r) => r.n >= 3 && r.moved < 1), 'three flocks over the table: the map zoomed by 2 % leaves each where it flies', res.birds);
    t.ok(res.sand.ink > 2000 && res.sand.moved < res.sand.still * 2.5 + 0.5, 'drifting sand: a little more wind changes its picture no more than a moment of drifting does', res.sand);
    t.ok(res.web.ink > 500 && res.web.sameMoment < res.web.threeSecondsOn * 0.25 + 0.05, 'the webs: Speed set to 2 at this moment shows the picture of this moment (Speed counted twice, and they stood somewhere else)', res.web);
  }, { ms: 60000 });

  // WI2: the noise under water, lava and grass, drawn by the graphics card as the app draws it, at the start and after
  // twelve hours on one map: as much detail across as down, at both times
  area.quick('WI2: the noise of water, lava and grass is as fine after twelve hours as at the start (it turned into stripes after one to two); the clocks start anew after twelve hours', async (t) => {
    const res = await t.g(`(() => {
      const N = 192;
      const run = (tt, mode) => {
        const c = document.createElement('canvas'); c.width = c.height = N; const gl = c.getContext('webgl2', { preserveDrawingBuffer: true });
        if (!gl) return null;
        const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, ['#version 300 es', 'void main(){ vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(v * 2.0 - 1.0, 0, 1); }'].join(String.fromCharCode(10))));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, ['#version 300 es', 'precision highp float; uniform float t; uniform int mode; out vec4 o;', Living.NOISE, 'void main(){ vec2 q = gl_FragCoord.xy / 48.0; float v = mode == 0 ? fbm(q * 2.2 + vec2(t * 0.33, t * 0.26)) : fbm(vec2(q.x * 5.0, q.y * 2.3 - t * 0.9)); o = vec4(v, v, v, 1); }'].join(String.fromCharCode(10))));
        gl.linkProgram(p); gl.useProgram(p); gl.uniform1f(gl.getUniformLocation(p, 't'), tt); gl.uniform1i(gl.getUniformLocation(p, 'mode'), mode);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const px = new Uint8Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sx = 0; let sy = 0; const v = (x, y) => px[(y * N + x) * 4];
        for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) { sx += Math.abs(v(x + 1, y) - v(x, y)); sy += Math.abs(v(x, y + 1) - v(x, y)); }
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
        const n = (N - 1) * (N - 1); return [sx / n, sy / n];
      };
      return { water: [run(10, 0), run(Living.CLOCK_MAX, 0)], lava: [run(10, 1), run(Living.CLOCK_MAX, 1)], max: Living.CLOCK_MAX };
    })()`);
    if (!res.water[0]) { t.note('no graphics card here: not checked'); return; }
    t.note(JSON.stringify(res));
    for (const k of ['water', 'lava']) {
      const [a, b] = res[k];
      t.ok(b[0] > a[0] * 0.8 && b[0] < a[0] * 1.25 && b[1] > a[1] * 0.8 && b[1] < a[1] * 1.25, `${k}: as much detail across and down after twelve hours as at the start`, res[k]);
    }
    t.eq(res.max, 43200, 'the clocks of the moving layer start anew after twelve hours');
  });

  // XA8 (Glinn, 26 Nov 2026): the spiders of the Webs effect popped in and out
  area.quick('XA8: an orb web\'s spider hides and walks inside what was painted (its hiding place lay outside for many webs, where the web is cut away), and turns round without a jump', async (t) => {
    const out = await t.g(`(() => {
      const res = { orbs: 0, spiders: 0, outBefore: 0, outNow: 0, worstTurn: 0, far: 0 };
      for (let n = 0; n < 12; n++) {
        const fx = { id: 'xa8-' + n, kind: 'region', preset: 'web', density: 1, strokes: [{ sid: 'a', r: 1.2, pts: [4, 5, 9, 5, 14, 6] }] };
        for (const wb of FX._webShapes(fx)) {
          if (wb.kind !== 'orb') continue; res.orbs++;
          if (!wb.spider) continue; res.spiders++;
          const ex = wb.cx + Math.cos(wb.ang[wb.home]) * wb.len[wb.home]; const ey = wb.cy + Math.sin(wb.ang[wb.home]) * wb.len[wb.home];
          if (Math.hypot(ex - wb.sx, ey - wb.sy) > wb.sr - 0.3) res.outBefore++; // (the end of its spoke: where it hid before)
          let last = null; let bad = false;
          for (let tt = 0; tt < 90; tt += 0.05) {
            const p = FX._orbSpider(wb, tt);
            const d = Math.hypot(p.x - wb.sx, p.y - wb.sy); res.far = Math.max(res.far, d - (wb.sr - 0.3));
            if (d > wb.sr - 0.3 + 1e-6) bad = true;
            if (last != null) { let da = Math.abs(p.a - last) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da; res.worstTurn = Math.max(res.worstTurn, da); }
            last = p.a;
          }
          if (bad) res.outNow++;
        }
      }
      return res;
    })()`);
    t.note('webs: ' + JSON.stringify(out));
    t.ok(out.spiders >= 8 && out.outBefore >= 1, 'webs with a spider, and some whose spoke ends outside the painted area (where the spider hid)', out);
    t.eq(out.outNow, 0, 'spiders that are ever nearer than 0.3 to the edge of their dab of the brush, or outside it');
    t.ok(out.worstTurn < 0.5, 'the most a spider turns in a twentieth of a second (half a turn at once was 3.14)', out.worstTurn);
  });

  // XA7 (Glinn, 26 Nov 2026): 79 lights, and their colour should change in one go
  area.quick('XA7: Layers: the open row of a kind starts with "All N": a colour, the reach, the brightness for all of them at once, as one undo step; while a slider moves only those lights are sent', async (t) => {
    const m = await clean(t); const k = m.grid.size;
    const ids = []; for (let i = 0; i < 6; i++) ids.push(t.handle('fx.add', { mapId: own, kind: 'light', preset: 'candle', x: (3 + i) * k, y: 4 * k, bright: 5, dim: 10 }).selected);
    const torch = t.handle('fx.add', { mapId: own, kind: 'light', preset: 'torch', x: 11 * k, y: 4 * k, bright: 20, dim: 40 }).selected;
    await t.settle();
    const F = (id) => t.store.map(own).fx.find((x) => x.id === id);
    const cols = () => ids.map((id) => F(id).color);
    const own0 = cols(); const torch0 = { ...F(torch) };
    // the command: the same change to each, one undo step; only the three kinds of change it knows
    const r = await t.cmd('fx.many', { mapId: own, cmd: 'fx.lightSet', ids, patch: { color: '#3366ff' } });
    t.ok(r.ok, 'the command', r);
    t.eq([...new Set(cols())], ['#3366ff'], 'all six have the colour');
    t.eq(F(torch).color, torch0.color, 'the torch was not asked and keeps its own');
    t.handle('history.undo', { mapId: own });
    t.eq(cols(), own0, 'one Undo: all six as they were');
    t.eq((await t.cmd('fx.many', { mapId: own, cmd: 'fx.remove', ids, patch: {} })).ok, false, 'anything but a change of looks is refused');
    t.eq(t.store.map(own).fx.length, 7, 'and nothing was removed');
    // while a slider moves: the small way (WE1), for a look and for a light's reach; not for what needs the whole state
    await t.sleep(400);
    const soft = (cmd, patch) => t.handle('fx.many', { mapId: own, cmd, ids, patch, coalesce: 'xa7', soft: true });
    t.eq([!!soft('fx.lightSet', { bright: 30 }).soft, !!soft('fx.update', { intensity: 0.6 }).soft, !!soft('fx.update', { hidden: true }).soft], [true, true, false], 'reach and brightness of all six go as small messages, hiding them goes whole');
    t.eq([[...new Set(ids.map((id) => F(id).bright))], [...new Set(ids.map((id) => F(id).dim))], [...new Set(ids.map((id) => F(id).intensity))], [...new Set(ids.map((id) => !!F(id).hidden))]], [[30], [60], [0.6], [true]], 'and each has what was set');
    t.handle('fx.many', { mapId: own, cmd: 'fx.update', ids, patch: { hidden: false } });
    await t.settle(); await t.sleep(400);
    // the panel
    await t.g(`Play.ui.lyFold = {}; Play.setTool('select'); Play.closePop(); Play.openPop('layers')`);
    await t.until(async () => (await t.count('#pop .layer-kind')) === 1, 3000, 'Layers with the candles as one row');
    t.eq(await t.count('#pop .layer-all'), 0, 'folded: no settings yet');
    await t.clickSel('#pop .layer-kind .layer-main');
    await t.until(async () => (await t.count('#pop .layer-all')) === 1, 3000, 'the row open: what they share');
    t.eq(await t.g(`[document.querySelector('#pop .layer-all-head').textContent, [...document.querySelectorAll('#pop .layer-all .ctl-label')].map((x) => x.textContent)]`), ['All 6', ['All 6', 'Colour', 'Reach', 'Brightness', 'Flicker']], 'All 6: Colour, Reach, Brightness, Flicker');
    await t.g(`document.querySelector('#pop .layer-all').scrollIntoView({ block: 'center' })`);
    await t.clickSel('#pop .layer-all .swatch[data-v="#5cff74"]');
    await t.until(() => [...new Set(cols())].join() === '#5cff74', 3000, 'a click on Hellfire green: all six green');
    t.ok(await t.g(`document.querySelector('#pop .layer-all .swatch[data-v="#5cff74"]').classList.contains('on')`), 'and the swatch is marked');
    await t.g(`(() => { const i = document.querySelector('#pop .layer-all input[aria-label="Reach"]'); i.value = 15; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await t.until(() => ids.every((id) => F(id).bright === 15 && F(id).dim === 30), 3000, 'the Reach slider: all six at 15 ft');
    await t.shot(t.gm(), 'layers-all-of-a-kind');
    t.eq([F(torch).bright, F(torch).color], [torch0.bright, torch0.color], 'the torch is left alone throughout');
    // one of them changed alone: the swatch no longer claims they are the same
    t.handle('fx.lightSet', { mapId: own, id: ids[0], color: '#ff8a2a' }); await t.settle();
    await t.until(() => t.g(`!document.querySelector('#pop .layer-all .swatch.on')`), 3000, 'they differ now: no swatch marked');
    await t.g(`Play.closePop()`);
  });
};
