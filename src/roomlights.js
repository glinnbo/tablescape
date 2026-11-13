'use strict';
// Room lights (Beta 3 prototype): the lamps around the table follow the game.
//   Govee on the home network  LAN API over UDP; "LAN Control" switched on per lamp in the Govee Home app. Fast.
//   Govee cloud                an API key from the Govee Home app, for lamps without LAN Control. About a second
//                              late and limited to 2 commands a second per lamp: moods only, no flashes.
//   IKEA TRÅDFRI gateway       CoAP over DTLS with the security code from the gateway's label. Zigbee: fades,
//                              no flashes. (DTLS needs AES-CCM, which Electron lacks: aead-ccm.js supplies it.)
// Beta 3.2: two groups, a lamp in either, both or neither (left alone):
//   Ambience  the colours on the TV (sampled from the table window) or, if chosen, the colours of the moods;
//             a break, Lights out and a fight change it either way
//   Effects   flashes for lightning, explosions, spells, a natural 20 …; a lamp only in Effects is dark between
//             them (a fight shows its colour, Madness cycles), one in both groups shows the ambience between
// Beta 3.3: modes (Table: ambience from the TV plus effects / Scene: the GM's own light / Room light / Off: let go
// and put the lamps back as they were), master brightness and effects strength, "No flashing" (soft pulses), lamps
// placed on a plan of the room (each lamp takes the TV colour of its side of the table), names, scenes.
// Nothing is touched until the GM opens the panel once (no network traffic, no firewall question before that).
const dgram = require('dgram');
const os = require('os');
const FXDATA = require('./renderer/fx-data');
const Module = require('module');

