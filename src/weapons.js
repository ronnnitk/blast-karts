import * as THREE from 'three';
import { clamp, angDiff, segPointDist2, rand, TAU } from './util.js';
import { sharkMissile, toiletMine, bananaPeel, spikeBall, chainLink, crocBomber, bombMesh, targetMarker } from './weaponmodels.js';

export const ITEMS = {
  fart:       { name: 'Fart Blast',            emoji: '💨', weight: 20, ammo: 32, desc: 'Hold to rapid-fire toxic fart projectiles.' },
  missile:    { name: 'Tralalero Missile',     emoji: '🦈', weight: 15, desc: 'A sneaker-wearing shark that chases opponents.' },
  spike:      { name: 'Chain Spike',           emoji: '⛓️', weight: 10, desc: 'Giant spiked ball swings around your kart on a chain.' },
  bubble:     { name: 'Invincible Bubble',     emoji: '🫧', weight: 10, desc: 'Invincible for 8s. Ramming enemies with the bubble destroys them.' },
  rockets:    { name: 'Rocket Launcher',       emoji: '🚀', weight: 14, desc: 'Fires 3 straight rockets side by side. Two hits destroy a kart.' },
  gun:        { name: 'Auto Machine Gun',      emoji: '🔫', weight: 13, desc: 'Roof gun that auto-shoots nearby karts. 90% of the bullets destroy one.' },
  bombardiro: { name: 'Bombardiro Crocodilo',  emoji: '🐊', weight: 7,  desc: 'Calls an airstrike on nearby opponents.' },
  mine:       { name: 'Skibidi Toilet Mine',   emoji: '🚽', weight: 10, desc: 'Drop a toilet trap behind you.' },
  boost:      { name: 'Sigma Boost',           emoji: '⚡', weight: 12, desc: 'Grindset nitro for 3 seconds.' },
  banana:     { name: 'Chimpanzini Banana',    emoji: '🍌', weight: 10, desc: 'Slippery peel that spins karts out.' },
  freeze:     { name: 'Brr Brr Freeze',        emoji: '🥶', weight: 7,  desc: 'Freezes every kart near you for 2 seconds.' },
  warp:       { name: 'Lirili Larila Warp',    emoji: '🌀', weight: 6,  desc: 'Teleport somewhere safer. Time is a flat circle.' },
};
const ITEM_KEYS = Object.keys(ITEMS);

/** weighted roll; `allowed` (array of item keys) restricts the pool for custom rooms */
export function rollItem(allowed) {
  const keys = allowed && allowed.length ? ITEM_KEYS.filter((k) => allowed.includes(k)) : ITEM_KEYS;
  const pool = keys.length ? keys : ITEM_KEYS;
  let r = pool.reduce((s, k) => s + ITEMS[k].weight, 0) * Math.random();
  for (const k of pool) { r -= ITEMS[k].weight; if (r <= 0) return k; }
  return pool[0];
}
export const itemFor = (type) => ({ type, ammo: ITEMS[type].ammo || 1 });

const r2 = (v) => Math.round(v * 100) / 100;
const lerpAim = (a, b, t) => a + angDiff(a, b) * t;

const rocketMats = {
  body: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.35, metalness: 0.4 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff2a2a, roughness: 0.4, emissive: 0x551010 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.6 }),
};
/** slim, long rocket with a pointed red head, flying along +z */
function rocketMesh() {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.2, 10), rocketMats.body);
  body.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.85, 10), rocketMats.red);
  head.rotation.x = Math.PI / 2; head.position.z = 1.52;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.22, 10), rocketMats.red);
  band.rotation.x = Math.PI / 2; band.position.z = -0.5;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.25, 8), rocketMats.dark);
  nozzle.rotation.x = Math.PI / 2; nozzle.position.z = -1.2;
  grp.add(body, head, band, nozzle);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.5), rocketMats.red);
    const pivot = new THREE.Group();
    fin.position.set(0, 0.28, -0.85);
    pivot.add(fin); pivot.rotation.z = (i * Math.PI) / 2;
    grp.add(pivot);
  }
  return grp;
}

/** roof turret that visually tracks its target */
function gunMesh() {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.35, 12), rocketMats.dark);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), rocketMats.red);
  hub.position.y = 0.3;
  grp.add(base, hub);
  for (const sx of [-0.2, 0.2]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8), rocketMats.body);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(sx, 0.3, 0.9);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 8), rocketMats.dark);
    tip.rotation.x = Math.PI / 2; tip.position.set(sx, 0.3, 1.7);
    grp.add(barrel, tip);
  }
  return grp;
}

export class Weapons {
  constructor(game) {
    this.game = game;
    this.ents = [];
    this.byId = new Map();
    this.n = 0;
  }

  uid(owner) { return owner.id + ':' + this.n++; }

  add(e) { this.ents.push(e); if (e.id) this.byId.set(e.id, e); return e; }

  clear() {
    for (const e of this.ents) e.dispose?.();
    this.ents.length = 0;
    this.byId.clear();
    for (const k of this.game.karts) { this.removeSpike(k); this.removeGun(k); }
  }

