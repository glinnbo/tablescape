// Beta 4.6: a campaign (or one chapter of it) as one file to hand on: "Goblin caves.tablescape".
//   Share as an adventure  the campaign as prepared: the fog covered again, no spell areas, drawings or round
//                          counter left from a session; no players, characters, session log or "who is away"
//   Full copy              everything as it is (another PC, a backup)
// The file is a zip: tablescape.json (what it is), campaign/ (campaign.json, maps/<id>.json, its other files such as
// the snapshot pictures; never its backups) and library/<path in the library> for every file the campaign uses
// (maps, tokens, sounds, portraits …), each only once. A file from elsewhere on the PC goes to "From this PC/".
// Pictures and videos are stored as they are (they are compressed already), the JSON deflated. Written and read in
// pieces, so a campaign of several GB needs no more memory than a small one (ZIP64 when it is that big).
// Importing puts the files into the library at the same places; a file that is already there unchanged is used as
// it is, a different file with the same name gets a new name ("Goblin (2).png") and the campaign points at that.
// The campaign gets new ids (its maps too), so it can sit next to the one it was exported from.
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const library = require('./library');
const { newId } = require('./mapstate');

const FORMAT = 1;
const EXT = 'tablescape';
const CHUNK = 4 * 1024 * 1024;
const MAX32 = 0xffffffff;

// ---------- CRC-32 (zlib's own when there, else a table) ----------
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(buf, prev = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev) >>> 0;
  let c = (prev ^ -1) | 0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
async function writeAt(fh, buf, pos) {
  let off = 0;
  while (off < buf.length) { const { bytesWritten } = await fh.write(buf, off, buf.length - off, pos + off); off += bytesWritten; }
}
const u64 = (b, v, at) => b.writeBigUInt64LE(BigInt(v), at);

class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }

// ---------- writing ----------
class ZipOut {
  constructor(fh) { this.fh = fh; this.pos = 0; this.cd = []; }
  async put(buf) { await writeAt(this.fh, buf, this.pos); this.pos += buf.length; }
  header(name, method, crc, comp, size) {
    const nm = Buffer.from(name, 'utf8');
    const big = size >= MAX32 || comp >= MAX32;
    const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
    if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); u64(extra, size, 4); u64(extra, comp, 12); }
    const h = Buffer.alloc(30);
    const { time, date } = dosTime();
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(big ? 45 : 20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(big ? MAX32 : comp, 18); h.writeUInt32LE(big ? MAX32 : size, 22);
    h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(extra.length, 28);
    return { buf: Buffer.concat([h, nm, extra]), nm, time, date };
  }
  async addBuffer(name, data) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(raw);
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const at = this.pos;
    const H = this.header(name, 8, crc, comp.length, raw.length);
    await this.put(H.buf); await this.put(comp);
    this.cd.push({ nm: H.nm, method: 8, crc, comp: comp.length, size: raw.length, at, time: H.time, date: H.date });
  }
  // a file, stored as it is; its CRC is found while it is copied and written into its header afterwards
  async addFile(name, abs, size, onBytes, cancelled) {
    const at = this.pos;
    const H = this.header(name, 0, 0, size, size);
    await this.put(H.buf);
    const src = await fsp.open(abs, 'r');
    let crc = 0; let done = 0;
    try {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, size)));
      while (done < size) {
        if (cancelled()) throw new Cancelled();
        const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, size - done), done);
        if (!bytesRead) throw new Error(`${path.basename(abs)} got shorter while it was packed`);
        const part = buf.subarray(0, bytesRead);
        crc = crc32(part, crc);
        await this.put(part);
        done += bytesRead;
        onBytes(bytesRead);
      }
    } finally { await src.close(); }
    const c = Buffer.alloc(4); c.writeUInt32LE(crc >>> 0, 0);
    await writeAt(this.fh, c, at + 14);
    this.cd.push({ nm: H.nm, method: 0, crc, comp: size, size, at, time: H.time, date: H.date });
  }
  async finish() {
    const cdAt = this.pos;
    for (const e of this.cd) {
      const z = [];
      if (e.size >= MAX32) z.push(e.size);
      if (e.comp >= MAX32) z.push(e.comp);
      if (e.at >= MAX32) z.push(e.at);
      const extra = Buffer.alloc(z.length ? 4 + 8 * z.length : 0);
      if (z.length) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8 * z.length, 2); z.forEach((v, i) => u64(extra, v, 4 + 8 * i)); }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(z.length ? 45 : 20, 4); h.writeUInt16LE(z.length ? 45 : 20, 6); h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10); h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc >>> 0, 16);
      h.writeUInt32LE(e.comp >= MAX32 ? MAX32 : e.comp, 20); h.writeUInt32LE(e.size >= MAX32 ? MAX32 : e.size, 24);
      h.writeUInt16LE(e.nm.length, 28); h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(e.at >= MAX32 ? MAX32 : e.at, 42);
      await this.put(Buffer.concat([h, e.nm, extra]));
    }
    const cdSize = this.pos - cdAt;
    const n = this.cd.length;
    if (n >= 0xffff || cdAt >= MAX32 || cdSize >= MAX32) {
      const z = Buffer.alloc(56); const zAt = this.pos;
      z.writeUInt32LE(0x06064b50, 0); u64(z, 44, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      u64(z, n, 24); u64(z, n, 32); u64(z, cdSize, 40); u64(z, cdAt, 48);
      const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); u64(loc, zAt, 8); loc.writeUInt32LE(1, 16);
      await this.put(Buffer.concat([z, loc]));
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Math.min(n, 0xffff), 8); e.writeUInt16LE(Math.min(n, 0xffff), 10);
    e.writeUInt32LE(Math.min(cdSize, MAX32), 12); e.writeUInt32LE(Math.min(cdAt, MAX32), 16);
    await this.put(e);
  }
}

