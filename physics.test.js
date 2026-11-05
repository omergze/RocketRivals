const assert = require('assert');
const { Match, botThink } = require('../match');
const RR = require('../public/shared.js');
const { SIDE, END, GOAL_W, GOAL_H, BALL_R, PADS, TUNING, KICKOFF } = RR;
const fresh = () => { const m = new Match(); m.start(); m.phase = 'playing'; return m; };
const run = (m, s, f) => { for (let i = 0; i < Math.round(s * 60); i++) { f && f(i); m.step(1 / 60, 2); } };
const tap = (m, i, extra = {}) => { m.setInput(i, { ...extra, jump: true }); m.setInput(i, { ...extra, jump: false }); };
let m;

// ---- arena geometry
assert(SIDE * 2 >= 34 * 1.3 && END * 2 >= 50 * 1.3, 'arena is at least 30% larger than the original 34x50');
assert(KICKOFF[0].x === -KICKOFF[1].x && KICKOFF[0].z === -KICKOFF[1].z, 'kickoff is rotationally symmetric');
m = fresh(); assert(Math.abs(m.cars[0].z) < END - 8 && Math.abs(m.cars[1].z) < END - 8, 'kickoff inside arena');

// ---- driving
m = fresh(); m.cars[0].x = 0; m.setInput(0, { throttle: 1 }); run(m, 1); assert(m.cars[0].z < KICKOFF[0].z - 8, 'forward moves along the nose');
m = fresh(); m.cars[0].x = 3; m.cars[0].z = 0; m.setInput(0, { throttle: -1 }); run(m, 1); assert(m.cars[0].z > 5, 'reverse moves backwards');
m = fresh(); m.cars[0].x = 3; m.cars[0].z = END - 3; m.setInput(0, { throttle: 1 }); let sp = 0; run(m, 3, () => { sp = Math.max(sp, Math.hypot(m.cars[0].vx, m.cars[0].vz)); });
assert(sp <= TUNING.throttleMax + .01 && sp > TUNING.throttleMax - 3, 'top speed ' + sp);
m = fresh(); m.cars[0].x = 3; m.cars[0].z = END - 3; m.cars[0].boost = 100; m.setInput(0, { throttle: 1, boost: true }); run(m, 1.7); sp = Math.hypot(m.cars[0].vx, m.cars[0].vz); assert(sp > TUNING.throttleMax + 4 && sp <= TUNING.boostMax + .01, 'boost speed ' + sp);
// traversal: goal line to goal line with boost should stay quick
m = fresh(); m.cars[0].x = 0; m.cars[0].z = END - 3; m.setInput(0, { throttle: 1, boost: true }); let t = 0; while (m.cars[0].z > -(END - 8) && t < 600) { m.step(1 / 60, 2); t++; m.cars[0].boost = 100; }
console.log('  end-to-end traversal with boost: ' + (t / 60).toFixed(2) + ' s'); assert(t / 60 < 3.2, 'traversal too slow');
m = fresh(); m.cars[0].x = 0; m.cars[0].z = 0; m.setInput(0, { throttle: 1, steer: 1 }); run(m, 1); assert(m.cars[0].x > 3 && m.cars[0].yaw > 1, 'steer right turns right');

// ---- jumping
m = fresh(); tap(m, 0); run(m, .3); assert(!m.cars[0].grounded, 'tap jump latched'); run(m, 1.5); assert(m.cars[0].grounded, 'lands');
const peak = hold => { const k = fresh(); k.setInput(0, { jump: true }); let y = 0; run(k, 1, i => { if (!hold && i === 2) k.setInput(0, { jump: false }); y = Math.max(y, k.cars[0].y); }); return y; };
assert(peak(true) > peak(false) + .5, 'holding jump jumps higher');
m = fresh(); tap(m, 0, { throttle: 1 }); run(m, .3); tap(m, 0, { throttle: 1 }); run(m, .1); assert.strictEqual(m.cars[0].jumps, 2); const vy = m.cars[0].vy; tap(m, 0, { throttle: 1 }); run(m, .02); assert(m.cars[0].vy < vy, 'no third jump');
m = fresh(); tap(m, 0, { throttle: 1 }); run(m, .3); const v0 = Math.hypot(m.cars[0].vx, m.cars[0].vz); tap(m, 0, { throttle: 1 }); run(m, .1); assert(Math.hypot(m.cars[0].vx, m.cars[0].vz) > v0 + 8, 'forward flip adds speed');
assert(m.cars[0].dodge > 0 || m.cars[0].pitch !== 0, 'flip animates');

