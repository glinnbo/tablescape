'use strict';

const { app, BrowserWindow, ipcMain, screen, dialog, shell, Menu, powerSaveBlocker, clipboard, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const library = require('./library');
const mapstate = require('./mapstate');
const WallsImport = require('./walls-import');
const { CampaignStore, readJson, writeJson, hydrateMap } = require('./campaigns');
const applog = require('./applog');
const backups = require('./backups');
const missing = require('./missing');
const animCache = require('./anim-cache');
const Moments = require('./renderer/moments');
const SpotifyLink = require('./spotify');
const createRoomLights = require('./roomlights');
const createRemote = require('./remote');
const createPlayers = require('./players').create; // Prototype 1: the players move their tokens from their phones
const Transfer = require('./transfer');
const FXDATA = require('./renderer/fx-data');
const PKG = require('../package.json');
const LABEL = PKG.releaseLabel || PKG.version; // "Alpha 1.0"
const ICON = path.join(__dirname, 'icon.png');

// Self-test runs fully isolated: its own settings, campaigns and library.
const TEST_DIR = process.env.TS_TEST_DIR ? path.resolve(process.env.TS_TEST_DIR) : null;
if (TEST_DIR) app.setPath('userData', path.join(TEST_DIR, 'userData'));
if (!TEST_DIR && !app.requestSingleInstanceLock()) app.exit(0);

const PRELOAD = path.join(__dirname, 'preload.js');
const PAGE = path.join(__dirname, 'renderer', 'index.html');
const SOUND_PAGE = path.join(__dirname, 'renderer', 'sound.html');
const DEMO_DIR = app.isPackaged ? path.join(process.resourcesPath, 'demo') : path.join(__dirname, '..', 'demo');
// Beta 3.1: the demo a new user finds: Glinn's campaign, made with scripts/make_demo_package.py from his export
const DEMO_PKG = path.join(DEMO_DIR, 'Demo.tablescape');
const MEM_GB = Math.round((require('os').totalmem() / 2 ** 30) * 10) / 10;
const CARD_W_IN = 3.370; // ISO/IEC 7810 ID-1 card (bank card), used for calibration

let gm = null;
let player = null;
let soundWin = null; // hidden, its own process: plays everything the table hears (sound-engine.js)
let playerOnDisplay = null;
let previewTimer = null;
let preview = { width: 320, fast: false }; // the picture of the TV on the GM's screen: bigger and quicker while the big preview is open
let hudSampleTimer = null;
const store = new CampaignStore();
// Beta 1: a save that failed is said on the GM screen (once a minute), not only in the log
let saveErrorAt = 0;
store.onSaveError = (err) => {
  if (Date.now() - saveErrorAt < 60e3) return;
  saveErrorAt = Date.now();
  const why = /ENOSPC/.test(String(err && err.code)) ? 'the disk is full' : /EPERM|EACCES|EBUSY/.test(String(err && err.code)) ? 'the library folder is not writable (a sync tool or an antivirus may hold the file)' : (err && err.message) || 'unknown reason';
  sendEvent({ kind: 'toast', text: `Saving the campaign failed: ${why}. Changes stay in memory; it is tried again with the next change.`, level: 'error', ms: 15000 });
};
const trash = new Map(); // undo tokens for deleted campaigns
let settings = {
  playerDisplayId: null, diagonal: 43, ppi: null, lastCampaignId: null, demoCreated: false, migrated01: false, sfxOn: true, sfxVolume: 0.7, burstSeconds: 8, sfxMap: {},
  seats: 'both', // players on 'both' long sides of the TV, or on 'one'
  handout: { size: 1, pos: 0.5, log: true }, // Prototype 25: a handout's size (0.4 to 1) and where it lies along the TV (0 left end to 1 right end); "shown" lines in the session log
  talk: { size: 0.34, anchor: 'right', blur: 0.5 }, portraitMirror: {}, portraitSize: {}, portraitOffset: {}, // (Prototype 12: path → its size in Talk, 1 = as the others; 13: its offset { x, y }, share of its width / height) boardVolume: 0.8, weatherPresets: [],
  players: {}, // Prototype 1: moving tokens by phone (players.js DEFAULTS fill the rest)
  hudScale: 1, // size of text and panels on the TV (round, countdowns, turn order, markers) — not of the map
  uiScale: 1, // 4.0.1: size of everything in the GM window (small laptop screens); the TV is not touched
  roundPos: { x: 0.07, y: 0.07 }, roundSize: 1.4, roundBanner: true, // the round on the TV: where (near copy), how big, announced
  mapTransition: 'ink', // a new map on the table: 'ink' (an ink brush sweeps over), 'fade'; 4.4: 'smoke', 'parchment', 'embers'
  quality: 'high', // effects quality: 'high' | 'medium' | 'low' (fewer particles, lighter layers, still videos on the GM screen)
  gmAnim: 'light', // 2.3: animated assets on the GM screen: 'smooth' | 'light' (about 12 frames a second) | 'still'
  gmFx: 'light', // Prototype 19: effects, weather and flickering light on the GM screen: the same three
  animDraw: 'cpu', // 2.5: baked animations drawn by the graphics card ('gpu') or the processor ('cpu'). Beta 1: the processor, which stayed smooth with many animations where the graphics card stuttered
  tips: {}, tipsHidden: false, // first steps on the start screen: { tv, calib, sent } done
  soundOut: '', soundOutLabel: '', // where the ambience and music play ('' = the system's default output)
  fxOut: null, fxOutLabel: '', // where the effects play (soundboard, spells, thunder, countdown); null = with the ambience
  duck: true, // the ambience dips while a soundboard, spell or thunder sound plays
  fightAuto: true, // fight music starts with a fight (Initiative) and ends with it
  picture: {}, // per TV (tvKey): { brightness, contrast, gamma, saturation, warmth, black }
  fpsWatch: true, // ask to lower the effects when the TV stutters
  mapQuality: {}, // map id -> 'medium' | 'low': lower effects for that map (remembered when the TV stuttered on it)
  momentStars: ['earthquake', 'explosion', 'blood', 'gas'], // starred moments: on top, and on Shift + 1 to 9
  momentSounds: {}, // moment id -> a sound file, or 'none' (else a matching sound from Audio/SFX, or the built-in one)
  // Spotify as a remote: moods (Tablescape's own little playlists), the device it plays on, how loud,
  // how the ambience dips under it, fade seconds
  spotify: { moods: [], device: '', deviceName: '', volume: null, duck: 0.4, fade: 2 },
  // 4.10: Options → Tokens (tokenLook() below): picture size per 5e size, the GM's toolbar and selection ring,
  // the name tags, numbers, turn glow and shadows on the TV, snapping to the grid
  tokens: {},
};
const TOKEN_PIC = { tiny: 1.2, medium: 1.3, large: 1.15, huge: 1.1, garg: 1.05 }; // (the same as Geom.PIC_DEFAULT)
function tokenLook(t = settings.tokens || {}) {
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const pic = {};
  for (const [k, d] of Object.entries(TOKEN_PIC)) pic[k] = Math.round(num((t.pic || {})[k], 0.5, 2, d) * 100) / 100;
  return {
    pic,
    card: ['compact', 'floating', 'docked'].includes(t.card) ? t.card : 'compact',
    ring: t.ring === 'glow' ? 'glow' : 'thin',
    tagSize: Math.round(num(t.tagSize, 0.5, 2.5, 1) * 100) / 100,
    numbers: t.numbers !== false, turnGlow: t.turnGlow !== false, shadow: !!t.shadow, snap: t.snap !== false,
  };
}

const state = {
  update: { status: 'off' }, // Prototype 20: updates from GitHub (setupUpdates)
  screen: 'home', // 'home' | 'campaign' (the campaign's page) | 'play'
  session: null, // a session started from the campaign page: { started }
  title: null, // the session's title screen on the TV: { id, title, sub, pic }; it gives way to the first map sent
  editMapId: null,
  liveMapId: null,
  blackout: false,
  blackoutPreview: false, // the blackout is only the campaign page trying it out
  calibrating: false,
  // countdown on the TV: { id, mode: 'normal' | 'dramatic', total (s), endsAt (ms) or null while paused, left (ms, paused), label, sound }
  timer: null,
  talk: null, // { id, cast: [{ path, url, name, alpha }] } NPC portraits rising out of an ink band
  show: null, // Beta 3.2: tokens shown to the table (showNext, table-show.js)
  handouts: [], // Prototype 26: [{ path, url, name, t }] shown large over a blurred map, several at once
  join: null, // Prototype 1: the players' QR code on the TV: { svg, url, until }
  calib: false, // Prototype 2: the TV's top edge glows while a phone finds its seat
  brk: null, // break screen: { endsAt, total }
  init: null, // initiative: { mapId, running, turn, show, entries, groups, dropped } (see initInfo)
  hudSampleUntil: 0, // while the GM changes the HUD size, the TV shows a sample
  quiet: false, // all table sound faded out (the Quiet button under the table preview)
  fightNow: false, // fight music started by hand (Sound → Fight music → Play now)
  testPicture: false, // Options → Picture: on the TV, false | 'pattern' (grey steps, colours) | 'reference' (a picture with real maps)
  moments: [], // screen moments playing on the TV: { key, id, seed, x, y, mapId, t0, dur, stop } (moments.js)
  dice: null, // a roll on the TV (dice-fx.js): { id, kind: 'dice' | 'wheel' | 'death', t0, dur, ... }
  diceLog: [], // this session's rolls, newest first (the Dice panel)
};

const userFile = (name) => path.join(app.getPath('userData'), name);
function saveSettings() { writeJson(userFile('settings.json'), settings); }
let sizeSaveT = null; // (Prototype 12: Talk sizes, saved once the slider rests)

// 4.11.3: how videos (an animated map, overlays) reach the screen on Windows. Chromium hands a playing video to the
// graphics card's own overlay plane (Windows MPO); with things lying over the video (Talk's portraits and ink) some
// cards and TVs then flicker in black bars. Read before the app starts, so a change needs a restart.
//   'noOverlay' (default): videos are drawn with the rest of the picture; 'normal': the overlay; 'noDcomp': no
//   DirectComposition at all (the last resort)
const VIDEO_PATHS = ['noOverlay', 'normal', 'noDcomp'];
const VIDEO_PATH_NOW = (() => {
  let v = 'noOverlay';
  try { const s = JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')); if (VIDEO_PATHS.includes(s.videoPath)) v = s.videoPath; } catch {}
  if (process.platform === 'win32') {
    if (v === 'noOverlay') app.commandLine.appendSwitch('disable_direct_composition_video_overlays', '1');
    if (v === 'noDcomp') app.commandLine.appendSwitch('disable-direct-composition');
  }
  return v;
})();

// =====================================================================
// Displays and physical size
// =====================================================================
function gmDisplay() { return gm ? screen.getDisplayMatching(gm.getBounds()) : screen.getPrimaryDisplay(); }
function targetDisplay() {
  const all = screen.getAllDisplays();
  const chosen = all.find((d) => d.id === settings.playerDisplayId);
  if (chosen) return chosen;
  const g = gmDisplay();
  return all.find((d) => d.id !== g.id) || g;
}
function isWindowed(d) { return d.id === gmDisplay().id; }

// a TV is remembered by its name and size (its picture settings go with it)
const tvKeyOf = (d, windowed) => (windowed ? 'window' : `${d.label || 'Display'}|${d.size.width}x${d.size.height}`);
function view() {
  const d = targetDisplay();
  const windowed = isWindowed(d);
  const world = windowed ? { w: 1920, h: 1080 } : { w: d.size.width, h: d.size.height };
  const ppi = settings.ppi || Math.hypot(world.w, world.h) / Math.max(1, settings.diagonal);
  const g = gmDisplay();
  return {
    world,
    ppi,
    inches: { w: world.w / ppi, h: world.h / ppi },
    diagonal: settings.diagonal,
    calibrated: !!settings.ppi,
    windowed,
    playerOpen: !!player,
    playerDisplayId: d.id,
    tvKey: tvKeyOf(d, windowed),
    hz: Math.round(d.displayFrequency || 60) || 60, // the TV's refresh rate (frames a second it can show)
    dpr: d.scaleFactor || 1, // screen pixels per window pixel (a 4K TV at 200 %: 2)
    memGB: MEM_GB, // Beta 1: the computer's memory, for the windows' ceiling on kept animation frames (anim.js)
    displays: screen.getAllDisplays().map((x, i) => ({
      id: x.id,
      name: `${x.label || `Display ${i + 1}`} (${x.size.width}×${x.size.height})${x.id === g.id ? ' – this screen' : ''}`,
    })),
    libraryRoot: library.root,
  };
}

// =====================================================================
// State broadcasting
// =====================================================================
const fogRev = new Map();
const fogSent = new WeakMap(); // window -> Map(mapId -> rev)
const bumpFog = (id) => fogRev.set(id, (fogRev.get(id) || 0) + 1);

// Fog can be large; only resend it to a window when it changed.
function forWindow(win, map) {
  if (!map) return null;
  if (!fogSent.has(win)) fogSent.set(win, new Map());
  const sent = fogSent.get(win);
  const rev = fogRev.get(map.id) || 0;
  const { snaps, ...m } = map; // the windows draw the map; its snapshots go to the GM in the campaign summary
  if (sent.get(map.id) === rev) { const { fog, ...rest } = m; return { ...rest, fogOn: !!fog.enabled }; } // on or off travels without the fog
  sent.set(map.id, rev);
  return m;
}

// Prototype 25: the Handouts tool. The ones shown this session are kept at hand, and the session log gets a line for
// each. Prototype 26: several at once; each handout remembers how it lies (settings.handoutLayout, by its place in the
// library): a copy for each long side or one copy placed freely, its size and turn. A handout can be marked for the
// players' phones (meta.handoutShare): everyone or single players; it reaches them once it was shown, or at once.
function handoutPrefs() {
  const h = settings.handout || {};
  return { size: Math.min(1, Math.max(0.4, Number(h.size) || 1)), pos: Number.isFinite(Number(h.pos)) ? Math.min(1, Math.max(0, Number(h.pos))) : 0.5, log: h.log !== false };
}
const hoKey = (p) => { const r = library.toRef(p) || {}; return r.rel || String(p || ''); };
const unit = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
// how a handout lies: { both, x, y, size, rot }; placed: the DM gave it a place (otherwise the ones shown lie side by side)
function hoLayout(p) {
  const L = (settings.handoutLayout || {})[hoKey(p)] || {};
  const pr = handoutPrefs();
  return {
    both: L.both !== false, x: unit(L.x, pr.pos), y: unit(L.y, 0.5), placed: Number.isFinite(Number(L.x)),
    size: Math.min(1, Math.max(0.2, Number(L.size) || pr.size)), rot: ((Math.round((Number(L.rot) || 0) / 90) * 90) % 360 + 360) % 360,
  };
}
function handoutsInfo() {
  const list = (state.handouts || []).map((h) => ({ ...h, ...hoLayout(h.path) }));
  // the ones without a place of their own share the TV's length, side by side
  const loose = list.filter((h) => !h.placed);
  if (list.length > 1) loose.forEach((h, i) => { h.x = (i + 0.5) / loose.length; h.y = 0.5; h.share = loose.length; });
  return list;
}
// (the newest one alone, as before Prototype 26: for what still reads one handout)
function handoutInfo() { const l = handoutsInfo(); return l.length ? { ...handoutPrefs(), ...l[l.length - 1] } : null; }
const hoShown = (p) => (state.handouts || []).some((h) => h.path === p);
const hoShares = () => (store.cur ? (store.cur.meta.handoutShare || {}) : {});
// for the GM screen: [{ path, name, to: 'all' | [names], sent }]
function hoShareList() {
  return Object.entries(hoShares()).map(([k, v]) => { const p = library.resolveRef({ rel: k, path: k }); return { key: k, path: p, name: p ? path.parse(p).name : k, to: v.to, sent: v.sent || 0 }; });
}
// what one player's phone may look at: marked for everyone or for this player's character, and shown or sent already
function handoutsFor(dev) {
  const me = dev && dev.char;
  return hoShareList().filter((x) => x.sent && x.path && fs.existsSync(x.path) && (x.to === 'all' || (me && Array.isArray(x.to) && x.to.includes(me))))
    .sort((a, b) => b.sent - a.sent).slice(0, 24).map((x) => ({ name: x.name, url: Remote ? Remote.faceUrl(x.path) : null }));
}
function handoutShown(m) {
  state.handoutSeen = [{ path: m.path, name: m.name, kind: library.kindOf(m.path) || 'image' }, ...(state.handoutSeen || []).filter((x) => x.path !== m.path)].slice(0, 12);
  const sh = hoShares()[hoKey(m.path)];
  if (sh && !sh.sent) { sh.sent = Date.now(); store.touch(); } // (marked for the phones: it reaches them now)
  if (!handoutPrefs().log || !store.cur) return;
  const n = store.cur.meta.notes || {};
  const text = String(n.text || '');
  const line = `[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] Handout shown: ${m.name}`;
  if (text.split('\n').slice(-3).some((l) => l.endsWith(`Handout shown: ${m.name}`))) return; // (shown again right away: one line)
  store.cur.meta.notes = { ...n, text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`.slice(-500000), changed: Date.now() };
  store.touch();
}

function campaignSummary() {
  const c = store.cur;
  if (!c) return null;
  migrateTray(c); // (Prototype 26: a campaign saved with the old tray)
  return {
    id: c.meta.id,
    name: c.meta.name,
    opened: state.openedAt || 0, // changes with every opening (the GM screen checks for missing files then)
    folder: c.dir,
    chapters: c.meta.chapters.map((ch) => ({
      id: ch.id,
      name: ch.name,
      ambience: ch.ambience ? { name: ch.ambience.name, volume: ch.ambience.volume, missing: !!ch.ambience.missing } : null,
      fight: ch.fight ? { name: ch.fight.name, volume: ch.fight.volume, missing: !!ch.fight.missing } : null,
      fightMood: ch.fightMood || null,
      ready: Object.fromEntries(READY_KINDS.map((k) => [k, readyOf(ch, k)])), // 2.2: what the GM wants at hand in this chapter (Prototype 26: anything from the library)
      maps: ch.maps.map((id) => {
        const m = c.maps.get(id);
        return { id, name: m.name, bgPath: m.bg ? m.bg.path : null, bgKind: m.bg ? m.bg.kind : null, missing: !!(m.bg && m.bg.missing), fog: m.fog.enabled, snaps: snapList(m), broken: !!m.broken };
      }),
    })),
    party: c.meta.party || [],
    away: (c.meta.away || []).filter((n) => (c.meta.party || []).includes(n)), // players not here today (not in Initiative)
    lastSession: c.meta.lastSession || 0,
    session: state.session,
    screens: screensSummary(),
    cues: cueList().map(cueSummary),
    wheels: wheelList(),
    hotbar: hotbarInfo(c),
    foes: (c.meta.foes || []).slice(0, 40), // enemies the turn order remembers: { name, bonus, ac, hp }
    // the GM's notes for the session (Toolbox → Notes); dirty: changed since they were last exported
    notes: notesInfo(c),
    tray: [], // (Prototype 26: the tray became the chapter's Ready list)
  };
}

// a chapter's Ready list: library references, resolved. Prototype 26: one list per chapter for anything from the
// library, kept by kind (tokens, portraits, handouts, and "other" for assets, overlays, sounds …)
const READY_KINDS = ['tokens', 'portraits', 'handouts', 'other'];
const readyKindOf = (cat) => (['tokens', 'portraits', 'handouts'].includes(cat) ? cat : 'other');
function readyOf(ch, kind) {
  return ((ch.ready && ch.ready[kind]) || []).map((r) => {
    const p = library.resolveRef(r);
    const k = library.kindOf(p) || 'image';
    return { path: p, rel: r.rel || null, name: r.name, kind: k, cat: r.rel ? library.categoryOf(r.rel, k) : kind === 'other' ? 'assets' : kind, missing: !p || !fs.existsSync(p) };
  });
}
// the old "Tonight" tray (one per campaign) moves to the first chapter's Ready list, once
function migrateTray(c) {
  const tray = c && c.meta && c.meta.tray;
  if (!tray || !tray.length || !c.meta.chapters.length) return;
  const ch = c.meta.chapters[0];
  ch.ready = { ...Object.fromEntries(READY_KINDS.map((k) => [k, []])), ...(ch.ready || {}) };
  for (const r of tray) {
    const p = library.resolveRef(r);
    const rel = r.rel || (p ? (library.toRef(p) || {}).rel : null); // (a thing kept by its path alone still finds its kind)
    const kind = readyKindOf(rel ? library.categoryOf(rel, library.kindOf(p)) : r.cat || 'tokens');
    const key = (x) => x.rel || x.path;
    if (!ch.ready[kind].some((x) => key(x) === (rel || r.path))) ch.ready[kind].push({ path: r.path, rel: rel || null, name: r.name || (p ? path.parse(p).name : '') });
  }
  c.meta.tray = [];
  store.touch();
  applog.log.info(`ready: ${tray.length} from the Tonight tray moved to the Ready list of ${ch.name}`);
}
// ---------- the hotbar: what's on it, files kept as library references ----------
const HOTBAR_SIZE = 30;
const HOT_KINDS = ['token', 'asset', 'portrait', 'handout', 'overlay', 'sound', 'mood', 'moment', 'cue', 'wheel', 'roll', 'death', 'spell', 'weather', 'light', 'map', 'panel', 'snap', 'fog', 'lights', 'volume', 'tool', 'do', 'door'];
const HOT_FILES = ['token', 'asset', 'portrait', 'handout', 'overlay', 'sound'];
function cleanHot(it) {
  if (!it || !HOT_KINDS.includes(it.kind)) return null;
  const out = { kind: it.kind, label: String(it.label || it.kind).slice(0, 40), icon: it.icon ? String(it.icon).slice(0, 40) : null };
  if (HOT_FILES.includes(it.kind)) {
    const ref = it.ref || {};
    if (!ref.path && !ref.rel) return null;
    const r = ref.path ? library.toRef(ref.path) : ref;
    out.ref = { path: r.path, rel: r.rel || null, name: r.name, kind: ref.kind || library.kindOf(r.path) || null, cat: ref.cat || null };
  } else {
    const raw = JSON.stringify(it.ref ?? null);
    out.ref = raw.length < 6000 ? JSON.parse(raw) : null;
  }
  return out;
}
function hotbarInfo(c) {
  const list = (c.meta.hotbar || []).slice(0, HOTBAR_SIZE);
  return list.map((it) => {
    if (!it) return null;
    if (HOT_FILES.includes(it.kind)) {
      const p = library.resolveRef(it.ref);
      return { ...it, ref: { ...it.ref, path: p }, missing: !p || !fs.existsSync(p) };
    }
    if (it.kind === 'map') return { ...it, missing: !c.maps.has(it.ref) };
    if (it.kind === 'wheel') return { ...it, missing: !wheelList().some((w) => w.id === it.ref) };
    if (it.kind === 'cue') return { ...it, missing: !cueList().some((q) => q.id === it.ref) };
    if (it.kind === 'snap' && it.ref !== 'next') return { ...it, missing: !findSnap(it.ref) };
    if (it.kind === 'lights' && !['follow', 'room', 'off', 'release', 'dim', 'bright'].includes(it.ref)) return { ...it, missing: !((settings.roomLights && settings.roomLights.scenes) || []).some((x) => x.id === it.ref) };
    if (it.kind === 'fog' && it.ref && typeof it.ref === 'object') { const m = c.maps.get(it.ref.map); return { ...it, missing: !(m && m.areas.some((a) => a.id === it.ref.area)) }; }
    if (it.kind === 'door') { const m = it.ref && c.maps.get(it.ref.map); return { ...it, missing: !(m && (m.walls || []).some((w) => w.id === it.ref.id && w.door)) }; } // Prototype 25
    return it;
  });
}

// ---------- Beta 4: phones and tablets (remote.js serves them; these say what they see and do) ----------
// 4.1: the DM's phone is a Stream Deck arranged here at the PC (Toolbox → Phone & tablet → Arrange the deck): the turn
// order on top, a grid of buttons (your own, or the hotbar's slots), pages up and down. The player screen (a tablet,
// or a window on another screen of this PC) shows the party, and in a fight the turn order with pictures.
// Buttons are hotbar items; tokens, spells and panels need the mouse on the map (greyed "PC" on the phone).
const REMOTE_PC = (it) => ['token', 'asset', 'spell', 'tool'].includes(it.kind) || (it.kind === 'do' && /^(fit|sel-|page-)/.test(String(it.ref))) || (it.kind === 'fog' && typeof it.ref === 'string' && ['reveal', 'cover', 'brush', 'rect', 'room'].includes(it.ref));
const hotKey = (it) => `${it.kind}:${JSON.stringify(it.ref ?? null)}`;
const isSfxRef = (r) => /^Audio\/SFX\//i.test((r && r.rel) || '') || /\bsfx\b/i.test((r && (r.rel || r.path)) || '');
// what lights up on the phone (as hotLive in gm-play.js, for what a phone can press)
function remoteLive(it, L) {
  const r = it.ref;
  const m = store.cur ? store.map(state.editMapId) : null;
  switch (it.kind) {
    case 'portrait': return !!(state.talk && r && state.talk.cast.some((x) => x.path === r.path));
    case 'handout': return !!(r && hoShown(r.path));
    case 'overlay': return !!(m && r && m.layers.some((l) => l.role === 'overlay' && l.path === r.path));
    case 'sound': return !isSfxRef(r) && !!(m && r && m.layers.some((l) => l.role === 'audio' && l.path === r.path));
    case 'mood': return state.spotifyMood === r && !!(spotifyNow && spotifyNow.playing);
    case 'moment': { const now = Date.now(); return (state.moments || []).some((x) => x.id === r && !x.stop && Moments.alive(x, now)); }
    case 'weather': return !!(m && m.weather && m.weather.name === it.label && (m.weather.layers || []).some((l) => !l.dying));
    case 'light': return !!(m && m.light && m.light.mood === r);
    case 'map': return state.liveMapId === r;
    case 'door': { const dm = r && store.cur ? store.map(r.map) : null; const w = dm && (dm.walls || []).find((x) => x.id === r.id); return !!(w && w.open); }
    case 'do': return r === 'blackout' ? !!state.blackout : r === 'quiet' ? !!state.quiet : r === 'fight' ? !!state.fightNow : r === 'grid' ? !!(m && m.grid && m.grid.show) : false; // Prototype 24
    case 'lights': if (!L || !L.started) return false; return ['follow', 'room', 'off', 'release'].includes(r) ? L.mode === r : L.mode === 'scene' && L.sceneId === r;
    case 'snap': { const lm = store.cur ? store.map(state.liveMapId) : null; return r !== 'next' && !!(lm && lm.snapAt === r); }
    case 'fog': return r === 'toggle' && !!(m && m.fog && m.fog.enabled);
    default: return false;
  }
}
// still there? (the deck is the same for every campaign: a map of another campaign is not)
function remoteMissing(it) {
  const c = store.cur;
  const r = it.ref;
  switch (it.kind) {
    case 'map': return !(c && c.maps.has(r));
    case 'snap': return r !== 'next' && !findSnap(r);
    case 'cue': return !cueList().some((q) => q.id === r);
    case 'wheel': return !wheelList().some((w) => w.id === r);
    case 'fog': if (r && typeof r === 'object') { const m = c && c.maps.get(r.map); return !(m && (m.areas || []).some((x) => x.id === r.area)); } return false;
    case 'mood': return !((settings.spotify && settings.spotify.moods) || []).some((m) => m.id === r);
    case 'lights': return !['follow', 'room', 'off', 'release'].includes(r) && !((settings.roomLights && settings.roomLights.scenes) || []).some((x) => x.id === r);
    default: if (HOT_FILES.includes(it.kind)) { const f = library.resolveRef(it.ref); return !f || !fs.existsSync(f); } return false;
  }
}

// the deck: how the DM's phone looks (one for every device and campaign)
// 4.2.1: presets are as they are (only lines of buttons added or taken away); one Custom does anything
const DECK_PRESETS = [
  { id: 'turn12', for: 'phone', label: 'Turn order + buttons', top: 'turn', info: false, source: 'custom', cols: 6, rows: 2 },
  { id: 'turnHotbar', for: 'phone', label: 'Turn order + your hotbar', top: 'turn', info: false, source: 'hotbar', cols: 5, rows: 2 },
  { id: 'grid18', for: 'phone', label: 'Only buttons', top: 'none', info: false, source: 'custom', cols: 6, rows: 3 },
  { id: 'infoHotbar', for: 'tablet', label: 'Players + your hotbar', top: 'turn', info: true, source: 'hotbar', cols: 5, rows: 2 },
  { id: 'info12', for: 'tablet', label: 'Players + buttons', top: 'turn', info: true, source: 'custom', cols: 6, rows: 2 },
];
const DECK_CUSTOM = { cols: [2, 12], rows: [1, 8] };
// which deck a device shows: as chosen in the device list, else by its size (a tablet the tablet's)
const deckOf = (dev) => (dev && (dev.deck === 'phone' || dev.deck === 'tablet') ? dev.deck : dev && dev.kind === 'tablet' ? 'tablet' : 'phone');
function deckStarter() { // a new deck's first page: what a fight wants
  const mo = (id) => { const d = Moments.BY[id]; return d ? { kind: 'moment', ref: id, label: d.label, icon: d.icon } : null; };
  const li = (id) => { const d = FXDATA.MOODS.find((x) => x.id === id); return d ? { kind: 'light', ref: id, label: d.label, icon: d.icon } : null; };
  const wx = (id) => { const w = FXDATA.WEATHER.find((x) => x.id === id); return w ? { kind: 'weather', ref: w.layers, label: w.label, icon: w.icon } : null; };
  return [mo('lightning'), mo('explosion'), mo('blood'), mo('nat20'), mo('holy'), mo('teleport'), li('day'), li('dusk'), li('night'), li('cave'), wx('rain'), wx('storm')];
}
// (4.2.3) a button may have a colour of its own (its square tinted on the phone)
const deckColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : null);
const deckItem = (it) => { const x = it && it.kind ? cleanHot(it) : null; if (!x) return null; const color = deckColor(it.color); return { kind: x.kind, label: x.label, icon: x.icon, ref: x.ref, ...(color ? { color } : {}) }; };
// a deck as it may be kept: sizes within limits; other sizes flow the buttons in their order onto the new pages
function deckFix(d0) {
  const d = d0 && typeof d0 === 'object' ? d0 : {};
  const pr = DECK_PRESETS.find((x) => x.id === d.preset);
  const lim = (v, [a, b], def) => Math.min(b, Math.max(a, Math.round(Number(v)) || def));
  // a preset: its look, only the number of lines of your own buttons may differ; Custom: within wide limits
  const cols = pr ? pr.cols : lim(d.cols, DECK_CUSTOM.cols, 6);
  const rows = pr ? (pr.source === 'hotbar' ? pr.rows : lim(d.rows, [1, 6], pr.rows)) : lim(d.rows, DECK_CUSTOM.rows, 2);
  const n = cols * rows;
  const given = (Array.isArray(d.pages) ? d.pages : []).filter(Array.isArray);
  let pages;
  if (given.length && given.every((pg) => pg.length === n)) pages = given.map((pg) => pg.map(deckItem));
  else {
    const flat = given.flat();
    pages = [];
    for (let i = 0; i < Math.max(flat.length, 1); i += n) pages.push(Array.from({ length: n }, (_, k) => deckItem(flat[i + k])));
    while (pages.length > 1 && pages[pages.length - 1].every((x) => !x)) pages.pop();
  }
  const look = pr || { top: d.top === 'none' ? 'none' : 'turn', info: !!d.info, source: d.source === 'hotbar' ? 'hotbar' : 'custom' };
  const custom = d.custom && typeof d.custom === 'object' ? { top: d.custom.top === 'none' ? 'none' : 'turn', info: !!d.custom.info, source: d.custom.source === 'hotbar' ? 'hotbar' : 'custom', cols: lim(d.custom.cols, DECK_CUSTOM.cols, 6), rows: lim(d.custom.rows, DECK_CUSTOM.rows, 2) } : null;
  return { preset: pr ? pr.id : 'custom', top: look.top, info: look.info, source: look.source, cols, rows, pages: pages.slice(0, Math.max(20, Math.ceil((DECK_CUSTOM.cols[1] * DECK_CUSTOM.rows[1] * 20) / n))), custom: pr ? custom : { top: look.top, info: look.info, source: look.source, cols, rows } };
}
function remoteDeckView(hot, which) {
  const D = settings.remote.decks[which];
  const look = (it) => (it ? { kind: it.kind, label: it.label, icon: it.icon || null, ref: it.ref ?? null, color: deckColor(it.color), missing: !!it.missing || remoteMissing(it), pc: REMOTE_PC(it) } : null);
  if (D.source === 'hotbar') {
    const pages = [0, 1, 2].map((p) => Array.from({ length: 10 }, (_, i) => hot[p * 10 + i] || null)).filter((pg, i) => i === 0 || pg.some(Boolean));
    return { top: D.top, info: D.info, source: 'hotbar', cols: 5, rows: 2, pages: pages.map((pg) => pg.map(look)) };
  }
  return { top: D.top, info: D.info, source: 'custom', cols: D.cols, rows: D.rows, pages: D.pages.map((pg) => pg.map(look)) };
}

// faces for the turn order: a player's chosen portrait, the token on the map, a library portrait of that name
const FACE_IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
const faceNorm = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/\b(portrait|token|pc|art|face)\b/g, ' ').replace(/[^a-z0-9]+/g, '').replace(/\d+$/, '');
let portraitIdx = { at: 0, map: new Map(), busy: false };
// (4.2.2) the library's portraits and tokens by name: looked through in the background (only names, no thumbnails),
// at most every 5 minutes; until then the last list
async function buildPortraitIndex() {
  if (portraitIdx.busy) return;
  portraitIdx.busy = true;
  const first = !portraitIdx.at;
  const map = new Map(); const ranks = new Map();
  try {
    const root = library.root;
    const walk = async (dir, depth) => {
      if (depth > 6) return;
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!(depth === 0 && e.name === 'Campaigns')) await walk(full, depth + 1); continue; }
        if (!FACE_IMG.test(e.name) || library.kindOf(e.name) !== 'image') continue;
        const cat = library.categoryOf(path.relative(root, full).split(path.sep).join('/'), 'image');
        if (cat !== 'portraits' && cat !== 'tokens' && cat !== 'party') continue;
        const k = faceNorm(path.parse(e.name).name);
        const rank = { party: 3, portraits: 2, tokens: 1 }[cat]; // 4.7: the Party folder wins
        if (k && (!map.has(k) || rank > (ranks.get(k) || 0))) { map.set(k, full); ranks.set(k, rank); }
      }
    };
    if (root) await walk(root, 0);
  } catch {}
  portraitIdx = { at: library.root ? Date.now() : 0, map, busy: false }; // (no library yet: again on the next ask)
  if (first && map.size) broadcastGm();
}
function portraitIndex() {
  if (Date.now() - portraitIdx.at > 300000) buildPortraitIndex();
  return portraitIdx.map;
}
// ---------- 4.2: the characters (campaign page → Players → the card of each one) ----------
// meta.characters[name]: player, portrait / sprite / token (library refs), color, init, pp, ins, inv, dark, senses,
// languages, notes; live: insp, exh (0–6), ds { s, f }. AC and max HP stay in meta.pcStats (the turn order keeps them).
const charOf = (name) => ((store.cur && store.cur.meta.characters) || {})[name] || null;
const CHAR_TEXT = { player: 40, senses: 200, languages: 200, notes: 4000 };
const CHAR_NUM = { init: [-10, 20], pp: [0, 40], ins: [0, 40], inv: [0, 40], dark: [0, 300], exh: [0, 6], speed: [5, 120] };
let charFileCache = { at: 0, map: new Map() };
function charFile(ref) { // a picture of a character, if it is (still) there; looked up at most every few seconds
  if (!ref) return null;
  if (Date.now() - charFileCache.at > 4000) charFileCache = { at: Date.now(), map: new Map() };
  const k = JSON.stringify(ref);
  if (!charFileCache.map.has(k)) { const f = library.resolveRef(ref); charFileCache.map.set(k, f && fs.existsSync(f) ? f : null); }
  return charFileCache.map.get(k);
}
function charPortrait(name) {
  const c = store.cur;
  const ch = charOf(name);
  return charFile(ch && ch.portrait) || charFile(c && c.meta.faces && c.meta.faces[name]) || null; // (4.1 kept them in meta.faces)
}
// (4.2.2) the one face of a player (the cards, the turn strip, the player screen alike): portrait, Talk sprite, a library
// portrait of that name, the card's token
function charFace(name) {
  const ch = charOf(name) || {};
  return charPortrait(name) || charFile(ch.sprite) || portraitIndex().get(faceNorm(name)) || charFile(ch.token) || null;
}
// a token on the map that is a character's token (same picture as on its card): it belongs to that player
// Prototype 17: a player token: one with a party character's picture, one the DM made a player's ("Make this a player
// token": a familiar, a summon), or one a phone holds. player: false on a token: not a player token after all.
function playerTokOwner(t) {
  if (!t || t.role !== 'token' || t.player === false) return null;
  const party = (store.cur && store.cur.meta.party) || [];
  if (typeof t.player === 'string' && party.includes(t.player)) return t.player;
  return charTokOwner(t, true);
}
function playerOf(mapId, t) {
  const own = playerTokOwner(t);
  if (own || !t || t.player === false) return own;
  return Players && Players.heldBy ? Players.heldBy(mapId, t.id) : null;
}
// what a player's token sees and carries: per character, for the whole campaign (the phone and the DM set the same)
const CARRY_KEYS = ['none', 'candle', 'torch', 'lantern', 'light', 'daylight', 'custom'];
function sightOf(name) {
  const ch = charOf(name) || {};
  const legacyOff = ch.eye == null && ((settings.players && settings.players.noEye) || []).includes(name); // (Prototype 14's list)
  return {
    eye: ch.eye === false ? false : !legacyOff, carry: CARRY_KEYS.includes(ch.carry) ? ch.carry : 'none',
    bright: Number(ch.bright) >= 0 ? Number(ch.bright) : 20, dim: Number(ch.dim) >= 0 ? Number(ch.dim) : 40,
    dark: Number(ch.dark) > 0 ? Number(ch.dark) : 0, sight: Number(ch.sight) > 0 ? Number(ch.sight) : 0,
  };
}
// every player token on the maps in view carries an eye (a party light: its sight, darkvision and light), kept in step
// with the character; the eyes of tokens that left, or of a player whose eye is off, go. Called from broadcast (cheap).
const EYE_COLOR = '#ffb45a';
const eyeSigs = new Map(); // mapId → what the eyes were last made for
function syncEyes() {
  if (!store.cur) return;
  for (const mapId of new Set([state.liveMapId, state.editMapId].filter(Boolean))) {
    const map = store.map(mapId);
    if (!map) continue;
    const want = [];
    for (const l of map.layers) { if (l.role !== 'token') continue; const name = playerOf(mapId, l); if (name) { const s0 = sightOf(name); if (s0.eye) want.push({ l, name, s: s0 }); } }
    const eyes = map.fx.filter((f) => f.eye);
    const sig = JSON.stringify([want.map((w) => [w.l.id, w.name, w.s]), eyes.map((f) => [f.id, f.attachTo, f.carry, f.darkvision, f.range, f.bright, f.dim])]);
    if (eyeSigs.get(mapId) === sig) continue;
    eyeSigs.set(mapId, sig);
    const base = { mapId, noHistory: true, final: true };
    const wantIds = new Set(want.map((w) => w.l.id));
    for (const f of eyes) if (!f.attachTo || !wantIds.has(f.attachTo) || eyes.some((g) => g !== f && g.attachTo === f.attachTo && eyes.indexOf(g) < eyes.indexOf(f))) handle('fx.remove', { ...base, id: f.id });
    for (const { l, s: st } of want) {
      const have = map.fx.find((f) => f.eye && f.attachTo === l.id) || map.fx.find((f) => f.kind === 'light' && f.preset === 'party' && f.attachTo === l.id);
      const light = st.carry === 'custom' ? { carry: 'custom', bright: Math.min(st.bright, st.dim), dim: Math.max(st.bright, st.dim) } : { carry: st.carry };
      const p = { ...light, darkvision: st.dark, range: st.sight };
      if (!have) { handle('fx.add', { ...base, kind: 'light', preset: 'party', attachTo: l.id, x: l.x, y: l.y, color: EYE_COLOR, byPhone: true, ...p }); continue; }
      const patch = {};
      if (have.carry !== p.carry || (p.carry === 'custom' && (have.bright !== p.bright || have.dim !== p.dim))) Object.assign(patch, light);
      if ((have.darkvision || 0) !== p.darkvision) patch.darkvision = p.darkvision;
      if ((have.range || 0) !== p.range) patch.range = p.range;
      if (have.color !== EYE_COLOR) patch.color = EYE_COLOR;
      if (!have.eye) patch.eye = true;
      if (Object.keys(patch).length) handle('fx.update', { ...base, id: have.id, ...patch });
    }
  }
}
// the player tokens of a map, for the GM screen: { tokenId: character }
function pcTokens(map) {
  const out = {};
  if (!map || !store.cur) return out;
  for (const l of map.layers) if (l.role === 'token') { const n = playerOf(map.id, l); if (n) out[l.id] = n; }
  return out;
}
function charTokOwner(t, awayToo = false) {
  const c = store.cur;
  if (!c || !t || !t.path) return null;
  const want = path.normalize(t.path).toLowerCase();
  const away = new Set(c.meta.away || []);
  for (const n of c.meta.party || []) {
    if (away.has(n) && !awayToo) continue;
    const f = charFile((charOf(n) || {}).token);
    if (f && path.normalize(f).toLowerCase() === want) return n;
  }
  return null;
}
// 4.7: the party's pictures (portrait, Talk sprite, map token) that are not in the library's Party folder yet
function partyLoose() {
  const c = store.cur;
  if (!c || !library.root) return [];
  const out = new Set();
  for (const n of c.meta.party || []) {
    const ch = charOf(n) || {};
    for (const ref of [ch.portrait, ch.sprite, ch.token, c.meta.faces && c.meta.faces[n]]) {
      const f = charFile(ref);
      if (!f) continue;
      const rel = path.relative(library.root, f).split(path.sep).join('/');
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.startsWith('Party/')) continue;
      out.add(f);
    }
  }
  return [...out];
}
// moves them into Party (a name of their own if one is taken) and points every use in this campaign at the new place
function partyGather() {
  const c = store.cur;
  const files = partyLoose();
  if (!c || !files.length) return { ok: true, moved: 0 };
  const dir = path.join(library.root, 'Party');
  fs.mkdirSync(dir, { recursive: true });
  const moved = new Map(); // old path (lower case) -> new path
  for (const f of files) {
    const p = path.parse(f);
    let to = path.join(dir, p.base);
    for (let i = 2; fs.existsSync(to); i++) to = path.join(dir, `${p.name} (${i})${p.ext}`);
    try { fs.renameSync(f, to); } catch { try { fs.copyFileSync(f, to); fs.unlinkSync(f); } catch (err) { applog.log.warn(`party: could not move ${f}: ${err.message}`); continue; } }
    moved.set(path.normalize(f).toLowerCase(), to);
  }
  const fix = (o) => {
    let hit = false;
    const walk = (x) => {
      if (Array.isArray(x)) { for (const y of x) walk(y); return; }
      if (!x || typeof x !== 'object') return;
      if (typeof x.rel === 'string' || typeof x.path === 'string') {
        const was = x.rel ? path.join(library.root, ...x.rel.split('/')) : x.path;
        const to = was && (moved.get(path.normalize(was).toLowerCase()) || (x.path && moved.get(path.normalize(x.path).toLowerCase())));
        if (to) { const r = library.toRef(to); x.path = r.path; if (r.rel) x.rel = r.rel; if ('url' in x) x.url = pathToFileURL(to).href; if ('missing' in x) x.missing = false; hit = true; }
      }
      for (const k of Object.keys(x)) if (x[k] && typeof x[k] === 'object') walk(x[k]);
    };
    walk(o);
    return hit;
  };
  if (fix(c.meta)) store.touch();
  for (const [id, m] of c.maps) if (fix(m)) store.touch(id);
  if (state.talk) fix(state.talk);
  charFileCache.at = 0; portraitIdx.at = 0;
  broadcast();
  applog.log.info(`party: ${moved.size} pictures moved into Party`);
  return { ok: true, moved: moved.size, failed: files.length - moved.size };
}
// everything about the party a GM screen shows (the Characters panel, the tablet), live from the turn order
function charCards(face = (f) => (f ? pathToFileURL(f).href : null)) {
  const c = store.cur;
  if (!c) return [];
  const away = new Set(c.meta.away || []);
  const I = state.init;
  const cols = initCols();
  const hpc = cols.find((x) => x.kind === 'hp'); const acc = cols.find((x) => x.kind === 'ac'); const cdc = cols.find((x) => x.kind === 'cond');
  return (c.meta.party || []).map((name) => {
    const ch = charOf(name) || {};
    const st = pcStats(name) || {};
    const e = I ? I.entries.find((x) => x.pc && x.name === name) : null;
    const hv = e && hpc ? e.vals[hpc.id] : null;
    const sprite = charFile(ch.sprite); const token = charFile(ch.token); const portrait = charPortrait(name);
    const pic = charFace(name);
    return {
      name, here: !away.has(name), player: ch.player || '', color: ch.color || null,
      face: face(pic), portrait: portrait ? { path: portrait, url: pathToFileURL(portrait).href } : null,
      sprite: sprite ? { path: sprite, url: pathToFileURL(sprite).href } : null, token: token ? { path: token, url: pathToFileURL(token).href } : null,
      ac: e && acc && e.vals[acc.id] != null ? e.vals[acc.id] : st.ac ?? null, maxHp: st.hp ?? null,
      hp: hv && (hv.cur != null || hv.max != null) ? { cur: hv.cur, max: hv.max } : null,
      init: ch.init ?? null, pp: ch.pp ?? null, ins: ch.ins ?? null, inv: ch.inv ?? null, dark: ch.dark ?? null,
      speed: ch.speed ?? null, moves: Array.isArray(ch.moves) ? ch.moves : [], // Prototype 8: for the phones
      ...(() => { const s0 = sightOf(name); return { eye: s0.eye, carry: s0.carry, bright: s0.bright, dim: s0.dim, sight: s0.sight }; })(), // Prototype 17
      senses: ch.senses || '', languages: ch.languages || '', notes: ch.notes || '',
      insp: !!ch.insp, exh: ch.exh || 0, ds: { s: (ch.ds && ch.ds.s) || 0, f: (ch.ds && ch.ds.f) || 0 },
      cond: e && cdc && Array.isArray(e.vals[cdc.id]) ? e.vals[cdc.id] : [], down: !!(hv && hv.cur != null && hv.cur <= 0), entry: e ? e.id : null,
    };
  });
}
// (4.2.2) a player renamed (Players, or the turn order): the card, the stats, the line in the turn order go along
function renamePc(from, to0) {
  const c = store.cur;
  const to = String(to0 || '').trim().slice(0, 40);
  if (!c || !from || !to || from === to || !(c.meta.party || []).includes(from)) return { ok: false };
  if ((c.meta.party || []).some((n) => n !== from && n.toLowerCase() === to.toLowerCase())) return { ok: false, error: `There is already a player called ${to}` };
  for (const k of ['characters', 'pcStats', 'faces']) {
    const o = c.meta[k];
    if (o && o[from]) { const n = { ...o, [to]: o[from] }; delete n[from]; c.meta[k] = n; }
  }
  c.meta.party = c.meta.party.map((n) => (n === from ? to : n));
  if (c.meta.away) c.meta.away = c.meta.away.map((n) => (n === from ? to : n));
  const I = state.init;
  if (I) {
    for (const e of I.entries) if (e.pc && e.name === from) e.name = to;
    I.dropped = (I.dropped || []).map((x) => (x === `pc:${from}` ? `pc:${to}` : x));
  }
  charFileCache.at = 0;
  store.touch();
  broadcast();
  return { ok: true };
}
function charSet(name, patch, liveOnly = false) {
  const c = store.cur;
  if (!c || !(c.meta.party || []).includes(name) || !patch || typeof patch !== 'object') return { ok: false };
  const ch = { ...(charOf(name) || {}) };
  const num = (v, [a, b]) => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : null; };
  if ('insp' in patch) ch.insp = !!patch.insp;
  if ('exh' in patch) ch.exh = num(patch.exh, CHAR_NUM.exh) || 0;
  if (patch.ds && typeof patch.ds === 'object') ch.ds = { s: num(patch.ds.s, [0, 3]) || 0, f: num(patch.ds.f, [0, 3]) || 0 };
  // Prototype 17: what their token sees and carries
  if ('eye' in patch) ch.eye = !!patch.eye;
  if ('carry' in patch) ch.carry = CARRY_KEYS.includes(patch.carry) ? patch.carry : 'none';
  if ('bright' in patch) ch.bright = num(patch.bright, [0, 120]) ?? 0;
  if ('dim' in patch) ch.dim = num(patch.dim, [0, 240]) ?? 0;
  if ('sight' in patch) ch.sight = num(patch.sight, [0, 600]) ?? 0;
  if ('darkvision' in patch) ch.dark = num(patch.darkvision, CHAR_NUM.dark);
  if (!liveOnly) {
    for (const [k, n] of Object.entries(CHAR_TEXT)) if (k in patch) ch[k] = String(patch[k] ?? '').slice(0, n);
    for (const k of ['pp', 'ins', 'inv', 'dark']) if (k in patch) ch[k] = num(patch[k], CHAR_NUM[k]);
    // Prototype 8: movement for the phones: the speed, and extra moves (a name, feet once a turn; no feet: the speed again)
    if ('speed' in patch) { const v = num(patch.speed, CHAR_NUM.speed); ch.speed = v == null ? null : Math.max(5, Math.round(v / 5) * 5); }
    if (Array.isArray(patch.moves)) ch.moves = patch.moves.slice(0, 6).map((x) => { const ft = num(x && x.ft, [5, 120]); return { name: String((x && x.name) || '').trim().slice(0, 30), ft: ft == null ? null : Math.max(5, Math.round(ft / 5) * 5) }; }).filter((x) => x.name);
    for (const k of ['portrait', 'sprite', 'token']) if (k in patch) ch[k] = patch[k] ? library.toRef(String(patch[k])) : null;
    if ('portrait' in patch && c.meta.faces && c.meta.faces[name]) { const f = { ...c.meta.faces }; delete f[name]; c.meta.faces = f; } // (4.2.2) the 4.1 one would come back
    if ('color' in patch) ch.color = /^#[0-9a-f]{6}$/i.test(String(patch.color || '')) ? String(patch.color).toLowerCase() : null;
    // AC and max HP: what the turn order remembers (and the player's line in it now)
    if ('ac' in patch || 'hp' in patch) {
      const s2 = { ...((c.meta.pcStats || {})[name] || {}) };
      if ('ac' in patch) s2.ac = num(patch.ac, [0, 40]);
      if ('hp' in patch) s2.hp = num(patch.hp, [1, 999]);
      c.meta.pcStats = { ...(c.meta.pcStats || {}), [name]: s2 };
      const e = state.init && state.init.entries.find((x) => x.pc && x.name === name);
      if (e) for (const col of initCols()) {
        if (col.kind === 'ac' && 'ac' in patch) { if (s2.ac == null) delete e.vals[col.id]; else e.vals[col.id] = s2.ac; }
        if (col.kind === 'hp' && 'hp' in patch && s2.hp) { const v = e.vals[col.id] || {}; e.vals[col.id] = { cur: v.cur ?? s2.hp, max: s2.hp }; }
      }
    }
  }
  c.meta.characters = { ...(c.meta.characters || {}), [name]: ch };
  charFileCache.at = 0;
  store.touch();
  broadcast();
  return { ok: true };
}
function faceFor(e, mapId) {
  if (!e) return null;
  const own = e.pc ? charFace(e.name) : null;
  if (own) return own;
  const m = mapId ? store.map(mapId) : null;
  for (const id of e.tokens || []) {
    const l = m && m.layers.find((x) => x.id === id);
    if (l && l.path && FACE_IMG.test(l.path)) return l.path;
  }
  return portraitIndex().get(faceNorm(e.pc ? e.name : baseName(e.name))) || null;
}
// the strip on top of the deck: who was, who is (with a face), who comes, the round
function remoteTurn() {
  const I = initInfo(true);
  if (!I) return null;
  if (!I.running || I.cur < 0 || !I.units.length) return { running: false, ready: I.entries.length > 0 };
  const by = new Map(I.entries.map((e) => [e.id, e]));
  const U = I.units; const n = U.length;
  const near = (dir) => { for (let k = 1; k < n; k++) { const u = U[(((I.cur + dir * k) % n) + n) % n]; if (!u.out) return u; } return null; };
  const cur = U[I.cur]; const lead = by.get(cur.ids[0]) || {};
  const prev = near(-1); const next = near(1);
  return {
    running: true, round: (combatInfo() || {}).n ?? null,
    prev: prev && prev !== cur ? { name: prev.name } : null,
    cur: { name: cur.name, pc: !!lead.pc, face: Remote.faceUrl(faceFor(lead, I.mapId)) },
    next: next && next !== cur ? { name: next.name } : null,
  };
}
// the player screen: the party; in a fight the turn order from whose turn it is, enemies as "??" until shown
function remotePlayers() {
  const c = store.cur;
  if (!c) return { role: 'player', campaign: null, party: [], fight: null };
  const away = new Set(c.meta.away || []);
  const colorOf = (n) => (charOf(n) || {}).color || null;
  const party = (c.meta.party || []).filter((x) => !away.has(x)).map((x) => ({ name: x, color: colorOf(x), face: Remote.faceUrl(faceFor({ name: x, pc: true, tokens: [] }, state.liveMapId)) }));
  const live = store.map(state.liveMapId);
  let fight = null;
  const I = state.init && state.init.running && state.init.show ? initInfo(true) : null; // (4.2.2) hidden from the players on the TV: here too
  if (I && I.cur >= 0) {
    const by = new Map(I.entries.map((e) => [e.id, e]));
    const rot = [...I.units.slice(I.cur), ...I.units.slice(0, I.cur)];
    const cards = [];
    rot.forEach((u, i) => {
      const seen = u.ids.map((id) => by.get(id)).filter((e) => e && !e.hidden && !(e.down && !e.pc));
      if (!seen.length) return;
      const pc = seen.some((e) => e.pc);
      const known = seen.filter((e) => e.pc || e.shown);
      const first = known[0] || seen[0];
      cards.push({ key: u.ids[0], cur: i === 0, pc, color: pc ? colorOf((seen.find((e) => e.pc) || {}).name) : null, known: known.length > 0, name: known.length ? (seen.length > 1 ? unitName(state.init, { gid: u.gid }, known) : first.name) : '??', count: seen.length > 1 ? seen.length : 0, face: known.length ? Remote.faceUrl(faceFor(first, I.mapId)) : null });
    });
    fight = { round: (combatInfo() || {}).n ?? null, cards };
  }
  return { role: 'player', campaign: c.meta.name, party, fight }; // (Prototype 2: no map name here, it could be a spoiler)
}
// what every device sees alike, made once per change (and once a second at most otherwise: moments end on their own)
let remoteGen = 0; let remoteMemo = null;
function remoteBase() {
  const now = Date.now();
  if (remoteMemo && remoteMemo.gen === remoteGen && now - remoteMemo.at < 900) return remoteMemo.v;
  const c = store.cur;
  // (4.2.2) the decks, the files they need, the players: again after a change, otherwise every 10 s (a file deleted meanwhile)
  let H = remoteMemo && remoteMemo.gen === remoteGen && now - remoteMemo.heavyAt < 10000 ? remoteMemo.H : null;
  const heavyAt = H ? remoteMemo.heavyAt : now;
  if (!H) {
    const hot = c ? hotbarInfo(c) : [];
    const decks = { phone: remoteDeckView(hot, 'phone'), tablet: remoteDeckView(hot, 'tablet') };
    const items = [...decks.phone.pages.flat(), ...decks.tablet.pages.flat()].filter(Boolean);
    const info = (decks.phone.info || decks.tablet.info) && c ? charCards((f) => Remote.faceUrl(f)).filter((x) => x.here).map(({ portrait, sprite, token, here, ...x }) => x) : null;
    H = { decks, items, info, turn: c ? remoteTurn() : null };
  }
  const { decks, items, info } = H;
  const L = RoomLights ? RoomLights.view() : null;
  const live = [...new Set(items.filter((it) => remoteLive(it, L)).map(hotKey))];
  const common = { role: 'dm', screen: state.screen, at: state.screen === 'play' && !!c, campaign: c ? c.meta.name : null, live, turn: H.turn,
    lightsPct: L && L.started ? (['off', 'release'].includes(L.mode) ? (L.mode === 'off' ? 'Off' : 'Let go') : `${Math.round((L.brightness ?? 1) * 100)}%`) : null, // 4.5: on the −20 % / +20 % keys
    vol: { sfx: settings.boardVolume ?? 0.8, spotify: remoteSpotifyVol() } }; // 4.11.4: the volume sliders
  const v = {
    dm: { phone: { ...common, deck: decks.phone, info: decks.phone.info ? info : null }, tablet: { ...common, deck: decks.tablet, info: decks.tablet.info ? info : null } },
    player: null,
  };
  remoteMemo = { gen: remoteGen, at: now, v, H, heavyAt };
  return v;
}
// what the deck's Spotify slider shows: the volume Spotify plays at now, else Tablescape's Spotify volume
function remoteSpotifyVol() {
  if (!Spotify || !Spotify.linked()) return null;
  const v = spotifyNow && spotifyNow.volume != null ? spotifyNow.volume : (settings.spotify && settings.spotify.volume);
  return v == null ? null : v / 100;
}
function remoteState(dev) {
  const b = remoteBase();
  if (dev.role === 'player') { if (!b.player) b.player = remotePlayers(); return dev.local ? b.player : { ...b.player, ctl: Players ? Players.forPhone(dev) : null, handouts: handoutsFor(dev) }; } // (Prototype 1: what this phone may do)
  return b.dm[deckOf(dev)];
}
let remoteSaveT = null;
async function remoteRun(op, a, dev) {
  if (dev && dev.role === 'player') { // (Prototype 1)
    if (!Players) return { ok: false };
    const r = await Players.run(op, a, dev);
    if (r && r.ok && (op === 'dash' || op === 'extra')) broadcast(); // (Prototype 8: the DM's panel shows the feet)
    return r;
  }
  switch (op) {
    case 'run': return remoteHot(a.item);
    case 'char': return charSet(String(a.name || ''), Object.fromEntries(Object.entries(a).filter(([k]) => ['insp', 'exh', 'ds'].includes(k))), true); // (live trackers only)
    case 'init': {
      const col = initCols().find((x) => x.kind === 'hp');
      const r = ({
        prepare: () => handle('init.prepare', {}), roll: () => handle('init.roll', {}), start: () => handle('init.start', {}), end: () => handle('init.end', {}),
        next: () => handle('init.next', {}), prev: () => handle('init.prev', {}), turn: () => handle('init.update', { turn: String(a.id || '') }),
        hp: () => (col ? handle('init.set', { id: String(a.id || ''), vals: { [col.id]: { delta: Math.max(-999, Math.min(999, Math.round(Number(a.delta) || 0))) } } }) : { ok: false, error: 'The turn order has no HP column (add it on the PC)' }),
      }[a.do] || (() => ({ ok: false })))();
      return r && r.ok === false ? r : { ok: true, label: r && r.label };
    }
    case 'lights': {
      if (!RoomLights || !['mode', 'set', 'start'].includes(a.action)) return { ok: false };
      const p = a.p || {};
      const arg = a.action === 'set' ? Object.fromEntries(Object.entries(p).filter(([k]) => k === 'brightness' || k === 'fxStrength')) : p;
      const r = await RoomLights.action(a.action, arg);
      broadcastGm();
      return r;
    }
    case 'sound': {
      if (a.do === 'quiet') { handle('sound.quiet', {}); return { ok: true, quiet: !!state.quiet }; }
      if (a.do === 'volume') {
        settings.boardVolume = Math.min(1, Math.max(0, Number(a.v) || 0));
        clearTimeout(remoteSaveT); remoteSaveT = setTimeout(saveSettings, 800);
        broadcastGm(); remoteGen++;
        return { ok: true };
      }
      if (a.do === 'spotify') {
        if (!Spotify || !Spotify.linked()) return { ok: false, error: 'Spotify is not connected (Toolbox → Spotify on the PC)' };
        if (!['pause', 'resume', 'next', 'previous', 'volume'].includes(a.action)) return { ok: false };
        if (a.action === 'volume') return spotifyVolumeSet(a.volume);
        const r = await spotifyAction('control', { action: a.action, volume: a.volume });
        Spotify.refresh().catch(() => {});
        return r;
      }
      return { ok: false };
    }
    default: return { ok: false, error: 'Tablescape doesn\'t know that (an older version?)' };
  }
}
// 4.11.7: the deck's Spotify slider sets Tablescape's Spotify volume (moods play at it, as with the slider at the PC);
// one call to Spotify at a time, the newest value wins (a slide is a few calls, not one for every step)
const spVol = { busy: false, next: null, saveT: null };
async function spotifyVolumeSet(v0) {
  const v = Math.min(100, Math.max(0, Math.round(Number(v0) || 0)));
  settings.spotify = { ...settings.spotify, volume: v };
  clearTimeout(spVol.saveT); spVol.saveT = setTimeout(saveSettings, 800);
  spVol.next = v;
  if (spVol.busy) return { ok: true };
  spVol.busy = true;
  let r = { ok: true };
  try {
    while (spVol.next != null) {
      const x = spVol.next; spVol.next = null;
      r = await Spotify.control('volume', { volume: x });
      if (!r.ok) break;
    }
  } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; } finally { spVol.busy = false; }
  broadcastGm(); remoteGen++;
  return r;
}
async function remoteHot(item) {
  const it = cleanHot(item);
  if (!it) return { ok: false, error: 'This button doesn\'t work any more' };
  if (REMOTE_PC(it)) return { ok: false, error: 'This one needs the mouse on the map: use it at the PC' };
  if (it.kind === 'volume') return { ok: true }; // (4.11.4: a slider; it moves through op 'sound')
  if (it.kind === 'lights') {
    if (!RoomLights) return { ok: false };
    const L = RoomLights.view();
    if (it.ref === 'dim' || it.ref === 'bright') { // 4.5: −20 % / +20 %
      const r = await RoomLights.action('bright.step', { by: it.ref === 'dim' ? -0.2 : 0.2 });
      broadcastGm(); remoteGen++;
      return r && r.error ? { ok: false, error: r.error } : { ok: true, label: `Lights ${Math.round((r.brightness || 0) * 100)}%` };
    }
    const again = L.mode === 'scene' && L.sceneId === it.ref;
    const r = await RoomLights.action('mode', ['follow', 'room', 'off', 'release'].includes(it.ref) ? { mode: it.ref } : again ? { mode: 'follow' } : { mode: 'scene', sceneId: it.ref });
    broadcastGm();
    return r && r.error ? { ok: false, error: r.error } : { ok: true };
  }
  if (it.kind === 'mood') {
    if (!Spotify || !Spotify.linked()) return { ok: false, error: 'Spotify is not connected (Toolbox → Spotify on the PC)' };
    return state.spotifyMood === it.ref && spotifyNow && spotifyNow.playing ? spotifyStop() : spotifyPlay(it.ref);
  }
  if (state.screen !== 'play' || !store.cur || !gm || gm.isDestroyed()) return { ok: false, error: 'Open the campaign on the PC first (Play)' };
  if (HOT_FILES.includes(it.kind)) {
    const f = library.resolveRef(it.ref);
    if (!f || !fs.existsSync(f)) return { ok: false, error: `${it.label} is missing` };
    it.ref = { ...it.ref, path: f };
  }
  const js = `Play.hotRun(${JSON.stringify(it)}).then(() => true, (e) => String((e && e.message) || e))`;
  const r = await Promise.race([gm.webContents.executeJavaScript(js).catch((e) => String((e && e.message) || e)), new Promise((res) => setTimeout(() => res(true), 6000))]);
  return r === true ? { ok: true } : { ok: false, error: String(r) };
}
// everything that can become a button on the phone ("+" in its edit mode)
// (Prototype 25: pc = for the hotbar's own picker at the PC: without the hotbar's slots, the actions and the sliders (the
// GM window adds tools, panels and actions itself), with the library's tokens, assets, portraits, handouts and overlays)
function remoteCatalog(pc = false) {
  const c = store.cur;
  const groups = [];
  const add = (id, label, items) => { const list = items.filter(Boolean); if (list.length) groups.push({ id, label, items: list }); };
  const lean = ({ kind, label, icon, ref }) => ({ kind, label, icon: icon || null, ref: ref ?? null });
  if (c && !pc) add('hotbar', 'On the hotbar', hotbarInfo(c).filter((x) => x && !x.missing && !REMOTE_PC(x)).map(lean));
  if (c && !pc) add('actions', 'Actions', [['send', 'Send to table', 'cast'], ['blackout', 'Blackout', 'screen-share-off'], ['quiet', 'Mute', 'volume-off'], ['next', 'Next turn', 'player-track-next'], ['fight', 'Fight music', 'swords'],
    ['strike', 'Lightning', 'bolt'], ['stop-moments', 'Stop effects', 'player-stop'], ['grid', 'Grid on/off', 'grid-4x4'], ['again', 'Movement again', 'refresh'],
    ['fight-start', 'Start the fight', 'swords'], ['fight-end', 'End the fight', 'player-stop'], ['prev', 'Previous turn', 'player-skip-back'], ['roll-enemies', 'Roll enemies', 'dice'], ['init-sort', 'Sort initiative', 'sort-descending'],
    ['sp-toggle', 'Spotify play/pause', 'player-play'], ['sp-next', 'Spotify next song', 'player-track-next']].map(([ref, label, icon]) => ({ kind: 'do', ref, label, icon }))); // Prototype 24
  add('moments', 'Screen effects', Moments.LIST.map((d) => ({ kind: 'moment', ref: d.id, label: d.label, icon: d.icon })));
  add('light', 'Map light', FXDATA.MOODS.map((m) => ({ kind: 'light', ref: m.id, label: m.label, icon: m.icon })));
  add('weather', 'Weather', [...FXDATA.WEATHER.map((w) => ({ kind: 'weather', ref: w.layers, label: w.label, icon: w.icon })),
    ...(settings.weatherPresets || []).map((w) => ({ kind: 'weather', ref: w.layers, label: w.name, icon: 'cloud-rain' }))]);
  if (c) {
    const maps = c.meta.chapters.flatMap((ch) => ch.maps.map((id) => ({ ch, m: c.maps.get(id) }))).filter((x) => x.m);
    add('maps', 'Maps: onto the table', maps.map(({ ch, m }) => ({ kind: 'map', ref: m.id, label: m.name, icon: 'map-2', sub: ch.name })));
    add('snaps', 'Snapshots', [{ kind: 'snap', ref: 'next', label: 'Next snapshot', icon: 'player-track-next' },
      ...maps.flatMap(({ m }) => snapsOf(m).map((x) => ({ kind: 'snap', ref: x.id, label: x.name, icon: 'camera', sub: m.name })))]);
    const em = store.map(state.editMapId);
    add('fog', 'Fog', [{ kind: 'fog', ref: 'toggle', label: 'Fog on/off', icon: 'cloud-fog' }, { kind: 'fog', ref: 'reveal-all', label: 'Reveal all', icon: 'sun' }, { kind: 'fog', ref: 'cover-all', label: 'Cover all', icon: 'cloud' },
      ...(em ? (em.areas || []).map((x) => ({ kind: 'fog', ref: { map: em.id, area: x.id }, label: x.name, icon: 'polygon', sub: em.name })) : [])]);
    add('dice', 'Dice', [{ kind: 'roll', ref: { pool: { 20: 1 }, bonus: 0, adv: null }, label: 'd20', icon: 'dice' }, { kind: 'roll', ref: { pool: { 20: 1 }, bonus: 0, adv: 'adv' }, label: 'd20 adv.', icon: 'dice' },
      { kind: 'roll', ref: { pool: { 20: 1 }, bonus: 0, adv: 'dis' }, label: 'd20 disadv.', icon: 'dice' }, { kind: 'death', ref: null, label: 'Death save', icon: 'heart-broken' },
      ...wheelList().map((w) => ({ kind: 'wheel', ref: w.id, label: w.name, icon: 'chart-pie' }))]);
    add('cues', 'Cues', cueList().map((q) => ({ kind: 'cue', ref: q.id, label: q.name, icon: 'keyframes' })));
  }
  // 4.11.2: sounds from the library: the soundboard's (Audio/SFX) play once on the table, the others start or stop on the map
  {
    let lib = [];
    try { lib = library.listLibrary().filter((x) => x.cat === 'sounds'); } catch {}
    const ref = (x) => { const r = library.toRef(x.path); return { path: r.path, rel: r.rel || null, name: x.name, kind: 'audio', cat: 'sounds' }; };
    const where = (x) => String(x.rel || '').split('/').slice(1, -1).join(' › ');
    const sfx = lib.filter((x) => isSfxRef(x)); const rest = lib.filter((x) => !isSfxRef(x));
    add('sfx', 'Sounds: soundboard', sfx.map((x) => ({ kind: 'sound', ref: ref(x), label: x.name, icon: 'speakerphone', sub: where(x) || 'SFX' })));
    add('sounds', 'Sounds: ambience and music on the map', rest.map((x) => ({ kind: 'sound', ref: ref(x), label: x.name, icon: 'music', sub: where(x) })));
  }
  const L = RoomLights ? RoomLights.view() : null;
  add('lights', 'Room lights', [{ kind: 'lights', ref: 'follow', label: 'Lights: table', icon: 'device-tv' }, { kind: 'lights', ref: 'room', label: 'Room light', icon: 'bulb' }, { kind: 'lights', ref: 'off', label: 'Lights off', icon: 'bulb-off' }, { kind: 'lights', ref: 'release', label: 'Lights: let go', icon: 'power' },
    { kind: 'lights', ref: 'dim', label: 'Lights −20%', icon: 'brightness-down' }, { kind: 'lights', ref: 'bright', label: 'Lights +20%', icon: 'brightness-up' },
    ...((L && L.scenes) || []).map((x) => ({ kind: 'lights', ref: x.id, label: x.name, icon: 'palette' }))]);
  // 4.11.4: two sliders for the deck (one key each): the soundboard (SFX) and Spotify
  if (!pc) add('volume', 'Volume sliders (slide them on the phone or tablet)', [{ kind: 'volume', ref: 'sfx', label: 'SFX volume', icon: 'speakerphone' }, { kind: 'volume', ref: 'spotify', label: 'Spotify volume', icon: 'brand-spotify' }]);
  add('spotify', 'Spotify moods', ((settings.spotify && settings.spotify.moods) || []).map((m) => ({ kind: 'mood', ref: m.id, label: m.name, icon: 'brand-spotify' })));
  if (pc) {
    let lib = [];
    try { lib = library.listLibrary(); } catch {}
    const where = (x) => String(x.rel || '').split('/').slice(1, -1).join(' › ');
    for (const [cat, kind, label, icon] of [['tokens', 'token', 'Library: tokens', 'user'], ['assets', 'asset', 'Library: assets', 'trees'], ['portraits', 'portrait', 'Library: portraits', 'messages'],
      ['handouts', 'handout', 'Library: handouts', 'photo'], ['overlays', 'overlay', 'Library: overlays', 'sparkles']]) {
      add(`lib-${cat}`, label, lib.filter((x) => x.cat === cat).map((x) => ({ kind, ref: { path: x.path, kind: x.kind, cat: x.cat }, label: x.name, icon, sub: where(x) })));
    }
  }
  return groups;
}
// the player screen in a window on another screen of this PC (Toolbox → Phone & tablet); Esc closes it
let playerScreen = null;
async function openPlayerScreen(displayId) {
  const url = await Remote.localUrl();
  if (!url) return { ok: false, error: 'The player screen could not start (see the log)' };
  const all = screen.getAllDisplays();
  const mine = gmDisplay().id;
  const d = all.find((x) => x.id === displayId) || all.find((x) => x.id !== mine && x.id !== (player ? playerOnDisplay : null)) || all[0];
  if (playerScreen && !playerScreen.isDestroyed()) { playerScreen.removeAllListeners('closed'); playerScreen.close(); }
  const windowed = d.id === mine || all.length < 2; // on the GM's own screen: a window to drag where it should be
  const win = new BrowserWindow({
    backgroundColor: '#0c0d10', title: 'Tablescape – Players', icon: ICON, show: false, frame: windowed, autoHideMenuBar: true,
    ...(windowed ? { width: 1280, height: 720 } : { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'persist:players' },
  });
  playerScreen = win;
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith('http://127.0.0.1:')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') win.close(); });
  win.once('ready-to-show', () => { win.show(); if (!windowed) win.setFullScreen(true); });
  win.on('closed', () => { if (playerScreen === win) { playerScreen = null; Remote.localDone(); broadcastGm(); } });
  win.loadURL(url);
  settings.remote.screenId = d.id;
  saveSettings();
  broadcastGm();
  return { ok: true, windowed };
}

// ---------- the campaign's screens on the TV: the title when a session starts, the break, the blackout ----------
const SCREEN_DEF = {
  title: { title: '', sub: '', pic: null }, // title: the campaign's name if empty; sub: a line under it (nothing if empty)
  brk: { label: 'Break', text: '', bg: 'map', pic: null }, // bg: 'map' (the map, blurred) | 'picture' | 'dark'
  blackout: { style: 'black', text: '', pic: null }, // style: 'black' | 'title' (the campaign's name, faint) | 'picture'
};
function screensOf(c = store.cur) {
  const s = (c && c.meta.screens) || {};
  return Object.fromEntries(Object.keys(SCREEN_DEF).map((k) => [k, { ...SCREEN_DEF[k], ...(s[k] || {}) }]));
}
// the picture a screen uses when none was picked: the little maid sweeping the fog (src/renderer/calib)
const DEFAULT_PIC = { name: 'The little maid (default)', url: 'calib/default.webp', small: 'calib/default-small.webp', kind: 'image', builtin: true };
// ref: null = the default picture, 'none' = no picture, else a file
function picOf(ref) {
  if (ref === 'none') return null;
  if (!ref) return DEFAULT_PIC;
  const p = library.resolveRef(ref);
  if (!p || !fs.existsSync(p)) return { name: ref.name || '', path: p || null, missing: true };
  return { name: ref.name || path.parse(p).name, path: p, url: library.media(p).url, kind: library.kindOf(p) === 'video' ? 'video' : 'image' };
}
function screensSummary() {
  const sc = screensOf();
  return Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, { ...v, pic: v.pic === 'none' ? { none: true } : picOf(v.pic) }]));
}
// what the campaign page put on the TV to try it goes away when the page is left
function endPreviews() {
  if (state.title && state.title.preview) state.title = null;
  if (state.brk && state.brk.preview) state.brk = null;
  if (state.blackoutPreview) { state.blackout = false; state.blackoutPreview = false; }
}
function titleInfo() {
  const t = screensOf().title;
  const pic = picOf(t.pic);
  return { id: `t${Date.now().toString(36)}`, title: t.title.trim() || store.cur.meta.name, sub: t.sub.trim(), pic: pic && !pic.missing ? pic : null };
}
function breakLook() {
  const b = screensOf().brk;
  const pic = b.bg === 'picture' ? picOf(b.pic) : null;
  return { label: b.label.trim() || 'Break', text: b.text.trim(), bg: b.bg === 'picture' && !(pic && !pic.missing) ? 'dark' : b.bg, pic: pic && !pic.missing ? pic : null };
}
function blackoutLook() {
  if (!store.cur) return { style: 'black', text: '' };
  const b = screensOf().blackout;
  const pic = b.style === 'picture' ? picOf(b.pic) : null;
  const style = b.style === 'picture' && !(pic && !pic.missing) ? 'black' : b.style;
  return { style, text: b.text.trim(), title: store.cur.meta.name, pic: style === 'picture' ? pic : null };
}

// ---------- the GM's notes ----------
function notesInfo(c = store.cur) {
  const n = (c && c.meta.notes) || {};
  return { text: n.text || '', changed: n.changed || 0, exported: n.exported || 0, dirty: !!(n.text && (n.changed || 0) > (n.exported || 0)), file: n.file || null };
}
function exportNotes() {
  const c = store.cur;
  if (!c) return { ok: false };
  const n = c.meta.notes || {};
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const when = d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const file = path.join(c.dir, 'Notes', `${day}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${c.meta.name}: session log\n\n_Exported ${when}_\n\n${(n.text || '').replace(/\r\n/g, '\n')}\n`);
  c.meta.notes = { ...n, exported: Date.now(), file };
  store.touch();
  store.flush();
  return { ok: true, file, name: path.relative(c.dir, file).replace(/\\/g, '/') };
}

// Library files the open campaign uses somewhere (for the "This campaign" shelf).
function campaignFiles() {
  const c = store.cur;
  const out = new Set();
  if (!c) return out;
  for (const m of c.maps.values()) {
    if (m.bg && m.bg.path) out.add(m.bg.path);
    for (const l of m.layers) if (l.path) out.add(l.path);
    for (const s of m.snaps || []) {
      if (s.data.bg && s.data.bg.path) out.add(s.data.bg.path);
      for (const l of s.data.layers || []) if (l.path) out.add(l.path);
      if (s.trans && s.trans.sound) out.add(s.trans.sound);
    }
  }
  for (const ch of c.meta.chapters) {
    for (const a of [ch.ambience, ch.fight]) if (a && a.path) out.add(a.path);
    for (const k of READY_KINDS) for (const r of (ch.ready && ch.ready[k]) || []) if (r.path) out.add(r.path);
  }
  return out;
}
const sfxNames = () => Object.fromEntries(Object.entries(settings.sfxMap || {}).map(([k, p]) => [k, { name: path.parse(p).name, missing: !fs.existsSync(p), url: pathToFileURL(p).href }]));

function tableInfo() {
  const live = store.map(state.liveMapId);
  return { open: !!player, blackout: state.blackout, calibrating: state.calibrating, liveMapId: live ? live.id : null, liveName: live ? live.name : null, title: state.title ? state.title.title : null };
}

// ---------- picture settings per TV, effects quality per map ----------
const PIC_DEF = { brightness: 1, contrast: 1, gamma: 1, saturation: 1, warmth: 0, black: 0 };
const PIC_RANGE = { brightness: [0.5, 1.6], contrast: [0.5, 1.6], gamma: [0.5, 2], saturation: [0, 2], warmth: [-1, 1], black: [-0.15, 0.15] };
const pictureFor = (key) => ({ ...PIC_DEF, ...((settings.picture || {})[key] || {}) });
const QL = ['low', 'medium', 'high'];
// a map can need lighter effects than the rest (it made the TV stutter): the lower of the two counts
function qualityFor(mapId) {
  const base = QL.includes(settings.quality) ? settings.quality : 'high';
  const m = mapId && settings.mapQuality ? settings.mapQuality[mapId] : null;
  return m && QL.indexOf(m) < QL.indexOf(base) ? m : base;
}

// ---------- screen moments: what plays with them ----------
let sfxCache = { at: 0, list: [] };
function sfxLibrary(fresh) {
  if (fresh || Date.now() - sfxCache.at > 10000) {
    let list = [];
    try { list = library.listLibrary().filter((it) => it.cat === 'sounds' && (/^Audio\/SFX\//i.test(it.rel) || /\bsfx\b/i.test(it.rel))); } catch {}
    sfxCache = { at: Date.now(), list };
  }
  return sfxCache.list;
}
// the sound a moment plays: the one the GM picked, else one from Audio/SFX with a fitting name, else the built-in one
function momentSound(id, fresh) {
  const own = (settings.momentSounds || {})[id];
  if (own === 'none') return { none: true, name: 'No sound' };
  if (own && fs.existsSync(own)) return { url: pathToFileURL(own).href, name: path.parse(own).name, path: own, own: true };
  const d = Moments.BY[id];
  const hit = d && d.words.length ? sfxLibrary(fresh).find((it) => d.words.some((w) => it.name.toLowerCase().includes(w))) : null;
  if (hit) return { url: pathToFileURL(hit.path).href, name: hit.name, path: hit.path, match: true };
  if (id === 'lightning') return { name: 'Thunder', builtin: true }; // the thunder comes with the flash
  return { url: `sfx/moment-${id}.ogg`, name: 'Built-in', builtin: true };
}
const momentSoundNames = () => Object.fromEntries(Moments.LIST.map((d) => { const x = momentSound(d.id); return [d.id, { name: x.name, own: !!x.own, match: !!x.match, none: !!x.none, missing: !!((settings.momentSounds || {})[d.id] && (settings.momentSounds || {})[d.id] !== 'none' && !x.own) }]; }));

// ---------- dice, the wheel of luck, death saves (shown on the TV by dice-fx.js) ----------
const { randomInt } = require('crypto');
const TableParse = require('./renderer/table-parse.js'); // tables for the wheel (also used by the GM screen)
const DICE = [2, 4, 6, 8, 10, 12, 20, 100];
// Dice, the wheel and the death save run as slot-machine reels (dice-fx.js): each reel stops at its time,
// slowing to a crawl over its last numbers; the result shows a moment after the last one and stays a while.
const REEL = { first: 2400, spread: 3600, gap: 800, wheel: 5000, death: 5200, after: 500 };
function reelStops(n) {
  const gap = n > 1 ? Math.min(REEL.gap, REEL.spread / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => Math.round(REEL.first + i * gap));
}
// muted colours for the wheels (dark fantasy: oxblood, slate, moss, old gold …)
const DICE_COLORS = ['#7a2e2a', '#3e5468', '#4f6b3a', '#9a7b3c', '#5e3f5c', '#8a4b2a', '#3f6b63', '#6e2f45', '#5a5a55', '#6b4e33'];
// the bright colours of Alpha 1.5, turned into their muted versions where a saved wheel still has them
const OLD_COLORS = { '#c0392b': '#7a2e2a', '#2e86c1': '#3e5468', '#28b463': '#4f6b3a', '#d4ac0d': '#9a7b3c', '#8e44ad': '#5e3f5c', '#ca6f1e': '#8a4b2a', '#17a589': '#3f6b63', '#c2185b': '#6e2f45', '#5d6d7e': '#5a5a55', '#a04000': '#6b4e33', '#839192': '#6d6f6a', '#7f8c8d': '#5f5a52' };
// wheels belong to the campaign; a new one starts with three neutral ones
function wheelList() {
  if (!store.cur) return [];
  const w = store.cur.meta.wheels;
  if (Array.isArray(w)) {
    if (w.some((x) => x.entries.some((e) => OLD_COLORS[String(e.color).toLowerCase()]))) {
      for (const x of w) for (const e of x.entries) e.color = OLD_COLORS[String(e.color).toLowerCase()] || e.color;
      store.touch();
    }
    return w;
  }
  const wheel = (id, name, list) => ({ id, name, entries: list.map(([label, color, weight = 1], i) => ({ id: `${id}-${i}`, label, color, weight })) });
  return [
    wheel('w-yes', 'Yes / No / Maybe', [['Yes', '#4f6b3a'], ['No', '#7a2e2a'], ['Maybe', '#9a7b3c']]),
    wheel('w-weather', 'Weather', [['Clear sky', '#9a7b3c', 3], ['Clouds', '#5a5a55', 2], ['Rain', '#3e5468', 2], ['Storm', '#5e3f5c'], ['Fog', '#6d6f6a'], ['Strong wind', '#3f6b63']]),
    wheel('w-coin', 'Coin', [['Heads', '#9a7b3c'], ['Tails', '#5f5a52']]),
  ];
}
function cleanWheel(w, old) {
  const entries = (Array.isArray(w.entries) ? w.entries : []).slice(0, 100).map((x, i) => ({
    id: String(x.id || mapstate.newId('e')).slice(0, 40), label: String(x.label ?? '').trim().slice(0, 60) || `Entry ${i + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : DICE_COLORS[i % DICE_COLORS.length],
    weight: Math.min(100, Math.max(1, Math.round(Number(x.weight) || 1))),
  }));
  return { id: (old && old.id) || String(w.id || mapstate.newId('w')).slice(0, 40), name: String(w.name ?? '').trim().slice(0, 60) || 'Wheel', entries };
}
function logRoll(r) {
  state.diceLog = [r, ...state.diceLog].slice(0, 12);
}
function rollDice(p) {
  const pool = [];
  for (const sides of DICE) {
    const n = Math.min(12, Math.max(0, Math.round(Number((p.pool || {})[sides]) || 0)));
    for (let i = 0; i < n; i++) pool.push(sides);
  }
  if (!pool.length) return { ok: false, error: 'Pick some dice first' };
  if (pool.length > 12) pool.length = 12;
  const bonus = Math.min(50, Math.max(-50, Math.round(Number(p.bonus) || 0)));
  const single20 = pool.length === 1 && pool[0] === 20;
  const adv = single20 && (p.adv === 'adv' || p.adv === 'dis') ? p.adv : null;
  const dice = pool.map((sides) => ({ sides, value: randomInt(1, sides + 1) }));
  if (adv) {
    dice.push({ sides: 20, value: randomInt(1, 21) });
    const keep = adv === 'adv' ? (dice[0].value >= dice[1].value ? 0 : 1) : (dice[0].value <= dice[1].value ? 0 : 1);
    dice[1 - keep].dropped = true;
  }
  const kept = dice.filter((d) => !d.dropped);
  const total = kept.reduce((a, d) => a + d.value, 0) + bonus;
  const nat = single20 ? kept[0].value : null;
  const counts = {};
  for (const sides of pool) counts[sides] = (counts[sides] || 0) + 1;
  const label = `${Object.entries(counts).map(([sides, n]) => `${n}d${sides}`).join(' + ')}${bonus ? ` ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}` : ''}${adv ? (adv === 'adv' ? ' (advantage)' : ' (disadvantage)') : ''}`;
  const stops = reelStops(dice.length);
  return { ok: true, roll: { kind: 'dice', dice, bonus, total, adv, label, crit: nat === 20 ? 'nat20' : nat === 1 ? 'nat1' : null, stops, reveal: stops[stops.length - 1] + REEL.after } };
}
// The wheel's reel: each entry as often as its weight, spread out along the strip
function wheelStrip(entries) {
  const cells = [];
  entries.forEach((e, i) => { for (let k = 0; k < e.weight; k++) cells.push({ i, at: (k + 0.5) / e.weight + i * 1e-4 }); });
  cells.sort((a, b) => a.at - b.at);
  return cells.map((c) => c.i);
}
function spinWheel(p) {
  const w = wheelList().find((x) => x.id === p.id);
  if (!w || !w.entries.length) return { ok: false, error: 'This wheel has no entries' };
  const strip = wheelStrip(w.entries);
  const cell = randomInt(0, strip.length); // a cell of the strip: an entry comes up as often as its weight
  const index = strip[cell];
  return { ok: true, roll: { kind: 'wheel', wheelId: w.id, title: w.name, entries: w.entries.map((e) => ({ label: e.label, color: e.color, weight: e.weight })),
    strip, cell, index, label: w.entries[index].label, stops: [REEL.wheel], reveal: REEL.wheel + REEL.after } };
}

