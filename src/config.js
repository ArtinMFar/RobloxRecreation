// All tuning lives here. Units are studs and seconds (1 three.js unit = 1 stud).
// Values marked [default] are engine/PlayerModule defaults; values marked
// [estimate] are not published and were tuned to match observed behaviour.
// README.md lists the reasoning behind each one.

const DEG = Math.PI / 180;

export const WORLD = {
  gravity: 196.2, // [default] Workspace.Gravity
  destroyHeight: -500, // [default] Workspace.FallenPartsDestroyHeight
  physicsHz: 240, // engine physics step rate
  platform: { size: 512, thickness: 16, top: 0 },
};

export const HUMANOID = {
  walkSpeed: 16, // [default] Humanoid.WalkSpeed
  jumpHeight: 7.2, // [default] Humanoid.JumpHeight -> v0 = sqrt(2 g h) ~= 53.1 studs/s
  // The legacy Humanoid drives horizontal velocity toward MoveDirection * WalkSpeed
  // almost instantly on the ground (GroundController parity defaults are
  // AccelerationTime = 0 / DecelerationTime = 0).
  groundAccel: 740, // [estimate] studs/s^2, reaches 16 studs/s in ~1.3 frames
  // In the air the same controller keeps steering (releasing keys mid-jump kills
  // horizontal speed) but with noticeably less authority than on the ground.
  airAccel: 160, // [estimate] studs/s^2
  // AutoRotate: the body turns toward MoveDirection with a fast ease-out.
  turnGain: 14, // [estimate] 1/s, proportional gain on heading error
  maxTurnRate: 18, // [estimate] rad/s cap
  collisionRadius: 0.75,
  height: 5.3,
};

export const CAMERA = {
  fov: 70, // [default] Camera.FieldOfView (vertical)
  near: 0.1,
  far: 4000,
  defaultZoom: 12.5, // [default] DEFAULT_DISTANCE
  minZoom: 0.5, // [default] StarterPlayer.CameraMinZoomDistance
  maxZoom: 128, // [default] StarterPlayer.CameraMaxZoomDistance
  firstPersonThreshold: 1.0, // [default] FIRST_PERSON_DISTANCE_THRESHOLD
  firstPersonDistance: 0.5, // [default] FIRST_PERSON_DISTANCE_CUTOFF
  zoomSensitivityCurvature: 0.5, // [default] ZOOM_SENSITIVITY_CURVATURE
  zoomStiffness: 4.5, // [default] ZoomController ZOOM_STIFFNESS (Hz, critically damped)
  zoomAcceleration: 0.0375, // [default] ZOOM_ACCELERATION
  minFocusDist: 0.5, // [default] MIN_FOCUS_DIST
  distOpaque: 1, // [default] DIST_OPAQUE
  minPitch: -80 * DEG, // [default] MIN_Y
  maxPitch: 80 * DEG, // [default] MAX_Y
  initialPitch: -20 * DEG,
  headOffset: 1.5, // [default] HEAD_OFFSET above the HumanoidRootPart
  rotationSpeedMouse: { x: 0.5 * DEG, y: 0.5 * 0.77 * DEG }, // [default] rad per pixel
  rotationSpeedTouch: { x: 1 * DEG, y: 0.66 * DEG }, // [default] rad per pixel
  rotationSpeedKeys: 120 * DEG, // [default] rad/s for Left/Right arrows
  zoomSpeedMouse: 1, // [default] per wheel notch
  zoomSpeedKeys: 0.1, // [default] per frame (60 fps) while I/O held
  zoomSpeedTouch: 0.04, // [default] per pixel of pinch
  minTouchSensitivityFraction: 0.25, // [default] pitch damping near the poles
  shiftLockOffset: 1.75, // [default] MouseLockController camera offset (studs right)
  followThetaCutoff: 0.4, // [default] Follow mode dead zone (rad/s)
  timeBeforeAutoRotate: 2, // [default] Follow mode pause after the user pans
  transparencyRate: 2.8, // [default] TransparencyController MAX_TWEEN_RATE
};

export const THUMBSTICK = {
  // [default] DynamicThumbstick sizes in GUI pixels, doubled when min(screen) > 500
  thumbstickSize: 45,
  ringSize: 20,
  middleSize: 10,
  middleSpacing: 14,
  deadZone: 2,
  maxSpeedRadius: 20,
  numMiddle: 6,
  middleOpacity: [0.89, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25],
  fadeTime: 0.15, // [default] ThumbstickFadeTweenInfo
  bigScreen: 500,
};

export const JUMP_BUTTON = {
  small: 70, // [default] TouchJump size on small screens
  big: 120,
};

export const ANIM = {
  // R6 Animate script behaviour
  walkSpeedDivisor: 14.5, // walk track speed = speed / 14.5
  runThreshold: 0.01,
  fadeDefault: 0.1,
  fadeFall: 0.2,
  jumpAnimDuration: 0.3,
  walkPeriod: 0.8, // [estimate] seconds per stride at track speed 1
  walkSwing: 0.75, // [estimate] radians of arm/leg swing
};
