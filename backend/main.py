"""Ordis API.

    backend/.venv/Scripts/python -m uvicorn backend.main:app --port 8000

GET /api/health            provider, database and Blender status
GET /api/applications      geocode + nearby applications (for picking one)
GET /api/run               Server-Sent Events: one `event` per agent step, then `result`
                           (saved runs are replayed instantly; fresh=true forces a new run)
GET /api/cached            addresses with a saved run, for the demo picker
GET /api/block             every active nearby proposal placed in a built scene ("your block in 5 years")
GET /api/sunlight          hours of sun lost for a scene and day (block=true: all proposals combined)
POST /api/briefing         one-page PDF briefing for a community meeting
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
    db = store.connect()
    try:
        app_ = store.get_application(db, app_number)
    except store.DataError as e:
        raise HTTPException(404, str(e))
    return involvement(db, app_)


def involvement(db, app_: dict) -> dict:
    import datetime as dt

    from .agents.data_agent import related_applications

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


def _cached_spec(db, app_: dict) -> dict | None:
    from .agents import data_agent

    spec_file = orchestrator.spec_cache_path(app_, data_agent.related_applications(db, app_))
    return json.loads(spec_file.read_text())["spec"] if spec_file.exists() else None


def _housing(db, app_: dict) -> dict | None:
    """Neighbourhood housing context plus what the proposal adds (when the application states units)."""
    ctx = store.housing_context(db, app_["x"], app_["y"])
    if not ctx:
        return None
    spec = _cached_spec(db, app_)
    units = spec.get("units") if spec else None
    ctx["proposal"] = {
        "use_type": spec.get("use_type") if spec else None,
        "units": units,
        "units_stated": units is not None,
        "share_of_households_pct": round(100 * units / ctx["households"], 1) if units and ctx["households"] else None,
        "gfa_m2": spec.get("gfa_m2") if spec else None,
    }
    ctx["source"] = {"label": "City of Toronto Neighbourhood Profiles (2021 Census)",
                     "url": "https://open.toronto.ca/dataset/neighbourhood-profiles/"}
    return ctx


@app.get("/api/site")
def site(app_number: str):
    """What stands on the proposal's lot today: Heritage Register entries (on the lot and nearby)
    and registered rental apartment buildings, plus what the application text says about rental."""
    from . import site_facts

    db = store.connect()
    try:
        return site_facts.for_application(db, store.get_application(db, app_number))
    except store.DataError as e:
        raise HTTPException(404, str(e))


@app.get("/api/housing")
def housing(app_number: str):
    """Housing context for the application's neighbourhood (2021 Census, 158 neighbourhoods)."""
    db = store.connect()
    try:
        app_ = store.get_application(db, app_number)
    except store.DataError as e:
        raise HTTPException(404, str(e))
    ctx = _housing(db, app_)
    if not ctx:
        raise HTTPException(404, "This location is not inside a City of Toronto neighbourhood boundary")
    return ctx


def _scene_dir(scene_key: str):
    scenes = (orchestrator.CACHE / "scenes").resolve()
    scene_dir = (scenes / scene_key).resolve()
    if scene_dir.parent != scenes or not (scene_dir / "plan.json").exists():
        raise HTTPException(404, "unknown scene")
    return scene_dir


