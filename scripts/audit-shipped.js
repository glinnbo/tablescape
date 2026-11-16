#!/usr/bin/env node
// Beta 3.9: no release with a known serious security problem in what ships. Run by the release build after npm ci.
//
// What ships in the installer: Electron itself (the engine: Chrome and Node.js) and the packages the app needs to run
// (package.json "dependencies" and what those bring along). The build tools never reach a user, so their warnings do
// not stop a release (they are listed, to be looked at). "npm audit --omit=dev" alone would not do: Electron is a
// devDependency, and it is the part that matters most. Beta 3.8 went out with an Electron three weeks behind a
// security fix because nothing looked.
//
//   node scripts/audit-shipped.js        stops (exit 1) on a high or critical problem in what ships
// If the list of known problems can't be fetched (no network, the registry is down) it says so and lets the build go
// on: a release must not hang on someone else's server, and the next one checks again.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BAD = ['high', 'critical'];

function main() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  // in the lock file a package only the build needs is marked "dev"; Electron is one of those, and ships all the same
  const ships = (node) => node === 'node_modules/electron' || (lock.packages[node] && !lock.packages[node].dev);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch {}
  if (!report || !report.vulnerabilities || report.error) {
    const why = (report && report.error && (report.error.summary || report.error.code)) || String(r.stderr || r.error || 'no answer').trim().split('\n')[0].slice(0, 200);
    console.log(`::warning::audit-shipped: the list of known security problems could not be fetched (${why}); not checked this time`);
    return 0;
  }
  const rows = Object.values(report.vulnerabilities).map((v) => ({
    name: v.name, severity: v.severity, shipped: (v.nodes || []).some(ships),
    what: (v.via || []).filter((x) => x && typeof x === 'object').map((x) => `${x.title} (${x.url})`),
  }));
  const stop = rows.filter((x) => x.shipped && BAD.includes(x.severity));
  const watch = rows.filter((x) => x.shipped && !BAD.includes(x.severity));
  const tools = rows.filter((x) => !x.shipped);
  const say = (x) => `  ${x.name} [${x.severity}]${x.what.length ? `: ${x.what.slice(0, 3).join('; ')}` : ''}`;
  console.log(`audit-shipped: Electron ${lock.packages['node_modules/electron'].version}; ${Object.keys(lock.packages).filter((n) => n && ships(n)).length} packages ship`);
  if (tools.length) { console.log(`build tools with a known problem (they do not ship): ${tools.map((x) => `${x.name} [${x.severity}]`).join(', ')}`); }
  if (watch.length) { console.log('in what ships, below high:'); for (const x of watch) console.log(say(x)); }
  if (stop.length) {
    console.log('in what ships, high or critical:');
    for (const x of stop) console.log(say(x));
    console.log(`::error::A known ${stop.map((x) => x.severity).includes('critical') ? 'critical' : 'high'} security problem in what ships: ${stop.map((x) => x.name).join(', ')}. Update it (for Electron: the newest version of its line), then release.`);
    return 1;
  }
  console.log('audit-shipped: nothing high or critical in what ships');
  return 0;
}

process.exit(main());