// ---------- cues: a scene saved to play again with one click ----------
const cueList = () => (store.cur && Array.isArray(store.cur.meta.cues) ? store.cur.meta.cues : []);
const WX_KEEP = ['type', 'amount', 'opacity', 'size', 'speed', 'color', 'dir', 'gust', 'hidden', 'thunder'];
function cueCapture(map, p, old) {
  return {
    view: { x: map.view.x, y: map.view.y, zoom: map.view.zoom },
    light: { darkness: map.light.darkness, tint: map.light.tint, mood: map.light.mood || null },
    weather: { name: map.weather.name, layers: map.weather.layers.filter((l) => !l.dying).map((l) => Object.fromEntries(WX_KEEP.filter((k) => k in l).map((k) => [k, l[k]]))) },
    fx: Object.fromEntries(map.fx.map((f) => [f.id, !!f.hidden])),
    fog: { enabled: !!map.fog.enabled },
    fight: !!state.fightNow,
    moment: 'moment' in p ? (Moments.BY[p.moment] ? p.moment : null) : old ? old.moment : null,
    spotify: 'spotify' in p ? (p.spotify ? String(p.spotify).slice(0, 40) : null) : old ? old.spotify || null : null,
    play: 'play' in p ? (p.play ? String(p.play) : null) : old ? old.play : null,
  };
}
const CUE_PARTS = ['map', 'light', 'weather', 'effects', 'fog', 'fight', 'sound', 'moment', 'spotify'];
function cueParts(p, old) {
  const def = old ? old.parts : { map: true, light: true, weather: true, effects: true, fog: false, fight: false, sound: !!p.play, moment: !!p.moment, spotify: !!p.spotify };
  return Object.fromEntries(CUE_PARTS.map((k) => [k, p.parts && k in p.parts ? !!p.parts[k] : !!def[k]]));
}
function cueSummary(c) {
  const m = store.map(c.mapId);
  return { id: c.id, name: c.name, slot: c.slot || null, mapId: c.mapId, mapName: m ? m.name : null, parts: { spotify: false, ...c.parts }, moment: c.data.moment, sound: c.data.play ? path.parse(c.data.play).name : null, spotify: c.data.spotify || null };
}

