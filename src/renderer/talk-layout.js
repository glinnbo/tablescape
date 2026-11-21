// Second Builder (second-conversation-stage): where the portraits of a conversation stand, worked out in one place
// for the TV (table-overlays.js) and for the small TV in the Conversation window (talk-stage.js), so both always agree.
//
// The newest portrait stands in front at talk.pos (0 the left end … 1 the right end); the earlier ones step back
// beside it, towards the middle of the TV (round it, alternating, when it stands in the middle). Each portrait has
// its own size (scale) and its own nudge (offset: x a share of its width, y of its height, up is +).
//
// Players on both long sides: each side has its own copy, turned round (the far side's copy stands mirrored through
// the middle of the TV). Glinn, 21 Nov 2026: a tall portrait may reach over the far side's band, away from the players
// who look at it; only where it would meet the far side's copy of a portrait does it keep below the bands (86 %).
'use strict';
window.TalkLayout = (() => {
  const ROOM = 0.86; // (share of the TV's height between the two bands: no taller where a far copy stands above)
  const MOST = 0.97; // (never taller than the TV)
  // W, H: the TV in any unit (pixels on the TV, pixels of the small TV); size, pos, anchor: settings.talk;
  // seats: 'one' | 'both'; items: oldest first, the one speaking last: { aspect (width / height, or 0 when unknown), scale, offset }
  // gives, per item: left, width, height (from the bottom of its side), dx, dy (its nudge in the same unit), front,
  // capped (kept below the bands); and spans: [left, right] of each, for the bands' front copies
  function compute({ W, H, size, pos, anchor, seats, items }) {
    const n = items.length;
    const base = Math.round((size || 0.34) * H);
    const both = seats !== 'one';
    let cap = new Array(n).fill(false);
    let out = null;
    for (let round = 0; round < 3; round++) {
      out = place(W, H, base, pos, anchor, items, both, cap);
      if (!both) break;
      // where a portrait would meet the far copy of one (its own included), both keep below the bands
      const next = cap.slice();
      const span = (b) => [b.left + b.dx, b.left + b.dx + b.width];
      const mirror = (s) => [W - s[1], W - s[0]];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const a = span(out[i]); const m = mirror(span(out[j]));
          const meet = a[0] < m[1] - 1 && m[0] < a[1] - 1;
          if (meet) { next[i] = true; next[j] = true; }
        }
      }
      if (next.every((v, k) => v === cap[k])) break;
      cap = next;
    }
    return { items: out, spans: out.map((b) => [b.left + b.dx, b.left + b.dx + b.width]) };
  }
  function place(W, H, base, pos, anchor, items, both, cap) {
    const margin = W * 0.04;
    const hs = items.map((it, i) => Math.min(Math.round(H * (both && cap[i] ? ROOM : MOST)), Math.round(base * ((it && it.scale) || 1))));
    const widths = items.map((it, i) => (it && it.aspect ? hs[i] * it.aspect : hs[i] * 0.8));
    const order = items.map((it, i) => i).reverse(); // front first
    const left = new Array(items.length);
    const at = Number.isFinite(pos) ? pos : { left: 0, center: 0.5, right: 1 }[anchor] ?? 1;
    const fi = order[0]; const wf = fi != null ? widths[fi] : 0;
    const frontLeft = margin + at * Math.max(0, W - 2 * margin - wf);
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
      return { left: left[i], width: widths[i], height: hs[i], dx: (off.x || 0) * widths[i], dy: -(off.y || 0) * hs[i], front: i === items.length - 1, capped: !!cap[i] && both };
    });
  }
  // where the speaker's left edge goes for a given pos, and back (the small TV drags the speaker sideways)
  function posFor(W, frontLeft, frontWidth) {
    const margin = W * 0.04; const room = Math.max(1, W - 2 * margin - frontWidth);
    return Math.min(1, Math.max(0, (frontLeft - margin) / room));
  }
  return { compute, posFor, ROOM, MOST };
})();
