#!/usr/bin/env node
// Prototype 20: the release notes for GitHub: this version's lines from the What's new list (src/renderer/guide.js)
'use strict';
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const label = pkg.releaseLabel || pkg.version;
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'guide.js'), 'utf8');
const start = src.indexOf(`['${label}', [`);
let lines = [];
if (start >= 0) {
  const end = src.indexOf(']],', start);
  const block = src.slice(start, end);
  const re = /^\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;
  let m;
  while ((m = re.exec(block))) lines.push(m[1].replace(/\\'/g, "'"));
  lines = lines.filter((x) => x !== label);
}
process.stdout.write(`## ${label} (${pkg.version})\n\n${lines.length ? lines.map((x) => `- ${x}`).join('\n') : '- (no notes)'}\n`);
