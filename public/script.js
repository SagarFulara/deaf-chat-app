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
let lastGestureTime = 0;
let lastGesture = "";
let stableCount = 0;
let finalGesture = "Detecting... 👀";

function onHandResults(res) {
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

  // ================= HELPERS =================
  const TH = 0.02;

  const thumbUp    = l[4].y < l[3].y - TH;
  const thumbDown  = l[4].y > l[3].y + TH;

  const indexUp    = l[8].y < l[6].y - TH;
  const middleUp   = l[12].y < l[10].y - TH;
  const ringUp     = l[16].y < l[14].y - TH;
  const pinkyUp    = l[20].y < l[18].y - TH;

  const indexDown  = !indexUp;
  const middleDown = !middleUp;
  const ringDown   = !ringUp;
  const pinkyDown  = !pinkyUp;

  const dist = (a, b) => Math.hypot(l[a].x - l[b].x, l[a].y - l[b].y);

  // ================= SCORE SYSTEM =================
  let best = { name: "Detecting... 👀", score: 0 };

  function check(name, score) {
    if (score > best.score) {
      best = { name, score };
    }
  }

  // ================= HIGH CONFIDENCE =================
  if (dist(4,8) < 0.05) check("OK 👌", 10);

  if (thumbUp && indexUp && pinkyUp && middleDown && ringDown)
    check("I Love You 🤟", 9);

  if (indexUp && pinkyUp && middleDown && ringDown)
    check("Rock 🤘", 8);

  if (thumbUp && pinkyUp && indexDown && middleDown && ringDown)
    check("Call Me 🤙", 8);

  if (thumbUp && indexUp && middleDown && ringDown && pinkyDown)
    check("Gun 🔫", 8);

  // ================= ORIGINAL CORE =================
  if (indexUp && middleUp && ringUp && pinkyUp)
    check("Hello ✋", 7);

  if (thumbUp && indexDown && middleDown && ringDown && pinkyDown)
    check("Yes 👍", 7);

  if (thumbDown && indexDown && middleDown && ringDown && pinkyDown)
    check("No 👎", 7);

  if (indexUp && middleUp && ringDown && pinkyDown)
    check("Peace ✌️", 7);

  if (indexUp && middleDown && ringDown && pinkyDown)
    check("Pointing ☝️", 6);

  if (indexDown && middleDown && ringDown && pinkyDown)
    check("Fist ✊", 6);

  // ================= COUNTING =================
  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp)
    check("Four ✋", 6);

  if (indexUp && middleUp && ringUp && !pinkyUp)
    check("Three 3️⃣", 6);

  if (indexUp && middleUp && !ringUp && !pinkyUp)
    check("Two ✌️", 6);

  if (indexUp && middleDown && ringDown && pinkyDown)
    check("One ☝️", 6);

  // ================= EXTRA =================
  if (thumbDown && indexUp)
    check("Disagree ❌", 5);

  if (thumbUp && middleUp && !indexUp)
    check("Cool 😎", 5);

  if (indexDown && middleDown && ringUp && pinkyUp)
    check("Partial Open", 5);

  if (dist(4,12) < 0.05) check("Pinch Middle 🤏", 5);
  if (dist(4,16) < 0.05) check("Pinch Ring 🤏", 5);
  if (dist(4,20) < 0.05) check("Pinch Pinky 🤏", 5);

  // ================= STABILITY =================
  let detected = best.name;

  if (detected === lastGesture) {
    stableCount++;
  } else {
    stableCount = 0;
  }

  lastGesture = detected;

  if (stableCount > 3) {
    finalGesture = detected;
  }

  // ================= OUTPUT =================
  document.getElementById("myGesture").innerText = finalGesture;

  // debounce socket
  if (
    finalGesture !== "Detecting... 👀" &&
    Date.now() - lastGestureTime > 800
  ) {
    socket.emit("gesture", { room, text: finalGesture });
    lastGestureTime = Date.now();
  }
}// ================= GESTURE - START =================
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
const toggleMain = document.getElementById("themeToggle");
const toggleLogin = document.getElementById("themeToggleLogin");

function updateUI(isLight) {
  const text = isLight ? "Light" : "Dark";
  const icon = isLight ? "☀️" : "🌙";

  if (toggleMain) toggleMain.innerHTML = `${icon} <span>${text}</span>`;
  if (toggleLogin) toggleLogin.innerHTML = `${icon} <span>${text}</span>`;
}

function setTheme(mode) {
  if (mode === "light") {
    document.body.classList.add("light");
    localStorage.setItem("theme", "light");
    updateUI(true);
  } else {
    document.body.classList.remove("light");
    localStorage.setItem("theme", "dark");
    updateUI(false);
  }
}

function toggleTheme() {
  const isLight = document.body.classList.contains("light");
  setTheme(isLight ? "dark" : "light");
}

if (toggleMain) toggleMain.onclick = toggleTheme;
if (toggleLogin) toggleLogin.onclick = toggleTheme;

window.addEventListener("DOMContentLoaded", () => {
  setTheme(localStorage.getItem("theme") || "dark");
});