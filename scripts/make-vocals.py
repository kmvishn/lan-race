#!/usr/bin/env python3
"""Renders a sung vocal for the lobby song ("Neon Harbor Nights") from the syllable score in static/js/music.js.

Each word is spoken by an offline neural TTS voice (Piper, public-domain LJSpeech voice), then the WORLD vocoder puts
every syllable on its melody note: consonants keep their natural length, the vowel is held for the rest of the note,
with portamento between notes and a delayed vibrato. Choruses get a second, slightly detuned double. The result is
mixed with a light echo and written to static/sfx/vocals.ogg, aligned to the start of the song.

Dev-time only (players just download the .ogg). Needs: node, ffmpeg, and a Python env with
    pip install piper-tts pyworld soundfile numpy "setuptools<81"
plus the voice files:
    python3 scripts/make-vocals.py path/to/en_US-ljspeech-high.onnx
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np
import pyworld as pw
import soundfile as sf
from piper import PiperVoice

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FP = 5.0  # WORLD frame period, ms
CHORUS = [(256, 384), (576, 704)]  # song steps (16ths) of the two choruses


def score():
    """Syllable notes {step, len, midi, text} straight from music.js, so the vocal always matches the sequencer."""
    js = open(os.path.join(ROOT, 'static/js/music.js')).read() + '\nexport { buildTimeline as __tl, BPM as __bpm };\n'
    with tempfile.TemporaryDirectory() as tmp:
        mod = os.path.join(tmp, 'music.mjs')
        open(mod, 'w').write(js)
        out = subprocess.run(['node', '-e', f"import('{mod}').then(m => {{ const t = m.__tl(); console.log(JSON.stringify({{ bpm: m.__bpm, total: t.total, notes: t.notes }})); }})"],
                             capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def words(notes):
    """Groups syllables into words: a syllable ending in a space (or a hyphen) closes the word."""
    out, cur = [], []
    for n in notes:
        cur.append(n)
        if n['text'].endswith((' ', '-')):
            out.append(cur); cur = []
    if cur: out.append(cur)
    return out


def speak(voice, text):
    audio = np.concatenate([c.audio_float_array for c in voice.synthesize(text)]).astype(np.float64)
    env = np.abs(audio)
    on = np.where(env > env.max() * 0.04)[0]
    return audio[max(0, on[0] - 200):on[-1] + 400] if len(on) else audio


def syllable_bounds(energy, voiced, n):
    """Frame boundaries splitting a word into n syllables at the energy dips between vowel peaks."""
    if n == 1: return [0, len(energy)]
    e = np.convolve(energy * voiced, np.ones(9) / 9, mode='same')
    peaks = []
    for i in np.argsort(-e):
        if all(abs(i - p) > max(6, len(e) // (n * 3)) for p in peaks): peaks.append(i)
        if len(peaks) == n: break
    peaks.sort()
    cuts = [0] + [int(a + np.argmin(e[a:b])) for a, b in zip(peaks, peaks[1:])] + [len(e)]
    return cuts


def sing_word(voice, syl, fs, s16):
    """One word -> waveform on its notes. Returns (audio, lead-in seconds before the first note)."""
    text = re.sub(r"[^A-Za-z' ]", '', ''.join(s['text'] for s in syl)).strip() or 'ah'
    x = speak(voice, text)
    f0, t = pw.harvest(x, fs, frame_period=FP, f0_floor=80, f0_ceil=600)
    sp = pw.cheaptrick(x, f0, t, fs)
    ap = pw.d4c(x, f0, t, fs)
    energy = np.log1p(sp.sum(axis=1)); energy -= energy.min()
    voiced = (f0 > 0).astype(float)
    cuts = syllable_bounds(energy, voiced, len(syl))
    idx, pitch, prev = [], [], None
    lead = 0.0
    for k, s in enumerate(syl):
        a, b = cuts[k], cuts[k + 1]
        seg_e, seg_v = energy[a:b], voiced[a:b]
        core = np.where((seg_v > 0) & (seg_e > seg_e.max() * 0.55))[0]
        c0, c1 = (a + core[0], a + core[-1] + 1) if len(core) else (a, b)
        target = s['len'] * s16 * 1000 / FP  # frames this syllable must last
        onset, coda = c0 - a, b - c1
        if k == 0: lead = min(onset, 16) * FP / 1000  # consonants before the beat, vowel on it
        hold = max(4, target - onset - coda + (min(onset, 16) if k == 0 else 0))
        frames = list(range(a, c0)) + list(np.linspace(c0, c1 - 1, int(hold)).round().astype(int)) + list(range(c1, b))
        hz = 440 * 2 ** ((s['midi'] - 69) / 12)
        for j, fr in enumerate(frames):
            tt = j * FP / 1000
            p = hz
            if prev and tt < 0.06: p = prev * (hz / prev) ** (tt / 0.06)  # glide in from the previous note
            vib = min(1, max(0, (tt - 0.18) / 0.25)) * 0.22  # vibrato fades in on held notes (semitones)
            p *= 2 ** (vib * np.sin(2 * np.pi * 5.6 * tt) / 12)
            idx.append(fr); pitch.append(p if f0[fr] > 0 or (c0 <= fr < c1) else 0.0)
        prev = hz
    idx = np.array(idx)
    y = pw.synthesize(np.array(pitch), np.ascontiguousarray(sp[idx]), np.ascontiguousarray(ap[idx]), fs, FP)
    return y, lead


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    voice = PiperVoice.load(sys.argv[1])
    fs = voice.config.sample_rate
    sc = score()
    s16 = 60 / sc['bpm'] / 4
    song = np.zeros(int((sc['total'] * s16 + 2) * fs))
    cache = {}
    for w in words(sc['notes']):
        key = (tuple(s['text'] for s in w), tuple(s['midi'] for s in w), tuple(s['len'] for s in w))
        if key not in cache: cache[key] = sing_word(voice, w, fs, s16)
        y, lead = cache[key]
        at = int((w[0]['step'] * s16 - lead) * fs)
        song[at:at + len(y)] += y[:len(song) - at]
        if any(a <= w[0]['step'] < b for a, b in CHORUS):  # chorus double: second take, slightly late and detuned
            d = np.interp(np.arange(0, len(y), 1.004), np.arange(len(y)), y)
            o = at + int(0.018 * fs)
            song[o:o + len(d)] += 0.55 * d[:len(song) - o]
    song /= np.abs(song).max() + 1e-9
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'v.wav')
        sf.write(wav, song.astype(np.float32), fs)
        out = os.path.join(ROOT, 'static/sfx/vocals.ogg')
        delay = round(60 / sc['bpm'] * 0.75 * 1000)  # dotted-eighth echo, in time with the song
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af',
                        f'highpass=f=140,acompressor=threshold=-18dB:ratio=3:attack=8:release=120,aecho=0.85:0.6:{delay}|{delay * 2}:0.28|0.12,loudnorm=I=-18:TP=-2',
                        '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', out], check=True)
    print(f'{len(sc["notes"])} syllables, {len(cache)} unique words -> {out} ({os.path.getsize(out) // 1024} KB)')


if __name__ == '__main__':
    main()
