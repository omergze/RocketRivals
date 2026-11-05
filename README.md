# Rocket Rivals
1v1 car soccer in the browser. Zero dependencies (Node >= 18).

Local: `npm start` → http://localhost:3000   ·   edit-friendly: `DEV_RELOAD=1 npm start` (serves `public/` from disk on every request)
Tests: `npm test` (physics, fuzz, real-WebSocket network suite)

## Layout
- `server.js` HTTP + WebSocket server, rooms, bot, quick match
- `match.js` authoritative 60 Hz physics, boost pads, bot AI
- `public/shared.js` arena size, boost pad layout, tuning values (used by server AND client)
- `public/gl.js world.js cars.js fx.js audio.js game.js` WebGL renderer, stadium, cars, particles, sound, client

## Tuning
Everything gameplay-related lives in `public/shared.js` (`TUNING`, `PAD_TYPES`, pad layout, kickoff positions).

## Render
Push this folder to GitHub → Render → New → Blueprint (uses `render.yaml`). Health check `/health`.
Free plan sleeps when idle (first load ~30 s); rooms are in memory.

Controls: WASD drive · Shift boost · Space jump (tap again + direction = flip) · Ctrl drift · W/S pitch in air · Q/E air roll · C ball cam · M mute. Settings (⚙): graphics LOW/MED/HIGH, volume, camera shake.

## Northflank (public multiplayer)
1. New service → Combined (build + deploy) → connect the GitHub repo → build type **Dockerfile** (or Buildpack; both work).
2. Networking: add port **8080**, protocol **HTTP**, tick **Publish this port publicly**. Northflank terminates TLS, so the page is served over `https://` and the client automatically opens `wss://<your-domain>/ws` (same host/port as the page; there is no hard-coded endpoint).
3. Health check: HTTP `/health` on port 8080. If your platform injects a different `PORT`, the server uses it (`process.env.PORT`, bound to `0.0.0.0`).
4. Run a **single instance**: rooms and the matchmaking queue live in process memory, so two replicas would not see each other's players.
Players use **PLAY ONLINE** (public queue) or **Create private room** + invite link/code.
