const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.enabled = false;
    this.mouseFire = false;
    this.firePressed = false;
    this.onPause = null;
    this.onTab = null;
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (this.enabled && BLOCKED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (['Space', 'KeyE', 'KeyK'].includes(e.code)) this.firePressed = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      if (e.code === 'Tab') this.onTab?.(true);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onTab?.(false);
    });
    addEventListener('blur', () => { this.keys.clear(); this.mouseFire = false; this.onTab?.(false); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.mouseFire = true; this.firePressed = true;
    });
    addEventListener('mouseup', () => { this.mouseFire = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** consume the "just pressed use item" edge */
  takeFire() { const f = this.firePressed; this.firePressed = false; return f; }

  get() {
    if (!this.enabled) return { steer: 0, throttle: 0, drift: false, fire: false };
    const k = this.keys;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let throttle = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let drift = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyV');
    let fire = k.has('Space') || k.has('KeyE') || k.has('KeyK') || this.mouseFire;
    const p = this.pad();
    if (p) {
      const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0;
      if (ax) steer = ax;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (rt || lt || p.buttons[0]?.pressed) throttle = Math.max(rt, p.buttons[0]?.pressed ? 1 : 0) - lt;
      if (p.buttons[1]?.pressed || p.buttons[4]?.pressed) drift = true;
      const pf = p.buttons[2]?.pressed || p.buttons[5]?.pressed;
      if (pf && !this._padFire) this.firePressed = true;
      this._padFire = !!pf;
      fire = fire || !!pf;
    }
    return { steer, throttle, drift, fire };
  }

  reset() { this.keys.clear(); this.mouseFire = false; this.firePressed = false; }
}
