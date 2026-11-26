#!/usr/bin/env python3
"""Oldschool maps (Beta 3.22): the tiles that come with the app.

  python3 scripts/make_tiles.py <folder with the source pictures>

The source pictures are seamless squares (Glinn's Midjourney tiles), named <id>.png. This writes
- src/renderer/tiles/<id>.webp        the tile, 2048 px (its full size: the sharp tiles of Beta 3.25)
- src/renderer/tiles/<id>-small.webp  256 px, for the library and the Draw panel
- src/renderer/tile-data.js           the list below as a script (the windows cannot read files)

kind 'floor': a floor tile (Library → Tiles, the Draw panel's Floor). kind 'material': what walls, rock and cliffs are
made of. squares: how many squares the picture spans (its blocks are usually one square each). An id and a label are
permanent once released: maps point at them.

off (Beta 3.24): where the joints between the blocks lie, as a fraction of a square from the picture's left and top
edge, measured here (the dark joints, folded over one square); the tile is shifted by it so its joints are the grid.
The GM can still adjust any tile (right-click a floor in the Draw panel → Adjust grid).
"""
import json
import os
import sys
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'renderer')
OUT = os.path.join(ROOT, 'tiles')
TILES = [
    # floors
    ('old_cobblestone', 'Old cobblestone', 'floor', 10),
    ('dark_cobblestone', 'Dark cobblestone', 'floor', 6),
    ('slate', 'Slate', 'floor', 6),
    ('mossy_court', 'Mossy court', 'floor', 10),
    ('wood_parquet', 'Wood parquet', 'floor', 8),
    ('desert_sand', 'Desert sand', 'floor', 10),  # (Beta 3.25: Glinn's new picture)
    ('desert_stone', 'Desert stone', 'floor', 6),
    ('ice', 'Ice', 'floor', 6),
    ('teal_stone', 'Teal stone', 'floor', 8),
    ('glowing_blue', 'Glowing blue', 'floor', 12),
    ('dark_teal_embers', 'Dark teal embers', 'floor', 10),
    ('lava_runes', 'Lava runes', 'floor', 8),
    # (Beta 3.30: Glinn's next set, to become a pack later)
    ('sandstone_tiles', 'Sandstone tiles', 'floor', 6),
    ('white_stone', 'White stone', 'floor', 4),
    ('fieldstone', 'Fieldstone', 'floor', 6),
    ('gravel_cobbles', 'Gravel cobbles', 'floor', 6),
    ('mossy_cobbles', 'Mossy cobbles', 'floor', 6),
    ('mossy_flagstones', 'Mossy flagstones', 'floor', 8),
    ('grassy_flagstones', 'Grassy flagstones', 'floor', 7),
    ('overgrown_flagstones', 'Overgrown flagstones', 'floor', 8),
    ('grass_and_dirt', 'Grass and dirt', 'floor', 4),
    ('bone_tiles', 'Bone tiles', 'floor', 6),
    ('checkerboard', 'Checkerboard', 'floor', 8),
    ('dark_marble', 'Dark marble', 'floor', 6),
    ('white_marble', 'White marble', 'floor', 4),
    ('teal_glass', 'Teal glass', 'floor', 6),
    ('wood_panels', 'Wood panels', 'floor', 4),
    ('parquet_panels', 'Parquet panels', 'floor', 3),
    ('iron_plates', 'Iron plates', 'floor', 4),
    ('rusted_plates', 'Rusted plates', 'floor', 4),
    ('scrap_plates', 'Scrap plates', 'floor', 10),
    ('meadow', 'Meadow', 'floor', 4),
    ('sandy_floor', 'Sandy floor', 'floor', 4),
    ('snowfield', 'Snowfield', 'floor', 4),
    ('snow_blocks', 'Snow blocks', 'floor', 4),
    ('frosted_tiles', 'Frosted tiles', 'floor', 4),
    ('ice_blocks', 'Ice blocks', 'floor', 6),
    ('clear_water', 'Clear water', 'floor', 6),
    ('blue_pool', 'Blue pool', 'floor', 6),
    ('lagoon', 'Lagoon', 'floor', 8),
    ('deep_sea', 'Deep sea', 'floor', 8),
    ('lava_field', 'Lava field', 'floor', 6),
    ('lava_veins', 'Lava veins', 'floor', 4),
    ('burning_blocks', 'Burning blocks', 'floor', 4),
    ('bloody_black_stone', 'Bloody black stone', 'floor', 8),
    ('bloody_slate', 'Bloody slate', 'floor', 8),
    ('bloody_grey_stone', 'Bloody grey stone', 'floor', 6),
    ('bloody_checkerboard', 'Bloody checkerboard', 'floor', 8),
    ('bloody_planks', 'Bloody planks', 'floor', 8),
    # (Beta 3.42: Glinn's set for the living tiles: beds for water without painted waves, lava, glow, ice, grass, sand,
    # all in flat light. Until the living layer is built they are still tiles like the others)
    ('river_pebbles', 'River pebbles', 'floor', 8),
    ('river_stones', 'River stones', 'floor', 5),
    ('sandy_shallows', 'Sandy shallows', 'floor', 8),
    ('deep_water', 'Deep water', 'floor', 8),
    ('bath_mosaic', 'Bath mosaic', 'floor', 4),
    ('bog', 'Bog', 'floor', 6),
    ('lava_flow', 'Lava flow', 'floor', 6),
    ('lava_crust', 'Lava crust', 'floor', 6),
    ('rune_floor', 'Rune floor', 'floor', 4),
    ('glowing_cave', 'Glowing cave', 'floor', 6),
    ('frozen_lake', 'Frozen lake', 'floor', 6),
    ('tall_grass', 'Tall grass', 'floor', 5),
    ('dune_sand', 'Dune sand', 'floor', 8),
    # what walls, rock and cliffs are made of
    ('stone_wall', 'Stone', 'material', 4),
    ('dark_stone_wall', 'Dark stone', 'material', 5),
    ('hedge', 'Hedge', 'material', 5),
    ('rock', 'Rock', 'material', 6),
    ('cliff', 'Mossy rock', 'material', 8),
]
# Wall kits (Beta 3.36: Stone and Dark stone; 25 Nov 2026: fifteen more). tiles/walls/<id>/ holds the pieces run, cap,
# jamb, end and sill (notes/wall-details-and-kits.md). kind 'wallkit': a wall material that is only its kit. It has no
# square picture and takes none of the light step's five material places: where no piece lies, a bond of its run is
# laid. gain: how much darker it is painted than it was rendered (FLUX lights the pieces brighter than the floors'
# photos; the two stone kits were darkened in their files, these are darkened when they are painted, so the number can
# still be tuned). Matched so that a kit is about 8 % brighter than the floor it was made after, as Stone is.
WALL_KITS = [
    ('fieldstone_wall', 'Fieldstone', 0.79),
    ('brick_wall', 'Brick', 0.75),
    ('sandstone_wall', 'Sandstone', 0.74),
    ('marble_wall', 'Marble', 0.88),
    ('mossy_ruin_wall', 'Mossy ruin', 0.69),
    ('rune_wall', 'Rune stone', 0.71),
    ('dwarven_wall', 'Dwarven', 1.0),
    ('obsidian_wall', 'Obsidian', 0.93),
    ('wood_wall', 'Wood', 0.84),
    ('timber_frame_wall', 'Timber frame', 0.85),
    ('palisade_wall', 'Palisade', 0.75),
    ('grimy_metal_wall', 'Iron', 1.0),
    ('ice_wall', 'Ice', 1.0),
    ('crystal_wall', 'Crystal', 0.72),
    ('bone_wall', 'Bone', 0.76),
]
# (Beta 3.43: no tile moves by itself any more; water, lava, grass and glow are drawn over any floor as effects)
BIG = 2048  # (Beta 3.25: their full size; the sharp tiles show up to 200 dots a square)
SMALL = 256


