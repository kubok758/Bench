import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars, fogPars, lightingPars, clipWater, windPars } from '../render/shaders/lib.js';

// Accumulates geometry per material key. Vertex layout:
// position, normal, uv (metres / tile), aTint (rgb), aAo (float)
export class GeoBuilder {
  constructor() {
    this.parts = new Map();
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.stack = [];
    this.tint = [1, 1, 1];
  }

  bucket(key) {
    let b = this.parts.get(key);
    if (!b) this.parts.set(key, (b = { p: [], n: [], uv: [], t: [], ao: [], i: [] }));
    return b;
  }

  push(mat) {
    this.stack.push(this.m.clone());
    this.m.multiply(mat);
    this.nm.getNormalMatrix(this.m);
  }
  pop() {
    this.m.copy(this.stack.pop());
    this.nm.getNormalMatrix(this.m);
  }
  /** Convenience: push a transform from position + rotY (+ optional scale). */
  frame(x, y, z, rotY = 0) {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    this.push(m);
  }

  _v(b, p, n, u, v, ao) {
    const P = new THREE.Vector3(...p).applyMatrix4(this.m);
    const N = new THREE.Vector3(...n).applyMatrix3(this.nm).normalize();
    b.p.push(P.x, P.y, P.z);
    b.n.push(N.x, N.y, N.z);
    b.uv.push(u, v);
    b.t.push(this.tint[0], this.tint[1], this.tint[2]);
    b.ao.push(ao);
    return b.p.length / 3 - 1;
  }

  /** Quad p0..p3 (counter-clockwise seen from the front), uv per corner. */
  quad(key, p0, p1, p2, p3, uvs, ao = [1, 1, 1, 1]) {
    const b = this.bucket(key);
    const a = new THREE.Vector3(...p1).sub(new THREE.Vector3(...p0));
    const c = new THREE.Vector3(...p3).sub(new THREE.Vector3(...p0));
    const n = a.cross(c).normalize().toArray();
    const i0 = this._v(b, p0, n, uvs[0][0], uvs[0][1], ao[0]);
    const i1 = this._v(b, p1, n, uvs[1][0], uvs[1][1], ao[1]);
    const i2 = this._v(b, p2, n, uvs[2][0], uvs[2][1], ao[2]);
    const i3 = this._v(b, p3, n, uvs[3][0], uvs[3][1], ao[3]);
    b.i.push(i0, i1, i2, i0, i2, i3);
  }

  tri(key, p0, p1, p2, uvs, ao = [1, 1, 1]) {
    const b = this.bucket(key);
    const a = new THREE.Vector3(...p1).sub(new THREE.Vector3(...p0));
    const c = new THREE.Vector3(...p2).sub(new THREE.Vector3(...p0));
    const n = a.cross(c).normalize().toArray();
    const i0 = this._v(b, p0, n, uvs[0][0], uvs[0][1], ao[0]);
    const i1 = this._v(b, p1, n, uvs[1][0], uvs[1][1], ao[1]);
    const i2 = this._v(b, p2, n, uvs[2][0], uvs[2][1], ao[2]);
    b.i.push(i0, i1, i2);
  }