  /* ------------------------------------------------------------ using items */
  use(k) {
    const it = k.item;
    if (!it || k.dead || k.rouletteT > 0 || k.frozenT > 0 || k.spinT > 0) return false;
    const g = this.game, f = k.forward;
    switch (it.type) {
      case 'fart': {
        if (k.fireCD > 0) return false;
        k.fireCD = 0.085;
        const h = k.h + (Math.random() - 0.5) * 0.08;
        const x = k.x + Math.sin(h) * 2.1, z = k.z + Math.cos(h) * 2.1;
        this.spawnFart(k, x, z, h);
        g.netSend({ k: 'use', w: 'fart', x: r2(x), z: r2(z), h: r2(h) });
        if (--it.ammo <= 0) k.item = null;
        return true;
      }
      case 'missile': {
        const tid = this.pickTarget(k);
        const x = k.x + f.x * 2.6, z = k.z + f.z * 2.6, id = this.uid(k);
        this.spawnMissile(k, x, z, k.h, tid, id);
        g.netSend({ k: 'use', w: 'missile', x: r2(x), z: r2(z), h: r2(k.h), tid, id });
        break;
      }
      case 'mine': case 'banana': {
        const x = k.x - f.x * 2.8, z = k.z - f.z * 2.8, id = this.uid(k);
        if (it.type === 'mine') this.spawnMine(k, x, z, id); else this.spawnBanana(k, x, z, id);
        g.netSend({ k: 'use', w: it.type, x: r2(x), z: r2(z), id });
        break;
      }
      case 'spike': this.startSpike(k); g.netSend({ k: 'use', w: 'spike' }); break;
      case 'bubble': this.startShield(k); g.netSend({ k: 'use', w: 'bubble' }); break;
      case 'gun': this.startGun(k); g.netSend({ k: 'use', w: 'gun' }); break;
      case 'rockets': {
        const x = k.x + f.x * 2.8, z = k.z + f.z * 2.8;
        this.fireRockets(k, x, z, k.h);
        g.netSend({ k: 'use', w: 'rockets', x: r2(x), z: r2(z), h: r2(k.h) });
        break;
      }
      case 'boost': this.startBoost(k); g.netSend({ k: 'use', w: 'boost' }); break;
      case 'freeze': this.castFreeze(k, k.x, k.z); g.netSend({ k: 'use', w: 'freeze', x: r2(k.x), z: r2(k.z) }); break;
      case 'warp': this.doWarp(k); break;
      case 'bombardiro': {
        const targets = this.pickBombTargets(k);
        this.castBomb(k, targets);
        g.netSend({ k: 'use', w: 'bomb', t: targets.map((t) => [t.id, r2(t.x), r2(t.z)]) });
        break;
      }
    }
    k.item = null;
    return true;
  }

  /** replay an item use performed by a remote player */
  remoteUse(k, m) {
    switch (m.w) {
      case 'fart': this.spawnFart(k, m.x, m.z, m.h); break;
      case 'missile': this.spawnMissile(k, m.x, m.z, m.h, m.tid, m.id); break;
      case 'mine': this.spawnMine(k, m.x, m.z, m.id); break;
      case 'banana': this.spawnBanana(k, m.x, m.z, m.id); break;
      case 'spike': this.startSpike(k); break;
      case 'bubble': this.startShield(k); break;
      case 'gun': this.startGun(k); break;
      case 'rockets': this.fireRockets(k, m.x, m.z, m.h); break;
      case 'gshot': k.gunAim = m.h; this.spawnBullet(k, m.x, m.z, m.h); break;
      case 'boost': this.startBoost(k); break;
      case 'freeze': this.castFreeze(k, m.x, m.z); break;
      case 'warp': this.warpFx(m.fx, m.fz, m.tx, m.tz, k); break;
      case 'bomb': this.castBomb(k, (m.t || []).map(([id, x, z]) => ({ id, x, z }))); break;
    }
  }

  removeRemote(id) {
    const e = this.byId.get(id);
    if (e?.trigger) e.trigger(true);
  }

  pickTarget(k) {
    let best = null, bs = Infinity;
    for (const o of this.game.karts) {
      if (o === k || o.dead) continue;
      const dx = o.x - k.x, dz = o.z - k.z, d = Math.hypot(dx, dz);
      if (d > 100) continue;
      const a = Math.abs(angDiff(k.h, Math.atan2(dx, dz)));
      const s = d * (1 + a * 2) + (a > 1.7 ? 60 : 0);
      if (s < bs) { bs = s; best = o; }
    }
    return best ? best.id : null;
  }

  pickBombTargets(k) {
    const list = this.game.karts
      .filter((o) => o !== k && !o.dead && Math.hypot(o.x - k.x, o.z - k.z) < 85)
      .sort((a, b) => Math.hypot(a.x - k.x, a.z - k.z) - Math.hypot(b.x - k.x, b.z - k.z))
      .slice(0, 3)
      .map((o) => ({ id: o.id, x: o.x, z: o.z }));
    if (list.length) return list;
    // nobody around: carpet the spot ahead so it's still a show
    const w = this.game.world;
    for (let d = 30; d >= 8; d -= 6) {
      const x = k.x + Math.sin(k.h) * d, z = k.z + Math.cos(k.h) * d;
      if (!w.blockedPoint(x, z, 3)) return [{ id: null, x, z }];
    }
    return [{ id: null, x: k.x, z: k.z }];
  }

