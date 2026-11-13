// Small UI toolkit shared by the GM screens: elements, tooltips, toasts,
// context menus, a text prompt, and thumbnails.
'use strict';

const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const iconEl = (name, cls) => { const s = h('span', { class: 'ico', html: icon(name, cls) }); return s.firstChild; };
  // 2.4: a long file name wraps onto up to three lines instead of making its panel wider: it may break after
  // _ - . and before a capital or a number (AsteroidDiskIron02_01_Regular_Red → Asteroid·Disk·Iron02_·01_·Regular_·Red),
  // the whole name shows on hover
  function wrapName(text, cls = '', tag = 'span') {
    const str = String(text ?? '');
    const el = h(tag, { class: `wrap-name ${cls}`.trim(), 'data-tip': str.length > 24 ? str : null });
    str.split(/(?<=[_\-./])|(?<=[a-z])(?=[A-Z0-9])/).forEach((part, i) => { if (i) el.append(document.createElement('wbr')); el.append(part); });
    return el;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

  // ---------- tooltips: data-tip="Label" data-key="R" ----------
  const tip = h('div', { id: 'tooltip', role: 'tooltip' });
  let tipTimer = null;
  let tipFor = null;
  function showTip(target) {
    const label = target.dataset.tip;
    if (!label) return;
    tip.innerHTML = `<span>${esc(label)}</span>${target.dataset.key ? `<kbd>${esc(target.dataset.key)}</kbd>` : ''}`;
    tip.classList.add('on');
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const side = target.dataset.tipSide || (target.closest('#rail') ? 'right' : 'bottom');
    let x; let y;
    if (side === 'right') { x = r.right + 8; y = r.top + r.height / 2 - t.height / 2; }
    else if (side === 'top') { x = r.left + r.width / 2 - t.width / 2; y = r.top - t.height - 8; }
    else { x = r.left + r.width / 2 - t.width / 2; y = r.bottom + 8; }
    tip.style.left = `${clamp(x, 4, innerWidth - t.width - 4)}px`;
    tip.style.top = `${clamp(y, 4, innerHeight - t.height - 4)}px`;
  }
  function hideTip() { clearTimeout(tipTimer); tip.classList.remove('on'); tipFor = null; }
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t === tipFor) return;
    hideTip();
    if (!t) return;
    tipFor = t;
    tipTimer = setTimeout(() => showTip(t), 380);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);

  // ---------- 4.3: a "?" with the handy things a panel can do (shown while the mouse is on it) ----------
  // items: a list of short tips, or a function giving them (the tips for the tab or mode that is open)
  // Prototype 25: the "?" of a panel opens the Guide's Help page at that panel (one searchable place instead of a
  // pop-up per panel). `items` stays in the call: the Help page collects the same lists.
  function helpTip(title) {
    const name = () => (typeof title === 'function' ? title() : title);
    const q = h('button', { type: 'button', class: 'help-q', 'aria-label': `Help: ${typeof title === 'function' ? 'this panel' : title}`, 'data-tip': 'Help for this panel' }, '?');
    q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof Guide !== 'undefined') Guide.open('help', name()); });
    return q;
  }

  // ---------- toasts ----------
  let toastBox = null;
  function toast(text, { undo, ms = 5000, kind, action } = {}) {
    if (!toastBox) return;
    const t = h('div', { class: `toast ${kind || ''}` }, h('span', {}, text));
    if (action) t.append(h('button', { class: 'toast-undo', onclick: () => { t.remove(); action.run(); } }, action.label));
    if (undo) {
      t.append(h('button', {
        class: 'toast-undo',
        onclick: async () => { t.remove(); await undo(); },
      }, iconEl('arrow-back-up'), 'Undo'));
    }
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
  }

  // ---------- context menu ----------
  const menu = h('div', { id: 'menu', role: 'menu' });
  function openMenu(x, y, items) {
    menu.innerHTML = '';
    for (const it of items) {
      if (it === '-') { menu.append(h('div', { class: 'menu-sep' })); continue; }
      if (it.header) { menu.append(h('div', { class: 'menu-head' }, it.header)); continue; }
      menu.append(h('button', {
        class: `menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`,
        role: 'menuitem',
        disabled: it.disabled,
        onclick: () => { closeMenu(); it.action(); },
      }, it.icon ? swatchIcon(it) : h('span', { class: 'menu-pad' }), h('span', { class: 'grow' }, it.label), it.key ? h('kbd', {}, it.key) : null));
    }
    menu.classList.add('on');
    const r = menu.getBoundingClientRect();
    menu.style.left = `${clamp(x, 4, innerWidth - r.width - 4)}px`;
    menu.style.top = `${clamp(y, 4, innerHeight - r.height - 4)}px`;
    const first = menu.querySelector('.menu-item:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }
  function swatchIcon(it) {
    const i = iconEl(it.icon, it.swatch ? 'fill' : '');
    if (it.swatch) i.style.color = it.swatch;
    return i;
  }
  function closeMenu() { menu.classList.remove('on'); }
  const menuOpen = () => menu.classList.contains('on');
  document.addEventListener('pointerdown', (e) => { if (menuOpen() && !e.target.closest('#menu')) closeMenu(); }, true);

  // ---------- text prompt (Electron has no window.prompt) ----------
  function askText(title, value = '', { ok = 'Save', placeholder = '' } = {}) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'text', value, placeholder, spellcheck: 'false' });
      const close = (v) => { back.remove(); resolve(v); };
      const form = h('form', { class: 'modal', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) close(v); else input.focus(); } },
        h('h2', {}, title),
        input,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn primary' }, ok)));
      const back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(null); } }, form);
      back.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && e.target === input) { e.preventDefault(); form.requestSubmit(); }
      });
      document.body.append(back);
      input.focus();
      input.select();
    });
  }

  // a dialog with a title, any content and a Close button; returns { el, body, close }
  function dialog(title, content, { wide = false, onClose = null } = {}) {
    const body = h('div', { class: 'dlg-body' }, content);
    let back = null;
    // Esc closes the dialog wherever the focus is (only the newest one, if several are open)
    const onKey = (e) => { if (e.key !== 'Escape' || !back || back !== [...document.querySelectorAll('.modal-back')].pop()) return; e.stopImmediatePropagation(); e.preventDefault(); close(); };
    const close = () => {
      if (!back) return;
      const a = document.activeElement; // (4.2.2) a field still being typed in keeps what was typed (Esc, a click beside the window)
      if (a && back.contains(a) && typeof a.blur === 'function') a.blur();
      back.remove(); back = null; window.removeEventListener('keydown', onKey, true); if (onClose) onClose();
    };
    const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, iconEl('x'))),
      body);
    back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(); } }, box);
    window.addEventListener('keydown', onKey, true);
    document.body.append(back);
    box.tabIndex = -1; box.focus();
    return { el: box, body, close };
  }

  // ---------- thumbnails ----------
  // Generated once per file (first video frame / downscaled image), cached in the library's .cache.
  const Thumbs = (() => {
    const known = new Map(); // path -> url | Promise
    const queue = [];
    let busy = false;
    async function get(path, kind, hint) {
      if (!path) return null;
      if (known.has(path)) return known.get(path);
      if (hint) { known.set(path, hint); return hint; }
      const p = new Promise((resolve) => { queue.push({ path, kind, resolve }); pump(); });
      known.set(path, p);
      const url = await p;
      known.set(path, url);
      return url;
    }
    async function pump() {
      if (busy || !queue.length) return;
      if (window.__tsMoving) { setTimeout(pump, 300); return; } // 4.8: not while the map moves
      busy = true;
      const job = queue.shift();
      let url = null;
      try {
        const cached = (await window.ts.thumb('get', [job.path]))[job.path];
        url = cached || await make(job);
      } catch {}
      job.resolve(url);
      busy = false;
      pump();
    }
    async function make({ path, kind }) {
      // a Universal VTT map: its picture was unpacked by main
      const vtt = /\.(dd2vtt|uvtt|df2vtt)$/i.test(String(path));
      const vttSrc = vtt ? await window.ts.library('vttimg', path) : null;
      if (vtt && !vttSrc) return null;
      return new Promise((resolve) => {
        const src = vttSrc || (window.ts.fileUrl ? window.ts.fileUrl(path) : pathToUrl(path));
        const W = 320;
        const finish = (el, w, h) => {
          try {
            const c = document.createElement('canvas');
            c.width = W;
            c.height = Math.max(1, Math.round((W * h) / w));
            const ctx = c.getContext('2d');
            ctx.drawImage(el, 0, 0, c.width, c.height);
            const data = c.toDataURL('image/webp', 0.8); // webp keeps transparency for tokens and effects
            window.ts.thumb('put', { path, dataUrl: data }).then((u) => resolve(u || data), () => resolve(data));
          } catch { resolve(null); }
        };
        const timer = setTimeout(() => resolve(null), 8000);
        if (kind === 'video') {
          const v = document.createElement('video');
          v.muted = true;
          v.preload = 'auto';
          v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); });
          v.addEventListener('seeked', () => { clearTimeout(timer); finish(v, v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); }, { once: true });
          v.addEventListener('error', () => { clearTimeout(timer); resolve(null); });
          v.src = src;
        } else if (kind === 'image') {
          const img = new Image();
          img.onload = () => { clearTimeout(timer); finish(img, img.naturalWidth, img.naturalHeight); };
          img.onerror = () => { clearTimeout(timer); resolve(null); };
          img.src = src;
        } else { clearTimeout(timer); resolve(null); }
      });
    }
    // Lazily fill <img data-thumb-path> elements when they scroll into view.
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const el = en.target;
        get(el.dataset.thumbPath, el.dataset.thumbKind, el.dataset.thumbHint || null).then((u) => { if (u) { el.src = u; el.classList.add('loaded'); } });
      }
    }, { rootMargin: '200px' });
    function img(path, kind, hint, cls = 'thumb') {
      const el = h('img', { class: cls, alt: '', draggable: 'false', dataset: { thumbPath: path || '', thumbKind: kind || '', thumbHint: hint || '' } });
      if (path && (kind === 'image' || kind === 'video')) io.observe(el);
      return el;
    }
    return { get, img };
  })();

  // ---------- dragging a library picture (2.6) ----------
  // The browser's own drag picture would sit on top of the true-size, half see-through one the map shows
  // (gm-play.js): ours is a small copy that follows the mouse, and steps aside where a zone shows its own.
  const DragPic = (() => {
    const blank = new Image();
    blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    let cur = null; // { asset, el, t0, over }
    const zones = []; // { test(e), move(e, asset) -> true when it shows the thing itself, leave() }
    let inZone = null;
    function start(e, asset, from) {
      end();
      if (!asset || !asset.path) return;
      try { e.dataTransfer.setDragImage(blank, 0, 0); } catch {}
      const im = from && (from.matches && from.matches('img') ? from : from.querySelector && from.querySelector('img'));
      const src = im && (im.currentSrc || im.src);
      const el = h('div', { class: 'drag-pic' }, src ? h('img', { src, alt: '' }) : iconEl({ video: 'movie', audio: 'music' }[asset.kind] || 'photo'));
      el.style.display = 'none';
      document.body.appendChild(el);
      cur = { asset, el, t0: performance.now(), over: 0 };
    }
    function leaveZone() { if (inZone) { const z = inZone; inZone = null; try { z.leave(); } catch (err) { console.error(err); } } }
    function end() {
      leaveZone();
      if (cur) { cur.el.remove(); cur = null; }
    }
    window.addEventListener('dragover', (e) => {
      if (!cur) return;
      cur.over = performance.now();
      const z = zones.find((x) => { try { return x.test(e); } catch { return false; } }) || null;
      if (z !== inZone) leaveZone();
      let own = false;
      if (z) { inZone = z; try { own = !!z.move(e, cur.asset); } catch (err) { console.error(err); } }
      Object.assign(cur.el.style, { display: own ? 'none' : '', left: `${e.clientX}px`, top: `${e.clientY}px` });
    }, true);
    // out of the window: nothing follows (it comes back with the mouse)
    window.addEventListener('dragleave', (e) => {
      if (!cur) return;
      const out = (e.clientX <= 0 && e.clientY <= 0) || e.clientX >= innerWidth || e.clientY >= innerHeight || e.clientX < 0 || e.clientY < 0;
      if (out) { leaveZone(); cur.el.style.display = 'none'; }
    }, true);
    // the map's preview stays a moment, until the dropped thing itself is there
    const later = () => {
      const c = cur;
      if (!c) return;
      c.el.style.display = 'none';
      setTimeout(() => { if (cur === c) end(); }, 150);
    };
    window.addEventListener('drop', later, true);
    window.addEventListener('dragend', later, true);
    // the source tile was rebuilt meanwhile (no dragend reaches us): the mouse moving again means it is over
    window.addEventListener('pointermove', () => { if (cur && performance.now() - cur.t0 > 400 && performance.now() - cur.over > 300) end(); }, true);
    return {
      start, end,
      zone: (z) => { zones.push(z); },
      get asset() { return cur ? cur.asset : null; },
    };
  })();

  function pathToUrl(p) {
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = `/${s}`;
    return `file://${encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  }

  function relTime(ts) {
    if (!ts) return '';
    const d = (Date.now() - ts) / 1000;
    if (d < 90) return 'Edited just now';
    if (d < 3600) return `Edited ${Math.round(d / 60)} minutes ago`;
    if (d < 86400) return `Edited ${Math.round(d / 3600)} hours ago`;
    const days = Math.round(d / 86400);
    if (days === 1) return 'Edited yesterday';
    if (days < 30) return `Edited ${days} days ago`;
    return `Edited ${new Date(ts).toLocaleDateString()}`;
  }

  function mount(root) {
    document.body.append(tip, menu);
    toastBox = root;
  }

  // The loading icon: the little maid hurrying along with her tray, and a few words
  function loader(text = 'Loading …', { big = false } = {}) {
    return h('div', { class: `loader ${big ? 'big' : ''}`, role: 'status' }, h('img', { class: 'loader-maid', src: 'maid.webp', alt: '' }), text ? h('span', {}, text.replace(/\s*(…|\.\.\.)$/, '')) : null); // the dots dance by themselves
  }
  // a loader over the whole GM screen while something takes a moment (shown only if it takes longer than a blink)
  async function withLoader(text, job, delay = 250) {
    let el = null;
    const t = setTimeout(() => { el = h('div', { class: 'loader-back' }, loader(text, { big: true })); document.body.append(el); }, delay);
    try { return await job(); } finally { clearTimeout(t); if (el) el.remove(); }
  }

  return { $, $$, h, iconEl, wrapName, esc, clamp, round, toast, openMenu, closeMenu, menuOpen, askText, dialog, Thumbs, DragPic, pathToUrl, relTime, mount, hideTip, loader, withLoader, helpTip };
})();
