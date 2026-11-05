// Shared constants for server physics AND client rendering (single source of truth).
// Works as a Node module (require) and as a browser global (window.RR).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIDE = 23;              // half arena width  (x)   -> 46 wide
  const END = 34;               // half arena length (z)   -> 68 long (was 34 x 50)
  const GOAL_W = 14;
  const GOAL_H = 5.4;
  const GOAL_DEPTH = 5.5;
  const BALL_R = 1.15;
  const CEIL = 15;
  const CHAMFER = 7.5;          // 45 degree corner cut
  const GROUND_Y = 0.66;

  // ---- tunables -----------------------------------------------------------
  const TUNING = {
    throttleMax: 24, boostMax: 39, accel: 48, boostAccel: 64, gravity: 22,
    ballMax: 58, startBoost: 33, boostDrain: 33,
    matchLength: 180, countdown: 3, goalPhase: 6.0, finishedPhase: 9
  };
  // Boost pads: amount = boost restored, respawn = seconds, radius = pickup radius.
  const PAD_TYPES = {
    small: { amount: 12, respawn: 4, radius: 1.9 },
    large: { amount: 100, respawn: 10, radius: 2.6 }
  };
  // Kickoff spawn (rotationally symmetric: car 1 is car 0 turned 180 degrees)
  const KICKOFF = [{ x: -5, z: 20, yaw: 0 }, { x: 5, z: -20, yaw: Math.PI }];

  function buildPads() {
    const pads = [], seen = new Set();
    const add = (x, z, type) => {
      const k = x + ',' + z; if (seen.has(k)) return; seen.add(k);
      pads.push({ id: pads.length, x, z, type, amount: PAD_TYPES[type].amount, respawn: PAD_TYPES[type].respawn, radius: PAD_TYPES[type].radius });
    };
    const mirror = (x, z, type) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(x * sx || 0, z * sz || 0, type); };
    for (const [x, z] of [[19, 28], [20, 0]]) mirror(x, z, 'large');
    for (const [x, z] of [[7, 30], [13, 25], [17, 15], [9, 17], [16, 6], [5, 8], [0, 23], [10, 0]]) mirror(x, z, 'small');
    return pads;
  }
  const PADS = buildPads();

  return { SIDE, END, GOAL_W, GOAL_H, GOAL_DEPTH, BALL_R, CEIL, CHAMFER, GROUND_Y, TUNING, PAD_TYPES, KICKOFF, PADS };
});
