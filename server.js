const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 20 * 1024 * 1024
});

app.use(express.static('public'));

io.on('connection', (socket) => {

  socket.on("set-username", (name) => {
    socket.data.username = name;
  });

  socket.on("join-room", (room) => {
    socket.join(room);
  });

  socket.on("chat-message", (data) => {
    io.to(data.room).emit("chat-message", data);
  });

  socket.on("gesture", (data) => {
    io.to(data.room).emit("gesture", {
      sender: socket.data.username,
      text: data.text
    });
  });

  socket.on("offer", (data) => {
    socket.to(data.room).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.room).emit("answer", data.answer);
  });

  socket.on("candidate", (data) => {
    socket.to(data.room).emit("candidate", data.candidate);
  });

  socket.on("file", (data) => {
    io.to(data.room).emit("file", data);
  });
});

server.listen(process.env.PORT || 3000);