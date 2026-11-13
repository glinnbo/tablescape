#!/usr/bin/env python3
"""Generate the built-in sounds of the screen moments (Toolbox → Moments).

Everything is synthesised, so there are no licensing questions. A sound in the library's Audio/SFX
with a fitting name, or one the GM picks, plays instead.
Usage: python3 scripts/make_moment_sfx.py [output dir]   (default: src/renderer/sfx)
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "src", "renderer", "sfx")
os.makedirs(OUT, exist_ok=True)
SR = 44100
rng = np.random.default_rng(23)


def T(sec):
    return np.arange(int(SR * sec)) / SR


def noise(sec):
    return rng.standard_normal(int(SR * sec))


def brown(sec):
    x = np.cumsum(rng.standard_normal(int(SR * sec)))
    x = signal.sosfilt(signal.butter(2, 20, "highpass", fs=SR, output="sos"), x)
    return x / (np.max(np.abs(x)) + 1e-9)


def band(x, lo=None, hi=None, order=4):
    if lo and hi:
        sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    elif lo:
        sos = signal.butter(order, lo, "highpass", fs=SR, output="sos")
    else:
        sos = signal.butter(order, hi, "lowpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def env(t, attack, decay, hold=0.0):
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.where(t < attack + hold, 1.0, np.exp(-(t - attack - hold) / max(decay, 1e-4)))
    return a * d


def at(x, total, start):
    """Place x in a buffer `total` seconds long, starting at `start` seconds."""
    out = np.zeros(int(SR * total))
    i = int(SR * start)
    n = min(len(x), len(out) - i)
    if n > 0:
        out[i:i + n] += x[:n]
    return out


def sweep(f0, f1, sec, kind="sine"):
    t = T(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    return np.sin(ph)


def crackles(sec, rate, lo, hi, decay=0.01, seed_amp=1.0):
    out = np.zeros(int(SR * sec))
    n = int(rate * sec)
    for _ in range(n):
        i = rng.integers(0, len(out))
        L = int(SR * decay * 6)
        burst = rng.standard_normal(L) * np.exp(-np.arange(L) / (SR * decay)) * rng.uniform(0.3, 1.0) * seed_amp
        out[i:i + L] += burst[:len(out) - i]
    return band(out, lo, hi)


def earthquake():
    sec = 3.4
    t = T(sec)
    rumble = band(brown(sec), None, 140) * (0.7 + 0.3 * np.sin(2 * np.pi * 3.1 * t) * np.sin(2 * np.pi * 0.7 * t))
    sub = np.sin(2 * np.pi * 31 * t + 2 * np.sin(2 * np.pi * 2.3 * t)) * 0.6
    rocks = crackles(sec, 26, 250, 1600, 0.02) * 0.9
    e = env(t, 0.35, 0.9, hold=1.9)
    return (rumble * 1.4 + sub + rocks * np.clip((t - 0.3) / 1.5, 0, 1)) * e


def explosion():
    sec = 2.8
    t = T(sec)
    crack = band(noise(sec), 400, 9000) * env(t, 0.002, 0.05)
    boom = sweep(90, 28, sec) * env(t, 0.004, 0.9) * 1.6
    body = band(brown(sec), None, 900) * env(t, 0.01, 0.75) * 1.8
    debris = crackles(sec, 40, 600, 4000, 0.006) * np.clip((t - 0.15) / 0.3, 0, 1) * np.exp(-t / 1.1) * 1.2
    return crack * 1.5 + boom + body + debris


def blood():
    sec = 1.7
    out = np.zeros(int(SR * sec))
    for i, (start, amp) in enumerate([(0.0, 1.0), (0.11, 0.7), (0.24, 0.55), (0.38, 0.45)]):
        L = 0.16
        tt = T(L)
        sq = noise(L)
        # a resonant band sliding down: the wet "splat"
        y = np.zeros_like(sq)
        blk = 256
        for j in range(0, len(sq), blk):
            f = 1300 * (0.25 ** (j / len(sq)))
            sos = signal.butter(2, [f * 0.6, f * 1.5], "bandpass", fs=SR, output="sos")
            y[j:j + blk] = signal.sosfilt(sos, sq[j:j + blk])
        out += at(y * env(tt, 0.002, 0.045) * amp * 3, sec, start)
    # drips
    for start in [0.7, 0.95, 1.25]:
        dt = T(0.08)
        out += at(np.sin(2 * np.pi * (1500 - 7000 * dt) * dt) * env(dt, 0.001, 0.02) * 0.35, sec, start)
    return out


def gas():
    sec = 4.0
    t = T(sec)
    hiss = band(noise(sec), 1800, 9000) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.9 * t))
    low = band(noise(sec), 120, 600) * 0.5
    bubbles = np.zeros_like(t)
    for _ in range(14):
        s0 = rng.uniform(0.3, 3.4)
        bt = T(0.06)
        f = rng.uniform(250, 600)
        bubbles += at(np.sin(2 * np.pi * (f + 2500 * bt) * bt) * env(bt, 0.002, 0.018) * 0.4, sec, s0)
    e = np.clip(t / 0.9, 0, 1) * np.clip((sec - t) / 1.2, 0, 1)
    return (hiss + low + bubbles) * e


def roar():
    sec = 3.4
    t = T(sec)
    f0 = 62 + 30 * np.sin(np.pi * np.clip(t / 2.6, 0, 1)) + 3 * np.sin(2 * np.pi * 6 * t)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    growl = 1 + 0.5 * np.sin(2 * np.pi * 28 * t)
    voice = band(saw * growl, 120, 2400)
    form = band(voice, 250, 450) * 1.4 + band(voice, 700, 1100) * 1.0 + band(voice, 2000, 2600) * 0.4
    breath = band(noise(sec), 300, 3000) * 0.6
    x = (form + breath) * env(t, 0.25, 0.7, hold=1.8)
    return np.tanh(x * 2.2)


def dread():
    sec = 6.2
    t = T(sec)
    out = np.zeros_like(t)
    for k in range(5):
        for dt, a in [(0.0, 1.0), (0.22, 0.65)]:
            s0 = 0.25 + k * 1.15 + dt
            bt = T(0.35)
            th = np.sin(2 * np.pi * (58 - 18 * bt) * bt) * env(bt, 0.004, 0.09) + 0.5 * np.sin(2 * np.pi * 92 * bt) * env(bt, 0.002, 0.03)
            out += at(th * a * 1.6, sec, s0)
    drone = (np.sin(2 * np.pi * 41 * t) + 0.6 * np.sin(2 * np.pi * 43.5 * t)) * 0.18 * np.clip(t / 1.5, 0, 1) * np.clip((sec - t) / 1.2, 0, 1)
    return out + drone


def frost():
    sec = 3.6
    t = T(sec)
    out = np.zeros_like(t)
    for _ in range(46):
        s0 = rng.uniform(0, 2.6)
        f = rng.uniform(1800, 6500)
        L = rng.uniform(0.4, 1.0)
        bt = T(L)
        out += at(np.sin(2 * np.pi * f * bt) * env(bt, 0.002, L / 4) * rng.uniform(0.05, 0.16), sec, s0)
    wind = band(noise(sec), 500, 2500) * (0.3 + 0.2 * np.sin(2 * np.pi * 0.5 * t)) * 0.5
    ice = crackles(sec, 18, 3000, 12000, 0.002) * np.clip(t / 1.2, 0, 1) * 0.8
    return (out + wind + ice) * np.clip(t / 0.4, 0, 1) * np.clip((sec - t) / 1.0, 0, 1)


def holy():
    sec = 4.8
    t = T(sec)
    pad = np.zeros_like(t)
    for f in [261.6, 329.6, 392.0, 523.3, 659.3]:
        for det in [-0.004, 0, 0.005]:
            ph = 2 * np.pi * f * (1 + det) * t
            pad += (np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)) * 0.12
    pad = band(pad, None, 3200) * (1 + 0.08 * np.sin(2 * np.pi * 5 * t))
    e = np.clip(t / 1.1, 0, 1) * np.clip((sec - t) / 1.4, 0, 1)
    bell = np.zeros_like(t)
    for f, s0 in [(1046.5, 0.05), (1568.0, 0.25), (2093.0, 0.45)]:
        bt = T(2.5)
        bell += at((np.sin(2 * np.pi * f * bt) + 0.3 * np.sin(2 * np.pi * f * 2.76 * bt)) * env(bt, 0.003, 0.7) * 0.22, sec, s0)
    return pad * e + bell


def madness():
    sec = 5.0
    t = T(sec)
    whispers = np.zeros_like(t)
    for _ in range(9):
        s0 = rng.uniform(0, 3.8)
        L = rng.uniform(0.5, 1.2)
        bt = T(L)
        n = noise(L)
        y = np.zeros_like(n)
        blk = 512
        fa = rng.uniform(600, 1200)
        fb = rng.uniform(1800, 3200)
        for j in range(0, len(n), blk):
            u = j / len(n)
            f = fa + (fb - fa) * (0.5 + 0.5 * np.sin(2 * np.pi * (3 + rng.uniform(0, 3)) * u))
            sos = signal.butter(2, [f * 0.8, f * 1.25], "bandpass", fs=SR, output="sos")
            y[j:j + blk] = signal.sosfilt(sos, n[j:j + blk])
        syll = np.clip(np.sin(2 * np.pi * rng.uniform(5, 8) * bt), 0, 1) ** 2
        whispers += at(y * syll * np.sin(np.pi * bt / L) * 1.4, sec, s0)
    beat = (np.sin(2 * np.pi * 55 * t) + np.sin(2 * np.pi * 58.3 * t) + 0.5 * np.sin(2 * np.pi * 77.8 * t)) * 0.16
    e = np.clip(t / 1.0, 0, 1) * np.clip((sec - t) / 1.2, 0, 1)
    return (whispers + beat) * e


def timestop():
    sec = 2.6
    out = np.zeros(int(SR * sec))
    for i, s0 in enumerate([0.0, 0.42, 0.8, 1.12]):
        L = 0.05
        bt = T(L)
        tick = band(noise(L), 1500, 6000) * env(bt, 0.001, 0.008) + np.sin(2 * np.pi * 2400 * bt) * env(bt, 0.001, 0.01) * 0.6
        out += at(tick * (1 - i * 0.15), sec, s0)
    g = sweep(700, 70, 1.3) * env(T(1.3), 0.02, 0.5) * 0.7
    out += at(g, sec, 1.15)
    sw = band(noise(1.2), 200, 1800) * np.linspace(0, 1, int(SR * 1.2)) ** 3 * 0.7
    out += at(sw[::-1] * 0 + sw, sec, 0.0) * 0.3
    return out


def nat20():
    sec = 2.9
    out = np.zeros(int(SR * sec))
    notes = [(523.3, 0.0), (659.3, 0.12), (784.0, 0.24), (1046.5, 0.38)]
    for f, s0 in notes:
        bt = T(0.6)
        tri = signal.sawtooth(2 * np.pi * f * bt, 0.5)
        out += at(tri * env(bt, 0.004, 0.18) * 0.35, sec, s0)
    bt = T(2.3)
    chord = sum(signal.sawtooth(2 * np.pi * f * bt, 0.5) for f in [523.3, 659.3, 784.0, 1046.5]) * 0.12
    out += at(band(chord, None, 5000) * env(bt, 0.01, 0.8, hold=0.4), sec, 0.5)
    for _ in range(30):
        s0 = rng.uniform(0.45, 2.2)
        f = rng.uniform(2500, 7000)
        st = T(0.15)
        out += at(np.sin(2 * np.pi * f * st) * env(st, 0.001, 0.04) * 0.1, sec, s0)
    return out


# ---------- Beta 2 ----------
def teleport():
    # a rising shimmer that pulls in, then a soft bright pop
    sec = 2.0
    t = T(sec)
    rise = sweep(260, 1700, 0.85) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * T(0.85))) * np.linspace(0.2, 1, int(SR * 0.85)) ** 2 * 0.5
    shimmer = band(noise(0.85), 3000, 9000) * np.linspace(0, 1, int(SR * 0.85)) ** 3 * 0.5
    pop = band(noise(1.1), 1200, 8000) * env(T(1.1), 0.002, 0.12) * 1.2 + np.sin(2 * np.pi * 180 * T(1.1)) * env(T(1.1), 0.003, 0.15) * 0.7
    tail = np.zeros(int(SR * 1.1))
    for f, a0 in [(2093.0, 0.25), (2637.0, 0.18), (3136.0, 0.12)]:
        bt = T(1.1)
        tail += np.sin(2 * np.pi * f * bt) * env(bt, 0.005, 0.35) * a0
    return at(rise + shimmer, sec, 0.0) + at(pop + tail, sec, 0.85)


def puff():
    sec = 1.6
    t = T(sec)
    body = band(noise(sec), 180, 1400) * env(t, 0.01, 0.35) * 1.4
    air = band(noise(sec), 1500, 6000) * env(t, 0.005, 0.18) * 0.5
    thump = np.sin(2 * np.pi * 75 * t) * env(t, 0.004, 0.12) * 0.8
    return body + air + thump


def lightsout():
    # a gust of wind through the room, and flames snuffed one after another
    sec = 3.4
    t = T(sec)
    n = noise(sec)
    y = np.zeros_like(n)
    blk = 512
    for j in range(0, len(n), blk):
        u = j / len(n)
        f = 380 + 900 * np.sin(np.pi * min(1, u * 1.3))
        sos = signal.butter(2, [f * 0.6, f * 1.6], "bandpass", fs=SR, output="sos")
        y[j:j + blk] = signal.sosfilt(sos, n[j:j + blk])
    gust = y * np.sin(np.pi * np.clip(t / 2.6, 0, 1)) ** 1.5 * 1.6
    snuff = np.zeros_like(t)
    for s0 in [0.45, 0.9, 1.2, 1.65, 2.2]:
        L = 0.18
        bt = T(L)
        snuff += at(band(noise(L), 200, 1800) * env(bt, 0.004, 0.05) * rng.uniform(0.6, 1.0) * 1.2, sec, s0)
    return gust + snuff


def rockfall():
    sec = 3.2
    t = T(sec)
    rumble = band(brown(sec), None, 160) * env(t, 0.3, 0.9, hold=0.6) * 1.2
    hits = np.zeros_like(t)
    for s0, f in [(0.36, 70), (0.5, 95), (0.6, 60), (0.68, 110), (0.75, 55), (0.82, 85)]:
        bt = T(0.5)
        hit = np.sin(2 * np.pi * f * bt) * env(bt, 0.002, 0.11) * 1.2 + band(noise(0.5), 300, 3000) * env(bt, 0.001, 0.04) * 0.8
        hits += at(hit * rng.uniform(0.6, 1.0), sec, s0)
    gravel = crackles(sec, 60, 700, 5000, 0.004) * np.clip((t - 0.45) / 0.2, 0, 1) * np.exp(-np.clip(t - 0.45, 0, None) / 0.9) * 1.1
    return rumble + hits + gravel


def flood():
    sec = 7.5
    t = T(sec)
    rush = band(noise(sec), 250, 3200) * np.clip(t / 1.6, 0, 1) ** 1.5 * np.clip((sec - t) / 3.6, 0, 1) * 1.1
    low = band(brown(sec), None, 220) * np.clip(t / 1.2, 0, 1) * np.clip((sec - t) / 3, 0, 1) * 1.3
    splash = crackles(sec, 45, 900, 6000, 0.006) * np.clip((t - 0.8) / 1.0, 0, 1) * np.clip((5.5 - t) / 2.5, 0, 1) * 0.8
    return rush + low + splash


SOUNDS = dict(earthquake=earthquake, explosion=explosion, blood=blood, gas=gas, roar=roar, dread=dread,
              frost=frost, holy=holy, madness=madness, timestop=timestop, nat20=nat20,
              teleport=teleport, puff=puff, lightsout=lightsout, rockfall=rockfall, flood=flood)

for name, fn in SOUNDS.items():
    x = fn().astype(np.float64)
    n = len(x)
    fade = np.ones(n)
    k = int(SR * 0.006)
    fade[:k] = np.linspace(0, 1, k)
    k2 = int(SR * 0.2)
    fade[-k2:] = np.linspace(1, 0, k2)
    x *= fade
    loud = x[np.abs(x) > 1e-4 * np.max(np.abs(x))]
    x *= 10 ** (-16 / 20) / max(1e-9, np.sqrt(np.mean(loud ** 2)))
    x = np.tanh(x / 0.7) * 0.7
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = f.name
    wavfile.write(wav, SR, (x * 32767).astype(np.int16))
    out = os.path.join(OUT, f"moment-{name}.ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "3", out], check=True)
    for _ in range(4):
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", out, "-f", "f32le", "-ac", "1", "-"], capture_output=True, check=True).stdout
        peak = float(np.max(np.abs(np.frombuffer(raw, np.float32))))
        if peak <= 0.89:
            break
        x *= 0.87 / peak
        wavfile.write(wav, SR, (x * 32767).astype(np.int16))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "3", out], check=True)
    os.unlink(wav)
    print(f"{out}: {os.path.getsize(out) // 1024} KB")
