let roomCode = "";
let socket = null;
let questionCount = 0;

// DOM Elements
const createView = document.getElementById("create-view");
const lobbyView = document.getElementById("lobby-view");
const monitorView = document.getElementById("monitor-view");
const leaderboardView = document.getElementById("leaderboard-view");

const questionsContainer = document.getElementById("questions-container");
const addQuestionBtn = document.getElementById("add-question-btn");
const createQuizForm = document.getElementById("create-quiz-form");
const submitQuizBtn = document.getElementById("submit-quiz-btn");

const lobbyRoomCode = document.getElementById("lobby-room-code");
const lobbyQuizTitle = document.getElementById("lobby-quiz-title");
const lobbyJoinUrl = document.getElementById("lobby-join-url");
const qrcodeContainer = document.getElementById("qrcode");
const participantsList = document.getElementById("participants-list");
const participantCount = document.getElementById("participant-count");
const startQuizBtn = document.getElementById("start-quiz-btn");

const monitorQuizTitle = document.getElementById("monitor-quiz-title");
const monitorTimer = document.getElementById("monitor-timer");
const monitorProgressList = document.getElementById("monitor-progress-list");

const leaderboardList = document.getElementById("leaderboard-list");
const restartQuizBtn = document.getElementById("restart-quiz-btn");

// Init Question Creator
function addQuestionBlock() {
    questionCount++;
    const questionHtml = `
        <div class="question-item-form" id="q-block-${questionCount}">
            <button type="button" class="remove-q-btn" onclick="removeQuestionBlock(${questionCount})">&times;</button>
            <div class="form-group">
                <label>Pertanyaan #${questionCount}</label>
                <input type="text" class="form-control q-text" placeholder="Masukkan pertanyaan..." required>
            </div>
            <div class="question-grid">
                <div class="form-group option-input-wrapper">
                    <span class="option-badge a">A</span>
                    <input type="text" class="form-control q-opt-a" placeholder="Pilihan A" required style="width: 100%;">
                </div>
                <div class="form-group option-input-wrapper">
                    <span class="option-badge b">B</span>
                    <input type="text" class="form-control q-opt-b" placeholder="Pilihan B" required style="width: 100%;">
                </div>
                <div class="form-group option-input-wrapper">
                    <span class="option-badge c">C</span>
                    <input type="text" class="form-control q-opt-c" placeholder="Pilihan C" required style="width: 100%;">
                </div>
                <div class="form-group option-input-wrapper">
                    <span class="option-badge d">D</span>
                    <input type="text" class="form-control q-opt-d" placeholder="Pilihan D" required style="width: 100%;">
                </div>
            </div>
            <div class="form-group" style="margin-top: 1rem; max-width: 200px;">
                <label>Jawaban Benar</label>
                <select class="form-control q-correct" required>
                    <option value="A">Pilihan A</option>
                    <option value="B">Pilihan B</option>
                    <option value="C">Pilihan C</option>
                    <option value="D">Pilihan D</option>
                </select>
            </div>
        </div>
    `;
    questionsContainer.insertAdjacentHTML("beforeend", questionHtml);
}

function removeQuestionBlock(id) {
    const block = document.getElementById(`q-block-${id}`);
    if (block) {
        block.remove();
    }
}

// Add starting question
addQuestionBlock();

addQuestionBtn.addEventListener("click", addQuestionBlock);

// Submit Form to Create Quiz
createQuizForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const title = document.getElementById("quiz-title").value.trim();
    const duration = parseInt(document.getElementById("quiz-duration").value);
    
    const blocks = document.querySelectorAll(".question-item-form");
    if (blocks.length === 0) {
        alert("Harap masukkan minimal 1 pertanyaan.");
        return;
    }
    
    const questions = [];
    blocks.forEach(block => {
        questions.push({
            question_text: block.querySelector(".q-text").value.trim(),
            option_a: block.querySelector(".q-opt-a").value.trim(),
            option_b: block.querySelector(".q-opt-b").value.trim(),
            option_c: block.querySelector(".q-opt-c").value.trim(),
            option_d: block.querySelector(".q-opt-d").value.trim(),
            correct_answer: block.querySelector(".q-correct").value
        });
    });
    
    const payload = { title, duration, questions };
    submitQuizBtn.disabled = true;
    submitQuizBtn.innerText = "Membuat Room...";
    
    try {
        const response = await fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Gagal membuat room");
        
        const data = await response.json();
        roomCode = data.room_code;
        
        setupLobby(title, roomCode);
    } catch (err) {
        alert("Error: " + err.message);
        submitQuizBtn.disabled = false;
        submitQuizBtn.innerText = "Buat Room Kuis";
    }
});

