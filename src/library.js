// Asset library: one user-owned folder with fixed top-level subfolders.
// Folders are the source of truth; the app only reads and indexes them.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const WallsImport = require('./walls-import');

const FOLDERS = [
  'Maps/Static',
  'Maps/Animated',
  'Tokens',
  'Assets/Nature',
  'Assets/Furniture',
  'Assets/Structures',
  'Assets/Animated',
  'Effects/Overlays',
  'Effects/Particles',
  'Audio/Ambience',
  'Audio/Music',
  'Audio/SFX',
  'Portraits',
  'Party',
  'Handouts',
  'Tiles', // (Beta 3.22) floor tiles for Oldschool maps
  'Tables',
  'Packs',
  'Campaigns',
  '.cache/thumbs',
  '.cache/vtt',
  '.cache/anim',
];

const EXT_KIND = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image',
  '.webm': 'video', '.mp4': 'video', '.m4v': 'video', '.mov': 'video',
  '.mp3': 'audio', '.ogg': 'audio', '.opus': 'audio', '.wav': 'audio', '.flac': 'audio', '.m4a': 'audio',
  // Universal VTT maps (Dungeon Alchemist, Dungeondraft ...): a picture with walls, doors and lights
  '.dd2vtt': 'image', '.uvtt': 'image', '.df2vtt': 'image',
};

// Demo files shipped with the app and copied into a fresh library.
const DEMO_FILES = {
  'demo-dungeon.png': 'Maps/Static/Demo dungeon.png',
  'demo-dungeon-torchlight.mp4': 'Maps/Animated/Demo dungeon (torchlight).mp4',
  'embers-alpha.webm': 'Effects/Overlays/Embers (alpha).webm',
  'dust-alpha.webm': 'Effects/Overlays/Dust motes (alpha).webm',
  'token-hero.png': 'Tokens/Hero.png',
  'token-goblin.png': 'Tokens/Goblin.png',
  'token-ogre.png': 'Tokens/Ogre.png',
  'cave-drone.ogg': 'Audio/Ambience/Cave drone.ogg',
  'asset-oak.png': 'Assets/Nature/Oak tree.png',
  'asset-pine.png': 'Assets/Nature/Pine tree.png',
  'asset-boulder.png': 'Assets/Nature/Boulder.png',
  'asset-bush.png': 'Assets/Nature/Bush.png',
  'asset-barrel.png': 'Assets/Furniture/Barrel.png',
  'asset-crate.png': 'Assets/Furniture/Crate.png',
  'asset-table.png': 'Assets/Furniture/Round table.png',
  'asset-pillar.png': 'Assets/Structures/Broken pillar.png',
  'asset-orb.webm': 'Assets/Animated/Magic orb.webm', // 2.3: an animated asset (baked into frames when a map uses it)
  'portrait-stranger.png': 'Portraits/Hooded stranger.png',
  'portrait-captain.png': 'Portraits/Captain of the guard.png',
  'handout-letter.png': 'Handouts/Sealed letter.png',
  'demo-crypt.dd2vtt': 'Maps/Static/Demo crypt.dd2vtt',
};

// I8 (Glinn's own sound effects, 25 Nov 2026): the Soundboard's starter sounds, from the app's sounds (src/renderer/sfx;
// most are the screen effects' built-in sounds too). They replaced Thunder, Door creak and Monster roar of before.
const STARTER_SFX = {
  'thunder-roll.wav': 'Audio/SFX/Thunder.wav',
  'board-door.wav': 'Audio/SFX/Door creak.wav',
  'board-roar-1.wav': 'Audio/SFX/Monster roar 1.wav',
  'board-roar-2.wav': 'Audio/SFX/Monster roar 2.wav',
  'board-footsteps.wav': 'Audio/SFX/Footsteps.wav',
  'board-bell.wav': 'Audio/SFX/Bell.wav', // (made anew: a bronze bell's partials, a strike, a little room)
  'board-heartbeat.wav': 'Audio/SFX/Heartbeat.wav',
  // (Glinn: the horror hits each a pad of their own, not one that picks at random)
  'moment-timestop.wav': 'Audio/SFX/Horror strike.wav',
  'board-horror-drums.wav': 'Audio/SFX/Horror drums.wav',
  'moment-lightsout.wav': 'Audio/SFX/Horror boom.wav',
  'moment-roar.wav': 'Audio/SFX/Dragon roar.wav',
  'moment-explosion.wav': 'Audio/SFX/Explosion.wav',
  'moment-holy.wav': 'Audio/SFX/Choir hit.wav',
};
// the starter sounds they replaced (their sizes as they came): still untouched, they move to Audio/Old sounds, out of the
// Soundboard (nothing is deleted)
const OLD_STARTER_SFX = { 'Audio/SFX/Thunder.ogg': 32511, 'Audio/SFX/Door creak.ogg': 22448, 'Audio/SFX/Monster roar.ogg': 20114, 'Audio/SFX/Bell.ogg': 18071 };
// the first names of the horror hits (25 Nov 2026), renamed where they are still as they came: name → [new name, its sound]
const RENAMED_SFX = { 'Audio/SFX/Horror hit 1.wav': ['Audio/SFX/Horror strike.wav', 'moment-timestop.wav'], 'Audio/SFX/Horror hit 2.wav': ['Audio/SFX/Horror drums.wav', 'board-horror-drums.wav'], 'Audio/SFX/Horror hit 3.wav': ['Audio/SFX/Horror boom.wav', 'moment-lightsout.wav'] };

