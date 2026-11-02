import * as THREE from 'three';
import { createKartModel } from './kartmodel.js';

/** small standalone 3D viewer that shows the player's kart on the main menu */
export class KartPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 4.8, 11.5);
    this.camera.lookAt(0, 1.2, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9bbcff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    // round pedestal like the reference menu
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.1, 0.4, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    pad.position.y = -0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffb21a }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.04;
    this.scene.add(pad, ring);
    this.model = null;
    this.t = 0;
    this.raf = 0;
  }

  setKart(color, head) {
    if (this.model) this.scene.remove(this.model.root);
    this.model = createKartModel(color, head);
    this.model.root.rotation.y = 0.6;
    this.scene.add(this.model.root);
    this.model.under.visible = false;
  }

  resize() {
    const w = this.canvas.clientWidth || 320, h = this.canvas.clientHeight || 260;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.canvas.offsetParent) return; // main screen hidden
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.t += dt;
      this.resize();
      if (this.model) {
        const m = this.model;
        m.root.rotation.y += dt * 0.6;
        m.body.position.y = Math.sin(this.t * 2.2) * 0.05;
        m.wheels.forEach((w) => (w.w.rotation.x += dt * 2));
        m.headG.rotation.y = Math.sin(this.t * 1.3) * 0.25;
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }
}
