// Tables for the wheel of luck: text pasted from a book, a website, a spreadsheet or a file (.txt, .csv, .md),
// read into entries with weights. Shared by the GM screen (the preview while pasting) and main.js (files).
//   one entry per line                     Goblins                    weight 1
//   dice ranges, as in printed tables      01–05 Goblins | 1-4: Orcs  weight = how many numbers (5, 4)
//   a single die face                      3. Wolves | 17) A storm    weight 1 (the number goes)
//   a weight at the end                    Goblins ×3 | Goblins, 3    weight 3
//   rows of markdown, CSV or tabs          | 1-4 | Goblins |          as above, cell by cell
// Headings and header rows ("d100 | Encounter") name the wheel and are left out, like empty lines.
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof window !== 'undefined') root.TableParse = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const RANGE = /^(\d{1,4})\s*(?:[-–—]|to)\s*(\d{1,4})$/i;
  const FACE = /^\d{1,4}$/;
  const HEAD_WORDS = /^(d\d+|roll|rolls|result|results|entry|entries|weight|weights|chance|odds|number|no\.?|#|die|dice|table|encounter|encounters|outcome|effect|item|items)$/i;

  // "00" in a d100 table is 100
  const num = (s) => { const n = Number(s); return s === '00' || s === '000' ? 10 ** s.length : n; };
  function rangeSize(cell) {
    const t = String(cell).trim().replace(/\.$/, '');
    let m = RANGE.exec(t);
    if (m) { const a = num(m[1]); const b = num(m[2]); return Math.abs(b - a) + 1; }
    if (FACE.test(t)) return 1;
    return null;
  }
  // a CSV line, with "quoted, fields"
  function splitCsv(line, sep) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }
  const clean = (s) => String(s).replace(/\*\*|__|`/g, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim();

  function parse(text, { name = '' } = {}) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let title = '';
    const rows = [];
    // what kind of text: markdown rows, tabs, CSV (most lines have the delimiter)
    const share = (re) => lines.filter((l) => re.test(l)).length / Math.max(1, lines.length);
    const mode = share(/\|/) >= 0.5 ? 'md' : share(/\t/) >= 0.5 ? 'tab' : 'plain';
    let csv = false;
    if (mode === 'plain') {
      // CSV when most lines split by commas into a number and a text (or a text and a number)
      const looks = lines.filter((l) => { const c = splitCsv(l, ','); return c.length >= 2 && (rangeSize(c[0]) != null || FACE.test(c[c.length - 1])); }).length;
      const head = lines.length > 1 ? splitCsv(lines[0], ',') : [];
      csv = (looks / Math.max(1, lines.length) >= 0.6 && lines.length > 1) || (head.length >= 2 && head.every((c) => HEAD_WORDS.test(c)));
    }
    // plain lines that start with a number: die faces when most lines do (else "3 goblins" keeps its 3)
    const lead = /^(\d{1,4}(?:\s*(?:[-–—]|to)\s*\d{1,4})?)(?:[.:)\]]\s*|\s+[-–—:]?\s*)(.+)$/i;
    const faces = mode === 'plain' && !csv && share(lead) >= 0.6;
    let skipped = 0; let numbered = 0;
    for (let raw of lines) {
      if (/^#{1,6}\s/.test(raw)) { if (!title) title = clean(raw.replace(/^#+\s*/, '')); continue; }
      if (/^\|?\s*:?-{2,}/.test(raw) && /^[\s|:-]+$/.test(raw)) continue; // |---|---|
      let cells;
      // text around a table: a line before it names the wheel, others are left out
      if ((mode === 'md' && !raw.includes('|')) || (mode === 'tab' && !raw.includes('\t'))) { if (!rows.length && !title) title = clean(raw); else skipped++; continue; }
      if (mode === 'md') cells = raw.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      else if (mode === 'tab') cells = raw.split('\t').map((c) => c.trim());
      else if (csv) cells = splitCsv(raw, ',');
      else {
        raw = raw.replace(/^[-*•·–]\s+/, ''); // list markers
        const m = faces ? lead.exec(raw) : null;
        if (faces && !m && !rows.length && !title) { title = clean(raw); continue; } // "Random encounters (d20)" above the list
        cells = m ? [m[1], m[2]] : [raw];
      }
      cells = cells.filter((c, i) => c !== '' || i > 0);
      if (!cells.length) continue;
      // a header row: only words like "d100", "Result", "Weight"; a title cell names the wheel
      if (cells.length >= 2 && cells.every((c) => !/\d/.test(c) || /^d\d+$/i.test(c)) && cells.some((c) => HEAD_WORDS.test(c.trim())) && !rows.length) {
        const t = cells.find((c) => !HEAD_WORDS.test(c.trim()) && c.trim());
        if (t && !title) title = clean(t);
        continue;
      }
      let weight = 1; let parts = cells;
      const size = cells.length > 1 ? rangeSize(cells[0]) : null;
      if (size != null) { weight = size; parts = cells.slice(1); numbered++; }
      else if (cells.length > 1 && FACE.test(cells[cells.length - 1])) { weight = Number(cells[cells.length - 1]); parts = cells.slice(0, -1); }
      let label = clean(parts.filter(Boolean).join(' — '));
      // a weight at the end of the text: "Goblins ×3", "Goblins x 3", "Goblins, 3"
      const w = /^(.+?)(?:\s*[×✕]\s*|\s+[x*]\s*|\s*,\s*)(\d{1,3})$/i.exec(label);
      if (w && size == null) { label = clean(w[1]); weight = Number(w[2]); }
      if (!label) { skipped++; continue; }
      rows.push({ label: label.slice(0, 60), weight: Math.max(1, Math.min(100, Math.round(weight) || 1)) });
    }
    const total = rows.reduce((a, r) => a + r.weight, 0);
    const die = [2, 4, 6, 8, 10, 12, 20, 100].includes(total) && numbered === rows.length && rows.length > 1 ? `d${total}` : null;
    return { name: (title || name || '').slice(0, 60), entries: rows.slice(0, 100), more: Math.max(0, rows.length - 100), skipped, total, die };
  }

  // back out as CSV (a spreadsheet opens it; pasting it in again gives the same wheel)
  function toCsv(w) {
    const q = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    return ['Entry,Weight', ...w.entries.map((e) => `${q(e.label)},${e.weight}`)].join('\r\n') + '\r\n';
  }

  return { parse, toCsv };
}));
