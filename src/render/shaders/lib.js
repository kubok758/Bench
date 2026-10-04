// Shared GLSL library. Every world shader is assembled from these chunks.

export const commonPars = /* glsl */ `
uniform float uTime;
uniform int uStyle;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec4 uFog;
uniform vec3 uFogTint;
uniform vec3 uSunScatter;
uniform vec4 uWind;
uniform vec4 uCloud;
uniform float uCloudHeight;
uniform sampler2D uNoiseTex;
uniform sampler2D uCellTex;
uniform sampler2D uSkyLUT;
uniform vec4 uWorld;
uniform vec4 uStyleA;
uniform vec4 uStyleB;
uniform vec4 uStyleC;
uniform vec3 uShadowTint;
uniform vec3 uRimColor;
uniform vec3 uLightTint;
uniform float uClipWater;
uniform int uDebug;

#define PI 3.14159265
#define saturate(x) clamp(x, 0.0, 1.0)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
// tileable multi-octave value noise packed in RGBA (freq 4, 8, 16, 32 per tile)
vec4 noise4(vec2 uv) { return texture(uNoiseTex, uv); }
float fbmTex(vec2 uv) {
  vec4 n = texture(uNoiseTex, uv);
  return dot(n, vec4(0.5333, 0.2667, 0.1333, 0.0667));
}
float noiseLo(vec2 uv) { return texture(uNoiseTex, uv).r; }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 adjustSat(vec3 c, float s) { float l = luma(c); return max(mix(vec3(l), c, s), 0.0); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Style-aware albedo conditioning: flatten detail toward the mean colour, push saturation.
vec3 styleAlbedo(vec3 detailed, vec3 flatCol) {
  vec3 c = mix(flatCol, detailed, uStyleA.x);
  // boost colourful surfaces, protect near-greys (stone, cobbles) from turning orange
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float chroma = (mx - mn) / max(mx, 1e-4);
  float k = mix(1.0 + (uStyleA.y - 1.0) * 0.25, uStyleA.y, smoothstep(0.12, 0.45, chroma));
  c = adjustSat(c, k);
  if (uStyleC.y != 0.0) {
    vec3 h = rgb2hsv(c);
    h.x = fract(h.x + uStyleC.y);
    c = hsv2rgb(h);
  }
  return c * uStyleC.z;
}
`;

// Shared grass palette: terrain and blades agree on colour.
export const grassPars = /* glsl */ `
vec3 grassBase(vec2 xz) {
  float m = fbmTex(xz * 0.0021 + 0.13);
  float m2 = noiseLo(xz * 0.011 + 0.7);
  vec3 lush = vec3(0.074, 0.150, 0.021);
  vec3 dry = vec3(0.235, 0.215, 0.050);
  float dryK = (uStyle == 2 || uStyle == 3) ? 0.25 : (uStyle == 1 ? 0.35 : 0.7);
  vec3 c = mix(lush, dry, smoothstep(0.5, 0.78, m) * dryK);
  c *= 0.85 + 0.3 * m2;
  return c;
}
`;

export const windPars = /* glsl */ `
// Large travelling gust field + local sway. Returns horizontal displacement scale.
float windGust(vec2 xz) {
  vec2 dir = uWind.xy;
  vec2 p = xz * 0.0045 - dir * uTime * 0.055;
  float g = noiseLo(p);
  float g2 = noiseLo(p * 2.7 + 0.37);
  return smoothstep(0.25, 0.85, g * 0.7 + g2 * 0.3);
}
vec3 windSway(vec3 wp, float phase, float freq) {
  vec2 dir = uWind.xy;
  float gust = windGust(wp.xz);
  float t = uTime * freq + phase + dot(wp.xz, dir) * 0.08;
  float s = sin(t) * 0.55 + sin(t * 2.31 + 1.7) * 0.25 + sin(t * 0.47) * 0.35;
  float amp = uWind.z * (0.35 + gust * uWind.w * 1.6);
  return vec3(dir.x, 0.0, dir.y) * (s * 0.35 + gust * 0.9) * amp
       + vec3(-dir.y, 0.0, dir.x) * sin(t * 0.83 + 2.1) * 0.18 * amp;
}
`;

