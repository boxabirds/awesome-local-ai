'use strict';

const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  muted: false,
  VOLUME: 0.4,

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.VOLUME;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.VOLUME;
    return this.muted;
  },

  tone(type, f0, f1, dur, gain, when) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (when || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  burst(filterFreq, dur, gain, when) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime + (when || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  shoot() {
    this.tone('square', 760, 140, 0.09, 0.07);
  },

  explode(tier) {
    const scale = tier + 1;
    this.burst(500 + tier * 380, 0.22 + tier * 0.14, 0.16 + tier * 0.1);
    this.tone('sawtooth', 120 * scale, 30, 0.3 + tier * 0.1, 0.08);
  },

  hit() {
    this.burst(300, 0.4, 0.5);
    this.tone('sine', 140, 32, 0.5, 0.5);
  },

  extraLife() {
    this.tone('sine', 520, 520, 0.09, 0.18, 0);
    this.tone('sine', 780, 780, 0.14, 0.18, 0.1);
  },

  wave() {
    this.tone('triangle', 420, 420, 0.08, 0.12, 0);
    this.tone('triangle', 640, 640, 0.12, 0.12, 0.09);
  },

  launch() {
    this.tone('sawtooth', 90, 420, 0.5, 0.12);
    this.burst(900, 0.4, 0.12);
  },

  gameOver() {
    this.tone('sawtooth', 220, 40, 1.1, 0.2);
    this.burst(400, 0.9, 0.25);
  }
};