// ---------- snapshots (2.1): a map's scenery saved to come back to, one timeline per map ----------
// What is in one: mapstate.js (sceneOf, scene.apply). A snapshot: { id, name, t, data, trans, thumb }.
// trans: how it comes in: { moment, sound (a file), music: 'keep' | 'fight' | 'calm' | 'mood', mood, fade (light and weather over 10 s) }
// thumb: its picture in the campaign's snaps folder (a new file each time, so undo gets the old one back).
const SNAPS_MAX = 30;
let snapKeep = null; // { id, mapId, data }: how the map looked when the GM switched away from a changed snapshot at the table
const snapsOf = (m) => (m && Array.isArray(m.snaps) ? m.snaps : []);
function findSnap(id) {
  if (!store.cur || !id) return null;
  for (const m of store.cur.maps.values()) { const s = snapsOf(m).find((x) => x.id === id); if (s) return { map: m, s }; }
  return null;
}
const snapDir = () => path.join(store.cur.dir, 'snaps');
function saveSnapThumb(s, dataUrl) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || !store.cur) return;
  try {
    const name = `${s.id}-${Date.now().toString(36)}.jpg`;
    fs.mkdirSync(snapDir(), { recursive: true });
    fs.writeFileSync(path.join(snapDir(), name), Buffer.from(m[1], 'base64'));
    s.thumb = name;
  } catch (e) { console.error('snapshot picture', e.message); }
}
const SNAP_MUSIC = ['keep', 'fight', 'calm', 'mood'];
function cleanTrans(t, old) {
  const o = { moment: null, sound: null, music: 'keep', mood: null, fade: false, ...(old || {}) };
  if (!t) return o;
  if ('moment' in t) o.moment = Moments.BY[t.moment] ? t.moment : null;
  if ('sound' in t) o.sound = t.sound ? String(t.sound) : null;
  if ('music' in t) o.music = SNAP_MUSIC.includes(t.music) ? t.music : 'keep';
  if ('mood' in t) o.mood = t.mood ? String(t.mood).slice(0, 40) : null;
  if ('fade' in t) o.fade = !!t.fade;
  if (o.music === 'mood' && !o.mood) o.music = 'keep';
  return o;
}
const hasTrans = (t) => !!(t && (t.moment || t.sound || (t.music && t.music !== 'keep') || t.fade));
// what the GM screen gets of a map's snapshots (the timeline, the map bar, the details)
function snapList(m) {
  const list = snapsOf(m);
  if (!list.length) return [];
  const look = m.id === state.editMapId || m.id === state.liveMapId; // only there: does the map still look like its snapshot?
  return list.map((s, i) => {
    const D = s.data;
    const fx = {}; let lights = 0;
    for (const f of D.fx || []) { if (f.hidden) continue; if (f.kind === 'light') lights++; else fx[f.preset] = (fx[f.preset] || 0) + 1; }
    const L = D.layers || [];
    const on = (l) => !l.hidden;
    const t = s.trans || {};
    const at = m.snapAt === s.id;
    return {
      id: s.id, name: s.name, n: i + 1, at, changed: at && look ? snapChanged(m, s) : false,
      thumb: s.thumb && store.cur ? pathToFileURL(path.join(snapDir(), s.thumb)).href : null,
      bg: D.bg ? { name: D.bg.name, path: D.bg.path, kind: D.bg.kind, missing: !!D.bg.missing } : null,
      mood: D.light ? D.light.mood : null, dark: D.light ? D.light.darkness : 0,
      weather: D.weather && D.weather.layers.length ? D.weather.name : null,
      fx, lights, assets: L.filter((l) => l.role === 'asset' && on(l)).length,
      films: L.filter((l) => l.role === 'overlay' && on(l)).map((l) => l.name), sounds: L.filter((l) => l.role === 'audio' && on(l) && !l.muted).map((l) => l.name),
      missing: L.filter((l) => l.missing).length + (D.bg && D.bg.missing ? 1 : 0),
      trans: hasTrans(t) ? { moment: t.moment || null, sound: t.sound ? path.parse(t.sound).name : null, soundPath: t.sound || null, music: t.music || 'keep', mood: t.mood || null, fade: !!t.fade } : null,
    };
  });
}
// does the map still look like its snapshot? Worked out again only after the map changed (not on every update)
const mapRev = new Map(); // mapId -> changes so far (map commands and undo)
const bumpRev = (id) => mapRev.set(id, (mapRev.get(id) || 0) + 1);
// 4.4: how a new map arrives on the table, and how Talk looks
const TRANSITIONS = ['ink', 'fade', 'smoke', 'parchment', 'embers', 'stone', 'meadow', 'city', 'winter', 'sand'];
const TALK_LOOKS = ['ink', 'smoke', 'parchment', 'embers', 'stone', 'meadow', 'city', 'winter', 'sand'];
// Prototype 7: one style for the table. A style is one of the four looks, or a variant of one (drawn the same way, in
// other colours): Options → Looks picks the table's style, and a new map, Talk, the turn order and the round's banner
// follow it unless one of them is given a style of its own (settings.looks; 'style' = follows; a new map can also 'fade').
const TABLE_STYLES = { ink: 'ink', blood: 'ink', smoke: 'smoke', arcane: 'smoke', parchment: 'parchment', old: 'parchment', embers: 'embers', witchfire: 'embers', stone: 'stone', ice: 'stone', meadow: 'meadow', autumn: 'meadow', city: 'city', slums: 'city', winter: 'winter', christmas: 'winter', sand: 'sand', ash: 'sand',
  dungeon: 'dungeon', necro: 'necro', bloodcrypt: 'necro', forest: 'forest', jungle: 'forest' }; // (Prototype 27) // (Prototype 9: the regions; 10: winter, sand) // id → the look it is drawn with
const LOOK_PARTS = ['map', 'talk', 'init', 'round'];
function lookFor(which) { // → { id, base, variant }
  const own = (settings.looks || {})[which];
  if (which === 'map' && own === 'fade') return { id: 'fade', base: 'fade', variant: null };
  const id = TABLE_STYLES[own] ? own : TABLE_STYLES[settings.tableStyle] ? settings.tableStyle : 'ink';
  const base = TABLE_STYLES[id];
  return { id, base, variant: id === base ? null : id };
}
const stylesNow = () => Object.fromEntries(LOOK_PARTS.map((k) => [k, lookFor(k)]));
const transitionOf = () => lookFor('map').base;
const snapCheck = new Map(); // mapId -> { key, changed }
function snapChanged(m, s) {
  const key = `${s.id}|${s.t}|${mapRev.get(m.id) || 0}`;
  const c = snapCheck.get(m.id);
  if (c && c.key === key) return c.changed;
  const changed = !mapstate.sceneMatches(m, s.data);
  snapCheck.set(m.id, { key, changed });
  return changed;
}
// F1 to F8 and "next": the snapshots of the map on the table (or of the one open here)
function snapMap(mapId) {
  if (mapId) return store.map(mapId);
  const live = store.map(state.liveMapId);
  if (player && live && snapsOf(live).length) return live;
  const ed = store.map(state.editMapId);
  return ed && snapsOf(ed).length ? ed : null;
}

// Rounds belong to the map on the table (or the one being edited when nothing is on the table).
const combatMap = () => (state.init && state.init.running && store.map(state.init.mapId)) || store.map(state.liveMapId) || store.map(state.editMapId);
function combatInfo() {
  const m = combatMap();
  if (!m) return null;
  return { mapId: m.id, name: m.name, n: m.round.n, show: m.round.show, counting: m.spells.filter((s) => s.rounds != null).length };
}

// ---------- Spotify (spotify.js): the GM's own Spotify as a remote ----------
let Spotify = null;
let RoomLights = null; // Beta 3: the lamps around the table (roomlights.js)
let Remote = null; // Beta 4: phones and tablets as remotes (remote.js)
let Players = null; // Prototype 1: the players move their tokens from their phones (players.js)
let spotifyNow = null; // what Spotify plays now (from its last answer)
const spotifyMood = (id) => (settings.spotify.moods || []).find((m) => m.id === id) || null;
function spotifyState() {
  const i = Spotify ? Spotify.info() : { linked: false };
  const sp = settings.spotify || {};
  return { ...i, moods: sp.moods || [], device: sp.device || '', deviceName: sp.deviceName || '', volume: sp.volume ?? null, duck: sp.duck ?? 0.4, playingMood: state.spotifyMood || null, fightMood: !!state.spotifyFight };
}
async function spotifyPlay(id, o = {}) {
  const mood = typeof id === 'object' && id ? id : spotifyMood(id);
  if (!mood || !Spotify) return { ok: false, error: 'No such mood' };
  const sp = settings.spotify;
  const r = await Spotify.play(mood, { device: sp.device || null, volume: sp.volume ?? undefined });
  if (r.ok) { state.spotifyMood = mood.id || null; if (!o.fight) state.spotifyFight = false; broadcastGm(); }
  return r;
}
async function spotifyStop() {
  if (!Spotify) return { ok: false };
  const r = await Spotify.stop();
  state.spotifyMood = null;
  state.spotifyFight = false;
  broadcastGm();
  return r;
}
// a fight with Spotify as its music: the chapter's mood starts with the fight and fades out after it
let fightSpotifyWas = false;
function syncSpotifyFight() {
  const mood = player ? fightMood() : null;
  const on = !!(mood && fighting());
  if (on === fightSpotifyWas) return;
  fightSpotifyWas = on;
  if (on) { state.spotifyFight = true; spotifyPlay(mood, { fight: true }).then((r) => { if (r && r.ok) state.spotifyFight = true; }); }
  else if (state.spotifyFight) spotifyStop();
}

function gmState() {
  const edit = store.map(state.editMapId);
  const v = view();
  return {
    screen: state.screen,
    view: v,
    table: tableInfo(),
    campaign: campaignSummary(),
    editMapId: edit ? edit.id : null,
    map: edit ? forWindow(gm, edit) : null,
    history: edit ? store.history(edit.id).state : { canUndo: false, canRedo: false },
    combat: combatInfo(),
    lights: RoomLights ? RoomLights.view() : null,
    remote: Remote ? { ...Remote.view(), decks: settings.remote.decks, presets: DECK_PRESETS, presetLimits: DECK_CUSTOM, screenOpen: !!(playerScreen && !playerScreen.isDestroyed()), screenId: settings.remote.screenId || null } : null,
    timer: state.timer,
    talk: talkInfo(),
    show: state.show, // Beta 3.2: tokens shown to the table
    handout: handoutInfo(),
    handouts: handoutsInfo(), // Prototype 26: everything that lies on the table, with how each lies
    handoutShare: hoShareList(), // marked for the players' phones
    handoutSeen: state.handoutSeen || [], // Prototype 25: shown so far this session, newest first
    brk: state.brk,
    init: initInfo(true),
    chars: charCards(),
    pcTokens: edit ? pcTokens(edit) : {}, // Prototype 17: which tokens are players'
    update: { ...state.update, current: PKG.version, currentLabel: LABEL }, // Prototype 20
    players: Players ? { ...Players.view(), join: !!state.join } : null, // Prototype 1
    trails: Players ? Players.trails() : [], // Prototype 6: the squares walked this turn
    partyLoose: partyLoose().length, // 4.7: the party's pictures outside the Party folder
    settings: {
      sfxOn: settings.sfxOn, sfxVolume: settings.sfxVolume, burstSeconds: settings.burstSeconds, sfxMap: sfxNames(),
      seats: settings.seats, handout: handoutPrefs(), talk: { ...settings.talk, look: lookFor('talk').base }, tableStyle: TABLE_STYLES[settings.tableStyle] ? settings.tableStyle : 'ink', looks: Object.fromEntries(LOOK_PARTS.map((k) => [k, (settings.looks || {})[k] || 'style'])), initAuto: settings.initAutoSort !== false, portraitMirror: settings.portraitMirror, portraitSize: settings.portraitSize || {}, portraitOffset: settings.portraitOffset || {}, boardVolume: settings.boardVolume, weatherPresets: settings.weatherPresets,
      hudScale: settings.hudScale || 1, uiScale: settings.uiScale || 1, askNotes: settings.askNotes !== false,
      round: roundLook(), mapTransition: transitionOf(), initShow: settings.initShow !== false, initFoes: settings.initFoes === 'enemy' ? 'enemy' : 'names', initCount: Number(settings.initCount) || 0,
      quality: settings.quality || 'high', gmAnim: ['smooth', 'light', 'still'].includes(settings.gmAnim) ? settings.gmAnim : 'light', gmFx: ['smooth', 'light', 'still'].includes(settings.gmFx) ? settings.gmFx : 'light', animDraw: settings.animDraw === 'gpu' ? 'gpu' : 'cpu',
      soundOut: settings.soundOut || '', soundOutLabel: settings.soundOutLabel || '', fxOut: settings.fxOut ?? null, fxOutLabel: settings.fxOutLabel || '',
      duck: settings.duck !== false, fightAuto: settings.fightAuto !== false,
      picture: pictureFor(v.tvKey), fpsWatch: settings.fpsWatch !== false, buildWide: settings.buildWide !== false, mapQuality: settings.mapQuality || {},
      liveQuality: qualityFor(state.liveMapId), editQuality: qualityFor(state.editMapId),
      momentStars: settings.momentStars || [], momentSounds: momentSoundNames(), boardVolumeNow: settings.boardVolume ?? 0.8,
      tokens: tokenLook(),
      videoPath: VIDEO_PATHS.includes(settings.videoPath) ? settings.videoPath : 'noOverlay', videoPathNow: VIDEO_PATH_NOW, // 4.11.3
    },
    spotify: spotifyState(),
    testPicture: state.testPicture || false,
    moments: state.moments,
    dice: state.dice, diceLog: state.diceLog,
    sound: { quiet: !!state.quiet, fightNow: !!state.fightNow, fighting: !!(player && (fightTrack() || fightMood()) && fighting()) },
  };
}

function ambienceFor(liveMap) {
  if (!liveMap) return null;
  const hasOwn = liveMap.layers.some((l) => l.role === 'audio' && !l.hidden);
  if (hasOwn) return null; // a map's own sounds replace the chapter ambience
  const ch = store.chapterOf(liveMap.id);
  if (!ch || !ch.ambience || ch.ambience.missing) return null;
  return { url: ch.ambience.url, volume: ch.ambience.volume ?? 0.5, key: ch.ambience.path };
}

// What the sound window should play right now (see sound-engine.js)
function fightTrack() {
  const id = (state.init && state.init.running && state.init.mapId) || state.liveMapId || state.editMapId;
  const ch = id ? store.chapterOf(id) : null;
  return ch && ch.fight && !ch.fight.missing && !(ch.fightMood && spotifyMood(ch.fightMood)) ? ch.fight : null;
}
// a chapter's fight music can be a Spotify mood instead of a file
function fightMood() {
  const id = (state.init && state.init.running && state.init.mapId) || state.liveMapId || state.editMapId;
  const ch = id ? store.chapterOf(id) : null;
  return ch && ch.fightMood && Spotify && Spotify.linked() ? spotifyMood(ch.fightMood) : null;
}
const fighting = () => !!state.fightNow || (!!(state.init && state.init.running) && settings.fightAuto !== false);
function soundState() {
  const open = !!player;
  const live = open ? store.map(state.liveMapId) : null;
  const f = fightTrack();
  return {
    open,
    device: settings.soundOut || '',
    fxDevice: settings.fxOut == null ? settings.soundOut || '' : settings.fxOut,
    quiet: !!state.quiet,
    duck: settings.duck !== false,
    blackout: !!state.blackout,
    mapId: live ? live.id : null,
    ambience: ambienceFor(live),
    mapSounds: live ? live.layers.filter((l) => l.role === 'audio' && l.url).map((l) => ({ id: l.id, url: l.url, volume: l.volume ?? 0.6, muted: !!l.muted || !!l.hidden })) : [],
    fight: open && f && fighting() ? { url: f.url, volume: f.volume ?? 0.6, key: f.path } : null,
    // while Spotify plays (started from Tablescape or not), the ambience dips to this level
    spotify: open && Spotify && Spotify.linked() && spotifyNow && spotifyNow.playing ? Math.min(1, Math.max(0, settings.spotify.duck ?? 0.4)) : null,
    sfx: {
      on: settings.sfxOn, volume: settings.sfxVolume,
      map: Object.fromEntries(Object.entries(settings.sfxMap || {}).filter(([, p]) => fs.existsSync(p)).map(([k, p]) => [k, pathToFileURL(p).href])),
    },
    spells: live ? live.spells.map((sp) => ({ id: sp.id, t0: sp.t0, skin: sp.skin, hidden: !!sp.hidden, muted: !!sp.muted })) : [],
  };
}
let lastSound = '';
function sendSound() {
  syncSpotifyFight();
  if (!soundWin || soundWin.isDestroyed() || soundWin.webContents.isLoading()) return;
  const s = soundState();
  const sig = JSON.stringify(s);
  if (sig === lastSound) return;
  lastSound = sig;
  soundWin.webContents.send('sound:state', s);
}

function tableState() {
  const live = store.map(state.liveMapId);
  const edit = store.map(state.editMapId);
  const prep = edit && (!live || edit.id !== live.id) ? edit : null;
  const v = view();
  return {
    view: v,
    picture: pictureFor(v.tvKey),
    testPicture: state.testPicture || false,
    moments: state.moments,
    dice: state.dice,
    blackout: state.blackout,
    blackoutLook: state.blackout ? blackoutLook() : null,
    title: state.title,
    calibrating: state.calibrating ? { cardWidthIn: CARD_W_IN } : null,
    live: live ? forWindow(player, live) : null,
    prep: prep ? forWindow(player, prep) : null,
    ambience: ambienceFor(live),
    timer: state.timer,
    seats: settings.seats,
    hud: settings.hudScale || 1,
    hudSample: Date.now() < state.hudSampleUntil,
    tokens: tokenLook(), // 4.10
    roundLook: roundLook(),
    transition: transitionOf(),
    styles: stylesNow(), // Prototype 7: the look and variant of a new map, Talk, the turn order, the round's banner
    quality: qualityFor(state.liveMapId),
    animDraw: settings.animDraw === 'gpu' ? 'gpu' : 'cpu',
    soundOut: settings.soundOut || '', // background videos with sound play there too
    talk: talkInfo(),
    show: state.show, // Beta 3.2
    handout: handoutInfo(),
    handouts: handoutsInfo(),
    join: state.join, // Prototype 1
    calib: state.calib, // Prototype 2
    trails: Players ? Players.trails() : [], // Prototype 6
    brk: state.brk,
    init: initInfo(false),
    sfx: {
      on: settings.sfxOn, volume: settings.sfxVolume,
      map: Object.fromEntries(Object.entries(settings.sfxMap || {}).filter(([, p]) => fs.existsSync(p)).map(([k, p]) => [k, pathToFileURL(p).href])),
    },
  };
}

// 4.6.3: mode: where the round shows on the TV: 'auto' (in the turn order during a fight, else the badge), 'badge' (always
// the badge; the turn order without it), 'both', 'order' (only in the turn order), 'off' (never)
const ROUND_MODES = ['auto', 'badge', 'both', 'order', 'off'];
const roundLook = () => ({ x: settings.roundPos?.x ?? 0.07, y: settings.roundPos?.y ?? 0.07, size: settings.roundSize || 1.4, banner: settings.roundBanner !== false, mode: ROUND_MODES.includes(settings.roundMode) ? settings.roundMode : 'auto' });

// ---------- talk, initiative ----------
function talkInfo() {
  if (!state.talk) return null;
  return { ...state.talk, ...settings.talk, look: lookFor('talk').base, variant: lookFor('talk').variant, cast: state.talk.cast.map((c) => ({ ...c, scale: (settings.portraitSize || {})[c.path] || 1, offset: (settings.portraitOffset || {})[c.path] || null, mirror: !!(settings.portraitMirror || {})[c.path] })) };
}
// ---------- Beta 3.2: a token shown to the table ----------
// Right-click a token → Show to the table: on the TV its picture flies to the middle in an arc, turns once and flies
// back (table-show.js); the map dims around it. On its turn it stays facing each long side for about two seconds
// (only the near side when the players sit at one side: Options → Table → seats). More can join while it turns ("Add to the show"): they line
// up and turn together, and all fly back once the last one has turned once. A click on the GM screen or Esc brings
// them back at once. "Show and reveal": a hidden token is shown on the map from then on.
// state.show: { id, mapId, at, spinAt (the shared turn starts), endAt, phase: 'show' | 'back', ids: [layer ids],
//   turn (ms: one turn), sides (1 | 2: how many long sides it stops for) }
const SHOW_FLY = 1000; const SHOW_HOLD = 2000; const SHOW_MOVE = 1800; const SHOW_MAX = 6; // (as in table-show.js)
const showSides = () => (settings.seats === 'one' ? 1 : 2);
const showTurn = (sides) => (sides === 1 ? SHOW_HOLD + 2 * SHOW_MOVE : 2 * (SHOW_HOLD + SHOW_MOVE));
let showT = null;
function showNext() {
  clearTimeout(showT);
  const s = state.show;
  if (!s) return;
  showT = setTimeout(() => {
    if (state.show !== s) return;
    if (s.phase === 'show') showBack();
    else { state.show = null; broadcast(); }
  }, Math.max(0, s.endAt - Date.now()));
}
function showBack() {
  const s = state.show;
  if (!s || s.phase !== 'show') return false;
  s.phase = 'back';
  s.endAt = Date.now() + SHOW_FLY + 150;
  showNext();
  broadcast();
  return true;
}
function showDrop() { clearTimeout(showT); state.show = null; }