def joints(path, n):
    import numpy as np  # (only needed when a tile's picture is new: the others keep the joints they have)
    """Where the joints lie across and down, as a fraction of a square (0..1), for a tile of n squares."""
    im = Image.open(path).convert('L')
    N = im.size[0]
    a = np.asarray(im, dtype=np.float32) / 255
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(N / 80)), dtype=np.float32) / 255
    dark = np.clip(blur - a, 0, None)  # thin dark lines: the joints
    out = []
    for axis in (0, 1):
        prof = dark.mean(axis=axis)
        P = N / n
        bins = 256
        idx = ((np.arange(N) % P) / P * bins).astype(int) % bins
        fold = np.bincount(idx, prof, bins) / np.maximum(np.bincount(idx, None, bins), 1)
        k = np.exp(-0.5 * (np.arange(-8, 9) / 3.0) ** 2); k /= k.sum()  # smooth (circular)
        fold = np.real(np.fft.ifft(np.fft.fft(fold) * np.fft.fft(np.roll(np.pad(k, (0, bins - k.size)), -8))))
        i = int(fold.argmax())
        y0, y1, y2 = fold[i - 1], fold[i], fold[(i + 1) % bins]
        d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0  # (between bins)
        out.append(round(((i + 0.5 + d) / bins) % 1, 3))
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(OUT, exist_ok=True)
    total = 0
    # (the joints measured before are kept: only a tile whose picture is given, or a new one, is measured)
    was = {}
    try:
        txt = open(os.path.join(ROOT, 'tile-data.js'), encoding='utf-8').read()
        was = {t['id']: t for t in json.loads(txt[txt.index('const TILE_DATA = ') + 18:txt.index(';\nif (typeof module')])['tiles']}
    except (OSError, ValueError):
        pass
    fresh = set()
    for tid, label, kind, squares in TILES:
        big = os.path.join(OUT, f'{tid}.webp')
        small = os.path.join(OUT, f'{tid}-small.webp')
        if src and os.path.exists(os.path.join(src, f'{tid}.png')):  # (only those whose picture is given are made again)
            im = Image.open(os.path.join(src, f'{tid}.png')).convert('RGB')
            im.resize((BIG, BIG), Image.LANCZOS).save(big, 'WEBP', quality=82, method=6)
            im.resize((SMALL, SMALL), Image.LANCZOS).save(small, 'WEBP', quality=80, method=6)
            fresh.add(tid)
        total += os.path.getsize(big) + os.path.getsize(small)
    data = {'tiles': [{'id': t, 'label': l, 'kind': k, 'squares': s, 'off': was[t]['off'] if t in was and t not in fresh and was[t].get('squares') == s else joints(os.path.join(OUT, f'{t}.webp'), s), 'file': f'{t}.webp', 'small': f'{t}-small.webp'} for t, l, k, s in TILES]}
    # the wall kits: a small picture for the Draw panel, cut from the run (one stone and its joints), as dark as painted
    for kid, label, gain in WALL_KITS:
        run = Image.open(os.path.join(OUT, 'walls', kid, 'run.webp')).convert('RGB')
        sm = run.crop((512, 0, 768, 256)).point(lambda v: int(v * gain + 0.5))
        small = os.path.join(OUT, 'walls', kid, 'small.webp')
        sm.save(small, 'WEBP', quality=80, method=6)
        total += sum(os.path.getsize(os.path.join(OUT, 'walls', kid, f)) for f in os.listdir(os.path.join(OUT, 'walls', kid)))
        data['tiles'].append({'id': kid, 'label': label, 'kind': 'wallkit', 'gain': gain, 'small': f'walls/{kid}/small.webp'})
    js = ('// Oldschool maps (Beta 3.22): the tiles that come with the app. Made by scripts/make_tiles.py: do not edit by hand.\n'
          "'use strict';\nconst TILE_DATA = " + json.dumps(data, separators=(',', ':')) + ';\n'
          "if (typeof module !== 'undefined' && module.exports) module.exports = TILE_DATA;\n")
    open(os.path.join(ROOT, 'tile-data.js'), 'w').write(js)
    print(f'{len(TILES)} tiles, {len(WALL_KITS)} wall kits, {total // 1024} KB')


if __name__ == '__main__':
    main()
