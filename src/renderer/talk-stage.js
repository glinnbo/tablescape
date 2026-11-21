// Second Builder (second-conversation-stage): the small TV at the top of the Conversation window (toolbox.js builds the
// window around it). A picture of the TV with a frame on each portrait of the near side, laid out by talk-layout.js
// exactly as the TV lays them out:
//   click a portrait            it speaks (steps to the front) and is picked
//   drag the speaker sideways   where they all stand (settings.talk.pos)
//   drag one up or down         its own nudge (talk.offset); a portrait behind: sideways too
//   pull a top corner           its own size (talk.size, 50 to 200 %)
//   ✕ on it, or Delete          it leaves (a click never takes anyone out)
// Under it: how many stand there and End, then the picked portrait: Mirror, back to 100 %, Take out, and its looks
// (Bloodied, Shaded, Hidden) with their amounts. The picture is the GM's live preview of the TV.
'use strict';
window.TalkStage = (() => {
  const { h, iconEl, clamp } = UI;
  const KEY = 'talkStageW';
  let width = 420;
  try { width = Number(localStorage.getItem(KEY)) || 420; } catch {}
  let picked = null; // the picked portrait's path (else the speaker)
  const stages = new Set(); // { img, stage, draw } of the open ones (the preview comes to all)
  const aspects = new Map(); // url → width / height (0 while loading)

  function aspectOf(url, done) {
    if (aspects.has(url)) return aspects.get(url);
    aspects.set(url, 0);
    const im = new Image();
    im.onload = () => { aspects.set(url, im.naturalWidth / Math.max(1, im.naturalHeight)); done(); };
    im.onerror = () => aspects.set(url, 0.8);
    im.src = url;
    return 0;
  }
  function preview(url) { for (const s of [...stages]) { if (!s.stage.isConnected) { stages.delete(s); continue; } if (url) s.img.src = url; } }
  // how wide the picture of the TV should come while a Conversation window shows it (0: none open)
  function wantWidth() {
    let w = 0;
    for (const s of [...stages]) { if (!s.stage.isConnected) { stages.delete(s); continue; } w = Math.max(w, s.stage.getBoundingClientRect().width || 0); }
    return Math.round(w * (window.devicePixelRatio || 1));
  }

  // o: { S, cmd, toast, bind, bringIn (item), preview (), previewSize (), fx: { of (path), send (path, patch) } }
  function build(o) {
    const S = o.S;
    const world = () => (S().view && S().view.world) || { w: 16, h: 9 };
    const img = h('img', { class: 'cs-tv', alt: 'What the players see', src: o.preview() || '' });
    const frames = h('div', { class: 'cs-frames' });
    const hint = h('p', { class: 'cs-hint' }, 'Click a portrait below, or drag one here');
    const stage = h('div', { class: 'cs-stage', tabindex: '0', 'aria-label': 'The conversation on the TV' }, img, frames, hint);
    const grip = h('span', { class: 'cs-grip', 'data-tip': 'Drag to make the picture bigger or smaller' }, iconEl('arrows-diagonal'));
    const wrap = h('div', { class: 'cs-wrap' }, stage, grip);
    const me = { img, stage, draw: () => { redraw(); barSig = ''; drawBar(); } };
    stages.add(me);
    // the window is as wide as the small TV (its corner sizes both)
    const size = () => {
      stage.style.width = `${Math.round(width)}px`; stage.style.aspectRatio = `${world().w} / ${world().h}`;
      const fp = stage.closest('.fp'); if (fp) fp.style.width = `${Math.round(width) + 28}px`;
    };
    size();

    // what is being dragged right now, and what it shows until the TV has followed
    let act = null; let local = null; let sendT = 0; let pending = null;
    const send = (type, p) => { pending = { type, p }; if (!sendT) sendT = requestAnimationFrame(() => { sendT = 0; const q = pending; pending = null; if (q) (q.type === 'pos' ? ts.settings({ talk: { pos: q.p } }) : o.cmd(q.type, q.p)); }); };
    const cast = () => (S().talk ? S().talk.cast : []);
    const prefs = () => (S().settings && S().settings.talk) || { size: 0.34, pos: 1 };
    const seats = () => (S().settings && S().settings.seats === 'one' ? 'one' : 'both');
    const sizeOf = (path) => ((S().settings && S().settings.portraitSize) || {})[path] || 1;
    const offOf = (path) => ((S().settings && S().settings.portraitOffset) || {})[path] || null;

    function geometry() {
      const r = stage.getBoundingClientRect(); const W = r.width || width; const H = r.height || (width * world().h) / world().w;
      const list = cast();
      const lv = local && Date.now() - local.t < 900 ? local : null;
      const L = TalkLayout.compute({ W, H, size: prefs().size, pos: lv && lv.pos != null ? lv.pos : prefs().pos, anchor: prefs().anchor, seats: seats(),
        items: list.map((c) => ({ aspect: aspectOf(c.url, redraw), scale: lv && lv.scale && lv.scale.path === c.path ? lv.scale.v : sizeOf(c.path), offset: lv && lv.off && lv.off.path === c.path ? lv.off.v : offOf(c.path) })) });
      return { W, H, list, L };
    }
    const nodes = new Map(); // path → frame
    function redraw() {
      if (!stage.isConnected) return;
      const { H, list, L } = geometry();
      const on = list.length > 0;
      hint.hidden = on;
      stage.classList.toggle('empty', !on);
      if (picked && !list.some((c) => c.path === picked)) picked = null;
      const pick = picked || (on ? list[list.length - 1].path : null);
      for (const [p, f] of nodes) if (!list.some((c) => c.path === p)) { f.remove(); nodes.delete(p); }
      list.forEach((c, i) => {
        let f = nodes.get(c.path);
        if (!f) {
          f = h('div', { class: 'cs-frame', dataset: { path: c.path } },
            h('span', { class: 'cs-h tl', dataset: { h: 'tl' } }), h('span', { class: 'cs-h tr', dataset: { h: 'tr' } }),
            h('button', { class: 'cs-x', 'aria-label': `Take ${c.name} out`, 'data-tip': 'Take out (Delete)', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); takeOut(c.path); } }, iconEl('x')),
            h('span', { class: 'cs-tag' }));
          f.addEventListener('pointerdown', (e) => down(e, c.path));
          nodes.set(c.path, f); frames.append(f);
        }
        const b = L.items[i];
        Object.assign(f.style, { left: `${b.left + b.dx}px`, bottom: `${H * 0.01 - b.dy}px`, width: `${b.width}px`, height: `${b.height}px`, zIndex: String(10 + i) });
        f.classList.toggle('front', b.front);
        f.classList.toggle('picked', c.path === pick);
        const tag = f.querySelector('.cs-tag');
        const t = b.front ? `${c.name} · speaking` : c.name;
        if (tag.textContent !== t) tag.textContent = t;
      });
    }
    function takeOut(path) { if (picked === path) picked = null; o.cmd('talk.toggle', { path, out: true }); }
    // ---------- the pointer ----------
    function down(e, path) {
      if (e.button !== 0) return;
      e.preventDefault(); stage.focus({ preventScroll: true });
      const { W, list, L } = geometry();
      const i = list.findIndex((c) => c.path === path); if (i < 0) return;
      const b = L.items[i]; const hnd = e.target.dataset && e.target.dataset.h;
      act = { path, x0: e.clientX, y0: e.clientY, moved: false, axis: null, hnd, front: b.front, b, W, scale0: sizeOf(path), off0: offOf(path) || { x: 0, y: 0 }, pos0: prefs().pos };
      e.currentTarget.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - act.x0; const dy = ev.clientY - act.y0;
        if (!act.moved && Math.hypot(dx, dy) < 5) return;
        act.moved = true;
        if (act.hnd) { // a top corner: its size (pulling up makes it bigger)
          const v = clamp(Math.round(act.scale0 * ((act.b.height - dy) / act.b.height) * 20) / 20, 0.5, 2);
          local = { scale: { path, v }, t: Date.now() }; send('talk.size', { path, scale: v });
        } else {
          if (!act.axis) act.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          if (act.axis === 'x' && act.front) { // the speaker sideways: where they all stand
            const p = TalkLayout.posFor(act.W, act.b.left + dx, act.b.width);
            local = { pos: p, t: Date.now() }; send('pos', p);
          } else { // its own nudge
            const v = { x: act.axis === 'x' ? clamp(act.off0.x + dx / act.b.width, -0.5, 0.5) : act.off0.x, y: act.axis === 'y' ? clamp(act.off0.y - dy / act.b.height, -0.4, 0.4) : act.off0.y };
            v.x = Math.round(v.x * 100) / 100; v.y = Math.round(v.y * 100) / 100;
            local = { off: { path, v }, t: Date.now() }; send('talk.offset', { path, x: v.x, y: v.y });
          }
        }
        redraw();
      };
      const up = () => {
        const f = nodes.get(path); if (f) { f.removeEventListener('pointermove', move); f.removeEventListener('pointerup', up); f.removeEventListener('pointercancel', up); }
        const a = act; act = null;
        if (a && !a.moved) { // a click: it speaks, and is picked
          picked = path;
          if (!a.front) o.cmd('talk.toggle', { path }); else me.draw();
        } else if (local) local.t = Date.now();
        redraw();
      };
      const f = nodes.get(path);
      f.addEventListener('pointermove', move); f.addEventListener('pointerup', up); f.addEventListener('pointercancel', up);
    }
    stage.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const list = cast(); const p = picked || (list.length ? list[list.length - 1].path : null);
      if (p) { e.preventDefault(); e.stopPropagation(); takeOut(p); }
    });
    // a portrait dragged here from a list comes in
    stage.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-ts-asset')) { e.preventDefault(); e.stopPropagation(); stage.classList.add('drop-ok'); } });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop-ok'));
    stage.addEventListener('drop', (e) => {
      stage.classList.remove('drop-ok');
      let a = null;
      try { a = JSON.parse(e.dataTransfer.getData('application/x-ts-asset') || 'null'); } catch {}
      if (!a || !a.path || (a.cat && a.cat !== 'portraits' && a.cat !== 'party')) return;
      e.preventDefault(); e.stopPropagation();
      o.bringIn(a);
    });
    // ---------- the corner that sizes the picture ----------
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX; const w0 = stage.getBoundingClientRect().width;
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => { width = clamp(w0 + (ev.clientX - x0), 300, Math.max(300, window.innerWidth - 160)); size(); redraw(); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); try { localStorage.setItem(KEY, String(Math.round(width))); } catch {} o.previewSize(); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });

    // ---------- under the picture: how many, End; the picked one ----------
    const count = h('span', { class: 'grow cs-count' });
    const end = h('button', { class: 'btn small danger', onclick: () => o.cmd('talk.off') }, iconEl('player-stop'), 'End');
    const status = h('div', { class: 'cs-status' }, h('span', { class: 'cs-dot' }), count, end);
    const bar = h('div', { class: 'cs-picked' });
    let barSig = '';
    function drawBar() {
      const list = cast();
      const on = list.length > 0;
      count.textContent = on ? `On the TV: ${list.length} of 3` : (S().talk ? 'Nobody on the TV yet' : 'No conversation');
      status.classList.toggle('on', on);
      end.hidden = !S().talk;
      const path = picked && list.some((c) => c.path === picked) ? picked : on ? list[list.length - 1].path : null;
      const c = path ? list.find((x) => x.path === path) : null;
      const fx = c ? PortraitFx.norm(o.fx.of(c.path)) : null; const raw = c ? (o.fx.of(c.path) || {}) : {};
      const mirror = c && !!((S().settings && S().settings.portraitMirror) || {})[c.path];
      const moved = c && (Math.abs(sizeOf(c.path) - 1) > 0.001 || !!offOf(c.path));
      const sig = JSON.stringify([c && c.path, c && list[list.length - 1].path === c.path, raw, mirror, moved]);
      if (sig === barSig && !(act && act.moved)) return;
      barSig = sig;
      bar.hidden = !c;
      if (!c) { bar.replaceChildren(); return; }
      const front = list[list.length - 1].path === c.path;
      const look = (key, label, icon, onKey) => h('button', { class: `cs-look ${raw[onKey] ? 'on' : ''}`, 'aria-pressed': String(!!raw[onKey]),
        onclick: () => o.fx.send(c.path, { [onKey]: !raw[onKey] }) }, iconEl(icon), label);
      const amount = (label, key, max, def) => {
        const v = raw[key] == null ? def : raw[key];
        const out = h('span', { class: 'cs-amt' }, `${Math.round(v * 100)} %`);
        const input = h('input', { type: 'range', min: '0', max: String(Math.round(max * 100)), step: '1', value: String(Math.round(v * 100)), 'aria-label': `${label} amount` });
        let t = 0;
        input.addEventListener('input', () => { out.textContent = `${input.value} %`; clearTimeout(t); t = setTimeout(() => o.fx.send(c.path, { [key]: Number(input.value) / 100 }), 60); });
        return h('label', { class: 'cs-slider' }, h('span', {}, label), input, out);
      };
      bar.replaceChildren(
        h('div', { class: 'cs-row' }, h('b', { class: 'grow ellipsis' }, c.name, front ? h('small', {}, ' speaking') : null),
          moved ? h('button', { class: 'icon-btn', 'aria-label': 'Back to 100 %, in its place', 'data-tip': 'Back to 100 %, in its place', onclick: () => { o.cmd('talk.size', { path: c.path, scale: 1 }); o.cmd('talk.offset', { path: c.path, x: 0, y: 0 }); } }, iconEl('arrow-back-up')) : null,
          h('button', { class: `icon-btn ${mirror ? 'on' : ''}`, 'aria-label': 'Mirror', 'data-tip': 'Mirror (face the other way)', onclick: () => o.cmd('talk.mirror', { path: c.path }) }, iconEl('flip-horizontal')),
          h('button', { class: 'btn small danger', onclick: () => takeOut(c.path) }, iconEl('x'), 'Take out')),
        h('div', { class: 'cs-row cs-looks' }, look('blood', 'Bloodied', 'droplet', 'bloodOn'), look('shade', 'Shaded', 'contrast', 'shadeOn'), look('hidden', 'Hidden', 'eye-off', 'hidden')),
        ...[raw.bloodOn ? amount('Bloodied', 'blood', 1, 0.4) : null, raw.shadeOn ? amount('Shaded', 'shade', 0.9, 0.5) : null].filter(Boolean));
      void fx;
    }
    o.bind(() => { size(); redraw(); drawBar(); });
    if (window.ResizeObserver) new ResizeObserver(() => redraw()).observe(stage);
    requestAnimationFrame(() => { size(); redraw(); o.previewSize(); });
    return h('div', { class: 'cs stack' }, wrap, status, bar);
  }
  const pick = (path) => { picked = path || null; };
  // draw the open ones again (a portrait picked from the list below)
  const refresh = () => { for (const s of [...stages]) { if (!s.stage.isConnected) { stages.delete(s); continue; } s.draw(); } };
  return { build, preview, wantWidth, pick, refresh, picked: () => picked };
})();