export const shadowPars = /* glsl */ `
uniform sampler2DShadow uShadowMap0;
uniform sampler2DShadow uShadowMap1;
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform vec4 uShadowInfo;
uniform vec4 uShadowBias;

const vec2 kPoisson[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464),
  vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420),
  vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590),
  vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
);

float pcf(sampler2DShadow map, vec3 c, float radius, int taps) {
  float s = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= taps) break;
    s += texture(map, vec3(c.xy + kPoisson[i] * radius, c.z));
  }
  return s / float(taps);
}

bool inCascade(vec3 c, float margin) {
  return c.x > margin && c.x < 1.0 - margin && c.y > margin && c.y < 1.0 - margin && c.z < 1.0 && c.z > 0.0;
}

// Two cascades with a soft hand-over; returns 1 = fully lit.
float sunShadow(vec3 wp, vec3 n, float ndl) {
  if (uShadowInfo.w <= 0.0) return 1.0;
  float slope = 1.0 - saturate(ndl);
  int taps = uStyle == 4 ? 16 : 8;
  vec3 p0 = wp + n * uShadowBias.x * (0.6 + slope);
  vec3 c0 = (uShadowMat0 * vec4(p0, 1.0)).xyz;
  float lit = 1.0;
  if (inCascade(c0, 0.004)) {
    c0.z -= uShadowBias.z;
    lit = pcf(uShadowMap0, c0, uShadowInfo.x * uShadowInfo.z, taps);
    float edge = max(abs(c0.x - 0.5), abs(c0.y - 0.5)) * 2.0;
    float f = smoothstep(0.82, 0.97, edge);
    if (f > 0.0) {
      vec3 p1 = wp + n * uShadowBias.y * (0.6 + slope);
      vec3 c1 = (uShadowMat1 * vec4(p1, 1.0)).xyz;
      c1.z -= uShadowBias.w;
      float l1 = inCascade(c1, 0.002) ? pcf(uShadowMap1, c1, uShadowInfo.y * 1.2, 8) : 1.0;
      lit = mix(lit, l1, f);
    }
  } else {
    vec3 p1 = wp + n * uShadowBias.y * (0.6 + slope);
    vec3 c1 = (uShadowMat1 * vec4(p1, 1.0)).xyz;
    if (inCascade(c1, 0.002)) {
      c1.z -= uShadowBias.w;
      lit = pcf(uShadowMap1, c1, uShadowInfo.y * 1.2, 8);
      float edge = max(abs(c1.x - 0.5), abs(c1.y - 0.5)) * 2.0;
      lit = mix(lit, 1.0, smoothstep(0.85, 0.99, edge));
    }
  }
  return lit;
}

// Cloud layer (shared by the sky and the cloud shadows on the ground).
// A low-frequency coverage map eroded by cellular billows gives cumulus heaps.
float cloudNoise(vec2 xz, float detail) {
  vec2 uv = xz / 3400.0 + uCloud.xy;
  float cover = fbmTex(uv * 0.45 + 0.21);
  vec4 c = texture(uCellTex, uv);
  vec4 c2 = texture(uCellTex, uv * 2.3 + 0.37);
  float billow = c.r * 0.45 + c.g * 0.3 + c2.g * 0.15 + c2.b * 0.1;
  float d = cover * 0.62 + billow * 0.5 - 0.06;
  if (detail > 1.0) d += (texture(uCellTex, uv * 7.0 - uTime * 0.0006).a - 0.5) * 0.06;
  return d;
}
float cloudDensityAt(vec2 xz) {
  float lo = 1.0 - uCloud.z - 0.1;
  return smoothstep(lo, lo + 0.22, cloudNoise(xz, 1.0));
}
float cloudShadow(vec3 wp) {
  vec3 L = uSunDir;
  float t = (uCloudHeight - wp.y) / max(L.y, 0.05);
  vec2 xz = wp.xz + L.xz * t;
  return 1.0 - cloudDensityAt(xz) * uCloud.w;
}
`;

