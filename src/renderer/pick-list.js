// 4.7: the big list to pick from, in a floating window: Talk → List (portraits), Tokens → List (tokens).
//   search, shelves (Favourites, Recent …) and the library's folders as chips, then a grid
//   a click does what the panel does (Talk: in or out of the conversation; Tokens: pick it up to place it),
//   the tick puts it on this chapter's Ready list or takes it off, so the small panel only shows what is prepared
'use strict';

const PickList = (() => {
  const { h, iconEl, Thumbs } = UI;
  const MAX = 300;

  // o: { bind, items () → [{ path, name, kind, thumb, rel }], pathOf (it) → [folders] (4.11; before: folderOf), rootLabel, memKey,
  //      shortName (it) → its name inside its folder, shelves [{ id, label, has (it) }],
  //      round (round thumbs: tokens), pick (it), state (it) → { on, badge }, ready { chapter (), has (path), toggle (it, on) },
  //      extra (it) → element, empty (text), foot [elements], dragCat }
  function build(o) {
    let q = ''; let filter = 'all';
    // 4.11: the folder you are in (all its subfolders show too), kept for next time; chips for the folders in it
    const memKey = o.memKey ? `pickFolder:${o.memKey}` : null;
    let at = [];
    try { if (memKey) at = JSON.parse(localStorage.getItem(memKey) || '[]') || []; } catch { at = []; }
    const pathOf = (it) => (o.pathOf ? o.pathOf(it) : [o.folderOf ? o.folderOf(it) : null].filter(Boolean));
    const goTo = (segs) => { at = segs; try { if (memKey) localStorage.setItem(memKey, JSON.stringify(at)); } catch {} chips.dataset.sig = ''; draw(); };
    const search = h('input', { type: 'search', placeholder: 'Find … (names and folders)', spellcheck: 'false', 'aria-label': 'Find' });
    const count = h('span', { class: 'pl-count' });
    const crumbs = h('div', { class: 'pl-path' });
    const chips = h('div', { class: 'pl-chips' });
    const grid = h('div', { class: `pl-grid ${o.round ? 'round' : ''}` });
    search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
    const shelves = o.shelves || [];
    const inside = (it, segs) => { const p = pathOf(it); return segs.every((sg, i) => p[i] === sg); };
    function drawChips(all) {
      // the folder you were in is gone: back to the top
      if (at.length && !all.some((it) => inside(it, at))) at = [];
      const here = all.filter((it) => inside(it, at));
      const counts = new Map();
      for (const it of here) { const sub = pathOf(it)[at.length]; if (sub) counts.set(sub, (counts.get(sub) || 0) + 1); }
      const folders = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const live = shelves.filter((s) => all.some((it) => s.has(it)));
      if (filter !== 'all' && !live.some((s) => `s:${s.id}` === filter)) filter = 'all';
      const sig = JSON.stringify([at, folders, folders.map((f) => counts.get(f)), live.map((s) => s.id), filter]);
      if (chips.dataset.sig === sig) return;
      chips.dataset.sig = sig;
      const crumb = (label, segs, on, icon) => h('button', { class: `pl-crumb ${on ? 'on' : ''}`, onclick: () => goTo(segs) }, icon ? iconEl(icon) : null, label);
      crumbs.replaceChildren(crumb(o.rootLabel || 'All', [], !at.length, 'folder'), ...at.flatMap((sg, i) => [iconEl('chevron-right', 'pl-crumb-sep'), crumb(sg.replace(/^Pack: /, ''), at.slice(0, i + 1), i === at.length - 1)]));
      crumbs.hidden = !at.length && !folders.length;
      const chip = (key, label, icon) => h('button', { class: `pl-chip ${filter === key ? 'on' : ''}`, onclick: () => { filter = filter === key ? 'all' : key; chips.dataset.sig = ''; draw(); } }, icon ? iconEl(icon) : null, label);
      chips.replaceChildren(...live.map((s) => chip(`s:${s.id}`, s.label, s.icon)),
        ...folders.map((f) => h('button', { class: 'pl-chip pl-folder', onclick: () => goTo([...at, f]) }, iconEl(f.startsWith('Pack: ') ? 'package' : 'folder'), f.replace(/^Pack: /, ''), h('b', {}, String(counts.get(f))))));
      chips.hidden = !live.length && !folders.length;
    }
    // inside its own folder (the one you are in) a name without the folder's name; elsewhere the whole name
    const nameOf = (it) => (o.shortName && !q && pathOf(it).length === at.length && inside(it, at) ? o.shortName(it) : it.name);
    function draw() {
      const all = o.items();
      drawChips(all);
      const shelf = filter.startsWith('s:') ? shelves.find((s) => `s:${s.id}` === filter) : null;
      // a search looks everywhere (names and folders); otherwise what is in this folder and its subfolders
      const words = q ? q.split(/\s+/).filter(Boolean) : [];
      const list = all.filter((it) => (!shelf || shelf.has(it)) && (words.length ? words.every((w) => String(it.name).toLowerCase().includes(w) || pathOf(it).some((f) => f.toLowerCase().includes(w))) : inside(it, at)));
      const ch = o.ready ? o.ready.chapter() : null;
      const shown = list.slice(0, MAX);
      const sig = JSON.stringify([shown.map((it) => { const st = o.state ? o.state(it) : {}; return [it.path, nameOf(it), !!st.on, st.badge || null, ch && o.ready.has(it.path), o.extraSig ? o.extraSig(it) : null]; }), ch && ch.id, ch && ch.name]);
      count.textContent = list.length > MAX ? `${MAX} of ${list.length}` : list.length === all.length ? `${all.length}` : `${list.length} of ${all.length}`;
      if (grid.dataset.sig === sig) return;
      grid.dataset.sig = sig;
      if (!all.length) { grid.replaceChildren(h('p', { class: 'hint' }, o.empty || 'Nothing here yet.')); return; }
      if (!list.length) { grid.replaceChildren(h('p', { class: 'hint' }, q ? 'Nothing with that name here.' : 'Nothing in this folder.')); return; }
      grid.replaceChildren(...shown.map((it) => {
        const st = o.state ? o.state(it) : {};
        const ready = !!(ch && o.ready.has(it.path));
        const where = pathOf(it).join(' › ').replace(/Pack: /g, '');
        const tile = h('div', { class: `pl-it ${st.on ? 'on' : ''} ${ready ? 'ready' : ''}`, role: 'button', tabindex: '0', 'data-tip': st.tip || (where ? `${where} › ${it.name}` : it.rel || it.name), 'aria-label': it.name,
          onclick: () => o.pick(it), onkeydown: (e) => { if (e.key === 'Enter') o.pick(it); }, oncontextmenu: o.menu ? (e) => o.menu(e, it) : null },
        h('span', { class: 'pl-thumb' }, Thumbs.img(it.path, it.kind || 'image', it.thumb)),
        h('span', { class: 'pl-name' }, nameOf(it)),
        q && where ? h('span', { class: 'pl-where', role: 'button', 'data-tip': 'Open this folder', onclick: (e) => { e.stopPropagation(); search.value = ''; q = ''; goTo(pathOf(it)); } }, where) : null,
        st.badge ? h('b', { class: 'pl-badge' }, st.badge) : null,
        ch ? h('button', { class: `pl-tick ${ready ? 'on' : ''}`, 'aria-label': ready ? `${it.name}: ready for ${ch.name} (click to take it off)` : `Get ${it.name} ready for ${ch.name}`,
          'data-tip': ready ? `Ready for ${ch.name}: click to take it off` : `Get it ready for ${ch.name}`, onclick: (e) => { e.stopPropagation(); o.ready.toggle(it, !ready); } }, iconEl('check')) : null,
        o.extra ? o.extra(it) : null);
        if (o.dragCat) {
          tile.draggable = true;
          tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ts-asset', JSON.stringify({ path: it.path, name: it.name, cat: o.dragCat, kind: it.kind || 'image' })); e.dataTransfer.effectAllowed = 'copy'; });
        }
        return tile;
      }));
    }
    o.bind(draw);
    return h('div', { class: 'pl' }, h('div', { class: 'pl-top' }, search, count), crumbs, chips, grid, o.foot && o.foot.length ? h('div', { class: 'pl-foot' }, ...o.foot) : null);
  }
  // a library item's folder for the chips: "Villains" for Portraits/Villains/…, a pack's name for Packs/<pack>/…
  function folderOf(it, top) {
    const p = String(it.rel || '').split('/');
    if (p[0] === 'Packs' && p.length > 2) return p[1];
    if (p[0] === top && p.length > 2) return p[1];
    return null;
  }
  // 4.11: all its folders below the category's own one (as the library shows them)
  const pathOf = (it) => (typeof LibraryDrawer === 'object' ? LibraryDrawer.foldersOf(it) : [folderOf(it, '')].filter(Boolean));
  const shortName = (it) => (typeof LibraryDrawer === 'object' ? LibraryDrawer.shortName(it) : it.name);
  return { build, folderOf, pathOf, shortName };
})();