let ROOT = null;

function kindOf(file) {
  return EXT_KIND[path.extname(String(file)).toLowerCase()] || null;
}

// Portable mode: a file named portable.txt next to the exe keeps the
// library next to the program (USB-stick setups).
// Beta 1: a folder of the user's choice (settings.libraryRoot, asked at the first start or moved later) comes
// before the default in Documents.
function resolveLibraryRoot(app, chosen) {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  if (fs.existsSync(path.join(exeDir, 'portable.txt'))) return path.join(exeDir, 'Tablescape Library');
  if (chosen && typeof chosen === 'string' && path.isAbsolute(chosen) && fs.existsSync(path.dirname(chosen))) return chosen;
  return defaultLibraryRoot(app);
}
const defaultLibraryRoot = (app) => path.join(app.getPath('documents'), 'Tablescape Library');
const isPortable = (app) => fs.existsSync(path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')), 'portable.txt'));

function ensureLibrary(root, demoDir) {
  listMemo = null; thereAt = 0;
  ROOT = root;
  for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
  const readme = path.join(root, 'README.txt');
  if (!fs.existsSync(readme) || !fs.readFileSync(readme, 'utf8').includes('Tiles  ')) {
    fs.writeFileSync(readme, [
      'Tablescape library',
      '',
      'Drop files into these folders. The app picks them up when you open the library.',
      '  Maps/Static       images used as maps; Universal VTT files (.dd2vtt, .uvtt) bring their walls and doors',
      '  Maps/Animated     looping video maps (mp4, webm); a walls file with the same name next to it is used too',
      '  Tokens            NPCs and creatures (png/webp, or small webm animations)',
      '  Assets            top-down things to place on maps: trees, rocks, furniture...',
      '  Effects/Overlays  transparent webm loops (rain, dust, fire...)',
      '  Audio/*           ambience, music, sound effects (Audio/SFX feeds the soundboard)',
      '  Portraits         NPC busts for the Portraits tool (png with a transparent background works best)',
      '  Party             the players\' characters: portraits, cut-outs, map tokens (their cards pick from here)',
      '  Handouts          letters, notes, sketches to show on the table',
      '  Tiles             seamless floor pictures for Oldschool maps (how many squares one spans is asked once)',
      '  Tables            tables for the wheel of luck (.txt, .csv, .md), for every campaign',
      '  Packs             creator downloads, kept as they come',
      '  Campaigns         your campaigns (made by the app)',
      '  .cache            thumbnails and baked animations, safe to delete',
      '',
    ].join('\r\n'));
  }
  for (const [rel, size] of Object.entries(OLD_STARTER_SFX)) {
    const f = path.join(root, rel); const to = path.join(root, 'Audio', 'Old sounds', path.basename(rel));
    try { if (fs.existsSync(f) && fs.statSync(f).size === size && !fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } } catch {}
  }
  const sfxDir = path.join(__dirname, 'renderer', 'sfx');
  for (const [rel, [to, src]] of Object.entries(RENAMED_SFX)) {
    const f = path.join(root, rel); const t = path.join(root, to);
    try { if (fs.existsSync(f) && !fs.existsSync(t) && fs.statSync(f).size === fs.statSync(path.join(sfxDir, src)).size) fs.renameSync(f, t); } catch {}
  }
  for (const [src, dest] of Object.entries(STARTER_SFX)) {
    const to = path.join(root, dest);
    if (fs.existsSync(to)) continue;
    try { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, fs.readFileSync(path.join(sfxDir, src))); } catch {}
  }
  if (demoDir && fs.existsSync(demoDir)) {
    for (const [src, dest] of Object.entries(DEMO_FILES)) {
      const from = path.join(demoDir, src);
      const to = path.join(root, dest);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        try { fs.copyFileSync(from, to); } catch {}
      }
    }
  }
}

function sectionOf(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'Maps' || parts[0] === 'Effects' || parts[0] === 'Audio') return `${parts[0]}/${parts[1] || ''}`;
  return parts[0];
}

// Which library category a file belongs to: maps, tokens, assets, overlays or sounds.
// Packs keep their own folder layout, so their files are sorted by their names.
const PACK_HINTS = [
  ['tiles', /\b(tiles?|textures?|floors?|seamless)\b/i],
  ['portraits', /\b(portraits?|busts?|sprites?)\b/i],
  ['handouts', /\b(handouts?|letters?|documents?|scrolls?|notes?)\b/i],
  ['tokens', /\b(tokens?|npcs?|creatures?|monsters?|minis?|characters?)\b/i],
  ['maps', /\b(maps?|battle ?maps?|scenes?|encounters?)\b/i],
  ['assets', /\b(assets?|props?|objects?|decor|furniture|trees?|rocks?|plants?|bushes|clutter|structures?|items?)\b/i],
  ['overlays', /\b(overlays?|fx|effects?|alpha)\b/i],
];
const WEATHER_WORDS = /\b(weather|rain|snow|fog|mist|embers?|sparks?|smoke|fire|flames?|rays?|dust|leaves|ash)\b/i;
function categoryOf(rel, kind) {
  if (kind === 'audio') return 'sounds';
  const top = rel.split('/')[0];
  if (top === 'Maps') return 'maps';
  if (top === 'Tokens') return 'tokens';
  if (top === 'Assets' || top === 'Props') return 'assets';
  if (top === 'Effects') return 'overlays';
  if (top === 'Portraits') return 'portraits';
  if (top === 'Party') return 'party'; // 4.7: the players' characters: portraits, Talk sprites, tokens
  if (top === 'Handouts') return 'handouts';
  if (top === 'Tiles') return 'tiles'; // (Beta 3.22) floors for Oldschool maps
  const words = rel.replace(/[_\-./()]+/g, ' ');
  for (const [cat, re] of PACK_HINTS) if (re.test(words)) return cat;
  if (kind === 'video' && WEATHER_WORDS.test(words)) return 'overlays';
  return 'maps';
}

