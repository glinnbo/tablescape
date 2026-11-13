// Spotify: Tablescape as a remote control for the GM's own Spotify (Premium).
// The music plays in the Spotify app (on this laptop, so through its speaker, or on a Spotify Connect
// speaker); Tablescape decides what plays, pauses, skips and sets the volume. No fades of its own: stepping the
// volume made the music stutter; Spotify's Crossfade setting makes the changes smooth.
//
// Each GM links their own free Spotify developer app (its Client ID). Spotify's rules (2025/2026):
// Development Mode apps need a Premium owner, allow up to five users, and the redirect address must be
// a loopback IP (http://127.0.0.1:<port>/..., "localhost" is not allowed). Login: OAuth 2 with PKCE,
// no client secret. Tokens stay in the user folder (encrypted with the system keychain when there is one).
//
// Endpoints used (all still open to Development Mode apps): /me, /me/playlists, /me/tracks, /me/albums,
// /playlists/{id}/items (own playlists only), /search (10 at a time), /me/player (+ /play, /pause, /next,
// /previous, /volume, /shuffle, /devices, transfer).
// TS_SPOTIFY_ACCOUNTS / TS_SPOTIFY_API / TS_SPOTIFY_PORT point it at a stand-in server for the self-test.
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const PORT = Number(process.env.TS_SPOTIFY_PORT) || 43177;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
// read each time: the self-test points them at its stand-in server after the app has started
const accounts = () => process.env.TS_SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com';
const apiBase = () => process.env.TS_SPOTIFY_API || 'https://api.spotify.com';
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];
const DASHBOARD = 'https://developer.spotify.com/dashboard';
const GUIDE = 'https://developer.spotify.com/documentation/web-api/concepts/apps';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a picture of about the size asked for (Spotify lists them biggest first)
function imageOf(images, want = 64) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = images.filter((i) => i && i.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) || sorted[sorted.length - 1] || {}).url || null;
}
// one row in Tablescape's lists, whatever Spotify sent
function itemOf(o, kind) {
  if (!o || !o.uri) return null;
  if (kind === 'track') {
    return { uri: o.uri, kind, name: o.name || 'Song', sub: (o.artists || []).map((a) => a.name).filter(Boolean).join(', '), image: imageOf(o.album && o.album.images), ms: o.duration_ms || 0 };
  }
  if (kind === 'album') {
    return { uri: o.uri, kind, name: o.name || 'Album', sub: (o.artists || []).map((a) => a.name).filter(Boolean).join(', '), image: imageOf(o.images) };
  }
  // playlists: since 2026 the songs are under "items" (it was "tracks")
  const tot = (o.items && o.items.total) ?? (o.tracks && o.tracks.total);
  return { uri: o.uri, id: o.id, kind: 'playlist', name: o.name || 'Playlist', sub: tot != null ? `${tot} song${tot === 1 ? '' : 's'}` : (o.owner && o.owner.display_name) || '', image: imageOf(o.images), owner: o.owner ? o.owner.id : null };
}

