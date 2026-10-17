"""Ordis API.

    backend/.venv/Scripts/python -m uvicorn backend.main:app --port 8000

GET /api/health            provider, database and Blender status
GET /api/applications      geocode + nearby applications (for picking one)
GET /api/run               Server-Sent Events: one `event` per agent step, then `result`
                           (saved runs are replayed instantly; fresh=true forces a new run)
GET /api/cached            addresses with a saved run, for the demo picker
GET /api/ward              application counts for a ward
GET /api/sources           dataset links and refresh dates
GET /files/scenes/...      built .glb / preview .png
"""
import asyncio
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

from . import orchestrator  # noqa: E402
from .blender_bridge.runner import BlenderError, blender_path  # noqa: E402
from .data import store  # noqa: E402
from .llm.providers import provider_status  # noqa: E402

app = FastAPI(title="Ordis")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])
orchestrator.CACHE.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=orchestrator.CACHE), name="files")


@app.get("/api/health")
def health():
    try:
        db_ok = bool(store.connect().execute("SELECT 1 FROM dev_apps LIMIT 1").fetchone())
    except Exception:
        db_ok = False
    try:
        blender = blender_path()
    except BlenderError:
        blender = None
    return {"llm": provider_status(), "database": db_ok, "blender": blender is not None}


@app.get("/api/applications")
def applications(address: str, include_closed: bool = False, radius_m: float = Query(300, le=1000)):
    db = store.connect()
    try:
        addr = store.geocode(db, address)
    except store.DataError as e:
        raise HTTPException(404, str(e))
    apps = store.nearby_applications(db, addr.x, addr.y, radius_m, include_closed)
    return {"geocode": addr.__dict__, "applications": apps}


@app.get("/api/ward")
def ward(name: str, include_closed: bool = False):
    return store.ward_summary(store.connect(), name, include_closed)


@app.get("/api/sources")
def sources():
    return store.sources(store.connect())


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/api/involved")
def involved(app_number: str):
    """How a resident can take part: community meetings (this and related applications),
    the City planner on the file, and the official record."""
    import datetime as dt

    from .agents.data_agent import related_applications

    db = store.connect()
    try:
        app_ = store.get_application(db, app_number)
    except store.DataError as e:
        raise HTTPException(404, str(e))
    today = dt.date.today().isoformat()
    meetings = {}
    for a in [app_] + related_applications(db, app_, limit=10):
        if a.get("meeting_date"):
            key = (a["meeting_date"][:10], a.get("meeting_time"))
            meetings.setdefault(key, {"date": a["meeting_date"][:10], "time": a.get("meeting_time"),
                                      "location": a.get("meeting_location"), "app_number": a["app_number"]})
    ordered = sorted(meetings.values(), key=lambda m: m["date"])
    return {
        "app_number": app_["app_number"],
        "address": app_["address"],
        "status": app_["status"],
        "ward_name": app_["ward_name"],
        "application_url": app_["application_url"],
        "planner": {"name": app_["contact_name"], "phone": app_["contact_phone"], "email": app_["contact_email"]},
        "upcoming_meetings": [m for m in ordered if m["date"] >= today],
        "past_meetings": [m for m in ordered if m["date"] < today][-3:],
        "today": today,
    }


class AskRequest(BaseModel):
    app_number: str
    question: str = Field(min_length=2, max_length=500)
    history: list[dict] = Field(default_factory=list)  # [{"q": ..., "a": ...}], last few turns


@app.post("/api/ask")
async def ask(req: AskRequest):
    """Ask Ordis: a cited answer grounded in this application's data (answers are cached)."""
    from .agents import data_agent, qa
    from .llm.providers import LLMError, get_provider

    db = store.connect()
    try:
        app_ = store.get_application(db, req.app_number)
    except store.DataError as e:
        raise HTTPException(404, str(e))
    spec_file = orchestrator.spec_cache_path(app_, data_agent.related_applications(db, app_))
    spec = json.loads(spec_file.read_text())["spec"] if spec_file.exists() else None

    key = orchestrator._hash([req.app_number, " ".join(req.question.lower().split()), req.history[-3:]])
    cache_file = orchestrator.CACHE / "qa" / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text()) | {"cached": True}

    sources = qa.build_sources(db, req.app_number, spec)
    try:
        provider = get_provider()
        a = await qa.answer(provider, req.question, sources, req.history)
    except LLMError as e:
        raise HTTPException(503, f"Ask Ordis is unavailable: {e}")
    out = {
        "question": req.question,
        **a.model_dump(),
        "sources": {k: {"label": v["label"], "url": v["url"]} for k, v in sources.items()},
        "provider_notes": list(getattr(provider, "notes", [])),
    }
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(out, default=str))
    return out


@app.get("/api/cached")
def cached():
    """Addresses with a saved run (instant replay), newest first."""
    return orchestrator.cached_runs()


@app.get("/api/run")
async def run(address: str, app_number: str | None = None, include_closed: bool = False, fresh: bool = False):
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(agent, kind, message, data):
        await queue.put(_sse("step", {"agent": agent, "kind": kind, "message": message, "data": data}))

    async def task():
        try:
            result = await orchestrator.run(address, emit, app_number, include_closed, fresh=fresh)
        except (store.DataError, BlenderError) as e:
            result = {"ok": False, "message": str(e)}
        except Exception as e:  # report instead of dropping the stream
            result = {"ok": False, "message": f"Unexpected error: {e!r}"}
        await queue.put(_sse("result", result))
        await queue.put(None)

    async def stream():
        worker = asyncio.create_task(task())
        try:
            while (item := await queue.get()) is not None:
                yield item
        finally:
            if not worker.done():
                worker.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
