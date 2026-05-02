// ===== ENCRYPTION =====
const SECRET_KEY = "deafchat-secret-123";

function encrypt(msg) {
  return CryptoJS.AES.encrypt(msg, SECRET_KEY).toString();
}

function decrypt(cipher) {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || "Error";
  } catch (err) {
    console.error("Decrypt failed:", err);
    return "Error";
  }
}

// ===== SOCKET =====
function createSocket() {
  if (typeof io === "function") {
    return io({
      transports: ["websocket"],
      reconnection: true
    });
  }

  console.warn("Socket.IO was not loaded. Open http://localhost:3000 for full realtime features.");

  return {
    connected: false,
    on() {},
    emit(eventName) {
      console.warn(`Preview mode: '${eventName}' was not sent because the server is not connected.`);
    }
  };
}

const socket = createSocket();

// ===== STATE =====
let name = "";
let room = "";
let pc = null;
let localStream = null;
let remoteStream = null;
let peerId = null;
let isCallStarted = false;
let peerReadyForCall = false;
let ownSocketId = "";
let isGestureRunning = false;
let hands = null;
let animFrameId = null;
let pendingCandidates = [];

let lastGestureTime = 0;
let lastGesture = "";
let stableCount = 0;
let finalGesture = "Detecting... 👀";

// ===== ELEMENTS =====
const $ = (id) => document.getElementById(id);

const els = {
  login: $("login"),
  main: $("main"),
  name: $("name"),
  room: $("room"),
  msg: $("msg"),
  messages: $("messages"),
  file: $("file"),
  localVideo: $("localVideo"),
  remoteVideo: $("remoteVideo"),
  canvas: $("canvas"),
  myGesture: $("myGesture"),
  remoteGesture: $("remoteGesture"),
  themeToggle: $("themeToggle"),
  themeToggleLogin: $("themeToggleLogin"),
  joinBtn: $("joinBtn"),
  startCallBtn: $("startCallBtn"),
  endCallBtn: $("endCallBtn"),
  startGestureBtn: $("startGestureBtn"),
  stopGestureBtn: $("stopGestureBtn"),
  sendMsgBtn: $("sendMsgBtn"),
  sendFileBtn: $("sendFileBtn")
};

const ctx = els.canvas.getContext("2d");
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
const ACTIVE_GESTURE_CLASS = "active-gesture";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const GESTURE_HIGHLIGHTS = [
  ["Hello", "g-hello"],
  ["Yes", "g-yes"],
  ["No", "g-no"],
  ["Peace", "g-peace"],
  ["Point", "g-point"],
  ["Fist", "g-fist"],
  ["Four", "g-four"],
  ["Three", "g-three"],
  ["Two", "g-two"],
  ["One", "g-one"],
  ["Rock", "g-rock"],
  ["Love", "g-ily"],
  ["Call", "g-call"],
  ["Gun", "g-gun"],
  ["OK", "g-ok"],
  ["Thank You", "g-thanks"],
  ["Need Help", "g-help"],
  ["Please Wait", "g-wait"],
  ["Repeat Please", "g-repeat"],
  ["I Am Fine", "g-fine"],
  ["Goodbye", "g-bye"],
  ["Sorry", "g-sorry"],
  ["Welcome", "g-welcome"],
  ["Water Please", "g-water"],
  ["Emergency", "g-emergency"],
  ["I Don't Understand", "g-understand"],
  ["Good Morning", "g-morning"],
  ["Good Night", "g-night"],
  ["Are You Okay", "g-okay"],
  ["Call Later", "g-call-later"]
];

let instructionItems = [];
const gestureHighlightElements = new Map();

function setText(el, text) {
  if (el) el.innerText = text;
}

function setDisplay(el, value) {
  if (!el) return;
  el.hidden = value === "none";
  el.style.display = value;
}

