import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars, fogPars, lightingPars, windPars } from '../render/shaders/lib.js';
import { mulberry32 } from '../core/math.js';
import { loadTexture } from '../render/textures.js';
import { CLEARINGS, LANDMARKS } from '../world/layout.js';
import { REFLECT_LAYER } from '../world/water.js';

// ---------------------------------------------------------------------------
// Birds
const birdVert = /* glsl */ `
${commonPars}
attribute vec2 aWing;  // x: distance along the wing (0 body .. 1 tip), y: side
attribute vec4 aBird;  // x phase, y flap speed, z glide mix, w scale
varying vec3 vWp;
varying vec3 vN;
varying float vW;
void main() {
  vec3 p = position * aBird.w;
  float glide = smoothstep(0.2, 0.8, sin(uTime * 0.35 + aBird.x * 3.0) * 0.5 + 0.5) * aBird.z;
  float flap = sin(uTime * aBird.y + aBird.x * 6.2831);
  float a = mix(flap * 0.9, 0.12, glide);
  float k = aWing.x;
  p.y += sin(a) * k * 0.5 * aBird.w + k * k * 0.05 * aBird.w * (1.0 - glide);
  p.x *= mix(1.0, cos(a), k * 0.5);
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vWp = wp.xyz;
  vN = normalize(mat3(modelMatrix * im) * vec3(0.0, 1.0, 0.0));
  vW = k;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const birdFrag = /* glsl */ `
${commonPars}
${fogPars}
${lightingPars}
${shadowPars}
varying vec3 vWp;
varying vec3 vN;
varying float vW;
void main() {
  vec3 alb = mix(vec3(0.05, 0.045, 0.04), vec3(0.18, 0.16, 0.14), vW);
  vec3 V = normalize(cameraPosition - vWp);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  Surf s = surfDefault(styleAlbedo(alb, alb), N);
  s.wrap = 0.5;
  vec3 col = shade(s, vWp, V, 1.0);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

function birdGeometry() {
  // body diamond + two swept wings (local: +z forward, +x left)
  const P = [], W = [], I = [];
  const v = (x, y, z, k, s) => { P.push(x, y, z); W.push(k, s); return P.length / 3 - 1; };
  const b0 = v(0, 0, 0.32, 0, 0), b1 = v(0.06, 0.02, 0, 0, 0), b2 = v(0, 0, -0.3, 0, 0), b3 = v(-0.06, 0.02, 0, 0, 0), b4 = v(0, -0.04, 0, 0, 0);
  I.push(b0, b1, b2, b0, b2, b3, b0, b4, b1, b0, b3, b4);
  for (const s of [1, -1]) {
    const r0 = v(s * 0.04, 0.02, 0.1, 0, s), r1 = v(s * 0.04, 0.02, -0.12, 0, s);
    const m0 = v(s * 0.4, 0.03, 0.06, 0.5, s), m1 = v(s * 0.4, 0.03, -0.16, 0.5, s);
    const t0 = v(s * 0.78, 0.0, -0.12, 1, s);
    I.push(r0, m0, r1, r1, m0, m1, m0, t0, m1);
  }
  // tail
  const t1 = v(0.07, 0, -0.42, 0.2, 0), t2 = v(-0.07, 0, -0.42, 0.2, 0);
  I.push(b2, t1, t2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 2));
  g.setIndex(I);
  return g;
}

