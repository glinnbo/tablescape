// Campaign storage:
//   Library/Campaigns/<Name>/campaign.json   name, chapters, map order
//   Library/Campaigns/<Name>/maps/<id>.json  one file per map
// Only changed maps are rewritten (debounced), always via write-then-rename.
'use strict';

const fs = require('fs');
const path = require('path');
const library = require('./library');
const { emptyMap, normalize, newId, History } = require('./mapstate');

const backups = require('./backups');
const BAD = Symbol('unreadable'); // readJson's answer for a file that is there but can't be read
const RUNTIME_KEYS = new Set(['url', 'missing', 'broken']); // 'broken' (Beta 1): a map file that could not be read, never written over

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, (k, v) => (RUNTIME_KEYS.has(k) ? undefined : v), 1));
  fs.renameSync(tmp, file);
}
function safeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Campaign';
}
const clampName = (s, fallback) => String(s || '').trim().slice(0, 120) || fallback;

class CampaignStore {
  constructor() {
    this.cur = null;
    this.saveTimer = null;
    this.onSaved = null;
  }

  get dir() { return path.join(library.root, 'Campaigns'); }

  // ---------- listing ----------
  scan() {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(this.dir, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(this.dir, e.name);
      const file = path.join(dir, 'campaign.json');
      const meta = readJson(file);
      if (meta && meta.id) out.push({ dir, meta });
      else if (fs.existsSync(file)) out.push({ dir, broken: true }); // Beta 1: damaged, shown so its backups can be reached
    }
    return out;
  }
  // a damaged campaign is known by its folder: "broken:<folder name>"
  static brokenId(dir) { return `broken:${path.basename(dir)}`; }
  list() {
    return this.scan()
      .map(({ dir, meta, broken }) => {
        if (broken) {
          let backupsN = 0;
          try { backupsN = backups.list(dir).length; } catch {}
          return { id: CampaignStore.brokenId(dir), name: path.basename(dir), broken: true, backups: backupsN, updated: 0, chapters: 0, maps: 0, players: 0, folder: dir };
        }
        const chapters = meta.chapters || [];
        const coverPath = meta.cover ? library.resolveRef(meta.cover) : null;
        return {
          id: meta.id,
          name: meta.name,
          updated: meta.updated || 0,
          chapters: chapters.length,
          maps: chapters.reduce((n, c) => n + (c.maps || []).length, 0),
          lastMapName: meta.lastMapName || null,
          lastChapterName: meta.lastChapterName || null,
          lastSession: meta.lastSession || 0,
          players: (meta.party || []).length,
          coverPath: coverPath && fs.existsSync(coverPath) ? coverPath : null,
          coverThumb: coverPath ? library.thumbUrl(coverPath) : null,
          coverKind: coverPath ? library.kindOf(coverPath) : null,
          folder: dir,
        };
      })
      .sort((a, b) => b.updated - a.updated);
  }
  findDir(id) {
    if (typeof id === 'string' && id.startsWith('broken:')) {
      const hit = this.scan().find((c) => c.broken && CampaignStore.brokenId(c.dir) === id);
      return hit ? hit.dir : null;
    }
    const hit = this.scan().find((c) => c.meta && c.meta.id === id);
    return hit ? hit.dir : null;
  }

  // ---------- create / open / close ----------
  create(name, { chapterName = 'Chapter 1' } = {}) {
    name = clampName(name, 'New campaign');
    let folder = safeName(name);
    let dir = path.join(this.dir, folder);
    for (let i = 2; fs.existsSync(dir); i++) dir = path.join(this.dir, `${folder} (${i})`);
    const meta = {
      app: 'tablescape', version: 2, id: newId('c'), name,
      created: Date.now(), updated: Date.now(),
      chapters: [{ id: newId('ch'), name: chapterName, ambience: null, fight: null, maps: [] }],
      lastMapId: null,
    };
    writeJson(path.join(dir, 'campaign.json'), meta);
    fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
    return meta.id;
  }