// Setup Lobby view after creation
function setupLobby(title, code) {
    createView.classList.add("hidden");
    lobbyView.classList.remove("hidden");
    
    lobbyQuizTitle.innerText = title;
    lobbyRoomCode.innerText = code;
    
    const joinUrl = `${window.location.origin}/static/client.html?code=${code}`;
    lobbyJoinUrl.innerHTML = `<a href="${joinUrl}" target="_blank" style="color: var(--primary); word-break: break-all;">${joinUrl}</a>`;
    
    // Clear and generate QR Code
    qrcodeContainer.innerHTML = "";
    new QRCode(qrcodeContainer, {
        text: joinUrl,
        width: 180,
        height: 180,
        colorDark : "#090714",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
    
    connectWebSocket(code);
}

// Websocket logic
function connectWebSocket(code) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/ws/host/${code}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log("WebSocket Host connected to room: " + code);
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received data from WS:", data);
        
        switch (data.type) {
            case "PARTICIPANT_LIST":
                updateParticipantList(data.participants);
                break;
            case "QUIZ_STARTED":
                showMonitorView(data.duration);
                break;
            case "TIMER_TICK":
                monitorTimer.innerText = data.remaining_time;
                if (data.progress) {
                    updateMonitorProgress(data.progress);
                }
                break;
            case "PROGRESS_UPDATE":
                updateMonitorProgress(data.progress);
                break;
            case "QUIZ_FINISHED":
                showLeaderboard(data.leaderboard);
                break;
            case "QUIZ_RESET_CONFIRMED":
                resetToLobby();
                break;
        }
    };
    
    socket.onclose = () => {
        console.log("WebSocket connection closed.");
    };
    
    socket.onerror = (error) => {
        console.error("WS error:", error);
    };
}

function updateParticipantList(participants) {
    participantsList.innerHTML = "";
    participantCount.innerText = participants.length;
    
    if (participants.length === 0) {
        participantsList.innerHTML = `<p style="color: var(--text-muted); font-style: italic; width: 100%; text-align: center; margin-top: 1rem;">Belum ada peserta yang join...</p>`;
        startQuizBtn.disabled = true;
    } else {
        startQuizBtn.disabled = false;
        participants.forEach(p => {
            const badge = document.createElement("div");
            badge.className = "participant-badge";
            badge.innerText = p.name;
            participantsList.appendChild(badge);
        });
    }
}

// Start Quiz Action
startQuizBtn.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "START_QUIZ" }));
    }
});

function showMonitorView(duration) {
    lobbyView.classList.add("hidden");
    monitorView.classList.remove("hidden");
    monitorTimer.innerText = duration;
}

function updateMonitorProgress(progress) {
    const totalQ = progress.total_questions;
    const participants = progress.participants;
    
    monitorProgressList.innerHTML = "";
    
    if (participants.length === 0) {
        monitorProgressList.innerHTML = `<p style="color: var(--text-muted); text-align: center;">Tidak ada peserta.</p>`;
        return;
    }
    
    participants.forEach(p => {
        const pct = totalQ > 0 ? Math.round((p.answered_count / totalQ) * 100) : 0;
        
        const item = document.createElement("div");
        item.className = "progress-item";
        item.innerHTML = `
            <div class="progress-info">
                <div class="progress-name">${p.name}</div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${pct}%"></div>
                </div>
            </div>
            <div style="text-align: right; min-width: 80px;">
                <div class="progress-number">${p.answered_count}/${totalQ} Soal</div>
                <div style="font-size: 0.85rem; color: var(--primary); font-weight: 600;">Skor: ${p.score}</div>
            </div>
        `;
        monitorProgressList.appendChild(item);
    });
}

function showLeaderboard(leaderboard) {
    monitorView.classList.add("hidden");
    leaderboardView.classList.remove("hidden");
    
    leaderboardList.innerHTML = "";
    
    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = `<p style="color: var(--text-muted); text-align: center;">Tidak ada peserta yang menyelesaikan kuis.</p>`;
        return;
    }
    
    leaderboard.forEach((p, idx) => {
        const rank = idx + 1;
        let podiumClass = "";
        if (rank === 1) podiumClass = "podium-1";
        else if (rank === 2) podiumClass = "podium-2";
        else if (rank === 3) podiumClass = "podium-3";
        
        const row = document.createElement("div");
        row.className = `leaderboard-row ${podiumClass}`;
        row.innerHTML = `
            <div class="leaderboard-rank">#${rank}</div>
            <div class="leaderboard-name">${p.name}</div>
            <div class="leaderboard-score">${p.score} Pts</div>
        `;
        leaderboardList.appendChild(row);
    });
}

// Restart Quiz Action
restartQuizBtn.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "RESTART_QUIZ" }));
    }
});

function resetToLobby() {
    leaderboardView.classList.add("hidden");
    lobbyView.classList.remove("hidden");
    participantsList.innerHTML = "";
    participantCount.innerText = "0";
    startQuizBtn.disabled = true;
}
