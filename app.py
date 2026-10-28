from pathlib import Path
import json
import re
import traceback
import uvicorn

from fastapi import FastAPI, Request, Header
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, EmailStr

from backend import run_travel_agent, stream_travel_agent
from feedback_service import (
    validate_feedback_with_gemini,
    save_feedback,
    get_all_feedbacks,
    verify_admin_login,
    update_admin_password,
    create_admin_session,
    is_valid_admin_session,
    invalidate_admin_session,
)

# this is to allow nested event loops for async calls in fast api
import nest_asyncio
nest_asyncio.apply()

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="TripMate AI",
    description="LangGraph Multi-Agent Travel Planner with FastAPI Frontend",
    version="1.0.0"
)


app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static"
)


templates = Jinja2Templates(
    directory=str(BASE_DIR / "templates")
)



class TravelRequest(BaseModel):
    message: str
    thread_id: str | None = None


class FeedbackRequest(BaseModel):
    email: str
    feedback: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str



@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.post("/api/travel/stream")
def travel_planner_stream(request_data: TravelRequest):
    user_message = request_data.message.strip()

    if not user_message:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "Message cannot be empty."
            }
        )

    def event_stream():
        try:
            for event in stream_travel_agent(user_message, request_data.thread_id):
                payload = json.dumps(event)
                yield f"data: {payload}\n\n"
        except Exception as e:
            traceback.print_exc()
            err_payload = json.dumps({
                "event": "error",
                "error": str(e)
            })
            yield f"data: {err_payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/travel")
async def travel_planner(request_data: TravelRequest):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Message cannot be empty."
                }
            )

        result = run_travel_agent(
            user_input=user_message,
            thread_id=request_data.thread_id
        )

        return JSONResponse(
            content={
                "success": True,
                "thread_id": result["thread_id"],
                "answer": result["answer"],
                "flight_results": result["flight_results"],
                "hotel_results": result["hotel_results"],
                "weather_results": result.get("weather_results", ""),
                "itinerary": result["itinerary"],
                "llm_calls": result["llm_calls"],
            }
        )

    except Exception as e:
        print("ERROR:", e)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e)
            }
        )



@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "AI Travel Planner API is running"
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


# ============================================================================
# Feedback Endpoint
# ============================================================================

@app.post("/api/feedback")
async def submit_feedback(request_data: FeedbackRequest):
    email = request_data.email.strip()
    feedback = request_data.feedback.strip()

    if not email:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Email address is required."}
        )

    email_pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(email_pattern, email):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Please enter a valid email address."}
        )

    if not feedback:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Feedback content cannot be empty."}
        )

    # Validate feedback with Gemini AI (content moderation & quality check)
    is_valid, validation_msg = validate_feedback_with_gemini(feedback)

    if not is_valid:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": validation_msg
            }
        )

    # Save acceptable feedback into triply_feedback.json
    saved_entry = save_feedback(email=email, feedback_text=feedback)

    return JSONResponse(
        content={
            "success": True,
            "message": "Thanks for your feedback! We appreciate you taking the time to help improve Triply AI.",
            "data": saved_entry
        }
    )


# ============================================================================
# Hidden Admin Endpoints
# ============================================================================

def get_session_token(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None)
) -> str | None:
    if x_admin_token and x_admin_token.strip():
        return x_admin_token.strip()
    if authorization:
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
        return authorization.strip()
    return None


@app.post("/api/admin/login")
async def admin_login(creds: AdminLoginRequest):
    if not verify_admin_login(creds.username, creds.password):
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Invalid username or password."}
        )

    token = create_admin_session()
    return JSONResponse(
        content={
            "success": True,
            "token": token,
            "username": creds.username.strip(),
            "message": "Login successful"
        }
    )


@app.get("/api/admin/feedbacks")
async def admin_feedbacks(request: Request):
    token = get_session_token(
        authorization=request.headers.get("authorization"),
        x_admin_token=request.headers.get("x-admin-token")
    )
    if not is_valid_admin_session(token):
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Unauthorized. Session expired or invalid."}
        )

    feedbacks = get_all_feedbacks()
    return JSONResponse(
        content={
            "success": True,
            "feedbacks": feedbacks,
            "total": len(feedbacks)
        }
    )


@app.post("/api/admin/change-password")
async def admin_change_password(payload: ChangePasswordRequest, request: Request):
    token = get_session_token(
        authorization=request.headers.get("authorization"),
        x_admin_token=request.headers.get("x-admin-token")
    )
    if not is_valid_admin_session(token):
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Unauthorized. Please log in first."}
        )

    success, message = update_admin_password(
        current_password=payload.current_password,
        new_password=payload.new_password
    )

    if not success:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": message}
        )

    return JSONResponse(
        content={"success": True, "message": message}
    )


@app.post("/api/admin/logout")
async def admin_logout(request: Request):
    token = get_session_token(
        authorization=request.headers.get("authorization"),
        x_admin_token=request.headers.get("x-admin-token")
    )
    invalidate_admin_session(token)
    return JSONResponse(content={"success": True, "message": "Logged out successfully"})



if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )