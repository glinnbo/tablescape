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
    ['Play', [['V', 'Select and move tokens'], ['N', 'Tokens: click to drop NPCs'], ['U', 'Party marker: where it is (arrow keys: one square)'], ['R / C', 'Reveal / cover fog'], ['A', 'Spells'], ['P', 'Point: ping, laser, spotlight, ruler (P again: next)'], ['D', 'Sketch: chalk, pen, eraser (D again: next)'], ['X', 'Marks: pins, numbers, labels, counters'], ['J', 'Marks: a note only you see'], ['O', 'Conversation: NPC portraits on the table'], ['Q', 'Toolbox: map tools and panels'], ['I', 'Initiative'], ['Enter', 'Next turn / next round']]], // Third Builder (third-marks-tool): D, X, J
    ['Spells and assets', [['Click', 'Cast or stamp'], ['Drag', 'Aim a cone, line or cube / scatter assets'], ['Ctrl + wheel', 'Turn by 15° (Shift: 5°), also placed areas and assets'], ['Shift while aiming', 'Snap to 15°'], ['+  −', 'Spell size in 5 ft steps'], ['[  ]', 'Asset size'], ['A picked asset\'s frame', 'Sides: flat or long · corners: size · knob: turn'], ['Shift + drag', 'Select several assets'], ['Alt', 'Place or measure without snapping']]],
    ['Draw (Oldschool maps)', [['Drag', 'A room, a round room, a wall, stairs (Shift: square, circle, straight)'], ['Click', 'A shape corner by corner; Enter, double-click or right-click closes it'], ['Alt while drawing', 'Erase instead'], ['Backspace / Esc', 'Take the last corner back / drop the shape']]],
    ['Walls', [['Click', 'Wall corner by corner (Alt: no snapping)'], ['Double-click / Enter', 'End the line of walls'], ['Click a door', 'Open or close it (also with V)'], ['Delete', 'Remove the selected wall']]],
    ['Table', [['T', 'Send this map to the table'], ['B', 'Blackout on or off'], ['1 – 0', 'Use the hotbar (3 pages: the mouse wheel over it)'], ['Alt 1 – 9', 'Open a map of this chapter'], ['F1 – F8', 'Play snapshot 1 to 8 of the map on the table'], ['Shift 1 – 9', 'Play a starred screen effect'], ['Ctrl 1 – 9', 'Play a Spotify mood'], ['F', 'Fit the view to the table'], ['Shift F', 'Show everything, also off the table'], ['Esc on the TV', 'Close the table window']]],
    ['Panels', [['L', 'Library'], ['Shift L', 'Library full screen'], ['Tab', 'Map thumbnails on or off'], ['Shift I', 'Character cards: the party at a glance (only for you)'], ['?', 'This guide'], ['Ctrl ,', 'Tablescape settings: the TV, picture, sound, performance'], ['Ctrl + / Ctrl − / Ctrl 0', 'Size of everything on your screen (not the TV)']]],
    ['Editing', [['Ctrl Z', 'Undo (also the arrows on top of the tools)'], ['Ctrl Y', 'Redo'], ['H', 'Hide or show what is selected'], ['Ctrl D', 'Duplicate the selected token'], ['Delete / Backspace', 'Remove what is selected'], ['[  ]', 'Brush size']]],
    ['Mouse', [['Right-click', 'Radial menu'], ['Right-drag or Space-drag', 'Pan the view'], ['Wheel', 'Zoom the view'], ['Alt + wheel', 'Scale the map (with everything on it)'], ['Double-click', 'Ping'], ['Alt while dragging a token', 'Place it without snapping']]],
    ['Cartographer', [['V P R D T E', 'Move, Place, Route, Draw, Write, Erase'], ['M', 'How far: measure from the pointer (a click adds a bend)'], ['Enter / Esc', 'End a route or a measuring line'], ['Delete', 'Remove what is picked']]], // Second Builder (second-cartographer-polish)
  ];

  // what changed, newest first (the start screen's badge names the version)
  const NEWS = [
    ['Beta 3.62', [
      'Water: Rapids, a Whirlpool (Whirlpool or Maelstrom, either way round; it can swirl the map\'s own water), a Bubbling pool (mud, bog, hot spring, tar) and a Geyser that erupts now and then',
    ]],
    ['Beta 3.61', [
      'Eight more panels are built like Effects and Draw: tools and groups stand at the panel\'s side, a banner shows what is in hand, the rare settings fold away, and every panel fits the screen. Saved maps stay as they are',
      'Spells: the six shapes by name at the side, a banner with the spell in hand, every look with its name. What you set once (the screen effect, the squares, counting rounds, the sounds) is on the card "When it is cast". Clear is in the foot',
      'Assets: Library and Living at the side, Stamp and Scatter beside them. The look of the next one is the card "Look"; a picked asset turns the panel into its card. The wind box is gone from here: the wind is in Effects → Scene',
      'Map: a banner with the map and its size on the table, the six colour looks as pictures of your own map. The colour sliders and the turning are folded; Original (hold) and Reset are in the foot',
      'Walls and doors: Walls, Room, Door, Edit and Erase at the side, the kind as tiles, Load and Remove all in the foot. Fog of war: Brush, Box and Room at the side, Reveal and Cover as two tiles, Marked areas folded until there are some',
      'Grid: Show, the kind and the cell size on top, with "Match the print" and "Squares 1 inch" side by side; tilt and shift are under "Nudge it", colour and opacity under "Look"',
      'Ambience: one screen instead of three tabs. Chapter, This map and Fight are three cards; the one that sounds on the table says Playing. Mute all is in the foot, and "Start with Initiative" is a switch right there',
      'Tokens: Ready, Party, Recent and Starred at the side; the panel opens on the first that has tokens. A banner shows the token in hand, the sizes have their names, and List … is called All tokens (your folders are there)',
    ]],
    ['Beta 3.60', [
      'Effects is sorted anew, in three groups at its side (as in Draw): Scene, Lights, Elements',
      'Scene: the whole map on one screen: time of day, darkness, the weather mixes, Lightning, the wind. The rare settings are folded under More and Fine-tune the weather, where "Add a layer" replaces the single-layer tiles. Indoors is the Roof of before',
      'Elements: every effect as a picture tile, sorted by family (Water, Fire, Nature, Magic, Battle); the chips narrow them. The effect knows whether it is clicked or painted: Box, Round, Brush and Erase come out at the side only for painted ones',
      'Each effect remembers its own colour and size. Painting in another colour starts a new area by itself ("Start a new area" is gone). A click beside a picked effect lets go of it and places nothing',
      'A picked effect: the panel becomes its card, with hide, copy and remove. Strength, Amount and Speed are behind its settings button',
    ]],
    ['Beta 3.59', [
      'Conversation: the sliders under the small TV are smooth: the small TV follows at once, the TV once you let go',
      'Conversation: new Height and Size sliders for the picked portrait, beside Blood and Shade; Blood is free from 0 to 100 %, and the notch names and percentages are gone',
      'Conversation: Library is as tall as the chips beside it',
    ]],
    ['Beta 3.58', [
      'Effects → Paint → Grass: living blades on every map, picture maps too. They wave in the map\'s wind, in the colour of the map under them or one you pick (without a graphics card: the waves of light as before)',
      'Grass has one card per map, in Paint and in Draw: Amount, Length, the new Thickness (50 to 300 %), Between gusts, Colour variety, Grows on',
    ]],
    ['Beta 3.57', [
      'Marks (X): pins, crosses, numbers, labels and counters in one tool. A pin or number can say something ("Old well", "3 · Trap"), shown under it on the TV too',
      'Marks: On the table or Only me for every mark; J starts a note only you see. One list of everything on the map, with an eye and a bin, and one Clear with Undo',
      'A label hidden from the table becomes a note, and a note can go on the table as a label (the eye in Marks)',
      'Draw (chalk, pen, eraser) is now called Sketch; Text moved to Marks. The rail calls the Party marker Party again',
    ]],
    ['Beta 3.56', [
      'Conversation: the small TV turns green while a conversation runs, with End in its corner; the count under it is gone',
      'Conversation: the party\'s tokens sit on the small TV\'s edge: a click brings in their cut-out; a greyed one has none yet (set it on the character card)',
      'Conversation: under the small TV, for the picked portrait: Take out, Mirror, Hidden, and two small upright sliders: Blood in four steps (Clean, Light, Heavy, Soaked) and Shade up to 100 %, where the head is black',
      'Conversation: Ctrl + wheel on the small TV sizes the picked portrait; the TV follows once the wheel rests',
      'Conversation: the portraits in one row that scrolls sideways (the wheel too); chips pick Ready, All or one of your Portraits folders; Library beside them has them all',
    ]],
    ['Beta 3.55', [
      'Conversation: the small TV now draws only the map (blurred), the bands and the portraits with their looks: no effects, and it no longer costs the TV pictures',
      'Conversation: sizing and moving portraits happen on the small TV first; when you let go the TV glides there',
      'Conversation: the window\'s corner sizes it; the small TV grows with it, the portraits below keep their size',
      'Conversation: portraits may be as big as you like (up to 400 %), run off the top and the sides, and overlap the far side; never below their band. Five can stand there now',
      'Conversation: no right-click any more: the eye on a portrait brings it in Hidden, and on the TV a big ✕ on its picture takes it off',
    ]],
    ['Beta 3.54', [
      'A light is one thing now: a wall torch, a lamp post or a cooking fire moves, hides and goes away together with its holder. Removing its flame in Effects no longer leaves the empty holder behind; maps from before are put right when they open',
      'One Light panel, the same in Effects → Light → Light sources and in Draw → Structure → Light: Holder (the six lights with what holds them), Flame (Torch, Campfire, Candles, for a torch painted on the map) or Just light (which a token can carry). Then Lit or Unlit, the colour, the reach, and under More how it lives',
      'Click a light to pick it, in Draw and in Effects: the same rows change it, drag moves it, Delete removes it. Torch, Campfire and Candles moved from Effects → Place to Light sources → Flame',
      'Lit and hidden are two things: a light put out still shows its holder, a hidden light is gone from the TV. Layers lists every light once under Lights, with a bulb to light it or put it out',
      'Only the Select tool asks before a light is lit or put out, now for every light; a fog stroke or a spell that starts on a torch does its own job',
      'On a drawn map a wall light goes with its wall: cut a room back and the torches on the wall that went go too (Undo brings both back)',
    ]],
    ['Beta 3.53', [
      'Cartographer: a route\'s name moves to where it covers no place on its road; drag it along the road to put it elsewhere',
      'Cartographer: How far from here (right-click, or M) measures in days of travel and keeps nothing; − and + under Travelled walk the party on a day at a time',
      'Cartographer: the Move tool lists the places and routes of the map; a click shows one in the middle, the TV button makes the TV look there',
      'Cartographer: a picked place shows Leads to and its note first, its look folded; a place that leads to another map wears a small door on your screen; off the TV it opens without asking',
      'Cartographer: keys V P R D T E for the tools, drag assets from the library onto the map, Undo after removing something; without a map the window only offers Add a map',
    ]],
    ['Beta 3.52', [
      'Clearer labels: Layers has + Token, + Effect and Ambience …; Walls has a labelled Remove all walls; the Tokens row is called Name tags; Spells names the picked look',
      'One name each: the Cartographer is called Cartographer everywhere (no more Map table or Atlas), and the Map and Grid panels both say Make grid squares 1 inch',
      'Grid: Match the map\'s printed grid and Make grid squares 1 inch now sit at the top of the panel',
      'Options → TV: Video on the TV is under Advanced, as Best picture, Smoothest or Safest; the Blackout switch is gone from there (B and the preview still have it)',
      'The rail calls the Party marker Marker',
    ]],
    ['Beta 3.51', [
      'By day a light in its own colour no longer lays its colour over the floor: only the flame burns. Its colour comes in as the map gets dark (all of it from 40 % darkness). A light you gave a colour keeps colouring the map by day, for the mood. This goes for every light: torches, campfires, candles, Light sources and the lights with a holder',
      'Draw → Structure → Light: click a light that is there and it is picked. Drag it (a wall light keeps to the wall and turns to it), change Lit, its colour and its reach in the panel; Remove or Delete takes it away; a click beside it lets go',
      'New for these lights: Reach, for the next one or the picked one (bright and dim light together)',
    ]],
    ['Beta 3.50', [
      'Conversation is a window of its own with a small TV: click a portrait and it speaks, drag the speaker sideways, pull a corner to size one, ✕ takes it out (a click never does)',
      'The picked portrait\'s Bloodied, Shaded and Hidden sit right under the small TV; ⚙ holds the size, the blur and a new switch: the speaker\'s name on the band',
      'Tall portraits may reach over the far side\'s band, away from the players looking at them; portraits without transparency fade out at the top edge too',
      'Bloodied at 100 % now covers the figure: a second spray, splats and drips down the body',
    ]],
    ['Beta 3.49', [
      'Draw has four groups now, each with its colour: Terrain (floors and rooms), Structure (walls, pillars, stairs, doors, windows, lights), Texture (it was called Tile) and Style (the living effects). The tabs beside the groups are the painting tools: Box, Round, Shape, Brush, Erase, and Fill where it fits',
      'Texture paints with every tool: a box, a round, a shape or the brush lay the tile onto the floors under them; Fill gives the whole floor you click the tile (it was Whole floor); Erase takes painted textures away',
      'Style: what you paint (Grass, Water, Lava, Shimmer, Pulse, Ripple) is picked in the panel, how you paint it are the tabs',
      'New, Structure → Light: a wall torch, a wall lantern, a lamp post, a street lamp, candles and a cooking fire. A torch or a lantern sits on the wall you click and shines into the room; walls stop its light. Pick the colour of its light, and whether it is lit',
      'The same six lights for any map: Effects → Light → Light sources → With its holder',
      'In the Play tools a click on one of these lights asks before it is lit or put out, as doors do; the TV follows',
    ]],
    ['Beta 3.48', [
      'Conversation → Bloodied looks soaked in now, not stuck on: new splats and a spray, blended like paint (Darken)',
      'The Bloodied slider builds up: a wound at the neck first, then blood running down the body, then more',
    ]],
    ['Beta 3.47', [
      'The first spell no longer freezes the GM window: the spell effects get ready while the start screen shows (a thin bar under the name)',
      'Computers without a graphics card, or too slow for the realistic spell areas, get the simple ones on their own; Options → Performance → Realistic spell areas switches them off by hand',
    ]],
    ['Beta 3.46', [
      'Draw → Tile now has a blue block of its own with the living effects: Grass, Water, Lava, Shimmer (it was called Glow), Pulse and Ripple. Pick one and draw it with a Box, Round, a Shape or a Brush; Erase brushes effects away and leaves the floor (Alt does the same with the other shapes)',
      'Fill pours an effect over all the floor that lies at one height and is joined to the spot you click: water fills a pit and stops at its rim',
      'Every effect has its own card of sliders, for all of it on the map (the button under its choices). Map settings keeps only the switch Living effects',
      'Grass: it no longer vanishes between the gusts (Between gusts sets how much stays). Grows on lets it stand everywhere, on the bright or the dark parts of the floor, or on a colour you pick from the floor; where it fits best it is thickest and longest. Its blades can have any colour, and Colour variety mixes lighter, darker, yellower and bluer ones',
      'Lava glows more where the floor is bright, throws embers that drift with the wind, and has a heat shimmer of light; the floor under it stays sharp. Sliders: Glow, Embers, Heat shimmer, Speed, Pick-up range',
      'Water: a Transparency slider, and every pond can have its own colour',
      'Shimmer, Pulse and Ripple: Intensity, Speed and Pick-up range each (how bright and strong a colour must be to shine)',
      'Moving an effect\'s slider is no longer an empty step for Undo',
    ]],
    ['Beta 3.45', [
      'Spell areas look new: every damage type has its own realistic look, drawn by the graphics card. Flames pour out of a Fireball, frost spreads along a Cone of Cold, bolts fork, gas rolls, vines tangle, water whirls, the ground breaks and insects swarm',
      'Each spell has its own moment when it is cast (the Fireball blooms, frost spreads, vines grow in), and a colour you pick for a spell still colours it',
      'Without a graphics card the spells look as before; Effects quality Medium and Low draw them a little coarser',
    ]],
    ['Beta 3.44', [
      'Living trees: Hue now gives the colour the preview shows while placing (the trees used to turn the other way round). Trees you already recoloured may look different once: set their Hue again',
      'Tree tops, roofs and everything else Above the tokens are solid on your screen too, and open round a token under them as on the table (also round tokens hidden from the players). Use Opacity if you want one see-through',
      'Placing an asset: its preview is no longer half see-through',
    ]],
    ['Beta 3.43', [
      'Living effects are now drawn, not built into tiles. Under Draw → Effects pick Grass, Water, Lava, Glow, Pulse or Ripple and draw it over any floor with Room, Shape, Round, Brush or Tile, like a tile that cannot be seen. What is laid over it later (a bridge) covers it; Alt with the same tool takes effects away there and leaves the floor',
      'Grass takes the colour of the floor under it, or one you pick: green, dry, wheat, autumn. A field in a colour of its own always shows; blades in the floor\'s own colour show with the wind, as before. Any floor can carry grass',
      'Water makes any floor its bed: a flooded cellar, a ford. Lava and the glows are light only now, so the floor under them stays as sharp as the tiles around it (lava had gone blurry in 3.42)',
      'Glow lets the bright colours of a floor shine, each spot in its own rhythm; Pulse lets them breathe together all over the map; Ripple sends rings out from the middle of what you draw. They work on any hue: mushrooms, runes, embers',
      'No tile moves by itself any more: the river beds, lava and grass tiles of 3.42 are plain floors again. A map drawn in 3.42 stands still until effects are drawn on it',
      'Draw → Map settings: Living effects (before: Living tiles), with two new sliders, Glow and Glow speed',
      'Conversation: right-click a portrait for its looks: Bloodied (with an amount), Shaded (darker from the top of the head) and Hidden (only a black silhouette). They stack, and each portrait keeps its own',
      'A hidden portrait never shows uncovered on the TV; switch Hidden off while it stands there and the figure slowly comes out of the dark',
    ]],
    ['Beta 3.42', [
      'Living tiles on Oldschool maps: some tiles now move by themselves. Water ripples and glints over its bed, lava glows and pulses, grass waves as fine blades in the map\'s wind (the same wind as the living trees, a storm included). The effect belongs to the tile: it shows exactly where the tile shows, so a bridge laid over a river covers it, and floors at other heights stay as they are',
      'Living so far: River pebbles, River stones, Sandy shallows, Deep water, Bath mosaic and Bog (water); Lava flow, Lava crust, Lava field and Lava veins (lava); Tall grass and Meadow (grass). Maps drawn before come alive when they are opened',
      'Draw → Map settings: Living tiles turns them off for a map; Grass, Grass length and Grass in a breeze tune the blades (how many, how long, how well they show when the wind is light)',
      '13 new floors under Draw → Tiles: River pebbles, River stones, Sandy shallows, Deep water, Bath mosaic, Bog, Lava flow, Lava crust, Rune floor, Glowing cave, Frozen lake, Tall grass and Dune sand',
      'Living tiles need a graphics card (as the living trees do); without one the map shows as a still picture. With your screen set to still they stand still on the GM screen; with Effects quality on Low the TV shows half the blades',
      'Draw menu: the Blending card and Map settings no longer jump or show a cut edge while they slide out and in',
    ]],
    ['Beta 3.41', [
      'Effects → Paint: four ways to put an effect down, in a row under Paint. Brush as before; Box and Round are dragged on the grid and snap to its lines and half squares (Shift: a square or a circle); Erase brushes away any painted effect. Holding Alt with Brush, Box or Round erases with that shape',
      'A box or a round of River current, Surf, Grass in the wind or Sway flows along its longer side, the way you dragged it. An area with nothing left after erasing goes; one stroke of Erase is one step for undo',
      'Draw menu: Room\'s parts (Wall, Pillar, Stairs, Door, Window) stand close together as one block that is filled up to the tools, so nothing of the map shows between the two columns',
      'Draw menu: the Blending card and Map settings line up with the panel: joined to its edge at the bottom, they slide out from behind it like a drawer and back when closed',
      'Draw menu: the scroll bar is gone (its grey line stood beside the tabs); the wheel scrolls the panel as before',
    ]],
    ['Beta 3.40', [
      'Oldschool maps: stairs follow the heights. They climb every level between the floor at their foot and the floor at their top, with more steps the higher they go (before, they always climbed one level and ended in a step). Maps drawn before are made anew with it',
      'Blending on raised and lowered floors: a floor blends with the floors at its own height, on a platform or in a pit as on floor level. Where a higher or lower floor begins, the step stays sharp',
      'Doors and windows on any wall: the slanted side of a Shape, a round room, a slanted wall line, a room drawn off the grid. The mark snaps to the nearest wall; a click gives one square, a drag a longer one, a click on it takes it away again. On a round room a door is never longer than fits in the wall',
    ]],
    ['Beta 3.39', [
      'Oldschool maps: a step between floors of different height now shows on every side, not only where the sun\'s shadow falls. A soft dark lies at the foot of every step; the upper edge is bevelled, lighter where it looks at the sun and darker where it looks away; higher floors are a touch lighter, lower ones darker. Maps drawn before are made anew with it',
    ]],
    ['Beta 3.38', [
      'Draw menu: Wall, Pillar, Stairs, Door and Window now come out in a second column, in blue, when Room is picked, and stay while one of them is in use. The other tools show one column of six',
      'Floor heights stack: Lower and Higher step one level a click, from three down to three up. The button between them shows the level and puts it back to floor level',
      'Blending replaces the sliders on the left: pick how a floor runs into its neighbours from four looks (Sharp, Soft, Natural, Tiled). The small button beside it opens the three sliders for fine-tuning',
      'Tile tool: it blends too. A whole floor takes the tile together with the look; a painted tile has a soft edge as wide as the look says (Sharp gives a clean edge)',
      'Draw → Tiles → List …: a switch to sort by Name, Colour (greys first, then round the colour wheel) or Newest. The choice is kept',
      'Draw menu: the tool tabs slide out from behind the panel when it opens, one after the other; Room\'s parts slide out from behind the tools when you pick Room',
      'Tablescape settings, Campaign settings and the home screen\'s panels slide in more slowly, and slide out again when you close them (before, they just vanished). Going from Campaign settings to Tablescape settings and back, the panel stays where it is',
    ]],
    ['Beta 3.37', [
      'The Draw menu made new: the tools are tabs along the panel\'s right edge; at the top a picture of what is about to be drawn; height and edge are little drawings to pick from; the sliders for where floors meet stand upright beside the panel with words at their ends (the number shows as you hover); Map settings (light, shadows, walls for sight, Clear) open from one button at the bottom',
      'Draw → Tile, a new tool that changes a floor\'s tile and nothing else (not its height, edge or shape): click a floor for the whole of it, or paint the tile on with the brush',
      'Draw → Tiles → List … is as wide as the Tokens list: rows of five, twenty tiles at a glance',
      'Stairs: the lowest step goes over into the floor softly (no line where they meet); the shadows between the steps are stronger',
      'Oldschool maps: the shadow at the foot of wall lines and pillars is soft now. Before, it was a hard band that showed as a grey box around them on light floors such as ice',
      'Oldschool maps: the walls for sight snap. They run straight through the middle of the drawn walls with square corners; a door or window lies on that line where its leaves hang and joins the walls at both ends; a wall line drawn up to a room meets its wall. No more gaps or stubs beside doors',
    ]],
    ['Beta 3.36', [
      'Oldschool maps, walls with details, made from the drawing: a pillar at every corner of a room and every bend of a wall line, a thicker block each side of a door or portcullis, a low sill under a window on the room side',
      'Stone and Dark stone walls are now built from wall kits: capstones laid along every wall (also round rooms and wall lines), a capstone on each corner pillar, door blocks, sills and finished wall ends, lit by the map\'s light. Other wall materials look as before',
    ]],
    ['Beta 3.35', [
      'Draw panel in a new order: the tool\'s choices first (each tool shows only what it uses), then its tiles, the last 8 used in two rows with List … for all of them (folders, On this map, Recent), then its sliders; the map\'s own settings at the bottom',
      'Map settings: where the light comes from on a dial (drag the sun round it), Shadow length on a slider (instead of Short / Long / Off), and Shadows all around: every wall and pillar darkens the floor near it, for caves',
      'Doors and windows: twice as thick; Window is a tool of its own; picking Wood, Iron, Stone or Portcullis works again (the choices did not follow Door / Window before)',
      'Pillars up to 8 squares; 2, 4, 6 and 8 squares sit on a grid corner so they cover whole squares',
    ]],
    ['Beta 3.34', [
      'Oldschool maps, doors without a frame: just the door. Where a door lies on a wall the wall opens, the floor runs through and the cut ends of the wall shade the doorway, so an open door or a raised portcullis shows the way through. A window sits in a niche of the wall: the wall\'s own stone, deeper where the window sits, with a stop at each end. Wall lines stay whole under windows and secret doors',
    ]],
    ['Beta 3.33', [
      'Oldschool maps, doors and windows made new: drag along a wall with the Door tool for any length (two squares or more make a pair of leaves); a click still makes one square. Doors in wood, iron, stone or a portcullis; windows in glass, leaded, stained glass, shutters or bars. The frame is the wall\'s own stone, sits on the wall\'s middle and takes the map\'s light and shadow; the leaves swing into the room, a portcullis is raised',
      'Drawing an Oldschool map: when painting the picture takes a moment, a pill at the top shows how far along it is (the maid runs along, as when animations are prepared). The Draw panel no longer says "Making the picture"',
    ]],
    ['Beta 3.31', [
      'Drawing an Oldschool map is faster: a change re-makes only the picture tiles it can really reach (and they are smaller), each floor\'s mixing is worked out once and remembered, the picture underneath is made at half size from the start, and tiles are saved faster',
    ]],
    ['Beta 3.30', [
      'Oldschool maps, mixing made new (Tiled): near the line every square keeps the old floor as a soft patch of its own, some reaching further, some see-through, some already gone, and the floor you draw runs along the joints between them. No more ring of dotted tiles; away from the line both floors stay whole',
      'Oldschool maps: 37 new floor tiles in Library → Tiles and the Draw panel: stone and cobbles, mossy and grassy flagstones, marble, checkerboards, bone, teal glass, wood and parquet panels, iron and rusted plates, meadow, sand, snow and ice, clear water, a pool, a lagoon, the deep sea, three kinds of lava and five bloodstained floors',
    ]],
    ['Beta 3.29', [
      'Oldschool maps: Fade goes outward: what you draw stays whole, and its floor carries on for a square and a half beyond your line, fading softly into the dark',
      'Floors mix in three steps: a soft blend, made uneven, then (Tiled) whole squares near the line that fill with the other floor, and soft glows of the other floor along the joints, stronger where they meet',
      'Stairs are of the floor you picked, two steps a square, dark at the bottom and bright at the top, each step with its shadow and a light edge',
      'Ground is gone from Draw (pools drawn before leave with their effects); water, lava and the rest stay in Effects',
    ]],
    ['Beta 3.28', [
      'Oldschool maps: a new edge, Fade: the floor fades into the dark over a square and a half, a little unevenly. One can see across it',
      'Cliffs show: a rough rock face falls away from the floor, bright at its top, then into darkness',
      'Floors mix along the grid in two ways (the Tiled slider): some squares change inside, elsewhere the joints between the squares take the other floor',
      'Brush, Erase (brush) and Wall show what you draw while you drag, at its real width with an orange rim',
      'Living trees take the map\'s colours (Natural, Vivid, Muted and the rest) like the picture does',
      'The Draw panel is simpler: Corridor, Floor and Pieces are gone (what you drew with them stays and can be erased)',
    ]],
    ['Beta 3.27', [
      'Oldschool maps: floors mix by opacity alone, as three rules: a soft line where the floors meet (Mix width, ½ to 3 squares; 0 is off), the line made uneven (Uneven), and near it squares that show more or less of the new floor along the grid (Tiled). A new floor starts at 1½ squares, uneven and tiled at a half; floors from 3.26 take that too',
      'Floor → Paint uses the same rules (Uneven, Tiled) with the brush\'s size',
    ]],
    ['Beta 3.26', [
      'Oldschool maps: floors mix. Where a new floor meets one that is already there, they change stone by stone (the squares near the edge are one or the other, a few half overgrown, the rougher texture on top), over one square by default. In the Draw panel: Mix Stones, Soft (a fade) or Off, and its width (½ to 3 squares)',
      'Floor → Paint: paint the picked floor into the floors under the brush (stone by stone or soft), for patches of grass, sand or rubble; it adds no floor and changes no walls',
    ]],
    ['Beta 3.25', [
      'Oldschool maps are sharp: on top of the picture lie tiles with as many dots a square as the TV shows (the picture had 80 and looked blurry), and the floor tiles come in their full size. When you draw, only the tiles near the change are made again',
      'No more flash on the table while you draw: a new picture is ready before it takes over',
      'The Depth view is gone: drawn maps stay clear and flat',
      'A clearer 2D look: short, soft shadows (Draw → Shadows: Short, Long or Off), walls with a dark outline and a lit top edge, a shadow where floor meets wall, wall lines and pillars outlined, floors with gentle patches and some grime along the walls (no more stamped look)',
      'A cliff now drops away as a dark rock face into the dark (it glowed before); doors are bigger, with a dark outline',
      'Draw → Ground: water, lava, acid, magical darkness or swamp, as a box, a round or painted. The picture shows the pool, the effect of the same name moves on it (Effects can make it stronger, tint or hide it); Erase takes it away',
      'Doors on drawn maps open on the table: when you open a door, its leaf swings open, on the TV and on your screen',
      'Oldschool maps: the walls for sight lie in the middle of the walls, so under the fog the players see the near half of each wall (the fog\'s soft edge shows a little more): between two rooms the middle of the wall that parts them, wall lines along their middle. A shut door also closes the wall beside it',
      'A small hole in a drawn floor (a lump of rock) blocks sight like a pillar instead of walls all round',
      'New tiles: Desert sand (made new) and Desert stone',
      'Draw: before you draw, the squares show around the pointer, with where it would start: the corner of a room, the corridor\'s width, the brush, the floor that would change',
    ]],
    ['Beta 3.24', [
      'Oldschool maps: the tiles are the grid. The joints of the tiles that come with Tablescape now lie on the squares, and new drawn maps start with the grid line hidden (it is still there for snapping, tokens and measuring)',
      'Right-click a floor in the Draw panel → Adjust grid: squares across, shift sideways and up/down (or drag the lines onto the joints), Find the joints; As it came puts a tile of Tablescape back. Your own tiles open the same window the first time',
      'A test: the TV frame on your screen can be grabbed by its tab and moved over the map, as in the Atlas. The map stays where it is, the TV shows the new part',
    ]],
    ['Beta 3.23', [
      'Oldschool maps: Depth view (Draw panel, per map). The walls, pillars and rock lean away from the middle of the table, so their inner faces show on every side, on the TV and on your screen. Tokens, grid and fog stay on the floor',
      'The TV inks what you draw: a pen traces each new room, its tile fills in, a corridor is painted along, then the finished picture takes over. Secret doors never show',
      'Pieces: eight ready-made rooms in the Draw panel (tavern room, pillared hall, crossroads, round tower, crypt with alcoves, shrine, cave pocket, chasm with a bridge). Click to stamp, Turn or Ctrl + wheel for a quarter turn; their floors take your floor and edge',
      'Drawing a big map needs less of the graphics card',
    ]],
    ['Beta 3.22', [
      'Oldschool maps: Add map → Oldschool map, and draw the map on the grid like on the big squared paper of old. Rooms, round rooms, shapes, corridors, caves with the brush, wall lines, pillars, stairs, doors, secret doors and windows',
      'Every floor gets a tile and an edge: built walls, rock, a ledge or a cliff into darkness. Platforms raised and pits lowered. The light falls from one side, walls cast shadows; Light from turns it',
      'Sixteen tiles come with Tablescape: eleven floors (cobblestone, slate, wood, sand, ice, glowing and lava stones …) and five materials for walls and rock (stone, dark stone, hedge, rock, mossy rock)',
      'Your own tiles go into the new Tiles section of the library; the first time you use one, you say how many squares it spans. Drag one onto a floor to give it that tile',
      'The walls for line of sight follow the drawing (ledges and cliffs block nothing); doors open and close as usual. Ctrl + Z takes anything back',
    ]],
    ['Beta 3.21', [
      'Assets has two tabs: Library (your own pictures and animations) and Living (trees, bushes and mushrooms that move in the wind)',
      'Living shows every kind as a picture: Trees, Bushes, Mushrooms. Pick Small, Medium, Large or Mixed; each one you stamp is turned a little differently',
      'Nine new kinds: cherry, palm, three dead trees, a feathery shrub and three mushrooms',
      'The wind in the trees and the Storm moved from Effects → Weather to the bottom of Assets → Living',
    ]],
    ['Beta 3.20', [
      'Living trees: trees that move in the wind. Library → Assets → Living trees has seven kinds in three sizes; stamp them like any asset, or paint a forest with Scatter. Every tree looks a little different, and the shuffle button on its card gives it another look',
      'They start above the tokens: on the table a crown opens where a token stands under it',
      'Their wind follows the weather (a thunderstorm bends them, snow barely moves them). Effects → Weather → Wind in the trees sets your own, and Storm, also a hotbar button, blows until you click it again',
      'They are drawn by the graphics card. A PC without one shows them as still pictures; Effects quality Medium and Low make them lighter',
    ]],
    ['Beta 3.19', [
      'The home screen menu is one list: Play (glowing), Prepare the maps, Players, Campaign settings, Tablescape settings. One marker: the mouse moves it, the arrow keys go on from there, Enter starts what is marked',
      'TV ready, Speakers and Calibrated left the home screen: they are in Tablescape settings → Table check. While something needs a look, Tablescape settings has an orange dot',
      'In a tall window the campaign sits in the middle, between the top and the campaigns along the bottom',
      'The arrow keys go through the sections of Campaign settings and Tablescape settings',
      'Conversation with players on both sides: both portraits show the same way. A portrait taller than the room between the two bands is made smaller, so no head goes under the other side\'s band',
    ]],
    ['Beta 3.18', [
      'Campaign settings and Tablescape settings. Campaign settings (on the home screen, or the link under the sections of Settings) has the campaign itself, Screens on the table, Looks, Initiative, Players at the table and Tokens on the table. Tablescape settings (the old Options; Settings on the map screen) has the TV, its picture, tokens, sound, performance, this screen and the library',
      'Each campaign keeps its own look, how initiative and the round show, where the players sit, the phones\' rules, how tokens look on the table and the remote\'s buttons. Your campaigns keep what they had; a new campaign starts like the one played last',
      'An export takes them along. As an adventure only the looks go: your remote, the phones\' rules and the seating stay at your table',
    ]],
    ['Beta 3.17', [
      'A new home screen, like a game\'s main menu: your campaigns along the bottom, the one you pick in big letters with its party, Play, Prepare the maps, Continue and its latest maps. Players, Screens on the table, Campaign settings (now with a cover picture) and the table check slide in from the right',
      'Options slide in from the right too, the same panel everywhere',
      'Tablescape starts with a short, still title. A key or a click skips it',
      'A new demo: the maid\'s cottage now comes with a world, a region and a city in the Cartographer, and a busy map to see what your computer can do. New installs start with it; anyone can add it in Options → Library → Add the demo campaign (your campaigns stay as they are, an older demo too)',
    ]],
    ['Beta 3.16', [
      'Handouts lie under a conversation: the portraits on both sides of the table, their band, the turn order and the other screens on the TV now stay in front of them (on the far side the portraits used to disappear behind a handout)',
      'The page on GitHub tells more about what Tablescape does, with pictures of the Cartographer, handouts and initiative',
    ]],
    ['Beta 3.15', [
      'The rows under the table preview stand out: each has a colour with a light at its edge. Red is combat, green is what lies on the TV (a world map, handouts, a conversation), pale orange is the rest. They are sorted by colour, and a row that has just come is brighter for a moment',
      'New rows under the preview, each with a button to end it: the fight (its round, whose turn it is, Next, and End the fight), a world map on the TV (take it off; Zoom out on a regional map), several handouts ("3 handouts": open the Handout table, or put them all away), the spotlight, the join code on the TV with the time it has left, and tokens shown to the table',
      'Map table: the round menu closes easily. A right-click while it is open only closes it (it used to open a new one at once), so do Esc and a click on its middle. A click beside it closes it and does nothing else',
      'Map table: a right-click ends the route you are drawing (Enter and a double click still do). A route with a single point is taken away again',
      'Map table: Move is the tool you come back to. After a place is set, a route ended or a label written it is back by itself; the window always opens with it. Draw and Erase stay until you pick another tool or press Esc',
      'Map table: markers, routes and labels can be picked with any tool but Route, Draw and Erase (with Maps, Grid, On the TV or Weather open, a click on a marker used to move the view instead). A route is picked by a click on its line too',
      'Map table: only what is painted of a marker can be clicked (its plate, its shape, its icon), no longer the empty box round it',
      'Map table: try to drag a locked marker or route and its lock flashes to say why it stays',
    ]],
    ['Beta 3.14', [
      'Cartographer (still in early development): routes are drawn anew. A slim line with a dark edge instead of the string of big dots: dashed, dotted or solid, thin, medium or bold, with an arrow at its end and rounded bends if you like, chosen for each route',
      'Routes snap to the grid: with the grid shown, every point lands on the middle of a cell (hold Alt for a free point). While you draw, the pointer shows what the next leg adds and what the route comes to',
      'A picked route glows. With Lock routes open, its points show as handles: drag one to move it, click the line to add one, right-click one to take it out',
      'Travelled: a slider for each route. The part the party has walked is drawn solid, with a marker where they are',
      'A route\'s name and length stand on a small plate at its middle',
      'Fixed: an animated asset on a world map had its shadow on your screen but not on the TV',
      'Fixed: an animated asset on a world map flickered each time its animation started over',
    ]],
    ['Beta 3.13', [
      'Cartographer (still in early development): double click a place that leads to another map (Move tool) and you are asked whether to open it. On the TV the camera dives into the place, the mist closes, and the other map opens. "Zoom out", top right on every regional map, goes back the same way: the region shrinks away, the mist closes, and the world map opens at that place and pulls back to the view it had',
      'Map table: the TV\'s frame has a round handle at its corner to move it (it pulses until you have used it once). It stays in the picture when the frame\'s corner does not',
      'Map table: right-click the map for a round menu. On empty map: a place, a route, a label or an asset right there, or "TV looks here". On a place, a route or an asset: what can be done with it',
      'Map table: two locks at the top right, Lock markers and Lock routes. They are on at first: markers and routes can be picked and changed, but not dragged by accident. Open a lock to move them',
      'Map table: the tools are sorted. At the top what you use all the time (Move, Place, Route, Draw, Write, Erase), at the bottom what is set once for a map (Maps, Assets, Grid, On the TV, Weather)',
      'Weather on a world map is now the battlemap\'s: the same mixes (Rain, Thunderstorm, Blizzard, Foggy morning …) and single layers, falling over the map; each world map keeps its own. Sunshine stays as a slider of its own. The rain, snow, cloud shadows and storm sliders of Beta 3.12 are gone',
      'Fixed: an animated asset on a world map that reached below the edge of the TV was drawn as long streaks across the screen',
      'A route in the Map table really ends with a double click now (it only ended with Enter)',
    ]],
    ['Beta 3.12', [
      'The Cartographer has been built anew (it is still in early development: tell me what you run into). It now has a window of its own, the Map table (Toolbox → Cartographer): the map as a picture, every tool at its side, as big as you drag it. World maps no longer open in the battlemap editor',
      'Map table: the picture is the whole map, flat, with the TV\'s frame on it (drag its tab to move it, its corner to size it). "As on the TV" shows it the way the players see it; there, dragging and the mouse wheel move the TV\'s camera',
      'Map table, the tools: Maps, Move, Place, Route, Draw, Write, Erase, Assets, Grid (with what one cell stands for), On the TV (tilt, bulge, blur, which side it faces) and Weather. Ctrl + Z takes back the last change to this map, Delete removes what is picked',
      'Places have new markers: a medallion, a diamond or a pin, each with an icon (city, castle, harbour, camp, ruin, danger and more) and a colour of its own',
      'The mist at the edges of a world map is new. It hides where the map ends, with soft bays instead of a line, as wide at the far edge as at the near one: white cloud or dark mist, kept with each map. Reach and Screen edge set how far it comes in',
      'Weather on a world map (each map has its own): cloud shadows drifting over the land, rain, snow, sunshine, and a storm with lightning',
      'Animated assets lie on a world map and move there, tilted and bulged with it (up to 20 at once; more than that stand still)',
      'A world map comes onto the TV, changes and leaves with the table style\'s map change (ink, smoke, parchment …) instead of clouds',
      'Easier on the computer: while a world map is on the TV, the battlemap under it rests; while the Map table is open, the battlemap on your screen rests too',
    ]],
    ['Beta 3.11', [
      'The Cartographer is in early development: it works, but expect rough edges, and it will change. Tell me what you run into',
      'New: the Cartographer (Toolbox). World and regional maps that belong to the campaign, not to a chapter. On the TV such a map lies over the battlemap as an immersive view: tilted, bulged like a globe, sharp in the middle, clouds round the edge. Take it off and the battlemap is there again as it was',
      'A world map is worked on like any map, with the same tools: the picture, the grid (squares or hexes), assets, tokens, drawing and writing. The TV shows the part inside the table frame and flies there when you move it',
      'Places (Mark tool, on a world or regional map): a name and a line under it, standing upright on the map. A place can lead to a regional map (the TV changes to it through the clouds) and bring a note or a handout',
      'Routes (Mark tool): click from point to point, double click to end. A route shows how far it is, counted in grid cells',
      'What one grid cell stands for (Cartographer): "1 day of travel", "6 miles". Routes and the ruler count in it: 17 hexes are 17 days of travel',
      'The view (Cartographer): tilt, bulge, blur and clouds, and which side of the table it faces. A PC without a usable graphics card draws a simpler version of the same view',
    ]],
    ['Beta 3.10', [
      'Assets can be made flat or long. Pick one in the Assets tool and it gets a frame: pull a side to stretch it (the other side stays where it is), a corner to size it, the knob above it to turn it. The frame lies turned the way the asset does',
      'The asset\'s card has "Back to its own shape" once it is stretched, and the Assets panel has a Height slider: for several picked assets at once, and for the next one you place',
      'Assets panel: a Hue slider turns an asset\'s colours (a red banner made blue, green leaves made autumn), also for several at once and for the next one you place',
    ]],
    ['Beta 3.9', [
      'Turning the map with everything on it: painted effects (water, mist, ice, webs, magical darkness, Sway and the others) away from the middle now turn with it. Before, they kept their old outline and showed nothing, or only a slice, at their new place',
      'Start screen: Check for updates is always there, also while a new version is on offer',
      'A new version on offer: Check on GitHub opens its page (what\'s new, the installer, the code) before you install it',
      'Under the hood: the engine Tablescape runs on (Electron) is up to date again, with its latest security fixes. From now on a release is checked for known security problems in what it ships before it goes out',
    ]],
    ['Beta 3.8', [
      'Players\' phones no longer show a handout\'s file name (it could spoil things): a handout shows without any name, the list shows the pictures only, and the name is not sent to the phone at all',
      'Handout table: Ctrl + mouse wheel turns the picked handout (Shift + wheel still does too)',
    ]],
    ['Beta 3.7', [
      'Handout table: the picture of the TV now cuts a handout off where the TV ends, so you see exactly what the players see. The corners, the knob and the ✕ stay inside the picture, also for a handout bigger than the TV',
      'Handouts can be far bigger than the TV (up to six times its short side), to look closely at a part of a map or a letter: the mouse wheel sizes around the pointer, then drag the part you want into view',
      'Turning with the knob no longer catches at quarter turns; the two quarter buttons below make a handout straight',
      'The burn of a handout is drawn by the graphics card now: sharp at any size and smooth',
      'On the phones: a handout marked for everyone or only for some players is on their phones at once, whether it lies on the table or not',
      'Players pick who they are on their phone also when moving by phone is off and no token is on the map (a table with miniatures): handouts only for one player find the right phone',
      'On the phone a handout is handled like a photo: pinch to zoom, drag to move, double tap to zoom in and out',
    ]],
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
        li('screens', b('Two screens. '), 'Tablescape runs on your laptop; the table shows on a TV lying flat (or a projector). ', b('Settings → TV'), ' picks the TV and opens the table there. With one screen only, the table opens as a window, so you can try everything.'),
        li('inch', b('One inch is one inch. '), 'Hold a bank card against the TV and match the outline (Settings → TV → Calibrate). The grid then fits your miniatures: one square is one inch.'),
        li('campaign', b('A campaign has chapters, chapters have maps. '), 'Pick the demo campaign on the home screen, press ', b('Prepare the maps'), ', pick a map, and press ', kbd('T'), ' to send it to the table. What you prepare stays on your screen until you send it.'),
        li('rail', b('The rail on the left. '), 'Build tools on top, Play tools below. Hover a button for what it does and its key; right-click anything on the map for its menu.'),
        li('sound', b('Sound. '), 'Settings → Sound picks the speakers, one for ambience and music, one for effects. Spotify is optional and needs Premium.'),
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
      ['Assets', 'Trees, rocks, furniture, traps; animated ones (webm with transparency) in Assets/Animated. Living trees come with Tablescape: they move in the wind'], ['Overlays', 'Rain, fog, embers over the whole table'],
      ['Sounds', 'Ambience, Music, SFX'], ['Portraits', 'NPC faces for conversations'], ['Handouts', 'Letters and pictures to show the players'], ['Tiles', 'Seamless floors for Oldschool maps (Tablescape brings seventeen)'], ['Campaigns', 'Your campaigns: one folder each, with backups inside'],
    ];
    return h('div', { class: 'guide-text' },
      h('h3', {}, 'The library'),
      p('Everything Tablescape shows lives in one folder, the library. Put your own files into its folders, or drop them onto the map or the library drawer (', kbd('L'), '): they are copied in.'),
      root ? h('p', { class: 'guide-path' }, iconEl('folder'), h('code', {}, root), h('button', { class: 'btn small ghost', onclick: () => ts.library('open') }, 'Open')) : null,
      h('div', { class: 'guide-table' }, ...folders.map(([n, d]) => h('div', { class: 'guide-row' }, h('b', {}, n), h('span', {}, d)))),
      p('Settings → Library shows where the library is and can ', b('move'), ' it, to another disk for instance. A sync folder (OneDrive, Dropbox) works, but syncing while you play can make files busy for a moment.'),
      h('h3', {}, 'Animated assets'),
      p('An animated asset is prepared the first time a map uses it (the little maid runs along the top meanwhile). Settings → Performance lists them.'),
      h('h3', {}, 'Safety net'),
      h('ul', { class: 'guide-list' },
        li(b('Backups '), '(… on a campaign): a copy is made each time you open a campaign; the last 10 are kept.'),
        li(b('Recently deleted '), 'on the home screen keeps deleted campaigns until you empty it.'),
        li(b('Missing files '), 'are listed in the table check (home screen, the line under the menu) when a map, token or sound moved; open its map to find it again.')));
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
    try { if (typeof App !== 'undefined' && App.helpSections) groups.push(['Campaign settings', App.helpSections('camp')], ['Tablescape settings', App.helpSections('app')]); } catch { /* */ }
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
        li('A stuttering TV: Settings → Performance. The benchmark measures the map on the TV; "Graphics card vs processor" keeps the better way of drawing animations.'),
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
    const UPD = { idle: 'Check for updates', latest: 'Up to date · check again', checking: 'Checking …', available: 'Update available: see the home screen', downloading: 'Downloading the update …', ready: 'Update ready: restart on the start screen', error: 'Update check failed · try again', off: '' };
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
