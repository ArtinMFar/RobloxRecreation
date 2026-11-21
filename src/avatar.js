// Avatar = rigid body parts on R6-style joints (Neck, Left/Right Shoulder,
// Left/Right Hip), animated like the R6 "Animate" script: idle / walk / jump /
// fall tracks cross-faded by weight, walk speed scaled by speed / 14.5.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { ANIM } from './config.js';

const PART_NAMES = ['Hair', 'Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];
const JOINTS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export async function loadAvatar(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const meshes = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) meshes[o.name] = o;
  });
  for (const name of PART_NAMES) if (!meshes[name]) throw new Error(`Avatar part "${name}" missing`);

  // Bake node transforms so every part's geometry lives in one model frame.
  const material = meshes.Torso.material;
  material.side = THREE.FrontSide;
  const geoms = {};
  const all = new THREE.Box3();
  for (const name of PART_NAMES) {
    const g = meshes[name].geometry.clone();
    g.applyMatrix4(meshes[name].matrixWorld);
    g.computeBoundingBox();
    all.union(g.boundingBox);
    geoms[name] = g;
  }
  // Origin = feet level, centred under the torso (the HumanoidRootPart's spot).
  const torsoBox = geoms.Torso.boundingBox;
  const origin = new THREE.Vector3(
    (torsoBox.min.x + torsoBox.max.x) / 2,
    all.min.y,
    (torsoBox.min.z + torsoBox.max.z) / 2,
  );
  const boxes = {};
  for (const name of PART_NAMES) {
    geoms[name].translate(-origin.x, -origin.y, -origin.z);
    geoms[name].computeBoundingBox();
    geoms[name].computeBoundingSphere();
    boxes[name] = geoms[name].boundingBox;
  }
  return new Avatar(geoms, boxes, material);
}

