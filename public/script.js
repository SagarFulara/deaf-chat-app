const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let room = "";
let pc = null;
let localStream = null;
let handStream = null;
let gestureCamera = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const handVideo = document.getElementById("handFeed");   // 🔥 NEW
const gestureBox = document.getElementById("gestureCaption");

// ---------- LOGIN ----------
function login() {
    username = document.getElementById("username").value;
    room = document.getElementById("room").value;

    if (!username || !room) {
        alert("Enter name and room!");
        return;
    }

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;

    socket.emit("join-room", { roomId: room, username });
}

// ---------- CHAT ----------
function sendMessage() {
    let msg = document.getElementById("messageInput").value;
    if (!msg) return;

    addMessage(`You: ${msg}`);

    socket.emit("private-message", {
        roomId: room,
        message: btoa(msg)
    });

    document.getElementById("messageInput").value = "";
}

socket.on("private-message", (data) => {
    addMessage(`${data.username}: ${atob(data.message)}`);
});

function addMessage(text) {
    let box = document.getElementById("messages");
    let time = new Date().toLocaleTimeString();
    box.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    box.scrollTop = box.scrollHeight;
}

// ---------- FILE TRANSFER ----------
function sendFile() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = () => {
        socket.emit("file-transfer", {
            roomId: room,
            fileName: file.name,
            fileData: reader.result
        });

        addMessage(`You sent file: ${file.name}`);
    };
}

socket.on("file-transfer", (data) => {
    addMessage(`${data.username} sent file: ${data.fileName}`);

    const link = document.createElement("a");
    link.href = data.fileData;
    link.download = data.fileName;
    link.innerText = "Download " + data.fileName;

    document.getElementById("messages").appendChild(link);
});

// =====================
// ✅ FIXED WEBRTC VIDEO
// =====================

async function startCall() {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ]
    });

    // MAIN VIDEO STREAM (for call)
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.style.display = "block";

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.style.display = "block";
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", { roomId: room, candidate: e.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId: room, offer });

    // 🔥 START GESTURES (separate camera)
    startGestureDetection();
}

socket.on("offer", async (offer) => {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ]
    });

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.style.display = "block";

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.style.display = "block";
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", { roomId: room, candidate: e.candidate });
        }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId: room, answer });

    startGestureDetection();
});

socket.on("answer", async (answer) => {
    await pc.setRemoteDescription(answer);
});

socket.on("candidate", async (candidate) => {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

function endCall() {
    if (pc) {
        pc.close();
        pc = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    if (handStream) {
        handStream.getTracks().forEach(t => t.stop());
        handStream = null;
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    handVideo.srcObject = null;

    localVideo.style.display = "none";
    remoteVideo.style.display = "none";

    if (gestureCamera) {
        gestureCamera.stop();
        gestureCamera = null;
    }

    alert("Call ended");
}

// =====================
// ✅ WORKING HAND GESTURES (PROPER FIX)
// =====================

const hands = new Hands({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(results => {
    if (!results.multiHandLandmarks) return;

    const gesture = detectGesture(results.multiHandLandmarks[0]);
    if (gesture) {
        gestureBox.innerText = "You: " + gesture;
        socket.emit("gesture", { roomId: room, gesture });
    }
});

async function startGestureDetection() {
    // 🔥 SEPARATE CAMERA ONLY FOR GESTURES
    handStream = await navigator.mediaDevices.getUserMedia({ video: true });
    handVideo.srcObject = handStream;

    gestureCamera = new Camera(handVideo, {
        onFrame: async () => {
            await hands.send({ image: handVideo });
        },
        width: 640,
        height: 480
    });

    gestureCamera.start();
}

// SIMPLE BUT RELIABLE GESTURES
function detectGesture(landmarks) {
    const tip = landmarks[8];   // index tip
    const base = landmarks[5];  // index base

    if (tip.y < base.y - 0.05) return "HELLO 👋";
    if (tip.x > base.x + 0.05) return "YES 👍";
    if (tip.x < base.x - 0.05) return "NO ✋";
    return null;
}

// Receive gesture from other user
socket.on("gesture", (data) => {
    gestureBox.innerText = `${data.username}: ${data.gesture}`;
});
