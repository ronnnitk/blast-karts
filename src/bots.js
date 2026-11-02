import { clamp, angDiff, rand } from './util.js';

export const BOT_NAMES = [
  'Tung Tung Sahur', 'Skibidi Sigma', 'Lirili Larila', 'Bombardiro', 'Tralalero', 'Cappuccino Ass.', 'Brr Brr Patapim', 'Trippi Troppi',
  'Bobrito Bandito', 'Chimpanzini', 'Boneca Ambalabu', 'Glorbo', 'Fanum Tax', 'Ohio Final Boss', 'Grimace', 'Rizzler',
];

export const DIFFICULTY = {
  chill:  { aim: 0.22, react: 0.9, speed: 0.82, drift: 0.2, use: 0.5 },
  normal: { aim: 0.12, react: 0.5, speed: 0.93, drift: 0.55, use: 0.8 },
  sweaty: { aim: 0.05, react: 0.2, speed: 1.0, drift: 0.9, use: 1.0 },
};

export class BotBrain {
  constructor(kart, game, diff) {
    this.k = kart;
    this.g = game;
    this.d = DIFFICULTY[diff] || DIFFICULTY.normal;
    this.path = [];
    this.pathT = 0;
    this.goalT = 0;
    this.goal = null;
    this.stuckT = 0;
    this.reverseT = 0;
    this.reverseSteer = 1;
    this.useDelay = 0;
    this.burst = 0;
    this.driftHold = 0;
    this.phase = rand(0, 10);
    this.target = null;
  }

  enemies() { return this.g.karts.filter((o) => o !== this.k && !o.dead); }

