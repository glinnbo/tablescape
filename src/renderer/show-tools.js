// Running the show:
//   Moments  screen effects over the whole TV (moments.js), played with a click like the soundboard (a Toolbox panel).
//            Starred ones come first and play with Shift + 1 to 9; some can go where you click on the map;
//            each plays a sound (one you pick, one from Audio/SFX with a fitting name, or the built-in one).
//   Cues     (before 2.1) a scene saved to play again; snapshots.js took their place, old ones still play.
// gm-play.js opens the panels as floating windows (float-panels.js).
'use strict';

const ShowTools = (() => {
  const { h, iconEl, toast, openMenu, askText } = UI;
  const ts = window.ts;

  function create(ctx) {
    const { ui, cmd } = ctx;
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    let lib = []; let libAt = 0;
    async function loadLib(force) {
      if (!force && Date.now() - libAt < 5000) return;
      libAt = Date.now();
      try { lib = await ts.library('list'); } catch { lib = []; }
      ctx.refresh();
    }
    const soundboard = () => lib.filter((x) => x.cat === 'sounds' && (/^Audio\/SFX\//i.test(x.rel) || /\bsfx\b/i.test(x.rel)));

    // =====================================================================
    // Moments
    // =====================================================================
    const stars = () => (S().settings && S().settings.momentStars) || [];
    const playing = (id) => (S().moments || []).find((m) => m.id === id && !m.stop && Moments.alive(m, Date.now()));
    const starredList = () => stars().map((id) => Moments.BY[id]).filter(Boolean);
    async function play(id, at) {
      const d = Moments.BY[id];
      if (!d) return null;
      const r = await cmd('moment.play', { id, x: at ? at.x : null, y: at ? at.y : null });
      if (r && r.ok) {
        if (r.closed) toast(`${d.label}: the table is closed, so only you see it`, { ms: 3000 });
        else if (r.label) toast(r.label, { ms: 2200 });
      }
      return r;
    }
    function setStar(id, on) {
      const list = stars().filter((x) => x !== id);
      if (on) list.push(id);
      ts.settings({ momentStars: list });
    }
    function soundMenu(d, x, y) {
      const snd = (S().settings.momentSounds || {})[d.id] || {};
      openMenu(x, y, [
        { header: `Sound for ${d.label}: ${snd.name || 'Built-in'}` },
        { icon: 'folder', label: 'Choose a sound from the library …', action: () => ctx.Drawer.open({ cat: 'sounds', purpose: `moment:${d.id}`, back: { panel: 'moments' } }) },
        { icon: 'wand', label: d.id === 'lightning' ? 'Thunder (or a fitting sound from Audio/SFX)' : 'Automatic: a fitting sound from Audio/SFX, else the built-in one', checked: !snd.own && !snd.none, action: () => ts.settings({ momentSound: { id: d.id, path: null } }) },
        { icon: 'volume-off', label: 'No sound', checked: !!snd.none, action: () => ts.settings({ momentSound: { id: d.id, path: 'none' } }) },
      ]);
    }
    function momentRow(d, key) {
      const on = !!playing(d.id);
      const snd = (S().settings.momentSounds || {})[d.id] || {};
      const starOn = stars().includes(d.id);
      const tip = `${d.label}: ${d.tip}${d.dur ? '' : '. Click again to stop it'}`;
      return Hotbar.offer(h('div', { class: `sb-btn mo-row ${on ? 'on' : ''}`, role: 'button', tabindex: '0', dataset: { id: d.id, flash: `moment:${d.id}` }, 'data-tip': tip, 'data-key': key || null, 'aria-label': d.label,
        onclick: () => play(d.id), onkeydown: (e) => { if (e.key === 'Enter') play(d.id); } },
      iconEl(d.icon), h('span', { class: 'sb-name' }, d.label),
      on ? h('b', { class: 'mo-on' }, 'On') : null,
      d.spot ? h('button', { class: 'icon-btn mo-spot', 'aria-label': `${d.label} at a spot on the map`, 'data-tip': 'Click here, then on the map: it plays there', onclick: (e) => { e.stopPropagation(); ctx.aimMoment(d.id); } }, iconEl('target')) : null,
      h('button', { class: `icon-btn mo-snd ${snd.own ? 'on' : ''}`, 'aria-label': `Sound for ${d.label}`, 'data-tip': `Sound: ${snd.none ? 'none' : snd.name || 'built-in'}${snd.match ? ' (from Audio/SFX)' : ''}`, onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); soundMenu(d, r.left, r.bottom + 4); } }, iconEl(snd.none ? 'volume-off' : 'music')),
      h('button', { class: `sb-star ${starOn ? 'on' : ''}`, 'aria-label': starOn ? `Unstar ${d.label}` : `Star ${d.label}`, 'data-tip': starOn ? 'Starred: on top, and on Shift + a number' : 'Star it: on top, and on Shift + a number', onclick: (e) => { e.stopPropagation(); setStar(d.id, !starOn); } }, iconEl('star', starOn ? 'fill' : ''))), { kind: 'moment', ref: d.id, label: d.label, icon: d.icon });
    }
    function buildMoments() {
      loadLib();
      const list = h('div', { class: 'sb-list mo-list' });
      c().bind(() => {
        const s = S();
        const st = stars();
        const sig = JSON.stringify([st, (s.moments || []).filter((m) => !m.stop).map((m) => m.id), s.settings && s.settings.momentSounds]);
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = '';
        const starred = starredList();
        if (starred.length) {
          list.append(h('div', { class: 'tok-group' }, 'Starred'));
          starred.forEach((d, i) => list.append(momentRow(d, i < 9 ? `Shift ${i + 1}` : null)));
        }
        list.append(h('div', { class: 'tok-group' }, starred.length ? 'All screen effects' : 'Screen effects'));
        for (const d of Moments.LIST) if (!st.includes(d.id)) list.append(momentRow(d));
      });
      const stopAll = Hotbar.offer(c().btn('Stop all', 'player-stop', () => cmd('moment.stop', {}), { tip: 'Stop the screen effects that are on (gas, dread, frost …)' }), ctx.doHot('stop-moments'));
      c().bind(() => { stopAll.disabled = !(S().moments || []).some((m) => !m.stop); });
      return h('div', { class: 'stack' },
        c().slider({ label: 'Volume', min: 0, max: 1, step: 0.01, get: () => S().settings && S().settings.boardVolume, set: (v) => ts.settings({ boardVolume: v }), fmt: (v) => `${Math.round(v * 100)}%` }),
        list,
        c().row(stopAll));
    }

    // =====================================================================
    // Cues (before 2.1; snapshots.js took their place): the old ones still play from the Snapshots panel
    // =====================================================================
    const cues = () => (S().campaign && S().campaign.cues) || [];
    async function playCue(cq) {
      const r = await cmd('cue.play', { id: cq.id });
      if (r && r.ok) toast(`${cq.name}`, { ms: 1800, undo: () => cmd('history.undo') });
      else if (r && r.error) toast(r.error, { kind: 'error' });
    }

    return { buildMoments, play, starredList, playCue, cues, loadLib };
  }

  return { create };
})();
