const socket = io();

let name, room;
let pc;
let localStream;
let isGestureRunning = false;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ================= JOIN =================
function join() {
  name = document.getElementById("name").value;
  room = document.getElementById("room").value;

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  document.getElementById("login").style.display = "none";
  document.getElementById("main").style.display = "block";
}

// ================= VIDEO =================
async function startCall() {
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
}

// ================= GESTURE =================

// SAFE CHECK
if (typeof Hands === "undefined") {
  alert("MediaPipe not loaded ❌");
}

// INIT
const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

// RESULT
hands.onResults((res) => {

  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
    document.getElementById("myGesture").innerText = "No Hand ❌";
    return;
  }

  const l = res.multiHandLandmarks[0];

  drawConnectors(ctx, l, HAND_CONNECTIONS);
  drawLandmarks(ctx, l);

  document.getElementById("myGesture").innerText = "HAND DETECTED ✅";
});

// START
async function startGesture() {

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    localVideo.srcObject = localStream;
  }

  await localVideo.play();

  // 🔥 FORCE WAIT (CRITICAL)
  await new Promise(r => setTimeout(r, 2000));

  // 🔥 FIX CANVAS SIZE
  canvas.width = localVideo.videoWidth;
  canvas.height = localVideo.videoHeight;

  isGestureRunning = true;

  runGesture();
}

// STOP
function stopGesture() {
  isGestureRunning = false;
}

// LOOP (ULTRA STABLE)
async function runGesture() {

  if (!isGestureRunning) return;

  if (localVideo.readyState === 4) {
    try {
      await hands.send({
        image: localVideo,
        timestamp: Date.now()
      });
    } catch (e) {
      console.log("Gesture error:", e);
    }
  }

  requestAnimationFrame(runGesture);
}