// ---- goals
m = fresh(); m.ball.z = -(END - 10); m.ball.vz = -28; run(m, 2); assert.deepStrictEqual(m.scores, [1, 0], 'blue scores in -z goal'); assert.strictEqual(m.phase, 'goal'); assert.strictEqual(m.goalTeam, 0);
run(m, TUNING.goalPhase + .2); assert.strictEqual(m.phase, 'countdown'); assert(Math.abs(m.ball.z) < .01 && m.cars[0].z === KICKOFF[0].z && m.scores[0] === 1, 'kickoff reset keeps score');
m = fresh(); m.ball.z = END - 10; m.ball.vz = 28; run(m, 2); assert.deepStrictEqual(m.scores, [0, 1], 'orange scores in +z goal');
m = fresh(); m.ball.x = GOAL_W / 2; m.ball.z = END - 10; m.ball.vz = 28; run(m, 1.5); assert.deepStrictEqual(m.scores, [0, 0], 'post blocks');
m = fresh(); m.ball.x = 0; m.ball.y = GOAL_H + 2; m.ball.z = END - 10; m.ball.vz = 34; m.ball.vy = 2; run(m, 1); assert.deepStrictEqual(m.scores, [0, 0], 'over the bar');
m = fresh(); m.ball.x = GOAL_W / 2 + 3; m.ball.z = END - 4; m.ball.vz = 20; run(m, 1.5); assert.deepStrictEqual(m.scores, [0, 0], 'wide of the post bounces off the end wall');
// frozen before kickoff
m = new Match(); m.start(); m.setInput(0, { throttle: 1, boost: true }); const z0 = m.cars[0].z; for (let i = 0; i < 100; i++) m.step(1 / 60, 2); assert.strictEqual(m.phase, 'countdown'); assert.strictEqual(m.cars[0].z, z0, 'cars cannot move before kickoff');
run(m, TUNING.countdown); assert.strictEqual(m.phase, 'playing');

// ---- overtime & full time
m = fresh(); m.remaining = .05; run(m, .2); assert(m.overtime && m.phase === 'playing', 'tie enters overtime');
m.ball.x = 0; m.ball.z = END - 10; m.ball.vz = 28; run(m, 1.5); assert.deepStrictEqual(m.scores, [0, 1]); assert(m.finishAfterGoal);
run(m, TUNING.goalPhase + .5); assert.strictEqual(m.phase, 'finished'); assert.strictEqual(m.winner, 1);
run(m, TUNING.finishedPhase + .5); assert.strictEqual(m.phase, 'countdown'); assert.deepStrictEqual(m.scores, [0, 0]);
m = fresh(); m.scores = [1, 0]; m.remaining = .05; run(m, .2); assert.strictEqual(m.phase, 'finished'); assert.strictEqual(m.winner, 0);

// ---- walls, corners
m = fresh(); m.ball.x = SIDE - 2; m.ball.z = -(END - 2); m.ball.vx = 3; m.ball.vz = -3; run(m, 4); assert(Math.abs(m.ball.x) <= SIDE && Math.abs(m.ball.z) <= END + .01, 'corner ball stays in');
m = fresh(); m.ball.x = SIDE - BALL_R - .01; m.ball.vx = 20; m.ball.vz = 0; run(m, .3); assert(m.ball.vx < 0, 'side wall bounces');
m = fresh(); m.cars[0].x = 0; m.cars[0].z = 0; m.cars[0].yaw = Math.PI / 2; m.setInput(0, { throttle: 1, boost: true }); run(m, 3); assert(m.cars[0].x <= SIDE, 'car cannot leave through the side wall');
// car cannot drive through the corner chamfer
m = fresh(); m.cars[0].x = SIDE - 3; m.cars[0].z = END - 12; m.cars[0].yaw = Math.PI; m.setInput(0, { throttle: 1, boost: true }); run(m, 2);
assert(Math.abs(m.cars[0].x) + Math.abs(m.cars[0].z) <= SIDE + END - RR.CHAMFER + .01, 'chamfer respected');

// ---- collisions
m = fresh(); m.cars[0].x = 0; m.cars[0].z = 2; m.cars[1].x = 0; m.cars[1].z = -2; m.setInput(0, { throttle: 1 }); m.setInput(1, { throttle: 1 }); m.cars[1].yaw = Math.PI; run(m, 1);
assert(Math.hypot(m.cars[0].x - m.cars[1].x, m.cars[0].z - m.cars[1].z) >= 2.9, 'cars do not overlap');
m = fresh(); m.cars[0].x = 0; m.cars[0].z = 10; m.ball.x = 0; m.ball.z = 0; m.setInput(0, { throttle: 1, boost: true }); run(m, 1.2); assert(m.ball.vz < -8, 'car drives the ball forward'); assert(m.hitSeq > 0 && m.lastTouch === 0, 'hit event recorded');