export const fogPars = /* glsl */ `
vec3 skyLUT(vec3 dir) {
  float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return texture(uSkyLUT, vec2(u, v)).rgb;
}

// Height fog + aerial perspective. The fog colour is the sky itself just above the
// horizon in that direction, so distant terrain melts into the sky naturally.
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  float fh = uFog.y;
  float camH = max(cameraPosition.y - uFog.z, 0.0);
  float ry = dir.y * fh;
  float integ = abs(ry) > 1e-4 ? (1.0 - exp(-dist * ry)) / ry : dist;
  float fogAmt = uFog.x * exp(-camH * fh) * integ;
  if (uStyle == 4) {
    vec2 mid = (cameraPosition.xz + wp.xz) * 0.5;
    fogAmt *= 0.45 + 1.3 * smoothstep(0.3, 0.75, fbmTex(mid * 0.0021 + uTime * 0.0004));
  }
  float aerial = 1.0 - exp(-dist * uFog.w);
  float t = 1.0 - exp(-fogAmt);
  t = max(t, aerial);
  t = saturate(t);
  vec3 hz = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35 + 0.035, dir.z));
  vec3 fogCol = skyLUT(hz) * uFogTint;
  float sunAmt = pow(saturate(dot(dir, uSunDir)), 6.0);
  fogCol += uSunScatter * sunAmt * 0.35 * t;
  return mix(col, fogCol, t);
}
float fogFactor(vec3 wp) {
  float dist = length(wp - cameraPosition);
  return 1.0 - exp(-dist * uFog.w);
}
`;

