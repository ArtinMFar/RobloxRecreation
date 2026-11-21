// Gathers keyboard, mouse and touch input into the same shape the default
// PlayerModule uses: a move vector (x = right, z = back) plus camera rotation
// and zoom deltas (CameraInput.getRotation / getZoomDelta).
import { CAMERA } from './config.js';

const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
};
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyI', 'KeyO', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor(layer) {
    this.layer = layer; // element that receives game pointer input
    this.mode = 'keyboard'; // 'keyboard' | 'touch'
    this.sensitivity = 1;
    this.thumbstick = null;
    this.jumpButtonHeld = false;
    this.jumpLatch = false; // a press is seen even if released before the next frame
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.touch = { dx: 0, dy: 0 };
    this.wheel = 0;
    this.pinch = 0;
    this.rmbId = null; // pointer id of a right-button drag
    this.cameraTouches = new Map(); // pointerId -> {x, y}
    this.lastPinch = null;
    this.locked = false;
    this.wantLock = false;
    this.onShiftLock = () => {};
    this.onLockLost = () => {};
    this.onActivity = () => {};

    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());

    layer.addEventListener('pointerdown', (e) => this.pointerDown(e));
    layer.addEventListener('pointermove', (e) => this.pointerMove(e));
    layer.addEventListener('pointerup', (e) => this.pointerUp(e));
    layer.addEventListener('pointercancel', (e) => this.pointerUp(e));
    layer.addEventListener('lostpointercapture', (e) => this.pointerUp(e));
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === layer;
      if (was && !this.locked && this.wantLock) this.onLockLost();
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
    });
  }

  releaseAll() {
    this.keys.clear();
    this.rmbId = null;
    this.layer.classList.remove('rotating');
    this.cameraTouches.clear();
    this.lastPinch = null;
  }

  keyDown(e) {
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.jumpLatch = true;
    this.onActivity();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.onShiftLock();
      this.syncPointerLock(); // still inside the key gesture, so the lock request is allowed
    }
  }

  // ----- pointer lock (shift lock / first person) -----

  setWantLock(want) {
    this.wantLock = want;
    if (!want && this.locked) document.exitPointerLock();
  }

  syncPointerLock() {
    if (this.wantLock && !this.locked && this.layer.requestPointerLock) {
      try {
        const p = this.layer.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {
        /* needs a user gesture; retried on the next click */
      }
    } else if (!this.wantLock && this.locked) {
      document.exitPointerLock();
    }
  }

  // ----- pointers -----

  pointerDown(e) {
    this.onActivity();
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button === 2) {
      this.rmbId = e.pointerId;
      this.layer.setPointerCapture(e.pointerId);
      this.layer.classList.add('rotating');
      return;
    }
    if (isMouse && e.button !== 0) return;
    if (isMouse && this.wantLock && !this.locked) {
      this.syncPointerLock();
      return;
    }
    if (isMouse && this.mode !== 'touch') return; // left click does nothing in keyboard mode

    // Touch (or mouse emulating touch in touch mode).
    if (this.mode === 'touch' && this.thumbstick && this.thumbstick.tryBegin(e.pointerId, e.clientX, e.clientY)) {
      this.layer.setPointerCapture(e.pointerId);
      return;
    }
    this.cameraTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.layer.setPointerCapture(e.pointerId);
    this.lastPinch = null;
  }

  pointerMove(e) {
    if (this.thumbstick && this.thumbstick.owns(e.pointerId)) {
      this.thumbstick.move(e.clientX, e.clientY);
      return;
    }
    const t = this.cameraTouches.get(e.pointerId);
    if (t) {
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.cameraTouches.size === 1) {
        this.touch.dx += dx;
        this.touch.dy += dy;
      } else if (this.cameraTouches.size === 2) {
        const [a, b] = [...this.cameraTouches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.lastPinch !== null) this.pinch += d - this.lastPinch;
        this.lastPinch = d;
      }
      return;
    }
    if (e.pointerType === 'mouse' && (this.locked || this.rmbId !== null)) {
      // Ignore the occasional huge spike some browsers report around lock changes.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    }
  }

  pointerUp(e) {
    if (this.thumbstick && this.thumbstick.owns(e.pointerId)) {
      this.thumbstick.end();
    } else if (this.cameraTouches.delete(e.pointerId)) {
      this.lastPinch = null;
    } else if (e.pointerId === this.rmbId) {
      this.rmbId = null;
      this.layer.classList.remove('rotating');
    }
  }

  onWheel(e) {
    e.preventDefault();
    this.onActivity();
    let notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100;
    notches = Math.max(-1, Math.min(1, notches));
    this.wheel += notches;
  }

  // ----- per-frame queries -----

  key(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Raw move vector in camera space: x = right, z = back (W gives z = -1). */
  getMoveVector() {
    const ts = this.thumbstick;
    if (ts && ts.active && (ts.moveVector.x || ts.moveVector.z)) return ts.moveVector;
    const x = (this.key(MOVE_KEYS.right) ? 1 : 0) - (this.key(MOVE_KEYS.left) ? 1 : 0);
    const z = (this.key(MOVE_KEYS.back) ? 1 : 0) - (this.key(MOVE_KEYS.forward) ? 1 : 0);
    return { x, z };
  }

  get jumpHeld() {
    return this.keys.has('Space') || this.jumpButtonHeld || this.jumpLatch;
  }

  /** CameraInput.getRotation(): radians, x = yaw right, y = pitch down. */
  consumeRotation(pitch, dt) {
    const s = this.sensitivity;
    const keys = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);

    let tdy = this.touch.dy;
    if (tdy * pitch < 0) {
      // Touch pitch is damped when swiping away from the horizon.
      const curve = 1 - Math.pow((2 * Math.abs(pitch)) / Math.PI, 0.75);
      const f = CAMERA.minTouchSensitivityFraction;
      tdy *= curve * (1 - f) + f;
    }
    const x =
      keys * CAMERA.rotationSpeedKeys * dt +
      this.mouse.dx * CAMERA.rotationSpeedMouse.x * s +
      this.touch.dx * CAMERA.rotationSpeedTouch.x * s;
    const y = this.mouse.dy * CAMERA.rotationSpeedMouse.y * s + tdy * CAMERA.rotationSpeedTouch.y * s;
    this.mouse.dx = this.mouse.dy = this.touch.dx = this.touch.dy = 0;
    return { x, y };
  }

  /** CameraInput.getZoomDelta(): > 0 zooms out. */
  consumeZoom(dt) {
    const keys = (this.keys.has('KeyO') ? 1 : 0) - (this.keys.has('KeyI') ? 1 : 0);
    const z =
      keys * CAMERA.zoomSpeedKeys * dt * 60 + this.wheel * CAMERA.zoomSpeedMouse - this.pinch * CAMERA.zoomSpeedTouch;
    this.wheel = 0;
    this.pinch = 0;
    return z;
  }
}
