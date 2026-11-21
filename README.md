# Roblox-style movement & camera recreation

A static web page (three.js, no build step) that recreates the feel of Roblox's
default character controller and camera on an empty platform, with a bacon hair
avatar, keyboard/mouse controls and a dynamic mobile thumbstick.

Not affiliated with or endorsed by Roblox Corporation.

## Running it

**GitHub Pages:** repository *Settings → Pages → Build and deployment →
Deploy from a branch*, pick the branch that holds these files and the `/ (root)`
folder. The site is served from `https://<user>.github.io/<repo>/`. All paths
are relative and three.js is vendored in `vendor/`, so nothing else is needed.

**Full screen on phones:** Roblox runs edge to edge, and the browser's address
bar would otherwise eat about a fifth of the height. With a fixed vertical field
of view, everything would then look that much smaller. The page goes full
screen (landscape) on the first tap in touch mode, and the top-right button
toggles it. iPhone Safari has no page full screen; use *Share → Add to Home
Screen* instead, which launches it full screen through the web app manifest.

**Locally:** browsers block ES modules on `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| Keyboard & mouse | |
|---|---|
| W A S D / ↑ ↓ | Move (camera-relative) |
| Space | Jump; hold to keep jumping on every landing |
| Right-drag | Turn camera |
| ← → | Turn camera (120°/s) |
| Wheel / I O | Zoom; zoom all the way in for first person |
| Shift | Toggle shift lock |

| Touch | |
|---|---|
| Left side (bottom-left zone) | Dynamic thumbstick: touch anywhere and drag |
| Anywhere else | Drag to turn camera, pinch to zoom |
| Arrow button | Jump (hold to keep jumping) |

The pill button above the thumbstick switches between **Touch** and
**Keyboard** mode. Touch-screen devices start in touch mode, everything else
starts in keyboard mode, and the choice is remembered. In touch mode a mouse
can drive the thumbstick, which is handy for testing on desktop.

The gear menu has the camera mode (Default = Classic on keyboard, Follow on
touch, matching Roblox), camera sensitivity, and a stats overlay.

## How the feel is recreated

All numbers live in [`src/config.js`](src/config.js). Values come from the
default PlayerModule scripts (CameraModule / ControlModule / R6 Animate) and
engine defaults. Where Roblox does not publish a value, it is marked as an
estimate below.

### Character (`src/humanoid.js`)

| Behaviour | Value | Source |
|---|---|---|
| Walk speed | 16 studs/s | `Humanoid.WalkSpeed` default |
| Gravity | 196.2 studs/s² | `Workspace.Gravity` default |
| Jump | JumpHeight 7.2 → 53.1 studs/s launch, 0.54 s airtime | `Humanoid.JumpHeight` default |
| Ground acceleration | 740 studs/s²: full speed or a dead stop in ~0.02 s, with a ~0.14 stud stop slide | estimate. Legacy Humanoid is near-instant; `GroundController` parity defaults are AccelerationTime/DecelerationTime = 0 |
| Air control | 160 studs/s²: you keep steering mid-air, and releasing the keys kills horizontal speed in ~0.1 s | estimate. Humanoid air control is fixed and pulls toward the input (or zero) |
| Turning (AutoRotate) | faces MoveDirection with a fast ease-out: 90% of a 180° turn in 0.2 s, while velocity flips instantly (the brief "moonwalk" when reversing) | estimate. `ControllerManager.BaseTurnSpeed` default is 8 |
| Shift lock / first person | body yaw locked to the camera | `RotationType.CameraRelative` |
| Physics rate | fixed 240 Hz with render interpolation | engine step rate |
| Diagonals | input is normalised, so diagonal speed equals walk speed. A partial thumbstick tilt walks slower | `Humanoid:Move` |
| Falling | respawn below Y = −500 | `FallenPartsDestroyHeight` |

### Camera (`src/camera.js`)

| Behaviour | Value |
|---|---|
| Follow | rigid, no positional smoothing, focus is 1.5 studs above the root part |
| Field of view | 70° vertical |
| Pitch limits | ±80° |
| Mouse | 0.5°/px horizontal, 0.385°/px vertical, applied directly (no acceleration or smoothing) |
| Touch | 1°/px horizontal, 0.66°/px vertical; vertical is damped toward 25% when swiping away from the horizon |
| Zoom | default 12.5, range 0.5–128. Each wheel notch is `z + 1·(1 + 0.5z)` out or `(z − 1)/1.5` in, and the distance is eased by a critically damped 4.5 Hz spring |
| Poppercam | the camera pops in instantly when the platform would block it, then springs back out |
| First person | below 1 stud of zoom the camera snaps to 0.5, the character fades out (max 2.8/s when fading back in) and the mouse locks |
| Shift lock | camera focus offset 1.75 studs to the right, mouse locked to the centre |
| Classic mode (PC default) | the camera only turns when you turn it |
| Follow mode (mobile default) | the camera swings toward the direction from its last position to the character, so strafing drags it around behind you. It has a 0.4 rad/s dead zone and pauses for 2 s after you pan manually |

### Look and scale (`src/world.js`, `src/avatar.js`)

These were matched against untouched Roblox phone screenshots at the same
resolution:

- **Framing:** at the default camera the avatar is 270 px tall in Roblox and 275 px here.
- **Floor:** one tile per stud, with a darker purple-grey colour. Lit floor renders at about RGB 107/103/106 here against about 105/99/103 in Roblox.
- **Shadows:** darker shadows from a strong sun over low ambient light. Shadowed floor is about 0.45× the lit floor here, against about 0.4–0.45× in Roblox.
- **Avatar shape:** the avatar is fitted to R6 proportions. The torso is 2 studs wide, and the 1-stud arms hang straight and flush against it, 4 studs across in total. The camera focus sits 1.5 studs above the torso centre (4.5 studs up).

### Mobile controls (`src/touchcontrols.js`)

The DynamicThumbstick layout is reproduced:

- **Touch zone:** the left 40% × bottom ⅔ of the screen in landscape, or the bottom 40% in portrait.
- **Speed:** full speed is reached 20 px from the start point, with a 2 px dead zone. Both double when the shorter screen side is over 500 px.
- **Knob:** follows the finger without being clamped. A 6-dot trail connects it to the start circle.
- **Feedback:** the stick fades in and out over 0.15 s, and a ghost stick shows before the first touch.
- **Jump button:** 70 px (120 px on big screens), anchored bottom-right.

The visuals are drawn with CSS rather than Roblox's texture sheet.

### Animation (`src/avatar.js`)

The model's seven meshes are driven as rigid parts on R6-style joints (Neck,
shoulders, hips), the way an R6 rig moves. The state logic follows the R6
`Animate` script:

- **Walk:** walk/idle switch at speed 0.01, 0.1 s cross-fades, and the walk plays at `speed / 14.5`.
- **Jump:** the jump pose has both arms straight up.
- **Fall:** fall takes over 0.3 s after a jump (fading in over 0.2 s), or immediately when you walk off a ledge.
- **Approximations:** the swing amplitude and stride period are approximations of the stock R6 animations, and are marked as estimates.

## Tuning

Edit `src/config.js`, or poke values live from the browser console via
`sandbox`, for example `sandbox.humanoid` or `sandbox.cam`. Changing an
imported config object at runtime also works, e.g.:

```js
const { HUMANOID } = await import('./src/config.js');
HUMANOID.airAccel = 120;
```

## Layout

```
index.html            page shell + import map
css/style.css         HUD, thumbstick, jump button
src/main.js           wiring and the frame loop
src/config.js         every tunable constant
src/humanoid.js       movement physics + AutoRotate
src/camera.js         Classic/Follow camera, zoom spring, poppercam, transparency
src/input.js          keyboard / mouse / touch → move vector, rotation, zoom
src/touchcontrols.js  dynamic thumbstick + jump button
src/avatar.js         avatar rig + R6-style animator
src/world.js          sky, lights, platform
src/fullscreen.js     full screen + landscape lock
manifest.webmanifest  home-screen install (full screen, landscape)
icons/                app icons
assets/bacon-hair.glb converted avatar (see below)
tools/convert_model.py  how the asset was produced (needs numpy)
vendor/three/         three.js r170 (MIT)
```

## Credits & licences

- **Avatar:** ["Roblox Bacon Hair"](https://sketchfab.com/3d-models/roblox-bacon-hair-88a62bc6286947e9846c5cd445d2628b)
  by [Robloxs](https://sketchfab.com/Robloxs) on Sketchfab, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified for this project as follows:
  - The spec/gloss material was converted to metal/rough using the original diffuse texture.
  - The Mixamo skeleton, skin weights and bundled animation were removed.
  - The parts were renamed and re-oriented to face +Z.

  See `tools/convert_model.py`. The licence is the one the uploader declared on Sketchfab. The character design and the
  Roblox name belong to Roblox Corporation.
- **three.js** r170, MIT licence (`vendor/three/LICENSE`).
