import asyncio
import json
import logging
from typing import Dict, List, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import database

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Host vs Client Quiz App")

# Initialize database
database.init_db()

# Models for API
class QuestionInput(BaseModel):
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str

class RoomCreateInput(BaseModel):
    title: str
    duration: int # total duration in seconds
    questions: List[QuestionInput]

class ParticipantJoinInput(BaseModel):
    room_code: str
    name: str

# In-memory store for active WebSocket connections and timers
# {
#   "ROOM_CODE": {
#       "host": WebSocket,
#       "clients": {
#           participant_id: {
#               "name": str,
#               "ws": WebSocket
#           }
#       },
#       "timer_task": asyncio.Task,
#       "remaining_time": int
#   }
# }
active_rooms: Dict[str, Dict[str, Any]] = {}

def get_room_state(room_code: str) -> dict:
    if room_code not in active_rooms:
        active_rooms[room_code] = {
            "host": None,
            "clients": {},
            "timer_task": None,
            "remaining_time": 0
        }
    return active_rooms[room_code]

# REST API endpoints
@app.post("/api/rooms")
def api_create_room(data: RoomCreateInput):
    try:
        # Convert Pydantic models to dicts
        questions_dict = [q.model_dump() for q in data.questions]
        room_code = database.create_room(data.title, data.duration, questions_dict)
        return {"room_code": room_code, "title": data.title}
    except Exception as e:
        logger.error(f"Error creating room: {e}")
        raise HTTPException(status_code=500, detail="Failed to create quiz room")

