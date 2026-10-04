import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars, fogPars, lightingPars, clipWater, grassPars } from '../render/shaders/lib.js';
import { WORLD } from './layout.js';
import { rawHeight } from './terrainData.js';

// Albedo array layer order (must match TERRAIN_LAYERS in main.js)
export const TERRAIN_LAYERS = [
  'rocky_terrain_02', // 0 grass
  'leafy_grass', // 1 meadow
  'forest_leaves_04', // 2 forest floor
  'brown_mud_dry', // 3 dirt
  'aerial_rocks_02', // 4 rock
  'ganges_river_pebbles', // 5 pebbles
  'mossy_cobblestone', // 6 cobble
];

const vert = /* glsl */ `
${commonPars}
varying vec3 vWp;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision highp sampler2DArray;
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
${grassPars}
uniform sampler2DArray uAlbedoArr;
uniform sampler2DArray uNormalArr;
uniform sampler2D uTerrainNormalTex;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec3 uLayerMean[7];
uniform vec4 uLayerScale0; // grass, meadow, forest, dirt
uniform vec3 uLayerScale1; // rock, pebbles, cobble
varying vec3 vWp;
varying vec3 vN;

// two decorrelated samples blended by a macro noise to break tiling
vec4 sampleArr(sampler2DArray t, vec2 p, float layer, float sel) {
  vec2 uv = p;
  vec2 uv2 = mat2(0.788, -0.616, 0.616, 0.788) * p * 0.83 + vec2(0.37, 0.61);
  vec4 a = texture(t, vec3(uv, layer));
  if (sel < 0.02) return a;
  vec4 b = texture(t, vec3(uv2, layer));
  return mix(a, b, sel);
}

void main() {
  ${clipWater}
  vec3 wp = vWp;
  vec2 xz = wp.xz;
  float half_ = uWorld.x;
  float WL = uWorld.y;
  vec2 tuv = (xz + half_) / (2.0 * half_);

#ifdef FAR
  vec3 Nm = normalize(vN);
  vec4 mA = vec4(0.0);
  vec4 mB = vec4(0.0);
  // procedural canopy coverage for distant land
  float alt = wp.y;
  float fcov = smoothstep(0.42, 0.62, fbmTex(xz * 0.0011 + 0.5)) * smoothstep(360.0, 230.0, alt + 40.0 * noiseLo(xz * 0.002));
  mA.b = fcov;
#else
  vec3 Nm = normalize(texture(uTerrainNormalTex, tuv).xyz * 2.0 - 1.0);
  vec4 mA = texture(uMaskA, tuv);
  vec4 mB = texture(uMaskB, tuv);
#endif

  float slope = 1.0 - Nm.y;
  float nMacro = fbmTex(xz * 0.0037);
  float nMid = noiseLo(xz * 0.021 + 0.3);
  float nFine = noise4(xz * 0.09).b;
  float sel = smoothstep(0.32, 0.68, noiseLo(xz * 0.0065 + 0.21));

  // ---- layer weights
  float wRock = smoothstep(0.30, 0.52, slope + (nMid - 0.5) * 0.22);
  float wPeb = 1.0 - smoothstep(WL + 0.15, WL + 1.25, wp.y + (nMid - 0.5) * 0.7);
  float edge = (nFine - 0.5) * 0.5 + (nMid - 0.5) * 0.35;
  // cart roads: two ruts with a grassy crown between them
  float wDirt = smoothstep(0.34, 0.66, mA.r + edge * 1.4);
  float crown = smoothstep(0.92, 1.0, mA.r) * smoothstep(0.45, 0.62, nFine + 0.12);
  wDirt *= 1.0 - crown * 0.55;
  wDirt = max(wDirt, mB.r * 0.85);
  float wCob = smoothstep(0.35, 0.6, mA.g + edge * 0.6);
  float wForest = smoothstep(0.2, 0.75, mA.b + (nMid - 0.5) * 0.45);
  float wMeadow = smoothstep(0.45, 0.7, nMacro) * (1.0 - wForest);
  float worn = mB.a;

  // compose (painter's order: grass < meadow < forest < dirt < cobble < pebbles < rock)
  float W[7];
  float rem = 1.0;
  W[4] = wRock; rem -= W[4];
  W[5] = wPeb * rem; rem -= W[5];
  W[6] = wCob * rem; rem -= W[6];
  W[3] = wDirt * rem; rem -= W[3];
  W[2] = wForest * rem; rem -= W[2];
  W[1] = wMeadow * rem; rem -= W[1];
  W[0] = max(rem, 0.0);

  vec3 alb = vec3(0.0);
  vec3 nTs = vec3(0.0);
  float rough = 0.0;
  float hsum = 0.0;
  vec3 flatC = vec3(0.0);
  float scales[7] = float[7](uLayerScale0.x, uLayerScale0.y, uLayerScale0.z, uLayerScale0.w, uLayerScale1.x, uLayerScale1.y, uLayerScale1.z);
  vec3 gBase = grassBase(xz);
  for (int i = 0; i < 7; i++) {
    float w = W[i];
    if (w < 0.003) continue;
    float sc = scales[i];
#ifdef FAR
    sc *= 9.0;
#endif
    vec2 p = xz / sc;
    vec4 a;
    vec4 n;
    if (i == 4) {
      // biplanar for cliffs
      vec3 an = abs(Nm);
      vec2 pX = wp.zy / sc;
      vec2 pZ = wp.xy / sc;
      vec2 pY = p;
      vec3 bw = pow(an, vec3(4.0));
      bw /= dot(bw, vec3(1.0));
      a = texture(uAlbedoArr, vec3(pX, 4.0)) * bw.x + texture(uAlbedoArr, vec3(pY, 4.0)) * bw.y + texture(uAlbedoArr, vec3(pZ, 4.0)) * bw.z;
      n = texture(uNormalArr, vec3(pY, 4.0));
    } else {
      a = sampleArr(uAlbedoArr, p, float(i), sel);
      n = sampleArr(uNormalArr, p, float(i), sel);
    }
    vec3 c = a.rgb;
    vec3 mean = uLayerMean[i];
    if (i <= 1) {
      // recolour grass layers to the shared grass palette so blades and ground agree
      vec3 gb = gBase * vec3(1.08, 1.0, 0.78) * 0.92;
      c = c / max(mean, vec3(0.02)) * gb * (i == 1 ? 1.1 : 1.0);
      mean = gb;
    }
    if (i == 2) { c *= mix(vec3(1.0), vec3(0.82, 0.9, 0.75), 0.5); mean *= vec3(0.9, 0.95, 0.85); }
    if (i == 6 && (uStyle == 2 || uStyle == 3)) {
      // cel styles: drawn cobbles (flat greyish stones, dark joints) instead of a flat smear
      float l = dot(a.rgb, vec3(0.3333)) / max(dot(uLayerMean[6], vec3(0.3333)), 0.02);
      mean = mix(mean, vec3(dot(mean, vec3(0.3333))), 0.45);
      c = mean * mix(0.6, 1.08, smoothstep(0.72, 0.9, l));
      mean = c;
    }
    alb += styleAlbedo(c, mean) * w;
    flatC += mean * w;
    nTs += vec3(n.xy * 2.0 - 1.0, 0.0) * w;
    rough += n.b * w;
  }

  // tilled soil is darker and richer than the path dirt
  alb = mix(alb, alb * vec3(0.62, 0.55, 0.5), mB.r * (1.0 - wCob));

  // worn / trampled grass near paths and village
  float wornAmt = worn * W[0] * ((uStyle == 2 || uStyle == 3) ? 0.15 : 0.55);
  alb = mix(alb, alb * vec3(1.25, 1.05, 0.75), wornAmt);

  // macro value + hue variation (large soft patches) — kills the last hint of repetition
  // (the flat cartoon look keeps only a hint, or its posterised values break into blotches)
  float macroK = uStyle == 3 ? 0.3 : (uStyle == 2 ? 0.65 : 1.0);
  float nPatch = noiseLo(xz * 0.0019 + 0.71);
  alb *= mix(1.0, 0.78 + 0.42 * nMacro, macroK);
  alb = mix(alb, alb * vec3(1.18, 1.08, 0.72), smoothstep(0.55, 0.8, nPatch) * W[0] * 0.6 * macroK);
  alb = mix(alb, alb * vec3(0.8, 0.95, 0.85), smoothstep(0.45, 0.2, nPatch) * W[0] * 0.5 * macroK);
  // tussocks and mown/grazed patches in the meadows (mid scale)
  float tuss = noise4(xz * 0.045 + 0.3).g;
  alb *= mix(1.0, 0.82 + 0.3 * tuss, W[0] * 0.7 * macroK);
  // meadow flowers seen from afar warm the grass a little
  alb = mix(alb, alb * vec3(1.15, 1.05, 1.05) + vec3(0.012, 0.008, 0.01), mA.a * 0.5);

#ifndef FAR
  // wet banks
  float wet = 1.0 - smoothstep(WL + 0.05, WL + 0.9, wp.y);
  alb *= mix(1.0, 0.62, wet);
  // glossy mud only in the lit styles: in the cel styles the sky sheen turns violet
  if (uStyle == 0 || uStyle == 4) rough = mix(rough, 0.25, wet * 0.8);
  // underwater tint
  float under = smoothstep(WL, WL - 0.6, wp.y);
  alb = mix(alb, alb * vec3(0.55, 0.72, 0.62), under);
  if (uStyle == 4 && under > 0.0) {
    vec2 cu = xz * 0.35 + uTime * vec2(0.06, 0.035);
    float ca = noise4(cu).g;
    float cb = noise4(cu * 1.3 - uTime * 0.04).b;
    float caust = pow(1.0 - abs(ca - cb) * 2.0, 6.0);
    alb += vec3(0.9, 1.0, 0.8) * caust * 0.25 * under * saturate(uSunDir.y * 2.0);
  }
#endif

#ifdef FAR
  // distant snow on high, gentle slopes
  float snow = smoothstep(420.0, 520.0, wp.y + 90.0 * (nMacro - 0.5) + 60.0 * (nFine - 0.5)) * smoothstep(0.5, 0.25, slope);
  alb = mix(alb, vec3(0.82, 0.86, 0.92), snow);
  // canopy colour for distant forest
  vec3 canopy = mix(vec3(0.025, 0.055, 0.02), vec3(0.06, 0.085, 0.03), nFine);
  alb = mix(alb, styleAlbedo(canopy, canopy), mA.b * (1.0 - snow));
#endif

  // normal: macro + detail (UDN). Image up = -z.
  float detailN = mix(0.25, 1.0, uStyleA.x);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nm * Nm.x);
  vec3 B = normalize(cross(T, Nm));
  vec3 N = normalize(Nm + (T * nTs.x - B * nTs.y) * 0.9 * detailN);
#ifdef FAR
  N = normalize(N + vec3(nFine - 0.5, 0.0, nMid - 0.5) * 0.35 * mA.b);
#endif

  vec3 V = normalize(cameraPosition - wp);
  Surf s = surfDefault(alb, N);
  s.rough = clamp(rough, 0.2, 1.0);
  s.spec = 0.35;
  // ground is seen at grazing angles: a full rim term would wash whole meadows orange
  s.rimK = 0.12;
#ifdef FAR
  s.spec = 0.08;
  s.rough = 0.9;
#endif
  float canopyAO = 1.0 - mA.b * 0.42;
  s.ao = canopyAO * mix(1.0, 0.75, W[6] * (1.0 - nFine));
  float ndl = dot(Nm, uSunDir);
  float sh = 1.0;
#ifdef FAR
  sh = mix(1.0, 0.72, mA.b * nFine);
#else
  sh = sunShadow(wp, Nm, ndl);
#endif
  sh *= cloudShadow(wp);
  vec3 col = shade(s, wp, V, sh);
  col = applyFog(col, wp);
  gl_FragColor = vec4(col, 1.0);
#ifndef FAR
  if (uDebug == 1) {
    vec3 c0 = (uShadowMat0 * vec4(wp, 1.0)).xyz;
    gl_FragColor = vec4(sh, fract(c0.x * 4.0) * 0.5, fract(c0.z * 20.0), 1.0);
  }
#endif
}
`;

