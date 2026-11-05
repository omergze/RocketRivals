'use strict';
// Rocket Rivals — authoritative 60 Hz match physics (shared by server + tests).

const RR = require('./public/shared.js');
const { SIDE, END, GOAL_W, GOAL_H, GOAL_DEPTH, BALL_R, CEIL, CHAMFER, GROUND_Y, TUNING, KICKOFF, PADS } = RR;
const GRAVITY = TUNING.gravity;
const MAX_BALL_SPEED = TUNING.ballMax;
const MATCH_LENGTH = Number(process.env.MATCH_LENGTH) || TUNING.matchLength;
const THROTTLE_MAX = TUNING.throttleMax;    // top speed without boost
const BOOST_MAX = TUNING.boostMax;
const DODGE_TIME = 0.45;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hyp2 = (x, z) => Math.hypot(x, z) || 1;
const wrapAngle = a => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const r3 = v => Math.round(v * 1000) / 1000;

function makeCar(index) {
  return {
    id: index, x: KICKOFF[index].x, y: GROUND_Y, z: KICKOFF[index].z,
    yaw: KICKOFF[index].yaw, pitch: 0, roll: 0,
    vx: 0, vy: 0, vz: 0, boost: TUNING.startBoost, grounded: true, jumps: 0,
    jumpTime: 0, jumpHold: 0, jumpQueued: false, dodge: 0, flipP: 0, flipR: 0, boostOn: false,
    input: { throttle: 0, steer: 0, boost: false, jump: false, handbrake: false, airRoll: 0 },
    score: 0
  };
}

function makeBall() {
  return { x: 0, y: BALL_R + 0.15, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0 };
}

// Push a round object (radius r) out of the 45° corner chamfers and side walls.
function arenaWalls(o, r, bounce) {
  if (o.x > SIDE - r) { o.x = SIDE - r; if (o.vx > 0) o.vx *= -bounce; }
  if (o.x < -SIDE + r) { o.x = -SIDE + r; if (o.vx < 0) o.vx *= -bounce; }
  const sx = o.x < 0 ? -1 : 1, sz = o.z < 0 ? -1 : 1;
  const d = Math.abs(o.x) + Math.abs(o.z) - (SIDE + END - CHAMFER - r * Math.SQRT2);
  if (d > 0) {
    o.x -= sx * d / 2; o.z -= sz * d / 2;
    const vn = (o.vx * sx + o.vz * sz) * Math.SQRT1_2;
    if (vn > 0) {
      o.vx -= sx * Math.SQRT1_2 * vn * (1 + bounce);
      o.vz -= sz * Math.SQRT1_2 * vn * (1 + bounce);
    }
  }
}

