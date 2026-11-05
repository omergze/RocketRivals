// Rocket Rivals — HTTP + WebSocket server (no dependencies). Deploy on Render as a Node web service.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Match, botThink } = require('./match');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
const STATIC_FILES = new Map();
for (const name of fs.readdirSync(PUBLIC_DIR)) {
  const file = path.join(PUBLIC_DIR, name);
  if (fs.statSync(file).isFile()) STATIC_FILES.set('/' + name, fs.readFileSync(file));
}

const rooms = new Map();
const connections = new Set();
const MAX_ROOMS = 250;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let str = '';
    for (let i = 0; i < 5; i++) str += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(str)) return str;
  }
  throw new Error('Too many rooms');
}

const server = http.createServer((req, res) => {
  const rawPath = (req.url || '/').split('?')[0];
  if (rawPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(rawPath); } catch (e) { res.writeHead(400); res.end(); return; }
  const requested = pathname === '/' ? '/index.html' : pathname;
  let body = STATIC_FILES.get(requested);
  if (body && process.env.DEV_RELOAD) { try { body = fs.readFileSync(path.join(PUBLIC_DIR, requested.slice(1))); } catch (e) {} }   // local dev: pick up edits without restarting
  if (!body) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
  const ext = requested.substring(requested.lastIndexOf('.'));
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
});

const botPeer = { isBot: true, send() {}, close() {} };
// Public matchmaking queue: peers waiting for a real opponent (never filled with a bot).
const queue = [];
const dequeue = peer => { const i = queue.indexOf(peer); if (i >= 0) queue.splice(i, 1); return i >= 0; };

let peerCounter = 0;
class Peer {
  constructor(socket) {
    this.id = ++peerCounter; this.socket = socket; this.buffer = Buffer.alloc(0); this.room = null; this.slot = -1;
    this.closed = false; this.lastSeen = Date.now(); this.lastInput = 0; this.inputAt = 0; this.msgWindow = Date.now(); this.msgCount = 0;
    connections.add(this);
    socket.on('data', data => this.receive(data));
    socket.on('error', () => this.close());
    socket.on('end', () => this.close());
    socket.on('close', () => this.close());
    socket.setNoDelay(true);
  }
  send(data) {
    if (this.closed || !this.socket.writable) return;
    const payload = Buffer.from(JSON.stringify(data));
    let header;
    if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else return;
    try { this.socket.write(Buffer.concat([header, payload])); } catch (e) { this.close(); }
  }
  ping() { if (!this.closed && this.socket.writable) this.socket.write(Buffer.from([0x89, 0])); }
  receive(chunk) {
    if (this.closed) return;
    this.lastSeen = Date.now();
    if (this.buffer.length + chunk.length > 65536) { this.close(); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const opcode = b0 & 15, masked = (b1 & 128) !== 0;
      let len = b1 & 127, head = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); head = 4; }
      if (len === 127 || len > 8192 || !masked || (b0 & 0x70) !== 0) { this.close(); return; }
      if (this.buffer.length < head + 4 + len) return;
      const mask = this.buffer.subarray(head, head + 4);
      const payload = Buffer.from(this.buffer.subarray(head + 4, head + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(head + 4 + len);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.socket.write(Buffer.from([0x8a, 0])); continue; }
      if (opcode === 10) continue;
      if (opcode !== 1 || (b0 & 0x80) === 0) { this.close(); return; }
      let obj; try { obj = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
      // flood protection: legit clients send well under 100 msgs/s
      const t = Date.now();
      if (t - this.msgWindow > 1000) { this.msgWindow = t; this.msgCount = 0; }
      if (++this.msgCount > 200) { this.close(); return; }
      try { this.handle(obj); } catch (e) { console.error('handler error', e); }
    }
  }
  leave() {
    dequeue(this);
    const room = this.room;
    if (!room) return;
    room.players[this.slot] = null;
    this.room = null; this.slot = -1;
    const other = room.players.find(Boolean);
    if (other && !other.isBot && room.public) {      // matchmade game: opponent gone -> back to the menu, room is destroyed
      other.room = null; other.slot = -1; rooms.delete(room.code);
      other.send({ type: 'peer_left', public: true });
    } else if (other && !other.isBot) {
      room.game.phase = 'waiting';
      other.send({ type: 'peer_left' });
      room.lastActive = Date.now();
    } else rooms.delete(room.code);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.leave();
    connections.delete(this);
    if (!this.socket.destroyed) this.socket.destroy();
  }
  newRoom(extra) {
    this.leave();
    if (rooms.size >= MAX_ROOMS) { this.send({ type: 'error', message: 'All rooms are busy. Please try again later.' }); return null; }
    const code = roomCode();
    const room = { code, players: [this, null], game: new Match(), lastActive: Date.now(), bot: false, public: false, ...extra };
    rooms.set(code, room);
    this.room = room; this.slot = 0;
    this.send({ type: 'room', code, player: 0 });
    return room;
  }
  joinRoom(room) {
    const slot = room.players[0] ? 1 : 0;
    room.players[slot] = this; this.room = room; this.slot = slot;
    room.lastActive = Date.now();
    this.send({ type: 'room', code: room.code, player: slot, public: !!room.public });
    room.players.forEach(peer => peer && peer.send({ type: 'peer_joined' }));
    room.game.start();
    room.players.forEach(peer => peer && peer.send(room.game.snapshot()));
  }
  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (process.env.LOG_MSGS && msg.type !== 'input' && msg.type !== 'ping') console.log(new Date().toISOString().slice(11, 19), this.id, msg.type, msg.code || '');
    if (msg.type === 'create') {
      const room = this.newRoom();
      if (room) this.send(room.game.snapshot());
    } else if (msg.type === 'solo') {
      const room = this.newRoom({ bot: true });
      if (!room) return;
      room.players[1] = botPeer;
      this.send({ type: 'peer_joined' });
      room.game.start();
      this.send(room.game.snapshot());
    } else if (msg.type === 'find' || msg.type === 'quick') {
      if (queue.includes(this)) { this.send({ type: 'searching', waiting: queue.length }); return; }   // duplicate request
      this.leave();
      let opp = null;
      while (queue.length && !opp) { const q = queue.shift(); if (!q.closed && q !== this && !q.room) opp = q; }
      if (!opp) { queue.push(this); this.send({ type: 'searching', waiting: queue.length }); return; }
      if (rooms.size >= MAX_ROOMS) { queue.unshift(opp); this.send({ type: 'error', message: 'All matches are busy. Please try again later.' }); return; }
      const code = roomCode();
      const room = { code, players: [null, null], game: new Match(), lastActive: Date.now(), bot: false, public: true };
      rooms.set(code, room); room.game.autoRestart = false;
      opp.room = room; opp.slot = 0; this.room = room; this.slot = 1; room.players[0] = opp; room.players[1] = this;
      opp.send({ type: 'room', code, player: 0, public: true }); this.send({ type: 'room', code, player: 1, public: true });
      room.players.forEach(p => p.send({ type: 'peer_joined' }));
      room.game.start();
      room.players.forEach(p => p.send(room.game.snapshot()));
    } else if (msg.type === 'cancel') {
      if (dequeue(this)) this.send({ type: 'search_cancelled' });
    } else if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const room = rooms.get(code);
      if (!room || room.bot || room.public) { this.send({ type: 'error', message: 'Room not found. Check the code.' }); return; }
      if (room.players.every(Boolean) && !room.players.includes(this)) {
        this.send({ type: 'error', message: 'Room is full (2 players max).' }); return;
      }
      if (this.room === room) { this.send({ type: 'room', code, player: this.slot }); return; }
      this.leave();
      this.joinRoom(room);
    } else if (msg.type === 'input' && this.room) {
      const now = Date.now();
      if (now - this.lastInput < 3) return;
      this.lastInput = now;
      this.room.game.setInput(this.slot, msg);
      this.inputAt = now;
      this.room.lastActive = now;
    } else if (msg.type === 'ping') {
      this.send({ type: 'pong', sent: msg.sent });
    } else if (msg.type === 'leave') {
      this.leave(); this.send({ type: 'left' });
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url?.split('?')[0] !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || typeof key !== 'string') {
    socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = new Peer(socket);
  if (head.length) peer.receive(head);
});

