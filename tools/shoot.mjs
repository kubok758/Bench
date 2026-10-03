// Screenshot helper: node tools/shoot.mjs --url http://localhost:5173/ --views establish,village --styles 1,2 --out shots
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const VIEWS = {
  establish: { p: [250, 58, 250], t: [40, 8, -10] },
  village: { p: [34, 7, 48], t: [-4, 9, -12], ground: true },
  square: { p: [9, 1.7, 22], t: [-6, 2.4, -12], ground: true },
  street: { p: [56, 1.7, -2], t: [10, 3, -8], ground: true },
  bridge: { p: [124, 2.2, -36], t: [88, 4, -12], ground: true },
  pond: { p: [196, 4, 252], t: [130, 6, 190], ground: true },
  forest: { p: [180, 1.7, -120], t: [150, 4, -160], ground: true },
  meadow: { p: [214, 3, -20], t: [276, 10, -52], ground: true },
  mill: { p: [-96, 3, 74], t: [-142, 22, 16], ground: true },
  stones: { p: [-202, 2.0, -178], t: [-228, 2.5, -205], ground: true },
  stonesTop: { p: [-228, 70, -168], t: [-228, 20, -205] },
  mountains: { p: [40, 40, 120], t: [-60, 60, -900] },
  top: { p: [0, 1100, 1], t: [0, 0, 0] },
  candA: { p: [190, 34, 175], t: [20, 12, -20] },
  candB: { p: [140, 24, 90], t: [-40, 14, -30] },
  candC: { p: [260, 64, 50], t: [-20, 12, -30] },
  candD: { p: [30, 38, 210], t: [-30, 12, -40] },
  closeup: { p: [6, 1.7, 30], t: [4, 0.6, 24], ground: true },
  people: { p: [3.5, 1.6, 7.5], t: [-2, 1.3, 2.8], ground: true },
  well: { p: [-6, 1.5, 9], t: [-1.5, 1.2, 3], ground: true },
  portrait: { p: [-0.6, 1.55, 5.0], t: [-2.1, 1.45, 2.9], ground: true },
  vendor: { p: [9.6, 1.6, -2.6], t: [8.6, 1.4, -5.0], ground: true },
};

export function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    }
  }
  return a;
}

export async function launch({ width = 1280, height = 720 } = {}) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return { browser, page, logs };
}

export async function openApp(page, url, { style = 1, timeout = 300000 } = {}) {
  const u = new URL(url);
  u.searchParams.set('test', '1');
  u.searchParams.set('style', String(style));
  await page.goto(u.toString(), { waitUntil: 'load', timeout });
  const pageErr = new Promise((_, rej) => page.once('pageerror', (e) => rej(new Error(`pageerror: ${e.message}`))));
  pageErr.catch(() => {});
  await Promise.race([pageErr, page.waitForFunction(() => window.__app && (window.__app.isReady || window.__app.error), null, { timeout, polling: 500 })]);
  const err = await page.evaluate(() => window.__app.error || null);
  if (err) throw new Error(`App failed: ${err}`);
}

export async function setView(page, v) {
  await page.evaluate((v) => {
    const app = window.__app;
    let [x, y, z] = v.p;
    if (v.ground) y += app.ctx.worldQ.groundAt(x, z);
    let [tx, ty, tz] = v.t;
    if (v.ground) ty += app.ctx.worldQ.groundAt(tx, tz);
    app.setView([x, y, z], [tx, ty, tz]);
  }, v);
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url || 'http://localhost:5173/';
  const views = (args.views || 'establish').split(',');
  const styles = (args.styles || '1').split(',').map(Number);
  const out = args.out || 'shots';
  const w = Number(args.w || 1280), h = Number(args.h || 720);
  const steps = Number(args.steps || 3);
  fs.mkdirSync(out, { recursive: true });
  const { browser, page, logs } = await launch({ width: w, height: h });
  try {
    const t0 = Date.now();
    await openApp(page, url, { style: styles[0] });
    console.log('ready in', Date.now() - t0, 'ms');
    for (const s of styles) {
      await page.evaluate((i) => window.__app.setStyle(i - 1), s);
      for (const name of views) {
        const v = VIEWS[name] || JSON.parse(name);
        await setView(page, v);
        const t1 = Date.now();
        await page.evaluate((n) => window.__app.step(n, 1 / 30), steps);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
        const file = path.join(out, `${name}_s${s}.png`);
        await page.screenshot({ path: file, timeout: 240000 });
        const info = await page.evaluate(() => window.__app.renderInfo());
        console.log(file, `${Date.now() - t1}ms`, JSON.stringify(info));
      }
    }
  } finally {
    const bad = logs.filter((l) => /error|warn/i.test(l));
    if (bad.length) console.log(bad.slice(0, 30).join('\n'));
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
