// Beta 3.2: a token shown to the table (main.js 'show.start'). Its picture lifts off its place, flies to the middle of
// the table in an arc (its shadow grows as it rises) and turns once: it stops facing each long side of the table for
// about two seconds (just drifting a little), so everyone gets a good look, then flies back. The map dims around it like a
// spotlight. More can join while it turns: they line up and turn together. The picture is as big as its own pixels
// allow (sharp), never more than two thirds of the table's short side. The token itself steps aside meanwhile, so
// there is only ever one of it on the table.
'use strict';

const TableShow = (() => {
  const FLY = 1000; const HOLD = 2000; const MOVE = 1800; const DRIFT = 3; // as in main.js (showTurn)
  let root = null; let spot = null;
  let showId = null; let T0 = 0; // the shared turn's start, on the page's animation clock
  let turn = { ms: 2 * (HOLD + MOVE), sides: 2 };
  const items = new Map(); // layer id -> { id, el, view, a0, ... }
  const clock = () => document.timeline.currentTime || performance.now();
  const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

  function mount(el) {
    root = el;
    spot = div('show-spot');
    root.append(spot);
    return { set };
  }

  // s: state.show (or null); view: the SceneView of the live map
  function set(s, view) {
    const map = view && !view.dead ? view.map : null;
    if (!s || !map || s.mapId !== map.id) { for (const it of items.values()) goBack(it); return; }
    if (s.id !== showId) {
      for (const it of items.values()) goBack(it); // an older show still flying back lands on its own
      showId = s.id;
      T0 = clock() + (s.spinAt - Date.now());
      turn = { ms: s.turn || 2 * (HOLD + MOVE), sides: s.sides === 1 ? 1 : 2 };
    }
    if (s.phase === 'back') { for (const it of items.values()) if (it.show === s.id) goBack(it); return; }
    const fresh = [];
    for (const id of s.ids) {
      const had = items.get(id);
      if (had && !had.back) continue;
      if (had) finish(had); // (flying back from an earlier show: it starts again from here)
      const it = make(id, s.id, map, view);
      if (it) { items.set(id, it); fresh.push(it); }
    }
    if (!fresh.length) return;
    marks(view);
    layout();
    for (const it of fresh) fly(it);
  }

  function make(id, show, map, view) {
    const l = map.layers.find((x) => x.id === id && x.role === 'token');
    const from = l && view.tokenScreen(id);
    if (!from) return null;
    const video = l.kind === 'video';
    const el = div('show-item');
    const shade = div('show-shade');
    const turners = []; // the picture and its shadow turn as one
    const stack = (child) => { const pre = div('show-pre'); const spin = div('show-spin'); spin.append(child); pre.append(spin); turners.push({ pre, spin }); return pre; };
    const media = (cls) => {
      const m = document.createElement(video ? 'video' : 'img');
      if (video) { m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true; }
      m.src = l.url; m.className = cls; m.draggable = false;
      return m;
    };
    // the shadow: the picture's own shape, dark and soft (a video gets a soft round one)
    shade.append(stack(video ? div('show-blob') : media('show-sh')));
    el.append(shade, stack(media('show-pic')));
    root.append(el);
    const dpr = window.devicePixelRatio || 1;
    return {
      id, show, el, shade, turners, view, from, hidden: !!l.hidden,
      a0: Number(l.rotation) || 0,
      want: view.tokenNatural(id) / dpr, // its own pixels, one for one on this screen
    };
  }

  // the line of shown tokens across the middle, along the table's long side
  function layout() {
    const list = [...items.values()].filter((it) => !it.back);
    if (!list.length) { spot.classList.remove('on'); return; }
    const W = innerWidth; const H = innerHeight; const wide = W >= H;
    const along = wide ? W : H; const across = wide ? H : W;
    const cap = across * 0.66;
    let sizes = list.map((it) => Math.min(cap, Math.max(it.want, it.from.size * 1.5)));
    const gap = along * 0.05;
    const total = sizes.reduce((a, b) => a + b, 0) + gap * (list.length - 1);
    const k = Math.min(1, (along * 0.92) / total);
    sizes = sizes.map((v) => v * k);
    let pos = (along - total * k) / 2;
    list.forEach((it, i) => {
      const S = sizes[i]; const c = pos + S / 2; pos += S + gap * k;
      place(it, wide ? c : W / 2, wide ? H / 2 : c, S);
    });
    // the spotlight: an oval round them all, the rest of the map dimmed
    const big = Math.max(...sizes); const len = total * k;
    const w = (wide ? len : big) + big * 1.1; const h = (wide ? big : len) + big * 1.1;
    const geo = { left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, width: `${w}px`, height: `${h}px` };
    if (!spot.classList.contains('on')) {
      spot.style.transition = 'none';
      Object.assign(spot.style, geo);
      void spot.offsetWidth;
      spot.style.transition = '';
      spot.classList.add('on');
    } else Object.assign(spot.style, geo);
  }
  function place(it, x, y, S) {
    const e = it.el;
    e.style.transition = it.to ? '' : 'none'; // the ones already there move aside smoothly
    Object.assign(e.style, { left: `${x - S / 2}px`, top: `${y - S / 2}px`, width: `${S}px`, height: `${S}px` });
    e.style.setProperty('--blur', `${Math.max(2, S * 0.03).toFixed(1)}px`);
    if (!it.to) void e.offsetWidth;
    it.to = { x, y }; it.S = S;
  }

  // a quadratic arc from a to b (translations, in pixels) with a scale along it and a little lift in the middle
  function arc(a, b, sa, sb, lift) {
    const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
    const bow = Math.min(d * 0.22, Math.min(innerWidth, innerHeight) * 0.22);
    const c = { x: (a.x + b.x) / 2 + (dy / d) * bow * 2, y: (a.y + b.y) / 2 - (dx / d) * bow * 2 };
    const out = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10; const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
      const s = sa + (sb - sa) * t + lift * Math.sin(Math.PI * t);
      out.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})`, offset: t });
    }
    return out;
  }

  function fly(it) {
    const S = it.S; const f = it.from;
    const start = { x: f.x - it.to.x, y: f.y - it.to.y };
    const s0 = f.size / S;
    const path = arc(start, { x: 0, y: 0 }, s0, 1, 0.08);
    if (it.hidden) { path[0].opacity = 0; path[3].opacity = 1; path[10].opacity = 1; } // a hidden one appears as it lifts
    it.fly = it.el.animate(path, { duration: FLY, easing: 'cubic-bezier(.45, 0, .25, 1)' });
    // it rises: the shadow falls further away and darker (light from the top left, as for the assets)
    it.shade.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 0.3 },
      { transform: `translate(${(S * 0.05).toFixed(1)}px, ${(S * 0.09).toFixed(1)}px) scale(1.04)`, opacity: 0.55 },
    ], { duration: FLY, easing: 'ease-out', fill: 'forwards' });
    // the turn: all on one clock, so the ones shown together turn together and face the same side at the same time.
    // It shows the picture upright to one long side, then to the other (or to the one side the players sit at).
    // A token joining a turn under way, or one lying turned on the map, turns into step while it flies in.
    const keys = turnKeys();
    for (const t of it.turners) {
      t.anim = t.spin.animate(keys, { duration: turn.ms, iterations: Infinity, fill: 'backwards' });
      t.anim.startTime = T0;
    }
    const lag = angleOf(it.turners[0].spin); // where the turn is right now (before it starts: where it starts)
    const d = ((((it.a0 - lag) % 360) + 540) % 360) - 180; // the token's own turn on the map, the short way
    if (Math.abs(d) > 0.5) for (const t of it.turners) t.preAnim = t.pre.animate([{ transform: `rotate(${d}deg)` }, { transform: 'rotate(0deg)' }], { duration: FLY, easing: 'ease-out' });
  }
  // one turn: upright to the near long side (it starts there), a slow drift while it stays, an easy half turn, the far
  // side, and round to the near side again. Upright for a long side: 0 and 180 degrees on a wide TV, 90 and 270 on a tall one.
  function turnKeys() {
    const o = innerHeight > innerWidth ? 90 : 0;
    const k = (a, at, easing) => ({ transform: `rotate(${o + a}deg)`, offset: at, easing });
    if (turn.sides === 1) {
      const P = HOLD + 2 * MOVE;
      return [k(-DRIFT, 0, 'linear'), k(DRIFT, HOLD / P, 'ease-in-out'), k(360 - DRIFT, 1)];
    }
    const P = 2 * (HOLD + MOVE);
    return [k(-DRIFT, 0, 'linear'), k(DRIFT, HOLD / P, 'ease-in-out'), k(180 - DRIFT, (HOLD + MOVE) / P, 'linear'), k(180 + DRIFT, (2 * HOLD + MOVE) / P, 'ease-in-out'), k(360 - DRIFT, 1)];
  }

  const matrix = (el) => { const t = getComputedStyle(el).transform; return t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix(); };
  const angleOf = (el) => { const m = matrix(el); return (Math.atan2(m.b, m.a) * 180) / Math.PI; };

  function goBack(it) {
    if (it.back) return;
    it.back = true;
    const e = it.el;
    // from wherever it is now (it may still be flying in)
    const now = matrix(e);
    const cur = { x: now.e, y: now.f }; const sc = Math.hypot(now.a, now.b) || 1;
    if (it.fly) it.fly.cancel();
    // it turns back to how it lay on the map (the short way) as it flies, so it lands as it lay
    const t0 = it.turners[0];
    const ang = angleOf(t0.pre) + angleOf(t0.spin);
    const d = ((((it.a0 - ang) % 360) + 540) % 360) - 180;
    for (const t of it.turners) {
      if (t.anim) t.anim.cancel();
      if (t.preAnim) t.preAnim.cancel();
      t.spin.style.transform = `rotate(${ang}deg)`;
      t.spin.animate([{ transform: `rotate(${ang}deg)` }, { transform: `rotate(${ang + d}deg)` }], { duration: FLY, easing: 'ease-in-out', fill: 'forwards' });
    }
    it.shade.animate([{ opacity: 0.55 }, { transform: 'translate(0, 0) scale(1)', opacity: 0.3 }], { duration: FLY, easing: 'ease-in', fill: 'forwards' });
    if (![...items.values()].some((x) => !x.back)) spot.classList.remove('on');
    // where the token is now (the map may have moved meanwhile); gone: the picture fades where it is
    const view = it.view;
    const home = view && !view.dead && view.tokenScreen(it.id);
    const l = view && view.map && view.map.layers.find((x) => x.id === it.id);
    if (!home || !it.to) {
      e.style.transform = now.toString();
      e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).onfinish = () => finish(it);
      return;
    }
    const path = arc(cur, { x: home.x - it.to.x, y: home.y - it.to.y }, sc, home.size / it.S, 0.06);
    if (!l || l.hidden) { path[6].opacity = 1; path[10].opacity = 0; } // still hidden: it fades as it lands
    e.style.transform = path[10].transform;
    e.animate(path, { duration: FLY, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' }).onfinish = () => finish(it);
  }

  function finish(it) {
    if (items.get(it.id) === it) items.delete(it.id);
    for (const m of it.el.querySelectorAll('video')) { m.removeAttribute('src'); m.load(); }
    it.el.remove();
    if (it.view && !it.view.dead) marks(it.view);
  }
  // the tokens on show step aside on the map (only those still in the air)
  function marks(view) { view.setOnShow(new Set([...items.values()].filter((x) => x.view === view).map((x) => x.id))); }

  return { mount };
})();
