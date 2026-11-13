// The sound window: everything the table hears, played in a hidden window of its own (its own
// process), so drawing lots of effects on the TV can't make the sound stutter.
// Two outputs, each its own audio context and so its own speaker:
//   ambience and music:  chapter ambience and the map's own sounds (looping with a crossfade at the
//                        loop point), fight music (while it plays, the ambience dips)
//   effects:             soundboard, spell sounds, thunder, the countdown's pulses and chimes
// Fades, crossfades, ducking (the ambience dips while an effect plays) and Quiet are gain ramps
// scheduled in the audio engine itself, so they stay smooth whatever else the computer is doing.
'use strict';

const SoundEngine = (() => {
  const ctx = new AudioContext({ latencyHint: 'playback' }); // ambience and music
  const fxCtx = new AudioContext({ latencyHint: 'interactive' }); // effects, as soon as they are asked for
  const bus = (to) => { const g = to.context.createGain(); g.connect(to); return g; };
  const master = bus(ctx.destination); // Quiet fades this to silence (and fxMaster)
  const duck = bus(master); // dips while an effect plays
  const music = bus(duck); // ambience and the map's sounds
  const fightBus = bus(duck); // fight music
  const fxMaster = bus(fxCtx.destination);
  const sfxBus = bus(fxMaster);
  const synth = Synth.make(fxCtx, sfxBus);
  let musicSynth = null; // only for Test on the ambience speaker
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, Number(v) || 0));
  const r2 = (v) => Math.round(v * 100) / 100;
  const nameOf = (url) => { try { return decodeURIComponent(String(url).split('/').pop()); } catch { return String(url); } };
  const wake = () => { for (const c of [ctx, fxCtx]) if (c.state === 'suspended') c.resume().catch(() => {}); };
  let S = null;
  const errors = [];
  const played = { board: [], spells: [], spellsOk: [], src: [], thunders: 0, synth: {}, ducks: 0, tests: { music: 0, fx: 0 } };

  // move a gain to a value over some seconds, starting from wherever it is right now
  // (anchored at now: a ramp otherwise starts from the last scheduled point, which may be long past)
  function ramp(param, value, secs, c = ctx) {
    const t = c.currentTime;
    const v = param.value;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
    param.linearRampToValueAtTime(value, t + Math.max(0.02, secs));
  }

  // ---------- looping sounds ----------
  // Fades in, fades out when it ends, and crossfades its own loop point, so a track that was not
  // made to loop neither clicks nor cuts off. Two players take turns.
  const looping = new Set(); // every track still sounding, checked a few times a second for its loop point
  class Track {
    constructor(key, url, out, { volume = 0.6, muted = false, fade = 2 } = {}) {
      Object.assign(this, { key, url, fade, voices: [], stopped: false, volume: clamp(volume), muted: !!muted });
      looping.add(this);
      this.out = ctx.createGain();
      this.out.gain.value = this.level();
      this.out.connect(out);
      this.voice();
    }
    level() { return this.muted ? 0 : this.volume; }
    set(volume, muted) {
      const v = clamp(volume); const m = !!muted;
      if (v === this.volume && m === this.muted) return;
      this.volume = v; this.muted = m;
      ramp(this.out.gain, this.level(), 0.3);
    }
    voice() {
      const el = new Audio();
      el.preload = 'auto';
      el.src = this.url;
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(el).connect(g).connect(this.out);
      const v = { el, g, live: true, handing: false };
      this.voices.push(v);
      // a short sound (or one whose length is unknown) simply loops
      el.addEventListener('loadedmetadata', () => { if (!(el.duration > this.fade * 3)) el.loop = true; });
      el.addEventListener('playing', () => {
        if (!v.live || this.stopped) return;
        ramp(g.gain, 1, this.fade);
        for (const o of this.voices) if (o !== v && o.live) this.retire(o, this.fade); // the one before fades out underneath
      }, { once: true });
      el.addEventListener('error', () => { errors.push(nameOf(this.url)); }, { once: true });
      wake();
      el.play().catch(() => {});
      return v;
    }
    retire(v, secs) {
      v.live = false;
      ramp(v.g.gain, 0, secs);
      setTimeout(() => this.drop(v), (secs + 0.3) * 1000);
    }
    drop(v) {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load();
      v.g.disconnect();
      this.voices = this.voices.filter((x) => x !== v);
    }
    // a few times a second: shortly before the end, the next round starts underneath and takes over
    check() {
      if (this.stopped) return;
      const cur = this.voices[this.voices.length - 1];
      if (!cur || cur.handing || cur.el.loop || !(cur.el.duration > this.fade * 3)) return;
      if (cur.el.currentTime >= cur.el.duration - this.fade - 0.6) { cur.handing = true; this.voice(); }
    }
    stop(secs = this.fade) {
      if (this.stopped) return;
      this.stopped = true;
      for (const v of this.voices) if (v.live) this.retire(v, secs);
      setTimeout(() => { this.out.disconnect(); looping.delete(this); }, (secs + 0.6) * 1000);
    }
    info() {
      const v = this.voices[this.voices.length - 1];
      return {
        key: this.key, name: nameOf(this.url), volume: this.volume, muted: this.muted, voices: this.voices.length,
        t: v ? r2(v.el.currentTime) : 0, playing: !!v && !v.el.paused && v.el.readyState >= 2, gain: v ? r2(v.g.gain.value) : 0, out: r2(this.out.gain.value),
      };
    }
  }

  // ---------- ducking: the ambience and fight music dip while an effect plays ----------
  let ducking = 0;
  function duckStart() {
    if (!S || S.duck === false) return () => {};
    ducking++;
    played.ducks++;
    if (ducking === 1) ramp(duck.gain, 0.35, 0.12);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      ducking = Math.max(0, ducking - 1);
      setTimeout(() => { if (!ducking) ramp(duck.gain, 1, 0.9); }, 250);
    };
  }

  // ---------- sounds played once: soundboard, spells, thunder ----------
  const board = new Set();
  function playOnce(url, volume, { onPlaying, isBoard = false } = {}) {
    wake();
    const el = new Audio();
    el.src = url;
    const g = fxCtx.createGain();
    g.gain.value = clamp(volume);
    fxCtx.createMediaElementSource(el).connect(g).connect(sfxBus);
    const it = { el, g };
    let release = null;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (release) release();
      board.delete(it);
      setTimeout(() => { el.removeAttribute('src'); el.load(); g.disconnect(); }, 100);
    };
    el.addEventListener('playing', () => { release = duckStart(); if (onPlaying) onPlaying(el); }, { once: true });
    el.addEventListener('ended', end, { once: true });
    el.addEventListener('error', () => { errors.push(nameOf(url)); end(); }, { once: true });
    if (isBoard) board.add(it);
    el.play().catch(end);
    it.end = end;
    return it;
  }
  function stopBoard() {
    for (const it of [...board]) { ramp(it.g.gain, 0, 0.25, fxCtx); setTimeout(() => { it.el.pause(); it.end(); }, 300); }
  }

  // a short sound when a spell is cast (or cast again) on the live map
  const heard = new Map(); // spell id -> t0 of the cast already heard
  let soundsFor = null;
  function spellSounds(s) {
    const spells = s.spells || [];
    const fresh = soundsFor !== s.mapId; // a new live map: its spells are already there, stay quiet
    soundsFor = s.mapId;
    const now = Date.now();
    for (const sp of spells) {
      if (heard.get(sp.id) === sp.t0) continue;
      heard.set(sp.id, sp.t0);
      if (fresh || !s.open || sp.hidden || sp.muted || s.blackout || !s.sfx || !s.sfx.on || now - sp.t0 > 2500) continue;
      const skin = FXDATA.SKINS[sp.skin] ? sp.skin : 'arcane';
      const url = (s.sfx.map && s.sfx.map[skin]) || `sfx/${skin}.ogg`; // the GM can give a look its own sound file
      played.spells.push(sp.skin);
      playOnce(url, s.sfx.volume ?? 0.7, { onPlaying: () => { played.spellsOk.push(sp.skin); played.src.push(nameOf(url)); } });
    }
    for (const id of heard.keys()) if (!spells.some((x) => x.id === id)) heard.delete(id);
  }

  // ---------- where the sound comes out: one speaker for ambience and music, one for effects ----------
  const outs = { music: { c: ctx, want: null, now: '', error: null }, fx: { c: fxCtx, want: null, now: '', error: null } };
  async function setDevice(which, id) {
    const o = outs[which];
    if (id === o.want) return;
    o.want = id;
    if (!o.c.setSinkId) return;
    try { await o.c.setSinkId(id || ''); o.now = id || ''; o.error = null; } catch (e) {
      // not connected (the TV is off, the speaker not paired): the system's default until it shows up
      o.error = String((e && e.message) || e);
      try { await o.c.setSinkId(''); } catch {}
      o.now = '';
    }
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    for (const [which, o] of Object.entries(outs)) { const w = o.want; o.want = null; setDevice(which, w || ''); }
  });
  async function devices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Speaker ${i + 1}` }));
    } catch { return []; }
  }

  // ---------- state from the main process ----------
  const tracks = new Map(); // key -> Track
  let quietNow = null; let fightNow = null;
  function apply(s) {
    if (!s) return;
    S = s;
    wake();
    setDevice('music', s.device || '');
    setDevice('fx', s.fxDevice ?? s.device ?? '');
    if (!!s.quiet !== quietNow) {
      quietNow = !!s.quiet;
      ramp(master.gain, quietNow ? 0 : 1, quietNow ? 1.2 : 1.5);
      ramp(fxMaster.gain, quietNow ? 0 : 1, quietNow ? 1.2 : 1.5, fxCtx);
    }
    // the ambience waits underneath: quietly while fight music plays, at the GM's level while Spotify plays
    const fighting = !!(s.open && s.fight);
    const under = fighting ? 0.15 : s.open && s.spotify != null ? s.spotify : 1;
    if (under !== fightNow) { fightNow = under; ramp(music.gain, under, under < 1 ? 2.5 : 3); }
    // the looping sounds that should play now
    const want = new Map();
    if (s.open) {
      if (s.ambience) want.set(`amb:${s.ambience.key}`, { url: s.ambience.url, volume: s.ambience.volume, out: music });
      for (const m of s.mapSounds || []) want.set(`map:${s.mapId}:${m.id}`, { url: m.url, volume: m.volume, muted: m.muted, out: music });
      if (s.fight) want.set(`fight:${s.fight.key}`, { url: s.fight.url, volume: s.fight.volume, out: fightBus, fade: 2.5 });
    }
    for (const [k, t] of tracks) {
      const w = want.get(k);
      if (!w || w.url !== t.url) { t.stop(k.startsWith('fight:') ? 3 : 2); tracks.delete(k); }
    }
    for (const [k, w] of want) {
      const t = tracks.get(k);
      if (t) t.set(w.volume, w.muted);
      else tracks.set(k, new Track(k, w.url, w.out, w));
    }
    spellSounds(s);
  }
  function onEvent(e) {
    if (!e) return;
    if (e.kind === 'sound') playOnce(e.url, e.volume ?? 0.8, { isBoard: true, onPlaying: () => played.board.push(e.name) });
    else if (e.kind === 'stop') stopBoard();
    else if (e.kind === 'thunder') setTimeout(() => playOnce('sfx/thunder-roll.ogg', e.volume ?? 0.7, { onPlaying: () => { played.thunders++; } }), clamp(e.delay, 0, 5) * 1000);
    else if (e.kind === 'test') { // Test: a chime on one of the two speakers
      const which = e.which === 'fx' ? 'fx' : 'music';
      wake();
      if (which === 'fx') synth.chime(0.7);
      else { if (!musicSynth) musicSynth = Synth.make(ctx, master); musicSynth.chime(0.7); }
      played.tests[which]++;
    } else if (e.kind === 'synth' && Synth.NAMES.includes(e.name)) {
      synth[e.name](...(Array.isArray(e.args) ? e.args : []));
      played.synth[e.name] = (played.synth[e.name] || 0) + 1;
    }
  }
  setInterval(() => { for (const t of looping) t.check(); }, 150);

  // read-only snapshot for the self-test
  function debug() {
    return {
      state: ctx.state, fxState: fxCtx.state, ducking,
      device: outs.music.now, deviceError: outs.music.error, fxDevice: outs.fx.now, fxDeviceError: outs.fx.error,
      gains: { master: r2(master.gain.value), fx: r2(fxMaster.gain.value), duck: r2(duck.gain.value), music: r2(music.gain.value), fight: r2(fightBus.gain.value) },
      tracks: [...tracks.values()].map((t) => t.info()),
      board: played.board.slice(), spells: played.spells.slice(), spellsOk: played.spellsOk.slice(), src: played.src.slice(), thunders: played.thunders, synth: { ...played.synth }, ducks: played.ducks, tests: { ...played.tests },
      errors: errors.slice(),
    };
  }

  window.ts.onSoundState(apply);
  window.ts.onSoundEvent(onEvent);
  window.ts.state().then(apply);
  // _test: the looping player on its own, for the self-test
  return { debug, devices, apply, onEvent, _test: { Track, music } };
})();