def sunlight_result(scene_key: str, date: str, block: bool = False) -> dict:
    """Hours of sun lost for a scene and day (cached), with the most affected lots named.
    `block` = all active nearby proposals together (needs /api/block to have run)."""
    import datetime as dt

    from . import sunlight

    scene_dir = _scene_dir(scene_key)
    try:
        day = dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    block_data = None
    if block:
        f = scene_dir / "block.json"
        if not f.exists():
            raise HTTPException(409, "load the block view first")
        block_data = json.loads(f.read_text())
    try:
        res = sunlight.run(scene_dir, day, block_data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    name = sunlight.study_name(day, block_data)

    # Name the most affected lots with the nearest City address point.
    if res["affected_parcels"] and "named" not in res:
        db = store.connect()
        app_ = store.get_application(db, res["application_id"])
        ox, oy = store.find_lot(db, app_).origin
        pts = [(p["x"] + ox, p["y"] + oy) for p in res["affected_parcels"]]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        rows = db.execute("SELECT address_full, x, y FROM address_points WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?",
                          (min(xs) - 40, max(xs) + 40, min(ys) - 40, max(ys) + 40)).fetchall()
        for p, (px, py) in zip(res["affected_parcels"], pts):
            near = min(rows, key=lambda r: (r["x"] - px) ** 2 + (r["y"] - py) ** 2, default=None)
            if near is not None and ((near["x"] - px) ** 2 + (near["y"] - py) ** 2) ** 0.5 < 60:
                p["address"] = near["address_full"]
        res["named"] = True
        (scene_dir / f"{name}.json").write_text(json.dumps({k: v for k, v in res.items() if k != "cached"}))
    return res | {"png_url": f"/files/scenes/{scene_key}/{name}.png"}


@app.get("/api/sunlight")
def sunlight_study(scene_key: str, date: str, block: bool = False):
    """Hours of ground-level direct sun lost/gained for a built scene on one day (cached)."""
    return sunlight_result(scene_key, date, block)


class BriefingRequest(BaseModel):
    scene_key: str
    date: str  # sunlight study day, YYYY-MM-DD
    block: bool = False  # include every active nearby proposal (needs /api/block first)
    snapshot: str | None = Field(None, max_length=12_000_000)  # data:image/jpeg|png;base64 of the 3D view


@app.post("/api/briefing")
def briefing(req: BriefingRequest):
    """One-page PDF for a community meeting: 3D snapshot, plain-language summary, stated vs
    estimated, sunlight lost, meetings and the planner. Everything but the snapshot comes from
    Ordis' own records for this scene, never from the request."""
    import base64
    import binascii
    import re

    from fastapi.responses import Response

    from . import briefing as briefing_pdf
    from . import site_facts

    scene_dir = _scene_dir(req.scene_key)
    image = None
    if req.snapshot:
        m = re.fullmatch(r"data:image/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)", req.snapshot)
        if not m:
            raise HTTPException(400, "snapshot must be a PNG or JPEG data URL")
        try:
            image = base64.b64decode(m.group(1), validate=True)
        except binascii.Error:
            raise HTTPException(400, "snapshot is not valid base64")

    db = store.connect()
    plan = json.loads((scene_dir / "plan.json").read_text())
    app_ = store.get_application(db, plan["metadata"]["application_id"])
    narration_file = scene_dir / "narration.json"
    block = None
    if req.block and (scene_dir / "block.json").exists():
        block = json.loads((scene_dir / "block.json").read_text())
    facts = {
        "application": app_,
        "spec": _cached_spec(db, app_),
        "narration": json.loads(narration_file.read_text()) if narration_file.exists() else None,
        "involved": involvement(db, app_),
        "site": site_facts.for_application(db, app_),
        "sunlight": sunlight_result(req.scene_key, req.date),
        "block": block,
        "block_sunlight": sunlight_result(req.scene_key, req.date, block=True) if block else None,
        "limitations": orchestrator.LIMITATIONS,
        "sources": store.sources(db),
    }
    pdf = briefing_pdf.render(facts, image)
    slug = re.sub(r"[^a-z0-9]+", "-", app_["address"].lower()).strip("-")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="ordis-briefing-{slug}.pdf"'})


@app.get("/api/block")
async def block_view(scene_key: str, fresh: bool = False):
    """Your block in 5 years: every active nearby proposal placed in this scene (cached).
    The first visit may read uncached applications with the Interpreter Agent."""
    from . import block

    try:
        return await block.build(_scene_dir(scene_key), fresh=fresh)
    except store.DataError as e:
        raise HTTPException(404, str(e))


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    place: dict | None = None  # {"address", "app_number"} of the proposal being discussed
    include_closed: bool = False
    history: list[dict] = Field(default_factory=list)


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Home chat: proposals near an address in the message, or a (cited) answer."""
    from . import chat as chat_router
    from .llm.providers import LLMError

    try:
        return await chat_router.handle(req.message, req.place, req.include_closed, req.history)
    except LLMError as e:
        raise HTTPException(503, f"Ordis can't answer right now: {e}")


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
    spec = _cached_spec(db, app_)

    key = orchestrator._hash([req.app_number, " ".join(req.question.lower().split()), req.history[-3:]])
    cache_file = orchestrator.CACHE / "qa" / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text()) | {"cached": True}

    extra = {}
    housing_ctx = _housing(db, app_)
    if housing_ctx:
        extra["neighbourhood_housing"] = {"label": f"{housing_ctx['source']['label']}: {housing_ctx['neighbourhood']}",
                                          "url": housing_ctx["source"]["url"], "content": housing_ctx}
    sources = qa.build_sources(db, req.app_number, spec, extra)
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
