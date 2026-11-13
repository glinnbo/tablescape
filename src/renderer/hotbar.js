// The hotbar (2.0): ten slots on three pages at the bottom of the GM screen, saved with the campaign.
// Drag things onto a slot (library items, map cards, sounds, moments, snapshots, fog tools, moods, spells, weather, light moods,
// Toolbox panels, wheels, a dice roll …) or right-click them → Put on the hotbar. Click a slot or press 1 – 0 to use it;
// drag slots to reorder them, drag one off the bar to remove it. Never on the TV.
// gm-play.js knows how to use each kind of thing (ctx.run) and whether it is running (ctx.live).
'use strict';

const Hotbar = (() => {
  const { h, iconEl, toast, openMenu, askText, Thumbs } = UI;
  const TYPE = 'application/x-ts-hot';
  const SLOTS = 10;
  const PAGES = 3;
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  // what each kind shows when it has no picture of its own
  const ICON = {
    token: 'user', asset: 'trees', portrait: 'user-circle', handout: 'script', overlay: 'sparkles', sound: 'volume', mood: 'brand-spotify',
    moment: 'flare', cue: 'keyframes', wheel: 'chart-pie', roll: 'dice', death: 'heart-broken', spell: 'flame', weather: 'cloud-rain',
    light: 'sun-moon', map: 'map-2', panel: 'briefcase', snap: 'camera', fog: 'cloud-fog', lights: 'bulb', tool: 'pointer', do: 'bolt', door: 'door',
  };
  let active = null; // the GM screen's bar

  // library drag data (library-drawer.js) → a hotbar item
  const CAT_KIND = { tokens: 'token', assets: 'asset', portraits: 'portrait', handouts: 'handout', overlays: 'overlay', sounds: 'sound' };
  function fromAsset(a) {
    const kind = a && CAT_KIND[a.cat];
    if (!kind) return null;
    return { kind, label: a.name, ref: { path: a.path, kind: a.kind, cat: a.cat } };
  }
  // an element that can go on the hotbar: drag it there, or right-click → Put on the hotbar
  function offer(el, item, { menu = true } = {}) {
    if (!el) return el;
    const get = () => (typeof item === 'function' ? item() : item);
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      const it = get();
      if (!it) return;
      e.dataTransfer.setData(TYPE, JSON.stringify(it));
      e.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('dragging-hot');
    });
    el.addEventListener('dragend', () => document.body.classList.remove('dragging-hot'));
    if (menu) {
      el.addEventListener('contextmenu', (e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        const it = get();
        if (it) openMenu(e.clientX, e.clientY, [{ icon: 'plus', label: 'Put on the hotbar', action: () => add(it) }]);
      });
    }
    return el;
  }
  const add = (it) => (active ? active.add(it) : null);
  // a menu entry for menus that are already there
  const menuItem = (it) => ({ icon: 'plus', label: 'Put on the hotbar', action: () => add(it) });

  function create(ctx) {
    const { cmd } = ctx;
    const S = () => ctx.state();
    let page = 0;
    let folded = false;
    // 4.3: its shape: 10 × 1 (a row under the map), 5 × 2, 2 × 5 or 1 × 10 (a column at the side)
    const SHAPES = { '10x1': [10, 1], '5x2': [5, 2], '2x5': [2, 5], '1x10': [1, 10] };
    let shape = '10x1';
    try { page = Math.max(0, Math.min(PAGES - 1, Number(localStorage.getItem('hotbarPage')) || 0)); folded = localStorage.getItem('hotbarFold') === '1'; const v = localStorage.getItem('hotbarShape'); if (SHAPES[v]) shape = v; } catch {}
    const slots = () => {
      const list = (S() && S().campaign && S().campaign.hotbar) || [];
      return Array.from({ length: SLOTS * PAGES }, (_, i) => list[i] || null);
    };
    const save = (list) => cmd('hotbar.set', { slots: list.map((x) => (x ? { kind: x.kind, label: x.label, icon: x.icon || null, ref: x.ref } : null)) });

    // ---------- the bar ----------
    const slotEls = KEYS.map((k, i) => {
      const el = h('button', { class: 'hb-slot', dataset: { i }, 'aria-label': `Hotbar slot ${k}` });
      el.addEventListener('click', () => use(page * SLOTS + i));
      el.addEventListener('contextmenu', (e) => { if (!slots()[page * SLOTS + i]) return; e.preventDefault(); slotMenu(page * SLOTS + i, e.clientX, e.clientY); }); // (an empty one: the bar's menu, its shape)
      el.addEventListener('dragover', (e) => {
        const t = [...e.dataTransfer.types];
        if (!t.includes(TYPE) && !t.includes('application/x-ts-asset') && !t.includes('application/x-ts-map')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = t.includes(TYPE) && document.body.classList.contains('dragging-slot') ? 'move' : 'copy';
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); drop(page * SLOTS + i, e.dataTransfer); });
      // a filled slot can be dragged: onto another slot (they swap), onto the map (tokens, assets), or off the bar (gone)
      el.addEventListener('dragstart', (e) => {
        const at = page * SLOTS + i;
        const it = slots()[at];
        if (!it) { e.preventDefault(); return; }
        dragFrom = at;
        dropped = false;
        e.dataTransfer.setData(TYPE, JSON.stringify({ from: at }));
        const r = it.ref || {};
        if (r.path && (it.kind === 'token' || it.kind === 'asset' || it.kind === 'overlay')) {
          const a = { path: r.path, kind: r.kind, role: { token: 'token', asset: 'asset', overlay: 'overlay' }[it.kind], name: it.label, cat: r.cat };
          e.dataTransfer.setData('application/x-ts-asset', JSON.stringify(a));
          UI.DragPic.start(e, a, el); // 2.6: the map shows it half see-through, true size
        }
        e.dataTransfer.effectAllowed = 'copyMove';
        document.body.classList.add('dragging-hot', 'dragging-slot');
      });
      el.addEventListener('dragend', (e) => {
        document.body.classList.remove('dragging-hot', 'dragging-slot');
        const from = dragFrom;
        dragFrom = null;
        if (from == null || dropped || e.dataTransfer.dropEffect !== 'none') return;
        // dropped off the bar: taken off it
        const list = slots();
        const gone = list[from];
        if (!gone) return;
        const before = list.slice();
        list[from] = null;
        save(list);
        toast(`${gone.label} taken off the hotbar`, { undo: () => save(before), ms: 4000 });
      });
      el.draggable = true;
      return el;
    });
    let dragFrom = null;
    let dropped = false;
    const pageOut = h('b', { class: 'hb-page-n' });
    const pageCtl = h('div', { class: 'hb-pages' },
      h('button', { class: 'icon-btn', 'aria-label': 'Hotbar page up', 'data-tip': 'Page up (or the mouse wheel over the bar)', onclick: () => setPage(page - 1) }, iconEl('chevron-up')),
      pageOut,
      h('button', { class: 'icon-btn', 'aria-label': 'Hotbar page down', 'data-tip': 'Page down', onclick: () => setPage(page + 1) }, iconEl('chevron-down')));
    const fold = h('button', { class: 'icon-btn hb-fold', 'aria-label': 'Fold the hotbar', 'data-tip': 'Fold the hotbar away', onclick: () => setFold(true) }, iconEl('chevron-down'));
    const tab = h('button', { class: 'hb-tab', 'data-tip': 'The hotbar: drag things here, use them with 1 – 0', onclick: () => setFold(false) }, iconEl('chevron-up'), 'Hotbar');
    // 2.2: the grip moves the bar anywhere (remembered); a double-click puts it back at the bottom
    const grip = h('span', { class: 'hb-grip', role: 'button', 'aria-label': 'Move the hotbar', 'data-tip': 'Drag to move the hotbar. Double-click: back to its place. Right-click: its shape' }, iconEl('grip-vertical'));
    const bar = h('div', { class: 'hb-bar' }, grip, h('div', { class: 'hb-slots' }, ...slotEls), pageCtl, fold);
    const root = h('div', { id: 'hotbar', class: 'hotbar', role: 'toolbar', 'aria-label': 'Hotbar' }, bar, tab);
    bar.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); setPage(page + Math.sign(e.deltaY)); }, { passive: false });
    // right-click on the bar (not on a filled slot): its shape
    bar.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented || e.target.closest('.hb-slot.full')) return;
      e.preventDefault();
      // Prototype 25: an empty slot opens the picker: everything that can go on the hotbar, in one list
      const empty = e.target.closest('.hb-slot');
      const at = empty ? page * SLOTS + Number(empty.dataset.i) : null;
      openMenu(e.clientX, e.clientY, [
        ...(at != null && ctx.pick ? [{ icon: 'plus', label: `Add to slot ${KEYS[at % SLOTS]} …`, action: () => ctx.pick(at) }, '-'] : []),
        { header: 'Hotbar shape' },
        ...Object.keys(SHAPES).map((k) => ({ icon: k === shape ? 'check' : 'layout-grid', label: `${k.replace('x', ' × ')}${k === '10x1' ? ' (a row)' : k === '1x10' ? ' (a column)' : ''}`, action: () => setShape(k) }))]);
    });
    function setShape(k) {
      if (!SHAPES[k]) return;
      shape = k;
      try { localStorage.setItem('hotbarShape', k); } catch {}
      applyShape();
      requestAnimationFrame(place);
    }
    function applyShape() {
      const [cols] = SHAPES[shape];
      root.dataset.shape = shape;
      root.classList.toggle('vertical', cols <= 2);
      bar.querySelector('.hb-slots').style.setProperty('--hb-cols', cols);
    }
    let pos = null; // { x, y }: top left in the GM screen's map area; null: bottom centre
    try { const v = JSON.parse(localStorage.getItem('hotbarPos') || 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) pos = v; } catch {}
    function place() {
      const host = root.parentElement;
      if (pos && host) {
        const r = host.getBoundingClientRect();
        const w = root.offsetWidth || 700; const hh = root.offsetHeight || 70;
        const x = Math.max(0, Math.min(r.width - w, pos.x)); const y = Math.max(0, Math.min(r.height - hh, pos.y));
        Object.assign(root.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, bottom: 'auto', transform: 'none' });
        root.classList.add('moved');
      } else {
        Object.assign(root.style, { left: '', top: '', bottom: '', transform: '' });
        root.classList.remove('moved');
      }
      toastsHere();
    }
    // messages appear just above the bar (below it when the bar is up at the top)
    function toastsHere() {
      const de = document.documentElement.style;
      if (root.hidden || !root.isConnected) { de.removeProperty('--toast-x'); de.removeProperty('--toast-b'); de.removeProperty('--toast-t'); return; }
      const r = (folded ? tab : bar).getBoundingClientRect();
      if (!r.width) return;
      de.setProperty('--toast-x', `${Math.round(r.left + r.width / 2)}px`);
      if (r.top < 150) { de.setProperty('--toast-t', `${Math.round(r.bottom + 10)}px`); de.setProperty('--toast-b', 'auto'); } else { de.setProperty('--toast-b', `${Math.round(innerHeight - r.top + 10)}px`); de.setProperty('--toast-t', 'auto'); }
    }
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const host = root.parentElement.getBoundingClientRect();
      const r0 = root.getBoundingClientRect();
      const ox = e.clientX - r0.left; const oy = e.clientY - r0.top;
      root.classList.add('moving');
      const move = (ev) => { pos = { x: ev.clientX - host.left - ox, y: ev.clientY - host.top - oy }; place(); };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        root.classList.remove('moving');
        try { localStorage.setItem('hotbarPos', JSON.stringify(pos)); } catch {}
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => { pos = null; try { localStorage.removeItem('hotbarPos'); } catch {} place(); });
    addEventListener('resize', () => place());

    function setPage(p) {
      page = (p + PAGES) % PAGES;
      try { localStorage.setItem('hotbarPage', String(page)); } catch {}
      sig = '';
      render();
    }
    function setFold(on) {
      folded = on;
      try { localStorage.setItem('hotbarFold', on ? '1' : '0'); } catch {}
      render();
    }
    let sig = '';
    function render() {
      root.classList.toggle('folded', folded);
      requestAnimationFrame(place); // (the map bar may have folded: the bar and its messages follow)
      const list = slots();
      const mine = list.slice(page * SLOTS, page * SLOTS + SLOTS);
      const live = mine.map((it) => !!(it && ctx.live(it)));
      const nsig = JSON.stringify([page, mine, live]);
      if (nsig === sig) return;
      sig = nsig;
      pageOut.textContent = `${page + 1}/${PAGES}`;
      mine.forEach((it, i) => {
        const el = slotEls[i];
        el.className = `hb-slot ${it ? 'full' : 'empty'} ${live[i] ? 'live' : ''} ${it && it.missing ? 'missing' : ''}`;
        el.innerHTML = '';
        el.removeAttribute('data-tip');
        if (it) {
          const r = it.ref || {};
          const pic = r.path && r.kind && r.kind !== 'audio' && it.kind !== 'sound' ? Thumbs.img(r.path, r.kind) : null;
          const name = ctx.label ? ctx.label(it) : it.label;
          el.append(h('span', { class: 'hb-pic' }, pic || iconEl(it.icon || ICON[it.kind] || 'help')), h('span', { class: 'hb-name' }, name));
          el.dataset.tip = `${name}${it.missing ? ' (missing)' : ''}: ${ctx.what(it)}. Right-click: rename, remove`;
        }
        el.append(h('i', { class: 'hb-key' }, KEYS[i]));
        el.setAttribute('aria-label', it ? `${KEYS[i]}: ${it.label}` : `Hotbar slot ${KEYS[i]} (empty)`);
      });
    }
    // ---------- using, adding, removing ----------
    function use(at) {
      const it = slots()[at];
      if (!it) { toast(`Slot ${KEYS[at % SLOTS]} is empty: drag something onto it`, { ms: 3200 }); return; }
      if (it.missing) { toast(`${it.label} is gone (the file or the thing it was is no longer there)`, { kind: 'error' }); return; }
      const el = slotEls[at % SLOTS];
      if (Math.floor(at / SLOTS) === page) { el.classList.remove('fire'); void el.offsetWidth; el.classList.add('fire'); }
      ctx.run(it);
    }
    function press(n) { use(page * SLOTS + n); }
    function drop(at, dt) {
      dropped = true;
      const list = slots();
      let it = null;
      try {
        const raw = dt.getData(TYPE);
        if (raw) {
          const o = JSON.parse(raw);
          if (o && Number.isInteger(o.from)) { // a slot onto another: they swap
            if (o.from === at) return;
            [list[o.from], list[at]] = [list[at], list[o.from]];
            save(list);
            return;
          }
          it = o;
        }
      } catch {}
      if (!it) { try { it = fromAsset(JSON.parse(dt.getData('application/x-ts-asset') || 'null')); } catch {} }
      if (!it) { const id = dt.getData('application/x-ts-map'); if (id) it = ctx.mapItem(id); }
      if (!it || !it.kind) return;
      const before = list.slice();
      const old = list[at];
      list[at] = it;
      save(list);
      if (old) toast(`${it.label} in slot ${KEYS[at % SLOTS]} (instead of ${old.label})`, { undo: () => save(before), ms: 3500 });
    }
    // right-click → Put on the hotbar: the first free slot, this page first
    function addItem(it) {
      const list = slots();
      const order = [...Array(SLOTS * PAGES).keys()].sort((a, b) => (Math.floor(a / SLOTS) === page ? -1 : 0) - (Math.floor(b / SLOTS) === page ? -1 : 0) || a - b);
      const at = order.find((i) => !list[i]);
      if (at == null) { toast('The hotbar is full: drag one off to make room', { kind: 'error' }); return null; }
      list[at] = it;
      save(list);
      if (folded) setFold(false);
      if (Math.floor(at / SLOTS) !== page) setPage(Math.floor(at / SLOTS));
      toast(`${it.label} is on the hotbar: ${KEYS[at % SLOTS]}${Math.floor(at / SLOTS) ? ` (page ${Math.floor(at / SLOTS) + 1})` : ''}`, { ms: 2200 });
      return at;
    }
    function slotMenu(at, x, y) {
      const it = slots()[at];
      if (!it) return;
      openMenu(x, y, [
        { header: it.label },
        { icon: 'player-play', label: 'Use', action: () => use(at) },
        ...(ctx.pick ? [{ icon: 'refresh', label: 'Change …', action: () => ctx.pick(at) }] : []),
        { icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText('Name in the hotbar', it.label); if (!n) return; const list = slots(); list[at] = { ...it, label: n.slice(0, 40) }; save(list); } },
        '-',
        { icon: 'trash', label: 'Take off the hotbar', danger: true, action: () => { const list = slots(); const before = list.slice(); list[at] = null; save(list); toast(`${it.label} taken off the hotbar`, { undo: () => save(before), ms: 4000 }); } },
      ]);
    }

    applyShape();
    // (Prototype 25) put something into one slot, whatever was there (the picker)
    function setSlot(at, it) {
      const list = slots(); const before = list.slice(); const old = list[at];
      list[at] = it; save(list);
      toast(old ? `${it.label} in slot ${KEYS[at % SLOTS]} (instead of ${old.label})` : `${it.label} is on the hotbar: ${KEYS[at % SLOTS]}`, { undo: old ? () => save(before) : undefined, ms: 2600 });
    }
    const api = { el: root, render, press, add: addItem, use, page: () => page, setPage, slots, place, pos: () => pos, shape: () => shape, setShape, setSlot };
    active = api;
    return api;
  }

  return { create, offer, add, menuItem, fromAsset, TYPE, ICON, KEYS, SLOTS };
})();
