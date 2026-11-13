// The Guide (Beta 1): one sheet with what a new GM needs: the first evening, where files go, the keys, what is
// new in this version, and how to report a problem. Opened with ? on any screen, the Guide button on the start
// screen and the Keys button in the rail.
'use strict';

const Guide = (() => {
  const { h, iconEl } = UI;
  const ts = window.ts;
  let el = null;
  let tab = 'start';
  let noteDraft = ''; // 4.0.1: what was typed for a problem report stays when the Guide closes

  const KEYS = [
    ['Build', [['M', 'Move the map (also while Build is folded)'], ['S', 'Assets: trees, rocks, furniture'], ['E', 'Effects, lights and weather'], ['W', 'Walls and doors (W again: next mode)'], ['K', 'Layers'], ['G', 'Grid on or off']]],
    ['Play', [['V', 'Select and move tokens'], ['N', 'Tokens: click to drop NPCs'], ['U', 'Party marker: where it is (arrow keys: one square)'], ['R / C', 'Reveal / cover fog'], ['A', 'Spells'], ['P', 'Point: ping, laser, spotlight, ruler (P again: next)'], ['D', 'Draw: chalk, pen, text, eraser (D again: next)'], ['X', 'Markers and counters (Toolbox)'], ['J', 'Map notes only you see (Build)'], ['O', 'Conversation: NPC portraits on the table'], ['Q', 'Toolbox: map tools and panels'], ['I', 'Initiative'], ['Enter', 'Next turn / next round']]],
    ['Spells and assets', [['Click', 'Cast or stamp'], ['Drag', 'Aim a cone, line or cube / scatter assets'], ['Ctrl + wheel', 'Turn by 15° (Shift: 5°), also placed areas and assets'], ['Shift while aiming', 'Snap to 15°'], ['+  −', 'Spell size in 5 ft steps'], ['[  ]', 'Asset size'], ['Shift + drag', 'Select several assets'], ['Alt', 'Place or measure without snapping']]],
    ['Walls', [['Click', 'Wall corner by corner (Alt: no snapping)'], ['Double-click / Enter', 'End the line of walls'], ['Click a door', 'Open or close it (also with V)'], ['Delete', 'Remove the selected wall']]],
    ['Table', [['T', 'Send this map to the table'], ['B', 'Blackout on or off'], ['1 – 0', 'Use the hotbar (3 pages: the mouse wheel over it)'], ['Alt 1 – 9', 'Open a map of this chapter'], ['F1 – F8', 'Play snapshot 1 to 8 of the map on the table'], ['Shift 1 – 9', 'Play a starred screen effect'], ['Ctrl 1 – 9', 'Play a Spotify mood'], ['F', 'Fit the view to the table'], ['Shift F', 'Show everything, also off the table'], ['Esc on the TV', 'Close the table window']]],
    ['Panels', [['L', 'Library'], ['Shift L', 'Library full screen'], ['Tab', 'Map thumbnails on or off'], ['Shift I', 'Character cards: the party at a glance (only for you)'], ['?', 'This guide'], ['Ctrl ,', 'Options: the TV, picture, players, sound, performance'], ['Ctrl + / Ctrl − / Ctrl 0', 'Size of everything on your screen (not the TV)']]],
    ['Editing', [['Ctrl Z', 'Undo (also the arrows on top of the tools)'], ['Ctrl Y', 'Redo'], ['H', 'Hide or show what is selected'], ['Ctrl D', 'Duplicate the selected token'], ['Delete / Backspace', 'Remove what is selected'], ['[  ]', 'Brush size']]],
    ['Mouse', [['Right-click', 'Radial menu'], ['Right-drag or Space-drag', 'Pan the view'], ['Wheel', 'Zoom the view'], ['Alt + wheel', 'Scale the map (with everything on it)'], ['Double-click', 'Ping'], ['Alt while dragging a token', 'Place it without snapping']]],
  ];

  // what changed, newest first (the start screen's badge names the version)
  const NEWS = [
    ['Beta 3.6', [
      'Handout table: Toolbox → Handouts → Handout table opens a big picture of the TV. Drag a handout to where it should lie, pull a corner to size it, turn it with the knob above it to any angle (it catches when upright or a quarter round). The TV follows while you drag',
      'Up to 10 handouts at once. A new one lands in the middle, a little off and tilted, like a paper tossed on the table; the one you touch lies on top. Each handout remembers how it lay',
      'Handouts burn in and burn away, in the colour of your table style: green for Jungle, blue for Witchfire, and so on',
      'Spreads: save everything that lies on the table, each in its place, under a name (Handout table → Spreads) and bring it back with one click',
      'One copy per handout: the second copy for the other long side is gone. Turn a handout to whoever should read it. Places set before this version are tossed anew',
    ]],
    ['Beta 3.5', [
      'Safer imports: a campaign file from someone else can only put its files into your library and its own campaign folder. Before, a specially prepared file could have written a file somewhere else on the PC. If you got a .tablescape file from a stranger, update before opening it',
    ]],
    ['Beta 3.4', [
      'Tablescape is open source now, under the GNU General Public License (version 3): the code of every version is on GitHub, next to its download. Guide → About has the details',
    ]],
    ['Beta 3.3', [
      'Show to the table: the token stops facing each long side of the table for about two seconds, so everyone gets a good look (only your players\' side when they sit at one side)',
      'The Build tools stay open unless you fold them (the arrow next to Build); folded, they stay folded until you open them again. They no longer fold by themselves while the map is on the table',
      'Fixed: where Sway was painted, the map showed without its colours (Build → Map: brightness, contrast, saturation, warmth)',
    ]],
    ['Beta 3.2', [
      'Right-click a token → Show to the table: it flies to the middle of the table, as big as its picture stays sharp, turns once, slowly, and flies back; the map dims round it like a spotlight. A click on your screen or Esc brings it back at once',
      'While it turns, right-click another token → Add to the show: they line up and turn together',
      'A hidden token: Show to the table (it hides again when it lands) or Show and reveal (it stays on the map)',
      'Effects → Paint → Roof: paint over houses and caves, and rain, snow and the other weather stay off there. The players don\'t see it; on your screen it shows light blue while Effects is open',
      'The demo for new installs: trees and grass sway in the wind, and it rains at night',
    ]],
    ['Beta 3.1', [
      'A new demo for new installs: the maid\'s cottage, by day and by night, and a river scene, with the Little Maid, her big sister and the cat',
      'Effects → Paint → Sway: the map itself moves where you paint it, as if in the wind: tree tops, reeds, banners. Strength, Amount and Speed work as usual, the stroke gives the wind its direction',
      'Windows open and close like doors: click the window icon on your screen. Closed, they stop sight and light; open, they let them through; nobody walks through either way. Your windows start open',
      'Windows no longer show as a line on the TV',
      'Fixed: Walls → Kind (and other rows of buttons) kept showing the old choice after a click',
      'Fixed: a brand-new install greeted you with "Update successful"',
    ]],
    ['Beta 3.0', [
      'The first public version. From now on the name and the number match: Beta 3.0, 3.1, 3.2 …',
      'Discord and Toss a coin on the start screen: help, bug reports, ideas and news on the Tablescape Discord, and Ko-fi if you would like to support Tablescape',
      'Guide → About: the license (freeware), what Tablescape does and doesn\'t do with your data, and the credits',
      'Report a problem: post the report in #bug-reports on the Tablescape Discord (Open Discord is right beside Make the report)',
      'Updates come from the public download page',
      'An update offer has its own line under the title, so the buttons always fit, even in a small window',
      'The installer shows the license before it installs',
    ]],
    ['Prototype 30', [
      'Portraits is now called Conversation (Converse on the rail). The library folder with the pictures is still called Portraits',
      'New tokens come without a name tag. Options → Tokens → New tokens → Name tag changes it',
      'Forest and Jungle: the trees behind the portraits are 30 % lighter',
      'The game icons are gone again: back to the line icons',
    ]],
    ['Prototype 29', [
      'To try: Options → This screen → Icons: Game. About half of the icons become fantasy drawings (a d20 for dice, a pawn for tokens, swords, scrolls, fog); arrows, plus, minus and the like stay as they are. Line brings the old icons back',
      'It applies to this window and the phone app. This window loads again when you switch; a phone takes it the next time it opens Tablescape',
      'The drawings are from game-icons.net (CC BY 3.0, by Lorc, Delapouite and contributors)',
    ]],
    ['Prototype 28', [
      'Deep dungeon: short, thick chains hang from wall plates behind the portraits (the two thin chains across the whole TV are gone)',
      'Necrotic and Blood crypt: the row of skulls has no visible line any more where the picture repeats',
    ]],
    ['Prototype 27', [
      'Five new table styles in Options → Looks, each with its own map change, Portraits band, turn order and round badge',
      'Deep dungeon: iron gates slam shut over the table, with chains, grates and sparks',
      'Necrotic: bones and green mist close over the table, souls rise',
      'Blood crypt: Necrotic in red, for something more evil',
      'Forest: spruce and beech branches close like a canopy, needles and leaves fall. Tall trees stand behind the portraits',
      'Jungle: palm fronds, big leaves and lianas, petals and fireflies. Palms and giants stand behind the portraits',
    ]],
    ['Prototype 26', [
      'Updates ask first: "Prototype X is available. Install now?" Yes downloads it (the maid runs along), then "Restart now?" or Later (it installs when you close Tablescape). Not now leaves a small button on the start screen',
      'Handouts, several at once: a click shows a handout alone, + adds it to what lies on the table',
      'Handouts, placed freely: the Handouts panel shows the TV. Drag a handout to where it should lie, turn it in quarter steps, set its size. Both sides, One direction and Lengthwise set it up with one click; each handout remembers its layout',
      'Handouts on the players\' phones: the phone button on a handout → Everyone or single players. It reaches their phones once it was shown, or at once with Send to the phones now; Take it back removes it. The phone shows a Handouts button; a tap opens one big',
      'One Ready list per chapter for anything from the library (it was Ready for tokens and portraits, and the Tonight tray). Things from an old tray are on the first chapter\'s Ready list',
      'Options → Performance: Load on this computer (Light, Balanced, Full) in one switch; the single settings are under Advanced',
      'Guide → First evening is a checklist that remembers what you ticked',
      'Room lights: shorter texts',
      'Fixed: the word "null" under a counter\'s settings, at the end of the hotbar list, beside a new version without notes and on a break screen without a text',
      'Fixed: the Ruler\'s distance could stay one step behind when the mouse stopped',
    ]],
    ['Prototype 25', [
      'Hotbar: right-click an empty slot → Add … opens one list of everything that can go on the hotbar, with a search field: tools, map tools, panels, actions, screen effects, map light, weather, maps, snapshots, fog, dice, sounds, room lights, and the library\'s tokens, assets, portraits, handouts and overlays. Right-click a filled slot → Change … does the same',
      'Hotbar actions with a value (in that list): Countdown, Break, Darkness and Spotify volume. You type the value once; the slot is then "Countdown 1:30" or "Darkness 60 %"',
      'A door can go on the hotbar: right-click it on the map → Put on the hotbar. The slot opens and closes it',
      'Guide → Help: what every tool and panel can do, in one page with a search field. The "?" of a panel opens it at that panel (instead of a pop-up of its own)',
      'A tool\'s keys show at the top of the map for a few seconds when you pick it (Options → This screen switches that off)',
      'New: Toolbox → Handouts. Click a handout to show it on the table, again to put it away. Each chapter has a Ready list (tick handouts in List …), "Shown so far" keeps what the players saw this session, and you set how big a handout is and at which end of the table it lies. The session log gets a line for each one shown (the panel switches that off)',
    ]],
    ['Prototype 24', [
      'New names. Rail: Sound is now Ambience, Party is Party marker, Talk is Portraits, Keys is Guide. Toolbox: Moments are Screen effects, Phone & tablet is Remote, Players\' phones are Player phones, Characters are Character cards. Options: Players is Seating. Quiet is Mute, Earlier versions are Backups, an asset\'s Layer is its Level, Strike now is Lightning',
      '"Table" now means what the players see (Roll on the table, Round on the table); "TV" only the screen itself (Options → TV, calibration)',
      'The hotbar takes tools: drag a button of the left rail or a map tool of the Toolbox (Ping, Ruler, Chalk, Marker …) onto a slot, or right-click it → Put on the hotbar',
      'The hotbar takes single actions. Right-click an empty slot to pick one: Send to table, Blackout, Mute, Lightning, Stop effects, Grid, Fit the view; Start the fight, Next and Previous turn, Roll enemies, Sort, End the fight, Fight music, Movement again; Hide, Lock or Duplicate what is selected; Spotify play/pause and next song; the next hotbar page. The phone\'s button deck has most of them too (Actions)',
      'Map notes can go on the hotbar as well (Toolbox → right-click)',
      'Less text: long hover tips are shorter, the "?" tips of the panels lost what the buttons already say, Options sections no longer repeat their contents under the title',
      'What\'s new starts at Prototype 1; the older versions are kept in the project\'s files',
    ]],
    ['Prototype 23', [
      'Dragging a player token opens the fog along the way (every half square), not only when you let go',
      'On your screen the dragged token sticks to the mouse; the TV still glides it smoothly',
      'The mouse wheel over the maps at the bottom scrolls them sideways',
      'Assets have three layers (their toolbar\'s stack button, or right-click → Layer): under the effects, in front of them, or above the tokens for tree tops, roofs and bridges. Above the tokens: on the TV it opens softly where a token stands under it; on your screen it is half see-through',
      'After an update the maid gives a thumbs up and asks whether to show what\'s new',
    ]],
    ['Prototype 22', [
      'The same as Prototype 21: its upload on GitHub went wrong (two half entries), so this one comes in its place. Updates on the start screen: Check for updates, the maid running while it downloads, Restart now with the Windows installer\'s progress, then What\'s new',
    ]],
    ['Prototype 21', [
      'Start screen and a campaign\'s page: Check for updates next to the version. While a new version downloads, the maid runs along a progress bar; then "Prototype N ready": Restart now (or it installs when you close Tablescape), and the sparkle shows what\'s new',
      'Installing shows the Windows installer\'s progress, then Tablescape opens again by itself, with What\'s new',
      'Nothing about updates on the map screen any more: no distractions while you prepare or play',
    ]],
    ['Prototype 20', [
      'Updates by themselves: Tablescape looks for a new version a little after it starts and every few hours, downloads it in the background, and shows a small pill at the bottom left: Restart now, or Later (it then installs when you close Tablescape)',
      'Guide → bottom line: your version and Check for updates',
      'New versions are built on GitHub and kept in your private repo; only copies of the app you hand out can fetch them',
    ]],
    ['Prototype 19', [
      'Options → Performance: Effects on your screen: Full speed, 12 fps (the new default, was about 30) or Still (drawn when something changes). Mist, fire, weather, flickering light and spells; the TV always plays them at full speed',
    ]],
    ['Prototype 18', [
      'Assets: "In front of the effects" (the stack button in the asset\'s toolbar, or right-click → Over effects): mist, smoke and the grid no longer cover it; tokens, light and darkness still go over it',
      'The "Not a player token" button shows its icon',
    ]],
    ['Prototype 17', [
      'Player tokens: a token with a party character\'s picture, one a phone holds, or any token you make a player\'s (its name menu → Make this a player token: a familiar, a summon)',
      'Every player token has its own eye, phone or not: it reveals the fog by its own sight, with the character\'s darkvision and the light they carry. While a map has player tokens, the single party marker rests',
      'Sight, darkvision, how far they see and the light they carry (none, candle, torch, lantern, Light, Daylight or their own) belong to the character: they go along to every map, and the phone changes the same',
      'A player token has its own toolbar: the player\'s colour and name, sight on/off, light, darkvision, movement (feet left, click: movement again), HP, size, turn, hide, more',
      'Its name opens the player panel: sight, light, movement and extra moves, HP (12, −7, +5, 12/20), AC and conditions, the phone that holds them, name tag and the character card',
      'Toolbox: Ping, Laser, Spotlight, Ruler, Chalk, Pen, Text, Erase, Marker and Counter are in the one grid too, and can be favourites',
    ]],
    ['Prototype 16', [
      'Name tags along the token\'s rim, centred under it on a thin band; the TV writes the name twice, along the bottom for the near side and upside down along the top for the far side',
      'A tag only you see: blue band, a small crossed-out eye after it; the number badge hides while the name (which carries the number) shows',
      'Lights that overlap no longer add up: each spot gets the light of its strongest source, and light never makes the map brighter than it is',
      'A player\'s eye lights without tinting the map orange',
    ]],
    ['Prototype 15', [
      'Name tags sit above the light: darkness no longer dims them on your screen or the TV; on the TV the line stays thin and the text is a little bigger',
      'Undo no longer takes away the players\' eyes or what they have seen: before, an undo removed the eye from a phone\'s token and it did not come back, so it revealed no more fog',
    ]],
    ['Prototype 14', [
      'Talk only opens while a table is running ("Start the table first")',
      'Undo leaves the players\' moves alone: their phones\' steps are no undo steps, and undoing something keeps their tokens where they are now',
      'Walls: two new kinds, Window (blocks walking, not sight or light; a thin glass line on the TV) and Invisible wall (only blocks walking, never on the TV); a new wall snaps anywhere onto a long wall and splits it there (T-joints)',
      'Smoother TV while you drag a token fast: only its place goes to the TV and it glides there; light, sight and the phones follow when you let go',
      'A player\'s eye can\'t be grabbed off the token any more; the eye light has no player colour; right-click a player\'s token → Player: eye on or off, no light / candle / torch / lantern, movement again, take the character from the phone',
      'Darkvision sees in grey: where only darkvision reaches the map loses its colour and fades dark at the edge; real light keeps its colour',
      'Toolbox: one grid without groups; a star (hover or right-click → Favourite) puts a tile on top; Map notes moved from Build into the Toolbox (J still opens it, it can be pinned to the rail)',
    ]],
    ['Prototype 13', [
      'Talk: the right-click pop-up also moves a portrait up or down and left or right (a double-click on a slider puts it back to 0); Reset puts size and place back',
    ]],
    ['Prototype 12', [
      'Talk: right-click a portrait for its own size (50 to 200 %); a small badge shows it when it isn\'t 100 %',
      'Talk: clicking a portrait that stands behind brings it to the front again; clicking the one in front takes it out',
    ]],
    ['Prototype 11', [
      'Winter, Christmas, Sand, Ash and Ice in real pictures: a snow bank, a Christmas garland, big snowflakes, a dune, a glowing ash heap, snow, sand, ash and ice',
      'Winter: the snow bank grows in from both long sides under the mist; Christmas: the garland lies along it',
      'The turn order and round banner: frost (Winter), sand, ash and ice',
    ]],
    ['Prototype 10', [
      'Two more table styles: Winter (mist and falling snow) with Christmas (a night-blue table, warm lights in the snow), and Sand (a sandstorm sweeps across) with Ash (falling ash, embers)',
      'Stone and Ice: boulders along the broken edge of the slabs and at both ends of the Talk ledge, different every time; Ice sparkles with frost',
      'Meadow and Autumn: the leaves fade in and out; the leaves of the two styles no longer swap right after switching',
    ]],
    ['Prototype 9', [
      'Three region styles in Options → Looks: Stone (mountains, caves), Meadow (open fields) and City (towns, castles), each with a variant: Ice, Autumn, Slums',
      'Stone: rock slabs grind in and meet in dust; Meadow: tall grass grows in and the wind carries leaves; City: banners with a crest slide in on brass rods',
      'Talk portraits now come and go in the colours of Blood, Purple smoke, Dirty parchment and Witchfire (Witchfire glowed orange before)',
    ]],
    ['Prototype 8', [
      'Players\' phones → Pace → Movement: the whole group walks their speed once, then waits; Movement again (or Next round) hands it out anew',
      'Character card → Movement: the character\'s own speed, and extra moves (Cunning Action, Step of the Wind …) as buttons on the phone next to Dash',
      'The phones no longer buzz; a message on the controller sits under the status instead of over the buttons',
    ]],
    ['Prototype 7', [
      'Options → Looks: one table style for a new map, Talk, the turn order and the round\'s banner; any part can have its own',
      'Four new styles: Blood, Purple smoke, Dirty parchment and Witchfire (Ink, Smoke, Parchment and Embers in other colours)',
      'Options → Initiative: everything about the turn order and the round in one place; the Initiative panel has one Options button for it',
      'A token keeps its size and sharpness after a step from a phone; the only animation left is the slide',
    ]],
    ['Prototype 6', [
      'While a turn order runs (shown on the TV or not), only the player whose turn it is moves from the phone',
      'A fight leaves a trace: a dot on every square walked this turn and the feet at the token; every second diagonal step costs 10 ft',
      'Your turn on the phone: the screen\'s edge pulses in your colour, a buzz and "Your turn"',
      'The phone\'s Ping works; turning and doors are gone from the phones; Initiative: a Player button puts players back into the turn order',
    ]],
    ['Prototype 5', [
      'Build tools (Map, Effects, Assets, Walls, Map notes) show the whole map with its light and effects, also beyond the TV\'s edge; only a light veil off the table',
      'Effects off the table move more slowly, and stand still when zoomed far out; Options → Performance switches it off',
    ]],
    ['Prototype 4', [
      'Doors while playing: a lock on the map in every Play tool (Select, Tokens, Fog, Party, Spells); a click asks "Open the door?" Yes / No',
      'The party\'s marker is a badge that shows on any map, and can be dragged in every Play tool',
      'Players\' phones no longer open doors (the DM can allow it in Players\' phones)',
    ]],
    ['Prototype 3', [
      'A phone step really slides now (the TV re-attached every token on every change, which cancelled it)',
      'Players\' phones: switched off is off for everything; doors only on your turn in a fight; a second phone is no second turn; a foe the players have not met is "??" on the phone',
      'A player\'s code can no longer push the DM\'s phone out of the device list; a phone that drops out keeps its character for a minute',
      'Report a problem: keys, tokens and codes are taken out of the settings in the report',
    ]],
    ['Prototype 2', [
      'The phone has a stick: push, let go, one square. While you push, the table shows an arrow in your colour and the square you would land on (red: blocked)',
      'Your seat: the TV\'s top edge glows, push the stick toward it once; "up" on the phone is then away from you on the table (Seat button to do it again)',
      'A phone step slides the token; no emotes, no token file name, no map name on the phones, no Party tab',
    ]],
    ['Prototype 1', [
      'Players\' phones: Toolbox → Players\' phones. A QR code on the TV, the player picks their character, and a D-pad on the phone moves its token: not through walls, closed doors or other tokens',
      'In a fight only on your turn, the speed per turn, Dash once; outside one free, or paused by the DM, or a rest between steps',
      'Each token gets an eye: a carried party light with the character card\'s darkvision (the light you give it); doors next to the token open from the phone; turn, ping and emotes',
      'Built on Beta 4.11.7; square grids only for now',
    ]],
  ];

  const p = (...c) => h('p', {}, ...c);
  const li = (...c) => h('li', {}, ...c);
  const b = (t) => h('b', {}, t);
  const kbd = (t) => h('kbd', {}, t);

  async function startTab() {
    const item = (...c) => h('li', {}, ...c);
    const s = await ts.state().catch(() => null);
    const v = s && s.view;
    // Prototype 26: a checklist; what is ticked is remembered on this computer
    let done = new Set();
    try { done = new Set(JSON.parse(localStorage.getItem('guideFirstEvening') || '[]')); } catch {}
    const li = (id, ...c) => { // (each step has a name of its own, so a step added later starts unticked)
      const box = h('input', { type: 'checkbox', 'aria-label': 'Done' });
      box.checked = done.has(id);
      const item = h('li', { class: `guide-check${box.checked ? ' done' : ''}` }, h('label', {}, box, h('span', {}, ...c)));
      box.addEventListener('change', () => {
        if (box.checked) done.add(id); else done.delete(id);
        item.classList.toggle('done', box.checked);
        try { localStorage.setItem('guideFirstEvening', JSON.stringify([...done])); } catch {}
      });
      return item;
    };
    return h('div', { class: 'guide-text' },
      h('h3', {}, 'Your first evening'),
      h('ul', { class: 'guide-checks' },
        li('screens', b('Two screens. '), 'Tablescape runs on your laptop; the table shows on a TV lying flat (or a projector). ', b('Options → TV'), ' picks the TV and opens the table there. With one screen only, the table opens as a window, so you can try everything.'),
        li('inch', b('One inch is one inch. '), 'Hold a bank card against the TV and match the outline (Options → TV → Calibrate). The grid then fits your miniatures: one square is one inch.'),
        li('campaign', b('A campaign has chapters, chapters have maps. '), 'Open the demo campaign, press ', b('Prepare the maps'), ', pick a map, and press ', kbd('T'), ' to send it to the table. What you prepare stays on your screen until you send it.'),
        li('rail', b('The rail on the left. '), 'Build tools on top, Play tools below. Hover a button for what it does and its key; right-click anything on the map for its menu.'),
        li('sound', b('Sound. '), 'Options → Sound picks the speakers, one for ambience and music, one for effects. Spotify is optional and needs Premium.'),
        li('minis', b('Keep your minis. '), 'Tokens are only for NPCs and monsters you don\'t have as miniatures. Everything else is cardboard, dice and people around the TV.')),
      h('h3', {}, 'While you play'),
      h('ul', { class: 'guide-list' },
        item(b('Fog '), '(', kbd('R'), ' / ', kbd('C'), '): reveal with a brush, a rectangle or a whole room (rooms need walls). The party marker (', kbd('U'), ') reveals what it sees by itself.'),
        item(b('Snapshots '), 'keep a map state (fog, lights, assets) and play it back with a transition: ', kbd('F1'), ' – ', kbd('F8'), '.'),
        item(b('Screen effects '), 'cover the whole table, with sound (earthquake, explosion, blood, gas): Toolbox → Screen effects, starred ones with ', kbd('Shift'), ' + a number.'),
        item(b('The hotbar '), 'above the map bar: drag tokens, assets, sounds and maps onto it; ', kbd('1'), ' – ', kbd('0'), ' use them.'),
        item(b('Blackout '), '(', kbd('B'), ') hides the table while you move things; Break puts a dial on the table.')),
      v ? h('p', { class: 'hint' }, `Table: ${v.windowed ? 'as a window on this screen (no second screen found)' : `${v.world.w}×${v.world.h} on the TV`}${v.calibrated ? ', calibrated' : ', size from the diagonal: calibrate it'}.`) : null);
  }

  async function filesTab() {
    const s = await ts.state().catch(() => null);
    const root = s && s.view && s.view.libraryRoot;
    const folders = [
      ['Maps', 'Battle maps: pictures or videos (webm, mp4)'], ['Tokens', 'NPCs and monsters, round or cut out (png with transparency)'],
      ['Assets', 'Trees, rocks, furniture, traps; animated ones (webm with transparency) in Assets/Animated'], ['Overlays', 'Rain, fog, embers over the whole table'],
      ['Sounds', 'Ambience, Music, SFX'], ['Portraits', 'NPC faces for conversations'], ['Handouts', 'Letters and pictures to show the players'], ['Campaigns', 'Your campaigns: one folder each, with backups inside'],
    ];
    return h('div', { class: 'guide-text' },
      h('h3', {}, 'The library'),
      p('Everything Tablescape shows lives in one folder, the library. Put your own files into its folders, or drop them onto the map or the library drawer (', kbd('L'), '): they are copied in.'),
      root ? h('p', { class: 'guide-path' }, iconEl('folder'), h('code', {}, root), h('button', { class: 'btn small ghost', onclick: () => ts.library('open') }, 'Open')) : null,
      h('div', { class: 'guide-table' }, ...folders.map(([n, d]) => h('div', { class: 'guide-row' }, h('b', {}, n), h('span', {}, d)))),
      p('Options → Library shows where the library is and can ', b('move'), ' it, to another disk for instance. A sync folder (OneDrive, Dropbox) works, but syncing while you play can make files busy for a moment.'),
      h('h3', {}, 'Animated assets'),
      p('An animated asset is prepared the first time a map uses it (the little maid runs along the top meanwhile). Options → Performance lists them.'),
      h('h3', {}, 'Safety net'),
      h('ul', { class: 'guide-list' },
        li(b('Backups '), '(… on a campaign): a copy is made each time you open a campaign; the last 10 are kept.'),
        li(b('Recently deleted '), 'on the start screen keeps deleted campaigns until you empty it.'),
        li(b('Missing files '), 'are listed on the campaign page when a map, token or sound moved; one click finds it again.')));
  }

  function keysTab() {
    return h('div', { class: 'help-cols' }, ...KEYS.map(([title, rows]) => h('section', {}, h('h3', {}, title),
      ...rows.map(([k, d]) => h('div', { class: 'key-row' }, kbd(k), h('span', {}, d))))));
  }

  // Prototype 25: Help: what every tool and panel can do that you cannot guess, in one searchable page (the "?" of a
  // panel opens it at that panel). The lists are the panels' own (Play.helpSections, App.helpSections).
  let helpQuery = ''; let helpAt = null;
  function helpTab() {
    const groups = [];
    try { if (typeof Play !== 'undefined' && Play.helpSections) groups.push(['Map screen', Play.helpSections()]); } catch { /* not on the map screen yet */ }
    try { if (typeof App !== 'undefined' && App.helpSections) groups.push(['Options', App.helpSections()]); } catch { /* */ }
    const q = h('input', { type: 'search', class: 'guide-find', placeholder: 'Find …', value: helpQuery, 'aria-label': 'Find in the help', spellcheck: 'false' });
    const list = h('div', { class: 'guide-help' });
    const draw = () => {
      const t = helpQuery.trim().toLowerCase();
      const out = [];
      for (const [group, secs] of groups) {
        const hit = secs.map((x) => ({ title: x.title, tips: !t || x.title.toLowerCase().includes(t) ? x.tips : x.tips.filter((tip) => tip.toLowerCase().includes(t)) })).filter((x) => x.tips.length);
        if (!hit.length) continue;
        out.push(h('h3', { class: 'guide-help-group' }, group));
        out.push(h('div', { class: 'guide-help-cols' }, ...hit.map((x) => h('section', { dataset: { title: x.title.toLowerCase() } }, h('h4', {}, x.title), h('ul', { class: 'guide-list' }, ...x.tips.map((tip) => h('li', {}, tip)))))));
      }
      list.replaceChildren(...(out.length ? out : [h('p', { class: 'hint' }, t ? 'Nothing found.' : 'Open a campaign to see the help for the map tools.')]));
    };
    q.addEventListener('input', () => { helpQuery = q.value; draw(); });
    draw();
    const at = helpAt; helpAt = null;
    if (at) setTimeout(() => { const sec = list.querySelector(`section[data-title="${CSS.escape(String(at).toLowerCase())}"]`); if (sec) { sec.scrollIntoView({ block: 'start' }); sec.classList.add('lit'); } }, 30);
    else setTimeout(() => q.focus(), 30);
    return h('div', { class: 'guide-text' }, q, list);
  }

  function newsTab() {
    return h('div', { class: 'guide-text' }, ...NEWS.map(([ver, items]) => h('section', {}, h('h3', {}, ver), h('ul', { class: 'guide-list' }, ...items.map((t) => li(t))))));
  }

  function problemTab() {
    const note = h('textarea', { class: 'guide-note', rows: 4, placeholder: 'What did you do, what happened, what did you expect? (optional)' });
    note.value = noteDraft;
    note.addEventListener('input', () => { noteDraft = note.value; });
    const out = h('p', { class: 'hint', hidden: true });
    const make = h('button', { class: 'btn primary', onclick: async () => {
      make.disabled = true;
      try {
        const r = await ts.app('report.make', { note: note.value });
        out.hidden = false;
        out.textContent = r && r.ok ? `Written: ${r.file} (${Math.max(1, Math.round(r.bytes / 1024))} KB). Add that file to your post in #bug-reports.` : 'That did not work: the log folder has what there is.';
        if (r && r.ok) noteDraft = '';
      } finally { make.disabled = false; }
    } }, iconEl('package'), 'Make the report');
    const copyLog = h('button', { class: 'btn', onclick: async () => { const r = await ts.app('log.copy'); UI.toast(r && r.ok ? 'The last 250 lines of the log are copied: paste them into a message' : 'No log yet'); } }, iconEl('clipboard-copy'), 'Copy log');
    const openLog = h('button', { class: 'btn ghost', onclick: () => ts.app('log.open') }, iconEl('folder'), 'Log folder');
    const discord = h('button', { class: 'btn', onclick: () => ts.app('link.open', { to: 'discord' }) }, iconEl('logo-discord'), 'Open Discord');
    return h('div', { class: 'guide-text' },
      h('h3', {}, 'Something went wrong?'),
      p('Make the report: the log, your settings and the benchmark results in one zip file (no maps, no campaigns). The folder opens. Post the file in #bug-reports on the Tablescape Discord, with what you did and what you expected.'),
      note,
      h('div', { class: 'ctl-row' }, make, discord, copyLog, openLog),
      out,
      h('h3', {}, 'Things to know'),
      h('ul', { class: 'guide-list' },
        li('A window that stops (out of memory, a graphics driver) is loaded again by itself and says so. If that happens often, the report tells why.'),
        li('A stuttering TV: Options → Performance. The benchmark measures the map on the TV; "Graphics card vs processor" keeps the better way of drawing animations.'),
        li('The table went dark when the TV was switched off: it comes back by itself when the TV does.'),
        li('A campaign or map shown as damaged: nothing was lost yet. A backup brings it back.')));
  }

  // Beta 3.0: About — Discord and Ko-fi, the license, privacy and credits
  function aboutTab() {
    const lic = h('pre', { class: 'guide-license', hidden: true });
    const licBtn = h('button', { class: 'link-btn', onclick: async () => {
      if (!lic.textContent) { const r = await ts.app('license'); lic.textContent = r && r.ok ? r.text : 'The license text is missing in this copy.'; }
      lic.hidden = !lic.hidden;
      licBtn.textContent = lic.hidden ? 'Read the full license' : 'Hide the license';
    } }, 'Read the full license');
    return h('div', { class: 'guide-text' },
      h('h3', {}, 'Tablescape'),
      p('Free and open source, made by a forever DM. Help, bug reports and ideas: on Discord. If Tablescape makes your table better, you can toss a coin on Ko-fi.'),
      h('div', { class: 'ctl-row' },
        h('button', { class: 'btn', onclick: () => ts.app('link.open', { to: 'discord' }) }, iconEl('logo-discord'), 'Discord'),
        h('button', { class: 'btn', onclick: () => ts.app('link.open', { to: 'kofi' }) }, iconEl('logo-kofi'), 'Toss a coin')),
      h('h3', {}, 'License'),
      p('Open source under the GNU General Public License, version 3: use it at any table, share it, change it. A changed version you pass on stays open source under the same license. The name and the logo are not part of it: give your own version its own name.'),
      h('div', { class: 'ctl-row' }, licBtn, h('button', { class: 'btn', onclick: () => ts.app('link.open', { to: 'code' }) }, iconEl('brand-github'), 'The code on GitHub')),
      lic,
      h('h3', {}, 'Privacy'),
      h('ul', { class: 'guide-list' },
        li('Tablescape collects nothing about you or your games and sends nothing to its maker.'),
        li('Phones and tablets connect over your own network, not over the internet.'),
        li('Spotify, IKEA and Govee: your sign-ins and keys stay on this PC. Tablescape talks to those services only for the features you turn on.'),
        li('Updates: Tablescape asks GitHub whether there is a newer version.'),
        li('Report a problem writes a file on this PC, with keys and codes taken out. It goes nowhere until you send it yourself.')),
      h('h3', {}, 'Credits'),
      h('ul', { class: 'guide-list' },
        li('Icons: Tabler Icons (MIT)'),
        li('Display font: Alegreya (SIL Open Font License)'),
        li('Table-style pictures: made with Midjourney and Grok'),
        li('Built with Electron'),
        li('This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.'),
        li('Tablescape is an unofficial fan product, not made or endorsed by Wizards of the Coast. Dungeons & Dragons and D&D are trademarks of Wizards of the Coast.')));
  }

  const TABS = [['start', 'First evening', 'book'], ['files', 'Your files', 'folder'], ['keys', 'Keys', 'keyboard'], ['help', 'Help', 'help'], ['news', 'What\'s new', 'sparkles'], ['problem', 'Report a problem', 'lifebuoy'], ['about', 'About', 'info-circle']];
  async function fill(body) {
    body.innerHTML = '';
    body.append(UI.loader('…'));
    const make = { start: startTab, files: filesTab, keys: keysTab, help: helpTab, news: newsTab, problem: problemTab, about: aboutTab }[tab] || keysTab;
    const content = await make();
    if (!el) return;
    body.innerHTML = '';
    body.append(content);
  }
  function open(which, section) {
    if (which && TABS.some(([id]) => id === which)) tab = which;
    if (which === 'help') { helpAt = section || null; if (section) helpQuery = ''; } // (Prototype 25: a panel's "?" opens Help at that panel)
    if (el) { el.remove(); el = null; }
    const body = h('div', { class: 'guide-body' });
    const tabs = h('div', { class: 'guide-tabs', role: 'tablist' });
    const draw = () => { tabs.replaceChildren(...TABS.map(([id, label, icon]) => h('button', { class: `guide-tab ${id === tab ? 'on' : ''}`, role: 'tab', 'aria-selected': id === tab, onclick: () => { tab = id; draw(); fill(body); } }, iconEl(icon), label))); };
    draw();
    const ver = h('span', { class: 'help-ver' });
    // Prototype 20: the version, and updates from GitHub
    const upd = h('button', { class: 'link-btn help-upd' });
    const UPD = { idle: 'Check for updates', latest: 'Up to date · check again', checking: 'Checking …', available: 'Update available: see the start screen', downloading: 'Downloading the update …', ready: 'Update ready: restart on the start screen', error: 'Update check failed · try again', off: '' };
    const showUpd = (u) => { const st = (u && u.status) || 'off'; upd.hidden = st === 'off'; upd.textContent = UPD[st] || ''; upd.dataset.tip = st === 'error' && u.error ? u.error : ''; };
    upd.onclick = async () => { const r = await ts.app('update.check'); if (r && !r.ok && r.error) UI.toast(r.error); setTimeout(() => ts.app('about').then((a) => a && showUpd(a.update)).catch(() => {}), 2500); };
    ts.app('about').then((a) => { if (a) { ver.textContent = `Tablescape ${a.label} (${a.version})`; showUpd(a.update); } }).catch(() => {});
    el = h('div', { class: 'modal-back help guide', onpointerdown: (e) => { if (e.target === el) close(); } },
      h('div', { class: 'help-sheet' },
        h('div', { class: 'guide-head' }, h('h2', {}, 'Guide'), tabs, h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, iconEl('x'))),
        body,
        h('div', { class: 'help-foot' }, ver, upd, h('span', { class: 'grow' }), h('span', { class: 'hint' }, 'Esc closes · ? opens this on any screen'))));
    document.body.append(el);
    fill(body);
  }
  function close() { if (el) { el.remove(); el = null; } }
  const isOpen = () => !!el;
  return { open, close, isOpen, KEYS, NEWS, get tab() { return tab; } };
})();
