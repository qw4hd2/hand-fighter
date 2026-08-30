// Tiny synthesized sound effects with WebAudio — no asset files needed.
class SFX {
  constructor() { this.ctx = null; }

  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* audio unavailable — game plays silently */ }
  }

  _env(gainNode, t0, peak, dur) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + 0.01);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  _osc(type, freq, freqEnd, peak, dur) {
    const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    this._env(g, t0, peak, dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  _noise(peak, dur, filterFreq) {
    const c = this.ctx, t0 = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq;
    const g = c.createGain(); this._env(g, t0, peak, dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
  }

  play(name) {
    if (!this.ctx) return;
    try {
      switch (name) {
        case 'whoosh': this._noise(0.15, 0.12, 900); break;
        case 'hit':    this._osc('square', 160, 55, 0.35, 0.16); this._noise(0.2, 0.1, 500); break;
        case 'block':  this._osc('triangle', 700, 500, 0.2, 0.1); break;
        case 'jump':   this._osc('sine', 240, 480, 0.12, 0.15); break;
        case 'bell':   this._osc('sine', 880, 870, 0.25, 0.5); this._osc('sine', 1320, 1310, 0.12, 0.4); break;
        case 'ko':     this._osc('sine', 130, 40, 0.5, 0.9); this._noise(0.25, 0.3, 250); break;
        case 'win':    this._osc('sine', 523, 523, 0.2, 0.25);
                       setTimeout(() => this._osc('sine', 659, 659, 0.2, 0.25), 180);
                       setTimeout(() => this._osc('sine', 784, 784, 0.25, 0.5), 360);
                       break;
      }
    } catch (e) { /* ignore audio errors */ }
  }
}

export const sfx = new SFX();
