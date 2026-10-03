import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { FIELDS, HOUSES, LANDMARKS } from '../world/layout.js';

const TIMBER = [0.42, 0.31, 0.23];
const TIMBER_DARK = [0.3, 0.22, 0.17];

function barrel(B, x, y, z, s = 1, tint = [0.62, 0.46, 0.32]) {
  B.tint = tint;
  const r0 = 0.3 * s, r1 = 0.36 * s, h = 0.42 * s;
  B.cylinder('planks', [x, y, z], r0, r1, h, 12, 0.6, { aoBottom: 0.6 });
  B.cylinder('planks', [x, y + h, z], r1, r0, h, 12, 0.6, { aoBottom: 1, cap: true });
  B.tint = [0.12, 0.11, 0.1];
  for (const yy of [0.1, 0.38, 0.46, 0.74]) {
    const r = yy < 0.42 ? r0 + (r1 - r0) * (yy / 0.42) : r1 + (r0 - r1) * ((yy - 0.42) / 0.42);
    B.cylinder('color', [x, y + yy * s - 0.025, z], r + 0.012, r + 0.012, 0.05, 12, 1, { aoBottom: 1 });
  }
}

function crate(B, x, y, z, rot, s = 0.55, tint = [0.7, 0.56, 0.4]) {
  B.tint = tint;
  B.obox('planks', [x, y + s / 2, z], [s / 2, s / 2, s / 2], rot, 0.7, { aoBottom: 0.6 });
}

function fenceRun(B, data, pts, rand, { postGap = 2.3, h = 1.05, tint = [0.55, 0.45, 0.35] } = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / postGap));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = data.heightAt(x, z);
      const lean = (rand() - 0.5) * 0.06;
      B.tint = tint.map((v) => v * (0.85 + rand() * 0.25));
      B.push(new THREE.Matrix4().makeRotationZ(lean).setPosition(x, y, z));
      B.box('timber', [-0.07, -0.4, -0.07], [0.07, h, 0.07], 1.2, { aoBottom: 0.6 });
      B.pop();
      if (prev) {
        for (const ry of [0.42, 0.85]) {
          B.tint = tint.map((v) => v * (0.9 + rand() * 0.2));
          B.beam('timber', [prev[0], prev[1] + ry + (rand() - 0.5) * 0.04, prev[2]], [x, y + ry + (rand() - 0.5) * 0.04, z], 0.07);
        }
      }
      prev = [x, y, z];
    }
  }
}

