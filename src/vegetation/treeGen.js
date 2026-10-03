import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { regionUV, REGION } from './foliageAtlas.js';

// Geometry buffers with the attribute layout every vegetation shader expects:
// position, normal, uv, aVeg (x sway weight, y phase, z flutter, w ambient occlusion)
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.v = []; this.i = []; }
  vtx(p, n, u, v, veg) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.v.push(veg[0], veg[1], veg[2], veg[3]);
    return this.p.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.v, 4));
    g.setIndex(this.i);
    if (this.p.length) { g.computeBoundingSphere(); g.computeBoundingBox(); }
    return g;
  }
}

const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();

/** Tube along points (Vector3[]) with radii[], parallel-transported frames. */
function tube(buf, pts, radii, sides, sway, phase, uvScale = 1, aoBase = 1) {
  const n = pts.length;
  let prevN = null;
  const ringStart = [];
  let vacc = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
    _t.subVectors(b, a).normalize();
    if (!prevN) {
      _n.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.9) _n.set(1, 0, 0);
      _n.crossVectors(_t, _n).normalize();
    } else {
      _n.copy(prevN).addScaledVector(_t, -prevN.dot(_t)).normalize();
    }
    prevN = _n.clone();
    _b.crossVectors(_t, _n).normalize();
    if (k > 0) vacc += pts[k].distanceTo(pts[k - 1]) / (Math.PI * 2 * Math.max(radii[k], 0.02)) * 0.5;
    ringStart.push(buf.p.length / 3);
    const sw = sway[k];
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const c = Math.cos(ang), si = Math.sin(ang);
      _q.copy(_n).multiplyScalar(c).addScaledVector(_b, si);
      _p.copy(pts[k]).addScaledVector(_q, radii[k]);
      const ao = aoBase * (0.75 + 0.25 * Math.min(1, pts[k].y / 2.5));
      buf.vtx(_p, _q, (s / sides) * uvScale, vacc, [sw, phase, 0, ao]);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    const r0 = ringStart[k], r1 = ringStart[k + 1];
    for (let s = 0; s < sides; s++) {
      const a = r0 + s, b = r0 + s + 1, c = r1 + s, d = r1 + s + 1;
      buf.i.push(a, c, b, b, c, d);
    }
  }
}

/** A leaf card centred at `c`, spanning `up` (length) and `side` (width). */
function card(buf, c, up, side, w, h, region, sphereN, sway, phase, ao, flip = false) {
  const [u0, v0, u1, v1] = regionUV(region);
  const base = c.clone();
  const p0 = base.clone().addScaledVector(side, -w / 2);
  const p1 = base.clone().addScaledVector(side, w / 2);
  const p2 = base.clone().addScaledVector(side, w / 2).addScaledVector(up, h);
  const p3 = base.clone().addScaledVector(side, -w / 2).addScaledVector(up, h);
  const fn = new THREE.Vector3().crossVectors(side, up).normalize();
  const nrm = (p) => {
    const s = p.clone().sub(sphereN.center).multiply(sphereN.scale).normalize();
    return fn.clone().multiplyScalar(0.3).addScaledVector(s, 0.85).normalize();
  };
  // texture: twig enters at the bottom of the region (v1), tip at top (v0)
  const ua = flip ? u1 : u0, ub = flip ? u0 : u1;
  const ph = phase + Math.random() * 0.0; // deterministic phase supplied by caller
  const i0 = buf.vtx(p0, nrm(p0), ua, v1, [sway, ph, 0.25, ao]);
  const i1 = buf.vtx(p1, nrm(p1), ub, v1, [sway, ph, 0.25, ao]);
  const i2 = buf.vtx(p2, nrm(p2), ub, v0, [sway, ph, 1.0, ao]);
  const i3 = buf.vtx(p3, nrm(p3), ua, v0, [sway, ph, 1.0, ao]);
  buf.i.push(i0, i1, i2, i0, i2, i3);
}

function bentPath(start, dir, len, segs, rand, { gravity = 0, upturn = 0, wiggle = 0.15 }) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  const step = len / segs;
  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    d.y += (upturn - gravity * t) * (1 / segs);
    d.x += (rand() - 0.5) * wiggle / segs * 2;
    d.z += (rand() - 0.5) * wiggle / segs * 2;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

