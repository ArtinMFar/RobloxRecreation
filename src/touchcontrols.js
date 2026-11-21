// Mobile controls modelled on the default DynamicThumbstick + TouchJump:
//  * The thumbstick appears wherever the thumb lands inside the bottom-left
//    zone (left 40% x bottom 2/3 in landscape, bottom 40% in portrait).
//  * The knob follows the finger without being clamped; a trail of dots
//    connects it to the start circle. Full speed is reached 20 px (40 px on
//    big screens) from the start, so partial tilts walk slower.
//  * Before the first touch a faint stick sits at its default spot.
import { THUMBSTICK as T, JUMP_BUTTON } from './config.js';

const el = (cls, parent) => {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
};

function safeInsets() {
  const probe = document.getElementById('safe-area-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

export class DynamicThumbstick {
  constructor(parent) {
    this.root = el('ts-layer', parent);
    this.bg = el('ts-bg', this.root);
    this.mids = [];
    for (let i = 0; i < T.numMiddle; i++) {
      const m = el('ts-mid', this.root);
      m.style.setProperty('--o', T.middleOpacity[i]);
      this.mids.push(m);
    }
    this.ring = el('ts-start', this.root);
    this.knob = el('ts-end', this.root);
    this.moveVector = { x: 0, z: 0 };
    this.pointerId = null;
    this.startPos = { x: 0, y: 0 };
    this.isFirstTouch = true;
    this.enabled = true;
    this.layout();
    addEventListener('resize', () => this.layout());
    addEventListener('orientationchange', () => setTimeout(() => this.layout(), 100));
  }

  get active() {
    return this.pointerId !== null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.end();
    this.root.style.display = on ? '' : 'none';
  }

  layout() {
    const w = innerWidth;
    const h = innerHeight;
    const k = Math.min(w, h) > T.bigScreen ? 2 : 1;
    this.size = {
      thumb: T.thumbstickSize * k,
      ring: T.ringSize * k,
      middle: T.middleSize * k,
      spacing: T.middleSpacing * k,
      deadZone: T.deadZone * k,
      maxSpeed: T.maxSpeedRadius * k,
    };
    const inset = safeInsets();
    // Thumbstick frame (DynamicThumbstick layoutThumbstickFrame).
    if (w < h) this.zone = { x: 0, y: h * 0.6, w, h: h * 0.4 };
    else this.zone = { x: 0, y: h / 3, w: w * 0.4 + inset.left, h: (h * 2) / 3 };

    const s = this.size;
    this.startDiameter = s.ring * 3.7;
    this.endDiameter = s.thumb * 0.8;
    this.idle = {
      x: this.zone.x + inset.left + s.ring * 3.3,
      y: this.zone.y + this.zone.h - inset.bottom - s.ring * 2.8,
    };
    this.ring.style.width = this.ring.style.height = `${this.startDiameter}px`;
    this.knob.style.width = this.knob.style.height = `${this.endDiameter}px`;
    Object.assign(this.bg.style, {
      left: `${this.zone.x}px`,
      top: `${this.zone.y}px`,
      width: `${this.zone.w}px`,
      height: `${this.zone.h}px`,
    });
    if (!this.active) {
      this.place(this.ring, this.idle.x, this.idle.y);
      this.place(this.knob, this.idle.x, this.idle.y);
      this.root.classList.toggle('ts-first', this.isFirstTouch);
    }
    this.onLayout?.(this);
  }

  place(node, x, y) {
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  inZone(x, y) {
    const z = this.zone;
    return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
  }

  owns(id) {
    return this.pointerId === id;
  }

  tryBegin(id, x, y) {
    if (!this.enabled || this.pointerId !== null || !this.inZone(x, y)) return false;
    this.pointerId = id;
    this.startPos = { x, y };
    this.isFirstTouch = false;
    this.root.classList.remove('ts-first');
    this.place(this.ring, x, y);
    this.place(this.knob, x, y);
    this.layoutMiddle(x, y, x, y);
    this.root.classList.add('ts-active');
    this.root.parentElement.classList.add('stick-active');
    this.moveVector = { x: 0, z: 0 };
    return true;
  }

  move(x, y) {
    const dx = x - this.startPos.x;
    const dy = y - this.startPos.y;
    const d = Math.hypot(dx, dy);
    const s = this.size;
    if (d < s.deadZone) {
      this.moveVector = { x: 0, z: 0 };
    } else {
      // DynamicThumbstick doMove: unit * (1 - max(0, (R - d) / R))
      const mag = 1 - Math.max(0, (s.maxSpeed - d) / s.maxSpeed);
      this.moveVector = { x: (dx / d) * mag, z: (dy / d) * mag };
    }
    this.place(this.knob, x, y);
    this.layoutMiddle(this.startPos.x, this.startPos.y, x, y);
  }

  // DynamicThumbstick:LayoutMiddleImages
  layoutMiddle(sx, sy, ex, ey) {
    const s = this.size;
    const startDist = s.thumb / 2 + s.middle;
    const vx = ex - sx;
    const vy = ey - sy;
    const len = Math.hypot(vx, vy);
    const distAvailable = len - s.ring / 2 - s.middle;
    const ux = len > 0 ? vx / len : 0;
    const uy = len > 0 ? vy / len : 0;
    let spacing = s.spacing;
    if (s.spacing * T.numMiddle < distAvailable) spacing = distAvailable / T.numMiddle;
    for (let i = 0; i < T.numMiddle; i++) {
      const node = this.mids[i];
      const without = startDist + spacing * (i - 1);
      const current = startDist + spacing * i;
      if (len > 0 && without < distAvailable) {
        const exposed = Math.min(1, Math.max(0, 1 - (current - distAvailable) / spacing));
        const size = s.middle * exposed;
        node.style.width = node.style.height = `${size}px`;
        this.place(node, ex - ux * current, ey - uy * current);
        node.classList.add('on');
      } else {
        node.classList.remove('on');
      }
    }
  }

  end() {
    this.pointerId = null;
    this.moveVector = { x: 0, z: 0 };
    this.root.classList.remove('ts-active');
    this.root.parentElement.classList.remove('stick-active');
    for (const m of this.mids) m.classList.remove('on');
  }
}

export class JumpButton {
  constructor(parent, onChange) {
    this.node = document.createElement('div');
    this.node.className = 'jump-btn';
    this.node.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 26 L76 54 H60 V74 H40 V54 H24 Z"/></svg>';
    this.node.setAttribute('role', 'button');
    this.node.setAttribute('aria-label', 'Jump');
    parent.appendChild(this.node);
    this.pointers = new Set();
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.node.setPointerCapture(e.pointerId);
      this.pointers.add(e.pointerId);
      this.update(onChange);
    };
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.update(onChange);
    };
    this.node.addEventListener('pointerdown', down);
    this.node.addEventListener('pointerup', up);
    this.node.addEventListener('pointercancel', up);
    this.node.addEventListener('lostpointercapture', up);
    this.node.addEventListener('contextmenu', (e) => e.preventDefault());
    this.layout();
    addEventListener('resize', () => this.layout());
  }

  update(onChange) {
    const held = this.pointers.size > 0;
    this.node.classList.toggle('pressed', held);
    onChange(held);
  }

  setVisible(on) {
    this.node.style.display = on ? '' : 'none';
    if (!on) this.pointers.clear();
  }

  // TouchJumpController: 70 px (120 px on big screens), anchored bottom-right.
  layout() {
    const w = innerWidth;
    const h = innerHeight;
    const small = Math.min(w, h) <= T.bigScreen;
    const size = small ? JUMP_BUTTON.small : JUMP_BUTTON.big;
    const inset = safeInsets();
    const left = w - (size * 1.5 - 10) - inset.right;
    const top = small ? h - size - 20 - inset.bottom : h - size * 1.75 - inset.bottom;
    Object.assign(this.node.style, {
      width: `${size}px`,
      height: `${size}px`,
      left: `${left}px`,
      top: `${top}px`,
    });
  }
}
