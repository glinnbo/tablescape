// Renders one map. Used by the GM window (one view, with camera and editing)
// and by the table window (live view + a paused, preloaded prep view).
//
// Two coordinate systems:
//   table inches: the physical TV surface (0,0 = top left of the screen)
//   map inches:   the map's own space. map.view = { x, y, zoom } places it on the table:
//                 tableInches = view.xy + mapInches * zoom
// Everything that belongs to the map (background, tokens, fog, grid, effects,
// spell areas) lives in map inches, so moving the map moves all of it.
// Weather and "table" overlays ignore the view: they cover the whole TV.
//
// Layer order, bottom to top:
//   map background > (grid, when it lies under the assets) > assets, atmosphere overlays > atmosphere effects >
//   grid > magical darkness > tokens >
//   darkness and lights > spell areas > pen drawings > labels, markers, counters > spell badges > fog >
//   weather overlays > weather > ink (chalk, ruler, spotlight, round badge, GM notes) > GM handles > pings
'use strict';

const FogCache = new Map(); // mapId -> fog object (fog is only resent when it changed)
const MaskCache = new Map(); // fog op id -> the picture of a folded fog
const FOG_SCALE = 0.5;
const FOG_M = 40; // fog canvas overhangs the table so the soft edge never shows at the border
const FOG_BLUR = 6; // the fog's soft edge in table pixels (drawn into the fog picture, 4.4)
const T0 = 1.7e9; // seconds; keeps animation time small so the trig stays smooth

class SceneView {
  constructor(host, { gm = false } = {}) {
    this.gm = gm;
    this.root = div('sv');
    this.world = div('sv-world');
    this.mapA = div('sv-map');
    this.bgLayer = div('sv-bg');
    this.overlaysEl = div('sv-overlays');
    this.assetsEl = div('sv-assets');
    this.mapA.append(this.bgLayer);
    this.mapA2 = div('sv-map'); // assets and atmosphere overlays: the grid can lie between them and the background
    this.mapA2.append(this.assetsEl, this.overlaysEl);
    // Prototype 18: assets "in front of the effects": above the mist and smoke (and the grid), still under the tokens and the light
    this.mapA3 = div('sv-map');
    this.assetsFrontEl = div('sv-assets sv-assets-front');
    this.mapA3.append(this.assetsFrontEl);
    // Prototype 23: assets above the tokens (tree tops, roofs, bridges): on the TV see-through where a token stands under
    // them, on your screen half see-through
    this.mapA4 = div('sv-map');
    this.assetsOverEl = div('sv-assets sv-assets-over');
    this.mapA4.append(this.assetsOverEl);
    this.mapB = div('sv-map');
    this.tokensEl = div('sv-tokens');
    this.mapB.append(this.tokensEl);
    // Prototype 14: the name tags in a layer of their own above the light, so darkness never swallows them (under the fog)
    this.mapT = div('sv-map sv-tagmap');
    this.tagsEl = div('sv-tags');
    this.mapT.append(this.tagsEl);
    this.cv = {
      sway: layerCanvas('sv-sway', 3840), // (Beta 3.1) the map picture moving where Sway is painted: as sharp as the map
      atmo: layerCanvas('sv-atmo', 1280),
      grid: layerCanvas('sv-gridc', 3840),
      veil: layerCanvas('sv-veil', 1280), // magical darkness: above the grid, under the tokens
      light: layerCanvas('sv-light', 960),
      glow: layerCanvas('sv-glow', 960), // the colour lights throw on the map, blended in 'color' mode
      dv: layerCanvas('sv-dv', 640), // (Prototype 14) where only darkvision sees: grey, blended in 'saturation' mode
      spell: layerCanvas('sv-spell', 1600),
      weather: layerCanvas('sv-weather', 1280),
      moment: layerCanvas('sv-moment', 1280), // screen moments (moments.js): over everything on the map
    };
    // pen drawings: map space, so they stay put on the map
    this.mapC = div('sv-map sv-drawmap');
    this.penSvg = svgEl('svg', { class: 'sv-pen', width: 1, height: 1 });
    this.mapC.append(this.penSvg);
    // text labels, markers and counters: table space at a fixed physical size
    this.annoEl = div('sv-anno');
    // ink: chalk, ruler and spotlight (sent live by the GM), round badge, GM notes
    this.inkEl = div('sv-ink');
    this.spotEl = div('sv-spot');
    this.inkSvg = svgEl('svg', { class: 'sv-ink-svg' });
    this.inkSvg.innerHTML = '<defs><filter id="chalk-grain" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>';
    this.measureEl = div('sv-measure-label');
    this.notesEl = div('sv-notes');
    this.roundEl = div('sv-round');
    this.roundEl2 = div('sv-round far'); // the same badge turned towards the far side of the table
    // a new round is announced with a banner across the table, once per long side
    this.roundBanners = ['near', 'far'].map((side) => div(`sv-round-banner ${side}`));
    this.inkEl.append(this.spotEl, this.inkSvg, this.measureEl, this.notesEl, ...this.roundBanners, this.roundEl, this.roundEl2);
    this.hud = 1; this.hudBoth = true; // size of text and panels on the TV, players on both long sides
    this.tokLook = { pic: { ...Geom.PIC_DEFAULT }, numbers: true, turnGlow: true, shadow: false, tagSize: 1 }; // 4.10: Options → Tokens
    this.roundLook = { x: 0.07, y: 0.07, size: 1.4, banner: true, mode: 'auto' }; // where the round sits (near copy), its size
    this.roundSeen = null; // { mapId, n } the round last shown, to announce a new one
    this.labelsEl = div('sv-labels');
    this.fogEl = document.createElement('canvas');
    this.fogEl.className = 'sv-fog';
    this.tableOv = div('sv-table-ov');
    this.wallsEl = div('sv-walls'); // GM only: walls and doors (Walls tool), door markers (Select tool)
    this.glassEl = div('sv-walls sv-glass'); // (Prototype 14) TV only: the windows, under the fog
    this.areasEl = div('sv-areas'); // GM only: marked areas, the room under the mouse, an area being drawn (Fog tool)
    this.areaMode = false; this.roomPreview = null; this.areaDraft = null; this.areaSig = '';
    this.wallMode = false; // false | 'doors' | 'edit'
    this.wallSel = null; this.wallPreview = null; this.wallSig = '';
    this.handlesEl = div('sv-handles');
    this.marks = div('sv-marks');
    // GM only: the map goes on beyond the TV's edge; that part is dimmed (things there can still be reached)
    this.offEl = div('sv-off');
    this.moments = []; this.momentsLive = false; this.momentSig = '';
    this.world.append(this.mapA, this.cv.sway.el, this.mapA2, this.cv.atmo.el, this.cv.grid.el, this.mapA3, this.cv.veil.el, this.cv.dv.el, this.mapB, this.mapA4, this.cv.light.el, this.cv.glow.el, this.cv.spell.el,
      this.mapC, this.mapT, this.annoEl, this.glassEl, this.labelsEl, this.fogEl, this.offEl, this.wallsEl, this.areasEl, this.tableOv, this.cv.weather.el, this.cv.moment.el, this.inkEl, this.handlesEl, this.marks);
    this.root.appendChild(this.world);
    host.appendChild(this.root);

    this.cam = { s: 1, tx: 0, ty: 0, auto: true };
    this.map = null;
    this.view = null;
    this.playing = true;
    this.nodes = new Map();
    this.broken = new Set();
    this.bgNode = null;
    this.selected = null; // token id
    this.selAssets = new Set();
    this.selectedMark = null; // marker, counter, note or text label
    this.chalk = new Map(); // live chalk strokes: id -> { pts (map inches), color, w (table inches), t, ended, els }
    this.measureState = null;
    this.spot = null;
    this.inkTimer = 0;
    this.penSig = ''; this.annoSig = ''; this.noteSig = ''; this.roundSig = '';
    this.selectedFx = null;
    this.selectedSpell = null;
    this.showHandles = false;
    this.ghost = null; // spell preview while placing
    this.gridPreview = null; // grid preview while matching a printed grid
    this.geoCache = new Map();
    this.fogSig = '';
    this.gridSig = '';
    this.sizeSig = '';
    this.labelSig = '';
    this.handleSig = '';
    this.pinned = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.stats = { frames: 0, spells: 0, emitters: 0, regions: 0, veil: 0, lights: 0, weather: 'none', sight: 0, shadowed: 0 };
    this.handlers = { render: [], broken: [], pin: [], thunder: [] };
    this.strikeAt = 0;
    this.strikeSeed = 1;
    this.heardFlash = new Set();
    this.turnIds = new Set(); // tokens whose turn it is (initiative)
    this.loop = this.loop.bind(this);
    this.ro = new ResizeObserver(() => (this.cam.auto ? this.fit() : this.applyCamera()));
    this.ro.observe(this.root);
    // 2.3: animated assets drawn from frame sheets (anim.js), their own clock; videos and sheets off the screen rest
    this.baked = new Set();
    this.bakedRaf = 0; this.bakedLast = 0;
    this.animMode = gm ? 'light' : 'smooth'; // the GM screen draws them lighter (Options → Performance)
    this.fxMode = gm ? 'light' : 'smooth'; // Prototype 19: the effects, weather and flickering light on the GM screen too
    this.bakedLoop = this.bakedLoop.bind(this);
    this.io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((list) => this.onSeen(list), { rootMargin: '64px' }) : null;
    this.unAnim = typeof AnimCache === 'object' ? AnimCache.on((path, what) => this.onSheet(path, what)) : null;
  }

  // ---------- units ----------
  get ppi() { return this.view ? this.view.ppi : 50; }
  get W() { return this.view ? this.view.world.w : 1920; }
  get H() { return this.view ? this.view.world.h : 1080; }
  get v() { return (this.map && this.map.view) || { x: 0, y: 0, zoom: 1 }; }
  // one display pixel (on a 1080p-equivalent screen) in map inches
  get pxMap() { return (this.W / 1920) / (this.ppi * this.v.zoom); }
  mapToTable(x, y) { const v = this.v; return { x: v.x + x * v.zoom, y: v.y + y * v.zoom }; }
  tableToMap(x, y) { const v = this.v; return { x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom }; }
  mapToPx(x, y) { const t = this.mapToTable(x, y); return { x: t.x * this.ppi, y: t.y * this.ppi }; }
  // the table's rectangle, in map inches
  tableRectInMap() {
    const v = this.v;
    return { x: -v.x / v.zoom, y: -v.y / v.zoom, w: this.W / this.ppi / v.zoom, h: this.H / this.ppi / v.zoom };
  }
  mapXform(ctx, res) {
    const v = this.v;
    const k = this.ppi * v.zoom * res;
    const R = this.R; // (Prototype 5: where the effect layers lie, in table pixels; the table itself unless the view is wide)
    ctx.setTransform(k, 0, 0, k, (v.x * this.ppi - (R ? R.x : 0)) * res, (v.y * this.ppi - (R ? R.y : 0)) * res);
  }

  // ---------- Prototype 5: the whole map in the Build tools (GM) ----------
  // The effect layers (atmosphere, magical darkness, light, colour, spells, weather, grid) were as big as the table,
  // so beyond the TV's edge the GM saw the bare picture under a grey veil. Wide: they cover what the window shows
  // (plus a margin, so a small pan needs no new drawing), with the same number of pixels across the screen as before.
  // What keeps it affordable on a big map:
  //   - the layers follow the window, not the map: their size in pixels does not grow with the map
  //   - effects that lie off the table are kept as one picture (drawAtmoWide) that is drawn again now and then: more
  //     seldom the longer it takes, not at all when a grid square is only a few pixels on the screen
  //   - the whole view draws more seldom when a frame takes long (loop)
  setWide(on) {
    on = !!on && this.gm;
    if (on === !!this.wideOn) return;
    this.wideOn = on;
    this.root.classList.toggle('sv-wide', on);
    this.far = null;
    this.layoutLayers(true);
  }
  // what the window shows, in table pixels
  windowRect() {
    const s = this.cam.s || 1;
    return { x: -this.cam.tx / s, y: -this.cam.ty / s, w: (this.root.clientWidth || this.W) / s, h: (this.root.clientHeight || this.H) / s };
  }
  layerRect() {
    if (!this.wideOn) return { x: 0, y: 0, w: this.W, h: this.H };
    const V = this.windowRect(); const R = this.R;
    // the one in use still covers the window and is not much too big or too coarse: it stays (no drawing while panning a little)
    if (R && this.rectWide && V.x >= R.x && V.y >= R.y && V.x + V.w <= R.x + R.w && V.y + V.h <= R.y + R.h && R.w <= V.w * 1.7 && R.h <= V.h * 1.7) return R;
    const m = 0.15;
    return { x: Math.floor(V.x - V.w * m), y: Math.floor(V.y - V.h * m), w: Math.ceil(V.w * (1 + 2 * m)), h: Math.ceil(V.h * (1 + 2 * m)) };
  }
  layoutLayers(force) {
    const R = this.layerRect();
    const sig = `${R.x},${R.y},${R.w},${R.h}|${this.W}x${this.H}|${this.qres || 1}`;
    if (!force && sig === this.rectSig) return;
    this.rectSig = sig; this.R = R; this.rectWide = !!this.wideOn;
    for (const [name, c] of Object.entries(this.cv)) {
      const table = name === 'moment' || !this.wideOn; // (screen moments play on the table)
      if (name !== 'grid') c.maxW = c.baseW * (this.qres || 1) * (table ? 1 : 1.3);
      const r = table ? { x: 0, y: 0, w: this.W, h: this.H } : R;
      sizeCanvas(c, r.w, r.h);
      c.el.style.left = `${r.x}px`; c.el.style.top = `${r.y}px`;
    }
    this.gridSig = ''; this._seen = null;
    if (this.map) { this.renderGrid(true); this.redrawSoon(); }
  }
  redrawSoon() {
    if (this.redrawRaf) return;
    this.redrawRaf = requestAnimationFrame(() => { this.redrawRaf = 0; if (this.map) this.drawFrame(); });
  }
  // the rectangle the layers cover, in map inches
  layerRectInMap() {
    const v = this.v; const R = this.R || { x: 0, y: 0, w: this.W, h: this.H };
    return { x: (R.x / this.ppi - v.x) / v.zoom, y: (R.y / this.ppi - v.y) / v.zoom, w: R.w / this.ppi / v.zoom, h: R.h / this.ppi / v.zoom };
  }

  // ---------- state ----------
  setView(view) {
    this.view = view;
    this.root.style.setProperty('--ppi', `${this.ppi}px`);
    const sig = `${this.W}x${this.H}`;
    if (sig !== this.sizeSig) {
      this.sizeSig = sig;
      this.world.style.width = `${this.W}px`;
      this.world.style.height = `${this.H}px`;
      this.layoutLayers(true);
      this.inkSvg.setAttribute('width', this.W);
      this.inkSvg.setAttribute('height', this.H);
      this.gridSig = '';
      this.fit();
    }
  }

  setMap(map) {
    if (!map) { this.clear(); return; }
    this.mapRev = (this.mapRev || 0) + 1;
    if (!map.fog) {
      if (!FogCache.has(map.id)) SceneView.needResync();
      map.fog = FogCache.get(map.id) || { enabled: false, base: 'cover', ops: [] };
      if (typeof map.fogOn === 'boolean') map.fog.enabled = map.fogOn; // fog on or off: only that comes, the fog itself stays (2.2)
    }
    FogCache.set(map.id, map.fog);
    const switched = !this.map || this.map.id !== map.id;
    this.map = map;
    if (switched) { this.fogSig = ''; this.gridSig = ''; this.geoCache.clear(); this.pinned = null; }
    if (this.live) this.endLive(); // 4.4: the map stopped moving: everything is drawn anew for where it is
    const t = `translate(${this.v.x * this.ppi}px, ${this.v.y * this.ppi}px) scale(${this.v.zoom})`;
    this.tagSize();
    this.mapA.style.transform = t;
    this.mapA2.style.transform = t;
    this.mapA3.style.transform = t;
    this.mapA4.style.transform = t;
    this.mapB.style.transform = t;
    this.mapC.style.transform = t;
    this.mapT.style.transform = t;
    if (switched) { this.chalk.clear(); this.measureState = null; this.spot = null; }
    // 4.8: the Map tool is in hand: the fog keeps its wide margin (ready for a move)
    if (this.keepWide && !this.live && this.map.fog && this.map.fog.enabled && this.fogM !== this.wideM()) { this.fogM = this.wideM(); this.fogSig = ''; }
    this.renderBg();
    this.renderLook();
    this.renderLayers();
    this.renderGrid();
    this.renderFog();
    for (const id of this.geoCache.keys()) if (!map.spells.some((s) => s.id === id)) this.geoCache.delete(id);
    this.renderLabels();
    this.renderPen();
    this.renderAnno();
    this.renderNotes();
    this.renderRound();
    this.renderInk();
    this.renderHandles();
    this.renderWalls();
    this.renderAreas();
    this.renderTrails();
    this.drawFrame();
    this.updateAnimation();
    this.emit('render');
  }

