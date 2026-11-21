// Third-person camera modelled on the default PlayerModule CameraModule
// (ClassicCamera + ZoomController + Poppercam + TransparencyController).
// Rotation is applied directly from input with no smoothing; only the zoom
// distance is smoothed, by a critically damped spring.
import * as THREE from 'three';
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ZoomController's ConstrainedSpring: critically damped, frequency in Hz.
class ConstrainedSpring {
  constructor(freq, x, min, max) {
    this.freq = freq;
    this.x = clamp(x, min, max);
    this.v = 0;
    this.min = min;
    this.max = max;
    this.goal = this.x;
  }
  step(dt) {
    const f = this.freq * 2 * Math.PI;
    const offset = this.goal - this.x;
    const s = f * dt;
    const decay = Math.exp(-s);
    let x1 = this.goal + (this.v * dt - offset * (s + 1)) * decay;
    let v1 = ((offset * f - this.v) * s + this.v) * decay;
    if (x1 < this.min) {
      x1 = this.min;
      v1 = 0;
    } else if (x1 > this.max) {
      x1 = this.max;
      v1 = 0;
    }
    this.x = x1;
    this.v = v1;
    return x1;
  }
}

function stepTargetZoom(z, dz, zMin, zMax) {
  z = clamp(z + dz * (1 + z * CAMERA.zoomAcceleration), zMin, zMax);
  if (z < CAMERA.distOpaque) z = dz <= 0 ? zMin : CAMERA.distOpaque;
  return z;
}

