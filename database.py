import sqlite3
import random
import string
from datetime import datetime

DATABASE_FILE = "quiz.db"

def get_db_connection():
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        duration INTEGER NOT NULL, -- duration in seconds for the entire quiz
        status TEXT NOT NULL DEFAULT 'WAITING' -- WAITING, RUNNING, FINISHED
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_answer TEXT NOT NULL, -- 'A', 'B', 'C', or 'D'
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        score INTEGER DEFAULT 0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        UNIQUE(room_id, name)
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        answer TEXT NOT NULL,
        is_correct INTEGER NOT NULL, -- 0 or 1
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        UNIQUE(participant_id, question_id)
    )
    """)
    
    conn.commit()
    conn.close()

def generate_room_code():
    conn = get_db_connection()
    cursor = conn.cursor()
    while True:
        code = "".join(random.choices(string.ascii_uppercase, k=4))
        # Check uniqueness
        cursor.execute("SELECT id FROM rooms WHERE id = ?", (code,))
        if cursor.fetchone() is None:
            conn.close()
            return code

def create_room(title: str, duration: int, questions: list):
    """
    questions is a list of dicts:
    [
      {
        "question_text": "...",
        "option_a": "...",
        "option_b": "...",
        "option_c": "...",
        "option_d": "...",
        "correct_answer": "A"
      },
      ...
    ]
    """
    code = generate_room_code()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO rooms (id, title, duration, status) VALUES (?, ?, ?, 'WAITING')",
            (code, title, duration)
        )
        
        for q in questions:
            cursor.execute(
                """
                INSERT INTO questions (room_id, question_text, option_a, option_b, option_c, option_d, correct_answer)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    code,
                    q["question_text"],
                    q["option_a"],
                    q["option_b"],
                    q["option_c"],
                    q["option_d"],
                    q["correct_answer"].upper()
                )
            )
        conn.commit()
        return code
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_room(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM rooms WHERE id = ?", (room_id.upper(),))
    room = cursor.fetchone()
    conn.close()
    if room:
        return dict(room)
    return None

def get_questions(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE room_id = ?", (room_id.upper(),))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_questions_with_answers(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM questions WHERE room_id = ?", (room_id.upper(),))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_participant(room_id: str, name: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check if room is waiting
        cursor.execute("SELECT status FROM rooms WHERE id = ?", (room_id.upper(),))
        room = cursor.fetchone()
        if not room:
            return None, "Room not found"
        if room["status"] != "WAITING":
            return None, "Quiz already started or finished"
            
        cursor.execute(
            "INSERT INTO participants (room_id, name) VALUES (?, ?)",
            (room_id.upper(), name)
        )
        participant_id = cursor.lastrowid
        conn.commit()
        return participant_id, None
    except sqlite3.IntegrityError:
        return None, "Name already taken in this room"
    finally:
        conn.close()

def get_participants(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM participants WHERE room_id = ? ORDER BY score DESC, joined_at ASC", (room_id.upper(),))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def submit_answer(participant_id: int, question_id: int, answer: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check correct answer
        cursor.execute("SELECT correct_answer, room_id FROM questions WHERE id = ?", (question_id,))
        q = cursor.fetchone()
        if not q:
            return False, "Question not found"
            
        correct_answer = q["correct_answer"]
        room_id = q["room_id"]
        
        # Check room status
        cursor.execute("SELECT status FROM rooms WHERE id = ?", (room_id,))
        r = cursor.fetchone()
        if not r or r["status"] != "RUNNING":
            return False, "Room is not active"
            
        is_correct = 1 if answer.upper() == correct_answer.upper() else 0
        
        cursor.execute(
            "INSERT INTO answers (participant_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)",
            (participant_id, question_id, answer.upper(), is_correct)
        )
        
        # Recalculate score (10 points per correct answer)
        if is_correct:
            cursor.execute("UPDATE participants SET score = score + 10 WHERE id = ?", (participant_id,))
            
        conn.commit()
        return True, None
    except sqlite3.IntegrityError:
        return False, "Answer already submitted"
    finally:
        conn.close()

def update_room_status(room_id: str, status: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE rooms SET status = ? WHERE id = ?", (status.upper(), room_id.upper()))
    conn.commit()
    conn.close()

def get_participant_progress(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Number of questions in room
    cursor.execute("SELECT COUNT(*) FROM questions WHERE room_id = ?", (room_id.upper(),))
    total_q = cursor.fetchone()[0]
    
    # Progress for each participant
    cursor.execute("""
        SELECT p.id, p.name, p.score, COUNT(a.id) as answered_count
        FROM participants p
        LEFT JOIN answers a ON p.id = a.participant_id
        WHERE p.room_id = ?
        GROUP BY p.id
        ORDER BY p.score DESC, p.joined_at ASC
    """, (room_id.upper(),))
    rows = cursor.fetchall()
    conn.close()
    
    return {
        "total_questions": total_q,
        "participants": [dict(r) for r in rows]
    }

def reset_room(room_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Reset room status to WAITING
        cursor.execute("UPDATE rooms SET status = 'WAITING' WHERE id = ?", (room_id.upper(),))
        # Remove all participants (which cascades to answers)
        cursor.execute("DELETE FROM participants WHERE room_id = ?", (room_id.upper(),))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()
