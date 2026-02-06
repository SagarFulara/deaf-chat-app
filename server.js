const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on("set-username", (name) => {
    socket.data.username = name;
  });

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
  });

  socket.on('chat-message', (data) => {
    io.emit('chat-message', data);
  });

  socket.on("gesture", ({ roomId, gesture }) => {
    io.to(roomId).emit("gesture", {
      username: socket.data.username,
      gesture
    });
  });

  socket.on("offer", (offer) => {
    socket.broadcast.emit("offer", offer);
  });

  socket.on("answer", (answer) => {
    socket.broadcast.emit("answer", answer);
  });

  socket.on("candidate", (candidate) => {
    socket.broadcast.emit("candidate", candidate);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running"));
