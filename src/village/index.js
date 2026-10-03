import * as THREE from 'three';
import { GeoBuilder, buildingMaterial, buildingDepthMaterial } from './builder.js';
import { buildHouse } from './houses.js';
import { buildChapel, buildWindmill, buildMillCap, buildWell, buildBridges, buildBoat } from './structures.js';
import { buildProps } from './props.js';
import { loadTexture, meanColorOf } from '../render/textures.js';
import { HOUSES, DOCK, WORLD } from '../world/layout.js';

const TEX = {
  stone: 'stone_wall', slate: 'castle_wall_slates', plaster: 'white_plaster_02', timber: 'rough_wood',
  planks: 'old_planks_02', thatch: 'thatch_roof_angled', roof: 'roof_slates_02',
};

export async function createVillage(ctx) {
  const { scene, data, shadows } = ctx;
  // textures
  const entries = await Promise.all(Object.entries(TEX).map(async ([k, name]) => {
    const [c, n] = await Promise.all([loadTexture(`${name}_c.webp`), loadTexture(`${name}_n.webp`, { srgb: false })]);
    const mean = meanColorOf(c.image);
    return [k, { c, n, mean }];
  }));
  const tex = Object.fromEntries(entries);
  const mats = {};
  for (const [k, t] of Object.entries(tex)) {
    mats[k] = buildingMaterial({ mapC: t.c, mapN: t.n, flat: [t.mean.r, t.mean.g, t.mean.b], normalK: k === 'plaster' ? 0.6 : 1.0, spec: k === 'roof' ? 0.5 : 0.3 });
  }
  // timber texture is grey weathered wood: the per-vertex tint gives it its brown
  mats.glass = buildingMaterial({ kind: 1 });
  mats.color = buildingMaterial({ kind: 2, spec: 0.25 });
  mats.cloth = buildingMaterial({ kind: 2, spec: 0.15, sway: 1 });
  mats.lamp = buildingMaterial({ kind: 3, emissive: [2.2, 1.35, 0.6] });

  const B = new GeoBuilder();
  const Bcloth = new GeoBuilder();
  const chimneys = [];
  const colliders = [];
  HOUSES.forEach((h, i) => {
    h.y = data.heightAt(h.x, h.z);
    const r = buildHouse(B, h, 1000 + i * 17);
    chimneys.push(...r.chimneys);
    colliders.push(r.collider);
  });
  const chapel = buildChapel(B, data);
  colliders.push(chapel.collider, ...chapel.wallColliders);
  const mill = buildWindmill(B, data);
  colliders.push(mill.collider);
  const well = buildWell(B, data);
  colliders.push(well.collider);
  const bridges = buildBridges(B, data);
  colliders.push(...bridges.colliders);
  const props = buildProps(B, Bcloth, data);
  colliders.push(...props.colliders);
  for (const [x, y, z] of props.lamps) {
    B.tint = [1.0, 0.82, 0.5];
    B.box('lamp', [x - 0.11, y - 0.17, z - 0.11], [x + 0.11, y + 0.17, z + 0.11], 1);
  }

  const group = new THREE.Group();
  group.name = 'village';
  const addMeshes = (builder, parent, opts = {}) => {
    const meshes = [];
    for (const [key, geo] of builder.build()) {
      const mat = key === 'cloth' && !opts.sway ? mats.color : mats[key];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `village-${key}`;
      if (key !== 'glass' && key !== 'lamp') shadows.addCaster(mesh, buildingDepthMaterial(THREE.DoubleSide, key === 'cloth' && opts.sway ? 1 : 0));
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  };
  addMeshes(B, group);
  addMeshes(Bcloth, group, { sway: true });

  // windmill cap + sails
  const Bcap = new GeoBuilder(), Bsail = new GeoBuilder();
  buildMillCap(Bcap, Bsail);
  const cap = new THREE.Group();
  cap.position.set(mill.x, mill.y + mill.H, mill.z);
  cap.rotation.y = mill.face;
  addMeshes(Bcap, cap);
  const sails = new THREE.Group();
  sails.position.set(0, 0.9, 2.45);
  sails.rotation.x = -0.12;
  const sailsInner = new THREE.Group();
  sails.add(sailsInner);
  addMeshes(Bsail, sailsInner);
  cap.add(sails);
  group.add(cap);

  // rowing boat at the end of the dock
  const Bb = new GeoBuilder();
  buildBoat(Bb);
  const boat = new THREE.Group();
  addMeshes(Bb, boat);
  const ca = Math.cos(DOCK.angle), sa = Math.sin(DOCK.angle);
  const boatBase = new THREE.Vector3(DOCK.x + ca * (DOCK.len - 2) + sa * 2.0, WORLD.waterLevel - 0.1, DOCK.z - sa * (DOCK.len - 2) + ca * 2.0);
  boat.position.copy(boatBase);
  boat.rotation.y = DOCK.angle + 0.15;
  group.add(boat);

  scene.add(group);

  const decks = bridges.decks;
  const deckAt = (x, z) => {
    for (const d of decks) {
      const dx = x - d.ax, dz = z - d.az;
      const c = Math.cos(d.ang), s = Math.sin(d.ang);
      const along = dx * c + dz * s, across = -dx * s + dz * c;
      if (along >= -0.5 && along <= d.len + 0.5 && Math.abs(across) <= d.width / 2) return d.deck(Math.min(Math.max(along, 0), d.len));
    }
    return null;
  };

  let t = 0;
  return {
    name: 'village',
    group,
    chimneys,
    lamps: props.lamps,
    stats: { houses: HOUSES.length, bridges: decks.filter((d) => d.kind !== 'dock').length, chapel: 1, windmill: 1, colliders: colliders.length },
    sails: sailsInner,
    update(dt) {
      t += dt;
      sailsInner.rotation.z -= dt * 0.32 * ctx.uniforms.uWind.value.z;
      boat.position.y = boatBase.y + Math.sin(t * 0.9) * 0.04;
      boat.rotation.z = Math.sin(t * 0.7) * 0.025;
      boat.rotation.x = Math.sin(t * 0.55 + 1) * 0.02;
    },
    groundAt(x, z) { return deckAt(x, z); },
    onBridge(x, z) { return deckAt(x, z) !== null; },
    collide(x, z, r) {
      let px = 0, pz = 0, hit = false;
      for (const c of colliders) {
        if (c.r !== undefined) {
          const dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz);
          const m = c.r + r;
          if (d < m && d > 1e-4) { px += (dx / d) * (m - d); pz += (dz / d) * (m - d); hit = true; }
          continue;
        }
        if (Math.abs(x - c.x) > c.hx + c.hz + r + 1 || Math.abs(z - c.z) > c.hx + c.hz + r + 1) continue;
        // into box space (rotY = c.rot)
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - qx, ez = lz - qz;
        let d = Math.hypot(ex, ez);
        let push;
        if (d < 1e-5) {
          // inside: push out along the shallowest axis
          const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
          if (ox < oz) { ex = Math.sign(lx) || 1; ez = 0; push = ox + r; } else { ex = 0; ez = Math.sign(lz) || 1; push = oz + r; }
          d = 1;
        } else {
          if (d >= r) continue;
          push = r - d;
        }
        const nx = ex / d, nz = ez / d;
        // back to world
        const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
        px += wx * push; pz += wz * push; hit = true;
      }
      return hit ? [px, pz] : null;
    },
  };
}
