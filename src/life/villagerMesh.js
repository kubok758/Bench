import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

// Bone layout (character faces +z, its left side is +x)
export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', upperArmL: 'chest', foreArmL: 'upperArmL', handL: 'foreArmL', upperArmR: 'chest', foreArmR: 'upperArmR', handR: 'foreArmR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
const REST = {
  root: [0, 0, 0], hips: [0, 0.94, 0], spine: [0, 1.06, 0], chest: [0, 1.24, 0], neck: [0, 1.47, 0], head: [0, 1.57, 0.01],
  upperArmL: [0.195, 1.43, 0], foreArmL: [0.215, 1.15, 0.0], handL: [0.228, 0.905, 0.01],
  upperArmR: [-0.195, 1.43, 0], foreArmR: [-0.215, 1.15, 0.0], handR: [-0.228, 0.905, 0.01],
  thighL: [0.092, 0.92, 0], shinL: [0.096, 0.5, 0.01], footL: [0.098, 0.085, -0.02],
  thighR: [-0.092, 0.92, 0], shinR: [-0.096, 0.5, 0.01], footR: [-0.098, 0.085, -0.02],
};

// material ids for shading
export const MAT = { skin: 0, cloth: 1, hair: 2, leather: 3, straw: 4, eye: 5 };

const SKIN = [[0.72, 0.5, 0.4], [0.64, 0.44, 0.34], [0.55, 0.37, 0.27], [0.76, 0.56, 0.45], [0.42, 0.28, 0.2]];
const HAIR = [[0.12, 0.08, 0.05], [0.28, 0.17, 0.08], [0.42, 0.28, 0.14], [0.6, 0.45, 0.25], [0.18, 0.12, 0.09], [0.55, 0.53, 0.5], [0.45, 0.2, 0.08]];
const DYES = [[0.34, 0.07, 0.05], [0.09, 0.15, 0.3], [0.42, 0.28, 0.08], [0.18, 0.23, 0.08], [0.48, 0.42, 0.3], [0.22, 0.14, 0.08], [0.24, 0.24, 0.25], [0.18, 0.09, 0.2], [0.38, 0.16, 0.06], [0.1, 0.2, 0.18], [0.4, 0.33, 0.2]];

class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.si = []; this.sw = []; this.face = []; this.i = []; this.ao = []; }
  vert(p, n, col, mat, weights, face = [0, 0, 0]) {
    this.p.push(...p); this.n.push(...n); this.c.push(...col); this.m.push(mat); this.face.push(...face);
    this.ao.push(vertexAO(p, n));
    const w = weights.slice(0, 4);
    while (w.length < 4) w.push([0, 0]);
    let s = 0;
    for (const [, v] of w) s += v;
    for (const [b, v] of w) { this.si.push(b); this.sw.push(s > 0 ? v / s : 0); }
    return this.p.length / 3 - 1;
  }
}

