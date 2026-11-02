import * as THREE from 'three';
import { rand, clamp } from './util.js';

/* ---------------------------------------------------------------- textures */
const emojiCache = new Map();
export function emojiTexture(ch) {
  if (emojiCache.has(ch)) return emojiCache.get(ch);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '96px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(ch, t);
  return t;
}

let _glow;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

export function textTexture(text, { color = '#fff', stroke = '#000', size = 64, font = 'Impact, Arial Black, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `${size}px ${font}`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = size + 24;
  g.font = `${size}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.lineJoin = 'round';
  g.strokeStyle = stroke; g.strokeText(text, w / 2, c.height / 2 + 2);
  g.fillStyle = color; g.fillText(text, w / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / c.height };
}

/* ---------------------------------------------------------------- GPU particles (one draw call) */
export class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vC; uniform float uScale;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
        if (d > 0.5) discard; float a = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    this.geo = geo;
  }

  /** positional emit: size s0->s1, color (r,g,b)->(r1,g1,b1), alpha a. gravity is downward accel; drag 1/s */
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, r1, g1, b1, a = 1, grav = 0, drag = 0) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    const c = i * 4;
    this.c0[c] = r; this.c0[c + 1] = g; this.c0[c + 2] = b; this.c0[c + 3] = a;
    const d = i * 3;
    this.c1[d] = r1; this.c1[d + 1] = g1; this.c1[d + 2] = b1;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  /** sphere burst with random directions */
  burst(x, y, z, count, o = {}) {
    const { speed = 8, life = 0.7, size = 1, size1 = 0, c = [1, 1, 1], c1 = c, a = 1, grav = 0, drag = 1.5, up = 0, spread = 1 } = o;
    for (let k = 0; k < count; k++) {
      let dx = rand(-1, 1), dy = rand(-1, 1) * spread, dz = rand(-1, 1);
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = speed * rand(0.35, 1);
      this.emit(x, y, z, (dx / l) * s, (dy / l) * s + up, (dz / l) * s, life * rand(0.6, 1.1), size * rand(0.7, 1.2), size1, c[0], c[1], c[2], c1[0], c1[1], c1[2], a, grav, drag);
    }
  }

  update(dt, camera, height, pixelRatio) {
    this.mat.uniforms.uScale.value = (height * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < this.n;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap-remove
        const l = --this.n;
        if (i !== l) this._copy(l, i);
        continue;
      }
      const p = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[p] *= dr; this.vel[p + 1] = this.vel[p + 1] * dr - this.grav[i] * dt; this.vel[p + 2] *= dr;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      if (this.pos[p + 1] < 0.05 && this.grav[i] > 0) { this.pos[p + 1] = 0.05; this.vel[p + 1] *= -0.3; }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const c = i * 4, d = i * 3;
      this.col[c] = this.c0[c] + (this.c1[d] - this.c0[c]) * t;
      this.col[c + 1] = this.c0[c + 1] + (this.c1[d + 1] - this.c0[c + 1]) * t;
      this.col[c + 2] = this.c0[c + 2] + (this.c1[d + 2] - this.c0[c + 2]) * t;
      this.col[c + 3] = this.c0[c + 3] * (1 - t * t);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = true;
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; this.c1[to * 3 + k] = this.c1[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.c0[to * 4 + k] = this.c0[from * 4 + k];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }

  clear() { this.n = 0; }
}

/* ---------------------------------------------------------------- transient 3D effects */
const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
const ringGeo = new THREE.RingGeometry(0.85, 1, 48);

export class Effects {
  constructor(scene, quality = 1) {
    this.scene = scene;
    this.list = [];
    this.quality = quality;
    this.add = new Particles(scene, Math.round(4200 * quality), true); // glowing stuff
    this.parts = new Particles(scene, Math.round(2600 * quality), false); // smoke / debris puffs
    // shared alias so callers can say fx.parts / fx.glow
    this.glow = this.add;
  }

  ring(x, z, { radius = 8, color = 0xffffff, life = 0.5, y = 0.2, width = 1, opacity = 0.9 } = {}) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    this.scene.add(m);
    let t = 0;
    this.list.push({
      update: (dt) => {
        t += dt;
        const k = clamp(t / life, 0, 1);
        const s = radius * (1 - Math.pow(1 - k, 3));
        m.scale.set(s * width, s * width, 1);
        m.material.opacity = opacity * (1 - k);
        return k < 1;
      },
      dispose: () => { this.scene.remove(m); m.material.dispose(); },
    });
  }

  flash(x, y, z, { size = 8, color = 0xffffff, life = 0.25 } = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.set(x, y, z);
    this.scene.add(s);
    let t = 0;
    this.list.push({
      update: (dt) => {
        t += dt;
        const k = clamp(t / life, 0, 1);
        s.scale.setScalar(size * (0.5 + k));
        s.material.opacity = 1 - k;
        return k < 1;
      },
      dispose: () => { this.scene.remove(s); s.material.dispose(); },
    });
  }

  /** chunky tumbling debris cubes */
  debris(x, y, z, count, colors, { speed = 14, size = 0.6, life = 1.6 } = {}) {
    count = Math.round(count * this.quality);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(debrisGeo, new THREE.MeshLambertMaterial({ color: colors[i % colors.length] }));
      const s = size * rand(0.5, 1.4);
      m.scale.set(s * rand(0.6, 1.6), s * rand(0.6, 1.4), s * rand(0.6, 1.6));
      m.position.set(x, y, z);
      m.castShadow = true;
      this.scene.add(m);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
      const w = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      let t = 0;
      this.list.push({
        update: (dt) => {
          t += dt;
          v.y -= 30 * dt;
          m.position.addScaledVector(v, dt);
          if (m.position.y < s * 0.5) { m.position.y = s * 0.5; v.y *= -0.4; v.x *= 0.7; v.z *= 0.7; w.multiplyScalar(0.7); }
          m.rotation.x += w.x * dt; m.rotation.y += w.y * dt; m.rotation.z += w.z * dt;
          if (t > life * 0.7) m.scale.multiplyScalar(1 - dt * 3);
          return t < life;
        },
        dispose: () => { this.scene.remove(m); m.material.dispose(); },
      });
    }
  }

  /** emoji sprites exploding outward */
  emojiBurst(x, y, z, emojis, count = 8, { speed = 16, life = 1.4, size = 3 } = {}) {
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emojis[i % emojis.length]), transparent: true, depthWrite: false, fog: false }));
      sp.position.set(x, y, z);
      const sz = size * rand(0.7, 1.3);
      sp.scale.setScalar(sz);
      this.scene.add(sp);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
      let t = 0;
      this.list.push({
        update: (dt) => {
          t += dt;
          v.y -= 22 * dt;
          sp.position.addScaledVector(v, dt);
          sp.material.opacity = clamp(1 - (t - life * 0.6) / (life * 0.4), 0, 1);
          sp.scale.setScalar(sz * (1 + t * 0.3));
          return t < life;
        },
        dispose: () => { this.scene.remove(sp); sp.material.dispose(); },
      });
    }
  }

  /** floating text (damage numbers, "TUNG!") */
  text(x, y, z, str, { color = '#fff', size = 2.4, life = 0.9, rise = 5 } = {}) {
    const { tex, aspect } = textTexture(str, { color, size: 56 });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    sp.renderOrder = 20;
    sp.position.set(x, y, z);
    sp.scale.set(size * aspect, size, 1);
    this.scene.add(sp);
    let t = 0;
    this.list.push({
      update: (dt) => {
        t += dt;
        sp.position.y += rise * dt * (1 - t / life);
        sp.material.opacity = clamp(2 - (t / life) * 2, 0, 1);
        const pop = t < 0.12 ? 1 + (0.12 - t) * 4 : 1;
        sp.scale.set(size * aspect * pop, size * pop, 1);
        return t < life;
      },
      dispose: () => { this.scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); },
    });
  }

  /** big layered explosion used by rockets, mines, bombs and kart deaths */
  explosion(x, z, size = 1, palette = 'fire') {
    const y = 1;
    const hot = palette === 'toxic' ? [0.5, 1, 0.2] : palette === 'ice' ? [0.6, 0.9, 1] : [1, 0.75, 0.25];
    const mid = palette === 'toxic' ? [0.2, 0.7, 0.1] : palette === 'ice' ? [0.3, 0.6, 1] : [1, 0.3, 0.08];
    this.flash(x, y + 1, z, { size: 18 * size, color: palette === 'toxic' ? 0xbaff5a : palette === 'ice' ? 0xbfe6ff : 0xffd080, life: 0.3 });
    this.ring(x, z, { radius: 9 * size, color: palette === 'toxic' ? 0x8dff3a : palette === 'ice' ? 0x8fd8ff : 0xffa040, life: 0.45 });
    this.add.burst(x, y, z, Math.round(46 * size * this.quality), { speed: 20 * size, life: 0.55, size: 2.4 * size, size1: 0.2, c: hot, c1: mid, drag: 2.2 });
    this.add.burst(x, y, z, Math.round(26 * size * this.quality), { speed: 12 * size, life: 0.9, size: 3 * size, size1: 0.5, c: mid, c1: [0.2, 0.05, 0.02], drag: 1.6, a: 0.8 });
    this.parts.burst(x, y, z, Math.round(22 * size * this.quality), { speed: 9 * size, life: 1.5, size: 3.4 * size, size1: 7 * size, c: [0.25, 0.22, 0.22], c1: [0.1, 0.1, 0.1], a: 0.55, up: 3, drag: 1.2 });
  }

  update(dt, camera, height, pixelRatio) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.update(dt)) { e.dispose(); this.list.splice(i, 1); }
    }
    this.add.update(dt, camera, height, pixelRatio);
    this.parts.update(dt, camera, height, pixelRatio);
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    this.add.clear(); this.parts.clear();
  }
}
