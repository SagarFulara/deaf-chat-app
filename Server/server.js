const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Real-time chat
    socket.on("chat-message", (data) => {
        socket.broadcast.emit("chat-message", data);
    });

    // WebRTC Signaling
    socket.on("offer", (offer) => {
        socket.broadcast.emit("offer", offer);
    });

    socket.on("answer", (answer) => {
        socket.broadcast.emit("answer", answer);
    });

    socket.on("candidate", (candidate) => {
        socket.broadcast.emit("candidate", candidate);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
