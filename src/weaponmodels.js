import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

/** Tralalero-style shark in sneakers (faces +z) */
export function sharkMissile() {
  const g = new THREE.Group();
  const blue = std(0x3b8cff, { metalness: 0.1 }), belly = std(0xe8f4ff);
  const body = mesh(new THREE.SphereGeometry(0.75, 16, 12), blue, 0, 0, 0, g);
  body.scale.set(0.9, 0.85, 2.5);
  const bel = mesh(new THREE.SphereGeometry(0.7, 14, 10), belly, 0, -0.18, 0.1, g);
  bel.scale.set(0.82, 0.55, 2.3);
  const fin = mesh(new THREE.ConeGeometry(0.35, 0.9, 4), blue, 0, 0.8, -0.2, g);
  fin.rotation.x = -0.35;
  const tail = mesh(new THREE.ConeGeometry(0.45, 1.1, 4), blue, 0, 0.1, -2.0, g);
  tail.rotation.x = -Math.PI / 2; tail.scale.set(1, 1, 0.3);
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.2, 8, 8), basic(0xffffff), s * 0.42, 0.28, 1.15, g);
    eye.castShadow = false;
    mesh(new THREE.SphereGeometry(0.09, 6, 6), basic(0x000000), s * 0.02, 0, 0.17, eye).castShadow = false;
    const side = mesh(new THREE.ConeGeometry(0.22, 0.7, 4), blue, s * 0.75, -0.2, 0.2, g);
    side.rotation.z = -s * 1.2;
    // sneakers
    const shoe = mesh(new THREE.BoxGeometry(0.35, 0.28, 0.8), basic(0xffffff), s * 0.32, -0.85, 0.35, g);
    mesh(new THREE.BoxGeometry(0.37, 0.1, 0.82), basic(0xff2a2a), 0, -0.1, 0, shoe);
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6), std(0xffd7a0), 0, 0.3, -0.15, shoe);
  }
  // teeth
  const teeth = mesh(new THREE.BoxGeometry(0.7, 0.1, 0.1), basic(0xffffff), 0, -0.22, 1.7, g);
  teeth.castShadow = false;
  return g;
}

/** Skibidi toilet mine */
export function toiletMine() {
  const g = new THREE.Group();
  const w = std(0xf4f4f8, { roughness: 0.3 });
  mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.8, 14), w, 0, 0.4, 0, g);
  const rim = mesh(new THREE.TorusGeometry(0.55, 0.12, 8, 18), w, 0, 0.82, 0, g);
  rim.rotation.x = Math.PI / 2;
  mesh(new THREE.CircleGeometry(0.48, 14), std(0x4fc8ff), 0, 0.8, 0, g).rotation.x = -Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.9, 0.9, 0.3), w, 0, 1.0, -0.62, g);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  light.position.set(0, 1.55, -0.62);
  g.add(light);
  g.userData.light = light;
  g.scale.setScalar(1.15);
  return g;
}

export function bananaPeel() {
  const g = new THREE.Group();
  const yellow = std(0xffe03a, { roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const peel = mesh(new THREE.TorusGeometry(0.7, 0.2, 8, 12, Math.PI * 0.9), yellow, 0, 0.25, 0, g);
    peel.rotation.set(-Math.PI / 2 + 0.6, 0, (i / 3) * Math.PI * 2);
    peel.scale.set(1, 1, 0.8);
  }
  mesh(new THREE.SphereGeometry(0.22, 8, 8), std(0x5a3a10), 0, 0.3, 0, g);
  return g;
}

/** Chain spike ball (spiky icosahedron) */
export function spikeBall() {
  const g = new THREE.Group();
  const steel = std(0x555a66, { metalness: 0.8, roughness: 0.3 });
  const ico = new THREE.IcosahedronGeometry(1.0, 1);
  mesh(ico, steel, 0, 0, 0, g);
  const base = new THREE.IcosahedronGeometry(1.0, 0);
  const pos = base.attributes.position;
  const seen = new Set();
  const coneGeo = new THREE.ConeGeometry(0.28, 0.9, 6);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = v.toArray().map((n) => n.toFixed(2)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const dir = v.clone().normalize();
    const c = mesh(coneGeo, std(0xdde3ee, { metalness: 0.9, roughness: 0.2 }), dir.x * 1.15, dir.y * 1.15, dir.z * 1.15, g);
    c.quaternion.setFromUnitVectors(up, dir);
  }
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), basic(0xff3a3a)));
  return g;
}

