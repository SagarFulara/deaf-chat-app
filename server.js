const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB max for files

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join room with username
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.username = username;
        console.log(username + " joined room: " + roomId);
    });

    // Chat message
    socket.on('private-message', ({ roomId, message }) => {
        io.to(roomId).emit('private-message', {
            username: socket.username,
            message
        });
    });

    // File transfer
    socket.on('file-transfer', ({ roomId, fileName, fileData }) => {
        io.to(roomId).emit('file-transfer', {
            username: socket.username,
            fileName,
            fileData
        });
    });

    // WebRTC signaling
    socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer', offer);
    });

    socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer', answer);
    });

    socket.on('candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('candidate', candidate);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
