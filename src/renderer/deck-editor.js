// Toolbox → Phone & tablet → Arrange the deck … (Beta 4.1): how the DM's phone looks, arranged here at the PC.
//   decks     one for phones, one for tablets (4.2): each device shows the one for its size, or the one chosen for it
//   presets   phone: Turn order + buttons, Turn order + your hotbar, Only buttons; tablet: Players + your hotbar,
//             Players + buttons. As they are: only lines of buttons added or taken away (4.2.1: simple by default)
//   Custom    anything: the turn order, the players, your own buttons (2–12 columns, 1–8 lines) or the hotbar
//   filling   click a square, then something on the right (or drag it onto a square); drag squares to swap them;
//             right-click a square: rename, clear. Every change reaches a connected phone at once.
//   colour    (4.2.3) the selected button's own colour: a light tint on the phone (a light scene: its own colours offered)
// main.js keeps the decks (settings.remote.decks: deckFix); S().remote.decks is what they are now.
'use strict';

const DeckEditor = (() => {
  const { h, iconEl, toast, dialog, openMenu, askText } = UI;
  const ts = window.ts;
  const DRAG = 'application/x-ts-deck';
  // (4.2.3) colours for the buttons: a few that read well on the dark deck
  const SWATCHES = ['#e4675e', '#f2994a', '#f2c94c', '#5cc382', '#3fb7b0', '#4f9bea', '#8b7cf6', '#d36ad6', '#b8bfcc'];
  const WARM = [255, 172, 98];
  const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const rgbOf = (s) => { const n = parseInt(String(s).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const ICON_OF = { volume: 'volume', moment: 'sparkles', light: 'sun', weather: 'cloud-rain', map: 'map-2', snap: 'camera', lights: 'bulb', mood: 'brand-spotify', roll: 'dice', death: 'heart-broken', wheel: 'chart-pie', fog: 'cloud-fog', cue: 'keyframes', sound: 'music', portrait: 'user', handout: 'photo', overlay: 'stack-2' };

  function open(ctx) {
    const S = () => ctx.state();
    let which = ctx.which === 'tablet' ? 'tablet' : 'phone'; // 4.2: a deck for phones, one for tablets
    let D = JSON.parse(JSON.stringify(S().remote.decks[which]));
    const presets = () => S().remote.presets || [];
    let page = 0;
    let sel = 0;
    let groups = null;
    let query = '';
    const openGroups = new Set(['moments', 'light', 'weather', 'hotbar']); // 4.3: the groups stay as the GM opened or closed them
    const wrap = h('div', { class: 'dk' });
    const dlg = dialog('Button deck: your phones and tablets', wrap, { wide: true });
    dlg.el.classList.add('dk-dlg');

    let saveT = 0;
    async function save(now = false) {
      clearTimeout(saveT);
      const w = which;
      const go = async () => { const r = await ts.remote('deck.set', { which: w, deck: D }); if (w === which && r && r.ok && r.deck) { const same = JSON.stringify(r.deck.pages) === JSON.stringify(D.pages); D = r.deck; if (!same) draw(); } ctx.refresh(); };
      if (now) await go(); else saveT = setTimeout(go, 250);
    }
    const n = () => D.cols * D.rows;
    const cur = () => D.pages[page] || (D.pages[page] = Array(n()).fill(null));
    const nextEmpty = (from) => { const pg = cur(); for (let k = 1; k <= pg.length; k++) { const i = (from + k) % pg.length; if (!pg[i]) return i; } return (from + 1) % pg.length; };
    function put(item, at = sel) {
      const pg = cur();
      pg[at] = { kind: item.kind, label: item.label, icon: item.icon || null, ref: item.ref ?? null };
      sel = nextEmpty(at);
      save(); draw();
    }

    // ---- presets (as they are: only lines added or taken away) and one Custom (anything)
    const isCustom = () => D.preset === 'custom';
    async function choose(id) {
      const r = await ts.remote('deck.preset', { which, id });
      if (r && r.ok) { D = r.deck; page = 0; sel = 0; draw(); ctx.refresh(); }
    }
    function miniOf(top, info, cols, rows) {
      return h('div', { class: 'dk-mini' }, top === 'turn' ? h('i', { class: 'dk-mini-top' }) : null, info ? h('i', { class: 'dk-mini-info' }) : null,
        h('div', { class: 'dk-mini-grid', style: `--c:${cols};--r:${rows}` }, ...Array.from({ length: cols * rows }, () => h('i'))));
    }
    function presetsEl() {
      const mine = presets().filter((p) => p.for === which);
      return h('div', { class: 'dk-presets' },
        ...mine.map((p) => h('button', { class: `dk-preset ${D.preset === p.id ? 'on' : ''}`, onclick: () => choose(p.id) }, miniOf(p.top, p.info, p.cols, p.rows), h('span', {}, p.label))),
        h('button', { class: `dk-preset custom ${isCustom() ? 'on' : ''}`, 'data-tip': 'Your own layout: turn order, players, your buttons or the hotbar', onclick: () => choose('custom') },
          h('div', { class: 'dk-mini dk-mini-custom' }, iconEl('adjustments')), h('span', {}, 'Custom')));
    }
    const stepper = (label, get, set, min, max) => h('div', { class: 'dk-step' }, h('span', {}, label),
      h('button', { class: 'icon-btn', 'aria-label': `Fewer ${label.toLowerCase()}`, disabled: get() <= min, onclick: () => set(get() - 1) }, iconEl('minus')),
      h('b', {}, String(get())),
      h('button', { class: 'icon-btn', 'aria-label': `More ${label.toLowerCase()}`, disabled: get() >= max, onclick: () => set(get() + 1) }, iconEl('plus')));
    async function resize(cols, rows) {
      D.cols = cols; D.rows = rows; sel = 0;
      await save(true); // main flows the buttons onto the new pages
      page = Math.min(page, D.pages.length - 1);
      draw();
    }
    function optsEl() {
      if (!isCustom()) { // a preset: lines of buttons, nothing more
        return h('div', { class: 'dk-opts' }, D.source === 'hotbar'
          ? h('p', { class: 'hint' }, 'Your hotbar, 2 × 5 per page as on the PC.')
          : stepper('Lines of buttons', () => D.rows, (v) => resize(D.cols, v), 1, 6));
      }
      const lim = S().remote.presetLimits || { cols: [2, 12], rows: [1, 8] };
      const seg = h('div', { class: 'seg' }, ...[['custom', 'Your own buttons'], ['hotbar', 'The hotbar']].map(([v, label]) => h('button', { class: `seg-btn ${D.source === v ? 'on' : ''}`, onclick: async () => { D.source = v; await save(true); page = 0; draw(); } }, h('span', {}, label))));
      const sw = (label, on, set, tip) => {
        const i = h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label });
        i.addEventListener('change', () => { set(i.checked); save(); draw(); });
        return h('label', { class: 'ctl ctl-toggle', 'data-tip': tip || null }, h('span', { class: 'ctl-label' }, label), i, h('span', { class: 'switch' }));
      };
      return h('div', { class: 'dk-opts' },
        sw('The turn order', D.top === 'turn', (v) => { D.top = v ? 'turn' : 'none'; }),
        sw('The players', !!D.info, (v) => { D.info = v; }, 'AC, HP, passives, senses, inspiration of those here today'),
        h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Buttons'), seg),
        D.source === 'custom' ? h('div', { class: 'dk-steps' }, stepper('Columns', () => D.cols, (v) => resize(v, D.rows), lim.cols[0], lim.cols[1]), stepper('Lines', () => D.rows, (v) => resize(D.cols, v), lim.rows[0], lim.rows[1])) : null);
    }

    // ---- the deck as the phone shows it
    function stripEl() {
      const I = S().init;
      let prev = 'Six'; let now = 'Fenric'; let next = 'Cadhla'; let round = '4';
      if (I && I.running && I.cur >= 0 && I.units.length) {
        const U = I.units; const k = U.length;
        now = U[I.cur].name; prev = U[(I.cur - 1 + k) % k].name; next = U[(I.cur + 1) % k].name;
        round = String((S().combat && S().combat.n) || '');
      }
      // 4.3: as the phone shows it: the round in a badge, before and next with a word and an arrow
      return h('div', { class: 'dk-strip' },
        h('span', { class: 'dk-round' }, h('small', {}, 'Round'), h('b', {}, round || '–')),
        h('span', { class: 'dk-side prev' }, iconEl('chevron-left'), h('span', { class: 'dk-who' }, h('small', {}, 'Before'), h('span', {}, prev))),
        h('span', { class: 'dk-arrow' }, h('i', { class: 'dk-face' }), h('b', {}, now)),
        h('span', { class: 'dk-side next' }, h('span', { class: 'dk-who' }, h('small', {}, 'Next'), h('span', {}, next)), iconEl('chevron-right')));
    }
    function slotEl(it, i, editable) {
      const el = h('button', { class: `dk-key ${it ? '' : 'empty'} ${editable && i === sel ? 'sel' : ''} ${it && it.color ? 'tinted' : ''}`, dataset: { i } },
        it ? iconEl(it.icon || ICON_OF[it.kind] || 'square') : iconEl('plus'), it ? h('span', {}, it.label) : null,
        it && it.kind === 'volume' ? h('i', { class: 'dk-vol', title: 'A slider on the phone or tablet' }) : null); // 4.11.5: drawn as the slider it is there
      if (it && it.color) el.style.setProperty('--kc', it.color);
      if (!editable) { el.disabled = !it; return el; }
      el.addEventListener('click', () => { sel = i; draw(); });
      if (it) { // 4.11.6: × on the button (on hover, or when selected) clears this one square
        const x = h('span', { class: 'dk-x', role: 'button', title: 'Clear this button', 'aria-label': `Clear ${it.label}` }, iconEl('x'));
        x.addEventListener('click', (e) => { e.stopPropagation(); cur()[i] = null; sel = i; save(); draw(); });
        el.append(x);
      }
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); sel = i; draw();
        if (!it) return;
        openMenu(e.clientX, e.clientY, [
          { icon: 'pencil', label: 'Rename …', action: async () => { const t = await askText('Name on the button', it.label, { ok: 'Rename' }); if (t) { cur()[i] = { ...it, label: t.slice(0, 40) }; save(); draw(); } } },
          { icon: 'x', label: 'Clear', action: () => { cur()[i] = null; save(); draw(); } },
        ]);
      });
      // drag: squares swap; a thing from the list lands here
      el.draggable = !!it;
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DRAG, JSON.stringify({ from: i })); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes(DRAG)) { e.preventDefault(); el.classList.add('over'); } });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('over');
        let d = null; try { d = JSON.parse(e.dataTransfer.getData(DRAG)); } catch {}
        if (!d) return;
        const pg = cur();
        if (d.item) put(d.item, i);
        else if (Number.isInteger(d.from) && d.from !== i) { [pg[d.from], pg[i]] = [pg[i], pg[d.from]]; sel = i; save(); draw(); }
      });
      return el;
    }
    function deckEl() {
      const hot = D.source === 'hotbar';
      const cols = hot ? 5 : D.cols; const rows = hot ? 2 : D.rows;
      const hb = (S().campaign && S().campaign.hotbar) || [];
      const pages = hot ? [0, 1, 2].map((p) => Array.from({ length: 10 }, (_, i) => hb[p * 10 + i] || null)).filter((pg, i) => i === 0 || pg.some(Boolean)) : D.pages;
      page = Math.max(0, Math.min(page, pages.length - 1));
      const pg = pages[page] || [];
      const grid = h('div', { class: 'dk-grid', style: `--c:${cols};--r:${rows}` }, ...Array.from({ length: cols * rows }, (_, i) => slotEl(pg[i] || null, i, !hot)));
      const pager = h('div', { class: 'dk-pager' },
        h('button', { class: 'icon-btn', 'aria-label': 'Page up', disabled: page === 0, onclick: () => { page -= 1; sel = 0; draw(); } }, iconEl('chevron-up')),
        h('b', {}, String(page + 1)), h('small', {}, `of ${pages.length}`),
        h('button', { class: 'icon-btn', 'aria-label': 'Page down', disabled: page >= pages.length - 1, onclick: () => { page += 1; sel = 0; draw(); } }, iconEl('chevron-down')));
      const pageBtns = hot ? null : h('div', { class: 'dk-pagebtns' },
        h('button', { class: 'btn small', disabled: D.pages.length >= 20, onclick: () => { D.pages.splice(page + 1, 0, Array(n()).fill(null)); page += 1; sel = 0; save(); draw(); } }, iconEl('plus'), 'New page'),
        h('button', { class: 'btn small ghost', disabled: D.pages.length < 2, onclick: () => { D.pages.splice(page, 1); page = Math.max(0, page - 1); sel = 0; save(); draw(); } }, iconEl('trash'), 'Delete this page'),
        h('button', { class: 'btn small ghost', onclick: () => { D.pages[page] = Array(n()).fill(null); sel = 0; save(); draw(); } }, iconEl('x'), 'Empty it'));
      return h('div', { class: 'dk-deck' },
        h('div', { class: `dk-phone ${which}` }, D.top === 'turn' ? stripEl() : null, D.info ? infoEl() : null, h('div', { class: 'dk-row' }, grid, pager)),
        hot ? null : colorsEl(),
        pageBtns,
        h('p', { class: 'hint' }, hot ? 'Your hotbar\'s slots: change them on the hotbar.'
          : 'Click a square, then something on the right, or drag it there. Drag squares to swap them, right-click to rename, × or Delete to remove. On the phone: tap the turn order for the next turn.'));
    }

    // (4.2.3) the selected button's colour: none, a few swatches, its light's own colours, any colour
    function ownColors(it) {
      if (it.kind === 'lights') {
        if (it.ref === 'room') return [['Room light', hex(WARM)]];
        const sc = ((S().lights && S().lights.scenes) || []).find((x) => x.id === it.ref);
        return sc ? [...new Set(sc.colors || [])].slice(0, 3).map((c, k) => [k ? '' : 'The scene', c]) : [];
      }
      if (it.kind === 'light') { // a map's light (Day, Dusk, Night …): the colour the room lights take for it
        const m = (typeof FXDATA !== 'undefined' ? FXDATA.MOODS : []).find((x) => x.id === it.ref);
        if (!m) return [];
        const d = Math.max(0, Math.min(1, Number(m.darkness) || 0));
        if (d < 0.15) return [['The light', hex(WARM)]];
        const t = rgbOf(m.tint); const mx = Math.max(...t, 1); const full = t.map((v) => (v * 255) / mx);
        const k = Math.max(0, Math.min(1, (d - 0.1) * 1.8));
        return [['The light', hex(WARM.map((v, j) => v + (full[j] - v) * k))]];
      }
      return [];
    }
    function colorsEl() {
      const it = cur()[sel];
      if (!it) return h('p', { class: 'hint dk-colors-hint' }, 'Select a button to give it a colour.');
      const setColor = (c) => { cur()[sel] = { ...it, color: c || undefined }; if (!c) delete cur()[sel].color; save(); draw(); };
      const now = (it.color || '').toLowerCase();
      const sw = (c, tip) => h('button', { class: `dk-sw ${now === c ? 'on' : ''}`, style: `--sw:${c}`, 'aria-label': tip || `Colour ${c}`, 'data-tip': tip || null, onclick: () => setColor(c) });
      const own = ownColors(it).map(([label, c]) => (label
        ? h('button', { class: `dk-sw own ${now === c ? 'on' : ''}`, style: `--sw:${c}`, 'data-tip': 'The colour this light shows', onclick: () => setColor(c) }, h('i'), label)
        : sw(c, 'A colour of this scene')));
      const pick = h('input', { type: 'color', value: now || '#e3963e', 'aria-label': 'Any colour' });
      pick.addEventListener('input', () => { const k = wrap.querySelector(`.dk-key[data-i="${sel}"]`); if (k) { k.classList.add('tinted'); k.style.setProperty('--kc', pick.value); } });
      pick.addEventListener('change', () => setColor(pick.value.toLowerCase()));
      const custom = now && !SWATCHES.includes(now) && !ownColors(it).some(([, c]) => c === now);
      return h('div', { class: 'dk-colors' }, h('span', { class: 'ctl-label' }, `Colour of “${it.label}”`),
        h('button', { class: `dk-sw none ${now ? '' : 'on'}`, 'aria-label': 'No colour', 'data-tip': 'No colour', onclick: () => setColor(null) }, iconEl('x')),
        ...own, own.length ? h('i', { class: 'dk-sep' }) : null,
        ...SWATCHES.map((c) => sw(c)),
        h('label', { class: `dk-pick ${custom ? 'on' : ''}`, style: custom ? `background:${now};border-style:solid` : '', 'data-tip': 'Any colour …' }, custom ? null : iconEl('plus'), pick));
    }
    // the players (the cards of those here today), as the tablet shows them
    function infoEl() {
      const cs = (S().chars || []).filter((c) => c.here);
      const list = cs.length ? cs : ['Fenric', 'Cadhla', 'Six'].map((name) => ({ name, ac: null, maxHp: null }));
      return h('div', { class: 'dk-info' }, ...list.slice(0, 6).map((c) => h('div', { class: 'dk-pc', style: c.color ? `--cc:${c.color}` : '' },
        c.face ? h('img', { src: c.face, alt: '' }) : h('i', { class: 'dk-face' }),
        h('b', { class: 'ellipsis' }, c.name), h('small', {}, `AC ${c.ac ?? '–'} · HP ${c.hp ? `${c.hp.cur ?? '–'}/${c.hp.max ?? '–'}` : c.maxHp ?? '–'} · Perc. ${c.pp ?? '–'}`))));
    }
    // ---- what can go on a button
    function catalogEl() {
      if (D.source === 'hotbar') return null;
      const q = h('input', { type: 'search', placeholder: 'Find …', value: query, 'aria-label': 'Find a button', spellcheck: 'false' });
      const list = h('div', { class: 'dk-cat-list' });
      const fill = () => {
        const t = query.trim().toLowerCase();
        if (!groups) { list.replaceChildren(h('p', { class: 'hint' }, 'Loading …')); return; }
        list.replaceChildren(...groups.map((g) => {
          const items = g.items.filter((it) => !t || it.label.toLowerCase().includes(t) || (it.sub || '').toLowerCase().includes(t));
          if (!items.length) return null;
          const d = h('details', { class: 'dk-grp', open: !!t || openGroups.has(g.id) || undefined },
            h('summary', {}, g.label, h('small', {}, String(items.length))),
            h('div', { class: 'dk-items' }, ...items.map((it) => {
              const b = h('button', { class: 'dk-item', draggable: true, 'data-tip': it.sub ? `${it.label} (${it.sub})` : it.label, onclick: () => put(it) },
                iconEl(it.icon || ICON_OF[it.kind] || 'square'), h('span', { class: 'ellipsis' }, it.label));
              b.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DRAG, JSON.stringify({ item: it })); e.dataTransfer.effectAllowed = 'copy'; });
              return b;
            })));
          if (!t) d.addEventListener('toggle', () => { if (d.open) openGroups.add(g.id); else openGroups.delete(g.id); });
          return d;
        }).filter(Boolean));
      };
      q.addEventListener('input', () => { query = q.value; fill(); });
      fill();
      return h('div', { class: 'dk-cat' }, q, list);
    }

    // 4.11.6: Delete or Backspace clears the selected square
    const onKey = (e) => {
      if (!dlg.el.isConnected) { window.removeEventListener('keydown', onKey); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (dlg.el.closest('.modal-back') !== [...document.querySelectorAll('.modal-back')].pop()) return; // (a window over it)
      if (D.source === 'hotbar' || !cur()[sel]) return;
      e.preventDefault(); cur()[sel] = null; save(); draw();
    };
    window.addEventListener('keydown', onKey);
    function draw() {
      const scroll = wrap.querySelector('.dk-cat-list');
      const keep = scroll ? scroll.scrollTop : 0;
      const focused = document.activeElement && document.activeElement.type === 'search';
      const tabs = h('div', { class: 'seg dk-which' }, ...[['phone', 'Phone deck', 'device-mobile'], ['tablet', 'Tablet deck', 'device-tablet']].map(([v, label, icn]) => h('button', { class: `seg-btn ${which === v ? 'on' : ''}`,
        onclick: async () => { if (which === v) return; await save(true); which = v; D = JSON.parse(JSON.stringify(S().remote.decks[which])); page = 0; sel = 0; draw(); } }, iconEl(icn), h('span', {}, label))));
      wrap.replaceChildren(h('div', { class: 'dk-whichrow' }, tabs, h('span', { class: 'hint' }, 'Phones show the phone deck, tablets the tablet deck.')),
        presetsEl(), optsEl(), h('div', { class: `dk-body ${D.source === 'hotbar' ? 'hot' : ''}` }, deckEl(), catalogEl()));
      const sc = wrap.querySelector('.dk-cat-list');
      if (sc) sc.scrollTop = keep;
      if (focused) { const q = wrap.querySelector('.dk-cat input'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    }
    draw();
    ts.remote('catalog').then((r) => { groups = (r && r.groups) || []; draw(); }).catch(() => { toast('The list didn\'t load'); });
    return dlg;
  }
  return { open };
})();
