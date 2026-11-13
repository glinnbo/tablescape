'use strict';
// Beta 4: phones and tablets, served by Tablescape itself on the home network. Nothing listens until the GM switches
// it on (Toolbox → Phone & tablet), or opens the player screen on another screen of this PC (then only this PC).
//   GET  /                 the page (src/remote/): the DM's Stream Deck, or the player screen, by the device's role
//   GET  /api/face/<k>?t=  a portrait the state names (only those: nothing else of the computer is served)
//   POST /api/pair         { key, id, kind, name } → a token for this device; the key says DM or players (two QR codes)
//   GET  /api/events?t=    the state, pushed when it changes (server-sent events; the browser reconnects by itself)
//   POST /api/do           { t, op, arg } → main.js does it (run, init, lights, sound); a player's phone only its token (pick, move, aim, calib, dash, point)
// Only addresses of a home network get in (192.168…, 10…, 172.16–31…, fe80/fc/fd…, this computer).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
};
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/manifest.json': 'manifest.json', '/keepawake.mp4': 'keepawake.mp4' };
const MAX_DEVICES = 16;
const PLAYER_OPS = ['pick', 'unpick', 'move', 'aim', 'calib', 'dash', 'point', 'extra']; // Prototype 1 (players.js OPS; 'ping' below is the phone asking "are you there", so the Ping button is 'point')
const DEFAULT_PORT = 47630;

