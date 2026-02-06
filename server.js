const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024 // 10MB file limit
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on("set-username", (name) => {
    socket.data.username = name;
  });

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(socket.id + " joined room: " + roomId);
  });

  socket.on("chat-message", (data) => {
    io.to(data.roomId).emit("chat-message", data);
  });

  socket.on("gesture", ({ roomId, gesture }) => {
    io.to(roomId).emit("gesture", {
      senderId: socket.id,
      username: socket.data.username || "User",
      gesture
    });
  });

  socket.on("offer", (data) => {
    socket.to(data.roomId).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.roomId).emit("answer", data.answer);
  });

  socket.on("candidate", (data) => {
    socket.to(data.roomId).emit("candidate", data.candidate);
  });

  socket.on("file", (data) => {
    io.to(data.roomId).emit("file", {
      sender: socket.data.username || "User",
      fileName: data.fileName,
      fileType: data.fileType,
      fileData: data.fileData
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on " + PORT));
