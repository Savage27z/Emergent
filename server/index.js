const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const { MemoryStream } = require('../agents/memory');

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
try {
  db.exec("ALTER TABLE players ADD COLUMN hat TEXT NOT NULL DEFAULT 'none'");
} catch { /* column already exists */ }
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const upsertPlayer = db.prepare(`
  INSERT INTO players (id, name, color, x, z, ry, hat, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, hat=excluded.hat,
    x=excluded.x, z=excluded.z, ry=excluded.ry, last_seen=excluded.last_seen
`);
const countPlayers = db.prepare('SELECT COUNT(*) AS n FROM players');
const memories = new MemoryStream(path.join(__dirname, '..', 'world.sqlite'));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

// peek inside an agent's head
app.get('/api/agents/:id/memories', (req, res) => {
  const id = String(req.params.id).slice(0, 32);
  res.json({ count: memories.count(id), memories: memories.recent(id, 30) });
});

// World state: the server's player table is the source of truth for who exists.
// TODO(server-authority): positions are still client-reported; later the client
// should send inputs and the server should simulate movement itself.
const players = new Map(); // socket.id -> { id, x, z, ry, color, name, pid }

const PALETTE = [0xe07a5f, 0x3d8bd4, 0xf2cc8f, 0x81b29a, 0xb56dc4, 0xe8628c];

io.on('connection', (socket) => {
  // pid is the client's persistent identity (localStorage UUID); socket.id is per-connection
  const auth = socket.handshake.auth ?? {};
  const pid = typeof auth.pid === 'string' ? auth.pid.slice(0, 64) : socket.id;
  const saved = getPlayer.get(pid);
  const n = countPlayers.get().n;

  // profile from the client wins (that's how you re-customize), then saved, then defaults
  const name =
    (typeof auth.name === 'string' && auth.name.trim().slice(0, 16)) ||
    saved?.name ||
    `wanderer-${n + 1}`;
  const color = Number.isInteger(auth.color) && auth.color >= 0 && auth.color <= 0xffffff
    ? auth.color
    : saved?.color ?? PALETTE[n % PALETTE.length];
  const hat = ['none', 'cone', 'crown'].includes(auth.hat) ? auth.hat : saved?.hat ?? 'none';

  // the world is an island — pull far-out saved positions back to shore
  let sx = saved?.x ?? 0, sz = saved?.z ?? 0;
  const r = Math.hypot(sx, sz);
  if (r > 300) {
    sx = (sx / r) * 300;
    sz = (sz / r) * 300;
  }
  const player = { id: socket.id, pid, name, color, hat, x: sx, z: sz, ry: saved?.ry ?? 0 };
  players.set(socket.id, player);
  upsertPlayer.run(pid, player.name, player.color, player.x, player.z, player.ry, player.hat, Date.now());
  console.log(`${player.name} connected (${players.size} online)`);

  // tell the newcomer who they are and who's already here (pid stays server-side)
  socket.emit('welcome', { self: publicView(player), players: [...players.values()].map(publicView) });
  socket.broadcast.emit('player-joined', publicView(player));

  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p || typeof data?.x !== 'number' || typeof data?.z !== 'number') return;
    p.x = Math.max(-340, Math.min(340, data.x));
    p.z = Math.max(-340, Math.min(340, data.z));
    p.ry = typeof data.ry === 'number' ? data.ry : p.ry;
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) upsertPlayer.run(p.pid, p.name, p.color, p.x, p.z, p.ry, p.hat, Date.now());
    players.delete(socket.id);
    io.emit('player-left', socket.id);
    console.log(`${player.name} disconnected (${players.size} online)`);
  });
});

// flush positions to SQLite every 5s so a crash loses at most 5s of movement
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) upsertPlayer.run(p.pid, p.name, p.color, p.x, p.z, p.ry, p.hat, now);
}, 5000);

function publicView({ id, name, color, x, z, ry, hat, status }) {
  return { id, name, color, x, z, ry, hat: hat ?? 'none', status };
}

// --- NPCs (server-simulated) ---
// Routine skeleton, still no brain: a time-of-day schedule picks a place and
// an activity. This is exactly the slot where the agent module's planner will
// plug in — it will emit (place, activity) pairs instead of this table.
const DAY_LENGTH = 180; // keep in sync with client/world.js — TODO share module
const TIME_OFFSET = 0.2; // client starts the day mid-morning

