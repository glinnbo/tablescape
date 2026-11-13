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
  const { h, iconEl, toast, openMenu } = UI;
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

    function buildPanel() {
      const onSwitch = c().toggle({ label: 'Players may move their tokens', get: () => P().on, set: (v) => set({ on: v }) });
      const net = h('p', { class: 'hint warn-text' });
      c().bind(() => { const r = R(); net.hidden = !!(r.on && r.running); net.textContent = r.on ? 'The Remote is not listening yet (see that panel).' : 'Switch on the Remote first: the phones connect through it.'; });

      // ---- the join code on the TV
      const joinBtn = h('button', { class: 'btn primary', 'data-tip': 'The players\' QR code big on the table for 90 seconds (again: take it off)' });
      c().bind(() => { const on = !!P().join; joinBtn.replaceChildren(iconEl(on ? 'x' : 'qrcode'), on ? 'Take the code off the table' : 'Join code on the table'); joinBtn.onclick = () => act('join', { on: !on }); joinBtn.classList.toggle('primary', !on); });

      // ---- pace
      const pace = c().seg({ label: 'Pace', get: () => (['paused', 'group'].includes(P().pace) ? P().pace : 'free'), set: (v) => set({ pace: v }), options: [
        { value: 'free', label: 'Free', icon: 'walk', tip: 'Walk as they like (a fight still waits for their turn)' },
        { value: 'group', label: 'Movement', icon: 'run', tip: 'Everyone walks their speed once, then waits for Movement again' },
        { value: 'paused', label: 'Paused', icon: 'player-pause', tip: 'Nobody moves until you let them again' }] });
      const rest = c().stepper({ name: 'Rest', label: 'Rest between steps', get: () => P().rest || 0, set: (v) => set({ rest: v }), fmt: (v) => (v ? `${v} s` : 'none'),
        prev: (v) => (v <= 0 ? 0 : v <= 5 ? v - 1 : v <= 15 ? v - 5 : v - 15), next: (v) => (v < 5 ? v + 1 : v < 15 ? v + 5 : Math.min(60, v + 15)) });
      const speed = c().stepper({ name: 'Speed', label: 'Speed without a card', get: () => P().speed || 30, set: (v) => set({ speed: v }), fmt: (v) => `${v} ft`, prev: (v) => Math.max(5, v - 5), next: (v) => Math.min(120, v + 5) });
      // (Prototype 8) the whole group moves: movement again for everyone
      const again = Hotbar.offer(h('button', { class: 'btn', 'data-tip': 'Everyone may walk their speed again (Next round does the same)', onclick: () => act('again').then((r) => r && r.ok && toast('Movement again for everyone')) }, iconEl('refresh'), 'Movement again'), ctx.doHot('again'));
      const againRow = c().row(again);
      c().bind(() => { againRow.hidden = P().pace !== 'group' || !!P().fight; });
      const fightNote = h('p', { class: 'hint' });
      c().bind(() => { fightNote.textContent = P().fight ? 'A turn order is running: only the player whose turn it is moves.' : P().pace === 'group' ? 'Everyone walks their speed once; Movement again (or Next round) hands it out anew.' : 'In a fight only the player whose turn it is moves.'; });

      // ---- rules
      const rules = h('div', { class: 'stack' },
        c().toggle({ label: 'A trace of the steps (a fight, Movement)', get: () => P().trace !== false, set: (v) => set({ trace: v }) }),
        c().toggle({ label: 'Pings on the table', get: () => P().pings !== false, set: (v) => set({ pings: v }) }),
        h('p', { class: 'hint' }, 'Sight, darkvision and light of a player token: click its name on the map.'));

      // ---- the phones
      const phones = h('div', { class: 'pp-phones' });
      c().bind(() => {
        const v = P();
        const sig = JSON.stringify([v.phones, v.party.map((x) => x.name), v.tokens.length, v.on]); // (v.phones carries the feet left)
        if (phones.dataset.sig === sig) return;
        phones.dataset.sig = sig;
        if (!v.phones.length) { phones.replaceChildren(h('p', { class: 'hint' }, 'No player phone yet: show the join code on the table, or the QR code under Remote → Player screen.')); return; }
        phones.replaceChildren(h('div', { class: 'ctl-label' }, 'Phones'), ...v.phones.slice().sort((a, b) => (b.connected - a.connected) || (a.name > b.name ? 1 : -1)).map((d) => {
          const charBtn = h('button', { class: 'btn small', 'data-tip': 'Which character this phone moves', onclick: (e) => openMenu(e.clientX, e.clientY, [
            ...v.party.map((p) => ({ icon: 'user', label: `${p.name}${p.holder && p.holder !== d.name ? ` (on ${p.holder})` : ''}`, disabled: d.char === p.name, action: () => act('assign', { id: d.id, name: p.name }) })),
            ...(d.char ? ['-', { icon: 'user-off', label: 'No character (the party screen again)', action: () => act('assign', { id: d.id, name: null }) }] : []),
          ]) }, iconEl('user-edit'), d.char || 'Pick a character …');
          const toks = v.tokens.filter((t) => !t.hidden || (d.token && d.token.id === t.id));
          const handBtn = d.char ? h('button', { class: 'btn small ghost', 'data-tip': 'Any token on the table for this phone (its own again: the first item)', onclick: (e) => openMenu(e.clientX, e.clientY, [
            { icon: 'user', label: `${d.char}'s own token`, disabled: !(d.token && d.token.handed), action: () => act('hand', { id: d.id, tokenId: null }) }, '-',
            ...toks.slice(0, 40).map((t) => ({ icon: 'circle', label: `${t.name}${t.owner ? ` (${t.owner})` : ''}`, disabled: !!(d.token && d.token.id === t.id), action: () => act('hand', { id: d.id, tokenId: t.id }) })),
          ]) }, iconEl('hand-move'), d.token ? (d.token.handed ? `Moves ${d.token.name}` : 'Hand a token …') : 'Hand a token …') : null;
          const carryBtn = d.char ? h('button', { class: 'btn small ghost', 'data-tip': 'The light this token carries (its eye on a dark map)', onclick: (e) => openMenu(e.clientX, e.clientY,
            (v.carries || ['none', 'candle', 'torch', 'lantern']).map((k) => ({ icon: k === 'none' ? 'circle-off' : k === 'candle' ? 'candle' : k === 'lantern' ? 'lamp' : 'flame', label: CARRY_LABEL[k] || k, disabled: d.carry === k, action: () => act('carry', { id: d.id, carry: k }) }))) },
          iconEl(d.carry === 'none' ? 'circle-off' : d.carry === 'candle' ? 'candle' : d.carry === 'lantern' ? 'lamp' : 'flame'), CARRY_LABEL[d.carry] || 'No light') : null;
          const ft = d.max != null ? ` · ${d.left} of ${d.max} ft` : '';
          const state = !d.char ? 'no character yet' : !d.token ? 'no token on this map' : d.can ? `may move${ft} · ${ago(d.lastStep)}` : `${WHY[d.why] || 'waiting'}${d.why === 'spent' ? ` (${d.max} ft)` : ''} · ${ago(d.lastStep)}`;
          return h('div', { class: `pp-phone ${d.connected ? 'on' : ''}`, style: d.color ? `--pcc:${d.color}` : '', oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [
            { icon: 'refresh', label: 'Movement again (a fresh turn, no rest)', action: () => act('reset', { id: d.id }) },
            { icon: 'user-off', label: 'Take the character away', disabled: !d.char, action: () => act('assign', { id: d.id, name: null }) },
          ]); } },
          h('div', { class: 'pp-head' }, h('i', { class: `rm-dot ${d.connected ? 'on' : ''}` }), iconEl(d.kind === 'tablet' ? 'device-tablet' : 'device-mobile'), h('b', { class: 'grow ellipsis' }, d.name), h('small', {}, d.connected ? 'connected' : 'away')),
          h('div', { class: 'pp-row' }, charBtn, handBtn, carryBtn),
          h('small', { class: 'pp-state' }, state));
        }));
      });

      const hexNote = h('p', { class: 'hint warn-text' });
      c().bind(() => { hexNote.hidden = !P().hex; hexNote.textContent = 'This map has a hex grid: the phones can\'t step on it yet (square grids only).'; });

      return h('div', { class: 'stack pp' },
        onSwitch, net, hexNote,
        c().row(joinBtn),
        h('p', { class: 'hint' }, 'A player scans the code, picks their character and moves its token with the stick on the phone, one square per push.'),
        pace, againRow, rest, speed, fightNote,
        h('div', { class: 'pop-sep' }),
        rules,
        h('div', { class: 'pop-sep' }),
        phones);
    }
    return { buildPanel };
  }
  return { create };
})();