export function createTerrainMaterial(albedoArr, normalArr, { far = false } = {}) {
  const means = albedoArr.userData.means.map((m) => new THREE.Color().setRGB(m[0], m[1], m[2], THREE.SRGBColorSpace));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uAlbedoArr: { value: albedoArr },
      uNormalArr: { value: normalArr },
      uLayerMean: { value: means.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
      uLayerScale0: { value: new THREE.Vector4(6.5, 7.5, 5.0, 4.5) },
      uLayerScale1: { value: new THREE.Vector3(10.0, 3.2, 2.5) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    defines: far ? { FAR: 1 } : {},
  });
  mat.extensions = { derivatives: true };
  return mat;
}

export function createTerrainMeshes(data, albedoArr, normalArr) {
  const { N, step, half, heights } = data;
  // ---- main grid with skirt
  const count = N * N + (N - 1) * 4 + 4;
  const pos = new Float32Array(count * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 3;
    pos[k] = -half + i * step;
    pos[k + 1] = heights[j * N + i];
    pos[k + 2] = -half + j * step;
  }
  const idx = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    // alternate diagonal for smoother terrain
    if ((i + j) & 1) idx.push(a, c, b, b, c, d);
    else idx.push(a, c, d, a, d, b);
  }
  // skirt
  let v = N * N;
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i); // north edge (j=0)
  for (let j = 1; j < N; j++) edges.push(j * N + N - 1); // east
  for (let i = N - 2; i >= 0; i--) edges.push((N - 1) * N + i); // south
  for (let j = N - 2; j >= 1; j--) edges.push(j * N); // west
  edges.push(0);
  const skirtStart = v;
  for (const e of edges) {
    pos[v * 3] = pos[e * 3];
    pos[v * 3 + 1] = pos[e * 3 + 1] - 14;
    pos[v * 3 + 2] = pos[e * 3 + 2];
    v++;
  }
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k], b = edges[k + 1], c = skirtStart + k, d = skirtStart + k + 1;
    idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(v * 3).fill(0), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = createTerrainMaterial(albedoArr, normalArr);
  const main = new THREE.Mesh(geo, mat);
  main.name = 'terrain';
  main.frustumCulled = false;

  // ---- far ring: warped grid with an exact hole at the playable square
  const M = 236, K0 = 60, K1 = M - 60; // inner indices map to ±half
  const coord = (k) => {
    if (k >= K0 && k <= K1) return -half + ((k - K0) / (K1 - K0)) * 2 * half;
    const t = k < K0 ? (K0 - k) / K0 : (k - K1) / (M - K1);
    const s = half + (WORLD.farExtent - half) * Math.pow(t, 1.75);
    return k < K0 ? -s : s;
  };
  const fpos = new Float32Array((M + 1) * (M + 1) * 3);
  const fnor = new Float32Array((M + 1) * (M + 1) * 3);
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
    const x = coord(i), z = coord(j);
    const inside = i > K0 && i < K1 && j > K0 && j < K1;
    const onEdge = (i >= K0 && i <= K1 && j >= K0 && j <= K1) && !inside;
    const h = inside ? 0 : onEdge ? data.heightAt(x, z) : rawHeight(x, z);
    const k = (j * (M + 1) + i) * 3;
    fpos[k] = x; fpos[k + 1] = h; fpos[k + 2] = z;
    const e = Math.max(6, Math.hypot(x, z) * 0.01);
    const hx = rawHeight(x + e, z) - rawHeight(x - e, z);
    const hz = rawHeight(x, z + e) - rawHeight(x, z - e);
    const nl = Math.hypot(hx, 2 * e, hz);
    fnor[k] = -hx / nl; fnor[k + 1] = (2 * e) / nl; fnor[k + 2] = -hz / nl;
  }
  const fidx = [];
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    if (i >= K0 && i < K1 && j >= K0 && j < K1) continue; // hole
    const a = j * (M + 1) + i, b = a + 1, c = a + M + 1, d = c + 1;
    fidx.push(a, c, b, b, c, d);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setAttribute('normal', new THREE.BufferAttribute(fnor, 3));
  fgeo.setIndex(fidx);
  fgeo.computeBoundingSphere();
  const far = new THREE.Mesh(fgeo, createTerrainMaterial(albedoArr, normalArr, { far: true }));
  far.name = 'terrain-far';
  far.frustumCulled = false;
  return { main, far };
}