// Speed 4 (WD1, WD2, WD3): one walk of the library, kept. Every panel, the search, the Draw tool, the sounds of the
// screen effects (every ten seconds) and a screen effect's start each walked the whole library again: a stat and a
// thumb check for every file, 0.3 s for 5000 files, with the app held meanwhile. The list is now kept until something
// says it is stale: the library's own actions (listDirty), a watcher on the library's folder (not its Campaigns:
// those are saved all the time and are not in the list), and at the latest after LIST_KEEP_MS in case the watcher
// missed something. No watcher (it could not be set up, or it failed): no keeping, every call walks as before.
const LIST_KEEP_MS = 30000;
const listStats = { walks: 0, kept: 0 }; // (for the self-test)
let listMemo = null; let listWatch = null; let listWatchRoot = null;
function listDirty() { listMemo = null; thereAt = 0; }
// Speed 4 (WD5): "is this file there?", kept. Every state the app sends asked the disk about each Ready item, each
// Hotbar file, each screen picture and each shared handout, twice each (once to find it, once to see whether it is
// missing): now once in THERE_MS. Forgotten whenever the library's list is (its own actions, the watcher on its
// folder), and by main when a window gets the focus (the GM may have moved a file in the Explorer meanwhile).
// Only for what is shown: whoever is about to read, copy or delete a file asks the disk itself (resolveRef).
const THERE_MS = 5000;
const thereStats = { asked: 0 }; // (for the self-test)
let thereMap = new Map(); let thereAt = 0;
function there(p) {
  if (!p) return false;
  const now = Date.now();
  if (now - thereAt > THERE_MS || now < thereAt) { thereMap = new Map(); thereAt = now; }
  let v = thereMap.get(p);
  if (v === undefined) { thereStats.asked++; v = fs.existsSync(p); thereMap.set(p, v); }
  return v;
}
function thereForget() { thereAt = 0; }
function listWatched() {
  if (listWatch && listWatchRoot === ROOT) return true;
  if (listWatch) { try { listWatch.close(); } catch {} listWatch = null; listWatchRoot = null; }
  try {
    const at = ROOT;
    const w = fs.watch(at, { recursive: true }, (ev, name) => { if (name && /^campaigns([\/]|$)/i.test(String(name))) return; listMemo = null; thereAt = 0; });
    w.on('error', () => { try { w.close(); } catch {} if (listWatch === w) { listWatch = null; listWatchRoot = null; } listMemo = null; });
    if (w.unref) w.unref();
    listWatch = w; listWatchRoot = at; return true;
  } catch { return false; }
}
function listLibrary(root = ROOT) {
  if (root !== ROOT || !ROOT) return walkLibrary(root);
  if (listMemo && listMemo.root === ROOT && Date.now() - listMemo.at < LIST_KEEP_MS) { listStats.kept++; return listMemo.items.map((it) => ({ ...it })); }
  const watched = listWatched(); // (set up before the walk: a change during it is not lost)
  listMemo = null;
  const mark = {}; listMemo = watched ? mark : null;
  const items = walkLibrary(root);
  if (watched && listMemo === mark) listMemo = { root: ROOT, at: Date.now(), items };
  else if (listMemo === mark) listMemo = null;
  return items.map((it) => ({ ...it }));
}
function walkLibrary(root = ROOT) {
  listStats.walks++;
  if (root === ROOT) thumbsWanted = new Set();
  const items = [];
  const meta = readMeta();
  const fav = new Set(meta.favs);
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // walls files lying next to a map with the same name
    const walled = new Set(entries.filter((e) => /\.(dd2vtt|uvtt|df2vtt|json)$/i.test(e.name)).map((e) => path.parse(e.name).name.toLowerCase()));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0 && e.name === 'Campaigns') continue;
        walk(full, depth + 1);
        continue;
      }
      const kind = kindOf(e.name);
      if (!kind) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      let stat = null;
      try { stat = fs.statSync(full); } catch { continue; }
      const thumb = thumbFile(full, stat);
      if (thumb && root === ROOT) thumbsWanted.add(path.basename(thumb));
      const parts = rel.split('/');
      const vtt = WallsImport.isVtt(full);
      let url = pathToFileURL(full).href;
      if (vtt) { const img = vttImagePath(full, stat); if (!img) continue; url = pathToFileURL(img).href; }
      items.push({
        path: full,
        url,
        walls: vtt || ((kind === 'image' || kind === 'video') && walled.has(path.parse(e.name).name.toLowerCase())),
        rel,
        name: path.parse(e.name).name,
        kind,
        section: sectionOf(rel),
        cat: categoryOf(rel, kind),
        pack: parts[0] === 'Packs' && parts.length > 2 ? parts[1] : null,
        folder: path.dirname(rel),
        mtime: stat.mtimeMs,
        fav: fav.has(rel),
        recent: meta.recent.indexOf(rel),
        thumb: thumb && fs.existsSync(thumb) ? pathToFileURL(thumb).href : null,
        ...(parts[0] === 'Tiles' ? tileGridOf(meta.tiles[rel]) : {}),
      });
    }
  };
  walk(root, 0);
  if (root === ROOT) items.push(...builtinItems(meta), ...builtinTileItems(meta)); // (Beta 3.20: the living trees, under Assets; 3.22: the tiles)
  return items;
}

