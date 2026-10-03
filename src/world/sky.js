import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars } from '../render/shaders/lib.js';

export const skyUniforms = {
  uZenith: { value: new THREE.Color(0.12, 0.28, 0.62) },
  uHorizon: { value: new THREE.Color(0.62, 0.72, 0.82) },
  uSkyGround: { value: new THREE.Color(0.35, 0.38, 0.4) },
  uSunGlow: { value: new THREE.Color(1.0, 0.75, 0.45) },
  // x sun disk size (cos), y sun disk intensity, z horizon exponent, w cloud detail
  uSkyParams: { value: new THREE.Vector4(0.99996, 40, 3.2, 1) },
  uCloudLit: { value: new THREE.Color(1.0, 0.96, 0.9) },
  uCloudShade: { value: new THREE.Color(0.45, 0.5, 0.6) },
};

const skyFns = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSunGlow;
uniform vec4 uSkyParams;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;

vec3 skyBase(vec3 dir) {
  float y = dir.y;
  float yy = max(y, 0.0);
  float hz = pow(1.0 - yy, uSkyParams.z);
  vec3 col;
  if (uStyle == 3) {
    // cartoon: stepped bands
    float b = floor(hz * 4.0 + 0.5) / 4.0;
    col = mix(uZenith, uHorizon, b);
  } else if (uStyle == 1) {
    // painterly: warm/cool push with soft bands
    float b = floor(hz * 6.0) / 6.0;
    col = mix(uZenith, uHorizon, mix(hz, b, 0.45));
  } else {
    col = mix(uZenith, uHorizon, hz);
  }
  col = mix(col, uSkyGround, smoothstep(0.0, -0.12, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 5.0) * 0.28 + pow(sd, 32.0) * 0.45 + pow(sd, 400.0) * 1.2;
  col += uSunGlow * glow * (0.35 + 0.65 * hz);
  return col;
}
`;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */ `
${commonPars}
${shadowPars}
${skyFns}
varying vec3 vDir;

float cloudField(vec2 xz, float detail) { return cloudNoise(xz, detail); }

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float sd = max(dot(dir, uSunDir), 0.0);

  // sun disk
  float disk = smoothstep(uSkyParams.x, uSkyParams.x + 0.00002, sd);
  if (uStyle == 3) disk = step(0.9993, sd);
  if (uStyle == 2) disk = smoothstep(0.9990, 0.9996, sd);

  // clouds on a curved layer
  if (dir.y > 0.0) {
    float t = (uCloudHeight - cameraPosition.y) / max(dir.y, 0.015);
    vec2 xz = cameraPosition.xz + dir.xz * t;
    float detail = uSkyParams.w;
    float n = cloudField(xz, detail);
    float cov = uCloud.z;
    float lo = 1.0 - cov - 0.1;
    float dens;
    if (uStyle == 2) dens = smoothstep(lo + 0.05, lo + 0.08, n);
    else if (uStyle == 3) dens = step(lo + 0.06, n);
    else if (uStyle == 1) dens = smoothstep(lo, lo + 0.2, n);
    else dens = smoothstep(lo, lo + 0.22, n);
    // puffy shading: normal from the density gradient + occlusion toward the sun
    float e = 90.0;
    float nx = cloudField(xz + vec2(e, 0.0), 1.0), nz = cloudField(xz + vec2(0.0, e), 1.0);
    vec3 cn = normalize(vec3(-(nx - n) * 14.0, 1.0, -(nz - n) * 14.0));
    vec2 ts = normalize(uSunDir.xz + 1e-4);
    float n1 = cloudField(xz + ts * 220.0, 1.0);
    float n2 = cloudField(xz + ts * 520.0, 1.0);
    float occ = smoothstep(lo, lo + 0.3, n1) * 0.55 + smoothstep(lo, lo + 0.3, n2) * 0.45;
    float thick = smoothstep(lo, lo + 0.35, n);
    float lam = saturate(dot(cn, uSunDir) * 0.6 + 0.5);
    float lightAmt = exp(-occ * 1.6) * mix(0.55, 1.0, lam) * (1.0 - thick * 0.25);
    vec3 cl;
    if (uStyle == 2) {
      float q = smoothstep(0.38, 0.46, lightAmt);
      cl = mix(uCloudShade, uCloudLit, q);
      cl += uSunGlow * pow(sd, 12.0) * 0.6;
    } else if (uStyle == 3) {
      float q = step(0.42, lightAmt);
      cl = mix(uCloudShade, uCloudLit, q);
      // ink rim around the cloud shapes
      float rim = 1.0 - smoothstep(0.0, 0.022, abs(n - (lo + 0.06)));
      cl = mix(cl, uCloudShade * 0.45, rim * 0.85);
      dens = max(dens, rim);
    } else if (uStyle == 1) {
      float q = floor(lightAmt * 4.0 + 0.5) / 4.0;
      q = mix(lightAmt, q, 0.65);
      cl = mix(uCloudShade, uCloudLit, q);
      cl += uSunGlow * pow(sd, 8.0) * (1.0 - thick) * 0.8;
    } else {
      cl = mix(uCloudShade, uCloudLit, lightAmt);
      // silver lining when looking toward the sun through thin edges
      cl += uSunColor * 0.12 * pow(sd, 6.0) * (1.0 - thick) * 1.5;
      cl += uSunGlow * pow(sd, 3.0) * 0.12;
    }
    // haze the far layer into the horizon
    float fade = smoothstep(0.0, 0.16, dir.y);
    vec3 hazeCol = col;
    cl = mix(hazeCol, cl, 0.25 + 0.75 * smoothstep(0.02, 0.3, dir.y));
    col = mix(col, cl, dens * fade);
    disk *= 1.0 - dens * fade;

    // high cirrus streaks in ultra mode
    if (uStyle == 4 || uStyle == 0) {
      float t2 = (9000.0 - cameraPosition.y) / max(dir.y, 0.02);
      vec2 c2 = (cameraPosition.xz + dir.xz * t2) / vec2(26000.0, 9000.0) + uCloud.xy * 0.6;
      float ci = smoothstep(0.55, 0.85, fbmTex(c2 + vec2(0.3, 0.1))) * smoothstep(0.05, 0.3, dir.y);
      col = mix(col, uCloudLit * 1.1, ci * (uStyle == 4 ? 0.35 : 0.2) * (1.0 - dens));
    }
  }

  vec3 sunCol = uStyle == 3 ? vec3(1.0, 0.95, 0.6) * 3.0 : uSunColor * uSkyParams.y;
  col = mix(col, sunCol, disk);
  gl_FragColor = vec4(col, 1.0);
}
`;

const lutFrag = /* glsl */ `
${commonPars}
${skyFns}
varying vec2 vUv;
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float el = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  gl_FragColor = vec4(skyBase(dir), 1.0);
}
`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...skyUniforms },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.scale.setScalar(9000);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  mesh.onBeforeRender = (r, s, cam) => mesh.position.copy(cam.position);

  // LUT (equirectangular, clear sky) for fog colour lookups
  const lut = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, depthBuffer: false });
  lut.texture.wrapS = THREE.RepeatWrapping;
  lut.texture.minFilter = lut.texture.magFilter = THREE.LinearFilter;
  lut.texture.generateMipmaps = false;
  U.uSkyLUT.value = lut.texture;
  const lutScene = new THREE.Scene();
  const lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lutMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...skyUniforms },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: lutFrag,
    depthTest: false,
    depthWrite: false,
  });
  lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lutMat));

  function updateLUT(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(lut);
    renderer.render(lutScene, lutCam);
    renderer.setRenderTarget(prev);
  }
  return { mesh, updateLUT, lut };
}
