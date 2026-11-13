// Prototype 1: the players move their own tokens from their phones.
// A phone that scanned the players' code picks a character of the party; its token on the live map then
// follows the stick: push and let go, one square (while pushing, the TV shows an arrow and the landing square),
// Dash in a fight, a ping on the TV. The phone's "up" is turned by the seat the player chose (calib: the TV's top
// edge glows while they point the stick at it). Prototype 6: no turning and no doors from the phone any more. The rules live here, in the main process; the phone only asks (remote.js → main.js →
// run()), and what it may do right now comes back in its state (forPhone()). The DM's panel (players-panel.js)
// reads view() and sets things with action().
//   a step    can't cross a wall or a closed door (vision.js knows them), can't land on another token that shows
//             (a GM-hidden one would give itself away), can't leave the map picture
//   pace      free, or paused by the DM; a rest of N seconds between steps if the DM wants one
//   a fight   (a turn order is running, shown on the TV or not) only on your turn, the character's speed per turn, Dash
//             once; every second diagonal step of a turn costs 10 ft (5-10-5); the squares walked this turn leave a trace
//   movement  (Prototype 8, pace 'group') no fight, but everyone walks their speed once, with Dash and their extra moves;
//             the DM hands out movement again (the panel's button, or Next round of the round counter)
//   speed     the character card's (Movement), else the DM's default; the card's extra moves (Cunning Action …) add
//             feet once a turn each
//   vision    the token gets an eye of its own: a party light carried by it with the character card's darkvision
'use strict';

const Vision = require('./renderer/vision');
const Geom = require('./renderer/geom');

const DIRS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const DEFAULTS = { on: false, pace: 'free', rest: 0, pings: true, eyes: true, speed: 30, trace: true };
const CARRIES = ['none', 'candle', 'torch', 'lantern', 'light', 'daylight'];
const OPS = ['pick', 'unpick', 'move', 'aim', 'calib', 'dash', 'point', 'extra']; // ('point': the Ping button; "ping" is remote.js's own "are you there")

// do two segments cross (parallel ones never do: a path along a wall is not through it)
function cross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r = [bx - ax, by - ay]; const s = [dx - cx, dy - cy];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return false;
  const qp = [cx - ax, cy - ay];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  return t > -1e-9 && t < 1 + 1e-9 && u > -1e-9 && u < 1 + 1e-9;
}