/** GPU textures for the height field (R32F) and packed normals. */
export function createHeightTextures(data) {
  const { N, heights, normals } = data;
  const hh = new Uint16Array(N * N);
  for (let i = 0; i < N * N; i++) hh[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const ht = new THREE.DataTexture(hh, N, N, THREE.RedFormat, THREE.HalfFloatType);
  ht.minFilter = ht.magFilter = THREE.LinearFilter;
  ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping;
  ht.needsUpdate = true;
  const nb = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    nb[i * 4] = Math.round((normals[i * 3] * 0.5 + 0.5) * 255);
    nb[i * 4 + 1] = Math.round((normals[i * 3 + 1] * 0.5 + 0.5) * 255);
    nb[i * 4 + 2] = Math.round((normals[i * 3 + 2] * 0.5 + 0.5) * 255);
    nb[i * 4 + 3] = 255;
  }
  const nt = new THREE.DataTexture(nb, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  nt.minFilter = nt.magFilter = THREE.LinearFilter;
  nt.needsUpdate = true;
  return { ht, nt };
}

export function createMaskTextures(data) {
  const R = data.maskRes;
  const mk = (arr) => {
    const t = new THREE.DataTexture(arr, R, R, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { a: mk(data.maskA), b: mk(data.maskB) };
}