// ---------------------------------------------------------------------------
// Chimney smoke (camera-facing puffs)
const smokeVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aPuff;  // xyz chimney, w seed
uniform float uRate;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWp;
varying float vAge;
void main() {
  float age = fract(uTime * uRate + aPuff.w);
  vec3 base = aPuff.xyz;
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * (age * age * 9.0 + age * 2.0) * uWind.z;
  float wob = sin(uTime * 0.7 + aPuff.w * 30.0) * 0.6 * age;
  vec3 c = base + vec3(0.0, age * 7.5, 0.0) + drift + vec3(wob, 0.0, -wob * 0.5);
  float size = mix(0.35, 3.2, sqrt(age));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = aPuff.w * 6.28 + age * 1.5;
  vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
  vec3 wp = c + (right * q.x + up * q.y) * size;
  vWp = wp;
  vUv = position.xy + 0.5;
  vAge = age;
  vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const smokeFrag = /* glsl */ `
${commonPars}
${fogPars}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWp;
varying float vAge;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float n = noise4(vUv * 0.7 + vAge * 0.3 + vWp.xz * 0.01).g;
  float a = (1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.5)) * vAlpha * 0.32;
  if (uStyle == 3) a = step(0.6, (1.0 - r) + (n - 0.5) * 0.3) * vAlpha * 0.85;
  if (uStyle == 2) a = smoothstep(0.45, 0.55, (1.0 - r) + (n - 0.5) * 0.3) * vAlpha * 0.7;
  vec3 lit = uSunColor * 0.16 * (0.6 + 0.4 * (1.0 - p.y)) + mix(uGroundAmb, uSkyAmb, 0.7) * 0.75;
  vec3 col = mix(lit * vec3(0.92, 0.9, 0.88), lit, vAge);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------------------
// Butterflies + pollen motes + falling leaves (camera-local sprites)
const flyVert = /* glsl */ `
${commonPars}
attribute vec4 aFly;   // xyz home, w seed
attribute float aSide; // wing side (-1, 0 body, 1)
varying vec2 vUv;
varying vec3 vWp;
varying vec3 vCol;
void main() {
  float s = aFly.w;
  float t = uTime * (0.6 + fract(s * 7.0) * 0.5) + s * 50.0;
  vec3 home = aFly.xyz;
  vec3 c = home + vec3(sin(t * 0.7) * 2.5 + sin(t * 1.9) * 0.8, 0.6 + sin(t * 1.3) * 0.35 + sin(t * 4.1) * 0.08, cos(t * 0.53) * 2.5 + cos(t * 2.3) * 0.7);
  vec3 vel = vec3(cos(t * 0.7) * 1.75, 0.0, -sin(t * 0.53) * 1.3);
  float yaw = atan(vel.x, vel.z);
  float flap = sin(uTime * 22.0 + s * 40.0) * 1.1;
  vec3 p = position;
  float side = aSide;
  float ang = side * flap;
  p = vec3(p.x * cos(ang), abs(p.x) * sin(abs(ang)) * 1.0, p.z);
  float cy = cos(yaw), sy = sin(yaw);
  p.xz = mat2(cy, sy, -sy, cy) * p.xz;
  vec3 wp = c + p * 0.07;
  vWp = wp;
  vUv = uv;
  float k = fract(s * 13.7);
  vCol = k < 0.33 ? vec3(0.95, 0.93, 0.85) : k < 0.66 ? vec3(0.95, 0.75, 0.15) : vec3(0.9, 0.42, 0.08);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const flyFrag = /* glsl */ `
${commonPars}
${fogPars}
varying vec2 vUv;
varying vec3 vWp;
varying vec3 vCol;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float wing = 1.0 - smoothstep(0.85, 1.0, length(q * vec2(0.8, 1.0)));
  if (wing < 0.5) discard;
  vec3 alb = styleAlbedo(vCol, vCol);
  vec3 col = alb * (uSunColor * 0.45 + uSkyAmb * 0.8);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

const moteVert = /* glsl */ `
${commonPars}
attribute vec4 aMote;
uniform vec3 uCenter;
varying float vA;
varying vec3 vWp;
varying vec2 vQ;
void main() {
  vQ = position.xy * 2.0;
  float R = 14.0;
  vec3 o = aMote.xyz * 2.0 * R;
  o += vec3(sin(uTime * 0.13 + aMote.w * 20.0), sin(uTime * 0.21 + aMote.w * 11.0) * 0.6, cos(uTime * 0.17 + aMote.w * 7.0)) * 1.5;
  o.y += uTime * 0.05 * (0.5 + aMote.w);
  vec3 base = uCenter - R;
  vec3 wp = base + mod(o - base, 2.0 * R);
  wp.y = uCenter.y - 4.0 + mod(o.y - (uCenter.y - 4.0), 10.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = 0.012 + 0.01 * aMote.w;
  wp += (right * position.x + up * position.y) * size;
  vWp = wp;
  vec3 toCam = normalize(cameraPosition - wp);
  // motes glint when backlit by the sun
  float back = pow(max(dot(-toCam, uSunDir), 0.0), 3.0);
  float dist = length(cameraPosition - wp);
  vA = (0.03 + back * 1.4) * smoothstep(14.0, 4.0, dist) * smoothstep(0.3, 1.2, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const moteFrag = /* glsl */ `
${commonPars}
varying float vA;
varying vec3 vWp;
varying vec2 vQ;
void main() {
  // soft round speck, not a quad
  float r = length(vQ);
  float k = 1.0 - smoothstep(0.2, 1.0, r);
  vec3 c = uSunColor * 0.35 * vA * k * k;
  gl_FragColor = vec4(c, 1.0);
}
`;

const leafVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aLeaf;
uniform vec3 uCenter;
uniform sampler2D uHeightTex;
varying vec2 vUv;
varying vec3 vWp;
varying vec3 vN;
varying float vSel;
void main() {
  float R = 18.0;
  float s = aLeaf.w;
  float fallT = fract(uTime * (0.045 + 0.03 * fract(s * 9.0)) + s);
  vec2 o = aLeaf.xz * 2.0 * R + vec2(uWind.x, uWind.y) * uTime * 0.5;
  vec2 base = uCenter.xz - R;
  vec2 xz = base + mod(o - base, 2.0 * R);
  float ground = texture(uHeightTex, (xz + uWorld.x) / (2.0 * uWorld.x)).r;
  float y = ground + mix(14.0, 0.0, fallT);
  xz += vec2(sin(uTime * 1.3 + s * 30.0), cos(uTime * 1.1 + s * 20.0)) * 0.8;
  float spin = uTime * (2.0 + 3.0 * fract(s * 5.0)) + s * 10.0;
  vec3 p = position;
  float c1 = cos(spin), s1 = sin(spin);
  p = vec3(p.x * c1, p.y * 0.7 + p.x * s1 * 0.6, p.y * 0.7 * s1 + p.z);
  vec3 wp = vec3(xz.x, y, xz.y) + p * 0.09;
  vWp = wp;
  vUv = uv;
  vN = normalize(vec3(s1, c1, 0.3));
  vSel = floor(fract(s * 3.3) * 4.0);
  float fade = smoothstep(0.0, 0.05, fallT) * smoothstep(1.0, 0.92, fallT);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (fade < 0.01) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
}
`;
const leafFrag2 = /* glsl */ `
${commonPars}
${fogPars}
${lightingPars}
uniform sampler2D uLeafTex;
varying vec2 vUv;
varying vec3 vWp;
varying vec3 vN;
varying float vSel;
void main() {
  vec2 cell = vec2(mod(vSel, 4.0), floor(vSel / 4.0));
  vec2 uv = (cell + vUv) * vec2(0.25, 0.25) + vec2(0.0, 0.0);
  vec4 t = texture(uLeafTex, uv);
  if (t.a < 0.5) discard;
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(styleAlbedo(t.rgb, t.rgb * 0.9), normalize(vN));
  s.trans = 0.6; s.wrap = 0.5;
  vec3 col = shade(s, vWp, V, 1.0);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
export async function createAmbient(ctx, village) {
  const { scene, data } = ctx;
  const rand = mulberry32(1234);
  const group = new THREE.Group();
  group.name = 'ambient';

  // ---- birds: three flocks circling the valley
  const flocks = [
    { c: [40, 70, -60], r: 70, n: 9, speed: 0.11 },
    { c: [-160, 85, -40], r: 95, n: 7, speed: -0.08 },
    { c: [200, 95, 120], r: 120, n: 8, speed: 0.07 },
  ];
  const birds = [];
  for (const f of flocks) for (let i = 0; i < f.n; i++) birds.push({ f, off: (i / f.n) * 0.9 + rand() * 0.3, rr: (rand() - 0.5) * 20, h: (rand() - 0.5) * 10, ph: rand() });
  const bg = birdGeometry();
  const aBird = new Float32Array(birds.length * 4);
  birds.forEach((b, i) => { aBird[i * 4] = b.ph; aBird[i * 4 + 1] = 9 + rand() * 4; aBird[i * 4 + 2] = 0.7 + rand() * 0.3; aBird[i * 4 + 3] = 0.9 + rand() * 0.4; });
  bg.setAttribute('aBird', new THREE.InstancedBufferAttribute(aBird, 4));
  const birdMesh = new THREE.InstancedMesh(bg, new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: birdVert, fragmentShader: birdFrag, side: THREE.DoubleSide }), birds.length);
  birdMesh.frustumCulled = false;
  group.add(birdMesh);

  // ---- chimney smoke
  const chim = (village?.chimneys || []).filter((_, i) => i % 2 === 0);
  const P = 14;
  const quad = new THREE.PlaneGeometry(1, 1);
  const aPuff = new Float32Array(chim.length * P * 4);
  chim.forEach((c, k) => { for (let i = 0; i < P; i++) { const o = (k * P + i) * 4; aPuff[o] = c.x; aPuff[o + 1] = c.y; aPuff[o + 2] = c.z; aPuff[o + 3] = i / P + rand() * 0.02; } });
  const smokeGeo = quad.clone();
  smokeGeo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(aPuff, 4));
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uRate: { value: 0.055 } }, vertexShader: smokeVert, fragmentShader: smokeFrag,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, Math.max(1, chim.length * P));
  smoke.count = chim.length * P;
  smoke.frustumCulled = false;
  smoke.renderOrder = 70;
  smoke.layers.set(REFLECT_LAYER);
  group.add(smoke);

  // ---- butterflies around meadows and gardens
  const homes = [];
  for (const c of CLEARINGS) for (let i = 0; i < 6; i++) {
    const a = rand() * 6.28, r = rand() * c.r * 0.6;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    homes.push([x, data.heightAt(x, z), z]);
  }
  for (let i = 0; i < 10; i++) { const x = (rand() - 0.5) * 80, z = (rand() - 0.5) * 80; homes.push([x, data.heightAt(x, z), z]); }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -0.6, 0, 0, -0.6, 0, 0, 0.6, -1, 0, 0.6, 0, 0, -0.6, 1, 0, -0.6, 1, 0, 0.6, 0, 0, 0.6], 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1], 2));
  fg.setAttribute('aSide', new THREE.Float32BufferAttribute([-1, 0, 0, -1, 0, 1, 1, 0], 1));
  fg.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const aFly = new Float32Array(homes.length * 4);
  homes.forEach((h, i) => { aFly[i * 4] = h[0]; aFly[i * 4 + 1] = h[1]; aFly[i * 4 + 2] = h[2]; aFly[i * 4 + 3] = rand(); });
  fg.setAttribute('aFly', new THREE.InstancedBufferAttribute(aFly, 4));
  const flies = new THREE.InstancedMesh(fg, new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: flyVert, fragmentShader: flyFrag, side: THREE.DoubleSide }), homes.length);
  flies.frustumCulled = false;
  flies.layers.set(REFLECT_LAYER);
  group.add(flies);

  // ---- motes
  const NM = 420;
  const aMote = new Float32Array(NM * 4);
  for (let i = 0; i < NM * 4; i++) aMote[i] = rand();
  const mg = quad.clone();
  mg.setAttribute('aMote', new THREE.InstancedBufferAttribute(aMote, 4));
  const moteMat = new THREE.ShaderMaterial({ uniforms: { ...U, uCenter: { value: new THREE.Vector3() } }, vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
  const motes = new THREE.InstancedMesh(mg, moteMat, NM);
  motes.frustumCulled = false;
  motes.layers.set(REFLECT_LAYER);
  motes.renderOrder = 80;
  group.add(motes);

  // ---- falling leaves
  const leafTex = await loadTexture('LeafSet030.webp', { repeat: false });
  const NL = 90;
  const aLeaf = new Float32Array(NL * 4);
  for (let i = 0; i < NL * 4; i++) aLeaf[i] = rand();
  const lg = new THREE.PlaneGeometry(1, 1);
  lg.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(aLeaf, 4));
  const leafMat = new THREE.ShaderMaterial({ uniforms: { ...U, uCenter: { value: new THREE.Vector3() }, uLeafTex: { value: leafTex } }, vertexShader: leafVert, fragmentShader: leafFrag2, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(lg, leafMat, NL);
  leaves.frustumCulled = false;
  leaves.layers.set(REFLECT_LAYER);
  group.add(leaves);

  scene.add(group);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  return {
    name: 'ambient',
    group,
    stats: { birds: birds.length, smokePuffs: smoke.count, chimneysSmoking: chim.length, butterflies: homes.length, motes: NM, leaves: NL },
    birdPositions: () => birds.map((b, i) => { birdMesh.getMatrixAt(i, m4); return new THREE.Vector3().setFromMatrixPosition(m4); }),
    update(dt, time, c) {
      t += dt;
      birds.forEach((b, i) => {
        const f = b.f;
        const a = t * f.speed + b.off * Math.PI * 2;
        const r = f.r + b.rr + Math.sin(t * 0.3 + b.ph * 6) * 8;
        pos.set(f.c[0] + Math.cos(a) * r, f.c[1] + b.h + Math.sin(t * 0.5 + b.ph * 9) * 3, f.c[2] + Math.sin(a) * r * 0.7);
        const tx = -Math.sin(a) * Math.sign(f.speed), tz = Math.cos(a) * 0.7 * Math.sign(f.speed);
        e.set(Math.sin(t * 0.5 + b.ph * 9) * 0.15, Math.atan2(tx, tz), -0.25 * Math.sign(f.speed));
        q.setFromEuler(e);
        m4.compose(pos, q, one);
        birdMesh.setMatrixAt(i, m4);
      });
      birdMesh.instanceMatrix.needsUpdate = true;
      motes.material.uniforms.uCenter.value.copy(c.camera.position);
      leaves.material.uniforms.uCenter.value.copy(c.camera.position);
      // leaves only fall near trees
      const f = data.forestAt(c.camera.position.x, c.camera.position.z);
      leaves.count = Math.round(NL * Math.min(1, 0.15 + f * 1.5));
      void LANDMARKS;
    },
  };
}
