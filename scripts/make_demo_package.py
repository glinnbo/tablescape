#!/usr/bin/env python3
"""Beta 3.1: the demo campaign that ships with Tablescape, made from Glinn's exported campaign (.tablescape).

What it does to the export, so every download stays small and a new user finds it fresh:
  - the campaign is called "Demo: the maid's cottage" (the start screen knows a demo by "Demo:")
  - "last played" is taken out (a new user hasn't played it yet)
  - pictures get lighter (maps and walls keep their places):
      opaque PNG -> JPEG q90, JPEG over 2.5 MB -> JPEG q90, PNG with transparency -> WebP q90 (alpha kept)
    and every reference to a renamed file is changed with it
  - Beta 3.17: pictures wider or taller than 4K (3840 px) are made 4K; a map placed by its scale gets the scale that
    keeps it the same size on the table
  - Beta 3.17: a map that was never placed (it fills the table, as atlas maps do) is placed as it fills the default
    43-inch table, so its places and routes stay on the picture whatever TV a new user has
  - Beta 3.17: upscaler leftovers come off the file names ("_upscayl_2x_digital-art-4x"), the campaign starts on the
    first map of its first chapter, and the time-stamped session log in the campaign notes is taken out
Usage: python3 scripts/make_demo_package.py <export.tablescape> [demo/Demo.tablescape]
"""
import io
import json
import math
import re
import sys
import zipfile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
NAME = "Demo: the maid's cottage"
MAX_SIDE = 3840  # 4K
TABLE = (16 * 43 / math.hypot(16, 9), 9 * 43 / math.hypot(16, 9))  # the default table: a 43-inch 16:9 TV, in inches
TIDY = {'DempCityMap': 'DemoCityMap'}  # file name typos
# I8 (25 Nov 2026): files that go to another folder of a new user's library (a music track in Audio/SFX would be on the
# Soundboard)
MOVE = {'Audio/SFX/Sparse Forest Notes.mp3': 'Audio/Ambience/Sparse Forest Notes.mp3'}


def tidy(rel):
    """the file name without the upscaler's leftovers (and known typos), in its folder (MOVE)"""
    rel = MOVE.get(rel, rel)
    d, _, f = rel.rpartition('/')
    stem, dot, ext = f.rpartition('.')
    stem = re.sub(r'_upscayl_.*$', '', stem)
    stem = TIDY.get(stem, stem)
    return (d + '/' if d else '') + stem + dot + ext


def lighter(rel, data):
    """(new rel, new bytes, factor) for a picture, or None to keep it as it is (factor: new pixels per old pixel)"""
    low = rel.lower()
    if not low.endswith(('.png', '.jpg', '.jpeg')):
        return None
    im = Image.open(io.BytesIO(data))
    im.load()
    k = min(1, MAX_SIDE / max(im.size))
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
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
        if low.endswith(('.jpg', '.jpeg')) and len(data) <= 2_500_000 and k == 1:
            return None
        im.convert('RGB').save(out, 'JPEG', quality=90, optimize=True, progressive=True)
        new = rel[: rel.rfind('.')] + '.jpg'
    b = out.getvalue()
    return (new, b, k) if len(b) < len(data) * 0.9 or k < 1 else None


def main(src, dst):
    zin = zipfile.ZipFile(src)
    files = {i.filename: zin.read(i.filename) for i in zin.infolist() if not i.filename.endswith('/')}
    renames = {}
    lib = {}
    shrunk = {}  # new rel -> new pixels per old pixel
    for name, data in files.items():
        if not name.startswith('library/'):
            continue
        rel = name[len('library/'):]
        r = lighter(rel, data)
        new = tidy(r[0] if r else rel)
        if new != rel and f'library/{new}' in files:
            r, new = None, rel  # a file of that name is in the package already
        if new != rel:
            renames[rel] = new
        lib[new] = r[1] if r else data
        if r and r[2] < 1:
            shrunk[new] = r[2]
        if new != rel or r:
            print(f'  {rel}  {len(data) // 1024} KB -> {new}  {len(lib[new]) // 1024} KB' + (f'  (made {r[2]:.2f} of its size)' if r and r[2] < 1 else ''))

    def stem(rel):
        return rel.rpartition('/')[2].rpartition('.')[0]
    names = {stem(a): stem(b) for a, b in renames.items() if stem(a) != stem(b)}

    def point(text):
        for a, b in renames.items():
            text = text.replace(json.dumps(a), json.dumps(b))
        for a, b in names.items():
            text = text.replace(f'"name": {json.dumps(a)}', f'"name": {json.dumps(b)}')
        return text

    def size(rel):
        try:
            return Image.open(io.BytesIO(lib[rel])).size
        except Exception:
            return None

    camp = json.loads(point(files['campaign/campaign.json'].decode('utf8')))
    camp['name'] = NAME
    for k in ('lastSession', 'lastMapName', 'imported'):
        camp.pop(k, None)
    first = next((ch['maps'][0] for ch in camp.get('chapters') or [] if ch.get('maps')), None)
    if first:
        camp['lastMapId'] = first
    notes = camp.get('notes')
    if isinstance(notes, dict) and isinstance(notes.get('text'), str):
        keep = [l for l in notes['text'].split('\n') if not re.match(r'^\[[^\]]{3,12}\] ', l)]
        notes['text'] = '\n'.join(keep).strip()
        if not notes['text']:
            camp.pop('notes')

    maps = {}
    for n, d in files.items():
        if not (n.startswith('campaign/maps/') and n.endswith('.json')):
            continue
        m = json.loads(point(d.decode('utf8')))
        bg = m.get('bg')
        wh = size(bg['rel']) if bg and bg.get('rel') in lib else None
        if wh:
            if bg.get('scale') is None and not bg.get('span'):
                sc = min(TABLE[0] / wh[0], TABLE[1] / wh[1])
                bg.update(x=round((TABLE[0] - wh[0] * sc) / 2, 4), y=round((TABLE[1] - wh[1] * sc) / 2, 4), scale=sc)
                print(f'  {m.get("name")}: placed as it fills the default table')
            elif bg.get('scale') is not None and bg['rel'] in shrunk:
                bg['scale'] = bg['scale'] / shrunk[bg['rel']]
            if bg.get('nw') or bg['rel'] in shrunk or bg.get('scale') is not None:
                bg['nw'], bg['nh'] = wh
        maps[n] = json.dumps(m)
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
