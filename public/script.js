const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let room = "";
let pc = null;
let localStream = null;
let hands = null;
let gestureCamera = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const handVideo = document.getElementById("handFeed");
const gestureBox = document.getElementById("gestureText");

// ================= LOGIN =================
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

// ================= CHAT =================
function sendMessage() {
    let msg = document.getElementById("messageInput").value;
    if (!msg) return;

    let encrypted = btoa(msg);
    addMessage(`You: ${msg}`);

    socket.emit("private-message", { roomId: room, message: encrypted });
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

// ================= VIDEO CALL (FIXED) =================
async function startCall() {
    if (!room) return alert("Join a room first!");

    pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("candidate", { roomId: room, candidate: event.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId: room, offer });
}

socket.on("offer", async (offer) => {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("candidate", { roomId: room, candidate: event.candidate });
        }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId: room, answer });
});

socket.on("answer", async (answer) => {
    await pc.setRemoteDescription(answer);
});

socket.on("candidate", async (c) => {
    await pc.addIceCandidate(new RTCIceCandidate(c));
});

function endCall() {
    if (pc) {
        pc.close();
        pc = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localVideo.srcObject = null;
    }

    remoteVideo.srcObject = null;
}

// ================= HAND GESTURES (FIXED) =================
async function startHandGestures() {
    hands = new Hands({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(processHandResult);

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    handVideo.srcObject = stream;

    gestureCamera = new Camera(handVideo, {
        onFrame: async () => await hands.send({ image: handVideo }),
        width: 640,
        height: 480
    });

    gestureCamera.start();
}

function processHandResult(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        gestureBox.innerText = "No hand detected";
        return;
    }

    const lm = results.multiHandLandmarks[0];
    let g = detectGesture(lm);

    if (g) {
        gestureBox.innerText = `You: ${g}`;
        socket.emit("gesture", { roomId: room, gesture: g });
    }
}

function detectGesture(lm) {
    const thumb = lm[4];      // Thumb tip
    const index = lm[8];      // Index tip
    const middle = lm[12];    // Middle tip
    const wrist = lm[0];      // Wrist

    // ---- HELLO (hand raised clearly) ----
    if (wrist.y < index.y - 0.18) {
        return "HELLO 👋";
    }

    // ---- YES (STRICT THUMBS UP) ----
    if (
        thumb.y < wrist.y - 0.12 &&      // thumb clearly above wrist
        index.y > wrist.y               // index DOWN (closed fist)
    ) {
        return "YES 👍";
    }

    // ---- NO (OPEN PALM) ----
    if (
        index.y < wrist.y &&
        middle.y < wrist.y
    ) {
        return "NO ✋";
    }

    return null;
}

socket.on("gesture", (data) => {
    gestureBox.innerText = `${data.username}: ${data.gesture}`;
});

// ================= FILE TRANSFER =================
function sendFile() {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return alert("Select a file");

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
    addMessage(`Received file: ${data.fileName}`);

    const a = document.createElement("a");
    a.href = data.fileData;
    a.download = data.fileName;
    a.click();
});
