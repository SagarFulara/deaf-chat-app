// ===== ENCRYPTION =====
// ⚠️  Move SECRET_KEY server-side for real security.
// Client-side keys are visible in DevTools — this only obscures, not protects.
const SECRET_KEY = "deafchat-secret-123";

function encrypt(msg) {
  return CryptoJS.AES.encrypt(msg, SECRET_KEY).toString();
}

function decrypt(cipher) {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, SECRET_KEY);
    const result = bytes.toString(CryptoJS.enc.Utf8);
    if (!result) throw new Error("Empty decryption result");
    return result;
  } catch {
    return "[decryption error]";
  }
}

// ===== SOCKET =====
const socket = io({ transports: ["websocket"], reconnection: true });

let name, room;
let pc;
let localStream;
let isGestureRunning = false;
let hands = null;
let animFrameId = null;

// ===== ELEMENTS (cached once) =====
const localVideo   = document.getElementById("localVideo");
const remoteVideo  = document.getElementById("remoteVideo");
const canvas       = document.getElementById("canvas");
const ctx          = canvas.getContext("2d");
const messagesEl   = document.getElementById("messages");
const gestureEl    = document.getElementById("myGesture");
const remoteGestEl = document.getElementById("remoteGesture");
const msgInput     = document.getElementById("msg");

// ===== GESTURE: instruction-box element map (built once) =====
// Maps substring → element ID — avoids 20+ individual getElementById calls per frame
const GESTURE_ID_MAP = [
  ["Hello",        "g-hello"],
  ["Yes",          "g-yes"],
  ["No",           "g-no"],
  ["Peace",        "g-peace"],
  ["Point",        "g-point"],
  ["Fist",         "g-fist"],
  ["Four",         "g-four"],
  ["Three",        "g-three"],
  ["Two",          "g-two"],
  ["One",          "g-one"],
  ["Rock",         "g-rock"],
  ["Love",         "g-ily"],
  ["Call",         "g-call"],
  ["Gun",          "g-gun"],
  ["OK",           "g-ok"],
  ["Pinch Middle", "g-pinchM"],
  ["Pinch Ring",   "g-pinchR"],
  ["Pinch Pinky",  "g-pinchP"],
  ["Disagree",     "g-disagree"],
  ["Cool",         "g-cool"],
  ["Partial",      "g-partial"],
];

// Pre-resolve elements so we never call getElementById inside the hot gesture loop
const GESTURE_EL_MAP = GESTURE_ID_MAP.map(([key, id]) => [key, document.getElementById(id)]);

// ===== JOIN =====
function join() {
  name = document.getElementById("name").value.trim();
  room = document.getElementById("room").value.trim();
  if (!name || !room) { alert("Enter name and room!"); return; }

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  document.getElementById("login").style.display = "none";
  document.getElementById("main").style.display  = "block";
}

// ===== CHAT =====
function sendMsg() {
  const msg = msgInput.value.trim();
  if (!msg) return;

  socket.emit("chat-message", { user: name, room, msg: encrypt(msg) });
  addMsg("You: " + msg);
  msgInput.value = "";
}

socket.on("chat-message", (d) => {
  addMsg(d.user + ": " + decrypt(d.msg));
});

function addMsg(m) {
  const p = document.createElement("p");
  p.textContent = m;
  messagesEl.appendChild(p);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===== VIDEO CALL =====
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function getLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }
  return localStream;
}

function setupPeerConnection() {
  const connection = new RTCPeerConnection(ICE_CONFIG);
  connection.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; };
  connection.onicecandidate = (e) => {
    if (e.candidate) socket.emit("candidate", { room, candidate: e.candidate });
  };
  return connection;
}

async function startCall() {
  pc = setupPeerConnection();
  const stream = await getLocalStream();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { room, offer });
}

socket.on("offer", async (offer) => {
  pc = setupPeerConnection();
  const stream = await getLocalStream();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

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
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  localVideo.srcObject  = null;
  remoteVideo.srcObject = null;
}

// ===== GESTURE: INIT =====
function initHands() {
  if (hands) return true;

  if (typeof Hands === "undefined") {
    alert("MediaPipe failed to load. Check your internet connection and refresh.");
    return false;
  }

  hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });

  hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    modelComplexity: 1,
  });

  hands.onResults(onHandResults);
  return true;
}

