// Room lights (Beta 3.3): the setup window, the room plan, the groups and the scene maker.
//   Setup     1 Find (and No flashing) · 2 Connect (one card per brand) · 3 Room (a plan of the room: the table with
//             the TV in it, the GM's seat, the lamps where they stand) · 4 Groups (Effects, Ambience) · 5 Try it
//   Plan      lamps dragged from the tray into the room; a lamp beside the table takes the TV colour of its side
//             (the arrow on the TV: where the top of the picture points); click a lamp to name it or limit it
//   Scenes    the plan again: click lamps and give them a colour (or all at once), save it with a name
// roomlights.js (main) does the work; S().lights is what it knows.
'use strict';

const LightsSetup = (() => {
  const { h, iconEl, toast, dialog, openMenu } = UI;
  const KIND = {
    lan: { icon: 'wifi', brand: 'Govee', speed: 'Fast: colours and flashes' },
    cloud: { icon: 'cloud', brand: 'Govee', speed: 'Slow: colours only' },
    ikea: { icon: 'router', brand: 'IKEA', speed: 'Slow: colours only' },
  };
  const TABLE = { x0: 0.3, y0: 0.28, x1: 0.7, y1: 0.72 }; // as in roomlights.js
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const call = async (a, p) => { const r = await window.ts.lights(a, p); if (r && r.error) toast(r.error, { kind: 'error', ms: 5000 }); return r; };
  const later = (fn, ms = 120) => { let t = 0; let last = null; return (...a) => { last = a; if (t) return; t = setTimeout(() => { t = 0; fn(...last); }, ms); }; };
  const hint = (t) => h('p', { class: 'hint' }, t);
  // (3.4) lamps beside the table: their side of the picture, like Ambilight, or the whole picture's colour
  const areaSeg = (v, onSet) => segEl('Lamps beside the table', [{ value: 'side', label: 'Their side of the TV', tip: 'Like Ambilight: each lamp shows the part of the picture on its side' }, { value: 'whole', label: 'The whole TV', tip: 'Every lamp shows the colour of the whole picture' }], v.tvArea || 'side', onSet);
  // a row of choices (the dialogs here are not panels, so no live binding: they are drawn again on a change)
  const segEl = (label, options, value, onSet) => h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, ...options.map((x) => h('button', { class: `seg-btn ${x.value === value ? 'on' : ''}`, role: 'radio', 'aria-checked': x.value === value, 'data-tip': x.tip || null, onclick: () => onSet(x.value) }, h('span', {}, x.label)))));

  function create(ctx) {
    const V = () => (ctx.state() && ctx.state().lights) || { lamps: [], lan: {}, cloud: {}, ikea: {}, plan: { rot: 0, dm: { x: 0.5, y: 0.8 } }, scenes: [] };
    const act = async (a, p) => { const r = await call(a, p); ctx.refresh(); return r; };

    // ===================================================================== the groups (drag and drop)
    function groupsEl(v) {
      const menuFor = (x, e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
          { icon: 'bolt', label: 'In Effects', checked: x.fx, action: () => act('member', { id: x.id, fx: !x.fx }) },
          { icon: 'sun', label: 'In Ambience', checked: x.amb, action: () => act('member', { id: x.id, amb: !x.amb }) },
          { icon: 'bulb', label: 'Blink it', action: () => act('test', { id: x.id }) },
        ]);
      };
      const chip = (x, from) => {
        const k = KIND[x.kind] || { icon: 'bulb', speed: '' };
        const el = h('div', { class: `rl-chip ${x.online ? '' : 'off'}`, draggable: 'true', 'data-tip': `${x.name}: ${k.speed}. Drag it into a group; right-click for more`, oncontextmenu: (e) => menuFor(x, e) },
          iconEl(k.icon), h('span', { class: 'rl-chip-name ellipsis' }, x.name),
          from === 'pool'
            ? h('span', { class: 'rl-badges' }, x.fx ? h('i', { 'data-tip': 'In Effects' }, iconEl('bolt')) : null, x.amb ? h('i', { 'data-tip': 'In Ambience' }, iconEl('sun')) : null,
              h('button', { class: 'icon-btn rl-blink', 'aria-label': `Blink ${x.name}`, 'data-tip': 'Blink it twice, to see which lamp it is', onclick: () => act('test', { id: x.id }) }, iconEl('bulb')))
            : h('button', { class: 'icon-btn rl-x', 'aria-label': `Take ${x.name} out`, 'data-tip': 'Take it out of this group', onclick: () => act('member', { id: x.id, [from]: false }) }, iconEl('x')));
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ts-lamp', JSON.stringify({ id: x.id, from })); e.dataTransfer.effectAllowed = 'copyMove'; el.classList.add('dragging'); });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        return el;
      };
      const dropTo = (el, onDrop) => {
        el.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('application/x-ts-lamp')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('over'); });
        el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
        el.addEventListener('drop', (e) => {
          el.classList.remove('over');
          let d = null; try { d = JSON.parse(e.dataTransfer.getData('application/x-ts-lamp')); } catch {}
          if (!d) return;
          e.preventDefault();
          onDrop(d);
        });
        return el;
      };
      const zone = (key, title, ic, tip, list) => dropTo(h('div', { class: `rl-zone rl-z-${key}` },
        h('div', { class: 'rl-zone-head' }, iconEl(ic), h('b', {}, title)),
        h('small', { class: 'rl-zone-tip' }, tip),
        h('div', { class: 'rl-chips' }, ...(list.length ? list.map((x) => chip(x, key)) : [h('span', { class: 'rl-empty' }, 'Drag lamps here')]))),
      (d) => { if (d.from !== key) act('member', { id: d.id, [key]: true }); });
      const ls = v.lamps || [];
      if (!ls.length) return h('div', { class: 'rl-groups' }, hint('No lamps yet: find and connect them first.'));
      const pool = dropTo(h('div', { class: 'rl-pool' }, h('div', { class: 'rl-zone-head' }, iconEl('bulb'), h('b', {}, 'Your lamps')), h('div', { class: 'rl-chips' }, ...ls.map((x) => chip(x, 'pool')))),
        (d) => { if (d.from === 'fx' || d.from === 'amb') act('member', { id: d.id, [d.from]: false }); });
      return h('div', { class: 'rl-groups' },
        h('div', { class: 'rl-zones' },
          zone('fx', 'Effects', 'bolt', 'Flash with lightning, explosions, spells, a natural 20 …', ls.filter((x) => x.fx)),
          zone('amb', 'Ambience', 'sun', v.ambience === 'mood' ? 'The colours of the moods' : 'The colours on the TV', ls.filter((x) => x.amb))),
        pool,
        h('small', { class: 'rl-zone-tip' }, 'A lamp can be in both groups. In neither: left alone.'));
    }

    // ===================================================================== the room plan
    // o: { edit (lamps, TV and seat can be moved), onSelect(id), selected }
    function planWidget(o) {
      const room = h('div', { class: 'lp-room' });
      const tray = h('div', { class: 'lp-tray' });
      const el = h('div', { class: 'lp-plan' }, room, tray);
      let sel = o.selected || null;
      let dragging = false;
      const inRoom = (e) => { const r = room.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
      const toXY = (e) => { const r = room.getBoundingClientRect(); return { x: Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)), y: Math.min(0.97, Math.max(0.03, (e.clientY - r.top) / r.height)) }; };
      // press and drag (the thing follows the pointer); a press without moving is a click
      function drag(node, onEnd, onClick) {
        node.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          node.setPointerCapture(e.pointerId);
          const sx = e.clientX; const sy = e.clientY; let moved = false;
          node.onpointermove = (ev) => {
            if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            if (!o.edit) return;
            moved = true; dragging = true;
            node.classList.add('dragging');
            node.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
          };
          // (4.2.2) a drag the system takes away (a touch screen, a window over it) ends without a move
          const end = (ev, ok) => {
            if (!node.onpointermove) return;
            node.onpointermove = null; node.onpointerup = null; node.onpointercancel = null; node.onlostpointercapture = null;
            node.classList.remove('dragging'); node.style.transform = '';
            dragging = false;
            if (!ok) return;
            if (moved) onEnd(ev); else if (onClick) onClick(ev);
          };
          node.onpointerup = (ev) => end(ev, true);
          node.onpointercancel = (ev) => end(ev, false);
          node.onlostpointercapture = (ev) => end(ev, false);
        });
      }
      function render(v, nsel) {
        if (dragging) return;
        if (nsel !== undefined) sel = nsel;
        const plan = v.plan || { rot: 0, dm: { x: 0.5, y: 0.8 } };
        const tv = h('div', { class: 'lp-tv', style: `--tv:${(v.tv && v.tv.rgb) || '#1b2230'}` },
          h('div', { class: 'lp-top', style: `transform: rotate(${plan.rot}deg)`, 'data-tip': 'The top of the picture points this way' }, iconEl('arrow-up')),
          h('span', { class: 'lp-tv-label' }, 'TV'),
          o.edit ? h('button', { class: 'icon-btn lp-rot', 'aria-label': 'Turn the TV', 'data-tip': 'Turn it until the arrow points where the top of the picture is', onclick: (e) => { e.stopPropagation(); act('plan', { rot: (plan.rot + 90) % 360 }); } }, iconEl('rotate-clockwise')) : null);
        const table = h('div', { class: 'lp-table', style: `left:${pct(TABLE.x0)};top:${pct(TABLE.y0)};width:${pct(TABLE.x1 - TABLE.x0)};height:${pct(TABLE.y1 - TABLE.y0)}` }, tv);
        const dm = h('div', { class: 'lp-dm', style: `left:${pct(plan.dm.x)};top:${pct(plan.dm.y)}`, 'data-tip': o.edit ? 'Your seat: drag it where you sit' : 'Your seat' }, iconEl('armchair'), h('small', {}, 'GM'));
        if (o.edit) drag(dm, (e) => { if (inRoom(e)) act('plan', { dm: toXY(e) }); });
        const nodes = [table, dm];
        const loose = [];
        for (const x of v.lamps || []) {
          const node = h('div', { class: `lp-lamp ${x.id === sel ? 'sel' : ''} ${x.online ? '' : 'off'}`, style: `--lc:${x.color || '#3a3f4a'}`, 'data-tip': `${x.name}${o.edit ? ': drag it where it stands, click it to name it' : ': click to set its colour'}` },
            h('span', { class: 'lp-bulb' }, iconEl(x.kind === 'ikea' ? 'bulb' : x.kind === 'cloud' ? 'cloud' : 'bulb')), h('small', { class: 'ellipsis' }, x.name));
          const click = () => { sel = x.id; if (o.onSelect) o.onSelect(x.id); render(V(), sel); };
          drag(node, (e) => { if (inRoom(e)) act('pos', { id: x.id, ...toXY(e) }); else if (x.pos) act('pos', { id: x.id, remove: true }); }, click);
          if (x.pos) { node.style.left = pct(x.pos.x); node.style.top = pct(x.pos.y); nodes.push(node); } else loose.push(node);
        }
        room.replaceChildren(...nodes);
        tray.replaceChildren(...(loose.length ? [h('small', { class: 'lp-tray-label' }, o.edit ? 'Not placed yet: drag them into the room' : 'Not placed in the room'), ...loose] : []));
        tray.hidden = !loose.length;
      }
      return { el, render, isDragging: () => dragging, select: (id) => { sel = id; render(V(), sel); } };
    }

    // ===================================================================== the setup window
    const STEPS = [['find', 'Find', 'search'], ['connect', 'Connect', 'link'], ['room', 'Room', 'table'], ['groups', 'Groups', 'bolt'], ['try', 'Try it', 'player-play']];
    function openSetup(start = null) {
      act('start');
      const v0 = V();
      let step = start || (v0.lamps && v0.lamps.length ? 'room' : 'find');
      let sel = null;
      const steps = h('div', { class: 'ls-steps' });
      const body = h('div', { class: 'ls-body' });
      const back = h('button', { class: 'btn ghost', onclick: () => go(-1) }, iconEl('chevron-left'), 'Back');
      const next = h('button', { class: 'btn primary', onclick: () => go(1) });
      const foot = h('div', { class: 'modal-actions ls-foot' }, back, h('span', { class: 'grow' }), next);
      const wrap = h('div', { class: 'ls-setup' }, steps, body, foot);
      let plan = null; let sig = '';
      function go(d) {
        const i = STEPS.findIndex(([id]) => id === step) + d;
        if (i >= STEPS.length) { act('set', { setupDone: true }); dlg.close(); toast('Room lights are set up. The Toolbox panel switches them during the game.', { ms: 3500 }); return; }
        step = STEPS[Math.max(0, i)][0];
        draw();
      }
      function drawSteps() {
        steps.replaceChildren(...STEPS.map(([id, label, ic], i) => h('button', { class: `ls-step ${id === step ? 'on' : ''}`, onclick: () => { step = id; draw(); } }, h('b', {}, String(i + 1)), iconEl(ic), h('span', {}, label))));
        back.hidden = step === STEPS[0][0];
        next.replaceChildren(...(step === 'try' ? [iconEl('check'), 'Done'] : ['Next', iconEl('chevron-right')]));
      }
      const statusWord = (s) => ({ ok: 'Connected', searching: 'Looking …', none: 'Nothing found yet', error: 'Problem', off: 'Not set up' })[(s && s.state) || 'off'] || 'Not set up';
      // ---- 1 Find
      function findStep(v) {
        const ls = v.lamps || [];
        const nf = h('input', { type: 'checkbox', role: 'switch', checked: !!v.noFlash, 'aria-label': 'No flashing' });
        nf.addEventListener('change', () => act('set', { noFlash: nf.checked }));
        return [
          h('h3', {}, 'Find your lamps'),
          hint('Lamps on your network are found by themselves; some only after the next step.'),
          h('label', { class: 'ls-card ls-noflash' }, iconEl('eye-off'), h('div', { class: 'grow' }, h('b', {}, 'No flashing'), h('small', {}, 'Lightning, explosions and spells become soft colour swells. Turn it on if someone at the table is sensitive to flashing light.')), nf, h('span', { class: 'switch' })),
          h('div', { class: 'ls-found' },
            h('div', { class: 'ls-found-head' }, h('b', { class: 'grow' }, ls.length ? `${ls.length} lamp${ls.length === 1 ? '' : 's'} found` : 'Looking for lamps …'), c().btn('Search again', 'refresh', () => act('scan'), { kind: 'small ghost' })),
            ...ls.map((x) => { const k = KIND[x.kind] || { icon: 'bulb', brand: '', speed: '' }; return h('div', { class: 'ls-lamp' }, iconEl(k.icon), h('b', { class: 'grow ellipsis' }, x.name), h('small', {}, k.brand), h('span', { class: `ls-speed ${x.fast ? 'fast' : ''}` }, k.speed), h('button', { class: 'icon-btn', 'aria-label': `Blink ${x.name}`, 'data-tip': 'Blink it', onclick: () => act('test', { id: x.id }) }, iconEl('bulb'))); })),
          ls.length ? null : hint('Nothing yet? Go to Connect: most lamps need one switch or button first.'),
        ];
      }
      // ---- 2 Connect
      function connectStep(v) {
        const key = h('input', { type: 'password', placeholder: v.cloud.key ? 'Key saved (type a new one to change it)' : 'Govee API key', 'aria-label': 'Govee API key', autocomplete: 'off', spellcheck: 'false' });
        const host = h('input', { type: 'text', placeholder: 'Gateway address, e.g. 192.168.1.20', 'aria-label': 'Gateway address', spellcheck: 'false', value: v.ikea.host || '' });
        const code = h('input', { type: 'text', placeholder: 'Security code (label under the gateway)', 'aria-label': 'Security code', spellcheck: 'false', autocomplete: 'off' });
        const card = (ic, title, state, ...kids) => h('div', { class: 'ls-card ls-brand' }, h('div', { class: 'ls-brand-head' }, iconEl(ic), h('b', { class: 'grow' }, title), state ? h('span', { class: `rl-status ${state === 'Connected' ? 'ok' : ''}` }, state) : null), ...kids);
        const soon = (title) => h('div', { class: 'ls-card ls-soon' }, iconEl('bulb'), h('b', {}, title), h('small', {}, 'Coming in a later beta'));
        return [
          h('h3', {}, 'Connect them'),
          hint('Once per brand. Connected lamps appear in the list by themselves.'),
          card('wifi', 'Govee', statusWord(v.lan),
            h('ol', { class: 'ls-how' }, h('li', {}, 'In the Govee Home app, open the lamp → ⚙ (top right) → turn on LAN Control.'), h('li', {}, 'No switch? Update the lamp\'s firmware there and wait a few minutes.'), h('li', {}, 'If Windows asks about Tablescape and the network: allow it on private networks.')),
            h('div', { class: 'ctl-row' }, c().btn('Search again', 'refresh', () => act('scan'), { kind: 'small' })),
            v.lan.msg ? hint(v.lan.msg) : null,
            h('details', { class: 'ls-more', open: !!v.cloud.key || undefined }, h('summary', {}, 'A Govee lamp without LAN Control (slow: colours only)'),
              h('ol', { class: 'ls-how' }, h('li', {}, 'Govee Home app → Profile → ⚙ → Apply for API Key; it comes by email.'), h('li', {}, 'Paste it here. Keep it to yourself: it controls your lamps.')),
              h('div', { class: 'ctl-row' }, key, c().btn('Save', null, async () => { const k = key.value.trim(); if (!k) return; key.value = ''; const r = await act('key', { key: k }); if (r && r.ok) toast('Govee key saved'); }, { kind: 'small' })),
              v.cloud.msg ? hint(v.cloud.msg) : null)),
          card('router', 'IKEA (TRÅDFRI gateway)', v.ikea.paired ? statusWord(v.ikea) : null,
            ...(v.ikea.paired
              ? [hint(`Paired with ${v.ikea.host}. ${v.ikea.msg || ''}`), h('div', { class: 'ctl-row' }, c().btn('Forget the gateway', 'trash', () => act('ikea.forget'), { kind: 'small ghost' }))]
              : [h('ol', { class: 'ls-how' }, h('li', {}, 'Find the gateway (or type its address from the IKEA app or your router).'), h('li', {}, 'Type the security code from the label under it, then Pair.')),
                h('div', { class: 'ctl-row' }, host, c().btn('Find', 'search', async () => { const r = await window.ts.lights('ikea.find'); if (r && r.ok) host.value = r.host; else toast((r && r.error) || 'No gateway found', { ms: 4000 }); }, { kind: 'small' })),
                h('div', { class: 'ctl-row' }, code, c().btn('Pair', 'link', async () => { if (!host.value.trim() || !code.value.trim()) { toast('The address and the security code, please'); return; } const r = await act('ikea.pair', { host: host.value, code: code.value }); if (r && r.ok) toast('Gateway paired'); }, { kind: 'small primary' })),
                v.ikea.msg ? hint(v.ikea.msg) : null])),
          h('div', { class: 'ls-soon-row' }, soon('Philips Hue'), soon('IKEA DIRIGERA'), soon('WiZ'), soon('LIFX'), soon('Nanoleaf')),
        ];
      }
      // ---- 3 Room
      const editor = h('div', { class: 'ls-lamp-edit' });
      function drawEditor() {
        const x = (V().lamps || []).find((y) => y.id === sel);
        if (!x) { editor.replaceChildren(hint('Click a lamp to name it, blink it or limit how bright it gets.')); return; }
        const name = h('input', { type: 'text', value: x.name, 'aria-label': 'Name', spellcheck: 'false' });
        name.addEventListener('change', () => act('name', { id: x.id, name: name.value }));
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        const lim = later((p) => call('lamp', { id: x.id, ...p }), 250);
        const sl = (label, min, max, value, onInput) => {
          const out = h('output', {}, `${value}%`);
          const input = h('input', { type: 'range', min, max, step: 1, value, 'aria-label': label });
          input.addEventListener('input', () => { out.textContent = `${input.value}%`; onInput(Number(input.value)); });
          return h('label', { class: 'rl-sl' }, h('span', {}, label), input, out);
        };
        editor.replaceChildren(
          h('div', { class: 'ctl-row' }, iconEl((KIND[x.kind] || {}).icon || 'bulb'), name, c().btn('Blink', 'bulb', () => act('test', { id: x.id }), { kind: 'small' }),
            x.pos ? c().btn('Off the plan', 'x', () => { act('pos', { id: x.id, remove: true }); }, { kind: 'small ghost' }) : null),
          h('div', { class: 'ls-lim' }, sl('Brightest', 5, 100, x.max ?? 100, (n) => lim({ max: n })), sl('Darkest', 1, 60, x.min ?? 1, (n) => lim({ min: n }))));
      }
      function roomStep(v) {
        plan = planWidget({ edit: true, selected: sel, onSelect: (id) => { sel = id; drawEditor(); } });
        plan.render(v, sel);
        drawEditor();
        return [
          h('h3', {}, 'Where are your lamps?'),
          hint('Drag the lamps and your seat to where they are. Turn the TV (⟳) until the arrow points to the top of the picture.'),
          plan.el, editor,
          areaSeg(v, (x) => act('set', { tvArea: x })),
        ];
      }
      // ---- 4 Groups
      function groupsStep(v) {
        return [
          h('h3', {}, 'What should each lamp do?'),
          hint('Ambience follows the TV\'s colours. Effects flashes for lightning, explosions, spells and a natural 20. A lamp can be in both.'),
          groupsEl(v),
          segEl('Ambience shows', [{ value: 'table', label: 'Colours on the TV' }, { value: 'mood', label: 'Time-of-day colours', tip: 'The colour of the map\'s time of day (Day, Dusk, Night, Cave …)' }], v.ambience, (x) => act('set', { ambience: x })),
          v.ambience === 'mood' ? null : areaSeg(v, (x) => act('set', { tvArea: x })),
        ];
      }
      // ---- 5 Try it
      function tryStep(v) {
        const restore = h('input', { type: 'checkbox', role: 'switch', checked: v.restore, 'aria-label': 'Put the lamps back when Tablescape closes' });
        restore.addEventListener('change', () => act('set', { restore: restore.checked }));
        const fx = [['lightning', 'Lightning'], ['explosion', 'Explosion'], ['nat20', 'Natural 20'], ['holy', 'Holy light'], ['teleport', 'Teleport'], ['roar', 'Dragon roar'], ['flood', 'Flood']];
        return [
          h('h3', {}, 'Try it'),
          h('div', { class: 'ls-demo' }, c().btn('Demo storm', 'cloud-storm', () => act('demo'), { kind: 'primary', tip: 'A stormy night with lightning for a few seconds, then back' }),
            h('small', {}, 'A stormy night with lightning for a few seconds, then back to the table.')),
          h('div', { class: 'ctl-label' }, 'Effects one by one'),
          h('div', { class: 'ls-fx' }, ...fx.map(([id, label]) => c().btn(label, 'player-play', () => act('try', { fx: id }), { kind: 'small' })),
            ...Object.entries(FXDATA.SKINS).slice(0, 6).map(([, sk]) => h('button', { class: 'rl-sk', style: `--c:${sk.c}`, 'data-tip': `A ${sk.label.toLowerCase()} spell`, 'aria-label': `Try a ${sk.label} spell`, onclick: () => act('try', { fx: 'spell', color: sk.c }) }))),
          h('label', { class: 'ls-card' }, iconEl('power'), h('div', { class: 'grow' }, h('b', {}, 'Put the lamps back when Tablescape closes'), h('small', {}, 'They return to how they were before the game. Off in the panel does the same at once.')), restore, h('span', { class: 'switch' })),
          h('div', { class: 'ctl-row' }, c().btn('Fine-tuning …', 'adjustments', () => ctx.openTune(), { kind: 'small ghost', tip: 'Time-of-day colours, each effect on or off, lamps by hand' })),
        ];
      }
      function draw() {
        drawSteps();
        const v = V();
        sig = live(v);
        body.replaceChildren(...(step === 'find' ? findStep(v) : step === 'connect' ? connectStep(v) : step === 'room' ? roomStep(v) : step === 'groups' ? groupsStep(v) : tryStep(v)).filter(Boolean));
      }
      // while the window is open: new lamps, statuses, colours come in
      const live = (v) => JSON.stringify([step, (v.lamps || []).map((x) => [x.id, x.name, x.fx, x.amb, x.online, x.pos]), v.lan, v.cloud, v.ikea, v.plan, v.ambience, v.tvArea, v.noFlash, v.restore]);
      const timer = setInterval(() => {
        if (!wrap.isConnected) { clearInterval(timer); return; }
        const v = V();
        if (step === 'room' && plan && !plan.isDragging()) plan.render(v); // (the lamps' and the TV's colours)
        const a = document.activeElement;
        if (a && wrap.contains(a) && /INPUT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range') return; // not while typing
        if (plan && plan.isDragging()) return;
        if (live(v) !== sig) draw();
      }, 700);
      const dlg = dialog('Room lights: setup', wrap, { wide: true, onClose: () => { clearInterval(timer); window.ts.lights('release', {}); } });
      dlg.el.classList.add('ls-dlg');
      draw();
    }

    // ===================================================================== the scene maker
    function openScene(id = null) {
      act('start');
      const v0 = V();
      const sc = id ? (v0.scenes || []).find((x) => x.id === id) : null;
      if (sc) call('scene.load', { id });
      let sel = null;
      const name = h('input', { type: 'text', value: sc ? sc.name : '', placeholder: 'Tavern, Crypt, Boss fight …', 'aria-label': 'Name of the scene', spellcheck: 'false' });
      const plan = planWidget({ edit: false, onSelect: (lid) => { sel = lid; drawLamp(); } });
      const lampBox = h('div', { class: 'ls-lamp-edit' });
      const sendLamp = later((p) => call('hold', p));
      function drawLamp() {
        const x = (V().lamps || []).find((y) => y.id === sel);
        if (!x) { lampBox.replaceChildren(hint('Click a lamp on the plan to give it a colour.')); return; }
        const on = h('input', { type: 'checkbox', role: 'switch', checked: true, 'aria-label': `${x.name} on` });
        on.addEventListener('change', () => call('hold', { id: x.id, on: on.checked }));
        const col = h('input', { type: 'color', value: x.color || '#ffac62', 'aria-label': `Colour of ${x.name}` });
        col.addEventListener('input', () => sendLamp({ id: x.id, rgb: col.value, on: true }));
        const out = h('output', {}, '80%');
        const bri = h('input', { type: 'range', min: 1, max: 100, value: 80, 'aria-label': `Brightness of ${x.name}` });
        bri.addEventListener('input', () => { out.textContent = `${bri.value}%`; sendLamp({ id: x.id, bri: Number(bri.value) }); });
        lampBox.replaceChildren(h('div', { class: 'ctl-row ls-scene-lamp' }, h('b', { class: 'ellipsis' }, x.name), col, h('label', { class: 'rl-sl' }, h('span', {}, 'Brightness'), bri, out), h('label', { class: 'ctl-toggle rl-sw' }, on, h('span', { class: 'switch' }))));
      }
      const allCol = h('input', { type: 'color', value: '#ffac62', 'aria-label': 'Colour for all lamps' });
      const allOut = h('output', {}, '80%');
      const allBri = h('input', { type: 'range', min: 1, max: 100, value: 80, 'aria-label': 'Brightness for all lamps' });
      const sendAll = later((p) => call('hold.all', p));
      allCol.addEventListener('input', () => sendAll({ rgb: allCol.value, bri: Number(allBri.value) }));
      allBri.addEventListener('input', () => { allOut.textContent = `${allBri.value}%`; sendAll({ rgb: allCol.value, bri: Number(allBri.value) }); });
      const save = async () => {
        const r = await call('scene.save', { id: sc ? sc.id : null, name: name.value.trim() || 'Lamp scene' });
        if (r && r.ok) { toast(`${name.value.trim() || 'Lamp scene'} saved.`, { ms: 3000 }); dlg.close(); ctx.refresh(); }
      };
      const wrap = h('div', { class: 'ls-scene' },
        h('div', { class: 'ctl-row' }, h('span', { class: 'ctl-label' }, 'Name'), name),
        h('div', { class: 'ctl-row ls-all' }, h('b', {}, 'All lamps'), allCol, h('label', { class: 'rl-sl' }, h('span', {}, 'Brightness'), allBri, allOut)),
        plan.el, lampBox,
        hint('The lamps show the scene as you make it. Untouched lamps keep what they had.'),
        h('div', { class: 'modal-actions' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: save }, iconEl('check'), sc ? 'Save the scene' : 'Save as a scene')));
      const timer = setInterval(() => { if (!wrap.isConnected) { clearInterval(timer); return; } if (!plan.isDragging()) plan.render(V()); }, 700);
      const dlg = dialog(sc ? `Lamp scene: ${sc.name}` : 'New lamp scene', wrap, { wide: true, onClose: () => { clearInterval(timer); window.ts.lights('release', {}); } });
      dlg.el.classList.add('ls-dlg');
      plan.render(V());
      drawLamp();
    }
    const c = () => ctx.ctl;
    return { openSetup, openScene, groupsEl, planWidget };
  }
  return { create };
})();
