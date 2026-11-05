/* Rocket Rivals — WebGL renderer core: matrices, mesh builder, lighting + shadow-map shaders.
   No dependencies. Exposes window.G */
(() => {
'use strict';
const canvas = document.getElementById('game');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' }) ||
           canvas.getContext('experimental-webgl');
if (!gl) { window.G = null; return; }
const PI = Math.PI, TAU = PI * 2;
const HAS_DERIV = !!gl.getExtension('OES_standard_derivatives');

// ------------------------------------------------------------------ matrices (column-major, allocation free)
const M4 = {
  ident(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  mul(o, a, b) {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++)
      o[j * 4 + i] = a[i] * b[j * 4] + a[i + 4] * b[j * 4 + 1] + a[i + 8] * b[j * 4 + 2] + a[i + 12] * b[j * 4 + 3];
    return o;
  },
  // T * Ry * Rx * Rz * S   (same convention as the original renderer)
  compose(o, x, y, z, yaw, pitch, roll, sx, sy, sz) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cx = Math.cos(pitch), sx_ = Math.sin(pitch), cz = Math.cos(roll), sz_ = Math.sin(roll);
    const a0x = cy, a0y = 0, a0z = -sy_, a1x = sx_ * sy_, a1y = cx, a1z = sx_ * cy, a2x = cx * sy_, a2y = -sx_, a2z = cx * cy;
    o[0] = (cz * a0x + sz_ * a1x) * sx; o[1] = (cz * a0y + sz_ * a1y) * sx; o[2] = (cz * a0z + sz_ * a1z) * sx; o[3] = 0;
    o[4] = (-sz_ * a0x + cz * a1x) * sy; o[5] = (-sz_ * a0y + cz * a1y) * sy; o[6] = (-sz_ * a0z + cz * a1z) * sy; o[7] = 0;
    o[8] = a2x * sz; o[9] = a2y * sz; o[10] = a2z * sz; o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1; return o;
  },
  perspective(o, fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o;
  },
  ortho(o, l, r, b, t, n, f) {
    o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt(o, ex, ey, ez, tx, ty, tz, ux = 0, uy = 1, uz = 0) {
    let zx = ex - tx, zy = ey - ty, zz = ez - tz, n = Math.hypot(zx, zy, zz) || 1; zx /= n; zy /= n; zz /= n;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx; n = Math.hypot(xx, xy, xz) || 1; xx /= n; xy /= n; xz /= n;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0; o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1; return o;
  }
};

// ------------------------------------------------------------------ geometry primitives (unit size) + builder
function primBox() {
  const p = [], n = [], i = [];
  const sides = [[[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]];
  for (const [nn, q] of sides) { const s = p.length / 3; for (const v of q) { p.push(v[0] * .5, v[1] * .5, v[2] * .5); n.push(...nn); } i.push(s, s + 1, s + 2, s, s + 2, s + 3); }
  return { p, n, i };
}
function primSphere(rows = 20, cols = 30) {
  const p = [], n = [], i = [];
  for (let r = 0; r <= rows; r++) { const phi = r * PI / rows; for (let c = 0; c <= cols; c++) { const th = c * TAU / cols; const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th); p.push(x, y, z); n.push(x, y, z); } }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b = a + cols + 1; i.push(a, a + 1, b, b, a + 1, b + 1); }
  return { p, n, i };
}
// cylinder along Y, radius 1, height 1 (centered); caps included
function primCyl(seg = 20, rTop = 1, rBot = 1) {
  const p = [], n = [], i = [];
  for (let k = 0; k <= seg; k++) { const a = k * TAU / seg, c = Math.cos(a), s = Math.sin(a); const sl = (rBot - rTop); const nl = Math.hypot(1, sl);
    p.push(c * rBot, -.5, s * rBot); n.push(c / nl, sl / nl, s / nl); p.push(c * rTop, .5, s * rTop); n.push(c / nl, sl / nl, s / nl); }
  for (let k = 0; k < seg; k++) { const a = k * 2; i.push(a, a + 3, a + 1, a, a + 2, a + 3); }
  for (const y of [-.5, .5]) { const o = p.length / 3, r = y > 0 ? rTop : rBot; p.push(0, y, 0); n.push(0, Math.sign(y), 0);
    for (let k = 0; k <= seg; k++) { const a = k * TAU / seg; p.push(Math.cos(a) * r, y, Math.sin(a) * r); n.push(0, Math.sign(y), 0); }
    for (let k = 0; k < seg; k++) { if (y > 0) i.push(o, o + k + 2, o + k + 1); else i.push(o, o + k + 1, o + k + 2); } }
  return { p, n, i };
}
function primQuad() { // unit quad in XY facing +Z, local coords -.5..+.5
  return { p: [-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], n: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], i: [0, 1, 2, 0, 2, 3] };
}
// loft along Z through superellipse cross-sections. stations: {z,w,yb,yt,n,cx}
function primLoft(stations, ring = 20, capEnds = true) {
  const p = [], i = [], R = ring;
  for (const s of stations) {
    const mid = (s.yb + s.yt) / 2, h = (s.yt - s.yb) / 2, e = 2 / (s.n || 2.6), cx = s.cx || 0;
    for (let k = 0; k < R; k++) { const t = k * TAU / R, c = Math.cos(t), sn = Math.sin(t);
      p.push(cx + s.w * Math.sign(c) * Math.pow(Math.abs(c), e), mid + h * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.z); }
  }
  for (let a = 0; a < stations.length - 1; a++) for (let k = 0; k < R; k++) {
    const k2 = (k + 1) % R, v00 = a * R + k, v01 = a * R + k2, v10 = (a + 1) * R + k, v11 = (a + 1) * R + k2;
    i.push(v00, v01, v10, v01, v11, v10);
  }
  if (capEnds) for (const [st, flip] of [[0, true], [stations.length - 1, false]]) {
    const o = p.length / 3, s = stations[st]; p.push(s.cx || 0, (s.yb + s.yt) / 2, s.z);
    for (let k = 0; k < R; k++) p.push(p[(st * R + k) * 3], p[(st * R + k) * 3 + 1], p[(st * R + k) * 3 + 2]);
    // caps use their own vertices so normals stay flat-ish
    for (let k = 0; k < R; k++) { const k2 = (k + 1) % R; if (flip) i.push(o, o + 1 + k2, o + 1 + k); else i.push(o, o + 1 + k, o + 1 + k2); }
  }
  // smooth normals from faces
  const n = new Array(p.length).fill(0);
  for (let t = 0; t < i.length; t += 3) {
    const a = i[t] * 3, b = i[t + 1] * 3, c = i[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
  }
  for (let q = 0; q < n.length; q += 3) { const l = Math.hypot(n[q], n[q + 1], n[q + 2]) || 1; n[q] /= l; n[q + 1] /= l; n[q + 2] /= l; }
  return { p, n, i };
}
const PRIM = { box: primBox(), sphere: primSphere(32, 48), sphereLo: primSphere(10, 14), cyl: primCyl(28), cylLo: primCyl(12), cylHi: primCyl(40), cone: primCyl(16, 0.001, 1), quad: primQuad(), loft: primLoft };

const STRIDE = 12; // pos3 norm3 col3 mat3(emissive, spec, anim)
class Builder {
  constructor() { this.meshes = []; this.reset(); }
  reset() { this.v = []; this.ind = []; this.count = 0; }
  // m: 16-array transform (or null)
  add(prim, m, col, em = 0, spec = 0.2, anim = 0) {
    const pc = prim.p.length / 3;
    if (this.count + pc > 64000) this.flush();
    const r = col[0], g = col[1], b = col[2];
    let a0 = 1, a1 = 0, a2 = 0, a4 = 0, a5 = 1, a6 = 0, a8 = 0, a9 = 0, a10 = 1, tx = 0, ty = 0, tz = 0;
    let c00 = 1, c01 = 0, c02 = 0, c10 = 0, c11 = 1, c12 = 0, c20 = 0, c21 = 0, c22 = 1, sgn = 1;
    if (m) {
      a0 = m[0]; a1 = m[1]; a2 = m[2]; a4 = m[4]; a5 = m[5]; a6 = m[6]; a8 = m[8]; a9 = m[9]; a10 = m[10]; tx = m[12]; ty = m[13]; tz = m[14];
      // cofactor matrix for normals
      c00 = a5 * a10 - a6 * a9; c01 = a6 * a8 - a4 * a10; c02 = a4 * a9 - a5 * a8;
      c10 = a2 * a9 - a1 * a10; c11 = a0 * a10 - a2 * a8; c12 = a1 * a8 - a0 * a9;
      c20 = a1 * a6 - a2 * a5; c21 = a2 * a4 - a0 * a6; c22 = a0 * a5 - a1 * a4;
      const det = a0 * c00 + a4 * c10 + a8 * c20; sgn = det < 0 ? -1 : 1;
    }
    for (let k = 0; k < pc; k++) {
      const x = prim.p[k * 3], y = prim.p[k * 3 + 1], z = prim.p[k * 3 + 2], nx = prim.n[k * 3], ny = prim.n[k * 3 + 1], nz = prim.n[k * 3 + 2];
      let wx = a0 * x + a4 * y + a8 * z + tx, wy = a1 * x + a5 * y + a9 * z + ty, wz = a2 * x + a6 * y + a10 * z + tz;
      let qx = (c00 * nx + c10 * ny + c20 * nz) * sgn, qy = (c01 * nx + c11 * ny + c21 * nz) * sgn, qz = (c02 * nx + c12 * ny + c22 * nz) * sgn;
      const l = Math.hypot(qx, qy, qz) || 1;
      this.v.push(wx, wy, wz, qx / l, qy / l, qz / l, r, g, b, em, spec, anim);
    }
    for (const q of prim.i) this.ind.push(q + this.count);
    this.count += pc;
  }
  flush() {
    if (!this.count) return;
    this.meshes.push(makeMesh(this.v, this.ind)); this.reset();
  }
  build() { this.flush(); const r = this.meshes; this.meshes = []; return r; }
}
function makeMesh(v, ind) {
  const vb = gl.createBuffer(), ib = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ind), gl.STATIC_DRAW);
  return { vb, ib, n: ind.length };
}
const WHITE = [1, 1, 1];
function primMesh(prim, col = WHITE, em = 0, spec = 0.2) { const b = new Builder(); b.add(prim, null, col, em, spec); return b.build()[0]; }

