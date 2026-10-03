import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';
import { loadImage, texUrl } from '../render/textures.js';

// Leaf bounding boxes inside the 512px ambientCG atlases (measured from alpha).
const LEAVES_009 = [[183, 19, 144, 223], [13, 21, 145, 211], [352, 28, 137, 215], [192, 275, 123, 202], [354, 279, 144, 204], [12, 288, 148, 187]];
const LEAVES_010 = [[290, 23, 172, 211], [34, 24, 206, 212], [306, 255, 156, 242], [38, 257, 189, 247]];

// Atlas regions (uv rects, origin top-left in canvas, converted for GL in getRegion)
export const REGION = {
  broad: 0, // dense broadleaf cluster
  broad2: 1, // looser maple-ish cluster
  birch: 2, // small light leaves on drooping twig
  needle: 3, // spruce/pine needle spray
};

const SIZE = 2048;
const CELL = 1024;

function tintCanvas(img, rect, tint, dark) {
  const [sx, sy, sw, sh] = rect;
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const g = c.getContext('2d');
  g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.globalAlpha = dark;
  g.fillRect(0, 0, sw, sh);
  return c;
}

function drawTwig(g, rand, x0, y0, x1, y1, w, col) {
  g.strokeStyle = col;
  g.lineCap = 'round';
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  const mx = (x0 + x1) / 2 + (rand() - 0.5) * 60, my = (y0 + y1) / 2 + (rand() - 0.5) * 60;
  g.quadraticCurveTo(mx, my, x1, y1);
  g.stroke();
  return [mx, my];
}

function quadPoint(x0, y0, mx, my, x1, y1, t) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return [a * x0 + b * mx + c * x1, a * y0 + b * my + c * y1];
}

/** Paints a leafy spray into a 1024² cell. Twig enters at the bottom centre. */
function paintBroadCluster(g, ox, oy, leaves, seed, { count = 34, scale = 0.42, spread = 1, twigCol = '#4a3b2a', tints }) {
  const rand = mulberry32(seed);
  const cx = ox + CELL / 2;
  // main twig + side twigs
  const twigs = [];
  const main = [cx, oy + CELL - 30, cx + (rand() - 0.5) * 120, oy + 120];
  const mm = drawTwig(g, rand, ...main, 11, twigCol);
  twigs.push([...main, ...mm]);
  for (let i = 0; i < 6; i++) {
    const t = 0.25 + i * 0.11;
    const [px, py] = quadPoint(main[0], main[1], mm[0], mm[1], main[2], main[3], t);
    const side = i % 2 ? 1 : -1;
    const ex = px + side * (220 + rand() * 160) * spread, ey = py - 120 - rand() * 160;
    const m2 = drawTwig(g, rand, px, py, ex, ey, 6, twigCol);
    twigs.push([px, py, ex, ey, ...m2]);
  }
  // leaves along twigs, painted back-to-front with value variation
  const items = [];
  for (let i = 0; i < count; i++) {
    const tw = twigs[Math.floor(rand() * twigs.length)];
    const t = 0.3 + rand() * 0.7;
    const [px, py] = quadPoint(tw[0], tw[1], tw[4], tw[5], tw[2], tw[3], t);
    items.push({ px, py, r: rand(), leaf: leaves[Math.floor(rand() * leaves.length)] });
  }
  items.sort((a, b) => a.r - b.r);
  for (const it of items) {
    const ang = (rand() - 0.5) * 2.4 + Math.atan2(it.px - cx, oy + CELL - it.py) * 0.6;
    const s = scale * (0.75 + rand() * 0.5);
    const lc = it.leaf;
    g.save();
    g.translate(it.px, it.py);
    g.rotate(ang);
    g.scale(s * (0.85 + rand() * 0.3), s);
    // stem (bottom of the leaf image) attaches at the twig
    g.drawImage(lc, -lc.width / 2, -lc.height * 0.97);
    g.restore();
  }
  void tints;
}

