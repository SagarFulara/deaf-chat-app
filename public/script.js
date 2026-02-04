const socket = io("http://localhost:3000");

let username = "";
let pc;
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

function login() {
    username = document.getElementById("username").value;

    if (!username) {
        alert("Enter name");
        return;
    }

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;
}

// ======= BASIC ENCRYPTION =======
function simpleEncrypt(text) {
    return btoa(text);
}

function simpleDecrypt(text) {
    return atob(text);
}

// ======= CHAT =======
function sendMessage() {
    let msg = document.getElementById("messageInput").value;
    if (!msg) return;

    let encryptedMsg = simpleEncrypt(msg);
    addMessage(`You: ${msg}`);
    socket.emit("chat-message", { user: username, message: encryptedMsg });

    document.getElementById("messageInput").value = "";
}

socket.on("chat-message", (data) => {
    let decryptedMsg = simpleDecrypt(data.message);
    addMessage(`${data.user}: ${decryptedMsg}`);
});

function addMessage(text) {
    let msgBox = document.getElementById("messages");
    let time = new Date().toLocaleTimeString();
    msgBox.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ======= WEBRTC VIDEO CALL =======
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
            socket.emit("candidate", event.candidate);
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", offer);
}

socket.on("offer", async (offer) => {
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
            socket.emit("candidate", event.candidate);
        }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", answer);
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
        alert("Call ended");
    }
}
