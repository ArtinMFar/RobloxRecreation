// Character controller modelled on the legacy Humanoid: velocity is steered
// toward MoveDirection * WalkSpeed with a capped acceleration, the body turns
// toward MoveDirection (AutoRotate), and holding jump re-jumps on landing.
import * as THREE from 'three';
import { WORLD, HUMANOID } from './config.js';

const TAU = Math.PI * 2;
export const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Humanoid {
  constructor() {
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.prevYaw = 0;
    this.moveDirection = new THREE.Vector3(); // world space, length <= 1
    this.jump = false; // jump input held
    this.cameraRelativeYaw = null; // set in shift lock / first person
    this.grounded = true;
    this.state = 'Running';
    this.jumpVelocity = Math.sqrt(2 * WORLD.gravity * HUMANOID.jumpHeight);
    this.listeners = {};
  }

  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    for (const fn of this.listeners.state || []) fn(state);
  }

  spawn(x, z, yaw = 0) {
    this.position.set(x, WORLD.platform.top, z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
    this.grounded = true;
    this.setState('Running');
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  step(dt) {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    const v = this.velocity;

    if (this.state === 'Jumping') this.setState('Freefall');

    // Horizontal: move toward the target velocity, limited by acceleration.
    const tx = this.moveDirection.x * HUMANOID.walkSpeed;
    const tz = this.moveDirection.z * HUMANOID.walkSpeed;
    let dx = tx - v.x;
    let dz = tz - v.z;
    const err = Math.hypot(dx, dz);
    const maxDv = (this.grounded ? HUMANOID.groundAccel : HUMANOID.airAccel) * dt;
    if (err > maxDv) {
      dx *= maxDv / err;
      dz *= maxDv / err;
    }
    v.x += dx;
    v.z += dz;

    if (this.grounded && this.jump) {
      v.y = this.jumpVelocity;
      this.grounded = false;
      this.setState('Jumping');
    }

    // Exact constant-acceleration update so the apex lands on JumpHeight.
    const g = this.grounded ? 0 : WORLD.gravity;
    this.position.x += v.x * dt;
    this.position.z += v.z * dt;
    this.position.y += v.y * dt - 0.5 * g * dt * dt;
    v.y -= g * dt;
    this.collide();
    this.turn(dt);
  }

  collide() {
    const { size, thickness, top } = WORLD.platform;
    const half = size / 2;
    const bottom = top - thickness;
    const r = HUMANOID.collisionRadius;
    const p = this.position;
    const v = this.velocity;

    const nx = clamp(p.x, -half, half);
    const nz = clamp(p.z, -half, half);
    const ox = p.x - nx;
    const oz = p.z - nz;
    const distSq = ox * ox + oz * oz;
    const overPlatform = distSq <= r * r;
    const cameFromAbove = this.prevPosition.y >= top - 1e-4;

    if (overPlatform && cameFromAbove && p.y <= top && v.y <= 0) {
      p.y = top;
      v.y = 0;
      if (!this.grounded) {
        this.grounded = true;
        this.setState('Landed');
        this.setState('Running');
      }
      return;
    }

    if (this.grounded) {
      // Walked off the edge.
      this.grounded = false;
      this.setState('Freefall');
    }

    // Side of the platform while below its top surface.
    if (overPlatform && p.y < top && p.y + HUMANOID.height > bottom) {
      let px, pz;
      if (distSq > 1e-10) {
        const d = Math.sqrt(distSq);
        px = ox / d;
        pz = oz / d;
        p.x = nx + px * r;
        p.z = nz + pz * r;
      } else {
        // Centre is inside the slab footprint: leave by the nearest edge.
        const exits = [
          [half - p.x, 1, 0],
          [p.x + half, -1, 0],
          [half - p.z, 0, 1],
          [p.z + half, 0, -1],
        ].sort((a, b) => a[0] - b[0]);
        [, px, pz] = exits[0];
        if (px) p.x = px * (half + r);
        else p.z = pz * (half + r);
      }
      const vn = v.x * px + v.z * pz;
      if (vn < 0) {
        v.x -= vn * px;
        v.z -= vn * pz;
      }
    }
  }

  turn(dt) {
    if (this.cameraRelativeYaw !== null) {
      this.yaw = this.cameraRelativeYaw;
      return;
    }
    const m = this.moveDirection;
    if (m.x * m.x + m.z * m.z < 1e-8) return;
    const diff = wrapAngle(Math.atan2(m.x, m.z) - this.yaw);
    let step = clamp(diff * HUMANOID.turnGain, -HUMANOID.maxTurnRate, HUMANOID.maxTurnRate) * dt;
    if (Math.abs(step) > Math.abs(diff)) step = diff;
    this.yaw = wrapAngle(this.yaw + step);
  }
}
