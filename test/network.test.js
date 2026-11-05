// End-to-end network test: spawns the real server and drives it with real WebSocket clients.
const assert = require('assert');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const PORT = 4300 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((res, rej) => http.get({ port: PORT, path: p, host: '127.0.0.1' }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })); }).on('error', rej));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.last = null; this.closed = false; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.onopen = () => res(this);
      this.ws.onerror = rej;
      this.ws.onclose = () => { this.closed = true; };
      this.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') this.last = m; else this.msgs.push(m); };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async wait(type, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const i = this.msgs.findIndex(m => m.type === type); if (i >= 0) return this.msgs.splice(i, 1)[0]; await sleep(20); }
    throw new Error(`${this.name}: timeout waiting for ${type}; got ${JSON.stringify(this.msgs.map(m => m.type))}`);
  }
  async waitPhase(phase, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (this.last && this.last.phase === phase) return this.last; await sleep(20); }
    throw new Error(`${this.name}: timeout waiting for phase ${phase}, last=${this.last && this.last.phase}`);
  }
  close() { try { this.ws.close(); } catch (e) {} }
}
// drives car `idx` of client `c`: line up behind the ball and push it toward the goal that car attacks
function chase(c, idx) {
  const s = c.last, car = s.cars[idx], b = s.ball, atk = idx === 0 ? -1 : 1;
  const gx = -b.x, gz = atk * 34 - b.z, gl = Math.hypot(gx, gz) || 1, tx = b.x - gx / gl * 2.5, tz = b.z - gz / gl * 2.5;
  let d = Math.atan2(tx - car.x, -(tz - car.z)) - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  const near = Math.hypot(tx - car.x, tz - car.z) < 12;
  if (near && Math.abs(d) > 1.6) { let r = d - Math.sign(d) * Math.PI; c.send({ type: 'input', throttle: -1, steer: Math.max(-1, Math.min(1, -r * 3)), boost: false }); }   // reverse out instead of orbiting the target
  else c.send({ type: 'input', throttle: 1, steer: Math.max(-1, Math.min(1, d * 3)), boost: Math.abs(d) < .3 });
}
const rooms = async () => JSON.parse((await get('/health')).body).rooms;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), MATCH_LENGTH: '5' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverErr = ''; srv.stderr.on('data', d => serverErr += d);
  for (let i = 0; i < 50; i++) { try { await get('/health'); break; } catch (e) { await sleep(100); } }
  const passed = [];
  const ok = name => { passed.push(name); console.log('  ✓', name); };
  try {
    // --- HTTP
    assert.strictEqual((await get('/health')).status, 200); ok('GET /health');
    const idx = await get('/'); assert(idx.status === 200 && idx.body.includes('ROCKET')); ok('GET / serves the game');
    assert.strictEqual((await get('/game.js')).status, 200); assert.strictEqual((await get('/style.css')).status, 200); ok('static assets');
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/match.js', '/package.json', '/..%2fserver.js']) assert.strictEqual((await get(p)).status, 404, p);
    ok('server source / path traversal not served');

    // --- private room, two players
    const A = await new Client('A').open(), B = await new Client('B').open();
    A.send({ type: 'create' });
    const roomA = await A.wait('room'); assert(/^[A-Z2-9]{5}$/.test(roomA.code)); assert.strictEqual(roomA.player, 0);
    ok('create private room returns a 5-char code');
    B.send({ type: 'join', code: roomA.code.toLowerCase() });
    const roomB = await B.wait('room'); assert.strictEqual(roomB.player, 1);
    await A.wait('peer_joined'); await B.wait('peer_joined'); ok('second player joins (case-insensitive code), both notified');
    const C = await new Client('C').open();
    C.send({ type: 'join', code: roomA.code }); assert.match((await C.wait('error')).message, /full/i); ok('third player rejected: room full');
    C.send({ type: 'join', code: 'ZZZZZ' }); assert.match((await C.wait('error')).message, /not found/i); ok('unknown code rejected');
    A.send({ type: 'join', code: roomA.code }); const again = await A.wait('room'); assert.strictEqual(again.player, 0); ok('re-joining own room is idempotent (no duplicate slot)');

    await A.waitPhase('countdown'); await B.waitPhase('playing', 6000); ok('countdown -> playing');
    // sync: same match for both players
    await sleep(300);
    assert.deepStrictEqual(A.last.scores, B.last.scores); assert(Math.abs(A.last.seq - B.last.seq) < 8); assert(Math.abs(A.last.remaining - B.last.remaining) < .3);
    ok('both clients receive the same match state (scores/timer)');
    // input moves the right car; the other stays
    const z0 = [A.last.cars[0].z, A.last.cars[1].z];
    for (let i = 0; i < 20; i++) { A.send({ type: 'input', throttle: 1, steer: 0, boost: false, jump: false }); B.send({ type: 'input', throttle: 0 }); await sleep(33); }
    assert(A.last.cars[0].z < z0[0] - 2, 'A car moved'); assert(Math.abs(A.last.cars[1].z - z0[1]) < .5, 'B car idle');
    assert(Math.abs(B.last.cars[0].z - A.last.cars[0].z) < 3); ok('input from player A moves only car A; B sees the same movement');
    // watchdog: stop sending input; car must brake instead of driving on
    await sleep(1800); const sp = Math.hypot(A.last.cars[0].vx, A.last.cars[0].vz);
    assert(sp < 5 || A.last.cars[0].z < -20, 'car should decelerate after input stops (speed ' + sp + ')'); ok('input watchdog stops a silent client\'s car');
    // robustness: garbage frames
    A.ws.send('not json'); A.ws.send(JSON.stringify({ type: 'input', throttle: 'x', steer: 1e99, boost: {} })); A.ws.send(JSON.stringify([1, 2])); A.ws.send(JSON.stringify({ type: 'join', code: { a: 1 } }));
    await sleep(100); assert(!A.closed); assert.strictEqual((await get('/health')).status, 200); ok('malformed / hostile messages ignored, server alive');
    // match end: A drives at the ball (and into the goal) so a real goal is scored over the wire.
    const t0 = Date.now(); let sawOT = false, padsA = 0, padsB = 0;
    while (Date.now() - t0 < 90000 && !(A.last.phase === 'finished')) {
      if (A.last.overtime) sawOT = true;
      chase(A, 0);
      const za = (A.last.pads.match(/0/g) || []).length, zb = (B.last.pads.match(/0/g) || []).length; padsA = Math.max(padsA, za); padsB = Math.max(padsB, zb);
      await sleep(33);
    }
    const fa = await A.waitPhase('finished', 1000), fb = await B.waitPhase('finished', 3000);
    assert(fa.scores[0] + fa.scores[1] >= 1, 'a goal was scored through real network play: ' + fa.scores);
    assert.strictEqual(fa.winner, fb.winner); assert.deepStrictEqual(fa.scores, fb.scores); assert.strictEqual(fa.celebration, fb.celebration);
    ok('goal scored over the wire, match finishes, both players see the same result (' + fa.celebration + ' ' + fa.scores.join('-') + (sawOT ? ', via overtime' : '') + ')');
    await A.waitPhase('countdown', 11000); assert.deepStrictEqual(A.last.scores, [0, 0]); ok('match restarts automatically after full time');

    // --- disconnect handling
    B.close(); await A.wait('peer_left'); assert.strictEqual(await rooms(), 1); ok('opponent disconnect: remaining player notified, room kept');
    const D = await new Client('D').open(); D.send({ type: 'join', code: roomA.code });
    assert.strictEqual((await D.wait('room')).player, 1); await A.wait('peer_joined'); await D.wait('peer_joined'); await D.waitPhase('countdown'); ok('reconnect / replacement player can rejoin the same room');
    A.close(); D.close(); await sleep(300); assert.strictEqual(await rooms(), 0); ok('empty room is deleted');
    C.close();

    // --- public matchmaking (PLAY ONLINE)
    const Q1 = await new Client('Q1').open(), Q2 = await new Client('Q2').open(), Q3 = await new Client('Q3').open(), Q4 = await new Client('Q4').open();
    Q1.send({ type: 'find' }); assert.strictEqual((await Q1.wait('searching')).waiting, 1);
    await sleep(500); assert(!Q1.msgs.some(m => m.type === 'peer_joined' || m.type === 'room'), 'no bot is substituted while searching'); ok('lone player keeps searching (no bot in public matchmaking)');
    Q1.send({ type: 'find' }); await Q1.wait('searching'); ok('duplicate matchmaking request is ignored');
    Q1.send({ type: 'cancel' }); await Q1.wait('search_cancelled'); Q2.send({ type: 'find' }); await Q2.wait('searching'); await sleep(200);
    assert(!Q1.msgs.some(m => m.type === 'room'), 'cancelled player is not matched'); ok('cancelled search removes player from the queue');
    Q1.send({ type: 'find' }); const q1 = await Q1.wait('room'); const q2 = await Q2.wait('room');
    assert.strictEqual(q1.code, q2.code); assert.strictEqual(q1.public, true); assert.deepStrictEqual([q1.player, q2.player], [1, 0]);
    await Q1.wait('peer_joined'); await Q2.wait('peer_joined'); await Q1.waitPhase('countdown'); await Q2.waitPhase('countdown'); ok('two searching players are matched into one synchronized public match');
    Q3.send({ type: 'join', code: q1.code }); assert.match((await Q3.wait('error')).message, /not found/i); ok('public matches cannot be joined by code');
    Q3.send({ type: 'find' }); await Q3.wait('searching'); Q4.send({ type: 'find' });
    const q3 = await Q3.wait('room'), q4 = await Q4.wait('room'); assert.strictEqual(q3.code, q4.code); assert.notStrictEqual(q3.code, q1.code);
    await Q3.wait('peer_joined'); await Q4.wait('peer_joined'); assert.strictEqual(await rooms(), 2); ok('two independent public matches run at the same time');
    await Q1.waitPhase('playing', 6000); await Q3.waitPhase('playing', 6000);
    Q1.send({ type: 'input', throttle: 1 }); for (let i = 0; i < 15; i++) { Q1.send({ type: 'input', throttle: 1 }); await sleep(33); }
    assert(Math.abs(Q3.last.cars[0].z - 20) < 0.5 && Math.abs(Q4.last.cars[0].z - 20) < 0.5, 'other match unaffected');
    assert(Math.abs(Q1.last.cars[1].z - Q2.last.cars[1].z) < 3); ok('movement in one match does not leak into the other');
    Q2.close(); const pl = await Q1.wait('peer_left'); assert.strictEqual(pl.public, true); await sleep(200); assert.strictEqual(await rooms(), 1);
    ok('opponent leaving a public match returns the other player to the menu and frees the room');
    Q1.send({ type: 'find' }); await Q1.wait('searching'); Q3.send({ type: 'leave' }); await Q3.wait('left'); await Q4.wait('peer_left');
    Q3.send({ type: 'find' }); await Q3.wait('room'); await Q1.wait('room'); ok('players can queue again after a match and are paired with each other');
    Q1.close(); Q3.close(); Q4.close(); await sleep(300); assert.strictEqual(await rooms(), 0);

    // --- public match runs to completion, both players are released and can queue again
    const M1 = await new Client('M1').open(), M2 = await new Client('M2').open();
    M1.send({ type: 'find' }); M2.send({ type: 'find' }); await M1.wait('room'); await M2.wait('room'); await M1.waitPhase('playing', 6000);
    const mt0 = Date.now(); let fin1 = null, fin2 = null;
    while (Date.now() - mt0 < 90000 && !(M1.msgs.some(m => m.type === 'match_over') && M2.msgs.some(m => m.type === 'match_over'))) {
      chase(M1, 0);
      if (M1.last.phase === 'finished') fin1 = M1.last; if (M2.last.phase === 'finished') fin2 = M2.last;
      await sleep(33);
    }
    await M1.wait('match_over', 2000); await M2.wait('match_over', 2000);
    assert(fin1 && fin2 && fin1.winner === fin2.winner && fin1.scores.join() === fin2.scores.join()); assert.strictEqual(await rooms(), 0);
    ok('public match finishes: identical result for both players, both released (' + fin1.celebration + ' ' + fin1.scores.join('-') + ')');
    M1.send({ type: 'find' }); M2.send({ type: 'find' }); await M1.wait('room'); await M2.wait('room'); ok('same two players can immediately queue for another match');
    M1.close(); M2.close(); await sleep(300);

    // --- solo vs bot
    const S = await new Client('S').open(); S.send({ type: 'solo' });
    await S.wait('room'); await S.wait('peer_joined'); await S.waitPhase('playing', 6000);
    const bz = S.last.cars[1]; await sleep(2500); const b2 = S.last.cars[1];
    assert(Math.hypot(b2.x - bz.x, b2.z - bz.z) > 3, 'bot drives'); ok('solo: bot joins instantly, match starts, bot drives');
    assert.strictEqual(await rooms(), 1);
    const J = await new Client('J').open(); J.send({ type: 'join', code: 'AAAAA' }); await J.wait('error'); J.close();
    S.send({ type: 'leave' }); await S.wait('left'); await sleep(100); assert.strictEqual(await rooms(), 0); ok('leaving a bot match deletes the room');
    S.close();

    // --- flood protection
    const F = await new Client('F').open(); for (let i = 0; i < 400; i++) F.send({ type: 'ping', sent: i }); for (let i = 0; i < 50 && !F.closed; i++) await sleep(50);
    assert(F.closed, 'flooder disconnected'); assert.strictEqual((await get('/health')).status, 200); ok('message flood disconnects the client, server survives');
    assert.strictEqual(serverErr, '', 'server stderr must be empty: ' + serverErr);
    ok('no server errors logged');
    console.log(`\nnetwork tests: ${passed.length} passed`);
  } catch (e) { console.error('\nFAILED:', e.stack || e); console.error(serverErr); process.exitCode = 1; }
  finally { srv.kill(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
