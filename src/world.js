import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, rand } from './util.js';
import { emojiTexture } from './fx.js';

export const KART_R = 1.25;
const ITEM_RESPAWN = 8;

const col = (n) => new THREE.Color(n);

function checkerTexture(a, b, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const ca = '#' + col(a).getHexString(), cb = '#' + col(b).getHexString();
  g.fillStyle = ca; g.fillRect(0, 0, 128, 128);
  g.fillStyle = cb; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126); g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function questionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
  g.fillStyle = '#222'; g.font = 'bold 100px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boostTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(20,10,0,0.55)'; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#fff36a'; g.lineWidth = 16; g.lineJoin = 'miter';
  for (let i = 0; i < 3; i++) {
    const y = 40 + i * 70;
    g.beginPath(); g.moveTo(14, y + 50); g.lineTo(64, y); g.lineTo(114, y + 50); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(scene, map, opts = {}) {
    this.scene = scene;
    this.map = map;
    this.bounds = map.bounds;
    this.boxes = map.boxes.map((b) => ({ ...b, hw: b.w / 2, hd: b.d / 2, h: b.h || 3 }));
    this.pillars = map.pillars.map((p) => ({ ...p, h: p.h || 3.2 }));
    this.slime = map.slime;
    this.boosts = map.boosts;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.itemBoxes = [];
    this.shadows = opts.shadows !== false;
    this.t = 0;
    this._build();
    this._buildNav();
  }

  /* ------------------------------------------------------------ visuals */
  _build() {
    const { map, group } = this;
    const th = map.theme;
    const b = this.bounds;
    const wallMats = th.wall.map((c) => new THREE.MeshLambertMaterial({ color: col(c).multiplyScalar(0.92) }));
    const capMats = th.wall.map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: col(c).multiplyScalar(0.12) }));
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const redBand = new THREE.MeshBasicMaterial({ color: 0xff3a30 });
    this.mats = { wallMats, capMats, bandMat, redBand };

    // sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: col(th.skyTop) }, bot: { value: col(th.skyBottom) } },
      vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float vY; void main(){ float t = smoothstep(-0.05, 0.75, vY); gl_FragColor = vec4(mix(bot, top, t), 1.0);} ',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // ground
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: th.outside }));
    outside.rotation.x = -Math.PI / 2; outside.position.y = -0.08; outside.receiveShadow = true;
    group.add(outside);
    let ground;
    if (b.type === 'rect') {
      ground = new THREE.Mesh(new THREE.PlaneGeometry(b.hw * 2, b.hd * 2),
        new THREE.MeshLambertMaterial({ map: checkerTexture(th.groundA, th.groundB, b.hw / 8, b.hd / 8) }));
    } else if (b.type === 'poly') {
      const shape = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ShapeGeometry(shape);
      const uv = geo.attributes.uv, pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + b.hw) / (b.hw * 2), (pos.getY(i) + b.hd) / (b.hd * 2));
      ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: checkerTexture(th.groundA, th.groundB, b.hw / 8, b.hd / 8) }));
    } else {
      ground = new THREE.Mesh(new THREE.CircleGeometry(b.r, 72),
        new THREE.MeshLambertMaterial({ map: checkerTexture(th.groundA, th.groundB, b.r / 8, b.r / 8) }));
    }
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    group.add(ground);

    // boundary wall
    const wallH = 3.4;
    if (b.type === 'rect') {
      const T = 2.5;
      const segs = [[0, -b.hd - T / 2, b.hw * 2 + T * 2, T], [0, b.hd + T / 2, b.hw * 2 + T * 2, T], [-b.hw - T / 2, 0, T, b.hd * 2], [b.hw + T / 2, 0, T, b.hd * 2]];
      segs.forEach(([x, z, w, d], i) => this._wallMesh(x, z, w, d, wallH, i % 3));
    } else if (b.type === 'poly') {
      const P = b.pts;
      let area = 0;
      for (let i = 0; i < P.length; i++) { const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length]; area += ax * bz - bx * az; }
      const sgn = area > 0 ? 1 : -1, T = 2.5;
      for (let i = 0; i < P.length; i++) {
        const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
        this._segMesh((ax + bx) / 2 + nx * T / 2, (az + bz) / 2 + nz * T / 2, L + 0.9, T, wallH, -Math.atan2(dz, dx), Math.floor(i / 2) % 3 + (i % 2 ? 0 : 0));
      }
    } else {
      const geo = new THREE.CylinderGeometry(b.r + 2.4, b.r + 2.4, wallH, 72, 1, true);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col(th.wall[1]).multiplyScalar(0.7), side: THREE.BackSide }));
      m.position.y = wallH / 2; m.receiveShadow = true;
      group.add(m);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(b.r + 2.4, 0.35, 8, 96), capMats[0]);
      rim.rotation.x = Math.PI / 2; rim.position.y = wallH;
      group.add(rim);
      const rim2 = rim.clone(); rim2.position.y = 1.4; rim2.material = new THREE.MeshBasicMaterial({ color: th.accent });
      group.add(rim2);
    }

    // obstacles
    this.boxes.forEach((bx, i) => this._wallMesh(bx.x, bx.z, bx.w, bx.d, bx.h, i % 3));
    this.pillars.forEach((p, i) => {
      this._batch(new THREE.CylinderGeometry(p.r, p.r * 1.05, p.h, 20), wallMats[i % 3], p.x, p.h / 2, p.z);
      this._batch(new THREE.CylinderGeometry(p.r * 1.12, p.r * 1.12, 0.4, 20), capMats[i % 3], p.x, p.h + 0.2, p.z);
      this._batch(new THREE.CylinderGeometry(p.r * 1.07, p.r * 1.07, 0.35, 20), bandMat, p.x, p.h * 0.55, p.z, false);
    });
    this._flushBatches();

    // slime pools
    for (const s of this.slime) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(s.r, 40), new THREE.MeshBasicMaterial({ color: 0x5dff2e, transparent: true, opacity: 0.8 }));
      m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.04, s.z);
      const edge = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.5, s.r, 40), new THREE.MeshBasicMaterial({ color: 0xc8ff3a }));
      edge.rotation.x = -Math.PI / 2; edge.position.set(s.x, 0.05, s.z);
      group.add(m, edge);
    }

    // boost pads
    const bt = boostTexture();
    this.boostTex = bt;
    for (const p of this.boosts) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 7),
        new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, color: 0xffee66 }));
      m.rotation.order = 'YXZ';
      m.rotation.x = -Math.PI / 2; m.rotation.y = p.a + Math.PI;
      m.position.set(p.x, 0.06, p.z);
      group.add(m);
    }

    // item boxes
    const qt = questionTexture();
    const cubeGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    const beamGeo = new THREE.CylinderGeometry(0.9, 0.9, 16, 14, 1, true);
    map.items.forEach(([x, z], idx) => {
      const mat = new THREE.MeshStandardMaterial({ map: qt, color: 0xffffff, emissive: 0xffffff, emissiveMap: qt, emissiveIntensity: 0.35, roughness: 0.4 });
      const cube = new THREE.Mesh(cubeGeo, mat);
      cube.castShadow = true;
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 8 - 1.8;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = -1.75 + 0.05;
      const holder = new THREE.Group();
      holder.position.set(x, 2.1, z);
      holder.add(cube, beam, disc);
      group.add(holder);
      this.itemBoxes.push({ x, z, idx, active: true, timer: 0, holder, cube, beam, disc, mat, pop: 0 });
    });

    // floating brainrot scenery
    this.props = [];
    const n = 14;
    const R = (b.type === 'circle' ? b.r : Math.max(b.hw, b.hd)) + 34;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(map.props[i % map.props.length]), transparent: true, fog: false }));
      sp.scale.setScalar(rand(14, 22));
      sp.position.set(Math.cos(a) * R, rand(9, 20), Math.sin(a) * R);
      sp.userData = { y0: sp.position.y, ph: rand(0, 6), a };
      group.add(sp);
      this.props.push(sp);
    }

    // lights
    this.hemi = new THREE.HemisphereLight(0xffffff, col(th.groundB).lerp(new THREE.Color(0xffffff), 0.35), 1.75);
    this.sun = new THREE.DirectionalLight(th.sun, 2.3);
    this.sun.position.set(40, 80, 30);
    this.sun.castShadow = this.shadows;
    const sc = this.sun.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 220;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(th.fog, 140, 420);
    this.scene.background = col(th.fog);
  }

  _wallMesh(x, z, w, d, h, ci) {
    const { wallMats, capMats, bandMat } = this.mats;
    this._batch(new THREE.BoxGeometry(w, h, d), wallMats[ci % wallMats.length], x, h / 2, z);
    this._batch(new THREE.BoxGeometry(w + 0.25, 0.4, d + 0.25), capMats[ci % capMats.length], x, h + 0.2, z);
    this._batch(new THREE.BoxGeometry(w + 0.08, 0.3, d + 0.08), bandMat, x, h * 0.5, z, false);
  }

  _segMesh(x, z, len, T, h, ang, ci) {
    const { wallMats, capMats, redBand } = this.mats;
    const bandMat = this.mats.bandMat;
    const put = (geo, mat, y, cast = true) => { geo.rotateY(ang); this._batch(geo, mat, x, y, z, cast); };
    put(new THREE.BoxGeometry(len, h, T), wallMats[ci % wallMats.length], h / 2);
    put(new THREE.BoxGeometry(len, 0.4, T + 0.25), capMats[ci % capMats.length], h + 0.2);
    put(new THREE.BoxGeometry(len, 0.5, T + 0.08), ci % 2 ? redBand : bandMat, 0.45, false); // red / white curb at the foot of the wall
    put(new THREE.BoxGeometry(len, 0.3, T + 0.08), bandMat, h * 0.55, false);
  }

  /** static geometry is merged per material so the whole arena costs a handful of draw calls */
  _batch(geo, mat, x, y, z, cast = true) {
    geo.translate(x, y, z);
    if (!this._batches) this._batches = new Map();
    let b = this._batches.get(mat);
    if (!b) { b = { geos: [], cast }; this._batches.set(mat, b); }
    b.geos.push(geo);
  }

  _flushBatches() {
    for (const [mat, b] of this._batches) {
      const m = new THREE.Mesh(mergeGeometries(b.geos), mat);
      m.castShadow = b.cast; m.receiveShadow = true;
      this.group.add(m);
      b.geos.forEach((g) => g.dispose());
    }
    this._batches.clear();
  }

  /* ------------------------------------------------------------ queries */
  insideBounds(x, z, pad = 0) {
    const b = this.bounds;
    if (b.type === 'rect') return Math.abs(x) <= b.hw - pad && Math.abs(z) <= b.hd - pad;
    if (b.type === 'poly') {
      if (Math.abs(x) > b.hw - pad || Math.abs(z) > b.hd - pad) return false;
      const q = this._polyQuery(x, z, pad > 0 ? pad : 0);
      return q.inside && q.d >= pad;
    }
    return x * x + z * z <= (b.r - pad) ** 2;
  }

  /** inside-test plus nearest wall point for the polygon outline; stops early once something nearer than `near` is found */
  _polyQuery(x, z) {
    const P = this.bounds.pts;
    let inside = false, best = Infinity, bx = 0, bz = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [ax, az] = P[j], [cx, cz] = P[i];
      if ((az > z) !== (cz > z) && x < ((cx - ax) * (z - az)) / (cz - az) + ax) inside = !inside;
      const ex = cx - ax, ez = cz - az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1) : 0;
      const px = ax + ex * t, pz = az + ez * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) { best = d2; bx = px; bz = pz; }
    }
    return { inside, d: Math.sqrt(best), px: bx, pz: bz };
  }

  /** point/circle overlaps any obstacle or leaves the arena */
  blockedPoint(x, z, r = 0) {
    if (!this.insideBounds(x, z, r)) return true;
    for (const bx of this.boxes) {
      const cx = clamp(x, bx.x - bx.hw, bx.x + bx.hw), cz = clamp(z, bx.z - bx.hd, bx.z + bx.hd);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r || (cx === x && cz === z)) return true;
    }
    for (const p of this.pillars) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + r) ** 2) return true;
    return false;
  }

  segmentBlocked(ax, az, bx, bz, pad = 0) {
    if (!this.insideBounds(ax, az, pad) || !this.insideBounds(bx, bz, pad)) return true;
    const dx = bx - ax, dz = bz - az;
    for (const bo of this.boxes) {
      let t0 = 0, t1 = 1, hit = true;
      const mins = [bo.x - bo.hw - pad, bo.z - bo.hd - pad], maxs = [bo.x + bo.hw + pad, bo.z + bo.hd + pad];
      const as = [ax, az], ds = [dx, dz];
      for (let k = 0; k < 2; k++) {
        if (Math.abs(ds[k]) < 1e-9) { if (as[k] < mins[k] || as[k] > maxs[k]) { hit = false; break; } }
        else {
          let ta = (mins[k] - as[k]) / ds[k], tb = (maxs[k] - as[k]) / ds[k];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit) return true;
    }
    for (const p of this.pillars) {
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((p.x - ax) * dx + (p.z - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t - p.x, cz = az + dz * t - p.z;
      if (cx * cx + cz * cz < (p.r + pad) ** 2) return true;
    }
    return false;
  }

  inSlime(x, z) {
    for (const s of this.slime) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
    return false;
  }

  onBoost(x, z) {
    for (const p of this.boosts) if ((x - p.x) ** 2 + (z - p.z) ** 2 < 3.4 * 3.4) return true;
    return false;
  }

  /** Resolve a kart against walls. Returns the strongest impact speed. */
  collideKart(k) {
    let impact = 0;
    const push = (nx, nz, pen) => {
      k.x += nx * pen; k.z += nz * pen;
      const vn = k.vx * nx + k.vz * nz;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        k.vx -= (1 + 0.3) * vn * nx; k.vz -= (1 + 0.3) * vn * nz;
        // scrape friction along the wall
        const tx = -nz, tz = nx, vt = k.vx * tx + k.vz * tz;
        k.vx -= vt * 0.06 * tx; k.vz -= vt * 0.06 * tz;
      }
    };
    const b = this.bounds, R = KART_R;
    if (b.type === 'rect') {
      if (k.x > b.hw - R) push(-1, 0, k.x - (b.hw - R));
      if (k.x < -b.hw + R) push(1, 0, -b.hw + R - k.x);
      if (k.z > b.hd - R) push(0, -1, k.z - (b.hd - R));
      if (k.z < -b.hd + R) push(0, 1, -b.hd + R - k.z);
    } else if (b.type === 'poly') {
      const q = this._polyQuery(k.x, k.z);
      if (!q.inside) {
        const dx = q.px - k.x, dz = q.pz - k.z, d = Math.hypot(dx, dz) || 1;
        push(dx / d, dz / d, d + R);
      } else if (q.d < R) {
        const dx = k.x - q.px, dz = k.z - q.pz, d = Math.hypot(dx, dz) || 1;
        push(dx / d, dz / d, R - q.d);
      }
    } else {
      const d = Math.hypot(k.x, k.z);
      if (d > b.r - R) push(-k.x / d, -k.z / d, d - (b.r - R));
    }
    for (const bo of this.boxes) {
      const cx = clamp(k.x, bo.x - bo.hw, bo.x + bo.hw), cz = clamp(k.z, bo.z - bo.hd, bo.z + bo.hd);
      let dx = k.x - cx, dz = k.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        push(dx / d, dz / d, R - d);
      } else { // centre inside the box: shove out along the shallowest axis
        const px = bo.hw - Math.abs(k.x - bo.x), pz = bo.hd - Math.abs(k.z - bo.z);
        if (px < pz) push(Math.sign(k.x - bo.x) || 1, 0, px + R); else push(0, Math.sign(k.z - bo.z) || 1, pz + R);
      }
    }
    for (const p of this.pillars) {
      const dx = k.x - p.x, dz = k.z - p.z, d = Math.hypot(dx, dz), min = p.r + R;
      if (d < min) {
        if (d > 1e-6) push(dx / d, dz / d, min - d); else push(1, 0, min);
      }
    }
    return impact;
  }

  /* ------------------------------------------------------------ nav graph for bots */
  _buildNav() {
    const step = 6;
    const b = this.bounds;
    const ex = b.type === 'circle' ? b.r : b.hw, ez = b.type === 'circle' ? b.r : b.hd;
    const nodes = [];
    const grid = new Map();
    const x0 = -Math.floor(ex / step) * step, z0 = -Math.floor(ez / step) * step;
    for (let x = x0; x <= ex; x += step) {
      for (let z = z0; z <= ez; z += step) {
        if (this.blockedPoint(x, z, 2.6)) continue;
        const n = { x, z, i: nodes.length, nb: [] };
        nodes.push(n);
        grid.set(Math.round((x - x0) / step) + ',' + Math.round((z - z0) / step), n);
      }
    }
    for (const n of nodes) {
      const ix = Math.round((n.x - x0) / step), iz = Math.round((n.z - z0) / step);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const m = grid.get(ix + dx + ',' + (iz + dz));
        if (m && !this.segmentBlocked(n.x, n.z, m.x, m.z, 1.5)) n.nb.push(m);
      }
    }
    this.nav = nodes;
  }

  _nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nav) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd && d < 30 * 30 && !this.segmentBlocked(x, z, n.x, n.z, 1.1)) { bd = d; best = n; }
    }
    if (!best) for (const n of this.nav) { // fallback: nearest regardless of LOS
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** A* over the nav grid; returns [{x,z}...] ending at the goal */
  findPath(ax, az, bx, bz) {
    if (!this.segmentBlocked(ax, az, bx, bz, 1.4)) return [{ x: bx, z: bz }];
    const s = this._nearestNode(ax, az), e = this._nearestNode(bx, bz);
    if (!s || !e) return [{ x: bx, z: bz }];
    const g = new Map([[s.i, 0]]);
    const came = new Map();
    const open = [s];
    const f = new Map([[s.i, Math.hypot(s.x - e.x, s.z - e.z)]]);
    const closed = new Set();
    let guard = 0;
    while (open.length && guard++ < 1500) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f.get(open[i].i) < f.get(open[bi].i)) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === e) {
        const path = [{ x: bx, z: bz }];
        let c = cur;
        while (c) { path.push({ x: c.x, z: c.z }); c = came.get(c.i); }
        path.reverse();
        return path.slice(1);
      }
      closed.add(cur.i);
      for (const nb of cur.nb) {
        if (closed.has(nb.i)) continue;
        const ng = g.get(cur.i) + Math.hypot(cur.x - nb.x, cur.z - nb.z);
        if (ng < (g.get(nb.i) ?? Infinity)) {
          g.set(nb.i, ng); came.set(nb.i, cur);
          f.set(nb.i, ng + Math.hypot(nb.x - e.x, nb.z - e.z));
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    return [{ x: bx, z: bz }];
  }

  randomPoint() {
    const n = this.nav[Math.floor(Math.random() * this.nav.length)];
    return { x: n.x, z: n.z };
  }

  /* ------------------------------------------------------------ per-frame */
  update(dt, fx) {
    this.t += dt;
    const t = this.t;
    this.boostTex.offset.y -= dt * 1.4;
    for (const ib of this.itemBoxes) {
      if (!ib.active) {
        ib.timer -= dt;
        if (ib.timer <= 0) { ib.active = true; ib.pop = 0.4; ib.holder.visible = true; }
        continue;
      }
      ib.cube.rotation.y += dt * 1.8;
      ib.cube.rotation.x = Math.sin(t * 2 + ib.idx) * 0.25;
      ib.cube.position.y = Math.sin(t * 2.4 + ib.idx) * 0.18;
      const hue = (t * 0.25 + ib.idx * 0.13) % 1;
      ib.mat.color.setHSL(hue, 0.85, 0.7);
      ib.mat.emissive.setHSL(hue, 0.9, 0.4);
      ib.beam.material.color.setHSL(hue, 0.9, 0.6);
      ib.disc.material.color.setHSL(hue, 0.9, 0.6);
      if (ib.pop > 0) { ib.pop -= dt; const s = 1 + Math.sin(clamp(ib.pop / 0.4, 0, 1) * Math.PI) * 0.6; ib.holder.scale.setScalar(s); }
      else ib.holder.scale.setScalar(1);
    }
    for (const s of this.slime) {
      if (Math.random() < dt * 5) {
        const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * s.r;
        fx.add.emit(s.x + Math.cos(a) * r, 0.2, s.z + Math.sin(a) * r, 0, rand(1.5, 3), 0, rand(0.5, 0.9), 0.5, 1.1, 0.3, 0.9, 0.15, 0.6, 1, 0.4, 0.8, 0, 0);
      }
    }
    for (const p of this.props) {
      p.position.y = p.userData.y0 + Math.sin(t * 0.8 + p.userData.ph) * 1.6;
    }
  }

  takeBox(ib) {
    ib.active = false; ib.timer = ITEM_RESPAWN; ib.holder.visible = false;
  }

  dispose() {
    this.scene.remove(this.group, this.sky, this.hemi, this.sun, this.sun.target);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); }
    });
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.scene.fog = null;
  }
}