  /**
   * Axis-aligned box in the current frame. min/max corners. tile = metres per texture repeat.
   * opts.faces: subset of 'px nx py ny pz nz'; opts.aoBottom darkens the lower vertices.
   */
  box(key, min, max, tile = 2, opts = {}) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const faces = opts.faces || 'px nx py ny pz nz';
    const aoB = opts.aoBottom ?? 0.8;
    const ot = opts.uvOffset || [0, 0];
    const ao = (y) => (y <= y0 + 1e-4 ? aoB : 1);
    const T = tile;
    const off = (u, v) => [u / T + ot[0], v / T + ot[1]];
    if (faces.includes('pz')) this.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [off(x0, y0), off(x1, y0), off(x1, y1), off(x0, y1)], [ao(y0), ao(y0), 1, 1]);
    if (faces.includes('nz')) this.quad(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [off(-x1, y0), off(-x0, y0), off(-x0, y1), off(-x1, y1)], [ao(y0), ao(y0), 1, 1]);
    if (faces.includes('px')) this.quad(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [off(-z1, y0), off(-z0, y0), off(-z0, y1), off(-z1, y1)], [ao(y0), ao(y0), 1, 1]);
    if (faces.includes('nx')) this.quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [off(z0, y0), off(z1, y0), off(z1, y1), off(z0, y1)], [ao(y0), ao(y0), 1, 1]);
    if (faces.includes('py')) this.quad(key, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [off(x0, -z1), off(x1, -z1), off(x1, -z0), off(x0, -z0)]);
    if (faces.includes('ny')) this.quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [off(x0, z0), off(x1, z0), off(x1, z1), off(x0, z1)]);
  }

  /** Box given centre, half sizes and a local Y rotation (for beams, braces, props). */
  obox(key, c, h, rotY = 0, tile = 2, opts = {}) {
    this.push(new THREE.Matrix4().makeRotationY(rotY).setPosition(c[0], c[1], c[2]));
    this.box(key, [-h[0], -h[1], -h[2]], [h[0], h[1], h[2]], tile, opts);
    this.pop();
  }

  /** Beam between two points with square section s (oriented along the segment). */
  beam(key, a, b, s, tile = 1.5) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.push(m);
    // texture grain runs along the beam: rotate uv by using the y extent as v
    this.box(key, [-s / 2, -len / 2, -s / 2], [s / 2, len / 2, s / 2], tile, { aoBottom: 1, faces: 'px nx pz nz' });
    this.pop();
  }

  cylinder(key, c, r0, r1, h, segs = 12, tile = 2, opts = {}) {
    const b = this.bucket(key);
    const [cx, cy, cz] = c;
    const circ = 2 * Math.PI * Math.max(r0, r1);
    const start = b.p.length / 3;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const slope = (r0 - r1) / h;
      const n = new THREE.Vector3(ca, slope, sa).normalize().toArray();
      this._v(b, [cx + ca * r0, cy, cz + sa * r0], n, (s / segs) * circ / tile, 0, opts.aoBottom ?? 0.8);
      this._v(b, [cx + ca * r1, cy + h, cz + sa * r1], n, (s / segs) * circ / tile, h / tile, 1);
    }
    for (let s = 0; s < segs; s++) {
      const k = start + s * 2;
      b.i.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    if (opts.cap) {
      const ci = this._v(b, [cx, cy + h, cz], [0, 1, 0], 0.5, 0.5, 1);
      const ring = [];
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        ring.push(this._v(b, [cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1], [0, 1, 0], Math.cos(a) * r1 / tile, Math.sin(a) * r1 / tile, 1));
      }
      for (let s = 0; s < segs; s++) b.i.push(ci, ring[s + 1], ring[s]);
    }
  }

  /** Arbitrary BufferGeometry (e.g. ExtrudeGeometry) appended into a bucket. */
  geometry(key, geo, uvScale = 1) {
    const b = this.bucket(key);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const start = b.p.length / 3;
    for (let i = 0; i < P.count; i++) {
      this._v(b, [P.getX(i), P.getY(i), P.getZ(i)], [N.getX(i), N.getY(i), N.getZ(i)], UV ? UV.getX(i) * uvScale : 0, UV ? UV.getY(i) * uvScale : 0, 1);
      b.i.push(start + i);
    }
  }

  build() {
    const out = new Map();
    for (const [key, b] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('aTint', new THREE.Float32BufferAttribute(b.t, 3));
      g.setAttribute('aAo', new THREE.Float32BufferAttribute(b.ao, 1));
      g.setIndex(b.i.length > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(key, g);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
const vert = /* glsl */ `
${commonPars}
${windPars}
attribute vec3 aTint;
attribute float aAo;
uniform float uSway; // cloth / laundry sway amount
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vTint;
varying float vAo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
#ifdef USE_INSTANCING
  wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
#endif
  if (uSway > 0.0) {
    // cloth: anchored at the top (uv.y = 1), free at the bottom
    float free = 1.0 - saturate(uv.y);
    vec3 w = windSway(wp.xyz, wp.x * 0.7 + wp.z * 0.3, 2.4);
    wp.xyz += (w + vec3(0.0, 0.0, 0.0)) * free * free * uSway + vec3(uWind.x, 0.0, uWind.y) * sin(uTime * 5.1 + wp.x * 3.0 + uv.x * 6.0) * 0.05 * free * uSway;
  }
  vWp = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vTint = aTint;
  vAo = aAo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
uniform sampler2D uMapC;
uniform sampler2D uMapN;
uniform int uKind;      // 0 textured, 1 glass, 2 flat colour, 3 emissive lamp
uniform vec3 uFlat;
uniform float uNormalK;
uniform float uSpec;
uniform vec3 uEmissive;
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vTint;
varying float vAo;

vec3 perturbN(vec3 N, vec3 p, vec2 uv, vec3 tn) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-10);
  return normalize(mat3(T * invmax, B * invmax, N) * tn);
}

void main() {
  ${clipWater}
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWp);
  vec3 alb;
  float rough = 0.8;
  float spec = uSpec;
  vec3 emis = vec3(0.0);
  if (uKind == 0) {
    vec4 c = texture(uMapC, vUv);
    vec4 nn = texture(uMapN, vUv);
    vec3 tn = vec3((nn.xy * 2.0 - 1.0) * uNormalK * mix(0.3, 1.0, uStyleA.x), 0.0);
    tn.z = sqrt(max(1.0 - dot(tn.xy, tn.xy), 0.05));
    N = perturbN(N, vWp, vUv, normalize(tn));
    rough = nn.b;
    alb = c.rgb * vTint;
    // weathering: darker, mossier toward the ground
    float g = noise4(vWp.xz * 0.35 + vWp.y * 0.2).g;
    alb *= mix(1.0, 0.72 + 0.2 * g, saturate(1.0 - vAo) * 1.5);
    alb = styleAlbedo(alb, uFlat * vTint);
  } else if (uKind == 1) {
    // window glass: dark interior + sky reflection
    float F = 0.04 + 0.96 * pow(1.0 - saturate(dot(N, V)), 5.0);
    vec3 R = reflect(-V, N);
    vec3 refl = skyLUT(normalize(vec3(R.x, abs(R.y) * 0.6 + 0.05, R.z)));
    vec3 inside = vec3(0.02, 0.018, 0.014) + vec3(0.06, 0.035, 0.012) * noiseLo(vWp.xz * 0.3 + vWp.y);
    vec3 col = mix(inside, refl * 0.6, F + 0.12);
    if (uStyle == 3) col = mix(vec3(0.12, 0.2, 0.35), vec3(0.7, 0.85, 1.0), step(0.6, fract((vUv.x + vUv.y) * 1.5)));
    if (uStyle == 2) col = mix(vec3(0.1, 0.16, 0.3), vec3(0.55, 0.7, 0.95), smoothstep(0.4, 0.6, fract(vUv.x + vUv.y * 0.6)));
    col = applyFog(col, vWp);
    gl_FragColor = vec4(col, 1.0);
    return;
  } else if (uKind == 3) {
    alb = vTint;
    emis = uEmissive;
  } else {
    alb = vTint;
    alb = styleAlbedo(alb, alb);
  }
  Surf s = surfDefault(alb, N);
  s.ao = vAo;
  s.rough = rough;
  s.spec = spec;
  s.emissive = emis;
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWp, normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), ndl) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildingMaterial({ mapC = null, mapN = null, kind = 0, flat = [0.5, 0.5, 0.5], normalK = 1, spec = 0.35, emissive = [0, 0, 0], side = THREE.DoubleSide, sway = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uMapC: { value: mapC }, uMapN: { value: mapN }, uKind: { value: kind },
      uFlat: { value: new THREE.Vector3(...flat) }, uNormalK: { value: normalK }, uSpec: { value: spec },
      uEmissive: { value: new THREE.Vector3(...emissive) }, uSway: { value: sway },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side,
  });
}

export const buildingDepthMaterial = (side = THREE.DoubleSide, sway = 0) => new THREE.ShaderMaterial({
  uniforms: { ...U, uSway: { value: sway } },
  vertexShader: vert,
  fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
  side,
});
