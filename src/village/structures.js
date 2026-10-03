import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { LANDMARKS, BRIDGES, DOCK, WORLD } from '../world/layout.js';

const TIMBER = [0.42, 0.31, 0.23];
const TIMBER_DARK = [0.3, 0.22, 0.17];
const STONE_PALE = [0.98, 0.96, 0.9];

function lancet(B, x, y, w, h) {
  B.tint = [1, 1, 1];
  B.quad('glass', [x - w / 2, y, 0.03], [x + w / 2, y, 0.03], [x + w / 2, y + h, 0.03], [x - w / 2, y + h, 0.03], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.tri('glass', [x - w / 2, y + h, 0.03], [x + w / 2, y + h, 0.03], [x, y + h + w * 0.8, 0.03], [[0, 0], [1, 0], [0.5, 1]]);
  B.tint = [0.9, 0.88, 0.82];
  B.box('slate', [x - w / 2 - 0.16, y - 0.18, 0], [x + w / 2 + 0.16, y, 0.16], 1);
  B.box('slate', [x - w / 2 - 0.14, y, 0], [x - w / 2, y + h, 0.12], 1);
  B.box('slate', [x + w / 2, y, 0], [x + w / 2 + 0.14, y + h, 0.12], 1);
  B.beam('slate', [x - w / 2 - 0.07, y + h, 0.06], [x + 0.02, y + h + w * 0.85, 0.06], 0.14);
  B.beam('slate', [x + w / 2 + 0.07, y + h, 0.06], [x - 0.02, y + h + w * 0.85, 0.06], 0.14);
}

// ---------------------------------------------------------------------------
export function buildChapel(B, data) {
  const { x, z } = LANDMARKS.chapel;
  const y = Math.min(data.heightAt(x, z - 6), data.heightAt(x, z + 6), data.heightAt(x, z)) + 0.05;
  const W = 7.6, D = 13.5, H = 5.4;
  const tint = [0.98, 0.95, 0.9];
  B.frame(x, y, z, 0);
  // nave walls (long axis along z, entrance faces south +z)
  B.tint = [0.8, 0.8, 0.78];
  B.box('slate', [-W / 2 - 0.25, -2, -D / 2 - 0.25], [W / 2 + 0.25, 0.5, D / 2 + 0.25], 1.6, { aoBottom: 0.6 });
  B.tint = tint;
  B.box('slate', [-W / 2, 0.5, -D / 2], [W / 2, H, D / 2], 2.2, { faces: 'px nx pz nz', aoBottom: 0.75 });
  // buttresses
  for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) {
    const zz = k * 4.2;
    B.box('slate', [sx > 0 ? W / 2 : -W / 2 - 0.55, 0.5, zz - 0.35], [sx > 0 ? W / 2 + 0.55 : -W / 2, H - 1.2, zz + 0.35], 1.5, { aoBottom: 0.7 });
    B.box('slate', [sx > 0 ? W / 2 : -W / 2 - 0.3, H - 1.2, zz - 0.3], [sx > 0 ? W / 2 + 0.3 : -W / 2, H - 0.4, zz + 0.3], 1.5, { aoBottom: 1 });
  }
  // gables
  const pitch = THREE.MathUtils.degToRad(52);
  const ridgeY = H + (W / 2) * Math.tan(pitch);
  for (const sz of [-1, 1]) {
    B.tri('slate', [sz * W / 2, H, sz * D / 2], [-sz * W / 2, H, sz * D / 2], [0, ridgeY, sz * D / 2], [[sz * W / 4.4, H / 2.2], [-sz * W / 4.4, H / 2.2], [0, ridgeY / 2.2]]);
  }
  // roof
  const oh = 0.45;
  const L = D / 2 + 0.35;
  const slope = (W / 2) / Math.cos(pitch) + oh;
  for (const sx of [-1, 1]) {
    const ex = sx * (W / 2 + oh * Math.cos(pitch)), ey = H - oh * Math.sin(pitch);
    const rx = 0, ry = ridgeY + 0.1;
    const th = 0.16;
    const nx = sx * Math.sin(pitch), ny = Math.cos(pitch);
    B.tint = [0.78, 0.8, 0.86];
    const A = [ex + nx * th, ey + ny * th], R = [rx + nx * th, ry + ny * th];
    if (sx > 0) B.quad('roof', [A[0], A[1], L], [A[0], A[1], -L], [R[0], R[1], -L], [R[0], R[1], L], [[0, 0], [2 * L / 1.6, 0], [2 * L / 1.6, slope / 1.6], [0, slope / 1.6]]);
    else B.quad('roof', [A[0], A[1], -L], [A[0], A[1], L], [R[0], R[1], L], [R[0], R[1], -L], [[0, 0], [2 * L / 1.6, 0], [2 * L / 1.6, slope / 1.6], [0, slope / 1.6]]);
    B.tint = [0.3, 0.25, 0.2];
    B.quad('planks', [ex, ey, L], [rx, ry, L], [rx, ry, -L], [ex, ey, -L], [[0, 0], [1, 0], [1, 4], [0, 4]], [0.6, 0.5, 0.5, 0.6]);
    B.tint = TIMBER_DARK;
    B.quad('timber', [ex, ey, -L], [ex, ey, L], [A[0], A[1], L], [A[0], A[1], -L], [[0, 0], [4, 0], [4, 0.2], [0, 0.2]]);
  }
  B.tint = TIMBER_DARK;
  B.push(new THREE.Matrix4().makeRotationZ(Math.PI / 4).setPosition(0, ridgeY + 0.22, 0));
  B.box('timber', [-0.14, -0.14, -L], [0.14, 0.14, L], 1.5, { aoBottom: 1 });
  B.pop();
  // lancet windows on the long sides
  for (const sx of [-1, 1]) {
    B.frame(sx * W / 2, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    for (const zz of [-2.1, 2.1]) lancet(B, zz, 1.9, 0.62, 1.7);
    B.pop();
  }
  // rose window at the back
  B.frame(0, 0, -D / 2, Math.PI);
  lancet(B, 0, 2.6, 0.8, 2.0);
  B.pop();

  // bell tower at the south end
  const T = 3.7, TH = 12.5;
  const tz = D / 2 + T / 2 - 0.2;
  B.tint = tint;
  B.box('slate', [-T / 2 - 0.2, -2, tz - T / 2 - 0.2], [T / 2 + 0.2, 0.6, tz + T / 2 + 0.2], 1.6, { aoBottom: 0.6 });
  B.box('slate', [-T / 2, 0.6, tz - T / 2], [T / 2, TH, tz + T / 2], 2.2, { faces: 'px nx pz nz', aoBottom: 0.75 });
  // string courses
  B.tint = [0.9, 0.88, 0.84];
  for (const yy of [5.6, TH - 0.2]) B.box('slate', [-T / 2 - 0.12, yy, tz - T / 2 - 0.12], [T / 2 + 0.12, yy + 0.22, tz + T / 2 + 0.12], 1.2);
  // belfry openings (dark louvres)
  for (const [fx, fz, fr] of [[0, tz + T / 2, 0], [0, tz - T / 2, Math.PI], [T / 2, tz, Math.PI / 2], [-T / 2, tz, -Math.PI / 2]]) {
    B.frame(fx, 0, fz, fr);
    B.tint = [0.05, 0.045, 0.04];
    B.box('color', [-0.55, TH - 3.0, 0.0], [0.55, TH - 1.0, 0.02], 1);
    B.tri('color', [-0.55, TH - 1.0, 0.02], [0.55, TH - 1.0, 0.02], [0, TH - 0.45, 0.02], [[0, 0], [1, 0], [0.5, 1]]);
    B.tint = TIMBER_DARK;
    for (let k = 0; k < 5; k++) B.box('timber', [-0.55, TH - 2.9 + k * 0.38, 0.0], [0.55, TH - 2.82 + k * 0.38, 0.08], 1);
    B.pop();
  }
  // spire
  const sH = 6.8;
  const s0 = T / 2 + 0.35;
  const apex = [0, TH + sH, tz];
  const corners = [[-s0, TH, tz - s0], [s0, TH, tz - s0], [s0, TH, tz + s0], [-s0, TH, tz + s0]];
  B.tint = [0.75, 0.77, 0.84];
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) % 4];
    B.tri('roof', b, a, apex, [[0, 0], [2 * s0 / 1.6, 0], [s0 / 1.6, sH / 1.6]]);
  }
  // cross
  B.tint = [0.16, 0.14, 0.12];
  B.box('color', [-0.05, TH + sH - 0.1, tz - 0.05], [0.05, TH + sH + 1.1, tz + 0.05], 1);
  B.box('color', [-0.32, TH + sH + 0.6, tz - 0.05], [0.32, TH + sH + 0.7, tz + 0.05], 1);
  // door
  B.frame(0, 0, tz + T / 2, 0);
  B.tint = [0.36, 0.22, 0.15];
  B.box('planks', [-0.7, 0.6, -0.02], [0.7, 3.0, 0.05], 0.9);
  B.tri('planks', [-0.7, 3.0, 0.05], [0.7, 3.0, 0.05], [0, 3.6, 0.05], [[0, 0], [1.4, 0], [0.7, 0.6]]);
  B.tint = [0.9, 0.88, 0.84];
  B.box('slate', [-1.0, 0.6, 0], [-0.7, 3.2, 0.22], 1);
  B.box('slate', [0.7, 0.6, 0], [1.0, 3.2, 0.22], 1);
  B.beam('slate', [-0.86, 3.15, 0.11], [0.02, 3.95, 0.11], 0.3);
  B.beam('slate', [0.86, 3.15, 0.11], [-0.02, 3.95, 0.11], 0.3);
  B.box('slate', [-1.3, 0.0, 0], [1.3, 0.6, 1.2], 1);
  B.pop();
  B.pop();

  // churchyard: low wall + a few headstones
  const rand = mulberry32(31);
  const wallPts = [];
  const wallColliders = [];
  const R = 15;
  for (let a = 0; a <= 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    wallPts.push([x + Math.cos(ang) * R * 0.85, z + 1.5 + Math.sin(ang) * R]);
  }
  for (let k = 0; k < wallPts.length - 1; k++) {
    const [ax, az] = wallPts[k], [bx, bz] = wallPts[k + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (mz > z + 1.5 + R * 0.9 && Math.abs(mx - x) < 2.5) continue; // gate gap facing the lane
    const ya = data.heightAt(mx, mz);
    const len = Math.hypot(bx - ax, bz - az);
    B.tint = [0.85 + rand() * 0.1, 0.83 + rand() * 0.1, 0.8 + rand() * 0.08];
    B.obox('stone', [mx, ya + 0.25, mz], [len / 2 + 0.05, 0.62, 0.28], -Math.atan2(bz - az, bx - ax), 1.4, { aoBottom: 0.65 });
    wallColliders.push({ x: mx, z: mz, hx: len / 2 + 0.05, hz: 0.3, rot: -Math.atan2(bz - az, bx - ax) });
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, r = 4 + rand() * 7;
    const gx = x + Math.cos(a) * r * 0.85, gz = z + 1.5 + Math.sin(a) * r;
    if (Math.abs(gx - x) < W / 2 + 1.5 && gz > z - D / 2 - 1.5 && gz < z + D / 2 + T + 1.5) continue;
    const gy = data.heightAt(gx, gz);
    B.tint = [0.75 + rand() * 0.1, 0.75 + rand() * 0.1, 0.72 + rand() * 0.1];
    B.obox('slate', [gx, gy + 0.35, gz], [0.32, 0.6, 0.08], rand() * 0.3 - 0.15 + Math.PI * 0.5 * 0, 0.8, { aoBottom: 0.6 });
  }
  return { collider: { x, z: z + 1.5, hx: W / 2 + 0.7, hz: D / 2 + T + 0.5, rot: 0 }, wallR: R, wallColliders };
}

