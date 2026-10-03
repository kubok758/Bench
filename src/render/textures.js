import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || './';
export const texUrl = (name) => `${BASE}tex/${name}`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

const _canvas = { c: null, g: null };
function imagePixels(img, size) {
  if (!_canvas.c || _canvas.c.width !== size) {
    _canvas.c = document.createElement('canvas');
    _canvas.c.width = _canvas.c.height = size;
    _canvas.g = _canvas.c.getContext('2d', { willReadFrequently: true });
  }
  const g = _canvas.g;
  g.clearRect(0, 0, size, size);
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

/** Loads N images into one RGBA DataArrayTexture (mipmapped, repeat). */
export async function loadArrayTexture(names, size, { srgb = true, anisotropy = 8, onEach } = {}) {
  const imgs = await Promise.all(names.map((n) => loadImage(texUrl(n)).then((im) => { onEach?.(); return im; })));
  const layer = size * size * 4;
  const data = new Uint8Array(layer * imgs.length);
  const means = [];
  imgs.forEach((img, i) => {
    const px = imagePixels(img, size);
    data.set(px, i * layer);
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < layer; k += 64) { r += px[k]; g += px[k + 1]; b += px[k + 2]; }
    const n = layer / 64;
    means.push([r / n / 255, g / n / 255, b / n / 255]);
  });
  const tex = new THREE.DataArrayTexture(data, size, size, imgs.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.means = means; // sRGB means
  return tex;
}

const texLoader = new THREE.TextureLoader();
export function loadTexture(name, { srgb = true, anisotropy = 8, repeat = true } = {}) {
  return new Promise((resolve, reject) => {
    texLoader.load(
      texUrl(name),
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}
export { loadImage };

/** Approximate mean colour (linear) of an image texture, used for flat stylised looks. */
export function meanColorOf(img) {
  const px = imagePixels(img, 64);
  let r = 0, g = 0, b = 0, n = 0;
  for (let k = 0; k < px.length; k += 4) {
    if (px[k + 3] < 128) continue;
    r += px[k]; g += px[k + 1]; b += px[k + 2]; n++;
  }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

// ---------------------------------------------------------------------------
// Tileable gradient noise, 4 octaves packed into RGBA.
function periodicNoise(size, period, seed) {
  const rand = mulberry32(seed);
  const g = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) {
    const a = rand() * Math.PI * 2;
    g[i * 2] = Math.cos(a);
    g[i * 2 + 1] = Math.sin(a);
  }
  const out = new Float32Array(size * size);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, fy = (y / size) * period;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const dot = (cx, cy, dx, dy) => {
        const k = ((cy % period) * period + (cx % period)) * 2;
        return g[k] * dx + g[k + 1] * dy;
      };
      const n00 = dot(ix, iy, tx, ty), n10 = dot(ix + 1, iy, tx - 1, ty);
      const n01 = dot(ix, iy + 1, tx, ty - 1), n11 = dot(ix + 1, iy + 1, tx - 1, ty - 1);
      const u = fade(tx), v = fade(ty);
      out[y * size + x] = (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
    }
  }
  return out;
}

export function createNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const periods = [4, 8, 16, 32];
  periods.forEach((p, c) => {
    const n = periodicNoise(size, p, 1000 + p * 7);
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((n[i] * 0.85 + 0.5) * 255)));
  });
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable inverted Worley (cellular) noise, 4 octaves packed into RGBA. */
export function createCellTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const periods = [3, 6, 12, 24];
  periods.forEach((P, c) => {
    const rand = mulberry32(3000 + P);
    const pts = new Float32Array(P * P * 2);
    for (let i = 0; i < P * P; i++) { pts[i * 2] = rand(); pts[i * 2 + 1] = rand(); }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * P, fy = (y / size) * P;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let best = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const k = ((((cy % P) + P) % P) * P + (((cx % P) + P) % P)) * 2;
        const dx = cx + pts[k] - fx, dy = cy + pts[k + 1] - fy;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      const v = 1 - Math.min(1, Math.sqrt(best) * 1.15);
      data[(y * size + x) * 4 + c] = Math.round(v * 255);
    }
  });
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable water normal map built from summed directional waves + noise. */
export function createWaterNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  const n1 = periodicNoise(size, 8, 77);
  const n2 = periodicNoise(size, 16, 78);
  const n3 = periodicNoise(size, 32, 79);
  const rand = mulberry32(9);
  const waves = [];
  for (let i = 0; i < 9; i++) {
    const kx = Math.round((rand() - 0.5) * 14), ky = Math.round((rand() - 0.5) * 14) || 1;
    waves.push([kx, ky, rand() * Math.PI * 2, 1 / (1 + Math.hypot(kx, ky) * 0.25)]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, ph, a] of waves) v += Math.sin(((x * kx + y * ky) / size) * Math.PI * 2 + ph) * a;
    const i = y * size + x;
    h[i] = v * 0.12 + n1[i] * 0.55 + n2[i] * 0.3 + n3[i] * 0.15;
  }
  const data = new Uint8Array(size * size * 4);
  const s = 2.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
    let nx = (l - r) * s, ny = (d - u) * s, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    data[i] = Math.round((nx * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    data[i + 3] = Math.round(Math.min(1, Math.max(0, h[y * size + x] * 0.5 + 0.5)) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
