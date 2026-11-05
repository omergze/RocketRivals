/* Rocket Rivals — particles, ribbon trails and floor decals (purely visual, never affects physics). */
(() => {
'use strict';
const G = window.G; if (!G) return;
const { gl } = G;
const MAXP = 2400, FL = 10;                  // floats per vertex
const KIND = { glow: 0, ring: 1, smoke: 2, ribbon: 3, flat: 4 };
const FX = { KIND, shake: 0, count: 0 };

// pooled particle store (struct of arrays)
const A = {};
for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'max', 's0', 's1', 'r', 'g', 'b', 'a', 'drag', 'grav']) A[k] = new Float32Array(MAXP);
const kindArr = new Uint8Array(MAXP), addArr = new Uint8Array(MAXP);
let n = 0, limit = 1000;
FX.clear = () => { n = 0; FX.count = 0; };
FX.setLimit = v => { limit = Math.min(MAXP, v); if (n > limit) n = limit; };

FX.spawn = function (kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, additive, drag = 0, grav = 0) {
  if (n >= limit) return;
  const i = n++;
  A.px[i] = x; A.py[i] = y; A.pz[i] = z; A.vx[i] = vx; A.vy[i] = vy; A.vz[i] = vz; A.life[i] = life; A.max[i] = life;
  A.s0[i] = s0; A.s1[i] = s1; A.r[i] = r; A.g[i] = g; A.b[i] = b; A.a[i] = a; A.drag[i] = drag; A.grav[i] = grav; kindArr[i] = kind; addArr[i] = additive ? 1 : 0;
};
FX.update = function (dt) {
  for (let i = 0; i < n;) {
    A.life[i] -= dt;
    if (A.life[i] <= 0) { // swap remove
      const l = --n; if (i !== l) { for (const k in A) A[k][i] = A[k][l]; kindArr[i] = kindArr[l]; addArr[i] = addArr[l]; } continue;
    }
    const d = Math.exp(-A.drag[i] * dt);
    A.vx[i] *= d; A.vy[i] = A.vy[i] * d - A.grav[i] * dt; A.vz[i] *= d;
    A.px[i] += A.vx[i] * dt; A.py[i] += A.vy[i] * dt; A.pz[i] += A.vz[i] * dt;
    if (A.py[i] < 0.05 && A.grav[i] > 0) { A.py[i] = 0.05; A.vy[i] *= -0.35; A.vx[i] *= 0.7; A.vz[i] *= 0.7; }
    i++;
  }
  FX.count = n;
  FX.shake = Math.max(0, FX.shake - dt * 2.4);
};

