const socket = io();

let username = "";
let room = "";
let pc;
let camera;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const gestureVideo = document.getElementById("gestureVideo");

// LOGIN
function login() {
    username = document.getElementById("username").value;
    room = document.getElementById("roomId").value;

    socket.emit("set-username", username);
    socket.emit("join-room", room);

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";

    document.getElementById("userLabel").innerText = username;
    document.getElementById("roomLabel").innerText = room;
}

// CHAT
function sendMessage() {
    const msg = document.getElementById("messageInput").value;

    socket.emit("chat-message", {
        user: username,
        roomId: room,
        message: btoa(msg)
    });

    addMessage("You: " + msg);
}

socket.on("chat-message", (data) => {
    addMessage(data.user + ": " + atob(data.message));
});

function addMessage(text) {
    document.getElementById("messages").innerHTML += "<p>" + text + "</p>";
}

// VIDEO CALL
async function startCall() {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit("candidate", { roomId: room, candidate: e.candidate });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { roomId: room, offer });
}

socket.on("offer", async (offer) => {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit("candidate", { roomId: room, candidate: e.candidate });
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
    if (pc) pc.close();
}

// ===== MEDIA PIPE HAND GESTURE =====
const hands = new Hands({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

// SIMPLE DETECTION
function detectGesture(l) {
    if (l[8].y < l[6].y) return {en:"Hello ✋", hi:"नमस्ते"};
    if (l[4].y < l[8].y) return {en:"Yes 👍", hi:"हाँ"};
    if (l[4].y > l[8].y) return {en:"No 👎", hi:"नहीं"};
    return {en:"Detecting...", hi:"पहचान"};
}

// RESULTS
function onResults(results) {

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        document.getElementById("myGesture").innerText = "No Hand ❌";
        return;
    }

    const l = results.multiHandLandmarks[0];

    console.log("Hand detected ✅");

    const g = detectGesture(l);

    document.getElementById("myGesture").innerText =
        `Your: ${g.en} (${g.hi})`;

    socket.emit("gesture", {
        roomId: room,
        gesture: `${g.en} (${g.hi})`
    });
}

// START GESTURE (SEPARATE CAMERA)
async function startGesture() {
    if (camera) return;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });

    gestureVideo.srcObject = stream;

    camera = new Camera(gestureVideo, {
        onFrame: async () => {
            await hands.send({ image: gestureVideo });
        },
        width: 300,
        height: 200
    });

    camera.start();

    document.getElementById("myGesture").innerText = "Gesture Started ✅";
}

// STOP
function stopGesture() {
    if (camera) {
        camera.stop();
        camera = null;
    }

    if (gestureVideo.srcObject) {
        gestureVideo.srcObject.getTracks().forEach(track => track.stop());
    }

    gestureVideo.srcObject = null;

    document.getElementById("myGesture").innerText = "Stopped ❌";
}

// RECEIVE GESTURE
socket.on("gesture", (data) => {
    if (data.senderId !== socket.id) {
        document.getElementById("remoteGesture").innerText =
            data.username + ": " + data.gesture;
    }
});

// FILE TRANSFER
function sendFile() {
    const file = document.getElementById("fileInput").files[0];
    const reader = new FileReader();

    reader.onload = () => {
        socket.emit("file", {
            roomId: room,
            fileName: file.name,
            fileType: file.type,
            fileData: btoa(
                new Uint8Array(reader.result)
                    .reduce((d, b) => d + String.fromCharCode(b), "")
            )
        });
    };

    reader.readAsArrayBuffer(file);
}

socket.on("file", (data) => {
    const blob = new Blob([Uint8Array.from(atob(data.fileData), c => c.charCodeAt(0))]);
    const url = URL.createObjectURL(blob);

    addMessage(`${data.sender} sent file`);

    const a = document.createElement("a");
    a.href = url;
    a.download = data.fileName;
    a.innerText = "Download";
    document.getElementById("messages").appendChild(a);
});