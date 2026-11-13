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
  'Tables',
  'Packs',
  'Campaigns',
  '.cache/thumbs',
  '.cache/trash',
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
  'sfx-thunder.ogg': 'Audio/SFX/Thunder.ogg',
  'sfx-door.ogg': 'Audio/SFX/Door creak.ogg',
  'sfx-roar.ogg': 'Audio/SFX/Monster roar.ogg',
  'sfx-bell.ogg': 'Audio/SFX/Bell.ogg',
  'demo-crypt.dd2vtt': 'Maps/Static/Demo crypt.dd2vtt',
};

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
  ROOT = root;
  for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
  const readme = path.join(root, 'README.txt');
  if (!fs.existsSync(readme) || !fs.readFileSync(readme, 'utf8').includes('Party  ')) {
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
      '  Tables            tables for the wheel of luck (.txt, .csv, .md), for every campaign',
      '  Packs             creator downloads, kept as they come',
      '  Campaigns         your campaigns (made by the app)',
      '  .cache            thumbnails, baked animations and deleted items, safe to delete',
      '',
    ].join('\r\n'));
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
  const words = rel.replace(/[_\-./()]+/g, ' ');
  for (const [cat, re] of PACK_HINTS) if (re.test(words)) return cat;
  if (kind === 'video' && WEATHER_WORDS.test(words)) return 'overlays';
  return 'maps';
}

function listLibrary(root = ROOT) {
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
      });
    }
  };
  walk(root, 0);
  return items;
}

// ---------- favourites and recently used (kept with the library) ----------
const metaFile = () => path.join(ROOT, '.cache', 'library.json');
function readMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
    return { favs: Array.isArray(m.favs) ? m.favs : [], recent: Array.isArray(m.recent) ? m.recent : [] };
  } catch { return { favs: [], recent: [] }; }
}
function writeMeta(m) {
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
  const p = path.resolve(absPath);
  const ref = { path: p, name: path.parse(p).name };
  if (ROOT) {
    const rel = path.relative(ROOT, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ref.rel = rel.split(path.sep).join('/');
  }
  return ref;
}
function resolveRef(ref) {
  if (!ref) return null;
  if (ref.rel && ROOT) {
    const p = path.join(ROOT, ...ref.rel.split('/'));
    if (fs.existsSync(p)) return p;
  }
  return ref.path;
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
function vttImagePath(full, stat) {
  try { stat = stat || fs.statSync(full); } catch { return null; }
  const key = crypto.createHash('sha1').update(`${full}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20);
  const dir = path.join(ROOT || path.dirname(full), '.cache', 'vtt');
  for (const ext of ['png', 'jpg', 'webp']) { const f = path.join(dir, `${key}.${ext}`); if (fs.existsSync(f)) return f; }
  try {
    const img = WallsImport.vttImage(full);
    if (!img) return null;
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${key}.${img.ext}`);
    fs.writeFileSync(f, img.buf);
    return f;
  } catch { return null; }
}

// ---------- thumbnails ----------
function thumbFile(full, stat) {
  if (!ROOT) return null;
  try { stat = stat || fs.statSync(full); } catch { return null; }
  const key = crypto.createHash('sha1').update(`${full}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20);
  return path.join(ROOT, '.cache', 'thumbs', `${key}.webp`);
}
function thumbUrl(full) {
  const f = thumbFile(full);
  return f && fs.existsSync(f) ? pathToFileURL(f).href : null;
}
function putThumb(full, dataUrl) {
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
    case 'sounds': return 'Audio/SFX';
    default: return kind === 'video' ? 'Maps/Animated' : 'Maps/Static';
  }
}
const sameFile = (a, b) => { try { const x = fs.statSync(a); const y = fs.statSync(b); return x.size === y.size; } catch { return false; } };
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
function importFiles(files, { cat, folder } = {}) {
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

module.exports = {
  FOLDERS, kindOf, categoryOf, resolveLibraryRoot, defaultLibraryRoot, isPortable, ensureLibrary, listLibrary, setFavourite, touchRecent, importFiles,
  toRef, resolveRef, hydrate, media, thumbUrl, putThumb, vttImagePath, forgetRecent,
  get root() { return ROOT; },
};
