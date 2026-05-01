// ================= SOCKET =================
const socket = io({
  transports: ["websocket"],
  reconnection: true
});

let name, room;
let pc;
let localStream;
let isGestureRunning = false;
let hands = null;
let animFrameId = null;

// ================= ELEMENTS =================
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

// ================= HAND INIT =================
function initHands() {
  if (hands) return true;

  if (typeof Hands === "undefined") {
    alert("MediaPipe not loaded");
    return false;
  }

  hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });

  hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    modelComplexity: 1
  });

  hands.onResults(onHandResults);
  return true;
}

// ================= GLOBAL =================
let lastGestureTime = 0;
let lastGesture = "";
let stableCount = 0;
let finalGesture = "Detecting... 👀";

// ================= MOTION =================
let handHistory = [];
const HISTORY_SIZE = 10;

function detectMotion(l) {
  const wrist = l[0];
  handHistory.push({ x: wrist.x, y: wrist.y, z: wrist.z });
  if (handHistory.length > HISTORY_SIZE) handHistory.shift();

  if (handHistory.length < HISTORY_SIZE) return null;

  const first = handHistory[0];
  const last = handHistory[HISTORY_SIZE - 1];

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dz = last.z - first.z;

  const TH = 0.08;

  if (dx > TH && Math.abs(dy) < 0.05) return "Swipe Right ➡️";
  if (dx < -TH && Math.abs(dy) < 0.05) return "Swipe Left ⬅️";
  if (dz < -TH) return "Push 👊";
  if (dz > TH) return "Pull 🤚";

  let changes = 0;
  for (let i = 2; i < handHistory.length; i++) {
    const prev = handHistory[i-1].x - handHistory[i-2].x;
    const curr = handHistory[i].x - handHistory[i-1].x;
    if (prev * curr < 0) changes++;
  }
  if (changes >= 3) return "Wave 👋";

  return null;
}

// ================= RESULTS =================
function onHandResults(res) {
  if (localVideo.videoWidth > 0) {
    canvas.width = localVideo.videoWidth;
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

  const TH = 0.02;

  const thumbUp = l[4].y < l[3].y - TH;
  const thumbDown = l[4].y > l[3].y + TH;

  const indexUp = l[8].y < l[6].y - TH;
  const middleUp = l[12].y < l[10].y - TH;
  const ringUp = l[16].y < l[14].y - TH;
  const pinkyUp = l[20].y < l[18].y - TH;

  const indexDown = !indexUp;
  const middleDown = !middleUp;
  const ringDown = !ringUp;
  const pinkyDown = !pinkyUp;

  const dist = (a, b) => Math.hypot(l[a].x - l[b].x, l[a].y - l[b].y);

  let best = { name: "Detecting... 👀", score: 0 };
  function check(name, score) {
    if (score > best.score) best = { name, score };
  }

  // gestures
  if (dist(4,8) < 0.05) check("OK 👌", 10);
  if (thumbUp && indexUp && pinkyUp && middleDown && ringDown) check("I Love You 🤟", 9);
  if (indexUp && pinkyUp && middleDown && ringDown) check("Rock 🤘", 8);
  if (thumbUp && pinkyUp && indexDown) check("Call Me 🤙", 8);
  if (thumbUp && indexUp && middleDown) check("Gun 🔫", 8);

  if (indexUp && middleUp && ringUp && pinkyUp) check("Hello ✋", 7);
  if (thumbUp && indexDown) check("Yes 👍", 7);
  if (thumbDown && indexDown) check("No 👎", 7);
  if (indexUp && middleUp && ringDown) check("Peace ✌️", 7);
  if (indexUp && middleDown) check("Pointing ☝️", 6);
  if (indexDown && middleDown && ringDown && pinkyDown) check("Fist ✊", 6);

  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp) check("Four ✋", 6);
  if (indexUp && middleUp && ringUp) check("Three 3️⃣", 6);
  if (indexUp && middleUp) check("Two ✌️", 6);
  if (indexUp) check("One ☝️", 6);

  if (thumbDown && indexUp) check("Disagree ❌", 5);
  if (thumbUp && middleUp) check("Cool 😎", 5);
  if (indexDown && middleDown && ringUp && pinkyUp) check("Partial Open", 5);

  if (dist(4,12) < 0.05) check("Pinch Middle 🤏", 5);
  if (dist(4,16) < 0.05) check("Pinch Ring 🤏", 5);
  if (dist(4,20) < 0.05) check("Pinch Pinky 🤏", 5);

  let detected = best.name;

  if (detected === lastGesture) stableCount++;
  else stableCount = 0;

  lastGesture = detected;
  if (stableCount > 3) finalGesture = detected;

  const motion = detectMotion(l);
  let finalOutput = motion || finalGesture;

  document.getElementById("myGesture").innerText = finalOutput;

  // ===== HIGHLIGHT =====
  document.querySelectorAll("#instructionBox li")
    .forEach(li => li.classList.remove("active-gesture"));

  const map = {
    "Hello":"g-hello","Yes":"g-yes","No":"g-no","Peace":"g-peace",
    "Point":"g-point","Fist":"g-fist","Four":"g-four","Three":"g-three",
    "Two":"g-two","One":"g-one","Rock":"g-rock","Love":"g-ily",
    "Call":"g-call","Gun":"g-gun","OK":"g-ok",
    "Pinch Middle":"g-pinchM","Pinch Ring":"g-pinchR","Pinch Pinky":"g-pinchP",
    "Disagree":"g-disagree","Cool":"g-cool","Partial":"g-partial",
    "Right":"g-swipeR","Left":"g-swipeL","Push":"g-push","Pull":"g-pull","Wave":"g-wave"
  };

  for (let key in map) {
    if (finalOutput.includes(key)) {
      document.getElementById(map[key])?.classList.add("active-gesture");
      break;
    }
  }

  if (Date.now() - lastGestureTime > 800) {
    socket.emit("gesture", { room, text: finalOutput });
    lastGestureTime = Date.now();
  }
}

// ================= START =================
async function startGesture() {
  if (isGestureRunning) return;

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    localVideo.srcObject = localStream;
  }

  await new Promise(r => setTimeout(r, 500));

  if (!initHands()) return;

  isGestureRunning = true;
  runGesture();
}

function runGesture() {
  if (!isGestureRunning) return;
  hands.send({ image: localVideo });
  animFrameId = requestAnimationFrame(runGesture);
}

function stopGesture() {
  isGestureRunning = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ================= REMOTE =================
socket.on("gesture", d => {
  document.getElementById("remoteGesture").innerText = d.text;
});