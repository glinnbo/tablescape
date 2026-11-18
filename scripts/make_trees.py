#!/usr/bin/env python3
"""Living trees (Beta 3.20): what the app needs besides the layers of src/renderer/trees/<variant>/.

  python3 scripts/make_trees.py

- src/renderer/trees/<variant>/still-<size>.webp: the tree as one still picture, as big as its footprint layer (its
  bottom layer, or the one tree.json names in "footprintLayer": the palm's widest crown sits near the top)
  (the library's tile, the picture under the mouse while placing, the Cartographer, and the tree itself on a PC
  without graphics acceleration)
- src/renderer/tree-data.js: every tree.json in one script (the windows cannot fetch files)

A new variant: cut its sheet with scripts/cut_tree_sheet.py into src/renderer/trees/<id>/, add it to
src/renderer/trees/index.json (with its "group": Trees, Bushes, Mushrooms …), then run this.
"""
import json
import os
from PIL import Image, ImageFilter, ImageEnhance

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'renderer')
TREES = os.path.join(ROOT, 'trees')
STILL = 512  # the longer side of a still picture
SUN = (0.62, 0.78)  # where shadows fall (tree-wind.js)


def footprint(cfg, base):
    fp = cfg.get('footprintLayer')
    return fp if fp is not None and base <= fp < len(cfg['layers']) else base


def still(cfg, d, base):
    layers = cfg['layers']
    fp = footprint(cfg, base)
    B = layers[fp]  # the picture is as big as the footprint layer, centred on it
    n = len(layers)
    top = max(1, n - 1 - base)
    sd = cfg['shadow']
    va = cfg.get('variation', {})
    out = Image.new('RGBA', (B['w'], B['h']), (0, 0, 0, 0))
    for i in range(base, n):
        L = layers[i]
        im = Image.open(os.path.join(d, L['file'])).convert('RGBA')
        hgt = (i - base) / top
        k = 1 + va.get('heightLight', 0.08) * (hgt * 2 - 1)  # upper layers a little brighter (as the engine draws them)
        rgb = ImageEnhance.Brightness(im.convert('RGB')).enhance(k)
        im = Image.merge('RGBA', (*rgb.split(), im.getchannel('A')))
        x = round(B['cx'] - L['cx'])
        y = round(B['cy'] - L['cy'])
        if i > base:  # its soft shadow on the layer below
            dd = B['w'] * (sd['groundOffset'] if i == fp else sd['layerOffset'] * (1 + (i - base) * 0.25))
            a = im.getchannel('A').filter(ImageFilter.GaussianBlur(B['w'] * sd['blur'])).point(lambda v: int(v * sd['layerAlpha']))
            sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
            sh.putalpha(a)
            under = Image.new('RGBA', out.size, (0, 0, 0, 0))
            under.paste(sh, (x + round(SUN[0] * dd), y + round(SUN[1] * dd)))
            under.putalpha(Image.composite(under.getchannel('A'), Image.new('L', out.size, 0), out.getchannel('A')))  # only on the tree
            out = Image.alpha_composite(out, under)
        lay = Image.new('RGBA', out.size, (0, 0, 0, 0))
        lay.paste(im, (x, y))
        out = Image.alpha_composite(out, lay)
    s = STILL / max(out.size)
    return out.resize((max(1, round(out.width * s)), max(1, round(out.height * s))), Image.LANCZOS)


def main():
    index = json.load(open(os.path.join(TREES, 'index.json')))
    data = {'order': [], 'groups': index.get('groups') or ['Trees'], 'variants': {}}
    total = 0
    for v in index['variants']:
        d = os.path.join(TREES, v['id'])
        cfg = json.load(open(os.path.join(d, 'tree.json')))
        for s in cfg['sizes']:
            f = os.path.join(d, f"still-{s['id']}.webp")
            im = still(cfg, d, s['base'])
            im.save(f, 'WEBP', quality=84, method=6)
            s['still'] = [im.width, im.height]
            total += os.path.getsize(f)
        cfg['group'] = v.get('group') or 'Trees'
        data['order'].append(cfg['id'])
        data['variants'][cfg['id']] = cfg
    js = ('// Living trees (Beta 3.20): every variant\'s tree.json. Made by scripts/make_trees.py: do not edit by hand.\n'
          "'use strict';\nconst TREE_DATA = " + json.dumps(data, separators=(',', ':')) + ';\n'
          "if (typeof module !== 'undefined' && module.exports) module.exports = TREE_DATA;\n")
    open(os.path.join(ROOT, 'tree-data.js'), 'w').write(js)
    print(f"{len(data['order'])} variants, stills {total // 1024} KB, tree-data.js {len(js) // 1024} KB")


if __name__ == '__main__':
    main()
