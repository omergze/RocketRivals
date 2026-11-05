/* Rocket Rivals — procedural WebAudio (no assets): engine, boost, jump, flip, ball hit, goal horn, countdown, crowd. */
(() => {
'use strict';
const A = { ctx: null, master: null, vol: 0.7, muted: false, ready: false };
try { const v = parseFloat(localStorage.getItem('rr_vol')); if (!isNaN(v)) A.vol = Math.max(0, Math.min(1, v)); A.muted = localStorage.getItem('rr_mute') === '1'; } catch (e) {}
function applyVol() { if (A.master) A.master.gain.setTargetAtTime(A.muted ? 0 : A.vol, A.ctx.currentTime, 0.03); }
A.setVolume = v => { A.vol = v; try { localStorage.setItem('rr_vol', String(v)); } catch (e) {} applyVol(); };
A.setMuted = m => { A.muted = m; try { localStorage.setItem('rr_mute', m ? '1' : '0'); } catch (e) {} applyVol(); };

let noiseBuf = null, engines = null, boostNode = null, crowd = null;
const last = {};
const cool = (k, ms) => { const n = performance.now(); if (last[k] && n - last[k] < ms) return false; last[k] = n; return true; };

A.init = function () {          // must be called from a user gesture
  if (A.ready) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try {
    A.ctx = new AC(); const c = A.ctx;
    A.master = c.createGain(); A.master.gain.value = A.muted ? 0 : A.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    A.master.connect(comp); comp.connect(c.destination);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mkEngine = (vol) => {
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter(), pan = c.createStereoPanner ? c.createStereoPanner() : null;
      o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 400; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); if (pan) { g.connect(pan); pan.connect(A.master); } else g.connect(A.master);
      o1.start(); o2.start(); return { o1, o2, g, f, pan, vol };
    };
    engines = [mkEngine(0.10), mkEngine(0.06)];
    // boost whoosh (looped filtered noise)
    const ns = c.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.8; const bg = c.createGain(); bg.gain.value = 0;
    ns.connect(bf); bf.connect(bg); bg.connect(A.master); ns.start(); boostNode = { g: bg, f: bf };
    // crowd ambience
    const cs = c.createBufferSource(); cs.buffer = noiseBuf; cs.loop = true; const cf = c.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 700;
    const cg = c.createGain(); cg.gain.value = 0.05; cs.connect(cf); cf.connect(cg); cg.connect(A.master); cs.start(); crowd = { g: cg, f: cf };
    A.ready = true;
  } catch (e) { A.ready = false; }
};
const tone = (freq, dur, type, vol, slideTo, delay = 0) => {
  if (!A.ready) return; const c = A.ctx, t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(A.master); o.start(t0); o.stop(t0 + dur + 0.05);
};
const noise = (dur, vol, f0, f1, type = 'bandpass', delay = 0) => {
  if (!A.ready) return; const c = A.ctx, t0 = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(A.master); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
};
// continuous: own car (index 0) and opponent (index 1)
A.setEngine = function (i, speed, throttle, boosting, pan, near) {
  if (!A.ready || !engines) return; const e = engines[i], t = A.ctx.currentTime;
  const base = 52 + Math.min(1, speed / 38) * 150 + (boosting ? 22 : 0) + throttle * 8;
  e.o1.frequency.setTargetAtTime(base, t, 0.06); e.o2.frequency.setTargetAtTime(base * 0.503, t, 0.06);
  e.f.frequency.setTargetAtTime(260 + speed * 16 + (boosting ? 420 : 0), t, 0.08);
  e.g.gain.setTargetAtTime((0.35 + 0.65 * Math.abs(throttle) + Math.min(1, speed / 30) * 0.3) * e.vol * near, t, 0.05);
  if (e.pan) e.pan.pan.setTargetAtTime(pan, t, 0.1);
};
A.setBoost = function (on, speed) {
  if (!A.ready || !boostNode) return; const t = A.ctx.currentTime;
  boostNode.g.gain.setTargetAtTime(on ? 0.16 : 0, t, on ? 0.04 : 0.12); boostNode.f.frequency.setTargetAtTime(700 + speed * 25, t, 0.1);
};
A.setCrowd = function (level) { if (A.ready && crowd) { crowd.g.gain.setTargetAtTime(0.03 + level * 0.12, A.ctx.currentTime, 0.3); crowd.f.frequency.setTargetAtTime(500 + level * 900, A.ctx.currentTime, 0.3); } };
A.silenceEngines = function () { if (!A.ready) return; for (const e of engines) e.g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1); A.setBoost(false, 0); };

A.jump = () => { if (!cool('jump', 60)) return; tone(190, 0.12, 'square', 0.05, 330); noise(0.06, 0.05, 1800, 400); };
A.flip = () => { if (!cool('flip', 80)) return; noise(0.22, 0.16, 500, 3200); tone(320, 0.2, 'triangle', 0.05, 640); };
A.land = (impact) => { if (!cool('land', 120)) return; const v = Math.min(0.2, impact * 0.012); tone(90, 0.15, 'sine', v, 45); noise(0.1, v * 0.8, 900, 150, 'lowpass'); };
A.hit = (power) => { if (!cool('hit', 90)) return; const k = Math.min(1, power / 36); tone(150 + k * 60, 0.2, 'sine', 0.1 + k * 0.22, 55); noise(0.09 + k * 0.1, 0.06 + k * 0.22, 2600, 220, 'lowpass'); if (k > 0.5) tone(900, 0.1, 'triangle', 0.05 * k, 300); };
A.wall = (speed) => { if (!cool('wall', 140)) return; const k = Math.min(1, speed / 30); tone(120, 0.12, 'sine', 0.04 + 0.08 * k, 60); };
A.pad = (big) => { if (!cool('pad' + big, 70)) return; if (big) { tone(520, 0.18, 'triangle', 0.1, 1040); tone(780, 0.22, 'triangle', 0.08, 1560, 0.06); } else tone(880, 0.08, 'triangle', 0.06, 1300); };
A.tick = () => { tone(660, 0.12, 'square', 0.07); };
A.go = () => { tone(990, 0.4, 'square', 0.09); tone(1320, 0.5, 'triangle', 0.07, null, 0.02); };
A.goal = (mine) => {
  if (!cool('goal', 1500)) return;
  for (const [f, d] of [[392, 0], [523, 0.16], [659, 0.32], [784, 0.5]]) tone(f, 0.45, 'sawtooth', 0.07, f * 1.005, d);
  tone(110, 1.5, 'sawtooth', 0.09, 98); noise(1.6, 0.14, 800, 3500, 'bandpass'); A.setCrowd(1); setTimeout(() => A.setCrowd(0.2), 3500);
  if (!mine) tone(220, 0.6, 'triangle', 0.05, 160, 0.5);
};
A.final = () => { for (const [f, d] of [[523, 0], [392, 0.2], [330, 0.4]]) tone(f, 0.5, 'triangle', 0.08, null, d); };
A.click = () => tone(700, 0.05, 'triangle', 0.05, 900);
window.Sound = A;
})();
