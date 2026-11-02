import * as THREE from 'three';
import { clamp, damp, lerpAngle, angDiff } from './util.js';
import { createKartModel } from './kartmodel.js';
import { KART_R } from './world.js';

export const MAX_HP = 100;
/* ---- handling tunables (edit these to change the feel) ---- */
const MAX_SPEED = 30;            // top speed, units/s
const BOOST_SPEED = 46;          // speed cap while a mini-turbo is running
const ACC = 25;                  // forward acceleration
const BRAKE = 55;
const REV_SPEED = 25;
const COAST = 6;                 // rolling deceleration with no throttle
const BASE_TURN = 3;           // yaw rate (rad/s) at low speed with full steer
const HIGH_SPEED_TURN = 1.5;    // fraction of BASE_TURN left at MAX_SPEED -> wide arcs at top speed
const LATERAL_FRICTION = 11;     // sideways-velocity decay (1/s). Lower = slidier
const HIGH_SPEED_SLIP = 0.71;    // how much of that friction is lost when steering at top speed (centrifugal slip)
const DRIFT_TURN = 10.8;          // yaw rate (rad/s) while drifting (over-rotates relative to the velocity vector)
const DRIFT_FRICTION = 2.8;      // lateral friction while drifting
const TRACTION_RECOVER = 0.2;    // seconds to blend back from drift friction to normal after a drift ends
const TURBO_INTENSITY = 1;       // scales the mini-turbo boost time and the forward kick
const DRIFT_TIERS = [0.55, 1.3, 2.2];   // spark colours / sounds at these drift durations (boost itself is proportional)
// W-tapping: pulsing the gas disrupts momentum, which loosens the turning limit and lets the kart pivot on a dime
const TAP_WINDOW = 0.9;          // seconds in which taps are counted
const TAP_COUNT = 3;             // taps inside the window that trigger pivot mode
const PIVOT_HOLD = 0.5;          // pivot mode lasts this long after the latest tap
const PIVOT_TURN_MUL = 2.2;      // yaw-rate multiplier in pivot mode (spec: 1.75-2.0)
const PIVOT_SPEED_CAP = 11;      // forward speed is bled down toward this while pivoting

const _tmp = new THREE.Color();

export class Kart {
  constructor(game, info) {
    this.game = game;
    this.id = info.id;
    this.name = info.name;
    this.colorHex = info.color;
    this.head = info.head ?? 0;
    this.isLocal = !!info.isLocal;
    this.isBot = !!info.isBot;
    this.remote = !!info.remote;
    this.authoritative = !this.remote;  // this client decides whether the kart takes damage
    this.skill = info.skill ?? 0.7;
    this.model = createKartModel(info.color, this.head);
    this.model.setName(info.name);
    this.model.label.visible = !this.isLocal;
    game.scene.add(this.model.root, this.model.label);
    this.kills = 0; this.deaths = 0; this.streak = 0; this.multiT = 0; this.multi = 0;
    this.hardReset(0, 0, 0);
  }

  hardReset(x, z, h) {
    this.x = x; this.z = z; this.h = h; this.vx = 0; this.vz = 0;
    this.hp = MAX_HP; this.dead = false; this.deadT = 0;
    this.invuln = 0;
    this.drifting = 0; this.driftT = 0; this.driftTier = 0;
    this.boostTime = 0; this.spinT = 0; this.frozenT = 0;
    this.item = null; this.rouletteT = 0; this.rouletteFinal = null;
    this.shieldT = 0; this.spikeT = 0; this.gunT = 0; this.gunAmmo = 0; this.gunCD = 0; this.gunAim = 0; this.gunMesh = null; this.spikeAng = 0; this.spikeCD = new Map();
    this.fireCD = 0; this.hitFlash = 0;
    this.steerVis = 0; this.leanVis = 0; this.yawVis = 0; this.wheelRot = 0;
    this.speed = 0; this.steerIn = 0; this.hop = 0;
    this.tapTimes = []; this.thrDown = false; this.clock = 0; this.pivotT = 0; this.tractionT = 0;
    this.lastHitBy = null; this.lastHitT = 0;
    this.net = null;
    this.model.root.visible = true;
    this.model.label.visible = !this.isLocal;
  }