// Slab-method ray/AABB test. Returns the entry distance or Infinity.
function rayBox(o, d, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < min[k] || o[k] > max[k]) return Infinity;
    } else {
      let t1 = (min[k] - o[k]) / d[k];
      let t2 = (max[k] - o[k]) / d[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return Math.max(tmin, 0);
}

const _look = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _target = new THREE.Vector3();

export class CameraController {
  constructor(camera, obstacles) {
    this.camera = camera;
    this.obstacles = obstacles; // array of { min: Vector3, max: Vector3 }
    this.mode = 'Classic'; // 'Classic' | 'Follow'
    this.yaw = 0; // look = (sin yaw cos pitch, sin pitch, cos yaw cos pitch)
    this.pitch = CAMERA.initialPitch;
    this.subjectDistance = CAMERA.defaultZoom; // BaseCamera.currentSubjectDistance
    this.zoomDirection = 0;
    this.spring = new ConstrainedSpring(CAMERA.zoomStiffness, CAMERA.defaultZoom, CAMERA.minFocusDist, CAMERA.maxZoom);
    this.inFirstPerson = false;
    this.shiftLock = false;
    this.lastCameraPos = null;
    this.lastUserPanTime = -Infinity;
    this.focus = new THREE.Vector3();
    this.distance = CAMERA.defaultZoom; // final distance after poppercam + spring
    this.transparency = 0;
  }

  reset(yaw) {
    this.yaw = yaw;
    this.pitch = CAMERA.initialPitch;
    this.lastCameraPos = null;
  }

  getLookVector(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  get mouseLocked() {
    return this.shiftLock && !this.inFirstPerson;
  }

  // BaseCamera:SetCameraToSubjectDistance
  setSubjectDistance(desired) {
    const last = this.subjectDistance;
    const d = clamp(desired, CAMERA.minZoom, CAMERA.maxZoom);
    if (d < CAMERA.firstPersonThreshold) {
      this.subjectDistance = CAMERA.firstPersonDistance;
      this.inFirstPerson = true;
    } else {
      this.subjectDistance = d;
      this.inFirstPerson = false;
    }
    this.spring.goal = this.subjectDistance;
    this.zoomDirection = Math.sign(desired - last);
  }

  // BaseCamera:StepZoom
  stepZoom(delta) {
    if (Math.abs(delta) <= 0) return;
    const z = this.subjectDistance;
    let next;
    if (delta > 0) {
      next = z + delta * (1 + z * CAMERA.zoomSensitivityCurvature);
      next = Math.max(next, CAMERA.firstPersonThreshold);
    } else {
      next = (z + delta) / (1 - delta * CAMERA.zoomSensitivityCurvature);
      next = Math.max(next, CAMERA.firstPersonDistance);
    }
    if (next < CAMERA.firstPersonThreshold) next = CAMERA.firstPersonDistance;
    this.setSubjectDistance(next);
  }

  // BaseCamera:CalculateNewLookCFrameFromArg, on yaw/pitch.
  applyRotation(rx, ry) {
    const dy = clamp(ry, -CAMERA.maxPitch + this.pitch, -CAMERA.minPitch + this.pitch);
    this.yaw -= rx;
    this.pitch -= dy;
  }

  // Poppercam: keep the near plane out of obstacles between focus and camera.
  popper(focus, back, maxDist) {
    const cam = this.camera;
    const hh = cam.near * Math.tan((cam.fov * Math.PI) / 360);
    const hw = hh * cam.aspect;
    _right.set(-back.z, 0, back.x).normalize(); // horizontal, perpendicular to back
    _up.crossVectors(back, _right).normalize();
    let best = maxDist;
    for (const [sx, sy] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      _origin.copy(focus).addScaledVector(_right, sx * hw).addScaledVector(_up, sy * hh);
      for (const box of this.obstacles) {
        const t = rayBox(_origin, back, box.min, box.max);
        if (t < best) best = t;
      }
    }
    return best;
  }

  // ZoomController.Update
  updateZoom(dt, focus, back) {
    let popped = Infinity;
    if (this.spring.goal > CAMERA.distOpaque) {
      const maxPossible = Math.max(
        this.spring.x,
        stepTargetZoom(this.spring.goal, this.zoomDirection, CAMERA.minZoom, CAMERA.maxZoom),
      );
      _probe.copy(focus).addScaledVector(back, CAMERA.minFocusDist);
      popped = this.popper(_probe, back, maxPossible - CAMERA.minFocusDist) + CAMERA.minFocusDist;
    }
    this.spring.min = CAMERA.minFocusDist;
    this.spring.max = Math.min(CAMERA.maxZoom, popped);
    return this.spring.step(dt);
  }

  /**
   * @param dt frame time
   * @param now seconds
   * @param rot {x, y} rotation input in radians (CameraInput.getRotation)
   * @param zoomDelta CameraInput.getZoomDelta
   * @param subject HumanoidRootPart position + head offset
   */
  update(dt, now, rot, zoomDelta, subject) {
    let rx = rot.x;
    let ry = rot.y;
    this.stepZoom(zoomDelta);

    const panning = rx !== 0 || ry !== 0;
    if (panning) this.lastUserPanTime = now;
    const recentlyPanned = now - this.lastUserPanTime < CAMERA.timeBeforeAutoRotate;

    _focus.copy(subject);

    if (this.mouseLocked) {
      // Shift lock: offset the focus to the right of the *rotated* look direction.
      this.applyRotation(rx, ry);
      rx = ry = 0;
      this.getLookVector(_look);
      _right.set(-_look.z, 0, _look.x).normalize(); // camera right vector
      _focus.addScaledVector(_right, CAMERA.shiftLockOffset);
    } else if (!panning && this.lastCameraPos && this.mode === 'Follow' && !this.inFirstPerson && !recentlyPanned) {
      // Follow mode: swing toward the direction from the last camera position to
      // the subject, so strafing drags the camera around behind the character.
      const lx = subject.x - this.lastCameraPos.x;
      const lz = subject.z - this.lastCameraPos.z;
      this.getLookVector(_look);
      const y = Math.atan2(_look.x * lz - _look.z * lx, _look.x * lx + _look.z * lz);
      if (Number.isFinite(y) && Math.abs(y) > 0.0001 && Math.abs(y) > CAMERA.followThetaCutoff * dt) rx += y;
    }

    if (rx !== 0 || ry !== 0) this.applyRotation(rx, ry);
    this.getLookVector(_look);

    const zoom = Math.max(this.subjectDistance, CAMERA.firstPersonDistance);
    _camPos.copy(_focus).addScaledVector(_look, -zoom);
    (this.lastCameraPos ||= new THREE.Vector3()).copy(_camPos);

    _back.copy(_look).negate();
    this.distance = this.updateZoom(dt, _focus, _back);
    this.focus.copy(_focus);

    this.camera.position.copy(_focus).addScaledVector(_back, this.distance);
    this.camera.lookAt(_target.copy(this.camera.position).add(_look));

    this.updateTransparency(dt);
  }

  // TransparencyController: fade the character out as the camera closes in.
  updateTransparency(dt) {
    const d = this.distance;
    let t = d < 2 ? 1 - (d - 0.5) / 1.5 : 0;
    if (t < 0.5) t = 0;
    const last = this.transparency;
    if (t < 1 && last < 0.95) {
      const maxDelta = CAMERA.transparencyRate * dt;
      t = last + clamp(t - last, -maxDelta, maxDelta);
    }
    this.transparency = clamp(Math.round(t * 100) / 100, 0, 1);
  }
}
