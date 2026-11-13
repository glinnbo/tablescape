// The self-test. Runs only when TS_TEST_DIR is set (scripts/run-tests.js starts the app once per area):
//   TS_TEST_DIR=out TS_TEST_AREA=fog TS_TEST_LEVEL=quick|deep electron .
// Every check stands alone: one that fails is written down with a picture, and the next one starts clean.
//   quick: every tool and panel opens, the main flows work, nothing reports an error
//   deep:  exact results, area by area (runs the quick checks of the area too)
// A new feature brings its checks along: add them to the area's file under src/tests/areas.
'use strict';

const fs = require('fs');
const path = require('path');
const kit = require('./kit');

// the order they are run and listed in
const AREAS = ['start', 'tv', 'tools', 'panels', 'fog', 'tokens', 'spells', 'initiative', 'hotbar', 'handouts', 'ready', 'options', 'guide', 'phones', 'sound', 'keep', 'light', 'walls', 'maptools', 'screens', 'snapshots', 'library', 'portraits', 'styles', 'safety'];
exports.AREAS = AREAS;
exports.titles = () => Object.fromEntries(AREAS.filter((a) => fs.existsSync(path.join(__dirname, 'areas', `${a}.js`))).map((a) => [a, load(a).title]));

function load(name) {
  const area = { name, title: name, befores: [], checks: [] };
  const api = {
    title: (s) => { area.title = s; },
    before: (fn) => { area.befores.push(fn); },
    quick: (what, fn, opts = {}) => { area.checks.push({ what, fn, level: 'quick', ...opts }); },
    deep: (what, fn, opts = {}) => { area.checks.push({ what, fn, level: 'deep', ...opts }); },
  };
  require(path.join(__dirname, 'areas', `${name}.js`))(api);
  return area;
}

const first = (e) => String((e && (e.message || e)) || 'failed').split('\n')[0].slice(0, 500);

exports.run = async (env) => {
  const dir = path.resolve(process.env.TS_TEST_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const name = process.env.TS_TEST_AREA || 'start';
  const level = process.env.TS_TEST_LEVEL === 'deep' ? 'deep' : 'quick';
  const match = process.env.TS_TEST_MATCH ? new RegExp(process.env.TS_TEST_MATCH, 'i') : null;
  const report = { area: name, title: name, level, results: [], finished: false, problem: null };
  const save = () => { try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1)); } catch {} };
  save();
  let K = null;
  try {
    const area = load(name);
    report.title = area.title;
    const todo = area.checks.filter((c) => (level === 'deep' || c.level === 'quick') && (!match || match.test(c.what)));
    K = await kit.make(env, dir);
    await K.ready();
    // the area's starting point; if that fails, its checks cannot say anything
    let setup = null;
    for (const fn of area.befores) {
      try { await fn(K); } catch (e) { setup = first(e); await K.shot(K.gm(), 'setup-failed').catch(() => {}); break; }
    }
    await K.calm();
    let n = 0;
    for (const c of todo) {
      n++;
      const r = { what: c.what, level: c.level, ok: false, ms: 0, why: null, notes: [] };
      report.results.push(r);
      if (setup) { r.why = `not run: the area's start failed (${setup})`; save(); continue; }
      const ctl = { dead: false, notes: r.notes };
      const t = kit.forCheck(K, ctl);
      const e0 = K.errors.length;
      const t0 = Date.now();
      let timer = null;
      try {
        await Promise.race([
          (async () => { await c.fn(t); })(),
          new Promise((res, rej) => { timer = setTimeout(() => rej(new Error(`took longer than ${Math.round((c.ms || 45000) / 1000)} s`)), c.ms || 45000); }),
        ]);
        r.ok = true;
      } catch (e) {
        r.why = first(e);
        if (e && e.stack && !/expected|not on screen|waited|took longer/.test(r.why)) r.notes.push(String(e.stack).split('\n').slice(1, 4).join(' ').trim().slice(0, 400));
      }
      clearTimeout(timer);
      ctl.dead = true;
      r.ms = Date.now() - t0;
      await kit.sleep(60);
      K.hookAll();
      // anything the app itself reported during the check counts against it
      const errs = K.errors.slice(e0).filter((x) => !(c.allow && c.allow.test(x.text)));
      if (errs.length) {
        const seen = [...new Set(errs.map((x) => `${x.where}: ${x.text.split('\n')[0].slice(0, 300)}`))];
        if (r.ok) { r.ok = false; r.why = `the app reported an error: ${seen[0]}`; }
        r.notes.push(...seen.slice(0, 6).map((s) => `error: ${s}`));
      }
      if (r.ok && !c.noText) {
        const bad = await K.badText().catch(() => []);
        if (bad.length) { r.ok = false; r.why = `"null", "undefined" or "NaN" on screen: ${bad[0]}`; r.notes.push(...bad.slice(0, 5)); }
      }
      if (!r.ok) {
        r.shot = `fail-${String(n).padStart(2, '0')}`;
        await K.shot(K.gm(), `${r.shot}-gm`).catch(() => {});
        await K.shot(K.tv(), `${r.shot}-tv`).catch(() => {});
      }
      save();
      await K.calm().catch(() => {});
    }
    report.finished = true;
  } catch (e) {
    report.problem = String((e && e.stack) || e).slice(0, 1500);
  }
  save();
  env.app.exit(0);
};