// ---------- initiative ----------
// state.init: { mapId, running, turn (an entry's id), show, entries, groups: { gid: { name } }, dropped: [keys left out by hand] }
// An entry: { id, name, pc, init (number | null), bonus, roll ({ d20, bonus } of its last roll), hidden (hidden by hand),
//   custom (renamed in the list), tokens: [layer ids], group (gid | null), vals: { columnId: value } }
// Preparing (running false) the list follows the party and the tokens on the map; Start adds the turn marker and rounds.
// Entries in a group sit side by side and share one turn and one initiative; each keeps its own HP and columns.
const INIT_COLS = { hp: 'HP', ac: 'AC', cond: 'Conditions', notes: 'Notes', num: 'Number', text: 'Text' };
let initUndo = null; // the list before the last removal or the end of a fight
const initCols = (c = store.cur) => ((c && c.meta.initCols) || []).filter((x) => INIT_COLS[x.kind]);
const tokName = (t) => `${t.name}${t.n ? ` ${t.n}` : ''}`;
const baseName = (n) => String(n).replace(/\s*\d+$/, '').trim() || String(n);
const initNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(-99, Math.min(999, Math.round(Number(v)))));
function hpOf(e) {
  const c = initCols().find((x) => x.kind === 'hp');
  const v = c && e.vals[c.id];
  return v && Number.isFinite(v.cur) ? v : null;
}
const isDown = (e) => { const v = hpOf(e); return !!v && v.cur <= 0; };
// turns: an entry alone or a group (its members side by side)
function initUnits(I) {
  const units = [];
  for (const e of I.entries) {
    const last = units[units.length - 1];
    if (e.group && last && last.gid === e.group) last.list.push(e);
    else units.push({ gid: e.group || null, list: [e] });
  }
  return units;
}
// a unit is skipped when all its members are NPCs at 0 HP (players at 0 HP still roll their death saves)
const unitOut = (u) => u.list.every((e) => !e.pc && isDown(e));
function unitName(I, u, list = u.list) {
  if (!u.gid) return list[0].name;
  const custom = I.groups[u.gid] && I.groups[u.gid].name;
  if (custom) return custom;
  // Goblin ×3, or Goblin ×2 & Thorin for a mixed group
  const n = new Map();
  for (const e of list) n.set(baseName(e.name), [...(n.get(baseName(e.name)) || []), e]);
  return [...n].map(([b, es]) => (es.length > 1 ? `${b} ×${es.length}` : es[0].name)).join(' & ');
}
let initSeq = 0;
function newEntry(o) {
  return {
    id: `e${Date.now().toString(36)}${(initSeq++).toString(36)}`, name: String(o.name || '?').trim().slice(0, 40) || '?', pc: !!o.pc,
    init: initNum(o.init), bonus: initNum(o.bonus) || 0, roll: null, hidden: !!o.hidden, custom: !!o.custom,
    tokens: Array.isArray(o.tokens) ? o.tokens.slice(0, 20) : [], group: o.group || null, vals: o.vals || {},
  };
}
// what the campaign remembers: a player's AC and max HP, an enemy's bonus, AC and HP
function knownVals(stats) {
  const vals = {};
  if (!stats) return vals;
  for (const c of initCols()) {
    if (c.kind === 'ac' && stats.ac != null) vals[c.id] = stats.ac;
    if (c.kind === 'hp' && stats.hp > 0) vals[c.id] = { cur: stats.hp, max: stats.hp };
  }
  return vals;
}
const pcStats = (name) => ((store.cur && store.cur.meta.pcStats) || {})[name] || null;
const foeOf = (name) => ((store.cur && store.cur.meta.foes) || []).find((f) => f.name.toLowerCase() === baseName(name).toLowerCase()) || null;
function rememberFoe(f) {
  const c = store.cur;
  if (!c || !f.name) return;
  const name = baseName(f.name).slice(0, 40);
  const old = foeOf(name) || {};
  const foe = { name, bonus: initNum(f.bonus) ?? old.bonus ?? 0, ac: initNum(f.ac) ?? old.ac ?? null, hp: initNum(f.hp) ?? old.hp ?? null };
  c.meta.foes = [foe, ...(c.meta.foes || []).filter((x) => x.name.toLowerCase() !== name.toLowerCase())].slice(0, 40);
}
function rememberPc(e) {
  const c = store.cur;
  if (!c || !e.pc) return;
  const s = { ...((c.meta.pcStats || {})[e.name] || {}) };
  for (const col of initCols()) {
    if (!(col.id in e.vals)) continue; // (4.2.2) an empty cell (a column added for an enemy) does not wipe the card's AC
    const v = e.vals[col.id];
    if (col.kind === 'ac') s.ac = initNum(v);
    if (col.kind === 'hp' && v && Number.isFinite(v.max) && v.max > 0) s.hp = v.max;
  }
  c.meta.pcStats = { ...(c.meta.pcStats || {}), [e.name]: s };
}
// (4.2.2) a cleared cell: the value is gone from the card as well
function forgetPcVal(e, cid) {
  const c = store.cur; const col = initCols().find((x) => x.id === cid);
  if (!c || !e.pc || !col || col.kind !== 'ac') return;
  const s = { ...((c.meta.pcStats || {})[e.name] || {}) };
  s.ac = null;
  c.meta.pcStats = { ...(c.meta.pcStats || {}), [e.name]: s };
}
// a column the list needs (adding an enemy with AC or HP adds those columns)
function needCol(kind) {
  const c = store.cur;
  if (!c) return null;
  let col = initCols().find((x) => x.kind === kind);
  if (!col) {
    col = { id: `c${Date.now().toString(36)}${(initSeq++).toString(36)}`, kind, name: INIT_COLS[kind] }; c.meta.initCols = [...initCols(), col];
    if (state.init) for (const e of state.init.entries) if (e.pc) { const k = knownVals(pcStats(e.name)); if (col.id in k) e.vals[col.id] = k[col.id]; } // (4.2.2) the players' AC / HP fill the new column
  }
  return col;
}
// groups stay together, a group of one is no group, members share the first one's initiative
function tidyInit(I) {
  const out = []; const seen = new Set();
  for (const e of I.entries) {
    if (seen.has(e.id)) continue;
    for (const x of e.group ? I.entries.filter((y) => y.group === e.group) : [e]) if (!seen.has(x.id)) { out.push(x); seen.add(x.id); }
  }
  const n = {};
  for (const e of out) if (e.group) n[e.group] = (n[e.group] || 0) + 1;
  for (const e of out) if (e.group && n[e.group] < 2) e.group = null;
  for (const g of Object.keys(I.groups)) if (!(n[g] >= 2)) delete I.groups[g];
  const lead = {};
  for (const e of out) if (e.group) { if (!lead[e.group]) lead[e.group] = e; else { e.init = lead[e.group].init; e.roll = lead[e.group].roll; e.bonus = lead[e.group].bonus; } }
  I.entries = out;
}
// after entries went away, the turn moves on to the next one still there
function keepTurn(I, before) {
  if (!I.turn || I.entries.some((e) => e.id === I.turn)) return;
  const at = before.findIndex((e) => e.id === I.turn);
  const next = before.slice(at + 1).find((e) => I.entries.some((x) => x.id === e.id));
  I.turn = next ? next.id : I.entries[0] ? I.entries[0].id : null;
}
// highest first; a tie goes to the higher bonus, then to the players; otherwise the order stays as it is
function sortInit(I) {
  const k = (e) => (e.init == null ? -1e9 : e.init);
  const units = initUnits(I);
  units.sort((a, b) => k(b.list[0]) - k(a.list[0]) || (b.list[0].bonus || 0) - (a.list[0].bonus || 0) || (b.list[0].pc ? 1 : 0) - (a.list[0].pc ? 1 : 0));
  I.entries = units.flatMap((u) => u.list);
}
const initMissing = (I) => I.entries.filter((e) => e.init == null).length;
// the last number came in: sort (when auto-sort is on)
function autoSort(I, missingBefore) {
  if (settings.initAutoSort === false || !missingBefore || initMissing(I) || !I.entries.length) return false;
  sortInit(I);
  return true;
}
function rollFor(I, ids) {
  for (const u of initUnits(I)) {
    if (!u.list.some((e) => ids.has(e.id))) continue;
    const d20 = randomInt(1, 21); const bonus = u.list[0].bonus || 0;
    for (const e of u.list) { e.init = d20 + bonus; e.roll = { d20, bonus }; }
  }
}
// preparing: the players here today and the tokens on the fight map join, the ones gone leave
function syncInit(I) {
  const c = store.cur;
  if (!c) return false;
  const sig = JSON.stringify([I.mapId, I.entries.map((e) => e.id)]);
  const m = combatMap();
  if (m) I.mapId = m.id;
  const away = new Set(c.meta.away || []);
  const here = (c.meta.party || []).filter((n) => !away.has(n));
  const toks = m ? m.layers.filter((l) => l.role === 'token') : [];
  const ids = new Set(toks.map((t) => t.id));
  const before = I.entries;
  I.entries = I.entries.filter((e) => (e.pc ? here.includes(e.name) : !e.tokens.length || e.tokens.some((id) => ids.has(id))));
  for (const n of here) if (!I.entries.some((e) => e.pc && e.name === n) && !I.dropped.includes(`pc:${n}`)) I.entries.push(newEntry({ name: n, pc: true, vals: knownVals(pcStats(n)) }));
  if (m) for (const e of I.entries) if (e.pc) e.tokens = e.tokens.filter((id) => ids.has(id)); // (4.2.2) tokens since deleted
  linkCharTokens(I, toks);
  const used = new Set(I.entries.flatMap((e) => e.tokens));
  for (const t of toks) {
    if (used.has(t.id) || I.dropped.includes(t.id)) continue;
    if (charTokOwner(t, true)) continue; // (4.2.2) the token of a player not here today: not an enemy (it can be added by hand)
    const foe = foeOf(t.name);
    I.entries.push(newEntry({ name: tokName(t), tokens: [t.id], bonus: foe && foe.bonus, vals: knownVals(foe) }));
  }
  tidyInit(I);
  keepTurn(I, before);
  return sig !== JSON.stringify([I.mapId, I.entries.map((e) => e.id)]);
}
// 4.2: a character's own token belongs to that player's line (4.2.2: also one first taken as an enemy while the player
// was away, and one put on the map during the fight)
function linkCharTokens(I, toks, steal = true) {
  let moved = false;
  for (const t of toks) {
    const owner = charTokOwner(t);
    if (!owner) continue;
    const pe = I.entries.find((e) => e.pc && e.name === owner);
    if (!pe || pe.tokens.includes(t.id)) continue;
    const other = I.entries.find((e) => e !== pe && e.tokens.includes(t.id));
    if (other) {
      if (!steal || other.pc || other.custom || other.tokens.length > 1) continue; // (the GM put it there; in a fight nobody leaves)
      I.entries = I.entries.filter((e) => e !== other);
      if (I.turn === other.id) I.turn = pe.id;
    }
    pe.tokens = [...pe.tokens, t.id].slice(-20);
    moved = true;
  }
  return moved;
}
function freshTokens(I) {
  const m = store.map(I.mapId);
  if (!m) return [];
  const used = new Set(I.entries.flatMap((e) => e.tokens));
  return m.layers.filter((l) => l.role === 'token' && !used.has(l.id) && !I.dropped.includes(l.id) && !charTokOwner(l));
}
function snapInit() { initUndo = { init: JSON.parse(JSON.stringify(state.init)), round: (combatInfo() || {}).n ?? null }; }
// the turn order; for the table only during a fight the players may see: names only, hidden ones left out
function initInfo(forGm) {
  const I = state.init;
  if (!I) return null;
  const m = store.map(I.mapId);
  const tok = (id) => (m ? m.layers.find((l) => l.id === id) : null);
  const look = new Map(I.entries.map((e) => {
    const toks = e.tokens.map(tok).filter(Boolean);
    const name = !e.custom && !e.pc && toks.length === 1 ? tokName(toks[0]) : e.name;
    const tokHidden = !e.pc && toks.length > 0 && toks.every((t) => t.hidden);
    return [e.id, { name, toks, tokHidden, hidden: !e.pc && (e.hidden || tokHidden), down: isDown(e), gone: e.tokens.length > 0 && !toks.length }];
  }));
  const L = (e) => ({ ...e, ...look.get(e.id) });
  const units = initUnits(I).map((u) => ({ ...u, list: u.list.map(L) }));
  const cur = I.running ? units.findIndex((u) => u.list.some((e) => e.id === I.turn)) : -1;
  if (forGm) {
    return {
      mapId: I.mapId, running: !!I.running, turn: I.turn, show: !!I.show, auto: settings.initAutoSort !== false, cols: initCols(), groups: I.groups,
      entries: units.flatMap((u) => u.list).map(({ toks, ...e }) => e),
      units: units.map((u) => ({ gid: u.gid, ids: u.list.map((e) => e.id), name: unitName(I, u), out: unitOut(u) })),
      cur, fresh: freshTokens(I).map((t) => ({ id: t.id, name: tokName(t) })), undo: !!initUndo,
      out: store.cur ? (store.cur.meta.party || []).filter((n) => !(store.cur.meta.away || []).includes(n) && !I.entries.some((e) => e.pc && e.name === n)) : [], // (Prototype 6: players here tonight who are not in the list)
    };
  }
  if (!I.running || !I.show || cur < 0) return null;
  const rot = [...units.slice(cur), ...units.slice(0, cur)];
  const list = [];
  const foes = settings.initFoes === 'enemy'; // 4.6.3: "Enemy" instead of their names
  rot.forEach((u, i) => {
    const seen = u.list.filter((e) => !e.hidden && !(e.down && !e.pc));
    if (!seen.length) return;
    const pc = seen.some((e) => e.pc);
    list.push({ name: foes && !pc ? (seen.length > 1 ? `Enemies (${seen.length})` : 'Enemy') : unitName(I, u, seen), cur: i === 0, pc });
  });
  const most = Number(settings.initCount) > 0 ? Number(settings.initCount) : 0; // 4.6.3: whose turn it is and the next few only
  if (most && list.length > most) list.length = most;
  const now = units[cur];
  return { mapId: I.mapId, list, glow: now ? now.list.filter((e) => !e.hidden).flatMap((e) => e.tokens) : [] };
}

// one-off events for the windows (a sound from the soundboard, a lightning strike)
function sendEvent(e) {
  if (e.kind === 'sound' || e.kind === 'stop') { soundEvent(e); return; } // the sound window plays them
  for (const w of [gm, player]) if (w && !w.isDestroyed()) w.webContents.send('event', e);
  if (e.kind !== 'toast') previewChanged('event'); // (4.9: a lightning strike, a moment …: the GM's picture of the TV follows)
}

let pendingBroadcast = false;
function broadcast() {
  // Coalesce bursts (slider drags) into one message per tick.
  if (pendingBroadcast) return;
  pendingBroadcast = true;
  setImmediate(() => {
    pendingBroadcast = false;
    if (state.init && !state.init.running && store.cur) syncInit(state.init); // preparing: the list follows the party and the map
    else if (state.init && state.init.running && store.cur) { const m = store.map(state.init.mapId); if (m) linkCharTokens(state.init, m.layers.filter((l) => l.role === 'token'), false); } // (4.2.2) a character's token put down in the fight
    if (gm && !gm.isDestroyed()) gm.webContents.send('gm:state', gmState());
    if (player && !player.isDestroyed()) { player.webContents.send('table:state', tableState()); previewChanged('state'); }
    sendSound();
    animSoon();
    try { syncEyes(); } catch (e) { applog.log.warn(`eyes: ${e.message}`); } // Prototype 17: every player token sees
    if (Remote) { remoteGen++; Remote.changed(); }
  });
}

// Spotify's changes only concern the GM screen and the sound window (the ambience dips): the TV is left alone
let pendingGm = false;
function broadcastGm() {
  if (pendingGm || pendingBroadcast) return;
  pendingGm = true;
  setImmediate(() => {
    pendingGm = false;
    if (gm && !gm.isDestroyed()) gm.webContents.send('gm:state', gmState());
    sendSound();
    if (Remote) { remoteGen++; Remote.changed(); }
  });
}

function sendFogDelta(mapId, delta) {
  const rev = fogRev.get(mapId) || 0;
  const msg = { mapId, ...delta };
  for (const w of [gm, player]) {
    if (!w || w.isDestroyed()) continue;
    const interested = w === gm ? state.editMapId === mapId : (state.liveMapId === mapId || state.editMapId === mapId);
    if (!interested) continue;
    w.webContents.send('fog', msg);
    if (w === player) previewChanged('fog');
    if (!fogSent.has(w)) fogSent.set(w, new Map());
    // only mark as current if this window already had the previous state
    const sent = fogSent.get(w);
    if (sent.get(mapId) === rev - 1) sent.set(mapId, rev);
  }
}

// =====================================================================
// Windows
// =====================================================================
const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  autoplayPolicy: 'no-user-gesture-required',
  backgroundThrottling: false,
  spellcheck: false,
};

// errors and warnings of a window go into the log file
function logWindow(win, name) {
  win.webContents.on('console-message', (e) => {
    const lvl = e.level; const msg = e.message;
    if (lvl === 'error' || lvl === 3) applog.log.error(`[${name}] ${msg}`);
    else if ((lvl === 'warning' || lvl === 2) && !/willReadFrequently/.test(msg)) applog.log.warn(`[${name}] ${msg}`);
  });
  // Beta 1: a window that stopped (out of memory, a graphics driver fault) is loaded again: everything it showed
  // lives in this process, so it comes back as it was. A note on the GM screen says so.
  win.webContents.on('render-process-gone', (e, d) => {
    applog.log.error(`[${name}] window stopped: ${d.reason} (exit code ${d.exitCode})`);
    if (d.reason === 'clean-exit' || d.reason === 'killed') return;
    recoverWindow(win, name, d.reason);
  });
  win.on('unresponsive', () => {
    applog.log.warn(`[${name}] window not responding`);
    if (TEST_DIR || name === 'sound') return;
    dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Wait', 'Load it again'], defaultId: 0, cancelId: 0, noLink: true, title: 'Tablescape',
      message: `The ${name === 'gm' ? 'GM' : 'table'} window is not responding`,
      detail: 'A huge map or a very big animation can take a moment. Loading it again brings back what it showed.',
    }).then((r) => { if (r.response === 1 && !win.isDestroyed()) recoverWindow(win, name, 'not responding'); }).catch(() => {});
  });
  win.on('responsive', () => applog.log.info(`[${name}] window responding again`));
}
const WHY = { crashed: 'crashed', oom: 'ran out of memory', 'launch-failed': 'could not start', 'integrity-failure': 'failed a check', abnormal: 'stopped' };
function recoverWindow(win, name, reason) {
  if (!win || win.isDestroyed()) return;
  const n = (win.restarts = (win.restarts || 0) + 1);
  if (n > 3) { applog.log.error(`[${name}] window stopped ${n} times: giving up`); return; }
  setTimeout(() => {
    if (win.isDestroyed()) return;
    try { win.webContents.reload(); } catch (err) { applog.log.error(`[${name}] reload failed`, err); return; }
    applog.log.info(`[${name}] window loaded again (${reason})`);
    const text = name === 'gm' ? `The GM window ${WHY[reason] || 'stopped'} and was loaded again. If it happens often: Guide → Report a problem.`
      : name === 'table' ? `The table window ${WHY[reason] || 'stopped'} and was loaded again${reason === 'oom' ? ' (a smaller map, or fewer animations, needs less memory)' : ''}.` : null;
    if (text) win.webContents.once('did-finish-load', () => setTimeout(() => sendEvent({ kind: 'toast', text, level: 'error', ms: 12000 }), 600));
  }, 400);
}
const tip = (k) => { if (!settings.tips || !settings.tips[k]) { settings.tips = { ...(settings.tips || {}), [k]: true }; saveSettings(); } };

// 4.0.1: the size of the GM window's interface. Chromium keeps one zoom for all windows of a session, so the TV has
// a session of its own (openPlayer) and stays at 100 %.
function applyUiScale() {
  if (gm && !gm.isDestroyed()) gm.webContents.setZoomFactor(Math.min(1.3, Math.max(0.7, Number(settings.uiScale) || 1)));
}
function createGm() {
  gm = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    backgroundColor: '#121316', title: `Tablescape ${LABEL}`, icon: ICON, show: false, webPreferences,
  });
  gm.on('page-title-updated', (e) => e.preventDefault());
  gm.webContents.on('did-finish-load', applyUiScale);
  logWindow(gm, 'gm');
  gm.loadFile(PAGE, { query: { role: 'gm' } });
  gm.once('ready-to-show', () => { gm.maximize(); gm.show(); });
  // closing: offer to export the notes if they changed since the last export
  let askedNotes = false;
  gm.on('close', (e) => {
    if (askedNotes || TEST_DIR || settings.askNotes === false || !store.cur || !notesInfo().dirty) return;
    e.preventDefault();
    askedNotes = true;
    dialog.showMessageBox(gm, {
      type: 'question', buttons: ['Export', 'Not now', 'Don\'t ask again'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Tablescape', message: 'Export tonight\'s session log?',
      detail: 'The session log is saved with the campaign either way. Export also writes it into a text file in the campaign\'s Notes folder.',
    }).then((r) => {
      if (r.response === 0) { try { exportNotes(); } catch (err) { console.error('notes export failed', err); } }
      if (r.response === 2) { settings.askNotes = false; saveSettings(); }
      if (gm && !gm.isDestroyed()) gm.close();
    });
  });
  gm.on('closed', () => {
    gm = null;
    if (player && !player.isDestroyed()) player.close();
    if (soundWin && !soundWin.isDestroyed()) soundWin.destroy();
  });
  devtoolsShortcut(gm);
}

// The sound window: hidden, its own process, so drawing effects on the TV can't make the sound stutter.
function openSound() {
  if (soundWin && !soundWin.isDestroyed()) return;
  soundWin = new BrowserWindow({ show: false, width: 320, height: 200, title: 'Tablescape sound', skipTaskbar: true, webPreferences });
  logWindow(soundWin, 'sound');
  lastSound = '';
  soundWin.loadFile(SOUND_PAGE, { query: { role: 'sound' } });
  soundWin.on('closed', () => { soundWin = null; });
  // should it ever stop, a new one takes over
  soundWin.webContents.on('render-process-gone', () => setTimeout(() => { try { soundWin.destroy(); } catch {} soundWin = null; if (gm) openSound(); }, 800));
}
function soundEvent(e) { if (soundWin && !soundWin.isDestroyed()) soundWin.webContents.send('sound:event', e); }

function openPlayer() {
  if (player && !player.isDestroyed()) return;
  const d = targetDisplay();
  const windowed = isWindowed(d);
  playerOnDisplay = d.id;
  const opts = { backgroundColor: '#000000', title: 'Tablescape – Table', icon: ICON, show: false, webPreferences: { ...webPreferences, partition: 'persist:table' } }; // (its own session: the GM window's zoom stays there)
  if (windowed) Object.assign(opts, { width: 1280, height: 760 });
  else Object.assign(opts, { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false });
  player = new BrowserWindow(opts);
  player.setMenuBarVisibility(false);
  player.on('page-title-updated', (e) => e.preventDefault());
  logWindow(player, 'table');
  if (!windowed || TEST_DIR) tip('tv'); // Beta 1: the first step is done once the table really is on another screen
  player.loadFile(PAGE, { query: { role: 'table' } });
  player.once('ready-to-show', () => {
    if (windowed) player.showInactive();
    else { player.setBounds(d.bounds); player.setFullScreen(true); player.showInactive(); }
    broadcast();
  });
  player.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); closePlayer(); }
  });
  // Keep the TV awake while the table is open.
  const blocker = powerSaveBlocker.start('prevent-display-sleep');
  player.on('closed', () => { player = null; state.calibrating = false; powerSaveBlocker.stop(blocker); broadcast(); });
  startPreview();
}
function closePlayer() { if (player && !player.isDestroyed()) player.close(); }

// 4.9: the picture of the TV on the GM's screen follows what happens on the TV instead of a clock (taking one costs the TV time)
//   something changes on the TV   one picture about 0.4 s later and another about 1.5 s after the last change (things fade in)
//   fog being painted             at most one a second while the brush moves, one right after the stroke
//   the map moving                none (previewQuiet); the change when it rests brings one
//   nothing happening             one every 15 s
//   the big preview open          every 0.6 s, as before
const PREVIEW = { idle: 15000, first: 400, settle: 1500, fogEnd: 450, gap: 1000, fast: 600, tick: 150 };
let previewQuiet = 0;
let previewLast = 0; // when the last picture was taken (0: one is due now)
let previewBusy = false;
const previewDue = { first: 0, settle: 0, fog: 0 }; // when pictures are due (0: none)
function previewChanged(kind) {
  if (!player || player.isDestroyed()) return;
  const now = Date.now();
  if (!previewDue.first) previewDue.first = Math.max(now + PREVIEW.first, previewLast + PREVIEW.gap);
  if (kind === 'fog') previewDue.fog = now + PREVIEW.fogEnd; // the brush stops: the stroke is done
  else previewDue.settle = now + PREVIEW.settle;
}
async function previewTake() {
  previewBusy = true;
  previewLast = Date.now();
  try {
    const img = await player.webContents.capturePage();
    if (!img.isEmpty() && gm && !gm.isDestroyed()) {
      const small = img.resize({ width: preview.width, quality: 'good' });
      gm.webContents.send('table:preview', `data:image/jpeg;base64,${small.toJPEG(preview.width > 500 ? 80 : 72).toString('base64')}`);
    }
  } catch {}
  previewBusy = false;
}
function startPreview() {
  clearInterval(previewTimer);
  previewLast = 0;
  previewTimer = setInterval(() => {
    if (previewBusy) return;
    if (!player || player.isDestroyed() || !gm || gm.isDestroyed() || gm.isMinimized() || state.screen !== 'play') { previewLast = 0; return; } // (one right away when it shows again)
    const now = Date.now();
    if (now < previewQuiet) return; // 4.8: not while the map moves (it costs the TV time)
    let take = false;
    if (preview.fast) take = now - previewLast >= PREVIEW.fast;
    else {
      if (now - previewLast < 300) return; // never two right after another
      for (const k of Object.keys(previewDue)) if (previewDue[k] && previewDue[k] <= now) { previewDue[k] = 0; take = true; }
      if (!take && now - previewLast >= PREVIEW.idle) take = true;
    }
    if (!take) return;
    // a picture due in a moment would show the same: this one counts for it
    for (const k of Object.keys(previewDue)) if (previewDue[k] && previewDue[k] - now < 250) previewDue[k] = 0;
    previewTake();
  }, PREVIEW.tick);
}