function create(o) {
  // o: { store, state, settings: () => settings, save, handle, charOf, charFile, charTokOwner, initInfo, faceUrl, faceFor, ping, calib, devices: () => [...], connected: (dev) => bool, log }
  const S = () => { const s = o.settings(); if (!s.players || typeof s.players !== 'object') s.players = {}; return s.players; };
  const opt = () => ({ ...DEFAULTS, ...S() });
  const mem = new Map(); // device id → { lastStep, pingAt, aimAt, actAt, aiming, handed: { mapId, id } }
  const M = (dev) => { let m = mem.get(dev.id); if (!m) { m = { lastStep: 0, pingAt: 0, aimAt: 0, actAt: 0, aiming: false, handed: null }; mem.set(dev.id, m); } return m; };
  // Prototype 3: what a turn allows belongs to the character, not to the phone (a second phone is no second turn)
  const turns = new Map(); // character → { turnKey, used, dashed, extra, restUntil, diag, trail }
  let groupN = 1; // Prototype 8: which hand-out of movement this is (pace 'group')
  // (diag: diagonal steps this turn; trail: the squares walked this turn, { mapId, id (token), pts: [{ x, y, ft }] })
  const T = (name) => { let t = turns.get(name); if (!t) { t = { turnKey: null, used: 0, dashed: false, extra: [], restUntil: 0, diag: 0, trail: null }; turns.set(name, t); } return t; };
  // a phone that left keeps its character for a minute (the screen locked, the Wi-Fi blinked)
  const present = (d) => o.connected(d) || Date.now() - (d.seen || 0) < 60000;
  const live = () => (o.state.liveMapId ? o.store.map(o.state.liveMapId) : null);
  const party = () => { const c = o.store.cur; if (!c) return []; const away = new Set(c.meta.away || []); return (c.meta.party || []).filter((n) => !away.has(n)); };
  const holders = () => o.devices().filter((d) => d.role === 'player' && d.char);
  const holderOf = (name, butDev) => holders().find((d) => d.char === name && (!butDev || d.id !== butDev.id)) || null;

  // ---------- the token a phone drives ----------
  function tokensOf(map, name) {
    return (map.layers || []).filter((l) => l.role === 'token' && (o.ownerOf ? o.ownerOf(l) : o.charTokOwner(l, true)) === name); // (Prototype 17: also a token the DM made theirs)
  }
  function tokenOf(dev, map = live()) {
    if (!map || !dev.char) return null;
    const m = M(dev);
    if (m.handed && m.handed.mapId === map.id) { const t = map.layers.find((l) => l.id === m.handed.id && l.role === 'token'); if (t) return t; m.handed = null; }
    const list = tokensOf(map, dev.char);
    return list.find((t) => !t.hidden) || list[0] || null;
  }
  const tokName = (t) => `${t.name}${t.n ? ` ${t.n}` : ''}`;

  // ---------- the fight: whose turn, how far they still may go ----------
  // Prototype 6: a fight is a turn order that is running, whether the TV shows it or not
  function fight() {
    const I = o.initInfo(true);
    if (!I || !I.running || I.cur < 0) return null;
    const unit = I.units[I.cur];
    if (!unit) return null;
    const ents = I.entries.filter((e) => unit.ids.includes(e.id));
    const pcs = ents.filter((e) => e.pc).map((e) => e.name);
    // (who: a player by name; anyone else as the players' screen names it, "??" for one they have not met, never the DM's own name)
    return { key: `${I.turn}:${(o.combatRound && o.combatRound()) ?? ''}`, who: pcs.length ? pcs.join(' and ') : (o.turnName ? o.turnName() : 'someone else'), pcs, mapId: I.mapId };
  }
  // Prototype 8: what limits the steps right now: the fight, or (pace 'group') the movement the DM handed out to everyone
  function round() {
    const F = fight();
    if (F) return F;
    if (opt().pace !== 'group') return null;
    const map = live();
    return { key: `g${groupN}:${map ? map.id : ''}:${map && map.round ? map.round.n : ''}`, group: true, who: 'Everyone', pcs: party(), mapId: map ? map.id : null };
  }
  // the character card's speed and extra moves (Cunning Action …: feet once a turn; no feet given: the speed again)
  const speedOf = (name) => { const v = Number((o.charOf(name) || {}).speed); return v >= 5 ? v : opt().speed || 30; };
  const movesOf = (name) => { const sp = speedOf(name); return ((o.charOf(name) || {}).moves || []).map((x) => ({ name: x.name, ft: Number(x.ft) >= 5 ? Number(x.ft) : sp })); };
  function budget(dev, F) {
    if (!F) return null;
    const m = T(dev.char);
    if (m.turnKey !== F.key) { m.turnKey = F.key; m.used = 0; m.dashed = false; m.extra = []; m.diag = 0; m.trail = null; }
    const speed = speedOf(dev.char);
    const moves = movesOf(dev.char);
    m.extra = m.extra.filter((i) => i < moves.length);
    const max = speed * (m.dashed ? 2 : 1) + m.extra.reduce((a, i) => a + moves[i].ft, 0);
    return { left: Math.max(0, max - m.used), max, speed, dashed: m.dashed, extras: moves.map((x, i) => ({ i, name: x.name, ft: x.ft, used: m.extra.includes(i) })) };
  }

  // ---------- what blocks a step ----------
  function footprint(g, u, v, cells, inset) {
    const half = (cells * g.size) / 2 - inset;
    return [[u - half, v - half], [u + half, v - half], [u + half, v + half], [u - half, v + half]];
  }
  function wallBetween(map, g, a, b, cells) {
    const segs = Vision.movers(map); // (Prototype 14: windows and invisible walls stop feet too)
    if (!segs.length) return false;
    const A = footprint(g, a.u, a.v, cells, 0.3 * g.size); const B = footprint(g, b.u, b.v, cells, 0.3 * g.size);
    const paths = [[Geom.fromLocal(g, a.u, a.v), Geom.fromLocal(g, b.u, b.v)]];
    for (let i = 0; i < 4; i++) paths.push([Geom.fromLocal(g, A[i][0], A[i][1]), Geom.fromLocal(g, B[i][0], B[i][1])]);
    for (const [p, q] of paths) {
      for (let i = 0; i < segs.length; i += 4) if (cross(p.x, p.y, q.x, q.y, segs[i], segs[i + 1], segs[i + 2], segs[i + 3])) return true;
    }
    return false;
  }
  function tokenAt(map, g, tok, b) {
    const s = g.size;
    const hb = (tok.size || 1) * s / 2 - 0.1 * s;
    for (const l of map.layers) {
      if (l.role !== 'token' || l.id === tok.id || l.hidden) continue;
      const p = Geom.toLocal(g, l.x, l.y);
      const hl = (l.size || 1) * s / 2 - 0.1 * s;
      if (Math.abs(p.u - b.u) < hb + hl && Math.abs(p.v - b.v) < hb + hl) return l;
    }
    return null;
  }
  function offMap(map, x, y) {
    const bg = map.bg;
    if (!bg || (bg.rotation || 0) % 360 !== 0) return false;
    const w = bg.span || (bg.scale != null && bg.nw ? bg.nw * bg.scale : 0);
    if (!w || !bg.nw || !bg.nh) return false;
    const hgt = bg.nh * (w / bg.nw);
    const x0 = bg.x || 0; const y0 = bg.y || 0;
    return x < x0 || y < y0 || x > x0 + w || y > y0 + hgt;
  }

  // where a step would land, and whether it may: { to, ok, error }
  function target(map, tok, dir) {
    const d = DIRS[dir];
    if (!d) return { ok: false, error: 'Which way?' };
    const g = map.grid; const s = g.size || 1;
    const cells = tok.size || 1;
    const p0 = Geom.snap(g, tok.x, tok.y, cells);
    const a0 = Geom.toLocal(g, p0.x, p0.y);
    const b0 = { u: a0.u + d[0] * s, v: a0.v + d[1] * s };
    const to = Geom.fromLocal(g, b0.u, b0.v);
    if (offMap(map, to.x, to.y)) return { ok: false, to, error: 'The map ends here' };
    if (wallBetween(map, g, a0, b0, cells)) return { ok: false, to, error: 'A wall is in the way' };
    const other = tokenAt(map, g, tok, b0);
    if (other) { const who = o.charTokOwner(other, true); return { ok: false, to, error: who ? `${who} is standing there` : 'Someone is in the way' }; } // (no names of the DM's tokens)
    return { ok: true, to, from: p0, diagonal: !!(d[0] && d[1]) };
  }
  const aimMsg = (map, tok, dev, t) => ({ kind: 'aim', mapId: map.id, id: tok.id, x: tok.x, y: tok.y, to: t ? t.to || null : null, ok: !!(t && t.ok), cells: tok.size || 1, color: (o.charOf(dev.char) || {}).color || null });

  // ---------- may this phone move right now? ----------
  function allowed(dev, map, tok) {
    const P = opt();
    if (!P.on) return { ok: false, why: 'off', error: 'The DM has not switched on moving by phone' };
    if (!map) return { ok: false, why: 'noMap', error: 'Nothing is on the table yet' };
    if (!tok) return { ok: false, why: 'noToken', error: 'Your token is not on this map' };
    if (P.pace === 'paused') return { ok: false, why: 'paused', error: 'Paused by the DM' };
    if (Geom.isHex(map.grid)) return { ok: false, why: 'hex', error: 'Hex grids come later' };
    const F = round();
    if (F) {
      if (!F.pcs.includes(dev.char)) return { ok: false, why: 'turn', error: `Not your turn: ${F.who}`, F };
      const B = budget(dev, F);
      if (B.left < 5) return { ok: false, why: 'spent', error: !B.dashed ? 'No movement left: Dash?' : B.extras.some((x) => !x.used) ? `No movement left: ${B.extras.find((x) => !x.used).name}?` : F.group ? 'No movement left: the DM gives more' : 'No movement left this turn', F, B };
      return { ok: true, F, B };
    }
    const m = T(dev.char);
    if (P.rest > 0 && Date.now() < m.restUntil) return { ok: false, why: 'rest', error: `Catch your breath: ${Math.ceil((m.restUntil - Date.now()) / 1000)} s`, restUntil: m.restUntil };
    return { ok: true };
  }

  // ---------- the eye ----------
  // Prototype 17: every player token's eye is kept by main.js (syncEyes), phone or not; a token handed to a phone is
  // that player's too while the phone holds it
  function heldBy(mapId, tokenId) {
    for (const d of holders()) { const m = M(d); if (m.handed && m.handed.mapId === mapId && m.handed.id === tokenId) return d.char; }
    return null;
  }

  // ---------- what a phone does ----------
  async function run(op, a, dev) {
    if (!OPS.includes(op)) return { ok: false, error: 'Tablescape doesn\'t know that (an older version?)' };
    const P = opt();
    // Prototype 3: switched off means off for everything a phone does on the table (leaving and letting go still work)
    if (!P.on && op !== 'unpick' && !(op === 'calib' && !a.on) && !(op === 'aim' && !a.dir)) return { ok: false, why: 'off', error: 'The DM has not switched on moving by phone' };
    if (op === 'pick') {
      const name = String(a.name || '');
      if (!party().includes(name)) return { ok: false, error: 'That character is not in the party' };
      const other = holderOf(name, dev);
      if (other && present(other)) return { ok: false, error: `${name} is already on ${other.name}` };
      if (other) { delete other.char; } // (a phone that left: its character is free)
      if (dev.char && dev.char !== name) M(dev).handed = null;
      dev.char = name;
      o.save();
      return { ok: true };
    }
    if (op === 'unpick') { delete dev.char; M(dev).handed = null; o.save(); return { ok: true }; }
    if (!dev.char) return { ok: false, error: 'Pick your character first' };
    if (!party().includes(dev.char)) { delete dev.char; o.save(); return { ok: false, error: 'Pick your character again' }; } // (left the party, or away tonight)
    const map = live();
    const tok = tokenOf(dev, map);
    if (op === 'calib') { o.calib(!!a.on); return { ok: true }; } // the TV's top edge glows while this phone finds its seat
    if (op === 'point') {
      if (!map || !tok) return { ok: false, error: 'Your token is not on this map' };
      if (!P.pings) return { ok: false, error: 'The DM switched pings off' };
      const m = M(dev); const now = Date.now();
      if (now - m.pingAt < 1200) return { ok: true };
      m.pingAt = now; o.ping({ mapId: map.id, x: tok.x, y: tok.y, kind: 'ping', phone: true });
      return { ok: true };
    }
    if (op === 'aim') { // the stick is pushed (or let go without a step): the TV shows where it would land
      if (!map || !tok) return { ok: true };
      const m = M(dev); const now = Date.now();
      if (!a.dir) { if (m.aiming) { m.aiming = false; o.ping(aimMsg(map, tok, dev, null)); } return { ok: true }; }
      if (now - m.aimAt < 60 || now < (m.noAimUntil || 0)) return { ok: true }; // (an aim that was still on its way when the step came would stay on the map)
      m.aimAt = now; m.aiming = true;
      const can = allowed(dev, map, tok);
      const t = can.ok ? target(map, tok, a.dir) : { ok: false, to: (target(map, tok, a.dir) || {}).to };
      o.ping(aimMsg(map, tok, dev, t));
      return { ok: true };
    }
    if (op === 'dash' || op === 'extra') {
      const F = round();
      if (!F) return { ok: false, error: 'That is for fights: right now you walk freely' };
      if (!F.pcs.includes(dev.char)) return { ok: false, error: `Not your turn: ${F.who}` };
      const m = T(dev.char); const B = budget(dev, F);
      if (op === 'dash') {
        if (m.dashed) return { ok: false, error: 'You already dashed this turn' };
        m.dashed = true;
        return { ok: true };
      }
      // an extra move of the character card: its feet on top, once a turn
      const x = B.extras[Math.round(Number(a.i))];
      if (!x) return { ok: false, error: 'Your character has no such move' };
      if (x.used) return { ok: false, error: `${x.name}: already used this turn` };
      m.extra.push(x.i);
      return { ok: true };
    }
    // ----- a step -----
    const m = M(dev); const now = Date.now();
    if (m.aiming) { m.aiming = false; if (map && tok) o.ping(aimMsg(map, tok, dev, null)); }
    if (now - m.lastStep < 140) return { ok: true, skipped: true }; // (a finger that drums)
    const can = allowed(dev, map, tok);
    if (!can.ok) return { ok: false, error: can.error, why: can.why };
    const t = target(map, tok, a.dir);
    if (!t.ok) return { ok: false, error: t.error };
    // in a fight: 5 ft a square, every second diagonal of the turn 10 ft (5-10-5, the Dungeon Master's Guide's rule)
    const tn = T(dev.char);
    const cost = can.F ? (t.diagonal && tn.diag % 2 === 1 ? 10 : 5) : 0;
    if (can.F && cost > can.B.left) return { ok: false, error: `This diagonal step costs 10 ft: ${can.B.left} ft left`, why: 'spent' };
    m.lastStep = now; m.noAimUntil = now + 300;
    o.ping({ kind: 'slide', mapId: map.id, id: tok.id }); // (the TV slides it there instead of jumping)
    o.handle('layer.update', { mapId: map.id, id: tok.id, x: t.to.x, y: t.to.y, final: true, noHistory: true, byPhone: true });
    if (can.F) {
      tn.used += cost;
      if (t.diagonal) tn.diag += 1;
      // the trace of this turn: where it started, then every square walked, with the feet used up to there
      if (!tn.trail || tn.trail.mapId !== map.id || tn.trail.id !== tok.id) tn.trail = { mapId: map.id, id: tok.id, pts: [{ x: t.from.x, y: t.from.y, ft: tn.used - cost }] };
      tn.trail.pts.push({ x: t.to.x, y: t.to.y, ft: tn.used });
    } else if (P.rest > 0) tn.restUntil = now + P.rest * 1000;
    return { ok: true, x: t.to.x, y: t.to.y };
  }

  // ---------- the phone's state ----------
  function forPhone(dev) {
    const P = opt();
    const map = live();
    const tok = tokenOf(dev, map);
    const face = (n) => o.faceUrl(o.faceFor({ name: n, pc: true, tokens: [] }, o.state.liveMapId));
    const col = (n) => (o.charOf(n) || {}).color || null;
    const chars = party().map((n) => { const hd = holderOf(n, dev); return { name: n, color: col(n), face: face(n), taken: hd && present(hd) ? hd.name : null }; });
    const out = { on: !!P.on, chars, me: null };
    if (!dev.char) return out;
    if (!party().includes(dev.char)) { delete dev.char; o.save(); return out; }
    const can = allowed(dev, map, tok);
    const F = can.F || (can.why === 'turn' ? round() : null);
    const B = can.B || (F && F.pcs.includes(dev.char) ? budget(dev, F) : null);
    out.me = {
      name: dev.char, color: col(dev.char), face: face(dev.char),
      token: tok ? { id: tok.id, hidden: !!tok.hidden } : null,
      can: can.ok, why: can.ok ? null : can.why, error: can.ok ? null : can.error,
      restUntil: P.rest > 0 ? T(dev.char).restUntil || 0 : 0, rest: P.rest,
      fight: F ? { mine: F.pcs.includes(dev.char), group: !!F.group, who: F.who, key: F.key, left: B ? B.left : 0, max: B ? B.max : 0, dashed: !!(B && B.dashed), extras: B ? B.extras : [] } : null,
      rules: { pings: P.pings },
    };
    return out;
  }

  // ---------- the DM's panel ----------
  function view() {
    const P = opt();
    const map = live();
    const col = (n) => (o.charOf(n) || {}).color || null;
    const phones = o.devices().filter((d) => d.role === 'player' && !d.local).map((d) => {
      const tok = tokenOf(d, map);
      const can = d.char ? allowed(d, map, tok) : null;
      const R = d.char ? round() : null; const B = R && R.pcs.includes(d.char) ? budget(d, R) : null;
      return { left: B ? B.left : null, max: B ? B.max : null, speed: d.char ? speedOf(d.char) : null, id: d.id, name: d.name, kind: d.kind, connected: o.connected(d), char: d.char || null, color: d.char ? col(d.char) : null, carry: d.char && o.sightOf ? o.sightOf(d.char).carry : 'none',
        token: tok ? { id: tok.id, name: tokName(tok), handed: !!M(d).handed } : null, can: can ? can.ok : false, why: can && !can.ok ? can.why : null, lastStep: M(d).lastStep || 0 };
    });
    const tokens = map ? map.layers.filter((l) => l.role === 'token').map((l) => ({ id: l.id, name: tokName(l), hidden: !!l.hidden, owner: o.ownerOf ? o.ownerOf(l) : o.charTokOwner(l, true) })) : [];
    // Prototype 17: the player menu: how far each character may still walk now (in a fight or Movement), their speed
    const R = round();
    const moves = Object.fromEntries(party().map((n) => { const B = R && R.pcs.includes(n) ? budget({ char: n }, R) : null; return [n, { speed: speedOf(n), left: B ? B.left : null, max: B ? B.max : null, dashed: !!(B && B.dashed) }]; }));
    return { ...P, hex: !!(map && Geom.isHex(map.grid)), map: map ? map.name : null, fight: !!fight(), phones, party: party().map((n) => ({ name: n, color: col(n), holder: (holderOf(n) || {}).name || null })), tokens, carries: CARRIES, moves };
  }
  async function action(a, p = {}) {
    const dev = p.id ? o.devices().find((d) => d.id === p.id) : null;
    switch (a) {
      case 'set': {
        const s = S();
        if ('on' in p) s.on = !!p.on;
        if ('pace' in p) s.pace = ['paused', 'group'].includes(p.pace) ? p.pace : 'free';
        if ('rest' in p) s.rest = Math.min(60, Math.max(0, Math.round(Number(p.rest) || 0)));
        for (const k of ['pings', 'eyes', 'trace']) if (k in p) s[k] = !!p[k];
        for (const k of ['fightTurns', 'doors', 'diagonals', 'turning']) delete s[k]; // (Prototype 6: gone)
        if ('speed' in p) s.speed = Math.min(120, Math.max(5, Math.round((Number(p.speed) || 30) / 5) * 5));
        o.save();
        return { ok: true };
      }
      case 'assign': {
        if (!dev) return { ok: false, error: 'No such phone' };
        const name = p.name ? String(p.name) : null;
        M(dev).handed = null;
        if (name) { const other = holderOf(name, dev); if (other) { delete other.char; M(other).handed = null; } dev.char = name; } else delete dev.char;
        o.save();
        return { ok: true };
      }
      case 'hand': { // any token of the live map for this phone (null: its character's own again)
        if (!dev) return { ok: false, error: 'No such phone' };
        if (!dev.char) return { ok: false, error: 'This phone has no character yet' };
        const map = live(); if (!map) return { ok: false, error: 'Nothing is on the table' };
        const t = p.tokenId ? map.layers.find((l) => l.id === p.tokenId && l.role === 'token') : null;
        M(dev).handed = t ? { mapId: map.id, id: t.id } : null;
        return { ok: true };
      }
      case 'carry': { // (Prototype 17: the light belongs to the character)
        if (!dev || !dev.char) return { ok: false, error: 'No such phone' };
        return o.charSet(dev.char, { carry: CARRIES.includes(p.carry) ? p.carry : 'none' });
      }
      case 'again': groupN += 1; return { ok: true }; // (Prototype 8) everyone's movement again
      // Prototype 14: from a player token's right-click menu: its eye on or off, the light it carries, a fresh turn
      case 'eye': { // (Prototype 17: per character, kept by main.js)
        const name = String(p.name || ''); if (!name) return { ok: false };
        return o.charSet(name, { eye: !!p.on });
      }
      case 'carryChar': return o.charSet(String(p.name || ''), { carry: CARRIES.includes(p.carry) ? p.carry : 'none' });
      case 'resetChar': { // Prototype 17: the player menu: this character's movement again
        const name = String(p.name || ''); if (!name) return { ok: false };
        const m = T(name); m.used = 0; m.dashed = false; m.extra = []; m.restUntil = 0; m.diag = 0; m.trail = null;
        return { ok: true };
      }
      case 'reset': { // the turn's movement again (the DM gave a free Dash, say)
        if (!dev) return { ok: false, error: 'No such phone' };
        if (dev.char) { const m = T(dev.char); m.used = 0; m.dashed = false; m.extra = []; m.restUntil = 0; m.diag = 0; m.trail = null; }
        return { ok: true };
      }
      default: return { ok: false };
    }
  }
  function follow() {} // (Prototype 17: main.js keeps every player token's eye)

  // Prototype 6: the squares walked this turn, for the TV and the GM's map: [{ mapId, id (token), color, total, pts: [{ x, y, ft }] }]
  // (gone when the turn is over: only the turn that is running has one; while the whole group moves, everyone has one)
  function trails() {
    if (!opt().on || !opt().trace) return [];
    const F = round();
    if (!F) return [];
    const out = [];
    for (const name of F.pcs) {
      const t = turns.get(name);
      if (!t || t.turnKey !== F.key || !t.trail || t.trail.pts.length < 2) continue;
      out.push({ mapId: t.trail.mapId, id: t.trail.id, color: (o.charOf(name) || {}).color || null, total: t.used, pts: t.trail.pts });
    }
    return out;
  }

  return { run, forPhone, view, action, follow, trails, heldBy, OPS, DEFAULTS };
}

module.exports = { create, OPS, DEFAULTS };
