#!/usr/bin/env python3
"""Generate the small demo pack shipped with test builds.

Everything is procedural, so there are no licensing questions:
  demo-dungeon.png               static map (1920x1080, gridless)
  demo-dungeon-torchlight.mp4    the same map with flickering torches and water (seamless 4 s loop)
  embers-alpha.webm              transparent VP9 overlay, rising embers (seamless 6 s loop)
  dust-alpha.webm                transparent VP9 overlay, drifting dust motes (seamless 6 s loop)
  token-*.png                    round tokens with transparent background
  cave-drone.ogg                 low ambient loop

Usage: python3 scripts/make_demo_assets.py <output dir>
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "demo"
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
W, H = 1920, 1080
CELL = 54  # map drawn on a 54 px square rhythm (not shown) so the app grid can be aligned to it

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"


def ffmpeg(args, frames=None):
    p = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], stdin=subprocess.PIPE)
    if frames is not None:
        for f in frames:
            p.stdin.write(f.tobytes())
        p.stdin.close()
    if p.wait() != 0:
        raise SystemExit(f"ffmpeg failed: {args}")


def value_noise(h, w, scale, seed):
    r = np.random.default_rng(seed)
    gh, gw = h // scale + 2, w // scale + 2
    g = r.random((gh, gw)).astype(np.float32)
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((gw * scale, gh * scale), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)[:h, :w] / 255.0


# ---------------------------------------------------------------- static map
def make_map():
    rock = 0.55 * value_noise(H, W, 64, 1) + 0.3 * value_noise(H, W, 16, 2) + 0.15 * value_noise(H, W, 4, 3)
    img = np.stack([22 + 26 * rock, 21 + 23 * rock, 20 + 20 * rock], -1)

    rooms = [  # (x, y, w, h) in cells
        (2, 2, 8, 6), (14, 1, 10, 7), (27, 2, 7, 9), (4, 11, 9, 7), (17, 11, 9, 7), (28, 13, 6, 5),
    ]
    corridors = [
        (10, 4, 4, 2), (24, 4, 3, 2), (6, 8, 2, 3), (13, 13, 4, 2), (20, 8, 2, 3), (26, 14, 2, 2), (30, 11, 2, 2),
    ]
    floor_mask = np.zeros((H, W), bool)
    for x, y, w, h in rooms + corridors:
        floor_mask[y * CELL:(y + h) * CELL, x * CELL:(x + w) * CELL] = True

    # flagstones: per-tile tint + fine grain + joints
    yy, xx = np.mgrid[0:H, 0:W]
    tile = (rng.random((H // CELL + 1, W // CELL + 1)) * 0.25).astype(np.float32)
    tint = tile[yy // CELL, xx // CELL]
    grain = value_noise(H, W, 3, 5) * 0.18 + value_noise(H, W, 24, 6) * 0.2
    base = 0.62 + tint + grain - 0.2
    joints = ((xx % CELL) < 2) | ((yy % CELL) < 2)
    base = np.where(joints, base * 0.55, base)
    floor = np.stack([118 * base, 108 * base, 94 * base], -1)
    img = np.where(floor_mask[..., None], floor, img)

    # walls: dark rim around floor areas
    fm = Image.fromarray((floor_mask * 255).astype(np.uint8))
    grown = np.asarray(fm.filter(ImageFilter.MaxFilter(17))) > 0
    wall = grown & ~floor_mask
    img = np.where(wall[..., None], np.array([48, 44, 40], np.float32) * (0.8 + 0.4 * rock[..., None]), img)

    # pool in the bottom-middle room
    pool = ((xx - 21.5 * CELL) / (3.2 * CELL)) ** 2 + ((yy - 14.5 * CELL) / (2.2 * CELL)) ** 2 < 1
    img = np.where(pool[..., None], np.array([28, 58, 70], np.float32) * (0.85 + 0.3 * value_noise(H, W, 12, 9)[..., None]), img)

    # soft ambient occlusion along walls
    near = np.asarray(Image.fromarray((wall * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)), np.float32) / 255
    img = img * (1 - 0.45 * near[..., None] * floor_mask[..., None])

    torches = [(3, 2), (9, 2), (15, 1), (23, 1), (27, 4), (5, 11), (12, 11), (17, 11), (25, 11), (33, 13)]
    torches = [((x + 0.5) * CELL, (y + 0.15) * CELL) for x, y in torches]
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    for tx, ty in torches:
        d.ellipse([tx - 7, ty - 7, tx + 7, ty + 7], fill=(60, 40, 22), outline=(25, 18, 12), width=2)
    # a few props: table and crates
    d.rectangle([16 * CELL + 10, 3 * CELL + 10, 19 * CELL - 10, 5 * CELL - 10], fill=(92, 62, 38), outline=(40, 26, 16), width=4)
    for cx, cy in [(29, 8), (30, 8), (29, 9)]:
        d.rectangle([cx * CELL + 6, cy * CELL + 6, (cx + 1) * CELL - 6, (cy + 1) * CELL - 6], fill=(110, 80, 48), outline=(52, 36, 22), width=3)
        d.line([cx * CELL + 6, cy * CELL + 6, (cx + 1) * CELL - 6, (cy + 1) * CELL - 6], fill=(70, 50, 30), width=3)
    pil.save(os.path.join(OUT, "demo-dungeon.png"), optimize=True)
    return np.asarray(pil, np.float32), torches, pool, floor_mask


# ------------------------------------------------------- animated torchlight map
def make_animated(base, torches, pool, floor_mask):
    fps, secs = 24, 4
    n = fps * secs
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    glows = []
    for tx, ty in torches:
        d2 = (xx - tx) ** 2 + (yy - ty) ** 2
        glows.append(np.exp(-d2 / (2 * (2.6 * CELL) ** 2)).astype(np.float32))
    phases = rng.random((len(torches), 3)) * 2 * np.pi
    shimmer_a = value_noise(H, W, 10, 21)
    shimmer_b = value_noise(H, W, 10, 22)
    warm = np.array([1.0, 0.62, 0.28], np.float32)

    def frames():
        for i in range(n):
            t = i / n  # 0..1, loop-periodic
            light = np.zeros((H, W), np.float32)
            for k, g in enumerate(glows):
                p = phases[k]
                flick = 0.75 + 0.12 * math.sin(2 * math.pi * 3 * t + p[0]) + 0.08 * math.sin(2 * math.pi * 7 * t + p[1]) + 0.05 * math.sin(2 * math.pi * 13 * t + p[2])
                light += g * flick
            img = base * (0.6 + 0.55 * light[..., None]) + light[..., None] * warm * 30 * floor_mask[..., None]
            w = 0.5 + 0.5 * math.sin(2 * math.pi * t)
            sh = (shimmer_a * w + shimmer_b * (1 - w))
            img = np.where(pool[..., None], img + (sh[..., None] - 0.5) * np.array([10, 30, 38], np.float32), img)
            yield np.clip(img, 0, 255).astype(np.uint8)

    ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
            "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
            "-g", str(fps * secs), "-movflags", "+faststart", os.path.join(OUT, "demo-dungeon-torchlight.mp4")], frames())


# ------------------------------------------------------------ alpha overlays
def sprite(radius):
    half = int(math.ceil(radius * 3))
    r = np.arange(-half, half + 1, dtype=np.float32)
    g = np.exp(-(r[:, None] ** 2 + r[None, :] ** 2) / (2 * radius ** 2))
    return g


def render_particles(path, w, h, fps, secs, count, color, size_range, speed_cycles, drift, alpha_gain, seed):
    r = np.random.default_rng(seed)
    n = fps * secs
    x0 = r.random(count) * w
    y0 = r.random(count) * h
    cyc = r.choice(speed_cycles, count)  # how many times a particle crosses the screen per loop
    wob = r.random(count) * 30 + 8
    wph = r.random(count) * 2 * np.pi
    flick = r.random(count) * 2 * np.pi
    sizes = r.uniform(*size_range, count)
    sprites = {s: sprite(s) for s in sorted(set(np.round(sizes, 1)))}
    col = np.array(color, np.float32)

    def frames():
        for i in range(n):
            t = i / n
            acc = np.zeros((h + 200, w + 200), np.float32)
            if drift == "up":
                ys = (y0 - cyc * h * t) % h
                xs = x0 + wob * np.sin(2 * np.pi * t * 2 + wph)
            else:
                xs = (x0 + cyc * w * t) % w
                ys = y0 + wob * np.sin(2 * np.pi * t + wph)
            br = 0.65 + 0.35 * np.sin(2 * np.pi * t * 4 + flick)
            for k in range(count):
                s = sprites[round(float(sizes[k]), 1)]
                hs = s.shape[0] // 2
                cx, cy = int(xs[k]) + 100, int(ys[k]) + 100
                acc[cy - hs:cy + hs + 1, cx - hs:cx + hs + 1] += s * br[k]
            acc = acc[100:100 + h, 100:100 + w]
            a = np.clip(acc * alpha_gain, 0, 1)
            hot = np.clip(acc - 0.6, 0, 1)[..., None]
            rgb = np.clip(col * (1 - hot) + 255 * hot, 0, 255)
            yield np.dstack([rgb, a[..., None] * 255]).astype(np.uint8)

    ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-row-mt", "1",
            "-deadline", "good", "-cpu-used", "4", "-auto-alt-ref", "0", "-g", str(n), path], frames())


# ------------------------------------------------------------------- tokens
def make_token(name, letter, ring, fill):
    s = 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([16, 16, s - 16, s - 16], fill=(10, 10, 12, 255))
    d.ellipse([28, 28, s - 28, s - 28], fill=ring)
    d.ellipse([58, 58, s - 58, s - 58], fill=fill)
    font = ImageFont.truetype(FONT_BOLD, 230)
    d.text((s / 2, s / 2 + 8), letter, font=font, fill=(240, 232, 214, 255), anchor="mm", stroke_width=6, stroke_fill=(20, 16, 12, 255))
    img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, f"token-{name}.png"), optimize=True)


def make_audio():
    ffmpeg(["-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.6:duration=16:seed=3",
            "-f", "lavfi", "-i", "sine=frequency=55:duration=16",
            "-filter_complex", "[0]lowpass=f=380,volume=0.9[n];[1]volume=0.12[s];[n][s]amix=inputs=2:normalize=0,afade=t=in:d=0.02,afade=t=out:st=15.98:d=0.02",
            "-ac", "2", "-c:a", "libopus", "-b:a", "64k", os.path.join(OUT, "cave-drone.ogg")])


# ------------------------------------------------------------------- assets
# Top-down props with transparent background, drawn at 256 px per 5 ft square.
def _finish(rgb, alpha, shadow_px, name, size):
    """rgb float HxWx3 (0-1), alpha float HxW; adds a soft drop shadow and saves at half size."""
    h, w = alpha.shape
    sh = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(shadow_px * 0.6))
    sh = np.roll(np.roll(np.asarray(sh, np.float32) / 255, shadow_px, 0), shadow_px, 1) * 0.55
    a = alpha + sh * (1 - alpha)
    col = (rgb * alpha[..., None]) / np.maximum(a, 1e-6)[..., None]
    out = np.dstack([np.clip(col, 0, 1) * 255, a * 255]).astype(np.uint8)
    Image.fromarray(out, "RGBA").resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"asset-{name}.png"), optimize=True)


def _grid(n):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return x - n / 2, y - n / 2


def _blob_mask(n, r, wobble, lobes, seed):
    x, y = _grid(n)
    ang = np.arctan2(y, x)
    rr = np.hypot(x, y)
    rs = np.random.default_rng(seed)
    edge = r * (1 + sum(wobble / (k + 1) * np.sin((k + 1) * lobes * ang + rs.uniform(0, 6.28)) for k in range(3)))
    return np.clip((edge - rr) / 3, 0, 1), rr, x, y


def _shade(x, y, rr, r, light=0.35):
    # brighter towards the top left, darker at the rim
    return np.clip(1 - light * (x + y) / (2 * r) - 0.35 * (rr / r) ** 2, 0.25, 1.3)


def make_assets():
    n = 1024  # 2 squares, drawn at double size
    # oak: a lobed canopy of overlapping clumps
    rs = np.random.default_rng(21)
    alpha = np.zeros((n, n), np.float32); rgb = np.zeros((n, n, 3), np.float32)
    x, y = _grid(n)
    for i in range(16):
        a = rs.uniform(0, 6.28); d = rs.uniform(0, 260) if i else 0
        cx, cy, cr = np.cos(a) * d, np.sin(a) * d, rs.uniform(140, 210) if i else 260
        rr = np.hypot(x - cx, y - cy)
        m = np.clip((cr - rr) / 3, 0, 1)
        sh = _shade(x - cx, y - cy, rr, cr, 0.5)
        tone = np.array([0.16, 0.34, 0.12]) * (0.85 + 0.3 * rs.random())
        rgb = rgb * (1 - m[..., None]) + (tone * sh[..., None]) * m[..., None]
        alpha = np.maximum(alpha, m)
    leaf = value_noise(n, n, 9, 22)[..., None]
    rgb *= 0.75 + 0.5 * leaf
    _finish(rgb, alpha, 40, "oak", 512)
    # pine: layered star shapes, dark to light
    alpha = np.zeros((n, n), np.float32); rgb = np.zeros((n, n, 3), np.float32)
    ang = np.arctan2(y, x); rr = np.hypot(x, y)
    for k, (R, tone) in enumerate([(420, (0.08, 0.2, 0.12)), (330, (0.11, 0.27, 0.15)), (230, (0.14, 0.33, 0.18)), (130, (0.18, 0.4, 0.22))]):
        edge = R * (0.78 + 0.22 * np.abs(np.cos(ang * 6 + k * 0.5)) ** 0.6)
        m = np.clip((edge - rr) / 3, 0, 1)
        rgb = rgb * (1 - m[..., None]) + np.array(tone) * (0.9 - 0.25 * rr / R)[..., None] * m[..., None]
        alpha = np.maximum(alpha, m)
    rgb *= (0.8 + 0.4 * value_noise(n, n, 7, 23))[..., None]
    _finish(rgb, alpha, 40, "pine", 512)
    n = 512  # one square
    x, y = _grid(n)
    # boulder
    m, rr, x, y = _blob_mask(n, 190, 0.12, 2, 31)
    rgb = np.array([0.45, 0.44, 0.42]) * _shade(x, y, rr, 190, 0.6)[..., None] * (0.8 + 0.35 * value_noise(n, n, 11, 32))[..., None]
    _finish(rgb, m, 22, "boulder", 256)
    # bush
    m, rr, x, y = _blob_mask(n, 170, 0.18, 5, 41)
    rgb = np.array([0.2, 0.38, 0.14]) * _shade(x, y, rr, 170, 0.5)[..., None] * (0.7 + 0.6 * value_noise(n, n, 6, 42))[..., None]
    _finish(rgb, m, 18, "bush", 256)
    # barrel: wooden lid with two iron rings
    x, y = _grid(n); rr = np.hypot(x, y)
    m = np.clip((180 - rr) / 2, 0, 1)
    planks = 0.85 + 0.15 * np.sin(x / 18) ** 2 + 0.1 * value_noise(n, n, 5, 51)
    rgb = np.array([0.48, 0.3, 0.16]) * planks[..., None]
    for r0 in (176, 150):
        ring = np.clip(1 - np.abs(rr - r0) / 7, 0, 1)
        rgb = rgb * (1 - ring[..., None]) + np.array([0.22, 0.22, 0.24]) * ring[..., None]
    rgb *= _shade(x, y, rr, 180, 0.3)[..., None]
    _finish(rgb, m, 16, "barrel", 256)
    # crate: planks, frame and a diagonal brace
    ax, ay = np.abs(x), np.abs(y)
    m = np.clip((190 - np.maximum(ax, ay)) / 2, 0, 1)
    grain = 0.85 + 0.12 * np.sin(y / 3 + value_noise(n, n, 20, 61) * 6)
    plank = 0.92 + 0.08 * np.sign(np.sin(x / 30))
    rgb = np.array([0.6, 0.42, 0.24]) * (grain * plank)[..., None]
    frame = ((np.maximum(ax, ay) > 160) | (np.abs(x - y) < 16)).astype(np.float32)
    rgb = rgb * (1 - 0.3 * frame[..., None])
    _finish(rgb, m, 16, "crate", 256)
    # round table
    m = np.clip((220 - rr) / 2, 0, 1)
    rgb = np.array([0.42, 0.27, 0.15]) * (0.85 + 0.1 * np.sin(x / 5 + value_noise(n, n, 30, 71) * 8))[..., None]
    rim = np.clip(1 - np.abs(rr - 210) / 10, 0, 1)
    rgb = rgb * (1 - 0.35 * rim[..., None]) * _shade(x, y, rr, 220, 0.25)[..., None]
    _finish(rgb, m, 18, "table", 256)
    # broken pillar: round column with a jagged break and rubble
    m, rr, x, y = _blob_mask(n, 150, 0.05, 7, 81)
    rubble = np.zeros_like(m)
    rs = np.random.default_rng(82)
    for _ in range(9):
        a = rs.uniform(0, 6.28); d = rs.uniform(170, 220); cr = rs.uniform(14, 30)
        rubble = np.maximum(rubble, np.clip((cr - np.hypot(x - np.cos(a) * d, y - np.sin(a) * d)) / 2, 0, 1))
    alpha = np.maximum(m, rubble)
    stone = (0.8 + 0.3 * value_noise(n, n, 9, 83))
    rings = 0.92 + 0.08 * np.cos(rr / 12)
    shade = np.where(rubble > m, 0.7, _shade(x, y, rr, 150, 0.5))
    rgb = np.array([0.62, 0.6, 0.55]) * (stone * rings * shade)[..., None]
    _finish(rgb, alpha, 20, "pillar", 256)


if __name__ == "__main__":
    if "--assets" in sys.argv:  # only the props (fast)
        make_assets()
        sys.exit(0)
    print("map…")
    base, torches, pool, floor = make_map()
    print("animated map…")
    make_animated(base, torches, pool, floor)
    print("embers…")
    render_particles(os.path.join(OUT, "embers-alpha.webm"), 1280, 720, 30, 6, 70, (255, 120, 30), (1.2, 2.6), [1, 2], "up", 1.6, 11)
    print("dust…")
    render_particles(os.path.join(OUT, "dust-alpha.webm"), 1280, 720, 24, 6, 90, (235, 225, 200), (1.0, 2.2), [1], "right", 0.9, 12)
    print("tokens…")
    make_token("hero", "H", (64, 120, 200, 255), (34, 52, 84, 255))
    make_token("goblin", "G", (170, 60, 50, 255), (70, 30, 26, 255))
    make_token("ogre", "O", (150, 110, 40, 255), (66, 50, 22, 255))
    print("audio…")
    make_audio()
    print("assets…")
    make_assets()
    for f in sorted(os.listdir(OUT)):
        print(f"  {f:34s} {os.path.getsize(os.path.join(OUT, f)) / 1024:8.0f} KB")