// Heuristic ambient occlusion for a standing figure: ground, armpits, under the chin.
function vertexAO(p, n) {
  const [x, y, z] = p;
  let ao = 0.72 + 0.28 * Math.min(1, Math.max(0, y / 0.9));
  const ax = Math.abs(x);
  // torso sides hidden by the arms
  if (y > 1.05 && y < 1.42 && ax > 0.11 && ax < 0.2) ao *= 1 - 0.35 * (1 - Math.abs(y - 1.28) / 0.25) * Math.max(0, Math.sign(x) * n[0]);
  // inner side of the arms
  if (y > 0.9 && y < 1.42 && ax > 0.17 && ax < 0.27) ao *= 1 - 0.3 * Math.max(0, -Math.sign(x) * n[0]);
  // under the chin / neck
  if (y > 1.42 && y < 1.6 && ax < 0.07) ao *= 0.75 + 0.25 * Math.min(1, Math.max(0, (y - 1.42) / 0.16));
  // between the legs
  if (y < 0.9 && ax < 0.13) ao *= 1 - 0.3 * Math.max(0, -Math.sign(x) * n[0]);
  return Math.max(0.35, Math.min(1, ao));
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Vertical tube made of rings [{y, rx, rz, cx, cz}] (bottom to top).
 * weightsFn(x, y, z) -> [[bone, w], ...]
 */
function vtube(g, rings, segs, col, mat, weightsFn, { capTop = false, capBottom = false, faceFn = null, folds = null } = {}) {
  const start = g.p.length / 3;
  for (let r = 0; r < rings.length; r++) {
    const R = rings[r];
    const prev = rings[Math.max(r - 1, 0)], next = rings[Math.min(r + 1, rings.length - 1)];
    const dy = next.y - prev.y || 1e-3;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const fold = folds ? 1 + folds(R.y, a) : 1;
      const x = R.cx + ca * R.rx * fold, z = R.cz + sa * R.rz * fold;
      // normal: ellipse normal tilted by the radius slope
      const drx = next.rx - prev.rx, drz = next.rz - prev.rz;
      const slope = -((ca * ca) * drx + (sa * sa) * drz) / dy;
      const n = new THREE.Vector3(ca / Math.max(R.rx, 1e-3) * Math.max(R.rx, R.rz), slope, sa / Math.max(R.rz, 1e-3) * Math.max(R.rx, R.rz)).normalize();
      g.vert([x, R.y, z], n.toArray(), typeof col === 'function' ? col(x, R.y, z) : col, mat, weightsFn(x, R.y, z), faceFn ? faceFn(x, R.y, z) : [0, 0, 0]);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = start + r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      g.i.push(a, c, b, b, c, d);
    }
  }
  const cap = (R, up) => {
    const ci = g.vert([R.cx, R.y, R.cz], [0, up ? 1 : -1, 0], typeof col === 'function' ? col(R.cx, R.y, R.cz) : col, mat, weightsFn(R.cx, R.y, R.cz));
    const base = start + rings.indexOf(R) * (segs + 1);
    for (let s = 0; s < segs; s++) up ? g.i.push(ci, base + s + 1, base + s) : g.i.push(ci, base + s, base + s + 1);
  };
  if (capTop) cap(rings[rings.length - 1], true);
  if (capBottom) cap(rings[0], false);
}

/** Ellipsoid centred at c with radii r; deform(x,y,z) may push vertices. */
function ellipsoid(g, c, r, segU, segV, col, mat, weightsFn, deform = null, faceFn = null, { yMin = -1, yMax = 1 } = {}) {
  const start = g.p.length / 3;
  for (let v = 0; v <= segV; v++) {
    const phi = Math.PI * (1 - v / segV); // from bottom (pi) to top (0)
    const cy = Math.cos(phi);
    if (cy < yMin - 1e-6 && v < segV) { /* keep grid regular */ }
    const sy = Math.sin(phi);
    for (let u = 0; u <= segU; u++) {
      const th = (u / segU) * Math.PI * 2;
      let nx = Math.cos(th) * sy, ny = Math.max(Math.min(cy, yMax), yMin), nz = Math.sin(th) * sy;
      let x = c[0] + nx * r[0], y = c[1] + ny * r[1], z = c[2] + nz * r[2];
      if (deform) [x, y, z] = deform(x, y, z, nx, ny, nz);
      const n = new THREE.Vector3(nx / r[0], ny / r[1], nz / r[2]).normalize();
      g.vert([x, y, z], n.toArray(), typeof col === 'function' ? col(x, y, z) : col, mat, weightsFn(x, y, z), faceFn ? faceFn(x, y, z) : [0, 0, 0]);
    }
  }
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    const a = start + v * (segU + 1) + u, b = a + 1, cc = a + segU + 1, d = cc + 1;
    g.i.push(a, cc, b, b, cc, d);
  }
}