  // ---------- 4.4: the map moving (a drag, Alt + wheel, the size slider) ----------
  // Moving a big map used to draw everything anew for every step (the fog stroke by stroke, then blurred again over the
  // whole table). Now, while it moves: the map's own layers take the new place at once (one transform each); what is
  // drawn in table space (fog, grid, markers, walls, notes …) slides along as a picture, drawn for the view it had
  // when the move began; the animated canvases (effects, light) draw with the new place in their next frame. The next
  // full state (main sends it when the move ends) draws it all anew. The fog is drawn once with a wide margin, so
  // it still covers the table while the map slides; when the map has moved beyond that, it is drawn once more.
  liveEls() { return [this.cv.grid.el, this.annoEl, this.glassEl, this.labelsEl, this.wallsEl, this.areasEl, this.handlesEl, this.notesEl, this.marks]; }
  setViewLive(view) {
    if (!this.map || !view) return;
    if (!this.live) {
      this.live = { base: { ...this.v }, fogBase: { ...this.v } };
      // 4.5.1: the moving layers stay layers of their own on the graphics card for the whole move, also while the
      // hand rests (without this the browser may flatten them at rest and has to lift them out again: a stutter)
      for (const el of [this.mapA, this.mapA2, this.mapA3, this.mapA4, this.mapB, this.mapC, this.mapT, this.fogEl, ...this.liveEls()]) el.style.willChange = 'transform';
      // the fog with a wide margin, so it still covers the table while it slides (4.8: already there when the Map tool
      // prepared it, so the first step does not stutter)
      if (this.map.fog && this.map.fog.enabled && (this.fogM !== this.wideM() || this.fogSig !== this.fogSignature())) { this.fogM = this.wideM(); this.fogSig = ''; this.renderFog(true); }
    }
    this.map.view = { ...this.map.view, ...view };
    const v = this.v; const ppi = this.ppi;
    const t = `translate(${v.x * ppi}px, ${v.y * ppi}px) scale(${v.zoom})`;
    for (const el of [this.mapA, this.mapA2, this.mapA3, this.mapA4, this.mapB, this.mapC, this.mapT]) el.style.transform = t;
    this.tagSize();
    const delta = (b) => { const k = v.zoom / b.zoom; return { k, x: ppi * (v.x - b.x * k), y: ppi * (v.y - b.y * k) }; };
    const a = delta(this.live.base);
    const tf = `translate(${a.x}px, ${a.y}px) scale(${a.k})`;
    for (const el of this.liveEls()) { el.style.transformOrigin = '0 0'; el.style.transform = tf; }
    if (this.map.fog && this.map.fog.enabled && this.fogOps) {
      const f = delta(this.live.fogBase); const M = this.fogM || FOG_M; const pad = 24; // (the blur at the fog's edge)
      const covers = f.x - M * f.k <= -pad && f.y - M * f.k <= -pad && f.x + (this.W + M) * f.k >= this.W + pad && f.y + (this.H + M) * f.k >= this.H + pad;
      if (covers) { this.fogEl.style.transformOrigin = `${M}px ${M}px`; this.fogEl.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.k})`; }
      else { this.fogSig = ''; this.renderFog(true); } // moved beyond the margin: drawn once more where the map is now
    }
    // nothing animated: the effects and the light are drawn once for the new place (4.8: held still, at most a few times a second)
    if (!this.raf) { const now = performance.now(); if (!this.stillHold || now - (this.stillDrawAt || 0) > 160) { this.stillDrawAt = now; this.drawFrame(); } }
    this.stats.liveMoves = (this.stats.liveMoves || 0) + 1;
  }
  endLive() {
    for (const el of this.liveEls()) el.style.transform = '';
    for (const el of [this.mapA, this.mapA2, this.mapA3, this.mapA4, this.mapB, this.mapC, this.mapT, this.fogEl, ...this.liveEls()]) el.style.willChange = '';
    this.fogEl.style.transform = '';
    this.live = null;
    if (this.fogM && this.fogM !== FOG_M && !this.keepWide) { this.fogM = FOG_M; this.fogSig = ''; }
  }
  wideM() { return Math.round(Math.max(this.W, this.H) * 0.4); }
  // 4.8: the Map tool is in hand: the fog is kept with its wide margin, so a drag starts without drawing it first
  prepareMove(on) {
    on = !!on;
    if (on === !!this.keepWide) return;
    this.keepWide = on;
    if (on && this.map && this.map.fog && this.map.fog.enabled && !this.live && this.fogM !== this.wideM()) { this.fogM = this.wideM(); this.fogSig = ''; this.renderFog(true); }
    if (!on && !this.live && this.fogM && this.fogM !== FOG_M) { this.fogM = FOG_M; this.fogSig = ''; if (this.map) this.renderFog(true); }
  }
  // 4.8: while the GM drags the map, everything on this screen stands still (effects, light, weather, animated assets,
  // videos); it plays on when the map is let go. The TV keeps playing.
  holdStill(on) {
    on = !!on;
    if (on === !!this.stillHold) return;
    if (on) { this.stillHold = { playing: this.playing }; this.setPlaying(false); return; }
    const was = this.stillHold.playing;
    this.stillHold = null;
    this.setPlaying(was);
    if (this.map) this.drawFrame();
  }

  clear() {
    this.live = null;
    this.map = null;
    if (this.bgNode) { this.bgNode.el.remove(); this.bgNode = null; }
    for (const n of this.nodes.values()) this.dropNode(n);
    this.nodes.clear();
    this.broken.clear();
    const ctx = this.fogEl.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fogEl.width, this.fogEl.height);
    this.fogSig = ''; this.sightSig = '';
    this.wallsEl.innerHTML = ''; this.wallSig = ''; this.glassEl.innerHTML = ''; this.glassSig = '';
    for (const c of Object.values(this.cv)) clearCanvas(c);
    this.labelsEl.innerHTML = '';
    this.handlesEl.innerHTML = '';
    this.penSvg.innerHTML = '';
    this.annoEl.innerHTML = '';
    this.notesEl.innerHTML = '';
    this.roundEl.innerHTML = ''; this.roundEl2.innerHTML = '';
    this.chalk.clear(); this.measureState = null; this.spot = null;
    this.renderInk();
    this.gridSig = ''; this.labelSig = ''; this.handleSig = ''; this.penSig = ''; this.annoSig = ''; this.noteSig = ''; this.roundSig = '';
    this.updateAnimation();
  }

  destroy() {
    this.dead = true;
    this.setPlaying(false);
    clearInterval(this.inkTimer);
    this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this.unAnim) this.unAnim();
    cancelAnimationFrame(this.bakedRaf); this.bakedRaf = 0;
    for (const n of this.nodes.values()) { this.dropSheet(n); if (n.media) { n.media.removeAttribute('src'); n.media.load?.(); } }
    if (this.bgNode && this.bgNode.kind === 'video') { this.bgNode.el.removeAttribute('src'); this.bgNode.el.load(); }
    this.root.remove();
  }

  // videos play while the view plays, unless the GM screen shows them as still pictures (Effects quality: Low)
  videoOn() { return this.playing && !this.stillVideo; }
  setPlaying(on) {
    this.playing = on;
    const all = [];
    if (this.bgNode && this.bgNode.kind === 'video') all.push(this.bgNode.el);
    for (const n of this.nodes.values()) if (n.media && (n.media.tagName === 'VIDEO' || n.media.tagName === 'AUDIO') && !n.off) all.push(n.media);
    for (const m of all) { if (on && !(m.tagName === 'VIDEO' && this.stillVideo)) m.play().catch(() => {}); else m.pause(); }
    this.updateAnimation();
    this.updateBaked();
  }

  // Effects quality: resolution of the effect layers, frames per second on the TV, still videos on the GM screen
  setQuality(q) {
    const level = q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high';
    if (level === this.quality) return;
    this.quality = level;
    const res = { high: 1, medium: 0.8, low: 0.6 }[level];
    this.qres = res;
    if (this.W) this.layoutLayers(true);
    this.frameGap = level === 'low' ? 30 : 0; // about 30 frames a second on Low
    const still = this.gm && level === 'low';
    if (still !== !!this.stillVideo) {
      this.stillVideo = still;
      const vids = [];
      if (this.bgNode && this.bgNode.kind === 'video') vids.push(this.bgNode.el);
      for (const n of this.nodes.values()) if (n.media && n.media.tagName === 'VIDEO' && !n.off) vids.push(n.media);
      for (const v of vids) { if (this.videoOn()) v.play().catch(() => {}); else v.pause(); }
      this.updateBaked();
    }
    this.gridSig = '';
    if (this.map) this.drawFrame();
  }

  // Resolves when the background has a frame to show (or after a timeout).
  ready(timeout = 2500) {
    return new Promise((resolve) => {
      const b = this.bgNode;
      if (!b) return resolve();
      const ok = b.kind === 'video' ? b.el.readyState >= 2 : b.el.complete && b.el.naturalWidth > 0;
      if (ok) return resolve();
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, timeout);
      b.el.addEventListener(b.kind === 'video' ? 'loadeddata' : 'load', done, { once: true });
      b.el.addEventListener('error', done, { once: true });
    });
  }

  // ---------- 4.5: the map's look: brightness, contrast, saturation, warmth (Build → Map) ----------
  // One colour matrix (an SVG filter) on the picture and the assets on it; tokens, effects, light and fog stay as they are.
  // A colour matrix works pixel by pixel on the graphics card, so a big map still moves as smoothly.
  renderLook() {
    const L = this.peek ? null : SceneView.lookOf(this.map && this.map.look);
    const sig = L ? L.join(',') : '';
    if (sig === this.lookSig) return;
    this.lookSig = sig;
    // (Beta 3.2: the Sway layer too: it shows the map picture moving, and showed it without the look)
    if (!L) { this.bgLayer.style.filter = ''; this.cv.sway.el.style.filter = ''; this.assetsEl.style.filter = ''; this.assetsFrontEl.style.filter = ''; this.assetsOverEl.style.filter = ''; return; }
    if (!this.lookEl) {
      SceneView.lookN = (SceneView.lookN || 0) + 1;
      this.lookId = `sv-look-${SceneView.lookN}`;
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      const f = document.createElementNS(NS, 'filter');
      f.id = this.lookId;
      f.setAttribute('color-interpolation-filters', 'sRGB');
      this.lookEl = document.createElementNS(NS, 'feColorMatrix');
      this.lookEl.setAttribute('type', 'matrix');
      f.append(this.lookEl); svg.append(f); this.root.append(svg);
    }
    this.lookEl.setAttribute('values', L.join(' '));
    const url = `url(#${this.lookId})`;
    this.bgLayer.style.filter = url; this.cv.sway.el.style.filter = url; this.assetsEl.style.filter = url; this.assetsFrontEl.style.filter = url; this.assetsOverEl.style.filter = url;
  }
  // hold to see the map without its look (the Map tool's "Original" button)
  setPeek(on) { this.peek = !!on; this.renderLook(); }
  // the colour matrix for a look (null when it changes nothing)
  static lookOf(look) {
    if (!look) return null;
    const n = (v, d, a, b) => { const x = Number(v); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
    const bri = n(look.bright, 1, 0.3, 2); const con = n(look.contrast, 1, 0.3, 2); const sat = n(look.sat, 1, 0, 2.5); const w = n(look.warm, 0, -1, 1);
    if (Math.abs(bri - 1) < 0.005 && Math.abs(con - 1) < 0.005 && Math.abs(sat - 1) < 0.005 && Math.abs(w) < 0.005) return null;
    const lr = 0.2126; const lg = 0.7152; const lb = 0.0722;
    const S = [[lr, lg, lb], [lr, lg, lb], [lr, lg, lb]].map((row, i) => row.map((v, j) => v * (1 - sat) + (i === j ? sat : 0)));
    const W = [1 + 0.14 * w, 1 + 0.03 * w, 1 - 0.18 * w]; // warmer: more red, less blue
    const k = bri * con; const off = bri * 0.5 * (1 - con);
    const out = [];
    for (let i = 0; i < 3; i++) out.push(...S[i].map((v) => +(v * W[i] * k).toFixed(4)), 0, +off.toFixed(4));
    out.push(0, 0, 0, 1, 0);
    return out;
  }

  // ---------- background (map space) ----------
  renderBg() {
    const bg = this.map.bg;
    if (!bg) { if (this.bgNode) { this.bgNode.el.remove(); this.bgNode = null; } this.broken.delete('bg'); return; }
    if (!this.bgNode || this.bgNode.url !== bg.url) {
      if (this.bgNode) this.bgNode.el.remove();
      const el = makeMedia(bg.kind, bg.url, bg.kind === 'video' ? this.videoOn() : this.playing);
      const node = { el, url: bg.url, kind: bg.kind, nw: 0, nh: 0 };
      this.bgNode = node;
      this.pinned = null; // a new background is fitted (and fixed) again
      el.addEventListener(bg.kind === 'video' ? 'loadedmetadata' : 'load', () => {
        node.nw = bg.kind === 'video' ? el.videoWidth : el.naturalWidth;
        node.nh = bg.kind === 'video' ? el.videoHeight : el.naturalHeight;
        this.broken.delete('bg');
        this.layoutBg();
        this.layoutOverlays();
        this.emit('broken');
        this.emit('render');
      });
      el.addEventListener('error', () => { this.broken.add('bg'); this.emit('broken'); });
      this.bgLayer.appendChild(el);
    }
    if (bg.kind === 'video') {
      const v = this.bgNode.el;
      const vol = this.gm ? 0 : (bg.volume || 0);
      v.muted = vol === 0;
      v.volume = clamp(vol, 0, 1);
      if (v.playbackRate !== (bg.rate || 1)) v.playbackRate = bg.rate || 1;
    }
    this.layoutBg();
  }

  // Placement in map inches. scale = map inches per source pixel.
  bgPlacement() {
    const bg = this.map && this.map.bg;
    const n = this.bgNode;
    if (!bg || !n || !n.nw) return null;
    if (bg.scale == null && bg.span) {
      // placed by its width (maps with walls from a file): the same on every screen, whatever the pixel size
      const sc = bg.span / n.nw;
      return { x: bg.x || 0, y: bg.y || 0, scale: sc, w: bg.span, h: n.nh * sc, nw: n.nw, nh: n.nh, fit: false };
    }
    if (bg.scale == null) {
      // not placed yet: fit the table as it is now
      const r = this.tableRectInMap();
      const s = Math.min(r.w / n.nw, r.h / n.nh);
      return { x: r.x + (r.w - n.nw * s) / 2, y: r.y + (r.h - n.nh * s) / 2, scale: s, w: n.nw * s, h: n.nh * s, nw: n.nw, nh: n.nh, fit: true };
    }
    return { x: bg.x, y: bg.y, scale: bg.scale, w: n.nw * bg.scale, h: n.nh * bg.scale, nw: n.nw, nh: n.nh, fit: false };
  }
  // the picture's turn (degrees) and the box it takes up turned: for Fit to table, overlays that cover the map
  bgTurn() { return (this.map && this.map.bg && this.map.bg.rotation) || 0; }
  bgBox() {
    const p = this.bgPlacement();
    if (!p) return null;
    const a = (this.bgTurn() * Math.PI) / 180;
    if (!a) return { x: p.x, y: p.y, w: p.w, h: p.h, cx: p.x + p.w / 2, cy: p.y + p.h / 2 };
    const c = Math.abs(Math.cos(a)); const sn = Math.abs(Math.sin(a));
    const w = p.w * c + p.h * sn; const h = p.w * sn + p.h * c;
    const cx = p.x + p.w / 2; const cy = p.y + p.h / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  }
  layoutBg() {
    const p = this.bgPlacement();
    if (!p) return;
    const e = this.bgNode.el;
    const ppi = this.ppi;
    e.style.width = `${p.nw}px`;
    e.style.height = `${p.nh}px`;
    const turn = this.bgTurn();
    // turned around its own centre (any angle: the graphics card draws it)
    e.style.transform = turn ? `translate(${p.x * ppi}px, ${p.y * ppi}px) translate(${(p.w * ppi) / 2}px, ${(p.h * ppi) / 2}px) rotate(${turn}deg) translate(${(-p.w * ppi) / 2}px, ${(-p.h * ppi) / 2}px) scale(${p.scale * ppi})`
      : `translate(${p.x * ppi}px, ${p.y * ppi}px) scale(${p.scale * ppi})`;
    // The GM window fixes a fitted placement once, so later moves keep the map where it is.
    if (p.fit && this.gm && this.pinned !== this.map.id) {
      this.pinned = this.map.id;
      this.emit('pin', { x: p.x, y: p.y, scale: p.scale, nw: p.nw, nh: p.nh });
    } else if (!p.fit && this.gm && this.map.bg && !this.map.bg.nw && this.pinned !== `${this.map.id}|size`) {
      // older maps: tell main the picture's size once, so walls from a file can be placed on it
      this.pinned = `${this.map.id}|size`;
      this.emit('pin', { nw: p.nw, nh: p.nh });
    }
  }

  // ---------- grid ----------
  setGridPreview(g) { this.gridPreview = g; this.renderGrid(true); }
  renderGrid(force) {
    if (!this.map) return;
    const g = this.gridPreview || this.map.grid;
    // over everything, or under the assets (trees and furniture cover the lines)
    const under = !!this.map.grid.under;
    if (under !== this.gridUnder) {
      this.gridUnder = under;
      this.world.insertBefore(this.cv.grid.el, under ? this.mapA2 : this.mapA3);
    }
    const v = this.v;
    const sig = JSON.stringify([g, v, this.W, this.H, this.ppi, this.rectSig]);
    if (!force && sig === this.gridSig) return;
    this.gridSig = sig;
    const c = this.cv.grid;
    const ctx = c.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.el.width, c.el.height);
    if (!g.show && !this.gridPreview) return;
    if (g.size * v.zoom * this.ppi < 4) return;
    if (this.wideOn && g.size * v.zoom * this.ppi * this.cam.s < 5) return; // (wide and far out: the lines would be a grey film)
    this.mapXform(ctx, c.res);
    const r = this.wideOn ? this.layerRectInMap() : this.tableRectInMap();
    ctx.beginPath();
    if (!Geom.isHex(g)) {
      const cs = [Geom.toLocal(g, r.x, r.y), Geom.toLocal(g, r.x + r.w, r.y), Geom.toLocal(g, r.x, r.y + r.h), Geom.toLocal(g, r.x + r.w, r.y + r.h)];
      const u0 = Math.min(...cs.map((q) => q.u)); const u1 = Math.max(...cs.map((q) => q.u));
      const v0 = Math.min(...cs.map((q) => q.v)); const v1 = Math.max(...cs.map((q) => q.v));
      const s = g.size;
      for (let i = Math.floor(u0 / s); i <= Math.ceil(u1 / s); i++) {
        const a = Geom.fromLocal(g, i * s, v0); const b = Geom.fromLocal(g, i * s, v1);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      for (let j = Math.floor(v0 / s); j <= Math.ceil(v1 / s); j++) {
        const a = Geom.fromLocal(g, u0, j * s); const b = Geom.fromLocal(g, u1, j * s);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    } else {
      // three edges per hex, so every shared edge is drawn exactly once
      Geom.eachCell(g, r.x, r.y, r.x + r.w, r.y + r.h, (cell) => {
        const p = cell.poly;
        ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.lineTo(p[6], p[7]);
      });
    }
    ctx.globalAlpha = this.gridPreview ? Math.max(0.75, g.opacity) : g.opacity;
    ctx.strokeStyle = this.gridPreview ? '#e3963e' : g.color;
    ctx.lineWidth = Math.max(0.5, g.width || 1) * (this.gridPreview ? 2 : 1) / (this.ppi * v.zoom);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------- layers: tokens and overlays in map space, sounds ----------
  renderLayers() {
    const seen = new Set();
    for (const l of this.map.layers) {
      seen.add(l.id);
      let n = this.nodes.get(l.id);
      const parent = l.role === 'overlay' ? (l.anchor === 'table' ? this.tableOv : this.overlaysEl) : l.role === 'asset' ? this.assetParent(l) : null; // (Prototype 18: in front of the effects; 23: above the tokens)
      if (n && (n.url !== l.url || n.role !== l.role || (parent && n.el.parentNode !== parent))) { this.dropNode(n); this.nodes.delete(l.id); n = null; }
      if (!n) n = this.createNode(l);
      if (n) this.updateNode(l, n);
    }
    for (const [id, n] of this.nodes) {
      if (!seen.has(id)) { this.dropNode(n); this.nodes.delete(id); this.broken.delete(id); }
    }
    // Prototype 3: put them in layer order only where the order is off. (Re-attaching every element on every state
    // cancelled CSS transitions (a phone step never slid), restarted the turn glow, and cost a DOM move per layer.)
    const want = new Map(); // parent → its elements in layer order
    for (const l of this.map.layers) {
      const n = this.nodes.get(l.id);
      const par = n && n.el.parentNode;
      if (!par) continue;
      if (!want.has(par)) want.set(par, []);
      want.get(par).push(n.el);
    }
    for (const [par, els] of want) {
      const mine = new Set(els);
      let i = 0; let same = true;
      for (let c = par.firstChild; c; c = c.nextSibling) { if (!mine.has(c)) continue; if (c !== els[i]) { same = false; break; } i++; }
      if (same && i === els.length) continue;
      for (const el of els) par.appendChild(el);
    }
    this.canopiesSoon();
  }
  assetParent(l) { return l.over ? this.assetsOverEl : l.front ? this.assetsFrontEl : this.assetsEl; }
  // Prototype 23: on the TV an asset above the tokens opens where a token stands under it (a soft round window)
  canopiesSoon() { if (this.canopyRaf || this.gm) return; this.canopyRaf = requestAnimationFrame(() => { this.canopyRaf = 0; this.canopies(); }); }
  canopies() {
    if (!this.map || this.gm) return;
    const over = this.map.layers.filter((l) => l.role === 'asset' && l.over);
    if (!over.length) return;
    const ppi = this.ppi; const g = this.map.grid.size || 1;
    const toks = this.map.layers.filter((l) => l.role === 'token' && !l.hidden).map((l) => ({ x: l.x * ppi, y: l.y * ppi, r: (l.size || 1) * g * ppi * 0.78 }));
    for (const a of over) {
      const n = this.nodes.get(a.id);
      if (!n || !n.el) continue;
      const x0 = parseFloat(n.el.style.left) || 0; const y0 = parseFloat(n.el.style.top) || 0;
      const w = parseFloat(n.el.style.width) || 0; const hgt = parseFloat(n.el.style.height) || 0;
      const holes = toks.filter((t) => t.x + t.r > x0 && t.x - t.r < x0 + w && t.y + t.r > y0 && t.y - t.r < y0 + hgt);
      const mask = holes.length ? holes.map((t) => `radial-gradient(circle ${Math.round(t.r)}px at ${Math.round(t.x - x0)}px ${Math.round(t.y - y0)}px, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 58%, #000 100%)`).join(', ') : '';
      if (n.el.dataset.mask === mask) continue;
      n.el.dataset.mask = mask;
      n.el.style.maskImage = mask || '';
      n.el.style.maskComposite = holes.length > 1 ? 'intersect' : '';
    }
  }

  createNode(l) {
    let n;
    const fail = () => { this.broken.add(l.id); this.emit('broken'); };
    if (l.role === 'audio') {
      // a map's sounds are played by the sound window (sound-engine.js), not here
      n = { el: document.createComment('sound'), url: l.url, role: l.role };
    } else if (l.role === 'overlay') {
      const m = makeMedia(l.kind, l.url, l.kind === 'video' ? this.videoOn() : this.playing);
      m.classList.add('sv-overlay');
      m.addEventListener('error', fail);
      n = { el: m, media: m, url: l.url, role: l.role, nw: 0, nh: 0 };
      m.addEventListener(l.kind === 'video' ? 'loadedmetadata' : 'load', () => {
        n.nw = m.videoWidth || m.naturalWidth;
        n.nh = m.videoHeight || m.naturalHeight;
        const cur = this.map && this.map.layers.find((x) => x.id === l.id);
        if (cur) this.updateNode(cur, n);
      });
      (l.anchor === 'table' ? this.tableOv : this.overlaysEl).appendChild(m);
    } else if (l.role === 'asset') {
      const wrap = div('sv-asset');
      wrap.dataset.id = l.id;
      // (4.8: "Play as video (sharp)": an asset the GM wants at the video's own sharpness is never baked)
      n = { id: l.id, el: wrap, media: null, url: l.url, role: l.role, nw: 0, nh: 0, path: l.path || null, anim: l.kind === 'video' && !!l.path && !l.asVideo, vid: l.kind === 'video' && !!l.path };
      this.assetParent(l).appendChild(wrap);
      // 2.3: an animated asset already baked is drawn from its frame sheet (no video at all); one not baked yet
      // plays as a video until its sheet comes
      const ready = n.anim && typeof AnimCache === 'object' && !AnimCache.videosOnly ? AnimCache.peek(n.path) : null;
      if (ready && ready.ready) this.useSheet(n, ready, l);
      else if (n.anim && typeof AnimCache === 'object' && !AnimCache.videosOnly) {
        n.wait = setTimeout(() => { n.wait = 0; if (!n.sheet && !n.media && !n.dead) this.assetMedia(n, l); }, 1500);
      } else this.assetMedia(n, l);
      if (n.anim) { if (this.io) this.io.observe(wrap); this.wantSheet(n, l); }
    } else {
      // 4.10: the token takes its squares (wrap: what is clicked, where the selection ring goes); its picture, with
      // its number and name tag, is drawn bigger or smaller around that (Options → Tokens)
      const wrap = div('sv-token');
      wrap.dataset.id = l.id;
      const box = div('sv-token-pic');
      const m = makeMedia(l.kind, l.url, l.kind === 'video' ? this.videoOn() : this.playing);
      m.addEventListener('error', fail);
      const badge = document.createElement('b');
      badge.className = 'sv-token-n';
      const tag = svgEl('svg', { class: 'sv-token-tag', overflow: 'visible' }); // (Prototype 15: the name along the rim)
      box.append(m, badge);
      wrap.append(box);
      this.tokensEl.appendChild(wrap);
      const tagBox = div('sv-tagbox'); // (Prototype 14: in the tag layer, over the token's picture)
      tagBox.append(tag);
      this.tagsEl.appendChild(tagBox);
      n = { el: wrap, box, media: m, url: l.url, role: l.role, badge, tag, tagBox };
      // 4.10: (GM) how far the picture's visible part reaches, so the selection ring goes round the creature, not its margin
      if (m.tagName === 'IMG') { // (Prototype 15: on the TV too: the name follows the picture's rim)
        const nn = n;
        m.addEventListener('load', () => { nn.art = artReach(m); const cur = this.map && this.map.layers.find((x) => x.id === l.id); if (cur && this.nodes.get(l.id) === nn) this.updateNode(cur, nn); });
      }
    }
    this.nodes.set(l.id, n);
    return n;
  }

  updateNode(l, n) {
    if (l.role === 'audio') return;
    const held = this.holds && this.holds.get(l.id); // (Prototype 23: a token you are dragging stays under the mouse)
    if (held) { l.x = held.x; l.y = held.y; }
    n.el.style.display = l.hidden && !this.gm ? 'none' : '';
    n.el.classList.toggle('is-hidden', !!l.hidden);
    const ppi = this.ppi;
    if (l.role === 'overlay') {
      const e = n.el;
      e.style.opacity = l.opacity ?? 1;
      e.style.mixBlendMode = l.blend || 'normal';
      let r;
      if (l.anchor === 'table') {
        // table space, in table pixels
        r = l.fill || !n.nw ? { x: 0, y: 0, w: this.W, h: this.H, cover: true }
          : { x: (l.x || 0) * ppi, y: (l.y || 0) * ppi, w: this.W * (l.scale || 1), h: (this.W * (l.scale || 1) * n.nh) / n.nw };
      } else {
        // map space, in map pixels; "fill" covers the map's background
        const p = this.bgBox();
        const base = p ? { x: p.x, y: p.y, w: p.w, h: p.h } : this.tableRectInMap();
        r = l.fill || !n.nw ? { x: base.x * ppi, y: base.y * ppi, w: base.w * ppi, h: base.h * ppi, cover: true }
          : { x: (l.x || 0) * ppi, y: (l.y || 0) * ppi, w: base.w * ppi * (l.scale || 1), h: (base.w * ppi * (l.scale || 1) * n.nh) / n.nw };
      }
      Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, objectFit: r.cover ? 'cover' : 'fill' });
      if (n.media.tagName === 'VIDEO' && n.media.playbackRate !== (l.rate || 1)) n.media.playbackRate = l.rate || 1;
      return;
    }
    if (l.role === 'asset') {
      // 4.8: switched to "Play as video (sharp)" or back to baked frames
      if (n.vid && !!l.asVideo === n.anim) {
        n.anim = !l.asVideo;
        if (l.asVideo) { if (n.sheet || !n.media) { n.asked = 0; this.unbake(n, l); return; } } else { n.asked = 0; if (this.io) this.io.observe(n.el); this.wantSheet(n, l); }
      }
      const w = (l.w || 1) * ppi;
      const hgt = n.nw ? (w * n.nh) / n.nw : w;
      const turn = `rotate(${l.rotation || 0}deg) scaleX(${l.flip ? -1 : 1})`;
      // the picture turns; its shadow keeps falling the same way (light from the top left). A baked animation
      // brings its shadow worked out once (anim.js); everything else gets it drawn by the browser.
      const baked = n.sheet ? this.placeShadow(n, l, w, turn) : false;
      const filter = [];
      if (l.dark > 0) filter.push(`brightness(${round3(1 - l.dark)})`);
      if (l.shadow && !baked) filter.push(`drop-shadow(${round3(w * 0.05)}px ${round3(w * 0.08)}px ${round3(w * 0.06)}px rgba(0, 0, 0, 0.7))`);
      Object.assign(n.el.style, {
        width: `${w}px`, height: `${hgt}px`, left: `${l.x * ppi - w / 2}px`, top: `${l.y * ppi - hgt / 2}px`,
        opacity: l.opacity ?? 1, filter: filter.join(' '),
      });
      if (n.media) n.media.style.transform = turn;
      n.el.classList.toggle('is-selected', this.selAssets.has(l.id));
      n.el.classList.toggle('is-locked', !!l.locked);
      if (n.anim && this.animTier(l) > (n.asked || 0)) this.wantSheet(n, l); // made bigger: a sharper sheet
      return;
    }
    const size = (l.size || 1) * this.map.grid.size * ppi;
    const e = n.el;
    e.style.width = `${size}px`;
    e.style.height = `${size}px`;
    e.style.left = `${l.x * ppi - size / 2}px`;
    e.style.top = `${l.y * ppi - size / 2}px`;
    e.style.opacity = l.opacity ?? 1;
    if (n.media) n.media.style.transform = l.rotation ? `rotate(${l.rotation}deg)` : '';
    e.classList.toggle('is-selected', l.id === this.selected);
    e.classList.toggle('is-turn', this.turnIds.has(l.id));
    if (this.onShow) { const on = this.onShow.has(l.id); e.classList.toggle('on-show', on); if (n.tagBox) n.tagBox.classList.toggle('on-show', on); } // (Beta 3.2)
    // 4.10: the picture's own size around its squares, and (Options → Tokens) a shadow under it
    const k = this.picOf(l);
    const pic = size * k;
    if (n.box) {
      const inset = `${round3(-(k - 1) * 50)}%`;
      if (n.box.style.inset !== inset) n.box.style.inset = inset;
      // the selection ring: round what shows of the picture, never inside the token's squares
      const ringK = String(round3(Math.max(1, (n.art ?? 1) * k)));
      if (e.style.getPropertyValue('--ring-k') !== ringK) e.style.setProperty('--ring-k', ringK);
      const sh = this.tokLook.shadow ? `drop-shadow(${round3(pic * 0.03)}px ${round3(pic * 0.06)}px ${round3(pic * 0.045)}px rgba(0, 0, 0, 0.7))` : '';
      if (n.media && n.media.style.filter !== sh) n.media.style.filter = sh;
    }
    // copies of the same NPC carry a number (players see it too, unless Options → Tokens says no)
    if (n.badge) {
      n.badge.textContent = l.n ? String(l.n) : '';
      const named = (this.gm ? (l.tag || 'off') !== 'off' : l.tag === 'all' && !l.hidden) && !!(l.name || l.n); // (Prototype 15: the name on the rim carries the number)
      n.badge.style.display = l.n && (this.gm || this.tokLook.numbers) && !named ? '' : 'none';
      n.badge.style.fontSize = `${Math.max(ppi * 0.2, Math.min(ppi * 0.42, pic * 0.26))}px`;
    }
    if (n.tagBox) n.tagBox.classList.toggle('is-hidden', !!l.hidden);
    if (n.tagBox) Object.assign(n.tagBox.style, { left: `${l.x * ppi - pic / 2}px`, top: `${l.y * ppi - pic / 2}px`, width: `${pic}px`, height: `${pic}px`, display: e.style.display });
    // the name tag: on the GM screen for 'gm' and 'all', on the TV only for 'all' and never for a hidden token
    if (n.tag) { n.tagGeo = { pic, size }; this.drawTag(n, l); }
    this.canopiesSoon();
  }
  // Prototype 15: the name written along the token's rim on a thin band, centred under it. The TV writes it twice:
  // along the bottom for the near long side and upside down along the top for the far side (one side only: once).
  drawTag(n, l) {
    const svg = n.tag; const G = n.tagGeo;
    const tag = l.tag || 'off';
    const show = (this.gm ? tag !== 'off' : tag === 'all' && !l.hidden) && !!(l.name || l.n) && G;
    if (!show) { if (svg.style.display !== 'none') svg.style.display = 'none'; return; }
    svg.style.display = '';
    const text = `${l.name || ''}${l.n ? ` ${l.n}` : ''}`.trim();
    const fs = this.tagPx || 10;
    const both = !this.gm && this.hudBoth;
    const gmOnly = this.gm && tag === 'gm';
    const edge = this.gm ? (this.tagPx1 || 1) : fs * 0.07;
    const c = G.pic / 2;
    const R = Math.max(G.size * 0.42, c * Math.min(1, n.art ?? 0.95));
    const r2 = (v) => Math.round(v * 100) / 100;
    const sig = [text, r2(R), r2(c), Math.round(fs * 20) / 20, both, gmOnly, r2(edge * 20)].join('|');
    svg.dataset.name = text; svg.dataset.both = both ? '1' : '';
    if (svg.dataset.sig === sig) return;
    svg.dataset.sig = sig;
    svg.classList.toggle('gm-only', gmOnly);
    const bw = fs * 1.38; const rb = R + fs * 0.1 + bw / 2; const rt = rb + fs * 0.36;
    TAG_M.font = `600 ${fs}px ${tagFont(this.root)}`;
    let tw = TAG_M.measureText(text).width;
    const maxW = rt * (150 * Math.PI / 180);
    const squeeze = tw > maxW;
    if (squeeze) tw = maxW;
    const half = (tw / rt + (fs * 0.3) / rb) / 2;
    const P = (r, a) => `${r2(c + r * Math.cos(a))} ${r2(c + r * Math.sin(a))}`;
    const arc = (r, a0, a1) => `M${P(r, a0)} A${r2(r)} ${r2(r)} 0 ${a0 - a1 > Math.PI ? 1 : 0} 0 ${P(r, a1)}`; // the angle falling: anticlockwise
    const id = n.tagId || (n.tagId = `tg${++TAG_UID}`);
    const side = (mid, key) => { // mid: the band's middle (π/2 the bottom, -π/2 the top)
      const tp = `${id}${key}`;
      return `<path id="${tp}" d="${arc(rt, mid + 1.5, mid - 1.5)}" fill="none"/>`
        + `<path class="tg-edge" d="${arc(rb, mid + half, mid - half)}" stroke-width="${r2(bw + edge * 2)}"/>`
        + `<path class="tg-band" d="${arc(rb, mid + half, mid - half)}" stroke-width="${r2(bw)}"/>`
        + `<text font-size="${r2(fs)}" text-anchor="middle"><textPath href="#${tp}" startOffset="50%"${squeeze ? ` textLength="${r2(maxW)}" lengthAdjust="spacingAndGlyphs"` : ''}></textPath></text>`;
    };
    let html = `<g class="tg-b">${side(Math.PI / 2, 'b')}</g>`;
    if (both) html += `<g class="tg-t">${side(-Math.PI / 2, 't')}</g>`;
    if (gmOnly && typeof ICON_PATHS !== 'undefined' && ICON_PATHS['eye-off']) { // only you see it: a small crossed-out eye after the band
      const a = Math.PI / 2 - half - (bw * 1.05) / rb; const ex = c + rb * Math.cos(a); const ey = c + rb * Math.sin(a); const er = bw * 0.48;
      html += `<g class="tg-eye"><circle cx="${r2(ex)}" cy="${r2(ey)}" r="${r2(er)}" stroke-width="${r2(edge)}"/><svg x="${r2(ex - er * 0.68)}" y="${r2(ey - er * 0.68)}" width="${r2(er * 1.36)}" height="${r2(er * 1.36)}" viewBox="0 0 24 24">${ICON_PATHS['eye-off']}</svg></g>`;
    }
    svg.setAttribute('width', r2(G.pic)); svg.setAttribute('height', r2(G.pic));
    svg.innerHTML = html;
    for (const t of svg.querySelectorAll('textPath')) t.textContent = text;
  }
  layoutOverlays() {
    if (!this.map) return;
    for (const l of this.map.layers) if (l.role === 'overlay') { const n = this.nodes.get(l.id); if (n) this.updateNode(l, n); }
  }

  setSelectedAsset(id) { this.setSelectedAssets(id ? [id] : []); }
  setSelectedAssets(ids) {
    this.selAssets = new Set(ids);
    for (const [lid, n] of this.nodes) if (n.role === 'asset') n.el.classList.toggle('is-selected', this.selAssets.has(lid));
  }
  assetRect(id) {
    const n = this.nodes.get(id);
    return n && n.role === 'asset' ? n.el.getBoundingClientRect() : null;
  }

  setSelected(id) {
    this.selected = id;
    for (const [lid, n] of this.nodes) if (n.el.classList) n.el.classList.toggle('is-selected', lid === id);
  }

  tokenRect(id) {
    const n = this.nodes.get(id);
    return n && n.el.getBoundingClientRect ? n.el.getBoundingClientRect() : null;
  }
  // 4.10: the token's picture (it can be bigger than its squares)
  tokenPicRect(id) {
    const n = this.nodes.get(id);
    const el = n && (n.box || n.el);
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    // with its name tag below it (a toolbar below the token goes under the tag)
    const tb = n.tag && n.tag.style.display !== 'none' ? n.tag.querySelector('.tg-b .tg-band') : null; // (Prototype 15: the band under the token)
    const t = tb ? tb.getBoundingClientRect() : null;
    if (!t || !t.width) return r;
    const left = Math.min(r.left, t.left); const top = Math.min(r.top, t.top); const right = Math.max(r.right, t.right); const bottom = Math.max(r.bottom, t.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top };
  }
  token(id) { return this.map ? this.map.layers.find((l) => l.id === id && l.role === 'token') : null; }
  // on the TV: an effect, light or spell that isn't hidden and isn't carried by a hidden token (the GM sees all)
  shown(x) { return this.gm || !(x.hidden || (x.attachTo && (this.token(x.attachTo) || {}).hidden)); }

  // ---------- fog (map space, drawn on a table-sized canvas) ----------
  // Two steps: the fog itself (what was revealed or covered, kept in fogOps) and on top of it,
  // with line of sight, what the party sees right now (clear) and explored ground nobody sees (dimmed).
  fogSignature() {
    const f = this.map.fog;
    let pts = 0;
    for (const o of f.ops) pts += o.pts ? o.pts.length : 1;
    const v = this.v;
    return `${this.map.id}|${f.base}|${f.ops.length}|${pts}|${this.W}x${this.H}|${this.ppi.toFixed(3)}|${v.x},${v.y},${v.zoom}|${this.fogM || FOG_M}`;
  }
  fogSize() {
    const M = this.fogM || FOG_M;
    const cw = Math.round((this.W + 2 * M) * FOG_SCALE);
    const ch = Math.round((this.H + 2 * M) * FOG_SCALE);
    return { cw, ch };
  }
  renderFog(force) {
    const sig = this.fogSignature();
    // a fog object fresh from main always means new content (main only resends fog when it changed)
    if (this.map.fog !== this.fogObj) { this.fogObj = this.map.fog; force = true; }
    if (force || sig !== this.fogSig) {
      this.fogSig = sig;
      const c = this.fogEl;
      const f = this.map.fog;
      const { cw, ch } = this.fogSize();
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const M = this.fogM || FOG_M;
      Object.assign(c.style, { left: `${-M}px`, top: `${-M}px`, width: `${this.W + 2 * M}px`, height: `${this.H + 2 * M}px` });
      const o = this.fogOps || (this.fogOps = document.createElement('canvas'));
      if (o.width !== cw || o.height !== ch) { o.width = cw; o.height = ch; }
      const ctx = o.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, cw, ch);
      // drawn whether the fog is on or not: switching it on and off only shows or hides it (2.2)
      if (f.base === 'cover') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); }
      for (const op of f.ops) this.drawFogOp(op);
      this.sightSig = '';
      if (this.live) { this.live.fogBase = { ...this.v }; c.style.transform = ''; } // (4.4: drawn for the view the map has now)
    }
    this.fogShown();
    this.composeFog();
  }
  fogShown() {
    const on = !!(this.map && this.map.fog && this.map.fog.enabled);
    if (this.fogOnNow === on) return;
    this.fogOnNow = on;
    this.fogEl.style.display = on ? '' : 'none';
    this.sightSig = '';
  }
  fogCtx(mode, canvas = this.fogOps) {
    const ctx = canvas.getContext('2d');
    const v = this.v;
    const k = FOG_SCALE * this.ppi * v.zoom;
    const M = this.fogM || FOG_M;
    ctx.setTransform(k, 0, 0, k, (M + v.x * this.ppi) * FOG_SCALE, (M + v.y * this.ppi) * FOG_SCALE);
    ctx.globalCompositeOperation = mode === 'reveal' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }
  drawStroke(ctx, r, pts, prev) {
    const all = prev ? prev.concat(pts) : pts;
    if (all.length === 2) { ctx.beginPath(); ctx.arc(all[0], all[1], r, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    ctx.moveTo(all[0], all[1]);
    for (let i = 2; i < all.length; i += 2) ctx.lineTo(all[i], all[i + 1]);
    ctx.stroke();
  }
  // a view of the party: the view cut by walls; on dark maps only the lit parts of it
  drawSight(ctx, pts, lit) {
    if (!pts || pts.length < 6) return;
    if (!lit) { ctx.beginPath(); polyPath(ctx, pts); ctx.fill(); return; }
    ctx.save();
    ctx.beginPath(); polyPath(ctx, pts); ctx.clip();
    ctx.beginPath();
    for (const q of lit) if (q && q.length >= 6) polyPath(ctx, q);
    ctx.fill();
    ctx.restore();
  }
  drawFogOp(op) {
    if (!this.fogOps) return;
    this.paintFogOp(this.fogCtx(op.mode), op);
  }
  // one fog step on a context already set up in map inches (the fog canvas, or a picture of the fog being folded)
  paintFogOp(ctx, op) {
    ctx.globalCompositeOperation = op.mode === 'reveal' ? 'destination-out' : 'source-over';
    if (op.shape === 'rect') ctx.fillRect(op.x, op.y, op.w, op.h);
    else if (op.shape === 'circle') { ctx.beginPath(); ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2); ctx.fill(); }
    else if (op.shape === 'sight') this.drawSight(ctx, op.pts, op.lit);
    else if (op.shape === 'poly') fillRings(ctx, op.rings);
    else if (op.shape === 'mask') { // many older steps folded into one picture: it replaces the fog where it lies
      const img = this.maskImg(op);
      if (!img) return;
      ctx.save();
      ctx.translate(op.x + op.w / 2, op.y + op.h / 2);
      if (op.rot) ctx.rotate((op.rot * Math.PI) / 180);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(-op.w / 2, -op.h / 2, op.w, op.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, -op.w / 2, -op.h / 2, op.w, op.h);
      ctx.restore();
    } else if (op.pts && op.pts.length) this.drawStroke(ctx, op.r, op.pts);
  }
  // the picture of a folded fog (null until it has loaded: then the fog is drawn again)
  maskImg(op) {
    let img = MaskCache.get(op.id);
    if (!img) { img = new Image(); img.src = op.png; MaskCache.set(op.id, img); }
    if (img.complete && img.naturalWidth) return img;
    // (by id: the fog may have been sent again meanwhile, with new objects)
    img.addEventListener('load', () => { if (this.map && this.map.fog.ops.some((o) => o.id === op.id)) { this.fogSig = ''; this.renderFog(true); } }, { once: true });
    return null;
  }
  // Fold the first n fog steps into one picture (map inches; 2.2): a long fog (every step the party took leaves
  // one) draws and travels much faster that way. Returns { x, y, w, h, png } or null.
  bakeFog(fog, n) {
    const ops = fog.ops.slice(0, n);
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const add = (x, y, r = 0) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    const flat = (a, r) => { for (let i = 0; i + 1 < (a || []).length; i += 2) add(a[i], a[i + 1], r); };
    for (const op of ops) {
      if (op.shape === 'rect') { add(op.x, op.y); add(op.x + op.w, op.y + op.h); } else if (op.shape === 'circle') add(op.x, op.y, op.r);
      else if (op.shape === 'mask') { if (!this.maskImg(op)) return null; add(op.x + op.w / 2, op.y + op.h / 2, Math.hypot(op.w, op.h) / 2); } else if (op.shape === 'poly') for (const r of op.rings || []) flat(r);
      else flat(op.pts, op.r || 0);
    }
    if (!Number.isFinite(x0)) return null;
    x0 -= 0.5; y0 -= 0.5; x1 += 0.5; y1 += 0.5;
    const w = x1 - x0; const h = y1 - y0;
    const k = Math.min(24, 4096 / Math.max(w, h)); // pixels per map inch (the TV draws fog at about 20)
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
    const ctx = c.getContext('2d');
    if (fog.base === 'cover') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    Object.assign(ctx, { fillStyle: '#000', strokeStyle: '#000', lineCap: 'round', lineJoin: 'round' });
    for (const op of ops) this.paintFogOp(ctx, op);
    const r = (v) => Math.round(v * 1000) / 1000;
    return { x: r(x0), y: r(y0), w: r(c.width / k), h: r(c.height / k), png: c.toDataURL('image/png') };
  }
  // a room or an area opens up from where it was clicked, over most of a second
  animateReveal(op) {
    const a = op.anim;
    let R = 0.1;
    for (const r of op.rings) for (let i = 0; i < r.length; i += 2) R = Math.max(R, Math.hypot(r[i] - a.x, r[i + 1] - a.y));
    const mapId = this.map.id;
    const t0 = performance.now(); const D = 900;
    this.stats.reveals = (this.stats.reveals || 0) + 1;
    const step = () => {
      if (!this.map || this.map.id !== mapId || !this.fogOps || !this.map.fog.ops.includes(op)) return;
      const u = Math.min(1, (performance.now() - t0) / D);
      const e = 1 - (1 - u) ** 3;
      const ctx = this.fogCtx(op.mode);
      ctx.save();
      ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(0.01, R * e * 1.02), 0, Math.PI * 2); ctx.clip();
      fillRings(ctx, op.rings);
      ctx.restore();
      this.sightSig = '';
      this.composeFog();
      if (u < 1) requestAnimationFrame(step);
    };
    step();
  }
  drawFogDelta(d) {
    if (!this.map || !this.fogOps || this.live) { if (this.map) this.renderFog(true); return; }
    this.fogShown();
    if (d.op) { if (d.op.shape === 'poly' && d.op.anim) this.animateReveal(d.op); else this.drawFogOp(d.op); }
    if (d.stroke) this.drawStroke(this.fogCtx(d.stroke.mode), d.stroke.r, d.stroke.pts, d.stroke.prev);
    this.fogSig = this.fogSignature();
    this.sightSig = '';
    this.composeSoon(); // 4.4: many steps at once (a brush, a burst) are put together once a frame
  }
  composeSoon() {
    if (this.composeRaf) return;
    this.composeRaf = requestAnimationFrame(() => { this.composeRaf = 0; if (this.map) this.composeFog(); });
  }
  // what the party sees right now (line of sight); null when nobody looks
  liveSights() {
    const m = this.map;
    if (!m || !m.fog.enabled) return null;
    const list = Vision.sights(m); // with walls: line of sight; without: a circle around each party light
    return list.length ? list : null;
  }
  composeFog() {
    const out = this.fogEl;
    const f = this.map && this.map.fog;
    if (!f || !f.enabled || !this.fogOps) { this.stats.sight = 0; return; }
    const sights = this.liveSights();
    const dim = (this.map.vision && this.map.vision.dim) ?? 0.5;
    const sig = `${this.fogSig}|${dim}|${sights ? sights.map((x) => `${x.eye.x.toFixed(3)},${x.eye.y.toFixed(3)},${x.pts.length},${x.lit ? x.lit.map((q) => q.length).join('.') : '-'}`).join(';') : 'none'}|${this.map.walls.length}`;
    if (sig === this.sightSig) return;
    this.sightSig = sig;
    // 4.4: put together off screen, then copied with the soft edge drawn into the picture (it used to be a CSS blur,
    // worked out anew for every frame the map moved)
    const c = this.fogMix || (this.fogMix = document.createElement('canvas'));
    if (c.width !== out.width || c.height !== out.height) { c.width = out.width; c.height = out.height; }
    this.composeFogInto(c, sights, dim);
    const o = out.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'copy';
    o.filter = `blur(${FOG_BLUR * FOG_SCALE}px)`;
    o.drawImage(c, 0, 0);
    o.filter = 'none';
    o.globalCompositeOperation = 'source-over';
  }
  composeFogInto(c, sights, dim) {
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.fogOps, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.stats.sight = sights ? sights.length : 0;
    if (!sights) return;
    // the party's view, as a mask
    const mask = this.sightMask || (this.sightMask = document.createElement('canvas'));
    if (mask.width !== c.width || mask.height !== c.height) { mask.width = c.width; mask.height = c.height; }
    const mc = mask.getContext('2d');
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, mask.width, mask.height);
    const sc = this.fogCtx('cover', mask);
    for (const x of sights) this.drawSight(sc, x.pts, x.lit);
    // seen right now: no fog at all
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, 0);
    // explored but out of sight: dimmed, under the fog that still covers the rest
    if (dim > 0) {
      const dc = this.dimC || (this.dimC = document.createElement('canvas'));
      if (dc.width !== c.width || dc.height !== c.height) { dc.width = c.width; dc.height = c.height; }
      const d2 = dc.getContext('2d');
      d2.setTransform(1, 0, 0, 1, 0, 0);
      d2.globalCompositeOperation = 'copy';
      d2.fillStyle = `rgba(0,0,0,${dim})`;
      d2.fillRect(0, 0, dc.width, dc.height);
      d2.globalCompositeOperation = 'destination-out';
      d2.drawImage(mask, 0, 0);
      d2.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(dc, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // A map arrived without its fog (a message was missed): ask for a full state once.
  static needResync() {
    if (SceneView._resyncing) return;
    SceneView._resyncing = true;
    setTimeout(async () => {
      try { const s = await window.ts.state(); if (SceneView.onResync) SceneView.onResync(s); } finally { SceneView._resyncing = false; }
    }, 0);
  }

  // Apply a fog delta to the shared cache once, then redraw every view showing that map.
  static fogDelta(d, views) {
    const f = FogCache.get(d.mapId);
    const wasOn = !!(f && f.enabled);
    if (f) {
      if (d.op) { f.enabled = true; f.ops.push(d.op); }
      if (d.stroke) {
        let op = f.ops.find((o) => o.id === d.stroke.id);
        if (!op) { op = { id: d.stroke.id, mode: d.stroke.mode, shape: 'brush', r: d.stroke.r, pts: [] }; f.ops.push(op); }
        op.pts.push(...d.stroke.pts);
      }
    }
    // fog that was off has no covered base drawn yet: draw it all
    for (const v of views) if (v && v.map && v.map.id === d.mapId) { if (wasOn) v.drawFogDelta(d); else v.renderFog(true); }
  }

  // =====================================================================
  // Effects, lights, spells and weather (canvas, animated)
  // =====================================================================
  fxPos(f) {
    if (f.attachTo) { const t = this.token(f.attachTo); if (t) return { x: t.x, y: t.y }; }
    return { x: f.x, y: f.y };
  }
  // which way an effect faces (degrees); carried by a token, it turns with the token
  facing(f) {
    let a = f.angle ?? 0;
    if (f.attachTo) { const t = this.token(f.attachTo); if (t) a += t.rotation || 0; }
    return a;
  }

  spellGeom(sp) {
    const g = this.map.grid;
    let at = null; let tokenR = 0;
    if (sp.attachTo) {
      const t = this.token(sp.attachTo);
      if (t) { at = { x: t.x, y: t.y }; tokenR = ((t.size || 1) * g.size) / 2; }
    }
    const key = JSON.stringify([g.type, g.size, g.angle, g.ox, g.oy, sp.shape, sp.x, sp.y, sp.angle, sp.size, sp.width, at && at.x, at && at.y, tokenR]);
    let e = this.geoCache.get(sp.id);
    if (!e || e.key !== key) {
      const tpl = Geom.template(g, sp, at, tokenR);
      e = { key, tpl, cells: Geom.affected(g, tpl) };
      this.geoCache.set(sp.id, e);
    }
    return e;
  }
  spellAt(x, y) {
    if (!this.map) return null;
    for (let i = this.map.spells.length - 1; i >= 0; i--) {
      const sp = this.map.spells[i];
      if (this.spellGeom(sp).tpl.contains(x, y)) return sp.id;
    }
    return null;
  }
  setGhost(sp, at = null, tokenR = 0) {
    if (sp && this.map) {
      const tpl = Geom.template(this.map.grid, sp, at, tokenR);
      this.ghost = { sp, geo: { tpl, cells: Geom.affected(this.map.grid, tpl) } };
    } else this.ghost = null;
    if (this.map) this.drawSpells(Date.now());
    this.updateAnimation();
  }
  selectSpell(id) { this.selectedSpell = id; this.labelSig = ''; this.renderLabels(); this.drawSpells(Date.now()); }
  selectFx(id) { this.selectedFx = id; this.handleSig = ''; this.renderHandles(); }
  // 'all' (Effects tool), 'party' (only party lights, for the select tool) or false
  setHandles(on) {
    if (this.showHandles === on) return;
    this.showHandles = on;
    this.handlesEl.innerHTML = '';
    this.handleSig = '';
    this.renderHandles();
    if (this.map && this.map.fx.some((f) => f.preset === 'roof')) this.redrawSoon(); // (Beta 3.1: the Roof tint comes and goes with the Effects tool)
  }

  // ---------- animated assets: video or frame sheet (2.3) ----------
  // the asset as a picture or a video (an animation not baked yet)
  assetMedia(n, l) {
    clearTimeout(n.wait); n.wait = 0;
    const m = makeMedia(l.kind, l.url, l.kind === 'video' ? this.videoOn() && !n.off : this.playing);
    m.addEventListener('error', () => { this.broken.add(l.id); this.emit('broken'); });
    m.addEventListener(l.kind === 'video' ? 'loadedmetadata' : 'load', () => {
      if (n.media !== m) return;
      n.nw = m.videoWidth || m.naturalWidth;
      n.nh = m.videoHeight || m.naturalHeight;
      const cur = this.map && this.map.layers.find((x) => x.id === n.id);
      if (cur) this.updateNode(cur, n);
      this.emit('render');
    });
    n.media = m;
    n.el.appendChild(m);
    const cur = this.map && this.map.layers.find((x) => x.id === n.id);
    if (cur) this.updateNode(cur, n);
  }
  // how sharp a sheet this asset needs: its size on the TV in screen pixels
  animTier(l) {
    const px = (l.w || 1) * this.v.zoom * this.ppi * ((this.view && this.view.dpr) || 1);
    return [128, 256, 384, 512, 768, 1024].find((t) => t >= px * 0.9) || 1024; // (4.8: up to 1024)
  }
  wantSheet(n, l) {
    if (!n.anim || typeof AnimCache !== 'object' || AnimCache.videosOnly) return;
    const tier = this.animTier(l);
    n.asked = Math.max(n.asked || 0, tier);
    AnimCache.get(n.path, tier).then((en) => {
      if (n.dead || this.nodes.get(n.id) !== n) return;
      if (en && en.ready && en !== n.sheet && (!n.sheet || en.tier >= n.sheet.tier)) {
        const cur = this.map && this.map.layers.find((x) => x.id === n.id);
        this.useSheet(n, en, cur || l);
      } else if (!en && !n.sheet && !n.media) this.assetMedia(n, l); // not baked yet: the video plays meanwhile
    });
  }
  // a sheet came (or a sharper one): the video goes, a canvas shows the frames
  useSheet(n, en, l) {
    clearTimeout(n.wait); n.wait = 0;
    if (n.media && n.media.tagName === 'VIDEO') { n.media.pause(); n.media.removeAttribute('src'); n.media.load(); n.media.remove(); }
    else if (n.media && n.media !== n.frameCv) n.media.remove();
    if (n.sheet !== en) { AnimCache.drop(n.sheet); AnimCache.hold(en); }
    n.sheet = en;
    const m = en.meta;
    if (!n.frameCv) { n.frameCv = this.newCanvas('sv-aframe'); n.fctx = null; }
    if (n.frameCv.width !== m.fw || n.frameCv.height !== m.fh) { n.frameCv.width = m.fw; n.frameCv.height = m.fh; }
    if (!n.frameCv.parentNode) n.el.appendChild(n.frameCv);
    n.media = n.frameCv;
    n.nw = m.sw; n.nh = m.sh;
    let hsh = 0; for (const ch of String(n.id)) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    n.hash = Math.abs(hsh);
    // copies of the same torch do not flicker in step (a long one: within one piece, so they share the pieces kept)
    n.phase = n.hash % (en.whole ? m.n : (m.per || m.n));
    n.lightNext = 0;
    n.frame = -1; n.sframe = -1;
    this.baked.add(n);
    this.broken.delete(n.id);
    if (l) this.updateNode(l, n);
    this.drawBakedNode(n, this.freezeAt || Date.now(), true);
    this.updateBaked();
    this.emit('render');
  }
  // the shadow canvas of a baked asset, at the frame's place; false while its shadow is still being worked out
  placeShadow(n, l, w, turn) {
    const sh = l.shadow ? AnimCache.shadow(n.sheet) : null;
    if (!sh) { if (n.shadowCv) n.shadowCv.style.display = 'none'; return false; }
    if (!n.shadowCv) { n.shadowCv = this.newCanvas('sv-ashadow'); n.sctx = null; }
    if (n.shadowCv.width !== sh.cw || n.shadowCv.height !== sh.ch) { n.shadowCv.width = sh.cw; n.shadowCv.height = sh.ch; n.sframe = -1; }
    if (n.shadowCv.parentNode !== n.el) n.el.insertBefore(n.shadowCv, n.el.firstChild);
    if (n.shadowCv.style.display === 'none') n.sframe = -1;
    const k = w / sh.fw; // window pixels per shadow pixel
    Object.assign(n.shadowCv.style, {
      display: '', left: `${round3(w * 0.05 - sh.pad * k)}px`, top: `${round3(w * 0.08 - sh.pad * k)}px`,
      width: `${round3(sh.cw * k)}px`, height: `${round3(sh.ch * k)}px`, transform: turn,
    });
    if (n.sframe < 0) this.drawBakedNode(n, this.freezeAt || Date.now(), true);
    return true;
  }
  dropSheet(n) {
    clearTimeout(n.wait); n.wait = 0;
    if (n.sheet && typeof AnimCache === 'object') AnimCache.drop(n.sheet);
    n.sheet = null;
    this.baked.delete(n);
  }
  dropNode(n) {
    n.dead = true;
    this.dropSheet(n);
    if (this.io && n.anim) this.io.unobserve(n.el);
    if (n.media && n.media.tagName === 'VIDEO') { n.media.pause(); n.media.removeAttribute('src'); n.media.load(); }
    n.el.remove();
    if (n.tagBox) n.tagBox.remove();
  }
  // back to a video (the benchmark's "as videos" half)
  unbake(n, l) {
    this.dropSheet(n);
    for (const c of [n.frameCv, n.shadowCv]) if (c) c.remove();
    n.frameCv = null; n.fctx = null; n.shadowCv = null; n.sctx = null; n.media = null; n.asked = 0;
    this.assetMedia(n, l);
  }
  // a sheet was baked (or its shadow is done): the assets with that file take it
  onSheet(path, what) {
    if (!this.map) return;
    if (what === 'mode') { // animations as videos for a while, or baked again
      for (const n of [...this.nodes.values()]) {
        if (!n.anim || n.dead) continue;
        const l = this.map.layers.find((x) => x.id === n.id);
        if (!l) continue;
        if (AnimCache.videosOnly) { if (n.sheet || !n.media) this.unbake(n, l); } else { n.asked = 0; this.wantSheet(n, l); }
      }
      this.updateBaked();
      return;
    }
    for (const n of this.nodes.values()) {
      if (!n.anim || n.path !== path || n.dead) continue;
      const l = this.map.layers.find((x) => x.id === n.id);
      if (!l) continue;
      if (what === 'shadow') { if (n.sheet) this.updateNode(l, n); } else { n.asked = 0; this.wantSheet(n, l); }
    }
  }
  // assets off the screen rest (the TV: off the table; the GM screen: out of the window)
  onSeen(list) {
    for (const en of list) {
      const n = this.nodes.get(en.target.dataset.id);
      if (!n || n.el !== en.target) continue;
      const off = !en.isIntersecting;
      if (off === !!n.off) continue;
      n.off = off;
      if (n.media && n.media.tagName === 'VIDEO') { if (!off && this.videoOn() && !this.freezeAt) n.media.play().catch(() => {}); else if (off) n.media.pause(); }
      if (!off && n.sheet) { n.frame = -1; n.sframe = -1; this.drawBakedNode(n, this.freezeAt || Date.now(), true); }
    }
    this.updateBaked();
  }
  // Smooth, Light (about 12 frames a second) or Still (the first frame): how the GM screen draws them
  // Prototype 19: effects on the GM screen: 'smooth' (every frame), 'light' (about 12 a second), 'still' (drawn when
  // something changes, standing still in between). The TV always plays them at full speed.
  setFxMode(mode) {
    const m = ['smooth', 'light', 'still'].includes(mode) ? mode : 'light';
    if (m === this.fxMode) return;
    this.fxMode = m;
    this.updateAnimation();
    this.redrawSoon();
  }
  setAnimMode(mode) {
    const m = ['smooth', 'light', 'still'].includes(mode) ? mode : 'light';
    if (m === this.animMode) return;
    this.animMode = m;
    for (const n of this.baked) n.frame = -1;
    this.updateBaked();
  }
  animInfo() {
    const all = [...this.nodes.values()].filter((n) => n.role === 'asset' && n.anim);
    const vids = all.filter((n) => n.media && n.media.tagName === 'VIDEO');
    return {
      animated: all.length, baked: all.filter((n) => n.sheet).length, videos: vids.length, playing: vids.filter((n) => !n.media.paused).length,
      off: all.filter((n) => n.off).length, shadows: all.filter((n) => n.shadowCv && n.shadowCv.style.display !== 'none').length,
      tiers: all.filter((n) => n.sheet).map((n) => n.sheet.tier), draws: this.stats.bakedDraws || 0, running: !!this.bakedRaf, mode: this.animMode,
      fps: all.filter((n) => n.sheet).map((n) => n.sheet.meta.fps), blended: 0, streamed: all.filter((n) => n.sheet && !n.sheet.whole).length, drawMode: this.drawMode || 'gpu',
      cssShadow: all.filter((n) => /drop-shadow/.test(n.el.style.filter)).length,
    };
  }
  bakedStill() { return this.stillVideo || (this.gm && this.animMode === 'still'); }
  // 2.5: the frames drawn by the processor ('cpu') or the graphics card ('gpu', the default): Options → Performance
  newCanvas(cls) { const c = document.createElement('canvas'); c.className = cls; return c; }
  ctxOf(c) { return c.getContext('2d', { willReadFrequently: this.drawMode === 'cpu', alpha: true }); }
  setDrawMode(mode) {
    const m = mode === 'cpu' ? 'cpu' : 'gpu';
    if (m === (this.drawMode || 'gpu')) return;
    this.drawMode = m;
    // a canvas keeps how it was first drawn: new ones
    for (const n of this.baked) {
      for (const k of ['frameCv', 'shadowCv']) {
        const old = n[k];
        if (!old) continue;
        const c = this.newCanvas(old.className); c.width = old.width; c.height = old.height; c.style.cssText = old.style.cssText;
        old.replaceWith(c); n[k] = c;
        if (k === 'frameCv') { n.media = c; n.fctx = null; } else n.sctx = null;
      }
      n.frame = -1; n.sframe = -1;
      this.drawBakedNode(n, this.freezeAt || Date.now(), true);
    }
  }
  // where in its loop an asset is
  bakedFrame(n, now) {
    const m = n.sheet.meta;
    if (this.bakedStill()) return n.phase % m.n;
    return (Math.floor((now / 1000) * m.fps) + n.phase) % m.n;
  }
  // one frame of a piece onto a canvas (cell j of the piece's grid)
  blit(ctx, img, cols, cw, ch, j) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (j % cols) * cw, Math.floor(j / cols) * ch, cw, ch, 0, 0, cw, ch);
  }
  drawBakedNode(n, now, force) {
    const en = n.sheet;
    if (!en || !en.ready) return;
    const m = en.meta;
    const per = m.per || m.n;
    const i = this.bakedFrame(n, now);
    const p = Math.floor(i / per); const j = i % per;
    if (i !== n.frame || force) {
      const img = AnimCache.piece(en, p);
      if (img) { // (a piece still on its way: the frame shown stays a moment)
        n.frame = i;
        const ctx = n.fctx || (n.fctx = this.ctxOf(n.frameCv));
        this.blit(ctx, img, m.cols, m.fw, m.fh, j);
        this.stats.bakedDraws = (this.stats.bakedDraws || 0) + 1;
        if (this.am) this.amTick(n);
      }
    }
    if (n.shadowCv && n.shadowCv.style.display !== 'none' && (i !== n.sframe || force)) {
      const sc = AnimCache.shadowPiece(en, p);
      const g = AnimCache.shadow(en);
      if (sc && g) {
        n.sframe = i;
        const ctx = n.sctx || (n.sctx = this.ctxOf(n.shadowCv));
        this.blit(ctx, sc, m.cols, g.cw, g.ch, j);
      }
    }
  }
  // the sheets' own clock: runs while this view plays and something baked is on the screen
  updateBaked() {
    let any = false;
    for (const n of this.baked) if (!n.off) { any = true; break; }
    const on = any && this.playing && !this.freezeAt && !this.bakedStill();
    if (on && !this.bakedRaf) this.bakedRaf = requestAnimationFrame(this.bakedLoop);
    if (!on && this.bakedRaf) { cancelAnimationFrame(this.bakedRaf); this.bakedRaf = 0; }
    if (!on) { const now = this.freezeAt || Date.now(); for (const n of this.baked) if (!n.off) this.drawBakedNode(n, now); }
  }
  bakedLoop(ms) {
    this.bakedRaf = 0;
    if (!this.playing || this.freezeAt || this.bakedStill() || !this.baked.size) return;
    this.bakedRaf = requestAnimationFrame(this.bakedLoop);
    // Lighter (GM screen): about 12 frames a second for each asset, each on its own beat, so the work is spread
    // over the frames instead of all of them at once (2.5: bursts like that could hold up the TV)
    const light = this.gm && this.animMode === 'light';
    const now = Date.now();
    let shown = 0;
    for (const n of this.baked) {
      if (n.off) continue;
      shown++;
      if (light) {
        if (!n.lightNext) n.lightNext = ms + ((n.hash || 0) % 80);
        if (ms < n.lightNext) continue;
        n.lightNext = Math.max(n.lightNext + 80, ms + 40);
      }
      this.drawBakedNode(n, now);
    }
    this.stats.baked = this.baked.size; this.stats.bakedShown = shown;
  }
  // ---------- benchmark (2.5): how many pictures each animation really shows a second, its longest stand-still ----------
  animMeasureStart() {
    const t0 = performance.now();
    this.am = { t0, recs: new Map() };
    for (const n of this.nodes.values()) {
      if (!n.anim || n.dead || n.off) continue;
      const rec = { frames: 0, last: t0, gap: 0, min: Infinity, lastMedia: null };
      this.am.recs.set(n, rec);
      const v = n.media;
      if (v && v.tagName === 'VIDEO' && v.requestVideoFrameCallback) { // a video: the pictures it presents
        const am = this.am;
        const cb = (now, md) => {
          if (this.am !== am || n.media !== v) return;
          this.amTick(n);
          if (rec.lastMedia != null) { const d = md.mediaTime - rec.lastMedia; if (d > 0.004 && d < rec.min) rec.min = d; }
          rec.lastMedia = md.mediaTime;
          v.requestVideoFrameCallback(cb);
        };
        v.requestVideoFrameCallback(cb);
      }
    }
  }
  amTick(n) {
    const rec = this.am && this.am.recs.get(n);
    if (!rec) return;
    const now = performance.now();
    rec.frames++;
    rec.gap = Math.max(rec.gap, now - rec.last);
    rec.last = now;
  }
  animMeasureStop() {
    const am = this.am;
    this.am = null;
    if (!am) return null;
    const end = performance.now();
    const secs = Math.max(0.001, (end - am.t0) / 1000);
    const list = [];
    for (const [n, rec] of am.recs) {
      if (n.dead || n.off) continue;
      const l = this.map && this.map.layers.find((x) => x.id === n.id);
      const baked = !!n.sheet;
      // what it should show: its own frames a second (a video's from the steps between its pictures), at most the screen's
      let want = baked ? n.sheet.meta.fps : rec.min < Infinity ? Math.min(60, 1 / rec.min) : null;
      if (want && baked && this.gm && this.animMode === 'light') want = Math.min(want, 12.5); // Lighter: about 12 a second
      if (baked && this.bakedStill()) want = null;
      const fps = rec.frames / secs;
      list.push({ name: l ? l.name : '?', baked, fps: Math.round(fps * 10) / 10, want: want ? Math.round(want * 10) / 10 : null, still: Math.round(Math.max(rec.gap, end - rec.last)) });
    }
    if (!list.length) return { count: 0 };
    const rated = list.filter((x) => x.want);
    const ratio = rated.length ? rated.reduce((a, x) => a + Math.min(1, x.fps / x.want), 0) / rated.length : null;
    const slow = rated.slice().sort((a, b) => a.fps / a.want - b.fps / b.want)[0] || null;
    const stuck = list.slice().sort((a, b) => b.still - a.still)[0];
    return {
      count: list.length, baked: list.filter((x) => x.baked).length, ratio: ratio == null ? null : Math.round(ratio * 1000) / 10,
      fps: Math.round((list.reduce((a, x) => a + x.fps, 0) / list.length) * 10) / 10,
      slowest: slow ? { name: slow.name, fps: slow.fps, want: slow.want } : null, still: stuck ? { name: stuck.name, ms: stuck.still } : null,
      misses: typeof AnimCache === 'object' ? AnimCache.stats.misses : 0,
    };
  }

  hasAnimation() {
    const m = this.map;
    if (!m || !this.playing) return false;
    if (this.gm && this.fxMode === 'still') return false; // (Prototype 19: standing still on the GM screen)
    if (this.momentsOn()) return true;
    if (FX.weatherOn(m.weather)) return true;
    if (this.strikeAt && Date.now() - this.strikeAt < 1200) return true;
    if (m.spells.some((s) => this.shown(s)) || this.ghost) return true;
    if (m.fx.some((f) => f.kind !== 'light' && f.preset !== 'roof' && this.shown(f))) return true; // (Beta 3.1: a Roof alone doesn't move)
    if (m.light.from && Date.now() - m.light.from.t0 < m.light.from.s * 1000 + 400) return true; // the light is changing
    return m.light.darkness > 0 && m.fx.some((f) => f.kind === 'light' && (f.flicker || f.wave));
  }
  updateAnimation() {
    const on = this.hasAnimation();
    if (on && !this.raf) this.raf = requestAnimationFrame(this.loop);
    if (!on && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; if (this.map) this.drawMoments(Date.now()); }
  }
  loop(ms) {
    this.raf = 0;
    if (!this.hasAnimation()) { this.drawMoments(Date.now()); return; } // a moment that just ended lets go of the picture
    this.raf = requestAnimationFrame(this.loop);
    const base = this.gm ? (this.fxMode === 'smooth' ? 0 : 80) : 0; // (Prototype 19: Full speed, or about 12 a second on the GM screen)
    const gap = this.gm ? (this.wideOn ? Math.min(500, Math.max(base || 16, (this.wideMs || 0) * 2.5)) : base) : this.frameGap || 0;
    if (ms - this.lastFrame < gap) return;
    this.lastFrame = ms;
    if (!this.wideOn) { this.drawFrame(); return; }
    const t0 = performance.now();
    this.drawFrame();
    this.wideMs = (this.wideMs || 0) * 0.8 + (performance.now() - t0) * 0.2; // (Prototype 5: a wide view that takes long draws more seldom)
  }

  drawFrame() {
    if (!this.map) return;
    const real = Date.now();
    // Time stop: every effect stands still where it was
    const ms = this.freezeAt || real;
    const t = ms / 1000 - T0;
    this.drawSway(t);
    this.drawAtmo(t);
    this.drawLight(t);
    this.drawSpells(ms);
    this.drawWeather(t);
    this.drawMoments(real);
    this.stats.frames++;
  }

  // ---------- screen moments (moments.js) ----------
  // list: the moments playing on the TV; live: this view shows the map on the table (the TV, or the GM editing it)
  setMoments(list, live) {
    this.moments = Array.isArray(list) ? list : [];
    this.momentsLive = !!live;
    this.updateAnimation();
    if (!this.momentsOn()) this.drawMoments(Date.now());
  }
  // the ones this view draws: those over the whole table where the TV is, those at a spot on their own map
  myMoments(now) {
    if (!this.map) return [];
    return this.moments.filter((m) => Moments.alive(m, now) && (m.x != null ? m.mapId === this.map.id : this.momentsLive));
  }
  momentsOn() { return this.myMoments(Date.now()).length > 0; }
  drawMoments(now) {
    const c = this.cv.moment;
    const list = this.myMoments(now);
    this.stats.moments = list.map((m) => m.id);
    // the whole picture: shake, colour and stillness (on the TV; the GM's view stays calm)
    const sc = list.length ? Moments.screen(list, now) : { x: 0, y: 0, filter: '', freeze: null };
    if (!this.gm) {
      const k = this.ppi * this.cam.s;
      const shaking = Math.abs(sc.x) + Math.abs(sc.y) > 0.002;
      const tf = shaking ? `translate(${round3(sc.x * k)}px, ${round3(sc.y * k)}px) scale(1.04)` : '';
      if (this.root.style.transform !== tf) this.root.style.transform = tf;
      if (this.root.style.filter !== sc.filter) this.root.style.filter = sc.filter;
      this.setFreeze(sc.freeze);
    }
    if (!list.length) { clearCanvas(c); return; }
    const ctx = startCanvas(c);
    const k = this.ppi * c.res;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const at = (m) => this.mapToTable(m.x, m.y);
    Moments.draw(ctx, this.W / this.ppi, this.H / this.ppi, list, now, at, { gm: this.gm });
  }
  // videos and effects stand still while time stops; they go on from there afterwards
  setFreeze(at) {
    if ((at || null) === (this.freezeAt || null)) return;
    this.freezeAt = at || null;
    const vids = [];
    if (this.bgNode && this.bgNode.kind === 'video') vids.push(this.bgNode.el);
    for (const n of this.nodes.values()) if (n.media && n.media.tagName === 'VIDEO' && !n.off) vids.push(n.media);
    for (const v of vids) { if (this.freezeAt) v.pause(); else if (this.videoOn()) v.play().catch(() => {}); }
    this.updateBaked();
  }

  // GM: what lies off the table is dimmed; the camera can show everything at once
  fitRect(r, pad = 40) {
    const b = this.root.getBoundingClientRect();
    if (!b.width || !b.height || !(r.w > 0) || !(r.h > 0)) return;
    const p = { t: 64 + pad / 2, r: pad, b: pad, l: pad };
    const aw = b.width - p.l - p.r; const ah = b.height - p.t - p.b;
    const s = clamp(Math.min(aw / r.w, ah / r.h), 0.03, 8);
    this.cam.s = s;
    this.cam.tx = p.l + (aw - r.w * s) / 2 - r.x * s;
    this.cam.ty = p.t + (ah - r.h * s) / 2 - r.y * s;
    this.cam.auto = false;
    this.applyCamera();
  }

  // Beta 2: Lights out (a moment): every light and flame gutters and dies, one after another; when the moment is
  // stopped they catch again. 1 = burning as usual, 0 = out.
  outK(f) {
    const m = this._lo;
    if (!m || !f) return 1;
    const now = Date.now();
    const sd = FX.seedOf(f.id || 'l');
    const fr = (x) => x - Math.floor(x);
    const at = 0.2 + 2.6 * fr(Math.sin(sd * 12.9898) * 43758.5453); // when this one goes
    const age = (now - m.t0) / 1000;
    const u = Math.min(1, Math.max(0, (age - at) / 0.7));
    let k = u <= 0 ? 1 : (1 - u) * (0.55 + 0.45 * Math.abs(Math.sin(age * 37 + sd)));
    if (m.stop) {
      const back = Math.min(1, Math.max(0, ((now - m.stop) / 1000 - 0.1 - at * 0.35) / 0.3));
      k = k + (1 - k) * back;
    }
    return k;
  }
  // 4.5: the size of one grid square (map units): painted areas are drawn in squares
  cellK() { const g = this.map && this.map.grid; const k = g && g.size > 0 ? g.size : 1; return Math.min(20, Math.max(0.05, k)); }
  // Beta 3.1: Sway moves the map picture itself, on its own layer right above it (under the grid, assets and tokens)
  drawSway(t) {
    const c = this.cv.sway;
    const items = this.map.fx.filter((f) => f.kind === 'region' && f.preset === 'sway' && this.shown(f));
    this.stats.sway = items.length;
    const p = items.length ? this.bgPlacement() : null;
    if (!p || !this.bgNode) { clearCanvas(c); return; }
    const ctx = startCanvas(c);
    this.mapXform(ctx, c.res);
    const bg = { el: this.bgNode.el, x: p.x, y: p.y, w: p.w, h: p.h, turn: this.bgTurn(), key: this.bgNode.url };
    for (const f of items) FX.sway(ctx, f.hidden ? { ...f, intensity: (f.intensity ?? 1) * 0.35 } : f, t, this.cellK(), bg);
  }
  drawAtmo(t) {
    this._lo = this.myMoments(Date.now()).find((m) => m.id === 'lightsout') || null;
    const all = this.map.fx.filter((f) => f.kind !== 'light' && f.preset !== 'sway' && f.preset !== 'roof' && this.shown(f)); // (Sway has a layer of its own; Roof only cuts the weather)
    this.stats.emitters = all.filter((f) => f.kind === 'emitter').length;
    this.stats.regions = all.filter((f) => f.kind === 'region').length;
    // magical darkness goes on its own layer above the grid, so grid lines don't show through it
    const veil = all.filter((f) => f.kind === 'region' && f.preset === 'darkness');
    this.stats.veil = veil.length;
    const layers = [[this.cv.atmo, all.filter((f) => !veil.includes(f))], [this.cv.veil, veil]];
    const one = (ctx, f) => {
      let fx = f.hidden ? { ...f, intensity: (f.intensity ?? 1) * 0.35 } : f;
      if (this._lo && f.kind === 'emitter' && (f.bright > 0 || f.preset === 'shaft' || f.preset === 'window')) fx = { ...fx, outK: this.outK(f) }; // a flame (a beam) goes out with the lights
      if (f.kind === 'region') FX.region(ctx, fx, t, this.cellK());
      else { const p = this.fxPos(f); FX.emitter(ctx, fx, p.x, p.y, t); }
    };
    for (const [c, items] of layers) {
      if (!items.length) { clearCanvas(c); continue; }
      if (this.wideOn && c === this.cv.atmo && this.drawAtmoWide(c, items, one)) continue;
      const ctx = startCanvas(c);
      this.mapXform(ctx, c.res);
      for (const f of items) one(ctx, f);
    }
  }
  // Prototype 5: wide. Effects on the table (and the selected one) are drawn every frame as always. The ones off the
  // table are kept as one picture, drawn again when something changed and otherwise now and then: about 15 times a
  // second when that is cheap, more seldom the longer it takes, and not at all when a grid square is only a few pixels
  // on the screen (nobody sees them move at that size). While the camera moves, the picture is shown where it belongs
  // until the next one is ready. Returns false when nothing lies off the table (the usual drawing does it).
  drawAtmoWide(c, items, one) {
    const tr = this.tableRectInMap(); const cell = this.cellK();
    const onTable = (f) => {
      if (f.id === this.selectedFx) return true;
      if (f.kind !== 'region') { const p = this.fxPos(f); const r = (f.r || 1) * 3 + cell * 2; return p.x > tr.x - r && p.x < tr.x + tr.w + r && p.y > tr.y - r && p.y < tr.y + tr.h + r; }
      const pad = cell * 2;
      for (const s of f.strokes || []) { const q = s.pts || []; for (let i = 0; i + 1 < q.length; i += 2) if (q[i] > tr.x - pad && q[i] < tr.x + tr.w + pad && q[i + 1] > tr.y - pad && q[i + 1] < tr.y + tr.h + pad) return true; }
      return false;
    };
    const near = []; const far = [];
    for (const f of items) (onTable(f) ? near : far).push(f);
    this.stats.far = far.length;
    if (!far.length) { this.far = null; return false; }
    const B = this.far || (this.far = { el: document.createElement('canvas'), sig: '', at: 0, ms: 0, rect: null, res: 1 });
    const v = this.v; const R = this.R;
    // did one of them change? (looked at once per state from main, not per frame)
    if (B.rev !== this.mapRev) { B.rev = this.mapRev; const j = JSON.stringify(far); if (j !== B.json) { B.json = j; B.n = (B.n || 0) + 1; } }
    const sig = `${B.n || 0}|${this.quality || ''}|${this.rectSig}|${c.el.width}x${c.el.height}|${v.x},${v.y},${v.zoom}|${this.selectedFx || ''}|${this._lo ? 1 : 0}`;
    const now = performance.now();
    const small = cell * v.zoom * this.ppi * this.cam.s < 10;
    const every = Math.max(66, B.ms * 6);
    const due = B.sig !== sig ? now - B.at >= Math.max(40, B.ms * 2.5) || !B.rect : !small && !this.freezeAt && every <= 2000 && now - B.at >= every;
    if (due) {
      if (B.el.width !== c.el.width || B.el.height !== c.el.height) { B.el.width = c.el.width; B.el.height = c.el.height; }
      const bc = B.el.getContext('2d');
      bc.setTransform(1, 0, 0, 1, 0, 0); bc.globalAlpha = 1; bc.globalCompositeOperation = 'source-over';
      bc.clearRect(0, 0, B.el.width, B.el.height);
      this.mapXform(bc, c.res);
      for (const f of far) one(bc, f);
      bc.setTransform(1, 0, 0, 1, 0, 0); bc.globalAlpha = 1; bc.globalCompositeOperation = 'source-over';
      const took = performance.now() - now;
      B.ms = B.ms ? B.ms * 0.7 + took * 0.3 : took;
      B.sig = sig; B.at = now; B.rect = { ...R }; B.res = c.res;
      this.stats.farDraws = (this.stats.farDraws || 0) + 1;
    }
    const ctx = startCanvas(c);
    if (B.rect) {
      const same = B.rect.x === R.x && B.rect.y === R.y && B.rect.w === R.w && B.rect.h === R.h;
      if (same) ctx.drawImage(B.el, 0, 0);
      else ctx.drawImage(B.el, (B.rect.x - R.x) * c.res, (B.rect.y - R.y) * c.res, B.rect.w * c.res, B.rect.h * c.res);
    }
    this.mapXform(ctx, c.res);
    for (const f of near) one(ctx, f);
    return true;
  }

  drawLight(t) {
    const c = this.cv.light;
    const now = Vision.lightNow(this.map.light); // eases over some seconds after a change of mood
    let level = now.darkness;
    this.stats.darkness = Math.round(level * 1000) / 1000;
    const g = this.map.grid;
    // lights, plus flames (torches, campfires, candles) that carry their own light, in their own colour
    const idle = Vision.markersIdle(this.map); // (Prototype 17: the party marker rests while player tokens see for themselves)
    const lights = this.map.fx.filter((f) => (f.kind === 'light' || (f.kind === 'emitter' && f.bright > 0)) && this.shown(f) && !Vision.idleMarker(f, idle)).map((f) => {
      const p = this.fxPos(f);
      const D = Math.max(0.05, Geom.ftToIn(g, Math.max(f.dim || 0, f.bright || 0)));
      const color = f.color || (f.kind === 'light' ? '#ffcf8a' : '#ffb45a');
      // with line of sight the light stops at walls and closed doors
      const poly = Vision.lightPoly(this.map, p.x, p.y, D * 1.04);
      const L = { x: p.x, y: p.y, B: Geom.ftToIn(g, f.bright || 0), D, color, sat: f.eye ? 0 : lightSat(f), flicker: f.flicker, strength: (f.intensity ?? 1) * FX.waveOf(f, t) * this.outK(f), s: FX.seedOf(f.id), poly };
      // Beta 2: a bullseye lantern lights a cone, the way it faces (carried: the way the token faces)
      if (f.kind === 'light' && f.cone) { const a = this.facing(f); L.shapes = [[-14, 1], [-6, 0.55], [0, 0.4], [7, 0.25], [15, 0.15]].map(([dw, k]) => ({ poly: conePoly(p.x, p.y, a, Math.max(6, f.cone + dw), D * 1.05), k })); }
      return L;
    });
    // Beta 2: a light shaft lights its beam; a fire vent lights up while it bursts
    for (const f of this.map.fx) {
      if (f.kind !== 'emitter' || !this.shown(f)) continue;
      const p = this.fxPos(f);
      if (f.preset === 'shaft' || f.preset === 'window') { // 4.9: a soft picture of where the light falls, no hard steps
        const mask = FX.lightMask(f, f.r || 1);
        const sun = f.preset === 'window';
        lights.push({ x: p.x, y: p.y, B: mask.reach * 0.55, D: mask.reach, color: f.color || (sun ? '#ffe2ae' : '#fff1c9'), sat: f.color ? 0.6 : sun ? 0.3 : 0.25, flicker: false, strength: (f.intensity ?? 1) * this.outK(f), s: FX.seedOf(f.id), poly: null, mask });
      } else if (GLOWS[f.preset]) { // magic that glows: it shows in the dark
        const G = GLOWS[f.preset]; const r = f.r || 1;
        lights.push({ x: p.x, y: p.y, B: r * G.b, D: r * G.d, color: f.color || G.color, sat: 0.6, flicker: !!G.flicker, strength: G.k * (f.intensity ?? 1), s: FX.seedOf(f.id), poly: null });
      } else if (f.preset === 'vent' && f.variant === 'fire') {
        const v = FX.ventLevel(f, t);
        if (v > 0.02) { const r = f.r || 1; lights.push({ x: p.x, y: p.y, B: r * 1.6 * v, D: r * 3.2 * v + 0.3, color: f.color || '#ff8a2a', sat: 0.5, flicker: true, strength: v * (f.intensity ?? 1), s: FX.seedOf(f.id), poly: null }); }
      }
    }
    // Beta 2: lava and burning ground light up a dark map along where they are painted
    for (const f of this.map.fx) if (f.kind === 'region' && (f.preset === 'lava' || f.preset === 'burning' || f.preset === 'glow') && this.shown(f)) lights.push(...FX.regionLights(f, this.cellK()));
    // darkvision: around the party the dark lifts to a cool, colourless dim light
    for (const f of this.map.fx) {
      if (f.kind !== 'light' || f.preset !== 'party' || !(f.darkvision > 0) || !this.shown(f) || Vision.idleMarker(f, idle)) continue;
      const p = this.fxPos(f);
      const D = Geom.ftToIn(g, f.darkvision);
      // (Prototype 14: brighter than before, colourless (the grey layer below) and fading dark towards its edge)
      lights.push({ x: p.x, y: p.y, B: D * 0.55, D, color: '#9aa3b0', sat: 0, flicker: false, strength: 0.72, s: 0, poly: Vision.lightPoly(this.map, p.x, p.y, D * 1.02), dv: true });
    }
    this.drawDarkvision(lights, level);
    // the colour the lights throw on the map (also in daylight, more gently)
    const gc = this.cv.glow;
    const coloured = lights.filter((L) => L.sat > 0.02);
    this.stats.glows = coloured.length;
    if (coloured.length) FX.glow(startCanvas(gc), gc.el.width, gc.el.height, level, coloured, t, () => this.mapXform(gc.ctx, gc.res));
    else clearCanvas(gc);
    // Lights out: the whole scene sinks a little darker too
    const lo = this._lo ? Moments.level(this._lo, Date.now()) : 0;
    if (lo > 0) level = Math.min(1, level + (1 - level) * 0.28 * lo);
    this.stats.lightsOut = lo > 0 ? Math.round(lights.reduce((a, L) => a + (L.strength < 0.05 ? 1 : 0), 0)) : null;
    if (level <= 0) { clearCanvas(c); this.stats.lights = 0; return; }
    this.stats.lights = lights.length;
    this.stats.shadowed = lights.filter((L) => L.poly).length;
    const ctx = startCanvas(c);
    const L = this.map.light;
    FX.darkness(ctx, c.el.width, c.el.height, level, lights, t, () => this.mapXform(ctx, c.res),
      { tint: now.tint, seen: L.memory && L.seen && L.seen.length ? this.seenMask(c) : null });
  }

  // Prototype 14: darkvision sees in shades of grey. Where only darkvision reaches, a grey layer in 'saturation' mode
  // takes the colour out of the map below (soft towards the edge); where a real light shines, colour stays.
  // Drawn only when something in it changes.
  drawDarkvision(lights, level) {
    const c = this.cv.dv;
    const dv = level > 0.05 ? lights.filter((L) => L.dv) : [];
    if (!dv.length) { if (!c.empty) clearCanvas(c); this._dvSig = ''; return; }
    const lit = lights.filter((L) => !L.dv && L.strength > 0.15 && L.D > 0.05);
    const r = (v) => Math.round(v * 20);
    const sig = `${this.rectSig}|${this.v.x},${this.v.y},${this.v.zoom}|${Math.round(level * 10)}|${dv.map((L) => [r(L.x), r(L.y), r(L.D), L.poly ? L.poly.length : 0].join(',')).join(';')}|${lit.map((L) => [r(L.x), r(L.y), r(L.D), Math.round(L.strength * 3)].join(',')).join(';')}`;
    if (sig === this._dvSig && !c.empty) return;
    this._dvSig = sig;
    const ctx = startCanvas(c);
    this.mapXform(ctx, c.res);
    const path = (L) => { ctx.beginPath(); if (L.poly && L.poly.length >= 6) { ctx.moveTo(L.poly[0], L.poly[1]); for (let i = 2; i < L.poly.length; i += 2) ctx.lineTo(L.poly[i], L.poly[i + 1]); ctx.closePath(); } else ctx.arc(L.x, L.y, L.D, 0, Math.PI * 2); };
    const k = Math.min(1, (level - 0.05) / 0.3); // in daylight there is nothing to see in grey
    for (const L of dv) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.D);
      g.addColorStop(0, `rgba(128,128,128,${k})`); g.addColorStop(0.7, `rgba(128,128,128,${k})`); g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g; path(L); ctx.fill();
    }
    // real light: its colour comes back
    ctx.globalCompositeOperation = 'destination-out';
    for (const L of lit) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.D);
      const a = Math.min(1, L.strength);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.75, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; path(L); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Explored ground as a soft mask in canvas pixels (only redrawn when it changes).
  seenMask(c) {
    const seen = this.map.light.seen;
    const sig = `${this.map.id}|${seen.length}|${c.el.width}x${c.el.height}|${this.v.x},${this.v.y},${this.v.zoom}|${this.rectSig}`;
    if (this._seen && this._seen.sig === sig) return this._seen.el;
    const tmp = document.createElement('canvas');
    tmp.width = c.el.width; tmp.height = c.el.height;
    const tc = tmp.getContext('2d');
    this.mapXform(tc, c.res);
    tc.beginPath();
    for (const o of seen) { tc.moveTo(o.x + o.r, o.y); tc.arc(o.x, o.y, o.r, 0, Math.PI * 2); }
    tc.fillStyle = '#fff';
    tc.fill();
    const el = (this._seen && this._seen.el) || document.createElement('canvas');
    el.width = c.el.width; el.height = c.el.height;
    const ec = el.getContext('2d');
    ec.clearRect(0, 0, el.width, el.height);
    ec.filter = `blur(${Math.max(2, Math.round(c.el.width / 160))}px)`;
    ec.drawImage(tmp, 0, 0);
    ec.filter = 'none';
    this._seen = { sig, el };
    return el;
  }

  drawSpells(ms) {
    const c = this.cv.spell;
    if (!this.map) return;
    const list = this.map.spells.filter((s) => this.shown(s));
    this.stats.spells = list.length;
    if (!list.length && !this.ghost) { clearCanvas(c); return; }
    const ctx = startCanvas(c);
    this.mapXform(ctx, c.res);
    const px = this.pxMap;
    for (const sp of list) {
      const geo = this.spellGeom(sp);
      FX.spell(ctx, sp, geo.tpl, geo.cells, ms, {
        squares: sp.squares, px, selected: this.gm && sp.id === this.selectedSpell, alpha: sp.hidden ? 0.4 : 1,
      });
    }
    if (this.ghost) FX.ghost(ctx, this.ghost.sp, this.ghost.geo.tpl, this.ghost.geo.cells, px);
  }

  drawWeather(t) {
    const c = this.cv.weather;
    const w = this.map.weather;
    const now = Date.now();
    const layers = (w && w.layers) || [];
    this.stats.weather = layers.filter((l) => !l.hidden && !l.dying).map((l) => l.type).join('+') || 'none';
    const strikeAge = this.strikeAt ? (now - this.strikeAt) / 1000 : 99;
    // Beta 3.1: Roof areas keep the weather off (the GM screen also shows where they are, with or without weather)
    const roofs = this.map.fx.filter((f) => f.kind === 'region' && f.preset === 'roof' && this.shown(f));
    if (!layers.length && strikeAge > 1 && !(this.gm && this.showHandles === 'all' && roofs.length)) { clearCanvas(c); return; }
    const ctx = startCanvas(c);
    const k = this.ppi * c.res;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const W = (this.wideOn && this.R ? this.R.w : this.W) / this.ppi; const H = (this.wideOn && this.R ? this.R.h : this.H) / this.ppi;
    FX.weather(ctx, w, W, H, t, now);
    if (roofs.length) {
      this.mapXform(ctx, c.res);
      for (const f of roofs) FX.roof(ctx, f, this.cellK(), this.gm && this.showHandles === 'all'); // (the tint only while effects are being edited)
      ctx.setTransform(k, 0, 0, k, 0, 0);
    }
    if (strikeAge <= 1) FX.strike(ctx, W, H, strikeAge, this.strikeSeed);
    // thunder follows lightning (only the table plays it)
    if (!this.gm && this.playing) {
      for (const f of FX.flashes(w, t, now)) {
        if (this.heardFlash.has(f.id)) continue;
        this.heardFlash.add(f.id);
        if (this.heardFlash.size > 200) this.heardFlash.clear();
        this.emit('thunder', f);
      }
    }
  }
  // "Strike now": one lightning flash, whatever the weather
  strike(seed) {
    this.strikeAt = Date.now();
    this.strikeSeed = seed || 1 + Math.random() * 1000;
    this.updateAnimation();
  }
  // 4.11.1: a small picture of what the map shows, drawn by the window itself, for the room lights: the map picture and
  // its overlays, then the effect, light, colour, spell, fog and weather layers where they lie on the screen. (Before, the
  // main process took a screen capture of the TV window several times a second; behind Talk's blur that made the TV flicker.)
  ambientSample(g, w, h) {
    const sx = w / (innerWidth || 1); const sy = h / (innerHeight || 1);
    const draw = (el, op = 'source-over') => {
      if (!el || !el.isConnected) return;
      if (el.tagName === 'VIDEO' && el.readyState < 2) return;
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0.01) return;
      g.globalCompositeOperation = op;
      g.globalAlpha = Math.min(1, Number(cs.opacity) || 1);
      try { g.drawImage(el, r.left * sx, r.top * sy, r.width * sx, r.height * sy); } catch {}
    };
    for (const el of this.bgLayer.querySelectorAll('img, video, canvas')) draw(el);
    for (const el of this.overlaysEl.querySelectorAll('img, video, canvas')) draw(el, getComputedStyle(el).mixBlendMode === 'screen' ? 'screen' : 'source-over');
    for (const k of ['atmo', 'veil', 'light']) draw(this.cv[k].el);
    draw(this.cv.glow.el, 'color');
    draw(this.cv.dv.el, 'saturation');
    draw(this.cv.spell.el);
    draw(this.fogEl);
    draw(this.cv.weather.el);
    draw(this.cv.moment.el);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  // 4.10: Options → Tokens: picture size per 5e size, numbers, turn glow and name tag size on the TV, shadows
  picOf(l) { return Geom.tokenPic(l.size || 1, this.tokLook.pic, l.pic); }
  setTokenLook(look) {
    if (!look) return;
    const L = { pic: { ...Geom.PIC_DEFAULT, ...(look.pic || {}) }, numbers: look.numbers !== false, turnGlow: look.turnGlow !== false, shadow: !!look.shadow, tagSize: Number(look.tagSize) || 1 };
    const sig = JSON.stringify(L);
    if (sig === this.tokSig) return;
    this.tokSig = sig;
    this.tokLook = L;
    this.root.classList.toggle('no-turn-glow', !this.gm && !L.turnGlow);
    this.tagSize();
    if (this.map) for (const l of this.map.layers) if (l.role === 'token') { const n = this.nodes.get(l.id); if (n) this.updateNode(l, n); }
  }
  // tokens whose turn it is glow softly (initiative)
  // ribbon: the turn order is on the TV, which already shows the round
  // Beta 3.2: tokens shown to the table (table-show.js). On the TV the token itself steps aside while its picture flies
  // (only one of it at a time); on the GM screen it gets a turning ring.
  setOnShow(ids) {
    this.onShow = ids;
    for (const [id, n] of this.nodes) if (n.role === 'token') { const on = ids.has(id); n.el.classList.toggle('on-show', on); if (n.tagBox) n.tagBox.classList.toggle('on-show', on); }
  }
  // where a token's picture is on the screen (client pixels), also for a hidden one
  tokenScreen(id) {
    const n = this.dead ? null : this.nodes.get(id);
    if (!n || !n.box || !n.el.isConnected) return null;
    const e = n.el; const off = e.style.display === 'none';
    if (off) { e.style.visibility = 'hidden'; e.style.display = ''; }
    const r = n.box.getBoundingClientRect();
    if (off) { e.style.display = 'none'; e.style.visibility = ''; }
    return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width } : null;
  }
  // its picture's own size in pixels (the longer side), 0 while it loads
  tokenNatural(id) {
    const m = (this.nodes.get(id) || {}).media;
    return m ? Math.max(m.naturalWidth || m.videoWidth || 0, m.naturalHeight || m.videoHeight || 0) : 0;
  }
  setTurn(ids, ribbon) {
    this.turnIds = new Set(ids || []);
    for (const [id, n] of this.nodes) if (n.role === 'token') n.el.classList.toggle('is-turn', this.turnIds.has(id));
    if (!!ribbon !== !!this.ribbon) { this.ribbon = !!ribbon; this.renderRound(); }
  }

  // ---------- spell badges (rounds) and, for the GM, spell names ----------
  renderLabels() {
    if (!this.map) return;
    const items = this.map.spells.filter((s) => this.shown(s) && (this.gm || s.rounds != null));
    const sig = JSON.stringify([items.map((s) => [s.id, s.name, s.rounds, s.duration, s.hidden, s.x, s.y, s.angle, s.size, s.width, s.shape, s.attachTo && this.fxPos({ attachTo: s.attachTo }), this.shown(s)]), this.v, this.map.grid, this.selectedSpell, this.W, this.ppi]);
    if (sig === this.labelSig) return;
    this.labelSig = sig;
    this.labelsEl.innerHTML = '';
    for (const sp of items) {
      const { tpl } = this.spellGeom(sp);
      const top = this.mapToPx(tpl.cx, tpl.bbox[1]);
      const el = div(`sv-spell-label ${sp.id === this.selectedSpell ? 'on' : ''} ${sp.hidden ? 'is-hidden' : ''}`);
      el.dataset.id = sp.id;
      el.style.left = `${top.x}px`;
      el.style.top = `${top.y}px`;
      if (this.gm) { const n = document.createElement('span'); n.textContent = sp.name; el.append(n); }
      if (sp.rounds != null) { const r = document.createElement('b'); r.textContent = sp.duration ? `${sp.rounds}/${sp.duration}` : String(sp.rounds); r.title = 'Rounds'; el.append(r); }
      if (!this.gm) el.classList.add('badge-only');
      this.labelsEl.append(el);
    }
  }

  // ---------- GM handles for effects and lights ----------
  renderHandles() {
    if (!this.gm) return;
    if (!this.map || !this.showHandles) { if (this.handlesEl.firstChild) this.handlesEl.innerHTML = ''; this.handleSig = ''; return; }
    const g = this.map.grid;
    const list = this.showHandles === 'party' ? this.map.fx.filter((f) => f.kind === 'light' && f.preset === 'party') : this.map.fx;
    const idle = Vision.markersIdle(this.map); // (Prototype 17)
    const sig = JSON.stringify([this.showHandles, list.map((f) => [f.id, f.kind, f.preset, f.hidden, f.bright, f.dim, f.r, this.fxPos(f), f.kind === 'region' ? f.strokes.length : 0, f.eye]), this.v, g.size, this.selectedFx, this.ppi, idle]);
    if (sig === this.handleSig) return;
    this.handleSig = sig;
    this.handlesEl.innerHTML = '';
    const scale = this.ppi * this.v.zoom;
    for (const f of list) {
      let p = this.fxPos(f);
      if (f.kind === 'region') { const s = f.strokes[0]; if (!s || !s.pts.length) continue; p = { x: s.pts[0], y: s.pts[1] }; }
      const at = this.mapToPx(p.x, p.y);
      if ((f.kind === 'light' && this.showHandles === 'all') || (f.kind === 'emitter' && f.bright > 0 && f.id === this.selectedFx)) {
        for (const [ft, cls] of [[f.dim, 'dim'], [f.bright, 'bright']]) {
          const d = 2 * Geom.ftToIn(g, ft || 0) * scale;
          if (d <= 0) continue;
          const ring = div(`sv-light-ring ${cls} ${f.id === this.selectedFx ? 'on' : ''}`);
          Object.assign(ring.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${d}px`, height: `${d}px` });
          this.handlesEl.append(ring);
        }
      }
      const el = div(`sv-handle kind-${f.kind} ${f.preset === 'party' ? 'party' : ''} ${f.id === this.selectedFx ? 'on' : ''} ${f.hidden ? 'is-hidden' : ''} ${f.attachTo ? 'attached' : ''} ${f.eye && f.attachTo ? 'eye' : ''} ${Vision.idleMarker(f, idle) ? 'idle' : ''}`);
      el.dataset.id = f.id;
      if (Vision.idleMarker(f, idle)) el.dataset.tip = 'The party marker rests: the player tokens on this map see for themselves';
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      el.innerHTML = icon(SceneView.fxIcon(f));
      this.handlesEl.append(el);
    }
  }
  static fxIcon(f) {
    if (f.kind === 'light') return f.preset === 'party' ? 'users-group' : f.preset === 'moon' ? 'moon' : 'bulb';
    const list = f.kind === 'region' ? FXDATA.REGIONS : FXDATA.EMITTERS;
    const d = list.find((x) => x.id === f.preset);
    return d ? d.icon : 'sparkles';
  }

  // ---------- walls and doors (GM only) ----------
  // mode: false (nothing), 'doors' (door markers to click), 'edit' (every wall, its ends and the doors)
  setWallMode(mode) { if (this.wallMode === mode) return; this.wallMode = mode; this.renderWalls(); }
  // ---------- areas (GM only, Fog tool) ----------
  setAreaMode(on) { if (this.areaMode === !!on) return; this.areaMode = !!on; this.renderAreas(); }
  setRoomPreview(p) { this.roomPreview = p; this.renderAreas(); }   // { rings, mode } or null
  setAreaDraft(pts) { this.areaDraft = pts; this.renderAreas(); }   // [x, y, ...] being drawn, or null
  renderAreas(force) {
    if (!this.gm) return;
    const m = this.map;
    const areas = (m && m.areas) || [];
    const show = !!m && this.areaMode;
    const sig = show ? JSON.stringify([areas.map((a) => [a.id, a.name, a.rings.length, a.rings[0].length]), this.roomPreview && [this.roomPreview.mode, this.roomPreview.rings.length, this.roomPreview.rings[0].slice(0, 4)], this.areaDraft, this.v, this.ppi, this.W]) : '';
    if (!force && sig === this.areaSig) return;
    this.areaSig = sig;
    if (!show) { this.areasEl.innerHTML = ''; return; }
    const P = (x, y) => this.mapToPx(x, y);
    const d = (rings) => rings.map((r) => { let t = ''; for (let i = 0; i < r.length; i += 2) { const q = P(r[i], r[i + 1]); t += `${i ? 'L' : 'M'}${round3(q.x)} ${round3(q.y)}`; } return `${t}Z`; }).join('');
    const parts = [`<svg class="sv-areas-svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">`];
    for (const a of areas) parts.push(`<path class="area" fill-rule="evenodd" d="${d(a.rings)}"/>`);
    if (this.roomPreview) parts.push(`<path class="room ${this.roomPreview.mode || ''}" fill-rule="evenodd" d="${d(this.roomPreview.rings)}"/>`);
    if (this.areaDraft && this.areaDraft.length >= 2) {
      let t = '';
      for (let i = 0; i < this.areaDraft.length; i += 2) { const q = P(this.areaDraft[i], this.areaDraft[i + 1]); t += `${i ? 'L' : 'M'}${round3(q.x)} ${round3(q.y)}`; }
      parts.push(`<path class="draft" d="${t}"/>`);
    }
    parts.push('</svg>');
    this.areasEl.innerHTML = parts.join('');
    // names in the middle of each area
    for (const a of areas) {
      let x = 0; let y = 0; let n = 0;
      for (let i = 0; i < a.rings[0].length; i += 2) { x += a.rings[0][i]; y += a.rings[0][i + 1]; n++; }
      const q = P(x / n, y / n);
      const el = div('sv-area-name');
      el.textContent = a.name;
      el.style.left = `${q.x}px`; el.style.top = `${q.y}px`;
      this.areasEl.append(el);
    }
  }
  setWallSelected(id) { this.wallSel = id; this.renderWalls(); }
  // what is being drawn right now: [[x1, y1, x2, y2], ...] in map inches, plus the point under the pointer
  setWallPreview(p) { this.wallPreview = p; this.renderWalls(true); }
  renderWalls(force) {
    if (!this.gm) { if (this.glassEl.firstChild) this.glassEl.innerHTML = ''; return; } // (Beta 3.1: windows don't show on the TV)
    const m = this.map;
    const mode = this.wallMode;
    if (!m || !mode || !m.walls.length && !this.wallPreview) { if (this.wallsEl.firstChild) this.wallsEl.innerHTML = ''; this.wallSig = ''; return; }
    const sig = `${mode}|${Vision.wallSig(m)}|${this.wallSel}|${this.v.x},${this.v.y},${this.v.zoom}|${this.ppi}|${this.W}`;
    if (!force && sig === this.wallSig) return;
    this.wallSig = sig;
    const P = (x, y) => this.mapToPx(x, y);
    const parts = [`<svg class="sv-walls-svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">`];
    if (mode === 'edit') {
      const ends = new Map();
      for (const w of m.walls) {
        const a = P(w.x1, w.y1); const b = P(w.x2, w.y2);
        const cls = `w ${w.door ? (w.door === 2 ? 'secret' : 'door') : w.kind || ''} ${w.open ? 'open' : ''} ${w.shut ? 'shut' : ''} ${w.id === this.wallSel ? 'on' : ''}`;
        parts.push(`<line class="${cls}" x1="${round3(a.x)}" y1="${round3(a.y)}" x2="${round3(b.x)}" y2="${round3(b.y)}"/>`);
        for (const q of [a, b]) ends.set(`${Math.round(q.x * 10)},${Math.round(q.y * 10)}`, q);
      }
      for (const q of ends.values()) parts.push(`<circle class="end" cx="${round3(q.x)}" cy="${round3(q.y)}" r="4"/>`);
    }
    const pv = this.wallPreview;
    if (pv) {
      for (const sg of pv.segs || []) {
        const a = P(sg[0], sg[1]); const b = P(sg[2], sg[3]);
        parts.push(`<line class="w preview ${pv.door ? 'door' : pv.kind || ''}" x1="${round3(a.x)}" y1="${round3(a.y)}" x2="${round3(b.x)}" y2="${round3(b.y)}"/>`);
      }
      if (pv.at) { const q = P(pv.at.x, pv.at.y); parts.push(`<circle class="snap ${pv.snapped ? 'on' : ''} ${pv.onWall ? 'wall' : ''}" cx="${round3(q.x)}" cy="${round3(q.y)}" r="${pv.onWall ? 6 : 5}"/>`); }
      if (pv.box) {
        const a = P(pv.box.x, pv.box.y); const b = P(pv.box.x + pv.box.w, pv.box.y + pv.box.h);
        parts.push(`<rect class="box" x="${round3(Math.min(a.x, b.x))}" y="${round3(Math.min(a.y, b.y))}" width="${round3(Math.abs(b.x - a.x))}" height="${round3(Math.abs(b.y - a.y))}"/>`);
      }
    }
    parts.push('</svg>');
    this.wallsEl.innerHTML = parts.join('');
    // door markers: click to open or close (Beta 3.1: windows too, with a window icon)
    for (const w of m.walls) {
      const win = !w.door && w.kind === 'window';
      if (!w.door && !win) continue;
      const open = win ? !w.shut : w.open;
      const c = P((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
      const el = div(`sv-door ${mode === 'edit' ? '' : 'lock'} ${win ? 'win' : ''} ${open ? 'open' : ''} ${w.door === 2 ? 'secret' : ''} ${w.id === this.wallSel ? 'on' : ''}`);
      el.dataset.id = w.id;
      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
      el.innerHTML = icon(win ? (open ? 'window' : 'window-off') : mode === 'edit' ? (w.open ? 'door-enter' : 'door') : (w.open ? 'lock-open' : 'lock')); // (Prototype 4: while playing, a lock)
      this.wallsEl.append(el);
    }
  }
  // the wall or door under a screen point (GM)
  wallAtScreen(clientX, clientY, px = 9, filter) {
    if (!this.map) return null;
    const p = this.toMap(clientX, clientY);
    const tol = px / (this.cam.s * this.ppi * this.v.zoom);
    return Vision.wallAt(this.map, p.x, p.y, tol, filter);
  }
  // for the self-test: what line of sight is doing in this window
  visionInfo() {
    const m = this.map;
    if (!m) return null;
    const sights = Vision.sights(m);
    return {
      on: Vision.on(m), walls: m.walls.length, doors: m.walls.filter((w) => w.door).length, open: m.walls.filter((w) => w.open).length, windows: m.walls.filter((w) => !w.door && w.kind === 'window').length, glass: this.glassEl.childElementCount,
      eyes: sights.length, area: sights.map((x) => Math.round(Vision.area(x.pts) * 10) / 10), lit: sights.map((x) => (x.lit ? x.lit.length : 0)),
      sightOps: m.fog.ops.filter((o) => o.shape === 'sight').length, composed: this.stats.sight, shadowed: this.stats.shadowed,
    };
  }
  // is a point (map inches) seen by the party right now?
  seesPoint(x, y) {
    const m = this.map;
    if (!m || !Vision.eyes(m).length) return null;
    return Vision.sights(m).some((s) => Vision.inPoly(s.pts, x, y) && (!s.lit || s.lit.some((q) => Vision.inPoly(q, x, y))));
  }

  // ---------- pings (map inches) ----------
  // Prototype 2: a player pushes the stick: an arrow from the token to where the step would land, the square tinted
  // (red: blocked). Gone when the stick is let go, or after a few seconds without word from the phone.
  aimIn(msg) {
    if (!this.aims) this.aims = new Map();
    const old = this.aims.get(msg.id);
    if (old) { clearTimeout(old.t); old.el.remove(); this.aims.delete(msg.id); }
    if (!msg.to) return;
    const g = (this.map && this.map.grid && this.map.grid.size) || 1;
    const a = this.mapToPx(msg.x, msg.y); const b = this.mapToPx(msg.to.x, msg.to.y);
    const cell = (msg.cells || 1) * g * this.ppi;
    const el = div(`sv-aim ${msg.ok ? 'ok' : 'no'}`);
    if (msg.color) el.style.setProperty('--pcc', msg.color);
    const sq = div('sv-aim-cell');
    Object.assign(sq.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${cell}px`, height: `${cell}px` });
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const ar = div('sv-aim-arrow');
    Object.assign(ar.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(0, len - cell * 0.32)}px`, transform: `rotate(${ang}deg)` });
    ar.style.setProperty('--w', `${Math.max(2, this.ppi * 0.18)}px`);
    el.append(sq, ar);
    this.marks.appendChild(el);
    this.aims.set(msg.id, { el, t: setTimeout(() => { el.remove(); this.aims.delete(msg.id); }, 4500) });
  }
  // Prototype 6: the squares a player's token walked this turn (players.js trails()): a dot on each in their colour,
  // and how far that is, next to the token. Gone when the turn is over.
  setTrails(list) { this.trails = Array.isArray(list) ? list : []; this.renderTrails(); }
  renderTrails() {
    const mine = this.map ? (this.trails || []).filter((t) => t.mapId === this.map.id) : [];
    const sig = mine.length ? JSON.stringify([mine, this.v, this.ppi, mine.map((t) => { const l = this.map.layers.find((x) => x.id === t.id); return l ? [l.x, l.y, l.size] : null; })]) : '';
    if (sig === this.trailSig) return;
    this.trailSig = sig;
    if (!this.trailBox) { this.trailBox = div('sv-trails'); this.marks.prepend(this.trailBox); }
    this.trailBox.innerHTML = '';
    const g = (this.map && this.map.grid && this.map.grid.size) || 1;
    for (const t of mine) {
      const cell = g * this.ppi * this.v.zoom;
      const d = Math.max(7, cell * 0.36);
      const lastPt = t.pts[t.pts.length - 1];
      const drawn = new Set([`${Math.round(lastPt.x * 100)},${Math.round(lastPt.y * 100)}`]); // (the token stands on the last one; a square walked twice gets one dot)
      t.pts.forEach((p, i) => {
        const k = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
        if (drawn.has(k)) return;
        drawn.add(k);
        const at = this.mapToPx(p.x, p.y);
        const dot = div(`sv-trail-dot ${i === 0 ? 'start' : ''}`);
        if (t.color) dot.style.setProperty('--pcc', t.color);
        Object.assign(dot.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${d}px`, height: `${d}px` });
        this.trailBox.append(dot);
      });
      const l = this.map.layers.find((x) => x.id === t.id);
      const last = t.pts[t.pts.length - 1];
      const at = this.mapToPx(l ? l.x : last.x, l ? l.y : last.y);
      const half = Math.max(0.5, (l && l.size) || 1) * cell / 2;
      const tag = div('sv-trail-total');
      if (t.color) tag.style.setProperty('--pcc', t.color);
      tag.textContent = `${t.total} ft`;
      Object.assign(tag.style, { left: `${at.x + half * 0.8}px`, top: `${at.y - half * 0.95}px`, fontSize: `${Math.max(11, cell * 0.3)}px` });
      this.trailBox.append(tag);
    }
  }
  // Prototype 2: the next position change of this token slides (a step from a phone)
  // Prototype 14: a token dragged on the GM screen: only its new place comes, many times a second; it glides there
  // (the next full state, when it is let go, brings the light, the sight and everything else)
  // (Prototype 23: on your screen, glide false: the token sticks to the mouse, and a state that arrives meanwhile
  // doesn't pull it back until you let go: hold(id, null))
  dragLive(id, x, y, glide = true) {
    if (!this.map) return;
    const l = this.map.layers.find((q) => q.id === id);
    const n = this.nodes.get(id);
    if (!l || !n) return;
    l.x = x; l.y = y;
    if (!glide) { this.hold(id, { x, y }); this.updateNode(l, n); this.canopiesSoon(); return; }
    const els = [n.el, n.tagBox].filter(Boolean);
    for (const el of els) el.classList.add('sv-drag');
    clearTimeout(n.dragT);
    n.dragT = setTimeout(() => { for (const el of els) el.classList.remove('sv-drag'); }, 400);
    this.updateNode(l, n);
    this.canopiesSoon();
  }
  hold(id, pos) { if (!this.holds) this.holds = new Map(); if (pos) this.holds.set(id, pos); else this.holds.delete(id); }
  slideIn(msg) {
    const n = this.nodes.get(msg.id);
    if (!n) return;
    const els = [n.el, n.tagBox].filter(Boolean);
    for (const el of els) el.classList.add('sv-slide');
    clearTimeout(n.slideT);
    n.slideT = setTimeout(() => { for (const el of els) el.classList.remove('sv-slide'); }, 700);
  }
  ping(msg) {
    if (msg.kind === 'aim') { this.aimIn(msg); return; }
    if (msg.kind === 'slide') { this.slideIn(msg); return; }
    if (msg.kind === 'chalk') { this.chalkIn(msg); return; }
    if (msg.kind === 'spot') { this.spotIn(msg); return; }
    if (msg.kind === 'measure') { this.measureIn(msg); return; }
    const { x, y, kind } = msg;
    const p = div(kind === 'laser' ? 'sv-laser' : 'sv-ping');
    const size = kind === 'laser' ? Math.max(18, this.ppi * 0.45) : Math.max(60, this.ppi * 3);
    const at = this.mapToPx(x, y);
    Object.assign(p.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${size}px`, height: `${size}px` });
    this.marks.appendChild(p);
    setTimeout(() => p.remove(), kind === 'laser' ? 700 : 1500);
    // the laser leaves a short glowing trail between its points
    if (kind === 'laser') {
      const now = Date.now();
      const last = this.lastLaser;
      if (last && now - last.t < 180) {
        const line = svgEl('line', { x1: round3(last.x), y1: round3(last.y), x2: round3(at.x), y2: round3(at.y), class: 'sv-laser-trail', 'stroke-width': round3(size * 0.28) });
        this.inkSvg.append(line);
        setTimeout(() => line.remove(), 650);
      }
      this.lastLaser = { x: at.x, y: at.y, t: now };
    }
  }

  // =====================================================================
  // Drawings, labels, markers, counters, notes, round badge
  // =====================================================================
  // pen strokes, in map pixels (map inches * ppi) inside the map-space layer
  renderPen() {
    if (!this.map) return;
    const pens = this.map.draw.filter((d) => d.kind === 'pen' && (this.gm || !d.hidden));
    const sig = JSON.stringify([pens.map((d) => [d.id, d.pts.length, d.color, d.w, d.hidden]), this.ppi]);
    if (sig === this.penSig) return;
    this.penSig = sig;
    const k = this.ppi;
    let html = '';
    for (const d of pens) {
      const path = smoothPath(d.pts, k, k);
      const w = Math.max(0.5, d.w * k);
      html += `<g data-id="${d.id}" class="${d.hidden ? 'is-hidden' : ''}"><path d="${path}" stroke="rgba(0,0,0,0.5)" stroke-width="${round3(w + Math.max(2, w * 0.6))}"/><path d="${path}" stroke="${esc(d.color)}" stroke-width="${round3(w)}"/></g>`;
    }
    this.penSvg.innerHTML = html;
  }

  // labels, markers and counters keep a physical size on the TV
  renderAnno() {
    if (!this.map) return;
    const texts = this.map.draw.filter((d) => d.kind === 'text' && (this.gm || !d.hidden));
    const marks = this.map.marks.filter((m) => m.kind !== 'note' && (this.gm || !m.hidden));
    const sig = JSON.stringify([texts, marks, this.v, this.ppi, this.W, this.selectedMark]);
    if (sig === this.annoSig) return;
    this.annoSig = sig;
    this.annoEl.innerHTML = '';
    const ppi = this.ppi;
    for (const d of texts) {
      const at = this.mapToPx(d.x, d.y);
      const el = div(`sv-text ${d.hidden ? 'is-hidden' : ''} ${d.id === this.selectedMark ? 'on' : ''}`);
      el.dataset.id = d.id;
      el.textContent = d.text;
      Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px`, fontSize: `${round3(d.size * ppi)}px`, color: d.color });
      this.annoEl.append(el);
    }
    for (const m of marks) {
      const at = this.mapToPx(m.x, m.y);
      const el = div(`sv-mark kind-${m.kind} ${m.hidden ? 'is-hidden' : ''} ${m.id === this.selectedMark ? 'on' : ''}`);
      el.dataset.id = m.id;
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      el.style.setProperty('--c', m.color || '#e3963e');
      el.style.fontSize = `${round3(ppi * 0.42)}px`;
      if (m.kind === 'pin') el.innerHTML = PIN_SVG;
      else if (m.kind === 'x') el.innerHTML = X_SVG;
      else if (m.kind === 'dot') { const b = document.createElement('b'); b.textContent = String(m.n ?? ''); el.append(b); }
      else if (m.kind === 'counter') {
        const label = document.createElement('span');
        label.className = 'sv-counter-label';
        label.textContent = m.label;
        const val = document.createElement('b');
        val.className = 'sv-counter-val';
        val.textContent = String(m.value);
        if (this.gm) {
          const btn = (d, t) => { const b = document.createElement('button'); b.className = 'sv-counter-btn'; b.dataset.d = String(d); b.textContent = t; b.setAttribute('aria-label', d > 0 ? 'Count up' : 'Count down'); return b; };
          el.append(label, btn(-1, '−'), val, btn(1, '+'));
        } else el.append(label, val);
        if (m.auto) { const a = document.createElement('i'); a.className = 'sv-counter-auto'; a.textContent = m.auto === 'up' ? '▲' : '▼'; a.title = 'Follows the rounds'; el.append(a); }
        if (m.auto === 'down' && m.value === 0) el.classList.add('zero');
      }
      this.annoEl.append(el);
    }
  }
  setSelectedMark(id) { if (this.selectedMark === id) return; this.selectedMark = id; this.annoSig = ''; this.noteSig = ''; this.renderAnno(); this.renderNotes(); }

  // GM notes: only on the GM screen, always readable
  renderNotes() {
    if (!this.gm || !this.map) return;
    const notes = this.map.marks.filter((m) => m.kind === 'note');
    const sig = JSON.stringify([notes, this.v, this.ppi, this.selectedMark]);
    if (sig === this.noteSig) return;
    this.noteSig = sig;
    this.notesEl.innerHTML = '';
    for (const m of notes) {
      const at = this.mapToPx(m.x, m.y);
      const el = div(`sv-note ${m.id === this.selectedMark ? 'on' : ''}`);
      el.dataset.id = m.id;
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      el.style.setProperty('--c', m.color || '#e2b44f');
      el.innerHTML = `${icon('note')}<span></span>`;
      el.lastChild.textContent = m.text || 'Note';
      this.notesEl.append(el);
    }
  }

  // the round on the TV where the GM put it, and the same badge turned around (mirrored through the middle)
  // for the far side; a new round is announced with a short banner
  renderRound() {
    if (!this.map) return;
    const r = this.map.round || {};
    const L = this.roundLook;
    if (!this.gm) {
      const seen = this.roundSeen;
      if (r.n != null && r.show && seen && seen.mapId === this.map.id && seen.n != null && r.n !== seen.n && L.banner !== false && L.mode !== 'off') this.announceRound(r.n);
      this.roundSeen = { mapId: this.map.id, n: r.show ? r.n : null };
    }
    // 4.6.3: the badge as Options → Looks says: beside the turn order too (badge, both), only there (order) or never (off)
    const mode = L.mode || 'auto';
    const on = !this.gm && r.n != null && r.show && mode !== 'off' && mode !== 'order' && (mode === 'badge' || mode === 'both' || !this.ribbon);
    const sig = `${on}|${r.n}|${this.ppi}|${this.hud}|${this.hudBoth}|${L.x},${L.y},${L.size}|${this.W}x${this.H}`;
    if (sig === this.roundSig) return;
    this.roundSig = sig;
    const fs = round3(this.ppi * 0.55 * this.hud * (L.size || 1));
    for (const [el, show, far] of [[this.roundEl, on, false], [this.roundEl2, on && this.hudBoth, true]]) {
      el.innerHTML = '';
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      el.style.fontSize = `${fs}px`;
      el.innerHTML = `<span>Round</span><b>${r.n}</b>`;
      // keep the whole badge on the table
      const w = el.offsetWidth || fs * 5; const hh = el.offsetHeight || fs * 1.8;
      const x = clamp((far ? 1 - L.x : L.x) * this.W, w / 2 + 4, Math.max(w / 2 + 4, this.W - w / 2 - 4));
      const y = clamp((far ? 1 - L.y : L.y) * this.H, hh / 2 + 4, Math.max(hh / 2 + 4, this.H - hh / 2 - 4));
      el.style.left = `${round3(x)}px`;
      el.style.top = `${round3(y)}px`;
    }
  }
  setRoundLook(look) {
    if (!look) return;
    const L = { x: clamp(Number(look.x) || 0, 0, 1), y: clamp(Number(look.y) || 0, 0, 1), size: clamp(Number(look.size) || 1, 0.5, 3), banner: look.banner !== false, mode: look.mode || 'auto' };
    if (L.x === this.roundLook.x && L.y === this.roundLook.y && L.size === this.roundLook.size && L.banner === this.roundLook.banner && L.mode === this.roundLook.mode) return;
    this.roundLook = L;
    this.renderRound();
  }
  // "ROUND 4" sweeps across the table (once per long side), then the badge pulses
  announceRound(n) {
    const both = this.hudBoth;
    const fs = round3(this.ppi * 0.7 * this.hud * Math.max(1, this.roundLook.size || 1));
    this.roundBanners.forEach((b, i) => {
      b.classList.remove('go');
      if (i === 1 && !both) return;
      b.innerHTML = `<div class="rb-band"><span>Round</span><b>${n}</b></div>`;
      b.style.fontSize = `${fs}px`;
      b.style.top = `${both ? (i ? 28 : 72) : 50}%`;
      void b.offsetWidth;
      b.classList.add('go');
    });
    this.stats.banners = (this.stats.banners || 0) + 1;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      for (const b of this.roundBanners) b.classList.remove('go');
      for (const el of [this.roundEl, this.roundEl2]) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    }, 2100);
  }
  // size of text and panels on the TV, and whether players sit on both long sides
  setHud(scale, seats) {
    const sc = Math.min(2, Math.max(0.5, Number(scale) || 1));
    const both = seats !== 'one';
    if (sc === this.hud && both === this.hudBoth) return;
    this.hud = sc; this.hudBoth = both;
    this.root.style.setProperty('--hud', String(sc));
    if (this.map) this.renderLayers(); // name tags: their size and which side they face
    this.applyCamera();
    this.roundSig = '';
    this.renderRound();
  }

  // ---------- ink sent live by the GM: chalk, ruler, spotlight ----------
  chalkIn(p) {
    let c = this.chalk.get(p.id);
    if (!c) {
      const g = svgEl('g', { class: 'sv-chalk', filter: 'url(#chalk-grain)' });
      const under = svgEl('path', { stroke: 'rgba(0,0,0,0.35)' });
      const line = svgEl('path', { stroke: p.color || '#ffffff' });
      g.append(under, line);
      this.inkSvg.append(g);
      c = { pts: [], color: p.color || '#ffffff', w: p.w || 0.1, g, under, line, t: Date.now(), ended: false };
      this.chalk.set(p.id, c);
    }
    if (p.pts && p.pts.length) c.pts.push(...p.pts);
    c.t = Date.now();
    if (p.end) c.ended = true;
    this.drawChalk(c);
    this.inkTick();
  }
  drawChalk(c) {
    const pts = [];
    for (let i = 0; i < c.pts.length; i += 2) { const q = this.mapToPx(c.pts[i], c.pts[i + 1]); pts.push(q.x, q.y); }
    const d = smoothPath(pts, 1, 1);
    const w = Math.max(1, c.w * this.ppi);
    c.line.setAttribute('d', d); c.line.setAttribute('stroke-width', round3(w));
    c.under.setAttribute('d', d); c.under.setAttribute('stroke-width', round3(w + Math.max(2, w * 0.5)));
  }
  spotIn(p) {
    this.spot = p.off ? null : { ...p, t: Date.now() };
    this.renderSpot();
    this.inkTick();
  }
  renderSpot() {
    const s = this.spot;
    const el = this.spotEl;
    if (!s || !this.map) { el.style.display = 'none'; return; }
    const at = this.mapToPx(s.x, s.y);
    const r = Math.max(10, (s.r || 6) * this.ppi);
    const dim = Math.min(0.97, Math.max(0.2, s.dim ?? 0.85)) * (this.gm ? 0.4 : 1);
    el.style.display = 'block';
    el.style.background = `radial-gradient(circle at ${round3(at.x)}px ${round3(at.y)}px, transparent ${round3(r * 0.78)}px, rgba(0, 0, 0, ${round3(dim)}) ${round3(r)}px)`;
    el.classList.toggle('gm-ring', this.gm);
    el.style.setProperty('--sx', `${round3(at.x)}px`);
    el.style.setProperty('--sy', `${round3(at.y)}px`);
    el.style.setProperty('--sr', `${round3(r)}px`);
  }
  measureIn(p) {
    this.measureState = p.off ? null : { ...p, t: Date.now() };
    this.renderMeasure();
    this.inkTick();
  }
  renderMeasure() {
    let g = this.inkSvg.querySelector('.sv-ruler');
    const m = this.measureState;
    if (!m || !this.map) { if (g) g.remove(); this.measureEl.style.display = 'none'; return; }
    if (!g) { g = svgEl('g', { class: 'sv-ruler' }); this.inkSvg.append(g); }
    const a = this.mapToPx(m.a.x, m.a.y); const b = this.mapToPx(m.b.x, m.b.y);
    const ring = m.ring ? Geom.ftToIn(this.map.grid, m.ft) * this.v.zoom * this.ppi : 0;
    const k = this.gm ? 1 : Math.max(1, this.ppi / 40);
    g.innerHTML = `${ring > 2 ? `<circle cx="${round3(a.x)}" cy="${round3(a.y)}" r="${round3(ring)}" class="ring"/>` : ''}`
      + `<line x1="${round3(a.x)}" y1="${round3(a.y)}" x2="${round3(b.x)}" y2="${round3(b.y)}" class="under" stroke-width="${round3(7 * k)}"/>`
      + `<line x1="${round3(a.x)}" y1="${round3(a.y)}" x2="${round3(b.x)}" y2="${round3(b.y)}" class="line" stroke-width="${round3(3 * k)}" stroke-dasharray="${round3(10 * k)} ${round3(6 * k)}"/>`
      + `<circle cx="${round3(a.x)}" cy="${round3(a.y)}" r="${round3(5 * k)}" class="end"/><circle cx="${round3(b.x)}" cy="${round3(b.y)}" r="${round3(5 * k)}" class="end"/>`;
    g.style.opacity = m.done ? '0.85' : '1';
    const el = this.measureEl;
    el.style.display = 'block';
    el.textContent = m.label || `${m.ft} ft`;
    el.style.left = `${round3(b.x)}px`;
    el.style.top = `${round3(b.y)}px`;
    el.style.fontSize = this.gm ? '' : `${round3(this.ppi * 0.42)}px`;
    el.classList.toggle('done', !!m.done);
  }
  renderInk() {
    for (const c of this.chalk.values()) this.drawChalk(c);
    this.renderSpot();
    this.renderMeasure();
  }
  // chalk fades a few seconds after it was drawn; a ruler fades after it was let go;
  // a spotlight the GM stopped sending (window closed, tool changed) goes away on its own
  inkTick() {
    if (this.inkTimer) return;
    this.inkTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of this.chalk) {
        const age = now - c.t - (c.ended ? 0 : 6000);
        const fade = clamp(1 - (age - CHALK_HOLD) / CHALK_FADE, 0, 1);
        c.g.style.opacity = String(round3(fade));
        if (fade <= 0) { c.g.remove(); this.chalk.delete(id); }
      }
      if (this.measureState && this.measureState.done && now - this.measureState.t > 2600) { this.measureState = null; this.renderMeasure(); }
      if (this.spot && now - this.spot.t > 3200) { this.spot = null; this.renderSpot(); }
      if (!this.chalk.size && !this.measureState && !this.spot) { clearInterval(this.inkTimer); this.inkTimer = 0; }
    }, 120);
  }

  // ---------- camera (GM window only moves this; the table is always fitted) ----------
  fit() {
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const p = this.gm ? { t: 64, r: 24, b: 18, l: 24 } : { t: 0, r: 0, b: 0, l: 0 };
    const aw = r.width - p.l - p.r;
    const ah = r.height - p.t - p.b;
    const s = Math.min(aw / this.W, ah / this.H);
    this.cam.s = s > 0 ? s : 1;
    this.cam.tx = p.l + (aw - this.W * this.cam.s) / 2;
    this.cam.ty = p.t + (ah - this.H * this.cam.s) / 2;
    this.cam.auto = true;
    this.applyCamera();
  }
  // name tags keep their size on the table however the map is scaled; on the GM screen they stay readable when zoomed out
  tagSize() {
    if (!this.v || !this.tokensEl) return;
    const z = this.v.zoom || 1;
    const px = this.gm ? Math.max((0.2 * this.ppi) / z, 12 / (z * (this.cam.s || 1))) : (0.26 * this.ppi * this.hud * ((this.tokLook && this.tokLook.tagSize) || 1)) / z; // (Prototype 14: a bit bigger on the TV)
    this.tokensEl.style.setProperty('--tag', `${Math.round(px * 100) / 100}px`);
    this.tagsEl.style.setProperty('--tag', `${Math.round(px * 100) / 100}px`);
    this.tagPx = px; this.tagPx1 = 1 / (z * (this.cam.s || 1)); // (Prototype 15: the rim tags are drawn in these sizes)
    if (this.map && this.nodes) for (const l of this.map.layers) { if (l.role !== 'token') continue; const n = this.nodes.get(l.id); if (n && n.tag && n.tagGeo) this.drawTag(n, l); }
    // 4.10: one pixel on the screen, in the tokens' own pixels (the selection ring stays thin at any zoom)
    this.tokensEl.style.setProperty('--px', String(Math.round((1 / (z * (this.cam.s || 1))) * 10000) / 10000));
    this.tagsEl.style.setProperty('--px', String(Math.round((1 / (z * (this.cam.s || 1))) * 10000) / 10000));
  }
  applyCamera() {
    this.tagSize();
    this.world.style.transform = `translate(${this.cam.tx}px, ${this.cam.ty}px) scale(${this.cam.s})`;
    this.root.style.setProperty('--inv', String(1 / this.cam.s));
    // markers stay big enough to click on the GM screen
    this.root.style.setProperty('--anno-k', String(this.gm ? Math.max(1, 0.75 / this.cam.s) : this.hud));
    if (this.wideOn) this.layoutLayers(); // (Prototype 5: the effect layers follow the window)
    this.emit('render');
  }
  setCamera(c) { Object.assign(this.cam, c, { auto: false }); this.applyCamera(); }
  zoomAt(clientX, clientY, factor) {
    const r = this.root.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const ns = clamp(this.cam.s * factor, 0.05, 8);
    this.cam.tx = px - ((px - this.cam.tx) * ns) / this.cam.s;
    this.cam.ty = py - ((py - this.cam.ty) * ns) / this.cam.s;
    this.cam.s = ns;
    this.cam.auto = false;
    this.applyCamera();
  }
  panBy(dx, dy) { this.cam.tx += dx; this.cam.ty += dy; this.cam.auto = false; this.applyCamera(); }
  // screen point -> table inches
  toTable(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return { x: (clientX - r.left - this.cam.tx) / this.cam.s / this.ppi, y: (clientY - r.top - this.cam.ty) / this.cam.s / this.ppi };
  }
  // screen point -> map inches
  toMap(clientX, clientY) { const t = this.toTable(clientX, clientY); return this.tableToMap(t.x, t.y); }
  // table inches -> screen point
  toScreen(x, y) {
    const r = this.root.getBoundingClientRect();
    return { x: r.left + this.cam.tx + x * this.ppi * this.cam.s, y: r.top + this.cam.ty + y * this.ppi * this.cam.s };
  }
  mapToScreen(x, y) { const t = this.mapToTable(x, y); return this.toScreen(t.x, t.y); }
  frameRect() {
    const r = this.root.getBoundingClientRect();
    return { left: r.left + this.cam.tx, top: r.top + this.cam.ty, width: this.W * this.cam.s, height: this.H * this.cam.s };
  }

  on(evt, fn) { this.handlers[evt].push(fn); }
  emit(evt, arg) { for (const fn of this.handlers[evt]) fn(arg); }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
