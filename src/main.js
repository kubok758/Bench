import * as THREE from 'three';
import { U } from './render/uniforms.js';
import { STYLES } from './render/styles.js';
import { PostChain } from './render/post.js';
import { ShadowSystem } from './render/shadows.js';
import { createNoiseTexture, createCellTexture, loadArrayTexture } from './render/textures.js';
import { buildTerrainData } from './world/terrainData.js';
import { createTerrainMeshes, createHeightTextures, createMaskTextures, TERRAIN_LAYERS } from './world/terrain.js';
import { createSky, skyUniforms } from './world/sky.js';
import { createWater, Reflection, REFLECT_LAYER } from './world/water.js';
import { WORLD } from './world/layout.js';
import { Controls } from './core/controls.js';
import { ui } from './ui/ui.js';
import { createFoliageAtlas } from './vegetation/foliageAtlas.js';
import { createTrees } from './vegetation/trees.js';
import { createGrass } from './vegetation/grass.js';
import { createVillage } from './village/index.js';
import { createVillagers } from './life/villagers.js';
import { createAmbient } from './life/ambient.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');

const app = {
  styleIndex: 0,
  systems: [],
  ready: null,
  stats: {},
};
window.__app = app;

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  if (!hasWebGL2()) { ui.fail(); return; }
  const container = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.15, 14000);
  camera.position.set(250, 60, 250);
  camera.layers.enable(REFLECT_LAYER);
  camera.lookAt(0, 10, 0);

  ui.progress(0.04, 'Shaping the valley');
  await nextFrame();
  U.uNoiseTex.value = createNoiseTexture(256);
  U.uCellTex.value = createCellTexture(256);
  const t0 = performance.now();
  const data = buildTerrainData();
  app.stats.terrainMs = Math.round(performance.now() - t0);
  app.data = data;
  U.uWorld.value.set(WORLD.half, WORLD.waterLevel, data.N, data.maskRes);
  const { ht, nt } = createHeightTextures(data);
  U.uHeightTex.value = ht;
  U.uTerrainNormalTex.value = nt;
  const masks = createMaskTextures(data);
  U.uMaskA.value = masks.a;
  U.uMaskB.value = masks.b;

  ui.progress(0.2, 'Gathering stone and earth');
  await nextFrame();
  let loaded = 0;
  const total = TERRAIN_LAYERS.length * 2;
  const tick = () => ui.progress(0.2 + 0.3 * (++loaded / total));
  const anis = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const [albedoArr, normalArr] = await Promise.all([
    loadArrayTexture(TERRAIN_LAYERS.map((n) => `${n}_c.webp`), 1024, { srgb: true, anisotropy: anis, onEach: tick }),
    loadArrayTexture(TERRAIN_LAYERS.map((n) => `${n}_n.webp`), 1024, { srgb: false, anisotropy: anis, onEach: tick }),
  ]);

  ui.progress(0.55, 'Raising the hills');
  await nextFrame();
  const terrain = createTerrainMeshes(data, albedoArr, normalArr);
  scene.add(terrain.main, terrain.far);
  const sky = createSky();
  scene.add(sky.mesh);

  const water = createWater(data);
  scene.add(water);
  const reflection = new Reflection(renderer, scene, water);
  app.reflection = reflection;

  const shadows = new ShadowSystem(renderer, scene);
  shadows.addCaster(terrain.main);
  app.shadows = shadows;

  // sun disc for god rays
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(140, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, depthWrite: false, fog: false }));
  sunMesh.frustumCulled = false;

  const post = new PostChain(renderer, scene, camera, { noiseTex: U.uNoiseTex.value, sunMesh, samples: 4 });

  // world queries for the camera
  const worldQ = {
    heightAt: (x, z) => data.heightAt(x, z),
    groundAt: (x, z) => {
      let h = data.heightAt(x, z);
      for (const s of app.systems) if (s.groundAt) { const g = s.groundAt(x, z); if (g !== null && g > h - 0.6) h = Math.max(h, g); }
      // wading: the floor of shallow water is walkable, deep water is not (handled by collide)
      return Math.max(h, WORLD.waterLevel - 0.35);
    },
    collide: (x, z, r) => {
      let px = 0, pz = 0, hit = false;
      for (const s of app.systems) {
        if (!s.collide) continue;
        const p = s.collide(x + px, z + pz, r);
        if (p) { px += p[0]; pz += p[1]; hit = true; }
      }
      // deep water pushes back toward the shore unless a bridge carries us
      const onBridge = app.systems.some((s) => s.onBridge?.(x, z));
      if (!onBridge) {
        const w = data.waterSdf(x + px, z + pz);
        if (w < -1.6) {
          const e = 0.8;
          const gx = data.waterSdf(x + e, z) - data.waterSdf(x - e, z);
          const gz = data.waterSdf(x, z + e) - data.waterSdf(x, z - e);
          const gl = Math.hypot(gx, gz) || 1;
          const d = -1.6 - w;
          px += (gx / gl) * d; pz += (gz / gl) * d; hit = true;
        }
      }
      return hit ? [px, pz] : null;
    },
  };
  const controls = new Controls(camera, renderer.domElement, worldQ);
  app.controls = controls;

  const ctx = { renderer, scene, camera, data, shadows, post, uniforms: U, controls, worldQ, quality: STYLES[0].quality };
  app.ctx = ctx;

  // ---- world systems (loaded progressively)
  const modules = [
    ['Growing the forest', async (c) => createTrees(c, await createFoliageAtlas())],
    ['Sowing the meadows', async (c) => createGrass(c)],
    ['Building the village', async (c) => createVillage(c)],
    ['Waking the villagers', async (c) => createVillagers(c)],
    ['Calling the birds home', async (c) => createAmbient(c, app.systems.find((s) => s.name === 'village'))],
  ];
  let mi = 0;
  for (const [label, loader] of modules) {
    ui.progress(0.6 + 0.3 * (mi++ / Math.max(1, modules.length)), label);
    await nextFrame();
    const sys = await loader(ctx);
    if (sys) app.systems.push(sys);
  }

  // ---- styles
  const sunCol = new THREE.Color();
  function applyStyle(i, { announce = true } = {}) {
    const s = STYLES[i];
    app.styleIndex = i;
    U.uStyle.value = s.id;
    U.uSunDir.value.set(...s.sun).normalize();
    sunCol.setRGB(...s.sunColor).multiplyScalar(s.sunIntensity);
    U.uSunColor.value.copy(sunCol);
    U.uSkyAmb.value.setRGB(...s.skyAmb).multiplyScalar(s.skyAmbI);
    U.uGroundAmb.value.setRGB(...s.groundAmb).multiplyScalar(s.groundAmbI);
    U.uFog.value.set(...s.fog);
    U.uFogTint.value.setRGB(...s.fogTint);
    U.uSunScatter.value.setRGB(...s.sunScatter);
    U.uCloud.value.z = s.cloud.coverage;
    U.uCloud.value.w = s.cloud.shadow;
    const m = s.mat;
    U.uStyleA.value.set(m.detail, m.saturation, m.rim, m.specular);
    U.uStyleB.value.set(m.bands, m.bandSoft, m.shadowTintAmt, m.flat);
    U.uStyleC.value.set(m.trans, m.hue, m.value, m.toonSpec);
    U.uShadowTint.value.setRGB(...s.shadowTint);
    U.uRimColor.value.setRGB(...s.rimColor);
    U.uLightTint.value.setRGB(...s.lightTint);
    U.uWind.value.z = s.wind;
    const k = s.sky;
    skyUniforms.uZenith.value.setRGB(...k.zenith);
    skyUniforms.uHorizon.value.setRGB(...k.horizon);
    skyUniforms.uSkyGround.value.setRGB(...k.ground);
    skyUniforms.uSunGlow.value.setRGB(...k.glow);
    skyUniforms.uSkyParams.value.set(k.disk, k.diskI, k.hzExp, k.detail);
    skyUniforms.uCloudLit.value.setRGB(...k.cloudLit);
    skyUniforms.uCloudShade.value.setRGB(...k.cloudShade);
    sky.updateLUT(renderer);
    const q = s.quality;
    shadows.configure({ size0: q.shadow0, size1: q.shadow1, r0: q.r0 });
    U.uShadowInfo.value.z = s.id === 4 ? 2.2 : 1.6;
    ctx.quality = q;
    if (reflection.scale !== q.reflection) {
      reflection.scale = q.reflection;
      const pr2 = renderer.getPixelRatio();
      reflection.setSize(window.innerWidth * pr2, window.innerHeight * pr2);
    }
    post.apply(s);
    sunMesh.material.color.setRGB(...s.sunColor);
    for (const sys of app.systems) sys.applyStyle?.(s, ctx);
    if (announce) ui.toast(s.key, s.name, s.sub);
  }
  app.setStyle = (i) => applyStyle(i);
  app.styles = STYLES;

  // ---- sizing + dynamic resolution
  const drs = { scales: [1, 0.86, 0.74, 0.62], idx: 0, ema: 16, t: 0, good: 0, enabled: !TEST, base: dpr };
  app.drs = drs;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = drs.base * drs.scales[drs.idx];
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    post.setSize(w, h);
    const pr2 = renderer.getPixelRatio();
    reflection.setSize(w * pr2, h * pr2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  drs.feed = (ms) => {
    drs.ema += (ms - drs.ema) * 0.05;
    drs.t += ms;
    if (drs.t < 1500) return;
    drs.t = 0;
    if (drs.ema > 21 && drs.idx < drs.scales.length - 1) { drs.idx++; drs.good = 0; resize(); }
    else if (drs.ema < 13.5) { if (++drs.good >= 3 && drs.idx > 0) { drs.idx--; drs.good = 0; resize(); } }
    else drs.good = 0;
  };
  resize();

  // ---- input: styles & UI
  document.addEventListener('keydown', (e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    const np = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'].indexOf(e.code);
    const idx = n >= 0 ? n : np;
    if (idx >= 0 && idx !== app.styleIndex) applyStyle(idx);
    if (e.code === 'KeyH') ui.toggleHidden();
  });
  controls.onModeChange = (m) => {
    if (m === 'tour') { ui.touring(); ui.showIntro(false); } else ui.exploring();
  };

  // ---- precompile every style behind the loader (no hitch on first switch)
  ui.progress(0.92, 'Mixing the paints');
  const startStyle = Math.min(4, Math.max(0, parseInt(params.get('style') || '1', 10) - 1));
  function renderFrame(dt) {
    renderer.info.reset();
    U.uTime.value += dt;
    U.uCloud.value.x += dt * 0.0016;
    U.uCloud.value.y += dt * 0.0007;
    controls.update(dt);
    for (const s of app.systems) s.update?.(dt, U.uTime.value, ctx);
    shadows.update(camera);
    reflection.update(camera);
    sunMesh.position.copy(camera.position).addScaledVector(U.uSunDir.value, 8000);
    sunMesh.updateMatrixWorld();
    post.render(dt);
  }
  for (let i = 0; i < STYLES.length; i++) {
    applyStyle(i, { announce: false });
    renderFrame(0.016);
    await nextFrame();
  }
  applyStyle(startStyle, { announce: false });
  app.renderFrame = renderFrame;

  // ---- start
  ui.progress(1, 'Ready');
  ui.loaded();
  if (TEST) document.body.classList.add('hide-ui', 'test');
  else setTimeout(() => ui.showIntro(true), 700);
  const enter = () => {
    if (controls.mode !== 'tour') return;
    controls.setMode('walk');
    controls.requestLock();
    renderer.domElement.focus();
  };
  ui.onEnter(enter);
  renderer.domElement.addEventListener('click', () => { if (controls.mode === 'tour' && document.getElementById('intro').classList.contains('show')) enter(); });

  // test hooks
  app.setView = (pos, target) => {
    controls.setMode('walk', { instant: true });
    controls.setMode('fly', { instant: true });
    controls.setPose(pos, target);
    controls.vel.set(0, 0, 0);
  };
  app.renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, shadowCalls: shadows.stats.calls, reflCalls: reflection.stats.calls });
  app.frames = 0;
  let last = performance.now();
  function loop() {
    const now = performance.now();
    const ms = now - last;
    last = now;
    const dt = Math.min(ms / 1000, 0.1);
    const cpu0 = performance.now();
    renderFrame(dt);
    app.cpuMs = performance.now() - cpu0;
    app.frames++;
    if (drs.enabled) drs.feed(ms);
    if (!app.paused) requestAnimationFrame(loop);
  }
  if (!TEST) requestAnimationFrame(loop);
  else {
    // tests drive frames explicitly for determinism
    app.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) renderFrame(dt); app.frames += n; };
    app.startLoop = () => requestAnimationFrame(loop);
  }
  app.isReady = true;
}

app.ready = boot().catch((err) => {
  console.error(err);
  app.error = String(err && err.stack || err);
  ui.fail();
});