@app.get("/api/rooms/{room_code}")
def api_get_room(room_code: str):
    room = database.get_room(room_code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room

@app.post("/api/rooms/join")
def api_join_room(data: ParticipantJoinInput):
    participant_id, error = database.add_participant(data.room_code, data.name)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return {"participant_id": participant_id, "name": data.name, "room_code": data.room_code}

# Timer background task
async def run_quiz_timer(room_code: str):
    try:
        state = get_room_state(room_code)
        room = database.get_room(room_code)
        if not room:
            return
        
        state["remaining_time"] = room["duration"]
        database.update_room_status(room_code, "RUNNING")
        
        # Broadcast timer and start state to host and all clients
        questions = database.get_questions(room_code)
        start_payload = {
            "type": "QUIZ_STARTED",
            "duration": state["remaining_time"],
            "questions": questions
        }
        
        # Notify clients
        for pid, client_info in list(state["clients"].items()):
            try:
                await client_info["ws"].send_text(json.dumps(start_payload))
            except Exception:
                pass
                
        # Notify host
        if state["host"]:
            await state["host"].send_text(json.dumps({
                "type": "QUIZ_STARTED",
                "duration": state["remaining_time"]
            }))
            
        while state["remaining_time"] > 0:
            await asyncio.sleep(1)
            state["remaining_time"] -= 1
            
            # Broadcast timer update
            timer_payload = {
                "type": "TIMER_TICK",
                "remaining_time": state["remaining_time"]
            }
            
            # Notify clients
            for pid, client_info in list(state["clients"].items()):
                try:
                    await client_info["ws"].send_text(json.dumps(timer_payload))
                except Exception:
                    pass
            
            # Notify host with timer and real-time monitoring stats
            if state["host"]:
                progress = database.get_participant_progress(room_code)
                try:
                    await state["host"].send_text(json.dumps({
                        "type": "TIMER_TICK",
                        "remaining_time": state["remaining_time"],
                        "progress": progress
                    }))
                except Exception:
                    pass
                    
            # Check if all participants have answered all questions
            if state["remaining_time"] > 0:
                progress = database.get_participant_progress(room_code)
                total_q = progress["total_questions"]
                all_finished = True
                if not progress["participants"]:
                    all_finished = False
                for p in progress["participants"]:
                    if p["answered_count"] < total_q:
                        all_finished = False
                        break
                if all_finished:
                    logger.info(f"All participants finished early for room {room_code}")
                    break
        
        # Quiz completed!
        database.update_room_status(room_code, "FINISHED")
        final_progress = database.get_participant_progress(room_code)
        questions_with_answers = database.get_questions_with_answers(room_code)
        
        finish_payload = {
            "type": "QUIZ_FINISHED",
            "leaderboard": final_progress["participants"],
            "questions": questions_with_answers
        }
        
        # Send to host
        if state["host"]:
            try:
                await state["host"].send_text(json.dumps(finish_payload))
            except Exception:
                pass
                
        # Send to clients
        for pid, client_info in list(state["clients"].items()):
            try:
                # Include client's own score detail if needed
                await client_info["ws"].send_text(json.dumps(finish_payload))
            except Exception:
                pass
                
    except asyncio.CancelledError:
        logger.info(f"Timer task cancelled for room {room_code}")
    except Exception as e:
        logger.error(f"Error in timer task: {e}")

# Broadcast update of participant list to Host
async def broadcast_participant_list(room_code: str):
    state = get_room_state(room_code)
    if state["host"]:
        participants = database.get_participants(room_code)
        try:
            await state["host"].send_text(json.dumps({
                "type": "PARTICIPANT_LIST",
                "participants": participants
            }))
        except Exception as e:
            logger.error(f"Error sending participant list to host: {e}")

# WebSockets endpoint
@app.websocket("/ws/{role}/{room_code}")
async def websocket_endpoint(websocket: WebSocket, role: str, room_code: str):
    await websocket.accept()
    room_code = room_code.upper()
    state = get_room_state(room_code)
    
    # Store connection
    participant_id = None
    if role == "host":
        # Disconnect old host if exists
        if state["host"]:
            try:
                await state["host"].close()
            except Exception:
                pass
        state["host"] = websocket
        logger.info(f"Host connected to room {room_code}")
        # Send current participant list immediately
        await broadcast_participant_list(room_code)
    else:
        # Client needs to authenticate/identify via query parameters or first message
        pass
        
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            msg_type = data.get("type")
            
            if role == "client" and msg_type == "REGISTER":
                participant_id = data.get("participant_id")
                name = data.get("name")
                state["clients"][participant_id] = {
                    "name": name,
                    "ws": websocket
                }
                logger.info(f"Client {name} ({participant_id}) registered in WS for room {room_code}")
                # Notify Host that a client joined
                await broadcast_participant_list(room_code)
                
            elif role == "host" and msg_type == "START_QUIZ":
                # Start countdown timer in background task
                if state["timer_task"] and not state["timer_task"].done():
                    state["timer_task"].cancel()
                state["timer_task"] = asyncio.create_task(run_quiz_timer(room_code))
                logger.info(f"Quiz started by host in room {room_code}")
                
            elif role == "client" and msg_type == "SUBMIT_ANSWER":
                p_id = data.get("participant_id")
                q_id = data.get("question_id")
                answer = data.get("answer")
                
                success, error = database.submit_answer(p_id, q_id, answer)
                if success:
                    # Notify host of answer submission to update progress live
                    if state["host"]:
                        progress = database.get_participant_progress(room_code)
                        await state["host"].send_text(json.dumps({
                            "type": "PROGRESS_UPDATE",
                            "progress": progress
                        }))
                else:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "message": error or "Failed to submit answer"
                    }))
                    
            elif role == "host" and msg_type == "RESTART_QUIZ":
                # Cancel timer task
                if state["timer_task"] and not state["timer_task"].done():
                    state["timer_task"].cancel()
                
                # Reset DB
                database.reset_room(room_code)
                
                # Notify clients to reset to lobby
                reset_payload = {"type": "QUIZ_RESET"}
                for pid, client_info in list(state["clients"].items()):
                    try:
                        await client_info["ws"].send_text(json.dumps(reset_payload))
                    except Exception:
                        pass
                
                # Clear active room client data (since participants were deleted from DB)
                state["clients"] = {}
                state["remaining_time"] = 0
                logger.info(f"Quiz reset by host in room {room_code}")
                
                # Confirm to host
                await websocket.send_text(json.dumps({"type": "QUIZ_RESET_CONFIRMED"}))
                await broadcast_participant_list(room_code)
                
    except WebSocketDisconnect:
        logger.info(f"{role.capitalize()} disconnected from room {room_code}")
        if role == "host":
            state["host"] = None
        else:
            if participant_id in state["clients"]:
                del state["clients"][participant_id]
                # Notify host that client disconnected
                await broadcast_participant_list(room_code)
    except Exception as e:
        logger.error(f"Error in websocket loop: {e}")
        
# Serve frontend files
# Root path redirects or serves index.html
@app.get("/")
def read_root():
    return FileResponse("static/index.html")

# Serve static directory
app.mount("/static", StaticFiles(directory="static"), name="static")