// Fixed 60 Hz simulation, snapshots at 30 Hz.
let lastTick = process.hrtime.bigint(), accumulator = 0, steps = 0;
const tick = setInterval(() => { try {
  const now = process.hrtime.bigint();
  const dt = Number(now - lastTick) / 1e9; lastTick = now;
  accumulator += Math.min(0.1, Math.max(0, dt));
  let n = 0;
  while (accumulator >= 1 / 60 && n < 4) { accumulator -= 1 / 60; n++; }
  if (accumulator > 1 / 30) accumulator = 0;
  const nowMs = Date.now();
  for (const room of rooms.values()) {
    // a client that stops sending input (hidden tab, lag spike) must not keep driving
    for (const p of room.players) {
      if (p && !p.isBot && p.inputAt && nowMs - p.inputAt > 600) { room.game.setInput(p.slot, {}); p.inputAt = 0; }
    }
  }
  for (let i = 0; i < n; i++) {
    for (const room of rooms.values()) {
      if (room.players[0] && room.players[1]) {
        if (room.bot && room.game.seq % 4 === 0) botThink(room.game, 1);
        room.game.step(1 / 60, 2);
        if (room.game.ended) {   // matchmade game finished: release both players so they can queue again
          for (const p of room.players) if (p) { p.room = null; p.slot = -1; p.send({ type: 'match_over' }); }
          rooms.delete(room.code); break;
        }
      }
    }
    steps++;
    if (steps % 2 === 0) {
      for (const room of rooms.values()) {
        const full = room.players[0] && room.players[1];
        if (room.players.some(p => p && !p.isBot) && (full || steps % 60 === 0)) {
          const packet = room.game.snapshot();
          room.players.forEach(p => p && p.send(packet));
        }
      }
    }
  }
} catch (e) { console.error('tick error', e); } }, 1000 / 120);
tick.unref();

setInterval(() => {
  for (const peer of connections) {
    if (Date.now() - peer.lastSeen > 75000) peer.close(); else peer.ping();
  }
  for (const [code, room] of rooms) {
    if (!room.players.some(p => p && !p.isBot) || Date.now() - room.lastActive > 3600000) {
      room.players.forEach(p => p && p.close()); rooms.delete(code);
    }
  }
}, 30000).unref();

server.on('error', e => { console.error('server error', e); process.exit(1); });
server.on('clientError', (e, socket) => { try { socket.destroy(); } catch (_) {} });
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('SIGTERM', () => { for (const p of connections) p.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Rocket Rivals ready on http://localhost:${PORT}`));
}
module.exports = { server, rooms };
