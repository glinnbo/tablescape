// The Party tool (Play, U): where the party is on the map. As it moves it reveals the fog: with walls
// what it can see (line of sight), without walls a circle around it. Its settings: the light it carries,
// darkvision, how far it sees, locked to the grid. Several parties for a split group, each in its own colour.
//   drag the party (or click where it goes); arrow keys move it one square
// A party is a light on the map (fx kind 'light', preset 'party'); vision.js turns it into what the party sees.
'use strict';

const PartyTool = (() => {
  const { h, iconEl, toast, round } = UI;
  // what the party carries (5e): the light sets its bright and dim reach (mapstate.js CARRY)
  const CARRY = [
    { id: 'none', label: 'None', icon: 'circle-off', tip: 'No light of their own' },
    { id: 'candle', label: 'Candle', icon: 'candle', tip: '5 ft bright, 5 ft dim' },
    { id: 'torch', label: 'Torch', icon: 'flame', tip: '20 ft bright, 20 ft dim' },
    { id: 'lantern', label: 'Lantern', icon: 'lamp', tip: 'Hooded lantern: 30 ft bright, 30 ft dim' },
    { id: 'light', label: 'Light', icon: 'sparkles', tip: 'The Light cantrip: 20 ft bright, 20 ft dim' },
    { id: 'daylight', label: 'Daylight', icon: 'sun', tip: 'The Daylight spell: 60 ft bright, 60 ft dim' },
  ];
  const COLORS = ['#ffcf8a', '#8fd3ff', '#b5f28c', '#ff9fd2', '#d7b4ff'];
  const CARRY_FT = { none: 0, candle: 10, torch: 40, lantern: 60, light: 40, daylight: 120 };
  const OPEN_FT = 30; // vision.js: without walls the party sees this far unless its range says otherwise

  function create(ctx) {
    const { ui, cmd, undoable, send, pending } = ctx;
    const S = () => ctx.state();
    const map = () => (S() ? S().map : null);
    const view = () => ctx.view();
    const c = () => ctx.ctl;
    ui.party = { sel: null, placing: false };
    const parties = () => (map() ? map().fx.filter((f) => f.kind === 'light' && f.preset === 'party' && !f.eye) : []); // (Prototype 17: the player tokens' eyes are not parties)
    const current = () => { const list = parties(); return list.find((f) => f.id === ui.party.sel) || list[0] || null; };
    const walled = () => { const m = map(); return !!(m && m.vision && m.vision.on && m.walls && m.walls.length); };
    function select(id) {
      ui.party.sel = id;
      view().selectFx(id);
      ctx.refreshPop();
    }
    // the light it carries (a party from an older map: the one matching its reach)
    function carryOf(f) {
      if (!f) return null;
      if (f.carry) return f.carry;
      const hit = { 'none': [0, 0], candle: [5, 10], torch: [20, 40], lantern: [30, 60], daylight: [60, 120] };
      return Object.keys(hit).find((k) => hit[k][0] === (f.bright || 0) && hit[k][1] === (f.dim || 0)) || 'custom';
    }
    const at = (f, x, y) => {
      const q = f && f.snap === false ? { x, y } : Geom.snap(map().grid, x, y, 1);
      return { x: round(q.x, 3), y: round(q.y, 3) };
    };

    // ---------- placing: the button arms it, the party follows the mouse with the ring of what it will see,
    //            and only the click on the map puts it down (Esc cancels); a map without a party is armed by itself ----------
    let ghost = null;
    const armed = () => ui.tool === 'party' && !!map() && (ui.party.placing || !parties().length);
    function arm(on) {
      ui.party.placing = !!on;
      if (!on) hideGhost();
      ctx.refreshPop();
      if (on) toast('Click on the map where the party stands (Esc: cancel)', { ms: 3500 });
    }
    function cancel() {
      if (!ui.party.placing) return false;
      arm(false);
      return true;
    }
    function hideGhost() { if (ghost) ghost.style.display = 'none'; document.body.classList.remove('placing-party'); }
    // how far the new party will see: without walls the circle it reveals, with walls the reach of its torch
    const ringFt = () => (walled() ? CARRY_FT.torch : OPEN_FT);
    function hover(e, pt) {
      if (!armed() || !pt) { hideGhost(); return; }
      const v = view();
      if (!ghost) ghost = h('div', { class: 'party-ghost' }, h('span', { class: 'party-ghost-dot' }, iconEl('users-group')));
      if (ghost.parentNode !== v.marks) v.marks.appendChild(ghost);
      const q = at(null, pt.x, pt.y);
      const R = (ringFt() / 5) * map().grid.size;
      const a = v.mapToPx(q.x, q.y); const b = v.mapToPx(q.x + R, q.y);
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      Object.assign(ghost.style, { display: '', left: `${a.x}px`, top: `${a.y}px`, width: `${2 * r}px`, height: `${2 * r}px`, borderWidth: `${1.5 / v.cam.s}px` });
      ghost.style.setProperty('--inv', String(1 / v.cam.s)); // the marker in the middle keeps its size on screen
      document.body.classList.add('placing-party');
    }
    function leave() { hideGhost(); }

    async function addParty(where) {
      const list = parties();
      const p = where || ctx.viewCenter();
      const q = at(null, p.x, p.y);
      const r = await cmd('fx.add', {
        kind: 'light', preset: 'party', x: q.x, y: q.y, carry: 'torch', snap: true, intensity: 1, flicker: false, sat: 0.25,
        color: COLORS[list.length % COLORS.length], name: list.length ? `Party ${list.length + 1}` : 'Party',
      });
      if (r && r.selected) select(r.selected);
      if (r && r.ok && !list.length) toast('The party is on the map. Drag it or use the arrow keys.', { ms: 5000 });
      return r;
    }

    // ---------- pointer ----------
    function pointerDown(e, pt) {
      if (!map()) return null;
      const hEl = e.target.closest && e.target.closest('.sv-handle');
      const f = hEl && parties().find((x) => x.id === hEl.dataset.id);
      if (f) {
        if (ui.party.sel !== f.id) select(f.id);
        const p = view().fxPos(f);
        return { kind: 'partymove', id: f.id, dx: p.x - pt.x, dy: p.y - pt.y, sx: e.clientX, sy: e.clientY, moved: false, key: `party-${f.id}-${Date.now()}` };
      }
      // armed: this click puts the party down here
      if (armed()) {
        ui.party.placing = false;
        hideGhost();
        addParty(pt);
        return null;
      }
      const cur = current();
      if (!cur) return null;
      // a click on the map: the party goes there
      const q = at(cur, pt.x, pt.y);
      keyAt = null;
      cmd('fx.update', { id: cur.id, x: q.x, y: q.y, attachTo: null, final: true });
      return null;
    }
    function pointerMove(d, e, pt) {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      if (!d.moved) return;
      const f = parties().find((x) => x.id === d.id);
      if (!f) return;
      const q = at(f, pt.x + d.dx, pt.y + d.dy);
      if (d.last && d.last.x === q.x && d.last.y === q.y) return; // on the grid it jumps from square to square
      d.last = q;
      send(d.key, 'fx.update', { id: d.id, x: q.x, y: q.y, attachTo: null });
    }
    function pointerUp(d, e, pt) {
      if (!d.moved) return;
      pending.delete(d.key);
      const f = parties().find((x) => x.id === d.id);
      if (!f) return;
      const q = at(f, pt.x + d.dx, pt.y + d.dy);
      keyAt = null;
      cmd('fx.update', { id: d.id, x: q.x, y: q.y, attachTo: null, coalesce: d.key, final: true });
    }
    // arrow keys: one square that way (along the grid, also when it is turned). Quick presses go on from the
    // square the last one was sent to, so none is lost while the map's state is still on its way back.
    let keyAt = null; // { id, x, y, t }
    function key(e) {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir || !map()) return false;
      const f = current();
      if (!f) return false;
      const g = map().grid;
      const p = keyAt && keyAt.id === f.id && Date.now() - keyAt.t < 1000 ? keyAt : view().fxPos(f);
      const l = Geom.toLocal(g, p.x, p.y);
      const n = Geom.fromLocal(g, l.u + dir[0] * g.size, l.v + dir[1] * g.size);
      const q = at(f, n.x, n.y);
      keyAt = { id: f.id, x: q.x, y: q.y, t: Date.now() };
      cmd('fx.update', { id: f.id, x: q.x, y: q.y, attachTo: null, final: true, coalesce: `party-keys-${f.id}` });
      return true;
    }

    // ---------- the popover ----------
    function buildPop() {
      const { seg, toggle, slider, btn, row, hint, sep, bind, tiles } = c();
      const out = [];
      const list = parties();
      const cur = current();
      if (cur && ui.party.sel !== cur.id) { ui.party.sel = cur.id; view().selectFx(cur.id); }
      // the first party arrived or the last one left: the popover changes its shape
      const had = list.length > 0;
      bind(() => { if ((parties().length > 0) !== had) setTimeout(() => ctx.reopen(), 0); });
      // the parties (a split group has several)
      const rows = h('div', { class: 'party-list' });
      bind(() => {
        const all = parties();
        const sig = JSON.stringify([all.map((f) => [f.id, f.name, f.color, f.hidden]), ui.party.sel]);
        if (rows.dataset.sig === sig) return;
        rows.dataset.sig = sig;
        rows.innerHTML = '';
        for (const f of all) {
          rows.append(h('div', { class: `party-row ${f.id === ui.party.sel ? 'on' : ''}`, dataset: { id: f.id }, onclick: () => select(f.id) },
            h('span', { class: 'party-dot', style: `background:${f.color || COLORS[0]}` }),
            h('span', { class: 'grow ellipsis' }, f.name || 'Party'),
            h('button', { class: 'icon-btn', 'aria-label': f.hidden ? `Show ${f.name}` : `Hide ${f.name}`, 'data-tip': f.hidden ? 'Back on the map: it sees again' : 'Off the map for now: it stops seeing', onclick: (e) => { e.stopPropagation(); cmd('fx.update', { id: f.id, hidden: !f.hidden }); } }, iconEl(f.hidden ? 'eye-off' : 'eye')),
            h('button', { class: 'icon-btn', 'aria-label': `Remove ${f.name}`, 'data-tip': 'Remove this party (what it revealed stays revealed)', onclick: (e) => { e.stopPropagation(); undoable('fx.remove', { id: f.id }, `${f.name || 'Party'} removed`); } }, iconEl('trash'))));
        }
      });
      // Prototype 17: player tokens on this map see for themselves: the marker rests
      const idleHint = h('p', { class: 'hint warn-text' }, 'Player tokens see for themselves on this map, so the party marker rests.');
      bind(() => { idleHint.hidden = !(map() && Vision.markersIdle(map())); });
      out.push(idleHint);
      const placeHint = h('p', { class: 'hint party-place-hint' });
      bind(() => { const on = armed(); placeHint.hidden = !on; placeHint.textContent = 'Click on the map where the party stands. Esc cancels.'; });
      if (!list.length) {
        out.push(hint('No party on this map yet.'));
        const b = btn('Put the party on the map', 'users-group', () => arm(true), { kind: 'primary wide', tip: 'Then click on the map where they stand' });
        bind(() => b.classList.toggle('on', armed()));
        out.push(row(b), placeHint);
      } else {
        out.push(rows);
        const b = btn('Another party', 'plus', () => arm(!ui.party.placing), { kind: 'ghost', tip: 'For a split group: click it, then click on the map where they stand' });
        bind(() => b.classList.toggle('on', armed()));
        out.push(row(b), placeHint);
      }
      if (cur) {
        const sel = () => parties().find((f) => f.id === ui.party.sel) || current();
        const set = (patch) => { const f = sel(); if (f) cmd('fx.update', { id: f.id, ...patch, coalesce: `party-set-${f.id}` }); };
        out.push(sep());
        out.push(h('div', { class: 'ctl-label' }, 'Light they carry'));
        out.push(tiles(CARRY, () => carryOf(sel()), (v) => set({ carry: v })));
        out.push(seg({ label: 'Darkvision', options: [{ value: 0, label: 'None' }, { value: 60, label: '60 ft' }, { value: 120, label: '120 ft' }],
          get: () => (sel() || {}).darkvision || 0, set: (v) => set({ darkvision: v }) }));
        // 4.2: what the character cards say (the best darkvision of those here today)
        const fromCards = Characters.darkvision(S());
        if (fromCards && fromCards !== ((sel() || {}).darkvision || 0)) out.push(h('button', { class: 'link-btn', 'data-tip': 'The best darkvision of the characters here today (their cards)', onclick: () => set({ darkvision: fromCards }) }, `From the character cards: ${fromCards} ft`));
        out.push(slider({ label: 'They see', min: 0, max: 120, step: 5, get: () => (sel() || {}).range || 0, set: (v, k) => { const f = sel(); if (f) send(k, 'fx.update', { id: f.id, range: v }); },
          fmt: (v) => (v ? `${v} ft` : walled() ? 'As far as the walls allow' : `${OPEN_FT} ft (no walls)`) }));
        out.push(toggle({ label: 'Locked to the grid', get: () => (sel() || {}).snap !== false, set: (v) => { const f = sel(); if (!f) return; set({ snap: v }); if (v) { const q = at({ snap: true }, f.x, f.y); cmd('fx.update', { id: f.id, x: q.x, y: q.y }); } } }));
      }
      // fog: the party reveals as it goes
      const fogBox = h('div', { class: 'stack' });
      bind(() => {
        const m = map();
        const sig = `${m.fog.enabled}|${m.fog.ops.length > 0}|${walled()}`;
        if (fogBox.dataset.sig === sig) return;
        fogBox.dataset.sig = sig;
        fogBox.innerHTML = '';
        if (!m.fog.enabled) {
          const go = () => (map().fog.ops.length ? cmd('fog.enabled', { enabled: true }) : undoable('fog.base', { base: 'cover' }, 'The map is covered: the party reveals what it sees'));
          fogBox.append(row(btn('Let the party explore', 'eye-check', go, { kind: 'wide', tip: 'Covers the map with fog; the party reveals what it sees' })));
        }
      });
      out.push(sep(), fogBox);
      return h('div', { class: 'stack party-pop' }, ...out);
    }

    function toolChanged(t) {
      if (t !== 'party' && ui.party.placing) { ui.party.placing = false; hideGhost(); }
      if (t !== 'party') hideGhost();
      if (t === 'party') { const f = current(); if (f) { ui.party.sel = f.id; view().selectFx(f.id); } }
      else if (ui.party.sel && ui.selFx !== ui.party.sel) view().selectFx(ui.selFx || null);
    }

    return { pointerDown, pointerMove, pointerUp, key, buildPop, toolChanged, addParty, parties, owns: (k) => k === 'partymove', CARRY, arm, cancel, hover, leave, armed };
  }

  return { create, CARRY };
})();
