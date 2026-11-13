// Floating panels on the GM screen: the Toolbox tools (Initiative, Countdown, Soundboard, Break)
// open as small windows you can drag anywhere, several at once. They stay open while you use
// the map tools, fold down to their title bar, and come back where you left them.
// gm-play.js gives each panel its own list of refreshers (withBinds), so its controls keep updating.
'use strict';

const FloatPanels = (() => {
  const { h, iconEl, clamp } = UI;
  const KEY = 'floatPanels';

  function create({ host, withBinds, onChange }) {
    const open = new Map(); // id -> { def, el, body, binds, folded }
    // one layer for all panels: inside it they stack freely, as a whole they stay under popovers and menus
    let layer = null;
    const box = () => {
      if (!layer || !layer.isConnected) { layer = h('div', { class: 'fp-layer' }); host().append(layer); }
      return layer;
    };
    let top = 1;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} };

    // def: { id, title, icon, build () => element, tips? (a list, or a function giving one) }
    function show(def) {
      let p = open.get(def.id);
      if (p) { front(p); p.el.classList.remove('flash'); void p.el.offsetWidth; p.el.classList.add('flash'); return p; }
      const st = saved[def.id] || {};
      const fold = h('button', { class: 'icon-btn fp-fold', 'aria-label': 'Fold', 'data-tip': 'Fold to the title bar' }, iconEl('chevron-up'));
      const close = h('button', { class: 'icon-btn fp-close', 'aria-label': `Close ${def.title}`, 'data-tip': 'Close' }, iconEl('x'));
      const head = h('header', { class: 'fp-head' }, iconEl(def.icon), h('span', { class: 'fp-title' }, def.title), def.tips ? UI.helpTip(def.title, def.tips) : null, fold, close); // 4.3.1: tips behind a "?"
      const body = h('div', { class: 'fp-body' });
      const el = h('section', { class: 'fp', dataset: { id: def.id }, role: 'dialog', 'aria-label': def.title }, head, body);
      p = { def, el, body, head, binds: [], folded: !!st.folded };
      open.set(def.id, p);
      fill(p);
      box().append(el);
      front(p);
      el.classList.toggle('folded', p.folded);
      place(p, st);
      fold.onclick = () => setFolded(p, !p.folded);
      close.onclick = () => hide(def.id);
      el.addEventListener('pointerdown', () => front(p), true);
      // a panel that grows (a wider turn order) stays on the screen
      if (window.ResizeObserver) { p.ro = new ResizeObserver(() => { if (!p.el.classList.contains('dragging')) keepInside(p); }); p.ro.observe(el); }
      drag(p, head);
      onChange();
      return p;
    }
    function fill(p) {
      p.binds = [];
      p.body.innerHTML = '';
      withBinds(p.binds, () => {
        p.body.append(p.def.build());
        // a panel may show something in its title bar while folded (Snapshots: the timeline in one line)
        const old = p.head.querySelector('.fp-extra');
        if (old) old.remove();
        if (p.def.headExtra) { const x = p.def.headExtra(); if (x) { x.classList.add('fp-extra'); p.head.querySelector('.fp-title').after(x); } }
      });
    }
    function hide(id) {
      const p = open.get(id);
      if (!p) return;
      remember(p);
      if (p.ro) p.ro.disconnect();
      p.el.remove();
      open.delete(id);
      onChange();
    }
    function toggle(def) { if (open.has(def.id)) hide(def.id); else show(def); }
    function setFolded(p, on) {
      p.folded = on;
      p.el.classList.toggle('folded', on);
      p.el.querySelector('.fp-fold').replaceChildren(iconEl(on ? 'chevron-down' : 'chevron-up'));
      remember(p);
      keepInside(p);
    }
    // bring to the front without moving it in the page (moving it would swallow the click that started it)
    function front(p) { if (Number(p.el.style.zIndex) !== top) p.el.style.zIndex = String(++top); }
    function remember(p) {
      saved[p.def.id] = { x: parseFloat(p.el.style.left) || 0, y: parseFloat(p.el.style.top) || 0, folded: p.folded };
      save();
    }
    // where it opens: where it was last time, or next to the table controls (a little lower for each open panel)
    function place(p, st) {
      const r = host().getBoundingClientRect();
      const n = open.size - 1;
      const own = (st.x == null || p.def.placeAlways) && p.def.place ? p.def.place(r, p.el) : null; // a panel may say where it opens first (Prototype 17: or every time)
      const x = own ? own.x : st.x != null ? st.x : r.width - 212 - 24 - 300 - 12;
      const y = own ? own.y : st.y != null ? st.y : 12 + n * 36;
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      keepInside(p);
    }
    function keepInside(p) {
      const r = host().getBoundingClientRect();
      const w = p.el.offsetWidth || 300; const hh = p.el.querySelector('.fp-head').offsetHeight || 40;
      const x = clamp(parseFloat(p.el.style.left) || 0, 0, Math.max(0, r.width - w));
      const y = clamp(parseFloat(p.el.style.top) || 0, 0, Math.max(0, r.height - hh));
      p.el.style.left = `${Math.round(x)}px`;
      p.el.style.top = `${Math.round(y)}px`;
    }
    function drag(p, head) {
      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        e.preventDefault();
        head.setPointerCapture(e.pointerId);
        const sx = e.clientX; const sy = e.clientY;
        const ox = parseFloat(p.el.style.left) || 0; const oy = parseFloat(p.el.style.top) || 0;
        p.el.classList.add('dragging');
        const move = (ev) => { p.el.style.left = `${ox + ev.clientX - sx}px`; p.el.style.top = `${oy + ev.clientY - sy}px`; keepInside(p); };
        const up = () => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          head.removeEventListener('pointercancel', up);
          p.el.classList.remove('dragging');
          remember(p);
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
        head.addEventListener('pointercancel', up);
      });
      head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setFolded(p, !p.folded); });
    }
    // controls follow the state (and clocks tick)
    function refresh() {
      for (const p of open.values()) withBinds(p.binds, () => { for (const f of [...p.binds]) f(); });
    }
    function rebuild(id) { const p = open.get(id); if (p) fill(p); }
    addEventListener('resize', () => { for (const p of open.values()) keepInside(p); });
    setInterval(() => { if (open.size && document.body.dataset.screen === 'play' && !window.__tsMoving) refresh(); }, 250); // (4.8: not while the map moves) // not while the maps are away

    return {
      show, hide, toggle, refresh, rebuild,
      isOpen: (id) => open.has(id),
      ids: () => [...open.keys()],
      closeAll: () => { for (const id of [...open.keys()]) hide(id); },
    };
  }

  return { create };
})();