function addMsg(m) {
  const p = document.createElement("p");
  p.textContent = m;
  els.messages.appendChild(p);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function formatBytes(bytes = 0) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function setFileButtonBusy(isBusy) {
  if (!els.sendFileBtn) return;
  els.sendFileBtn.disabled = isBusy;
  els.sendFileBtn.textContent = isBusy ? "Sending..." : "📎 Send";
}

// ================= JOIN =================
function join() {
  name = els.name.value.trim();
  room = els.room.value.trim();
  peerId = null;
  isCallStarted = false;
  peerReadyForCall = false;

  if (!name || !room) {
    alert("Enter name and room!");
    return;
  }

  socket.emit("set-username", name);
  socket.emit("join-room", room);

  setDisplay(els.login, "none");
  setDisplay(els.main, "block");
}

// ================= CHAT =================
function sendMsg() {
  const msg = els.msg.value.trim();
  if (!msg) return;

  socket.emit("chat-message", {
    user: name,
    room,
    msg: encrypt(msg)
  });

  addMsg("You: " + msg);
  els.msg.value = "";
}

socket.on("chat-message", (d) => {
  addMsg(d.user + ": " + decrypt(d.msg));
});

socket.on("error-message", (message) => {
  addMsg("Server: " + message);
});

socket.on("socket-id", (id) => {
  ownSocketId = id || "";
});

// ===== FIX 3: peerReadyForCall = true added =====
socket.on("room-peers", (data) => {
  const peers = Array.isArray(data?.peers) ? data.peers : [];

  if (peers.length > 0) {
    peerId = peers[0].id;
    peerReadyForCall = true; // FIX: peer already present hai toh ready consider karo
    addMsg(`${peers[0].username || "User"} is already in this room. Press Start to call.`);
  } else {
    addMsg("Room joined. Waiting for another user...");
  }
});

socket.on("peer-joined", (peer) => {
  if (!peer?.id) return;

  peerId = peer.id;
  addMsg(`${peer.username || "User"} joined the room.`);

  if (isCallStarted && !pc) {
    setRemoteStatus("Peer joined. Ask them to press Start too.");
    socket.emit("call-ready", { room });
  }
});

socket.on("call-ready", (data) => {
  if (!data?.from) return;

  peerId = data.from;
  peerReadyForCall = true;
  addMsg(`${data.sender || "User"} is ready for video call.`);

  if (isCallStarted && !pc && shouldCreateOffer(peerId)) {
    callPeer(peerId);
  } else if (!isCallStarted) {
    setRemoteStatus("Peer ready. Press Start to connect.");
  } else {
    setRemoteStatus("Both ready. Waiting for peer offer...");
  }
});

// ================= VIDEO HELPERS =================
async function ensureLocalStream({ audio = false } = {}) {
  const hasLiveVideo = localStream?.getVideoTracks().some((t) => t.readyState === "live");
  const hasLiveAudio = localStream?.getAudioTracks().some((t) => t.readyState === "live");

  if (!localStream || !hasLiveVideo) {
    localStream?.getTracks().forEach((track) => track.stop());

    // Pehle video+audio try karo, fail hone pe sirf video
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio });
    } catch (err) {
      console.warn("Audio+video failed, trying video only:", err);
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      addMsg("Microphone access denied — call will continue without audio.");
    }
  } else if (audio && !hasLiveAudio) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStream.getAudioTracks().forEach((track) => localStream.addTrack(track));
    } catch (err) {
      console.warn("Could not add audio track:", err);
      addMsg("Microphone access denied — call will continue without audio.");
    }
  }

  els.localVideo.srcObject = localStream;
  return localStream;
}

function closePeerConnection() {
  if (!pc) return;
  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.onconnectionstatechange = null;
  pc.oniceconnectionstatechange = null;
  pc.close();
  pc = null;
  pendingCandidates = [];
}

function setRemoteStatus(text) {
  setText(els.remoteGesture, text);
}

