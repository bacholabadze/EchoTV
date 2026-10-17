#!/usr/bin/env python3
"""Deterministic rehearsal track for the ECHO demo: 60s, 100 BPM, synthesised in code (no samples,
no AI generation). Authored for ECHO and dedicated to the public domain (CC0). A real creator
replaces it with their own work from the Production Board.
Usage: .venv/bin/python -I tools/make-demo-track.py media/demo-track.mp3
"""
import subprocess, sys, wave
import numpy as np

RATE, BPM, LENGTH = 44100, 100, 60.0
beat = 60 / BPM
t_all = np.arange(int(RATE * LENGTH)) / RATE
mix = np.zeros_like(t_all)
note = lambda n: 440 * 2 ** ((n - 69) / 12)
# A minor – F – C – G, two bars each (8 beats per chord = 4.8 s; cycle 19.2 s).
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]


def env(n, attack, release):
    e = np.ones(n)
    a, r = min(n, int(attack * RATE)), min(n, int(release * RATE))
    e[:a] = np.linspace(0, 1, a)
    e[n - r:] *= np.linspace(1, 0, r)
    return e


def add(start, dur, signal):
    i = int(start * RATE)
    j = min(len(mix), i + len(signal))
    mix[i:j] += signal[: j - i]


def section_gain(t):
    # intro pad only, groove, lift at 40s, fade from 52s
    return 1.0 if t < 52 else max(0.0, (60 - t) / 8)


for bar in range(int(LENGTH / (beat * 8)) + 1):
    start = bar * beat * 8
    if start >= LENGTH:
        break
    chord = chords[bar % 4]
    dur = beat * 8
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    g = section_gain(start)
    lift = 1.35 if 40 <= start < 52 else 1.0
    pad = sum(np.sin(2 * np.pi * note(m) * t) + 0.3 * np.sin(2 * np.pi * note(m) * 2.003 * t) for m in chord)
    add(start, dur, 0.05 * g * pad * env(n, 1.2, 1.2))
    if start >= 8:  # bass on beats
        for b in range(8):
            bn = int(beat * 0.9 * RATE); tb = np.arange(bn) / RATE
            add(start + b * beat, beat, 0.16 * g * np.sin(2 * np.pi * note(chord[0] - 12) * tb) * env(bn, 0.01, 0.25))
        for s in range(16):  # eighth-note arpeggio
            m = chord[s % 3] + (12 if s % 6 >= 3 else 0) + (12 if lift > 1 else 0)
            an = int(beat / 2 * RATE); ta = np.arange(an) / RATE
            tone = np.sin(2 * np.pi * note(m) * ta) * np.exp(-ta * 6)
            add(start + s * beat / 2, beat / 2, 0.07 * g * lift * tone)
        rng = np.random.default_rng(bar)
        for b in range(8):  # soft kick and hat
            kn = int(0.25 * RATE); tk = np.arange(kn) / RATE
            kick = np.sin(2 * np.pi * (50 + 60 * np.exp(-tk * 25)) * tk) * np.exp(-tk * 12)
            if b % 2 == 0:
                add(start + b * beat, 0.25, 0.32 * g * kick)
            hn = int(0.05 * RATE)
            add(start + b * beat + beat / 2, 0.05, 0.03 * g * rng.standard_normal(hn) * np.exp(-np.arange(hn) / RATE * 80))

mix /= np.max(np.abs(mix)) * 1.1
pcm = (mix * 32767).astype("<i2")
out = sys.argv[1]
wav_path = out.rsplit(".", 1)[0] + ".wav"
with wave.open(wav_path, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "3", out], check=True)
subprocess.run(["rm", wav_path], check=True)
print(f"wrote {out} ({LENGTH}s)")
