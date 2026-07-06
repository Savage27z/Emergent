const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

// TODO(Day 2+): server becomes authoritative — track player positions here
// and broadcast world state. Today it just serves the client and logs connections.
io.on('connection', (socket) => {
  console.log(`player connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EMERGENT server running at http://localhost:${PORT}`);
});
