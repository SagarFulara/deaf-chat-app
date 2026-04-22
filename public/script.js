// SOCKET FIX
const socket = io({
  transports: ["websocket"],
  reconnection: true
});

let name, room;
let pc;
let localStream;
let isGestureRunning = false;

// ELEMENTS
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ================= JOIN =================
function join() {
  name = document.getElementById("name").value;
  room = document.getElementById("room").value;

  console.log("Joining room:", room);

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

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    console.log("Remote stream received");
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("candidate", { room, candidate: e.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("offer", { room, offer });
}

// RECEIVE OFFER
socket.on("offer", async (offer) => {

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("candidate", { room, candidate: e.candidate });
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", { room, answer });
});

// RECEIVE ANSWER
socket.on("answer", async (ans) => {
  await pc.setRemoteDescription(new RTCSessionDescription(ans));
});

// ICE
socket.on("candidate", async (c) => {
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(c));
  }
});

// END CALL
function endCall() {

  if (pc) {
    pc.close();
    pc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// ================= GESTURE =================

if (typeof Hands === "undefined") {
  console.log("❌ MediaPipe not loaded");
}

const hands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

hands.onResults((res) => {

  console.log("RESULTS CALLED");

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

// RECEIVE GESTURE
socket.on("gesture", (d) => {
  document.getElementById("remoteGesture").innerText =
    d.sender + ": " + d.text;
});

// ================= RUN GESTURE LOOP =================
async function startGesture() {

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true });
    localVideo.srcObject = localStream;
  }

  await localVideo.play();

  canvas.width = localVideo.videoWidth || 320;
  canvas.height = localVideo.videoHeight || 240;

  isGestureRunning = true;

  runGesture();
}

// LOOP (UPDATED FIXED VERSION)
async function runGesture() {

  if (!isGestureRunning) return;

  try {
    await hands.send({
      image: localVideo
    });
  } catch (e) {
    console.log("ERROR:", e);
  }

  requestAnimationFrame(runGesture);
}

// STOP
function stopGesture() {
  isGestureRunning = false;
}

// ================= FILE =================
function sendFile() {
  const f = document.getElementById("file").files[0];
  if (!f) return;

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