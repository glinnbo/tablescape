"""Turn a Midjourney tree sheet (top-down crowns, small to big, on black) into a Tablescape tree variant.

usage:
  python3 cut_tree_sheet.py <sheet.png> <out_dir> --id <variant_id> --label "<Label>" [--retouch 7,8]

needs:  pip install numpy scipy pillow

- Writes layer0.webp (biggest = bottom) ... layerN.webp and tree.json.
- If <out_dir>/tree.json already exists, its settings (wind tuning, variation, ...) are kept and only
  the layer list (and size presets, if the layer count changed) is replaced.
  New variants start with the default (oak) settings.
- Every layer gets a solid interior (dark gaps filled with shaded leaf colour), so any layer can be the
  base of a smaller tree.
- --retouch <layer indices>: covers visible trunk/branch wood and big dark gaps inside those layers with
  leaves taken from a rotated copy of the same crown (use it for the top layers, which nothing covers).
  Not for trees whose look *is* bare branches (e.g. frost_blue).
"""
import sys, json, os, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

DEFAULTS = {
 "sway":     {"topAmplitude":0.014,"period":3.6,"lag":0.55,"cross":0.28,"twist":0.010},
 "branches": {"layerTurn":0.012,"period":5.2,"sectorTurn":0.032,"lobes":1.7,"speed":0.22},
 "rustle":   {"amount":0.00355,"scale":0.012,"speed":0.55,"light":0.07},
 "lean":     {"top":0.425,"curve":1.6,"ease":1.4,"period":2.3,"periodTop":1.35,"damping":0.34,"dampingStorm":0.16,
              "gustVar":0.35,"gustVarWind":0.6,"gustRate":0.33,"maxBend":0.6},
 "shadow":   {"layerOffset":0.010,"groundOffset":0.055,"blur":0.022,"layerAlpha":0.5,"groundAlpha":0.55},
 "variation":{"rotation":180,"mirror":True,"scale":0.05,"offset":0.03,
              "hue":5,"saturation":0.08,"brightness":0.06,"layerHue":2,"layerBrightness":0.03,
              "heightLight":0.08,"heightWarm":0.04,"patchHue":4,"patchBrightness":0.04,"swap":[]},
}


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    v = mx
    s = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, s, v