function paintNeedles(g, ox, oy, seed) {
  const rand = mulberry32(seed);
  // drooping spruce spray: main axis bottom -> top, needles on both sides
  const x0 = ox + CELL / 2, y0 = oy + CELL - 20, x1 = ox + CELL / 2 + 30, y1 = oy + 40;
  const branches = [[x0, y0, x1, y1, 1]];
  for (let i = 0; i < 9; i++) {
    const t = 0.12 + i * 0.09;
    const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    const side = i % 2 ? 1 : -1;
    const len = (1 - t) * 380 + 120;
    branches.push([px, py, px + side * len * 0.9, py - len * 0.55, 0.6]);
  }
  for (const [ax, ay, bx, by, w] of branches) {
    g.strokeStyle = '#3d3020';
    g.lineWidth = 7 * w;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    const len = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / len, dy = (by - ay) / len;
    const n = Math.floor(len / 3.2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      const nl = (34 + rand() * 26) * (1 - t * 0.45) * (0.7 + w * 0.5);
      for (const side of [-1, 1]) {
        const a = Math.atan2(dy, dx) + side * (0.75 + rand() * 0.45) - 0.12;
        const ex = px + Math.cos(a) * nl, ey = py + Math.sin(a) * nl;
        const v = rand();
        const r = Math.round(28 + v * 26), gg = Math.round(58 + v * 42), b = Math.round(24 + v * 16);
        g.strokeStyle = `rgb(${r},${gg},${b})`;
        g.lineWidth = 2.6 + rand() * 1.6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      }
    }
  }
}

export async function createFoliageAtlas() {
  const [img9, img10] = await Promise.all([loadImage(texUrl('LeafSet009.webp')), loadImage(texUrl('LeafSet010.webp'))]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, SIZE, SIZE);

  // pre-tinted leaf variants (darker/greener/yellower)
  const mk = (img, rects, tints) => {
    const out = [];
    for (const r of rects) for (const [t, a] of tints) out.push(tintCanvas(img, r, t, a));
    return out;
  };
  const broadLeaves = mk(img9, LEAVES_009, [['#1d3a10', 0.3], ['#2d4a12', 0.18], ['#0f2408', 0.42], ['#47561a', 0.12]]);
  const mapleLeaves = mk(img10, LEAVES_010, [['#1f3d0f', 0.38], ['#243a0c', 0.22], ['#3d5212', 0.15]]);
  const birchLeaves = mk(img9, LEAVES_009, [['#6a8a1c', 0.2], ['#4f7414', 0.25], ['#86a02a', 0.15]]);

  paintBroadCluster(g, 0, 0, broadLeaves, 11, { count: 95, scale: 0.33, spread: 1.0 });
  paintBroadCluster(g, CELL, 0, mapleLeaves, 23, { count: 62, scale: 0.3, spread: 1.15 });
  paintBroadCluster(g, 0, CELL, birchLeaves, 37, { count: 120, scale: 0.19, spread: 0.85, twigCol: '#5a4a3a' });
  paintNeedles(g, CELL, CELL, 51);

  // de-fringe: give transparent texels the average leaf colour so mips stay green
  const id = g.getImageData(0, 0, SIZE, SIZE);
  const d = id.data;
  const avg = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let y = 0; y < SIZE; y += 2) for (let x = 0; x < SIZE; x += 2) {
    const i = (y * SIZE + x) * 4;
    if (d[i + 3] > 200) {
      const r = (y >= CELL ? 2 : 0) + (x >= CELL ? 1 : 0);
      avg[r][0] += d[i]; avg[r][1] += d[i + 1]; avg[r][2] += d[i + 2]; avg[r][3]++;
    }
  }
  const means = avg.map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    if (d[i + 3] < 8) {
      const m = means[(y >= CELL ? 2 : 0) + (x >= CELL ? 1 : 0)];
      d[i] = m[0]; d[i + 1] = m[1]; d[i + 2] = m[2];
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.userData.means = means.map((m) => new THREE.Color().setRGB(m[0] / 255, m[1] / 255, m[2] / 255, THREE.SRGBColorSpace));
  return tex;
}

/** uv rect [u0, v0, u1, v1] of a region (v measured from the top, DataTexture is not flipped). */
export function regionUV(region) {
  const col = region % 2, row = Math.floor(region / 2);
  const pad = 0.004;
  return [col * 0.5 + pad, row * 0.5 + pad, col * 0.5 + 0.5 - pad, row * 0.5 + 0.5 - pad];
}