class Avatar {
  constructor(geoms, boxes, material) {
    this.material = material;
    this.root = new THREE.Group(); // positioned at the humanoid's feet, rotated by yaw
    this.root.name = 'Avatar';
    this.meshes = [];

    const torso = boxes.Torso;
    this.rootHeight = (torso.min.y + torso.max.y) / 2; // HumanoidRootPart centre
    this.height = boxes.Hair.max.y;

    const addPart = (parent, name, pivot) => {
      const mesh = new THREE.Mesh(geoms[name], material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (pivot) mesh.position.copy(pivot).negate();
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const makeJoint = (pivot) => {
      const joint = new THREE.Group();
      joint.position.copy(pivot);
      this.root.add(joint);
      return joint;
    };

    addPart(this.root, 'Torso');

    const neckPivot = new THREE.Vector3(0, torso.max.y, 0);
    this.neck = makeJoint(neckPivot);
    addPart(this.neck, 'Head', neckPivot);
    addPart(this.neck, 'Hair', neckPivot);

    // Shoulders: inner edge of the arm, 0.5 studs below its top (R6 C0 = (±1, 0.5, 0)).
    const armPivot = (box, side) =>
      new THREE.Vector3(side > 0 ? box.min.x : box.max.x, box.max.y - 0.5, 0);
    // Hips: at the bottom of the torso, under the leg's centre line.
    const hipPivot = (box) => new THREE.Vector3((box.min.x + box.max.x) / 2, torso.min.y + 0.15, 0);

    // The model faces +Z, so its left side is +X.
    const lArm = armPivot(boxes.LeftArm, 1);
    const rArm = armPivot(boxes.RightArm, -1);
    const lLeg = hipPivot(boxes.LeftLeg);
    const rLeg = hipPivot(boxes.RightLeg);
    this.joints = {
      leftArm: makeJoint(lArm),
      rightArm: makeJoint(rArm),
      leftLeg: makeJoint(lLeg),
      rightLeg: makeJoint(rLeg),
    };
    addPart(this.joints.leftArm, 'LeftArm', lArm);
    addPart(this.joints.rightArm, 'RightArm', rArm);
    addPart(this.joints.leftLeg, 'LeftLeg', lLeg);
    addPart(this.joints.rightLeg, 'RightLeg', rLeg);

    this.animator = new Animator();
    this.transparency = 0;
  }

  // swing > 0 moves the limb forward (+Z); roll > 0 moves it outward.
  applyPose(pose) {
    for (const name of JOINTS) {
      const j = pose[name];
      const outward = name.startsWith('left') ? 1 : -1;
      this.joints[name].rotation.set(-j.swing, 0, j.roll * outward);
    }
  }

  setTransparency(t) {
    if (t === this.transparency) return;
    this.transparency = t;
    this.root.visible = t < 1;
    this.material.transparent = t > 0;
    this.material.opacity = 1 - t;
    this.material.depthWrite = t < 0.5;
    this.material.needsUpdate = true;
  }

  update(dt) {
    this.applyPose(this.animator.step(dt));
  }
}

// ---------------------------------------------------------------------------

const zeroPose = () => ({
  leftArm: { swing: 0, roll: 0 },
  rightArm: { swing: 0, roll: 0 },
  leftLeg: { swing: 0, roll: 0 },
  rightLeg: { swing: 0, roll: 0 },
});

const POSES = {
  idle(t, out) {
    // Slow breathing sway of the arms.
    const s = Math.sin((t / 2.6) * Math.PI * 2);
    for (const arm of [out.leftArm, out.rightArm]) {
      arm.roll = 0.045 + 0.035 * s;
      arm.swing = 0.02 * s;
    }
  },
  walk(t, out) {
    const s = Math.sin((t / ANIM.walkPeriod) * Math.PI * 2) * ANIM.walkSwing;
    out.rightArm.swing = s;
    out.leftArm.swing = -s;
    out.rightLeg.swing = -s;
    out.leftLeg.swing = s;
  },
  jump(t, out) {
    out.leftArm.swing = out.rightArm.swing = Math.PI;
  },
  fall(t, out) {
    out.leftArm.swing = out.rightArm.swing = Math.PI - 0.1;
    out.leftArm.roll = out.rightArm.roll = 0.18;
  },
};

class Animator {
  constructor() {
    this.tracks = {};
    for (const name of Object.keys(POSES)) this.tracks[name] = { weight: 0, target: 0, rate: 1, time: 0, speed: 1 };
    this.current = null;
    this.pose = 'Standing';
    this.jumpAnimTime = 0;
    this.scratch = zeroPose();
    this.out = zeroPose();
    this.play('idle', 0);
  }

  // playAnimation(name, transitionTime): restart only if it changed.
  play(name, fade) {
    if (this.current === name) return;
    for (const [key, track] of Object.entries(this.tracks)) {
      track.target = key === name ? 1 : 0;
      track.rate = fade > 0 ? 1 / fade : 1e9;
      if (!(fade > 0)) track.weight = track.target;
    }
    this.tracks[name].time = 0;
    this.tracks[name].speed = 1;
    this.current = name;
  }

  onRunning(speed) {
    if (speed > ANIM.runThreshold) {
      this.play('walk', ANIM.fadeDefault);
      this.tracks.walk.speed = speed / ANIM.walkSpeedDivisor;
      this.pose = 'Running';
    } else {
      this.play('idle', ANIM.fadeDefault);
      this.pose = 'Standing';
    }
  }

  onJumping() {
    this.play('jump', ANIM.fadeDefault);
    this.jumpAnimTime = ANIM.jumpAnimDuration;
    this.pose = 'Jumping';
  }

  onFreeFall() {
    if (this.jumpAnimTime <= 0) this.play('fall', ANIM.fadeFall);
    this.pose = 'FreeFall';
  }

  step(dt) {
    if (this.jumpAnimTime > 0) this.jumpAnimTime -= dt;
    if (this.pose === 'FreeFall' && this.jumpAnimTime <= 0) this.play('fall', ANIM.fadeFall);

    const out = this.out;
    for (const name of JOINTS) out[name].swing = out[name].roll = 0;
    let total = 0;
    for (const [name, track] of Object.entries(this.tracks)) {
      const d = track.target - track.weight;
      const maxStep = track.rate * dt;
      track.weight = Math.abs(d) <= maxStep ? track.target : track.weight + Math.sign(d) * maxStep;
      track.time += dt * track.speed;
      if (track.weight <= 0) continue;
      const p = this.scratch;
      for (const j of JOINTS) p[j].swing = p[j].roll = 0;
      POSES[name](track.time, p);
      for (const j of JOINTS) {
        out[j].swing += p[j].swing * track.weight;
        out[j].roll += p[j].roll * track.weight;
      }
      total += track.weight;
    }
    // Over-weighted blends are normalised; under-weighted ones fall back to the rest pose.
    if (total > 1) {
      for (const j of JOINTS) {
        out[j].swing /= total;
        out[j].roll /= total;
      }
    }
    return out;
  }
}