  /* ------------------------------------------------------------ Fart Blast */
  spawnFart(owner, x, z, h) {
    const g = this.game, P = g.fx;
    const speed = 66;
    const e = {
      kind: 'fart', owner, x, z, px: x, pz: z, life: 1.05,
      vx: Math.sin(h) * speed + owner.vx * 0.5, vz: Math.cos(h) * speed + owner.vz * 0.5,
      update: (dt) => {
        e.px = e.x; e.pz = e.z;
        e.x += e.vx * dt; e.z += e.vz * dt; e.life -= dt;
        P.add.emit(e.x, 1.2, e.z, 0, 0, 0, 0.09, 1.7, 1.2, 0.55, 1, 0.15, 0.3, 0.9, 0.1, 1, 0, 0);
        P.add.emit(e.x, 1.2, e.z, rand(-2, 2), rand(0, 2), rand(-2, 2), 0.3, 0.9, 0.2, 0.3, 0.9, 0.1, 0.1, 0.5, 0.05, 0.9, 0, 1);
        if (Math.random() < 0.55) P.parts.emit(e.x, 1.2, e.z, rand(-2, 2), rand(0.5, 2), rand(-2, 2), 0.7, 0.9, 3.2, 0.45, 0.8, 0.2, 0.3, 0.55, 0.1, 0.35, 0, 1.5);
        if (g.world.blockedPoint(e.x, e.z, 0.1)) { this.fartPuff(e.x, e.z); return false; }
        for (const k of g.karts) {
          if (k === owner || k.dead) continue;
          if (segPointDist2(e.px, e.pz, e.x, e.z, k.x, k.z) < 1.6 * 1.6) {
            this.fartPuff(e.x, e.z);
            if (k.authoritative) g.damage(k, 6, owner, 'fart');
            else if (owner.isLocal) { g.audio.hitMarker(); g.fx.text(k.x, 3.5, k.z, '-6', { color: '#9dff3a', size: 1.6, life: 0.6 }); }
            return false;
          }
        }
        return e.life > 0;
      },
    };
    this.add(e);
    g.audio.fart(g.spatial(x, z));
    // muzzle puff
    P.add.burst(x, 1.2, z, 6, { speed: 8, life: 0.3, size: 1.5, size1: 0, c: [0.5, 1, 0.2], c1: [0.1, 0.5, 0.05], drag: 3 });
  }

  fartPuff(x, z) {
    const P = this.game.fx;
    P.add.burst(x, 1.2, z, 12, { speed: 9, life: 0.5, size: 1.4, size1: 0, c: [0.7, 1, 0.3], c1: [0.1, 0.5, 0.05], drag: 2.5 });
    P.parts.burst(x, 1.2, z, 5, { speed: 4, life: 0.8, size: 1.8, size1: 4.5, c: [0.4, 0.75, 0.2], c1: [0.25, 0.4, 0.1], a: 0.4, drag: 1.5 });
  }

  /* ------------------------------------------------------------ Tralalero Missile */
  spawnMissile(owner, x, z, h, tid, id) {
    const g = this.game, P = g.fx;
    const mesh = sharkMissile();
    mesh.scale.setScalar(1.15);
    g.scene.add(mesh);
    const e = {
      kind: 'missile', id, owner, x, z, h, speed: 24, age: 0, tid: tid || null, scan: 0, tgt: null,
      update: (dt) => {
        e.age += dt;
        e.speed = Math.min(50, e.speed + 36 * dt);
        let tgt = e.tid ? g.kartById(e.tid) : null;
        if (tgt && tgt.dead) tgt = null;
        if (!tgt) { // lost or never had a lock: sniff out anything close in front
          e.scan -= dt;
          if (e.scan <= 0) {
            e.scan = 0.2; e.tgt = null;
            let bd = 30;
            for (const o of g.karts) {
              if (o === owner && e.age < 2) continue;
              if (o.dead) continue;
              const d = Math.hypot(o.x - e.x, o.z - e.z);
              if (d < bd && Math.abs(angDiff(e.h, Math.atan2(o.x - e.x, o.z - e.z))) < 1.2) { bd = d; e.tgt = o; }
            }
          }
          tgt = e.tgt && !e.tgt.dead ? e.tgt : null;
        }
        if (tgt) {
          const dist = Math.hypot(tgt.x - e.x, tgt.z - e.z);
          const des = Math.atan2(tgt.x - e.x, tgt.z - e.z), d = angDiff(e.h, des);
          const mx = (3.1 + (dist < 22 ? 1.8 : 0)) * dt;
          e.h += clamp(d, -mx, mx);
        }
        e.x += Math.sin(e.h) * e.speed * dt; e.z += Math.cos(e.h) * e.speed * dt;
        mesh.position.set(e.x, 1.4 + Math.sin(e.age * 18) * 0.12, e.z);
        mesh.rotation.set(Math.sin(e.age * 14) * 0.07, e.h, Math.sin(e.age * 9) * 0.25);
        // flame + smoke trail
        const bx = e.x - Math.sin(e.h) * 2.2, bz = e.z - Math.cos(e.h) * 2.2;
        P.add.emit(bx, 1.3, bz, rand(-1, 1), rand(-0.5, 1), rand(-1, 1), 0.22, 1.5, 0.2, 1, 0.75, 0.25, 1, 0.2, 0.05, 1, 0, 0);
        P.add.emit(bx, 1.4, bz, 0, 0, 0, 0.12, 1.1, 0.8, 1, 1, 0.8, 1, 0.5, 0.2, 1, 0, 0);
        P.parts.emit(bx, 1.3, bz, rand(-1, 1), rand(0, 1.5), rand(-1, 1), 0.9, 1.0, 3.2, 0.7, 0.7, 0.75, 0.3, 0.3, 0.35, 0.5, 0, 1);
        // sparkly "tralala" notes occasionally
        if (Math.random() < dt * 5) P.add.emit(e.x + rand(-1, 1), 2.4, e.z + rand(-1, 1), rand(-2, 2), rand(3, 6), rand(-2, 2), 0.6, 1.2, 0.2, 0.4, 0.85, 1, 1, 1, 1, 1, 0, 1);
        const hitWall = g.world.blockedPoint(e.x, e.z, 0.9);
        let hitKart = false;
        for (const k of g.karts) {
          if (k.dead || (k === owner && e.age < 0.7)) continue;
          if ((k.x - e.x) ** 2 + (k.z - e.z) ** 2 < 2.3 * 2.3) { hitKart = true; break; }
        }
        if (hitWall || hitKart || e.age > 7) {
          this.explode(e.x, e.z, { radius: 7.5, damage: 62, owner, weapon: 'missile', size: 1.1 });
          return false;
        }
        return true;
      },
      dispose: () => { g.scene.remove(mesh); },
    };
    this.add(e);
    g.audio.missile(g.spatial(x, z));
  }

