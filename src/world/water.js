import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars, fogPars } from '../render/shaders/lib.js';
import { createWaterNormalTexture } from '../render/textures.js';
import { WORLD, POND } from './layout.js';
import { waterSdf, riverInfo } from './terrainData.js';

export const REFLECT_LAYER = 2; // objects on this layer are skipped by the reflection camera

const vert = /* glsl */ `
uniform mat4 uReflMat;
attribute vec2 flow;
varying vec3 vWp;
varying vec2 vFlow;
varying vec4 vRefl;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vFlow = flow;
  vRefl = uReflMat * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
uniform sampler2D uWaterN;
uniform sampler2D uRefl;
uniform sampler2D uHeightTex;
uniform float uReflOn;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWp;
varying vec2 vFlow;
varying vec4 vRefl;

float terrainH(vec2 xz) {
  vec2 uv = (xz + uWorld.x) / (2.0 * uWorld.x);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return uWorld.y - 3.0;
  return texture(uHeightTex, uv).r;
}

vec3 flowNormal(vec2 xz, vec2 flow, float scale, float speed) {
  float t = uTime * speed;
  float p0 = fract(t), p1 = fract(t + 0.5);
  float w = abs(1.0 - 2.0 * p0);
  vec2 uvA = xz / scale - flow * p0 * 1.6;
  vec2 uvB = xz / scale - flow * p1 * 1.6 + 0.5;
  vec3 a = texture(uWaterN, uvA).xyz * 2.0 - 1.0;
  vec3 b = texture(uWaterN, uvB).xyz * 2.0 - 1.0;
  return mix(b, a, w);
}

void main() {
  vec3 wp = vWp;
  float WL = uWorld.y;
  float depth = max(WL - terrainH(wp.xz), 0.0);
  vec3 V = normalize(cameraPosition - wp);
  float dist = length(cameraPosition - wp);

  vec2 flow = vFlow;
  vec3 n1 = flowNormal(wp.xz, flow, 7.0, 0.22);
  vec3 n2 = flowNormal(wp.xz * 1.0 + 13.0, flow * 1.3, 2.6, 0.35);
  vec2 wind = uWind.xy * uTime * 0.03;
  vec3 n3 = texture(uWaterN, wp.xz / 19.0 + wind).xyz * 2.0 - 1.0;
  vec3 tn = n1 * 0.55 + n2 * 0.35 + n3 * 0.45;
  float calm = mix(0.55, 1.0, saturate(length(flow)));
  float strength = calm * mix(1.0, 0.35, saturate(dist / 260.0));
  if (uStyle == 3) strength *= 0.35;
  vec3 N = normalize(vec3(tn.x * strength, 1.0, tn.y * strength));

  vec3 L = uSunDir;
  float NoV = saturate(dot(N, V));
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  if (uStyle == 2 || uStyle == 3) F = mix(0.12, 0.85, smoothstep(0.55, 0.1, NoV));

  // reflection (planar where available, sky otherwise)
  vec3 R = reflect(-V, N);
  vec3 refl;
  vec2 ruv = vRefl.xy / vRefl.w + N.xz * 0.035 * strength;
  vec3 skyR = skyLUT(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * 1.05;
  if (uReflOn > 0.5) refl = texture(uRefl, ruv).rgb;
  else refl = skyR;

  float sh = sunShadow(wp, vec3(0.0, 1.0, 0.0), L.y) * cloudShadow(wp);

  // water body
  vec3 amb = mix(uGroundAmb, uSkyAmb, 0.85);
  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.9));
  body *= amb * 0.9 + uSunColor * 0.12 * sh * saturate(L.y);
  float alphaW = 1.0 - exp(-depth * 1.35);
  alphaW = clamp(alphaW, 0.0, 0.94);

  // sun glints
  vec3 H = normalize(L + V);
  float NoH = saturate(dot(N, H));
  float glint = pow(NoH, uStyle == 4 ? 900.0 : 500.0) * (uStyle == 4 ? 60.0 : 30.0);
  if (uStyle == 2 || uStyle == 3) glint = step(0.996, NoH) * 2.5;
  if (uStyle == 1) glint = smoothstep(0.985, 0.995, NoH) * 2.0;
  vec3 spec = uSunColor * glint * sh;

  // shore foam
  float fn = texture(uWaterN, wp.xz / 3.0 + uTime * 0.02).a;
  float foamLine = 1.0 - smoothstep(0.0, 0.08 + fn * 0.14, depth);
  float fn2 = texture(uWaterN, wp.xz / 1.3 - uTime * 0.03).a;
  float foam = foamLine * smoothstep(0.55, 0.8, fn * 0.6 + fn2 * 0.6) * 0.55;
  if (uStyle == 2 || uStyle == 3) foam = step(0.5, foamLine * (0.6 + fn));
  vec3 foamCol = (uSunColor * 0.25 * sh + amb) * 0.85;

  // stylised looks
  if (uStyle == 1) {
    refl = mix(refl, vec3(luma(refl)) * vec3(0.9, 1.0, 1.1), 0.15);
    body = mix(body, body * vec3(0.8, 1.05, 1.15), 0.5);
  }

  vec3 rgb = refl * F + spec + (1.0 - F) * alphaW * body + foam * foamCol;
  float a = F + (1.0 - F) * alphaW;
  a = saturate(max(a, foam));
  // edge fade so the waterline is soft
  float edge = smoothstep(0.0, 0.06, depth);
  rgb *= edge; a *= edge;
  // fog (premultiplied)
  vec3 dirV = normalize(wp - cameraPosition);
  vec3 fogged = applyFog(rgb / max(a, 1e-3), wp) * a;
  gl_FragColor = vec4(fogged, a);
}
`;