class Match {
  constructor() {
    this.cars = [makeCar(0), makeCar(1)];
    this.ball = makeBall();
    this.scores = [0, 0];
    this.pads = PADS.map(p => ({ id: p.id, x: p.x, z: p.z, amount: p.amount, cooldown: p.respawn, radius: p.radius, respawn: 0 }));
    this.hitSeq = 0; this.hitPower = 0; this.hitCar = -1; this.goalSeq = 0; this.goalTeam = -1;
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.remaining = MATCH_LENGTH;
    this.overtime = false;
    this.winner = -1;
    this.lastTouch = -1;
    this.celebration = '';
    this.seq = 0;
    this.finishAfterGoal = false;
  }
  start() {
    this.scores = [0, 0];
    this.cars.forEach(c => { c.score = 0; });
    this.remaining = MATCH_LENGTH;
    this.overtime = false;
    this.finishAfterGoal = false;
    this.winner = -1;
    this.pads.forEach(p => { p.respawn = 0; });
    this.resetKickoff();
    this.phase = 'countdown';
    this.phaseTimer = TUNING.countdown;
    this.celebration = '';
  }
  resetKickoff() {
    this.ball = makeBall();
    this.cars.forEach((car, index) => {
      const fresh = makeCar(index);
      fresh.score = car.score;
      fresh.input = car.input;
      Object.assign(car, fresh);
    });
    this.lastTouch = -1;
  }
  setInput(index, raw) {
    const c = this.cars[index];
    if (!c || !raw || typeof raw !== 'object') return;
    const jump = raw.jump === true;
    if (jump && !c.input.jump) c.jumpQueued = true;   // latch taps shorter than one tick
    c.input = {
      throttle: clamp(Number(raw.throttle) || 0, -1, 1),
      steer: clamp(Number(raw.steer) || 0, -1, 1),
      boost: raw.boost === true,
      jump,
      handbrake: raw.handbrake === true,
      airRoll: clamp(Number(raw.airRoll) || 0, -1, 1)
    };
  }
  step(dt, activePlayers = 2) {
    dt = clamp(dt, 0, 1 / 30);
    this.seq++;
    if (activePlayers < 2) { this.phase = 'waiting'; return; }
    if (this.phase === 'waiting') this.start();
    if (this.phase === 'finished') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { if (this.autoRestart === false) this.ended = true; else this.start(); }
      return;
    }
    if (this.phase === 'countdown') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { this.phase = 'playing'; this.phaseTimer = 0; }
      return;
    }
    const playing = this.phase === 'playing';
    if (this.phase === 'goal') {
      this.phaseTimer -= dt;
    } else if (!playing) return;
    for (const p of this.pads) p.respawn = Math.max(0, p.respawn - dt);
    for (const car of this.cars) this.moveCar(car, dt);
    this.collideCars(this.cars[0], this.cars[1]);
    this.moveBall(dt, playing);
    for (const car of this.cars) {
      this.collideCarBall(car);
      this.pickupBoost(car);
    }
    if (this.phase === 'goal') {
      if (this.phaseTimer <= 0) {
        if (this.finishAfterGoal) this.finish();
        else { this.resetKickoff(); this.phase = 'countdown'; this.phaseTimer = TUNING.countdown; }
      }
      return;
    }
    if (!this.overtime) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining <= 0) {
        if (this.scores[0] === this.scores[1]) { this.overtime = true; this.celebration = ''; }
        else this.finish();
      }
    }
  }
  finish() {
    this.phase = 'finished'; this.phaseTimer = TUNING.finishedPhase; this.finishAfterGoal = false;
    this.winner = this.scores[0] === this.scores[1] ? -1 : (this.scores[0] > this.scores[1] ? 0 : 1);
    this.celebration = this.winner < 0 ? 'DRAW!' : (this.winner === 0 ? 'BLUE WINS!' : 'ORANGE WINS!');
  }
  moveCar(c, dt) {
    const input = c.input;
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);   // forward (model nose points to -z at yaw 0)
    const rx = Math.cos(c.yaw), rz = Math.sin(c.yaw);    // right
    let fs = c.vx * fx + c.vz * fz;
    const ground = c.grounded;
    const boosting = input.boost && c.boost > 0;
    c.boostOn = boosting;
    if (boosting) c.boost = Math.max(0, c.boost - TUNING.boostDrain * dt);

    const jumpPressed = c.jumpQueued;
    c.jumpQueued = false;

    if (ground) {
      // --- steering: rate falls with speed, reverses when driving backwards
      const speedAbs = Math.abs(fs);
      const dir = speedAbs < 1 ? (input.throttle < -0.1 ? -1 : 1) : (fs < 0 ? -1 : 1);
      const rate = (3.1 - 1.6 * clamp(speedAbs / 29, 0, 1)) * (input.handbrake ? 1.45 : 1);
      c.yaw += input.steer * rate * clamp(speedAbs / 3, 0.3, 1) * dir * dt;
      // --- drive / brake / coast
      let accel = 0;
      const t = input.throttle;
      if (t !== 0) {
        if (t * fs < -0.5) accel = t * 60;                                    // braking
        else accel = t * TUNING.accel * Math.max(0, 1 - speedAbs / (t > 0 ? THROTTLE_MAX : THROTTLE_MAX * 0.78));
      } else if (!boosting) {
        accel = -Math.sign(fs) * Math.min(Math.abs(fs) / dt, 7);              // coast
      }
      if (boosting) accel += TUNING.boostAccel;
      const nfx = Math.sin(c.yaw), nfz = -Math.cos(c.yaw);                    // use the *updated* heading
      c.vx += nfx * accel * dt; c.vz += nfz * accel * dt;
      // --- tyre grip: kill sideways slip (drift with handbrake)
      const nrx = Math.cos(c.yaw), nrz = Math.sin(c.yaw);
      const side = c.vx * nrx + c.vz * nrz;
      const kill = side * clamp((input.handbrake ? 1.3 : 16) * dt, 0, 1);
      c.vx -= nrx * kill; c.vz -= nrz * kill;
      if (input.handbrake) { const k = Math.exp(-1.1 * dt); c.vx *= k; c.vz *= k; }
      c.vy = 0; c.y = GROUND_Y;
      c.pitch += (0 - c.pitch) * Math.min(1, dt * 12);
      c.roll += (0 - c.roll) * Math.min(1, dt * 12);
      if (jumpPressed) {
        c.vy = 10; c.grounded = false; c.jumps = 1; c.jumpTime = 0; c.jumpHold = 0;
      }
    } else {
      // --- airborne control
      c.jumpTime += dt;
      c.yaw += input.steer * 2.4 * dt;
      if (c.dodge > 0) {
        c.dodge = Math.max(0, c.dodge - dt);
        const prog = 1 - c.dodge / DODGE_TIME;
        c.pitch = c.flipP * prog; c.roll = c.flipR * prog;
        if (c.dodge === 0) { c.pitch = 0; c.roll = 0; }
      } else {
        c.pitch = clamp(c.pitch - input.throttle * 3.0 * dt, -1.35, 1.35);   // W = nose down, S = nose up
        c.roll = wrapAngle(c.roll + input.airRoll * 3.0 * dt);
      }
      // holding jump right after take-off gives a higher jump
      if (c.jumps === 1 && input.jump && c.jumpHold < 0.2 && c.dodge === 0) {
        c.vy += 12 * dt; c.jumpHold += dt;
      } else if (!input.jump) c.jumpHold = 1;
      if (jumpPressed && c.jumps === 1 && c.jumpTime < 1.25) {
        const f = input.throttle, s = input.steer;
        c.jumps = 2; c.jumpHold = 1;
        if (Math.abs(f) + Math.abs(s) < 0.2) {
          c.vy = Math.max(c.vy, 0) + 9.5;                                      // plain double jump
        } else {
          const ix = fx * f + rx * s, iz = fz * f + rz * s, len = hyp2(ix, iz);
          const fn = clamp(f / (Math.hypot(f, s) || 1), -1, 1), sn = clamp(s / (Math.hypot(f, s) || 1), -1, 1);
          c.vx += ix / len * 13; c.vz += iz / len * 13;
          c.vy = Math.max(c.vy, 0) + 3.0;
          c.dodge = DODGE_TIME; c.flipP = -fn * Math.PI * 2; c.flipR = -sn * Math.PI * 2;
        }
      }
      if (boosting) {
        const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
        c.vx += fx * cp * 60 * dt; c.vz += fz * cp * 60 * dt; c.vy += sp * 60 * dt;
      }
      c.vy -= GRAVITY * dt;
      const drag = Math.exp(-0.05 * dt);
      c.vx *= drag; c.vz *= drag;
    }
    // --- speed limits
    const speed = hyp2(c.vx, c.vz);
    const cap = boosting ? BOOST_MAX : THROTTLE_MAX;
    if (speed > cap) {
      const target = ground ? Math.max(cap, speed - (speed - cap) * Math.min(1, 1.6 * dt) - 0.2 * dt) : Math.min(speed, BOOST_MAX);
      const k = (boosting ? Math.min(speed, BOOST_MAX) : target) / speed;
      c.vx *= k; c.vz *= k;
    }

    c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    if (!c.grounded && c.y <= GROUND_Y && c.vy <= 0) {
      c.y = GROUND_Y; c.vy = 0; c.grounded = true; c.jumps = 0; c.dodge = 0; c.jumpTime = 0;
    }
    if (c.y > CEIL - 0.6) { c.y = CEIL - 0.6; if (c.vy > 0) c.vy *= -0.2; }
    this.carWalls(c);
  }
  carWalls(c) {
    const R = 1.1;
    if (c.x > SIDE - R) { c.x = SIDE - R; if (c.vx > 0) c.vx *= -0.25; }
    if (c.x < -SIDE + R) { c.x = -SIDE + R; if (c.vx < 0) c.vx *= -0.25; }
    for (const s of [-1, 1]) {
      const zs = c.z * s;
      if (zs > END - R) {
        if (zs > END) {
          const lim = GOAL_W / 2 - 0.95;                       // already inside the goal pocket
          if (c.x > lim) { c.x = lim; if (c.vx > 0) c.vx *= -0.25; }
          if (c.x < -lim) { c.x = -lim; if (c.vx < 0) c.vx *= -0.25; }
          if (zs > END + GOAL_DEPTH - 1.4) { c.z = s * (END + GOAL_DEPTH - 1.4); if (c.vz * s > 0) c.vz *= -0.25; }
          if (c.y > GOAL_H - 0.6) { c.y = GOAL_H - 0.6; if (c.vy > 0) c.vy = 0; }
        } else if (!(Math.abs(c.x) < GOAL_W / 2 - 0.9 && c.y < GOAL_H - 0.4)) {
          c.z = s * (END - R); if (c.vz * s > 0) c.vz *= -0.25;
        }
      }
    }
    arenaWalls(c, R, 0.25);
  }
  collideCars(a, b) {
    if (Math.abs(a.y - b.y) > 1.3) return;
    const dx = b.x - a.x, dz = b.z - a.z;
    const distance = hyp2(dx, dz);
    if (distance >= 3.1) return;
    const nx = dx / distance, nz = dz / distance, push = (3.1 - distance) * 0.5;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
    const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rel < 0) {
      const j = -(1 + 0.45) * rel * 0.5;
      a.vx -= nx * j; a.vz -= nz * j;
      b.vx += nx * j; b.vz += nz * j;
    }
  }
  moveBall(dt, scoring) {
    const b = this.ball;
    b.vy -= GRAVITY * dt;
    const air = Math.exp(-0.03 * dt);
    b.vx *= air; b.vy *= air; b.vz *= air;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.rx += b.vz * dt / BALL_R; b.rz -= b.vx * dt / BALL_R;

    if (b.y < BALL_R) {
      b.y = BALL_R;
      if (b.vy < 0) { b.vy = -b.vy * 0.6; if (b.vy < 1.6) b.vy = 0; }
      const f = Math.exp(-0.4 * dt); b.vx *= f; b.vz *= f;       // rolling resistance
    }
    if (b.y > CEIL - BALL_R) { b.y = CEIL - BALL_R; if (b.vy > 0) b.vy *= -0.6; }

    for (const s of [-1, 1]) {
      // goal posts + crossbar (before the back wall so shots can ricochet off them)
      for (const xp of [-GOAL_W / 2, GOAL_W / 2]) {
        if (b.y < GOAL_H + 0.2) {
          const dx = b.x - xp, dz = b.z - s * END, dist = hyp2(dx, dz), lim = BALL_R + 0.3;
          if (dist < lim) {
            const nx = dx / dist, nz = dz / dist;
            b.x += nx * (lim - dist); b.z += nz * (lim - dist);
            const vn = b.vx * nx + b.vz * nz;
            if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; }
          }
        }
      }
      if (Math.abs(b.x) < GOAL_W / 2) {
        const dy = b.y - GOAL_H, dz = b.z - s * END, dist = hyp2(dy, dz), lim = BALL_R + 0.25;
        if (dist < lim) {
          const ny = dy / dist, nz = dz / dist;
          b.y += ny * (lim - dist); b.z += nz * (lim - dist);
          const vn = b.vy * ny + b.vz * nz;
          if (vn < 0) { b.vy -= 1.6 * vn * ny; b.vz -= 1.6 * vn * nz; }
        }
      }
      const zs = b.z * s;
      const inMouth = Math.abs(b.x) < GOAL_W / 2 && b.y < GOAL_H;
      if (zs > END - BALL_R) {
        if (inMouth) {
          if (zs > END - 0.3) {
          // inside the goal pocket: side nets, roof net, back net
          const lim = GOAL_W / 2 - BALL_R;
          if (b.x > lim) { b.x = lim; if (b.vx > 0) b.vx *= -0.4; }
          if (b.x < -lim) { b.x = -lim; if (b.vx < 0) b.vx *= -0.4; }
          if (b.y > GOAL_H - BALL_R) { b.y = GOAL_H - BALL_R; if (b.vy > 0) b.vy *= -0.4; }
          if (zs > END + GOAL_DEPTH - BALL_R) { b.z = s * (END + GOAL_DEPTH - BALL_R); if (b.vz * s > 0) b.vz *= -0.35; }
          }
        } else if (zs < END + 0.5) {
          b.z = s * (END - BALL_R);
          if (b.vz * s > 0) { b.vz *= -0.75; }
        }
      }
      if (scoring && this.phase === 'playing' && zs > END + BALL_R && inMouth) {
        const team = s === 1 ? 1 : 0;
        this.scores[team]++; this.cars[team].score++;
        this.phase = 'goal'; this.phaseTimer = TUNING.goalPhase; this.goalSeq++; this.goalTeam = team;
        this.celebration = team === 1 ? 'ORANGE SCORES!' : 'BLUE SCORES!';
        if (this.overtime) { this.finishAfterGoal = true; this.celebration = team === 1 ? 'ORANGE WINS!' : 'BLUE WINS!'; }
        return;
      }
    }
    if (b.x > SIDE - BALL_R) { b.x = SIDE - BALL_R; if (b.vx > 0) b.vx *= -0.72; }
    if (b.x < -SIDE + BALL_R) { b.x = -SIDE + BALL_R; if (b.vx < 0) b.vx *= -0.72; }
    arenaWalls(b, BALL_R, 0.72);
    const total = Math.hypot(b.vx, b.vy, b.vz);
    if (total > MAX_BALL_SPEED) { const f = MAX_BALL_SPEED / total; b.vx *= f; b.vy *= f; b.vz *= f; }
  }
  collideCarBall(c) {
    const b = this.ball;
    const dx = b.x - c.x, dz = b.z - c.z, dy = b.y - c.y;
    if (Math.abs(dx) > 3.8 || Math.abs(dz) > 3.8 || Math.abs(dy) > 2.6) return;
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    // ball centre in car-local space (x = right, z = back)
    const lx = dx * co + dz * si;
    const lz = dx * si - dz * co;
    const qx = clamp(lx, -0.99, 0.99);
    const qz = clamp(lz, -1.75, 1.75);
    const qy = clamp(dy, -0.5, 0.6);
    let nxL = lx - qx, nzL = lz - qz, ny = dy - qy;
    let dist = Math.hypot(nxL, nzL, ny);
    if (dist >= BALL_R) return;
    if (dist < 0.001) { nxL = 0; nzL = 0; ny = 1; dist = 1; }
    // local -> world (inverse of the transform above)
    const nx = (nxL * co + nzL * si) / dist;
    const nz = (nxL * si - nzL * co) / dist;
    const nyw = ny / dist;
    const push = BALL_R - dist + 0.01;
    b.x += nx * push; b.z += nz * push; b.y += nyw * push;
    if (b.y < BALL_R) b.y = BALL_R;
    const rel = (c.vx - b.vx) * nx + (c.vy - b.vy) * nyw + (c.vz - b.vz) * nz;
    if (rel > 0) {
      // flatten the contact normal a bit (like RL) so hits pop the ball up instead of just forward
      let hx = nx, hy = nyw * 0.6, hz = nz;
      const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      const carSpeed = Math.hypot(c.vx, c.vz);
      const power = rel * 1.55 + 0.9 + carSpeed * 0.1 + (c.boostOn ? 2.2 : 0) + (c.dodge > 0 ? 5 : 0);
      b.vx += hx * power; b.vy += hy * power; b.vz += hz * power;
      this.hitSeq++; this.hitPower = Math.round(power * 10) / 10; this.hitCar = c.id;
      c.vx -= hx * power * 0.03; c.vz -= hz * power * 0.03;
    }
    this.lastTouch = c.id;
    const len = Math.hypot(b.vx, b.vy, b.vz);
    if (len > MAX_BALL_SPEED) { const f = MAX_BALL_SPEED / len; b.vx *= f; b.vy *= f; b.vz *= f; }
  }
  pickupBoost(c) {
    for (const p of this.pads) {
      if (p.respawn <= 0 && c.boost < 99.5 && Math.hypot(c.x - p.x, c.z - p.z) < p.radius && c.y < 2.5) {
        c.boost = Math.min(100, c.boost + p.amount);
        p.respawn = p.cooldown;
      }
    }
  }
  snapshot() {
    const b = this.ball;
    return {
      type: 'state', phase: this.phase, phaseTimer: r3(Math.max(0, this.phaseTimer)),
      remaining: r3(this.remaining), overtime: this.overtime, scores: this.scores, winner: this.winner,
      celebration: this.celebration, lastTouch: this.lastTouch, seq: this.seq,
      hit: [this.hitSeq, this.hitPower, this.hitCar], goal: [this.goalSeq, this.goalTeam],
      ball: { x: r3(b.x), y: r3(b.y), z: r3(b.z), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz), rx: r3(b.rx), rz: r3(b.rz) },
      cars: this.cars.map(c => ({
        id: c.id, x: r3(c.x), y: r3(c.y), z: r3(c.z), yaw: r3(c.yaw), pitch: r3(c.pitch), roll: r3(c.roll),
        vx: r3(c.vx), vy: r3(c.vy), vz: r3(c.vz), boost: Math.round(c.boost), boostOn: c.boostOn,
        grounded: c.grounded, score: c.score, jumps: c.jumps, dodge: c.dodge > 0
      })),
      pads: this.pads.map(p => (p.respawn <= 0 ? '1' : '0')).join('')
    };
  }
}