async function playRemoteVideo() {
  if (!els.remoteVideo.srcObject) return;
  els.remoteVideo.autoplay = true;
  els.remoteVideo.playsInline = true;
  try {
    await els.remoteVideo.play();
  } catch (err) {
    console.warn("Autoplay blocked, waiting for user click...");
    if (!window._videoClickBound) {
      window._videoClickBound = true;
      document.body.addEventListener("click", async () => {
        try {
          await els.remoteVideo.play();
        } catch (e) {
          console.log("Play failed:", e);
        }
      }, { once: true });
    }
  }
}

function createPeerConnection(targetPeerId = peerId) {
  closePeerConnection();
  peerId = targetPeerId || peerId;

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  remoteStream = new MediaStream();
  els.remoteVideo.srcObject = remoteStream;

  // ===== FIX 1: ontrack — sirf ek baar track add karo =====
  pc.ontrack = (e) => {
    console.log("TRACK RECEIVED", e.track.kind);
    if (!remoteStream.getTracks().some((t) => t.id === e.track.id)) {
      remoteStream.addTrack(e.track);
    }
    setRemoteStatus("Remote connected");
    playRemoteVideo();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && peerId) {
      socket.emit("candidate", { room, to: peerId, candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    console.log("Connection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
      setRemoteStatus("Remote connected");
      playRemoteVideo();
    }
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      setRemoteStatus("Remote connection issue. Try End, then Start again.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (!pc) return;
    console.log("ICE state:", pc.iceConnectionState);
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      setRemoteStatus("Remote connected");
      playRemoteVideo();
    }
  };

  return pc;
}

function addLocalTracks(peer, stream) {
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
}

async function flushPendingCandidates() {
  if (!pc?.remoteDescription) return;
  const candidates = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Queued ICE candidate failed:", err);
    }
  }
}

function unwrapSignal(payload, key) {
  return payload?.[key] || payload;
}

// ================= VIDEO CALL =================
// ===== FIX 2: shouldCreateOffer — < use karo taaki sirf ek peer offer kare =====
function shouldCreateOffer(targetPeerId) {
  if (!ownSocketId || !targetPeerId) return true;
  return ownSocketId < targetPeerId;
}

async function callPeer(targetPeerId) {
  if (!targetPeerId) {
    socket.emit("call-ready", { room });
    setRemoteStatus("Waiting for another user...");
    return;
  }

  setRemoteStatus("Calling...");

  const peer = createPeerConnection(targetPeerId);
  const stream = await ensureLocalStream({ audio: true });

  addLocalTracks(peer, stream);

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit("offer", { room, to: targetPeerId, offer });
}

async function startCall() {
  if (!room) {
    addMsg("Join a room before starting a call.");
    return;
  }

  if (!socket.connected) {
    addMsg("Call not started: server is not connected. Open http://localhost:3000.");
    return;
  }

  try {
    isCallStarted = true;
    await ensureLocalStream({ audio: true });

    socket.emit("call-ready", { room });

    if (!peerId) {
      setRemoteStatus("Waiting for another user...");
      addMsg("Call ready. Ask the other user to join and press Start.");
      return;
    }

    if (!peerReadyForCall) {
      setRemoteStatus("Waiting for peer to press Start...");
      addMsg("Ask the other user to press Start too.");
      return;
    }

    if (shouldCreateOffer(peerId)) {
      await callPeer(peerId);
    } else {
      setRemoteStatus("Both ready. Waiting for peer offer...");
    }
  } catch (err) {
    console.error("Call start failed:", err);
    addMsg("Could not start the call: " + (err?.message || "unknown error"));
    isCallStarted = false;
    closePeerConnection();
  }
}

socket.on("offer", async (payload) => {
  const offer = unwrapSignal(payload, "offer");
  if (!offer) return;
  peerId = payload?.from || peerId;
  peerReadyForCall = true;

  try {
    isCallStarted = true;
    setRemoteStatus("Incoming call...");
    const peer = createPeerConnection(peerId);
    const stream = await ensureLocalStream({ audio: true });

    addLocalTracks(peer, stream);

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingCandidates();

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("answer", { room, to: peerId, answer });
  } catch (err) {
    console.error("Offer handling failed:", err);
    alert("Could not answer the call.");
    isCallStarted = false;
    closePeerConnection();
  }
});