function create({ file, openExternal, safeStorage, onChange, log, test }) {
  let saved = load(); // { clientId, refresh, access, expires, user: { id, name } }
  let pkce = null; // { verifier, state, clientId, server, timer }
  let lastAuthUrl = null; // the self-test opens it itself
  let now = null; // what plays: { playing, track, artist, image, uri, context, device, volume, supportsVolume, at }
  let devices = [];
  let error = null; // the last thing that went wrong, in words
  const calls = []; // the self-test reads what was asked of Spotify

  // ---------- storage ----------
  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.enc && safeStorage && safeStorage.isEncryptionAvailable()) return JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      if (raw.plain) return JSON.parse(Buffer.from(raw.plain, 'base64').toString('utf8'));
    } catch {}
    return {};
  }
  function save() {
    try {
      const txt = JSON.stringify(saved);
      const out = safeStorage && safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(txt).toString('base64') } : { plain: Buffer.from(txt).toString('base64') };
      fs.writeFileSync(file, JSON.stringify(out));
    } catch (e) { log(`spotify: could not save the link: ${e.message}`); }
  }
  const changed = () => { try { onChange(); } catch {} };
  let volRefT = null;
  const setError = (msg) => { error = msg ? { msg, at: Date.now() } : null; changed(); };

  // ---------- linking (OAuth with PKCE) ----------
  function link(clientId) {
    clientId = String(clientId || saved.clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) return { ok: false, error: 'That does not look like a Client ID (32 letters and digits, from your app\'s page on the Spotify developer site).' };
    cancelLink();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const server = http.createServer((req, res) => onCallback(req, res));
    pkce = { verifier, state, clientId, server };
    return new Promise((resolve) => {
      server.once('error', (e) => {
        pkce = null;
        resolve({ ok: false, error: e.code === 'EADDRINUSE' ? `Port ${PORT} is busy (another Tablescape?). Close it and try again.` : `Could not wait for Spotify's answer: ${e.message}` });
      });
      server.listen(PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES.join(' '), state });
        lastAuthUrl = `${accounts()}/authorize?${q}`;
        if (!test) openExternal(lastAuthUrl);
        // the browser has five minutes
        pkce.timer = setTimeout(() => { cancelLink(); setError('Linking took too long. Try Link Spotify again.'); }, 5 * 60 * 1000);
        saved.clientId = clientId;
        save();
        changed();
        resolve({ ok: true, waiting: true, url: lastAuthUrl });
      });
    });
  }
  function cancelLink() {
    if (!pkce) return;
    clearTimeout(pkce.timer);
    try { pkce.server.close(); } catch {}
    pkce = null;
    changed();
  }
  function page(res, ok, msg) {
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Tablescape</title><body style="font:16px system-ui;background:#111214;color:#e8e6e1;display:grid;place-items:center;height:96vh"><div style="text-align:center"><h2 style="font-weight:500">${ok ? 'Tablescape is linked to Spotify' : 'Spotify was not linked'}</h2><p>${msg}</p></div></body>`);
  }
  async function onCallback(req, res) {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback' || !pkce) { res.writeHead(404); res.end(); return; }
    const p = pkce;
    if (u.searchParams.get('state') !== p.state) { page(res, false, 'The answer did not match. Try Link Spotify again in Tablescape.'); return; }
    const err = u.searchParams.get('error');
    if (err) { page(res, false, err === 'access_denied' ? 'You said no. You can close this tab.' : `Spotify said: ${err}`); cancelLink(); setError(err === 'access_denied' ? 'Spotify was not linked (you said no).' : `Spotify said: ${err}`); return; }
    try {
      const tok = await tokenCall({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', redirect_uri: REDIRECT, client_id: p.clientId, code_verifier: p.verifier });
      keep(tok);
      const me = await api('GET', '/v1/me');
      saved.user = { id: me && me.id, name: (me && (me.display_name || me.id)) || 'you' };
      save();
      page(res, true, 'You can close this tab and go back to Tablescape.');
      error = null;
      cancelLink();
      refresh().catch(() => {});
    } catch (e) {
      page(res, false, e.message);
      cancelLink();
      setError(`Linking failed: ${e.message}`);
    }
  }
  async function tokenCall(form) {
    const r = await fetch(`${accounts()}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = j.error_description || j.error || `HTTP ${r.status}`;
      throw new Error(/redirect/i.test(why) ? `Spotify does not know the redirect address. In your app's settings on the Spotify developer site add exactly ${REDIRECT}` : why);
    }
    return j;
  }
  function keep(tok) {
    saved.access = tok.access_token;
    saved.expires = Date.now() + ((tok.expires_in || 3600) - 60) * 1000;
    if (tok.refresh_token) saved.refresh = tok.refresh_token; // PKCE refresh tokens can change on every refresh
    save();
  }
  async function token() {
    if (saved.access && saved.expires > Date.now()) return saved.access;
    if (!saved.refresh || !saved.clientId) throw Object.assign(new Error('Spotify is not linked'), { code: 'unlinked' });
    try {
      keep(await tokenCall({ grant_type: 'refresh_token', refresh_token: saved.refresh, client_id: saved.clientId }));
    } catch (e) {
      // the link was taken back (or the app deleted): link again
      saved.access = null; saved.refresh = null; save();
      throw Object.assign(new Error('Spotify asks to be linked again'), { code: 'unlinked' });
    }
    return saved.access;
  }
  function unlink() {
    cancelLink();
    saved = { clientId: saved.clientId };
    save();
    now = null; devices = []; error = null;
    changed();
    return { ok: true };
  }

  // ---------- the Web API ----------
  async function api(method, pathQ, body, retry = 0) {
    const t = await token();
    calls.push(`${method} ${pathQ.split('?')[0]}`);
    if (calls.length > 200) calls.shift();
    const r = await fetch(`${apiBase()}${pathQ}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204 || r.status === 202) return null;
    if (r.status === 401 && !retry) { saved.expires = 0; return api(method, pathQ, body, 1); }
    if (r.status === 429 && retry < 2) { await sleep(Math.min(5, Number(r.headers.get('retry-after')) || 1) * 1000); return api(method, pathQ, body, retry + 1); }
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
    if (!r.ok) {
      const reason = j && j.error && (j.error.reason || j.error.message);
      const e = new Error(friendly(r.status, reason, pathQ));
      e.status = r.status; e.reason = reason;
      throw e;
    }
    return j;
  }
  function friendly(status, reason, p) {
    if (reason === 'NO_ACTIVE_DEVICE' || (status === 404 && /\/me\/player/.test(p))) return 'No Spotify is open: start Spotify on this laptop (or on the speaker) and try again.';
    if (reason === 'PREMIUM_REQUIRED') return 'Controlling the music needs Spotify Premium.';
    if (status === 429) return 'Spotify asked Tablescape to slow down (too many requests): try again in a moment.';
    if (status === 403 && /\/me\/player/.test(p)) return 'Spotify did not allow that (Premium is needed to control the music).';
    if (status === 403) return 'Spotify did not allow that. Is your Spotify account added under User Management of your app on the developer site?';
    if (status === 404) return 'Spotify did not find that.';
    return `Spotify answered: ${reason || `HTTP ${status}`}`;
  }

  // ---------- what plays, and where ----------
  async function refresh() {
    if (!linked()) return null;
    try {
      const s = await api('GET', '/v1/me/player?additional_types=track');
      // only a real change is news (not the position in the song)
      const sigOf = (n) => JSON.stringify(n && { ...n, progress: undefined, at: undefined });
      const before = sigOf(now);
      if (!s) now = { playing: false, at: Date.now() };
      else {
        const it = s.item || {};
        now = {
          playing: !!s.is_playing, track: it.name || null, artist: (it.artists || []).map((a) => a.name).join(', ') || (it.show && it.show.name) || null,
          image: imageOf((it.album && it.album.images) || it.images, 64), uri: it.uri || null, context: s.context ? s.context.uri : null,
          device: s.device ? { id: s.device.id, name: s.device.name, type: s.device.type } : null, volume: s.device ? s.device.volume_percent : null,
          supportsVolume: s.device ? s.device.supports_volume !== false : true, shuffle: !!s.shuffle_state, progress: s.progress_ms || 0, duration: it.duration_ms || 0, at: Date.now(),
        };
      }
      if (error && Date.now() - error.at > 15000) error = null;
      if (sigOf(now) !== before) changed();
      return now;
    } catch (e) {
      if (e.code === 'unlinked') { now = null; changed(); }
      return null;
    }
  }
  async function listDevices() {
    const r = await api('GET', '/v1/me/player/devices');
    devices = ((r && r.devices) || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.volume_percent, supportsVolume: d.supports_volume !== false }));
    changed();
    return devices;
  }
  // where the music goes: the device picked in Tablescape, else the one playing, else a computer, else any
  async function target(want) {
    const list = await listDevices();
    return list.find((d) => want && d.id === want) || list.find((d) => want && d.name === want) || list.find((d) => d.active) || list.find((d) => d.type === 'Computer') || list[0] || null;
  }
  const q = (o) => `?${new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ''))}`;

  // play a mood (or one thing): its songs, or one of its playlists or albums
  async function play(what, o = {}) {
    try {
      const dev = await target(o.device);
      if (!dev) { setError('No Spotify is open: start Spotify on this laptop (or the speaker) and try again.'); return { ok: false, error: error.msg, noDevice: true }; }
      const items = (what.items || []).filter((x) => x && x.uri);
      const songs = items.filter((x) => x.kind === 'track').map((x) => x.uri);
      const others = items.filter((x) => x.kind !== 'track');
      const shuffle = what.shuffle !== false;
      let body;
      if (songs.length) {
        const list = shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs;
        body = { uris: list.slice(0, 100), position_ms: 0 };
      } else if (others.length) {
        const pick = shuffle ? others[Math.floor(Math.random() * others.length)] : others[0];
        // 4.11.7: from the beginning, never where Spotify last left this playlist or album (shuffled: a song picked here)
        const n = Number(((pick.sub || '').match(/^(\d+) song/) || [])[1]) || 0;
        body = { context_uri: pick.uri, offset: { position: shuffle && n > 1 ? Math.floor(Math.random() * n) : 0 }, position_ms: 0 };
      } else return { ok: false, error: 'This mood has no music yet.' };
      // no fades: volume steps made the music stutter. Tablescape's Spotify volume is set once, only when it
      // differs; smooth changes between songs come from Spotify's own Crossfade (Spotify → Settings → Playback)
      const vol = o.volume == null ? null : Math.max(0, Math.min(100, Math.round(o.volume)));
      if (vol != null && dev.supportsVolume && Math.abs((dev.volume ?? -10) - vol) > 1) { try { await api('PUT', `/v1/me/player/volume${q({ volume_percent: vol, device_id: dev.id })}`); } catch {} }
      if (body.context_uri) { try { await api('PUT', `/v1/me/player/shuffle${q({ state: shuffle, device_id: dev.id })}`); } catch {} }
      try { await api('PUT', `/v1/me/player/play${q({ device_id: dev.id })}`, body); } catch (e) {
        if (!body.offset || !body.offset.position || e.status !== 400 && e.status !== 404) throw e;
        await api('PUT', `/v1/me/player/play${q({ device_id: dev.id })}`, { ...body, offset: { position: 0 } }); // (the playlist got shorter)
      }
      if (body.uris) { try { await api('PUT', `/v1/me/player/shuffle${q({ state: false, device_id: dev.id })}`); } catch {} }
      error = null;
      setTimeout(() => refresh(), 600);
      return { ok: true, device: dev.name };
    } catch (e) { setError(e.message); return { ok: false, error: e.message, unlinked: e.code === 'unlinked' }; }
  }
  // play on where it was paused (after Quiet)
  async function resume(o = {}) {
    try {
      const s = now && now.device ? now : await refresh();
      const devId = s && s.device ? s.device.id : null;
      const dev = devId ? { id: devId } : await target(o.device);
      if (!dev) return { ok: false, noDevice: true };
      await api('PUT', `/v1/me/player/play${q({ device_id: dev.id })}`);
      setTimeout(() => refresh(), 500);
      return { ok: true };
    } catch (e) { setError(e.message); return { ok: false, error: e.message }; }
  }
  // pause, right away
  async function stop() {
    try {
      const s = now && now.device ? now : await refresh();
      if (!s || !s.playing) return { ok: true };
      await api('PUT', `/v1/me/player/pause${q({ device_id: s.device && s.device.id })}`);
      setTimeout(() => refresh(), 400);
      return { ok: true };
    } catch (e) { setError(e.message); return { ok: false, error: e.message }; }
  }
  async function control(action, p = {}) {
    try {
      const dev = now && now.device ? now.device.id : null;
      if (action === 'resume') {
        const t = dev ? { id: dev } : await target(p.device);
        if (!t) { setError('No Spotify is open: start Spotify on this laptop (or the speaker) and try again.'); return { ok: false, error: error.msg, noDevice: true }; }
        await api('PUT', `/v1/me/player/play${q({ device_id: t.id })}`);
      } else if (action === 'pause') await api('PUT', `/v1/me/player/pause${q({ device_id: dev })}`);
      else if (action === 'next') await api('POST', `/v1/me/player/next${q({ device_id: dev })}`);
      else if (action === 'previous') await api('POST', `/v1/me/player/previous${q({ device_id: dev })}`);
      else if (action === 'volume') { // 4.11.7: what plays now knows the new volume; one look at Spotify after the last change
        const v = Math.max(0, Math.min(100, Math.round(p.volume)));
        await api('PUT', `/v1/me/player/volume${q({ volume_percent: v, device_id: dev })}`);
        error = null;
        if (now) { now = { ...now, volume: v }; changed(); }
        clearTimeout(volRefT); volRefT = setTimeout(() => refresh(), 1500);
        return { ok: true };
      }
      else if (action === 'transfer') await api('PUT', '/v1/me/player', { device_ids: [p.device], play: !!(now && now.playing) });
      error = null;
      setTimeout(() => refresh(), 350);
      return { ok: true };
    } catch (e) { setError(e.message); return { ok: false, error: e.message }; }
  }

  // ---------- the library ----------
  async function library(kind, o = {}) {
    try {
      const off = Math.max(0, Number(o.offset) || 0);
      if (kind === 'playlists') {
        const r = await api('GET', `/v1/me/playlists${q({ limit: 50, offset: off })}`);
        return { ok: true, items: ((r && r.items) || []).map((x) => itemOf(x, 'playlist')).filter(Boolean).map((x) => ({ ...x, own: !!(saved.user && x.owner === saved.user.id) })), next: !!(r && r.next), offset: off };
      }
      if (kind === 'liked') {
        const r = await api('GET', `/v1/me/tracks${q({ limit: 50, offset: off })}`);
        return { ok: true, items: ((r && r.items) || []).map((x) => itemOf(x.track || x.item, 'track')).filter(Boolean), next: !!(r && r.next), offset: off };
      }
      if (kind === 'albums') {
        const r = await api('GET', `/v1/me/albums${q({ limit: 50, offset: off })}`);
        return { ok: true, items: ((r && r.items) || []).map((x) => itemOf(x.album, 'album')).filter(Boolean), next: !!(r && r.next), offset: off };
      }
      if (kind === 'playlist') {
        // the songs of one playlist: Spotify only lists them for playlists you own or help edit
        const id = String(o.id || '').replace(/^spotify:playlist:/, '');
        let r;
        try { r = await api('GET', `/v1/playlists/${encodeURIComponent(id)}/items${q({ limit: 100, offset: off })}`); }
        catch (e) {
          if (e.status === 403 || e.status === 404) return { ok: false, error: 'Spotify only lists the songs of your own playlists. Play this one whole, or use it in a mood.' };
          throw e;
        }
        return { ok: true, items: ((r && r.items) || []).map((x) => itemOf(x.item || x.track, 'track')).filter(Boolean), next: !!(r && r.next), offset: off };
      }
      if (kind === 'search') {
        const text = String(o.q || '').trim();
        if (!text) return { ok: true, items: [] };
        const r = await api('GET', `/v1/search${q({ q: text, type: 'track,playlist,album', limit: 10 })}`);
        const pick = (k, t) => ((r && r[k] && r[k].items) || []).map((x) => itemOf(x, t)).filter(Boolean);
        return { ok: true, items: [...pick('playlists', 'playlist'), ...pick('tracks', 'track'), ...pick('albums', 'album')] };
      }
      return { ok: false, error: 'unknown list' };
    } catch (e) { return { ok: false, error: e.message, unlinked: e.code === 'unlinked' }; }
  }

  const linked = () => !!(saved.refresh && saved.clientId);
  function info() {
    return {
      linked: linked(), waiting: !!pkce, clientId: saved.clientId || '', user: saved.user ? saved.user.name : null,
      now, devices, error: error ? error.msg : null, redirect: REDIRECT, dashboard: DASHBOARD, guide: GUIDE,
    };
  }

  return { link, cancelLink, unlink, refresh, listDevices, play, stop, resume, control, library, info, linked, debug: () => ({ calls: calls.slice(), lastAuthUrl, saved: { clientId: saved.clientId, user: saved.user, hasRefresh: !!saved.refresh } }) };
}

module.exports = { create, REDIRECT, PORT, DASHBOARD, GUIDE, itemOf };
