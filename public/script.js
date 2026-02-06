const socket = io();
let username = "";
let room = "";
let pc;
let gestureInterval = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const fileStatus = document.getElementById("fileStatus");

function login() {
    username = document.getElementById("username").value;
    room = document.getElementById("roomId").value;

    if (!username || !room) {
        alert("Enter name and room");
        return;
    }

    socket.emit("set-username", username);
    socket.emit("join-room", room);

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("chatBox").style.display = "block";
    document.getElementById("userLabel").innerText = username;
    document.getElementById("roomLabel").innerText = room;
}

// ===== CHAT =====
function simpleEncrypt(text) {
    return btoa(text);
}

function simpleDecrypt(text) {
    return atob(text);
}

function sendMessage() {
    let msg = document.getElementById("messageInput").value;
    if (!msg) return;

    let encryptedMsg = simpleEncrypt(msg);
    addMessage(`You: ${msg}`);

    socket.emit("chat-message", {
        user: username,
        roomId: room,
        message: encryptedMsg
    });

    document.getElementById("messageInput").value = "";
}

socket.on("chat-message", (data) => {
    if (data.roomId !== room) return;
    let decryptedMsg = simpleDecrypt(data.message);
    addMessage(`${data.user}: ${decryptedMsg}`);
});

function addMessage(text) {
    let msgBox = document.getElementById("messages");
    let time = new Date().toLocaleTimeString();
    msgBox.innerHTML += `<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ===== VIDEO CALL =====
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

socket.on("candidate", async (candidate) => {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

function endCall() {
    if (pc) {
        pc.close();
        pc = null;
        localVideo.srcObject = null;
        remoteVideo.srcObject = null;
        alert("Call ended");
    }
}

// ===== HAND GESTURE (BUTTON CONTROLLED) =====
function detectGesture() {
    const gestures = ["Hello", "How are you?", "Yes", "No", "Thanks", "Please", "Good", "Okay"];
    const randomGesture = gestures[Math.floor(Math.random() * gestures.length)];

    document.getElementById("myGesture").innerText = "Your Gesture: " + randomGesture;

    socket.emit("gesture", {
        roomId: room,
        gesture: randomGesture
    });
}

function startGesture() {
    if (gestureInterval) return;
    detectGesture();
    gestureInterval = setInterval(detectGesture, 3000);
}

function stopGesture() {
    clearInterval(gestureInterval);
    gestureInterval = null;
    document.getElementById("myGesture").innerText = "Your Gesture: -";
}

socket.on("gesture", (data) => {
    if (data.senderId !== socket.id) {
        document.getElementById("remoteGesture").innerText =
            data.username + " Gesture: " + data.gesture;
    }
});

// ===== FILE TRANSFER (100% FIXED) =====
function sendFile() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];

    if (!file) {
        alert("Select a file first");
        return;
    }

    fileStatus.innerText = "Sending: " + file.name;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = function () {
        const base64Data = btoa(
            new Uint8Array(reader.result)
                .reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        socket.emit("file", {
            roomId: room,
            fileName: file.name,
            fileType: file.type,
            fileData: base64Data
        });

        fileStatus.innerText = "Sent: " + file.name;
    };
}

socket.on("file", (data) => {
    if (data.roomId !== room) return;

    const binary = atob(data.fileData);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: data.fileType });
    const url = URL.createObjectURL(blob);

    addMessage(`📁 ${data.sender} sent: ${data.fileName}`);

    const link = document.createElement("a");
    link.href = url;
    link.download = data.fileName;
    link.innerText = "Download " + data.fileName;
    document.getElementById("messages").appendChild(link);
});
