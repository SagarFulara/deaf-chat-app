const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MAX_NAME_LENGTH = 30;
const MAX_ROOM_LENGTH = 50;
const MAX_TEXT_LENGTH = 300;

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN
  },
  maxHttpBufferSize: 2 * 1024 * 1024
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    maxAge: "1h"
  })
);

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getRoom(data) {
  return cleanText(data?.room, MAX_ROOM_LENGTH);
}

function isInRoom(socket, room) {
  return Boolean(room && socket.rooms.has(room));
}

function emitToRoom(socket, event, data, payload) {
  const room = getRoom(data);

  if (!isInRoom(socket, room)) {
    socket.emit("error-message", "Join the room before sending data.");
    return false;
  }

  socket.to(room).emit(event, payload);
  return true;
}

io.on("connection", (socket) => {
  socket.data.username = "User";

  console.log("User connected:", socket.id);

  socket.on("set-username", (rawName) => {
    const username = cleanText(rawName, MAX_NAME_LENGTH);
    socket.data.username = username || "User";
    console.log("Username set:", socket.id, socket.data.username);
  });

  socket.on("join-room", (rawRoom) => {
    const room = cleanText(rawRoom, MAX_ROOM_LENGTH);

    if (!room) {
      socket.emit("error-message", "Invalid room code.");
      return;
    }

    socket.join(room);
    console.log(`${socket.data.username} joined room:`, room);
  });

  socket.on("chat-message", (data) => {
    if (!isObject(data)) return;

    const msg = cleanText(data.msg, 5000);
    const user = cleanText(data.user, MAX_NAME_LENGTH) || socket.data.username;

    if (!msg) return;

    emitToRoom(socket, "chat-message", data, {
      user,
      room: getRoom(data),
      msg
    });
  });

  socket.on("offer", (data) => {
    if (!isObject(data) || !data.offer) return;
    emitToRoom(socket, "offer", data, data.offer);
  });

  socket.on("answer", (data) => {
    if (!isObject(data) || !data.answer) return;
    emitToRoom(socket, "answer", data, data.answer);
  });

  socket.on("candidate", (data) => {
    if (!isObject(data) || !data.candidate) return;
    emitToRoom(socket, "candidate", data, data.candidate);
  });

  socket.on("gesture", (data) => {
    if (!isObject(data)) return;

    const text = cleanText(data.text, MAX_TEXT_LENGTH);
    if (!text) return;

    emitToRoom(socket, "gesture", data, {
      sender: socket.data.username,
      text
    });
  });

  socket.on("file", (data) => {
    if (!isObject(data)) return;

    const name = cleanText(data.name, 120);
    const encryptedData = typeof data.data === "string" ? data.data : "";

    if (!name || !encryptedData) return;

    emitToRoom(socket, "file", data, {
      name,
      data: encryptedData,
      sender: socket.data.username
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("User disconnected:", socket.id, reason);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
