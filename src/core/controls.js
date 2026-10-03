import * as THREE from 'three';
import { TOUR } from '../world/layout.js';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}

export class Controls {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world; // { groundAt(x,z), heightAt(x,z), blocked(x,z,r) -> push vector or null }
    this.mode = 'tour';
    this.yaw = 0; this.pitch = 0;
    this.tYaw = 0; this.tPitch = 0;
    this.pos = new THREE.Vector3(0, 20, 0);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.keys = new Set();
    this.locked = false;
    this.dragging = false;
    this.lastInput = 0;
    this.bob = 0;
    this.bobAmt = 0;
    this.grounded = true;
    this.tourT = 0;
    this.tourSpeed = 1 / 14; // segments per second
    this.transition = null;
    this.eye = 1.68;
    this.touchFwd = false;
    this.sensitivity = 0.0021;
    this.onModeChange = null;
    this._bind();
  }

  _bind() {
    const el = this.dom;
    document.addEventListener('keydown', (e) => {
      if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) return;
      this.keys.add(e.code);
      this.lastInput = performance.now();
      if (e.code === 'KeyF' && this.mode !== 'tour') this.setMode(this.mode === 'fly' ? 'walk' : 'fly');
      if (e.code === 'KeyC') this.setMode(this.mode === 'tour' ? 'walk' : 'tour');
      if (e.code === 'Space' && this.mode === 'walk' && this.grounded) { this.vy = 4.6; this.grounded = false; }
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mode === 'tour') return;
      if (this.locked || this.dragging) {
        const s = this.locked ? this.sensitivity : this.sensitivity * 1.4;
        this.tYaw -= e.movementX * s;
        this.tPitch -= e.movementY * s;
        this.tPitch = THREE.MathUtils.clamp(this.tPitch, -1.45, 1.45);
        this.lastInput = performance.now();
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (this.mode === 'tour') return;
      if (!this.locked && e.button === 0) {
        this.requestLock();
        this.dragging = true;
      }
    });
    document.addEventListener('mouseup', () => (this.dragging = false));
    // touch: drag to look, hold to walk
    let tId = null, tx = 0, ty = 0, tStart = 0, moved = 0;
    el.addEventListener('touchstart', (e) => {
      if (this.mode === 'tour') return;
      const t = e.changedTouches[0];
      tId = t.identifier; tx = t.clientX; ty = t.clientY; tStart = performance.now(); moved = 0;
      this._touchTimer = setTimeout(() => { if (moved < 12) this.touchFwd = true; }, 260);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== tId) continue;
        const dx = t.clientX - tx, dy = t.clientY - ty;
        moved += Math.abs(dx) + Math.abs(dy);
        this.tYaw -= dx * 0.005;
        this.tPitch = THREE.MathUtils.clamp(this.tPitch - dy * 0.004, -1.4, 1.4);
        tx = t.clientX; ty = t.clientY;
        this.lastInput = performance.now();
      }
    }, { passive: true });
    const end = () => { clearTimeout(this._touchTimer); this.touchFwd = false; tId = null; void tStart; };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  requestLock() {
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch { /* not available (e.g. headless) */ }
  }

  setMode(m, { instant = false } = {}) {
    if (m === this.mode) return;
    const prev = this.mode;
    this.mode = m;
    if (m === 'tour') {
      // continue the tour from the closest point
      this.tourT = this._closestTourT(this.camera.position);
      document.exitPointerLock?.();
    } else if (prev === 'tour') {
      this.pos.copy(this.camera.position);
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = this.tYaw = e.y;
      this.pitch = this.tPitch = e.x;
      this.vel.set(0, 0, 0);
      if (m === 'walk' && !instant) {
        const g = this.world.groundAt(this.pos.x, this.pos.z) + this.eye;
        if (this.pos.y - g > 3) this.transition = { from: this.pos.y, t: 0, dur: 1.6 };
      }
    }
    if (m === 'walk' && prev === 'fly') {
      const g = this.world.groundAt(this.pos.x, this.pos.z) + this.eye;
      if (this.pos.y - g > 3) this.transition = { from: this.pos.y, t: 0, dur: 1.4 };
    }
    this.onModeChange?.(m, prev);
  }

  /** Place the camera explicitly (used by the start sequence and tests). */
  setPose(pos, target) {
    this.pos.set(pos[0], pos[1], pos[2]);
    tmpV.set(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]).normalize();
    this.yaw = this.tYaw = Math.atan2(-tmpV.x, -tmpV.z);
    this.pitch = this.tPitch = Math.asin(THREE.MathUtils.clamp(tmpV.y, -1, 1));
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  _closestTourT(p) {
    let best = 0, bd = Infinity;
    const out = [0, 0, 0];
    const n = TOUR.length;
    for (let s = 0; s < n * 8; s++) {
      const t = s / 8;
      this._tourPoint(t, 'p', out);
      const d = (out[0] - p.x) ** 2 + (out[1] - p.y) ** 2 + (out[2] - p.z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  _tourPoint(t, key, out) {
    const n = TOUR.length;
    const i = Math.floor(t);
    const f = t - i;
    const g = (k) => TOUR[((k % n) + n) % n][key];
    return catmull(g(i - 1), g(i), g(i + 1), g(i + 2), f, out);
  }

  /** Glide from the current view to a start pose, then hand control to the walker. */
  enterAt(pos, target, dur = 3.2) {
    const cam = this.camera;
    this.travel = {
      t: 0, dur,
      p0: cam.position.clone(), q0: cam.quaternion.clone(),
      p1: new THREE.Vector3(...pos),
      q1: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...pos), new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0))),
      target,
    };
    this.mode = 'travel';
    this.onModeChange?.('travel', 'tour');
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const cam = this.camera;
    if (this.mode === 'travel') {
      const tr = this.travel;
      tr.t += dt / tr.dur;
      const k = tr.t >= 1 ? 1 : tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - Math.pow(-2 * tr.t + 2, 3) / 2;
      // arc through the air so the move reads as a deliberate camera flight
      const lift = Math.sin(Math.PI * k) * Math.min(25, tr.p0.distanceTo(tr.p1) * 0.12);
      cam.position.lerpVectors(tr.p0, tr.p1, k);
      cam.position.y += lift;
      cam.quaternion.slerpQuaternions(tr.q0, tr.q1, Math.min(1, k * 1.15));
      cam.updateMatrixWorld();
      if (tr.t >= 1) {
        this.mode = 'tour';
        this.setMode('walk', { instant: true });
        this.setPose([tr.p1.x, tr.p1.y, tr.p1.z], tr.target);
      }
      return;
    }
    if (this.mode === 'tour') {
      this.tourT += dt * this.tourSpeed;
      const p = this._tourPoint(this.tourT, 'p', [0, 0, 0]);
      const t = this._tourPoint(this.tourT + 0.12, 't', [0, 0, 0]);
      const g = this.world.groundAt(p[0], p[2]) + 4 + (this.world.canopyAt ? this.world.canopyAt(p[0], p[2]) : 0);
      if (p[1] < g) p[1] = g;
      tmpV.set(p[0], p[1], p[2]);
      if (!this._tourInit) { cam.position.copy(tmpV); this._tourInit = true; }
      cam.position.lerp(tmpV, 1 - Math.exp(-dt * 3));
      tmpV2.set(t[0], t[1], t[2]);
      const m = new THREE.Matrix4().lookAt(cam.position, tmpV2, cam.up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, 1 - Math.exp(-dt * 2.5));
      cam.updateMatrixWorld();
      return;
    }

    // look smoothing
    const k = 1 - Math.exp(-dt * 28);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    if (this.keys.has('ArrowLeft')) this.tYaw += dt * 1.6;
    if (this.keys.has('ArrowRight')) this.tYaw -= dt * 1.6;

    // input direction
    let fx = 0, fz = 0, fy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touchFwd) fz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
    if (this.keys.has('KeyA')) fx -= 1;
    if (this.keys.has('KeyD')) fx += 1;
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);

    if (this.mode === 'fly') {
      if (this.keys.has('Space') || this.keys.has('KeyE')) fy += 1;
      if (this.keys.has('KeyQ') || this.keys.has('ControlLeft') || this.keys.has('KeyC')) fy -= 1;
      const sp = run ? 48 : 14;
      // move along the view direction (pitch included)
      const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
      const dir = tmpV.set(-sy * cp * -fz, spch * -fz, -cy * cp * -fz);
      dir.x += cy * fx; dir.z += -sy * fx;
      dir.y += fy;
      const target = dir.multiplyScalar(sp);
      this.vel.lerp(target, 1 - Math.exp(-dt * 4));
      this.pos.addScaledVector(this.vel, dt);
      const g = this.world.heightAt(this.pos.x, this.pos.z) + 1.2;
      if (this.pos.y < g) { this.pos.y = g; this.vel.y = Math.max(0, this.vel.y); }
      this.pos.y = Math.min(this.pos.y, 900);
      this.bobAmt *= 0.9;
    } else {
      const sp = run ? 7.2 : 3.1;
      const tx = (-sy * -fz + cy * fx) * sp;
      const tz = (-cy * -fz - sy * fx) * sp;
      const acc = 1 - Math.exp(-dt * (fx || fz ? 7 : 9));
      this.vel.x += (tx - this.vel.x) * acc;
      this.vel.z += (tz - this.vel.z) * acc;
      let nx = this.pos.x + this.vel.x * dt;
      let nz = this.pos.z + this.vel.z * dt;
      const push = this.world.collide?.(nx, nz, 0.35);
      if (push) { nx += push[0]; nz += push[1]; }
      // keep inside the playable valley
      const lim = 500;
      nx = THREE.MathUtils.clamp(nx, -lim, lim);
      nz = THREE.MathUtils.clamp(nz, -lim, lim);
      this.pos.x = nx; this.pos.z = nz;
      const ground = this.world.groundAt(this.pos.x, this.pos.z) + this.eye;
      if (this.transition) {
        const tr = this.transition;
        tr.t += dt / tr.dur;
        const e = tr.t >= 1 ? 1 : 1 - Math.pow(1 - tr.t, 3);
        this.pos.y = THREE.MathUtils.lerp(tr.from, ground, e);
        if (tr.t >= 1) this.transition = null;
        this.grounded = true;
        this.vy = 0;
      } else {
        this.vy -= 13 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= ground) {
          // smooth step-up on slopes / stairs
          this.pos.y = this.grounded ? THREE.MathUtils.lerp(this.pos.y, ground, 1 - Math.exp(-dt * 30)) : ground;
          if (this.pos.y < ground - 0.25) this.pos.y = ground - 0.25;
          this.vy = 0;
          this.grounded = true;
        } else if (this.pos.y > ground + 0.05 && this.vy <= 0 && this.grounded && this.pos.y - ground < 0.5) {
          // stick to the ground when walking down slopes
          this.pos.y = THREE.MathUtils.lerp(this.pos.y, ground, 1 - Math.exp(-dt * 20));
        } else if (this.pos.y > ground + 0.5) {
          this.grounded = false;
        }
      }
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.bob += dt * speed * 1.9;
      this.bobAmt += ((this.grounded ? Math.min(speed / 3.1, 1.6) : 0) - this.bobAmt) * (1 - Math.exp(-dt * 6));
    }

    const bobY = Math.sin(this.bob * 2) * 0.032 * this.bobAmt;
    const bobX = Math.cos(this.bob) * 0.018 * this.bobAmt;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bobX, this.pos.y + bobY, this.pos.z - Math.sin(this.yaw) * bobX);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.003 * this.bobAmt, 'YXZ');
    cam.updateMatrixWorld();
  }
}
