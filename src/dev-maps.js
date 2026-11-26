// Maps for trying things out, built by the app itself in the campaign that is open. Only when the app is started with
// TS_DEV_MAP=<name> in the environment (PowerShell: $env:TS_DEV_MAP='wallkits'; npm start). Nothing here runs
// otherwise, and never in the self-test. A map that is there already (by its name) is opened, not made again.
'use strict';
const TILES = require('./renderer/tile-data');

// 'wallkits' (25 Nov 2026): one block for each wall kit, in the order of Made of → List …, five in a row.
// A block, left to right and top to bottom:
//   a room of the kit with a door, a window, a pillar and a wall line; a passage to a round room; a slanted room
//   a cave whose rock is the kit; a floor on a cliff of the kit
const KIT_FLOOR = { fieldstone_wall: 'Fieldstone', brick_wall: 'Old cobblestone', sandstone_wall: 'Desert stone', marble_wall: 'White marble', mossy_ruin_wall: 'Mossy flagstones', rune_wall: 'Rune floor', dwarven_wall: 'Slate', obsidian_wall: 'Lava crust', wood_wall: 'Wood panels', timber_frame_wall: 'Wood parquet', palisade_wall: 'Grass and dirt', grimy_metal_wall: 'Rusted plates', ice_wall: 'Ice blocks', crystal_wall: 'Teal glass', bone_wall: 'Bone tiles' };
const BLOCK = { w: 24, h: 18, cols: 5 };

function wallKits(k) {
  const kits = TILES.tiles.filter((t) => t.kind === 'wallkit');
  const items = []; const doors = [];
  const P = (pts) => pts.map(([x, y]) => [x * k, y * k]);
  kits.forEach((kit, i) => {
    const x = 4 + (i % BLOCK.cols) * BLOCK.w; const y = 4 + Math.floor(i / BLOCK.cols) * BLOCK.h;
    const tile = { rel: `Tiles/Tablescape/${KIT_FLOOR[kit.id] || 'Old cobblestone'}.webp` };
    const area = (shape, pts, extra = {}) => ({ kind: 'area', shape, pts: P(pts), tile, edge: 'walls', mat: kit.id, level: 0, mixW: 0, ...extra });
    // the room, the round room, the slanted room, and the passage between the first two (drawn last: it opens their walls)
    items.push(area('rect', [[x, y], [x + 6, y + 5]]));
    items.push(area('round', [[x + 8, y], [x + 12, y + 4]]));
    items.push(area('poly', [[x + 14, y], [x + 18, y], [x + 19.5, y + 2], [x + 17.5, y + 4.5], [x + 14, y + 4]]));
    items.push(area('path', [[x + 6, y + 2], [x + 8.4, y + 2]], { r: 0.5 * k }));
    items.push({ kind: 'pillar', pts: P([[x + 1.5, y + 1.5]]), r: 0.35 * k, round: false, mat: kit.id });
    items.push({ kind: 'line', pts: P([[x + 4, y + 1], [x + 4, y + 3]]), w: 0.5 * k, h: 1, mat: kit.id });
    doors.push({ x1: (x + 2) * k, y1: (y + 5) * k, x2: (x + 3) * k, y2: (y + 5) * k, door: 1 });
    doors.push({ x1: (x + 1) * k, y1: y * k, x2: (x + 2) * k, y2: y * k, door: 1, kind: 'window' });
    doors.push({ x1: (x + 15) * k, y1: y * k, x2: (x + 16) * k, y2: y * k, door: 1 });
    // rock and a cliff made of the kit
    items.push(area('rect', [[x + 1, y + 9], [x + 6, y + 13]], { edge: 'rock' }));
    items.push(area('rect', [[x + 13, y + 9], [x + 18, y + 13]], { edge: 'cliff' }));
  });
  return { name: 'Wall kits test', items, doors, order: kits.map((t) => t.label) };
}

const MAPS = { wallkits: wallKits };

// ctx: { handle, store, state } of the main process
function make(which, ctx) {
  const { handle, store, state } = ctx;
  const build = MAPS[String(which).toLowerCase()];
  if (!build) return { ok: false, error: `no such map: ${which} (there is: ${Object.keys(MAPS).join(', ')})` };
  if (!store.cur) return { ok: false, error: 'no campaign is open' };
  const was = store.allMapIds().map((id) => store.map(id)).find((m) => m && m.os && m.name === build(1).name);
  if (was) { handle('edit.open', { id: was.id }); return { ok: true, id: was.id, made: false }; }
  const ch = (state.editMapId && store.chapterOf(state.editMapId)) || store.cur.meta.chapters[0];
  const res = handle('map.add', { chapterId: ch && ch.id, oldschool: true, name: build(1).name });
  if (!res || !res.ok) return { ok: false, error: 'the map could not be added' };
  const k = (store.map(res.id).grid && store.map(res.id).grid.size) || 1;
  const m = build(k);
  handle('os.add', { mapId: res.id, items: m.items, doors: m.doors });
  return { ok: true, id: res.id, made: true, things: m.items.length, doors: m.doors.length, order: m.order };
}

module.exports = { make, MAPS };
