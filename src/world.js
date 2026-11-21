// A single empty platform under a gradient sky, with a sun whose shadow
// frustum follows the character.
import * as THREE from 'three';
import { WORLD } from './config.js';

const FLOOR_COLOR = '#6b686e';
const SKY = { top: '#86b4e2', horizon: '#d3e2ee', bottom: '#b9c6d1' };

// One tile per stud, so the avatar (2 studs wide, 5 tall) reads at the right
// scale against the floor and 16 studs/s looks as fast as it should.
function studTexture(renderer) {
  const studs = 8; // texture covers 8 x 8 studs
  const cell = 64; // pixels per stud
  const px = studs * cell;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = FLOOR_COLOR;
  g.fillRect(0, 0, px, px);
  const img = g.getImageData(0, 0, px, px);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 5;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const inset = (x, y, colour, dx, dy) => {
    const s = cell * 0.5;
    const o = (cell - s) / 2;
    g.strokeStyle = colour;
    g.lineWidth = 3;
    g.beginPath();
    if (g.roundRect) g.roundRect(x + o + dx, y + o + dy, s, s, 7);
    else g.rect(x + o + dx, y + o + dy, s, s);
    g.stroke();
  };
  for (let i = 0; i < studs; i++) {
    for (let j = 0; j < studs; j++) {
      const x = i * cell;
      const y = j * cell;
      // A small bevelled panel per stud: light edge up-left, dark edge down-right.
      inset(x, y, 'rgba(255,255,255,0.10)', -1, -1);
      inset(x, y, 'rgba(0,0,0,0.30)', 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(x, y, cell, 1);
      g.fillRect(x, y, 1, cell);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WORLD.platform.size / studs, WORLD.platform.size / studs);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function sky() {
  const geo = new THREE.SphereGeometry(3000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      bottom: { value: new THREE.Color(SKY.bottom) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7))
                         : mix(horizon, bottom, min(-h * 3.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function createWorld(renderer) {
  const scene = new THREE.Scene();
  const skyMesh = sky();
  scene.add(skyMesh);
  scene.fog = new THREE.Fog(SKY.horizon, 600, 3000);

  // Low ambient against a strong sun gives the darker, higher-contrast shadows.
  scene.add(new THREE.HemisphereLight('#e4eefa', '#5d5b60', 0.75));

  const sun = new THREE.DirectionalLight('#fff8ee', 2.7);
  const sunDir = new THREE.Vector3(0.45, 1, 0.3).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const { size, thickness, top } = WORLD.platform;
  const topMat = new THREE.MeshStandardMaterial({ map: studTexture(renderer), roughness: 0.95, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#5f5d63', roughness: 0.95, metalness: 0 });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(size, thickness, size), [
    sideMat, sideMat, topMat, sideMat, sideMat, sideMat,
  ]);
  platform.position.y = top - thickness / 2;
  platform.receiveShadow = true;
  scene.add(platform);

  const obstacles = [
    {
      min: new THREE.Vector3(-size / 2, top - thickness, -size / 2),
      max: new THREE.Vector3(size / 2, top, size / 2),
    },
  ];

  return {
    scene,
    obstacles,
    follow(target, camera) {
      // Keep the shadow map centred on the character, snapped to texels to avoid shimmer.
      const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
      const snap = (v) => Math.round(v / texel) * texel;
      sun.target.position.set(snap(target.x), snap(target.y), snap(target.z));
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 200);
      skyMesh.position.copy(camera.position);
    },
  };
}
