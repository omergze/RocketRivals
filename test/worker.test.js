const assert = require('node:assert/strict');
const WebSocket = globalThis.WebSocket;
const url = 'ws://127.0.0.1:8787/ws';
function client() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), messages = [];
    ws.addEventListener('open', () => resolve({ws, messages, send: o => ws.send(JSON.stringify(o)), wait: (type, timeout=6000) => new Promise((res, rej) => {
      const start = Date.now(); const poll = () => {
        const i = messages.findIndex(m => m.type === type);
        if (i >= 0) return res(messages.splice(i, 1)[0]);
        if (Date.now() - start > timeout) return rej(new Error('timeout '+type+' '+JSON.stringify(messages.slice(-3))));
        setTimeout(poll, 20);
      }; poll();
    })}));
    ws.addEventListener('message', e => { try { messages.push(JSON.parse(e.data)); } catch {} });
    ws.addEventListener('error', reject);
  });
}
(async () => {
  const a = await client(), b = await client();
  a.send({type:'ping',sent:123}); assert.equal((await a.wait('pong')).sent,123);
  a.send({type:'create'}); const room = await a.wait('room'); assert.match(room.code,/^[A-Z2-9]{5}$/);
  b.send({type:'join',code:room.code}); assert.equal((await b.wait('room')).code,room.code);
  await a.wait('peer_joined'); await b.wait('peer_joined');
  let sa, sb; do { sa=await a.wait('state'); } while(sa.phase === 'waiting'); do { sb=await b.wait('state'); } while(sb.phase === 'waiting'); assert.equal(sa.phase,sb.phase);
  a.send({type:'input',throttle:1,steer:0}); await a.wait('state'); await b.wait('state');
  b.send({type:'leave'}); await b.wait('left'); await a.wait('peer_left');
  const c=await client(); c.send({type:'join',code:room.code}); await c.wait('room'); await a.wait('peer_joined');
  a.send({type:'leave'}); await a.wait('left'); c.send({type:'leave'}); await c.wait('left');
  const d=await client(), e=await client(); d.send({type:'find'}); await d.wait('searching'); e.send({type:'find'});
  const dr=await d.wait('room'), er=await e.wait('room'); assert.equal(dr.code,er.code); await d.wait('peer_joined'); await e.wait('peer_joined');
  await d.wait('state'); await e.wait('state'); d.send({type:'leave'}); await d.wait('left'); await e.wait('peer_left');
  e.send({type:'solo'}); await e.wait('room'); await e.wait('peer_joined'); await e.wait('state');
  for(const x of [a,b,c,d,e]) x.ws.close();
  console.log('Worker WebSocket: private room, join, state, input, reconnect, matchmaking, bot passed');
})().catch(e => { console.error(e); process.exitCode=1; });
