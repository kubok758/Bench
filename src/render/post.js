import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BlendFunction,
  BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, GodRaysEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { U } from './uniforms.js';

// 8 sectors x 3 rays for the polar Kuwahara, precomputed
const KDIR = Array.from({ length: 24 }, (_, i) => {
  const a = Math.floor(i / 3) * Math.PI / 4 + ((i % 3) - 1) * 0.3;
  return `vec2(${Math.cos(a).toFixed(5)}, ${Math.sin(a).toFixed(5)})`;
}).join(', ');

const stylizeFrag = /* glsl */ `
const vec2 KDIR[24] = vec2[24](${KDIR});
uniform int uMode;
uniform vec4 uOutline;      // x width px, y strength, z silhouette threshold, w fade distance
uniform vec3 uOutlineColor;
uniform float uOutlineTint;  // 0 = flat ink colour, 1 = darkened local colour
uniform float uKuwahara;     // radius (0 off)
uniform vec4 uGrade;         // x contrast, y saturation, z exposure, w posterize levels (0 off)
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadowTone;
uniform vec3 uHighTone;
uniform vec4 uFX;            // x vignette, y grain, z chromatic aberration, w paper
uniform vec4 uFX2;           // x halftone, y hatching, z brush strokes, w crease lines
uniform sampler2D uNoise;
uniform float uFrame;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float viewDist(vec2 uv) {
  float d = readDepth(uv);
  return -getViewZ(d);
}

// Generalised (8-sector, polar) Kuwahara: round, stroke-like cells instead of the
// square blocks of the classic 4-quadrant filter. Each sector shares the centre tap.
vec3 kuwahara(vec2 uv, float radius) {
  vec3 c0 = texture2D(inputBuffer, uv).rgb;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  vec2 ts = texelSize * radius * 1.3;
  for (int k = 0; k < 8; k++) {
    vec3 m = c0, s = c0 * c0;
    for (int j = 0; j < 3; j++) {
      vec2 dir = KDIR[k * 3 + j] * ts;
      vec3 c1 = texture2D(inputBuffer, uv + dir * 0.5).rgb;
      vec3 c2 = texture2D(inputBuffer, uv + dir).rgb;
      m += c1 + c2; s += c1 * c1 + c2 * c2;
    }
    m /= 7.0; s /= 7.0;
    vec3 v = abs(s - m * m);
    float q = (v.r + v.g + v.b) * 40.0;
    float w = 1.0 / (1e-4 + q * q * q * q);
    acc += m * w; wsum += w;
  }
  return acc / wsum;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  vec2 px = uv * resolution;

  if (uKuwahara > 0.5) col = kuwahara(uv, uKuwahara);

  if (uFX.z > 0.0) {
    vec2 dir = (uv - 0.5);
    float k = uFX.z * dot(dir, dir) * 4.0;
    col.r = texture2D(inputBuffer, uv - dir * k).r;
    col.b = texture2D(inputBuffer, uv + dir * k).b;
  }

  // ---- ink lines from depth (silhouettes) + inverse-depth Laplacian (creases)
  float d = viewDist(uv);
  if (uOutline.y > 0.0) {
    vec2 t = texelSize * uOutline.x;
    float jitter = 1.0;
    if (uMode == 1) {
      // hand-drawn wobble for the painterly line
      jitter = 0.65 + 0.7 * texture2D(uNoise, uv * 3.0 + uFrame * 0.0).g;
      t *= jitter;
    }
    float dl = viewDist(uv - vec2(t.x, 0.0));
    float dr = viewDist(uv + vec2(t.x, 0.0));
    float du = viewDist(uv + vec2(0.0, t.y));
    float dd = viewDist(uv - vec2(0.0, t.y));
    float far = max(max(dl, dr), max(du, dd));
    float sil = far - d;
    float silE = smoothstep(uOutline.z, uOutline.z * 2.2, sil / max(d, 0.5));
    float w = 1.0 / max(d, 0.01);
    float lap = abs(1.0 / max(dl, 0.01) + 1.0 / max(dr, 0.01) + 1.0 / max(du, 0.01) + 1.0 / max(dd, 0.01) - 4.0 * w) / w;
    float creaseE = smoothstep(0.08, 0.22, lap) * uFX2.w;
    float e = max(silE, creaseE);
    e *= 1.0 - smoothstep(uOutline.w * 0.45, uOutline.w, d);
    vec3 ink = mix(uOutlineColor, col * col * 0.6, uOutlineTint);
    col = mix(col, ink, saturate(e * uOutline.y));
  }

  float L = lum(col);

  // ---- halftone dots in the shadows (cartoon)
  if (uFX2.x > 0.0) {
    float ang = 0.785;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    float cell = 6.0;
    vec2 g = R * px / cell;
    vec2 f = fract(g) - 0.5;
    float dark = saturate((0.045 - L) / 0.045);
    float near = 1.0 - smoothstep(60.0, 160.0, d);
    float rad = sqrt(dark) * 0.5;
    float dotM = 1.0 - smoothstep(rad - 0.08, rad + 0.08, length(f));
    col = mix(col, col * 0.5, dotM * uFX2.x * near);
  }

  // ---- hatching in shadows (painterly)
  if (uFX2.y > 0.0) {
    float n = texture2D(uNoise, uv * 2.3).r;
    float s1 = sin((px.x + px.y) * 0.9 + n * 9.0);
    float s2 = sin((px.x - px.y) * 0.75 + n * 7.0);
    float dark = saturate((0.22 - L) / 0.22);
    float h = smoothstep(0.75, 0.95, s1) * smoothstep(0.0, 0.5, dark) + smoothstep(0.82, 0.97, s2) * smoothstep(0.5, 1.0, dark);
    col = mix(col, col * vec3(0.55, 0.5, 0.75), h * uFX2.y);
  }

  // ---- brush-stroke value modulation (painterly): two families of short directional
  // strokes in fixed orientations, blended by a slow field (no swirling coordinates)
  if (uFX2.z > 0.0) {
    vec2 b1 = mat2(0.94, -0.34, 0.34, 0.94) * px;
    vec2 b2 = mat2(0.77, 0.64, -0.64, 0.77) * px;
    float st1 = texture2D(uNoise, b1 / vec2(760.0, 300.0)).a;
    float st2 = texture2D(uNoise, b2 / vec2(700.0, 280.0) + 0.37).a;
    float sel = smoothstep(0.38, 0.62, texture2D(uNoise, uv * 0.7 + 0.13).g);
    float st = mix(st1, st2, sel);
    // strokes show in the paint, not in the haze and sky
    float skyK = 1.0 - smoothstep(600.0, 3000.0, d) * 0.8;
    col *= 1.0 + (st - 0.5) * 0.12 * uFX2.z * skyK;
  }

  // ---- grading
  col *= uGrade.z;
  col = max(col * uGain + uLift * (1.0 - col), 0.0);
  col = pow(col, 1.0 / uGamma);
  float l2 = lum(col);
  col *= mix(uShadowTone, uHighTone, smoothstep(0.05, 0.65, l2));
  // contrast in a perceptual-ish space
  vec3 g = pow(max(col, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * uGrade.x + 0.5;
  if (uGrade.w > 0.5) {
    // value-only posterisation with soft steps: flat cartoon plateaus without hue shifts,
    // fading out with distance so far hills stay clean
    float Lg = max(dot(g, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    float x = Lg * uGrade.w;
    float q = (floor(x) + smoothstep(0.4, 0.6, fract(x))) / uGrade.w;
    float fade = 1.0 - smoothstep(160.0, 380.0, d);
    g *= mix(1.0, clamp(q / Lg, 0.7, 1.4), fade);
  }
  col = pow(max(g, 0.0), vec3(2.2));
  float l3 = lum(col);
  col = max(mix(vec3(l3), col, uGrade.y), 0.0);

  // ---- paper / canvas grain
  if (uFX.w > 0.0) {
    float p1 = texture2D(uNoise, px / 900.0).a;
    float p2 = texture2D(uNoise, px / 260.0 + 0.5).a;
    float weave = sin(px.x * 1.9) * sin(px.y * 1.9) * 0.5 + 0.5;
    col *= 1.0 + ((p1 - 0.5) * 0.1 + (p2 - 0.5) * 0.12 + (weave - 0.5) * 0.06) * uFX.w;
  }

  // ---- vignette + grain
  vec2 vc = uv - 0.5;
  float vig = 1.0 - dot(vc, vc) * uFX.x * 2.2;
  col *= saturate(vig);
  if (uFX.y > 0.0) {
    float gr = fract(sin(dot(px + uFrame * 13.37, vec2(12.9898, 78.233))) * 43758.5453);
    col += (gr - 0.5) * uFX.y * (0.4 + 0.6 * sqrt(max(lum(col), 0.0)));
  }

  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`;

