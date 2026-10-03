import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, windPars, shadowPars, fogPars, lightingPars, grassPars } from '../render/shaders/lib.js';
import { mulberry32 } from '../core/math.js';
import { FIELDS } from '../world/layout.js';
import { REFLECT_LAYER } from '../world/water.js';

const fieldPars = /* glsl */ `
uniform vec3 uCenter;
uniform float uR;
uniform float uInner;   // radius handled by an inner (denser) field
uniform float uDensity;
uniform sampler2D uHeightTex;
uniform sampler2D uTerrainNormalTex;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
vec2 worldUV(vec2 xz) { return (xz + uWorld.x) / (2.0 * uWorld.x); }
float heightAt(vec2 xz) { return texture(uHeightTex, worldUV(xz)).r; }
vec2 wrapPos(vec2 o) {
  vec2 base = uCenter.xz - uR;
  return base + mod(o - base, 2.0 * uR);
}
// 0..1 how much natural ground cover a spot supports
float groundCover(vec2 xz, out vec4 mA, out vec4 mB, out vec3 tn) {
  vec2 uv = worldUV(xz);
  mA = texture(uMaskA, uv);
  mB = texture(uMaskB, uv);
  tn = normalize(texture(uTerrainNormalTex, uv).xyz * 2.0 - 1.0);
  float d = 1.0;
  d *= 1.0 - smoothstep(0.22, 0.55, mA.r);
  d *= 1.0 - smoothstep(0.15, 0.45, mA.g);
  d *= 1.0 - smoothstep(0.12, 0.45, mB.b);
  d *= 1.0 - smoothstep(0.1, 0.4, mB.r);
  d *= smoothstep(0.62, 0.8, tn.y);
  if (any(lessThan(uv, vec2(0.002))) || any(greaterThan(uv, vec2(0.998)))) d = 0.0;
  return d;
}
`;

