#!/usr/bin/env python3
"""Demo files for 0.6: two NPC busts for Talk mode, a handout and four soundboard sounds.

Everything is procedural, so there are no licensing questions.
Usage: python3 scripts/make_extras.py [output dir]   (default: demo)
  portrait-stranger.png, portrait-captain.png   upper bodies with a transparent background
  handout-letter.png                            a sealed letter with torn edges
  sfx-thunder.ogg, sfx-door.ogg, sfx-roar.ogg, sfx-bell.ogg
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter
from scipy import signal
from scipy.io import wavfile

OUT = sys.argv[1] if len(sys.argv) > 1 else "demo"
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(5)


def value_noise(h, w, scale, seed):
    r = np.random.default_rng(seed)
    gh, gw = h // scale + 2, w // scale + 2
    g = r.random((gh, gw)).astype(np.float32)
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((gw * scale, gh * scale), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)[:h, :w] / 255.0


def fbm(h, w, seed, scales=(64, 24, 9)):
    return sum(value_noise(h, w, s, seed + i) / (i + 1) for i, s in enumerate(scales)) / sum(1 / (i + 1) for i in range(len(scales)))


# ------------------------------------------------------------- shape helpers (signed distances, pixels)
def grid(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return x, y


def ellipse(x, y, cx, cy, rx, ry):
    return (np.hypot((x - cx) / rx, (y - cy) / ry) - 1) * min(rx, ry)


def box(x, y, cx, cy, hw, hh, r=0):
    dx = np.abs(x - cx) - hw + r
    dy = np.abs(y - cy) - hh + r
    return np.hypot(np.maximum(dx, 0), np.maximum(dy, 0)) + np.minimum(np.maximum(dx, dy), 0) - r


def smin(a, b, k):
    hh = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * hh - k * hh * (1 - hh)


def fill(d, soft=1.5):
    return np.clip(0.5 - d / soft, 0, 1)


def paint(rgb, mask, color, shade=None):
    c = np.array(color, np.float32)[None, None, :]
    if shade is not None:
        c = c * shade[..., None]
    return rgb * (1 - mask[..., None]) + c * mask[..., None]


def save_rgba(rgb, alpha, name, size=None):
    out = np.dstack([np.clip(rgb, 0, 1) * 255, np.clip(alpha, 0, 1) * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    if size:
        img = img.resize(size, Image.LANCZOS)
    img.save(os.path.join(OUT, name), optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, "KB")


def light(x, y, lx, ly, cx, cy, r, amt=0.5):
    """brighter towards (lx, ly) relative to the shape centre"""
    d = ((x - cx) * lx + (y - cy) * ly) / r
    return np.clip(1 + amt * d, 0.35, 1.5)


# ------------------------------------------------------------- portraits (upper body, 900 x 1100)
PW, PH = 900, 1100


def stranger():
    x, y = grid(PW, PH)
    n = fbm(PH, PW, 11)
    folds = 0.85 + 0.15 * np.sin(x / 23 + n * 6)
    # cloak: wide shoulders sloping down from the hood
    shoulders = box(x, y, 450, 980, 420, 260, 170)
    hood = ellipse(x, y, 450, 430, 205, 250)
    body = smin(shoulders, hood, 60)
    alpha = fill(body)
    rgb = np.zeros((PH, PW, 3), np.float32)
    shade = light(x, y, -0.5, -0.6, 450, 700, 500, 0.45) * folds * (0.85 + 0.3 * n)
    rgb = paint(rgb, alpha, (0.19, 0.24, 0.2), shade)
    # inner hood opening: a dark face in shadow
    face = ellipse(x, y, 452, 470, 118, 160)
    fm = fill(face, 6)
    rgb = paint(rgb, fm, (0.05, 0.05, 0.06), 0.7 + 0.5 * fill(ellipse(x, y, 452, 520, 80, 90), 40))
    # chin and a hint of a beard in the light at the bottom of the hood
    chin = fill(ellipse(x, y, 452, 585, 70, 48), 18) * fm
    rgb = paint(rgb, chin * 0.65, (0.36, 0.3, 0.26), 0.8 + 0.4 * n)
    # two faint eyes
    for ex in (412, 492):
        e = fill(ellipse(x, y, ex, 480, 15, 7), 3)
        glow = fill(ellipse(x, y, ex, 480, 40, 26), 30) * 0.35
        rgb = paint(rgb, glow * fm, (0.9, 0.55, 0.2))
        rgb = paint(rgb, e * fm, (1.0, 0.8, 0.45))
    # warm rim light along the hood edge (a torch on the left)
    rim = np.clip(1 - np.abs(hood + 4) / 10, 0, 1) * (x < 470) * alpha * np.clip((560 - y) / 300, 0, 1)
    rgb = paint(rgb, rim * 0.8, (0.95, 0.66, 0.32))
    # leather strap and a brass clasp
    strap = fill(box(x, y, 450, 790, 14, 200), 2) * fill(shoulders, 2)
    strap_mask = fill(np.abs((x - 450) * 0.95 + (y - 790) * 0.32) - 18, 2) * (y > 640) * alpha
    rgb = paint(rgb, strap_mask, (0.27, 0.17, 0.1), 0.8 + 0.4 * n)
    clasp = fill(ellipse(x, y, 450, 660, 34, 34), 2)
    rgb = paint(rgb, clasp, (0.78, 0.6, 0.28), light(x, y, -0.6, -0.6, 450, 660, 34, 0.8))
    rgb = paint(rgb, fill(ellipse(x, y, 450, 660, 13, 13), 2), (0.55, 0.12, 0.1))
    del strap
    save_rgba(rgb, alpha, "portrait-stranger.png", (720, 880))


def captain():
    x, y = grid(PW, PH)
    n = fbm(PH, PW, 23)
    # body: breastplate between two pauldrons, red tabard
    torso = box(x, y, 450, 940, 300, 280, 120)
    pl = ellipse(x, y, 205, 760, 170, 120)
    pr = ellipse(x, y, 695, 760, 170, 120)
    neck = box(x, y, 450, 640, 70, 80, 30)
    head = ellipse(x, y, 450, 470, 140, 175)
    body = smin(smin(smin(torso, pl, 40), pr, 40), smin(neck, head, 30), 30)
    alpha = fill(body)
    rgb = np.zeros((PH, PW, 3), np.float32)
    metal = 0.7 + 0.5 * np.clip(np.sin((x - y * 0.4) / 60) * 0.5 + 0.5, 0, 1) * 0.6 + 0.2 * n
    rgb = paint(rgb, fill(torso), (0.5, 0.52, 0.56), metal * light(x, y, -0.5, -0.6, 450, 900, 400, 0.4))
    tabard = fill(box(x, y, 450, 980, 120, 240, 20), 2) * fill(torso)
    rgb = paint(rgb, tabard, (0.55, 0.1, 0.09), 0.75 + 0.35 * n)
    stripe = fill(box(x, y, 450, 980, 22, 240), 2) * tabard
    rgb = paint(rgb, stripe, (0.8, 0.62, 0.25), 0.8 + 0.3 * n)
    for p, cx in ((pl, 205), (pr, 695)):
        m = fill(p)
        sh = light(x, y, -0.5, -0.7, cx, 760, 170, 0.6) * (0.85 + 0.25 * np.cos((y - 700) / 22))
        rgb = paint(rgb, m, (0.56, 0.57, 0.6), sh)
        edge = np.clip(1 - np.abs(p + 6) / 6, 0, 1)
        rgb = paint(rgb, edge * m, (0.8, 0.64, 0.3))
    # neck and face
    rgb = paint(rgb, fill(neck), (0.55, 0.38, 0.28), light(x, y, -0.6, -0.3, 450, 640, 80, 0.5))
    skin = light(x, y, -0.55, -0.35, 450, 480, 150, 0.55) * (0.9 + 0.15 * n)
    rgb = paint(rgb, fill(head), (0.7, 0.5, 0.38), skin)
    # moustache and brows
    mous = fill(smin(ellipse(x, y, 410, 545, 52, 16), ellipse(x, y, 490, 545, 52, 16), 10), 2)
    rgb = paint(rgb, mous, (0.22, 0.14, 0.09), 0.8 + 0.3 * n)
    for ex in (402, 498):
        rgb = paint(rgb, fill(ellipse(x, y, ex, 468, 22, 8), 2), (0.12, 0.1, 0.09))
        rgb = paint(rgb, fill(box(x, y, ex, 448, 30, 6, 6), 2), (0.2, 0.13, 0.08))
    rgb = paint(rgb, fill(box(x, y, 450, 505, 12, 34, 10), 4) * 0.35, (0.45, 0.3, 0.22))
    # helmet: a dome with a brim and a nose guard
    dome = ellipse(x, y, 450, 390, 165, 130)
    dome = np.maximum(dome, y - 420)
    brim = box(x, y, 450, 418, 175, 16, 12)
    helm = np.minimum(dome, brim)
    hm = fill(helm)
    rgb = paint(rgb, hm, (0.46, 0.47, 0.5), light(x, y, -0.5, -0.8, 450, 360, 160, 0.7) * (0.85 + 0.2 * n))
    rgb = paint(rgb, fill(box(x, y, 450, 455, 9, 48, 6), 2), (0.42, 0.43, 0.46))
    crest = fill(box(x, y, 450, 280, 12, 40, 8), 2)
    rgb = paint(rgb, crest, (0.6, 0.12, 0.1), 0.8 + 0.4 * n)
    alpha = np.maximum(alpha, np.maximum(hm, crest))
    save_rgba(rgb, alpha, "portrait-captain.png", (720, 880))


# ------------------------------------------------------------- handout: a sealed letter
def letter():
    w, h = 1000, 760
    x, y = grid(w, h)
    n = fbm(h, w, 41, (90, 30, 8))
    edge_noise = (fbm(h, w, 42, (20, 7)) - 0.5) * 40
    d = box(x, y, w / 2, h / 2, w / 2 - 40, h / 2 - 40, 8) + edge_noise
    alpha = fill(d, 2)
    burn = np.clip(1 + d / 45, 0, 1)  # darker towards the torn edge
    paper = np.array([0.86, 0.77, 0.58]) * (0.82 + 0.25 * n)[..., None] * (1 - 0.55 * burn ** 2)[..., None]
    rgb = paper.astype(np.float32)
    ink = np.zeros((h, w), np.float32)
    rs = np.random.default_rng(43)
    # lines of "handwriting": wavy strokes with gaps between words
    for row in range(10):
        yy = 150 + row * 46
        xx = 120
        end = w - 130 - (rs.uniform(150, 400) if row == 9 else rs.uniform(0, 60))
        while xx < end:
            ln = rs.uniform(40, 120)
            t = np.linspace(0, 1, 60)
            px = xx + t * ln
            py = yy + np.sin(t * ln / 7 + rs.uniform(0, 6)) * 5 + rs.uniform(-2, 2)
            for i in range(len(t)):
                ink = np.maximum(ink, fill(np.hypot(x - px[i], y - py[i]) - 2.2, 1.2))
            xx += ln + rs.uniform(14, 26)
    rgb = paint(rgb, ink * 0.85, (0.16, 0.1, 0.07))
    # wax seal
    seal = ellipse(x, y, w - 210, h - 140, 58, 54) + (fbm(h, w, 44, (6,)) - 0.5) * 10
    sm = fill(seal, 2)
    rgb = paint(rgb, sm, (0.55, 0.08, 0.08), light(x, y, -0.6, -0.6, w - 210, h - 140, 60, 0.7))
    rgb = paint(rgb, fill(np.abs(ellipse(x, y, w - 210, h - 140, 30, 30)) - 3, 1.5) * sm, (0.38, 0.04, 0.05))
    save_rgba(rgb, alpha, "handout-letter.png")


# ------------------------------------------------------------- soundboard sounds
SR = 44100


def T(sec):
    return np.arange(int(SR * sec)) / SR


def noise(sec):
    return rng.standard_normal(int(SR * sec))


def band(xx, lo=None, hi=None, order=4):
    if lo and hi:
        sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    elif lo:
        sos = signal.butter(order, lo, "highpass", fs=SR, output="sos")
    else:
        sos = signal.butter(order, hi, "lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, xx)


def env(t, attack, decay, hold=0.0):
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    dd = np.where(t < attack + hold, 1.0, np.exp(-(t - attack - hold) / max(decay, 1e-4)))
    return a * dd


def thunder():
    # a sharp crack, then a long rolling rumble that comes in waves
    t = T(6.0)
    crack = band(noise(6.0), 600, 6000) * env(t, 0.003, 0.08) * 1.4
    rolls = sum(env(np.clip(t - d, 0, None), 0.15, 0.9) * (t > d) * a for d, a in [(0.05, 1), (0.7, 0.7), (1.6, 0.8), (2.6, 0.5)])
    rumble = band(noise(6.0), hi=160) * rolls * 4.5
    body = band(noise(6.0), 80, 500) * rolls * 0.8
    return crack + rumble + body


def door():
    # a slow creak: a rough tone gliding up and down, with stick-slip grain
    t = T(2.6)
    f = 230 + 140 * np.sin(np.pi * t / 2.6) + 25 * np.sin(2 * np.pi * 3.1 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    grain = (np.sin(2 * np.pi * 38 * t) > 0.2).astype(float) * 0.6 + 0.4
    tone = signal.sawtooth(ph) * grain
    creak = band(tone, 300, 2600) * env(t, 0.15, 2.0, 1.6) * 0.9
    thud = band(noise(2.6), hi=200) * env(np.clip(t - 2.25, 0, None), 0.005, 0.18) * (t > 2.25) * 3
    return creak + thud


def roar():
    # a growl: low pulsing sawtooth through a vowel-like filter, with breath
    t = T(2.4)
    f = 85 + 25 * np.sin(np.pi * t / 2.4) + 6 * np.sin(2 * np.pi * 7 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    voice = signal.sawtooth(ph) * (0.75 + 0.25 * np.sin(2 * np.pi * 23 * t))
    shaped = band(voice, 120, 900) * 1.2 + band(voice, 900, 2200) * 0.35
    breath = band(noise(2.4), 300, 3000) * 0.25
    return (shaped + breath) * env(t, 0.25, 0.6, 1.2)


def bell():
    # a heavy bronze bell: inharmonic partials, long decay
    t = T(5.0)
    out = np.zeros_like(t)
    for ratio, dec, amp in [(0.5, 3.5, 0.5), (1, 2.6, 1), (1.19, 2.0, 0.6), (1.5, 1.6, 0.45), (2.0, 1.2, 0.4), (2.52, 0.9, 0.3), (3.0, 0.6, 0.2)]:
        out += amp * np.sin(2 * np.pi * 220 * ratio * t + ratio) * np.exp(-t / dec)
    strike = band(noise(5.0), 1000, 6000) * env(t, 0.001, 0.02) * 0.6
    return out * env(t, 0.003, 10) + strike


def encode(name, x):
    x = x.astype(np.float64)
    k = int(SR * 0.006)
    x[:k] *= np.linspace(0, 1, k)
    k2 = int(SR * 0.3)
    x[-k2:] *= np.linspace(1, 0, k2)
    loud = x[np.abs(x) > 1e-4 * np.max(np.abs(x))]
    x *= 10 ** (-16 / 20) / max(1e-9, np.sqrt(np.mean(loud ** 2)))
    x = np.tanh(x / 0.75) * 0.75
    x *= 0.87 / max(0.87, np.max(np.abs(x)))
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = f.name
    wavfile.write(wav, SR, (x * 32767).astype(np.int16))
    out = os.path.join(OUT, name)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "3", out], check=True)
    os.unlink(wav)
    print(name, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    stranger()
    captain()
    letter()
    encode("sfx-thunder.ogg", thunder())
    encode("sfx-door.ogg", door())
    encode("sfx-roar.ogg", roar())
    encode("sfx-bell.ogg", bell())
