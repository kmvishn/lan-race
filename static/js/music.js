// "Neon Harbor Nights" — original synthwave lobby track, sequenced live with WebAudio.
const BPM = 104;
const S16 = 60 / BPM / 4;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = (n) => { const m = n.match(/^([A-G]#?)(-?\d)$/); return NOTE[m[1]] + (+m[2] + 1) * 12; };
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORD = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], Em: [52, 55, 59] };

// [syllable, note, length in 8ths]; each line is two bars (16 eighths).
const V1 = [
  [['Rain ', 'E4', 2], ['on ', 'E4', 1], ['the ', 'D4', 1], ['as', 'E4', 1], ['phalt, ', 'G4', 3], ['the ', 'G4', 1], ['ci', 'A4', 1], ["ty's ", 'G4', 1], ['a', 'E4', 1], ['wake', 'D4', 4]],
  [['Red ', 'E4', 2], ['lights ', 'E4', 1], ['are ', 'D4', 1], ['fal', 'E4', 1], ['ling, ', 'G4', 3], ["there's ", 'G4', 1], ['no ', 'A4', 1], ['time ', 'C5', 1], ['to ', 'B4', 1], ['brake', 'A4', 4]],
  [['Shi', 'A4', 1], ['bu', 'A4', 1], ["ya's ", 'G4', 1], ['bur', 'E4', 1], ['ning ', 'G4', 4], ['in ', 'G4', 1], ['vio', 'A4', 1], ['let ', 'G4', 1], ['and ', 'E4', 1], ['blue', 'D4', 4]],
  [['Ev', 'E4', 1], ['ery ', 'E4', 1], ['ho', 'D4', 1], ['ri', 'E4', 1], ['zon ', 'G4', 4], ['is ', 'A4', 1], ['cal', 'B4', 1], ['ling ', 'C5', 1], ['for ', 'B4', 1], ['you', 'A4', 4]],
];
const V2 = [
  [['Wires ', 'E4', 2], ['a', 'E4', 1], ['bove ', 'D4', 1], ['us ', 'E4', 1], ['like ', 'G4', 3], ['strings ', 'G4', 2], ['of ', 'A4', 1], ['a ', 'G4', 1], ['song', 'E4', 4]],
  [['Kan', 'E4', 1], ['ji ', 'E4', 1], ['in ', 'D4', 1], ['the ', 'E4', 1], ['win', 'G4', 4], ['dows ', 'G4', 1], ['to ', 'A4', 1], ['guide ', 'C5', 1], ['us ', 'B4', 1], ['a', 'A4', 1], ['long', 'A4', 3]],
  [['Si', 'A4', 1], ['rens ', 'A4', 1], ['are ', 'G4', 1], ['sing', 'E4', 1], ['ing ', 'G4', 4], ['a ', 'G4', 1], ['two-', 'A4', 1], ['tone ', 'G4', 1], ['re', 'E4', 1], ['frain', 'D4', 4]],
  [['Lose ', 'E4', 1], ['them ', 'E4', 1], ['in ', 'D4', 1], ['the ', 'E4', 1], ['tun', 'G4', 2], ['nel, ', 'G4', 2], ["we're ", 'A4', 1], ['gone ', 'B4', 1], ['in ', 'C5', 1], ['the ', 'B4', 1], ['rain', 'A4', 4]],
];
const CH = [
  [['Ne', 'A4', 1], ['on ', 'C5', 1], ['Har', 'D5', 1], ['bor ', 'E5', 1], ['nights, ', 'E5', 4], ["we're ", 'D5', 1], ['run', 'C5', 1], ['ning ', 'D5', 1], ['with ', 'E5', 1], ['the ', 'D5', 1], ['lights', 'C5', 3]],
  [['En', 'A4', 1], ['gines ', 'C5', 1], ['in ', 'D5', 1], ['the ', 'E5', 1], ['dark, ', 'G5', 4], ['a ', 'E5', 1], ['heart', 'D5', 1], ['beat ', 'C5', 1], ['and ', 'D5', 1], ['a ', 'C5', 1], ['spark', 'A4', 3]],
  [['Hold ', 'A4', 2], ['on, ', 'C5', 2], ["don't ", 'D5', 1], ['look ', 'E5', 1], ['back, ', 'E5', 2], ['the ', 'D5', 1], ['ci', 'C5', 1], ["ty's ", 'D5', 1], ['on ', 'E5', 1], ['our ', 'D5', 1], ['track', 'C5', 3]],
  [['Ne', 'A4', 1], ['on ', 'C5', 1], ['Har', 'D5', 1], ['bor ', 'E5', 1], ['nights, ', 'G5', 4], ['we ', 'E5', 1], ['ride ', 'D5', 1], ['till ', 'C5', 1], ['the ', 'B4', 1], ['mor', 'C5', 1], ['ning', 'A4', 3]],
];
const VERSE_CHORDS = ['Am', 'F', 'C', 'G'], CHORUS_CHORDS = ['F', 'G', 'Am', 'Em'];
const SECTIONS = [
  { bars: 8, chords: VERSE_CHORDS, drums: 0, bass: 0, arp: 1 },
  { bars: 8, chords: VERSE_CHORDS, drums: 1, bass: 1, arp: 1, lead: V1 },
  { bars: 8, chords: CHORUS_CHORDS, drums: 2, bass: 1, arp: 1, lead: CH },
  { bars: 4, chords: VERSE_CHORDS, drums: 0, bass: 1, arp: 1 },
  { bars: 8, chords: VERSE_CHORDS, drums: 1, bass: 1, arp: 1, lead: V2 },
  { bars: 8, chords: CHORUS_CHORDS, drums: 2, bass: 1, arp: 1, lead: CH },
  { bars: 4, chords: ['Am', 'F', 'Am', 'Am'], drums: 0, bass: 0, arp: 1 },
];
const FORMANTS = { a: [730, 1090], e: [530, 1840], i: [300, 2250], o: [570, 840], u: [330, 870] };
const vowel = (s) => { const m = s.toLowerCase().replace(/y/g, 'i').match(/[aeiou]/); return m ? m[0] : 'a'; };

function buildTimeline() {
  const steps = []; // per 16th: {chord, sec, bar}
  const notes = []; // lead notes: {step, len, midi, text, line}
  const lines = []; // {start, end, syl:[{step, text}]}
  let s = 0;
  for (const sec of SECTIONS) {
    const start = s;
    for (let b = 0; b < sec.bars; b++) for (let k = 0; k < 16; k++) steps.push({ chord: sec.chords[b % 4], sec, k, bar: b });
    if (sec.lead) {
      for (let rep = 0; rep < sec.bars / 8; rep++) {
        sec.lead.forEach((line, li) => {
          let p = start + rep * 128 + li * 32;
          const L = { start: p, syl: [] };
          for (const [text, n, len] of line) {
            notes.push({ step: p, len: len * 2, midi: midi(n), text });
            L.syl.push({ step: p, text });
            p += len * 2;
          }
          L.end = start + rep * 128 + li * 32 + 32;
          lines.push(L);
        });
      }
    }
    s += sec.bars * 16;
  }
  return { steps, notes, lines, total: s };
}

export class Music {
  constructor(audio) {
    this.a = audio;
    this.tl = buildTimeline();
    this.on = false;
    this.title = 'NEON HARBOR NIGHTS';
  }

  init() {
    const ctx = this.a.ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.connect(this.a.music);
    this.duck = ctx.createGain(); this.duck.connect(this.bus);
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3; }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.35;
    this.verb.connect(verbOut); verbOut.connect(this.bus);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = S16 * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    const dOut = ctx.createGain(); dOut.gain.value = 0.3; dlp.connect(dOut); dOut.connect(this.bus);
    this.noise = this.a.noiseBuf;
    // Sung vocal (rendered offline by scripts/make-vocals.py, aligned to step 0 of the song).
    this.vocalBus = ctx.createGain(); this.vocalBus.gain.value = 0.95;
    this.vocalBus.connect(this.bus); this.vocalBus.connect(this.verb);
    this.vocalSrcs = [];
    fetch('sfx/vocals.ogg').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then((b) => ctx.decodeAudioData(b)).then((buf) => {
      this.vocal = buf;
      const into = ctx.currentTime - this.t0; // arrived mid-song: join at the right spot
      if (this.on && into >= 0 && into < buf.duration) this.playVocal(ctx.currentTime + 0.05, into + 0.05);
    }).catch(() => { /* no vocal file: the talkbox carries the melody */ });
  }

  playVocal(t, offset = 0) {
    const src = this.a.ctx.createBufferSource();
    src.buffer = this.vocal; src.connect(this.vocalBus); src.start(t, offset);
    src.onended = () => { this.vocalSrcs = this.vocalSrcs.filter((x) => x !== src); };
    this.vocalSrcs.push(src);
  }

  start() {
    const ctx = this.a.ctx;
    if (!ctx || this.on) return;
    if (!this.bus) this.init();
    this.on = true;
    this.t0 = ctx.currentTime + 0.15;
    this.next = this.t0; this.step = 0;
    this.bus.gain.cancelScheduledValues(ctx.currentTime);
    this.bus.gain.setTargetAtTime(0.8, ctx.currentTime, 0.6);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    const ctx = this.a.ctx;
    this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    for (const src of this.vocalSrcs) src.stop(ctx.currentTime + 2);
    setTimeout(() => { if (!this.on) clearInterval(this.timer); }, 2500);
  }

  schedule() {
    const ctx = this.a.ctx;
    while (this.next < ctx.currentTime + 0.12) {
      if (this.step === 0 && this.vocal) this.playVocal(this.next);
      this.play(this.step, this.next);
      this.step = (this.step + 1) % this.tl.total;
      if (this.step === 0) this.t0 = this.next + S16;
      this.next += S16;
    }
  }

  play(i, t) {
    const st = this.tl.steps[i], sec = st.sec, k = st.k;
    const chord = CHORD[st.chord];
    if (sec.drums) {
      const four = sec.drums === 2;
      if (k % 8 === 0 || (four && k % 4 === 0)) this.kick(t);
      if (k === 4 || k === 12) this.snare(t);
      if (k % 2 === 0) this.hat(t, 0.05, 0.04);
      if (four && k % 4 === 2) this.hat(t, 0.08, 0.18);
    }
    if (sec.bass && k % 2 === 0) this.bass(t, chord[0] - 24 + (k % 8 === 6 ? 12 : 0), S16 * 1.7);
    if (k === 0) this.pad(t, chord, S16 * 16);
    if (sec.arp) {
      const seq = [0, 1, 2, 1, 0, 2, 1, 2];
      this.arp(t, chord[seq[k % 8]] + 12 + (k >= 8 ? 12 : 0));
    }
    for (const n of this.tl.notes) if (n.step === i) this.voice(t, n);
  }

  env(g, t, a, peak, d, sustain, rel, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(sustain, t + a, d);
    g.gain.setTargetAtTime(0.0001, end, rel);
  }

  kick(t) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.4);
    this.duck.gain.setValueAtTime(0.35, t); this.duck.gain.linearRampToValueAtTime(1, t + 0.28);
  }

  snare(t) {
    const ctx = this.a.ctx;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(f); f.connect(g); g.connect(this.bus); g.connect(this.verb);
    n.start(t, Math.random()); n.stop(t + 0.3);
    const o = ctx.createOscillator(); o.frequency.value = 190;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.bus); o.start(t); o.stop(t + 0.12);
  }

  hat(t, vol, len) {
    const ctx = this.a.ctx;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f); f.connect(g); g.connect(this.bus);
    n.start(t, Math.random()); n.stop(t + len + 0.02);
  }

  bass(t, m, len) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(220, t + len);
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.28, 0.08, 0.18, 0.03, t + len);
    o.connect(f); f.connect(g); g.connect(this.duck); o.start(t); o.stop(t + len + 0.2);
  }

  pad(t, chord, len) {
    const ctx = this.a.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
    const g = ctx.createGain(); this.env(g, t, 0.6, 0.09, 1, 0.07, 0.5, t + len - 0.1);
    f.connect(g); g.connect(this.duck); g.connect(this.verb);
    for (const m of chord) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + len + 2);
    }
  }

  arp(t, m) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.15);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    o.connect(f); f.connect(g); g.connect(this.duck); g.connect(this.delay);
    o.start(t); o.stop(t + 0.2);
  }

  // Talkbox-style lead: a saw through two vowel formants picked from the lyric syllable.
  voice(t, n) {
    const ctx = this.a.ctx, len = n.len * S16;
    const [f1, f2] = FORMANTS[vowel(n.text)];
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n.midi);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = hz(n.midi) * 0.5; o2.detune.value = 4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz(n.midi) * 0.012, t + Math.min(0.35, len));
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const mix = ctx.createGain(); mix.gain.value = 1;
    o.connect(mix); const o2g = ctx.createGain(); o2g.gain.value = 0.4; o2.connect(o2g); o2g.connect(mix);
    const lvl = this.vocal ? 0.22 : 1; // with the sung vocal the talkbox just doubles it quietly
    const out = ctx.createGain(); this.env(out, t, 0.03, 0.55 * lvl, 0.2, 0.42 * lvl, 0.06, t + len * 0.92);
    for (const [fq, q, gn] of [[f1, 9, 1], [f2, 11, 0.7], [2900, 6, 0.25]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = gn * 2.2;
      mix.connect(bp); bp.connect(bg); bg.connect(out);
    }
    out.connect(this.bus); out.connect(this.verb); out.connect(this.delay);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + len + 0.4); }
  }

  // Current karaoke state for the lobby display.
  lyrics() {
    if (!this.on || !this.a.ctx) return null;
    const pos = (this.a.ctx.currentTime - this.t0) / S16;
    if (pos < 0) return { line: null };
    const step = pos % this.tl.total;
    const L = this.tl.lines.find((l) => step >= l.start - 6 && step < l.end - 2);
    if (!L) {
      const nxt = this.tl.lines.find((l) => l.start > step);
      return { line: null, next: nxt && nxt.start - step < 24 ? nxt.syl.map((s) => s.text).join('') : '' };
    }
    const idx = L.syl.filter((s) => s.step <= step).length;
    const nxt = this.tl.lines[this.tl.lines.indexOf(L) + 1];
    return { line: L.syl.map((s) => s.text), idx, next: nxt && nxt.start - L.end < 8 ? nxt.syl.map((s) => s.text).join('') : '' };
  }
}
