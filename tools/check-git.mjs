// node tools/check-git.mjs <branch>  -> prints GIT OK when the work tree is clean and pushed
import { execSync } from 'node:child_process';

const branch = process.argv[2];
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
let ok = true;
const dirty = sh('git status --porcelain');
if (dirty) { console.log(`FAIL: uncommitted changes:\n${dirty}`); ok = false; }
const cur = sh('git rev-parse --abbrev-ref HEAD');
if (cur !== branch) { console.log(`FAIL: on branch ${cur}, expected ${branch}`); ok = false; }
sh(`git fetch -q origin ${branch}`);
const local = sh('git rev-parse HEAD');
const remote = sh(`git rev-parse origin/${branch}`);
console.log(`local ${local.slice(0, 10)} remote ${remote.slice(0, 10)}`);
if (local !== remote) { console.log('FAIL: branch not pushed'); ok = false; }
if (ok) console.log('GIT OK');
else process.exitCode = 1;