  think(dt) {
    const k = this.k, g = this.g, w = g.world;
    const inp = { steer: 0, throttle: 1, drift: false, fire: false };
    if (k.dead) return inp;

    /* ---- stuck detection ---- */
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = -1; inp.steer = this.reverseSteer;
      return inp;
    }
    if (k.speed < 2.5 && k.frozenT <= 0 && k.spinT <= 0) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.7) {
      this.stuckT = 0; this.reverseT = 0.8; this.reverseSteer = Math.random() < 0.5 ? 1 : -1; this.path = []; this.pathT = 0;
    }

    /* ---- goal selection ---- */
    this.goalT -= dt;
    const en = this.enemies();
    let nearest = null, nd = Infinity;
    for (const o of en) { const d = Math.hypot(o.x - k.x, o.z - k.z); if (d < nd) { nd = d; nearest = o; } }
    if (this.goalT <= 0) {
      this.goalT = 0.5 + Math.random() * 0.3;
      this.goal = null;
      if (!k.item || k.rouletteT > 0) {
        let bd = Infinity, bb = null;
        for (const ib of w.itemBoxes) {
          if (!ib.active) continue;
          const d = Math.hypot(ib.x - k.x, ib.z - k.z);
          if (d < bd) { bd = d; bb = ib; }
        }
        if (bb && (bd < 75 || !nearest)) this.goal = { x: bb.x, z: bb.z, kind: 'box' };
      }
      if (!this.goal && nearest) this.goal = { x: nearest.x, z: nearest.z, kind: 'enemy', ref: nearest };
      if (!this.goal) { const p = w.randomPoint(); this.goal = { x: p.x, z: p.z, kind: 'wander' }; }
    }
    if (this.goal?.kind === 'enemy' && this.goal.ref && !this.goal.ref.dead) { this.goal.x = this.goal.ref.x; this.goal.z = this.goal.ref.z; }
    if (this.goal && Math.hypot(this.goal.x - k.x, this.goal.z - k.z) < 3.5 && this.goal.kind !== 'enemy') this.goalT = 0;

    /* ---- aiming / combat ---- */
    const it = k.item;
    let aim = null;
    let los = false, ang = 0;
    if (nearest) {
      los = !w.segmentBlocked(k.x, k.z, nearest.x, nearest.z, 0.8);
      ang = angDiff(k.h, Math.atan2(nearest.x - k.x, nearest.z - k.z));
    }
    if (it && k.rouletteT <= 0) {
      this.useDelay += dt;
      const ready = this.useDelay > this.d.react;
      switch (it.type) {
        case 'fart':
          if (nearest && los && nd < 46) {
            const lead = nd / 66;
            aim = { x: nearest.x + nearest.vx * lead, z: nearest.z + nearest.vz * lead };
            if (ready && Math.abs(ang) < 0.28 + (1 - this.d.aim) * 0.15) this.burst = Math.max(this.burst, rand(0.5, 1.1));
          }
          break;
        case 'missile':
          if (ready && nearest && los && nd < 75 && Math.abs(ang) < 1.0 && Math.random() < this.d.use) inp.fire = true;
          break;
        case 'spike': if (ready && nearest && nd < 22) inp.fire = true; break;
        case 'bubble': if (ready && ((nearest && nd < 32) || k.hp < 60)) inp.fire = true; break;
        case 'gun': if (ready && nearest && nd < 38) inp.fire = true; break;
        case 'rockets': // dead-straight shots: line up first
          if (nearest && los && nd < 62) {
            aim = { x: nearest.x + nearest.vx * (nd / 78), z: nearest.z + nearest.vz * (nd / 78) };
            if (ready && Math.abs(ang) < 0.1 + (1 - this.d.aim) * 0.1 && Math.random() < this.d.use) inp.fire = true;
          }
          break;
        case 'bombardiro': if (ready && nearest && nd < 70) inp.fire = true; break;
        case 'freeze': if (ready && en.some((o) => Math.hypot(o.x - k.x, o.z - k.z) < 19)) inp.fire = true; break;
        case 'warp': if (ready && (k.hp < 35 || (nearest && nd < 12 && k.hp < 55))) inp.fire = true; break;
        case 'boost': if (ready && !k.drifting && k.speed > 12 && !w.segmentBlocked(k.x, k.z, k.x + Math.sin(k.h) * 30, k.z + Math.cos(k.h) * 30, 1.5)) inp.fire = true; break;
        case 'mine': case 'banana':
          if (ready && nearest && nd < 26 && Math.abs(ang) > 1.9) inp.fire = true; // someone's on our tail
          else if (this.useDelay > 9) inp.fire = true;
          break;
      }
    } else this.useDelay = 0;
    if (this.burst > 0) { this.burst -= dt; inp.fire = true; if (!it || it.type !== 'fart') this.burst = 0; }

    /* ---- steering target ---- */
    let tx, tz;
    if (aim) { tx = aim.x; tz = aim.z; }
    else if (this.goal) {
      this.pathT -= dt;
      if (this.pathT <= 0 || !this.path.length) {
        this.path = w.findPath(k.x, k.z, this.goal.x, this.goal.z);
        this.pathT = 0.7 + Math.random() * 0.4;
      }
      while (this.path.length > 1 && (Math.hypot(this.path[0].x - k.x, this.path[0].z - k.z) < 5 ||
        (!w.segmentBlocked(k.x, k.z, this.path[1].x, this.path[1].z, 1.3) && Math.hypot(this.path[0].x - k.x, this.path[0].z - k.z) < 14))) this.path.shift();
      tx = this.path[0].x; tz = this.path[0].z;
    } else { tx = k.x + Math.sin(k.h) * 10; tz = k.z + Math.cos(k.h) * 10; }

    const desired = Math.atan2(tx - k.x, tz - k.z);
    let diff = angDiff(k.h, desired);

    // feelers: nudge away from walls we're about to scrape
    const f = [[0.0, 7], [0.55, 6], [-0.55, 6]];
    const hits = f.map(([a, d]) => w.blockedPoint(k.x + Math.sin(k.h + a) * d, k.z + Math.cos(k.h + a) * d, 1.3));
    if (!aim) {
      if (hits[1] && !hits[2]) diff -= 0.5;
      else if (hits[2] && !hits[1]) diff += 0.5;
      else if (hits[0]) diff += (hits[1] ? 0.9 : -0.9);
    }
    diff += Math.sin(g.time * 1.7 + this.phase) * 0.04;
    diff += (Math.random() - 0.5) * this.d.aim * (aim ? 0.6 : 0);

    inp.steer = -clamp(diff * 2.6, -1, 1);
    const sharp = Math.abs(diff);
    inp.throttle = this.d.speed * (sharp > 1.5 && k.speed > 12 ? 0.2 : 1);
    if (hits[0] && k.speed > 16) inp.throttle = 0.4;

    // drifting through corners
    if (this.driftHold > 0) {
      this.driftHold -= dt;
      inp.drift = sharp > 0.12 || this.driftHold > 0.6;
      if (sharp < 0.1) this.driftHold = Math.min(this.driftHold, 0.05);
    } else if (!aim && sharp > 0.6 && sharp < 1.6 && k.speed > 19 && Math.random() < this.d.drift * dt * 3) {
      this.driftHold = rand(0.8, 1.8);
      inp.drift = true;
    }
    return inp;
  }
}