// named places NPCs know about (village coords; y comes from client terrain)
const PLACES = {
  campfire: { x: 0, z: 0 },
  lake: { x: -16, z: 2 },
  home: { x: 0, z: -6.4 }, // outside the north house's door
};

// [from, to) in day-fraction: 0 = dawn, 0.25 = noon, 0.5 = dusk
const SCHEDULE = [
  { from: 0.0, to: 0.18, place: 'campfire', activity: 'warming up' },
  { from: 0.18, to: 0.4, place: 'lake', activity: 'fishing' },
  { from: 0.4, to: 0.55, place: 'campfire', activity: 'cooking' },
  { from: 0.55, to: 1.0, place: 'home', activity: 'sleeping' },
];

const npcs = [
  { id: 'npc-ember', name: 'Ember', color: 0xd94f30, x: 8, z: 8, ry: 0, status: '', wanderT: 0 },
];

const NPC_SPEED = 2.2;
setInterval(() => {
  const dt = 0.1;
  const dayT = ((Date.now() - worldStart) / 1000 / DAY_LENGTH + TIME_OFFSET) % 1;
  for (const npc of npcs) {
    const slot = SCHEDULE.find((s) => dayT >= s.from && dayT < s.to) ?? SCHEDULE[0];
    const place = PLACES[slot.place];
    const dist = Math.hypot(place.x - npc.x, place.z - npc.z);

    let status;
    // hysteresis: only switch to travelling if we've drifted well away
    const travelling = npc.status.startsWith('heading') ? dist > 1.5 : dist > 3.5;
    if (travelling) {
      // travel toward the scheduled place
      const heading = Math.atan2(place.x - npc.x, place.z - npc.z);
      npc.x += Math.sin(heading) * NPC_SPEED * dt;
      npc.z += Math.cos(heading) * NPC_SPEED * dt;
      npc.ry = heading;
      status = `heading to the ${slot.place}`;
    } else {
      // arrived: idle around the spot (sleepers hold still)
      status = slot.activity;
      if (slot.activity !== 'sleeping') {
        npc.wanderT -= dt;
        if (npc.wanderT <= 0) {
          npc.wanderT = 2 + Math.random() * 3;
          // drift back toward the spot if straying, otherwise amble freely
          npc.ry = dist > 1.5
            ? Math.atan2(place.x - npc.x, place.z - npc.z)
            : Math.random() * Math.PI * 2;
        }
        if (Math.random() < 0.5) {
          npc.x += Math.sin(npc.ry) * NPC_SPEED * 0.3 * dt;
          npc.z += Math.cos(npc.ry) * NPC_SPEED * 0.3 * dt;
        }
      }
    }
    if (status !== npc.status) {
      npc.status = status;
      console.log(`[${dayT.toFixed(2)}] Ember is now ${status}`);
      // self-observation: agents remember what they do
      memories.observe(npc.id, `I am ${status}`, { importance: 2 });
    }
  }
}, 100);

// --- Perception: NPCs notice the world and write it to their memory stream ---
const PERCEPTION_RADIUS = 7;
let lastPhase = null;

setInterval(() => {
  const dayT = ((Date.now() - worldStart) / 1000 / DAY_LENGTH + TIME_OFFSET) % 1;

  // world events everyone notices
  const phase = dayT < 0.5 ? 'day' : 'night';
  if (lastPhase && phase !== lastPhase) {
    const text = phase === 'day' ? 'the sun rose over the village' : 'the sun set and the stars came out';
    for (const npc of npcs) memories.observe(npc.id, text, { importance: 1 });
  }
  lastPhase = phase;

  // who is near each NPC?
  for (const npc of npcs) {
    npc.nearby ??= new Map(); // pid -> name (pid survives reconnects, socket.id does not)
    const current = new Map();
    for (const p of players.values()) {
      if (Math.hypot(p.x - npc.x, p.z - npc.z) <= PERCEPTION_RADIUS) current.set(p.pid, p.name);
    }
    for (const [pid, name] of current) {
      if (!npc.nearby.has(pid)) {
        memories.observe(npc.id, `${name} came over while I was ${npc.status}`, { importance: 3 });
        console.log(`[perception] Ember noticed ${name}`);
      }
    }
    for (const [pid, name] of npc.nearby) {
      if (!current.has(pid)) {
        memories.observe(npc.id, `${name} walked away`, { importance: 2 });
      }
    }
    npc.nearby = current;
  }
}, 500);

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
