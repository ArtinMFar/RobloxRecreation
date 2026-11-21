// A single empty platform under a gradient sky, with a sun whose shadow
// frustum follows the character.
import * as THREE from 'three';
import { WORLD } from './config.js';

function gridTexture(renderer) {
  const px = 256; // one tile = 4 x 4 studs
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = '#9d9fa3';
  g.fillRect(0, 0, px, px);
  // faint speckle so the surface reads as a material at grazing angles
  const img = g.getImageData(0, 0, px, px);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 6;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.10)';
  g.lineWidth = 4;
  g.strokeRect(0, 0, px, px);
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, px - 8, px - 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WORLD.platform.size / 4, WORLD.platform.size / 4);
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
      top: { value: new THREE.Color('#3f86d8') },
      horizon: { value: new THREE.Color('#bcd9f2') },
      bottom: { value: new THREE.Color('#9fb6c9') },
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
  scene.fog = new THREE.Fog('#bcd9f2', 500, 2600);

  scene.add(new THREE.HemisphereLight('#dfeeff', '#7c7a74', 1.35));

  const sun = new THREE.DirectionalLight('#fff6e8', 2.6);
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
  const topMat = new THREE.MeshStandardMaterial({ map: gridTexture(renderer), roughness: 0.95, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#6f7175', roughness: 0.95, metalness: 0 });
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
