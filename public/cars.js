/* Rocket Rivals — stylised sports car + soccer ball: meshes, suspension, wheels, exhaust/drift/landing effects. */
(() => {
'use strict';
const G = window.G, FX = window.FX; if (!G || !FX) return;
const { Builder, PRIM, M4, gl } = G;
const PI = Math.PI;
const t = new Float32Array(16), m1 = new Float32Array(16), m2 = new Float32Array(16), parent = new Float32Array(16);
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const box = (b, x, y, z, sx, sy, sz, c, em = 0, spec = 0.3, yaw = 0, pitch = 0, roll = 0) => { M4.compose(t, x, y, z, yaw, pitch, roll, sx, sy, sz); b.add(PRIM.box, t, c, em, spec); };
const cyl = (b, x, y, z, r, h, c, em, spec, pitch, roll, yaw = 0, prim = PRIM.cylLo) => { M4.compose(t, x, y, z, yaw, pitch, roll, r, h, r); b.add(prim, t, c, em, spec); };
const dim = (c, k) => c.map(v => Math.min(1, v * k));

const TEAMS = [
  { paint: hex('#1673e6'), paint2: hex('#0b3f94'), light: hex('#7fd8ff'), glow: [0.25, 0.7, 1.0], name: 'blue' },
  { paint: hex('#f2680c'), paint2: hex('#8f3305'), light: hex('#ffc27a'), glow: [1.0, 0.5, 0.12], name: 'orange' }
];
const WHEELS = [[-1.02, -0.2, -1.22], [1.02, -0.2, -1.22], [-1.02, -0.2, 1.2], [1.02, -0.2, 1.2]];   // front wheels first (nose = -z)
const EXHAUST = [[-0.44, -0.04, 2.0], [0.44, -0.04, 2.0]];

function buildCar(team) {
  const b = new Builder(), P = team.paint, P2 = team.paint2, L = team.light;
  const body = [
    { z: -2.0, w: 0.50, yb: -0.30, yt: -0.08, n: 2.8 }, { z: -1.82, w: 0.82, yb: -0.34, yt: 0.06, n: 2.8 }, { z: -1.45, w: 0.98, yb: -0.36, yt: 0.17, n: 3 },
    { z: -0.8, w: 1.03, yb: -0.36, yt: 0.25, n: 3 }, { z: 0.3, w: 1.04, yb: -0.36, yt: 0.28, n: 3 }, { z: 1.2, w: 1.02, yb: -0.35, yt: 0.31, n: 3 },
    { z: 1.75, w: 0.96, yb: -0.32, yt: 0.34, n: 3 }, { z: 2.0, w: 0.78, yb: -0.27, yt: 0.30, n: 2.8 }
  ];
  b.add(PRIM.loft(body, 36), null, P, 0.05, 0.9);
  const cab = [
    { z: -0.55, w: 0.60, yb: 0.2, yt: 0.30, n: 2.6 }, { z: -0.15, w: 0.74, yb: 0.2, yt: 0.62, n: 2.6 }, { z: 0.45, w: 0.74, yb: 0.2, yt: 0.74, n: 2.6 },
    { z: 1.0, w: 0.70, yb: 0.2, yt: 0.62, n: 2.6 }, { z: 1.35, w: 0.54, yb: 0.2, yt: 0.34, n: 2.6 }
  ];
  b.add(PRIM.loft(cab, 30), null, hex('#08111f'), 0.02, 1.0);
  const roof = [{ z: -0.05, w: 0.50, yb: 0.66, yt: 0.70, n: 3 }, { z: 0.3, w: 0.52, yb: 0.70, yt: 0.78, n: 3 }, { z: 0.85, w: 0.48, yb: 0.64, yt: 0.70, n: 3 }];
  b.add(PRIM.loft(roof, 22), null, P2, 0.05, 0.9);
  // hood / roof racing stripe
  box(b, 0, 0.255, -0.95, 0.34, 0.025, 1.5, L, 0.35, 0.6); box(b, 0, 0.30, 0.9, 0.34, 0.025, 1.1, L, 0.35, 0.6);
  // lights
  for (const sx of [-1, 1]) {
    box(b, sx * 0.64, 0.02, -1.78, 0.46, 0.11, 0.14, [1, 1, 1], 3.6, 0.9, sx * 0.25);
    box(b, sx * 0.64, -0.1, -1.82, 0.40, 0.035, 0.1, [0.6, 0.9, 1], 2.5, 0.5, sx * 0.25);
    box(b, sx * 0.62, 0.17, 1.93, 0.52, 0.12, 0.08, [1, 0.05, 0.05], 3.0, 0.6, -sx * 0.15);
    cyl(b, sx * 0.44, -0.05, 2.04, 0.12, 0.22, [0.7, 0.72, 0.78], 0, 1, PI / 2, 0);       // exhaust tips
    cyl(b, sx * 0.44, -0.05, 2.15, 0.07, 0.05, [0.1, 0.05, 0.03], 0, 0, PI / 2, 0);
    box(b, sx * 1.02, -0.33, 0.0, 0.13, 0.13, 2.5, [0.05, 0.07, 0.1], 0, 0.3);              // side skirts
    box(b, sx * 1.09, -0.3, 0.0, 0.03, 0.035, 2.3, team.light, 2.0, 0);                       // neon accent
    box(b, sx * 0.62, 0.3, -0.4, 0.14, 0.1, 0.18, P2, 0, 0.8, sx * 0.2);                       // mirrors
    box(b, sx * 0.62, 0.62, 1.74, 0.06, 0.38, 0.22, [0.08, 0.1, 0.14], 0, 0.4);              // spoiler uprights
    box(b, sx * 0.96, 0.78, 1.8, 0.05, 0.28, 0.6, P2, 0.2, 0.7);                              // end plates
  }
  box(b, 0, 0.8, 1.8, 2.0, 0.07, 0.55, P, 0.12, 0.9);                                         // wing
  box(b, 0, 0.84, 1.55, 1.9, 0.035, 0.1, L, 1.4, 0);                                          // wing leading-edge glow
  box(b, 0, 0.17, 1.96, 0.1, 0.1, 0.06, [1, 0.05, 0.05], 2.5, 0.3);
  box(b, 0, -0.34, -1.9, 1.7, 0.07, 0.5, [0.04, 0.05, 0.08], 0, 0.3);                         // splitter
  box(b, 0, -0.33, 1.9, 1.5, 0.08, 0.4, [0.04, 0.05, 0.08], 0, 0.3);                          // diffuser
  box(b, 0, 0.0, -1.9, 0.5, 0.06, 0.05, [1, 1, 1], 1.5, 0.2);                                  // front grille light bar
  const car = b.build();
  // team-coloured number plate stripes on doors
  return car;
}
function buildWheel() {
  const b = new Builder();
  cyl(b, 0, 0, 0, 0.47, 0.38, [0.025, 0.027, 0.032], 0, 0.15, 0, PI / 2, 0, PRIM.cylHi);       // tyre
  cyl(b, 0, 0, 0, 0.33, 0.405, [0.78, 0.82, 0.9], 0.05, 1.0, 0, PI / 2, 0, PRIM.cylHi);         // rim
  cyl(b, 0, 0, 0, 0.17, 0.43, [0.12, 0.14, 0.2], 0, 0.8, 0, PI / 2, 0, PRIM.cyl);             // hub
  for (let k = 0; k < 3; k++) box(b, 0, 0, 0, 0.44, 0.07, 0.62, [0.95, 0.97, 1.0], 0.1, 1.0, 0, k * PI / 3, 0);
  return b.build();
}
const CAR_MESHES = [buildCar(TEAMS[0]), buildCar(TEAMS[1])];
const WHEEL = buildWheel();
const FLAME_MESH = G.primMesh(PRIM.cone, [1, 1, 1], 1, 0);
const DISC = G.primMesh(PRIM.sphere, [1, 1, 1], 1, 0);

// ------------------------------------------------------------------ per-car dynamic state
function createState() {
  return { spin: 0, steer: 0, prevYaw: null, prevSF: 0, prevVy: 0, yawRate: 0, aL: 0, pitchS: 0, rollS: 0, bounce: 0, bounceV: 0,
    grounded: true, trailL: FX.createTrail(), trailR: FX.createTrail(), mark: [null, null], smokeT: 0, flame: Math.random() * 10, boostT: 0, dodgeFx: 0, lastPitch: 0 };
}
function exhaustWorld(c, ex, out) {      // exhaust local -> world (yaw + pitch)
  const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw), cp = Math.cos(c.pitch || 0), sp = Math.sin(c.pitch || 0);
  const lx = ex[0], ly = ex[1] * cp - ex[2] * sp, lz = ex[1] * sp + ex[2] * cp;
  out[0] = c.x + cy * lx + sy * lz; out[1] = c.y + ly; out[2] = c.z - sy * lx + cy * lz;
}
const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
const wrap = a => ((a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;

// advance suspension + spawn effects. c = smoothed render car, raw = last server car (velocity, grounded)
function update(s, c, raw, dt, time, teamIdx, listener) {
  if (!raw) return;
  const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw), rxv = Math.cos(c.yaw), rzv = Math.sin(c.yaw);
  const vx = raw.vx || 0, vz = raw.vz || 0, vy = raw.vy || 0;
  const sf = vx * fx + vz * fz, lat = vx * rxv + vz * rzv, speed = Math.hypot(vx, vz);
  if (s.prevYaw === null) { s.prevYaw = c.yaw; s.prevSF = sf; }
  const yr = dt > 0 ? wrap(c.yaw - s.prevYaw) / dt : 0; s.prevYaw = c.yaw;
  s.yawRate += (yr - s.yawRate) * Math.min(1, dt * 10);
  const aL = dt > 0 ? (sf - s.prevSF) / dt : 0; s.prevSF = sf; s.aL += (Math.max(-70, Math.min(70, aL)) - s.aL) * Math.min(1, dt * 6);
  s.spin -= sf / 0.47 * dt;
  const steerTarget = Math.max(-0.5, Math.min(0.5, s.yawRate * 0.22)) * (raw.grounded ? 1 : 0.3);
  s.steer += (steerTarget - s.steer) * Math.min(1, dt * 12);
  const pT = raw.grounded ? Math.max(-0.09, Math.min(0.09, s.aL * 0.0028)) : 0;
  const rT = raw.grounded ? Math.max(-0.1, Math.min(0.1, s.yawRate * sf * 0.0016)) : 0;
  s.pitchS += (pT - s.pitchS) * Math.min(1, dt * 9); s.rollS += (rT - s.rollS) * Math.min(1, dt * 9);
  // landing impact
  if (raw.grounded && !s.grounded) {
    const impact = Math.max(0, -s.prevVy);
    s.bounceV -= Math.min(2.2, impact * 0.16);
    if (impact > 3) {
      const n = Math.min(14, 4 + impact * 0.6);
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, sp = 2 + Math.random() * 3 + impact * 0.1; FX.spawn(2, c.x + Math.cos(a) * 0.9, 0.2, c.z + Math.sin(a) * 0.9, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp, 0.55 + Math.random() * 0.3, 0.35, 1.2, 0.55, 0.6, 0.7, 0.35, false, 2.5, -1); }
      FX.shockwave(c.x, 0.1, c.z, 2.2 + impact * 0.12, TEAMS[teamIdx].glow, 0.4);
      if (listener) listener.landed(impact, c);
    }
  }
  s.grounded = raw.grounded; s.prevVy = vy;
  s.bounceV += (-s.bounce * 140 - s.bounceV * 11) * dt; s.bounce += s.bounceV * dt;
  s.bounce = Math.max(-0.2, Math.min(0.12, s.bounce));

  // ---- boost exhaust flames, sparks, ribbon trails
  s.flame += dt * 40;
  if (c.boostOn) {
    s.boostT = Math.min(1, s.boostT + dt * 8);
    for (let k = 0; k < 2; k++) {
      exhaustWorld(c, EXHAUST[k], tmp);
      const back = -1; const bvx = fx * 6 * back - vx * 0.1, bvz = fz * 6 * back - vz * 0.1;
      if (G.q.particles > 600 || Math.random() < 0.6) {
        FX.spawn(0, tmp[0], tmp[1], tmp[2], bvx + (Math.random() - .5) * 1.5, (Math.random() - .5) * 1.2, bvz + (Math.random() - .5) * 1.5, 0.28, 0.5, 0.12, 1.0, 0.55 + Math.random() * 0.25, 0.1, 0.9, true, 3);
        if (Math.random() < 0.5) FX.spawn(0, tmp[0], tmp[1], tmp[2], bvx * 1.5 + (Math.random() - .5) * 3, Math.random() * 1.5, bvz * 1.5 + (Math.random() - .5) * 3, 0.4, 0.2, 0.05, 1, 0.8, 0.4, 1, true, 1.5, 6);
      }
      FX.trailPush(k ? s.trailR : s.trailL, tmp[0], tmp[1], tmp[2], time);
    }
  } else {
    s.boostT = Math.max(0, s.boostT - dt * 6);
  }
  // ---- drift smoke + tyre marks
  const slip = Math.abs(lat) > 3.2 && raw.grounded && speed > 5;
  for (let k = 0; k < 2; k++) {
    const wx = WHEELS[2 + k]; const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw);
    const px = c.x + cy * wx[0] + sy * wx[2], pz = c.z - sy * wx[0] + cy * wx[2];
    if (slip) {
      if (s.mark[k]) FX.decal(s.mark[k][0], s.mark[k][1], px, pz, 0.34, time);
      s.mark[k] = [px, pz];
      if (Math.random() < Math.min(1, dt * 40)) FX.spawn(2, px, 0.25, pz, -vx * 0.15 + (Math.random() - .5), 0.8 + Math.random() * 0.6, -vz * 0.15 + (Math.random() - .5), 0.7 + Math.random() * 0.4, 0.5, 1.9, 0.62, 0.66, 0.72, 0.32, false, 1.6, 0);
    } else s.mark[k] = null;
  }
}

