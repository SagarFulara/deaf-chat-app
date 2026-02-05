const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let roomId = "";
let pc;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// ================= LOGIN =================
function login() {
    username = document.getElementById("username").value.trim();
    roomId = document.getElementById("room").value.trim();

    if (!username || !roomId) {
        alert("Enter username and room");
        return;
    }

    socket.emit("join-room", { roomId, username });

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;

    addMessage(`You joined room: ${roomId}`);
}

// ============== SIMPLE ENCRYPTION ==============
function simpleEncrypt(text) {
    return btoa(text);
}

function simpleDecrypt(text) {
    return atob(text);
}

// ================= CHAT =================
function sendMessage() {
    let msg = document.getElementById("messageInput").value.trim();
    if (!msg) return;

    addMessage(`You: ${msg}`);
    socket.emit("private-message", {
        roomId,
        message: simpleEncrypt(msg)
    });

    document.getElementById("messageInput").value = "";
}

socket.on("private-message", (data) => {
    addMessage(`${data.username}: ${simpleDecrypt(data.message)}`);
});

// ================= FILE TRANSFER =================
function sendFile() {
    const fileInput = document.getElementById("fileInput");
    if (fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = () => {
        socket.emit("file-transfer", {
            roomId,
            fileName: file.name,
            fileData: reader.result
        });
    };

    reader.readAsDataURL(file);
    fileInput.value = "";
}

socket.on("file-transfer", (data) => {
    const link = document.createElement("a");
    link.href = data.fileData;
    link.download = data.fileName;
    link.innerText = `${data.username} sent: ${data.fileName}`;
    link.style.display = "block";

    document.getElementById("messages").appendChild(link);
    document.getElementById("messages").scrollTop =
        document.getElementById("messages").scrollHeight;
});

// ================= UTILITY =================
function addMessage(text) {
    const msgBox = document.getElementById("messages");
    const time = new Date().toLocaleTimeString();
    msgBox.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ================= VIDEO CALL (WEBRTC) =================
async function startCall() {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    localVideo.srcObject = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", {
                roomId,
                candidate: e.candidate
            });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId, offer });

    // ---- START HAND GESTURES AFTER VIDEO START ----
    initHandGestures();
}

socket.on("offer", async (offer) => {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    localVideo.srcObject = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", {
                roomId,
                candidate: e.candidate
            });
        }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId, answer });

    // Start gestures on receiver side also
    initHandGestures();
});

socket.on("answer", async (answer) => {
    await pc.setRemoteDescription(answer);
});

socket.on("candidate", async (candidate) => {
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

function endCall() {
    if (pc) {
        pc.close();
        pc = null;
        alert("Call ended");
    }
}

// ================= HAND GESTURES =================
let hands;
let camera;
let gestureEstimator;

function initHandGestures() {
    hands = new Hands({
        locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
    });

    gestureEstimator = new Fingerpose.GestureEstimator([
        Fingerpose.Gestures.ThumbsUpGesture, // Yes
        Fingerpose.Gestures.VictoryGesture, // Hello
        Fingerpose.Gestures.FistGesture, // No
        Fingerpose.Gestures.OpenPalmGesture, // How are you?
        Fingerpose.Gestures.OkayGesture, // OK
        Fingerpose.Gestures.PrayingGesture // Thank you
    ]);

    camera = new Camera(localVideo, {
        onFrame: async () => {
            await hands.send({ image: localVideo });
        },
        width: 640,
        height: 480
    });

    hands.onResults((results) => {
        if (
            results.multiHandLandmarks &&
            results.multiHandLandmarks.length > 0
        ) {
            const estimation = gestureEstimator.estimate(
                results.multiHandLandmarks[0],
                8
            );

            if (estimation.gestures.length > 0) {
                const best = estimation.gestures.reduce((p, c) =>
                    p.confidence > c.confidence ? p : c
                );

                showGesture(best.name);
            }
        }
    });

    camera.start();
}

function showGesture(name) {
    const gestureMap = {
        thumbs_up: "Yes 👍",
        victory: "Hello ✋",
        fist: "No ✊",
        open_palm: "How are you? 🖐️",
        okay: "OK ✅",
        praying: "Thank you 🙏"
    };

    const text = gestureMap[name] || "";
    document.getElementById("gestureCaption").innerText = text;

    if (text) {
        addMessage(`Gesture: ${text}`);
        socket.emit("gesture", { roomId, gesture: text });
    }
}

// Receive gestures from other user
socket.on("gesture", (data) => {
    addMessage(`${data.username} Gesture: ${data.gesture}`);
});