export function createWater(data) {
  const half = 700;
  const step = 2;
  const n = Math.floor((half * 2) / step);
  const positions = [];
  const flows = [];
  const index = [];
  const vmap = new Int32Array((n + 1) * (n + 1)).fill(-1);
  const ri = {};
  const getV = (i, j) => {
    const k = j * (n + 1) + i;
    if (vmap[k] >= 0) return vmap[k];
    const x = -half + i * step, z = -half + j * step;
    positions.push(x, WORLD.waterLevel, z);
    // flow direction from the river tangent; the pond swirls slowly
    riverInfo(x, z, ri);
    let fx = 0, fz = 0.4;
    if (ri.s >= 0) {
      const pts = data.river.pts;
      const s = ri.s;
      const len = data.river.field.len;
      let lo = 0, hi = len.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < s) lo = m; else hi = m; }
      const a = pts[lo], b = pts[Math.min(lo + 1, pts.length - 1)];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const spd = THREE.MathUtils.clamp(9 / Math.max(ri.hw, 5), 0.3, 1.2);
      fx = ((b[0] - a[0]) / dl) * spd;
      fz = ((b[1] - a[1]) / dl) * spd;
    }
    const pd = Math.hypot(x - POND.x, z - POND.z);
    if (pd < 60) {
      const k2 = 1 - THREE.MathUtils.smoothstep(pd, 25, 60);
      const sw = 0.25;
      fx = THREE.MathUtils.lerp(fx, -(z - POND.z) / (pd + 1) * sw + 0.05, k2);
      fz = THREE.MathUtils.lerp(fz, (x - POND.x) / (pd + 1) * sw + 0.2, k2);
    }
    flows.push(fx, fz);
    vmap[k] = positions.length / 3 - 1;
    return vmap[k];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
      // cheap reject far from the river corridor
      if (waterSdf(x, z) > 3.5) continue;
      const a = getV(i, j), b = getV(i + 1, j), c = getV(i, j + 1), d = getV(i + 1, j + 1);
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('flow', new THREE.Float32BufferAttribute(flows, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const waterN = createWaterNormalTexture(256);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uWaterN: { value: waterN },
      uRefl: { value: null },
      uReflMat: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      uDeep: { value: new THREE.Color(0.012, 0.05, 0.045) },
      uShallow: { value: new THREE.Color(0.09, 0.14, 0.09) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.layers.set(REFLECT_LAYER);
  mesh.renderOrder = 60;
  mesh.frustumCulled = false;
  return mesh;
}

/** Planar reflection camera + render target for the water surface. */
export class Reflection {
  constructor(renderer, scene, waterMesh) {
    this.renderer = renderer;
    this.scene = scene;
    this.water = waterMesh;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.set(0);
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.scale = 0.5;
    this.enabled = true;
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.stats = { calls: 0, triangles: 0 };
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }

  setSize(w, h) {
    const s = this.scale;
    this.rt.setSize(Math.max(16, Math.round(w * s)), Math.max(16, Math.round(h * s)));
  }

  update(camera) {
    const u = this.water.material.uniforms;
    this.stats.calls = this.stats.triangles = 0;
    if (!this.enabled) { u.uReflOn.value = 0; return; }
    // skip when no water is in view
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    if (!this.frustum.intersectsBox(this.water.geometry.boundingBox)) { u.uReflOn.value = 0; return; }
    const WL = WORLD.waterLevel;
    const cam = this.cam;
    cam.copy(camera, false);
    cam.layers.set(0);
    // mirror the camera about the plane y = WL
    const p = camera.position;
    cam.position.set(p.x, 2 * WL - p.y, p.z);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    cam.rotation.set(-e.x, e.y, -e.z, 'YXZ');
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // flip x handled by sampling with the reflected camera's own matrix
    u.uReflMat.value.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const r = this.renderer;
    const prev = r.getRenderTarget();
    U.uClipWater.value = 1;
    r.setRenderTarget(this.rt);
    r.clear();
    const c0 = r.info.render.calls, t0 = r.info.render.triangles;
    r.render(this.scene, cam);
    this.stats.calls = r.info.render.calls - c0;
    this.stats.triangles = r.info.render.triangles - t0;
    U.uClipWater.value = 0;
    r.setRenderTarget(prev);
    u.uRefl.value = this.rt.texture;
    u.uReflOn.value = 1;
  }
}

export { waterSdf };