const GROUP = '239.255.255.250';
// the room plan (Setup → Room): positions 0..1 of a 16:10 room with the table (and the TV in it) in the middle
const PLAN = { w: 16, h: 10, table: { x0: 0.3, y0: 0.28, x1: 0.7, y1: 0.72 } };
const GX = 8; const GY = 5; // the TV picture in cells, for the colour on each side of the table
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WARM = [255, 172, 98]; // normal room light, about 2700 K
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixRgb = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const hex2rgb = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '')); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (c) => c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
// a map tint is very dark (#0a1634): its hue at full strength
const normTint = (hex) => { const c = hex2rgb(hex); const m = Math.max(...c, 1); return c.map((v) => Math.round((v * 255) / m)); };
const hsv = (h, s = 1, v = 1) => { const f = (n) => { const k = (n + h * 6) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };

// flashes: [ms after the start, colour, brightness]; [ms, null, ms] goes back to the mood in that many ms
const C = (hex, bri = 100) => [hex2rgb(hex), bri];
const FX = {
  lightning: [[0, ...C('#e8f0ff')], [110, null, 0], [210, ...C('#ffffff', 85)], [370, null, 150]],
  explosion: [[0, ...C('#ffffff')], [130, ...C('#ff8a20')], [650, ...C('#ff5a10', 70)], [1500, null, 1500]],
  nat20: [[0, ...C('#ffd040')], [700, ...C('#ffae20', 85)], [1500, ...C('#ffd040')], [2600, null, 1500]],
  nat1: [[0, ...C('#70000c', 30)], [1600, null, 1200]],
  holy: [[0, ...C('#fff1b0')], [1800, ...C('#ffd56a', 80)], [4300, null, 2000]],
  teleport: [[0, ...C('#b080ff')], [320, ...C('#ffffff')], [520, null, 300]],
  roar: [[0, ...C('#ff3010')], [420, ...C('#801000', 40)], [820, ...C('#ff3010')], [1300, ...C('#801000', 40)], [2000, null, 800]],
  earthquake: [[0, ...C('#d08850', 70)], [180, ...C('#603818', 30)], [360, ...C('#d08850', 70)], [560, ...C('#603818', 30)], [760, ...C('#d08850', 70)], [1000, ...C('#603818', 30)], [1300, null, 600]],
  rockfall: [[0, ...C('#c08050', 70)], [250, ...C('#503018', 25)], [2400, ...C('#c08050', 70)], [2700, null, 600]],
  flood: [[0, ...C('#1e78ff')], [2600, ...C('#1e9fff', 70)], [6200, null, 2000]],
  blood: [[0, ...C('#a00010', 90)], [2600, null, 1500]],
  puff: [[0, ...C('#9a9a9a', 40)], [1500, null, 800]],
  blink: [[0, ...C('#ffffff')], [300, null, 0], [600, ...C('#ffffff')], [900, null, 0]],
};
// what Test and tune → Effects lists (a spell flashes in its own colour)
const FX_LIST = [['lightning', 'Lightning'], ['explosion', 'Explosion'], ['spell', 'Spells'], ['nat20', 'Natural 20'], ['nat1', 'Natural 1'], ['holy', 'Holy light'], ['teleport', 'Teleport'],
  ['roar', 'Dragon roar'], ['earthquake', 'Earthquake'], ['rockfall', 'Rockfall'], ['flood', 'Flood'], ['blood', 'Blood splatter'], ['puff', 'Smoke puff']];
// the room per situation: worked out by itself, or the GM's own colour and brightness (Test and tune → Moods)
const SITUATIONS = [['day', 'Day'], ['dawn', 'Dawn'], ['dusk', 'Dusk'], ['night', 'Night'], ['cave', 'Cave'], ['fight', 'Fight'], ['break', 'Break'], ['lightsout', 'Lights out']];
function lightDefault(darkness, tint) {
  const d = clamp(Number(darkness) || 0, 0, 1);
  return { rgb: d < 0.15 ? WARM : mixRgb(WARM, normTint(tint), clamp((d - 0.1) * 1.8, 0, 1)), white: d < 0.15, bri: Math.round(6 + 74 * (1 - d) ** 1.3) };
}
function situationDefault(id) {
  const m = FXDATA.MOODS.find((x) => x.id === id);
  if (m) return lightDefault(m.darkness, m.tint);
  if (id === 'fight') return { rgb: [255, 40, 20], bri: 45 };
  if (id === 'break') return { rgb: WARM, white: true, bri: 85 };
  return { rgb: [255, 110, 40], bri: 1 }; // lights out
}
const spellFx = (hex) => [[0, ...C(hex)], [450, ...C(hex, 70)], [1200, null, 900]];
// the room during a lasting moment
const LASTING = { dread: [150, 0, 12], frost: [120, 200, 255], gas: [90, 220, 60], timestop: [150, 160, 190] };

module.exports = function createRoomLights(o) {
  const cfg = () => o.cfg();
  const log = o.log || (() => {});
  const ports = { scanHost: GROUP, scan: 4001, listen: 4002, device: 4003, ...(o.ports || {}) };
  const CLOUD = o.cloudUrl || 'https://openapi.api.govee.com/router/api/v1';
  const lamps = new Map(); // id -> lamp
  const st = { started: false, halted: false, cloudAuthBad: false, lan: { state: 'off', msg: '' }, cloud: { state: 'off', msg: '' }, ikea: { state: 'off', msg: '' } };
  let sock = null; let timer = null; let scanTimer = null; let tradfri = null; let changeT = null; let saveT = null;
  // (4.2.2) how a lamp was before Tablescape, kept while it is gone from the list (a new key, the gateway again)
  const origMem = new Map();
  const forget = (id) => { const L = lamps.get(id); if (L && L.touched && L.orig) origMem.set(id, L.orig); lamps.delete(id); };
  const setOrig = (L, x) => { if (!L.orig) L.orig = x; };
  // (4.2.2) sliders send many changes: the settings file is written once they stop
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; o.save(); }, 400); };
  const saveNow = () => { if (saveT) { clearTimeout(saveT); saveT = null; o.save(); } };

  const changed = () => { clearTimeout(changeT); changeT = setTimeout(() => o.onChange && o.onChange(), 60); };
  const nameOf = (L) => (cfg().names || {})[L.id] || L.name;
  // Table (follow the game) / scene / room / off (4.4: the lamps switched off) / release (let go: back as they were);
  // Beta 3's on + manual mean the same
  const MODES = ['follow', 'scene', 'room', 'off', 'release'];
  function modeOf() {
    const c = cfg();
    if (c.mode === 'off' && !c.off2) { c.mode = 'release'; c.off2 = true; } // (before 4.4, Off let go of the lamps)
    if (MODES.includes(c.mode)) return c.mode === 'scene' && !sceneOf(c.sceneId) ? 'follow' : c.mode;
    if (c.on === false) return c.manual && c.manual.name === 'off' ? 'release' : 'room';
    return 'follow';
  }
  const sceneOf = (id) => (cfg().scenes || []).find((x) => x.id === id) || null;
  // which groups a lamp is in: set by the GM (drag and drop), from Beta 3's jobs, or a first guess
  function member(L) {
    const m = (cfg().member || {})[L.id];
    if (m) return { fx: !!m.fx, amb: !!m.amb };
    const r = (cfg().roles || {})[L.id];
    if (r) return { fx: r === 'effects', amb: r !== 'off' };
    return { fx: L.guess === 'effects', amb: true };
  }
  function guessRole(sku, name) {
    const s = `${sku || ''} ${name || ''}`.toLowerCase();
    if (/projector|star|galaxy|h6093|h6091|h6092|h6094/.test(s)) return 'scene';
    if (/strip|h61[0-9a-f]{2}|h6[0-9]{2}c/.test(s)) return 'effects';
    return 'mood';
  }
  function upsert(id, fields) {
    let L = lamps.get(id);
    if (!L) {
      L = { id, kind: fields.kind, name: '', sku: '', online: true, shown: null, base: null, wantSig: '', trans: null, fxUntil: 0, sentAt: 0, guess: 'mood', fxTimers: [], askedAt: Date.now(), orig: origMem.get(id) || null };
      origMem.delete(id);
      if (L.orig) L.touched = true; // still to be put back
      lamps.set(id, L);
    }
    Object.assign(L, fields);
    L.guess = guessRole(L.sku, L.name);
    changed();
    return L;
  }

  // ------------------------------------------------------------------ Govee LAN
  function lanStart() {
    if (sock) return;
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (err) => {
      st.lan = { state: 'error', msg: err.code === 'EADDRINUSE' ? `Port ${ports.listen} is in use by another program (another Govee tool?)` : `Network: ${err.message}` };
      log(`roomlights lan: ${err.message}`);
      try { sock.close(); } catch {}
      sock = null; changed();
    });
    sock.on('message', (buf, rinfo) => {
      let m; try { m = JSON.parse(buf.toString()).msg; } catch { return; }
      if (!m || !m.data) return;
      if (m.cmd === 'scan' && m.data.device) {
        const dev = String(m.data.device).toUpperCase();
        const was = lamps.get(`gv:${dev}`);
        const L = upsert(`gv:${dev}`, { kind: 'lan', ip: m.data.ip || rinfo.address, device: dev, sku: m.data.sku || (was && was.sku) || '', name: (was && was.name) || m.data.sku || 'Govee lamp', online: true, seen: Date.now() });
        st.lan = { state: 'ok', msg: '' };
        if (!L.orig) setTimeout(() => lanSend(L, 'devStatus', {}), 100); // how it is now, to put it back later
      }
      if (m.cmd === 'devStatus') {
        const L = [...lamps.values()].find((x) => x.kind === 'lan' && x.ip === rinfo.address);
        const d = m.data;
        if (L) setOrig(L, { on: d.onOff === 1, bri: d.brightness ?? 80, rgb: d.color ? [d.color.r, d.color.g, d.color.b] : WARM, k: d.colorTemInKelvin || 0 });
      }
    });
    sock.bind(ports.listen, () => {
      if (ports.scanHost === GROUP) { // every network card (a laptop with Wi-Fi, a cable, a VPN): the lamps may be on any of them
        let joined = 0;
        for (const ip of localIps()) { try { sock.addMembership(GROUP, ip); joined++; } catch {} }
        if (!joined) { try { sock.addMembership(GROUP); } catch (err) { log(`roomlights lan membership: ${err.message}`); } }
      }
      st.lan = { state: 'searching', msg: '' };
      lanScan();
    });
  }
  function localIps() { return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address); }
  function lanScan() {
    if (!sock) return;
    const msg = JSON.stringify({ msg: { cmd: 'scan', data: { account_topic: 'reserve' } } });
    const ips = ports.scanHost === GROUP ? localIps() : [];
    if (!ips.length) { try { sock.send(msg, ports.scan, ports.scanHost); } catch (err) { log(`roomlights scan: ${err.message}`); } }
    const next = (i) => { // one card after the other (the card is a socket setting, the send happens later)
      if (i >= ips.length || !sock) return;
      try { sock.setMulticastInterface(ips[i]); sock.send(msg, ports.scan, ports.scanHost, () => next(i + 1)); } catch (err) { log(`roomlights scan ${ips[i]}: ${err.message}`); next(i + 1); }
    };
    next(0);
    setTimeout(() => {
      const n = [...lamps.values()].filter((L) => L.kind === 'lan').length;
      if (!n && st.lan.state !== 'error') st.lan = { state: 'none', msg: 'No Govee lamp answered. Turn on LAN Control for each lamp in the Govee Home app (it can take a few minutes to appear) and allow Tablescape through the Windows firewall.' };
      changed();
    }, 2500);
  }
  const lanSend = (L, cmd, data) => { if (sock) sock.send(JSON.stringify({ msg: { cmd, data } }), ports.device, L.ip); };

  // ------------------------------------------------------------------ Govee cloud
  const cloudQ = new Map(); // id -> next time a command may go
  async function cloudReq(method, url, body) {
    const key = cfg().goveeKey;
    if (!key) throw new Error('no key');
    const r = await fetch(`${CLOUD}${url}`, { method, headers: { 'Content-Type': 'application/json', 'Govee-API-Key': key }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('The Govee key was not accepted'), { auth: true });
    if (r.status === 429) throw Object.assign(new Error('Govee: too many commands, slowing down'), { slow: true });
    const j = await r.json().catch(() => ({}));
    if (j.code && j.code !== 200) throw new Error(`Govee: ${j.message || j.msg || j.code}`);
    return j;
  }
  async function cloudList() {
    if (!cfg().goveeKey) { st.cloud = { state: 'off', msg: '' }; changed(); return; }
    st.cloud = { state: 'searching', msg: '' }; changed();
    try {
      const j = await cloudReq('GET', '/user/devices');
      let n = 0;
      for (const d of j.data || []) {
        if (d.type && !/light/i.test(d.type)) continue;
        const dev = String(d.device).toUpperCase();
        const lan = lamps.get(`gv:${dev}`);
        if (lan && lan.kind === 'lan') { lan.name = d.deviceName || lan.name; lan.sku = d.sku || lan.sku; n++; continue; } // the network is faster
        const L = upsert(`gv:${dev}`, { kind: 'cloud', device: d.device, sku: d.sku, name: d.deviceName || d.sku, online: true });
        if (!L.orig) cloudState(L);
        n++;
      }
      st.cloud = { state: 'ok', msg: n ? '' : 'The key works, but Govee lists no lamps for it.' };
      st.cloudAuthBad = false;
    } catch (err) {
      st.cloud = { state: 'error', msg: err.message };
      if (err.auth) st.cloudAuthBad = true;
      log(`roomlights cloud: ${err.message}`);
    }
    changed();
  }
  async function cloudState(L) { // how a cloud lamp is now, to put it back later
    try {
      const j = await cloudReq('POST', '/device/state', { requestId: `ts${Date.now().toString(36)}`, payload: { sku: L.sku, device: L.device } });
      const caps = (j.payload && j.payload.capabilities) || [];
      const val = (inst) => { const x = caps.find((y) => y.instance === inst); return x && x.state ? x.state.value : undefined; };
      const ci = val('colorRgb'); const k = val('colorTemperatureK');
      setOrig(L, { on: val('powerSwitch') === 1, bri: val('brightness') ?? 80, rgb: Number.isFinite(ci) ? [(ci >> 16) & 255, (ci >> 8) & 255, ci & 255] : WARM, k: k || 0 });
    } catch (err) { log(`roomlights cloud state ${L.sku}: ${err.message}`); }
  }
  function cloudCap(L, type, instance, value) {
    return cloudReq('POST', '/device/control', { requestId: `ts${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, payload: { sku: L.sku, device: L.device, capability: { type, instance, value } } });
  }

  // ------------------------------------------------------------------ IKEA TRÅDFRI
  let aead = false;
  function tradfriLib() {
    if (!aead) { // the DTLS library asks for "node-aead-crypto" in Electron: hand it the pure-JS CCM
      const orig = Module._load;
      Module._load = function load(req, ...rest) { return req === 'node-aead-crypto' ? require('./aead-ccm') : orig.call(this, req, ...rest); };
      aead = true;
    }
    return require('node-tradfri-client');
  }
  // the library's errors in words a GM can act on
  function ikeaWords(err) {
    const m = String((err && err.message) || err);
    if (/retransmit|timeout|timed out|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(m)) return 'The gateway did not answer at that address. Is it plugged in, and is the address right (Find, or your router\'s list)?';
    if (/auth|code|401|key|psk|handshake/i.test(m)) return 'The gateway did not accept the security code (the one on its label).';
    return `Gateway: ${m}`;
  }
  async function ikeaFind() {
    try {
      const r = await tradfriLib().discoverGateway(4000);
      return r ? { ok: true, host: (r.addresses && r.addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))) || r.host } : { ok: false, error: 'No gateway answered. Type its address (in the IKEA app or your router\'s list).' };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  async function ikeaPair(host, code) {
    const { TradfriClient } = tradfriLib();
    st.ikea = { state: 'searching', msg: 'Pairing …' }; changed();
    const c = new TradfriClient(String(host).trim());
    try {
      const { identity, psk } = await c.authenticate(String(code).trim());
      cfg().tradfri = { host: String(host).trim(), identity, psk };
      o.save();
    } catch (err) {
      st.ikea = { state: 'error', msg: ikeaWords(err) };
      changed();
      return { ok: false, error: st.ikea.msg };
    } finally { try { c.destroy(); } catch {} }
    return ikeaConnect();
  }
  const ikeaNow = (light) => ({ on: !!light.onOff, bri: light.dimmer ?? 80, hex: light.spectrum === 'rgb' ? light.color : null, ct: light.spectrum === 'white' ? light.colorTemperature : null });
  async function ikeaConnect() {
    const t = cfg().tradfri;
    if (!t) return { ok: false };
    const { TradfriClient, AccessoryTypes } = tradfriLib();
    if (tradfri) { try { tradfri.destroy(); } catch {} }
    tradfri = new TradfriClient(t.host, { watchConnection: true });
    st.ikea = { state: 'searching', msg: 'Connecting …' }; changed();
    try {
      await tradfri.connect(t.identity, t.psk);
      tradfri.on('device updated', (d) => {
        if (d.type !== AccessoryTypes.lightbulb || !d.lightList || !d.lightList[0]) return;
        const light = d.lightList[0];
        const was = lamps.get(`ik:${d.instanceId}`);
        if (!was || !was.orig) setTimeout(() => { const L = lamps.get(`ik:${d.instanceId}`); if (L) setOrig(L, ikeaNow(light)); }, 0);
        upsert(`ik:${d.instanceId}`, { kind: 'ikea', acc: d, name: d.name || 'IKEA bulb', sku: light.spectrum === 'rgb' ? 'colour' : light.spectrum === 'white' ? 'white spectrum' : 'white', spectrum: light.spectrum, online: d.alive !== false });
      });
      tradfri.on('device removed', (id) => { forget(`ik:${id}`); changed(); });
      tradfri.on('error', (err) => log(`roomlights ikea: ${(err && err.message) || err}`)); // (without a listener an error would end up as an uncaught one)
      tradfri.on('connection lost', () => { st.ikea = { state: 'error', msg: 'Lost the gateway; trying again …' }; changed(); });
      tradfri.on('connection alive', () => { st.ikea = { state: 'ok', msg: '' }; changed(); });
      await tradfri.observeDevices();
      st.ikea = { state: 'ok', msg: '' };
      changed();
      return { ok: true };
    } catch (err) {
      st.ikea = { state: 'error', msg: ikeaWords(err) };
      log(`roomlights ikea: ${err.message}`);
      changed();
      return { ok: false, error: st.ikea.msg };
    }
  }

  // ------------------------------------------------------------------ what each lamp should show
  let preview = null; // Test and tune → Moods → Try: a situation shown for a few seconds instead of the game
  let table = null; // the TV right now (main samples the table window): { cells: GX × GY sums, at, seq }
  // from a small picture of the TV (BGRA): sums per cell, so each lamp can take the colour of its own side
  function tableFrom(buf, w, h) {
    const cells = Array.from({ length: GX * GY }, () => [0, 0, 0, 0, 0, 0, 0, 0]); // r g b n, and leaning to colour: wr wg wb ws
    for (let y = 0; y < h; y++) {
      const cy = Math.min(GY - 1, Math.floor((y * GY) / h));
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const B = buf[i]; const G = buf[i + 1]; const R = buf[i + 2];
        const c = cells[cy * GX + Math.min(GX - 1, Math.floor((x * GX) / w))];
        c[0] += R; c[1] += G; c[2] += B; c[3]++;
        const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0;
        const wt = sat * sat * (mx / 255) + 0.0001;
        c[4] += R * wt; c[5] += G * wt; c[6] += B * wt; c[7] += wt;
      }
    }
    table = { cells, at: Date.now(), seq: (table ? table.seq : 0) + 1 };
  }
  // the colour of (part of) the picture: the average, leaning towards its colourful parts (a green slime pool, a
  // fire), at full strength for the lamp; greys turn into warm white; the brightness follows how bright it is
  function colourOf(cells, w) {
    let r = 0; let g = 0; let b = 0; let n = 0; let wr = 0; let wg = 0; let wb = 0; let ws = 0;
    cells.forEach((c, i) => { const k = w ? w[i] : 1; r += c[0] * k; g += c[1] * k; b += c[2] * k; n += c[3] * k; wr += c[4] * k; wg += c[5] * k; wb += c[6] * k; ws += c[7] * k; });
    if (!n || !ws) return { rgb: WARM, bri: 20 };
    const avg = [r / n, g / n, b / n];
    const col = mixRgb(avg, [wr / ws, wg / ws, wb / ws], 0.6);
    const mx = Math.max(...col, 1);
    const sat = (mx - Math.min(...col)) / mx;
    const lum = 0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2];
    return { rgb: mixRgb(WARM, col.map((v) => (v * 255) / mx), clamp(sat * 2.2, 0, 1)), bri: clamp(4 + lum * 0.75, 2, 100) }; // a bright day map ~70 %, night ~30 %, a cave ~12 %
  }
  // a lamp placed beside the table takes the colour of the TV edge on its side (the picture's top points where
  // the plan says); one not placed, or placed on the table, the whole picture
  function weightsFor(L) {
    if (cfg().tvArea === 'whole') return null; // (3.4) every lamp: the whole picture
    const p = (cfg().pos || {})[L.id];
    const T = PLAN.table;
    if (!p || (p.x > T.x0 && p.x < T.x1 && p.y > T.y0 && p.y < T.y1)) return null;
    const rot = ((((cfg().plan || {}).rot || 0) % 360) * Math.PI) / 180;
    const vx = (p.x - 0.5) * PLAN.w; const vy = (p.y - 0.5) * PLAN.h;
    const ux = vx * Math.cos(-rot) - vy * Math.sin(-rot); const uy = vx * Math.sin(-rot) + vy * Math.cos(-rot);
    const dx = ux / 16; const dy = uy / 9;
    const t = 0.5 / Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
    const bx = 0.5 + dx * t; const by = 0.5 + dy * t; // where the direction leaves the picture
    const w = [];
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const d = Math.hypot((((i + 0.5) / GX) - bx) * (16 / 9), ((j + 0.5) / GY) - by); w.push(Math.exp(-((d / 0.28) ** 2))); }
    return w;
  }
  function tvFor(L) {
    if (!table || Date.now() - table.at > 5000) return null;
    if (L.tvSeq !== table.seq) {
      const col = colourOf(table.cells, weightsFor(L));
      L.tvc = L.tvc && L.tvSeq != null && table.seq - L.tvSeq < 4 ? { rgb: mixRgb(L.tvc.rgb, col.rgb, 0.4), bri: L.tvc.bri + (col.bri - L.tvc.bri) * 0.4 } : col;
      L.tvSeq = table.seq;
    }
    return L.tvc;
  }
  const wantsTable = () => st.started && (modeOf() === 'follow' || preview) && cfg().ambience !== 'mood' && [...lamps.values()].some((L) => L.online && member(L).amb);
  const look = (id) => { const x = cfg().looks && cfg().looks[id]; return x ? { rgb: x.rgb, bri: x.bri, white: false } : situationDefault(id); };
  const optsOf = (id) => ({ max: 100, min: 1, flashes: true, ...((cfg().lampOpts || {})[id] || {}) });
  function fadeMs(g) { const f = g.light && g.light.from; if (f && f.t0 && f.s) return Math.max(300, f.s * 1000 - (Date.now() - f.t0)); return 1500; }
  function baseFor(L, g, pv = null) {
    const c = cfg();
    const mem = member(L);
    if (!mem.fx && !mem.amb) return null;
    const k = clamp(c.strength ?? 0.85, 0, 1);
    if (!mem.amb) { // only Effects: dark between the flashes; a fight shows its colour, Madness cycles
      if (g.lasting.includes('madness') && !g.brk) return { on: true, rgb: hsv((Date.now() / 9000) % 1, 0.8), bri: 60 };
      if (g.fight && !g.brk) { const f = look('fight'); return { on: true, rgb: f.rgb, bri: f.bri }; }
      return { on: false };
    }
    if (g.brk) { const b = look('break'); return { on: true, rgb: b.rgb, white: !!b.white, bri: b.bri }; }
    if (g.lasting.includes('lightsout')) { const b = look('lightsout'); return { on: true, rgb: b.rgb, bri: b.bri }; }
    const Lt = g.light || { darkness: 0, tint: '#000000', mood: null };
    const d = clamp(Number(Lt.darkness) || 0, 0, 1);
    const tv = !pv && c.ambience !== 'mood' ? tvFor(L) : null;
    const fromTable = !!tv;
    const m = fromTable ? tv : Lt.mood && SITUATIONS.some(([id]) => id === Lt.mood) ? look(Lt.mood) : lightDefault(d, Lt.tint);
    let rgb = m.rgb; let white = !!m.white; let bri = m.bri;
    if (!fromTable) for (const id of g.lasting) if (LASTING[id]) { rgb = mixRgb(rgb, LASTING[id], 0.65); white = false; } // (the TV shows them by itself)
    if (g.lasting.includes('madness') && mem.fx) { rgb = hsv((Date.now() / 9000) % 1, 0.8); white = false; }
    if (g.fight) { const f = look('fight'); rgb = mixRgb(rgb, f.rgb, mem.fx ? 0.85 : 0.3); white = false; if (mem.fx) bri = Math.max(bri, f.bri); }
    if (g.blackout) bri = Math.min(bri, 15);
    // Strength: how far the room moves away from normal light
    rgb = mixRgb(WARM, rgb, k); bri = 80 + (bri - 80) * k;
    return { on: true, rgb, white, bri: Math.round(clamp(bri, 1, 100)) };
  }
  const lerp = (a, b, u) => {
    if (!a || !a.on) return b;
    if (!b.on) return u >= 1 ? b : { on: true, rgb: a.rgb || WARM, bri: Math.max(1, Math.round(a.bri * (1 - u))) }; // fades out, then off
    return { on: true, rgb: mixRgb(a.rgb || WARM, b.rgb || WARM, u), white: u >= 1 ? b.white : false, bri: Math.round(a.bri + (b.bri - a.bri) * u) };
  };

  // ------------------------------------------------------------------ sending
  const MIN_GAP = { lan: 120, cloud: 600, ikea: 350 };
  function differs(a, b) {
    if (!a) return true;
    if (a.on !== b.on) return true;
    if (!b.on) return false;
    if (Math.abs((a.bri || 0) - (b.bri || 0)) >= 2) return true;
    if (!!a.white !== !!b.white) return true;
    return (a.rgb || WARM).some((v, i) => Math.abs(v - (b.rgb || WARM)[i]) > 6);
  }
  function drive(L, want, { force = false, ms = 0, calm = false } = {}) {
    if (!L.online || !want || st.halted) return;
    const now = Date.now();
    // (4.2.2) not before we know how it was (to put it back later): at most 2.5 s after it was found; while it is read
    // again after being put back, sending at once keeps the earlier answer (the new one would be our own colour)
    if (!L.orig) { if (L.prevOrig) L.orig = L.prevOrig; else if (now - (L.askedAt || 0) < 2500) return; }
    if (L.kind === 'cloud' && st.cloudAuthBad) return; // the key was not accepted: no point sending
    const base = want;
    if (want.on) { // the master brightness, then this lamp's own limits
      const op = optsOf(L.id);
      want = { ...want, bri: clamp(Math.round((want.bri * clamp(cfg().brightness ?? 1, 0.05, 1) * op.max) / 100), Math.min(op.min, op.max), op.max) };
    }
    if (!force && now - L.sentAt < MIN_GAP[L.kind]) return;
    if (!force && !differs(L.shown, want)) return;
    // (4.2.2) a cloud lamp following the TV changes at most every 8 s (Govee counts the commands a day); big changes go at once
    if (calm && L.kind === 'cloud' && L.shown && L.shown.on && want.on && now - L.sentAt < 8000
      && Math.abs((L.shown.bri || 0) - want.bri) < 15 && !(want.rgb || WARM).some((v, i) => Math.abs(v - (L.shown.rgb || WARM)[i]) > 60)) return;
    L.touched = true;
    L.base = base; // (unscaled: a fade starts from here, so the master brightness is not taken twice)
    const was = L.shown;
    try {
      if (L.kind === 'lan') {
        if (!was || was.on !== want.on) lanSend(L, 'turn', { value: want.on ? 1 : 0 });
        if (want.on) {
          const rgb = want.rgb || WARM;
          if (!was || !was.on || differs({ ...was, bri: want.bri }, want)) lanSend(L, 'colorwc', { color: { r: rgb[0], g: rgb[1], b: rgb[2] }, colorTemInKelvin: want.white ? 2700 : 0 });
          if (!was || !was.on || Math.abs((was.bri || 0) - want.bri) >= 2) lanSend(L, 'brightness', { value: clamp(Math.round(want.bri), 1, 100) });
        }
        L.shown = { ...want };
      } else if (L.kind === 'cloud') {
        // one command per turn (Govee allows 2 a second per lamp); the rest follows on the next ticks
        const rgb = want.rgb || WARM;
        let p = null; let next = { ...(was || {}) };
        if (!was || was.on !== want.on) { p = cloudCap(L, 'devices.capabilities.on_off', 'powerSwitch', want.on ? 1 : 0); next.on = want.on; if (!want.on) next = { on: false }; }
        else if (want.on && (!was.rgb || !!was.white !== !!want.white || rgb.some((v, i) => Math.abs(v - was.rgb[i]) > 6))) {
          p = want.white ? cloudCap(L, 'devices.capabilities.color_setting', 'colorTemperatureK', 2700) : cloudCap(L, 'devices.capabilities.color_setting', 'colorRgb', (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]);
          next.rgb = rgb; next.white = !!want.white;
        } else if (want.on && Math.abs((was.bri || 0) - want.bri) >= 2) { p = cloudCap(L, 'devices.capabilities.range', 'brightness', clamp(Math.round(want.bri), 1, 100)); next.bri = want.bri; }
        if (p) {
          L.shown = next;
          p.then(() => { L.errN = 0; }, (err) => {
            L.shown = was;
            L.errN = (L.errN || 0) + 1;
            if (L.errN <= 3 || L.errN % 20 === 0) log(`roomlights cloud ${L.sku}: ${err.message}`);
            if (err.auth) { st.cloud = { state: 'error', msg: err.message }; st.cloudAuthBad = true; changed(); }
            L.sentAt = Date.now() + (err.slow ? 10000 : Math.min(60000, 1000 * 2 ** Math.min(L.errN, 6))); // (4.2.2) waits longer after each failure; "too many" (Govee: about 10 a minute per lamp, 10,000 a day): 10 s
          });
        }
      } else if (L.kind === 'ikea' && tradfri && L.acc) {
        const opt = { onOff: want.on, transitionTime: Math.round((force ? 0 : ms) / 100) / 10 };
        if (want.on) {
          opt.dimmer = clamp(Math.round(want.bri), 1, 100);
          const rgb = want.rgb || WARM;
          if (L.spectrum === 'rgb') opt.color = want.white ? 'efd275' : rgb2hex(rgb);
          else if (L.spectrum === 'white') opt.colorTemperature = want.white ? 100 : clamp(Math.round(((rgb[0] - rgb[2]) / 255) * 50 + 50), 0, 100); // 100 = warm
        }
        tradfri.operateLight(L.acc, opt).catch((err) => log(`roomlights ikea ${L.name}: ${err.message}`));
        L.shown = { ...want };
      }
    } catch (err) { log(`roomlights send ${L.id}: ${err.message}`); }
    L.sentAt = now;
  }

  function tick() {
    const c = cfg();
    const now = Date.now();
    const pv = preview && now < preview.until ? preview : null;
    if (preview && !pv) { preview = null; for (const x of lamps.values()) x.wantSig = ''; changed(); }
    const g = pv ? pv.game(o.game()) : o.game();
    for (const L of lamps.values()) {
      if (!L.online || now < L.fxUntil) continue;
      if (L.hold) { drive(L, L.hold); continue; } // set by hand (a scene being made, Test and tune)
      const want = wantFor(L, g, pv);
      if (L.soft) { // "No flashing": an effect as a soft swell of its colour and back
        const t = now - L.soft.t0;
        const e = t < 800 ? t / 800 : t < 1200 ? 1 : t < 2600 ? 1 - (t - 1200) / 1400 : -1;
        if (e < 0) { L.soft = null; L.wantSig = ''; } else {
          const b = want && want.on ? want : { on: true, rgb: L.soft.rgb, bri: 1 };
          drive(L, { on: true, rgb: mixRgb(b.rgb || WARM, L.soft.rgb, e), bri: Math.round(b.bri + (L.soft.bri - b.bri) * e) });
          continue;
        }
      }
      if (!want) { // (4.2.2) left alone: back as it was (after a test flash, a lamp set by hand, a lamp taken out of both groups)
        if (L.touched && L.orig && !L.fxTimers.length) restoreLamp(L);
        continue;
      }
      const follow = modeOf() === 'follow' && !pv;
      const sig = JSON.stringify(want);
      if (sig !== L.wantSig) { L.wantSig = sig; L.trans = { from: L.shown ? L.base : null, to: want, t0: now, ms: L.back != null ? L.back : follow ? fadeMs(g) : 700 }; L.back = null; }
      const tr = L.trans;
      const left = Math.max(0, tr.ms - (now - tr.t0));
      const u = tr.ms > 0 ? clamp((now - tr.t0) / tr.ms, 0, 1) : 1;
      if (L.kind === 'ikea') drive(L, want, { ms: left }); // the bulbs fade by themselves
      else if (L.kind === 'cloud') drive(L, want, { calm: follow }); // (too slow for the steps of a fade)
      else drive(L, u >= 1 ? want : lerp(tr.from, tr.to, u), { force: tr.ms === 0 && now - tr.t0 < 50 });
    }
  }

  // what a lamp shows in the current mode (null: left alone)
  function wantFor(L, g, pv) {
    const c = cfg();
    if (pv) return baseFor(L, g, pv);
    const mode = modeOf();
    const mem = member(L);
    if (mode === 'release' || (!mem.fx && !mem.amb)) return null;
    if (mode === 'off') return { on: false, rgb: WARM, bri: 0 }; // 4.4: switched off, still ours
    if (mode === 'room') return { on: true, rgb: WARM, white: true, bri: 85 };
    if (mode === 'scene') { const x = sceneOf(c.sceneId).lamps[L.id]; return x ? { on: x.on !== false, rgb: x.rgb || WARM, bri: x.bri ?? 80 } : null; }
    return baseFor(L, g, null);
  }
  // (4.2.2) a flash still on its way is called off (Off, quitting)
  function cancelFx(L) { for (const t of L.fxTimers) clearTimeout(t); L.fxTimers = []; L.fxUntil = 0; L.soft = null; }
  // a flash on the lamps that do effects (or one lamp, to try it)
  function play(keys, only = null, anyway = false) {
    const c = cfg();
    const mode = modeOf();
    if (!st.started || (!only && !anyway && mode !== 'follow' && mode !== 'scene')) return;
    const fxs = clamp(c.fxStrength ?? 1, 0, 1);
    if (!only && !anyway && fxs < 0.02) return;
    const k = 0.25 + 0.75 * fxs;
    const fast = keys.some((x, i) => i && x[0] - keys[i - 1][0] < 400);
    const end = keys[keys.length - 1][0];
    if (c.noFlash && !only) { // a soft swell of the effect's brightest colour instead of flashes
      const top = keys.filter((x) => x[1]).sort((a, b) => b[2] - a[2])[0];
      if (!top) return;
      for (const L of lamps.values()) if (L.online && member(L).fx) L.soft = { rgb: top[1], bri: Math.round(Math.min(60, top[2] * k)), t0: Date.now() };
      return;
    }
    for (const L of lamps.values()) {
      if (!L.online) continue;
      if (only ? L.id !== only : !member(L).fx) continue;
      if (L.kind === 'cloud' && fast) continue; // too slow for flashes
      if (L.kind === 'ikea' && fast && !only) continue;
      cancelFx(L);
      L.fxUntil = Date.now() + end + 60;
      for (const [at, rgb, bri] of keys) {
        const t = setTimeout(() => {
          L.fxTimers = L.fxTimers.filter((x) => x !== t);
          if (!rgb) { L.fxUntil = 0; L.wantSig = ''; L.back = bri || 0; tick(); return; } // (bri: how fast back to the mood)
          drive(L, { on: true, rgb, bri: Math.round(only ? bri : bri * k) }, { force: L.kind !== 'cloud' });
        }, at);
        L.fxTimers.push(t);
      }
    }
  }

  // ------------------------------------------------------------------ putting the lamps back as they were
  async function restoreLamp(L) {
    const x = L.orig;
    if (!x || !L.touched || !L.online) return;
    L.touched = false;
    const step = async (what, f) => { try { await f(); } catch (err) { log(`roomlights restore ${L.id} ${what}: ${err.message}`); } };
    if (L.kind === 'lan') {
      await step('lan', () => {
        lanSend(L, 'turn', { value: x.on ? 1 : 0 });
        if (x.on) { lanSend(L, 'colorwc', { color: { r: x.rgb[0], g: x.rgb[1], b: x.rgb[2] }, colorTemInKelvin: x.k || 0 }); lanSend(L, 'brightness', { value: clamp(Math.round(x.bri), 1, 100) }); }
      });
    } else if (L.kind === 'cloud') { // (each on its own: one that fails does not keep the others back)
      if (x.on) {
        await step('colour', () => (x.k ? cloudCap(L, 'devices.capabilities.color_setting', 'colorTemperatureK', x.k) : cloudCap(L, 'devices.capabilities.color_setting', 'colorRgb', (x.rgb[0] << 16) + (x.rgb[1] << 8) + x.rgb[2])));
        await wait(550);
        await step('brightness', () => cloudCap(L, 'devices.capabilities.range', 'brightness', clamp(Math.round(x.bri), 1, 100)));
        await wait(550);
      }
      await step('power', () => cloudCap(L, 'devices.capabilities.on_off', 'powerSwitch', x.on ? 1 : 0));
    } else if (L.kind === 'ikea' && tradfri && L.acc) {
      const opt = { onOff: x.on, transitionTime: 0.5 };
      if (x.on) { opt.dimmer = clamp(Math.round(x.bri), 1, 100); if (x.hex) opt.color = x.hex; else if (x.ct != null) opt.colorTemperature = x.ct; }
      await step('ikea', () => Promise.race([tradfri.operateLight(L.acc, opt), wait(2000)]));
    }
    L.shown = null; L.base = null; L.wantSig = '';
    // (4.2.2) read again how it is now: if the GM changes it by hand meanwhile, that is what comes back next time
    if (!st.halted) setTimeout(() => { if (L.touched || st.halted) return; L.prevOrig = L.orig || L.prevOrig; L.orig = null; L.askedAt = Date.now(); askOrig(L); }, L.kind === 'cloud' ? 1500 : 400);
  }
  function askOrig(L) {
    if (L.kind === 'lan') lanSend(L, 'devStatus', {});
    else if (L.kind === 'cloud') cloudState(L);
    else if (L.kind === 'ikea' && L.acc && L.acc.lightList && L.acc.lightList[0]) setOrig(L, ikeaNow(L.acc.lightList[0]));
  }
  // final: the app is ending, nothing may drive the lamps afterwards
  async function restoreAll(final = false) {
    if (!st.started) return;
    if (final) { st.halted = true; clearInterval(timer); timer = null; }
    for (const L of lamps.values()) cancelFx(L);
    await Promise.allSettled([...lamps.values()].map(restoreLamp));
    await wait(150); // (the network messages on their way)
  }

  // ------------------------------------------------------------------ public
  function start() {
    if (st.started) return;
    st.started = true; st.halted = false;
    cfg().used = true; o.save();
    lanStart();
    cloudList();
    if (cfg().tradfri) ikeaConnect();
    timer = setInterval(tick, 200);
    scanTimer = setInterval(() => { lanScan(); }, 60000);
    changed();
  }
  function stop() {
    saveNow();
    st.halted = true;
    for (const L of lamps.values()) cancelFx(L);
    clearInterval(timer); clearInterval(scanTimer);
    try { if (sock) sock.close(); } catch {}
    sock = null;
    try { if (tradfri) tradfri.destroy(); } catch {}
    tradfri = null;
    st.started = false;
  }
  function event(kind, arg) {
    if (!st.started) return;
    const off = cfg().fxOff || {};
    if (off[kind] || (kind === 'moment' && off[arg])) return; // switched off in Test and tune → Effects
    if (kind === 'lightning') play(FX.lightning);
    else if (kind === 'spell' && arg) play(spellFx(arg));
    else if (FX[kind]) play(FX[kind]);
    else if (kind === 'moment' && FX[arg]) play(FX[arg]);
  }
  function view() {
    const c = cfg();
    const hex = (x) => `#${rgb2hex(x || WARM)}`;
    return {
      started: st.started, on: modeOf() === 'follow', mode: modeOf(), sceneId: modeOf() === 'scene' ? c.sceneId : null, lastScene: c.sceneId || null,
      brightness: c.brightness ?? 1, fxStrength: c.fxStrength ?? 1, noFlash: !!c.noFlash, restore: c.restore !== false, strength: c.strength ?? 0.85,
      scenes: (c.scenes || []).map((x) => ({ id: x.id, name: x.name, colors: Object.values(x.lamps || {}).filter((y) => y.on !== false).slice(0, 5).map((y) => hex(y.rgb)) })),
      plan: { rot: (c.plan && c.plan.rot) || 0, dm: (c.plan && c.plan.dm) || { x: 0.5, y: 0.8 } },
      setupDone: !!c.setupDone,
      lan: st.lan, cloud: { ...st.cloud, key: !!c.goveeKey }, ikea: { ...st.ikea, paired: !!c.tradfri, host: c.tradfri ? c.tradfri.host : '' },
      lamps: [...lamps.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((L) => ({
        id: L.id, name: nameOf(L), sku: L.sku, kind: L.kind, ...member(L), online: L.online, pos: (c.pos || {})[L.id] || null,
        color: L.shown && L.shown.on ? hex(L.shown.rgb) : null, fast: L.kind === 'lan', ...optsOf(L.id),
      })),
      preview: preview ? preview.id : null, ambience: c.ambience === 'mood' ? 'mood' : 'table', tvArea: c.tvArea === 'whole' ? 'whole' : 'side',
      tv: table ? (() => { const x = colourOf(table.cells, null); return { rgb: hex(x.rgb), bri: Math.round(x.bri), age: Date.now() - table.at }; })() : null, // what the TV shows right now
    };
  }
  // Test and tune: everything in detail (only asked for by that window)
  function tune() {
    const c = cfg();
    const hex = (x) => `#${rgb2hex(x || WARM)}`;
    return {
      ...view(),
      lampsFull: [...lamps.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((L) => {
        const s = L.hold || L.shown || { on: true, rgb: WARM, bri: 80 };
        return { id: L.id, name: nameOf(L), sku: L.sku, kind: L.kind, ...member(L), online: L.online, held: !!L.hold, on: s.on !== false, rgb: hex(s.rgb), bri: s.bri ?? 80, ...optsOf(L.id) };
      }),
      looks: SITUATIONS.map(([id, label]) => { const x = look(id); return { id, label, rgb: hex(x.rgb), bri: x.bri, custom: !!(c.looks && c.looks[id]) }; }),
      effects: FX_LIST.map(([id, label]) => ({ id, label, on: !(c.fxOff || {})[id] })),
    };
  }
  async function action(a, p = {}) {
    const c = cfg();
    switch (a) {
      case 'start': start(); return { ok: true };
      case 'scan': start(); if (sock) lanScan(); else lanStart(); cloudList(); return { ok: true }; // (4.2.2) after a network error: a new socket
      case 'key': c.goveeKey = String(p.key || '').trim().slice(0, 200); o.save(); for (const [id, L] of [...lamps]) if (L.kind === 'cloud') forget(id); await cloudList(); return { ok: st.cloud.state === 'ok', error: st.cloud.msg };
      case 'ikea.find': return ikeaFind();
      case 'ikea.pair': start(); return ikeaPair(p.host, p.code);
      case 'ikea.forget': c.tradfri = null; o.save(); try { if (tradfri) tradfri.destroy(); } catch {} tradfri = null; for (const [id, L] of [...lamps]) if (L.kind === 'ikea') forget(id); st.ikea = { state: 'off', msg: '' }; changed(); return { ok: true };
      case 'member': { // drag and drop: a lamp into or out of Effects / Ambience
        const L = lamps.get(p.id);
        if (!L) return { ok: false };
        const m = member(L);
        if ('fx' in p) m.fx = !!p.fx;
        if ('amb' in p) m.amb = !!p.amb;
        c.member = { ...(c.member || {}), [p.id]: m };
        o.save();
        L.wantSig = '';
        changed();
        return { ok: true };
      }
      case 'test': play(FX.blink, p.id); return { ok: true };
      case 'tune': return { ok: true, tune: tune() };
      case 'hold': { // Test and tune → Lamps: this lamp as set by hand
        const L = lamps.get(p.id);
        if (!L) return { ok: false };
        const cur = L.hold || L.shown || { on: true, rgb: WARM, bri: 80 };
        L.hold = { on: 'on' in p ? !!p.on : cur.on !== false, rgb: p.rgb ? hex2rgb(p.rgb) : cur.rgb || WARM, bri: 'bri' in p ? clamp(Number(p.bri) || 1, 1, 100) : cur.bri ?? 80 };
        drive(L, L.hold);
        return { ok: true };
      }
      case 'release': // back to the game (one lamp, or all when the window closes)
        for (const L of lamps.values()) if (!p.id || L.id === p.id) { L.hold = null; L.wantSig = ''; }
        if (!p.id) preview = null;
        changed();
        return { ok: true };
      case 'lamp': { // this lamp's own limits: brighter than, darker than, flashes or not
        const cur = optsOf(p.id);
        const next = { max: 'max' in p ? clamp(Math.round(Number(p.max) || 100), 5, 100) : cur.max, min: 'min' in p ? clamp(Math.round(Number(p.min) || 1), 1, 60) : cur.min, flashes: 'flashes' in p ? !!p.flashes : cur.flashes };
        c.lampOpts = { ...(c.lampOpts || {}), [p.id]: next };
        saveSoon();
        const L = lamps.get(p.id);
        if (L) L.wantSig = '';
        return { ok: true };
      }
      case 'look': // a situation in the GM's own colour and brightness
        if (!SITUATIONS.some(([id]) => id === p.id)) return { ok: false };
        if (p.reset) { const x = { ...(c.looks || {}) }; delete x[p.id]; c.looks = x; } else {
          const was = look(p.id);
          c.looks = { ...(c.looks || {}), [p.id]: { rgb: p.rgb ? hex2rgb(p.rgb) : was.rgb, bri: 'bri' in p ? clamp(Math.round(Number(p.bri) || 1), 1, 100) : was.bri } };
        }
        saveSoon();
        for (const x of lamps.values()) x.wantSig = '';
        if (p.preview !== false) action('preview', { id: p.id });
        return { ok: true };
      case 'preview': { // show a situation on the lamps for a few seconds
        const id = p.id;
        if (!SITUATIONS.some(([x]) => x === id)) return { ok: false };
        const mood = FXDATA.MOODS.find((x) => x.id === id);
        preview = {
          id, until: Date.now() + (Number(p.ms) || 8000),
          game: (g) => ({ ...g, light: mood ? { darkness: mood.darkness, tint: mood.tint, mood: mood.id } : g.light, fight: id === 'fight', brk: id === 'break', blackout: false, lasting: id === 'lightsout' ? ['lightsout'] : [] }),
        };
        for (const x of lamps.values()) { x.wantSig = ''; x.back = 300; }
        changed();
        return { ok: true };
      }
      case 'try': { // Test and tune → Effects: play one on the Effects lamps
        const keys = p.fx === 'spell' ? spellFx(p.color || '#ff7a1f') : FX[p.fx];
        if (!keys) return { ok: false };
        play(keys, null, true);
        return { ok: true };
      }
      case 'fx': c.fxOff = { ...(c.fxOff || {}), [p.id]: !p.on }; o.save(); return { ok: true };
      case 'set':
        if ('on' in p) { c.mode = p.on ? 'follow' : 'room'; c.manual = null; }
        if ('strength' in p) c.strength = clamp(Number(p.strength) || 0, 0, 1);
        if ('ambience' in p) c.ambience = p.ambience === 'mood' ? 'mood' : 'table';
        if ('tvArea' in p) c.tvArea = p.tvArea === 'whole' ? 'whole' : 'side';
        if ('brightness' in p) c.brightness = clamp(Number(p.brightness) || 0.05, 0.05, 1);
        if ('fxStrength' in p) c.fxStrength = clamp(Number(p.fxStrength) || 0, 0, 1);
        if ('noFlash' in p) c.noFlash = !!p.noFlash;
        if ('restore' in p) c.restore = !!p.restore;
        if ('setupDone' in p) c.setupDone = !!p.setupDone;
        saveSoon(); for (const x of lamps.values()) x.wantSig = ''; changed(); return { ok: true };
      case 'bright.step': { // 4.5: −20 % / +20 % (a button on the hotbar or the phone); + while Off or let go: on again at 20 %
        const by = Number(p.by) || 0;
        let back = false;
        if (by > 0 && (c.mode === 'off' || c.mode === 'release')) {
          const b = c.beforeOff && MODES.includes(c.beforeOff.mode) && !['off', 'release'].includes(c.beforeOff.mode) && (c.beforeOff.mode !== 'scene' || sceneOf(c.beforeOff.sceneId)) ? c.beforeOff : { mode: 'follow' };
          c.brightness = 0.2;
          action('mode', { mode: b.mode, sceneId: b.sceneId });
          back = true;
        } else {
          c.brightness = clamp(Math.round(((c.brightness ?? 1) + by) * 20) / 20, 0.1, 1);
          saveSoon(); for (const x of lamps.values()) x.wantSig = ''; changed();
        }
        return { ok: true, brightness: c.brightness, back, mode: c.mode };
      }
      case 'mode': { // Table / a scene / Room light / Off (switched off) / Let go (back as they were)
        const m = MODES.includes(p.mode) ? p.mode : 'follow';
        if (m === 'scene' && !sceneOf(p.sceneId)) return { ok: false, error: 'That scene is gone' };
        if ((m === 'off' || m === 'release') && c.mode !== 'off' && c.mode !== 'release') c.beforeOff = { mode: c.mode, sceneId: c.sceneId || null }; // (+20 % brings it back)
        c.mode = m; c.manual = null; c.on = m === 'follow'; c.off2 = true;
        if (m === 'scene') c.sceneId = p.sceneId;
        o.save();
        for (const x of lamps.values()) { x.wantSig = ''; x.soft = null; if (m === 'off' || m === 'release') cancelFx(x); }
        if (m === 'release') restoreAll();
        changed();
        return { ok: true };
      }
      case 'name': { const nm = String(p.name || '').trim().slice(0, 40); const x = { ...(c.names || {}) }; if (nm) x[p.id] = nm; else delete x[p.id]; c.names = x; o.save(); changed(); return { ok: true }; }
      case 'pos': { // a lamp placed on the room plan (or taken off it)
        const x = { ...(c.pos || {}) };
        if (p.remove) delete x[p.id]; else x[p.id] = { x: clamp(Number(p.x) || 0, 0, 1), y: clamp(Number(p.y) || 0, 0, 1) };
        c.pos = x; o.save();
        const L = lamps.get(p.id); if (L) { L.tvSeq = null; L.tvc = null; }
        changed();
        return { ok: true };
      }
      case 'plan': // where the TV picture's top points, where the GM sits
        c.plan = { ...(c.plan || {}), ...('rot' in p ? { rot: ((Math.round(Number(p.rot) / 90) * 90) % 360 + 360) % 360 } : {}), ...(p.dm ? { dm: { x: clamp(Number(p.dm.x) || 0, 0, 1), y: clamp(Number(p.dm.y) || 0, 0, 1) } } : {}) };
        o.save();
        for (const L of lamps.values()) { L.tvSeq = null; L.tvc = null; }
        changed();
        return { ok: true };
      case 'scene.save': { // the lamps as set by hand become a scene
        const lampsOf = {};
        for (const L of lamps.values()) if (L.hold) lampsOf[L.id] = { on: L.hold.on !== false, rgb: L.hold.rgb, bri: L.hold.bri };
        if (!Object.keys(lampsOf).length) return { ok: false, error: 'Set at least one lamp first' };
        const list = [...(c.scenes || [])];
        const i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) for (const [id, x] of Object.entries(list[i].lamps || {})) { const L = lamps.get(id); if (!L || !L.online) lampsOf[id] = x; } // (4.2.2) a lamp switched off at the wall stays in the scene
        const sc = { id: i >= 0 ? p.id : `ls${Date.now().toString(36)}`, name: String(p.name || 'Lamp scene').trim().slice(0, 40) || 'Lamp scene', lamps: lampsOf };
        if (i >= 0) list[i] = sc; else list.push(sc);
        c.scenes = list.slice(-24); o.save(); changed();
        return { ok: true, id: sc.id };
      }
      case 'scene.load': { // a scene's lamps onto the lamps by hand (to change it)
        const sc = sceneOf(p.id);
        if (!sc) return { ok: false };
        for (const [id, x] of Object.entries(sc.lamps)) { const L = lamps.get(id); if (L) L.hold = { on: x.on !== false, rgb: x.rgb, bri: x.bri }; }
        return { ok: true };
      }
      case 'scene.rename': { const sc = sceneOf(p.id); if (!sc) return { ok: false }; sc.name = String(p.name || sc.name).trim().slice(0, 40) || sc.name; o.save(); changed(); return { ok: true }; }
      case 'scene.delete': c.scenes = (c.scenes || []).filter((x) => x.id !== p.id); if (c.sceneId === p.id && c.mode === 'scene') c.mode = 'follow'; o.save(); changed(); return { ok: true };
      case 'hold.all': // the scene maker's "All lamps": one colour and brightness for every lamp in use
        for (const L of lamps.values()) { const m = member(L); if (!m.fx && !m.amb) continue; L.hold = { on: p.on !== false, rgb: p.rgb ? hex2rgb(p.rgb) : (L.hold || {}).rgb || WARM, bri: 'bri' in p ? clamp(Number(p.bri) || 1, 1, 100) : (L.hold || {}).bri ?? 80 }; drive(L, L.hold); }
        return { ok: true };
      case 'demo': { // Setup → Try it: a stormy night for a few seconds, with lightning
        preview = { id: 'demo', until: Date.now() + 7000, game: (g) => ({ ...g, light: { darkness: 0.7, tint: '#0a1634', mood: 'night' }, fight: false, brk: false, blackout: false, lasting: [] }) };
        for (const x of lamps.values()) { x.wantSig = ''; x.back = 600; }
        for (const at of [1300, 2900, 3500, 5200]) setTimeout(() => play(FX.lightning, null, true), at);
        changed();
        return { ok: true };
      }
      case 'room': return action('mode', { mode: p.which === 'off' ? 'off' : 'room' }); // (Beta 3's quick buttons)
      default: return { ok: false };
    }
  }
  if (cfg().used) setTimeout(start, 1500); // used before: on again with the app
  return { start, stop, event, view, action, wantsTable, tableFrom, restoreAll, started: () => st.started, wantsRestore: () => st.started && cfg().restore !== false && [...lamps.values()].some((L) => L.touched && L.orig), _lamps: lamps, _tick: tick };
};
