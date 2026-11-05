/* Rocket Rivals — client: networking, input, HUD, cameras, replay and the render loop.
   All visuals here are cosmetic; the server owns every gameplay decision. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const G = window.G, FX = window.FX, World = window.World, Cars = window.Cars, Sound = window.Sound, RR = window.RR;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI, TAU = PI * 2;
const wrap = a => ((a + PI) % TAU + TAU) % TAU - PI;
function toast(s) { const el = $('toast'); el.textContent = s; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3400); }
if (!G) { toast('WebGL is not available in this browser.'); return; }
const { SIDE, END, GOAL_W, GOAL_H, GOAL_DEPTH, BALL_R, CEIL, TUNING, KICKOFF } = RR;
const DEBUG = /[?&]debug\b/.test(location.search);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

// ------------------------------------------------------------------ boot renderer
let quality = store.get('rr_quality', '');
if (!['low', 'medium', 'high'].includes(quality)) quality = (matchMedia('(pointer:coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4) ? 'medium' : 'high';
let shakeOn = store.get('rr_shake', '1') === '1';
G.setQuality(quality); FX.setLimit(G.q.particles);
World.init();
const BLUE = Cars.TEAMS[0].glow, ORANGE = Cars.TEAMS[1].glow;
const teamGlow = i => (i === 1 ? ORANGE : BLUE);

// ------------------------------------------------------------------ state
let socket = null, player = -1, room = '', joined = false, connected = false, match = null, lastStateAt = 0, lastRoom = '', pendingRejoin = false;
let searching = false;
let retries = 0, reconnectTimer = null, clockPing = 0, ballCam = false;
let desired = { type: 'input', throttle: 0, steer: 0, boost: false, jump: false, handbrake: false, airRoll: 0 };
const keys = new Set(), touch = { throttle: 0, steer: 0, boost: false, jump: false, engaged: false };
const rc = [0, 1].map(i => ({ x: KICKOFF[i].x, y: RR.GROUND_Y, z: KICKOFF[i].z, yaw: KICKOFF[i].yaw, pitch: 0, roll: 0, boostOn: false, vx: 0, vy: 0, vz: 0, grounded: true, raw: null }));
const cstate = [Cars.createState(), Cars.createState()];
const ball = { x: 0, y: BALL_R + 0.15, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0 };
const ballTrail = FX.createTrail(26);
let tGlobal = 0, snapNext = true, camSnap = true;

// ------------------------------------------------------------------ network
function network(ok) { connected = ok; $('networkDot').classList.toggle('offline', !ok); $('netText').textContent = ok ? 'ONLINE' : 'DISCONNECTED'; if (!ok) $('latency').textContent = '— ms'; }
function showLobby() {
  document.body.classList.remove('playing');
  joined = false; $('menu').classList.remove('hidden'); $('inGame').classList.add('hidden'); $('scoreboard').classList.add('hidden'); document.body.classList.remove('replay');
  $('floatingMessage').className = 'hidden'; $('menuHome').classList.toggle('hidden', !!room || searching); $('menuSearch').classList.toggle('hidden', !searching || !!room); $('menuLobby').classList.toggle('hidden', !room);
  if (room) { $('roomCode').textContent = room; $('lobbyStatus').textContent = 'Waiting for player 2 to join...'; }
  if (Sound.ready) Sound.silenceEngines();
}
function showGame() {
  document.body.classList.add('playing');
  joined = true; $('menu').classList.add('hidden'); $('inGame').classList.remove('hidden'); $('scoreboard').classList.remove('hidden');
  $('leftLabel').innerHTML = 'YOU <span id="teamColor">' + (player === 0 ? 'BLUE' : 'ORANGE') + '</span>'; $('teamColor').style.color = player === 0 ? '#5ddcff' : '#ffb567';
  $('hudCode').textContent = room; snapNext = true; camSnap = true; resetEffects(); toast('MATCH FOUND — LET’S GO!');
}
function doSend(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); else toast('Not connected. Check your connection.'); }
function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(protocol + '//' + location.host + '/ws'); socket = sock;
  sock.addEventListener('open', () => {
    if (socket !== sock) return;
    retries = 0; network(true); clockPing = performance.now(); doSend({ type: 'ping', sent: clockPing });
    const query = new URLSearchParams(location.search).get('room');
    const code = lastRoom || (query || '').toUpperCase();
    if (code) { $('codeInput').value = code; pendingRejoin = !!lastRoom; doSend({ type: 'join', code }); }
  });
  sock.addEventListener('message', evt => {
    if (socket !== sock) return; let msg; try { msg = JSON.parse(evt.data); } catch { return; }
    switch (msg.type) {
      case 'searching': searching = true; showLobby(); break;
      case 'search_cancelled': searching = false; showLobby(); break;
      case 'match_over': searching = false; room = ''; lastRoom = ''; player = -1; match = null; history.replaceState(null, '', location.pathname); showLobby(); toast('Match finished — press PLAY ONLINE to find another opponent.'); break;
      case 'room': searching = false; room = msg.code; lastRoom = msg.code; player = msg.player; pendingRejoin = false; showLobby(); break;
      case 'peer_joined': showGame(); break;
      case 'peer_left':
        joined = false;
        if (msg.public) { room = ''; lastRoom = ''; player = -1; match = null; showLobby(); toast('Your opponent left the match. Press PLAY ONLINE to find a new one.'); }
        else { showLobby(); toast('Opponent left the match. Share your code for a rematch.'); }
        break;
      case 'left': room = ''; lastRoom = ''; player = -1; match = null; history.replaceState(null, '', location.pathname); showLobby(); break;
      case 'state': onState(msg); break;
      case 'pong': $('latency').textContent = Math.round(performance.now() - Number(msg.sent || performance.now())) + ' ms'; break;
      case 'error':
        if (pendingRejoin) { pendingRejoin = false; lastRoom = ''; room = ''; player = -1; match = null; showLobby(); toast('Match ended while reconnecting.'); }
        else toast(msg.message || 'Something went wrong.');
        break;
    }
  });
  sock.addEventListener('close', () => {
    if (socket !== sock) return;
    network(false); joined = false; searching = false; room = ''; player = -1; match = null; showLobby();
    if (retries === 0) toast('Connection lost. Reconnecting...');
    reconnectTimer = setTimeout(() => { try { connect(); } catch (e) {} }, Math.min(8000, 700 * Math.pow(1.7, retries++)));
  });
  sock.addEventListener('error', () => network(false));
}

// ------------------------------------------------------------------ server state events (sounds / effects / history)
let lastPhase = 'waiting', lastCount = -1, lastHit = -1, lastGoalSeq = 0, prevPads = null, padFlash = new Float32Array(RR.PADS.length), prevJumps = [0, 0], prevOT = false;
const hist = []; let clip = null, clipLen = 0, goalStartTs = 0, goalLocal = 0;
let fireworks = [];
function resetEffects() { FX.clear(); FX.clearDecals(); FX.trailClear(ballTrail); for (const s of cstate) { FX.trailClear(s.trailL); FX.trailClear(s.trailR); } hist.length = 0; clip = null; document.body.classList.remove('replay'); fireworks = []; }

function onState(msg) {
  const prev = match; match = msg; lastStateAt = performance.now();
  const ts = msg.seq / 60;
  // ---- phase transitions
  if (msg.phase !== lastPhase) {
    if (msg.phase === 'countdown') { if (lastPhase === 'goal' || lastPhase === 'finished' || lastPhase === 'waiting') { resetEffects(); snapNext = true; camSnap = true; } lastCount = -1; }
    if (msg.phase === 'playing' && lastPhase === 'countdown') { if (joined) Sound.go(); showMessage('GO!', '', 'go'); setTimeout(() => { if (match && match.phase === 'playing') $('floatingMessage').className = 'hidden'; }, 700); }
    if (msg.phase === 'goal') beginGoal(msg, ts);
    if (msg.phase === 'finished' && joined) { Sound.final(); Sound.setCrowd(0.5); }
    lastPhase = msg.phase;
  }
  if (msg.phase === 'countdown' && joined) {
    const n = Math.ceil(msg.phaseTimer);
    if (n !== lastCount && n > 0) { lastCount = n; Sound.tick(); showMessage(String(n), '', 'count'); }
  }
  // ---- ball hit
  if (msg.hit && msg.hit[0] !== lastHit) {
    if (lastHit >= 0 && msg.phase === 'playing') onBallHit(msg);
    lastHit = msg.hit[0];
  }
  // ---- boost pads
  if (prevPads && prev && msg.phase !== 'countdown') {
    for (let i = 0; i < msg.pads.length; i++) if (prevPads[i] === '1' && msg.pads[i] === '0') onPadTaken(i);
  }
  prevPads = msg.pads;
  // ---- jumps / flips
  for (let i = 0; i < 2; i++) {
    const c = msg.cars[i]; if (!c) continue;
    if ((c.jumps || 0) > prevJumps[i] && msg.phase === 'playing') { const me = rc[player] || rc[0]; const d = Math.hypot(c.x - me.x, c.z - me.z); if (d < 40 || i === player) { if (c.dodge) Sound.flip(); else Sound.jump(); } }
    prevJumps[i] = c.jumps || 0;
  }
  // ---- overtime
  if (msg.overtime && !prevOT && joined) { showMessage('OVERTIME', 'NEXT GOAL WINS', 'ot'); setTimeout(() => { if (match && match.phase === 'playing') $('floatingMessage').className = 'hidden'; }, 1600); }
  prevOT = msg.overtime;
  // ---- replay history (only while play is live)
  if (msg.phase === 'playing') {
    hist.push({ ts, ball: { ...msg.ball }, cars: msg.cars.map(c => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, roll: c.roll, vx: c.vx, vy: c.vy, vz: c.vz, boostOn: c.boostOn, grounded: c.grounded })) });
    while (hist.length > 240 || (hist.length > 2 && ts - hist[0].ts > 7)) hist.shift();
  }
  updateHud(msg);
}
function onBallHit(msg) {
  const power = msg.hit[1], b = msg.ball, who = msg.hit[2];
  const col = teamGlow(who);
  const k = clamp(power / 34, 0, 1);
  FX.burst(b.x, b.y, b.z, Math.round(6 + k * 22), 6 + k * 14, col, 0.55, 0.28 + k * 0.2);
  if (k > 0.35) FX.shockwave(b.x, b.y, b.z, 2 + k * 3, col, 0.35);
  FX.flare(b.x, b.y, b.z, 1.2 + k * 1.8, [1, 1, 1], 0.18);
  const me = rc[player] || rc[0], d = Math.hypot(b.x - me.x, b.z - me.z);
  if (joined) Sound.hit(power);
  if (k > 0.4 && shakeOn) FX.shake = Math.max(FX.shake, k * 0.8 * clamp(1.4 - d / 30, 0.2, 1));
}
function onPadTaken(i) {
  const p = RR.PADS[i], big = p.type === 'large', col = big ? [1, 0.8, 0.25] : [1, 0.65, 0.2];
  FX.shockwave(p.x, 0.15, p.z, big ? 5 : 2.8, col, big ? 0.7 : 0.45);
  FX.burst(p.x, 0.5, p.z, big ? 30 : 12, big ? 9 : 5, col, 0.7, 0.28);
  padFlash[i] = 1;
  const me = rc[player]; if (me && Math.hypot(me.x - p.x, me.z - p.z) < 4 && joined) Sound.pad(big);
}
function beginGoal(msg, ts) {
  const team = msg.goal ? msg.goal[1] : 0, col = teamGlow(team);
  const b = msg.ball;
  goalStartTs = ts; goalLocal = performance.now();
  // replay clip: the last ~3.4 s of play before the goal
  const end = hist.length ? hist[hist.length - 1].ts : ts, start = end - 3.4;
  clip = hist.filter(h => h.ts >= start); clipLen = clip.length > 1 ? clip[clip.length - 1].ts - clip[0].ts : 0;
  if (clipLen < 1.2) clip = null;
  const gz = (team === 0 ? -1 : 1) * (END + 1.5);
  FX.burst(b.x, Math.max(b.y, 1.2), b.z, 150, 26, col, 1.5, 0.7);
  FX.burst(b.x, Math.max(b.y, 1.2), b.z, 70, 18, [1, 1, 1], 1.1, 0.5);
  for (let k = 0; k < 4; k++) FX.shockwave(b.x, 1 + k * 0.6, b.z, 10 + k * 7, k % 2 ? [1, 1, 1] : col, 0.8 + k * 0.2);
  FX.flare(b.x, 2, b.z, 7, col, 0.7);
  for (let k = 0; k < 90; k++) FX.spawn(0, (Math.random() - 0.5) * 14, 12 + Math.random() * 4, gz + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, -Math.random() * 3, (Math.random() - 0.5) * 6, 2.2 + Math.random() * 1.5, 0.26, 0.2, Math.random(), Math.random(), Math.random(), 1, true, 0.5, 4);
  fireworks = []; for (let k = 0; k < 7; k++) fireworks.push({ at: performance.now() + 250 + k * 260, x: (Math.random() - 0.5) * (SIDE * 1.6), y: 14 + Math.random() * 10, z: (Math.random() - 0.5) * (END * 1.4), col });
  if (World.flash) { World.flash.t = 1; World.flash.col = col; World.flash.x = b.x; World.flash.z = b.z; }
  if (shakeOn) FX.shake = 1;
  if (joined) { Sound.goal(team === player); }
  showMessage('GOAL!', msg.celebration, team === 1 ? 'orange' : 'blue');
}

// ------------------------------------------------------------------ HUD
const hud = { blue: -1, orange: -1, clock: '', status: '', boost: -1, speed: -1, low: false };
function showMessage(big, small, theme) {
  const el = $('floatingMessage'); el.innerHTML = '<span class="big">' + big + '</span>' + (small ? '<small>' + small + '</small>' : '');
  el.className = 'pop ' + (theme || ''); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
function updateHud(s) {
  if (s.scores[0] !== hud.blue) { hud.blue = s.scores[0]; $('blueScore').textContent = hud.blue; }
  if (s.scores[1] !== hud.orange) { hud.orange = s.scores[1]; $('orangeScore').textContent = hud.orange; }
  const sec = Math.ceil(s.remaining), clock = s.overtime ? 'OT' : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  if (clock !== hud.clock) { hud.clock = clock; $('gameClock').textContent = clock; $('gameClock').classList.toggle('ot', !!s.overtime); $('gameClock').classList.toggle('urgent', !s.overtime && sec <= 10 && s.phase === 'playing'); }
  const status = s.phase === 'countdown' ? 'KICKOFF' : s.phase === 'playing' ? (s.overtime ? 'SUDDEN DEATH' : '1V1 ONLINE MATCH') : s.phase === 'goal' ? 'GOAL!' : s.phase === 'finished' ? 'FULL TIME' : 'WAITING';
  if (status !== hud.status) { hud.status = status; $('matchStatus').textContent = status; }
  if (s.phase === 'finished' && lastPhaseShown !== 'finished') { showMessage(s.celebration, s.scores[0] + ' – ' + s.scores[1], s.winner === 1 ? 'orange' : 'blue'); }
  if (s.phase === 'playing' && lastPhaseShown === 'finished') $('floatingMessage').className = 'hidden';
  lastPhaseShown = s.phase;
}
let lastPhaseShown = '';
function updateBoostHud(c) {
  const b = Math.round(c.boost);
  if (b !== hud.boost) {
    hud.boost = b; $('boostCount').textContent = b; $('boostFill').style.width = b + '%'; $('boostRing').style.setProperty('--p', b);
    const low = b < 20; if (low !== hud.low) { hud.low = low; $('boostMeter').classList.toggle('low', low); }
  }
  const sp = Math.round(Math.hypot(c.vx, c.vz) * 3.6);
  if (sp !== hud.speed) { hud.speed = sp; $('speedNum').textContent = String(sp).padStart(3, '0'); }
}

// ------------------------------------------------------------------ input
function updateInput() {
  let throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (touch.engaged) { throttle = touch.throttle; steer = touch.steer; }
  if (DEBUG && window.__rrAuto && match && player >= 0 && match.cars[player]) {   // test autopilot: chase the ball, aim at the enemy goal
    const c = match.cars[player], b = match.ball, atk = player === 0 ? -1 : 1;
    const gx = -b.x, gz = atk * END - b.z, gl = Math.hypot(gx, gz) || 1;
    const tx = b.x - gx / gl * 2.5, tz = b.z - gz / gl * 2.5;
    const d = wrap(Math.atan2(tx - c.x, -(tz - c.z)) - c.yaw);
    window.__rrHold = { throttle: 1, steer: clamp(d * 3, -1, 1), boost: Math.abs(d) < 0.2, jump: false };
  }
  const H = DEBUG ? window.__rrHold : null;   // test hook (?debug): scripted input that survives window blur
  if (H) { throttle = H.throttle ?? throttle; steer = H.steer ?? steer; }
  desired = { type: 'input', throttle, steer, boost: !!(H && H.boost) || keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost, jump: !!(H && H.jump) || keys.has('Space') || touch.jump,
    handbrake: !!(H && H.handbrake) || keys.has('ControlLeft') || keys.has('ControlRight'), airRoll: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0) };
}
let lastInput = 0, lastPing = 0, lastSent = '';
function pushInput(force) { updateInput(); const sig = JSON.stringify(desired); if (joined && (force || sig !== lastSent)) { doSend(desired); lastSent = sig; lastInput = performance.now(); } }
const playingKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ControlLeft', 'ControlRight']);
function setCam(v) { ballCam = v; $('cameraBadge').textContent = (ballCam ? 'BALL CAM' : 'CAR CAM') + ' · C TO TOGGLE'; $('cameraBadge').classList.toggle('ball', ballCam); }
window.addEventListener('keydown', e => {
  if (document.activeElement === $('codeInput')) return;
  if (playingKeys.has(e.code)) e.preventDefault();
  if (e.code === 'KeyC' && !e.repeat) setCam(!ballCam);
  if (e.code === 'KeyM' && !e.repeat) setMuted(!Sound.muted);
  keys.add(e.code); if (playingKeys.has(e.code) && !e.repeat) pushInput();
});
window.addEventListener('keyup', e => { keys.delete(e.code); pushInput(); });
function releaseAll() { keys.clear(); touch.throttle = 0; touch.steer = 0; touch.boost = false; touch.jump = false; touch.engaged = false; pushInput(true); }
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
window.addEventListener('blur', releaseAll);
const needConn = f => () => { Sound.init(); Sound.click(); if (!connected) { toast('Cannot reach server. Reload the page.'); return; } f(); };
$('createBtn').onclick = needConn(() => doSend({ type: 'create' }));
$('soloBtn').onclick = needConn(() => doSend({ type: 'solo' }));
$('playBtn').onclick = needConn(() => { if (searching) return; searching = true; doSend({ type: 'find' }); showLobby(); });
$('cancelSearchBtn').onclick = () => { doSend({ type: 'cancel' }); searching = false; showLobby(); };
$('joinBtn').onclick = joinRoom; $('codeInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); joinRoom(); } };
$('codeInput').oninput = () => { $('codeInput').value = $('codeInput').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
function joinRoom() { Sound.init(); const code = $('codeInput').value.trim().toUpperCase(); if (code.length !== 5) { toast('Enter the 5-character room code.'); return; } doSend({ type: 'join', code }); }
$('exitBtn').onclick = () => { $('leaveBtn').onclick(); };
$('leaveBtn').onclick = () => { doSend({ type: 'leave' }); room = ''; lastRoom = ''; joined = false; match = null; history.replaceState(null, '', location.pathname); showLobby(); };
function inviteUrl() { const u = new URL(location.href); u.searchParams.set('room', room); return u.href; }
async function copy(what) { const value = what === 'code' ? room : inviteUrl(); if (!value) return; try { await navigator.clipboard.writeText(value); toast(what === 'code' ? 'Room code copied!' : 'Invite link copied!'); } catch { prompt('Copy this and send it to your friend:', value); } }
$('copyCode').onclick = () => copy('code'); $('inviteBtn').onclick = () => copy('url'); $('hudCopy').onclick = () => copy('url');
$('cameraBadge').onclick = () => setCam(!ballCam);
// touch controls
const joy = $('joystick'), knob = $('joyKnob'); let joyPointer = null;
joy.addEventListener('pointerdown', e => { e.preventDefault(); Sound.init(); joyPointer = e.pointerId; joy.setPointerCapture(e.pointerId); touch.engaged = true; moveJoy(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyPointer) moveJoy(e); });
function moveJoy(e) { const r = joy.getBoundingClientRect(), x = (e.clientX - (r.left + r.width / 2)) / (r.width * .5), y = (e.clientY - (r.top + r.height / 2)) / (r.height * .5), m = Math.max(1, Math.hypot(x, y)), sx = x / m, sy = y / m; knob.style.left = (50 + sx * 31) + '%'; knob.style.top = (50 + sy * 31) + '%'; touch.steer = Math.abs(sx) < .11 ? 0 : clamp(sx * 1.3, -1, 1); touch.throttle = Math.abs(sy) < .10 ? 0 : clamp(-sy * 1.45, -1, 1); pushInput(); }
function releaseJoy(e) { if (joyPointer !== e.pointerId) return; joyPointer = null; touch.engaged = false; touch.throttle = touch.steer = 0; knob.style.left = '50%'; knob.style.top = '50%'; pushInput(); }
joy.addEventListener('pointerup', releaseJoy); joy.addEventListener('pointercancel', releaseJoy); joy.addEventListener('lostpointercapture', () => { joyPointer = null; touch.engaged = false; touch.throttle = touch.steer = 0; });
for (const [id, action] of [['boostTouch', 'boost'], ['jumpTouch', 'jump']]) {
  const btn = $(id);
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); touch[action] = true; pushInput(); btn.classList.add('active'); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => { touch[action] = false; pushInput(); btn.classList.remove('active'); });
}
// settings
function setMuted(m) { Sound.setMuted(m); $('muteBtn').textContent = m ? 'OFF' : 'ON'; $('muteBtn').classList.toggle('off', m); }
function setRes(v, silent) {
  const n = v === 'auto' ? 0 : Number(v); G.userScale = n > 0 ? n : 0; if (!G.userScale) G.scale = 1;
  store.set('rr_res', v); for (const b of document.querySelectorAll('#resSeg button')) b.classList.toggle('on', b.dataset.r === String(v));
  if (!silent) toast('Resolution: ' + (n ? Math.round(n * 100) + '%' : 'AUTO'));
}
for (const b of document.querySelectorAll('#resSeg button')) b.onclick = () => setRes(b.dataset.r);
setRes(store.get('rr_res', 'auto'), true);
function markQuality() { for (const b of document.querySelectorAll('#qualitySeg button')) b.classList.toggle('on', b.dataset.q === quality); }
function applyQuality(q, silent) { G.scale = 1; quality = q; store.set('rr_quality', q); G.setQuality(q); FX.setLimit(G.q.particles); markQuality(); if (!silent) toast('Graphics: ' + q.toUpperCase()); }
$('settingsBtn').onclick = () => { Sound.init(); $('settingsPanel').classList.toggle('hidden'); };
for (const b of document.querySelectorAll('#qualitySeg button')) b.onclick = () => { applyQuality(b.dataset.q); lowFpsFor = 0; };
$('volRange').value = Math.round(Sound.vol * 100); $('volRange').oninput = () => { Sound.init(); Sound.setVolume($('volRange').value / 100); };
$('muteBtn').onclick = () => { Sound.init(); setMuted(!Sound.muted); };
$('shakeBtn').textContent = shakeOn ? 'ON' : 'OFF'; $('shakeBtn').onclick = () => { shakeOn = !shakeOn; store.set('rr_shake', shakeOn ? '1' : '0'); $('shakeBtn').textContent = shakeOn ? 'ON' : 'OFF'; };
setMuted(Sound.muted); markQuality();
document.addEventListener('pointerdown', () => Sound.init(), { once: true });

// ------------------------------------------------------------------ replay sampling
function sampleClip(p) {
  const t0 = clip[0].ts + p; let i = 0; while (i < clip.length - 2 && clip[i + 1].ts < t0) i++;
  const a = clip[i], b = clip[i + 1] || a, f = b.ts > a.ts ? clamp((t0 - a.ts) / (b.ts - a.ts), 0, 1) : 0;
  const mixO = (x, y, k) => ({ x: lerp(x.x, y.x, k), y: lerp(x.y, y.y, k), z: lerp(x.z, y.z, k), vx: lerp(x.vx || 0, y.vx || 0, k), vy: lerp(x.vy || 0, y.vy || 0, k), vz: lerp(x.vz || 0, y.vz || 0, k), rx: lerp(x.rx || 0, y.rx || 0, k), rz: lerp(x.rz || 0, y.rz || 0, k) });
  const out = { ball: mixO(a.ball, b.ball, f), cars: [] };
  for (let k = 0; k < 2; k++) {
    const ca = a.cars[k], cb = b.cars[k];
    out.cars.push({ ...mixO(ca, cb, f), yaw: ca.yaw + wrap(cb.yaw - ca.yaw) * f, pitch: lerp(ca.pitch, cb.pitch, f), roll: lerp(ca.roll, cb.roll, f), boostOn: ca.boostOn, grounded: ca.grounded });
  }
  return out;
}
const REPLAY_START = 2.2, REPLAY_END_PAD = 0.5;
function replayState() {
  if (!clip || !match || match.phase !== 'goal') return null;
  const elapsed = (performance.now() - goalLocal) / 1000;
  const window_ = TUNING.goalPhase - REPLAY_START - REPLAY_END_PAD;
  if (elapsed < REPLAY_START || elapsed > REPLAY_START + window_) return null;
  const p = clamp((elapsed - REPLAY_START) / window_, 0, 1) * clipLen;
  return sampleClip(p);
}

// ------------------------------------------------------------------ camera
const cam = { ex: 0, ey: 20, ez: 40, tx: 0, ty: 0, tz: 0, fov: 66 * PI / 180, yaw: 0, ready: false };
const camSm = { pos: [0, 20, 40], look: [0, 0, 0], yaw: 0, fov: 66, boostK: 0, speedK: 0 };
let camMode = 'orbit';
function updateCamera(dt, src) {
  const me = player >= 0 ? rc[player] : null;
  if (camSnap && me) camSm.yaw = me.yaw;
  let eye, look, fovT = 64, stiff = 8, lookStiff = 12;
  const replaying = !!src.replay;
  const phase = match ? match.phase : 'none';
  if (joined && me && !replaying && (phase === 'playing' || phase === 'countdown' || phase === 'waiting') ) {
    const raw = src.cars[player] || me, speed = Math.hypot(raw.vx || 0, raw.vz || 0);
    camSm.yaw += wrap(me.yaw - camSm.yaw) * (1 - Math.exp(-dt * (me.grounded === false ? 4 : 6.5)));
    camSm.speedK += (clamp(speed / 36, 0, 1) - camSm.speedK) * (1 - Math.exp(-dt * 3));
    camSm.boostK += ((me.boostOn ? 1 : 0) - camSm.boostK) * (1 - Math.exp(-dt * 5));
    const fx = Math.sin(camSm.yaw), fz = -Math.cos(camSm.yaw);
    const dist = 10.2 + camSm.speedK * 3.2 + camSm.boostK * 0.9, height = 4.4 + camSm.speedK * 0.6 + clamp((me.y - RR.GROUND_Y) * 0.45, 0, 5);
    fovT = 64 + camSm.speedK * 5 + camSm.boostK * 9;
    eye = [me.x - fx * dist, me.y + height, me.z - fz * dist];
    look = [me.x + fx * 7.5, me.y + 1.4 + clamp((me.y - RR.GROUND_Y) * 0.2, 0, 3), me.z + fz * 7.5];
    if (ballCam && phase === 'playing') {
      const bx = ball.x - me.x, bz = ball.z - me.z, bl = Math.hypot(bx, bz) || 1;
      const ffx = Math.sin(me.yaw), ffz = -Math.cos(me.yaw), facing = (bx * ffx + bz * ffz) / bl;
      const w = clamp((facing + 0.15) / 0.5, 0, 1);              // fall back to chase cam when the ball is behind us
      const ux = bx / bl, uz = bz / bl, bd = 9.8 + camSm.speedK * 2.5;
      const eyeB = [me.x - ux * bd, me.y + 4.6 + clamp(ball.y * 0.35, 0, 4), me.z - uz * bd];
      const lookB = [lerp(me.x, ball.x, 0.62), lerp(me.y + 1.2, ball.y, 0.55), lerp(me.z, ball.z, 0.62)];
      eye = [lerp(eye[0], eyeB[0], w), lerp(eye[1], eyeB[1], w), lerp(eye[2], eyeB[2], w)];
      look = [lerp(look[0], lookB[0], w), lerp(look[1], lookB[1], w), lerp(look[2], lookB[2], w)];
      stiff = 7;
    }
    camMode = 'chase';
  } else if (replaying) {
    const bv = Math.hypot(ball.vx, ball.vz) || 1, dx = ball.vx / bv, dz = ball.vz / bv;
    eye = [ball.x - dx * 14 + dz * 3, Math.max(5, ball.y + 5.5), ball.z - dz * 14 - dx * 3]; look = [ball.x, ball.y + 0.5, ball.z]; fovT = 58; stiff = 4; lookStiff = 7; camMode = 'replay';
  } else if (phase === 'goal' && match) {
    const gsign = ball.z > 0 ? 1 : -1, sway = Math.sin(tGlobal * 0.6) * 9;
    eye = [clamp(ball.x * 0.4, -6, 6) + sway, 7.5 + Math.sin(tGlobal * 0.9), gsign * (END - 15)]; look = [ball.x * 0.7, 2.6, ball.z]; fovT = 60; stiff = 3; lookStiff = 6; camMode = 'goal';
  } else if (phase === 'finished') {
    const a = tGlobal * 0.25; eye = [Math.cos(a) * 36, 22, Math.sin(a) * 52]; look = [0, 2, 0]; fovT = 56; stiff = 2; lookStiff = 3; camMode = 'orbit';
  } else {
    const a = tGlobal * 0.1; eye = [Math.cos(a) * 40, 20 + Math.sin(tGlobal * 0.13) * 3, Math.sin(a) * 56]; look = [0, 1, 0]; fovT = 58; stiff = 1.5; lookStiff = 2; camMode = 'orbit';
  }
  // keep the camera inside the stadium shell
  const inMouth = Math.abs(eye[0]) < GOAL_W / 2 - 1;
  eye[0] = clamp(eye[0], -(SIDE - 1.3), SIDE - 1.3); eye[2] = clamp(eye[2], -(inMouth ? END + GOAL_DEPTH - 1 : END - 1.3), inMouth ? END + GOAL_DEPTH - 1 : END - 1.3); eye[1] = clamp(eye[1], 1.2, CEIL - 0.8);
  { // also respect the 45-degree corner walls so the camera never ends up behind the glass
    const lim = SIDE + END - RR.CHAMFER - 1.3 * Math.SQRT2, ex = Math.abs(eye[0]) + Math.abs(eye[2]) - lim;
    if (ex > 0 && camMode !== 'orbit') { eye[0] -= Math.sign(eye[0]) * ex / 2; eye[2] -= Math.sign(eye[2]) * ex / 2; }
  }
  if (camMode === 'chase' && me) {   // squeezed against a wall/goal net: rise up so the car stays in view
    const hd = Math.hypot(eye[0] - me.x, eye[2] - me.z);
    if (hd < 7) { eye[1] = Math.max(eye[1], me.y + 4.4 + (7 - hd) * 0.9); look[1] = Math.min(look[1], me.y + 0.8); }
  }
  if (camMode === 'orbit') { eye[0] = clamp(eye[0], -60, 60); eye[2] = clamp(eye[2], -70, 70); }
  const k = 1 - Math.exp(-dt * stiff), kl = 1 - Math.exp(-dt * lookStiff);
  if (camSnap || !cam.ready) { camSnap = false; if (me) camSm.yaw = me.yaw; camSm.pos = eye.slice(); camSm.look = look.slice(); camSm.fov = fovT; cam.ready = true; }
  for (let i = 0; i < 3; i++) { camSm.pos[i] += (eye[i] - camSm.pos[i]) * k; camSm.look[i] += (look[i] - camSm.look[i]) * kl; }
  camSm.fov += (fovT - camSm.fov) * (1 - Math.exp(-dt * 4));
  let ox = 0, oy = 0, oz = 0;
  if (FX.shake > 0 && shakeOn) { const a = FX.shake * FX.shake * 0.45; ox = Math.sin(tGlobal * 53) * a; oy = Math.sin(tGlobal * 67 + 1) * a; oz = Math.sin(tGlobal * 41 + 2) * a; }
  cam.ex = camSm.pos[0] + ox; cam.ey = camSm.pos[1] + oy; cam.ez = camSm.pos[2] + oz;
  cam.tx = camSm.look[0] + ox * 0.5; cam.ty = camSm.look[1] + oy * 0.5; cam.tz = camSm.look[2] + oz * 0.5;
  cam.fov = camSm.fov * PI / 180;
}

// ------------------------------------------------------------------ per-frame simulation of visuals
const idleCars = [{ x: KICKOFF[0].x, y: RR.GROUND_Y, z: KICKOFF[0].z, yaw: 0.2, pitch: 0, roll: 0, boostOn: false, vx: 0, vy: 0, vz: 0, grounded: true },
                  { x: KICKOFF[1].x, y: RR.GROUND_Y, z: KICKOFF[1].z, yaw: PI + 0.2, pitch: 0, roll: 0, boostOn: false, vx: 0, vy: 0, vz: 0, grounded: true }];
const landListener = { landed(impact, c) { if (joined) { Sound.land(impact); if (shakeOn && player >= 0 && c === rc[player] && impact > 8) FX.shake = Math.max(FX.shake, Math.min(0.5, impact * 0.025)); } } };

function gatherSource() {
  const rep = replayState();
  if (rep) return { replay: true, cars: rep.cars, ball: rep.ball };
  if (match) return { replay: false, cars: match.cars, ball: match.ball };
  return { replay: false, cars: idleCars, ball: null };
}
let wasReplay = false;
function updateVisuals(dt, src) {
  if (src.replay !== wasReplay) {
    wasReplay = src.replay; snapNext = true; camSnap = true;
    document.body.classList.toggle('replay', src.replay);
    if (src.replay) { FX.clear(); FX.clearDecals(); for (const s of cstate) { FX.trailClear(s.trailL); FX.trailClear(s.trailR); s.mark = [null, null]; } FX.trailClear(ballTrail); $('floatingMessage').className = 'hidden'; }
    else { FX.clear(); }
  }
  const lag = src.replay || !match ? 0 : clamp((performance.now() - lastStateAt) / 1000, 0, 0.08);
  for (let i = 0; i < 2; i++) {
    const raw = src.cars[i], dst = rc[i]; if (!raw) continue;
    dst.raw = raw;
    if (snapNext) { dst.x = raw.x; dst.y = raw.y; dst.z = raw.z; dst.yaw = raw.yaw; dst.pitch = raw.pitch || 0; dst.roll = raw.roll || 0; }
    // advance with the server velocity every frame, then pull toward the extrapolated server position:
    // removes the 30 Hz "stair-step" without adding delay
    const kp = 1 - Math.exp(-dt * 12);
    if (!src.replay) { dst.x += (raw.vx || 0) * dt; dst.y += (raw.vy || 0) * dt; dst.z += (raw.vz || 0) * dt; }
    dst.x += (raw.x + (raw.vx || 0) * lag - dst.x) * kp; dst.y += (raw.y + (raw.vy || 0) * lag - dst.y) * kp; dst.z += (raw.z + (raw.vz || 0) * lag - dst.z) * kp;
    if (Math.abs(raw.x - dst.x) + Math.abs(raw.z - dst.z) > 6) { dst.x = raw.x; dst.y = raw.y; dst.z = raw.z; }   // teleport (kickoff/reset)
    if (dst.y < RR.GROUND_Y && raw.grounded !== false) dst.y = RR.GROUND_Y;
    dst.yaw += wrap(raw.yaw - dst.yaw) * clamp(dt * 18, 0, 1);
    dst.pitch += wrap((raw.pitch || 0) - dst.pitch) * clamp(dt * 20, 0, 1); dst.roll += wrap((raw.roll || 0) - dst.roll) * clamp(dt * 20, 0, 1);
    dst.boostOn = !!raw.boostOn; dst.grounded = raw.grounded !== false; dst.vx = raw.vx || 0; dst.vy = raw.vy || 0; dst.vz = raw.vz || 0;
  }
  if (src.ball) {
    const b = src.ball, kb = clamp(dt * 19, 0, 1), kc = 1 - Math.exp(-dt * 14);
    if (snapNext) { ball.x = b.x; ball.y = b.y; ball.z = b.z; }
    if (!src.replay) { ball.x += (b.vx || 0) * dt; ball.y += (b.vy || 0) * dt; ball.z += (b.vz || 0) * dt; }
    ball.x += (b.x + (b.vx || 0) * lag - ball.x) * kc; ball.y += (b.y + (b.vy || 0) * lag - ball.y) * kc; ball.z += (b.z + (b.vz || 0) * lag - ball.z) * kc;
    if (ball.y < BALL_R) ball.y = BALL_R;
    if (Math.abs(b.x - ball.x) + Math.abs(b.z - ball.z) > 6) { ball.x = b.x; ball.y = b.y; ball.z = b.z; }
    ball.vx = b.vx || 0; ball.vy = b.vy || 0; ball.vz = b.vz || 0; ball.rx = lerp(ball.rx, b.rx || 0, kb); ball.rz = lerp(ball.rz, b.rz || 0, kb);
  } else {
    ball.x = 0; ball.y = 1.7 + Math.sin(tGlobal * 2.1) * 0.35; ball.z = 0; ball.rx = tGlobal * 0.3; ball.rz = tGlobal * 0.45; ball.vx = ball.vy = ball.vz = 0;
  }
  snapNext = false;
  for (let i = 0; i < 2; i++) Cars.update(cstate[i], rc[i], rc[i].raw, dt, tGlobal, i, landListener);
  // ball trail + sparks when moving fast
  const bs = Math.hypot(ball.vx, ball.vy, ball.vz), team = match ? match.lastTouch : -1;
  if (bs > 24) FX.trailPush(ballTrail, ball.x, ball.y, ball.z, tGlobal);
  // goal flash light
  const fl = World.flash;
  if (fl && fl.t > 0) { fl.t = Math.max(0, fl.t - dt * 0.7); fl.range = 70; const c = fl.col || BLUE, k = fl.t * 2.2; fl.r = c[0] * k; fl.g = c[1] * k; fl.b = c[2] * k; fl.y = 9; } else if (fl) { fl.range = 0; fl.r = fl.g = fl.b = 0; }
  // scheduled fireworks
  const nowMs = performance.now();
  fireworks = fireworks.filter(f => { if (nowMs < f.at) return true; const col = Math.random() < 0.5 ? f.col : [1, 1, 1]; FX.burst(f.x, f.y, f.z, 60, 14, col, 1.6, 0.6); FX.flare(f.x, f.y, f.z, 4, col, 0.5); return false; });
  for (let i = 0; i < padFlash.length; i++) padFlash[i] = Math.max(0, padFlash[i] - dt * 2.5);
  void team;
}

// ------------------------------------------------------------------ audio per frame
function updateAudio() {
  if (!Sound.ready) return;
  if (!joined || !match || (match.phase !== 'playing' && match.phase !== 'goal')) { Sound.silenceEngines(); return; }
  const me = rc[player]; if (!me) return;
  const mine = cstate[player];
  Sound.setEngine(0, Math.hypot(me.vx, me.vz), desired.throttle, me.boostOn, 0, 1);
  Sound.setBoost(me.boostOn, Math.hypot(me.vx, me.vz));
  const o = rc[1 - player];
  if (o) {
    const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz), fx = Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const pan = clamp((dx * -fz + dz * fx) / (d || 1) * 0.0 + (dx * Math.cos(me.yaw) + dz * Math.sin(me.yaw)) / 40, -1, 1);
    Sound.setEngine(1, Math.hypot(o.vx, o.vz), Math.hypot(o.vx, o.vz) > 2 ? 0.7 : 0, o.boostOn, pan, 1 / (1 + d / 16));
  }
  void mine;
}

// ------------------------------------------------------------------ rendering
const gl = G.gl, M4 = G.M4, skyM = new Float32Array(16);
const tcol = i => Cars.TEAMS[i].glow;
function renderScene() {
  G.resize(false);
  // ---- shadow pass (cars + ball only; they are the only moving casters)
  G.beginFrame(tGlobal, cam, cam.fov, [clamp(ball.x * 0.3, -10, 10), 0, clamp(ball.z * 0.3, -14, 14)]);
  if (G.shadowBegin()) {
    for (let i = 0; i < 2; i++) Cars.drawCar(cstate[i], rc[i], i, tGlobal, true);
    Cars.drawBall(ball, BALL_R, [0, 0, 0], true);
    G.shadowEnd();
  }
  gl.viewport(0, 0, G.W, G.H);
  gl.clearColor(0.01, 0.02, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND); gl.depthMask(true);
  G.useMain();
  // sky dome (inside-out, no depth write)
  gl.depthMask(false); gl.cullFace(gl.FRONT);
  M4.compose(skyM, cam.ex, cam.ey, cam.ez, 0, 0, 0, 380, 380, 380);
  G.mat(1, 1, 1, 1, 1, 6); G.draw(World.sphere, skyM);
  gl.cullFace(gl.BACK); gl.depthMask(true);
  // opaque world + dynamic objects
  World.drawOpaque(tGlobal, match ? match.pads : null, padFlash);
  for (let i = 0; i < 2; i++) Cars.drawCar(cstate[i], rc[i], i, tGlobal, false);
  const bs = Math.hypot(ball.vx, ball.vy, ball.vz), lt = match ? match.lastTouch : -1, tc = lt >= 0 ? tcol(lt) : [0.3, 0.7, 1];
  const rim = clamp(bs / 40, 0.15, 0.9) * 0.55;
  Cars.drawBall(ball, BALL_R, [tc[0] * rim, tc[1] * rim, tc[2] * rim], false);
  // additive meshes (flames, underglow)
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
  for (let i = 0; i < 2; i++) Cars.drawGlow(cstate[i], rc[i], i, tGlobal);
  // transparent world
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  World.drawTransparent(tGlobal);
  gl.depthMask(true); gl.disable(gl.BLEND);
  // ---- particles / glows / trails / decals
  FX.beginFrame(G.view);
  for (const tw of World.towers) FX.glow(tw.x, tw.y, tw.z, 11, 1, 0.92, 0.75, 0.5);
  for (const p of RR.PADS) if (p.type === 'large' && (!match || match.pads[p.id] !== '0')) FX.glow(p.x, 1.4, p.z, 3.2, 1, 0.75, 0.2, 0.35 + padFlash[p.id]);
  for (let i = 0; i < 2; i++) {
    Cars.lightsFx(rc[i], i);
    const s = cstate[i], c = rc[i], k = 1 - clamp((c.y - 0.66) / 9, 0, 1);
    FX.blob(c.x, c.z, 1.6 + (1 - k) * 0.6, 2.3 + (1 - k) * 0.6, -c.yaw, 0.38 * k + 0.04);
    if (G.q.trails) { const col = tcol(i); FX.drawTrail(s.trailL, tGlobal, 0.45, 0.42, 1, 0.55, 0.15, 0.7, cam.ex, cam.ey, cam.ez); FX.drawTrail(s.trailR, tGlobal, 0.45, 0.42, 1, 0.55, 0.15, 0.7, cam.ex, cam.ey, cam.ez); void col; }
  }
  const bk = 1 - clamp((ball.y - BALL_R) / 10, 0, 1);
  FX.blob(ball.x, ball.z, 1.5 + (1 - bk) * 0.7, 1.5 + (1 - bk) * 0.7, 0, 0.45 * bk + 0.03);
  if (G.q.trails && bs > 24) FX.drawTrail(ballTrail, tGlobal, 0.4, 0.8, tc[0], tc[1], tc[2], 0.55, cam.ex, cam.ey, cam.ez);
  if (bs > 30) FX.glow(ball.x, ball.y, ball.z, 2.6, tc[0], tc[1], tc[2], clamp((bs - 30) / 28, 0, 0.6));
  FX.drawDecals(tGlobal);
  FX.draw();
}

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now(), fpsEma = 60, lowFpsFor = 0, lastDowngrade = 0, stallUntil = 0, refreshEst = 60, slowFor = 0, fastFor = 0;
window.__rr = { get desired() { return desired; }, get keys() { return [...keys]; }, get touch() { return touch; }, get fps() { return fpsEma; }, get scale() { return G.scale; }, get refresh() { return refreshEst; }, setRes, bench(n = 30) { const px = new Uint8Array(4), g = G.gl; renderScene(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) { renderScene(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } return (performance.now() - t0) / n; }, G, FX, get quality() { return quality; }, get cam() { return cam; }, get camMode() { return camMode; }, get match() { return match; }, rc, ball, get padFlash() { return padFlash; }, applyQuality, setCam };
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - lastFrame) / 1000; lastFrame = now;
  const dt = clamp(rawDt, 0.0005, 0.05); tGlobal += dt;
  if (rawDt > 0 && rawDt < 0.25) fpsEma += (1 / rawDt - fpsEma) * 0.05;
  // Automatic resolution (only when the player chose AUTO): gentle, sustained-only changes so a brief hitch never
  // leaves the picture pixelated. The refresh rate is learned so 60 Hz screens are not mistaken for "slow".
  if (rawDt > 0.12 || document.hidden) stallUntil = now + 3000;
  else if (now > stallUntil) {
    refreshEst = Math.max(refreshEst * 0.9995, Math.min(fpsEma, 240));
    const slow = fpsEma < Math.min(50, refreshEst * 0.82), fast = fpsEma > refreshEst * 0.93;
    slowFor = slow ? slowFor + rawDt : 0; fastFor = fast ? fastFor + rawDt : 0;
    if (!G.userScale) {
      if (slowFor > 2 && G.scale > G.q.minScale) { G.scale = Math.max(G.q.minScale, G.scale * 0.92); slowFor = 0; }
      else if (fastFor > 1.5 && G.scale < 1) { G.scale = Math.min(1, G.scale * 1.06); fastFor = 0; }
    }
    lowFpsFor = (fpsEma < 30 && (G.userScale || G.scale <= G.q.minScale + 0.01)) ? lowFpsFor + rawDt : 0;
    if (lowFpsFor > 5 && quality !== 'low' && now - lastDowngrade > 15000) { applyQuality(quality === 'high' ? 'medium' : 'low', true); G.scale = 1; toast('Graphics set to ' + quality.toUpperCase() + ' for smoother play'); lowFpsFor = 0; lastDowngrade = now; stallUntil = now + 3000; }
  }
  updateInput();
  if (joined && now - lastInput > 33) { doSend(desired); lastSent = JSON.stringify(desired); lastInput = now; }
  if (connected && now - lastPing > 6500) { lastPing = now; doSend({ type: 'ping', sent: performance.now() }); }
  const src = gatherSource();
  updateVisuals(dt, src);
  FX.update(dt);
  updateCamera(dt, src);
  if (joined && match && player >= 0) { const c = match.cars[player]; if (c) updateBoostHud(c); }
  updateAudio();
  try { renderScene(); } catch (e) { if (!frame.err) { frame.err = true; console.error(e); toast('Rendering error — try lowering graphics.'); } }
}
try { connect(); } catch (e) { toast('WebSocket connection could not be started.'); }
requestAnimationFrame(frame);
})();
