const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

// World state: the server's player table is the source of truth for who exists.
// TODO(server-authority): positions are still client-reported; later the client
// should send inputs and the server should simulate movement itself.
const players = new Map(); // socket.id -> { id, x, z, ry, color, name }

const PALETTE = [0xe07a5f, 0x3d8bd4, 0xf2cc8f, 0x81b29a, 0xb56dc4, 0xe8628c];
let joinCount = 0;

io.on('connection', (socket) => {
  const player = {
    id: socket.id,
    x: 0,
    z: 0,
    ry: 0,
    color: PALETTE[joinCount++ % PALETTE.length],
    name: `wanderer-${joinCount}`,
  };
  players.set(socket.id, player);
  console.log(`${player.name} connected (${players.size} online)`);

  // tell the newcomer who they are and who's already here
  socket.emit('welcome', { self: player, players: [...players.values()] });
  socket.broadcast.emit('player-joined', player);

  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p || typeof data?.x !== 'number' || typeof data?.z !== 'number') return;
    p.x = Math.max(-58, Math.min(58, data.x));
    p.z = Math.max(-58, Math.min(58, data.z));
    p.ry = typeof data.ry === 'number' ? data.ry : p.ry;
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('player-left', socket.id);
    console.log(`${player.name} disconnected (${players.size} online)`);
  });
});

// broadcast a world snapshot at 20Hz
setInterval(() => {
  if (players.size > 0) io.emit('snapshot', [...players.values()]);
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EMERGENT server running at http://localhost:${PORT}`);
});
