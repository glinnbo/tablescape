// Toolbox → Players' phones (Prototype 1): the players move their own tokens from their phones.
//   switch        players may move (off: their phones show the party as before)
//   pace          free, movement (everyone walks their speed once, then waits for more), or paused; a rest between steps if wanted;
//                 while a turn order runs: only on your turn. Speed: the character card's, else the one set here
//   rules         the trace of a turn's steps, pings, an eye per token (a carried party light)
//   phones        every phone that scanned the players' code: its character, the light it carries, a token handed to it
//   join code     the players' QR code big on the TV for a minute and a half
// main: players.js has the rules; S().players is what it reports; window.ts.players(action, p) sets things.
'use strict';

const PlayersPanel = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const ago = (t) => {
    if (!t) return 'no step yet';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 5) return 'moving';
    if (s < 90) return `${Math.round(s)} s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
  };
  const WHY = { off: 'switched off', noMap: 'nothing on the table', noToken: 'no token on this map', paused: 'paused', hex: 'hex grid', turn: 'not their turn', spent: 'no movement left', rest: 'resting' };
  const CARRY_LABEL = { none: 'No light', candle: 'Candle', torch: 'Torch', lantern: 'Lantern', light: 'Light', daylight: 'Daylight', custom: 'Own light' };

  function create(ctx) {
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const P = () => S().players || { on: false, phones: [], party: [], tokens: [], carries: [] };
    const R = () => S().remote || { on: false, running: false, devices: [] };
    const act = async (a, p) => { const r = await window.ts.players(a, p); if (r && r.error) toast(r.error, { kind: 'error', ms: 4000 }); ctx.refresh(); return r; };
    const set = (patch) => act('set', patch);
    // UI audit VE6: a player's phone can be renamed and forgotten here (three phones called "iPhone", and one that left
    // for good, stayed in the list); Forget has an Undo, as on the GM's own devices
    const dev = async (a, p) => { const r = await window.ts.remote(a, p); ctx.refresh(); return r; };
    const forget = async (d) => { const r = await dev('forget', { id: d.id }); if (r && r.ok && r.back) toast(`${r.name || 'The phone'} forgotten`, { undo: () => dev('unforget', { id: r.back }) }); };

    function buildPanel() {
      const onSwitch = c().toggle({ label: 'Players may move their tokens', get: () => P().on, set: (v) => set({ on: v }) });
      // (F1: the server starts by itself; a line only when phones are switched off, or it can't listen)
      const net = h('p', { class: 'hint warn-text' });
      c().bind(() => { const r = R(); const msg = r.allowed === false ? 'Phones and tablets are switched off (Tablescape settings → This screen).' : r.on && r.error ? `Not listening: ${r.error}.` : ''; net.hidden = !msg; net.textContent = msg; });

      // F1: a message on the join card (the Wi-Fi's name and password). (UI audit VE4, Glinn: no address "for a phone
      // that can't scan" any more: an address alone connects nothing, joining is by the code)
      const msgBox = h('textarea', { class: 'pp-joinmsg', rows: 2, maxLength: 160, spellcheck: 'false', 'aria-label': 'Message on the join card', placeholder: 'Wi-Fi: Tavern\nPassword: dragons123' });
      c().bind(() => { const v = (S().settings && S().settings.joinMsg) || ''; if (document.activeElement !== msgBox && msgBox.value !== v) msgBox.value = v; });
      msgBox.addEventListener('change', () => window.ts.settings({ joinMsg: msgBox.value }));
      // UI audit VE11: a PC on two networks: which one the join code points at (the same choice as on the GM's own card;
      // it was only there, and the code on the table kept the first network)
      const other = h('details', { class: 'rm-other' });
      c().bind(() => {
        const r = R(); const urls = (r.running && r.urls) || [];
        other.hidden = urls.length < 2;
        const sig = JSON.stringify(urls);
        if (other.dataset.sig === sig) return;
        other.dataset.sig = sig;
        other.replaceChildren(h('summary', {}, 'Doesn\'t open? Another network of this PC'),
          ...urls.map((u, i) => h('button', { class: `link-btn ${i === 0 ? 'on' : ''}`, onclick: () => dev('addr', { url: u }) }, u.replace('http://', ''))));
      });

      // ---- the join code on the TV
      const joinBtn = h('button', { class: 'btn primary', 'data-tip': 'The players\' QR code big on the table for 90 seconds (again: take it off)' });
      // (Speed 9, WI8: its picture and words are put in only when they change, not on every tick)
      c().bind(() => { const on = !!P().join; if (joinBtn.dataset.sig !== String(on)) { joinBtn.dataset.sig = String(on); joinBtn.replaceChildren(iconEl(on ? 'x' : 'qrcode'), on ? 'Take the code off the table' : 'Join code on the table'); } joinBtn.onclick = () => act('join', { on: !on }); joinBtn.classList.toggle('primary', !on); });

      // ---- pace
      const pace = c().seg({ label: 'Pace', get: () => (['paused', 'group'].includes(P().pace) ? P().pace : 'free'), set: (v) => set({ pace: v }), options: [
        { value: 'free', label: 'Free', icon: 'walk', tip: 'Walk as they like (a fight still waits for their turn)' },
        { value: 'group', label: 'Movement', icon: 'run', tip: 'Everyone walks their speed once, then waits for Movement again' },
        { value: 'paused', label: 'Paused', icon: 'player-pause', tip: 'Nobody moves until you let them again' }] });
      const rest = c().stepper({ name: 'Rest', label: 'Rest between steps', get: () => P().rest || 0, set: (v) => set({ rest: v }), fmt: (v) => (v ? `${v} s` : 'none'),
        prev: (v) => (v <= 0 ? 0 : v <= 5 ? v - 1 : v <= 15 ? v - 5 : v - 15), next: (v) => (v < 5 ? v + 1 : v < 15 ? v + 5 : Math.min(60, v + 15)) });
      // (F4: no "Speed without a card": a player's speed is on their character card; a card without one walks 30 ft)
      // (Prototype 8) the whole group moves: movement again for everyone
      const again = Hotbar.offer(h('button', { class: 'btn', 'data-tip': 'Everyone may walk their speed again (Next round does the same)', onclick: () => act('again').then((r) => r && r.ok && toast('Movement again for everyone')) }, iconEl('refresh'), 'Movement again'), ctx.doHot('again'));
      const againRow = c().row(again);
      c().bind(() => { againRow.hidden = P().pace !== 'group' || !!P().fight; });
      const fightNote = h('p', { class: 'hint' });
      // (H4: only while a fight runs, as a state; how the pace works is behind "?")
      c().bind(() => { fightNote.hidden = !P().fight; fightNote.textContent = 'A turn order is running: only the player whose turn it is moves.'; });

      // ---- rules
      const rules = h('div', { class: 'stack' },
        c().toggle({ label: 'A trace of the steps (a fight, Movement)', get: () => P().trace !== false, set: (v) => set({ trace: v }) }),
        c().toggle({ label: 'Pings on the table', get: () => P().pings !== false, set: (v) => set({ pings: v }) }));

      // ---- the phones
      const phones = h('div', { class: 'pp-phones' });
      // UI audit VE12: the last line of a row ("may move · 20 of 30 ft · moving") changes with every step. It is written
      // into the row that is there, and its "12 s ago" counts on by itself. (The whole list was built anew with every
      // step, under the mouse; and "moving" stood there until something else changed.)
      const stateOf = (d) => {
        const ft = d.max != null ? ` · ${d.left} of ${d.max} ft` : '';
        return !d.char ? 'no character yet' : !d.token ? 'no token on this map' : d.can ? `may move${ft} · ${ago(d.lastStep)}` : `${WHY[d.why] || 'waiting'}${d.why === 'spent' ? ` (${d.max} ft)` : ''} · ${ago(d.lastStep)}`;
      };
      const paint = () => {
        const by = new Map(P().phones.map((d) => [d.id, d]));
        for (const el of phones.querySelectorAll('.pp-state')) { const d = by.get(el.dataset.id); const s = d ? stateOf(d) : ''; if (el.textContent !== s) el.textContent = s; }
      };
      let shown = false;
      const tick = setInterval(() => { if (phones.isConnected) { shown = true; paint(); } else if (shown) clearInterval(tick); }, 1000);
      c().bind(() => {
        const v = P();
        const sig = JSON.stringify([v.phones.map((d) => [d.id, d.name, d.kind, d.connected, d.char, d.color, d.carry, d.token]), v.on]);
        if (phones.dataset.sig === sig) { paint(); return; }
        phones.dataset.sig = sig;
        if (!v.phones.length) { phones.replaceChildren(h('p', { class: 'hint' }, 'No player phone yet: show the join code on the table.')); return; }
        phones.replaceChildren(h('div', { class: 'ctl-label' }, 'Phones'), ...v.phones.slice().sort((a, b) => (b.connected - a.connected) || (a.name > b.name ? 1 : -1)).map((d) => {
          // (the menus ask for the party and the tokens when they open: the row is not rebuilt for them)
          const charBtn = h('button', { class: 'btn small', 'data-tip': 'Which character this phone moves', onclick: (e) => openMenu(e.clientX, e.clientY, [
            ...P().party.map((p) => ({ icon: 'user', label: `${p.name}${p.holder && p.holderId !== d.id ? ` (on ${p.holder})` : ''}`, disabled: d.char === p.name, action: () => act('assign', { id: d.id, name: p.name }) })),
            ...(d.char ? ['-', { icon: 'user-off', label: 'No character (the party again)', action: () => act('assign', { id: d.id, name: null }) }] : []),
          ]) }, iconEl('user-edit'), d.char || 'Pick a character …');
          const handBtn = d.char ? h('button', { class: 'btn small ghost', 'data-tip': 'Any token on the table for this phone (its own again: the first item)', onclick: (e) => openMenu(e.clientX, e.clientY, [
            { icon: 'user', label: `${d.char}'s own token`, disabled: !(d.token && d.token.handed), action: () => act('hand', { id: d.id, tokenId: null }) }, '-',
            ...P().tokens.filter((t) => !t.hidden || (d.token && d.token.id === t.id)).slice(0, 40).map((t) => ({ icon: 'circle', label: `${t.name}${t.owner ? ` (${t.owner})` : ''}`, disabled: !!(d.token && d.token.id === t.id), action: () => act('hand', { id: d.id, tokenId: t.id }) })),
          ]) }, iconEl('hand-move'), d.token ? (d.token.handed ? `Moves ${d.token.name}` : 'Hand a token …') : 'Hand a token …') : null;
          const carryBtn = d.char ? h('button', { class: 'btn small ghost', 'data-tip': 'The light this token carries (its eye on a dark map)', onclick: (e) => openMenu(e.clientX, e.clientY,
            (v.carries || ['none', 'candle', 'torch', 'lantern']).map((k) => ({ icon: k === 'none' ? 'circle-off' : k === 'candle' ? 'candle' : k === 'lantern' ? 'lamp' : 'flame', label: CARRY_LABEL[k] || k, disabled: d.carry === k, action: () => act('carry', { id: d.id, carry: k }) }))) },
          iconEl(d.carry === 'none' ? 'circle-off' : d.carry === 'candle' ? 'candle' : d.carry === 'lantern' ? 'lamp' : 'flame'), CARRY_LABEL[d.carry] || 'No light') : null;
          const more = (e) => {
            e.preventDefault();
            const b = e.currentTarget.getBoundingClientRect();
            openMenu(e.clientX || b.left, e.clientY || b.bottom, [
              { icon: 'refresh', label: 'Movement again (a fresh turn, no rest)', action: () => act('reset', { id: d.id }) },
              { icon: 'user-off', label: 'Take the character away', disabled: !d.char, action: () => act('assign', { id: d.id, name: null }) },
              '-',
              { icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText('Name of the phone', d.name, { ok: 'Rename' }); if (n) dev('rename', { id: d.id, name: n }); } },
              { icon: 'trash', label: 'Forget it', danger: true, action: () => forget(d) },
            ]);
          };
          return h('div', { class: `pp-phone ${d.connected ? 'on' : ''}`, dataset: { id: d.id }, style: d.color ? `--pcc:${d.color}` : '', oncontextmenu: more },
            h('div', { class: 'pp-head' }, h('i', { class: `rm-dot ${d.connected ? 'on' : ''}` }), iconEl(d.kind === 'tablet' ? 'device-tablet' : 'device-mobile'), h('b', { class: 'grow ellipsis' }, d.name), h('small', {}, d.connected ? 'connected' : 'away'),
              h('button', { class: 'icon-btn pp-more', 'aria-label': `More for ${d.name}`, 'data-tip': 'Rename, forget …', onclick: more }, iconEl('dots'))),
            h('div', { class: 'pp-row' }, charBtn, handBtn, carryBtn),
            h('small', { class: 'pp-state', dataset: { id: d.id } }, stateOf(d)));
        }));
      });

      const hexNote = h('p', { class: 'hint warn-text' });
      c().bind(() => { hexNote.hidden = !P().hex; hexNote.textContent = 'This map has a hex grid: the phones can\'t step on it yet (square grids only).'; });

      return h('div', { class: 'stack pp' },
        onSwitch, net, hexNote,
        c().row(joinBtn),
        h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Message on the join card'), msgBox), other,
        pace, againRow, rest, fightNote,
        h('div', { class: 'pop-sep' }),
        rules,
        h('div', { class: 'pop-sep' }),
        phones);
    }
    return { buildPanel };
  }
  return { create };
})();