  /* ------------------------------------------------------------ Rocket Launcher */
  /** three slim rockets flying side by side on dead-straight lines (no homing) */
  fireRockets(owner, x, z, h) {
    const g = this.game, rx = Math.cos(h), rz = -Math.sin(h);
    for (const off of [-1.25, 0, 1.25]) this.spawnRocket(owner, x + rx * off, z + rz * off, h);
    g.audio.missile(g.spatial(x, z));
    g.fx.add.burst(x, 1.3, z, 14, { speed: 10, life: 0.35, size: 1.3, size1: 0, c: [1, 0.8, 0.3], c1: [1, 0.3, 0.1], drag: 3 });
  }

  spawnRocket(owner, x, z, h) {
    const g = this.game, P = g.fx;
    const mesh = rocketMesh();
    mesh.rotation.y = h;
    mesh.position.set(x, 1.25, z);
    g.scene.add(mesh);
    const SPEED = 78, dx = Math.sin(h), dz = Math.cos(h);
    const e = {
      kind: 'rocket', owner, x, z, px: x, pz: z, life: 1.7, age: 0,
      update: (dt) => {
        e.age += dt; e.life -= dt;
        e.px = e.x; e.pz = e.z;
        e.x += dx * SPEED * dt; e.z += dz * SPEED * dt;
        mesh.position.set(e.x, 1.25, e.z);
        P.add.emit(e.x - dx * 1.4, 1.25, e.z - dz * 1.4, rand(-1, 1), rand(-0.5, 1), rand(-1, 1), 0.2, 1.1, 0.1, 1, 0.7, 0.25, 1, 0.2, 0.05, 1, 0, 0);
        if (Math.random() < 0.6) P.parts.emit(e.x - dx * 1.6, 1.25, e.z - dz * 1.6, rand(-1, 1), rand(0, 1), rand(-1, 1), 0.6, 0.7, 2.4, 0.8, 0.8, 0.8, 0.5, 0.5, 0.5, 0.4, 0, 1);
        if (g.world.blockedPoint(e.x, e.z, 0.2)) { this._rocketBoom(e.x, e.z); return false; }
        for (const k of g.karts) {
          if (k.dead || (k === owner && e.age < 0.25)) continue;
          if (segPointDist2(e.px, e.pz, e.x, e.z, k.x, k.z) < 1.6 * 1.6) {
            this._rocketBoom(e.x, e.z);
            if (k.authoritative) g.damage(k, 55, owner, 'rockets'); // two rockets (110) destroy a 100 hp kart
            else if (owner.isLocal) g.audio.hitMarker();
            return false;
          }
        }
        return e.life > 0;
      },
      dispose: () => g.scene.remove(mesh),
    };
    this.add(e);
  }

  _rocketBoom(x, z) {
    const g = this.game;
    g.fx.explosion(x, z, 0.75, 'fire');
    g.audio.explosion(0.6, g.spatial(x, z));
    g.shake(0.35, x, z);
  }

  /* ------------------------------------------------------------ Auto Machine Gun */
  startGun(k) {
    k.gunT = 8; k.gunAmmo = 40; k.gunCD = 0.3; k.gunAim = k.h;
    const g = this.game;
    g.audio.clang(g.spatial(k.x, k.z));
    g.fx.text(k.x, 4.4, k.z, 'GUN ONLINE', { color: '#ffd23a', size: 2, life: 0.9 });
  }

  removeGun(k) {
    k.gunT = 0;
    if (!k.gunMesh) return;
    this.game.scene.remove(k.gunMesh.grp);
    k.gunMesh = null;
  }

  spawnBullet(owner, x, z, h) {
    const g = this.game, P = g.fx, SPEED = 100;
    const dx = Math.sin(h), dz = Math.cos(h);
    const e = {
      kind: 'bullet', owner, x, z, px: x, pz: z, life: 0.45,
      update: (dt) => {
        e.px = e.x; e.pz = e.z;
        e.x += dx * SPEED * dt + owner.vx * 0.2 * dt; e.z += dz * SPEED * dt + owner.vz * 0.2 * dt; e.life -= dt;
        P.add.emit(e.x, 1.9, e.z, 0, 0, 0, 0.1, 0.9, 0.7, 1, 0.9, 0.4, 1, 0.5, 0.1, 1, 0, 0);
        if (g.world.blockedPoint(e.x, e.z, 0.1)) {
          P.add.burst(e.x, 1.6, e.z, 3, { speed: 6, life: 0.2, size: 0.5, size1: 0, c: [1, 0.9, 0.5], c1: [1, 0.4, 0.1], drag: 2 });
          return false;
        }
        for (const k of g.karts) {
          if (k === owner || k.dead) continue;
          if (segPointDist2(e.px, e.pz, e.x, e.z, k.x, k.z) < 1.7 * 1.7) {
            P.add.burst(e.x, 1.6, e.z, 4, { speed: 7, life: 0.25, size: 0.6, size1: 0, c: [1, 0.9, 0.5], c1: [1, 0.3, 0.1], drag: 2 });
            // 40 bullets at 2.8 = 112 total: it takes ~90% of a full clip to destroy a 100 hp kart
            if (k.authoritative) g.damage(k, 2.8, owner, 'gun');
            else if (owner.isLocal) g.audio.hitMarker();
            return false;
          }
        }
        return e.life > 0;
      },
    };
    this.add(e);
    g.audio.tone({ type: 'square', f: 1100, f2: 380, dur: 0.05, vol: 0.07, o: g.spatial(x, z) });
  }