export const lightingPars = /* glsl */ `
struct Surf {
  vec3 albedo;
  vec3 N;
  float rough;
  float ao;
  float trans;     // foliage translucency
  float spec;      // specular amount (0..1)
  float wrap;      // wrapped diffuse
  vec3 emissive;
  float rimK;      // rim light multiplier (foliage keeps it low)
};

Surf surfDefault(vec3 albedo, vec3 N) {
  Surf s;
  s.albedo = albedo; s.N = N; s.rough = 0.8; s.ao = 1.0; s.trans = 0.0; s.spec = 0.5; s.wrap = 0.0; s.emissive = vec3(0.0); s.rimK = 1.0;
  return s;
}

vec3 hemiAmbient(vec3 N) {
  float up = N.y * 0.5 + 0.5;
  vec3 amb = mix(uGroundAmb, uSkyAmb, up);
  vec2 sh = normalize(uSunDir.xz + 1e-4);
  amb *= 0.92 + 0.16 * dot(N.xz, sh);
  return amb;
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f + 1e-6);
}

// Soft quantisation: n bands with smooth transitions.
float bands(float x, float n, float soft) {
  float y = x * n;
  float f = fract(y);
  float b = floor(y);
  return (b + smoothstep(0.5 - soft, 0.5 + soft, f)) / n;
}

vec3 shade(Surf s, vec3 wp, vec3 V, float shadow) {
  vec3 L = uSunDir;
  vec3 N = s.N;
  float ndlRaw = dot(N, L);
  float ndl = saturate((ndlRaw + s.wrap) / (1.0 + s.wrap));
  float light = ndl * shadow;
  vec3 amb = hemiAmbient(N) * s.ao;
  vec3 sun = uSunColor * uLightTint;
  vec3 col;
  float NoV = saturate(dot(N, V));
  float rimF = pow(1.0 - NoV, 4.0) * s.rimK;
  float backLit = saturate(dot(-V, L));

  if (uStyle == 1) {
    // Painterly (Arcane-like): soft bands, cool teal/violet shadows, warm key light, painted rim.
    // lifted before banding so low-sun lit planes land on the upper steps, not the shadow one
    // and only half-quantised: hard steps on gently rolling ground read as camouflage blotches
    float lift = pow(light, 0.6);
    float q = mix(lift, bands(lift, uStyleB.x, uStyleB.y), 0.5);
    vec3 coolAmb = mix(amb, uShadowTint * (luma(amb) * 1.9 + 0.06), uStyleB.z);
    vec3 shadowCol = s.albedo * coolAmb;
    vec3 litCol = s.albedo * (sun * 1.0 + amb * 0.45);
    // saturated core shadow right at the terminator, like a painter's transition stroke
    float core = smoothstep(0.0, 0.25, light) * (1.0 - smoothstep(0.25, 0.6, light));
    col = mix(shadowCol, litCol, q);
    col += s.albedo * vec3(0.9, 0.35, 0.25) * core * 0.18 * luma(sun);
    col += s.albedo * sun * s.trans * 0.55 * pow(backLit, 3.0) * shadow * uStyleC.x;
    col += uRimColor * rimF * uStyleA.z * (0.35 + 0.65 * saturate(ndlRaw + 0.4)) * s.ao;
  } else if (uStyle == 2) {
    // Anime: crisp two-tone cel with coloured shadow, soft gradient inside the lit side.
    float far = smoothstep(150.0, 900.0, length(wp - cameraPosition));
    float q = smoothstep(0.5 - uStyleB.y - far * 0.35, 0.5 + uStyleB.y + far * 0.35, light + 0.12);
    vec3 shadowCol = s.albedo * uShadowTint * (0.5 + 0.38 * luma(amb));
    vec3 litCol = s.albedo * (sun * (0.82 + 0.22 * ndl) + amb * 0.3);
    col = mix(shadowCol, litCol, q);
    col *= mix(1.0, s.ao, 0.55);
    col += s.albedo * sun * s.trans * 0.45 * step(0.6, backLit) * shadow * uStyleC.x;
    col += uRimColor * smoothstep(0.62, 0.7, rimF) * uStyleA.z * q;
    float NoH = saturate(dot(N, normalize(L + V)));
    col += sun * step(0.985, NoH) * uStyleC.w * s.spec * shadow;
  } else if (uStyle == 3) {
    // Cartoon: hard two tones, flat ambient, bold highlight.
    float far = smoothstep(200.0, 1200.0, length(wp - cameraPosition));
    float q = smoothstep(0.42 - far * 0.3, 0.42 + 0.001 + far * 0.3, light + 0.05);
    vec3 shadowCol = s.albedo * uShadowTint;
    vec3 litCol = s.albedo * sun * 0.62;
    col = mix(shadowCol, litCol, q);
    col *= mix(1.0, step(0.55, s.ao) * 0.25 + 0.75, 0.8);
    float NoH = saturate(dot(N, normalize(L + V)));
    col += vec3(1.0) * step(0.975, NoH) * uStyleC.w * s.spec * q;
    col += uRimColor * step(0.72, rimF) * uStyleA.z;
  } else {
    // Physically based (realistic + ultra)
    vec3 diffuse = s.albedo * (sun * light + amb);
    vec3 H = normalize(L + V);
    float NoH = saturate(dot(N, H));
    float a = max(s.rough * s.rough, 0.02);
    float F = 0.04 + 0.96 * pow(1.0 - saturate(dot(H, V)), 5.0);
    float spec = D_GGX(NoH, a) * F * 0.25 * ndl * shadow;
    col = diffuse + sun * spec * s.spec * uStyleA.w;
    // translucency: light through thin leaves
    float tr = pow(backLit, 4.0) * 0.8 + 0.2 * saturate(-ndlRaw);
    col += s.albedo * sun * s.trans * tr * shadow * uStyleC.x;
    // sky specular sheen
    col += amb * F * 0.25 * (1.0 - s.rough) * s.spec;
    col += uRimColor * rimF * uStyleA.z * 0.15 * s.ao * luma(amb);
  }
  return col + s.emissive;
}
`;

// call first thing in fragment shaders of anything that can appear in the water reflection
export const clipWater = /* glsl */ `
  if (uClipWater > 0.5 && vWp.y < uWorld.y - 0.04) discard;
`;

export const ditherPars = /* glsl */ `
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
