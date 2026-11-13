'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const q = new URLSearchParams(location.search).get('role');
const role = q === 'table' || q === 'sound' ? q : 'gm';

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('ts', {
  role,
  init: () => ipcRenderer.invoke('init'),
  state: () => ipcRenderer.invoke('state'),
  cmd: (type, payload) => ipcRenderer.invoke('cmd', { type, payload }),
  ping: (pos) => ipcRenderer.send('ping', pos),
  settings: (patch) => ipcRenderer.invoke('settings', patch),
  pickFile: (kind) => ipcRenderer.invoke('pick-file', kind),
  library: (action, arg) => ipcRenderer.invoke('library', action, arg),
  // Spotify as a remote (main: spotify.js)
  spotify: (action, arg) => ipcRenderer.invoke('spotify', action, arg),
  // Beta 3: the lamps around the table (roomlights.js)
  lights: (action, arg) => ipcRenderer.invoke('lights', action, arg),
  // Beta 4.6: a campaign as one file: export, import (main: transfer.js)
  transfer: (action, arg) => ipcRenderer.invoke('transfer', action, arg),
  // Beta 4: phones and tablets as remotes (main: remote.js)
  remote: (action, arg) => ipcRenderer.invoke('remote', action, arg),
  players: (action, arg) => ipcRenderer.invoke('players', action, arg), // Prototype 1
  thumb: (action, arg) => ipcRenderer.invoke('thumb', action, arg),
  // baked animations (anim-cache.js): sheets to draw, the GM screen bakes them
  anim: (action, arg) => ipcRenderer.invoke('anim', action, arg),
  onAnim: on('anim'),
  // benchmark (2.4): the windows count their frames, main keeps the results
  bench: (action, arg) => ipcRenderer.invoke('bench', action, arg),
  onBench: on('bench'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  onGmState: on('gm:state'),
  onTableState: on('table:state'),
  onFog: on('fog'),
  onView: on('view'), // 4.4: the map moving: only its new place
  onDrag: on('drag'), // Prototype 14: a token dragged: only its new place
  onPing: on('ping'),
  onPreview: on('table:preview'),
  // 4.11.1: the room lights ask the table for a small picture of itself
  onAmbSample: on('amb:sample'),
  ambFrame: (f) => ipcRenderer.send('amb:frame', f),
  // how big and how often the picture of the TV comes (the big preview wants more)
  previewSize: (o) => ipcRenderer.send('preview:size', o),
  onEvent: on('event'),
  // the TV's frame rate, measured on the table and shown under the GM's table preview
  reportFps: (n) => ipcRenderer.send('table:fps', n),
  onFps: on('table:fps'),
  // version, log, backups, missing files
  app: (action, arg) => ipcRenderer.invoke('app', action, arg),
  // the sound window plays everything the table hears; the table sends it thunder and countdown sounds
  sound: (action, arg) => ipcRenderer.invoke('sound', action, arg),
  soundEvent: (e) => ipcRenderer.send('sound:event', e),
  onSoundState: on('sound:state'),
  onSoundEvent: on('sound:event'),
});
// errors in either window end up in the log file
window.addEventListener('error', (e) => { try { ipcRenderer.send('app:error', `${role}: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`); } catch {} });
window.addEventListener('unhandledrejection', (e) => { try { ipcRenderer.send('app:error', `${role}: unhandled ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`); } catch {} });
