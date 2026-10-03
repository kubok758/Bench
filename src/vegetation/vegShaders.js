import { commonPars, windPars, shadowPars, fogPars, lightingPars, clipWater, ditherPars } from '../render/shaders/lib.js';

// Shared vertex code for instanced vegetation with layered wind.
export const vegVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aVeg;   // x sway weight, y phase, z flutter, w ao
attribute vec4 aInst;  // x tint shift, y brightness, z phase, w scale
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying float vAo;
varying vec4 vInst;
varying float vH;
uniform float uTreeH;
void main() {
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  mat4 m = modelMatrix * im;
  vec3 origin = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 pos = position;
  vec4 wp4 = m * vec4(pos, 1.0);
  vec3 wp = wp4.xyz;
  float h = max(pos.y, 0.0) / max(uTreeH, 1.0);
  float ph = aInst.z;
  // whole-plant bend (quadratic in height)
  vec3 bend = windSway(origin, ph, 0.75) * h * h * uTreeH * 0.03;
  // branch sway
  vec3 br = windSway(origin + vec3(aVeg.y * 3.1, 0.0, aVeg.y), ph + aVeg.y, 1.6) * aVeg.x * 0.07 * (0.3 + h);
  // leaf flutter along the normal
  float fl = aVeg.z * uWind.z;
  vec3 wn = normalize(mat3(m) * normal);
  float flut = sin(uTime * 6.5 + aVeg.y * 4.0 + wp.x * 0.9 + wp.z * 0.7) * 0.5 + sin(uTime * 9.3 + aVeg.y * 7.0) * 0.3;
  wp += bend + br + wn * flut * 0.035 * fl * (0.4 + windGust(origin.xz));
  vWp = wp;
  vN = wn;
  vUv = uv;
  vAo = aVeg.w;
  vInst = aInst;
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const leafFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
${ditherPars}
uniform sampler2D uAtlas;
uniform vec3 uLeafTint;
uniform vec3 uLeafFlat;
uniform float uAlphaRef;
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying float vAo;
varying vec4 vInst;
varying float vH;

void main() {
  ${clipWater}
  vec4 tex = texture(uAtlas, vUv);
  // keep foliage coverage stable under minification
  vec2 tsz = vec2(textureSize(uAtlas, 0));
  vec2 dx = dFdx(vUv * tsz), dy = dFdy(vUv * tsz);
  float lvl = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  float a = tex.a * (1.0 + lvl * 0.28);
  a = (a - uAlphaRef) / max(fwidth(a), 1e-4) + 0.5;
  if (a < 0.5) discard;
  vec3 V = normalize(cameraPosition - vWp);
  vec3 N = normalize(vN);
  // seasonal variety per tree
  vec3 tint = uLeafTint * (0.72 + vInst.y * 0.42);
  tint *= mix(vec3(0.92, 1.0, 1.05), vec3(1.2, 1.06, 0.68), vInst.x);
  vec3 alb = tex.rgb * tint;
  alb = styleAlbedo(alb, uLeafFlat * tint * (0.9 + 0.2 * vAo));
  Surf s = surfDefault(alb, N);
  s.ao = vAo * vAo;
  s.trans = 0.6;
  s.wrap = 0.4;
  s.rough = 0.6;
  s.spec = 0.25;
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWp, N, abs(ndl)) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, saturate(a));
}
`;

export const barkFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
uniform sampler2D uBarkC;
uniform sampler2D uBarkN;
uniform int uBarkKind; // 0 brown, 1 pine, 2 birch
uniform vec3 uBarkFlat;
varying vec3 vWp;
varying vec3 vN;
varying vec2 vUv;
varying float vAo;
varying vec4 vInst;
varying float vH;

vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 tn) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
  return normalize(mat3(T * invmax, B * invmax, N) * tn);
}

void main() {
  ${clipWater}
  vec2 uv = vUv * vec2(1.0, 1.0);
  vec3 N = normalize(vN);
  vec3 alb;
  vec3 tn = vec3(0.0, 0.0, 1.0);
  float rough = 0.85;
  if (uBarkKind == 2) {
    // birch: chalky white with dark lenticels and a dark fissured foot
    float n1 = noise4(vec2(uv.x * 0.5, uv.y * 0.12)).g;
    float n2 = noise4(vec2(uv.x * 1.3, uv.y * 0.9)).b;
    float stripes = smoothstep(0.62, 0.7, n1) * smoothstep(0.3, 0.6, n2);
    alb = mix(vec3(0.78, 0.76, 0.7), vec3(0.06, 0.05, 0.05), stripes);
    alb = mix(alb, vec3(0.12, 0.1, 0.08), smoothstep(0.08, 0.015, vH) * 0.9);
    tn = normalize(vec3((n2 - 0.5) * 0.4, (n1 - 0.5) * 0.8, 1.0));
    rough = 0.7;
  } else {
    vec2 buv = uv * vec2(1.0, 0.5);
    vec4 c = texture(uBarkC, buv);
    vec4 nn = texture(uBarkN, buv);
    alb = c.rgb * (uBarkKind == 1 ? vec3(0.95, 0.85, 0.8) : vec3(0.9, 0.88, 0.85));
    tn = vec3(nn.xy * 2.0 - 1.0, 0.0);
    tn.z = sqrt(max(1.0 - dot(tn.xy, tn.xy), 0.0));
    tn.xy *= 1.4;
    rough = nn.b;
    // moss on the shaded, lower side
    float moss = smoothstep(0.2, 0.9, noise4(vWp.xz * 0.3 + vWp.y * 0.15).g) * smoothstep(0.6, 0.0, vH) * smoothstep(0.2, -0.6, dot(N, uSunDir));
    alb = mix(alb, vec3(0.09, 0.13, 0.03), moss * 0.7);
  }
  alb = styleAlbedo(alb, uBarkFlat);
  N = perturb(N, vWp, vUv * 4.0, normalize(mix(vec3(0.0, 0.0, 1.0), tn, uStyleA.x)));
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, N);
  s.ao = vAo;
  s.rough = rough;
  s.spec = 0.3;
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWp, normalize(vN), ndl) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Depth-only variant for shadow maps (same wind, alpha tested)
export const vegDepthFrag = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uIsLeaf;
varying vec2 vUv;
void main() {
  if (uIsLeaf > 0.5 && texture(uAtlas, vUv).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

// Billboard impostors for distant trees
export const impVert = /* glsl */ `
${commonPars}
${windPars}
attribute vec4 aImp; // x cell, y width, z height, w brightness
attribute vec4 aInst;
uniform vec2 uCells; // columns, rows
varying vec3 vWp;
varying vec2 vUv;
varying vec3 vN;
varying vec4 vInst;
varying float vCell;
void main() {
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec3 origin = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = cameraPosition - origin;
  toCam.y = 0.0;
  toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  vec3 up = vec3(0.0, 1.0, 0.0);
  float w = aImp.y, h = aImp.z;
  vec3 wp = origin + right * position.x * w + up * position.y * h;
  // gentle sway at the top
  wp += windSway(origin, aInst.z, 0.75) * position.y * position.y * h * 0.02;
  vWp = wp;
  vN = normalize(right * position.x * 1.6 + toCam * 0.7 + up * (position.y - 0.45) * 1.1);
  float cell = aImp.x;
  vec2 cr = vec2(mod(cell, uCells.x), floor(cell / uCells.x));
  vUv = (cr + vec2(position.x + 0.5, position.y)) / uCells;
  vInst = aInst;
  vCell = cell;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const impFrag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
uniform sampler2D uImpAtlas;
uniform vec3 uLeafTint;
varying vec3 vWp;
varying vec2 vUv;
varying vec3 vN;
varying vec4 vInst;
varying float vCell;
void main() {
  ${clipWater}
  vec4 tex = texture(uImpAtlas, vUv);
  float a = (tex.a - 0.5) / max(fwidth(tex.a), 1e-4) + 0.5;
  if (a < 0.5) discard;
  vec3 tint = (0.72 + vInst.y * 0.42) * mix(vec3(0.92, 1.0, 1.05), vec3(1.2, 1.06, 0.68), vInst.x);
  vec3 alb = tex.rgb * tint;
  alb = styleAlbedo(alb, alb);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWp);
  Surf s = surfDefault(alb, N);
  s.trans = 0.5; s.wrap = 0.5; s.rough = 0.7; s.spec = 0.15;
  s.ao = 0.85;
  float sh = sunShadow(vWp, N, 0.5) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, saturate(a));
}
`;

export const impDepthFrag = /* glsl */ `
uniform sampler2D uImpAtlas;
varying vec2 vUv;
void main() {
  if (texture(uImpAtlas, vUv).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

// Capture shader (writes albedo * ao with coverage) for impostor baking
export const captureFrag = /* glsl */ `
uniform sampler2D uAtlas;
uniform sampler2D uBarkC;
uniform float uIsLeaf;
uniform int uBarkKind;
uniform vec3 uLeafTint;
varying vec2 vUv;
varying float vAo;
varying vec3 vN;
void main() {
  vec3 c;
  if (uIsLeaf > 0.5) {
    vec4 t = texture(uAtlas, vUv);
    if (t.a < 0.5) discard;
    c = t.rgb * uLeafTint;
  } else {
    c = uBarkKind == 2 ? vec3(0.7, 0.68, 0.62) : texture(uBarkC, vUv * vec2(1.0, 0.5)).rgb * 0.8;
  }
  float facing = 0.75 + 0.25 * normalize(vN).z;
  gl_FragColor = vec4(c * (0.55 + 0.45 * vAo) * facing, 1.0);
}
`;
