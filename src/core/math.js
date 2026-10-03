// Deterministic math helpers shared by world generation (CPU side).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const fract = (x) => x - Math.floor(x);

// ---------------------------------------------------------------------------
// 2D simplex noise (Gustavson), seeded permutation.
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

export function createNoise2D(seed = 1) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod8 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod8[i] = (perm[i] & 7) * 2;
  }
  return function noise2D(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = permMod8[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = permMod8[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = permMod8[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
    }
    return 70 * n; // roughly [-1, 1]
  };
}

export function fbm(noise, x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f);
    f *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function ridged(noise, x, y, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * f, y * f));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Curves

/** Centripetal-ish Catmull-Rom sampled at a fixed spacing (metres). */
export function sampleSpline(points, spacing = 2, closed = false) {
  const pts = points.map((p) => [p[0], p[1]]);
  const n = pts.length;
  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
    if (i >= n) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
    return pts[i];
  };
  const dense = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(len / (spacing * 0.5)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      dense.push([x, y]);
    }
  }
  if (!closed) dense.push([pts[n - 1][0], pts[n - 1][1]]);
  // Resample to uniform arc length.
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let start = 0;
    while (carry + seg - start >= spacing) {
      const need = spacing - carry;
      const t = (start + need) / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      start += need;
      carry = 0;
    }
    carry += seg - start;
  }
  const last = dense[dense.length - 1];
  const tail = out[out.length - 1];
  if (!closed && Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.3) out.push(last);
  return out;
}

/**
 * Polyline with fast nearest-point queries through a uniform bucket grid.
 * Each sample may carry extra per-point data (e.g. width).
 */
export class PolylineField {
  constructor(points, { cell = 24, data = null } = {}) {
    this.pts = points;
    this.data = data;
    this.cell = cell;
    this.buckets = new Map();
    // cumulative length for arc-length parameter
    this.len = new Float32Array(points.length);
    for (let i = 1; i < points.length; i++) {
      this.len[i] = this.len[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const z0 = Math.floor(Math.min(a[1], b[1]) / cell), z1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663;
        let arr = this.buckets.get(k);
        if (!arr) this.buckets.set(k, (arr = []));
        arr.push(i);
      }
    }
  }

  /** Returns {d, i, t, x, z, s} for the nearest point within `maxR` (Infinity if none). */
  nearest(x, z, maxR = 120, out = {}) {
    const cell = this.cell;
    const r = Math.ceil(maxR / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = Infinity, bi = -1, bt = 0;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.buckets.get(ix * 73856093 ^ iz * 19349663);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const i = arr[k];
        const a = this.pts[i], b = this.pts[i + 1];
        const abx = b[0] - a[0], abz = b[1] - a[1];
        const l2 = abx * abx + abz * abz || 1e-6;
        let t = ((x - a[0]) * abx + (z - a[1]) * abz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a[0] + abx * t, pz = a[1] + abz * t;
        const d = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d < best) { best = d; bi = i; bt = t; }
      }
    }
    if (bi < 0) { out.d = Infinity; out.i = -1; return out; }
    const a = this.pts[bi], b = this.pts[bi + 1];
    out.d = Math.sqrt(best);
    out.i = bi;
    out.t = bt;
    out.x = a[0] + (b[0] - a[0]) * bt;
    out.z = a[1] + (b[1] - a[1]) * bt;
    out.s = this.len[bi] + (this.len[bi + 1] - this.len[bi]) * bt;
    // signed side (left/right of travel direction)
    const cross = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    out.side = cross >= 0 ? 1 : -1;
    return out;
  }

  get length() {
    return this.len[this.len.length - 1];
  }
}
