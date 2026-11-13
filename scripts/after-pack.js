// electron-builder afterPack: writes the app icon and the version into Tablescape.exe.
// Done with resedit (plain JavaScript), so building on Linux or macOS needs no Wine.
'use strict';
const fs = require('fs');
const path = require('path');

async function stamp(exe, { icon, version, label }) {
  const ResEdit = await import('resedit');
  const ex = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(ex);
  // the icon: replace Electron's icon group with ours (all sizes)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icon));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, iconFile.icons.map((i) => i.data));
  // the version shown in the file's properties
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const lang = { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    ProductName: 'Tablescape', FileDescription: `Tablescape ${label}`, CompanyName: 'glinnbo',
    ProductVersion: label, FileVersion: version, OriginalFilename: path.basename(exe), InternalName: 'Tablescape',
    LegalCopyright: 'Copyright (c) 2026 glinnbo',
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(ex);
  fs.writeFileSync(exe, Buffer.from(ex.generate()));
}

exports.stamp = stamp;
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const pkg = require('../package.json');
  await stamp(exe, { icon: path.join(__dirname, '..', 'build', 'icon.ico'), version: pkg.version, label: pkg.releaseLabel || pkg.version });
  console.log(`  • stamped icon and version into ${path.basename(exe)}`);
};