// ---------------------------------------------------------------------------
const grassVert = /* glsl */ `
${commonPars}
${windPars}
${grassPars}
${fieldPars}
attribute vec4 aOff;
uniform float uWidth;
uniform float uHeight;
varying vec3 vWp;
varying vec3 vN;
varying float vT;
varying vec3 vCol;
varying float vSide;
void main() {
  vec2 xz = wrapPos(aOff.xy);
  float r1 = hash12(floor(xz * 13.7) + aOff.z * 17.0);
  float r2 = hash12(xz * 1.37 + 3.1);
  float r3 = hash12(xz * 2.71 - 7.7);
  vec4 mA, mB; vec3 tn;
  float dens = groundCover(xz, mA, mB, tn) * uDensity;
  dens *= mix(1.0, 0.22, smoothstep(0.35, 0.8, mA.b));
  float h0 = heightAt(xz);
  dens *= smoothstep(uWorld.y + 0.05, uWorld.y + 0.5, h0);
  float d = distance(xz, cameraPosition.xz);
  float fade = 1.0 - smoothstep(uR * 0.62, uR * 0.97, d);
  if (uInner > 0.0) fade *= smoothstep(uInner * 0.6, uInner * 0.98, d);
  if (r1 > dens * fade) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }

  float worn = mB.a;
  float meadow = smoothstep(0.45, 0.75, fbmTex(xz * 0.0037));
  float H = mix(0.32, 0.8, r2 * r2) * (1.0 - worn * 0.5) * (0.85 + meadow * 0.45 + mA.a * 0.3) * uHeight;
  H *= mix(1.0, 0.55, smoothstep(0.35, 0.8, mA.b));
  float W = mix(0.035, 0.07, r3) * uWidth;
  float t = position.y;
  float yaw = r3 * 43.98;
  vec2 fdir = vec2(cos(yaw), sin(yaw));
  vec2 sdir = vec2(-fdir.y, fdir.x);
  vec3 wv = windSway(vec3(xz.x, 0.0, xz.y), r1 * 6.2831, 1.7);
  float lean = (r2 - 0.25) * 0.7;
  vec2 bend = (fdir * lean + wv.xz * 0.85) * t * t * H;
  float bl = length(bend);
  float y = max(t * H - bl * bl / max(H * 1.6, 0.1), t * H * 0.25);
  float w = W * (1.0 - t * 0.92);
  vec3 wp = vec3(xz.x + sdir.x * position.x * w + bend.x, h0 + y - 0.02, xz.y + sdir.y * position.x * w + bend.y);
  vec3 bn = normalize(vec3(fdir.x, 0.35, fdir.y) + vec3(sdir.x, 0.0, sdir.y) * position.x * 1.5);
  vN = normalize(mix(bn, tn, 0.6));
  vT = t;
  vSide = position.x;
  vec3 c = grassBase(xz) * (0.78 + 0.45 * r2);
  c = mix(c, c * vec3(1.2, 1.12, 0.75), worn * 0.35 + meadow * 0.1);
  c = mix(c, vec3(0.05, 0.075, 0.025), smoothstep(0.35, 0.8, mA.b) * 0.6);
  vCol = c;
  vWp = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const grassFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying vec3 vN;
varying float vT;
varying vec3 vCol;
varying float vSide;
void main() {
  vec3 alb = vCol * mix(0.42, 1.22, vT);
  alb = mix(alb, alb * vec3(1.25, 1.18, 0.7), vT * vT * 0.55);
  vec3 flatC = vCol * 0.95;
  alb = styleAlbedo(alb, mix(flatC, flatC * 1.25, step(0.55, vT) * 0.0 + vT * 0.35));
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, N);
  s.ao = mix(0.35, 1.0, smoothstep(0.0, 0.7, vT));
  s.trans = 0.55;
  s.wrap = 0.5;
  s.rough = 0.55;
  s.spec = 0.4;
  float sh = sunShadow(vWp, vec3(0.0, 1.0, 0.0), 0.8) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
const flowerVert = /* glsl */ `
${commonPars}
${windPars}
${fieldPars}
attribute vec4 aOff;
attribute vec3 aPart; // x: 0 stem / 1 head, y,z head-local uv
varying vec3 vWp;
varying vec3 vN;
varying vec3 vPart;
varying vec3 vCol;
varying float vKind;
void main() {
  vec2 xz = wrapPos(aOff.xy);
  float r1 = hash12(floor(xz * 9.1) + aOff.z * 11.0);
  float r2 = hash12(xz * 3.17 + 1.3);
  float r3 = hash12(xz * 5.71 - 2.7);
  vec4 mA, mB; vec3 tn;
  float dens = groundCover(xz, mA, mB, tn);
  dens *= (mA.a * 1.1 + 0.03) * uDensity;
  dens *= 1.0 - smoothstep(0.3, 0.7, mA.b);
  float h0 = heightAt(xz);
  dens *= smoothstep(uWorld.y + 0.3, uWorld.y + 0.8, h0);
  float d = distance(xz, cameraPosition.xz);
  dens *= 1.0 - smoothstep(uR * 0.6, uR * 0.97, d);
  if (r1 > dens) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float H = mix(0.22, 0.55, r2);
  float yaw = r3 * 31.4;
  vec3 wv = windSway(vec3(xz.x, 0.0, xz.y), r1 * 6.2831, 2.1);
  vec3 p = position;
  float k = r3;
  float kind = floor(k * 5.0);
  float headS = mix(0.07, 0.12, r2) * (kind == 3.0 ? 1.5 : 1.0);
  if (aPart.x > 0.5) p.xz *= headS / 0.1; else p.x *= 0.6;
  p.y *= H;
  float cy = cos(yaw), sy = sin(yaw);
  p.xz = mat2(cy, -sy, sy, cy) * p.xz;
  float t = position.y;
  p.xz += wv.xz * t * t * H * 0.9;
  vec3 wp = vec3(xz.x, h0, xz.y) + p;
  vWp = wp;
  vN = aPart.x > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(vec3(cy, 0.3, sy));
  vPart = aPart;
  vKind = kind;
  // palette: white daisy, buttercup, cornflower, poppy, purple clover
  vec3 cols[5] = vec3[5](vec3(0.9, 0.9, 0.85), vec3(0.95, 0.72, 0.05), vec3(0.18, 0.32, 0.9), vec3(0.85, 0.08, 0.03), vec3(0.6, 0.25, 0.75));
  vCol = cols[int(kind)];
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const flowerFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying vec3 vN;
varying vec3 vPart;
varying vec3 vCol;
varying float vKind;
void main() {
  vec3 alb;
  if (vPart.x > 0.5) {
    vec2 q = vPart.yz * 2.0 - 1.0;
    float r = length(q);
    float a = atan(q.y, q.x);
    float petals = vKind == 2.0 ? 8.0 : vKind == 3.0 ? 4.0 : 6.0;
    float edge = 0.62 + 0.38 * abs(cos(a * petals * 0.5));
    if (r > edge) discard;
    float centre = 1.0 - smoothstep(0.18, 0.26, r);
    vec3 cc = vKind == 3.0 ? vec3(0.03) : vec3(0.95, 0.7, 0.1);
    alb = mix(vCol * (0.75 + 0.25 * r), cc, centre);
  } else {
    if (abs(vPart.y - 0.5) > 0.5) discard;
    alb = vec3(0.06, 0.11, 0.025);
  }
  alb = styleAlbedo(alb, alb);
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, normalize(vN));
  s.trans = 0.5; s.wrap = 0.5; s.spec = 0.3; s.rough = 0.5;
  float sh = sunShadow(vWp, vec3(0.0, 1.0, 0.0), 0.8) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
const fernVert = /* glsl */ `
${commonPars}
${windPars}
${fieldPars}
attribute vec4 aOff;
attribute vec4 aFrond; // x frond angle, y along (0..1), z across (-1..1), w frond index
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying float vShade;
void main() {
  vec2 xz = wrapPos(aOff.xy);
  float r1 = hash12(floor(xz * 3.3) + aOff.z * 7.0);
  float r2 = hash12(xz * 2.17 + 1.3);
  vec4 mA, mB; vec3 tn;
  float dens = groundCover(xz, mA, mB, tn);
  dens *= smoothstep(0.35, 0.85, mA.b) * uDensity * smoothstep(0.38, 0.62, fbmTex(xz * 0.012 + 0.4));
  float d = distance(xz, cameraPosition.xz);
  dens *= 1.0 - smoothstep(uR * 0.6, uR * 0.97, d);
  if (r1 > dens) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float h0 = heightAt(xz);
  float S = mix(0.55, 1.15, r2);
  float ang = aFrond.x + r2 * 6.283;
  float t = aFrond.y;
  float across = aFrond.z;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-dir.y, dir.x);
  float up = 0.75 + r1 * 0.35;
  // arching frond: rises then droops
  float L = S * (0.85 + 0.3 * fract(aFrond.w * 0.37));
  float along = t * L;
  float y = along * up - along * along * 0.9 / S;
  float width = 0.17 * S * sin(t * 3.14159) * (1.0 - t * 0.35);
  vec3 wv = windSway(vec3(xz.x, 0.0, xz.y), r2 * 6.28, 1.4);
  vec3 p = vec3(dir.x * along + side.x * across * width, y, dir.y * along + side.y * across * width);
  p.xz += wv.xz * t * t * 0.25;
  vec3 wp = vec3(xz.x, h0, xz.y) + p;
  vWp = wp;
  vN = normalize(vec3(-dir.x * 0.3, 1.0, -dir.y * 0.3));
  vUv = vec2(across, t);
  vShade = 0.55 + 0.45 * t;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fernFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying float vShade;
void main() {
  // pinnate leaflets: serrated edge from a sawtooth along the frond
  float t = vUv.y;
  float x = abs(vUv.x);
  float saw = fract(t * 22.0);
  float leaf = (0.55 + 0.45 * sin(saw * 3.14159)) * (1.0 - t * 0.2);
  if (x > leaf || (x < 0.05 && t > 0.97)) discard;
  float rib = 1.0 - smoothstep(0.02, 0.06, x);
  vec3 alb = mix(vec3(0.07, 0.15, 0.03), vec3(0.13, 0.22, 0.04), t) * (1.0 - rib * 0.3);
  alb = styleAlbedo(alb, vec3(0.08, 0.16, 0.035));
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, normalize(vN));
  s.trans = 0.6; s.wrap = 0.5; s.ao = vShade; s.spec = 0.3; s.rough = 0.5;
  float sh = sunShadow(vWp, normalize(vN), 0.7) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
const wheatVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aStalk; // xz position, height, phase
attribute vec2 aPart;  // x: 0 stem / 1 ear, y: across
varying vec3 vWp;
varying vec3 vN;
varying float vT;
varying float vEar;
uniform sampler2D uHeightTex;
float heightAt(vec2 xz) { return texture(uHeightTex, (xz + uWorld.x) / (2.0 * uWorld.x)).r; }
void main() {
  vec2 xz = aStalk.xy;
  float H = aStalk.z;
  float ph = aStalk.w;
  vec3 p = position;
  float t = p.y;
  vec3 wv = windSway(vec3(xz.x, 0.0, xz.y), ph, 1.3);
  float gust = windGust(xz);
  float yaw = ph * 7.0;
  float cy = cos(yaw), sy = sin(yaw);
  p.xz = mat2(cy, -sy, sy, cy) * p.xz;
  p.y *= H;
  p.xz += (wv.xz * 1.1 + uWind.xy * gust * 0.6) * t * t * H * 0.55;
  p.y -= length(wv.xz) * t * t * 0.12;
  vec3 wp = vec3(xz.x, heightAt(xz) - 0.05, xz.y) + p;
  vWp = wp;
  vN = normalize(vec3(cy, 0.6, sy));
  vT = t;
  vEar = aPart.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const wheatFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
varying vec3 vWp;
varying vec3 vN;
varying float vT;
varying float vEar;
void main() {
  vec3 stem = mix(vec3(0.12, 0.12, 0.03), vec3(0.4, 0.26, 0.06), vT);
  vec3 ear = vec3(0.46, 0.27, 0.05);
  vec3 alb = vEar > 0.5 ? ear : stem;
  alb *= 0.85 + 0.3 * hash12(floor(vWp.xz * 3.0));
  alb = styleAlbedo(alb, mix(vec3(0.42, 0.33, 0.12), ear, vEar));
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, normalize(vN));
  s.ao = mix(0.4, 1.0, vT);
  s.trans = 0.45; s.wrap = 0.5; s.spec = 0.4; s.rough = 0.45;
  float sh = sunShadow(vWp, vec3(0.0, 1.0, 0.0), 0.8) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
function bladeGeometry() {
  const g = new THREE.BufferGeometry();
  const ts = [0, 0.38, 0.72];
  const pos = [];
  for (const t of ts) pos.push(-0.5, t, 0, 0.5, t, 0);
  pos.push(0, 1, 0);
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function offsets(count, R, seed) {
  const rand = mulberry32(seed);
  const a = new Float32Array(count * 4);
  // stratified jitter for even coverage
  const side = Math.ceil(Math.sqrt(count));
  const cell = (2 * R) / side;
  for (let i = 0; i < count; i++) {
    const gx = i % side, gz = Math.floor(i / side);
    a[i * 4] = (gx + rand()) * cell;
    a[i * 4 + 1] = (gz + rand()) * cell;
    a[i * 4 + 2] = rand();
    a[i * 4 + 3] = rand();
  }
  return a;
}

function makeField({ geo, vert, frag, count, R, inner = 0, seed, extra = {}, side = THREE.DoubleSide }) {
  const g = geo;
  const off = new THREE.InstancedBufferAttribute(offsets(count, R, seed), 4);
  g.setAttribute('aOff', off);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uCenter: { value: new THREE.Vector3() }, uR: { value: R }, uInner: { value: inner }, uDensity: { value: 1 }, ...extra },
    vertexShader: vert,
    fragmentShader: frag,
    side,
  });
  const mesh = new THREE.InstancedMesh(g, mat, count);
  mesh.frustumCulled = false;
  mesh.layers.set(REFLECT_LAYER);
  mesh.userData.maxCount = count;
  return mesh;
}

export function createGrass(ctx) {
  const { scene } = ctx;
  const group = new THREE.Group();
  group.name = 'grass';
  const near = makeField({ geo: bladeGeometry(), vert: grassVert, frag: grassFrag, count: 180000, R: 10, seed: 1, extra: { uWidth: { value: 0.55 }, uHeight: { value: 1 } } });
  const mid = makeField({ geo: bladeGeometry(), vert: grassVert, frag: grassFrag, count: 150000, R: 26, inner: 10, seed: 5, extra: { uWidth: { value: 1.25 }, uHeight: { value: 1.0 } } });
  const far = makeField({ geo: bladeGeometry(), vert: grassVert, frag: grassFrag, count: 120000, R: 56, inner: 26, seed: 2, extra: { uWidth: { value: 2.6 }, uHeight: { value: 1.05 } } });

  // flowers: stem quad + two crossed head quads
  const fg = new THREE.BufferGeometry();
  {
    const P = [], A = [], I = [];
    const quad = (pts, parts) => { const b = P.length / 3; pts.forEach((p, k) => { P.push(...p); A.push(...parts[k]); }); I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    quad([[-0.006, 0, 0], [0.006, 0, 0], [0.006, 1, 0], [-0.006, 1, 0]], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]);
    quad([[-0.1, 1, -0.1], [0.1, 1, -0.1], [0.1, 1.0, 0.1], [-0.1, 1.0, 0.1]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]);
    quad([[-0.08, 0.96, 0], [0.08, 0.96, 0], [0.08, 1.04, 0], [-0.08, 1.04, 0]], [[1, 0, 0.5], [1, 1, 0.5], [1, 1, 0.5], [1, 0, 0.5]]);
    fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    fg.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 3));
    fg.setIndex(I);
  }
  const flowers = makeField({ geo: fg, vert: flowerVert, frag: flowerFrag, count: 26000, R: 30, seed: 3 });

  // ferns: 8 fronds x 7 segments
  const fernGeo = new THREE.BufferGeometry();
  {
    const P = [], F = [], I = [];
    const fronds = 8, segs = 7;
    for (let f = 0; f < fronds; f++) {
      const ang = (f / fronds) * Math.PI * 2;
      const b = P.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        for (const a of [-1, 1]) { P.push(0, 0, 0); F.push(ang, t, a, f); }
      }
      for (let s = 0; s < segs; s++) {
        const k = b + s * 2;
        I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    fernGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    fernGeo.setAttribute('aFrond', new THREE.Float32BufferAttribute(F, 4));
    fernGeo.setIndex(I);
  }
  const ferns = makeField({ geo: fernGeo, vert: fernVert, frag: fernFrag, count: 5200, R: 30, seed: 4 });

  group.add(near, mid, far, flowers, ferns);

  // wheat (static, field-bound)
  const rand = mulberry32(9);
  const stalks = [];
  for (const f of FIELDS) {
    if (f.crop !== 'wheat') continue;
    const n = Math.floor(f.hx * f.hz * 4 * 11);
    const c = Math.cos(f.a), s = Math.sin(f.a);
    for (let i = 0; i < n; i++) {
      const lx = (rand() * 2 - 1) * (f.hx - 0.6), lz = (rand() * 2 - 1) * (f.hz - 0.6);
      // furrows: rows every 0.5 m
      const row = Math.round(lz / 0.45) * 0.45 + (rand() - 0.5) * 0.12;
      const x = f.x + lx * c + row * s, z = f.z - lx * s + row * c;
      stalks.push(x, z, 0.85 + rand() * 0.35, rand() * 6.283);
    }
  }
  const wg = new THREE.BufferGeometry();
  {
    const P = [], A = [], I = [];
    const quad = (pts, part) => { const b = P.length / 3; pts.forEach((p) => { P.push(...p); A.push(part, 0); }); I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    quad([[-0.008, 0, 0], [0.008, 0, 0], [0.006, 0.86, 0], [-0.006, 0.86, 0]], 0);
    quad([[-0.03, 0.8, 0], [0.03, 0.8, 0], [0.02, 1.0, 0], [-0.02, 1.0, 0]], 1);
    quad([[0, 0.8, -0.03], [0, 0.8, 0.03], [0, 1.0, 0.02], [0, 1.0, -0.02]], 1);
    wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    wg.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
    wg.setIndex(I);
  }
  wg.setAttribute('aStalk', new THREE.InstancedBufferAttribute(new Float32Array(stalks), 4));
  const wheatMat = new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: wheatVert, fragmentShader: wheatFrag, side: THREE.DoubleSide });
  const wheat = new THREE.InstancedMesh(wg, wheatMat, stalks.length / 4);
  wheat.frustumCulled = false;
  wheat.layers.set(REFLECT_LAYER);
  group.add(wheat);
  scene.add(group);

  const fields = [near, mid, far, flowers, ferns];
  const stats = { blades: near.count + mid.count + far.count, flowers: flowers.count, ferns: ferns.count, wheat: stalks.length / 4 };
  return {
    name: 'grass',
    stats,
    group,
    update(dt, t, c) {
      for (const f of fields) f.material.uniforms.uCenter.value.copy(c.camera.position);
      wheat.visible = c.camera.position.distanceTo(new THREE.Vector3(-90, 20, 20)) < 420;
    },
    applyStyle(style) {
      const k = style.quality.grass;
      for (const f of [near, mid, far]) f.count = Math.round(f.userData.maxCount * Math.min(1, k / 1.5));
      // cartoon & anime: fewer, chunkier blades read better with outlines
      const toon = style.id === 2 || style.id === 3;
      near.material.uniforms.uWidth.value = toon ? 1.3 : 0.55;
      mid.material.uniforms.uWidth.value = toon ? 2.2 : 1.25;
      far.material.uniforms.uWidth.value = toon ? 3.4 : 2.6;
      near.material.uniforms.uDensity.value = toon ? 0.55 : 1;
      mid.material.uniforms.uDensity.value = toon ? 0.7 : 1;
      stats.blades = near.count + mid.count + far.count;
    },
  };
}