  open(id) {
    this.close();
    const dir = this.findDir(id);
    if (!dir) return null;
    const meta = readJson(path.join(dir, 'campaign.json'));
    if (!meta || !meta.id) return null;
    // (2.2: everything else a chapter has stays too: its Spotify fight mood, its Ready lists)
    meta.chapters = (meta.chapters || []).map((c) => ({ ...c, id: c.id || newId('ch'), name: c.name || 'Chapter', ambience: c.ambience || null, fight: c.fight || null, maps: c.maps || [] }));
    if (!meta.chapters.length) meta.chapters.push({ id: newId('ch'), name: 'Chapter 1', ambience: null, fight: null, maps: [] });
    const maps = new Map();
    const referenced = new Set(meta.chapters.flatMap((c) => c.maps));
    const mapDir = path.join(dir, 'maps');
    fs.mkdirSync(mapDir, { recursive: true });
    for (const f of fs.readdirSync(mapDir)) {
      if (!f.endsWith('.json')) continue;
      const mapId = f.slice(0, -5);
      if (!referenced.has(mapId)) { try { fs.unlinkSync(path.join(mapDir, f)); } catch {} continue; } // purge deleted maps
      const raw = readJson(path.join(mapDir, f), BAD);
      const m = normalize(raw === BAD ? null : raw);
      if (raw === BAD) m.broken = true; // Beta 1: unreadable; shown as such, and never written over (flush)
      m.id = mapId;
      hydrateMap(m);
      maps.set(mapId, m);
    }
    for (const c of meta.chapters) {
      c.maps = c.maps.filter((mid) => maps.has(mid));
      if (c.ambience) library.hydrate(c.ambience);
      if (c.fight) library.hydrate(c.fight);
    }
    this.cur = { dir, meta, maps, dirty: new Set(), metaDirty: false, history: new Map(), deletedMaps: new Map(), deletedChapters: new Map() };
    return this.cur;
  }

  close() {
    if (!this.cur) return;
    this.flush();
    this.cur = null;
  }