  _updateGuns(dt) {
    const g = this.game;
    for (const k of g.karts) {
      if (k.dead || !(k.gunT > 0)) { if (k.gunMesh) this.removeGun(k); continue; }
      k.gunT -= dt;
      if (k.gunCD > 0) k.gunCD -= dt;
      if (!k.gunMesh) {
        const grp = gunMesh();
        g.scene.add(grp);
        k.gunMesh = { grp };
      }
      let target = null, bd = 40 * 40;
      if (!k.remote && k.frozenT <= 0 && k.spinT <= 0) {
        for (const o of g.karts) {
          if (o === k || o.dead) continue;
          const d2 = (o.x - k.x) ** 2 + (o.z - k.z) ** 2;
          if (d2 < bd && !g.world.segmentBlocked(k.x, k.z, o.x, o.z, 0.6)) { bd = d2; target = o; }
        }
        if (target) {
          const t = Math.sqrt(bd) / 100;
          const ax = target.x + target.vx * t - k.x, az = target.z + target.vz * t - k.z;
          k.gunAim = lerpAim(k.gunAim ?? k.h, Math.atan2(ax, az), Math.min(1, dt * 18));
        } else k.gunAim = lerpAim(k.gunAim ?? k.h, k.h, Math.min(1, dt * 6));
        if (target && k.gunCD <= 0 && k.gunAmmo > 0) {
          k.gunCD = 0.14; k.gunAmmo--;
          const h = k.gunAim + (Math.random() - 0.5) * 0.05;
          const x = k.x + Math.sin(h) * 1.8, z = k.z + Math.cos(h) * 1.8;
          this.spawnBullet(k, x, z, h);
          g.netSend({ k: 'use', w: 'gshot', x: r2(x), z: r2(z), h: r2(h) });
          g.fx.add.burst(x, 1.9, z, 2, { speed: 5, life: 0.12, size: 0.8, size1: 0, c: [1, 0.9, 0.4], c1: [1, 0.4, 0.1], drag: 3 });
        }
        if (k.gunAmmo <= 0 && k.gunT > 0.6) k.gunT = 0.6;
      }
      const m = k.gunMesh.grp;
      m.position.set(k.x + Math.sin(k.h) * 0.9, 1.65, k.z + Math.cos(k.h) * 0.9); // on the nose, in plain view
      m.rotation.y = k.gunAim ?? k.h;
      m.visible = k.gunT > 1 || Math.floor(g.time * 12) % 2 === 0;
    }
  }

  /* ------------------------------------------------------------ Skibidi Toilet Mine */
  spawnMine(owner, x, z, id) {
    const g = this.game;
    const mesh = toiletMine();
    mesh.position.set(x, 0, z);
    mesh.rotation.y = owner.h + Math.PI;
    g.scene.add(mesh);
    let done = false;
    const e = {
      kind: 'mine', id, owner, x, z, age: 0,
      trigger: (remote) => {
        if (done) return;
        done = true;
        if (!remote) g.netSend({ k: 'rm', id });
        this.explode(x, z, { radius: 7.5, damage: 60, owner, weapon: 'mine', size: 1.15 });
        g.fx.emojiBurst(x, 1.5, z, ['🚽', '💦', '💩', '🧻'], 8, { speed: 16, size: 3 });
        g.audio.flush(g.spatial(x, z));
      },
      update: (dt) => {
        if (done) return false;
        e.age += dt;
        const armed = e.age > 0.9;
        mesh.userData.light.material.color.setHex(Math.floor(e.age * (armed ? 6 : 14)) % 2 ? 0xff2020 : 0x330000);
        mesh.position.y = Math.max(0, 1 - e.age * 6) * 0.6;
        if (armed) {
          for (const k of g.karts) {
            if (k.dead || !k.authoritative) continue;
            if ((k.x - x) ** 2 + (k.z - z) ** 2 < 2.5 * 2.5) { e.trigger(false); return false; }
          }
        }
        return e.age < 45;
      },
      dispose: () => g.scene.remove(mesh),
    };
    this.add(e);
    g.audio.mine(g.spatial(x, z));
  }

  /* ------------------------------------------------------------ Banana peel */
  spawnBanana(owner, x, z, id) {
    const g = this.game;
    const mesh = bananaPeel();
    mesh.position.set(x, 0, z);
    g.scene.add(mesh);
    let done = false;
    const e = {
      kind: 'banana', id, owner, x, z, age: 0,
      trigger: (remote) => {
        if (done) return;
        done = true;
        if (!remote) g.netSend({ k: 'rm', id });
        g.fx.emojiBurst(x, 1.2, z, ['🍌'], 4, { speed: 10, size: 2.4, life: 1 });
        g.audio.slip(g.spatial(x, z));
      },
      update: (dt) => {
        if (done) return false;
        e.age += dt;
        mesh.rotation.y += dt * 1.5;
        for (const k of g.karts) {
          if (k.dead || !k.authoritative || (k === owner && e.age < 0.8)) continue;
          if ((k.x - x) ** 2 + (k.z - z) ** 2 < 2.0 * 2.0) {
            if (k.shieldT > 0) { g.damage(k, 0, owner, 'banana'); e.trigger(false); return false; }
            k.spinT = 1.3; k.endDrift(true);
            k.vx *= 0.55; k.vz *= 0.55;
            g.damage(k, 8, owner, 'banana');
            g.fx.text(k.x, 4, k.z, 'WHEEE!', { color: '#ffe03a', size: 2 });
            e.trigger(false);
            return false;
          }
        }
        return e.age < 50;
      },
      dispose: () => g.scene.remove(mesh),
    };
    this.add(e);
  }