// ---------- favourites and recently used (kept with the library) ----------
const metaFile = () => path.join(ROOT, '.cache', 'library.json');
function readMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
    return { favs: Array.isArray(m.favs) ? m.favs : [], recent: Array.isArray(m.recent) ? m.recent : [], tiles: m.tiles && typeof m.tiles === 'object' ? m.tiles : {} };
  } catch { return { favs: [], recent: [], tiles: {} }; }
}
function writeMeta(m) {
  listMemo = null; // (stars, recently used and a tile's grid are in the list)
  try { fs.mkdirSync(path.dirname(metaFile()), { recursive: true }); fs.writeFileSync(metaFile(), JSON.stringify(m)); } catch {}
}
const relOf = (absPath) => { const r = toRef(absPath); return r.rel || null; };
function setFavourite(absPath, on) {
  const rel = relOf(absPath);
  if (!rel) return false;
  const m = readMeta();
  m.favs = m.favs.filter((x) => x !== rel);
  if (on) m.favs.unshift(rel);
  writeMeta(m);
  return true;
}
// Beta 3.22: how many squares a tile of the library spans (set once, the first time it is used on an Oldschool map).
// Beta 3.24: and where its joints lie (off: [across, down] as a fraction of a square), for the tiles of the app too
// (key: their name; squares null: back to the app's own). Kept in the library's meta as { squares, off }.
function tileGridOf(v) {
  if (typeof v === 'number') return { squares: v, off: null };
  if (v && typeof v === 'object') return { squares: Number(v.squares) || null, off: Array.isArray(v.off) ? v.off.map((x) => ((Number(x) % 1) + 1) % 1) : null };
  return { squares: null, off: null };
}
function setTileSquares(key, squares, off) {
  const b = BUILTIN.get(key) || (key && BUILTIN_AT.get(path.resolve(String(key))));
  const rel = b && b.tile ? b.rel : relOf(key);
  if (!rel) return false;
  const m = readMeta();
  if (squares == null) { if (!b) return false; delete m.tiles[rel]; writeMeta(m); return true; }
  const n = Math.round(Number(squares) * 4) / 4;
  if (!(n >= 0.5 && n <= 64)) return false;
  const o = Array.isArray(off) && off.length === 2 && off.every((x) => Number.isFinite(Number(x))) ? off.map((x) => Math.round((((Number(x) % 1) + 1) % 1) * 1000) / 1000) : null;
  m.tiles[rel] = o ? { squares: n, off: o } : n;
  writeMeta(m);
  return true;
}
// forget recently used files (all of them, or these)
function forgetRecent(paths) {
  const m = readMeta();
  const rels = Array.isArray(paths) ? new Set(paths.map(relOf).filter(Boolean)) : null;
  m.recent = rels ? m.recent.filter((x) => !rels.has(x)) : [];
  writeMeta(m);
}
function touchRecent(absPath) {
  const rel = relOf(absPath);
  if (!rel) return;
  const m = readMeta();
  m.recent = [rel, ...m.recent.filter((x) => x !== rel)].slice(0, 40);
  writeMeta(m);
}