// ---------- reading ----------
async function openZip(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailN = Math.min(size, 65557 + 76);
    const tail = Buffer.alloc(tailN);
    await fh.read(tail, 0, tailN, size - tailN);
    let p = -1;
    for (let i = tailN - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { p = i; break; }
    if (p < 0) throw new Error('This is not a Tablescape campaign file (or it is damaged).');
    let n = tail.readUInt16LE(p + 10); let cdSize = tail.readUInt32LE(p + 12); let cdAt = tail.readUInt32LE(p + 16);
    if (p >= 20 && tail.readUInt32LE(p - 20) === 0x07064b50) {
      const zAt = Number(tail.readBigUInt64LE(p - 20 + 8));
      const z = Buffer.alloc(56); await fh.read(z, 0, 56, zAt);
      if (z.readUInt32LE(0) === 0x06064b50) { n = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdAt = Number(z.readBigUInt64LE(48)); }
    }
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdAt);
    const entries = [];
    let q = 0;
    for (let i = 0; i < n; i++) {
      if (cd.readUInt32LE(q) !== 0x02014b50) throw new Error('The campaign file is damaged (its table of contents).');
      const method = cd.readUInt16LE(q + 10); const crc = cd.readUInt32LE(q + 16);
      let comp = cd.readUInt32LE(q + 20); let usize = cd.readUInt32LE(q + 24);
      const nl = cd.readUInt16LE(q + 28); const xl = cd.readUInt16LE(q + 30); const cl = cd.readUInt16LE(q + 32);
      let at = cd.readUInt32LE(q + 42);
      const name = cd.toString('utf8', q + 46, q + 46 + nl);
      let x = q + 46 + nl; const xEnd = x + xl;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x); const len = cd.readUInt16LE(x + 2); let r = x + 4;
        if (id === 1) {
          if (usize === MAX32) { usize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (comp === MAX32) { comp = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (at === MAX32) { at = Number(cd.readBigUInt64LE(r)); r += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, crc, comp, size: usize, at });
      q = xEnd + cl;
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    return { fh, size, entries, byName, close: () => fh.close() };
  } catch (err) { await fh.close(); throw err; }
}
async function dataStart(Z, e) {
  const h = Buffer.alloc(30); await Z.fh.read(h, 0, 30, e.at);
  if (h.readUInt32LE(0) !== 0x04034b50) throw new Error(`The campaign file is damaged (${e.name}).`);
  return e.at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}
async function readEntry(Z, e) {
  const at = await dataStart(Z, e);
  const buf = Buffer.alloc(e.comp); await Z.fh.read(buf, 0, e.comp, at);
  const out = e.method === 8 ? zlib.inflateRawSync(buf) : e.method === 0 ? buf : null;
  if (!out) throw new Error(`Packed in a way Tablescape can't read: ${e.name}`);
  if (crc32(out) !== e.crc >>> 0) throw new Error(`The campaign file is damaged: ${e.name}`);
  return out;
}
// the CRC of a file already on the disk (is it the same as the one in the zip?)
async function fileCrc(abs, cancelled) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK); let crc = 0; let pos = 0;
    for (;;) { if (cancelled()) throw new Cancelled(); const { bytesRead } = await fh.read(buf, 0, buf.length, pos); if (!bytesRead) break; crc = crc32(buf.subarray(0, bytesRead), crc); pos += bytesRead; }
    return crc >>> 0;
  } finally { await fh.close(); }
}
async function extract(Z, e, target, onBytes, cancelled) {
  const at = await dataStart(Z, e);
  const tmp = `${target}.part`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const out = await fsp.open(tmp, 'w');
  let crc = 0;
  try {
    if (e.method === 0) {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, e.size))); let done = 0;
      while (done < e.size) {
        if (cancelled()) throw new Cancelled();
        const { bytesRead } = await Z.fh.read(buf, 0, Math.min(buf.length, e.size - done), at + done);
        if (!bytesRead) throw new Error(`The campaign file is cut short (${e.name}).`);
        const part = buf.subarray(0, bytesRead);
        crc = crc32(part, crc);
        await writeAt(out, part, done);
        done += bytesRead; onBytes(bytesRead);
      }
    } else if (e.method === 8) {
      const data = await readEntry(Z, e); // (only small files are deflated)
      crc = e.crc; await writeAt(out, data, 0); onBytes(e.size);
    } else throw new Error(`Packed in a way Tablescape can't read: ${e.name}`);
  } catch (err) { await out.close(); await fsp.rm(tmp, { force: true }); throw err; }
  await out.close();
  if ((crc >>> 0) !== (e.crc >>> 0)) { await fsp.rm(tmp, { force: true }); throw new Error(`The campaign file is damaged: ${e.name}`); }
  await fsp.rename(tmp, target);
}