// ------------------------------------------------------------------ shaders
const VS = `
attribute vec3 aPos; attribute vec3 aNorm; attribute vec3 aCol; attribute vec3 aMat;
uniform mat4 uModel, uView, uProj, uLightVP; uniform float uTime;
varying vec3 vWorld, vNormal, vCol, vMat, vLocal, vSh;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  float an = aMat.z;
  vec3 mat = aMat;
  if (an > 0.5) { // crowd: little bounces and flickering colour
    float ph = hash(floor(w.xz * 1.3));
    float b = max(0.0, sin(uTime * (2.5 + ph * 3.0) + ph * 40.0));
    w.y += b * 0.22 * an;
    mat.x += b * 0.25;
  }
  vWorld = w.xyz; vNormal = mat3(uModel) * aNorm; vCol = aCol; vMat = mat; vLocal = aPos;
  vSh = (uLightVP * w).xyz * 0.5 + 0.5;
  gl_Position = uProj * uView * w;
}`;
const FS = (HAS_DERIV ? '#extension GL_OES_standard_derivatives : enable\n#define FW(x) fwidth(x)\n' : '#define FW(x) vec2(0.04)\n') + `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vWorld, vNormal, vCol, vMat, vLocal, vSh;
uniform vec3 uColor, uRim, uCam, uSunDir, uSunCol, uSkyCol, uGroundCol, uFog;
uniform float uEmisMul, uAlpha, uMode, uTime, uFogDensity, uShadowOn, uPCF, uNL, uTexel, uLite;
uniform vec4 uPL[8]; uniform vec3 uPLC[8];
uniform sampler2D uShadow, uTex;
uniform vec3 uBallPts[32];

float unpackD(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
float sCmp(vec2 uv, float cur){ return cur > unpackD(texture2D(uShadow, uv)) ? 0.0 : 1.0; }
// hardware-independent bilinear shadow filtering (the depth texture itself must stay NEAREST because it is RGBA-packed)
float sBilinear(vec2 uv, float cur){
  vec2 px = uv / uTexel - 0.5; vec2 f = fract(px); vec2 base = (floor(px) + 0.5) * uTexel;
  float a = sCmp(base, cur), b = sCmp(base + vec2(uTexel, 0.0), cur), c = sCmp(base + vec2(0.0, uTexel), cur), d = sCmp(base + vec2(uTexel, uTexel), cur);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float shadowTerm(float ndl){
  if (uShadowOn < 0.5) return 1.0;
  if (vSh.x < 0.0 || vSh.x > 1.0 || vSh.y < 0.0 || vSh.y > 1.0 || vSh.z > 1.0) return 1.0;
  float cur = vSh.z - (0.0007 + 0.0014 * (1.0 - ndl));
  if (uPCF > 1.5) {          // HIGH: 4 bilinear-filtered taps (16 fetches) -> soft, stable edges
    float s = 0.0;
    s += sBilinear(vSh.xy + vec2(-0.75, -0.75) * uTexel, cur); s += sBilinear(vSh.xy + vec2(0.75, -0.75) * uTexel, cur);
    s += sBilinear(vSh.xy + vec2(-0.75, 0.75) * uTexel, cur);  s += sBilinear(vSh.xy + vec2(0.75, 0.75) * uTexel, cur);
    return s * 0.25;
  }
  if (uPCF > 0.5) return sBilinear(vSh.xy, cur);   // MEDIUM: bilinear PCF (4 fetches)
  return sCmp(vSh.xy, cur);
}
vec3 envColor(vec3 R){
  float h = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 top = vec3(0.03, 0.07, 0.17), hor = vec3(0.10, 0.30, 0.42), low = uGroundCol * 1.6;
  vec3 e = R.y > 0.0 ? mix(hor, top, pow(R.y, 0.6)) : mix(hor, low, pow(-R.y, 0.5));
  e += uSunCol * pow(max(dot(R, uSunDir), 0.0), 48.0) * 1.5;
  return e;
}
vec3 tonemap(vec3 c){ c = c * (1.0 + c / 6.0) / (1.0 + c); return pow(c, vec3(1.0 / 2.2)); }

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  if (!gl_FrontFacing && uMode > 2.5) N = -N;
  vec3 albedo = vCol * uColor;
  float em = vMat.x * uEmisMul, spec = vMat.y, shin = 36.0;
  float alpha = uAlpha;
  vec3 emitCol = vec3(0.0);

  if (uMode > 0.5 && uMode < 1.5) {            // soccer ball
    vec3 p = normalize(vLocal);
    float best1 = -1.0, best2 = -1.0;
    for (int i = 0; i < 12; i++) best1 = max(best1, dot(p, uBallPts[i]));
    for (int i = 12; i < 32; i++) best2 = max(best2, dot(p, uBallPts[i]));
    float a1 = acos(clamp(best1, -1.0, 1.0)), a2 = acos(clamp(best2, -1.0, 1.0));
    float diff = a2 * 0.90 - a1;                 // >0 : pentagon patch
    float seam = 1.0 - smoothstep(0.0, 0.035, abs(diff));
    vec3 white = vec3(0.93, 0.95, 0.98), dark = vec3(0.04, 0.05, 0.08);
    albedo = mix(white, dark, smoothstep(-0.01, 0.01, diff));
    albedo = mix(albedo, vec3(0.10, 0.12, 0.16), seam * 0.85);
    spec = 0.9; shin = 90.0;
    emitCol = albedo * 0.12;
  } else if (uMode > 1.5 && uMode < 2.5) {     // arena floor
    vec2 q = vWorld.xz;
    float stripe = step(0.5, fract(q.y / 9.0));
    float grid = 0.0;
    vec2 g = abs(fract(q / 2.0 - 0.5) - 0.5) / FW(q / 2.0);
    grid = (1.0 - clamp(min(g.x, g.y), 0.0, 1.0)) * (1.0 - smoothstep(0.03, 0.12, FW(q / 2.0).x));
    vec3 base = mix(vec3(0.085, 0.26, 0.33), vec3(0.105, 0.30, 0.38), stripe);
    float zt = smoothstep(-10.0, 10.0, q.y);
    base += mix(vec3(0.10, 0.045, 0.0), vec3(0.0, 0.05, 0.12), zt) * 0.55;
    float endGlow = smoothstep(14.0, 34.0, abs(q.y));
    base += mix(vec3(0.45, 0.17, 0.02), vec3(0.02, 0.22, 0.5), step(0.0, q.y)) * endGlow * endGlow * 0.5;
    base += vec3(0.10, 0.28, 0.34) * grid * 0.10;
    albedo = base;
    spec = 0.75; shin = 55.0;
  } else if (uMode > 2.5 && uMode < 3.5) {     // glass wall
    float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float gu = (vWorld.x + vWorld.z) / 5.0; float u = fract(gu); float lw = max(FW(vec2(gu)).x, 0.0005); float lines = 1.0 - smoothstep(0.012, 0.012 + lw * 1.5, min(u, 1.0 - u));
    alpha = clamp(0.06 + fr * 0.55 + lines * 0.3, 0.0, 0.8);
    albedo = vec3(0.35, 0.65, 0.8); spec = 0.0;
    emitCol = vec3(0.3, 0.7, 1.0) * lines * 0.5;
  } else if (uMode > 3.5 && uMode < 4.5) {     // ceiling lattice
    vec2 g = abs(fract(vWorld.xz / 4.0) - 0.5) / FW(vWorld.xz / 4.0);
    float l = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
    alpha = l * 0.22 + 0.012; albedo = vec3(0.3, 0.6, 1.0); spec = 0.0; emitCol = albedo * l * 0.8;
  } else if (uMode > 4.5 && uMode < 5.5) {     // goal net
    vec2 q = abs(N.y) > 0.7 ? vWorld.xz : vec2(vWorld.x + vWorld.z, vWorld.y);
    vec2 g = abs(fract(q / 0.7) - 0.5) / FW(q / 0.7);
    float l = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
    if (l < 0.05) discard;
    alpha = l * 0.75; albedo = vec3(0.8, 0.9, 1.0); spec = 0.0; emitCol = vec3(0.5, 0.7, 0.9) * 0.4;
  } else if (uMode > 5.5 && uMode < 6.5) {     // sky dome
    vec3 d = normalize(vLocal);
    float h = d.y;
    vec3 col = mix(vec3(0.05, 0.12, 0.22), vec3(0.01, 0.02, 0.07), smoothstep(0.0, 0.55, h));
    col += vec3(0.25, 0.10, 0.28) * exp(-abs(h) * 9.0) * 0.55;
    vec2 sg = vec2(atan(d.x, d.z) * 160.0, h * 160.0); vec2 sp = floor(sg);
    float st = fract(sin(dot(sp, vec2(12.9898, 78.233))) * 43758.5453);
    float sd = length(fract(sg) - 0.5);
    col += vec3(st > 0.996 ? smoothstep(0.32, 0.0, sd) : 0.0) * smoothstep(0.1, 0.5, h) * (0.5 + 0.5 * sin(uTime * 2.0 + st * 50.0));
    gl_FragColor = vec4(col, 1.0); return;
  } else if (uMode > 6.5) {                    // textured banner
    vec2 uv = vLocal.xy + 0.5; uv.x = fract(uv.x * max(uRim.x, 1.0));
    vec4 t = texture2D(uTex, vec2(uv.x, 1.0 - uv.y));
    albedo = mix(vec3(0.02, 0.05, 0.09), t.rgb, t.a);
    emitCol = t.rgb * t.a * 1.2; spec = 0.0;
  }
  albedo = pow(albedo, vec3(2.2));

  float ndl = max(dot(N, uSunDir), 0.0);
  float sh = (ndl > 0.0 && uLite < 0.5) ? shadowTerm(ndl) : 1.0;
  vec3 amb = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);
  vec3 col = albedo * amb;
  col += albedo * uSunCol * ndl * sh;
  vec3 Hs = normalize(uSunDir + V);
  col += uSunCol * spec * pow(max(dot(N, Hs), 0.0), shin) * ndl * sh;
  float nl = uLite > 0.5 ? min(uNL, 3.0) : uNL;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= nl) break;
    vec3 L = uPL[i].xyz - vWorld; float d = length(L); L /= d;
    float att = clamp(1.0 - d / uPL[i].w, 0.0, 1.0); att *= att;
    float nd = max(dot(N, L), 0.0);
    col += albedo * uPLC[i] * nd * att;
    if (spec > 0.0 && uLite < 0.5) col += uPLC[i] * spec * pow(max(dot(N, normalize(L + V)), 0.0), shin) * att * nd;
  }
  float ndv = max(dot(N, V), 0.0);
  float fr = pow(1.0 - ndv, 4.0);
  if (spec > 0.0 && uLite < 0.5) col += envColor(reflect(-V, N)) * spec * (0.18 + 0.75 * fr);
  col += uRim * pow(1.0 - ndv, 3.0);
  col += pow(albedo, vec3(1.0)) * em + emitCol;
  float dist = length(uCam - vWorld);
  float ff = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, pow(uFog, vec3(2.2)), clamp(ff, 0.0, 0.85));
  gl_FragColor = vec4(tonemap(col), alpha);
}`;
const SVS = `attribute vec3 aPos; uniform mat4 uModel, uLightVP; varying float vD;
void main(){ vec4 p = uLightVP * uModel * vec4(aPos, 1.0); gl_Position = p; }`;
const SFS = `precision highp float;
vec4 pack(float d){ vec4 e = vec4(1.0, 255.0, 65025.0, 16581375.0) * d; e = fract(e); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); return e; }
void main(){ gl_FragColor = pack(gl_FragCoord.z); }`;
// particles / ribbons / decals
const PVS = `attribute vec3 aPos; attribute vec2 aUV; attribute vec4 aColor; attribute float aKind;
uniform mat4 uView, uProj; varying vec2 vUV; varying vec4 vColor; varying float vKind;
void main(){ vUV = aUV; vColor = aColor; vKind = aKind; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
const PFS = `precision mediump float; varying vec2 vUV; varying vec4 vColor; varying float vKind;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  vec2 c = vUV * 2.0 - 1.0; float r = length(c); float a;
  if (vKind < 0.5) a = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);                       // soft glow
  else if (vKind < 1.5) a = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.78, 1.0, r)); // ring
  else if (vKind < 2.5) { a = clamp(1.0 - r, 0.0, 1.0); a = a * a * (3.0 - 2.0 * a) * (0.8 + 0.2 * sin(vUV.x * 9.0 + vUV.y * 7.0)); }  // smoke puff
  else if (vKind < 3.5) a = 1.0 - smoothstep(0.55, 1.0, abs(c.x));                // ribbon (across)
  else a = 1.0;                                                                   // flat decal
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); return s; }
function program(vs, fs, attribs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let k = 0; k < n; k++) { const info = gl.getActiveUniform(p, k); const name = info.name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
const main = program(VS, FS, ['aPos', 'aNorm', 'aCol', 'aMat']);
const shadowProg = program(SVS, SFS, ['aPos']);
const partProg = program(PVS, PFS, ['aPos', 'aUV', 'aColor', 'aKind']);

// ------------------------------------------------------------------ state
const G = { gl, canvas, M4, PRIM, Builder, makeMesh, primMesh, PI, TAU, main, shadowProg, partProg, quality: 'high', W: 1, H: 1 };
// dpr: max device-pixel-ratio used; px: hardware-aware pixel budget; minScale: floor for automatic resolution scaling
const QUALITY = {
  low:    { dpr: 1.0, px: 2.1e6, minScale: 0.7,  shadow: 0,    pcf: 0, lights: 3, particles: 450,  crowdAnim: false, trails: false },
  medium: { dpr: 1.5, px: 3.7e6, minScale: 0.75, shadow: 1024, pcf: 1, lights: 6, particles: 1000, crowdAnim: true,  trails: true },
  high:   { dpr: 2.0, px: 8.3e6, minScale: 0.85, shadow: 2048, pcf: 2, lights: 8, particles: 2000, crowdAnim: true,  trails: true }
};
G.QUALITY = QUALITY;
G.q = QUALITY.high;
let shadowFB = null, shadowTex = null, shadowSize = 0, shadowRB = null;
G.setQuality = function (name) {
  if (!QUALITY[name]) name = 'high';
  G.quality = name; G.q = QUALITY[name];
  const s = G.q.shadow;
  if (s !== shadowSize) {
    if (shadowFB) { gl.deleteFramebuffer(shadowFB); gl.deleteTexture(shadowTex); gl.deleteRenderbuffer(shadowRB); shadowFB = shadowTex = shadowRB = null; }
    shadowSize = s;
    if (s) {
      shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, s, s, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      shadowRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, shadowRB); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, s, s);
      shadowFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowRB);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { shadowFB = null; shadowSize = 0; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
  G.resize(true);
};
G.scale = 1;          // automatic scale (only moves when resolution = AUTO)
G.userScale = 0;      // 0 = AUTO, otherwise a fixed render scale chosen by the player (0.5 .. 1.5)
G.resize = function (force) {
  const cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
  let ratio = Math.min(G.q.dpr, window.devicePixelRatio || 1) * (G.userScale || G.scale);
  const budget = G.userScale > 1 ? G.q.px * 1.6 : G.q.px;           // supersampling allowed a bit above the preset budget
  if (cw * ch * ratio * ratio > budget) ratio = Math.sqrt(budget / (cw * ch));
  const w = Math.max(1, Math.round(cw * ratio)), h = Math.max(1, Math.round(ch * ratio));
  if (force || canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  G.W = canvas.width; G.H = canvas.height;
};

// ------------------------------------------------------------------ lighting environment
const env = {
  sunDir: [0.30, 0.86, 0.41], sunCol: [0.85, 0.95, 1.2],
  sky: [0.42, 0.55, 0.75], ground: [0.13, 0.17, 0.25],
  fog: [0.02, 0.04, 0.09], fogDensity: 0.0042,
  lights: [],   // {x,y,z,range,r,g,b}
};
G.env = env;
const plPos = new Float32Array(32), plCol = new Float32Array(24);
const lightVP = new Float32Array(16), lightV = new Float32Array(16), lightP = new Float32Array(16);
const viewM = new Float32Array(16), projM = new Float32Array(16);
G.view = viewM; G.proj = projM; G.camPos = [0, 10, 10];
const cur = { prog: null };
const ID = M4.ident(new Float32Array(16));
let ballPts = null;
function makeBallPts() {
  const t = (1 + Math.sqrt(5)) / 2, a = [];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  // 12 icosahedron vertices (pentagon centres)
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { a.push(norm([0, s1, s2 * t])); a.push(norm([s1, s2 * t, 0])); a.push(norm([s2 * t, 0, s1])); }
  // 20 dodecahedron vertices (hexagon centres)
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) a.push(norm([x, y, z]));
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { a.push(norm([0, s1 / t, s2 * t])); a.push(norm([s1 / t, s2 * t, 0])); a.push(norm([s2 * t, 0, s1 / t])); }
  return new Float32Array(a.flat());
}

G.beginFrame = function (time, cam, fov, shadowCenter) {
  // projection / view
  M4.perspective(projM, fov, G.W / G.H, 0.3, 420);
  M4.lookAt(viewM, cam.ex, cam.ey, cam.ez, cam.tx, cam.ty, cam.tz, cam.ux || 0, cam.uy || 1, cam.uz || 0);
  G.camPos[0] = cam.ex; G.camPos[1] = cam.ey; G.camPos[2] = cam.ez;
  G.time = time;
  // light matrices (ortho around the arena)
  const R = 46, d = env.sunDir, c = [0, 0, 0]; void shadowCenter;   // fixed frustum: a moving centre made shadow edges shimmer
  M4.lookAt(lightV, c[0] + d[0] * 90, c[1] + d[1] * 90, c[2] + d[2] * 90, c[0], c[1], c[2], 0, 0, -1);
  M4.ortho(lightP, -R, R, -R, R, 1, 200);
  M4.mul(lightVP, lightP, lightV);
  // point lights
  const n = Math.min(env.lights.length, G.q.lights, 8);
  plPos.fill(0); plCol.fill(0);
  for (let i = 0; i < n; i++) { const L = env.lights[i]; plPos[i * 4] = L.x; plPos[i * 4 + 1] = L.y; plPos[i * 4 + 2] = L.z; plPos[i * 4 + 3] = L.range; plCol[i * 3] = L.r; plCol[i * 3 + 1] = L.g; plCol[i * 3 + 2] = L.b; }
  G.nLights = n;
};
G.useMain = function () {
  const u = main.u; gl.useProgram(main.p); cur.prog = main;
  gl.uniformMatrix4fv(u.uView, false, viewM); gl.uniformMatrix4fv(u.uProj, false, projM); gl.uniformMatrix4fv(u.uLightVP, false, lightVP);
  gl.uniform3fv(u.uCam, G.camPos); gl.uniform3fv(u.uSunDir, env.sunDir); gl.uniform3fv(u.uSunCol, env.sunCol);
  gl.uniform3fv(u.uSkyCol, env.sky); gl.uniform3fv(u.uGroundCol, env.ground); gl.uniform3fv(u.uFog, env.fog);
  gl.uniform1f(u.uFogDensity, env.fogDensity); gl.uniform1f(u.uTime, G.time);
  gl.uniform4fv(u.uPL, plPos); gl.uniform3fv(u.uPLC, plCol); gl.uniform1f(u.uNL, G.nLights);
  gl.uniform1f(u.uShadowOn, shadowFB ? 1 : 0); gl.uniform1f(u.uPCF, G.q.pcf); gl.uniform1f(u.uTexel, shadowSize ? 1 / shadowSize : 0);
  if (!ballPts) ballPts = makeBallPts();
  gl.uniform3fv(u.uBallPts, ballPts);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex || G.dummyTex); gl.uniform1i(u.uShadow, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.bannerTex || G.dummyTex); gl.uniform1i(u.uTex, 1);
  gl.activeTexture(gl.TEXTURE0);
  for (let k = 0; k < 4; k++) gl.enableVertexAttribArray(k);
  gl.uniform1f(u.uLite, 0); gl.uniform3f(u.uColor, 1, 1, 1); gl.uniform3f(u.uRim, 0, 0, 0); gl.uniform1f(u.uEmisMul, 1); gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uMode, 0);
  gl.uniformMatrix4fv(u.uModel, false, ID);
};
// material state for subsequent draws
G.lite = function (v) { gl.uniform1f(main.u.uLite, v); };
G.mat = function (r = 1, g = 1, b = 1, emis = 1, alpha = 1, mode = 0, rr = 0, rg = 0, rb = 0) {
  const u = main.u; gl.uniform3f(u.uColor, r, g, b); gl.uniform1f(u.uEmisMul, emis); gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uMode, mode); gl.uniform3f(u.uRim, rr, rg, rb);
};
G.draw = function (mesh, model) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE * 4, 24); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE * 4, 36);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
  gl.uniformMatrix4fv(cur.prog.u.uModel, false, model || ID);
  gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
};
// shadow pass: caller draws casters between begin/end
G.shadowBegin = function () {
  if (!shadowFB) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB); gl.viewport(0, 0, shadowSize, shadowSize);
  gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(shadowProg.p); cur.prog = shadowProg; gl.uniformMatrix4fv(shadowProg.u.uLightVP, false, lightVP);
  for (let k = 1; k < 4; k++) gl.disableVertexAttribArray(k);
  gl.enableVertexAttribArray(0); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
  return true;
};
G.shadowEnd = function () { gl.cullFace(gl.BACK); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, G.W, G.H); gl.clearColor(.01, .02, .05, 1); };

// dummy 1x1 texture so samplers are always valid
G.dummyTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.dummyTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
G.hasDeriv = HAS_DERIV;
window.G = G;
})();
