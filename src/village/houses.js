import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

const PLASTER = [[1.0, 0.95, 0.84], [1.0, 0.87, 0.66], [1.04, 1.02, 0.96], [1.0, 0.85, 0.78], [0.9, 0.93, 0.95], [0.98, 0.92, 0.74]];
const SHUTTER = [[0.42, 0.56, 0.42], [0.33, 0.43, 0.58], [0.58, 0.24, 0.19], [0.78, 0.62, 0.45], [0.36, 0.5, 0.52]];
const FLOWER = [[0.85, 0.12, 0.1], [0.95, 0.5, 0.65], [0.95, 0.9, 0.85], [0.95, 0.65, 0.1], [0.55, 0.3, 0.75]];
const TIMBER = [0.42, 0.31, 0.23];
const TIMBER_DARK = [0.3, 0.22, 0.17];

/** Window applied on a wall (local frame: wall plane z=0, outward +z). */
function windowAt(B, x, y, w, h, rand, opts = {}) {
  const t = 0.09;
  const out = 0.11;
  B.tint = [1, 1, 1];
  B.quad('glass', [x - w / 2, y, 0.02], [x + w / 2, y, 0.02], [x + w / 2, y + h, 0.02], [x - w / 2, y + h, 0.02], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.tint = opts.frame || TIMBER;
  B.box('timber', [x - w / 2 - t, y - t, 0], [x + w / 2 + t, y, out], 1.2);
  B.box('timber', [x - w / 2 - t, y + h, 0], [x + w / 2 + t, y + h + t, out], 1.2);
  B.box('timber', [x - w / 2 - t, y, 0], [x - w / 2, y + h, out], 1.2);
  B.box('timber', [x + w / 2, y, 0], [x + w / 2 + t, y + h, out], 1.2);
  // mullion + transom
  B.box('timber', [x - 0.025, y, 0], [x + 0.025, y + h, 0.06], 1.2);
  B.box('timber', [x - w / 2, y + h * 0.62 - 0.025, 0], [x + w / 2, y + h * 0.62 + 0.025, 0.06], 1.2);
  // sill
  B.tint = opts.sillTint || [0.9, 0.88, 0.84];
  B.box(opts.sillKey || 'slate', [x - w / 2 - 0.16, y - t - 0.07, 0], [x + w / 2 + 0.16, y - t, 0.2], 1.0);
  // shutters (opened flat against the wall)
  if (opts.shutters) {
    B.tint = opts.shutters;
    const sw = w * 0.5;
    B.box('planks', [x - w / 2 - t - sw - 0.02, y, 0.0], [x - w / 2 - t - 0.02, y + h, 0.05], 1.0);
    B.box('planks', [x + w / 2 + t + 0.02, y, 0.0], [x + w / 2 + t + sw + 0.02, y + h, 0.05], 1.0);
  }
  // flower box
  if (opts.flowers) {
    B.tint = [0.55, 0.4, 0.3];
    B.box('planks', [x - w / 2, y - t - 0.32, 0.02], [x + w / 2, y - t - 0.08, 0.28], 0.8);
    const n = Math.max(4, Math.round(w * 7));
    for (let i = 0; i < n; i++) {
      const fx = x - w / 2 + 0.06 + (i / (n - 1)) * (w - 0.12);
      const leaf = [0.16 + rand() * 0.06, 0.32 + rand() * 0.1, 0.08];
      B.tint = leaf;
      B.obox('color', [fx, y - t - 0.04, 0.15], [0.07, 0.06, 0.08], rand() * 3, 1);
      B.tint = FLOWER[Math.floor(rand() * FLOWER.length)];
      B.obox('color', [fx + (rand() - 0.5) * 0.05, y - t + 0.03 + rand() * 0.04, 0.12 + rand() * 0.08], [0.045, 0.04, 0.045], rand() * 3, 1);
    }
  }
}

function doorAt(B, x, w, h, rand, tint, stoneStep = true) {
  B.tint = tint;
  B.box('planks', [x - w / 2, 0.36, -0.02], [x + w / 2, 0.36 + h, 0.04], 0.9);
  // battens
  B.tint = [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8];
  B.box('planks', [x - w / 2 + 0.05, 0.36 + h * 0.2, 0.04], [x + w / 2 - 0.05, 0.36 + h * 0.2 + 0.1, 0.07], 0.9);
  B.box('planks', [x - w / 2 + 0.05, 0.36 + h * 0.75, 0.04], [x + w / 2 - 0.05, 0.36 + h * 0.75 + 0.1, 0.07], 0.9);
  // iron ring
  B.tint = [0.08, 0.08, 0.08];
  B.obox('color', [x + w * 0.3, 0.36 + h * 0.5, 0.09], [0.03, 0.05, 0.02], 0, 1);
  // frame + lintel
  B.tint = TIMBER_DARK;
  B.box('timber', [x - w / 2 - 0.12, 0.36, 0], [x - w / 2, 0.36 + h + 0.12, 0.12], 1.2);
  B.box('timber', [x + w / 2, 0.36, 0], [x + w / 2 + 0.12, 0.36 + h + 0.12, 0.12], 1.2);
  B.tint = [0.92, 0.9, 0.86];
  B.box('slate', [x - w / 2 - 0.3, 0.36 + h + 0.12, 0], [x + w / 2 + 0.3, 0.36 + h + 0.38, 0.16], 1.2);
  if (stoneStep) {
    B.tint = [0.85, 0.84, 0.8];
    B.box('slate', [x - w / 2 - 0.25, -0.3, 0], [x + w / 2 + 0.25, 0.36, 0.7], 1.2);
  }
}

/**
 * Builds one house into the builder (world placement via h.x, h.y, h.z, h.rot).
 * Returns { chimneys: [Vector3], collider: {x,z,hx,hz,rot} }
 */
export function buildHouse(B, h, seed) {
  const rand = mulberry32(seed);
  const W = h.w, D = h.d;
  const cottage = h.kind === 'cottage';
  const two = h.floors === 2;
  const thatch = h.roof === 'thatch';
  const gH = cottage ? 2.75 : 2.85;
  const uH = 2.45;
  const jet = two ? 0.28 : 0;
  const eaveY = gH + (two ? uH : 0) + (cottage ? 0.1 : 0);
  const pitch = THREE.MathUtils.degToRad(thatch ? 52 : 44);
  const halfSpan = D / 2 + jet;
  const ridgeY = eaveY + halfSpan * Math.tan(pitch);
  const plaster = PLASTER[Math.floor(rand() * PLASTER.length)];
  const shutter = SHUTTER[Math.floor(rand() * SHUTTER.length)];
  const stoneTint = [0.95 + rand() * 0.1, 0.93 + rand() * 0.1, 0.9 + rand() * 0.08];
  const chimneys = [];

  B.frame(h.x, h.y, h.z, h.rot);

  // plinth
  B.tint = [0.8, 0.8, 0.78];
  B.box('slate', [-W / 2 - 0.14, -1.8, -D / 2 - 0.14], [W / 2 + 0.14, 0.36, D / 2 + 0.14], 1.6, { aoBottom: 0.6, faces: 'px nx pz nz py' });
  // ground floor
  B.tint = stoneTint;
  B.box('stone', [-W / 2, 0.36, -D / 2], [W / 2, two ? gH : eaveY, D / 2], 2.4, { faces: 'px nx pz nz', aoBottom: 0.75 });
  // quoins (corner stones) on stone walls
  B.tint = [0.92, 0.9, 0.86];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let y = 0.4; y < gH - 0.3; y += 0.5) {
      const long = Math.round(y / 0.5) % 2 === 0;
      const cx = sx * (W / 2), cz = sz * (D / 2);
      const lx = long ? 0.42 : 0.24, lz = long ? 0.24 : 0.42;
      B.box('slate', [cx - (sx > 0 ? lx : 0.02), y, cz - (sz > 0 ? lz : 0.02)], [cx + (sx < 0 ? lx : 0.02), y + 0.24, cz + (sz < 0 ? lz : 0.02)], 0.9, { aoBottom: 1 });
    }
  }

  if (two) {
    // jettied upper storey: plaster with exposed timber frame
    B.tint = plaster;
    B.box('plaster', [-W / 2 - jet, gH, -D / 2 - jet], [W / 2 + jet, eaveY, D / 2 + jet], 2.6, { faces: 'px nx pz nz', aoBottom: 0.85 });
    B.tint = TIMBER;
    B.box('timber', [-W / 2 - jet - 0.02, gH - 0.22, -D / 2 - jet - 0.02], [W / 2 + jet + 0.02, gH + 0.02, D / 2 + jet + 0.02], 1.4, { aoBottom: 0.6 });
    // joist ends under the jetty
    for (let x = -W / 2 + 0.3; x <= W / 2 - 0.3; x += 0.55) {
      for (const sz of [-1, 1]) B.box('timber', [x - 0.07, gH - 0.36, sz > 0 ? D / 2 : -D / 2 - jet], [x + 0.07, gH - 0.2, sz > 0 ? D / 2 + jet : -D / 2], 1, { aoBottom: 0.7 });
    }
    // frame on each of the four faces
    const faces = [
      [0, D / 2 + jet, 0, W + 2 * jet], [0, -D / 2 - jet, Math.PI, W + 2 * jet],
      [W / 2 + jet, 0, Math.PI / 2, D + 2 * jet], [-W / 2 - jet, 0, -Math.PI / 2, D + 2 * jet],
    ];
    for (const [fx, fz, fr, len] of faces) {
      B.frame(fx, 0, fz, fr);
      B.tint = TIMBER;
      const y0 = gH + 0.02, y1 = eaveY;
      const n = Math.max(2, Math.round(len / 1.25));
      for (let k = 0; k <= n; k++) {
        const x = -len / 2 + (k / n) * len;
        const xx = Math.min(Math.max(x, -len / 2 + 0.09), len / 2 - 0.09);
        B.box('timber', [xx - 0.09, y0, -0.01], [xx + 0.09, y1, 0.05], 1.4, { aoBottom: 1 });
      }
      B.box('timber', [-len / 2, y0, -0.01], [len / 2, y0 + 0.16, 0.06], 1.4, { aoBottom: 1 });
      B.box('timber', [-len / 2, y1 - 0.16, -0.01], [len / 2, y1, 0.06], 1.4, { aoBottom: 1 });
      B.box('timber', [-len / 2, y0 + 0.85, -0.01], [len / 2, y0 + 0.97, 0.04], 1.4, { aoBottom: 1 });
      // braces in the end bays
      const bay = len / n;
      for (const side of [-1, 1]) {
        const xa = side * (len / 2 - 0.09), xb = side * (len / 2 - bay + 0.09);
        B.beam('timber', [xa, y0 + 0.97, 0.015], [xb, y1 - 0.16, 0.015], 0.14);
      }
      B.pop();
    }
  }

  // gable ends (x = ±(W/2 + jet)) + gable framing
  const gx = W / 2 + jet;
  for (const sx of [-1, 1]) {
    const x = sx * gx;
    B.tint = two ? plaster : stoneTint;
    const key = two ? 'plaster' : 'stone';
    const tile = two ? 2.6 : 2.4;
    const p0 = [x, eaveY, -sx * halfSpan], p1 = [x, eaveY, sx * halfSpan], p2 = [x, ridgeY, 0];
    B.tri(key, p0, p1, p2, [[(-sx * halfSpan) / tile * sx, eaveY / tile], [(sx * halfSpan) / tile * sx, eaveY / tile], [0, ridgeY / tile]]);
    if (two) {
      B.tint = TIMBER;
      B.frame(x, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (const k of [-0.5, 0, 0.5]) {
        const zz = k * halfSpan;
        const top = ridgeY - Math.abs(zz) * Math.tan(pitch);
        B.box('timber', [zz - 0.08, eaveY, -0.01], [zz + 0.08, top - 0.05, 0.05], 1.4, { aoBottom: 1 });
      }
      B.box('timber', [-halfSpan * 0.55, eaveY + (ridgeY - eaveY) * 0.42, -0.01], [halfSpan * 0.55, eaveY + (ridgeY - eaveY) * 0.42 + 0.14, 0.05], 1.4, { aoBottom: 1 });
      B.pop();
    }
  }

  // ---- roof
  const ohE = thatch ? 0.7 : 0.55; // eave overhang (along slope)
  const ohG = thatch ? 0.5 : 0.38; // gable overhang
  const th = thatch ? 0.42 : 0.14;
  const xr = gx + ohG;
  const slopeLen = halfSpan / Math.cos(pitch) + ohE;
  const tileR = thatch ? 2.2 : 1.6;
  const roofTint = thatch ? [0.78 + rand() * 0.12, 0.64 + rand() * 0.1, 0.48 + rand() * 0.08] : rand() < 0.5 ? [0.82, 0.84, 0.9] : [0.92, 0.8, 0.7];
  for (const sz of [-1, 1]) {
    const cos = Math.cos(pitch), sin = Math.sin(pitch);
    const eave = [sz * (halfSpan + ohE * cos), eaveY - ohE * sin];
    const ridge = [0, ridgeY + th * 0.3];
    const nz = sz * sin, ny = cos;
    const lift = (p, d) => [p[0] + nz * d, p[1] + ny * d];
    const eT = lift(eave, th), rT = lift(ridge, th);
    B.tint = roofTint;
    // top surface (uv: u along ridge, v down the slope)
    const P = (x, p) => [x, p[1], p[0]];
    if (sz > 0) B.quad(thatch ? 'thatch' : 'roof', P(-xr, eT), P(xr, eT), P(xr, rT), P(-xr, rT), [[-xr / tileR, 0], [xr / tileR, 0], [xr / tileR, slopeLen / tileR], [-xr / tileR, slopeLen / tileR]]);
    else B.quad(thatch ? 'thatch' : 'roof', P(xr, eT), P(-xr, eT), P(-xr, rT), P(xr, rT), [[xr / tileR, 0], [-xr / tileR, 0], [-xr / tileR, slopeLen / tileR], [xr / tileR, slopeLen / tileR]]);
    // underside
    B.tint = [0.35, 0.28, 0.22];
    if (sz > 0) B.quad('planks', P(-xr, ridge), P(xr, ridge), P(xr, eave), P(-xr, eave), [[0, 0], [xr, 0], [xr, 2], [0, 2]], [0.5, 0.5, 0.7, 0.7]);
    else B.quad('planks', P(xr, ridge), P(-xr, ridge), P(-xr, eave), P(xr, eave), [[0, 0], [xr, 0], [xr, 2], [0, 2]], [0.5, 0.5, 0.7, 0.7]);
    // eave edge
    B.tint = thatch ? roofTint.map((v) => v * 0.8) : TIMBER_DARK;
    if (sz > 0) B.quad(thatch ? 'thatch' : 'timber', P(-xr, eave), P(xr, eave), P(xr, eT), P(-xr, eT), [[0, 0], [xr, 0], [xr, 0.3], [0, 0.3]]);
    else B.quad(thatch ? 'thatch' : 'timber', P(xr, eave), P(-xr, eave), P(-xr, eT), P(xr, eT), [[0, 0], [xr, 0], [xr, 0.3], [0, 0.3]]);
    // verge (gable) edges
    for (const sx of [-1, 1]) {
      const x = sx * xr;
      const q = [P(x, eave), P(x, ridge), P(x, rT), P(x, eT)];
      if ((sx > 0) === (sz > 0)) B.quad(thatch ? 'thatch' : 'timber', q[0], q[1], q[2], q[3], [[0, 0], [slopeLen / 2, 0], [slopeLen / 2, 0.3], [0, 0.3]]);
      else B.quad(thatch ? 'thatch' : 'timber', q[1], q[0], q[3], q[2], [[0, 0], [slopeLen / 2, 0], [slopeLen / 2, 0.3], [0, 0.3]]);
    }
  }
  // ridge
  if (thatch) {
    B.tint = roofTint.map((v) => v * 0.85);
    B.push(new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(xr, ridgeY + th * 0.55, 0));
    B.cylinder('thatch', [0, 0, 0], 0.32, 0.32, xr * 2, 10, 1.6, { aoBottom: 1 });
    B.pop();
  } else {
    B.tint = TIMBER_DARK;
    B.push(new THREE.Matrix4().makeRotationZ(Math.PI / 4).setPosition(0, ridgeY + th * 0.4, 0));
    B.box('timber', [-0.13, -0.13, -xr], [0.13, 0.13, xr], 1.5, { aoBottom: 1 });
    B.pop();
  }

  // ---- chimney
  const cs = rand() < 0.5 ? 1 : -1;
  const cxp = cs * (W / 2 - 0.65), czp = -D * 0.12;
  const ctop = ridgeY + (thatch ? 1.2 : 0.95);
  B.tint = stoneTint;
  B.box('stone', [cxp - 0.42, eaveY - 0.6, czp - 0.42], [cxp + 0.42, ctop, czp + 0.42], 1.6, { aoBottom: 0.8 });
  B.tint = [0.85, 0.84, 0.82];
  B.box('slate', [cxp - 0.5, ctop, czp - 0.5], [cxp + 0.5, ctop + 0.12, czp + 0.5], 1.2);
  B.tint = [0.08, 0.07, 0.06];
  B.box('color', [cxp - 0.2, ctop + 0.12, czp - 0.2], [cxp + 0.2, ctop + 0.13, czp + 0.2], 1);
  chimneys.push(new THREE.Vector3(cxp, ctop + 0.25, czp));

  // ---- openings: front (+z) and back (-z) walls
  const doorX = (rand() - 0.5) * W * 0.3;
  const doorTint = SHUTTER[Math.floor(rand() * SHUTTER.length)].map((v) => v * 0.9);
  const walls = [
    { z: D / 2, r: 0, len: W, front: true },
    { z: -D / 2, r: Math.PI, len: W, front: false },
  ];
  for (const wl of walls) {
    B.frame(0, 0, wl.z, wl.r);
    if (wl.front) doorAt(B, doorX, 1.05, 1.95, rand, doorTint);
    const n = Math.max(1, Math.floor((wl.len - 1.2) / 2.1));
    for (let k = 0; k < n; k++) {
      const x = -wl.len / 2 + (k + 0.5) * (wl.len / n);
      if (wl.front && Math.abs(x - doorX) < 1.2) continue;
      windowAt(B, x, 1.05, 0.78, 1.0, rand, { shutters: rand() < 0.75 ? shutter : null, flowers: wl.front && rand() < 0.55 });
    }
    B.pop();
    if (two) {
      B.frame(0, 0, wl.z + (wl.front ? jet : -jet), wl.r);
      const m = Math.max(1, Math.floor((wl.len - 0.8) / 1.9));
      for (let k = 0; k < m; k++) {
        const x = -wl.len / 2 + (k + 0.5) * (wl.len / m);
        windowAt(B, x, gH + 1.05, 0.7, 0.9, rand, { shutters: rand() < 0.6 ? shutter : null, flowers: wl.front && rand() < 0.4, sillKey: 'timber', sillTint: TIMBER });
      }
      B.pop();
    }
  }
  // gable-side window
  for (const sx of [-1, 1]) {
    if (rand() < 0.4) continue;
    B.frame(sx * W / 2, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    windowAt(B, (rand() - 0.5) * D * 0.3, 1.1, 0.6, 0.85, rand, { shutters: rand() < 0.5 ? shutter : null });
    B.pop();
  }
  if (two) {
    for (const sx of [-1, 1]) {
      B.frame(sx * gx, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      windowAt(B, 0, eaveY + 0.35, 0.55, 0.75, rand, { sillKey: 'timber', sillTint: TIMBER });
      B.pop();
    }
  }

  // small lean-to woodpile on one gable side
  if (rand() < 0.6) {
    const sx = -cs;
    B.tint = [0.55, 0.42, 0.3];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) {
      B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(sx * (W / 2 + 0.35), 0.15 + i * 0.22, -D * 0.3 + j * 0.24));
      B.cylinder('timber', [0, -0.45, 0], 0.11, 0.11, 0.9, 6, 0.6, { aoBottom: 0.8 });
      B.pop();
    }
  }

  B.pop();
  return {
    chimneys: chimneys.map((c) => c.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), h.rot).add(new THREE.Vector3(h.x, h.y, h.z))),
    collider: { x: h.x, z: h.z, hx: W / 2 + jet + 0.15, hz: D / 2 + jet + 0.15, rot: h.rot },
    ridgeY: h.y + ridgeY,
  };
}
