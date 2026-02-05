const socket = io("https://deaf-chat-app.onrender.com");

let username = "";
let roomId = "";
let pc;
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// ===== LOGIN =====
function login() {
    username = document.getElementById("username").value.trim();
    roomId = document.getElementById("room").value.trim();
    if(!username || !roomId){ alert("Enter username and room"); return; }

    socket.emit("join-room",{roomId, username});
    document.getElementById("loginBox").style.display="none";
    document.getElementById("chatBox").style.display="block";
    document.getElementById("userLabel").innerText=username;
    addMessage(`You joined room: ${roomId}`);
}

// ===== ENCRYPTION =====
function simpleEncrypt(text){ return btoa(text); }
function simpleDecrypt(text){ return atob(text); }

// ===== CHAT =====
function sendMessage(){
    let msg=document.getElementById("messageInput").value.trim();
    if(!msg) return;
    addMessage(`You: ${msg}`);
    socket.emit("private-message",{roomId, message:simpleEncrypt(msg)});
    document.getElementById("messageInput").value="";
}

socket.on("private-message",data=>{
    addMessage(`${data.username}: ${simpleDecrypt(data.message)}`);
});

// ===== FILE TRANSFER =====
function sendFile(){
    const fileInput=document.getElementById("fileInput");
    if(fileInput.files.length===0) return;

    const file=fileInput.files[0];
    const reader=new FileReader();
    reader.onload=()=>{
        socket.emit("file-transfer",{roomId, fileName:file.name, fileData:reader.result});
    }
    reader.readAsDataURL(file);
    fileInput.value="";
}

socket.on("file-transfer", data=>{
    const link=document.createElement("a");
    link.href=data.fileData;
    link.download=data.fileName;
    link.innerText=`${data.username} sent: ${data.fileName}`;
    link.style.display="block";
    document.getElementById("messages").appendChild(link);
    document.getElementById("messages").scrollTop=document.getElementById("messages").scrollHeight;
});

// ===== UTILS =====
function addMessage(text){
    const msgBox=document.getElementById("messages");
    const time=new Date().toLocaleTimeString();
    msgBox.innerHTML+=`<p><b>[${time}]</b> ${text}</p>`;
    msgBox.scrollTop=msgBox.scrollHeight;
}

// ===== VIDEO CALL =====
async function startCall(){
    pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    localVideo.srcObject=stream;
    stream.getTracks().forEach(track=>pc.addTrack(track,stream));

    pc.ontrack=e=>{remoteVideo.srcObject=e.streams[0];};
    pc.onicecandidate=e=>{ if(e.candidate) socket.emit('candidate',{roomId,candidate:e.candidate}); };

    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer',{roomId,offer});
}

socket.on('offer', async offer=>{
    pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    localVideo.srcObject=stream;
    stream.getTracks().forEach(track=>pc.addTrack(track,stream));

    pc.ontrack=e=>{remoteVideo.srcObject=e.streams[0];};
    pc.onicecandidate=e=>{ if(e.candidate) socket.emit('candidate',{roomId,candidate:e.candidate}); };

    await pc.setRemoteDescription(offer);
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer',{roomId,answer});
});

socket.on('answer',async answer=>{ await pc.setRemoteDescription(answer); });
socket.on('candidate',async candidate=>{ if(pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); });
function endCall(){ if(pc){ pc.close(); pc=null; alert("Call ended"); } }
