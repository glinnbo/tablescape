// Automated smoke test. Runs only when TS_TEST_DIR is set:
//   TS_TEST_DIR=out electron .
// Drives the real UI with mouse and keyboard events, checks both windows,
// and saves screenshots + report.json. scripts/run-selftest.js grades it.
'use strict';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;

exports.run = async ({ app, store, state, handle, getWindows, library, settings }) => {
  const dir = path.resolve(process.env.TS_TEST_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const report = { console: [], errors: [], checks: {}, badText: [] };
  const C = report.checks;
  const hooked = new Set();
  const hook = (w, name) => {
    if (!w || hooked.has(w)) return;
    hooked.add(w);
    w.webContents.on('console-message', (e) => {
      const msg = e.message;
      const lvl = e.level;
      report.console.push(`[${name}] ${lvl}: ${msg}`);
    });
    w.webContents.on('render-process-gone', (e, d) => { if (!report.expectCrash) report.errors.push(`[${name}] renderer gone: ${d.reason}`); });
    w.webContents.on('did-fail-load', (e, code, desc) => report.errors.push(`[${name}] load failed: ${desc}`));
  };
  const shot = async (w, name) => {
    // windows on one virtual screen overlap; force a fresh frame before capturing
    w.webContents.invalidate();
    await sleep(250);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    // no "null", "undefined" or "NaN" written out anywhere visible
    const bad = await w.webContents.executeJavaScript(`(() => { const out = []; const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = it.nextNode())) { const t = n.textContent.trim(); const el = n.parentElement; if (/^(null|undefined)$|\\bundefined\\b|\\bNaN\\b/.test(t) && el && el.getClientRects().length) out.push(t.slice(0, 60) + ' @ ' + (el.className || el.tagName)); } return out; })()`).catch(() => []);
    if (bad.length) report.badText.push(`${name}: ${bad.join(' | ')}`);
  };
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const W = () => getWindows();
  // the sound window plays everything the table hears (sound-engine.js)
  const snd = () => js(W().sound, 'SoundEngine.debug()');
  const lib = (rel) => path.join(library.root, rel);

  try {
    let gm = W().gm;
    hook(gm, 'gm');
    for (let i = 0; i < 150; i++) {
      gm = W().gm;
      if (gm && !gm.webContents.isLoading() && await js(gm, 'window.__tsReady === true').catch(() => false)) break;
      await sleep(100);
    }
    await sleep(800);
    // the frame-rate watch is tested on its own (section 8k); on this slow test screen it would ask all the time
    await js(gm, `window.ts.settings({ fpsWatch: false })`);

    // ---------- input helpers ----------
    const key = async (keyCode, modifiers = []) => {
      gm.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode.length === 1) gm.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
      gm.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(150);
    };
    const mouse = async (type, x, y, button = 'left', extra = {}) => {
      gm.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount: 1, ...extra });
      await sleep(25);
    };
    const click = async (x, y, button = 'left', modifiers = []) => {
      await mouse('mouseMove', x, y, button, { modifiers });
      await mouse('mouseDown', x, y, button, { modifiers });
      await mouse('mouseUp', x, y, button, { modifiers });
      await sleep(150);
    };
    const dragPath = async (a, b, steps = 10, modifiers = []) => {
      await mouse('mouseMove', a.x, a.y, 'left', { modifiers });
      await mouse('mouseDown', a.x, a.y, 'left', { modifiers });
      // moves while the button is held must say so, or Chromium cancels the pointer
      for (let i = 1; i <= steps; i++) await mouse('mouseMove', a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, 'left', { modifiers: [...modifiers, 'leftButtonDown'] });
      await mouse('mouseUp', b.x, b.y, 'left', { modifiers });
      await sleep(350);
    };
    const rect = (sel) => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
    const clickSel = async (sel, button) => { const r = await rect(sel); if (!r) throw new Error(`not found: ${sel}`); await click(r.cx, r.cy, button); return r; };
    // click the first element matching sel whose text contains `text`
    const clickText = async (sel, text, button) => {
      const p = await js(gm, `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}) || (x.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!p) throw new Error(`not found: ${sel} "${text}"`);
      await click(p.x, p.y, button);
      return p;
    };
    // type into the spell search box and pick the first match with Enter
    const searchSpell = async (q) => {
      await js(gm, `(() => { const s = document.querySelector('#pop .spell-search'); s.value = ''; s.dispatchEvent(new Event('input')); s.focus(); })()`);
      await gm.webContents.insertText(q);
      await sleep(100);
      await key('Enter');
    };
    // map inches -> GM screen point
    const scr = (x, y) => js(gm, `Play.view().mapToScreen(${x}, ${y})`);
    const L = () => store.map(state.liveMapId);
    // the turn order as it stands: one name per turn (a group once)
    const initUnitsNames = () => { const I = state.init; if (!I) return []; const out = []; for (const e of I.entries) { const last = out[out.length - 1]; if (e.group && last && last.g === e.group) last.n.push(e.name); else out.push({ g: e.group, n: [e.name] }); } return out.map((u) => (u.n.length > 1 ? u.n.join('+') : u.n[0])); };
    const E = () => store.map(state.editMapId);

    // ---------- 1. start screen ----------
    const homeInfo = await js(gm, `({ screen: document.body.dataset.screen, cards: document.querySelectorAll('.camp:not(.camp-new)').length, hasContinue: !!document.querySelector('.continue') })`);
    C.home = homeInfo;
    await sleep(1200);
    // Alpha 1.0: the release on the start screen and in the title, first steps for a new table
    C.release = { tag: await js(gm, `(() => { const e = document.querySelector('.wordmark .release'); return e && e.textContent; })()`), title: gm.getTitle(),
      steps: await js(gm, `document.querySelectorAll('.first-steps .fs-step').length`), done: await js(gm, `document.querySelectorAll('.first-steps .fs-step.done').length`),
      about: await js(gm, `window.ts.app('about')`) };
    await shot(gm, '01-home');

    // open the demo campaign by clicking its card: its page first, then Prepare the maps
    await clickSel('.camp:not(.camp-new)');
    await sleep(1500);
    const pageScreen = state.screen;
    await shot(gm, '02a-campaign-page');
    await clickSel('.cp-prep');
    await sleep(1200);
    C.openedDemo = { page: pageScreen, screen: state.screen, campaign: store.cur && store.cur.meta.name, maps: store.allMapIds().length, chapters: store.cur && store.cur.meta.chapters.length };
    await shot(gm, '02-play-prep');

    // ---------- 2. send to table (T), check the table window ----------
    gm.webContents.focus();
    await key('T');
    for (let i = 0; i < 40 && !W().player; i++) await sleep(100);
    const player = W().player;
    hook(player, 'table');
    for (let i = 0; i < 60; i++) { if (await js(player, 'window.__table && window.__table.debug() && window.__table.debug().liveId').catch(() => null)) break; await sleep(100); }
    await sleep(2500);
    C.tableAfterSend = await js(player, 'window.__table.debug()');
    await sleep(1000);
    C.tableLater = await js(player, 'window.__table.debug()');
    C.soundLater = await snd();
    await shot(gm, '03-play-live');
    await shot(player, '04-table-live');
    const ppi = await js(gm, 'Play.view().ppi');
    const tablePx = (m, v = L().view) => ({ x: (v.x + m.x * v.zoom) * ppi, y: (v.y + m.y * v.zoom) * ppi });
    const probe = (layer, t) => js(player, `window.__table.probe(${JSON.stringify(layer)}, ${t.x}, ${t.y})`);

    // ---------- 3. fog: keyboard R, brush stroke, undo ----------
    gm.webContents.focus();
    const vp = await rect('#viewport');
    const live = L();
    const ops0 = live.fog.ops.length;
    await key('R');
    C.toolAfterR = await js(gm, 'document.body.dataset.tool');
    C.fogPopoverOpen = await js(gm, 'document.querySelector("#pop.on .pop-title") && document.querySelector("#pop.on .pop-title").textContent');
    await shot(gm, '05-fog-popover');
    const bx = vp.x + vp.w * 0.45; const by = vp.y + vp.h * 0.55;
    await mouse('mouseMove', bx, by);
    await mouse('mouseDown', bx, by);
    for (let i = 1; i <= 14; i++) await mouse('mouseMove', bx + i * 22, by - i * 6, 'left', { modifiers: ['leftButtonDown'] });
    await mouse('mouseUp', bx + 308, by - 84);
    await sleep(400);
    const brushOp = live.fog.ops[live.fog.ops.length - 1];
    C.uiBrush = { addedOps: live.fog.ops.length - ops0, points: brushOp && brushOp.pts ? brushOp.pts.length / 2 : 0 };
    C.tableFogAfterBrush = (await js(player, 'window.__table.debug()')).fogOps;
    await key('Z', ['control']);
    await sleep(300);
    C.uiUndo = { opsAfterUndo: L().fog.ops.length, expected: ops0 };

    // ---------- 4. radial menu: right-click, "Reveal here" ----------
    await key('Escape');
    await key('V');
    const rx = vp.x + vp.w * 0.62; const ry = vp.y + vp.h * 0.6;
    await click(rx, ry, 'right');
    await sleep(250);
    C.radial = await js(gm, `({ open: !!document.querySelector('#radial.on'), items: [...document.querySelectorAll('.radial-item span')].map((s) => s.textContent) })`);
    await shot(gm, '06-radial');
    const ops1 = L().fog.ops.length;
    await clickText('.radial-item', 'Reveal here');
    await sleep(300);
    C.radialReveal = { added: L().fog.ops.length - ops1, closed: !(await js(gm, '!!document.querySelector("#radial")')) };

    // ---------- 5. token drag + snap + card ----------
    const gob = L().layers.find((l) => l.role === 'token' && !l.hidden);
    const gob0 = { x: gob.x, y: gob.y };
    const tr = await rect(`.sv-token[data-id="${gob.id}"]`);
    await mouse('mouseMove', tr.cx, tr.cy);
    await mouse('mouseDown', tr.cx, tr.cy);
    for (let i = 1; i <= 8; i++) await mouse('mouseMove', tr.cx + i * 11, tr.cy + i * 7, 'left', { modifiers: ['leftButtonDown'] });
    await mouse('mouseUp', tr.cx + 88, tr.cy + 56);
    await sleep(400);
    const g2 = L().layers.find((l) => l.id === gob.id);
    const cs = L().grid.size;
    const centred = (v) => Math.abs((((v / cs) % 1) + 1) % 1 - 0.5) < 0.01;
    C.uiTokenDrag = { moved: r2(Math.hypot(g2.x - gob0.x, g2.y - gob0.y)), snapped: centred(g2.x) && centred(g2.y) };
    C.tokenCard = await js(gm, `!!document.querySelector('#token-card.on')`);
    await shot(gm, '07-token-card');
    await shot(player, '07b-table-same-moment');
    // hide it with H: the table must hide it, the GM still sees it
    await key('H');
    await sleep(400);
    const dbgH = await js(player, 'window.__table.debug()');
    C.hiddenToken = { tableVisible: dbgH.tokensVisible, tableTotal: dbgH.tokensTotal, gmTokens: await js(gm, 'document.querySelectorAll(".sv-token").length') };
    await key('H');
    // Delete + undo toast
    await key('Delete');
    await sleep(300);
    C.undoToast = await js(gm, `!!document.querySelector('.toast .toast-undo')`);
    await clickSel('.toast .toast-undo');
    await sleep(300);
    C.tokenRestored = !!L().layers.find((l) => l.id === gob.id);

    // ---------- 6. moving the map moves fog, tokens and effects with it ----------
    {
      const k = L().grid.size; // one printed square of the demo map, in map inches
      const S = { x: 2.5 * k, y: 5 * k }; // near the left edge of the revealed room
      const camS = await js(gm, 'Play.view().cam.s');
      const oldT = tablePx(S);
      const before = { view: { ...L().view }, bg: JSON.stringify(L().bg), ops: JSON.stringify(L().fog.ops), tok: { ...L().layers.find((l) => l.id === gob.id) },
        atOld: (await probe('fog', oldT))[3] };
      await key('M');
      const c0 = { x: vp.x + vp.w * 0.5, y: vp.y + vp.h * 0.5 };
      const d = 4 * k * ppi * camS; // four squares to the right on screen
      await dragPath(c0, { x: c0.x + d, y: c0.y + d / 2 }, 10);
      await sleep(500);
      const v = L().view;
      const tokNow = L().layers.find((l) => l.id === gob.id);
      C.mapMove = {
        dx: r2(v.x - before.view.x), dy: r2(v.y - before.view.y),
        bgSame: JSON.stringify(L().bg) === before.bg, fogOpsSame: JSON.stringify(L().fog.ops) === before.ops,
        tokenSameInMap: tokNow.x === before.tok.x && tokNow.y === before.tok.y,
        fogAtOldSpotBefore: before.atOld, fogAtOldSpotAfter: (await probe('fog', oldT))[3], fogAtNewSpot: (await probe('fog', tablePx(S)))[3],
        tableView: await js(player, `(() => { const s = document.querySelector('.tv-layer.shown .sv-map'); return s && s.style.transform; })()`),
      };
      await shot(gm, '08-map-moved');
      await shot(player, '08b-table-map-moved');
      await key('Z', ['control']);
      await sleep(300);
      C.mapMoveUndo = r2(L().view.x - before.view.x) === 0;
      await key('V');
    }

    // ---------- 7. spell areas ----------
    handle('fog.enabled', { enabled: false }); // so the screenshots show the effects on the table
    {
      await key('A');
      C.spellTool = { tool: await js(gm, 'document.body.dataset.tool'), pop: await js(gm, 'document.querySelector("#pop.on .pop-title") && document.querySelector("#pop.on .pop-title").textContent') };
      await clickText('#pop .spell-row', 'Fireball');
      await sleep(150);
      const k = L().grid.size;
      const n0 = L().spells.length;
      const at = await scr(14.3 * k, 9.8 * k); // close to the corner at (14, 10)
      await click(at.x, at.y);
      await sleep(600);
      const fb = L().spells[L().spells.length - 1];
      const onCorner = (v) => Math.abs(v / k - Math.round(v / k)) < 0.001;
      C.fireball = {
        added: L().spells.length - n0, name: fb && fb.name, shape: fb && fb.shape, size: fb && fb.size, mode: fb && fb.mode,
        snapped: !!fb && onCorner(fb.x) && onCorner(fb.y),
        cells: fb ? await js(gm, `(() => { const v = Play.view(); return v.spellGeom(v.map.spells.find((s) => s.id === ${JSON.stringify(fb.id)})).cells.length; })()`) : 0,
        card: await js(gm, `!!document.querySelector('#token-card.on .card-title')`),
      };
      await sleep(250);
      const dbg = await js(player, 'window.__table.debug()');
      C.tableFireball = { spells: dbg.fx && dbg.fx.spells, animating: dbg.fx && dbg.fx.animating, sfx: (await snd()).spells, pixel: fb ? await probe('spell', tablePx(fb)) : null };
      await shot(gm, '09-spell-fireball');
      await shot(player, '09b-table-fireball');

      // a cone, picked by typing in the search box and aimed with a real drag
      await searchSpell('burning');
      C.searchPick = await js(gm, 'Play.ui.spell.name');
      // (aim right of the open popover)
      const a = await scr(16.2 * k, 13 * k);
      const b = await scr(20.5 * k, 13 * k);
      await dragPath(a, b, 8);
      const cone = L().spells[L().spells.length - 1];
      C.cone = {
        name: cone.name, shape: cone.shape, angle: r2(cone.angle),
        cells: await js(gm, `(() => { const v = Play.view(); return v.spellGeom(v.map.spells.find((s) => s.id === ${JSON.stringify(cone.id)})).cells.length; })()`),
      };
      // Shift snaps the angle to 15° steps
      await searchSpell('lightning bolt');
      const a2 = await scr(17 * k, 2 * k);
      const b2 = await scr(17 * k + 5 * k * Math.cos(0.65), 2 * k + 5 * k * Math.sin(0.65));
      await dragPath(a2, b2, 8, ['shift']);
      const bolt = L().spells[L().spells.length - 1];
      C.shiftSnap = { name: bolt.name, angle: r2(bolt.angle), shape: bolt.shape, width: bolt.width };
      await shot(gm, '10-spells');
      await shot(player, '10b-table-spells');

      // an aura on a token follows the token
      await searchSpell('spirit guardians');
      const tok = { ...L().layers.find((l) => l.id === gob.id) }; // a copy: the store object moves with the token
      const ts0 = await scr(tok.x, tok.y);
      await click(ts0.x, ts0.y);
      await sleep(300);
      const aura = L().spells[L().spells.length - 1];
      await key('V');
      const tr2 = await rect(`.sv-token[data-id="${gob.id}"]`);
      await dragPath({ x: tr2.cx, y: tr2.cy }, { x: tr2.cx - 60, y: tr2.cy + 40 }, 6);
      const tokAfter = L().layers.find((l) => l.id === gob.id);
      const tplC = await js(gm, `(() => { const v = Play.view(); const t = v.spellGeom(v.map.spells.find((s) => s.id === ${JSON.stringify(aura.id)})).tpl; return { x: t.cx, y: t.cy }; })()`);
      C.aura = { attachTo: aura.attachTo === gob.id, mode: aura.mode, tokenMoved: r2(Math.hypot(tokAfter.x - tok.x, tokAfter.y - tok.y)), follows: Math.hypot(tplC.x - tokAfter.x, tplC.y - tokAfter.y) < 0.01 };

      // right-click inside a spell area: the spell's radial menu
      const inAura = await scr(tokAfter.x + 1.6 * k, tokAfter.y);
      await click(inAura.x, inAura.y, 'right');
      await sleep(250);
      C.spellRadial = await js(gm, `[...document.querySelectorAll('#radial.on .radial-item span')].map((s) => s.textContent)`);
      await shot(gm, '11-spell-radial');
      await clickText('.radial-item', 'Round +1');
      await sleep(300);
      C.rounds = L().spells.find((s) => s.id === aura.id).rounds;
      await sleep(200);
      C.roundBadge = await js(player, `document.querySelectorAll('.tv-layer.shown .sv-spell-label b').length`);

      // radial "Cast spell" > Fireball on an empty spot
      const ids1 = new Set(L().spells.map((x) => x.id)); // burst areas may fade meanwhile: count new ids
      const empty = await scr(26 * k, 15 * k);
      await click(empty.x, empty.y, 'right');
      await sleep(200);
      await clickText('.radial-item', 'Cast spell');
      await sleep(200);
      C.castRing = await js(gm, `[...document.querySelectorAll('#radial.on .radial-item span')].map((s) => s.textContent)`);
      await shot(gm, '12-cast-ring');
      await clickText('.radial-item', 'Fireball');
      await sleep(300);
      C.radialCast = L().spells.filter((x) => !ids1.has(x.id)).length;

      // burst areas fade on their own
      await js(gm, 'window.ts.settings({ burstSeconds: 2 })');
      await sleep(100);
      const idsB = new Set(L().spells.map((x) => x.id));
      await key('A');
      await searchSpell('shatter');
      const sh = await scr(20 * k, 4 * k);
      await click(sh.x, sh.y);
      await sleep(300);
      const fresh = L().spells.filter((x) => !idsB.has(x.id));
      const shatter = fresh[0] || {};
      await sleep(3200);
      C.expire = { name: shatter.name, castAdded: fresh.length, gone: !L().spells.some((s) => s.id === shatter.id), auraStays: L().spells.some((s) => s.id === aura.id) };
      await js(gm, 'window.ts.settings({ burstSeconds: 8 })');
      const dsx = await snd();
      C.sfx = { played: dsx.spells, ok: dsx.spellsOk };

      // clear all
      await key('Escape');
      await key('A');
      await clickText('#pop .btn', 'Clear all spell areas');
      await sleep(300);
      C.cleared = { left: L().spells.length, toast: await js(gm, `!!document.querySelector('.toast .toast-undo')`) };
      await key('Escape');
    }

    // ---------- 8. effects: atmosphere, paint, light, weather ----------
    {
      const k = L().grid.size;
      await key('E');
      C.fxTool = { tool: await js(gm, 'document.body.dataset.tool'), pop: await js(gm, 'document.querySelector("#pop.on .pop-title") && document.querySelector("#pop.on .pop-title").textContent') };
      const f0 = L().fx.length;
      const torchAt = await scr(12 * k, 3 * k);
      await click(torchAt.x, torchAt.y); // default preset: torch
      await sleep(300);
      const torch = { ...L().fx[L().fx.length - 1] };
      C.placeTorch = { added: L().fx.length - f0, preset: torch.preset, light: torch.bright > 0, handles: await js(gm, 'document.querySelectorAll(".sv-handle").length'), fx: L().fx.length };
      // drag the torch's handle
      const hr = await rect(`.sv-handle[data-id="${torch.id}"]`);
      await dragPath({ x: hr.cx, y: hr.cy }, { x: hr.cx + 40, y: hr.cy + 20 }, 5);
      const torchMoved = L().fx.find((f) => f.id === torch.id);
      C.moveHandle = r2(Math.hypot(torchMoved.x - torch.x, torchMoved.y - torch.y));
      // paint mist
      await clickText('#pop .seg-btn', 'Paint');
      await clickText('#pop .tile', 'Mist');
      const p1 = await scr(14 * k, 9 * k); const p2 = await scr(21 * k, 10 * k);
      await dragPath(p1, p2, 12);
      const mist = L().fx.find((f) => f.kind === 'region' && f.preset === 'mist');
      C.paint = { region: !!mist, strokes: mist ? mist.strokes.length : 0, points: mist ? mist.strokes[0].pts.length / 2 : 0 };
      // darkness + a light carried by a token
      handle('light.update', { darkness: 0.7 });
      await clickText('#pop .seg-btn', 'Light');
      await clickText('#pop .seg-btn', 'Light sources');
      await clickText('#pop .tile', 'Torch');
      const tok = L().layers.find((l) => l.id === gob.id);
      const tp = await scr(tok.x, tok.y);
      await click(tp.x, tp.y);
      await sleep(400);
      const carried = L().fx.find((f) => f.kind === 'light' && f.attachTo === gob.id);
      C.carriedLight = { ok: !!carried, darkness: L().light.darkness };
      // weather
      await clickText('#pop .seg-btn', 'Weather');
      await clickText('#pop .tile', 'Rain');
      await sleep(900);
      C.weather = L().weather.layers.map((l) => l.type).join('+');
      const dbg = await js(player, 'window.__table.debug()');
      const near = await probe('light', tablePx(tok));
      const far = await probe('light', tablePx({ x: 3 * k, y: 18 * k }));
      C.tableFx = {
        stats: dbg.fx, rainCoverage: await js(player, `window.__table.coverage('weather')`), mistCoverage: await js(player, `window.__table.coverage('atmo')`),
        lightNear: near && near[3], lightFar: far && far[3],
      };
      await shot(gm, '13-effects');
      await shot(player, '13b-table-effects');
      // effects stay under the fog: the atmosphere canvas comes before the fog canvas
      C.layerOrder = await js(player, `(() => { const w = document.querySelector('.tv-layer.shown .sv-world'); const k = [...w.children].map((e) => e.className.split(' ').pop()); return k; })()`);
      await key('Escape');
      await key('V');
    }
    handle('fog.enabled', { enabled: true });


    // ---------- 8b. 0.4: turning, darkness, effect options, sounds ----------
    handle('fog.enabled', { enabled: false });
    {
      const k = L().grid.size;
      // Ctrl + wheel turns the spell area before it is placed
      await key('A');
      await searchSpell('burning');
      const at = await scr(20 * k, 12 * k);
      await mouse('mouseMove', at.x, at.y);
      await sleep(100);
      const angle0 = await js(gm, 'Play.ui.spellAngle');
      // on a busy machine the preview may not follow the mouse yet: wheel again until it turned
      for (let i = 0; i < 4; i++) {
        gm.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(at.x), y: Math.round(at.y), deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
        await sleep(250);
        if (await js(gm, 'Play.ui.spellAngle') !== angle0) break;
        await mouse('mouseMove', at.x + 2, at.y);
        await mouse('mouseMove', at.x, at.y);
      }
      C.turnPreview = { before: angle0, angle: await js(gm, 'Play.ui.spellAngle'), readout: await js(gm, `(() => { const r = document.querySelector('.aim-readout.on'); return r && r.textContent; })()`) };
      await shot(gm, '13c-turn-preview');
      await click(at.x, at.y);
      await sleep(300);
      const cone = { ...L().spells[L().spells.length - 1] };
      C.turnedCone = { name: cone.name, angle: cone.angle };
      // a placed area turns too (select tool, Ctrl + wheel over it)
      await key('V');
      const inCone = await scr(cone.x + 1.6 * k * Math.cos(cone.angle * Math.PI / 180), cone.y + 1.6 * k * Math.sin(cone.angle * Math.PI / 180));
      await mouse('mouseMove', inCone.x, inCone.y);
      gm.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(inCone.x), y: Math.round(inCone.y), deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
      await sleep(400);
      C.turnPlaced = { before: cone.angle, after: L().spells.find((x) => x.id === cone.id).angle };
      // mute it and cast it again: no sound
      const played0 = (await snd()).spells.length;
      handle('spell.update', { id: cone.id, muted: true, mode: 'stay' });
      handle('spell.burst', { id: cone.id });
      await sleep(600);
      C.muted = { played: (await snd()).spells.length - played0 };
      // a look with its own sound file from the library
      await js(gm, `window.ts.settings({ sfxFor: { skin: 'cold', path: ${JSON.stringify(lib('Audio/Ambience/Cave drone.ogg'))} } })`);
      await sleep(200);
      const coldAt = await scr(26 * k, 4 * k);
      await key('A');
      await searchSpell('cone of cold');
      await click(coldAt.x, coldAt.y);
      await sleep(1200);
      C.customSound = { src: (await snd()).src.slice(-1)[0] };
      await js(gm, `window.ts.settings({ sfxFor: { skin: 'cold', path: null } })`);
      // spell colour
      await js(gm, `Play.setSpell({ color: '#5cff74' })`);
      await searchSpell('fireball');
      const fbAt = await scr(8 * k, 15 * k);
      await click(fbAt.x, fbAt.y);
      await sleep(300);
      C.spellColor = L().spells[L().spells.length - 1].color;
      await js(gm, `Play.setSpell({ color: null })`);
      await key('Escape');

      // darkness up to 100%, a party light, lit areas remembered
      handle('light.update', { darkness: 1, memory: true });
      await key('E');
      await clickText('#pop .seg-btn', 'Light');
      await clickText('#pop .seg-btn', 'Light sources');
      C.lightTiles = await js(gm, `[...document.querySelectorAll('#pop .light-card .tile')].map((t) => t.textContent.trim())`);
      await key('Escape');
      // 1.4.2: the party comes from Play → Party (armed by the button, put down with a click), with a lantern
      await key('U');
      await sleep(250);
      await clickText('#pop .btn', 'Put the party on the map');
      const pl = await scr(14 * k, 5 * k); // right of the open popover
      await mouse('mouseMove', pl.x, pl.y);
      await click(pl.x, pl.y);
      await sleep(400);
      await clickText('#pop .party-pop .tile', 'Lantern');
      await sleep(300);
      const party = { ...L().fx.find((f) => f.preset === 'party') };
      C.party = { ok: !!party.id, seen: L().light.seen.length };
      await key('V');
      await sleep(200);
      C.partyHandleInSelect = await js(gm, `document.querySelectorAll('.sv-handle.party').length`);
      const hr = await rect('.sv-handle.party');
      await dragPath({ x: hr.cx, y: hr.cy }, { x: hr.cx + 600, y: hr.cy + 35 }, 16);
      await sleep(400);
      const moved = L().fx.find((f) => f.id === party.id);
      C.partyMoved = { dist: r2(Math.hypot(moved.x - party.x, moved.y - party.y)), seen: L().light.seen.length };
      const far = await probe('light', tablePx({ x: 3 * k, y: 18 * k }));
      // a spot the light passed over but no longer reaches: remembered, not lit
      const oldSpot = await probe('light', tablePx({ x: party.x, y: party.y + 10 * k }));
      const newSpot = await probe('light', tablePx({ x: moved.x, y: moved.y }));
      C.dark100 = { far: far[3], remembered: oldSpot[3], lit: newSpot[3] };
      await shot(player, '13d-table-pitch-black');
      // tint
      handle('light.update', { tint: '#0a1634' });
      await sleep(200);
      C.tint = (await probe('light', tablePx({ x: 3 * k, y: 18 * k })));
      handle('light.update', { darkness: 0, memory: false });
      // (1.4: a party without walls reveals a circle once fog is on, so it leaves this map again)
      handle('fx.remove', { id: party.id });

      // effect options: colour, amount, speed for the next torch and for a selected one
      await key('E');
      await clickText('#pop .seg-btn', 'Place');
      await clickText('#pop .tile', 'Torch');
      await clickText('#pop .look .swatch', 'Hellfire green');
      const tAt = await scr(10 * k, 10 * k);
      await click(tAt.x, tAt.y);
      await sleep(300);
      const green = { ...L().fx[L().fx.length - 1] };
      C.greenTorch = { color: green.color, preset: green.preset, sat: green.sat };
      const gh = await rect(`.sv-handle[data-id="${green.id}"]`);
      await click(gh.cx, gh.cy);
      await sleep(250);
      C.lookSelected = await js(gm, `(() => { const b = document.querySelector('#pop .look-head b'); return b && b.textContent; })()`);
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop .look .ctl-slider')].find((x) => x.textContent.includes('Amount')).querySelector('input'); s.value = 2.5; s.dispatchEvent(new Event('input')); })()`);
      await sleep(400);
      C.lookEdit = L().fx.find((f) => f.id === green.id).density;
      await sleep(300);
      const px = await probe('atmo', tablePx({ x: green.x + 0.9, y: green.y })); // in the glow, beside the white-hot core
      C.greenPixel = px;
      // Alpha 1.0: its colour tints the map around it, in daylight too
      const gdbg = await js(player, 'window.__table.debug()');
      C.greenGlow = { px: await probe('glow', tablePx({ x: green.x + 1.5, y: green.y + 0.5 })), glows: gdbg.fx.glows, darkness: L().light.darkness,
        slider: await js(gm, `[...document.querySelectorAll('#pop .look .ctl-slider')].some((x) => x.textContent.includes('Colour of its light'))`) };
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop .look .ctl-slider')].find((x) => x.textContent.includes('Colour of its light')).querySelector('input'); s.value = 1; s.dispatchEvent(new Event('input')); })()`);
      await sleep(500);
      C.greenGlow.satAfter = L().fx.find((f) => f.id === green.id).sat;
      await shot(gm, '13e-effect-options');
      await shot(player, '13f-table-green-torch');
      await key('Escape');
      await key('Escape');
      await key('V');
    }

    // ---------- 8c. 0.4: library and assets ----------
    {
      const k = L().grid.size;
      await key('L');
      await sleep(1200);
      C.libNav = await js(gm, `[...document.querySelectorAll('#drawer .lib-nav-btn')].map((b) => b.textContent.replace(/\\d+$/, '').trim())`);
      C.libFits = await js(gm, `(() => { const b = [...document.querySelectorAll('#drawer .lib-nav-btn')].find((x) => x.textContent.includes('Fits')); return b ? Number(b.querySelector('b').textContent) : 0; })()`);
      await shot(gm, '14a-library-overview');
      // maps: day/night variants stacked; switch this map to another variant
      await clickText('#drawer .lib-nav-btn', 'Maps');
      await sleep(700);
      C.libStack = await js(gm, `[...document.querySelectorAll('#drawer .lt-maps')].map((c) => [...c.querySelectorAll('.lt-var')].map((b) => b.textContent))`);
      await shot(gm, '14b-library-maps');
      const bg0 = { ...L().bg };
      await clickText('#drawer .lt-maps.is-current .lt-var', 'Base');
      await sleep(900);
      C.variantSwap = { before: bg0.name, after: L().bg.name, sameScale: L().bg.scale === bg0.scale, sameX: L().bg.x === bg0.x };
      await key('Z', ['control']);
      await sleep(400);
      // tokens: favourite one, put one aside for tonight
      await clickText('#drawer .lib-nav-btn', 'Tokens');
      await sleep(500);
      const ogre = await js(gm, `(() => { const t = [...document.querySelectorAll('#drawer .lt-tokens')].find((x) => x.textContent.includes('Ogre')); const s = t.querySelector('.lib-star'); const r = s.getBoundingClientRect(); const r2 = t.getBoundingClientRect(); return { sx: r.x + r.width / 2, sy: r.y + r.height / 2, x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 }; })()`);
      await mouse('mouseMove', ogre.x, ogre.y);
      await sleep(100);
      await click(ogre.sx, ogre.sy);
      await sleep(400);
      C.libFav = await js(gm, `(() => { const b = [...document.querySelectorAll('#drawer .lib-nav-btn')].find((x) => x.textContent.includes('Favourites')); return Number(b.querySelector('b').textContent); })()`);
      await click(ogre.x, ogre.y, 'right');
      await sleep(200);
      await clickText('#menu.on .menu-item', 'Add to Tonight');
      await sleep(400);
      C.tray = { campaign: (store.cur.meta.tray || []).length, slots: await js(gm, `document.querySelectorAll('#drawer .tray-slot:not(.add)').length`) };
      // sounds: a list with a duration
      await clickText('#drawer .lib-nav-btn', 'Sounds');
      await sleep(900);
      // (4.11: Sounds opens on its folders: everything inside at once)
      await js(gm, `(() => { const b = document.querySelector('#drawer .lib-deep'); if (b && !b.classList.contains('on')) b.click(); return 1; })()`);
      await sleep(500);
      C.libSounds = await js(gm, `[...document.querySelectorAll('#drawer .lt-sounds')].map((r) => r.querySelector('.lt-dur').textContent)`);
      // full screen
      await key('Escape');
      await key('L', ['shift']);
      await sleep(600);
      C.libFull = await js(gm, `!!document.querySelector('#drawer.on.full')`);
      await clickText('#drawer .lib-nav-btn', 'Assets');
      await sleep(1500);
      C.libAssetFolders = await js(gm, `[...document.querySelectorAll('#drawer .lf-card')].map((c) => c.getAttribute('data-key'))`); // (4.11: its folders as cards)
      await js(gm, `(() => { const b = document.querySelector('#drawer .lib-deep'); if (b && !b.classList.contains('on')) b.click(); return 1; })()`);
      await sleep(800);
      C.libAssets = await js(gm, `document.querySelectorAll('#drawer .lt-assets').length`);
      await shot(gm, '14c-library-full-assets');
      // assets: pick a brush, stamp, scatter, turn
      await clickText('#drawer .lt-assets', 'Oak tree');
      await sleep(600);
      C.assetTool = { tool: await js(gm, 'document.body.dataset.tool'), brush: await js(gm, 'Play.ui.brush && Play.ui.brush.name'), cells: await js(gm, 'Play.ui.assetCells'), drawerClosed: !(await js(gm, `!!document.querySelector('#drawer.on')`)) };
      const n0 = L().layers.filter((l) => l.role === 'asset').length;
      const sAt = await scr(28 * k, 6 * k);
      await click(sAt.x, sAt.y);
      await sleep(300);
      const oak = { ...L().layers.filter((l) => l.role === 'asset').slice(-1)[0] };
      C.stamp = { added: L().layers.filter((l) => l.role === 'asset').length - n0, wCells: oak.w ? r2(oak.w / k) : 0 };
      await clickText('#pop .seg-btn', 'Scatter');
      await js(gm, `Play.ui.scatterGap = 0.6`);
      const s1 = await scr(14 * k, 15 * k); const s2 = await scr(24 * k, 16 * k);
      const n1 = L().layers.filter((l) => l.role === 'asset').length;
      await dragPath(s1, s2, 16);
      C.scatter = L().layers.filter((l) => l.role === 'asset').length - n1;
      await clickText('#pop .seg-btn', 'Stamp');
      // select the stamped oak and turn it with Ctrl + wheel
      const oakR = await rect(`.sv-asset[data-id="${oak.id}"]`);
      await click(oakR.cx, oakR.cy);
      await sleep(200);
      C.assetCard = await js(gm, `!!document.querySelector('#token-card.on .card-title')`);
      gm.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(oakR.cx), y: Math.round(oakR.cy), deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
      await sleep(400);
      C.assetTurn = Math.abs(L().layers.find((l) => l.id === oak.id).rotation);
      await shot(gm, '14d-assets');
      await sleep(300);
      const dbgA = await js(player, 'window.__table.debug()');
      C.tableAssets = dbgA.assets;
      C.assetUnderTokens = await js(player, `(() => { const w = document.querySelector('.tv-layer.shown .sv-world'); const kids = [...w.children]; const a = kids.findIndex((e) => e.querySelector && e.querySelector('.sv-assets')); const t = kids.findIndex((e) => e.querySelector && e.querySelector('.sv-tokens')); return a >= 0 && t > a; })()`);
      // in the select tool assets don't get in the way of clicks
      await key('V');
      C.assetLocked = await js(gm, `(() => { const e = document.querySelector('.sv-asset'); return getComputedStyle(e).pointerEvents; })()`);
      await shot(player, '14e-table-assets');
      // radial "Tonight" ring drops the ogre where you right-click
      const tAt2 = await scr(30 * k, 15 * k);
      const tok0 = L().layers.filter((l) => l.role === 'token').length;
      await click(tAt2.x, tAt2.y, 'right');
      await sleep(250);
      await clickText('.radial-item', 'Tonight');
      await sleep(250);
      C.tonightRing = await js(gm, `[...document.querySelectorAll('#radial.on .radial-item span')].map((s) => s.textContent)`);
      await clickText('.radial-item', 'Ogre');
      await sleep(400);
      C.tonightPlaced = L().layers.filter((l) => l.role === 'token').length - tok0;
      await key('Escape');
    }
    handle('fog.enabled', { enabled: true });

    // ---------- 8d. 0.5: rail groups, tokens, point, draw, mark, rounds, timers, asset options ----------
    handle('fog.enabled', { enabled: false });
    {
      const k = L().grid.size;
      const cell = (cx, cy) => scr((cx + 0.5) * k, (cy + 0.5) * k);
      const dbg = () => js(player, 'window.__table.debug()');
      await key('Escape');
      await key('V');
      await sleep(200);
      // the rail in three groups; Build folds while this map is on the table
      C.railGroups = await js(gm, `[...document.querySelectorAll('#rail .rail-group')].map((g) => ({ group: g.dataset.group, folded: g.classList.contains('folded'), visible: [...g.querySelectorAll('.rail-btn')].filter((b) => b.offsetParent).map((b) => b.dataset.id) }))`);
      await shot(gm, '15-rail-groups');

      // Tokens: pick the goblin, click three times: numbered copies
      await key('N');
      await sleep(400);
      C.tokenTool = { tool: await js(gm, 'document.body.dataset.tool'), pop: await js(gm, 'document.querySelector("#pop.on .pop-title") && document.querySelector("#pop.on .pop-title").textContent') };
      // 4.7: the panel shows the party and the Ready list; List … opens every token in a window: a click picks it up
      await clickText('#pop .btn', 'List');
      await sleep(900);
      C.tokenList = await js(gm, `(() => { const p = document.querySelector('.fp[data-id="toklist"]'); return p ? [...p.querySelectorAll('.pl-it')].map((x) => x.getAttribute('aria-label')) : null; })()`);
      await clickText('.fp[data-id="toklist"] .pl-it', 'Goblin');
      await sleep(200);
      await js(gm, `Play.Floats.hide('toklist')`);
      await sleep(200);
      const t0 = L().layers.filter((l) => l.role === 'token').length;
      for (const [cx, cy] of [[22, 13], [23, 13], [24, 13]]) { const p = await cell(cx, cy); await click(p.x, p.y); await sleep(250); }
      const gobs = L().layers.filter((l) => l.role === 'token' && /Goblin/.test(l.name));
      C.tokenDrop = { added: L().layers.filter((l) => l.role === 'token').length - t0, numbers: gobs.map((l) => l.n).sort((a, b) => a - b), brush: await js(gm, 'Play.ui.tok.brush && Play.ui.tok.brush.name') };
      // a large one, placed hidden
      await clickText('#pop .seg-sizes .seg-btn', 'L');
      await clickText('#pop .ctl-toggle', 'Place hidden');
      const big0 = await cell(27, 16);
      await click(big0.x, big0.y);
      await sleep(300);
      const big = { ...L().layers.filter((l) => l.role === 'token').slice(-1)[0] };
      const onCorner = (v) => Math.abs(v / k - Math.round(v / k)) < 0.001;
      C.tokenLarge = { size: big.size, hidden: big.hidden, corner: onCorner(big.x) && onCorner(big.y), card: await js(gm, `(() => { const c = document.querySelector('#token-card.on .card-size'); return c && c.textContent; })()`) };
      await clickText('#pop .seg-sizes .seg-btn', 'M');
      await clickText('#pop .ctl-toggle', 'Place hidden');
      await sleep(300);
      C.tableNumbers = (await dbg()).tokenNumbers;
      await shot(gm, '15b-tokens');
      await shot(player, '15c-table-tokens');

      // Point: spotlight follows the mouse, Esc turns it off; P again switches to the ruler
      await key('P');
      await sleep(200);
      C.pointTool = await js(gm, 'document.body.dataset.tool');
      await clickText('#pop .tile', 'Spotlight');
      const sp = await cell(18, 8);
      await mouse('mouseMove', sp.x, sp.y);
      await sleep(80);
      await mouse('mouseMove', sp.x + 12, sp.y + 4);
      await sleep(500);
      C.spot = (await dbg()).spot;
      await shot(player, '15d-table-spotlight');
      await key('Escape');
      await sleep(400);
      C.spotOff = (await dbg()).spot;
      await key('P');
      C.cycle = await js(gm, 'Play.ui.point.mode');
      await dragPath(await cell(10, 12), await cell(16, 15), 10);
      await sleep(150);
      C.measure = { table: (await dbg()).measure, rule: await js(gm, 'Play.ui.point.rule') };
      await shot(player, '15e-table-ruler');

      // Draw: chalk (fades), pen (stays), text, eraser
      await key('D');
      await sleep(250);
      C.drawTool = { tool: await js(gm, 'document.body.dataset.tool'), mode: await js(gm, 'Play.ui.draw.mode') };
      if (C.drawTool.mode !== 'chalk') await clickText('#pop .tile', 'Chalk');
      await dragPath(await cell(12, 6), await cell(20, 7), 12);
      const chalkAt = Date.now();
      C.chalk = { table: (await dbg()).chalk, inMap: L().draw.length };
      await shot(player, '15f-table-chalk');
      await clickText('#pop .tile', 'Pen');
      await clickText('#pop .swatch', 'Red');
      await dragPath(await cell(12, 9), await cell(20, 10), 12);
      const pen = L().draw.find((d) => d.kind === 'pen');
      C.pen = { points: pen ? pen.pts.length / 2 : 0, color: pen && pen.color, table: (await dbg()).pens };
      await clickText('#pop .tile', 'Text');
      await clickText('#pop .swatch', 'White chalk');
      const tx = await cell(15, 4);
      await click(tx.x, tx.y);
      await sleep(300);
      gm.webContents.focus();
      await gm.webContents.insertText('The old well');
      await key('Enter');
      await sleep(400);
      C.text = { map: (L().draw.find((d) => d.kind === 'text') || {}).text, table: (await dbg()).texts };
      await shot(gm, '15g-draw');
      await shot(player, '15h-table-draw');
      await clickText('#pop .tile', 'Erase');
      await dragPath(await cell(16, 7.6), await cell(16.3, 11), 10);
      C.erase = { pens: L().draw.filter((d) => d.kind === 'pen').length, texts: L().draw.filter((d) => d.kind === 'text').length };
      await key('Z', ['control']);
      await sleep(300);
      C.eraseUndo = L().draw.filter((d) => d.kind === 'pen').length;

      // Mark: a pin, a counter that counts down with the rounds (Toolbox, X), a note only the GM sees (Build → Notes, J)
      await key('X');
      await sleep(250);
      if (await js(gm, 'Play.ui.mark.mode') !== 'marker') await clickText('#pop .seg-btn', 'Marker');
      await clickText('#pop .seg-btn', 'Pin');
      const pin = await cell(21, 4);
      await click(pin.x, pin.y);
      await sleep(250);
      await clickText('#pop .seg-btn', 'Counter');
      await sleep(150);
      // 2.2: "Moves on Next round" is off for a new counter; ticked, Count down and Count up light up when clicked
      const ctrOpts = { off: !(await js(gm, `document.querySelector('#pop .ctl-toggle input').checked`)), segs: await js(gm, `[...document.querySelectorAll('#pop .seg-btn')].map((b) => b.textContent.trim())`) };
      await js(gm, `document.querySelector('#pop .ctl-toggle input').click()`);
      await sleep(200);
      await clickText('#pop .seg-btn', 'Count up');
      await sleep(150);
      ctrOpts.up = await js(gm, `[...document.querySelectorAll('#pop .seg-btn.on')].map((b) => b.textContent.trim())`);
      await clickText('#pop .seg-btn', 'Count down');
      await sleep(150);
      ctrOpts.down = await js(gm, `[...document.querySelectorAll('#pop .seg-btn.on')].map((b) => b.textContent.trim())`);
      C.counterOpts = ctrOpts;
      await js(gm, `Object.assign(Play.ui.mark, { label: 'Ritual', value: 3, auto: 'down' })`);
      const ctr = await cell(24, 6);
      await click(ctr.x, ctr.y);
      await sleep(250);
      await key('Escape'); await key('J');
      await sleep(250);
      C.notesTool = { tool: await js(gm, 'Play.ui.tool'), inBuild: await js(gm, `!!document.querySelector('.g-build .rail-btn[data-id="notes"]')`), markInRail: await js(gm, `!!document.querySelector('#rail .rail-btn[data-id="mark"]')`),
        inToolbox: null };
      const note = await cell(27, 7);
      await click(note.x, note.y);
      await sleep(300);
      gm.webContents.focus();
      await gm.webContents.insertText('Trap: DC 14 Perception');
      await key('Enter');
      await sleep(400);
      C.notesTool.list = await js(gm, `[...document.querySelectorAll('#pop .note-row')].map((r) => r.textContent.trim())`);
      await key('Escape'); // closes the popover
      await key('Escape'); // and the selection
      await key('V');
      const plus = await rect('.sv-mark.kind-counter .sv-counter-btn[data-d="1"]');
      await click(plus.cx, plus.cy);
      await sleep(300);
      const dm = await dbg();
      C.marks = { kinds: L().marks.map((m) => m.kind), counter: (L().marks.find((m) => m.kind === 'counter') || {}).value, tableMarks: dm.marks, tableNotes: dm.notes, gmNotes: await js(gm, `document.querySelectorAll('.sv-note').length`), tableCounters: dm.counters };
      await shot(gm, '15i-marks');

      // Rounds: a spell area that lasts 2 rounds ends by itself; the counter counts down
      await key('A');
      await searchSpell('fireball');
      await js(gm, `Play.setSpell({ duration: 2, mode: 'stay' })`);
      const fb = await cell(8, 15);
      await click(fb.x, fb.y);
      await sleep(300);
      const sgx = { ...L().spells[L().spells.length - 1] };
      await js(gm, `Play.setSpell({ duration: null, mode: 'burst' })`);
      await key('Escape');
      await key('V');
      C.noCountRounds = !(await js(gm, `[...document.querySelectorAll('#table-ctl button')].some((b) => /Count rounds/.test(b.textContent))`)); // 2.2: Enter starts counting
      gm.webContents.focus();
      await key('Enter');
      // wait until the counter runs (and the row under the preview has been rebuilt), then Enter twice
      const waitFor = async (fn, ms = 2500) => { for (let t = 0; t < ms && !(await fn()); t += 100) await sleep(100); };
      await waitFor(async () => L().round.n === 1 && await js(gm, `!!document.querySelector('.hud-round:not(.off)')`));
      const r1 = L().round.n;
      gm.webContents.focus();
      await key('Enter');
      await waitFor(() => L().round.n === 2);
      const afterOne = { rounds: (L().spells.find((x) => x.id === sgx.id) || {}).rounds, counter: L().marks.find((m) => m.kind === 'counter').value };
      await key('Enter');
      await waitFor(() => L().round.n === 3);
      await sleep(300);
      C.roundsNext = { start: r1, n: L().round.n, duration: sgx.duration, afterOne, gone: !L().spells.some((x) => x.id === sgx.id), counter: L().marks.find((m) => m.kind === 'counter').value, toast: await js(gm, `[...document.querySelectorAll('.toast span')].map((t) => t.textContent).join(' | ')`) };
      C.tableRound = (await dbg()).round;
      C.hudRound = await js(gm, `(() => { const r = document.querySelector('.hud-round b'); return r && r.textContent; })()`);
      await shot(gm, '15j-rounds');
      await shot(player, '15k-table-round');
      C.chalkGone = { after: Date.now() - chalkAt, table: (await dbg()).chalk };

      // Countdown: a dramatic one, then a normal one
      await key('Q');
      await sleep(250);
      await clickText('#pop .tb-tile', 'Countdown');
      await sleep(300);
      // the countdown opens as its own floating panel; the toolbox closes
      C.floatTimer = await js(gm, `({ panel: !!document.querySelector('.fp[data-id="timer"]'), pop: !!document.querySelector('#pop.on'), title: (document.querySelector('.fp[data-id="timer"] .fp-title') || {}).textContent })`);
      await js(gm, `Object.assign(Play.ui.timer, { mode: 'dramatic', seconds: 5, label: 'The ceiling gives way', sound: true })`);
      await clickText('.fp[data-id="timer"] .btn.primary', 'Start');
      await sleep(3300);
      C.timerMid = (await dbg()).timer;
      C.timerHud = await js(gm, `(() => { const r = document.querySelector('.hud-timer .hud-time'); return r && r.textContent; })()`);
      await shot(player, '15l-table-dramatic-timer');
      await shot(gm, '15m-timer-gm');
      await sleep(2600);
      C.timerEnd = (await dbg()).timer;
      await shot(player, '15n-table-timer-zero');
      await clickSel('.hud-timer .icon-btn:last-child');
      await sleep(300);
      C.timerStopped = { state: state.timer, table: (await dbg()).timer.on };
      handle('timer.start', { mode: 'normal', seconds: 12, label: 'Guards return' });
      await sleep(900);
      C.timerNormal = (await dbg()).timer;
      await shot(player, '15o-table-normal-timer');
      handle('timer.pause');
      await sleep(1200);
      const pausedText = (await dbg()).timer.text;
      C.timerPaused = { paused: (await dbg()).timer.paused, same: pausedText === C.timerNormal.text || pausedText === (await dbg()).timer.text };
      // the dial can sit in the middle too (also while it runs)
      await clickText('.fp[data-id="timer"] .timer-running .seg-btn', 'Middle');
      await sleep(400);
      C.timerMiddle = await js(player, `(() => { const d = document.querySelector('#table-timer .tt-dial.timer').getBoundingClientRect(); return { side: document.getElementById('table-timer').dataset.side, dx: Math.round(d.x + d.width / 2 - innerWidth / 2), dy: Math.round(d.y + d.height / 2 - innerHeight / 2) }; })()`);
      await shot(player, '15o2-table-timer-middle');
      handle('timer.stop');
      await clickSel('.fp[data-id="timer"] .fp-close');
      C.floatClosed = await js(gm, `!document.querySelector('.fp')`);
      await key('Escape');

      // Assets: shadow and darkness for the next stamps, Shift + drag selects both, they turn together, then lock
      await key('S');
      await sleep(300);
      await clickText('#pop .look .ctl-toggle', 'Shadow');
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop .look .ctl-slider')].find((x) => x.textContent.includes('Darken')).querySelector('input'); s.value = 0.3; s.dispatchEvent(new Event('input')); })()`);
      const n0 = L().layers.filter((l) => l.role === 'asset').length;
      for (const [cx, cy] of [[31.5, 12], [33.5, 12]]) { const p = await cell(cx, cy); await click(p.x, p.y); await sleep(250); }
      const two = L().layers.filter((l) => l.role === 'asset').slice(-2).map((l) => ({ ...l }));
      C.assetLook = { added: L().layers.filter((l) => l.role === 'asset').length - n0, shadow: two.map((l) => l.shadow), dark: two.map((l) => l.dark) };
      await sleep(200);
      C.tableShadow = await js(player, `(() => { const a = [...document.querySelectorAll('.tv-layer.shown .sv-asset')].pop(); return a && a.style.filter; })()`);
      await dragPath(await cell(30.6, 14.2), await cell(34.9, 11), 8, ['shift']);
      await sleep(200);
      C.boxSelect = { selected: await js(gm, 'Play.ui.selAssets.length'), card: await js(gm, `(() => { const t = document.querySelector('#token-card.on .card-title'); return t && t.textContent; })()`) };
      const a0 = await rect(`.sv-asset[data-id="${two[0].id}"]`);
      // (on a slow test screen the first wheel can come before the selection settled: once more after a moment)
      for (let i = 0; i < 3; i++) {
        gm.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(a0.cx), y: Math.round(a0.cy), deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
        await sleep(800);
        if (two.some((t) => L().layers.find((l) => l.id === t.id).rotation !== (t.rotation || 0))) break;
      }
      C.groupTurn = two.map((t) => Math.abs(L().layers.find((l) => l.id === t.id).rotation - (t.rotation || 0)));
      // the card may still be rebuilding on a slow machine: try again until both took it
      for (let i = 0; i < 6; i++) {
        await js(gm, `(() => { const s = document.querySelector('#token-card.on .card-range input'); if (!s) return; s.value = 0.5; s.dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        if (two.every((t) => L().layers.find((l) => l.id === t.id).opacity === 0.5)) break;
      }
      C.groupOpacity = two.map((t) => L().layers.find((l) => l.id === t.id).opacity);
      await shot(gm, '15p-assets-group');
      await clickSel('#token-card .icon-btn[aria-label="Lock them in place"]');
      await sleep(300);
      C.locked = { locked: L().layers.filter((l) => l.locked).length, selected: await js(gm, 'Play.ui.selAssets.length'), pe: await js(gm, `getComputedStyle(document.querySelector('.sv-asset.is-locked')).pointerEvents`) };
      await clickText('#pop .btn', 'Unlock all');
      await sleep(300);
      C.unlocked = L().layers.filter((l) => l.locked).length;
      await key('Escape');
      await key('V');
    }
    handle('fog.enabled', { enabled: true });

    // ---------- 8e. 0.6: weather mixes, lightning, talk, handouts, soundboard, break, initiative ----------
    handle('fog.enabled', { enabled: false });
    {
      const k = L().grid.size;
      const dbg = () => js(player, 'window.__table.debug()');
      // an opaque "painting" among the portraits, to check the soft edge
      fs.copyFileSync(lib('Maps/Static/Demo dungeon.png'), lib('Portraits/Old sage (painting).png'));

      // Weather: a ready-made mix, then change one layer, add one, save the mix
      await key('E');
      await sleep(200);
      await clickText('#pop .seg-btn', 'Weather');
      await sleep(200);
      await clickText('#pop .wx-presets .tile', 'Thunderstorm');
      await sleep(600);
      C.wxStorm = { layers: L().weather.layers.map((l) => l.type), name: L().weather.name, table: (await dbg()).weather };
      await clickText('#pop .wx-list .layer-main', 'Rain');
      await sleep(250);
      const cp = await rect('#pop .compass');
      await click(cp.x + 3, cp.cy); // the left edge of the dial: blow towards the left
      await sleep(300);
      C.wxDir = (L().weather.layers.find((l) => l.type === 'rain') || {}).dir;
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop .wx-detail .ctl-slider')].find((x) => x.textContent.includes('Opacity')).querySelector('input'); s.value = 0.5; s.dispatchEvent(new Event('input')); })()`);
      const rainOp = () => (L().weather.layers.find((l) => l.type === 'rain') || {}).opacity;
      for (let i = 0; i < 20 && rainOp() !== 0.5; i++) await sleep(100); // the slider sends its value a moment later
      C.wxOpacity = rainOp();
      await clickText('#pop .wx-add .tile', 'Fog banks');
      await sleep(300);
      C.wxAdded = L().weather.layers.map((l) => l.type);
      await sleep(1200);
      C.wxCover = { weather: await js(player, `window.__table.coverage('weather')`), stats: (await dbg()).weather };
      await shot(player, '16a-table-thunderstorm');
      await shot(gm, '16b-weather-panel');
      const scrolled = `[...document.querySelectorAll('body, body *')].filter((e) => !e.closest('#pop') && (e.scrollTop || e.scrollLeft)).map((e) => e.id || e.className)`;
      C.stageScroll = await js(gm, scrolled);
      await clickText('#pop .btn', 'Save this mix');
      await sleep(250);
      gm.webContents.focus();
      await gm.webContents.insertText('Storm test');
      await key('Enter');
      await sleep(500);
      C.wxSaved = await js(gm, `[...document.querySelectorAll('#pop .wx-presets .tile')].map((t) => t.textContent).includes('Storm test')`);
      // changes over 10 s: the old layers fade out while snow comes in
      await clickText('#pop .seg-btn', 'Over 10 s');
      await sleep(200);
      await clickText('#pop .wx-presets .tile', 'Snow');
      await sleep(400);
      C.wxFade = { dying: L().weather.layers.filter((l) => l.dying).length, born: L().weather.layers.filter((l) => !l.dying).map((l) => l.type) };
      handle('weather.fade', { fade: 0 });
      handle('weather.preset', { name: 'None', layers: [] });
      await key('Escape');

      // the toolbox: four tools; lightning on demand lives with the weather now
      await key('Q');
      await sleep(250);
      C.toolboxPanels = await js(gm, `[...document.querySelectorAll('#pop .tb-tile:not([data-t])')].map((t) => t.textContent.trim())`);
      await shot(gm, '16c-toolbox');
      await key('Escape');
      handle('weather.add', { type: 'lightning', amount: 0.1 });
      await js(gm, `Play.ui.fxMode = 'weather'`);
      await key('E');
      await sleep(300);
      C.strikeBtn = await js(gm, `(() => { const b = document.querySelector('#pop .wx-strike'); return !!b && !!b.offsetParent; })()`);
      await js(gm, `document.querySelector('#pop .wx-strike').scrollIntoView({ block: 'center' })`); // (Beta 2: more mixes and layers above it)
      await sleep(150);
      await clickSel('#pop .wx-strike');
      await sleep(60);
      await shot(player, '16d-table-lightning');
      await sleep(1300);
      C.strike = { strikes: (await dbg()).events.strikes, thunders: (await snd()).thunders };
      handle('weather.preset', { name: 'None', layers: [] });
      await key('Escape');

      // Talk: start, bring in two NPCs, mirror one, an opaque painting, take one out, end
      await key('O');
      await sleep(900);
      C.talkPop = await js(gm, `document.querySelector('#pop.on .pop-title').textContent`);
      await clickText('#pop .btn', 'Start a conversation');
      await sleep(400);
      C.talkOn = !!state.talk;
      // 4.7: the small panel shows the party and the Ready list: tick the three in List … to have them there
      await clickText('#pop .btn', 'List');
      await sleep(900);
      C.talkList = await js(gm, `[...document.querySelectorAll('.fp[data-id="talklist"] .pl-it')].map((x) => x.getAttribute('aria-label'))`);
      const readyCount = async () => ((store.chapterOf(state.editMapId) || {}).ready || {}).portraits ? store.chapterOf(state.editMapId).ready.portraits.length : 0;
      for (const nm of ['Hooded stranger', 'Captain of the guard', 'Old sage']) {
        const before = await readyCount();
        const tk = await js(gm, `(() => { const it = [...document.querySelectorAll('.fp[data-id="talklist"] .pl-it')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(nm)})); const b = it && it.querySelector('.pl-tick'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (tk) { await click(tk.x, tk.y); for (let i = 0; i < 20 && (await readyCount()) <= before; i++) await sleep(100); await sleep(250); }
      }
      C.talkReady = await js(gm, `[...document.querySelectorAll('#pop .ready-row .talk-pick')].map((x) => x.getAttribute('aria-label'))`);
      await js(gm, `Play.Floats.hide('talklist')`);
      await sleep(300);
      await clickText('#pop .talk-pick', 'Hooded stranger');
      await sleep(400);
      await clickText('#pop .talk-pick', 'Captain of the guard');
      await sleep(1800);
      const t1 = (await dbg()).over;
      C.talk = { cast: state.talk && state.talk.cast.map((c) => [c.name, c.alpha]), tv: t1.talk, soft: t1.soft };
      await shot(player, '16e-table-talk');
      await shot(gm, '16f-talk-gm');
      C.stageScroll2 = await js(gm, `[...document.querySelectorAll('body, body *')].filter((e) => !e.closest('#pop') && (e.scrollTop || e.scrollLeft)).map((e) => e.id || e.className)`);
      const mir = await js(gm, `(() => { const c = [...document.querySelectorAll('#pop .talk-pick')].find((x) => x.textContent.includes('Hooded stranger')); const b = c.querySelector('.talk-mirror'); const r = b.getBoundingClientRect(); const r2 = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, cx: r2.x + r2.width / 2, cy: r2.y + r2.height / 2 }; })()`);
      await mouse('mouseMove', mir.cx, mir.cy);
      await sleep(100);
      await click(mir.x, mir.y);
      await sleep(400);
      C.talkMirror = (await dbg()).over.talk.mirrored;
      await clickText('#pop .talk-pick', 'Old sage');
      await sleep(1500);
      C.talkOpaque = { tv: (await dbg()).over.talk, alpha: state.talk.cast.find((c) => /Old sage/.test(c.name)).alpha };
      await shot(player, '16g-table-talk-three');
      await clickText('#pop .talk-pick', 'Hooded stranger'); // out again
      await sleep(1200);
      C.talkOut = { cast: state.talk.cast.length, tv: (await dbg()).over.talk.npcs };
      await clickText('#pop .btn', 'End the conversation');
      await sleep(1600);
      C.talkEnd = { state: state.talk, tv: (await dbg()).over.talk, soft: (await dbg()).over.soft };
      { const chT = store.chapterOf(state.editMapId); if (chT) handle('ready.set', { chapterId: chT.id, kind: 'portraits', items: [] }); }
      await key('Escape');

      // Handouts: from the library, shown to both long sides; then to one side only
      await key('L');
      await sleep(900);
      await clickText('#drawer .lib-nav-btn', 'Handouts');
      await sleep(600);
      await clickText('#drawer .lt-handouts', 'Sealed letter');
      await sleep(1000);
      C.handout = { state: state.handout && state.handout.name, tv: (await dbg()).over.handout, hud: await js(gm, `!!document.querySelector('.hud-handout')`) };
      await shot(player, '16h-table-handout');
      await key('Escape');
      await js(gm, `window.ts.settings({ seats: 'one' })`);
      await sleep(500);
      C.handoutOne = (await dbg()).over.handout;
      await shot(player, '16i-table-handout-one-side');
      await js(gm, `window.ts.settings({ seats: 'both' })`);
      await clickSel('.hud-handout .icon-btn');
      await sleep(400);
      C.handoutHidden = { state: state.handout, tv: (await dbg()).over.handout };

      // Soundboard: play a sound from Audio/SFX once on the table; one per row, whole names, a search box for long lists
      const extraSfx = ['Enemy_Wave-02.ogg', ...Array.from({ length: 9 }, (_, i) => `Extra ${i + 1}.ogg`)];
      for (const f of extraSfx) fs.copyFileSync(lib('Audio/SFX/Bell.ogg'), lib(`Audio/SFX/${f}`));
      await key('Q');
      await sleep(200);
      await clickText('#pop .tb-tile', 'Soundboard');
      await sleep(900);
      C.board = await js(gm, `[...document.querySelectorAll('.fp[data-id="sound"] .sb-btn')].map((b) => b.textContent.trim())`);
      C.boardList = await js(gm, `(() => { const l = document.querySelector('.fp[data-id="sound"] .sb-list'); const rows = [...l.querySelectorAll('.sb-btn')]; const s = document.querySelector('.fp[data-id="sound"] .sb-search');
        return { single: rows.every((r) => Math.abs(r.getBoundingClientRect().width - rows[0].getBoundingClientRect().width) < 2) && rows.length > 1 && rows[0].getBoundingClientRect().width > l.clientWidth * 0.8,
          cut: rows.filter((r) => { const n = r.querySelector('.sb-name'); return n.scrollWidth > n.clientWidth + 1; }).length, search: !!s && !s.hidden }; })()`);
      const dk0 = (await snd()).ducks;
      await clickText('.fp[data-id="sound"] .sb-btn', 'Door creak');
      await sleep(350);
      const sd = await snd();
      C.boardPlayed = sd.board;
      C.duck = { ducks: sd.ducks - dk0, gain: sd.gains.duck };
      await js(gm, `(() => { const s = document.querySelector('.fp[data-id="sound"] .sb-search'); s.value = 'door'; s.dispatchEvent(new Event('input')); })()`);
      await sleep(300);
      C.boardSearch = await js(gm, `[...document.querySelectorAll('.fp[data-id="sound"] .sb-btn')].map((b) => b.textContent.trim())`);
      await shot(gm, '16i-soundboard');
      await js(gm, `(() => { const s = document.querySelector('.fp[data-id="sound"] .sb-search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);
      for (const f of extraSfx) fs.rmSync(lib(`Audio/SFX/${f}`), { force: true });
      await sleep(2500);
      C.duckBack = (await snd()).gains.duck;

      // Break: a second floating panel next to the soundboard, dragged aside by its title
      await key('Q');
      await sleep(200);
      await clickText('#pop .tb-tile', 'Break');
      await sleep(300);
      const bh = await rect('.fp[data-id="break"] .fp-head');
      await dragPath({ x: bh.x + 70, y: bh.cy }, { x: bh.x - 230, y: bh.cy + 180 }, 8);
      const bh2 = await rect('.fp[data-id="break"] .fp-head');
      C.floats = { open: await js(gm, `[...document.querySelectorAll('.fp')].map((p) => p.dataset.id)`), dx: Math.round(bh2.x - bh.x), dy: Math.round(bh2.y - bh.y) };
      await shot(gm, '16j-floating-panels');
      await clickText('.fp[data-id="break"] .chip', '5 min');
      await clickText('.fp[data-id="break"] .btn', 'Start the break');
      await sleep(1200);
      C.brk = { state: !!state.brk, tv: (await dbg()).over.brk, soft: (await dbg()).over.soft, hud: await js(gm, `(() => { const b = document.querySelector('.hud-break b'); return b && b.textContent; })()`) };
      // the dial sits in the middle of the TV
      C.brkCenter = await js(player, `(() => { const r = document.querySelector('.tt-dial.break').getBoundingClientRect(); return { dx: Math.round(r.x + r.width / 2 - innerWidth / 2), dy: Math.round(r.y + r.height / 2 - innerHeight / 2), w: Math.round(r.width) }; })()`);
      await shot(player, '16k-table-break');
      await clickSel('.hud-break .icon-btn');
      await sleep(400);
      C.brkEnd = { state: state.brk, tv: (await dbg()).over.brk };
      // folding: a double-click on the title leaves only the title bar
      await js(gm, `document.querySelector('.fp[data-id="break"] .fp-head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      C.floatFold = await js(gm, `(() => { const p = document.querySelector('.fp[data-id="break"]'); return { folded: p.classList.contains('folded'), h: Math.round(p.getBoundingClientRect().height) }; })()`);
      await clickSel('.fp[data-id="sound"] .fp-close');
      await clickSel('.fp[data-id="break"] .fp-close');
      await key('Escape');

      // Initiative (1.9: one pop-up): the players (added through ⋯) and the map's tokens, one row each; a group by choice;
      // the numbers sort themselves when the last one is in; Start adds the turn marker; Enter for the next turn
      await key('I');
      await sleep(500);
      const IP = '.fp[data-id="init"]';
      C.initPop = await js(gm, `(() => { const b = document.querySelector('${IP} .fp-title'); return b && b.textContent; })()`);
      for (const name of ['Mira', 'Thorin']) {
        await clickText(`${IP} .ini-tools .btn`, 'Player'); // (Prototype 7: the ⋯ menu is gone; the Player button adds one)
        await clickText('#menu .menu-item', 'A new player');
        await sleep(250);
        await gm.webContents.insertText(name);
        await key('Enter');
        await sleep(450);
      }
      C.partyNames = store.cur.meta.party;
      const iniNames = () => js(gm, `[...document.querySelectorAll('${IP} .ini-row[data-id] .ini-name span')].map((x) => x.textContent)`);
      C.initRows = await iniNames();
      // the goblins share one turn: the name menu of one of them
      await clickText(`${IP} .ini-row[data-id] .ini-name`, 'Goblin');
      await clickText('#menu .menu-item', 'Make a group of all Goblin');
      await sleep(400);
      C.initGroup = { units: state.init && initUnitsNames(), bar: await js(gm, `(() => { const b = document.querySelector('${IP} .ini-gbar .ini-name'); return b && b.textContent; })()`) };
      // the numbers: Enter jumps to the next empty field; the last one sorts the list
      const setNum = (sel, v) => js(gm, `(() => { const n = document.querySelector(${JSON.stringify(sel)}); n.focus(); n.value = ${JSON.stringify(String(v))}; n.dispatchEvent(new Event('change')); })()`);
      await setNum(`${IP} .ini-gbar .ini-num`, 18);
      await sleep(300);
      const firstEmpty = await js(gm, `(() => { const n = [...document.querySelectorAll('${IP} .ini-num')].find((x) => x.value === ''); n.focus(); return n.dataset.f; })()`);
      await gm.webContents.insertText('5');
      await key('Enter');
      await sleep(400);
      C.initJump = { from: firstEmpty, to: await js(gm, `(() => { const a = document.activeElement; return a && a.classList.contains('ini-num') ? { f: a.dataset.f, empty: a.value === '' } : null; })()`) };
      for (let k = 0; k < 8; k++) {
        const left = await js(gm, `[...document.querySelectorAll('${IP} .ini-num')].filter((x) => x.value === '').map((x) => x.closest('.ini-row').textContent)`);
        if (!left.length) break;
        const t = left[0];
        await setNum(`${IP} .ini-num[data-f="${await js(gm, `[...document.querySelectorAll('${IP} .ini-num')].find((x) => x.value === '').dataset.f`)}"]`, /Mira/.test(t) ? 15 : /Thorin/.test(t) ? 12 : 5);
        await sleep(300);
      }
      C.initSorted = { order: initUnitsNames(), running: state.init.running };
      await clickText(`${IP} .ini-top .btn`, 'Start the fight');
      await sleep(600);
      const I0 = state.init;
      C.initStart = { order: initUnitsNames(), round: L().round.n, turn: I0 && I0.entries.find((e) => e.id === I0.turn).name, running: I0.running };
      const d0 = await dbg();
      C.initTv = { rib: d0.over.init, glow: d0.turnGlow, pill: d0.round };
      // nothing about the turn order under the table preview any more: it all lives in the pop-up
      C.initHud = await js(gm, `({ init: !!document.querySelector('.hud-init'), round: !!document.querySelector('.hud-round') })`);
      await shot(player, '16l-table-initiative');
      await shot(gm, '16m-initiative-gm');
      await key('Escape');
      gm.webContents.focus();
      await js(gm, 'document.activeElement && document.activeElement.blur()');
      const n = initUnitsNames().length;
      await key('Enter');
      await sleep(300);
      const cur1 = () => { const I = state.init; const u = I.entries.find((e) => e.id === I.turn); return u.name; };
      C.initNext = { name: cur1(), glow: (await dbg()).turnGlow };
      for (let i = 1; i < n; i++) { await key('Enter'); await sleep(250); }
      C.initRound = { name: cur1(), round: L().round.n };
      await js(gm, `window.ts.settings({ initShow: false })`); // (Prototype 7: the eye is gone; Options → Initiative has the switch)
      await sleep(300);
      C.initHidden = (await dbg()).over.init;
      await clickSel(`${IP} .ini-top .icon-btn[aria-label="End the fight"]`);
      await sleep(400);
      C.initEnd = { running: state.init ? state.init.running : null, round: L().round.n, fighting: await js(gm, `Play.state().sound.fighting`) };
      await sleep(400);
      C.initAgain = { prepared: !!state.init && !state.init.running, rows: (await iniNames()).length };
      handle('init.update', { show: true });
      await key('I'); // I closes the panel again
      C.initClosed = await js(gm, `!document.querySelector('.fp[data-id="init"]')`);
      await key('Escape');
      await key('V');
    }
    handle('fog.enabled', { enabled: true });

    // ---------- 8f. 0.7: walls, doors, line of sight, walls from other programs ----------
    {
      const origLive = state.liveMapId;
      const chId = store.chapterOf(origLive).id;
      const dbg = () => js(player, 'window.__table.debug()');
      const tmpMaps = [];
      await key('Escape'); await key('V');
      // a new map from the demo crypt in the library: a Universal VTT file with picture, walls, doors and lights
      await js(gm, `Play.ui.lib.cat = 'maps'; Play.ui.lib.shelf = null; Play.ui.lib.query = ''; Play.ui.lib.tags = []`);
      await key('L');
      await sleep(2500);
      C.cryptCard = await js(gm, `(() => { const t = [...document.querySelectorAll('#drawer .lt')].find((x) => x.textContent.includes('Demo crypt')); return t ? { walls: !!t.querySelector('.lt-walls'), thumb: !!t.querySelector('.thumb.loaded') } : null; })()`);
      await shot(gm, '17-library-crypt');
      await clickText('#drawer .lt', 'Demo crypt');
      await sleep(1800);
      const nm = { id: state.editMapId };
      tmpMaps.push(nm.id);
      const M = () => store.map(nm.id);
      C.cryptImport = {
        walls: M().walls.filter((w) => !w.door).length, doors: M().walls.filter((w) => w.door).length, lights: M().fx.filter((f) => f.imported).length,
        span: M().bg && M().bg.span, grid: M().grid.size, vision: M().vision.on, url: /[\\/]\.cache[\\/]vtt[\\/]/.test(decodeURIComponent((M().bg && M().bg.url) || '')),
        shown: await js(gm, `(() => { const b = Play.view().bgNode; return !!(b && b.nw > 0); })()`),
      };
      if (await js(gm, `!!document.querySelector('#drawer.on')`)) await key('Escape');
      const bx = M().bg.x; const by = M().bg.y;
      const at = (x, y) => scr(bx + x, by + y);
      // the walls tool: add a party light, let the party explore
      await key('W');
      await sleep(300);
      C.wallsPop = await js(gm, `({ title: document.querySelector('#pop .pop-title') && document.querySelector('#pop .pop-title').textContent, modes: document.querySelectorAll('#pop .wl-modes .seg-btn').length, tool: Play.ui.tool })`);
      C.wallsPop.partyLink = await js(gm, `[...document.querySelectorAll('#pop .btn')].some((b) => b.textContent.trim() === 'Party marker')`);
      await shot(gm, '17a-walls-pop');
      await key('Escape');
      // 1.4: the party lives in Play → Party (U)
      await key('U');
      await sleep(300);
      // 1.4.1: the button arms it, a click on the map puts it down (into the first room, on the line of the corridor)
      await clickText('#pop .btn', 'Put the party on the map');
      await sleep(300);
      const party = () => M().fx.find((f) => f.kind === 'light' && f.preset === 'party');
      const to = await at(4, 4.5);
      await mouse('mouseMove', to.x - 30, to.y);
      await mouse('mouseMove', to.x, to.y);
      await sleep(150);
      const armedBefore = { parties: M().fx.filter((f) => f.preset === 'party').length, ghost: await js(gm, `(() => { const g = document.querySelector('.party-ghost'); return !!g && g.style.display !== 'none'; })()`) };
      await click(to.x, to.y);
      await sleep(600);
      const centre = await js(gm, `Geom.snap(Play.state().map.grid, ${bx + 4}, ${by + 4.5}, 1)`);
      // a lantern: 30 ft bright, 30 ft more dim
      await clickText('#pop .party-pop .tile', 'Lantern');
      await sleep(300);
      // now the party explores: the fog covers the map, what the party sees opens up
      await clickText('#pop .btn', 'Let the party explore');
      await sleep(500);
      await shot(gm, '17a2-party-pop');
      C.partyPop = { title: await js(gm, `document.querySelector('#pop .pop-title') && document.querySelector('#pop .pop-title').textContent`), tool: await js(gm, 'Play.ui.tool'),
        tiles: await js(gm, `[...document.querySelectorAll('#pop .party-pop .tile')].map((t) => t.textContent)`), carry: party().carry, reach: [party().bright, party().dim], snap: party().snap, armedBefore };
      await key('Escape');
      await key('V');
      C.losParty = { x: r2(party().x - centre.x), y: r2(party().y - centre.y), sight: M().fog.ops.filter((o) => o.shape === 'sight').length, fog: M().fog.enabled };
      // on the TV, in the dark
      handle('light.update', { darkness: 0.7 });
      await key('T');
      await sleep(2600);
      const vis = (await dbg()).vision;
      const sees = (x, y) => js(player, `window.__table.sees(${bx + x}, ${by + y})`);
      const fogAt = (x, y) => js(player, `window.__table.fogAt(${bx + x}, ${by + y})`);
      C.losTv = { vision: vis, live: state.liveMapId === nm.id, name: M().name, seesA: await sees(4, 5), seesB: await sees(14, 4.5), fogA: await fogAt(4, 6), fogB: await fogAt(14, 4.5) };
      // open the door to the big crypt with a click (select tool): the party sees through
      const door = M().walls.find((w) => w.door && Math.abs(w.x1 - (bx + 12)) < 0.01 && Math.abs(w.x2 - (bx + 12)) < 0.01);
      const sightBefore = M().fog.ops.filter((o) => o.shape === 'sight').length;
      // Prototype 4: while playing a door is a lock; a click asks first. No leaves it shut, Yes opens it;
      // in the Party tool the lock asks too, and in the Fog tool the party's marker can still be dragged
      const lockSel = `.sv-door[data-id="${door.id}"]`;
      const lockOf = () => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(lockSel)}); return e ? { lock: e.classList.contains('lock'), open: e.classList.contains('open'), icon: (e.querySelector('use') ? e.querySelector('use').getAttribute('href') : (e.querySelector('svg') || {}).outerHTML || '').slice(0, 60) } : null; })()`);
      const askText = () => js(gm, `(() => { const e = document.querySelector('.door-ask'); return e ? e.querySelector('b').textContent : null; })()`);
      const isOpen = () => !!M().walls.find((w) => w.id === door.id).open;
      const lock0 = await lockOf();
      await clickSel(lockSel); await sleep(300);
      const asked = await askText();
      await clickText('.door-ask .btn', 'No'); await sleep(300);
      const afterNo = { open: isOpen(), ask: await askText() };
      await key('U'); await sleep(400); await key('Escape'); await sleep(200); // (its panel away: the lock is under the mouse)
      const inParty = { tool: await js(gm, 'Play.ui.tool'), lock: !!(await rect(lockSel)) };
      await clickSel(lockSel); await sleep(300);
      inParty.asked = await askText(); inParty.partyAt = [party().x, party().y];
      await key('Escape'); await sleep(200);
      inParty.afterEsc = { open: isOpen(), ask: await askText(), partyStayed: party().x === inParty.partyAt[0] && party().y === inParty.partyAt[1] };
      await key('Escape'); await key('R'); await sleep(400); await key('Escape'); await sleep(200);
      const inFog = { tool: await js(gm, 'Play.ui.tool'), lock: !!(await rect(lockSel)), marker: await js(gm, `(() => { const e = document.querySelector('.sv-handle.party'); return e ? { icon: !!e.querySelector('svg'), w: Math.round(e.getBoundingClientRect().width) } : null; })()`) };
      { const hr = await rect('.sv-handle.party'); const p0 = [party().x, party().y]; const ops0 = M().fog.ops.filter((o) => o.shape !== 'sight').length;
        await dragPath({ x: hr.cx, y: hr.cy }, { x: hr.cx + 30, y: hr.cy }, 6); await sleep(400);
        inFog.dragged = r2(Math.hypot(party().x - p0[0], party().y - p0[1])); inFog.brushed = M().fog.ops.filter((o) => o.shape !== 'sight').length - ops0;
        handle('fx.update', { id: party().id, x: p0[0], y: p0[1], final: true }); await sleep(300); }
      await key('V'); await sleep(300);
      await clickSel(lockSel); await sleep(300);
      await clickText('.door-ask .btn', 'Yes');
      await sleep(600);
      C.doorAsk = { lock0, asked, afterNo, inParty, inFog, lock1: await lockOf() };
      C.doorOpen = { open: M().walls.find((w) => w.id === door.id).open, seesB: await sees(14, 4.5), sight: M().fog.ops.filter((o) => o.shape === 'sight').length - sightBefore };
      // walk on into the shrine: the first room stays explored, but dimmed
      handle('fx.update', { id: party().id, x: bx + 6.5, y: by + 14, final: true });
      await sleep(700);
      C.explored = { fogA: await fogAt(4, 6), fogC: await fogAt(6.5, 13), fogD: await fogAt(20, 15), dim: M().vision.dim };
      await shot(player, '17b-table-line-of-sight');
      await shot(gm, '17c-gm-line-of-sight');

      // drawing walls in the rock beside the crypt: a line, a room, a door, moving a corner, erasing
      await key('W');
      await sleep(300);
      await key('Escape'); // popover closed, tool stays
      const nWalls = () => M().walls.length;
      let n0 = nWalls();
      for (const [x, y] of [[23.5, 2], [26, 2], [26, 5]]) { const p = await at(x, y); await click(p.x, p.y); }
      await key('Enter');
      const chain = M().walls.slice(-2);
      C.wallChain = { added: nWalls() - n0, rel: chain.map((w) => [r2(w.x1 - bx), r2(w.y1 - by), r2(w.x2 - bx), r2(w.y2 - by)]), ended: await js(gm, `!Play.ui.walls.chain`) };
      await key('W'); // next mode: Room
      n0 = nWalls();
      await dragPath(await at(23, 6), await at(26, 9), 8);
      C.wallRoom = { mode: await js(gm, 'Play.ui.walls.mode'), added: nWalls() - n0 };
      await key('W'); // Door
      const d0 = M().walls.filter((w) => w.door).length;
      const pd = await at(24.5, 6);
      await click(pd.x, pd.y);
      const nd = M().walls.find((w) => w.door && Math.abs(w.y1 - (by + 6)) < 0.01);
      C.wallDoor = { mode: await js(gm, 'Play.ui.walls.mode'), doors: M().walls.filter((w) => w.door).length - d0, span: nd ? [r2(Math.min(nd.x1, nd.x2) - bx), r2(Math.max(nd.x1, nd.x2) - bx)] : null };
      await key('W'); // Edit: drag the corner of the line, both walls follow
      await dragPath(await at(26, 2), await at(27, 2.5), 8);
      const moved = M().walls.filter((w) => (Math.abs(w.x1 - (bx + 27)) < 0.01 && Math.abs(w.y1 - (by + 2.5)) < 0.01) || (Math.abs(w.x2 - (bx + 27)) < 0.01 && Math.abs(w.y2 - (by + 2.5)) < 0.01)).length;
      await key('W'); // Erase
      n0 = nWalls();
      const pe = await at(25.25, 2.25);
      await click(pe.x, pe.y);
      const erased = n0 - nWalls();
      await key('Z', ['control']);
      await sleep(300);
      C.wallEdit = { moved, erased, undone: nWalls() === n0, mode: await js(gm, 'Play.ui.walls.mode') };
      // right-click a door: its menu
      const ndEl = await rect(`.sv-door[data-id="${nd.id}"]`);
      await click(ndEl.cx, ndEl.cy, 'right');
      await sleep(300);
      C.doorRadial = await js(gm, `[...document.querySelectorAll('#radial .radial-item span')].map((x) => x.textContent)`);
      await key('Escape');
      await shot(gm, '17d-walls-tool');
      await key('W'); // back to drawing walls
      await key('V');

      // a video map with a walls file of the same name next to it (e.g. a Dungeon Alchemist video export)
      const vid = lib('Maps/Animated/Demo dungeon (torchlight).mp4');
      const side = lib('Maps/Animated/Demo dungeon (torchlight).dd2vtt');
      const sq = { x: 1920 / 54, y: 1080 / 54 };
      fs.writeFileSync(side, JSON.stringify({
        format: 0.3, resolution: { map_origin: { x: 0, y: 0 }, map_size: sq, pixels_per_grid: 54 },
        line_of_sight: [[{ x: 2, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 8 }]], portals: [{ position: { x: 10, y: 9 }, bounds: [{ x: 10, y: 8 }, { x: 10, y: 10 }], closed: true }], lights: [],
      }));
      const vm = handle('map.add', { chapterId: chId, name: 'Video walls (test)' });
      tmpMaps.push(vm.id);
      await sleep(300);
      handle('bg.set', { path: vid });
      await sleep(300);
      const VM = store.map(vm.id);
      const libItems = library.listLibrary();
      C.videoWalls = {
        walls: VM.walls.filter((w) => !w.door).length, doors: VM.walls.filter((w) => w.door).length, span: r2(VM.bg.span || 0), expect: r2(sq.x * VM.grid.size), kind: VM.bg.kind,
        badge: !!(libItems.find((it) => it.path === vid) || {}).walls, listed: libItems.some((it) => it.path === side),
      };
      fs.unlinkSync(side);

      // walls from a Foundry VTT scene onto a map that already has its picture
      const fm = handle('map.add', { chapterId: chId, name: 'Foundry (test)' });
      tmpMaps.push(fm.id);
      await sleep(300);
      handle('bg.set', { path: lib('Maps/Static/Demo dungeon.png') });
      for (let i = 0; i < 40 && !(store.map(fm.id).bg.nw > 0); i++) await sleep(100); // the GM window measures the picture
      const FM = store.map(fm.id);
      const pad = (v) => Math.ceil((v * 0.25) / 54) * 54;
      const px = pad(1920); const py = pad(1080);
      const scene = (name, extra = []) => ({
        name, width: 1920, height: 1080, padding: 0.25, grid: { size: 54, distance: 5 },
        walls: [
          { c: [px + 540, py + 270, px + 1080, py + 270], door: 0, sight: 20 },
          { c: [px + 1080, py + 270, px + 1080, py + 540], door: 1, ds: 0, sight: 20 },
          { c: [px + 100, py + 100, px + 200, py + 100], door: 0, sight: 0 }, // an invisible wall: does not block sight
          ...extra],
        lights: [{ x: px + 540, y: py + 540, config: { dim: 30, bright: 15, color: '#ff8800' } }],
      });
      const fjson = path.join(dir, 'foundry-scene.json');
      fs.writeFileSync(fjson, JSON.stringify(scene('Lower hall')));
      const fr = handle('walls.load', { mapId: fm.id, path: fjson });
      const w0 = FM.walls.find((w) => !w.door);
      C.foundry = {
        ok: fr.ok, walls: FM.walls.filter((w) => !w.door).length, doors: FM.walls.filter((w) => w.door).length, lights: FM.fx.filter((f) => f.imported).length,
        nw: FM.bg.nw, x1: w0 ? r2(w0.x1) : null, expectX1: r2(FM.bg.x + 540 * FM.bg.scale), grid: r2(FM.grid.size), expectGrid: r2(54 * FM.bg.scale),
      };
      // a compendium with two scenes: you are asked which one
      const fdb = path.join(dir, 'foundry-pack.db');
      fs.writeFileSync(fdb, `${JSON.stringify(scene('Upper hall'))}\n${JSON.stringify(scene('Cellar', [{ c: [px, py, px + 54, py], sight: 20 }]))}\n`);
      const ask = handle('walls.load', { mapId: fm.id, path: fdb });
      const pick = handle('walls.load', { mapId: fm.id, path: fdb, scene: 'Cellar' });
      C.foundryChoose = { choose: ask.choose && ask.choose.map((x) => x.name), ok: pick.ok, walls: FM.walls.filter((w) => !w.door).length };

      // back to how it was
      handle('table.send', { id: origLive });
      handle('edit.open', { id: origLive });
      for (const id of tmpMaps) handle('map.remove', { id });
      await sleep(2200);
      C.wallsCleanup = { live: state.liveMapId === origLive, edit: state.editMapId === origLive, gone: tmpMaps.every((id) => !store.allMapIds().includes(id)) };
    }

    // ---------- 8g. 0.8: mark shapes, ambience, HUD size on the TV, pictures in the radial, new paint effects ----------
    {
      const dbg = () => js(player, 'window.__table.debug()');
      await key('Escape'); await key('V');
      // Mark: the shape buttons switch visibly
      await js(gm, `Play.ui.mark.mode = 'marker'`);
      await key('X');
      await sleep(300);
      const onShape = () => js(gm, `(() => { const b = [...document.querySelectorAll('#pop .seg-btn.on')].map((x) => x.textContent.trim()); return b.find((t) => ['Pin', 'Cross', 'Number'].includes(t)) || null; })()`);
      C.markShapes = [];
      for (const sh of ['Cross', 'Number', 'Pin']) { await clickText('#pop .seg-btn', sh); await sleep(150); C.markShapes.push(await onShape()); }
      await key('Escape'); await key('V');

      // Ambience: the volume slider can be dragged (the panel no longer rebuilds under the mouse)
      await js(gm, `Play.ui.soundTab = 'chapter'; Play.openPop('sound')`);
      await sleep(400);
      await js(gm, `(() => { const i = document.querySelector('#pop input[aria-label="Ambience volume"]'); i.dataset.mark = 'drag'; i.scrollIntoView({ block: 'center' }); })()`);
      const ar = await rect('#pop input[aria-label="Ambience volume"]');
      const ch = store.chapterOf(state.liveMapId);
      const v0 = ch.ambience.volume;
      await dragPath({ x: ar.x + ar.w * 0.8, y: ar.cy }, { x: ar.x + ar.w * 0.25, y: ar.cy }, 10);
      await sleep(400);
      // the TV eases to the new volume
      const ambVol = async () => { const t = (await snd()).tracks.find((x) => x.key.startsWith('amb:')); return t ? t.volume : null; };
      for (let i = 0; i < 20; i++) { if (Math.abs((await ambVol()) - store.chapterOf(state.liveMapId).ambience.volume) < 0.05) break; await sleep(200); }
      C.ambDrag = { before: v0, after: Math.round(store.chapterOf(state.liveMapId).ambience.volume * 100) / 100, same: await js(gm, `!!document.querySelector('#pop input[data-mark="drag"]')`), table: await ambVol() };
      handle('chapter.ambience', { id: ch.id, volume: v0 });
      await key('Escape');
      // the looper itself: fades in, crossfades its loop point, fades out
      C.loop = await js(W().sound, `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const { Track, music } = SoundEngine._test;
        const L = new Track('test', ${JSON.stringify(library.media(lib('Audio/Ambience/Cave drone.ogg')).url)}, music, { volume: 0.8, fade: 1 });
        const g = (v) => Math.round(v.g.gain.value * 100) / 100;
        await wait(450);
        const early = g(L.voices[0]);
        await wait(900);
        const full = g(L.voices[0]);
        const el = L.voices[0].el;
        for (let i = 0; i < 40 && !(el.duration > 0); i++) await wait(50);
        el.currentTime = Math.max(0, el.duration - 1.1);
        await wait(500);
        const cross = L.voices.length;
        await wait(1300);
        const after = { voices: L.voices.length, gain: L.voices.map(g) };
        L.stop();
        await wait(450);
        const stopping = L.voices.map(g);
        await wait(1000);
        return { early, full, cross, after, stopping, gone: L.voices.length };
      })()`);

      // HUD size on the TV: the round on both long sides, a sample while the size changes
      const live = L();
      handle('round.set', { mapId: live.id, n: 3, show: true });
      await sleep(400);
      const hud1 = (await dbg()).hud;
      await js(gm, `window.ts.settings({ hudScale: 1.6 })`);
      await sleep(700);
      const d16 = await dbg();
      C.hudScale = { one: hud1, big: d16.hud, sample: d16.over.sample, realHidden: await js(player, `getComputedStyle(document.querySelector('.sv-round')).visibility === 'hidden'`), timerHud: await js(player, `getComputedStyle(document.getElementById('table-timer')).getPropertyValue('--hud').trim()`) };
      await shot(player, '18a-table-hud-sample');
      await js(gm, `window.ts.settings({ seats: 'one' })`);
      await sleep(400);
      C.hudOneSide = (await dbg()).hud;
      await js(gm, `window.ts.settings({ seats: 'both', hudScale: 1 })`);
      await sleep(4200);
      C.hudAfter = { sample: (await dbg()).over.sample, hud: (await dbg()).hud };
      await js(gm, `App.openOptions('players')`);
      await sleep(300);
      C.hudSlider = await js(gm, `(() => { const i = document.querySelector('.modal.options input[aria-label="TV text and panels"]'); return i ? { value: Number(i.value), out: i.nextSibling.textContent } : null; })()`);
      await key('Escape');
      handle('round.set', { mapId: live.id, n: null });

      // pictures in the radial menu: Tonight shows the tokens themselves
      const rp = await scr(2.5, 2.5);
      await click(rp.x, rp.y, 'right');
      await sleep(300);
      await clickText('#radial .radial-item', 'Tonight');
      await sleep(1200);
      C.radialThumbs = await js(gm, `({ items: document.querySelectorAll('#radial .radial-item').length, thumbs: document.querySelectorAll('#radial .radial-item.has-thumb').length, loaded: document.querySelectorAll('#radial .radial-thumb img.loaded').length })`);
      await shot(gm, '18b-radial-thumbs');
      await key('Escape');

      // new paint effects, side by side on a fresh map on the TV
      const origLive = state.liveMapId;
      const pm = handle('map.add', { chapterId: store.chapterOf(origLive).id, name: 'Paint (test)', path: lib('Maps/Static/Demo dungeon.png') });
      await sleep(600);
      const PM = store.map(pm.id);
      const kinds = ['water', 'current', 'surf', 'blood', 'acid', 'darkness'];
      const tr = { x: -PM.view.x / PM.view.zoom, y: -PM.view.y / PM.view.zoom };
      const spots = {};
      kinds.forEach((k, i) => {
        const cx = tr.x + 5 + (i % 3) * 11; const cy = tr.y + 5 + Math.floor(i / 3) * 10;
        spots[k] = { x: cx, y: cy };
        const pts = [];
        for (let j = 0; j <= 8; j++) pts.push(Math.round((cx - 3 + j * 0.75) * 100) / 100, Math.round((cy + Math.sin(j * 0.8) * 1.2) * 100) / 100);
        handle('fx.stroke', { mapId: pm.id, id: `rg-${k}`, preset: k, sid: `s-${k}`, r: 1.6, pts });
        handle('fx.stroke', { mapId: pm.id, id: `rg-${k}`, preset: k, sid: `s2-${k}`, r: 1.3, pts: [cx - 1, cy + 2.2, cx + 1.5, cy + 2.6] });
      });
      handle('table.send', { id: pm.id });
      await sleep(2800);
      const probeAt = async (k, layer) => js(player, `window.__table.probeMap('${layer || (k === 'darkness' ? 'veil' : 'atmo')}', ${spots[k].x}, ${spots[k].y})`);
      C.paintFx = { regions: (await dbg()).fx.regions, veil: (await dbg()).fx.veil };
      for (const k of kinds) C.paintFx[k] = await probeAt(k);
      C.paintFx.darkUnderGrid = await probeAt('darkness', 'atmo'); // magical darkness is not on the effects layer below the grid
      // things travelling along a wobbly hand-painted stroke turn smoothly, and mist keeps changing shape
      C.flowSmooth = await js(player, `(() => {
        const pts = []; for (let i = 0; i <= 60; i++) pts.push(i * 0.13, Math.sin(i * 0.1) * 1.5 + (i % 2 ? 0.05 : -0.05));
        let raw = 0; for (let i = 4; i < pts.length; i += 2) { const a = Math.atan2(pts[i + 1] - pts[i - 1], pts[i] - pts[i - 2]); const b = Math.atan2(pts[i - 1] - pts[i - 3], pts[i - 2] - pts[i - 4]); raw = Math.max(raw, Math.abs(a - b) * 180 / Math.PI); }
        return { raw: Math.round(raw), streak: +FX.flowTurn({ r: 1.4, pts }, 0.01).toFixed(2), front: +FX.flowTurn({ r: 1.4, pts }, 0.01, 1.8).toFixed(2) };
      })()`);
      C.mistMoves = await js(player, `(() => {
        const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d');
        const fx = { id: 'mist-test', kind: 'region', preset: 'mist', intensity: 1, density: 1, speed: 1, strokes: [{ sid: 'a', r: 1.6, pts: [2, 3, 4, 3.4, 6, 3, 8, 3.3] }] };
        const at = (t) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 300, 200); g.setTransform(30, 0, 0, 30, 0, 0); FX.region(g, fx, t); return g.getImageData(0, 0, 300, 200).data; };
        const T = Date.now() / 1000 - 1.7e9; const a = at(T); const b = at(T + 2);
        let diff = 0; let sum = 0; for (let i = 3; i < a.length; i += 4) { diff += Math.abs(a[i] - b[i]); sum += a[i]; }
        return { change: +(diff / (a.length / 4)).toFixed(2), mean: +(sum / (a.length / 4)).toFixed(2) };
      })()`);
      await js(gm, `Play.ui.fxMode = 'paint'`);
      await key('E');
      await sleep(300);
      C.paintTiles = await js(gm, `[...document.querySelectorAll('#pop .tiles .tile')].map((t) => t.textContent.trim())`);
      await key('Escape'); await key('V');
      await shot(player, '18c-table-paint-effects');
      // fresh blood spreads out for a moment
      const fresh = { x: spots.blood.x + 5.5, y: spots.blood.y - 4.5 }; // clear of the other pools
      handle('fx.stroke', { mapId: pm.id, id: 'rg-blood', preset: 'blood', sid: 's3-blood', r: 1.4, pts: [fresh.x, fresh.y] });
      await sleep(80);
      const early = await js(player, `window.__table.probeMap('atmo', ${fresh.x + 0.99}, ${fresh.y})`);
      const earlyAges = (await dbg()).strokeAges;
      await shot(player, '18d-table-blood-fresh');
      await sleep(1700);
      const later = await js(player, `window.__table.probeMap('atmo', ${fresh.x + 0.99}, ${fresh.y})`);
      C.bloodSpread = { early: early[3], later: later[3], earlyAges, centre: await js(player, `window.__table.probeMap('atmo', ${fresh.x}, ${fresh.y})`) };
      handle('table.send', { id: origLive });
      handle('edit.open', { id: origLive });
      handle('map.remove', { id: pm.id });
      await sleep(2200);
      C.paintCleanup = state.liveMapId === origLive && !store.allMapIds().includes(pm.id);
    }

    // ---------- 8h. 0.9: toolbox map tools, notes, round placement and banner, grid under assets,
    //            rooms and marked areas, light moods, ink between maps ----------
    {
      const origLive = state.liveMapId;
      const dbg = () => js(player, 'window.__table.debug()');
      await key('Escape'); await key('V');
      // the Toolbox: map tools in one row, panels in the other; Point and Draw left the rail
      await key('Q');
      await sleep(250);
      C.toolbox = {
        map: await js(gm, `[...document.querySelectorAll('#pop .tb-tile[data-t]')].map((t) => t.textContent.trim())`),
        panels: await js(gm, `[...document.querySelectorAll('#pop .tb-tile:not([data-t])')].map((t) => t.textContent.trim())`),
        rail: await js(gm, `[...document.querySelectorAll('#rail .rail-btn')].map((b) => b.dataset.id).filter((id) => id === 'point' || id === 'draw')`),
      };
      await shot(gm, '19-toolbox');
      await clickText('#pop .tb-tile[data-t]', 'Laser');
      await sleep(250);
      C.tbLaser = { tool: await js(gm, 'Play.ui.tool'), mode: await js(gm, 'Play.ui.point.mode'), pop: await js(gm, `document.querySelector('#pop.on .pop-title') && document.querySelector('#pop.on .pop-title').textContent`),
        rail: await js(gm, `(() => { const b = document.querySelector('#rail [data-id="toolbox"]'); const g = b.querySelector('.rail-badge'); return b.querySelector('.rail-label').textContent + '/' + (g ? g.dataset.tool : ''); })()`) };
      await key('D'); // D still switches to drawing
      await sleep(200);
      C.tbDrawKey = { tool: await js(gm, 'Play.ui.tool'), rail: await js(gm, `(() => { const b = document.querySelector('#rail [data-id="toolbox"]'); const g = b.querySelector('.rail-badge'); return b.querySelector('.rail-label').textContent + '/' + (g ? g.dataset.tool : ''); })()`) };
      await key('Escape'); await key('V');

      // Notes: typed into a panel, saved with the campaign, a time stamp, exported into a file
      await key('Q');
      await sleep(250);
      await clickText('#pop .tb-tile', 'Session log');
      await sleep(300);
      await clickSel('.fp[data-id="notes"] .notes-text');
      await gm.webContents.insertText('Goblins fled north with the silver key.');
      await sleep(1000);
      C.notesSaved = { text: store.cur.meta.notes && store.cur.meta.notes.text, dirty: await js(gm, 'Play.state().campaign.notes.dirty') };
      await clickText('.fp[data-id="notes"] .btn', 'Time stamp');
      await sleep(900);
      C.notesStamp = (store.cur.meta.notes.text.match(/\[\d\d:\d\d · [^\]]+\]/) || [null])[0];
      await shot(gm, '19a-notes');
      await clickText('.fp[data-id="notes"] .btn', 'Export');
      await sleep(700);
      const nf = store.cur.meta.notes.file;
      C.notesExport = { file: nf ? path.relative(store.cur.dir, nf).replace(/\\/g, '/') : null, has: !!nf && fs.existsSync(nf) && fs.readFileSync(nf, 'utf8').includes('silver key'), dirty: await js(gm, 'Play.state().campaign.notes.dirty') };
      await clickSel('.fp[data-id="notes"] .fp-close');

      // a temporary map from the demo crypt (walls, doors, pillars), sent to the table: the ink sweeps over
      await js(gm, `window.ts.settings({ mapTransition: 'ink' })`);
      const rm = handle('map.add', { chapterId: store.chapterOf(origLive).id, name: 'Rooms (test)', path: lib('Maps/Static/Demo crypt.dd2vtt') });
      await sleep(800);
      const RM = () => store.map(rm.id);
      handle('edit.open', { id: rm.id });
      handle('fog.base', { mapId: rm.id, base: 'cover' });
      await sleep(300);
      handle('table.send', { id: rm.id });
      const inkSeen = [];
      let outShot = false;
      for (let i = 0; i < 10; i++) {
        await sleep(150);
        const ph = (await dbg()).mapInk.phase;
        inkSeen.push(ph);
        if (i === 2) await shot(player, '19b-table-ink');
        if (ph === 'revealing' && !outShot) { outShot = true; await sleep(250); await shot(player, '19b2-table-ink-out'); }
      }
      await sleep(1500);
      const afterInk = await dbg();
      C.inkSend = { phases: inkSeen, end: afterInk.mapInk, live: afterInk.liveId === rm.id, shown: afterInk.shown };
      const g = RM().grid.size; const bx = RM().bg.x; const by = RM().bg.y;
      const P = (x, y) => ({ x: bx + x * g, y: by + y * g });
      const at = (x, y) => { const q = P(x, y); return scr(q.x, q.y); };
      const fogAt = (x, y) => { const q = P(x, y); return js(player, `window.__table.fogAt(${q.x}, ${q.y})`); };

      // Room mode: the room under the mouse is outlined; a click reveals it up to its walls and closed doors
      await key('R');
      await sleep(250);
      await clickText('#pop .seg-btn', 'Room');
      const ra = await at(4, 5);
      await mouse('mouseMove', ra.x, ra.y);
      await mouse('mouseMove', ra.x + 3, ra.y + 2);
      await sleep(500);
      C.roomPreview = await js(gm, `!!document.querySelector('.sv-areas-svg .room')`);
      await shot(gm, '19c-gm-room-preview');
      await click(ra.x, ra.y);
      await sleep(1300);
      C.roomReveal = { op: (RM().fog.ops.slice(-1)[0] || {}).shape, rings: ((RM().fog.ops.slice(-1)[0] || {}).rings || []).length,
        inRoom: await fogAt(4, 5), corridor: await fogAt(10, 4.5), crypt: await fogAt(14, 2.5), roomC: await fogAt(6, 14), animated: (await dbg()).fx.reveals };
      // right-click in the big crypt: "Reveal room"; its pillars stay dark
      const rc = await at(14, 2.5);
      await click(rc.x, rc.y, 'right');
      await sleep(300);
      C.roomRadial = await js(gm, `[...document.querySelectorAll('#radial .radial-item')].map((b) => b.textContent.trim())`);
      await clickText('#radial .radial-item', 'Reveal room');
      await sleep(1300);
      C.cryptReveal = { crypt: await fogAt(14, 2.5), pillar: await fogAt(16, 5), stair: await fogAt(18.5, 10.5), roomD: await fogAt(20, 14.5) };
      await shot(player, '19d-table-rooms');
      // mark an area by its corners (no walls needed), name it, reveal it from the radial menu
      await clickText('#pop .btn', 'Mark an area');
      await sleep(200);
      for (const [x, y] of [[16, 13], [25, 13], [25, 16], [16, 16]]) { const q = await at(x, y); await click(q.x, q.y); await sleep(80); }
      await key('Enter');
      await sleep(400);
      await js(gm, `(() => { const i = document.querySelector('.modal-back input'); i.value = 'Vault'; i.closest('form').requestSubmit(); })()`);
      await sleep(500);
      C.areaMarked = (RM().areas || []).map((a) => a.name);
      await shot(gm, '19e-gm-area');
      const va = await at(20, 14.5);
      await click(va.x, va.y, 'right');
      await sleep(300);
      C.areaRadial = await js(gm, `[...document.querySelectorAll('#radial .radial-item')].map((b) => b.textContent.trim())`);
      await clickText('#radial .radial-item', 'Reveal Vault');
      await sleep(1300);
      C.areaReveal = { vault: await fogAt(20, 14.5), roomC: await fogAt(6, 14) };
      await key('Escape'); await key('V');

      // the round: placed by the GM (the far copy mirrored), bigger, announced with a banner on each new round
      handle('round.set', { mapId: rm.id, n: 1, show: true });
      await js(gm, `window.ts.settings({ roundPos: { x: 0.5, y: 0.08 }, roundSize: 2 })`);
      await sleep(500);
      const r1 = await dbg();
      C.roundPlace = { at: r1.roundAt, world: r1.world, px: r1.hud.roundPx };
      handle('round.next', { mapId: rm.id });
      await sleep(350);
      C.roundBanner = (await dbg()).roundBanner;
      await shot(player, '19f-table-round-banner');
      await sleep(2300);
      C.roundBannerGone = { now: (await dbg()).roundBanner.length, banners: (await dbg()).banners };
      // the place-the-round popover from the round row under the table preview: drag the badge
      await clickSel('#table-ctl [aria-label="Round on the table"]');
      await sleep(400);
      C.roundPop = await js(gm, `({ title: document.querySelector('#pop .pop-title').textContent, img: !!document.querySelector('#pop .rp-img'), far: !document.querySelector('#pop .rp-badge.far').hidden })`);
      const bb = await rect('#pop .round-place'); const nb = await rect('#pop .rp-badge.near');
      await dragPath({ x: nb.cx, y: nb.cy }, { x: bb.x + bb.w * 0.8, y: bb.y + bb.h * 0.85 }, 10);
      await sleep(500);
      C.roundDrag = { pos: (await js(gm, 'Play.state().settings.round')), table: (await dbg()).roundAt };
      await shot(gm, '19g-gm-round-place');
      await key('Escape');
      await js(gm, `window.ts.settings({ roundPos: { x: 0.07, y: 0.07 }, roundSize: 1.4 })`);
      handle('round.set', { mapId: rm.id, n: null });

      // the grid can lie under the assets
      handle('grid.update', { mapId: rm.id, under: true });
      await sleep(400);
      C.gridUnder = { table: (await dbg()).gridUnder, gm: await js(gm, 'Play.view().cv.grid.el.nextElementSibling === Play.view().mapA2') };
      handle('grid.update', { mapId: rm.id, under: false });
      await sleep(300);
      C.gridOver = (await dbg()).gridUnder;

      // light moods: dusk from the Effects popover eases in over ten seconds; night from the radial menu
      await js(gm, `Play.ui.fxMode = 'light'; Play.ui.lightTab = 'scene'`);
      await key('E');
      await sleep(300);
      C.moodTiles = await js(gm, `[...document.querySelectorAll('#pop .tile')].map((t) => t.textContent.trim()).filter((t) => ['Day', 'Dawn', 'Dusk', 'Night', 'Cave'].includes(t))`);
      await clickText('#pop .tile', 'Dusk');
      await sleep(600);
      const l1 = (await dbg()).light;
      await sleep(4400);
      const l2 = (await dbg()).light;
      await shot(player, '19h-table-dusk');
      C.moodDusk = { fade: RM().light.from && RM().light.from.s, mood: RM().light.mood, early: l1, mid: l2 };
      await key('Escape'); await key('V');
      await sleep(5400);
      C.moodDuskEnd = (await dbg()).light;
      await shot(player, '19i-table-dusk-full');
      const mp = await at(4, 5);
      await click(mp.x, mp.y, 'right');
      await sleep(300);
      await clickText('#radial .radial-item', 'Light');
      await sleep(300);
      C.moodRing = await js(gm, `[...document.querySelectorAll('#radial .radial-item')].map((b) => b.textContent.trim())`);
      await clickText('#radial .radial-item', 'Night');
      await sleep(400);
      C.moodNight = { mood: RM().light.mood, darkness: RM().light.darkness, fading: (await dbg()).light.fading };
      handle('light.update', { mapId: rm.id, darkness: 0, mood: 'day' });

      // back to how it was (with a crossfade this time)
      await js(gm, `window.ts.settings({ mapTransition: 'fade' })`);
      handle('table.send', { id: origLive });
      await sleep(300);
      C.fadeBack = (await dbg()).mapInk.phase;
      handle('edit.open', { id: origLive });
      handle('map.remove', { id: rm.id });
      await js(gm, `window.ts.settings({ mapTransition: 'ink' })`);
      await sleep(2000);
      C.roomsCleanup = state.liveMapId === origLive && !store.allMapIds().includes(rm.id);
    }

    // ---------- 8i. Alpha 1.0: light in two halves, weather switches, effects quality, frames per second, log ----------
    {
      const dbg = () => js(player, 'window.__table.debug()');
      await key('Escape'); await key('V');
      C.gmTitle = gm.getTitle();
      // the Light tab: the scene's light, and the lights you place
      await js(gm, `Play.ui.lightTab = 'scene'`);
      await key('E');
      await sleep(250);
      await clickText('#pop .seg-btn', 'Light');
      await sleep(250);
      const cardTiles = () => js(gm, `[...document.querySelectorAll('#pop .light-card .tile')].map((t) => t.textContent.trim())`);
      C.lightTabs = { tabs: await js(gm, `[...document.querySelectorAll('#pop .light-tabs .seg-btn')].map((b) => b.textContent.trim())`), scene: await cardTiles() };
      await shot(gm, '19j-light-scene');
      await clickText('#pop .light-tabs .seg-btn', 'Light sources');
      await sleep(250);
      C.lightTabs.sources = await cardTiles();
      C.lightTabs.sat = await js(gm, `[...document.querySelectorAll('#pop .look .ctl-slider')].some((x) => x.textContent.includes('Colour of its light'))`);
      await shot(gm, '19k-light-sources');

      // weather: every single layer is a switch; a mix is lit by what is in it, not by its name
      handle('weather.fade', { fade: 0 });
      handle('weather.preset', { name: 'None', layers: [] });
      await clickText('#pop .seg-btn', 'Weather');
      await sleep(250);
      const wx = async () => ({ layers: L().weather.layers.map((l) => l.type),
        on: await js(gm, `[...document.querySelectorAll('#pop .wx-add .tile.on')].map((t) => t.dataset.v)`),
        mixes: await js(gm, `[...document.querySelectorAll('#pop .wx-presets .tile.on')].map((t) => t.textContent.trim())`) });
      await clickText('#pop .wx-add .tile', 'Snow');
      await sleep(350);
      const snowOn = await wx();
      await clickText('#pop .wx-add .tile', 'Snow');
      await sleep(350);
      const snowOff = await wx();
      await clickText('#pop .wx-presets .tile', 'Thunderstorm');
      await sleep(400);
      const storm = await wx();
      await clickText('#pop .wx-add .tile', 'Fog banks');
      await sleep(350);
      const plusFog = await wx();
      await shot(gm, '19l-weather-switches');
      await clickText('#pop .wx-add .tile', 'Fog banks');
      await sleep(350);
      const minusFog = await wx();
      C.wxSwitch = { snowOn, snowOff, storm, plusFog, minusFog };
      handle('weather.preset', { name: 'None', layers: [] });
      await key('Escape'); await key('V');

      // effects quality: Low makes the TV's effect layers lighter and slower, the GM screen shows videos as still pictures
      const hi = (await dbg()).quality;
      await js(gm, `window.ts.settings({ quality: 'low' })`);
      await sleep(1200);
      const gmQ = `(() => { const v = Play.view(); return { level: v.quality, still: !!v.stillVideo, frozen: v.bgNode && v.bgNode.kind === 'video' ? v.bgNode.el.paused : null }; })()`;
      C.quality = { hi, lo: (await dbg()).quality, gm: await js(gm, gmQ) };
      await js(gm, `window.ts.settings({ quality: 'high' })`);
      await sleep(1000);
      C.quality.back = (await dbg()).quality;
      C.quality.gmBack = await js(gm, gmQ);
      // the TV's frames per second beside the preview
      await sleep(2200);
      C.fps = { text: await js(gm, `(() => { const e = document.querySelector('.tc-fps'); return e && e.textContent; })()`), tv: (await dbg()).fps };

      // the log: errors of both windows end up in it, Copy log puts it on the clipboard
      const about = await js(gm, `window.ts.app('about')`);
      await js(player, `setTimeout(() => { throw new Error('self-test log probe'); }, 10); 1`); // a real error in the TV window
      await sleep(500);
      const copied = await js(gm, `window.ts.app('log.copy')`);
      const clip = String(await require('electron').clipboard.readText()); // a promise in newer Electron
      C.log = { about, exists: !!about.log && fs.existsSync(about.log), copied, head: clip.split('\n')[0], probe: /\[table\] Uncaught Error: self-test log probe/.test(clip), started: /starting/.test(clip) };
      // the guide (Beta 1) shows the version; its Report a problem tab writes one zip with the log and the settings
      await key('?');
      await sleep(400);
      C.helpFoot = await js(gm, `(() => { const f = document.querySelector('.help-foot'); return f && f.textContent; })()`);
      await shot(gm, '19m-keys-version');
      await js(gm, `[...document.querySelectorAll('.guide-tab')].find((b) => /Report a problem/.test(b.textContent)).click()`);
      await sleep(300);
      await js(gm, `document.querySelector('.guide-note').value = 'self-test report'`);
      await js(gm, `[...document.querySelectorAll('.guide-body .btn')].find((b) => /Make the report/.test(b.textContent)).click()`);
      for (let i = 0; i < 40 && !/Written:/.test(await js(gm, `(document.querySelector('.guide-body .hint:not([hidden])') || {}).textContent || ''`)); i++) await sleep(100);
      C.report = await js(gm, `(document.querySelector('.guide-body .hint:not([hidden])') || {}).textContent || ''`);
      await shot(gm, '19n-report');
      try {
        const rf = fs.readdirSync(path.join(require('electron').app.getPath('userData'), 'reports')).filter((f) => f.endsWith('.zip'));
        const zipBuf = fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'reports', rf[rf.length - 1]));
        const names = []; let off = 0; // local file headers: the names in the zip
        while (off + 30 <= zipBuf.length && zipBuf.readUInt32LE(off) === 0x04034b50) { const nl = zipBuf.readUInt16LE(off + 26); const cs = zipBuf.readUInt32LE(off + 18); names.push(zipBuf.toString('utf8', off + 30, off + 30 + nl)); off += 30 + nl + cs; }
        C.reportZip = { files: rf.length, names, bytes: zipBuf.length, end: zipBuf.readUInt32LE(zipBuf.length - 22) === 0x06054b50 };
      } catch (err) { C.reportZip = { error: err.message }; }
      await key('Escape');
      await sleep(200);
    }

    // ---------- 8j. 1.1: the Sound panel holds all sound, library picks come back to the menu,
    //            fight music, Quiet, where the sound plays ----------
    {
      await key('Escape'); await key('V');
      const lm = L();
      handle('edit.open', { id: lm.id });
      await sleep(300);
      const popTitle = () => js(gm, `(() => { const t = document.querySelector('#pop.on .pop-title'); return t && t.textContent; })()`);
      const drawerOpen = () => js(gm, `!!document.querySelector('#drawer.on')`);
      const tracks = async () => (await snd()).tracks.map((t) => t.key.split(':')[0]);
      const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
      // Layers shows no sounds any more; its Sound button opens the Sound panel
      await js(gm, `Play.openPop('layers')`);
      await sleep(300);
      const groups = await js(gm, `[...document.querySelectorAll('#pop .layer-group')].map((g) => g.textContent)`);
      await clickText('#pop .btn', 'Ambience');
      await sleep(400);
      const soundTab = () => js(gm, `(() => { const b = document.querySelector('#pop .sound-tabs .seg-btn.on'); return b && b.textContent.trim(); })()`);
      C.layersSound = { groups, pop: await popTitle(), tab: await soundTab() };
      // four tabs: what each holds
      const labels = () => js(gm, `[...document.querySelectorAll('#pop .ctl-label')].map((l) => l.textContent)`);
      C.soundPop = { tabs: await js(gm, `[...document.querySelectorAll('#pop .sound-tabs .seg-btn')].map((b) => b.textContent.trim())`), labels: {}, engine: await snd() };
      for (const t of ['Chapter', 'Combat', 'Map']) {
        await clickText('#pop .sound-tabs .seg-btn', t);
        await sleep(300);
        C.soundPop.labels[t] = await labels();
        if (t === 'Combat') {
          // 4.3: the speakers, the fight music setting and spell sounds are in Options → Sound
          await clickText('#pop .opt-link', 'Options');
          await sleep(400);
          C.soundPop.options = {
            section: await js(gm, `(() => { const b = document.querySelector('.modal.options .opt-tab.on'); return b && b.textContent.trim(); })()`),
            labels: await js(gm, `[...document.querySelectorAll('.modal.options .ctl-label, .modal.options .opt-h')].map((l) => l.textContent.trim())`),
            looks: await js(gm, `document.querySelectorAll('.modal.options .sfx-row').length`),
            fits: await js(gm, `(() => { const m = document.querySelector('.modal.options').getBoundingClientRect(); const b = document.querySelector('.modal.options .opt-body'); return { bottom: Math.round(m.bottom), h: innerHeight, scrolls: b.scrollHeight > b.clientHeight }; })()`),
          };
          C.soundPop.out = await js(gm, `[...document.querySelectorAll('.modal.options select.sound-out[data-which="music"] option')].map((o) => o.textContent)`);
          C.soundPop.fxOut = await js(gm, `[...document.querySelectorAll('.modal.options select.sound-out[data-which="fx"] option')].map((o) => o.textContent)`);
          await shot(gm, '19o-options-sound');
          await key('Escape');
          await sleep(300);
          C.soundPop.options.closed = await js(gm, `!document.querySelector('.modal.options')`);
          C.soundPop.options.pop = await popTitle();
          // a long panel still ends above the map bar (it scrolls instead): the Fog panel made long
          await js(gm, `Play.openPop('fog')`);
          await sleep(300);
          await js(gm, `document.querySelector('#pop .pop-body').append(Object.assign(document.createElement('div'), { className: 'st-tall', style: 'height:1600px' }))`);
          await sleep(300);
          C.popFits = await js(gm, `(() => { const p = document.querySelector('#pop').getBoundingClientRect(); const r = document.querySelector('#roster').getBoundingClientRect(); return { bottom: Math.round(p.bottom), roster: Math.round(r.top), scrolls: document.querySelector('#pop').scrollHeight > document.querySelector('#pop').clientHeight }; })()`);
          await js(gm, `Play.openPop('sound')`);
          await sleep(300);
        }
      }
      // Add a sound to this map → the library shows what it is picking for, with Cancel
      await clickText('#pop .btn', 'Add a sound to this map');
      await sleep(900);
      const banner = await js(gm, `(() => { const b = document.querySelector('#drawer .drawer-purpose'); return b && { text: b.textContent, cancel: !!b.querySelector('.drawer-cancel') }; })()`);
      await clickSel('#drawer .drawer-cancel');
      await sleep(500);
      C.pickCancel = { banner, drawer: await drawerOpen(), pop: await popTitle(), tab: await soundTab() };
      // pick one: the library closes, the Sound panel is back with the new sound lit
      await clickText('#pop .btn', 'Add a sound to this map');
      await sleep(900);
      await clickText('#drawer .lt-sounds', 'Cave drone');
      await sleep(250);
      const flash = await js(gm, `(() => { const f = document.querySelector('#pop .snd-row.flash'); return f && f.dataset.flash; })()`);
      await sleep(500);
      const ml = L().layers.find((l) => l.role === 'audio');
      await waitFor(async () => (await tracks()).includes('map'));
      await shot(gm, '19n-sound-panel');
      C.pickSound = { drawer: await drawerOpen(), pop: await popTitle(), tab: await soundTab(), flash, layer: ml && ml.id, tracks: await tracks() };
      // volume and mute right in the row; the sound window follows
      await js(gm, `(() => { const i = document.querySelector('#pop input.snd-vol[data-id="${ml.id}"]'); i.value = 0.3; i.dispatchEvent(new Event('input')); })()`);
      await waitFor(async () => { const t = (await snd()).tracks.find((x) => x.key.startsWith('map:')); return t && t.volume === 0.3; });
      const tv = (await snd()).tracks.find((x) => x.key.startsWith('map:'));
      await clickText('#pop .snd-row .icon-btn', `Mute ${ml.name}`);
      await waitFor(async () => { const t = (await snd()).tracks.find((x) => x.key.startsWith('map:')); return t && t.muted; });
      const tm = (await snd()).tracks.find((x) => x.key.startsWith('map:'));
      C.soundRow = { vol: L().layers.find((l) => l.id === ml.id).volume, engineVol: tv && tv.volume, muted: L().layers.find((l) => l.id === ml.id).muted, engineMuted: tm && tm.muted };
      // remove it: the chapter ambience comes back
      await clickText('#pop .snd-row .icon-btn', `Remove ${ml.name}`);
      await waitFor(async () => (await tracks()).includes('amb'));
      C.soundRemove = { layers: L().layers.filter((l) => l.role === 'audio').length, tracks: await tracks() };
      // fight music: picked for the chapter, it starts with a fight and ends with it; the ambience waits underneath
      fs.mkdirSync(lib('Audio/Music'), { recursive: true });
      fs.copyFileSync(lib('Audio/Ambience/Cave drone.ogg'), lib('Audio/Music/Battle drums (test).ogg'));
      await clickText('#pop .sound-tabs .seg-btn', 'Combat');
      await sleep(300);
      await clickText('#pop .btn', 'Choose fight music');
      await sleep(900);
      await clickText('#drawer .lt-sounds', 'Battle drums');
      let fflash = null;
      for (let i = 0; i < 20 && !fflash; i++) { await sleep(60); fflash = await js(gm, `(() => { const f = document.querySelector('#pop .flash'); return f && f.dataset.flash; })()`); }
      await sleep(400);
      const fch = store.chapterOf(lm.id);
      C.fightPick = { music: fch.fight && fch.fight.name, flash: fflash, drawer: await drawerOpen(), pop: await popTitle(), tab: await soundTab() };
      handle('init.start', { mapId: lm.id, list: [{ name: 'Mira', init: 15, pc: true }, { name: 'Goblin', init: 12 }] });
      await waitFor(async () => (await snd()).gains.music < 0.3, 5000);
      const f1 = await snd();
      C.fightOn = { tracks: f1.tracks.map((t) => t.key.split(':')[0]), music: f1.gains.music, playing: (f1.tracks.find((t) => t.key.startsWith('fight:')) || {}).playing, fighting: await js(gm, `Play.state().sound.fighting`) };
      handle('init.end', {});
      await waitFor(async () => (await snd()).gains.music > 0.95, 6000);
      const f2 = await snd();
      C.fightOff = { tracks: f2.tracks.map((t) => t.key.split(':')[0]), music: f2.gains.music };
      // by hand, without a fight
      await js(gm, `Play.ui.soundTab = 'combat'; Play.openPop('sound')`);
      await sleep(300);
      await clickText('#pop .btn', 'Play it now');
      await waitFor(async () => (await tracks()).includes('fight'));
      await sleep(500); // the panel has its new button by now
      const f3 = await tracks();
      await clickText('#pop .btn', 'Stop the fight music');
      await sleep(400);
      C.fightManual = { on: f3, off: await tracks(), state: state.fightNow };
      handle('chapter.fight', { id: fch.id, path: null });
      fs.rmSync(lib('Audio/Music/Battle drums (test).ogg'), { force: true });
      // Quiet under the table preview: everything fades out, and back in
      await clickSel('#table-ctl .tc-quiet');
      await waitFor(async () => (await snd()).gains.master < 0.05, 4000);
      const q1 = { state: state.quiet, master: (await snd()).gains.master, label: await js(gm, `document.querySelector('#table-ctl .tc-quiet').textContent`) };
      await clickSel('#table-ctl .tc-quiet');
      await waitFor(async () => (await snd()).gains.master > 0.95, 4000);
      C.quiet = { on: q1, off: { state: state.quiet, master: (await snd()).gains.master } };
      // where the sound plays: one speaker for the ambience, one for the effects. A speaker that isn't
      // there falls back to the default; Test plays a chime on that speaker
      await js(gm, `window.ts.settings({ soundOut: 'no-such-speaker', soundOutLabel: 'Test speaker', fxOut: 'no-such-fx', fxOutLabel: 'Test fx' })`);
      await sleep(800);
      await js(gm, `App.openOptions('sound')`);
      await sleep(600);
      const tests0 = (await snd()).tests;
      await clickText('.modal.options .sound-out-row .btn', 'Test: Ambience');
      await clickText('.modal.options .sound-out-row .btn', 'Test: Sound effects');
      await sleep(500);
      const so = await snd();
      C.soundOut = { device: so.device, error: !!so.deviceError, fxDevice: so.fxDevice, fxError: !!so.fxDeviceError,
        options: await js(gm, `[...document.querySelectorAll('.modal.options select.sound-out[data-which="music"] option')].map((o) => o.textContent)`),
        fxOptions: await js(gm, `[...document.querySelectorAll('.modal.options select.sound-out[data-which="fx"] option')].map((o) => o.textContent)`),
        tests: { music: so.tests.music - tests0.music, fx: so.tests.fx - tests0.fx } };
      // effects "Same as the ambience": they follow the ambience's speaker
      await js(gm, `window.ts.settings({ soundOut: '', fxOut: null })`);
      await sleep(600);
      const so2 = await snd();
      C.soundOutSame = { device: so2.device, fxDevice: so2.fxDevice, fxError: !!so2.fxDeviceError, fxState: so2.fxState, value: await js(gm, `document.querySelector('.modal.options select.sound-out[data-which="fx"]').value`) };
      await key('Escape');
    }

    // ---------- 8k. 1.3: off the table, rail, Table tabs and picture, Add from PC, real size, preview,
    //            frame-rate watch, screen moments, spell impacts, cues ----------
    {
      const tv = () => W().player;
      const dbg = () => js(tv(), 'window.__table.debug()');
      const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
      await key('Escape'); await key('Escape'); await key('V');
      const lm = L();
      handle('edit.open', { id: lm.id });
      handle('fog.enabled', { mapId: lm.id, enabled: false });
      await sleep(400);
      await js(gm, 'Play.view().fit()');
      await sleep(300);

      // --- the rail: Move map lives in Build (M works while it is folded), Select in Play; the pin keeps Build open
      const folded = () => js(gm, `document.querySelector('.g-build').classList.contains('folded')`);
      const f0 = await folded();
      await key('M');
      await sleep(300);
      const mKey = { tool: await js(gm, 'document.body.dataset.tool'), folded: await folded() };
      await key('Escape'); await key('V');
      await sleep(200);
      const f1 = await folded();
      await clickSel('.rail-btn[data-id="build"]'); // unfold, then pin it open
      await sleep(200);
      await clickSel('.rail-pin');
      await sleep(200);
      await key('V'); // another tool: pinned, Build stays open
      await sleep(200);
      const pinned = { folded: await folded(), on: await js(gm, `document.querySelector('.rail-pin').classList.contains('on')`), saved: await js(gm, `localStorage.getItem('foldBuild')`) };
      await shot(gm, '19p-rail-pinned');
      await clickSel('.rail-pin');
      await sleep(200);
      C.rail13 = { f0, mKey, f1, pinned, unpinned: await folded() };

      // --- off the table: a token and a torch beyond the TV's edge; the GM sees them dimmed, can click them,
      //     Layers marks them, Show zooms out to them, Bring here, Remove all off the table
      const gob = lm.layers.find((l) => l.role === 'token' && !l.hidden);
      const tr = await js(gm, 'Play.view().tableRectInMap()');
      const offX = r2(tr.x - 4); // 4 inches beyond the left edge of the TV
      const offY = r2(tr.y + tr.h / 2);
      handle('layer.update', { id: gob.id, x: offX, y: offY });
      const torch = handle('fx.add', { kind: 'emitter', preset: 'torch', x: r2(tr.x + tr.w + 3), y: r2(tr.y + tr.h - 3), r: 0.6 });
      await sleep(500);
      await key('K');
      await sleep(500);
      const layersOff = { head: await js(gm, `(() => { const e = document.querySelector('#pop .off-head'); return e && e.textContent; })()`), badges: await js(gm, `document.querySelectorAll('#pop .off-badge').length`), bring: await js(gm, `document.querySelectorAll('#pop .off-bring').length`), list: await js(gm, 'Play.offTable().map((o) => o.kind)') };
      await shot(gm, '19q-layers-off-table');
      const camBefore = await js(gm, 'Play.view().cam.s');
      await clickText('#pop .off-head .btn', 'Show');
      await sleep(500);
      const camAfter = await js(gm, 'Play.view().cam.s');
      await shot(gm, '19r-show-everything');
      // the token beyond the edge can be clicked like any other: select it, Delete removes it (undo brings it back)
      await key('Escape');
      await key('V');
      const gp = await scr(offX, offY);
      const inView = await js(gm, `(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); return ${gp.x} > r.left && ${gp.x} < r.right && ${gp.y} > r.top && ${gp.y} < r.bottom; })()`);
      await click(gp.x, gp.y);
      await sleep(300);
      const picked = await js(gm, 'Play.ui.selected');
      await key('Delete');
      await sleep(400);
      const deleted = !L().layers.some((l) => l.id === gob.id);
      handle('history.undo', { mapId: lm.id });
      await sleep(300);
      C.offTable = { layersOff, camBefore, camAfter, inView, picked: picked === gob.id, deleted, back: L().layers.some((l) => l.id === gob.id) };
      // Bring here, and Remove everything off the table in one undo step
      await key('K');
      await sleep(400);
      await js(gm, `[...document.querySelectorAll('#pop .layer-row.is-off')].find((r) => r.dataset.id === ${JSON.stringify(gob.id)}).querySelector('.off-bring').click()`);
      await sleep(500);
      const brought = { offs: await js(gm, 'Play.offTable().map((o) => o.id)'), x: L().layers.find((l) => l.id === gob.id).x };
      const fxBefore = L().fx.length;
      await clickText('#pop .off-head .btn', 'Remove');
      await sleep(500);
      const removed = { fx: L().fx.length, torch: L().fx.some((f) => f.id === torch.selected), offs: await js(gm, 'Play.offTable().length'), head: await js(gm, `!!document.querySelector('#pop .off-head')`) };
      handle('history.undo', { mapId: lm.id });
      await sleep(300);
      C.offTable2 = { brought, gobOn: !brought.offs.includes(gob.id), fxBefore, removed, undone: L().fx.some((f) => f.id === torch.selected) };
      handle('fx.remove', { mapId: lm.id, id: torch.selected });
      await key('Escape');
      await js(gm, 'Play.view().fit()');

      // --- 4.3: Options (was the Table menu), its sections down the side; Picture for this TV with a test picture
      await clickSel('.rail-btn[data-id="table"]');
      await sleep(400);
      const tabNames = await js(gm, `[...document.querySelectorAll('.modal.options .opt-tab')].map((b) => b.textContent.trim())`);
      const optRail = await js(gm, `(() => { const b = document.querySelector('.rail-btn[data-id="table"]'); return b && (b.getAttribute('aria-label') || b.textContent).trim(); })()`);
      const tabLabels = {};
      for (const t of ['TV', 'Seating', 'Performance', 'This screen', 'Library', 'Picture']) {
        await clickText('.modal.options .opt-tab', t);
        await sleep(350);
        tabLabels[t] = await js(gm, `[...document.querySelectorAll('.modal.options .opt-body .ctl-label')].map((l) => l.textContent.trim())`);
      }
      const slide = (label, v) => js(gm, `(() => { const i = [...document.querySelectorAll('.modal.options input[type=range]')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); i.value = ${v}; i.dispatchEvent(new Event('input')); return true; })()`);
      await slide('Brightness', 1.25);
      await slide('Contrast', 1.1);
      await sleep(500);
      const simple = (await dbg()).picture;
      await slide('Gamma', 1.4);
      await slide('Warmth', 0.5);
      await sleep(500);
      const svg = (await dbg()).picture;
      const tvKey = await js(gm, 'Play.state().view.tvKey');
      const saved = await js(gm, 'Play.state().settings.picture');
      // 4.3.1: no test pattern any more, the reference picture only; what to look for is behind the "?"
      const testOn = await js(gm, `![...document.querySelectorAll('.modal.options .seg-btn, .modal.options .ctl-label')].some((b) => /Test pattern/.test(b.textContent))`);
      await clickText('.modal.options .ctl-toggle', 'Reference picture');
      await sleep(1200);
      await shot(gm, '19t-table-picture');
      const refDbg = await dbg();
      const qp = await js(gm, `(() => { const r = document.querySelector('.modal.options .opt-headrow .help-q').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await mouse('mouseMove', qp.x - 30, qp.y + 40);
      await mouse('mouseMove', qp.x, qp.y);
      await sleep(250);
      const reference = { on: refDbg.testPicture, loaded: refDbg.refLoaded, state: state.testPicture, hint: await js(gm, `/black box/.test((document.querySelector('.help-pop') || {}).textContent || '')`) };
      await mouse('mouseMove', qp.x - 300, qp.y + 300);
      await shot(tv(), '19u-table-reference-picture');
      await clickText('.modal.options .opt-tab', 'Seating'); // leaving the section takes the test picture away
      await sleep(500);
      const testOff = (await dbg()).testPicture;
      await clickText('.modal.options .opt-tab', 'Picture');
      await sleep(300);
      await clickText('.modal.options .btn', 'Reset');
      await sleep(500);
      C.tableTabs = { tabNames, optRail, tabLabels, simple, svg, tvKey, saved, testOn, testOff, reference, reset: (await dbg()).picture.filter };
      await key('Escape');

      // --- Add from PC: files from elsewhere are copied into the library (with their walls file), not twice
      const outside = path.join(dir, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      const demoPng = lib('Maps/Static/Demo dungeon.png');
      fs.copyFileSync(demoPng, path.join(outside, 'Old hall.png'));
      fs.writeFileSync(path.join(outside, 'Old hall.json'), JSON.stringify({ name: 'Old hall', width: 1920, height: 1080, grid: { size: 54 }, padding: 0, walls: [{ c: [0, 0, 540, 0] }, { c: [540, 0, 540, 540], door: 1 }] }));
      fs.copyFileSync(demoPng, path.join(outside, 'Arena 36x20.png'));
      fs.copyFileSync(demoPng, path.join(outside, 'Plain hall.png'));
      const imp = await js(gm, `window.ts.library('import', { files: ${JSON.stringify([path.join(outside, 'Old hall.png'), path.join(outside, 'Arena 36x20.png')])}, cat: 'maps' })`);
      const again = await js(gm, `window.ts.library('import', { files: ${JSON.stringify([path.join(outside, 'Old hall.png')])}, cat: 'maps' })`);
      C.addFromPc = { ok: imp.ok, rels: imp.items.map((i) => i.rel), copied: imp.copied, walls: imp.walls, wallsFile: fs.existsSync(lib('Maps/Static/Old hall.json')), again: { copied: again.copied, rel: again.items[0].rel }, files: fs.readdirSync(lib('Maps/Static')).filter((f) => /Old hall|Arena/.test(f)) };
      // from the library's Add map: the drawer picks for a new map, files added from the PC become new maps
      const ch1 = store.chapterOf(lm.id);
      const mapsBefore = store.allMapIds().length;
      await js(gm, `Play.Drawer.open({ filter: 'maps', purpose: 'newMap', chapterId: ${JSON.stringify(ch1.id)} })`);
      await sleep(700);
      C.addFromPc.button = await js(gm, `!!document.querySelector('#drawer .lib-add')`);
      await js(gm, `Play.Drawer.addFromPc(${JSON.stringify([path.join(outside, 'Plain hall.png')])})`);
      await waitFor(async () => store.allMapIds().length > mapsBefore, 4000);
      await sleep(2500); // the new map loads and is measured
      const plain = E();
      C.realImage = { added: store.allMapIds().length - mapsBefore, name: plain.name, drawer: await js(gm, `!!document.querySelector('#drawer.on')`), rel: plain.bg && plain.bg.rel,
        scale: plain.bg && plain.bg.scale, grid: plain.grid, zoom: plain.view.zoom, how: await js(gm, 'Play.ui.realSize && Play.ui.realSize.how'), toast: await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`) };
      await shot(gm, '19u-real-size');
      const arena = imp.items.find((i) => /Arena/.test(i.name));
      handle('map.add', { chapterId: ch1.id, path: arena.path });
      await sleep(2500);
      const ar = E();
      C.realName = { scale: ar.bg && ar.bg.scale, grid: ar.grid, how: await js(gm, 'Play.ui.realSize && Play.ui.realSize.how'), cols: await js(gm, 'Play.ui.realSize && Play.ui.realSize.cols') };
      const oh = imp.items.find((i) => /Old hall/.test(i.name));
      handle('map.add', { chapterId: ch1.id, path: oh.path });
      await sleep(1500);
      C.realWalls = { walls: E().walls.length, span: E().bg && E().bg.span };
      for (const id of [plain.id, ar.id, E().id]) handle('map.remove', { id });
      handle('edit.open', { id: lm.id });
      for (const f of ['Old hall.png', 'Old hall.json', 'Arena 36x20.png', 'Plain hall.png']) fs.rmSync(lib(`Maps/Static/${f}`), { force: true });
      await sleep(800);

      // --- the table preview: drag its corner for a bigger one; double-click for a big floating one
      const tc = () => js(gm, `Math.round(document.querySelector('#table-ctl').getBoundingClientRect().width)`);
      const w0 = await tc();
      const grip = await rect('#table-ctl .tc-grip');
      await mouse('mouseMove', grip.cx, grip.cy);
      await dragPath({ x: grip.cx, y: grip.cy }, { x: grip.cx - 150, y: grip.cy + 40 }, 8);
      await sleep(2600);
      const w1 = await tc();
      const nat1 = await js(gm, `document.querySelector('#tc-preview').naturalWidth`);
      await shot(gm, '19v-preview-medium');
      const pv = await rect('#tc-preview');
      gm.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(pv.cx), y: Math.round(pv.cy), button: 'left', clickCount: 1 });
      gm.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(pv.cx), y: Math.round(pv.cy), button: 'left', clickCount: 1 });
      gm.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(pv.cx), y: Math.round(pv.cy), button: 'left', clickCount: 2 });
      gm.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(pv.cx), y: Math.round(pv.cy), button: 'left', clickCount: 2 });
      await sleep(2200);
      const big = await js(gm, `(() => { const i = document.querySelector('.fp[data-id="preview"] .big-preview'); return i && { w: Math.round(i.getBoundingClientRect().width), nat: i.naturalWidth }; })()`);
      const tablePopAfterDbl = await js(gm, `!!document.querySelector('#pop.on')`);
      await shot(gm, '19w-preview-big');
      await js(gm, `Play.Floats.hide('preview')`);
      await js(gm, 'Play.setPreviewWidth(212)');
      await sleep(300);
      C.preview = { w0, w1, nat1, big, tablePopAfterDbl, w2: await tc(), saved: await js(gm, `localStorage.getItem('previewW')`) };

      // --- frame-rate watch: when the TV stays slow it asks; Switch makes that map lighter, Not now leaves it
      await js(gm, `window.ts.settings({ fpsWatch: true })`);
      await sleep(300);
      for (let i = 0; i < 6; i++) await js(gm, `Play.simFps({ fps: 24, hitches: 5, heavy: 'Rain' })`);
      await sleep(300);
      const ask = await js(gm, `(() => { const b = document.querySelector('.fps-ask'); return b && b.textContent; })()`);
      await shot(gm, '19x-fps-ask');
      await clickText('.fps-ask .btn', 'Switch to Medium');
      await sleep(900);
      const lighter = { map: (await js(gm, 'Play.state().settings.mapQuality'))[lm.id], tv: (await dbg()).quality.level, base: await js(gm, 'Play.state().settings.quality') };
      await clickSel('.rail-btn[data-id="table"]');
      await sleep(300);
      await clickText('.modal.options .opt-tab', 'Performance');
      await sleep(400);
      const line = await js(gm, `(() => { const e = document.querySelector('.modal.options .map-quality'); return e && !e.hidden ? e.textContent : null; })()`);
      await clickText('.modal.options .map-quality .btn', 'Back to normal');
      await sleep(800);
      const back = (await dbg()).quality.level;
      await key('Escape');
      for (let i = 0; i < 6; i++) await js(gm, `Play.simFps({ fps: 24, hitches: 5 })`);
      await sleep(300);
      await clickText('.fps-ask .btn', 'Not now');
      for (let i = 0; i < 6; i++) await js(gm, `Play.simFps({ fps: 24, hitches: 5 })`);
      await sleep(300);
      const askedAgain = await js(gm, `!!document.querySelector('.fps-ask')`);
      await js(gm, `window.ts.settings({ fpsWatch: false })`);
      C.fpsWatch = { ask, lighter, line, back, askedAgain };

      // --- screen moments: the Toolbox panel, one click plays on the TV (with its sound); some stay until stopped
      await key('Q');
      await sleep(400);
      await clickText('#pop .tb-tile', 'Screen effects');
      await sleep(600);
      const rows = await js(gm, `[...document.querySelectorAll('.fp[data-id="moments"] .mo-row')].map((r) => r.dataset.id)`);
      const board0 = (await snd()).board.length;
      await clickText('.fp[data-id="moments"] .mo-row', 'Earthquake');
      await sleep(700);
      const quake = { state: state.moments.map((m) => m.id), tv: (await dbg()).moments };
      await waitFor(async () => (await snd()).board.length > board0, 3000);
      quake.sound = (await snd()).board.slice(board0);
      await shot(tv(), '19y-table-earthquake');
      await sleep(3200);
      quake.after = (await dbg()).moments;
      // poison gas stays until clicked again; the table controls show it with a stop button
      await clickText('.fp[data-id="moments"] .mo-row', 'Poison gas');
      await sleep(3000);
      const gas = { tv: (await dbg()).moments, hud: await js(gm, `[...document.querySelectorAll('#table-ctl .hud-moment')].map((r) => r.textContent)`), row: await js(gm, `document.querySelector('.fp[data-id="moments"] .mo-row[data-id="gas"]').classList.contains('on')`) };
      await shot(tv(), '19z-table-gas');
      await shot(gm, '20a-moments-panel');
      await clickText('.fp[data-id="moments"] .mo-row', 'Poison gas');
      await sleep(2000);
      gas.stopped = { state: state.moments.filter((m) => m.id === 'gas').length, tv: (await dbg()).moments.drawn };
      // time stop: grey and still
      await clickText('.fp[data-id="moments"] .mo-row', 'Time stop');
      await sleep(900);
      const still = (await dbg()).moments;
      await clickSel('#table-ctl .hud-moment .icon-btn');
      await sleep(1900);
      const stillOff = (await dbg()).moments;
      // at a spot: the target button, then a click on the map
      await js(gm, `document.querySelector('.fp[data-id="moments"] .mo-row[data-id="explosion"] .mo-spot').click()`);
      await sleep(250);
      const aimBar = await js(gm, `(() => { const b = document.querySelector('#topbar.on'); return b && b.textContent; })()`);
      const sp = await scr(8, 6);
      await click(sp.x, sp.y);
      await sleep(400);
      const boom = state.moments.find((m) => m.id === 'explosion');
      const spot = { aimBar, x: boom && boom.x, y: boom && boom.y, tv: (await dbg()).moments.drawn };
      await shot(tv(), '20b-table-explosion');
      // a star puts it on top and on Shift + a number
      await js(gm, `document.querySelector('.fp[data-id="moments"] .mo-row[data-id="nat20"] .sb-star').click()`);
      await sleep(500);
      const stars = await js(gm, 'Play.state().settings.momentStars');
      await sleep(2200);
      gm.webContents.focus();
      await key('5', ['shift']);
      await sleep(400);
      const shift = state.moments.filter((m) => !m.stop).map((m) => m.id);
      // its own sound from the library: picked in the library, the panel comes back with the row lit
      fs.mkdirSync(lib('Audio/SFX'), { recursive: true });
      fs.copyFileSync(lib('Audio/SFX/Thunder.ogg'), lib('Audio/SFX/Big explosion.ogg'));
      await js(gm, `document.querySelector('.fp[data-id="moments"] .mo-row[data-id="earthquake"] .mo-snd').click()`);
      await sleep(300);
      await clickText('#menu .menu-item', 'Choose a sound from the library');
      await sleep(900);
      const banner = await js(gm, `(() => { const b = document.querySelector('#drawer .drawer-purpose'); return b && b.textContent; })()`);
      await clickText('#drawer .lt-sounds', 'Bell');
      await sleep(700);
      const own = { banner, set: await js(gm, `Play.state().settings.momentSounds.earthquake`), drawer: await js(gm, `!!document.querySelector('#drawer.on')`), panel: await js(gm, `!!document.querySelector('.fp[data-id="moments"]')`) };
      const b1 = (await snd()).board.length;
      handle('moment.play', { id: 'earthquake' });
      handle('moment.play', { id: 'explosion' }); // a fitting name in Audio/SFX plays instead of the built-in sound
      await waitFor(async () => (await snd()).board.length >= b1 + 2, 4000);
      own.board = (await snd()).board.slice(b1);
      await js(gm, `window.ts.settings({ momentSound: { id: 'earthquake', path: null } })`);
      fs.rmSync(lib('Audio/SFX/Big explosion.ogg'), { force: true });
      handle('moment.stop', {});
      C.moments = { rows, quake, gas, still, stillOff, spot, stars, shift, own };
      await js(gm, `Play.Floats.hide('moments')`);

      // --- a spell can play a moment where it lands
      await sleep(1500);
      await key('A');
      await sleep(300);
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop select')].find((x) => x.getAttribute('aria-label') === 'Screen effect when cast'); s.value = 'explosion'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(200);
      await searchSpell('Fireball');
      await sleep(200);
      const fp = await scr(12, 8);
      const n0 = state.moments.length;
      await click(fp.x, fp.y);
      await sleep(700);
      const imp2 = state.moments.slice(n0).find((m) => m.id === 'explosion');
      C.spellImpact = { added: !!imp2, x: imp2 && imp2.x, y: imp2 && imp2.y, impact: await js(gm, 'Play.ui.spell.impact') };
      await js(gm, `Play.setSpell({ impact: null })`);
      handle('spell.clear', { mapId: lm.id });
      await key('Escape'); await key('V');

      // --- cues: save the scene, change it, F1 brings it back (light, weather, which effects are on); Undo takes it back
      await sleep(1200);
      const mood0 = { darkness: L().light.darkness, weather: L().weather.layers.length };
      handle('light.update', { mapId: lm.id, darkness: 0.6 });
      handle('weather.preset', { mapId: lm.id, name: 'Rain', layers: [{ type: 'rain' }] });
      const smoke = L().fx.find((f) => f.kind === 'emitter');
      handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: true });
      await sleep(300);
      // (2.1: snapshots took the cues' place; cues made before still play, F1 too while the map has no snapshots)
      const cue = handle('cue.save', { name: 'Storm in the hall' }).ok ? (store.cur.meta.cues || [])[0] : null;
      handle('cue.update', { id: cue.id, moment: 'nat20' }); // picking a moment switches that part on
      await js(gm, 'Play.Snaps.openFor(null)');
      await sleep(600);
      await js(gm, `(() => { const d = document.querySelector('.fp[data-id="snaps"] .snap-older details'); if (d) d.open = true; })()`);
      await sleep(200);
      await shot(gm, '20c-cues');
      handle('light.update', { mapId: lm.id, darkness: 0 });
      handle('weather.preset', { mapId: lm.id, name: 'None', layers: [] });
      handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: false });
      await sleep(400);
      gm.webContents.focus();
      await key('F1');
      await sleep(900);
      const played = { darkness: L().light.darkness, weather: L().weather.layers.map((l) => l.type), smokeHidden: L().fx.find((f) => f.id === smoke.id).hidden, moment: state.moments.filter((m) => !m.stop).map((m) => m.id) };
      await key('z', ['control']);
      await sleep(600);
      const undone = { darkness: L().light.darkness, weather: L().weather.layers.length, smokeHidden: L().fx.find((f) => f.id === smoke.id).hidden };
      C.cues = { saved: cue && { name: cue.name, slot: cue.slot, parts: cue.parts, data: { darkness: cue.data.light.darkness, weather: cue.data.weather.layers.length, smoke: cue.data.fx[smoke.id] } },
        momentPart: store.cur.meta.cues[0].parts.moment && store.cur.meta.cues[0].data.moment, played, undone, rows: await js(gm, `document.querySelectorAll('.fp[data-id="snaps"] .snap-older .cue-chip').length`) };
      handle('light.update', { mapId: lm.id, darkness: mood0.darkness });
      handle('weather.preset', { mapId: lm.id, name: 'None', layers: [] });
      handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: false });
      handle('moment.stop', {});
      handle('cue.remove', { id: cue.id });
      await js(gm, `Play.Floats.closeAll()`);
      handle('fog.enabled', { mapId: lm.id, enabled: true });
      await key('Escape'); await key('V');
      await sleep(400);
    }

    // ---------- 8l. 1.4: undo and redo on top of the rail, Cues in Build, wall corners, the Party, Spotify ----------
    {
      const tv = () => W().player;
      const dbg = () => js(tv(), 'window.__table.debug()');
      const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
      await key('Escape'); await key('Escape'); await key('V');
      const lm = L();
      handle('edit.open', { id: lm.id });
      handle('fog.enabled', { mapId: lm.id, enabled: false });
      await sleep(400);
      await js(gm, 'Play.view().fit()');
      await sleep(300);

      // --- the rail: undo and redo on top (they say what they take back), Cues in Build, Campaigns and Table full size
      const railInfo = await js(gm, `(() => { const r = document.getElementById('rail'); const b = (id) => r.querySelector('.rail-btn[data-id="' + id + '"]'); return {
        top: r.firstElementChild.className, undo: !!b('undo'), redo: !!b('redo'), cuesIn: Play.TB.PANELS.some((x) => x.id === 'snaps') && !b('snaps') ? 'toolbox' : b('snaps') ? b('snaps').closest('.rail-group').dataset.group : null,
        homeBig: !b('home').classList.contains('small'), tableBig: !b('table').classList.contains('small'), keysBig: !b('help').classList.contains('small'),
        partyIn: b('party') ? b('party').closest('.rail-group').dataset.group : null, fits: r.scrollHeight <= r.clientHeight + 1, h: Math.round(b('select').getBoundingClientRect().height) }; })()`);
      handle('light.update', { mapId: lm.id, darkness: 0.25 });
      await sleep(300);
      const undoTip = await js(gm, `document.querySelector('.rail-btn[data-id="undo"]').dataset.tip`);
      await clickSel('.rail-btn[data-id="undo"]');
      await sleep(400);
      const undone = L().light.darkness;
      const redoTip = await js(gm, `document.querySelector('.rail-btn[data-id="redo"]').dataset.tip`);
      await clickSel('.rail-btn[data-id="redo"]');
      await sleep(400);
      const redone = L().light.darkness;
      handle('light.update', { mapId: lm.id, darkness: 0 });
      await sleep(200);
      await key('Q'); await sleep(300);
      await clickSel('#pop .tb-tile[data-id="snaps"]'); // 4.5: Snapshots live in the Toolbox
      await sleep(400);
      const cuesPanel = await js(gm, `!!document.querySelector('.fp[data-id="snaps"]')`);
      const calm = handle('snap.save', { name: 'Calm' }); // 2.2: no snapshot buttons under the preview any more: F1, the hotbar, the panel
      await sleep(400);
      const chips = await js(gm, `[...document.querySelectorAll('#table-ctl .cue-chip, #table-ctl .tc-cues')].map((x) => x.textContent)`);
      handle('light.update', { mapId: lm.id, darkness: 0.5 });
      handle('snap.update', { id: calm.id, name: 'Calm' });
      await sleep(200);
      // the map changed since Calm: F1 at the table switches at once and offers to keep the changes
      gm.webContents.focus();
      await key('F1');
      await sleep(900);
      const chipPlayed = L().light.darkness;
      // 2.5: it asks and waits for an answer (Esc does not close it)
      const keepOffer = await js(gm, `(() => { const d = document.querySelector('.modal.snap-keep'); return d ? { title: d.querySelector('h2').textContent, text: d.querySelector('p').textContent, btns: [...d.querySelectorAll('.btn')].map((b) => b.textContent.trim()), focus: document.activeElement && document.activeElement.textContent.trim() } : null; })()`);
      await shot(gm, '20d-rail-undo-cues');
      await key('Escape');
      keepOffer.stillOpen = await js(gm, `!!document.querySelector('.modal.snap-keep')`);
      if (keepOffer.stillOpen) await clickText('.modal.snap-keep .btn', 'Save into Calm');
      await sleep(600);
      keepOffer.kept = ((L().snaps || []).find((x) => x.id === calm.id) || { data: { light: {} } }).data.light.darkness;
      keepOffer.closed = !(await js(gm, `!!document.querySelector('.modal.snap-keep')`));
      // 4.3: kept: playing the same snapshot again does not ask again (it kept asking, however often you saved)
      keepOffer.again = [];
      for (let i = 0; i < 3; i++) {
        await key('F1');
        await sleep(800);
        const asked = await js(gm, `!!document.querySelector('.modal.snap-keep')`);
        keepOffer.again.push(asked);
        if (asked) await clickText('.modal.snap-keep .btn', 'Throw them away');
      }
      await js(gm, `Play.Floats.closeAll()`);
      handle('snap.remove', { id: calm.id });
      handle('light.update', { mapId: lm.id, darkness: 0 });
      // Effects → Light → Scene light: "Change over" lights up when clicked (and is remembered)
      await key('E');
      await sleep(300);
      await clickText('#pop .seg-btn', 'Light');
      await sleep(200);
      await clickText('#pop .seg-btn', 'Map light');
      await sleep(250);
      await clickText('#pop .seg-btn', 'At once');
      await sleep(150);
      const changeOver = { on: await js(gm, `[...document.querySelectorAll('#pop .seg-btn.on')].map((b) => b.textContent.trim()).filter((t) => /At once|10 seconds/.test(t))`), saved: await js(gm, `localStorage.getItem('moodFade')`) };
      await clickText('#pop .seg-btn', '10 seconds');
      await sleep(150);
      changeOver.back = await js(gm, `[...document.querySelectorAll('#pop .seg-btn.on')].map((b) => b.textContent.trim()).filter((t) => /At once|10 seconds/.test(t))`);
      await key('Escape'); await key('V');
      C.rail14 = { ...railInfo, undoTip, undone, redoTip, redone, cuesPanel, chips, chipPlayed, keepOffer, changeOver };

      // --- wall corners: drag a corner dot in Walls mode (walls meeting there follow), a click on one starts a new line;
      //     in Edit a whole wall moves (joined walls stretch along); one undo step
      const tr = await js(gm, 'Play.view().tableRectInMap()');
      const g = L().grid.size;
      const cx = tr.x + tr.w * 0.55; const cy = tr.y + tr.h * 0.5;
      const snapC = (x, y) => js(gm, `Geom.snap(Play.state().map.grid, ${x}, ${y}, 2)`); // a grid corner
      const A = await snapC(cx - 3 * g, cy); const B = await snapC(cx + 1 * g, cy); const Cc = await snapC(cx + 1 * g, cy + 3 * g);
      handle('wall.add', { mapId: lm.id, segs: [[A.x, A.y, B.x, B.y], [B.x, B.y, Cc.x, Cc.y]] });
      await sleep(300);
      await key('W');
      await sleep(300);
      await clickText('#pop .wl-modes .seg-btn', 'Walls');
      await sleep(200);
      const w0 = () => L().walls.map((w) => [r2(w.x1), r2(w.y1), r2(w.x2), r2(w.y2)]);
      const bS = await scr(B.x, B.y); const bTo = await scr(B.x + 2 * g, B.y - 2 * g);
      await mouse('mouseMove', bS.x, bS.y);
      await sleep(150);
      let grab = false;
      for (let i = 0; i < 6 && !grab; i++) { await mouse('mouseMove', bS.x + (i % 2), bS.y); await sleep(120); grab = await js(gm, `document.body.classList.contains('wall-grab')`); } // (the hover can come a frame late)
      await mouse('mouseMove', bS.x, bS.y);
      await dragPath(bS, bTo, 10);
      await sleep(300);
      const afterCorner = w0();
      const cS = await scr(Cc.x, Cc.y);
      await click(cS.x, cS.y);
      await sleep(200);
      const chain = await js(gm, `Play.ui.walls.chain && Play.ui.walls.chain.pts.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])`);
      await key('Escape');
      await clickText('#pop .wl-modes .seg-btn', 'Edit');
      await sleep(200);
      const wa = L().walls[0];
      const mS = await scr((wa.x1 + wa.x2) / 2, (wa.y1 + wa.y2) / 2); const mTo = await scr((wa.x1 + wa.x2) / 2, (wa.y1 + wa.y2) / 2 + 2 * g);
      await dragPath(mS, mTo, 10);
      await sleep(300);
      const afterMove = w0();
      await shot(gm, '20e-walls-corners');
      await key('z', ['control']);
      await sleep(400);
      C.wallCorners = { B: [r2(B.x), r2(B.y)], C: [r2(Cc.x), r2(Cc.y)], g: r2(g), grab, afterCorner, chain, afterMove, undone: w0() };
      handle('wall.clear', { mapId: lm.id });
      await key('Escape'); await key('V');

      // --- the Party (Play, U): on the map, arrow keys one square, click where it goes, carried light and darkvision on the TV
      await key('U');
      await sleep(300);
      const partyRail = await js(gm, `document.querySelector('.rail-btn[data-id="party"]').classList.contains('is-tool')`);
      // armed: Esc puts it away without placing anything; armed again, a click puts it down
      await clickText('#pop .btn', 'Put the party on the map');
      await sleep(200);
      const armedHint = await js(gm, `(() => { const e = document.querySelector('#pop .party-place-hint'); return e && !e.hidden ? e.textContent : null; })()`);
      await key('Escape');
      await sleep(200);
      const afterEsc = { parties: L().fx.filter((f) => f.preset === 'party').length, pop: await js(gm, `!!document.querySelector('#pop.on')`), placing: await js(gm, 'Play.ui.party.placing') };
      await clickText('#pop .btn', 'Put the party on the map');
      await sleep(200);
      const place = await scr(tr.x + tr.w * 0.3, tr.y + tr.h * 0.5);
      await mouse('mouseMove', place.x, place.y);
      let ghostRing = 0;
      for (let i = 0; i < 10 && !ghostRing; i++) { // the ring follows the mouse on the next frame (slower under load)
        await sleep(120);
        if (i === 4) await mouse('mouseMove', place.x + 1, place.y);
        ghostRing = await js(gm, `(() => { const g = document.querySelector('.party-ghost'); return g && g.style.display !== 'none' ? Math.round(parseFloat(g.style.width)) : 0; })()`);
      }
      await click(place.x, place.y);
      await sleep(700);
      const pf = () => L().fx.find((f) => f.preset === 'party');
      const p0 = { x: pf().x, y: pf().y };
      await key('Right'); await key('Right'); await key('Down');
      await sleep(500);
      const p1 = { x: pf().x, y: pf().y };
      const target = await scr(tr.x + tr.w * 0.6, tr.y + tr.h * 0.45);
      await click(target.x, target.y);
      await sleep(400);
      const p2 = { x: pf().x, y: pf().y };
      const centreOf = await js(gm, `Geom.snap(Play.state().map.grid, ${tr.x + tr.w * 0.6}, ${tr.y + tr.h * 0.45}, 1)`);
      await clickText('#pop .party-pop .tile', 'None');
      await clickText('#pop .seg-btn', '60 ft');
      await sleep(400);
      const set = { carry: pf().carry, bright: pf().bright, dim: pf().dim, dv: pf().darkvision };
      handle('light.update', { mapId: lm.id, darkness: 1 });
      await sleep(1500);
      const near = await js(tv(), `window.__table.sees(${pf().x + 1.5 * g}, ${pf().y})`);
      const far = await js(tv(), `window.__table.sees(${pf().x + 16 * g}, ${pf().y})`);
      await shot(tv(), '20f-table-darkvision');
      await shot(gm, '20g-party-pop');
      C.party14 = { partyRail, armedHint, afterEsc, ghostRing, p0, p1, p2, centre: [r2(centreOf.x), r2(centreOf.y)], g: r2(g), set, near, far, eyes: (await dbg()).vision.eyes };
      handle('light.update', { mapId: lm.id, darkness: 0 });
      // walls only on part of the map, the party beyond them: it still sees the open ground on its other side
      // (1.4 cut the view off just past the outermost wall, and that edge moved along with the party)
      const px = pf().x; const py = pf().y;
      handle('wall.add', { mapId: lm.id, segs: [[px - 10 * g, py - 3 * g, px - 4 * g, py - 3 * g], [px - 4 * g, py - 3 * g, px - 4 * g, py + 3 * g], [px - 10 * g, py - 3 * g, px - 10 * g, py + 3 * g]] });
      handle('vision.update', { mapId: lm.id, on: true });
      await sleep(900);
      C.party14.beyondWalls = { far: await js(tv(), `window.__table.sees(${px + 12 * g}, ${py})`), behind: await js(tv(), `window.__table.sees(${px - 7 * g}, ${py})`), on: (await dbg()).vision.on };
      handle('wall.clear', { mapId: lm.id });
      handle('fx.remove', { mapId: lm.id, id: pf().id });
      await key('Escape'); await key('V');
      await sleep(300);

      // --- Spotify (against a stand-in for Spotify's servers): link with the short how-to, the library, moods,
      //     playing, what plays under the preview, the ambience dips, fight music and a cue from Spotify, unlink
      const mock = await require('./spotify-mock').start();
      process.env.TS_SPOTIFY_API = mock.url; process.env.TS_SPOTIFY_ACCOUNTS = mock.url;
      const http = require('http');
      const get = (url) => new Promise((resolve, reject) => http.get(url, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: b })); }).on('error', reject));
      await js(gm, `window.ts.settings({ spotify: { volume: null } })`);
      // 1.4.2: all of Spotify is in the Toolbox: an empty panel with Connect Spotify, then the three steps
      const P = '.fp[data-id="spotify"]';
      const soundTabs = await (async () => { await js(gm, `Play.openPop('sound')`); await sleep(300); const t = await js(gm, `[...document.querySelectorAll('#pop .sound-tabs .seg-btn')].map((b) => b.textContent.trim())`); await key('Escape'); return t; })();
      await key('Q');
      await sleep(300);
      await clickText('#pop .tb-tile', 'Spotify');
      await sleep(600);
      const empty = { text: await js(gm, `(() => { const e = document.querySelector('${P} .sp-empty'); return e && e.textContent; })()`), steps: await js(gm, `document.querySelectorAll('${P} .sp-steps li').length`) };
      await shot(gm, '20h0-spotify-empty');
      await clickText(`${P} .btn`, 'Connect Spotify');
      await sleep(500);
      const setup = { soundTabs, empty, steps: await js(gm, `document.querySelectorAll('${P} .sp-steps li').length`), uri: await js(gm, `document.querySelector('${P} .sp-uri code').textContent`),
        buttons: await js(gm, `[...document.querySelectorAll('${P} .sp-setup .btn')].map((b) => b.textContent.trim())`), dashboard: (await js(gm, `window.ts.spotify('open', { what: 'dashboard' })`)).url };
      await shot(gm, '20h-spotify-setup');
      await js(gm, `(() => { const i = document.querySelector('${P} .sp-client'); i.value = 'not-an-id'; })()`);
      await clickText(`${P} .sp-setup .btn`, 'Link Spotify');
      await sleep(400);
      setup.badId = await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
      await js(gm, `(() => { const i = document.querySelector('${P} .sp-client'); i.value = '0123456789abcdef0123456789abcdef'; })()`);
      await clickText(`${P} .sp-setup .btn`, 'Link Spotify');
      await sleep(700);
      setup.waiting = await js(gm, `(() => { const e = document.querySelector('${P} .sp-wait'); return e && e.textContent; })()`);
      const auth = (await js(gm, `window.ts.spotify('debug')`)).lastAuthUrl;
      const a1 = await get(auth);
      const a2 = await get(a1.location);
      await waitFor(async () => (await js(gm, 'Play.state().spotify.linked')), 3000);
      await sleep(900);
      const sp = await js(gm, 'Play.state().spotify');
      // linked: the player with the volume; the settings fold out behind the gear
      const linkedPanel = { player: await js(gm, `(() => { const e = document.querySelector('${P} .sp-player'); return e && e.textContent; })()`), volume: await js(gm, `!!document.querySelector('${P} .sp-volume input[type=range]')`),
        settingsHidden: await js(gm, `document.querySelector('${P} .sp-settings').hidden`), openBtn: await js(gm, `!!document.querySelector('${P} .sp-player [aria-label="Open Spotify"]')`) };
      await clickSel(`${P} .sp-gear`);
      await sleep(500);
      const linkedView = await js(gm, `document.querySelector('${P} .sp-settings').textContent`);
      linkedPanel.settingsShown = !(await js(gm, `document.querySelector('${P} .sp-settings').hidden`));
      linkedPanel.devices = await js(gm, `[...document.querySelectorAll('${P} .sp-settings select option')].map((o) => o.textContent)`);
      await shot(gm, '20i-spotify-linked');
      await clickSel(`${P} .sp-gear`);
      await sleep(200);
      C.spotifyLink = { setup, linkedPanel, pkce: /code_challenge_method=S256/.test(auth) && /redirect_uri=http%3A%2F%2F127.0.0.1%3A43177%2Fcallback/.test(auth), scope: mock.st.lastScope, redirect: a1.status, page: /Tablescape is linked/.test(a2.body),
        linked: sp.linked, user: sp.user, devices: (sp.devices || []).map((d) => d.name), linkedView: /Linked as Test GM/.test(linkedView), noNull: !/null|undefined/.test(linkedView) };
      const rowsOf = () => js(gm, `[...document.querySelectorAll('${P} .sp-list .sp-row')].map((r) => r.querySelector('.sp-text span').textContent)`);
      const ask = async (text) => { await sleep(250); await js(gm, `(() => { const i = document.querySelector('.modal-back input'); i.value = ${JSON.stringify(text)}; document.querySelector('.modal-back form').requestSubmit(); })()`); await sleep(500); };
      const lib = { playlists: await rowsOf() };
      await clickSel(`${P} .sp-mood-new`);
      await ask('Battle');
      await clickText(`${P} .sp-tabs .seg-btn`, 'Liked');
      await sleep(800);
      lib.liked = await rowsOf();
      for (const song of ['Dragon Fight', 'Steel']) {
        if (!lib.liked.some((n) => n.includes(song))) continue;
        await js(gm, `[...document.querySelectorAll('${P} .sp-row')].find((r) => r.textContent.includes(${JSON.stringify(song)})).querySelector('.sp-add').click()`);
        await sleep(250);
        await clickText('#menu .menu-item', 'Battle');
        await sleep(400);
      }
      await js(gm, `[...document.querySelectorAll('${P} .sp-row')].find((r) => r.textContent.includes('Tavern Jig')).querySelector('.sp-add').click()`);
      await sleep(250);
      await clickText('#menu .menu-item', 'Battle');
      await sleep(400);
      await clickText(`${P} .sp-tabs .seg-btn`, 'Playlists');
      await sleep(500);
      await js(gm, `[...document.querySelectorAll('${P} .sp-row')].find((r) => r.textContent.includes('Tavern Folk')).querySelector('.sp-add').click()`);
      await sleep(250);
      await clickText('#menu .menu-item', 'New mood');
      await ask('Tavern');
      await js(gm, `[...document.querySelectorAll('${P} .sp-row')].find((r) => r.textContent.includes('Battle Epic')).querySelector('[aria-label^="Songs of"]').click()`);
      await sleep(800);
      lib.songs = await rowsOf();
      await clickSel(`${P} .sp-back`);
      await clickText(`${P} .sp-tabs .seg-btn`, 'Search');
      await sleep(200);
      await js(gm, `(() => { const i = document.querySelector('${P} .sp-search'); i.value = 'dragon'; i.dispatchEvent(new Event('input')); })()`);
      await sleep(1200);
      lib.search = await rowsOf();
      lib.searchLimit = mock.st.searchLimit;
      const moods = await js(gm, 'Play.state().spotify.moods');
      lib.moods = moods.map((m) => [m.name, m.items.map((i) => i.name)]);
      await shot(gm, '20j-spotify-panel');
      // play a mood: on the laptop's Spotify, faded in; what plays shows under the preview; the ambience dips
      const plays0 = mock.st.plays.length;
      await js(gm, `[...document.querySelectorAll('${P} .sp-mood')].find((m) => m.textContent.includes('Battle')).querySelector('.sp-mood-main').click()`);
      await waitFor(async () => mock.st.plays.length > plays0, 4000);
      await sleep(1800);
      const played = mock.st.plays[mock.st.plays.length - 1];
      const now = await js(gm, `document.querySelector('#table-ctl .tc-spotify').textContent`);
      await waitFor(async () => (await snd()).gains.music < 0.6, 5000); // the ambience glides down under the music
      const gain = (await snd()).gains.music;
      await shot(gm, '20k-spotify-playing');
      await js(gm, `document.querySelector('#table-ctl .tc-spotify [aria-label="Pause Spotify"]').click()`);
      await sleep(1600);
      const paused = { playing: mock.st.playing, pauses: mock.st.pauses };
      await sleep(3200);
      const gainAfter = (await snd()).gains.music;
      C.spotifyPlay = { lib, uris: played && played.uris, device: played && played.device, volumes: mock.st.volumes.slice(0, 2), now, gain, paused, gainAfter };
      // Ctrl + 1 plays the first mood; Quiet fades Spotify out and brings it back after
      const plays3 = mock.st.plays.length;
      gm.webContents.focus();
      await key('1', ['control']);
      await waitFor(async () => mock.st.plays.length > plays3, 4000);
      await sleep(1500);
      const ctrl1 = { played: mock.st.plays.length - plays3, mood: await js(gm, 'Play.state().spotify.playingMood') === moods[0].id, playing: mock.st.playing };
      // the volume: the slider in the Spotify panel sets Spotify's volume (and moods fade in to it); the mouse wheel on the row under the preview too
      await js(gm, `Play.TB.openPanel('spotify')`);
      await sleep(500);
      await js(gm, `(() => { const i = document.querySelector('.fp[data-id="spotify"] .sp-volume input[type=range]'); i.value = 35; i.dispatchEvent(new Event('input')); })()`);
      await waitFor(async () => mock.st.volume === 35, 3000);
      await sleep(300);
      const vol = { slider: mock.st.volume, saved: await js(gm, 'Play.state().spotify.volume') };
      await js(gm, `document.querySelector('#table-ctl .tc-spotify').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
      await waitFor(async () => mock.st.volume === 40, 3000);
      vol.wheel = mock.st.volume;
      await js(gm, `Play.Floats.hide('spotify')`);
      const pausesQ = mock.st.pauses;
      await clickSel('#table-ctl .tc-quiet');
      await waitFor(async () => mock.st.pauses > pausesQ, 4000);
      const quietOn = { paused: !mock.st.playing, quiet: state.quiet };
      await sleep(600);
      const playsQ = mock.st.calls.filter((x) => x === 'PUT /v1/me/player/play').length;
      await clickSel('#table-ctl .tc-quiet');
      await waitFor(async () => mock.st.playing, 4000);
      await sleep(800);
      const quietOff = { playing: mock.st.playing, resumed: mock.st.calls.filter((x) => x === 'PUT /v1/me/player/play').length - playsQ, volume: mock.st.volume, quiet: state.quiet };
      await js(gm, `window.ts.spotify('stop', {})`);
      await sleep(600);
      C.spotifyKeys = { ctrl1, vol, quietOn, quietOff };
      // fight music from Spotify (Sound → Combat), and a cue that starts a mood
      await js(gm, `Play.Floats.closeAll()`);
      await js(gm, `Play.openPop('sound')`);
      await sleep(200);
      await clickText('#pop .sound-tabs .seg-btn', 'Combat');
      await sleep(300);
      const tav = moods.find((m) => m.name === 'Tavern');
      await js(gm, `(() => { const s = [...document.querySelectorAll('#pop select')].find((x) => x.getAttribute('aria-label') === 'Fight music from Spotify'); s.value = ${JSON.stringify(tav.id)}; s.dispatchEvent(new Event('change')); })()`);
      await sleep(400);
      const ch = store.chapterOf(lm.id);
      const plays1 = mock.st.plays.length;
      handle('sound.fight', { on: true });
      await waitFor(async () => mock.st.plays.length > plays1, 4000);
      await sleep(800);
      const fightPlay = mock.st.plays[mock.st.plays.length - 1];
      const fightTracks = (await snd()).tracks.map((t) => t.key);
      handle('sound.fight', { on: false });
      await sleep(1600);
      const fight = { mood: ch.fightMood === tav.id, context: fightPlay && fightPlay.context, fileTrack: fightTracks.some((k) => k.startsWith('fight:')), fighting: state.fightNow, pausedAfter: !mock.st.playing };
      handle('chapter.fight', { id: ch.id, mood: null });
      const bat = moods.find((m) => m.name === 'Battle');
      const cue = handle('cue.save', { name: 'Battle starts' });
      handle('cue.update', { id: cue.id, spotify: bat.id });
      const cueRec = store.cur.meta.cues.find((x) => x.id === cue.id);
      const plays2 = mock.st.plays.length;
      handle('cue.play', { id: cue.id });
      await waitFor(async () => mock.st.plays.length > plays2, 4000);
      await sleep(600);
      const cuePlay = { part: cueRec.parts.spotify, mood: cueRec.data.spotify === bat.id, played: mock.st.plays.length - plays2 };
      handle('cue.remove', { id: cue.id });
      await key('Escape');
      // unlink
      await js(gm, `window.ts.spotify('unlink')`);
      await sleep(500);
      C.spotifyMore = { fight, cuePlay, unlinked: !(await js(gm, 'Play.state().spotify.linked')), row: await js(gm, `document.querySelector('#table-ctl .tc-spotify').textContent`) };
      mock.close();
      await key('Escape'); await key('V');
      await sleep(300);
    }

    // ---------- 8m. 1.5: Toolbox → Dice: dice on the TV, the wheel of luck, a death save ----------
    {
      const tv = () => W().player;
      const tdice = () => js(tv(), 'window.__table.debug().dice');
      const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
      const P = '.fp[data-id="dice"]';
      const q = (sel) => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
      const clickIn = (sel, text) => js(gm, `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);
      const synth = async () => (await snd()).synth || {};
      const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] || 0) - (a[k] || 0)]).filter(([, v]) => v));
      await key('Escape'); await key('Escape'); await key('V');
      await sleep(300);
      await key('Q');
      await sleep(400);
      const tiles = await js(gm, `[...document.querySelectorAll('#pop .tb-tile:not([data-t])')].map((t) => t.textContent.trim())`);
      const mapTiles = await js(gm, `[...document.querySelectorAll('#pop .tb-tile[data-t]')].map((t) => t.textContent.trim())`); // 4.3: Dice is with the tools on the map
      await clickText('#pop .tb-tile', 'Dice');
      await sleep(600);
      const panel = {
        tiles, mapTiles, open: await js(gm, `!!document.querySelector('${P}')`),
        tabs: await js(gm, `[...document.querySelectorAll('${P} .dice-tabs .seg-btn')].map((b) => b.textContent.trim())`),
        pad: await js(gm, `[...document.querySelectorAll('${P} .dice-btn')].map((b) => b.querySelector('.dice-btn-name').textContent)`),
      };
      // the hand: one d20 to start; two d6 in, one out with a right-click; a bonus of 2
      await js(gm, `document.querySelector('${P} .dice-btn[data-s="6"]').click(); document.querySelector('${P} .dice-btn[data-s="6"]').click();`);
      await sleep(300);
      panel.hand2 = await q(`${P} .dice-hand-text`);
      await js(gm, `document.querySelector('${P} .dice-btn[data-s="6"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
      await sleep(300);
      await js(gm, `document.querySelector('${P} .ctl-stepper .icon-btn[aria-label="Bonus bigger"]').click(); document.querySelector('${P} .ctl-stepper .icon-btn[aria-label="Bonus bigger"]').click();`);
      await sleep(300);
      panel.hand = await q(`${P} .dice-hand-text`);
      panel.advHidden = await js(gm, `document.querySelector('${P} .seg-3:not(.dice-tabs)').parentElement.hidden`);
      // roll: the TV throws the dice, they clack, land, the total shows with a chime
      const s0 = await synth();
      await clickIn(`${P} .btn`, 'Roll on the table');
      await sleep(200);
      const r1 = state.dice;
      const rolling = await tdice();
      await waitFor(async () => (await tdice()).phase === 'result', 6000);
      await sleep(700);
      await shot(tv(), '42a-table-dice');
      const landed = await tdice();
      const s1 = await synth();
      await sleep(300);
      await shot(gm, '42b-dice-panel');
      C.dice15 = {
        panel, r1: r1 && { kind: r1.kind, label: r1.label, total: r1.total, bonus: r1.bonus, dice: r1.dice, crit: r1.crit, t0: r1.t0, dur: r1.dur, stops: r1.stops, reveal: r1.reveal },
        rolling: { on: rolling.on, kind: rolling.kind, phase: rolling.phase }, landed: { phase: landed.phase, sounds: landed.sounds },
        sounds: diff(s0, s1), shown: await q(`${P} .dice-total`), log: state.diceLog[0] && { kind: state.diceLog[0].kind, total: state.diceLog[0].total },
      };
      // one d20 with advantage: two dice, the lower one dropped
      await js(gm, `document.querySelector('${P} .dice-hand .icon-btn').click()`);
      await sleep(200);
      await js(gm, `document.querySelector('${P} .dice-btn[data-s="20"]').click()`);
      await sleep(300);
      const advShown = !(await js(gm, `document.querySelector('${P} .seg-3:not(.dice-tabs)').parentElement.hidden`));
      await clickIn(`${P} .seg-btn`, 'Advantage');
      await sleep(200);
      await clickIn(`${P} .btn`, 'Roll on the table');
      await sleep(300);
      const r2 = state.dice;
      C.dice15.adv = { shown: advShown, label: r2.label, dice: r2.dice, total: r2.total, crit: r2.crit };
      // 1.6: a d2 (a coin flip, 1 or 2)
      const d2 = handle('dice.roll', { pool: { 2: 1 } }).roll;
      C.dice15.d2 = { label: d2.label, value: d2.dice[0].value, sides: d2.dice[0].sides, pad: await js(gm, `!!document.querySelector('${P} .dice-btn[data-s="2"]')`) };
      await key('Escape');

      // --- the wheel of luck: a campaign wheel with weights, an entry added in the panel; 1.7: a slot reel of the entries
      await clickIn(`${P} .dice-tabs .seg-btn`, 'Wheel');
      await sleep(500);
      const starters = await js(gm, `[...document.querySelectorAll('${P} select option')].map((o) => o.textContent)`);
      // 1.6: muted colours; a saved wheel with the bright colours of 1.5 gets the muted ones
      const yesColors = (await js(gm, 'Play.state().campaign.wheels')).find((w) => w.id === 'w-yes').entries.map((e) => e.color);
      const old = handle('wheel.save', { wheel: { name: 'Old colours', entries: [{ label: 'A', color: '#c0392b' }, { label: 'B', color: '#28b463' }] } });
      await sleep(300);
      const oldNow = (await js(gm, 'Play.state().campaign.wheels')).find((w) => w.id === old.id).entries.map((e) => e.color);
      handle('wheel.remove', { id: old.id });
      const made = handle('wheel.save', { wheel: { name: 'Loot', entries: [{ label: 'Gold', weight: 3 }, { label: 'Sword', weight: 1 }, { label: 'Nothing', weight: 1 }] } });
      await sleep(300);
      await js(gm, `(() => { const s = document.querySelector('${P} select'); s.value = ${JSON.stringify(made.id)}; s.dispatchEvent(new Event('change')); })()`);
      await sleep(500);
      await js(gm, `(() => { const i = document.querySelector('${P} .wheel-add'); i.value = 'Potion'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(500);
      const rows = await js(gm, `[...document.querySelectorAll('${P} .wheel-row:not(.add) .wheel-label')].map((i) => i.value)`);
      // Sword: one more weight with a click
      await js(gm, `[...document.querySelectorAll('${P} .wheel-row')].find((r) => r.querySelector('.wheel-label') && r.querySelector('.wheel-label').value === 'Sword').querySelector('.wheel-weight').click()`);
      await sleep(400);
      let w = store.cur.meta.wheels.find((x) => x.id === made.id);
      const weights = w.entries.map((e) => e.weight);
      const noForcing = await js(gm, `!document.querySelector('${P} .wheel-note') && ![...document.querySelectorAll('${P} .wheel-row .icon-btn')].some((b) => /More for/.test(b.getAttribute('aria-label') || ''))`);
      const s2 = await synth();
      await clickIn(`${P} .btn`, 'Spin on the table');
      await sleep(300);
      const spin = state.dice && { kind: state.dice.kind, index: state.dice.index, cell: state.dice.cell, strip: state.dice.strip, label: state.dice.label, title: state.dice.title, n: state.dice.entries.length, labels: state.dice.entries.map((e) => e.label), stops: state.dice.stops, reveal: state.dice.reveal };
      await waitFor(async () => (await tdice()).phase === 'result', 9000);
      await sleep(1200);
      await shot(tv(), '42c-table-wheel');
      const wres = await tdice();
      const s3 = await synth();
      await shot(gm, '42d-wheel-panel');
      // the × on an entry deletes it
      await js(gm, `document.querySelector('${P} .wheel-row:not(.add) .icon-btn[aria-label="Delete Nothing"]').click()`);
      await sleep(400);
      const afterDelete = store.cur.meta.wheels.find((x) => x.id === made.id).entries.map((e) => e.label);
      C.wheel15 = { yesColors, oldNow, starters, rows, weights, noForcing, spin, afterDelete, phase: wres.phase, ticks: wres.ticks, sounds: diff(s2, s3), shown: await q(`${P} .dice-total`), saved: !!store.cur.meta.wheels.find((x) => x.id === made.id) };
      // a second spin is chance again; delete the wheel and take it back
      const del = handle('wheel.remove', { id: made.id });
      const gone = !store.cur.meta.wheels.some((x) => x.id === made.id);
      handle(del.undo.type, del.undo.payload);
      C.wheel15.undoDelete = gone && store.cur.meta.wheels.some((x) => x.id === made.id) && /Loot deleted/.test(del.label);

      // --- the death save: dark, heartbeats, one slow d20; 10 or more is good
      await clickIn(`${P} .dice-tabs .seg-btn`, 'Death save');
      await sleep(500);
      const s4 = await synth();
      await clickIn(`${P} .btn`, 'death save');
      await sleep(300);
      const d = state.dice && { kind: state.dice.kind, value: state.dice.value, good: state.dice.good, stops: state.dice.stops };
      await waitFor(async () => (await tdice()).phase === 'result', 9000);
      await sleep(900);
      await shot(tv(), '42e-table-death');
      const dres = await tdice();
      const s5 = await synth();
      const cls = await js(gm, `document.querySelector('${P} .dice-total') && document.querySelector('${P} .dice-total').className`);
      await shot(gm, '42f-death-panel');
      // Take it off the TV
      await clickIn(`${P} .btn`, 'Take it off the table');
      await sleep(500);
      C.death15 = { d, phase: dres.phase, sounds: diff(s4, s5), cls, text: await q(`${P} .dice-detail`), off: !state.dice && !(await tdice()).on };
      await js(gm, 'Play.Floats.hide("dice")');
      await key('Escape'); await key('V');
      await sleep(300);
    }

    // ---------- 8n. 1.6: the campaign's page: players here today, the screens (title, break, blackout), table check, Start session ----------
    {
      const tv = () => W().player;
      const tdbg = () => js(tv(), 'window.__table.debug()');
      const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
      const val = (sel, v) => js(gm, `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change')); return true; })()`);
      const q = (sel) => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
      const party0 = (store.cur.meta.party || []).slice();
      const meta = store.cur.meta;
      await key('Escape'); await key('Escape'); await key('V');
      // the rail's Campaign button opens the page; the table keeps showing what it shows
      const live0 = state.liveMapId;
      await clickSel('.rail-btn[data-id="home"]');
      await sleep(900);
      const page = { screen: state.screen, shown: await js(gm, `!!document.querySelector('#home:not([hidden]) .cp')`), live: state.liveMapId === live0, railLabel: null };
      // players: three added, one not here today
      for (const n of ['Aela', 'Brom', 'Cid']) {
        await js(gm, `(() => { const i = document.querySelector('.pl-add'); i.value = ${JSON.stringify(n)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
        await sleep(250);
      }
      await js(gm, `document.querySelector('.pl-row[data-name="Cid"] .pl-here').click()`);
      await sleep(400);
      const players = { party: meta.party.slice(), away: (meta.away || []).slice(), count: await q('.cp-count'), awayRow: await js(gm, `document.querySelector('.pl-row[data-name="Cid"]').classList.contains('away')`) };
      // 1.8: the little maid is the default picture (a small copy in the preview); the maps rest while the page is open
      const defaultPic = { value: await js(gm, `document.querySelector('.cp-pic').value`), option: await js(gm, `document.querySelector('.cp-pic').selectedOptions[0].textContent`),
        fit: await js(gm, `(() => { const i = document.querySelector('.cp-tv .cp-tv-pic.fit'); return i ? i.getAttribute('src') : null; })()`), mapsPaused: await js(gm, 'Play.view().playing === false') };
      // the title: its own text, the first map's picture; the preview shows it
      await val('.cp input[data-k="title"]', 'The Goblin Caves');
      await val('.cp input[data-k="sub"]', 'Chapter 2');
      await sleep(300);
      const mapPath = store.map(store.allMapIds()[0]).bg.path;
      await val('.cp-pic', mapPath);
      await sleep(500);
      await sleep(800);
      const titleUi = { preview: await q('.cp-tv-title b'), sub: await q('.cp-tv-title span'), pic: await js(gm, `!!document.querySelector('.cp-tv-title') && !!document.querySelector('.cp-tv .cp-tv-pic')`), saved: meta.screens && meta.screens.title, noNumber: await js(gm, `!document.querySelector('.cp .ctl-toggle')`),
        small: await js(gm, `(() => { const i = document.querySelector('.cp-tv .cp-tv-pic'); return i ? { thumb: !!i.dataset.thumbPath, w: i.naturalWidth } : null; })()`) };
      const checks = await js(gm, `[...document.querySelectorAll('.chk-row')].map((r) => r.dataset.id + ':' + r.className.replace('chk-row', '').trim())`);
      await shot(gm, '43a-campaign-page');
      // the break: a line of text, dark behind it; "Show it on the TV" shows the screen of the open tab, only that one
      await js(gm, `document.querySelector('.cp-tabs .seg-btn[data-v="brk"]').click()`);
      await sleep(300);
      await val('.cp input[data-k="label"]', 'Short rest');
      await val('.cp input[data-k="text"]', 'Snacks are in the kitchen');
      await js(gm, `document.querySelector('.cp .seg[data-k="bg"] .seg-btn[data-v="dark"]').click()`);
      await sleep(300);
      await js(gm, `document.querySelector('.cp-ontv').click()`);
      await sleep(900);
      const brk = (await tdbg()).over.brk;
      await shot(tv(), '43b-table-break');
      // to the blackout tab: the TV follows (the break goes, the blackout comes): the campaign's name, faintly, with a line
      await js(gm, `document.querySelector('.cp-tabs .seg-btn[data-v="blackout"]').click()`);
      await sleep(300);
      await js(gm, `document.querySelector('.cp .seg[data-k="style"] .seg-btn[data-v="title"]').click()`);
      await val('.cp input[data-k="text"]', 'Back in a moment');
      await sleep(900);
      const black = (await tdbg()).blackLook;
      const brkOff = !state.brk && !(await tdbg()).over.brk;
      await shot(tv(), '43c-table-blackout');
      // to the title tab: the title, no blackout; then off
      await js(gm, `document.querySelector('.cp-tabs .seg-btn[data-v="title"]').click()`);
      await sleep(900);
      const follow = { title: ((await tdbg()).over.title || {}).title || null, blackout: state.blackout, brk: !!state.brk };
      await js(gm, `document.querySelector('.cp-ontv').click()`);
      await sleep(600);
      const blackOff = !state.blackout && !state.title && !state.brk;
      // Start session: counted, the maps open, the title on the TV for both sides until a map is sent
      const startText = await q('.cp-start');
      await clickSel('.cp-start');
      await sleep(400);
      const started = { screen: state.screen, session: state.session, last: meta.lastSession, text: startText };
      await waitFor(async () => { const d = await tdbg(); return d.over.title && d.over.title.shown; }, 4000);
      await sleep(2600);
      const title = (await tdbg()).over.title;
      await shot(tv(), '43d-table-title');
      const status = await q('#table-ctl .tc-text');
      const offBtn = await js(gm, `!document.querySelector('#table-ctl .tc-title-off').hidden`);
      // Initiative: only the players here today
      await key('Q');
      await sleep(300);
      await clickText('#pop .tb-tile', 'Initiative');
      await sleep(500);
      const ini = { rows: await js(gm, `[...document.querySelectorAll('.fp[data-id="init"] .ini-row[data-id] .ini-name span')].map((x) => x.textContent)`), away: await q('.fp[data-id="init"] .ini-away') };
      await js(gm, 'Play.Floats.hide("init")');
      await key('Escape');
      // the first map sent takes the title away
      handle('table.send', { id: live0 });
      await sleep(1600);
      const afterSend = { title: state.title, tv: (await tdbg()).over.title };
      // back on the page: the session runs; Back to the table
      await clickSel('.rail-btn[data-id="home"]');
      await sleep(700);
      const running = { start: await q('.cp-start'), running: await q('.cp-running'), prepHidden: await js(gm, `document.querySelector('.cp-prep').hidden`) };
      await shot(gm, '43e-campaign-running');
      await clickSel('.cp-start');
      await sleep(600);
      running.back = state.screen;
      running.mapsPlay = await js(gm, 'Play.view().playing === true');
      C.page16 = { page, players, titleUi, defaultPic, follow, checks, brk, brkOff, black, blackOff, started, title, status, offBtn, ini, afterSend, running };
      handle('screens.set', { which: 'title', patch: { sub: '' } });
      // as it was for the rest of the test
      handle('party.set', { names: party0 });
      handle('screens.set', { which: 'blackout', patch: { style: 'black', text: '' } });
      handle('screens.set', { which: 'brk', patch: { bg: 'map', text: '', label: '' } });
      await key('Escape'); await key('V');
      await sleep(300);
    }

    // ---------- 8o. 1.8: token names (rename one or all copies), name tags (Off / Only me / Players too), the maid loading icon ----------
    {
      const tv = () => W().player;
      const tdbg = () => js(tv(), 'window.__table.debug()');
      await key('Escape'); await key('Escape'); await key('V');
      const lm = L();
      handle('edit.open', { id: lm.id });
      await sleep(400);
      const tr = await js(gm, 'Play.view().tableRectInMap()');
      const goblin = lib('Tokens/Goblin.png');
      const a1 = handle('layer.add', { path: goblin, role: 'token', x: tr.x + tr.w * 0.3, y: tr.y + tr.h * 0.18, tag: 'all' });
      const a2 = handle('layer.add', { path: goblin, role: 'token', x: tr.x + tr.w * 0.36, y: tr.y + tr.h * 0.8, tag: 'all' });
      await sleep(900);
      const tok = (id) => store.map(lm.id).layers.find((l) => l.id === id);
      const label = (l) => `${l.name}${l.n ? ` ${l.n}` : ''}`;
      const tags1 = (await tdbg()).tags;
      const sides = { top: tags1.find((t) => t.text === label(tok(a1.selected))) || null, bottom: tags1.find((t) => t.text === label(tok(a2.selected))) || null };
      // only me: not on the TV; on the GM screen, in blue
      handle('layer.update', { id: a2.selected, tag: 'gm' });
      await sleep(700);
      const gmOnly = { tv: (await tdbg()).tags.some((t) => t.text === label(tok(a2.selected))),
        gm: await js(gm, `(() => { const e = document.querySelector('.sv-token[data-id="${a2.selected}"] .sv-token-tag'); return e && e.style.display !== 'none' && e.classList.contains('gm-only') ? e.textContent : null; })()`) };
      // a hidden token never shows its name on the TV
      handle('layer.update', { id: a1.selected, hidden: true });
      await sleep(700);
      const hiddenOff = !(await tdbg()).tags.some((t) => t.text === label(tok(a1.selected)));
      handle('layer.update', { id: a1.selected, hidden: false });
      await sleep(300);
      // rename one through its card: a name of its own, out of the numbering
      const openCard = async (id) => {
        const l = tok(id);
        const p = await scr(l.x, l.y);
        await click(p.x, p.y);
        await sleep(500);
      };
      await openCard(a1.selected);
      await js(gm, `document.querySelector('#token-card .card-name').click()`);
      await sleep(300);
      const menu1 = await js(gm, `[...document.querySelectorAll('#menu .menu-item')].map((x) => x.textContent.trim())`);
      await clickText('#menu .menu-item', 'Rename this');
      await sleep(300);
      await js(gm, `(() => { const i = document.querySelector('.modal input'); i.value = 'Grimgor'; document.querySelector('.modal .btn.primary').click(); })()`);
      await sleep(700);
      const one = { name: tok(a1.selected).name, n: tok(a1.selected).n ?? null, named: tok(a1.selected).named, tv: (await tdbg()).tags.some((t) => t.text === 'Grimgor') };
      // rename all copies: they keep their numbers
      const a3 = handle('layer.add', { path: goblin, role: 'token', x: tr.x + tr.w * 0.45, y: tr.y + tr.h * 0.8 });
      await sleep(500);
      const nums = [tok(a2.selected).n, tok(a3.selected).n];
      await key('Escape');
      await openCard(a2.selected);
      await js(gm, `document.querySelector('#token-card .card-name').click()`);
      await sleep(300);
      await clickText('#menu .menu-item', 'Rename all copies');
      await sleep(300);
      await js(gm, `(() => { const i = document.querySelector('.modal input'); i.value = 'Goblin archer'; document.querySelector('.modal .btn.primary').click(); })()`);
      await sleep(700);
      const group = { names: [tok(a2.selected).name, tok(a3.selected).name], nums: [tok(a2.selected).n, tok(a3.selected).n], before: nums, grimgor: tok(a1.selected).name };
      // a copy of a named token stays named, without a number
      const dup = handle('layer.duplicate', { id: a1.selected, dx: 1, dy: 0 });
      const dupl = tok(dup.selected);
      const copy = { name: dupl.name, n: dupl.n ?? null, named: dupl.named };
      await key('Escape');
      // the name tag of new tokens (4.10: in Options → Tokens); all tokens on this map at once (the Tokens popover)
      await js(gm, `App.openOptions('tokens')`);
      await sleep(500);
      await clickText('.tok-opts .seg-btn', 'Players too');
      await sleep(200);
      const newTag = await js(gm, 'Play.ui.tok.tag');
      await js(gm, 'App.closeOptions()');
      await sleep(200);
      await key('N');
      await sleep(400);
      await clickText('#pop .tag-all .btn', 'Off');
      await sleep(600);
      const allOff = store.map(lm.id).layers.filter((l) => l.role === 'token').every((l) => (l.tag || 'off') === 'off');
      await shot(gm, '44a-token-names');
      await js(gm, `Play.setTokPref('tag', 'off')`);
      await key('Escape'); await key('V');
      // the maid: the loading icon (the start-up one is gone once the GM screen is ready)
      const loader = await js(gm, `new Promise((res) => { const el = UI.loader('Testing …'); document.body.append(el); const img = el.querySelector('img'); setTimeout(() => { const r = { src: img.getAttribute('src'), w: img.naturalWidth, text: el.textContent }; el.remove(); res(r); }, 500); })`);
      const boot = await js(gm, `!document.getElementById('boot')`);
      C.tokens18 = { sides, gmOnly, hiddenOff, menu1, one, group, copy, newTag, allOff, loader, boot };
      handle('layer.removeMany', { ids: [a1.selected, a2.selected, a3.selected, dup.selected] });
      // the map's goblins get their name back for the rest of the test
      handle('layer.many', { mapId: lm.id, patches: store.map(lm.id).layers.filter((l) => l.role === 'token' && l.name === 'Goblin archer').map((l) => ({ id: l.id, name: 'Goblin' })) });
      await sleep(300);
    }

    // ---------- 8p. 1.9: the initiative pop-up (enemies, rolls, columns, HP, groups by choice, drag and drop) and tables for the wheel ----------
    {
      const tv = () => W().player;
      const tdbg = () => js(tv(), 'window.__table.debug()');
      const IP = '.fp[data-id="init"]';
      const q = (sel) => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
      await key('Escape'); await key('Escape'); await key('V');
      if (state.init && state.init.running) handle('init.end', {});
      state.init = null;
      handle('party.set', { names: ['Ayla', 'Bo'] });
      for (const n of store.cur.meta.away || []) handle('party.away', { name: n, away: false });
      const lm = L();
      handle('edit.open', { id: lm.id });
      await sleep(300);
      await js(gm, `Play.TB.openPanel('init')`);
      await sleep(700);
      const I = () => state.init;
      const E = (name) => I().entries.find((e) => e.name === name);
      const rowSel = (name) => `${IP} .ini-row[data-id="${E(name).id}"]`;
      const tokRows = I().entries.filter((e) => e.tokens.length);
      const prep = { running: I().running, pcs: I().entries.filter((e) => e.pc).map((e) => e.name), tokens: tokRows.length, oneEach: tokRows.every((e) => e.tokens.length === 1), groups: I().entries.filter((e) => e.group).length };
      // + Enemy: three skeletons with a bonus, AC and HP (the AC and HP columns come with them)
      await clickText(`${IP} .ini-tools .btn`, 'Enemy');
      await sleep(300);
      await gm.webContents.insertText('Skeleton');
      await js(gm, `(() => { const f = document.querySelector('.ini-enemy'); const n = f.querySelectorAll('input[type=number]'); n[0].value = 3; n[0].dispatchEvent(new Event('input')); n[1].value = 2; n[2].value = 13; n[3].value = 13; })()`);
      const groupBox = await js(gm, `!document.querySelector('.ini-enemy .ini-check').hidden`);
      await shot(gm, '45a-initiative-enemy');
      await js(gm, `document.querySelector('.ini-enemy').requestSubmit()`);
      await sleep(600);
      const sk = I().entries.filter((e) => /^Skeleton \d$/.test(e.name));
      const enemy = { names: sk.map((e) => e.name), bonus: sk.map((e) => e.bonus), group: sk.some((e) => e.group), cols: I().entries.length && (store.cur.meta.initCols || []).map((c) => c.kind), foe: (store.cur.meta.foes || []).find((f) => f.name === 'Skeleton') || null };
      // remembered: the next time the dialog offers it
      await clickText(`${IP} .ini-tools .btn`, 'Enemy');
      await sleep(300);
      enemy.chip = await js(gm, `[...document.querySelectorAll('.ini-foes .ini-chip')].map((b) => b.textContent)`);
      await js(gm, `document.querySelector('.ini-dlg .dlg-head .icon-btn').click()`);
      await sleep(200);
      // + Column: Conditions, and one of your own
      await clickText(`${IP} .ini-tools .btn`, 'Column');
      await clickText('#menu .menu-item', 'Conditions');
      await sleep(300);
      await clickText(`${IP} .ini-tools .btn`, 'Column');
      await clickText('#menu .menu-item', 'Your own number');
      await sleep(250);
      await gm.webContents.insertText('Slots');
      await key('Enter');
      await sleep(400);
      const cols = { kinds: (store.cur.meta.initCols || []).map((c) => c.kind), names: (store.cur.meta.initCols || []).map((c) => c.name), heads: await js(gm, `[...document.querySelectorAll('${IP} .ini-colhead')].map((b) => b.textContent)`) };
      // the columns fit what's in them: the names column hugs the longest name, the pop-up shrinks when a column goes; no hints underneath
      const fitNow = () => js(gm, `(() => { const t = document.querySelector('${IP} .ini-table'); const cols = getComputedStyle(t).gridTemplateColumns.split(' ').map(parseFloat); const names = [...t.querySelectorAll('.ini-row[data-id] .ini-name')].map((n) => n.scrollWidth);
        return { name: Math.round(cols[1]), longest: Math.max(...names), panel: Math.round(document.querySelector('${IP}').getBoundingClientRect().width), hints: document.querySelectorAll('${IP} .hint').length }; })()`);
      const fit = await fitNow();
      const slots = store.cur.meta.initCols.find((c) => c.name === 'Slots');
      handle('init.col', { remove: slots.id });
      await sleep(500);
      fit.less = (await fitNow()).panel;
      handle('init.col', { add: { kind: 'num', name: 'Slots' } });
      await sleep(400);
      fit.back = (await fitNow()).panel;
      // Roll enemies: every NPC without a number, d20 + bonus; the players keep theirs empty
      await clickText(`${IP} .ini-tools .btn`, 'Roll enemies');
      await sleep(400);
      const rolled = { npcs: I().entries.filter((e) => !e.pc).every((e) => e.init != null), pcs: I().entries.filter((e) => e.pc).every((e) => e.init == null),
        sk: I().entries.filter((e) => /^Skeleton/.test(e.name)).every((e) => e.roll && e.init === e.roll.d20 + 2 && e.roll.d20 >= 1 && e.roll.d20 <= 20), disabled: await js(gm, `[...document.querySelectorAll('${IP} .ini-tools .btn')].find((b) => /Roll enemies/.test(b.textContent)).disabled`) };
      // the players' numbers: the last one sorts the list
      const setIn = (sel, v) => js(gm, `(() => { const n = document.querySelector(${JSON.stringify(sel)}); n.value = ${JSON.stringify(String(v))}; n.dispatchEvent(new Event('change')); })()`);
      await setIn(`${rowSel('Ayla')} .ini-num`, 25);
      await sleep(300);
      const before = I().entries.map((e) => e.name);
      await setIn(`${rowSel('Bo')} .ini-num`, 0);
      await sleep(400);
      const inits = I().entries.map((e) => e.init);
      const sorted = { before0: before[0], first: I().entries[0].name, last: I().entries[I().entries.length - 1].name, desc: inits.every((v, i) => i === 0 || v <= inits[i - 1]) };
      // a rat that is down already (0 HP) is skipped in the fight
      handle('init.add', { name: 'Rat', hp: 1 });
      await sleep(200);
      handle('init.set', { id: E('Rat').id, init: 10 });
      const hpCol = store.cur.meta.initCols.find((c) => c.kind === 'hp');
      const acCol = store.cur.meta.initCols.find((c) => c.kind === 'ac');
      await sleep(300);
      // HP: -7 and -6 bring Skeleton 1 to 0 (grey, a skull); +5 heals no further than the maximum
      await setIn(`${rowSel('Skeleton 1')} .ini-hp`, '-7');
      await sleep(250);
      const hp7 = E('Skeleton 1').vals[hpCol.id];
      await setIn(`${rowSel('Skeleton 1')} .ini-hp`, '-6');
      await sleep(250);
      await setIn(`${rowSel('Skeleton 2')} .ini-hp`, '-3');
      await sleep(250);
      await setIn(`${rowSel('Skeleton 2')} .ini-hp`, '+5');
      await setIn(`${rowSel('Rat')} .ini-hp`, '0');
      await sleep(400);
      const hp = { s1a: hp7, s1: E('Skeleton 1').vals[hpCol.id], s2: E('Skeleton 2').vals[hpCol.id], rat: E('Rat').vals[hpCol.id],
        row: await js(gm, `(() => { const r = document.querySelector(${JSON.stringify(rowSel('Skeleton 1'))}); return { down: r.classList.contains('down'), skull: !!r.querySelector('.ini-name svg.skull') }; })()`),
        note: await js(gm, `(() => { const n = [...document.querySelectorAll('${IP} .ini-note')].find((x) => /defeated/.test(x.textContent)); return n && n.textContent; })()`) };
      // a group by choice: the skeletons share one turn, each keeps its own HP
      await clickText(`${IP} .ini-row[data-id] .ini-name`, 'Skeleton 2');
      await clickText('#menu .menu-item', 'Make a group of all Skeleton');
      await sleep(400);
      const gid = E('Skeleton 2').group;
      await setIn(`${rowSel('Skeleton 3')} .ini-hp`, '-4');
      await sleep(300);
      const grp = { gid: !!gid, members: I().entries.filter((e) => e.group === gid).map((e) => e.name), sameInit: new Set(I().entries.filter((e) => e.group === gid).map((e) => e.init)).size === 1,
        hp: I().entries.filter((e) => e.group === gid).map((e) => (e.vals[hpCol.id] || {}).cur), bar: await js(gm, `(() => { const b = document.querySelector('${IP} .ini-gbar .ini-name'); return b && b.textContent; })()`) };
      // conditions: a tag from the menu, a click takes it off
      await js(gm, `document.querySelector(${JSON.stringify(rowSel('Ayla'))} + ' .ini-chip-add').click()`);
      await sleep(200);
      await clickText('#menu .menu-item', 'Prone');
      await sleep(300);
      const condCol = store.cur.meta.initCols.find((c) => c.kind === 'cond');
      const cond = { on: E('Ayla').vals[condCol.id], chip: await js(gm, `[...document.querySelectorAll(${JSON.stringify(rowSel('Ayla'))} + ' .ini-chip')].map((b) => b.textContent)`) };
      await clickSel(`${rowSel('Ayla')} .ini-chip`);
      await sleep(300);
      cond.off = E('Ayla').vals[condCol.id];
      // the players' AC and max HP are remembered for the campaign
      await setIn(`${rowSel('Ayla')} .ini-in.num`, 16);
      await setIn(`${rowSel('Ayla')} .ini-hp`, '30');
      await sleep(300);
      const pcStats = (store.cur.meta.pcStats || {}).Ayla || null;
      // 0 HP typed for a player without a maximum: 0, no maximum of 0 (and nothing remembered)
      await setIn(`${rowSel('Bo')} .ini-hp`, '0');
      await sleep(300);
      const bo0 = { v: E('Bo').vals[hpCol.id], stats: (store.cur.meta.pcStats || {}).Bo || null, text: await js(gm, `document.querySelector(${JSON.stringify(rowSel('Bo'))} + ' .ini-hp').value`) };
      // hide one enemy from the players
      const ogre = I().entries.find((e) => !e.pc && !e.group && !e.down && e.name !== 'Rat' && !e.tokens.length) || I().entries.find((e) => !e.pc && !e.group && e.name !== 'Rat');
      handle('init.set', { id: ogre.id, hidden: true });
      // Start: the turn marker on the first one, nothing sorted again
      const order0 = I().entries.map((e) => e.id).join();
      await clickText(`${IP} .ini-top .btn`, 'Start the fight');
      await sleep(600);
      const start = { same: I().entries.map((e) => e.id).join() === order0, turn: I().turn === I().entries[0].id, hud: await js(gm, `!!document.querySelector('.hud-init, .hud-round')`) };
      const rib = (await tdbg()).over.init;
      const ribbon = { near: rib && rib.near, hiddenOff: !!rib && !rib.near.includes(ogre.name), downOff: !!rib && !/Skeleton 1|Rat/.test(rib.near), groupOnce: !!rib && (rib.near.match(/Skeleton/g) || []).length === 1 };
      await shot(gm, '45b-initiative-fight');
      await shot(tv(), '45c-initiative-tv');
      // a full round: the rat (an NPC at 0 HP) never gets a turn
      const seen = [];
      const units = () => { const out = []; for (const e of I().entries) { const last = out[out.length - 1]; if (e.group && last && last[0].group === e.group) last.push(e); else out.push([e]); } return out; };
      const n = units().length;
      for (let i = 0; i < n; i++) { handle('init.next', {}); seen.push(I().entries.find((e) => e.id === I().turn).name); }
      const skip = { rat: seen.includes('Rat'), turns: seen.length };
      // drag and drop during the fight: the last row to the top; the turn stays with whoever has it
      const turnBefore = I().turn;
      const lastE = I().entries[I().entries.length - 1];
      const grip = await rect(`${IP} .ini-row[data-id="${lastE.id}"] .ini-grip`);
      const top = await rect(`${IP} .ini-row[data-id="${I().entries[0].id}"]`);
      const firstGroup = I().entries[0].group;
      const topBar = firstGroup ? await rect(`${IP} .ini-gbar[data-gid="${firstGroup}"]`) : top;
      await dragPath({ x: grip.cx, y: grip.cy }, { x: grip.cx, y: topBar.y + 4 }, 10);
      await sleep(400);
      const drag = { first: I().entries[0].id === lastE.id, turn: I().turn === turnBefore, group: I().entries[0].group || null };
      // Remove the defeated (and back with undo)
      await clickText(`${IP} .ini-note .link-btn`, 'Remove the defeated');
      await sleep(400);
      const removed = { gone: !I().entries.some((e) => e.name === 'Skeleton 1' || e.name === 'Rat'), n: I().entries.length };
      handle('init.restore', {});
      await sleep(300);
      removed.back = I().entries.some((e) => e.name === 'Skeleton 1') && I().running;
      // the end, and the next fight: columns and the players' AC and HP are still there
      handle('init.end', {});
      await sleep(700);
      const again = { running: I() && I().running, ayla: I() && E('Ayla') ? { ac: E('Ayla').vals[acCol.id], hp: E('Ayla').vals[hpCol.id] } : null, cols: (store.cur.meta.initCols || []).length };
      await js(gm, 'Play.Floats.hide("init")');
      state.init = null;
      C.init19 = { prep, groupBox, enemy, cols, fit, rolled, sorted, hp, grp, cond, pcStats, bo0, start, ribbon, skip, drag, removed, again };
      // a hidden token takes its light off the TV (the GM still sees it)
      {
        const V = require('./renderer/vision.js');
        const tokL = L().layers.find((l) => l.role === 'token' && !l.hidden);
        handle('fx.add', { kind: 'light', preset: 'torch', attachTo: tokL.id, x: tokL.x, y: tokL.y, bright: 20, dim: 40 });
        await sleep(300);
        const lightId = (L().fx.find((f) => f.attachTo === tokL.id && f.kind === 'light') || {}).id;
        const lit = (gm2) => V.lights(L(), gm2).some((x) => x.id === lightId);
        const before = lit(false);
        handle('layer.update', { id: tokL.id, hidden: true });
        await sleep(500);
        C.light19 = { id: !!lightId, before, hidden: lit(false), gm: lit(true), gmView: await js(gm, `Play.view().shown(Play.view().map.fx.find((f) => f.id === ${JSON.stringify(lightId)}))`), tvView: await js(tv(), `window.__table.fxShown(${JSON.stringify(lightId)})`) };
        handle('layer.update', { id: tokL.id, hidden: false });
        handle('fx.remove', { id: lightId });
        await sleep(300);
      }

      // ---- tables for the wheel ----
      const TP = require('./renderer/table-parse.js');
      const pr = (t) => TP.parse(t).entries.map((e) => `${e.label}:${e.weight}`).join('|');
      const parse = {
        lines: pr('Goblins\nOrcs\n\nA dragon'),
        ranges: pr('1-4 Goblins\n5–8: Orcs\n9-19. Wolves\n20) A dragon'),
        d100: TP.parse('| d100 | Treasure |\n|---|---|\n| 01-60 | Copper |\n| 61-95 | Silver |\n| 96-00 | Gold |'),
        weights: pr('- Rain ×3\n- Sun x2\n- Fog, 4\n- Storm'),
        csv: pr('Entry,Weight\n"Goblins, armed",3\nOrcs,1'),
        tabs: pr('Roll\tResult\n1\tLeft\n2\tRight'),
        words: pr('3 goblins appear\nA wolf howls\nRain'),
      };
      parse.d100 = { name: parse.d100.name, die: parse.d100.die, e: parse.d100.entries.map((e) => `${e.label}:${e.weight}`).join('|') };
      // paste: the preview shows the chances, then a new wheel
      const DP = '.fp[data-id="dice"]';
      await js(gm, `Play.TB.openPanel('dice')`);
      await sleep(500);
      await js(gm, `[...document.querySelectorAll('${DP} .dice-tabs .seg-btn')].find((b) => b.dataset.v === 'wheel').click()`);
      await sleep(400);
      const wn = () => (store.cur.meta.wheels || []).map((w) => w.name);
      await clickSel(`${DP} .ctl-row .icon-btn[aria-label="More for this wheel"]`);
      await clickText('#menu .menu-item', 'Paste a table');
      await sleep(300);
      await js(gm, `(() => { const a = document.querySelector('.tp-text'); a.value = 'Random encounters (d20)\\n1-8 Goblins\\n9-15 Wolves\\n16-19 Bandits\\n20 A dragon'; a.dispatchEvent(new Event('input')); })()`);
      await sleep(200);
      const preview = { info: await q('.tp-info'), rows: await js(gm, `[...document.querySelectorAll('.tp-row')].map((r) => r.textContent)`), name: await js(gm, `document.querySelector('.tp-in input').value`) };
      await shot(gm, '45d-paste-table');
      await clickText('.tp-actions .btn', 'Make the wheel');
      await sleep(500);
      const made = (store.cur.meta.wheels || []).find((w) => w.name === 'Random encounters (d20)');
      const paste = { preview, made: made && made.entries.map((e) => `${e.label}:${e.weight}`).join('|'), picked: await js(gm, `document.querySelector('${DP} select').value`) === (made && made.id) };
      // paste more into the wheel that is open
      await clickSel(`${DP} .ctl-row .icon-btn[aria-label="More for this wheel"]`);
      await clickText('#menu .menu-item', 'Paste a table');
      await sleep(300);
      await js(gm, `(() => { const a = document.querySelector('.tp-text'); a.value = 'An ogre\\nNothing at all ×2'; a.dispatchEvent(new Event('input')); [...document.querySelectorAll('.tp-in .seg-btn')].find((b) => b.dataset.v === 'add').click(); })()`);
      await sleep(200);
      await js(gm, `[...document.querySelectorAll('.tp-actions .btn')].find((b) => /Add/.test(b.textContent)).click()`);
      await sleep(500);
      paste.added = (store.cur.meta.wheels || []).find((w) => w.id === made.id).entries.map((e) => `${e.label}:${e.weight}`).slice(-2).join('|');
      // files: one wheel per file, named after it
      const tmpT = path.join(dir, 'tables');
      fs.mkdirSync(tmpT, { recursive: true });
      fs.writeFileSync(path.join(tmpT, 'Loot.csv'), 'Entry,Weight\nGold,3\n"Rope, 50 ft",1\n');
      fs.writeFileSync(path.join(tmpT, 'Empty.txt'), '\n\n');
      fs.writeFileSync(path.join(tmpT, 'Weather.md'), '# Weather\n- Rain ×2\n- Sun\n');
      const files = await handle('wheel.importFiles', { paths: ['Loot.csv', 'Empty.txt', 'Weather.md'].map((f) => path.join(tmpT, f)) });
      const fromFiles = { made: files.made.map((m) => `${m.name}:${m.n}`), empty: files.empty, loot: ((store.cur.meta.wheels || []).find((w) => w.id === (files.made.find((m) => m.name === 'Loot') || {}).id) || { entries: [] }).entries.map((e) => `${e.label}:${e.weight}`).join('|') };
      // the library's Tables: in every campaign; copy one into this one
      fs.writeFileSync(lib('Tables/Wild magic.txt'), '1. Flowers bloom\n2. Your hair turns blue\n3. A loud bang\n4. Nothing happens\n');
      await clickSel(`${DP} .ctl-row .icon-btn[aria-label="More for this wheel"]`);
      await clickText('#menu .menu-item', 'From the library');
      await sleep(700);
      const libRows = await js(gm, `[...document.querySelectorAll('.tp-lib-row')].map((r) => r.textContent)`);
      await clickText('.tp-lib-row .btn', 'Copy into this campaign');
      await sleep(500);
      const library19 = { rows: libRows, copied: wn().includes('Wild magic'), folder: fs.existsSync(lib('Tables')) };
      await js(gm, `document.querySelector('.modal .dlg-head .icon-btn').click()`);
      // export: a CSV in the library (and it reads back the same)
      const lootW = (store.cur.meta.wheels || []).find((w) => w.id === files.made.find((m) => m.name === 'Loot').id);
      const ex = await handle('wheel.export', { id: lootW.id, to: 'library' });
      const back = TP.parse(fs.readFileSync(ex.path, 'utf8'));
      const exported = { ok: ex.ok, inLib: ex.path.startsWith(lib('Tables')), same: back.entries.map((e) => `${e.label}:${e.weight}`).join('|') === lootW.entries.map((e) => `${e.label}:${e.weight}`).join('|') };
      await shot(gm, '45e-wheel-tables');
      await js(gm, 'Play.Floats.hide("dice")');
      C.tables19 = { parse, paste, fromFiles, library19, exported };
    }

    // ---------- 8q. 2.0: the hotbar: drop things on it, use them with 1 – 0, swap, take off, pages, fold ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      const HB = '#hotbar';
      const q = (sel) => js(gm, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
      const shown = await js(gm, `(() => { const b = document.querySelector('${HB}'); return !!b && !b.hidden && b.getBoundingClientRect().height > 30; })()`);
      const dropOn = (i, type, data) => js(gm, `(() => { const dt = new DataTransfer(); dt.setData(${JSON.stringify(type)}, ${JSON.stringify(data)}); const el = document.querySelectorAll('${HB} .hb-slot')[${i}];
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
      handle('hotbar.set', { slots: [] });
      await sleep(300);
      const chMaps = store.cur.meta.chapters.flatMap((c) => c.maps);
      const otherMap = chMaps.find((id) => id !== state.liveMapId);
      const wheel0 = (store.cur.meta.wheels || [])[0];
      // 1: a token from the library (the drawer's drag), 3: a panel, 4: a map card, 5: a wheel
      await dropOn(0, 'application/x-ts-asset', JSON.stringify({ path: lib('Tokens/Goblin.png'), kind: 'image', role: 'token', name: 'Goblin', cat: 'tokens' }));
      await sleep(200);
      await dropOn(2, 'application/x-ts-hot', JSON.stringify({ kind: 'panel', ref: 'timer', label: 'Countdown', icon: 'hourglass' }));
      await sleep(200);
      await dropOn(3, 'application/x-ts-map', otherMap);
      await sleep(200);
      if (wheel0) await dropOn(4, 'application/x-ts-hot', JSON.stringify({ kind: 'wheel', ref: wheel0.id, label: wheel0.name, icon: 'chart-pie' }));
      await sleep(200);
      // 2: a sound, right-click in the soundboard → Put on the hotbar (the first free slot)
      await js(gm, `Play.TB.openPanel('sound')`);
      await sleep(900);
      const sb = await rect('.fp[data-id="sound"] .sb-btn');
      await click(sb.cx, sb.cy, 'right');
      await sleep(250);
      await clickText('#menu .menu-item', 'Put on the hotbar');
      await sleep(500);
      await js(gm, 'Play.Floats.hide("sound")');
      const saved = (store.cur.meta.hotbar || []).slice(0, 5).map((x) => x && x.kind);
      const names = await js(gm, `[...document.querySelectorAll('${HB} .hb-slot')].slice(0, 5).map((s) => s.querySelector('.hb-name') ? s.querySelector('.hb-name').textContent : '')`);
      await shot(gm, '46a-hotbar');
      gm.webContents.focus();
      await js(gm, 'document.activeElement && document.activeElement.blur()');
      // 1: picks up the goblin
      await key('1');
      await sleep(400);
      const k1 = await js(gm, `({ tool: Play.ui.tool, brush: Play.ui.tok && Play.ui.tok.brush && Play.ui.tok.brush.name, live: document.querySelectorAll('${HB} .hb-slot')[0].classList.contains('live') })`);
      await key('Escape'); await key('Escape'); await key('V');
      // 2: the sound plays once on the TV
      const b0 = (await snd()).board.length;
      await key('2');
      await sleep(700);
      const k2 = (await snd()).board.length - b0;
      // 3: the Countdown panel opens (and the slot glows)
      await key('3');
      await sleep(500);
      const k3 = { open: await js(gm, `Play.Floats.isOpen('timer')`), live: await js(gm, `document.querySelectorAll('${HB} .hb-slot')[2].classList.contains('live')`) };
      await js(gm, 'Play.Floats.hide("timer")');
      // 4: the map goes to the table
      const live0 = state.liveMapId;
      await key('4');
      await sleep(1500);
      const k4 = { sent: state.liveMapId === otherMap, live: await js(gm, `document.querySelectorAll('${HB} .hb-slot')[3].classList.contains('live')`) };
      handle('table.send', { id: live0 });
      await sleep(1200);
      // 5: the wheel spins on the TV
      await key('5');
      await sleep(600);
      const k5 = state.dice && state.dice.kind;
      handle('dice.clear', {});
      // swap: slot 1 dragged onto slot 5
      await dropOn(4, 'application/x-ts-hot', JSON.stringify({ from: 0 }));
      await sleep(400);
      const swap = (store.cur.meta.hotbar || []).slice(0, 5).map((x) => x && x.kind);
      // take one off (right-click → Take off the hotbar), page 2, fold
      const s2 = await rect(`${HB} .hb-slot:nth-child(2)`);
      await click(s2.cx, s2.cy, 'right');
      await sleep(250);
      await clickText('#menu .menu-item', 'Take off the hotbar');
      await sleep(400);
      const off = (store.cur.meta.hotbar || [])[1];
      await js(gm, `document.querySelector('${HB} .hb-bar').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))`);
      await sleep(300);
      const page2 = { n: await q(`${HB} .hb-page-n`), empty: await js(gm, `[...document.querySelectorAll('${HB} .hb-slot')].every((s) => s.classList.contains('empty'))`) };
      await key('1');
      await sleep(300);
      const emptyKey = await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
      await js(gm, `document.querySelector('${HB} .hb-pages .icon-btn').click()`);
      await sleep(300);
      const back = await q(`${HB} .hb-page-n`);
      await js(gm, `document.querySelector('${HB} .hb-fold').click()`);
      await sleep(300);
      const folded = await js(gm, `({ bar: getComputedStyle(document.querySelector('${HB} .hb-bar')).display, tab: getComputedStyle(document.querySelector('${HB} .hb-tab')).display })`);
      await js(gm, `document.querySelector('${HB} .hb-tab').click()`);
      await sleep(300);
      const tv = await js(W().player, `!!document.querySelector('#hotbar, .hotbar')`);
      C.hotbar20 = { shown, saved, names, k1, k2, k3, k4, k5, swap, off: off === null, page2, emptyKey: /empty/.test(emptyKey), back, folded, unfolded: await js(gm, `getComputedStyle(document.querySelector('${HB} .hb-bar')).display`), tv };
      handle('hotbar.set', { slots: [] });
      await sleep(200);
    }

    // ---------- 8r. 2.1: snapshots (the map as it is, a timeline, transitions, F1 – F8, the map bar) and fog on the hotbar ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      await js(gm, 'Play.Floats.closeAll()');
      const lm = L();
      handle('edit.open', { id: lm.id });
      handle('fog.enabled', { mapId: lm.id, enabled: false });
      await sleep(500);
      const tok = lm.layers.find((l) => l.role === 'token');
      const smoke = lm.fx.find((f) => f.kind === 'emitter');
      const base = { dark: lm.light.darkness, smokeHidden: smoke ? !!smoke.hidden : null };
      const P = '.fp[data-id="snaps"]';
      // snapshot 1: dark, rain, the smoke off; saved from the panel (Save snapshot, a name)
      handle('light.update', { mapId: lm.id, darkness: 0.6 });
      handle('weather.preset', { mapId: lm.id, name: 'Rain', layers: [{ type: 'rain' }] });
      if (smoke) handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: true });
      await js(gm, 'Play.Snaps.openFor(null)');
      await sleep(700);
      const panel = await js(gm, `(() => { const p = document.querySelector('${P}'); return p ? { w: Math.round(p.getBoundingClientRect().width), save: !!p.querySelector('.snap-save'), empty: !!p.querySelector('.snap-empty') } : null; })()`);
      await clickSel(`${P} .snap-save`);
      await sleep(1200); // the picture first, then the name
      await js(gm, `(() => { const i = document.querySelector('.modal input'); i.value = 'Storm in the hall'; })()`);
      await key('Enter');
      await sleep(900);
      const s1 = (L().snaps || [])[0];
      // snapshot 2: daylight, no weather, the smoke on, a new asset; its transition: a moment
      handle('light.update', { mapId: lm.id, darkness: 0 });
      handle('weather.preset', { mapId: lm.id, name: 'None', layers: [] });
      if (smoke) handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: false });
      const added = handle('layer.add', { mapId: lm.id, path: lib('Tokens/Goblin.png'), role: 'asset', x: 3, y: 3, w: 1 });
      await sleep(500);
      await clickSel(`${P} .snap-save`);
      await sleep(1200);
      const dlg = await js(gm, `(() => { const d = document.querySelector('.snap-dialog'); return d ? { title: d.querySelector('h2').textContent, chips: [...d.querySelectorAll('.snap-chip')].map((x) => x.textContent) } : null; })()`);
      await js(gm, `(() => { const d = document.querySelector('.snap-dialog'); d.querySelector('.st-name').value = 'Calm again'; const s = d.querySelector('select[aria-label="Screen effect"]'); s.value = 'nat20'; s.dispatchEvent(new Event('change')); })()`);
      await shot(gm, '47a-snapshot-transition');
      await clickText('.snap-dialog .btn', 'Save snapshot');
      await sleep(1000);
      const s2 = (L().snaps || [])[1];
      await shot(gm, '47b-snapshots-timeline');
      const timeline = await js(gm, `(() => { const p = document.querySelector('${P}'); return { cards: [...p.querySelectorAll('.snap-card .snap-name')].map((x) => x.textContent), trans: [...p.querySelectorAll('.snap-link.on .snap-trans')].map((x) => x.textContent), thumbs: p.querySelectorAll('.snap-card img').length, at: [...p.querySelectorAll('.snap-card.at .snap-name')].map((x) => x.textContent) }; })()`);
      const thumbFile = s1 && s1.thumb ? fs.existsSync(path.join(store.cur.dir, 'snaps', s1.thumb)) : false;
      // the map bar: a camera with 2 on this map, it opens the timeline
      const pill = await js(gm, `(() => { const t = document.querySelector('#roster .map-tile[data-id="${lm.id}"] .snap-pill'); return t ? t.textContent.trim() : null; })()`);
      // a token moves; F1 brings snapshot 1 back (dark, rain, smoke off, the asset gone), the token stays where it is
      const tokX = tok ? tok.x + 2 : null; // (tok is the map's own layer: read it before it moves)
      if (tok) handle('layer.update', { mapId: lm.id, id: tok.id, x: tokX });
      const T = () => (tok ? L().layers.find((l) => l.id === tok.id) : null);
      const hasAsset = () => L().layers.some((l) => l.id === added.selected);
      gm.webContents.focus();
      await js(gm, 'document.activeElement && document.activeElement.blur()');
      await key('F1');
      await sleep(900);
      const f1 = { dark: L().light.darkness, rain: L().weather.layers.filter((l) => !l.dying).map((l) => l.type), smokeHidden: smoke ? L().fx.find((f) => f.id === smoke.id).hidden : null, asset: hasAsset(), tokX: T() ? T().x : null, at: L().snapAt === (s1 && s1.id) };
      const mo0 = state.moments.length;
      await key('F2');
      await sleep(900);
      const f2 = { dark: L().light.darkness, rain: L().weather.layers.filter((l) => !l.dying).length, smokeHidden: smoke ? L().fx.find((f) => f.id === smoke.id).hidden : null, asset: hasAsset(), tokX: T() ? T().x : null, moment: state.moments.slice(mo0).map((m) => m.id) };
      // one undo step takes it back
      await key('z', ['control']);
      await sleep(700);
      const undone = { dark: L().light.darkness, asset: hasAsset() };
      // See details on snapshot 2
      const more = await js(gm, `(() => { const b = document.querySelectorAll('${P} .snap-card .snap-more')[1]; if (!b) return null; const r = b.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
      if (more) await click(more.cx, more.cy);
      await sleep(500);
      const details = await js(gm, `(() => { const p = document.querySelector('.snap-pop'); return p ? { title: p.querySelector('.sp-title').textContent, trans: p.querySelector('.sp-trans').textContent, acts: [...p.querySelectorAll('.snap-act')].map((x) => x.textContent.trim()) } : null; })()`);
      await shot(gm, '47c-snapshot-details');
      await key('Escape');
      await sleep(200);
      // the map turns (with everything): snapshot 2's asset comes back where that spot lies now
      const rot0 = (L().bg && L().bg.rotation) || 0;
      const piv = { x: 10, y: 10 };
      handle('bg.turn', { mapId: lm.id, to: rot0 + 90, mode: 'all', pivot: piv, center: piv });
      await sleep(300);
      handle('snap.play', { id: s2.id });
      await sleep(400);
      const turned = L().layers.find((l) => l.id === added.selected);
      const turn = { x: turned && turned.x, y: turned && turned.y, rot: turned && turned.rotation }; // (3, 3) turned 90° round (10, 10): (17, 3)
      handle('bg.turn', { mapId: lm.id, to: rot0, mode: 'all', pivot: piv, center: piv });
      await sleep(300);
      // Next on the hotbar, and the fog tools: fog on/off, cover all, rectangles, a marked area (offered in the Fog menu)
      handle('snap.play', { id: s1.id, quiet: true });
      handle('hotbar.set', { slots: [] });
      const area = handle('area.add', { mapId: lm.id, name: 'Hall', rings: [[0, 0, 4, 0, 4, 4, 0, 4]] });
      await sleep(300);
      await js(gm, 'Play.Floats.closeAll()');
      await key('R');
      await sleep(500);
      const putOn = async (expr) => {
        const r = await js(gm, `(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
        if (!r) return false;
        await click(r.cx, r.cy, 'right');
        await sleep(250);
        await clickText('#menu .menu-item', 'Put on the hotbar');
        await sleep(300);
        return true;
      };
      const offered = [
        await putOn(`document.querySelector('#pop .ctl-toggle')`),
        await putOn(`[...document.querySelectorAll('#pop .btn')].find((b) => b.textContent.trim() === 'Cover all')`),
        await putOn(`[...document.querySelectorAll('#pop .seg-btn')].find((b) => b.textContent.trim() === 'Rectangle')`),
        await putOn(`[...document.querySelectorAll('#pop .area-row')].find((b) => b.textContent.includes('Hall'))`),
      ];
      handle('hotbar.set', { slots: [...(store.cur.meta.hotbar || []).slice(0, 4), { kind: 'snap', ref: 'next', label: 'Next snapshot', icon: 'player-track-next' }] });
      await sleep(400);
      const hot = (store.cur.meta.hotbar || []).slice(0, 5).map((x) => x && `${x.kind}:${typeof x.ref === 'object' ? 'area' : x.ref}`);
      await key('Escape'); await key('V');
      gm.webContents.focus();
      await js(gm, 'document.activeElement && document.activeElement.blur()');
      await shot(gm, '47d-fog-hotbar');
      await key('1'); await sleep(400);
      const h1 = L().fog.enabled;
      await key('2'); await sleep(400);
      const h2 = { base: L().fog.base, ops: L().fog.ops.length };
      await key('3'); await sleep(400);
      const h3 = await js(gm, '({ tool: Play.ui.tool, shape: Play.ui.fogShape })');
      await key('Escape'); await key('V');
      await key('4'); await sleep(500);
      const h4 = L().fog.ops.some((o) => o.shape === 'poly' && o.mode === 'reveal' && o.name === 'Hall');
      await key('5'); await sleep(900);
      const h5 = L().snapAt === (s2 && s2.id);
      await key('5'); await sleep(500);
      const lastToast = await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
      C.snaps21 = {
        panel, s1: s1 && { name: s1.name, dark: s1.data.light.darkness, rain: s1.data.weather.layers.length, tokens: s1.data.layers.filter((l) => l.role === 'token').length, thumb: !!s1.thumb, trans: !!(s1.trans && s1.trans.moment) },
        s2: s2 && { name: s2.name, moment: s2.trans && s2.trans.moment }, dlg, timeline, thumbFile, pill, f1, f2, tokX, undone, details, turn, base,
        offered, hot, h1, h2, h3, h4, h5, last: /last snapshot/.test(lastToast),
      };
      // tidy up
      handle('hotbar.set', { slots: [] });
      for (const s of [...(L().snaps || [])]) handle('snap.remove', { id: s.id });
      handle('layer.remove', { mapId: lm.id, id: added.selected });
      if (area && area.selected) handle('area.remove', { mapId: lm.id, id: area.selected });
      handle('light.update', { mapId: lm.id, darkness: base.dark });
      handle('weather.preset', { mapId: lm.id, name: 'None', layers: [] });
      if (smoke) handle('fx.update', { mapId: lm.id, id: smoke.id, hidden: base.smokeHidden });
      if (tok) handle('layer.update', { mapId: lm.id, id: tok.id, x: tokX - 2 });
      handle('fog.base', { mapId: lm.id, base: 'clear' });
      handle('fog.enabled', { mapId: lm.id, enabled: true });
      await js(gm, 'Play.Floats.closeAll()');
      await key('Escape'); await key('V');
      await sleep(300);
    }

    // ---------- 8s. 2.2: fog on/off without resending, a long fog folded, the hotbar moves (messages follow), Snapshots folded
    //      to one line, the save-changes question before the table sees it, Ready lists for Tokens and Talk ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      await js(gm, 'Play.Floats.closeAll()');
      const lm = L();
      handle('edit.open', { id: lm.id });
      await sleep(400);
      // fog on and off: the same fog object stays in the windows (nothing resent, nothing redrawn)
      handle('fog.enabled', { mapId: lm.id, enabled: true });
      await sleep(500);
      await js(gm, 'window.__fogObj = Play.view().map.fog; 1');
      handle('fog.enabled', { mapId: lm.id, enabled: false });
      await sleep(500);
      const fogOff = await js(gm, '({ same: Play.view().map.fog === window.__fogObj, on: Play.view().map.fog.enabled })');
      handle('fog.enabled', { mapId: lm.id, enabled: true });
      await sleep(500);
      const fogOn = await js(gm, '({ same: Play.view().map.fog === window.__fogObj, on: Play.view().map.fog.enabled })');
      // a long fog: 280 reveals are folded into one picture after a quiet moment (the newest 30 stay as they are)
      await js(gm, 'Play.holdBake(true)');
      handle('fog.base', { mapId: lm.id, base: 'cover' });
      for (let i = 0; i < 280; i++) handle('fog.op', { mapId: lm.id, mode: 'reveal', shape: 'circle', x: 2 + (i % 20) * 1.1, y: 2 + Math.floor(i / 20) * 0.9, r: 0.6 });
      // the TV draws every step first (on a busy machine that takes a while)
      for (let i = 0; i < 100 && (await js(W().player, 'window.__table.debug()')).fogOps !== L().fog.ops.length; i++) await sleep(200);
      await sleep(1500);
      // how bright the TV is, on average (the fog makes it darker): the same before and after folding
      const lum = async () => { const img = await W().player.webContents.capturePage(); const b = img.resize({ width: 160 }).toBitmap(); let sum = 0; for (let i = 0; i < b.length; i += 4) sum += b[i] + b[i + 1] + b[i + 2]; return Math.round((sum / (b.length / 4) / 3) * 10) / 10; };
      const seeBefore = await lum();
      await js(gm, 'Play.holdBake(false)');
      for (let i = 0; i < 60 && L().fog.ops.length > 40; i++) await sleep(200);
      await sleep(800);
      const fold = { ops: L().fog.ops.length, first: L().fog.ops[0].shape, kb: Math.round((L().fog.ops[0].png || '').length / 1024), tv: await lum(), before: seeBefore, tvOps: (await js(W().player, 'window.__table.debug()')).fogOps };
      handle('fog.base', { mapId: lm.id, base: 'clear' });
      handle('fog.enabled', { mapId: lm.id, enabled: false });
      await sleep(300);

      // the hotbar: dragged by its grip, remembered; messages appear just above it; a double-click puts it back
      const g = await rect('#hotbar .hb-grip');
      await dragPath({ x: g.cx, y: g.cy }, { x: g.cx - 260, y: g.cy - 220 }, 12);
      await sleep(300);
      await js(gm, `UI.toast('Above the hotbar', { ms: 3000 })`);
      await sleep(300);
      const hb = await js(gm, `(() => { const b = document.querySelector('#hotbar .hb-bar').getBoundingClientRect(); const t = [...document.querySelectorAll('.toast')].pop().getBoundingClientRect(); return { moved: JSON.parse(localStorage.getItem('hotbarPos') || 'null'), barTop: Math.round(b.top), barLeft: Math.round(b.left), toastBottom: Math.round(t.bottom), toastMid: Math.round(t.left + t.width / 2), barMid: Math.round(b.left + b.width / 2) }; })()`);
      await shot(gm, '48a-hotbar-moved');
      const g2 = await rect('#hotbar .hb-grip');
      await mouse('mouseMove', g2.cx, g2.cy);
      for (const n of [1, 2]) {
        gm.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(g2.cx), y: Math.round(g2.cy), button: 'left', clickCount: n });
        gm.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(g2.cx), y: Math.round(g2.cy), button: 'left', clickCount: n });
        await sleep(60);
      }
      await sleep(400);
      hb.back = await js(gm, `({ pos: localStorage.getItem('hotbarPos'), moved: document.getElementById('hotbar').classList.contains('moved') })`);

      // Snapshots folded: the timeline in one line in the panel's title bar; a click there plays one
      handle('light.update', { mapId: lm.id, darkness: 0 });
      const sA = handle('snap.save', { mapId: lm.id, name: 'Pipe normal' });
      handle('light.update', { mapId: lm.id, darkness: 0.45 });
      const sB = handle('snap.save', { mapId: lm.id, name: 'Pipe burst', trans: { moment: 'explosion' } });
      await js(gm, 'Play.Snaps.openFor(null)');
      await sleep(600);
      await js(gm, `document.querySelector('.fp[data-id="snaps"] .fp-fold').click()`);
      await sleep(400);
      const folded = await js(gm, `(() => { const p = document.querySelector('.fp[data-id="snaps"]'); const x = p.querySelector('.snap-compact'); return { folded: p.classList.contains('folded'), shown: !!x && getComputedStyle(x).display !== 'none', text: x ? x.textContent : null, bolt: !!p.querySelector('.sc-arrow.on'), w: Math.round(p.getBoundingClientRect().width) }; })()`);
      await shot(gm, '48b-snapshots-folded');
      await clickText('.fp[data-id="snaps"] .sc-snap', 'Pipe normal');
      await sleep(800);
      folded.played = L().light.darkness;
      handle('moment.stop', {});
      for (const id of [sA.id, sB.id]) handle('snap.remove', { id });
      await js(gm, `document.querySelector('.fp[data-id="snaps"] .fp-fold').click()`);
      await js(gm, 'Play.Floats.closeAll()');

      // the save-changes question: a map that is not on the table asks before it switches
      const other = store.cur.meta.chapters.flatMap((c) => c.maps).find((id) => id !== lm.id);
      handle('edit.open', { id: other });
      await sleep(900);
      const otherDark = store.map(other).light.darkness;
      handle('light.update', { mapId: other, darkness: 0 });
      const o1 = handle('snap.save', { mapId: other, name: 'Night 1' });
      handle('light.update', { mapId: other, darkness: 0.3 });
      const o2 = handle('snap.save', { mapId: other, name: 'Night 2' });
      handle('light.update', { mapId: other, darkness: 0.8 }); // changed since Night 2
      await sleep(500);
      gm.webContents.focus();
      await js(gm, 'document.activeElement && document.activeElement.blur()');
      await key('F1');
      await sleep(600);
      const ask = await js(gm, `(() => { const d = document.querySelector('.snap-ask'); return d ? { title: d.querySelector('h2').textContent, btns: [...d.querySelectorAll('.btn')].map((b) => b.textContent.trim()) } : null; })()`);
      await shot(gm, '48c-save-changes');
      await clickText('.snap-ask .btn', 'Save into Night 2');
      await sleep(1500);
      const om = store.map(other);
      const asked = { ask, saved: om.snaps.find((x) => x.id === o2.id).data.light.darkness, now: om.light.darkness, at: om.snapAt === o1.id };
      for (const id of [o1.id, o2.id]) handle('snap.remove', { id });
      handle('light.update', { mapId: other, darkness: otherDark });
      handle('edit.open', { id: lm.id });
      await sleep(900);

      // Ready lists: Ctrl-click two tokens in the library → Ready for this chapter; the Tokens menu shows them first; ✕ and Clear
      const chId = store.chapterOf(lm.id).id;
      handle('ready.set', { chapterId: chId, kind: 'tokens', items: [] });
      await js(gm, `Play.ui.lib.cat = 'tokens'; Play.ui.lib.shelf = null`);
      await key('L');
      await sleep(1500);
      await js(gm, `(() => { const seen = new Set(); const ts = [...document.querySelectorAll('#drawer .lt-tokens')].filter((t) => !seen.has(t.dataset.path) && seen.add(t.dataset.path)).slice(0, 2); for (const t of ts) t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); return ts.length; })()`);
      await sleep(300);
      const picks = await js(gm, `document.querySelector('.lib-picks') && document.querySelector('.lib-picks').textContent`);
      await shot(gm, '48d-library-picks');
      await clickSel('.lib-picks .btn.primary');
      await sleep(600);
      const readyN = ((store.chapterOf(lm.id).ready || {}).tokens || []).length;
      await key('Escape'); await key('Escape'); await key('V');
      await key('N');
      await sleep(800);
      const tokPop = await js(gm, `({ first: ([...document.querySelectorAll('#pop .tok-group')].map((g) => g.textContent).find((t) => /^Ready/.test(t)) || null), n: document.querySelectorAll('#pop .ready-row .tok-pick').length })`); // (4.7: the party first, then Ready)
      await shot(gm, '48e-tokens-ready');
      await js(gm, `document.querySelector('#pop .ready-row .ready-x').click()`);
      await sleep(500);
      const afterX = ((store.chapterOf(lm.id).ready || {}).tokens || []).length;
      await clickText('#pop .tg-clear', 'Clear');
      await sleep(500);
      const afterClear = ((store.chapterOf(lm.id).ready || {}).tokens || []).length;
      await key('Escape'); await key('V');
      // Talk: a portrait on the Ready list, all portraits folded away
      const port = (await js(gm, `window.ts.library('list')`)).find((x) => x.cat === 'portraits');
      handle('ready.set', { chapterId: chId, kind: 'portraits', items: port ? [{ path: port.path }] : [] });
      await key('O');
      await sleep(800);
      const talkPop = await js(gm, `({ groups: [...document.querySelectorAll('#pop .tok-group')].map((g) => g.textContent).filter((t) => /^Ready/.test(t)), more: [...document.querySelectorAll('#pop .btn')].some((b) => /List/.test(b.textContent)), ready: document.querySelectorAll('#pop .ready-row .talk-pick').length })`); // (4.7: List … instead of More)
      await key('Escape'); await key('V');
      handle('ready.set', { chapterId: chId, kind: 'portraits', items: [] });
      C.v22 = { fogOff, fogOn, fold, hb, folded, asked, picks, readyN, tokPop, afterX, afterClear, talkPop };
    }

    // ---------- 8t. 2.3: a snapshot with another picture brings its place, size and grid and where the map lay on the TV;
    //      animated assets baked into frame sheets (the little maid runs meanwhile), drawn from them on both screens with
    //      their shadows worked out once, what lies off the table resting; Options → Performance ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      await js(gm, 'Play.Floats.closeAll()');
      const lm = L();
      const dbg = () => js(W().player, 'window.__table.debug()');
      handle('edit.open', { id: lm.id });
      await sleep(400);
      const keep = { bg: { ...lm.bg }, view: { ...lm.view }, grid: { ...lm.grid } };
      const picA = lm.bg.path;
      const picB = [lib('Maps/Static/Demo dungeon.png'), lib('Maps/Animated/Demo dungeon (torchlight).mp4')].find((f) => f !== picA);
      const sc = lm.bg.scale || 0.01;
      handle('bg.update', { mapId: lm.id, x: 0.3, y: 0.2, scale: sc });
      handle('view.update', { mapId: lm.id, x: 0.5, y: 0.4, zoom: 1.1 });
      handle('grid.update', { mapId: lm.id, size: 1.05, ox: 0.2, oy: 0.3 });
      const sA = handle('snap.save', { mapId: lm.id, name: 'Cellar' });
      handle('bg.set', { mapId: lm.id, path: picB });
      handle('bg.update', { mapId: lm.id, x: -2, y: -1, scale: sc * 1.3 });
      handle('view.update', { mapId: lm.id, x: -1, y: 0.2, zoom: 0.8 });
      handle('grid.update', { mapId: lm.id, size: 1.3, ox: 0, oy: 0 });
      const sB = handle('snap.save', { mapId: lm.id, name: 'Street' });
      const look = () => { const m = L(); return { pic: m.bg.path === picA ? 'A' : m.bg.path === picB ? 'B' : m.bg.path, x: m.bg.x, y: m.bg.y, scale: m.bg.scale, view: { x: m.view.x, y: m.view.y, zoom: m.view.zoom }, grid: { size: m.grid.size, ox: m.grid.ox, oy: m.grid.oy } }; };
      const tvLook = async () => { for (let i = 0; i < 30; i++) { const v = (await dbg()).mapView; if (v && v.bg && v.bg.path === L().bg.path && v.zoom === L().view.zoom) return v; await sleep(150); } return (await dbg()).mapView; };
      handle('snap.play', { id: sA.id });
      await sleep(1200);
      const snapFix = { toA: look(), tvA: await tvLook() };
      await shot(W().player, '49a-snapshot-cellar');
      handle('snap.play', { id: sB.id });
      await sleep(1200);
      snapFix.toB = look(); snapFix.tvB = await tvLook();
      handle('view.update', { mapId: lm.id, x: -0.5, y: 0.1, zoom: 0.9 }); // moved at the table
      handle('snap.play', { id: sB.id }); // the same picture: the map stays where it is now
      await sleep(800);
      snapFix.sameKeeps = look().view;
      handle('snap.play', { id: sA.id });
      await sleep(800);
      for (const id of [sA.id, sB.id]) handle('snap.remove', { id });
      handle('bg.update', { mapId: lm.id, x: keep.bg.x, y: keep.bg.y, scale: keep.bg.scale });
      handle('view.update', { mapId: lm.id, ...keep.view });
      handle('grid.update', { mapId: lm.id, size: keep.grid.size, ox: keep.grid.ox, oy: keep.grid.oy });
      snapFix.restored = L().bg.path === picA && L().view.zoom === keep.view.zoom;
      await sleep(600);

      // animated assets: baked once (the maid runs), then both screens draw the frames instead of playing videos
      const orb = lib('Assets/Animated/Magic orb.webm');
      const ids0 = new Set(L().layers.map((l) => l.id));
      handle('layer.add', { mapId: lm.id, path: orb, role: 'asset', x: 6, y: 5, w: 2, shadow: true });
      handle('layer.add', { mapId: lm.id, path: orb, role: 'asset', x: 9, y: 5, w: 2 });
      handle('layer.add', { mapId: lm.id, path: orb, role: 'asset', x: -40, y: -40, w: 2 }); // off the table
      const orb2 = lib('Assets/Animated/Magic orb (copy).webm'); // a second file: baked one after the other
      fs.copyFileSync(orb, orb2);
      handle('layer.add', { mapId: lm.id, path: orb2, role: 'asset', x: 12, y: 6, w: 1.5 });
      const orbIds = L().layers.filter((l) => !ids0.has(l.id)).map((l) => l.id);
      const pill = () => js(gm, `(() => { const e = document.querySelector('.anim-pill'); return e && !e.hidden ? { text: e.querySelector('.anim-text').textContent, done: e.classList.contains('done'), maid: e.querySelector('.anim-maid').getAttribute('src'), x: Math.round(e.getBoundingClientRect().left), bottom: Math.round(innerHeight - e.getBoundingClientRect().bottom) } : null; })()`);
      let during = null;
      for (let i = 0; i < 40 && !(during && /Preparing animations/.test(during.text)); i++) { during = await pill(); await sleep(100); }
      const early = (await dbg()).anim;
      await shot(gm, '49b-baking-maid');
      // (on this slow test screen a video is played slower while it is baked, so this can take a while)
      for (let i = 0; i < 400; i++) { const st = await js(gm, '({ busy: !!AnimBaker.busy, left: AnimBaker.status ? AnimBaker.status.left : -1 })'); if (!st.busy && st.left === 0) break; await sleep(250); }
      await sleep(300);
      const after = await pill();
      await shot(gm, '49c-baked');
      let tv1 = null;
      for (let i = 0; i < 60; i++) { tv1 = (await dbg()).anim; if (tv1 && tv1.baked === tv1.animated && tv1.shadows >= 1) break; await sleep(200); }
      await sleep(1500);
      const tv2 = (await dbg()).anim;
      const gmA = await js(gm, 'Play.view().animInfo()');
      await shot(W().player, '49d-table-baked');
      let cacheFiles = [];
      try { cacheFiles = fs.readdirSync(lib('.cache/anim')); } catch {}
      // made bigger: a sharper sheet is baked and taken
      handle('layer.update', { mapId: lm.id, id: orbIds[1], w: 8 });
      await sleep(1500);
      for (let i = 0; i < 400; i++) { const st = await js(gm, '({ busy: !!AnimBaker.busy, left: AnimBaker.status ? AnimBaker.status.left : -1 })'); if (!st.busy && st.left === 0) break; await sleep(250); }
      let tiers = [];
      for (let i = 0; i < 30; i++) { tiers = (await dbg()).anim.tiers; if (tiers.some((t) => t >= 384)) break; await sleep(200); }
      // the GM screen: Still stands them still, Lighter is the default
      await js(gm, `window.ts.settings({ gmAnim: 'still' })`);
      await sleep(600);
      const still = await js(gm, 'Play.view().animInfo()');
      await js(gm, `window.ts.settings({ gmAnim: 'light' })`);
      await sleep(400);
      // Options → Performance shows the cache; Clear the cache bakes again what the maps use
      await clickSel('.rail-btn[data-id="table"]');
      await sleep(300);
      await clickText('.modal.options .opt-tab', 'Performance');
      await sleep(900);
      const perf = await js(gm, `({ line: (document.querySelector('.modal.options .anim-cache-line') || {}).textContent, labels: [...document.querySelectorAll('.modal.options .ctl-label')].map((l) => l.textContent.trim()), btns: [...document.querySelectorAll('.modal.options .anim-perf .btn')].map((b) => b.textContent.trim()) })`);
      await shot(gm, '49e-performance');
      await clickText('.modal.options .anim-perf .btn', 'Clear the cache');
      await sleep(400);
      perf.ask = await js(gm, `(() => { const d = [...document.querySelectorAll('.modal')].pop(); return d ? d.textContent : null; })()`);
      await clickText('.modal .btn.danger', 'Clear the cache'); // 2.5: it asks first
      await sleep(400);
      const cleared = (() => { try { return fs.readdirSync(lib('.cache/anim')).length; } catch { return -1; } })();
      let rebaked = false;
      for (let i = 0; i < 400; i++) { const st = await js(gm, '({ busy: !!AnimBaker.busy, left: AnimBaker.status ? AnimBaker.status.left : -1 })'); if (!st.busy && st.left === 0 && fs.readdirSync(lib('.cache/anim')).length >= 2) { rebaked = true; break; } await sleep(250); }
      await key('Escape');
      for (const id of orbIds) handle('layer.remove', { mapId: lm.id, id });
      try { fs.unlinkSync(orb2); } catch {}
      await sleep(500);
      C.v23 = { snapFix, during, early, after, tv1, tv2, gmA, cacheFiles: cacheFiles.length, tiers, still: { mode: still.mode, running: still.running }, perf, cleared, rebaked, stats: await js(gm, 'AnimBaker.stats') };
    }

    // ---------- 8u. 2.4: long names wrap (panels keep their width), every panel opens with things selected and a Layers
    //      row open (Layers stayed invisible), bake rules (frame rate first), the benchmark ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      await js(gm, 'Play.Floats.closeAll()');
      const lm = L();
      const dbg = () => js(W().player, 'window.__table.debug()');
      handle('edit.open', { id: lm.id });
      await sleep(400);
      const longName = 'AsteroidDiskIron02_01_Regular_Red_600x600_with_a_very_long_name';
      const longFile = lib(`Assets/Nature/${longName}.png`);
      fs.copyFileSync(lib('Assets/Nature/Oak tree.png'), longFile);
      const ids0 = new Set(L().layers.map((l) => l.id));
      handle('layer.add', { mapId: lm.id, path: longFile, role: 'asset', x: 8, y: 6, w: 2 });
      const la = L().layers.find((l) => !ids0.has(l.id));
      const tok = L().layers.find((l) => l.role === 'token');
      await js(gm, `Play.setTool('asset'); Play.ui.brush = { path: ${JSON.stringify(longFile)}, name: ${JSON.stringify(longName)}, kind: 'image' }; Play.ui.selAssets = [${JSON.stringify(la.id)}]; Play.view().setSelectedAssets && Play.view().setSelectedAssets(Play.ui.selAssets); Play.openPop('asset')`);
      await sleep(600);
      const width = (sel) => js(gm, `(() => { const p = document.getElementById('pop'); const e = p.querySelector(${JSON.stringify(sel)}); return { w: Math.round(p.getBoundingClientRect().width), over: p.scrollWidth - p.clientWidth, lines: e ? Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) : 0, tip: e ? e.getAttribute('data-tip') : null }; })()`);
      const assetW = await width('.look-head .wrap-name');
      await shot(gm, '50a-long-name-assets');
      await js(gm, `Play.ui.expanded = ${JSON.stringify(la.id)}; Play.closePop(); Play.openPop('layers')`);
      await sleep(500);
      const layersW = { ...(await width(`.layer-row[data-id="${la.id}"] .wrap-name`)), open: await js(gm, `!!document.querySelector('#pop.on .layer-detail') && !/ran into a problem/.test(document.getElementById('pop').textContent)`) };
      await shot(gm, '50b-long-name-layers');
      // every panel, with a token and an asset selected and a Layers row open
      await js(gm, `Play.closePop(); Play.ui.selected = ${JSON.stringify(tok ? tok.id : null)}; Play.ui.expanded = ${JSON.stringify(la.id)}`);
      const panels = await js(gm, `(() => { const out = {}; for (const id of ['map', 'fog', 'fx', 'walls', 'party', 'spell', 'asset', 'layers', 'grid', 'sound', 'table', 'token', 'point', 'draw', 'mark', 'notes', 'timer', 'talk', 'toolbox', 'round']) { Play.openPop(id); const p = document.getElementById('pop'); out[id] = p.classList.contains('on') && !/ran into a problem/.test(p.textContent) && p.querySelector('.pop-body').childElementCount > 0 && p.scrollWidth - p.clientWidth <= 1; } Play.closePop(); return out; })()`);
      await js(gm, `Play.ui.selected = null; Play.ui.expanded = null; Play.ui.selAssets = []; Play.setTool('select')`);
      handle('layer.remove', { mapId: lm.id, id: la.id });
      try { fs.unlinkSync(longFile); } catch {}
      // bake rules: the file's own speed up to 30 a second; smaller frames before fewer; below 20 a second blended
      const plans = await js(gm, `[[2, 256], [10, 256], [20, 256], [10, 512]].map(([dur, tier]) => { const p = AnimBaker.plan({ sw: 600, sh: 600, dur, src: 30, tier }); return { dur, tier, px: p.fw, fps: Math.round(p.fps * 10) / 10, blend: p.blend, mp: Math.round(p.n * p.fw * p.fh / 1e5) / 10, per: p.per, pieces: p.pieces }; })`);
      const plan24 = await js(gm, `(() => { const p = AnimBaker.plan({ sw: 320, sh: 320, dur: 2, src: 24, tier: 256 }); return { fps: p.fps, n: p.n, blend: p.blend }; })()`);
      // the benchmark: once (short here), then videos vs baked; the orb gives it an animation to look at
      const orb = lib('Assets/Animated/Magic orb.webm');
      const ids1 = new Set(L().layers.map((l) => l.id));
      handle('layer.add', { mapId: lm.id, path: orb, role: 'asset', x: 6, y: 5, w: 2 });
      const orbId = L().layers.find((l) => !ids1.has(l.id)).id;
      await sleep(1200);
      for (let i = 0; i < 240; i++) { const a = (await dbg()).anim; const st = await js(gm, '({ busy: !!AnimBaker.busy, left: AnimBaker.status ? AnimBaker.status.left : -1 })'); if (a && a.baked === 1 && !st.busy && st.left === 0) break; await sleep(250); }
      await sleep(1000);
      const orbTv = (await dbg()).anim;
      const benchN0 = (await js(gm, `window.ts.bench('list')`)).length;
      const st1 = await js(gm, `window.ts.bench('start', { mode: 'normal', seconds: 4 })`);
      await sleep(1500);
      const busy1 = await js(gm, `window.ts.bench('running')`);
      for (let i = 0; i < 40 && (await js(gm, `window.ts.bench('running')`)); i++) await sleep(500);
      const st2 = await js(gm, `window.ts.bench('start', { mode: 'compare', seconds: 4 })`);
      await sleep(5500);
      const asVideos = (await dbg()).anim;
      for (let i = 0; i < 60 && (await js(gm, `window.ts.bench('running')`)); i++) await sleep(500);
      await sleep(2500);
      const backBaked = (await dbg()).anim;
      const results = (await js(gm, `window.ts.bench('list')`)).slice(benchN0);
      const noTable = null;
      await clickSel('.rail-btn[data-id="table"]');
      await sleep(300);
      await clickText('.modal.options .opt-tab', 'Performance');
      await sleep(1200);
      const benchUi = await js(gm, `({ cards: document.querySelectorAll('.modal.options .bench-card').length, pair: !!document.querySelector('.modal.options .bench-card.pair'), btns: [...document.querySelectorAll('.modal.options .bench .btn')].map((b) => b.textContent.trim()), rows: [...document.querySelectorAll('.modal.options .anim-row')].map((r) => r.textContent) })`);
      await js(gm, `document.querySelector('.modal.options .opt-body').scrollTop = 99999`);
      await sleep(200);
      await shot(gm, '50c-benchmark');
      await key('Escape');
      handle('layer.remove', { mapId: lm.id, id: orbId });
      let logText = '';
      try { logText = fs.readFileSync(path.join(app.getPath('userData'), 'logs', 'tablescape.log'), 'utf8'); } catch {}
      C.v24 = { assetW, layersW, panels, plans, plan24, orbTv, st1, busy1: !!busy1, st2, asVideos, backBaked, results: results.map((r) => ({ label: r.label, pair: !!r.pair, tv: r.tv, gm: r.gm, cpu: r.cpu, mem: r.mem, anim: r.anim })), benchUi,
        logBench: (logText.match(/benchmark/g) || []).length, logBaked: (logText.match(/\] baked "/g) || []).length, noTable };
    }

    // ---------- 8v. 2.5: the maid's pill at the top centre; baking pauses on a full disk; long animations streamed in
    //      pieces; a lasting moment ends with its snapshot; frames drawn by the processor; the benchmark measures the
    //      animations themselves ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      await js(gm, 'Play.Floats.closeAll()');
      const lm = L();
      const dbg = () => js(W().player, 'window.__table.debug()');
      handle('edit.open', { id: lm.id });
      await sleep(400);
      // a full disk: baking waits (the pill says why), and goes on once there is room
      process.env.TS_TEST_DISK_FREE = String(100 * 1048576);
      await js(gm, 'AnimCache.setWholeLimit(1e6)'); await js(W().player, 'AnimCache.setWholeLimit(1e6)'); // the orb streamed, as a long one would be
      const orb3 = lib('Assets/Animated/Magic orb (stream).webm');
      fs.copyFileSync(lib('Assets/Animated/Magic orb.webm'), orb3);
      const ids0 = new Set(L().layers.map((l) => l.id));
      handle('layer.add', { mapId: lm.id, path: orb3, role: 'asset', x: 7, y: 4, w: 3 });
      const sid = L().layers.find((l) => !ids0.has(l.id)).id;
      let paused = null;
      for (let i = 0; i < 30 && !(paused && /paused/.test(paused.text)); i++) { await sleep(300); paused = await js(gm, `(() => { const e = document.querySelector('.anim-pill'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { text: e.querySelector('.anim-text').textContent, top: Math.round(r.top), mid: Math.round(r.left + r.width / 2), win: innerWidth }; })()`); }
      const perfDisk = await js(gm, `window.ts.anim('info')`);
      await shot(gm, '51a-pill-top-paused');
      delete process.env.TS_TEST_DISK_FREE;
      await sleep(5600);
      handle('light.update', { mapId: lm.id, darkness: L().light.darkness }); // any change looks again
      await sleep(1500);
      for (let i = 0; i < 400; i++) { const a = (await dbg()).anim; const st = await js(gm, '({ busy: !!AnimBaker.busy, left: AnimBaker.status ? AnimBaker.status.left : -1 })'); if (a && a.baked === a.animated && a.animated >= 1 && !st.busy && st.left === 0) break; await sleep(250); }
      await sleep(2000);
      const streamTv = { info: (await dbg()).anim, cache: await js(W().player, 'AnimCache.debug()'), stats: await js(W().player, 'AnimCache.stats') };
      // frames drawn by the graphics card (Beta 1: the processor is the default)
      const cpuDefault = { setting: settings.animDraw, mode: (await dbg()).anim.drawMode };
      await js(gm, `window.ts.settings({ animDraw: 'gpu' })`);
      await sleep(1200);
      const d0 = (await dbg()).anim.draws;
      await sleep(1500);
      const cpu = { mode: (await dbg()).anim.drawMode, more: (await dbg()).anim.draws - d0, cpuDefault };
      // Beta 1: the memory ceiling: the streamed orb read again whole (all its pieces kept); the ceiling squeezed to
      // almost nothing, the pieces not being shown go and the animation streams from then on; drawing goes on
      await js(W().player, 'AnimCache.setWholeLimit(8e6)');
      await js(W().player, `AnimCache.reload(${JSON.stringify(orb3)})`);
      await sleep(2000);
      const memBefore = await js(W().player, `({ used: AnimCache.stats.usedPx, budget: AnimCache.stats.budgetPx, kept: AnimCache.debug().reduce((n, e) => n + e.kept, 0), whole: (AnimCache.debug().find((e) => e.path === ${JSON.stringify(orb3)}) || {}).whole })`);
      await js(W().player, 'AnimCache.setBudget(1000)');
      await sleep(2200);
      const memAfter = await js(W().player, `({ used: AnimCache.stats.usedPx, demotions: AnimCache.stats.demotions, reclaimed: AnimCache.stats.reclaimed, kept: AnimCache.debug().reduce((n, e) => n + e.kept, 0), demoted: (AnimCache.debug().find((e) => e.path === ${JSON.stringify(orb3)}) || {}).demoted, draws: 0 })`);
      const dr0 = (await dbg()).anim.draws; await sleep(1200); memAfter.draws = (await dbg()).anim.draws - dr0;
      await js(W().player, `AnimCache.setBudget(${Math.round(memBefore.budget)})`);
      await js(W().player, 'AnimCache.setWholeLimit(1e6)');
      const mem = { before: memBefore, after: memAfter };
      await js(gm, `window.ts.settings({ animDraw: 'gpu' })`);
      await js(gm, 'AnimCache.setWholeLimit(8e6)'); await js(W().player, 'AnimCache.setWholeLimit(8e6)');
      // the benchmark measures the animations themselves
      const n0 = (await js(gm, `window.ts.bench('list')`)).length;
      await js(gm, `window.ts.bench('start', { mode: 'normal', seconds: 4 })`);
      await sleep(1500);
      for (let i = 0; i < 40 && (await js(gm, `window.ts.bench('running')`)); i++) await sleep(500);
      const bres = (await js(gm, `window.ts.bench('list')`)).slice(n0)[0] || null;
      handle('layer.remove', { mapId: lm.id, id: sid });
      try { fs.unlinkSync(orb3); } catch {}
      // a lasting moment a snapshot brought ends when the next snapshot comes
      handle('light.update', { mapId: lm.id, darkness: 0 });
      const g1 = handle('snap.save', { mapId: lm.id, name: 'Gas' });
      handle('light.update', { mapId: lm.id, darkness: 0.2 });
      const g2 = handle('snap.save', { mapId: lm.id, name: 'After', trans: { moment: 'gas' } });
      handle('snap.play', { id: g1.id }); await sleep(300);
      await js(gm, `document.querySelectorAll('.snap-keep-back').forEach((b) => b.remove())`);
      handle('snap.play', { id: g2.id }); await sleep(600);
      const gasOn = state.moments.filter((m) => m.id === 'gas' && !m.stop).length;
      handle('snap.play', { id: g1.id }); await sleep(600);
      const gasAfter = state.moments.filter((m) => m.id === 'gas' && !m.stop).length;
      // one started from the Toolbox stays
      handle('moment.play', { id: 'gas' }); handle('snap.play', { id: g2.id }); await sleep(300); handle('snap.play', { id: g1.id }); await sleep(300);
      const gasOwn = state.moments.filter((m) => m.id === 'gas' && !m.stop).length;
      handle('moment.stop', {});
      await js(gm, `document.querySelectorAll('.snap-keep-back').forEach((b) => b.remove())`);
      for (const id of [g1.id, g2.id]) handle('snap.remove', { id });
      C.v25 = { paused, perfDisk: { free: perfDisk.free, low: perfDisk.low, paused: perfDisk.paused }, streamTv, cpu, mem, bench: bres && { motion: bres.motion, animDraw: bres.animDraw, gmAnim: bres.gmAnim }, gasOn, gasAfter, gasOwn };
    }

    // ---------- 9. library drawer: open with L, thumbnails, drag a token onto the map ----------
    await js(gm, `Play.ui.lib.cat = 'all'; Play.ui.lib.shelf = null; Play.ui.lib.full = false`);
    await key('L');
    await sleep(600);
    C.drawer = await js(gm, `({ open: !!document.querySelector('#drawer.on'), tiles: document.querySelectorAll('#drawer .lt').length })`);
    await sleep(2500); // thumbnails
    C.drawerThumbs = await js(gm, `document.querySelectorAll('#drawer .lt .thumb.loaded').length`);
    await shot(gm, '14-library');
    const layersBefore = L().layers.length;
    const dropAt = { x: vp.x + vp.w * 0.7, y: vp.y + vp.h * 0.3 };
    C.dropResult = await js(gm, `(() => {
      const tile = [...document.querySelectorAll('#drawer .lt')].find((t) => t.textContent.includes('Ogre'));
      if (!tile) return 'no tile';
      const dt = new DataTransfer();
      tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const vp = document.getElementById('viewport');
      const o = { bubbles: true, cancelable: true, clientX: ${dropAt.x}, clientY: ${dropAt.y}, dataTransfer: dt };
      vp.dispatchEvent(new DragEvent('dragover', o));
      vp.dispatchEvent(new DragEvent('drop', o));
      return 'dropped';
    })()`);
    await sleep(500);
    C.dropAdded = L().layers.length - layersBefore;
    await key('Escape');

    // ---------- 10. prep another map: table keeps showing the live one, preloads the next ----------
    const firstLive = state.liveMapId;
    await key('2', ['alt']); // 2.0: Alt + a number opens a map of this chapter (the numbers are the hotbar's)
    await sleep(1500);
    C.prep = { edit: state.editMapId, live: state.liveMapId, differ: state.editMapId !== state.liveMapId, topbar: await js(gm, `!!document.querySelector('#topbar.on .bar-prep')`), frame: await js(gm, 'document.getElementById("frame").className') };
    const dbgPrep = await js(player, 'window.__table.debug()');
    C.tablePrep = { liveStill: dbgPrep.liveId === firstLive, views: dbgPrep.views.length, prepPaused: dbgPrep.prepPaused };
    await shot(gm, '15-prep-second-map');
    // send it: crossfade
    const ambOf = async () => (await snd()).tracks.find((x) => x.key.startsWith('amb:')) || null;
    // not while the 16-second drone is looping round (its next pass fades in near the end)
    for (let i = 0; i < 90; i++) { const a = await ambOf(); if (!a || (a.voices === 1 && a.t > 0.5 && a.t < 9)) break; await sleep(200); }
    const amb0 = await ambOf();
    await clickSel('#topbar .btn.primary');
    await sleep(2200);
    const dbgX = await js(player, 'window.__table.debug()');
    const amb1 = await ambOf();
    C.crossfade = { liveId: dbgX.liveId, expected: state.editMapId, shown: dbgX.shown, views: dbgX.views.length, ambienceSame: !!amb0 && !!amb1 && amb0.key === amb1.key && amb1.playing && amb1.t > amb0.t, amb: [amb0, amb1], night: dbgX.fx };
    await shot(player, '16-table-second-map');

    // ---------- 11. blackout (B) ----------
    await key('B');
    await sleep(600);
    C.blackout = { table: (await js(player, 'window.__table.debug()')).blackout, frame: await js(gm, 'document.getElementById("frame").className') };
    await shot(gm, '17-blackout');
    await key('B');

    // ---------- 12. roster: collapse with Tab, chapter menu ----------
    await key('Tab');
    await sleep(200);
    C.rosterCollapsed = await js(gm, `document.getElementById('roster').classList.contains('collapsed')`);
    await shot(gm, '18-roster-collapsed');
    await key('Tab');
    await clickSel('.chapter-btn');
    await sleep(200);
    C.chapterMenu = await js(gm, `[...document.querySelectorAll('#menu.on .menu-item')].map((b) => b.textContent.trim())`);
    await shot(gm, '19-chapter-menu');
    await key('Escape');
    await click(vp.x + 30, vp.y + 30);

    // ---------- 13. layers, sound, table and map popovers ----------
    C.foldLive = await js(gm, `document.querySelector('.g-build').classList.contains('folded')`);
    await clickSel('.rail-btn[data-id="build"]');
    await sleep(200);
    C.unfolded = await js(gm, `!document.querySelector('.g-build').classList.contains('folded') && !!document.querySelector('.rail-btn[data-id="sound"]').offsetParent`);
    await key('K');
    await sleep(250);
    C.layersPop = await js(gm, `({ rows: document.querySelectorAll('#pop.on .layer-row').length, groups: [...document.querySelectorAll('#pop.on .layer-group')].map((g) => g.textContent) })`);
    await shot(gm, '20-layers');
    await key('Escape');
    await clickSel('.rail-btn[data-id="sound"]');
    await sleep(250);
    await shot(gm, '21-sound');
    await key('Escape');
    await clickSel('.rail-btn[data-id="table"]');
    await sleep(250);
    await shot(gm, '22-options');
    await key('Escape');
    await key('M');
    await sleep(250);
    await shot(gm, '23-map-popover');
    await key('Escape');
    await key('V');

    // ---------- 14. grid: match a tilted printed grid (only the grid changes), hex grids ----------
    {
      await clickSel('.rail-btn[data-id="grid"]');
      await sleep(200);
      await shot(gm, '24-grid');
      const m = E();
      const bg0 = JSON.stringify(m.bg); const view0 = JSON.stringify(m.view);
      await clickText('#pop .btn', 'printed grid');
      await sleep(250);
      if (!(await js(gm, `!!document.querySelector('#topbar.on .bar-mode')`))) { await clickText('#pop .btn', 'printed grid'); await sleep(250); }
      C.alignBar = await js(gm, `!!document.querySelector('#topbar.on .bar-mode')`);
      // a printed grid of 0.9" squares tilted by 12°: drag across 3 of them
      const s = 0.9; const th = (12 * Math.PI) / 180;
      const A = { x: 8, y: 6 };
      const B = { x: A.x + 3 * s * (Math.cos(th) - Math.sin(th)), y: A.y + 3 * s * (Math.sin(th) + Math.cos(th)) };
      await shot(gm, '25-align-mode');
      await dragPath(await scr(A.x, A.y), await scr(B.x, B.y), 10);
      await sleep(300);
      // a slow machine can miss the first press: try once more while the align bar is still up
      let alignRetry = 0;
      if (Math.abs(E().grid.angle - 12) > 1 && await js(gm, `!!document.querySelector('#topbar.on .bar-mode')`)) { alignRetry = 1; await dragPath(await scr(A.x, A.y), await scr(B.x, B.y), 10); await sleep(400); }
      const g = E().grid;
      C.alignTilt = { size: r2(g.size), angle: r2(g.angle), ox: r2(g.ox), oy: r2(g.oy), bgSame: JSON.stringify(E().bg) === bg0, viewSame: JSON.stringify(E().view) === view0, type: g.type, retry: alignRetry, bar: await js(gm, `!!document.querySelector('#topbar.on .bar-mode')`) };
      await shot(gm, '26-aligned-tilted');

      // hex rows
      await clickSel('.rail-btn[data-id="grid"]');
      await sleep(200);
      await clickText('#pop .seg-btn', 'Hex rows');
      await sleep(200);
      C.hexType = E().grid.type;
      const alignOn = () => js(gm, `!!document.querySelector('#topbar.on .bar-mode')`);
      await clickText('#pop .btn', 'printed grid');
      await sleep(250);
      if (!(await alignOn())) { await clickText('#pop .btn', 'printed grid'); await sleep(250); } // the popover was still settling
      const hs = 1.1; const ha = (20 * Math.PI) / 180;
      const H0 = { x: 10, y: 8 }; const H1 = { x: H0.x + 3 * hs * Math.cos(ha), y: H0.y + 3 * hs * Math.sin(ha) }; // 3 steps (the bar's default)
      await dragPath(await scr(H0.x, H0.y), await scr(H1.x, H1.y), 10);
      await sleep(300);
      let hexRetry = 0;
      if (Math.abs(E().grid.angle - 20) > 1 && await alignOn()) { hexRetry = 1; await dragPath(await scr(H0.x, H0.y), await scr(H1.x, H1.y), 10); await sleep(400); }
      const hg = E().grid;
      C.alignHex = { size: r2(hg.size), angle: r2(hg.angle), bgSame: JSON.stringify(E().bg) === bg0, retry: hexRetry };
      // a token snaps to hex centres
      const add = handle('layer.add', { path: lib('Tokens/Goblin.png'), role: 'token', x: 14.3, y: 9.2 });
      await sleep(300);
      const ht = await rect(`.sv-token[data-id="${add.selected}"]`);
      await dragPath({ x: ht.cx, y: ht.cy }, { x: ht.cx + 37, y: ht.cy + 23 }, 5);
      const hTok = E().layers.find((l) => l.id === add.selected);
      C.hexSnap = await js(gm, `(() => { const g = Play.view().map.grid; const h = Geom.hexAt(g, ${hTok.x}, ${hTok.y}); const c = Geom.hexCenter(g, h.q, h.r); return Math.hypot(c.x - ${hTok.x}, c.y - ${hTok.y}) < 0.001; })()`);
      // scale the map so one cell is one inch
      await clickSel('.rail-btn[data-id="grid"]');
      await sleep(200);
      await clickText('#pop .btn', 'Make grid squares 1 inch');
      await sleep(500);
      C.oneInch = { zoom: r2(E().view.zoom), cellOnTable: r2(E().view.zoom * E().grid.size), bgSame: JSON.stringify(E().bg) === bg0 };
      await key('Escape');
      await sleep(300);
      C.tableGrid = await js(player, `window.__table.coverage('grid')`);
      await shot(gm, '27-hex-grid');
      await shot(player, '27b-table-hex-grid');
    }

    // rename a map through the right-click menu and the name dialog
    await clickSel('.map-tile.is-edit', 'right');
    await sleep(200);
    await clickText('#menu.on .menu-item', 'Rename');
    await sleep(200);
    gm.focus();
    gm.webContents.focus();
    await sleep(100);
    await gm.webContents.insertText('Upper hall'); // replaces the pre-selected name
    await sleep(100);
    await key('Enter');
    await sleep(400);
    C.renamed = E().name;
    await sleep(600); // (4.0.1: right after Enter in a field, typing goes on being typing, not keys)

    await key('?');
    await sleep(200);
    C.help = await js(gm, `!!document.querySelector('.help-sheet') && !!document.querySelector('.help-cols')`);
    await shot(gm, '28-help');
    await key('Escape');
    await sleep(200);

    // ---------- 15. calibration ----------
    handle('table.calibrate', { on: true });
    await sleep(600);
    C.calibrating = (await js(player, 'window.__table.debug()')).calibrating;
    await shot(player, '29-table-calibration');
    handle('table.calibrate', { on: false });

    // ---------- 16. persistence: save, reopen, compare ----------
    const id = store.cur.meta.id;
    const sig = () => store.allMapIds().map((mid) => { const mm = store.map(mid); return [mid, mm.fog.ops.length, mm.layers.length, mm.fx.length, mm.grid.type, r2(mm.grid.angle), r2(mm.view.zoom), mm.weather.layers.length, mm.draw.length, mm.marks.length]; });
    const before = sig();
    store.flush();
    // files of maps that still exist (deleted ones are only cleared out the next time the campaign opens)
    const files = fs.readdirSync(path.join(store.cur.dir, 'maps')).filter((f) => store.allMapIds().includes(f.slice(0, -5)));
    handle('campaign.home');
    await sleep(800);
    await shot(gm, '30-home-after');
    await clickSel('.home-actions .btn:last-child');
    await sleep(300);
    C.tableSetup = await js(gm, `!!document.querySelector('.modal.options')`) && await (async () => { await clickText('.modal.options .opt-tab', 'TV'); await sleep(300); return js(gm, `!!document.querySelector('.modal.options .opt-tab.on[data-id="tv"]') && !!document.querySelector('.modal.options .opt-body select')`); })();
    await key('Escape');
    await sleep(200);
    // Beta 1: ? also works on the start screen, and the Guide button opens the first-evening page
    await js(gm, 'document.activeElement && document.activeElement.blur()');
    await key('?');
    await sleep(300);
    C.helpHome = await js(gm, `!!document.querySelector('.help-sheet .help-cols')`);
    await key('Escape');
    await sleep(200);
    await js(gm, `[...document.querySelectorAll('.home-actions .btn')].find((b) => /Guide/.test(b.textContent)).click()`);
    await sleep(700);
    C.guideStart = await js(gm, `(() => { const t = document.querySelector('.guide-tab.on'); const b = document.querySelector('.guide-body'); return { tab: t && t.textContent.trim(), text: b && b.textContent.slice(0, 80), tabs: [...document.querySelectorAll('.guide-tab')].map((x) => x.textContent.trim()) }; })()`);
    await shot(gm, '30b-guide');
    await key('Escape');
    await sleep(200);
    handle('campaign.open', { id });
    handle('campaign.play');
    const after = sig();
    C.persist = { mapFiles: files.length, same: JSON.stringify(before) === JSON.stringify(after), before, after };

    // ---------- 17. new campaign starts with a chapter and a map ----------
    handle('campaign.home');
    const r = handle('campaign.create', { name: 'Test campaign' });
    C.newCampaign = { ok: r.ok, chapters: store.cur.meta.chapters.length, maps: store.allMapIds().length, screen: state.screen };
    await sleep(700);
    await shot(gm, '31-new-campaign');
    C.libraryFolders = fs.readdirSync(library.root);

    // ---------- 18. Alpha 1.0: a backup each time a campaign opens, earlier versions, missing files ----------
    {
      const cid = store.cur.meta.id;
      const cdir = store.findDir(cid);
      await js(gm, `window.ts.settings({ ppi: ${ppi} })`); // calibrated: the last of the first steps
      C.tips = await js(gm, `window.ts.app('tips')`);
      // a map whose picture is then moved to another library folder
      fs.copyFileSync(lib('Maps/Static/Demo dungeon.png'), lib('Maps/Static/Test move.png'));
      const mm = handle('map.add', { chapterId: store.cur.meta.chapters[0].id, name: 'Moved picture', path: lib('Maps/Static/Test move.png') });
      await sleep(300);
      store.flush();
      handle('campaign.home');
      await sleep(500);
      fs.mkdirSync(lib('Maps/Moved'), { recursive: true });
      fs.renameSync(lib('Maps/Static/Test move.png'), lib('Maps/Moved/Test move.png'));
      handle('campaign.open', { id: cid });
      handle('campaign.play');
      await sleep(2200);
      C.missingToast = await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent)`);
      await js(gm, `window.__clicks = []; for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) document.addEventListener(t, (e) => window.__clicks.push(t + ':' + (e.target.className || e.target.tagName) + ':' + e.buttons + (e.defaultPrevented ? ':prevented' : '')), true); 1`);
      const pre = await js(gm, `(() => { const b = [...document.querySelectorAll('.toast button')].find((x) => x.textContent.includes('Find them')); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return (e && (e.className || e.tagName)) + ' / pointer ' + getComputedStyle(b).pointerEvents; })()`);
      const fp = await clickText('.toast button', 'Find them');
      await sleep(600);
      if (!(await js(gm, `!!document.querySelector('.modal .dlg-head')`))) {
        C.missingClickMiss = await js(gm, `(() => { const e = document.elementFromPoint(${fp.x}, ${fp.y}); const b = [...document.querySelectorAll('.toast button')].find((x) => x.textContent.includes('Find them')); const r = b && b.getBoundingClientRect(); return { pre: ${JSON.stringify(pre)}, events: window.__clicks, clicked: [${Math.round(fp.x)}, ${Math.round(fp.y)}], now: r && [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)], at: e && (e.className || e.tagName), toasts: [...document.querySelectorAll('.toast')].map((t) => t.className + ':' + t.textContent) }; })()`);
      }
      C.missingDialog = { title: await js(gm, `(() => { const e = document.querySelector('.modal .dlg-head h2'); return e && e.textContent; })()`),
        rows: await js(gm, `[...document.querySelectorAll('.modal .dlg-row')].map((r) => r.textContent)`),
        buttons: await js(gm, `[...document.querySelectorAll('.modal .dlg-btns button')].map((b) => b.textContent.trim())`) };
      await shot(gm, '32-missing-files');
      await clickText('.modal .dlg-btns button', 'Use Maps/Moved/Test move.png');
      await sleep(800);
      const moved = store.map(mm.id);
      C.relinked = { rel: moved && moved.bg && moved.bg.rel, path: moved && moved.bg && moved.bg.path, left: (await js(gm, `window.ts.app('missing.list')`)).length,
        dialog: await js(gm, `[...document.querySelectorAll('.modal .dlg-row')].map((r) => r.textContent)`) };
      await clickSel('.modal .dlg-head .icon-btn');
      await sleep(300);
      // 4.10.1: tokens only kept on a Ready list, deleted from the library: no error, a quiet word with Take them off;
      // greyed on the Ready row meanwhile
      {
        fs.mkdirSync(lib('Tokens/Old'), { recursive: true });
        const tokSrc = (await js(gm, `window.ts.library('list')`)).find((x) => x.cat === 'tokens');
        const olds = [1, 2].map((i) => { const f = lib(`Tokens/Old/Old crawler ${i}.png`); fs.copyFileSync(tokSrc.path, f); return f; });
        const chM = store.cur.meta.chapters[0];
        handle('ready.set', { chapterId: chM.id, kind: 'tokens', items: olds.map((f) => ({ path: f })) });
        await sleep(300);
        for (const f of olds) fs.unlinkSync(f);
        await js(gm, `document.querySelectorAll('.toast').forEach((x) => x.remove()); window.dispatchEvent(new Event('focus')); 1`);
        await sleep(1800);
        const toasts = await js(gm, `[...document.querySelectorAll('.toast')].map((x) => ({ text: x.textContent, error: x.classList.contains('error') }))`);
        await key('N'); await sleep(500);
        const greyed = await js(gm, `[...document.querySelectorAll('#pop .ready-row .tok-pick.missing')].length`);
        await key('Escape'); await key('V');
        await js(gm, `[...document.querySelectorAll('.toast button')].find((b) => /Take them off/.test(b.textContent)).click()`);
        await sleep(800);
        C.missingLists = { toasts, greyed, left: ((store.cur.meta.chapters[0].ready || {}).tokens || []).length, listAfter: (await js(gm, `window.ts.app('missing.list')`)).length };
      }

      // backups: none for a brand-new campaign; one at each opening after a change (map added, then the picture relinked)
      handle('campaign.home');
      await sleep(400);
      handle('campaign.open', { id: cid });
      handle('campaign.play');
      await sleep(600);
      handle('campaign.home');
      await sleep(800);
      C.firstStepsGone = await js(gm, `!document.querySelector('.first-steps') && !!document.querySelector('.camp-grid')`);
      const list0 = await js(gm, `window.ts.app('backups.list', { id: ${JSON.stringify(cid)} })`);
      await clickText('.camp-more', 'More for Test campaign');
      await sleep(300);
      await clickText('#menu .menu-item', 'Backups');
      await sleep(700);
      const rows = await js(gm, `[...document.querySelectorAll('.modal .dlg-row')].map((r) => r.textContent)`);
      const hint = await js(gm, `(() => { const e = document.querySelector('.modal .hint'); return e && e.textContent; })()`);
      await shot(gm, '33-earlier-versions');
      // restore the oldest (before the moved picture's map was added)
      await js(gm, `(() => { const b = [...document.querySelectorAll('.modal .dlg-row')].pop().querySelector('button'); b.scrollIntoView({ block: 'center' }); })()`);
      const last = await js(gm, `(() => { const r = [...document.querySelectorAll('.modal .dlg-row')].pop().querySelector('button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await click(last.x, last.y);
      await sleep(900);
      const list1 = await js(gm, `window.ts.app('backups.list', { id: ${JSON.stringify(cid)} })`);
      const meta = JSON.parse(fs.readFileSync(path.join(cdir, 'campaign.json'), 'utf8'));
      const restoredMap = JSON.parse(fs.readFileSync(path.join(cdir, 'maps', `${mm.id}.json`), 'utf8'));
      C.backups = { before: list0.length, oldestMaps: list0.length ? list0[list0.length - 1].maps : null, rows: rows.length, after: list1.length,
        labels: list1.map((b) => b.label).filter(Boolean), restoredRel: restoredMap.bg && restoredMap.bg.rel, hint, mapsNow: meta.chapters.reduce((n, ch) => n + (ch.maps || []).length, 0),
        toast: await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`), folder: fs.existsSync(path.join(cdir, '.backups')) };
      await shot(gm, '34-restored');
    }

    // ---------- 19. 2.4: deleting a campaign asks first (the worried maid); Recently deleted brings it back ----------
    {
      handle('campaign.home');
      await sleep(900);
      const name = 'Test campaign';
      const has = () => (handle('campaign.list').campaigns || []).some((c) => c.name === name);
      await clickText('.camp-more', `More for ${name}`);
      await sleep(300);
      await clickText('#menu .menu-item', 'Delete');
      await sleep(600);
      const ask = await js(gm, `(() => { const d = document.querySelector('.modal.del-dialog'); if (!d) return null; const m = d.querySelector('img.del-maid'); return { title: d.querySelector('h2').textContent, maid: !!m && m.complete && m.naturalWidth > 0, text: d.querySelector('.del-what').textContent, btns: [...d.querySelectorAll('.btn')].map((b) => b.textContent.trim()), focus: document.activeElement && document.activeElement.textContent.trim() }; })()`);
      await shot(gm, '35-delete-ask');
      await clickText('.modal.del-dialog .btn', 'Keep it');
      await sleep(400);
      const kept = has() && !(await js(gm, `!!document.querySelector('.modal.del-dialog')`));
      await clickText('.camp-more', `More for ${name}`);
      await sleep(300);
      await clickText('#menu .menu-item', 'Delete');
      await sleep(500);
      await clickText('.modal.del-dialog .btn', 'Delete');
      await sleep(900);
      const gone = !has();
      const link = await js(gm, `(() => { const b = document.querySelector('.del-link'); return b && b.textContent; })()`);
      await clickSel('.del-link');
      await sleep(800);
      const rowsD = await js(gm, `[...document.querySelectorAll('.modal .del-row')].map((r) => r.textContent)`);
      await shot(gm, '36-recently-deleted');
      await clickText('.modal .del-row .btn', 'Restore');
      await sleep(900);
      const back = has();
      await js(gm, `document.querySelectorAll('.modal-back').forEach((b) => b.remove())`);
      // for good: the button asks once more
      const tc = handle('campaign.list').campaigns.find((c) => c.name === name);
      handle('campaign.delete', { id: tc.id });
      await sleep(300);
      handle('campaign.home');
      await sleep(600);
      await clickSel('.del-link');
      await sleep(800);
      await clickText('.modal .del-row .btn', 'Delete for good');
      await sleep(300);
      const sure = await js(gm, `(() => { const b = document.querySelector('.modal .del-row .btn.sure'); return b && b.textContent.trim(); })()`);
      await clickText('.modal .del-row .btn', 'Sure?');
      await sleep(800);
      const purged = { list: (handle('campaign.deleted').list || []).length, rows: await js(gm, `document.querySelectorAll('.modal .del-row').length`) };
      await js(gm, `document.querySelectorAll('.modal-back').forEach((b) => b.remove())`);
      C.v24del = { ask, kept, gone, link, rowsD, back, sure, purged };
    }

    // ---------- 20. Beta 1: the placing preview, damaged files, a window that stops, the draw benchmark ----------
    {
      const demo = handle('campaign.list').campaigns.find((c) => /^Demo/.test(c.name));
      handle('campaign.open', { id: demo.id });
      handle('campaign.play');
      await sleep(900);
      const mids = store.allMapIds();
      handle('edit.open', { id: mids[0] });
      handle('table.send', { mapId: mids[0] });
      await sleep(1200);
      const lm = store.map(mids[0]);
      const k = lm.grid.size;
      // the half see-through preview follows the mouse, true size (2 squares), the picture itself
      const oak = lib('Assets/Nature/Oak tree.png');
      await js(gm, `Play.setTool('asset'); Play.ui.brush = { path: ${JSON.stringify(oak)}, name: 'Oak tree', kind: 'image', url: UI.pathToUrl(${JSON.stringify(oak)}) }; Play.ui.assetCells = 2; Play.ui.assetMode = 'stamp'`);
      const gAt = await scr(20 * k, 8 * k);
      await mouse('mouseMove', gAt.x, gAt.y); await sleep(200); await mouse('mouseMove', gAt.x + 3, gAt.y + 2); await sleep(400);
      const cellPx = await js(gm, `Play.view().ppi * Play.state().map.grid.size * Play.state().map.view.zoom * Play.view().cam.s`); // one square on the screen (the view is zoomed out)
      const ghost = await js(gm, `(() => { const g = document.querySelector('.asset-ghost'); if (!g || g.style.display === 'none') return null; const r = g.getBoundingClientRect(); return { tag: g.tagName, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, opacity: Number(g.style.opacity), src: (g.currentSrc || g.src || '').slice(-12) }; })()`);
      if (ghost) { ghost.dx = Math.round(ghost.cx - (gAt.x + 3)); ghost.dy = Math.round(ghost.cy - (gAt.y + 2)); ghost.cells = Math.round((ghost.w / cellPx) * 10) / 10; }
      await shot(gm, '37-asset-preview');
      // an animated asset's preview plays
      const orb = lib('Assets/Animated/Magic orb.webm');
      await js(gm, `Play.ui.brush = { path: ${JSON.stringify(orb)}, name: 'Magic orb', kind: 'video', url: UI.pathToUrl(${JSON.stringify(orb)}) }`);
      await mouse('mouseMove', gAt.x + 6, gAt.y + 2);
      let ghostV = null;
      for (let i = 0; i < 30 && !(ghostV && ghostV.t > 0); i++) { await sleep(150); ghostV = await js(gm, `(() => { const g = document.querySelector('.asset-ghost'); if (!g || g.style.display === 'none') return null; return { tag: g.tagName, paused: g.paused, t: g.currentTime }; })()`); }
      // a token dragged from the library (its drag events, as the library tile sends them): the preview snaps to a square, one cell big; the drop places it
      const tok = lib('Tokens/Goblin.png');
      const tokens0 = L().layers.filter((l) => l.role === 'token').length;
      const drag = await js(gm, `(async () => {
        const a = { path: ${JSON.stringify(tok)}, kind: 'image', role: 'token', name: 'Goblin', cat: 'tokens' };
        const dt = new DataTransfer(); dt.setData('application/x-ts-asset', JSON.stringify(a));
        UI.DragPic.start(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }), a, null);
        const x = ${gAt.x + 40}, y = ${gAt.y + 30};
        const at = () => document.elementFromPoint(x, y);
        const over = (dx) => at().dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x + dx, clientY: y, dataTransfer: dt }));
        over(0); await new Promise((r) => setTimeout(r, 500)); over(1); await new Promise((r) => setTimeout(r, 100));
        const g = document.querySelector('.asset-ghost'); const gr = g && g.getBoundingClientRect();
        const pic = document.querySelector('.drag-pic');
        const sp = Play.view().toMap(x + 1, y); const snapped = Geom.snap(Play.state().map.grid, sp.x, sp.y, 1); const sc = Play.view().mapToScreen(snapped.x, snapped.y);
        const out = { shown: !!g && g.style.display !== 'none', token: !!g && g.classList.contains('is-token'), w: gr && gr.width, dx: gr && Math.round(gr.x + gr.width / 2 - sc.x), dy: gr && Math.round(gr.y + gr.height / 2 - sc.y), pic: !!pic, picHidden: !!pic && pic.style.display === 'none' };
        at().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
        window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 600));
        out.picAfter = !!document.querySelector('.drag-pic'); out.ghostAfter = !!(document.querySelector('.asset-ghost') && document.querySelector('.asset-ghost').style.display !== 'none');
        return out;
      })()`);
      drag.cellPx = cellPx; drag.tokensAdded = L().layers.filter((l) => l.role === 'token').length - tokens0;
      await js(gm, `Play.setTool('select')`);
      // the table window stops (as it would out of memory): loaded again by itself, the map still on it, a note on the GM screen
      const liveBefore = state.liveMapId;
      await js(gm, `document.querySelectorAll('.toast').forEach((t) => t.remove())`);
      // (a script sent to a crashed window never answers: wait for the window to have loaded again first)
      const loaded = new Promise((resolve) => { W().player.webContents.once('did-finish-load', () => resolve(true)); setTimeout(() => resolve(false), 15000); });
      report.expectCrash = true; // (this one is on purpose)
      W().player.webContents.forcefullyCrashRenderer();
      const t0 = Date.now();
      let crash = { reloaded: await loaded, ms: Date.now() - t0 };
      await sleep(1500);
      for (let i = 0; i < 20 && crash.reloaded; i++) {
        const d = await Promise.race([js(W().player, 'window.__table && window.__table.debug()'), sleep(2000).then(() => null)]);
        if (d && d.liveId === liveBefore && d.shown && d.shown.includes(liveBefore)) { crash.live = d.liveId; crash.after = i; break; }
        await sleep(300);
      }
      crash.reloaded = crash.reloaded && crash.live === liveBefore;
      await sleep(800);
      report.expectCrash = false;
      crash.toast = await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);
      crash.restarts = W().player.restarts || 0;
      crash.logged = /window stopped: crashed/.test(fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'logs', 'tablescape.log'), 'utf8'));
      await shot(gm, '38-table-reloaded');
      // the draw benchmark: graphics card, then processor; the better one stays
      const n0 = (await js(gm, `window.ts.bench('list')`)).length;
      const started = await js(gm, `window.ts.bench('start', { mode: 'draw', seconds: 3 })`);
      await sleep(1500);
      for (let i = 0; i < 60 && (await js(gm, `window.ts.bench('running')`)); i++) await sleep(500);
      await sleep(600);
      const two = (await js(gm, `window.ts.bench('list')`)).slice(n0);
      const benchDraw = { started: !!(started && started.ok), labels: two.map((r) => r.label), pair: two.length === 2 && two[0].pair === two[1].pair, picked: settings.animDraw, toast: await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`) };
      await js(gm, `App.openOptions('perf')`); await sleep(900);
      benchDraw.card = await js(gm, `(() => { const c = document.querySelector('.modal.options .bench-card.pair'); return c && [...c.querySelectorAll('.bench-row.head .bench-v')].map((x) => x.textContent); })()`);
      await shot(gm, '39-draw-benchmark');
      await js(gm, 'App.closeOptions()');
      // a damaged map file: shown as such, never written over; Start it over writes it again
      const mid = mids[1];
      store.flush();
      const mapFile = path.join(store.cur.dir, 'maps', `${mid}.json`);
      fs.writeFileSync(mapFile, '{ "name": "half writ');
      handle('campaign.home'); await sleep(300);
      handle('campaign.open', { id: demo.id }); handle('campaign.play'); await sleep(500);
      handle('edit.open', { id: mid }); await sleep(900);
      const brokenMap = { flagged: !!store.map(mid).broken, inState: !!(handle('campaign.list') && store.map(mid).broken), card: await js(gm, `(document.querySelector('.empty-card.broken') || {}).textContent || ''`) };
      store.touch(mid); store.flush();
      brokenMap.untouched = fs.readFileSync(mapFile, 'utf8') === '{ "name": "half writ';
      await shot(gm, '40-damaged-map');
      await clickText('.empty-card.broken .btn', 'Start it over'); await sleep(400);
      await clickText('.modal .btn.danger', 'Start over'); await sleep(900);
      brokenMap.reset = !store.map(mid).broken && /"id"/.test(fs.readFileSync(mapFile, 'utf8'));
      // a damaged campaign file: on the start screen with its earlier versions; restoring brings it back
      const bdir = path.join(library.root, 'Campaigns', 'Half written');
      fs.mkdirSync(path.join(bdir, '.backups', '2026-01-01 120000'), { recursive: true });
      fs.writeFileSync(path.join(bdir, 'campaign.json'), '{ "id": "c_half", "name": "Hal');
      fs.writeFileSync(path.join(bdir, '.backups', '2026-01-01 120000', 'campaign.json'), JSON.stringify({ app: 'tablescape', version: 2, id: 'c_half', name: 'Half written', chapters: [{ id: 'ch1', name: 'One', maps: [] }] }));
      fs.writeFileSync(path.join(bdir, '.backups', '2026-01-01 120000', 'backup.json'), JSON.stringify({ made: Date.now() - 5000, hash: 'h', name: 'Half written', chapters: 1, maps: 0, files: 1 }));
      handle('campaign.home'); await sleep(900);
      const brokenCamp = { tile: await js(gm, `(document.querySelector('.camp-broken') || {}).textContent || ''`), listed: (handle('campaign.list').campaigns || []).filter((c) => c.broken).map((c) => [c.name, c.backups]) };
      await shot(gm, '41-damaged-campaign');
      await clickSel('.camp-broken'); await sleep(800);
      brokenCamp.rows = await js(gm, `document.querySelectorAll('.modal .dlg-row').length`);
      await clickText('.modal .dlg-btns .btn', 'Restore'); await sleep(1200);
      brokenCamp.after = (handle('campaign.list').campaigns || []).filter((c) => c.name === 'Half written').map((c) => !!c.broken);
      await js(gm, `document.querySelectorAll('.modal-back').forEach((b) => b.remove())`);
      // a failed save is said on the GM screen
      handle('campaign.open', { id: demo.id }); await sleep(400);
      const realDir = store.cur.dir;
      const mapsDir = path.join(realDir, 'maps');
      fs.renameSync(mapsDir, `${mapsDir}.away`); fs.writeFileSync(mapsDir, 'not a folder');
      await js(gm, `document.querySelectorAll('.toast').forEach((t) => t.remove())`);
      handle('light.update', { mapId: mids[0], darkness: 0.33 }); store.flush(); await sleep(700);
      const saveFail = { toast: await js(gm, `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`) };
      fs.unlinkSync(mapsDir); fs.renameSync(`${mapsDir}.away`, mapsDir);
      store.flush();
      await shot(gm, '42-save-failed');
      C.beta1 = { ghost, ghostV, drag, crash, benchDraw, brokenMap, brokenCamp, saveFail };
    }

    // ---------- 21. Beta 2: new effects (painted, placed, lights, weather, moments, spell looks) ----------
    {
      const demo = handle('campaign.list').campaigns.find((c) => /^Demo/.test(c.name));
      handle('campaign.open', { id: demo.id });
      handle('campaign.play');
      await sleep(800);
      const fm = handle('map.add', { chapterId: store.cur.meta.chapters[0].id, name: 'Effects (test)', path: lib('Maps/Static/Demo dungeon.png') });
      await sleep(500);
      const id = fm.id;
      handle('table.send', { id });
      await sleep(2400);
      const FM = () => store.map(id);
      const tr = { x: -FM().view.x / FM().view.zoom, y: -FM().view.y / FM().view.zoom };
      const pl = W().player;
      const area = (layer, x, y, R) => js(pl, `(() => { let mx = 0; let sum = 0; let n = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const p = window.__table.probeMap('${layer}', ${x} + i * ${R} / 3, ${y} + j * ${R} / 3); if (p) { mx = Math.max(mx, p[3]); sum += p[3]; n++; } } return { max: mx, mean: Math.round(sum / Math.max(1, n)) }; })()`);
      const at = (i) => ({ x: tr.x + 6 + (i % 3) * 12, y: tr.y + 5 + Math.floor(i / 3) * 10 });
      // painted areas
      const kinds = ['ice', 'burning', 'web', 'glow', 'grass', 'oil'];
      kinds.forEach((k, i) => {
        const c = at(i); const pts = [];
        for (let j = 0; j <= 8; j++) pts.push(Math.round((c.x - 3 + j * 0.75) * 100) / 100, Math.round((c.y + Math.sin(j * 0.8) * 1.2) * 100) / 100);
        handle('fx.stroke', { mapId: id, id: `b2-${k}`, preset: k, sid: `s-${k}`, r: 1.8, pts });
      });
      await sleep(2200);
      const areas = {};
      for (const [i, k] of kinds.entries()) areas[k] = await area('atmo', at(i).x, at(i).y, 1.5);
      await shot(pl, '43-new-areas');
      // oil: its card sets it alight
      await js(gm, `Play.ui.fxMode = 'paint'; Play.setTool('fx'); Play.openPop('fx')`);
      await sleep(300);
      await js(gm, `Play.selectFx('b2-oil')`);
      await sleep(400);
      await clickText('#pop .btn', 'Set it alight');
      await sleep(500);
      const alight = (FM().fx.find((f) => f.id === 'b2-oil') || {}).preset;
      await js(gm, 'Play.closePop()');
      for (const k of kinds) handle('fx.remove', { mapId: id, id: `b2-${k}` });
      // placed effects
      const em = [['runes', 1.5, {}], ['portal', 1.4, {}], ['shaft', 1.2, { angle: 0 }], ['arcs', 1.5, { angle: 20 }], ['vent', 0.9, { variant: 'steam', speed: 3 }], ['falls', 1.1, {}]];
      const placed = {};
      for (const [i, [k, r, extra]] of em.entries()) placed[k] = handle('fx.add', { mapId: id, kind: 'emitter', preset: k, x: at(i).x, y: at(i).y, r, ...extra }).selected;
      await sleep(2000);
      const emit = {};
      for (const [i, [k]] of em.entries()) emit[k] = await area('atmo', at(i).x + (k === 'shaft' ? 2 : 0), at(i).y, 1);
      await shot(pl, '44-new-placed');
      // in the dark: the bullseye lantern lights a cone, the shaft its beam, the runes glow; a pulse breathes, a sputter gutters
      handle('light.update', { mapId: id, darkness: 0.85 });
      const lx = tr.x + 18; const ly = tr.y + 15;
      handle('fx.add', { mapId: id, kind: 'light', preset: 'bullseye', x: lx, y: ly, bright: 60, dim: 120, color: '#ffd28a', cone: 53, angle: 0 });
      handle('fx.add', { mapId: id, kind: 'light', preset: 'torch', x: tr.x + 30, y: tr.y + 17, bright: 20, dim: 40, color: '#ffb45a', wave: 'sputter' });
      await sleep(1500);
      const P = (x, y) => js(pl, `(window.__table.probeMap('light', ${x}, ${y}) || [0, 0, 0, 0])[3]`);
      const g = FM().grid.size;
      const dark = { front: await P(lx + 6 * g, ly), behind: await P(lx - 6 * g, ly), side: await P(lx, ly + 6 * g),
        beam: await P(at(2).x + 2.5, at(2).y), beside: await P(at(2).x + 2.5, at(2).y + 2.6), runes: await P(at(0).x, at(0).y), far: await P(tr.x + 1, tr.y + 20) };
      dark.wave = await js(pl, `(() => { const p = []; for (let t = 0; t < 4; t += 0.5) p.push(+FX.waveOf({ id: 'a', wave: 'pulse' }, t).toFixed(2)); let lo = 1; let hi = 0; for (let t = 0; t < 120; t += 0.05) { const v = FX.waveOf({ id: 'b', wave: 'sputter' }, t); lo = Math.min(lo, v); hi = Math.max(hi, v); } return { pulse: p, lo: +lo.toFixed(2), hi: +hi.toFixed(2) }; })()`);
      await shot(pl, '45-dark-lights');
      // lights out: every light dies, the scene sinks darker; stopped, they catch again
      handle('moment.play', { id: 'lightsout', sound: false });
      await sleep(4200);
      const out = { stats: (await js(pl, 'window.__table.debug()')).fx.lightsOut, front: await P(lx + 6 * g, ly) };
      await shot(pl, '46-lights-out');
      handle('moment.play', { id: 'lightsout' });
      await sleep(2600);
      out.back = await P(lx + 6 * g, ly);
      out.statsAfter = (await js(pl, 'window.__table.debug()')).fx.lightsOut;
      handle('light.update', { mapId: id, darkness: 0 });
      for (const f of FM().fx.slice()) handle('fx.remove', { mapId: id, id: f.id });
      // weather layers
      const wx = {};
      for (const ty of ['caustics', 'bubbles', 'wind', 'haze']) {
        handle('weather.preset', { mapId: id, name: ty, layers: [{ type: ty }] });
        await sleep(1300);
        wx[ty] = await js(pl, `window.__table.coverage('weather')`);
      }
      handle('weather.preset', { mapId: id, name: 'none', layers: [] });
      wx.mixes = await js(gm, `FXDATA.WEATHER.filter((w) => ['underwater', 'heat', 'gale'].includes(w.id)).map((w) => w.label)`);
      await sleep(800);
      // moments
      const mo = {};
      const cx = tr.x + 18; const cy = tr.y + 10;
      for (const [mid, wait] of [['teleport', 500], ['puff', 600], ['rockfall', 1200], ['flood', 2000]]) {
        handle('moment.play', { id: mid, x: cx, y: cy, mapId: id, sound: false });
        await sleep(wait);
        mo[mid] = { drawn: (await js(pl, 'window.__table.debug()')).fx.moments, cover: await js(pl, `window.__table.coverage('moment')`) };
        if (mid === 'flood') await shot(pl, '47-flood');
        await sleep(mid === 'flood' ? 6200 : 2600);
      }
      mo.sounds = ['teleport', 'puff', 'lightsout', 'rockfall', 'flood'].every((m) => fs.existsSync(path.join(__dirname, 'renderer', 'sfx', `moment-${m}.ogg`)))
        && ['water', 'earth', 'swarm'].every((m) => fs.existsSync(path.join(__dirname, 'renderer', 'sfx', `${m}.ogg`)));
      // spell looks
      handle('spell.add', { mapId: id, name: 'Maelstrom', shape: 'cylinder', size: 20, x: tr.x + 8, y: tr.y + 9, skin: 'water', mode: 'stay' });
      handle('spell.add', { mapId: id, name: 'Erupting Earth', shape: 'cube', size: 20, x: tr.x + 20, y: tr.y + 6, skin: 'earth', mode: 'stay' });
      handle('spell.add', { mapId: id, name: 'Insect Plague', shape: 'sphere', size: 15, x: tr.x + 30, y: tr.y + 12, skin: 'swarm', mode: 'stay' });
      await sleep(1500);
      const sp = { water: await area('spell', tr.x + 8, tr.y + 9, 1.5), earth: await area('spell', tr.x + 20 + 2, tr.y + 6 + 2, 1.5), swarm: await area('spell', tr.x + 30, tr.y + 12, 1.5),
        presets: await js(gm, `FXDATA.SPELLS.filter((s) => ['Watery Sphere', 'Tidal Wave', 'Maelstrom', 'Erupting Earth', 'Earthquake', 'Wall of Ice', 'Wall of Force'].includes(s.name)).length`),
        plague: await js(gm, `(FXDATA.SPELLS.find((s) => s.name === 'Insect Plague') || {}).skin`) };
      await shot(pl, '48-new-spells');
      for (const x of FM().spells.slice()) handle('spell.remove', { mapId: id, id: x.id });
      C.beta2 = { areas, alight, emit, dark, out, wx, mo, sp };
    }

    // ---------- 22. Beta 4.3: the hotbar's shape, the Fog panel's "?", a spell look's sound picked from Options ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      gm.webContents.focus();
      const HB = '#hotbar';
      const hb = () => js(gm, `(() => { const r = document.querySelector('${HB}'); const sl = r.querySelector('.hb-slots'); const b = sl.getBoundingClientRect(); const host = r.parentElement.getBoundingClientRect(); const rb = r.getBoundingClientRect();
        return { shape: r.dataset.shape, vertical: r.classList.contains('vertical'), cols: getComputedStyle(sl).gridTemplateColumns.split(' ').length, w: Math.round(b.width), h: Math.round(b.height), inside: rb.top >= host.top - 1 && rb.bottom <= host.bottom + 1 && rb.left >= host.left - 1 && rb.right <= host.right + 1 }; })()`);
      // right-click the bar: the four shapes
      const gp = await js(gm, `(() => { const g = document.querySelector('${HB} .hb-grip').getBoundingClientRect(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; })()`);
      await click(gp.x, gp.y, 'right');
      await sleep(300);
      const menu = await js(gm, `[...document.querySelectorAll('#menu .menu-item')].map((x) => x.textContent.trim())`);
      await clickText('#menu .menu-item', '5 × 2');
      await sleep(300);
      const fromMenu = await hb();
      const shapes = {};
      for (const k of ['2x5', '1x10', '10x1']) {
        await js(gm, `Play.Hot.setShape('${k}')`);
        await sleep(350);
        shapes[k] = await hb();
        if (k === '2x5') await shot(gm, '60a-hotbar-2x5');
      }
      // Options → This screen shows the same choice
      await js(gm, `App.openOptions('screen')`);
      await sleep(300);
      await clickText('.modal.options .seg-btn', '1 × 10');
      await sleep(300);
      const fromOptions = { shape: (await hb()).shape, on: await js(gm, `[...document.querySelectorAll('.modal.options .seg-btn.on')].map((b) => b.textContent.trim())`) };
      await key('Escape');
      await js(gm, `Play.Hot.setShape('10x1')`);
      await sleep(200);
      // Fog: the handy things behind a "?" in the title bar instead of long text in the panel
      await key('R');
      await sleep(400);
      const fogBody = await js(gm, `document.querySelector('#pop .pop-body').textContent`);
      const qp = await js(gm, `(() => { const q = document.querySelector('#pop .pop-head .help-q'); if (!q) return null; const r = q.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      let tipShown = null; let tipGone = null; let tipClick = null;
      if (qp) {
        await mouse('mouseMove', qp.x - 40, qp.y + 60);
        await mouse('mouseMove', qp.x, qp.y);
        await sleep(300);
        tipShown = await js(gm, `(() => { const p = document.querySelector('.help-pop'); return p && { items: p.querySelectorAll('li').length, title: p.querySelector('b').textContent, visible: p.getBoundingClientRect().width > 100 }; })()`);
        await shot(gm, '60b-fog-help');
        await click(qp.x, qp.y);
        await sleep(200);
        tipClick = await js(gm, `!!document.querySelector('.help-pop')`);
        await mouse('mouseMove', qp.x - 200, qp.y + 200);
        await sleep(200);
        await js(gm, 'document.activeElement && document.activeElement.blur()');
        await sleep(200);
        tipGone = await js(gm, `!document.querySelector('.help-pop')`);
      }
      await key('Escape'); await key('V');
      // a spell look's sound: picked in the library from Options → Sound, back in Options with the row lit
      await js(gm, `App.openOptions('sound')`);
      await sleep(400);
      await clickText('.modal.options .sfx-row .icon-btn', 'Choose a sound for Cold');
      await sleep(900);
      const pickFor = await js(gm, `({ options: !!document.querySelector('.modal.options'), drawer: !!(Play.ui.drawer), purpose: (document.querySelector('#drawer .drawer-purpose') || {}).textContent || null })`);
      C.sfxFolder = await js(gm, `(() => { const c = document.querySelector('#drawer .lib-crumb.on'); return c && c.textContent; })()`); // (4.11: a spell sound opens SFX)
      await js(gm, `(() => { const i = document.querySelector('#drawer .lib-search'); i.value = 'cave drone'; i.dispatchEvent(new Event('input')); return 1; })()`);
      await sleep(300);
      await clickText('#drawer .lt-sounds', 'Cave drone');
      await js(gm, `Play.ui.lib.query = ''; 1`);
      let lit = null;
      for (let i = 0; i < 20 && !lit; i++) { await sleep(60); lit = await js(gm, `(() => { const f = document.querySelector('.modal.options .sfx-row.flash'); return f && f.dataset.flash; })()`); }
      await sleep(300);
      const picked = { lit, back: await js(gm, `(() => { const b = document.querySelector('.modal.options .opt-tab.on'); return b && b.textContent.trim(); })()`),
        file: await js(gm, `(() => { const r = document.querySelector('.modal.options .sfx-row[data-flash="sfx:cold"] .sfx-file'); return r && r.textContent; })()`),
        saved: !!(settings.sfxMap && settings.sfxMap.cold) };
      await shot(gm, '60c-options-sfx-picked');
      await js(gm, `window.ts.settings({ sfxFor: { skin: 'cold', path: null } })`);
      await key('Escape');
      await sleep(200);
      C.beta43 = { menu, fromMenu, shapes, fromOptions, fogBody, tipShown, tipClick, tipGone, pickFor, picked };

      // 4.3.1: every panel keeps its explanations behind a "?" (only short status lines stay in it)
      const popTips = {};
      for (const [id, sub] of [['map'], ['fx', 'place'], ['fx', 'paint'], ['fx', 'light'], ['fx', 'weather'], ['walls'], ['party'], ['spell'], ['asset'], ['layers'], ['grid'], ['sound', 'chapter'], ['sound', 'combat'], ['token'], ['point'], ['draw'], ['mark'], ['notes'], ['timer'], ['talk'], ['toolbox'], ['fog']]) {
        if (id === 'fx') await js(gm, `Play.ui.fxMode = '${sub}'`);
        if (id === 'sound') await js(gm, `Play.ui.soundTab = '${sub}'`);
        await js(gm, `Play.openPop('${id}')`);
        await sleep(250);
        popTips[sub ? `${id}:${sub}` : id] = await js(gm, `({ q: !!document.querySelector('#pop .pop-head .help-q'), long: [...document.querySelectorAll('#pop .pop-body .hint')].filter((x) => !x.hidden && x.offsetParent && x.textContent.trim().length > 90).map((x) => x.textContent.trim()) })`);
      }
      await js(gm, 'Play.closePop()');
      const panelTips = {};
      for (const id of ['init', 'timer', 'sound', 'moments', 'spotify', 'dice', 'break', 'notes', 'lights', 'chars', 'remote']) {
        await js(gm, `Play.TB.openPanel('${id}')`);
        await sleep(250);
        panelTips[id] = await js(gm, `({ q: !!document.querySelector('.fp[data-id="${id}"] .fp-head .help-q'), long: [...document.querySelectorAll('.fp[data-id="${id}"] .hint')].filter((x) => !x.hidden && x.offsetParent && x.textContent.trim().length > 100).map((x) => x.textContent.trim()) })`);
        await js(gm, `Play.Floats.hide('${id}')`);
      }
      // Initiative stays in the Toolbox (no Pin to the rail); other panels can still be pinned
      await key('Q');
      await sleep(300);
      const tileMenu = async (name) => { await clickText('#pop .tb-tile', name, 'right'); await sleep(250); const m = await js(gm, `[...document.querySelectorAll('#menu .menu-item')].map((x) => x.textContent.trim())`); await key('Escape'); await sleep(150); return m; };
      const pinMenus = { init: await tileMenu('Initiative'), sound: await tileMenu('Soundboard') };
      await key('Escape');
      // Talk: + puts a portrait on the Ready list; the size goes from 10 to 70 %
      const ch22 = store.chapterOf(await js(gm, 'Play.state().editMapId'));
      handle('ready.set', { chapterId: ch22.id, kind: 'portraits', items: [] });
      await js(gm, `Play.ui.talkAll = true; Play.openPop('talk')`);
      await sleep(500);
      const emptyText = await js(gm, `(document.querySelector('#pop .ready-empty') || {}).textContent || null`);
      // (4.7: the tick in List … puts a portrait on the Ready list)
      await js(gm, `[...document.querySelectorAll('#pop .btn')].find((b) => /List/.test(b.textContent)).click()`);
      await sleep(900);
      const addBtn = await js(gm, `(() => { const it = document.querySelector('.fp[data-id="talklist"] .pl-it'); const b = it && it.querySelector('.pl-tick'); if (!b) return null; b.click(); return it.getAttribute('aria-label'); })()`);
      await sleep(600);
      await js(gm, `Play.Floats.hide('talklist')`);
      const talk431 = { added: addBtn, ready: ((store.chapterOf(ch22.maps[0]) || ch22).ready && (store.chapterOf(ch22.maps[0]) || ch22).ready.portraits || []).length,
        size: await js(gm, `(() => { const i = document.querySelector('#pop input[aria-label="Size"]'); return i && [Number(i.min), Number(i.max)]; })()`),
        empty: emptyText };
      handle('ready.set', { chapterId: ch22.id, kind: 'portraits', items: [] });
      await js(gm, 'Play.closePop()');
      // a long message beside a hotbar moved to the right edge stays inside the window
      await js(gm, `Play.Hot.setShape('1x10')`);
      await sleep(200);
      const hg = await js(gm, `(() => { const g = document.querySelector('#hotbar .hb-grip').getBoundingClientRect(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; })()`);
      await mouse('mouseMove', hg.x, hg.y);
      await mouse('mouseDown', hg.x, hg.y);
      for (let k = 1; k <= 10; k++) await mouse('mouseMove', hg.x + 160 * k, hg.y - 10 * k, 'left', { modifiers: ['leftButtonDown'] });
      await mouse('mouseUp', hg.x + 1600, hg.y - 100);
      await sleep(400);
      await js(gm, `UI.toast('AbjurationCircleOutro_02_Regular_Blue_800x800_a_long_file_name_for_the_test.webm removed', { ms: 3000 })`);
      await sleep(300);
      const toastBox = await js(gm, `(() => { const t = document.querySelector('.toast').getBoundingClientRect(); const b = document.querySelector('#hotbar').getBoundingClientRect(); return { l: Math.round(t.left), r: Math.round(t.right), w: innerWidth, barR: Math.round(b.right) }; })()`);
      await shot(gm, '60d-toast-right');
      await js(gm, `document.querySelector('#hotbar .hb-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await js(gm, `Play.Hot.setShape('10x1')`);
      await sleep(200);
      // Options → This screen: the size as a slider
      await js(gm, `App.openOptions('screen')`);
      await sleep(300);
      const sizeSlider = await js(gm, `(() => { const i = document.querySelector('.modal.options input[type=range][aria-label="Size of everything in this window"]'); return i && [Number(i.min), Number(i.max)]; })()`);
      await key('Escape');
      // removing a player asks first; Keep keeps them
      const party0 = (store.cur.meta.party || []).slice();
      handle('party.set', { names: ['Fenric', 'Cadhla', 'Six'] });
      handle('campaign.page');
      await sleep(900);
      await js(gm, `document.querySelector('.pl-row[data-name="Six"] .icon-btn[aria-label="Remove Six"]').click()`);
      await sleep(300);
      const ask = await js(gm, `(() => { const d = [...document.querySelectorAll('.modal')].pop(); return d && { title: (d.querySelector('h2') || {}).textContent, btns: [...d.querySelectorAll('.btn')].map((b) => b.textContent.trim()) }; })()`);
      await shot(gm, '60e-remove-player');
      await clickText('.modal .btn', 'Keep');
      await sleep(300);
      const kept = store.cur.meta.party.includes('Six');
      await js(gm, `document.querySelector('.pl-row[data-name="Six"] .icon-btn[aria-label="Remove Six"]').click()`);
      await sleep(300);
      await clickText('.modal .btn.danger', 'Remove Six');
      await sleep(300);
      const removed = !store.cur.meta.party.includes('Six');
      handle('party.set', { names: party0 });
      handle('campaign.play');
      await sleep(600);
      C.beta431 = { popTips, panelTips, pinMenus, talk431, toastBox, sizeSlider, ask, kept, removed };
    }

    // ---------- 23. Beta 4.4: effects sized by the grid, the light shaft's dust, a moving map slides, the new looks ----------
    {
      await key('Escape'); await key('Escape'); await key('V');
      gm.webContents.focus();
      const mid = await js(gm, 'Play.state().editMapId');
      const M = () => store.map(mid);
      const g0 = { ...M().grid };
      // a fine grid (a big map zoomed in): a new torch is as big as before, measured in squares
      handle('grid.update', { mapId: mid, size: 0.5 });
      await sleep(300);
      await js(gm, `Play.ui.fxMode = 'place'; Play.ui.emitter = 'torch'; Play.ui.fxSize = 1`);
      await key('E');
      await sleep(400);
      const n0 = M().fx.length;
      const vpc = await js(gm, `(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.x + r.width * 0.62, y: r.y + r.height * 0.42 }; })()`);
      const p1 = vpc;
      await click(p1.x, p1.y);
      await sleep(400);
      const torch = M().fx[n0] || null;
      // the light shaft: its dust can be made bigger
      await js(gm, `Play.ui.emitter = 'shaft'; Play.openPop('fx')`);
      await sleep(400);
      const dust = await js(gm, `(() => { const i = [...document.querySelectorAll('#pop input[type=range]')].find((x) => x.getAttribute('aria-label') === 'Dust size'); if (!i) return null; const r = [Number(i.min), Number(i.max)]; i.value = 6; i.dispatchEvent(new Event('input')); return r; })()`);
      await sleep(300);
      const p2 = { x: vpc.x + 90, y: vpc.y + 40 };
      await click(p2.x, p2.y);
      await sleep(400);
      const shaft = M().fx.find((f) => f.preset === 'shaft') || null;
      const fx44 = { torchR: torch && torch.r, shaftDust: shaft && shaft.dust, dust };
      for (const f of M().fx.slice(n0)) handle('fx.remove', { mapId: mid, id: f.id });
      handle('grid.update', { mapId: mid, size: g0.size });
      await key('Escape'); await key('V');
      // the map moving: the TV only gets its place and slides; afterwards one full picture, the same as while sliding
      handle('table.send', { id: mid });
      await sleep(2500);
      const tv = () => W().player;
      const live0 = (await js(tv(), 'window.__table.debug()')).liveMoves || 0;
      const v0 = { ...M().view };
      const undo0 = store.history(mid).undo.length;
      await key('M');
      await sleep(300);
      const vp = await js(gm, `(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await mouse('mouseMove', vp.x, vp.y);
      await mouse('mouseDown', vp.x, vp.y);
      for (let k = 1; k <= 20; k++) { await mouse('mouseMove', vp.x + k * 6, vp.y + k * 3, 'left', { modifiers: ['leftButtonDown'] }); await sleep(20); }
      await sleep(250);
      const capTv = async () => { tv().webContents.invalidate(); await sleep(250); return (await tv().webContents.capturePage()).toBitmap(); };
      const during = { live: (await js(tv(), 'window.__table.debug()')).liveMoves || 0, gmLive: await js(gm, '!!Play.view().live') };
      const A = await capTv();
      await mouse('mouseUp', vp.x + 120, vp.y + 60);
      await sleep(1200);
      const B = await capTv();
      let diff = 0; let n = 0;
      for (let i = 0; i < A.length; i += 4 * 9) { if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) diff++; n++; }
      const moved = { during, liveMoves: during.live - live0, after: { gmLive: await js(gm, '!!Play.view().live'), tvLive: await js(tv(), '!!(window.__table.debug().viewLive)') },
        dx: +(M().view.x - v0.x).toFixed(3), undoSteps: store.history(mid).undo.length - undo0, diff: +((100 * diff) / n).toFixed(2) };
      handle('view.update', { mapId: mid, x: v0.x, y: v0.y, zoom: v0.zoom });
      await key('Escape'); await key('V');
      await sleep(500);
      // the new looks: a new map arrives under smoke, parchment and embers; Talk in each look
      const ids = store.cur.meta.chapters.find((c) => c.maps.includes(mid)).maps;
      const other = ids.find((x) => x !== mid) || mid;
      const looks = {};
      let cur = mid;
      for (const kind of ['smoke', 'parchment', 'embers']) {
        await js(gm, `window.ts.settings({ mapTransition: '${kind}' })`);
        await sleep(200);
        cur = cur === mid ? other : mid;
        handle('table.send', { id: cur });
        let mid1 = null;
        for (let i = 0; i < 30 && !mid1; i++) { await sleep(100); const d = (await js(tv(), 'window.__table.debug()')).mapLook; if (d && d.phase !== 'idle' && d.kind === kind) mid1 = { phase: d.phase, on: await js(tv(), `(document.getElementById('table-maplook') || {}).className || ''`) }; }
        if (kind === 'parchment') { await sleep(1300); await shot(tv(), `61a-parchment`); }
        for (let i = 0; i < 80; i++) { await sleep(100); const d = (await js(tv(), 'window.__table.debug()')).mapLook; if (d && d.phase === 'idle' && d.kind === kind && d.reveals >= d.runs) break; }
        const d = (await js(tv(), 'window.__table.debug()'));
        looks[kind] = { mid: mid1, end: d.mapLook, live: d.liveMap || null, hidden: await js(tv(), `getComputedStyle(document.getElementById('table-maplook')).display`) };
      }
      await js(gm, `window.ts.settings({ mapTransition: 'ink' })`);
      const portraits = fs.readdirSync(lib('Portraits')).filter((f) => /\.(png|webp)$/i.test(f)).slice(0, 1);
      const talks = {};
      for (const look of ['smoke', 'parchment', 'embers']) {
        await js(gm, `window.ts.settings({ talk: { look: '${look}' } })`);
        handle('talk.on', {});
        for (const f of portraits) handle('talk.toggle', { path: lib(`Portraits/${f}`), alpha: true });
        await sleep(1500);
        talks[look] = await js(tv(), `(() => { const t = document.querySelector('.tv-talk'); return { cls: t.className, band: !!t.querySelector('.talk-ink .tb-${look === 'parchment' ? 'parch' : look}'), name: (t.querySelector('.tb-parch-name') || {}).textContent || null, npcs: t.querySelectorAll('.talk-side.near .talk-npc:not(.out)').length }; })()`);
        if (look === 'embers') await shot(tv(), '61b-talk-embers');
        handle('talk.off', {});
        await sleep(1400);
      }
      await js(gm, `window.ts.settings({ talk: { look: 'ink' } })`);
      // the button deck summary is gone from Phone & tablet
      await js(gm, `Play.TB.openPanel('remote')`);
      await sleep(400);
      const deckSum = await js(gm, `!!document.querySelector('.fp[data-id="remote"] .rm-sums')`);
      await js(gm, `Play.Floats.hide('remote')`);
      C.beta44 = { fx44, moved, looks, talks, deckSum };

      // ---------- Beta 4.5 ----------
      const b45 = {};
      // painted areas are drawn in grid squares: the canvas is scaled by the square, their lights move with it
      b45.paint = await js(gm, `(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const g = c.getContext('2d'); let sc = null; const o = g.scale.bind(g); g.scale = (a, b) => { sc = [a, b]; o(a, b); };
        const f = { id: 'p45', kind: 'region', preset: 'water', strokes: [{ sid: 's', r: 0.5, pts: [1, 1, 2, 2] }] };
        FX.region(g, f, 1, 0.25); const plain = sc; sc = null; FX.region(g, f, 1, 1);
        const lv = FX.regionLights({ ...f, preset: 'lava' }, 0.25); const l1 = FX.regionLights({ ...f, preset: 'lava' }, 1);
        return { scaled: plain, one: sc, light: lv.length ? [+(lv[0].x).toFixed(3), +(lv[0].D / l1[0].D).toFixed(3)] : null }; })()`);
      // a drag held still: the map waits until the button is let go (the map on the table)
      handle('table.send', { id: mid }); await sleep(2500);
      await key('M'); await sleep(300);
      {
        const vp = await js(gm, `(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await mouse('mouseMove', vp.x, vp.y); await mouse('mouseDown', vp.x, vp.y);
        for (let k = 1; k <= 10; k++) { await mouse('mouseMove', vp.x + k * 5, vp.y, 'left', { modifiers: ['leftButtonDown'] }); await sleep(20); }
        await sleep(1400);
        b45.held = { tvLive: await js(tv(), '!!window.__table.debug().viewLive'), gmLive: await js(gm, '!!Play.view().live') };
        await mouse('mouseUp', vp.x + 50, vp.y); await sleep(1000);
        b45.held.after = await js(tv(), '!!window.__table.debug().viewLive');
        handle('view.update', { mapId: mid, x: v0.x, y: v0.y, zoom: v0.zoom });
      }
      // the map's colours: Grim on the TV, hold for the original, back to Natural
      await js(gm, `Play.openPop('map')`); await sleep(500);
      await clickSel('.look-chip[data-v="grim"]'); await sleep(700);
      const tvFilter = () => js(tv(), `(() => { const v = [...document.querySelectorAll('.tv-layer.shown .sv-bg')].pop(); return v ? v.style.filter || 'none' : null; })()`);
      b45.look = { stored: store.map(mid).look, tv: await tvFilter(), chips: await js(gm, `[...document.querySelectorAll('.look-chip')].map((b) => b.dataset.v).join()`) };
      await shot(gm, '62a-map-colours');
      await shot(tv(), '62b-map-grim');
      {
        const pb = await js(gm, `(() => { const b = [...document.querySelectorAll('#pop .btn')].find((x) => /original/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await mouse('mouseMove', pb.x, pb.y); await mouse('mouseDown', pb.x, pb.y); await sleep(600);
        b45.look.peek = await tvFilter();
        await mouse('mouseUp', pb.x, pb.y); await sleep(600);
        b45.look.after = await tvFilter();
      }
      await clickSel('.look-chip[data-v="natural"]'); await sleep(600);
      b45.look.natural = [store.map(mid).look || null, await tvFilter()];
      // a snapshot keeps the colours
      handle('bg.look', { mapId: mid, bright: 1, contrast: 1.02, sat: 0.2, warm: 0.75, preset: 'sepia' });
      const sn = handle('snap.save', { mapId: mid, name: 'Sepia 45' });
      handle('bg.look', { mapId: mid, reset: true });
      handle('snap.play', { id: sn.id || (sn.snap && sn.snap.id) }); await sleep(600);
      b45.snapLook = (store.map(mid).look || {}).preset || null;
      handle('bg.look', { mapId: mid, reset: true });
      await key('Escape');
      // the rail: Build in its new order, the Toolbox alone between Build and Play, Snapshots in the Toolbox
      b45.rail = await js(gm, `(() => { const g = (n) => [...document.querySelectorAll('.rail-group.g-' + n + ' > .rail-btn')].map((b) => b.dataset.id).filter((x) => x !== 'build'); return { groups: [...document.querySelectorAll('#rail .rail-group')].map((x) => x.dataset.group), build: g('build'), extra: g('extra'), play: g('play'), mapLabel: (document.querySelector('.rail-btn[data-id="map"] .rail-label') || {}).textContent }; })()`);
      await key('Q'); await sleep(400);
      b45.snapTile = await js(gm, `(() => { const t = document.querySelector('#pop .tb-tile[data-id="snaps"]'); return t ? t.closest('.tb-grid').previousElementSibling.textContent : null; })()`);
      await clickSel('#pop .tb-tile[data-id="snaps"]'); await sleep(500);
      b45.snapOpen = await js(gm, `!!document.querySelector('.fp[data-id="snaps"]')`);
      await js(gm, `Play.Floats.hide('snaps')`);
      // Options → Looks: both looks with Try on the TV; Talk's panel no longer has them
      await js(gm, `App.openOptions('looks')`); await sleep(500);
      b45.opt = { tries: await js(gm, `document.querySelectorAll('.try-look').length`), segs: await js(gm, `[...document.querySelectorAll('.opt-body .ctl-label, .opt-body label')].map((x) => x.textContent).filter((x) => /arrives|Portraits/.test(x)).length`) };
      await shot(gm, '62c-options-looks');
      await js(gm, `window.ts.cmd('look.try', { what: 'talk', look: 'parchment' })`); await sleep(700);
      b45.opt.talkTry = await js(tv(), `document.querySelector('.tv-talk').className`);
      await sleep(2700);
      b45.opt.talkAfter = await js(tv(), `document.querySelector('.tv-talk').className`);
      await js(gm, `window.ts.cmd('look.try', { what: 'map', look: 'ink' })`); await sleep(350);
      b45.opt.inkTry = { phase: (await js(tv(), 'window.__table.debug()')).mapInk.phase, splats: await js(tv(), `document.querySelectorAll('#table-mapink .splat').length`), sats: await js(tv(), `document.querySelectorAll('#table-mapink .sat').length`) };
      await shot(tv(), '62d-ink');
      await sleep(2000);
      b45.opt.inkEnd = (await js(tv(), 'window.__table.debug()')).mapInk.phase;
      await js(gm, `App.closeOptions()`); await sleep(200);
      await js(gm, `Play.openPop('talk')`); await sleep(400);
      b45.talkPopLook = await js(gm, `[...document.querySelectorAll('#pop .seg')].some((x) => x.getAttribute('aria-label') === 'Look')`);
      await key('Escape');
      // the parchment banner rolls down when they leave
      await js(gm, `window.ts.settings({ talk: { look: 'parchment' } })`);
      handle('talk.on', {});
      for (const f of portraits) handle('talk.toggle', { path: lib(`Portraits/${f}`), alpha: true });
      await sleep(1300);
      handle('talk.off', {}); await sleep(400);
      b45.parchOut = await js(tv(), `(() => { const p = document.querySelector('.tv-talk .tb-parch'); const r = document.querySelector('.tv-talk .tb-roll'); return p ? [getComputedStyle(p).animationName, r ? getComputedStyle(r).animationName : null] : null; })()`);
      await sleep(1200);
      await js(gm, `window.ts.settings({ talk: { look: 'ink' } })`);
      // room lights: −20 % / +20 %; + while they are off lights them again at 20 %
      {
        const LL = (a, p) => js(gm, `window.ts.lights(${JSON.stringify(a)}, ${JSON.stringify(p || {})})`);
        await LL('mode', { mode: 'room' }); await LL('set', { brightness: 1 });
        const steps = [];
        for (const by of [-0.2, -0.2, -0.2, -0.2, -0.2, 0.2]) { const r = await LL('bright.step', { by }); steps.push(r && r.brightness); }
        await LL('mode', { mode: 'off' });
        const back = await LL('bright.step', { by: 0.2 });
        b45.lights = { steps, back: back && [back.brightness, back.mode, back.back] };
        await LL('mode', { mode: 'release' });
      }
      C.beta45 = b45;

      // ---------- Beta 4.9: the window light, the soft light shaft, the TV preview follows what changes ----------
      const b49 = {};
      handle('table.send', { id: mid }); await sleep(2000);
      await key('Escape'); await key('V');
      for (const f of M().fx.slice()) handle('fx.remove', { mapId: mid, id: f.id });
      b49.kinds = await js(gm, `[FXDATA.WINDOW_SHAPES.length, FXDATA.WINDOW_GRIDS.length, FX.windowIcon('gothic', 'diamond').slice(0, 14)]`);
      b49.masks = await js(gm, `(() => { const w = FX.lightMask({ preset: 'window', shape: 'square', grid: 'cross', angle: 0, stretch: 1 }, 1); const s = FX.lightMask({ preset: 'shaft', angle: 0 }, 1); return { win: !!(w && w.img.width > 100), reach: s && s.reach }; })()`);
      {
        const tr = await js(gm, 'Play.view().tableRectInMap()');
        const gs = M().grid.size;
        const wx = tr.x + tr.w * 0.3; const wy = tr.y + tr.h * 0.3; const r = 2 * gs; // a square window with a cross, the light falling to the right
        handle('fx.add', { mapId: mid, kind: 'emitter', preset: 'window', x: wx, y: wy, r, angle: 0, shape: 'square', grid: 'cross', stretch: 1, dust: 1 });
        const sx = tr.x + tr.w * 0.3; const sy = tr.y + tr.h * 0.75; const sr = 1.2 * gs;
        handle('fx.add', { mapId: mid, kind: 'emitter', preset: 'shaft', x: sx, y: sy, r: sr, angle: 0 });
        handle('light.update', { mapId: mid, darkness: 0.9 });
        await sleep(2200);
        const P = (x, y) => js(tv(), `(window.__table.probeMap('light', ${x}, ${y}) || [0, 0, 0, 0])[3]`);
        // the square patch: u from 0.2 r to 1.8 r (h 1.6, stretch 1), v ±0.8 r; the cross's bars at u = 1 r and v = 0
        const pane = await P(wx + r * 0.6, wy - r * 0.4); const bar = await P(wx + r * 1.0, wy - r * 0.4); const off = await P(wx + r * 1.0, wy - r * 2.2);
        // the shaft: soft sides, no steps (the darkness eases from the beam out to the dark)
        const side = []; for (let i = 0; i <= 16; i++) side.push(await P(sx + sr * 1.8, sy + (i / 16) * sr * 1.3));
        b49.dark = { pane, bar, off, side, stored: (({ shape, grid, stretch }) => ({ shape, grid, stretch }))(M().fx.find((f) => f.preset === 'window') || {}) };
        await shot(tv(), '49a-window-light-dark');
        handle('light.update', { mapId: mid, darkness: 0 });
        for (const f of M().fx.slice()) handle('fx.remove', { mapId: mid, id: f.id });
      }
      // the window's options: six windows and six kinds of bars as pictures
      await js(gm, `Play.ui.fxMode = 'place'; Play.ui.emitter = 'window'; Play.openPop('fx')`);
      await sleep(500);
      b49.picks = await js(gm, `[...document.querySelectorAll('#pop .win-pick')].filter((b) => b.offsetParent).map((b) => b.getAttribute('aria-label'))`);
      await shot(gm, '49b-window-options');
      await js(gm, 'Play.closePop()');
      // the TV preview: one every 15 s when nothing happens, a moment after a change and again when it has settled
      await js(gm, `window.__pv = []; if (!window.__pvOn) { window.__pvOn = true; window.ts.onPreview(() => window.__pv.push(Date.now())); } 1`);
      await sleep(3000);
      await js(gm, 'window.__pv = []; 1');
      await sleep(8000);
      b49.idle8 = await js(gm, 'window.__pv.length');
      await js(gm, 'window.__pv = []; window.__t0 = Date.now(); 1');
      handle('fx.add', { mapId: mid, kind: 'emitter', preset: 'candle', x: 1, y: 1, r: 0.3 });
      await sleep(3200);
      b49.change = await js(gm, 'window.__pv.map((x) => x - window.__t0)');
      for (const f of M().fx.slice()) handle('fx.remove', { mapId: mid, id: f.id });
      C.beta49 = b49;

      // ---------- Beta 4.10: token pictures bigger than their squares, a thin ring, the compact toolbar, Options → Tokens ----------
      const b410 = {};
      await js(gm, `window.ts.settings({ tokens: { picReset: true, card: 'compact', ring: 'thin', numbers: true, turnGlow: true, shadow: false, tagSize: 1, snap: true } })`);
      await sleep(400);
      const tokLib = (await js(gm, `window.ts.library('list')`)).find((x) => x.cat === 'tokens');
      const trT = await js(gm, 'Play.view().tableRectInMap()');
      const addT = tokLib ? handle('layer.add', { mapId: mid, path: tokLib.path, role: 'token', x: trT.x + trT.w * 0.45, y: trT.y + trT.h * 0.45, size: 1, number: true }) : null;
      await sleep(600);
      const tok = addT && addT.selected ? M().layers.find((l) => l.id === addT.selected) : null;
      b410.tok = tok ? tok.name : null;
      if (tok) {
        handle('layer.update', { mapId: mid, id: tok.id, pic: null });
        await sleep(500);
        const rGm = () => js(gm, `(() => { const e = document.querySelector('.sv-token[data-id="${tok.id}"]'); if (!e) return null; const p = e.querySelector('.sv-token-pic'); return +(p.getBoundingClientRect().width / e.getBoundingClientRect().width).toFixed(2); })()`);
        const rTv = () => js(tv(), `(() => { const e = document.querySelector('.tv-layer.shown .sv-token[data-id="${tok.id}"]'); if (!e) return null; const p = e.querySelector('.sv-token-pic'); return +(p.getBoundingClientRect().width / e.getBoundingClientRect().width).toFixed(2); })()`);
        b410.pic = { gm: await rGm(), tv: await rTv() };
        await js(gm, `window.ts.settings({ tokens: { pic: { medium: 1.5 } } })`); await sleep(500);
        b410.pic.medium15 = { gm: await rGm(), tv: await rTv() };
        handle('layer.update', { mapId: mid, id: tok.id, pic: 1.2 }); await sleep(400);
        b410.pic.own = { gm: await rGm(), stored: M().layers.find((l) => l.id === tok.id).pic };
        handle('layer.update', { mapId: mid, id: tok.id, pic: null });
        await js(gm, `window.ts.settings({ tokens: { picReset: true } })`); await sleep(400);
        // selected: a ring that stays thin at any zoom, the compact toolbar (see-through, "M")
        await key('V');
        await js(gm, `Play.ui.selected = ${JSON.stringify(tok.id)}; Play.view().setSelected(${JSON.stringify(tok.id)}); 1`);
        await js(gm, `(() => { const v = Play.view(); const vp = document.getElementById('viewport').getBoundingClientRect(); const cx = vp.x + vp.width / 2; const cy = vp.y + vp.height / 2;
          let r = v.tokenRect(${JSON.stringify(tok.id)}); v.panBy(cx - (r.x + r.width / 2), cy - (r.y + r.height / 2)); for (let i = 0; i < 8; i++) v.zoomAt(cx, cy, 1.2); return 1; })()`);
        await sleep(300);
        const tr2 = await rect(`.sv-token[data-id="${tok.id}"]`);
        await click(tr2.cx, tr2.cy); await sleep(200);
        if (!(await js(gm, '!!document.querySelector("#token-card.on")'))) { await click(tr2.cx, tr2.cy); await sleep(300); }
        await mouse('mouseMove', tr2.cx + 3, tr2.cy + 3); await sleep(400); // (the mouse on the token, off the toolbar)
        b410.why = await js(gm, `(() => { const c = document.querySelector('#token-card'); const a = document.activeElement; return { hover: c.matches(':hover'), focus: c.matches(':has(:focus-visible)'), active: a ? a.tagName + '.' + a.className : null, opacity: getComputedStyle(c).opacity }; })()`);
        // (the synthetic mouse can leave a stale hover on this test screen: a copy of the toolbar, away from the mouse, shows the resting look)
        b410.resting = await js(gm, `(() => { const c = document.querySelector('#token-card'); const k = c.cloneNode(true); c.id = 'tc-orig'; k.id = 'token-card'; k.style.left = '-3000px'; k.style.top = '-3000px'; k.style.transition = 'none';
          c.parentNode.append(k); const o = getComputedStyle(k).opacity; k.remove(); c.id = 'token-card'; return o; })()`);
        b410.sel = await js(gm, `(() => { const e = document.querySelector('.sv-token[data-id="${tok.id}"]'); const a = getComputedStyle(e, '::after'); const c = document.querySelector('#token-card'); const px = Number(getComputedStyle(e).getPropertyValue('--px'));
          const zoom = e.getBoundingClientRect().width / e.offsetWidth; const sh = a.boxShadow.match(/(\\d+(\\.\\d+)?)px\\s*$/);
          return { selected: e.classList.contains('is-selected'), ring: a.content !== 'none' && a.boxShadow !== 'none', ringScreenPx: sh ? +(Number(sh[1]) * zoom).toFixed(1) : null, px, card: c.className, size: (c.querySelector('.card-size') || {}).textContent }; })()`);
        await shot(gm, '49c-token-selected');
        // docked: above the hotbar; glow
        await js(gm, `window.ts.settings({ tokens: { card: 'docked', ring: 'glow' } })`); await sleep(600);
        b410.docked = await js(gm, `(() => { const c = document.querySelector('#token-card').getBoundingClientRect(); const hb = document.getElementById('hotbar'); const h = hb && !hb.hidden ? hb.getBoundingClientRect() : null; return { cls: document.querySelector('#token-card').className, above: h ? c.bottom <= h.top + 1 : null, glow: document.body.classList.contains('ring-glow') }; })()`);
        // the size menu: its picture bigger
        await js(gm, `window.ts.settings({ tokens: { card: 'compact', ring: 'thin' } })`); await sleep(500);
        await clickSel('#token-card .card-size'); await sleep(300);
        b410.menu = await js(gm, `[...document.querySelectorAll('[role=menuitem], .menu-item')].map((x) => x.textContent.trim()).filter((t) => /picture|Bigger|Smaller|Options/i.test(t))`);
        await key('Escape');
        // on the TV: no numbers, no turn glow, a shadow, bigger name tags
        await js(gm, `window.ts.settings({ tokens: { numbers: false, turnGlow: false, shadow: true, tagSize: 2 } })`); await sleep(700);
        b410.tv = await js(tv(), `(() => { const L = document.querySelector('.tv-layer.shown'); const img = L && L.querySelector('.sv-token .sv-token-pic > img'); return { badges: L ? [...L.querySelectorAll('.sv-token-n')].filter((b) => b.style.display !== 'none').length : null, noGlow: !!document.querySelector('.no-turn-glow'), shadow: !!(img && /drop-shadow/.test(img.style.filter)), tag: L && L.querySelector('.sv-tokens') && L.querySelector('.sv-tokens').style.getPropertyValue('--tag') }; })()`);
        await js(gm, `window.ts.settings({ tokens: { numbers: true, turnGlow: true, shadow: false, tagSize: 1 } })`); await sleep(400);
        b410.tv.tag1 = await js(tv(), `(() => { const t = document.querySelector('.tv-layer.shown .sv-tokens'); return t && t.style.getPropertyValue('--tag'); })()`);
        await key('Escape'); await key('V');
        await js(gm, 'Play.view().fit(); 1');
        handle('layer.remove', { mapId: mid, id: tok.id });
      }
      // snapping off: a token lands where it is clicked; Options → Tokens
      await js(gm, `window.ts.settings({ tokens: { snap: false } })`); await sleep(300);
      await js(gm, `Play.setTokPref('size', 'medium')`);
      const gob = (await js(gm, `window.ts.library('list')`)).find((x) => x.cat === 'tokens');
      if (gob) {
        await js(gm, `Play.ui.tok.brush = ${JSON.stringify({ path: gob.path, name: gob.name, kind: 'image', url: gob.url })}; 1`);
        await key('N'); await sleep(400);
        const vp = await js(gm, `(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.x + r.width * 0.37, y: r.y + r.height * 0.61 }; })()`);
        const want = await js(gm, `Play.view().toMap(${vp.x}, ${vp.y})`);
        const n0 = M().layers.length;
        await click(vp.x, vp.y); await sleep(500);
        const placed = M().layers.length > n0 ? M().layers[M().layers.length - 1] : null;
        b410.free = placed ? +Math.hypot(placed.x - want.x, placed.y - want.y).toFixed(3) : null;
        if (placed) handle('layer.remove', { mapId: mid, id: placed.id });
        await key('Escape'); await key('V');
      }
      await js(gm, `window.ts.settings({ tokens: { snap: true } })`);
      await js(gm, `App.openOptions('tokens')`); await sleep(600);
      b410.options = await js(gm, `[...document.querySelectorAll('.tok-opts .ctl-label')].map((x) => x.textContent)`);
      b410.tokPanel = null;
      await shot(gm, '49d-options-tokens');
      await js(gm, 'App.closeOptions()');
      await key('N'); await sleep(400);
      b410.tokPanel = await js(gm, `[...document.querySelectorAll('#pop .ctl-label')].map((x) => x.textContent)`);
      await key('Escape'); await key('V');
      C.beta410 = b410;

      // ---------- Beta 4.11: the library's folders (tree, path, cards, short names, search by folder), the List windows ----------
      {
        const b411 = {};
        const src = lib('Tokens/Goblin.png');
        const mk = (rel) => { const f = lib(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(src, f); return f; };
        const made = [];
        for (let i = 1; i <= 3; i++) made.push(mk(`Tokens/Oterians/Fleet Chaplain/Fleet_Chaplain_${i}.png`), mk(`Tokens/Crew/Archivist-Surveyor/Archivist-Surveyor_${i}.png`), mk(`Tokens/Oterians/Marines/Marine_${i}.png`));
        made.push(mk('Tokens/Oterians/Oterian_Captain.png'));
        await key('Escape'); await key('V');
        await js(gm, `localStorage.removeItem('libFolders'); localStorage.removeItem('pickFolder:tokens'); Play.ui.lib.folders = {}; Play.ui.lib.query = ''; 1`);
        await js(gm, `Play.Drawer.open({ cat: 'tokens' })`); await sleep(1500);
        const st = () => js(gm, `({ crumbs: [...document.querySelectorAll('#drawer .lib-crumb')].map((x) => x.textContent), cards: [...document.querySelectorAll('#drawer .lf-card')].map((x) => x.getAttribute('data-key')), tiles: [...document.querySelectorAll('#drawer .lt .lt-name')].map((x) => x.textContent), tree: [...document.querySelectorAll('#drawer .lib-tree-row')].map((x) => x.getAttribute('data-key') + (x.classList.contains('on') ? '*' : '')), groups: [...document.querySelectorAll('#drawer .lib-group')].map((x) => x.textContent), tags: document.querySelectorAll('#drawer .lib-chips .chip').length })`);
        b411.root = await st();
        await clickSel('#drawer .lf-card[data-key="Oterians"]'); await sleep(500);
        b411.oterians = await st();
        await clickSel('#drawer .lib-tree-row[data-key="Oterians/Fleet Chaplain"]'); await sleep(500);
        b411.chaplain = await st();
        await shot(gm, '49e-library-folder');
        await js(gm, `(() => { const i = document.querySelector('#drawer .lib-search'); i.value = 'surveyor'; i.dispatchEvent(new Event('input')); return 1; })()`); await sleep(500);
        b411.search = await st();
        await js(gm, `document.querySelector('#drawer .lib-group-go').click()`); await sleep(500);
        b411.went = { crumbs: (await st()).crumbs, query: await js(gm, `document.querySelector('#drawer .lib-search').value`) };
        await key('Escape'); await sleep(300);
        await js(gm, `Play.Drawer.open({ cat: 'maps' })`); await sleep(900);
        await js(gm, `[...document.querySelectorAll('#drawer .lib-nav-btn')].find((b) => /Tokens/.test(b.textContent)).click()`); await sleep(500);
        b411.remembered = (await st()).crumbs;
        await key('Escape'); await sleep(300);
        // the Tokens List window: where you are, the folders in it, short names in a folder, search with the folder
        await key('N'); await sleep(500);
        await js(gm, `[...document.querySelectorAll('#pop .btn')].find((b) => /List/.test(b.textContent)).click()`); await sleep(900);
        const pl = () => js(gm, `(() => { const p = document.querySelector('.fp[data-id="toklist"]'); return p && { crumbs: [...p.querySelectorAll('.pl-crumb')].map((x) => x.textContent), folders: [...p.querySelectorAll('.pl-folder')].map((x) => x.textContent), names: [...p.querySelectorAll('.pl-name')].map((x) => x.textContent), wheres: [...p.querySelectorAll('.pl-where')].map((x) => x.textContent) }; })()`);
        b411.list = { root: await pl() };
        await js(gm, `[...document.querySelectorAll('.fp[data-id="toklist"] .pl-folder')].find((b) => /Oterians/.test(b.textContent)).click()`); await sleep(400);
        await js(gm, `[...document.querySelectorAll('.fp[data-id="toklist"] .pl-folder')].find((b) => /Fleet/.test(b.textContent)).click()`); await sleep(400);
        b411.list.chaplain = await pl();
        await js(gm, `(() => { const i = document.querySelector('.fp[data-id="toklist"] input[type=search]'); i.value = 'marine'; i.dispatchEvent(new Event('input')); return 1; })()`); await sleep(400);
        b411.list.search = await pl();
        await shot(gm, '49f-token-list-folders');
        await js(gm, `Play.Floats.hide('toklist')`);
        await key('Escape'); await key('V');
        await js(gm, `localStorage.removeItem('libFolders'); localStorage.removeItem('pickFolder:tokens'); Play.ui.lib.folders = {}; 1`);
        for (const f of made) fs.rmSync(f, { force: true });
        C.beta411 = b411;
      }
      // 4.11.1: the room lights' picture of the table is drawn by the TV window (a capture of it made the TV flicker behind
      // Talk's blur); the blurred map is clipped to the screen
      {
        const { ipcMain } = require('electron');
        handle('table.send', { id: mid }); await sleep(1500);
        let got = null; const fn = (e, f) => { got = f; };
        ipcMain.on('amb:frame', fn);
        tv().webContents.send('amb:sample');
        for (let i = 0; i < 40 && !got; i++) await sleep(50);
        ipcMain.removeListener('amb:frame', fn);
        const img = await tv().webContents.capturePage(); const sm = img.resize({ width: 32, quality: 'good' }); const bm = sm.toBitmap(); const z = sm.getSize();
        const avg = (b, n) => { let t = 0; for (let i = 0; i < n * 4; i += 4) t += b[i] + b[i + 1] + b[i + 2]; return t / (n * 3); };
        C.amb = { got: !!got, w: got && got.w, drawn: got ? +avg(got.data, got.w * got.h).toFixed(1) : null, captured: +avg(bm, z.width * z.height).toFixed(1),
          clip: await js(tv(), `(() => { const s = getComputedStyle(document.getElementById('table-stage')); return s.overflow + ' ' + s.contain; })()`) };
      }
    }
    // ---------- Prototype 3: the players' phones (players.js, remote.js), driven over HTTP like a phone would ----------
    // On its own map; a failure in here is noted and does not stop the report.
    try {
      const http = require('http'); const zlib = require('zlib');
      const gmw = W().gm; const tvw = () => W().player;
      const P = C.phones = {};
      const c0 = store.cur; const ch0 = c0.meta.chapters[0];
      const pm = handle('map.add', { chapterId: ch0.id, name: 'Phones (test)' });
      const id = pm.id; const M = () => store.map(id);
      handle('table.send', { id }); await sleep(1500);
      const s = M().grid.size || 1;
      const toks = (await js(gmw, `window.ts.library('list')`)).filter((x) => x.cat === 'tokens');
      const pic = (re) => (toks.find((x) => re.test(x.name)) || toks[0]).path;
      const oldParty = [...(c0.meta.party || [])];
      handle('party.set', { names: ['Mira', 'Thorin'] });
      handle('char.set', { name: 'Mira', patch: { token: pic(/Hero/i), dark: 60, color: '#6cc3ff' } });
      handle('char.set', { name: 'Thorin', patch: { token: pic(/Goblin/i), dark: 0, color: '#ffb35c' } });
      const cx = 10.5 * s; const cy = 10.5 * s;
      const tMira = handle('layer.add', { mapId: id, path: pic(/Hero/i), role: 'token', x: cx, y: cy, size: 1 }).selected;
      handle('layer.add', { mapId: id, path: pic(/Goblin/i), role: 'token', x: cx + 3 * s, y: cy, size: 1 });
      const tOgre = handle('layer.add', { mapId: id, path: pic(/Ogre/i), role: 'token', x: cx - 2 * s, y: cy, size: 1 }).selected;
      handle('wall.add', { mapId: id, segs: [[cx - 2 * s, cy - 1.5 * s, cx + 2 * s, cy - 1.5 * s]] });
      handle('wall.add', { mapId: id, segs: [[cx - 0.5 * s, cy + 0.5 * s, cx + 0.5 * s, cy + 0.5 * s]], door: 1 });
      const mira = () => M().layers.find((l) => l.id === tMira);
      const at = () => [Math.round((mira().x - cx) / s), Math.round((mira().y - cy) / s)];
      await js(gmw, `window.ts.remote('set', { on: true })`); await sleep(1200);
      await js(gmw, `window.ts.players('set', { on: false, pace: 'free', rest: 0, pings: true, eyes: true, trace: true })`);
      const port = await js(gmw, `Play.state().remote.port`);
      const post = (pth, body) => new Promise((res) => {
        const data = JSON.stringify(body);
        const rq = http.request({ host: '127.0.0.1', port, path: pth, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (r) => {
          let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch {} res({ status: r.statusCode, ...(j || {}) }); });
        });
        rq.on('error', (e) => res({ status: 0, error: e.message })); rq.end(data);
      });
      // a phone's event stream: the latest state it was sent
      const stream = (token) => {
        const o = { last: null, req: null };
        o.req = http.get({ host: '127.0.0.1', port, path: `/api/events?t=${encodeURIComponent(token)}` }, (r) => {
          let buf = '';
          r.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); if (!/^event:/m.test(ev)) { const m = /^data: (.*)$/m.exec(ev); if (m) { try { o.last = JSON.parse(m[1]); } catch {} } } } });
        });
        o.req.on('error', () => {});
        return o;
      };
      const pairP = (pid, name) => post('/api/pair', { key: settings.remote.playerKey, id: pid, name, kind: 'phone' });
      const A = await pairP('st-a', 'Phone A'); const B = await pairP('st-b', 'Phone B');
      const D = await post('/api/pair', { key: settings.remote.key, id: 'st-dm', name: 'DM phone', kind: 'phone' });
      const sa = stream(A.token); const sd = stream(D.token);
      const doA = (op, arg = {}) => post('/api/do', { t: A.token, op, arg });
      const doB = (op, arg = {}) => post('/api/do', { t: B.token, op, arg });
      const step = async (dir) => { await sleep(170); const r = await doA('move', { dir }); await sleep(120); return r; };
      await sleep(700);
      P.paired = { a: A.role, b: B.role, d: D.role, ctlOff: sa.last && sa.last.ctl && sa.last.ctl.on, noScene: sa.last && !('scene' in sa.last), dmHasNoCtl: sd.last && !('ctl' in sd.last) };
      // switched off: nothing a phone asks for happens
      const offPick = await doA('pick', { name: 'Mira' });
      P.off = { pick: offPick.ok, why: offPick.why, eyes: M().fx.filter((f) => f.preset === 'party').length };
      // a player's phone may not do what the DM's phone does
      P.playerAsDm = (await doA('lights', { do: 'toggle' })).status;
      // on: pick, the eye, the same character on a second phone
      await js(gmw, `window.ts.players('set', { on: true })`); await sleep(300);
      const pk = await doA('pick', { name: 'Mira' });
      const eye = M().fx.find((f) => f.preset === 'party' && f.attachTo === tMira);
      P.pick = { ok: pk.ok, eye: !!eye, dv: eye && eye.darkvision, second: (await doB('pick', { name: 'Mira' })).error, notInParty: (await doB('pick', { name: 'Nobody' })).ok };
      // the stick is pushed: the TV shows the aim; let go without a step: gone
      await doA('aim', { dir: 'e' }); await sleep(250);
      const aimOn = await js(tvw(), `(() => { const a = document.querySelector('.sv-aim'); return a ? a.className : null; })()`);
      await doA('aim', { dir: null }); await sleep(250);
      P.aim = { on: aimOn, off: await js(tvw(), `document.querySelectorAll('.sv-aim').length`) };
      // a step east: the token moves one square, and it slides there on the TV (a transition is running right after)
      const e1 = await doA('move', { dir: 'e' });
      const sliding = await js(tvw(), `(() => { const e = document.querySelector('.sv-token[data-id="${tMira}"]'); return e ? { cls: e.classList.contains('sv-slide'), anims: e.getAnimations().filter((a) => a.transitionProperty === 'left' || a.transitionProperty === 'top').length } : null; })()`);
      await sleep(500);
      P.step = { ok: e1.ok, at: at(), sliding };
      // north once, then the wall; east into Thorin; west back, on west the DM's Ogre (no name given away)
      const n1 = await step('n'); const n2 = await step('n');
      P.wall = { first: n1.ok, second: n2.ok, error: n2.error, at: at() };
      await step('s'); await step('e');
      const th = await step('e');
      P.bump = { ok: th.ok, error: th.error, at: at() };
      await step('w'); await step('w'); await step('w');
      const og = await step('w');
      P.ogre = { ok: og.ok, error: og.error, at: at() };
      await step('e');
      // Prototype 6: the Ping button (it never arrived: "ping" was already the phones' own "are you there"); turning
      // and doors are gone from the phones
      await sleep(300);
      const pt = await doA('point'); await sleep(250);
      P.point = { ok: pt.ok, tv: await js(tvw(), `document.querySelectorAll('.sv-ping').length`), gm: await js(gmw, `document.querySelectorAll('.sv-ping').length`), at: at(),
        door: (await doA('door')).status, turn: (await doA('turn', { by: 45 })).status, closed: !M().walls.find((w) => w.door).open };
      // paused by the DM
      await js(gmw, `window.ts.players('set', { pace: 'paused' })`); await sleep(300);
      const ps = await step('n');
      P.paused = { move: ps.ok, error: ps.error };
      await js(gmw, `window.ts.players('set', { pace: 'free' })`); await sleep(300);
      // a fight, shown on the TV: the Ogre first (the players have not met it: no name on the phone), then Thorin, then Mira
      handle('init.prepare', {}); await sleep(300);
      const ents = state.init.entries;
      const eOf = (n) => ents.find((e) => e.name === n) || ents.find((e) => (e.tokens || []).includes(tOgre) && n === 'Ogre');
      const eo = ents.find((e) => !e.pc);
      if (eo) handle('init.set', { id: eo.id, init: 25 });
      handle('init.set', { id: eOf('Thorin').id, init: 20 }); handle('init.set', { id: eOf('Mira').id, init: 5 });
      // Prototype 6: a turn order that runs blocks the phones, shown on the TV or not
      handle('init.start', {}); handle('init.update', { show: false }); await sleep(1300);
      const hid = await step('n');
      P.hiddenOrder = { ok: hid.ok, error: hid.error, who: sa.last && sa.last.ctl.me.fight && sa.last.ctl.me.fight.who, tv: await js(tvw(), `document.querySelector('.tv-init').classList.contains('on')`) };
      handle('init.update', { show: true }); await sleep(1300);
      const foe = await step('n');
      P.foeTurn = { foe: eo && eo.name, ok: foe.ok, error: foe.error, who: sa.last && sa.last.ctl.me.fight && sa.last.ctl.me.fight.who };
      handle('init.next', {}); await sleep(1300);
      const tt = await step('n');
      P.thorinTurn = { ok: tt.ok, error: tt.error, who: sa.last && sa.last.ctl.me.fight && sa.last.ctl.me.fight.who };
      handle('init.next', {}); await sleep(1300);
      // Mira's turn: 30 ft. A diagonal 5, the next diagonal 10 (5-10-5), then three straight: 30. The squares leave a trace.
      const mine0 = sa.last && sa.last.ctl.me.fight;
      const walk = []; for (const d of ['ne', 'sw', 'e', 'w', 'e', 'w']) walk.push((await step(d)).ok);
      await sleep(500);
      const leftSpent = sa.last && sa.last.ctl.me.fight && sa.last.ctl.me.fight.left;
      const trace = { gm: await js(gmw, `(Play.state().trails || []).map((t) => ({ total: t.total, n: t.pts.length, ft: t.pts.map((p) => p.ft) }))`),
        tv: await js(tvw(), `({ dots: document.querySelectorAll('.tv-layer.shown .sv-trail-dot').length, total: (document.querySelector('.tv-layer.shown .sv-trail-total') || {}).textContent })`) };
      await shot(tvw(), '26c-phones-trace');
      const dash = await doA('dash'); const dash2 = await doA('dash');
      const afterDash = await step('w');
      // the same character on another phone is no second turn: A lets go, B takes Mira (A is still there: refused)
      P.myTurn = { mine: mine0 && mine0.mine, walk, leftSpent, dash: dash.ok, dash2: dash2.ok, afterDash: afterDash.ok, otherPhone: (await doB('pick', { name: 'Mira' })).ok };
      handle('init.next', {}); await sleep(900);
      trace.after = await js(gmw, `(Play.state().trails || []).length`);
      P.trace = trace;
      handle('init.end', {}); await sleep(400);
      // the list of devices is full: a player's code makes room with the longest-gone player phone, never with a DM's device or a connected one
      const devs = settings.remote.devices;
      const mine = devs.filter((d) => /^st-/.test(d.id));
      settings.remote.devices = [...mine, { id: 'old-dm', token: 'x'.repeat(24), name: 'Old DM tablet', kind: 'tablet', role: 'dm', added: 1, seen: 1 },
        ...Array.from({ length: 16 - mine.length - 1 }, (_, i) => ({ id: `old-p${i}-p`, token: `${'y'.repeat(20)}${i}`, name: `Old phone ${i}`, kind: 'phone', role: 'player', added: 2 + i, seen: 2 + i }))];
      const full = settings.remote.devices.length;
      const N = await pairP('st-new', 'New phone'); await sleep(200);
      const ids = settings.remote.devices.map((d) => d.id);
      P.cap = { full, ok: N.ok, count: ids.length, oldDm: ids.includes('old-dm'), dm: ids.includes('st-dm'), a: ids.includes('st-a-p'), goneOldest: !ids.includes('old-p0-p'), kept1: ids.includes('old-p1-p') };
      // new devices from one address are counted
      let made = 0; let refused = null;
      for (let i = 0; i < 9 && !refused; i++) { const r = await pairP(`st-flood${i}`, 'Flood'); if (r.ok) made++; else refused = r.status; }
      P.flood = { made, refused, dm: settings.remote.devices.some((d) => d.id === 'st-dm') };
      // the join code on the TV, the seat glow
      await js(gmw, `window.ts.players('join', { on: true })`); await sleep(700);
      P.join = await js(tvw(), `(() => { const e = document.querySelector('.tv-join'); return { on: e.classList.contains('on'), qr: e.querySelectorAll('.jn-qr svg').length }; })()`);
      await shot(tvw(), '26a-phones-join');
      await js(gmw, `window.ts.players('join', { on: false })`);
      await doA('calib', { on: true }); await sleep(500);
      const glow = await js(tvw(), `document.querySelector('.tv-calib').classList.contains('on')`);
      await doA('calib', { on: false }); await sleep(500);
      P.calib = { on: glow, off: await js(tvw(), `document.querySelector('.tv-calib').classList.contains('on')`) };
      // the DM's panel
      await js(gmw, `Play.TB.openPanel('players')`); await sleep(900);
      P.panel = await js(gmw, `(() => { const p = document.querySelector('.fp[data-id="players"]'); return p ? { phones: [...p.querySelectorAll('.pp-phone .pp-head b')].map((x) => x.textContent), mira: /Mira/.test(p.textContent) } : null; })()`);
      await shot(gmw, '26b-phones-panel');
      await js(gmw, `Play.Floats.hide('players')`);
      // the problem report carries no key, token or code
      settings.roomLights.goveeKey = 'GOVEE-SECRET-123'; settings.roomLights.tradfri = { host: '192.168.1.50', identity: 'tradfri-identity-abc', psk: 'tradfri-psk-xyz' };
      const rep = await js(gmw, `window.ts.app('report.make', { note: 'self-test: secrets' })`);
      const zipBuf = fs.readFileSync(rep.file);
      const readEntry = (name) => { // (the report's own zip: local headers, stored or deflated)
        let i = 0;
        while (i + 30 < zipBuf.length && zipBuf.readUInt32LE(i) === 0x04034b50) {
          const method = zipBuf.readUInt16LE(i + 8); const csize = zipBuf.readUInt32LE(i + 18); const nlen = zipBuf.readUInt16LE(i + 26); const xlen = zipBuf.readUInt16LE(i + 28);
          const nm = zipBuf.slice(i + 30, i + 30 + nlen).toString('utf8'); const body = zipBuf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
          if (nm === name) return (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8');
          i += 30 + nlen + xlen + csize;
        }
        return null;
      };
      const st = readEntry('settings.json') || '';
      const secrets = [settings.remote.key, settings.remote.playerKey, A.token, D.token, 'GOVEE-SECRET-123', 'tradfri-identity-abc', 'tradfri-psk-xyz'];
      P.report = { read: st.length > 100, leaked: secrets.filter((x) => x && st.includes(x)).length, keepsHost: st.includes('192.168.1.50'), keepsNames: st.includes('Phone A') };
      settings.roomLights.goveeKey = ''; settings.roomLights.tradfri = null;
      // tidy up
      sa.req.destroy(); sd.req.destroy();
      settings.remote.devices = [];
      await js(gmw, `window.ts.players('set', { on: false })`);
      await js(gmw, `window.ts.remote('set', { on: false })`);
      handle('party.set', { names: oldParty });
    } catch (err) {
      C.phones = { ...(C.phones || {}), err: String((err && err.stack) || err) };
    }
  } catch (err) {
    report.errors.push(String((err && err.stack) || err));
  }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
};
