let roomCode = "";
let participantId = null;
let clientName = "";
let socket = null;

let questions = [];
let currentQuestionIndex = 0;
let clientAnswers = {}; // { question_id: 'A' }

// DOM Elements
const joinView = document.getElementById("join-view");
const waitingView = document.getElementById("waiting-view");
const quizView = document.getElementById("quiz-view");
const submittedView = document.getElementById("submitted-view");
const resultsView = document.getElementById("results-view");

const joinForm = document.getElementById("join-form");
const roomCodeInput = document.getElementById("room-code-input");
const participantNameInput = document.getElementById("participant-name-input");
const joinBtn = document.getElementById("join-btn");

const waitingRoomTitle = document.getElementById("waiting-room-title");
const waitingClientName = document.getElementById("waiting-client-name");

const quizProgressText = document.getElementById("quiz-progress-text");
const quizTimer = document.getElementById("quiz-timer");
const questionTextDisplay = document.getElementById("question-text-display");
const optionButtons = document.querySelectorAll(".quiz-option-btn");

const optTextA = document.getElementById("opt-text-a");
const optTextB = document.getElementById("opt-text-b");
const optTextC = document.getElementById("opt-text-c");
const optTextD = document.getElementById("opt-text-d");

const resultScore = document.getElementById("result-score");
const clientLeaderboardList = document.getElementById("client-leaderboard-list");
const answersReviewList = document.getElementById("answers-review-list");

// Pre-fill Room Code from URL query param
const urlParams = new URLSearchParams(window.location.search);
const codeParam = urlParams.get("code");
if (codeParam) {
    roomCodeInput.value = codeParam.toUpperCase();
}

// Join Room Action
joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    roomCode = roomCodeInput.value.trim().toUpperCase();
    clientName = participantNameInput.value.trim();
    
    joinBtn.disabled = true;
    joinBtn.innerText = "Bergabung...";
    
    try {
        const response = await fetch("/api/rooms/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ room_code: roomCode, name: clientName })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Gagal bergabung ke kuis");
        }
        
        const data = await response.json();
        participantId = data.participant_id;
        
        // Fetch room title
        const roomResp = await fetch(`/api/rooms/${roomCode}`);
        const roomData = await roomResp.json();
        
        setupWaitingLobby(roomData.title);
    } catch (err) {
        alert("Error: " + err.message);
        joinBtn.disabled = false;
        joinBtn.innerText = "Gabung Room";
    }
});

function setupWaitingLobby(title) {
    joinView.classList.add("hidden");
    waitingView.classList.remove("hidden");
    
    waitingRoomTitle.innerText = title;
    waitingClientName.innerText = clientName;
    
    connectWebSocket(roomCode);
}

// Websocket logic
function connectWebSocket(code) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/ws/client/${code}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log("WebSocket Client connected to room: " + code);
        // Register client details
        socket.send(JSON.stringify({
            type: "REGISTER",
            participant_id: participantId,
            name: clientName
        }));
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received data from WS:", data);
        
        switch (data.type) {
            case "QUIZ_STARTED":
                startQuiz(data.questions, data.duration);
                break;
            case "TIMER_TICK":
                quizTimer.innerText = data.remaining_time;
                break;
            case "QUIZ_FINISHED":
                showQuizResults(data.leaderboard, data.questions);
                break;
            case "QUIZ_RESET":
                resetClientToLobby();
                break;
            case "ERROR":
                alert("Error: " + data.message);
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

function startQuiz(quizQuestions, duration) {
    questions = quizQuestions;
    currentQuestionIndex = 0;
    clientAnswers = {};
    
    waitingView.classList.add("hidden");
    submittedView.classList.add("hidden");
    resultsView.classList.add("hidden");
    quizView.classList.remove("hidden");
    
    quizTimer.innerText = duration;
    
    showQuestion(currentQuestionIndex);
}

function showQuestion(index) {
    if (index >= questions.length) {
        // Finished all questions
        quizView.classList.add("hidden");
        submittedView.classList.remove("hidden");
        return;
    }
    
    const q = questions[index];
    quizProgressText.innerText = `${index + 1}/${questions.length}`;
    questionTextDisplay.innerText = q.question_text;
    
    optTextA.innerText = q.option_a;
    optTextB.innerText = q.option_b;
    optTextC.innerText = q.option_c;
    optTextD.innerText = q.option_d;
    
    // Clear choice selections
    optionButtons.forEach(btn => {
        btn.classList.remove("selected");
        btn.disabled = false;
    });
}

// Option selection action
optionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const selectedOpt = btn.getAttribute("data-option");
        const q = questions[currentQuestionIndex];
        
        // Highlight selection
        optionButtons.forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        
        // Disable further clicks
        optionButtons.forEach(b => b.disabled = true);
        
        // Save locally
        clientAnswers[q.id] = selectedOpt;
        
        // Send answer to server via WS
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "SUBMIT_ANSWER",
                participant_id: participantId,
                question_id: q.id,
                answer: selectedOpt
            }));
        }
        
        // Slide to next question after delay
        setTimeout(() => {
            currentQuestionIndex++;
            showQuestion(currentQuestionIndex);
        }, 300);
    });
});