// ------------------------------------------------------------------ drawing (opaque part)
function drawCar(s, c, teamIdx, time, shadowPass) {
  const y = c.y + (shadowPass ? 0 : s.bounce);
  M4.compose(parent, c.x, y, c.z, -c.yaw, (c.pitch || 0) + (shadowPass ? 0 : s.pitchS), (c.roll || 0) + (shadowPass ? 0 : s.rollS), 1, 1, 1);
  if (!shadowPass) G.mat(1, 1, 1, 1, 1, 0);
  for (const mesh of CAR_MESHES[teamIdx]) G.draw(mesh, parent);
  for (let k = 0; k < 4; k++) {
    const w = WHEELS[k];
    const bump = shadowPass ? 0 : -s.bounce * 0.5;
    M4.compose(m1, w[0], w[1] + bump, w[2], k < 2 ? -s.steer : 0, s.spin, 0, 1, 1, 1);
    M4.mul(m2, parent, m1);
    for (const mesh of WHEEL) G.draw(mesh, m2);
  }
}
// additive pass: flames, underglow, headlight cones
function drawGlow(s, c, teamIdx, time) {
  const team = TEAMS[teamIdx];
  M4.compose(parent, c.x, c.y + s.bounce, c.z, -c.yaw, (c.pitch || 0) + s.pitchS, (c.roll || 0) + s.rollS, 1, 1, 1);
  if (s.boostT > 0.02) {
    for (let k = 0; k < 2; k++) {
      const flick = 0.85 + 0.3 * Math.sin(s.flame + k * 2.1) * Math.sin(s.flame * 1.7);
      const len = (2.7 + 1.2 * flick) * s.boostT, w = 0.36 * (0.8 + 0.2 * flick);
      for (const [lw, ll, r, g, b, a] of [[1.0, 1.0, 1.0, 0.42, 0.05, 0.55], [0.6, 0.8, 1.0, 0.8, 0.3, 0.8], [0.3, 0.6, 0.8, 0.95, 1.0, 0.95]]) {
        // cone points along +z (behind the car): cone prim is along +Y, so pitch it 90deg
        M4.compose(m1, EXHAUST[k][0], EXHAUST[k][1], EXHAUST[k][2] + len * ll * 0.5 + 0.1, 0, PI / 2, 0, w * lw, len * ll, w * lw);
        M4.mul(m2, parent, m1);
        G.mat(r, g, b, 2.2, a * s.boostT, 0); G.draw(FLAME_MESH, m2);
      }
    }
  }
  // underglow
  M4.compose(m1, 0, -0.55, 0, 0, 0, 0, 1.6, 0.04, 2.5); M4.mul(m2, parent, m1);
  G.mat(team.glow[0], team.glow[1], team.glow[2], 2.0, 0.28 + 0.2 * s.boostT, 0); G.draw(DISC, m2);
}
function lightsFx(c, teamIdx) {   // billboard halos for head/tail lights
  const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw);
  for (const sx of [-1, 1]) {
    const lx = sx * 0.64, lz = -1.9, hx = c.x + cy * lx + sy * lz, hz = c.z - sy * lx + cy * lz;
    FX.glow(hx, c.y + 0.02, hz, 0.75, 0.9, 0.95, 1, 0.55);
    const tx = sx * 0.62, tz = 2.0, qx = c.x + cy * tx + sy * tz, qz = c.z - sy * tx + cy * tz;
    FX.glow(qx, c.y + 0.17, qz, 0.5, 1, 0.1, 0.08, 0.5);
  }
}

// ------------------------------------------------------------------ ball
const BALL = G.primMesh(PRIM.sphere, [1, 1, 1], 0, 0.9);
const _bm = new Float32Array(16);
function drawBall(b, R, teamTint, shadowPass) {
  M4.compose(_bm, b.x, b.y, b.z, 0, b.rx || 0, b.rz || 0, R, R, R);
  if (!shadowPass) G.mat(1, 1, 1, 1, 1, 1, teamTint[0], teamTint[1], teamTint[2]);
  G.draw(BALL, _bm);
}
window.Cars = { TEAMS, createState, update, drawCar, drawGlow, lightsFx, drawBall, exhaustWorld, WHEELS };
})();