// ---------- what a campaign uses ----------
// every stored file reference in a campaign's JSON: an object with a library path (rel) or an absolute path
function eachRef(o, fn) {
  if (Array.isArray(o)) { for (const x of o) eachRef(x, fn); return; }
  if (!o || typeof o !== 'object') return;
  if (typeof o.rel === 'string' || (typeof o.path === 'string' && path.isAbsolute(o.path))) fn(o);
  for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') eachRef(v, fn); }
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const insideLib = (abs) => { const r = path.relative(library.root, abs); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : null; };

// meta keys that belong to one table's sessions, not to the adventure
const PERSONAL = ['party', 'pcStats', 'faces', 'away', 'characters', 'notes', 'lastSession', 'session', 'foes'];

// What would go into the file: { name, kind, chapter, maps, files, bytes, missing, json, extra, lib }
function plan(dir, { kind = 'adventure', chapterId = null } = {}) {
  const meta = readJson(path.join(dir, 'campaign.json'));
  if (!meta || !meta.id) throw new Error('This campaign can\'t be read.');
  const chapters = (meta.chapters || []).filter((c) => !chapterId || c.id === chapterId);
  if (!chapters.length) throw new Error('That chapter is gone.');
  const out = { ...meta, chapters: structuredClone(chapters) };
  const chapter = chapterId ? chapters[0] : null;
  if (chapter) { out.name = `${meta.name}: ${chapter.name}`; if (!chapter.maps.includes(out.lastMapId)) out.lastMapId = chapter.maps[0] || null; }
  if (kind === 'adventure') for (const k of PERSONAL) delete out[k];
  const maps = [];
  for (const id of chapters.flatMap((c) => c.maps || [])) {
    const m = readJson(path.join(dir, 'maps', `${id}.json`));
    if (!m) continue;
    if (kind === 'adventure') { // as prepared: the fog covered again, nothing left over from a session
      if (m.fog) m.fog.ops = [];
      if (m.light) m.light.seen = [];
      m.spells = []; m.draw = [];
      if (m.round) m.round = { ...m.round, n: null };
    }
    maps.push({ id, m });
  }
  // the files they use, each once; their references point into the library
  const lib = new Map(); // rel -> abs
  const fromPc = new Map(); // abs -> rel
  const missing = new Set();
  const fix = (ref) => {
    const abs = library.resolveRef(ref);
    if (!abs || !isFile(abs)) { missing.add(ref.rel || ref.path); return; }
    let rel = insideLib(abs);
    if (!rel) {
      rel = fromPc.get(abs);
      if (!rel) {
        const p = path.parse(abs); rel = `From this PC/${p.base}`;
        for (let i = 2; lib.has(rel) && lib.get(rel) !== abs; i++) rel = `From this PC/${p.name} (${i})${p.ext}`;
        fromPc.set(abs, rel);
      }
    }
    lib.set(rel, abs);
    ref.rel = rel; delete ref.path; delete ref.url; delete ref.missing;
  };
  eachRef(out, fix);
  for (const { m } of maps) eachRef(m, fix);
  // the campaign's other files (snapshot pictures …), never its backups; the adventure leaves the session log out
  const extra = [];
  const walk = (d, rel) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (['.backups', 'maps'].includes(r) || (kind === 'adventure' && r === 'Notes')) continue; walk(path.join(d, e.name), r); } else if (e.isFile() && r !== 'campaign.json' && !e.name.endsWith('.tmp')) extra.push({ rel: r, abs: path.join(d, e.name) });
    }
  };
  walk(dir, '');
  const size = (abs) => { try { return fs.statSync(abs).size; } catch { return 0; } };
  const libList = [...lib].map(([rel, abs]) => ({ rel, abs, size: size(abs) })).sort((a, b) => a.rel.localeCompare(b.rel));
  for (const x of extra) x.size = size(x.abs);
  const json = [{ name: 'campaign/campaign.json', data: JSON.stringify(out, null, 1) }, ...maps.map(({ id, m }) => ({ name: `campaign/maps/${id}.json`, data: JSON.stringify(m, null, 1) }))];
  const bytes = libList.reduce((n, f) => n + f.size, 0) + extra.reduce((n, f) => n + f.size, 0) + json.reduce((n, f) => n + f.data.length, 0);
  return {
    name: out.name, kind, chapter: chapter ? chapter.name : null, maps: maps.length, files: libList.length, bytes,
    missing: [...missing].filter(Boolean).map((x) => String(x).split(/[\\/]/).pop()), json, extra, lib: libList,
    chapters: (meta.chapters || []).map((c) => ({ id: c.id, name: c.name, maps: (c.maps || []).length })),
  };
}

