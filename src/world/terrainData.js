// CPU-side terrain: height field, water SDF, layout masks and placement queries.
import { createNoise2D, fbm, ridged, smoothstep, lerp, clamp, sampleSpline, PolylineField, mulberry32 } from '../core/math.js';
import { WORLD, VILLAGE, RIVER, POND, PATHS, CLEARINGS, FIELDS, HOUSES, LANDMARKS, BRIDGES } from './layout.js';

const WL = WORLD.waterLevel;
const n1 = createNoise2D(11);
const n2 = createNoise2D(23);
const n3 = createNoise2D(37);
const n4 = createNoise2D(41);
const n5 = createNoise2D(59);
const n6 = createNoise2D(71);
const n7 = createNoise2D(83);
const n8 = createNoise2D(97);

const gauss = (x, z, cx, cz, r) => {
  const dx = (x - cx) / r, dz = (z - cz) / r;
  return Math.exp(-(dx * dx + dz * dz));
};

// ---------------------------------------------------------------------------
// River centre line with per-sample half width.
function buildRiver() {
  const pts = sampleSpline(RIVER.map((p) => [p[0], p[1]]), 3);
  // map each control point to nearest dense sample to interpolate widths along arc length
  const field = new PolylineField(pts, { cell: 24 });
  const ctrlS = RIVER.map((p) => field.nearest(p[0], p[1], 60).s);
  const widthAt = (s) => {
    for (let i = 0; i < ctrlS.length - 1; i++) {
      if (s <= ctrlS[i + 1]) {
        const t = clamp((s - ctrlS[i]) / Math.max(1e-3, ctrlS[i + 1] - ctrlS[i]), 0, 1);
        const tt = t * t * (3 - 2 * t);
        return lerp(RIVER[i][2], RIVER[i + 1][2], tt);
      }
    }
    return RIVER[RIVER.length - 1][2];
  };
  return { pts, field, widthAt };
}

const river = buildRiver();

// Coarse distance grid for far queries (8 m cells, ±960 m).
const CG = { res: 8, half: 960 };
CG.n = (CG.half * 2) / CG.res + 1;
const coarseRiver = new Float32Array(CG.n * CG.n);
const coarseRiverHW = new Float32Array(CG.n * CG.n);
(function buildCoarse() {
  const pts = river.pts;
  for (let j = 0; j < CG.n; j++) {
    const z = -CG.half + j * CG.res;
    for (let i = 0; i < CG.n; i++) {
      const x = -CG.half + i * CG.res;
      let best = Infinity, bk = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const dx = pts[k][0] - x, dz = pts[k][1] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bk = k; }
      }
      coarseRiver[j * CG.n + i] = Math.sqrt(best);
      coarseRiverHW[j * CG.n + i] = river.widthAt(river.field.len[bk]);
    }
  }
})();

