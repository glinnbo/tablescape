// Beta 3.49: the lights that come with the app (light-data.js): a wall torch, a wall lantern, a lamp post, a street
// lamp, candles, a cooking fire. Each is an unlit picture (an asset) with the app's own flame or glow burning on it,
// whose light walls stop (mapstate.js: fx.fixture). Draw → Structure → Light places them on Oldschool maps, Effects →
// Light → Light sources on any map; in the Play tools a click on one asks before it is lit or put out, as doors do.
'use strict';

const Fixtures = (() => {
  const { h, clamp, round } = UI;
  const LIST = (typeof LIGHT_DATA === 'object' && LIGHT_DATA.lights) || [];
  const BY = Object.fromEntries(LIST.map((d) => [d.id, d]));
  const thumb = (d) => new URL(`lights/${d.thumb}`, document.baseURI).href;
  const picture = (d) => new URL(`lights/${d.file}`, document.baseURI).href;

  // half the thickness of the wall a sight line stands for (it runs through the wall's middle): a drawn wall line's own,
  // a drawn room's wall band, nothing on a map that is a picture
  function halfWall(map, q) {
    const g = map.grid.size || 1;
    if (!map.os) return 0;
    for (const it of map.os.items || []) {
      if (it.kind !== 'line' || !it.pts || it.pts.length < 2) continue;
      const [[x1, y1], [x2, y2]] = it.pts; const lx = x2 - x1; const ly = y2 - y1; const L2 = lx * lx + ly * ly || 1;
      const u = clamp(((q.x - x1) * lx + (q.y - y1) * ly) / L2, 0, 1);
      if (Math.hypot(q.x - x1 - lx * u, q.y - y1 - ly * u) < g * 0.06) return (it.w || g * 0.5) / 2;
    }
    return g * 0.225;
  }
  // where a light goes for a pointer at pt: a wall light on the face of the nearest wall (three quarters of a square
  // away at most), on the pointer's side, turned so its bracket meets the wall; anything else where it was clicked
  function at(map, pt, kind) {
    const d = BY[kind]; if (!d || !map) return null;
    const g = map.grid.size || 1;
    if (d.wall == null) return { x: round(pt.x, 3), y: round(pt.y, 3), rotation: 0 };
    let best = null;
    for (const w of map.walls || []) {
      if (w.kind === 'invisible') continue;
      const lx = w.x2 - w.x1; const ly = w.y2 - w.y1; const L2 = lx * lx + ly * ly; if (L2 < 1e-9) continue;
      const u = clamp(((pt.x - w.x1) * lx + (pt.y - w.y1) * ly) / L2, 0, 1);
      const qx = w.x1 + lx * u; const qy = w.y1 + ly * u; const dist = Math.hypot(pt.x - qx, pt.y - qy);
      if (dist < g * 0.75 && (!best || dist < best.dist)) best = { dist, qx, qy, lx, ly, L: Math.sqrt(L2), id: w.id };
    }
    if (!best) return { x: round(pt.x, 3), y: round(pt.y, 3), rotation: 0, free: true };
    let nx = -best.ly / best.L; let ny = best.lx / best.L;
    if ((pt.x - best.qx) * nx + (pt.y - best.qy) * ny < 0) { nx = -nx; ny = -ny; }
    const off = halfWall(map, { x: best.qx, y: best.qy }) + d.wall * g;
    return { x: round(best.qx + nx * off, 3), y: round(best.qy + ny * off, 3), rotation: Math.round((Math.atan2(-nx, ny) * 180) / Math.PI), wall: best.id };
  }
  // put one there (one step for Undo)
  function place(cmd, map, pt, o = {}) {
    const p = at(map, pt, o.kind); if (!p) return Promise.resolve(null);
    return cmd('fx.fixture', { kind: o.kind, x: p.x, y: p.y, rotation: p.rotation, color: o.color || null, lit: o.lit !== false });
  }
  // the light of the app under a point of the map, if any (its picture is small: a third of a square round it counts)
  function under(map, pt) {
    if (!map) return null;
    const g = map.grid.size || 1; let best = null;
    for (const l of map.layers || []) {
      if (!l.fixture || l.hidden) continue;
      const d = BY[l.fixture.kind]; const r = Math.max(g * 0.35, d ? (Math.max(d.w, d.h) * g) / 2 : 0);
      const dist = Math.hypot(pt.x - l.x, pt.y - l.y);
      if (dist <= r && (!best || dist < best.dist)) best = { dist, layer: l };
    }
    return best ? best.layer : null;
  }
  const isLit = (map, layer) => { const f = (map.fx || []).find((x) => x.id === layer.fixture.fx); return !!(f && !f.hidden); };

  // "Light the wall torch?" at the pointer, as a door asks before it opens
  let ask = null;
  function closeAsk() { if (!ask) return; ask.el.remove(); window.removeEventListener('pointerdown', ask.away, true); window.removeEventListener('keydown', ask.key, true); ask = null; }
  function askLit(map, layer, cmd, cx, cy) {
    closeAsk();
    const lit = isLit(map, layer); const name = String(layer.name || 'light').toLowerCase();
    const go = () => { closeAsk(); cmd('fx.fixtureLit', { id: layer.id, on: !lit }); };
    const yes = h('button', { class: 'btn small primary', onclick: go }, 'Yes');
    const no = h('button', { class: 'btn small', onclick: closeAsk }, 'No');
    const el = h('div', { class: 'door-ask light-ask', role: 'dialog', 'aria-label': 'Light' }, h('b', {}, lit ? `Put out the ${name}?` : `Light the ${name}?`), h('div', { class: 'door-ask-btns' }, yes, no));
    document.body.append(el);
    const b = el.getBoundingClientRect();
    el.style.left = `${round(clamp(cx - b.width / 2, 8, window.innerWidth - b.width - 8))}px`;
    const above = cy - b.height - 18;
    el.style.top = `${round(above > 8 ? above : cy + 18)}px`;
    ask = { el, id: layer.id,
      away: (e) => { if (!el.contains(e.target)) closeAsk(); },
      key: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAsk(); } else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); go(); } } };
    setTimeout(() => { if (ask && ask.el === el) { window.addEventListener('pointerdown', ask.away, true); window.addEventListener('keydown', ask.key, true); } }, 0);
    yes.focus();
  }
  return { LIST, BY, thumb, picture, at, place, under, isLit, askLit, closeAsk, asking: () => (ask ? ask.id : null) };
})();