// write the plan into a file; progress({ done, total, bytes, totalBytes, name })
async function exportTo(P, file, { version = '', progress = () => {}, cancelled = () => false } = {}) {
  const tmp = `${file}.part`;
  const fh = await fsp.open(tmp, 'w');
  const total = P.json.length + P.extra.length + P.lib.length + 1;
  let done = 0; let bytes = 0;
  const tick = (name) => progress({ done, total, bytes, totalBytes: P.bytes, name });
  try {
    const Z = new ZipOut(fh);
    await Z.addBuffer('tablescape.json', JSON.stringify({ format: FORMAT, app: 'tablescape', version, kind: P.kind, name: P.name, chapter: P.chapter, maps: P.maps, files: P.files, bytes: P.bytes, created: Date.now() }, null, 1));
    done++;
    for (const j of P.json) { await Z.addBuffer(j.name, j.data); done++; bytes += j.data.length; tick(j.name); if (cancelled()) throw new Cancelled(); }
    for (const f of [...P.extra.map((x) => ({ ...x, name: `campaign/${x.rel}` })), ...P.lib.map((x) => ({ ...x, name: `library/${x.rel}` }))]) {
      tick(f.rel);
      await Z.addFile(f.name, f.abs, f.size, (n) => { bytes += n; tick(f.rel); }, cancelled);
      done++;
    }
    await Z.finish();
    await fh.close();
    await fsp.rm(file, { force: true });
    await fsp.rename(tmp, file);
    tick('');
    return { ok: true, file, bytes: (await fsp.stat(file)).size };
  } catch (err) {
    try { await fh.close(); } catch {}
    await fsp.rm(tmp, { force: true });
    if (err.cancelled) return { ok: false, cancelled: true };
    throw err;
  }
}

