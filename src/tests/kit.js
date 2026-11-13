// What every check works with: the windows, real mouse and keyboard input, waiting, and a known starting point.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.sleep = sleep;
exports.make = async (env, dir) => {
  const { store, state, handle, getWindows, library, settings } = env;
  const K = { env, store, state, handle, library, settings, dir, sleep, broadcast: () => env.broadcast() };
  const errors = []; // { where, text } of everything that went wrong in the app, in order
  K.errors = errors;

  // ---------- what goes wrong, from every window and from the main process ----------
  const hooked = new Set();
  const hook = (w, name) => {
    if (!w || w.isDestroyed() || hooked.has(w)) return;
    hooked.add(w);
    w.webContents.on('console-message', (e, lvl, msg) => {
      const level = typeof e.level === 'string' ? e.level : lvl;
      const text = e.message || msg;
      if (level === 'error' || level === 3) errors.push({ where: name, text: String(text) });
    });
    w.webContents.on('render-process-gone', (e, d) => { if (!K.expectCrash) errors.push({ where: name, text: `window stopped: ${d.reason}` }); });
    w.webContents.on('did-fail-load', (e, code, desc) => errors.push({ where: name, text: `did not load: ${desc}` }));
  };
  K.expectCrashOn = () => { K.expectCrash = true; };
  K.expectCrashOff = () => { K.expectCrash = false; };
  K.hookAll = () => { const w = getWindows(); hook(w.gm, 'GM screen'); hook(w.player, 'TV'); hook(w.sound, 'sound'); };
  try {
    const applog = require('../applog');
    const orig = applog.log.error;
    applog.log.error = (...a) => {
      const text = a.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
      // the windows' own errors arrive through their consoles already
      if (!/^\[?(gm|table|player|sound)\b/i.test(text)) errors.push({ where: 'main', text });
      orig(...a);
    };
  } catch {}

  // ---------- the windows ----------
  K.W = () => getWindows();
  K.gm = () => getWindows().gm;
  K.tv = () => getWindows().player;
  K.js = (w, code) => w.webContents.executeJavaScript(code);
  K.g = (code) => K.js(K.gm(), code); // in the GM window
  K.t = (code) => K.js(K.tv(), code); // in the TV window
  K.until = async (fn, ms = 6000, what = 'it') => {
    const t0 = Date.now();
    let last;
    for (;;) {
      try { last = await fn(); } catch (e) { last = null; }
      if (last) return last;
      if (Date.now() - t0 > ms) throw new Error(`waited ${Math.round(ms / 1000)} s for ${what}`);
      await sleep(80);
    }
  };

  // the windows have taken in everything sent to them so far (a change is sent on the next tick; a question asked after it is answered after it)
  K.settle = async () => {
    await new Promise((r) => setImmediate(r));
    const ask = (w) => (w && !w.isDestroyed() && !w.webContents.isLoading() ? Promise.race([w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => r(1)))').catch(() => 0), sleep(1500)]) : null);
    await ask(K.gm()); await ask(K.tv());
  };
  // a command as the app would send it, and the windows have caught up
  K.cmd = async (type, p) => { const r = handle(type, p || {}); await K.settle(); return r; };

  // ---------- real input ----------
  K.key = async (keyCode, modifiers = []) => {
    const w = K.gm().webContents;
    w.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && !modifiers.includes('control') && !modifiers.includes('alt')) w.sendInputEvent({ type: 'char', keyCode, modifiers });
    w.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(120);
    await K.settle();
  };
  K.mouse = async (type, x, y, button = 'left', extra = {}) => {
    K.gm().webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button, clickCount: 1, ...extra });
    await sleep(25);
  };
  K.click = async (x, y, button = 'left', modifiers = []) => {
    await K.mouse('mouseMove', x, y, button, { modifiers });
    await K.mouse('mouseDown', x, y, button, { modifiers });
    await K.mouse('mouseUp', x, y, button, { modifiers });
    await sleep(120);
    await K.settle();
  };
  K.drag = async (a, b, steps = 10, modifiers = []) => {
    await K.mouse('mouseMove', a.x, a.y, 'left', { modifiers });
    await K.mouse('mouseDown', a.x, a.y, 'left', { modifiers });
    // moves while the button is held must say so, or Chromium cancels the pointer
    for (let i = 1; i <= steps; i++) await K.mouse('mouseMove', a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, 'left', { modifiers: [...modifiers, 'leftButtonDown'] });
    await K.mouse('mouseUp', b.x, b.y, 'left', { modifiers });
    await sleep(300);
    await K.settle();
  };
  K.rect = (sel) => K.g(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
  K.clickSel = async (sel, button) => { const r = await K.rect(sel); if (!r) throw new Error(`not on screen: ${sel}`); await K.click(r.cx, r.cy, button); return r; };
  // the first element matching sel whose text (or label) contains `text`
  K.findText = (sel, text) => K.g(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}) || (x.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  K.clickText = async (sel, text, button) => { const p = await K.findText(sel, text); if (!p) throw new Error(`not on screen: ${sel} "${text}"`); await K.click(p.x, p.y, button); return p; };
  K.rightClickSel = async (sel) => {
    const r = await K.rect(sel); if (!r) throw new Error(`not on screen: ${sel}`);
    await K.click(r.cx, r.cy, 'right');
    // (a right mouse button alone does not always raise the menu event on a test screen)
    if (!(await K.g(`!!document.querySelector('#menu.on, #radial.on')`))) await K.g(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${Math.round(r.cx)}, clientY: ${Math.round(r.cy)} }))`);
    await sleep(250);
    return r;
  };
  K.type = async (text) => { await K.gm().webContents.insertText(text); await sleep(120); };
  K.menu = () => K.g(`document.querySelector('#menu.on') ? [...document.querySelectorAll('#menu .menu-item')].map((x) => x.querySelector('.grow') ? x.querySelector('.grow').textContent : x.textContent) : null`);
  K.menuPick = async (text) => { await K.clickText('#menu.on .menu-item', text); await sleep(200); };
  K.text = (sel) => K.g(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  K.count = (sel) => K.g(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  K.shot = async (w, name) => {
    if (!w || w.isDestroyed()) return;
    w.webContents.invalidate();
    await sleep(250);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  // "null", "undefined" or "NaN" written anywhere visible
  K.badText = async () => {
    const scan = `(() => { const out = []; const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = it.nextNode())) { const t = n.textContent.trim(); const el = n.parentElement; if (/^(null|undefined)$|\\bundefined\\b|\\bNaN\\b/.test(t) && el && !el.closest('script, style, textarea') && el.getClientRects().length) out.push(t.slice(0, 60) + ' (in ' + (el.className || el.tagName) + ')'); } return out; })()`;
    const out = [];
    for (const [name, w] of [['GM screen', K.gm()], ['TV', K.tv()]]) {
      if (!w || w.isDestroyed()) continue;
      const bad = await K.js(w, scan).catch(() => []);
      for (const b of bad) out.push(`${name}: ${b}`);
    }
    return out;
  };

  // ---------- a known starting point ----------
  K.ready = async () => {
    await K.until(async () => { const w = K.gm(); return w && !w.webContents.isLoading() && await K.js(w, 'window.__tsReady === true'); }, 20000, 'the GM screen to start');
    K.hookAll();
    await sleep(600);
    // the frame-rate watch would ask all the time on a slow test screen
    await K.g(`window.ts.settings({ fpsWatch: false })`);
  };
  K.demo = () => store.list().find((c) => /Demo/.test(c.name));
  // the demo campaign open on the maps
  K.openDemo = async () => {
    const d = K.demo();
    if (!d) throw new Error('the demo campaign is missing');
    handle('campaign.open', { id: d.id });
    handle('campaign.play');
    await K.until(() => K.g(`document.body.dataset.screen === 'play' && !!Play.state() && !!Play.state().map`), 10000, 'the maps to open');
    await sleep(500);
    return d;
  };
  // the map being edited goes to the TV; waits until the TV really shows it
  K.send = async (id = state.editMapId) => {
    handle('table.send', { id });
    await K.until(() => K.tv() && !K.tv().webContents.isLoading(), 10000, 'the TV window');
    K.hookAll();
    await K.until(() => K.t(`window.__table && window.__table.debug() && window.__table.debug().liveId === ${JSON.stringify(id)}`), 15000, 'the map on the TV');
    await sleep(400);
  };
  // an empty map of the check's own (in the first chapter), opened for editing; with tv: true also on the TV
  K.newMap = async (name = 'Test map', { tv = false, blank = false } = {}) => {
    const ch = store.cur.meta.chapters[0];
    const r = handle('map.add', { chapterId: ch.id, name });
    const id = r && r.id;
    if (!id) throw new Error(`could not add a map: ${JSON.stringify(r)}`);
    handle('edit.open', { id });
    await K.until(() => K.g(`Play.state() && Play.state().map && Play.state().map.id === ${JSON.stringify(id)}`), 8000, 'the new map to open');
    // a still picture as its background (an empty map shows a card in the middle that would be in the way)
    if (!blank) {
      const bg = library.listLibrary().find((x) => x.cat === 'maps' && x.kind === 'image' && /\.(png|jpe?g|webp)$/i.test(x.path));
      if (bg) { handle('bg.set', { mapId: id, path: bg.path }); await K.until(() => { const m = store.map(id); return m.bg && (m.bg.scale != null || m.bg.span); }, 8000, 'the map picture to be placed'); }
    }
    if (tv) await K.send(id);
    await sleep(300);
    return id;
  };
  K.E = () => store.map(state.editMapId);
  K.L = () => store.map(state.liveMapId);
  K.lib = (cat) => library.listLibrary().filter((x) => x.cat === cat);
  K.pic = (cat, re) => { const all = K.lib(cat); const hit = (re && all.find((x) => re.test(x.name))) || all[0]; if (!hit) throw new Error(`nothing in the library under ${cat}`); return hit.path; };
  // map inches -> a point on the GM screen
  K.scr = (x, y) => K.g(`Play.view().mapToScreen(${x}, ${y})`);
  K.viewport = () => K.rect('#viewport');
  K.tool = () => K.g('document.body.dataset.tool');
  K.popTitle = () => K.g(`(() => { const e = document.querySelector('#pop.on .pop-title'); return e ? e.textContent : null; })()`);
  K.panels = () => K.g(`[...document.querySelectorAll('.fp')].map((p) => ({ id: p.dataset.id, title: (p.querySelector('.fp-title') || {}).textContent }))`);
  K.tvDebug = () => K.t('window.__table.debug()');
  K.sound = () => K.js(K.W().sound, 'SoundEngine.debug()');

  // everything that may be left open is closed again, so the next check starts clean
  K.calm = async () => {
    const w = K.gm();
    if (!w || w.isDestroyed()) return;
    for (let i = 0; i < 6 && await K.g(`!!document.querySelector('.modal-back')`).catch(() => false); i++) await K.key('Escape');
    // (the mouse rests in a corner, so nothing is left hovering)
    await K.mouse('mouseMove', 2, 2).catch(() => {});
    await K.g(`(() => {
      try { UI.closeMenu(); } catch (e) {}
      try { const r = document.querySelector('#radial'); if (r) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
      try { if (typeof Guide !== 'undefined' && Guide.isOpen()) Guide.close(); } catch (e) {}
      try { if (App.optionsOpen()) App.closeOptions(); } catch (e) {}
      if (document.body.dataset.screen === 'play') {
        try { Play.closePop(); } catch (e) {}
        try { Play.Floats.closeAll(); } catch (e) {}
        try { if (Play.Drawer && Play.Drawer.isOpen) Play.Drawer.close(); } catch (e) {}
        try { Play.setTool('fog'); Play.setTool('select'); } catch (e) {} // (another tool lets go of what was selected)
      }
      for (const t of document.querySelectorAll('.toast')) t.remove();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    })()`).catch(() => {});
    await sleep(120);
  };

  // ---------- a phone, over HTTP like a real one ----------
  K.phone = (port) => {
    const call = (method, pth, body) => new Promise((res) => {
      const data = body == null ? null : JSON.stringify(body);
      const rq = http.request({ host: '127.0.0.1', port, path: pth, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (r) => {
        const parts = []; r.on('data', (d) => parts.push(d));
        r.on('end', () => { const buf = Buffer.concat(parts); let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {} res({ status: r.statusCode, type: r.headers['content-type'] || '', bytes: buf.length, text: j ? null : buf.toString('utf8').slice(0, 4000), ...(j || {}) }); });
      });
      rq.on('error', (e) => res({ status: 0, error: e.message }));
      rq.end(data || undefined);
    });
    // the stream of states a paired phone listens to: .last is the newest
    const stream = (token) => {
      const o = { last: null, n: 0, req: null, close: () => { try { o.req.destroy(); } catch {} } };
      o.req = http.get({ host: '127.0.0.1', port, path: `/api/events?t=${encodeURIComponent(token)}` }, (r) => {
        let buf = '';
        r.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); if (!/^event:/m.test(ev)) { const m = /^data: (.*)$/m.exec(ev); if (m) { try { o.last = JSON.parse(m[1]); o.n++; } catch {} } } } });
      });
      o.req.on('error', () => {});
      return o;
    };
    const post = (p, body) => call('POST', p, body || {});
    return { port, get: (p) => call('GET', p), post, stream, pair: (key, id, name) => post('/api/pair', { key, id, name, kind: 'phone' }), run: (token, op, arg = {}) => post('/api/do', { t: token, op, arg }) };
  };

  // the phones' server switched on; answers with a phone to talk to it
  K.phonesOn = async () => {
    await K.g(`window.ts.remote('set', { on: true })`);
    const port = await K.until(() => K.g(`Play.state().remote && Play.state().remote.port`), 8000, 'the phones\' server');
    await sleep(300);
    return K.phone(port);
  };

  return K;
};

// a check's own view of the kit: once the check is stopped (it took too long), nothing of it acts any more
exports.forCheck = (K, ctl) => {
  const t = {};
  for (const [k, v] of Object.entries(K)) {
    t[k] = typeof v === 'function' ? (...a) => { if (ctl.dead) throw new Error('(stopped)'); return v(...a); } : v;
  }
  const show = (v) => { try { const s = JSON.stringify(v); return s && s.length > 300 ? `${s.slice(0, 300)}…` : s; } catch { return String(v); } };
  t.ok = (cond, what, detail) => { if (!cond) throw new Error(`${what}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : show(detail)})` : ''}`); };
  t.eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: expected ${show(want)}, got ${show(got)}`); };
  t.near = (got, want, tol, what) => { if (typeof got !== 'number' || Math.abs(got - want) > tol) throw new Error(`${what}: expected about ${want}, got ${show(got)}`); };
  t.has = (list, item, what) => { if (!Array.isArray(list) || !list.includes(item)) throw new Error(`${what}: "${item}" is not in ${show(list)}`); };
  t.note = (text) => { ctl.notes.push(String(text)); };
  return t;
};