function showQuizResults(leaderboard, fullQuestions) {
    quizView.classList.add("hidden");
    submittedView.classList.add("hidden");
    resultsView.classList.remove("hidden");
    
    // Find personal score
    const me = leaderboard.find(p => p.id === participantId);
    if (me) {
        resultScore.innerText = me.score;
    } else {
        resultScore.innerText = "0";
    }
    
    // Render leaderboard
    clientLeaderboardList.innerHTML = "";
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
            <div class="leaderboard-name">${p.name} ${p.id === participantId ? ' (Anda)' : ''}</div>
            <div class="leaderboard-score">${p.score} Pts</div>
        `;
        clientLeaderboardList.appendChild(row);
    });
    
    // Render answer reviews
    answersReviewList.innerHTML = "";
    fullQuestions.forEach((q, idx) => {
        const myAns = clientAnswers[q.id] || "TIDAK MENJAWAB";
        const correctAns = q.correct_answer;
        const isCorrect = myAns === correctAns;
        
        // Determine option text for correct and my answers
        let myAnsText = myAns;
        if (myAns === "A") myAnsText = `A. ${q.option_a}`;
        else if (myAns === "B") myAnsText = `B. ${q.option_b}`;
        else if (myAns === "C") myAnsText = `C. ${q.option_c}`;
        else if (myAns === "D") myAnsText = `D. ${q.option_d}`;
        
        let correctAnsText = correctAns;
        if (correctAns === "A") correctAnsText = `A. ${q.option_a}`;
        else if (correctAns === "B") correctAnsText = `B. ${q.option_b}`;
        else if (correctAns === "C") correctAnsText = `C. ${q.option_c}`;
        else if (correctAns === "D") correctAnsText = `D. ${q.option_d}`;
        
        const reviewItem = document.createElement("div");
        reviewItem.style.background = "rgba(0,0,0,0.2)";
        reviewItem.style.border = `1px solid ${isCorrect ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`;
        reviewItem.style.borderRadius = "12px";
        reviewItem.style.padding = "1rem";
        
        reviewItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600; margin-bottom: 0.5rem;">
                <span>Soal ${idx + 1}: ${q.question_text}</span>
                <span style="margin-left: auto; font-size: 0.85rem; padding: 0.25rem 0.5rem; border-radius: 6px; background: ${isCorrect ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}; color: ${isCorrect ? 'var(--color-d)' : 'var(--color-a)'};">
                    ${isCorrect ? '✓ Benar' : '✗ Salah'}
                </span>
            </div>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">
                <div>Jawaban Anda: <span style="font-weight: 600; color: ${isCorrect ? 'var(--color-d)' : 'var(--color-a)'};">${myAnsText}</span></div>
                ${!isCorrect ? `<div>Jawaban Benar: <span style="font-weight: 600; color: var(--color-d);">${correctAnsText}</span></div>` : ''}
            </div>
        `;
        answersReviewList.appendChild(reviewItem);
    });
}

function resetClientToLobby() {
    // Return back to waiting lobby view
    resultsView.classList.add("hidden");
    quizView.classList.add("hidden");
    submittedView.classList.add("hidden");
    joinView.classList.add("hidden");
    waitingView.classList.remove("hidden");
    
    questions = [];
    currentQuestionIndex = 0;
    clientAnswers = {};
}
