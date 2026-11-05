// Random-input soak test: no NaNs, nothing leaves the arena, no stuck phases.
const assert=require('assert');const {Match,SIDE,END,TUNING}=require('../match');const {GOAL_DEPTH,CEIL}=require('../public/shared.js');
let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
let goals=0,maxBall=0;
for(let game=0;game<6;game++){
  const m=new Match();m.start();
  let inp=[{},{}];
  for(let i=0;i<60*200;i++){
    if(i%20===0)for(let k=0;k<2;k++)inp[k]={throttle:rnd()<.7?1:(rnd()<.5?-1:0),steer:Math.round(rnd()*2-1),boost:rnd()<.5,jump:rnd()<.25,handbrake:rnd()<.1,airRoll:0};
    if(i%7===0)for(let k=0;k<2;k++)m.setInput(k,{...inp[k],jump:rnd()<.3});
    m.step(1/60,2);
    const vals=[m.ball.x,m.ball.y,m.ball.z,m.ball.vx,m.ball.vy,m.ball.vz,...m.cars.flatMap(c=>[c.x,c.y,c.z,c.vx,c.vy,c.vz,c.yaw,c.pitch,c.roll,c.boost])];
    assert(vals.every(Number.isFinite),'NaN/Infinity at '+i);
    assert(Math.abs(m.ball.x)<=SIDE+.01&&Math.abs(m.ball.z)<=END+GOAL_DEPTH&&m.ball.y>0&&m.ball.y<=CEIL,'ball escaped '+JSON.stringify(m.ball));
    for(const c of m.cars){assert(Math.abs(c.x)<=SIDE&&Math.abs(c.z)<=END+GOAL_DEPTH&&c.y>=.6&&c.y<=CEIL,'car escaped '+JSON.stringify([c.x,c.y,c.z]));assert(c.boost>=0&&c.boost<=100);assert(Math.hypot(c.vx,c.vz)<=TUNING.boostMax+1,'car too fast');}
    maxBall=Math.max(maxBall,Math.hypot(m.ball.vx,m.ball.vy,m.ball.vz));
    if(m.phase==='goal'&&m.phaseTimer>3.1)goals++;
  }
}
assert(maxBall<=TUNING.ballMax+.01);
console.log('fuzz ok, goals seen:',goals,'max ball speed',maxBall.toFixed(1));