def retouch(rgb, a, cy, cx):
    """Cover wood / big dark gaps inside the crown with leaves from a rotated copy of the same crown."""
    h, s, v = rgb_to_hsv(rgb / 255.0)
    solid = a > 0.9
    dist = ndi.distance_transform_edt(solid)
    interior = dist > max(6, 0.06 * dist.max())
    med_v, med_s, med_h = np.median(v[solid]), np.median(s[solid]), np.median(h[solid])
    hdist = np.abs((h - med_h + 180) % 360 - 180)
    hue_tol = max(18.0, 2.5 * np.median(hdist[solid]))               # adapts to how varied the leaf colours are
    bad = interior & ((v < 0.6 * med_v) | (s < 0.55 * med_s) | ((hdist > hue_tol) & (s > 0.12)))
    bad = ndi.binary_opening(bad, iterations=2)
    lab, n = ndi.label(bad)
    if n:
        sizes = ndi.sum(bad, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz > 0.002 * solid.sum()])
        bad = ndi.binary_dilation(keep, iterations=3) & solid
    if not bad.any():
        return rgb, 0.0
    good = solid & ~ndi.binary_dilation(bad, iterations=2)
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W]
    out = rgb.copy(); todo = bad.copy(); filled = np.zeros_like(bad)
    cands = []
    R = dist.max()
    # candidate sources: the crown rotated (and mirrored) around a point next to the centre, so the
    # centre itself also gets fresh leaves (a rotation around the exact centre maps it onto itself)
    for mirror in (False, True):
        for ang in range(30, 331, 30):
            for sh in (0.0, 0.35, 0.6):
                t = np.deg2rad(ang); c, s_ = np.cos(t), np.sin(t)
                px, py = cx + sh * R * np.cos(t * 1.7), cy + sh * R * np.sin(t * 1.7)
                dx, dy = xx - px, yy - py
                if mirror: dx = -dx
                sx, sy = px + c * dx - s_ * dy, py + s_ * dx + c * dy   # source pixel for every target pixel
                ok = good[np.clip(sy.round().astype(int), 0, H - 1), np.clip(sx.round().astype(int), 0, W - 1)]
                ok &= (sx >= 0) & (sy >= 0) & (sx < W) & (sy < H)
                cands.append(((ok & bad).sum(), sx, sy, ok))
    cands.sort(key=lambda c: -c[0])
    for score, sx, sy, ok in cands:                                    # best angles first
        use = todo & ok
        if not use.any(): continue
        src = np.stack([ndi.map_coordinates(rgb[..., ch], [sy[use], sx[use]], order=1) for ch in range(3)], -1)
        out[use] = src; filled |= use; todo &= ~use
        if not todo.any(): break
    if todo.any():                                                     # leftovers: copy the nearest clean leaf pixel
        src_ok = ((good | filled) & ~todo).astype(np.float32)
        wsum = ndi.gaussian_filter(src_ok, 4) + 1e-4
        for ch in range(3):
            out[..., ch][todo] = (ndi.gaussian_filter(out[..., ch] * src_ok, 4) / wsum)[todo]
        filled |= todo
    w = ndi.gaussian_filter(filled.astype(np.float32), 1.5)[..., None]  # feather the seam
    out = rgb * (1 - w) + out * w
    return out, float((filled & bad).sum() / max(bad.sum(), 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet'); ap.add_argument('out')
    ap.add_argument('--id', required=True); ap.add_argument('--label', required=True)
    ap.add_argument('--retouch', default='', help='comma-separated layer indices (0 = biggest)')
    args = ap.parse_args()
    retouch_layers = {int(x) for x in args.retouch.split(',') if x.strip()}
    os.makedirs(args.out, exist_ok=True)

    im = np.asarray(Image.open(args.sheet).convert('RGB')).astype(np.float32)
    m = im.max(2)
    mask = ndi.binary_opening(ndi.binary_closing(m > 22, iterations=6), iterations=2)
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    crowns = sorted([i + 1 for i, s in enumerate(sizes) if s > 5000], key=lambda k: -sizes[k - 1])

    a0 = np.clip((m - 6) / (45 - 6), 0, 1)                        # alpha from brightness (black background)
    ref = ndi.gaussian_filter(ndi.maximum_filter(m, 15), 4)       # local leaf brightness
    a0e = np.clip(m / np.maximum(ref * 0.8, 30), 0, 1) * np.clip((m - 14) / 26, 0, 1)
    wsum = ndi.gaussian_filter(a0, 8) + 1e-4                      # local leaf colour -> paints dark gaps as shade
    shade = np.dstack([ndi.gaussian_filter(im[..., c] * a0, 8) / wsum for c in range(3)]) * 0.42

    meta = []
    for li, k in enumerate(crowns):
        crown = lab == k
        comp = ndi.binary_dilation(crown, iterations=12)
        small = ndi.binary_fill_holes(ndi.binary_closing(crown, iterations=8))
        big = ndi.binary_fill_holes(ndi.binary_closing(crown, iterations=45))
        deep = ndi.binary_erosion(big, iterations=30)              # cracks deep inside get filled, edge notches stay
        filled = ndi.binary_erosion(small | deep, iterations=14)   # stop short of the edge -> soft, light outline
        comp = comp | small | deep
        inner = ndi.gaussian_filter(filled.astype(np.float32), 4)
        rgb_in = im + (1 - a0)[..., None] * shade
        w = np.clip(inner, 0, 1)[..., None]
        a = ndi.gaussian_filter(np.maximum(a0e, inner) * comp, 0.6)
        rgb_edge = im / np.maximum(a0e, 0.3)[..., None]
        rgb = np.clip(rgb_in * w + rgb_edge * (1 - w), 0, 255)
        ys, xs = np.where(a > 0.01)
        pad = 16
        y0, y1 = max(ys.min() - pad, 0), ys.max() + pad
        x0, x1 = max(xs.min() - pad, 0), xs.max() + pad
        crop_a = a[y0:y1, x0:x1]; crop_rgb = rgb[y0:y1, x0:x1]
        cy, cx = ndi.center_of_mass(crop_a)
        if li in retouch_layers:
            crop_rgb, cov = retouch(crop_rgb, crop_a, cy, cx)
            print(f'  retouched layer{li}: {cov:.0%} of wood/gap pixels covered')
        yy, xx = np.nonzero(crop_a > 0.05)
        radius = float(np.sqrt(((yy - cy) ** 2 + (xx - cx) ** 2).max()))
        rgba = np.dstack([crop_rgb, crop_a * 255]).clip(0, 255).astype(np.uint8)
        name = f'layer{li}.webp'
        Image.fromarray(rgba, 'RGBA').save(f'{args.out}/{name}', quality=90, method=6)
        meta.append(dict(file=name, w=int(x1 - x0), h=int(y1 - y0),
                         cx=round(float(cx), 1), cy=round(float(cy), 1), radius=round(radius, 1)))

    nl = len(meta)
    sizes_p = ([{"id":"large","base":0},{"id":"medium","base":2},{"id":"small","base":4}] if nl >= 8 else
               [{"id":"large","base":0},{"id":"medium","base":1},{"id":"small","base":2}] if nl >= 5 else
               [{"id":"large","base":0}])
    tj = f'{args.out}/tree.json'
    if os.path.exists(tj):
        tree = json.load(open(tj))
        if len(tree.get('layers', [])) != nl: tree['sizes'] = sizes_p
        tree.update(id=args.id, label=args.label, layers=meta)
        for k, v in DEFAULTS.items(): tree.setdefault(k, v)
    else:
        tree = {"id": args.id, "label": args.label, "layers": meta, "sizes": sizes_p, **DEFAULTS}
    json.dump(tree, open(tj, 'w'), indent=1)
    print(args.out, nl, 'layers', [m_['w'] for m_ in meta])


if __name__ == '__main__':
    main()
