// Running the show:
//   Moments  screen effects over the whole TV (moments.js) as pads (I8): Starred (Shift + 1 to 9), Once, Until stopped;
//            a click plays one, a drag onto the map plays it there, a right-click sets it up; each plays a sound
//            (one you pick, one from Audio/SFX with a fitting name, or the built-in one).
//   Cues     (before 2.1) a scene saved to play again; snapshots.js took their place, old ones still play.
// gm-play.js opens the panels as floating windows (float-panels.js).
'use strict';

const ShowTools = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const ts = window.ts;

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    let lib = []; let libAt = 0;
    async function loadLib(force) {
      if (!force && Date.now() - libAt < 5000) return;
      libAt = Date.now();
      try { lib = await ts.library('list'); } catch { lib = []; }
      ctx.refresh();
    }
    const soundboard = () => lib.filter((x) => x.cat === 'sounds' && (/^Audio\/SFX\//i.test(x.rel) || /\bsfx\b/i.test(x.rel)));

    // =====================================================================
    // Moments: I8 (Glinn) pads. Starred, Once, Until stopped; each pad a small picture of its effect (it moves while
    // the mouse is on it); a click plays it over the whole table, a drag onto the map plays it there; a right-click
    // sets it up (Strength, Colour, Stays / Comes in, its sound and that sound's volume)
    // =====================================================================
    const stars = () => (S().settings && S().settings.momentStars) || [];
    const looks = () => (S().settings && S().settings.momentLook) || {};
    const playing = (id) => (S().moments || []).find((m) => m.id === id && !m.stop && Moments.alive(m, Date.now()));
    const starredList = () => stars().map((id) => Moments.BY[id]).filter(Boolean);
    async function play(id, at) {
      const d = Moments.BY[id];
      if (!d) return null;
      const r = await cmd('moment.play', { id, x: at ? at.x : null, y: at ? at.y : null, mapId: at ? at.mapId : undefined });
      if (r && r.ok) {
        if (r.closed) toast(`${d.label}: the table is closed, so only you see it`, { ms: 3000 });
        else if (r.label) toast(r.label, { ms: 2200 });
      }
      return r;
    }
    function setStar(id, on) {
      const list = stars().filter((x) => x !== id);
      if (on) list.push(id);
      ts.settings({ momentStars: list });
    }
    function soundMenu(d, x, y) {
      const snd = (S().settings.momentSounds || {})[d.id] || {};
      openMenu(x, y, [
        { header: `Sound for ${d.label}: ${snd.name || 'Built-in'}` },
        { icon: 'folder', label: 'Choose a sound from the library …', action: () => ctx.Drawer.open({ cat: 'sounds', purpose: `moment:${d.id}`, back: { panel: 'moments' } }) },
        { icon: 'wand', label: d.id === 'lightning' ? 'Thunder (or a fitting sound from Audio/SFX)' : 'Automatic: a fitting sound from Audio/SFX, else the built-in one', checked: !snd.own && !snd.none, action: () => ts.settings({ momentSound: { id: d.id, path: null } }) },
        { icon: 'volume-off', label: 'No sound', checked: !!snd.none, action: () => ts.settings({ momentSound: { id: d.id, path: 'none' } }) },
      ]);
    }

    // ---------- a pad's picture: the effect itself, drawn small over a stone floor ----------
    const THUMB_AGE = { earthquake: 1.4, explosion: 0.32, blood: 1.2, gas: 3.5, lightning: 0.12, roar: 0.7, dread: 3, frost: 4.5, holy: 1.6, madness: 3.5, timestop: 1.1, nat20: 0.75, teleport: 0.55, puff: 0.7, lightsout: 1.8, rockfall: 1.15, flood: 2.4, birds: 0.55, bats: 0.9 };
    const floorImg = (() => { let im = null; return () => { if (!im) { im = new Image(); im.src = 'tiles/old_cobblestone-small.webp'; } return im.complete && im.naturalWidth ? im : null; }; })();
    function paintThumb(cv, d, age) {
      // (one over the whole table: a table of 19 inches, its edges show; one at a spot: closer in, the spot fills the pad)
      const g = cv.getContext('2d'); const TW = d.spot ? 9.6 : 19.2; const TH = TW * 0.5625; const SQ = d.spot ? 1.6 : 1.8; const kk = cv.width / TW; const now = Date.now();
      const look = looks()[d.id] || null;
      const m = { key: `thumb-${d.id}`, id: d.id, seed: 11, x: d.spot ? TW / 2 : null, y: d.spot ? TH / 2 : null, t0: now - age * 1000, dur: d.dur ? d.dur * ((look && look.len) || 1) : null, stop: null, ...(look ? { o: look } : {}) };
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const sc = Moments.screen([m], now);
      g.filter = sc.filter || 'none';
      const fl = floorImg();
      if (fl) { g.drawImage(fl, 0, 0, fl.naturalWidth, fl.naturalWidth * (TH / TW), 0, 0, cv.width, cv.height); g.fillStyle = 'rgba(10,9,8,0.35)'; g.fillRect(0, 0, cv.width, cv.height); }
      else { g.fillStyle = '#2b2722'; g.fillRect(0, 0, cv.width, cv.height); }
      g.filter = 'none';
      g.setTransform(kk, 0, 0, kk, 0, 0);
      try {
        if (d.id === 'lightning') { if (typeof FX === 'object' && FX.strike) FX.strike(g, TW, TH, age, 3); }
        else {
          if (typeof Creatures === 'object') Creatures.scene({ dark: 0, cell: SQ });
          if (d.id === 'lightsout') { // two flames dying, for the smoke to rise from
            for (const [fx, fy] of [[0.3, 0.45], [0.72, 0.6]]) { const gl = g.createRadialGradient(TW * fx, TH * fy, 0, TW * fx, TH * fy, 1.6); gl.addColorStop(0, `rgba(255,190,90,${Math.max(0, 0.7 - age * 0.35).toFixed(3)})`); gl.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = gl; g.beginPath(); g.arc(TW * fx, TH * fy, 1.6, 0, Math.PI * 2); g.fill(); }
          }
          Moments.draw(g, TW, TH, [m], now, (q) => ({ x: q.x, y: q.y }), { sq: SQ, lights: () => [{ x: TW * 0.3, y: TH * 0.45 }, { x: TW * 0.72, y: TH * 0.6 }] });
          if (typeof Creatures === 'object') Creatures.scene(null);
        }
      } catch { /* a picture still on its way: the next paint has it */ }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    }
    // still pictures are painted again a few times while the pictures they use come in
    function paintStill(cv, d) {
      paintThumb(cv, d, THUMB_AGE[d.id] || 1);
      let n = 0; const again = () => { if (!cv.isConnected || ++n > 3) return; paintThumb(cv, d, THUMB_AGE[d.id] || 1); setTimeout(again, 900); };
      setTimeout(again, 600);
    }
    // the pad under the mouse moves: its effect plays in a loop
    let moving = null;
    function startMoving(cv, d) {
      stopMoving();
      const loop = d.dur ? Math.min(6, (d.dur / 1000) * ((looks()[d.id] || {}).len || 1)) : 6;
      const t0 = performance.now();
      const step = () => {
        if (!moving || moving.cv !== cv || !cv.isConnected) return;
        paintThumb(cv, d, (((performance.now() - t0) / 1000) % loop) + 0.05);
        moving.raf = requestAnimationFrame(step);
      };
      moving = { cv, d, raf: requestAnimationFrame(step) };
    }
    function stopMoving() {
      if (!moving) return;
      cancelAnimationFrame(moving.raf);
      const { cv, d } = moving; moving = null;
      if (cv.isConnected) paintThumb(cv, d, THUMB_AGE[d.id] || 1);
    }

    // ---------- a pad ----------
    function momentPad(d, key) {
      const cv = h('canvas', { class: 'pad-pv', width: 192, height: 108 });
      const el = h('div', { class: 'pad mo-pad', role: 'button', tabindex: '0', dataset: { id: d.id, flash: `moment:${d.id}` }, 'data-tip': `${d.label}: ${d.tip}${d.dur ? '' : '. Click again to stop it'}${d.spot ? '. Drag it onto the map to play it there' : ''}`, 'aria-label': d.label,
        onclick: () => play(d.id), onkeydown: (e) => { if (e.key === 'Enter') play(d.id); } },
      cv, key ? h('span', { class: 'pad-k' }, key) : null, d.spot ? h('span', { class: 'pad-sp' }, iconEl('target')) : null,
      h('b', {}, d.label), h('span', { class: 'pad-prog' }), h('span', { class: 'pad-dot' }));
      el.addEventListener('mouseenter', () => startMoving(cv, d));
      el.addEventListener('mouseleave', stopMoving);
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); openSheet(d, el); });
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ts-moment', d.id); document.body.classList.add('dragging-moment'); document.body.dataset.momentDrag = d.id; stopMoving(); });
      el.addEventListener('dragend', () => { document.body.classList.remove('dragging-moment'); delete document.body.dataset.momentDrag; ctx.momentAim && ctx.momentAim(null); });
      paintStill(cv, d);
      return Hotbar.offer(el, { kind: 'moment', ref: d.id, label: d.label, icon: d.icon }, { menu: false });
    }
    // what plays shows on the pads: a burst's bar runs out, a lasting one glows
    function tickPads(list) {
      const step = () => {
        if (!list.isConnected) return;
        const now = Date.now();
        for (const el of list.querySelectorAll('.mo-pad')) {
          const m = (S().moments || []).filter((x) => x.id === el.dataset.id && !x.stop && Moments.alive(x, now)).pop();
          const d = Moments.BY[el.dataset.id];
          el.classList.toggle('on', !!m && !d.dur);
          const bar = el.querySelector('.pad-prog');
          const u = m && m.dur ? 1 - (now - m.t0) / m.dur : 0;
          bar.style.width = `${Math.max(0, Math.min(1, u)) * 100}%`;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    function buildMoments() {
      loadLib();
      const list = h('div', { class: 'mo-pads' });
      c().bind(() => {
        const s = S();
        const st = stars();
        const sig = JSON.stringify([st, s.settings && s.settings.momentLook]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        stopMoving();
        list.innerHTML = '';
        const sec = (title, ds, keyed) => {
          if (!ds.length) return;
          list.append(h('div', { class: 'tok-group' }, title), h('div', { class: 'pads' }, ...ds.map((d, i) => momentPad(d, keyed && i < 9 ? `⇧${i + 1}` : null))));
        };
        sec('Starred', starredList(), true);
        sec('Once', Moments.LIST.filter((d) => d.dur && !st.includes(d.id)));
        sec('Until stopped', Moments.LIST.filter((d) => !d.dur && !st.includes(d.id)));
      });
      tickPads(list);
      const stopAll = Hotbar.offer(c().btn('Stop all', 'player-stop', () => cmd('moment.stop', {}), { tip: 'Stop the screen effects that are on (gas, dread, frost …)' }), ctx.doHot('stop-moments'));
      const count = h('span', { class: 'n' });
      stopAll.append(count);
      c().bind(() => { const n = (S().moments || []).filter((m) => !m.stop && !(Moments.BY[m.id] || {}).dur).length; stopAll.disabled = !(S().moments || []).some((m) => !m.stop); count.textContent = n ? `${n} on` : ''; });
      return h('div', { class: 'stack' }, list, c().row(stopAll));
    }

    // ---------- a pad's sheet (right-click): how it looks, its sound ----------
    let sheet = null;
    function closeSheet() { if (sheet) { sheet.el.remove(); sheet = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); } }
    const outside = (e) => { if (sheet && !sheet.el.contains(e.target) && !e.target.closest('#menu')) closeSheet(); };
    const onKey = (e) => { if (e.key === 'Escape' && sheet) { e.stopPropagation(); closeSheet(); } };
    function openSheet(d, pad) {
      closeSheet();
      const el = h('div', { class: 'pad-sheet', role: 'dialog', 'aria-label': `${d.label}: how it looks` });
      document.body.append(el);
      sheet = { el, d, pad };
      fillSheet();
      const r = pad.getBoundingClientRect(); const sw = el.offsetWidth; const sh = el.offsetHeight;
      const x = r.right + 8 + sw < window.innerWidth ? r.right + 8 : Math.max(8, r.left - sw - 8);
      el.style.left = `${x}px`; el.style.top = `${Math.max(8, Math.min(window.innerHeight - sh - 8, r.top))}px`;
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }
    function fillSheet() {
      if (!sheet) return;
      const { el, d } = sheet;
      const look = looks()[d.id] || {};
      const set = (patch) => { const next = { ...look, ...patch }; ts.settings({ momentLook: { id: d.id, look: next } }); setTimeout(fillSheet, 60); };
      const segRow = (label, opts, cur, key) => h('div', { class: 'ps-row' }, h('label', {}, label), h('div', { class: 'seg' }, ...opts.map(([v, t]) => h('button', { class: `seg-btn ${Math.abs((cur ?? 1) - v) < 0.01 ? 'on' : ''}`, onclick: () => set({ [key]: v }) }, h('span', {}, t)))));
      const starOn = stars().includes(d.id); const si = stars().indexOf(d.id);
      const snd = (S().settings.momentSounds || {})[d.id] || {};
      const cv = h('canvas', { class: 'ps-pv', width: 96, height: 54 });
      const body = h('div', { class: 'ps-body' });
      if (d.id !== 'lightning') body.append(segRow('Strength', [[0.6, 'Light'], [1, 'Normal'], [1.6, 'Strong']], look.str, 'str'));
      if (d.cols) body.append(h('div', { class: 'ps-row' }, h('label', {}, 'Colour'), h('div', { class: 'ps-sw' }, ...d.cols.map((col, i) => h('button', { class: `${(look.col || d.cols[0]) === col ? 'on' : ''}`, style: `background:${col}`, 'aria-label': UI.colourName(col), 'data-tip': UI.colourName(col), onclick: () => set({ col: i ? col : null }) })))));
      if (d.id !== 'lightning') body.append(d.dur ? segRow('Stays', [[0.6, 'Short'], [1, 'Normal'], [1.6, 'Long']], look.len, 'len') : segRow('Comes in', [[2, 'Slowly'], [1, 'Normal'], [0.2, 'At once']], look.len, 'len'));
      body.append(h('div', { class: 'ps-row' }, h('label', {}, 'Sound'),
        h('button', { class: 'ps-snd', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); soundMenu(d, r.left, r.bottom + 4); } }, iconEl(snd.none ? 'volume-off' : 'music'), h('span', {}, snd.none ? 'No sound' : snd.name || 'Built-in'), snd.match ? h('small', {}, 'Audio/SFX') : null, iconEl('chevron-down'))));
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: look.vol ?? 1, 'aria-label': 'Its volume' });
      const out = h('output', {}, `${Math.round((look.vol ?? 1) * 100)}%`);
      vol.addEventListener('input', () => { out.textContent = `${Math.round(Number(vol.value) * 100)}%`; });
      vol.addEventListener('change', () => set({ vol: Number(vol.value) }));
      body.append(h('div', { class: 'ps-vol' }, iconEl('volume'), vol, out));
      el.replaceChildren(
        h('div', { class: 'ps-head' }, cv, h('b', {}, d.label),
          h('button', { class: `ps-star ${starOn ? 'on' : ''}`, 'aria-label': starOn ? `Unstar ${d.label}` : `Star ${d.label}`, 'data-tip': starOn ? 'Starred: on top, and on Shift + a number' : 'Star it: on top, and on Shift + a number', onclick: () => { setStar(d.id, !starOn); setTimeout(fillSheet, 60); } }, iconEl('star', starOn ? 'fill' : ''), starOn && si < 9 ? `⇧${si + 1}` : null)),
        body,
        h('div', { class: 'ps-foot' },
          h('button', { onclick: () => { ts.settings({ momentLook: { id: d.id, look: null }, momentSound: { id: d.id, path: null } }); setTimeout(fillSheet, 60); } }, iconEl('rotate'), 'As it came'),
          h('button', { onclick: () => { Hotbar.add({ kind: 'moment', ref: d.id, label: d.label, icon: d.icon }); closeSheet(); } }, iconEl('layout-grid'), 'Hotbar')));
      paintThumb(cv, d, THUMB_AGE[d.id] || 1);
    }

    // =====================================================================
    // Cues (before 2.1; snapshots.js took their place): the old ones still play from the Snapshots panel
    // =====================================================================
    const cues = () => (S().campaign && S().campaign.cues) || [];
    async function playCue(cq) {
      const r = await cmd('cue.play', { id: cq.id });
      if (r && r.ok) toast(`${cq.name}`, { ms: 1800, undo: () => cmd('history.undo', { mapId: r && r.mapId }) });
      else if (r && r.error) toast(r.error, { kind: 'error' });
    }

    return { buildMoments, play, starredList, playCue, cues, loadLib, closeSheet };
  }

  return { create };
})();