function randomPerp(dir, rand) {
  const a = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
  return a.addScaledVector(dir, -a.dot(dir)).normalize();
}

// ---------------------------------------------------------------------------
export function generateBroadleaf(seed, lod, kind = 'oak') {
  const rand = mulberry32(seed);
  const bark = new Buf();
  const leaves = new Buf();
  const birch = kind === 'birch';
  const H = birch ? 11 + rand() * 4 : 10 + rand() * 4.5;
  const trunkR = birch ? 0.16 + rand() * 0.05 : 0.3 + rand() * 0.12;
  const crownR = birch ? 2.5 + rand() * 0.9 : 3.8 + rand() * 1.4;
  const clear = birch ? 0.4 + rand() * 0.12 : 0.3 + rand() * 0.1; // trunk fraction without branches
  const sides0 = lod === 0 ? 9 : 5;
  const sides1 = lod === 0 ? 5 : 3;
  const region = birch ? REGION.birch : rand() < 0.5 ? REGION.broad : REGION.broad2;

  // trunk with slight lean, continuing as a leader into the crown
  const lean = new THREE.Vector3((rand() - 0.5) * 0.22, 1, (rand() - 0.5) * 0.22).normalize();
  const trunk = bentPath(new THREE.Vector3(0, -0.4, 0), lean, H * 0.92, lod === 0 ? 10 : 6, rand, { wiggle: 0.25 });
  const tr = trunk.map((p, k) => {
    const t = k / (trunk.length - 1);
    const flare = 1 + Math.max(0, 0.6 - p.y) * 0.9;
    return trunkR * (1 - t * 0.82) * flare;
  });
  tube(bark, trunk, tr, sides0, trunk.map((p) => Math.pow(Math.max(p.y, 0) / H, 2) * 0.35), 0, 2);

  const crownC = new THREE.Vector3(0, H * (birch ? 0.66 : 0.62), 0);
  const sphere = { center: crownC, scale: new THREE.Vector3(1 / crownR, 1 / (H * 0.38), 1 / crownR) };
  const leafPts = [];
  const nMain = birch ? (lod === 0 ? 9 : 6) : lod === 0 ? 8 : 6;
  for (let b = 0; b < nMain; b++) {
    const t = clear + (1 - clear) * (0.06 + 0.86 * (b / nMain) + (rand() - 0.5) * 0.06);
    const k = Math.min(trunk.length - 2, Math.floor(t * (trunk.length - 1)));
    const start = trunk[k].clone().lerp(trunk[k + 1], rand());
    const az = b * 2.39996 + rand() * 0.5;
    const rel = Math.min(1, Math.max(0, (start.y - H * clear) / (H * (1 - clear))));
    const elev = birch ? 0.8 + rand() * 0.35 : 0.55 + rand() * 0.35 + rel * 0.35;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const len = crownR * (birch ? 0.75 : 1.05) * (1 - Math.pow(rel, 1.6) * 0.55) * (0.8 + rand() * 0.35);
    const pts = bentPath(start, dir, len, lod === 0 ? 8 : 3, rand, { gravity: birch ? 0.9 : 0.55, upturn: birch ? 0 : 0.45, wiggle: 0.7 });
    const r0 = tr[k] * (birch ? 0.42 : 0.46);
    const radii = pts.map((_, i) => r0 * Math.pow(1 - (i / (pts.length - 1)) * 0.86, 1.3));
    const phase = rand() * 6.283;
    tube(bark, pts, radii, sides1, pts.map((p, i) => 0.35 + 0.65 * (i / (pts.length - 1)) * 0.6), phase, 1);
    // secondary branches
    const nSec = birch ? (lod === 0 ? 5 : 3) : lod === 0 ? 4 : 2;
    for (let s = 0; s < nSec; s++) {
      const ts = 0.35 + 0.6 * (s / nSec) + rand() * 0.08;
      const kk = Math.min(pts.length - 2, Math.floor(ts * (pts.length - 1)));
      const st = pts[kk].clone().lerp(pts[kk + 1], rand());
      const pd = new THREE.Vector3().subVectors(pts[kk + 1], pts[kk]).normalize();
      const sd = randomPerp(pd, rand).multiplyScalar(0.8).add(pd).normalize();
      if (!birch) sd.y += 0.25; else sd.y -= 0.35;
      sd.normalize();
      const sl = len * (0.35 + rand() * 0.25);
      const sp = bentPath(st, sd, sl, lod === 0 ? 4 : 2, rand, { gravity: birch ? 1.6 : 0.4, upturn: birch ? 0 : 0.2, wiggle: 0.5 });
      if (lod === 0) tube(bark, sp, sp.map((_, i) => radii[kk] * 0.45 * (1 - i / sp.length * 0.7)), 3, sp.map(() => 0.8), phase, 1);
      for (let i = 1; i < sp.length; i++) leafPts.push({ p: sp[i], d: new THREE.Vector3().subVectors(sp[i], sp[i - 1]).normalize(), phase });
    }
    for (let i = Math.floor(pts.length * 0.5); i < pts.length; i++) leafPts.push({ p: pts[i], d: new THREE.Vector3().subVectors(pts[i], pts[i - 1]).normalize(), phase });
  }
  // top of the leader
  leafPts.push({ p: trunk[trunk.length - 1].clone(), d: new THREE.Vector3(0, 1, 0), phase: 0 });

  // leaf cards around branch tips + shell fill so the silhouette reads as a full crown
  const cardsPer = lod === 0 ? (birch ? 4 : 4) : 2;
  const size = birch ? (lod === 0 ? 1.15 : 1.9) : lod === 0 ? 1.9 : 3.1;
  for (const lp of leafPts) {
    for (let c = 0; c < cardsPer; c++) {
      const up = lp.d.clone().add(new THREE.Vector3((rand() - 0.5) * 1.2, birch ? -0.9 - rand() * 0.6 : (rand() - 0.2) * 0.9, (rand() - 0.5) * 1.2)).normalize();
      const side = randomPerp(up, rand);
      const pos = lp.p.clone().add(new THREE.Vector3((rand() - 0.5) * 0.7, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.7));
      const s = size * (0.75 + rand() * 0.5);
      const dist = pos.clone().sub(crownC).multiply(sphere.scale).length();
      const ao = Math.min(1, 0.45 + dist * 0.55);
      card(leaves, pos.addScaledVector(up, -s * 0.15), up, side, s, s, region, sphere, 1, lp.phase + c, ao, rand() < 0.5);
    }
  }
  const shell = lod === 0 ? (birch ? 40 : 70) : birch ? 16 : 26;
  for (let i = 0; i < shell; i++) {
    const u = rand() * 2 - 1, a = rand() * 6.283;
    const r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(a), u * 0.9 + 0.1, r * Math.sin(a)).normalize();
    const pos = crownC.clone().add(new THREE.Vector3(dir.x * crownR * 0.85, dir.y * H * 0.3, dir.z * crownR * 0.85));
    if (pos.y < H * clear + 0.6) continue;
    const up = dir.clone().add(new THREE.Vector3(0, birch ? -1.2 : 0.4, 0)).normalize();
    const side = randomPerp(up, rand);
    const s = size * (0.9 + rand() * 0.6);
    card(leaves, pos, up, side, s, s, region, sphere, 1, rand() * 6.28, 0.95, rand() < 0.5);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, radius: crownR, trunkR, kind };
}

