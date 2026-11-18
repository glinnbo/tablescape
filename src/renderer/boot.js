// Before anything else: the splash (the name, still) while the GM screen gets ready (not on the TV or in the sound window)
'use strict';
if (/role=(table|sound)/.test(location.search)) document.documentElement.classList.add('no-boot');
window.__bootAt = performance.now(); // (Beta 3.17: the splash stays at least 1.5 s once it has faded in)
