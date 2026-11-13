#!/usr/bin/env node
// Runs the automated self-test and fails (exit 1) if anything is off.
//   npm test                       (opens the app for about a minute, then closes it)
//   xvfb-run -a npm test           (Linux CI without a screen)
// Screenshots and report.json end up in ./selftest-out
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PKG = require('../package.json');
const LABEL = PKG.releaseLabel || PKG.version;
const out = path.join(root, 'selftest-out');
if (!process.env.TS_GRADE_ONLY) fs.rmSync(out, { recursive: true, force: true });

// TS_APP=path/to/packaged/app tests a packaged build instead of the source
const app = process.env.TS_APP || require('electron');
const args = process.env.TS_APP ? [] : ['.'];
if (process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CI)) args.push('--no-sandbox');

// TS_GRADE_ONLY=1 grades the report of the last run again (after a change to the checks below)
const run = process.env.TS_GRADE_ONLY ? {} : spawnSync(app, args, { cwd: root, env: { ...process.env, TS_TEST_DIR: out, TS_REMOTE_IP: '127.0.0.1', TS_OLD_TEST: '1' }, stdio: 'ignore', timeout: 2700000 }); // (baking on this slow test screen takes a while)
if (run.error) { console.error(run.error); process.exit(1); }

const reportFile = path.join(out, 'report.json');
if (!fs.existsSync(reportFile)) { console.error('No report written: the app did not finish the self-test.'); process.exit(1); }
const r = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const c = r.checks || {};
// the app's own errors first: a self-test that stopped early says where
if (Array.isArray(r.errors) && r.errors.length) { console.log('The self-test reported errors:'); for (const e of r.errors) console.log(`  ${String(e).split('\n').slice(0, 3).join('\n  ')}`); console.log(''); }
const playing = (v) => !!v && v.readyState >= 2 && !v.paused && v.t > 0;

