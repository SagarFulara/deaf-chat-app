const socket = io();

let name, room;
let pc;
let localStream;
let isCallStarted = false;
let isGestureRunning = false;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 320;
canvas.height = 240;

// JOIN
function join() {
  name = document.getElementById("name").value;
  room = document.getElementById("room").value;

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  document.getElementById("login").style.display = "none";
  document.getElementById("main").style.display = "block";
}

// CHAT
function sendMsg() {
  const msg = document.getElementById("msg").value;
  socket.emit("chat-message", { user: name, room, msg });
  addMsg("You: " + msg);
}

socket.on("chat-message", d => addMsg(d.user + ": " + d.msg));

function addMsg(m) {
  document.getElementById("messages").innerHTML += `<p>${m}</p>`;
}

// VIDEO CALL
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

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", { room, offer });
}

socket.on("offer", async offer => {

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };

  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", { room, answer });
});

socket.on("answer", ans => pc.setRemoteDescription(ans));
socket.on("candidate", c => pc.addIceCandidate(new RTCIceCandidate(c)));

function endCall() {
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  isCallStarted = false;
}

// GESTURE (FINAL FIX)
const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({ maxNumHands: 1 });

hands.onResults(res => {

  ctx.clearRect(0,0,320,240);

  if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
    document.getElementById("myGesture").innerText = "No Hand ❌";
    return;
  }

  const l = res.multiHandLandmarks[0];

  drawConnectors(ctx, l, HAND_CONNECTIONS);
  drawLandmarks(ctx, l);

  let text = "Detecting";

  if (l[8].y < l[6].y) text = "Hello ✋";
  else if (l[4].y < l[3].y) text = "Yes 👍";
  else text = "No 👊";

  document.getElementById("myGesture").innerText = text;

  socket.emit("gesture", { room, text });
});

socket.on("gesture", d => {
  document.getElementById("remoteGesture").innerText =
    d.sender + ": " + d.text;
});

async function startGesture() {

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    localVideo.srcObject = localStream;
  }

  await localVideo.play();

  // 🔥 delay fix
  await new Promise(r => setTimeout(r, 1000));

  isGestureRunning = true;
  runGesture();
}

function stopGesture() {
  isGestureRunning = false;
}

async function runGesture() {
  if (!isGestureRunning) return;

  if (localVideo.readyState >= 2) {
    await hands.send({ image: localVideo });
  }

  requestAnimationFrame(runGesture);
}

// FILE
function sendFile() {
  const f = document.getElementById("file").files[0];
  const reader = new FileReader();

  reader.onload = () => {
    socket.emit("file", { room, name: f.name, data: reader.result });
  };

  reader.readAsDataURL(f);
}

socket.on("file", d => {
  const a = document.createElement("a");
  a.href = d.data;
  a.download = d.name;
  a.innerText = "Download " + d.name;
  document.getElementById("messages").appendChild(a);
});