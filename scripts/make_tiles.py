#!/usr/bin/env python3
"""Oldschool maps (Beta 3.22): the tiles that come with the app.

  python3 scripts/make_tiles.py <folder with the source pictures>

The source pictures are seamless squares (Glinn's Midjourney tiles), named <id>.png. This writes
- src/renderer/tiles/<id>.webp        the tile, 1536 px (enough for about 16 squares at the bake's sharpness)
- src/renderer/tiles/<id>-small.webp  256 px, for the library and the Draw panel
- src/renderer/tile-data.js           the list below as a script (the windows cannot read files)

kind 'floor': a floor tile (Library → Tiles, the Draw panel's Floor). kind 'material': what walls, rock and cliffs are
made of. squares: how many squares the picture spans (its blocks are usually one square each). An id and a label are
permanent once released: maps point at them.
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'renderer')
OUT = os.path.join(ROOT, 'tiles')
TILES = [
    # floors
    ('old_cobblestone', 'Old cobblestone', 'floor', 10),
    ('dark_cobblestone', 'Dark cobblestone', 'floor', 6),
    ('slate', 'Slate', 'floor', 6),
    ('mossy_court', 'Mossy court', 'floor', 10),
    ('wood_parquet', 'Wood parquet', 'floor', 8),
    ('desert_sand', 'Desert sand', 'floor', 15),
    ('ice', 'Ice', 'floor', 6),
    ('teal_stone', 'Teal stone', 'floor', 8),
    ('glowing_blue', 'Glowing blue', 'floor', 12),
    ('dark_teal_embers', 'Dark teal embers', 'floor', 10),
    ('lava_runes', 'Lava runes', 'floor', 8),
    # what walls, rock and cliffs are made of
    ('stone_wall', 'Stone', 'material', 4),
    ('dark_stone_wall', 'Dark stone', 'material', 5),
    ('hedge', 'Hedge', 'material', 5),
    ('rock', 'Rock', 'material', 6),
    ('cliff', 'Mossy rock', 'material', 8),
]
BIG = 1536
SMALL = 256


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for tid, label, kind, squares in TILES:
        big = os.path.join(OUT, f'{tid}.webp')
        small = os.path.join(OUT, f'{tid}-small.webp')
        if src:
            im = Image.open(os.path.join(src, f'{tid}.png')).convert('RGB')
            im.resize((BIG, BIG), Image.LANCZOS).save(big, 'WEBP', quality=82, method=6)
            im.resize((SMALL, SMALL), Image.LANCZOS).save(small, 'WEBP', quality=80, method=6)
        total += os.path.getsize(big) + os.path.getsize(small)
    data = {'tiles': [{'id': t, 'label': l, 'kind': k, 'squares': s, 'file': f'{t}.webp', 'small': f'{t}-small.webp'} for t, l, k, s in TILES]}
    js = ('// Oldschool maps (Beta 3.22): the tiles that come with the app. Made by scripts/make_tiles.py: do not edit by hand.\n'
          "'use strict';\nconst TILE_DATA = " + json.dumps(data, separators=(',', ':')) + ';\n'
          "if (typeof module !== 'undefined' && module.exports) module.exports = TILE_DATA;\n")
    open(os.path.join(ROOT, 'tile-data.js'), 'w').write(js)
    print(f'{len(TILES)} tiles, {total // 1024} KB')


if __name__ == '__main__':
    main()