export function generateConifer(seed, lod) {
  const rand = mulberry32(seed);
  const bark = new Buf();
  const leaves = new Buf();
  const H = 13 + rand() * 9;
  const trunkR = 0.22 + rand() * 0.1;
  const crownR = 2.6 + rand() * 1.2;
  const base = 1.2 + rand() * 1.5;
  const trunk = bentPath(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3((rand() - 0.5) * 0.04, 1, (rand() - 0.5) * 0.04), H, lod === 0 ? 8 : 4, rand, { wiggle: 0.06 });
  const tr = trunk.map((p, k) => trunkR * (1 - (k / (trunk.length - 1)) * 0.92) * (1 + Math.max(0, 0.5 - p.y)));
  tube(bark, trunk, tr, lod === 0 ? 8 : 5, trunk.map((p) => Math.pow(Math.max(p.y, 0) / H, 2) * 0.25), 0, 2);
  const crownC = new THREE.Vector3(0, H * 0.45, 0);
  const sphere = { center: crownC, scale: new THREE.Vector3(1 / crownR, 1 / (H * 0.55), 1 / crownR) };
  const whorlStep = lod === 0 ? 0.42 : 0.95;
  let w = 0;
  for (let y = base; y < H - 0.6; y += whorlStep * (0.85 + rand() * 0.3)) {
    const rel = (y - base) / (H - base);
    const L = crownR * Math.pow(1 - rel, 0.95) + 0.35;
    const n = lod === 0 ? 5 + Math.floor(rand() * 2) : 4;
    const off = rand() * 6.283;
    for (let b = 0; b < n; b++) {
      const az = off + (b / n) * 6.283 + (rand() - 0.5) * 0.4;
      const droop = -0.25 - (1 - rel) * 0.35 + rand() * 0.1;
      const dir = new THREE.Vector3(Math.cos(az), droop, Math.sin(az)).normalize();
      const start = new THREE.Vector3(0, y, 0);
      const pts = bentPath(start, dir, L, 3, rand, { gravity: 0.25, upturn: 0.35, wiggle: 0.15 });
      const phase = rand() * 6.283;
      if (lod === 0 && rel < 0.85) tube(bark, pts, pts.map((_, i) => 0.05 * (1 - i / 3 * 0.7) * (1 - rel * 0.5)), 3, pts.map((_, i) => 0.3 + i * 0.2), phase, 1);
      // needle cards along the branch: one flat, one tilted
      const dir2 = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[0]);
      const blen = dir2.length();
      dir2.normalize();
      const side = new THREE.Vector3().crossVectors(dir2, new THREE.Vector3(0, 1, 0)).normalize();
      const width = (0.85 + rand() * 0.35) * (lod === 0 ? 1 : 1.5) * (0.6 + 0.4 * (1 - rel));
      const dist = (1 - rel) * 0.6 + 0.4;
      const ao = Math.min(1, 0.4 + 0.6 * dist);
      card(leaves, pts[0].clone().addScaledVector(dir2, -0.1), dir2, side, width, blen + 0.35, REGION.needle, sphere, 0.6, phase, ao, rand() < 0.5);
      if (lod === 0) {
        const side2 = side.clone().applyAxisAngle(dir2, 0.9 + rand() * 0.5);
        card(leaves, pts[1].clone(), dir2, side2, width * 0.8, blen * 0.75, REGION.needle, sphere, 0.6, phase + 1, ao * 0.9, rand() < 0.5);
      }
      w++;
    }
  }
  // leader tip
  for (let k = 0; k < (lod === 0 ? 3 : 2); k++) {
    const side = new THREE.Vector3(Math.cos(k * 1.05), 0, Math.sin(k * 1.05));
    card(leaves, new THREE.Vector3(0, H - 1.6, 0), new THREE.Vector3(0, 1, 0), side, 0.9, 2.0, REGION.needle, sphere, 0.5, 0, 1, false);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, radius: crownR, trunkR, kind: 'pine' };
}

