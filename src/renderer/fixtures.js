// Lights you place (Beta 3.54: one thing each). A light is one effect (FXDATA.isLight):
//   holder: a light that comes with the app (light-data.js: a wall torch, a wall lantern, a lamp post, a street lamp,
//           candles, a cooking fire): its unlit picture (drawn by scene-view from the light) with the app's own flame
//           or glow burning on it; an emitter with .holder (and .rotation, .wall for one on a wall)
//   flame:  a flame that gives light (Torch, Campfire, Candles), for a map with the torch painted on it; an emitter
//   plain:  just light (Candle, Torch, Lantern, Light cantrip, Moonlight, Bullseye lantern), which a token can carry
// Each is lit or put out (lit: false), hidden from the players or not (hidden), moved, changed and removed as one.
// Draw → Structure → Light (Oldschool maps) and Effects → Light → Light sources show the same panel (gm-play.js
// lightPanel); with the Select tool a click on a light asks before it is lit or put out, as doors do.
'use strict';

const Fixtures = (() => {
  const { h, clamp, round } = UI;
  const HOLDERS = (typeof LIGHT_DATA === 'object' && LIGHT_DATA.lights) || [];
  const BY = Object.fromEntries(HOLDERS.map((d) => [d.id, d]));
  const FLAMES = FXDATA.FLAMES;
  const PLAIN = FXDATA.LIGHTS.filter((l) => l.id !== 'party');
  const GROUPS = ['holder', 'flame', 'plain'];
  const thumb = (d) => new URL(`lights/${d.thumb}`, document.baseURI).href;
  const picture = (d) => new URL(`lights/${d.file}`, document.baseURI).href;
  const isLight = (f) => FXDATA.isLight(f);
  const groupOf = (f) => (f.holder ? 'holder' : f.kind === 'emitter' ? 'flame' : 'plain');
  const plainIcon = (id) => ({ moon: 'moon', candle: 'candle', bullseye: 'cone', light: 'sparkles' }[id] || 'bulb');
  const holderIcon = (d) => ({ torch: 'flame', campfire: 'campfire', candle: 'candle' }[d.fx.preset] || 'bulb');
  // what a kind of light is: its name, picture or icon, its light, its colour, its flame's size (in squares)
  function defOf(group, id) {
    if (group === 'holder') {
      const d = BY[id] || HOLDERS[0]; if (!d) return null;
      return { group, id: d.id, label: d.label, thumb: thumb(d), icon: holderIcon(d), bright: d.fx.bright, dim: d.fx.dim, color: d.fx.color || null, r: d.fx.r, wall: d.wall, preset: d.fx.preset, w: d.w, h: d.h };
    }
    if (group === 'flame') {
      const e = FLAMES.find((x) => x.id === id) || FLAMES[0];
      return { group, id: e.id, label: e.label, icon: e.icon, bright: e.light.bright, dim: e.light.dim, color: null, r: e.r, preset: e.id };
    }
    const l = PLAIN.find((x) => x.id === id) || PLAIN.find((x) => x.id === 'torch');
    return { group: 'plain', id: l.id, label: l.label, icon: plainIcon(l.id), bright: l.bright, dim: l.dim, color: l.color, cone: l.cone || 0, preset: l.id, flicker: !['moon', 'light'].includes(l.id) };
  }
  const kinds = (group) => (group === 'holder' ? HOLDERS.map((d) => d.id) : group === 'flame' ? FLAMES.map((e) => e.id) : PLAIN.map((l) => l.id)).map((id) => defOf(group, id));
  const defOfLight = (f) => (f.preset === 'party' ? { group: 'plain', id: 'party', label: 'Party light', icon: 'users-group', bright: f.bright, dim: f.dim, color: '#ffcf8a', preset: 'party' } : defOf(groupOf(f), f.holder || f.preset));
  function labelOf(f, map) {
    const d = defOfLight(f);
    const t = f.attachTo && map ? (map.layers || []).find((l) => l.id === f.attachTo) : null;
    return `${d ? d.label : 'Light'}${t ? ` · carried by ${t.name || 'a token'}` : f.attachTo ? ' · carried' : ''}`;
  }
  // the colour it comes in (what "its own colour" puts back)
  const ownColor = (f) => { const d = defOfLight(f); return (d && d.color) || null; };
  const isOwnColor = (f) => !f.color || String(f.color).toLowerCase() === String(ownColor(f) || '').toLowerCase();

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
  // where a holder light goes for a pointer at pt: a wall light on the face of the nearest wall (three quarters of a
  // square away at most), on the pointer's side, turned so its bracket meets the wall (wall: that wall's id); anything
  // else where it was clicked
  function at(map, pt, holderId) {
    const d = BY[holderId];
    if (!d || !map) return { x: round(pt.x, 3), y: round(pt.y, 3), rotation: 0 };
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
    if (!best) return { x: round(pt.x, 3), y: round(pt.y, 3), rotation: 0, free: true, wall: null };
    let nx = -best.ly / best.L; let ny = best.lx / best.L;
    if ((pt.x - best.qx) * nx + (pt.y - best.qy) * ny < 0) { nx = -nx; ny = -ny; }
    const off = halfWall(map, { x: best.qx, y: best.qy }) + d.wall * g;
    return { x: round(best.qx + nx * off, 3), y: round(best.qy + ny * off, 3), rotation: Math.round((Math.atan2(-nx, ny) * 180) / Math.PI), wall: best.id };
  }
  // the light under a point of the map, if any: its holder's picture, its flame, or a third of a square round a light
  // that shows nothing. Not a light a token carries (the token is clicked) nor the party's marker.
  function under(map, pt) {
    if (!map) return null;
    const g = map.grid.size || 1; let best = null;
    for (const f of map.fx || []) {
      if (!isLight(f) || f.attachTo || f.preset === 'party') continue;
      const d = f.holder ? BY[f.holder] : null;
      const r = Math.max(g * 0.35, d ? (Math.max(d.w, d.h) * g * (f.hs || 1)) / 2 : f.kind === 'emitter' ? (f.r || 0.5) * 0.6 : 0);
      const dist = Math.hypot(pt.x - f.x, pt.y - f.y);
      if (dist <= r && (!best || dist < best.dist)) best = { dist, f };
    }
    return best ? best.f : null;
  }
  const isLit = (f) => !!f && f.lit !== false;

  // "Light the wall torch?" at the pointer, as a door asks before it opens
  let ask = null;
  function closeAsk() { if (!ask) return; ask.el.remove(); window.removeEventListener('pointerdown', ask.away, true); window.removeEventListener('keydown', ask.key, true); ask = null; }
  function askLit(map, f, cmd, cx, cy) {
    closeAsk();
    const lit = isLit(f); const name = String(defOfLight(f).label || 'light').toLowerCase();
    const go = () => { closeAsk(); cmd('fx.lit', { id: f.id, on: !lit }); };
    const yes = h('button', { class: 'btn small primary', onclick: go }, 'Yes');
    const no = h('button', { class: 'btn small', onclick: closeAsk }, 'No');
    const el = h('div', { class: 'door-ask light-ask', role: 'dialog', 'aria-label': 'Light' }, h('b', {}, lit ? `Put out the ${name}?` : `Light the ${name}?`), h('div', { class: 'door-ask-btns' }, yes, no));
    document.body.append(el);
    const b = el.getBoundingClientRect();
    el.style.left = `${round(clamp(cx - b.width / 2, 8, window.innerWidth - b.width - 8))}px`;
    const above = cy - b.height - 18;
    el.style.top = `${round(above > 8 ? above : cy + 18)}px`;
    ask = { el, id: f.id,
      away: (e) => { if (!el.contains(e.target)) closeAsk(); },
      key: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAsk(); } else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); go(); } } };
    setTimeout(() => { if (ask && ask.el === el) { window.addEventListener('pointerdown', ask.away, true); window.addEventListener('keydown', ask.key, true); } }, 0);
    yes.focus();
  }
  return { HOLDERS, BY, FLAMES, PLAIN, GROUPS, thumb, picture, isLight, groupOf, defOf, defOfLight, kinds, labelOf, ownColor, isOwnColor, at, under, isLit, askLit, closeAsk, asking: () => (ask ? ask.id : null) };
})();
