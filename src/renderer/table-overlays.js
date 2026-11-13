// Things laid over the whole TV, above the map:
//   Talk       NPC portraits rising out of an ink band (one band per long side of the table)
//   Handout    a letter or picture shown large
//   Break      a break screen with a calm countdown dial (its label, a line of text, the map blurred, a picture or dark)
//   Initiative the turn order as a thin ribbon along the long edges
//   Title      the session's title when it starts (the campaign's name, "Session 13"), until the first map
// With players on both long sides everything appears twice, the far copy turned 180°.
'use strict';

const TableOverlays = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const r3 = (v) => Math.round(v * 10) / 10;

  // a small seeded random generator, so both sides get the same brush stroke
  function rnd(seed) {
    let a = seed >>> 0 || 1;
    return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  }

  // A ragged ink band along the bottom edge, w x hgt pixels, with spatter above its top edge.
  // 4.5: more like real ink: a rougher, bleeding edge with a faint grey halo, tongues flung up by the brush,
  // blots that land one after another along the sweep with droplets flying out of them, thin flung streaks,
  // and a wet shine along the edge and on the blots. o.sweep: how long the band takes to sweep in (s).
  function inkBand(w, hgt, seed, o = {}) {
    const R = rnd(seed);
    const sweep = o.sweep ?? 0.5;
    const top = hgt * 0.32;
    const u = Math.max(4, Math.min(hgt * (o.unit ?? 0.06), 60)); // the size of one blot
    // the edge: a slow wave, rounded bulges where the ink pooled, a little bristle roughness; drawn as smooth curves
    const ph1 = R() * 6.3; const ph2 = R() * 6.3; const f1 = 1.5 + R() * 1.5; const f2 = 9 + R() * 6;
    const edge = [];
    const step = 9; const n = Math.ceil((w + 40) / step);
    let jit = 0;
    for (let i = 0; i <= n; i++) {
      const x = i * step - 20; const t = x / w;
      jit = jit * 0.7 + (R() - 0.5) * hgt * 0.014;
      let y = top + Math.sin(t * Math.PI * f1 + ph1) * hgt * 0.045 - Math.abs(Math.sin(t * Math.PI * f2 + ph2)) * hgt * 0.035 + jit;
      if (R() < 0.04) y += R() * hgt * 0.04; // a dry notch
      edge.push([x, y]);
    }
    const curve = (pts, dy = 0) => {
      let p = `M${r3(pts[0][0])} ${r3(pts[0][1] + dy)}`;
      for (let k = 1; k < pts.length - 1; k++) p += ` Q${r3(pts[k][0])} ${r3(pts[k][1] + dy)} ${r3((pts[k][0] + pts[k + 1][0]) / 2)} ${r3((pts[k][1] + pts[k + 1][1]) / 2 + dy)}`;
      const L = pts[pts.length - 1];
      return `${p} L${r3(L[0])} ${r3(L[1] + dy)}`;
    };
    const edgeLine = curve(edge);
    const d = `M-20 ${hgt + 20} L-20 ${r3(edge[0][1])} ${edgeLine.slice(edgeLine.indexOf(' ') + 1).replace(/^[^QL]*/, '')} L${w + 20} ${hgt + 20} Z`;
    const yAt = (x) => { const k = Math.max(0, Math.min(edge.length - 1, Math.round((x + 20) / step))); return edge[k][1]; };
    const delayAt = (x, extra = 0) => ((x / w) * sweep + extra).toFixed(2);
    // fingers of ink splashed up off the edge (wide at the foot, a round tip), often with a drop just past the tip
    let tongues = '';
    const nt = Math.round(w / 85);
    for (let i = 0; i < nt; i++) {
      const x = R() * w; const y0 = yAt(x) + 3;
      const L = hgt * (0.025 + R() * R() * 0.11) + u * 0.3; const lean = (R() - 0.5) * L * 0.7; const bw = u * (0.22 + R() * 0.3); const tw = bw * (0.32 + R() * 0.2);
      const tx = x + lean; const ty = y0 - L;
      tongues += `<path d="M${r3(x - bw * 1.6)} ${r3(y0)} C${r3(x - bw * 0.6)} ${r3(y0)} ${r3(tx - tw)} ${r3(ty + L * 0.45)} ${r3(tx - tw)} ${r3(ty)} A${r3(tw)} ${r3(tw)} 0 0 1 ${r3(tx + tw)} ${r3(ty)} C${r3(tx + tw)} ${r3(ty + L * 0.45)} ${r3(x + bw * 0.6)} ${r3(y0)} ${r3(x + bw * 1.6)} ${r3(y0)} Z"/>`;
      if (R() < 0.6) tongues += `<circle cx="${r3(tx + lean * 0.2)}" cy="${r3(ty - tw - u * (0.12 + R() * 0.35))}" r="${r3(tw * (0.6 + R() * 0.5))}"/>`;
    }
    // blots: an uneven round splash with droplets thrown out of it and a long drop or two
    const blob = (cx, cy, r) => {
      const k = 18 + Math.floor(R() * 8); const pts = [];
      let wob = 0;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        wob = wob * 0.5 + (R() - 0.5) * 0.35;
        let rr = r * (0.88 + wob);
        if (R() < 0.18) rr = r * (1.25 + R() * 0.45); // a little splash point on the rim
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let p = `M${r3(mid(pts[k - 1], pts[0])[0])} ${r3(mid(pts[k - 1], pts[0])[1])}`;
      for (let i = 0; i < k; i++) { const m = mid(pts[i], pts[(i + 1) % k]); p += ` Q${r3(pts[i][0])} ${r3(pts[i][1])} ${r3(m[0])} ${r3(m[1])}`; }
      return `${p} Z`;
    };
    let splats = '';
    const nb = Math.max(4, Math.round(w / (o.every ?? 110)));
    for (let i = 0; i < nb; i++) {
      const x = ((i + 0.15 + R() * 0.7) / nb) * w; const ey = yAt(x);
      const r = u * (0.35 + R() * R() * 1.1);
      const cy = ey - r * (0.2 + R() * 1.6) - (R() < 0.3 ? hgt * R() * 0.25 : 0);
      const del = delayAt(x, 0.05 + R() * 0.06);
      let sats = '';
      const ns = 4 + Math.floor(R() * 8);
      for (let j = 0; j < ns; j++) {
        const a = -Math.PI * (0.05 + R() * 0.9) + (R() < 0.25 ? Math.PI : 0); // mostly upward and sideways
        const dist = r * (1.25 + R() * R() * 2.6); const sr = r * (0.06 + R() * R() * 0.3);
        const sx = x + Math.cos(a) * dist; const sy = cy + Math.sin(a) * dist;
        const fx = -Math.cos(a) * dist * 0.85; const fy = -Math.sin(a) * dist * 0.85;
        if (R() < 0.3) { // a long drop, stretched the way it flew (an ellipse drawn as two arcs: CSS transforms would undo a rotate())
          const len = sr * (2.2 + R() * 2.5); const deg = (a * 180) / Math.PI; const ca = Math.cos(a) * len; const sa = Math.sin(a) * len;
          const e = `${r3(len)} ${r3(sr * 0.75)} ${r3(deg)} 0 1`;
          sats += `<path class="sat" d="M${r3(sx - ca)} ${r3(sy - sa)} A${e} ${r3(sx + ca)} ${r3(sy + sa)} A${e} ${r3(sx - ca)} ${r3(sy - sa)} Z" style="--fx:${r3(fx)}px;--fy:${r3(fy)}px;animation-delay:${del}s"/>`;
        } else sats += `<circle class="sat" cx="${r3(sx)}" cy="${r3(sy)}" r="${r3(sr)}" style="--fx:${r3(fx)}px;--fy:${r3(fy)}px;animation-delay:${del}s"/>`;
      }
      splats += `<g class="splat-g"><circle class="halo" cx="${r3(x)}" cy="${r3(cy)}" r="${r3(r * 1.25)}" style="animation-delay:${del}s"/><path class="splat" d="${blob(x, cy, r)}" style="animation-delay:${del}s"/>${sats}`
        + `<ellipse class="gloss" cx="${r3(x - r * 0.3)}" cy="${r3(cy - r * 0.32)}" rx="${r3(r * 0.32)}" ry="${r3(r * 0.16)}" transform="rotate(-30 ${r3(x - r * 0.3)} ${r3(cy - r * 0.32)})" style="animation-delay:${del}s"/></g>`;
    }
    // thin streaks flung up and away from the edge, ending in a drop
    let flung = '';
    const nf = Math.round(w / 140);
    for (let i = 0; i < nf; i++) {
      const x = R() * w; const y0 = yAt(x) - 2;
      const a = -Math.PI / 2 + (R() - 0.5) * 1.6; const L = hgt * (0.15 + R() * 0.35);
      const x1 = x + Math.cos(a) * L; const y1 = y0 + Math.sin(a) * L; const wd = 0.6 + R() * u * 0.08;
      const cx = x + Math.cos(a) * L * 0.5 + (R() - 0.5) * L * 0.25; const cy2 = y0 + Math.sin(a) * L * 0.5;
      const del = delayAt(x, 0.08 + R() * 0.1);
      flung += `<path class="fling" pathLength="1" d="M${r3(x)} ${r3(y0)} Q${r3(cx)} ${r3(cy2)} ${r3(x1)} ${r3(y1)}" stroke-width="${r3(wd)}" style="animation-delay:${del}s"/>`
        + `<circle class="fling-dot" cx="${r3(x1)}" cy="${r3(y1)}" r="${r3(wd * (1.3 + R()))}" style="animation-delay:${del}s"/>`;
    }
    // dry-brush streaks inside the band
    let streaks = '';
    for (let i = 0; i < 30; i++) {
      const sy = top + hgt * 0.1 + R() * hgt * 0.55;
      const sx = R() * w; const len = 60 + R() * 260;
      streaks += `<path d="M${r3(sx)} ${r3(sy)} l${r3(len)} ${r3((R() - 0.5) * 6)}" stroke="rgba(255,255,255,${(0.02 + R() * 0.035).toFixed(3)})" stroke-width="${r3(1 + R() * 3)}" />`;
    }
    // the wet shine just inside the edge, in pieces
    let sheen = '';
    for (let k = 1; k < edge.length - 5;) {
      const len = 4 + Math.floor(R() * 12);
      if (R() < 0.55) sheen += `<path d="${curve(edge.slice(k, k + len), 3 + hgt * 0.01)}" stroke-width="${r3(1 + R() * 1.6)}"/>`;
      k += len + Math.floor(R() * 8);
    }
    // spatter: drops thrown up by the brush; they fall back into the band
    let drops = '';
    const nd = Math.round(w / 45);
    for (let i = 0; i < nd; i++) {
      const dx = R() * w; const rr = 1.2 + R() * R() * u * 0.22;
      const dy = top - hgt * (0.12 + R() * 0.6);
      drops += `<circle class="drop" cx="${r3(dx)}" cy="${r3(dy)}" r="${r3(rr)}" style="animation-delay:${delayAt(dx, R() * 0.12)}s;--fall:${r3(top - dy + hgt * 0.15)}px" />`;
    }
    return `<svg xmlns="${SVGNS}" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" class="ink-svg">`
      + `<g class="ink-halo"><path d="${edgeLine}" stroke-width="${r3(u * 1.1)}"/><path d="${edgeLine}" stroke-width="${r3(u * 0.7)}"/><path d="${edgeLine}" stroke-width="${r3(u * 0.35)}"/></g>`
      + `<path d="${d}" class="ink" /><g class="ink-tongues">${tongues}</g>${streaks}<g class="ink-sheen">${sheen}</g>`
      + `<g class="ink-flung">${flung}</g><g class="splats">${splats}</g><g class="drops">${drops}</g></svg>`;
  }

  function mount(root) {
    const stage = document.getElementById('table-stage');
    const talkEl = el('div', 'tv-talk');
    const sides = ['near', 'far'].map((s) => {
      const side = el('div', `talk-side ${s}`);
      const back = el('div', 'talk-back'); // Prototype 27: what stands behind the portraits (the forest's tall trees)
      const cast = el('div', 'talk-cast');
      const ink = el('div', 'talk-ink');
      side.append(back, cast, ink);
      talkEl.append(side);
      return { side, back, cast, ink, nodes: new Map() };
    });
    const handoutEl = el('div', 'tv-handout');
    const hItems = new Map(); // Prototype 26: several handouts at once; path → { el, faces: [{ f, img }], one, data }
    const breakEl = el('div', 'tv-break');
    const dial = Countdown.makeDial('break');
    const brkPic = el('div', 'brk-pic');
    const brkNotes = ['near', 'far'].map((x) => el('div', `brk-note ${x}`));
    breakEl.append(brkPic, el('div', 'brk-veil'), dial.el, ...brkNotes);
    // the session's title
    const titleEl = el('div', 'tv-title');
    const ttlBg = el('div', 'ttl-bg');
    const ttlFaces = ['near', 'far'].map((x) => {
      const f = el('div', `ttl-face ${x}`);
      const name = el('h1', 'ttl-name'); const rule = el('div', 'ttl-rule'); const sub = el('div', 'ttl-sub');
      f.append(name, rule, sub);
      titleEl.append(f);
      return { f, name, sub };
    });
    titleEl.prepend(ttlBg, el('div', 'ttl-veil'));
    // Prototype 1: the players' QR code, one for each long side
    const joinEl = el('div', 'tv-join');
    const jFaces = ['near', 'far'].map((s) => { const f = el('div', `jn-face ${s}`); const card = el('div', 'jn-card'); const qr = el('div', 'jn-qr'); const t = el('div', 'jn-text'); card.append(qr, t); f.append(card); joinEl.append(f); return { f, qr, t }; });
    let joinSig = '';
    function setJoin(j) {
      joinEl.classList.toggle('on', !!j);
      if (!j) { joinSig = ''; return; }
      const sig = `${j.url}|${j.svg.length}`;
      if (sig === joinSig) return;
      joinSig = sig;
      for (const f of jFaces) { f.qr.innerHTML = j.svg; f.t.innerHTML = `<b>Scan to join</b><span>Your phone's camera, then open the link. Same Wi-Fi as the DM's PC.</span><small>${j.url.replace(/[<>&]/g, '')}</small>`; }
    }
    const calibEl = el('div', 'tv-calib'); // Prototype 2
    const initEl = el('div', 'tv-init');
    const ribs = ['near', 'far'].map((s) => { const r = el('div', `init-side ${s}`); const bar = el('div', 'init-rib'); r.append(bar); initEl.append(r); return bar; });
    // a sample of the TV's text and panels while the GM changes their size
    const sampleEl = el('div', 'tv-sample');
    const sDial = Countdown.makeDial('sample');
    sDial.update(0.62, '1:30', 'Sample', '#eadcbc');
    const sRibs = ['near', 'far'].map((s) => {
      const r = el('div', `init-side ${s}`); const bar = el('div', 'init-rib');
      bar.innerHTML = '<span class="rib-round">Round 2</span><span class="rib-name cur">Goblin ×3</span><span class="rib-name">Mira</span><span class="rib-name">Thorin</span>';
      r.append(bar); sampleEl.append(r); return bar;
    });
    const sRounds = ['near', 'far'].map((s) => { const b = el('div', `sample-round ${s}`); b.innerHTML = '<span>Round</span><b>2</b>'; sampleEl.append(b); return b; });
    sampleEl.append(sDial.el);
    root.append(talkEl, handoutEl, breakEl, joinEl, calibEl, initEl, titleEl, sampleEl);

    let talk = null; let talkId = null; let inkKey = '';
    let handout = null; let brk = null; let brkTimer = 0; let brkChimed = null; let brkPicUrl = null;
    let title = null; let titleOut = 0;
    let geom = { W: innerWidth, H: innerHeight, tin: 50 };
    let seats = 'both';
    const stats = { talkIn: 0, inkDrawn: 0 };

    // ---------- talk ----------
    // 4.5: Options → Try: the band of a look, on its own for a moment (not while someone really talks)
    let trying = 0;
    function tryTalk(look, size) {
      if (talk && !trying) return;
      clearTimeout(trying);
      setTalk({ id: `try-${look}`, look, size: size || 0.34, cast: [], blur: 0 });
      trying = setTimeout(() => { trying = 0; if (talk && String(talk.id).startsWith('try-')) setTalk(null); }, 2600);
    }
    function setTalk(t) {
      if (!t) {
        if (talk) {
          talk = null;
          for (const s of sides) for (const [path, n] of s.nodes) { leave(n); s.nodes.delete(path); }
          talkEl.classList.add('leaving');
          setTimeout(() => { if (!talk) { talkEl.classList.remove('on', 'leaving'); for (const s of sides) { s.ink.innerHTML = ''; s.back.innerHTML = ''; } inkKey = ''; } }, 1200);
        }
        return;
      }
      if (t.id !== talkId) { talkId = t.id; inkKey = ''; }
      talk = t;
      talkEl.classList.remove('leaving');
      talkEl.classList.add('on');
      // 4.4: the look (ink, smoke, parchment, embers): its band and how the portraits come and go
      const LOOKS = ['ink', 'smoke', 'parchment', 'embers', 'stone', 'meadow', 'city', 'winter', 'sand', 'dungeon', 'necro', 'forest']; // (Prototype 9: stone, meadow, city; 10: winter, sand; 27: dungeon, necro, forest)
      const look = LOOKS.includes(t.look) ? t.look : 'ink';
      for (const k of LOOKS) talkEl.classList.toggle(`look-${k}`, k === look);
      talkEl.style.setProperty('--talk-h', `${Math.round(t.size * geom.H)}px`);
      drawInk();
      for (const s of sides) {
        const want = new Set(t.cast.map((c) => c.path));
        for (const [path, n] of s.nodes) if (!want.has(path)) { leave(n); s.nodes.delete(path); }
        t.cast.forEach((c) => {
          let n = s.nodes.get(c.path);
          if (!n) {
            n = { wrap: el('div', 'talk-npc'), img: el('img'), c };
            n.img.alt = '';
            n.img.src = c.url;
            n.img.addEventListener('load', () => layout(), { once: true });
            n.wrap.append(n.img);
            s.cast.append(n.wrap);
            s.nodes.set(c.path, n);
            stats.talkIn++;
          }
          n.c = c;
          n.wrap.classList.toggle('opaque', !c.alpha);
          n.img.style.transform = c.mirror ? 'scaleX(-1)' : '';
        });
      }
      layout();
    }
    function leave(n) {
      n.wrap.classList.add('out');
      setTimeout(() => n.wrap.remove(), 900);
    }
    // the newest stands in front at the anchor; earlier ones step back beside it
    function layout() {
      if (!talk) return;
      const H = Math.round(talk.size * geom.H);
      const margin = geom.W * 0.04;
      for (const s of sides) {
        const list = talk.cast.map((c) => s.nodes.get(c.path)).filter(Boolean);
        const hs = list.map((n) => Math.round(H * ((n.c && n.c.scale) || 1))); // (Prototype 12: each one's own size)
        const widths = list.map((n, i) => (n.img.naturalWidth ? (hs[i] * n.img.naturalWidth) / n.img.naturalHeight : hs[i] * 0.8));
        const order = list.map((n, i) => i).reverse(); // front first
        const pos = new Array(list.length);
        // 4.7: where the one speaking stands, anywhere from the left end (0) to the right end (1); the others step back
        // beside them towards the middle of the TV (round them, alternating, when they stand in the middle)
        const at = Number.isFinite(talk.pos) ? talk.pos : { left: 0, center: 0.5, right: 1 }[talk.anchor] ?? 1;
        const fi = order[0]; const wf = fi != null ? widths[fi] : 0;
        const frontLeft = margin + at * Math.max(0, geom.W - 2 * margin - wf);
        if (at > 0.35 && at < 0.65) {
          const mid = frontLeft + wf / 2;
          order.forEach((i, k) => {
            if (k === 0) { pos[i] = mid - widths[i] / 2; return; }
            const side = k % 2 ? -1 : 1;
            const step = Math.ceil(k / 2) * 0.62;
            pos[i] = mid - widths[i] / 2 + side * step * widths[i];
          });
        } else {
          const right = at < 0.5; // standing at the left: the others step back to the right of them
          let edge = right ? frontLeft : frontLeft + wf;
          order.forEach((i, k) => {
            const w = widths[i];
            if (right) { pos[i] = edge; edge += w * 0.6; } else { pos[i] = edge - w; edge -= w * 0.6; }
            if (k === 0) edge += right ? w * 0.05 : -w * 0.05;
          });
        }
        list.forEach((n, i) => {
          const front = i === list.length - 1;
          const off = (n.c && n.c.offset) || { x: 0, y: 0 }; // (Prototype 13: its own offset)
          Object.assign(n.wrap.style, { left: `${Math.round(pos[i])}px`, width: `${Math.round(widths[i])}px`, height: `${hs[i]}px`, zIndex: String(10 + i), translate: off.x || off.y ? `${Math.round(off.x * widths[i])}px ${Math.round(-off.y * hs[i])}px` : '' });
          n.wrap.classList.toggle('back', !front);
        });
        // 4.4: on the parchment banner, the name of the one in front (under them)
        const plate = s.ink.querySelector('.tb-parch-name');
        if (plate) {
          const f = list[list.length - 1];
          const nm = f && f.c && f.c.name ? String(f.c.name).replace(/[_-]+/g, ' ') : '';
          if (plate.textContent !== nm) plate.textContent = nm;
          if (f) plate.style.left = `${Math.round(pos[list.length - 1] + widths[list.length - 1] / 2)}px`;
          plate.hidden = !nm;
        }
      }
    }
    function drawInk() {
      const look = talk && ['smoke', 'parchment', 'embers', 'stone', 'meadow', 'city', 'winter', 'sand', 'dungeon', 'necro', 'forest'].includes(talk.look) ? talk.look : 'ink';
      const hgt = Math.round(geom.H * ({ parchment: 0.1, city: 0.1, ink: 0.14, stone: 0.13, meadow: 0.22, winter: 0.17, sand: 0.15, dungeon: 0.12, necro: 0.16, forest: 0.24 }[look] || 0.2));
      const key = `${talkId}|${geom.W}x${hgt}|${look}|${document.body.dataset.vTalk || ''}`; // (Prototype 9: Autumn's leaves differ)
      if (key === inkKey) return;
      inkKey = key;
      const seed = [...String(talkId)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      const svg = look === 'ink' ? inkBand(geom.W, hgt, seed, { sweep: 0.45, unit: 0.1, every: 95 }) : Looks.talkBand(look, geom.W, hgt, seed);
      for (const s of sides) {
        s.ink.innerHTML = svg;
        s.back.innerHTML = Looks.talkBack(look, geom.W, Math.round((talk ? talk.size : 0.4) * geom.H * 1.45), seed) || '';
        s.back.classList.remove('in'); void s.back.offsetWidth; s.back.classList.add('in');
        s.ink.style.height = `${hgt}px`;
        s.ink.classList.remove('in'); void s.ink.offsetWidth; s.ink.classList.add('in');
      }
      stats.inkDrawn++;
    }

    // ---------- handouts ----------
    // Beta 3.6: up to ten at once, each one copy lying as its layout says: x, y (its middle, from the TV's top left),
    // size (its longer side as a part of the TV's short side) and rot (any angle). The last in the list lies on top.
    // A handout burns in out of glowing embers and burns away from its edges inward, in the table style's colour
    // (burnHandout). While the GM drags one in the Handout table, its place comes as a small message (moveHandout).
    function setHandouts(list) {
      list = list || [];
      const keep = new Set(list.map((h) => h.path));
      for (const [p, it] of hItems) if (!keep.has(p) && !it.leaving) burnAway(it);
      list.forEach((hd, i) => {
        let it = hItems.get(hd.path);
        if (it && it.leaving) { dropHandout(it); it = null; } // (shown again while it still burnt away)
        if (!it) {
          const box = el('div', 'ho-item');
          const f = el('div', 'ho-one'); const img = el('img'); img.alt = ''; img.draggable = false;
          f.append(img); box.append(f);
          it = { path: hd.path, el: box, f, img, faces: [{ f, img }], data: hd, shown: false };
          hItems.set(hd.path, it);
          handoutEl.append(box);
          const born = it;
          img.onload = () => { placeOne(born); if (!born.shown && !born.leaving) { born.shown = true; burnHandout(born, true); } };
          img.src = hd.url;
        }
        it.data = hd;
        it.el.style.zIndex = String(i + 1);
      });
      handout = list.length ? list[list.length - 1] : null;
      handoutEl.classList.toggle('on', hItems.size > 0);
      placeHandouts();
    }
    function dropHandout(it) {
      if (it.stop) it.stop();
      it.el.remove();
      if (hItems.get(it.path) === it) hItems.delete(it.path);
      handoutEl.classList.toggle('on', hItems.size > 0);
    }
    function burnAway(it) {
      it.leaving = true;
      if (!it.shown || !it.img.naturalWidth) { dropHandout(it); return; } // (never seen: nothing to burn)
      burnHandout(it, false, () => dropHandout(it));
    }
    function placeOne(it) {
      const d = it.data;
      if (!d) return;
      const W = handoutEl.clientWidth || window.innerWidth; const H = handoutEl.clientHeight || window.innerHeight;
      const L = (d.size || 0.7) * Math.min(W, H);
      const a = it.img.naturalWidth && it.img.naturalHeight ? it.img.naturalWidth / it.img.naturalHeight : 1;
      const w = a >= 1 ? L : L * a; const h = a >= 1 ? L / a : L;
      it.w = w; it.h = h;
      it.img.style.width = `${w}px`; it.img.style.height = `${h}px`;
      it.f.style.left = `${(d.x ?? 0.5) * 100}%`; it.f.style.top = `${(d.y ?? 0.5) * 100}%`;
      it.f.style.transform = `translate(-50%, -50%) rotate(${d.rot || 0}deg)`;
      if (it.fit) it.fit();
    }
    function placeHandouts() { for (const it of hItems.values()) placeOne(it); }
    function moveHandout(e) {
      const it = hItems.get(e.path);
      if (!it || it.leaving || !e.lay) return;
      it.data = { ...it.data, ...e.lay };
      placeOne(it);
    }
    window.addEventListener('resize', placeHandouts);

    // the fire's colours for each table style: [the hot front, the glow behind it]
    const BURN = {
      ink: ['#f2f2ff', '#8d8da6'], blood: ['#ffb0a0', '#d0202a'], smoke: ['#ffffff', '#b9bcc4'], arcane: ['#ecd8ff', '#9a5cf0'],
      parchment: ['#fff0c8', '#e8a84a'], old: ['#f6dca0', '#b98236'], embers: ['#ffe696', '#ff7a1e'], witchfire: ['#dff2ff', '#46a8ff'],
      stone: ['#fff1d8', '#c9a878'], ice: ['#f2fcff', '#7fd4ff'], meadow: ['#f0ffc0', '#9fd84a'], autumn: ['#ffe0a0', '#f0822a'],
      city: ['#fff0b0', '#e0a830'], slums: ['#ffd9a8', '#b8763a'], winter: ['#ffffff', '#bfe0ff'], christmas: ['#fff2c0', '#ff5a3c'],
      sand: ['#fff2c0', '#f0b850'], ash: ['#ffd9b0', '#ff5a22'], dungeon: ['#ffe2b0', '#ff9c40'], necro: ['#e2ffd8', '#58f06a'],
      bloodcrypt: ['#ffc0b0', '#ff3030'], forest: ['#e8ffc0', '#7fd04a'], jungle: ['#d8ffd0', '#2fe86a'],
    };
    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    let burnStyle = 'ink';
    const BURN_MS = 1000; const BURN_TAIL = 380; // the fire, then the last sparks

    // A handout burning in (it forms from its middle out of glowing embers) or away (from its edges inward).
    // A low burn map says when the fire reaches each spot (the edges first, with noise so the front is ragged); every
    // frame the picture is drawn, cut where it is burnt, charred just ahead of the front, and the front glows.
    function burnHandout(it, into, done) {
      if (it.stop) it.stop();
      const [hot, glow] = (BURN[burnStyle] || BURN.ink).map(rgb);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cv = el('canvas', 'ho-burn');
      const g = cv.getContext('2d');
      let w = 0; let h = 0; let pad = 0; let k = 1;
      it.fit = () => { // (its size may change while it burns: dragged, or the window resized)
        w = Math.max(8, it.w || 8); h = Math.max(8, it.h || 8); pad = Math.round(Math.max(w, h) * 0.09);
        k = Math.min(dpr, 1200 / Math.max(w, h));
        cv.width = Math.round((w + pad * 2) * k); cv.height = Math.round((h + pad * 2) * k);
        Object.assign(cv.style, { width: `${w + pad * 2}px`, height: `${h + pad * 2}px`, left: `${-pad}px`, top: `${-pad}px` });
      };
      it.fit();
      // the burn map
      const mw = w >= h ? 112 : Math.max(24, Math.round((112 * w) / h)); const mh = w >= h ? Math.max(24, Math.round((112 * h) / w)) : 112;
      let seed = 1 + Math.floor(Math.random() * 1e6);
      const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const grids = [5, 11, 23].map((n) => { const a = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < a.length; i++) a[i] = R(); return { n, a }; });
      const noise = (x, y) => {
        let v = 0; let ws = 0; let wt = 1;
        for (const { n, a } of grids) {
          const fx = x * n; const fy = y * n; const ix = Math.floor(fx); const iy = Math.floor(fy); const tx = fx - ix; const ty = fy - iy;
          const at = (i, j) => a[Math.min(n, j) * (n + 1) + Math.min(n, i)];
          const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
          const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx; const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
          v += (top + (bot - top) * sy) * wt; ws += wt; wt *= 0.5;
        }
        return v / ws;
      };
      const T = new Float32Array(mw * mh);
      const half = Math.min(mw, mh) / 2;
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
        const edge = Math.min(1, Math.min(i + 0.5, mw - i - 0.5, j + 0.5, mh - j - 0.5) / half); // 0 at the edge, 1 in the middle
        T[j * mw + i] = Math.min(1, Math.max(0, edge * 0.7 + noise(i / mw, j / mh) * 0.42 - 0.08));
      }
      const layer = () => { const c = document.createElement('canvas'); c.width = mw; c.height = mh; const x = c.getContext('2d'); return { c, x, d: x.createImageData(mw, mh) }; };
      const cut = layer(); const fire = layer();
      const EDGE = 0.05; const COOL = 0.2; const CHAR = 0.1;
      const sparks = [];
      const t0 = performance.now(); let last = t0; let raf = 0; let over = false; let swapped = false;
      it.img.style.visibility = 'hidden';
      it.f.append(cv);
      it.f.classList.add('burning');
      const end = () => {
        if (over) return;
        over = true;
        cancelAnimationFrame(raf);
        cv.remove();
        it.f.classList.remove('burning');
        it.stop = null; it.fit = null;
        if (into) it.img.style.visibility = '';
      };
      it.stop = end;
      const frame = (now) => {
        if (over) return;
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        const t = (now - t0) / BURN_MS;
        const p = Math.min(1, t);
        // burning away: the front runs from the edges (T small) inward; burning in is the same film backwards
        const P = (into ? 1 - p : p) * (1 + COOL + 0.02) - 0.01;
        const C = cut.d.data; const F = fire.d.data;
        for (let q = 0, i = 0; i < T.length; i++, q += 4) {
          const e = P - T[i]; // how long ago the fire reached this spot (below 0: not yet)
          let a = 0; let r = 0; let gg = 0; let b = 0; let fa = 0;
          if (e < 0) {
            a = 255;
            if (e > -CHAR) { const c = 1 + e / CHAR; r = 12; gg = 8; b = 6; fa = c * c * 215; } // charred just ahead of the fire
          } else if (e < EDGE) {
            const c = e / EDGE; r = hot[0] + (glow[0] - hot[0]) * c; gg = hot[1] + (glow[1] - hot[1]) * c; b = hot[2] + (glow[2] - hot[2]) * c; fa = 255;
            if (p < 1 && sparks.length < 90 && R() < 0.02) {
              const x = pad + ((i % mw) + R()) / mw * w; const y = pad + (Math.floor(i / mw) + R()) / mh * h;
              const ox = x - (pad + w / 2); const oy = y - (pad + h / 2); const ol = Math.hypot(ox, oy) || 1; const out = into ? -0.4 : 1;
              sparks.push({ x, y, vx: (ox / ol) * out * (20 + R() * 70) + (R() - 0.5) * 50, vy: (oy / ol) * out * (20 + R() * 70) + (R() - 0.5) * 50, life: 0.25 + R() * 0.5, age: 0, r: 0.8 + R() * 1.8 });
            }
          } else if (e < COOL) {
            const c = (e - EDGE) / (COOL - EDGE); r = glow[0] * (1 - c * 0.7); gg = glow[1] * (1 - c * 0.7); b = glow[2] * (1 - c * 0.7); fa = 255 * (1 - c) * (1 - c);
          }
          C[q] = 0; C[q + 1] = 0; C[q + 2] = 0; C[q + 3] = a;
          F[q] = r; F[q + 1] = gg; F[q + 2] = b; F[q + 3] = fa;
        }
        cut.x.putImageData(cut.d, 0, 0); fire.x.putImageData(fire.d, 0, 0);
        g.setTransform(k, 0, 0, k, 0, 0);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
        g.clearRect(0, 0, w + pad * 2, h + pad * 2);
        g.imageSmoothingEnabled = true;
        if (!swapped) {
          g.drawImage(it.img, pad, pad, w, h);
          g.globalCompositeOperation = 'destination-in'; g.drawImage(cut.c, pad, pad, w, h); // what has not burnt yet
          g.globalCompositeOperation = 'source-atop'; g.drawImage(fire.c, pad, pad, w, h); // charred ahead of the front
          g.globalCompositeOperation = 'lighter';
          g.drawImage(fire.c, pad, pad, w, h);
          g.filter = `blur(${Math.max(3, Math.round(Math.max(w, h) * 0.018))}px)`; g.globalAlpha = 0.8; g.drawImage(fire.c, pad, pad, w, h); // the glow
          g.filter = 'none'; g.globalAlpha = 1;
        }
        g.globalCompositeOperation = 'lighter';
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]; s.age += dt;
          if (s.age >= s.life) { sparks.splice(i, 1); continue; }
          s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.97; s.vy *= 0.97;
          const c = 1 - s.age / s.life;
          g.fillStyle = `rgba(${hot[0]}, ${hot[1]}, ${hot[2]}, ${(c * 0.95).toFixed(3)})`;
          g.beginPath(); g.arc(s.x, s.y, s.r * (0.5 + c * 0.5) * Math.max(1, w / 420), 0, 6.283); g.fill();
        }
        if (p >= 1 && !swapped) { swapped = true; if (into) it.img.style.visibility = ''; }
        if (t >= 1 + BURN_TAIL / BURN_MS || (p >= 1 && !sparks.length)) { end(); if (done) done(); return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    // ---------- break ----------
    function setBreak(b) {
      brk = b;
      breakEl.classList.toggle('on', !!b);
      clearInterval(brkTimer); brkTimer = 0;
      if (!b) return;
      const look = b.look || { label: 'Break', text: '', bg: 'map', pic: null };
      breakEl.dataset.bg = look.bg;
      const url = look.bg === 'picture' && look.pic ? look.pic.url : null;
      if (url !== brkPicUrl) { brkPicUrl = url; brkPic.replaceChildren(...(url ? [media(look.pic)] : [])); }
      for (const n of brkNotes) n.textContent = look.text || '';
      const tick = () => {
        if (!brk) return;
        const ms = Math.max(0, brk.endsAt - Date.now());
        const secs = Math.ceil(ms / 1000);
        dial.update(secs > 0 ? ms / 1000 / brk.total : 0, secs > 0 ? Countdown.clock(secs) : 'Time', look.label || 'Break', secs > 0 ? '#eadcbc' : '#e3963e');
        if (secs === 0 && brkChimed !== brk.id) { brkChimed = brk.id; Countdown.chime(0.6); }
      };
      tick();
      brkTimer = setInterval(tick, 250);
    }

    // a picture or a looping, silent video, filling the screen
    function media(pic) {
      if (pic.kind === 'video') { const v = el('video'); v.src = pic.url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.play().catch(() => {}); return v; }
      const i = el('img'); i.alt = ''; i.src = pic.url; if (pic.builtin) i.classList.add('fit'); return i;
    }

    // ---------- the session's title ----------
    function setTitle(t) {
      if (!t) {
        if (title) {
          title = null;
          titleEl.classList.add('leaving');
          clearTimeout(titleOut);
          titleOut = setTimeout(() => { if (!title) { titleEl.classList.remove('on', 'leaving'); ttlBg.innerHTML = ''; } }, 1300);
        }
        return;
      }
      const fresh = !title || title.id !== t.id;
      const picChanged = !title || (title.pic && title.pic.url) !== (t.pic && t.pic.url);
      title = t;
      clearTimeout(titleOut);
      titleEl.classList.remove('leaving');
      if (picChanged) ttlBg.replaceChildren(...(t.pic ? [media(t.pic)] : []));
      titleEl.classList.toggle('has-pic', !!t.pic);
      for (const f of ttlFaces) { f.name.textContent = t.title; f.sub.textContent = t.sub || ''; f.sub.hidden = !t.sub; }
      if (fresh) { titleEl.classList.remove('on'); void titleEl.offsetWidth; }
      titleEl.classList.add('on');
    }

    // ---------- initiative ribbon ----------
    let initSig = '';
    // Prototype 7: Options → Looks → Try: a sample turn order for a moment (the real one already shows the look)
    let tryingInit = 0; let lastInit = [null, null];
    function tryInit() {
      if (initEl.classList.contains('on') && !tryingInit) return;
      clearTimeout(tryingInit);
      setInit({ list: [{ name: 'Mira', cur: true, pc: true }, { name: 'Goblin' }, { name: 'Thorin', pc: true }, { name: 'Ogre' }, { name: 'Sela', pc: true }] }, 2);
      tryingInit = setTimeout(() => { tryingInit = 0; setInit(lastInit[0], lastInit[1]); }, 3500);
    }
    function setInit(I, round) {
      const on = !!(I && I.list.length);
      initEl.classList.toggle('on', on);
      if (!on) { initSig = ''; return; }
      const sig = JSON.stringify([I.list, round]);
      if (sig === initSig) return;
      initSig = sig;
      const cur = Math.max(0, I.list.findIndex((e) => e.cur));
      const order = [...I.list.slice(cur), ...I.list.slice(0, cur)];
      for (const bar of ribs) {
        bar.innerHTML = '';
        if (round != null) { const r = el('span', 'rib-round'); r.textContent = `Round ${round}`; bar.append(r); }
        order.forEach((e) => {
          const s = el('span', `rib-name ${e.cur ? 'cur' : ''} ${e.pc ? 'pc' : ''}`);
          s.textContent = e.name;
          bar.append(s);
        });
      }
    }

    // ---------- everything at once, from the table state ----------
    function set(s, view) {
      seats = s.seats === 'one' ? 'one' : 'both';
      root.classList.toggle('one-side', seats === 'one');
      if (view) {
        const k = Math.min(innerWidth / view.world.w, innerHeight / view.world.h);
        geom = { W: innerWidth, H: innerHeight, tin: view.ppi * k };
        root.style.setProperty('--tin', `${geom.tin}px`);
      }
      root.style.setProperty('--hud', String(s.hud || 1));
      sampleEl.classList.toggle('on', !!s.hudSample);
      document.body.classList.toggle('hud-sampling', !!s.hudSample);
      for (const b of sRounds) b.style.fontSize = `${Math.round(geom.tin * 0.55 * (s.hud || 1) * 100) / 100}px`;
      if (!(trying && !s.talk)) { if (s.talk) trying = 0; setTalk(s.talk || null); }
      burnStyle = s.handoutStyle || 'ink';
      setHandouts(s.handouts || (s.handout ? [s.handout] : []));
      setJoin(s.join || null);
      calibEl.classList.toggle('on', !!s.calib);
      setBreak(s.brk || null);
      setTitle(s.title || null);
      const live = s.live;
      // 4.6.3: the round in the turn order unless Options → Looks puts it only on the badge (or nowhere), or the players don't see it
      const rm = (s.roundLook && s.roundLook.mode) || 'auto';
      lastInit = [s.init, live && live.round && live.round.show !== false && ['auto', 'both', 'order'].includes(rm) ? live.round.n : null];
      if (!tryingInit) setInit(lastInit[0], lastInit[1]);
      root.classList.toggle('talk-on', !!s.talk);
      // the map softens behind talk, handouts and the break screen
      const soft = s.brk ? { blur: 10, dim: s.brk.look && s.brk.look.bg !== 'map' ? 0.2 : 0.45 } : s.handout ? { blur: 6, dim: 0.6 } : s.join ? { blur: 4, dim: 0.5 } : s.talk ? { blur: 1 + 7 * (s.talk.blur ?? 0.5), dim: 1 - 0.3 * (s.talk.blur ?? 0.5) } : null;
      stage.classList.toggle('soft', !!soft);
      if (soft) {
        const k = geom.tin / 50;
        stage.style.setProperty('--soft-blur', `${r3(soft.blur * k)}px`);
        stage.style.setProperty('--soft-dim', String(soft.dim));
      }
    }
    addEventListener('resize', () => { geom.W = innerWidth; geom.H = innerHeight; if (talk) { drawInk(); layout(); } });

    function debug() {
      const vis = (x) => getComputedStyle(x).display !== 'none' && getComputedStyle(x).visibility !== 'hidden';
      return {
        talk: talk ? {
          sides: sides.filter((s) => vis(s.side)).length, npcs: sides[0].cast.querySelectorAll('.talk-npc:not(.out)').length,
          front: (() => { const f = [...sides[0].cast.querySelectorAll('.talk-npc:not(.out):not(.back)')][0]; return f ? f.querySelector('img').src.split('/').pop() : null; })(),
          ink: !!sides[0].ink.querySelector('.ink'), drops: sides[0].ink.querySelectorAll('.drop').length, opaque: sides[0].cast.querySelectorAll('.talk-npc.opaque').length,
          mirrored: sides[0].cast.querySelectorAll('.talk-npc img[style*="scaleX(-1)"]').length,
        } : null,
        handout: handout ? (() => { const all = [...hItems.values()].filter((it) => !it.leaving); return { name: handout.name, count: all.length, faces: all.filter((it) => vis(it.f)).length, loaded: !!all.length && all[0].img.complete && all[0].img.naturalWidth > 0, burning: [...hItems.values()].filter((it) => it.stop).length, style: burnStyle }; })() : null,
        brk: brk ? { text: dial.el.querySelector('.tt-time').textContent, faces: [...dial.el.querySelectorAll('.tt-face')].filter(vis).length,
          label: dial.el.querySelector('.tt-label').textContent, note: brkNotes[0].textContent, bg: breakEl.dataset.bg, pic: !!brkPic.firstChild } : null,
        title: title ? { title: ttlFaces[0].name.textContent, sub: ttlFaces[0].sub.textContent, faces: ttlFaces.filter((f) => vis(f.f)).length, pic: !!ttlBg.firstChild, shown: vis(titleEl) } : null,
        init: initEl.classList.contains('on') ? { near: ribs[0].textContent, far: vis(ribs[1].parentNode) } : null,
        sample: sampleEl.classList.contains('on') ? { dial: Math.round(sDial.el.getBoundingClientRect().width), rib: Math.round(parseFloat(getComputedStyle(sRibs[0]).fontSize)), sides: [...sampleEl.querySelectorAll('.init-side')].filter(vis).length } : null,
        soft: stage.classList.contains('soft') ? stage.style.getPropertyValue('--soft-blur') : null,
        ...stats,
      };
    }
    return { set, debug, tryTalk, tryInit, moveHandout };
  }

  return { mount, inkBand };
})();
