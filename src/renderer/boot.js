// Before anything else: the splash (the name, still) while the GM screen gets ready (not on the TV or in the sound window)
'use strict';
if (/role=(table|sound)/.test(location.search)) document.documentElement.classList.add('no-boot');
window.__bootAt = performance.now(); // (Beta 3.17: the splash stays at least 1.5 s once it has faded in)

// Beta 3.66: a canvas turned by a very large angle loses its fine steps. The browser hands the angle on in degrees as
// a 32-bit number, and the effects turn things by time × rate with the time in seconds since a fixed day: at 50
// million radians the picture moves only once every 256 degrees. So a whirlpool, a dust devil or a gear stood still
// for eight seconds and then jumped most of a turn. Every rotate() (and an ellipse's tilt) now gets its angle within
// one turn, which is exact; the drawing is the same.
(() => {
  const T = Math.PI * 2;
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D', 'Path2D']) {
    const C = typeof window !== 'undefined' && window[name]; const P = C && C.prototype; if (!P) continue;
    if (P.rotate && !P.rotate.oneTurn) { const f = P.rotate; P.rotate = function (a) { return f.call(this, Number.isFinite(a) ? a % T : a); }; P.rotate.oneTurn = true; }
    if (P.ellipse && !P.ellipse.oneTurn) { const f = P.ellipse; P.ellipse = function (x, y, rx, ry, rot, ...rest) { return f.call(this, x, y, rx, ry, Number.isFinite(rot) ? rot % T : rot, ...rest); }; P.ellipse.oneTurn = true; }
  }
})();
