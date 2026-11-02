import * as THREE from 'three';
import { clamp, lerp, lerpAngle, damp, rand, pick, TAU } from './util.js';
import { getMap } from './maps.js';
import { World } from './world.js';
import { Kart, MAX_HP, MAX_SPEED } from './kart.js';
import { Effects } from './fx.js';
import { Weapons, ITEMS, rollItem, itemFor } from './weapons.js';
import { BotBrain, BOT_NAMES } from './bots.js';
import { Input } from './input.js';

const STEP = 1 / 60;
const KILL_VERBS = ['ROASTED', "SKIBIDI'D", "RATIO'D", "TUNG TUNG'D", 'FANUM TAXED', "OHIO'D", 'COOKED', 'YEETED', "SIGMA'D", 'BONKED', 'DELETED', 'MEWED'];
const MULTI = ['', 'DOUBLE RIZZ!', 'TRIPLE SIGMA!', 'SKIBIDI RAMPAGE!', 'OHIO FINAL BOSS!'];
const MULTI_SAY = ['', 'Double rizz', 'Triple sigma', 'Skibidi rampage', 'Ohio final boss'];
const BOT_COLORS = ['#28e0ff', '#ffd23a', '#5dff2e', '#8a4bff', '#ff7a1a', '#ff4040', '#3a7bff', '#ff3b9a', '#2dffb0', '#ffffff'];
const WEAPON_EMOJI = { fart: '💨', missile: '🦈', spike: '⛓️', mine: '🚽', bombardiro: '🐊', banana: '🍌', freeze: '🥶', rockets: '🚀', gun: '🔫', bubble: '🫧', boom: '💥' };
const WEAPON_NAME = { fart: 'Fart Blast', missile: 'Tralalero Missile', spike: 'Chain Spike', mine: 'Skibidi Mine', bombardiro: 'Bombardiro Crocodilo', banana: 'Banana Peel', freeze: 'Brr Brr Freeze', rockets: 'Rocket Launcher', gun: 'Machine Gun', bubble: 'Invincible Bubble' };

export class Game {
  constructor({ canvas, audio, hud, settings }) {
    this.canvas = canvas;
    this.audio = audio;
    this.hud = hud;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1200);
    this.input = new Input(canvas);
    this.karts = [];
    this.world = null;
    this.fx = null;
    this.weapons = new Weapons(this);
    this.net = null;
    this.state = 'menu';       // menu | countdown | playing | attract | ended
    this.paused = false;
    this.time = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.acc = 0;
    this.camH = 0; this.fov = 62; this.shakeAmt = 0;
    this.camPos = new THREE.Vector3(0, 40, 60);
    this.listen = { x: 0, z: 0 };
    this.netT = 0;
    this.sbHeld = false;
    this.onMatchEnd = null;
    this.input.onPause = () => this.onPauseKey?.();
    this.input.onTab = (v) => { this.sbHeld = v; };
    this.resize();
    addEventListener('resize', () => this.resize());
    this.applyQuality();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyQuality() {
    const q = this.settings.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = !!this.settings.shadows;
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this.resize();
    if (this.world) { this.world.sun.castShadow = !!this.settings.shadows; this.world.sun.shadow.mapSize.set(q === 'low' ? 1024 : 2048, q === 'low' ? 1024 : 2048); this.world.sun.shadow.map?.dispose(); this.world.sun.shadow.map = null; }
  }

  get quality() { return { high: 1, medium: 0.6, low: 0.35 }[this.settings.quality] ?? 1; }
  get localKart() { return this.karts.find((k) => k.isLocal) || null; }
  kartById(id) { return this.karts.find((k) => k.id === id) || null; }
  netSend(msg) { if (this.net?.connected) this.net.relay(msg); }

  /* ============================================================ match lifecycle */
  clearMatch() {
    this.weapons.clear();
    for (const k of this.karts) k.dispose();
    this.karts = [];
    if (this.fx) {
      this.fx.clear();
      this.scene.remove(this.fx.add.points, this.fx.parts.points);
    }
    if (this.world) { this.world.dispose(); this.world = null; }
    this.audio.silenceLoops?.();
  }

