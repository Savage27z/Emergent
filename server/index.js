const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');

// --- Persistence ---
// node:sqlite is flagged experimental on Node 25 but stable in practice;
// TODO: swap to better-sqlite3 only if an upgrade breaks it.
const db = new DatabaseSync(path.join(__dirname, '..', 'world.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color INTEGER NOT NULL,
    x REAL NOT NULL DEFAULT 0,
    z REAL NOT NULL DEFAULT 0,
    ry REAL NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL
  )
`);
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const upsertPlayer = db.prepare(`
  INSERT INTO players (id, name, color, x, z, ry, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET x=excluded.x, z=excluded.z, ry=excluded.ry, last_seen=excluded.last_seen
`);
const countPlayers = db.prepare('SELECT COUNT(*) AS n FROM players');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

// World state: the server's player table is the source of truth for who exists.
// TODO(server-authority): positions are still client-reported; later the client
// should send inputs and the server should simulate movement itself.
const players = new Map(); // socket.id -> { id, x, z, ry, color, name, pid }

const PALETTE = [0xe07a5f, 0x3d8bd4, 0xf2cc8f, 0x81b29a, 0xb56dc4, 0xe8628c];

io.on('connection', (socket) => {
  // pid is the client's persistent identity (localStorage UUID); socket.id is per-connection
  const pid = typeof socket.handshake.auth?.pid === 'string' ? socket.handshake.auth.pid.slice(0, 64) : socket.id;
  const saved = getPlayer.get(pid);
  const n = countPlayers.get().n;
  const player = saved
    ? { id: socket.id, pid, x: saved.x, z: saved.z, ry: saved.ry, color: saved.color, name: saved.name }
    : { id: socket.id, pid, x: 0, z: 0, ry: 0, color: PALETTE[n % PALETTE.length], name: `wanderer-${n + 1}` };
  players.set(socket.id, player);
  upsertPlayer.run(pid, player.name, player.color, player.x, player.z, player.ry, Date.now());
  console.log(`${player.name} connected (${players.size} online)`);

  // tell the newcomer who they are and who's already here (pid stays server-side)
  socket.emit('welcome', { self: publicView(player), players: [...players.values()].map(publicView) });
  socket.broadcast.emit('player-joined', publicView(player));

  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p || typeof data?.x !== 'number' || typeof data?.z !== 'number') return;
    p.x = Math.max(-58, Math.min(58, data.x));
    p.z = Math.max(-58, Math.min(58, data.z));
    p.ry = typeof data.ry === 'number' ? data.ry : p.ry;
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) upsertPlayer.run(p.pid, p.name, p.color, p.x, p.z, p.ry, Date.now());
    players.delete(socket.id);
    io.emit('player-left', socket.id);
    console.log(`${player.name} disconnected (${players.size} online)`);
  });
});

// flush positions to SQLite every 5s so a crash loses at most 5s of movement
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) upsertPlayer.run(p.pid, p.name, p.color, p.x, p.z, p.ry, now);
}, 5000);

function publicView({ id, name, color, x, z, ry }) {
  return { id, name, color, x, z, ry };
}

// --- NPCs (server-simulated) ---
// No brain yet: random wander. This is the slot where the agent module's
// planner will plug in — it will emit actions instead of random headings.
const npcs = [
  { id: 'npc-ember', name: 'Ember', color: 0xd94f30, x: 8, z: 8, ry: 0, heading: 0, idle: 0 },
];

const NPC_SPEED = 2.5;
setInterval(() => {
  const dt = 0.1;
  for (const npc of npcs) {
    if (npc.idle > 0) {
      npc.idle -= dt;
      continue;
    }
    // occasionally stop and look around, or pick a new heading
    if (Math.random() < 0.02) npc.idle = 1 + Math.random() * 3;
    if (Math.random() < 0.03) npc.heading = Math.random() * Math.PI * 2;
    npc.x += Math.sin(npc.heading) * NPC_SPEED * dt;
    npc.z += Math.cos(npc.heading) * NPC_SPEED * dt;
    // stay near the village center
    if (Math.hypot(npc.x, npc.z) > 25) npc.heading = Math.atan2(-npc.x, -npc.z);
    npc.ry = npc.heading;
  }
}, 100);

// broadcast a world snapshot at 20Hz (players + NPCs share the pipeline)
// world time is server-owned so all clients share the same day/night
const worldStart = Date.now();
setInterval(() => {
  if (players.size > 0) {
    io.emit('snapshot', {
      time: (Date.now() - worldStart) / 1000,
      entities: [...players.values(), ...npcs].map(publicView),
    });
  }
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EMERGENT server running at http://localhost:${PORT}`);
});
