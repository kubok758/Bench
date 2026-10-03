import * as THREE from 'three';

// One uniforms object shared by every world material. Style switches and time
// of day only touch these values, so no shader is ever recompiled at runtime.
export const U = {
  uTime: { value: 0 },
  uClipWater: { value: 0 },
  uDebug: { value: 0 },
  uStyle: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(3, 2.7, 2.3) },
  uSkyAmb: { value: new THREE.Color(0.4, 0.55, 0.8) },
  uGroundAmb: { value: new THREE.Color(0.3, 0.27, 0.2) },
  // fog: x density, y height falloff, z base height, w aerial (distance) density
  uFog: { value: new THREE.Vector4(0.0035, 0.018, 0, 0.00012) },
  uFogTint: { value: new THREE.Color(1, 1, 1) },
  uSunScatter: { value: new THREE.Color(1.0, 0.8, 0.55) },
  // wind: xy direction, z strength, w gustiness
  uWind: { value: new THREE.Vector4(0.8, 0.6, 1.0, 0.6) },
  // clouds: xy scroll offset, z coverage, w cloud-shadow strength
  uCloud: { value: new THREE.Vector4(0, 0, 0.5, 0.35) },
  uCloudHeight: { value: 1400 },

  // shadows
  uShadowMap0: { value: null },
  uShadowMap1: { value: null },
  uShadowMat0: { value: new THREE.Matrix4() },
  uShadowMat1: { value: new THREE.Matrix4() },
  // x texel0 (uv), y texel1 (uv), z filter radius in texels, w strength
  uShadowInfo: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 1.5, 1) },
  // x normal bias c0 (m), y normal bias c1 (m), z depth bias c0, w depth bias c1
  uShadowBias: { value: new THREE.Vector4(0.06, 0.4, 0.0004, 0.0008) },

  // terrain / world textures
  uHeightTex: { value: null },
  uTerrainNormalTex: { value: null },
  uMaskA: { value: null },
  uMaskB: { value: null },
  uNoiseTex: { value: null },
  uCellTex: { value: null },
  uSkyLUT: { value: null },
  // x world half size, y water level, z height res, w mask res
  uWorld: { value: new THREE.Vector4(512, 3, 513, 1024) },

  // style parameters
  // A: x detail (texture detail 0..1), y saturation, z rim strength, w specular scale
  uStyleA: { value: new THREE.Vector4(1, 1, 0.2, 1) },
  // B: x band count, y band softness, z shadow tint amount, w ambient flatness
  uStyleB: { value: new THREE.Vector4(3, 0.1, 0, 0) },
  // C: x translucency scale, y hue shift, z value (brightness) scale, w toon highlight
  uStyleC: { value: new THREE.Vector4(1, 0, 1, 0) },
  uShadowTint: { value: new THREE.Color(0.45, 0.5, 0.75) },
  uRimColor: { value: new THREE.Color(1, 0.85, 0.6) },
  uLightTint: { value: new THREE.Color(1, 1, 1) },
};

export function cloneUniforms(extra = {}) {
  // Materials reference the same uniform objects (shared by reference).
  return { ...U, ...extra };
}
