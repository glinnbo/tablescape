// Second Builder (second-conversation-stage): where the portraits of a conversation stand, worked out in one place
// for the TV (table-overlays.js) and for the small TV in the Conversation window (talk-stage.js), so both always agree.
//
// The newest portrait stands in front at talk.pos (0 the left end … 1 the right end); the earlier ones step back
// beside it, towards the middle of the TV (round it, alternating, when it stands in the middle). Each portrait has
// its own size (scale) and its own nudge (offset: x a share of its width, y of its height, up is +).
//
// Players on both long sides: each side has its own copy, turned round (the far side's copy stands mirrored through
// the middle of the TV). Glinn, 21 Nov 2026 (second-conversation-rework): portraits may be as tall as wanted and run
// off the top and the sides of the TV, over the far band and the far side's copies (they may cover each other); only
// downwards they never go: their feet stay in their band (a nudge is never below 0).
'use strict';
window.TalkLayout = (() => {
  // W, H: the TV in any unit (pixels on the TV, pixels of the small TV); size, pos, anchor: settings.talk;
  // items: oldest first, the one speaking last: { aspect (width / height, or 0 when unknown), scale, offset }
  // gives, per item: left, width, height (from the bottom of its side), dx, dy (its nudge in the same unit), front;
  // and spans: [left, right] of each, for the bands' front copies
  function compute({ W, H, size, pos, anchor, items }) {
    const out = place(W, H, Math.round((size || 0.34) * H), pos, anchor, items);
    return { items: out, spans: out.map((b) => [b.left + b.dx, b.left + b.dx + b.width]) };
  }
  // the room the speaker's left edge moves in for pos 0 … 1 (at least 30 % of the TV, also for a portrait wider than it)
  const roomOf = (W, wf) => Math.max(W * 0.3, W - 2 * W * 0.04 - wf);
  function place(W, H, base, pos, anchor, items) {
    const margin = W * 0.04;
    const hs = items.map((it) => Math.round(base * ((it && it.scale) || 1)));
    const widths = items.map((it, i) => (it && it.aspect ? hs[i] * it.aspect : hs[i] * 0.8));
    const order = items.map((it, i) => i).reverse(); // front first
    const left = new Array(items.length);
    const at = Number.isFinite(pos) ? pos : { left: 0, center: 0.5, right: 1 }[anchor] ?? 1;
    const fi = order[0]; const wf = fi != null ? widths[fi] : 0;
    const frontLeft = margin + at * roomOf(W, wf);
    if (at > 0.35 && at < 0.65) {
      const mid = frontLeft + wf / 2;
      order.forEach((i, k) => {
        if (k === 0) { left[i] = mid - widths[i] / 2; return; }
        const side = k % 2 ? -1 : 1;
        const step = Math.ceil(k / 2) * 0.62;
        left[i] = mid - widths[i] / 2 + side * step * widths[i];
      });
    } else {
      const right = at < 0.5; // standing at the left: the others step back to the right of them
      let edge = right ? frontLeft : frontLeft + wf;
      order.forEach((i, k) => {
        const w = widths[i];
        if (right) { left[i] = edge; edge += w * 0.6; } else { left[i] = edge - w; edge -= w * 0.6; }
        if (k === 0) edge += right ? w * 0.05 : -w * 0.05;
      });
    }
    return items.map((it, i) => {
      const off = (it && it.offset) || { x: 0, y: 0 };
      return { left: left[i], width: widths[i], height: hs[i], dx: (off.x || 0) * widths[i], dy: -(off.y || 0) * hs[i], front: i === items.length - 1 }; // (Glinn: below its band too, sinking behind it)
    });
  }
  // where the speaker's left edge goes for a given pos, and back (the small TV drags the speaker sideways). It may stand
  // partly off the TV: up to 60 % of it past the left or the right edge
  function posFor(W, frontLeft, frontWidth) {
    const margin = W * 0.04; const room = roomOf(W, frontWidth);
    const lo = (-0.6 * frontWidth - margin) / room; const hi = (W - 0.4 * frontWidth - margin) / room;
    return Math.min(hi, Math.max(lo, (frontLeft - margin) / room));
  }
  // Second Builder (second-conversation-rework): the band of one side is cut in two, its copy in front of this side's
  // portraits just where they stand (their feet rise out of it) and the band under everything else: the clip-paths of both
  function clips(spans, W) {
    const merged = [];
    for (const [a0, b0] of spans.map(([a, b]) => [Math.max(0, a), Math.min(W, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1];
      if (last && a0 <= last[1]) last[1] = Math.max(last[1], b0); else merged.push([a0, b0]);
    }
    const gaps = []; let x = 0;
    for (const [a, b] of merged) { if (a > x) gaps.push([x, a]); x = b; }
    if (x < W) gaps.push([x, W]);
    const rects = (list) => (list.length ? `polygon(${list.map(([a, b]) => `${Math.round(a)}px 300%, ${Math.round(a)}px -300%, ${Math.round(b)}px -300%, ${Math.round(b)}px 300%`).join(', ')})` : 'inset(0 0 100% 0)');
    return { front: rects(merged), base: merged.length ? rects(gaps) : '' };
  }
  return { compute, posFor, clips };
})();