  /* ------------------------------------------------------------ Chain Spike */
  startSpike(k) {
    k.spikeT = 9; k.spikeCD.clear();
    this.game.audio.shieldPop(this.game.spatial(k.x, k.z));
    this.game.audio.clang(this.game.spatial(k.x, k.z));
  }

  _makeSpike(k) {
    const g = this.game;
    const grp = new THREE.Group();
    const ball = spikeBall();
    ball.scale.setScalar(1.35);
    grp.add(ball);
    const links = [];
    for (let i = 0; i < 7; i++) { const l = chainLink(); links.push(l); grp.add(l); }
    g.scene.add(grp);
    k.spikeMesh = { grp, ball, links };
  }

  removeSpike(k) {
    if (!k.spikeMesh) return;
    this.game.scene.remove(k.spikeMesh.grp);
    k.spikeMesh = null;
  }

  _updateSpikes(dt) {
    const g = this.game;
    for (const k of g.karts) {
      if (k.dead || k.spikeT <= 0) { this.removeSpike(k); continue; }
      if (!k.spikeMesh) this._makeSpike(k);
      k.spikeAng += dt * 6.6;
      const R = 4.7, c = Math.cos(k.spikeAng), s = Math.sin(k.spikeAng);
      const bx = k.x + c * R, bz = k.z + s * R, by = 1.4;
      const sm = k.spikeMesh;
      sm.ball.position.set(bx, by, bz);
      sm.ball.rotation.x += dt * 9; sm.ball.rotation.z += dt * 6;
      sm.grp.visible = k.spikeT > 1.6 || Math.floor(g.time * 12) % 2 === 0;
      sm.links.forEach((l, i) => {
        const u = (i + 1) / (sm.links.length + 1);
        l.position.set(k.x + (bx - k.x) * u, 1.4 + Math.sin(u * 3.14) * 0.25, k.z + (bz - k.z) * u);
        l.rotation.set(i % 2 ? Math.PI / 2 : 0, -k.spikeAng, 0);
      });
      if (Math.random() < dt * 14) g.fx.add.emit(bx, by, bz, rand(-3, 3), rand(0, 3), rand(-3, 3), 0.25, 0.6, 0.05, 1, 0.9, 0.5, 1, 0.4, 0.1, 1, 12, 0.5);
      if (Math.floor(g.time * 6.6 / 3.14) !== Math.floor((g.time - dt) * 6.6 / 3.14)) g.audio.whoosh(g.spatial(bx, bz));
      for (const v of g.karts) {
        if (v === k || v.dead || !v.authoritative) continue;
        if ((v.x - bx) ** 2 + (v.z - bz) ** 2 > 2.5 * 2.5) continue;
        if ((k.spikeCD.get(v.id) || 0) > g.time) continue;
        k.spikeCD.set(v.id, g.time + 0.55);
        const dx = v.x - k.x, dz = v.z - k.z, d = Math.hypot(dx, dz) || 1;
        v.vx += (dx / d) * 14; v.vz += (dz / d) * 14;
        g.damage(v, 30, k, 'spike');
        g.audio.clang(g.spatial(bx, bz));
        g.fx.add.burst(bx, by, bz, 16, { speed: 14, life: 0.4, size: 0.9, size1: 0, c: [1, 0.9, 0.5], c1: [1, 0.3, 0.1], grav: 14, drag: 1 });
        g.shake(0.5, bx, bz);
      }
    }
  }

  /* ------------------------------------------------------------ Invincible Bubble */
  startShield(k) {
    k.shieldT = 8;
    this.game.audio.shieldUp(this.game.spatial(k.x, k.z));
    this.game.fx.ring(k.x, k.z, { radius: 6, color: 0x7fe8ff, life: 0.5 });
  }
  onShieldEnd(k) {
    const g = this.game;
    g.audio.shieldPop(g.spatial(k.x, k.z));
    g.fx.add.burst(k.x, 1.4, k.z, 24, { speed: 11, life: 0.5, size: 1.1, size1: 0, c: [0.6, 0.95, 1], c1: [0.3, 0.6, 1], drag: 2 });
  }
  /** the bubble absorbed a hit */
  shieldHit(k) {
    const g = this.game;
    g.audio.clang(g.spatial(k.x, k.z));
    g.fx.add.burst(k.x, 1.5, k.z, 6, { speed: 8, life: 0.3, size: 0.8, size1: 0, c: [0.7, 1, 1], c1: [0.4, 0.7, 1], drag: 2 });
    if (!k._shT || g.time - k._shT > 0.25) { k._shT = g.time; g.fx.ring(k.x, k.z, { radius: 4, color: 0x7fe8ff, life: 0.3, y: 1.2 }); }
  }