function privateAddr(a) {
  const s = String(a || '').replace(/^::ffff:/, '');
  if (s === '::1' || s.startsWith('127.')) return true;
  if (/^10\./.test(s) || /^192\.168\./.test(s) || /^169\.254\./.test(s)) return true;
  const m = /^172\.(\d+)\./.exec(s);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(s) || /^fe80:/i.test(s);
}
// this computer's addresses on the home network, the likeliest first (virtual adapters last)
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const x of list || []) {
      if ((x.family !== 'IPv4' && x.family !== 4) || x.internal || !privateAddr(x.address) || x.address.startsWith('169.254.')) continue;
      const virt = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|TAP|Tailscale|ZeroTier|docker|vbox|utun|Npcap/i.test(name);
      out.push({ ip: x.address, name, rank: (virt ? 10 : 0) + (x.address.startsWith('192.168.') ? 0 : x.address.startsWith('10.') ? 1 : 2) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newToken = () => crypto.randomBytes(18).toString('base64url');

function createRemote(o) {
  const cfg = () => o.cfg();
  const log = o.log || (() => {});
  let server = null; let port = null; let err = null; let boundTo = null;
  let localWanted = false; // the player screen in a window of this PC (works with phones off: this PC only)
  const clients = new Set(); // { dev, res, last }
  const fails = new Map(); // address → times of wrong codes
  const pairs = new Map(); // address → times a new device was made
  const faces = new Map(); // key → file (the portraits the state names right now)
  if (!cfg().key) { cfg().key = newToken(); o.save(); }
  if (!cfg().playerKey) { cfg().playerKey = newToken(); o.save(); }
  const devs = () => { if (!Array.isArray(cfg().devices)) cfg().devices = []; return cfg().devices; };
  const localDev = () => { if (!cfg().localToken) { cfg().localToken = newToken(); o.save(); } return { id: 'this-pc', token: cfg().localToken, role: 'player', name: 'This PC', kind: 'screen', local: true }; };
  const devBy = (t) => { if (!t) return null; if (cfg().localToken && safeEq(t, cfg().localToken)) return localDev(); return devs().find((d) => safeEq(d.token, t)) || null; };
  let ipCache = { at: 0, list: [] };
  const ips = () => {
    if (o.testIp) return [{ ip: o.testIp, name: 'test', rank: 0 }]; // (the self-test's computer has no home network)
    if (Date.now() - ipCache.at > 5000) ipCache = { at: Date.now(), list: addresses() };
    return ipCache.list;
  };

  // ------------------------------------------------------------------ the server
  const wantHost = () => (cfg().on ? (o.host || '0.0.0.0') : '127.0.0.1');
  let waiters = [];
  function settle() { const w = waiters; waiters = []; for (const f of w) f(); }
  function ensure() {
    const want = !!cfg().on || localWanted;
    if (!want) { stop(); return; }
    if (server && boundTo === wantHost()) return;
    if (server) stop(true);
    start();
  }
  function start() {
    err = null;
    const host = wantHost();
    const first = Number(o.port || cfg().port) || DEFAULT_PORT; // (cfg().port: where an older version settled; the icons point there)
    let tryPort = first;
    let tries = 0;
    const srv = http.createServer(onRequest);
    srv.keepAliveTimeout = 30000;
    srv.on('error', (e) => {
      if (server !== srv) return;
      if (e.code === 'EADDRINUSE' && tries < 9) { tries += 1; tryPort += 1; setTimeout(() => { if (server === srv) srv.listen(tryPort, host); }, 50); return; }
      err = e.code === 'EADDRINUSE' ? 'Another program uses the port' : e.code === 'EACCES' ? 'Windows did not allow Tablescape to listen on the network' : e.message;
      log(`remote: ${e.message}`);
      server = null; port = null; boundTo = null; settle(); o.onChange();
    });
    srv.on('listening', () => { if (server !== srv) return; port = srv.address().port; if (tries) log(`remote: port ${first} busy, using ${port} for now`); /* (4.2.2) not kept: the next start tries the usual port again */ ipCache.at = 0; settle(); o.onChange(); });
    server = srv; boundTo = host;
    srv.listen(tryPort, host);
  }
  function stop(quiet = false) {
    for (const c of clients) { try { c.res.end(); } catch {} }
    clients.clear();
    if (server) { try { server.close(); if (server.closeAllConnections) server.closeAllConnections(); } catch {} }
    server = null; port = null; boundTo = null;
    if (tickT) { clearInterval(tickT); tickT = null; }
    if (!quiet) o.onChange();
  }
  const ready = () => new Promise((resolve) => { if (!server || port) resolve(); else waiters.push(resolve); });

  function send(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  function onRequest(req, res) {
    if (!privateAddr(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    let u;
    try { u = new URL(req.url, 'http://tablescape'); } catch { res.writeHead(400); res.end(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (u.pathname.startsWith('/api/')) {
      api(req, res, u).catch((e) => { log(`remote api: ${e.stack || e}`); try { send(res, 500, { ok: false, error: 'Something went wrong in Tablescape' }); } catch {} });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let file = null;
    const p = u.pathname;
    if (FILES[p]) file = path.join(o.dir, FILES[p]);
    else if (p === '/icons.js') file = o.icons;
    else if (p === '/icon.png') file = o.appIcon;
    else if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(p)) file = path.join(o.fonts, p.slice(7));
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not here'); return; }
    serveFile(req, res, file, `"${o.label}`, 'no-cache');
  }
  function serveFile(req, res, file, tagBase, cache) {
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); res.end(); return; }
      const tag = `${tagBase}-${buf.length}"`;
      if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); res.end(); return; }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      // (4.2.2) a part of the file (iPhone and iPad only play a video from a server that answers this)
      const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (rg && (rg[1] || rg[2])) {
        const len = buf.length;
        const a = rg[1] === '' ? Math.max(0, len - Number(rg[2])) : Number(rg[1]);
        const b = rg[1] !== '' && rg[2] !== '' ? Math.min(Number(rg[2]), len - 1) : len - 1;
        if (!(a <= b && a < len)) { res.writeHead(416, { 'Content-Range': `bytes */${len}` }); res.end(); return; }
        res.writeHead(206, { 'Content-Type': type, 'Cache-Control': cache, ETag: tag, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${len}`, 'Content-Length': b - a + 1 });
        res.end(req.method === 'HEAD' ? undefined : buf.subarray(a, b + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, ETag: tag, 'Accept-Ranges': 'bytes' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  }
  function readBody(req, limit) {
    return new Promise((resolve) => {
      const parts = []; let n = 0; let over = false;
      req.on('data', (d) => { n += d.length; if (n > limit) { over = true; req.destroy(); } else parts.push(d); });
      req.on('end', () => { if (over) { resolve(null); return; } try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve(null));
    });
  }
  async function api(req, res, u) {
    if (u.pathname === '/api/events' && req.method === 'GET') { events(req, res, u); return; }
    const fm = /^\/api\/face\/([A-Za-z0-9_-]{8,40})$/.exec(u.pathname);
    if (fm && req.method === 'GET') {
      const file = devBy(u.searchParams.get('t')) ? faces.get(fm[1]) : null;
      if (!file) { res.writeHead(404); res.end(); return; }
      serveFile(req, res, file, `"f${fm[1]}`, 'private, max-age=86400');
      return;
    }
    if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
    const body = await readBody(req, 64 * 1024);
    if (!body) { send(res, 413, { ok: false, error: 'Too big' }); return; }
    if (u.pathname === '/api/pair') { pair(res, body, req.socket.remoteAddress); return; }
    if (u.pathname === '/api/do') {
      const d = devBy(body.t);
      if (!d) { send(res, 401, { ok: false, error: 'This device is not connected to Tablescape any more' }); return; }
      d.seen = Date.now();
      const op = String(body.op || '');
      const arg = body.arg && typeof body.arg === 'object' ? body.arg : {};
      if (op === 'ping') { send(res, 200, { ok: true }); return; }
      if (op === 'leave') { if (!d.local) { cfg().devices = devs().filter((x) => x !== d); drop(d); o.save(); o.onChange(); } send(res, 200, { ok: true }); return; }
      if (d.role !== 'dm' && !PLAYER_OPS.includes(op)) { send(res, 403, { ok: false, error: 'The player screen only shows' }); return; } // (Prototype 1: a player's phone moves its token)
      const r = await o.run(op, arg, d);
      changed();
      send(res, 200, r || { ok: true });
      return;
    }
    send(res, 404, { ok: false });
  }

  // ------------------------------------------------------------------ devices
  function pair(res, b, addr) {
    const now = Date.now();
    const f = (fails.get(addr) || []).filter((t) => now - t < 600000);
    if (f.length >= 10) { send(res, 429, { ok: false, error: 'Too many wrong codes: wait a few minutes' }); return; }
    const role = b.key && safeEq(b.key, cfg().key) ? 'dm' : b.key && safeEq(b.key, cfg().playerKey) ? 'player' : null;
    if (!role) {
      f.push(now); fails.set(addr, f);
      send(res, 403, { ok: false, error: 'This code is old: scan the QR code in Tablescape again (Toolbox → Remote)' });
      return;
    }
    const id = `${String(b.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || newToken()}${role === 'player' ? '-p' : ''}`;
    let d = devs().find((x) => x.id === id);
    if (!d) {
      const kind = b.kind === 'tablet' ? 'tablet' : 'phone';
      // Prototype 3: new devices from one address are counted (a phone that pairs again and again fills the list)
      const made = (pairs.get(addr) || []).filter((t) => now - t < 600000);
      if (made.length >= 8) { send(res, 429, { ok: false, error: 'Too many new devices from here: wait a few minutes' }); return; }
      made.push(now); pairs.set(addr, made);
      if (devs().length >= MAX_DEVICES) {
        // full: the one that makes room is not connected, and a player's code never pushes out a DM's device
        const live = (x) => [...clients].some((c) => c.dev === x);
        const gone = devs().filter((x) => !live(x) && (role === 'dm' || x.role === 'player')).sort((x, y) => (x.seen || 0) - (y.seen || 0))[0];
        if (!gone) { send(res, 429, { ok: false, error: 'Tablescape has all its devices connected: the DM can forget one (Toolbox → Remote)' }); return; }
        drop(gone); cfg().devices = devs().filter((x) => x !== gone);
      }
      d = { id, token: newToken(), name: String(b.name || (kind === 'tablet' ? 'Tablet' : 'Phone')).slice(0, 40), kind, role, added: now, seen: now };
      devs().push(d);
    }
    d.seen = now;
    o.save(); o.onChange();
    send(res, 200, { ok: true, token: d.token, role: d.role });
  }
  function drop(d) {
    for (const c of [...clients]) if (c.dev === d || (d.local && c.dev.local)) { try { c.res.end(); } catch {} clients.delete(c); }
  }

  // ------------------------------------------------------------------ the state, pushed
  function pushOne(c) {
    let s;
    try { s = JSON.stringify(o.state(c.dev)); } catch (e) { log(`remote state: ${e.message}`); return; }
    if (s === c.last) return;
    c.last = s;
    c.res.write(`data: ${s}\n\n`);
  }
  let pushT = null;
  function changed() {
    if (!clients.size || pushT) return;
    pushT = setTimeout(() => { pushT = null; for (const c of clients) pushOne(c); }, 120);
  }
  let tickT = null; let ticks = 0;
  function tick() {
    if (tickT) return;
    tickT = setInterval(() => {
      if (!clients.size) { clearInterval(tickT); tickT = null; return; }
      ticks += 1;
      for (const c of clients) { pushOne(c); if (ticks % 15 === 0) c.res.write('event: ping\ndata: 1\n\n'); } // moments end on their own; the ping keeps routers from closing the line, and tells the page the line still works
    }, 1000);
  }
  function events(req, res, u) {
    const d = devBy(u.searchParams.get('t'));
    if (!d) { res.writeHead(401, { 'Content-Type': 'text/plain' }); res.end('not paired'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 20000);
    const c = { dev: d, res, last: '' };
    clients.add(c);
    d.seen = Date.now();
    res.write('retry: 1500\n\n');
    res.write(`event: hello\ndata: ${JSON.stringify({ role: d.role, device: { id: d.id, name: d.name, kind: d.kind }, label: o.label })}\n\n`);
    pushOne(c);
    req.on('close', () => { clients.delete(c); d.seen = Date.now(); o.onChange(); }); // (seen: when it left; players.js keeps its character for a minute)
    o.onChange(); // the panel shows it connected
    tick();
  }
  // a portrait named in the state: its address (the file itself is only served while it is named)
  function faceUrl(file) {
    if (!file) return null;
    const k = crypto.createHash('sha1').update(String(file)).digest('base64url').slice(0, 16);
    if (faces.size > 600) faces.clear();
    faces.set(k, file);
    return `/api/face/${k}`;
  }

  // ------------------------------------------------------------------ the Toolbox panel
  function view() {
    const local = cfg().localToken;
    return {
      on: !!cfg().on, running: !!(server && port && boundTo !== '127.0.0.1'), error: err, port,
      urls: port && boundTo !== '127.0.0.1' ? ips().map((x) => `http://${x.ip}:${port}`) : [],
      keyRev: `${String(cfg().key || '').slice(0, 4)}${String(cfg().playerKey || '').slice(0, 4)}`,
      screenLive: !!local && [...clients].some((c) => c.dev.local),
      devices: devs().map((d) => ({ id: d.id, name: d.name, kind: d.kind, deck: d.deck || null, role: d.role || 'dm', added: d.added, seen: d.seen, connected: [...clients].some((c) => c.dev === d) })),
    };
  }
  function qrSvg(text) {
    const qr = require('qrcode-generator');
    const q = qr(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }
  async function action(a, p = {}) {
    switch (a) {
      case 'set':
        if ('on' in p) { cfg().on = !!p.on; o.save(); ensure(); }
        return { ok: true };
      case 'qr': {
        const v = view();
        const base = (p.url && v.urls.includes(p.url)) ? p.url : v.urls[0];
        if (!v.running || !base) return { ok: false, error: v.running ? 'No home network found on this computer' : 'Switch it on first' };
        const url = `${base}/#k=${p.role === 'player' ? cfg().playerKey : cfg().key}`;
        return { ok: true, url, base, svg: qrSvg(url) };
      }
      case 'newKey':
        if (p.role === 'player') cfg().playerKey = newToken(); else cfg().key = newToken();
        o.save();
        return { ok: true };
      case 'forget': {
        const d = devs().find((x) => x.id === p.id);
        if (d) { cfg().devices = devs().filter((x) => x !== d); drop(d); o.save(); }
        return { ok: true };
      }
      case 'deckOf': { // 4.2: which deck a device shows (phone, tablet; none: by its size)
        const d = devs().find((x) => x.id === p.id);
        if (d) { if (p.deck === 'phone' || p.deck === 'tablet') d.deck = p.deck; else delete d.deck; o.save(); changed(); }
        return { ok: true };
      }
      case 'rename': {
        const d = devs().find((x) => x.id === p.id);
        if (d && String(p.name || '').trim()) { d.name = String(p.name).trim().slice(0, 40); o.save(); }
        return { ok: true };
      }
      default: return { ok: false };
    }
  }
  // the player screen in a window here: this PC's own address (the server starts for this PC only if phones are off)
  async function localUrl() {
    localWanted = true;
    const d = localDev();
    ensure();
    await ready();
    return port ? `http://127.0.0.1:${port}/#t=${d.token}` : null;
  }
  function localDone() { localWanted = false; for (const c of [...clients]) if (c.dev.local) { try { c.res.end(); } catch {} clients.delete(c); } ensure(); }

  const connected = (d) => !!d && [...clients].some((c) => c.dev === d || c.dev.id === d.id);
  return { start: ensure, stop: () => stop(true), view, action, changed, faceUrl, localUrl, localDone, connected, get running() { return !!server; } };
}

module.exports = createRemote;
module.exports.privateAddr = privateAddr;
