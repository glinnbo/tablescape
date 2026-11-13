// Toolbox → Phone & tablet (Beta 4.1)
//   switch        Phones and tablets can connect (Windows may ask once about the network: private networks)
//   Stream Deck   the DM's phones and tablets: one QR code, Arrange the deck … (deck-editor.js: a phone deck and a
//                 tablet deck; a device shows the one for its size, or the one chosen for it in the list)
//   Player screen a tablet for the players (its own QR code: it only shows), or Show on a screen of this PC; the
//                 pictures come from the character cards (characters.js); in the turn order (right-click an enemy) "Player screen: show name and picture"
//   devices       the ones that scanned a code: connected now or when last seen; Forget, rename (right-click)
// main: remote.js serves the page (src/remote/), main.js says what it shows and does; S().remote is the status.
'use strict';

const RemotePanel = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const deckOf = (d) => (d.deck === 'phone' || d.deck === 'tablet' ? d.deck : d.kind === 'tablet' ? 'tablet' : 'phone');
  const ago = (t) => {
    const s = Math.max(0, (Date.now() - (t || 0)) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };

  function create(ctx) {
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const R = () => S().remote || { on: false, running: false, urls: [], devices: [], presets: [] };
    const act = async (a, p) => { const r = await window.ts.remote(a, p); if (r && r.error) toast(r.error, { kind: 'error', ms: 4000 }); ctx.refresh(); return r; };
    let tab = 'deck';

    // a QR code for one of the two roles (asked for again when the address or the code changes)
    function qrCard(role, title, steps) {
      const box = h('div', { class: 'rm-qr' });
      const addr = h('div', { class: 'rm-addr' });
      const other = h('details', { class: 'rm-other' });
      const card = h('div', { class: 'rm-card' }, box, h('div', { class: 'rm-how' }, h('b', {}, title), h('ol', {}, ...steps.map((s) => h('li', {}, s))), addr));
      let sig = ''; let pick = null;
      async function draw() {
        const v = R();
        const s = JSON.stringify([v.running, v.urls, v.keyRev, pick]);
        if (s === sig) return;
        sig = s;
        card.hidden = !v.running;
        if (!v.running || !v.urls.length) { box.replaceChildren(); addr.replaceChildren(); other.hidden = true; return; }
        const r = await window.ts.remote('qr', { url: pick, role });
        if (!r || !r.ok) { box.replaceChildren(h('p', { class: 'hint' }, (r && r.error) || 'No QR code')); return; }
        const t = document.createElement('template');
        t.innerHTML = r.svg;
        box.replaceChildren(t.content.firstElementChild);
        addr.replaceChildren(iconEl('wifi'), h('span', { class: 'ellipsis' }, r.base.replace('http://', '')));
        other.hidden = v.urls.length < 2;
        other.replaceChildren(h('summary', {}, 'Doesn\'t open? Another network of this PC'),
          ...v.urls.map((u) => h('button', { class: `link-btn ${u === r.base ? 'on' : ''}`, onclick: () => { pick = u; draw(); } }, u.replace('http://', ''))));
      }
      c().bind(draw);
      const fresh = h('button', { class: 'link-btn', 'data-tip': 'The old code stops working for new devices; connected ones stay', onclick: async () => { await act('newKey', { role }); sig = ''; draw(); toast('New code. Connected devices stay connected.', { ms: 3000 }); } }, 'New code');
      c().bind(() => { fresh.hidden = !R().running; });
      return h('div', { class: 'stack' }, card, other, fresh);
    }

    function buildPanel() {
      const onSwitch = c().toggle({ label: 'Phones and tablets can connect', get: () => R().on, set: (v) => act('set', { on: v }) });
      const err = h('p', { class: 'hint warn-text' });
      c().bind(() => { const v = R(); err.hidden = !(v.on && v.error); err.textContent = v.error ? `Not listening: ${v.error}.` : ''; });

      // the two parts
      const tabs = h('div', { class: 'seg rm-tabs', role: 'tablist' });
      const deckPart = h('div', { class: 'stack' });
      const playerPart = h('div', { class: 'stack' });
      function drawTabs() {
        tabs.replaceChildren(...[['deck', 'Button deck', 'layout-grid'], ['players', 'Player screen', 'users']].map(([id, label, icn]) => h('button', { class: `seg-btn ${tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; drawTabs(); } }, iconEl(icn), h('span', {}, label))));
        deckPart.hidden = tab !== 'deck'; playerPart.hidden = tab !== 'players';
      }

      // ---- Stream Deck (the DM's phone)
      deckPart.append( // 4.3.2: (the summary of both decks is gone: Arrange the deck shows them)
        c().row(c().btn('Arrange the deck …', 'pencil', () => DeckEditor.open({ state: S, refresh: ctx.refresh }), { kind: 'primary', tip: 'Presets, your own buttons or the hotbar, pages' })),
        qrCard('dm', 'Button deck', ['Phone on the same Wi-Fi as this PC.', 'Point its camera at the code, open the link.', 'Share → Add to Home Screen.']));

      // ---- Player screen
      const pick = h('select', { 'aria-label': 'Screen for the player screen' });
      const screenBtn = h('button', { class: 'btn small' });
      c().bind(() => {
        const ds = (S().view && S().view.displays) || [];
        const opts = ds.map((d) => `<option value="${d.id}">${UI.esc(d.name)}</option>`).join('');
        if (pick.dataset.opts !== opts) { pick.innerHTML = opts; pick.dataset.opts = opts; const want = R().screenId; if (want && ds.some((d) => d.id === want)) pick.value = String(want); else if (ds.length > 1) pick.value = String(ds[ds.length - 1].id); }
        const open = !!R().screenOpen;
        screenBtn.replaceChildren(iconEl(open ? 'x' : 'screen-share'), open ? 'Close it' : 'Show it');
        screenBtn.classList.toggle('primary', !open);
        screenBtn.onclick = () => (open ? act('screen.close') : act('screen.open', { displayId: Number(pick.value) }));
      });
      playerPart.append(
        h('div', { class: 'rm-deck' }, iconEl('users'), h('div', { class: 'grow' }, h('b', {}, 'For the players'), h('p', { class: 'hint' }, 'The party; in a fight the turn order. Enemies show as "??" until you right-click them in the turn order.'))),
        h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'On a screen of this PC (Esc on it closes it)'), h('div', { class: 'ctl-row' }, pick, screenBtn)),
        c().row(c().btn('Character cards …', 'id-badge-2', () => Characters.openEditor({ state: S }), { kind: 'small', tip: 'Each player\'s picture and colour (and the rest of the card)' })),
        qrCard('player', 'On a tablet', ['Tablet on the same Wi-Fi as this PC.', 'Point its camera at this code (not the DM\'s).', 'Share → Add to Home Screen.']));

      // ---- devices
      const devices = h('div', { class: 'rm-devs' });
      c().bind(() => {
        const v = R();
        const sig = JSON.stringify([v.devices.map((d) => [d.id, d.name, d.role, d.deck, d.kind, d.connected, Math.round((Date.now() - d.seen) / 60000)]), v.screenLive]);
        if (devices.dataset.sig === sig) return;
        devices.dataset.sig = sig;
        devices.replaceChildren(...(v.devices.length ? [h('div', { class: 'ctl-label' }, 'Devices')] : []),
          ...v.devices.slice().sort((a, b) => (b.connected - a.connected) || (b.seen - a.seen)).map((d) => h('div', { class: 'rm-dev', oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [
            ...(d.role === 'player' ? [] : [
              { icon: 'device-mobile', label: `The phone deck${!d.deck && d.kind !== 'tablet' ? ' (by its size)' : ''}`, disabled: deckOf(d) === 'phone', action: () => act('deckOf', { id: d.id, deck: 'phone' }) },
              { icon: 'device-tablet', label: `The tablet deck${!d.deck && d.kind === 'tablet' ? ' (by its size)' : ''}`, disabled: deckOf(d) === 'tablet', action: () => act('deckOf', { id: d.id, deck: 'tablet' }) },
              ...(d.deck ? [{ icon: 'refresh', label: 'By its size again', action: () => act('deckOf', { id: d.id, deck: null }) }] : []),
              '-']),
            { icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText('Name of the device', d.name, { ok: 'Rename' }); if (n) act('rename', { id: d.id, name: n }); } },
            { icon: 'trash', label: 'Forget it', danger: true, action: () => act('forget', { id: d.id }) },
          ]); } },
          iconEl(d.kind === 'tablet' ? 'device-tablet' : 'device-mobile'),
          h('div', { class: 'grow' }, h('b', {}, d.name), h('small', {}, `${d.role === 'player' ? 'Player screen' : `${deckOf(d) === 'tablet' ? 'Tablet' : 'Phone'} deck`} · ${d.connected ? 'connected' : `last seen ${ago(d.seen)}`}`)),
          h('i', { class: `rm-dot ${d.connected ? 'on' : ''}` }),
          h('button', { class: 'icon-btn', 'aria-label': `Forget ${d.name}`, 'data-tip': 'Forget it: it has to scan the code again', onclick: () => act('forget', { id: d.id }) }, iconEl('x')))));
      });
      drawTabs();
      return h('div', { class: 'stack rm' },
        onSwitch, err, tabs, deckPart, playerPart, devices);
    }

    return { buildPanel };
  }
  return { create };
})();