// ---------- media references ----------
// Stored in campaign files as { path, rel }: rel (relative to the library)
// wins when the file exists there, so a library can move drives or computers.
function toRef(absPath) {
  if (BUILTIN.has(absPath)) absPath = BUILTIN.get(absPath).path; // (Beta 3.21: a living tree named by its library name, as the Assets panel's Living tab does)
  const p = path.resolve(absPath);
  const b = BUILTIN_AT.get(p);
  if (b) return { path: p, name: b.name, rel: b.rel };
  const ref = { path: p, name: path.parse(p).name };
  if (ROOT) {
    const rel = path.relative(ROOT, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ref.rel = rel.split(path.sep).join('/');
  }
  return ref;
}
function resolveRef(ref) {
  if (!ref) return null;
  if (ref.rel && BUILTIN.has(ref.rel)) return BUILTIN.get(ref.rel).path; // (Beta 3.20: it comes with the app)
  if (ref.rel && ROOT) {
    const p = path.join(ROOT, ...ref.rel.split('/'));
    if (fs.existsSync(p)) return p;
  }
  return ref.path;
}
// the same for what is only shown (WD5): the disk is asked once in a while, not on every state
function resolveKept(ref) {
  if (!ref) return null;
  if (ref.rel && BUILTIN.has(ref.rel)) return BUILTIN.get(ref.rel).path;
  if (ref.rel && ROOT) {
    const p = path.join(ROOT, ...ref.rel.split('/'));
    if (there(p)) return p;
  }
  return ref.path;
}
// ---------- Beta 3.20: what comes with the app (the living trees) ----------
// They are not files of the library folder: they lie with the app, are picked in the Assets panel's Living tab (Beta
// 3.21; the library lists them only for the Cartographer, under Assets → Living trees), and a
// reference to one is kept by that name (rel), so it is found on any PC and after any update. A living tree on a map
// is an asset whose picture is the tree's still picture; what makes it live is its "tree" (variant, size, seed).
const BUILTIN = new Map(); // rel → { rel, path, name, tree: { v, size, base } }
const BUILTIN_AT = new Map(); // path → the same
const TREE_FOLDER = 'Assets/Living trees';
function loadBuiltin() {
  BUILTIN.clear(); BUILTIN_AT.clear();
  let data = null;
  try { data = require('./renderer/tree-data'); } catch { return; }
  const dir = path.join(__dirname, 'renderer', 'trees');
  for (const id of data.order) {
    const v = data.variants[id];
    for (const s of v.sizes) {
      const name = `${v.label} ${s.id}`;
      const e = { rel: `${TREE_FOLDER}/${name}.webp`, path: path.join(dir, id, `still-${s.id}.webp`), name, tree: { v: id, size: s.id, base: s.base }, turn: (v.variation && v.variation.rotation) || 180 };
      BUILTIN.set(e.rel, e); BUILTIN_AT.set(e.path, e);
    }
  }
}
loadBuiltin();
// the living tree a reference stands for ({ v, size, base, turn }), or null
function treeOf(ref) {
  if (!ref) return null;
  const e = (ref.rel && BUILTIN.get(ref.rel)) || (ref.path && BUILTIN_AT.get(path.resolve(ref.path))) || null;
  return e && e.tree ? { ...e.tree, turn: e.turn } : null; // (Beta 3.22: the tiles are built in too, and no trees)
}
const isBuiltin = (rel) => BUILTIN.has(rel);
// ---------- Beta 3.49: the lights that come with the app (Draw → Structure → Light; Effects → Light sources) ----------
// An unlit picture each (renderer/lights), kept by name like the trees and the tiles; what burns on it is an effect.
const LIGHT_FOLDER = 'Assets/Lights';
const LIGHTS = new Map(); // id → { id, label, rel, path, w, h, wall?, fx }
function loadLights() {
  let data = null;
  try { data = require('./renderer/light-data'); } catch { return; }
  const dir = path.join(__dirname, 'renderer', 'lights');
  for (const d of data.lights) {
    const e = { rel: `${LIGHT_FOLDER}/${d.label}.png`, path: path.join(dir, d.file), name: d.label, light: { ...d } };
    BUILTIN.set(e.rel, e); BUILTIN_AT.set(e.path, e);
    LIGHTS.set(d.id, { ...d, rel: e.rel, path: e.path });
  }
}
loadLights();
const lightOf = (id) => LIGHTS.get(id) || null;
// ---------- Beta 3.22: the tiles that come with the app (Oldschool maps) ----------
// Floors are listed under Tiles/Tablescape; materials (what walls, rock and cliffs are made of) are known by the same
// kind of name but not listed. Like the living trees they lie with the app and are kept by name.
const TILE_FOLDER = 'Tiles/Tablescape';
function loadTiles() {
  let data = null;
  try { data = require('./renderer/tile-data'); } catch { return; }
  const dir = path.join(__dirname, 'renderer', 'tiles');
  for (const t of data.tiles) {
    if (t.kind !== 'floor' && t.kind !== 'material') continue; // (a wall kit is no tile: it has no picture of its own, and its name may be a floor's)
    const e = { rel: `${TILE_FOLDER}/${t.label}.webp`, path: path.join(dir, t.file), name: t.label, small: path.join(dir, t.small), tile: { id: t.id, kind: t.kind, squares: t.squares, off: t.off || [0, 0] } };
    BUILTIN.set(e.rel, e); BUILTIN_AT.set(e.path, e);
  }
}
loadTiles();
const tileOf = (ref) => { const e = ref && ((ref.rel && BUILTIN.get(ref.rel)) || (ref.path && BUILTIN_AT.get(path.resolve(ref.path)))); return e && e.tile ? { ...e.tile } : null; };
function builtinTileItems(meta) {
  const fav = new Set(meta.favs);
  return [...BUILTIN.values()].filter((e) => e.tile && e.tile.kind === 'floor').map((e) => {
    const own = tileGridOf(meta.tiles[e.rel]); // (Beta 3.24: adjusted by the GM)
    return {
      path: e.path, url: pathToFileURL(e.path).href, walls: false, rel: e.rel, name: e.name, kind: 'image', section: 'Tiles', cat: 'tiles', pack: null,
      folder: TILE_FOLDER, mtime: 0, fav: fav.has(e.rel), recent: meta.recent.indexOf(e.rel), thumb: pathToFileURL(e.small).href, builtin: true,
      squares: own.squares || e.tile.squares, off: own.squares ? own.off || [0, 0] : e.tile.off, adjusted: !!own.squares, tile: { ...e.tile },
    };
  });
}
function builtinItems(meta) {
  const fav = new Set(meta.favs);
  return [...BUILTIN.values()].filter((e) => e.tree).map((e) => ({
    path: e.path, url: pathToFileURL(e.path).href, walls: false, rel: e.rel, name: e.name, kind: 'image', section: 'Assets', cat: 'assets', pack: null,
    folder: TREE_FOLDER, mtime: 0, fav: fav.has(e.rel), recent: meta.recent.indexOf(e.rel), thumb: pathToFileURL(e.path).href, builtin: true, tree: { ...e.tree },
  }));
}

// Adds runtime fields (absolute path + file URL) to a stored reference.
function hydrate(obj) {
  if (!obj || !(obj.path || obj.rel)) return obj;
  const p = resolveRef(obj);
  obj.path = p;
  obj.url = urlOf(p);
  obj.missing = !fs.existsSync(p);
  return obj;
}
function media(absPath) {
  const ref = toRef(absPath);
  return { ...ref, url: urlOf(ref.path), missing: false };
}
// a Universal VTT file is shown through the picture inside it
function urlOf(p) {
  if (WallsImport.isVtt(p)) { const img = vttImagePath(p); if (img) return pathToFileURL(img).href; }
  return pathToFileURL(p).href;
}
// The picture of a Universal VTT file, unpacked once into .cache/vtt (made again if the cache was cleared).
const vttKept = (full, stat) => ({ key: crypto.createHash('sha1').update(`${full}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20), dir: path.join(ROOT || path.dirname(full), '.cache', 'vtt') });
function vttImagePath(full, stat) {
  try { stat = stat || fs.statSync(full); } catch { return null; }
  const { key, dir } = vttKept(full, stat);
  for (const ext of ['png', 'jpg', 'webp']) { const f = path.join(dir, `${key}.${ext}`); if (fs.existsSync(f)) return f; }
  try {
    const { img, neutral } = WallsImport.vttBoth(full); // (WD6: its walls from the same reading, kept beside the picture)
    if (!img) return null;
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${key}.${img.ext}`);
    fs.writeFileSync(f, img.buf);
    if (neutral) { try { fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ v: VTT_WALLS, ...neutral })); } catch { /* (read again when asked) */ } }
    return f;
  } catch { return null; }
}
// Speed 4 (WD6): the walls, doors and lights of a Universal VTT file, kept beside its unpacked picture. Such a file
// is 20 to 60 MB with its picture inside, and it was read and unpacked whole, with the app held for up to half a
// second, every time it became a map's picture (and once more when the library first saw it). Now the small part
// that is not the picture is kept in .cache/vtt under the same name as the picture (the file's place, size and date:
// a changed file is read anew). VTT_WALLS: raise it when what readVtt makes of a file changes.
const VTT_WALLS = 1;
const vttStats = { read: 0, kept: 0 }; // (for the self-test)
function vttWalls(full) {
  let at = null;
  try { const k = vttKept(full, fs.statSync(full)); at = { dir: k.dir, file: path.join(k.dir, `${k.key}.json`) }; } catch { at = null; }
  if (at) {
    try {
      const n = JSON.parse(fs.readFileSync(at.file, 'utf8'));
      if (n && n.kind === 'uvtt' && n.v === VTT_WALLS && Array.isArray(n.walls)) { vttStats.kept++; const { v, ...rest } = n; return rest; }
    } catch { /* (not kept yet, or not readable: from the file itself) */ }
  }
  vttStats.read++;
  const n = WallsImport.readVtt(full); // (throws on a file that is no map, as before)
  if (at) { try { fs.mkdirSync(at.dir, { recursive: true }); fs.writeFileSync(at.file, JSON.stringify({ v: VTT_WALLS, ...n })); } catch { /* */ } }
  return n;
}

