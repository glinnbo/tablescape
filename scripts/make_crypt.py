#!/usr/bin/env python3
"""Demo map for 0.7: a small crypt as a Universal VTT file (.dd2vtt), the format
Dungeon Alchemist and Dungeondraft export: the picture plus walls, doors and lights.

Procedural, so there are no licensing questions.
Usage: python3 scripts/make_crypt.py [output dir]   (default: demo)
  demo-crypt.dd2vtt
"""
import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "demo"
os.makedirs(OUT, exist_ok=True)
PPG = 64          # pixels per grid square
GW, GH = 28, 18   # squares
W, H = GW * PPG, GH * PPG
rng = np.random.default_rng(11)

# ------------------------------------------------------------- layout (grid squares)
ROOMS = [(1, 2, 8, 8), (12, 1, 22, 9), (3, 11, 10, 17), (15, 12, 26, 17)]  # x0, y0, x1, y1 (exclusive)
CORRIDORS = [(8, 4, 12, 5), (5, 8, 6, 11), (18, 9, 19, 12), (10, 14, 15, 15)]
PILLARS = [(15, 4, 17, 6), (18, 4, 20, 6)]          # solid blocks inside the big crypt
DOORS = [((12, 4), (12, 5)), ((5, 11), (6, 11)), ((18, 12), (19, 12)), ((15, 14), (15, 15))]
TORCHES = [(1.25, 4.0), (12.25, 2.0), (21.75, 8.0), (3.25, 16.0), (9.75, 12.0), (25.75, 13.0), (15.25, 16.5)]

floor = np.zeros((GH, GW), bool)
for x0, y0, x1, y1 in ROOMS + CORRIDORS:
    floor[y0:y1, x0:x1] = True
for x0, y0, x1, y1 in PILLARS:
    floor[y0:y1, x0:x1] = False


def boundary():
    """Edges between floor and rock, merged into long straight walls."""
    hor, ver = [], []
    for y in range(GH + 1):
        for x in range(GW):
            a = floor[y - 1, x] if y > 0 else False
            b = floor[y, x] if y < GH else False
            if a != b:
                hor.append((x, y))
    for x in range(GW + 1):
        for y in range(GH):
            a = floor[y, x - 1] if x > 0 else False
            b = floor[y, x] if x < GW else False
            if a != b:
                ver.append((x, y))
    segs = []
    hs = sorted(set(hor), key=lambda p: (p[1], p[0]))
    i = 0
    while i < len(hs):
        x, y = hs[i]
        j = i
        while j + 1 < len(hs) and hs[j + 1] == (hs[j][0] + 1, y):
            j += 1
        segs.append(((x, y), (hs[j][0] + 1, y)))
        i = j + 1
    vs = sorted(set(ver))
    i = 0
    while i < len(vs):
        x, y = vs[i]
        j = i
        while j + 1 < len(vs) and vs[j + 1] == (x, vs[j][1] + 1):
            j += 1
        segs.append(((x, y), (x, vs[j][1] + 1)))
        i = j + 1
    return segs


