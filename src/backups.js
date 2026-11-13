// Backups of a campaign: each time a campaign is opened, a copy of its files goes into
// <campaign>/.backups/<date and time>/ (only when something changed since the last one). The last 10 are kept.
// Restoring keeps a copy of the current state first, so a restore can be undone the same way.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP = 10;
const backupsDir = (dir) => path.join(dir, '.backups');

// the files that make up a campaign: campaign.json, maps/*.json, Notes/*
function filesOf(dir) {
  const out = [];
  const add = (rel) => { const f = path.join(dir, rel); if (fs.existsSync(f) && fs.statSync(f).isFile()) out.push(rel); };
  add('campaign.json');
  for (const sub of ['maps', 'Notes']) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch {}
    for (const n of names.sort()) add(path.join(sub, n));
  }
  return out;
}
function hashOf(dir, files) {
  const h = crypto.createHash('sha1');
  for (const rel of files) { h.update(rel); h.update(fs.readFileSync(path.join(dir, rel))); }
  return h.digest('hex');
}
const stampOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

function list(dir) {
  let names = [];
  try { names = fs.readdirSync(backupsDir(dir)); } catch { return []; }
  const out = [];
  for (const id of names) {
    const info = readInfo(dir, id);
    if (info) out.push({ id, ...info });
  }
  return out.sort((a, b) => b.made - a.made);
}
function readInfo(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(backupsDir(dir), id, 'backup.json'), 'utf8')); } catch { return null; }
}

// a copy of the campaign as it is on disk now; null when nothing changed since the newest backup
function snapshot(dir, { force = false, label = null, keep = true } = {}) {
  const files = filesOf(dir);
  if (!files.length) return null;
  const hash = hashOf(dir, files);
  const newest = list(dir)[0];
  if (!force && newest && newest.hash === hash) return null;
  let id = stampOf();
  while (fs.existsSync(path.join(backupsDir(dir), id))) id += '+';
  const to = path.join(backupsDir(dir), id);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(dir, rel), path.join(to, rel));
  }
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'campaign.json'), 'utf8')); } catch {}
  const chapters = meta.chapters || [];
  const info = { made: Date.now(), hash, label, name: meta.name || null, chapters: chapters.length, maps: chapters.reduce((n, c) => n + (c.maps || []).length, 0), files: files.length };
  fs.writeFileSync(path.join(to, 'backup.json'), JSON.stringify(info, null, 1));
  if (keep) prune(dir);
  return { id, ...info };
}
function prune(dir) {
  for (const b of list(dir).slice(KEEP)) { try { fs.rmSync(path.join(backupsDir(dir), b.id), { recursive: true, force: true }); } catch {} }
}
// put a backup back (the campaign must be closed); the current state is backed up first
function restore(dir, id) {
  const from = path.join(backupsDir(dir), id);
  if (!readInfo(dir, id)) return { ok: false, error: 'That backup is gone.' };
  const before = snapshot(dir, { force: true, label: 'Before restoring', keep: false }); // pruned afterwards, so the one restored stays
  for (const rel of filesOf(dir)) { try { fs.unlinkSync(path.join(dir, rel)); } catch {} }
  for (const rel of filesOf(from)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(dir, rel));
  }
  prune(dir);
  return { ok: true, before: before && before.id };
}

module.exports = { snapshot, list, restore, KEEP };
