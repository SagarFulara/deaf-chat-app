const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*"
  }
});

app.use(express.static("public"));

let users = {};

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  socket.on("set-username", (name) => {
    users[socket.id] = name;
    console.log("Username set:", name);
  });

  socket.on("join-room", (room) => {
    socket.join(room);
    console.log("Joined room:", room);
  });

  // CHAT
  socket.on("chat-message", (data) => {
    console.log("Message:", data);
    socket.to(data.room).emit("chat-message", data);
  });

  // VIDEO SIGNALING
  socket.on("offer", (data) => {
    socket.to(data.room).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.room).emit("answer", data.answer);
  });

  socket.on("candidate", (data) => {
    socket.to(data.room).emit("candidate", data.candidate);
  });

  // GESTURE
  socket.on("gesture", (data) => {
    socket.to(data.room).emit("gesture", {
      sender: users[socket.id] || "User",
      text: data.text
    });
  });

  // FILE
  socket.on("file", (data) => {
    socket.to(data.room).emit("file", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
    delete users[socket.id];
  });

});

http.listen(3000, () => console.log("Server running on 3000"));