socket.on("answer", async (payload) => {
  const answer = unwrapSignal(payload, "answer");
  if (!pc || !answer) return;
  peerId = payload?.from || peerId;

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingCandidates();
  } catch (err) {
    console.error("Answer handling failed:", err);
  }
});

socket.on("candidate", async (payload) => {
  const candidate = unwrapSignal(payload, "candidate");
  if (!candidate) return;
  peerId = payload?.from || peerId;

  if (!pc || !pc.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("ICE candidate failed:", err);
  }
});

function endCall() {
  closePeerConnection();
  els.remoteVideo.srcObject = null;
  remoteStream = null;
  isCallStarted = false;
  peerReadyForCall = false;
  setRemoteStatus("Remote: —");

  if (!localStream) return;

  localStream.getAudioTracks().forEach((track) => {
    track.stop();
    localStream.removeTrack(track);
  });

  if (!isGestureRunning) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    els.localVideo.srcObject = null;
  }
}

// ================= GESTURE - INIT MEDIAPIPE =================
function initHands() {
  if (hands) return true;

  if (
    typeof Hands === "undefined" ||
    typeof drawConnectors === "undefined" ||
    typeof drawLandmarks === "undefined" ||
    typeof HAND_CONNECTIONS === "undefined"
  ) {
    alert("MediaPipe failed to load. Check your internet connection and refresh.");
    return false;
  }

  hands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
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

function syncCanvasToVideo() {
  const width = els.localVideo.videoWidth;
  const height = els.localVideo.videoHeight;

  if (width > 0 && height > 0 && (els.canvas.width !== width || els.canvas.height !== height)) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
}

function resetGestureStability() {
  lastGesture = "";
  stableCount = 0;
  finalGesture = "Detecting... 👀";
}

function cacheGestureHighlightElements() {
  instructionItems = Array.from(document.querySelectorAll("#instructionBox li"));
  gestureHighlightElements.clear();

  GESTURE_HIGHLIGHTS.forEach(([, id]) => {
    gestureHighlightElements.set(id, $(id));
  });
}

function highlightGesture(output) {
  instructionItems.forEach((li) => li.classList.remove(ACTIVE_GESTURE_CLASS));

  const match = GESTURE_HIGHLIGHTS.find(([label]) => output.includes(label));
  if (match) {
    gestureHighlightElements.get(match[1])?.classList.add(ACTIVE_GESTURE_CLASS);
  }
}

function waitForVideoReady(timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function check() {
      if (els.localVideo.videoWidth > 0 && els.localVideo.videoHeight > 0) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Video did not become ready in time."));
        return;
      }
      setTimeout(check, 100);
    }

    check();
  });
}