// ===== GESTURE: STATE =====
let lastGestureTime = 0;
let lastGesture     = "";
let stableCount     = 0;
let finalGesture    = "Detecting... 👀";
let prevFinalGesture = "";  // OPT: skip redundant DOM + socket updates

// ===== GESTURE: RESULTS =====
function onHandResults(res) {
  // Sync canvas size to video (only when dimensions actually change)
  if (localVideo.videoWidth > 0) {
    if (canvas.width  !== localVideo.videoWidth)  canvas.width  = localVideo.videoWidth;
    if (canvas.height !== localVideo.videoHeight) canvas.height = localVideo.videoHeight;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!res.multiHandLandmarks?.length) {
    gestureEl.innerText = "No Hand ❌";
    prevFinalGesture = "";
    return;
  }

  const l = res.multiHandLandmarks[0];

  drawConnectors(ctx, l, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
  drawLandmarks(ctx, l, { color: "#FF0000", lineWidth: 2, radius: 4 });

  // ===== HELPERS =====
  const TH = 0.02;
  const dist = (a, b) => Math.hypot(l[a].x - l[b].x, l[a].y - l[b].y);

  const thumbUp  = l[4].y < l[3].y - TH;
  const thumbDown = l[4].y > l[3].y + TH;
  const indexUp  = l[8].y  < l[6].y  - TH;
  const middleUp = l[12].y < l[10].y - TH;
  const ringUp   = l[16].y < l[14].y - TH;
  const pinkyUp  = l[20].y < l[18].y - TH;

  const indexDown  = !indexUp;
  const middleDown = !middleUp;
  const ringDown   = !ringUp;
  const pinkyDown  = !pinkyUp;

  // ===== SCORE SYSTEM =====
  let best = { name: "Detecting... 👀", score: 0 };

  function check(name, score) {
    if (score > best.score) best = { name, score };
  }

  // High confidence
  if (dist(4, 8) < 0.05)                                                  check("OK 👌", 10);
  if (thumbUp  && indexUp  && pinkyUp && middleDown && ringDown)           check("I Love You 🤟", 9);
  if (indexUp  && pinkyUp  && middleDown && ringDown)                      check("Rock 🤘", 8);
  if (thumbUp  && pinkyUp  && indexDown && middleDown && ringDown)         check("Call Me 🤙", 8);
  if (thumbUp  && indexUp  && middleDown && ringDown && pinkyDown)         check("Gun 🔫", 8);

  // Core
  if (indexUp  && middleUp && ringUp && pinkyUp)                           check("Hello ✋", 7);
  if (thumbUp  && indexDown && middleDown && ringDown && pinkyDown)        check("Yes 👍", 7);
  if (thumbDown && indexDown && middleDown && ringDown && pinkyDown)       check("No 👎", 7);
  if (indexUp  && middleUp && ringDown && pinkyDown)                       check("Peace ✌️", 7);
  if (indexUp  && middleDown && ringDown && pinkyDown)                     check("Pointing ☝️", 6);
  if (indexDown && middleDown && ringDown && pinkyDown)                    check("Fist ✊", 6);

  // Counting
  if (indexUp  && middleUp && ringUp && pinkyUp && !thumbUp)              check("Four ✋", 6);
  if (indexUp  && middleUp && ringUp && !pinkyUp)                         check("Three 3️⃣", 6);
  if (indexUp  && middleUp && !ringUp && !pinkyUp)                        check("Two ✌️", 6);
  if (indexUp  && middleDown && ringDown && pinkyDown)                    check("One ☝️", 6);

  // Extra
  if (thumbDown && indexUp)                                                check("Disagree ❌", 5);
  if (thumbUp   && middleUp && !indexUp)                                  check("Cool 😎", 5);
  if (indexDown && middleDown && ringUp && pinkyUp)                       check("Partial Open", 5);
  if (dist(4, 12) < 0.05)                                                 check("Pinch Middle 🤏", 5);
  if (dist(4, 16) < 0.05)                                                 check("Pinch Ring 🤏", 5);
  if (dist(4, 20) < 0.05)                                                 check("Pinch Pinky 🤏", 5);

  // ===== STABILITY =====
  const detected = best.name;

  if (detected === lastGesture) {
    stableCount++;
  } else {
    stableCount = 0;
  }
  lastGesture = detected;

  if (stableCount > 3) finalGesture = detected;

  // ===== OUTPUT (skip if unchanged) =====
  if (finalGesture === prevFinalGesture) return;
  prevFinalGesture = finalGesture;

  gestureEl.innerText = finalGesture;

  // Highlight instruction box — remove all active classes then add the matching one
  document.querySelectorAll("#instructionBox li.active-gesture")
    .forEach(li => li.classList.remove("active-gesture"));

  for (const [key, el] of GESTURE_EL_MAP) {
    if (el && finalGesture.includes(key)) {
      el.classList.add("active-gesture");
      break; // only one match needed
    }
  }

  // ===== EMIT (throttled to 800 ms) =====
  if (finalGesture !== "Detecting... 👀" && Date.now() - lastGestureTime > 800) {
    socket.emit("gesture", { room, text: finalGesture });
    lastGestureTime = Date.now();
  }
}

// ===== GESTURE: START =====
async function startGesture() {
  if (isGestureRunning) return;

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true });
      localVideo.srcObject = localStream;
    } catch {
      alert("Camera access denied!");
      return;
    }
  }

  gestureEl.innerText = "Starting... ⏳";

  // Wait until video has real pixel dimensions
  await new Promise((resolve) => {
    function check() {
      if (localVideo.videoWidth > 0 && localVideo.videoHeight > 0) resolve();
      else setTimeout(check, 100);
    }
    check();
  });

  canvas.width  = localVideo.videoWidth;
  canvas.height = localVideo.videoHeight;

  if (!initHands()) return;

  isGestureRunning = true;
  gestureEl.innerText = "Show your hand! 🖐";
  runGesture();
}

