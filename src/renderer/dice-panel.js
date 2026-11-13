// Toolbox → Dice: for the rolls that deserve a show on the TV (players still roll their own dice).
//   Dice        click dice into the hand (right-click takes one out), a bonus, advantage or disadvantage
//               for a single d20, Roll on the TV; the result here as the TV shows it, and the last rolls
//   Wheel       wheels of luck saved with the campaign: entries with a colour and a weight (more weight: more
//               often on the reel); Spin on the TV: one wide slot reel of the entries
//   Death save  one d20 reel: 10 or more is good, below 10 is bad
// main.js rolls (crypto random) and keeps state.dice; dice-fx.js draws it on the TV.
'use strict';

const DicePanel = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const SIDES = [2, 4, 6, 8, 10, 12, 20, 100];
  // muted, to suit a dark table: oxblood, slate, moss, old gold, plum, rust, verdigris, wine, ash, umber
  const COLORS = ['#7a2e2a', '#3e5468', '#4f6b3a', '#9a7b3c', '#5e3f5c', '#8a4b2a', '#3f6b63', '#6e2f45', '#5a5a55', '#6b4e33'];
  // when the TV shows the result (ms after the roll starts), if the roll doesn't say (main.js sets roll.reveal)
  const REVEAL = { dice: 2900, wheel: 5500, death: 5700 };

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    let prefs = { tab: 'dice', pool: { 20: 1 }, bonus: 0, adv: null, wheel: null };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('dicePrefs') || '{}') }; } catch {}
    ui.dice = prefs;
    const D = ui.dice;
    const save = () => { try { localStorage.setItem('dicePrefs', JSON.stringify({ tab: D.tab, pool: D.pool, bonus: D.bonus, adv: D.adv, wheel: D.wheel })); } catch {} };
    const refresh = () => { save(); ctx.refresh(); };

    const wheels = () => (S().campaign && S().campaign.wheels) || [];
    const wheel = () => wheels().find((w) => w.id === D.wheel) || wheels()[0] || null;
    const poolCount = () => SIDES.reduce((a, s) => a + (D.pool[s] || 0), 0);
    const single20 = () => poolCount() === 1 && D.pool[20] === 1;
    const poolText = () => {
      const parts = SIDES.filter((s) => D.pool[s]).map((s) => `${D.pool[s]}d${s}`);
      return parts.length ? `${parts.join(' + ')}${D.bonus ? ` ${D.bonus > 0 ? '+' : '−'} ${Math.abs(D.bonus)}` : ''}` : 'No dice yet';
    };

    async function go(type, payload) {
      const r = await cmd(type, payload);
      if (r && r.ok && r.closed) toast('The table is closed: only you see the result', { ms: 3000 });
      else if (r && !r.ok && r.error) toast(r.error, { kind: 'error' });
      return r;
    }
    const roll = () => go('dice.roll', { pool: D.pool, bonus: D.bonus, adv: single20() ? D.adv : null });

    // the last roll of a kind, shown once the TV reveals it
    function lastOf(kind) {
      const log = S().diceLog || [];
      return log.find((x) => x.kind === kind) || null;
    }
    function resultLine(kind) {
      const el = h('div', { class: 'dice-result' });
      c().bind(() => {
        const r = lastOf(kind);
        const ready = r && Date.now() >= r.t0 + (r.reveal ?? REVEAL[kind]);
        const sig = r ? `${r.id}|${ready}` : '';
        if (el.dataset.sig === sig) return;
        el.dataset.sig = sig;
        el.innerHTML = '';
        if (!r) return;
        if (!ready) { el.append(h('span', { class: 'dice-total rolling' }, '…'), h('span', { class: 'dice-detail' }, kind === 'wheel' ? 'Spinning …' : 'Rolling …')); return; }
        if (kind === 'dice') {
          const kept = (r.dice || []).map((d) => h('span', { class: `dice-face ${d.dropped ? 'dropped' : ''}` }, String(d.value)));
          el.append(h('span', { class: `dice-total ${r.crit || ''}` }, String(r.total)),
            h('span', { class: 'dice-detail' }, r.crit ? h('b', { class: `dice-crit ${r.crit}` }, r.crit === 'nat20' ? 'Natural 20' : 'Natural 1') : null, h('span', {}, r.label), h('span', { class: 'dice-faces' }, ...kept)));
        } else if (kind === 'wheel') {
          el.append(h('span', { class: 'dice-total wheel' }, String(r.total)), h('span', { class: 'dice-detail' }, r.label));
        } else {
          el.append(h('span', { class: `dice-total ${r.good ? 'good' : 'bad'}` }, String(r.total)), h('span', { class: 'dice-detail' }, r.total === 20 ? 'Natural 20: success' : r.total === 1 ? 'Natural 1: failure' : r.good ? 'Success' : 'Failure'));
        }
      });
      return el;
    }
    function offTv() {
      const b = c().btn('Take it off the table', 'x', () => cmd('dice.clear', {}), { kind: 'ghost small' });
      c().bind(() => { b.hidden = !S().dice; });
      return b;
    }

    // ---------- Dice ----------
    function diceTab() {
      const { btn, row, hint, bind, stepper } = c();
      const pad = h('div', { class: 'dice-pad' });
      for (const s of SIDES) {
        const b = h('button', { class: 'dice-btn', dataset: { s }, 'data-tip': s === 2 ? 'Add a d2: a coin flip, 1 or 2 (right-click: take one out)' : `Add a d${s} (right-click: take one out)`, 'aria-label': `d${s}`,
          onclick: () => { D.pool = { ...D.pool, [s]: Math.min(12, (D.pool[s] || 0) + 1) }; if (poolCount() > 12) D.pool[s]--; refresh(); },
          oncontextmenu: (e) => { e.preventDefault(); D.pool = { ...D.pool, [s]: Math.max(0, (D.pool[s] || 0) - 1) }; refresh(); } },
        h('span', { class: 'dice-btn-shape' }, dieGlyph(s)), h('span', { class: 'dice-btn-name' }, `d${s}`), h('b', { class: 'dice-btn-n' }));
        pad.append(b);
      }
      bind(() => { for (const b of pad.children) { const n = D.pool[b.dataset.s] || 0; b.classList.toggle('on', n > 0); b.querySelector('.dice-btn-n').textContent = n > 1 ? `×${n}` : ''; } });
      const hand = h('div', { class: 'dice-hand' });
      bind(() => {
        const sig = JSON.stringify([D.pool, D.bonus]);
        if (hand.dataset.sig === sig) return;
        hand.dataset.sig = sig;
        hand.innerHTML = '';
        hand.append(h('span', { class: 'grow dice-hand-text' }, poolText()),
          h('button', { class: 'icon-btn', 'aria-label': 'Empty the hand', 'data-tip': 'Empty the hand', onclick: () => { D.pool = {}; D.bonus = 0; refresh(); } }, iconEl('x')));
      });
      const advBox = h('div');
      const advSeg = c().seg({ cls: 'seg-3', options: [{ value: 'none', label: 'Normal' }, { value: 'adv', label: 'Advantage', tip: 'Two d20, the higher counts' }, { value: 'dis', label: 'Disadvantage', tip: 'Two d20, the lower counts' }],
        get: () => D.adv || 'none', set: (v) => { D.adv = v === 'none' ? null : v; refresh(); } });
      advBox.append(advSeg);
      bind(() => { advBox.hidden = !single20(); });
      const rollBtn = Hotbar.offer(btn('Roll on the table', 'dice', roll, { kind: 'primary wide', tip: 'Rolls it on the table (drag it onto the hotbar to keep this roll)' }),
        () => (poolCount() ? { kind: 'roll', ref: { pool: { ...D.pool }, bonus: D.bonus, adv: single20() ? D.adv : null }, label: `${poolText()}${single20() && D.adv ? (D.adv === 'adv' ? ' adv.' : ' disadv.') : ''}`, icon: 'dice' } : null));
      bind(() => { rollBtn.disabled = !poolCount(); });
      // the last rolls
      const log = h('div', { class: 'dice-log' });
      bind(() => {
        const list = (S().diceLog || []).filter((x) => x.kind === 'dice').slice(1, 6);
        const ready = list.map((x) => x.id).join();
        if (log.dataset.sig === ready) return;
        log.dataset.sig = ready;
        log.innerHTML = '';
        if (!list.length) return;
        log.append(h('div', { class: 'ctl-label' }, 'Before'));
        for (const x of list) log.append(h('div', { class: 'dice-log-row' }, h('b', {}, String(x.total)), h('span', { class: 'ellipsis grow' }, x.label), h('small', {}, (x.dice || []).filter((d) => !d.dropped).map((d) => d.value).join(' · '))));
      });
      return h('div', { class: 'stack' }, pad, hand,
        stepper({ name: 'Bonus', label: 'Bonus', get: () => D.bonus, set: (v) => { D.bonus = v; refresh(); }, prev: (v) => Math.max(-20, v - 1), next: (v) => Math.min(20, v + 1), fmt: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0'), minusTip: 'Lower', plusTip: 'Higher' }),
        advBox, row(rollBtn), resultLine('dice'), row(offTv()), log);
    }
    function dieGlyph(s) {
      const g = { 2: 'M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z', 4: 'M12 3 L21 19 L3 19 Z', 6: 'M5 5 H19 V19 H5 Z', 8: 'M12 2 L21 12 L12 22 L3 12 Z', 10: 'M12 2 L21 10 L12 22 L3 10 Z', 12: 'M12 2 L21.5 9 L18 20 L6 20 L2.5 9 Z', 20: 'M12 2 L20.7 7 V17 L12 22 L3.3 17 V7 Z', 100: 'M12 2 L21 10 L12 22 L3 10 Z' }[s];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'i');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', g);
      svg.append(p);
      return svg;
    }

    // ---------- Wheel ----------
    function saveWheel(w) { return cmd('wheel.save', { wheel: w }); }
    let focusAdd = false; // a new wheel: the keyboard goes to its first entry
    function wheelTab() {
      const { btn, row, hint, bind } = c();
      const pick = h('select', { 'aria-label': 'Wheel', onchange: (e) => { D.wheel = e.target.value; refresh(); } });
      bind(() => {
        const list = wheels(); const w = wheel();
        const sig = JSON.stringify([list.map((x) => [x.id, x.name]), w && w.id]);
        if (pick.dataset.sig === sig) return;
        pick.dataset.sig = sig;
        pick.innerHTML = '';
        for (const x of list) pick.append(h('option', { value: x.id }, x.name));
        if (w) pick.value = w.id;
      });
      const more = h('button', { class: 'icon-btn', 'aria-label': 'More for this wheel', 'data-tip': 'New wheel, paste or import a table, export, rename, delete', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); wheelMenu(r.left, r.bottom + 4); } }, iconEl('dots'));
      const spin = Hotbar.offer(btn('Spin on the table', 'chart-pie', async () => { const w = wheel(); if (w) await go('wheel.spin', { id: w.id }); }, { kind: 'primary wide', tip: 'Spins it on the table (drag it onto the hotbar)' }),
        () => { const w = wheel(); return w ? { kind: 'wheel', ref: w.id, label: w.name, icon: 'chart-pie' } : null; });
      bind(() => { const w = wheel(); spin.disabled = !w || !w.entries.length; });
      // the entries
      const list = h('div', { class: 'wheel-entries' });
      // each change goes to main as one step on the wheel as it is there (typing quickly loses nothing)
      const edit = (w, o) => cmd('wheel.edit', { id: w.id, ...o });
      bind(() => {
        const w = wheel();
        const sig = JSON.stringify(w);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        // the field that had the keyboard keeps it (after an entry is added you just type the next one)
        const a = document.activeElement;
        const keep = a && list.contains(a) ? (a.classList.contains('wheel-add') ? { add: true } : a.classList.contains('wheel-label') ? { id: a.closest('.wheel-row').dataset.id, pos: a.selectionStart } : null) : null;
        list.innerHTML = '';
        if (!w) { list.append(hint('No wheel yet.')); return; }
        const sum = w.entries.reduce((x, e) => x + e.weight, 0) || 1;
        w.entries.forEach((e, i) => {
          const label = h('input', { type: 'text', class: 'wheel-label', value: e.label, 'aria-label': `Entry ${i + 1}`, spellcheck: 'false',
            onchange: (ev) => edit(w, { update: { entryId: e.id, patch: { label: ev.target.value } } }),
            onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); } });
          list.append(h('div', { class: 'wheel-row', dataset: { id: e.id } },
            h('button', { class: 'wheel-color', style: `background:${e.color}`, 'aria-label': 'Colour', 'data-tip': 'Colour', onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); colorMenu(w, e, r.left, r.bottom + 4); } }),
            label,
            h('button', { class: 'wheel-weight', 'data-tip': `How likely: ${Math.round((e.weight / sum) * 100)}% (click for more, right-click for less)`, 'aria-label': `Weight of ${e.label}`,
              onclick: () => edit(w, { update: { entryId: e.id, patch: { weight: Math.min(100, e.weight + 1) } } }),
              oncontextmenu: (ev) => { ev.preventDefault(); edit(w, { update: { entryId: e.id, patch: { weight: Math.max(1, e.weight - 1) } } }); } }, `×${e.weight}`),
            h('button', { class: 'icon-btn', 'aria-label': `Delete ${e.label}`, 'data-tip': 'Delete', onclick: () => edit(w, { remove: e.id }) }, iconEl('x'))));
        });
        const add = h('input', { type: 'text', class: 'wheel-add', placeholder: w.entries.length ? 'New entry, Enter' : 'First entry, Enter', 'aria-label': 'New entry', spellcheck: 'false',
          onkeydown: (ev) => { if (ev.key === 'Enter' && ev.target.value.trim()) { edit(w, { add: { label: ev.target.value.trim() } }); ev.target.value = ''; } } });
        list.append(h('div', { class: 'wheel-row add' }, iconEl('plus'), add));
        if ((keep && keep.add) || focusAdd) { focusAdd = false; add.focus(); }
        else if (keep && keep.id) { const f = list.querySelector(`.wheel-row[data-id="${keep.id}"] .wheel-label`); if (f) { f.focus(); try { f.setSelectionRange(keep.pos, keep.pos); } catch {} } }
      });
      return h('div', { class: 'stack' }, h('div', { class: 'ctl-row' }, pick, more), row(spin), resultLine('wheel'), row(offTv()), list);
    }
    function wheelMenu(x, y) {
      const w = wheel();
      const pick = (r) => { if (r && r.id) { D.wheel = r.id; refresh(); } };
      openMenu(x, y, [
        { icon: 'plus', label: 'New wheel …', action: async () => { const n = await askText('New wheel', '', { ok: 'Create', placeholder: 'Random encounter, Loot, The god answers …' }); if (!n) return; const r = await saveWheel({ name: n, entries: [] }); if (r && r.id) { D.wheel = r.id; focusAdd = true; refresh(); } } },
        { icon: 'clipboard-text', label: 'Paste a table …', action: () => pasteDialog() },
        { icon: 'table-import', label: 'Import from files …', action: async () => { const r = await cmd('wheel.importFiles', {}); if (r && r.canceled) return; if (r && r.ok) { pick(r); toast(r.label); } else if (r) toast(r.label || 'No entries in that file', { kind: 'error' }); } },
        { icon: 'books', label: 'From the library (Tables) …', action: () => libraryDialog() },
        '-',
        { icon: 'pencil', label: 'Rename …', disabled: !w, action: async () => { const n = await askText('Rename wheel', w.name); if (n) saveWheel({ ...w, name: n }); } },
        { icon: 'copy', label: 'Duplicate', disabled: !w, action: async () => { const r = await saveWheel({ name: `${w.name} (copy)`, entries: w.entries.map(({ id, ...x }) => x) }); pick(r); } },
        { icon: 'table-export', label: 'Export as .csv …', disabled: !w || !w.entries.length, action: async () => { const r = await cmd('wheel.export', { id: w.id, to: 'file' }); if (r && r.ok) toast(r.label); else if (r && r.error) toast(r.error, { kind: 'error' }); } },
        { icon: 'books', label: 'Put it in the library (every campaign)', disabled: !w || !w.entries.length, action: async () => { const r = await cmd('wheel.export', { id: w.id, to: 'library' }); if (r && r.ok) toast(r.label); else if (r && r.error) toast(r.error, { kind: 'error' }); } },
        ...(w ? [Hotbar.menuItem({ kind: 'wheel', ref: w.id, label: w.name, icon: 'chart-pie' })] : []),
        { icon: 'trash', label: 'Delete', disabled: !w, action: async () => { const r = await cmd('wheel.remove', { id: w.id }); if (r && r.ok) { D.wheel = null; refresh(); toast(r.label, { undo: () => cmd(r.undo.type, r.undo.payload) }); } } },
      ]);
    }
    // paste a table (from a book, a website, a spreadsheet); the preview shows what each entry's chance will be
    function pasteDialog() {
      const w = wheel();
      const area = h('textarea', { class: 'tp-text', spellcheck: 'false', 'aria-label': 'The table',
        placeholder: 'One entry per line, or a table:\n01–40  Goblins\n41–75  Wolves\n76–00  A dragon\n\nWeights work too:  Gold ×3  or  Gold, 3\nMarkdown and spreadsheet rows are fine.' });
      const name = h('input', { type: 'text', placeholder: 'Name of the wheel', 'aria-label': 'Name of the wheel', spellcheck: 'false' });
      let named = false; // the GM typed a name: it stays
      name.addEventListener('input', () => { named = !!name.value.trim(); });
      let into = 'new';
      const where = w ? h('div', { class: 'seg seg-2', role: 'radiogroup', 'aria-label': 'Where to' }) : null;
      if (w) {
        for (const [v, label] of [['new', 'A new wheel'], ['add', `Add to ${w.name}`]]) {
          where.append(h('button', { type: 'button', class: 'seg-btn', role: 'radio', dataset: { v }, onclick: () => { into = v; paint(); } }, h('span', { class: 'ellipsis' }, label)));
        }
      }
      const info = h('div', { class: 'tp-info' });
      const list = h('div', { class: 'tp-list' });
      const go = h('button', { type: 'button', class: 'btn primary', onclick: () => make() }, iconEl('chart-pie'), 'Make the wheel');
      let res = { entries: [] };
      function paint() {
        if (where) for (const b of where.children) { b.classList.toggle('on', b.dataset.v === into); b.setAttribute('aria-checked', b.dataset.v === into); }
        res = TableParse.parse(area.value);
        if (!named && into === 'new') name.value = res.name || '';
        name.hidden = into !== 'new';
        go.disabled = !res.entries.length;
        go.lastChild.textContent = into === 'new' ? 'Make the wheel' : `Add ${res.entries.length || ''} entries`.replace('  ', ' ');
        const total = res.entries.reduce((a, e) => a + e.weight, 0) || 1;
        info.textContent = !res.entries.length ? 'The entries and their chances show up here.'
          : `${res.entries.length} entr${res.entries.length === 1 ? 'y' : 'ies'}${res.die ? `, a ${res.die} table` : ''}${res.skipped ? ` · ${res.skipped} line${res.skipped > 1 ? 's' : ''} left out` : ''}${res.more ? ` · only the first 100 (${res.more} more)` : ''}`;
        list.innerHTML = '';
        res.entries.forEach((e, i) => list.append(h('div', { class: 'tp-row' },
          h('i', { class: 'tp-dot', style: `background:${COLORS[i % COLORS.length]}` }), h('span', { class: 'ellipsis grow' }, e.label),
          e.weight > 1 ? h('small', {}, `×${e.weight}`) : null, h('b', {}, `${Math.round((e.weight / total) * 1000) / 10}%`))));
      }
      area.addEventListener('input', paint);
      // a file dropped on the box: its text
      area.addEventListener('dragover', (e) => e.preventDefault());
      area.addEventListener('drop', async (e) => {
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        area.value = await f.text();
        if (!named) { name.value = f.name.replace(/\.[^.]+$/, ''); named = true; }
        paint();
      });
      async function make() {
        if (!res.entries.length) return;
        const r = await cmd('wheel.import', into === 'new' ? { name: name.value.trim() || res.name || 'Table', entries: res.entries } : { into: w.id, entries: res.entries });
        if (r && r.ok) { dlg.close(); D.wheel = r.id; refresh(); toast(r.label); } else if (r && r.error) toast(r.error, { kind: 'error' });
      }
      const body = h('div', { class: 'tp' },
        h('div', { class: 'tp-in' }, area, where, name),
        h('div', { class: 'tp-out' }, info, list),
        h('div', { class: 'modal-actions tp-actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'), go));
      const dlg = UI.dialog('Paste a table', body, { wide: true });
      dlg.el.classList.add('tp-dlg');
      paint();
      area.focus();
    }
    // the library's Tables folder: the same tables in every campaign
    async function libraryDialog() {
      const body = h('div', { class: 'tp-lib' }, UI.loader('Looking …'));
      const dlg = UI.dialog('Tables in the library', body, { wide: true });
      const r = await cmd('wheel.library', {});
      body.innerHTML = '';
      const tables = (r && r.tables) || [];
      if (!tables.length) body.append(h('p', { class: 'hint' }, 'No tables yet. Put .txt, .csv or .md files into the Tables folder of your library.'));
      for (const t of tables) {
        const b = h('button', { class: 'btn small', onclick: async () => {
          b.disabled = true;
          const x = await cmd('wheel.importFiles', { paths: [t.path] });
          if (x && x.ok) { D.wheel = x.id; refresh(); toast(x.label); b.replaceChildren(iconEl('check'), 'Copied'); } else { b.disabled = false; toast((x && x.label) || 'No entries in that file', { kind: 'error' }); }
        } }, iconEl('copy'), 'Copy into this campaign');
        body.append(h('div', { class: 'tp-lib-row' }, iconEl('table'), h('span', { class: 'grow ellipsis', 'data-tip': t.rel }, t.name),
          h('small', {}, t.n ? `${t.n} entr${t.n === 1 ? 'y' : 'ies'}${t.die ? ` · ${t.die}` : ''}` : 'no entries'), b));
        if (!t.n) b.disabled = true;
      }
      if (r && r.dir) body.append(h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => window.ts.library('open', r.dir) }, iconEl('folder'), 'Open the Tables folder')));
      void dlg;
    }
    function colorMenu(w, e, x, y) {
      const NAMES = ['Oxblood', 'Slate', 'Moss', 'Old gold', 'Plum', 'Rust', 'Verdigris', 'Wine', 'Ash', 'Umber'];
      openMenu(x, y, COLORS.map((col, i) => ({ icon: 'circle', swatch: col, label: NAMES[i], checked: col === e.color, action: () => cmd('wheel.edit', { id: w.id, update: { entryId: e.id, patch: { color: col } } }) })));
    }

    // ---------- Death save ----------
    function deathTab() {
      const { btn, row, hint } = c();
      return h('div', { class: 'stack' },
        h('p', { class: 'death-lead' }, 'One d20 reel, slowing down to its number.'),
        row(Hotbar.offer(btn('Roll a death save on the table', 'heart-broken', () => go('death.roll', {}), { kind: 'primary wide', tip: 'A d20 reel spins on the table and slows to a stop' }), { kind: 'death', ref: null, label: 'Death save', icon: 'heart-broken' })),
        resultLine('death'), row(offTv()));
    }

    function buildPanel() {
      const tabs = c().seg({ cls: 'seg-3 dice-tabs', options: [
        { value: 'dice', label: 'Dice', icon: 'dice' }, { value: 'wheel', label: 'Wheel', icon: 'chart-pie' }, { value: 'death', label: 'Death save', icon: 'heart-broken' }],
      get: () => D.tab, set: (v) => { D.tab = v; save(); ctx.rebuild(); } });
      const body = D.tab === 'wheel' ? wheelTab() : D.tab === 'death' ? deathTab() : diceTab();
      return h('div', { class: 'stack dice-panel' }, tabs, body);
    }

    return { buildPanel, roll };
  }
  return { create };
})();
