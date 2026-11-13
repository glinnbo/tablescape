// Characters (Beta 4.2): a card for each player character, filled in once on the campaign page, GM only.
//   card     who plays it, portrait, Talk sprite, map token, colour, AC, max HP, passive Perception,
//            Insight, Investigation, darkvision and other senses, languages, notes (Characters.openEditor)
//   panel    Toolbox → Characters (Shift + I): the party at a glance, live from the turn order: HP, conditions;
//            inspiration, exhaustion, death saves; a passive check (DC 15: who notices it)
//   elsewhere the turn order (AC, HP; the character's token joins its line), the player screen and
//            the Stream Deck (portrait, colour), Talk (the party's sprites first), the Party tool (darkvision)
// main.js keeps them (meta.characters, charSet); S().chars is what the GM screen sees.
'use strict';

const Characters = (() => {
  const { h, iconEl, toast, dialog } = UI;
  const ts = window.ts;
  const PASSIVES = [['pp', 'Perception'], ['ins', 'Insight'], ['inv', 'Investigation']];
  const set = (name, patch, live = false) => ts.cmd('char.set', { name, patch, live });
  const dash = (v) => (v == null || v === '' ? '–' : String(v));
  const initialOf = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
  const face = (c, cls) => (c.face ? h('img', { class: cls, src: c.face, alt: '', draggable: false }) : h('div', { class: `${cls} ch-initial`, style: c.color ? `--cc:${c.color}` : '' }, initialOf(c.name)));

  // ---------------------------------------------------------------- a picture from the library
  async function pickImage(title, cats) {
    const all = ((await ts.library()) || []).filter((x) => cats.includes(x.cat) && x.kind === 'image');
    return new Promise((resolve) => {
      let done = false;
      const q = h('input', { type: 'search', placeholder: 'Find a picture', 'aria-label': 'Find a picture', spellcheck: 'false' });
      const grid = h('div', { class: 'rm-pick' });
      const fill = () => {
        const t = q.value.trim().toLowerCase();
        const list = all.filter((x) => !t || x.name.toLowerCase().includes(t) || x.rel.toLowerCase().includes(t))
          .sort((a, b) => (a.cat === b.cat ? a.name.localeCompare(b.name) : cats.indexOf(a.cat) - cats.indexOf(b.cat))).slice(0, 200);
        grid.replaceChildren(...(list.length ? list.map((x) => h('button', { class: 'rm-pick-it', 'data-tip': x.rel, onclick: () => { done = true; d.close(); resolve(x.path); } },
          h('img', { src: x.thumb || x.url, alt: '', loading: 'lazy' }), h('span', { class: 'ellipsis' }, x.name)))
          : [h('p', { class: 'hint' }, all.length ? 'Nothing with that name' : `Nothing in the library yet (${cats.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')})`)]));
      };
      q.addEventListener('input', fill);
      // 4.2.1: a picture from anywhere on this PC: it is copied into the library (Portraits or Tokens) and taken
      const fromPc = h('button', { class: 'btn', onclick: async () => {
        const r = await ts.library('import', { cat: cats[0] });
        if (!r || !r.ok || !r.items || !r.items.length) { if (r && r.error) toast(r.error, { kind: 'error' }); return; }
        done = true; d.close(); resolve(r.items[0].path);
        toast(`${r.items[0].name} is in your library now${r.copied ? ' (copied)' : ''}`, { ms: 2400 });
      } }, iconEl('folder'), 'From this PC …');
      const d = dialog(title, h('div', { class: 'stack ch-pick' }, h('div', { class: 'ctl-row' }, q, fromPc), grid), { wide: true, onClose: () => { if (!done) resolve(null); } });
      d.el.classList.add('ch-pick-dlg');
      fill();
      q.focus();
    });
  }

  // 4.7: the party's pictures that are still in Portraits or Tokens: one click moves them into the Party folder
  function gatherNote(S, after) {
    const n = (S() && S().partyLoose) || 0;
    if (!n) return null;
    return h('div', { class: 'ch-gather' }, iconEl('users-group'), h('span', { class: 'grow' }, `${n} of the party's pictures ${n === 1 ? 'is' : 'are'} not in the Party folder yet`),
      h('button', { class: 'btn small', 'data-tip': 'Moves them into the library\'s Party folder', onclick: async (e) => {
        e.currentTarget.disabled = true;
        const r = await ts.cmd('party.gather');
        if (r && r.ok) toast(`${r.moved} picture${r.moved === 1 ? '' : 's'} moved into Party${r.failed ? ` (${r.failed} could not be moved)` : ''}`, { ms: 3000 });
        else toast((r && r.error) || 'That did not work.', { kind: 'error' });
        if (after) setTimeout(after, 250);
      } }, iconEl('folder'), 'Move them into Party'));
  }

  // ---------------------------------------------------------------- the card (campaign page → Players)
  function openEditor(o) {
    const S = () => o.state();
    const chars = () => S().chars || [];
    let name = o.name || (chars()[0] && chars()[0].name);
    if (!name) { toast('Add a player first (campaign page → Players)'); return null; }
    const body = h('div', { class: 'ch-ed' });
    const d = dialog('Character card', body, { wide: true });
    d.el.classList.add('ch-dlg');
    const cur = () => chars().find((c) => c.name === name) || { name };
    const field = (label, input, hint) => h('label', { class: 'ch-f' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
    const num = (key, value, min, max, ph = '') => {
      const i = h('input', { type: 'number', min, max, value: value ?? '', placeholder: ph, 'aria-label': key });
      i.addEventListener('change', () => set(name, { [key]: i.value === '' ? null : Number(i.value) }));
      return i;
    };
    const text = (key, value, ph, max) => {
      const i = h('input', { type: 'text', value: value || '', placeholder: ph, maxLength: max, spellcheck: 'false', 'aria-label': key });
      i.addEventListener('change', () => set(name, { [key]: i.value }));
      return i;
    };
    async function choosePic(key, label, cats) {
      const p = await pickImage(`${label} for ${name}`, cats);
      if (p) { await set(name, { [key]: p }); setTimeout(draw, 150); }
    }
    function picSlot(key, label, cats, hint) {
      const c = cur(); const v = c[key];
      return h('div', { class: 'ch-pic' },
        h('div', { class: `ch-pic-img ${key}` }, v ? h('img', { src: v.url, alt: '' }) : iconEl(key === 'token' ? 'circle-dashed' : 'user')),
        h('div', { class: 'ch-pic-txt' }, h('b', {}, label), h('small', {}, v ? v.path.split(/[\\/]/).pop() : hint),
          h('div', { class: 'ctl-row' }, h('button', { class: 'btn small', onclick: () => choosePic(key, label, cats) }, iconEl('photo'), 'Choose …'),
            v ? h('button', { class: 'btn small ghost', onclick: async () => { await set(name, { [key]: null }); setTimeout(draw, 150); } }, iconEl('x')) : null)));
    }
    // Prototype 8: extra moves (Cunning Action, Step of the Wind …): a name and the feet it adds
    const MOVES = [['Cunning Action', null], ['Step of the Wind', null], ['Expeditious Retreat', null], ['Haste', null], ['Longstrider', 10], ['Mobile', 10]];
    function movesList(c) {
      const list = (c.moves || []).map((x) => ({ name: x.name, ft: x.ft ?? null }));
      const save = async (next) => { await set(name, { moves: next }); setTimeout(draw, 150); };
      const rows = list.map((x, i) => {
        const nm = h('input', { type: 'text', value: x.name, maxLength: 30, spellcheck: 'false', 'aria-label': 'Name of the move' });
        nm.addEventListener('change', () => { const v = nm.value.trim(); save(v ? list.map((y, j) => (j === i ? { ...y, name: v } : y)) : list.filter((_, j) => j !== i)); });
        const ft = h('input', { type: 'number', min: 5, max: 120, step: 5, value: x.ft ?? '', placeholder: 'speed', 'aria-label': 'Feet' });
        ft.addEventListener('change', () => save(list.map((y, j) => (j === i ? { ...y, ft: ft.value === '' ? null : Number(ft.value) } : y))));
        return h('div', { class: 'ch-mv' }, nm, ft, h('small', {}, 'ft'), h('button', { class: 'icon-btn', 'aria-label': `Remove ${x.name}`, 'data-tip': 'Remove', onclick: () => save(list.filter((_, j) => j !== i)) }, iconEl('x')));
      });
      const add = list.length >= 6 ? null : h('button', { class: 'btn small', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); UI.openMenu(r.left, r.bottom + 4, [
        ...MOVES.filter(([n]) => !list.some((y) => y.name === n)).map(([n, f]) => ({ icon: 'bolt', label: f ? `${n} (+${f} ft)` : `${n} (the speed again)`, action: () => save([...list, { name: n, ft: f }]) })), '-',
        { icon: 'pencil', label: 'Your own …', action: async () => { const n = await UI.askText('An extra move', '', { ok: 'Add', placeholder: 'Its name on the phone' }); if (n) save([...list, { name: n.slice(0, 30), ft: null }]); } }]); } }, iconEl('plus'), 'Add a move');
      return [...rows, add].filter(Boolean);
    }
    function draw() {
      const c = cur();
      const pick = h('select', { 'aria-label': 'Character' }, ...chars().map((x) => h('option', { value: x.name, selected: x.name === name }, x.name)));
      pick.addEventListener('change', () => { name = pick.value; draw(); });
      const col = h('input', { type: 'color', value: c.color || '#e3963e', 'aria-label': 'Colour' });
      col.addEventListener('change', () => set(name, { color: col.value }));
      const notes = h('textarea', { rows: 4, placeholder: 'Class and level, hooks, secrets … (only you see them)', maxLength: 4000, spellcheck: 'true', 'aria-label': 'Notes' }, c.notes || '');
      notes.addEventListener('change', () => set(name, { notes: notes.value }));
      body.replaceChildren(...[gatherNote(S, draw),
        h('div', { class: 'ch-top' }, face(c, 'ch-big'), h('div', { class: 'ch-top-txt' }, h('div', { class: 'ctl-row' }, pick, h('small', { class: 'hint' }, 'Everything here is only for you')),
          h('div', { class: 'ch-row' }, field('Played by', text('player', c.player, 'Marco', 40)), field('Colour', h('div', { class: 'ctl-row' }, col, c.color ? h('button', { class: 'btn small ghost', onclick: async () => { await set(name, { color: null }); setTimeout(draw, 150); } }, 'None') : null), 'Player screen, cards')))),
        h('div', { class: 'ch-sec' }, h('h3', {}, 'Pictures'), h('div', { class: 'ch-pics' },
          picSlot('portrait', 'Portrait', ['party', 'portraits', 'tokens'], 'Turn order, player screen, button deck'), // 4.7: the Party folder first
          picSlot('sprite', 'Cut-out', ['party', 'portraits'], 'Stands in a Conversation on the table'),
          picSlot('token', 'Map token', ['party', 'tokens'], 'On the map it joins this character\'s turn'))),
        h('div', { class: 'ch-cols' },
          h('div', { class: 'ch-sec' }, h('h3', {}, 'Initiative'), h('div', { class: 'ch-row' }, field('AC', num('ac', c.ac, 0, 40)), field('Max HP', num('hp', c.maxHp, 1, 999)))),
          h('div', { class: 'ch-sec' }, h('h3', {}, 'Passives'), h('div', { class: 'ch-row' }, ...PASSIVES.map(([k, l]) => field(l, num(k, c[k], 0, 40)))))),
        h('div', { class: 'ch-cols' },
          h('div', { class: 'ch-sec' }, h('h3', {}, 'Senses'), h('div', { class: 'ch-row' }, field('Darkvision', num('dark', c.dark, 0, 300, '0'), 'feet: the Party marker takes it'), field('Other senses', text('senses', c.senses, 'Blindsight 10 ft', 200)))),
          h('div', { class: 'ch-sec' }, h('h3', {}, 'Languages'), text('languages', c.languages, 'Common, Elvish, Thieves\' cant', 200))),
        // Prototype 8: for the players' phones: how far they walk in a turn, and moves that add to it once a turn
        h('div', { class: 'ch-sec' }, h('h3', {}, 'Movement'), h('div', { class: 'ch-row ch-move' },
          field('Speed', num('speed', c.speed, 5, 120, '30'), 'feet a turn, on the phone'),
          h('div', { class: 'ch-f ch-moves' }, h('span', {}, 'Extra moves'), ...movesList(c),
            h('small', {}, 'A button on the phone next to Dash, once a turn. No feet: the speed again.')))),
        h('div', { class: 'ch-sec' }, h('h3', {}, 'Notes'), notes)].filter(Boolean));
    }
    draw();
    return d;
  }

  // ---------------------------------------------------------------- Toolbox → Characters (Shift + I)
  function create(ctx) {
    const S = () => ctx.state();
    const check = { on: false, kind: 'pp', dc: 15 };
    function trackers(c, compact) {
      const star = h('button', { class: `ch-star ${c.insp ? 'on' : ''}`, 'aria-label': `Inspiration ${c.insp ? 'on' : 'off'}`, 'data-tip': c.insp ? 'Inspiration (click: used)' : 'No inspiration (click: give it)', onclick: () => set(c.name, { insp: !c.insp }, true) }, iconEl('star'));
      const exh = h('span', { class: `ch-exh ${c.exh ? 'on' : ''}`, 'data-tip': 'Exhaustion' },
        h('button', { class: 'icon-btn', 'aria-label': 'Less exhaustion', disabled: !c.exh, onclick: () => set(c.name, { exh: c.exh - 1 }, true) }, iconEl('minus')),
        h('span', {}, `Exh. ${c.exh}`),
        h('button', { class: 'icon-btn', 'aria-label': 'More exhaustion', disabled: c.exh >= 6, onclick: () => set(c.name, { exh: c.exh + 1 }, true) }, iconEl('plus')));
      const showDs = c.down || c.ds.s || c.ds.f;
      const tick = (kind, i) => h('button', { class: `ch-ds ${kind} ${c.ds[kind] > i ? 'on' : ''}`, 'aria-label': `${kind === 's' ? 'Success' : 'Failure'} ${i + 1}`,
        onclick: () => set(c.name, { ds: { ...c.ds, [kind]: c.ds[kind] > i ? i : i + 1 } }, true) });
      const ds = showDs ? h('span', { class: 'ch-dss', 'data-tip': 'Death saves: successes, failures (click to tick)' }, iconEl('heart'), tick('s', 0), tick('s', 1), tick('s', 2), h('i', { class: 'sep' }), iconEl('skull'), tick('f', 0), tick('f', 1), tick('f', 2),
        h('button', { class: 'link-btn', onclick: () => set(c.name, { ds: { s: 0, f: 0 } }, true) }, 'Clear')) : null;
      return h('div', { class: `ch-track ${compact ? 'compact' : ''}` }, star, exh, ds);
    }
    function cardEl(c) {
      const hp = c.hp ? `${dash(c.hp.cur)} / ${dash(c.hp.max)}` : c.maxHp ? `${c.maxHp}` : '–';
      const pass = PASSIVES.map(([k, l]) => {
        const v = c[k];
        const hit = check.on && check.kind === k && v != null ? (v >= check.dc ? 'yes' : 'no') : '';
        return h('span', { class: `ch-pass ${check.on && check.kind === k ? 'chk' : ''} ${hit}` }, h('small', {}, l === 'Perception' ? 'Perc.' : l === 'Insight' ? 'Ins.' : 'Inv.'), h('b', {}, dash(v)), hit ? iconEl(hit === 'yes' ? 'check' : 'x') : null);
      });
      const notes = c.notes ? h('details', { class: 'ch-notes' }, h('summary', {}, 'Notes'), h('p', {}, c.notes)) : null;
      return h('div', { class: `ch-card ${c.down ? 'down' : ''}`, style: c.color ? `--cc:${c.color}` : '' },
        h('div', { class: 'ch-head' }, face(c, 'ch-face'),
          h('div', { class: 'grow ch-who' }, h('b', {}, c.name), c.player ? h('small', {}, c.player) : null),
          h('span', { class: 'ch-ac', 'data-tip': 'Armour class' }, iconEl('shield'), h('b', {}, dash(c.ac))),
          h('span', { class: `ch-hp ${c.down ? 'zero' : ''}`, 'data-tip': c.hp ? 'HP now (from the turn order)' : 'Max HP' }, iconEl('heart'), h('b', {}, hp)),
          h('button', { class: 'icon-btn', 'aria-label': `Card of ${c.name}`, 'data-tip': 'Edit the card', onclick: () => openEditor({ state: S, name: c.name }) }, iconEl('pencil'))),
        h('div', { class: 'ch-line' }, ...pass, c.dark ? h('span', { class: 'ch-sense' }, iconEl('eye'), `${c.dark} ft`) : null, c.speed ? h('span', { class: 'ch-sense', 'data-tip': 'Speed' }, iconEl('walk'), `${c.speed} ft`) : null, c.senses ? h('span', { class: 'ch-sense' }, iconEl('ear'), c.senses) : null),
        c.languages ? h('div', { class: 'ch-lang' }, iconEl('language'), c.languages) : null,
        c.cond.length ? h('div', { class: 'ch-cond' }, ...c.cond.map((x) => h('span', {}, x))) : null,
        trackers(c), notes);
    }
    function buildPanel() {
      const kinds = h('div', { class: 'seg seg-3' });
      const dc = h('input', { type: 'number', min: 1, max: 40, value: check.dc, 'aria-label': 'DC' });
      const onBtn = h('button', { class: 'btn small' });
      const list = h('div', { class: 'ch-list' });
      const away = h('div', { class: 'ch-away' });
      const redraw = () => { list.dataset.sig = ''; ctx.refresh(); };
      dc.addEventListener('input', () => { check.dc = Math.max(1, Math.min(40, Number(dc.value) || 0)); check.on = true; redraw(); });
      ctx.ctl.bind(() => {
        kinds.replaceChildren(...PASSIVES.map(([k, l]) => h('button', { class: `seg-btn ${check.kind === k ? 'on' : ''}`, onclick: () => { check.kind = k; check.on = true; redraw(); } }, h('span', {}, l))));
        onBtn.replaceChildren(iconEl(check.on ? 'x' : 'eye-check'), check.on ? 'Done' : 'Check');
        onBtn.onclick = () => { check.on = !check.on; redraw(); };
        const cs = S().chars || [];
        const sig = JSON.stringify([cs, check]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        const here = cs.filter((c) => c.here);
        list.replaceChildren(...(here.length ? here.map(cardEl) : [h('p', { class: 'hint' }, cs.length ? 'Nobody is here today (campaign page → Players).' : 'No players yet: add them on the campaign page (Players), then fill in their cards.')]));
        const gone = cs.filter((c) => !c.here);
        away.replaceChildren(...(gone.length ? [h('span', { class: 'hint' }, 'Not here today: '), ...gone.map((c) => h('button', { class: 'link-btn', onclick: () => openEditor({ state: S, name: c.name }) }, c.name))] : []));
        if (check.on) {
          const k = PASSIVES.find(([x]) => x === check.kind);
          const yes = here.filter((c) => c[check.kind] != null && c[check.kind] >= check.dc).map((c) => c.name);
          list.prepend(h('p', { class: 'ch-verdict' }, yes.length ? `${k[1]} ${check.dc}: ${yes.join(', ')} notice${yes.length === 1 ? 's' : ''} it.` : `${k[1]} ${check.dc}: nobody notices it.`));
        }
      });
      const gather = h('div');
      ctx.ctl.bind(() => { const n = (S() && S().partyLoose) || 0; if (gather.dataset.n === String(n)) return; gather.dataset.n = String(n); gather.replaceChildren(...[gatherNote(S)].filter(Boolean)); });
      return h('div', { class: 'stack ch-panel' },
        gather,
        h('div', { class: 'ch-check' }, h('span', { class: 'ctl-label' }, 'Passive check'), kinds, h('label', { class: 'ch-dc' }, 'DC', dc), onBtn),
        list, away,
        ctx.ctl.row(ctx.ctl.btn('Character cards …', 'id-badge-2', () => openEditor({ state: S }), { kind: 'small', tip: 'Fill in or change the cards (also on the campaign page)' })));
    }
    return { buildPanel };
  }

  // Talk: the party's sprites (or portraits) first
  function talkItems(S) {
    return (S.chars || []).filter((c) => c.here && (c.sprite || c.portrait)).map((c) => { const p = c.sprite || c.portrait; return { path: p.path, name: c.name, kind: 'image', url: p.url }; });
  }
  // the Party tool: the best darkvision of those here today
  function darkvision(S) {
    const v = (S.chars || []).filter((c) => c.here && c.dark).map((c) => c.dark);
    return v.length ? Math.max(...v) : 0;
  }
  return { create, openEditor, pickImage, talkItems, darkvision };
})();