  /* ------------------------------------------------------------ physics */
  step(dt, inp, world) {
    if (this.dead) return;
    if (this.boostTime > 0) this.boostTime -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.fireCD > 0) this.fireCD -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.game.weapons.onShieldEnd(this); }
    if (this.spikeT > 0) this.spikeT -= dt;
    if (this.frozenT > 0) { this.frozenT -= dt; if (this.frozenT <= 0) this.game.audio.frozenBreak(this.game.spatial(this.x, this.z)); }
    if (this.rouletteT > 0) this.rouletteT -= dt;

    // steering ramps toward the stick/key instead of snapping: karts feel weighty, and releasing re-centres faster
    const rate = Math.abs(inp.steer) > Math.abs(this.steerIn) ? 8.5 : 13;
    this.steerIn += (inp.steer - this.steerIn) * (1 - Math.exp(-rate * dt));
    if (Math.abs(this.steerIn) < 0.001) this.steerIn = 0;
    let steer = this.steerIn, thr = inp.throttle, wantDrift = inp.drift;
    if (this.frozenT > 0) { steer = 0; thr = 0; wantDrift = false; }
    if (this.spinT > 0) { this.spinT -= dt; steer = 0; thr = 0; wantDrift = false; this.h += 11 * dt; }

    let fx = Math.sin(this.h), fz = Math.cos(this.h);
    let vf = this.vx * fx + this.vz * fz;
    const speedRatio = clamp(vf / MAX_SPEED, 0, 1);

    // ---- W-tap detection: count fresh gas presses in a short window
    this.clock += dt;
    const gasDown = thr > 0.1;
    if (gasDown && !this.thrDown) this.tapTimes.push(this.clock);
    this.thrDown = gasDown;
    while (this.tapTimes.length && this.clock - this.tapTimes[0] > TAP_WINDOW) this.tapTimes.shift();
    if (this.tapTimes.length >= TAP_COUNT) this.pivotT = PIVOT_HOLD;
    else if (this.pivotT > 0) this.pivotT -= dt;
    const pivoting = this.pivotT > 0 && !this.drifting && this.frozenT <= 0 && this.spinT <= 0;

    // ---- manual drift (hold the drift key while steering at speed)
    if (wantDrift && !this.drifting && vf > 12 && Math.abs(steer) > 0.25) {
      this.drifting = Math.sign(steer); this.driftT = 0; this.driftTier = 0; this.hop = 1; // little hop on drift entry
      this.pivotT = 0; this.tapTimes.length = 0;
      this.game.onKartEvent(this, 'driftStart');
    }
    if (this.drifting && (!wantDrift || vf < 5)) this.endDrift();

    // ---- steering
    let yaw; // signed yaw rate in rad/s (positive turns right)
    if (this.drifting) {
      // the body over-rotates while the velocity vector lags behind (low lateral friction below); counter-steering eases it
      const s = clamp(steer * this.drifting, -1, 1);
      yaw = this.drifting * DRIFT_TURN * (0.6 + 0.4 * s) * clamp(vf / 6, 0, 1);
      this.driftT += dt;
      const tier = this.driftT > DRIFT_TIERS[2] ? 3 : this.driftT > DRIFT_TIERS[1] ? 2 : this.driftT > DRIFT_TIERS[0] ? 1 : 0;
      if (tier !== this.driftTier) { this.driftTier = tier; this.game.onKartEvent(this, 'driftTier', tier); }
    } else {
      // forward momentum resists rotation: nimble when slow, wide arcs near top speed
      const nimble = 1 - (1 - HIGH_SPEED_TURN) * Math.pow(speedRatio, 1.2);
      const lowSpeed = clamp(Math.abs(vf) / 5, 0, 1) * (vf >= 0 ? 1 : -1);
      yaw = steer * BASE_TURN * nimble * lowSpeed;
      if (pivoting) {
        // momentum is disrupted: rotation limit loosened, works even when nearly stopped, and speed bleeds off
        yaw = steer * BASE_TURN * PIVOT_TURN_MUL * Math.max(0.55, Math.abs(lowSpeed));
        if (vf > PIVOT_SPEED_CAP) vf = Math.max(PIVOT_SPEED_CAP, vf - 60 * dt);
      }
    }
    this.h -= yaw * dt;

    // re-derive basis after turning: leftover velocity along the new right axis is the slide
    fx = Math.sin(this.h); fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;

    const slime = world.inSlime(this.x, this.z);
    const boosting = this.boostTime > 0;
    const maxS = boosting ? BOOST_SPEED : slime ? MAX_SPEED * 0.5 : MAX_SPEED;
    if (boosting && thr < 0.1) thr = 1;

    if (thr > 0.1) {
      if (vf < maxS) vf = Math.min(maxS, vf + (vf < 0 ? 50 : ACC) * (boosting ? 2.6 : 1) * dt);
      else vf = Math.max(maxS, vf - 28 * dt);
    } else if (thr < -0.1) {
      if (vf > 0.5) vf = Math.max(0, vf - BRAKE * dt);
      else vf = Math.max(-REV_SPEED, vf - ACC * 0.7 * dt);
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), COAST * dt);
    }
    if (this.frozenT > 0 || this.spinT > 0) vf *= Math.exp(-2.2 * dt);

    // lateral friction: high when planted, reduced by speed*steering (centrifugal slip), very low in a drift,
    // and eased back to normal over TRACTION_RECOVER seconds after a drift ends
    let grip = LATERAL_FRICTION * (1 - HIGH_SPEED_SLIP * speedRatio * Math.abs(steer));
    if (this.spinT > 0) grip = 1.2; else if (slime) grip = 5;
    if (this.drifting) grip = DRIFT_FRICTION;
    else if (this.tractionT > 0) { this.tractionT -= dt; grip = grip + (DRIFT_FRICTION - grip) * clamp(this.tractionT / TRACTION_RECOVER, 0, 1); }
    vl *= Math.exp(-grip * dt);
    if (this.drifting) vf -= Math.min(vf, 1.5 * dt); // tiny scrub while sliding

    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    const impact = world.collideKart(this);
    if (impact > 7) this.game.onKartEvent(this, 'bump', impact);
    if (impact > 12 && this.drifting) this.endDrift(true);

    this.speed = Math.hypot(this.vx, this.vz);
    // slime splashes
    if (slime && this.speed > 4 && Math.random() < 0.5) {
      this.game.fx.add.emit(this.x + (Math.random() - 0.5) * 2, 0.4, this.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, 4 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.5, 0.5, 0.1, 0.4, 1, 0.2, 0.7, 1, 0.4, 0.9, 20, 0);
    }
  }

  endDrift(cancel = false) {
    if (!this.drifting) return;
    if (!cancel && this.driftTier > 0) {
      // mini-turbo proportional to how long the drift was held
      const charge = Math.min(this.driftT, 2.6);
      this.boostTime = Math.max(this.boostTime, charge * 0.75 * TURBO_INTENSITY);
      const kick = (2 + charge * 2.5) * TURBO_INTENSITY; // immediate forward impulse
      this.vx += Math.sin(this.h) * kick; this.vz += Math.cos(this.h) * kick;
      this.game.onKartEvent(this, 'miniBoost', this.driftTier);
    }
    this.tractionT = TRACTION_RECOVER;
    this.drifting = 0; this.driftT = 0; this.driftTier = 0;
  }

  /* ------------------------------------------------------------ combat state */
  get forward() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }

  /* ------------------------------------------------------------ net */
  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return {
      k: 's', x: r(this.x), z: r(this.z), h: r(this.h), vx: r(this.vx), vz: r(this.vz), hp: Math.round(this.hp),
      dr: this.drifting, dt: this.driftTier, bo: this.boostTime > 0 ? 1 : 0, sh: this.shieldT > 0 ? r(this.shieldT) : 0,
      sp: this.spikeT > 0 ? r(this.spikeT) : 0, fz: this.frozenT > 0 ? 1 : 0, sn: this.spinT > 0 ? 1 : 0, d: this.dead ? 1 : 0,
      iv: this.invuln > 0 ? 1 : 0,
    };
  }

  applyNet(s) {
    const first = !this.net;
    this.net = s;
    this.netAge = 0;
    if (first || s.d || Math.hypot(this.x - s.x, this.z - s.z) > 18) { this.x = s.x; this.z = s.z; this.h = s.h; }
    this.hp = s.hp;
    this.vx = s.vx; this.vz = s.vz;
    this.drifting = s.dr; this.driftTier = s.dt || 0;
    this.boostTime = s.bo ? 0.2 : 0;
    this.shieldT = s.sh; this.spikeT = s.sp;
    this.frozenT = s.fz ? 1 : 0; this.spinT = s.sn ? 1 : 0;
    this.invuln = s.iv ? 1 : 0;
    if (s.d && !this.dead) { /* death is announced by a dedicated event */ }
  }

  netStep(dt) {
    if (!this.net || this.dead) return;
    this.netAge += dt;
    const s = this.net;
    // dead-reckon from the last snapshot and ease toward it
    const tx = s.x + s.vx * this.netAge, tz = s.z + s.vz * this.netAge;
    const k = 1 - Math.exp(-14 * dt);
    this.x += (tx - this.x) * k;
    this.z += (tz - this.z) * k;
    this.h = lerpAngle(this.h, s.h, k);
    this.speed = Math.hypot(s.vx, s.vz);
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.spikeT > 0) this.spikeT -= dt;
  }

  /* ------------------------------------------------------------ visuals */
  updateVisual(dt, t, inp) {
    const m = this.model;
    if (this.dead) { m.root.visible = false; m.label.visible = false; return; }
    m.root.visible = this.invuln > 0 ? Math.floor(t * 14) % 2 === 0 || this.invuln > 1.9 : true;
    m.label.visible = !this.isLocal;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.h;
    m.label.position.set(this.x, 3.9, this.z);

    const steerIn = this.isLocal || this.isBot ? (inp ? inp.steer : 0) : 0;
    const vf = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    const vl = this.vx * -Math.cos(this.h) + this.vz * Math.sin(this.h);

    this.steerVis = damp(this.steerVis, steerIn, 14, dt);
    this.leanVis = damp(this.leanVis, clamp(-vl * 0.025 - this.steerVis * 0.05 * (vf / MAX_SPEED), -0.18, 0.18), 10, dt);
    const driftYaw = this.drifting ? -this.drifting * 0.38 : clamp(-vl * 0.03, -0.25, 0.25);
    this.yawVis = damp(this.yawVis, driftYaw, 12, dt);
    m.body.rotation.z = this.leanVis;
    m.body.rotation.y = this.yawVis;
    this.hop = Math.max(0, this.hop - dt * 4.2);
    m.body.position.y = Math.sin(t * 28 + this.x) * 0.012 * clamp(this.speed / 20, 0, 1) + Math.sin(this.hop * Math.PI) * 0.45;

    this.wheelRot += vf * dt * 2.1;
    for (const w of m.wheels) {
      w.w.rotation.x = this.wheelRot;
      if (w.front) w.pivot.rotation.y = -this.steerVis * 0.45;
    }
    m.driver.rotation.y = damp(m.driver.rotation.y, -this.steerVis * 0.3, 10, dt);
    m.headG.rotation.z = damp(m.headG.rotation.z, this.leanVis * -1.2 + Math.sin(t * 9) * 0.04 * (this.speed / 27), 10, dt);
    for (const e of m.eyes) e.scale.setScalar(this.hitFlash > 0 ? 1.5 : 1);

    // hit flash tint
    if (this.hitFlash > 0) { _tmp.set(0xffffff); m.bodyMat.emissive.copy(_tmp).multiplyScalar(this.hitFlash * 2.5); }
    else m.bodyMat.emissive.setRGB(0, 0, 0);

    const boosting = this.boostTime > 0;
    for (const f of m.flames) {
      f.visible = boosting;
      if (boosting) { const s = 0.8 + Math.random() * 0.5; f.scale.set(s, s * 1.2, s); f.material.color.setHex(this.driftTier >= 2 || this.boostTime > 2 ? 0x66ccff : 0xffa030); }
    }
    // shield / ice
    m.shield.visible = this.shieldT > 0;
    if (m.shield.visible) {
      const blink = this.shieldT < 1.5 ? (Math.floor(t * 10) % 2 ? 0.1 : 0.28) : 0.22;
      m.shieldBubble.material.opacity = blink;
      m.shield.rotation.y -= dt * 0.7;
    }
    m.ice.visible = this.frozenT > 0;

    // label: hp bar
    const hpf = clamp(this.hp / MAX_HP, 0, 1);
    m.hpFill.scale.x = 3 * hpf;
    m.hpFill.material.color.setHSL(hpf * 0.33, 0.9, 0.55);

    // under-glow so karts pop
    m.under.material.opacity = 0.35 + (boosting ? 0.3 : 0);
    m.under.position.y = 0.2;

    // drift sparks + exhaust
    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
    const P = this.game.fx;
    if (this.drifting) {
      const c = [[1, 1, 0.9], [0.3, 0.65, 1], [1, 0.6, 0.1], [0.85, 0.3, 1]][this.driftTier];
      for (const s of [-1, 1]) {
        if (Math.random() < 0.9) {
          const px = this.x + rx * s * 1.15 - fx * 1.2, pz = this.z + rz * s * 1.15 - fz * 1.2;
          P.add.emit(px, 0.2, pz, -fx * 6 + (Math.random() - 0.5) * 9 + this.vx * 0.2, 3 + Math.random() * 5, -fz * 6 + (Math.random() - 0.5) * 9 + this.vz * 0.2, 0.3 + Math.random() * 0.25, 0.5, 0.05, c[0], c[1], c[2], 1, 0.6, 0.2, 1, 18, 0.5);
        }
      }
      if (this.speed > 12 && Math.random() < 0.6) { // tyre smoke
        P.parts.emit(this.x - fx * 1.3 + rx * (Math.random() - 0.5) * 2.4, 0.3, this.z - fz * 1.3 + rz * (Math.random() - 0.5) * 2.4, 0, 1, 0, 0.6, 0.8, 2.4, 0.8, 0.8, 0.85, 0.5, 0.5, 0.55, 0.35, 0, 1);
      }
    }
    if (boosting && Math.random() < 0.9) {
      for (const s of [-0.55, 0.55]) {
        P.add.emit(this.x + rx * s - fx * 2.3, 0.9, this.z + rz * s - fz * 2.3, -fx * 12 + this.vx * 0.2, 0.5, -fz * 12 + this.vz * 0.2, 0.3, 0.9, 0.1, 1, 0.8, 0.3, 1, 0.2, 0.05, 1, 0, 1);
      }
    }
    // damaged kart smokes
    if (this.hp < 40 && Math.random() < dt * (this.hp < 20 ? 22 : 9)) {
      P.parts.emit(this.x + (Math.random() - 0.5), 1.6, this.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2, 0.9, 0.7, 2.4, 0.2, 0.2, 0.2, 0.05, 0.05, 0.05, 0.7, -1, 1);
    }
  }

  dispose() {
    this.game.scene.remove(this.model.root, this.model.label);
    this.model.root.traverse((o) => { if (o.material && !o.material.userData?.shared) { /* shared mats are module-level */ } });
  }
}

export { KART_R, MAX_SPEED, BOOST_SPEED, angDiff };
