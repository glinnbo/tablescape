// Tablescape on a phone or tablet (Beta 4.1), served by Tablescape itself on the home network (src/remote.js).
//   DM       a Stream Deck arranged at the PC: the turn order on top (tap it: next turn; the one before: back), a grid
//            of buttons below, pages up and down at the side. On a phone held upright the grid turns with it.
//   players  the player screen (a tablet, or a window on another screen of the PC): the party; in a fight the turn
//            order as cards with pictures, whose turn it is big in front; enemies stay "??" until the GM shows them.
//   pairing  the QR code carries a key (#k=…, one for the DM, one for the players); this device then keeps a token
//            (#t=…, so an icon on the home screen keeps the connection)
'use strict';

(() => {
  const KEYS = { token: 'ts.remote.token', id: 'ts.remote.id', page: 'ts.remote.deckpage', awake: 'ts.remote.awake', seat: 'ts.remote.seat' };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch {} },
  };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const FREE = new Set(['lights', 'mood', 'volume']); // these work while no campaign is open on the PC
  const ICON_OF = { volume: 'volume', moment: 'sparkles', light: 'sun', weather: 'cloud-rain', map: 'map-2', snap: 'camera', lights: 'bulb', mood: 'brand-spotify', roll: 'dice', death: 'heart-broken', wheel: 'chart-pie', fog: 'cloud-fog', cue: 'keyframes', sound: 'music', portrait: 'user', handout: 'photo', overlay: 'stack-2' };
  const keyOf = (it) => `${it.kind}:${JSON.stringify(it.ref ?? null)}`;

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const tablet = Math.min(screen.width, screen.height) >= 600;
  const devName = /iPhone/.test(ua) ? 'iPhone' : ios ? 'iPad' : /Android/.test(ua) ? (tablet ? 'Android tablet' : 'Android phone') : (tablet ? 'Tablet' : 'Phone');
  let devId = ls.get(KEYS.id);
  if (!devId) { devId = rid(); ls.set(KEYS.id, devId); }

  function h(tag, a, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && !['list', 'form'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const ic = (n) => { const t = document.createElement('template'); t.innerHTML = icon(n); return t.content.firstElementChild; };
  const vib = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch {} };

  const app = document.getElementById('app');
  const toastEl = h('div', { class: 'toast', hidden: true, role: 'status' });
  document.body.append(toastEl);
  let toastT = 0;
  function toast(t) {
    toastEl.textContent = t; toastEl.hidden = false;
    toastEl.classList.remove('in'); void toastEl.offsetWidth; toastEl.classList.add('in');
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }
  function showMsg(text, retry = false) {
    app.className = 'msg-mode';
    put(app, h('div', { class: 'msg' }, h('img', { class: 'logo', src: '/icon.png', alt: '' }), h('h2', {}, 'Tablescape'), h('p', {}, text),
      retry ? h('button', { class: 'pbtn primary', onclick: () => location.reload() }, ic('refresh'), 'Try again') : null));
  }

  // ---------------------------------------------------------------- talking to Tablescape
  let token = null; let role = null; let S = null; let label = ''; let es = null;
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) unpaired();
    return j;
  }
  const act = (op, arg = {}) => post('/api/do', { t: token, op, arg });
  const said = (r) => { if (!r) toast('Tablescape didn\'t answer'); else if (r.ok === false && r.error) toast(r.error); return r; };
  const faceSrc = (u) => (u ? `${u}?t=${encodeURIComponent(token)}` : null);
  function unpaired() {
    token = null; ls.set(KEYS.token, null);
    if (es) { es.close(); es = null; }
    history.replaceState(null, '', '/');
    showMsg('This device was disconnected in Tablescape. Scan the QR code again: Toolbox → Remote.');
  }
  function setConn(c) { document.body.dataset.conn = c; }
  let heard = 0; // (4.2.2) when the PC was last heard: a line that went quiet (a phone that slept) is opened again
  function connect() {
    if (es) es.close();
    setConn('wait');
    heard = Date.now();
    es = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
    es.addEventListener('ping', () => { heard = Date.now(); });
    es.addEventListener('hello', (e) => {
      heard = Date.now();
      const d = JSON.parse(e.data);
      if (label && d.label && d.label !== label) { location.reload(); return; } // 4.11.5: the PC has a new version: this page too
      label = d.label || '';
      if (role !== d.role) { role = d.role; mount(); }
      setConn('on');
    });
    es.onmessage = (e) => { heard = Date.now(); S = JSON.parse(e.data); setConn('on'); draw(); };
    es.onerror = () => {
      setConn('wait');
      if (es && es.readyState === 2) {
        es = null;
        setTimeout(async () => { const r = await act('ping').catch(() => null); if (token && (!r || r.ok)) setTimeout(connect, r ? 0 : 2500); }, 800);
      }
    };
  }
  async function boot() {
    const hp = new URLSearchParams(location.hash.slice(1));
    token = hp.get('t') || ls.get(KEYS.token);
    const key = hp.get('k');
    if (key) {
      showMsg('Connecting to Tablescape …');
      const r = await post('/api/pair', { key, id: devId, kind: tablet ? 'tablet' : 'phone', name: devName }).catch(() => null);
      if (r && r.ok) token = r.token;
      else { showMsg((r && r.error) || 'Tablescape didn\'t answer. Same Wi-Fi as the PC? Is the Remote switched on there?', !r); return; }
    }
    if (!token) { showMsg('Scan the QR code in Tablescape: Toolbox → Remote.'); return; }
    ls.set(KEYS.token, token);
    history.replaceState(null, '', `/#t=${token}`); // "Add to Home Screen" keeps this address, and with it the connection
    showMsg('Connecting to Tablescape …');
    connect();
  }

  // ---------------------------------------------------------------- the screen stays on (when the browser lets it)
  let lock = null; let vid = null;
  async function awake(on) {
    if (!on) { if (lock) lock.release().catch(() => {}); lock = null; if (vid) { vid.pause(); vid.remove(); vid = null; } return; }
    try { if ('wakeLock' in navigator && window.isSecureContext) { lock = await navigator.wakeLock.request('screen'); return; } } catch {}
    if (!vid) {
      vid = h('video', { src: '/keepawake.mp4', loop: true, muted: true, playsInline: true, style: 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none' });
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
      document.body.append(vid);
    }
    vid.play().catch(() => {});
  }
  const wantAwake = () => ls.get(KEYS.awake) !== '0';
  document.addEventListener('pointerdown', () => { if (wantAwake() && (!vid || vid.paused) && !lock) awake(true); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (token && (!es || es.readyState === 2 || Date.now() - heard > 20000)) connect();
    if (wantAwake()) { lock = null; awake(true); }
  });
  setInterval(() => { if (token && es && document.visibilityState === 'visible' && Date.now() - heard > 40000) connect(); }, 10000);

  // ---------------------------------------------------------------- a small menu (both views)
  function sheet(title, body) {
    const back = h('div', { class: 'sheet-back' });
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.append(h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'ib', 'aria-label': 'Close', onclick: close }, ic('x'))), body));
    document.body.append(back);
    return { close };
  }
  function openMenu() {
    let on = wantAwake();
    const sw = h('button', { class: `sw ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': 'Keep the screen on' });
    sw.addEventListener('click', () => { on = !on; sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); ls.set(KEYS.awake, on ? '1' : '0'); awake(on); });
    let armed = false;
    const leave = h('button', { class: 'pbtn danger', onclick: async () => {
      if (!armed) { armed = true; leave.lastChild.textContent = 'Tap again to disconnect'; return; }
      await act('leave').catch(() => null); m.close(); unpaired();
    } }, ic('logout'), h('span', {}, 'Disconnect this device'));
    const m = sheet(role === 'player' ? 'Player screen' : 'Button deck', h('div', { class: 'stack' },
      h('div', { class: 'trow' }, h('div', {}, 'Keep the screen on', h('small', {}, 'If it turns off anyway: set Auto-Lock to Never (Settings → Display on an iPhone or iPad).')), sw),
      document.fullscreenEnabled ? h('button', { class: 'pbtn', onclick: () => { m.close(); document.documentElement.requestFullscreen().catch(() => {}); } }, ic('maximize'), h('span', {}, 'Full screen')) : null,
      role === 'dm' ? h('p', { class: 'muted' }, 'The buttons are arranged on the PC: Toolbox → Remote → Arrange the deck.') : null,
      role === 'player' && S && S.ctl && S.ctl.me ? h('button', { class: 'pbtn', onclick: async () => { m.close(); said(await act('unpick').catch(() => null)); } }, ic('user-edit'), h('span', {}, `Not ${S.ctl.me.name}? Change character`)) : null,
      leave,
      h('p', { class: 'muted' }, `${devName}${label ? ` · Tablescape ${label}` : ''}`)));
  }

  // ---------------------------------------------------------------- the two views
  let view = null;
  function mount() {
    view = role === 'player' ? PlayerView() : DeckView();
    draw();
  }
  function draw() { if (view && S) view.draw(S); }
  window.addEventListener('resize', () => { if (view && view.resize) view.resize(); draw(); });

  // ================================================================ DM: the Stream Deck
  function DeckView() {
    app.className = 'deck';
    let page = Number(ls.get(KEYS.page)) || 0;
    const strip = h('div', { class: 'strip' });
    const grid = h('div', { class: 'grid' });
    const num = h('b', { class: 'pg-num' }, '1');
    const up = h('button', { class: 'pg-btn', 'aria-label': 'Page up', onclick: () => turnPage(-1) }, ic('chevron-up'));
    const down = h('button', { class: 'pg-btn', 'aria-label': 'Page down', onclick: () => turnPage(1) }, ic('chevron-down'));
    const more = h('button', { class: 'pg-more', 'aria-label': 'More', onclick: openMenu }, ic('dots'));
    const pager = h('nav', { class: 'pager' }, more, up, num, down);
    const banner = h('div', { class: 'deck-note', hidden: true });
    const info = h('section', { class: 'info', hidden: true });
    put(app, strip, info, h('div', { class: 'deck-main' }, h('div', { class: 'grid-wrap' }, grid, banner), pager));
    const Info = InfoPart(info);
    let gridSig = ''; let stripSig = '';
    const pagesOf = () => (S && S.deck ? S.deck.pages : []);
    function turnPage(d) {
      const n = pagesOf().length;
      if (n < 2) return;
      page = (page + d + n) % n;
      ls.set(KEYS.page, page);
      vib(); gridSig = ''; draw();
    }
    // a swipe up or down on the buttons turns the page too
    let sw = null;
    grid.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { passive: true });
    grid.addEventListener('pointerup', (e) => {
      if (!sw) return;
      const dx = e.clientX - sw.x; const dy = e.clientY - sw.y;
      if (Math.abs(dy) > 60 && Math.abs(dx) < 50 && Date.now() - sw.t < 700) { swiped = Date.now(); turnPage(dy < 0 ? 1 : -1); }
      sw = null;
    }, { passive: true });
    let swiped = 0;
    async function press(el, it) {
      if (Date.now() - swiped < 400) return;
      if (it.pc) { toast('This one needs the mouse on the map: use it at the PC'); return; }
      if (it.missing) { toast(`${it.label} isn't in this campaign`); return; }
      if (S && !S.at && !FREE.has(it.kind)) { toast('Open the campaign on the PC first'); return; }
      vib();
      el.classList.add('busy');
      const r = await act('run', { item: it }).catch(() => null);
      el.classList.remove('busy');
      if (!r) { toast('Tablescape didn\'t answer'); return; }
      if (!r.ok) { if (r.error) toast(r.error); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      if (it.kind === 'lights' && r.label) { toast(r.label); el.dataset.pct = r.label.replace(/^Lights /, ''); } // 4.5: −20 % / +20 %
    }
    // 4.11.4: a volume key is a slider (SFX: the soundboard; Spotify: the device it plays on)
    let volErrAt = 0;
    function volKey(it) {
      const which = it.ref === 'spotify' ? 'spotify' : 'sfx';
      const pct = h('b', { class: 'vol-pct' }, '–');
      const inp = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '0', class: 'vol-range', 'aria-label': it.label });
      const el = h('div', { class: `key vol ${it.color ? 'tinted' : ''}`, dataset: { key: keyOf(it), kind: it.kind, vol: which } },
        h('div', { class: 'vol-top' }, ic(it.icon || ICON_OF.volume), pct), h('span', {}, it.label), inp);
      if (it.color) el.style.setProperty('--kc', it.color);
      const show = () => { pct.textContent = `${inp.value}%`; inp.style.setProperty('--p', `${inp.value}%`); };
      let last = 0; let tm = null; let sent = null;
      const send = () => {
        tm = null;
        const v = Number(inp.value);
        if (v === sent) return;
        sent = v; last = Date.now();
        act('sound', which === 'spotify' ? { do: 'spotify', action: 'volume', volume: v } : { do: 'volume', v: v / 100 })
          .then((r) => { if (r && r.ok === false && r.error && Date.now() - volErrAt > 3000) { volErrAt = Date.now(); toast(r.error); } }).catch(() => {});
      };
      // 4.11.7: Spotify gets the volume once the finger rests (every step was a call to Spotify: it then refused the moods for a while)
      inp.addEventListener('input', () => {
        el._held = Date.now(); show();
        if (which === 'spotify') { clearTimeout(tm); tm = setTimeout(send, 450); return; }
        if (!tm) tm = setTimeout(send, Math.max(0, 120 - (Date.now() - last)));
      });
      inp.addEventListener('change', () => { el._held = Date.now(); clearTimeout(tm); send(); });
      inp.addEventListener('pointerdown', (e) => e.stopPropagation()); // (a slide, not a page swipe)
      el._set = (v) => {
        el.classList.toggle('unknown', v == null);
        if (Date.now() - (el._held || 0) < 2500) return; // (while the finger is on it, and a moment after)
        if (v == null) { pct.textContent = '–'; return; }
        inp.value = String(Math.round(v * 100)); sent = Number(inp.value); show();
      };
      return el;
    }
    function drawGrid(st) {
      const D = st.deck;
      const pages = D.pages;
      page = clamp(page, 0, Math.max(0, pages.length - 1));
      const upright = window.innerHeight > window.innerWidth * 1.1;
      const turn = upright && D.cols > D.rows; // held upright: the grid turns with the phone
      const cols = turn ? D.rows : D.cols; const rows = turn ? D.cols : D.rows;
      const sig = JSON.stringify([page, turn, D.cols, D.rows, pages[page]]);
      if (sig !== gridSig) {
        gridSig = sig;
        grid.style.setProperty('--cols', cols);
        grid.style.setProperty('--rows', rows);
        const cells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = turn ? c * D.cols + r : r * D.cols + c; // (turned: the top row becomes the left column)
          const it = (pages[page] || [])[i];
          if (!it) { cells.push(h('div', { class: 'key empty' })); continue; }
          if (it.kind === 'volume') { cells.push(volKey(it)); continue; }
          const el = h('button', { class: `key ${it.pc ? 'pc' : ''} ${it.missing ? 'missing' : ''} ${it.color ? 'tinted' : ''}`, dataset: { key: keyOf(it), kind: it.kind } },
            ic(it.icon || ICON_OF[it.kind] || 'square'), h('span', {}, it.label));
          if (it.color) el.style.setProperty('--kc', it.color); // (4.2.3) its own colour, chosen at the PC
          el.addEventListener('click', () => press(el, it));
          cells.push(el);
        }
        put(grid, cells);
        num.textContent = String(page + 1);
        up.disabled = down.disabled = pages.length < 2;
        pager.classList.toggle('one', pages.length < 2);
      }
      const live = new Set(st.live || []);
      for (const el of grid.querySelectorAll('.key[data-key]')) {
        el.classList.toggle('live', live.has(el.dataset.key));
        if (el.dataset.key === 'lights:"dim"' || el.dataset.key === 'lights:"bright"') el.dataset.pct = st.lightsPct || ''; // 4.5: how bright the lamps are now
        el.classList.toggle('off', !st.at && !FREE.has(el.dataset.kind));
        if (el._set) el._set(st.vol ? st.vol[el.dataset.vol] : null);
      }
      banner.hidden = !!st.at;
      banner.textContent = st.screen === 'home' || !st.campaign ? 'On the PC: open a campaign to play.' : 'On the PC: open the campaign (Play).';
    }
    async function initDo(d) {
      vib();
      const r = said(await act('init', { do: d }).catch(() => null));
      if (r && r.ok && r.label && /^Round/.test(r.label)) toast(r.label);
    }
    function drawStrip(st) {
      const on = st.deck.top === 'turn';
      strip.hidden = !on;
      app.classList.toggle('no-strip', !on);
      if (!on) return;
      const T = st.turn;
      const sig = JSON.stringify([T, st.at]);
      if (sig === stripSig) return;
      stripSig = sig;
      if (!T || !T.running) {
        put(strip, h('div', { class: 'st-idle' }, h('span', {}, st.at ? 'No fight right now' : ''),
          T && T.ready && st.at ? h('button', { class: 'pbtn primary', onclick: () => initDo('start') }, ic('swords'), h('span', {}, 'Start the fight')) : null));
        return;
      }
      const face = T.cur.face ? h('img', { class: 'st-face', src: faceSrc(T.cur.face), alt: '', onerror: (e) => e.target.replaceWith(initial(T.cur.name, 'st-face')) }) : initial(T.cur.name, 'st-face');
      // 4.3: the round in a badge of its own; before and next with a word and an arrow (no dots)
      const who = (cap, x) => h('span', { class: 'st-who' }, h('small', {}, cap), h('span', { class: 'st-nm' }, x ? x.name : '–'));
      put(strip,
        h('div', { class: `st-round ${T.round ? '' : 'none'}` }, h('small', {}, 'Round'), h('b', {}, T.round ? String(T.round) : '–')),
        h('button', { class: 'st-side prev', 'aria-label': `Back to ${T.prev ? T.prev.name : 'the turn before'}`, onclick: () => initDo('prev') }, ic('chevron-left'), who('Before', T.prev)),
        h('button', { class: `st-arrow ${T.cur.pc ? 'pc' : ''}`, 'aria-label': `${T.cur.name}'s turn: tap for the next turn`, onclick: (e) => { e.currentTarget.classList.remove('go'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('go'); initDo('next'); } },
          arrowShape(), face, h('span', { class: 'st-name' }, T.cur.name)),
        h('button', { class: 'st-side next', 'aria-label': `Next turn${T.next ? `: ${T.next.name}` : ''}`, onclick: () => initDo('next') }, who('Next', T.next), ic('chevron-right')));
    }
    return {
      draw(st) {
        if (!st.deck) return;
        const withInfo = !!(st.deck.info && st.info);
        info.hidden = !withInfo;
        app.classList.toggle('with-info', withInfo);
        if (withInfo) Info.draw(st.info);
        drawStrip(st); drawGrid(st);
      },
      resize() { gridSig = ''; },
    };
  }

  // ================================================================ the players (a tablet's deck, 4.2): only the GM sees this
  //   a card per character here today: AC, HP (live from the turn order), passives, senses, conditions, inspiration
  //   (tap the star), exhaustion; tap a card for languages, notes, HP, death saves; a passive check over all of them
  const PASS = [['pp', 'Perception', 'Perc.'], ['ins', 'Insight', 'Ins.'], ['inv', 'Investigation', 'Inv.']];
  function InfoPart(el) {
    const row = h('div', { class: 'in-row' });
    put(el, row);
    let last = null; let sig = '';
    const charDo = async (name, patch) => { vib(); said(await act('char', { name, ...patch }).catch(() => null)); };
    function card(c) {
      const hp = c.hp ? `${c.hp.cur ?? '–'}/${c.hp.max ?? '–'}` : c.maxHp != null ? String(c.maxHp) : '–';
      const pass = PASS.map(([k, , short]) => h('span', { class: 'in-p' }, h('small', {}, short), h('b', {}, c[k] ?? '–')));
      const pic = c.face ? h('img', { class: 'in-face', src: faceSrc(c.face), alt: '', onerror: (e) => e.target.replaceWith(initial(c.name, 'in-face')) }) : initial(c.name, 'in-face');
      const star = h('button', { class: `in-star ${c.insp ? 'on' : ''}`, 'aria-label': c.insp ? 'Inspiration: used' : 'Give inspiration', onclick: (e) => { e.stopPropagation(); charDo(c.name, { insp: !c.insp }); } }, ic('star'));
      return h('div', { class: `in-card ${c.down ? 'down' : ''}`, style: c.color ? `--cc:${c.color}` : '', role: 'button', onclick: () => detail(c.name) },
        h('div', { class: 'in-head' }, pic, h('div', { class: 'in-who' }, h('b', {}, c.name), c.player ? h('small', {}, c.player) : null), star),
        h('div', { class: 'in-stats' }, h('span', { class: 'in-ac' }, ic('shield'), h('b', {}, c.ac ?? '–')), h('span', { class: `in-hp ${c.down ? 'zero' : ''}` }, ic('heart'), h('b', {}, hp))),
        h('div', { class: 'in-pass' }, ...pass),
        h('div', { class: 'in-more' }, c.dark ? h('span', {}, ic('eye'), `${c.dark} ft`) : null, c.exh ? h('span', { class: 'warn' }, `Exhaustion ${c.exh}`) : null,
          ...(c.cond || []).map((x) => h('span', { class: 'cond' }, x)),
          c.down || c.ds.s || c.ds.f ? h('span', { class: 'ds' }, `✓${c.ds.s} ✗${c.ds.f}`) : null));
    }
    function detail(name) {
      const body = h('div', { class: 'stack' });
      const fill = () => {
        const c = (last || []).find((x) => x.name === name);
        if (!c) return;
        const tick = (kind, i) => h('button', { class: `in-tick ${kind} ${c.ds[kind] > i ? 'on' : ''}`, onclick: () => charDo(c.name, { ds: { ...c.ds, [kind]: c.ds[kind] > i ? i : i + 1 } }) });
        put(body,
          c.entry && c.hp ? h('div', { class: 'in-hprow' }, ...[-10, -5, -1].map((d) => h('button', { class: 'hpb dmg', onclick: () => act('init', { do: 'hp', id: c.entry, delta: d }) }, String(d))),
            h('output', {}, `${c.hp.cur ?? '–'} / ${c.hp.max ?? '–'}`), ...[1, 5, 10].map((d) => h('button', { class: 'hpb heal', onclick: () => act('init', { do: 'hp', id: c.entry, delta: d }) }, `+${d}`))) : null,
          h('div', { class: 'trow' }, h('div', {}, 'Inspiration'), h('button', { class: `sw ${c.insp ? 'on' : ''}`, 'aria-label': 'Inspiration', onclick: () => charDo(c.name, { insp: !c.insp }) })),
          h('div', { class: 'trow' }, h('div', {}, 'Exhaustion'), h('div', { class: 'in-step' }, h('button', { class: 'ib', disabled: !c.exh, onclick: () => charDo(c.name, { exh: c.exh - 1 }) }, ic('minus')), h('b', {}, String(c.exh)), h('button', { class: 'ib', disabled: c.exh >= 6, onclick: () => charDo(c.name, { exh: c.exh + 1 }) }, ic('plus')))),
          h('div', { class: 'trow' }, h('div', {}, 'Death saves'), h('div', { class: 'in-ticks' }, ic('heart'), tick('s', 0), tick('s', 1), tick('s', 2), ic('skull'), tick('f', 0), tick('f', 1), tick('f', 2))),
          c.languages ? h('div', { class: 'in-txt' }, h('b', {}, 'Languages'), h('p', {}, c.languages)) : null,
          c.senses || c.dark ? h('div', { class: 'in-txt' }, h('b', {}, 'Senses'), h('p', {}, [c.dark ? `Darkvision ${c.dark} ft` : null, c.senses || null].filter(Boolean).join(' · '))) : null,
          c.notes ? h('div', { class: 'in-txt' }, h('b', {}, 'Notes'), h('p', {}, c.notes)) : null);
      };
      const sh = sheet(name, body);
      detailFill = fill; detailClose = sh.close;
      fill();
    }
    let detailFill = null; let detailClose = null;
    function draw(list) {
      last = list;
      const s = JSON.stringify(list);
      if (s === sig) return;
      sig = s;
      put(row, ...(list.length ? list.map(card) : [h('p', { class: 'muted' }, 'Nobody here today (campaign page → Players on the PC).')]));
      if (detailFill && document.querySelector('.sheet-back')) detailFill(); else detailFill = null;
    }
    return { draw };
  }

  // a picture when there is none: the first letter on a colour of its own
  function initial(name, cls) {
    const s = String(name || '?');
    let hsh = 0; for (const ch of s) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    return h('div', { class: `${cls} initial`, style: `--hue:${hsh % 360}` }, h('span', {}, (s.trim()[0] || '?').toUpperCase()));
  }
  const svgOf = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstElementChild; };
  const arrowShape = () => svgOf('<svg class="st-shape" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M2 14 H160 V3 L198 30 L160 57 V46 H2 Z" vector-effect="non-scaling-stroke"/></svg>');
  const silhouette = () => {
    const t = document.createElement('template');
    t.innerHTML = '<svg class="sil" viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="42" r="22"/><path d="M8 120 C10 86 30 72 50 72 C70 72 90 86 92 120 Z"/></svg>';
    return t.content.firstElementChild;
  };

  // ================================================================ players: the player screen, and (Prototype 2) the controller
  // The PC's own player screen (a window on another screen) shows the party, in a fight the turn order, as before.
  // A phone that scanned the players' code is a controller: pick your character, find your seat, then a stick
  // moves its token on the TV. The rules sit in the PC (players.js); the phone shows what it may do right now
  // (S.ctl.me), tells the PC where the stick points (act('aim')) and asks for the step when it is let go (act('move')).
  function PlayerView() {
    app.className = 'players';
    const head = h('header', { class: 'pl-head' });
    const row = h('div', { class: 'pl-row' });
    const more = h('button', { class: 'pl-more', 'aria-label': 'More', onclick: openMenu }, ic('dots'));
    const ctlEl = h('section', { class: 'ctl', hidden: true });
    // Prototype 26: handouts the DM lets this player look at: a button with their number, a tap shows one big
    const hoBtn = h('button', { class: 'pl-ho', hidden: true, 'aria-label': 'Handouts', onclick: () => openHandouts() }, ic('script'), h('b', {}, ''));
    let hos = []; let hoKnown = null;
    function showHandout(x) {
      const img = h('img', { src: faceSrc(x.url), alt: x.name, draggable: false });
      const view = h('div', { class: 'ho-view', role: 'dialog', 'aria-label': x.name },
        img, h('div', { class: 'ho-cap' }, h('span', {}, x.name), h('button', { class: 'ho-x', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); view.remove(); } }, ic('x'))));
      img.addEventListener('click', () => view.classList.toggle('zoom')); // a tap: full size to read it, another: the whole of it again
      img.addEventListener('error', () => { view.remove(); toast('The handout could not be loaded'); });
      for (const old of document.querySelectorAll('.ho-view')) old.remove();
      document.body.append(view);
    }
    function openHandouts() {
      if (!hos.length) return;
      if (hos.length === 1) { showHandout(hos[0]); return; }
      const sheet = h('div', { class: 'ho-list', role: 'dialog', 'aria-label': 'Handouts', onclick: (e) => { if (e.target === sheet) sheet.remove(); } },
        h('div', { class: 'ho-sheet' }, h('h2', {}, 'Handouts'),
          ...hos.map((x) => h('button', { class: 'ho-row', onclick: () => { sheet.remove(); showHandout(x); } },
            h('img', { src: faceSrc(x.url), alt: '', draggable: false }), h('span', {}, x.name))),
          h('button', { class: 'pbtn', onclick: () => sheet.remove() }, 'Close')));
      for (const old of document.querySelectorAll('.ho-list')) old.remove();
      document.body.append(sheet);
    }
    function drawHandouts(list) {
      list = Array.isArray(list) ? list : [];
      const names = list.map((x) => x.name);
      // a new one since the last state: a word about it (not for what was there when the phone joined)
      if (hoKnown) { const fresh = list.find((x) => !hoKnown.has(x.name)); if (fresh) toast(`New handout: ${fresh.name}`); }
      hoKnown = new Set(names);
      hos = list;
      hoBtn.hidden = !list.length;
      hoBtn.lastChild.textContent = list.length > 1 ? String(list.length) : '';
      if (!list.length) for (const el of document.querySelectorAll('.ho-view, .ho-list')) el.remove(); // (taken back)
    }
    put(app, head, row, ctlEl, more, hoBtn);
    let showT = 0;
    document.addEventListener('pointerdown', () => { more.classList.add('show'); clearTimeout(showT); showT = setTimeout(() => more.classList.remove('show'), 3000); });
    const Ctl = Controller(ctlEl);
    let ctlSig = '';
    function drawCtl(st) {
      const C = st.ctl;
      const want = !!C; // (the PC's own screen has none: it shows the party)
      app.classList.toggle('with-ctl', want);
      head.hidden = want; row.hidden = want; ctlEl.hidden = !want;
      if (!want) return;
      const cs = JSON.stringify(C); if (cs !== ctlSig) { ctlSig = cs; Ctl.draw(C); }
    }
    let sig = '';
    const cardEls = new Map(); // key → element (kept, so a turn change slides them)
    function card(c, idle) {
      const pic = c.face ? h('img', { class: 'pic', src: faceSrc(c.face), alt: '', draggable: false, onerror: (e) => e.target.replaceWith(initial(c.name, 'pic')) })
        : c.known === false ? h('div', { class: 'pic unknown' }, silhouette()) : initial(c.name, 'pic');
      return h('div', { class: `card ${c.pc ? 'pc' : 'foe'} ${c.known === false ? 'hid' : ''} ${idle ? 'idle' : ''}`, style: c.color ? `--pcc:${c.color}` : '' },
        h('div', { class: 'frame' }, pic, c.count ? h('b', { class: 'count' }, `×${c.count}`) : null),
        h('div', { class: 'nm' }, h('span', {}, c.name)));
    }
    function draw(st) {
      drawCtl(st);
      drawHandouts(st.handouts);
      const F = st.fight;
      const s = JSON.stringify({ ...st, ctl: undefined });
      if (s === sig) return;
      sig = s;
      app.classList.toggle('fight', !!F);
      if (!F) {
        cardEls.clear();
        put(head, h('h1', {}, st.campaign || 'Tablescape'));
        put(row, ...(st.party || []).map((p) => card({ ...p, pc: true, known: true }, true)));
        if (!(st.party || []).length) put(row, h('p', { class: 'pl-empty' }, st.campaign ? 'The party shows here (players on the campaign page).' : 'Waiting for the GM …'));
        return;
      }
      put(head, h('div', { class: 'round' }, h('small', {}, 'Round'), h('b', {}, F.round != null ? String(F.round) : '–')));
      // FLIP: where each card was, then where it goes, then it slides there
      const before = new Map([...cardEls].map(([k, el]) => [k, el.getBoundingClientRect()]));
      const keep = new Map();
      const els = F.cards.map((c, i) => {
        const sigC = JSON.stringify(c);
        let el = cardEls.get(c.key);
        if (!el || el.dataset.sig !== sigC) { const n = card(c, false); if (el) n.dataset.was = '1'; el = n; el.dataset.sig = sigC; }
        el.classList.toggle('cur', !!c.cur);
        el.classList.toggle('next', i === 1);
        el.style.setProperty('--i', i);
        keep.set(c.key, el);
        return el;
      });
      put(row, els);
      cardEls.clear(); for (const [k, el] of keep) cardEls.set(k, el);
      for (const [k, el] of keep) {
        const a = before.get(k);
        if (!a) { el.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' }); continue; }
        const b = el.getBoundingClientRect();
        const dx = a.left - b.left; const dy = a.top - b.top;
        if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(a.width - b.width) < 1) continue;
        el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`, transformOrigin: 'top left' }, { transform: 'none', transformOrigin: 'top left' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      if (!F.cards.length) put(row, h('p', { class: 'pl-empty' }, 'The fight goes on …'));
    }
    return { draw };
  }

  // ---------------------------------------------------------------- Prototype 2: the controller
  const DIR8 = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']; // clockwise from the top of the TV
  const WHY = { off: 'The DM has not switched on moving by phone yet', noMap: 'Nothing is on the table yet', noToken: 'Your token is not on this map', paused: 'Paused by the DM', hex: 'Hex grids come later', spent: 'No movement left this turn' };
  const norm = (a) => ((a % 360) + 360) % 360;
  // the stick: push from the middle, the direction snaps to one of eight; let go to act
  //   o.onAim(deg | null) while it moves (deg: 0 = up on the phone, clockwise), o.onRelease(deg | null)
  function Stick(o) {
    const knob = h('div', { class: 'knob' });
    const el = h('div', { class: 'stick' }, h('div', { class: 'stick-ring' }, ...DIR8.map((d, i) => h('i', { class: 'stick-tick', style: `--a:${i * 45}deg` }))), knob);
    let pid = null; let R = 0; let cx = 0; let cy = 0; let cur = null; let raw = 0; let keep = 0;
    const set = (deg) => { if (deg === cur) return; cur = deg; for (const t of el.querySelectorAll('.stick-tick')) t.classList.toggle('on', deg != null && Number(t.style.getPropertyValue('--a').replace('deg', '')) === deg); o.onAim(deg); };
    const place = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    const move = (e) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - cx; const dy = e.clientY - cy; const r = Math.hypot(dx, dy);
      const k = r > R ? R / r : 1; place(dx * k, dy * k);
      if (r < R * 0.32) { set(null); return; }
      raw = norm(Math.atan2(dx, -dy) * 180 / Math.PI);
      set(norm(Math.round(raw / 45) * 45));
    };
    const end = (e) => {
      if (pid == null || (e && e.pointerId !== pid)) return;
      pid = null; clearInterval(keep); keep = 0;
      el.classList.remove('live'); place(0, 0);
      const was = cur; cur = null; for (const t of el.querySelectorAll('.stick-tick')) t.classList.remove('on');
      o.onRelease(was, raw);
    };
    el.addEventListener('pointerdown', (e) => {
      if (pid != null || el.classList.contains('off')) return;
      e.preventDefault(); pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch {}
      const b = el.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2; R = b.width / 2 - knob.offsetWidth / 2 - 26; // (the knob stops short of the rim: the direction marks stay in view)
      el.classList.add('live');
      clearInterval(keep); keep = setInterval(() => { if (cur != null) o.onAim(cur); }, 1500); // (the TV forgets an aim it hasn't heard of for a while)
      move(e);
    });
    el.addEventListener('pointermove', move);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return { el, cancel: () => end({ pointerId: pid }), get busy() { return pid != null; } };
  }
  function Controller(root) {
    let C = null; let me = null;
    let errAt = 0; let restT = 0; let turnKey = null;
    let seat = ls.get(KEYS.seat) == null ? null : Number(ls.get(KEYS.seat)); // where the TV's top edge is from this seat (deg on the phone)
    const fail = (r) => { if (Date.now() - errAt > 1400) { errAt = Date.now(); if (r && r.error) toast(r.error); } }; // (Prototype 8: the phone never buzzes)
    const face = (c, cls) => (c.face ? h('img', { class: cls, src: faceSrc(c.face), alt: '', draggable: false, onerror: (e) => e.target.replaceWith(initial(c.name, cls)) }) : initial(c.name, cls));
    const dirOf = (deg) => DIR8[norm(deg - (seat || 0)) / 45];

    // ----- who are you?
    function pick(chars) {
      root.className = 'ctl pick';
      put(root, h('h2', {}, 'Who are you?'),
        h('p', { class: 'muted' }, chars.length ? 'Your token on the table follows this phone.' : 'The party shows here once the DM has players on the campaign page.'),
        h('div', { class: 'pick-grid' }, ...chars.map((c) => h('button', { class: `pick-card ${c.taken ? 'taken' : ''}`, style: c.color ? `--pcc:${c.color}` : '', onclick: async () => {
          if (c.taken) { toast(`${c.name} is already on ${c.taken}`); return; }
          const r = await act('pick', { name: c.name }).catch(() => null); if (!r || r.ok === false) fail(r);
        } }, h('div', { class: 'frame' }, face(c, 'pic')), h('b', {}, c.name), c.taken ? h('small', {}, `on ${c.taken}`) : null))));
    }

    // ----- where do you sit? the TV's top edge glows; push the stick toward it
    let calibrating = false;
    function calibrate() {
      calibrating = true;
      root.className = 'ctl calib';
      act('calib', { on: true }).catch(() => null);
      // a long side gives 0 or 180, an end 90 or 270; a corner seat its diagonal (only when clearly pushed that way)
      const stick = Stick({ onAim: () => {}, onRelease: (deg, raw) => { if (deg == null) return; const q = norm(Math.round(raw / 90) * 90); done(Math.abs(norm(raw - q + 180) - 180) <= 30 ? q : deg); } });
      const done = (deg) => {
        seat = deg; ls.set(KEYS.seat, String(seat)); calibrating = false;
        act('calib', { on: false }).catch(() => null);
        toast('Seat set: up on the phone is away from you on the table');
        if (C) draw(C, true);
      };
      put(root, h('h2', {}, 'Where do you sit?'),
        h('p', { class: 'muted' }, 'The top edge of the TV is glowing. Push the stick toward that edge and let go.'),
        stick.el,
        h('button', { class: 'pbtn', onclick: () => done(0) }, h('span', {}, 'Skip (it is away from me)')));
    }

    // ----- the drive
    let stick = null; let centre = null; let status = null; let acts = null; let who = null;
    function build() {
      who = h('div', { class: 'ctl-who' });
      status = h('div', { class: 'ctl-status' });
      centre = h('div', { class: 'stick-centre' });
      stick = Stick({
        onAim: (deg) => act('aim', { dir: deg == null ? null : dirOf(deg) }).catch(() => null),
        onRelease: async (deg) => {
          if (deg == null) { act('aim', { dir: null }).catch(() => null); return; }
          if (!me || !me.can) { act('aim', { dir: null }).catch(() => null); fail({ error: me ? me.error || WHY[me.why] : null }); return; }
          const r = await act('move', { dir: dirOf(deg) }).catch(() => null);
          if (!r || r.ok === false) fail(r);
        },
      });
      stick.el.append(centre);
      acts = h('div', { class: 'ctl-acts' });
    }
    function drawCentre() {
      if (!me) return;
      const now = Date.now();
      clearTimeout(restT); restT = 0;
      if (me.fight && me.fight.mine) {
        put(centre, h('b', {}, String(me.fight.left)), h('small', {}, `of ${me.fight.max} ft`));
        centre.className = `stick-centre fight ${me.fight.left < 5 ? 'spent' : ''}`;
        return;
      }
      if (me.restUntil && me.restUntil > now) {
        const left = Math.ceil((me.restUntil - now) / 1000);
        put(centre, h('b', {}, String(left)), h('small', {}, 'rest'));
        centre.className = 'stick-centre rest';
        centre.style.setProperty('--p', `${Math.max(0, Math.min(1, (me.restUntil - now) / (me.rest * 1000)))}`);
        restT = setTimeout(drawCentre, 200);
        return;
      }
      centre.className = `stick-centre ${me.can ? 'go' : 'no'}`;
      put(centre, ic(me.can ? 'walk' : me.why === 'paused' ? 'player-pause' : me.why === 'turn' ? 'hourglass' : 'hand-stop'));
    }
    function statusText() {
      if (!me.token) return WHY.noToken;
      if (me.why === 'turn' && me.fight) return `${me.fight.who}'s turn · wait`;
      if (me.why === 'rest') return 'Catch your breath …';
      if (me.why === 'spent' && me.error) return me.error; // (Dash? an extra move? or nothing left)
      if (me.why && WHY[me.why]) return WHY[me.why];
      if (me.fight && me.fight.mine) { const t = me.fight.group ? 'Everyone moves' : 'Your turn'; return me.fight.left >= 5 ? `${t} · ${me.fight.left} ft left` : `${t} · no movement left`; }
      return me.can ? 'Push the stick, let go: one square' : me.error || '…';
    }
    const ab = (icn, label, on, cls = '') => h('button', { class: `abtn ${cls}`, onclick: async () => { const r = await on(); if (r && r.ok === false) fail(r); } }, ic(icn), h('span', {}, label));
    function draw(ctl, force) {
      C = ctl;
      if (!C.on && !C.me) { root.className = 'ctl wait'; put(root, h('div', { class: 'msg' }, h('h2', {}, 'Tablescape'), h('p', {}, 'Waiting for the DM to switch on moving by phone …'))); return; }
      if (!C.me) { me = null; pick(C.chars || []); return; }
      if (calibrating && !force) return;
      if (seat == null) { calibrate(); return; }
      if (!stick) build();
      if (who.parentNode !== root) { root.className = 'ctl drive'; put(root, who, status, stick.el, acts); turnKey = null; }
      me = C.me;
      root.classList.toggle('can', !!me.can);
      put(who, h('div', { class: 'ctl-face', style: me.color ? `--pcc:${me.color}` : '' }, face(me, 'pic')), h('div', { class: 'ctl-names' }, h('b', {}, me.name)));
      status.textContent = statusText();
      status.className = `ctl-status ${me.can ? 'ok' : me.why || ''}`;
      stick.el.classList.toggle('off', !me.token);
      drawCentre();
      const R = me.rules;
      put(acts,
        me.fight && me.fight.mine ? ab('run', me.fight.dashed ? 'Dashed' : 'Dash', () => act('dash'), me.fight.dashed ? 'done' : 'dash') : null,
        // (Prototype 8) the character card's extra moves: Cunning Action and the like, once a turn each
        ...(me.fight && me.fight.mine ? (me.fight.extras || []).map((x) => ab('bolt', x.used ? x.name : `${x.name} +${x.ft}`, () => act('extra', { i: x.i }), x.used ? 'done' : 'dash')) : []),
        R.pings && me.token ? ab('target', 'Ping', () => act('point')) : null,
        ab('compass', 'Seat', () => { calibrate(); return { ok: true }; }, 'seat'));
      // Prototype 6: your turn: the edge of the screen pulses in your colour for as long as it lasts; when it starts,
      // the phone says so in large letters for a moment (Prototype 8: no buzz; no pulse while the whole group moves)
      const mine = !!(me.fight && me.fight.mine);
      root.classList.toggle('my-turn', mine && !me.fight.group);
      root.style.setProperty('--pcc', me.color || '#e3963e');
      const key = mine ? me.fight.key : null;
      if (key && key !== turnKey) {
        const b = h('div', { class: 'turn-banner' }, h('b', {}, me.fight.group ? 'Move' : 'Your turn'), h('span', {}, `${me.fight.left} ft`));
        root.append(b); setTimeout(() => b.remove(), 2300);
      }
      turnKey = key;
    }
    return { draw };
  }

  boot();
})();