// ---- vertex streams
const addBuf = new Float32Array(MAXP * 4 * FL * 2), alphaBuf = new Float32Array(MAXP * 4 * FL * 2 + 4000 * FL);
let addN = 0, alphaN = 0;
const vbA = gl.createBuffer(), vbB = gl.createBuffer();
const ibo = gl.createBuffer();
{ const idx = new Uint16Array(16000 * 6 / 4 * 4); // quad index pattern for up to 16k quads (uint16 => 65k verts)
  const q = Math.floor(65532 / 4); const arr = new Uint16Array(q * 6);
  for (let i = 0; i < q; i++) { const v = i * 4, o = i * 6; arr[o] = v; arr[o + 1] = v + 1; arr[o + 2] = v + 2; arr[o + 3] = v; arr[o + 4] = v + 2; arr[o + 5] = v + 3; }
  void idx; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
gl.bindBuffer(gl.ARRAY_BUFFER, vbA); gl.bufferData(gl.ARRAY_BUFFER, addBuf.byteLength, gl.DYNAMIC_DRAW);
gl.bindBuffer(gl.ARRAY_BUFFER, vbB); gl.bufferData(gl.ARRAY_BUFFER, alphaBuf.byteLength, gl.DYNAMIC_DRAW);
let rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0;

function quad(buf, o, kind, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, r, g, b, a) {
  const c = [[x0, y0, z0, 0, 0], [x1, y1, z1, 1, 0], [x2, y2, z2, 1, 1], [x3, y3, z3, 0, 1]];
  for (let k = 0; k < 4; k++) { const v = c[k]; buf[o++] = v[0]; buf[o++] = v[1]; buf[o++] = v[2]; buf[o++] = v[3]; buf[o++] = v[4]; buf[o++] = r; buf[o++] = g; buf[o++] = b; buf[o++] = a; buf[o++] = kind; }
  return o;
}
function sprite(buf, o, kind, x, y, z, s, r, g, b, a, rot) {
  const c = Math.cos(rot || 0), sn = Math.sin(rot || 0);
  const ax = (rx * c + ux * sn) * s, ay = (ry * c + uy * sn) * s, az = (rz * c + uz * sn) * s;
  const bx = (-rx * sn + ux * c) * s, by = (-ry * sn + uy * c) * s, bz = (-rz * sn + uz * c) * s;
  return quad(buf, o, kind, x - ax - bx, y - ay - by, z - az - bz, x + ax - bx, y + ay - by, z + az - bz, x + ax + bx, y + ay + by, z + az + bz, x - ax + bx, y - ay + by, z - az + bz, r, g, b, a);
}
FX.beginFrame = function (view) {
  addN = 0; alphaN = 0;
  rx = view[0]; ry = view[4]; rz = view[8]; ux = view[1]; uy = view[5]; uz = view[9];
};
// transient (per-frame) sprites
FX.glow = function (x, y, z, size, r, g, b, a, kind = 0) { if (addN + 4 * FL < addBuf.length) addN = sprite(addBuf, addN, kind, x, y, z, size, r, g, b, a, 0); };
FX.puff = function (x, y, z, size, r, g, b, a) { if (alphaN + 4 * FL < alphaBuf.length) alphaN = sprite(alphaBuf, alphaN, KIND.smoke, x, y, z, size, r, g, b, a, 0); };

// ---- ribbon trails (ring buffers)
FX.createTrail = (len = 22) => ({ x: new Float32Array(len), y: new Float32Array(len), z: new Float32Array(len), t: new Float32Array(len), head: 0, len, count: 0 });
FX.trailPush = function (tr, x, y, z, time) { tr.head = (tr.head + 1) % tr.len; tr.x[tr.head] = x; tr.y[tr.head] = y; tr.z[tr.head] = z; tr.t[tr.head] = time; if (tr.count < tr.len) tr.count++; };
FX.trailClear = tr => { tr.count = 0; };
FX.drawTrail = function (tr, time, life, width, r, g, b, a, camX, camY, camZ) {
  if (tr.count < 2) return;
  let prev = null;
  for (let k = 0; k < tr.count; k++) {
    const i = (tr.head - k + tr.len) % tr.len, age = time - tr.t[i];
    if (age > life) break;
    const f = 1 - age / life, w = width * (0.25 + 0.75 * f);
    const px = tr.x[i], py = tr.y[i], pz = tr.z[i];
    const j = (i - 1 + tr.len) % tr.len; if (k + 1 >= tr.count) break;
    const qx = tr.x[j], qy = tr.y[j], qz = tr.z[j], age2 = time - tr.t[j], f2 = Math.max(0, 1 - age2 / life), w2 = width * (0.25 + 0.75 * f2);
    // side vector = tangent x view dir
    let tx = qx - px, ty = qy - py, tz = qz - pz; const vx = camX - px, vy = camY - py, vz = camZ - pz;
    let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    if (addN + 4 * FL >= addBuf.length) return;
    // quad: p-left, p-right, q-right, q-left ; uv.x across, color alpha fades along the trail
    const o0 = addN;
    const c = [[px - sx * w, py - sy * w, pz - sz * w, 0, f], [px + sx * w, py + sy * w, pz + sz * w, 1, f], [qx + sx * w2, qy + sy * w2, qz + sz * w2, 1, f2], [qx - sx * w2, qy - sy * w2, qz - sz * w2, 0, f2]];
    let o = o0;
    for (const v of c) { addBuf[o++] = v[0]; addBuf[o++] = v[1]; addBuf[o++] = v[2]; addBuf[o++] = v[3]; addBuf[o++] = 0; addBuf[o++] = r; addBuf[o++] = g; addBuf[o++] = b; addBuf[o++] = a * v[4]; addBuf[o++] = KIND.ribbon; }
    addN = o; prev = i;
  }
  void prev;
};

// ---- floor decals (tyre marks) — ring buffer of quads with age
const MAXD = 520, dec = new Float32Array(MAXD * 8); const decT = new Float32Array(MAXD); let decHead = 0, decCount = 0;
FX.decal = function (x0, z0, x1, z1, width, time) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.02) return;
  const px = -dz / l * width * 0.5, pz = dx / l * width * 0.5;
  const i = decHead; decHead = (decHead + 1) % MAXD; if (decCount < MAXD) decCount++;
  dec.set([x0 - px, z0 - pz, x0 + px, z0 + pz, x1 + px, z1 + pz, x1 - px, z1 - pz], i * 8); decT[i] = time;
};
FX.clearDecals = () => { decCount = 0; };
FX.drawDecals = function (time) {
  for (let k = 0; k < decCount; k++) {
    const age = time - decT[k]; if (age > 14) continue;
    const a = 0.42 * (1 - age / 14); if (alphaN + 4 * FL >= alphaBuf.length) return;
    const d = k * 8;
    alphaN = quad(alphaBuf, alphaN, KIND.flat, dec[d], 0.045, dec[d + 1], dec[d + 2], 0.045, dec[d + 3], dec[d + 4], 0.045, dec[d + 5], dec[d + 6], 0.045, dec[d + 7], 0.02, 0.025, 0.03, a);
  }
};