export function generateBush(seed, lod, kind = 'bush') {
  const rand = mulberry32(seed);
  const bark = new Buf();
  const leaves = new Buf();
  const R = 0.9 + rand() * 0.8;
  const H = R * (0.9 + rand() * 0.4);
  const C = new THREE.Vector3(0, H * 0.5, 0);
  const sphere = { center: C, scale: new THREE.Vector3(1 / R, 1 / (H * 0.6), 1 / R) };
  const region = kind === 'bush2' ? REGION.birch : REGION.broad;
  const n = lod === 0 ? 34 : 14;
  for (let i = 0; i < n; i++) {
    const u = rand() * 1.2 - 0.2, a = rand() * 6.283;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const dir = new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
    const pos = C.clone().add(new THREE.Vector3(dir.x * R * 0.8, dir.y * H * 0.5, dir.z * R * 0.8));
    pos.y = Math.max(pos.y, 0.15);
    const up = dir.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize();
    const side = randomPerp(up, rand);
    const s = (lod === 0 ? 1.0 : 1.5) * (0.8 + rand() * 0.5) * (R / 1.3);
    const ao = Math.min(1, 0.35 + Math.max(0, dir.y + 0.4) * 0.6);
    card(leaves, pos.addScaledVector(up, -s * 0.35), up, side, s, s, region, sphere, 0.5 + 0.5 * Math.max(0, pos.y / H), rand() * 6.28, ao, rand() < 0.5);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), height: H, radius: R, trunkR: 0, kind };
}