function devtoolsShortcut(win) {
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// =====================================================================
// Commands
// =====================================================================
const MAP_CMD = /^(bg|view|layer|grid|fog|fx|light|weather|spell|draw|mark|round|wall|vision|area|scene)\./;

// ---------- walls from files, and what the party has seen ----------
const sightLast = new Map(); // mapId -> Map(eyeId -> what was last recorded into the fog)
function lastSight(id) { let m = sightLast.get(id); if (!m) { m = new Map(); sightLast.set(id, m); } return m; }
// where the map picture lies on the map (map inches), if known
function bgRect(map) {
  const b = map.bg;
  if (!b) return null;
  if (b.span) return { x: b.x || 0, y: b.y || 0, w: b.span };
  if (b.scale != null && b.nw) return { x: b.x, y: b.y, w: b.nw * b.scale };
  return null;
}
// a fresh place for a picture so many squares wide: centred on the table, or from its top left when bigger
function freshRect(map, sq) {
  const g = map.grid.size || 1;
  const w = sq.w * g; const hgt = sq.h * g;
  const v = map.view; const t = view().inches;
  const tr = { x: -v.x / v.zoom, y: -v.y / v.zoom, w: t.w / v.zoom, h: t.h / v.zoom };
  const r = (x) => Math.round(x * 1000) / 1000;
  return { x: r(tr.x + Math.max(0, (tr.w - w) / 2)), y: r(tr.y + Math.max(0, (tr.h - hgt) / 2)), w: r(w) };
}
function importWalls(map, n, { fresh } = {}) {
  let rect = fresh ? null : bgRect(map);
  let bg = null;
  if (!rect) { rect = freshRect(map, WallsImport.squares(n)); if (map.bg) bg = { x: rect.x, y: rect.y, span: rect.w, scale: null }; }
  const pl = WallsImport.place(n, rect);
  const doors = pl.walls.filter((w) => w[4]).length;
  const label = `${pl.walls.length - doors} walls, ${doors} door${doors === 1 ? '' : 's'}${pl.lights.length ? ` and ${pl.lights.length} light${pl.lights.length === 1 ? '' : 's'}` : ''} loaded`;
  return mapstate.apply(map, 'wall.import', { replace: true, walls: pl.walls, lights: pl.lights, grid: pl.grid, bg, label });
}
// A map picture that brings walls: a Universal VTT file, or a walls file with the same name next to it.
function wallsForBg(map, p) {
  const src = WallsImport.isVtt(p.path) ? p.path : WallsImport.sidecar(p.path);
  if (!src) return null;
  if (p.keep && map.walls.length) return null; // a variant keeps the walls the map has
  try {
    const n = WallsImport.read(src, { prefer: path.parse(p.path).name });
    if (n.choose) return null;
    return importWalls(map, n, { fresh: !p.keep });
  } catch (e) { console.error('walls', e.message); return null; }
}

function openCampaign(id, { backup = true } = {}) {
  // a backup of the campaign as it was on disk, before this session changes anything (a brand-new one has nothing to keep)
  const dir = store.findDir(id);
  if (dir && backup) { try { const b = backups.snapshot(dir); if (b) applog.log.info(`backup ${b.id} of ${b.name}`); } catch (err) { applog.log.error('backup failed', err); } }
  const c = store.open(id);
  if (!c) return { ok: false, error: String(id).startsWith('broken:') ? 'This campaign\'s file is damaged: use Backups to bring one back.' : 'Campaign not found.' };
  const ids = store.allMapIds();
  const broken = ids.filter((mid) => store.map(mid) && store.map(mid).broken);
  if (broken.length) applog.log.warn(`${broken.length} map file(s) of ${c.meta.name} could not be read: ${broken.join(', ')}`);
  state.screen = 'campaign'; // the campaign's page first: players, screens, start the session
  state.session = null;
  state.title = null;
  state.openedAt = Date.now();
  state.editMapId = ids.includes(c.meta.lastMapId) ? c.meta.lastMapId : ids[0] || null;
  state.liveMapId = null; // the table stays dark until you send a map
  state.blackout = false;
  showDrop();
  for (const mid of ids) bumpFog(mid);
  settings.lastCampaignId = id;
  saveSettings();
  return { ok: true };
}

function goHome() {
  store.close();
  state.timer = null;
  state.talk = null; state.handouts = []; state.handoutSeen = []; state.brk = null; state.init = null;
  initUndo = null; showDrop();
  state.quiet = false; state.fightNow = false; state.dice = null;
  state.moments = []; state.testPicture = false;
  state.screen = 'home';
  state.session = null; state.title = null;
  state.editMapId = null;
  state.liveMapId = null;
  state.blackout = false; state.blackoutPreview = false;
}

function setEdit(id) {
  if (!store.map(id)) return;
  state.editMapId = id;
  store.cur.meta.lastMapId = id;
  store.touch();
}

// 4.4: the map moving (a drag, Alt + wheel): only the new place goes to the TV while it moves; your screen shows it
// already. Line of sight, explored areas, saving and the full state follow once when it rests (live: false from the
// GM, or here after a short pause if that message never comes).
const liveViewEnd = new Map(); // mapId -> timer
function liveView(map, p) {
  previewQuiet = Date.now() + (p.hold ? 30000 : 900);
  const h = store.history(map.id);
  h.before(map, p.coalesce, 'view.update', p.stepLabel, !!p.hold); // (4.5.1: resting mid-drag took a new undo step, a copy of the whole map, when it moved on)
  mapstate.apply(map, 'view.update', p, library.media);
  if (player && !player.isDestroyed() && (state.liveMapId === map.id)) player.webContents.send('view', { mapId: map.id, view: { ...map.view } });
  clearTimeout(liveViewEnd.get(map.id));
  liveViewEnd.set(map.id, setTimeout(() => { liveViewEnd.delete(map.id); handle('view.update', { mapId: map.id, x: map.view.x, y: map.view.y, zoom: map.view.zoom, coalesce: p.coalesce }); }, p.hold ? 30000 : 600)); // a held drag settles when it is let go
  return { ok: true, mapId: map.id, live: true };
}

// Prototype 14: a token dragged on the GM screen. Only its new place goes to the TV (a tiny message, one per tick);
// your screen gets its state as usual. The TV's full state, the phones, the sight and the fog follow once when it is
// let go (the final message), or here after a short pause if that never comes.
const dragEnd = new Map(); // mapId -> timer
let dragMsg = null;
function dragLive(map, p, res) {
  bumpRev(map.id);
  store.touch(map.id);
  if (player && !player.isDestroyed() && (state.liveMapId === map.id || state.editMapId === map.id)) {
    const l = map.layers.find((q) => q.id === p.id);
    if (l) {
      if (!dragMsg) setImmediate(() => { const m = dragMsg; dragMsg = null; if (player && !player.isDestroyed()) for (const d of m.values()) player.webContents.send('drag', d); });
      dragMsg = dragMsg || new Map();
      dragMsg.set(`${map.id}:${l.id}`, { mapId: map.id, id: l.id, x: l.x, y: l.y });
    }
  }
  // Prototype 23: your screen moves the token itself while you drag (no full state for it until you let go); what the
  // token sees opens the fog as it goes: every half square, at most about 8 times a second, only the new piece is sent
  const now = Date.now();
  if (map.fog && map.fog.enabled && now - (dragSightAt.get(map.id) || 0) >= 120) {
    dragSightAt.set(map.id, now);
    for (const op of mapstate.recordSight(map, lastSight(map.id), false, 0.5)) { bumpFog(map.id); sendFogDelta(map.id, { op }); }
  }
  clearTimeout(dragEnd.get(map.id));
  dragEnd.set(map.id, setTimeout(() => { dragEnd.delete(map.id); broadcast(); }, 900));
  return { ok: true, selected: res.selected || null, undoable: true, mapId: map.id };
}
const dragSightAt = new Map(); // mapId → when the fog last followed a drag

const phoneMoves = new Map(); // Prototype 14: mapId → Map(tokenId → when a phone last moved it)
function handle(type, p = {}) {
  // ----- map content -----
  if (MAP_CMD.test(type)) {
    const mapId = p.mapId || state.editMapId;
    const map = store.map(mapId);
    if (!map) return { ok: false };
    if (type === 'view.update' && p.live) return liveView(map, p);
    if (type === 'view.update') { clearTimeout(liveViewEnd.get(mapId)); liveViewEnd.delete(mapId); if (previewQuiet) previewQuiet = Date.now() + 350; }
    const h = store.history(mapId);
    const pushed = p.noHistory ? false : h.before(map, p.coalesce, type, p.stepLabel); // (Prototype 14: the phones' moves are no undo steps)
    if (type === 'spell.add' || type === 'spell.burst' || (type === 'spell.update' && 'mode' in p)) p.hold = settings.burstSeconds * 1000;
    const res = mapstate.apply(map, type, p, library.media);
    if (!res.changed) { if (pushed) h.drop(); return { ok: false }; }
    if (RoomLights && (type === 'spell.add' || type === 'spell.burst') && mapId === state.liveMapId) { // a spell on the table: its colour flashes
      const sk = FXDATA.SKINS[p.skin || ((map.spells || []).find((x) => x.id === (res.selected || p.id)) || {}).skin];
      if (sk) RoomLights.event('spell', sk.c);
    }
    if (type === 'layer.update' && p.drag && !p.final) return dragLive(map, p, res); // Prototype 14
    if (type === 'layer.update' && dragEnd.has(mapId)) { clearTimeout(dragEnd.get(mapId)); dragEnd.delete(mapId); } // let go: the full state follows now
    bumpRev(mapId);
    if (p.byPhone && type === 'layer.update' && p.id) { if (!phoneMoves.has(mapId)) phoneMoves.set(mapId, new Map()); phoneMoves.get(mapId).set(p.id, Date.now()); } // (Prototype 14)
    const walled = type === 'bg.set' ? wallsForBg(map, p) : null;
    if (map.light.memory) mapstate.recordSeen(map);
    if (res.fog || res.changed === 'fog') bumpFog(mapId);
    store.touch(mapId);
    if (res.changed === 'fog') { sendFogDelta(mapId, res.fogDelta); if (pushed) broadcastHistoryOnly(); }
    else broadcast();
    // what the party sees now goes into the fog (party lights moved, doors opened ...)
    for (const op of mapstate.recordSight(map, lastSight(mapId), !!p.final)) { bumpFog(mapId); sendFogDelta(mapId, { op }); }
    return { ok: true, selected: res.selected || null, label: (walled && walled.label) || res.label || null, undoable: true, mapId, ended: res.ended || null, walls: res.walls || null };
  }

  switch (type) {
    // ----- history -----
    case 'history.undo':
    case 'history.redo': {
      const map = store.map(p.mapId || state.editMapId);
      if (!map) return { ok: false };
      // Prototype 14: the tokens the phones moved since that copy was taken stay where they are now
      const moved = phoneMoves.get(map.id); const keep = new Map();
      if (moved) for (const l of map.layers) if (moved.has(l.id)) keep.set(l.id, { x: l.x, y: l.y, t: moved.get(l.id) });
      // the players' eyes (no undo steps) and what they saw stay too: undo never takes them away
      const eyes = (map.fx || []).filter((f) => f.eye);
      const eyeIds = new Set(eyes.map((f) => f.id));
      const seen = ((map.fog && map.fog.ops) || []).filter((o) => o.shape === 'sight' && o.eye && eyeIds.has(o.eye));
      const ok = store.history(map.id).step(map, type === 'history.undo' ? 'undo' : 'redo');
      if (ok && keep.size) for (const l of map.layers) { const k = keep.get(l.id); if (k && k.t > ok) { l.x = k.x; l.y = k.y; } }
      if (ok && eyes.length) {
        map.fx = map.fx.filter((f) => !f.eye && !eyeIds.has(f.id)).concat(eyes);
        const have = new Set(map.fog.ops.map((o) => o.id));
        for (const o of seen) if (!have.has(o.id)) map.fog.ops.push(o);
      }
      if (ok) { bumpFog(map.id); bumpRev(map.id); store.touch(map.id); broadcast(); }
      return { ok, label: ok ? (type === 'history.undo' ? 'Undone' : 'Redone') : null };
    }

    // ----- campaign structure -----
    case 'map.reset': { // Beta 1: a damaged map starts over empty
      if (!store.resetMap(p.id)) return { ok: false };
      bumpFog(p.id);
      broadcast();
      return { ok: true, label: 'Map started over' };
    }
    case 'chapter.add': case 'chapter.rename': case 'chapter.remove': case 'chapter.restore':
    case 'chapter.move': case 'chapter.ambience': case 'chapter.fight':
    case 'map.add': case 'map.rename': case 'map.duplicate': case 'map.remove': case 'map.restore': case 'map.move': {
      const res = store.structure(type, p);
      if (!res.ok) return res;
      // a new map made from a Universal VTT file (or a map with a walls file next to it) brings its walls
      if (type === 'map.add' && p.path && store.map(res.id)) wallsForBg(store.map(res.id), { path: p.path });
      const ids = store.allMapIds();
      if (type === 'map.add' || type === 'map.duplicate') { bumpFog(res.id); if (p.open !== false) setEdit(res.id); }
      if (!ids.includes(state.liveMapId)) state.liveMapId = null;
      if (!ids.includes(state.editMapId)) state.editMapId = state.liveMapId || ids[0] || null;
      if (type === 'chapter.add' && p.withMap !== false) {
        // a new chapter starts with one empty map so there is something to open
        const r = store.structure('map.add', { chapterId: res.id, name: 'New map' });
        bumpFog(r.id);
        setEdit(r.id);
      }
      broadcast();
      return res;
    }

    // ----- walls from a file (Universal VTT or Foundry VTT) onto the map being edited -----
    case 'walls.load': {
      const map = store.map(p.mapId || state.editMapId);
      if (!map || !p.path) return { ok: false };
      let n;
      try { n = WallsImport.read(p.path, { scene: p.scene, prefer: map.bg ? map.bg.name : map.name }); } catch (e) { return { ok: false, error: `Could not read the walls: ${e.message}` }; }
      if (n.choose) return { ok: false, choose: n.choose };
      store.history(map.id).before(map, null, 'wall.import');
      let res;
      if (WallsImport.isVtt(p.path) && !map.bg && n.hasImage) {
        mapstate.apply(map, 'bg.set', { path: p.path }, library.media);
        res = importWalls(map, n, { fresh: true });
      } else res = importWalls(map, n, { fresh: false });
      store.touch(map.id);
      broadcast();
      for (const op of mapstate.recordSight(map, lastSight(map.id), true)) { bumpFog(map.id); sendFogDelta(map.id, { op }); }
      return { ok: true, label: res.label, undoable: true, walls: map.walls.length };
    }

    // ----- what the GM edits / what the table shows -----
    case 'edit.open':
      setEdit(p.id);
      broadcast();
      return { ok: true };
    case 'table.send': {
      const id = p.id || state.editMapId;
      if (!store.map(id)) return { ok: false };
      if (state.liveMapId !== id) state.moments = state.moments.filter((m) => m.x == null); // a moment at a spot stays with its map
      if (state.show && state.show.mapId !== id) showDrop(); // (Beta 3.2: a token shown from the map before)
      state.liveMapId = id;
      state.blackout = false;
      state.title = null; // the session's title gives way to the first map
      tip('sent');
      if (!player) openPlayer();
      broadcast();
      return { ok: true, label: `${store.map(id).name} is on the table` };
    }
    case 'table.live':
      if (state.liveMapId) setEdit(state.liveMapId);
      broadcast();
      return { ok: true };
    case 'table.blackout':
      state.blackout = 'on' in p ? !!p.on : !state.blackout;
      state.blackoutPreview = false;
      if (state.blackout && p.open && !player) openPlayer();
      broadcast();
      return { ok: true, label: state.blackout ? 'Table blacked out' : null };
    case 'table.open': openPlayer(); return { ok: true };
    case 'table.close': closePlayer(); return { ok: true };
    case 'table.toggle': if (player) closePlayer(); else openPlayer(); return { ok: true };
    case 'table.calibrate':
      state.calibrating = !!p.on;
      if (state.calibrating && !player) openPlayer();
      broadcast();
      return { ok: true };
    case 'table.test': // Options → Picture: grey steps and colours, or the reference picture, on the TV to set the picture by
      state.testPicture = p.on ? (p.kind === 'reference' ? 'reference' : 'pattern') : false;
      if (state.testPicture && !player) openPlayer();
      broadcast();
      return { ok: true };

    // ----- screen moments (moments.js): earthquake, gas, blood ... over the whole TV -----
    case 'moment.play': {
      const d = Moments.BY[p.id];
      if (!d) return { ok: false };
      const now = Date.now();
      if (d.id === 'lightning') { handle('strike.now', {}); return { ok: true, closed: !player }; }
      // a lasting moment that is on: a second click stops it
      const on = state.moments.find((m) => m.id === d.id && !m.stop);
      if (on && !d.dur && p.toggle !== false) { on.stop = now; broadcast(); return { ok: true, stopped: true, label: `${d.label} stopped` }; }
      if (on && !d.dur) return { ok: true }; // a cue turns it on: it already is
      state.moments = state.moments.filter((m) => Moments.alive(m, now));
      const at = d.spot && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) && p.x !== null && p.y !== null;
      const m = { key: `mo${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, id: d.id, seed: 1 + Math.floor(Math.random() * 997), x: at ? Number(p.x) : null, y: at ? Number(p.y) : null, mapId: (at && p.mapId) || state.liveMapId, t0: now, dur: d.dur, stop: null };
      state.moments.push(m);
      while (state.moments.length > 6) state.moments.shift();
      if (RoomLights && d.dur) RoomLights.event('moment', d.id);
      if (p.sound !== false && player) {
        const snd = momentSound(d.id, true); // a sound just added to Audio/SFX counts at once
        if (snd && snd.url) sendEvent({ kind: 'sound', url: snd.url, name: snd.builtin ? `moment-${d.id}` : snd.name, volume: settings.boardVolume ?? 0.8, id: now });
      }
      broadcast();
      return { ok: true, key: m.key, closed: !player, label: d.dur ? null : `${d.label}: click it again to stop it` };
    }
    // ----- dice, the wheel of luck, death saves -----
    case 'dice.roll': case 'wheel.spin': case 'death.roll': {
      let r;
      if (type === 'dice.roll') r = rollDice(p);
      else if (type === 'wheel.spin') r = spinWheel(p);
      else { const value = randomInt(1, 21); r = { ok: true, roll: { kind: 'death', value, good: value >= 10, label: value >= 10 ? 'Success' : 'Failure', stops: [REEL.death], reveal: REEL.death + REEL.after } }; }
      if (!r.ok) return r;
      const now = Date.now();
      const dur = r.roll.reveal + (r.roll.kind === 'dice' ? 6000 : 6500);
      const roll = { id: `r${now.toString(36)}${randomInt(0, 1296).toString(36)}`, t0: now + 60, dur, seed: randomInt(1, 1e9), ...r.roll };
      state.dice = roll;
      if (RoomLights && roll.crit) setTimeout(() => RoomLights.event(roll.crit), roll.reveal || 0);
      logRoll({ id: roll.id, kind: roll.kind, t0: roll.t0, reveal: roll.reveal, label: roll.kind === 'dice' ? roll.label : roll.kind === 'wheel' ? roll.title : 'Death save',
        total: roll.kind === 'dice' ? roll.total : roll.kind === 'death' ? roll.value : roll.label, dice: roll.dice || null, good: roll.good ?? null, crit: roll.crit || null });
      broadcast();
      return { ok: true, id: roll.id, closed: !player, roll };
    }
    case 'dice.clear':
      if (!state.dice) return { ok: false };
      state.dice = null;
      broadcast();
      return { ok: true };
    case 'wheel.save': {
      if (!store.cur || !p.wheel) return { ok: false };
      const list = [...wheelList()];
      const i = list.findIndex((x) => x.id === p.wheel.id);
      const w = cleanWheel(p.wheel, i >= 0 ? list[i] : null);
      if (i >= 0) list[i] = w; else list.push(w);
      store.cur.meta.wheels = list.slice(0, 40);
      store.touch();
      broadcast();
      return { ok: true, id: w.id };
    }
    // one entry at a time, on the wheel as it is now (two quick additions never overwrite each other)
    case 'wheel.edit': {
      if (!store.cur) return { ok: false };
      const list = [...wheelList()];
      const i = list.findIndex((x) => x.id === p.id);
      if (i < 0) return { ok: false };
      const w = list[i];
      let entries = w.entries.map((e) => ({ ...e }));
      if (p.add && String(p.add.label ?? '').trim()) entries.push({ label: String(p.add.label).trim(), weight: p.add.weight ?? 1, color: p.add.color || DICE_COLORS[entries.length % DICE_COLORS.length] });
      if (p.update && p.update.entryId) entries = entries.map((e) => (e.id === p.update.entryId ? { ...e, ...p.update.patch, id: e.id } : e));
      if (p.remove) entries = entries.filter((e) => e.id !== p.remove);
      list[i] = cleanWheel({ ...w, entries }, w);
      store.cur.meta.wheels = list.slice(0, 40);
      store.touch();
      broadcast();
      return { ok: true, id: w.id };
    }
    // ----- tables for the wheel: paste, files, the library's Tables folder, back out as CSV (renderer/table-parse.js) -----
    case 'wheel.import': {
      // entries the GM screen read from pasted text: a new wheel, or more entries for one (into)
      if (!store.cur) return { ok: false };
      const entries = (p.entries || []).filter((e) => String(e.label || '').trim());
      if (!entries.length) return { ok: false, error: 'No entries in that text' };
      const list = [...wheelList()];
      const i = p.into ? list.findIndex((x) => x.id === p.into) : -1;
      if (i < 0 && list.length >= 40) return { ok: false, error: 'Forty wheels at most' };
      const w = i >= 0 ? cleanWheel({ ...list[i], entries: [...list[i].entries, ...entries.map(({ label, weight }) => ({ label, weight }))] }, list[i])
        : cleanWheel({ name: p.name || 'Table', entries: entries.map(({ label, weight }) => ({ label, weight })) }, null);
      if (i >= 0) list[i] = w; else list.push(w);
      store.cur.meta.wheels = list;
      store.touch();
      broadcast();
      return { ok: true, id: w.id, label: i >= 0 ? `${entries.length} entries added to ${w.name}` : `${w.name}: ${w.entries.length} entries` };
    }
    case 'wheel.importFiles': {
      // .txt, .csv, .md files (from the PC or the library): one wheel each, named after the file
      if (!store.cur) return { ok: false };
      return (async () => {
        let files = p.paths || null;
        if (!files) {
          const r = await dialog.showOpenDialog(gm, { title: 'Tables for the wheel', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Tables', extensions: ['txt', 'csv', 'md', 'tsv'] }] });
          if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
          files = r.filePaths;
        }
        const made = []; const empty = [];
        for (const f of files.slice(0, 40)) {
          let text = '';
          try { if (fs.statSync(f).size < 1024 * 1024) text = fs.readFileSync(f, 'utf8'); } catch {}
          const name = path.parse(f).name.replace(/[_]+/g, ' ').trim();
          const t = TableParse.parse(text, { name });
          if (!t.entries.length) { empty.push(name); continue; }
          const r = handle('wheel.import', { name, entries: t.entries });
          if (r.ok) made.push({ id: r.id, name, n: t.entries.length }); else empty.push(name);
        }
        const label = made.length ? (made.length > 1 ? `${made.length} wheels added` : `${made[0].name}: ${made[0].n} entries`) : 'No entries in that file';
        return { ok: made.length > 0, made, empty, label, id: made.length ? made[made.length - 1].id : null };
      })();
    }
    case 'wheel.library': {
      // the tables in the library (Tables), the same for every campaign
      const dir = library.root ? path.join(library.root, 'Tables') : null;
      const out = [];
      const walk = (d, depth) => {
        let list = [];
        try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const x of list) {
          if (out.length >= 200) return;
          const f = path.join(d, x.name);
          if (x.isDirectory() && depth < 3 && !x.name.startsWith('.')) walk(f, depth + 1);
          else if (x.isFile() && /\.(txt|csv|md|tsv)$/i.test(x.name)) {
            let t = { entries: [], die: null };
            try { if (fs.statSync(f).size < 1024 * 1024) t = TableParse.parse(fs.readFileSync(f, 'utf8')); } catch {}
            out.push({ path: f, rel: path.relative(dir, f).split(path.sep).join('/'), name: path.parse(f).name, n: t.entries.length, die: t.die });
          }
        }
      };
      if (dir) { fs.mkdirSync(dir, { recursive: true }); walk(dir, 0); }
      out.sort((a, b) => a.rel.localeCompare(b.rel));
      return { ok: true, dir, tables: out };
    }
    case 'wheel.export': {
      // as a CSV file: where the GM picks (to: 'file') or into the library's Tables folder (to: 'library')
      const w = wheelList().find((x) => x.id === p.id);
      if (!w) return { ok: false };
      const base = w.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Wheel';
      return (async () => {
        let file = p.file || null;
        if (!file && p.to === 'library') {
          const dir = path.join(library.root, 'Tables');
          fs.mkdirSync(dir, { recursive: true });
          file = path.join(dir, `${base}.csv`);
          for (let k = 2; fs.existsSync(file); k++) file = path.join(dir, `${base} (${k}).csv`);
        }
        if (!file) {
          const r = await dialog.showSaveDialog(gm, { title: 'Export the wheel', defaultPath: path.join(app.getPath('documents'), `${base}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
          if (r.canceled || !r.filePath) return { ok: false, canceled: true };
          file = r.filePath;
        }
        try { fs.writeFileSync(file, '\ufeff' + TableParse.toCsv(w)); } catch (e) { return { ok: false, error: `Could not save: ${e.message}` }; }
        return { ok: true, path: file, label: p.to === 'library' ? `${w.name} is in the library now (Tables)` : `Saved as ${path.basename(file)}` };
      })();
    }
    case 'wheel.remove': {
      if (!store.cur) return { ok: false };
      const list = [...wheelList()];
      const i = list.findIndex((x) => x.id === p.id);
      if (i < 0) return { ok: false };
      const [w] = list.splice(i, 1);
      store.cur.meta.wheels = list;
      store.touch();
      broadcast();
      return { ok: true, label: `${w.name} deleted`, undo: { type: 'wheel.restore', payload: { wheel: w, index: i } } };
    }
    case 'wheel.restore': {
      if (!store.cur || !p.wheel) return { ok: false };
      const list = [...wheelList()];
      list.splice(Math.min(list.length, p.index || 0), 0, p.wheel);
      store.cur.meta.wheels = list;
      store.touch();
      broadcast();
      return { ok: true, label: `${p.wheel.name} is back` };
    }
    case 'moment.stop': {
      const now = Date.now();
      let n = 0;
      for (const m of state.moments) if (!m.stop && (!p.id || m.id === p.id || m.key === p.id)) { m.stop = now; n++; }
      if (n) broadcast();
      return { ok: true, stopped: n, label: n ? (p.id ? null : 'Screen effects stopped') : null };
    }

    // ----- cues: map, light, weather, effects, fog, sound and a moment in one click -----
    case 'cue.save': {
      if (!store.cur) return { ok: false };
      const map = store.map(p.mapId || state.editMapId);
      if (!map) return { ok: false };
      const list = cueList();
      const used = new Set(list.map((c) => c.slot).filter(Boolean));
      const slot = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !used.has(n)) || null;
      const c = { id: mapstate.newId('q'), name: String(p.name || `Cue ${list.length + 1}`).trim().slice(0, 60) || 'Cue', slot, mapId: map.id, parts: cueParts(p), data: cueCapture(map, p) };
      store.cur.meta.cues = [...list, c];
      store.touch();
      broadcast();
      return { ok: true, id: c.id, label: `${c.name} saved${slot ? ` (F${slot})` : ''}` };
    }
    case 'cue.update': {
      const c = cueList().find((x) => x.id === p.id);
      if (!c) return { ok: false };
      if (p.name != null) c.name = String(p.name).trim().slice(0, 60) || c.name;
      if ('slot' in p) {
        const n = Number(p.slot);
        const slot = Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
        if (slot) for (const o of cueList()) if (o !== c && o.slot === slot) o.slot = c.slot || null; // they swap keys
        c.slot = slot;
      }
      if (p.parts) c.parts = cueParts(p, c);
      if (p.recapture) { const map = store.map(state.editMapId); if (map) { c.mapId = map.id; c.data = cueCapture(map, p, c.data); } }
      else if ('moment' in p || 'play' in p || 'spotify' in p) {
        c.data = { ...c.data, ...('moment' in p ? { moment: Moments.BY[p.moment] ? p.moment : null } : {}), ...('play' in p ? { play: p.play || null } : {}), ...('spotify' in p ? { spotify: p.spotify ? String(p.spotify).slice(0, 40) : null } : {}) };
        if ('spotify' in p && !(p.parts && 'spotify' in p.parts)) c.parts = { ...c.parts, spotify: !!c.data.spotify };
        // picking a sound or a moment switches that part on (None switches it off)
        if ('moment' in p && !(p.parts && 'moment' in p.parts)) c.parts = { ...c.parts, moment: !!c.data.moment };
        if ('play' in p && !(p.parts && 'sound' in p.parts)) c.parts = { ...c.parts, sound: !!c.data.play };
      }
      store.touch();
      broadcast();
      return { ok: true, label: p.recapture ? `${c.name}: saved from the scene again` : null };
    }
    case 'cue.move': {
      const list = cueList();
      const i = list.findIndex((x) => x.id === p.id);
      const j = i + (p.dir > 0 ? 1 : -1);
      if (i < 0 || j < 0 || j >= list.length) return { ok: false };
      [list[i], list[j]] = [list[j], list[i]];
      store.touch();
      broadcast();
      return { ok: true };
    }
    case 'cue.remove': {
      const list = cueList();
      const i = list.findIndex((x) => x.id === p.id);
      if (i < 0) return { ok: false };
      const [c] = list.splice(i, 1);
      store.touch();
      broadcast();
      return { ok: true, label: `${c.name} deleted`, undo: { type: 'cue.restore', payload: { cue: c, index: i } } };
    }
    case 'cue.restore': {
      if (!store.cur || !p.cue) return { ok: false };
      const list = cueList();
      list.splice(Math.min(list.length, p.index || 0), 0, p.cue);
      store.cur.meta.cues = list;
      store.touch();
      broadcast();
      return { ok: true, label: `${p.cue.name} is back` };
    }
    case 'cue.play': {
      const c = cueList().find((x) => x.id === p.id || (p.slot && x.slot === p.slot));
      if (!c) return { ok: false };
      const P = c.parts || {};
      const D = c.data;
      const target = P.map ? store.map(c.mapId) : store.map(state.liveMapId) || store.map(state.editMapId);
      if (!target) return { ok: false, error: `${c.name}: its map is gone.` };
      const key = `cue-${c.id}-${Date.now()}`;
      const on = (type, q) => handle(type, { mapId: target.id, coalesce: key, stepLabel: `Cue ${c.name}`, ...q });
      if (P.map) {
        if (state.liveMapId !== target.id) handle('table.send', { id: target.id });
        setEdit(target.id);
        on('view.update', D.view);
      }
      if (P.light) on('light.update', { darkness: D.light.darkness, tint: D.light.tint, mood: D.light.mood || null, fade: 2 });
      if (P.weather) on('weather.preset', { name: D.weather.name, layers: D.weather.layers });
      if (P.effects && target.id === c.mapId) for (const f of target.fx) if (f.id in D.fx && !!f.hidden !== D.fx[f.id]) on('fx.update', { id: f.id, hidden: D.fx[f.id] });
      if (P.fog) on('fog.enabled', { enabled: D.fog.enabled });
      if (P.fight) state.fightNow = !!D.fight;
      if (P.sound && D.play) handle('sound.play', { path: D.play });
      if (P.moment && D.moment) handle('moment.play', { id: D.moment, toggle: false });
      if (P.spotify && D.spotify && spotifyMood(D.spotify)) spotifyPlay(D.spotify);
      broadcast();
      return { ok: true, label: c.name };
    }

    // ----- snapshots (2.1): the map as it is now, saved; played back from its timeline -----
    case 'snap.save': {
      if (!store.cur) return { ok: false };
      const map = store.map(p.mapId || state.editMapId);
      if (!map) return { ok: false };
      if (!Array.isArray(map.snaps)) map.snaps = [];
      if (map.snaps.length >= SNAPS_MAX) return { ok: false, error: `A map keeps up to ${SNAPS_MAX} snapshots` };
      const n = map.snaps.length + 1;
      const s = { id: mapstate.newId('q'), name: String(p.name || '').trim().slice(0, 60) || `Snapshot ${n}`, t: Date.now(), data: mapstate.sceneOf(map), trans: cleanTrans(n > 1 ? p.trans : null), thumb: null };
      saveSnapThumb(s, p.thumb);
      map.snaps.push(s);
      map.snapAt = s.id;
      store.touch(map.id);
      broadcast();
      return { ok: true, id: s.id, n, label: `${s.name} saved${n <= 8 ? ` (F${n})` : ''}` };
    }
    case 'snap.update': { // a new name, how it comes in
      const f = findSnap(p.id);
      if (!f) return { ok: false };
      if (p.name != null) f.s.name = String(p.name).trim().slice(0, 60) || f.s.name;
      if (p.trans === null) f.s.trans = cleanTrans(null);
      else if (p.trans) f.s.trans = cleanTrans(p.trans, f.s.trans);
      store.touch(f.map.id);
      broadcast();
      return { ok: true };
    }
    case 'snap.resave': { // the map as it is now goes into it
      const f = findSnap(p.id);
      if (!f) return { ok: false };
      const old = { data: f.s.data, t: f.s.t, thumb: f.s.thumb };
      f.s.data = mapstate.sceneOf(f.map);
      f.s.t = Date.now();
      saveSnapThumb(f.s, p.thumb);
      f.map.snapAt = f.s.id;
      store.touch(f.map.id);
      broadcast();
      return { ok: true, label: `${f.s.name}: saved again`, undo: { type: 'snap.put', payload: { id: f.s.id, ...old } } };
    }
    case 'snap.put': { // (undo of saving again)
      const f = findSnap(p.id);
      if (!f || !p.data) return { ok: false };
      Object.assign(f.s, { data: p.data, t: p.t || f.s.t, thumb: p.thumb || null });
      store.touch(f.map.id);
      broadcast();
      return { ok: true, label: `${f.s.name} as it was` };
    }
    case 'snap.move': { // earlier or later on the timeline
      const f = findSnap(p.id);
      if (!f) return { ok: false };
      const list = f.map.snaps;
      const i = list.indexOf(f.s);
      const j = Number.isInteger(p.to) ? Math.max(0, Math.min(list.length - 1, p.to)) : i + (p.dir > 0 ? 1 : -1);
      if (j < 0 || j >= list.length || j === i) return { ok: false };
      list.splice(i, 1);
      list.splice(j, 0, f.s);
      store.touch(f.map.id);
      broadcast();
      return { ok: true };
    }
    case 'snap.remove': {
      const f = findSnap(p.id);
      if (!f) return { ok: false };
      const i = f.map.snaps.indexOf(f.s);
      f.map.snaps.splice(i, 1);
      store.touch(f.map.id);
      broadcast();
      return { ok: true, label: `${f.s.name} deleted`, undo: { type: 'snap.restore', payload: { mapId: f.map.id, snap: f.s, index: i } } };
    }
    case 'snap.restore': {
      const map = store.map(p.mapId);
      if (!map || !p.snap || !p.snap.id) return { ok: false };
      if (!Array.isArray(map.snaps)) map.snaps = [];
      if (map.snaps.some((x) => x.id === p.snap.id)) return { ok: false };
      map.snaps.splice(Math.min(map.snaps.length, p.index || 0), 0, p.snap);
      store.touch(map.id);
      broadcast();
      return { ok: true, label: `${p.snap.name} is back` };
    }
    case 'snap.play': {
      // which one: by id; or n (F1 to F8) or next, on the map on the table (else on the one open here)
      let f = p.id && p.id !== 'next' ? findSnap(p.id) : null;
      if (!f && (p.n || p.next || p.id === 'next')) {
        const m = snapMap(p.mapId);
        const list = snapsOf(m);
        if (!list.length) return { ok: false, error: 'This map has no snapshots yet', none: true };
        let i;
        if (p.n) i = Number(p.n) - 1;
        else {
          i = list.findIndex((x) => x.id === m.snapAt) + 1;
          if (i >= list.length) return { ok: false, error: `${list[list.length - 1].name} was the last snapshot`, last: true };
        }
        if (!list[i]) return { ok: false, error: `${m.name} has no snapshot ${p.n}`, none: true };
        f = { map: m, s: list[i] };
      }
      if (!f) return { ok: false, error: 'This snapshot is gone' };
      const { map, s } = f;
      // leaving a snapshot the map was changed since, at the table: keep how it was, the GM may still want it (snap.keep)
      let unsaved = null;
      const prev = snapsOf(map).find((x) => x.id === map.snapAt);
      if (p.offerSave && prev && !mapstate.sceneMatches(map, prev.data)) {
        snapKeep = { id: prev.id, mapId: map.id, data: mapstate.sceneOf(map) };
        unsaved = { id: prev.id, name: prev.name, what: sceneChanges(prev.data, snapKeep.data) };
      }
      // quiet: onto the map only (to look at it or change it), no transition, the table stays as it is.
      // A map that is not on the table (while the table shows another one) is never sent there by a snapshot (2.2)
      const away = !!player && state.liveMapId !== map.id;
      const quiet = !!p.quiet || away;
      if (quiet || !player) setEdit(map.id);
      const t = s.trans || {};
      handle('scene.apply', { mapId: map.id, scene: s.data, fade: !quiet && t.fade ? 10 : 0, stepLabel: `Snapshot ${s.name}`, coalesce: `snap-${Date.now()}` });
      if (!quiet) {
        // 2.5: a lasting moment (poison gas, dread, frost …) a snapshot brought belongs to that snapshot: it ends when
        // another one comes, unless that one brings the same. Moments started from the Toolbox are left alone.
        const next = t.moment && Moments.BY[t.moment] ? t.moment : null;
        const nowT = Date.now();
        for (const mo of state.moments) if (mo.snap && !mo.stop && !mo.dur && mo.id !== next) mo.stop = nowT;
        if (next) {
          const mr = handle('moment.play', { id: next, toggle: false });
          // started now, or still on from the snapshot before (one started by hand stays the GM's)
          const mo = state.moments.find((x) => (mr && mr.key ? x.key === mr.key : x.id === next && !x.stop && x.snap));
          if (mo) mo.snap = s.id;
        }
        if (t.sound) handle('sound.play', { path: t.sound });
        if (t.music === 'fight') state.fightNow = true;
        else if (t.music === 'calm') state.fightNow = false;
        else if (t.music === 'mood' && t.mood && spotifyMood(t.mood)) spotifyPlay(t.mood);
      }
      map.snapAt = s.id;
      store.touch(map.id);
      broadcast();
      return { ok: true, id: s.id, mapId: map.id, label: s.name, unsaved, away };
    }
    case 'snap.keep': { // the changes made before switching away go into that snapshot after all
      const f = findSnap(p.id);
      if (!f || !snapKeep || snapKeep.id !== p.id) return { ok: false, error: 'Those changes are gone' };
      const old = { data: f.s.data, t: f.s.t, thumb: f.s.thumb };
      f.s.data = snapKeep.data;
      f.s.t = Date.now();
      snapKeep = null;
      // 4.3: the same snapshot played again (it is on the table now): the table shows what was just saved into it,
      // or the map would still differ from it and every press would ask again
      if (f.map.snapAt === f.s.id) handle('scene.apply', { mapId: f.map.id, scene: f.s.data, fade: 0, stepLabel: `Snapshot ${f.s.name}`, coalesce: `snap-${Date.now()}` });
      store.touch(f.map.id);
      broadcast();
      return { ok: true, label: `${f.s.name}: the changes are saved in it`, undo: { type: 'snap.put', payload: { id: f.s.id, ...old } } };
    }

    // ----- countdown on the TV -----
    case 'timer.start': {
      const seconds = Math.min(5999, Math.max(1, Math.round(Number(p.seconds) || 30)));
      state.timer = {
        id: `t${Date.now().toString(36)}`, mode: p.mode === 'dramatic' ? 'dramatic' : 'normal', total: seconds,
        endsAt: Date.now() + seconds * 1000, left: null, label: String(p.label || '').slice(0, 80), sound: p.sound !== false, side: ['left', 'center'].includes(p.side) ? p.side : 'right',
      };
      if (!player) openPlayer();
      broadcast();
      return { ok: true };
    }
    case 'timer.pause':
      if (!state.timer || !state.timer.endsAt) return { ok: false };
      state.timer.left = Math.max(0, state.timer.endsAt - Date.now());
      state.timer.endsAt = null;
      broadcast();
      return { ok: true };
    case 'timer.resume':
      if (!state.timer || state.timer.endsAt) return { ok: false };
      state.timer.endsAt = Date.now() + (state.timer.left || 0);
      state.timer.left = null;
      broadcast();
      return { ok: true };
    case 'timer.side': // move a running dial
      if (!state.timer) return { ok: false };
      state.timer.side = ['left', 'center'].includes(p.side) ? p.side : 'right';
      broadcast();
      return { ok: true };
    case 'timer.add': {
      const t = state.timer;
      if (!t) return { ok: false };
      const ms = Math.round(Number(p.seconds) || 0) * 1000;
      if (t.endsAt) { if (t.endsAt <= Date.now()) return { ok: false }; t.endsAt = Math.max(Date.now() + 1000, t.endsAt + ms); } else t.left = Math.max(1000, (t.left || 0) + ms);
      t.total = Math.max(1, t.total + ms / 1000);
      broadcast();
      return { ok: true };
    }
    case 'timer.stop':
      state.timer = null;
      broadcast();
      return { ok: true };

    // 4.5: Build → Map → Hold: original: the map without its colours, while the button is held
    case 'look.peek':
      sendEvent({ kind: 'lookPeek', on: !!p.on });
      return { ok: true };
    // 4.8: the GM took the Map tool (or put it away): the TV keeps its fog ready for a move
    case 'move.prepare':
      if (player && !player.isDestroyed()) player.webContents.send('event', { kind: 'prepMove', on: !!p.on });
      return { ok: true };
    // 4.5: Options → Looks on the TV: try a look on the TV without changing anything
    case 'look.try': {
      const what = LOOK_PARTS.includes(p.what) ? p.what : 'map';
      if (!player || player.isDestroyed()) return { ok: false, why: 'no-tv' };
      // (Prototype 7) as it is set now, or the style asked for: a look, or a variant of one
      const L = TABLE_STYLES[p.look] ? { base: TABLE_STYLES[p.look], variant: p.look === TABLE_STYLES[p.look] ? null : p.look } : what === 'map' && p.look === 'fade' ? { base: 'fade', variant: null } : lookFor(what);
      sendEvent({ kind: 'lookTry', what, look: L.base, variant: L.variant, size: settings.talk && settings.talk.size });
      return { ok: true };
    }
    // ----- Beta 3.2: show a token to the table -----
    case 'show.start': { // { id, reveal }: a token of the map on the table; while one turns, it joins the show
      const map = store.map(state.liveMapId);
      if (state.screen !== 'play' || !map) return { ok: false, error: 'Send the map to the table first' };
      const l = map.layers.find((x) => x.id === p.id && x.role === 'token');
      if (!l) return { ok: false, error: state.editMapId !== state.liveMapId ? 'This map is not on the table' : 'That token is gone' };
      const now = Date.now();
      let s = state.show;
      if (!s || s.phase !== 'show' || s.mapId !== map.id) {
        const sides = showSides();
        s = state.show = { id: `s${now.toString(36)}`, mapId: map.id, at: now, spinAt: now + SHOW_FLY, endAt: 0, phase: 'show', ids: [], turn: showTurn(sides), sides };
      }
      if (!s.ids.includes(l.id)) {
        if (s.ids.length >= SHOW_MAX) return { ok: false, error: `${SHOW_MAX} at a time` };
        s.ids.push(l.id);
      }
      // all turn together; the one that came last turns once whole, and they fly back on a whole turn
      s.endAt = s.spinAt + s.turn * Math.max(1, Math.ceil((now + SHOW_FLY + s.turn - s.spinAt - 50) / s.turn));
      if (p.reveal && l.hidden) handle('layer.update', { mapId: map.id, id: l.id, hidden: false });
      if (!player) openPlayer();
      showNext();
      broadcast();
      return { ok: true, ids: s.ids.slice() };
    }
    case 'show.end': // a click on the GM screen or Esc: back at once
      return { ok: showBack() };

    // ----- talk: NPC portraits over the map -----
    case 'talk.on':
      if (state.screen !== 'play' || !store.cur) return { ok: false, error: 'Start the table first: portraits show on the table while you play' }; // (Prototype 14)
      if (!state.talk) state.talk = { id: `k${Date.now().toString(36)}`, cast: [] };
      if (!player) openPlayer();
      broadcast();
      return { ok: true };
    case 'talk.off':
      state.talk = null;
      broadcast();
      return { ok: true };
    case 'talk.toggle': { // click a portrait: in, or out again; the newest stands in front
      if (!p.path) return { ok: false };
      if ((state.screen !== 'play' || !store.cur) && !p.out) return { ok: false, error: 'Start the table first: portraits show on the table while you play' }; // (Prototype 14: not from the campaign page)
      if (!state.talk) state.talk = { id: `k${Date.now().toString(36)}`, cast: [] };
      const cast = state.talk.cast;
      const i = cast.findIndex((c) => c.path === p.path);
      // Prototype 12: one standing behind comes to the front again; the one in front leaves
      if (i >= 0 && i < cast.length - 1 && !p.out) { cast.push(cast.splice(i, 1)[0]); if (!player) openPlayer(); broadcast(); return { ok: true, on: true, front: true }; }
      if (i >= 0) cast.splice(i, 1);
      else if (p.out) return { ok: true, on: false };
      else {
        const m = library.media(p.path);
        cast.push({ path: m.path, url: m.url, name: m.name, alpha: p.alpha !== false });
        while (cast.length > 3) cast.shift();
      }
      if (!player) openPlayer();
      broadcast();
      return { ok: true, on: i < 0 };
    }
    case 'talk.size': { // Prototype 12: one portrait bigger or smaller than the others (50 % to 200 %)
      if (!p.path) return { ok: false };
      settings.portraitSize = { ...(settings.portraitSize || {}) };
      const v = Math.round(Math.min(2, Math.max(0.5, Number(p.scale) || 1)) * 20) / 20;
      if (Math.abs(v - 1) < 0.001) delete settings.portraitSize[p.path]; else settings.portraitSize[p.path] = v;
      clearTimeout(sizeSaveT); sizeSaveT = setTimeout(saveSettings, 600); // (the slider sends many; save once it rests)
      broadcast();
      return { ok: true, scale: v };
    }
    case 'talk.offset': { // Prototype 13: one portrait moved: x a share of its width (−0.5 … 0.5), y of its height (−0.4 … 0.4, up is +)
      if (!p.path) return { ok: false };
      settings.portraitOffset = { ...(settings.portraitOffset || {}) };
      const cl = (v, m) => Math.round(Math.min(m, Math.max(-m, Number(v) || 0)) * 100) / 100;
      const o = { x: cl(p.x, 0.5), y: cl(p.y, 0.4) };
      if (!o.x && !o.y) delete settings.portraitOffset[p.path]; else settings.portraitOffset[p.path] = o;
      clearTimeout(sizeSaveT); sizeSaveT = setTimeout(saveSettings, 600);
      broadcast();
      return { ok: true, ...o };
    }
    case 'talk.mirror': {
      settings.portraitMirror = { ...(settings.portraitMirror || {}) };
      if (settings.portraitMirror[p.path]) delete settings.portraitMirror[p.path]; else settings.portraitMirror[p.path] = true;
      saveSettings();
      broadcast();
      return { ok: true };
    }

    // ----- handouts, break screen -----
    case 'handout.show': { // a click shows it alone (or puts it away); add: beside what lies there
      if (!p.path) return { ok: false };
      if (hoShown(p.path)) { state.handouts = state.handouts.filter((h) => h.path !== p.path); broadcast(); return { ok: true, shown: false }; }
      const m = library.media(p.path);
      const it = { path: m.path, url: m.url, name: m.name, t: Date.now() };
      state.handouts = p.add ? [...state.handouts, it].slice(-6) : [it];
      handoutShown(m);
      if (!player) openPlayer();
      broadcast();
      return { ok: true, shown: true, label: `${m.name} is on the table` };
    }
    case 'handout.hide': // one of them, or everything
      state.handouts = p && p.path ? state.handouts.filter((h) => h.path !== p.path) : [];
      broadcast();
      return { ok: true };
    case 'handout.layout': { // how this handout lies: remembered for the next time it is shown
      if (!p.path) return { ok: false };
      const k = hoKey(p.path);
      const all = settings.handoutLayout || {};
      const next = { ...(all[k] || {}), ...(p.patch || {}) };
      const clean = {};
      if ('both' in next) clean.both = !!next.both;
      for (const f of ['x', 'y']) if (Number.isFinite(Number(next[f])) && next[f] !== null) clean[f] = unit(next[f], 0.5);
      if (Number.isFinite(Number(next.size)) && next.size) clean.size = Math.min(1, Math.max(0.2, Number(next.size)));
      if (Number.isFinite(Number(next.rot))) clean.rot = ((Math.round(Number(next.rot) / 90) * 90) % 360 + 360) % 360;
      if (p.patch && p.patch.reset) delete all[k]; else all[k] = clean;
      const keys = Object.keys(all);
      if (keys.length > 400) for (const old of keys.slice(0, keys.length - 400)) delete all[old];
      settings.handoutLayout = all;
      saveSettings();
      broadcast();
      return { ok: true, layout: hoLayout(p.path) };
    }
    case 'handout.share': { // to: 'all', [player names] or nothing (taken back); send: at once, not only when it is shown
      if (!store.cur || !p.path) return { ok: false };
      const k = hoKey(p.path);
      const all = { ...(store.cur.meta.handoutShare || {}) };
      const to = p.to === 'all' ? 'all' : Array.isArray(p.to) ? [...new Set(p.to.map(String))].filter((n) => (store.cur.meta.party || []).includes(n)) : null;
      if (!to || (Array.isArray(to) && !to.length)) delete all[k];
      else all[k] = { to, sent: p.send || hoShown(p.path) ? Date.now() : (all[k] && all[k].sent) || 0 };
      store.cur.meta.handoutShare = all;
      store.touch();
      broadcast();
      return { ok: true, share: all[k] || null };
    }
    case 'break.start': {
      const min = Math.min(120, Math.max(1, Number(p.minutes) || 10));
      state.brk = { endsAt: Date.now() + min * 60000, total: min * 60, id: `b${Date.now().toString(36)}`, look: breakLook() };
      if (!player) openPlayer();
      broadcast();
      return { ok: true };
    }
    case 'break.end':
      state.brk = null;
      broadcast();
      return { ok: true };

    // ----- soundboard and lightning: played once on the table -----
    case 'sound.play': {
      if (!p.path || !fs.existsSync(p.path)) return { ok: false };
      sendEvent({ kind: 'sound', url: pathToFileURL(p.path).href, name: path.parse(p.path).name, volume: settings.boardVolume ?? 0.8, id: Date.now() });
      return { ok: true };
    }
    case 'sound.stop':
      sendEvent({ kind: 'stop' });
      return { ok: true };
    case 'strike.now': // (not 'weather.*': those are map commands)
      sendEvent({ kind: 'strike', seed: 1 + Math.random() * 1000, mapId: state.liveMapId });
      if (RoomLights) RoomLights.event('lightning');
      if (p.thunder !== false && player) soundEvent({ kind: 'thunder', delay: 0.35 + Math.random() * 0.5, volume: settings.sfxVolume ?? 0.7 });
      return { ok: true };
    case 'sound.quiet': { // all table sound fades out (and back in), Spotify too
      const was = !!state.quiet;
      state.quiet = 'on' in p ? !!p.on : !state.quiet;
      if (Spotify && Spotify.linked() && state.quiet !== was) {
        if (state.quiet && spotifyNow && spotifyNow.playing) { state.spotifyQuieted = true; Spotify.stop(); }
        else if (!state.quiet && state.spotifyQuieted) { state.spotifyQuieted = false; Spotify.resume(); }
      }
      broadcast();
      return { ok: true, quiet: state.quiet };
    }
    case 'sound.fight': // fight music by hand, without starting a fight in Initiative
      state.fightNow = 'on' in p ? !!p.on : !state.fightNow;
      broadcast();
      return { ok: true, on: state.fightNow };

    // ----- initiative -----
    case 'notes.set': {
      if (!store.cur) return { ok: false };
      const text = String(p.text ?? '').slice(0, 500000);
      const n = store.cur.meta.notes || {};
      if (text === (n.text || '')) return { ok: true };
      store.cur.meta.notes = { ...n, text, changed: Date.now() };
      store.touch();
      broadcast();
      return { ok: true };
    }
    case 'notes.export': {
      const r = exportNotes();
      broadcast();
      return r;
    }
    case 'party.set':
      if (!store.cur) return { ok: false };
      store.cur.meta.party = [...new Set((p.names || []).map((n) => String(n).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
      if (store.cur.meta.away) store.cur.meta.away = store.cur.meta.away.filter((n) => store.cur.meta.party.includes(n));
      store.touch();
      broadcast();
      return { ok: true };
    // ----- initiative (see initInfo) -----
    case 'init.prepare': {
      if (!store.cur) return { ok: false };
      let I = state.init;
      const fresh = !I;
      if (fresh) I = state.init = { mapId: null, running: false, turn: null, show: settings.initShow !== false, entries: [], groups: {}, dropped: [] };
      const changed = !I.running && syncInit(I);
      if (fresh || changed) broadcast();
      return { ok: true };
    }
    case 'init.add': {
      const I = state.init;
      if (!I || !store.cur) return { ok: false };
      const name = String(p.name || '').trim().slice(0, 40);
      if (!name) return { ok: false, error: 'A name, please' };
      const count = Math.max(1, Math.min(20, Number(p.count) || 1));
      const ac = initNum(p.ac); const hp = initNum(p.hp);
      const acCol = ac != null ? needCol('ac') : null;
      const hpCol = hp != null ? needCol('hp') : null;
      if (!p.pc) rememberFoe({ name, bonus: p.bonus, ac, hp });
      // Goblin ×3: Goblin 1, 2, 3 (going on from the Goblins already there)
      const base = baseName(name);
      const same = I.entries.filter((e) => baseName(e.name).toLowerCase() === base.toLowerCase());
      const lone = same.length === 1 && !/\d+$/.test(same[0].name) && !same[0].tokens.length ? same[0] : null;
      if (lone) { lone.name = `${base} 1`; lone.custom = true; } // the first Goblin becomes Goblin 1
      let k = Math.max(lone ? 1 : 0, ...same.map((e) => Number((/(\d+)$/.exec(e.name) || [])[1]) || 0));
      const gid = count > 1 && p.group ? `g${Date.now().toString(36)}${(initSeq++).toString(36)}` : null;
      if (gid) I.groups[gid] = { name: '' };
      const added = [];
      for (let i = 0; i < count; i++) {
        const vals = {};
        if (acCol) vals[acCol.id] = ac;
        if (hpCol) vals[hpCol.id] = { cur: hp, max: hp };
        const nm = count > 1 || same.length ? `${base} ${++k}` : name;
        added.push(newEntry({ name: nm, pc: !!p.pc, bonus: p.bonus, hidden: !!p.hidden, group: gid, vals, custom: true }));
      }
      I.entries.push(...added);
      // the same kind's tokens on the map take what they don't have yet (bonus, AC, HP)
      for (const e of I.entries) {
        if (e.pc || !e.tokens.length || baseName(e.name).toLowerCase() !== base.toLowerCase()) continue;
        if (!e.bonus && e.init == null) e.bonus = initNum(p.bonus) || 0;
        if (acCol && e.vals[acCol.id] == null) e.vals[acCol.id] = ac;
        if (hpCol && !e.vals[hpCol.id]) e.vals[hpCol.id] = { cur: hp, max: hp };
      }
      tidyInit(I);
      store.touch();
      broadcast();
      return { ok: true, ids: added.map((e) => e.id), label: count > 1 ? `${base} ×${count} added` : `${added[0].name} added` };
    }
    case 'init.addTokens': {
      const I = state.init;
      if (!I) return { ok: false };
      const toks = freshTokens(I).filter((t) => !p.ids || p.ids.includes(t.id));
      for (const t of toks) { const foe = foeOf(t.name); I.entries.push(newEntry({ name: tokName(t), tokens: [t.id], bonus: foe && foe.bonus, vals: knownVals(foe) })); }
      broadcast();
      return { ok: true, n: toks.length };
    }
    case 'init.addPc': { // Prototype 6: a player who was taken out of the turn order comes back in (also while the fight runs)
      const I = state.init; const c = store.cur;
      if (!I || !c) return { ok: false };
      const name = String(p.name || '');
      if (!(c.meta.party || []).includes(name)) return { ok: false, error: `${name || 'That player'} is not in the party` };
      if (I.entries.some((e) => e.pc && e.name === name)) return { ok: true };
      snapInit();
      I.dropped = I.dropped.filter((k) => k !== `pc:${name}`);
      const before = I.entries;
      I.entries = [...I.entries, newEntry({ name, pc: true, vals: knownVals(pcStats(name)) })];
      const m = store.map(I.mapId) || combatMap();
      if (m) linkCharTokens(I, m.layers.filter((l) => l.role === 'token'));
      tidyInit(I);
      keepTurn(I, before);
      broadcast();
      return { ok: true, label: `${name} is back in the turn order` };
    }
    case 'init.set': {
      // one entry (id) or a whole group (gid): name, init, bonus, hidden, column values
      const I = state.init;
      if (!I) return { ok: false };
      const missing = initMissing(I);
      const list = p.gid ? I.entries.filter((e) => e.group === p.gid) : I.entries.filter((e) => e.id === p.id);
      if (!list.length) return { ok: false };
      if (p.gid && 'name' in p) I.groups[p.gid] = { ...I.groups[p.gid], name: String(p.name || '').trim().slice(0, 40) };
      const group = list[0].group;
      for (const e of list) {
        if (!p.gid && 'name' in p && String(p.name).trim()) {
          if (e.pc && ((store.cur && store.cur.meta.party) || []).includes(e.name)) { const r = renamePc(e.name, p.name); if (!r.ok) return r; continue; } // (4.2.2) a player: renamed everywhere, not cut off from the card
          e.name = String(p.name).trim().slice(0, 40); e.custom = true;
        }
        if ('hidden' in p) e.hidden = !!p.hidden;
        if ('shown' in p) e.shown = !!p.shown; // 4.1: name and picture on the player screen (else "??")
        if (p.vals) {
          for (const [cid, v] of Object.entries(p.vals)) {
            const col = initCols().find((x) => x.id === cid);
            if (!col) continue;
            if (col.kind === 'hp') {
              const old = e.vals[cid] || { cur: null, max: null };
              const max = 'max' in v ? initNum(v.max) : old.max;
              let cur = 'delta' in v ? (old.cur ?? max ?? 0) + (initNum(v.delta) || 0) : 'cur' in v ? initNum(v.cur) : old.cur;
              if (cur != null && max != null && 'delta' in v) cur = Math.min(cur, max); // healing stops at the maximum
              e.vals[cid] = cur == null && max == null ? undefined : { cur, max };
              if (!e.vals[cid]) delete e.vals[cid];
            } else if (col.kind === 'ac' || col.kind === 'num') { const n = initNum(v); if (n == null) { delete e.vals[cid]; forgetPcVal(e, cid); } else e.vals[cid] = n; }
            else if (col.kind === 'cond') e.vals[cid] = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 24)))].slice(0, 12);
            else { const t = String(v ?? '').slice(0, 200); if (t) e.vals[cid] = t; else delete e.vals[cid]; }
          }
          rememberPc(e);
        }
      }
      // the initiative and the bonus belong to the whole group
      const all = group ? I.entries.filter((e) => e.group === group) : list;
      for (const e of all) {
        if ('init' in p) { e.init = initNum(p.init); e.roll = null; }
        if ('bonus' in p) e.bonus = initNum(p.bonus) || 0;
      }
      if ('bonus' in p && !list[0].pc) rememberFoe({ name: list[0].name, bonus: p.bonus });
      const sorted = 'init' in p && autoSort(I, missing);
      if (p.vals || 'bonus' in p) store.touch();
      broadcast();
      return { ok: true, sorted };
    }
    case 'init.roll': {
      // one entry or group, else every NPC without a number yet
      const I = state.init;
      if (!I) return { ok: false };
      const missing = initMissing(I);
      const ids = new Set(p.id ? [p.id] : I.entries.filter((e) => !e.pc && e.init == null).map((e) => e.id));
      if (!ids.size) return { ok: false, error: 'Every enemy has a number already' };
      rollFor(I, ids);
      const sorted = autoSort(I, missing);
      broadcast();
      return { ok: true, n: ids.size, sorted };
    }
    case 'init.sort': {
      const I = state.init;
      if (!I) return { ok: false };
      sortInit(I);
      broadcast();
      return { ok: true };
    }
    case 'init.move': {
      // id: an entry, or gid: a whole group; before: the entry it goes in front of (null: to the end).
      // Dropped between two members of a group it joins that group; a member dragged out of its group leaves it.
      const I = state.init;
      if (!I) return { ok: false };
      const moving = p.gid ? I.entries.filter((e) => e.group === p.gid) : I.entries.filter((e) => e.id === p.id);
      if (!moving.length) return { ok: false };
      const ids = new Set(moving.map((e) => e.id));
      const rest = I.entries.filter((e) => !ids.has(e.id));
      let at = p.before ? rest.findIndex((e) => e.id === p.before) : rest.length;
      if (at < 0) at = rest.length;
      const prev = rest[at - 1]; const next = rest[at];
      const inside = prev && next && prev.group && prev.group === next.group ? prev.group : null;
      if (p.gid) {
        if (inside) at = rest.findIndex((e) => e.group === inside); // a group doesn't go inside another one
      } else {
        const e = moving[0];
        if (inside) { e.group = inside; }
        else if (e.group && !((prev && prev.group === e.group) || (next && next.group === e.group))) e.group = null;
      }
      rest.splice(at, 0, ...moving);
      I.entries = rest;
      tidyInit(I);
      broadcast();
      return { ok: true };
    }
    case 'init.group': {
      // these entries share one turn from now on (they move next to the first one)
      const I = state.init;
      if (!I) return { ok: false };
      const list = I.entries.filter((e) => (p.ids || []).includes(e.id));
      if (list.length < 2) return { ok: false };
      const old = [...new Set(list.map((e) => e.group).filter(Boolean))];
      const gid = old[0] || `g${Date.now().toString(36)}${(initSeq++).toString(36)}`;
      if (!I.groups[gid]) I.groups[gid] = { name: '' };
      for (const e of I.entries) if (list.includes(e) || (e.group && old.includes(e.group))) e.group = gid;
      tidyInit(I);
      broadcast();
      return { ok: true, gid, label: 'They share one turn now' };
    }
    case 'init.ungroup': {
      // gid: the whole group comes apart; id: one member leaves (and goes right after the group)
      const I = state.init;
      if (!I) return { ok: false };
      if (p.gid) { for (const e of I.entries) if (e.group === p.gid) e.group = null; }
      else {
        const e = I.entries.find((x) => x.id === p.id);
        if (!e || !e.group) return { ok: false };
        const g = e.group;
        e.group = null;
        const rest = I.entries.filter((x) => x !== e);
        const last = rest.map((x) => x.group).lastIndexOf(g);
        rest.splice(last + 1, 0, e);
        I.entries = rest;
      }
      tidyInit(I);
      broadcast();
      return { ok: true };
    }
    case 'init.remove': {
      // ids, a group (gid) or every NPC at 0 HP (defeated)
      const I = state.init;
      if (!I) return { ok: false };
      const gone = I.entries.filter((e) => (p.defeated ? !e.pc && isDown(e) : p.gid ? e.group === p.gid : (p.ids || [p.id]).includes(e.id)));
      if (!gone.length) return { ok: false };
      snapInit();
      const before = I.entries;
      I.entries = I.entries.filter((e) => !gone.includes(e));
      // preparing: what was taken out by hand doesn't come back by itself
      for (const e of gone) { if (e.pc) I.dropped.push(`pc:${e.name}`); else I.dropped.push(...e.tokens); }
      tidyInit(I);
      keepTurn(I, before);
      broadcast();
      return { ok: true, label: gone.length > 1 ? `${gone.length} taken out of the turn order` : `${gone[0].name} taken out of the turn order`, undo: { type: 'init.restore', payload: {} } };
    }
    case 'init.restore': {
      if (!initUndo || !store.cur) return { ok: false };
      const u = initUndo;
      initUndo = null;
      state.init = u.init;
      if (u.init.running && store.map(u.init.mapId)) handle('round.set', { mapId: u.init.mapId, n: u.round || 1 });
      broadcast();
      return { ok: true, label: 'Turn order back' };
    }
    case 'init.clear': {
      // start over: the players and the tokens on the map again
      if (!state.init || state.init.running) return { ok: false };
      snapInit();
      state.init = null;
      handle('init.prepare', {});
      return { ok: true, label: 'A fresh turn order', undo: { type: 'init.restore', payload: {} } };
    }
    case 'init.start': {
      // the fight begins: the turn marker on the first one, round 1
      if (p.list) { // the whole list at once (scripts, tests)
        state.init = { mapId: null, running: false, turn: null, show: p.show !== false, entries: p.list.map((e) => newEntry(e)), groups: {}, dropped: [] };
        sortInit(state.init);
      } else handle('init.prepare', {});
      const I = state.init;
      if (!I) return { ok: false };
      const m = store.map(p.mapId) || combatMap();
      if (!m || !I.entries.length) return { ok: false, error: 'Nobody in the turn order yet' };
      I.mapId = m.id;
      I.running = true;
      if ('show' in p) I.show = p.show !== false;
      const first = initUnits(I).find((u) => !unitOut(u)) || initUnits(I)[0];
      I.turn = first.list[0].id;
      handle('round.set', { mapId: m.id, n: 1 }); // a new fight starts in round 1
      broadcast();
      return { ok: true, label: 'Initiative: the fight begins' };
    }
    case 'init.update': {
      // show: the players see the turn order; auto: sort when the last number is in; turn: whose turn it is
      const I = state.init;
      if (!I) return { ok: false };
      if ('show' in p) { I.show = !!p.show; settings.initShow = I.show; saveSettings(); }
      if ('auto' in p) { settings.initAutoSort = !!p.auto; saveSettings(); }
      if (p.turn && I.running && I.entries.some((e) => e.id === p.turn)) I.turn = p.turn;
      broadcast();
      return { ok: true };
    }
    case 'init.next':
    case 'init.prev': {
      const I = state.init;
      if (!I || !I.running || !I.entries.length) return { ok: false };
      const units = initUnits(I);
      let i = Math.max(0, units.findIndex((u) => u.list.some((e) => e.id === I.turn)));
      let label = null;
      // NPCs at 0 HP are skipped (unless that's everyone)
      for (let n = 0; n < units.length; n++) {
        if (type === 'init.prev') i = (i - 1 + units.length) % units.length;
        else { i += 1; if (i >= units.length) { i = 0; const r = handle('round.next', { mapId: I.mapId }); label = r.label; } }
        if (!unitOut(units[i])) break;
      }
      I.turn = units[i].list[0].id;
      broadcast();
      return { ok: true, label: label || `${unitName(I, units[i])}'s turn`, round: !!label, mapId: I.mapId };
    }
    case 'init.end': {
      const I = state.init;
      if (!I) return { ok: false };
      snapInit();
      state.init = null;
      if (store.map(I.mapId)) handle('round.set', { mapId: I.mapId, n: null });
      broadcast();
      return { ok: true, label: 'The fight is over', undo: { type: 'init.restore', payload: {} } };
    }
    case 'init.col': {
      // the columns of the list (saved with the campaign): add { kind, name }, rename { id, name }, remove id, move { id, by }
      const c = store.cur;
      if (!c) return { ok: false };
      let cols = [...initCols()];
      if (p.add && INIT_COLS[p.add.kind]) {
        if (!['num', 'text'].includes(p.add.kind) && cols.some((x) => x.kind === p.add.kind)) return { ok: false, error: 'That column is there already' };
        if (cols.length >= 8) return { ok: false, error: 'Eight columns at most' };
        cols.push({ id: `c${Date.now().toString(36)}${(initSeq++).toString(36)}`, kind: p.add.kind, name: String(p.add.name || INIT_COLS[p.add.kind]).trim().slice(0, 24) || INIT_COLS[p.add.kind] });
        c.meta.initCols = cols;
        // players get their saved AC and max HP
        if (state.init) for (const e of state.init.entries) if (e.pc) Object.assign(e.vals, { ...knownVals(pcStats(e.name)), ...e.vals });
      }
      if (p.rename) cols = cols.map((x) => (x.id === p.rename.id ? { ...x, name: String(p.rename.name || x.name).trim().slice(0, 24) || x.name } : x));
      if (p.remove) cols = cols.filter((x) => x.id !== p.remove);
      if (p.move) {
        const i = cols.findIndex((x) => x.id === p.move.id); const j = i + (p.move.by > 0 ? 1 : -1);
        if (i >= 0 && j >= 0 && j < cols.length) [cols[i], cols[j]] = [cols[j], cols[i]];
      }
      c.meta.initCols = cols;
      store.touch();
      broadcast();
      return { ok: true };
    }
    case 'init.forget': {
      // an enemy the campaign remembers
      const c = store.cur;
      if (!c) return { ok: false };
      c.meta.foes = (c.meta.foes || []).filter((f) => f.name !== p.name);
      store.touch();
      broadcast();
      return { ok: true };
    }

    // ----- the hotbar (2.0): 3 pages of 10 slots, saved with the campaign -----
    case 'party.face': return charSet(String(p.name || ''), { portrait: p.path || null }); // (4.1)
    case 'char.set': return charSet(String(p.name || ''), p.patch || {}, !!p.live);
    case 'party.gather': return partyGather(); // 4.7
    case 'char.rename': return renamePc(String(p.from || ''), String(p.to || '')); // (Players → the pencil)
    case 'hotbar.set': {
      if (!store.cur) return { ok: false };
      store.cur.meta.hotbar = (p.slots || []).slice(0, HOTBAR_SIZE).map(cleanHot);
      store.touch();
      broadcast();
      return { ok: true };
    }
    case 'ready.set': { // a chapter's Ready list for Tokens or Talk (2.2): what the GM wants at hand there
      if (!store.cur) return { ok: false };
      const ch = store.cur.meta.chapters.find((c) => c.id === p.chapterId);
      if (!ch || !READY_KINDS.includes(p.kind)) return { ok: false };
      const seen = new Set();
      const list = (p.items || []).filter((it) => it && it.path && !seen.has(it.path) && seen.add(it.path)).slice(0, 48)
        .map((it) => { const r = library.toRef(it.path); return { path: r.path, rel: r.rel, name: r.name }; });
      const before = ((ch.ready && ch.ready[p.kind]) || []).slice();
      ch.ready = { ...Object.fromEntries(READY_KINDS.map((k) => [k, []])), ...(ch.ready || {}), [p.kind]: list };
      store.touch();
      broadcast();
      return { ok: true, n: list.length, undo: { type: 'ready.set', payload: { chapterId: ch.id, kind: p.kind, items: before.map((r) => ({ path: library.resolveRef(r) })) } } };
    }

    // ----- campaigns -----
    case 'campaign.list':
      return { ok: true, campaigns: store.list(), lastId: settings.lastCampaignId, deleted: store.deleted().length };
    // recently deleted campaigns (2.4): in the library's trash until it is emptied
    case 'campaign.deleted':
      return { ok: true, list: store.deleted() };
    case 'campaign.undelete': {
      const id = store.undelete(p.key);
      if (id) applog.log.info(`campaign restored from Recently deleted: ${p.key}`);
      broadcast();
      return { ok: !!id, id, label: id ? 'Campaign restored' : null };
    }
    case 'campaign.purge': {
      const ok = store.purge(p.key);
      if (ok) applog.log.info(`campaign deleted for good: ${p.key}`);
      return { ok };
    }
    case 'campaign.create': {
      const id = store.create(p.name || 'New campaign');
      const r = openCampaign(id, { backup: false });
      store.structure('map.add', { chapterId: store.cur.meta.chapters[0].id, name: 'First map' });
      const first = store.allMapIds()[0];
      setEdit(first);
      bumpFog(first);
      broadcast();
      return r;
    }
    case 'campaign.open': {
      const r = openCampaign(p.id);
      broadcast();
      return r;
    }
    case 'campaign.home':
      goHome();
      broadcast();
      return { ok: true };
    // the campaign's page (from the maps: the rail's Campaign button) and back to the maps
    case 'campaign.page':
      if (!store.cur) return { ok: false };
      state.screen = 'campaign';
      broadcast();
      return { ok: true };
    case 'campaign.play':
      if (!store.cur) return { ok: false };
      endPreviews();
      state.screen = 'play';
      broadcast();
      return { ok: true };
    // Start session: counts it, puts the title on the TV (until the first map is sent), opens the maps
    case 'session.start': {
      if (!store.cur) return { ok: false };
      endPreviews();
      store.cur.meta.lastSession = Date.now();
      store.touch();
      state.session = { started: Date.now() };
      state.screen = 'play';
      state.blackout = false;
      state.title = titleInfo();
      if (!player) openPlayer();
      broadcast();
      return { ok: true, label: 'Session started: the title is on the table until you send a map (T)' };
    }
    case 'title.show': {
      if (!store.cur) return { ok: false };
      const on = 'on' in p ? !!p.on : !state.title;
      state.title = on ? titleInfo() : null;
      if (on && !player) openPlayer();
      broadcast();
      return { ok: true, shown: on };
    }
    // the campaign page shows one screen on the TV to try it: the one of the open tab, or none (which: null)
    case 'screens.preview': {
      if (!store.cur) return { ok: false };
      const w = ['title', 'brk', 'blackout'].includes(p.which) ? p.which : null;
      if (w === 'title') state.title = { ...titleInfo(), preview: true };
      else if (state.title && state.title.preview) state.title = null;
      if (w === 'brk') state.brk = { endsAt: Date.now() + 10 * 60000, total: 600, id: `b${Date.now().toString(36)}`, look: breakLook(), preview: true };
      else if (state.brk && state.brk.preview) state.brk = null;
      if (w === 'blackout') { state.blackout = true; state.blackoutPreview = true; } else if (state.blackoutPreview) { state.blackout = false; state.blackoutPreview = false; }
      if (w && !player) openPlayer();
      broadcast();
      return { ok: true, which: w };
    }
    // the campaign's screens: { which: 'title' | 'brk' | 'blackout', patch }; a picture comes as { pic: { path } }, 'none' or null (the default)
    case 'screens.set': {
      if (!store.cur || !SCREEN_DEF[p.which] || !p.patch) return { ok: false };
      const cur = screensOf()[p.which];
      const next = { ...cur };
      for (const [k, v] of Object.entries(p.patch)) {
        if (!(k in SCREEN_DEF[p.which])) continue;
        if (k === 'pic') next.pic = v === 'none' ? 'none' : v && v.path && fs.existsSync(v.path) ? library.toRef(v.path) : null;
        else if (typeof SCREEN_DEF[p.which][k] === 'boolean') next[k] = !!v;
        else next[k] = String(v ?? '').slice(0, 120);
      }
      if (p.which === 'brk' && !['map', 'picture', 'dark'].includes(next.bg)) next.bg = 'map';
      if (p.which === 'blackout' && !['black', 'title', 'picture'].includes(next.style)) next.style = 'black';
      store.cur.meta.screens = { ...(store.cur.meta.screens || {}), [p.which]: next };
      store.touch();
      // what is on the TV right now follows
      if (state.title) state.title = { ...titleInfo(), id: state.title.id, preview: state.title.preview };
      if (state.brk) state.brk = { ...state.brk, look: breakLook() };
      broadcast();
      return { ok: true };
    }
    case 'screens.pick': {
      // a picture from the PC: copied into the library (Handouts) so the campaign keeps it
      if (!store.cur || !SCREEN_DEF[p.which]) return { ok: false };
      return (async () => {
        let file = p.file || null;
        if (!file) {
          const r = await dialog.showOpenDialog(gm, { title: 'Pick a picture', properties: ['openFile'], filters: [{ name: 'Pictures and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'webm', 'mp4'] }] });
          if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
          file = r.filePaths[0];
        }
        const done = library.importFiles([file], { cat: 'handouts' });
        const at = done.length ? done[0].path : file;
        const patch = { pic: { path: at } };
        if (p.which === 'brk') patch.bg = 'picture';
        if (p.which === 'blackout') patch.style = 'picture';
        return handle('screens.set', { which: p.which, patch });
      })();
    }
    // who comes today: players marked away stay out of Initiative
    case 'party.away': {
      if (!store.cur || !p.name) return { ok: false };
      const away = new Set(store.cur.meta.away || []);
      if (p.away) away.add(String(p.name)); else away.delete(String(p.name));
      store.cur.meta.away = [...away].filter((n) => (store.cur.meta.party || []).includes(n));
      store.touch();
      broadcast();
      return { ok: true };
    }
    case 'campaign.rename':
      store.rename(p.id, p.name);
      broadcast();
      return { ok: true };
    case 'campaign.delete': {
      const token = store.remove(p.id);
      if (!token) return { ok: false };
      applog.log.info(`campaign deleted (in Recently deleted): ${path.basename(token.trash)}`);
      const key = `t${Date.now()}`;
      trash.set(key, token);
      if (settings.lastCampaignId === p.id) { settings.lastCampaignId = null; saveSettings(); }
      if (state.screen !== 'home' && !store.cur) goHome();
      broadcast();
      return { ok: true, label: 'Campaign deleted', undo: { type: 'campaign.restore', payload: { key } } };
    }
    case 'campaign.restore': {
      const ok = store.restore(trash.get(p.key));
      broadcast();
      return { ok, label: ok ? 'Campaign restored' : null };
    }
    default:
      return { ok: false, error: `Unknown command ${type}` };
  }
}

// History buttons need an update after the first brush point of a stroke.
function broadcastHistoryOnly() { broadcast(); }

// =====================================================================
// IPC
// =====================================================================
ipcMain.handle('init', () => ({ version: app.getVersion(), platform: process.platform, test: !!TEST_DIR }));
ipcMain.handle('state', (e) => {
  if (soundWin && !soundWin.isDestroyed() && e.sender === soundWin.webContents) { const s = soundState(); lastSound = JSON.stringify(s); return s; }
  // A pulled state is a full resync: include fog for every map again.
  const isTable = player && e.sender === player.webContents;
  fogSent.delete(isTable ? player : gm);
  return isTable ? tableState() : gmState();
});
// ---------- 4.6: a campaign (or one chapter) as one file: export and import (transfer.js) ----------
let transferJob = null;
function transferProgress(what) {
  let last = 0;
  return (p) => {
    const now = Date.now();
    if (now - last < 80 && p.done < p.total) return;
    last = now;
    if (gm && !gm.isDestroyed()) gm.webContents.send('event', { kind: 'transfer', what, ...p });
  };
}
const transferSummary = (P) => ({ name: P.name, kind: P.kind, chapter: P.chapter, maps: P.maps, files: P.files, bytes: P.bytes, missing: P.missing, chapters: P.chapters });
ipcMain.handle('transfer', async (e, action, p = {}) => {
  try {
    switch (action) {
      case 'plan': case 'export': {
        const dir = store.findDir(p.id);
        if (!dir) return { ok: false, error: 'That campaign is gone.' };
        if (store.cur && store.cur.meta.id === p.id) store.flush(); // what is on the disk is what goes out
        const P = Transfer.plan(dir, { kind: p.kind === 'full' ? 'full' : 'adventure', chapterId: p.chapterId || null });
        if (action === 'plan') return { ok: true, ...transferSummary(P) };
        if (transferJob) return { ok: false, error: 'Another export or import is running.' };
        const base = String(P.name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Campaign';
        const r = TEST_DIR && p.file ? { filePath: p.file } : await dialog.showSaveDialog(gm, { title: 'Export the campaign', defaultPath: path.join(settings.lastExportDir || app.getPath('documents'), `${base}.tablescape`), filters: [{ name: 'Tablescape campaign', extensions: ['tablescape'] }] });
        if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
        const file = /\.tablescape$/i.test(r.filePath) ? r.filePath : `${r.filePath}.tablescape`;
        settings.lastExportDir = path.dirname(file); saveSettings();
        transferJob = { cancel: false };
        const job = transferJob;
        if (gm && !gm.isDestroyed()) gm.webContents.send('event', { kind: 'transfer', what: 'export', done: 0, total: 1, bytes: 0, totalBytes: P.bytes, name: '' });
        try {
          const out = await Transfer.exportTo(P, file, { version: LABEL, progress: transferProgress('export'), cancelled: () => job.cancel });
          applog.log.info(`export ${P.kind} "${P.name}": ${out.ok ? `${out.bytes} bytes` : 'cancelled'}`);
          return { ...out, name: P.name, missing: P.missing };
        } finally { transferJob = null; }
      }
      case 'pick': {
        const r = await dialog.showOpenDialog(gm, { title: 'Import a campaign', defaultPath: settings.lastExportDir || app.getPath('downloads'), properties: ['openFile'], filters: [{ name: 'Tablescape campaign', extensions: ['tablescape'] }] });
        if (r.canceled || !r.filePaths.length) return { ok: false, cancelled: true };
        return await Transfer.inspect(r.filePaths[0]);
      }
      case 'inspect': return await Transfer.inspect(String(p.file || ''));
      case 'import': {
        if (transferJob) return { ok: false, error: 'Another export or import is running.' };
        transferJob = { cancel: false };
        const job = transferJob;
        try {
          const out = await Transfer.importFrom(String(p.file || ''), store.dir, { progress: transferProgress('import'), cancelled: () => job.cancel });
          applog.log.info(`import "${p.file}": ${out.ok ? `${out.name}, ${out.files} files (${out.reused} already there, ${out.renamed} renamed)` : 'cancelled'}`);
          if (out.ok) broadcastGm();
          return out;
        } finally { transferJob = null; }
      }
      case 'cancel': if (transferJob) transferJob.cancel = true; return { ok: true };
      case 'reveal': if (p.file && fs.existsSync(p.file)) shell.showItemInFolder(p.file); return { ok: true };
      case 'pending': { const f = pendingImport; pendingImport = null; return { file: f }; }
      default: return { ok: false };
    }
  } catch (err) {
    applog.log.error(`transfer ${action}: ${err.stack || err}`);
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('cmd', (e, { type, payload }) => {
  try { return handle(type, payload || {}); } catch (err) { console.error(err); return { ok: false, error: String(err.message || err) }; }
});
// the TV's frame rate, measured on the table, shown under the GM's table preview
ipcMain.on('table:fps', (e, n) => { if (gm && !gm.isDestroyed()) gm.webContents.send('table:fps', n); });
ipcMain.on('preview:size', (e, o = {}) => {
  const width = Math.round(Math.min(1280, Math.max(200, Number(o.width) || 320)));
  const fast = !!o.fast;
  if (width === preview.width && fast === preview.fast) return;
  const bigger = width > preview.width;
  preview = { width, fast };
  if (bigger) previewChanged('size'); // a sharper one soon
});
ipcMain.on('app:error', (e, msg) => applog.log.error(String(msg).slice(0, 2000)));
// sounds the table asks for (thunder after a lightning flash, countdown pulses and chimes)
ipcMain.on('sound:event', (e, ev) => {
  if (ev && (ev.kind === 'thunder' || ev.kind === 'synth')) soundEvent(ev);
  if (ev && ev.kind === 'thunder' && RoomLights && player && e.sender === player.webContents) RoomLights.event('lightning'); // a flash of the weather on the TV
});
const inSound = (code, fallback) => (soundWin && !soundWin.isDestroyed() && !soundWin.webContents.isLoading()
  ? Promise.race([soundWin.webContents.executeJavaScript(code), new Promise((r) => setTimeout(() => r(fallback), 3000))]).catch(() => fallback) : Promise.resolve(fallback));
ipcMain.handle('sound', async (e, action, arg = {}) => {
  switch (action) {
    case 'devices': return inSound('SoundEngine.devices()', []); // the speakers the table's sound can play on
    case 'test': soundEvent({ kind: 'test', which: arg.which === 'fx' ? 'fx' : 'music' }); return { ok: true }; // a chime on that speaker
    case 'debug': return inSound('SoundEngine.debug()', null);
    default: return null;
  }
});
// version, log file, backups, missing files, first steps
let lastMissingSig = '';
ipcMain.handle('app', async (e, action, arg = {}) => {
  switch (action) {
    case 'about': return { version: PKG.version, label: LABEL, electron: process.versions.electron, log: applog.file, update: state.update };
    case 'update.check': return checkUpdates(true); // Prototype 20
    case 'whatsnew': { // Prototype 21: the first start of a new version (after an update): What's new opens once
      const prev = settings.lastVersion; const cur = PKG.version;
      if (TEST_DIR) return { show: false };
      if (prev === cur) return { show: false };
      settings.lastVersion = cur; saveSettings();
      return { show: prev ? true : !!settings.demoCreated && !firstRun, from: prev || null }; // (a copy from before Prototype 21 has no lastVersion yet)
    }
    case 'update.download': { // Prototype 26: "Yes" to Install now?
      const u = state.update || {};
      if (!Updater || u.status !== 'available') return { ok: false };
      applog.log.info(`update: downloading ${u.label || u.version}`);
      setUpdate({ status: 'downloading', version: u.version, label: u.label, notes: u.notes, percent: 0 });
      Updater.downloadUpdate().catch((e) => setUpdate({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
      return { ok: true };
    }
    case 'update.later': { // "Not now" to a new version (it stays on offer, quietly), or "Later" to Restart now? (it installs when Tablescape closes)
      const u = state.update || {};
      if (u.status === 'available') { updSkip = u.version; setUpdate({ ...u, quiet: true }); }
      else if (u.status === 'ready') setUpdate({ ...u, later: true });
      return { ok: true };
    }
    case 'update.install': { // restart now: Tablescape closes, the new version installs and starts
      if (!Updater || state.update.status !== 'ready') return { ok: false };
      applog.log.info(`update: installing ${state.update.label || state.update.version}`);
      store.flush();
      setImmediate(() => Updater.quitAndInstall(false, true)); // (Prototype 21: the Windows installer shows its progress, then Tablescape starts again)
      return { ok: true };
    }
    case 'log.copy': {
      const head = `Tablescape ${LABEL} (${PKG.version}), Electron ${process.versions.electron}, ${process.platform} ${require('os').release()}\n`;
      const text = head + applog.tail(250);
      clipboard.writeText(text);
      return { ok: true, lines: text.split('\n').length };
    }
    case 'log.open': if (applog.file) shell.showItemInFolder(applog.file); return { ok: true };
    case 'restart': { // 4.11.3: a setting that only takes effect when Tablescape starts again
      saveSettings();
      if (TEST_DIR) return { ok: true };
      app.relaunch();
      setTimeout(() => app.quit(), 100);
      return { ok: true };
    }
    case 'report.make': return makeReport(String(arg.note || ''));
    case 'library.move': return moveLibrary();
    case 'folder.show': { // a folder inside the library (a damaged campaign's)
      const f = path.resolve(String(arg.path || ''));
      if (library.root && f.startsWith(path.resolve(library.root)) && fs.existsSync(f)) shell.openPath(f);
      return { ok: true };
    }
    case 'backups.list': { const dir = store.findDir(arg.id); return dir ? backups.list(dir) : []; }
    case 'backups.restore': {
      const dir = store.findDir(arg.id);
      if (!dir) return { ok: false, error: 'Campaign not found.' };
      if (store.cur && store.cur.meta.id === arg.id) goHome();
      const r = backups.restore(dir, arg.backup);
      applog.log.info(`restored ${arg.backup} of ${arg.id}`, r);
      broadcast();
      return r;
    }
    case 'missing.list': { // 4.6.2: also after the campaign opened (a file renamed meanwhile): the maps learn it at once
      const list = missing.list(store);
      const sig = `${store.cur ? store.cur.meta.id : ''}|${list.map((x) => x.key).sort().join('|')}`;
      if (store.cur && sig !== lastMissingSig) {
        const first = !lastMissingSig || !lastMissingSig.startsWith(`${store.cur.meta.id}|`);
        lastMissingSig = sig;
        if (!first) {
          for (const m of store.cur.maps.values()) hydrateMap(m);
          for (const ch of store.cur.meta.chapters) { if (ch.ambience) library.hydrate(ch.ambience); if (ch.fight) library.hydrate(ch.fight); }
          broadcast();
        }
      }
      return list;
    }
    case 'missing.forget': { // 4.10.1: missing files off the Ready lists and the Tonight tray
      const res = missing.forget(store, Array.isArray(arg && arg.keys) ? arg.keys : null);
      if (res.count) { applog.log.info(`missing: ${res.count} taken off the Ready lists`); broadcast(); }
      return res;
    }
    case 'missing.relink': {
      let file = arg.path;
      if (!file) {
        const r = await dialog.showOpenDialog(gm, { title: 'Find the missing file', defaultPath: library.root, properties: ['openFile'] });
        if (r.canceled) return { ok: false, canceled: true };
        file = r.filePaths[0];
      }
      const res = missing.relink(store, arg.key, file);
      for (const id of store.allMapIds()) bumpFog(id);
      broadcast();
      return res;
    }
    case 'capture': { // a picture of a part of the GM screen (the map, for a snapshot)
      if (!gm || gm.isDestroyed()) return null;
      const r = arg || {};
      const rect = { x: Math.max(0, Math.round(Number(r.x) || 0)), y: Math.max(0, Math.round(Number(r.y) || 0)), width: Math.max(8, Math.round(Number(r.w) || 0)), height: Math.max(8, Math.round(Number(r.h) || 0)) };
      try {
        const img = await gm.webContents.capturePage(rect);
        if (img.isEmpty()) return null;
        const small = img.resize({ width: Math.min(img.getSize().width, 360), quality: 'good' });
        return `data:image/jpeg;base64,${small.toJPEG(72).toString('base64')}`;
      } catch (e) { console.error('capture', e.message); return null; }
    }
    case 'tips': return { ...(settings.tips || {}), hidden: !!settings.tipsHidden };
    case 'tips.hide': settings.tipsHidden = true; saveSettings(); return { ok: true };
    // Beta 3.0: the Discord server and the Ko-fi page open in the browser; the license text for the Guide
    case 'link.open': {
      const url = LINKS[arg.to];
      if (!url) return { ok: false };
      if (!TEST_DIR) shell.openExternal(url).catch(() => {});
      return { ok: true, url };
    }
    // Beta 3.4: open source (GPLv3): Tablescape's own notice (the name, the parts from others), then the license itself
    case 'license': try { const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); return { ok: true, text: `${r('NOTICE.txt')}\n\n${'-'.repeat(78)}\n\n${r('LICENSE.txt')}` }; } catch { return { ok: false }; }
    default: return null;
  }
});

function pingAll(pos) {
  if (gm && !gm.isDestroyed()) gm.webContents.send('ping', pos);
  if (player && !player.isDestroyed() && pos.mapId === state.liveMapId) player.webContents.send('ping', pos);
}
ipcMain.on('ping', (e, pos) => {
  pingAll(pos);
});

ipcMain.handle('settings', (e, patch) => {
  const reopen = player && 'playerDisplayId' in patch && patch.playerDisplayId !== settings.playerDisplayId;
  if ('diagonal' in patch) { settings.diagonal = Math.min(300, Math.max(5, Number(patch.diagonal) || 43)); settings.ppi = null; }
  if ('ppi' in patch) { settings.ppi = patch.ppi ? Math.min(400, Math.max(5, Number(patch.ppi))) : null; if (patch.ppi) tip('calib'); }
  if ('playerDisplayId' in patch) settings.playerDisplayId = patch.playerDisplayId;
  if ('sfxOn' in patch) settings.sfxOn = !!patch.sfxOn;
  if ('sfxVolume' in patch) settings.sfxVolume = Math.min(1, Math.max(0, Number(patch.sfxVolume) || 0));
  if ('burstSeconds' in patch) settings.burstSeconds = Math.min(120, Math.max(2, Number(patch.burstSeconds) || 8));
  if (patch.seats) settings.seats = patch.seats === 'one' ? 'one' : 'both';
  if (patch.handout) { settings.handout = { ...(settings.handout || {}), ...patch.handout }; settings.handout = handoutPrefs(); }
  if (patch.talk) {
    const t = { ...settings.talk, ...patch.talk };
    // 4.7: pos: where they stand, 0 (the left end) to 1 (the right end); anchor follows it (before 4.7 there was only that)
    const anchor = ['left', 'center', 'right'].includes(t.anchor) ? t.anchor : 'right';
    const pt = patch.talk || {};
    const pos = !('pos' in pt) && 'anchor' in pt ? { left: 0, center: 0.5, right: 1 }[anchor]
      : t.pos != null && Number.isFinite(Number(t.pos)) ? Math.min(1, Math.max(0, Number(t.pos))) : { left: 0, center: 0.5, right: 1 }[anchor];
    settings.talk = { size: Math.min(0.7, Math.max(0.1, Number(t.size) || 0.34)), pos, anchor: pos < 0.34 ? 'left' : pos > 0.66 ? 'right' : 'center', blur: Math.min(1, Math.max(0, Number(t.blur) || 0)),
      look: TALK_LOOKS.includes(t.look) ? t.look : 'ink' }; // 4.4: ink, smoke, parchment, embers
  }
  if ('boardVolume' in patch) settings.boardVolume = Math.min(1, Math.max(0, Number(patch.boardVolume) || 0));
  if (patch.weatherPresets) settings.weatherPresets = patch.weatherPresets.slice(0, 24);
  if ('askNotes' in patch) settings.askNotes = !!patch.askNotes;
  if (patch.roundPos) settings.roundPos = { x: Math.min(1, Math.max(0, Number(patch.roundPos.x) || 0)), y: Math.min(1, Math.max(0, Number(patch.roundPos.y) || 0)) };
  if ('roundSize' in patch) settings.roundSize = Math.min(3, Math.max(0.6, Number(patch.roundSize) || 1.4));
  if ('roundBanner' in patch) settings.roundBanner = !!patch.roundBanner;
  // 4.6.3: Options → Looks → Fights on the TV
  if ('roundMode' in patch) settings.roundMode = ROUND_MODES.includes(patch.roundMode) ? patch.roundMode : 'auto';
  if ('initFoes' in patch) settings.initFoes = patch.initFoes === 'enemy' ? 'enemy' : 'names';
  if ('initCount' in patch) settings.initCount = [0, 2, 3, 4, 6].includes(Number(patch.initCount)) ? Number(patch.initCount) : 0;
  if ('initShow' in patch) { settings.initShow = !!patch.initShow; if (state.init) state.init.show = settings.initShow; }
  if (patch.mapTransition) settings.mapTransition = TRANSITIONS.includes(patch.mapTransition) ? patch.mapTransition : 'ink';
  if (patch.mapTransition && TRANSITIONS.includes(patch.mapTransition)) settings.looks = { ...(settings.looks || {}), map: patch.mapTransition }; // (the old key still works: that part gets a style of its own)
  if (patch.talk && TALK_LOOKS.includes(patch.talk.look)) settings.looks = { ...(settings.looks || {}), talk: patch.talk.look };
  // Prototype 7: the table's style, and a style of its own for one of the parts ('style': it follows the table's)
  if (patch.tableStyle && TABLE_STYLES[patch.tableStyle]) settings.tableStyle = patch.tableStyle;
  if (patch.looks && typeof patch.looks === 'object') {
    settings.looks = { ...(settings.looks || {}) };
    for (const k of LOOK_PARTS) if (k in patch.looks) { const v = patch.looks[k]; settings.looks[k] = TABLE_STYLES[v] || (k === 'map' && v === 'fade') ? v : 'style'; }
  }
  if ('initAutoSort' in patch) settings.initAutoSort = !!patch.initAutoSort;
  if (patch.quality) settings.quality = ['high', 'medium', 'low'].includes(patch.quality) ? patch.quality : 'high';
  if (patch.gmAnim) settings.gmAnim = ['smooth', 'light', 'still'].includes(patch.gmAnim) ? patch.gmAnim : 'light';
  if (patch.gmFx) settings.gmFx = ['smooth', 'light', 'still'].includes(patch.gmFx) ? patch.gmFx : 'light'; // Prototype 19
  if (patch.animDraw) settings.animDraw = patch.animDraw === 'gpu' ? 'gpu' : 'cpu';
  if ('soundOut' in patch) { settings.soundOut = String(patch.soundOut || '').slice(0, 300); settings.soundOutLabel = String(patch.soundOutLabel || '').slice(0, 120); }
  if ('fxOut' in patch) { settings.fxOut = patch.fxOut == null ? null : String(patch.fxOut).slice(0, 300); settings.fxOutLabel = String(patch.fxOutLabel || '').slice(0, 120); }
  if ('duck' in patch) settings.duck = !!patch.duck;
  if ('fightAuto' in patch) settings.fightAuto = !!patch.fightAuto;
  if ('uiScale' in patch) { settings.uiScale = Math.round(Math.min(1.3, Math.max(0.7, Number(patch.uiScale) || 1)) * 20) / 20; applyUiScale(); }
  if ('hudScale' in patch) {
    settings.hudScale = Math.min(2, Math.max(0.5, Number(patch.hudScale) || 1));
    // show a sample on the TV while the size is being changed, gone a moment after the last change
    state.hudSampleUntil = Date.now() + 3500;
    clearTimeout(hudSampleTimer);
    hudSampleTimer = setTimeout(broadcast, 3600);
  }
  if (patch.picture) { // Options → Picture, for the TV it belongs to
    const key = String(patch.picture.key || view().tvKey);
    settings.picture = { ...(settings.picture || {}) };
    if (patch.picture.reset) delete settings.picture[key];
    else {
      const cur = pictureFor(key);
      for (const [k, [lo, hi]] of Object.entries(PIC_RANGE)) if (k in patch.picture && Number.isFinite(Number(patch.picture[k]))) cur[k] = Math.min(hi, Math.max(lo, Number(patch.picture[k])));
      settings.picture[key] = cur;
    }
  }
  if ('fpsWatch' in patch) settings.fpsWatch = !!patch.fpsWatch;
  if ('buildWide' in patch) settings.buildWide = !!patch.buildWide; // Prototype 5
  if (patch.videoPath) settings.videoPath = VIDEO_PATHS.includes(patch.videoPath) ? patch.videoPath : 'noOverlay'; // 4.11.3 (after a restart)
  if (patch.tokens) { // 4.10: Options → Tokens
    const cur = tokenLook();
    const t = patch.tokens;
    settings.tokens = tokenLook({ ...cur, ...t, pic: t.picReset ? {} : { ...cur.pic, ...(t.pic || {}) } });
  }
  if (patch.mapQuality && patch.mapQuality.mapId) {
    settings.mapQuality = { ...(settings.mapQuality || {}) };
    if (['low', 'medium'].includes(patch.mapQuality.level)) settings.mapQuality[patch.mapQuality.mapId] = patch.mapQuality.level;
    else delete settings.mapQuality[patch.mapQuality.mapId];
  }
  if (Array.isArray(patch.momentStars)) settings.momentStars = [...new Set(patch.momentStars.filter((id) => Moments.BY[id]))].slice(0, 12);
  if (patch.momentSound && Moments.BY[patch.momentSound.id]) {
    settings.momentSounds = { ...(settings.momentSounds || {}) };
    const f = patch.momentSound.path;
    if (f == null) delete settings.momentSounds[patch.momentSound.id]; else settings.momentSounds[patch.momentSound.id] = f === 'none' ? 'none' : String(f).slice(0, 1000);
  }
  if (patch.spotify) { // Spotify: moods, the device it plays on, volume, how the ambience dips
    const sp = { ...settings.spotify };
    const x = patch.spotify;
    const str = (v, n) => String(v ?? '').slice(0, n);
    if (Array.isArray(x.moods)) {
      sp.moods = x.moods.slice(0, 40).filter((m) => m && m.id).map((m) => ({
        id: str(m.id, 40), name: str(m.name, 60).trim() || 'Mood', icon: m.icon ? str(m.icon, 40) : null, shuffle: m.shuffle !== false,
        items: (Array.isArray(m.items) ? m.items : []).filter((it) => it && /^spotify:(track|album|playlist):[A-Za-z0-9]+$/.test(it.uri)).slice(0, 200)
          .map((it) => ({ uri: it.uri, kind: ['track', 'album', 'playlist'].includes(it.kind) ? it.kind : it.uri.split(':')[1], name: str(it.name, 120), sub: str(it.sub, 120), image: /^https:\/\//.test(it.image || '') ? str(it.image, 400) : null })),
      }));
    }
    if ('device' in x) { sp.device = str(x.device, 120); sp.deviceName = str(x.deviceName, 120); }
    if ('volume' in x) sp.volume = x.volume == null ? null : Math.min(100, Math.max(0, Math.round(Number(x.volume) || 0)));
    if ('duck' in x) sp.duck = Math.min(1, Math.max(0, Number(x.duck) || 0));
    settings.spotify = sp;
  }
  if (patch.sfxFor) {
    // one spell look gets its own sound file (or back to the built-in one with path null)
    settings.sfxMap = { ...(settings.sfxMap || {}) };
    if (patch.sfxFor.path) settings.sfxMap[patch.sfxFor.skin] = patch.sfxFor.path;
    else delete settings.sfxMap[patch.sfxFor.skin];
  }
  saveSettings();
  if (reopen) { closePlayer(); setTimeout(openPlayer, 250); }
  broadcast();
  return view();
});

const FILTERS = {
  map: [{ name: 'Maps', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'webm', 'mp4', 'm4v', 'mov', 'dd2vtt', 'uvtt', 'df2vtt'] }],
  walls: [{ name: 'Walls (Universal VTT, Foundry VTT)', extensions: ['dd2vtt', 'uvtt', 'df2vtt', 'json', 'db'] }],
  overlay: [{ name: 'Overlays', extensions: ['webm', 'mp4', 'mov', 'png', 'webp', 'gif'] }],
  token: [{ name: 'Tokens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'webm'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'opus', 'wav', 'flac', 'm4a'] }],
};
ipcMain.handle('pick-file', async (e, role) => {
  const r = await dialog.showOpenDialog(gm, { defaultPath: library.root, properties: ['openFile'], filters: FILTERS[role] || [] });
  return r.canceled ? null : r.filePaths[0];
});

// Add from PC: files from anywhere are copied into the right library folder (a walls file with the
// same name comes along); files already in the library are used where they are.
const IMPORT_FILTER = { maps: 'map', tokens: 'token', assets: 'token', overlays: 'overlay', sounds: 'audio', portraits: 'token', party: 'token', handouts: 'token' };
async function importToLibrary(arg) {
  let files = Array.isArray(arg.files) ? arg.files.filter((f) => typeof f === 'string') : null;
  if (!files) {
    const r = await dialog.showOpenDialog(gm, { title: 'Add to the library', properties: ['openFile', 'multiSelections'], filters: FILTERS[IMPORT_FILTER[arg.cat] || 'map'] || [] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    files = r.filePaths;
  }
  const done = library.importFiles(files, { cat: arg.cat, folder: arg.folder });
  sfxCache.at = 0;
  if (!done.length) return { ok: false, error: 'None of these files can be used here.' };
  const paths = new Set(done.map((d) => d.path));
  const used = campaignFiles();
  const items = library.listLibrary().filter((it) => paths.has(it.path)).map((it) => ({ ...it, inCampaign: used.has(it.path) }));
  // in the order they were picked
  items.sort((a, b) => done.findIndex((d) => d.path === a.path) - done.findIndex((d) => d.path === b.path));
  return { ok: true, items, copied: done.filter((d) => d.copied).length, walls: done.filter((d) => d.walls).length };
}
// Spotify (spotify.js): link, what plays, the library, moods
async function spotifyAction(action, p = {}) {
  if (!Spotify) return { ok: false };
  switch (action) {
    case 'link': return Spotify.link(p.clientId);
    case 'cancel': Spotify.cancelLink(); return { ok: true };
    case 'unlink': state.spotifyMood = null; state.spotifyFight = false; return Spotify.unlink();
    case 'devices': try { return { ok: true, devices: await Spotify.listDevices() }; } catch (err) { return { ok: false, error: err.message }; }
    case 'refresh': return { ok: true, now: await Spotify.refresh() };
    case 'play': return p.mood ? spotifyPlay(p.mood) : spotifyPlay({ id: null, name: p.name || '', items: p.items || [], shuffle: p.shuffle !== false });
    case 'stop': return spotifyStop();
    case 'control': {
      if (p.action === 'pause') { state.spotifyMood = null; state.spotifyFight = false; }
      const r = await Spotify.control(p.action, { ...p, device: settings.spotify.device || null });
      if (p.action === 'transfer' && r.ok) { settings.spotify = { ...settings.spotify, device: p.device, deviceName: p.deviceName || '' }; saveSettings(); }
      broadcastGm();
      return r;
    }
    case 'library': return Spotify.library(p.kind, p);
    case 'open': {
      const where = { dashboard: SpotifyLink.DASHBOARD, guide: SpotifyLink.GUIDE, app: 'spotify:' }[p.what];
      if (!where) return { ok: false };
      if (!TEST_DIR) shell.openExternal(where).catch(() => {});
      return { ok: true, url: where };
    }
    case 'copy': clipboard.writeText(String(p.text || SpotifyLink.REDIRECT)); return { ok: true };
    case 'debug': return Spotify.debug();
    default: return { ok: false };
  }
}
ipcMain.handle('spotify', (e, action, p) => spotifyAction(action, p || {}));

ipcMain.handle('lights', async (e, action, p = {}) => {
  if (!RoomLights) return { ok: false };
  try { const r = await RoomLights.action(action, p); broadcastGm(); return r; } catch (err) { applog.log.warn(`room lights ${action}: ${err.message}`); return { ok: false, error: err.message }; }
});

// Prototype 2: the TV's top edge glows for a while when a phone looks for its seat
let calibT = null;
function setCalib(on) {
  clearTimeout(calibT); calibT = null;
  if (on) calibT = setTimeout(() => { state.calib = false; calibT = null; broadcast(); }, 45000);
  if (state.calib !== !!on) { state.calib = !!on; broadcast(); }
}
// Prototype 1: the Players' phones panel
let joinT = null;
ipcMain.handle('players', async (e, action, p = {}) => {
  if (!Players) return { ok: false };
  if (action === 'join') { // the players' QR code on the TV for a minute
    clearTimeout(joinT); joinT = null;
    if (p.on === false || state.join) { state.join = null; broadcast(); return { ok: true, shown: false }; }
    const q = await Remote.action('qr', { role: 'player' });
    if (!q || !q.ok) return { ok: false, error: q && q.error ? q.error : 'Switch the Remote on first' };
    state.join = { svg: q.svg, url: q.base.replace('http://', ''), until: Date.now() + 90000 };
    joinT = setTimeout(() => { state.join = null; joinT = null; broadcast(); }, 90000);
    broadcast();
    return { ok: true, shown: true };
  }
  const r = await Players.action(action, p);
  broadcast();
  return r;
});
ipcMain.handle('remote', async (e, action, p = {}) => {
  if (!Remote) return { ok: false };
  let r;
  switch (action) {
    case 'deck.set': { const w = p.which === 'tablet' ? 'tablet' : 'phone'; settings.remote.decks[w] = deckFix(p.deck); saveSettings(); r = { ok: true, deck: settings.remote.decks[w] }; break; }
    case 'deck.preset': {
      const w = p.which === 'tablet' ? 'tablet' : 'phone';
      const now = settings.remote.decks[w];
      if (p.id === 'custom') { settings.remote.decks[w] = deckFix({ ...now, ...(now.custom || { top: now.top, info: now.info, source: now.source, cols: now.cols, rows: now.rows }), preset: 'custom' }); saveSettings(); r = { ok: true, deck: settings.remote.decks[w] }; break; }
      const pr = DECK_PRESETS.find((x) => x.id === p.id);
      if (!pr) return { ok: false };
      settings.remote.decks[w] = deckFix({ ...now, preset: pr.id, rows: pr.rows });
      saveSettings(); r = { ok: true, deck: settings.remote.decks[w] }; break;
    }
    case 'catalog': r = { ok: true, groups: remoteCatalog(!!p.pc) }; break;
    case 'faces': { // the party's pictures on the player screen
      const c = store.cur;
      r = { ok: true, list: c ? (c.meta.party || []).map((n) => { const f = faceFor({ name: n, pc: true, tokens: [] }, state.liveMapId); return { name: n, path: f, url: f ? pathToFileURL(f).href : null, own: !!(c.meta.faces && c.meta.faces[n]) }; }) : [] };
      break;
    }
    case 'screen.open': r = await openPlayerScreen(Number(p.displayId) || null); break;
    case 'screen.close': if (playerScreen && !playerScreen.isDestroyed()) playerScreen.close(); r = { ok: true }; break;
    default: r = await Remote.action(action, p);
  }
  broadcastGm();
  return r;
});

ipcMain.handle('library', (e, action, arg) => {
  if (action === 'open') { shell.openPath(arg || library.root); return null; }
  if (action === 'reveal') { shell.showItemInFolder(arg); return null; }
  if (action === 'fav') return library.setFavourite(arg.path, arg.on);
  if (action === 'touch') { library.touchRecent(arg); return null; }
  if (action === 'forget') { library.forgetRecent(arg && arg.paths); return null; }
  if (action === 'vttimg') { const f = library.vttImagePath(arg); return f ? pathToFileURL(f).href : null; }
  if (action === 'import') return importToLibrary(arg || {});
  const used = campaignFiles();
  return library.listLibrary().map((it) => ({ ...it, inCampaign: used.has(it.path) }));
});
// ---------- baked animations (2.3, anim-cache.js) ----------
// Every animated asset the open campaign uses (its maps and their snapshots; the map on the table and the one open
// here first), at the size it shows on the TV. The GM screen bakes them one by one (anim.js: AnimBaker) and shows
// the little maid running while it does.
const animFailed = new Map(); // path -> why it could not be baked (this session; Try again forgets it)
let animDone = 0; // baked since the list was last empty
let animTimer = null;
let animSig = '';
function animNeeds({ all = false } = {}) {
  const c = store.cur;
  if (!c || !library.root) return [];
  const v = view();
  const want = new Map(); // path -> { path, url, name, tier, where }
  const consider = (l, map, where) => {
    if (!l || l.role !== 'asset' || l.kind !== 'video' || l.asVideo) return; // (4.8: played as a video, sharp: not baked)
    const full = library.resolveRef(l);
    if (!full) return;
    const px = (Number(l.w) || 1) * ((map.view && map.view.zoom) || 1) * v.ppi * (v.dpr || 1);
    const tier = animCache.tierFor(px);
    const w = want.get(full);
    if (w) { if (tier > w.tier) w.tier = tier; return; }
    want.set(full, { path: full, url: library.media(full).url, name: l.name || path.parse(full).name, tier, where });
  };
  const seen = new Set();
  for (const id of [state.liveMapId, state.editMapId, ...store.allMapIds()]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const m = c.maps.get(id);
    if (!m) continue;
    for (const l of m.layers) consider(l, m, m.name);
    for (const s of m.snaps || []) for (const l of (s.data && s.data.layers) || []) consider(l, m, `${m.name}: ${s.name}`);
  }
  if (all) return [...want.values()].filter((w) => fs.existsSync(w.path));
  return [...want.values()].filter((w) => !animFailed.has(w.path) && fs.existsSync(w.path) && !animCache.has(w.path, w.tier));
}
// free space on the library's disk (2.5): baking pauses below 500 MB, Options → Performance warns below 2 GB
const DISK_PAUSE = 500 * 1048576; const DISK_WARN = 2048 * 1048576;
let diskAt = 0; let diskFree = null;
function libraryFree() {
  if (process.env.TS_TEST_DISK_FREE) return (diskFree = Number(process.env.TS_TEST_DISK_FREE)); // the self-test pretends a full disk
  if (Date.now() - diskAt < 5000) return diskFree;
  diskAt = Date.now();
  try { const st = fs.statfsSync(library.root); diskFree = Number(st.bavail) * Number(st.bsize); } catch { diskFree = null; }
  return diskFree;
}
function animStatus() {
  const q = animNeeds();
  const free = q.length ? libraryFree() : diskFree;
  const paused = free != null && free < DISK_PAUSE && q.length ? 'disk' : null;
  const st = {
    op: 'status', queue: paused ? [] : q.slice(0, 40), left: q.length, done: animDone, total: animDone + q.length, paused, free,
    failed: [...animFailed.entries()].map(([p, why]) => ({ path: p, name: path.parse(p).name, why })),
  };
  if (!q.length) animDone = 0;
  return st;
}
function animSend() {
  clearTimeout(animTimer); animTimer = null;
  if (!gm || gm.isDestroyed()) return;
  const st = animStatus();
  const sig = JSON.stringify([st.queue.map((x) => [x.path, x.tier]), st.left, st.done, st.failed.length, st.paused]);
  if (st.paused) { diskAt = 0; animSoon(30000); } // look again for free space in a while
  if (sig === animSig) return;
  animSig = sig;
  gm.webContents.send('anim', st);
}
function animSoon(ms = 600) { if (!animTimer) animTimer = setTimeout(animSend, ms); }
const animToAll = (e) => { for (const w of [gm, player]) if (w && !w.isDestroyed()) w.webContents.send('anim', e); };
ipcMain.handle('anim', (e, action, arg = {}) => {
  if (action === 'get') { // the best sheet there is for a file (null: not baked yet)
    const full = arg.path ? library.resolveRef({ path: arg.path, rel: arg.rel }) : null;
    return full ? animCache.find(full, Number(arg.tier) || 256) : null;
  }
  if (action === 'put') { // the GM screen baked one
    let r = null;
    try { r = animCache.put(arg.path, arg.tier, arg.pieces, arg.meta); } catch (err) { applog.log.warn(`baking ${arg.path}: ${err.message}`); }
    if (r) {
      animDone++;
      animToAll({ op: 'ready', path: arg.path, tier: r.tier });
      const m = r.meta || {};
      const kb = Math.round((arg.pieces || []).reduce((a, x) => a + (x ? x.length : 0), 0) / 1024);
      applog.log.info(`baked "${String(arg.name || path.parse(arg.path).name).slice(0, 80)}": ${m.fw}×${m.fh} px, ${m.n} frames in ${m.pieces} piece${m.pieces === 1 ? '' : 's'}, ${Math.round(m.fps * 10) / 10} fps (file: ${m.src} fps, ${Math.round(m.dur * 10) / 10} s), ${kb} KB, ${Math.round((arg.ms || 0) / 100) / 10} s`);
    } else animFailed.set(arg.path, 'could not be saved');
    animSend();
    return r ? { tier: r.tier } : null;
  }
  if (action === 'fail') {
    animFailed.set(arg.path, String(arg.why || 'could not be read').slice(0, 120));
    applog.log.warn(`animation not baked (plays as video): ${arg.path}: ${arg.why}`);
    animSend();
    return null;
  }
  if (action === 'status') { animSig = ''; const st = animStatus(); animSig = JSON.stringify([st.queue.map((x) => [x.path, x.tier]), st.left, st.done, st.failed.length, st.paused]); return st; }
  if (action === 'info') {
    // how long baking again would take (Clear the cache asks first): the loops' lengths and a little for each
    let secs = 0; let used = 0;
    for (const w of animNeeds({ all: true })) { const f = animCache.find(w.path, w.tier); secs += (f ? f.meta.dur : 5) + 2.5; used++; }
    diskAt = 0;
    const free = libraryFree();
    return { ...animCache.info(), failed: animFailed.size, left: animNeeds().length, used, rebakeSecs: Math.round(secs), free, low: free != null && free < DISK_WARN, paused: free != null && free < DISK_PAUSE };
  }
  if (action === 'list') { // the open campaign's animations and how they are kept (Options → Performance)
    const out = new Map();
    for (const w of animNeeds({ all: true })) {
      const f = animCache.find(w.path, w.tier);
      const why = animFailed.get(w.path);
      out.set(w.path, { name: w.name, where: w.where, tier: w.tier, baked: !!f, fps: f ? f.meta.fps : null, blend: f ? !!f.meta.blend : false, px: f ? Math.max(f.meta.fw, f.meta.fh) : null, src: f ? f.meta.src : null, frames: f ? f.meta.n : null, video: why || null });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (action === 'retry') { animFailed.clear(); animSig = ''; animSend(); return true; } // Prepare now
  if (action === 'clear') {
    animCache.clear(); animFailed.clear(); animDone = 0; animSig = '';
    animToAll({ op: 'cleared' });
    animSoon(1500);
    return animCache.info();
  }
  return null;
});
// what changed on a map since its snapshot (2.5: the save question names it)
function sceneChanges(a, b) {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : Array.isArray(v) ? v.map(r) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['url', 'missing', 'thumb'].includes(k)).map(([k, x]) => [k, r(x)])) : v);
  const same = (x, y) => JSON.stringify(r(x)) === JSON.stringify(r(y));
  const of = (D, roles) => (D.layers || []).filter((l) => roles.includes(l.role));
  const out = [];
  if (!same(a.bg && [a.bg.path, a.bg.x, a.bg.y, a.bg.scale, a.bg.rotation], b.bg && [b.bg.path, b.bg.x, b.bg.y, b.bg.scale, b.bg.rotation])) out.push('the picture');
  if (!same(of(a, ['asset']), of(b, ['asset']))) out.push('the assets');
  if (!same(of(a, ['overlay', 'audio']), of(b, ['overlay', 'audio']))) out.push('the films and sounds');
  if (!same(a.fx, b.fx)) out.push('the effects');
  if (!same(a.weather && a.weather.layers, b.weather && b.weather.layers)) out.push('the weather');
  if (!same(a.light, b.light)) out.push('the scene light');
  if ('look' in a && 'look' in b && !same(a.look, b.look)) out.push('the map colours');
  return out;
}

// ---------- benchmark (2.4) ----------
// The map on the TV, measured for a while: both windows count their frames (bench.js), main takes the processor
// and memory of every window each second. "Videos vs baked" measures the same map twice: animated assets as
// videos (as before 2.3), then baked. Results are kept in benchmarks.json and written to the log.
let bench = null; // the run going on
const benchWait = new Map(); // measuring id -> { got: { tv, gm }, done }
const benchFile = () => userFile('benchmarks.json');
function benchList() { try { const l = JSON.parse(fs.readFileSync(benchFile(), 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } }
function benchSave(list) { try { fs.writeFileSync(benchFile(), JSON.stringify(list.slice(-40), null, 1)); } catch (err) { applog.log.warn(`benchmarks not saved: ${err.message}`); } }
const benchSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function benchProgress(e) { if (gm && !gm.isDestroyed()) gm.webContents.send('bench', e); }
async function benchMeasure(ms) {
  const id = mapstate.newId('bm');
  const pidOf = (w) => { try { return w && !w.isDestroyed() ? w.webContents.getOSProcessId() : null; } catch { return null; } };
  const pids = { tv: pidOf(player), gm: pidOf(gm), sound: pidOf(soundWin) };
  app.getAppMetrics(); // starts the processor counters
  const samples = [];
  const timer = setInterval(() => { try { samples.push(app.getAppMetrics()); } catch {} }, 1000);
  const got = await new Promise((resolve) => {
    const w = { got: {}, done: resolve };
    benchWait.set(id, w);
    setTimeout(() => resolve(w.got), ms + 15000); // a window that does not answer (minimised, asleep, very busy)
    for (const [win, who] of [[player, 'tv'], [gm, 'gm']]) if (win && !win.isDestroyed()) win.webContents.send('bench', { op: 'measure', id, ms, who });
  });
  clearInterval(timer);
  benchWait.delete(id);
  // processor (100 % = one core busy) and memory: the average of the samples, per window
  const avg = (fn) => { const v = samples.map(fn).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const of = (list, test) => list.filter(test);
  const sum = (list, k) => list.reduce((a, p) => a + (k === 'cpu' ? p.cpu.percentCPUUsage : (p.memory.workingSetSize || 0) / 1024), 0);
  const part = (test) => ({ cpu: avg((m) => (of(m, test).length ? sum(of(m, test), 'cpu') : NaN)), mem: avg((m) => (of(m, test).length ? sum(of(m, test), 'mem') : NaN)) });
  const tv = part((p) => p.pid === pids.tv); const g = part((p) => p.pid === pids.gm); const gpu = part((p) => p.type === 'GPU'); const all = part(() => true);
  const r0 = (v) => (v == null ? null : Math.round(v));
  return {
    tv: got.tv || null, gm: got.gm || null,
    cpu: { tv: r0(tv.cpu), gm: r0(g.cpu), gpu: r0(gpu.cpu), all: r0(all.cpu) },
    mem: { tv: r0(tv.mem), gm: r0(g.mem), gpu: r0(gpu.mem), all: r0(all.mem) },
    cores: require('os').cpus().length,
  };
}
function benchRun(mode, secs) {
  if (bench) return { ok: false, error: 'A benchmark is running already' };
  const live = store.map(state.liveMapId);
  if (!player || player.isDestroyed() || !live) return { ok: false, error: 'Open the table and show a map on it first: the benchmark measures the map on the TV.' };
  if (state.blackout) return { ok: false, error: 'Blackout is on: the TV shows nothing to measure.' };
  if (animNeeds().length) {
    const f = libraryFree();
    return { ok: false, error: f != null && f < DISK_PAUSE ? 'Baking is paused (the disk is almost full), so not every animation is baked yet: make some room first.' : 'The little maid is still baking animations (at the top of your screen): start the benchmark when she is done.' };
  }
  const twice = mode === 'compare' || mode === 'draw';
  const each = Math.round(Math.min(60, Math.max(3, Number(secs) || (twice ? 15 : 20))) * 1000); // (shorter in the self-test)
  // Beta 1: 'draw' measures the map drawn by the graphics card, then by the processor, and keeps the better one
  const steps = mode === 'compare' ? [['videos', each], ['baked', each]] : mode === 'draw' ? [['gpu', each], ['cpu', each]] : [['normal', each]];
  const seconds = steps.reduce((n, [, ms]) => n + ms / 1000, 0) + (twice ? 8 : 1);
  bench = { mode, started: Date.now(), seconds };
  const pair = twice ? mapstate.newId('bp') : null;
  const drawBefore = settings.animDraw;
  (async () => {
    const results = [];
    try {
      for (const [label, ms] of steps) {
        if (mode === 'compare') { animToAll({ op: 'videos', on: label === 'videos' }); benchProgress({ op: 'progress', label, phase: 'settle', seconds }); await benchSleep(label === 'videos' ? 4500 : 3500); }
        else if (mode === 'draw') { settings.animDraw = label; broadcast(); benchProgress({ op: 'progress', label, phase: 'settle', seconds }); await benchSleep(3500); }
        else await benchSleep(800);
        benchProgress({ op: 'progress', label, phase: 'measure', seconds, ms, step: results.length + 1, of: steps.length });
        const r = await benchMeasure(ms);
        const m = store.map(live.id) || live;
        const anim = r.tv && r.tv.info ? r.tv.info.anim : null;
        const res = {
          id: mapstate.newId('b'), t: Date.now(), version: PKG.version, label, pair, seconds: ms / 1000,
          map: m.name, mapId: m.id, campaign: store.cur ? store.cur.meta.name : null,
          quality: qualityFor(m.id), gmAnim: settings.gmAnim || 'light', gmFx: settings.gmFx || 'light', animDraw: settings.animDraw === 'gpu' ? 'gpu' : 'cpu', hz: view().hz,
          motion: { tv: r.tv && r.tv.info ? r.tv.info.motion || null : null, gm: r.gm && r.gm.info ? r.gm.info.motion || null : null },
          tv: r.tv ? { fps: r.tv.fps, low: r.tv.low, worst: r.tv.worst, stutters: r.tv.stutters } : null,
          gm: r.gm ? { fps: r.gm.fps, low: r.gm.low, worst: r.gm.worst, stutters: r.gm.stutters } : null,
          cpu: r.cpu, mem: r.mem, cores: r.cores,
          anim: anim ? { animated: anim.animated, baked: anim.baked, videos: anim.videos, blended: anim.blended || 0, off: anim.off } : null,
          things: {
            assets: m.layers.filter((l) => l.role === 'asset').length, tokens: m.layers.filter((l) => l.role === 'token').length,
            effects: m.fx.length, weather: (m.weather.layers || []).filter((l) => !l.dying && !l.hidden).length,
            overlays: m.layers.filter((l) => l.role === 'overlay').length, video: !!(m.bg && m.bg.kind === 'video'),
          },
        };
        results.push(res);
        const t = res.tv;
        const mt = res.motion.tv; const mg = res.motion.gm;
        const mo = (x) => (x && x.count ? `${x.ratio} % of their speed (${x.fps} fps on average)${x.slowest ? `, slowest "${x.slowest.name}" ${x.slowest.fps}/${x.slowest.want}` : ''}${x.still ? `, longest still ${x.still.ms} ms ("${x.still.name}")` : ''}` : 'none');
        applog.log.info(`benchmark${label !== 'normal' ? ` (${{ videos: 'animations as videos', baked: 'baked', gpu: 'drawn by the graphics card', cpu: 'drawn by the processor' }[label]})` : ''}: "${res.map}" ${res.seconds} s, quality ${res.quality}, GM screen ${res.gmAnim}, drawn by ${res.animDraw}; TV ${t ? `${t.fps} fps, 1% low ${t.low}, worst ${t.worst} ms, ${t.stutters} stutters` : 'no answer'}; GM ${res.gm ? `${res.gm.fps} fps` : 'no answer'}; animations on the TV: ${mo(mt)}; on the GM screen: ${mo(mg)}; CPU TV ${res.cpu.tv}%, GM ${res.cpu.gm}%, GPU ${res.cpu.gpu}%, all ${res.cpu.all}% (${res.cores} cores); memory ${res.mem.all} MB; animations ${anim ? `${anim.baked}/${anim.animated} baked, ${anim.videos} videos` : '–'}`);
      }
      let picked = null;
      if (mode === 'draw' && results.length === 2) {
        picked = benchBetter(results[0], results[1]) ? 'gpu' : 'cpu';
        settings.animDraw = picked;
        saveSettings();
        applog.log.info(`benchmark: the ${picked === 'cpu' ? 'processor' : 'graphics card'} draws the animations from now on`);
      }
      benchSave([...benchList(), ...results]);
      benchProgress({ op: 'done', results, picked });
    } catch (err) {
      applog.log.warn(`benchmark stopped: ${err.message}`);
      if (mode === 'draw') settings.animDraw = drawBefore;
      benchProgress({ op: 'error', error: `The benchmark stopped: ${err.message}` });
    } finally {
      if (mode === 'compare') animToAll({ op: 'videos', on: false });
      if (mode === 'draw') broadcast();
      bench = null;
    }
  })();
  return { ok: true, seconds };
}
// is a better than b: fewer stutters on the TV first (more than a couple apart), then the animations' own speed, then fps
function benchBetter(a, b) {
  const t = (r) => r.tv || { stutters: 999, low: 0, fps: 0 };
  const mo = (r) => (r.motion && r.motion.tv && r.motion.tv.count ? r.motion.tv.ratio : null);
  if (Math.abs(t(a).stutters - t(b).stutters) > 2) return t(a).stutters < t(b).stutters;
  if (mo(a) != null && mo(b) != null && Math.abs(mo(a) - mo(b)) > 2) return mo(a) > mo(b);
  if (Math.abs(t(a).low - t(b).low) > 3) return t(a).low > t(b).low;
  return t(a).fps >= t(b).fps;
}
ipcMain.handle('bench', (e, action, arg = {}) => {
  if (action === 'result') { // a window's frames
    const w = benchWait.get(arg.id);
    if (!w) return null;
    const who = player && !player.isDestroyed() && e.sender === player.webContents ? 'tv' : 'gm';
    w.got[who] = arg;
    if (w.got.tv && w.got.gm) w.done(w.got);
    return true;
  }
  if (action === 'start') return benchRun(['compare', 'draw'].includes(arg.mode) ? arg.mode : 'normal', arg.seconds);
  if (action === 'list') return benchList();
  if (action === 'running') return bench ? { ...bench } : null;
  if (action === 'clear') { benchSave([]); return true; }
  if (action === 'remove') { benchSave(benchList().filter((r) => r.id !== arg.id && (!arg.pair || r.pair !== arg.pair))); return true; }
  return null;
});
ipcMain.handle('thumb', (e, action, arg) => {
  if (action === 'put') return library.putThumb(arg.path, arg.dataUrl);
  if (action === 'get') return Object.fromEntries((arg || []).map((p) => [p, library.thumbUrl(p)]));
  return null;
});

// =====================================================================
// First start: demo campaign, and import of the 0.1 autosave
// =====================================================================
// Beta 3.1: the demo campaign comes in like any imported campaign; the start screen shows it once it is there
function importDemo() {
  Transfer.importFrom(DEMO_PKG, store.dir).then((out) => {
    applog.log.info(`demo: ${out && out.ok ? `${out.name}, ${out.maps} maps, ${out.files} files` : 'not imported'}`);
    if (out && out.ok) broadcastGm();
  }).catch((err) => applog.log.error(`demo: ${err.message || err}`));
}
function createDemoCampaign() {
  const lib = (rel) => path.join(library.root, rel);
  if (!fs.existsSync(lib('Maps/Animated/Demo dungeon (torchlight).mp4'))) return;
  const id = store.create('Demo: the goblin caves', { chapterName: 'Goblin caves' });
  store.open(id);
  const ch = store.cur.meta.chapters[0];
  const m = (r) => store.map(r.id);
  const run = (map, type, p) => mapstate.apply(map, type, p, library.media);

  // The demo maps are 1920x1080 with a printed grid of 54 px squares.
  const tableW = view().inches.w;
  const k = tableW / 1920; // map inches per image pixel when the map fills the table width
  const pin = (map) => { map.bg.x = 0; map.bg.y = 0; map.bg.scale = k; Object.assign(map.grid, { size: 54 * k, ox: 0, oy: 0 }); };
  const cell = (cx, cy) => ({ x: (cx + 0.5) * 54 * k, y: (cy + 0.5) * 54 * k });
  const a = m(store.structure('map.add', { chapterId: ch.id, path: lib('Maps/Animated/Demo dungeon (torchlight).mp4'), name: 'Lower hall by torchlight' }));
  pin(a);
  run(a, 'layer.add', { path: lib('Effects/Overlays/Embers (alpha).webm'), role: 'overlay' });
  run(a, 'layer.add', { path: lib('Tokens/Goblin.png'), role: 'token', ...cell(15, 4) });
  run(a, 'layer.add', { path: lib('Tokens/Goblin.png'), role: 'token', ...cell(21, 5) });
  const ogrePos = cell(29, 9);
  const ogre = run(a, 'layer.add', { path: lib('Tokens/Ogre.png'), role: 'token', x: ogrePos.x + 27 * k, y: ogrePos.y + 27 * k });
  run(a, 'layer.update', { id: ogre.selected, size: 2, hidden: true });
  run(a, 'fx.add', { kind: 'emitter', preset: 'smoke', ...cell(18, 4), r: 1.2 });
  run(a, 'fog.base', { base: 'cover' });
  run(a, 'fog.op', { mode: 'reveal', shape: 'rect', x: 1.6 * 54 * k, y: 1.6 * 54 * k, w: 9 * 54 * k, h: 6.8 * 54 * k });

  const b = m(store.structure('map.add', { chapterId: ch.id, path: lib('Maps/Static/Demo dungeon.png'), name: 'Lower hall at night' }));
  pin(b);
  run(b, 'layer.add', { path: lib('Effects/Overlays/Dust motes (alpha).webm'), role: 'overlay' });
  // the torches painted on the map get real light and flames
  for (const [cx, cy] of [[3, 2], [9, 2], [15, 1], [23, 1], [27, 4], [5, 11], [12, 11], [17, 11], [25, 11], [33, 13]]) {
    const p = { x: (cx + 0.5) * 54 * k, y: (cy + 0.15) * 54 * k };
    run(b, 'fx.add', { kind: 'emitter', preset: 'torch', ...p, r: 0.6, bright: 15, dim: 30 });
  }
  const pool = [];
  for (let cx = 19.6; cx <= 23.4; cx += 0.4) pool.push(cx * 54 * k, 14.5 * 54 * k);
  run(b, 'fx.stroke', { id: 'demo-water', preset: 'water', sid: 'w1', r: 1.9 * 54 * k, pts: pool });
  run(b, 'light.update', { darkness: 0.72 });

  store.structure('chapter.ambience', { id: ch.id, path: lib('Audio/Ambience/Cave drone.ogg'), volume: 0.45 });
  store.cur.meta.lastMapId = a.id;
  store.touch(a.id);
  store.touch(b.id);
  store.close();
}

function import01() {
  const old = readJson(userFile('autosave.json'));
  if (!old || !old.scene || (!old.scene.map && !(old.scene.layers || []).length)) return;
  const s = old.scene;
  const ppi0 = Math.hypot(1920, 1080) / (settings.diagonal || 43); // 0.1 stored table pixels
  const id = store.create('Imported from 0.1');
  store.open(id);
  const r = store.structure('map.add', { chapterId: store.cur.meta.chapters[0].id, name: s.title || 'Imported scene' });
  const map = store.map(r.id);
  if (s.map && s.map.path) {
    map.bg = { ...library.media(s.map.path), kind: s.map.kind, x: (s.map.x || 0) / ppi0, y: (s.map.y || 0) / ppi0, scale: s.map.scale == null ? null : s.map.scale / ppi0, volume: s.map.volume || 0, rate: s.map.rate || 1 };
  }
  map.layers = (s.layers || []).filter((l) => l.path).map((l) => {
    const out = { ...l, ...library.media(l.path) };
    if (l.role === 'token') { out.x = l.x / ppi0; out.y = l.y / ppi0; }
    if (l.role === 'overlay') { out.x = (l.x || 0) / ppi0; out.y = (l.y || 0) / ppi0; }
    return out;
  });
  if (s.grid) map.grid = { ...map.grid, ...s.grid };
  if (s.fog) {
    map.fog = {
      enabled: s.fog.enabled, base: s.fog.base,
      ops: (s.fog.ops || []).map((o) => (o.shape === 'rect'
        ? { ...o, x: o.x / ppi0, y: o.y / ppi0, w: o.w / ppi0, h: o.h / ppi0 }
        : { ...o, r: o.r / ppi0, pts: (o.pts || []).map((v) => v / ppi0) })),
    };
  }
  store.cur.meta.lastMapId = map.id;
  store.touch(map.id);
  store.close();
}

// =====================================================================
// Moving the library (Beta 1): everything copied to a folder of the user's choice, the old folder removed, the
// app started again. The library is closed meanwhile (no campaign open) so nothing is written half-way.
// =====================================================================
async function moveLibrary() {
  if (TEST_DIR && !process.env.TS_TEST_MOVE) return { ok: false, error: 'not in the self-test' };
  if (library.isPortable(app)) return { ok: false, error: 'This is a portable Tablescape: the library stays next to the program (remove portable.txt to move it).' };
  const from = library.root;
  const picked = TEST_DIR ? [process.env.TS_TEST_MOVE] : (await dialog.showOpenDialog(gm, { title: 'New folder for the Tablescape library', defaultPath: path.dirname(from), properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Move it here' })).filePaths;
  if (!picked || !picked[0]) return { ok: false, canceled: true };
  const to = libraryRootIn(picked[0]);
  if (path.resolve(to) === path.resolve(from)) return { ok: false, error: 'That is where it is already.' };
  if (path.resolve(to).startsWith(path.resolve(from) + path.sep)) return { ok: false, error: 'The new place cannot be inside the library itself.' };
  let bytes = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { bytes += fs.statSync(f).size; } catch {} } } };
  try { walk(from); } catch {}
  let free = null;
  try { const st = fs.statfsSync(path.dirname(to)); free = st.bavail * st.bsize; } catch {}
  if (free != null && free < bytes * 1.05 + 100e6) return { ok: false, error: `Not enough room there: the library is ${(bytes / 2 ** 30).toFixed(1)} GB, ${(free / 2 ** 30).toFixed(1)} GB free.` };
  if (!TEST_DIR) {
    const r = await dialog.showMessageBox(gm, {
      type: 'question', buttons: ['Move it', 'Go back'], defaultId: 0, cancelId: 1, noLink: true, title: 'Tablescape',
      message: `Move the library to ${to}?`,
      detail: `${(bytes / 2 ** 20 < 1024 ? `${Math.round(bytes / 2 ** 20)} MB` : `${(bytes / 2 ** 30).toFixed(1)} GB`)} are copied${store.cur ? '. The open campaign is closed first' : ''}. Tablescape then starts again from the new place.`,
    });
    if (r.response !== 0) return { ok: false, canceled: true };
  }
  if (store.cur) goHome();
  store.flush();
  try {
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true, errorOnExist: false, force: true });
  } catch (err) {
    applog.log.error('library move failed (copy)', err);
    return { ok: false, error: `Copying failed: ${err.message}. Nothing was removed; the library is still at ${from}.` };
  }
  settings.libraryRoot = to;
  saveSettings();
  applog.log.info(`library moved: ${from} -> ${to} (${Math.round(bytes / 2 ** 20)} MB)`);
  try { fs.rmSync(from, { recursive: true, force: true }); } catch (err) { applog.log.warn(`the old library folder could not be removed: ${err.message}`); }
  if (TEST_DIR) return { ok: true, to, bytes };
  app.relaunch();
  app.exit(0);
  return { ok: true, to };
}

// =====================================================================
// Report a problem (Beta 1): one zip with the log, the settings and the benchmarks, and a few lines about this
// computer, for whoever gave out Tablescape. No maps, no campaigns, no Spotify tokens.
// =====================================================================
async function makeReport(note) {
  const os = require('os');
  const { zip } = require('./zip');
  const files = [];
  const add = (name, data, mtime) => { if (data != null) files.push({ name, data, mtime }); };
  const readIf = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
  const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return undefined; } };
  let gpu = null;
  try { gpu = await Promise.race([app.getGPUInfo('basic'), new Promise((r) => setTimeout(() => r(null), 1500))]); } catch {}
  const g = gpu && gpu.gpuDevice && gpu.gpuDevice[0] ? gpu.gpuDevice : [];
  const displays = screen.getAllDisplays().map((d) => `${d.label || 'Display'} ${d.size.width}×${d.size.height} @${Math.round(d.displayFrequency || 0)} Hz, scale ${d.scaleFactor}${d.id === settings.playerDisplayId ? ' (table)' : ''}`);
  const v = view();
  const camps = store.list();
  const anim = (() => { try { return animCache.info(); } catch { return null; } })();
  const lines = [
    `Tablescape ${LABEL} (${PKG.version}), Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`,
    `${process.platform} ${os.release()} ${process.arch}, ${os.cpus().length} cores (${(os.cpus()[0] || {}).model || '?'}), ${Math.round(os.totalmem() / 2 ** 30)} GB memory, ${Math.round(os.freemem() / 2 ** 30)} GB free`,
    `graphics: ${g.length ? g.map((x) => `${x.vendorId ? `vendor ${x.vendorId.toString(16)}` : ''} device ${x.deviceId ? x.deviceId.toString(16) : '?'}${x.driverVersion ? ` driver ${x.driverVersion}` : ''}`).join('; ') : 'unknown'}`,
    `displays: ${displays.join(' | ') || 'none'}`,
    `table: ${v.windowed ? 'as a window' : `on ${v.world.w}×${v.world.h}`}, ${v.calibrated ? `calibrated ${v.ppi.toFixed(1)} ppi` : `from the ${v.diagonal}" diagonal`}, open ${v.playerOpen}`,
    `library: ${library.root}${library.isPortable(app) ? ' (portable)' : settings.libraryRoot ? ' (chosen)' : ' (Documents)'}, free ${(() => { const f = libraryFree(); return f == null ? '?' : `${(f / 2 ** 30).toFixed(1)} GB`; })()}`,
    `campaigns: ${camps.length}${camps.some((c) => c.broken) ? ` (${camps.filter((c) => c.broken).length} damaged)` : ''}; open: ${store.cur ? `"${store.cur.meta.name}", ${store.allMapIds().length} maps, editing ${state.editMapId || '-'}, live ${state.liveMapId || '-'}` : 'none'}; screen ${state.screen}`,
    `animations prepared: ${anim ? `${anim.sheets} (${Math.round(anim.bytes / 2 ** 20)} MB)` : '?'}; settings: quality ${settings.quality}, GM animations ${settings.gmAnim}, GM effects ${settings.gmFx || 'light'}, drawn by ${settings.animDraw}, fps watch ${settings.fpsWatch}`,
    `sound: music on "${settings.soundOutLabel || 'system default'}", effects on "${settings.fxOutLabel || 'same'}"; Spotify ${Spotify && Spotify.linked() ? 'linked' : 'not linked'}`,
    `uptime: ${Math.round(process.uptime() / 60)} min; windows: GM ${gm && !gm.isDestroyed() ? `${gm.restarts || 0} restarts` : 'closed'}, table ${player && !player.isDestroyed() ? `${player.restarts || 0} restarts` : 'closed'}`,
    '', note ? `What happened:\n${note}` : 'What happened: (not written)',
  ];
  add('about.txt', lines.join('\n'));
  if (applog.file) { add('tablescape.log', readIf(applog.file), mtimeOf(applog.file)); add('tablescape.old.log', readIf(`${applog.file}.old`), mtimeOf(`${applog.file}.old`)); }
  // moods and device names: not needed, and no one else's business. Prototype 3: nor any key, token or code (the
  // room lights' keys, the phones' pairing keys and device tokens were in here): taken out by name, at any depth
  const SECRET = /key|token|psk|secret|identity|password|passwd|code|auth|credential/i;
  const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) && x != null && typeof x !== 'boolean' ? '(removed)' : scrub(x)])) : v);
  const st = scrub({ ...settings, spotify: undefined });
  add('settings.json', JSON.stringify(st, null, 1));
  add('benchmarks.json', readIf(benchFile()), mtimeOf(benchFile()));
  if (store.cur) add('campaign-structure.json', JSON.stringify({ name: store.cur.meta.name, chapters: store.cur.meta.chapters.map((ch) => ({ name: ch.name, maps: ch.maps.map((id) => { const m = store.map(id); return m ? { name: m.name, bg: m.bg ? `${m.bg.kind} ${m.bg.rel || ''}` : null, layers: m.layers.length, fx: m.fx.length, snaps: (m.snaps || []).length, broken: !!m.broken } : id; }) })) }, null, 1));
  const dir = userFile('reports');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = path.join(dir, `Tablescape report ${stamp}.zip`);
  fs.writeFileSync(file, zip(files));
  applog.log.info(`problem report written: ${file}`);
  if (!TEST_DIR) shell.showItemInFolder(file);
  return { ok: true, file, files: files.map((f) => f.name), bytes: fs.statSync(file).size };
}

// =====================================================================
// Startup
// =====================================================================
app.whenReady().then(() => {
  try { startApp(); try { setupUpdates(); } catch (e) { applog.log.warn(`update: ${e.message}`); } } catch (err) {
    // Beta 1: without this the app would sit invisible, holding the single-instance lock
    try { applog.log.error('start failed', err); } catch {}
    dialog.showErrorBox('Tablescape could not start', `${err && (err.message || err)}\n\nThe log is in ${path.join(app.getPath('userData'), 'logs')}.`);
    app.exit(1);
  }
});
// Beta 1: the first start asks where the library (maps, tokens, campaigns) should live. Documents is the default.
function askLibraryRoot() {
  const def = library.defaultLibraryRoot(app);
  const r = dialog.showMessageBoxSync({
    type: 'question', buttons: ['Use Documents', 'Choose a folder…'], defaultId: 0, cancelId: 0, noLink: true, title: 'Tablescape',
    message: 'Where should your library live?',
    detail: `Tablescape keeps your maps, tokens, sounds and campaigns in one folder, the library.\n\nDocuments: ${def}\n\nYou can move it later under Options → Library.`,
  });
  if (r !== 1) return;
  const picked = dialog.showOpenDialogSync({ title: 'Folder for the Tablescape library', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Use this folder' });
  if (!picked || !picked[0]) return;
  settings.libraryRoot = libraryRootIn(picked[0]);
}
// a folder named like the library, or an empty one, is used as it is; anything else gets a "Tablescape Library" inside
function libraryRootIn(folder) {
  let empty = false;
  try { empty = fs.readdirSync(folder).filter((f) => !f.startsWith('.')).length === 0; } catch {}
  return path.basename(folder) === 'Tablescape Library' || empty ? folder : path.join(folder, 'Tablescape Library');
}
// Prototype 20: updates. The finished installers live in the GitHub repo glinnbo/tablescape (built there by GitHub
// from glinnbo/tablescape-wip). Beta 3.0: that repo is public, so the app reads it without a key. Checked a little
// after the start and every few hours; a new version asks first (Prototype 26), is downloaded after a Yes, and
// installed on Restart now or when Tablescape closes.
const UPDATE_REPO = { owner: 'glinnbo', repo: 'tablescape' };
let firstRun = false; // Beta 3.1: this start set Tablescape up for the first time (new settings, demo campaign)
const LINKS = { discord: 'https://discord.gg/T99DRNKaSM', kofi: 'https://ko-fi.com/tablescape', code: 'https://github.com/glinnbo/tablescape' }; // (Beta 3.0)
let Updater = null;
const updateLabel = (v) => { const m = /-proto\.(\d+)$/.exec(String(v || '')); return m ? `Prototype ${m[1]}` : String(v || ''); };
const notesOf = (n) => (Array.isArray(n) ? n.map((x) => (x && x.note) || '').join('\n') : String(n || '')).slice(0, 4000);
function setUpdate(u) { state.update = { ...u, at: Date.now() }; broadcastGm(); }
// Prototype 26: a new version asks first (Install now? Yes / Not now); nothing is downloaded before a Yes.
let updByHand = false; // the check running now was started with the button
let updSkip = null;    // the version answered with "Not now": offered quietly from then on, until asked for by hand
function checkUpdates(byHand) {
  if (!Updater) return { ok: false, error: 'Updates work in the installed app' };
  if (state.update && (state.update.status === 'downloading' || state.update.status === 'ready')) return { ok: true };
  updByHand = !!byHand;
  if (byHand) { updSkip = null; setUpdate({ status: 'checking' }); }
  Updater.checkForUpdates().catch((e) => setUpdate({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
  return { ok: true };
}
function setupUpdates() {
  if (!app.isPackaged || TEST_DIR || process.platform !== 'win32') { state.update = { status: 'off', why: 'dev' }; return; }
  try { Updater = require('electron-updater').autoUpdater; } catch (e) { applog.log.warn(`update: ${e.message}`); state.update = { status: 'off', why: 'module' }; return; }
  Updater.logger = { info: (m) => applog.log.info(`update: ${m}`), warn: (m) => applog.log.warn(`update: ${m}`), error: (m) => applog.log.warn(`update: ${String(m).split('\n')[0]}`), debug: () => {} };
  Updater.autoDownload = false; // (Prototype 26: only after a Yes)
  Updater.autoInstallOnAppQuit = true;
  Updater.setFeedURL({ provider: 'github', ...UPDATE_REPO });
  Updater.on('checking-for-update', () => { if (state.update.status !== 'checking') setUpdate({ status: 'checking' }); });
  Updater.on('update-available', (i) => setUpdate({ status: 'available', version: i.version, label: (typeof i.releaseName === 'string' && i.releaseName.trim()) || updateLabel(i.version), notes: notesOf(i.releaseNotes), quiet: !updByHand && updSkip === i.version }));
  Updater.on('update-not-available', () => setUpdate({ status: 'latest' }));
  Updater.on('download-progress', (p) => { const u = state.update; const pc = Math.round(p.percent || 0); if (u.status === 'downloading' && pc - (u.percent || 0) >= 2) setUpdate({ ...u, percent: pc }); });
  Updater.on('update-downloaded', (i) => { applog.log.info(`update: ${updateLabel(i.version)} ready`); setUpdate({ status: 'ready', version: i.version, label: updateLabel(i.version), notes: notesOf(i.releaseNotes) }); });
  Updater.on('error', (e) => setUpdate({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
  state.update = { status: 'idle' };
  setTimeout(() => checkUpdates(false), 20000);
  setInterval(() => checkUpdates(false), 4 * 3600 * 1000);
}
function startApp() {
  applog.init(path.join(app.getPath('userData'), 'logs'));
  applog.log.info(`Tablescape ${LABEL} (${PKG.version}) starting; Electron ${process.versions.electron}, ${process.platform} ${require('os').release()}, ${Math.round(require('os').totalmem() / 2 ** 30)} GB memory`);
  applog.log.info(`video on the screen: ${VIDEO_PATH_NOW}`);
  Menu.setApplicationMenu(null);
  const BAD = Symbol('bad');
  const saved = readJson(userFile('settings.json'), BAD);
  if (saved === BAD && fs.existsSync(userFile('settings.json'))) {
    // Beta 1: a damaged settings file (half written): kept aside, defaults from here, and no second demo campaign
    try { fs.renameSync(userFile('settings.json'), userFile(`settings.json.damaged-${Date.now()}`)); } catch {}
    applog.log.error('settings.json could not be read: starting with defaults (the file is kept beside it)');
    settings = { ...settings, demoCreated: true, migrated01: true };
    setTimeout(() => sendEvent({ kind: 'toast', text: 'Your settings file could not be read, so the settings are back to their defaults (TV, size, sound outputs). The damaged file is kept next to it.', level: 'error', ms: 15000 }), 4000);
  } else settings = { ...settings, ...(saved === BAD ? {} : saved || {}) };
  if (!TEST_DIR && !settings.demoCreated && !settings.libraryRoot && !library.isPortable(app)) askLibraryRoot();
  const root = TEST_DIR ? path.join(TEST_DIR, 'library') : library.resolveLibraryRoot(app, settings.libraryRoot);
  try { library.ensureLibrary(root, DEMO_DIR); } catch (err) {
    throw new Error(`The library folder could not be set up at ${root}: ${err.message}. Windows "Controlled folder access" may be blocking it; allow Tablescape there, or move the library.`);
  }

  if (!settings.demoCreated) {
    firstRun = true; // (Beta 3.1: a brand-new install, so no "Update successful" maid)
    if (!TEST_DIR && fs.existsSync(DEMO_PKG)) importDemo(); // (Beta 3.1: the maid's cottage; the self-test keeps the drawn goblin caves)
    else { try { createDemoCampaign(); } catch (err) { console.error('demo campaign failed', err); } }
    settings.demoCreated = true;
  }
  if (!settings.migrated01) {
    try { import01(); } catch (err) { console.error('0.1 import failed', err); }
    settings.migrated01 = true;
  }
  if (!settings.drawDefault2) { settings.animDraw = 'cpu'; settings.drawDefault2 = true; } // Beta 1: the processor draws, once for everyone (the benchmark can pick again)
  saveSettings();

  Spotify = SpotifyLink.create({
    file: userFile('spotify.json'), openExternal: (u) => shell.openExternal(u).catch(() => {}), safeStorage, test: !!TEST_DIR,
    log: (m) => applog.log.warn(m),
    onChange: () => { const n = Spotify.info().now; const was = spotifyNow; spotifyNow = n; if (was && was.playing && n && !n.playing && !state.spotifyFight) state.spotifyMood = null; broadcastGm(); },
  });
  settings.spotify = { moods: [], device: '', deviceName: '', volume: null, duck: 0.4, ...(settings.spotify || {}) };
  delete settings.spotify.fade; // 1.7: no fades (they made the music stutter)
  // what Spotify plays, every five seconds while a campaign is open
  setInterval(() => { if (Spotify.linked() && state.screen === 'play') Spotify.refresh(); }, 5000);

  // Beta 3: room lights (Toolbox → Room lights); silent until the GM opens the panel once
  settings.roomLights = { used: false, on: true, strength: 0.8, scene: 'auto', goveeKey: '', tradfri: null, roles: {}, manual: null, ...(settings.roomLights || {}) };
  RoomLights = createRoomLights({
    cfg: () => settings.roomLights, save: saveSettings, onChange: () => broadcastGm(), log: (m) => applog.log.warn(m),
    ports: process.env.TS_LIGHTS_TEST ? { scanHost: '127.0.0.1' } : undefined, cloudUrl: process.env.TS_LIGHTS_CLOUD || undefined,
    game: () => {
      const m = store.cur ? store.map(state.liveMapId) || store.map(state.editMapId) : null;
      const now = Date.now();
      return {
        light: m ? m.light : null, fight: !!(state.init && state.init.running), brk: !!state.brk, blackout: !!state.blackout,
        lasting: (state.moments || []).filter((x) => !x.stop && !x.dur).map((x) => x.id), now,
      };
    },
  });

  // Prototype 7: the table's style, from what a new map and Talk were set to before
  if (!settings.looks || typeof settings.looks !== 'object') {
    const tl = TALK_LOOKS.includes((settings.talk || {}).look) ? settings.talk.look : 'ink';
    const mt = TRANSITIONS.includes(settings.mapTransition) ? settings.mapTransition : 'ink';
    if (!TABLE_STYLES[settings.tableStyle]) settings.tableStyle = tl;
    settings.looks = { map: mt === settings.tableStyle ? 'style' : mt, talk: tl === settings.tableStyle ? 'style' : tl, init: 'style', round: 'style' };
  }
  // Beta 4: phones and tablets (Toolbox → Phone & tablet); listens only once switched on
  settings.remote = { on: false, port: 47630, key: '', devices: [], ...(settings.remote || {}) };
  { // 4.1: the deck is arranged at the PC; 4.2: one for phones, one for tablets
    const was = settings.remote.decks || { phone: settings.remote.deck || { preset: 'turn12', ...DECK_PRESETS[0], pages: [deckStarter()] } };
    settings.remote.decks = { phone: deckFix(was.phone), tablet: deckFix(was.tablet || { ...DECK_PRESETS.find((x) => x.id === 'infoHotbar'), preset: 'infoHotbar', pages: [deckStarter()] }) };
    delete settings.remote.deck;
  }
  for (const d of settings.remote.devices) delete d.layout; // (4.0 kept a layout per device)
  Remote = createRemote({
    cfg: () => settings.remote, save: saveSettings, log: (m) => applog.log.warn(m), label: LABEL,
    dir: path.join(__dirname, 'remote'), icons: path.join(__dirname, 'renderer', 'icons.js'), fonts: path.join(__dirname, 'renderer', 'fonts'), appIcon: ICON,
    port: process.env.TS_REMOTE_PORT ? Number(process.env.TS_REMOTE_PORT) : undefined, testIp: TEST_DIR ? process.env.TS_REMOTE_IP || null : null,
    state: (dev) => remoteState(dev), run: (op, arg, dev) => remoteRun(op, arg, dev),
    onChange: () => broadcastGm(),
  });
  Remote.start(); // listens only when switched on
  Players = createPlayers({
    store, state, settings: () => settings, save: saveSettings, handle, charOf, charFile, charTokOwner, ownerOf: playerTokOwner, charSet, sightOf, initInfo, combatRound: () => (combatInfo() || {}).n,
    turnName: () => { const b = remoteBase(); if (!b.player) b.player = remotePlayers(); const f = b.player.fight; const c = f && f.cards.find((x) => x.cur); return c ? c.name : 'someone else'; }, // (Prototype 3: as the players' screen names it)
    faceUrl: (f) => Remote.faceUrl(f), faceFor, ping: pingAll, calib: setCalib, devices: () => settings.remote.devices || [], connected: (d) => Remote.connected(d), log: (m) => applog.log.warn(m),
  });

  // Beta 3.2: Ambience lamps take the colours on the TV: a small picture of the table window, a few times a second.
  // 4.11.1: the table draws it itself (amb:sample → amb:frame). A screen capture of the TV window every 0.7 s made the
  // TV flicker behind Talk's blur on some PCs; it is only the way back if the table can't draw it (and never behind a blur).
  let sampling = false; let ambFails = 0; let ambAsked = 0;
  ipcMain.on('amb:frame', (e, f) => {
    if (!player || player.isDestroyed() || e.sender !== player.webContents) return;
    ambAsked = 0;
    if (!f || !f.data || !RoomLights) { ambFails++; return; }
    ambFails = 0;
    try { RoomLights.tableFrom(Buffer.from(f.data), Number(f.w) || 32, Number(f.h) || 18); } catch {}
  });
  setInterval(async () => {
    if (sampling || !RoomLights || !RoomLights.wantsTable() || !player || player.isDestroyed()) return;
    if (ambFails < 3) {
      if (ambAsked && Date.now() - ambAsked < 3000) return; // (an answer still on its way)
      ambAsked = Date.now();
      player.webContents.send('amb:sample');
      return;
    }
    if (state.talk || state.handouts.length || state.brk) return;
    sampling = true;
    try {
      const img = await Promise.race([player.webContents.capturePage(), new Promise((r) => setTimeout(() => r(null), 1500))]); // (a window that isn't painted may never answer)
      if (img && !img.isEmpty()) { const small = img.resize({ width: 32, quality: 'good' }); const sz = small.getSize(); RoomLights.tableFrom(small.toBitmap(), sz.width, sz.height); }
    } catch {}
    sampling = false;
  }, 700);

  createGm();
  openSound();

  // Beta 1: a TV that goes away (switched off, cable out) closes the table; when a screen comes back the table
  // opens there again. A table that meanwhile opened as a window on this screen moves over too.
  let tvLost = null; // when the table closed because its screen went away
  const onDisplaysChanged = () => {
    if (player && !player.isDestroyed() && !screen.getAllDisplays().some((d) => d.id === playerOnDisplay)) {
      tvLost = Date.now();
      applog.log.info('the table\'s screen went away: table closed');
      closePlayer();
    }
    broadcast();
  };
  const onDisplayAdded = (e, d) => {
    broadcast();
    if (TEST_DIR) return;
    const back = tvLost && Date.now() - tvLost < 2 * 3600e3; // a screen that comes back within two hours
    const windowedHere = player && !player.isDestroyed() && isWindowed(screen.getDisplayMatching(player.getBounds()));
    if (!back && !windowedHere) return;
    if (!targetDisplay() || isWindowed(targetDisplay())) return; // it is not a second screen
    tvLost = null;
    setTimeout(() => { // Windows is still arranging the screens for a moment
      if (!gm || gm.isDestroyed()) return;
      if (player && !player.isDestroyed()) { player.once('closed', () => openPlayer()); closePlayer(); } else openPlayer();
      applog.log.info(`screen back (${d && d.label}): table opened there`);
      sendEvent({ kind: 'toast', text: `The screen is back: the table is open on ${(d && d.label) || 'it'} again.`, ms: 6000 });
    }, 1500);
  };
  screen.on('display-added', onDisplayAdded);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  // Burst spells fade on their own after a few seconds. A finished countdown leaves the TV after a while.
  setInterval(() => {
    if (state.timer && state.timer.endsAt && Date.now() > state.timer.endsAt + 7000) { state.timer = null; broadcast(); }
    if (state.brk && Date.now() > state.brk.endsAt + 4000) { state.brk = null; broadcast(); }
    if (state.moments.length) { const n = state.moments.length; state.moments = state.moments.filter((m) => Moments.alive(m, Date.now())); if (state.moments.length !== n) broadcast(); }
    if (state.dice && Date.now() > state.dice.t0 + state.dice.dur) { state.dice = null; broadcast(); }
    if (!store.cur) return;
    let changed = false;
    for (const id of [state.liveMapId, state.editMapId]) {
      const m = store.map(id);
      if (m && mapstate.expire(m)) { store.touch(m.id); changed = true; }
    }
    if (changed) broadcast();
  }, 400);

  if (TEST_DIR) {
    // TS_SCRIPT: a script of your own instead of the self-test (for trying things out)
    // Prototype 26: the self-test in areas (src/tests); TS_OLD_TEST=1 runs the old one in one piece
    const runner = process.env.TS_SCRIPT ? require(path.resolve(process.env.TS_SCRIPT)) : process.env.TS_OLD_TEST ? require('./selftest') : require('./tests');
    runner.run({ app, store, state, handle, getWindows: () => ({ gm, player, sound: soundWin }), library, settings, broadcast });
  }
}

// 4.6: a .tablescape file double-clicked: Tablescape opens it (or, already running, gets it from the second start)
const tablescapeArg = (argv) => (argv || []).slice(1).find((a) => typeof a === 'string' && /\.tablescape$/i.test(a) && fs.existsSync(a)) || null;
let pendingImport = tablescapeArg(process.argv);
function offerImport(file) {
  if (!file) return;
  if (gm && !gm.isDestroyed() && !gm.webContents.isLoading()) gm.webContents.send('event', { kind: 'importFile', file });
  else pendingImport = file;
}
app.on('second-instance', (e, argv) => { if (gm) { if (gm.isMinimized()) gm.restore(); gm.focus(); } offerImport(tablescapeArg(argv)); });
app.on('open-file', (e, file) => { e.preventDefault(); if (/\.tablescape$/i.test(file)) offerImport(file); }); // (macOS)
app.on('child-process-gone', (e, d) => { if (d.reason !== 'clean-exit') applog.log.error(`${d.type} process gone: ${d.reason} (${d.name || ''} exit code ${d.exitCode})`); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { clearInterval(previewTimer); store.flush(); if (Remote) Remote.stop(); applog.log.info('quit'); });
// Beta 3.3: the room lights go back to how they were before Tablescape (once, waiting at most 2.5 s), then the app ends
let lightsBack = false;
app.on('will-quit', (e) => {
  if (!RoomLights) return;
  if (lightsBack || !RoomLights.wantsRestore()) { RoomLights.stop(); return; }
  e.preventDefault();
  lightsBack = true;
  Promise.race([RoomLights.restoreAll(true), new Promise((r) => setTimeout(r, 2500))]).catch(() => {}).finally(() => { RoomLights.stop(); app.quit(); });
});
// problems in the main process go into the log instead of stopping the app
process.on('uncaughtException', (err) => { applog.log.error('main', err); });
process.on('unhandledRejection', (err) => { applog.log.error('main (promise)', err); });
for (const k of ['error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); applog.log[k](...a); };
}