class StylizeEffect extends Effect {
  constructor(noiseTex) {
    super('StylizeEffect', stylizeFrag, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uMode', new THREE.Uniform(0)],
        ['uOutline', new THREE.Uniform(new THREE.Vector4(1, 0, 0.1, 400))],
        ['uOutlineColor', new THREE.Uniform(new THREE.Color(0.05, 0.04, 0.05))],
        ['uOutlineTint', new THREE.Uniform(0)],
        ['uKuwahara', new THREE.Uniform(0)],
        ['uGrade', new THREE.Uniform(new THREE.Vector4(1, 1, 1, 0))],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['uGamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uShadowTone', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uHighTone', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uFX', new THREE.Uniform(new THREE.Vector4(0.2, 0, 0, 0))],
        ['uFX2', new THREE.Uniform(new THREE.Vector4(0, 0, 0, 0))],
        ['uNoise', new THREE.Uniform(noiseTex)],
        ['uFrame', new THREE.Uniform(0)],
      ]),
    });
  }
}

// Ray-marched sun scattering through the cascaded shadow maps (light shafts in the haze).
const volumetricFrag = /* glsl */ `
uniform sampler2DShadow uShadowMap0;
uniform sampler2DShadow uShadowMap1;
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uSunDirV;
uniform vec3 uSunCol;
uniform vec4 uVol; // x strength, y max distance, z density, w anisotropy
uniform float uVolFrame;
uniform float uVolJitter;

vec3 viewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * ndc;
  return v.xyz / v.w;
}
float shadowAt(vec3 wp) {
  vec3 c0 = (uShadowMat0 * vec4(wp, 1.0)).xyz;
  if (c0.x > 0.01 && c0.x < 0.99 && c0.y > 0.01 && c0.y < 0.99 && c0.z < 1.0) return texture(uShadowMap0, vec3(c0.xy, c0.z - 0.003));
  vec3 c1 = (uShadowMat1 * vec4(wp, 1.0)).xyz;
  if (c1.x > 0.0 && c1.x < 1.0 && c1.y > 0.0 && c1.y < 1.0 && c1.z < 1.0) return texture(uShadowMap1, vec3(c1.xy, c1.z - 0.004));
  return 1.0;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uVol.x <= 0.0) { outputColor = inputColor; return; }
  vec3 vp = viewPos(uv, depth);
  float dist = min(length(vp), uVol.y);
  // stop short of the surface itself: samples on it self-shadow into moire stripes
  float marchL = max(min(dist, length(vp) - 2.0) , 0.0);
  vec3 dirV = normalize(vp);
  vec3 camW = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 dirW = normalize((uCamWorld * vec4(dirV, 0.0)).xyz);
  const int N = 14;
  // white-noise jitter: unstructured grain (an ordered dither shows up as diagonal streaks
  // without a temporal resolve)
  float jitter = uVolJitter > 0.5 ? fract(sin(dot(gl_FragCoord.xy + uVolFrame * 1.618, vec2(12.9898, 78.233))) * 43758.5453) : 0.5;
  float stepL = marchL / float(N);
  float acc = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + jitter) * stepL;
    vec3 p = camW + dirW * t;
    // denser near the ground, thinning with altitude
    float h = exp(-max(p.y, 0.0) * 0.03);
    acc += shadowAt(p) * h;
  }
  acc /= float(N);
  float g = uVol.w;
  float cosT = dot(dirW, uSunDirV);
  float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.0796;
  float amount = (1.0 - exp(-dist * uVol.z));
  vec3 scatter = uSunCol * acc * phase * amount * uVol.x;
  outputColor = vec4(inputColor.rgb + scatter, inputColor.a);
}
`;

