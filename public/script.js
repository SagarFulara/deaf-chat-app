// SOCKET
const socket = io({
  transports: ["websocket"],
  reconnection: true
});

let name, room;
let pc;
let localStream;
let isGestureRunning = false;
let hands = null;
let animFrameId = null; // BUG 4 FIX: track frame ID so we can cancel it

// ELEMENTS
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ================= JOIN =================
function join() {
  name = document.getElementById("name").value.trim();
  room = document.getElementById("room").value.trim();
  if (!name || !room) { alert("Enter name and room!"); return; }

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
  const p = document.createElement("p");
  p.textContent = m;
  const msgs = document.getElementById("messages");
  msgs.appendChild(p);
  msgs.scrollTop = msgs.scrollHeight;
}

// ================= VIDEO CALL =================
async function startCall() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }

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

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }

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
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// ================= GESTURE - INIT MEDIAPIPE =================
function initHands() {
  if (hands) return true; // already initialised

  if (typeof Hands === "undefined") {
    alert("MediaPipe failed to load. Check your internet connection and refresh.");
    return false; // BUG 1 FIX: return false so caller knows it failed
  }

  hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });

  hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    modelComplexity: 1  // BUG 3 FIX: missing in old script.js — needed for reliable detection
  });

  hands.onResults(onHandResults);
  return true; // BUG 1 FIX: return true on success
}

// ================= GESTURE - RESULTS HANDLER =================
function onHandResults(res) {
  // Sync canvas size to actual video every frame
  if (localVideo.videoWidth > 0) {
    canvas.width  = localVideo.videoWidth;
    canvas.height = localVideo.videoHeight;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
    document.getElementById("myGesture").innerText = "No Hand ❌";
    return;
  }

  const l = res.multiHandLandmarks[0];

  drawConnectors(ctx, l, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
  drawLandmarks(ctx, l, { color: "#FF0000", lineWidth: 2, radius: 4 });

  // Gesture detection
  const allFingersUp =
    l[8].y  < l[6].y  &&
    l[12].y < l[10].y &&
    l[16].y < l[14].y &&
    l[20].y < l[18].y;

  const thumbUp   = l[4].y < l[3].y && l[4].y < l[2].y;
  const thumbDown = l[4].y > l[3].y && l[4].y > l[2].y;
  const indexUp   = l[8].y < l[6].y;
  const middleUp  = l[12].y < l[10].y;
  const ringDown  = l[16].y > l[14].y;
  const pinkyDown = l[20].y > l[18].y;

  let text = "Detecting... 👀";

  if (allFingersUp)                                           text = "Hello ✋";
  else if (thumbUp && !indexUp)                              text = "Yes 👍";
  else if (thumbDown && !indexUp)                            text = "No 👎";
  else if (indexUp && middleUp && ringDown && pinkyDown)     text = "Peace ✌️";
  else if (indexUp && !middleUp && ringDown && pinkyDown)    text = "Pointing ☝️";
  else if (!indexUp && !middleUp && !ringDown && !pinkyDown) text = "Fist ✊";

  document.getElementById("myGesture").innerText = text;

  if (text !== "Detecting... 👀") {
    socket.emit("gesture", { room, text });
  }
}

// ================= GESTURE - START =================
async function startGesture() {
  if (isGestureRunning) return;

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true });
      localVideo.srcObject = localStream;
    } catch (e) {
      alert("Camera access denied!");
      return;
    }
  }

  document.getElementById("myGesture").innerText = "Starting... ⏳";

  // BUG 2 FIX: Poll until video has real pixel dimensions (loadedmetadata alone is not enough)
  await new Promise((resolve) => {
    function check() {
      if (localVideo.videoWidth > 0 && localVideo.videoHeight > 0) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    }
    check();
  });

  canvas.width  = localVideo.videoWidth;
  canvas.height = localVideo.videoHeight;

  if (!initHands()) return; // BUG 1 FIX: initHands now returns true/false

  isGestureRunning = true;
  document.getElementById("myGesture").innerText = "Show your hand! 🖐";
  runGesture();
}

// ================= GESTURE - LOOP =================
async function runGesture() {
  if (!isGestureRunning) return;

  if (localVideo.readyState === 4 && localVideo.videoWidth > 0) {
    try {
      await hands.send({ image: localVideo });
    } catch (e) {
      console.error("Gesture error:", e);
    }
  }

  animFrameId = requestAnimationFrame(runGesture); // BUG 4 FIX: store ID
}

// ================= GESTURE - STOP =================
function stopGesture() {
  isGestureRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId); // BUG 4 FIX: actually cancel the loop
    animFrameId = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById("myGesture").innerText = "Your Gesture: -";
}

// RECEIVE REMOTE GESTURE
socket.on("gesture", (d) => {
  document.getElementById("remoteGesture").innerText = d.sender + ": " + d.text;
});

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



// ===== THEME TOGGLE =====
const toggleBtn = document.getElementById("themeToggle");

toggleBtn.onclick = () => {
  document.body.classList.toggle("light");

  if (document.body.classList.contains("light")) {
    toggleBtn.innerText = "☀️";
    localStorage.setItem("theme", "light");
  } else {
    toggleBtn.innerText = "🌙";
    localStorage.setItem("theme", "dark");
  }
};

// Load saved theme
window.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light");
    toggleBtn.innerText = "☀️";
  }
});