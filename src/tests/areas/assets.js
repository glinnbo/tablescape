// Assets (trees, rocks, furniture): the frame round a picked one, its shape (flat or long), its size and turn
'use strict';

module.exports = (area) => {
  area.title('Assets');
  let own = null;
  area.before(async (K) => { await K.openDemo(); own = await K.newMap('Assets (test)', { tv: true }); K.handle('fog.enabled', { mapId: own, enabled: false }); await K.settle(); });

  const M = (t) => t.store.map(own);
  const A = (t, id) => M(t).layers.find((l) => l.id === id);
  // one asset on a clean map, picked in the Assets tool (to the right of the tool's panel), with its frame on
  const one = async (t, extra = {}) => {
    if (t.state.liveMapId !== own || t.state.editMapId !== own) { t.handle('edit.open', { id: own }); await t.send(own); }
    for (const l of M(t).layers.filter((x) => x.role === 'asset')) t.handle('layer.remove', { mapId: own, id: l.id });
    const k = M(t).grid.size;
    const pic = t.lib('assets').find((x) => x.kind === 'image');
    const r = t.handle('layer.add', { mapId: own, path: pic.path, role: 'asset', x: 20 * k, y: 10 * k, w: 4 * k, ...extra });
    const id = r.selected;
    t.gm().webContents.focus();
    if (await t.tool() !== 'asset') await t.key('S');
    await t.until(async () => (await t.tool()) === 'asset', 3000, 'the Assets tool');
    await t.until(() => t.g(`!!Play.view().assetBox(${JSON.stringify(id)})`), 5000, 'the asset\'s picture');
    await t.g(`Play.view().setSelectedAssets([])`);
    const at = await t.scr(20 * k, 10 * k);
    await t.click(at.x, at.y);
    await t.until(async () => (await t.count('.sv-gizmo .sv-grip')) === 9, 3000, 'the frame round the picked asset');
    return { id, k };
  };
  const grips = (t) => t.g(`Object.fromEntries([...document.querySelectorAll('.sv-gizmo .sv-grip')].map((g) => { const r = g.getBoundingClientRect(); return [g.dataset.grip, { x: r.left + r.width / 2, y: r.top + r.height / 2 }]; }))`);
  const box = (t, id) => t.g(`Play.view().assetBox(${JSON.stringify(id)})`);
  const onTv = (t, id) => t.t(`(() => { const e = document.querySelector('.sv-asset[data-id="${id}"]'); return e ? { w: parseFloat(e.style.width), h: parseFloat(e.style.height) } : null; })()`);
  const pull = async (t, from, dx, dy) => { await t.drag({ x: from.x, y: from.y }, { x: from.x + dx, y: from.y + dy }, 8); await t.sleep(350); };

  area.quick('a picked asset wears a frame: pulling a side makes it long or flat, the other side stays, and the TV shows it (Beta 3.10)', async (t) => {
    const { id } = await one(t);
    const g0 = await grips(t); const b0 = await box(t, id);
    t.eq(Object.keys(g0).sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'turn', 'w'], 'the dots of the frame');
    t.eq(A(t, id).stretch, undefined, 'a fresh asset has its own shape');
    // the right side, pulled out
    await pull(t, g0.e, 90, 0);
    const b1 = await box(t, id); const g1 = await grips(t);
    t.ok(b1.w > b0.w * 1.3, 'it is longer', [b0.w, b1.w]);
    t.near(b1.h, b0.h, 0.02, 'as tall as before');
    const s1 = A(t, id).stretch;
    t.ok(s1 < 0.8, 'the shape is kept with it', s1);
    t.near(g1.w.x, g0.w.x, 2, 'the left side stays where it was'); t.near(g1.e.x, g0.e.x + 90, 3, 'the right side follows the pointer');
    // the bottom side, pulled down
    await pull(t, g1.s, 0, 70);
    const b2 = await box(t, id); const g2 = await grips(t);
    t.near(b2.w, b1.w, 0.01, 'as long as before'); t.ok(b2.h > b1.h * 1.3, 'it is taller', [b1.h, b2.h]);
    t.near(g2.n.y, g1.n.y, 2, 'the top side stays where it was');
    // the TV draws the same shape
    const tv = await t.until(async () => { const e = await onTv(t, id); return e && Math.abs(e.w / e.h - b2.w / b2.h) < 0.02 && e; }, 4000, 'the shape on the TV').catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify([await onTv(t, id), b2])}`); });
    t.ok(tv.w > 0, 'on the TV', tv);
    // one pull is one step back
    t.handle('history.undo', { mapId: own });
    t.near(A(t, id).stretch, s1, 0.001, 'Undo takes the last pull back, not a piece of it');
    t.near(A(t, id).w, b1.w, 0.001, 'and leaves the pull before it');
  });

  area.quick('a corner sizes it and keeps its shape, the knob turns it, and the card leads back to its own shape (Beta 3.10)', async (t) => {
    const { id } = await one(t, { stretch: 0.5 });
    const g0 = await grips(t); const b0 = await box(t, id);
    t.near(b0.h, b0.own * 0.5, 0.01, 'it starts flat: half its own height');
    await pull(t, g0.se, 60, 30);
    const b1 = await box(t, id); const g1 = await grips(t);
    t.ok(b1.w > b0.w * 1.2, 'bigger', [b0.w, b1.w]);
    t.near(b1.h / b1.w, b0.h / b0.w, 0.01, 'the same shape'); t.eq(A(t, id).stretch, 0.5, 'its shape as stored');
    t.near(g1.nw.x, g0.nw.x, 2, 'the opposite corner stays (across)'); t.near(g1.nw.y, g0.nw.y, 2, 'the opposite corner stays (down)');
    // the knob stands above it: dragged to the right of its middle, the asset lies turned a quarter
    const mid = { x: (g1.w.x + g1.e.x) / 2, y: (g1.n.y + g1.s.y) / 2 };
    await t.drag({ x: g1.turn.x, y: g1.turn.y }, { x: mid.x + 120, y: mid.y }, 10); await t.sleep(350);
    t.near(A(t, id).rotation, 90, 2, 'turned by the knob');
    const g2 = await grips(t);
    t.ok(Math.abs(g2.e.x - mid.x) < 4 && g2.e.y > mid.y + 10, 'the frame lies turned with it: its right side is below now', [g2.e, mid]);
    // pulled on that side it grows along its own length, which runs down the screen now
    await pull(t, g2.e, 0, 50);
    t.ok((await box(t, id)).w > b1.w * 1.1, 'a side pulls along the asset\'s own length, however it lies', [b1.w, (await box(t, id)).w]);
    // back to its own shape
    const ok = await t.g(`(() => { const b = document.querySelector('[data-tip^="Back to its own shape"]'); if (!b) return false; b.click(); return true; })()`);
    t.ok(ok, 'the card offers Back to its own shape');
    await t.until(() => A(t, id).stretch === undefined, 3000, 'its own shape again');
    await t.until(async () => !(await t.count('[data-tip^="Back to its own shape"]')), 3000, 'the button to go once it has its own shape');
  });

  // Its box stands upright round its middle while its picture lies turned inside it: for a long asset turned a quarter
  // the two barely overlap. It is grabbed by its picture, and above the tokens it keeps its whole length over a token.
  area.quick('a long asset turned a quarter is grabbed by its picture and keeps its ends over a token (Beta 3.10)', async (t) => {
    const { id, k } = await one(t, { w: 10, stretch: 0.2, rotation: 90 });
    const sel = () => t.g(`Play.ui.selAssets.slice()`);
    const b = await box(t, id);
    t.ok(b.w > b.h * 3, 'it is long', b);
    const end = await t.scr(b.x, b.y - b.w * 0.42); const beside = await t.scr(b.x + b.w * 0.35, b.y);
    await t.click(beside.x, beside.y); await t.sleep(250); // (beside it: on the map, so the selection goes)
    t.eq(await sel(), [], 'a click beside it, where its upright box used to take the pointer, leaves it alone');
    await t.click(end.x, end.y); await t.sleep(250);
    t.eq(await sel(), [id], 'a click on its far end picks it');
    // above the tokens, on the TV: a token under its middle opens a window, and the picture is not cut down to the box
    t.handle('layer.update', { mapId: own, id, over: true });
    const tok = t.handle('layer.add', { mapId: own, path: t.pic('tokens'), role: 'token', x: b.x, y: b.y }).selected;
    const mask = () => t.t(`(() => { const e = document.querySelector('.sv-asset[data-id="${id}"]'); const c = getComputedStyle(e); return { on: !!e.style.maskImage, clip: c.maskClip, size: parseFloat(c.maskSize), w: parseFloat(e.style.width), h: parseFloat(e.style.height) }; })()`);
    const m = await t.until(async () => { const x = await mask(); return x.on && x; }, 4000, 'the window over the token');
    t.eq(m.clip, 'no-clip', 'the mask does not cut the picture to its box');
    t.ok(m.size >= Math.hypot(m.w, m.h), 'the mask reaches round the picture however it lies', m);
    // Second Builder (second-tree-hue-solid): on your screen it is solid (it used to be half see-through) and opens the same way
    t.eq(await t.g(`getComputedStyle(document.querySelector('.sv-assets-over')).opacity`), '1', 'solid on your screen');
    await t.until(() => t.g(`!!document.querySelector('.sv-asset[data-id="${id}"]').style.maskImage`), 4000, 'the window over the token on your screen too');
    // a token beside it (inside the upright box, not under the picture) opens nothing
    t.handle('layer.update', { mapId: own, id: tok, x: b.x + b.w * 0.35, y: b.y });
    await t.until(async () => !(await mask()).on, 4000, 'no window for a token that stands beside it');
    t.handle('layer.remove', { mapId: own, id: tok });
  });

  area.deep('an asset\'s shape stays within limits, belongs to assets only, and the Height slider sets it', async (t) => {
    const { id } = await one(t);
    const set = (v) => { t.handle('layer.update', { mapId: own, id, stretch: v }); return A(t, id).stretch; };
    t.eq(set(500), 20, 'far too long'); t.eq(set(0.0001), 0.05, 'far too flat'); t.eq(set('x'), undefined, 'not a number'); t.eq(set(1.002), undefined, 'its own shape is not stored');
    t.eq(set(2.5), 2.5, 'a shape');
    const tok = M(t).layers.find((l) => l.role === 'token') || (() => { const r = t.handle('layer.add', { mapId: own, path: t.pic('tokens'), role: 'token', x: 5, y: 5 }); return A(t, r.selected); })();
    t.handle('layer.update', { mapId: own, id: tok.id, stretch: 3 });
    t.eq(A(t, tok.id).stretch, undefined, 'a token takes no shape');
    // a copy keeps the shape
    const c = t.handle('layer.duplicate', { mapId: own, id, dx: 1, dy: 0 });
    t.eq(A(t, c.selected).stretch, 2.5, 'a duplicate has the same shape');
    t.handle('layer.remove', { mapId: own, id: c.selected });
    // the Height slider in the Assets panel (even steps, 100 % in the middle)
    const moved = await t.g(`(() => { const l = [...document.querySelectorAll('#pop .ctl-slider')].find((x) => x.querySelector('.ctl-label').textContent === 'Height'); if (!l) return null; const i = l.querySelector('input'); i.value = -1; i.dispatchEvent(new Event('input', { bubbles: true })); return l.querySelector('output').textContent; })()`);
    t.eq(moved, '50%', 'what the slider says at a notch below the middle');
    await t.until(() => A(t, id).stretch === 0.5, 3000, 'the picked asset to be half as tall');
  });

  area.deep('the Hue slider turns an asset\'s colours, on the TV too (Beta 3.10)', async (t) => {
    const { id } = await one(t, { shadow: true });
    const set = (v) => { t.handle('layer.update', { mapId: own, id, hue: v }); return A(t, id).hue; };
    t.eq(set(90), 90, 'a quarter round the wheel'); t.eq(set(270), -90, 'three quarters is a quarter the other way'); t.eq(set(-180), 180, 'half way round, either way');
    t.eq(set(360), undefined, 'all the way round is no turn, and is not stored'); t.eq(set('x'), undefined, 'not a number');
    const tok = t.handle('layer.add', { mapId: own, path: t.pic('tokens'), role: 'token', x: 5, y: 5 }).selected;
    t.handle('layer.update', { mapId: own, id: tok, hue: 40 });
    t.eq(A(t, tok).hue, undefined, 'a token takes no hue');
    t.handle('layer.remove', { mapId: own, id: tok });
    // the slider in the Assets panel
    const said = await t.g(`(() => { const l = [...document.querySelectorAll('#pop .ctl-slider')].find((x) => x.querySelector('.ctl-label').textContent === 'Hue'); if (!l) return null; const i = l.querySelector('input'); i.value = 120; i.dispatchEvent(new Event('input', { bubbles: true })); return l.querySelector('output').textContent; })()`);
    t.eq(said, '+120°', 'what the slider says');
    await t.until(() => A(t, id).hue === 120, 3000, 'the picked asset\'s hue');
    const f = await t.until(async () => { const x = await t.t(`(document.querySelector('.sv-asset[data-id="${id}"]') || { style: {} }).style.filter`); return /hue-rotate\(120deg\)/.test(x) && x; }, 4000, 'the hue on the TV');
    t.ok(f.indexOf('hue-rotate') < f.indexOf('drop-shadow'), 'the colours turn before the shadow is cast (it stays black)', f);
    // the next one placed takes the look that is set with nothing picked
    const b = await box(t, id); const beside = await t.scr(b.x + b.w * 2, b.y);
    await t.click(beside.x, beside.y);
    await t.until(async () => !(await t.g(`Play.ui.selAssets.length`)), 3000, 'nothing picked');
    // (Beta 3.61: the look of the next one is the card "Look", beside the panel)
    await t.until(() => t.count('#pop .asset-pop .os-fxset'), 3000, 'the panel is back on what is in hand, with its Look button');
    t.eq(await t.count('#pop .pop-fly'), 0, 'the Look card is shut at first');
    await t.g(`document.querySelector('#pop .asset-pop .os-fxset').click()`);
    await t.until(() => t.count('#pop .pop-fly .ctl-slider'), 3000, 'the Look card with its sliders');
    const hueTo = (v) => t.g(`(() => { const l = [...document.querySelectorAll('#pop .ctl-slider')].find((x) => x.querySelector('.ctl-label').textContent === 'Hue'); const i = l.querySelector('input'); i.value = ${v}; i.dispatchEvent(new Event('input', { bubbles: true })); return Play.ui.assetLook.hue; })()`);
    t.eq(await hueTo(-60), -60, 'with nothing picked the slider sets the look of the next one');
    t.eq(A(t, id).hue, 120, 'and leaves the placed one alone');
    await hueTo(0);
    await t.g(`document.querySelector('#pop .pop-fly .os-fly-head .icon-btn').click()`);
    await t.until(async () => !(await t.count('#pop .pop-fly')), 3000, 'the card shuts with its ✕');
  });
};
