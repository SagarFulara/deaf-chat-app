const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let room = "";      // <-- ROOM USER DALEGA
let pc;
let handStream = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const handFeed = document.getElementById("handFeed");

const myGestureLabel = document.getElementById("myGesture");
const friendGestureLabel = document.getElementById("friendGesture");

// ========== LOGIN + ROOM ==========
function login() {
    username = document.getElementById("username").value;
    room = document.getElementById("room").value;

    if (!username || !room) {
        alert("Enter name AND room");
        return;
    }

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;
    document.getElementById("roomLabel").innerText = room;

    socket.emit("join-room", room);
    socket.emit("set-username", username);
}

// ========== CHAT ==========
function sendMessage() {
    let msg = document.getElementById("messageInput").value;
    if (!msg) return;

    addMessage(`You: ${msg}`);
    socket.emit("chat-message", { roomId: room, user: username, message: msg });
    document.getElementById("messageInput").value = "";
}

socket.on("chat-message", (data) => {
    if (data.roomId === room) {
        addMessage(`${data.user}: ${data.message}`);
    }
});

function addMessage(text) {
    let msgBox = document.getElementById("messages");
    let time = new Date().toLocaleTimeString();
    msgBox.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ========== WEBRTC VIDEO CALL ==========
async function startCall() {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("candidate", { roomId: room, candidate: event.candidate });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId: room, offer });
}

socket.on("offer", async (data) => {
    if (data.roomId !== room) return;

    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("candidate", { roomId: room, candidate: event.candidate });
        }
    };

    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId: room, answer });
});

socket.on("answer", async (data) => {
    if (data.roomId !== room) return;
    await pc.setRemoteDescription(data.answer);
});

socket.on("candidate", async (data) => {
    if (data.roomId !== room) return;
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
});

function endCall() {
    if (pc) {
        pc.getSenders().forEach(sender => sender.track?.stop());
        pc.close();
        pc = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    if (handStream) {
        handStream.getTracks().forEach(t => t.stop());
        handStream = null;
    }
}

// ========== HAND GESTURE ==========
let hands;
let camera;

async function startHandTracking() {
    hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(processHandResult);

    handStream = await navigator.mediaDevices.getUserMedia({ video: true });
    handFeed.srcObject = handStream;

    camera = new Camera(handFeed, {
        onFrame: async () => {
            await hands.send({ image: handFeed });
        },
        width: 640,
        height: 480
    });

    camera.start();
}

// SIMPLE GESTURE RULES (ALAG-ALAG LABEL KE LIYE)
function detectGesture(landmarks) {
    let tip = landmarks[8];   // index finger tip
    let base = landmarks[5];  // index finger base

    if (tip.y < base.y - 0.05) return "HELLO 👋";
    if (tip.x > 0.7) return "YES 👍";
    if (tip.x < 0.3) return "NO ✋";
    return "LISTENING 🤝";
}

function processHandResult(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        myGestureLabel.innerText = "Your Gesture: No hand detected";
        return;
    }

    const lm = results.multiHandLandmarks[0];
    let g = detectGesture(lm);

    myGestureLabel.innerText = `Your Gesture: ${g}`;
    socket.emit("gesture", { roomId: room, gesture: g });
}

socket.on("gesture", (data) => {
    if (data.roomId === room) {
        friendGestureLabel.innerText = `${data.username}: ${data.gesture}`;
    }
});