// what is in a file (before importing it)
async function inspect(file) {
  const Z = await openZip(file);
  try {
    const m = Z.byName.get('tablescape.json');
    if (!m) throw new Error('This is not a Tablescape campaign file.');
    const info = JSON.parse((await readEntry(Z, m)).toString('utf8'));
    if (info.app !== 'tablescape' || !(info.format >= 1)) throw new Error('This is not a Tablescape campaign file.');
    if (info.format > FORMAT) throw new Error('This campaign comes from a newer Tablescape: update Tablescape first.');
    const libs = Z.entries.filter((e) => e.name.startsWith('library/') && !e.name.endsWith('/'));
    // how much of it is in the library already (the same file at the same place)
    let have = 0;
    for (const e of libs) { const t = target(e.name.slice(8)); if (t) { try { if (fs.statSync(t).size === e.size) have++; } catch {} } }
    return { ok: true, file, name: info.name, kind: info.kind, chapter: info.chapter || null, maps: info.maps, files: libs.length, bytes: Z.size, have, version: info.version };
  } finally { await Z.close(); }
}
// Beta 3.5 (security): a name from a campaign file is only ever a path below the folder it belongs in. A part with a
// backslash, a colon or dots only is refused: on Windows "..\\..\\x" inside one part walked out of the folder (a
// crafted .tablescape could then write a file anywhere, for example into the Startup folder). The result is checked
// once more against the folder itself.
function safeParts(rel) {
  const parts = String(rel).split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => /^\.+$/.test(p) || /[\\<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p))) return null;
  return parts;
}
function below(root, rel) {
  const parts = safeParts(rel);
  if (!parts) return null;
  const to = path.join(root, ...parts);
  const back = path.relative(root, to);
  return back && !back.startsWith('..') && !path.isAbsolute(back) ? to : null;
}
// where a library path from the file goes (null: not a safe path)
const target = (rel) => below(library.root, rel);
function freeRel(rel) {
  const parts = rel.split('/'); const base = parts.pop(); const p = path.parse(base);
  for (let i = 2; ; i++) { const r = [...parts, `${p.name} (${i})${p.ext}`].join('/'); if (!fs.existsSync(target(r))) return r; }
}
const safeName = (name) => String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Campaign';

