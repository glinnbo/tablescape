#!/usr/bin/env node
// Builds the Windows release (setup, portable exe, zip) on Linux or macOS without Wine.
// electron-builder makes the setup's uninstaller by running an intermediate installer under Wine;
// on macOS it instead reads the uninstaller out of that installer in JavaScript. This script turns
// that reader on everywhere, then runs electron-builder with the usual arguments:
//   node scripts/build-win.js --win            (npm run dist:win)
'use strict';
if (process.platform !== 'win32') {
  const mv = require('app-builder-lib/out/util/macosVersion');
  mv.isMacOsCatalina = () => true; // only the NSIS target asks; it then uses UninstallerReader instead of Wine
}
require('electron-builder/out/cli/cli.js');