  loadMap(mapId) {
    const map = getMap(mapId);
    this.world = new World(this.scene, map, { shadows: this.settings.shadows });
    this.fx = new Effects(this.scene, this.quality);
    this.hud.setMap(this.world);
    this.applyQuality();
    return map;
  }

  /**
   * cfg: { mode:'solo'|'online'|'attract', mapId, duration, bots, difficulty,
   *        player:{id,name,color,head}, players?:[...] (online roster, includes self) }
   */
  startMatch(cfg) {
    this.clearMatch();
    this.cfg = cfg;
    this.mode = cfg.mode;
    const map = this.loadMap(cfg.mapId);
    this.matchT = cfg.duration || 180;
    this.hud.reset();
    this.paused = false;
    this.timeScale = 1;
    this.endHandled = false;
    const spawns = map.spawns;
    let si = 0;
    const place = (k) => { const s = spawns[si++ % spawns.length]; k.hardReset(s[0], s[1], s[2]); k.invuln = 0; };

    if (cfg.mode === 'online') {
      const myId = cfg.player.id;
      cfg.players.forEach((p) => {
        const k = new Kart(this, { id: p.id, name: p.name, color: p.color, head: p.head, isLocal: p.id === myId, remote: p.id !== myId });
        this.karts.push(k); place(k);
      });
    } else {
      if (cfg.mode !== 'attract') {
        const k = new Kart(this, { id: 'me', name: cfg.player.name, color: cfg.player.color, head: cfg.player.head, isLocal: true });
        this.karts.push(k); place(k);
      }
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      const colors = BOT_COLORS.filter((c) => c.toLowerCase() !== (cfg.player?.color || '').toLowerCase()).sort(() => Math.random() - 0.5);
      const n = cfg.mode === 'attract' ? 6 : cfg.bots;
      for (let i = 0; i < n; i++) {
        const b = new Kart(this, { id: 'bot' + i, name: names[i], color: colors[i % colors.length], head: i % 4, isBot: true });
        b.brain = new BotBrain(b, this, cfg.difficulty || 'normal');
        this.karts.push(b); place(b);
      }
    }
    for (const k of this.karts) k.model.root.position.set(k.x, 0, k.z);
    const me = this.localKart;
    this.camH = me ? me.h : 0;
    this.snapCamera();
    this.hud.show(cfg.mode !== 'attract');
    this.acc = 0; this.netT = 0;
    this.input.reset();
    if (cfg.mode === 'attract') { this.state = 'attract'; this.input.enabled = false; }
    else {
      this.state = 'countdown'; this.cdT = 3.6; this.cdLast = 4; this.input.enabled = true;
      this.hud.setItem(null);
    }
    this.hud.setKills(0);
  }