// ---------- thumbnails ----------
function thumbFile(full, stat) {
  if (!ROOT) return null;
  try { stat = stat || fs.statSync(full); } catch { return null; }
  const key = crypto.createHash('sha1').update(`${full}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20);
  return path.join(ROOT, '.cache', 'thumbs', `${key}.webp`);
}
// Speed 3 (WC3, with Glinn's yes of 26 Nov 2026): the small pictures in .cache/thumbs are named after a file's place,
// size and date, so a file that changed or went left its small picture behind for good (3,142 of them were counted for
// 1,378 files). Those that belong to no file of the library, nor to one of the paths given (the open campaign's
// files), and are older than minAgeMs are removed: only files named as this module names them, nothing else in the
// folder. They are a cache: one that is needed again is made again. Other campaigns' pictures are not known here, hence
// the age: theirs are made again when that campaign is opened.
let thumbsWanted = new Set(); // (the names the last walk of the library asked about)
const THUMB_NAME = /^[0-9a-f]{20}\.webp$/;
async function sweepThumbs(keepPaths = [], minAgeMs = 7 * 864e5) {
  if (!ROOT) return { removed: 0, kept: 0 };
  const dir = path.join(ROOT, '.cache', 'thumbs');
  let names = [];
  try { names = await fs.promises.readdir(dir); } catch { return { removed: 0, kept: 0 }; }
  listLibrary(); // (so that thumbsWanted is of now)
  const want = new Set(thumbsWanted);
  for (const p of keepPaths) { const f = thumbFile(p); if (f) want.add(path.basename(f)); }
  let removed = 0; let kept = 0; const now = Date.now();
  for (const name of names) {
    if (!THUMB_NAME.test(name) || want.has(name)) { kept++; continue; }
    try {
      const st = await fs.promises.stat(path.join(dir, name));
      if (!st.isFile() || now - st.mtimeMs < minAgeMs) { kept++; continue; }
      await fs.promises.unlink(path.join(dir, name)); removed++;
    } catch { kept++; }
  }
  if (removed) listMemo = null;
  return { removed, kept };
}
function thumbUrl(full) {
  const f = thumbFile(full);
  return f && fs.existsSync(f) ? pathToFileURL(f).href : null;
}
function putThumb(full, dataUrl) {
  listMemo = null; // (the list says which files have a small picture)
  const f = thumbFile(full);
  const prefix = 'data:image/webp;base64,';
  if (!f || typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return null;
  fs.writeFileSync(f, Buffer.from(dataUrl.slice(prefix.length), 'base64'));
  return pathToFileURL(f).href;
}

// ---------- Add from PC: copy files into the library ----------
// cat: the library section they are for (maps, tokens, sounds ...); folder: a folder inside the library to use instead
function defaultFolder(cat, kind) {
  if (kind === 'audio') return 'Audio/SFX';
  switch (cat) {
    case 'tokens': return 'Tokens';
    case 'assets': return 'Assets';
    case 'overlays': return 'Effects/Overlays';
    case 'portraits': return 'Portraits';
    case 'party': return 'Party';
    case 'handouts': return 'Handouts';
    case 'tiles': return 'Tiles';
    case 'sounds': return 'Audio/SFX';
    default: return kind === 'video' ? 'Maps/Animated' : 'Maps/Static';
  }
}
// J8 (open point): the same size is not enough (two exports of the same kind often are): the bytes are compared, a
// megabyte at a time, stopping at the first difference
function sameFile(a, b) {
  let fa = null; let fb = null;
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    fa = fs.openSync(a, 'r'); fb = fs.openSync(b, 'r');
    const A = Buffer.alloc(1 << 20); const B = Buffer.alloc(1 << 20);
    for (;;) {
      const n = fs.readSync(fa, A, 0, A.length, null); const m = fs.readSync(fb, B, 0, B.length, null);
      if (n !== m) return false;
      if (n === 0) return true;
      if (!A.subarray(0, n).equals(B.subarray(0, n))) return false;
    }
  } catch { return false; } finally { if (fa != null) fs.closeSync(fa); if (fb != null) fs.closeSync(fb); }
}
// a name that is free in dir (or the same file already there): "Crypt.png", "Crypt (2).png" ...
function freeName(dir, base, src) {
  const { name, ext } = path.parse(base);
  for (let i = 1; i < 500; i++) {
    const p = path.join(dir, i === 1 ? base : `${name} (${i})${ext}`);
    if (!fs.existsSync(p)) return { path: p, same: false };
    if (sameFile(p, src)) return { path: p, same: true };
  }
  return { path: path.join(dir, `${name} ${Date.now()}${ext}`), same: false };
}
// UI audit VJ7: the same, without holding the app still while big files are copied, and telling which file failed
// (a full disk, a locked file: the copy threw and nothing was said). → { done, failed: [{ name, why }] }
async function importFilesSoon(files, opt = {}) { listMemo = null; thereAt = 0; try { return await importFilesSoonNow(files, opt); } finally { listMemo = null; thereAt = 0; } }
async function importFilesSoonNow(files, { cat, folder } = {}) {
  const done = []; const failed = [];
  for (const raw of files || []) {
    const src = path.resolve(String(raw));
    const kind = kindOf(src);
    if (!kind || !fs.existsSync(src)) continue;
    try {
      const ref = toRef(src);
      if (ref.rel) { done.push({ path: src, rel: ref.rel, copied: false }); continue; } // already in the library
      const rel = folder && !/(^|[\\/])\.\.([\\/]|$)/.test(folder) ? folder : defaultFolder(cat, kind);
      const dir = path.join(ROOT, ...String(rel).split(/[\\/]+/).filter(Boolean));
      await fs.promises.mkdir(dir, { recursive: true });
      const dest = freeName(dir, path.basename(src), src);
      if (!dest.same) await fs.promises.copyFile(src, dest.path);
      let walls = false;
      if ((kind === 'image' || kind === 'video') && !WallsImport.isVtt(src)) {
        const side = WallsImport.sidecar(src);
        if (side) {
          const to = path.join(dir, path.parse(dest.path).name + path.extname(side));
          try { if (!fs.existsSync(to)) await fs.promises.copyFile(side, to); walls = true; } catch {}
        }
      }
      done.push({ path: dest.path, rel: toRef(dest.path).rel, copied: !dest.same, walls });
    } catch (err) {
      failed.push({ name: path.basename(src), why: (err && err.code) === 'ENOSPC' ? 'the disk is full' : (err && err.code) === 'EBUSY' || (err && err.code) === 'EPERM' ? 'the file is in use or locked' : String((err && err.message) || err) });
    }
  }
  return { done, failed };
}
function importFiles(files, { cat, folder } = {}) {
  listMemo = null; thereAt = 0;
  const out = [];
  for (const raw of files || []) {
    const src = path.resolve(String(raw));
    const kind = kindOf(src);
    if (!kind || !fs.existsSync(src)) continue;
    const ref = toRef(src);
    if (ref.rel) { out.push({ path: src, rel: ref.rel, copied: false }); continue; } // already in the library
    const rel = folder && !/(^|[\\/])\.\.([\\/]|$)/.test(folder) ? folder : defaultFolder(cat, kind);
    const dir = path.join(ROOT, ...String(rel).split(/[\\/]+/).filter(Boolean));
    fs.mkdirSync(dir, { recursive: true });
    const dest = freeName(dir, path.basename(src), src);
    if (!dest.same) fs.copyFileSync(src, dest.path);
    // a map picture with its walls file (same name, next to it): the walls file comes along under the same new name
    let walls = false;
    if ((kind === 'image' || kind === 'video') && !WallsImport.isVtt(src)) {
      const side = WallsImport.sidecar(src);
      if (side) {
        const to = path.join(dir, path.parse(dest.path).name + path.extname(side));
        try { if (!fs.existsSync(to)) fs.copyFileSync(side, to); walls = true; } catch {}
      }
    }
    out.push({ path: dest.path, rel: toRef(dest.path).rel, copied: !dest.same, walls });
  }
  return out;
}

// ---------- UI audit VJ3: rename, move and take away a file of the library ----------
// (Only a file of the GM's own library: not what comes with the app, not the campaigns' folders, not the cache.)
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
function owns(full) {
  const r = toRef(path.resolve(String(full || '')));
  return !!(r.rel && !BUILTIN.has(r.rel) && !BUILTIN_AT.has(r.path) && !/^(Campaigns|\.cache)(\/|$)/i.test(r.rel) && !r.rel.startsWith('.'));
}
// a map picture's walls file (same name, next to it) goes where the picture goes
const sideOf = (full) => { const k = kindOf(full); return (k === 'image' || k === 'video') && !WallsImport.isVtt(full) ? WallsImport.sidecar(full) : null; };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase(); // (Windows: one file, however its name is cased)
// favourites, recently used and a tile's squares are kept by the file's place in the library
function metaMoved(from, to) {
  const m = readMeta(); let hit = false;
  const swap = (x) => { if (x !== from) return x; hit = true; return to; };
  m.favs = m.favs.map(swap).filter(Boolean); m.recent = m.recent.map(swap).filter(Boolean);
  if (m.tiles[from] != null) { if (to) m.tiles[to] = m.tiles[from]; delete m.tiles[from]; hit = true; }
  if (hit) writeMeta(m);
}
function relocate(full, dest) {
  listMemo = null; thereAt = 0;
  const src = path.resolve(String(full || ''));
  let st = null; try { st = fs.statSync(src); } catch {}
  if (!owns(src) || !st || !st.isFile()) return { ok: false, error: 'That file is not in your library' };
  const to = path.resolve(dest);
  if (!owns(to)) return { ok: false, error: 'That place is not in your library' };
  const from = { path: src, rel: toRef(src).rel };
  if (src === to) return { ok: true, same: true, path: src, rel: from.rel, from };
  if (fs.existsSync(to) && !same(src, to)) return { ok: false, error: `"${path.basename(to)}" is already there` };
  const side = sideOf(src);
  const sideTo = side ? path.join(path.dirname(to), path.parse(to).name + path.extname(side)) : null;
  if (sideTo && fs.existsSync(sideTo) && !same(side, sideTo)) return { ok: false, error: `"${path.basename(sideTo)}" (its walls file) is already there` };
  const thumb0 = thumbFile(src, st);
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(src, to);
  } catch (err) {
    return { ok: false, error: ['EBUSY', 'EPERM', 'EACCES'].includes(err && err.code) ? 'The file is in use or locked: take it off the table first' : String((err && err.message) || err) };
  }
  if (side) { try { fs.renameSync(side, sideTo); } catch {} }
  try { const thumb1 = thumbFile(to); if (thumb0 && thumb1 && fs.existsSync(thumb0) && !fs.existsSync(thumb1)) fs.renameSync(thumb0, thumb1); } catch {} // (its small picture need not be made again)
  const rel = toRef(to).rel;
  metaMoved(from.rel, rel);
  return { ok: true, path: to, rel, from };
}
function renameFile(full, name) {
  const n = String(name || '').trim().replace(/[. ]+$/, '');
  if (!n) return { ok: false, error: 'Give it a name' };
  if (BAD_NAME.test(n) || n.length > 120) return { ok: false, error: 'A file name cannot have < > : " / \\ | ? * in it' };
  const src = path.resolve(String(full || ''));
  return relocate(src, path.join(path.dirname(src), n + path.extname(src)));
}
// folder: a folder of the library, from its root ("Tokens/Goblins"); newFolder: a new one inside it
function moveFile(full, { folder, newFolder } = {}) {
  const src = path.resolve(String(full || ''));
  let rel = String(folder || '');
  if (!rel || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) return { ok: false, error: 'That place is not in your library' };
  if (newFolder != null) {
    const n = String(newFolder).trim().replace(/[. ]+$/, '');
    if (!n) return { ok: false, error: 'Give the folder a name' };
    if (BAD_NAME.test(n) || n.length > 80) return { ok: false, error: 'A folder name cannot have < > : " / \\ | ? * in it' };
    rel = `${rel}/${n}`;
  }
  return relocate(src, path.join(ROOT, ...rel.split(/[\\/]+/).filter(Boolean), path.basename(src)));
}
// a file that left the library (to the Windows bin): its star, its place among the recent ones and its small picture go
function forgetFile(rel) { if (rel) metaMoved(rel, null); }

module.exports = {
  listDirty, listStats, sweepThumbs, there, thereForget, thereStats, resolveKept, vttWalls, vttStats,
  owns, sideOf, renameFile, moveFile, forgetFile,
  FOLDERS, kindOf, categoryOf, resolveLibraryRoot, defaultLibraryRoot, isPortable, ensureLibrary, listLibrary, setFavourite, touchRecent, importFiles, importFilesSoon,
  toRef, resolveRef, hydrate, media, thumbUrl, putThumb, vttImagePath, forgetRecent, treeOf, isBuiltin, tileOf, setTileSquares, lightOf,
  get root() { return ROOT; },
};
