Tujuan Web Kuis

Web ini dibuat untuk menyelenggarakan kuis setelah sesi implementasi atau pelatihan selesai. Tujuannya adalah membantu implementator mengukur sejauh mana peserta memahami materi, konsep, dan tujuan yang telah disampaikan selama sesi berlangsung.

# Plan: Real-Time Host vs Client Quiz Application

We will build a real-time quiz platform where a **Host** can create a room, add questions, set a duration, and display a QR code/join link. **Clients** can join the room, enter their names, wait in the lobby, and answer the questions when the Host starts the quiz. The progress and scores are synchronized in real-time using WebSockets.

---

## Technical Stack
- **Backend & Server**: FastAPI (Python 3.12) with standard websockets.
- **Database**: SQLite (built-in, storing rooms, questions, participants, and answers).
- **Frontend**: Vanilla HTML5, modern CSS (glassmorphism design, dark mode, violet/indigo gradient accents, Google Fonts 'Outfit' and 'Plus Jakarta Sans'), and Vanilla Javascript using standard WebSockets.
- **QR Code**: Standard frontend-based QR code generation using `qrcode.js` (loaded via CDN) to display the room join link.

---

## User Review Required

> [!NOTE]
> The app will run entirely locally on Python 3.12. We will use a FastAPI server running on port `8000` (or another port of choice). Since Python is already installed, this setup will not require node/npm setup.

> [!IMPORTANT]
> The quiz will be self-paced with a global duration (e.g., 2 minutes for the whole quiz). Clients answer questions at their own speed. The Host monitors each client's progress (e.g., "2/5 answered") and scores in real-time. When the time is up or all clients finish, the final ranking is shown.

---

## Proposed Changes

We will create a structured backend and static frontend inside `d:\PowerPro\Tools\Web\Question`.

```
d:\PowerPro\Tools\Web\Question/
├── app.py                # FastAPI backend + WebSocket server + SQLite database logic
├── database.py           # Database models and queries
├── static/               # Static web assets
│   ├── index.html        # Landing page (Role selection: Host or Client)
│   ├── host.html         # Host Dashboard (Create quiz, Lobby, Monitor, Leaderboard)
│   ├── client.html       # Client interface (Join room, Lobby, Question sheet, Results)
│   ├── css/
│   │   └── style.css     # Premium styling (Glassmorphism, dark mode, animations)
│   └── js/
│       ├── host.js       # Host UI logic & WebSocket connection
│       └── client.js     # Client UI logic & WebSocket connection
```

### 1. Database Schema (`database.py`)
We will use standard SQLite to store the state of rooms, questions, participants, and answers:
- `rooms`: `id` (room code, e.g. 4-letter code), `title`, `duration`, `status` (`WAITING`, `RUNNING`, `FINISHED`)
- `questions`: `id`, `room_id`, `question_text`, `option_a`, `option_b`, `option_c`, `option_d`, `correct_answer`
- `participants`: `id`, `room_id`, `name`, `score`, `joined_at`
- `answers`: `id`, `participant_id`, `question_id`, `selected_option`, `is_correct`

### 2. Backend Server (`app.py`)
- Serve static files from `/static`.
- API endpoints:
  - `POST /api/rooms` - Create a room and questions.
  - `GET /api/rooms/{code}` - Get room details.
- WebSocket endpoint `/ws/{role}/{code}`:
  - Host websocket: listens for start events, status updates, and broadcasts progress updates to clients.
  - Client websocket: notifies the host when they join, when they submit an answer, and when they finish.
  - Periodic task on server: countdown timer broadcast when room is `RUNNING`.

### 3. Frontend & Styles
- Dark mode theme using vibrant violet (`#6366f1`), indigo (`#4f46e5`), and magenta gradients.
- Floating glass card components with `backdrop-filter: blur(12px)`.
- QR Code auto-generation using the `qrcode` JavaScript library.
- Smooth animations for cards, leaderboard changes, and timers.

---

## Verification Plan

### Automated / Local Testing
- Launch the application: `python -m uvicorn app:app --reload`
- Open multiple browser tabs:
  - Tab 1: Host dashboard to create a room.
  - Tab 2 & 3: Client tabs to join the room.
- Verify real-time participation in lobby.
- Start the quiz, submit answers, check timer synchronization.
- Verify final scoreboard rendering.