// ---------------------------------------------------------------------------
export function buildWindmill(B, data) {
  const { x, z } = LANDMARKS.mill;
  const y = data.heightAt(x, z) - 0.1;
  const H = 8.6;
  B.frame(x, y, z, 0);
  B.tint = [0.82, 0.8, 0.76];
  B.cylinder('slate', [0, -1.5, 0], 3.3, 3.25, 2.0, 24, 2.0, { aoBottom: 0.6 });
  B.tint = [1.02, 0.99, 0.94];
  B.cylinder('plaster', [0, 0.5, 0], 3.1, 2.25, H - 0.5, 28, 2.6, { aoBottom: 0.8 });
  // gallery ring
  B.tint = TIMBER;
  B.cylinder('timber', [0, 4.2, 0], 2.85, 2.85, 0.18, 24, 1.2, { cap: true, aoBottom: 1 });
  B.pop();
  // door + windows on the south-east face
  const face = Math.atan2(0.7, 0.7);
  B.frame(x, y, z, face);
  B.push(new THREE.Matrix4().setPosition(0, 0, 3.12));
  B.tint = [0.4, 0.26, 0.16];
  B.box('planks', [-0.55, 0.5, -0.1], [0.55, 2.5, 0.05], 0.9);
  B.tint = TIMBER_DARK;
  B.box('timber', [-0.7, 2.5, -0.1], [0.7, 2.66, 0.1], 1);
  B.tint = [1, 1, 1];
  B.pop();
  B.push(new THREE.Matrix4().setPosition(0, 0, 2.7));
  B.quad('glass', [-0.3, 5.1, 0.02], [0.3, 5.1, 0.02], [0.3, 5.9, 0.02], [-0.3, 5.9, 0.02], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.tint = TIMBER;
  B.box('timber', [-0.38, 5.02, -0.05], [0.38, 5.1, 0.12], 1);
  B.box('timber', [-0.38, 5.9, -0.05], [0.38, 5.98, 0.12], 1);
  B.pop();
  B.pop();
  return { x, y, z, H, face, collider: { x, z, r: 3.5 } };
}

/** The rotating cap + sails as separate meshes (built into their own builders). */
export function buildMillCap(Bcap, Bsail) {
  // cap (local: origin at tower top, sails along +z)
  Bcap.tint = [0.95, 0.88, 0.78];
  Bcap.cylinder('thatch', [0, 0, 0], 2.55, 0.3, 2.6, 20, 1.8, { aoBottom: 0.7 });
  Bcap.tint = TIMBER_DARK;
  Bcap.cylinder('timber', [0, -0.25, 0], 2.6, 2.6, 0.28, 20, 1, { aoBottom: 1 });
  Bcap.tint = TIMBER;
  Bcap.push(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.9, 1.6));
  Bcap.cylinder('timber', [0, -0.2, 0], 0.32, 0.28, 1.6, 10, 1, { cap: true, aoBottom: 1 });
  Bcap.pop();
  // sails (local: hub at origin, rotating about z)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    Bsail.push(new THREE.Matrix4().makeRotationZ(a));
    Bsail.tint = TIMBER;
    Bsail.box('timber', [-0.13, 0.2, -0.13], [0.13, 7.4, 0.13], 1.2, { aoBottom: 1 });
    // lattice
    Bsail.tint = [0.5, 0.38, 0.28];
    for (let j = 0; j <= 9; j++) {
      const yy = 1.6 + j * 0.62;
      Bsail.box('timber', [0.1, yy, -0.04], [1.55, yy + 0.06, 0.04], 1, { aoBottom: 1 });
    }
    Bsail.box('timber', [1.5, 1.6, -0.04], [1.58, 7.25, 0.04], 1, { aoBottom: 1 });
    Bsail.box('timber', [0.75, 1.6, -0.03], [0.8, 7.25, 0.03], 1, { aoBottom: 1 });
    // cloth
    Bsail.tint = [0.92, 0.86, 0.74];
    Bsail.quad('cloth', [0.14, 1.7, 0.06], [1.5, 1.7, 0.06], [1.5, 7.1, 0.06], [0.14, 7.1, 0.06], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    Bsail.pop();
  }
  Bsail.tint = TIMBER_DARK;
  Bsail.cylinder('timber', [0, 0, -0.2], 0.4, 0.4, 0.4, 10, 1, { aoBottom: 1 });
}

