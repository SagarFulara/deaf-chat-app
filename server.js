const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

let users = {};

io.on("connection", socket => {

  socket.on("set-username", name => {
    users[socket.id] = name;
  });

  socket.on("join-room", room => {
    socket.join(room);
  });

  // CHAT FIX
  socket.on("chat-message", data => {
    socket.to(data.room).emit("chat-message", data);
  });

  // VIDEO SIGNALING FIX
  socket.on("offer", data => {
    socket.to(data.room).emit("offer", data.offer);
  });

  socket.on("answer", data => {
    socket.to(data.room).emit("answer", data.answer);
  });

  socket.on("candidate", data => {
    socket.to(data.room).emit("candidate", data.candidate);
  });

  // GESTURE FIX
  socket.on("gesture", data => {
    socket.to(data.room).emit("gesture", {
      sender: users[socket.id] || "User",
      text: data.text
    });
  });

  // FILE FIX
  socket.on("file", data => {
    socket.to(data.room).emit("file", data);
  });

});

http.listen(3000, () => console.log("Server running"));