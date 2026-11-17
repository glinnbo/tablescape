// Toolbox → Cartographer (Beta 3.11): the campaign's atlas, its world and regional maps.
//   the list    every map of the atlas: click one to work on it (it opens like any map, with the same tools);
//               the backpack marks it as found by the party; the screen button puts it on the TV or takes it off
//   on the TV   it lies over the battlemap as an immersive view (table-atlas.js): tilted, bulged like a globe, sharp
//               in the middle, clouds round the edge. Taken off, the battlemap is there again as it was
//   this map    what one grid cell stands for ("1 day of travel"): routes and the ruler count in it; Place and Route
//               switch the mouse to the Mark tool
//   the view    tilt, bulge, blur, clouds, and which side of the table it faces (for the whole atlas)
// main: campaigns.js keeps the atlas (meta.atlas), main.js shows it (state.atlas); S().atlas is what it reports.
'use strict';

const AtlasPanel = (() => {
  const { h, iconEl, openMenu, askText, Thumbs } = UI;
  const FACES = [{ value: 0, icon: 'arrow-down', tip: 'It faces the bottom side of the TV' }, { value: 90, icon: 'arrow-left', tip: 'It faces the left side' }, { value: 180, icon: 'arrow-up', tip: 'It faces the top side' }, { value: 270, icon: 'arrow-right', tip: 'It faces the right side' }];

  function create(ctx) {
    const { cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const A = () => (S() && S().atlas) || { maps: [], look: {}, on: null, world: null, note: null };
    const editing = () => A().maps.find((x) => x.id === S().editMapId) || null;
    const look = (patch, key) => (key ? ctx.send(key, 'atlas.look', { look: patch }) : cmd('atlas.look', { look: patch }));

    function rowMenu(e, m) {
      const r = e.currentTarget.getBoundingClientRect();
      const a = A();
      openMenu(r.left, r.bottom + 6, [
        { icon: 'pencil', label: 'Rename', action: async () => { const n = await askText('Name the map', m.name, { ok: 'Save' }); if (n) cmd('map.rename', { id: m.id, name: n }); } },
        ...(a.world === m.id ? [] : [{ icon: 'world', label: 'Make it the world map', action: () => cmd('atlas.world', { id: m.id }) }]),
        { sep: true },
        { icon: 'trash', label: 'Take it out of the atlas', danger: true, action: async () => { const res = await cmd('atlas.remove', { id: m.id }); if (res && res.ok) ctx.undoToast(res); } },
      ]);
    }

    function buildPanel() {
      // ---- the list
      const list = h('div', { class: 'atl-list' });
      c().bind(() => {
        const a = A(); const ed = S().editMapId;
        const sig = JSON.stringify([a.maps, a.world, a.on, ed]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        if (!a.maps.length) { list.append(h('p', { class: 'hint atl-empty' }, 'No world map yet.')); return; }
        for (const m of a.maps) {
          const onTv = a.on === m.id; const world = a.world === m.id;
          const sub = [world ? 'World map' : 'Regional map', m.places ? `${m.places} place${m.places === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
          list.append(h('div', { class: `atl-row${ed === m.id ? ' on' : ''}${onTv ? ' live' : ''}`, dataset: { id: m.id } },
            h('button', { class: 'atl-open', 'data-tip': `Work on ${m.name}`, onclick: () => cmd('edit.open', { id: m.id }) },
              h('span', { class: 'atl-thumb' }, m.missing || !m.bgPath ? iconEl(m.missing ? 'alert-triangle' : world ? 'world' : 'map-2') : Thumbs.img(m.bgPath, m.bgKind || 'image')),
              h('span', { class: 'atl-name' }, h('b', { class: 'ellipsis' }, m.name), h('small', {}, sub))),
            c().ib('backpack', m.found ? 'The party has found it. Click: not found yet' : 'Not found yet. Click: the party has it now', () => cmd('atlas.found', { id: m.id }), { on: m.found }),
            c().ib('cast', onTv ? 'On the table. Click to take it off' : 'Show it on the table', () => cmd(onTv ? 'atlas.hide' : 'atlas.show', { id: m.id }), { on: onTv }),
            h('button', { class: 'icon-btn', 'aria-label': `More for ${m.name}`, onclick: (e) => rowMenu(e, m) }, iconEl('dots'))));
        }
      });
      const add = c().btn('Add a map', 'plus', () => ctx.Drawer.open({ filter: 'maps', purpose: 'atlasMap' }), { kind: 'wide', tip: 'A picture from the library becomes a world or regional map' });

      // ---- what is on the TV
      const onNow = h('div', { class: 'atl-on' });
      c().bind(() => {
        const a = A(); const m = a.on ? a.maps.find((x) => x.id === a.on) : null;
        const sig = m ? `${m.id}|${m.name}|${a.world}` : '';
        onNow.hidden = !m;
        if (onNow.dataset.sig === sig) return;
        onNow.dataset.sig = sig;
        onNow.innerHTML = '';
        if (!m) return;
        onNow.append(h('span', { class: 'grow ellipsis' }, iconEl('cast'), h('b', {}, m.name)),
          ...(a.world && a.world !== m.id ? [c().btn('The world', 'world', () => cmd('atlas.show', { id: a.world }), { kind: 'small ghost', tip: 'Back to the world map' })] : []),
          c().btn('Take off', 'player-stop', () => cmd('atlas.hide', {}), { kind: 'small', tip: 'The battlemap is there again as it was' }));
      });

      // ---- the map being worked on: what one grid cell stands for, places and routes
      const nIn = h('input', { type: 'number', class: 'atl-n', min: '0.01', step: 'any', 'aria-label': 'How many', placeholder: '1' });
      const nameIn = h('input', { type: 'text', class: 'atl-unit', maxlength: '30', spellcheck: 'false', 'aria-label': 'One grid cell stands for', placeholder: 'day of travel' });
      const unitSay = h('output', { class: 'atl-say' });
      const setUnit = () => { const name = nameIn.value.trim(); cmd('grid.update', { unit: name ? { n: Number(nIn.value) || 1, name } : null, coalesce: 'atlas-unit' }); };
      nIn.addEventListener('change', setUnit); nameIn.addEventListener('change', setUnit);
      const mapBox = h('div', { class: 'stack atl-map' },
        h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'One grid cell is'), h('div', { class: 'atl-unit-row' }, nIn, nameIn), unitSay),
        c().row(c().btn('Place', 'flag', () => ctx.useTool('mark', 'place'), { tip: 'Name a place: it can lead to a regional map, and bring a note or a handout' }),
          c().btn('Route', 'route', () => ctx.useTool('mark', 'route'), { tip: 'A dotted path from click to click, counted in grid cells' }),
          c().btn('Grid', 'grid-4x4', () => ctx.openTool('grid'), { tip: 'Lay a grid over the map: squares or hexes' })));
      c().bind(() => {
        const m = editing();
        mapBox.hidden = !m;
        if (!m) return;
        const u = (S().map && S().map.grid && S().map.grid.unit) || null;
        if (document.activeElement !== nIn) nIn.value = u ? String(u.n) : '';
        if (document.activeElement !== nameIn) nameIn.value = u ? u.name : '';
        unitSay.textContent = u ? `17 cells: ${Geom.unitLabel(S().map.grid, 17)}` : '';
      });

      // ---- the view on the TV
      const L = () => A().look || {};
      const sl = (label, k) => c().slider({ label, min: 0, max: 1, step: 0.05, get: () => L()[k] ?? 0.5, set: (v, key) => look({ [k]: v }, key), fmt: (v) => (v < 0.01 ? 'Off' : `${Math.round(v * 100)}%`) });
      const viewBox = h('div', { class: 'stack atl-look' },
        sl('Tilt', 'tilt'), sl('Bulge', 'bulge'), sl('Blur', 'blur'), sl('Clouds', 'clouds'),
        c().seg({ label: 'Faces', cls: 'seg-4', options: FACES.map((f) => ({ value: f.value, icon: f.icon, label: '', tip: f.tip })), get: () => L().turn || 0, set: (v) => look({ turn: v }) }));

      return h('div', { class: 'stack atl' }, list, add, onNow, mapBox, c().sep(), viewBox);
    }
    return { buildPanel };
  }
  return { create };
})();
