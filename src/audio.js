import { clamp, rand } from './util.js';

/* ---- persistence for the user's uploaded kill sound (IndexedDB) ---- */
const DB = 'brainrot-karts', STORE = 'files';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbDel(key) { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = res; }); }

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Default kill sound = a slice of public/sounds/cid-le-mdc.mp3.
 * start  = where the slice begins inside the clip (seconds)
 * length = how long it plays (seconds)
 * Currently 5.34 s -> 6.74 s of the 13.11 s clip. Edit these two numbers to move or resize the slice.
 */
export const KILL_CLIP = { start: 5.34, length: 1.40 };

/** Played when YOU get destroyed by another kart: a slice of public/sounds/death-whoooo.mp3 (seconds). */
export const DEATH_CLIP = { start: 1.37, length: 1.40 };

export const KILL_SOUNDS = [
  { id: 'boom', name: 'Vine Boom' },
  { id: 'airhorn', name: 'Airhorn Chaos' },
  { id: 'skibidi', name: 'Skibidi Jingle' },
  { id: 'bruh', name: 'Bruh' },
  { id: 'sigma', name: 'Sigma Chime' },
  { id: 'error', name: 'Windows Error Rave' },
  { id: 'random', name: 'Random Mix' },
  { id: 'cid', name: 'Cid le MDC (built-in clip)' },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 1, music: 0.45, kill: 1 };
    this.killChoice = 'boom';   // built-in id, or 'custom'
    this.customBuffer = null;
    this.customName = '';
    this.killMaxSec = 4;       // max length for an uploaded sound
    this.deathBuffer = null;
    this.cidBuffer = null;     // bundled clip, decoded lazily
    this.musicEnabled = true;
    this._lastFart = 0;
  }

  /* ---- boot (must happen from a user gesture) ---- */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.killBus = ctx.createGain(); this.killBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this._initLoops();
    this.loadStoredKill();
    this.loadCid();
    this.loadDeath();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfxBus.gain.value = this.vol.sfx;
    this.musicBus.gain.value = this.musicEnabled ? this.vol.music * 0.5 : 0;
    this.killBus.gain.value = this.vol.kill;
  }

  /* ---- primitives ---- */
  _out(o = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    const bus = o.bus || this.sfxBus;
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(bus);
    } else g.connect(bus);
    return g;
  }

  tone({ type = 'sine', f = 440, f2 = null, dur = 0.2, vol = 0.3, att = 0.005, delay = 0, lp = null, vib = 0, o = {} }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (lp) { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lp; osc.connect(flt); node = flt; }
    node.connect(g); g.connect(this._out(o));
    if (vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = vib; lg.gain.value = f * 0.12;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, f = 2000, f2 = null, type = 'lowpass', q = 1, att = 0.003, delay = 0, o = {} }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this._out(o));
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  /* ---- gameplay sounds (o = {vol, pan} for positional audio) ---- */
  fart(o, big = false) {
    const now = performance.now();
    if (!big && now - this._lastFart < 55) return;
    this._lastFart = now;
    const f = rand(70, 130) * (big ? 0.8 : 1);
    const d = big ? rand(0.35, 0.6) : rand(0.1, 0.19);
    this.tone({ type: 'sawtooth', f, f2: f * rand(0.5, 0.8), dur: d, vol: 0.34, lp: 650, vib: rand(22, 38), o });
    this.noise({ dur: d, vol: 0.16, f: rand(250, 520), f2: 160, type: 'bandpass', q: 1.5, o });
    if (big) this.tone({ type: 'square', f: f * 1.5, f2: f * 0.7, dur: d * 0.8, vol: 0.12, lp: 500, vib: 40, delay: 0.05, o });
  }
  explosion(size = 1, o) {
    this.noise({ dur: 0.7 * size, vol: 0.7, f: 2400, f2: 90, o });
    this.tone({ type: 'sine', f: 120, f2: 28, dur: 0.55 * size, vol: 0.9, o });
    this.noise({ dur: 0.25, vol: 0.4, f: 7000, f2: 800, type: 'highpass', o });
  }
  bump(o) { this.tone({ type: 'sine', f: 110, f2: 45, dur: 0.14, vol: 0.55, o }); this.noise({ dur: 0.08, vol: 0.18, f: 1200, f2: 300, o }); }
  hitMarker() { this.tone({ type: 'square', f: 1800, f2: 1200, dur: 0.06, vol: 0.14 }); }
  hurt(o) { this.tone({ type: 'sawtooth', f: 220, f2: 80, dur: 0.18, vol: 0.35, lp: 900, o }); }
  pickup() { [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f: mtof(72 + s), dur: 0.16, vol: 0.28, delay: i * 0.055 })); }
  roulette(i) { this.tone({ type: 'square', f: mtof(76 + (i % 5) * 2), dur: 0.05, vol: 0.1 }); }
  reveal() { this.tone({ type: 'square', f: mtof(88), dur: 0.12, vol: 0.2 }); this.tone({ type: 'square', f: mtof(95), dur: 0.2, vol: 0.2, delay: 0.08 }); }
  missile(o) {
    [67, 71, 74, 79].forEach((n, i) => this.tone({ type: 'triangle', f: mtof(n), dur: 0.11, vol: 0.28, delay: i * 0.07, o })); // tra-la-le-ro
    this.noise({ dur: 0.7, vol: 0.2, f: 500, f2: 3000, type: 'bandpass', q: 2, delay: 0.1, o });
  }
  whoosh(o) { this.noise({ dur: 0.18, vol: 0.22, f: 600, f2: 1800, type: 'bandpass', q: 3, o }); }
  clang(o) { this.tone({ type: 'square', f: 880, f2: 400, dur: 0.18, vol: 0.3, o }); this.tone({ type: 'triangle', f: 1320, dur: 0.25, vol: 0.2, o }); this.noise({ dur: 0.1, vol: 0.3, f: 5000, type: 'highpass', o }); }
  tung(o, n = 3) { // woodblock "tung tung tung"
    for (let i = 0; i < n; i++) {
      this.tone({ type: 'sine', f: 420, f2: 330, dur: 0.13, vol: 0.55, delay: i * 0.14, o });
      this.tone({ type: 'triangle', f: 840, f2: 640, dur: 0.07, vol: 0.2, delay: i * 0.14, o });
      this.noise({ dur: 0.03, vol: 0.25, f: 2500, type: 'highpass', delay: i * 0.14, o });
    }
  }
  shieldUp(o) { [0, 7, 12, 16].forEach((s, i) => this.tone({ type: 'sine', f: mtof(60 + s), dur: 0.3, vol: 0.2, delay: i * 0.05, o })); this.tung(o, 2); }
  shieldPop(o) { this.tone({ type: 'sine', f: 900, f2: 200, dur: 0.25, vol: 0.4, o }); this.noise({ dur: 0.2, vol: 0.3, f: 4000, f2: 500, type: 'highpass', o }); }
  siren(o) { for (let i = 0; i < 5; i++) this.tone({ type: 'sawtooth', f: i % 2 ? 540 : 760, dur: 0.2, vol: 0.18, lp: 1800, delay: i * 0.2, o }); }
  planeFly(o) { this.noise({ dur: 2.4, vol: 0.28, f: 200, f2: 700, type: 'lowpass', att: 0.6, o }); this.tone({ type: 'sawtooth', f: 90, f2: 70, dur: 2.4, vol: 0.22, att: 0.6, lp: 400, o }); }
  whistle(o) { this.tone({ type: 'sine', f: 2200, f2: 380, dur: 0.85, vol: 0.2, o }); }
  boost(o) { this.noise({ dur: 0.7, vol: 0.4, f: 400, f2: 6000, type: 'bandpass', q: 1.2, o }); this.tone({ type: 'sawtooth', f: 110, f2: 520, dur: 0.6, vol: 0.2, lp: 1500, o }); }
  miniBoost(tier, o) { this.noise({ dur: 0.3 + tier * 0.1, vol: 0.3, f: 500, f2: 5000, type: 'bandpass', o }); this.tone({ type: 'square', f: mtof(60 + tier * 4), f2: mtof(72 + tier * 4), dur: 0.2, vol: 0.12, o }); }
  driftTier(tier) { this.tone({ type: 'square', f: mtof(72 + tier * 5), dur: 0.09, vol: 0.12 }); }
  freeze(o) { [0, 5, 9, 12, 17].forEach((s, i) => this.tone({ type: 'sine', f: mtof(84 + s), dur: 0.5, vol: 0.2, delay: i * 0.04, o })); this.noise({ dur: 0.5, vol: 0.3, f: 8000, f2: 2000, type: 'highpass', o }); }
  frozenBreak(o) { this.noise({ dur: 0.25, vol: 0.4, f: 9000, f2: 3000, type: 'highpass', o }); this.tone({ type: 'triangle', f: 2400, f2: 600, dur: 0.2, vol: 0.2, o }); }
  warp(o) { this.tone({ type: 'sine', f: 200, f2: 1800, dur: 0.4, vol: 0.3, vib: 18, o }); this.tone({ type: 'sine', f: 1800, f2: 160, dur: 0.4, vol: 0.3, vib: 18, delay: 0.35, o }); }
  mine(o) { this.tone({ type: 'sine', f: 300, f2: 130, dur: 0.18, vol: 0.4, o }); this.tone({ type: 'sine', f: 520, f2: 200, dur: 0.12, vol: 0.2, delay: 0.1, o }); }
  flush(o) { this.noise({ dur: 0.8, vol: 0.4, f: 1800, f2: 300, type: 'bandpass', q: 0.6, o }); }
  slip(o) { this.tone({ type: 'sine', f: 400, f2: 1400, dur: 0.18, vol: 0.3, o }); this.tone({ type: 'sine', f: 1400, f2: 250, dur: 0.5, vol: 0.3, delay: 0.17, o }); }
  respawn() { [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'sine', f: mtof(60 + s), dur: 0.25, vol: 0.25, delay: i * 0.07 })); }
  beep(n, go) { this.tone({ type: 'square', f: go ? 880 : 440, dur: go ? 0.5 : 0.16, vol: 0.25 }); }
  click() { this.tone({ type: 'square', f: 900, f2: 600, dur: 0.05, vol: 0.12 }); }
  win() { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => this.tone({ type: 'square', f: mtof(64 + s), dur: 0.18, vol: 0.18, delay: i * 0.1 })); }
  deathBoom(o) { this.explosion(1.4, o); this.fart(o, true); }

  /* ---- kill sounds ---- */
  /** the buffer the trim controls apply to right now (null for the synthesized sounds) */
  clipBuffer(id = this.killChoice) { return id === 'cid' ? this.cidBuffer : id === 'custom' ? this.customBuffer : null; }

  async loadCid() {
    if (this.cidBuffer || !this.ctx) return this.cidBuffer;
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sounds/cid-le-mdc.mp3');
      this.cidBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.onCustomLoaded?.();
    } catch { /* offline or blocked: falls back to the boom */ }
    return this.cidBuffer;
  }

  async loadDeath() {
    if (this.deathBuffer || !this.ctx) return this.deathBuffer;
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sounds/death-whoooo.mp3');
      this.deathBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch { /* offline: no death sound */ }
    return this.deathBuffer;
  }

  playDeath() {
    if (!this.ctx) return;
    if (this.deathBuffer) this.playCustom(this.deathBuffer, DEATH_CLIP.start, DEATH_CLIP.length);
    else this.loadDeath();
  }

  playKill(choice) {
    if (!this.ctx) return;
    const id = choice || this.killChoice;
    if (id === 'cid') { if (this.cidBuffer) return this.playCustom(this.cidBuffer, KILL_CLIP.start, KILL_CLIP.length); this.loadCid(); return this.playKill('boom'); }
    if (id === 'custom' && this.customBuffer) return this.playCustom();
    let pickId = id === 'custom' || id === 'random' ? KILL_SOUNDS[Math.floor(Math.random() * 6)].id : id;
    const o = { bus: this.killBus };
    switch (pickId) {
      case 'boom':
        this.tone({ type: 'sine', f: 62, f2: 26, dur: 1.1, vol: 1, o });
        this.tone({ type: 'sawtooth', f: 180, f2: 40, dur: 0.5, vol: 0.5, lp: 700, o });
        this.noise({ dur: 0.6, vol: 0.6, f: 3000, f2: 120, o });
        break;
      case 'airhorn':
        for (let r = 0; r < 2; r++) [440, 554, 659, 880].forEach((f) => this.tone({ type: 'sawtooth', f: f * 1.01, dur: 0.32, vol: 0.2, lp: 3200, delay: r * 0.36, att: 0.02, o }));
        break;
      case 'skibidi':
        [64, 67, 64, 69, 67, 64, 62, 64].forEach((n, i) => this.tone({ type: 'square', f: mtof(n + 12), dur: 0.11, vol: 0.2, delay: i * 0.085, lp: 2600, o }));
        this.tone({ type: 'sine', f: 70, f2: 35, dur: 0.5, vol: 0.7, o });
        break;
      case 'bruh':
        this.tone({ type: 'sawtooth', f: 150, f2: 85, dur: 0.55, vol: 0.55, lp: 600, vib: 6, o });
        this.tone({ type: 'sawtooth', f: 300, f2: 170, dur: 0.5, vol: 0.2, lp: 900, o });
        break;
      case 'sigma':
        [0, 7, 12, 16, 19].forEach((s, i) => this.tone({ type: 'triangle', f: mtof(48 + s), dur: 1.0, vol: 0.25, delay: i * 0.05, o }));
        this.tone({ type: 'sine', f: 55, f2: 40, dur: 1, vol: 0.7, o });
        this.noise({ dur: 0.3, vol: 0.2, f: 9000, type: 'highpass', delay: 0.3, o });
        break;
      case 'error':
        [0, 0.14, 0.28, 0.5].forEach((d, i) => this.tone({ type: 'square', f: i % 2 ? 660 : 880, dur: 0.1, vol: 0.2, delay: d, o }));
        this.tone({ type: 'sine', f: 70, f2: 30, dur: 0.6, vol: 0.7, delay: 0.5, o });
        break;
    }
  }

  async setCustomFile(file) {
    this.init();
    const arr = await file.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(arr.slice(0)); // throws on unsupported audio
    this.customBuffer = buf;
    this.customName = file.name;
    try { await idbPut('killSound', { name: file.name, data: arr, type: file.type }); } catch { /* storage blocked; still usable this session */ }
    return buf.duration;
  }
  async loadStoredKill() {
    try {
      const rec = await idbGet('killSound');
      if (!rec) return false;
      this.customBuffer = await this.ctx.decodeAudioData(rec.data.slice(0));
      this.customName = rec.name;
      this.onCustomLoaded?.();
      return true;
    } catch { return false; }
  }
  async clearCustom() {
    this.customBuffer = null; this.customName = '';
    if (this.killChoice === 'custom') this.killChoice = 'boom';
    try { await idbDel('killSound'); } catch { /* ignore */ }
  }
  /** plays a slice of a clip with tiny fades so the cut never clicks (uploads play from 0 up to killMaxSec) */
  playCustom(buf = this.customBuffer, from = 0, length = this.killMaxSec) {
    if (!this.ctx || !buf) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    const start = Math.max(0, Math.min(from, buf.duration - 0.05));
    const dur = Math.max(0.05, Math.min(buf.duration - start, length));
    const fade = Math.min(0.12, dur / 3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.008);
    g.gain.setValueAtTime(1, t + dur - fade);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g); g.connect(this.killBus);
    src.start(t, start, dur);
    this._customSrc?.stop?.(); // never stack multiple copies of a long clip
    this._customSrc = src;
  }

  /* ---- announcer (Web Speech) ---- */
  speak(text, pitch = 1.6, rate = 1.15) {
    if (!this.announcer || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch; u.rate = rate; u.volume = clamp(this.vol.master, 0, 1);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  /* ---- continuous loops: engine + drift screech ---- */
  _initLoops() {
    const ctx = this.ctx;
    this.eng = { osc: ctx.createOscillator(), osc2: ctx.createOscillator(), g: ctx.createGain(), lp: ctx.createBiquadFilter(), on: false };
    this.eng.osc.type = 'sawtooth'; this.eng.osc2.type = 'square';
    this.eng.lp.type = 'lowpass'; this.eng.lp.frequency.value = 500;
    this.eng.g.gain.value = 0;
    this.eng.osc.connect(this.eng.lp); this.eng.osc2.connect(this.eng.lp);
    this.eng.lp.connect(this.eng.g); this.eng.g.connect(this.sfxBus);
    this.eng.osc.start(); this.eng.osc2.start();
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus); src.start();
    this.screech = { g, bp };
  }
  engine(on, speedNorm = 0, boosting = false) {
    if (!this.ctx) return;
    const e = this.eng, t = this.ctx.currentTime;
    const f = 48 + speedNorm * 110 + (boosting ? 40 : 0);
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.lp.frequency.setTargetAtTime(350 + speedNorm * 900, t, 0.08);
    e.g.gain.setTargetAtTime(on ? 0.06 + speedNorm * 0.07 : 0, t, 0.08);
  }
  drift(level) { // 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.screech.g.gain.setTargetAtTime(level * 0.09, t, 0.05);
    this.screech.bp.frequency.setTargetAtTime(1500 + level * 700, t, 0.1);
  }
  silenceLoops() { this.engine(false); this.drift(0); }

  /* ---- music: tiny procedural chiptune-brainrot loop ---- */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bpm = 152, step = 60 / bpm / 4;
    let next = this.ctx.currentTime + 0.1, i = 0;
    const lead = [0, 3, 5, 7, 5, 3, 0, 3, 7, 10, 7, 5, 3, 5, 0, -2, 0, 3, 5, 7, 12, 10, 7, 5, 3, 0, 3, 5, 7, 5, 3, 0];
    const roots = [33, 33, 36, 31]; // A1 A1 C2 G1
    this.musicTimer = setInterval(() => {
      while (next < this.ctx.currentTime + 0.3) {
        const s = i % 64, bar = (s >> 4) & 3, d = next - this.ctx.currentTime, o = { bus: this.musicBus };
        if (s % 4 === 0) this.tone({ type: 'sine', f: 140, f2: 38, dur: 0.14, vol: 0.9, delay: d, o });
        if (s % 8 === 4) this.noise({ dur: 0.1, vol: 0.35, f: 2400, type: 'bandpass', delay: d, o });
        if (s % 2 === 1) this.noise({ dur: 0.03, vol: 0.12, f: 8000, type: 'highpass', delay: d, o });
        if (s % 2 === 0) this.tone({ type: 'square', f: mtof(roots[bar] + (s % 8 === 6 ? 12 : 0)), dur: step * 1.8, vol: 0.18, lp: 700, delay: d, o });
        const ln = lead[(s >> 1) % lead.length];
        if (s % 2 === 0 || s % 8 === 7) this.tone({ type: 'triangle', f: mtof(69 + ln + (bar === 2 ? 3 : 0)), dur: step * 1.6, vol: 0.2, delay: d, o });
        next += step; i++;
      }
    }, 60);
  }
  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }
}

export const audio = new AudioEngine();
