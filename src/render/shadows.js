import * as THREE from 'three';
import { U } from './uniforms.js';

export const CASTER_LAYER = 1;

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/** Default depth-only material (handles instancing). */
export const basicDepthMaterial = (side = THREE.FrontSide) =>
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
      }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    side,
    colorWrite: false,
  });

export class ShadowSystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.casters = new Set();
    this.cascades = [
      { r: 64, size: 2048, cam: new THREE.OrthographicCamera(), rt: null, every: 1, lead: 0.55 },
      { r: 380, size: 2048, cam: new THREE.OrthographicCamera(), rt: null, every: 3, lead: 0.4 },
    ];
    this.frame = 0;
    this.enabled = true;
    for (const c of this.cascades) {
      c.cam.layers.set(CASTER_LAYER);
      this.allocate(c);
    }
    this._center = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._ls = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this.stats = { calls: 0, triangles: 0 };
  }

  allocate(c) {
    c.rt?.dispose();
    const dt = new THREE.DepthTexture(c.size, c.size, THREE.UnsignedIntType);
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    c.rt = new THREE.WebGLRenderTarget(c.size, c.size, {
      depthBuffer: true,
      depthTexture: dt,
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    });
    c.dirty = true;
  }

  configure({ size0, size1, r0, r1 }) {
    const [a, b] = this.cascades;
    if (size0 && size0 !== a.size) { a.size = size0; this.allocate(a); }
    if (size1 && size1 !== b.size) { b.size = size1; this.allocate(b); }
    if (r0) a.r = r0;
    if (r1) b.r = r1;
    a.dirty = b.dirty = true;
  }

  addCaster(obj, depthMat) {
    obj.layers.enable(CASTER_LAYER);
    obj.userData.depthMat = depthMat || obj.userData.depthMat || basicDepthMaterial();
    this.casters.add(obj);
  }

  update(camera) {
    if (!this.enabled) {
      U.uShadowInfo.value.w = 0;
      return;
    }
    U.uShadowInfo.value.w = 1;
    const sun = U.uSunDir.value;
    camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-4) this._fwd.set(0, 0, -1);
    this._fwd.normalize();
    this.stats.calls = 0;
    this.stats.triangles = 0;

    this.cascades.forEach((c, i) => {
      if (!c.dirty && this.frame % c.every !== i % c.every) return;
      c.dirty = false;
      const r = c.r;
      const dist = 900;
      this._center.copy(camera.position).addScaledVector(this._fwd, r * c.lead);
      // light-space basis for texel snapping
      const cam = c.cam;
      cam.position.copy(this._center).addScaledVector(sun, dist);
      cam.up.set(0, 1, 0);
      if (Math.abs(sun.y) > 0.99) cam.up.set(0, 0, 1);
      cam.lookAt(this._center);
      cam.updateMatrixWorld();
      // snap the centre to whole texels in light space
      const texel = (2 * r) / c.size;
      this._ls.copy(cam.matrixWorldInverse);
      const p = this._tmp.copy(this._center).applyMatrix4(this._ls);
      p.x = Math.round(p.x / texel) * texel;
      p.y = Math.round(p.y / texel) * texel;
      p.applyMatrix4(cam.matrixWorld);
      cam.position.copy(p).addScaledVector(sun, dist);
      cam.lookAt(p);
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 1; cam.far = dist * 2;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();

      this.renderCascade(c);
      const m = i === 0 ? U.uShadowMat0.value : U.uShadowMat1.value;
      m.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      if (i === 0) U.uShadowMap0.value = c.rt.depthTexture;
      else U.uShadowMap1.value = c.rt.depthTexture;
    });
    U.uShadowInfo.value.x = 1 / this.cascades[0].size;
    U.uShadowInfo.value.y = 1 / this.cascades[1].size;
    this.frame++;
  }

  renderCascade(c) {
    const r = this.renderer;
    const swapped = [];
    for (const o of this.casters) {
      if (!o.visible) continue;
      swapped.push(o, o.material);
      o.material = o.userData.depthMat;
    }
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    r.setRenderTarget(c.rt);
    r.autoClear = false;
    r.clear(true, true, false);
    const before = r.info.render.calls, tb = r.info.render.triangles;
    r.render(this.scene, c.cam);
    this.stats.calls += r.info.render.calls - before;
    this.stats.triangles += r.info.render.triangles - tb;
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    this.scene.background = bg;
    this.scene.fog = fog;
    for (let k = 0; k < swapped.length; k += 2) swapped[k].material = swapped[k + 1];
  }
}
