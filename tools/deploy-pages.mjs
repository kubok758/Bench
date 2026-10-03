// Publishes dist/ to the gh-pages branch (GitHub Pages "deploy from branch").
//   npm run build && node tools/deploy-pages.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(ROOT, 'dist');
const sh = (c, cwd = ROOT) => execSync(c, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();

if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ missing; run npm run build');
const src = sh('git rev-parse --short HEAD');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghpages-'));
try {
  sh('git init -q', tmp);
  sh('git checkout -q -b gh-pages', tmp);
  fs.cpSync(dist, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, '.nojekyll'), '');
  sh('git add -A', tmp);
  sh(`git -c user.name="${sh('git log -1 --format=%an')}" -c user.email="${sh('git log -1 --format=%ae')}" commit -q -m "Deploy Hollowmere (${src})"`, tmp);
  const remote = sh('git remote get-url origin');
  sh(`git push -f ${remote} gh-pages:gh-pages`, tmp);
  console.log(`DEPLOYED ${src} to gh-pages`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
