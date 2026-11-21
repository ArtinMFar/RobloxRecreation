import * as THREE from 'three';
import { WORLD, CAMERA } from './config.js';
import { createWorld } from './world.js';
import { Humanoid, wrapAngle } from './humanoid.js';
import { CameraController } from './camera.js';
import { Input } from './input.js';
import { DynamicThumbstick, JumpButton } from './touchcontrols.js';
import { loadAvatar } from './avatar.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('view');
const layer = document.getElementById('game');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
const world = createWorld(renderer);
const humanoid = new Humanoid();
const cam = new CameraController(camera, world.obstacles);
const input = new Input(layer);
const thumbstick = new DynamicThumbstick(hud);
const jumpButton = new JumpButton(hud, (held) => {
  input.jumpButtonHeld = held;
  if (held) input.jumpLatch = true;
});
input.thumbstick = thumbstick;

const ui = createUI({ onChange: applySettings });
thumbstick.onLayout = (ts) => ui.placeModeButton(ts);
ui.placeModeButton(thumbstick);

const prefersTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

function applySettings(s) {
  const mode = s.inputMode || (prefersTouch ? 'touch' : 'keyboard');
  input.mode = mode;
  input.sensitivity = s.sensitivity;
  thumbstick.setEnabled(mode === 'touch');
  jumpButton.setVisible(mode === 'touch');
  // "Default" is Classic for mouse & keyboard and Follow for touch, as on the real thing.
  cam.mode = s.cameraMode === 'Default' ? (mode === 'touch' ? 'Follow' : 'Classic') : s.cameraMode;
  if (mode === 'touch') cam.shiftLock = false;
  ui.showMode(mode);
}
applySettings(ui.settings);

input.onActivity = () => ui.closeHelpOnActivity();
input.onShiftLock = () => {
  if (input.mode !== 'keyboard') return;
  cam.shiftLock = !cam.shiftLock;
  input.setWantLock(cam.shiftLock || cam.inFirstPerson);
};
input.onLockLost = () => {
  cam.shiftLock = false; // Esc released the mouse
};

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function respawn() {
  humanoid.spawn(0, 0, 0);
  cam.reset(0);
}
respawn();

let avatar;
try {
  avatar = await loadAvatar('./assets/bacon-hair.glb');
} catch (err) {
  console.error(err);
  ui.error(
    location.protocol === 'file:'
      ? 'The avatar could not load from a file:// URL. Serve this folder over HTTP (see README).'
      : `The avatar could not be loaded: ${err.message}`,
  );
  throw err;
}
world.scene.add(avatar.root);
humanoid.on('state', (state) => {
  if (state === 'Jumping') avatar.animator.onJumping();
  else if (state === 'Freefall') avatar.animator.onFreeFall();
});
ui.loaded();

// ---------------------------------------------------------------------------

const STEP = 1 / WORLD.physicsHz;
const MAX_STEPS = 48;
const renderPos = new THREE.Vector3();
const focus = new THREE.Vector3();
let accumulator = 0;
let last = performance.now();
let fps = 60;
let statsTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) return;
  if (dt > 0.1) dt = 0.1;

  // ControlModule: camera-relative move direction from the camera's current yaw.
  const mv = input.getMoveVector();
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  let wx = -cy * mv.x - sy * mv.z;
  let wz = sy * mv.x - cy * mv.z;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  humanoid.moveDirection.set(wx, 0, wz);
  humanoid.jump = input.jumpHeld;
  const cameraRelative = cam.mouseLocked || cam.inFirstPerson;
  humanoid.cameraRelativeYaw = cameraRelative ? cam.yaw : null;

  // Fixed-rate physics.
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    humanoid.step(STEP);
    accumulator -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0;
  if (steps > 0) input.jumpLatch = false;
  if (humanoid.position.y < WORLD.destroyHeight) respawn();
  const alpha = accumulator / STEP;
  renderPos.lerpVectors(humanoid.prevPosition, humanoid.position, alpha);

  if (humanoid.state === 'Running') avatar.animator.onRunning(humanoid.horizontalSpeed);

  // Camera follows the HumanoidRootPart rigidly, 1.5 studs above it.
  const rot = input.consumeRotation(cam.pitch, dt);
  const zoom = input.consumeZoom(dt);
  focus.set(renderPos.x, renderPos.y + avatar.rootHeight + CAMERA.headOffset, renderPos.z);
  cam.update(dt, now / 1000, rot, zoom, focus);

  avatar.root.position.copy(renderPos);
  avatar.root.rotation.y = cameraRelative
    ? cam.yaw
    : humanoid.prevYaw + wrapAngle(humanoid.yaw - humanoid.prevYaw) * alpha;
  avatar.update(dt);
  avatar.setTransparency(cam.transparency);

  const wantLock = input.mode === 'keyboard' && (cam.mouseLocked || cam.inFirstPerson);
  input.setWantLock(wantLock);
  ui.setCrosshair(cam.mouseLocked);
  ui.setLockHint(wantLock && !input.locked);

  world.follow(renderPos, camera);
  renderer.render(world.scene, camera);

  fps += (1 / dt - fps) * 0.05;
  statsTimer -= dt;
  if (statsTimer <= 0) {
    statsTimer = 0.1;
    const v = humanoid.velocity;
    ui.setStats(
      [
        `fps      ${fps.toFixed(0)}`,
        `speed    ${humanoid.horizontalSpeed.toFixed(2)} studs/s`,
        `vertical ${v.y.toFixed(2)} studs/s`,
        `state    ${humanoid.state}`,
        `anim     ${avatar.animator.current}`,
        `camera   ${cam.mode}${cam.shiftLock ? ' + shift lock' : ''}${cam.inFirstPerson ? ' (1st person)' : ''}`,
        `zoom     ${cam.distance.toFixed(2)} → ${cam.subjectDistance.toFixed(2)}`,
        `pitch    ${((cam.pitch * 180) / Math.PI).toFixed(1)}°`,
      ].join('\n'),
    );
  }
}
requestAnimationFrame(frame);

// Handy for tuning from the console.
window.sandbox = { humanoid, cam, avatar, input, THREE };
