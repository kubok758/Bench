// Runnable acceptance checks for GATES.md.
//   node tools/verify.mjs <smoke|modes|content|life|controls|perf|ui> [--url URL]
// Without --url the production build in dist/ is served locally.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  process.exitCode = 1;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveDist() {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ missing: run npm run build first');
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // emulate the GitHub Pages sub-path
      p = p.replace(/^\/Bench/, '');
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dist, p);
      if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/Bench/` }));
  });
}

async function launch(width = 1024, height = 576) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(900000);
  const errors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.includes('127.0.0.1') && !u.includes('github.io')) external.push(u); });
  return { browser, page, errors, external };
}

async function open(page, base, { test = true, style = 1 } = {}) {
  const u = new URL(base);
  if (test) { u.searchParams.set('test', '1'); u.searchParams.set('style', String(style)); }
  await page.goto(u.toString(), { waitUntil: 'load', timeout: 900000 });
  await page.waitForFunction(() => window.__app && (window.__app.isReady || window.__app.error), null, { timeout: 900000, polling: 500 });
  const err = await page.evaluate(() => window.__app.error || null);
  if (err) throw new Error(`app error: ${err}`);
}

const VIEWS = [
  { name: 'valley', p: [250, 58, 250], t: [40, 8, -10] },
  { name: 'village', p: [34, 7, 48], t: [-4, 9, -12], ground: true },
  { name: 'forest', p: [180, 1.7, -120], t: [150, 4, -160], ground: true },
];
async function setView(page, v) {
  await page.evaluate((v) => {
    const app = window.__app;
    let [x, y, z] = v.p, [tx, ty, tz] = v.t;
    if (v.ground) { y += app.ctx.worldQ.groundAt(x, z); ty += app.ctx.worldQ.groundAt(tx, tz); }
    app.setView([x, y, z], [tx, ty, tz]);
  }, v);
}

// ---------------------------------------------------------------------------
function zNormalize(img) {
  const { px } = img;
  const n = px.length / 3;
  const out = new Float32Array(px.length);
  for (let c = 0; c < 3; c++) {
    let m = 0, s = 0;
    for (let i = 0; i < n; i++) m += px[i * 3 + c];
    m /= n;
    for (let i = 0; i < n; i++) s += (px[i * 3 + c] - m) ** 2;
    s = Math.sqrt(s / n) || 1;
    for (let i = 0; i < n; i++) out[i * 3 + c] = (px[i * 3 + c] - m) / s;
  }
  return out;
}
const structDiff = (a, b) => {
  const za = zNormalize(a), zb = zNormalize(b);
  let d = 0;
  for (let i = 0; i < za.length; i++) d += Math.abs(za[i] - zb[i]);
  return d / za.length;
};
const tint = (img) => ({ ...img, px: img.px.map((v, i) => Math.min(255, Math.round(v * [1.25, 0.9, 0.7][i % 3] + [10, 4, 0][i % 3]))) });

// ---------------------------------------------------------------------------
async function main() {
  let server = null;
  let base = urlArg;
  if (!base) { server = await serveDist(); base = server.url; }
  const { browser, page, errors, external } = await launch();
  try {
    if (cmd === 'smoke') {
      // the real experience: no test flags, real render loop
      await open(page, base, { test: false });
      await page.waitForFunction(() => window.__app.frames >= 4, null, { timeout: 900000, polling: 1000 });
      const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
      const info = await page.evaluate(() => ({ frames: window.__app.frames, ready: window.__app.isReady, stats: window.__app.stats, gl: !!document.querySelector('canvas').getContext('webgl2') }));
      // pixel variance of the actual screenshot, decoded in the page (not a blank screen)
      const variance = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 96; c.height = 54;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 96, 54);
        const d = g.getImageData(0, 0, 96, 54).data;
        let m = 0, s = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) m += d[i] + d[i + 1] + d[i + 2];
        m /= n;
        for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2] - m) ** 2;
        return Math.sqrt(s / n);
      }, shot.toString('base64'));
      console.log(JSON.stringify({ ...info, variance: +variance.toFixed(1), screenshotBytes: shot.length, consoleErrors: errors.length, externalRequests: external.length }));
      if (errors.length) fail(`console/page errors: ${errors.slice(0, 5).join(' | ')}`);
      if (!info.ready || info.frames < 4) fail('app did not render frames');
      if (variance < 12) fail('rendered frame looks blank');
      if (!process.exitCode) console.log('SMOKE OK');
    } else if (cmd === 'modes') {
      await open(page, base, { test: true, style: 1 });
      await setView(page, VIEWS[1]);
      const caps = [];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(`Digit${i + 1}`);
        const idx = await page.evaluate(() => window.__app.styleIndex);
        if (idx !== i) fail(`key ${i + 1} selected style ${idx}`);
        await page.evaluate(() => window.__app.step(2, 1 / 30));
        caps.push(await page.evaluate(() => window.__app.capture(192, 108)));
      }
      const control = structDiff(caps[0], tint(caps[0]));
      const rows = [];
      let min = Infinity;
      for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
        const d = structDiff(caps[a], caps[b]);
        min = Math.min(min, d);
        rows.push(`${a + 1}-${b + 1}:${d.toFixed(3)}`);
      }
      const T = 0.25;
      console.log(`tint control ${control.toFixed(4)} | min pair ${min.toFixed(3)} | ${rows.join(' ')}`);
      if (control > T / 5) fail('tint control is not near zero (metric broken)');
      if (min < T) fail(`two styles differ only by ${min.toFixed(3)} (< ${T})`);
      if (errors.length) fail(`errors: ${errors.slice(0, 3).join(' | ')}`);
      if (!process.exitCode) console.log('MODES OK');
    } else if (cmd === 'content') {
      await open(page, base, { test: true, style: 1 });
      const c = await page.evaluate(() => {
        const app = window.__app;
        const sys = Object.fromEntries(app.systems.map((s) => [s.name, s.stats || {}]));
        const d = app.data;
        // forest and open-ground coverage of the playable square
        let forest = 0, open = 0, n = 0;
        for (let i = 0; i < d.forest.length; i += 7) { n++; if (d.forest[i] > 0.5) forest++; else if (d.forest[i] < 0.05) open++; }
        const pathLen = d.pathFields.reduce((a, p) => a + p.field.length, 0);
        const far = app.ctx.scene.getObjectByName('terrain-far');
        let maxH = 0;
        const pa = far.geometry.attributes.position.array;
        for (let i = 1; i < pa.length; i += 3) maxH = Math.max(maxH, pa[i]);
        const water = app.ctx.scene.getObjectByName('water');
        return { sys, forestFrac: forest / n, openFrac: open / n, pathLen, maxMountain: maxH, waterVerts: water.geometry.attributes.position.count };
      });
      const s = c.sys;
      console.log(JSON.stringify(c));
      const req = [
        ['trees', s.trees.trees >= 2000], ['forest coverage', c.forestFrac >= 0.25], ['open clearings/meadows', c.openFrac >= 0.25],
        ['houses', s.village.houses >= 10], ['bridges', s.village.bridges >= 2], ['chapel+windmill', s.village.chapel === 1 && s.village.windmill === 1],
        ['paths', c.pathLen >= 1500], ['water', c.waterVerts > 1000], ['mountains', c.maxMountain >= 300],
        ['villagers', s.villagers.villagers >= 8], ['grass blades', s.grass.blades >= 150000], ['flowers', s.grass.flowers >= 10000],
        ['birds', s.ambient.birds >= 10], ['smoke', s.ambient.chimneysSmoking >= 3],
      ];
      for (const [k, ok] of req) if (!ok) fail(`content requirement not met: ${k}`);
      if (!process.exitCode) console.log('CONTENT OK');
    } else if (cmd === 'life') {
      await open(page, base, { test: true, style: 1 });
      await setView(page, VIEWS[1]);
      const snap = () => page.evaluate(() => {
        const app = window.__app;
        const v = app.systems.find((s) => s.name === 'villagers');
        const vil = app.systems.find((s) => s.name === 'village');
        const amb = app.systems.find((s) => s.name === 'ambient');
        return {
          time: app.ctx.uniforms.uTime.value,
          walkers: v.agents.filter((a) => a.kind === 'walker').map((a) => [a.pos.x, a.pos.y, a.bones[12].rotation.x, a.bones[13].rotation.x]),
          sails: vil.sails.rotation.z,
          birds: amb.birdPositions().map((p) => [p.x, p.y, p.z]),
        };
      });
      await page.evaluate(() => window.__app.simulate(30, 1 / 30));
      const a = await snap();
      await page.evaluate(() => window.__app.simulate(150, 1 / 30));
      const b = await snap();
      const moved = a.walkers.filter((w, i) => Math.hypot(w[0] - b.walkers[i][0], w[1] - b.walkers[i][1]) > 1).length;
      const posed = a.walkers.filter((w, i) => Math.abs(w[2] - b.walkers[i][2]) + Math.abs(w[3] - b.walkers[i][3]) > 0.02).length;
      const birdsMoved = a.birds.filter((p, i) => Math.hypot(p[0] - b.birds[i][0], p[2] - b.birds[i][2]) > 2).length;
      const r = { walkers: a.walkers.length, moved, posed, dTime: +(b.time - a.time).toFixed(2), dSails: +(b.sails - a.sails).toFixed(3), birdsMoved, birds: a.birds.length };
      console.log(JSON.stringify(r));
      if (moved < Math.ceil(r.walkers * 0.6)) fail('too few villagers walked');
      if (posed < Math.ceil(r.walkers * 0.6)) fail('limb poses did not change');
      if (r.dTime < 4.9) fail('time uniform did not advance');
      if (Math.abs(r.dSails) < 0.5) fail('windmill did not turn');
      if (birdsMoved < r.birds * 0.8) fail('birds did not fly');
      if (!process.exitCode) console.log('LIFE OK');
    } else if (cmd === 'controls') {
      await open(page, base, { test: true, style: 1 });
      const res = {};
      // enter the valley the way the button does, then walk with W
      await page.evaluate(() => window.__app.enter());
      await page.evaluate(() => { const app = window.__app; app.controls.transition = null; const g = app.ctx.worldQ.groundAt(2, 110); app.controls.setPose([2, g + 1.68, 110], [2, g + 1.6, 60]); });
      await page.evaluate(() => window.__app.simulate(5, 1 / 30));
      const p0 = await page.evaluate(() => window.__app.ctx.camera.position.toArray());
      await page.keyboard.down('KeyW');
      await page.evaluate(() => window.__app.simulate(1, 1 / 30));
      const p1 = await page.evaluate(() => window.__app.ctx.camera.position.toArray());
      await page.evaluate(() => window.__app.simulate(59, 1 / 30));
      await page.keyboard.up('KeyW');
      const p2 = await page.evaluate(() => window.__app.ctx.camera.position.toArray());
      res.firstFrameStep = +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(3);
      res.walked2s = +Math.hypot(p2[0] - p0[0], p2[2] - p0[2]).toFixed(2);
      res.eyeHeight = +(await page.evaluate(() => { const app = window.__app; const c = app.ctx.camera.position; return c.y - app.ctx.worldQ.groundAt(c.x, c.z); })).toFixed(2);
      // look: a synthetic mouse drag rotates the view
      const yaw0 = await page.evaluate(() => window.__app.controls.tYaw);
      await page.evaluate(() => {
        const c = document.querySelector('#app canvas');
        c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: 180, movementY: 0, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.evaluate(() => window.__app.simulate(10, 1 / 30));
      res.yawChange = +(await page.evaluate((y0) => window.__app.controls.yaw - y0, yaw0)).toFixed(3);
      // collision: walk into the chapel wall
      await page.evaluate(() => { const app = window.__app; const g = app.ctx.worldQ.groundAt(-14, -55); app.controls.setPose([-14, g + 1.68, -52], [-14, g + 1.6, -80]); app.controls.vel.set(0, 0, 0); });
      await page.keyboard.down('KeyW');
      await page.evaluate(() => window.__app.simulate(120, 1 / 30));
      await page.keyboard.up('KeyW');
      res.chapelStopZ = +(await page.evaluate(() => window.__app.ctx.camera.position.z)).toFixed(2);
      // fly mode toggle and climb
      await page.keyboard.press('KeyF');
      res.mode = await page.evaluate(() => window.__app.controls.mode);
      const y0 = await page.evaluate(() => window.__app.ctx.camera.position.y);
      await page.keyboard.down('Space');
      await page.evaluate(() => window.__app.simulate(45, 1 / 30));
      await page.keyboard.up('Space');
      res.climb = +((await page.evaluate(() => window.__app.ctx.camera.position.y)) - y0).toFixed(2);
      console.log(JSON.stringify(res));
      if (res.firstFrameStep > 0.25) fail('movement starts abruptly (no acceleration)');
      if (res.walked2s < 4) fail('walking with W did not move the camera far enough');
      if (res.eyeHeight < 1.3 || res.eyeHeight > 2.1) fail('camera not kept at eye height above ground');
      if (Math.abs(res.yawChange) < 0.2) fail('mouse look did not turn the camera');
      if (res.chapelStopZ < -64) fail('walked through the chapel');
      if (res.mode !== 'fly' || res.climb < 3) fail('fly mode toggle/climb failed');
      if (!process.exitCode) console.log('CONTROLS OK');
    } else if (cmd === 'perf') {
      await open(page, base, { test: true, style: 1 });
      const BUDGET = [
        { calls: 450, tris: 9e6 }, { calls: 450, tris: 9e6 }, { calls: 450, tris: 9e6 }, { calls: 450, tris: 9e6 }, { calls: 650, tris: 14e6 },
      ];
      const rows = [];
      for (let s = 0; s < 5; s++) {
        await page.evaluate((s) => window.__app.setStyle(s), s);
        for (const v of VIEWS) {
          await setView(page, v);
          await page.evaluate(() => window.__app.step(2, 1 / 30));
          const r = await page.evaluate(() => ({ ...window.__app.renderInfo(), upd: window.__app.updateMs }));
          rows.push({ style: s + 1, view: v.name, ...r });
          if (r.calls > BUDGET[s].calls || r.triangles > BUDGET[s].tris) fail(`style ${s + 1} ${v.name}: ${r.calls} calls / ${(r.triangles / 1e6).toFixed(2)}M tris over budget`);
        }
      }
      // CPU update cost (JS side) over a short walk
      const upd = await page.evaluate(() => { const a = []; for (let i = 0; i < 20; i++) { window.__app.step(1, 1 / 60); a.push(window.__app.updateMs); } a.sort((x, y) => x - y); return a[10]; });
      // adaptive resolution reacts to slow frames
      const drs = await page.evaluate(() => { const d = window.__app.drs; const before = d.idx; for (let i = 0; i < 200; i++) d.feed(30); const slow = d.idx; for (let i = 0; i < 600; i++) d.feed(8); return { before, slow, recovered: d.idx }; });
      for (const r of rows) console.log(`style ${r.style} ${r.view.padEnd(8)} calls ${String(r.calls).padStart(4)} tris ${(r.triangles / 1e6).toFixed(2)}M shadowCalls ${r.shadowCalls} reflCalls ${r.reflCalls}`);
      console.log(`median update ${upd.toFixed(2)} ms | drs ${JSON.stringify(drs)}`);
      if (upd > 8) fail('CPU update too slow');
      if (!(drs.slow > drs.before && drs.recovered < drs.slow)) fail('dynamic resolution did not react');
      if (!process.exitCode) console.log('PERF OK');
    } else if (cmd === 'ui') {
      await open(page, base, { test: false });
      await page.waitForFunction(() => document.getElementById('intro').classList.contains('show'), null, { timeout: 900000 });
      await page.click('#enter');
      await page.waitForFunction(() => window.__app.controls.mode === 'walk', null, { timeout: 900000, polling: 1000 });
      await page.keyboard.press('Digit3');
      // toast + hint fade out on their own
      await page.waitForTimeout(12000);
      const r = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        let chars = 0, area = 0;
        const items = [];
        for (const id of ['loader', 'intro', 'hint', 'toast', 'crosshair', 'fail']) {
          const el = document.getElementById(id);
          const cs = getComputedStyle(el);
          const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
          if (!vis) continue;
          const b = el.getBoundingClientRect();
          chars += (el.innerText || '').trim().length;
          area += (b.width * b.height) / (vw * vh);
          items.push(id);
        }
        return { visible: items, chars, area: +area.toFixed(4), mode: window.__app.controls.mode };
      });
      console.log(JSON.stringify(r));
      if (r.chars > 80) fail('too much visible text');
      if (r.area > 0.05) fail('UI covers too much of the view');
      if (r.mode !== 'walk') fail('enter button did not start exploring');
      if (errors.length) fail(`errors: ${errors.slice(0, 3).join(' | ')}`);
      if (!process.exitCode) console.log('UI OK');
    } else {
      fail(`unknown command ${cmd}`);
    }
  } catch (e) {
    fail(e.stack || String(e));
  } finally {
    await browser.close();
    server?.srv.close();
  }
}
main();
