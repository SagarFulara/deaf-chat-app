const socket = io();

let name, room, pc, camera;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const gestureVideo = document.getElementById("gestureVideo");

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 300;
canvas.height = 200;

// JOIN
function join() {
  name = document.getElementById("name").value;
  room = document.getElementById("room").value;

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  document.getElementById("login").style.display = "none";
  document.getElementById("main").classList.remove("hidden");
}

// CHAT
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

// VIDEO
async function startCall() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream;

  stream.getTracks().forEach(t => pc.addTrack(t, stream));

  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", { room, offer });
}

socket.on("offer", async (offer) => {
  await startCall();
  await pc.setRemoteDescription(offer);

  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);

  socket.emit("answer", { room, answer: ans });
});

socket.on("answer", async (a) => {
  await pc.setRemoteDescription(a);
});

socket.on("candidate", async (c) => {
  await pc.addIceCandidate(new RTCIceCandidate(c));
});

// ===== GESTURE =====
const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({ maxNumHands:1 });

hands.onResults((res) => {

  ctx.clearRect(0,0,300,200);

  if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) return;

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

// FILE
function sendFile() {
  const f = document.getElementById("file").files[0];
  const r = new FileReader();

  r.onload = () => {
    socket.emit("file", {
      room,
      name: f.name,
      data: r.result
    });
  };

  r.readAsDataURL(f);
}

socket.on("file", (d) => {
  const a = document.createElement("a");
  a.href = d.data;
  a.download = d.name;
  a.innerText = "Download " + d.name;
  document.getElementById("messages").appendChild(a);
});