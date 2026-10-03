import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { mulberry32, smoothstep, createNoise2D } from '../core/math.js';
import { generateBroadleaf, generateConifer, generateBush } from './treeGen.js';
import { vegVert, leafFrag, barkFrag, vegDepthFrag, impVert, impFrag, impDepthFrag, captureFrag } from './vegShaders.js';
import { loadTexture } from '../render/textures.js';
import { WORLD, LANDMARKS, CLEARINGS, HOUSES } from '../world/layout.js';

const noise = createNoise2D(404);

const SPECIES = {
  oak: { tint: [0.52, 0.66, 0.42], bark: 0 },
  birch: { tint: [0.72, 0.84, 0.5], bark: 2 },
  pine: { tint: [0.58, 0.74, 0.62], bark: 1 },
  bush: { tint: [0.58, 0.72, 0.46], bark: 0 },
  bush2: { tint: [0.64, 0.76, 0.46], bark: 0 },
};

export async function createTrees(ctx, foliageAtlas) {
  const { renderer, scene, data, shadows } = ctx;
  const [barkC, barkN, pineC, pineN] = await Promise.all([
    loadTexture('bark_brown_02_c.webp'), loadTexture('bark_brown_02_n.webp', { srgb: false }),
    loadTexture('pine_bark_c.webp'), loadTexture('pine_bark_n.webp', { srgb: false }),
  ]);

  // ---- variants
  const defs = [
    ['oak', 101], ['oak', 202], ['oak', 303],
    ['birch', 404], ['birch', 505],
    ['pine', 606], ['pine', 707], ['pine', 808],
    ['bush', 909], ['bush2', 1010],
  ];
  const variants = defs.map(([kind, seed], vi) => {
    const gen = (lod) => (kind === 'pine' ? generateConifer(seed, lod) : kind.startsWith('bush') ? generateBush(seed, lod, kind) : generateBroadleaf(seed, lod, kind));
    const lods = [gen(0), gen(1)];
    return { kind, seed, vi, lods, height: lods[0].height, radius: lods[0].radius, trunkR: lods[0].trunkR, isBush: kind.startsWith('bush') };
  });

  // ---- materials
  const atlasMeans = foliageAtlas.userData.means;
  const regionMean = { oak: atlasMeans[0], birch: atlasMeans[2], pine: atlasMeans[3], bush: atlasMeans[0], bush2: atlasMeans[2] };
  const leafMats = [], barkMats = [], leafDepth = [], barkDepth = [];
  for (const v of variants) {
    const sp = SPECIES[v.kind];
    const tint = new THREE.Color(...sp.tint);
    const flat = regionMean[v.kind].clone().multiply(new THREE.Color(1, 1, 1));
    const common = { uTreeH: { value: v.height } };
    leafMats.push(new THREE.ShaderMaterial({
      uniforms: { ...U, ...common, uAtlas: { value: foliageAtlas }, uLeafTint: { value: tint }, uLeafFlat: { value: new THREE.Vector3(flat.r, flat.g, flat.b) }, uAlphaRef: { value: 0.5 } },
      vertexShader: vegVert, fragmentShader: leafFrag, side: THREE.DoubleSide, alphaToCoverage: true,
    }));
    const bk = sp.bark;
    const bflat = bk === 2 ? new THREE.Vector3(0.6, 0.58, 0.52) : bk === 1 ? new THREE.Vector3(0.18, 0.12, 0.09) : new THREE.Vector3(0.16, 0.13, 0.1);
    barkMats.push(new THREE.ShaderMaterial({
      uniforms: { ...U, ...common, uBarkC: { value: bk === 1 ? pineC : barkC }, uBarkN: { value: bk === 1 ? pineN : barkN }, uBarkKind: { value: bk }, uBarkFlat: { value: bflat } },
      vertexShader: vegVert, fragmentShader: barkFrag,
    }));
    leafDepth.push(new THREE.ShaderMaterial({
      uniforms: { ...U, ...common, uAtlas: { value: foliageAtlas }, uIsLeaf: { value: 1 } },
      vertexShader: vegVert, fragmentShader: vegDepthFrag, side: THREE.DoubleSide,
    }));
    barkDepth.push(new THREE.ShaderMaterial({
      uniforms: { ...U, ...common, uAtlas: { value: foliageAtlas }, uIsLeaf: { value: 0 } },
      vertexShader: vegVert, fragmentShader: vegDepthFrag,
    }));
  }

  // ---- placement
  const inst = []; // {x,y,z,rot,scale,v,tint,bright,phase}
  const rand = mulberry32(77);
  const half = WORLD.half - 6;
  const houseClear = (x, z, m) => HOUSES.some((h) => Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.6 + m)
    || Math.hypot(x - LANDMARKS.chapel.x, z - LANDMARKS.chapel.z) < 13 + m || Math.hypot(x - LANDMARKS.mill.x, z - LANDMARKS.mill.z) < 12 + m;
  const pick = (x, z, h) => {
    const n = noise(x / 140, z / 140);
    const pineP = smoothstep(16, 34, h) * 0.75 + smoothstep(-120, -260, z) * 0.35 + n * 0.2;
    let birchP = 0.14 + 0.18 * smoothstep(0.2, 0.7, noise(x / 60 + 9, z / 60));
    for (const c of CLEARINGS) { const d = Math.hypot(x - c.x, z - c.z) / c.r; if (d < 1.6) birchP += 0.25 * (1 - smoothstep(1.0, 1.6, d)); }
    const r = rand();
    if (r < pineP * 0.8) return 5 + Math.floor(rand() * 3);
    if (r < pineP * 0.8 + birchP) return 3 + Math.floor(rand() * 2);
    return Math.floor(rand() * 3);
  };
  const okSpot = (x, z, rClear) => {
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (data.waterSdf(x, z) < 1.8) return false;
    if (data.maskAAt(x, z, 0) > 0.08 || data.maskAAt(x, z, 1) > 0.05) return false; // paths / cobbles
    if (data.maskBAt(x, z, 2) > 0.1 || data.maskBAt(x, z, 0) > 0.1) return false; // houses / fields
    if (houseClear(x, z, rClear)) return false;
    if (data.slopeAt(x, z) > 0.9) return false;
    return true;
  };
  const push = (x, z, v, scale, extra = {}) => {
    const y = data.heightAt(x, z);
    inst.push({ x, y, z, rot: rand() * Math.PI * 2, scale, v, tint: Math.max(0, Math.min(1, 0.25 + noise(x / 90, z / 90) * 0.6 + (rand() - 0.5) * 0.3)), bright: rand(), phase: rand() * 6.283, ...extra });
  };
  const CELL = 6.3;
  for (let gz = -half; gz < half; gz += CELL) {
    for (let gx = -half; gx < half; gx += CELL) {
      const x = gx + rand() * CELL, z = gz + rand() * CELL;
      const f = data.forestAt(x, z);
      let accept = rand() < f * 0.92;
      // lone trees in open country
      if (!accept && f < 0.05 && rand() < 0.0065) accept = true;
      if (!accept) continue;
      if (!okSpot(x, z, 4)) continue;
      const h = data.heightAt(x, z);
      const v = pick(x, z, h);
      const scale = (0.78 + rand() * 0.45) * (f < 0.05 ? 1.3 : 1);
      push(x, z, v, scale);
      // understory bushes at forest edges
      if (f > 0.1 && f < 0.75 && rand() < 0.35) {
        const bx = x + (rand() - 0.5) * 4, bz = z + (rand() - 0.5) * 4;
        if (okSpot(bx, bz, 2)) push(bx, bz, 8 + (rand() < 0.5 ? 0 : 1), 0.7 + rand() * 0.6);
      }
    }
  }
  // scattered bushes along paths, meadows and gardens
  for (let i = 0; i < 1400; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const f = data.forestAt(x, z);
    const verge = data.maskBAt(x, z, 3);
    const p = 0.08 + verge * 0.25 + (f > 0.05 && f < 0.5 ? 0.4 : 0);
    if (rand() > p) continue;
    if (!okSpot(x, z, 1.5)) continue;
    push(x, z, 8 + (rand() < 0.5 ? 0 : 1), 0.6 + rand() * 0.7);
  }
  // hand-placed: the old oak of the meadow, the linden of the square, pond birches
  push(LANDMARKS.bigOak.x, LANDMARKS.bigOak.z, 0, 1.75, { rot: 0.7 });
  push(-9.5, 8.5, 1, 1.05, { rot: 2.0 });
  for (const [x, z] of [[118, 236], [124, 174], [190, 180], [196, 236], [104, 214]]) if (data.waterSdf(x, z) > 1.5) push(x, z, 3 + (rand() < 0.5 ? 0 : 1), 0.9 + rand() * 0.3);
  for (const [x, z] of [[-120, 40], [-162, 2], [-60, 98], [34, -60], [-48, -64], [60, 30]]) if (okSpot(x, z, 3)) push(x, z, Math.floor(rand() * 3), 1.0 + rand() * 0.25);

  // ---- matrices
  const N = inst.length;
  const mats = new Float32Array(N * 16);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  inst.forEach((t, i) => {
    q.setFromAxisAngle(yAxis, t.rot);
    sc.setScalar(t.scale);
    ps.set(t.x, t.y, t.z);
    m4.compose(ps, q, sc).toArray(mats, i * 16);
  });
  const countByVariant = new Array(variants.length).fill(0);
  inst.forEach((t) => countByVariant[t.v]++);

  // ---- impostors (baked at load from the LOD1 geometry)
  const cols = 4, rows = 2;
  const cellPx = 512;
  const impRT = new THREE.WebGLRenderTarget(cols * cellPx, rows * cellPx, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
  impRT.texture.colorSpace = THREE.NoColorSpace;
  const impVariants = variants.filter((v) => !v.isBush);
  const impSize = [];
  {
    const capScene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const capLeaf = new THREE.ShaderMaterial({ uniforms: { ...U, uTreeH: { value: 10 }, uAtlas: { value: foliageAtlas }, uBarkC: { value: barkC }, uIsLeaf: { value: 1 }, uBarkKind: { value: 0 }, uLeafTint: { value: new THREE.Color() } }, vertexShader: vegVert, fragmentShader: captureFrag, side: THREE.DoubleSide });
    const capBark = new THREE.ShaderMaterial({ uniforms: { ...U, uTreeH: { value: 10 }, uAtlas: { value: foliageAtlas }, uBarkC: { value: barkC }, uIsLeaf: { value: 0 }, uBarkKind: { value: 0 }, uLeafTint: { value: new THREE.Color() } }, vertexShader: vegVert, fragmentShader: captureFrag });
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const windZ = U.uWind.value.z;
    U.uWind.value.z = 0;
    renderer.setRenderTarget(impRT);
    renderer.setClearColor(new THREE.Color(0.05, 0.08, 0.035), 0);
    impRT.scissorTest = false;
    renderer.clear();
    impVariants.forEach((v, k) => {
      const g = v.lods[1];
      const S = Math.max(g.radius * 2 * 1.2, g.height * 1.1);
      impSize.push(S);
      const sp = SPECIES[v.kind];
      capLeaf.uniforms.uLeafTint.value.setRGB(...sp.tint);
      capLeaf.uniforms.uTreeH.value = g.height;
      capBark.uniforms.uTreeH.value = g.height;
      capBark.uniforms.uBarkKind.value = sp.bark;
      capBark.uniforms.uBarkC.value = sp.bark === 1 ? pineC : barkC;
      capScene.clear();
      if (g.bark.attributes.position.count) capScene.add(new THREE.Mesh(g.bark, capBark));
      capScene.add(new THREE.Mesh(g.leaves, capLeaf));
      cam.left = -S / 2; cam.right = S / 2; cam.bottom = -0.4; cam.top = S - 0.4;
      cam.position.set(0, 0, 60); cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      const cx = k % cols, cy = Math.floor(k / cols);
      impRT.viewport.set(cx * cellPx, cy * cellPx, cellPx, cellPx);
      impRT.scissor.set(cx * cellPx, cy * cellPx, cellPx, cellPx);
      impRT.scissorTest = true;
      renderer.setRenderTarget(impRT);
      renderer.render(capScene, cam);
    });
    impRT.scissorTest = false;
    impRT.viewport.set(0, 0, cols * cellPx, rows * cellPx);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    U.uWind.value.z = windZ;
    capLeaf.dispose(); capBark.dispose();
  }
  // ---- instanced meshes per variant/lod
  const group = new THREE.Group();
  group.name = 'trees';
  const buckets = variants.map((v, vi) => v.lods.map((g, lod) => {
    const max = Math.max(1, countByVariant[vi]);
    const im = new THREE.InstancedBufferAttribute(new Float32Array(max * 16), 16);
    im.setUsage(THREE.DynamicDrawUsage);
    const ia = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    ia.setUsage(THREE.DynamicDrawUsage);
    const meshes = [];
    const mk = (geo, mat, dmat) => {
      if (!geo.attributes.position || geo.attributes.position.count === 0) return;
      geo.setAttribute('aInst', ia);
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.instanceMatrix = im;
      mesh.count = 0;
      mesh.frustumCulled = false;
      shadows.addCaster(mesh, dmat);
      group.add(mesh);
      meshes.push(mesh);
    };
    mk(g.bark, barkMats[vi], barkDepth[vi]);
    mk(g.leaves, leafMats[vi], leafDepth[vi]);
    return { im, ia, meshes, count: 0 };
  }));

  const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
  quad.translate(0, 0.5, 0);
  const nImp = Math.max(1, inst.filter((t) => !variants[t.v].isBush).length);
  const impGeo = quad;
  const aImp = new THREE.InstancedBufferAttribute(new Float32Array(nImp * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aImpInst = new THREE.InstancedBufferAttribute(new Float32Array(nImp * 4), 4).setUsage(THREE.DynamicDrawUsage);
  impGeo.setAttribute('aImp', aImp);
  impGeo.setAttribute('aInst', aImpInst);
  const impUniforms = { uImpAtlas: { value: impRT.texture }, uCells: { value: new THREE.Vector2(cols, rows) }, uLeafTint: { value: new THREE.Color(1, 1, 1) } };
  const impMat = new THREE.ShaderMaterial({ uniforms: { ...U, ...impUniforms }, vertexShader: impVert, fragmentShader: impFrag, side: THREE.DoubleSide, alphaToCoverage: true });
  const impDepth = new THREE.ShaderMaterial({ uniforms: { ...U, ...impUniforms }, vertexShader: impVert, fragmentShader: impDepthFrag, side: THREE.DoubleSide });
  const impMesh = new THREE.InstancedMesh(impGeo, impMat, nImp);
  impMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  impMesh.count = 0;
  impMesh.frustumCulled = false;
  shadows.addCaster(impMesh, impDepth);
  group.add(impMesh);
  const impIndex = new Map(impVariants.map((v, k) => [v.vi, k]));

  scene.add(group);

  // ---- colliders (trunks)
  const colCell = 8;
  const colGrid = new Map();
  inst.forEach((t) => {
    const v = variants[t.v];
    const r = v.isBush ? 0.35 * t.scale : v.trunkR * t.scale + 0.25;
    const k = Math.floor(t.x / colCell) * 73856093 ^ Math.floor(t.z / colCell) * 19349663;
    let a = colGrid.get(k);
    if (!a) colGrid.set(k, (a = []));
    a.push([t.x, t.z, r]);
  });

  // ---- LOD update
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  let frame = 0;
  const lastPos = new THREE.Vector3(1e9, 0, 0);
  const lastDir = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const stats = { lod0: 0, lod1: 0, imp: 0, total: N, trees: inst.filter((t) => !variants[t.v].isBush).length, bushes: inst.filter((t) => variants[t.v].isBush).length };

  function updateLOD(camera, force = false) {
    camera.getWorldDirection(dir);
    if (!force && camera.position.distanceToSquared(lastPos) < 1.5 && dir.dot(lastDir) > 0.9995) return;
    lastPos.copy(camera.position);
    lastDir.copy(dir);
    const lodK = ctx.quality?.treeLod ?? 1;
    const L0 = 46 * lodK, L1 = 175 * lodK, LB = 130 * lodK;
    const L0s = L0 * L0, L1s = L1 * L1, LBs = LB * LB;
    // slightly wider frustum to avoid popping at the edges while turning
    const wide = camera.clone();
    wide.fov = Math.min(camera.fov * 1.25, 120);
    wide.updateProjectionMatrix();
    pm.multiplyMatrices(wide.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    for (const vb of buckets) for (const b of vb) b.count = 0;
    let ni = 0;
    const cx = camera.position.x, cz = camera.position.z;
    let c0 = 0, c1 = 0;
    for (let i = 0; i < N; i++) {
      const t = inst[i];
      const v = variants[t.v];
      const dx = t.x - cx, dz = t.z - cz;
      const d2 = dx * dx + dz * dz;
      if (v.isBush && d2 > LBs) continue;
      sphere.center.set(t.x, t.y + v.height * 0.5 * t.scale, t.z);
      sphere.radius = Math.max(v.height, v.radius * 2) * t.scale * 0.6 + 4;
      const inF = frustum.intersectsSphere(sphere);
      if (!inF && d2 > 75 * 75) continue;
      if (d2 < L0s || (v.isBush && d2 < L1s)) {
        const lod = d2 < L0s ? 0 : 1;
        const b = buckets[t.v][lod];
        b.im.array.set(mats.subarray(i * 16, i * 16 + 16), b.count * 16);
        b.ia.array[b.count * 4] = t.tint; b.ia.array[b.count * 4 + 1] = t.bright; b.ia.array[b.count * 4 + 2] = t.phase; b.ia.array[b.count * 4 + 3] = t.scale;
        b.count++;
        if (lod === 0) c0++; else c1++;
      } else if (d2 < L1s) {
        const b = buckets[t.v][1];
        b.im.array.set(mats.subarray(i * 16, i * 16 + 16), b.count * 16);
        b.ia.array[b.count * 4] = t.tint; b.ia.array[b.count * 4 + 1] = t.bright; b.ia.array[b.count * 4 + 2] = t.phase; b.ia.array[b.count * 4 + 3] = t.scale;
        b.count++;
        c1++;
      } else if (!v.isBush && inF && d2 < 1100 * 1100) {
        impMesh.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), ni * 16);
        const S = impSize[impIndex.get(t.v)];
        aImp.array[ni * 4] = impIndex.get(t.v); aImp.array[ni * 4 + 1] = S; aImp.array[ni * 4 + 2] = S; aImp.array[ni * 4 + 3] = t.bright;
        aImpInst.array[ni * 4] = t.tint; aImpInst.array[ni * 4 + 1] = t.bright; aImpInst.array[ni * 4 + 2] = t.phase; aImpInst.array[ni * 4 + 3] = t.scale;
        ni++;
      }
    }
    for (const vb of buckets) for (const b of vb) {
      for (const m of b.meshes) m.count = b.count;
      if (b.count) {
        b.im.clearUpdateRanges(); b.im.addUpdateRange(0, b.count * 16); b.im.needsUpdate = true;
        b.ia.clearUpdateRanges(); b.ia.addUpdateRange(0, b.count * 4); b.ia.needsUpdate = true;
      }
    }
    impMesh.count = ni;
    impMesh.instanceMatrix.clearUpdateRanges(); impMesh.instanceMatrix.addUpdateRange(0, ni * 16); impMesh.instanceMatrix.needsUpdate = true;
    aImp.clearUpdateRanges(); aImp.addUpdateRange(0, ni * 4); aImp.needsUpdate = true;
    aImpInst.clearUpdateRanges(); aImpInst.addUpdateRange(0, ni * 4); aImpInst.needsUpdate = true;
    stats.lod0 = c0; stats.lod1 = c1; stats.imp = ni;
  }

  return {
    name: 'trees',
    group,
    stats,
    instances: inst,
    variants,
    impAtlas: impRT.texture,
    update(dt, t, c) {
      frame++;
      updateLOD(c.camera, frame % 20 === 0);
    },
    applyStyle() { lastPos.set(1e9, 0, 0); },
    collide(x, z, r) {
      let px = 0, pz = 0, hit = false;
      const cx0 = Math.floor(x / colCell), cz0 = Math.floor(z / colCell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = colGrid.get((cx0 + i) * 73856093 ^ (cz0 + j) * 19349663);
        if (!a) continue;
        for (const [tx, tz, tr] of a) {
          const dx = x - tx, dz = z - tz;
          const d = Math.hypot(dx, dz);
          const m = tr + r;
          if (d < m && d > 1e-4) { px += (dx / d) * (m - d); pz += (dz / d) * (m - d); hit = true; }
        }
      }
      return hit ? [px, pz] : null;
    },
  };
}