const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const order = c.layerOrder || [];
const checks = [
  ['no renderer errors', r.errors.length === 0, r.errors.join('\n')],
  ['no "null", "undefined" or "NaN" written on screen', !(r.badText || []).length, (r.badText || []).join('\n')],
  ['no console errors', !r.console.some((l) => /error/i.test(l) && !/self-test log probe/.test(l)), r.console.join('\n')],
  ['start screen lists the demo campaign', c.home?.screen === 'home' && c.home.cards >= 1],
  // Alpha 1.0
  ['the release on the start screen and in the title; three first steps on a new table', c.release?.tag === LABEL && c.release.title === `Tablescape ${LABEL}` && c.release.steps === 3 && c.release.done === 0 && c.release.about?.version === PKG.version && c.gmTitle === `Tablescape ${LABEL}`, JSON.stringify([c.release, c.gmTitle])],
  ['clicking a campaign opens its page; Prepare the maps opens the maps', c.openedDemo?.page === 'campaign' && c.openedDemo.screen === 'play' && c.openedDemo.maps === 2, JSON.stringify(c.openedDemo)],
  ['T sends the map: video plays on the table', playing(c.tableLater?.bg) && c.tableLater.bg.t > c.tableAfterSend.bg.t],
  ['alpha overlay plays with the light blend', playing(c.tableLater?.overlays?.[0]) && c.tableLater.overlays[0].blend === 'screen'],
  ['chapter ambience plays on the table (in the sound window)', c.soundLater?.state === 'running' && (c.soundLater.tracks || []).some((t) => t.key.startsWith('amb:') && t.playing && t.t > 0), JSON.stringify(c.soundLater?.tracks)],
  ['fog reaches the table', c.tableLater?.fogOps >= 1],
  ['hidden token: GM sees it, players do not', c.tableAfterSend?.tokensTotal === 3 && c.tableAfterSend.tokensVisible === 2],
  ['R picks the fog tool and opens its popover', c.toolAfterR === 'fog' && c.fogPopoverOpen === 'Fog of war'],
  ['brush stroke from real mouse input', c.uiBrush?.addedOps === 1 && c.uiBrush.points >= 4, JSON.stringify(c.uiBrush)],
  ['brush stroke reaches the table live', c.tableFogAfterBrush === c.tableLater?.fogOps + 1],
  ['Ctrl+Z undoes the stroke', c.uiUndo?.opsAfterUndo === c.uiUndo?.expected],
  ['right-click opens the radial menu', c.radial?.open && c.radial.items.length === 9 && c.radial.items.includes('Cast spell') && c.radial.items.includes('Light'), JSON.stringify(c.radial)],
  ['radial "Reveal here" works and closes', c.radialReveal?.added === 1 && c.radialReveal.closed],
  ['token drag snaps to the grid', c.uiTokenDrag?.moved > 0.5 && c.uiTokenDrag.snapped],
  ['selected token shows its card', c.tokenCard === true],
  ['H hides a token from players only', c.hiddenToken?.tableVisible === 1 && c.hiddenToken.gmTokens === 3],
  ['Delete shows an undo toast that restores', c.undoToast && c.tokenRestored],
  // 0.3: map space
  ['moving the map changes only its position', c.mapMove?.dx > 1 && c.mapMove.bgSame && c.mapMove.fogOpsSame && c.mapMove.tokenSameInMap],
  ['fog moves with the map on the table', c.mapMove?.fogAtOldSpotBefore === 0 && c.mapMove.fogAtOldSpotAfter > 200 && c.mapMove.fogAtNewSpot === 0],
  ['moving the map can be undone', c.mapMoveUndo === true],
  // 0.3: spells
  ['A picks the spell tool and opens its popover', c.spellTool?.tool === 'spell' && c.spellTool.pop === 'Spells'],
  ['click casts Fireball on a grid intersection', c.fireball?.added === 1 && c.fireball.name === 'Fireball' && c.fireball.shape === 'sphere' && c.fireball.snapped],
  ['Fireball covers the right squares (DMG half rule)', c.fireball?.cells >= 44 && c.fireball.cells <= 60, JSON.stringify(c.fireball)],
  ['cast spell shows its card', c.fireball?.card === true],
  ['spell reaches the table: drawn and animated', c.tableFireball?.spells >= 1 && c.tableFireball.animating && (c.tableFireball.pixel?.[3] ?? 0) > 0, JSON.stringify(c.tableFireball)],
  ['spell sounds play on the table', (c.sfx?.played || []).includes('fire') && (c.sfx?.ok || []).includes('fire') && (c.sfx?.ok || []).length >= (c.sfx?.played || []).length - 1, JSON.stringify(c.sfx)],
  ['search picks Burning Hands, drag aims the cone', c.searchPick === 'Burning Hands' && c.cone?.shape === 'cone' && near(c.cone.angle, 0, 1.5) && c.cone.cells >= 3 && c.cone.cells <= 12, JSON.stringify(c.cone)],
  ['Shift snaps the aim to 15°', c.shiftSnap?.name === 'Lightning Bolt' && near(Math.abs(c.shiftSnap.angle) % 15, 0, 0.001), JSON.stringify(c.shiftSnap)],
  ['an aura on a token follows the token', c.aura?.attachTo && c.aura.tokenMoved > 0.3 && c.aura.follows, JSON.stringify(c.aura)],
  ['right-click a spell area: its radial menu', Array.isArray(c.spellRadial) && c.spellRadial.includes('Cast again') && c.spellRadial.includes('Remove')],
  ['round counter shows on the table', c.rounds === 1 && c.roundBadge >= 1],
  ['radial "Cast spell" ring casts a recent spell', Array.isArray(c.castRing) && c.castRing.includes('Fireball') && c.radialCast === 1],
  ['burst spell areas fade on their own, lasting ones stay', c.expire?.castAdded === 1 && c.expire.gone && c.expire.auraStays, JSON.stringify(c.expire)],
  ['"Clear all spell areas" with undo', c.cleared?.left === 0 && c.cleared.toast],
  // 0.3: effects
  ['E picks the effects tool', c.fxTool?.tool === 'fx' && c.fxTool.pop === 'Effects'],
  ['click places a torch that also gives light', c.placeTorch?.added === 1 && c.placeTorch.preset === 'torch' && c.placeTorch.light && c.placeTorch.handles === c.placeTorch.fx],
  ['effect markers can be dragged', c.moveHandle > 0.2],
  ['painting mist creates an area', c.paint?.region && c.paint.points >= 4, JSON.stringify(c.paint)],
  ['a token can carry a light', c.carriedLight?.ok],
  ['weather: rain over the whole table', c.weather === 'rain+splash' && c.tableFx?.stats?.weather === 'rain+splash' && c.tableFx.rainCoverage > 0.002, JSON.stringify([c.weather, c.tableFx])],
  ['atmosphere is drawn on the table', c.tableFx?.stats?.emitters >= 2 && c.tableFx.stats.regions >= 1 && c.tableFx.mistCoverage > 0.01],
  ['darkness with a hole where the light is', c.tableFx?.lightFar > 120 && c.tableFx.lightNear < c.tableFx.lightFar - 80, JSON.stringify(c.tableFx)],
  ['layers: atmosphere under tokens and fog, weather above fog', order.indexOf('sv-atmo') < order.lastIndexOf('sv-map') && order.indexOf('sv-atmo') < order.indexOf('sv-fog') && order.indexOf('sv-weather') > order.indexOf('sv-fog'), order.join(' ')],
  // 0.4: turning, darkness, options, sounds
  ['Ctrl + wheel turns the spell area before placing', c.turnPreview && Math.abs(c.turnPreview.angle - c.turnPreview.before) === 15 && (c.turnPreview.readout || '') === `${c.turnPreview.angle}°` && c.turnedCone?.angle === c.turnPreview.angle, JSON.stringify([c.turnPreview, c.turnedCone])],
  ['Ctrl + wheel turns a placed spell area', c.turnPlaced && Math.abs(c.turnPlaced.after - c.turnPlaced.before) === 15, JSON.stringify(c.turnPlaced)],
  ['a muted spell area stays silent', c.muted?.played === 0],
  ['a spell look can use its own sound file', /drone/i.test(c.customSound?.src || ''), JSON.stringify(c.customSound)],
  ['spell areas take a colour', c.spellColor === '#5cff74'],
  ['party light: placed, dragged with the select tool', c.party?.ok && c.partyHandleInSelect === 1 && c.partyMoved?.dist > 5],
  ['darkness 100% is pitch black, lights cut through', c.dark100?.far === 255 && c.dark100.lit < 60, JSON.stringify(c.dark100)],
  ['lit areas are remembered in the dark', c.partyMoved?.seen >= 2 && c.dark100?.remembered > 90 && c.dark100.remembered < 220, JSON.stringify([c.partyMoved, c.dark100])],
  ['the dark can be tinted', Array.isArray(c.tint) && c.tint[2] > c.tint[0], JSON.stringify(c.tint)],
  ['light colour: a green torch tints the map around it, in daylight too; Colour of its light slider', c.greenTorch?.sat === 0.7 && c.greenGlow?.glows >= 1 && c.greenGlow.darkness === 0 && c.greenGlow.px?.[3] > 10 && c.greenGlow.px[1] > c.greenGlow.px[0] + 20 && c.greenGlow.slider && c.greenGlow.satAfter === 1, JSON.stringify([c.greenTorch, c.greenGlow])],
  ['effects take a colour (green torch on the table)', c.greenTorch?.color === '#5cff74' && c.greenPixel && c.greenPixel[1] > c.greenPixel[0], JSON.stringify([c.greenTorch, c.greenPixel])],
  ['selected effect: options edit it', c.lookSelected === 'Torch' && c.lookEdit === 2.5, JSON.stringify([c.lookSelected, c.lookEdit])],
  // 0.4: library and assets
  ['library: big categories and shelves', ['All', 'Maps', 'Tokens', 'Assets', 'Overlays', 'Sounds', 'Favourites', 'Recent', 'This campaign', 'Fits this map'].every((x) => (c.libNav || []).includes(x)), JSON.stringify(c.libNav)],
  ['library: "Fits this map" finds related files', c.libFits >= 2],
  ['library: map variants stack into one card', (c.libStack || []).some((v) => v.includes('Base') && v.includes('Torchlight')), JSON.stringify(c.libStack)],
  ['variant shown on the map keeps its place', c.variantSwap?.after === 'Demo dungeon' && c.variantSwap.sameScale && c.variantSwap.sameX, JSON.stringify(c.variantSwap)],
  ['library: favourites shelf', c.libFav === 1],
  ['library: Tonight tray', c.tray?.campaign === 1 && c.tray.slots === 1],
  ['library: sounds list with length', (c.libSounds || []).length >= 1 && /\d:\d\d/.test(c.libSounds[0]), JSON.stringify(c.libSounds)],
  ['library: full screen (Shift+L) with assets (4.11: its folders as cards first, all inside at once)', c.libFull && c.libAssets >= 8 && ['Animated', 'Furniture', 'Nature', 'Structures'].every((k) => (c.libAssetFolders || []).includes(k)), JSON.stringify([c.libAssets, c.libAssetFolders])],
  ['assets: picking one starts the Assets tool', c.assetTool?.tool === 'asset' && c.assetTool.brush === 'Oak tree' && c.assetTool.cells === 2 && c.assetTool.drawerClosed, JSON.stringify(c.assetTool)],
  ['assets: stamp at natural size', c.stamp?.added === 1 && c.stamp.wCells === 2, JSON.stringify(c.stamp)],
  ['assets: scatter brush', c.scatter >= 4, String(c.scatter)],
  ['assets: select and turn with Ctrl + wheel', c.assetCard && c.assetTurn === 15],
  ['assets reach the table under the tokens', c.tableAssets >= 5 && c.assetUnderTokens],
  ['assets are locked outside their tool', c.assetLocked === 'none'],
  ['radial "Tonight" ring drops a token', (c.tonightRing || []).includes('Ogre') && c.tonightPlaced === 1, JSON.stringify(c.tonightRing)],
  // 0.5: rail groups, play tools, rounds, countdowns, asset options
  ['rail: Build (with Map), the Toolbox on its own (4.5), Play (with Select); Build folds on the live map; Campaigns, Table and Keys at the foot', (() => {
    const by = Object.fromEntries((c.railGroups || []).map((g) => [g.group, g]));
    return !by.nav && by.build?.folded && by.build.visible.join() === 'build'
      && by.extra?.visible.join() === 'toolbox' && by.play?.visible.join() === 'select,token,fog,party,spell,talk' && by.end?.visible.join() === 'library,home,table,help'; // 2.2: Mark went to the Toolbox; 4.3.1: nothing pinned (Initiative stays in the Toolbox)
  })(), JSON.stringify(c.railGroups)],
  ['Build tools unfold with one click', c.foldLive === true && c.unfolded === true],
  ['N: Tokens tool, three clicks drop numbered goblins', c.tokenTool?.tool === 'token' && c.tokenTool.pop === 'Tokens' && c.tokenDrop?.added === 3 && JSON.stringify(c.tokenDrop.numbers) === '[1,2,3,4,5]', JSON.stringify([c.tokenTool, c.tokenDrop])],
  ['tokens: 5e size Large on a corner, placed hidden', c.tokenLarge?.size === 2 && c.tokenLarge.hidden && c.tokenLarge.corner && c.tokenLarge.card === 'L', JSON.stringify(c.tokenLarge)],
  ['players see the token numbers, not the hidden one', ['3', '4', '5'].every((n) => (c.tableNumbers || []).includes(n)) && !(c.tableNumbers || []).includes('6'), JSON.stringify(c.tableNumbers)],
  ['spotlight on the TV follows the mouse, Esc ends it', c.pointTool === 'point' && c.spot === true && c.spotOff === false, JSON.stringify([c.spot, c.spotOff])],
  ['ruler: P again, 6 squares = 30 ft on the TV', c.cycle === 'measure' && c.measure?.table === '30 ft', JSON.stringify([c.cycle, c.measure])],
  ['chalk reaches the TV and fades', c.drawTool?.tool === 'draw' && c.chalk?.table >= 1 && c.chalk.inMap === 0 && c.chalkGone?.table === 0, JSON.stringify([c.drawTool, c.chalk, c.chalkGone])],
  ['pen line stays with the map', c.pen?.points >= 5 && c.pen.color === '#e4675e' && c.pen.table === 1, JSON.stringify(c.pen)],
  ['text label on the map and the TV', c.text?.map === 'The old well' && (c.text.table || []).includes('The old well'), JSON.stringify(c.text)],
  ['eraser removes the pen line, undo brings it back', c.erase?.pens === 0 && c.erase.texts === 1 && c.eraseUndo === 1, JSON.stringify([c.erase, c.eraseUndo])],
  ['2.2: Notes in Build (J), Marker and Counter in the Toolbox (X); no Mark on the rail; a note shows in the Notes list', c.notesTool?.tool === 'notes' && c.notesTool.inBuild && !c.notesTool.markInRail && (c.notesTool.list || []).some((t) => /Trap: DC 14/.test(t)), JSON.stringify(c.notesTool)],
  ['2.2: a new counter does not move on Next round; ticked, Count up and Count down light up when clicked', c.counterOpts?.off && !c.counterOpts.segs.includes('Count up') && (c.counterOpts.up || []).includes('Count up') && (c.counterOpts.down || []).includes('Count down') && !(c.counterOpts.down || []).includes('Count up'), JSON.stringify(c.counterOpts)],
  ['2.2: no Count rounds button under the preview (Enter starts counting)', c.noCountRounds === true && c.roundsNext?.start === 1, JSON.stringify([c.noCountRounds, c.roundsNext && c.roundsNext.start])],
  ['marks: pin and counter on the TV, the note only for the GM', ['pin', 'counter', 'note'].every((k) => (c.marks?.kinds || []).includes(k)) && c.marks.tableMarks.join() === 'pin,counter'
    && c.marks.tableNotes === 0 && c.marks.gmNotes === 1 && c.marks.counter === 4 && (c.marks.tableCounters || [])[0] === 'Ritual=4', JSON.stringify(c.marks)],
  ['rounds: a spell lasting 2 rounds ends, the counter counts down', c.roundsNext?.start === 1 && c.roundsNext.n === 3 && c.roundsNext.duration === 2 && c.roundsNext.afterOne?.rounds === 2 && c.roundsNext.afterOne.counter === 3
    && c.roundsNext.gone && c.roundsNext.counter === 2 && /Fireball ended/.test(c.roundsNext.toast), JSON.stringify(c.roundsNext)],
  ['the round shows on the TV and in the HUD', c.tableRound === 'Round3' && c.hudRound === '3', JSON.stringify([c.tableRound, c.hudRound])],
  ['dramatic countdown: big number, a pulse every second, darker near zero', c.timerMid?.on && c.timerMid.mode === 'dramatic' && ['2', '3'].includes(c.timerMid.text) && c.timerMid.beats >= 3 && c.timerMid.d > 0.6 && /\d/.test(c.timerHud || ''), JSON.stringify([c.timerMid, c.timerHud])],
  ['dramatic countdown ends at zero, Stop clears the TV', c.timerEnd?.ended && c.timerEnd.text === '0' && c.timerStopped?.state === null && c.timerStopped.table === false, JSON.stringify([c.timerEnd, c.timerStopped])],
  ['calm countdown: a dial readable from both sides, pause holds it', c.timerNormal?.on && c.timerNormal.mode === 'normal' && /^0:1[012]$/.test(c.timerNormal.text) && c.timerNormal.faces === 2 && c.timerNormal.ring > 0.85 && c.timerPaused?.paused, JSON.stringify([c.timerNormal, c.timerPaused])],
  ['assets: shadow and darkness for new stamps, also on the TV', c.assetLook?.added === 2 && c.assetLook.shadow.every(Boolean) && c.assetLook.dark.every((d) => Math.abs(d - 0.3) < 0.01) && /drop-shadow/.test(c.tableShadow || '') && /brightness/.test(c.tableShadow || ''), JSON.stringify([c.assetLook, c.tableShadow])],
  ['assets: Shift + drag selects two, they turn together', c.boxSelect?.selected === 2 && c.boxSelect.card === '2 assets' && (c.groupTurn || []).length === 2 && c.groupTurn.every((v) => Math.abs(v - 15) < 0.01), JSON.stringify([c.boxSelect, c.groupTurn])],
  ['assets: opacity for the group from the card', (c.groupOpacity || []).length === 2 && c.groupOpacity.every((v) => v === 0.5), JSON.stringify(c.groupOpacity)],
  ['assets: lock (clicks go through), unlock all', c.locked?.locked === 2 && c.locked.selected === 0 && c.locked.pe === 'none' && c.unlocked === 0, JSON.stringify([c.locked, c.unlocked])],
  // 0.6: weather mixes, lightning, talk, handouts, soundboard, break, initiative
  ['weather: a ready-made mix of layers reaches the TV', JSON.stringify(c.wxStorm?.layers) === '["rain","splash","clouds","lightning"]' && c.wxStorm.name === 'Thunderstorm' && c.wxStorm.table === 'rain+splash+clouds+lightning', JSON.stringify(c.wxStorm)],
  ['weather: direction from the compass, opacity per layer', Math.abs((c.wxDir ?? 0) - 180) <= 10 && c.wxOpacity === 0.5, JSON.stringify([c.wxDir, c.wxOpacity])],
  ['weather: add a layer, the mix shows on the TV', (c.wxAdded || []).includes('fog') && c.wxCover?.weather > 0.01 && /fog/.test(c.wxCover.stats), JSON.stringify(c.wxCover)],
  ['weather: save your own mix', c.wxSaved === true],
  ['weather: change over 10 s fades the old layers out', c.wxFade?.dying === 5 && JSON.stringify(c.wxFade.born) === '["snow"]', JSON.stringify(c.wxFade)],
  ['GM screen stays put while panels scroll (stage never scrolls)', Array.isArray(c.stageScroll) && !c.stageScroll.some((x) => !/lib|roster|tray|list|strip|drawer/i.test(String(x))) && Array.isArray(c.stageScroll2) && !c.stageScroll2.some((x) => !/lib|roster|tray|list|strip|drawer/i.test(String(x))), JSON.stringify([c.stageScroll, c.stageScroll2])],
  // 0.8
  ['toolbox tools open as floating panels (the toolbox closes)', c.floatTimer?.panel && !c.floatTimer.pop && c.floatTimer.title === 'Countdown' && c.floatClosed === true, JSON.stringify([c.floatTimer, c.floatClosed])],
  ['countdown dial can sit in the middle of the TV (also while running)', c.timerMiddle?.side === 'center' && Math.abs(c.timerMiddle.dx) <= 2 && Math.abs(c.timerMiddle.dy) <= 2, JSON.stringify(c.timerMiddle)],
  ['two floating panels at once, dragged by the title, folded with a double-click', JSON.stringify(c.floats?.open) === '["sound","break"]' && Math.abs(c.floats.dx + 300) <= 10 && Math.abs(c.floats.dy - 180) <= 10 && c.floatFold?.folded && c.floatFold.h < 60, JSON.stringify([c.floats, c.floatFold])],
  ['initiative: I opens and closes its panel', c.initPop === 'Initiative' && c.initClosed === true, JSON.stringify([c.initPop, c.initClosed])],
  ['mark: the shape buttons switch visibly', JSON.stringify(c.markShapes) === '["Cross","Number","Pin"]', JSON.stringify(c.markShapes)],
  ['ambience volume slider can be dragged', c.ambDrag?.same && c.ambDrag.after < c.ambDrag.before - 0.2 && Math.abs(c.ambDrag.after - c.ambDrag.table) < 0.05, JSON.stringify(c.ambDrag)],
  ['background sounds fade in, crossfade their loop point and fade out', c.loop?.early > 0.2 && c.loop.early < 0.75 && c.loop.full === 1 && c.loop.cross === 2 && c.loop.after.voices === 1 && c.loop.stopping.every((g) => g > 0.2 && g < 0.8) && c.loop.gone === 0, JSON.stringify(c.loop)],
  ['round badge on both long sides, one with players on one side', c.hudScale?.one?.round === 2 && c.hudOneSide?.round === 1, JSON.stringify([c.hudScale?.one, c.hudOneSide])],
  ['TV text and panels scale with a sample while changing', c.hudScale?.big?.scale === 1.6 && Math.abs(c.hudScale.big.roundPx / c.hudScale.one.roundPx - 1.6) < 0.02 && c.hudScale.sample?.sides === 2 && c.hudScale.sample.dial > 100 && c.hudScale.timerHud === '1.6' && c.hudScale.realHidden === true && c.hudAfter?.sample === null && c.hudAfter.hud.scale === 1 && c.hudSlider?.value === 1, JSON.stringify([c.hudScale, c.hudAfter, c.hudSlider])],
  ['radial menu shows pictures of the things on the Tonight tray', c.radialThumbs?.thumbs >= 1 && c.radialThumbs.loaded >= 1, JSON.stringify(c.radialThumbs)],
  ['new paint effects: water, river current, surf, blood, acid, magical darkness', c.paintFx?.regions >= 6 && ['water', 'current', 'surf'].every((k) => c.paintFx[k]?.[3] > 20) && c.paintFx.blood?.[3] > 180 && c.paintFx.blood[0] > c.paintFx.blood[1] * 2 && c.paintFx.acid?.[3] > 60 && c.paintFx.acid[1] > c.paintFx.acid[0] && c.paintFx.darkness?.[3] > 245 && c.paintFx.darkness[0] < 40 && c.paintFx.veil === 1 && (c.paintFx.darkUnderGrid?.[3] ?? 255) < 10 && ['Water', 'River current', 'Surf', 'Blood', 'Acid', 'Magical darkness'].every((n) => (c.paintTiles || []).includes(n)), JSON.stringify([c.paintFx, c.paintTiles])],
  ['river streaks and surf fronts turn smoothly on a wobbly stroke', c.flowSmooth?.raw > 20 && c.flowSmooth.streak < 1 && c.flowSmooth.front < 1, JSON.stringify(c.flowSmooth)],
  ['mist keeps moving', c.mistMoves?.change > 3 && c.mistMoves.mean > 10, JSON.stringify(c.mistMoves)],
  // 0.9
  ['toolbox: map tools (point, draw, marker, counter) and panels; Point and Draw left the rail', JSON.stringify(c.toolbox?.map) === '["Ping","Laser","Spotlight","Ruler","Chalk","Pen","Text","Erase","Marker","Counter","Dice"]' && JSON.stringify(c.toolbox.panels) === '["Initiative","Countdown","Characters","Moments","Snapshots","Soundboard","Spotify","Break","Session log","Room lights","Phone & tablet","Players\' phones"]' && c.toolbox.rail.length === 0, JSON.stringify(c.toolbox)],
  ['a map tool from the toolbox switches the mouse; the Toolbox button keeps its name and shows the tool as a badge', c.tbLaser?.tool === 'point' && c.tbLaser.mode === 'laser' && c.tbLaser.pop === 'Point' && c.tbLaser.rail === 'Toolbox/Laser' && c.tbDrawKey?.tool === 'draw' && /^Toolbox\/./.test(c.tbDrawKey.rail || ''), JSON.stringify([c.tbLaser, c.tbDrawKey])],
  ['notes: saved with the campaign as you type, time stamp, export into the Notes folder', c.notesSaved?.text === 'Goblins fled north with the silver key.' && c.notesSaved.dirty === true && /Rooms|·/.test(c.notesStamp || '') && /^Notes\/\d{4}-\d\d-\d\d\.md$/.test(c.notesExport?.file || '') && c.notesExport.has && c.notesExport.dirty === false, JSON.stringify([c.notesSaved, c.notesStamp, c.notesExport])],
  ['ink sweeps over the table while the map changes', (c.inkSend?.phases || []).includes('covering') && c.inkSend.end?.phase === 'idle' && c.inkSend.end.reveals >= 1 && c.inkSend.live && c.inkSend.shown.length === 1 && c.fadeBack === 'idle', JSON.stringify([c.inkSend, c.fadeBack])],
  ['room mode: outline under the mouse, a click reveals the room to its walls and doors', c.roomPreview && c.roomReveal?.op === 'poly' && c.roomReveal.inRoom < 20 && c.roomReveal.corridor < 20 && c.roomReveal.crypt > 200 && c.roomReveal.roomC > 200 && c.roomReveal.animated >= 1, JSON.stringify([c.roomPreview, c.roomReveal])],
  ['right-click a room: "Reveal room"; pillars inside stay covered', (c.roomRadial || []).includes('Reveal room') && c.cryptReveal?.crypt < 20 && c.cryptReveal.pillar > 200 && c.cryptReveal.stair < 20 && c.cryptReveal.roomD > 200, JSON.stringify([c.roomRadial, c.cryptReveal])],
  ['marked area: drawn by its corners, named, revealed from the radial menu', JSON.stringify(c.areaMarked) === '["Vault"]' && (c.areaRadial || []).includes('Reveal Vault') && c.areaReveal?.vault < 20 && c.areaReveal.roomC > 200, JSON.stringify([c.areaMarked, c.areaRadial, c.areaReveal])],
  ['round placed by the GM, far copy mirrored, bigger', (() => {
    const p = c.roundPlace; if (!p || !p.at || !p.at[0] || !p.at[1]) return false;
    return Math.abs(p.at[0].x - p.world.w / 2) <= 2 && Math.abs(p.at[1].x - p.world.w / 2) <= 2 && Math.abs(p.at[0].y + p.at[1].y - p.world.h) <= 2 && p.at[0].y < p.world.h / 3;
  })(), JSON.stringify(c.roundPlace)],
  ['a new round is announced on both long sides', (c.roundBanner || []).length === 2 && c.roundBanner.every((t) => /Round\s*2/.test(t)) && c.roundBannerGone?.now === 0 && c.roundBannerGone.banners >= 1, JSON.stringify([c.roundBanner, c.roundBannerGone])],
  ['drag the round over a picture of the TV', c.roundPop?.title === 'Round on the table' && c.roundPop.img && c.roundPop.far && Math.abs(c.roundDrag?.pos?.x - 0.8) < 0.05 && Math.abs(c.roundDrag.pos.y - 0.85) < 0.05, JSON.stringify([c.roundPop, c.roundDrag])],
  ['grid under the assets, per map', c.gridUnder?.table === true && c.gridUnder.gm === true && c.gridOver === false, JSON.stringify([c.gridUnder, c.gridOver])],
  ['light moods ease in over ten seconds', JSON.stringify(c.moodTiles) === '["Day","Dawn","Dusk","Night","Cave"]' && c.moodDusk?.fade === 10 && c.moodDusk.mood === 'dusk' && c.moodDusk.early?.fading && c.moodDusk.early.drawn > 0 && c.moodDusk.early.drawn < 0.12 && c.moodDusk.mid?.fading && c.moodDusk.mid.drawn > 0.15 && c.moodDusk.mid.drawn < 0.36 && !c.moodDuskEnd?.fading && Math.abs(c.moodDuskEnd.drawn - 0.45) < 0.01, JSON.stringify([c.moodTiles, c.moodDusk, c.moodDuskEnd])],
  ['light moods from the radial menu', JSON.stringify(c.moodRing) === '["Day","Dawn","Dusk","Night","Cave"]' && c.moodNight?.mood === 'night' && c.moodNight.darkness === 0.74 && c.moodNight.fading, JSON.stringify([c.moodRing, c.moodNight])],
  ['0.9 test map cleaned up', c.roomsCleanup === true],
  // Alpha 1.0
  ['Light in two halves: Map light (moods) and Light sources', JSON.stringify(c.lightTabs?.tabs) === '["Map light","Light sources"]' && ['Day', 'Night', 'Cave'].every((t) => c.lightTabs.scene.includes(t)) && ['Candle', 'Torch', 'Lantern'].every((t) => c.lightTabs.sources.includes(t)) && !c.lightTabs.sources.includes('Party light') && !c.lightTabs.sources.includes('Night') && !c.lightTabs.scene.includes('Torch'), JSON.stringify(c.lightTabs)],
  ['weather: every single layer switches on and off, no doubles', JSON.stringify(c.wxSwitch?.snowOn?.layers) === '["snow"]' && JSON.stringify(c.wxSwitch.snowOn.on) === '["snow"]' && c.wxSwitch.snowOff.layers.length === 0 && c.wxSwitch.snowOff.on.length === 0 && c.wxSwitch.plusFog.layers.filter((l) => l === 'fog').length === 1 && !c.wxSwitch.minusFog.layers.includes('fog'), JSON.stringify(c.wxSwitch)],
  ['weather: a mix is lit by what is in it, not by its name', JSON.stringify(c.wxSwitch?.snowOn?.mixes) === '["Snow"]' && JSON.stringify(c.wxSwitch.snowOff.mixes) === '["None"]' && JSON.stringify(c.wxSwitch.storm.mixes) === '["Thunderstorm"]' && c.wxSwitch.storm.on.length === 4 && JSON.stringify(c.wxSwitch.plusFog.mixes) === '["Storm test"]' && JSON.stringify(c.wxSwitch.minusFog.mixes) === '["Thunderstorm"]', JSON.stringify(c.wxSwitch)],
  ['effects quality: Low lightens the TV layers and frames, GM videos stand still; High brings it back', c.quality?.hi?.level === 'high' && c.quality.lo?.level === 'low' && c.quality.lo.atmoW <= 0.6 * 1280 + 1 && c.quality.lo.atmoW < c.quality.hi.atmoW && c.quality.lo.gap === 30 && c.quality.gm?.level === 'low' && c.quality.gm.still && c.quality.gm.frozen !== false && c.quality.back?.level === 'high' && c.quality.back.atmoW === c.quality.hi.atmoW && c.quality.back.gap === 0 && !c.quality.gmBack?.still, JSON.stringify(c.quality)],
  ['frames per second of the TV beside the preview', /^\d+ fps$/.test(c.fps?.text || '') && c.fps.tv > 0, JSON.stringify(c.fps)],
  ['log file: start, errors of the TV window, Copy log; version and log buttons in the keys sheet', c.log?.exists && c.log.started && c.log.probe && c.log.head.startsWith(`Tablescape ${LABEL} (${PKG.version})`) && c.log.copied?.ok && (c.helpFoot || '').includes(LABEL), JSON.stringify([c.log, c.helpFoot])],
  ['fresh blood spreads out for a moment', c.bloodSpread?.early < 30 && c.bloodSpread.later > 150 && c.paintCleanup, JSON.stringify([c.bloodSpread, c.paintCleanup])],
  // 0.7: walls, doors, line of sight, imports
  ['walls: the demo crypt (Universal VTT) brings picture, walls, doors, lights and grid', c.cryptCard?.walls && c.cryptImport?.walls >= 30 && c.cryptImport.doors === 4 && c.cryptImport.lights === 7 && c.cryptImport.span === 28 && c.cryptImport.grid === 1 && c.cryptImport.vision && c.cryptImport.url && c.cryptImport.shown, JSON.stringify([c.cryptCard, c.cryptImport])],
  ['walls tool: five modes, a link to the Party; Party: the button arms it, a click puts it down (on a square), it explores', c.wallsPop?.modes === 5 && c.wallsPop.tool === 'walls' && c.wallsPop.partyLink && c.partyPop?.title === 'Party marker' && c.partyPop.tool === 'party' && c.partyPop.tiles.length === 6 && c.partyPop.carry === 'lantern' && JSON.stringify(c.partyPop.reach) === '[30,60]' && c.partyPop.snap === true && c.partyPop.armedBefore?.parties === 0 && c.partyPop.armedBefore.ghost && Math.abs(c.losParty?.x) < 0.02 && Math.abs(c.losParty.y) < 0.02 && c.losParty.sight >= 1 && c.losParty.fog, JSON.stringify([c.wallsPop, c.partyPop, c.losParty])],
  ['line of sight on the TV: lights stop at walls, the party sees its room only', c.losTv?.live && c.losTv.vision?.on && c.losTv.vision.eyes === 1 && c.losTv.vision.shadowed >= 7 && c.losTv.vision.composed === 1 && c.losTv.seesA === true && c.losTv.seesB === false && c.losTv.fogA < 40 && c.losTv.fogB > 230, JSON.stringify(c.losTv)],
  ['doors while playing: a lock on the map; a click asks first, No and Esc leave it shut; the lock also asks in the Party tool (the party stays put), and in the Fog tool the party\'s marker is dragged, not brushed over', (() => {
    const d = c.doorAsk || {}; const p = d.inParty || {}; const f = d.inFog || {};
    return d.lock0 && d.lock0.lock === true && d.lock0.open === false && d.asked === 'Open the door?' && d.afterNo && d.afterNo.open === false && d.afterNo.ask === null
      && p.tool === 'party' && p.lock === true && p.asked === 'Open the door?' && p.afterEsc && p.afterEsc.open === false && p.afterEsc.ask === null && p.afterEsc.partyStayed === true
      && f.tool === 'fog' && f.lock === true && f.marker && f.marker.icon === true && f.dragged > 0.1 && f.brushed === 0 && d.lock1 && d.lock1.open === true;
  })(), JSON.stringify(c.doorAsk)],
  ['doors: a click opens the door and the party sees through it', c.doorOpen?.open === true && c.doorOpen.seesB === true && c.doorOpen.sight >= 1, JSON.stringify(c.doorOpen)],
  ['explored ground stays revealed but dimmed out of sight', c.explored?.fogA > 60 && c.explored.fogA < 200 && c.explored.fogC < 40 && c.explored.fogD > 230, JSON.stringify(c.explored)],
  ['walls tool: a line of walls snaps to the grid, Enter ends it', c.wallChain?.added === 2 && JSON.stringify(c.wallChain.rel) === '[[23.5,2,26,2],[26,2,26,5]]' && c.wallChain.ended, JSON.stringify(c.wallChain)],
  ['walls tool: a room in one drag, a door into a wall with a click', c.wallRoom?.mode === 'room' && c.wallRoom.added === 4 && c.wallDoor?.mode === 'door' && c.wallDoor.doors === 1 && JSON.stringify(c.wallDoor.span) === '[24,25]', JSON.stringify([c.wallRoom, c.wallDoor])],
  ['walls tool: dragging a corner moves both walls; erase and undo', c.wallEdit?.moved === 2 && c.wallEdit.erased === 1 && c.wallEdit.undone && c.wallEdit.mode === 'erase', JSON.stringify(c.wallEdit)],
  ['doors: right-click menu', (c.doorRadial || []).includes('Open') && c.doorRadial.includes('Secret door') && c.doorRadial.includes('Make it a wall'), JSON.stringify(c.doorRadial)],
  ['a video map takes the walls file with the same name', c.videoWalls?.walls === 2 && c.videoWalls.doors === 1 && c.videoWalls.span === c.videoWalls.expect && c.videoWalls.kind === 'video' && c.videoWalls.badge && !c.videoWalls.listed, JSON.stringify(c.videoWalls)],
  ['Foundry VTT scene: walls on the map picture, invisible walls skipped, scene choice', c.foundry?.ok && c.foundry.walls === 1 && c.foundry.doors === 1 && c.foundry.lights === 1 && c.foundry.nw === 1920 && c.foundry.x1 === c.foundry.expectX1 && c.foundry.grid === c.foundry.expectGrid && JSON.stringify(c.foundryChoose?.choose) === '["Upper hall","Cellar"]' && c.foundryChoose.ok && c.foundryChoose.walls === 2, JSON.stringify([c.foundry, c.foundryChoose])],
  ['walls test cleaned up: original map back on the table', c.wallsCleanup?.live && c.wallsCleanup.edit && c.wallsCleanup.gone, JSON.stringify(c.wallsCleanup)],
  ['toolbox panels; Strike now sits with a lightning layer in the weather and flashes with thunder', JSON.stringify(c.toolboxPanels) === '["Initiative","Countdown","Characters","Moments","Snapshots","Soundboard","Spotify","Break","Session log","Room lights","Phone & tablet","Players\' phones"]' && c.strikeBtn && c.strike?.strikes >= 1 && c.strike.thunders >= 1, JSON.stringify([c.toolboxPanels, c.strikeBtn, c.strike])],
  ['talk: two NPCs rise out of the ink on both sides, the map blurs', c.talkPop === 'Portraits' && c.talkOn && c.talk?.cast?.length === 2 && c.talk.tv?.sides === 2 && c.talk.tv.npcs === 2 && /captain/i.test(c.talk.tv.front || '') && c.talk.tv.ink && c.talk.tv.drops > 5 && !!c.talk.soft, JSON.stringify(c.talk)],
  ['talk: mirror a portrait, opaque paintings get soft edges', c.talkMirror === 1 && c.talkOpaque?.alpha === false && c.talkOpaque.tv?.opaque === 1 && c.talkOpaque.tv.npcs === 3, JSON.stringify([c.talkMirror, c.talkOpaque])],
  ['talk: click again takes one out, ending clears the TV', c.talkOut?.cast === 2 && c.talkOut.tv === 2 && c.talkEnd?.state === null && c.talkEnd.tv === null && c.talkEnd.soft === null, JSON.stringify([c.talkOut, c.talkEnd])],
  ['handout from the library, shown to both long sides', c.handout?.state === 'Sealed letter' && c.handout.tv?.faces === 2 && c.handout.tv.loaded && c.handout.hud, JSON.stringify(c.handout)],
  ['players on one side: one copy; the HUD puts it away', c.handoutOne?.faces === 1 && c.handoutHidden?.state === null && c.handoutHidden.tv === null, JSON.stringify([c.handoutOne, c.handoutHidden])],
  ['soundboard: one sound per row, whole names, search box for long lists', c.boardList?.single && c.boardList.cut === 0 && c.boardList.search && (c.board || []).includes('Enemy Wave 02') && JSON.stringify(c.boardSearch) === '["Door creak"]', JSON.stringify([c.boardList, c.board, c.boardSearch])],
  ['ducking: the ambience dips while a soundboard sound plays, then comes back', c.duck?.ducks >= 1 && c.duck.gain < 0.7 && c.duckBack > 0.9, JSON.stringify([c.duck, c.duckBack])],
  ['break: the dial sits in the middle of the TV', Math.abs(c.brkCenter?.dx ?? 99) <= 3 && Math.abs(c.brkCenter?.dy ?? 99) <= 3 && c.brkCenter.w > 100, JSON.stringify(c.brkCenter)],
  ['soundboard plays a sound from Audio/SFX once on the TV', ['Bell', 'Door creak', 'Monster roar', 'Thunder'].every((n) => (c.board || []).includes(n)) && (c.boardPlayed || []).includes('Door creak'), JSON.stringify([c.board, c.boardPlayed])],
  ['break screen: a dial for both sides over a blurred map', c.brk?.state && /^[45]:\d\d$/.test(c.brk.tv?.text || '') && c.brk.tv.faces === 2 && !!c.brk.soft && /^[45]:\d\d$/.test(c.brk.hud || '') && c.brkEnd?.state === null && c.brkEnd.tv === null, JSON.stringify([c.brk, c.brkEnd])],
  ['initiative: players added in the pop-up, each token its own row, the goblins share a turn by choice', JSON.stringify(c.partyNames) === '["Mira","Thorin"]' && (c.initRows || []).includes('Mira') && (c.initRows || []).filter((r) => /Goblin/.test(r)).length >= 2
    && /Goblin.*\+.*Goblin/.test((c.initGroup?.units || []).find((u) => /Goblin/.test(u)) || '') && /Goblin ×\d/.test(c.initGroup?.bar || ''), JSON.stringify([c.initRows, c.initGroup])],
  ['initiative: Enter jumps to the next empty number, the last number sorts the list, Start keeps the order', c.initJump?.to?.empty === true && c.initJump.to.f !== c.initJump.from
    && /Goblin/.test(c.initSorted?.order?.[0] || '') && c.initSorted.order[1] === 'Mira' && c.initSorted.order[2] === 'Thorin' && c.initSorted.running === false
    && JSON.stringify(c.initStart?.order) === JSON.stringify(c.initSorted.order) && c.initStart.round === 1 && c.initStart.running === true && /Goblin/.test(c.initStart.turn || ''), JSON.stringify([c.initJump, c.initSorted, c.initStart])],
  ['initiative on the TV: names only, the group once, its tokens glow; nothing of it under the preview', /Round 1/.test(c.initTv?.rib?.near || '') && /Goblin ×\d/.test(c.initTv.rib.near) && (c.initTv.rib.near.match(/Goblin/g) || []).length === 1 && c.initTv.rib.far && c.initTv.glow >= 2 && c.initTv.pill == null
    && c.initHud?.init === false && c.initHud.round === false, JSON.stringify([c.initTv, c.initHud])],
  ['initiative: Enter for the next turn, a new round after the last', c.initNext?.name === 'Mira' && c.initNext.glow === 0 && /Goblin/.test(c.initRound?.name || '') && c.initRound.round === 2, JSON.stringify([c.initNext, c.initRound])],
  ['initiative: hide from players, end the fight (the pop-up gets ready for the next one)', c.initHidden === null && c.initEnd?.running !== true && c.initEnd.round === null && c.initEnd.fighting === false && c.initAgain?.prepared === true && c.initAgain.rows > 2, JSON.stringify([c.initHidden, c.initEnd, c.initAgain])],
  // library, prep, table
  ['L opens the library with thumbnails', c.drawer?.open && c.drawer.tiles >= 8 && c.drawerThumbs >= 3],
  ['drag from library onto the map adds a token', c.dropAdded === 1],
  ['prep map: players keep seeing the live map', c.prep?.differ && c.prep.topbar && /prep/.test(c.prep.frame) && c.tablePrep?.liveStill],
  ['prep map is preloaded paused on the table', c.tablePrep?.views === 2 && c.tablePrep.prepPaused.every(Boolean)],
  ['Send to table changes the map', !!c.crossfade && c.crossfade.liveId === c.crossfade.expected && c.crossfade.shown.length === 1 && c.crossfade.views === 1],
  ['ambience continues across maps of a chapter', c.crossfade?.ambienceSame, JSON.stringify(c.crossfade?.amb)],
  ['night map: torches light the darkness', c.crossfade?.night?.lights >= 10 && c.crossfade.night.emitters >= 10],
  ['B blacks out the table', c.blackout?.table && /black/.test(c.blackout.frame)],
  ['Tab collapses the map roster', c.rosterCollapsed === true],
  ['chapter menu', Array.isArray(c.chapterMenu) && c.chapterMenu.includes('New chapter')],
  ['layers popover groups atmosphere and tokens', c.layersPop?.rows >= 1 && c.layersPop.groups.includes('Atmosphere')],
  // 0.3: grid
  ['grid match: only the grid changes, tilt is found', c.alignBar && near(c.alignTilt?.size, 0.9, 0.02) && near(c.alignTilt.angle, 12, 1) && c.alignTilt.bgSame && c.alignTilt.viewSame, JSON.stringify(c.alignTilt)],
  ['hex grid: type, size and angle from a drag', c.hexType === 'hex-pointy' && near(c.alignHex?.size, 1.1, 0.02) && near(c.alignHex.angle, 20, 1) && c.alignHex.bgSame, JSON.stringify(c.alignHex)],
  ['tokens snap to hex centres', c.hexSnap === true],
  ['"Make grid squares 1 inch" scales the map, not the image', near(c.oneInch?.cellOnTable, 1, 0.01) && c.oneInch.bgSame, JSON.stringify(c.oneInch)],
  ['hex grid reaches the table', c.tableGrid > 0.005],
  ['rename a map from the right-click menu', c.renamed === 'Upper hall'],
  ['? opens the guide with the keys, also on the start screen; the Guide button opens the first evening', c.help === true && c.helpHome === true && c.guideStart?.tab === 'First evening' && /first evening/i.test(c.guideStart.text) && c.guideStart.tabs.length === 5, JSON.stringify([c.help, c.helpHome, c.guideStart])],
  ['Report a problem writes one zip with about.txt, the log, the settings and the benchmarks (no campaigns)', /Written:/.test(c.report || '') && c.reportZip?.end && c.reportZip.names.includes('about.txt') && c.reportZip.names.includes('tablescape.log') && c.reportZip.names.includes('settings.json') && !c.reportZip.names.some((n) => /campaign\.json|maps\//.test(n)), JSON.stringify([c.report, c.reportZip])],
  ['Options opens from the start screen, on the TV section', c.tableSetup === true],
  ['bank-card calibration shows on the table', c.calibrating === true],
  ['campaign saves and reloads identically', c.persist?.same && c.persist.mapFiles === 2, JSON.stringify(c.persist)],
  ['new campaign starts with a chapter and a map', c.newCampaign?.ok && c.newCampaign.chapters === 1 && c.newCampaign.maps === 1],
  ['first steps are ticked off (TV, calibration, sent) and then go away', c.tips?.tv && c.tips.calib && c.tips.sent && c.firstStepsGone, JSON.stringify([c.tips, c.firstStepsGone])],
  ['4.10.1: tokens only on a Ready list, deleted from the library: no error, greyed on the Ready row, one click takes them off', (() => {
    const m = c.missingLists || {}; const t = (m.toasts || []).find((x) => /no longer in the library/.test(x.text));
    return !!t && !t.error && /2 files on the Ready list/.test(t.text) && !(m.toasts || []).some((x) => x.error) && m.greyed === 2 && m.left === 0 && m.listAfter === 0;
  })(), JSON.stringify(c.missingLists)],
  ['missing files: a toast on opening, the moved file suggested, every use relinked', /Missing: Test move\.png/.test((c.missingToast || []).join()) && c.missingDialog?.title === 'Missing files' && (c.missingDialog.buttons || []).includes('Use Maps/Moved/Test move.png') && c.relinked?.rel === 'Maps/Moved/Test move.png' && c.relinked.left === 0 && /where it should be/.test((c.relinked.dialog || []).join()), JSON.stringify([c.missingToast, c.missingDialog, c.relinked])],
  ['backups: one each time the campaign opens after a change, Earlier versions restores one and keeps the state before', c.backups?.before === 2 && c.backups.rows === 2 && c.backups.oldestMaps === 2 && c.backups.after === 3 && c.backups.labels.includes('Before restoring') && c.backups.mapsNow === 2 && c.backups.restoredRel === 'Maps/Static/Test move.png' && /last 10 are kept/.test(c.backups.hint || '') && c.backups.folder && /is back to/.test(c.backups.toast), JSON.stringify(c.backups)],
  // 1.1: sound
  ['Layers holds no sounds; its Sound button opens the Sound panel on the Map tab', !(c.layersSound?.groups || []).includes('Sounds') && c.layersSound?.pop === 'Ambience' && c.layersSound?.tab === 'Map', JSON.stringify(c.layersSound)],
  ['Sound panel in three tabs: Chapter (ambience), Map (its sounds), Combat (fight music); no settings in it', (() => {
    const L = c.soundPop?.labels || {}; const has = (t, w) => (L[t] || []).some((l) => l.startsWith(w));
    return JSON.stringify(c.soundPop?.tabs) === '["Chapter","Map","Combat"]' && has('Chapter', 'Ambience for') && !has('Chapter', 'Fight music') && has('Map', 'Sounds on this map') && has('Combat', 'Fight music for')
      && !Object.values(L).flat().some((l) => /Spell sounds|play on|Starts and ends/.test(l));
  })(), JSON.stringify(c.soundPop?.labels)],
  ['Options → Sound (from the Combat tab): speakers, fight music with Initiative, spell sounds with a sound for each look; it fits and scrolls; Esc closes it, the Sound panel stays', (() => {
    const o = c.soundPop?.options || {}; const L = o.labels || [];
    return o.section === 'Sound' && ['Speakers', 'Ambience and music play on', 'Sound effects play on', 'Fight music starts and ends with a fight in Initiative', 'Lower the ambience while effects play', 'Spell sounds', 'Play a sound when a spell is cast', 'Sound for each spell look'].every((w) => L.includes(w))
      && o.looks >= 8 && o.fits && o.fits.bottom <= o.fits.h && o.fits.scrolls && o.closed === true && o.pop === 'Ambience';
  })(), JSON.stringify(c.soundPop?.options)],
  ['two speakers: ambience and music on one, effects on another (or the same)', (c.soundPop?.out || [])[0] === 'System default' && (c.soundPop?.fxOut || [])[0] === 'Same as the ambience', JSON.stringify([c.soundPop?.out, c.soundPop?.fxOut])],
  ['a long panel stays above the map bar and scrolls', c.popFits && c.popFits.bottom <= c.popFits.roster && c.popFits.scrolls, JSON.stringify(c.popFits)],
  ['the sound window plays the chapter ambience (its own process)', c.soundPop?.engine?.state === 'running' && c.soundPop.engine.tracks.some((t) => t.key.startsWith('amb:') && t.playing), JSON.stringify(c.soundPop?.engine)],
  ['library pick: what it picks for, Cancel goes back to the menu', /sound to play while this map/.test(c.pickCancel?.banner?.text || '') && c.pickCancel.banner.cancel && !c.pickCancel.drawer && c.pickCancel.pop === 'Ambience' && c.pickCancel.tab === 'Map', JSON.stringify(c.pickCancel)],
  ['library pick: picking closes the library, the Sound panel is back with the new sound lit', !c.pickSound?.drawer && c.pickSound.pop === 'Ambience' && c.pickSound.tab === 'Map' && c.pickSound.flash === c.pickSound.layer && c.pickSound.tracks.includes('map') && !c.pickSound.tracks.includes('amb'), JSON.stringify(c.pickSound)],
  ['a map sound: volume and mute in its row, the sound window follows; removing it brings the ambience back', c.soundRow?.vol === 0.3 && c.soundRow.engineVol === 0.3 && c.soundRow.muted === true && c.soundRow.engineMuted === true && c.soundRemove?.layers === 0 && c.soundRemove.tracks.includes('amb') && !c.soundRemove.tracks.includes('map'), JSON.stringify([c.soundRow, c.soundRemove])],
  ['fight music: picked per chapter, starts with a fight, the ambience waits underneath, ends with it', /Battle drums/.test(c.fightPick?.music || '') && c.fightPick.flash === 'fight' && !c.fightPick.drawer && c.fightPick.tab === 'Combat' && c.fightOn?.tracks.includes('fight') && c.fightOn.playing && c.fightOn.music < 0.3 && c.fightOn.fighting && !c.fightOff?.tracks.includes('fight') && c.fightOff.music > 0.9, JSON.stringify([c.fightPick, c.fightOn, c.fightOff])],
  ['fight music by hand', c.fightManual?.on.includes('fight') && !c.fightManual.off.includes('fight') && c.fightManual.state === false, JSON.stringify(c.fightManual)],
  ['Quiet fades all table sound out and back in', c.quiet?.on.state === true && c.quiet.on.master < 0.05 && /Unmute/.test(c.quiet.on.label) && c.quiet.off.state === false && c.quiet.off.master > 0.95, JSON.stringify(c.quiet)],
  ['speakers: a missing one falls back to the default and shows as not connected; Test plays a chime on each', c.soundOut?.device === '' && c.soundOut.error && c.soundOut.fxDevice === '' && c.soundOut.fxError && (c.soundOut.options || []).includes('Test speaker (not connected)') && (c.soundOut.fxOptions || []).includes('Test fx (not connected)') && c.soundOut.tests.music === 1 && c.soundOut.tests.fx === 1, JSON.stringify(c.soundOut)],
  ['effects follow the ambience\'s speaker when set to the same', c.soundOutSame?.device === '' && c.soundOutSame.fxDevice === '' && !c.soundOutSame.fxError && c.soundOutSame.fxState === 'running' && c.soundOutSame.value === '__same', JSON.stringify(c.soundOutSame)],
  // 1.3
  ['Build pin: M moves the map while Build is folded; pinned, Build stays open with another tool', c.rail13?.f0 && c.rail13.mKey.tool === 'map' && c.rail13.f1 && !c.rail13.pinned.folded && c.rail13.pinned.on && c.rail13.pinned.saved === '0' && c.rail13.unpinned, JSON.stringify(c.rail13)],
  ['off the table: Layers counts and marks them, Show zooms out, they can be clicked and deleted there', /^2 things are off the table/.test(c.offTable?.layersOff.head || '') && c.offTable.layersOff.badges === 2 && c.offTable.layersOff.bring === 2 && c.offTable.camAfter < c.offTable.camBefore && c.offTable.inView && c.offTable.picked && c.offTable.deleted && c.offTable.back, JSON.stringify(c.offTable)],
  ['off the table: Bring here, Remove all of them in one step (undo brings them back)', c.offTable2?.gobOn && c.offTable2.removed.fx === c.offTable2.fxBefore - 1 && !c.offTable2.removed.torch && c.offTable2.removed.offs === 0 && !c.offTable2.removed.head && c.offTable2.undone, JSON.stringify(c.offTable2)],
  ['Options (the rail button): TV, Picture, Players, Looks, Tokens, Sound, Performance, This screen, Library down the side', c.tableTabs?.optRail === 'Options' && JSON.stringify(c.tableTabs?.tabNames) === '["TV","Picture","Players","Looks","Tokens","Sound","Performance","This screen","Library"]' && (c.tableTabs.tabLabels.TV || []).includes('Blackout') && (c.tableTabs.tabLabels.Players || []).includes('Players sit on') && (c.tableTabs.tabLabels.Players || []).includes('TV text and panels') && (c.tableTabs.tabLabels.Performance || []).includes('Effects quality') && (c.tableTabs.tabLabels['This screen'] || []).includes('Size of everything in this window') && (c.tableTabs.tabLabels['This screen'] || []).includes('Hotbar') && (c.tableTabs.tabLabels.Library || []).some((l) => /Your library/.test(l)) && !(c.tableTabs.tabLabels.TV || []).some((l) => /speaker|Ambience/i.test(l)), JSON.stringify([c.tableTabs?.optRail, c.tableTabs?.tabNames, c.tableTabs?.tabLabels])],
  ['Picture per TV: brightness and contrast as a filter, gamma and warmth through the colour curve, Reset clears it', c.tableTabs?.simple.filter === 'brightness(1.25) contrast(1.1)' && /tv-picture/.test(c.tableTabs.svg.filter) && c.tableTabs.svg.svg && c.tableTabs.tvKey === 'window' && c.tableTabs.saved.gamma === 1.4 && c.tableTabs.saved.warmth === 0.5 && c.tableTabs.reset === '', JSON.stringify(c.tableTabs && [c.tableTabs.simple, c.tableTabs.svg, c.tableTabs.saved, c.tableTabs.reset])],
  ['the reference picture on the TV (loaded; what to look for behind the "?"; 4.3.1: no test pattern), gone when leaving the Picture section', c.tableTabs?.testOn === true && c.tableTabs.testOff === 0 && c.tableTabs.reference?.on === 'reference' && c.tableTabs.reference.loaded === true && c.tableTabs.reference.state === 'reference' && c.tableTabs.reference.hint, JSON.stringify([c.tableTabs?.testOn, c.tableTabs?.testOff, c.tableTabs?.reference])],
  ['Add from PC: copied into the library with its walls file, not twice', c.addFromPc?.ok && c.addFromPc.copied === 2 && c.addFromPc.walls === 1 && c.addFromPc.wallsFile && c.addFromPc.again.copied === 0 && c.addFromPc.again.rel === 'Maps/Static/Old hall.png' && c.addFromPc.button, JSON.stringify(c.addFromPc)],
  ['a map added from the PC becomes a new map at real size (grid found in the picture)', c.realImage?.added === 1 && c.realImage.name === 'Plain hall' && !c.realImage.drawer && c.realImage.how === 'image' && near(c.realImage.scale, 1 / 54, 0.0002) && c.realImage.grid.size === 1 && /36 × 20 squares/.test(c.realImage.toast), JSON.stringify(c.realImage)],
  ['real size from the file name ("36x20"); a walls file keeps its own size', c.realName?.how === 'name' && c.realName.cols === 36 && near(c.realName.scale, 1 / 53.6, 0.0004) && c.realWalls?.walls === 2, JSON.stringify([c.realName, c.realWalls])],
  ['TV preview: drag its corner to the next size, sharper picture; double-click opens a big one', c.preview?.w0 === 212 && c.preview.w1 === 340 && c.preview.nat1 >= 300 && c.preview.big?.w >= 900 && c.preview.big.nat >= 900 && c.preview.w2 === 212 && c.preview.saved === '212', JSON.stringify(c.preview)],
  ['frame-rate watch: asks when the TV stutters, Switch makes that map lighter, Not now stops asking', /The TV is stuttering/.test(c.fpsWatch?.ask || '') && /Heaviest here: Rain/.test(c.fpsWatch.ask) && c.fpsWatch.lighter.map === 'medium' && c.fpsWatch.lighter.tv === 'medium' && c.fpsWatch.lighter.base === 'high' && /plays with Medium effects/.test(c.fpsWatch.line || '') && c.fpsWatch.back === 'high' && c.fpsWatch.askedAgain === false, JSON.stringify(c.fpsWatch)],
  ['screen moments: seventeen in the panel; the earthquake shakes the TV with its sound and ends by itself', c.moments?.rows.length === 17 && c.moments.quake.tv.drawn.includes('earthquake') && /translate/.test(c.moments.quake.tv.transform) && c.moments.quake.sound.includes('moment-earthquake') && !c.moments.quake.after.drawn.length && c.moments.quake.after.transform === '', JSON.stringify(c.moments?.quake)],
  ['lasting moments: gas stays until clicked again, shown under the preview; time stop freezes and greys the TV', c.moments?.gas.tv.drawn.includes('gas') && c.moments.gas.hud.length === 1 && c.moments.gas.row && c.moments.gas.stopped.state === 0 && !c.moments.gas.stopped.tv.length && c.moments.still.frozen && /grayscale/.test(c.moments.still.filter) && !c.moments.stillOff.frozen && c.moments.stillOff.filter === '', JSON.stringify(c.moments && [c.moments.gas, c.moments.still, c.moments.stillOff])],
  ['moments at a spot, starred on Shift + a number, with their own sound or one from Audio/SFX', /Click where the explosion/.test(c.moments?.spot.aimBar || '') && near(c.moments.spot.x, 8, 0.1) && near(c.moments.spot.y, 6, 0.1) && c.moments.spot.tv.includes('explosion') && c.moments.stars.includes('nat20') && c.moments.shift.includes('nat20') && /Pick a sound for the earthquake/.test(c.moments.own.banner || '') && c.moments.own.set?.own && !c.moments.own.drawer && c.moments.own.panel && JSON.stringify([...(c.moments.own.board || [])].sort()) === '["Bell","Big explosion"]', JSON.stringify(c.moments && [c.moments.spot, c.moments.stars, c.moments.shift, c.moments.own])],
  ['a spell plays its moment where it lands', c.spellImpact?.added && near(c.spellImpact.x, 12, 1) && near(c.spellImpact.y, 8, 1), JSON.stringify(c.spellImpact)],
  ['older cues (before 2.1) still play: F1 brings back light, weather and effects with its moment (the map has no snapshots); one undo step', c.cues?.saved?.slot === 1 && c.cues.saved.data.darkness === 0.6 && c.cues.saved.data.weather === 1 && c.cues.saved.data.smoke === true && c.cues.momentPart === 'nat20' && c.cues.played.darkness === 0.6 && c.cues.played.weather.includes('rain') && c.cues.played.smokeHidden && c.cues.played.moment.includes('nat20') && c.cues.undone.darkness === 0 && c.cues.undone.weather === 0 && !c.cues.undone.smokeHidden, JSON.stringify(c.cues)],
  // 1.4
  ['rail: undo and redo on top say what they take back; Snapshots in the Toolbox (4.5), Party in Play; Campaigns, Table and Keys full size; it fits', c.rail14?.top === 'rail-history' && c.rail14.undo && c.rail14.redo && c.rail14.cuesIn === 'toolbox' && c.rail14.partyIn === 'play' && c.rail14.homeBig && c.rail14.tableBig && c.rail14.keysBig && c.rail14.fits && c.rail14.undoTip === 'Undo: Light' && c.rail14.undone === 0 && c.rail14.redoTip === 'Redo: Light' && c.rail14.redone === 0.25, JSON.stringify(c.rail14)],
  ['Snapshots open from the Toolbox; no snapshot buttons under the preview (2.2); F1 at the table switches at once and asks (2.5: and waits) whether to keep the changes', c.rail14?.cuesPanel && (c.rail14.chips || []).length === 0 && c.rail14.chipPlayed === 0 && (() => { const k = c.rail14.keepOffer; return !!k && k.title === 'Save the changes into Calm?' && /You had changed the scene light since you saved Calm/.test(k.text) && k.btns.includes('Go back to Calm') && k.btns.includes('Throw them away') && k.btns.includes('Save into Calm') && k.focus === 'Save into Calm' && k.stillOpen && k.closed && k.kept === 0.5; })(), JSON.stringify(c.rail14 && [c.rail14.cuesPanel, c.rail14.chips, c.rail14.chipPlayed, c.rail14.keepOffer])],
  ['4.3: a snapshot whose changes were saved plays again without asking again (it kept asking)', JSON.stringify(c.rail14?.keepOffer?.again) === '[false,false,false]', JSON.stringify(c.rail14?.keepOffer?.again)],
  ['walls: a corner dragged in Walls mode takes the joined wall along; a click on a corner starts a line; Edit moves a whole wall; one undo', (() => {
    const w = c.wallCorners; if (!w) return false;
    const [a, b] = w.afterCorner || [];
    const joined = a && b && a[2] === b[0] && a[3] === b[1];
    const moved = joined && Math.hypot(a[2] - w.B[0], a[3] - w.B[1]) > w.g;
    const chainAt = (w.chain || [])[0];
    const [m0, m1] = w.afterMove || [];
    const whole = m0 && Math.abs(m0[1] - a[1] - 2 * w.g) < 0.6 * w.g && Math.abs(m0[3] - a[3] - 2 * w.g) < 0.6 * w.g && m1[0] === m0[2] && m1[1] === m0[3] && m1[2] === b[2] && m1[3] === b[3];
    return w.grab && moved && chainAt && chainAt[0] === w.C[0] && chainAt[1] === w.C[1] && whole && JSON.stringify(w.undone) === JSON.stringify(w.afterCorner);
  })(), JSON.stringify(c.wallCorners)],
  ['Party tool: arrow keys move one square, a click moves it there (on a square), its light and darkvision', c.party14?.partyRail && Math.abs(c.party14.p1.x - c.party14.p0.x - 2 * c.party14.g) < 0.02 && Math.abs(c.party14.p1.y - c.party14.p0.y - c.party14.g) < 0.02 && Math.abs(c.party14.p2.x - c.party14.centre[0]) < 0.01 && Math.abs(c.party14.p2.y - c.party14.centre[1]) < 0.01 && c.party14.set.carry === 'none' && c.party14.set.bright === 0 && c.party14.set.dim === 0 && c.party14.set.dv === 60, JSON.stringify(c.party14)],
  ['the party in the dark without walls: darkvision sees near, not far', c.party14?.near === true && c.party14.far === false && c.party14.eyes === 1, JSON.stringify(c.party14 && [c.party14.near, c.party14.far, c.party14.eyes])],
  ['Spotify, all in the Toolbox: an empty panel with Connect Spotify, then three steps with the exact redirect address; a wrong Client ID is refused; PKCE login links it', JSON.stringify(c.spotifyLink?.setup.soundTabs) === '["Chapter","Map","Combat"]' && /Connect Spotify|Needs Spotify Premium/.test(c.spotifyLink.setup.empty.text || '') && c.spotifyLink.setup.empty.steps === 0 && c.spotifyLink?.setup.steps === 3 && c.spotifyLink.setup.uri === 'http://127.0.0.1:43177/callback' && c.spotifyLink.setup.buttons.includes('Open the developer site') && c.spotifyLink.setup.dashboard === 'https://developer.spotify.com/dashboard' && /does not look like a Client ID/.test(c.spotifyLink.setup.badId) && /Waiting for Spotify/.test(c.spotifyLink.setup.waiting || '') && c.spotifyLink.pkce && /user-modify-playback-state/.test(c.spotifyLink.scope || '') && c.spotifyLink.redirect === 302 && c.spotifyLink.page && c.spotifyLink.linked && c.spotifyLink.user === 'Test GM' && c.spotifyLink.linkedView && c.spotifyLink.noNull && (c.spotifyLink.devices || []).includes('GM-LAPTOP'), JSON.stringify(c.spotifyLink)],
  ['Spotify panel: playlists, liked songs, songs of your own playlist, search; moods from songs or a playlist', (() => {
    const l = c.spotifyPlay?.lib; if (!l) return false;
    const moods = Object.fromEntries(l.moods);
    return JSON.stringify(l.playlists) === '["Battle Epic","Tavern Folk"]' && l.liked.includes('Dragon Fight') && JSON.stringify(l.songs) === '["Dragon Fight","Steel and Fire","Last Stand"]' && l.search.includes('Dragonborn') && l.search.includes('Skyrim') && l.searchLimit === 10
      && JSON.stringify(moods.Battle) === '["Dragon Fight","Tavern Jig"]' && JSON.stringify(moods.Tavern) === '["Tavern Folk"]';
  })(), JSON.stringify(c.spotifyPlay?.lib)],
  ['Spotify: a mood plays on the laptop without volume steps (no fades: they made it stutter), shows under the preview, the ambience dips; pause', c.spotifyPlay?.device === 'dev1' && (c.spotifyPlay.uris || []).length === 2 && JSON.stringify(c.spotifyPlay.volumes) === '[]' && /Battle/.test(c.spotifyPlay.now) && c.spotifyPlay.gain < 0.6 && c.spotifyPlay.paused.playing === false && c.spotifyPlay.paused.pauses >= 1 && c.spotifyPlay.gainAfter > 0.9, JSON.stringify(c.spotifyPlay && { ...c.spotifyPlay, lib: undefined })],
  ['Spotify: a chapter\'s fight music from a mood (no file), a cue starts a mood, unlinking clears it', c.spotifyMore?.fight.mood && c.spotifyMore.fight.context === 'spotify:playlist:pl2' && !c.spotifyMore.fight.fileTrack && c.spotifyMore.fight.pausedAfter && c.spotifyMore.cuePlay.part === true && c.spotifyMore.cuePlay.mood && c.spotifyMore.cuePlay.played === 1 && c.spotifyMore.unlinked && c.spotifyMore.row === '', JSON.stringify(c.spotifyMore)],
  // 1.4.1
  ['Change over (10 seconds / at once) lights up when clicked and is remembered', JSON.stringify(c.rail14?.changeOver?.on) === '["At once"]' && c.rail14.changeOver.saved === '0' && JSON.stringify(c.rail14.changeOver.back) === '["10 seconds"]', JSON.stringify(c.rail14?.changeOver)],
  ['placing the party: armed by the button with a ring under the mouse, Esc cancels, only the click puts it down', /Click on the map where the party stands/.test(c.party14?.armedHint || '') && c.party14.afterEsc.parties === 0 && c.party14.afterEsc.pop && c.party14.afterEsc.placing === false && c.party14.ghostRing > 40, JSON.stringify(c.party14 && [c.party14.armedHint, c.party14.afterEsc, c.party14.ghostRing])],
  ['the party beyond the walls sees the open ground on its far side (not cut off past the outermost wall)', c.party14?.beyondWalls?.on && c.party14.beyondWalls.far === true && c.party14.beyondWalls.behind === false, JSON.stringify(c.party14?.beyondWalls)],
  ['Spotify: linked, the panel shows what plays with the volume and the settings behind the gear; Ctrl + 1 plays the first mood; Quiet fades Spotify out and back in', /Nothing playing/.test(c.spotifyLink?.linkedPanel?.player || '') && c.spotifyLink.linkedPanel.volume && c.spotifyLink.linkedPanel.settingsHidden && c.spotifyLink.linkedPanel.settingsShown && (c.spotifyLink.linkedPanel.devices || []).some((d) => /GM-LAPTOP/.test(d)) && c.spotifyKeys?.ctrl1.played === 1 && c.spotifyKeys.ctrl1.mood && c.spotifyKeys.quietOn.paused && c.spotifyKeys.quietOn.quiet && c.spotifyKeys.quietOff.playing && c.spotifyKeys.quietOff.resumed >= 1 && !c.spotifyKeys.quietOff.quiet, JSON.stringify([c.spotifyLink?.where, c.spotifyKeys])],
  // 1.4.2
  ['Spotify volume: the slider sets it (moods fade in to it), the mouse wheel on the row under the preview too', c.spotifyKeys?.vol?.slider === 35 && c.spotifyKeys.vol.saved === 35 && c.spotifyKeys.vol.wheel === 40, JSON.stringify(c.spotifyKeys?.vol)],
  ['Effects → Light sources holds no party light (the party has its own tool)', c.lightTiles && !c.lightTiles.includes('Party light') && c.lightTiles.includes('Torch'), JSON.stringify(c.lightTiles)],
  // 1.5
  ['Toolbox → Dice (4.3: with the tools on the map): Dice, Wheel and Death save tabs, a pad from d4 to d100; a click adds a die, a right-click takes one out; a bonus', (() => {
    const p = c.dice15?.panel; if (!p) return false;
    return p.open && !p.tiles.includes('Dice') && (p.mapTiles || []).includes('Dice') && JSON.stringify(p.tabs) === '["Dice","Wheel","Death save"]' && JSON.stringify(p.pad) === '["d2","d4","d6","d8","d10","d12","d20","d100"]' && p.hand2 === '2d6 + 1d20' && p.hand === '1d6 + 1d20 + 2' && p.advHidden === true;
  })(), JSON.stringify(c.dice15?.panel)],
  ['a dice roll on the TV: the total is the dice plus the bonus; a slot reel per die spins, they lock one after the other, a chime; the panel shows the same total', (() => {
    const d = c.dice15; if (!d || !d.r1) return false;
    const sum = d.r1.dice.reduce((a, x) => a + x.value, 0) + 2;
    const ranged = d.r1.dice.every((x) => x.value >= 1 && x.value <= x.sides);
    const stops = d.r1.stops || [];
    return d.r1.kind === 'dice' && d.r1.label === '1d6 + 1d20 + 2' && d.r1.dice.length === 2 && ranged && d.r1.total === sum && d.r1.crit === null
      && stops.length === 2 && stops[0] >= 2000 && stops[1] > stops[0] && d.r1.reveal > stops[1] && d.r1.dur > d.r1.reveal
      && d.rolling.on && d.rolling.kind === 'dice' && d.landed.phase === 'result' && d.sounds.stop === 2 && (d.sounds.reel || 0) >= 2 && !d.sounds.clack && d.sounds.chime === 1 && d.shown === String(sum) && d.log && d.log.total === sum;
  })(), JSON.stringify(c.dice15 && { ...c.dice15, panel: undefined, adv: undefined })],
  ['advantage (one d20 only): two d20 roll, the lower one is dropped; a natural 20 or 1 gets its own show; a d2 rolls 1 or 2', (() => {
    const a = c.dice15?.adv; if (!a) return false;
    const d2 = c.dice15.d2;
    if (!d2 || !d2.pad || d2.label !== '1d2' || d2.sides !== 2 || ![1, 2].includes(d2.value)) return false;
    const kept = a.dice.filter((x) => !x.dropped); const dropped = a.dice.filter((x) => x.dropped);
    const hi = Math.max(...a.dice.map((x) => x.value));
    return a.shown && a.label === '1d20 (advantage)' && a.dice.length === 2 && kept.length === 1 && dropped.length === 1 && kept[0].value === hi && a.total === hi && a.crit === (hi === 20 ? 'nat20' : hi === 1 ? 'nat1' : null);
  })(), JSON.stringify([c.dice15?.adv, c.dice15?.d2])],
  ['wheel of luck: three starter wheels in muted colours (bright 1.5 colours turn muted); a campaign wheel with weights; an entry added in the panel; a click on the weight gives it more', (() => {
    const w = c.wheel15; if (!w) return false;
    return ['Yes / No / Maybe', 'Weather', 'Coin'].every((n) => w.starters.includes(n)) && JSON.stringify(w.yesColors) === '["#4f6b3a","#7a2e2a","#9a7b3c"]' && JSON.stringify(w.oldNow) === '["#7a2e2a","#4f6b3a"]' && JSON.stringify(w.rows) === '["Gold","Sword","Nothing","Potion"]' && JSON.stringify(w.weights) === '[3,2,1,1]' && w.saved && w.undoDelete;
  })(), JSON.stringify(c.wheel15 && { yesColors: c.wheel15.yesColors, oldNow: c.wheel15.oldNow, starters: c.wheel15.starters, rows: c.wheel15.rows, weights: c.wheel15.weights, saved: c.wheel15.saved, undoDelete: c.wheel15.undoDelete })],
  ['wheel (1.7): one slot reel of the entries, each as often as its weight; it rattles, slows, locks on the result and shows it; no "land here"; × deletes an entry', (() => {
    const w = c.wheel15; if (!w || !w.spin) return false;
    const sp = w.spin;
    const counts = [0, 0, 0, 0]; for (const i of sp.strip || []) counts[i]++;
    return w.noForcing && sp.kind === 'wheel' && sp.title === 'Loot' && sp.n === 4 && JSON.stringify(counts) === '[3,2,1,1]' && sp.strip[sp.cell] === sp.index && sp.labels[sp.index] === sp.label
      && sp.stops && sp.stops[0] >= 4500 && sp.reveal > sp.stops[0]
      && w.phase === 'result' && w.sounds.stop === 1 && (w.sounds.reel || 0) >= 3 && !w.sounds.whtick && w.sounds.good === 1 && w.shown === sp.label && JSON.stringify(w.afterDelete) === '["Gold","Sword","Potion"]';
  })(), JSON.stringify(c.wheel15 && { noForcing: c.wheel15.noForcing, spin: c.wheel15.spin, afterDelete: c.wheel15.afterDelete, phase: c.wheel15.phase, ticks: c.wheel15.ticks, sounds: c.wheel15.sounds, shown: c.wheel15.shown })],
  ['death save: one d20 reel in the dark, slowing to its number; 10 or more is a success, below 10 a failure; Take it off the TV', (() => {
    const d = c.death15; if (!d || !d.d) return false;
    const v = d.d.value; const good = v >= 10;
    const snd = v === 20 ? 'crit' : v === 1 ? 'fumble' : good ? 'good' : 'bad';
    const word = v === 20 ? /Natural 20/ : v === 1 ? /Natural 1/ : good ? /Success/ : /Failure/;
    return d.d.kind === 'death' && v >= 1 && v <= 20 && d.d.good === good && d.d.stops && d.d.stops[0] >= 5000 && d.phase === 'result' && !d.sounds.heart && d.sounds.stop === 1 && (d.sounds.reel || 0) >= 2 && d.sounds[snd] === 1 && (d.cls || '').includes(good ? 'good' : 'bad') && word.test(d.text || '') && d.off;
  })(), JSON.stringify(c.death15)],
  // 1.6
  ['the campaign page: the rail opens it (the table keeps its map); players added, one not here today', (() => {
    const p = c.page16; if (!p) return false;
    return p.page.screen === 'campaign' && p.page.shown && p.page.live && ['Aela', 'Brom', 'Cid'].every((n) => p.players.party.includes(n)) && JSON.stringify(p.players.away) === '["Cid"]' && p.players.awayRow && /of \d+ here/.test(p.players.count || '');
  })(), JSON.stringify(c.page16 && [c.page16.page, c.page16.players])],
  ['the campaign page: the title (own text, a map as picture) in a preview; the table check lists TV, size, speakers, Spotify, files, players', (() => {
    const p = c.page16; if (!p) return false;
    const ids = (p.checks || []).map((x) => x.split(':')[0]);
    return p.titleUi.preview === 'The Goblin Caves' && p.titleUi.sub === 'Chapter 2' && p.titleUi.noNumber && p.titleUi.pic && p.titleUi.saved && p.titleUi.saved.title === 'The Goblin Caves' && p.titleUi.saved.pic && p.titleUi.saved.pic.path
      && JSON.stringify(ids) === '["tv","size","music","fx","spotify","files","players"]';
  })(), JSON.stringify(c.page16 && [c.page16.titleUi, c.page16.checks])],
  ['the campaign\'s break and blackout: own label and text, dark behind the break, the campaign name on the blackout; the TV shows only the screen of the open tab and follows the tabs', (() => {
    const p = c.page16; if (!p || !p.brk || !p.black) return false;
    return p.brk.label === 'Short rest' && p.brk.note === 'Snacks are in the kitchen' && p.brk.bg === 'dark' && p.brkOff
      && p.black.style === 'title' && p.black.title === 'Demo: the goblin caves' && p.black.text === 'Back in a moment'
      && p.follow.title === 'The Goblin Caves' && p.follow.blackout === false && p.follow.brk === false && p.blackOff;
  })(), JSON.stringify(c.page16 && [c.page16.brk, c.page16.black, c.page16.follow])],
  ['1.8: the little maid is the default screen picture; the page shows small copies only; the maps rest while the page is open', (() => {
    const p = c.page16; if (!p || !p.defaultPic) return false;
    return p.defaultPic.value === '' && /little maid/.test(p.defaultPic.option) && /default-small\.webp$/.test(p.defaultPic.fit || '') && p.defaultPic.mapsPaused
      && p.titleUi.small && p.titleUi.small.thumb && p.titleUi.small.w > 0 && p.titleUi.small.w <= 400 && p.running.mapsPlay;
  })(), JSON.stringify(c.page16 && [c.page16.defaultPic, c.page16.titleUi && c.page16.titleUi.small, c.page16.running && c.page16.running.mapsPlay])],
  ['Start session (no number): the maps open, the title on the TV for both sides (with its line and the picture); Initiative has only the players here today', (() => {
    const p = c.page16; if (!p || !p.title) return false;
    return p.started.screen === 'play' && p.started.session && p.started.session.started && p.started.last > 0 && p.started.text === 'Start session'
      && p.title.title === 'The Goblin Caves' && p.title.sub === 'Chapter 2' && p.title.faces === 2 && p.title.pic && /Title: The Goblin Caves/.test(p.status || '') && p.offBtn
      && p.ini.rows.includes('Aela') && p.ini.rows.includes('Brom') && !p.ini.rows.includes('Cid') && p.ini.away === null;
  })(), JSON.stringify(c.page16 && [c.page16.started, c.page16.title, c.page16.status, c.page16.ini])],
  ['the first map sent takes the title away; on the page the running session says so, Back to the table', (() => {
    const p = c.page16; if (!p) return false;
    return p.afterSend.title === null && !p.afterSend.tv && p.running.start === 'Back to the table' && /The session is running/.test(p.running.running || '') && p.running.prepHidden && p.running.back === 'play';
  })(), JSON.stringify(c.page16 && [c.page16.afterSend, c.page16.running])],
  // 1.8
  ['token name tags: "Players too" shows the name on the TV, facing the nearer long side; "Only me" only on the GM screen (blue); never for a hidden token', (() => {
    const t = c.tokens18; if (!t) return false;
    return t.sides.top && t.sides.top.far === true && t.sides.bottom && t.sides.bottom.far === false && t.gmOnly.tv === false && /Goblin/.test(t.gmOnly.gm || '') && t.hiddenOff;
  })(), JSON.stringify(c.tokens18 && [c.tokens18.sides, c.tokens18.gmOnly, c.tokens18.hiddenOff])],
  ['renaming tokens: the card\'s name opens Rename this one / all copies and the name tag; one renamed leaves the numbering, all copies keep their numbers; a copy of a named one stays named', (() => {
    const t = c.tokens18; if (!t) return false;
    return t.menu1.some((x) => /Rename this/.test(x)) && t.menu1.some((x) => /Players see it too/.test(x))
      && t.one.name === 'Grimgor' && t.one.n === null && t.one.named === true && t.one.tv
      && JSON.stringify(t.group.names) === '["Goblin archer","Goblin archer"]' && JSON.stringify(t.group.nums) === JSON.stringify(t.group.before) && t.group.grimgor === 'Grimgor'
      && t.copy.name === 'Grimgor' && t.copy.n === null && t.copy.named === true;
  })(), JSON.stringify(c.tokens18 && [c.tokens18.menu1, c.tokens18.one, c.tokens18.group, c.tokens18.copy])],
  ['Options → Tokens: the name tag of new tokens; the Tokens popover: all tokens on the map at once; the little maid is the loading icon', (() => {
    const t = c.tokens18; if (!t) return false;
    return t.newTag === 'all' && t.allOff && /maid\.webp$/.test(t.loader.src || '') && t.loader.w > 0 && /Testing/.test(t.loader.text) && t.boot;
  })(), JSON.stringify(c.tokens18 && [c.tokens18.newTag, c.tokens18.allOff, c.tokens18.loader, c.tokens18.boot])],
  // 1.9
  ['initiative pop-up: getting ready with the players here and one row per token (no groups by themselves); + Enemy adds numbered enemies with bonus, AC and HP and remembers them', (() => {
    const t = c.init19; if (!t) return false;
    const e = t.enemy;
    return t.prep.running === false && JSON.stringify(t.prep.pcs) === '["Ayla","Bo"]' && t.prep.tokens > 0 && t.prep.oneEach && t.prep.groups === 0 && t.groupBox
      && JSON.stringify(e.names) === '["Skeleton 1","Skeleton 2","Skeleton 3"]' && e.bonus.every((b) => b === 2) && !e.group && e.cols.includes('ac') && e.cols.includes('hp')
      && e.foe && e.foe.bonus === 2 && e.foe.ac === 13 && e.foe.hp === 13 && e.chip.includes('Skeleton');
  })(), JSON.stringify(c.init19 && [c.init19.prep, c.init19.groupBox, c.init19.enemy])],
  ['initiative: + Column (Conditions, your own number), Roll enemies (d20 + bonus, players left empty), the last number sorts the list', (() => {
    const t = c.init19; if (!t) return false;
    return t.cols.kinds.includes('cond') && t.cols.names.includes('Slots') && t.cols.heads.some((h) => /Slots/.test(h))
      && t.rolled.npcs && t.rolled.pcs && t.rolled.sk && t.rolled.disabled === true && t.sorted.desc && t.sorted.first === 'Ayla' && t.sorted.last === 'Bo';
  })(), JSON.stringify(c.init19 && [c.init19.cols, c.init19.rolled, c.init19.sorted])],
  ['initiative: HP takes -7 / +5 / 12 (healing stops at the maximum); at 0 an enemy is grey with a skull; conditions as tags; players\' AC and max HP remembered', (() => {
    const t = c.init19; if (!t) return false;
    return t.hp.s1a?.cur === 6 && t.hp.s1a.max === 13 && t.hp.s1?.cur === 0 && t.hp.s2?.cur === 13 && t.hp.s2.max === 13 && t.hp.rat?.cur === 0 && t.hp.row.down && t.hp.row.skull && /2 defeated/.test(t.hp.note || '')
      && JSON.stringify(t.cond.on) === '["Prone"]' && JSON.stringify(t.cond.chip) === '["Prone"]' && JSON.stringify(t.cond.off) === '[]'
      && t.pcStats && t.pcStats.ac === 16 && t.pcStats.hp === 30
      && t.bo0 && t.bo0.v && t.bo0.v.cur === 0 && t.bo0.v.max == null && t.bo0.text === '0' && !(t.bo0.stats && t.bo0.stats.hp);
  })(), JSON.stringify(c.init19 && [c.init19.hp, c.init19.cond, c.init19.pcStats, c.init19.bo0])],
  ['initiative columns fit what is in them: the names column hugs the longest name, the pop-up narrows when a column goes and widens when it comes back; no hints under the list', (() => {
    const f = c.init19 && c.init19.fit; if (!f) return false;
    return f.name <= f.longest + 4 && f.name >= 100 && f.less <= f.panel - 20 && Math.abs(f.back - f.panel) <= 2 && f.hints === 0;
  })(), JSON.stringify(c.init19 && c.init19.fit)],
  ['a hidden token takes the light it carries off the TV (the GM still sees it)', (() => {
    const l = c.light19; if (!l) return false;
    return l.id && l.before === true && l.hidden === false && l.gm === true && l.gmView === true && l.tvView === false;
  })(), JSON.stringify(c.light19)],
  ['initiative: "Make group" by choice: the skeletons share one turn and one number, each keeps its own HP', (() => {
    const t = c.init19; if (!t) return false;
    return t.grp.gid && JSON.stringify([...t.grp.members].sort()) === '["Skeleton 1","Skeleton 2","Skeleton 3"]' && t.grp.sameInit && t.grp.hp.includes(0) && t.grp.hp.includes(13) && t.grp.hp.includes(9) && /Skeleton ×3/.test(t.grp.bar || '');
  })(), JSON.stringify(c.init19 && c.init19.grp)],
  ['initiative fight: Start keeps the order; TV: names only, the group once, hidden and defeated enemies left out; NPCs at 0 HP skip their turn; drag and drop keeps the turn; Remove the defeated (with undo)', (() => {
    const t = c.init19; if (!t) return false;
    return t.start.same && t.start.turn && t.start.hud === false && t.ribbon.hiddenOff && t.ribbon.downOff && t.ribbon.groupOnce && /Ayla/.test(t.ribbon.near || '')
      && t.skip.rat === false && t.skip.turns > 2 && t.drag.first && t.drag.turn && t.drag.group === null && t.removed.gone && t.removed.back;
  })(), JSON.stringify(c.init19 && [c.init19.start, c.init19.ribbon, c.init19.skip, c.init19.drag, c.init19.removed])],
  ['initiative: the next fight gets ready by itself, with the columns and the players\' AC and HP', (() => {
    const t = c.init19; if (!t) return false;
    return t.again.running === false && t.again.ayla && t.again.ayla.ac === 16 && t.again.ayla.hp && t.again.ayla.hp.max === 30 && t.again.cols === 4;
  })(), JSON.stringify(c.init19 && c.init19.again)],
  ['tables for the wheel: lines, dice ranges (01–60, 96–00), weights (×3, ", 3"), markdown, CSV and tab rows; "3 goblins" keeps its 3', (() => {
    const p = c.tables19 && c.tables19.parse; if (!p) return false;
    return p.lines === 'Goblins:1|Orcs:1|A dragon:1' && p.ranges === 'Goblins:4|Orcs:4|Wolves:11|A dragon:1' && p.d100.e === 'Copper:60|Silver:35|Gold:5' && p.d100.name === 'Treasure' && p.d100.die === 'd100'
      && p.weights === 'Rain:3|Sun:2|Fog:4|Storm:1' && p.csv === 'Goblins, armed:3|Orcs:1' && p.tabs === 'Left:1|Right:1' && p.words === '3 goblins appear:1|A wolf howls:1|Rain:1';
  })(), JSON.stringify(c.tables19 && c.tables19.parse)],
  ['tables for the wheel: Paste a table (preview in %, a new wheel or more entries), files (one wheel each), the library\'s Tables in every campaign, export as CSV', (() => {
    const t = c.tables19; if (!t) return false;
    return /4 entries, a d20 table/.test(t.paste.preview.info || '') && t.paste.preview.rows.some((r) => /Goblins.*40%/.test(r)) && t.paste.preview.name === 'Random encounters (d20)'
      && t.paste.made === 'Goblins:8|Wolves:7|Bandits:4|A dragon:1' && t.paste.picked && t.paste.added === 'An ogre:1|Nothing at all:2'
      && JSON.stringify(t.fromFiles.made) === '["Loot:2","Weather:2"]' && JSON.stringify(t.fromFiles.empty) === '["Empty"]' && t.fromFiles.loot === 'Gold:3|Rope, 50 ft:1'
      && t.library19.rows.some((r) => /Wild magic.*4 entries · d4/.test(r)) && t.library19.copied && t.exported.ok && t.exported.inLib && t.exported.same;
  })(), JSON.stringify(c.tables19 && [c.tables19.paste, c.tables19.fromFiles, c.tables19.library19, c.tables19.exported])],
  // 2.0
  ['hotbar: under the map on the GM screen (never on the TV); a library token, a sound (right-click → Put on the hotbar), a panel, a map card and a wheel go on it', (() => {
    const t = c.hotbar20; if (!t) return false;
    return t.shown && t.tv === false && JSON.stringify(t.saved) === '["token","sound","panel","map","wheel"]' && t.names[0] === 'Goblin' && t.names.every(Boolean);
  })(), JSON.stringify(c.hotbar20 && [c.hotbar20.shown, c.hotbar20.saved, c.hotbar20.names, c.hotbar20.tv])],
  ['hotbar keys 1 – 0: 1 picks up the token, 2 plays the sound, 3 opens the panel, 4 sends the map, 5 spins the wheel; running ones glow', (() => {
    const t = c.hotbar20; if (!t) return false;
    return t.k1.tool === 'token' && t.k1.brush === 'Goblin' && t.k1.live && t.k2 === 1 && t.k3.open && t.k3.live && t.k4.sent && t.k4.live && t.k5 === 'wheel';
  })(), JSON.stringify(c.hotbar20 && [c.hotbar20.k1, c.hotbar20.k2, c.hotbar20.k3, c.hotbar20.k4, c.hotbar20.k5])],
  ['hotbar: slots swap when dragged onto each other, one comes off by right-click, three pages (wheel over the bar), it folds away', (() => {
    const t = c.hotbar20; if (!t) return false;
    return JSON.stringify(t.swap) === '["wheel","sound","panel","map","token"]' && t.off && t.page2.n === '2/3' && t.page2.empty && t.emptyKey && t.back === '1/3'
      && t.folded.bar === 'none' && t.folded.tab !== 'none' && t.unfolded !== 'none';
  })(), JSON.stringify(c.hotbar20 && [c.hotbar20.swap, c.hotbar20.off, c.hotbar20.page2, c.hotbar20.back, c.hotbar20.folded])],
  // 2.1
  ['snapshots: a wide timeline; Save snapshot takes the map as it is (no tokens) with a picture; the second asks how it comes in (a moment)', (() => {
    const t = c.snaps21; if (!t) return false;
    return t.panel && t.panel.w > 700 && t.panel.save && t.panel.empty && t.s1 && t.s1.name === 'Storm in the hall' && t.s1.dark === 0.6 && t.s1.rain === 1 && t.s1.tokens === 0 && t.s1.thumb && t.thumbFile && !t.s1.trans
      && t.dlg && /Snapshot 2/.test(t.dlg.title) && t.dlg.chips.some((x) => /Light: Daylight/.test(x)) && t.s2 && t.s2.name === 'Calm again' && t.s2.moment === 'nat20'
      && JSON.stringify(t.timeline.cards) === '["1 · Storm in the hall","2 · Calm again"]' && t.timeline.trans.length === 1 && /Natural 20/i.test(t.timeline.trans[0]) && t.timeline.thumbs === 2 && t.timeline.at[0] === '2 · Calm again' && t.pill === '2';
  })(), JSON.stringify(c.snaps21 && [c.snaps21.panel, c.snaps21.s1, c.snaps21.s2, c.snaps21.dlg, c.snaps21.timeline, c.snaps21.thumbFile, c.snaps21.pill])],
  ['snapshots: F1 and F2 bring them back (light, weather, effects, assets, the moment), tokens stay where the players put them; one undo step; details', (() => {
    const t = c.snaps21; if (!t) return false;
    return t.f1.dark === 0.6 && t.f1.rain.includes('rain') && t.f1.smokeHidden !== false && !t.f1.asset && t.f1.at && (t.tokX == null || t.f1.tokX === t.tokX)
      && t.f2.dark === 0 && t.f2.rain === 0 && t.f2.asset && t.f2.moment.includes('nat20') && (t.tokX == null || t.f2.tokX === t.tokX)
      && t.undone.dark === 0.6 && !t.undone.asset && t.details && /Calm again/.test(t.details.title) && /Natural 20/i.test(t.details.trans) && t.details.acts.includes('Save the map into it again');
  })(), JSON.stringify(c.snaps21 && [c.snaps21.f1, c.snaps21.f2, c.snaps21.tokX, c.snaps21.undone, c.snaps21.details])],
  ['snapshots follow the map when it is turned later (an asset comes back where its spot lies now)', (() => {
    const t = c.snaps21; if (!t || !t.turn) return false;
    return Math.abs(t.turn.x - 17) < 0.01 && Math.abs(t.turn.y - 3) < 0.01 && Math.abs(((t.turn.rot % 360) + 360) % 360 - 90) < 0.01;
  })(), JSON.stringify(c.snaps21 && c.snaps21.turn)],
  ['fog on the hotbar (from the Fog menu): fog on/off, cover all, rectangles, a marked area; Next snapshot, and it says when it was the last', (() => {
    const t = c.snaps21; if (!t) return false;
    return t.offered.every(Boolean) && JSON.stringify(t.hot) === '["fog:toggle","fog:cover-all","fog:rect","fog:area","snap:next"]' && t.h1 === true && t.h2.base === 'cover' && t.h2.ops === 0
      && t.h3.tool === 'fog' && t.h3.shape === 'rect' && t.h4 && t.h5 && t.last;
  })(), JSON.stringify(c.snaps21 && [c.snaps21.offered, c.snaps21.hot, c.snaps21.h1, c.snaps21.h2, c.snaps21.h3, c.snaps21.h4, c.snaps21.h5, c.snaps21.last])],
  // 2.2
  ['fog on and off only shows or hides it (the fog is not sent and drawn again)', (() => { const t = c.v22; return !!t && t.fogOff.same && t.fogOff.on === false && t.fogOn.same && t.fogOn.on === true; })(), JSON.stringify(c.v22 && [c.v22.fogOff, c.v22.fogOn])],
  ['a long fog is folded into one picture after a quiet moment (the newest 30 steps stay), the TV looks the same', (() => {
    const f = c.v22 && c.v22.fold; return !!f && f.ops === 31 && f.first === 'mask' && f.kb > 0 && f.tvOps === 31 && Math.abs(f.tv - f.before) <= 4;
  })(), JSON.stringify(c.v22 && c.v22.fold)],
  ['the hotbar moves by its grip (remembered), messages appear just above it, a double-click puts it back', (() => {
    const t = c.v22 && c.v22.hb; return !!t && t.moved && t.toastBottom <= t.barTop && Math.abs(t.toastMid - t.barMid) <= 3 && t.back.pos === null && !t.back.moved;
  })(), JSON.stringify(c.v22 && c.v22.hb)],
  ['Snapshots folded: the timeline in one line (F1 Pipe normal → F2 Pipe burst, the transition marked); a click there plays it', (() => {
    const t = c.v22 && c.v22.folded; return !!t && t.folded && t.shown && /F1\s*Pipe normal/.test(t.text) && /F2\s*Pipe burst/.test(t.text) && t.bolt && t.w < 900 && t.played === 0;
  })(), JSON.stringify(c.v22 && c.v22.folded)],
  ['before the table sees it, switching away from a changed snapshot asks: Save into it, Don\'t save, Cancel', (() => {
    const t = c.v22 && c.v22.asked; return !!t && t.ask && /Save changes to 'Night 2'/.test(t.ask.title) && t.ask.btns.includes('Don\'t save') && t.ask.btns.includes('Cancel') && t.saved === 0.8 && Math.abs(t.now - 0) < 1e-9 && t.at;
  })(), JSON.stringify(c.v22 && c.v22.asked)],
  ['Ready lists: Ctrl-click several in the library → Ready for this chapter; Tokens shows them first; ✕ takes one off, Clear empties it; Talk too', (() => {
    const t = c.v22; return !!t && /2 picked/.test(t.picks || '') && t.readyN === 2 && /^Ready · /.test(t.tokPop.first || '') && t.tokPop.n === 2 && t.afterX === 1 && t.afterClear === 0
      && /^Ready · /.test((t.talkPop.groups || [])[0] || '') && t.talkPop.ready === 1 && t.talkPop.more;
  })(), JSON.stringify(c.v22 && [c.v22.picks, c.v22.readyN, c.v22.tokPop, c.v22.afterX, c.v22.afterClear, c.v22.talkPop])],
  // 2.3
  ['snapshot with another picture: its place, size, grid and where the map lay come back (on the TV too); the same picture keeps the map where it is', (() => {
    const t = c.v23 && c.v23.snapFix; if (!t || !t.toA || !t.toB) return false;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    return t.toA.pic === 'A' && near(t.toA.x, 0.3) && near(t.toA.y, 0.2) && near(t.toA.view.x, 0.5) && near(t.toA.view.zoom, 1.1) && near(t.toA.grid.size, 1.05) && near(t.toA.grid.ox, 0.2)
      && !!t.tvA && near(t.tvA.zoom, 1.1) && !!t.tvA.bg && near(t.tvA.bg.x, 0.3) && near(t.tvA.grid.size, 1.05)
      && t.toB.pic === 'B' && near(t.toB.x, -2) && near(t.toB.scale / t.toA.scale, 1.3) && near(t.toB.view.zoom, 0.8) && near(t.toB.grid.size, 1.3) && !!t.tvB && near(t.tvB.zoom, 0.8)
      && near(t.sameKeeps.zoom, 0.9) && near(t.sameKeeps.x, -0.5) && t.restored;
  })(), JSON.stringify(c.v23 && c.v23.snapFix)],
  ['animated assets are baked once in the background while the little maid runs ("Preparing animations 1 / 1", then "All animations ready ✓")', (() => {
    const t = c.v23; return !!t && !!t.during && /Preparing animations \d+ \/ \d+/.test(t.during.text) && /maid-run/.test(t.during.maid) && !!t.after && t.after.done && /All animations ready/.test(t.after.text) && /maid\.webp/.test(t.after.maid)
      && t.cacheFiles >= 4 && t.stats.baked >= 2 && t.stats.failed === 0;
  })(), JSON.stringify(c.v23 && [c.v23.during, c.v23.after, c.v23.cacheFiles, c.v23.stats])],
  ['the TV draws baked animations from frames (no videos), shadows worked out once (no browser shadow), off the table they rest; the GM screen draws them lighter', (() => {
    const t = c.v23; if (!t || !t.tv1 || !t.tv2 || !t.gmA) return false;
    return t.tv2.animated === 4 && t.tv2.baked === 4 && t.tv2.videos === 0 && t.tv2.off >= 1 && t.tv2.shadows === 1 && t.tv2.cssShadow === 0 && t.tv2.running && t.tv2.draws > t.tv1.draws
      && t.gmA.baked === 4 && t.gmA.videos === 0 && t.gmA.mode === 'light';
  })(), JSON.stringify(c.v23 && [c.v23.early, c.v23.tv1, c.v23.tv2, c.v23.gmA])],
  ['a bigger asset gets a sharper sheet; Still on the GM screen; Table → Performance shows the cache and Clear bakes again what the maps use', (() => {
    const t = c.v23; return !!t && (t.tiers || []).some((x) => x >= 384) && t.still.mode === 'still' && !t.still.running && /prepared animation/.test(t.perf.line || '')
      && t.perf.labels.includes('Animated assets') && t.perf.labels.some((l) => /Animated assets on your screen/.test(l)) && t.perf.btns.includes('Clear the cache') && t.perf.btns.includes('Prepare now') && /prepared again right away: about \d+ minute/.test(t.perf.ask || '') && t.cleared === 0 && t.rebaked;
  })(), JSON.stringify(c.v23 && [c.v23.tiers, c.v23.still, c.v23.perf, c.v23.cleared, c.v23.rebaked])],
  // 2.4
  ['long names wrap onto up to three lines (the whole name on hover); Assets and Layers keep their width', (() => {
    const t = c.v24; return !!t && t.assetW.w === 312 && t.assetW.over <= 1 && t.assetW.lines >= 2 && t.assetW.lines <= 3 && !!t.assetW.tip && t.layersW.over <= 1 && t.layersW.lines >= 2 && t.layersW.open;
  })(), JSON.stringify(c.v24 && [c.v24.assetW, c.v24.layersW])],
  ['every panel opens with a token and an asset selected and a Layers row open (Layers used to stay invisible)', (() => { const p = c.v24 && c.v24.panels; return !!p && Object.keys(p).length === 20 && Object.values(p).every(Boolean); })(), JSON.stringify(c.v24 && c.v24.panels)],
  ['bake rules (2.5): the file\'s own speed up to 30 a second at the size the TV needs, in pieces; only very long and big ones get smaller', (() => {
    const p = c.v24 && c.v24.plans; if (!p) return false;
    const at = (d, t) => p.find((x) => x.dur === d && x.tier === t) || {};
    return at(2, 256).fps === 30 && at(2, 256).px === 256 && at(10, 256).fps === 30 && at(10, 256).px === 256 && at(20, 256).fps === 30 && at(20, 256).px === 256 && !at(20, 256).blend
      && at(10, 512).fps === 30 && at(10, 512).px < 512 && at(10, 512).px >= 440 && p.every((x) => x.mp <= 60.05 && x.per <= 64 && x.pieces >= 1) && at(20, 256).pieces > 10
      && c.v24.plan24.fps === 24 && c.v24.plan24.n === 48 && !c.v24.plan24.blend && !!c.v24.orbTv && c.v24.orbTv.baked === 1;
  })(), JSON.stringify(c.v24 && [c.v24.plans, c.v24.plan24, c.v24.orbTv])],
  ['benchmark: measures the map on the TV (frames, worst 1 %, stutters, processor, memory) and keeps it; Videos vs baked plays the animations as videos, then baked again', (() => {
    const t = c.v24; if (!t || !t.st1 || !t.st2) return false;
    const r = t.results || [];
    const one = r.find((x) => x.label === 'normal'); const v = r.find((x) => x.label === 'videos'); const b = r.find((x) => x.label === 'baked');
    return t.st1.ok && t.busy1 && t.st2.ok && !!one && !!one.tv && one.tv.fps > 0 && !!one.gm && one.cpu.all != null && one.mem.all > 0 && !!one.anim && one.anim.animated === 1
      && !!v && !!b && v.pair && b.pair && !!v.anim && v.anim.videos === 1 && v.anim.baked === 0 && !!b.anim && b.anim.baked === 1
      && t.asVideos.videos === 1 && t.asVideos.baked === 0 && t.backBaked.baked === 1 && t.backBaked.videos === 0
      && t.benchUi.cards >= 2 && t.benchUi.pair && t.benchUi.btns.includes('Run benchmark') && t.benchUi.btns.includes('Videos vs prepared') && t.benchUi.btns.includes('Graphics card vs processor') && t.logBench >= 3 && t.logBaked >= 1;
  })(), JSON.stringify(c.v24 && [c.v24.st1, c.v24.st2, c.v24.results, c.v24.asVideos, c.v24.backBaked, c.v24.benchUi, c.v24.logBench, c.v24.logBaked])],
  ['deleting a campaign asks first, with the worried maid (Keep it is the default); Recently deleted brings it back or deletes it for good', (() => {
    const t = c.v24del; return !!t && !!t.ask && t.ask.title === 'Delete Test campaign?' && t.ask.maid && /chapter/.test(t.ask.text) && t.ask.btns.includes('Keep it') && t.ask.btns.includes('Delete') && t.ask.focus === 'Keep it'
      && t.kept && t.gone && /Recently deleted \(1\)/.test(t.link || '') && t.rowsD.length === 1 && /Test campaign/.test(t.rowsD[0]) && t.back && /Sure\?/.test(t.sure || '') && t.purged.list === 0 && t.purged.rows === 0;
  })(), JSON.stringify(c.v24del)],
  // 2.5
  ['the maid\'s pill sits at the top centre; on an almost full disk baking waits and says why, and goes on once there is room', (() => {
    const t = c.v25; return !!t && !!t.paused && /Preparing paused: the disk is almost full \(100 MB free\)/.test(t.paused.text) && t.paused.top <= 30 && Math.abs(t.paused.mid - t.paused.win / 2) <= 2
      && t.perfDisk.low && t.perfDisk.paused && t.streamTv.info.baked >= 1;
  })(), JSON.stringify(c.v25 && [c.v25.paused, c.v25.perfDisk])],
  ['a long animation is drawn from a few pieces at a time (streamed), at its full speed; frames can be drawn by the processor', (() => {
    const t = c.v25; if (!t) return false; const e = (t.streamTv.cache || []).find((x) => /stream/.test(x.path));
    return !!e && !e.whole && e.pieces >= 2 && e.fps === 24 && t.streamTv.info.streamed >= 1 && t.streamTv.info.draws > 0 && t.cpu.mode === 'gpu' && t.cpu.more > 0 && t.cpu.cpuDefault.setting === 'cpu' && t.cpu.cpuDefault.mode === 'cpu';
  })(), JSON.stringify(c.v25 && [c.v25.streamTv, c.v25.cpu])],
  // Beta 1
  ['a memory ceiling for kept animation frames: from the computer\'s memory; squeezed, the pieces shown longest ago go and animations stream, and drawing goes on', (() => {
    const m = c.v25 && c.v25.mem; if (!m) return false;
    return m.before.budget >= 48e6 && m.before.budget <= 403e6 && m.before.used > 0 && m.before.whole === true && m.before.kept >= 2 && m.after.reclaimed >= 1 && m.after.demotions >= 1 && m.after.demoted === true && m.after.draws > 0;
  })(), JSON.stringify(c.v25 && c.v25.mem)],
  ['the benchmark measures the animations themselves (how much of their own speed they showed, the slowest, the longest stand-still)', (() => {
    const b = c.v25 && c.v25.bench; const m = b && b.motion && b.motion.tv;
    return !!m && m.count >= 1 && m.ratio > 0 && m.ratio <= 100 && !!m.slowest && m.slowest.want > 0 && !!m.still && m.still.ms >= 0 && b.animDraw === 'gpu' && !!b.gmAnim;
  })(), JSON.stringify(c.v25 && c.v25.bench)],
  ['a lasting moment a snapshot brought (poison gas) ends when the next snapshot comes; one started by hand stays', (() => { const t = c.v25; return !!t && t.gasOn === 1 && t.gasAfter === 0 && t.gasOwn === 1; })(), JSON.stringify(c.v25 && [c.v25.gasOn, c.v25.gasAfter, c.v25.gasOwn])],
  ['placing an asset shows it half see-through under the mouse, true size (2 squares), an animated one playing', (() => {
    const g = c.beta1 && c.beta1.ghost; const v = c.beta1 && c.beta1.ghostV;
    return !!g && g.tag === 'IMG' && Math.abs(g.dx) <= 2 && Math.abs(g.dy) <= 2 && Math.abs(g.cells - 2) <= 0.1 && g.opacity === 0.5 && /tree\.png/.test(g.src) && !!v && v.tag === 'VIDEO' && !v.paused && v.t > 0;
  })(), JSON.stringify(c.beta1 && [c.beta1.ghost, c.beta1.ghostV])],
  ['a token dragged from the library shows on its square, one cell big, instead of the browser\'s drag picture; the drop places it and the preview goes', (() => {
    const d = c.beta1 && c.beta1.drag; if (!d) return false;
    return d.shown && d.token && Math.abs(d.w - d.cellPx) <= 1 && Math.abs(d.dx) <= 2 && Math.abs(d.dy) <= 2 && d.pic && d.picHidden && d.tokensAdded === 1 && !d.picAfter && !d.ghostAfter;
  })(), JSON.stringify(c.beta1 && c.beta1.drag)],
  ['a table window that stops is loaded again by itself with the map on it, logged, and said on the GM screen', (() => {
    const k = c.beta1 && c.beta1.crash; return !!k && k.reloaded && k.restarts === 1 && k.logged && /table window (it )?crashed and was loaded again|table window .* loaded again/.test(k.toast);
  })(), JSON.stringify(c.beta1 && c.beta1.crash)],
  ['"Graphics card vs processor" measures both and keeps the better one (a pair on the Performance tab)', (() => {
    const b = c.beta1 && c.beta1.benchDraw; return !!b && b.started && b.labels.join() === 'gpu,cpu' && b.pair && ['gpu', 'cpu'].includes(b.picked) && /draws the animations from now on/.test(b.toast) && Array.isArray(b.card) && b.card.join() === 'Graphics card,Processor';
  })(), JSON.stringify(c.beta1 && c.beta1.benchDraw)],
  ['a damaged map file is shown as such and never written over; Start it over writes it again', (() => {
    const m = c.beta1 && c.beta1.brokenMap; return !!m && m.flagged && /its file is damaged/.test(m.card) && m.untouched && m.reset;
  })(), JSON.stringify(c.beta1 && c.beta1.brokenMap)],
  ['a damaged campaign file shows on the start screen with its earlier versions; restoring one brings it back', (() => {
    const b = c.beta1 && c.beta1.brokenCamp; return !!b && /damaged/.test(b.tile) && b.listed.length === 1 && b.listed[0][0] === 'Half written' && b.listed[0][1] === 1 && b.rows === 1 && b.after.length === 1 && b.after[0] === false;
  })(), JSON.stringify(c.beta1 && c.beta1.brokenCamp)],
  ['a save that fails is said on the GM screen', !!(c.beta1 && /Saving the campaign failed/.test(c.beta1.saveFail.toast)), JSON.stringify(c.beta1 && c.beta1.saveFail)],
  // Beta 2
  ['new painted areas show on the TV: ice, burning ground, webs, glowing ground, grass in the wind, oil; oil can be set alight from its card', (() => {
    const b = c.beta2; if (!b) return false;
    return ['ice', 'burning', 'web', 'glow', 'grass', 'oil'].every((k) => b.areas[k] && b.areas[k].max > 30 && b.areas[k].mean > 6) && b.alight === 'burning';
  })(), JSON.stringify(c.beta2 && [c.beta2.areas, c.beta2.alight])],
  ['new placed effects show on the TV: rune circle, portal, light shaft, crackling arcs, vent, falling water', (() => {
    const b = c.beta2; return !!b && ['runes', 'portal', 'shaft', 'arcs', 'vent', 'falls'].every((k) => b.emit[k] && b.emit[k].max > 25);
  })(), JSON.stringify(c.beta2 && c.beta2.emit)],
  ['in the dark: a bullseye lantern lights a cone the way it faces, a light shaft its beam, a rune circle glows; pulse breathes, sputter gutters', (() => {
    const d = c.beta2 && c.beta2.dark; if (!d) return false;
    return d.front < d.behind - 80 && d.front < d.side - 60 && d.beam < d.beside - 40 && d.runes < d.far - 30 && d.wave.pulse.some((v) => v < 0.7) && d.wave.pulse.some((v) => v > 0.9) && d.wave.lo < 0.35 && d.wave.hi > 0.9;
  })(), JSON.stringify(c.beta2 && c.beta2.dark)],
  ['Lights out: every light dies (the cone goes dark), they catch again when it is stopped', (() => {
    const o = c.beta2 && c.beta2.out; const d = c.beta2 && c.beta2.dark; if (!o || !d) return false;
    return o.stats >= 2 && o.front > d.front + 80 && o.back < d.front + 25 && o.statsAfter == null;
  })(), JSON.stringify(c.beta2 && c.beta2.out)],
  ['new weather: underwater light, bubbles, wind, heat shimmer; mixes Underwater, Desert heat, Gale', (() => {
    const w = c.beta2 && c.beta2.wx; return !!w && w.caustics > 0.5 && w.haze > 0.5 && w.bubbles > 0.001 && w.wind > 0.001 && w.mixes.length === 3;
  })(), JSON.stringify(c.beta2 && c.beta2.wx)],
  ['new moments play on the TV: teleport, smoke puff, rockfall, flood (with their own sounds)', (() => {
    const m = c.beta2 && c.beta2.mo; return !!m && ['teleport', 'puff', 'rockfall', 'flood'].every((k) => m[k] && m[k].drawn.includes(k) && m[k].cover > 0.0005) && m.flood.cover > 0.3 && m.sounds;
  })(), JSON.stringify(c.beta2 && c.beta2.mo)],
  ['new spell looks water, earth, swarm; new presets; Insect Plague is a swarm', (() => {
    const p = c.beta2 && c.beta2.sp; return !!p && ['water', 'earth', 'swarm'].every((k) => p[k] && p[k].max > 40) && p.presets === 7 && p.plague === 'swarm';
  })(), JSON.stringify(c.beta2 && c.beta2.sp)],
  ['library folders created', ['Maps', 'Tokens', 'Effects', 'Audio', 'Packs', 'Campaigns', 'Portraits', 'Handouts', 'Tables'].every((f) => (c.libraryFolders || []).includes(f))],
  ['4.3: the hotbar in four shapes (right-click the bar, or Options → This screen): 10 × 1, 5 × 2, 2 × 5 at the side, 1 × 10', (() => {
    const b = c.beta43 || {}; const s = b.shapes || {};
    return ['5 × 2', '2 × 5', '1 × 10 (a column)', '10 × 1 (a row)'].every((w) => (b.menu || []).some((m) => m.includes(w)))
      && b.fromMenu?.shape === '5x2' && b.fromMenu.cols === 5 && !b.fromMenu.vertical
      && s['2x5']?.cols === 2 && s['2x5'].vertical && s['2x5'].h > s['2x5'].w && s['2x5'].inside
      && s['1x10']?.cols === 1 && s['1x10'].vertical && s['1x10'].h > s['1x10'].w * 4 && s['1x10'].inside
      && s['10x1']?.cols === 10 && !s['10x1'].vertical && s['10x1'].w > s['10x1'].h * 4
      && b.fromOptions?.shape === '1x10' && (b.fromOptions.on || []).includes('1 × 10');
  })(), JSON.stringify(c.beta43 && [c.beta43.menu, c.beta43.fromMenu, c.beta43.shapes, c.beta43.fromOptions])],
  ['4.3: Fog keeps its tips behind a "?" (hover shows them, a click keeps them, they go away after); no long text in the panel', (() => {
    const b = c.beta43 || {};
    return b.tipShown?.items === 6 && b.tipShown.title === 'Fog of war' && b.tipShown.visible && b.tipClick === true && b.tipGone === true && !/outlined only for you|Shift \+ click marks/.test(b.fogBody || '');
  })(), JSON.stringify(c.beta43 && [c.beta43.tipShown, c.beta43.tipClick, c.beta43.tipGone])],
  ['4.3: a spell look\'s sound picked from Options → Sound: the library opens for it, then Options comes back with the row lit', (() => {
    const b = c.beta43 || {};
    return b.pickFor && !b.pickFor.options && b.pickFor.drawer && /Cold/.test(b.pickFor.purpose || '') && b.picked?.lit === 'sfx:cold' && b.picked.back === 'Sound' && /Cave drone/.test(b.picked.file || '') && b.picked.saved;
  })(), JSON.stringify(c.beta43 && [c.beta43.pickFor, c.beta43.picked])],
  ['4.3.1: every map tool, every Toolbox panel and Options has a "?" with its tips; no long explanations left in the panels', (() => {
    const b = c.beta431 || {}; const P = Object.values(b.popTips || {}); const Q = Object.values(b.panelTips || {});
    return P.length === 22 && P.every((x) => x.q && !x.long.length) && Q.length === 11 && Q.every((x) => x.q && !x.long.length);
  })(), JSON.stringify(c.beta431 && [c.beta431.popTips, c.beta431.panelTips])],
  ['4.3.1: Initiative stays in the Toolbox (no Pin to the rail), other panels can still be pinned', (() => {
    const m = (c.beta431 || {}).pinMenus || {}; return !!m.init && !m.init.some((x) => /rail/.test(x)) && m.init.some((x) => /hotbar/i.test(x)) && (m.sound || []).includes('Pin to the rail');
  })(), JSON.stringify(c.beta431 && c.beta431.pinMenus)],
  ['4.3.1: Talk: the tick in List … puts a portrait on the Ready list, the size goes from 10 to 70 %', (() => {
    const t = (c.beta431 || {}).talk431 || {}; return !!t.added && t.ready === 1 && JSON.stringify(t.size) === '[0.1,0.7]' && /List/.test(t.empty || '');
  })(), JSON.stringify(c.beta431 && c.beta431.talk431)],
  ['4.3.1: a message beside a hotbar at the right edge stays inside the window', (() => { const t = (c.beta431 || {}).toastBox; return !!t && t.l >= 0 && t.r <= t.w; })(), JSON.stringify(c.beta431 && c.beta431.toastBox)],
  ['4.3.1: Options → This screen: the size of everything as a slider (70 to 130 %)', JSON.stringify(c.beta431 && c.beta431.sizeSlider) === '[0.7,1.3]', JSON.stringify(c.beta431 && c.beta431.sizeSlider)],
  ['4.3.1: removing a player asks first; Keep keeps them, Remove removes them', (() => {
    const b = c.beta431 || {}; return b.ask && b.ask.title === 'Remove Six?' && b.ask.btns.includes('Keep') && b.kept === true && b.removed === true;
  })(), JSON.stringify(c.beta431 && [c.beta431.ask, c.beta431.kept, c.beta431.removed])],
  ['4.4: an Open Spotify button next to the player', c.spotifyLink?.linkedPanel?.openBtn === true],
  ['4.4: a new effect is sized by the grid square (a fine grid gets a small torch, like its assets); the light shaft has Dust size from 0.1× to 10×', (() => {
    const f = (c.beta44 || {}).fx44 || {}; return Math.abs((f.torchR || 0) - 0.3) < 1e-3 && JSON.stringify(f.dust) === '[0.1,10]' && f.shaftDust === 6;
  })(), JSON.stringify(c.beta44 && c.beta44.fx44)],
  ['4.4: a map moved at the table slides on the TV (only its place goes there), then one full picture that looks the same; one undo step', (() => {
    const m = (c.beta44 || {}).moved || {}; return m.liveMoves >= 5 && m.during.gmLive && !m.after.gmLive && !m.after.tvLive && m.dx > 0 && m.undoSteps === 1 && m.diff < 1.5;
  })(), JSON.stringify(c.beta44 && c.beta44.moved)],
  ['4.4: a new map arrives under smoke, parchment or embers; afterwards the new map is on the table and the cover is gone', (() => {
    const L = (c.beta44 || {}).looks || {}; return ['smoke', 'parchment', 'embers'].every((k) => L[k] && L[k].mid && /on/.test(L[k].mid.on) && L[k].end && L[k].end.kind === k && L[k].end.phase === 'idle' && L[k].hidden === 'none');
  })(), JSON.stringify(c.beta44 && c.beta44.looks)],
  ['4.4: Talk in smoke, on a parchment banner (4.5.1: without a name) and in firelight', (() => {
    const T = (c.beta44 || {}).talks || {}; return ['smoke', 'parchment', 'embers'].every((k) => T[k] && T[k].band && T[k].cls.includes(`look-${k}`) && T[k].npcs >= 1) && !!T.parchment && !T.parchment.name;
  })(), JSON.stringify(c.beta44 && c.beta44.talks)],
  ['4.4: Phone & tablet: no summary of the decks any more (Arrange the deck shows them)', (c.beta44 || {}).deckSum === false],
  ['4.5: painted effects are drawn in grid squares (the canvas scaled by the square, their lights too)', (() => {
    const p = (c.beta45 || {}).paint || {}; return JSON.stringify(p.scaled) === '[0.25,0.25]' && p.one === null && !!p.light && p.light[0] === 1 && p.light[1] < 0.7;
  })(), JSON.stringify(c.beta45 && c.beta45.paint)],
  ['4.5: a map drag held still stays a drag until the button is let go', (() => { const h = (c.beta45 || {}).held || {}; return h.tvLive === true && h.gmLive === true && h.after === false; })(), JSON.stringify(c.beta45 && c.beta45.held)],
  ['4.5: Map colours: Grim reaches the TV, holding "original" shows the map without it, Natural takes it away', (() => {
    const L = (c.beta45 || {}).look || {}; return L.stored && L.stored.preset === 'grim' && /url/.test(L.tv || '') && L.peek === 'none' && /url/.test(L.after || '') && L.natural && L.natural[0] === null && L.natural[1] === 'none' && L.chips === 'natural,vivid,muted,grim,sepia,cold';
  })(), JSON.stringify(c.beta45 && c.beta45.look)],
  ['4.5: a snapshot keeps the map\'s colours', (c.beta45 || {}).snapLook === 'sepia', JSON.stringify(c.beta45 && c.beta45.snapLook)],
  ['4.5: the rail: Build (Map, Grid, Effects, Assets, Walls, Layers, Sound, Map notes), the Toolbox alone, then Play; Snapshots in the Toolbox', (() => {
    const r = (c.beta45 || {}).rail || {}; return JSON.stringify(r.groups) === '["build","extra","play","end"]' && r.build.join() === 'map,grid,fx,asset,walls,layers,sound,notes' && r.extra.join() === 'toolbox' && !r.play.includes('toolbox') && r.mapLabel === 'Map' && c.beta45.snapTile === 'Atmosphere' && c.beta45.snapOpen === true;
  })(), JSON.stringify(c.beta45 && [c.beta45.rail, c.beta45.snapTile, c.beta45.snapOpen])],
  ['4.5: Options → Looks: both looks with Try on the TV (Talk tries the band, the map the ink, nothing changes); Talk\'s panel has no Look any more', (() => {
    const o = (c.beta45 || {}).opt || {}; return o.tries === 4 && /look-parchment/.test(o.talkTry || '') && /leaving/.test(o.talkAfter || '') && o.inkTry && o.inkTry.phase !== 'idle' && o.inkTry.splats >= 6 && o.inkTry.sats >= 20 && o.inkEnd === 'idle' && c.beta45.talkPopLook === false;
  })(), JSON.stringify(c.beta45 && [c.beta45.opt, c.beta45.talkPopLook])],
  ['4.5: the parchment Talk banner rolls down onto its rod when they leave', JSON.stringify((c.beta45 || {}).parchOut) === '["tb-roll-down","tb-rod-down"]', JSON.stringify(c.beta45 && c.beta45.parchOut)],
  ['4.5: Room lights −20 % / +20 % (never below 10 %); + while they are off: on again at 20 %', (() => {
    const l = (c.beta45 || {}).lights || {}; return JSON.stringify(l.steps) === '[0.8,0.6,0.4,0.2,0.1,0.3]' && l.back && l.back[0] === 0.2 && l.back[1] === 'room' && l.back[2] === true;
  })(), JSON.stringify(c.beta45 && c.beta45.lights)],
  ['4.7: Tokens and Talk: List … opens every token or portrait; a click picks one up, the tick gets it ready', Array.isArray(c.tokenList) && c.tokenList.includes('Goblin') && Array.isArray(c.talkReady) && ['Hooded stranger', 'Captain of the guard', 'Old sage'].every((n) => c.talkReady.some((x) => String(x).startsWith(n))), JSON.stringify([c.tokenList && c.tokenList.length, c.talkReady])],
  ['4.9: Window light: six windows and six kinds of bars, a picture for each; the light shaft and the window light a dark map with a soft picture of their light', (() => {
    const b = c.beta49 || {}; return JSON.stringify(b.kinds) === '[6,6,"data:image/png"]' && b.masks && b.masks.win === true && b.masks.reach === 4.5;
  })(), JSON.stringify(c.beta49 && [c.beta49.kinds, c.beta49.masks])],
  ['4.9: in the dark the window\'s panes are lit, the shadows of its bars and the floor beside it stay darker; it keeps its window, bars and length', (() => {
    const d = (c.beta49 || {}).dark || {}; return d.pane + 25 < d.bar && d.bar + 25 < d.off && JSON.stringify(d.stored) === '{"shape":"square","grid":"cross","stretch":1}';
  })(), JSON.stringify(c.beta49 && c.beta49.dark && [c.beta49.dark.pane, c.beta49.dark.bar, c.beta49.dark.off, c.beta49.dark.stored])],
  ['4.9: the light shaft\'s side fades into the dark without steps', (() => {
    const a = ((c.beta49 || {}).dark || {}).side || []; if (a.length < 17) return false;
    const range = a[a.length - 1] - a[0]; let up = true; let jump = 0;
    for (let i = 1; i < a.length; i++) { if (a[i] < a[i - 1] - 4) up = false; jump = Math.max(jump, a[i] - a[i - 1]); }
    return range > 60 && up && jump < range * 0.4; // (a clipped shape's step would jump half the way at once)
  })(), JSON.stringify(c.beta49 && c.beta49.dark && c.beta49.dark.side)],
  ['4.9: the window light\'s options show its six windows and six kinds of bars as pictures', ((c.beta49 || {}).picks || []).length === 12, JSON.stringify(c.beta49 && c.beta49.picks)],
  ['4.9: the TV preview: nothing new while nothing happens; a change brings one at once and another when it has settled', (() => {
    const b = c.beta49 || {}; return b.idle8 <= 1 && Array.isArray(b.change) && b.change.length >= 2 && b.change[0] < 1500 && b.change[b.change.length - 1] > 1200;
  })(), JSON.stringify(c.beta49 && [c.beta49.idle8, c.beta49.change])],
  ['4.10: a Medium token\'s picture is 130 % of its square on both screens; the size in Options (150 %) and its own size (× 1.2) change it', (() => {
    const p = (c.beta410 || {}).pic || {}; return p.gm === 1.3 && p.tv === 1.3 && p.medium15 && p.medium15.gm === 1.5 && p.medium15.tv === 1.5 && p.own && Math.abs(p.own.gm - 1.8) < 0.02 && p.own.stored === 1.2;
  })(), JSON.stringify(c.beta410 && c.beta410.pic)],
  ['4.10: a selected token: a ring about 2 pixels thin at any zoom, the compact toolbar (see-through, "M")', (() => {
    const t = (c.beta410 || {}).sel || {}; return t.selected && t.ring && t.ringScreenPx >= 1.5 && t.ringScreenPx <= 2.6 && /compact/.test(t.card || '') && t.size === 'M' && Number((c.beta410 || {}).resting) < 0.9;
  })(), JSON.stringify(c.beta410 && [c.beta410.sel, c.beta410.resting, c.beta410.why])],
  ['4.10: the toolbar docked above the hotbar, the ring as a soft glow; its size menu sizes its picture', (() => {
    const d = (c.beta410 || {}).docked || {}; const m = (c.beta410 || {}).menu || [];
    return /docked/.test(d.cls || '') && d.above !== false && d.glow === true && m.some((x) => /^Bigger/.test(x)) && m.some((x) => /^Smaller/.test(x)) && m.some((x) => /Options/.test(x));
  })(), JSON.stringify(c.beta410 && [c.beta410.docked, c.beta410.menu])],
  ['4.10: on the TV: numbers off, no turn glow, a shadow under tokens, name tags twice as big', (() => {
    const t = (c.beta410 || {}).tv || {}; const k = parseFloat(t.tag) / parseFloat(t.tag1);
    return t.badges === 0 && t.noGlow === true && t.shadow === true && Math.abs(k - 2) < 0.05;
  })(), JSON.stringify(c.beta410 && c.beta410.tv)],
  ['4.10: snapping off: a new token lands where it is clicked', (c.beta410 || {}).free != null && c.beta410.free < 0.02, JSON.stringify(c.beta410 && c.beta410.free)],
  ['4.10: Options → Tokens; the Tokens panel keeps only Size and Place hidden of the defaults', (() => {
    const o = (c.beta410 || {}).options || []; const p = (c.beta410 || {}).tokPanel || [];
    return ['Tiny', 'Small and Medium', 'Gargantuan', 'Number copies (Goblin 1, 2, 3)', 'Toolbar of a selected token', 'Selection ring', 'Name tags', 'Shadow under tokens', 'Snap to the grid (Alt does the other)'].every((x) => o.includes(x))
      && p.includes('Size') && !p.some((x) => /Number copies|Name tag of new/.test(x));
  })(), JSON.stringify(c.beta410 && [c.beta410.options, c.beta410.tokPanel])],
  ['4.11: library: a category shows its folders as cards and its own files; the tree under it; no word tags', (() => {
    const r = (c.beta411 || {}).root || {}; return JSON.stringify(r.crumbs) === '["Tokens"]' && JSON.stringify(r.cards) === '["Crew","Oterians"]' && ['Goblin', 'Hero', 'Ogre'].every((n) => (r.tiles || []).includes(n)) && JSON.stringify(r.tree) === '["Crew","Oterians"]' && r.tags === 0;
  })(), JSON.stringify(c.beta411 && c.beta411.root)],
  ['4.11: library: into a folder by its card or the tree (the path and the tree follow); inside, names without the folder\'s name', (() => {
    const b = c.beta411 || {}; const o = b.oterians || {}; const f = b.chaplain || {};
    return JSON.stringify(o.crumbs) === '["Tokens","Oterians"]' && JSON.stringify(o.cards) === '["Oterians/Fleet Chaplain","Oterians/Marines"]' && (o.tiles || []).includes('Oterian_Captain') && (o.tree || []).includes('Oterians*')
      && JSON.stringify(f.crumbs) === '["Tokens","Oterians","Fleet Chaplain"]' && JSON.stringify(f.tiles) === '["1","2","3"]' && (f.tree || []).includes('Oterians/Fleet Chaplain*');
  })(), JSON.stringify(c.beta411 && [c.beta411.oterians, c.beta411.chaplain])],
  ['4.11: library: a search finds folder names, under a heading with the folder; a click on it opens it; each category reopens where it was left', (() => {
    const b = c.beta411 || {}; return (b.search && b.search.groups || []).some((g) => /^Crew › Archivist-Surveyor/.test(g)) && JSON.stringify(b.went && b.went.crumbs) === '["Tokens","Crew","Archivist-Surveyor"]' && b.went.query === ''
      && JSON.stringify(b.remembered) === '["Tokens","Crew","Archivist-Surveyor"]';
  })(), JSON.stringify(c.beta411 && [c.beta411.search, c.beta411.went, c.beta411.remembered])],
  ['4.11: a spell sound is picked in the SFX folder', c.sfxFolder === 'SFX', JSON.stringify(c.sfxFolder)],
  ['4.11: the Tokens List window: the path, the folders in it as chips, short names inside a folder, a search shows each one\'s folder', (() => {
    const L = (c.beta411 || {}).list || {}; const r = L.root || {}; const f = L.chaplain || {}; const q = L.search || {};
    return JSON.stringify(r.crumbs) === '["Tokens"]' && (r.folders || []).some((x) => /^Crew/.test(x)) && (r.folders || []).some((x) => /^Oterians/.test(x))
      && JSON.stringify(f.crumbs) === '["Tokens","Oterians","Fleet Chaplain"]' && JSON.stringify(f.names) === '["1","2","3"]'
      && JSON.stringify(q.names) === '["Marine_1","Marine_2","Marine_3"]' && (q.wheres || []).every((w) => w === 'Oterians › Marines');
  })(), JSON.stringify(c.beta411 && c.beta411.list)],
  // ---- Prototype 3: the players' phones ----
  ['phones: the section ran to its end', c.phones && !c.phones.err, c.phones && c.phones.err],
  ['phones: a player\'s and a DM\'s code pair as such; a player\'s state has no map name, the DM\'s no controller', (() => { const p = (c.phones || {}).paired || {}; return p.a === 'player' && p.b === 'player' && p.d === 'dm' && p.ctlOff === false && p.noScene === true && p.dmHasNoCtl === true; })(), JSON.stringify((c.phones || {}).paired)],
  ['phones: switched off, a phone can pick nothing and no eye appears; a player\'s phone is refused the DM\'s buttons', (() => { const p = (c.phones || {}); return p.off && p.off.pick === false && p.off.why === 'off' && p.off.eyes === 0 && p.playerAsDm === 403; })(), JSON.stringify([(c.phones || {}).off, (c.phones || {}).playerAsDm])],
  ['phones: picking a character gives its token an eye with the card\'s darkvision; a second phone cannot take it, nor someone outside the party', (() => { const p = (c.phones || {}).pick || {}; return p.ok === true && p.eye === true && p.dv === 60 && /already on Phone A/.test(p.second || '') && p.notInParty === false; })(), JSON.stringify((c.phones || {}).pick)],
  ['phones: the stick pushed shows the aim on the TV, let go it is gone', (() => { const p = (c.phones || {}).aim || {}; return /sv-aim ok/.test(p.on || '') && p.off === 0; })(), JSON.stringify((c.phones || {}).aim)],
  ['phones: a step moves the token one square, and it slides there on the TV', (() => { const p = (c.phones || {}).step || {}; return p.ok === true && JSON.stringify(p.at) === '[1,0]' && p.sliding && p.sliding.cls === true && p.sliding.anims >= 1; })(), JSON.stringify((c.phones || {}).step)],
  ['phones: a wall stops a step; so does a party member (named) and a DM\'s token (not named)', (() => { const p = c.phones || {}; const w = p.wall || {}; const b = p.bump || {}; const o = p.ogre || {};
    return w.first === true && w.second === false && /wall/i.test(w.error || '') && JSON.stringify(w.at) === '[1,-1]' && b.ok === false && /Thorin is standing there/.test(b.error || '') && JSON.stringify(b.at) === '[2,0]' && o.ok === false && /Someone is in the way/.test(o.error || '') && !/Ogre/.test(o.error || '') && JSON.stringify(o.at) === '[-1,0]'; })(), JSON.stringify([(c.phones || {}).wall, (c.phones || {}).bump, (c.phones || {}).ogre])],
  ['phones: the Ping button pings the token\'s square on the TV and the GM\'s map; doors and turning are not for phones (refused, the door stays shut)', (() => { const p = (c.phones || {}).point || {}; return p.ok === true && p.tv >= 1 && p.gm >= 1 && p.door === 403 && p.turn === 403 && p.closed === true; })(), JSON.stringify((c.phones || {}).point)],
  ['phones: paused by the DM: no step', (() => { const p = (c.phones || {}).paused || {}; return p.move === false && /Paused/.test(p.error || ''); })(), JSON.stringify((c.phones || {}).paused)],
  ['phones: a turn order that is not shown on the TV blocks the phones all the same, and gives no name away', (() => { const p = (c.phones || {}).hiddenOrder || {}; const f = (c.phones || {}).foeTurn || {}; return p.ok === false && p.tv === false && !!f.foe && !(p.error || '').includes(f.foe) && p.who !== f.foe; })(), JSON.stringify((c.phones || {}).hiddenOrder)],
  ['phones: in a fight nobody moves out of turn; a foe the players have not met is not named on the phone', (() => { const p = c.phones || {}; const f = p.foeTurn || {}; const t = p.thorinTurn || {};
    return f.ok === false && !!f.foe && !(f.error || '').includes(f.foe) && f.who !== f.foe && t.ok === false && /Thorin/.test(t.error || '') && t.who === 'Thorin'; })(), JSON.stringify([(c.phones || {}).foeTurn, (c.phones || {}).thorinTurn])],
  ['phones: your turn: 30 ft, every second diagonal step 10 ft (5-10-5), then no more; Dash once gives 30 more; the same character on another phone is not handed over', (() => { const p = (c.phones || {}).myTurn || {}; return p.mine === true && JSON.stringify(p.walk) === '[true,true,true,true,true,false]' && p.leftSpent === 0 && p.dash === true && p.dash2 === false && p.afterDash === true && p.otherPhone === false; })(), JSON.stringify((c.phones || {}).myTurn)],
  ['phones: the squares walked this turn leave a trace on the GM\'s map and the TV, with the feet at the token (a square walked twice has one dot, none under the token); gone when the turn is over', (() => { const t = (c.phones || {}).trace || {}; const g = (t.gm || [])[0] || {};
    return (t.gm || []).length === 1 && g.total === 30 && JSON.stringify(g.ft) === '[0,5,15,20,25,30]' && t.tv && t.tv.dots === 2 && t.tv.total === '30 ft' && t.after === 0; })(), JSON.stringify((c.phones || {}).trace)],
  ['phones: a full device list: a player\'s code makes room with the longest-gone player phone, never a DM\'s device or a connected one; many new devices from one place are refused', (() => { const p = c.phones || {}; const k = p.cap || {}; const f = p.flood || {};
    return k.full === 16 && k.ok === true && k.count === 16 && k.oldDm === true && k.dm === true && k.a === true && k.goneOldest === true && k.kept1 === true && f.refused === 429 && f.made < 9 && f.dm === true; })(), JSON.stringify([(c.phones || {}).cap, (c.phones || {}).flood])],
  ['phones: the join code on the TV (one per side), the glowing edge while a phone finds its seat, the DM\'s panel lists the phones', (() => { const p = c.phones || {}; return p.join && p.join.on === true && p.join.qr === 2 && p.calib && p.calib.on === true && p.calib.off === false && p.panel && p.panel.phones.includes('Phone A') && p.panel.mira === true; })(), JSON.stringify([(c.phones || {}).join, (c.phones || {}).calib, (c.phones || {}).panel])],
  ['the problem report\'s settings carry no key, token or code (room lights, phones); names and addresses stay', (() => { const p = (c.phones || {}).report || {}; return p.read === true && p.leaked === 0 && p.keepsHost === true && p.keepsNames === true; })(), JSON.stringify((c.phones || {}).report)],
  ['4.11.1: the room lights\' picture of the table is drawn by the TV window, close to what it shows; the blurred map is clipped to the screen', (() => {
    const a = c.amb || {}; return a.got === true && a.w === 32 && a.drawn != null && Math.abs(a.drawn - a.captured) < 6 && /^hidden paint/.test(a.clip || '');
  })(), JSON.stringify(c.amb)],
];

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed++; if (detail) console.log(`      ${detail}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Screenshots in ${path.relative(process.cwd(), out) || out}`);
process.exit(failed ? 1 : 0);
