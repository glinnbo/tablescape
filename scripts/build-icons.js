#!/usr/bin/env node
// Builds src/renderer/icons.js from Tabler Icons (MIT) so the app ships only
// the ~60 icons it uses, inline, with no font or network dependency.
//   node scripts/build-icons.js
const fs = require('fs');
const path = require('path');

const NAMES = [
  'cpu', 'book', 'lifebuoy', 'package', // Beta 1: draw benchmark, guide, report a problem
  'alphabet-runes', 'galaxy', 'window', 'waves-electricity', 'cloud-up', 'fountain', 'iceberg', 'spider', 'sparkles-2', 'wheat', 'droplet-half-2', 'volcano',
  'ripple-down', 'bubble', 'haze', 'scuba-mask', 'cone', 'sparkle', 'bulb-off', 'meteor', 'ripple-up', 'mountain', // Beta 2: effects
  'wifi', 'router', 'stars', 'key', // Beta 3: room lights
  'armchair', 'arrow-up', 'power', // Beta 3.3: room lights setup
  'device-mobile', 'device-tablet', 'qrcode', 'layout-board', 'access-point', 'wifi-off', 'drag-drop', 'hand-click', 'pointer-off', 'arrows-diagonal-2', // Beta 4: phone & tablet
  'user-question', 'screen-share', 'cards', 'presentation', // Beta 4.1: the deck editor, the player screen
  'id-badge-2', 'ear', 'language', 'color-swatch', // Beta 4.2: the character cards
  'pinned-off', // 4.3: panels on the rail
  'user-x', 'stack-front', 'cloud-down', // Prototype 17/18/20: not a player token, an asset in front of the effects
  'device-desktop', // 4.3: Options → This screen
  'home', 'pointer', 'arrows-move', 'cloud-fog', 'target', 'photo', 'stack-2', 'grid-4x4', 'volume', 'volume-off', 'movie',
  'device-tv', 'help', 'eye', 'eye-off', 'trash', 'copy', 'rotate-clockwise', 'plus', 'minus', 'x', 'chevron-down',
  'chevron-up', 'chevron-left', 'chevron-right', 'player-play', 'cast', 'arrow-back-up', 'arrow-forward-up',
  'maximize', 'brush', 'square', 'circle', 'settings', 'folder', 'search', 'dots', 'pencil', 'map-2', 'dice-5',
  'music', 'sparkles', 'user', 'arrow-bar-to-up', 'credit-card', 'grip-vertical', 'check', 'alert-triangle',
  'screen-share-off', 'keyboard', 'focus-2', 'arrows-maximize', 'ruler-2', 'wand', 'book-2', 'map-pin', 'refresh',
  'layout-grid', 'player-pause', 'circle-dashed', 'square-dashed',
  'snowflake', 'bolt', 'wave-sine', 'droplet', 'skull', 'ghost', 'sun', 'hexagon', 'brain', 'cloud', 'leaf', 'moon',
  'triangle', 'line', 'user-circle', 'campfire', 'candle', 'star', 'bug', 'ripple', 'plant', 'grain', 'circle-off',
  'cloud-rain', 'cloud-storm', 'flame', 'lock', 'lock-open', 'eraser', 'bulb', 'hexagons', 'rotate-2', 'hourglass',
  'ruler-measure', 'zoom-in',
  'users', 'trees', 'adjustments-horizontal', 'palette', 'clock', 'bookmark', 'bookmarks', 'tag', 'arrows-minimize',
  'flip-vertical', 'arrow-bar-to-down', 'spray', 'rotate', 'circle-half-2', 'gauge', 'resize', 'arrows-shuffle',
  'category', 'star-off', 'box', 'building-castle', 'volume-3', 'chess-rook',
  'user-plus', 'scribble', 'ballpen', 'typography', 'circle-number-1', 'plus-minus', 'note', 'trending-up', 'trending-down',
  'heartbeat', 'player-stop', 'player-track-next', 'swords', 'tools', 'shadow',
  'messages', 'briefcase', 'list-numbers', 'coffee', 'window-off', 'umbrella', 'rotate-360', 'brand-github', 'speakerphone', 'script', 'flip-horizontal', 'user-check', 'player-skip-back',
  'player-skip-forward', 'arrow-left', 'arrow-right', 'device-floppy', 'tornado', 'mist', 'wind', 'flower',
  'wall', 'door', 'door-enter', 'border-outer', 'vector', 'file-import', 'eye-check',
  'beach', 'flask', 'spiral', 'app-window',
  'notes', 'clock-edit', 'file-export', 'sunrise', 'sunset', 'mountain', 'polygon', 'building-arch', 'transition-right', 'drag-drop-2', 'sun-moon', 'hand-move',
  'file-search', 'history', 'clipboard-copy', 'circle-check', 'info-circle', 'restore',
  'sun-low', // 4.9: window light
  // 1.3: off-table items, Build pin, picture settings, moments, cues, add from PC, big preview
  'pin', 'pinned', 'focus-centered', 'zoom-scan', 'brightness', 'contrast', 'temperature', 'color-filter', 'adjustments',
  'wave-saw-tool', 'biohazard', 'droplets', 'bomb', 'activity-heartbeat', 'sun-high', 'clock-pause', 'dragon', 'confetti', 'flare',
  'keyframes', 'folder-plus', 'picture-in-picture', 'arrows-diagonal',
  // 1.4: the party, Spotify
  'users-group', 'brand-spotify', 'playlist', 'playlist-add', 'heart', 'disc', 'link', 'unlink', 'external-link', 'magnet', 'walk',
  'device-speaker', 'devices', 'music-search', 'list', 'logout', 'player-track-prev', 'repeat', 'volume-2', 'eye-bolt', 'lamp', 'moon-stars',
  // 1.5: dice
  'dice', 'chart-pie', 'heart-broken', 'target-arrow',
  'user-off', 'file-alert', 'calendar', 'circle-x', 'checklist',
  // 1.9: initiative, tables for the wheel
  'sort-descending', 'shield', 'column-insert-right', 'table-import', 'table-export', 'clipboard-text', 'users-minus', 'hash', 'tags', 'table', 'books',
  // 2.1: snapshots, fog on the hotbar
  'camera', 'download', 'cloud-off', 'send',
  // 4.5: the room lights a little darker or brighter
  'brightness-up', 'brightness-down',
  // Prototype 1: the players' phones move their tokens
  'run', 'device-gamepad-2', 'hand-stop', 'user-edit', 'compass',
];