// ---------------------------------------------------------------------------
export function buildWell(B, data) {
  const { x, z } = LANDMARKS.well;
  const y = data.heightAt(x, z);
  B.frame(x, y, z, 0.3);
  B.tint = [0.95, 0.93, 0.88];
  B.cylinder('stone', [0, -0.3, 0], 1.15, 1.1, 1.15, 20, 1.4, { aoBottom: 0.6 });
  B.tint = [0.55, 0.53, 0.5];
  B.cylinder('stone', [0, -0.3, 0], 0.82, 0.82, 1.15, 20, 1.4, { aoBottom: 0.3 });
  B.tint = [0.85, 0.84, 0.8];
  // coping ring
  const b = B.bucket('slate');
  void b;
  for (let k = 0; k < 20; k++) {
    const a0 = (k / 20) * Math.PI * 2, a1 = ((k + 1) / 20) * Math.PI * 2;
    const p = (a, r) => [Math.cos(a) * r, 0.88, Math.sin(a) * r];
    B.quad('slate', p(a0, 1.2), p(a0, 0.78), p(a1, 0.78), p(a1, 1.2), [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]]);
  }
  B.tint = [0.02, 0.03, 0.03];
  B.cylinder('color', [0, -0.4, 0], 0.8, 0.8, 0.01, 16, 1, { cap: true });
  // posts + roof
  B.tint = TIMBER;
  for (const sx of [-1, 1]) B.box('timber', [sx * 1.0 - 0.09, 0.85, -0.09], [sx * 1.0 + 0.09, 2.5, 0.09], 1.2, { aoBottom: 0.8 });
  B.box('timber', [-1.15, 2.4, -0.07], [1.15, 2.52, 0.07], 1.2);
  B.tint = TIMBER_DARK;
  B.push(new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.9, 1.75, 0));
  B.cylinder('timber', [0, -0.05, 0], 0.08, 0.08, 1.8, 8, 1);
  B.pop();
  B.tint = [0.7, 0.6, 0.45];
  B.box('color', [-0.015, 1.15, -0.015], [0.015, 1.75, 0.015], 1);
  B.tint = [0.42, 0.32, 0.22];
  B.cylinder('planks', [0, 0.9, 0], 0.17, 0.2, 0.28, 10, 0.8, { aoBottom: 0.7 });
  // little gable roof
  for (const sz of [-1, 1]) {
    B.tint = [0.85, 0.78, 0.7];
    if (sz > 0) B.quad('roof', [-1.35, 2.45, 0.95], [1.35, 2.45, 0.95], [1.35, 3.2, 0], [-1.35, 3.2, 0], [[0, 0], [1.7, 0], [1.7, 0.75], [0, 0.75]]);
    else B.quad('roof', [1.35, 2.45, -0.95], [-1.35, 2.45, -0.95], [-1.35, 3.2, 0], [1.35, 3.2, 0], [[0, 0], [1.7, 0], [1.7, 0.75], [0, 0.75]]);
  }
  B.pop();
  return { collider: { x, z, r: 1.3 } };
}

