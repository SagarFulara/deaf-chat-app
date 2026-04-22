// SOCKET
const socket = io({
  transports: ["websocket"],
  reconnection: true
});

let name, room;
let pc;
let localStream;
let isGestureRunning = false;
let hands = null; // Lazy init fix

// ELEMENTS
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

// ================= CHAT =================
function sendMsg() {
  const msg = document.getElementById("msg").value;
  if (!msg) return;

  socket.emit("chat-message", { user: name, room, msg });
  addMsg("You: " + msg);
  document.getElementById("msg").value = "";
}

socket.on("chat-message", (d) => {
  addMsg(d.user + ": " + d.msg);
});

function addMsg(m) {
  document.getElementById("messages").innerHTML += `<p>${m}</p>`;
}

// ================= VIDEO CALL =================
async function startCall() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { room, offer });
}

socket.on("offer", async (offer) => {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { room, answer });
});

socket.on("answer", async (ans) => {
  await pc.setRemoteDescription(new RTCSessionDescription(ans));
});

socket.on("candidate", async (c) => {
  if (pc) await pc.addIceCandidate(new RTCIceCandidate(c));
});

function endCall() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// ================= GESTURE =================

function initHands() {
  // FIX 3: Lazy init — only create Hands after MediaPipe is confirmed loaded
  if (hands) return;

  if (typeof Hands === "undefined") {
    alert("MediaPipe failed to load. Check your internet connection.");
    return;
  }

  hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });

  hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults((res) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
      document.getElementById("myGesture").innerText = "No Hand ❌";
      return;
    }

    const l = res.multiHandLandmarks[0];

    drawConnectors(ctx, l, HAND_CONNECTIONS);
    drawLandmarks(ctx, l);

    let text = "Detecting...";

    if (
      l[8].y < l[6].y &&
      l[12].y < l[10].y &&
      l[16].y < l[14].y &&
      l[20].y < l[18].y
    ) {
      text = "Hello ✋";
    } else if (l[4].y < l[3].y) {
      text = "Yes 👍";
    } else {
      text = "No 👊";
    }

    document.getElementById("myGesture").innerText = text;
    socket.emit("gesture", { room, text });
  });
}

socket.on("gesture", (d) => {
  document.getElementById("remoteGesture").innerText = d.sender + ": " + d.text;
});

// ================= START GESTURE =================
async function startGesture() {
  if (isGestureRunning) return;

  // Get camera if not already running
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    localVideo.srcObject = localStream;
  }

  // FIX 1: Wait for video metadata to load before reading dimensions
  await new Promise((resolve) => {
    if (localVideo.readyState >= 1) {
      resolve();
    } else {
      localVideo.addEventListener("loadedmetadata", resolve, { once: true });
    }
  });

  // Now dimensions are available
  canvas.width = localVideo.videoWidth || 320;
  canvas.height = localVideo.videoHeight || 240;

  // FIX 3: Init MediaPipe lazily here
  initHands();
  if (!hands) return;

  isGestureRunning = true;
  runGesture();
}

// ================= GESTURE LOOP =================
async function runGesture() {
  if (!isGestureRunning) return;

  // FIX 2: Only send if video is actually playing and has valid size
  if (
    localVideo.readyState === 4 &&
    localVideo.videoWidth > 0
  ) {
    try {
      await hands.send({ image: localVideo });
    } catch (e) {
      console.error("Gesture error:", e);
    }
  }

  requestAnimationFrame(runGesture);
}

function stopGesture() {
  isGestureRunning = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById("myGesture").innerText = "Your Gesture: -";
}

// ================= FILE =================
function sendFile() {
  const f = document.getElementById("file").files[0];
  if (!f) return;

  const reader = new FileReader();
  reader.onload = () => {
    socket.emit("file", { room, name: f.name, data: reader.result });
  };
  reader.readAsDataURL(f);
}

socket.on("file", (d) => {
  const a = document.createElement("a");
  a.href = d.data;
  a.download = d.name;
  a.innerText = "📎 Download " + d.name;
  document.getElementById("messages").appendChild(a);
});