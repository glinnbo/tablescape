// Catalogue of effect looks and spell presets.
// Spell names and areas are from the D&D 5e System Reference Document 5.1 (CC BY 4.0).
'use strict';

const FXDATA = (() => {
  // Damage-type looks. c = main colour, l = highlight, d = dark tone
  const SKINS = {
    fire: { label: 'Fire', c: '#ff7a1f', l: '#ffd36b', d: '#7a1d05', icon: 'flame' },
    cold: { label: 'Cold', c: '#8fd3ff', l: '#ffffff', d: '#1d4f7a', icon: 'snowflake' },
    lightning: { label: 'Lightning', c: '#7fb6ff', l: '#ffffff', d: '#1b2a6b', icon: 'bolt' },
    thunder: { label: 'Thunder', c: '#a9b8d6', l: '#eef3ff', d: '#2f3a52', icon: 'wave-sine' },
    acid: { label: 'Acid', c: '#8be04e', l: '#e4ffb0', d: '#2c5a10', icon: 'droplet' },
    poison: { label: 'Poison', c: '#a4c43a', l: '#e9f59a', d: '#3a4a10', icon: 'skull' },
    necrotic: { label: 'Necrotic', c: '#7d4bb3', l: '#c6a4f0', d: '#140a22', icon: 'ghost' },
    radiant: { label: 'Radiant', c: '#ffd45c', l: '#fffbe0', d: '#8a5a00', icon: 'sun' },
    force: { label: 'Force', c: '#6f8cff', l: '#d6deff', d: '#1d2766', icon: 'hexagon' },
    psychic: { label: 'Psychic', c: '#e25fd0', l: '#ffc6f5', d: '#4a0f44', icon: 'brain' },
    cloud: { label: 'Cloud', c: '#c9ccd2', l: '#ffffff', d: '#50555e', icon: 'cloud' },
    nature: { label: 'Nature', c: '#59b04a', l: '#c8f0a0', d: '#1d4214', icon: 'leaf' },
    darkness: { label: 'Darkness', c: '#22182e', l: '#6d4a9a', d: '#000000', icon: 'moon' },
    arcane: { label: 'Arcane', c: '#a888ff', l: '#efe6ff', d: '#2b1d5c', icon: 'sparkles' },
    // Beta 2
    water: { label: 'Water', c: '#3f9fe0', l: '#e6f7ff', d: '#0c3557', icon: 'ripple' },
    earth: { label: 'Earth', c: '#9a7a52', l: '#e2cfa8', d: '#3a2a18', icon: 'mountain' },
    swarm: { label: 'Swarm', c: '#3a3528', l: '#a69a72', d: '#0e0c08', icon: 'bug' },
  };

  // shape: sphere | cylinder | cone | line | cube | aura ; size in feet ; mode: burst | stay
  const SPELLS = [
    ['Burning Hands', 'cone', 15, 'fire', 'burst'],
    ['Thunderwave', 'cube', 15, 'thunder', 'burst'],
    ['Fog Cloud', 'sphere', 20, 'cloud', 'stay'],
    ['Faerie Fire', 'cube', 20, 'arcane', 'stay'],
    ['Entangle', 'cube', 20, 'nature', 'stay'],
    ['Grease', 'cube', 10, 'acid', 'stay'],
    ['Darkness', 'sphere', 15, 'darkness', 'stay'],
    ['Shatter', 'sphere', 10, 'thunder', 'burst'],
    ['Silence', 'sphere', 20, 'force', 'stay'],
    ['Spike Growth', 'sphere', 20, 'nature', 'stay'],
    ['Web', 'cube', 20, 'cloud', 'stay'],
    ['Moonbeam', 'cylinder', 5, 'radiant', 'stay'],
    ['Cloud of Daggers', 'cube', 5, 'force', 'stay'],
    ['Calm Emotions', 'sphere', 20, 'psychic', 'burst'],
    ['Gust of Wind', 'line', 60, 'cloud', 'stay', 10],
    ['Fireball', 'sphere', 20, 'fire', 'burst'],
    ['Lightning Bolt', 'line', 100, 'lightning', 'burst', 5],
    ['Call Lightning', 'cylinder', 5, 'lightning', 'burst'],
    ['Spirit Guardians', 'aura', 15, 'radiant', 'stay'],
    ['Hunger of Hadar', 'sphere', 20, 'darkness', 'stay'],
    ['Sleet Storm', 'cylinder', 40, 'cold', 'stay'],
    ['Stinking Cloud', 'sphere', 20, 'poison', 'stay'],
    ['Hypnotic Pattern', 'cube', 30, 'psychic', 'burst'],
    ['Ice Storm', 'cylinder', 20, 'cold', 'burst'],
    ['Wall of Fire', 'line', 60, 'fire', 'stay', 1],
    ['Black Tentacles', 'cube', 20, 'necrotic', 'stay'],
    ['Cloudkill', 'sphere', 20, 'poison', 'stay'],
    ['Cone of Cold', 'cone', 60, 'cold', 'burst'],
    ['Flame Strike', 'cylinder', 10, 'fire', 'burst'],
    ['Insect Plague', 'sphere', 20, 'swarm', 'stay'],
    ['Antilife Shell', 'aura', 10, 'force', 'stay'],
    ['Circle of Death', 'sphere', 60, 'necrotic', 'burst'],
    ['Sunbeam', 'line', 60, 'radiant', 'burst', 5],
    ['Delayed Blast Fireball', 'sphere', 20, 'fire', 'stay'],
    ['Incendiary Cloud', 'sphere', 20, 'fire', 'stay'],
    ['Sunburst', 'sphere', 60, 'radiant', 'burst'],
    ['Meteor Swarm', 'sphere', 40, 'fire', 'burst'],
    // Beta 2: water, earth and walls
    ['Watery Sphere', 'sphere', 5, 'water', 'stay'],
    ['Tidal Wave', 'line', 30, 'water', 'burst', 10],
    ['Maelstrom', 'cylinder', 30, 'water', 'stay'],
    ['Erupting Earth', 'cube', 20, 'earth', 'burst'],
    ['Earthquake', 'cylinder', 100, 'earth', 'stay'],
    ['Wall of Ice', 'line', 100, 'cold', 'stay', 1],
    ['Wall of Force', 'line', 100, 'force', 'stay', 1],
    ['Fire breath (young dragon)', 'cone', 30, 'fire', 'burst'],
    ['Cold breath (young dragon)', 'cone', 30, 'cold', 'burst'],
    ['Lightning breath (young dragon)', 'line', 60, 'lightning', 'burst', 5],
    ['Poison breath (young dragon)', 'cone', 30, 'poison', 'burst'],
    ['Acid breath (young dragon)', 'line', 30, 'acid', 'burst', 5],
  ].map(([name, shape, size, skin, mode, width]) => ({ name, shape, size, skin, mode, width: width || 5 }));

  const SHAPES = [
    { id: 'sphere', label: 'Sphere', icon: 'circle', sizeLabel: 'Radius' },
    { id: 'cone', label: 'Cone', icon: 'triangle', sizeLabel: 'Length' },
    { id: 'line', label: 'Line', icon: 'line', sizeLabel: 'Length' },
    { id: 'cube', label: 'Cube', icon: 'square', sizeLabel: 'Side' },
    { id: 'cylinder', label: 'Cylinder', icon: 'circle-dashed', sizeLabel: 'Radius' },
    { id: 'aura', label: 'Aura on a token', icon: 'user-circle', sizeLabel: 'Radius' },
  ];

  // Atmosphere you place with a click (they belong to the map)
  const EMITTERS = [
    { id: 'torch', label: 'Torch', icon: 'flame', r: 0.6, light: { bright: 20, dim: 40 } },
    { id: 'campfire', label: 'Campfire', icon: 'campfire', r: 1.2, light: { bright: 20, dim: 40 } },
    { id: 'candle', label: 'Candles', icon: 'candle', r: 0.35, light: { bright: 5, dim: 10 } },
    { id: 'glow', label: 'Magic glow', icon: 'sparkles', r: 1, color: '#7fa8ff' },
    { id: 'smoke', label: 'Smoke', icon: 'cloud', r: 1 },
    { id: 'steam', label: 'Steam', icon: 'droplet', r: 0.8 },
    { id: 'sparkles', label: 'Sparkles', icon: 'star', r: 1.2, color: '#ffe9a8' },
    { id: 'fireflies', label: 'Fireflies', icon: 'bug', r: 2 },
    // Beta 2. turn: can be turned (the slider, Ctrl + wheel); kinds: a choice of what it is
    { id: 'runes', label: 'Rune circle', icon: 'alphabet-runes', r: 1.5, color: '#7fb2ff', tip: 'A ring of runes turning slowly: summoning circle, teleport circle, glyph' },
    { id: 'portal', label: 'Portal', icon: 'galaxy', r: 1.4, color: '#a070ff', tip: 'A swirling rift that throws sparks from its rim' },
    { id: 'shaft', label: 'Light shaft', icon: 'window', r: 1, turn: true, tip: 'A beam of light through a window or a hole, dust floating in it. It lights a dark map' },
    { id: 'arcs', label: 'Crackling arcs', icon: 'waves-electricity', r: 1.5, turn: true, color: '#9fc8ff', tip: 'Electricity jumping between two ends: traps, machines. Size sets how far apart' },
    { id: 'vent', label: 'Vent', icon: 'cloud-up', r: 0.9, kinds: [['steam', 'Steam'], ['gas', 'Gas'], ['fire', 'Fire']], tip: 'Bursts every few seconds: a steam vent, a gas vent, a fire trap' },
    { id: 'falls', label: 'Falling water', icon: 'fountain', r: 1.1, tip: 'Where water lands: splash rings, spray and mist (the foot of a waterfall, a fountain, a dripping ceiling)' },
    // 4.9: sunlight through a window: the bright patch on the floor with the shadows of its bars, dust in the air above it
    { id: 'window', label: 'Window light', icon: 'sun-low', r: 1, turn: true, tip: 'Sunlight through a window falling on the floor: the shadows of its bars, dust in the beam. Pick the window\'s shape and its bars; it lights a dark map' },
  ];
  // Atmosphere you paint over an area
  // 4.9: the window light's shapes (w × h in effect sizes: across, and how far it reaches before it is stretched) and its bars
  const WINDOW_SHAPES = [
    { id: 'square', label: 'Square', w: 1.6, h: 1.6 },
    { id: 'tall', label: 'Tall', w: 1.2, h: 2.1 },
    { id: 'wide', label: 'Wide', w: 2.4, h: 1.3 },
    { id: 'arched', label: 'Arched', w: 1.3, h: 2.2 },
    { id: 'round', label: 'Round', w: 1.7, h: 1.7 },
    { id: 'gothic', label: 'Gothic', w: 1.3, h: 2.4 },
  ];
  const WINDOW_GRIDS = [
    { id: 'none', label: 'None', cols: 1, rows: 1 },
    { id: 'cross', label: 'Cross', cols: 2, rows: 2 },
    { id: '2x3', label: '2 × 3', cols: 2, rows: 3 },
    { id: '3x4', label: '3 × 4', cols: 3, rows: 4 },
    { id: 'small', label: 'Small panes', short: 'Small', cols: 4, rows: 6, thin: true },
    { id: 'diamond', label: 'Diamond panes', short: 'Diamond', diamond: true, thin: true },
  ];

  const REGIONS = [
    { id: 'water', label: 'Water', icon: 'ripple', tip: 'Shallow water: light rippling over the bottom, glints' },
    { id: 'current', label: 'River current', icon: 'wave-sine', tip: 'Flowing water: it runs the way you paint the stroke' },
    { id: 'surf', label: 'Surf', icon: 'beach', tip: 'Paint the sea: waves of foam roll in to the edge of what you painted' },
    { id: 'blood', label: 'Blood', icon: 'droplet', tip: 'Pools and splatter; a fresh stroke spreads out for a moment' },
    { id: 'acid', label: 'Acid', icon: 'flask', tip: 'A green pool that bubbles and fumes' },
    { id: 'darkness', label: 'Magical darkness', icon: 'spiral', tip: 'Inky, slowly turning, almost opaque' },
    { id: 'mist', label: 'Mist', icon: 'cloud-fog' },
    { id: 'lava', label: 'Lava', icon: 'volcano', tip: 'Molten rock that glows; it lights a dark map' },
    { id: 'swamp', label: 'Swamp', icon: 'plant' },
    { id: 'dust', label: 'Dust', icon: 'grain' },
    // Beta 2
    { id: 'ice', label: 'Ice', icon: 'iceberg', tip: 'A frozen surface with cracks, a glint sliding over it' },
    { id: 'burning', label: 'Burning ground', icon: 'flame', tip: 'Flames across the area, embers, charred edges; it lights a dark map' },
    { id: 'web', label: 'Webs', icon: 'spider', tip: 'Strands strung across the area, swaying a little' },
    { id: 'glow', label: 'Glowing ground', icon: 'sparkles-2', tip: 'Soft light from below with slow motes, in any colour: hallowed, cursed, a fairy ring, glowing fungus' },
    { id: 'grass', label: 'Grass in the wind', icon: 'wheat', tip: 'Waves of wind roll over a meadow, the way you paint the stroke' },
    // Beta 3.1: the map itself moves where it is painted (tree tops, reeds, banners); no colour of its own
    // Beta 3.1: where it is painted the weather stays off (indoors, caves); not seen on the TV
    { id: 'roof', label: 'Roof', icon: 'umbrella', tip: 'Paint over houses and caves: rain, snow and the other weather stay off there. Not seen on the table', noColor: true, still: true },
    { id: 'sway', label: 'Sway', icon: 'wind', tip: 'Paint over tree tops, reeds or banners: the map itself sways there, the way you paint the stroke', noColor: true },
    { id: 'oil', label: 'Oil', icon: 'droplet-half-2', tip: 'A dark slick with a rainbow sheen. Its card can set it alight' },
  ];
  // Weather covers the whole table, above the fog
  // Weather layers. dir: where things move to, in degrees on the table (0 = right, 90 = towards the bottom edge).
  const WEATHER_TYPES = [
    { id: 'rain', label: 'Rain', icon: 'cloud-rain', dir: 100, color: '#b9cdeb' },
    { id: 'splash', label: 'Splashes', icon: 'ripple', dir: 90, color: '#d5e4f7', still: true },
    { id: 'hail', label: 'Hail', icon: 'grain', dir: 95, color: '#f2f6ff' },
    { id: 'snow', label: 'Snow', icon: 'snowflake', dir: 95, color: '#ffffff' },
    { id: 'clouds', label: 'Cloud shadows', icon: 'cloud', dir: 15, color: '#000000' },
    { id: 'fog', label: 'Fog banks', icon: 'mist', dir: 10, color: '#cfd6dc' },
    { id: 'lightning', label: 'Lightning', icon: 'bolt', dir: 0, color: '#e6eeff', still: true },
    { id: 'sand', label: 'Sandstorm', icon: 'wind', dir: 0, color: '#d9b77a' },
    { id: 'ash', label: 'Ash', icon: 'flame', dir: 95, color: '#a9a39b' },
    { id: 'embers', label: 'Embers', icon: 'sparkles', dir: 270, color: '#ff8f2e' },
    { id: 'leaves', label: 'Leaves', icon: 'leaf', dir: 20, color: null },
    { id: 'petals', label: 'Petals', icon: 'flower', dir: 25, color: null },
    { id: 'fireflies', label: 'Fireflies', icon: 'bulb', dir: 0, color: '#d6ff7a', still: true },
    { id: 'spores', label: 'Spores', icon: 'plant', dir: 300, color: '#dcf2c8' },
    // Beta 2
    { id: 'caustics', label: 'Underwater light', icon: 'ripple-down', dir: 30, color: '#bfefff', nogust: true },
    { id: 'bubbles', label: 'Bubbles', icon: 'bubble', dir: 270, color: '#e6f8ff', still: true },
    { id: 'wind', label: 'Wind', icon: 'wind', dir: 10, color: '#ffffff' },
    { id: 'haze', label: 'Heat shimmer', icon: 'haze', dir: 270, color: '#ffd9a0', nogust: true },
  ];
  // Ready-made mixes (the GM can save their own)
  const WEATHER = [
    { id: 'none', label: 'None', icon: 'circle-off', layers: [] },
    { id: 'rain', label: 'Rain', icon: 'cloud-rain', layers: [{ type: 'rain' }, { type: 'splash', amount: 0.6 }] },
    { id: 'storm', label: 'Thunderstorm', icon: 'cloud-storm', layers: [{ type: 'rain', amount: 1.7, speed: 1.3, gust: 0.6 }, { type: 'splash', amount: 1.2 }, { type: 'clouds', opacity: 0.85 }, { type: 'lightning' }] },
    { id: 'snow', label: 'Snow', icon: 'snowflake', layers: [{ type: 'snow' }] },
    { id: 'blizzard', label: 'Blizzard', icon: 'tornado', layers: [{ type: 'snow', amount: 2.2, speed: 2.2, gust: 0.8, dir: 25 }, { type: 'fog', amount: 0.9, opacity: 0.7, speed: 2, dir: 25 }, { type: 'clouds', amount: 0.6, opacity: 0.6 }] },
    { id: 'fog', label: 'Foggy morning', icon: 'mist', layers: [{ type: 'fog', amount: 1.3 }, { type: 'clouds', amount: 0.4, opacity: 0.5 }] },
    { id: 'sand', label: 'Sandstorm', icon: 'wind', layers: [{ type: 'sand', amount: 1.6, gust: 0.7 }, { type: 'fog', amount: 0.9, opacity: 0.55, color: '#c9a46a', speed: 3, dir: 0 }] },
    { id: 'volcanic', label: 'Volcanic ash', icon: 'flame', layers: [{ type: 'ash', amount: 1.3 }, { type: 'embers', amount: 0.8 }, { type: 'clouds', amount: 0.8, color: '#2a1408' }] },
    { id: 'autumn', label: 'Autumn', icon: 'leaf', layers: [{ type: 'leaves' }, { type: 'clouds', amount: 0.5, opacity: 0.6 }] },
    { id: 'blossoms', label: 'Blossoms', icon: 'flower', layers: [{ type: 'petals' }, { type: 'spores', amount: 0.6 }] },
    { id: 'night', label: 'Fireflies', icon: 'bulb', layers: [{ type: 'fireflies' }, { type: 'fog', amount: 0.5, opacity: 0.5 }] },
    // Beta 2
    { id: 'underwater', label: 'Underwater', icon: 'scuba-mask', layers: [{ type: 'caustics' }, { type: 'bubbles', amount: 0.7 }, { type: 'fog', amount: 0.8, opacity: 0.45, color: '#1d5f8a', speed: 0.5 }, { type: 'spores', amount: 0.5, color: '#cfeee8' }] },
    { id: 'heat', label: 'Desert heat', icon: 'haze', layers: [{ type: 'haze' }, { type: 'wind', amount: 0.5, color: '#f3dcae' }] },
    { id: 'gale', label: 'Gale', icon: 'wind', layers: [{ type: 'wind', amount: 1.6, speed: 1.4, gust: 0.7 }, { type: 'leaves', amount: 0.5, speed: 1.6 }, { type: 'clouds', amount: 0.5, opacity: 0.5, speed: 2 }] },
  ];
  const LIGHTS = [
    { id: 'candle', label: 'Candle', bright: 5, dim: 10, color: '#ffc36e' },
    { id: 'torch', label: 'Torch', bright: 20, dim: 40, color: '#ffb45a' },
    { id: 'lantern', label: 'Lantern', bright: 30, dim: 60, color: '#ffd28a' },
    { id: 'light', label: 'Light cantrip', bright: 20, dim: 40, color: '#fff6e0' },
    { id: 'moon', label: 'Moonlight', bright: 30, dim: 60, color: '#b8c8ff' },
    // Beta 2: a cone of light (5e: 60 ft bright, 60 more dim), turned with the slider or Ctrl + wheel; carried, it faces the way the token does
    { id: 'bullseye', label: 'Bullseye lantern', bright: 60, dim: 120, color: '#ffd28a', cone: 53 },
    // a light without a token that the GM drags along with the group (also movable with the select tool)
    { id: 'party', label: 'Party light', bright: 30, dim: 60, color: '#ffcf8a' },
  ];
  // colour choices for effects and spells (null = the effect's own colours)
  const COLORS = [
    { id: null, label: 'Own colours', hex: null },
    { id: 'fire', label: 'Fire', hex: '#ff8a2a' },
    { id: 'hellfire', label: 'Hellfire green', hex: '#5cff74' },
    { id: 'arcane', label: 'Arcane blue', hex: '#5f9dff' },
    { id: 'shadow', label: 'Shadow purple', hex: '#9b5cff' },
    { id: 'blood', label: 'Blood red', hex: '#ff3344' },
    { id: 'frost', label: 'Frost', hex: '#bfe8ff' },
    { id: 'gold', label: 'Holy gold', hex: '#ffd45c' },
    { id: 'ghost', label: 'Ghost white', hex: '#eef4ff' },
  ];
  // colour of the darkness itself
  const TINTS = [
    { id: 'black', label: 'Black', hex: '#03040a' },
    { id: 'night', label: 'Night blue', hex: '#0a1634' },
    { id: 'underdark', label: 'Underdark', hex: '#1b0a2a' },
    { id: 'swamp', label: 'Murky green', hex: '#07160d' },
  ];

  // the light of a whole scene, changed with a 10 second transition (or at once)
  const MOODS = [
    { id: 'day', label: 'Day', icon: 'sun', darkness: 0, tint: '#03040a', tip: 'Full daylight' },
    { id: 'dawn', label: 'Dawn', icon: 'sunrise', darkness: 0.32, tint: '#3a1d48', tip: 'A cool, violet morning light' },
    { id: 'dusk', label: 'Dusk', icon: 'sunset', darkness: 0.45, tint: '#5c2c08', tip: 'Warm, fading evening light' },
    { id: 'night', label: 'Night', icon: 'moon', darkness: 0.74, tint: '#0a1634', tip: 'Moonlit night: lights and torches stand out' },
    { id: 'cave', label: 'Cave', icon: 'mountain', darkness: 0.92, tint: '#03040a', tip: 'Underground: only what is lit can be seen' },
  ];

  // How far a weather layer's wind has carried things by t (seconds after TBASE, the windows' animation time), per
  // unit of a particle's own speed: x, y along the wind and s, the distance. When the speed or the direction changes,
  // the map keeps an anchor (anc: { at (ms), x, y, s } where it was at that moment) and travel goes on from there,
  // so nothing jumps. Shared with the main process (mapstate.js), which sets the anchors.
  const TBASE = 1.7e9;
  const SPEED_MAX = 10;
  function wxTravel(L, t) {
    const def = WEATHER_TYPES.find((x) => x.id === L.type) || {};
    const sp = Math.min(SPEED_MAX, Math.max(0.05, Number(L.speed ?? 1) || 1));
    const a = ((L.dir ?? def.dir ?? 90) * Math.PI) / 180;
    const A = L.anc && Number.isFinite(L.anc.at) ? L.anc : null;
    const dt = A ? t - (A.at / 1000 - TBASE) : t;
    return { x: (A ? A.x : 0) + Math.cos(a) * sp * dt, y: (A ? A.y : 0) + Math.sin(a) * sp * dt, s: (A ? A.s : 0) + sp * dt };
  }

  return { SKINS, SPELLS, SHAPES, EMITTERS, WINDOW_SHAPES, WINDOW_GRIDS, REGIONS, WEATHER, WEATHER_TYPES, LIGHTS, COLORS, TINTS, MOODS, TBASE, SPEED_MAX, wxTravel };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FXDATA;