// ---------------------------------------------------------------------------
export function buildBridges(B, data) {
  const out = { decks: [], colliders: [] };
  for (const br of BRIDGES) {
    const [ax, az] = br.a, [bx, bz] = br.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bz - az, bx - ax);
    const hA = data.heightAt(ax, az), hB = data.heightAt(bx, bz);
    if (br.kind === 'stone') {
      const hump = 1.25;
      const deck = (s) => hA + (hB - hA) * (s / len) + hump * Math.sin((Math.PI * s) / len) - 0.05;
      const mid = len / 2;
      const span = 13.5, spring = WORLD.waterLevel + 0.25, rise = 2.75;
      const shape = new THREE.Shape();
      const bottom = WORLD.waterLevel - 2.5;
      shape.moveTo(-1.2, bottom);
      shape.lineTo(-1.2, deck(0) - 0.1);
      for (let i = 0; i <= 32; i++) { const s = (i / 32) * len; shape.lineTo(s, deck(s)); }
      shape.lineTo(len + 1.2, deck(len) - 0.1);
      shape.lineTo(len + 1.2, bottom);
      shape.lineTo(-1.2, bottom);
      const hole = new THREE.Path();
      hole.moveTo(mid - span / 2, bottom + 0.3);
      hole.lineTo(mid + span / 2, bottom + 0.3);
      hole.lineTo(mid + span / 2, spring);
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        const a = Math.PI * t;
        hole.lineTo(mid + Math.cos(a) * span / 2, spring + Math.sin(a) * rise);
      }
      hole.lineTo(mid - span / 2, spring);
      hole.lineTo(mid - span / 2, bottom + 0.3);
      shape.holes.push(hole);
      const W = br.width;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, curveSegments: 24 });
      geo.translate(0, 0, -W / 2);
      B.push(new THREE.Matrix4().makeRotationY(-ang).setPosition(ax, 0, az));
      B.tint = [0.95, 0.93, 0.88];
      B.geometry('slate', geo, 1 / 1.8);
      // voussoir ring (lighter, protruding stones around the arch face)
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 17; i++) {
          const t0 = i / 17, t1 = (i + 1) / 17;
          const a0 = Math.PI * t0, a1 = Math.PI * t1;
          const r0 = 1, r1 = 1.0;
          void r0; void r1;
          const p = (a, k) => [mid + Math.cos(a) * (span / 2 + k), spring + Math.sin(a) * (rise + k * rise / (span / 2)), sz * (W / 2 + 0.06)];
          B.tint = i % 2 ? [0.9, 0.88, 0.84] : [0.84, 0.82, 0.78];
          const q = [p(a0, 0), p(a1, 0), p(a1, 0.62), p(a0, 0.62)];
          if (sz > 0) B.quad('slate', q[1], q[0], q[3], q[2], [[0, 0], [0.4, 0], [0.4, 0.35], [0, 0.35]]);
          else B.quad('slate', q[0], q[1], q[2], q[3], [[0, 0], [0.4, 0], [0.4, 0.35], [0, 0.35]]);
        }
      }
      // parapets with coping
      for (const sz of [-1, 1]) {
        const ps = new THREE.Shape();
        ps.moveTo(-1.2, deck(0) - 0.1);
        for (let i = 0; i <= 32; i++) { const s = (i / 32) * len; ps.lineTo(s, deck(s) + 0.82); }
        ps.lineTo(len + 1.2, deck(len) + 0.72);
        ps.lineTo(len + 1.2, deck(len) - 0.1);
        for (let i = 32; i >= 0; i--) { const s = (i / 32) * len; ps.lineTo(s, deck(s) - 0.05); }
        const pg = new THREE.ExtrudeGeometry(ps, { depth: 0.42, bevelEnabled: false, curveSegments: 4 });
        pg.translate(0, 0, sz > 0 ? W / 2 - 0.42 : -W / 2);
        B.tint = [0.92, 0.9, 0.86];
        B.geometry('slate', pg, 1 / 1.6);
        const cs = new THREE.Shape();
        cs.moveTo(-1.25, deck(0) + 0.7);
        for (let i = 0; i <= 32; i++) { const s = (i / 32) * len; cs.lineTo(s, deck(s) + 0.96); }
        cs.lineTo(len + 1.25, deck(len) + 0.86);
        for (let i = 32; i >= 0; i--) { const s = (i / 32) * len; cs.lineTo(s, deck(s) + 0.8); }
        const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.54, bevelEnabled: false, curveSegments: 4 });
        cg.translate(0, 0, sz > 0 ? W / 2 - 0.48 : -W / 2 - 0.06);
        B.tint = [0.82, 0.8, 0.76];
        B.geometry('slate', cg, 1 / 1.4);
      }
      B.pop();
      out.decks.push({ ax, az, ang, len, width: W - 0.9, deck, kind: 'stone' });
      // parapet colliders (thin walls along both sides)
      out.colliders.push({ x: (ax + bx) / 2, z: (az + bz) / 2 + Math.cos(ang) * (W / 2 - 0.2), hx: len / 2, hz: 0.25, rot: -ang });
      out.colliders.push({ x: (ax + bx) / 2, z: (az + bz) / 2 - Math.cos(ang) * (W / 2 - 0.2), hx: len / 2, hz: 0.25, rot: -ang });
    } else {
      // timber footbridge
      const rise = 0.7;
      const deck = (s) => hA + (hB - hA) * (s / len) + rise * Math.sin((Math.PI * s) / len) + 0.12;
      const W = br.width;
      const rand = mulberry32(5);
      B.push(new THREE.Matrix4().makeRotationY(-ang).setPosition(ax, 0, az));
      // stringers
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 16; i++) {
          const s0 = (i / 16) * len, s1 = ((i + 1) / 16) * len;
          B.tint = TIMBER_DARK;
          B.beam('timber', [s0 - 0.02, deck(s0) - 0.18, sz * (W / 2 - 0.15)], [s1 + 0.02, deck(s1) - 0.18, sz * (W / 2 - 0.15)], 0.22);
        }
      }
      // planks
      for (let s = 0.1; s < len - 0.05; s += 0.27) {
        const yy = deck(s);
        const slope = Math.atan2(deck(s + 0.1) - deck(s - 0.1), 0.2);
        B.tint = [0.6 + rand() * 0.15, 0.48 + rand() * 0.12, 0.36 + rand() * 0.1];
        B.push(new THREE.Matrix4().makeRotationZ(slope + (rand() - 0.5) * 0.02).setPosition(s, yy, (rand() - 0.5) * 0.06));
        B.box('planks', [-0.12, -0.05, -W / 2], [0.12, 0.03, W / 2], 1.0, { aoBottom: 0.8 });
        B.pop();
      }
      // posts in the water + handrails
      for (let s = 0; s <= len + 0.01; s += len / 6) {
        for (const sz of [-1, 1]) {
          B.tint = TIMBER;
          B.box('timber', [s - 0.08, WORLD.waterLevel - 2.0, sz * (W / 2 + 0.02) - 0.08], [s + 0.08, deck(Math.min(s, len)) - 0.15, sz * (W / 2 + 0.02) + 0.08], 1.2, { aoBottom: 0.5 });
          B.box('timber', [s - 0.06, deck(Math.min(s, len)) - 0.2, sz * (W / 2 + 0.02) - 0.06], [s + 0.06, deck(Math.min(s, len)) + 1.0, sz * (W / 2 + 0.02) + 0.06], 1.2, { aoBottom: 0.9 });
        }
      }
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 12; i++) {
          const s0 = (i / 12) * len, s1 = ((i + 1) / 12) * len;
          B.tint = TIMBER;
          B.beam('timber', [s0, deck(s0) + 0.98, sz * (W / 2 + 0.02)], [s1, deck(s1) + 0.98, sz * (W / 2 + 0.02)], 0.1);
          B.beam('timber', [s0, deck(s0) + 0.5, sz * (W / 2 + 0.02)], [s1, deck(s1) + 0.5, sz * (W / 2 + 0.02)], 0.07);
        }
      }
      B.pop();
      out.decks.push({ ax, az, ang, len, width: W - 0.2, deck, kind: 'wood' });
      out.colliders.push({ x: (ax + bx) / 2 - Math.sin(ang) * (W / 2 + 0.1), z: (az + bz) / 2 + Math.cos(ang) * (W / 2 + 0.1), hx: len / 2, hz: 0.12, rot: -ang });
      out.colliders.push({ x: (ax + bx) / 2 + Math.sin(ang) * (W / 2 + 0.1), z: (az + bz) / 2 - Math.cos(ang) * (W / 2 + 0.1), hx: len / 2, hz: 0.12, rot: -ang });
    }
  }

  // dock on the pond
  {
    const { x, z, len, width, angle } = DOCK;
    const y = WORLD.waterLevel + 0.55;
    const rand = mulberry32(8);
    B.push(new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z));
    for (let s = -1.5; s < len; s += 0.26) {
      B.tint = [0.58 + rand() * 0.15, 0.47 + rand() * 0.12, 0.36 + rand() * 0.1];
      B.box('planks', [s - 0.12, y - 0.05, -width / 2 + (rand() - 0.5) * 0.05], [s + 0.12, y + 0.03, width / 2 + (rand() - 0.5) * 0.05], 1.0, { aoBottom: 0.8 });
    }
    for (let s = 0; s <= len; s += len / 4) for (const sz of [-1, 1]) {
      B.tint = TIMBER_DARK;
      B.box('timber', [s - 0.09, WORLD.waterLevel - 2, sz * (width / 2) - 0.09], [s + 0.09, y + (s > len - 0.1 ? 0.6 : -0.06), sz * (width / 2) + 0.09], 1.2, { aoBottom: 0.4 });
    }
    B.pop();
    const ca = Math.cos(angle), sa = Math.sin(angle);
    out.decks.push({ ax: x - ca * 1.5, az: z + sa * 1.5, ang: -angle, len: len + 1.5, width: width - 0.2, deck: () => y + 0.03, kind: 'dock' });
  }
  return out;
}