  /** touching a live bubble destroys the other kart (checked on the victim's own machine) */
  _updateBubbles() {
    const g = this.game;
    for (const k of g.karts) {
      if (k.dead || k.shieldT <= 0) continue;
      for (const v of g.karts) {
        if (v === k || v.dead || !v.authoritative) continue;
        const dx = v.x - k.x, dz = v.z - k.z, d2 = dx * dx + dz * dz;
        if (d2 > 4.1 * 4.1) continue;
        if (v.shieldT > 0) { // two bubbles just bounce off each other
          const d = Math.sqrt(d2) || 1;
          v.vx += (dx / d) * 22 * 0.016; v.vz += (dz / d) * 22 * 0.016;
          continue;
        }
        g.fx.text(v.x, 4.2, v.z, 'POP!', { color: '#7fe8ff', size: 2.2, life: 0.8 });
        g.fx.ring(v.x, v.z, { radius: 6, color: 0x7fe8ff, life: 0.4 });
        g.damage(v, 999, k, 'bubble');
      }
    }
  }

  /* ------------------------------------------------------------ Sigma Boost */
  startBoost(k) {
    k.boostTime = Math.max(k.boostTime, 3.2);
    k.vx += Math.sin(k.h) * 6; k.vz += Math.cos(k.h) * 6;
    const g = this.game;
    g.audio.boost(g.spatial(k.x, k.z));
    g.fx.add.burst(k.x, 1.2, k.z, 26, { speed: 16, life: 0.5, size: 1.2, size1: 0, c: [0.4, 0.8, 1], c1: [0.2, 0.2, 1], drag: 3 });
    g.fx.text(k.x, 4.2, k.z, 'SIGMA!', { color: '#6ad8ff', size: 2.2, life: 0.8 });
  }

  /* ------------------------------------------------------------ Brr Brr Freeze */
  castFreeze(owner, x, z) {
    const g = this.game, R = 24;
    g.audio.freeze(g.spatial(x, z));
    g.fx.ring(x, z, { radius: R, color: 0x9fe0ff, life: 0.7, y: 0.3 });
    g.fx.ring(x, z, { radius: R * 0.6, color: 0xffffff, life: 0.5, y: 0.5 });
    g.fx.flash(x, 2, z, { size: 22, color: 0xbfe6ff, life: 0.4 });
    for (let i = 0; i < 70 * g.fx.quality; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * R;
      g.fx.add.emit(x + Math.cos(a) * d, rand(0.5, 6), z + Math.sin(a) * d, Math.cos(a) * 6, rand(-1, 3), Math.sin(a) * 6, rand(0.8, 1.5), rand(0.5, 1.1), 0.1, 0.8, 0.95, 1, 0.6, 0.85, 1, 1, 2, 1);
    }
    g.shake(0.6, x, z);
    for (const k of g.karts) {
      if (k === owner || k.dead || !k.authoritative) continue;
      if ((k.x - x) ** 2 + (k.z - z) ** 2 > R * R) continue;
      if (k.shieldT > 0) { this.shieldHit(k); continue; }
      k.frozenT = 2.2; k.endDrift(true);
      k.lastHitBy = owner.id; k.lastHitT = g.time; k.lastHitW = 'freeze';
      g.fx.text(k.x, 4.2, k.z, 'BRR BRR!', { color: '#9fe6ff', size: 2.2, life: 1 });
      if (k.isLocal) g.hud.flash('freeze');
    }
  }

  /* ------------------------------------------------------------ Lirili Larila Warp */
  doWarp(k) {
    const g = this.game;
    let best = null, bd = -1;
    for (let i = 0; i < 16; i++) {
      const p = g.world.randomPoint();
      if (Math.hypot(p.x - k.x, p.z - k.z) < 22) continue;
      let md = 999;
      for (const o of g.karts) if (o !== k && !o.dead) md = Math.min(md, Math.hypot(o.x - p.x, o.z - p.z));
      if (md > bd) { bd = md; best = p; }
    }
    if (!best) best = g.world.randomPoint();
    const fx = k.x, fz = k.z;
    k.x = best.x; k.z = best.z;
    k.invuln = Math.max(k.invuln, 0.8);
    this.warpFx(fx, fz, best.x, best.z, k);
    g.netSend({ k: 'use', w: 'warp', fx: r2(fx), fz: r2(fz), tx: r2(best.x), tz: r2(best.z) });
    if (k.isLocal) g.snapCamera();
  }
  warpFx(fx, fz, tx, tz, k) {
    const g = this.game;
    g.audio.warp(g.spatial(fx, fz));
    for (const [x, z] of [[fx, fz], [tx, tz]]) {
      g.fx.ring(x, z, { radius: 7, color: 0xc060ff, life: 0.6 });
      g.fx.flash(x, 1.5, z, { size: 12, color: 0xd9a0ff, life: 0.4 });
      g.fx.add.burst(x, 1.5, z, 30, { speed: 12, life: 0.7, size: 1.3, size1: 0, c: [0.85, 0.4, 1], c1: [0.3, 0.2, 1], drag: 2 });
    }
    g.fx.emojiBurst(tx, 2, tz, ['🌀', '✨'], 5, { speed: 9, size: 2.4 });
    g.fx.text(tx, 4.5, tz, 'LIRILI LARILA', { color: '#e0a0ff', size: 2, life: 1 });
  }