// ===== GESTURE: LOOP =====
async function runGesture() {
  if (!isGestureRunning) return;

  if (localVideo.readyState === 4 && localVideo.videoWidth > 0) {
    try {
      await hands.send({ image: localVideo });
    } catch (e) {
      console.error("Gesture error:", e);
    }
  }

  animFrameId = requestAnimationFrame(runGesture);
}

// ===== GESTURE: STOP =====
function stopGesture() {
  isGestureRunning = false;
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gestureEl.innerText = "Your Gesture: -";
  prevFinalGesture = "";
}

// ===== RECEIVE REMOTE GESTURE =====
socket.on("gesture", (d) => {
  remoteGestEl.innerText = d.sender + ": " + d.text;
});

// ===== FILE SHARING =====
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB guard

function sendFile() {
  const f = document.getElementById("file").files[0];
  if (!f) return;

  if (f.size > MAX_FILE_SIZE) {
    alert(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    socket.emit("file", { room, name: f.name, data: encrypt(reader.result) });
  };
  reader.readAsDataURL(f);
}

socket.on("file", (d) => {
  const a = document.createElement("a");
  a.href     = decrypt(d.data);
  a.download = d.name;
  a.innerText = "📎 Download " + d.name;
  messagesEl.appendChild(a);
});

// ===== THEME =====
const toggleMain  = document.getElementById("themeToggle");
const toggleLogin = document.getElementById("themeToggleLogin");

function updateUI(isLight) {
  const html = `${isLight ? "☀️" : "🌙"} <span>${isLight ? "Light" : "Dark"}</span>`;
  if (toggleMain)  toggleMain.innerHTML  = html;
  if (toggleLogin) toggleLogin.innerHTML = html;
}

function setTheme(mode) {
  const isLight = mode === "light";
  document.body.classList.toggle("light", isLight);
  localStorage.setItem("theme", mode);
  updateUI(isLight);
}

function toggleTheme() {
  setTheme(document.body.classList.contains("light") ? "dark" : "light");
}

if (toggleMain)  toggleMain.onclick  = toggleTheme;
if (toggleLogin) toggleLogin.onclick = toggleTheme;

window.addEventListener("DOMContentLoaded", () => {
  setTheme(localStorage.getItem("theme") || "dark");
});