const dir = path.join(__dirname, '..', 'node_modules', '@tabler', 'icons', 'icons', 'outline');
const out = {};
for (const n of NAMES) {
  const svg = fs.readFileSync(path.join(dir, `${n}.svg`), 'utf8');
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  out[n] = body;
}
// Beta 3.0: the official Discord and Ko-fi logos (filled, in their brand colours) for the links to the community and
// the tip jar, from Simple Icons (CC0; the logos stay the trademarks of Discord and Ko-fi, used here to link to them).
const BRANDS = { 'logo-discord': 'discord', 'logo-kofi': 'kofi' };
const brands = {};
const siDir = path.join(__dirname, '..', 'node_modules', 'simple-icons', 'icons');
for (const [name, slug] of Object.entries(BRANDS)) {
  const svg = fs.readFileSync(path.join(siDir, `${slug}.svg`), 'utf8');
  const d = /<path d="([^"]+)"/.exec(svg);
  if (!d) throw new Error(`no path in ${slug}.svg`);
  brands[name] = d[1];
}
const version = require(path.join(__dirname, '..', 'node_modules', '@tabler', 'icons', 'package.json')).version;
const js = `// Generated by scripts/build-icons.js from Tabler Icons ${version} (MIT, https://tabler.io/icons) and two logos from Simple Icons (CC0). Do not edit.
'use strict';
const ICON_PATHS = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}')};
const ICON_BRANDS = ${JSON.stringify(brands, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}')};
function icon(name, cls = '') {
  if (ICON_BRANDS[name]) return \`<svg class="i ib \${name} \${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="\${ICON_BRANDS[name]}"/></svg>\`;
  const body = ICON_PATHS[name] || ICON_PATHS.help;
  return \`<svg class="i \${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${body}</svg>\`;
}
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icons.js'), js);
console.log(`icons.js: ${NAMES.length} icons, ${js.length} bytes`);
