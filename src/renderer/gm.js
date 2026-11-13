// Window bootstrap. The same page runs as the GM window or the table window.
'use strict';

const App = (() => {
  const { h, iconEl, $, round } = UI;
  const ts = window.ts;
  let S = null;
  let setupEl = null;
  let setupRefs = [];

  async function start() {
    await ts.init();
    if (ts.role === 'table') { const b = document.getElementById('boot'); if (b) b.remove(); Table.start(); return; }
    document.body.classList.add('gm');
    const root = document.getElementById('gm-root');
    root.hidden = false;
    UI.mount(document.getElementById('toasts'));
    Home.mount(document.getElementById('home'));
    Play.mount(document.getElementById('play'));
    ts.onGmState(apply);
    // Beta 1: notes from the main process (a window loaded again, a save that failed, the TV back) on any screen
    ts.onEvent((e) => { if (e && e.kind === 'toast' && e.text) UI.toast(e.text, { kind: e.level === 'error' ? 'error' : undefined, ms: e.ms || 7000 }); });
    SceneView.onResync = apply;
    TransferUI.start(); // 4.6: export and import, a .tablescape file opened with Tablescape
    AnimPill.start(); AnimBaker.start(); // 2.3: animated assets baked in the background, the maid shows it
    apply(await ts.state());
    const boot = document.getElementById('boot');
    if (boot) { boot.classList.add('gone'); setTimeout(() => boot.remove(), 400); }
    // Prototype 21: just updated: What's new opens once
    ts.app('whatsnew').then((r) => { if (r && r.show) updateDone(); }).catch(() => {});
    window.__tsReady = true; // used by the self-test
  }

  function apply(s) {
    const prevScreen = S && S.screen;
    S = s;
    document.body.dataset.screen = s.screen;
    document.getElementById('home').hidden = s.screen !== 'home' && s.screen !== 'campaign';
    document.getElementById('play').hidden = s.screen !== 'play';
    Play.setActive(s.screen === 'play');
    if (s.screen === 'home') { Home.show(prevScreen !== 'home'); }
    else if (s.screen === 'campaign') Home.page(s, prevScreen !== 'campaign');
    else Play.update(s);
    for (const f of setupRefs) f();
    renderUpdate(s.update);
  }

  // Prototype 21: updates, next to the version on the start screen and a campaign's page (nothing on the maps: there
  // you prepare or run a session). Check for updates; the maid runs along while it downloads; ready: Restart now
  // (the Windows installer shows its progress, then Tablescape opens again) or it installs when Tablescape closes.
  let updEl = null; let updManualAt = 0; let updTimer = 0; let lastU = null;
  function renderUpdate(u) {
    if (u !== undefined) lastU = u;
    u = lastU;
    const slot = document.querySelector('#home .upd-slot');
    if (!slot || !u || u.status === 'off') { if (updEl) updEl.remove(); return; }
    if (!updEl) updEl = h('span', { class: 'upd', role: 'status' });
    const el = updEl;
    if (el.parentNode !== slot) slot.append(el);
    const st = u.status;
    const okNow = st === 'latest' && Date.now() - updManualAt < 5000;
    const sig = JSON.stringify([st, u.version, u.percent, okNow, u.error, !!u.quiet, !!u.later, !!u.notes]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.className = `upd upd-${st}`;
    const check = () => {
      updManualAt = Date.now();
      ts.app('update.check').then((r) => { if (r && !r.ok && r.error) UI.toast(r.error, { kind: 'error' }); });
      clearTimeout(updTimer); updTimer = setTimeout(() => { if (updEl) updEl.dataset.sig = ''; renderUpdate(); }, 5200);
    };
    const maid = (src, cls = '') => h('img', { class: `upd-maid ${cls}`, src, alt: '' });
    if (st === 'checking') { el.replaceChildren(h('span', { class: 'upd-state busy' }, iconEl('refresh'), 'Looking …')); return; }
    if (okNow) { el.replaceChildren(h('span', { class: 'upd-state ok' }, iconEl('check'), 'Up to date')); return; }
    if (st === 'downloading') {
      const k = Math.min(1, Math.max(0, (u.percent || 0) / 100));
      const track = h('span', { class: 'anim-track upd-track', style: `--k:${k.toFixed(3)}` }, h('span', { class: 'anim-fill' }), maid('maid-run.webp', 'anim-maid'));
      el.replaceChildren(track, h('span', { class: 'upd-text' }, h('b', {}, u.label || u.version), ` · ${u.percent || 0} %`));
      return;
    }
    const name = h('b', {}, u.label || u.version);
    const notes = u.notes ? h('button', { class: 'icon-btn', 'aria-label': 'What\'s new', 'data-tip': `What's new in ${u.label || u.version}`, onclick: () => updNotes(u) }, iconEl('sparkles')) : '';
    // Prototype 26: a new version asks first; "Not now" leaves a quiet button
    if (st === 'available') {
      const get = async () => { const r = await ts.app('update.download'); if (!r || !r.ok) UI.toast('The update could not be started', { kind: 'error' }); };
      if (u.quiet) { el.replaceChildren(h('button', { class: 'btn small ghost upd-btn', 'data-tip': 'Download and install it', onclick: get }, iconEl('download'), `${u.label || u.version} available`), notes); return; }
      el.replaceChildren(maid('maid.webp'), h('span', { class: 'upd-text' }, name, ' is available. Install now?'),
        h('button', { class: 'btn small primary', onclick: get }, 'Yes'),
        h('button', { class: 'btn small ghost', onclick: () => ts.app('update.later') }, 'Not now'), notes);
      return;
    }
    if (st === 'ready') {
      const restart = async () => { const r = await ts.app('update.install'); if (!r || !r.ok) UI.toast('The update is not ready yet', { kind: 'error' }); };
      const tip = 'Installs the update and opens Tablescape again';
      if (u.later) {
        el.replaceChildren(maid('maid.webp'), h('span', { class: 'upd-text' }, name, ' installs when you close Tablescape'),
          h('button', { class: 'btn small ghost', 'data-tip': tip, onclick: restart }, iconEl('refresh'), 'Restart now'), notes);
        return;
      }
      el.replaceChildren(h('span', { class: 'upd-cheer' }, maid('maid-success.webp')), h('span', { class: 'upd-text' }, name, ' is ready. Restart now?'),
        h('button', { class: 'btn small primary', 'data-tip': tip, onclick: restart }, iconEl('refresh'), 'Restart now'),
        h('button', { class: 'btn small ghost', 'data-tip': 'It installs when you close Tablescape', onclick: () => ts.app('update.later') }, 'Later'), notes);
      return;
    }
    if (st === 'error') {
      el.replaceChildren(maid('maid-worried.webp', 'worried'), h('span', { class: 'upd-text', 'data-tip': u.error || '' }, 'Couldn\'t check for updates'),
        h('button', { class: 'btn small ghost', onclick: check }, 'Try again'));
      return;
    }
    el.replaceChildren(h('button', { class: 'btn small ghost upd-btn', 'data-tip': 'Look for a new version of Tablescape', onclick: check }, iconEl('refresh'), 'Check for updates'));
  }
  // the first start after an update: the maid gives a thumbs up; the changelog if you like
  function updateDone() {
    const label = (S && S.update && S.update.currentLabel) || '';
    let dlg = null;
    const body = h('div', { class: 'upd-done' },
      h('img', { class: 'upd-done-maid', src: 'maid-success.webp', alt: '' }),
      h('div', { class: 'upd-done-txt' },
        h('h2', {}, 'Update successful'),
        h('p', {}, label ? `Tablescape is now on ${label}.` : 'Tablescape is up to date.'),
        h('p', { class: 'upd-done-q' }, 'Look at what\'s new?'),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => dlg.close() }, 'No'),
          h('button', { class: 'btn primary', onclick: () => { dlg.close(); Guide.open('news'); } }, iconEl('sparkles'), 'Yes, show me'))));
    dlg = UI.dialog('', body);
    dlg.el.classList.add('upd-done-dlg');
  }
  // the new version's notes (its What's new), before restarting
  function updNotes(u) {
    const lines = String(u.notes || '').replace(/<[^>]+>/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean);
    const items = lines.filter((x) => /^[-*•]/.test(x)).map((x) => x.replace(/^[-*•]\s*/, ''));
    UI.dialog(`What's new in ${u.label || u.version}`, h('div', { class: 'stack upd-notes' },
      items.length ? h('ul', {}, ...items.map((x) => h('li', {}, x))) : h('p', {}, lines.join(' '))));
  }

  // ---------------------------------------------------------------------
  // The TV's own settings: shown in Options (on the start screen and on the maps)
  // ---------------------------------------------------------------------
  // parts: 'screen' (TV, open, size, calibration, blackout) or 'hud' (TV text and panels): Options → TV and → Players
  function tablePanel(getS, bind, part = 'all') {
    const st = () => getS();
    const select = h('select', { 'aria-label': 'TV or projector', onchange: (e) => ts.settings({ playerDisplayId: Number(e.target.value) }) });
    bind(() => {
      const v = st().view;
      const opts = v.displays.map((d) => `<option value="${d.id}">${UI.esc(d.name)}</option>`).join('');
      if (select.dataset.opts !== opts) { select.innerHTML = opts; select.dataset.opts = opts; }
      select.value = String(v.playerDisplayId);
    });
    const openBtn = h('button', { class: 'btn wide', onclick: () => ts.cmd('table.toggle') });
    bind(() => {
      const open = st().table.open;
      openBtn.innerHTML = '';
      openBtn.classList.toggle('primary', !open);
      openBtn.append(iconEl('device-tv'), open ? 'Close table window' : 'Open table window');
    });
    const oneScreen = h('p', { class: 'hint warn-text' }, 'Only one screen is connected. The table opens as a normal window so you can try things out.');
    bind(() => { oneScreen.hidden = !st().view.windowed; });

    const diag = h('input', { type: 'number', min: 10, max: 300, step: 0.5, 'aria-label': 'Screen diagonal in inches', onchange: (e) => ts.settings({ diagonal: Number(e.target.value) }) });
    bind(() => { if (document.activeElement !== diag) diag.value = st().view.diagonal; });
    const sizeInfo = h('p', { class: 'hint' });
    bind(() => {
      const v = st().view;
      sizeInfo.textContent = `${v.calibrated ? 'Calibrated' : 'From the diagonal'}: one inch is ${round(v.ppi, 1)} pixels. The table is ${round(v.inches.w, 1)} × ${round(v.inches.h, 1)} inches.`;
    });

    // calibration
    const calBox = h('div', { class: 'calib-box stack' });
    bind(() => {
      const on = st().table.calibrating;
      if (calBox.dataset.on === String(on)) return;
      calBox.dataset.on = String(on);
      calBox.innerHTML = '';
      if (!on) {
        calBox.append(h('button', { class: 'btn wide', onclick: () => ts.cmd('table.calibrate', { on: true }) }, iconEl('credit-card'), 'Calibrate with a bank card'));
        return;
      }
      const ppiNow = () => st().view.ppi;
      const nudge = (f) => ts.settings({ ppi: ppiNow() * f });
      const sl = h('input', { type: 'range', min: 10, max: 250, step: 0.05, 'aria-label': 'Pixels per inch' });
      sl.addEventListener('input', () => ts.settings({ ppi: Number(sl.value) }));
      setupRefs.push(() => { if (document.activeElement !== sl) sl.value = ppiNow(); });
      bind(() => { if (document.activeElement !== sl) sl.value = ppiNow(); });
      calBox.append(
        h('p', { class: 'hint' }, 'Hold any bank or ID card flat against the TV. Make the frame on the TV exactly as big as the card.'),
        h('div', { class: 'ctl-row' },
          h('button', { class: 'icon-btn big', 'aria-label': 'Frame smaller', 'data-tip': 'Smaller', onclick: () => nudge(1 / 1.004) }, iconEl('minus')),
          sl,
          h('button', { class: 'icon-btn big', 'aria-label': 'Frame bigger', 'data-tip': 'Bigger', onclick: () => nudge(1.004) }, iconEl('plus'))),
        h('div', { class: 'ctl-row' },
          h('button', { class: 'btn primary', onclick: () => ts.cmd('table.calibrate', { on: false }) }, iconEl('check'), 'Done'),
          h('button', { class: 'btn ghost', onclick: () => ts.settings({ ppi: null }) }, 'Use the diagonal instead')));
    });

    // size of the text and panels on the TV (round, countdowns, turn order, markers); the map keeps its real size
    const hudOut = h('output');
    const hud = h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, 'aria-label': 'TV text and panels' });
    let hudT = 0;
    hud.addEventListener('input', () => {
      hudOut.textContent = `${Math.round(Number(hud.value) * 100)}%`;
      clearTimeout(hudT);
      hudT = setTimeout(() => ts.settings({ hudScale: Number(hud.value) }), 60);
    });
    bind(() => {
      const v = (st().settings && st().settings.hudScale) || 1;
      if (document.activeElement !== hud) hud.value = v;
      hudOut.textContent = `${Math.round(Number(hud.value) * 100)}%`;
    });
    const hudBox = h('div', { class: 'stack' },
      h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, 'TV text and panels'), hud, hudOut));

    const black = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => ts.cmd('table.blackout', { on: e.target.checked }) });
    bind(() => { black.checked = !!st().table.blackout; black.disabled = !st().table.open; });
    const blackBox = [h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, 'Blackout'), black, h('span', { class: 'switch' }))];

    const screen = [h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'TV or projector'), select), oneScreen, openBtn, h('div', { class: 'pop-sep' }),
      h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Screen diagonal in inches'), diag), calBox, sizeInfo];
    if (part === 'screen') return h('div', { class: 'stack' }, ...screen, h('div', { class: 'pop-sep' }), ...blackBox);
    if (part === 'hud') return hudBox;
    return h('div', { class: 'stack' }, ...screen, h('div', { class: 'pop-sep' }), ...blackBox);
  }
  // Beta 1: where the library is, and moving it (everything is copied, then the old folder is removed and the app starts again)
  function libraryBox(bind) {
    const pathEl = h('code', { class: 'lib-path' });
    bind(() => { const r = S && S.view && S.view.libraryRoot; if (pathEl.textContent !== (r || '')) pathEl.textContent = r || ''; });
    const move = h('button', { class: 'btn small', onclick: async () => {
      const r = await ts.app('library.move');
      if (!r || r.canceled) return;
      if (!r.ok) { UI.toast(r.error || 'That did not work.', { kind: 'error' }); return; }
    } }, iconEl('folder'), 'Move the library…');
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Your library (maps, tokens, sounds, campaigns)'),
      h('div', { class: 'ctl-row' }, pathEl, h('button', { class: 'btn small ghost', onclick: () => ts.library('open') }, 'Open')),
      h('div', { class: 'ctl-row' }, move));
  }

  // small controls for Options (the play screen has its own set; these work on the start screen too)
  function segCtl(bind, o) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': o.label || '' });
    for (const opt of o.options) {
      wrap.append(h('button', { class: 'seg-btn', role: 'radio', dataset: { v: String(opt.value) }, 'data-tip': opt.tip || null, 'aria-label': opt.label, onclick: () => o.set(opt.value) },
        opt.icon ? iconEl(opt.icon) : null, h('span', {}, opt.label)));
    }
    bind(() => { const v = String(o.get()); for (const b of wrap.children) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); } });
    return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, o.label), wrap);
  }
  function sliderCtl(bind, o) {
    const out = h('output');
    const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 0.01, 'aria-label': o.label });
    input.addEventListener('input', () => { const v = Number(input.value); out.textContent = o.fmt(v); o.set(v); });
    bind(() => { const v = o.get(); if (v == null) return; if (document.activeElement !== input) input.value = v; out.textContent = o.fmt(Number(input.value)); });
    return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-label' }, o.icon ? iconEl(o.icon) : null, o.label), input, out);
  }
  function toggleCtl(bind, o) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => o.set(input.checked));
    bind(() => { input.checked = !!o.get(); });
    return h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-label' }, o.label), input, h('span', { class: 'switch' }));
  }

  // Options → Picture: brightness, contrast, gamma, saturation, warmth and black level for this TV
  const PIC_DEF = { brightness: 1, contrast: 1, gamma: 1, saturation: 1, warmth: 0, black: 0 };
  function picturePanel(getS, bind) {
    const st = () => getS();
    const pic = () => ({ ...PIC_DEF, ...((st().settings && st().settings.picture) || {}) });
    const key = () => st().view.tvKey;
    // at most one change a frame while dragging
    let q = null;
    const set = (k, v) => {
      if (q) { q[k] = v; return; }
      q = { [k]: v };
      requestAnimationFrame(() => { const p = q; q = null; ts.settings({ picture: { key: key(), ...p } }); });
    };
    const pct = (v) => `${Math.round(v * 100)}%`;
    const tvName = h('p', { class: 'hint' });
    bind(() => {
      const v = st().view;
      const d = v.displays.find((x) => x.id === v.playerDisplayId);
      tvName.textContent = v.windowed ? 'For the table window on this screen.' : `For ${d ? d.name.replace(/ – this screen$/, '') : 'this TV'}.`;
    });
    // 4.3.1: the reference picture (real maps) to set it by; the test pattern is gone
    const test = toggleCtl(bind, { label: 'Reference picture on the TV', get: () => !!st().testPicture, set: (v) => ts.cmd('table.test', { on: v, kind: 'reference' }) });
    return h('div', { class: 'stack pic-panel' },
      tvName,
      sliderCtl(bind, { label: 'Brightness', icon: 'sun', min: 0.5, max: 1.6, step: 0.01, get: () => pic().brightness, set: (v) => set('brightness', v), fmt: pct }),
      sliderCtl(bind, { label: 'Contrast', icon: 'contrast', min: 0.5, max: 1.6, step: 0.01, get: () => pic().contrast, set: (v) => set('contrast', v), fmt: pct }),
      sliderCtl(bind, { label: 'Gamma', icon: 'circle-half-2', min: 0.5, max: 2, step: 0.01, get: () => pic().gamma, set: (v) => set('gamma', v), fmt: (v) => v.toFixed(2) }),
      sliderCtl(bind, { label: 'Saturation', icon: 'color-filter', min: 0, max: 2, step: 0.01, get: () => pic().saturation, set: (v) => set('saturation', v), fmt: pct }),
      sliderCtl(bind, { label: 'Warmth', icon: 'temperature', min: -1, max: 1, step: 0.01, get: () => pic().warmth, set: (v) => set('warmth', v), fmt: (v) => (Math.abs(v) < 0.02 ? 'Neutral' : `${v > 0 ? 'Warm' : 'Cool'} ${Math.round(Math.abs(v) * 100)}%`) }),
      sliderCtl(bind, { label: 'Black level', icon: 'adjustments', min: -0.15, max: 0.15, step: 0.005, get: () => pic().black, set: (v) => set('black', v), fmt: (v) => (Math.abs(v) < 0.003 ? '0' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}`) }),
      test,
      h('div', { class: 'ctl-row' }, h('button', { class: 'btn', onclick: () => ts.settings({ picture: { key: key(), reset: true } }) }, iconEl('restore'), 'Reset')));
  }

  // 4.3: Options: what is set once and then stays, in one window with its sections down the side.
  // (It was the Table menu; the map tools now keep only what the map needs.)
  const OPT_SECTIONS = [
    { id: 'tv', label: 'TV', icon: 'device-tv',
      tips: ['Black bars flickering on the TV over an animated map: Video on the TV → Drawn with the picture (or Safest), then restart.', 'Calibrate: match the frame on the TV to a bank card; then one inch on the TV is one inch.', 'Without calibrating, the size comes from the screen diagonal.',
        'Press Esc on the TV to close the table window.', 'B switches the blackout on or off anywhere.'] },
    { id: 'picture', label: 'Picture', icon: 'brightness',
      tips: ['Each TV keeps its own picture.', 'Set the TV itself to its most natural mode (Movie or Cinema) first.', 'Gamma above 1 lifts the dark middle tones without washing out black.',
        'Reference picture: the black box should be black, not grey, and the white one white without glaring.'] },
    { id: 'players', label: 'Seating', icon: 'users',
      tips: ['Both long sides: everything with text shows twice, once facing each side.', 'TV text scales the round, countdowns, turn order, markers and spell badges; the map keeps its size.'] },
    { id: 'looks', label: 'Looks', icon: 'sparkles',
      tips: ['One style for everything the players see; any part can have its own.', 'Try on the table plays the look over the map that is there; nothing changes.', 'What the turn order shows and where the round sits: Options → Initiative.'] },
    { id: 'init', label: 'Initiative', icon: 'swords',
      tips: ['Hidden from the table, the turn order still runs for you, and the phones still wait for their turn.', 'Players see the round (next to the round counter) still hides it for one fight.', 'How the turn order and the banner look: Options → Looks.'] },
    { id: 'tokens', label: 'Tokens', icon: 'user-circle',
      tips: ['A token keeps its squares; only its picture is drawn bigger.',
        'One token with a picture that has a wide margin: select it → its size (M) → Bigger or Smaller.', 'Snapping off: Alt snaps a token while you drag it. Snapping on: Alt lets it go anywhere.',
        'Compact toolbar: it gets clear when the mouse is on it.'] },
    { id: 'sound', label: 'Sound', icon: 'volume',
      tips: ['A speaker that is not connected (the TV switched off) falls back to the system\'s default.', 'Effects: soundboard, spell sounds, thunder, the countdown.',
        'Mute (under the table preview) fades all table sound out and back in.'] },
    { id: 'perf', label: 'Performance', icon: 'gauge',
      tips: ['Medium: fewer particles. Low: also 30 frames a second on the TV, and video maps stand still on your screen (the TV still plays them).', 'The frames per second show under the table preview.',
        'Animated assets are prepared once (the little maid runs at the top meanwhile); after that many animations stay smooth.', 'An animated asset that should be sharp whatever it costs: select it → the film button (Sharp video).', 'The benchmark measures the map on the TV as it is now: run it again after a change to see what it did.'] },
    { id: 'screen', label: 'This screen', icon: 'device-desktop',
      tips: ['Ctrl + and Ctrl − change the size anywhere, Ctrl 0 goes back to 100%. The TV stays as it is.', 'Hotbar: a row, two rows or a column. Right-click the hotbar for the same.', 'Drag the hotbar by its grip to put it anywhere; a double-click on the grip puts it back.'] },
    { id: 'library', label: 'Library', icon: 'folder',
      tips: ['Moving copies everything to the new place (another disk, say), then Tablescape starts again from there.', 'A folder synced to the cloud works, but files can be busy for a moment while it syncs.'] },
  ];
  const pct = (v) => `${Math.round(v * 100)}%`;
  const optHead = (t) => h('h3', { class: 'opt-h' }, t);
  const set = () => (S && S.settings) || {};
  function optSection(id, bind) {
    const st = () => S;
    if (id === 'picture') return picturePanel(st, bind);
    if (id === 'players') {
      return h('div', { class: 'stack' },
        segCtl(bind, { label: 'Players sit on', options: [{ value: 'both', label: 'Both long sides', tip: 'Everything with text shows twice, once facing each side' }, { value: 'one', label: 'One side' }],
          get: () => set().seats || 'both', set: (v) => ts.settings({ seats: v }) }),
        tablePanel(st, bind, 'hud'));
    }
    // Prototype 7: one style for the table (four looks, each with a variant in other colours); any part may have its own
    if (id === 'looks') {
      const STYLES = [
        { id: 'ink', label: 'Ink', sw: ['#050505', '#3a3a40'], tip: 'Black ink splashes in and drips away' },
        { id: 'blood', label: 'Blood', sw: ['#2a0306', '#a3161c'], tip: 'Ink, but dark red' },
        { id: 'smoke', label: 'Smoke', sw: ['#2a2c32', '#9a9da4'], tip: 'Grey smoke rolls in and clears' },
        { id: 'arcane', label: 'Purple smoke', sw: ['#220f3a', '#8a4fd6'], tip: 'Smoke, but violet' },
        { id: 'parchment', label: 'Parchment', sw: ['#e3cfa3', '#8a6a3a'], tip: 'A sheet unrolls and rolls away' },
        { id: 'old', label: 'Dirty parchment', sw: ['#9a8052', '#33210d'], tip: 'Parchment, but old, dark and stained' },
        { id: 'embers', label: 'Embers', sw: ['#1e0e08', '#ff8a2a'], tip: 'Burns away, sparks and firelight' },
        { id: 'witchfire', label: 'Witchfire', sw: ['#07111e', '#46a8ff'], tip: 'Embers, but cold blue fire' },
        // Prototype 9: the regions, with pictures (looks/)
        { id: 'stone', label: 'Stone', pic: 'stone', tip: 'Mountains and caves: rock slabs grind in and meet in dust' },
        { id: 'ice', label: 'Ice', pic: 'ice', tip: 'Stone, but frozen: ice slabs and frosted boulders' },
        { id: 'meadow', label: 'Meadow', pic: 'grass', fx: 'hue-rotate(38deg) saturate(0.9)', bg: '#1d2611', tip: 'Open fields: tall grass grows in, the wind carries leaves' },
        { id: 'autumn', label: 'Autumn', pic: 'grass', fx: 'saturate(1.3)', bg: '#22140a', tip: 'Meadow, but dry and orange' },
        { id: 'city', label: 'City', pic: 'cloth', crest: true, tip: 'Towns and castles: banners with a crest slide in' },
        { id: 'slums', label: 'Slums', pic: 'planks', tip: 'City, but rough planks and grime' },
        // Prototype 10
        { id: 'winter', label: 'Winter', pic: 'snowbank', bg: '#0e1622', tip: 'Snow and mist roll in, snowflakes fall' },
        { id: 'christmas', label: 'Christmas', pic: 'garland', bg: '#1f2a40', tip: 'Winter at night, with a garland and warm lights in the snow' },
        { id: 'sand', label: 'Sand', pic: 'dune', bg: '#2a1c0c', tip: 'Deserts: a sandstorm sweeps across the table' },
        { id: 'ash', label: 'Ash', pic: 'ashheap', bg: '#0c0a09', tip: 'Sand, but grey ash falling and embers: volcanoes, burnt land' },
        // Prototype 27
        { id: 'dungeon', label: 'Deep dungeon', pic: 'iron', tip: 'Prisons and vaults: iron gates slam shut over the table, sparks and dust' },
        { id: 'necro', label: 'Necrotic', pic: 'bones', bg: '#0c160e', tip: 'Crypts and the undead: green mist creeps in over bones, souls rise' },
        { id: 'bloodcrypt', label: 'Blood crypt', pic: 'bones', fx: 'hue-rotate(225deg) saturate(1.3)', bg: '#170b0b', tip: 'Necrotic, but red: for something more evil' },
        { id: 'forest', label: 'Forest', pic: 'forestfloor', bg: '#0f190d', tip: 'Woods: spruce and beech branches close over the table, needles and leaves fall' },
        { id: 'jungle', label: 'Jungle', pic: 'jfloor', bg: '#0b180f', tip: 'Forest, but tropical: big leaves and lianas, petals and fireflies' }];
      const nameOf = (k) => (k === 'fade' ? 'Crossfade' : (STYLES.find((x) => x.id === k) || STYLES[0]).label);
      const styleNow = () => set().tableStyle || 'ink';
      const partNow = (part) => (set().looks && set().looks[part]) || 'style';
      const tryBtn = (what) => h('button', { class: 'btn small ghost try-look', 'data-tip': 'Plays it on the table over the map that is there; nothing changes',
        onclick: async () => { const r = await ts.cmd('look.try', { what }); if (r && r.why === 'no-tv') UI.toast('Open the table on the TV first'); } }, iconEl('player-play'), 'Try');
      const grid = h('div', { class: 'style-grid', role: 'radiogroup', 'aria-label': 'Table style' }, ...STYLES.map((x) => h('button', { class: 'style-card', role: 'radio', dataset: { v: x.id }, 'data-tip': x.tip, onclick: () => ts.settings({ tableStyle: x.id }) },
        x.pic ? h('i', { class: 'sc-sw', style: `background:${x.crest ? 'url(looks/crest.webp) center / auto 80% no-repeat, ' : ''}url(looks/${x.pic}.webp) ${['grass', 'snowbank', 'dune', 'ashheap', 'garland', 'bones', 'forestfloor', 'jfloor'].includes(x.pic) ? 'center bottom / auto 150%' : 'center / 160%'} ${x.bg || ''};${x.fx ? `filter:${x.fx}` : ''}` })
          : h('i', { class: 'sc-sw', style: `background:linear-gradient(135deg, ${x.sw[0]} 0 55%, ${x.sw[1]} 55% 100%)` }), h('span', {}, x.label))));
      bind(() => { const v = styleNow(); for (const b of grid.children) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); } });
      const part = (key, label, tip) => {
        const btn = h('button', { class: 'btn small part-pick', 'data-tip': tip, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); UI.openMenu(r.left, r.bottom + 4, [
          { icon: 'sparkles', label: `Table style (${nameOf(styleNow())})`, checked: partNow(key) === 'style', action: () => ts.settings({ looks: { [key]: 'style' } }) }, '-',
          ...STYLES.map((x) => ({ icon: partNow(key) === x.id ? 'circle-check' : 'circle', label: x.label, checked: partNow(key) === x.id, action: () => ts.settings({ looks: { [key]: x.id } }) })),
          ...(key === 'map' ? ['-', { icon: 'transition-right', label: 'Crossfade (no look)', checked: partNow(key) === 'fade', action: () => ts.settings({ looks: { map: 'fade' } }) }] : [])]); } });
        bind(() => { const v = partNow(key); const sig = `${v}|${styleNow()}`; if (btn.dataset.sig === sig) return; btn.dataset.sig = sig; btn.replaceChildren(h('span', {}, v === 'style' ? 'Table style' : nameOf(v)), iconEl('chevron-down')); btn.classList.toggle('own', v !== 'style'); });
        return h('div', { class: 'ctl part-row' }, h('span', { class: 'ctl-label' }, label), btn, tryBtn(key));
      };
      return h('div', { class: 'stack' },
        optHead('Table style'),
        grid,
        optHead('Each part'),
        part('map', 'A new map arrives', 'The table\'s style, a style of its own, or a plain crossfade'),
        part('talk', 'Conversation', 'The band the portraits stand in and how they come and go'),
        part('init', 'Initiative', 'The ribbon along the long edges of the TV'),
        part('round', 'New-round banner', '"Round 4" sweeping across the table'),
        h('p', { class: 'hint' }, 'What the turn order shows, the round and its badge: ', h('button', { class: 'link-btn', onclick: () => openOptions('init') }, 'Options → Initiative')));
    }
    // Prototype 7: everything about the turn order in one place (the Initiative panel's Options button opens this)
    if (id === 'init') {
      const P = () => (S && S.players) || {};
      return h('div', { class: 'stack' },
        optHead('On the table'),
        toggleCtl(bind, { label: 'Initiative on the table', get: () => set().initShow !== false, set: (v) => ts.settings({ initShow: v }) }),
        segCtl(bind, { label: 'Initiative shows', options: [
          { value: 0, label: 'Everyone' }, { value: 4, label: 'Now + next 3' }, { value: 3, label: 'Now + next 2' }, { value: 2, label: 'Now + next' }],
          get: () => set().initCount || 0, set: (v) => ts.settings({ initCount: v }) }),
        segCtl(bind, { label: 'Enemies in the turn order', options: [
          { value: 'names', label: 'By name', tip: 'Goblin 1, Goblin 2, the Ogre …' },
          { value: 'enemy', label: '"Enemy"', tip: 'No names that give anything away' }],
          get: () => set().initFoes || 'names', set: (v) => ts.settings({ initFoes: v }) }),
        optHead('The round'),
        segCtl(bind, { label: 'Round on the table', options: [
          { value: 'auto', label: 'In the turn order', tip: 'During a fight the round is part of the turn order; without one, the badge shows it' },
          { value: 'badge', label: 'Badge', tip: 'Always the round badge; the turn order without the round' },
          { value: 'both', label: 'Both' },
          { value: 'order', label: 'Only turn order', tip: 'The round only in the turn order; never the badge' },
          { value: 'off', label: 'Off', tip: 'The players never see the round' }],
          get: () => (set().round && set().round.mode) || 'auto', set: (v) => ts.settings({ roundMode: v }) }),
        toggleCtl(bind, { label: 'Announce each new round with a banner', get: () => !set().round || set().round.banner !== false, set: (v) => ts.settings({ roundBanner: v }) }),
        h('div', { class: 'try-row' }, h('button', { class: 'btn small ghost', 'data-tip': 'Drag the badge over a picture of the TV, its size',
          onclick: () => { closeOptions(); if (typeof Play !== 'undefined' && document.body.dataset.screen === 'play') Play.openPop('round'); else UI.toast('Open the maps first: the badge is placed over a picture of the TV'); } }, iconEl('drag-drop-2'), 'Where the round badge sits …')),
        optHead('The list'),
        toggleCtl(bind, { label: 'Sort by itself when the last number is in', get: () => set().initAuto !== false, set: (v) => ts.settings({ initAutoSort: v }) }),
        optHead('Player phones in a fight'),
        sliderCtl(bind, { label: 'Speed without a card', min: 5, max: 120, step: 5, fmt: (v) => `${v} ft`, get: () => P().speed || 30, set: (v) => ts.players('set', { speed: v }) }),
        toggleCtl(bind, { label: 'A trace of the steps', get: () => P().trace !== false, set: (v) => ts.players('set', { trace: v }) }),
        h('p', { class: 'hint' }, 'In a fight only the player whose turn it is moves; you can still drag any token. How it all looks: ', h('button', { class: 'link-btn', onclick: () => openOptions('looks') }, 'Options → Looks')));
    }
    if (id === 'tokens') return tokensSection(bind);
    if (id === 'sound') return soundSection(bind);
    if (id === 'perf') {
      const mapLine = h('div', { class: 'ctl-row map-quality' });
      bind(() => {
        const s = st();
        const mid = s.table && s.table.liveMapId;
        const lv = mid && s.settings && s.settings.mapQuality ? s.settings.mapQuality[mid] : null;
        const sig = `${mid}|${lv}`;
        if (mapLine.dataset.sig === sig) return;
        mapLine.dataset.sig = sig;
        mapLine.innerHTML = '';
        mapLine.hidden = !lv;
        if (!lv) return;
        mapLine.append(iconEl('gauge'), h('span', { class: 'grow' }, `${s.table.liveName || 'This map'} plays with ${lv === 'low' ? 'Low' : 'Medium'} effects${lv === 'low' ? ' (videos stand still on your screen)' : ''}`),
          h('button', { class: 'btn small', onclick: () => ts.settings({ mapQuality: { mapId: mid, level: null } }) }, 'Back to normal'));
      });
      return h('div', { class: 'stack' },
        segCtl(bind, { label: 'Effects quality', options: [
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium', tip: 'Fewer particles, lighter effect layers' },
          { value: 'low', label: 'Low', tip: 'For weaker computers: 30 frames a second on the TV; video maps stand still on your screen' }],
        get: () => set().quality || 'high', set: (v) => ts.settings({ quality: v }) }),
        mapLine,
        toggleCtl(bind, { label: 'Ask to lower the effects when the TV stutters', get: () => set().fpsWatch, set: (v) => ts.settings({ fpsWatch: v }) }),
        toggleCtl(bind, { label: 'Build tools show the whole map with light and effects', get: () => set().buildWide !== false, set: (v) => ts.settings({ buildWide: v }) }),
        h('p', { class: 'hint' }, 'Off: light and effects are drawn only inside the TV\'s frame, as while playing.'),
        h('div', { class: 'pop-sep' }),
        animPanel(st, bind),
        h('div', { class: 'pop-sep' }),
        benchPanel());
    }
    if (id === 'screen') {
      let scaleT = 0; // (the window changes size with it: once the slider rests)
      const hot = () => (typeof Play !== 'undefined' && Play.Hot) || null; // (Play is a const of its own script, not on window)
      return h('div', { class: 'stack' },
        // 4.0.1: this window's own size (a small laptop screen gets crowded); the TV is not touched
        sliderCtl(bind, { label: 'Size of everything in this window', min: 0.7, max: 1.3, step: 0.05, get: () => set().uiScale || 1, set: (v) => { clearTimeout(scaleT); scaleT = setTimeout(() => ts.settings({ uiScale: v }), 150); }, fmt: pct }),
        segCtl(bind, { label: 'Hotbar', options: [['10x1', '10 × 1'], ['5x2', '5 × 2'], ['2x5', '2 × 5'], ['1x10', '1 × 10']].map(([value, label]) => ({ value, label })),
          get: () => (hot() ? hot().shape() : '10x1'), set: (v) => { if (hot()) hot().setShape(v); refreshOptions(); } }),
        // Prototype 25: a line with a tool's keys for a few seconds when you pick it
        toggleCtl(bind, { label: 'Show a tool\'s keys when you pick it', get: () => { try { return localStorage.getItem('toolHints') !== '0'; } catch { return true; } },
          set: (v) => { try { localStorage.setItem('toolHints', v ? '1' : '0'); } catch { /* */ } refreshOptions(); } }));
    }
    if (id === 'library') return libraryBox(bind);
    if (id === 'tv') {
      // 4.11.3: how videos reach the TV (black bars flickering where something lies over a video map: the graphics
      // card's overlay); takes effect after a restart
      const restart = h('div', { class: 'ctl-row video-restart' }, h('span', { class: 'grow hint' }, 'Takes effect when Tablescape starts again.'),
        h('button', { class: 'btn small primary', onclick: () => ts.app('restart') }, iconEl('refresh'), 'Restart now'));
      bind(() => { restart.hidden = (set().videoPath || 'noOverlay') === (set().videoPathNow || 'noOverlay'); });
      return h('div', { class: 'stack' }, tablePanel(st, bind, 'screen'),
        optHead('Video on the TV'),
        segCtl(bind, { label: 'Animated maps and overlays', options: [
          { value: 'noOverlay', label: 'Drawn with the picture', tip: 'Against flickering black bars over video maps' },
          { value: 'normal', label: 'Graphics card overlay', tip: 'A little lighter for the PC, but some TVs flicker with it' },
          { value: 'noDcomp', label: 'Safest', tip: 'If it still flickers (a little heavier)' }],
          get: () => set().videoPath || 'noOverlay', set: (v) => ts.settings({ videoPath: v }) }),
        restart);
    }
    return tablePanel(st, bind, 'screen');
  }
  // 4.10: Options → Tokens: picture size per 5e size, what new tokens get, the toolbar and the selection ring, the TV
  const PIC_SIZES = [['tiny', 'Tiny'], ['medium', 'Small and Medium'], ['large', 'Large'], ['huge', 'Huge'], ['garg', 'Gargantuan']];
  function tokensSection(bind) {
    const tk = () => set().tokens || {};
    const T = (patch) => ts.settings({ tokens: patch });
    const play = () => (typeof Play !== 'undefined' && Play.tokPref ? Play : null); // (Play is a const of its own script)
    const pref = (k, d) => { const p = play(); const v = p ? p.tokPref(k) : undefined; return v ?? d; };
    const setPref = (k, v) => { const p = play(); if (p) p.setTokPref(k, v); refreshOptions(); };
    const picT = {};
    return h('div', { class: 'stack tok-opts' },
      optHead('Picture size'),
      h('p', { class: 'faint opt-note' }, 'How big a token\'s picture is drawn over its squares.'),
      ...PIC_SIZES.map(([k, label]) => sliderCtl(bind, { label, min: 0.7, max: 1.7, step: 0.05, get: () => (tk().pic || {})[k],
        set: (v) => { clearTimeout(picT[k]); picT[k] = setTimeout(() => T({ pic: { [k]: v } }), 60); }, fmt: pct })),
      h('div', { class: 'ctl-row' }, h('button', { class: 'btn small ghost', onclick: () => T({ picReset: true }) }, iconEl('restore'), 'Back to the standard sizes')),
      optHead('New tokens'),
      segCtl(bind, { label: 'Size', options: [['tiny', 'T', 'Tiny'], ['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large'], ['huge', 'H', 'Huge'], ['garg', 'G', 'Gargantuan']].map(([value, label, tip]) => ({ value, label, tip })),
        get: () => pref('size', 'medium'), set: (v) => setPref('size', v) }),
      toggleCtl(bind, { label: 'Place them hidden (players don\'t see them yet)', get: () => pref('hidden', false), set: (v) => setPref('hidden', v) }),
      toggleCtl(bind, { label: 'Number copies (Goblin 1, 2, 3)', get: () => pref('number', true), set: (v) => setPref('number', v) }),
      segCtl(bind, { label: 'Name tag', options: [{ value: 'off', label: 'Off' }, { value: 'gm', label: 'Only me', tip: 'Under the token on your screen' }, { value: 'all', label: 'Players too', tip: 'On the table as well (not while the token is hidden)' }],
        get: () => pref('tag', 'off'), set: (v) => setPref('tag', v) }),
      toggleCtl(bind, { label: 'Snap to the grid (Alt does the other)', get: () => tk().snap !== false, set: (v) => T({ snap: v }) }),
      optHead('On your screen'),
      segCtl(bind, { label: 'Toolbar of a selected token', options: [
        { value: 'compact', label: 'Compact', tip: 'Small, a little further off, see-through until the mouse is on it' },
        { value: 'floating', label: 'Full', tip: 'Bigger, right above the token' },
        { value: 'docked', label: 'Docked', tip: 'Always in the same place, above the hotbar' }],
        get: () => tk().card || 'compact', set: (v) => T({ card: v }) }),
      segCtl(bind, { label: 'Selection ring', options: [{ value: 'thin', label: 'Thin line' }, { value: 'glow', label: 'Soft glow' }],
        get: () => tk().ring || 'thin', set: (v) => T({ ring: v }) }),
      optHead('On the table'),
      sliderCtl(bind, { label: 'Name tags', min: 0.5, max: 2.5, step: 0.05, get: () => tk().tagSize || 1, set: (v) => T({ tagSize: v }), fmt: pct }),
      toggleCtl(bind, { label: 'Numbers on copies (Goblin 1, 2, 3)', get: () => tk().numbers !== false, set: (v) => T({ numbers: v }) }),
      toggleCtl(bind, { label: 'Glow around whose turn it is', get: () => tk().turnGlow !== false, set: (v) => T({ turnGlow: v }) }),
      toggleCtl(bind, { label: 'Shadow under tokens', get: () => !!tk().shadow, set: (v) => T({ shadow: v }) }));
  }
  // Options → Sound: the speakers, the fight music, spell sounds (each spell look can use its own file)
  let previewAudio = null;
  function previewSfx(skin) {
    if (previewAudio) previewAudio.pause();
    const own = set().sfxMap && set().sfxMap[skin];
    previewAudio = new Audio(own && own.url ? own.url : `sfx/${skin}.ogg`);
    previewAudio.volume = set().sfxVolume ?? 0.7;
    previewAudio.play().catch(() => {});
  }
  function soundSection(bind) {
    let volT = 0;
    const perLook = h('div', { class: 'sfx-list' });
    let sig = '';
    bind(() => {
      const m = set().sfxMap || {};
      const canPick = !!(S && S.screen === 'play' && S.map); // the library opens on the maps
      const n = JSON.stringify([m, canPick]);
      if (n === sig) return;
      sig = n;
      perLook.replaceChildren(...Object.entries(FXDATA.SKINS).map(([id, sk]) => {
        const mine = m[id];
        return h('div', { class: 'sfx-row', dataset: { flash: `sfx:${id}` } },
          h('span', { class: 'skin-dot', style: `--c:${sk.c}` }, iconEl(sk.icon)), h('span', { class: 'sfx-name' }, sk.label),
          h('span', { class: `sfx-file ellipsis grow ${mine && mine.missing ? 'danger-text' : ''}` }, mine ? mine.name + (mine.missing ? ' (missing)' : '') : 'Built-in'),
          h('button', { class: 'icon-btn', 'aria-label': `Listen to ${sk.label}`, 'data-tip': 'Listen', onclick: () => previewSfx(id) }, iconEl('player-play')),
          h('button', { class: 'icon-btn', disabled: !canPick, 'aria-label': `Choose a sound for ${sk.label}`, 'data-tip': canPick ? 'Choose a sound from the library' : 'Open a map first: the library opens there',
            onclick: () => { closeOptions(); Play.Drawer.open({ cat: 'sounds', purpose: `sfx:${id}`, back: { options: 'sound' } }); } }, iconEl('folder')),
          mine ? h('button', { class: 'icon-btn', 'aria-label': 'Built-in sound', 'data-tip': 'Back to the built-in sound', onclick: () => ts.settings({ sfxFor: { skin: id, path: null } }) }, iconEl('arrow-back-up')) : null);
      }));
    });
    return h('div', { class: 'stack' },
      optHead('Speakers'),
      soundOutPicker(bind),
      optHead('Music'),
      toggleCtl(bind, { label: 'Fight music starts and ends with a fight in Initiative', get: () => set().fightAuto, set: (v) => ts.settings({ fightAuto: v }) }),
      toggleCtl(bind, { label: 'Lower the ambience while effects play', get: () => set().duck, set: (v) => ts.settings({ duck: v }) }),
      optHead('Spell sounds'),
      toggleCtl(bind, { label: 'Play a sound when a spell is cast', get: () => set().sfxOn, set: (v) => ts.settings({ sfxOn: v }) }),
      sliderCtl(bind, { label: 'Volume', min: 0, max: 1, step: 0.01, get: () => set().sfxVolume, set: (v) => { clearTimeout(volT); volT = setTimeout(() => ts.settings({ sfxVolume: v }), 120); }, fmt: pct }),
      h('span', { class: 'ctl-label' }, 'Sound for each spell look'),
      perLook);
  }

  // 2.3: animated assets: baked once into frame sheets (anim.js, anim-cache.js); how the GM screen draws them
  function animPanel(st, bind) {
    const line = h('div', { class: 'anim-cache-line' });
    const rows = h('div', { class: 'anim-rows' }); // 2.4: each animation of this campaign, and how it is kept
    const disk = h('div', { class: 'anim-disk', hidden: true });
    let lastInfo = null;
    const prep = h('button', { class: 'btn small', 'data-tip': 'Prepares what is still missing' }, iconEl('player-play'), 'Prepare now');
    const clear = h('button', { class: 'btn small', 'data-tip': 'Deletes all prepared animations; those in use are prepared again' }, iconEl('trash'), 'Clear the cache');
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const i = await ts.anim('info');
        const mb = i.bytes / 1048576;
        const size = i.bytes ? (mb < 0.1 ? '< 0.1 MB' : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`) : 'empty';
        line.textContent = `${i.sheets} prepared animation${i.sheets === 1 ? '' : 's'} (${size})${i.left ? ` · ${i.left} still to prepare` : ''}${i.failed ? ` · ${i.failed} play${i.failed === 1 ? 's' : ''} as video` : ''}`;
        // 2.5: room on the library's disk (baking pauses below 500 MB)
        disk.hidden = !i.low;
        if (i.low) disk.textContent = `${i.paused ? 'Preparing is paused: only' : 'Only'} ${i.free < 1073741824 ? `${Math.round(i.free / 1048576)} MB` : `${(i.free / 1073741824).toFixed(1)} GB`} free on the disk with your library. Preparing animations needs some room (about 2 MB each).`;
        lastInfo = i;
        prep.disabled = !i.left && !i.failed;
        clear.disabled = !i.sheets;
        const list = await ts.anim('list');
        rows.replaceChildren(...(list || []).map((a) => h('div', { class: `anim-row ${a.video ? 'is-video' : ''}` },
          UI.wrapName(a.name, 'grow'),
          h('span', { class: 'anim-row-fps', 'data-tip': a.baked ? `${a.px} px, ${a.frames} frames (the file: ${a.src} a second)${a.blend ? '. Few frames a second: they are blended into each other, so it still moves smoothly' : ''}` : a.video ? `Plays as a video: ${a.video}` : 'Not prepared yet' },
            a.baked ? `${Math.round(a.fps)} fps${a.blend ? ' · smoothed' : ''}` : a.video ? 'video' : '…'))));
        rows.hidden = !(list && list.length);
      } catch {} finally { busy = false; }
    }
    prep.onclick = async () => { await ts.anim('retry'); refresh(); };
    // 2.5: asks first: baking everything again can take a while
    clear.onclick = () => {
      const i = lastInfo || {};
      const mins = Math.max(1, Math.round((i.rebakeSecs || 0) / 60));
      const dlg = UI.dialog('Clear the cache?', h('div', { class: 'stack' },
        h('p', {}, `${i.sheets || 0} prepared animation${i.sheets === 1 ? '' : 's'} (${i.bytes ? `${Math.max(0.1, Math.round(i.bytes / 104857.6) / 10)} MB` : 'empty'}) are deleted.`),
        i.used ? h('p', {}, `The ${i.used} animation${i.used === 1 ? '' : 's'} your maps use are prepared again right away: about ${mins} minute${mins === 1 ? '' : 's'}. Meanwhile they play as videos (the maid runs at the top).`) : null,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => dlg.close() }, 'Keep them'),
          h('button', { class: 'btn danger', onclick: async () => { dlg.close(); await ts.anim('clear'); refresh(); } }, iconEl('trash'), 'Clear the cache'))));
    };
    refresh();
    const off = AnimBaker.on(() => { if (!line.isConnected) { off(); return; } clearTimeout(line._t); line._t = setTimeout(refresh, 400); });
    return h('div', { class: 'stack anim-perf' },
      h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'Animated assets'), line, disk, rows, h('div', { class: 'ctl-row' }, prep, clear)),
      // Prototype 26: one switch for how much your screen draws; the single settings are under Advanced
      segCtl(bind, { label: 'Load on this computer', options: [
        { value: 'still', label: 'Light', tip: 'Animations and effects stand still on your screen. The TV plays everything.' },
        { value: 'light', label: 'Balanced', tip: 'About 12 frames a second on your screen. The TV plays at full speed.' },
        { value: 'smooth', label: 'Full', tip: 'Every frame on your screen too: smoothest, heaviest for the laptop' }],
      get: () => { const x = st().settings || {}; const a = x.gmAnim || 'light'; return a === (x.gmFx || 'light') ? a : ''; }, set: (v) => ts.settings({ gmAnim: v, gmFx: v }) }),
      h('details', { class: 'opt-adv' }, h('summary', {}, 'Advanced'),
        segCtl(bind, { label: 'Animated assets on your screen', options: [
          { value: 'smooth', label: 'Full speed' },
          { value: 'light', label: '12 fps', tip: 'About 12 frames a second on your screen; the TV plays at full speed' },
          { value: 'still', label: 'Still', tip: 'Standing still on your screen; the TV plays them' }],
        get: () => (st().settings && st().settings.gmAnim) || 'light', set: (v) => ts.settings({ gmAnim: v }) }),
        // Prototype 19: the effects (mist, fire, weather, flickering light, spells) on your screen
        segCtl(bind, { label: 'Effects on your screen', options: [
          { value: 'smooth', label: 'Full speed', tip: 'Every frame your screen shows: smoothest, heaviest for the laptop' },
          { value: 'light', label: '12 fps', tip: 'About 12 frames a second on your screen; the TV plays at full speed' },
          { value: 'still', label: 'Still', tip: 'Drawn only when something changes: lightest. The TV plays them' }],
        get: () => (st().settings && st().settings.gmFx) || 'light', set: (v) => ts.settings({ gmFx: v }) }),
        segCtl(bind, { label: 'Who draws the animations', options: [
          { value: 'cpu', label: 'Processor', tip: 'The default: smooth with many animations' },
          { value: 'gpu', label: 'Graphics card', tip: 'Lighter with few animations. "Graphics card vs processor" below picks the better one' }],
        get: () => (st().settings && st().settings.animDraw) || 'cpu', set: (v) => ts.settings({ animDraw: v }) })));
  }

  // 2.4: the benchmark (bench.js, main.js): the map on the TV measured for 20 s, or twice (animations as videos, then
  // baked). Each result next to the one before on the same map: better in green, worse in red.
  const benchWhen = (t) => {
    const d = new Date(t); const now = new Date();
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? `today ${hm}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
  };
  const benchMem = (mb) => (mb == null ? '–' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
  // the difference to an earlier value: up is better for frames, down for the processor and memory
  function benchDelta(now, before, { lowerBetter = false, unit = '' } = {}) {
    if (now == null || before == null) return null;
    const d = Math.round((now - before) * 10) / 10;
    if (Math.abs(d) < (unit === ' MB' ? 20 : 1)) return h('span', { class: 'bench-d same' }, '±0');
    const good = lowerBetter ? d < 0 : d > 0;
    return h('span', { class: `bench-d ${good ? 'good' : 'bad'}` }, `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit}`);
  }
  function benchCard(rs, all) {
    const row = (label, ...cells) => h('div', { class: 'bench-row' }, h('span', { class: 'bench-k' }, label), ...cells.map((c) => h('span', { class: 'bench-v' }, c)));
    const tvTxt = (r) => (r.tv ? `${r.tv.fps} fps` : 'no answer');
    // 2.5: the animations themselves: how much of their own speed they really showed on the TV
    const mo = (r) => (r && r.motion ? r.motion.tv : null);
    const moTxt = (r) => { const x = mo(r); return x && x.count ? `${x.ratio} % of their speed` : '–'; };
    const slowTxt = (r) => { const x = mo(r); return x && x.slowest ? h('span', { 'data-tip': x.slowest.name }, `${x.slowest.fps} of ${x.slowest.want} fps · `, UI.wrapName(x.slowest.name, 'bench-name')) : '–'; };
    const stillTxt = (r) => { const x = mo(r); return x && x.still ? `${(x.still.ms / 1000).toFixed(x.still.ms < 1000 ? 2 : 1)} s` : '–'; };
    const footTxt = (r) => `${r.quality} effects · your screen ${({ smooth: 'full speed', light: '12 fps', still: 'still' })[r.gmAnim] || r.gmAnim}${r.gmFx ? `, effects ${({ smooth: 'full speed', light: '12 fps', still: 'still' })[r.gmFx] || r.gmFx}` : ''} · drawn by the ${r.animDraw === 'cpu' ? 'processor' : 'graphics card'}`;
    const animTxt = (r) => (r.anim ? `${r.anim.animated}${r.anim.animated ? ` (${r.anim.baked} prepared${r.anim.blended ? `, ${r.anim.blended} smoothed` : ''}${r.anim.videos ? `, ${r.anim.videos} videos` : ''})` : ''}` : '–');
    if (rs.length === 2) { // videos vs baked, or (Beta 1) graphics card vs processor
      const [a, b] = rs;
      const col = { videos: 'As videos', baked: 'Baked', gpu: 'Graphics card', cpu: 'Processor' };
      return h('div', { class: 'bench-card pair' },
        h('div', { class: 'bench-head' }, UI.wrapName(a.map, 'grow', 'b'), h('span', { class: 'faint' }, `${benchWhen(b.t)}`)),
        h('div', { class: 'bench-row head' }, h('span', { class: 'bench-k' }), h('span', { class: 'bench-v' }, col[a.label] || a.label), h('span', { class: 'bench-v' }, col[b.label] || b.label)),
        row('Animations', moTxt(a), h('span', {}, `${moTxt(b)} `, benchDelta(mo(b) && mo(b).ratio, mo(a) && mo(a).ratio, { unit: ' %' }))),
        row('Slowest', slowTxt(a), slowTxt(b)),
        row('Longest still', stillTxt(a), stillTxt(b)),
        row('TV', a.tv ? `${a.tv.fps} fps` : '–', h('span', {}, b.tv ? `${b.tv.fps} fps ` : '–', benchDelta(b.tv && b.tv.fps, a.tv && a.tv.fps))),
        row('Worst 1 %', a.tv ? `${a.tv.low} fps` : '–', h('span', {}, b.tv ? `${b.tv.low} fps ` : '–', benchDelta(b.tv && b.tv.low, a.tv && a.tv.low))),
        row('Stutters', a.tv ? String(a.tv.stutters) : '–', h('span', {}, b.tv ? `${b.tv.stutters} ` : '–', benchDelta(b.tv && b.tv.stutters, a.tv && a.tv.stutters, { lowerBetter: true }))),
        row('Your screen', a.gm ? `${a.gm.fps} fps` : '–', h('span', {}, b.gm ? `${b.gm.fps} fps ` : '–', benchDelta(b.gm && b.gm.fps, a.gm && a.gm.fps))),
        row('Processor', `${a.cpu.all ?? '–'} %`, h('span', {}, `${b.cpu.all ?? '–'} % `, benchDelta(b.cpu.all, a.cpu.all, { lowerBetter: true, unit: ' %' }))),
        row('Graphics', `${a.cpu.gpu ?? '–'} %`, h('span', {}, `${b.cpu.gpu ?? '–'} % `, benchDelta(b.cpu.gpu, a.cpu.gpu, { lowerBetter: true, unit: ' %' }))),
        row('Memory', benchMem(a.mem.all), benchMem(b.mem.all)),
        h('div', { class: 'bench-foot faint' }, `Animations: ${animTxt(b)} · ${footTxt(b)}`));
    }
    const r = rs[0];
    const prev = all.filter((x) => x.mapId === r.mapId && x.label === 'normal' && x.t < r.t).pop() || null;
    return h('div', { class: 'bench-card' },
      h('div', { class: 'bench-head' }, UI.wrapName(r.map, 'grow', 'b'), h('span', { class: 'faint' }, benchWhen(r.t))),
      mo(r) && mo(r).count ? row('Animations', h('span', {}, `${moTxt(r)} `, prev ? benchDelta(mo(r).ratio, mo(prev) && mo(prev).ratio, { unit: ' %' }) : null)) : null,
      mo(r) && mo(r).count ? row('Slowest', slowTxt(r)) : null,
      mo(r) && mo(r).count ? row('Longest still', stillTxt(r)) : null,
      row('TV', h('span', {}, `${tvTxt(r)} `, prev ? benchDelta(r.tv && r.tv.fps, prev.tv && prev.tv.fps) : null)),
      row('Worst 1 %', r.tv ? `${r.tv.low} fps · ${r.tv.stutters} stutter${r.tv.stutters === 1 ? '' : 's'}` : '–'),
      row('Your screen', r.gm ? `${r.gm.fps} fps` : '–'),
      row('Processor', h('span', {}, `TV ${r.cpu.tv ?? '–'} %, you ${r.cpu.gm ?? '–'} %, graphics ${r.cpu.gpu ?? '–'} % `, prev ? benchDelta(r.cpu.all, prev.cpu.all, { lowerBetter: true, unit: ' %' }) : null)),
      row('Memory', benchMem(r.mem.all)),
      row('Assets', animTxt(r)),
      h('div', { class: 'bench-foot faint' }, `${footTxt(r)} · ${r.seconds} s${prev ? ` · compared with ${benchWhen(prev.t)}` : ''} · ${r.version}`));
  }
  // the runs, newest first; the two halves of a "videos vs baked" go together
  function benchGroups(all) {
    const out = []; const seen = new Set();
    for (const r of all.slice().reverse()) {
      if (r.pair) { if (seen.has(r.pair)) continue; seen.add(r.pair); const two = all.filter((x) => x.pair === r.pair); if (two.length === 2) out.push(two); }
      else out.push([r]);
    }
    return out;
  }
  function benchPanel() {
    const run = h('button', { class: 'btn small primary', 'data-tip': 'Measures the map on the TV for 20 seconds. Hands off meanwhile' }, iconEl('gauge'), 'Run benchmark');
    const cmp = h('button', { class: 'btn small', 'data-tip': 'Measures twice, 15 seconds each: animations as videos, then as prepared frames' }, iconEl('arrows-shuffle'), 'Videos vs prepared');
    const drw = h('button', { class: 'btn small', 'data-tip': 'Measures twice, 15 seconds each: graphics card, then processor. Keeps the better one' }, iconEl('cpu'), 'Graphics card vs processor');
    const status = h('div', { class: 'bench-status', hidden: true });
    const list = h('div', { class: 'bench-list' });
    const more = h('button', { class: 'btn ghost small', hidden: true, onclick: () => allResults() }, 'All results…');
    let ends = 0; let label = ''; let timer = 0;
    const tick = () => {
      if (!status.isConnected) { clearInterval(timer); return; }
      status.textContent = `${label}: ${Math.max(0, Math.round((ends - Date.now()) / 1000))} s, hands off …`;
    };
    function running(on, seconds) {
      run.disabled = on; cmp.disabled = on; drw.disabled = on; status.hidden = !on;
      clearInterval(timer);
      if (!on) return;
      ends = Date.now() + seconds * 1000;
      label = label || 'Measuring';
      timer = setInterval(tick, 400); tick();
    }
    async function fill() {
      const all = (await ts.bench('list')) || [];
      const groups = benchGroups(all);
      list.replaceChildren(...groups.slice(0, 2).map((g) => benchCard(g, all)));
      more.hidden = groups.length <= 2;
    }
    async function start(mode) {
      const r = await ts.bench('start', { mode });
      if (!r || !r.ok) { UI.toast((r && r.error) || 'The benchmark could not start', { kind: 'error' }); return; }
      label = mode === 'compare' ? 'As videos' : mode === 'draw' ? 'Graphics card' : 'Measuring';
      running(true, r.seconds);
    }
    run.onclick = () => start('normal');
    cmp.onclick = () => start('compare');
    drw.onclick = () => start('draw');
    const LABELS = { videos: 'As videos', baked: 'Prepared', gpu: 'Graphics card', cpu: 'Processor' };
    const off = Bench.on((e) => {
      if (!list.isConnected) { off(); return; }
      if (e.op === 'progress') { label = LABELS[e.label] || 'Measuring'; tick(); }
      if (e.op === 'done' || e.op === 'error') { running(false); fill(); }
    });
    ts.bench('running').then((b) => { if (b) running(true, Math.max(1, b.seconds - (Date.now() - b.started) / 1000)); });
    fill();
    return h('div', { class: 'ctl bench' }, h('span', { class: 'ctl-label' }, 'Benchmark'),
      h('div', { class: 'ctl-row wrap' }, run, cmp, drw), status, list, more);
  }
  async function allResults() {
    const dlg = UI.dialog('Benchmarks', UI.loader('Looking …'), { wide: true });
    const fill = async () => {
      const all = (await ts.bench('list')) || [];
      dlg.body.innerHTML = '';
      if (!all.length) { dlg.body.append(h('p', { class: 'hint' }, 'No results yet.')); return; }
      dlg.body.append(h('div', { class: 'bench-list wide' }, ...benchGroups(all).map((g) => benchCard(g, all))),
        h('div', { class: 'ctl-row' }, h('button', { class: 'btn small danger', onclick: async () => { await ts.bench('clear'); fill(); } }, iconEl('trash'), 'Clear all results')));
    };
    fill();
  }

  // Where the table's sound plays: the TV (HDMI), the laptop or a Bluetooth speaker, one for the
  // ambience and music and one for the effects. The list comes from the sound window, which plays
  // everything the table hears; Test plays a chime on that speaker.
  function soundOutPicker(bind) {
    let list = [];
    const SAME = '__same';
    const rows = [
      { which: 'music', label: 'Ambience and music play on', key: 'soundOut', labelKey: 'soundOutLabel' },
      { which: 'fx', label: 'Sound effects play on', key: 'fxOut', labelKey: 'fxOutLabel', same: true, tip: 'Soundboard, spell sounds, thunder, countdown' },
    ];
    const sels = rows.map((r) => {
      const sel = h('select', { 'aria-label': r.label, class: 'sound-out', dataset: { which: r.which } });
      sel.addEventListener('change', () => {
        const v = sel.value;
        const d = list.find((x) => x.id === v);
        ts.settings({ [r.key]: v === SAME ? null : v, [r.labelKey]: d ? d.label : '' });
      });
      sel.addEventListener('pointerdown', fill); // speakers come and go (the TV switched on, Bluetooth paired)
      return sel;
    });
    async function fill() {
      list = (await ts.sound('devices')) || [];
      rows.forEach((r, i) => {
        const sel = sels[i];
        const st = (S && S.settings) || {};
        const id = st[r.key];
        sel.innerHTML = '';
        if (r.same) sel.append(h('option', { value: SAME }, 'Same as the ambience'));
        sel.append(h('option', { value: '' }, 'System default'));
        for (const d of list) sel.append(h('option', { value: d.id }, d.label));
        if (id && !list.some((d) => d.id === id)) sel.append(h('option', { value: id }, `${st[r.labelKey] || 'The chosen speaker'} (not connected)`));
        sel.value = id == null ? (r.same ? SAME : '') : id;
      });
    }
    // filled again when the choice changes from elsewhere (Options and the campaign page's table check show the same)
    let sig = null;
    const sync = () => { const st = (S && S.settings) || {}; const n = JSON.stringify([st.soundOut, st.fxOut, st.soundOutLabel, st.fxOutLabel]); if (n !== sig) { sig = n; fill(); } };
    if (bind) bind(sync); else sync();
    return h('div', { class: 'stack sound-outs' }, ...rows.map((r, i) => h('div', { class: 'ctl', 'data-tip': r.tip || null },
      h('span', { class: 'ctl-label' }, r.label),
      h('div', { class: 'sound-out-row' }, sels[i],
        h('button', { class: 'btn small', 'aria-label': `Test: ${r.label}`, 'data-tip': 'Plays a chime on this speaker', onclick: () => ts.sound('test', { which: r.which }) }, iconEl('volume'), 'Test')))));
  }

  let optId = 'tv';
  let optBody = null;
  let optNav = null;
  let optTitle = null;
  function openOptions(section, flash) {
    if (section && OPT_SECTIONS.some((x) => x.id === section)) {
      if (optId === 'picture' && section !== 'picture' && S && S.testPicture) ts.cmd('table.test', { on: false });
      optId = section;
    }
    if (!setupEl) {
      optNav = h('nav', { class: 'opt-nav', role: 'tablist', 'aria-label': 'Options' },
        h('div', { class: 'opt-brand' }, iconEl('settings'), h('span', {}, 'Options')),
        ...OPT_SECTIONS.map((x) => h('button', { class: 'opt-tab', role: 'tab', dataset: { id: x.id }, onclick: () => openOptions(x.id) }, iconEl(x.icon), h('span', {}, x.label))));
      optTitle = h('div', { class: 'opt-title' });
      const optTips = UI.helpTip(() => { const sec = OPT_SECTIONS.find((x) => x.id === optId); return sec ? sec.label : 'Options'; }, () => { const sec = OPT_SECTIONS.find((x) => x.id === optId); return sec ? sec.tips : []; }); // 4.3.1
      optBody = h('div', { class: 'opt-body' });
      const panel = h('div', { class: 'modal options', role: 'dialog', 'aria-label': 'Options' },
        optNav,
        h('div', { class: 'opt-main' },
          h('div', { class: 'opt-headrow' }, optTitle, optTips, h('button', { class: 'icon-btn', 'aria-label': 'Close', 'data-tip': 'Close', 'data-key': 'Esc', onclick: closeOptions }, iconEl('x'))),
          optBody));
      setupEl = h('div', { class: 'modal-back options-back', onpointerdown: (e) => { if (e.target === setupEl) closeOptions(); } }, panel);
      document.body.append(setupEl);
    }
    fillOptions();
    if (flash) flashOption(String(flash));
  }
  function fillOptions() {
    if (!setupEl) return;
    setupRefs = [];
    const bind = (fn) => { setupRefs.push(fn); fn(); };
    const sec = OPT_SECTIONS.find((x) => x.id === optId) || OPT_SECTIONS[0];
    for (const b of optNav.querySelectorAll('.opt-tab')) { const on = b.dataset.id === sec.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    optTitle.replaceChildren(h('h2', {}, sec.label));
    optBody.innerHTML = '';
    optBody.dataset.id = sec.id;
    try { optBody.append(optSection(sec.id, bind)); } catch (err) {
      console.error(`options ${sec.id}: ${err && err.stack ? err.stack : err}`);
      optBody.append(h('p', { class: 'hint' }, 'This part ran into a problem (the log: Guide → Report a problem).'));
    }
    optBody.scrollTop = 0;
  }
  function refreshOptions() { for (const f of setupRefs) f(); }
  // a sound picked in the library for a spell look: its row lights up
  function flashOption(k) {
    const until = performance.now() + 1200;
    let first = true;
    const step = () => {
      const el = setupEl && [...setupEl.querySelectorAll('[data-flash]')].find((x) => x.dataset.flash === k);
      if (el && !el.classList.contains('flash')) {
        if (first) { el.scrollIntoView({ block: 'nearest' }); first = false; }
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1700);
      }
      if (performance.now() < until) setTimeout(step, 60);
    };
    step();
  }
  function closeOptions() {
    if (!setupEl) return;
    UI.closeMenu();
    setupEl.remove();
    setupEl = null;
    setupRefs = [];
    if (previewAudio) { previewAudio.pause(); previewAudio = null; }
    if (S && S.table.calibrating) ts.cmd('table.calibrate', { on: false });
    if (S && S.testPicture) ts.cmd('table.test', { on: false });
  }

  // ---------------------------------------------------------------------
  // The Guide (guide.js): keys, first evening, files, what's new, report a problem. ? opens it on any screen.
  // ---------------------------------------------------------------------
  function toggleHelp(force, tab) {
    const show = force ?? !Guide.isOpen();
    if (!show) { Guide.close(); return; }
    Guide.open(tab || 'keys');
  }
  // The shortcut sheet closes with Esc or ? on any screen.
  window.addEventListener('keydown', (e) => {
    // 4.0.1: Ctrl + / Ctrl − / Ctrl 0: the size of this window's interface (not the TV's)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['+', '=', '-', '0'].includes(e.key) && ts.role !== 'table') {
      e.preventDefault(); e.stopImmediatePropagation();
      const cur = (S && S.settings && S.settings.uiScale) || 1;
      const next = e.key === '0' ? 1 : Math.round(Math.min(1.3, Math.max(0.7, cur + (e.key === '-' ? -0.05 : 0.05))) * 20) / 20;
      ts.settings({ uiScale: next });
      UI.toast(`Interface size ${Math.round(next * 100)}% (Ctrl 0: 100%)`, { ms: 1400 });
      return;
    }
    if (Guide.isOpen() && (e.key === 'Escape' || e.key === '?')) {
      // 4.0.1: typing in the Guide (the note of a problem report): "?" is a question mark, Esc only leaves the field
      const field = e.target && e.target.tagName && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (field && e.key === '?') return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (field) { e.target.blur(); return; }
      toggleHelp(false);
      return;
    }
    // 4.3: Ctrl , opens Options (and closes it again)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ',' && ts.role !== 'table') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (setupEl) closeOptions(); else openOptions();
      return;
    }
    // Esc closes Options wherever the focus is (not while a dialog sits on top of it)
    if (setupEl && e.key === 'Escape') {
      const backs = document.querySelectorAll('.modal-back');
      if (backs[backs.length - 1] !== setupEl) return;
      if (e.target && e.target.tagName === 'SELECT') return; // an open list closes first
      if (UI.menuOpen()) { e.stopImmediatePropagation(); e.preventDefault(); UI.closeMenu(); return; } // (Prototype 7) so does a menu
      e.stopImmediatePropagation(); e.preventDefault(); closeOptions();
    }
    // Beta 1: ? opens the guide on the start screen and the campaign page too (the map screen handles its own keys)
    const typing = e.target && e.target.tagName && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (e.key === '?' && !typing && S && S.screen !== 'play' && !document.querySelector('.modal-back')) { e.preventDefault(); toggleHelp(true, 'keys'); }
  }, true);

  // (Prototype 25) the Options sections' tips for the Guide's Help page
  const helpSections = () => OPT_SECTIONS.filter((x) => x.tips && x.tips.length).map((x) => ({ title: x.label, tips: x.tips }));
  return { helpSections, start, tablePanel, picturePanel, soundOutPicker, openOptions, closeOptions, optionsOpen: () => !!setupEl, openTableSetup: (sec) => openOptions(sec || 'tv'),
    toggleHelp, helpOpen: () => Guide.isOpen(), get state() { return S; }, updateSlot: () => renderUpdate(), previewUpdate: (u) => renderUpdate(u), previewUpdateDone: () => updateDone() };
})();

App.start();