  /* ------------------------------------------------------------ Bombardiro Crocodilo */
  castBomb(owner, targets) {
    const g = this.game;
    const sp = g.spatial(owner.x, owner.z);
    g.audio.siren(sp);
    g.audio.speak('Bombardiro Crocodilo!', 0.6, 1);
    // strike direction: from the owner towards the target cluster
    let cx = 0, cz = 0;
    targets.forEach((t) => { cx += t.x; cz += t.z; });
    cx /= targets.length; cz /= targets.length;
    let dx = cx - owner.x, dz = cz - owner.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 4) { dx = Math.sin(owner.h); dz = Math.cos(owner.h); } else { dx /= dl; dz /= dl; }
    const plane = crocBomber();
    plane.rotation.y = Math.atan2(dx, dz);
    g.scene.add(plane);
    const SPEED = 78;
    const marks = targets.map((t) => {
      const marker = targetMarker();
      marker.position.set(t.x, 0, t.z);
      g.scene.add(marker);
      const proj = (t.x - cx) * dx + (t.z - cz) * dz;
      return { id: t.id, x: t.x, z: t.z, marker, locked: false, dropped: false, relT: Math.max(1.85, 2.0 + proj / SPEED - 0.35) };
    });
    let planeSound = false;
    const e = {
      kind: 'air', owner, t: 0,
      update: (dt) => {
        e.t += dt;
        if (!planeSound && e.t > 1.0) { planeSound = true; g.audio.planeFly(g.spatial(cx, cz)); }
        for (const m of marks) {
          const kart = m.id ? g.kartById(m.id) : null;
          if (!m.locked && kart && !kart.dead) { m.x = kart.x + kart.vx * 0.2; m.z = kart.z + kart.vz * 0.2; }
          if (!m.locked && e.t >= 1.75) { m.locked = true; g.audio.tone({ type: 'square', f: 1200, dur: 0.12, vol: 0.2 }); }
          m.marker.position.set(m.x, 0, m.z);
          const ud = m.marker.userData;
          m.marker.rotation.y += dt * (m.locked ? 5 : 1.5);
          const pulse = 1 + Math.sin(e.t * (m.locked ? 24 : 9)) * 0.06;
          m.marker.scale.set(pulse, 1, pulse);
          ud.red.opacity = m.locked ? 0.95 : 0.55 + Math.sin(e.t * 10) * 0.25;
          ud.fill.material.opacity = m.locked ? 0.35 : 0.16;
        }
        const along = (e.t - 2.0) * SPEED;
        plane.position.set(cx + dx * along, 22 - Math.max(0, 1 - Math.abs(along) / 60) * 4, cz + dz * along);
        plane.rotation.z = Math.sin(e.t * 3) * 0.06;
        g.fx.parts.emit(plane.position.x - dx * 8, plane.position.y, plane.position.z - dz * 8, 0, 0, 0, 1.0, 1.2, 4, 0.8, 0.8, 0.8, 0.5, 0.5, 0.5, 0.35, 0, 1);
        g.fx.add.emit(plane.position.x - dx * 8, plane.position.y, plane.position.z - dz * 8, 0, 0, 0, 0.2, 1.4, 0.2, 1, 0.6, 0.2, 1, 0.2, 0.05, 1, 0, 0);
        for (const m of marks) {
          if (m.dropped || e.t < m.relT) continue;
          m.dropped = true;
          this._dropBomb(owner, plane.position.clone(), m);
        }
        return e.t < 5.2;
      },
      dispose: () => { g.scene.remove(plane); marks.forEach((m) => g.scene.remove(m.marker)); },
    };
    this.add(e);
  }

  _dropBomb(owner, from, m) {
    const g = this.game;
    const mesh = bombMesh();
    mesh.scale.setScalar(1.3);
    g.scene.add(mesh);
    g.audio.whistle(g.spatial(m.x, m.z));
    const FALL = 0.9;
    let t = 0;
    const e = {
      kind: 'bomb', owner,
      update: (dt) => {
        t += dt;
        const u = clamp(t / FALL, 0, 1);
        const x = from.x + (m.x - from.x) * (1 - (1 - u) * (1 - u)), z = from.z + (m.z - from.z) * (1 - (1 - u) * (1 - u));
        const y = from.y * (1 - u * u) + 0.6;
        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.PI / 2 * u + 0.2, Math.atan2(m.x - from.x, m.z - from.z), 0);
        g.fx.add.emit(x, y, z, 0, 0, 0, 0.2, 1.2, 0.2, 1, 0.5, 0.2, 1, 0.1, 0.05, 0.9, 0, 0);
        if (u >= 1) {
          this.explode(m.x, m.z, { radius: 11, damage: 85, owner, weapon: 'bombardiro', size: 2 });
          g.fx.emojiBurst(m.x, 2, m.z, ['🐊', '💥', '🔥'], 8, { speed: 22, size: 4 });
          return false;
        }
        return true;
      },
      dispose: () => g.scene.remove(mesh),
    };
    this.add(e);
  }

  /* ------------------------------------------------------------ explosions */
  explode(x, z, { radius = 7, damage = 50, owner = null, weapon = 'boom', size = 1, palette = 'fire' }) {
    const g = this.game;
    g.fx.explosion(x, z, size, palette);
    g.audio.explosion(size, g.spatial(x, z));
    g.shake(0.9 * size, x, z);
    g.fx.debris(x, 1, z, 8, [0xffa030, 0x444444, 0xff5030], { speed: 16 * size, size: 0.5 });
    for (const k of g.karts) {
      if (k.dead || !k.authoritative) continue;
      const dx = k.x - x, dz = k.z - z, d = Math.hypot(dx, dz);
      if (d > radius + 1.2) continue;
      const f = clamp(d / radius, 0, 1);
      k.vx += (dx / (d || 1)) * (1 - f) * 20 * size; k.vz += (dz / (d || 1)) * (1 - f) * 20 * size;
      g.damage(k, damage * (1 - 0.5 * f), owner, weapon);
    }
  }

  /* ------------------------------------------------------------ per-frame */
  update(dt) {
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i];
      if (!e.update(dt)) {
        e.dispose?.();
        this.ents.splice(i, 1);
        if (e.id) this.byId.delete(e.id);
      }
    }
    this._updateSpikes(dt);
    this._updateGuns(dt);
    this._updateBubbles();
  }
}