export function buildProps(B, Bcloth, data) {
  const rand = mulberry32(2024);
  const colliders = [];
  const lamps = [];

  // ---- market stall by the well
  {
    const x = 8.5, z = -6.5, rot = -0.55;
    const y = data.heightAt(x, z);
    B.frame(x, y, z, rot);
    B.tint = TIMBER;
    for (const [px, pz] of [[-1.5, -0.9], [1.5, -0.9], [-1.5, 0.9], [1.5, 0.9]]) B.box('timber', [px - 0.07, 0, pz - 0.07], [px + 0.07, pz < 0 ? 2.5 : 2.15, pz + 0.07], 1.2, { aoBottom: 0.6 });
    B.tint = [0.6, 0.47, 0.34];
    B.box('planks', [-1.6, 0.85, -0.85], [1.6, 0.93, 0.85], 0.9, { aoBottom: 0.8 });
    B.box('planks', [-1.55, 0.2, -0.8], [1.55, 0.85, -0.75], 0.9, { aoBottom: 0.7 });
    // produce
    const prod = [[0.7, 0.08, 0.05], [0.25, 0.45, 0.1], [0.85, 0.5, 0.1], [0.55, 0.32, 0.15], [0.9, 0.75, 0.3]];
    for (let i = 0; i < 4; i++) {
      const cx = -1.15 + i * 0.77;
      B.tint = [0.55, 0.42, 0.3];
      B.box('planks', [cx - 0.33, 0.93, -0.55], [cx + 0.33, 1.08, 0.45], 0.6);
      B.tint = prod[i % prod.length];
      for (let k = 0; k < 9; k++) B.obox('color', [cx + (rand() - 0.5) * 0.5, 1.1 + rand() * 0.06, -0.45 + rand() * 0.8], [0.06, 0.055, 0.06], rand() * 3, 1);
    }
    B.pop();
    // striped canopy (sways a little)
    Bcloth.frame(x, y, z, rot);
    for (let i = 0; i < 8; i++) {
      const x0 = -1.75 + i * 0.4375, x1 = x0 + 0.4375;
      Bcloth.tint = i % 2 ? [0.95, 0.9, 0.8] : [0.7, 0.16, 0.12];
      Bcloth.quad('cloth', [x0, 2.12, 1.05], [x1, 2.12, 1.05], [x1, 2.55, -1.05], [x0, 2.55, -1.05], [[0, 0.6], [1, 0.6], [1, 1], [0, 1]]);
      Bcloth.quad('cloth', [x0, 1.8, 1.08], [x1, 1.8, 1.08], [x1, 2.12, 1.05], [x0, 2.12, 1.05], [[0, 0], [1, 0], [1, 0.6], [0, 0.6]]);
    }
    Bcloth.pop();
    colliders.push({ x, z, hx: 1.7, hz: 1.0, rot });
  }

  // ---- barrels & crates by houses and the square
  const spots = [[-12, -3, 0], [11, 9, 0.4], [-25, 11, 1.2], [28, -8, 0.3], [47, -14, 0.1], [-38, 4, 1.5], [16, 48, -1.5], [-10, 78, 1.5], [-26, -36, 1.1], [57, -20, 0.1]];
  for (const [x, z, r] of spots) {
    const y = data.heightAt(x, z);
    const kind = rand();
    if (kind < 0.5) {
      barrel(B, x, y - 0.02, z, 1, [0.6 + rand() * 0.1, 0.44 + rand() * 0.08, 0.3]);
      if (rand() < 0.7) barrel(B, x + Math.cos(r) * 0.75, data.heightAt(x + Math.cos(r) * 0.75, z) - 0.02, z + Math.sin(r) * 0.75, 0.95);
      if (rand() < 0.5) crate(B, x - Math.sin(r) * 0.8, y, z + Math.cos(r) * 0.8, r + 0.3);
    } else {
      crate(B, x, y, z, r);
      crate(B, x + 0.6, y, z + 0.1, r + 0.2, 0.5);
      crate(B, x + 0.25, y + 0.55, z + 0.05, r - 0.25, 0.48);
    }
    colliders.push({ x, z, r: 0.9 });
  }

  // ---- benches
  for (const [x, z, r] of [[-4.5, 3.8, 0.3], [3.8, 4.6, -0.5], [-7, -66, 0], [-22, -64, 0.2]]) {
    const y = data.heightAt(x, z);
    B.frame(x, y, z, r);
    B.tint = [0.55, 0.42, 0.3];
    B.box('planks', [-0.9, 0.42, -0.18], [0.9, 0.48, 0.18], 0.9);
    B.tint = TIMBER_DARK;
    for (const sx of [-0.75, 0.75]) B.box('timber', [sx - 0.06, 0, -0.16], [sx + 0.06, 0.42, 0.16], 1, { aoBottom: 0.6 });
    B.pop();
  }

  // ---- lanterns on posts around the square + by the chapel gate
  for (const [x, z] of [[-11, -9], [12, 10], [-13, 9], [13, -11], [-14, -58], [-6, -58]]) {
    const y = data.heightAt(x, z);
    B.tint = TIMBER_DARK;
    B.box('timber', [x - 0.08, y, z - 0.08], [x + 0.08, y + 2.6, z + 0.08], 1, { aoBottom: 0.6 });
    B.box('timber', [x - 0.08, y + 2.5, z - 0.08], [x + 0.45, y + 2.58, z + 0.08], 1);
    B.tint = [0.08, 0.08, 0.08];
    B.box('color', [x + 0.28, y + 2.0, z - 0.13], [x + 0.56, y + 2.08, z + 0.13], 1);
    B.box('color', [x + 0.26, y + 2.42, z - 0.15], [x + 0.58, y + 2.5, z + 0.15], 1);
    lamps.push([x + 0.42, y + 2.25, z]);
    colliders.push({ x, z, r: 0.3 });
  }

  // ---- cart by the mill and one in the village
  for (const [x, z, r] of [[-128, 30, 0.9], [-30, 26, -0.6]]) {
    const y = data.heightAt(x, z);
    B.frame(x, y, z, r);
    B.tint = [0.55, 0.42, 0.3];
    B.box('planks', [-1.2, 0.75, -0.7], [1.2, 0.85, 0.7], 0.9, { aoBottom: 0.8 });
    for (const sz of [-1, 1]) B.box('planks', [-1.2, 0.85, sz * 0.7 - 0.04], [1.2, 1.25, sz * 0.7 + 0.04], 0.9, { aoBottom: 0.8 });
    B.box('planks', [-1.24, 0.85, -0.7], [-1.16, 1.25, 0.7], 0.9);
    B.tint = TIMBER_DARK;
    for (const sz of [-1, 1]) {
      B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.52, sz * 0.82));
      B.cylinder('timber', [0, -0.05, 0], 0.52, 0.52, 0.1, 14, 1, { cap: true, aoBottom: 1 });
      B.pop();
    }
    B.beam('timber', [1.2, 0.8, -0.35], [3.1, 0.25, -0.38], 0.09);
    B.beam('timber', [1.2, 0.8, 0.35], [3.1, 0.25, 0.38], 0.09);
    // load: sacks / hay
    B.tint = [0.85, 0.75, 0.55];
    for (let k = 0; k < 4; k++) B.obox('color', [-0.7 + k * 0.45, 1.05, (rand() - 0.5) * 0.4], [0.2, 0.18, 0.28], rand(), 1);
    B.pop();
    colliders.push({ x, z, hx: 1.4, hz: 1.0, rot: r });
  }

  // ---- hay bales near the fields
  for (const f of FIELDS) {
    if (f.crop !== 'wheat') continue;
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const x = f.x + Math.cos(f.a) * (f.hx + 3 + rand() * 4) * (i % 2 ? 1 : -1);
      const z = f.z + (rand() - 0.5) * f.hz * 1.4;
      const y = data.heightAt(x, z);
      B.tint = [0.95, 0.85, 0.6];
      B.push(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).setPosition(x, y + 0.62, z));
      B.cylinder('thatch', [0, -0.6, 0], 0.65, 0.65, 1.2, 16, 1.2, { cap: true, aoBottom: 1 });
      B.pop();
      colliders.push({ x, z, r: 0.8 });
    }
    // fence around the field
    const c = Math.cos(f.a), s = Math.sin(f.a);
    const corner = (lx, lz) => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
    const hx = f.hx + 1.2, hz = f.hz + 1.2;
    fenceRun(B, data, [corner(-hx, -hz), corner(hx, -hz), corner(hx, hz), corner(hx * 0.2, hz)], rand);
    fenceRun(B, data, [corner(-hx * 0.2, hz), corner(-hx, hz), corner(-hx, -hz)], rand);
  }

  // ---- garden fences behind a few houses
  for (const h of HOUSES) {
    if (rand() < 0.55) continue;
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const toW = (lx, lz) => [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
    const gx = h.w / 2 + 0.6, gz0 = -h.d / 2 - 0.6, gz1 = -h.d / 2 - 6.5;
    fenceRun(B, data, [toW(-gx, gz0), toW(-gx, gz1), toW(gx, gz1), toW(gx, gz0)], rand, { h: 0.9, tint: [0.5, 0.42, 0.34] });
    // laundry line in some gardens
    if (rand() < 0.6) {
      const a = toW(-gx + 0.6, gz1 + 1.5), b = toW(gx - 0.6, gz1 + 1.5);
      const ya = data.heightAt(a[0], a[1]), yb = data.heightAt(b[0], b[1]);
      B.tint = TIMBER_DARK;
      B.box('timber', [a[0] - 0.06, ya, a[1] - 0.06], [a[0] + 0.06, ya + 2.0, a[1] + 0.06], 1, { aoBottom: 0.6 });
      B.box('timber', [b[0] - 0.06, yb, b[1] - 0.06], [b[0] + 0.06, yb + 2.0, b[1] + 0.06], 1, { aoBottom: 0.6 });
      B.tint = [0.75, 0.72, 0.65];
      B.beam('color', [a[0], ya + 1.92, a[1]], [b[0], yb + 1.92, b[1]], 0.015);
      const cloths = [[0.95, 0.94, 0.9], [0.55, 0.65, 0.85], [0.9, 0.85, 0.72], [0.75, 0.35, 0.3], [0.95, 0.94, 0.9]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      let t = 0.4;
      while (t < len - 0.6) {
        const w = 0.45 + rand() * 0.45, hh = 0.5 + rand() * 0.45;
        const x0 = a[0] + dx * t, z0 = a[1] + dz * t, x1 = a[0] + dx * (t + w), z1 = a[1] + dz * (t + w);
        const yt = ya + (yb - ya) * (t / len) + 1.9 - Math.sin(Math.PI * t / len) * 0.12;
        Bcloth.tint = cloths[Math.floor(rand() * cloths.length)];
        Bcloth.quad('cloth', [x0, yt - hh, z0], [x1, yt - hh, z1], [x1, yt, z1], [x0, yt, z0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        t += w + 0.15 + rand() * 0.3;
      }
    }
  }

  // ---- signpost at the crossroads east of the village
  {
    const x = 70, z = -4;
    const y = data.heightAt(x, z);
    B.tint = TIMBER;
    B.box('timber', [x - 0.07, y, z - 0.07], [x + 0.07, y + 2.4, z + 0.07], 1, { aoBottom: 0.6 });
    for (const [a, yy] of [[0.2, 2.1], [2.4, 1.85], [-1.4, 1.6]]) {
      B.tint = [0.62, 0.5, 0.36];
      B.obox('planks', [x + Math.cos(a) * 0.45, y + yy, z - Math.sin(a) * 0.45], [0.5, 0.09, 0.03], a, 0.8);
    }
  }

  // ---- stepping stones & benches by the chapel gate already; a trough near the mill
  {
    const { x, z } = LANDMARKS.mill;
    const tx = x + 6, tz = z + 7;
    const y = data.heightAt(tx, tz);
    B.tint = [0.85, 0.83, 0.8];
    B.obox('stone', [tx, y + 0.3, tz], [1.0, 0.32, 0.4], 0.6, 1.2, { aoBottom: 0.6 });
    B.tint = [0.04, 0.06, 0.06];
    B.obox('color', [tx, y + 0.6, tz], [0.85, 0.02, 0.28], 0.6, 1);
  }

  return { colliders, lamps };
}
