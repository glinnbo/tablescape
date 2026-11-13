#!/usr/bin/env python3
"""Generate the short spell sounds (one per damage look) played on the table.

Everything is synthesised, so there are no licensing questions.
Usage: python3 scripts/make_sfx.py [output dir]   (default: src/renderer/sfx)
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
rng = np.random.default_rng(11)


def T(sec):
    return np.arange(int(SR * sec)) / SR


def noise(sec):
    return rng.standard_normal(int(SR * sec))


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


def sweep_filter(x, f0, f1, q=1.2):
    """Band-pass whose centre glides from f0 to f1 (processed in short blocks)."""
    out = np.zeros_like(x)
    n = len(x)
    block = 1024
    zi = None
    for i in range(0, n, block):
        f = f0 * (f1 / f0) ** (i / n)
        lo, hi = f / (1 + 1 / q), min(f * (1 + 1 / q), SR / 2 - 100)
        sos = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        seg, zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
        out[i:i + block] = seg
    return out


def crackles(sec, rate, lo=1500, hi=7000, decay=0.004):
    x = np.zeros(int(SR * sec))
    for _ in range(int(rate * sec)):
        p = rng.integers(0, len(x) - 400)
        k = np.exp(-np.arange(400) / (SR * decay)) * rng.standard_normal(400)
        x[p:p + 400] += k * rng.uniform(0.3, 1)
    return band(x, lo, hi)


def partials(t, freqs, decays, amps=None, start=0.0):
    x = np.zeros_like(t)
    amps = amps or [1] * len(freqs)
    for f, d, a in zip(freqs, decays, amps):
        tt = np.clip(t - start, 0, None)
        x += a * np.sin(2 * np.pi * f * tt) * np.exp(-tt / d) * (t >= start)
    return x


def fire():
    t = T(2.2)
    whoosh = sweep_filter(noise(2.2), 250, 1400, 1.0) * env(t, 0.12, 0.7, 0.15)
    roar = band(noise(2.2), hi=300) * env(t, 0.05, 0.9) * 1.6
    return whoosh * 1.2 + roar + crackles(2.2, 40) * env(t, 0.1, 1.0) * 0.5


def cold():
    # a cold gust, ice cracking and a frost hiss; no tones
    t = T(2.4)
    gust = sweep_filter(noise(2.4), 900, 220, 0.8) * env(t, 0.06, 0.75) * 1.4
    frost = band(noise(2.4), 4000, 10000) * env(t, 0.45, 0.6) * 0.22
    cracks = np.zeros_like(t)
    for _ in range(11):
        p = int(rng.uniform(0.02, 0.9) * SR)
        n = int(SR * 0.06)
        k = np.arange(n) / SR
        burst = band(rng.standard_normal(n), 1500, 6000) * np.exp(-k / 0.012)
        tok = np.sin(2 * np.pi * rng.uniform(170, 320) * k) * np.exp(-k / 0.035) * 0.8
        cracks[p:p + n] += (burst + tok)[: len(cracks[p:p + n])] * rng.uniform(0.4, 1)
    sub = np.sin(2 * np.pi * 55 * t) * env(t, 0.004, 0.22) * 0.9
    return gust + frost + cracks * 0.7 + sub


def lightning():
    t = T(2.4)
    crack = band(noise(2.4), 800, 9000) * env(t, 0.002, 0.06) * 1.6
    buzz = signal.sawtooth(2 * np.pi * 110 * t) * env(t, 0.01, 0.25) * 0.25
    rumble = band(noise(2.4), hi=140) * env(t, 0.08, 0.8, 0.1) * 3
    return crack + band(buzz, hi=2000) + rumble


def thunder():
    t = T(2.6)
    boom = band(noise(2.6), hi=120) * env(t, 0.02, 0.9) * 4
    thump = np.sin(2 * np.pi * (60 - 20 * t) * t) * env(t, 0.005, 0.35) * 0.9
    roll = band(noise(2.6), 60, 400) * env(t, 0.3, 0.9, 0.2) * 0.8
    return boom + thump + roll


def acid():
    # corrosive sizzle with a few low bubbles
    t = T(2.0)
    hiss = band(noise(2.0), 2500, 9000) * env(t, 0.05, 0.9) * 0.45
    x = hiss * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * t))
    for _ in range(14):
        s0 = rng.uniform(0.05, 1.3)
        f0 = rng.uniform(140, 320)
        tt = np.clip(t - s0, 0, None)
        x += np.sin(2 * np.pi * f0 * (1 + 1.5 * tt) * tt) * np.exp(-tt / 0.05) * (t >= s0) * 0.3
    splash = band(noise(2.0), 200, 1200) * env(t, 0.01, 0.25) * 0.8
    return x + splash


def poison():
    t = T(2.4)
    x = band(noise(2.4), 1500, 5000) * env(t, 0.5, 0.8) * 0.8
    gurgle = band(noise(2.4), 100, 400) * (0.5 + 0.5 * np.sin(2 * np.pi * 7 * t)) * env(t, 0.2, 0.9) * 0.9
    return x + gurgle


def necrotic():
    t = T(2.6)
    drone = (signal.sawtooth(2 * np.pi * 55 * t) + signal.sawtooth(2 * np.pi * 58.3 * t)) * 0.5
    drone = band(drone, hi=500) * env(t, 0.6, 0.9, 0.3)
    whisper = band(noise(2.6), 900, 3000) * (0.5 + 0.5 * np.sin(2 * np.pi * 3.1 * t)) * env(t, 0.4, 0.7) * 0.5
    return drone + whisper


def radiant():
    # a deep solemn swell: low drone with a slow beat, a rising wind and a soft impact
    t = T(2.6)
    drone = np.sin(2 * np.pi * 98 * t) + 0.6 * np.sin(2 * np.pi * 98.7 * t) + 0.35 * np.sin(2 * np.pi * 146.2 * t)
    drone = band(drone, hi=900) * env(t, 0.5, 0.9, 0.3)
    wind = sweep_filter(noise(2.6), 500, 2200, 1.2) * env(t, 0.7, 0.6) * 0.5
    hit = np.sin(2 * np.pi * (75 - 25 * t) * t) * env(t, 0.004, 0.3) * 0.9
    return drone + wind + hit


def force():
    # a heavy thump and a low pressure wave
    t = T(2.0)
    thump = np.sin(2 * np.pi * (70 - 30 * t) * t) * env(t, 0.004, 0.28) * 1.3
    wub = np.sin(2 * np.pi * 85 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 5 * t)) * env(t, 0.05, 0.6) * 0.6
    air = band(noise(2.0), 150, 600) * env(t, 0.02, 0.4) * 0.6
    return thump + wub + air


def psychic():
    # a pressing, dissonant warble (tritone) with a slow throb
    t = T(2.4)
    vib = 1 + 0.025 * np.sin(2 * np.pi * 6 * t)
    a = np.sin(2 * np.pi * np.cumsum(180 * vib) / SR)
    b = np.sin(2 * np.pi * np.cumsum(254.6 * vib) / SR)
    tone = (a + b) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t)) * env(t, 0.35, 0.8, 0.2) * 0.5
    pressure = band(noise(2.4), hi=300) * env(t, 0.5, 0.8) * 1.2
    return band(tone, hi=1800) + pressure


def cloud():
    t = T(2.4)
    return sweep_filter(noise(2.4), 300, 900, 0.8) * env(t, 0.5, 0.9) * 1.2 + band(noise(2.4), hi=200) * env(t, 0.4, 0.9) * 0.8


def nature():
    # rustling leaves and a deep wooden groan
    t = T(2.2)
    leaves = band(noise(2.2), 1500, 7000)
    grains = np.zeros_like(t)
    for _ in range(70):
        s0 = int(rng.uniform(0, 1.8) * SR)
        n = int(SR * 0.04)
        grains[s0:s0 + n] += np.hanning(n)[: len(grains[s0:s0 + n])] * rng.uniform(0.3, 1)
    f = 78 + 14 * np.sin(2 * np.pi * 0.9 * t)
    groan = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.3, 0.6, 0.2) * 0.5
    return leaves * grains * env(t, 0.1, 1.0, 0.3) * 0.8 + band(groan, hi=600)


def darkness():
    t = T(2.6)
    sub = np.sin(2 * np.pi * 42 * t) * env(t, 0.8, 1.0)
    swell = band(noise(2.6), hi=260) * env(t, 1.0, 0.6) * 1.5
    return sub + swell


def arcane():
    # a reversed whoosh into a dark metallic shimmer (inharmonic, no melody)
    t = T(2.4)
    swell = band(noise(2.4), 900, 3500) * np.clip(t / 0.45, 0, 1) ** 2 * (t < 0.45) * 0.9
    tt = np.clip(t - 0.45, 0, None)
    metal = np.zeros_like(t)
    for ratio, dec, amp in [(1, 0.9, 0.5), (1.41, 0.7, 0.35), (2.29, 0.5, 0.25), (3.17, 0.35, 0.15)]:
        metal += amp * np.sin(2 * np.pi * 196 * ratio * tt) * np.exp(-tt / dec) * (t >= 0.45)
    metal *= 0.75 + 0.25 * np.sin(2 * np.pi * 5.5 * t)
    pulse = np.sin(2 * np.pi * 70 * tt) * np.exp(-tt / 0.4) * (t >= 0.45) * 0.8
    return swell + metal + pulse


# ---------- Beta 2 ----------
def water():
    # a heavy splash, then water churning and bubbling
    t = T(2.2)
    hit = band(noise(2.2), 300, 6000) * env(t, 0.004, 0.18) * 1.4
    body = band(noise(2.2), 150, 1200) * env(t, 0.02, 0.7) * 0.9
    bub = np.zeros_like(t)
    for _ in range(26):
        s0 = int(rng.uniform(0.15, 1.6) * SR)
        L = int(SR * 0.05)
        bt = np.arange(L) / SR
        f = rng.uniform(500, 1400) * (1 + 3 * bt)
        blip = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-bt / 0.015)
        bub[s0:s0 + L] += blip[: len(bub[s0:s0 + L])] * rng.uniform(0.2, 0.6)
    return hit + body + bub * 0.8


def earth():
    # the ground cracks and heaves: a deep rumble, a crunch, stones knocking
    t = T(2.4)
    rumble = band(noise(2.4), hi=140) * env(t, 0.08, 0.8, 0.4) * 2.2
    crunch = band(noise(2.4), 400, 4000) * env(t, 0.003, 0.09) * 1.3
    knocks = np.zeros_like(t)
    for _ in range(14):
        s0 = int(rng.uniform(0.1, 1.4) * SR)
        L = int(SR * 0.12)
        bt = np.arange(L) / SR
        k = np.sin(2 * np.pi * rng.uniform(140, 320) * bt) * np.exp(-bt / 0.025)
        knocks[s0:s0 + L] += k[: len(knocks[s0:s0 + L])] * rng.uniform(0.3, 0.8)
    return rumble + crunch + knocks


def swarm():
    # a cloud of insects: many buzzing wings slightly out of tune, coming close and going
    t = T(2.6)
    buzz = np.zeros_like(t)
    for _ in range(9):
        f0 = rng.uniform(170, 260)
        f = f0 * (1 + 0.03 * np.sin(2 * np.pi * rng.uniform(3, 9) * t + rng.uniform(0, 6)))
        buzz += signal.sawtooth(2 * np.pi * np.cumsum(f) / SR) * rng.uniform(0.4, 1.0)
    buzz = band(buzz, 150, 2500) * (0.8 + 0.2 * np.sin(2 * np.pi * 1.3 * t))
    return buzz * env(t, 0.35, 0.8, 0.9) * 0.35


SOUNDS = dict(fire=fire, cold=cold, lightning=lightning, thunder=thunder, acid=acid, poison=poison,
              necrotic=necrotic, radiant=radiant, force=force, psychic=psychic, cloud=cloud,
              nature=nature, darkness=darkness, arcane=arcane, water=water, earth=earth, swarm=swarm)

for name, fn in SOUNDS.items():
    x = fn().astype(np.float64)
    n = len(x)
    fade = np.ones(n)
    k = int(SR * 0.008)
    fade[:k] = np.linspace(0, 1, k)
    k2 = int(SR * 0.25)
    fade[-k2:] = np.linspace(1, 0, k2)
    x *= fade
    # similar loudness for every look (RMS), with a soft limiter for the peaks
    loud = x[np.abs(x) > 1e-4 * np.max(np.abs(x))]
    x *= 10 ** (-17 / 20) / max(1e-9, np.sqrt(np.mean(loud ** 2)))
    x = np.tanh(x / 0.7) * 0.7
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = f.name
    wavfile.write(wav, SR, (x * 32767).astype(np.int16))
    out = os.path.join(OUT, f"{name}.ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "3", out], check=True)
    # the encoder can overshoot on sharp transients: re-encode quieter until the peak stays below -1 dB
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
