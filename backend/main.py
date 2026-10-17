"""Ordis API.

    backend/.venv/Scripts/python -m uvicorn backend.main:app --port 8000

GET /api/health            provider, database and Blender status
GET /api/applications      geocode + nearby applications (for picking one)
GET /api/run               Server-Sent Events: one `event` per agent step, then `result`
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

load_dotenv()

from . import orchestrator  # noqa: E402
from .blender_bridge.runner import BlenderError, blender_path  # noqa: E402
from .data import store  # noqa: E402
from .llm.providers import provider_status  # noqa: E402

app = FastAPI(title="Ordis")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
                   allow_methods=["GET"], allow_headers=["*"])
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


@app.get("/api/run")
async def run(address: str, app_number: str | None = None, include_closed: bool = False):
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(agent, kind, message, data):
        await queue.put(_sse("step", {"agent": agent, "kind": kind, "message": message, "data": data}))

    async def task():
        try:
            result = await orchestrator.run(address, emit, app_number, include_closed)
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
