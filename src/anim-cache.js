// Baked animations (2.3): an animated asset (a video) is played once on the GM screen and its frames are kept
// in one picture, a frame sheet. Both screens then draw those frames instead of decoding the video, each of
// them, all the time. Only the files maps really use are baked, one size per file and how big it shows on the TV.
// The sheets live in the library's .cache/anim: <key>-<size>.json (what is in it) with its frames in pieces,
// <key>-<size>-<n>.webp (2.5: a long loop is drawn from a few pieces at a time instead of holding all of it).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const library = require('./library');

const TIERS = [128, 256, 384, 512, 768, 1024]; // the longer side of one frame, in pixels (4.8: 768 and 1024 for assets that are really that big on the TV)
const VERSION = 3; // 2.5: frames in pieces, the file's own speed (older sheets are removed and baked again)
const dir = () => (library.root ? path.join(library.root, '.cache', 'anim') : null);

// the smallest size that is sharp at px pixels on the TV
function tierFor(px) {
  const v = Number(px) || 0;
  return TIERS.find((t) => t >= v * 0.9) || TIERS[TIERS.length - 1];
}

// one key per file and version of it (inside the library by its place there, so a moved library still finds them)
const keys = new Map(); // full path -> { sig, key }
function keyOf(full) {
  let st;
  try { st = fs.statSync(full); } catch { return null; }
  const sig = `${st.size}|${Math.round(st.mtimeMs)}`;
  const k = keys.get(full);
  if (k && k.sig === sig) return k.key;
  const ref = library.toRef(full);
  const key = crypto.createHash('sha1').update(`${ref.rel || full}|${sig}`).digest('hex').slice(0, 20);
  keys.set(full, { sig, key });
  return key;
}

// what is in the cache: key -> Map(tier -> { file, meta, t })
let index = null;
function readIndex() {
  if (index) return index;
  index = new Map();
  const d = dir();
  if (!d) return index;
  let names = [];
  try { names = fs.readdirSync(d); } catch { return index; }
  for (const f of names) {
    const m = /^([0-9a-f]{20})-(\d+)\.json$/.exec(f);
    if (!m) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const files = pieceFiles(d, m[1], m[2], meta);
      if (meta.v !== VERSION) { // made by older rules: gone, baked again
        for (const x of [path.join(d, f), path.join(d, `${m[1]}-${m[2]}.webp`), ...files]) { try { fs.unlinkSync(x); } catch {} }
        continue;
      }
      if (!files.length || !files.every((x) => fs.existsSync(x))) continue;
      add(m[1], Number(m[2]), files, meta);
    } catch {}
  }
  return index;
}
const pieceFiles = (d, key, tier, meta) => Array.from({ length: Math.max(0, Math.min(400, Number(meta && meta.pieces) || 0)) }, (_, i) => path.join(d, `${key}-${tier}-${i}.webp`));
function add(key, tier, files, meta) {
  if (!index.has(key)) index.set(key, new Map());
  let t = 0;
  try { t = Math.round(fs.statSync(files[0]).mtimeMs); } catch {}
  index.get(key).set(tier, { files, meta, t });
}

// the best sheet there is for a file: the smallest one at least this big, else the biggest
function find(full, tier) {
  const key = keyOf(full);
  if (!key) return null;
  const have = readIndex().get(key);
  if (!have || !have.size) return null;
  const list = [...have.entries()].sort((a, b) => a[0] - b[0]);
  const hit = list.find(([t]) => t >= tier) || list[list.length - 1];
  const [t, e] = hit;
  return { tier: t, urls: e.files.map((f) => `${pathToFileURL(f).href}?t=${e.t}`), meta: e.meta };
}
const has = (full, tier) => { const f = find(full, tier); return !!f && f.tier >= tier; };

// pieces: the frames, a few dozen in each picture (2.5)
function put(full, tier, pieces, meta) {
  const d = dir();
  const key = keyOf(full);
  if (!d || !key || !Array.isArray(pieces) || !pieces.length || pieces.some((x) => !x || !x.length)) return null;
  fs.mkdirSync(d, { recursive: true });
  const t = TIERS.includes(Number(tier)) ? Number(tier) : tierFor(tier);
  const m = { v: VERSION, ...pickMeta(meta), pieces: pieces.length, tier: t, name: path.basename(full), at: Date.now() };
  const files = pieceFiles(d, key, t, m);
  files.forEach((f, i) => fs.writeFileSync(f, Buffer.from(pieces[i])));
  fs.writeFileSync(path.join(d, `${key}-${t}.json`), JSON.stringify(m));
  readIndex();
  add(key, t, files, m);
  return find(full, t);
}
function pickMeta(m = {}) {
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  return {
    fw: num(m.fw, 1, 4096), fh: num(m.fh, 1, 4096), cols: num(m.cols, 1, 512), rows: num(m.rows, 1, 512),
    n: num(m.n, 1, 2000), fps: num(m.fps, 1, 60), dur: num(m.dur, 0, 600), sw: num(m.sw, 1, 16384), sh: num(m.sh, 1, 16384),
    src: num(m.src, 0, 120), blend: !!m.blend, per: num(m.per, 1, 2000),
  };
}

function info() {
  const d = dir();
  let files = 0; let bytes = 0;
  const sheets = new Set();
  try {
    for (const f of fs.readdirSync(d)) {
      try { bytes += fs.statSync(path.join(d, f)).size; } catch {}
      files++;
      if (/^[0-9a-f]{20}-\d+\.json$/.test(f)) sheets.add(f);
    }
  } catch {}
  return { sheets: sheets.size, bytes, files };
}

function clear() {
  const d = dir();
  try { for (const f of fs.readdirSync(d)) { try { fs.unlinkSync(path.join(d, f)); } catch {} } } catch {}
  index = new Map();
}

module.exports = { TIERS, tierFor, find, has, put, info, clear, keyOf };
