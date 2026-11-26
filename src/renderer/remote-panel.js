// Toolbox → Gamemaster remote (Beta 4.1; F1: sorted by who holds the device)
//   Stream Deck   the GM's phones and tablets: one QR code, Arrange the deck … (deck-editor.js: a phone deck and a
//                 tablet deck; a device shows the one for its size, or the one chosen for it in the list); your devices
//   (the party screen, a window on a screen of this PC for the players, is gone: Glinn, 23 Nov 2026)
//   the server    starts by itself when one of these opens (main.js wakeRemote); off: Tablescape settings → This screen
//                 (Windows may ask once about the network: private networks)
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
    // P5 (open point): Forget with an Undo (it had to scan the code again)
    const forget = async (d) => { const r = await act('forget', { id: d.id }); if (r && r.ok && r.back) toast(`${r.name || 'The device'} forgotten`, { undo: () => act('unforget', { id: r.back }) }); };

    // a QR code for one of the two roles (asked for again when the address or the code changes)
    function qrCard(role, title, steps) {
      const box = h('div', { class: 'rm-qr' });
      const addr = h('div', { class: 'rm-addr' });
      const other = h('details', { class: 'rm-other' });
      const card = h('div', { class: 'rm-card' }, box, h('div', { class: 'rm-how' }, h('b', {}, title), h('ol', {}, ...steps.map((s) => h('li', {}, s))), addr));
      let sig = '';
      async function draw() {
        const v = R();
        const s = JSON.stringify([v.running, v.urls, v.keyRev]);
        if (s === sig) return;
        sig = s;
        card.hidden = !v.running;
        // (UI audit VE11: listening, but this PC is on no home network: the card says so; it was an empty frame)
        if (!v.running || !v.urls.length) { box.replaceChildren(...(v.running ? [h('p', { class: 'hint' }, 'No home network found on this computer')] : [])); addr.replaceChildren(); other.hidden = true; return; }
        const r = await window.ts.remote('qr', { role });
        if (!r || !r.ok) { box.replaceChildren(h('p', { class: 'hint' }, (r && r.error) || 'No QR code')); return; }
        const t = document.createElement('template');
        t.innerHTML = r.svg;
        box.replaceChildren(t.content.firstElementChild);
        addr.replaceChildren(iconEl('wifi'), h('span', { class: 'ellipsis' }, r.base.replace('http://', '')));
        other.hidden = v.urls.length < 2;
        other.replaceChildren(h('summary', {}, 'Doesn\'t open? Another network of this PC'),
          // (UI audit VE11: the choice is kept by Tablescape, for the players' code and the join card on the table too)
          ...v.urls.map((u) => h('button', { class: `link-btn ${u === r.base ? 'on' : ''}`, onclick: () => act('addr', { url: u }) }, u.replace('http://', ''))));
      }
      c().bind(draw);
      const fresh = h('button', { class: 'link-btn', 'data-tip': 'The old code stops working for new devices; connected ones stay', onclick: async () => { await act('newKey', { role }); sig = ''; draw(); toast('New code. Connected devices stay connected.', { ms: 3000 }); } }, 'New code');
      c().bind(() => { fresh.hidden = !R().running; });
      return h('div', { class: 'stack' }, card, other, fresh);
    }

    // F1 (open point): the phone server starts by itself when a panel with a code opens; switched off in Tablescape
    // settings → This screen, the panel says so in one line. Not listening (the network): that line too.
    function status() {
      const line = h('p', { class: 'hint warn-text rm-status' });
      c().bind(() => {
        const v = R();
        const msg = v.allowed === false ? 'Phones and tablets are switched off (Tablescape settings → This screen).' : v.on && v.error ? `Not listening: ${v.error}.` : '';
        line.hidden = !msg; line.textContent = msg;
      });
      return line;
    }
    const wake = () => { const v = R(); if (v.allowed !== false && !v.running) window.ts.remote('wake').then(() => ctx.refresh()).catch(() => {}); };
    // your devices (a deck each); the players' phones are listed in Player phones
    function deviceList() {
      const devices = h('div', { class: 'rm-devs' });
      c().bind(() => {
        const v = R();
        const list = v.devices.filter((d) => d.role !== 'player');
        const sig = JSON.stringify(list.map((d) => [d.id, d.name, d.deck, d.kind, d.connected, Math.round((Date.now() - d.seen) / 60000)]));
        if (devices.dataset.sig === sig) return;
        devices.dataset.sig = sig;
        devices.replaceChildren(...(list.length ? [h('div', { class: 'ctl-label' }, 'Your devices')] : []),
          ...list.slice().sort((a, b) => (b.connected - a.connected) || (b.seen - a.seen)).map((d) => h('div', { class: 'rm-dev', oncontextmenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [
            { icon: 'device-mobile', label: `The phone deck${!d.deck && d.kind !== 'tablet' ? ' (by its size)' : ''}`, disabled: deckOf(d) === 'phone', action: () => act('deckOf', { id: d.id, deck: 'phone' }) },
            { icon: 'device-tablet', label: `The tablet deck${!d.deck && d.kind === 'tablet' ? ' (by its size)' : ''}`, disabled: deckOf(d) === 'tablet', action: () => act('deckOf', { id: d.id, deck: 'tablet' }) },
            ...(d.deck ? [{ icon: 'refresh', label: 'By its size again', action: () => act('deckOf', { id: d.id, deck: null }) }] : []),
            '-',
            { icon: 'pencil', label: 'Rename …', action: async () => { const n = await askText('Name of the device', d.name, { ok: 'Rename' }); if (n) act('rename', { id: d.id, name: n }); } },
            { icon: 'trash', label: 'Forget it', danger: true, action: () => forget(d) },
          ]); } },
          iconEl(d.kind === 'tablet' ? 'device-tablet' : 'device-mobile'),
          h('div', { class: 'grow' }, h('b', {}, d.name), h('small', {}, `${deckOf(d) === 'tablet' ? 'Tablet' : 'Phone'} deck · ${d.connected ? 'connected' : `last seen ${ago(d.seen)}`}`)),
          h('i', { class: `rm-dot ${d.connected ? 'on' : ''}` }),
          h('button', { class: 'icon-btn', 'aria-label': `Forget ${d.name}`, 'data-tip': 'Forget it: it has to scan the code again', onclick: () => forget(d) }, iconEl('x')))));
      });
      return devices;
    }

    // ---- Gamemaster remote: your button deck and your devices
    function buildPanel() {
      wake();
      return h('div', { class: 'stack rm' },
        status(),
        c().row(c().btn('Arrange the deck …', 'pencil', () => DeckEditor.open({ state: S, refresh: ctx.refresh }), { kind: 'primary', tip: 'Presets, your own buttons or the hotbar, pages' })),
        qrCard('dm', 'Button deck', ['Phone on the same Wi-Fi as this PC.', 'Point its camera at the code, open the link.', 'Share → Add to Home Screen.']),
        deviceList());
    }

    return { buildPanel };
  }
  return { create };
})();