// ---------------------------------------------------------------- bot AI
function botThink(game, index) {
  const c = game.cars[index], b = game.ball;
  const atk = index === 0 ? -1 : 1;                       // goal this car attacks (z sign)
  const inp = { throttle: 0, steer: 0, boost: false, jump: false, handbrake: false, airRoll: 0 };
  if (game.phase !== 'playing' && game.phase !== 'goal') { game.setInput(index, inp); return; }
  const speed = Math.hypot(c.vx, c.vz);
  const dist = Math.hypot(b.x - c.x, b.z - c.z);
  const lead = clamp(dist / 30, 0, 0.7);
  const bx = b.x + b.vx * lead, bz = b.z + b.vz * lead;
  // stand behind the ball relative to the enemy goal
  let gx = -bx, gz = atk * END - bz;
  const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
  const behindDot = (bx - c.x) * gx + (bz - c.z) * gz;
  const lateral = Math.abs((bx - c.x) * gz - (bz - c.z) * gx);
  let tx = bx, tz = bz;
  if (behindDot < 1.5 || lateral > 3.5 + dist * 0.25) { tx = bx - gx * 4.2; tz = bz - gz * 4.2; }
  // when the ball is behind the bot and close to own goal, retreat to defend
  if ((bz - c.z) * atk < -2 && Math.abs(bz) > 8) { tx = clamp(bx, -5, 5); tz = -atk * (END - 6); }
  // boost management: detour to a pad when low (large pads count as closer) and the ball is not close
  if (c.grounded && game.phase === 'playing') {
    const hungry = c.boost < 45 && dist > 14, snack = c.boost < 75 && dist > 10;
    if (hungry || snack) {
      let best = null, bd = Infinity;
      for (const p of game.pads) {
        if (p.respawn > 0.6) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z) * (p.amount >= 100 ? 0.55 : 1);
        if (d < bd && d < (hungry ? 45 : 9)) { bd = d; best = p; }
      }
      if (best) { tx = best.x; tz = best.z; }
    }
  }
  const want = Math.atan2(tx - c.x, -(tz - c.z));
  const diff = wrapAngle(want - c.yaw);
  const tdist = Math.hypot(tx - c.x, tz - c.z);
  if (Math.abs(diff) > 2.5 && tdist < 14 && speed < 14) {
    inp.throttle = -1; inp.steer = -clamp(wrapAngle(diff - Math.PI) * 2.5, -1, 1);   // quick reverse turn
  } else {
    inp.throttle = 1; inp.steer = clamp(diff * 3, -1, 1);
    inp.handbrake = Math.abs(diff) > 1.3 && speed > 11;
    inp.boost = Math.abs(diff) < 0.25 && tdist > 10 && c.boost > 15 && c.grounded;
  }
  if (c.grounded && dist < 6.5 && b.y > 2.8 && Math.abs(diff) < 0.6) inp.jump = true;
  if (c.grounded && dist < 3.4 && b.y > 1.5 && Math.abs(diff) < 0.5) inp.jump = true;
  if (!c.grounded) {
    if (c.jumps === 1 && c.jumpTime > 0.12 && dist < 5.5) { inp.jump = true; inp.throttle = 1; inp.steer = 0; }
    if (b.y > c.y + 1 && dist < 12) inp.boost = c.boost > 10;
  }
  game.setInput(index, inp);
}

module.exports = { Match, botThink, makeBall, makeCar, SIDE, END, GOAL_W, GOAL_H, BALL_R, MATCH_LENGTH, CHAMFER, TUNING };