  // ---------- saving ----------
  touch(mapId) {
    if (!this.cur) return;
    if (mapId) this.cur.dirty.add(mapId);
    this.cur.metaDirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 700);
  }
  flush() {
    clearTimeout(this.saveTimer);
    const c = this.cur;
    if (!c) return;
    try {
      for (const id of c.dirty) {
        const m = c.maps.get(id);
        if (m && !m.broken && !c.deletedMaps.has(id)) writeJson(path.join(c.dir, 'maps', `${id}.json`), m);
      }
      c.dirty.clear();
      if (c.metaDirty) {
        c.meta.updated = Date.now();
        const firstWithBg = this.allMapIds().map((id) => c.maps.get(id)).find((m) => m && m.bg);
        c.meta.cover = firstWithBg ? { path: firstWithBg.bg.path, rel: firstWithBg.bg.rel } : null;
        const last = c.maps.get(c.meta.lastMapId);
        c.meta.lastMapName = last ? last.name : null;
        const lastCh = last ? this.chapterOf(last.id) : null;
        c.meta.lastChapterName = lastCh ? lastCh.name : null;
        writeJson(path.join(c.dir, 'campaign.json'), c.meta);
        c.metaDirty = false;
      }
      if (this.onSaved) this.onSaved();
    } catch (err) {
      console.error('save failed', err);
      if (this.onSaveError) { try { this.onSaveError(err); } catch {} }
    }
  }
  // Beta 1: a damaged map is given up and starts over as an empty map (its file is written again)
  resetMap(id) {
    const m = this.map(id);
    if (!m || !m.broken) return false;
    delete m.broken;
    this.touch(id);
    return true;
  }

  // ---------- helpers ----------
  allMapIds() { return this.cur ? this.cur.meta.chapters.flatMap((ch) => ch.maps) : []; }
  chapterOf(mapId) { return this.cur ? this.cur.meta.chapters.find((ch) => ch.maps.includes(mapId)) || null : null; }
  map(id) { return this.cur ? this.cur.maps.get(id) || null : null; }
  history(id) {
    if (!this.cur) return new History();
    if (!this.cur.history.has(id)) this.cur.history.set(id, new History());
    return this.cur.history.get(id);
  }

  // ---------- campaign-level ops (work without opening) ----------
  rename(id, name) {
    const dir = this.findDir(id);
    if (!dir) return false;
    if (this.cur && this.cur.meta.id === id) { this.cur.meta.name = clampName(name, this.cur.meta.name); this.touch(); this.flush(); return true; }
    const meta = readJson(path.join(dir, 'campaign.json'));
    meta.name = clampName(name, meta.name);
    writeJson(path.join(dir, 'campaign.json'), meta);
    return true;
  }
  remove(id) {
    if (this.cur && this.cur.meta.id === id) this.close();
    const dir = this.findDir(id);
    if (!dir) return null;
    const trash = path.join(library.root, '.cache', 'trash', `${path.basename(dir)}-${Date.now()}`);
    fs.renameSync(dir, trash);
    return { trash, dir };
  }
  restore(token) {
    if (!token || !fs.existsSync(token.trash) || fs.existsSync(token.dir)) return false;
    fs.renameSync(token.trash, token.dir);
    return true;
  }

  // ---------- recently deleted (2.4): a deleted campaign waits in the library's .cache/trash until it is emptied ----------
  get trashDir() { return path.join(library.root, '.cache', 'trash'); }
  trashKey(key) { const k = String(key || ''); return /^[^\\/]+-\d{13}$/.test(k) && !k.includes('..') ? k : null; }
  deleted() {
    let names = [];
    try { names = fs.readdirSync(this.trashDir); } catch { return []; }
    const out = [];
    for (const key of names) {
      if (!this.trashKey(key)) continue;
      const f = path.join(this.trashDir, key, 'campaign.json');
      if (!fs.existsSync(f)) continue;
      let meta;
      try { meta = readJson(f); } catch { continue; }
      const chapters = meta.chapters || [];
      out.push({
        key, id: meta.id, name: meta.name || key.replace(/-\d{13}$/, ''), deleted: Number(key.slice(-13)),
        chapters: chapters.length, maps: chapters.reduce((n, c) => n + (c.maps || []).length, 0), lastSession: meta.lastSession || 0,
      });
    }
    return out.sort((a, b) => b.deleted - a.deleted);
  }
  // back into Campaigns (under a free folder name; a new id if the same campaign is there again)
  undelete(key) {
    const k = this.trashKey(key);
    const from = k && path.join(this.trashDir, k);
    if (!from || !fs.existsSync(path.join(from, 'campaign.json'))) return null;
    const meta = readJson(path.join(from, 'campaign.json'));
    if (!meta.id || this.findDir(meta.id)) { meta.id = newId('c'); writeJson(path.join(from, 'campaign.json'), meta); }
    const base = k.replace(/-\d{13}$/, '');
    let dest = path.join(this.dir, base);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(this.dir, `${base} (${i})`);
    fs.renameSync(from, dest);
    return meta.id;
  }
  purge(key) {
    const k = this.trashKey(key);
    if (!k) return false;
    try { fs.rmSync(path.join(this.trashDir, k), { recursive: true, force: true }); return true; } catch { return false; }
  }

  // ---------- structure ops on the open campaign ----------
  structure(type, p = {}) {
    const c = this.cur;
    if (!c) return { ok: false };
    const chapters = c.meta.chapters;
    const ch = (id) => chapters.find((x) => x.id === id);
    switch (type) {
      case 'chapter.add': {
        const nc = { id: newId('ch'), name: clampName(p.name, `Chapter ${chapters.length + 1}`), ambience: null, fight: null, maps: [] };
        const after = chapters.findIndex((x) => x.id === p.after);
        chapters.splice(after >= 0 ? after + 1 : chapters.length, 0, nc);
        this.touch();
        return { ok: true, id: nc.id };
      }
      case 'chapter.rename': {
        const x = ch(p.id); if (!x) return { ok: false };
        x.name = clampName(p.name, x.name); this.touch();
        return { ok: true };
      }
      case 'chapter.remove': {
        const i = chapters.findIndex((x) => x.id === p.id);
        if (i < 0 || chapters.length <= 1) return { ok: false, error: 'A campaign needs at least one chapter.' };
        const [x] = chapters.splice(i, 1);
        c.deletedChapters.set(x.id, { chapter: x, index: i });
        this.touch();
        return { ok: true, label: `${x.name} deleted`, undo: { type: 'chapter.restore', payload: { id: x.id } } };
      }
      case 'chapter.restore': {
        const d = c.deletedChapters.get(p.id); if (!d) return { ok: false };
        chapters.splice(Math.min(d.index, chapters.length), 0, d.chapter);
        c.deletedChapters.delete(p.id); this.touch();
        return { ok: true, label: `${d.chapter.name} restored` };
      }
      case 'chapter.move': {
        const i = chapters.findIndex((x) => x.id === p.id);
        const j = i + (p.dir > 0 ? 1 : -1);
        if (i < 0 || j < 0 || j >= chapters.length) return { ok: false };
        [chapters[i], chapters[j]] = [chapters[j], chapters[i]];
        this.touch();
        return { ok: true };
      }
      case 'chapter.ambience': {
        const x = ch(p.id); if (!x) return { ok: false };
        if (p.path === null) x.ambience = null;
        else if (p.path) x.ambience = { ...library.media(p.path), volume: x.ambience ? x.ambience.volume : 0.5 };
        if (x.ambience && 'volume' in p) x.ambience.volume = Math.max(0, Math.min(1, Number(p.volume)));
        this.touch();
        return { ok: true, label: p.path ? 'Chapter ambience set' : undefined };
      }
      case 'chapter.fight': { // fight music: fades in over the ambience while a fight runs
        const x = ch(p.id); if (!x) return { ok: false };
        if (p.path === null) x.fight = null;
        else if (p.path) x.fight = { ...library.media(p.path), volume: x.fight ? x.fight.volume : 0.6 };
        if (x.fight && 'volume' in p) x.fight.volume = Math.max(0, Math.min(1, Number(p.volume)));
        if ('mood' in p) x.fightMood = p.mood ? String(p.mood).slice(0, 40) : null; // a Spotify mood instead of a file
        this.touch();
        return { ok: true, label: p.path ? 'Fight music set' : 'mood' in p && p.mood ? 'Fight music: Spotify' : undefined };
      }
      case 'map.add': {
        const x = ch(p.chapterId) || chapters[0];
        const m = emptyMap(clampName(p.name, p.path ? path.parse(p.path).name : `Map ${x.maps.length + 1}`));
        if (p.path) {
          const kind = library.kindOf(p.path);
          if (kind === 'image' || kind === 'video') m.bg = { ...library.media(p.path), kind, x: 0, y: 0, scale: null, volume: 0, rate: 1 };
        }
        c.maps.set(m.id, m);
        const idx = Number.isInteger(p.index) ? p.index : x.maps.length;
        x.maps.splice(Math.max(0, Math.min(idx, x.maps.length)), 0, m.id);
        this.touch(m.id);
        return { ok: true, id: m.id, label: `${m.name} added` };
      }
      case 'map.rename': {
        const m = c.maps.get(p.id); if (!m) return { ok: false };
        m.name = clampName(p.name, m.name); this.touch(m.id);
        return { ok: true };
      }
      case 'map.duplicate': {
        const m = c.maps.get(p.id); const x = this.chapterOf(p.id);
        if (!m || !x) return { ok: false };
        const copy = { ...structuredClone(m), id: newId('m'), name: `${m.name} copy` };
        // its snapshots are its own (new ids, their pictures copied)
        copy.snaps = (copy.snaps || []).map((s) => {
          const id = newId('q');
          try { const dir = path.join(c.dir, 'snaps'); if (fs.existsSync(path.join(dir, `${s.id}.jpg`))) fs.copyFileSync(path.join(dir, `${s.id}.jpg`), path.join(dir, `${id}.jpg`)); } catch {}
          return { ...s, id };
        });
        copy.snapAt = null;
        c.maps.set(copy.id, copy);
        x.maps.splice(x.maps.indexOf(m.id) + 1, 0, copy.id);
        this.touch(copy.id);
        return { ok: true, id: copy.id, label: 'Map duplicated' };
      }
      case 'map.remove': {
        const x = this.chapterOf(p.id); const m = c.maps.get(p.id);
        if (!x || !m) return { ok: false };
        const index = x.maps.indexOf(p.id);
        x.maps.splice(index, 1);
        c.deletedMaps.set(p.id, { chapterId: x.id, index });
        this.touch();
        return { ok: true, label: `${m.name} deleted`, undo: { type: 'map.restore', payload: { id: p.id } } };
      }
      case 'map.restore': {
        const d = c.deletedMaps.get(p.id); const x = d && ch(d.chapterId);
        if (!d || !x) return { ok: false };
        x.maps.splice(Math.min(d.index, x.maps.length), 0, p.id);
        c.deletedMaps.delete(p.id); this.touch(p.id);
        return { ok: true, label: 'Map restored' };
      }
      case 'map.move': {
        const from = this.chapterOf(p.id); const to = ch(p.chapterId) || from;
        if (!from || !to) return { ok: false };
        const oldIndex = from.maps.indexOf(p.id);
        from.maps.splice(oldIndex, 1);
        let idx = Number.isInteger(p.index) ? p.index : to.maps.length;
        if (from === to && idx > oldIndex) idx -= 1;
        to.maps.splice(Math.max(0, Math.min(idx, to.maps.length)), 0, p.id);
        this.touch();
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  }
}

function hydrateMap(m) {
  if (m.bg) library.hydrate(m.bg);
  for (const l of m.layers) library.hydrate(l);
  for (const s of m.snaps || []) { // the files a snapshot brings back (a picture, assets, films, map sounds)
    if (s.data.bg) library.hydrate(s.data.bg);
    for (const l of s.data.layers || []) library.hydrate(l);
  }
  return m;
}

module.exports = { CampaignStore, readJson, writeJson, hydrateMap };
