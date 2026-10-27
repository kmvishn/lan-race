const SAMPLES = {
  idle: 'sfx/engine_idle.wav', engine: 'sfx/engine.wav', squeal: 'sfx/squeal.wav', siren: 'sfx/siren.wav', crash: 'sfx/crash.wav',
  hit1: 'sfx/hit01.wav', hit2: 'sfx/hit02.wav', hit3: 'sfx/hit03.wav', hit4: 'sfx/hit04.wav', hit5: 'sfx/hit05.wav', hit6: 'sfx/hit06.wav',
};

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.buf = {}; this.ready = false; }

  // Builds the audio graph and decodes samples at boot (the context starts suspended until a user gesture), so the
  // first click only has to resume it instead of doing all this work in one frame.
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

    // Synth rasp layered quietly over the recorded engine at high revs.
    this.synth = ctx.createGain(); this.synth.gain.value = 0;
    this.synthFilter = ctx.createBiquadFilter(); this.synthFilter.type = 'lowpass'; this.synthFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.6);
    shaper.curve = curve;
    this.oscs = [];
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['sawtooth', 1.006, 0.4], ['square', 0.5, 0.3]]) {
      const o = ctx.createOscillator(); o.type = type;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn); gn.connect(shaper); o.start();
      this.oscs.push([o, mul]);
    }
    shaper.connect(this.synthFilter); this.synthFilter.connect(this.synth); this.synth.connect(this.sfx);

    const wn = noise();
    const wnF = ctx.createBiquadFilter(); wnF.type = 'lowpass'; wnF.frequency.value = 700;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    wn.connect(wnF); wnF.connect(this.wind); this.wind.connect(this.sfx);

    const nn = noise();
    const nnF = ctx.createBiquadFilter(); nnF.type = 'highpass'; nnF.frequency.value = 2500;
    this.nos = ctx.createGain(); this.nos.gain.value = 0;
    nn.connect(nnF); nnF.connect(this.nos); this.nos.connect(this.sfx);

    this.loadSamples();
  }

  start() {
    this.init();
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  get running() { return this.ctx?.state === 'running'; }

  async loadSamples() {
    const ctx = this.ctx;
    await Promise.all(Object.entries(SAMPLES).map(async ([k, url]) => {
      try { this.buf[k] = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()); } catch { /* sample missing: stays silent */ }
    }));
    const loop = (key) => {
      const g = ctx.createGain(); g.gain.value = 0;
      if (!this.buf[key]) return { g, src: null };
      const src = ctx.createBufferSource(); src.buffer = this.buf[key]; src.loop = true;
      src.connect(g); src.start();
      return { g, src };
    };
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 0.8;
    this.engFilter.connect(this.sfx);
    this.eng = loop('engine'); this.eng.g.connect(this.engFilter);
    this.idle = loop('idle'); this.idle.g.connect(this.engFilter);
    this.squeal = loop('squeal'); this.squeal.g.connect(this.sfx);
    this.siren = loop('siren'); this.siren.g.connect(this.sfx);
    this.ready = true;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  // car: CarPhysics-like (rpm, throttle, shift, slip, speed, nitroOn, handbrake, scraping)
  update(car, sirenLevel, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.04;
    const thr = car.shift > 0 ? 0.1 : car.throttle;
    const rpmN = Math.max(0, Math.min(1, (car.rpm - 900) / 7500));
    if (this.ready) {
      const idleW = active ? Math.max(0, 1 - (car.rpm - 900) / 1300) : 0;
      this.eng.src?.playbackRate.setTargetAtTime((0.75 + rpmN * 2.5) * (car.voice || 1), t, 0.03);
      this.idle.src?.playbackRate.setTargetAtTime((0.95 + rpmN * 0.6) * (car.voice || 1), t, 0.03);
      this.eng.g.gain.setTargetAtTime(active ? (0.32 + thr * 0.35) * (1 - idleW * 0.75) : 0, t, k);
      this.idle.g.gain.setTargetAtTime(idleW * 0.45, t, k);
      this.engFilter.frequency.setTargetAtTime(1200 + thr * 5000 + rpmN * 3000, t, k);
      const slide = active ? Math.min(1, Math.max(0, (car.slip - 0.12) * 3) * Math.min(1, car.speed / 10)) : 0;
      const hb = active && car.handbrake && car.speed > 6 ? 0.7 : 0;
      const scrape = active && car.scraping ? 0.4 : 0;
      this.squeal.g.gain.setTargetAtTime(Math.max(slide, hb, scrape) * 0.4, t, 0.05);
      this.squeal.src?.playbackRate.setTargetAtTime(0.85 + Math.min(0.35, car.speed / 250), t, 0.1);
      this.siren.g.gain.setTargetAtTime(sirenLevel * 0.35, t, 0.15);
    }
    for (const [o, mul] of this.oscs) o.frequency.setTargetAtTime((car.rpm / 60) * 2 * mul, t, 0.02);
    this.synthFilter.frequency.setTargetAtTime(400 + thr * 1800, t, k);
    this.synth.gain.setTargetAtTime(active ? 0.025 * rpmN * thr : 0, t, k);
    this.wind.gain.setTargetAtTime(active ? Math.min(0.28, (car.speed / 90) ** 2 * 0.28) : 0, t, k);
    this.nos.gain.setTargetAtTime(active && car.nitroOn ? 0.07 : 0, t, 0.05);
  }

  play(key, gain, rate = 1) {
    if (!this.ctx || this.muted || !this.buf[key]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[key]; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.sfx); s.start();
  }

  hit(strength) {
    const g = Math.min(1, 0.25 + strength / 22);
    this.play('hit' + (1 + Math.floor(Math.random() * 6)), g, 0.8 + Math.random() * 0.35);
    if (strength > 18) this.play('crash', Math.min(0.9, strength / 35), 0.9 + Math.random() * 0.2);
  }

  beep(freq, dur = 0.18) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  honk() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 0.42;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 420;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 525;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.setValueAtTime(0.16, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o1.connect(g); o2.connect(g); g.connect(this.sfx);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.4);
  }
}
