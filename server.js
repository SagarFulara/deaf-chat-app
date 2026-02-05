const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Allow CORS so your frontend can connect from the same or different domain
const io = new Server(server, {
  cors: {
    origin: "*", // or your frontend URL in production
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join private room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(socket.id + " joined room: " + roomId);
  });

  // Private message in room
  socket.on('private-message', ({ roomId, message }) => {
    io.to(roomId).emit('private-message', {
      sender: socket.id,
      message: message
    });
  });

  // WebRTC signaling
  socket.on('offer', (offer) => {
    // send offer to all other users in the room
    socket.to(Object.keys(socket.rooms).filter(r => r !== socket.id)[0])?.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    socket.to(Object.keys(socket.rooms).filter(r => r !== socket.id)[0])?.emit('answer', answer);
  });

  socket.on('candidate', (candidate) => {
    socket.to(Object.keys(socket.rooms).filter(r => r !== socket.id)[0])?.emit('candidate', candidate);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
