#!/usr/bin/env python3
"""Beta 3.1: the demo campaign that ships with Tablescape, made from Glinn's exported campaign (.tablescape).

What it does to the export, so every download stays small and a new user finds it fresh:
  - the campaign is called "Demo: the maid's cottage" (the start screen knows a demo by "Demo:")
  - "last played" is taken out (a new user hasn't played it yet)
  - pictures get lighter without changing their size in pixels (maps and walls keep their places):
      opaque PNG -> JPEG q90, JPEG over 2.5 MB -> JPEG q90, PNG with transparency -> WebP q90 (alpha kept)
    and every reference to a renamed file is changed with it
Usage: python3 scripts/make_demo_package.py <export.tablescape> [demo/Demo.tablescape]
"""
import io
import json
import sys
import zipfile
from PIL import Image

NAME = "Demo: the maid's cottage"


def lighter(rel, data):
    """(new rel, new bytes) for a picture, or None to keep it as it is."""
    low = rel.lower()
    if not low.endswith(('.png', '.jpg', '.jpeg')):
        return None
    im = Image.open(io.BytesIO(data))
    im.load()
    alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    if alpha and im.mode != 'RGBA':
        im = im.convert('RGBA')
    if alpha and im.getchannel('A').getextrema()[0] == 255:
        alpha = False  # a PNG with an alpha channel that is fully opaque
    out = io.BytesIO()
    if alpha:
        im.save(out, 'WEBP', quality=90, method=6)
        new = rel[: rel.rfind('.')] + '.webp'
    else:
        if low.endswith(('.jpg', '.jpeg')) and len(data) <= 2_500_000:
            return None
        im.convert('RGB').save(out, 'JPEG', quality=90, optimize=True, progressive=True)
        new = rel[: rel.rfind('.')] + '.jpg'
    b = out.getvalue()
    return (new, b) if len(b) < len(data) * 0.9 else None


def main(src, dst):
    zin = zipfile.ZipFile(src)
    files = {i.filename: zin.read(i.filename) for i in zin.infolist() if not i.filename.endswith('/')}
    renames = {}
    lib = {}
    for name, data in files.items():
        if not name.startswith('library/'):
            continue
        rel = name[len('library/'):]
        r = lighter(rel, data)
        if r and r[0] != rel and f'library/{r[0]}' in files:
            r = None  # a file of that name is in the package already
        if r:
            renames[rel] = r[0]
            lib[r[0]] = r[1]
            print(f'  {rel}  {len(data) // 1024} KB -> {r[0]}  {len(r[1]) // 1024} KB')
        else:
            lib[rel] = data

    def point(text):
        for a, b in renames.items():
            text = text.replace(json.dumps(a), json.dumps(b))
        return text

    camp = json.loads(point(files['campaign/campaign.json'].decode('utf8')))
    camp['name'] = NAME
    for k in ('lastSession', 'lastMapName', 'imported'):
        camp.pop(k, None)
    maps = {n: point(d.decode('utf8')) for n, d in files.items() if n.startswith('campaign/maps/') and n.endswith('.json')}
    extras = {n: d for n, d in files.items() if n.startswith('campaign/') and n != 'campaign/campaign.json' and n not in maps}

    info = json.loads(files['tablescape.json'].decode('utf8'))
    info['name'] = NAME
    info['files'] = len(lib)
    info['bytes'] = sum(len(b) for b in lib.values()) + sum(len(d) for d in extras.values())

    with zipfile.ZipFile(dst, 'w') as z:
        def put(n, b, deflate):
            z.writestr(zipfile.ZipInfo(n, date_time=(2026, 11, 13, 0, 0, 0)), b, zipfile.ZIP_DEFLATED if deflate else zipfile.ZIP_STORED)
        put('tablescape.json', json.dumps(info, indent=1).encode('utf8'), True)
        put('campaign/campaign.json', json.dumps(camp, indent=1).encode('utf8'), True)
        for n, t in sorted(maps.items()):
            put(n, t.encode('utf8'), True)
        for n, d in sorted(extras.items()):
            put(n, d, True)
        for rel, b in sorted(lib.items()):
            put(f'library/{rel}', b, False)
    before = sum(len(d) for d in files.values())
    after = sum(i.compress_size for i in zipfile.ZipFile(dst).infolist())
    print(f'{dst}: {len(maps)} maps, {len(lib)} files, {before // 1024} KB -> {after // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'demo/Demo.tablescape')
