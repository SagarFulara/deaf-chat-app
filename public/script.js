// Connect to your Render-deployed Socket.IO server
const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let roomId = "";
let pc;
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// ======= LOGIN / JOIN ROOM =======
function login() {
    username = document.getElementById("username").value.trim();
    roomId = document.getElementById("room").value.trim();

    if (!username || !roomId) {
        alert("Enter username and room");
        return;
    }

    // Join room on server
    socket.emit("join-room", roomId);

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;

    addMessage(`You joined room: ${roomId}`);
}

// ======= ENCRYPTION (client-side) =======
function simpleEncrypt(text) { return btoa(text); }
function simpleDecrypt(text) { return atob(text); }

// ======= CHAT =======
function sendMessage() {
    let msg = document.getElementById("messageInput").value.trim();
    if (!msg) return;

    let encrypted = simpleEncrypt(msg);
    addMessage(`You: ${msg}`);

    socket.emit("private-message", { roomId, message: encrypted, username });
    document.getElementById("messageInput").value = "";
}

// Listen for messages from other users in the same room
socket.on("private-message", data => {
    addMessage(`${data.username}: ${simpleDecrypt(data.message)}`);
});

function addMessage(text) {
    let msgBox = document.getElementById("messages");
    let time = new Date().toLocaleTimeString();
    msgBox.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ======= VIDEO CALL =======
async function startCall() {
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = event => { remoteVideo.srcObject = event.streams[0]; };
    pc.onicecandidate = event => {
        if (event.candidate) socket.emit("candidate", { roomId, candidate: event.candidate });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { roomId, offer });
}

socket.on("offer", async offer => {
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = event => { remoteVideo.srcObject = event.streams[0]; };
    pc.onicecandidate = event => {
        if (event.candidate) socket.emit("candidate", { roomId, candidate: event.candidate });
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { roomId, answer });
});

socket.on("answer", async answer => { await pc.setRemoteDescription(answer); });
socket.on("candidate", async candidate => { await pc.addIceCandidate(new RTCIceCandidate(candidate)); });

function endCall() {
    if (pc) { pc.close(); pc = null; alert("Call ended"); }
}