// Beta 2: placed magic that glows in the dark (a small light of its own colour): r × b bright, r × d dim
const GLOWS = {
  glow: { b: 0.9, d: 2.4, k: 0.6, color: '#7fa8ff' },
  runes: { b: 0.8, d: 2, k: 0.55, color: '#7fb2ff' },
  portal: { b: 0.9, d: 2.2, k: 0.65, color: '#a070ff' },
  arcs: { b: 0.5, d: 1.6, k: 0.6, color: '#9fc8ff', flicker: true },
};
// Beta 2: the cone a bullseye lantern lights: from the lantern, cone degrees wide, as far as r
function conePoly(x, y, deg, cone, r) {
  const a0 = ((deg - cone / 2) * Math.PI) / 180; const a1 = ((deg + cone / 2) * Math.PI) / 180;
  const out = [x, y];
  for (let i = 0; i <= 16; i++) { const a = a0 + ((a1 - a0) * i) / 16; out.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  return out;
}
// how strongly a light colours the map: chosen, or strong for a colour picked away from the light's own
function lightSat(f) {
  if (f.sat != null) return Math.min(1, Math.max(0, f.sat));
  if (f.kind === 'light') {
    const d = typeof FXDATA !== 'undefined' ? FXDATA.LIGHTS.find((x) => x.id === f.preset) : null;
    return d && f.color && f.color.toLowerCase() !== d.color.toLowerCase() ? 0.7 : 0.25;
  }
  return f.color ? 0.7 : 0.25;
}
function polyPath(ctx, pts) { ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); }
// outlines of a room or area (holes, like pillars, stay out)
function fillRings(ctx, rings) {
  ctx.beginPath();
  for (const r of rings || []) if (r && r.length >= 6) polyPath(ctx, r);
  ctx.fill('evenodd');
}
const SVGNS = 'http://www.w3.org/2000/svg';
// Prototype 15: measuring a name for its band along the rim
const TAG_M = document.createElement('canvas').getContext('2d');
let TAG_UID = 0; let TAG_FONT = null;
function tagFont(el) { if (!TAG_FONT) TAG_FONT = (getComputedStyle(el).getPropertyValue('--display') || '').trim() || 'serif'; return TAG_FONT; }
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const t of document.querySelectorAll('.sv-token-tag')) t.dataset.sig = ''; });
function svgEl(tag, attrs = {}) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
const round3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s).replace(/[^#a-zA-Z0-9(),. %-]/g, '');
const CHALK_HOLD = 4500; // ms a chalk stroke stays before it fades
const CHALK_FADE = 1500;
// a smooth path through flat [x, y, x, y ...] points (midpoint quadratic curves)
function smoothPath(pts, kx, ky) {
  const n = pts.length / 2;
  if (!n) return '';
  const X = (i) => round3(pts[i * 2] * kx); const Y = (i) => round3(pts[i * 2 + 1] * ky);
  if (n === 1) return `M${X(0)} ${Y(0)}l0.01 0`;
  if (n === 2) return `M${X(0)} ${Y(0)}L${X(1)} ${Y(1)}`;
  let d = `M${X(0)} ${Y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = round3((pts[i * 2] * kx + pts[(i + 1) * 2] * kx) / 2); const my = round3((pts[i * 2 + 1] * ky + pts[(i + 1) * 2 + 1] * ky) / 2);
    d += `Q${X(i)} ${Y(i)} ${mx} ${my}`;
  }
  return `${d}L${X(n - 1)} ${Y(n - 1)}`;
}
const PIN_SVG = '<svg viewBox="0 0 24 32" class="pin"><path d="M12 31c-1-4-9-11-9-18a9 9 0 0 1 18 0c0 7-8 14-9 18z" fill="var(--c)" stroke="rgba(0,0,0,0.6)" stroke-width="1.5"/><circle cx="12" cy="12.5" r="3.6" fill="rgba(255,255,255,0.92)"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" class="xmark"><path d="M5 5l14 14M19 5L5 19" stroke="rgba(0,0,0,0.6)" stroke-width="7" stroke-linecap="round"/><path d="M5 5l14 14M19 5L5 19" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/></svg>';
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function layerCanvas(cls, maxW) {
  const el = document.createElement('canvas');
  el.className = `sv-canvas ${cls}`;
  return { el, ctx: el.getContext('2d'), maxW, baseW: maxW, res: 1, empty: true };
}
function sizeCanvas(c, W, H) {
  c.res = Math.min(1, c.maxW / W);
  const w = Math.max(1, Math.round(W * c.res));
  const h = Math.max(1, Math.round(H * c.res));
  if (c.el.width !== w || c.el.height !== h) { c.el.width = w; c.el.height = h; c.empty = true; }
  c.el.style.width = `${W}px`;
  c.el.style.height = `${H}px`;
}
function clearCanvas(c) {
  if (c.empty) return;
  c.ctx.setTransform(1, 0, 0, 1, 0, 0);
  c.ctx.clearRect(0, 0, c.el.width, c.el.height);
  c.empty = true;
}
function startCanvas(c) {
  const ctx = c.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, c.el.width, c.el.height);
  c.empty = false;
  return ctx;
}
// 4.10: how far a token picture's visible part reaches from its middle, as a share of half its width (0..1): a picture
// with an empty or glowing margin reaches less than 1. Measured once per picture (on a small copy).
const ART = new Map();
function artReach(img) {
  const key = img.currentSrc || img.src;
  if (ART.has(key)) return ART.get(key);
  let f = 1;
  try {
    const N = 48; const w = img.naturalWidth; const hh = img.naturalHeight;
    if (w && hh) {
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const g = c.getContext('2d', { willReadFrequently: true });
      const k = N / Math.max(w, hh);
      g.drawImage(img, (N - w * k) / 2, (N - hh * k) / 2, w * k, hh * k);
      const d = g.getImageData(0, 0, N, N).data;
      let m = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 150) m = Math.max(m, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2));
      if (m > 0.1) f = Math.min(1, m);
    }
  } catch { f = 1; }
  ART.set(key, f);
  return f;
}
function makeMedia(kind, url, playing) {
  const m = kind === 'video' ? document.createElement('video') : document.createElement('img');
  if (kind === 'video') {
    m.loop = true;
    m.muted = true;
    m.playsInline = true;
    m.preload = 'auto';
    m.disablePictureInPicture = true;
    m.src = url;
    if (playing) { m.autoplay = true; m.play().catch(() => {}); }
  } else {
    m.decoding = 'async';
    m.draggable = false;
    m.src = url;
  }
  return m;
}
