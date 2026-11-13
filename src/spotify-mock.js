// A stand-in for Spotify's accounts and Web API, for the self-test only (TS_TEST_DIR):
// it answers like Spotify for the calls spotify.js makes and remembers what was asked.
'use strict';

const http = require('http');
const crypto = require('crypto');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const track = (id, name, artist, ms = 180000) => ({ id, uri: `spotify:track:${id}`, name, duration_ms: ms, artists: [{ name: artist }], album: { name: 'Album', images: [{ url: `https://i.scdn.co/image/${id}`, width: 64, height: 64 }] } });
const TRACKS = {
  t1: track('t1', 'Dragon Fight', 'Fantasy Orchestra'), t2: track('t2', 'Steel and Fire', 'Fantasy Orchestra'), t3: track('t3', 'Last Stand', 'Epic Choir'),
  t4: track('t4', 'Tavern Jig', 'Folk Band'), t5: track('t5', 'Dragonborn', 'Jeremy Soule'),
};
const CONTEXTS = {
  'spotify:playlist:pl1': ['t1', 't2', 't3'], 'spotify:playlist:pl2': ['t4'], 'spotify:album:al1': ['t5'],
};

function start() {
  const st = {
    codes: new Map(), // code -> { challenge, clientId, redirect }
    access: new Set(), refresh: new Set(),
    playing: false, item: null, context: null, queue: [], volume: 60, volumes: [], shuffle: false, device: 'dev1',
    plays: [], pauses: 0, nexts: 0, calls: [],
  };
  const devices = () => [
    { id: 'dev1', name: 'GM-LAPTOP', type: 'Computer', is_active: st.device === 'dev1' && !!st.item, volume_percent: st.volume, supports_volume: true },
    { id: 'dev2', name: 'Kitchen speaker', type: 'Speaker', is_active: st.device === 'dev2' && !!st.item, volume_percent: 40, supports_volume: true },
  ];
  const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(obj == null ? '' : JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const p = u.pathname;
      st.calls.push(`${req.method} ${p}`);
      // ----- accounts -----
      if (p === '/authorize') {
        const code = b64url(crypto.randomBytes(9));
        st.codes.set(code, { challenge: u.searchParams.get('code_challenge'), clientId: u.searchParams.get('client_id'), redirect: u.searchParams.get('redirect_uri'), scope: u.searchParams.get('scope') });
        st.lastScope = u.searchParams.get('scope');
        res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}` });
        res.end();
        return;
      }
      if (p === '/api/token') {
        const f = new URLSearchParams(body);
        if (f.get('grant_type') === 'authorization_code') {
          const c = st.codes.get(f.get('code'));
          const ok = c && c.redirect === f.get('redirect_uri') && c.clientId === f.get('client_id') && b64url(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) === c.challenge;
          if (!ok) { send(res, 400, { error: 'invalid_grant', error_description: 'Invalid authorization code' }); return; }
          st.codes.delete(f.get('code'));
        } else if (f.get('grant_type') === 'refresh_token') {
          if (!st.refresh.has(f.get('refresh_token'))) { send(res, 400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }); return; }
          st.refreshed = (st.refreshed || 0) + 1;
        } else { send(res, 400, { error: 'unsupported_grant_type' }); return; }
        const access = b64url(crypto.randomBytes(12)); const refresh = b64url(crypto.randomBytes(12));
        st.access.add(access); st.refresh.add(refresh);
        send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'x' });
        return;
      }
      // ----- Web API -----
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!st.access.has(auth)) { send(res, 401, { error: { status: 401, message: 'Invalid access token' } }); return; }
      const j = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};
      if (p === '/v1/me') { send(res, 200, { id: 'gm1', display_name: 'Test GM' }); return; }
      if (p === '/v1/me/playlists') {
        send(res, 200, { items: [
          { id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Battle Epic', images: [{ url: 'https://i.scdn.co/image/pl1', width: 300 }], owner: { id: 'gm1', display_name: 'Test GM' }, items: { total: 3 } },
          { id: 'pl2', uri: 'spotify:playlist:pl2', name: 'Tavern Folk', images: [], owner: { id: 'someone', display_name: 'Someone' }, tracks: { total: 40 } }], next: null });
        return;
      }
      if (p === '/v1/me/tracks') { send(res, 200, { items: [{ track: TRACKS.t1 }, { track: TRACKS.t4 }, { item: TRACKS.t5 }], next: null }); return; }
      if (p === '/v1/me/albums') { send(res, 200, { items: [{ album: { uri: 'spotify:album:al1', name: 'Skyrim', artists: [{ name: 'Jeremy Soule' }], images: [] } }], next: null }); return; }
      const pm = p.match(/^\/v1\/playlists\/([^/]+)\/items$/);
      if (pm) {
        if (pm[1] !== 'pl1') { send(res, 403, { error: { status: 403, message: 'Forbidden' } }); return; }
        send(res, 200, { items: CONTEXTS['spotify:playlist:pl1'].map((id) => ({ item: TRACKS[id] })), next: null });
        return;
      }
      if (p === '/v1/search') {
        const q = (u.searchParams.get('q') || '').toLowerCase();
        st.searchLimit = Number(u.searchParams.get('limit'));
        send(res, 200, {
          tracks: { items: Object.values(TRACKS).filter((t) => t.name.toLowerCase().includes(q)) },
          playlists: { items: [null, ...(q.includes('battle') ? [{ id: 'pl1', uri: 'spotify:playlist:pl1', name: 'Battle Epic', images: [], owner: { id: 'gm1' }, items: { total: 3 } }] : [])] },
          albums: { items: q.includes('dragon') ? [{ uri: 'spotify:album:al1', name: 'Skyrim', artists: [{ name: 'Jeremy Soule' }], images: [] }] : [] },
        });
        return;
      }
      if (p === '/v1/me/player/devices') { send(res, 200, { devices: devices() }); return; }
      if (p === '/v1/me/player' && req.method === 'GET') {
        if (!st.item) { send(res, 204, null); return; }
        const d = devices().find((x) => x.id === st.device);
        send(res, 200, { is_playing: st.playing, item: st.item, device: { ...d, is_active: true }, context: st.context ? { uri: st.context } : null, shuffle_state: st.shuffle, progress_ms: 1000 });
        return;
      }
      if (p === '/v1/me/player' && req.method === 'PUT') { st.device = (j.device_ids || [])[0] || st.device; if (j.play) st.playing = true; send(res, 204, null); return; }
      const dev = u.searchParams.get('device_id');
      if (dev && !devices().some((x) => x.id === dev)) { send(res, 404, { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } }); return; }
      if (p === '/v1/me/player/play') {
        if (dev) st.device = dev;
        if (j.context_uri) { st.context = j.context_uri; st.queue = [...(CONTEXTS[j.context_uri] || [])]; }
        else if (j.uris) { st.context = null; st.queue = j.uris.map((x) => x.split(':')[2]); }
        if (j.context_uri || j.uris) st.item = TRACKS[st.queue.shift()] || null;
        if (!st.item) { send(res, 404, { error: { status: 404, message: 'No item' } }); return; }
        st.playing = true;
        st.plays.push({ context: j.context_uri || null, uris: j.uris || null, device: dev, at: Date.now() });
        send(res, 204, null);
        return;
      }
      if (p === '/v1/me/player/pause') { st.playing = false; st.pauses++; send(res, 204, null); return; }
      if (p === '/v1/me/player/next') { st.item = TRACKS[st.queue.shift()] || st.item; st.nexts++; send(res, 204, null); return; }
      if (p === '/v1/me/player/previous') { send(res, 204, null); return; }
      if (p === '/v1/me/player/volume') { st.volume = Number(u.searchParams.get('volume_percent')); st.volumes.push(st.volume); send(res, 204, null); return; }
      if (p === '/v1/me/player/shuffle') { st.shuffle = u.searchParams.get('state') === 'true'; send(res, 204, null); return; }
      send(res, 404, { error: { status: 404, message: 'Not found' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, st, close: () => server.close() });
  }));
}

module.exports = { start, TRACKS };
