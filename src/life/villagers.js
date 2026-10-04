import * as THREE from 'three';
import { U } from '../render/uniforms.js';
import { commonPars, shadowPars, fogPars, lightingPars, clipWater } from '../render/shaders/lib.js';
import { buildVillager, BONE_INDEX as BI } from './villagerMesh.js';
import { mulberry32 } from '../core/math.js';
import { LANDMARKS, PATHS } from '../world/layout.js';
import { sampleSpline } from '../core/math.js';

const vert = /* glsl */ `
#include <skinning_pars_vertex>
attribute vec3 aCol;
attribute float aMat;
attribute vec3 aFace;
attribute float aAo;
varying float vAo;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vCol;
varying float vMat;
varying vec3 vFace;
void main() {
  #include <skinbase_vertex>
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWp = wp.xyz;
  vN = normalize(mat3(modelMatrix) * objectNormal);
  vCol = aCol;
  vMat = aMat;
  vFace = aFace;
  vAo = aAo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
${commonPars}
${shadowPars}
${fogPars}
${lightingPars}
uniform vec3 uHair;
varying vec3 vWp;
varying vec3 vN;
varying vec3 vCol;
varying float vMat;
varying vec3 vFace;
varying float vAo;

float ellipseMask(vec2 p, vec2 c, vec2 r, float soft) {
  vec2 q = (p - c) / r;
  return 1.0 - smoothstep(1.0 - soft, 1.0 + soft, length(q));
}

void main() {
  ${clipWater}
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWp);
  vec3 alb = vCol;
  int m = int(vMat + 0.5);
  Surf s = surfDefault(alb, N);
  s.rough = 0.85; s.spec = 0.2;
  if (m == 0) {
    s.wrap = 0.35; s.rough = 0.5; s.spec = 0.35; s.trans = 0.15;
    // procedural face on the front of the head
    if (vFace.z > 0.35) {
      vec2 f = vFace.xy;
      float anime = uStyle == 2 ? 1.0 : 0.0;
      float toon = uStyle == 3 ? 1.0 : 0.0;
      vec2 eyeR = mix(vec2(0.16, 0.095), vec2(0.17, 0.2), anime);
      eyeR = mix(eyeR, vec2(0.12, 0.15), toon);
      float eyeY = mix(0.06, 0.0, anime);
      for (int i = 0; i < 2; i++) {
        float sx = i == 0 ? -1.0 : 1.0;
        vec2 c = vec2(sx * 0.38, eyeY);
        float white = ellipseMask(f, c, eyeR, 0.12);
        float iris = ellipseMask(f, c + vec2(0.0, -0.005), eyeR * vec2(0.55, mix(0.9, 0.75, anime)), 0.15);
        float hl = ellipseMask(f, c + vec2(sx * 0.03, 0.05), eyeR * 0.22, 0.2) * max(anime, toon);
        vec3 irisCol = mix(vec3(0.08, 0.06, 0.05), vec3(0.15, 0.3, 0.55), anime);
        // soft socket shading around the eye, then the eye itself
        float socket = ellipseMask(f, c + vec2(0.0, 0.03), eyeR * vec2(1.5, 2.0), 0.6);
        alb *= 1.0 - socket * 0.18 * (1.0 - max(anime, toon));
        alb = mix(alb, vec3(0.72, 0.7, 0.66), white * mix(0.6, 1.0, max(anime, toon)));
        alb = mix(alb, irisCol, iris);
        alb = mix(alb, vec3(1.0), hl);
        // upper lid line
        float lid = ellipseMask(f, c + vec2(0.0, eyeR.y * 0.75), eyeR * vec2(1.15, 0.28), 0.25);
        alb = mix(alb, vec3(0.06, 0.04, 0.03), lid * 0.8);
        // brow
        float brow = ellipseMask(f, c + vec2(sx * 0.02, 0.23 + anime * 0.1), vec2(0.17, 0.035), 0.3);
        alb = mix(alb, uHair * 0.8, brow * 0.9);
      }
      // shading under the nose and the lower lip
      float under = ellipseMask(f, vec2(0.0, -0.3), vec2(0.12, 0.05), 0.8);
      alb *= 1.0 - under * 0.12;
      float mouth = ellipseMask(f, vec2(0.0, -0.5), vec2(0.18, 0.03), 0.4);
      alb = mix(alb, vCol * vec3(0.7, 0.42, 0.4), mouth * 0.85);
      float blush = ellipseMask(f, vec2(0.0, -0.18), vec2(0.62, 0.18), 0.8) * (1.0 - ellipseMask(f, vec2(0.0, -0.2), vec2(0.25, 0.3), 0.5));
      alb = mix(alb, alb * vec3(1.08, 0.9, 0.88), blush * 0.5);
    }
    s.albedo = styleAlbedo(alb, vCol);
  } else if (m == 1) {
    // woven cloth
    vec2 wv = vec2(vWp.x + vWp.z, vWp.y) * 260.0;
    float weave = sin(wv.x) * sin(wv.y) * 0.5 + 0.5;
    float n = noise4(vWp.xz * 1.7 + vWp.y).g;
    alb *= (0.9 + 0.12 * n) * (0.96 + 0.06 * weave * uStyleA.x);
    s.albedo = styleAlbedo(alb, vCol);
    s.wrap = 0.25; s.rough = 0.92; s.spec = 0.12;
  } else if (m == 2) {
    float strands = noise4(vec2(vWp.x * 40.0 + vWp.z * 40.0, vWp.y * 6.0)).b;
    alb *= 0.8 + 0.4 * strands;
    s.albedo = styleAlbedo(alb, vCol);
    s.rough = 0.45; s.spec = 0.55;
  } else if (m == 3) {
    s.albedo = styleAlbedo(alb, vCol);
    s.rough = 0.55; s.spec = 0.4;
  } else {
    vec2 sv = vec2(atan(vWp.z, vWp.x) * 30.0, vWp.y * 120.0);
    alb *= 0.85 + 0.2 * (sin(sv.x + sv.y) * 0.5 + 0.5);
    s.albedo = styleAlbedo(alb, vCol);
    s.rough = 0.8; s.spec = 0.25;
  }
  s.ao = vAo * (gl_FrontFacing ? 1.0 : 0.35);
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWp, N, ndl) * cloudShadow(vWp);
  vec3 col = shade(s, vWp, V, sh);
  col = applyFog(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

const depthFrag = 'void main(){ gl_FragColor = vec4(1.0); }';

// ---------------------------------------------------------------------------
// Walkable graph built from the authored paths
function buildGraph(data, worldQ) {
  const nodes = [];
  const add = (x, z) => { nodes.push({ x, z, e: [], y: worldQ.groundAt(x, z) }); return nodes.length - 1; };
  const ends = [];
  for (const p of PATHS) {
    const pts = sampleSpline(p.pts, 3);
    let prev = -1;
    const ids = [];
    for (const [x, z] of pts) {
      const id = add(x, z);
      if (prev >= 0) { nodes[prev].e.push(id); nodes[id].e.push(prev); }
      prev = id;
      ids.push(id);
    }
    ends.push(ids[0], ids[ids.length - 1]);
  }
  // join each path end to the nearest node of every other path within 10 m
  const pathOf = new Int32Array(nodes.length);
  {
    let k = 0;
    PATHS.forEach((p, pi) => { const n = sampleSpline(p.pts, 3).length; for (let i = 0; i < n; i++) pathOf[k++] = pi; });
  }
  const link = (a, b) => { if (a !== b && !nodes[a].e.includes(b)) { nodes[a].e.push(b); nodes[b].e.push(a); } };
  for (const id of ends) {
    const a = nodes[id];
    const best = new Map();
    for (let j = 0; j < nodes.length; j++) {
      if (pathOf[j] === pathOf[id]) continue;
      const d = (nodes[j].x - a.x) ** 2 + (nodes[j].z - a.z) ** 2;
      if (d > 100) continue;
      const cur = best.get(pathOf[j]);
      if (!cur || d < cur[1]) best.set(pathOf[j], [j, d]);
    }
    for (const [j] of best.values()) link(id, j);
  }
  // the village square is open ground: connect everything on it
  const plaza = nodes.map((n, i) => [i, Math.hypot(n.x, n.z)]).filter(([, d]) => d < 15).map(([i]) => i);
  for (let i = 0; i < plaza.length; i++) for (let j = i + 1; j < plaza.length; j++) link(plaza[i], plaza[j]);
  // connectivity from the square
  const seen = new Uint8Array(nodes.length);
  const q = [plaza[0] ?? 0];
  seen[q[0]] = 1;
  while (q.length) { const c = q.pop(); for (const nb of nodes[c].e) if (!seen[nb]) { seen[nb] = 1; q.push(nb); } }
  nodes.forEach((n, i) => { n.reach = !!seen[i]; });
  return nodes;
}

function route(nodes, from, to) {
  const prev = new Int32Array(nodes.length).fill(-1);
  const dist = new Float32Array(nodes.length).fill(Infinity);
  dist[from] = 0;
  const open = [from];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    for (const nb of nodes[cur].e) {
      const d = dist[cur] + Math.hypot(nodes[nb].x - nodes[cur].x, nodes[nb].z - nodes[cur].z);
      if (d < dist[nb]) { if (dist[nb] === Infinity) open.push(nb); dist[nb] = d; prev[nb] = cur; }
    }
  }
  if (prev[to] < 0 && from !== to) return null;
  const out = [];
  for (let c = to; c >= 0; c = prev[c]) { out.push(c); if (c === from) break; }
  return out.reverse();
}

function nearestNode(nodes, x, z) {
  let best = 0, bd = Infinity;
  nodes.forEach((n, i) => { if (!n.reach) return; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---------------------------------------------------------------------------
export function createVillagers(ctx) {
  const { scene, worldQ, shadows, data } = ctx;
  const nodes = buildGraph(data, worldQ);
  const rand = mulberry32(99);
  const group = new THREE.Group();
  group.name = 'villagers';

  const hot = [[0, 0], [8, -6], [-12, -58], [60, -10], [-30, 14], [20, 40], [-130, 22], [104, 196], [90, -12], [2, -120], [-10, 70]];
  const hotNodes = hot.map(([x, z]) => nearestNode(nodes, x, z));
  const farNodes = [[262, -58], [-226, -200], [52, -207], [-60, -170], [-20, 300]].map(([x, z]) => nearestNode(nodes, x, z));
  const pickDest = () => (rand() < 0.82 ? hotNodes[Math.floor(rand() * hotNodes.length)] : farNodes[Math.floor(rand() * farNodes.length)]);

  const agents = [];
  const mk = (seed, opts, setup) => {
    const v = buildVillager(seed, opts);
    const hair = new THREE.Color(...v.hair);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uHair: { value: hair } }, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide });
    const dmat = new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: vert, fragmentShader: depthFrag, side: THREE.DoubleSide });
    const mesh = new THREE.SkinnedMesh(v.geo, mat);
    mesh.add(v.bones[0]);
    mesh.bind(v.skeleton);
    mesh.scale.setScalar(v.scale);
    mesh.frustumCulled = true;
    shadows.addCaster(mesh, dmat);
    group.add(mesh);
    const a = {
      mesh, bones: v.bones, v, mode: 'idle', idle: 1 + rand() * 4, route: null, ri: 0,
      pos: new THREE.Vector2(), heading: rand() * Math.PI * 2, speed: 1.15 + rand() * 0.35 - (v.elder ? 0.25 : 0),
      phase: rand() * 6.28, side: rand() < 0.5 ? 0.6 : -0.6, t: rand() * 100, look: 0, lookT: 0, gesture: 0,
      walkAmt: 0, node: 0, kind: 'walker', face: 0,
    };
    setup?.(a);
    agents.push(a);
    return a;
  };

  // walkers spread over the village graph
  for (let i = 0; i < 14; i++) {
    mk(500 + i * 31, {}, (a) => {
      a.node = hotNodes[i % hotNodes.length];
      const n = nodes[a.node];
      a.pos.set(n.x + (rand() - 0.5) * 3, n.z + (rand() - 0.5) * 3);
      a.idle = rand() * 3;
    });
  }
  // stationary characters: two neighbours chatting by the well, a vendor, a fisherman on the dock, a farmer at the field
  const stations = [
    { x: -2.6, z: 2.4, face: [0.5, -1.2] }, { x: -1.3, z: 3.6, face: [-2.6, 2.4] },
    { x: 8.6, z: -5.0, face: [5, -1], carry: 'none' },
    { x: 109.5, z: 194.5, face: [125, 190] },
    { x: -60, z: 44, face: [-80, 52] },
    { x: -16, z: -58, face: [-8, -60] }, { x: -9, z: -59, face: [-16, -58] },
  ];
  stations.forEach((st, k) => {
    mk(900 + k * 13, { carry: st.carry }, (a) => {
      a.kind = 'station';
      a.pos.set(st.x, st.z);
      a.heading = Math.atan2(st.face[0] - st.x, st.face[1] - st.z);
      a.mode = 'idle';
      a.idle = 1e9;
      a.gesture = k < 2 || k >= 5 ? 1 : 0.3;
    });
  });
  scene.add(group);

  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector2();
  let frame = 0;

  function setTarget(a) {
    const dest = pickDest();
    const from = nearestNode(nodes, a.pos.x, a.pos.y);
    const r = route(nodes, from, dest);
    if (r && r.length > 1) { a.route = r; a.ri = 1; a.mode = 'walk'; } else { a.mode = 'idle'; a.idle = 3 + rand() * 5; }
  }

  function animate(a, dt) {
    const b = a.bones;
    const w = a.walkAmt;
    const ph = a.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const t = a.t;
    // legs (a long skirt shortens the stride and keeps the swinging shin inside the cloth)
    const skirtK = a.v.female ? 0.72 : 1;
    const kneeK = a.v.female ? 0.5 : 1;
    for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
      const p = ph + off;
      const sp = Math.sin(p), cp = Math.cos(p);
      const thigh = -0.44 * sp * w * skirtK;
      const swing = Math.max(0, Math.cos(p + 0.45));
      const knee = (0.08 + 1.05 * kneeK * swing * swing * (cp > -0.2 ? 1 : 0.6) + 0.12 * Math.max(0, -sp)) * w + 0.04;
      const foot = -(thigh + knee) * 0.92 + (sp < -0.6 ? 0.25 * (-sp - 0.6) * w : 0) - 0.04 * w;
      b[BI[`thigh${side}`]].rotation.set(thigh - 0.02, 0, 0);
      b[BI[`shin${side}`]].rotation.set(knee, 0, 0);
      b[BI[`foot${side}`]].rotation.set(foot, 0, 0);
    }
    // hips: bob, sway, twist
    const breathe = Math.sin(t * 1.7);
    const bob = (-0.028 * Math.cos(2 * ph) - 0.012) * w;
    b[BI.hips].position.set(0.022 * s * w + Math.sin(t * 0.35) * 0.012 * (1 - w), 0.94 + bob, 0);
    b[BI.hips].rotation.set(0.04 * w, 0.13 * s * w, -0.045 * c * w + Math.sin(t * 0.35) * 0.02 * (1 - w));
    b[BI.spine].rotation.set(0.03 * w + 0.01 * breathe, -0.08 * s * w, 0.02 * c * w);
    b[BI.chest].rotation.set(0.02 * w + 0.015 * breathe * (1 - w), -0.1 * s * w, 0.0);
    // arms
    const g = a.gesture * (1 - w);
    const gest = Math.sin(t * 2.3 + a.phase) * Math.max(0, Math.sin(t * 0.7 + a.phase * 3));
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const armS = side === 'L' ? s : -s;
      const carrying = a.v.carry === 'basket' && side === 'L';
      const ua = b[BI[`upperArm${side}`]], fa = b[BI[`foreArm${side}`]];
      ua.rotation.set(0.34 * armS * w * (carrying ? 0.2 : 1) - (carrying ? 0.1 : 0) - (side === 'R' ? g * 0.25 * (0.5 + gest) : 0), 0, sx * (0.07 + 0.02 * breathe) + (carrying ? sx * 0.15 : 0));
      fa.rotation.set(-(0.3 + 0.25 * Math.max(0, -armS) * w + (carrying ? 1.25 : 0) + (side === 'R' ? g * (0.45 + 0.35 * gest) : 0.1 * (1 - w))), 0, 0);
      b[BI[`hand${side}`]].rotation.set(0.1, 0, 0);
    }
    // head: steady + glances
    a.lookT -= dt;
    if (a.lookT < 0) { a.look = (rand() - 0.5) * (w > 0.5 ? 0.7 : 1.4); a.lookT = 1.5 + rand() * 3; }
    const hd = b[BI.head];
    hd.rotation.y += (a.look - hd.rotation.y) * (1 - Math.exp(-dt * 3));
    hd.rotation.x = -0.02 * w + 0.03 * Math.sin(t * 0.9) * (1 - w) + 0.02 * Math.cos(2 * ph) * w;
    b[BI.neck].rotation.set(0.05, -0.05 * s * w, 0);
  }

  return {
    name: 'villagers',
    group,
    agents,
    nodes,
    stats: { villagers: agents.length, walkers: agents.filter((a) => a.kind === 'walker').length, graphNodes: nodes.length, unreachable: nodes.filter((n) => !n.reach).length },
    update(dt, time, c) {
      frame++;
      camPos.copy(c.camera.position);
      for (const a of agents) {
        a.t += dt;
        const d = Math.hypot(a.pos.x - camPos.x, a.pos.y - camPos.z);
        // behaviour ----------------------------------------------------
        if (a.mode === 'idle') {
          a.idle -= dt;
          a.walkAmt += (0 - a.walkAmt) * (1 - Math.exp(-dt * 5));
          if (a.idle <= 0 && a.kind === 'walker') setTarget(a);
        } else if (a.mode === 'walk') {
          const n = nodes[a.route[a.ri]];
          const prevN = nodes[a.route[a.ri - 1]];
          // keep to one side of the path
          const dx = n.x - prevN.x, dz = n.z - prevN.z;
          const L = Math.hypot(dx, dz) || 1;
          const tx = n.x + (dz / L) * a.side, tz = n.z - (dx / L) * a.side;
          tmp.set(tx - a.pos.x, tz - a.pos.y);
          const dist = tmp.length();
          if (dist < 1.2) {
            a.ri++;
            if (a.ri >= a.route.length) { a.mode = 'idle'; a.idle = 2.5 + rand() * 7; a.gesture = rand() < 0.4 ? 0.6 : 0; }
          } else {
            const want = Math.atan2(tmp.x, tmp.y);
            let dh = want - a.heading;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            a.heading += dh * (1 - Math.exp(-dt * 4));
          }
          a.walkAmt += (1 - a.walkAmt) * (1 - Math.exp(-dt * 3));
          const v = a.speed * a.walkAmt;
          a.pos.x += Math.sin(a.heading) * v * dt;
          a.pos.y += Math.cos(a.heading) * v * dt;
          a.phase += (v / (a.v.female ? 1.12 : 1.42)) * Math.PI * 2 * dt / Math.max(a.v.scale, 0.5);
        }
        // separation
        for (const o of agents) {
          if (o === a) continue;
          const sx = a.pos.x - o.pos.x, sz = a.pos.y - o.pos.y;
          const dd = sx * sx + sz * sz;
          if (dd < 0.7 && dd > 1e-4) { const k = (0.84 - Math.sqrt(dd)) * 0.5; a.pos.x += (sx / Math.sqrt(dd)) * k * dt * 4; a.pos.y += (sz / Math.sqrt(dd)) * k * dt * 4; }
        }
        // placement -----------------------------------------------------
        const vis = d < 170;
        a.mesh.visible = vis;
        if (!vis) continue;
        const y = worldQ.groundAt(a.pos.x, a.pos.y);
        a.mesh.position.set(a.pos.x, y, a.pos.y);
        a.mesh.rotation.y = a.heading;
        if (d < 70 || frame % 2 === 0) animate(a, d < 70 ? dt : dt * 2);
      }
    },
  };
}
