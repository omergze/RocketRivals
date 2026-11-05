import { Match, botThink } from './match.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const bot = { isBot: true, send() {} };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('WebSocket upgrade required', { status: 426 });
      return env.MATCHES.get(env.MATCHES.idFromName('global')).fetch(request);
    }
    if (url.pathname === '/health') return Response.json({ ok: true });
    return env.ASSETS.fetch(request);
  }
};

export class Matches {
  constructor(state) {
    this.state = state;
    this.rooms = new Map();
    this.queue = [];
    this.peers = new Map();
    this.steps = 0;
    this.lastTick = Date.now();
    this.timer = null;
    for (const socket of state.getWebSockets()) {
      const peer = { socket, room: null, slot: -1, inputAt: 0, lastInput: 0 };
      this.peers.set(socket, peer);
    }
    if (this.peers.size) this.startTimer();
  }
  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.peers.set(server, { socket: server, room: null, slot: -1, inputAt: 0, lastInput: 0 });
    this.startTimer();
    return new Response(null, { status: 101, webSocket: client });
  }
  send(peer, data) {
    if (!peer || peer.isBot) return;
    try { peer.socket.send(JSON.stringify(data)); } catch { this.leave(peer); this.peers.delete(peer.socket); }
  }
  code() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      const code = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Room codes exhausted');
  }
  leave(peer) {
    this.queue = this.queue.filter(p => p !== peer);
    const room = peer.room;
    if (!room) return;
    room.players[peer.slot] = null;
    peer.room = null; peer.slot = -1;
    const other = room.players.find(p => p && !p.isBot);
    if (other && room.public) {
      other.room = null; other.slot = -1;
      this.rooms.delete(room.code);
      this.send(other, { type: 'peer_left', public: true });
    } else if (other) {
      room.game.phase = 'waiting';
      room.lastActive = Date.now();
      this.send(other, { type: 'peer_left' });
    } else this.rooms.delete(room.code);
  }
  newRoom(peer, extra = {}) {
    this.leave(peer);
    if (this.rooms.size >= 250) return this.send(peer, { type: 'error', message: 'All rooms are busy. Please try again later.' });
    const room = { code: this.code(), players: [peer, null], game: new Match(), lastActive: Date.now(), bot: false, public: false, ...extra };
    this.rooms.set(room.code, room);
    peer.room = room; peer.slot = 0;
    this.send(peer, { type: 'room', code: room.code, player: 0 });
    return room;
  }
  join(peer, room) {
    const slot = room.players[0] ? 1 : 0;
    room.players[slot] = peer; peer.room = room; peer.slot = slot;
    room.lastActive = Date.now();
    this.send(peer, { type: 'room', code: room.code, player: slot, public: room.public });
    room.players.forEach(p => this.send(p, { type: 'peer_joined' }));
    room.game.start();
    room.players.forEach(p => this.send(p, room.game.snapshot()));
  }
  webSocketMessage(socket, data) {
    const peer = this.peers.get(socket);
    if (!peer || typeof data !== 'string' || data.length > 8192) return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'create') {
      const room = this.newRoom(peer);
      if (room) this.send(peer, room.game.snapshot());
    } else if (msg.type === 'solo') {
      const room = this.newRoom(peer, { bot: true });
      if (room) {
        room.players[1] = bot;
        this.send(peer, { type: 'peer_joined' });
        room.game.start();
        this.send(peer, room.game.snapshot());
      }
    } else if (msg.type === 'find' || msg.type === 'quick') {
      if (this.queue.includes(peer)) return this.send(peer, { type: 'searching', waiting: this.queue.length });
      this.leave(peer);
      let opponent;
      while (this.queue.length && !opponent) {
        const candidate = this.queue.shift();
        if (this.peers.has(candidate.socket) && candidate !== peer && !candidate.room) opponent = candidate;
      }
      if (!opponent) {
        this.queue.push(peer);
        return this.send(peer, { type: 'searching', waiting: this.queue.length });
      }
      if (this.rooms.size >= 250) {
        this.queue.unshift(opponent);
        return this.send(peer, { type: 'error', message: 'All matches are busy. Please try again later.' });
      }
      const room = { code: this.code(), players: [opponent, peer], game: new Match(), lastActive: Date.now(), bot: false, public: true };
      room.game.autoRestart = false;
      this.rooms.set(room.code, room);
      for (let i = 0; i < 2; i++) {
        room.players[i].room = room; room.players[i].slot = i;
        this.send(room.players[i], { type: 'room', code: room.code, player: i, public: true });
      }
      room.players.forEach(p => this.send(p, { type: 'peer_joined' }));
      room.game.start();
      room.players.forEach(p => this.send(p, room.game.snapshot()));
    } else if (msg.type === 'cancel') {
      if (this.queue.includes(peer)) {
        this.queue = this.queue.filter(p => p !== peer);
        this.send(peer, { type: 'search_cancelled' });
      }
    } else if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const room = this.rooms.get(code);
      if (!room || room.bot || room.public) return this.send(peer, { type: 'error', message: 'Room not found. Check the code.' });
      if (room.players.every(Boolean) && !room.players.includes(peer)) return this.send(peer, { type: 'error', message: 'Room is full (2 players max).' });
      if (peer.room === room) return this.send(peer, { type: 'room', code, player: peer.slot });
      this.leave(peer);
      this.join(peer, room);
    } else if (msg.type === 'input' && peer.room) {
      const now = Date.now();
      if (now - peer.lastInput < 3) return;
      peer.lastInput = now; peer.inputAt = now;
      peer.room.game.setInput(peer.slot, msg);
      peer.room.lastActive = now;
    } else if (msg.type === 'ping') this.send(peer, { type: 'pong', sent: msg.sent });
    else if (msg.type === 'leave') { this.leave(peer); this.send(peer, { type: 'left' }); }
  }
  webSocketClose(socket) { const peer = this.peers.get(socket); if (peer) { this.leave(peer); this.peers.delete(socket); } }
  webSocketError(socket) { this.webSocketClose(socket); }
  startTimer() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }
  tick() {
    if (!this.peers.size) { clearInterval(this.timer); this.timer = null; return; }
    const now = Date.now();
    const count = Math.min(4, Math.max(1, Math.round((now - this.lastTick) / (1000 / 60))));
    this.lastTick = now;
    for (const [code, room] of this.rooms) {
      if (now - room.lastActive > 3600000) {
        room.players.forEach(p => { if (p && !p.isBot) this.leave(p); });
        this.rooms.delete(code);
      }
      for (const p of room.players) if (p && !p.isBot && p.inputAt && now - p.inputAt > 600) {
        room.game.setInput(p.slot, {}); p.inputAt = 0;
      }
    }
    for (let i = 0; i < count; i++) {
      for (const room of this.rooms.values()) {
        if (!room.players[0] || !room.players[1]) continue;
        if (room.bot && room.game.seq % 4 === 0) botThink(room.game, 1);
        room.game.step(1 / 60, 2);
        if (room.game.ended) {
          room.players.forEach(p => { if (p && !p.isBot) { p.room = null; p.slot = -1; this.send(p, { type: 'match_over' }); } });
          this.rooms.delete(room.code);
        }
      }
      this.steps++;
      if (this.steps % 2 === 0) for (const room of this.rooms.values()) {
        if (room.players.some(p => p && !p.isBot) && (room.players.every(Boolean) || this.steps % 60 === 0)) {
          const packet = room.game.snapshot();
          room.players.forEach(p => this.send(p, packet));
        }
      }
    }
  }
}