def value_noise(h, w, scale, seed):
    r = np.random.default_rng(seed)
    g = r.random((h // scale + 2, w // scale + 2)).astype(np.float32)
    img = Image.fromarray((g * 255).astype(np.uint8)).resize(((w // scale + 2) * scale, (h // scale + 2) * scale), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)[:h, :w] / 255.0


def picture(walls):
    n = 0.6 * value_noise(H, W, 96, 1) + 0.4 * value_noise(H, W, 24, 2)
    rock = np.stack([28 + 18 * n, 26 + 16 * n, 30 + 18 * n], -1)
    stone = np.stack([118 + 40 * n, 108 + 36 * n, 96 + 30 * n], -1)
    # flagstones: each square a slightly different shade, with dark joints
    shade = rng.uniform(-14, 14, (GH, GW))
    sq = np.kron(shade, np.ones((PPG, PPG)))[:H, :W]
    stone = stone + sq[..., None]
    yy, xx = np.mgrid[0:H, 0:W]
    joint = ((xx % PPG) < 2) | ((yy % PPG) < 2)
    stone[joint] *= 0.55
    mask = np.kron(floor, np.ones((PPG, PPG), bool))[:H, :W]
    img = np.where(mask[..., None], stone, rock)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(im)
    # walls: a dark band with a lighter rim on the floor side
    for (x1, y1), (x2, y2) in walls:
        d.line([(x1 * PPG, y1 * PPG), (x2 * PPG, y2 * PPG)], fill=(14, 13, 16), width=14)
    for (x1, y1), (x2, y2) in walls:
        d.line([(x1 * PPG, y1 * PPG), (x2 * PPG, y2 * PPG)], fill=(70, 66, 62), width=4)
    # doors: heavy wooden planks
    for (ax, ay), (bx, by) in DOORS:
        if ax == bx:
            box = [ax * PPG - 9, ay * PPG + 3, ax * PPG + 9, by * PPG - 3]
        else:
            box = [ax * PPG + 3, ay * PPG - 9, bx * PPG - 3, ay * PPG + 9]
        d.rectangle(box, fill=(104, 66, 34), outline=(40, 24, 12), width=3)
        if ax == bx:
            for k in range(1, 3):
                yk = box[1] + (box[3] - box[1]) * k / 3
                d.line([(box[0], yk), (box[2], yk)], fill=(60, 38, 18), width=2)
        else:
            for k in range(1, 3):
                xk = box[0] + (box[2] - box[0]) * k / 3
                d.line([(xk, box[1]), (xk, box[3])], fill=(60, 38, 18), width=2)
    # pillars, sarcophagi, an altar, chests, rubble
    for x0, y0, x1, y1 in PILLARS:
        d.rectangle([x0 * PPG + 4, y0 * PPG + 4, x1 * PPG - 4, y1 * PPG - 4], fill=(84, 80, 78), outline=(30, 28, 28), width=4)
    for cx in (13.5, 20.5):
        d.rounded_rectangle([cx * PPG - 26, 6.6 * PPG, cx * PPG + 26, 8.6 * PPG], 10, fill=(150, 144, 130), outline=(50, 46, 42), width=3)
        d.line([(cx * PPG, 6.8 * PPG), (cx * PPG, 8.4 * PPG)], fill=(90, 86, 78), width=3)
    d.rectangle([5 * PPG, 15.2 * PPG, 8 * PPG, 16.3 * PPG], fill=(120, 110, 140), outline=(44, 38, 56), width=3)
    for cx in (23, 24.5):
        d.rectangle([cx * PPG, 15.3 * PPG, cx * PPG + 50, 15.3 * PPG + 34], fill=(120, 80, 34), outline=(220, 180, 70), width=3)
    for _ in range(60):
        x, y = rng.uniform(1, GW - 1), rng.uniform(1, GH - 1)
        if floor[int(y), int(x)]:
            r = rng.uniform(3, 8)
            g = int(rng.uniform(60, 95))
            d.ellipse([x * PPG - r, y * PPG - r, x * PPG + r, y * PPG + r], fill=(g, g - 4, g - 8))
    # torch glow
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for x, y in TORCHES:
        gd.ellipse([x * PPG - 70, y * PPG - 70, x * PPG + 70, y * PPG + 70], fill=(90, 50, 10))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    im = Image.fromarray(np.clip(np.asarray(im, np.int16) + np.asarray(glow, np.int16), 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for x, y in TORCHES:
        d.ellipse([x * PPG - 7, y * PPG - 7, x * PPG + 7, y * PPG + 7], fill=(255, 190, 90), outline=(80, 40, 10), width=2)
    return im


def main():
    walls = boundary()
    im = picture(walls)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    pt = lambda x, y: {"x": float(x), "y": float(y)}
    data = {
        "format": 0.3,
        "resolution": {"map_origin": pt(0, 0), "map_size": pt(GW, GH), "pixels_per_grid": PPG},
        "line_of_sight": [[pt(*a), pt(*b)] for a, b in walls],
        "objects_line_of_sight": [],
        "portals": [{"position": pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), "bounds": [pt(*a), pt(*b)], "rotation": 0.0 if a[1] == b[1] else 1.5708,
                     "closed": True, "freestanding": False} for a, b in DOORS],
        "environment": {"baked_lighting": True, "ambient_light": "ff8c8c9a"},
        "lights": [{"position": pt(x, y), "range": 4.0, "intensity": 1.0, "color": "ffffb45a", "shadows": True} for x, y in TORCHES],
        "image": base64.b64encode(buf.getvalue()).decode("ascii"),
    }
    out = os.path.join(OUT, "demo-crypt.dd2vtt")
    with open(out, "w") as f:
        json.dump(data, f)
    print(out, os.path.getsize(out) // 1024, "KB,", len(walls), "walls,", len(DOORS), "doors,", len(TORCHES), "lights")


if __name__ == "__main__":
    main()