// import a file into the library and the campaigns: { ok, id, name, files, reused, renamed }
async function importFrom(file, campaignsDir, { progress = () => {}, cancelled = () => false } = {}) {
  const Z = await openZip(file);
  const made = []; // files written into the library (taken out again when cancelled)
  try {
    const info = JSON.parse((await readEntry(Z, Z.byName.get('tablescape.json') || { name: '?' })).toString('utf8'));
    if (info.app !== 'tablescape') throw new Error('This is not a Tablescape campaign file.');
    if (info.format > FORMAT) throw new Error('This campaign comes from a newer Tablescape: update Tablescape first.');
    const metaE = Z.byName.get('campaign/campaign.json');
    if (!metaE) throw new Error('This file has no campaign in it.');
    const libs = Z.entries.filter((e) => e.name.startsWith('library/') && !e.name.endsWith('/'));
    const extras = Z.entries.filter((e) => e.name.startsWith('campaign/') && e.name !== 'campaign/campaign.json' && !/^campaign\/maps\/[^/]+\.json$/.test(e.name) && !e.name.endsWith('/'));
    const total = libs.length + extras.length + 1;
    const totalBytes = libs.reduce((n, e) => n + e.size, 0) + extras.reduce((n, e) => n + e.size, 0);
    let done = 0; let bytes = 0; let reused = 0;
    const tick = (name) => progress({ done, total, bytes, totalBytes, name });
    const renames = new Map();
    for (const e of libs) {
      const rel = e.name.slice(8);
      let t = target(rel);
      if (!t) { done++; continue; }
      tick(rel);
      if (fs.existsSync(t)) {
        let same = false;
        try { same = fs.statSync(t).size === e.size && (await fileCrc(t, cancelled)) === (e.crc >>> 0); } catch {}
        if (same) { reused++; done++; bytes += e.size; tick(rel); continue; }
        const nr = freeRel(rel); renames.set(rel, nr); t = target(nr);
      }
      await extract(Z, e, t, (n) => { bytes += n; tick(rel); }, cancelled);
      made.push(t);
      done++;
    }
    // the campaign: new ids for it and its maps, its references pointing at where the files are now
    let metaText = (await readEntry(Z, metaE)).toString('utf8');
    const mapEs = Z.entries.filter((e) => /^campaign\/maps\/[^/]+\.json$/.test(e.name));
    let mapTexts = await Promise.all(mapEs.map(async (e) => ({ id: e.name.slice(14, -5), text: (await readEntry(Z, e)).toString('utf8') })));
    const ids = new Map(mapTexts.map((x) => [x.id, newId('m')]));
    const swap = (s) => { for (const [a, b] of ids) s = s.split(`"${a}"`).join(`"${b}"`); return s; };
    metaText = swap(metaText);
    mapTexts = mapTexts.map((x) => ({ id: ids.get(x.id), text: swap(x.text) }));
    const point = (o) => eachRef(o, (ref) => { if (typeof ref.rel !== 'string') return; if (renames.has(ref.rel)) ref.rel = renames.get(ref.rel); const t = target(ref.rel); if (t) ref.path = t; else { delete ref.rel; delete ref.path; } }); // (an unsafe name points nowhere)
    const meta = JSON.parse(metaText);
    point(meta);
    meta.id = newId('c');
    meta.updated = Date.now();
    meta.imported = { kind: info.kind || 'full', at: Date.now(), from: info.version || null };
    // a name of its own if there is one like it already
    const names = new Set();
    try { for (const d of fs.readdirSync(campaignsDir)) { const m = readJson(path.join(campaignsDir, d, 'campaign.json')); if (m && m.name) names.add(m.name); } } catch {}
    const base = meta.name || 'Campaign';
    for (let i = 2; names.has(meta.name); i++) meta.name = `${base} (${i})`;
    let dir = path.join(campaignsDir, safeName(meta.name));
    for (let i = 2; fs.existsSync(dir); i++) dir = path.join(campaignsDir, `${safeName(meta.name)} (${i})`);
    if (cancelled()) throw new Cancelled();
    await fsp.mkdir(path.join(dir, 'maps'), { recursive: true });
    made.push(dir);
    for (const e of extras) {
      const to = below(dir, e.name.slice(9));
      if (!to) continue; // (not a safe name: left out)
      await extract(Z, e, to, (n) => { bytes += n; tick(e.name.slice(9)); }, cancelled);
      done++;
    }
    for (const x of mapTexts) { const m = JSON.parse(x.text); point(m); await fsp.writeFile(path.join(dir, 'maps', `${x.id}.json`), JSON.stringify(m, null, 1)); }
    await fsp.writeFile(path.join(dir, 'campaign.json'), JSON.stringify(meta, null, 1));
    done = total; tick('');
    return { ok: true, id: meta.id, name: meta.name, kind: info.kind, files: libs.length, reused, renamed: renames.size, maps: mapTexts.length };
  } catch (err) {
    for (const p of made.reverse()) { try { await fsp.rm(p, { recursive: true, force: true }); } catch {} }
    if (err.cancelled) return { ok: false, cancelled: true };
    throw err;
  } finally { await Z.close(); }
}

module.exports = { plan, exportTo, inspect, importFrom, EXT, openZip, readEntry, below };
