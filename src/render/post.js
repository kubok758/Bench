import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BlendFunction,
  BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, GodRaysEffect, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { U } from './uniforms.js';

const stylizeFrag = /* glsl */ `
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

vec3 kuwahara(vec2 uv, float radius) {
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  int r = int(radius);
  // jitter the kernel orientation with a slow noise field -> brush-stroke flow
  float a = texture2D(uNoise, uv * 1.7).r * 6.2831 * 0.35;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 ts = texelSize * 1.25;
  float n = 0.0;
  for (int j = 0; j <= 6; j++) {
    if (j > r) break;
    for (int i = 0; i <= 6; i++) {
      if (i > r) break;
      vec2 o = R * vec2(float(i), float(j)) * ts;
      vec2 o2 = R * vec2(float(i), -float(j)) * ts;
      vec3 c0 = texture2D(inputBuffer, uv - o).rgb;
      vec3 c1 = texture2D(inputBuffer, uv + o2).rgb;
      vec3 c2 = texture2D(inputBuffer, uv - o2).rgb;
      vec3 c3 = texture2D(inputBuffer, uv + o).rgb;
      m0 += c0; s0 += c0 * c0;
      m1 += c1; s1 += c1 * c1;
      m2 += c2; s2 += c2 * c2;
      m3 += c3; s3 += c3 * c3;
      n += 1.0;
    }
  }
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec3 v0 = abs(s0 / n - m0 * m0), v1 = abs(s1 / n - m1 * m1), v2 = abs(s2 / n - m2 * m2), v3 = abs(s3 / n - m3 * m3);
  float q0 = v0.r + v0.g + v0.b, q1 = v1.r + v1.g + v1.b, q2 = v2.r + v2.g + v2.b, q3 = v3.r + v3.g + v3.b;
  // soft selection (weights ~ 1/var^k) avoids blocky artefacts
  float w0 = 1.0 / (1e-5 + pow(q0 * 40.0, 4.0));
  float w1 = 1.0 / (1e-5 + pow(q1 * 40.0, 4.0));
  float w2 = 1.0 / (1e-5 + pow(q2 * 40.0, 4.0));
  float w3 = 1.0 / (1e-5 + pow(q3 * 40.0, 4.0));
  return (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / (w0 + w1 + w2 + w3);
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
    float dark = saturate((0.32 - L) / 0.32);
    float rad = sqrt(dark) * 0.55;
    float dotM = 1.0 - smoothstep(rad - 0.08, rad + 0.08, length(f));
    col = mix(col, col * 0.45, dotM * uFX2.x);
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

  // ---- brush-stroke value modulation (painterly)
  if (uFX2.z > 0.0) {
    vec2 bp = px / vec2(46.0, 13.0);
    float a = texture2D(uNoise, uv * 0.6).g * 3.0;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    float st = texture2D(uNoise, R * bp * 0.05).b;
    col *= 1.0 + (st - 0.5) * 0.22 * uFX2.z;
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
  if (uGrade.w > 0.5) g = floor(g * uGrade.w + 0.5) / uGrade.w;
  col = pow(max(g, 0.0), vec3(2.2));
  float l3 = lum(col);
  col = max(mix(vec3(l3), col, uGrade.y), 0.0);

  // ---- paper / canvas grain
  if (uFX.w > 0.0) {
    float p1 = texture2D(uNoise, px / 210.0).a;
    float p2 = texture2D(uNoise, px / 37.0).b;
    float weave = sin(px.x * 1.9) * sin(px.y * 1.9) * 0.5 + 0.5;
    col *= 1.0 + ((p1 - 0.5) * 0.18 + (p2 - 0.5) * 0.12 + (weave - 0.5) * 0.05) * uFX.w;
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
      resolutionScale: 0.5, density: 0.95, decay: 0.93, weight: 0.32, exposure: 0.42, samples: 48, clampMax: 1.0,
      kernelSize: KernelSize.SMALL, blur: true,
    });
    this.godrays.blendMode.opacity.value = 0;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.hdrPass = new EffectPass(camera, this.exposure, this.godrays, this.bloom, this.tone);
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
    this.stylize.uniforms.get('uFrame').value = this.frame++ % 1000;
    this.composer.render(dt);
  }
}

export { ToneMappingMode };
export const _U = U;
