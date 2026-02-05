const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, username }) => {
        socket.join(roomId);
        socket.username = username;
        console.log(username, "joined", roomId);
    });

    // CHAT
    socket.on("private-message", ({ roomId, message }) => {
        io.to(roomId).emit("private-message", {
            username: socket.username,
            message
        });
    });

    // FILE TRANSFER
    socket.on("file-transfer", ({ roomId, fileName, fileData }) => {
        io.to(roomId).emit("file-transfer", {
            username: socket.username,
            fileName,
            fileData
        });
    });

    // WEBRTC SIGNALING
    socket.on("offer", ({ roomId, offer }) => {
        socket.to(roomId).emit("offer", offer);
    });

    socket.on("answer", ({ roomId, answer }) => {
        socket.to(roomId).emit("answer", answer);
    });

    socket.on("candidate", ({ roomId, candidate }) => {
        socket.to(roomId).emit("candidate", candidate);
    });

    // HAND GESTURE
    socket.on("gesture", ({ roomId, gesture }) => {
        socket.to(roomId).emit("gesture", {
            username: socket.username,
            gesture
        });
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
