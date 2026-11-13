#!/usr/bin/env node
// Beta 3.4: Tablescape is open source (GPLv3). At every release the public repo glinnbo/tablescape (where the
// installers live) gets the code of that version as ONE commit, made before the version's tag: the tag, GitHub's
// "Source code" downloads and the installer then all match. The commit is made under GitHub's no-reply address of
// the account, so no private email goes public; the history of this (private) workshop stays here.
//
// What goes there: every file git keeps here, exactly as git keeps it (no line-ending changes), except
//   .github/      the release build (it names the release key, and it would run there too)
//   README.md     the developer notes; the players' README from public/ is the front page there
//   public/       its README.md becomes the front page, its pictures go to docs/
// Anything else in the public repo is replaced, so it always is a clean copy of the released version.
//
//   node scripts/sync-public.js          copy it (needs GH_TOKEN with Contents: read and write on glinnbo/tablescape)
//   node scripts/sync-public.js --dry    clone the public repo, show what would change, push nothing (no token needed)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = 'glinnbo/tablescape';
const AUTHOR = { name: 'glinnbo', email: '355398862+glinnbo@users.noreply.github.com' }; // (GitHub's no-reply address of the account)
const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const LEAVE_OUT = (p) => p.startsWith('.github/') || p === 'README.md' || p.startsWith('public/');

// git, with its output as a Buffer; the token never shows in what is printed
function git(args, opts = {}) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], { cwd: opts.cwd || ROOT, input: opts.input, maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) {
    const msg = String(r.stderr || r.error || '').split(TOKEN || '\u0000').join('***');
    throw new Error(`git ${args[0]} failed: ${msg.trim().slice(0, 400)}`);
  }
  return r.stdout;
}

// every file of this version, read from git itself: [path, mode, content]
function released() {
  const list = git(['ls-tree', '-r', '-z', 'HEAD']).toString('utf8').split('\0').filter(Boolean).map((line) => {
    const [meta, file] = line.split('\t');
    const [mode, type, sha] = meta.split(' ');
    return { file, mode, type, sha };
  }).filter((e) => e.type === 'blob');
  const out = git(['cat-file', '--batch'], { input: list.map((e) => e.sha).join('\n') + '\n' });
  let at = 0;
  for (const e of list) {
    const nl = out.indexOf(10, at);
    const size = Number(out.toString('utf8', at, nl).split(' ')[2]);
    e.data = out.subarray(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
  }
  const files = [];
  for (const e of list) {
    if (e.file === 'public/README.md') files.push(['README.md', e.mode, e.data]);
    else if (e.file.startsWith('public/docs/')) files.push([`docs/${e.file.slice('public/docs/'.length)}`, e.mode, e.data]);
    else if (!LEAVE_OUT(e.file)) files.push([e.file, e.mode, e.data]);
  }
  return files;
}

function main() {
  const files = released();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const label = `${pkg.releaseLabel || pkg.version} (${pkg.version})`;
  if (!DRY && !TOKEN) throw new Error('no GH_TOKEN');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-public-'));
  try {
    const url = TOKEN ? `https://x-access-token:${TOKEN}@github.com/${REPO}.git` : `https://github.com/${REPO}.git`;
    git(['clone', '-q', '--depth', '1', url, dir]);
    // a clean copy: everything but .git goes, then this version's files come in
    for (const f of fs.readdirSync(dir)) if (f !== '.git') fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    for (const [file, mode, data] of files) {
      const to = path.join(dir, ...file.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
      if (mode === '100755') fs.chmodSync(to, 0o755);
    }
    git(['add', '-A'], { cwd: dir });
    const changes = git(['status', '--porcelain'], { cwd: dir }).toString('utf8').split('\n').filter(Boolean);
    const kinds = changes.reduce((a, l) => { const k = l.slice(0, 2).trim() || '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
    console.log(`sync-public: ${files.length} files in ${label}; changes in ${REPO}: ${changes.length} ${JSON.stringify(kinds)}`);
    if (DRY) { for (const l of changes.slice(0, 40)) console.log(`  ${l}`); if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`); return; }
    if (!changes.length) { console.log('sync-public: the public repo has this version already'); return; }
    git(['-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'commit', '-q', '-m', `Tablescape ${label}`, '-m', 'The code of this version, copied by the release build.'], { cwd: dir });
    git(['push', '-q', 'origin', 'HEAD:main'], { cwd: dir });
    console.log(`sync-public: copied to ${REPO}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try { main(); } catch (e) { console.error(`sync-public: ${e.message}`); process.exit(1); }
