const socket = io();

let name, room;
let pc;
let localStream;
let camera;
let isCallStarted = false;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const gestureVideo = document.getElementById("gestureVideo");

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 300;
canvas.height = 200;

// ================= LOGIN =================
function join() {
  name = document.getElementById("name").value;
  room = document.getElementById("room").value;

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  document.getElementById("login").style.display = "none";
  document.getElementById("main").classList.remove("hidden");
}

// ================= CHAT =================
function sendMsg() {
  const msg = document.getElementById("msg").value;

  socket.emit("chat-message", { user: name, room, msg });

  addMsg("You: " + msg);
}

socket.on("chat-message", (d) => {
  addMsg(d.user + ": " + d.msg);
});

function addMsg(m) {
  document.getElementById("messages").innerHTML += `<p>${m}</p>`;
}

// ================= VIDEO CALL =================
async function startCall() {

  if (isCallStarted) return;
  isCallStarted = true;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    console.log("Remote stream received ✅");
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", { room, candidate: event.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", { room, offer });
}

socket.on("offer", async (offer) => {

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    console.log("Remote stream received ✅");
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", { room, candidate: event.candidate });
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", { room, answer });
});

socket.on("answer", async (answer) => {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("candidate", async (c) => {
  try {
    await pc.addIceCandidate(new RTCIceCandidate(c));
  } catch (e) {
    console.error("ICE error", e);
  }
});

function endCall() {

  if (pc) {
    pc.close();
    pc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  isCallStarted = false;
}

// ================= GESTURE =================
const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((res) => {

  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
    document.getElementById("myGesture").innerText = "No Hand ❌";
    return;
  }

  const l = res.multiHandLandmarks[0];

  drawConnectors(ctx, l, HAND_CONNECTIONS);
  drawLandmarks(ctx, l);

  let text = "Detecting";

  if (l[8].y < l[6].y) text = "Hello (नमस्ते)";
  else if (l[4].y < l[8].y) text = "Yes (हाँ)";
  else text = "No (नहीं)";

  document.getElementById("myGesture").innerText = text;

  socket.emit("gesture", { room, text });
});

socket.on("gesture", (d) => {
  document.getElementById("remoteGesture").innerText =
    d.sender + ": " + d.text;
});

// START GESTURE
async function startGesture() {

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });

  gestureVideo.srcObject = stream;

  camera = new Camera(gestureVideo, {
    onFrame: async () => {
      await hands.send({ image: gestureVideo });
    },
    width: 300,
    height: 200
  });

  camera.start();
}

// ================= FILE =================
function sendFile() {

  const f = document.getElementById("file").files[0];
  const reader = new FileReader();

  reader.onload = () => {
    socket.emit("file", {
      room,
      name: f.name,
      data: reader.result
    });
  };

  reader.readAsDataURL(f);
}

socket.on("file", (d) => {

  const a = document.createElement("a");
  a.href = d.data;
  a.download = d.name;
  a.innerText = "Download " + d.name;

  document.getElementById("messages").appendChild(a);
});