// ================= GESTURE - RESULTS HANDLER =================
function onHandResults(res) {
  syncCanvasToVideo();
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  if (!res.multiHandLandmarks?.length) {
    resetGestureStability();
    setText(els.myGesture, "No Hand ❌");
    highlightGesture("");
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
  const check = (candidateName, score) => {
    if (score > best.score) best = { name: candidateName, score };
  };

  if (dist(4, 8) < 0.05) check("OK 👌", 10);
  if (thumbUp && indexUp && pinkyUp && middleDown && ringDown) check("I Love You 🤟", 9);
  if (indexUp && pinkyUp && middleDown && ringDown) check("Rock 🤘", 8);
  if (thumbUp && pinkyUp && indexDown && middleDown && ringDown) check("Call Me 🤙", 8);
  if (thumbUp && indexUp && middleDown && ringDown && pinkyDown) check("Gun 🔫", 8);

  if (indexUp && middleUp && ringUp && pinkyUp) check("Hello ✋", 7);
  if (thumbUp && indexDown && middleDown && ringDown && pinkyDown) check("Yes 👍", 7);
  if (thumbDown && indexDown && middleDown && ringDown && pinkyDown) check("No 👎", 7);
  if (indexUp && middleUp && ringDown && pinkyDown) check("Peace ✌️", 7);
  if (indexUp && middleDown && ringDown && pinkyDown) check("Pointing ☝️", 6);
  if (indexDown && middleDown && ringDown && pinkyDown) check("Fist ✊", 6);

  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp) check("Four ✋", 6);
  if (indexUp && middleUp && ringUp && !pinkyUp) check("Three 3️⃣", 6);
  if (indexUp && middleUp && !ringUp && !pinkyUp) check("Two ✌️", 6);
  if (indexUp && middleDown && ringDown && pinkyDown) check("One ☝️", 6);

  if (dist(4, 12) < 0.05) check("Thank You 🙏", 5);
  if (dist(4, 16) < 0.05) check("Need Help 🆘", 5);
  if (dist(4, 20) < 0.05) check("Please Wait ⏳", 5);
  if (thumbDown && indexUp) check("Repeat Please 🔁", 5);
  if (thumbUp && middleUp && !indexUp) check("I Am Fine ✅", 5);
  if (indexDown && middleDown && ringUp && pinkyUp) check("Goodbye 👋", 5);
  if (thumbDown && pinkyUp && indexDown && middleDown && ringDown) check("Sorry 🙏", 6);
  if (middleUp && ringUp && indexDown && pinkyDown) check("Welcome 😊", 6);
  if (thumbUp && ringUp && indexDown && middleDown && pinkyDown) check("Water Please 💧", 6);
  if (thumbUp && ringUp && pinkyUp && indexDown && middleDown) check("Emergency 🚨", 7);
  if (thumbDown && indexUp && middleUp && ringDown && pinkyDown) check("I Don't Understand ❓", 8);
  if (thumbUp && indexUp && middleUp && ringDown && pinkyDown) check("Good Morning 🌅", 8);
  if (thumbDown && indexUp && middleUp && ringUp && pinkyDown) check("Good Night 🌙", 8);
  if (indexUp && ringUp && middleDown && pinkyDown) check("Are You Okay? ❔", 6);
  if (thumbDown && middleUp && pinkyUp && indexDown && ringDown) check("Call Later 📞", 6);

  if (best.name === lastGesture) {
    stableCount++;
  } else {
    stableCount = 0;
    lastGesture = best.name;
  }

  if (stableCount > 3) {
    finalGesture = best.name;
  }

  setText(els.myGesture, finalGesture);
  highlightGesture(finalGesture);

  if (finalGesture !== "Detecting... 👀" && Date.now() - lastGestureTime > 800) {
    socket.emit("gesture", { room, text: finalGesture });
    lastGestureTime = Date.now();
  }
}

// ================= GESTURE - START =================
async function startGesture() {
  if (isGestureRunning) return;

  try {
    await ensureLocalStream();
    setText(els.myGesture, "Starting... ⏳");
    await waitForVideoReady();
    syncCanvasToVideo();

    if (!initHands()) {
      setText(els.myGesture, "Your Gesture: -");
      return;
    }

    isGestureRunning = true;
    setText(els.myGesture, "Show your hand! 🖐");
    runGesture();
  } catch (err) {
    console.error("Gesture start failed:", err);
    alert("Camera access denied or unavailable!");
  }
}

// ================= GESTURE - LOOP =================
async function runGesture() {
  if (!isGestureRunning) return;

  if (els.localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && els.localVideo.videoWidth > 0) {
    try {
      await hands.send({ image: els.localVideo });
    } catch (err) {
      console.error("Gesture error:", err);
    }
  }

  animFrameId = requestAnimationFrame(runGesture);
}

// ================= GESTURE - STOP =================
function stopGesture() {
  isGestureRunning = false;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  resetGestureStability();
  highlightGesture("");
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  setText(els.myGesture, "Your Gesture: -");
}

