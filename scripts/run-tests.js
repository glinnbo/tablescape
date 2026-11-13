#!/usr/bin/env node
// Runs the self-test and fails (exit 1) if a check fails.
//   npm test                    the quick level: about 3 minutes
//   npm run test:deep           quick and deep
//   node scripts/run-tests.js [--deep] [--only=fog,tokens] [--match=text] [--jobs=3]
// The app is started once per area, each with its own empty data folder, so the areas cannot disturb one another.
// Pictures of failed checks and report.json end up in ./selftest-out
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { AREAS } = require('../src/tests');
const arg = (k) => { const a = process.argv.slice(2).find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : null; };
const level = arg('deep') ? 'deep' : 'quick';
const only = arg('only') ? String(arg('only')).split(',') : null;
const match = arg('match');
const out = path.join(root, 'selftest-out');
const areas = AREAS.filter((a) => fs.existsSync(path.join(root, 'src', 'tests', 'areas', `${a}.js`)) && (!only || only.includes(a)));
if (!areas.length) { console.error('No such area. There are: ' + AREAS.join(', ')); process.exit(1); }

// TS_APP=path/to/packaged/app tests a packaged build instead of the source
const app = process.env.TS_APP || require('electron');
const base = process.env.TS_APP ? [] : ['.'];
const linux = process.platform === 'linux';
if (linux && (process.getuid?.() === 0 || process.env.CI)) base.push('--no-sandbox');
// Linux without a screen (or several at once): each app gets a screen of its own
const xvfb = linux && spawnSync('which', ['xvfb-run']).status === 0;
// several areas at once only where there are cores to spare (a starved app answers late, and checks fail for no reason)
const cores = require('os').cpus().length;
const jobs = Math.max(1, Number(arg('jobs')) || (xvfb ? Math.min(3, Math.floor(cores / 2)) : 1));
const ownScreen = xvfb && (!process.env.DISPLAY || jobs > 1);
const LIMIT = level === 'deep' ? 20 * 60000 : 6 * 60000;

if (!only) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function runArea(name, i) {
  return new Promise((done) => {
    const dir = path.join(out, name);
    fs.rmSync(dir, { recursive: true, force: true });
    const env = { ...process.env, TS_TEST_DIR: dir, TS_TEST_AREA: name, TS_TEST_LEVEL: level, TS_REMOTE_IP: '127.0.0.1', TS_REMOTE_PORT: String(47800 + i) };
    if (match) env.TS_TEST_MATCH = String(match);
    delete env.TS_SCRIPT;
    const cmd = ownScreen ? 'xvfb-run' : app;
    const args = ownScreen ? ['-a', '-s', '-screen 0 1920x1080x24', app, ...base] : base;
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: root, env, stdio: 'ignore', detached: linux });
    const kill = () => { try { if (linux) process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(kill, LIMIT);
    p.on('error', (e) => { clearTimeout(timer); done({ area: name, title: name, results: [], finished: false, problem: String(e), secs: 0 }); });
    p.on('exit', () => {
      clearTimeout(timer);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch {}
      if (!r) r = { area: name, title: name, results: [], finished: false, problem: 'The app wrote no report: it did not start.' };
      if (!r.finished && !r.problem) r.problem = Date.now() - t0 >= LIMIT - 500 ? `Stopped after ${Math.round(LIMIT / 60000)} minutes.` : 'The app closed before the area was finished.';
      r.secs = Math.round((Date.now() - t0) / 1000);
      done(r);
    });
  });
}

(async () => {
  const t0 = Date.now();
  const reports = new Array(areas.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= areas.length) return;
      reports[i] = await runArea(areas[i], AREAS.indexOf(areas[i]));
      const r = reports[i];
      const bad = r.results.filter((x) => !x.ok).length;
      console.log(`${bad || r.problem ? '✗' : '✓'} ${r.title}: ${r.results.length - bad} of ${r.results.length}${r.problem ? ' (did not finish)' : ''}  ${r.secs} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, areas.length) }, worker));

  let total = 0; let failed = 0; let broken = 0;
  const lines = [];
  for (const r of reports) {
    total += r.results.length;
    const bad = r.results.filter((x) => !x.ok);
    failed += bad.length;
    if (r.problem) { broken++; lines.push(`\n${r.title}: did not finish\n    ${String(r.problem).split('\n').slice(0, 4).join('\n    ')}`); }
    if (bad.length) {
      lines.push(`\n${r.title}`);
      for (const x of bad) {
        lines.push(`  ✗ ${x.what}${x.level === 'deep' ? '  [deep]' : ''}\n      ${x.why}${x.shot ? `\n      picture: selftest-out/${r.area}/${x.shot}-gm.png` : ''}`);
        for (const n of x.notes || []) lines.push(`      ${n}`);
      }
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  const head = `${level === 'deep' ? 'Quick and deep' : 'Quick'} self-test: ${total - failed} of ${total} checks passed in ${areas.length} areas, ${Math.floor(secs / 60)} min ${secs % 60} s`;
  const text = [head, ...lines, '', failed || broken ? `FAILED: ${failed} check${failed === 1 ? '' : 's'}${broken ? `, ${broken} area${broken === 1 ? '' : 's'} did not finish` : ''}` : 'ALL GOOD'].join('\n');
  console.log(`\n${text}`);
  fs.writeFileSync(path.join(out, only ? 'report-part.json' : 'report.json'), JSON.stringify({ level, total, failed, broken, secs, areas: reports }, null, 1));
  fs.writeFileSync(path.join(out, only ? 'summary-part.txt' : 'summary.txt'), `${text}\n`);
  process.exit(failed || broken ? 1 : 0);
})();
