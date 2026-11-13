// Maps arrive at real size: how many pixels one square of a map picture is, so one square can be
// one inch on the table (the size of a miniature's base). Two ways, tried in this order:
//   fromName   "Crypt 30x20.jpg": 30 squares across, 20 down (the shape of the picture must agree)
//   fromImage  a grid printed on the map: the lines repeat at the same distance across and down
// Both return { cell (picture pixels per square), ox, oy (where a grid line runs, picture pixels),
// cols, rows, how } or null when they aren't sure. A wrong guess is worse than none.
'use strict';

const GridDetect = (() => {
  // ---------- from the file name ----------
  function fromName(name, nw, nh) {
    if (!name || !nw || !nh) return null;
    const re = /(?:^|[^0-9])(\d{1,3})\s*[x×]\s*(\d{1,3})(?![0-9])/gi;
    let m;
    const aspect = nw / nh;
    while ((m = re.exec(String(name)))) {
      let a = Number(m[1]); let b = Number(m[2]);
      if (a < 4 || b < 4 || a > 200 || b > 200) continue;
      const fits = (c, r) => Math.abs(aspect / (c / r) - 1) <= 0.05;
      if (!fits(a, b)) { if (fits(b, a)) [a, b] = [b, a]; else continue; }
      const cell = (nw / a + nh / b) / 2;
      if (cell < 8) continue;
      return { cell, ox: 0, oy: 0, cols: a, rows: b, how: 'name' };
    }
    return null;
  }

  // ---------- from a grid printed on the picture ----------
  // the strongest repeat of a profile (sums along columns or rows), between lo and hi pixels
  function period(p, lo, hi) {
    const n = p.length;
    if (n < lo * 4) return null;
    // take away slow changes (light, big shapes): only the fine detail is left
    const q = new Float32Array(n);
    const win = Math.max(3, Math.round(lo * 0.6));
    let acc = 0; const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { acc += p[i]; pre[i + 1] = acc; }
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - win); const b = Math.min(n, i + win + 1); q[i] = p[i] - (pre[b] - pre[a]) / (b - a); }
    let v = 0;
    for (let i = 0; i < n; i++) v += q[i] * q[i];
    v /= n;
    if (!(v > 1e-9)) return null;
    const ac = new Float32Array(hi + 2);
    for (let lag = lo - 1; lag <= hi + 1 && lag < n; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += q[i] * q[i + lag];
      ac[lag] = s / (n - lag) / v;
    }
    const peaks = [];
    for (let lag = lo; lag <= hi && lag + 1 < n; lag++) if (ac[lag] > 0.18 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) peaks.push(lag);
    if (!peaks.length) return null;
    const best = Math.max(...peaks.map((l) => ac[l]));
    // the shortest repeat that is nearly as strong: twice the cell repeats too
    const lag = peaks.find((l) => ac[l] >= best * 0.72);
    const acAt = (l) => { let s = 0; for (let i = 0; i + l < n; i++) s += q[i] * q[i + l]; return s / (n - l) / v; };
    // the peak between whole pixels
    const peakNear = (l) => {
      let bestL = l; let bv = -Infinity;
      for (let x = l - 2; x <= l + 2; x++) { const val = acAt(x); if (val > bv) { bv = val; bestL = x; } }
      const a = acAt(bestL - 1); const c = acAt(bestL + 1); const d = a - 2 * bv + c;
      return { at: d < 0 ? bestL + (0.5 * (a - c)) / d : bestL, v: bv };
    };
    let fine = peakNear(lag).at;
    // measured over several squares the size comes out much finer than over one
    for (let m = Math.min(8, Math.floor((n * 0.45) / fine)); m >= 2; m--) {
      const pk = peakNear(Math.round(fine * m));
      if (pk.v >= ac[lag] * 0.6) { fine = pk.at / m; break; }
    }
    return { lag: fine, strength: ac[lag], q };
  }
  // where along a profile the lines lie, as an offset 0..lag
  function phase(q, lag) {
    let best = 0; let at = 0;
    const steps = Math.max(8, Math.round(lag * 2));
    for (let s = 0; s < steps; s++) {
      const o = (s / steps) * lag;
      let sum = 0; let n = 0;
      for (let x = o; x < q.length - 1; x += lag) { const i = Math.floor(x); const f = x - i; sum += q[i] * (1 - f) + q[i + 1] * f; n++; }
      const v = Math.abs(sum / Math.max(1, n));
      if (v > best) { best = v; at = o; }
    }
    return at;
  }
  function fromImage(el, nw, nh) {
    if (!el || !nw || !nh) return null;
    const f = Math.min(1, 1400 / Math.max(nw, nh));
    const w = Math.max(16, Math.round(nw * f)); const hgt = Math.max(16, Math.round(nh * f));
    let data;
    try {
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(el, 0, 0, w, hgt);
      data = g.getImageData(0, 0, w, hgt).data;
    } catch { return null; }
    const L = new Float32Array(w * hgt);
    for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    // how bright each column and row is, and how much it changes from its neighbour
    const colL = new Float32Array(w); const rowL = new Float32Array(hgt);
    const colG = new Float32Array(w); const rowG = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const v = L[o + x];
        colL[x] += v; rowL[y] += v;
        if (x + 1 < w) colG[x] += Math.abs(L[o + x + 1] - v);
        if (y + 1 < hgt) rowG[y] += Math.abs(L[o + w + x] - v);
      }
    }
    // squares smaller than this (in the shrunk picture, and 24 pixels in the real one) are not a battle map grid
    const lo = Math.max(8, Math.ceil(24 * f));
    const hiX = Math.floor(w / 5); const hiY = Math.floor(hgt / 4);
    const px = period(colG, lo, hiX); const py = period(rowG, lo, hiY);
    if (!px || !py) return null;
    // both directions repeat at the same distance: square cells
    if (Math.abs(px.lag - py.lag) / Math.min(px.lag, py.lag) > 0.03) return null;
    if (px.strength < 0.25 || py.strength < 0.25) return null;
    let cell = (px.lag + py.lag) / 2 / f;
    // most maps are a whole number of squares across or down: snap to that when it is very close
    const cols = Math.round(nw / cell); const rows = Math.round(nh / cell);
    const snaps = [nw / cols, nh / rows].filter((c) => Math.abs(c - cell) / cell < 0.005).sort((a, b) => Math.abs(a - cell) - Math.abs(b - cell));
    if (snaps.length) cell = snaps[0];
    if (cols < 5 || rows < 3 || cols > 120) return null;
    // where a line runs: from the brightness (a drawn line is darker or lighter than the floor)
    const lx = period(colL, lo, hiX); const ly = period(rowL, lo, hiY);
    const ox = lx ? phase(lx.q, px.lag) / f : 0; const oy = ly ? phase(ly.q, py.lag) / f : 0;
    return { cell, ox: ox % cell, oy: oy % cell, cols: Math.round(nw / cell), rows: Math.round(nh / cell), how: 'image', strength: Math.min(px.strength, py.strength), raw: [px.lag / f, py.lag / f] };
  }

  return { fromName, fromImage };
})();