// ---- boost pads (server authoritative)
assert.strictEqual(PADS.length, 34); assert.strictEqual(PADS.filter(p => p.type === 'large').length, 6);
for (const p of PADS) { assert(Math.abs(p.x) + Math.abs(p.z) <= SIDE + END - RR.CHAMFER, 'pad inside chamfer'); const mir = PADS.find(q => q.x === -p.x && q.z === -p.z); assert(mir && mir.type === p.type, 'pads are rotationally symmetric'); }
const small = PADS.find(p => p.type === 'small'), large = PADS.find(p => p.type === 'large');
m = fresh(); m.cars[1].x = -20; m.cars[1].z = 30; m.cars[0].boost = 10; m.cars[0].x = small.x; m.cars[0].z = small.z; m.pickupBoost(m.cars[0]);
assert.strictEqual(m.cars[0].boost, 10 + small.amount, 'small pad gives its amount'); assert(m.pads[small.id].respawn === small.respawn, 'small pad goes on cooldown');
m.cars[0].boost = 10; m.pickupBoost(m.cars[0]); assert.strictEqual(m.cars[0].boost, 10, 'pad on cooldown gives nothing');
m.cars[0].x = 0; m.cars[0].z = 0; m.cars[0].boost = 100; run(m, small.respawn + .1); assert.strictEqual(m.pads[small.id].respawn, 0, 'small pad respawns'); assert.strictEqual(m.snapshot().pads[small.id], '1');
m.cars[0].x = large.x; m.cars[0].z = large.z; m.cars[0].boost = 20; m.pickupBoost(m.cars[0]); assert.strictEqual(m.cars[0].boost, 100, 'large pad fills boost'); assert.strictEqual(m.snapshot().pads[large.id], '0');
assert(large.respawn > small.respawn, 'large pads respawn slower');
m.cars[0].boost = 100; m.pads[small.id].respawn = 0; m.cars[0].x = small.x; m.cars[0].z = small.z; m.pickupBoost(m.cars[0]); assert.strictEqual(m.pads[small.id].respawn, 0, 'full tank does not waste a pad');
m = fresh(); m.cars[0].x = small.x; m.cars[0].z = small.z; m.cars[0].y = 6; m.cars[0].grounded = false; m.cars[0].boost = 10; m.pickupBoost(m.cars[0]); assert.strictEqual(m.cars[0].boost, 10, 'airborne cars cannot collect');
m = fresh(); m.start(); run(m, 0.1); m.pads.forEach(p => { p.respawn = 5; }); m.start(); assert(m.pads.every(p => p.respawn === 0), 'pads reset at kickoff/restart');
assert.strictEqual(m.snapshot().pads.length, PADS.length);

// ---- bots
m = fresh(); m.cars[1].boost = 5; m.cars[1].x = 0; m.cars[1].z = -10; m.ball.x = 0; m.ball.z = 30; m.ball.vz = 0; m.ball.vx = 0;
let gotPad = false; const b0 = m.cars[1].boost; for (let i = 0; i < 60 * 12 && !gotPad; i++) { if (i % 4 === 0) botThink(m, 1); m.step(1 / 60, 2); if (m.cars[1].boost > b0 + 5) gotPad = true; }
assert(gotPad, 'bot goes for boost when low and the ball is far');
// bot vs bot in the larger arena: both sides get to the ball and the game produces goals
let goals = 0; m = new Match(); m.start(); for (let i = 0; i < 60 * 240; i++) { if (i % 4 === 0) { botThink(m, 0); botThink(m, 1); } m.step(1 / 60, 2); if (m.phase === 'goal' && m.phaseTimer > TUNING.goalPhase - .02) goals++; }
console.log('  bot-vs-bot 4 min goals: ' + goals + ' score ' + m.scores); assert(goals >= 1, 'bots score at least one goal in 4 min');

// ---- input sanitising
m = fresh(); m.setInput(0, { throttle: 'x', steer: 1e9, boost: 'yes', jump: 1 }); assert.strictEqual(m.cars[0].input.throttle, 0); assert.strictEqual(m.cars[0].input.steer, 1); assert.strictEqual(m.cars[0].input.boost, false);
console.log('physics ok');
