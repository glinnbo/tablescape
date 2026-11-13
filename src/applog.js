// A small log file for bug reports during the alpha: userData/logs/tablescape.log (rotated at 2 MB).
// Errors and warnings of both windows end up here too. Keys sheet → Copy log puts the end of it on the clipboard.
'use strict';
const fs = require('fs');
const path = require('path');

let file = null;
let lastLine = ''; let repeats = 0;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'tablescape.log');
  try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.old`); } catch {}
  return file;
}
function write(level, parts) {
  const msg = parts.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  // the same message over and over (a warning every frame) is written once, with a count
  if (msg === lastLine) { repeats++; return; }
  const out = [];
  if (repeats) out.push(`${new Date().toISOString()} [${level}] (the line above repeated ${repeats} more times)`);
  lastLine = msg; repeats = 0;
  out.push(`${new Date().toISOString()} [${level}] ${msg}`);
  if (!file) return;
  try { fs.appendFileSync(file, `${out.join('\n')}\n`); } catch {}
}
const log = { info: (...a) => write('info', a), warn: (...a) => write('warn', a), error: (...a) => write('error', a) };
// the last lines of the log (for the clipboard)
function tail(lines = 200) {
  if (!file) return '';
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}
module.exports = { init, log, tail, get file() { return file; } };
