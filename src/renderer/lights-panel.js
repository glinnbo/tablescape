// Toolbox → Room lights (Beta 3.3): the control panel for the evening.
//   modes    Table (ambience from the TV, effects) / Scene / Room light / Off (4.4: switched off) / Let go (back as they were);
//            each can go on the hotbar
//   sliders  Brightness (4.5: with −20 % / +20 % buttons, also for the hotbar and the phone), Effects (0: none)
//   scenes   light scenes of your own: click to show, right-click to change, rename, delete or put on the hotbar
//   lamps    the groups (folded away); Setup … (lights-setup.js) and Fine-tuning … (Test and tune, below)
// main.js / roomlights.js do the talking; S().lights is what they know.
'use strict';

const LightsPanel = (() => {
  const { h, iconEl, toast, dialog, openMenu } = UI;
  const KIND = { lan: ['wifi', 'Govee on your network'], cloud: ['cloud', 'Govee cloud (about a second late, no flashes)'], ikea: ['router', 'IKEA gateway (fades, no flashes)'] };

  function create(ctx) {
    const S = () => ctx.state();
    const c = () => ctx.ctl;
    const L = () => S().lights || { lamps: [], lan: {}, cloud: {}, ikea: {} };
    const act = async (a, p) => { const r = await window.ts.lights(a, p); if (r && r.error) toast(r.error, { kind: 'error', ms: 5000 }); ctx.refresh(); return r; };

    const Setup = LightsSetup.create({ state: () => ctx.state(), refresh: () => ctx.refresh(), ctl: ctx.ctl, openTune: () => openTune() });
    const MODES = [
      { id: 'follow', label: 'Table', icon: 'device-tv', tip: 'Ambience follows the TV, Effects flash with the game' },
      { id: 'scene', label: 'Lamp scene', icon: 'palette', tip: 'A lamp scene of your own (pick one below); Effects still flash' },
      { id: 'room', label: 'Room light', icon: 'bulb', tip: 'Normal warm light, no effects' },
      { id: 'off', label: 'Off', icon: 'bulb-off', tip: 'All lamps off (pick another mode to light them again)' },
      { id: 'release', label: 'Let go', icon: 'power', tip: 'The lamps go back to how they were before the game' },
    ];
    function buildPanel() {
      act('start'); // the first opening starts it (nothing on the network before)
      // nothing set up yet: one big button
      const first = h('div', { class: 'rl-first' },
        iconEl('bulb'), h('b', {}, 'Lamps around the table'),
        h('p', { class: 'hint' }, 'Govee and IKEA lamps follow the TV\'s colours and flash with effects.'),
        c().btn('Set up room lights', 'wand', () => Setup.openSetup(), { kind: 'primary wide' }));
      const main = h('div', { class: 'stack' });
      c().bind(() => { const v = L(); const none = !(v.lamps || []).length && !v.setupDone; first.hidden = !none; main.hidden = none; });

      // the four modes (each one can go on the hotbar)
      const modes = h('div', { class: 'rl-modes' }, ...MODES.map((m) => {
        const b = h('button', { class: 'rl-mode', dataset: { m: m.id }, 'data-tip': m.tip, onclick: () => {
          if (m.id === 'scene') { const v = L(); const sc = (v.scenes || []).find((x) => x.id === v.lastScene) || (v.scenes || [])[0]; if (sc) act('mode', { mode: 'scene', sceneId: sc.id }); else Setup.openScene(); return; }
          act('mode', { mode: m.id });
        } }, iconEl(m.icon), h('span', {}, m.label));
        return m.id === 'scene' ? b : Hotbar.offer(b, { kind: 'lights', ref: m.id, label: m.id === 'follow' ? 'Lights: table' : m.id === 'room' ? 'Room light' : m.id === 'release' ? 'Lights: let go' : 'Lights off', icon: m.icon });
      }));
      c().bind(() => { const md = L().mode; for (const b of modes.children) b.classList.toggle('on', b.dataset.m === md); });

      // the scenes: click one to show it; right-click to change, rename, delete or put it on the hotbar
      const scenes = h('div', { class: 'rl-scenes' });
      c().bind(() => {
        const v = L();
        const sig = JSON.stringify([v.scenes, v.sceneId]);
        if (scenes.dataset.sig === sig) return;
        scenes.dataset.sig = sig;
        scenes.replaceChildren(...(v.scenes || []).map((x) => {
          const item = { kind: 'lights', ref: x.id, label: x.name, icon: 'palette' };
          const el = Hotbar.offer(h('button', { class: `rl-scene ${v.sceneId === x.id ? 'on' : ''}`, 'data-tip': `${x.name}: click to show it, right-click for more`, onclick: () => act('mode', v.sceneId === x.id ? { mode: 'follow' } : { mode: 'scene', sceneId: x.id }),
            oncontextmenu: (e) => { e.preventDefault(); UI.openMenu(e.clientX, e.clientY, [
              { icon: 'pencil', label: 'Change the scene', action: () => Setup.openScene(x.id) },
              { icon: 'pencil', label: 'Rename', action: async () => { const n = await UI.askText('Rename the scene', x.name, { ok: 'Rename' }); if (n) act('scene.rename', { id: x.id, name: n }); } },
              Hotbar.menuItem(item),
              { icon: 'trash', label: 'Delete', action: () => act('scene.delete', { id: x.id }) },
            ]); } },
          h('span', { class: 'rl-dots' }, ...(x.colors.length ? x.colors : ['#555']).map((cl) => h('i', { style: `background:${cl}` }))), h('span', { class: 'ellipsis' }, x.name)), item, { menu: false });
          return el;
        }), h('button', { class: 'rl-scene rl-scene-new', 'data-tip': 'Give the lamps colours by hand and keep them as a scene', onclick: () => Setup.openScene() }, iconEl('plus'), h('span', {}, 'New scene')));
      });

      // the lamps and their groups (folded away)
      const groups = h('div');
      c().bind(() => {
        const v = L();
        const sig = JSON.stringify([(v.lamps || []).map((x) => [x.id, x.name, x.fx, x.amb, x.online]), v.ambience]);
        if (groups.dataset.sig === sig) return;
        groups.dataset.sig = sig;
        groups.replaceChildren(Setup.groupsEl(v));
      });
      const flashNote = h('div', { class: 'rl-note' }, iconEl('eye-off'), h('span', {}, 'No flashing is on: effects are soft swells'));
      c().bind(() => { flashNote.hidden = !L().noFlash; });

      main.append(
        modes,
        h('div', { class: 'rl-bright' },
          c().slider({ label: 'Brightness', min: 0.05, max: 1, step: 0.05, get: () => L().brightness, set: (x) => act('set', { brightness: x }), fmt: (x) => `${Math.round(x * 100)}%` }),
          // 4.5: one press, a little darker or brighter (also on the hotbar and the phone)
          ...[['dim', 'brightness-down', '−20%', 'A little darker: −20 %'], ['bright', 'brightness-up', '+20%', 'A little brighter: +20 % (while the lamps are off: on again at 20 %)']].map(([ref, ic, lab, tip]) =>
            Hotbar.offer(h('button', { class: 'btn small rl-step', dataset: { ref }, 'data-tip': tip, 'aria-label': tip, onclick: () => act('bright.step', { by: ref === 'dim' ? -0.2 : 0.2 }) }, iconEl(ic), h('span', {}, lab)),
              { kind: 'lights', ref, label: ref === 'dim' ? 'Lights −20%' : 'Lights +20%', icon: ic }))),
        c().slider({ label: 'Effects', min: 0, max: 1, step: 0.05, get: () => L().fxStrength, set: (x) => act('set', { fxStrength: x }), fmt: (x) => (x < 0.02 ? 'Off' : `${Math.round(x * 100)}%`) }),
        flashNote,
        h('div', { class: 'ctl-label' }, 'Lamp scenes'), scenes,
        h('details', { class: 'rl-connect' }, h('summary', {}, 'Lamps and groups'), groups),
        c().row(c().btn('Setup …', 'wand', () => Setup.openSetup(), { kind: 'small', tip: 'Find and connect lamps, place them in the room, groups, try it' }),
          c().btn('Fine-tuning …', 'adjustments', () => openTune(), { kind: 'small ghost', tip: 'Time-of-day colours, each effect on or off, lamps by hand' })));
      return h('div', { class: 'stack rl-panel' }, first, main);
    }

    // =====================================================================
    // Test and tune: a window to set each lamp by hand, give each mood its own colour and try every effect.
    // Lamps set by hand stay so until "Back to the game" or until the window closes.
    // =====================================================================
    const later = (fn, ms = 120) => { let t = 0; let last = null; return (...a) => { last = a; if (t) return; t = setTimeout(() => { t = 0; fn(...last); }, ms); }; };
    let tuneTab = 'lamps';
    function openTune() {
      const body = h('div', { class: 'rl-tune' });
      const tabs = h('div', { class: 'seg rl-tabs', role: 'tablist' });
      const pane = h('div', { class: 'rl-pane' });
      body.append(tabs, pane);
      let T = null;
      const load = async () => { const r = await window.ts.lights('tune'); T = r && r.tune; draw(); };
      const call = async (a, p, reload = false) => { const r = await window.ts.lights(a, p); if (r && r.error) toast(r.error, { kind: 'error' }); if (reload) await load(); return r; };
      function drawTabs() {
        tabs.replaceChildren(...[['lamps', 'Lamps', 'bulb'], ['moods', 'Moods', 'moon'], ['effects', 'Effects', 'bolt']].map(([id, label, ic]) =>
          h('button', { class: `seg-btn ${tuneTab === id ? 'on' : ''}`, role: 'tab', onclick: () => { tuneTab = id; draw(); } }, iconEl(ic), h('span', {}, label))));
      }
      const slider = (label, min, max, value, onInput, fmt = (v) => `${v}%`) => {
        const out = h('output', {}, fmt(value));
        const input = h('input', { type: 'range', min, max, step: 1, value, 'aria-label': label });
        input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
        return h('label', { class: 'rl-sl' }, h('span', {}, label), input, out);
      };
      function lampsTab() {
        const ls = T.lampsFull || [];
        if (!ls.length) return [hint('No lamps yet: connect them in the Room lights panel.')];
        return [
          hint('Try a lamp by hand. Brightest and Darkest also limit it in the game.'),
          ...ls.map((x) => {
            const send = later((p) => call('hold', { id: x.id, ...p }));
            const on = h('input', { type: 'checkbox', role: 'switch', checked: x.on, 'aria-label': `${x.name} on` });
            on.addEventListener('change', () => { call('hold', { id: x.id, on: on.checked }); back.hidden = false; });
            const col = h('input', { type: 'color', value: x.rgb, 'aria-label': `Colour of ${x.name}` });
            const back = h('button', { class: 'btn small ghost', hidden: !x.held, onclick: async () => { await call('release', { id: x.id }); back.hidden = true; } }, iconEl('arrow-back-up'), 'Back to the game');
            col.addEventListener('input', () => { send({ rgb: col.value }); back.hidden = false; });
            const lim = later((p) => call('lamp', { id: x.id, ...p }), 250);
            return h('div', { class: `rl-trow ${x.online ? '' : 'off'}` },
              h('div', { class: 'rl-thead' },
                h('b', { class: 'ellipsis' }, x.name), h('small', {}, `${x.sku || ''} · ${[x.fx ? 'Effects' : null, x.amb ? 'Ambience' : null].filter(Boolean).join(' + ') || 'not used'}`),
                h('span', { class: 'grow' }), back,
                h('label', { class: 'ctl-toggle rl-sw' }, on, h('span', { class: 'switch' }))),
              h('div', { class: 'rl-tgrid' },
                h('label', { class: 'rl-col' }, h('span', {}, 'Colour'), col),
                slider('Brightness', 1, 100, x.bri, (v) => { send({ bri: v }); back.hidden = false; }),
                slider('Brightest', 5, 100, x.max, (v) => lim({ max: v })),
                slider('Darkest', 1, 60, x.min, (v) => lim({ min: v })),
                null));
          }),
          h('div', { class: 'ctl-row' }, h('span', { class: 'grow' }), c().btn('All back to the game', 'arrow-back-up', () => call('release', {}, true), { kind: 'small' })),
        ];
      }
      function moodsTab() {
        return [
          hint('The Ambience lamps in each situation. A change shows on the lamps for a few seconds.'),
          h('div', { class: 'rl-moods' }, ...(T.looks || []).map((m) => {
            const save = later((p) => call('look', { id: m.id, ...p }), 200);
            const col = h('input', { type: 'color', value: m.rgb, 'aria-label': `Colour for ${m.label}` });
            const reset = h('button', { class: 'icon-btn', hidden: !m.custom, 'aria-label': `${m.label}: back to the automatic colour`, 'data-tip': 'Back to the automatic colour', onclick: async () => { await call('look', { id: m.id, reset: true }, true); } }, iconEl('rotate-2'));
            col.addEventListener('input', () => { save({ rgb: col.value }); reset.hidden = false; });
            return h('div', { class: `rl-mood ${T.preview === m.id ? 'on' : ''}` },
              h('b', {}, m.label), col,
              slider('', 1, 100, m.bri, (v) => { save({ bri: v }); reset.hidden = false; }),
              c().btn('Try', 'player-play', () => call('preview', { id: m.id }), { kind: 'small' }), reset);
          })),
        ];
      }
      function effectsTab() {
        const spells = Object.entries(FXDATA.SKINS).slice(0, 8);
        return [
          hint('Try plays it on the Effects lamps. Switched off, the game no longer flashes it.'),
          h('div', { class: 'rl-fx' }, ...(T.effects || []).map((f) => {
            const sw = h('input', { type: 'checkbox', role: 'switch', checked: f.on, 'aria-label': `${f.label} in the game` });
            sw.addEventListener('change', () => call('fx', { id: f.id, on: sw.checked }));
            const tryIt = f.id === 'spell'
              ? h('div', { class: 'rl-spells' }, ...spells.map(([id, sk]) => h('button', { class: 'rl-sk', style: `--c:${sk.c}`, 'data-tip': `Try: ${sk.label}`, 'aria-label': `Try ${sk.label}`, onclick: () => call('try', { fx: 'spell', color: sk.c }) })))
              : c().btn('Try', 'player-play', () => call('try', { fx: f.id }), { kind: 'small' });
            return h('div', { class: 'rl-fxrow' }, h('b', {}, f.label), tryIt, h('label', { class: 'ctl-toggle rl-sw' }, sw, h('span', { class: 'switch' })));
          })),
        ];
      }
      const hint = (t) => h('p', { class: 'hint' }, t);
      function draw() {
        drawTabs();
        if (!T) { pane.replaceChildren(UI.loader('Asking the lamps …')); return; }
        pane.replaceChildren(...(tuneTab === 'lamps' ? lampsTab() : tuneTab === 'moods' ? moodsTab() : effectsTab()));
      }
      draw();
      load();
      dialog('Room lights: fine-tuning', body, { wide: true, onClose: () => { window.ts.lights('release', {}); } });
    }
    return { buildPanel };
  }
  return { create };
})();
