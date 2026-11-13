// Library files a campaign uses that are no longer where they were (moved, renamed, deleted):
// list them with where they are used, suggest files with the same name in the library, and relink
// every use at once.
'use strict';
const fs = require('fs');
const path = require('path');
const library = require('./library');

const ROLE = { token: 'token', asset: 'asset', overlay: 'overlay', audio: 'sound' };

// every media reference in the open campaign, with where it is used
function refs(store) {
  const c = store.cur;
  if (!c) return [];
  const out = [];
  for (const id of store.allMapIds()) {
    const m = c.maps.get(id);
    if (!m) continue;
    if (m.bg && (m.bg.path || m.bg.rel)) out.push({ ref: m.bg, mapId: m.id, where: `${m.name}: background`, hydrate: true });
    for (const l of m.layers) if (l.path || l.rel) out.push({ ref: l, mapId: m.id, where: `${m.name}: ${l.name || ROLE[l.role] || 'file'}${l.role && ROLE[l.role] ? ` (${ROLE[l.role]})` : ''}`, hydrate: true });
    for (const s of m.snaps || []) { // what a snapshot brings back
      const D = s.data || {};
      if (D.bg && (D.bg.path || D.bg.rel)) out.push({ ref: D.bg, mapId: m.id, where: `${m.name}: snapshot ${s.name} (picture)`, hydrate: true });
      for (const l of D.layers || []) if (l.path || l.rel) out.push({ ref: l, mapId: m.id, where: `${m.name}: snapshot ${s.name}`, hydrate: true });
    }
  }
  for (const ch of c.meta.chapters) {
    if (ch.ambience && (ch.ambience.path || ch.ambience.rel)) out.push({ ref: ch.ambience, where: `${ch.name}: ambience`, hydrate: true });
    if (ch.fight && (ch.fight.path || ch.fight.rel)) out.push({ ref: ch.fight, where: `${ch.name}: fight music`, hydrate: true });
    // 4.10.1: on a list only (a Ready list, the Tonight tray): a shortcut, not something a map shows
    for (const k of ['tokens', 'portraits', 'handouts', 'other']) for (const r of (ch.ready && ch.ready[k]) || []) if (r.path || r.rel) out.push({ ref: r, where: `${ch.name}: Ready (${{ tokens: 'Tokens', handouts: 'Handouts', portraits: 'Portraits' }[k] || 'other things'})`, list: true });
  }
  for (const t of c.meta.tray || []) if (t.path || t.rel) out.push({ ref: t, where: 'Tonight tray', list: true });
  return out;
}
const keyOf = (ref) => ref.rel || ref.path;

function list(store) {
  const groups = new Map();
  for (const r of refs(store)) {
    const p = library.resolveRef(r.ref);
    if (p && fs.existsSync(p)) continue;
    const k = keyOf(r.ref);
    if (!groups.has(k)) groups.set(k, { key: k, file: path.basename(p || r.ref.rel || ''), path: p, uses: [], onlyLists: true });
    const g = groups.get(k);
    g.uses.push(r.where);
    if (!r.list) g.onlyLists = false; // (4.10.1: used on a map or as music, not only kept on a list)
  }
  const lib = groups.size ? library.listLibrary() : [];
  for (const g of groups.values()) {
    // the same file name somewhere else in the library (moved), else the same name with another extension
    const base = g.file.toLowerCase(); const stem = path.parse(g.file).name.toLowerCase();
    let hits = lib.filter((x) => path.basename(x.path).toLowerCase() === base);
    if (!hits.length) hits = lib.filter((x) => x.name.toLowerCase() === stem);
    g.suggest = hits.slice(0, 4).map((x) => ({ path: x.path, rel: x.rel }));
  }
  return [...groups.values()];
}

// point every use of a missing file at another file
function relink(store, key, newPath) {
  if (!newPath || !fs.existsSync(newPath)) return { ok: false, error: 'That file does not exist.' };
  const ref = library.toRef(newPath);
  const kind = library.kindOf(newPath);
  let n = 0;
  for (const r of refs(store)) {
    if (keyOf(r.ref) !== key) continue;
    r.ref.path = ref.path;
    if (ref.rel) r.ref.rel = ref.rel; else delete r.ref.rel;
    if (kind && r.ref.kind && r.ref.kind !== kind && (kind === 'image' || kind === 'video')) r.ref.kind = kind;
    if (r.hydrate) library.hydrate(r.ref);
    if (r.mapId) store.touch(r.mapId); else store.touch();
    n++;
  }
  return { ok: n > 0, count: n };
}

// 4.10.1: take missing files off the Ready lists and the Tonight tray (they are only shortcuts there);
// keys: those files, or all that are missing. Files that are still there stay.
function forget(store, keys) {
  const c = store.cur;
  if (!c) return { ok: false, count: 0 };
  const want = keys && keys.length ? new Set(keys) : null;
  const gone = (r) => { const k = keyOf(r); if (want && !want.has(k)) return false; const p = library.resolveRef(r); return !(p && fs.existsSync(p)); };
  let n = 0;
  for (const ch of c.meta.chapters) {
    if (!ch.ready) continue;
    for (const k of ['tokens', 'portraits', 'handouts', 'other']) {
      const L = ch.ready[k] || [];
      const keep = L.filter((r) => !((r.path || r.rel) && gone(r)));
      n += L.length - keep.length;
      ch.ready[k] = keep;
    }
  }
  if (c.meta.tray) { const keep = c.meta.tray.filter((r) => !((r.path || r.rel) && gone(r))); n += c.meta.tray.length - keep.length; c.meta.tray = keep; }
  if (n) store.touch();
  return { ok: true, count: n };
}

module.exports = { list, relink, forget };