// ---------------------------------------------------------------------------
export function buildVillager(seed, opts = {}) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const female = opts.female ?? rand() < 0.45;
  const elder = rand() < 0.18;
  const child = opts.child ?? false;
  const skin = pick(SKIN);
  const hair = elder ? [0.62, 0.6, 0.57] : pick(HAIR);
  const top = pick(DYES), bottom = pick(DYES), accent = pick(DYES);
  const stout = rand() * 0.25;
  const g = new Geo();
  const W = (b) => B[b];

  // weights --------------------------------------------------------------
  const wTorso = (x, y) => {
    const out = [];
    const tH = smooth(0.96, 1.12, y), tC = smooth(1.12, 1.3, y);
    out.push([W('hips'), 1 - tH]);
    out.push([W('spine'), tH * (1 - tC)]);
    out.push([W('chest'), tC]);
    const sh = smooth(1.3, 1.42, y) * smooth(0.11, 0.19, Math.abs(x));
    if (sh > 0) out.push([x > 0 ? W('upperArmL') : W('upperArmR'), sh * 0.45]);
    return out.filter((w) => w[1] > 1e-3);
  };
  const wSkirt = (x, y) => {
    const leg = smooth(0.92, 0.35, y) * 0.62;
    const side = smooth(-0.06, 0.06, x);
    const out = [[W('hips'), 1 - leg]];
    if (leg > 0) {
      out.push([W('thighL'), leg * side * 0.7]);
      out.push([W('thighR'), leg * (1 - side) * 0.7]);
      const low = smooth(0.55, 0.15, y) * 0.35;
      out.push([W('shinL'), low * side]);
      out.push([W('shinR'), low * (1 - side)]);
    }
    return out.filter((w) => w[1] > 1e-3);
  };
  const wNeck = (x, y) => [[W('chest'), 1 - smooth(1.46, 1.54, y)], [W('neck'), smooth(1.46, 1.54, y) * (1 - smooth(1.56, 1.6, y))], [W('head'), smooth(1.56, 1.6, y)]].filter((w) => w[1] > 1e-3);
  const limbW = (top, mid, low, yJoint1, yJoint2) => (x, y) => {
    const a = smooth(yJoint1 + 0.05, yJoint1 - 0.05, y);
    const b = smooth(yJoint2 + 0.04, yJoint2 - 0.04, y);
    return [[W(top), 1 - a], [W(mid), a * (1 - b)], [W(low), b]].filter((w) => w[1] > 1e-3);
  };
  const armW = (s) => (x, y) => {
    const base = limbW(`upperArm${s}`, `foreArm${s}`, `hand${s}`, 1.15, 0.91)(x, y);
    const sh = smooth(1.36, 1.44, y) * 0.35;
    if (sh > 0) base.push([W('chest'), sh]);
    return base;
  };
  const legW = (s) => (x, y) => {
    const base = limbW(`thigh${s}`, `shin${s}`, `foot${s}`, 0.5, 0.1)(x, y);
    const hp = smooth(0.84, 0.94, y) * 0.5;
    if (hp > 0) base.push([W('hips'), hp]);
    return base;
  };

  // body -------------------------------------------------------------------
  const sw = 1 + stout;
  const torso = [
    { y: 0.86, rx: 0.155 * sw, rz: 0.11 * sw, cx: 0, cz: -0.005 },
    { y: 0.96, rx: 0.165 * sw, rz: 0.115 * sw, cx: 0, cz: 0 },
    { y: 1.06, rx: 0.15 * sw, rz: 0.11 * sw, cx: 0, cz: 0.008 },
    { y: 1.16, rx: (female ? 0.138 : 0.15) * sw, rz: 0.105 * sw, cx: 0, cz: 0.01 },
    { y: 1.27, rx: 0.16 * sw, rz: (female ? 0.122 : 0.11) * sw, cx: 0, cz: 0.012 },
    { y: 1.35, rx: (female ? 0.165 : 0.18) * sw, rz: 0.11 * sw, cx: 0, cz: 0.005 },
    { y: 1.405, rx: (female ? 0.172 : 0.19) * sw, rz: 0.1, cx: 0, cz: -0.003 },
    { y: 1.44, rx: female ? 0.14 : 0.15, rz: 0.085, cx: 0, cz: -0.008 },
    { y: 1.47, rx: 0.075, rz: 0.058, cx: 0, cz: -0.006 },
  ];
  // the tunic / bodice covers the torso
  vtube(g, torso, 18, top, MAT.cloth, wTorso, { capTop: false });
  // neck
  vtube(g, [{ y: 1.44, rx: 0.056, rz: 0.054, cx: 0, cz: 0 }, { y: 1.51, rx: 0.05, rz: 0.05, cx: 0, cz: 0.006 }, { y: 1.58, rx: 0.048, rz: 0.048, cx: 0, cz: 0.012 }], 10, skin, MAT.skin, wNeck);

  // head with a nose, a chin, ears; face coordinates for the procedural features
  const hc = [0, 1.652, 0.014];
  const hr = [0.092, 0.121, 0.106];
  const faceFn = (x, y, z) => [(x - hc[0]) / hr[0], (y - hc[1]) / hr[1], (z - hc[2]) / hr[2]];
  ellipsoid(g, hc, hr, 20, 16, skin, MAT.skin, () => [[W('head'), 1]], (x, y, z, nx, ny, nz) => {
    // narrow the jaw, flatten the back, add nose and brow
    const front = Math.max(0, nz);
    let X = x, Y = y, Z = z;
    if (ny < -0.2) { X = hc[0] + (x - hc[0]) * (1 - (-0.2 - ny) * 0.35); }
    if (nz < -0.5) Z = hc[2] + (z - hc[2]) * 0.94;
    const nose = Math.exp(-((nx * nx) / 0.012 + ((ny + 0.12) * (ny + 0.12)) / 0.05)) * front;
    Z += nose * 0.022;
    const brow = Math.exp(-((ny - 0.22) * (ny - 0.22)) / 0.006) * front * front * 0.006;
    Z += brow;
    return [X, Y, Z];
  }, faceFn);
  for (const s of [-1, 1]) {
    ellipsoid(g, [s * 0.093, 1.648, 0.002], [0.013, 0.032, 0.021], 6, 5, skin.map((v) => v * 0.95), MAT.skin, () => [[W('head'), 1]]);
  }

  // hair: short crop, bun, or braid for women; some men bald or bearded
  const hairStyle = female ? (rand() < 0.5 ? 'bun' : 'braid') : elder && rand() < 0.5 ? 'bald' : 'short';
  const hairW = () => [[W('head'), 1]];
  if (hairStyle !== 'bald') {
    ellipsoid(g, [0, 1.676, -0.003], [0.098, 0.103, 0.113], 18, 12, hair, MAT.hair, hairW, (x, y, z, nx, ny, nz) => {
      // hairline: pull the front/lower part of the shell up and back onto the scalp
      let Y = y, Z = z;
      if (nz > 0.2 && ny < 0.5) { Y = Math.max(y, 1.676 + 0.103 * (0.5 - 0.25 * Math.max(0, 1 - Math.abs(nx) * 2.2))); Z -= 0.01; }
      if (ny < -0.1 && nz > -0.55) Y = Math.max(Y, 1.64 - Math.max(0, -nz) * 0.03);
      // a little volume on top and at the back
      return [x * 1.02, Y + Math.max(0, ny) * 0.006, Z - Math.max(0, -nz) * 0.01];
    });
  } else {
    // fringe of grey hair around the back of a bald head
    ellipsoid(g, [0, 1.64, -0.012], [0.097, 0.055, 0.11], 14, 6, hair, MAT.hair, hairW, (x, y, z, nx, ny, nz) => [x, y, nz > 0.3 ? z - 0.03 : z]);
  }
  if (hairStyle === 'bun') ellipsoid(g, [0, 1.71, -0.115], [0.048, 0.045, 0.042], 10, 8, hair, MAT.hair, hairW);
  if (hairStyle === 'braid') {
    const rings = [];
    for (let k = 0; k <= 9; k++) {
      const t = k / 9;
      rings.push({ y: 1.63 - t * 0.36, rx: 0.028 * (1 - t * 0.4) * (1 + 0.15 * Math.sin(t * 40)), rz: 0.026 * (1 - t * 0.4), cx: 0, cz: -0.112 - Math.sin(t * Math.PI) * 0.02 });
    }
    rings.reverse();
    vtube(g, rings, 8, hair, MAT.hair, (x, y) => (y > 1.56 ? [[W('head'), 1]] : [[W('neck'), 0.4], [W('chest'), 0.6]]), { capBottom: true });
    vtube(g, [{ y: 1.275, rx: 0.03, rz: 0.03, cx: 0, cz: -0.1 }, { y: 1.3, rx: 0.031, rz: 0.031, cx: 0, cz: -0.1 }], 8, pick(DYES), MAT.cloth, () => [[W('chest'), 1]]);
  }
  // beards and moustaches
  if (!female && rand() < (elder ? 0.75 : 0.4)) {
    const full = rand() < 0.6;
    const bc = elder ? [0.7, 0.68, 0.64] : hair;
    ellipsoid(g, [0, full ? 1.578 : 1.592, 0.062], [0.078, full ? 0.066 : 0.038, 0.054], 12, 8, bc, MAT.hair, hairW, (x, y, z, nx, ny, nz) => [x, y, nz < 0 ? z + nz * -0.01 : z + 0.004]);
    ellipsoid(g, [0, 1.616, 0.1], [0.036, 0.012, 0.017], 8, 5, bc, MAT.hair, hairW);
  }

  // headwear
  const hat = female ? (rand() < 0.45 ? 'kerchief' : rand() < 0.5 ? 'straw' : 'none') : rand() < 0.35 ? 'straw' : rand() < 0.5 ? 'cap' : 'none';
  if (hat === 'straw') {
    const straw = [0.78, 0.66, 0.4];
    vtube(g, [{ y: 1.738, rx: 0.21, rz: 0.21, cx: 0, cz: 0.005 }, { y: 1.743, rx: 0.21, rz: 0.21, cx: 0, cz: 0.005 }, { y: 1.75, rx: 0.108, rz: 0.118, cx: 0, cz: 0.005 }, { y: 1.83, rx: 0.095, rz: 0.105, cx: 0, cz: 0.005 }], 18, straw, MAT.straw, () => [[W('head'), 1]], { capTop: true, capBottom: true });
    vtube(g, [{ y: 1.748, rx: 0.11, rz: 0.12, cx: 0, cz: 0.005 }, { y: 1.772, rx: 0.108, rz: 0.118, cx: 0, cz: 0.005 }], 18, accent, MAT.cloth, () => [[W('head'), 1]]);
  } else if (hat === 'cap') {
    ellipsoid(g, [0, 1.71, 0.0], [0.104, 0.082, 0.117], 14, 8, accent, MAT.cloth, () => [[W('head'), 1]], (x, y, z, nx, ny) => [x, Math.max(y, 1.705), z]);
  } else if (hat === 'kerchief') {
    ellipsoid(g, [0, 1.68, -0.005], [0.101, 0.108, 0.116], 14, 10, pick([[0.6, 0.55, 0.45], accent, [0.5, 0.14, 0.1]]), MAT.cloth, () => [[W('head'), 1]], (x, y, z, nx, ny, nz) => {
      let Y = y;
      if (nz > 0.2 && ny < 0.55) Y = Math.max(y, 1.68 + 0.108 * 0.5);
      return [x, Y, z];
    });
  }

  // arms (sleeves + hands)
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const sleeveLong = female || rand() < 0.6;
    const arm = [
      { y: 0.93, rx: 0.034, rz: 0.032, cx: sx * 0.228, cz: 0.012 },
      { y: 1.02, rx: 0.04, rz: 0.038, cx: sx * 0.224, cz: 0.008 },
      { y: 1.15, rx: 0.047, rz: 0.046, cx: sx * 0.215, cz: 0.0 },
      { y: 1.28, rx: 0.052, rz: 0.05, cx: sx * 0.207, cz: -0.002 },
      { y: 1.37, rx: 0.055, rz: 0.053, cx: sx * 0.2, cz: 0 },
      { y: 1.44, rx: 0.042, rz: 0.044, cx: sx * 0.178, cz: 0 },
    ];
    const armCol = (x, y) => (sleeveLong ? (y < 0.96 ? skin : top) : y < 1.22 ? skin : top);
    const armMat = (y) => (sleeveLong ? (y < 0.96 ? MAT.skin : MAT.cloth) : y < 1.22 ? MAT.skin : MAT.cloth);
    // split into two tubes so the material id switches cleanly at the cuff
    const cut = sleeveLong ? 0.96 : 1.22;
    const lower = arm.filter((r) => r.y <= cut + 0.07);
    const upper = arm.filter((r) => r.y >= cut - 0.07);
    vtube(g, lower, 10, armCol(0, 0.9), armMat(0.9), armW(s));
    vtube(g, upper.map((r) => ({ ...r, rx: r.rx * 1.08, rz: r.rz * 1.08 })), 12, armCol(0, 1.4), armMat(1.4), armW(s), { folds: (y, a) => Math.sin(a * 5 + y * 30) * 0.04 });
    ellipsoid(g, [sx * 0.23, 0.862, 0.016], [0.028, 0.058, 0.04], 10, 7, skin, MAT.skin, () => [[W(`hand${s}`), 1]]);
    ellipsoid(g, [sx * 0.225, 0.88, 0.052], [0.014, 0.03, 0.014], 6, 5, skin, MAT.skin, () => [[W(`hand${s}`), 1]]);
    // cuff
    vtube(g, [{ y: cut - 0.025, rx: (sleeveLong ? 0.04 : 0.05), rz: (sleeveLong ? 0.04 : 0.05), cx: sx * (sleeveLong ? 0.226 : 0.212), cz: 0.008 }, { y: cut + 0.03, rx: (sleeveLong ? 0.043 : 0.054), rz: (sleeveLong ? 0.043 : 0.054), cx: sx * (sleeveLong ? 0.225 : 0.211), cz: 0.006 }], 10, top.map((v) => v * 0.78), MAT.cloth, armW(s));
  }

  // legs: trousers / stockings + boots
  const boots = rand() < 0.7 ? [0.22, 0.15, 0.1] : [0.32, 0.24, 0.16];
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const leg = [
      { y: 0.06, rx: 0.042, rz: 0.048, cx: sx * 0.098, cz: 0.0 },
      { y: 0.14, rx: 0.044, rz: 0.048, cx: sx * 0.097, cz: 0.0 },
      { y: 0.32, rx: 0.052, rz: 0.058, cx: sx * 0.096, cz: 0.0 },
      { y: 0.5, rx: 0.058, rz: 0.06, cx: sx * 0.096, cz: 0.012 },
      { y: 0.7, rx: 0.074 * sw, rz: 0.08 * sw, cx: sx * 0.094, cz: 0.012 },
      { y: 0.9, rx: 0.088 * sw, rz: 0.092 * sw, cx: sx * 0.09, cz: 0.0 },
    ];
    vtube(g, leg.slice(0, 3), 10, boots, MAT.leather, legW(s), { capBottom: true });
    vtube(g, leg.slice(1).map((r) => ({ ...r, rx: r.rx * 1.02 })), 10, female ? [0.85, 0.82, 0.74] : bottom, MAT.cloth, legW(s));
    // boot cuff
    vtube(g, [{ y: 0.3, rx: 0.06, rz: 0.066, cx: sx * 0.096, cz: 0 }, { y: 0.34, rx: 0.062, rz: 0.068, cx: sx * 0.096, cz: 0 }], 10, boots.map((v) => v * 0.85), MAT.leather, legW(s));
    // foot
    ellipsoid(g, [sx * 0.1, 0.045, 0.055], [0.048, 0.045, 0.115], 10, 6, boots, MAT.leather, () => [[W(`foot${s}`), 1]], (x, y, z) => [x, Math.max(y, 0.0), z]);
  }

  // skirt / tunic tail
  const skirtLen = female ? 0.08 : 0.62;
  const skirtCol = female ? bottom : top;
  const flare = female ? 0.27 + rand() * 0.04 : 0.2;
  const skirt = [];
  const n = 7;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const y = 0.98 - t * (0.98 - skirtLen);
    const r = (0.168 * sw) + (flare - 0.168) * Math.pow(t, 0.8) * sw;
    skirt.push({ y, rx: r, rz: r * (female ? 0.9 : 0.8), cx: 0, cz: female ? 0.01 : 0 });
  }
  skirt.reverse();
  vtube(g, skirt, 32, skirtCol, MAT.cloth, wSkirt, { folds: (y, a) => Math.sin(a * 11 + Math.sin(a * 3) * 1.5) * 0.045 * Math.min(1, Math.max(0, (0.95 - y) / 0.6)) });
  // inner side of the skirt hem (visible from below)
  // belt
  vtube(g, [{ y: 0.96, rx: 0.172 * sw, rz: 0.122 * sw, cx: 0, cz: 0 }, { y: 1.01, rx: 0.17 * sw, rz: 0.12 * sw, cx: 0, cz: 0 }], 18, female ? accent : [0.2, 0.13, 0.08], female ? MAT.cloth : MAT.leather, wTorso);
  // apron for some women
  if (female && rand() < 0.65) {
    const ap = [0.86, 0.83, 0.74];
    const apron = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const y = 0.97 - t * 0.62;
      const r = 0.172 * sw + 0.07 * t;
      apron.push({ y, rx: r, rz: r * 0.92, cx: 0, cz: 0.012 });
    }
    apron.reverse();
    // only the front half: build as a partial tube by masking with a tiny inward push at the back
    const start = g.p.length / 3;
    vtube(g, apron, 20, ap, MAT.cloth, wSkirt);
    for (let v = start; v < g.p.length / 3; v++) {
      if (g.p[v * 3 + 2] < 0.02) { g.p[v * 3 + 2] = 0.0; g.p[v * 3] *= 0.6; }
    }
  }
  // things people carry
  const carry = opts.carry ?? (female ? (rand() < 0.45 ? 'basket' : 'none') : elder ? 'staff' : 'none');
  if (carry === 'basket') {
    const wc = [0.5, 0.36, 0.2];
    const bw = () => [[W('foreArmL'), 1]];
    vtube(g, [{ y: 0.72, rx: 0.115, rz: 0.085, cx: 0.32, cz: 0.07 }, { y: 0.8, rx: 0.135, rz: 0.1, cx: 0.32, cz: 0.07 }, { y: 0.88, rx: 0.145, rz: 0.108, cx: 0.32, cz: 0.07 }], 14, wc, MAT.straw, bw, { capBottom: true });
    vtube(g, [{ y: 0.865, rx: 0.13, rz: 0.095, cx: 0.32, cz: 0.07 }, { y: 0.9, rx: 0.11, rz: 0.08, cx: 0.32, cz: 0.07 }], 12, pick([[0.52, 0.12, 0.08], [0.66, 0.6, 0.46], [0.24, 0.32, 0.14]]), MAT.cloth, bw, { capTop: true });
    // handle
    for (let k = 0; k <= 8; k++) {
      const a0 = Math.PI * (k / 8);
      ellipsoid(g, [0.32 + Math.cos(a0) * 0.12, 0.9 + Math.sin(a0) * 0.12, 0.07], [0.012, 0.012, 0.012], 4, 3, wc, MAT.straw, bw);
    }
  } else if (carry === 'staff') {
    vtube(g, [{ y: 0.0, rx: 0.016, rz: 0.016, cx: -0.27, cz: 0.12 }, { y: 1.35, rx: 0.02, rz: 0.02, cx: -0.27, cz: 0.12 }], 6, [0.34, 0.24, 0.14], MAT.leather, () => [[W('handR'), 1]], { capTop: true, capBottom: true });
  }
  // collar: undershirt showing at the neckline + darker hem band
  const linen = [0.5, 0.45, 0.35];
  vtube(g, [{ y: 1.425, rx: 0.078, rz: 0.062, cx: 0, cz: 0.012 }, { y: 1.47, rx: 0.062, rz: 0.054, cx: 0, cz: 0.008 }], 14, female ? linen : top.map((v) => v * 0.7), MAT.cloth, wNeck);
  // belt pouch for men, knife for some
  if (!female) {
    ellipsoid(g, [-0.13, 0.94, 0.09], [0.045, 0.055, 0.025], 8, 6, [0.28, 0.18, 0.1], MAT.leather, () => [[W('hips'), 1]]);
  }

  // ---- geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(g.c, 3));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(g.m, 1));
  geo.setAttribute('aFace', new THREE.Float32BufferAttribute(g.face, 3));
  geo.setAttribute('aAo', new THREE.Float32BufferAttribute(g.ao, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(g.si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(g.sw, 4));
  geo.setIndex(g.i);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = 1.2;
  geo.boundingSphere.center.set(0, 0.9, 0);

  // ---- skeleton
  const bones = BONES.map((name) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONES.forEach((name, i) => {
    const p = REST[name];
    if (PARENT[name]) {
      const pp = REST[PARENT[name]];
      bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      bones[B[PARENT[name]]].add(bones[i]);
    } else bones[i].position.set(...p);
  });
  const skeleton = new THREE.Skeleton(bones);
  return { geo, skeleton, bones, female, elder, carry, hat, hair, scale: (female ? 0.95 : 1.0) * (0.95 + rand() * 0.09) * (child ? 0.7 : 1) };
}

export { REST, B as BONE_INDEX };