  endMatch() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.input.enabled = false;
    this.audio.silenceLoops();
    this.hud.scoreboard(false, []);
    this.hud.centerMsg('TIME!', '', true);
    this.audio.win();
    if (this.net?.isHost) this.net.end();
    const rows = this.scoreRows();
    this.endT = 2.4;
    this.results = rows;
  }

  scoreRows() {
    return [...this.karts]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((k) => ({ id: k.id, name: k.name, color: k.colorHex, kills: k.kills, deaths: k.deaths, isLocal: k.isLocal }));
  }

  removeKart(id) {
    const i = this.karts.findIndex((k) => k.id === id);
    if (i < 0) return;
    const k = this.karts[i];
    this.weapons.removeSpike(k);
    k.dispose();
    this.karts.splice(i, 1);
  }

  /* ============================================================ helpers used by other modules */
  spatial(x, z) {
    const d = Math.hypot(x - this.listen.x, z - this.listen.z);
    const vol = Math.pow(clamp(1.05 - d / 130, 0.03, 1), 1.4);
    const rx = -Math.cos(this.camH), rz = Math.sin(this.camH);
    const pan = clamp(((x - this.listen.x) * rx + (z - this.listen.z) * rz) / 45, -1, 1) * 0.9;
    return { vol, pan };
  }

  shake(mag, x, z) {
    if (!this.settings.shake) return;
    const d = x === undefined ? 0 : Math.hypot(x - this.listen.x, z - this.listen.z);
    this.shakeAmt = Math.max(this.shakeAmt, mag * clamp(1 - d / 70, 0, 1));
  }

  snapCamera() {
    const k = this.localKart;
    if (k) this.camH = k.h;
    this.camSnap = true;
  }

  onKartEvent(k, type, v) {
    const sp = this.spatial(k.x, k.z);
    switch (type) {
      case 'bump':
        this.audio.bump(sp);
        this.fx.add.burst(k.x, 1, k.z, Math.min(14, Math.round(v)), { speed: 9, life: 0.3, size: 0.6, size1: 0, c: [1, 0.9, 0.5], c1: [1, 0.4, 0.1], grav: 20, drag: 1 });
        if (k.isLocal) this.shake(clamp(v / 40, 0.1, 0.5), k.x, k.z);
        break;
      case 'driftTier':
        if (k.isLocal) this.audio.driftTier(v);
        this.fx.flash(k.x, 0.8, k.z, { size: 5, color: [0xffffff, 0x4ab0ff, 0xffa020, 0xc050ff][v], life: 0.2 });
        break;
      case 'miniBoost':
        this.audio.miniBoost(v, sp);
        this.fx.add.burst(k.x, 1, k.z, 12 * v, { speed: 12, life: 0.4, size: 1, size1: 0, c: [[1, 1, 1], [0.3, 0.7, 1], [1, 0.6, 0.1], [0.8, 0.3, 1]][v], c1: [1, 0.3, 0.1], drag: 3 });
        if (k.isLocal) this.fovKick = 10 + v * 3;
        break;
      case 'padBoost':
        this.audio.miniBoost(2, sp);
        this.fx.ring(k.x, k.z, { radius: 5, color: 0xfff06a, life: 0.35 });
        if (k.isLocal) this.fovKick = 12;
        break;
    }
  }

  /* ============================================================ combat */
  damage(k, amount, source, weapon) {
    if (!k.authoritative || k.dead || k.invuln > 0) return;
    if (k.shieldT > 0) { this.weapons.shieldHit(k); return; }
    if (amount <= 0) return;
    k.hp -= amount;
    k.hitFlash = 0.18;
    if (source && source !== k) { k.lastHitBy = source.id; k.lastHitT = this.time; k.lastHitW = weapon; }
    this.fx.add.burst(k.x, 1.5, k.z, 8, { speed: 8, life: 0.3, size: 0.8, size1: 0, c: [1, 0.8, 0.4], c1: [1, 0.2, 0.1], drag: 2 });
    if (k.isLocal) { this.hud.flash('hit'); this.shake(clamp(amount / 60, 0.15, 0.6), k.x, k.z); this.audio.hurt({}); }
    if (source?.isLocal && source !== k) {
      this.audio.hitMarker(); this.hud.hitmarker();
      this.fx.text(k.x, 3.8, k.z, '-' + Math.round(amount), { color: amount >= 30 ? '#ff5a3a' : '#fff06a', size: amount >= 30 ? 2.4 : 1.6, life: 0.7 });
    }
    if (k.hp <= 0) this.killKart(k, source, weapon);
  }

  killKart(k, killer, weapon) {
    let killerId = killer && killer !== k ? killer.id : null;
    if (!killerId && k.lastHitBy && this.time - k.lastHitT < 6) { killerId = k.lastHitBy; weapon = k.lastHitW || weapon; }
    this._die(k, killerId, weapon);
    this.netSend({ k: 'died', killer: killerId, w: weapon });
  }

  _die(k, killerId, weapon) {
    k.hp = 0; k.dead = true; k.deadT = 3.2;
    k.item = null; k.shieldT = 0; k.spikeT = 0; k.gunT = 0; k.frozenT = 0; k.spinT = 0; k.drifting = 0; k.boostTime = 0;
    this.weapons.removeSpike(k); this.weapons.removeGun(k);
    const killer = killerId ? this.kartById(killerId) : null;
    this.deathFx(k, killer);
    this.registerKill(killer, k, weapon);
  }

  deathFx(k, killer) {
    const sp = this.spatial(k.x, k.z);
    const fancy = killer?.isLocal && killer !== k && this.mode !== 'attract';
    this.fx.explosion(k.x, k.z, fancy ? 1.9 : 1.4, 'fire');
    this.fx.debris(k.x, 1.2, k.z, 14, [new THREE.Color(k.colorHex).getHex(), 0x222222, 0xdddddd], { speed: 20, size: 0.7 });
    this.audio.deathBoom(sp);
    this.shake(k.isLocal ? 1.2 : 0.7, k.x, k.z);
    this.launchGhost(k, fancy ? 1.4 : 1);
    if (fancy) {
      const style = Math.floor(Math.random() * 4);
      const f = this.fx;
      switch (style) {
        case 0: // skibidi flush
          f.emojiBurst(k.x, 2, k.z, ['🚽', '💦', '🌀', '🧻'], 10, { speed: 22, size: 3.4 });
          f.add.burst(k.x, 1, k.z, 70, { speed: 24, life: 1, size: 1.4, size1: 0, c: [0.4, 0.8, 1], c1: [0.1, 0.3, 1], grav: 20, drag: 0.6 });
          f.ring(k.x, k.z, { radius: 14, color: 0x4ab0ff, life: 0.8 });
          break;
        case 1: // toxic fart cloud
          f.emojiBurst(k.x, 2, k.z, ['💨', '🤢', '💚', '☣️'], 10, { speed: 22, size: 3.4 });
          f.parts.burst(k.x, 1.5, k.z, 50, { speed: 12, life: 2, size: 4, size1: 11, c: [0.35, 0.8, 0.15], c1: [0.2, 0.5, 0.1], a: 0.5, up: 3, drag: 1 });
          f.add.burst(k.x, 1.5, k.z, 50, { speed: 22, life: 0.9, size: 1.8, size1: 0, c: [0.6, 1, 0.2], c1: [0.1, 0.6, 0.1], drag: 1.5 });
          break;
        case 2: // confetti
          f.emojiBurst(k.x, 2, k.z, ['🎉', '🗿', '😎', '✨'], 10, { speed: 24, size: 3.4 });
          for (let i = 0; i < 90 * f.quality; i++) {
            const c = new THREE.Color().setHSL(Math.random(), 1, 0.6);
            f.add.emit(k.x, 1.5, k.z, rand(-18, 18), rand(8, 28), rand(-18, 18), rand(1, 1.8), 0.9, 0.5, c.r, c.g, c.b, c.r, c.g, c.b, 1, 24, 0.5);
          }
          break;
        case 3: // sigma shockwave
          f.emojiBurst(k.x, 2, k.z, ['🗿', '💪', '🔥', '👑'], 10, { speed: 24, size: 3.4 });
          f.ring(k.x, k.z, { radius: 22, color: 0xffd23a, life: 0.7 });
          f.ring(k.x, k.z, { radius: 13, color: 0xffffff, life: 0.5 });
          f.flash(k.x, 2, k.z, { size: 30, color: 0xffd060, life: 0.5 });
          break;
      }
      f.text(k.x, 5.5, k.z, pick(KILL_VERBS) + '!', { color: '#ff5ab0', size: 3.2, life: 1.3, rise: 6 });
    } else {
      this.fx.emojiBurst(k.x, 2, k.z, ['💥', '💀', '🧠'], 4, { speed: 16, size: 2.6 });
    }
  }

  /** the wrecked kart is flung into the sky, spinning, then pops */
  launchGhost(k, power = 1) {
    const g = k.model.body.clone(true);
    g.position.set(k.x, 0.5, k.z);
    g.rotation.y = k.h;
    this.scene.add(g);
    const v = new THREE.Vector3(k.vx * 0.4 + rand(-6, 6), rand(24, 34) * power, k.vz * 0.4 + rand(-6, 6));
    const w = new THREE.Vector3(rand(-8, 8), rand(-10, 10), rand(-8, 8));
    let t = 0;
    this.fx.list.push({
      update: (dt) => {
        t += dt; v.y -= 42 * dt;
        g.position.addScaledVector(v, dt);
        g.rotation.x += w.x * dt; g.rotation.y += w.y * dt; g.rotation.z += w.z * dt;
        if (Math.random() < 0.7) this.fx.parts.emit(g.position.x, g.position.y, g.position.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.6, 1.2, 3, 0.25, 0.25, 0.25, 0.1, 0.1, 0.1, 0.6, 0, 1);
        if (g.position.y <= 0.5 && t > 0.3) {
          this.fx.explosion(g.position.x, g.position.z, 0.8);
          this.audio.explosion(0.6, this.spatial(g.position.x, g.position.z));
          return false;
        }
        return t < 4;
      },
      dispose: () => this.scene.remove(g),
    });
  }

  registerKill(killer, victim, weapon) {
    victim.deaths++; victim.streak = 0; victim.multi = 0;
    const emoji = WEAPON_EMOJI[weapon] || '💀';
    const live = this.mode !== 'attract';
    if (killer && killer !== victim) {
      killer.kills++; killer.streak++;
      killer.multi = this.time - killer.multiT < 4.5 ? killer.multi + 1 : 1;
      killer.multiT = this.time;
      if (live) this.hud.feed({ name: killer.name, color: killer.colorHex }, emoji, { name: victim.name, color: victim.colorHex }, killer.isLocal || victim.isLocal);
      if (killer.isLocal) this.onLocalKill(killer, victim, weapon);
    } else if (live) {
      this.hud.feed(null, '💀', { name: victim.name + ' self-destructed', color: victim.colorHex }, victim.isLocal);
    }
    if (victim.isLocal && live) {
      if (killer && killer !== victim) this.audio.playDeath();
      this.hud.banner(killer && killer !== victim ? `${pick(KILL_VERBS)} by ${killer.name}` : 'SELF-DESTRUCT!', WEAPON_NAME[weapon] || '');
      this.hud.setItem(null);
    }
  }

  onLocalKill(me, victim, weapon) {
    this.audio.playKill();
    this.hud.banner(`YOU ${pick(KILL_VERBS)} ${victim.name}`, `${WEAPON_EMOJI[weapon] || '💀'}  +1 kill  ·  ${me.kills} total`);
    this.hud.setKills(me.kills);
    this.slowT = 0.35; this.timeScale = 0.35;
    if (me.multi >= 2) {
      const i = Math.min(me.multi - 1, MULTI.length - 1);
      this.hud.streak(MULTI[i]);
      this.audio.speak(MULTI_SAY[i]);
    } else if (me.streak >= 3 && me.streak % 3 === 0) {
      this.hud.streak(`${me.streak} KILL STREAK 🔥`);
      this.audio.speak('Unstoppable');
    }
  }

  respawn(k) {
    const spawns = this.world.map.spawns;
    let best = spawns[0], bs = -1;
    for (const s of spawns) {
      let md = 999;
      for (const o of this.karts) if (o !== k && !o.dead) md = Math.min(md, Math.hypot(o.x - s[0], o.z - s[1]));
      const score = md + Math.random() * 12;
      if (score > bs) { bs = score; best = s; }
    }
    const kills = k.kills, deaths = k.deaths, streak = k.streak;
    k.hardReset(best[0], best[1], best[2]);
    k.kills = kills; k.deaths = deaths; k.streak = streak;
    k.invuln = 2.2;
    this.fx.ring(k.x, k.z, { radius: 6, color: 0xffffff, life: 0.5 });
    this.fx.add.burst(k.x, 1, k.z, 24, { speed: 10, life: 0.6, size: 1.2, size1: 0, c: [1, 1, 1], c1: [0.5, 0.8, 1], drag: 2 });
    if (k.isLocal) { this.audio.respawn(); this.snapCamera(); this.hud.centerMsg(''); }
  }

  /* ============================================================ simulation */
  pickups() {
    for (const k of this.karts) {
      if (k.dead || !k.authoritative || k.item) continue;
      for (const ib of this.world.itemBoxes) {
        if (!ib.active) continue;
        if ((k.x - ib.x) ** 2 + (k.z - ib.z) ** 2 > 2.9 * 2.9) continue;
        this.world.takeBox(ib);
        k.item = itemFor(rollItem(this.cfg?.allowed));
        k.rouletteT = k.isLocal ? 0.95 : 0.4;
        this.netSend({ k: 'box', i: ib.idx });
        this.boxFx(ib);
        if (k.isLocal) { this.audio.pickup(); this.rollTick = 0; }
        break;
      }
    }
  }

  boxFx(ib) {
    this.fx.add.burst(ib.x, 2.2, ib.z, 24, { speed: 12, life: 0.6, size: 1.2, size1: 0, c: [1, 1, 0.5], c1: [1, 0.3, 0.8], drag: 2 });
    this.fx.ring(ib.x, ib.z, { radius: 4, color: 0xffee66, life: 0.4 });
  }

  kartCollisions() {
    const K = this.karts;
    for (let i = 0; i < K.length; i++) {
      const a = K[i];
      if (a.dead) continue;
      for (let j = i + 1; j < K.length; j++) {
        const b = K[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = 2.6;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = min - d;
        const wa = a.authoritative ? 1 : 0, wb = b.authoritative ? 1 : 0, tot = wa + wb;
        if (!tot) continue;
        a.x -= nx * pen * (wa / tot); a.z -= nz * pen * (wa / tot);
        b.x += nx * pen * (wb / tot); b.z += nz * pen * (wb / tot);
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const j2 = -(1 + 0.55) * rv;
          a.vx -= nx * j2 * (wa / tot); a.vz -= nz * j2 * (wa / tot);
          b.vx += nx * j2 * (wb / tot); b.vz += nz * j2 * (wb / tot);
          if (-rv > 6 && (a.isLocal || b.isLocal || this.mode === 'attract')) {
            this.audio.bump(this.spatial(a.x, a.z));
            this.fx.add.burst((a.x + b.x) / 2, 1.2, (a.z + b.z) / 2, 8, { speed: 8, life: 0.25, size: 0.6, size1: 0, c: [1, 1, 0.6], c1: [1, 0.5, 0.1], drag: 1 });
            if (a.isLocal || b.isLocal) this.shake(0.25, a.x, a.z);
          }
        }
      }
    }
  }

  sim(dt) {
    const world = this.world;
    const live = this.state === 'playing' || this.state === 'attract';
    for (const k of this.karts) {
      if (k.dead) {
        if (k.authoritative) { k.deadT -= dt; if (k.deadT <= 0 && live) this.respawn(k); }
        continue;
      }
      if (k.remote) { k.netStep(dt); continue; }
      let inp;
      if (!live) inp = { steer: 0, throttle: 0, drift: false, fire: false };
      else if (k.isLocal) {
        inp = this.input.get();
        const press = this.input.takeFire();
        if (k.item && (press || (inp.fire && k.item.type === 'fart'))) this.weapons.use(k);
      } else {
        inp = k.brain.think(dt);
        if (inp.fire && k.item) this.weapons.use(k);
      }
      k.inp = inp;
      k.step(dt, inp, world);
    }
    if (live) {
      this.kartCollisions();
      this.pickups();
    }
    this.weapons.update(dt);
  }

  /* ============================================================ per-frame */
  frame(rawDt) {
    if (!this.world) return;
    let dt = Math.min(rawDt, 0.05);
    // slow-mo recovery
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    else this.timeScale = lerp(this.timeScale, 1, 1 - Math.exp(-8 * dt));
    const gdt = dt * (this.paused ? 0 : this.timeScale);

    if (!this.paused) {
      this.time += gdt;
      if (this.state === 'countdown') {
        this.cdT -= dt;
        const n = Math.ceil(this.cdT);
        if (n !== this.cdLast) {
          this.cdLast = n;
          if (n >= 1 && n <= 3) { this.hud.centerMsg(String(n), 'Get ready!', true); this.audio.beep(n, false); }
          else if (n <= 0) { this.hud.centerMsg('GO!', '', true); this.audio.beep(0, true); this.audio.startMusic(); setTimeout(() => { if (this.state === 'playing') this.hud.centerMsg(''); }, 900); }
        }
        if (this.cdT <= 0) this.state = 'playing';
      }
      if (this.state === 'playing') {
        this.matchT -= gdt;
        if (this.matchT <= 0) this.endMatch();
      }
      if (this.state === 'ended') {
        this.endT -= dt;
        if (this.endT <= 0 && !this.endHandled) { this.endHandled = true; this.onMatchEnd?.(this.results); }
      }
      if (this.state !== 'ended') {
        this.acc += gdt;
        let n = 0;
        while (this.acc >= STEP && n++ < 5) { this.sim(STEP); this.acc -= STEP; }
        if (n >= 5) this.acc = 0;
      } else this.weapons.update(gdt); // let the last explosions finish
      if (this.mode === 'online') this.netTick(dt);
    }

    this.updateRemoteWorld(gdt);
    this.updateCamera(dt);
    this.updateHud(dt);
    this.updateAudio();

    // visuals
    for (const k of this.karts) k.updateVisual(gdt, this.time, k.inp);
    this.world.update(gdt, this.fx);
    this.fx.update(gdt, this.camera, innerHeight, this.renderer.getPixelRatio());
    this.world.sky.position.copy(this.camera.position);
    const f = this.camFocus || { x: 0, z: 0 };
    this.world.sun.position.set(f.x + 45, 85, f.z + 30);
    this.world.sun.target.position.set(f.x, 0, f.z);
    this.renderer.render(this.scene, this.camera);
  }

  updateRemoteWorld() { /* reserved for interpolation hooks */ }

  netTick(dt) {
    const me = this.localKart;
    if (!me) return;
    this.netT -= dt;
    if (this.netT <= 0) { this.netT = 0.05; this.netSend(me.netState()); }
  }

  handleNet(from, d) {
    const k = this.kartById(from);
    if (!k || !this.world) return;
    switch (d.k) {
      case 's':
        if (k.dead && !d.d) { // remote respawned
          const kills = k.kills, deaths = k.deaths, streak = k.streak;
          k.hardReset(d.x, d.z, d.h); k.kills = kills; k.deaths = deaths; k.streak = streak; k.net = null;
          this.fx.ring(d.x, d.z, { radius: 6, color: 0xffffff, life: 0.5 });
        }
        k.applyNet(d);
        break;
      case 'use': this.weapons.remoteUse(k, d); break;
      case 'rm': this.weapons.removeRemote(d.id); break;
      case 'box': {
        const ib = this.world.itemBoxes[d.i];
        if (ib?.active) { this.world.takeBox(ib); this.boxFx(ib); }
        break;
      }
      case 'died':
        if (!k.dead) this._die(k, d.killer, d.w);
        k.deadT = 99;
        break;
    }
  }

  /* ============================================================ camera / hud / audio */
  updateCamera(dt) {
    const cam = this.camera, k = this.localKart;
    let tx, ty, tz, lx, ly, lz;
    if (!k || this.state === 'ended' || this.state === 'attract' && !k) {
      // cinematic orbit (menus / end of match)
      this.orbit = (this.orbit || 0) + dt * 0.18;
      const b = this.world.bounds;
      const R = (b.type === 'circle' ? b.r : Math.max(b.hw, b.hd)) * 0.62;
      tx = Math.cos(this.orbit) * R; tz = Math.sin(this.orbit) * R; ty = 30;
      lx = 0; ly = 0; lz = 0;
      this.camFocus = { x: 0, z: 0 };
      this.listen.x = 0; this.listen.z = 0;
      this.fov = damp(this.fov, 60, 4, dt);
      cam.position.set(tx, ty, tz);
      cam.fov = this.fov; cam.updateProjectionMatrix();
      cam.lookAt(lx, ly, lz);
      return;
    }
    const sp = clamp(k.speed / MAX_SPEED, 0, 1.6);
    if (k.dead) {
      this.orbit = (this.orbit || 0) + dt * 0.6;
      tx = k.x + Math.sin(this.orbit) * 18; tz = k.z + Math.cos(this.orbit) * 18; ty = 14;
      cam.position.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.exp(-3 * dt));
      cam.lookAt(k.x, 1, k.z);
      this.camFocus = { x: k.x, z: k.z };
      this.listen.x = k.x; this.listen.z = k.z;
      if (this.state !== 'ended') this.hud.centerMsg('', `Respawning in ${Math.max(1, Math.ceil(k.deadT))}…`);
      return;
    }
    // chase camera: heading lags a little, and swings toward the slide direction in drifts
    const target = k.h + (k.drifting ? -k.drifting * 0.32 : 0);
    if (this.camSnap) { this.camH = target; this.camSnap = false; this.camReady = false; }
    this.camH = lerpAngle(this.camH, target, 1 - Math.exp(-(k.drifting ? 3.5 : 6.5) * dt));
    const dist = 11.5 + sp * 2.2, height = 7.4 + sp * 0.8;
    const sx = Math.sin(this.camH), sz = Math.cos(this.camH);
    const desired = new THREE.Vector3(k.x - sx * dist, height, k.z - sz * dist);
    if (!this.camReady) { cam.position.copy(desired); this.camReady = true; }
    else cam.position.lerp(desired, 1 - Math.exp(-18 * dt));
    if (this.shakeAmt > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt * 1.4;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt * 1.0;
      cam.position.z += (Math.random() - 0.5) * this.shakeAmt * 1.4;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    }
    cam.lookAt(k.x + sx * 5.5, 1.4, k.z + sz * 5.5);
    this.fovKick = damp(this.fovKick || 0, 0, 3.5, dt);
    const targetFov = 62 + sp * 9 + (k.boostTime > 0 ? 7 : 0) + this.fovKick;
    this.fov = damp(this.fov, targetFov, 6, dt);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    this.camFocus = { x: k.x, z: k.z };
    this.listen.x = k.x; this.listen.z = k.z;
  }

  updateHud(dt) {
    if (this.mode === 'attract') return;
    const me = this.localKart, h = this.hud;
    h.setTimer(this.matchT, false);
    const rows = this.scoreRows();
    h.leaderboard(rows, dt);
    h.scoreboard(this.sbHeld && this.state !== 'ended', rows);
    if (me) {
      h.setHP(me.dead ? 0 : me.hp);
      h.setKills(me.kills);
      const rolling = me.rouletteT > 0 && me.item;
      if (rolling) {
        this.rollTick = (this.rollTick || 0) - dt;
        const keys = Object.keys(ITEMS);
        if (this.rollTick <= 0) { this.rollTick = 0.07; this.rollIdx = ((this.rollIdx || 0) + 1) % keys.length; this.audio.roulette(this.rollIdx); }
        h.setItem(me.item, true, ITEMS[keys[this.rollIdx || 0]].emoji);
        this.wasRolling = true;
      } else {
        if (this.wasRolling && me.item) this.audio.reveal();
        this.wasRolling = false;
        h.setItem(me.item);
      }
      h.setDrift(me.driftTier, me.driftT, !!me.drifting && !me.dead);
      h.speedLines(!me.dead && me.boostTime > 0);
      h.drawMinimap(this.world, this.karts, me);
    } else h.drawMinimap(this.world, this.karts, null);
  }

  updateAudio() {
    const me = this.localKart;
    if (!me || me.dead || this.state === 'ended' || this.paused) { this.audio.engine(false); this.audio.drift(0); return; }
    this.audio.engine(true, clamp(me.speed / MAX_SPEED, 0, 1.5), me.boostTime > 0);
    this.audio.drift(me.drifting && me.speed > 8 ? 0.5 + me.driftTier * 0.2 : 0);
  }
}
