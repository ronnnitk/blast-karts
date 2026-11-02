import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture, textTexture } from './fx.js';

export const HEADS = ['Sigma', 'Rizzler', 'Skibidi', 'Cone Head'];

const shared = {
  frame: new THREE.MeshStandardMaterial({ color: 0x4a4f5c, roughness: 0.65, metalness: 0.2 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xaab2c0, roughness: 0.35, metalness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.8, roughness: 0.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.7 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff3a30, roughness: 0.45 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x2f80ff, roughness: 0.35, metalness: 0.3 }),
  black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x20222b, roughness: 0.9 }),
  light: new THREE.MeshBasicMaterial({ color: 0xfff2a0 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
};
const wheelGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.5, 20);
wheelGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.56, 14);
rimGeo.rotateZ(Math.PI / 2);
const capGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8);
capGeo.rotateZ(Math.PI / 2);

export function createKartModel(colorHex, head = 0) {
  const color = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.6), roughness: 0.5 });

  const root = new THREE.Group();  // placed in the world, yawed with heading
  const body = new THREE.Group();  // leans / slides relative to root
  root.add(body);

  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true;
    parent.add(m);
    return m;
  };

  // static chassis parts are merged per material (a few draw calls per kart instead of ~30)
  const batches = new Map();
  const stat = (geo, mat, x, y, z, rotX = 0) => {
    if (rotX) geo.rotateX(rotX);
    geo.translate(x, y, z);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geo);
  };
  const ellipsoid = (rx, ry, rz) => { const g = new THREE.SphereGeometry(1, 18, 12); g.scale(rx, ry, rz); return g; };

  // open dark frame
  stat(new THREE.BoxGeometry(1.7, 0.32, 3.5), shared.frame, 0, 0.55, 0);
  stat(new THREE.BoxGeometry(2.3, 0.22, 0.7), shared.frame, 0, 0.5, 1.05);             // front axle plate
  stat(new THREE.BoxGeometry(2.3, 0.22, 0.7), shared.frame, 0, 0.5, -1.2);             // rear axle plate
  // coloured nose cowl + side pods
  stat(ellipsoid(0.85, 0.5, 1.35), bodyMat, 0, 0.95, 1.05);
  stat(new THREE.BoxGeometry(0.5, 0.5, 1.9), bodyMat, -1.0, 0.85, 0.15);
  stat(new THREE.BoxGeometry(0.5, 0.5, 1.9), bodyMat, 1.0, 0.85, 0.15);
  stat(new THREE.BoxGeometry(0.54, 0.1, 1.94), shared.white, -1.0, 1.04, 0.15);        // racing stripes on the pods
  stat(new THREE.BoxGeometry(0.54, 0.1, 1.94), shared.white, 1.0, 1.04, 0.15);
  stat(new THREE.BoxGeometry(0.3, 0.1, 1.2), shared.white, 0, 1.4, 1.1);               // stripe on the nose
  // seat
  stat(new THREE.BoxGeometry(1.25, 0.28, 1.1), trimMat, 0, 0.85, -0.55);
  stat(new THREE.BoxGeometry(1.25, 1.0, 0.3), trimMat, 0, 1.4, -0.95);
  // rear engine block with pistons and twin exhausts
  stat(new THREE.BoxGeometry(1.5, 0.75, 0.9), shared.frame, 0, 1.0, -1.45);
  for (const sx of [-0.38, 0.38]) stat(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10), shared.steel, sx, 1.55, -1.45);
  // red/white striped front bumper
  for (let i = 0; i < 5; i++) stat(new THREE.BoxGeometry(0.5, 0.3, 0.42), i % 2 ? shared.white : shared.red, -1.0 + i * 0.5, 0.6, 2.0);
  // silver front tubes, like the reference karts
  for (const sx of [-0.85, 0.85]) {
    stat(new THREE.CylinderGeometry(0.14, 0.14, 1.3, 10), shared.steel, sx, 0.62, 1.55, Math.PI / 2);
    stat(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 10), shared.rim, sx, 0.62, 2.2, Math.PI / 2);
  }
  // headlights
  for (const sx of [-0.55, 0.55]) stat(new THREE.SphereGeometry(0.17, 8, 8), shared.light, sx, 1.0, 2.0);
  // rear wing
  stat(new THREE.BoxGeometry(2.2, 0.1, 0.55), bodyMat, 0, 2.05, -1.85);
  stat(new THREE.BoxGeometry(0.12, 0.8, 0.12), shared.dark, -0.7, 1.65, -1.75);
  stat(new THREE.BoxGeometry(0.12, 0.8, 0.12), shared.dark, 0.7, 1.65, -1.75);
  // exhausts + flames
  const flames = [];
  for (const sx of [-0.55, 0.55]) {
    stat(new THREE.CylinderGeometry(0.15, 0.19, 0.7, 10), shared.chrome, sx, 0.85, -1.95, Math.PI / 2);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 10), shared.flame.clone());
    fl.rotation.x = -Math.PI / 2; fl.position.set(sx, 0.85, -2.65);
    fl.visible = false;
    body.add(fl);
    flames.push(fl);
  }
  for (const [mat, geos] of batches) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true;
    body.add(m);
    geos.forEach((g) => g.dispose());
  }

  // wheels: dark tyres with bright blue rims
  const wheels = [];
  for (const [x, z] of [[-1.2, 1.2], [1.2, 1.2], [-1.2, -1.2], [1.2, -1.2]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.56, z);
    const w = new THREE.Mesh(wheelGeo, shared.tire); w.castShadow = true;
    w.add(new THREE.Mesh(rimGeo, shared.rim), new THREE.Mesh(capGeo, shared.chrome));
    pivot.add(w);
    body.add(pivot);
    wheels.push({ pivot, w, front: z > 0 });
  }

  // driver: big cute head, torso, hands on a little steering wheel
  const driver = new THREE.Group();
  driver.position.set(0, 1.55, -0.35);
  body.add(driver);
  const torso = add(new THREE.BoxGeometry(0.97, 0.7, 0.6), shared.white, 0, 0, 0, driver);
  torso.material = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.6 });
  const wheelRing = add(new THREE.TorusGeometry(0.3, 0.06, 8, 16), shared.dark, 0, -0.1, 0.62, driver);
  wheelRing.rotation.x = -0.9;
  const skinCol = [0xffd0a0, 0xe8b88a, 0xc8f08c, 0xffc8d8][head % 4];
  const skin = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.6 });
  for (const sx of [-0.5, 0.5]) {
    const arm = add(new THREE.BoxGeometry(0.2, 0.2, 0.6), torso.material, sx, -0.05, 0.4, driver);
    arm.rotation.x = 0.2;
    add(new THREE.SphereGeometry(0.12, 8, 8), skin, sx * 0.62, -0.12, 0.7, driver);
  }
  const headG = new THREE.Group();
  headG.position.set(0, 0.95, 0.05);
  headG.scale.setScalar(1.18);
  driver.add(headG);
  add(new THREE.SphereGeometry(0.62, 20, 16), skin, 0, 0, 0, headG);
  const eyeGeo = new THREE.SphereGeometry(0.24, 12, 10), pupilGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const eyes = [];
  for (const sx of [-0.25, 0.25]) {
    const e = add(eyeGeo, shared.white, sx, 0.1, 0.5, headG);
    e.castShadow = false;
    const p = add(pupilGeo, shared.black, 0, 0, 0.2, e);
    p.castShadow = false;
    eyes.push(e);
  }
  const mouth = add(new THREE.BoxGeometry(0.34, 0.12, 0.1), shared.black, 0, -0.25, 0.58, headG);
  mouth.castShadow = false;

  const hatMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  switch (head % 4) {
    case 0: { // Sigma: shades + slicked hair + round ears
      add(new THREE.BoxGeometry(0.95, 0.2, 0.15), shared.black, 0, 0.14, 0.6, headG);
      add(new THREE.SphereGeometry(0.66, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hatMat(0x2a1a10), 0, 0.12, -0.05, headG);
      for (const sx of [-0.58, 0.58]) add(new THREE.SphereGeometry(0.2, 10, 8), skin, sx, 0.15, -0.05, headG);
      break;
    }
    case 1: { // Rizzler: swoopy quiff + gold chain
      const q = add(new THREE.BoxGeometry(0.9, 0.35, 0.8), hatMat(0xc8791a), 0, 0.62, 0.05, headG);
      q.rotation.x = -0.35;
      add(new THREE.SphereGeometry(0.64, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), hatMat(0xc8791a), 0, 0.1, -0.05, headG);
      for (const sx of [-0.58, 0.58]) add(new THREE.SphereGeometry(0.2, 10, 8), skin, sx, 0.0, -0.05, headG);
      const chain = add(new THREE.TorusGeometry(0.42, 0.06, 6, 16), new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.9, roughness: 0.2 }), 0, 0.5, 0.05, driver);
      chain.rotation.x = Math.PI / 2;
      break;
    }
    case 2: { // Skibidi: toilet bowl on the head
      add(new THREE.CylinderGeometry(0.62, 0.45, 0.45, 16), shared.white, 0, 0.68, 0, headG);
      add(new THREE.TorusGeometry(0.6, 0.1, 8, 20), shared.white, 0, 0.9, 0, headG).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.7, 0.55, 0.25), shared.white, 0, 0.95, -0.62, headG);
      break;
    }
    case 3: { // Cone Head: traffic cone + third eye
      add(new THREE.ConeGeometry(0.55, 1.1, 14), hatMat(0xff6a1a), 0, 0.95, 0, headG);
      add(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 14), shared.white, 0, 0.78, 0, headG);
      const e3 = add(eyeGeo, shared.white, 0, 0.42, 0.52, headG); e3.scale.setScalar(0.7);
      add(pupilGeo, shared.black, 0, 0, 0.2, e3).castShadow = false;
      break;
    }
  }

  // invincible bubble: bright translucent sphere with a rim shell
  const shield = new THREE.Group();
  shield.visible = false;
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(2.9, 28, 18), new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.3, depthWrite: false }));
  shield.add(bubble);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(2.92, 14, 10), new THREE.MeshBasicMaterial({ color: 0x1d6fe0, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }));
  shield.add(shell);
  shield.position.y = 1.3;
  root.add(shield);

  // frozen ice block
  const ice = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.5, 4), new THREE.MeshPhysicalMaterial({ color: 0xa8e6ff, transparent: true, opacity: 0.55, roughness: 0.1, emissive: 0x2a90c0, emissiveIntensity: 0.4 }));
  ice.position.y = 1.2; ice.visible = false;
  root.add(ice);

  // label (name + health) lives outside the yawed root so it stays upright
  const label = new THREE.Group();
  label.position.y = 3.9;
  const hpBack = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1b3a7a, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
  hpBack.scale.set(3.2, 0.34, 1);
  const hpFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4dff7a, transparent: true, depthTest: false, fog: false }));
  hpFill.center.set(0, 0.5);
  hpFill.position.x = -1.5;
  hpFill.scale.set(3, 0.22, 1);
  hpBack.renderOrder = 10; hpFill.renderOrder = 11;
  label.add(hpBack, hpFill);

  // glow under the kart for visibility
  const under = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  under.scale.set(6, 6, 1); under.position.y = 0.3;
  root.add(under);

  return { root, body, wheels, flames, driver, headG, eyes, shield, shieldBubble: bubble, ice, label, hpFill, hpBack, bodyMat, under, color, setName: (n) => makeNameSprite(label, n, colorHex) };
}

function makeNameSprite(label, name, colorHex) {
  const { tex, aspect } = textTexture(name, { color: '#fff', stroke: '#1b3a7a', size: 54 });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sp.renderOrder = 12;
  sp.scale.set(1.15 * aspect, 1.15, 1);
  sp.position.y = 0.85;
  label.add(sp);
}