socket.on("gesture", (d) => {
  setText(els.remoteGesture, d.sender + ": " + d.text);
});

// ================= FILE =================
function sendFile() {
  const f = els.file.files[0];
  if (!f) {
    addMsg("Choose a file first.");
    return;
  }

  if (!room) {
    addMsg("Join a room before sending a file.");
    return;
  }

  if (!socket.connected) {
    addMsg("File not sent: server is not connected. Open http://localhost:3000.");
    return;
  }

  if (f.size > MAX_FILE_BYTES) {
    addMsg(`File too large: ${formatBytes(f.size)}. Max allowed is ${formatBytes(MAX_FILE_BYTES)}.`);
    return;
  }

  const reader = new FileReader();
  setFileButtonBusy(true);

  reader.onload = () => {
    let encryptedData = "";

    try {
      encryptedData = encrypt(reader.result);
    } catch (err) {
      console.error("File encryption failed:", err);
      addMsg("File not sent: encryption failed.");
      setFileButtonBusy(false);
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      setFileButtonBusy(false);
      addMsg("File may not have sent: server did not confirm in time.");
    }, 12000);

    socket.emit("file", {
      room,
      name: f.name,
      size: f.size,
      type: f.type,
      data: encryptedData
    }, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setFileButtonBusy(false);

      if (!res?.ok) {
        addMsg("File not sent: " + (res?.error || "server rejected it."));
        return;
      }

      addMsg(`You sent ${f.name} ${formatBytes(f.size) ? `(${formatBytes(f.size)})` : ""}`);
      els.file.value = "";
    });
  };

  reader.onerror = () => {
    setFileButtonBusy(false);
    alert("Could not read that file.");
  };

  reader.readAsDataURL(f);
}

socket.on("file", (d) => {
  const decryptedData = decrypt(d.data);

  if (decryptedData === "Error" || !decryptedData.startsWith("data:")) {
    addMsg("Could not decrypt file: " + d.name);
    return;
  }

  addMsg(`${d.sender || "User"} sent ${d.name} ${formatBytes(d.size) ? `(${formatBytes(d.size)})` : ""}`);

  const a = document.createElement("a");
  a.href = decryptedData;
  a.download = d.name;
  a.innerText = "📎 Download " + d.name;

  els.messages.appendChild(a);
  els.messages.scrollTop = els.messages.scrollHeight;
});

// ===== THEME TOGGLE =====
function updateUI(isLight) {
  const text = isLight ? "Light" : "Dark";
  const icon = isLight ? "☀️" : "🌙";
  const label = `${icon} <span>${text}</span>`;

  if (els.themeToggle) els.themeToggle.innerHTML = label;
  if (els.themeToggleLogin) els.themeToggleLogin.innerHTML = label;
}

function setTheme(mode) {
  const isLight = mode === "light";
  document.body.classList.toggle("light", isLight);
  localStorage.setItem("theme", isLight ? "light" : "dark");
  updateUI(isLight);
}

function toggleTheme() {
  setTheme(document.body.classList.contains("light") ? "dark" : "light");
}

if (els.themeToggle) els.themeToggle.onclick = toggleTheme;
if (els.themeToggleLogin) els.themeToggleLogin.onclick = toggleTheme;

window.addEventListener("DOMContentLoaded", () => {
  cacheGestureHighlightElements();
  setTheme(localStorage.getItem("theme") || "dark");

  els.joinBtn?.addEventListener("click", join);
  els.startCallBtn?.addEventListener("click", startCall);
  els.endCallBtn?.addEventListener("click", endCall);
  els.startGestureBtn?.addEventListener("click", startGesture);
  els.stopGestureBtn?.addEventListener("click", stopGesture);
  els.sendMsgBtn?.addEventListener("click", sendMsg);
  els.sendFileBtn?.addEventListener("click", sendFile);
  els.msg?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMsg();
  });
});