function coarseSample(arr, x, z) {
  const fx = clamp((x + CG.half) / CG.res, 0, CG.n - 1.001);
  const fz = clamp((z + CG.half) / CG.res, 0, CG.n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const a = arr[j * CG.n + i], b = arr[j * CG.n + i + 1];
  const c = arr[(j + 1) * CG.n + i], d = arr[(j + 1) * CG.n + i + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

const _near = {};
/** Distance to river centre line and local half width. */
export function riverInfo(x, z, out = {}) {
  const outside = Math.abs(x) > CG.half - 8 || Math.abs(z) > CG.half - 8;
  const cd = outside ? 2000 : coarseSample(coarseRiver, x, z);
  if (cd < 46) {
    river.field.nearest(x, z, 56, _near);
    if (_near.i >= 0) {
      out.d = _near.d;
      out.hw = river.widthAt(_near.s);
      out.s = _near.s;
      out.x = _near.x;
      out.z = _near.z;
      return out;
    }
  }
  out.d = cd;
  out.hw = outside ? 6 : coarseSample(coarseRiverHW, x, z);
  out.s = -1;
  return out;
}

export function pondSdf(x, z) {
  const c = Math.cos(POND.rot), s = Math.sin(POND.rot);
  const dx = x - POND.x, dz = z - POND.z;
  const lx = (dx * c + dz * s) / POND.rx, lz = (-dx * s + dz * c) / POND.rz;
  const r = Math.sqrt(lx * lx + lz * lz);
  const wobble = 0.08 * n8(x / 22, z / 22) + 0.05 * n7(x / 9, z / 9);
  return (r - 1 + wobble) * Math.min(POND.rx, POND.rz);
}

const _ri = {};
/** Signed distance to open water (negative inside), plus local half width. */
export function waterSdf(x, z) {
  riverInfo(x, z, _ri);
  const edgeNoise = 0.9 * n7(x / 14, z / 14);
  const r = _ri.d - _ri.hw + edgeNoise;
  return Math.min(r, pondSdf(x, z));
}

// ---------------------------------------------------------------------------
// Mountain ranges around the valley (x east, z south).
const RANGES = [
  { pts: [[-3000, -1300], [-2100, -1750], [-1150, -2050], [-250, -2250], [700, -2150], [1600, -1900], [2600, -1500]], h: 470, w: 820, seed: 1.7 },
  { pts: [[-2500, 1900], [-2300, 900], [-2550, -100], [-2250, -1000]], h: 330, w: 640, seed: 4.1 },
  { pts: [[2100, -900], [2450, 100], [2250, 1100], [2550, 2000]], h: 360, w: 680, seed: 7.3 },
  { pts: [[-1800, 2700], [-500, 3000], [800, 2850], [2000, 2500]], h: 210, w: 760, seed: 9.9 },
  { pts: [[-1400, -1150], [-900, -1350]], h: 240, w: 380, seed: 12.2 },
  { pts: [[900, -1250], [1400, -1050]], h: 220, w: 360, seed: 14.5 },
];
function distToPolyline(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b[0] - a[0], abz = b[1] - a[1];
    let t = ((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - a[0] - abx * t, dz = z - a[1] - abz * t;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// Analytic height (before road shaping).
export function rawHeight(x, z) {
  riverInfo(x, z, _ri);
  const wsd = Math.min(_ri.d - _ri.hw + 0.9 * n7(x / 14, z / 14), pondSdf(x, z));
  const away = Math.max(wsd, 0);

  let h = 4.1 + 7.0 * smoothstep(0, 170, away) + 0.03 * Math.max(away - 70, 0);
  const hillAmt = smoothstep(8, 120, away);
  h += hillAmt * (11 * fbm(n1, x / 320 + 4.1, z / 320 - 2.3, 4) + 4.5 * fbm(n2, (x + 77) / 115, (z - 31) / 115, 4));
  h += 0.55 * fbm(n3, x / 30, z / 30, 3);

  // authored landforms
  h += 11 * gauss(x, z, LANDMARKS.mill.x, LANDMARKS.mill.z, 66);
  h += 16 * gauss(x, z, LANDMARKS.stones.x, LANDMARKS.stones.z, 82);
  h += 7 * gauss(x, z, 300, -150, 120);
  h += 9 * gauss(x, z, 330, 120, 140);
  h -= 3 * gauss(x, z, 266, -62, 50); // meadow bowl

  // mountains: hand-placed ranges (ridge polylines) with bell cross-sections,
  // modulated along the ridge for peaks and saddles, plus gully detail on the flanks
  const dcen = Math.hypot(x * 0.85, z + 60);
  if (dcen > 380) {
    const outer = smoothstep(380, 1100, dcen);
    let hm = 0;
    for (const R of RANGES) {
      const d = distToPolyline(R.pts, x, z);
      if (d > R.w * 2.6) continue;
      const t = d / R.w;
      const prof = Math.exp(-t * t * 1.6);
      const along = fbm(n2, x / R.w * 0.9 + R.seed, z / R.w * 0.9 - R.seed, 3);
      const peaks = 0.62 + 0.55 * along + 0.25 * ridged(n4, x / 900 + R.seed, z / 900, 3);
      const gully = ridged(n5, x / 420 + R.seed * 3, z / 420, 4);
      const hr = R.h * prof * peaks + 70 * gully * prof * smoothstep(0.1, 0.8, t + 0.3);
      hm = Math.max(hm, hr) + Math.min(hm, hr) * 0.25;
    }
    // rolling foothills between the valley and the ranges
    const foot = 55 * outer * (0.5 + 0.5 * fbm(n5, x / 620, z / 620, 4)) + 30 * outer * ridged(n1, x / 380, z / 380, 3);
    h += outer * hm + foot;
  }

  // village plateau
  const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  if (dv < 125) {
    const pv = 1 - smoothstep(52, 122, dv);
    const ph = VILLAGE.plateau + 0.014 * x - 0.008 * z + 0.3 * fbm(n3, x / 45, z / 45, 2);
    h = lerp(h, ph, pv * pv * (3 - 2 * pv));
  }

  // water carving
  if (wsd < 16) {
    const bankW = 9 + 5 * n6(x / 60, z / 60);
    const bankH = Math.max(h, WL + 0.55);
    const t = smoothstep(-1.2, bankW, wsd);
    const depth = 0.45 + 1.7 * smoothstep(0, Math.max(_ri.hw * 0.75, 5), -wsd);
    const bed = WL - depth;
    h = lerp(bed, bankH, t);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Build everything
export function buildTerrainData() {
  const { heightRes: N, half, size } = WORLD;
  const step = size / (N - 1);
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -half + j * step;
    for (let i = 0; i < N; i++) {
      heights[j * N + i] = rawHeight(-half + i * step, z);
    }
  }

  // --- road shaping: level the cross-section, smooth along the path
  const pathFields = [];
  for (const p of PATHS) {
    const pts = sampleSpline(p.pts, 2);
    const field = new PolylineField(pts, { cell: 16 });
    const hs = pts.map(([x, z]) => sampleGrid(heights, N, step, half, x, z));
    const wet = pts.map(([x, z]) => waterSdf(x, z) < 2.5);
    // smooth heights along the path (moving window)
    const sm = hs.slice();
    const win = p.kind === 'trail' ? 3 : 5;
    for (let k = 0; k < hs.length; k++) {
      let s = 0, c = 0;
      for (let o = -win; o <= win; o++) {
        const q = k + o;
        if (q >= 0 && q < hs.length && !wet[q]) { s += hs[q]; c++; }
      }
      sm[k] = c ? s / c : hs[k];
    }
    pathFields.push({ ...p, pts, field, hs: sm, wet });
  }
  const nearTmp = {};
  for (let j = 0; j < N; j++) {
    const z = -half + j * step;
    for (let i = 0; i < N; i++) {
      const x = -half + i * step;
      let h = heights[j * N + i];
      for (const pf of pathFields) {
        const r = pf.width * 0.5 + 4;
        pf.field.nearest(x, z, r + 2, nearTmp);
        if (nearTmp.d > r) continue;
        const k = nearTmp.i;
        if (pf.wet[k] || pf.wet[Math.min(k + 1, pf.wet.length - 1)]) continue;
        const ph = lerp(pf.hs[k], pf.hs[Math.min(k + 1, pf.hs.length - 1)], nearTmp.t) - 0.05;
        const w = 1 - smoothstep(pf.width * 0.5, r, nearTmp.d);
        h = lerp(h, ph, w * 0.92);
      }
      heights[j * N + i] = h;
    }
  }

  // --- house pads: flatten under each footprint
  for (const hsx of HOUSES) {
    const base = sampleGrid(heights, N, step, half, hsx.x, hsx.z);
    hsx.y = base;
    const R = Math.max(hsx.w, hsx.d) * 0.75 + 3;
    const c = Math.cos(hsx.rot), s = Math.sin(hsx.rot);
    const i0 = Math.floor((hsx.x - R + half) / step), i1 = Math.ceil((hsx.x + R + half) / step);
    const j0 = Math.floor((hsx.z - R + half) / step), j1 = Math.ceil((hsx.z + R + half) / step);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -half + i * step - hsx.x, z = -half + j * step - hsx.z;
      const lx = Math.abs(x * c - z * s) - hsx.w * 0.5, lz = Math.abs(x * s + z * c) - hsx.d * 0.5;
      const d = Math.max(lx, lz);
      const w = 1 - smoothstep(0.5, 3.5, d);
      const idx = j * N + i;
      heights[idx] = lerp(heights[idx], base, w);
    }
  }

  // --- normals
  const normals = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const hl = heights[j * N + Math.max(i - 1, 0)], hr = heights[j * N + Math.min(i + 1, N - 1)];
    const hd = heights[Math.max(j - 1, 0) * N + i], hu = heights[Math.min(j + 1, N - 1) * N + i];
    const nx = hl - hr, nz = hd - hu, ny = 2 * step;
    const l = Math.hypot(nx, ny, nz);
    const o = (j * N + i) * 3;
    normals[o] = nx / l; normals[o + 1] = ny / l; normals[o + 2] = nz / l;
  }

  const data = {
    N, step, half, heights, normals, pathFields, river,
    heightAt(x, z) {
      if (Math.abs(x) < half && Math.abs(z) < half) return sampleGrid(heights, N, step, half, x, z);
      return rawHeight(x, z);
    },
    normalAt(x, z, out = [0, 1, 0]) {
      const fx = clamp((x + half) / step, 0, N - 1.001), fz = clamp((z + half) / step, 0, N - 1.001);
      const i = Math.round(fx), j = Math.round(fz);
      const o = (j * N + i) * 3;
      out[0] = normals[o]; out[1] = normals[o + 1]; out[2] = normals[o + 2];
      return out;
    },
    slopeAt(x, z) {
      const e = 1.5;
      const dx = data.heightAt(x + e, z) - data.heightAt(x - e, z);
      const dz = data.heightAt(x, z + e) - data.heightAt(x, z - e);
      return Math.hypot(dx, dz) / (2 * e);
    },
    waterSdf,
    riverInfo,
    pathDistance(x, z, maxR = 12) {
      let best = Infinity, kind = null, width = 0;
      for (const pf of pathFields) {
        pf.field.nearest(x, z, maxR, nearTmp);
        const d = nearTmp.d - pf.width * 0.5;
        if (d < best) { best = d; kind = pf.kind; width = pf.width; }
      }
      return { d: best, kind, width };
    },
  };

  buildMasks(data);
  return data;
}

export function sampleGrid(arr, N, step, half, x, z) {
  const fx = clamp((x + half) / step, 0, N - 1.0001), fz = clamp((z + half) / step, 0, N - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const a = arr[j * N + i], b = arr[j * N + i + 1];
  const c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ---------------------------------------------------------------------------
// Masks (1 m texels): A = {dirt path, cobble, forest floor, flowers}; B = {tilled, wheat, no-grass, worn}
function buildMasks(data) {
  const R = WORLD.maskRes;
  const half = WORLD.half;
  const toPx = (v) => (v + half) * (R / WORLD.size);

  const mk = () => {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(R, R) : Object.assign(document.createElement('canvas'), { width: R, height: R });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.lineCap = 'round';
    g.lineJoin = 'round';
    return { c, g };
  };

  // dirt paths
  const dirt = mk();
  dirt.g.filter = 'blur(1.2px)';
  for (const p of data.pathFields) {
    dirt.g.strokeStyle = '#fff';
    dirt.g.lineWidth = p.width * (p.kind === 'trail' ? 1.15 : 1.25);
    dirt.g.beginPath();
    p.pts.forEach(([x, z], k) => (k ? dirt.g.lineTo(toPx(x), toPx(z)) : dirt.g.moveTo(toPx(x), toPx(z))));
    dirt.g.stroke();
  }
  // wider soft verge
  const verge = mk();
  verge.g.filter = 'blur(3px)';
  for (const p of data.pathFields) {
    verge.g.strokeStyle = '#fff';
    verge.g.lineWidth = p.width * 2.4 + 2;
    verge.g.beginPath();
    p.pts.forEach(([x, z], k) => (k ? verge.g.lineTo(toPx(x), toPx(z)) : verge.g.moveTo(toPx(x), toPx(z))));
    verge.g.stroke();
  }

  // cobbles: square + streets inside the village
  const cob = mk();
  cob.g.filter = 'blur(0.8px)';
  cob.g.fillStyle = '#fff';
  cob.g.beginPath();
  cob.g.ellipse(toPx(0), toPx(0), 13.5, 12.5, 0.3, 0, Math.PI * 2);
  cob.g.fill();
  for (const p of data.pathFields) {
    if (p.kind === 'trail') continue;
    cob.g.strokeStyle = '#fff';
    cob.g.lineWidth = p.width * 0.95;
    cob.g.beginPath();
    let started = false;
    for (const [x, z] of p.pts) {
      const inside = Math.hypot(x, z) < 42;
      if (inside) {
        if (!started) { cob.g.moveTo(toPx(x), toPx(z)); started = true; } else cob.g.lineTo(toPx(x), toPx(z));
      } else if (started) break;
    }
    cob.g.stroke();
  }

  // no-grass: house footprints + bridges
  const nog = mk();
  nog.g.filter = 'blur(1px)';
  nog.g.fillStyle = '#fff';
  for (const h of HOUSES) {
    nog.g.save();
    nog.g.translate(toPx(h.x), toPx(h.z));
    nog.g.rotate(-h.rot);
    nog.g.fillRect(-h.w * 0.5 - 0.8, -h.d * 0.5 - 0.8, h.w + 1.6, h.d + 1.6);
    nog.g.restore();
  }
  nog.g.beginPath();
  nog.g.ellipse(toPx(LANDMARKS.chapel.x), toPx(LANDMARKS.chapel.z), 9, 12, 0, 0, Math.PI * 2);
  nog.g.fill();
  nog.g.beginPath();
  nog.g.arc(toPx(LANDMARKS.mill.x), toPx(LANDMARKS.mill.z), 5.5, 0, Math.PI * 2);
  nog.g.fill();

  // fields
  const fld = mk();
  fld.g.filter = 'blur(1.5px)';
  for (const f of FIELDS) {
    fld.g.save();
    fld.g.translate(toPx(f.x), toPx(f.z));
    fld.g.rotate(-f.a);
    fld.g.fillStyle = f.crop === 'wheat' ? '#ffff00' : '#ff0000';
    fld.g.fillRect(-f.hx, -f.hz, f.hx * 2, f.hz * 2);
    fld.g.restore();
  }

  const read = (m) => m.g.getImageData(0, 0, R, R).data;
  const dirtPx = read(dirt), vergePx = read(verge), cobPx = read(cob), nogPx = read(nog), fldPx = read(fld);

  const maskA = new Uint8Array(R * R * 4);
  const maskB = new Uint8Array(R * R * 4);

  // Expensive fields at half resolution (2 m), then bilinear upsampling.
  const H = R >> 1;
  const hstep = WORLD.size / H;
  const forestH = new Float32Array(H * H);
  const flowersH = new Float32Array(H * H);
  const dirtAt = (x, z) => dirtPx[(clamp(Math.floor(toPx(z)), 0, R - 1) * R + clamp(Math.floor(toPx(x)), 0, R - 1)) * 4] / 255;
  const vergeAt = (x, z) => vergePx[(clamp(Math.floor(toPx(z)), 0, R - 1) * R + clamp(Math.floor(toPx(x)), 0, R - 1)) * 4] / 255;
  const tilledAt = (x, z) => fldPx[(clamp(Math.floor(toPx(z)), 0, R - 1) * R + clamp(Math.floor(toPx(x)), 0, R - 1)) * 4] / 255;
  for (let j = 0; j < H; j++) {
    const z = -half + (j + 0.5) * hstep;
    for (let i = 0; i < H; i++) {
      const x = -half + (i + 0.5) * hstep;
      const h = data.heightAt(x, z);
      const wsd = waterSdf(x, z);
      const vergeV = vergeAt(x, z);
      const tilled = tilledAt(x, z);
      let f = 0.38 + 0.7 * fbm(n6, x / 230, z / 230, 4) + 0.28 * fbm(n7, x / 64, z / 64, 3);
      f += 0.26 * smoothstep(105, 170, x);
      f += 0.24 * smoothstep(-90, -210, z);
      f += 0.3 * smoothstep(-120, -230, x) * smoothstep(-20, 120, z);
      f += 0.25 * smoothstep(-160, -320, x);
      f -= 0.35 * smoothstep(120, 40, Math.abs(x - 10)) * smoothstep(120, 330, z); // southern meadows
      const dv = Math.hypot(x, z);
      f *= smoothstep(92, 165, dv);
      f *= smoothstep(6, 42, wsd);
      f *= 1 - vergeV * 0.9;
      let flowers = 0;
      for (const c of CLEARINGS) {
        const dd = Math.hypot(x - c.x, z - c.z) / c.r;
        const d = dd + 0.18 * n8(x / 25, z / 25);
        f *= smoothstep(0.75, 1.15, d);
        flowers = Math.max(flowers, c.flowers * (1 - smoothstep(0.35, 1.0, dd)));
      }
      f *= 1 - smoothstep(0.05, 0.4, tilled);
      f *= smoothstep(330, 230, h); // tree line far up the mountains
      const dens = smoothstep(0.42, 0.72, f);
      forestH[j * H + i] = dens;

      const patch = smoothstep(0.05, 0.45, fbm(n5, x / 18, z / 18, 3) + 0.15);
      flowers = clamp(flowers * patch + 0.12 * patch * (1 - dens) * smoothstep(110, 180, dv), 0, 1);
      flowers *= (1 - dirtAt(x, z)) * (1 - tilled) * smoothstep(1, 6, wsd);
      flowersH[j * H + i] = flowers;
    }
  }
  const up = (src, x, z) => sampleGrid(src, H, hstep, half - hstep * 0.5, x, z);
  const forest = new Float32Array(R * R);
  const fBlur = boxBlur(forestH, H, 2);

  for (let j = 0; j < R; j++) {
    const z = -half + (j + 0.5) * (WORLD.size / R);
    for (let i = 0; i < R; i++) {
      const x = -half + (i + 0.5) * (WORLD.size / R);
      const o = (j * R + i) * 4;
      const p = j * R + i;
      const dirtV = dirtPx[o] / 255, vergeV = vergePx[o] / 255, cobV = cobPx[o] / 255;
      const nogV = nogPx[o] / 255;
      const wheat = (fldPx[o + 1] / 255) * (fldPx[o] > 200 ? 1 : 0);
      const tilled = Math.max(fldPx[o] / 255, wheat);
      const dens = up(forestH, x, z);
      forest[p] = dens;
      const flowers = up(flowersH, x, z);
      const dv = Math.hypot(x, z);
      const worn = clamp(vergeV * 0.7 + (1 - smoothstep(18, 60, dv)) * 0.5, 0, 1);

      maskA[o] = Math.round(clamp(dirtV * (1 - cobV), 0, 1) * 255);
      maskA[o + 1] = Math.round(cobV * 255);
      maskA[o + 2] = Math.round(clamp(up(fBlur, x, z) * 1.15, 0, 1) * 255);
      maskA[o + 3] = Math.round(flowers * 255);
      maskB[o] = Math.round(tilled * 255);
      maskB[o + 1] = Math.round(wheat * 255);
      maskB[o + 2] = Math.round(clamp(nogV + cobV + dirtV * 0.85, 0, 1) * 255);
      maskB[o + 3] = Math.round(worn * 255);
    }
  }

  data.maskRes = R;
  data.maskA = maskA;
  data.maskB = maskB;
  data.forest = forest;
  const mi = (x, z) => {
    const i = clamp(Math.floor((x + half) * (R / WORLD.size)), 0, R - 1);
    const j = clamp(Math.floor((z + half) * (R / WORLD.size)), 0, R - 1);
    return j * R + i;
  };
  data.forestAt = (x, z) => forest[mi(x, z)];
  data.maskAAt = (x, z, ch) => maskA[mi(x, z) * 4 + ch] / 255;
  data.maskBAt = (x, z, ch) => maskB[mi(x, z) * 4 + ch] / 255;
}

function boxBlur(src, R, r) {
  const tmp = new Float32Array(R * R);
  const out = new Float32Array(R * R);
  const w = 2 * r + 1;
  for (let j = 0; j < R; j++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[j * R + clamp(i, 0, R - 1)];
    for (let i = 0; i < R; i++) {
      tmp[j * R + i] = s / w;
      s += src[j * R + clamp(i + r + 1, 0, R - 1)] - src[j * R + clamp(i - r, 0, R - 1)];
    }
  }
  for (let i = 0; i < R; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[clamp(j, 0, R - 1) * R + i];
    for (let j = 0; j < R; j++) {
      out[j * R + i] = s / w;
      s += tmp[clamp(j + r + 1, 0, R - 1) * R + i] - tmp[clamp(j - r, 0, R - 1) * R + i];
    }
  }
  return out;
}

export { river, BRIDGES };