// soft contact shadow blob lying on the floor
FX.blob = function (x, z, rx_, rz_, yaw, a) {
  if (alphaN + 4 * FL >= alphaBuf.length) return;
  const c = Math.cos(yaw), sn = Math.sin(yaw), ax = c * rx_, az = -sn * rx_, bx = sn * rz_, bz = c * rz_, y = 0.05;
  alphaN = quad(alphaBuf, alphaN, 0, x - ax - bx, y, z - az - bz, x + ax - bx, y, z + az - bz, x + ax + bx, y, z + az + bz, x - ax + bx, y, z - az + bz, 0, 0.01, 0.02, a);
};
FX.draw = function () {
  // pooled particles
  for (let i = 0; i < n; i++) {
    const f = 1 - A.life[i] / A.max[i];
    const s = A.s0[i] + (A.s1[i] - A.s0[i]) * f;
    let a = A.a[i] * (f < 0.12 ? f / 0.12 : 1) * (1 - f * f);
    if (addArr[i]) { if (addN + 4 * FL < addBuf.length) addN = sprite(addBuf, addN, kindArr[i], A.px[i], A.py[i], A.pz[i], s, A.r[i], A.g[i], A.b[i], a, 0); }
    else if (alphaN + 4 * FL < alphaBuf.length) alphaN = sprite(alphaBuf, alphaN, kindArr[i], A.px[i], A.py[i], A.pz[i], s, A.r[i], A.g[i], A.b[i], a, i * 0.7);
  }
  const p = G.partProg; gl.useProgram(p.p);
  gl.uniformMatrix4fv(p.u.uView, false, G.view); gl.uniformMatrix4fv(p.u.uProj, false, G.proj);
  gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  for (let k = 0; k < 4; k++) gl.enableVertexAttribArray(k);
  const submit = (vb, buf, count, src, dst) => {
    if (!count) return;
    gl.blendFunc(src, dst);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, count));
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FL * 4, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FL * 4, 12);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FL * 4, 20); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, FL * 4, 36);
    gl.drawElements(gl.TRIANGLES, count / FL / 4 * 6, gl.UNSIGNED_SHORT, 0);
  };
  submit(vbB, alphaBuf, alphaN, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  submit(vbA, addBuf, addN, gl.SRC_ALPHA, gl.ONE);
  gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
};

// ---- ready-made effects ------------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
FX.burst = function (x, y, z, n_, speed, col, life = 0.8, size = 0.5) {   // spark burst
  for (let i = 0; i < n_; i++) {
    const th = Math.random() * 6.283, ph = Math.acos(rand(-1, 1)), sp = speed * rand(0.35, 1);
    FX.spawn(0, x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.9 + speed * 0.2, Math.sin(ph) * Math.sin(th) * sp, life * rand(0.6, 1.1), size, size * 0.2, col[0], col[1], col[2], 1, true, 1.6, 9);
  }
};
FX.shockwave = function (x, y, z, size, col, life = 0.6) { FX.spawn(1, x, y, z, 0, 0, 0, life, size * 0.2, size, col[0], col[1], col[2], 0.9, true); };
FX.flare = function (x, y, z, size, col, life = 0.35) { FX.spawn(0, x, y, z, 0, 0, 0, life, size, size * 1.6, col[0], col[1], col[2], 1, true); };
window.FX = FX;
})();
