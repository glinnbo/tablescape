"""Turn a Midjourney tree sheet (top-down crowns, small to big, on black) into a Tablescape tree variant.

usage:
  python3 cut_tree_sheet.py <sheet.png> <out_dir> --id <variant_id> --label "<Label>" [options]

needs:  pip install numpy scipy pillow scikit-image

options:
  --retouch 7,8        cover trunk/branch wood and big dark gaps inside these layers (top layers)
  --trim-wood 0,1      cut away wood that sticks out of the crown in these layers (e.g. a trunk poking out)
  --keep-gaps          do NOT fill gaps inside crowns (bare trees, palms, ferns: the gaps are the look);
                       the stacking centre is then the trunk/heart (densest point), not the centre of mass
  --gap-floor 30       with --keep-gaps: drop dim haze around branches (bare trees 30; palms/ferns keep 14)
  --center trunk       stacking point: mass (default), outline (default with --keep-gaps; palms, ferns),
                       trunk (bare trees: the thickest wood)
  --rel-sizes 1,.85,.4 size of each layer (longer side) as a fraction of the biggest picked crown;
                       default: the sizes the crowns have on the sheet
  --keep-order         stack the layers in --pick order (bottom first) instead of biggest first, e.g. a
                       palm whose widest crown sits near the top; set "footprintLayer" in tree.json then
  --max-size 1100      scale all layers so layer0's longer side is at most this (relative sizes are kept)
  --split S:R:K        crown R (by size, 0 = biggest) of sheet S touches others: split it into K crowns
  --extra-sheet b.png  more sheets to take crowns from (sheet 1, 2, ...; the main sheet is sheet 0)
  --pick 0:0,1:2,...   use only these crowns (sheet:rank after splitting); default = all crowns of sheet 0
  --squares 4,3,2      how many 5-ft squares large/medium/small span when placed (optional)

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


def find_crowns(m, splits):
    """Crown masks of one sheet, biggest first. splits: {rank: k} crowns that touch others, split by watershed."""
    mask = ndi.binary_opening(ndi.binary_closing(m > 22, iterations=6), iterations=2)
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    ranked = sorted([i + 1 for i, s in enumerate(sizes) if s > 5000], key=lambda k: -sizes[k - 1])
    crowns = []
    for r, k in enumerate(ranked):
        comp = lab == k
        if r in splits:
            from skimage.segmentation import watershed
            K = splits[r]
            # markers: erode until the shape falls apart into K big pieces (touching crowns are joined
            # by thin bridges), then grow the pieces back along the valleys of the blurred shape
            markers = None
            for it in range(4, 200, 4):
                er = ndi.binary_erosion(comp, iterations=it)
                el, en = ndi.label(er)
                if en >= K:
                    es = ndi.sum(er, el, range(1, en + 1))
                    big = sorted(range(en), key=lambda i: -es[i])[:K]
                    if es[big[-1]] > 0.02 * comp.sum():
                        markers = np.zeros(comp.shape, int)
                        for j, i in enumerate(big): markers[el == i + 1] = j + 1
                        break
                if not er.any(): break
            if markers is None:
                raise SystemExit(f'could not split crown {r} into {K}')
            blur = ndi.gaussian_filter(comp.astype(np.float32), 6)
            ws = watershed(-blur, markers, mask=comp)
            crowns += [ws == i + 1 for i in range(K)]
            print(f'  split crown {r} into {K} (erosion {it})')
        else:
            crowns.append(comp)
    crowns.sort(key=lambda c: -c.sum())
    return crowns


def sheet_fields(im):
    m = im.max(2)
    a0 = np.clip((m - 6) / (45 - 6), 0, 1)                        # alpha from brightness (black background)
    ref = ndi.gaussian_filter(ndi.maximum_filter(m, 15), 4)       # local leaf brightness
    a0e = np.clip(m / np.maximum(ref * 0.8, 30), 0, 1) * np.clip((m - 14) / 26, 0, 1)
    wsum = ndi.gaussian_filter(a0, 8) + 1e-4                      # local leaf colour -> paints dark gaps as shade
    shade = np.dstack([ndi.gaussian_filter(im[..., c] * a0, 8) / wsum for c in range(3)]) * 0.42
    return m, a0, a0e, shade


def cut_crown(im, fields, crown, others, keep_gaps, gap_floor=14):
    """Cut one crown out of its sheet: straight-alpha RGB + alpha, cropped with padding."""
    m, a0, a0e, shade = fields
    comp = ndi.binary_dilation(crown, iterations=12)
    if keep_gaps:
        # gaps stay open; only close tiny pores inside thick wood / fronds so they don't flicker
        thick = ndi.binary_opening(m > gap_floor + 15, iterations=2) & comp   # real branches/fronds, not dim haze
        holes = ndi.binary_fill_holes(thick) & ~thick
        hl, hn = ndi.label(holes)
        if hn:
            hs = ndi.sum(holes, hl, range(1, hn + 1))
            thick |= np.isin(hl, [i + 1 for i, v in enumerate(hs) if v < 120])
        inner = ndi.gaussian_filter(ndi.binary_erosion(thick, iterations=1).astype(np.float32), 0.8)
        rgb_in = im + (1 - a0)[..., None] * shade
    else:
        small = ndi.binary_fill_holes(ndi.binary_closing(crown, iterations=8))
        big = ndi.binary_fill_holes(ndi.binary_closing(crown, iterations=45))
        deep = ndi.binary_erosion(big, iterations=30)             # cracks deep inside get filled, edge notches stay
        filled = ndi.binary_erosion(small | deep, iterations=14)  # stop short of the edge -> soft, light outline
        comp = comp | small | deep
        inner = ndi.gaussian_filter(filled.astype(np.float32), 4)
        rgb_in = im + (1 - a0)[..., None] * shade
    comp &= ~others                                               # never take pixels of a neighbouring crown
    if keep_gaps and gap_floor != 14:                             # higher noise floor: drop the render's dark haze
        a0e = np.clip(m / np.maximum(ndi.gaussian_filter(ndi.maximum_filter(m, 15), 4) * 0.8, 30), 0, 1) \
              * np.clip((m - gap_floor) / 30, 0, 1)
    w = np.clip(inner, 0, 1)[..., None]
    a = ndi.gaussian_filter(np.maximum(a0e, inner) * comp, 0.6)
    rgb_edge = im / np.maximum(a0e, 0.3)[..., None]
    rgb = np.clip(rgb_in * w + rgb_edge * (1 - w), 0, 255)
    ys, xs = np.where(a > 0.01)
    pad = 16
    y0, y1 = max(ys.min() - pad, 0), ys.max() + pad
    x0, x1 = max(xs.min() - pad, 0), xs.max() + pad
    return rgb[y0:y1, x0:x1].copy(), a[y0:y1, x0:x1].copy()


def trim_wood(rgb, a):
    """Remove wood that sticks out of the leaf mass (a trunk or branch poking out of the crown)."""
    h, s, v = rgb_to_hsv(rgb / 255.0)
    solid = a > 0.6
    lit = solid & (v >= np.median(v[solid]))                                  # leaves/blossoms are the brighter half
    med_h = np.median(h[lit]); hdist = np.abs((h - med_h + 180) % 360 - 180)
    hue_tol = max(18.0, 2.5 * np.median(hdist[lit]))
    wood = (a > 0.3) & (hdist > hue_tol) & (s > 0.12)
    wood = ndi.binary_closing(wood, iterations=2)
    leaves = solid & ~wood
    mass = ndi.binary_fill_holes(ndi.binary_closing(leaves, iterations=4))
    edge = (a > 0.3) & ~ndi.binary_erosion(a > 0.3, iterations=4)          # band along the outline
    wl, wn = ndi.label(wood)
    touching = np.unique(wl[edge & wood]); touching = touching[touching > 0]
    cut = np.isin(wl, touching) & ~mass                                     # wood reaching the outline, outside the leaves
    cut = ndi.binary_dilation(cut, iterations=2) & ~mass
    keep = 1 - ndi.gaussian_filter(cut.astype(np.float32), 1.2)
    a = a * np.clip(keep, 0, 1)
    # drop faint leftovers of the cut wood that no longer touch the crown
    body = ndi.binary_dilation(a > 0.5, iterations=6)
    bl, bn = ndi.label(a > 0.02)
    if bn > 1:
        keep_ids = np.unique(bl[body & (bl > 0)])
        a = np.where(np.isin(bl, keep_ids), a, 0)
    return a, int(cut.sum())


def stack_centre(a, how, rgb=None):
    """Point all layers are stacked on. mass: centre of mass; outline: centre of the filled outline
    (radial plants: palms, ferns); trunk: thickest wood (bare trees: the trunk is the thickest part)."""
    if how == 'trunk':
        wood = a > 0.7
        if rgb is not None:                                        # bark is grey/brown, not saturated like foliage/twig clumps
            _, sat, _ = rgb_to_hsv(rgb / 255.0)
            grey = wood & (sat < 0.35)
            if grey.sum() > 0.05 * wood.sum(): wood = grey
        wood = ndi.binary_opening(wood, iterations=2)
        dt = ndi.gaussian_filter(ndi.distance_transform_edt(wood), 0.02 * max(a.shape))
        oy, ox = ndi.center_of_mass(ndi.binary_fill_holes(ndi.binary_closing(a > 0.3, iterations=10)))
        yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        r2 = ((yy - oy) ** 2 + (xx - ox) ** 2) / (0.3 * max(a.shape)) ** 2
        dt = dt * np.exp(-r2)                                      # a trunk sits near the middle, not at the rim
        cy, cx = np.unravel_index(np.argmax(dt), dt.shape)
        return float(cy), float(cx)
    if how == 'outline':
        return ndi.center_of_mass(ndi.binary_fill_holes(ndi.binary_closing(a > 0.3, iterations=10)))
    return ndi.center_of_mass(a)


def resize_rgba(rgb, a, s):
    """Scale straight-alpha RGBA via premultiplied colour (no dark fringes)."""
    H, W = a.shape; nw, nh = max(1, round(W * s)), max(1, round(H * s))
    pm = np.dstack([rgb * a[..., None], a * 255]).clip(0, 255).astype(np.uint8)
    r = np.asarray(Image.fromarray(pm, 'RGBA').resize((nw, nh), Image.LANCZOS)).astype(np.float32)
    na = r[..., 3] / 255
    nrgb = np.where(na[..., None] > 1e-3, r[..., :3] / np.maximum(na, 1e-3)[..., None], 0)
    return np.clip(nrgb, 0, 255), na


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet'); ap.add_argument('out')
    ap.add_argument('--id', required=True); ap.add_argument('--label', required=True)
    ap.add_argument('--retouch', default='', help='comma-separated layer indices (0 = biggest)')
    ap.add_argument('--trim-wood', default='', help='comma-separated layer indices')
    ap.add_argument('--keep-gaps', action='store_true')
    ap.add_argument('--gap-floor', type=int, default=14, help='with --keep-gaps: brightness below which pixels drop out (30 for bare trees)')
    ap.add_argument('--max-size', type=int, default=0)
    ap.add_argument('--rel-sizes', default='', help='e.g. 1,0.85,0.4')
    ap.add_argument('--keep-order', action='store_true')
    ap.add_argument('--split', action='append', default=[], help='S:R:K')
    ap.add_argument('--extra-sheet', action='append', default=[])
    ap.add_argument('--pick', default='', help='sheet:rank,...')
    ap.add_argument('--squares', default='', help='e.g. 4,3,2 for large,medium,small')
    ap.add_argument('--quality', type=int, default=90)
    ap.add_argument('--center', default='', help='mass | outline | trunk (default: mass, or outline with --keep-gaps)')
    args = ap.parse_args()
    idx = lambda t: {int(x) for x in t.split(',') if x.strip()}
    retouch_layers, trim_layers = idx(args.retouch), idx(args.trim_wood)
    os.makedirs(args.out, exist_ok=True)

    sheets = [args.sheet] + args.extra_sheet
    splits = {}
    for sp in args.split:
        S, R, K = (int(x) for x in sp.split(':')); splits.setdefault(S, {})[R] = K
    data = []
    for si, path in enumerate(sheets):
        im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
        fields = sheet_fields(im)
        crowns = find_crowns(fields[0], splits.get(si, {}))
        allm = np.zeros(im.shape[:2], bool)
        for c in crowns: allm |= c
        data.append((im, fields, crowns, allm))
    picks = ([tuple(int(v) for v in p.split(':')) for p in args.pick.split(',') if p.strip()]
             or [(0, r) for r in range(len(data[0][2]))])

    cuts = []
    for si, r in picks:
        im, fields, crowns, allm = data[si]
        rgb, a = cut_crown(im, fields, crowns[r], allm & ~crowns[r], args.keep_gaps, args.gap_floor)
        cuts.append([rgb, a, f'{si}:{r}'])
    footprint = lambda a: ndi.binary_fill_holes(ndi.binary_closing(a > 0.3, iterations=10)).sum()
    if not args.keep_order:
        cuts.sort(key=lambda c: -footprint(c[1]))                 # layer0 = biggest outline
    biggest = max(max(c[1].shape) for c in cuts)
    s = 1.0
    if args.max_size:
        s = min(1.0, args.max_size / biggest)

    rel = [float(x) for x in args.rel_sizes.split(',') if x.strip()]
    if rel and len(rel) != len(cuts): raise SystemExit('--rel-sizes needs one value per layer')
    base_side = biggest
    meta = []
    for li, (rgb, a, src) in enumerate(cuts):
        cy, cx = stack_centre(a, args.center or ('outline' if args.keep_gaps else 'mass'), rgb)
        if li in retouch_layers:
            rgb, cov = retouch(rgb, a, cy, cx)
            print(f'  retouched layer{li}: {cov:.0%} of wood/gap pixels covered')
        if li in trim_layers:                                       # after retouch: interior wood is covered by then
            a, n = trim_wood(rgb, a); print(f'  layer{li}: trimmed {n} px of protruding wood')
        sl = s
        if rel:                                                     # explicit size relative to layer0
            sl = rel[li] * base_side * s / max(a.shape)
        if abs(sl - 1.0) > 1e-3:
            rgb, a = resize_rgba(rgb, a, sl); cy, cx = cy * sl, cx * sl
        yy, xx = np.nonzero(a > 0.05)
        radius = float(np.sqrt(((yy - cy) ** 2 + (xx - cx) ** 2).max()))
        rgba = np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8)
        name = f'layer{li}.webp'
        Image.fromarray(rgba, 'RGBA').save(f'{args.out}/{name}', quality=args.quality, method=6)
        meta.append(dict(file=name, w=int(a.shape[1]), h=int(a.shape[0]),
                         cx=round(float(cx), 1), cy=round(float(cy), 1), radius=round(radius, 1)))
        print(f'  layer{li} <- crown {src}  {a.shape[1]}x{a.shape[0]}')

    nl = len(meta)
    bases = [0, 2, 4] if nl >= 8 else [0, 1, 2] if nl >= 5 else [0, 1] if nl == 4 else [0]
    sizes_p = [{"id": sid, "base": b} for sid, b in zip(['large', 'medium', 'small'], bases)]
    if args.squares:
        for sp, q in zip(sizes_p, args.squares.split(',')): sp['squares'] = float(q)
    tj = f'{args.out}/tree.json'
    if os.path.exists(tj):
        tree = json.load(open(tj))
        if len(tree.get('layers', [])) != nl or args.squares: tree['sizes'] = sizes_p
        tree.update(id=args.id, label=args.label, layers=meta)
        for k, v in DEFAULTS.items(): tree.setdefault(k, v)
    else:
        tree = {"id": args.id, "label": args.label, "layers": meta, "sizes": sizes_p, **DEFAULTS}
    json.dump(tree, open(tj, 'w'), indent=1)
    kb = sum(os.path.getsize(f'{args.out}/{m_["file"]}') for m_ in meta) / 1024
    print(args.out, nl, 'layers', [max(m_['w'], m_['h']) for m_ in meta], f'{kb:.0f} KB')


if __name__ == '__main__':
    main()
