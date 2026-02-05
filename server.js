const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join private room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(socket.id + " joined room: " + roomId);
  });

  // Private message (only in room)
  socket.on('private-message', ({ roomId, message }) => {
    io.to(roomId).emit('private-message', {
      sender: socket.id,
      message: message
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
