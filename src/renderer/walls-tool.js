// The Walls tool (W) on the GM screen: walls, rooms, doors; line of sight settings;
// walls from Dungeon Alchemist, Dungeondraft (Universal VTT) and Foundry VTT files.
//   Walls  click from corner to corner (double-click, Enter, Esc or right-click ends the line)
//   Room   drag a rectangle: four walls
//   Door   click a wall to put a door into it, or draw one from end to end
//   Edit   drag wall ends (walls that meet there move along), drag a wall to move it; click a wall to select it
//          (corners can also be dragged in Walls mode: a click on a corner starts a new line there, a drag moves it)
//   Erase  click a wall, or drag a box over several
// Doors: in the Walls tool a click opens or closes one. In the Play tools (Select, Tokens, Fog, Party, Spells) a door is
// a lock on the map: a click asks "Open the door?" Yes / No (Prototype 4). Players never see walls or door markers.
// gm-play.js owns the canvas input and hands the pointer to this tool.
'use strict';

const WallsTool = (() => {
  const { h, iconEl, toast, openMenu, clamp, round } = UI;
  const ts = window.ts;
  const MODES = [
    { value: 'wall', label: 'Walls', icon: 'wall', tip: 'Click from corner to corner. Double-click, Enter or right-click ends the line' },
    { value: 'room', label: 'Room', icon: 'border-outer', tip: 'Drag a rectangle: four walls at once' },
    { value: 'door', label: 'Door', icon: 'door', tip: 'Click a wall to put a door into it, or drag to draw one' },
    { value: 'edit', label: 'Edit', icon: 'vector', tip: 'Drag a corner or a whole wall. Click a wall to select it' },
    { value: 'erase', label: 'Erase', icon: 'eraser', tip: 'Click a wall to remove it, or drag a box over several' },
  ];
  const PLAY_TOOLS = ['select', 'token', 'fog', 'party', 'spell'];
  const KIND_ICON = { wall: 'wall', window: 'window', invisible: 'ghost' }; // (Prototype 14)
  const OWN = new Set(['wallclick', 'wallroom', 'walldoor', 'wallend', 'wallmove', 'wallbox']);

  function create(ctx) {
    const { ui, cmd, undoable } = ctx;
    const S = () => ctx.state();
    const view = () => ctx.view();
    const map = () => (S() ? S().map : null);
    const c = () => ctx.ctl;
    const prefs = { mode: 'wall', snap: true, door: 1, kind: 'wall' }; // (Prototype 14: kind: wall | window | invisible)
    try { Object.assign(prefs, JSON.parse(localStorage.getItem('wallPrefs') || '{}')); } catch {}
    ui.walls = { ...prefs, chain: null, sel: null, hover: null };
    const W = ui.walls;
    const save = () => { try { localStorage.setItem('wallPrefs', JSON.stringify({ mode: W.mode, snap: W.snap, door: W.door, kind: W.kind })); } catch {} };
    const kindArg = () => (W.kind === 'window' || W.kind === 'invisible' ? { kind: W.kind } : {});
    const wallOf = (id) => (map() && id ? map().walls.find((w) => w.id === id) || null : null);
    const pxIn = () => 1 / (view().cam.s * view().ppi * map().view.zoom); // one screen pixel in map inches

    // ---------- snapping: ends of other walls first, then grid corners ----------
    function snapPt(p, e, skip) {
      if (e && e.altKey) return { x: p.x, y: p.y, snapped: false };
      const tol = 11 * pxIn();
      let best = null; let bd = tol;
      for (const w of map().walls) {
        if (skip && skip.has(w.id)) continue;
        for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bd) { bd = d; best = { x, y, snapped: true, end: true }; }
        }
      }
      if (best) return best;
      // Prototype 14: anywhere along another wall (a grid point on it first): a new wall ending there joins it (a T)
      let line = null; let ld = tol;
      for (const w of map().walls) {
        if (w.door || (skip && skip.has(w.id))) continue;
        const ex = w.x2 - w.x1; const ey = w.y2 - w.y1; const L2 = ex * ex + ey * ey;
        if (!(L2 > 0)) continue;
        const t = Math.max(0, Math.min(1, ((p.x - w.x1) * ex + (p.y - w.y1) * ey) / L2));
        const qx = w.x1 + ex * t; const qy = w.y1 + ey * t; const d = Math.hypot(qx - p.x, qy - p.y);
        if (d < ld) { ld = d; line = { w, x: qx, y: qy, ex, ey, L2 }; }
      }
      if (line) {
        const g0 = map().grid;
        if (W.snap && !Geom.isHex(g0)) { // a grid corner (or half) that lies on this wall, near the pointer
          const { u, v } = Geom.toLocal(g0, line.x, line.y); const st = g0.size / 2;
          for (const [du, dv] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const q = Geom.fromLocal(g0, (Math.round(u / st) + du) * st, (Math.round(v / st) + dv) * st);
            const t = ((q.x - line.w.x1) * line.ex + (q.y - line.w.y1) * line.ey) / line.L2;
            if (t <= 0 || t >= 1) continue;
            const on = Math.hypot(line.w.x1 + line.ex * t - q.x, line.w.y1 + line.ey * t - q.y);
            if (on < 0.01 && Math.hypot(q.x - p.x, q.y - p.y) < tol) return { x: round(q.x, 3), y: round(q.y, 3), snapped: true, wall: true };
          }
        }
        return { x: round(line.x, 3), y: round(line.y, 3), snapped: true, wall: true };
      }
      const g = map().grid;
      if (W.snap && !Geom.isHex(g)) {
        const { u, v } = Geom.toLocal(g, p.x, p.y);
        const s = g.size;
        // corners, and the middle of each side (for half-square walls)
        const step = s / 2;
        const q = Geom.fromLocal(g, Math.round(u / step) * step, Math.round(v / step) * step);
        return { x: round(q.x, 3), y: round(q.y, 3), snapped: true };
      }
      return { x: p.x, y: p.y, snapped: false };
    }

    // ---------- drawing a line of walls ----------
    function endChain() {
      if (!W.chain) return false;
      W.chain = null;
      view().setWallPreview(null);
      return true;
    }
    const chainActive = () => !!W.chain;
    function addSeg(a, b, extra = {}) {
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.02) return null;
      return cmd('wall.add', { segs: [[a.x, a.y, b.x, b.y]], coalesce: W.chain ? W.chain.key : null, ...kindArg(), ...extra });
    }

    // ---------- doors ----------
    // where a door goes when you click a wall: one square, lined up with the grid on straight walls
    function doorSpan(w, p) {
      const g = map().grid;
      const ex = w.x2 - w.x1; const ey = w.y2 - w.y1;
      const L = Math.hypot(ex, ey);
      const size = Math.min(L, g.size);
      const t = clamp(((p.x - w.x1) * ex + (p.y - w.y1) * ey) / (L * L), 0, 1);
      let c0 = t * L - size / 2;
      if (!Geom.isHex(g)) {
        // straight along the grid: the door fills the square that was clicked
        const a = Geom.toLocal(g, w.x1, w.y1); const b = Geom.toLocal(g, w.x2, w.y2);
        const axis = Math.abs(b.u - a.u) > Math.abs(b.v - a.v) ? 'u' : 'v';
        const other = axis === 'u' ? 'v' : 'u';
        if (Math.abs(b[other] - a[other]) < 0.02 * g.size) {
          const pc = Geom.toLocal(g, p.x, p.y)[axis];
          const cell = Math.floor(pc / g.size) * g.size;
          const dir = Math.sign(b[axis] - a[axis]) || 1;
          c0 = dir > 0 ? cell - a[axis] : a[axis] - (cell + g.size);
        }
      }
      c0 = clamp(c0, 0, L - size);
      return { t0: c0 / L, t1: (c0 + size) / L };
    }
    function toggleDoor(id) { return cmd('wall.door', { id }); }
    // Prototype 4: a click on a lock in a Play tool asks first (a slip of the mouse shows the players the next room)
    let ask = null;
    function closeAsk() {
      if (!ask) return;
      ask.el.remove(); document.removeEventListener('keydown', ask.key, true); document.removeEventListener('pointerdown', ask.out, true);
      ask = null;
    }
    function askDoor(id) {
      closeAsk();
      const w = map() && (map().walls || []).find((x) => x.id === id);
      const mark = document.querySelector(`.sv-door[data-id="${id}"]`);
      if (!w || !mark) return;
      const go = () => { closeAsk(); toggleDoor(id); };
      const yes = h('button', { class: 'btn small primary', onclick: go }, 'Yes');
      const no = h('button', { class: 'btn small', onclick: closeAsk }, 'No');
      const el = h('div', { class: 'door-ask', role: 'dialog', 'aria-label': 'Door' },
        h('b', {}, !w.door ? (w.shut ? 'Open the window?' : 'Close the window?') : w.open ? 'Close the door?' : w.door === 2 ? 'Open the secret door?' : 'Open the door?'), h('div', { class: 'door-ask-btns' }, yes, no));
      document.body.append(el);
      const r = mark.getBoundingClientRect(); const b = el.getBoundingClientRect();
      const x = clamp(r.left + r.width / 2 - b.width / 2, 8, window.innerWidth - b.width - 8);
      const above = r.top - b.height - 10;
      el.style.left = `${round(x)}px`; el.style.top = `${round(above > 8 ? above : r.bottom + 10)}px`;
      ask = {
        el, id,
        key: (e) => {
          const k = e.key.toLowerCase();
          if (k === 'enter' || k === 'y') { e.preventDefault(); e.stopPropagation(); go(); } else if (k === 'escape' || k === 'n') { e.preventDefault(); e.stopPropagation(); closeAsk(); }
        },
        out: (e) => { if (!el.contains(e.target)) closeAsk(); },
      };
      document.addEventListener('keydown', ask.key, true);
      setTimeout(() => { if (ask && ask.el === el) document.addEventListener('pointerdown', ask.out, true); }, 0);
      yes.focus();
    }

    // ---------- corners ----------
    // the corner under the pointer (within 10 screen pixels), with every wall end that meets there
    function cornerAt(pt) {
      const m = map();
      const tol = 10 * pxIn();
      let at = null; let bd = tol;
      for (const w of m.walls) {
        for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { const d = Math.hypot(x - pt.x, y - pt.y); if (d < bd) { bd = d; at = { x, y }; } }
      }
      return at ? { at, ends: endsAt(at) } : null;
    }
    function endsAt(at) {
      const ends = [];
      for (const w of map().walls) {
        if (Math.hypot(w.x1 - at.x, w.y1 - at.y) < 1e-3) ends.push({ id: w.id, k: 1 });
        if (Math.hypot(w.x2 - at.x, w.y2 - at.y) < 1e-3) ends.push({ id: w.id, k: 2 });
      }
      return ends;
    }
    function grabCorner(c, e, fallback) {
      return { kind: 'wallend', at: c.at, ends: c.ends, skip: new Set(c.ends.map((q) => q.id)), key: `wallend-${Date.now()}`, moved: false, sx: e.clientX, sy: e.clientY, fallback };
    }
    // patches for wall ends moved by (dx, dy) from where they were
    function movePatches(groups) {
      const by = new Map();
      for (const g of groups) {
        for (const q of g.ends) {
          const o = by.get(q.id) || { id: q.id };
          if (q.k === 1) { o.x1 = round(g.to.x, 3); o.y1 = round(g.to.y, 3); } else { o.x2 = round(g.to.x, 3); o.y2 = round(g.to.y, 3); }
          by.set(q.id, o);
        }
      }
      return [...by.values()];
    }

    // ---------- pointer ----------
    function pointerDown(e, pt) {
      const m = map();
      if (!m) return null;
      const doorEl = e.target.closest && e.target.closest('.sv-door');
      if (doorEl && W.mode !== 'edit' && W.mode !== 'erase') { toggleDoor(doorEl.dataset.id); return null; }
      switch (W.mode) {
        case 'wall': {
          if (e.detail >= 2 && W.chain) { endChain(); return null; } // double-click ends the line
          // on a corner: a drag moves it, a click starts a new line there
          if (!W.chain) { const cn = cornerAt(pt); if (cn) return grabCorner(cn, e, 'wall'); }
          const p = snapPt(pt, e);
          if (!W.chain) {
            W.chain = { pts: [p], key: `chain-${Date.now()}` };
          } else {
            const last = W.chain.pts[W.chain.pts.length - 1];
            addSeg(last, p);
            W.chain.pts.push(p);
            const first = W.chain.pts[0];
            if (W.chain.pts.length > 2 && Math.hypot(p.x - first.x, p.y - first.y) < 1e-3) { endChain(); return null; } // closed a loop
          }
          hover(e, pt);
          return { kind: 'wallclick' };
        }
        case 'room': {
          const p = snapPt(pt, e);
          return { kind: 'wallroom', a: p, b: p };
        }
        case 'door': {
          const w = view().wallAtScreen(e.clientX, e.clientY, 10, (x) => !x.door);
          if (w) {
            const sp = doorSpan(w, pt);
            cmd('wall.split', { id: w.id, t0: sp.t0, t1: sp.t1, door: W.door });
            return null;
          }
          const d = view().wallAtScreen(e.clientX, e.clientY, 10, (x) => x.door);
          if (d) { toggleDoor(d.id); return null; }
          const p = snapPt(pt, e);
          return { kind: 'walldoor', a: p, b: p };
        }
        case 'edit': {
          if (doorEl) { select(doorEl.dataset.id); return null; }
          // grab the end of a wall: every wall meeting there moves along
          const cn = cornerAt(pt);
          if (cn) return grabCorner(cn, e, null);
          const w = view().wallAtScreen(e.clientX, e.clientY, 9);
          select(w ? w.id : null);
          // drag a wall: it moves with both corners (walls joined there stretch along)
          if (w) {
            const a = { x: w.x1, y: w.y1 }; const b = { x: w.x2, y: w.y2 };
            const ea = endsAt(a); const eb = endsAt(b);
            return { kind: 'wallmove', id: w.id, a, b, ea, eb, p0: pt, skip: new Set([...ea, ...eb].map((q) => q.id)), key: `wallmove-${Date.now()}`, moved: false, sx: e.clientX, sy: e.clientY };
          }
          return null;
        }
        case 'erase': {
          const w = (doorEl && wallOf(doorEl.dataset.id)) || view().wallAtScreen(e.clientX, e.clientY, 10);
          if (w) { undoable('wall.remove', { ids: [w.id] }); return null; }
          return { kind: 'wallbox', a: pt, b: pt };
        }
        default: return null;
      }
    }
    function pointerMove(d, e, pt) {
      if (d.kind === 'wallroom' || d.kind === 'walldoor') {
        d.b = snapPt(pt, e);
        view().setWallPreview({ segs: d.kind === 'wallroom' ? roomSegs(d.a, d.b) : [[d.a.x, d.a.y, d.b.x, d.b.y]], door: d.kind === 'walldoor', kind: d.kind === 'wallroom' ? kindArg().kind : null, at: d.b, snapped: d.b.snapped, onWall: !!d.b.wall });
      } else if (d.kind === 'wallend') {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
        if (!d.moved) return;
        const p = snapPt(pt, e, d.skip);
        d.to = p;
        ctx.send(d.key, 'wall.many', { patches: d.ends.map((q) => (q.k === 1 ? { id: q.id, x1: p.x, y1: p.y } : { id: q.id, x2: p.x, y2: p.y })) });
        view().setWallPreview({ at: p, snapped: p.snapped });
      } else if (d.kind === 'wallmove') {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
        if (!d.moved) return;
        // the first corner snaps (other walls' ends, the grid); the whole wall keeps its shape
        const q = snapPt({ x: d.a.x + pt.x - d.p0.x, y: d.a.y + pt.y - d.p0.y }, e, d.skip);
        const dx = q.x - d.a.x; const dy = q.y - d.a.y;
        d.patches = movePatches([{ ends: d.ea, to: q }, { ends: d.eb, to: { x: d.b.x + dx, y: d.b.y + dy } }]);
        ctx.send(d.key, 'wall.many', { patches: d.patches });
        view().setWallPreview({ at: q, snapped: q.snapped });
      } else if (d.kind === 'wallbox') {
        d.b = pt;
        view().setWallPreview({ box: rectOf(d.a, d.b) });
      }
    }
    function pointerUp(d, e, pt) {
      if (d.kind === 'wallroom') {
        const b = snapPt(pt, e);
        view().setWallPreview(null);
        if (Math.abs(b.x - d.a.x) > 0.05 && Math.abs(b.y - d.a.y) > 0.05) cmd('wall.add', { segs: roomSegs(d.a, b), ...kindArg() });
      } else if (d.kind === 'walldoor') {
        const b = snapPt(pt, e);
        view().setWallPreview(null);
        if (Math.hypot(b.x - d.a.x, b.y - d.a.y) > 0.1) cmd('wall.add', { segs: [[d.a.x, d.a.y, b.x, b.y]], door: W.door });
      } else if (d.kind === 'wallend') {
        view().setWallPreview(null);
        if (d.moved && d.to) {
          ctx.pending.delete(d.key);
          const p = d.to;
          cmd('wall.many', { coalesce: d.key, patches: d.ends.map((q) => (q.k === 1 ? { id: q.id, x1: p.x, y1: p.y } : { id: q.id, x2: p.x, y2: p.y })) });
        } else if (!d.moved && d.fallback === 'wall') {
          // a click on a corner (no drag): a new line of walls starts there
          W.chain = { pts: [{ x: d.at.x, y: d.at.y, snapped: true, end: true }], key: `chain-${Date.now()}` };
          hover(e, pt);
        }
      } else if (d.kind === 'wallmove') {
        view().setWallPreview(null);
        if (d.moved && d.patches) {
          ctx.pending.delete(d.key);
          cmd('wall.many', { coalesce: d.key, patches: d.patches });
        }
      } else if (d.kind === 'wallbox') {
        view().setWallPreview(null);
        const r = rectOf(d.a, pt);
        const ids = map().walls.filter((w) => segInRect(w, r)).map((w) => w.id);
        if (ids.length) undoable('wall.remove', { ids });
      }
    }
    function hover(e, pt) {
      if (ui.tool !== 'walls' || !map()) return;
      // over a corner it can be grabbed
      document.body.classList.toggle('wall-grab', !W.chain && (W.mode === 'wall' || W.mode === 'edit') && !!cornerAt(pt));
      if (W.mode === 'wall') {
        const p = snapPt(pt, e);
        const last = W.chain && W.chain.pts[W.chain.pts.length - 1];
        view().setWallPreview({ segs: last ? [[last.x, last.y, p.x, p.y]] : [], at: p, snapped: p.snapped, onWall: !!p.wall, kind: kindArg().kind });
      } else if (W.mode === 'room' || W.mode === 'door') {
        const p = snapPt(pt, e);
        view().setWallPreview({ at: p, snapped: p.snapped, onWall: !!p.wall });
      } else if (view().wallPreview) view().setWallPreview(null);
    }
    function leave() { document.body.classList.remove('wall-grab'); if (!W.chain && view().wallPreview) view().setWallPreview(null); }
    function toolChanged(t) {
      if (t !== 'walls') { endChain(); select(null); document.body.classList.remove('wall-grab'); if (view().wallPreview) view().setWallPreview(null); }
      closeAsk();
      view().setWallMode(t === 'walls' ? 'edit' : PLAY_TOOLS.includes(t) ? 'doors' : false); // (Prototype 4: the locks show in every Play tool)
    }
    function select(id) {
      W.sel = id;
      view().setWallSelected(id);
    }
    function setMode(m) {
      endChain();
      W.mode = m;
      save();
      if (ui.tool !== 'walls') ctx.setTool('walls');
      if (ctx.popId() === 'walls') ctx.openPop('walls'); // the hint and options depend on the mode
      if (view().wallPreview) view().setWallPreview(null);
    }
    function cycle() {
      const i = MODES.findIndex((x) => x.value === W.mode);
      setMode(MODES[(i + 1) % MODES.length].value);
      return MODES.find((x) => x.value === W.mode).label;
    }
    function removeSelected() {
      if (!W.sel || !wallOf(W.sel)) return false;
      undoable('wall.remove', { ids: [W.sel] });
      select(null);
      return true;
    }
    // Enter / Esc while drawing end the line of walls
    function key(k) {
      if ((k === 'enter' || k === 'escape') && W.chain) { endChain(); return true; }
      if ((k === 'delete' || k === 'backspace') && ui.tool === 'walls') return removeSelected();
      return false;
    }

    // right-click on a wall or a door
    function radial(w, x, y) {
      if (!w) return false;
      select(ui.tool === 'walls' ? w.id : null);
      const items = w.door
        ? [
          { icon: w.open ? 'door' : 'door-enter', label: w.open ? 'Close' : 'Open', run: () => toggleDoor(w.id) },
          { icon: 'eye-off', label: w.door === 2 ? 'Normal door' : 'Secret door', run: () => cmd('wall.update', { id: w.id, door: w.door === 2 ? 1 : 2 }) },
          { icon: 'wall', label: 'Make it a wall', run: () => cmd('wall.update', { id: w.id, door: 0 }) },
          { icon: 'plus', label: 'Put on the hotbar', run: () => Hotbar.add({ kind: 'door', ref: { map: map().id, id: w.id }, label: w.door === 2 ? 'Secret door' : 'Door', icon: 'door' }) }, // Prototype 25
          { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('wall.remove', { ids: [w.id] }) },
        ]
        : [
          // Beta 3.1: a window opens and closes like a door
          ...(w.kind === 'window' ? [{ icon: w.shut ? 'window' : 'window-off', label: w.shut ? 'Open the window' : 'Close the window', run: () => toggleDoor(w.id) },
            { icon: 'plus', label: 'Put on the hotbar', run: () => Hotbar.add({ kind: 'door', ref: { map: map().id, id: w.id }, label: 'Window', icon: 'window' }) }] : []),
          // Prototype 14: what kind of wall it is
          ...['wall', 'window', 'invisible'].filter((k) => k !== (w.kind || 'wall')).map((k) => ({ icon: KIND_ICON[k], label: k === 'wall' ? 'Make it a wall' : k === 'window' ? 'Make it a window' : 'Make it invisible', run: () => cmd('wall.update', { id: w.id, kind: k === 'wall' ? null : k }) })),
          { icon: 'door', label: 'Door here', run: () => { const cx = (w.x1 + w.x2) / 2; const cy = (w.y1 + w.y2) / 2; const sp = doorSpan(w, { x: cx, y: cy }); cmd('wall.split', { id: w.id, t0: sp.t0, t1: sp.t1, door: 1 }); } },
          { icon: 'door', label: 'Whole wall a door', run: () => cmd('wall.update', { id: w.id, door: 1 }) },
          { icon: 'trash', label: 'Remove', danger: true, run: () => undoable('wall.remove', { ids: [w.id] }) },
        ];
      ctx.Radial.open(x, y, items, w.door ? (w.door === 2 ? 'Secret door' : 'Door') : w.kind === 'window' ? (w.shut ? 'Window (closed)' : 'Window') : w.kind === 'invisible' ? 'Invisible wall' : 'Wall');
      return true;
    }

    // ---------- walls from a file ----------
    async function loadFile(path, scene) {
      if (!path) { path = await ts.pickFile('walls'); if (!path) return null; }
      const r = await cmd('walls.load', { path, scene });
      if (r && r.choose) {
        // a Foundry file with several scenes: which one?
        const el = document.querySelector('#pop .wl-load');
        const rc = el ? el.getBoundingClientRect() : { left: innerWidth / 2, bottom: innerHeight / 2 };
        openMenu(rc.left, rc.bottom + 4, [{ header: 'Which scene?' }, ...r.choose.map((x) => ({ label: `${x.name} (${x.walls} walls)`, icon: 'map-2', action: () => loadFile(path, x.name) }))]);
        return r;
      }
      if (r && r.ok) toast(r.label || 'Walls loaded', { undo: () => cmd('history.undo'), ms: 6000 });
      else if (r && r.error) toast(r.error, { kind: 'error' });
      return r;
    }

    // ---------- popover ----------
    function buildPop() {
      const { seg, toggle, slider, btn, row, hint, sep, bind } = c();
      const out = [
        seg({ cls: 'seg-4 wl-modes', options: MODES, get: () => W.mode, set: setMode }),
      ];
      // Prototype 14: what the walls and rooms are: walls, windows (see through, no walking through), invisible (only feet stop)
      if (W.mode === 'wall' || W.mode === 'room') out.push(seg({ label: 'Kind', options: [
        { value: 'wall', label: 'Wall', icon: KIND_ICON.wall, tip: 'Stops sight, light and feet' },
        { value: 'window', label: 'Window', icon: KIND_ICON.window, tip: 'Nobody walks through. Open, sight and light pass; closed, they stop. Its window icon opens and closes it' },
        { value: 'invisible', label: 'Invisible', icon: KIND_ICON.invisible, tip: 'Only feet stop: cliffs, deep water, rubble, a magic barrier. Never on the table' }],
        get: () => W.kind || 'wall', set: (v) => { W.kind = v; save(); } }));
      if (W.mode === 'door') out.push(seg({ label: 'Kind', options: [{ value: 1, label: 'Door', icon: 'door' }, { value: 2, label: 'Secret door', icon: 'eye-off', tip: 'Marked for you in another colour (players never see walls or doors anyway)' }], get: () => W.door, set: (v) => { W.door = v; save(); ctx.refreshPop(); } }));
      out.push(toggle({ label: 'Snap to the grid', get: () => W.snap, set: (v) => { W.snap = v; save(); } }));
      out.push(sep());
      // line of sight
      out.push(toggle({ label: 'Line of sight', get: () => map().vision.on, set: (v) => cmd('vision.update', { on: v }) }));
      const status = h('p', { class: 'hint wl-status' });
      bind(() => {
        const mm = map();
        const doors = mm.walls.filter((w) => w.door).length;
        const eyes = Vision.eyes(mm).length;
        status.textContent = !mm.walls.length ? 'No walls yet. Lights and the party see everything.'
          : `${mm.walls.length - doors} walls, ${doors} door${doors === 1 ? '' : 's'}. ${mm.vision.on ? `Lights stop at walls${eyes ? `; the party sees from ${eyes === 1 ? 'its party light' : `${eyes} party lights`}` : ''}.` : 'Line of sight is off.'}`;
      });
      out.push(status);
      out.push(h('div', { class: 'ctl-row' }, h('span', { class: 'hint grow' }, 'The party sees and explores from Play → Party marker (U).'),
        btn('Party marker', 'users-group', () => { ctx.setTool('party'); ctx.openPop('party'); }, { kind: 'small', tip: 'Put the party on the map, its light and darkvision' })));
      out.push(slider({ label: 'Explored, out of sight', min: 0, max: 0.9, step: 0.05, get: () => map().vision.dim, set: (v, k) => ctx.send(k, 'vision.update', { dim: v }), fmt: (v) => (v < 0.03 ? 'Clear' : `${Math.round(v * 100)}% darker`) }));
      out.push(sep());
      out.push(row(
        btn('Load walls from a file', 'file-import', () => loadFile(), { kind: 'wl-load grow', tip: 'Dungeon Alchemist, Dungeondraft, Dungeon Fog, Arkenforge (Universal VTT: .dd2vtt, .uvtt) or Foundry VTT (.json, .db)' }),
        ctx.ctl.ib('trash', 'Remove all walls', () => undoable('wall.clear', {}), { tip: 'Remove all walls and doors' })));
      return h('div', { class: 'stack' }, ...out);
    }
    return {
      pointerDown, pointerMove, pointerUp, hover, leave, toolChanged, owns: (k) => OWN.has(k), buildPop, cycle, key, radial,
      endChain, chainActive, toggleDoor, askDoor, closeAsk, loadFile, select, removeSelected, MODES,
    };
  }

  function roomSegs(a, b) {
    return [[a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y], [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]];
  }
  function rectOf(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }; }
  // does a wall touch a rectangle?
  function segInRect(w, r) {
    const inside = (x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (inside(w.x1, w.y1) || inside(w.x2, w.y2)) return true;
    const edges = [[r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h], [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]];
    const cross = (a, b, c, d) => {
      const o = (p, q, s) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    return edges.some((e) => cross([w.x1, w.y1], [w.x2, w.y2], [e[0], e[1]], [e[2], e[3]]));
  }

  return { create, MODES, PLAY_TOOLS };
})();