class VolumetricEffect extends Effect {
  constructor() {
    super('VolumetricEffect', volumetricFrag, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uShadowMap0', new THREE.Uniform(null)], ['uShadowMap1', new THREE.Uniform(null)],
        ['uShadowMat0', new THREE.Uniform(new THREE.Matrix4())], ['uShadowMat1', new THREE.Uniform(new THREE.Matrix4())],
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())], ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uSunDirV', new THREE.Uniform(new THREE.Vector3())], ['uSunCol', new THREE.Uniform(new THREE.Color())],
        ['uVol', new THREE.Uniform(new THREE.Vector4(0, 140, 0.012, 0.65))], ['uVolFrame', new THREE.Uniform(0)], ['uVolJitter', new THREE.Uniform(1)],
      ]),
    });
  }
}

class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */ `
      uniform float uExposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
      }`, { uniforms: new Map([['uExposure', new THREE.Uniform(1)]]) });
  }
}

export class PostChain {
  constructor(renderer, scene, camera, { noiseTex, sunMesh, samples = 4 }) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: samples });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    Object.assign(this.ao.configuration, {
      aoRadius: 2.2, distanceFalloff: 1.2, intensity: 2.6, halfRes: true, gammaCorrection: false,
      aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10, depthAwareUpsampling: true,
      color: new THREE.Color(0.06, 0.07, 0.1),
    });
    this.composer.addPass(this.ao);

    this.exposure = new ExposureEffect();
    this.bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.godrays = new GodRaysEffect(camera, sunMesh, {
      resolutionScale: 0.5, density: 0.95, decay: 0.93, weight: 0.32, exposure: 0.42, samples: 64, clampMax: 1.0,
      kernelSize: KernelSize.LARGE, blur: true,
    });
    this.godrays.blendMode.opacity.value = 0;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.volumetric = new VolumetricEffect();
    this.camera = camera;
    this.hdrPass = new EffectPass(camera, this.volumetric, this.exposure, this.godrays, this.bloom, this.tone);
    this.composer.addPass(this.hdrPass);

    this.stylize = new StylizeEffect(noiseTex);
    this.stylePass = new EffectPass(camera, this.stylize);
    this.composer.addPass(this.stylePass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.aaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.aaPass);
    this.frame = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.ao.setSize?.(w, h);
  }

  apply(style) {
    const p = style.post;
    const su = this.stylize.uniforms;
    this.ao.enabled = p.ao > 0;
    if (p.ao > 0) {
      this.ao.configuration.intensity = p.ao;
      this.ao.configuration.aoRadius = p.aoRadius ?? 2.2;
      this.ao.configuration.halfRes = !p.aoFull;
      this.ao.configuration.aoSamples = p.aoFull ? 16 : 10;
    }
    this.exposure.uniforms.get('uExposure').value = p.exposure;
    this.bloom.intensity = p.bloom;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.bloom.luminanceMaterial.smoothing = p.bloomSmoothing ?? 0.25;
    this.bloom.mipmapBlurPass.radius = p.bloomRadius ?? 0.72;
    this.godrays.blendMode.opacity.value = p.godrays;
    this.volumetric.uniforms.get('uVol').value.set(p.volumetric ?? 0, p.volDistance ?? 140, p.volDensity ?? 0.012, p.volG ?? 0.55);
    if (this.tone.mode !== p.tone) this.tone.mode = p.tone;

    su.get('uMode').value = style.id;
    su.get('uOutline').value.set(p.outline.width, p.outline.strength, p.outline.threshold, p.outline.fade);
    su.get('uOutlineColor').value.set(...p.outline.color);
    su.get('uOutlineTint').value = p.outline.tint;
    su.get('uKuwahara').value = p.kuwahara;
    su.get('uGrade').value.set(p.contrast, p.saturation, p.gradeExposure ?? 1, p.posterize ?? 0);
    su.get('uLift').value.set(...p.lift);
    su.get('uGamma').value.set(...p.gamma);
    su.get('uGain').value.set(...p.gain);
    su.get('uShadowTone').value.set(...p.shadowTone);
    su.get('uHighTone').value.set(...p.highTone);
    su.get('uFX').value.set(p.vignette, p.grain, p.chroma, p.paper);
    su.get('uFX2').value.set(p.halftone, p.hatching, p.brush, p.crease ?? 0);
    this.aaPass.enabled = !!p.smaa;
    this.stylePass.renderToScreen = !p.smaa;
    this.aaPass.renderToScreen = !!p.smaa;
  }

  render(dt) {
    const vu = this.volumetric.uniforms;
    vu.get('uShadowMap0').value = U.uShadowMap0.value;
    vu.get('uShadowMap1').value = U.uShadowMap1.value;
    vu.get('uShadowMat0').value.copy(U.uShadowMat0.value);
    vu.get('uShadowMat1').value.copy(U.uShadowMat1.value);
    vu.get('uProjInv').value.copy(this.camera.projectionMatrixInverse);
    vu.get('uCamWorld').value.copy(this.camera.matrixWorld);
    vu.get('uSunDirV').value.copy(U.uSunDir.value);
    vu.get('uSunCol').value.copy(U.uSunColor.value);
    vu.get('uVolFrame').value = this.frame % 64;
    this.stylize.uniforms.get('uFrame').value = this.frame++ % 1000;
    this.composer.render(dt);
  }
}

export { ToneMappingMode };
export const _U = U;
