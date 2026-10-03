import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, windPars, shadowPars, fogPars, lightingPars, clipWater } from '../render/shaders/lib.js';
import { mulberry32, createNoise2D, smoothstep } from '../core/math.js';
import { loadTexture } from '../render/textures.js';
import { LANDMARKS, WORLD, POND, HOUSES } from './layout.js';
import { basicDepthMaterial } from '../render/shadows.js';
import { REFLECT_LAYER } from './water.js';

const n3 = createNoise2D(515);

// ---------------------------------------------------------------------------
// Rocks: displaced icospheres, triplanar mossy rock, moss on the upward faces
const rockVert = /* glsl */ `
${commonPars}
attribute float aAo;
varying vec3 vWp;
varying vec3 vN;
varying float vAo;
varying vec3 vObjN;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWp = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vObjN = normal;
  vAo = aAo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const rockFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
uniform sampler2D uRockC;
uniform sampler2D uRockN;
uniform vec3 uRockFlat;
uniform float uMoss;
varying vec3 vWp;
varying vec3 vN;
varying float vAo;
varying vec3 vObjN;
void main() {
  ${clipWater}
  vec3 N = normalize(vN);
  vec3 an = pow(abs(N), vec3(4.0));
  an /= dot(an, vec3(1.0));
  float sc = 0.45;
  vec4 cx = texture(uRockC, vWp.zy * sc), cy = texture(uRockC, vWp.xz * sc), cz = texture(uRockC, vWp.xy * sc);
  vec3 alb = (cx * an.x + cy * an.y + cz * an.z).rgb;
  vec4 nx = texture(uRockN, vWp.zy * sc), ny = texture(uRockN, vWp.xz * sc), nz = texture(uRockN, vWp.xy * sc);
  vec2 t = (nx.xy * an.x + ny.xy * an.y + nz.xy * an.z) * 2.0 - 1.0;
  float rough = nx.b * an.x + ny.b * an.y + nz.b * an.z;
  vec3 Np = normalize(N + vec3(t.x, 0.0, t.y) * 0.6 * uStyleA.x);
  // moss creeping over the tops
  float moss = smoothstep(0.35, 0.8, N.y + (noise4(vWp.xz * 0.6).g - 0.5) * 0.6) * uMoss;
  alb = mix(alb, vec3(0.07, 0.11, 0.03) * (0.8 + 0.4 * noise4(vWp.xz * 2.0).b), moss);
  alb = styleAlbedo(alb, mix(uRockFlat, vec3(0.07, 0.11, 0.03), moss));
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, Np);
  s.ao = vAo; s.rough = mix(rough, 0.9, moss); s.spec = 0.35;
  float sh = sunShadow(vWp, N, dot(N, uSunDir)) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

function rockGeometry(seed, { tall = false, flat = false } = {}) {
  const rand = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, tall ? 4 : 3);
  const p = g.attributes.position;
  const noise = createNoise2D(seed);
  const v = new THREE.Vector3();
  const ao = new Float32Array(p.count);
  const sx = tall ? 0.55 : 0.8 + rand() * 0.5, sy = tall ? 1.0 : flat ? 0.35 : 0.5 + rand() * 0.35, sz = tall ? 0.35 : 0.7 + rand() * 0.5;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise(v.x * 1.3 + v.z * 0.7, v.y * 1.3 - v.z * 0.4) * 0.22 + noise(v.x * 3.1, v.y * 3.1 + v.z) * 0.08 + noise(v.z * 6, v.x * 6) * 0.03;
    // facet planes: quantise a little for a fractured look
    const r = 1 + n;
    v.multiplyScalar(r);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    if (v.y < -0.15 * sy) v.y = -0.15 * sy + (v.y + 0.15 * sy) * 0.25; // sit flat on the ground
    p.setXYZ(i, v.x, v.y, v.z);
    ao[i] = Math.min(1, Math.max(0.35, 0.7 + n * 1.6 + (v.y / sy) * 0.25));
  }
  g.computeVertexNormals();
  g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  g.translate(0, 0.12 * sy, 0);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Reeds (static clumps at the water's edge) and lily pads
const reedVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aReed; // x,z, height, phase
varying vec3 vWp;
varying float vT;
varying float vHead;
uniform sampler2D uHeightTex;
void main() {
  vec3 p = position;
  float t = p.y;
  float H = aReed.z;
  float head = step(0.82, t) * step(0.5, fract(aReed.w * 7.0));
  float yaw = aReed.w * 6.28;
  p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz * (1.0 + head * 3.0);
  p.y *= H;
  vec3 w = windSway(vec3(aReed.x, 0.0, aReed.y), aReed.w * 6.0, 1.4);
  p.xz += w.xz * t * t * H * 0.35;
  float base = texture(uHeightTex, (aReed.xy + uWorld.x) / (2.0 * uWorld.x)).r;
  vec3 wp = vec3(aReed.x, base - 0.1, aReed.y) + p;
  vWp = wp;
  vT = t;
  vHead = head;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const reedFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying float vT;
varying float vHead;
void main() {
  vec3 alb = mix(vec3(0.05, 0.08, 0.025), vec3(0.2, 0.22, 0.07), vT);
  alb = mix(alb, vec3(0.16, 0.08, 0.03), vHead);
  alb = styleAlbedo(alb, alb);
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, normalize(vec3(V.x, 0.4, V.z)));
  s.trans = 0.5; s.wrap = 0.5; s.ao = mix(0.5, 1.0, vT); s.rimK = 0.3; s.spec = 0.2;
  float sh = sunShadow(vWp, vec3(0.0, 1.0, 0.0), 0.7) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

const padFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying vec2 vUv;
varying float vSeed;
void main() {
  ${clipWater}
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  float a = atan(q.y, q.x);
  if (r > 1.0 || (abs(a - vSeed * 6.28 + 3.14) < 0.3 && r > 0.05)) discard;
  vec3 alb = mix(vec3(0.05, 0.13, 0.03), vec3(0.11, 0.2, 0.05), r);
  float flower = (1.0 - smoothstep(0.18, 0.22, length(q - vec2(0.25, 0.1)))) * step(0.75, fract(vSeed * 13.0));
  alb = mix(alb, vec3(0.95, 0.8, 0.85), flower);
  alb = styleAlbedo(alb, alb);
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, vec3(0.0, 1.0, 0.0));
  s.rough = 0.35; s.spec = 0.6;
  float sh = sunShadow(vWp, vec3(0.0, 1.0, 0.0), 0.8) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;
const padVert = /* glsl */ `
${commonPars}
attribute vec4 aPad;
varying vec3 vWp;
varying vec2 vUv;
varying float vSeed;
void main() {
  float s = aPad.z;
  float a = aPad.w * 6.28 + sin(uTime * 0.3 + aPad.w * 20.0) * 0.08;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xz * s;
  vec3 wp = vec3(aPad.x + p.x, uWorld.y + 0.012 + sin(uTime * 0.8 + aPad.w * 9.0) * 0.004, aPad.y + p.y);
  vWp = wp;
  vUv = uv;
  vSeed = aPad.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// ---------------------------------------------------------------------------
export async function createDetails(ctx) {
  const { scene, data, shadows } = ctx;
  const [rockC, rockN, barkC, barkN] = await Promise.all([
    loadTexture('mossy_rock_c.webp'), loadTexture('mossy_rock_n.webp', { srgb: false }),
    loadTexture('bark_brown_02_c.webp'), loadTexture('bark_brown_02_n.webp', { srgb: false }),
  ]);
  const rand = mulberry32(4242);
  const group = new THREE.Group();
  group.name = 'details';
  const colliders = [];
  const half = WORLD.half - 8;
  const clearOfHouses = (x, z, m) => !HOUSES.some((h) => Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.7 + m);

  // ---- rocks
  const variants = [0, 1, 2, 3, 4].map((k) => rockGeometry(100 + k));
  const flatV = rockGeometry(150, { flat: true });
  const tallV = rockGeometry(170, { tall: true });
  const rockMat = new THREE.ShaderMaterial({ uniforms: { ...U, uRockC: { value: rockC }, uRockN: { value: rockN }, uRockFlat: { value: new THREE.Vector3(0.18, 0.18, 0.15) }, uMoss: { value: 1 } }, vertexShader: rockVert, fragmentShader: rockFrag });
  const placements = variants.map(() => []);
  const flatP = [], tallP = [];
  const tryRock = (x, z, s, list, { minWater = 0.6 } = {}) => {
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (data.waterSdf(x, z) < minWater) return false;
    if (data.maskAAt(x, z, 0) > 0.3 || data.maskAAt(x, z, 1) > 0.1 || data.maskBAt(x, z, 2) > 0.2 || data.maskBAt(x, z, 0) > 0.1) return false;
    if (!clearOfHouses(x, z, 2)) return false;
    const y = data.heightAt(x, z) - s * 0.12;
    list.push({ x, y, z, s, r: rand() * 6.28, tilt: (rand() - 0.5) * 0.25 });
    if (s > 0.9) colliders.push({ x, z, r: s * 0.75 });
    return true;
  };
  // hillside & forest boulders
  for (let i = 0; i < 9000 && placements.flat().length < 900; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const slope = data.slopeAt(x, z);
    const f = data.forestAt(x, z);
    const p = 0.02 + slope * 0.35 + f * 0.12 + smoothstep(0.55, 0.85, n3(x / 70, z / 70) * 0.5 + 0.5) * 0.25;
    if (rand() > p) continue;
    const big = rand() < 0.12;
    const s = big ? 1.4 + rand() * 1.8 : 0.35 + rand() * 0.8;
    tryRock(x, z, s, placements[Math.floor(rand() * placements.length)]);
    // small companions
    if (rand() < 0.5) for (let k = 0; k < 3; k++) tryRock(x + (rand() - 0.5) * s * 3, z + (rand() - 0.5) * s * 3, s * (0.2 + rand() * 0.3), placements[Math.floor(rand() * placements.length)]);
  }
  // riverbank stones
  for (let i = 0; i < 6000 && flatP.length < 380; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const w = data.waterSdf(x, z);
    if (w < -0.5 || w > 2.5 || rand() > 0.5) continue;
    tryRock(x, z, 0.25 + rand() * 0.6, flatP, { minWater: -0.6 });
  }
  // path-side stones
  for (const pf of data.pathFields) {
    for (let k = 0; k < pf.pts.length; k += 3) {
      if (rand() > 0.12) continue;
      const [px, pz] = pf.pts[k];
      const a = rand() * 6.28;
      const d = pf.width * 0.5 + 0.8 + rand() * 1.5;
      tryRock(px + Math.cos(a) * d, pz + Math.sin(a) * d, 0.18 + rand() * 0.35, placements[Math.floor(rand() * placements.length)]);
    }
  }
  // the standing stones: a broken circle on the hill
  {
    const { x: cx, z: cz } = LANDMARKS.stones;
    const N = 11;
    for (let i = 0; i < N; i++) {
      if (i === 3 || i === 8) continue; // fallen gaps
      const a = (i / N) * Math.PI * 2;
      const x = cx + Math.cos(a) * 9.5, z = cz + Math.sin(a) * 9.5;
      tallP.push({ x, y: data.heightAt(x, z) - 0.4, z, s: 1.9 + rand() * 0.9, r: -a + Math.PI / 2, tilt: (rand() - 0.5) * 0.12 });
      colliders.push({ x, z, r: 0.9 });
    }
    // fallen stones and the altar
    for (const [a, r] of [[(3 / N) * 6.28, 10.5], [(8 / N) * 6.28, 11]]) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      flatP.push({ x, y: data.heightAt(x, z) - 0.2, z, s: 2.0, r: a, tilt: 0 });
    }
    flatP.push({ x: cx, y: data.heightAt(cx, cz) - 0.1, z: cz, s: 1.6, r: 0.3, tilt: 0 });
    colliders.push({ x: cx, z: cz, r: 1.4 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const makeInst = (geo, list, name) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, rockMat, list.length);
    list.forEach((r, i) => {
      e.set(r.tilt, r.r, r.tilt * 0.6);
      q.setFromEuler(e);
      pos.set(r.x, r.y, r.z);
      sc.setScalar(r.s);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(i, m4);
    });
    mesh.computeBoundingSphere();
    mesh.name = name;
    shadows.addCaster(mesh, basicDepthMaterial());
    group.add(mesh);
    return mesh;
  };
  variants.forEach((g, k) => makeInst(g, placements[k], `rocks-${k}`));
  makeInst(flatV, flatP, 'rocks-flat');
  makeInst(tallV, tallP, 'standing-stones');

  // ---- fallen logs and stumps (bark)
  const logMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uRockC: { value: barkC }, uRockN: { value: barkN }, uRockFlat: { value: new THREE.Vector3(0.16, 0.12, 0.09) }, uMoss: { value: 1.4 } },
    vertexShader: rockVert, fragmentShader: rockFrag,
  });
  const logGeo = new THREE.CylinderGeometry(0.28, 0.32, 1, 12, 4, false);
  logGeo.rotateZ(Math.PI / 2);
  logGeo.setAttribute('aAo', new THREE.BufferAttribute(new Float32Array(logGeo.attributes.position.count).fill(0.85), 1));
  const stumpGeo = new THREE.CylinderGeometry(0.3, 0.42, 0.6, 12, 2, false);
  stumpGeo.translate(0, 0.25, 0);
  stumpGeo.setAttribute('aAo', new THREE.BufferAttribute(new Float32Array(stumpGeo.attributes.position.count).fill(0.85), 1));
  const logs = [], stumps = [];
  for (let i = 0; i < 20000 && (logs.length < 140 || stumps.length < 160); i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const f = data.forestAt(x, z);
    if (f < 0.4 || rand() > 0.06) continue;
    if (data.maskAAt(x, z, 0) > 0.2 || data.waterSdf(x, z) < 2) continue;
    const y = data.heightAt(x, z);
    if (rand() < 0.5 && logs.length < 140) {
      const len = 3 + rand() * 5, r = 0.7 + rand() * 0.6;
      logs.push({ x, y: y + 0.18 * r, z, r: rand() * 6.28, len, s: r });
    } else if (stumps.length < 160) stumps.push({ x, y: y - 0.05, z, r: rand() * 6.28, s: 0.7 + rand() * 0.7 });
  }
  if (logs.length) {
    const mesh = new THREE.InstancedMesh(logGeo, logMat, logs.length);
    logs.forEach((l, i) => { q.setFromEuler(e.set(0, l.r, (rand() - 0.5) * 0.08)); m4.compose(pos.set(l.x, l.y, l.z), q, sc.set(l.len, l.s, l.s)); mesh.setMatrixAt(i, m4); });
    mesh.computeBoundingSphere();
    shadows.addCaster(mesh, basicDepthMaterial());
    group.add(mesh);
  }
  if (stumps.length) {
    const mesh = new THREE.InstancedMesh(stumpGeo, logMat, stumps.length);
    stumps.forEach((l, i) => { q.setFromEuler(e.set(0, l.r, 0)); m4.compose(pos.set(l.x, l.y, l.z), q, sc.setScalar(l.s)); mesh.setMatrixAt(i, m4); colliders.push({ x: l.x, z: l.z, r: 0.45 * l.s }); });
    mesh.computeBoundingSphere();
    shadows.addCaster(mesh, basicDepthMaterial());
    group.add(mesh);
  }

  // ---- mushrooms near logs and stumps
  {
    const capGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.scale(1, 0.55, 1);
    capGeo.translate(0, 1, 0);
    const stemGeo = new THREE.CylinderGeometry(0.35, 0.42, 1, 6);
    stemGeo.translate(0, 0.5, 0);
    for (const g of [capGeo, stemGeo]) g.setAttribute('aAo', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(0.9), 1));
    const spots = [];
    for (const l of [...logs, ...stumps]) {
      if (rand() > 0.5) continue;
      for (let k = 0; k < 4; k++) {
        const x = l.x + (rand() - 0.5) * 1.6, z = l.z + (rand() - 0.5) * 1.6;
        spots.push([x, data.heightAt(x, z), z, 0.05 + rand() * 0.05, rand() < 0.3]);
      }
    }
    const flatMat = (col) => new THREE.ShaderMaterial({ uniforms: { ...U, uRockC: { value: rockC }, uRockN: { value: rockN }, uRockFlat: { value: new THREE.Vector3(...col) }, uMoss: { value: 0 } }, vertexShader: rockVert, fragmentShader: rockFrag });
    const capMesh = new THREE.InstancedMesh(capGeo, flatMat([0.45, 0.1, 0.05]), spots.length);
    const stemMesh = new THREE.InstancedMesh(stemGeo, flatMat([0.7, 0.66, 0.55]), spots.length);
    spots.forEach((s, i) => {
      m4.compose(pos.set(s[0], s[1], s[2]), q.identity(), sc.set(s[3], s[3] * 1.4, s[3]));
      capMesh.setMatrixAt(i, m4);
      stemMesh.setMatrixAt(i, m4);
    });
    // mushrooms read better as flat colour: force the flat look regardless of the style detail
    for (const m of [capMesh, stemMesh]) {
      m.material.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('vec3 alb = (cx * an.x + cy * an.y + cz * an.z).rgb;', 'vec3 alb = uRockFlat * (0.85 + 0.3 * noise4(vWp.xz * 9.0).g);'); };
      m.computeBoundingSphere();
      group.add(m);
    }
  }

  // ---- reeds along the banks
  {
    const reeds = [];
    for (let i = 0; i < 400000 && reeds.length < 9000 * 4; i++) {
      const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
      const w = data.waterSdf(x, z);
      if (w < -1.2 || w > 0.8) continue;
      if (n3(x / 18, z / 18) < 0.1) continue;
      if (Math.abs(x - 90) < 16 && Math.abs(z + 12) < 8) continue; // keep the bridge clear
      const clump = 6 + Math.floor(rand() * 10);
      for (let k = 0; k < clump; k++) reeds.push(x + (rand() - 0.5) * 1.2, z + (rand() - 0.5) * 1.2, 1.1 + rand() * 0.9, rand());
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, 0, 0, 0.012, 0, 0, 0.008, 0.82, 0, -0.008, 0.82, 0, -0.016, 0.82, 0, 0.016, 0.82, 0, 0.01, 1.0, 0, -0.01, 1.0, 0], 3));
    rg.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    rg.setAttribute('aReed', new THREE.InstancedBufferAttribute(new Float32Array(reeds), 4));
    const reedMat = new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: reedVert, fragmentShader: reedFrag, side: THREE.DoubleSide });
    const reedMesh = new THREE.InstancedMesh(rg, reedMat, reeds.length / 4);
    reedMesh.frustumCulled = false;
    reedMesh.layers.set(REFLECT_LAYER);
    group.add(reedMesh);
  }

  // ---- lily pads on the pond
  {
    const pads = [];
    for (let i = 0; i < 3000 && pads.length < 160 * 4; i++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 34;
      const x = POND.x + Math.cos(a) * r * 1.2, z = POND.z + Math.sin(a) * r;
      if (data.waterSdf(x, z) > -2 || data.waterSdf(x, z) < -14) continue;
      if (n3(x / 14 + 3, z / 14) < 0.05) continue;
      pads.push(x, z, 0.25 + rand() * 0.25, rand());
    }
    const pg = new THREE.CircleGeometry(1, 14);
    pg.rotateX(-Math.PI / 2);
    pg.setAttribute('aPad', new THREE.InstancedBufferAttribute(new Float32Array(pads), 4));
    const padMesh = new THREE.InstancedMesh(pg, new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: padVert, fragmentShader: padFrag, side: THREE.DoubleSide }), pads.length / 4);
    padMesh.frustumCulled = false;
    padMesh.renderOrder = 61;
    group.add(padMesh);
  }

  scene.add(group);
  const rocksTotal = placements.reduce((a, l) => a + l.length, 0) + flatP.length + tallP.length;
  return {
    name: 'details',
    group,
    stats: { rocks: rocksTotal, standingStones: tallP.length, logs: logs.length, stumps: stumps.length },
    collide(x, z, r) {
      let px = 0, pz = 0, hit = false;
      for (const c of colliders) {
        const dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx) > c.r + r || Math.abs(dz) > c.r + r) continue;
        const d = Math.hypot(dx, dz);
        const m = c.r + r;
        if (d < m && d > 1e-4) { px += (dx / d) * (m - d); pz += (dz / d) * (m - d); hit = true; }
      }
      return hit ? [px, pz] : null;
    },
  };
}