/** Simple rowing boat (built separately so it can bob on the water). */
export function buildBoat(B) {
  const L = 3.6, Wd = 1.25, Hh = 0.55;
  const segs = 10;
  const prof = (t) => Math.pow(Math.sin(Math.PI * t), 0.65); // beam along the length
  B.tint = [0.42, 0.3, 0.2];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x0 = -L / 2 + t0 * L, x1 = -L / 2 + t1 * L;
    const w0 = Wd / 2 * prof(t0) + 0.02, w1 = Wd / 2 * prof(t1) + 0.02;
    for (const sz of [-1, 1]) {
      const a = [x0, Hh, sz * w0], b = [x1, Hh, sz * w1], c = [x1, 0.05, sz * w1 * 0.55], d = [x0, 0.05, sz * w0 * 0.55];
      if (sz > 0) B.quad('planks', d, c, b, a, [[0, 0], [0.4, 0], [0.4, 0.5], [0, 0.5]]);
      else B.quad('planks', c, d, a, b, [[0, 0], [0.4, 0], [0.4, 0.5], [0, 0.5]]);
    }
    B.tint = [0.32, 0.22, 0.15];
    B.quad('planks', [x0, 0.05, -w0 * 0.55], [x1, 0.05, -w1 * 0.55], [x1, 0.05, w1 * 0.55], [x0, 0.05, w0 * 0.55], [[0, 0], [0.4, 0], [0.4, 0.5], [0, 0.5]]);
    B.tint = [0.42, 0.3, 0.2];
  }
  B.tint = [0.5, 0.38, 0.27];
  B.box('planks', [-0.15, 0.3, -Wd / 2 + 0.05], [0.15, 0.36, Wd / 2 - 0.05], 1);
  B.box('planks', [0.9, 0.3, -Wd / 2 + 0.1], [1.15, 0.36, Wd / 2 - 0.1], 1);
  // oars
  B.tint = [0.55, 0.42, 0.3];
  B.beam('planks', [-0.2, 0.42, -0.4], [0.9, 0.38, 0.5], 0.05);
  B.beam('planks', [-0.25, 0.42, 0.4], [0.85, 0.38, -0.5], 0.05);
}
