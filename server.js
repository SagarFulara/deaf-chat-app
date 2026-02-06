const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.data.username = username;

    // batao room me kaun aaya
    io.to(roomId).emit("user-joined", { id: socket.id, username });
  });

  socket.on('private-message', ({ roomId, message }) => {
    io.to(roomId).emit("private-message", {
      username: socket.data.username,
      message
    });
  });

  // -------- WEBRTC SIGNALING (FIXED) --------
  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", offer);
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", answer);
  });

  socket.on("candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("candidate", candidate);
  });

  // -------- HAND GESTURE RELAY --------
  socket.on("gesture", ({ roomId, gesture }) => {
    io.to(roomId).emit("gesture", {
      username: socket.data.username,
      gesture
    });
  });

  // -------- FILE TRANSFER --------
  socket.on("file-transfer", ({ roomId, fileName, fileData }) => {
    socket.to(roomId).emit("file-transfer", { fileName, fileData });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on " + PORT));