export function chainLink() {
  return new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 6, 10), std(0x9aa3b5, { metalness: 0.9, roughness: 0.3 }));
}

/** Bombardiro Crocodilo: a bomber plane with a crocodile front (faces +z) */
export function crocBomber() {
  const g = new THREE.Group();
  const green = std(0x3f9a3a), dark = std(0x24601f), belly = std(0xd8e8a0), grey = std(0x666c5e);
  const fus = mesh(new THREE.SphereGeometry(1, 16, 12), green, 0, 0, 0, g);
  fus.scale.set(1.2, 1.15, 3.6);
  mesh(new THREE.SphereGeometry(1, 12, 10), belly, 0, -0.3, 0.2, g).scale.set(1.05, 0.7, 3.2);
  // croc snout
  const snout = mesh(new THREE.BoxGeometry(1.5, 0.7, 3.0), green, 0, -0.1, 4.0, g);
  mesh(new THREE.BoxGeometry(1.4, 0.35, 2.9), belly, 0, -0.4, 0, snout);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.1, 0.34, 4), basic(0xffffff), s * 0.65, -0.3, 2.7 + i * 0.45, g).rotation.x = Math.PI;
  for (const s of [-1, 1]) { // bulging croc eyes
    const eye = mesh(new THREE.SphereGeometry(0.42, 10, 8), basic(0xfff09a), s * 0.7, 0.85, 2.3, g);
    eye.castShadow = false;
    mesh(new THREE.SphereGeometry(0.2, 8, 8), basic(0x000000), 0, 0, 0.3, eye).castShadow = false;
  }
  // pilot helmet
  mesh(new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x4a5a3a), 0, 1.0, 0.3, g);
  // wings
  mesh(new THREE.BoxGeometry(11, 0.25, 2.4), grey, 0, -0.1, -0.2, g);
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 10), dark, s * 3.2, -0.3, 0.8, g).rotation.x = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), basic(0xff2020), s * 5.6, 0, -0.2, g);
  }
  // tail
  mesh(new THREE.BoxGeometry(4.2, 0.2, 1.4), grey, 0, 0.2, -3.6, g);
  mesh(new THREE.BoxGeometry(0.2, 1.8, 1.4), dark, 0, 1.0, -3.6, g);
  // roundel
  for (const s of [-1, 1]) mesh(new THREE.CircleGeometry(0.55, 14), basic(0xff3030), s * 4, 0.16, -0.2, g).rotation.x = -Math.PI / 2;
  g.scale.setScalar(1.9);
  return g;
}

export function bombMesh() {
  const g = new THREE.Group();
  const b = mesh(new THREE.SphereGeometry(0.8, 12, 10), std(0x2a2f2a, { metalness: 0.5 }), 0, 0, 0, g);
  b.scale.set(1, 1, 1.9);
  mesh(new THREE.BoxGeometry(1.3, 0.1, 0.5), std(0x888), 0, 0, -1.4, g);
  mesh(new THREE.BoxGeometry(0.1, 1.3, 0.5), std(0x888), 0, 0, -1.4, g);
  mesh(new THREE.BoxGeometry(0.5, 0.18, 0.18), basic(0xff3a3a), 0, 0.62, 0.3, g);
  return g;
}

export function targetMarker() {
  const g = new THREE.Group();
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 40), red);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
  const inner = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 32), red);
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.25;
  const bars = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), red);
    b.rotation.x = -Math.PI / 2; b.rotation.z = (i * Math.PI) / 2; b.position.y = 0.26;
    b.position.x = Math.sin((i * Math.PI) / 2) * -5.6; b.position.z = Math.cos((i * Math.PI) / 2) * -5.6;
    bars.add(b);
  }
  const fill = new THREE.Mesh(new THREE.CircleGeometry(8, 40), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.18, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.2;
  g.add(ring, inner, bars, fill);
  g.userData = { red, bars, fill };
  return g;
}
