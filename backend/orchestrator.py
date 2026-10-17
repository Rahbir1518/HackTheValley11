"""Runs the four agents in order and reports every step through `emit`.

Caches (under output/cache):
  runs/<address hash>.json       whole successful runs (result + event log), replayed instantly
  choices/<hash>.json            the Data Agent's pick for an address + candidate set
  specs/<app>_<text hash>.json   interpreter output, so repeat runs skip the LLM
  scenes/<app>_<spec hash>/      plan.json, scene.glb, preview.png, narration.json
"""
import asyncio
import datetime as dt
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Awaitable, Callable

import ordis_geom as geom

from .agents import builder, data_agent, interpreter, narrator
from .agents.spec import BuildingSpec, Extraction, SpecRejected
from .blender_bridge.runner import run_build
from .data import store
from .data.normalize import parse_address
from .llm.providers import LLMError, get_provider, provider_status

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "output" / "cache"
RUNS = CACHE / "runs"
PLAN_VERSION = 2  # bump when the Blender tool layer changes output
CONTEXT_RADIUS_M = 250
REPLAY_DELAY_S = float(os.getenv("ORDIS_REPLAY_DELAY", "0.04"))  # pacing when replaying a cached run

LIMITATIONS = [
    "The footprint is estimated from the property boundary, not from architectural drawings.",
    "Heights and storeys come from the application text; missing values are estimated and listed as assumptions.",
    "This is a massing approximation, not an architectural rendering. Window patterns are illustrative.",
    "Surrounding buildings come from the City's 2025 3D Massing data and may be out of date.",
    "Tree sizes are estimated from trunk diameter.",
]

Emit = Callable[[str, str, str, dict | None], Awaitable[None]]


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _safe(app_number: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in app_number)


def spec_cache_path(app: dict, related: list[dict]) -> Path:
    """Interpreter cache file, keyed by the application text it read."""
    text_hash = _hash([app["description"]] + [r["description"] for r in related])
    return CACHE / "specs" / f"{_safe(app['app_number'])}_{text_hash}.json"


def _run_key(address: str, app_number: str | None, include_closed: bool) -> tuple[str, str]:
    parsed = parse_address(address)
    norm = f"{parsed[0]} {parsed[1]}" if parsed else " ".join(address.upper().split())
    return _hash([norm, app_number, include_closed, PLAN_VERSION]), norm


async def run(address: str, emit: Emit, app_number: str | None = None, include_closed: bool = False,
              radius_m: float = 300, fresh: bool = False) -> dict:
    """Replays a saved run for the same address/options when one exists (unless `fresh`),
    otherwise runs the agents and saves successful runs for next time."""
    key, norm = _run_key(address, app_number, include_closed)
    saved_file = RUNS / f"{key}.json"
    if not fresh and saved_file.exists():
        saved = json.loads(saved_file.read_text())
        glb = saved["result"].get("glb_url", "").removeprefix("/files/")
        if glb and (CACHE / glb).exists():
            await emit("system", "cache", f"Replaying the saved run for {norm} (saved {saved['saved_at'][:16]}, "
                       "no AI calls)", None)
            for agent, kind, message, data in saved["events"]:
                await emit(agent, kind, message, data)
                await asyncio.sleep(REPLAY_DELAY_S)
            return saved["result"] | {"cached": True}

    events: list = []

    async def record(agent, kind, message, data):
        events.append([agent, kind, message, data])
        await emit(agent, kind, message, data)

    result = await _run_pipeline(address, record, app_number, include_closed, radius_m)
    if result.get("ok"):
        RUNS.mkdir(parents=True, exist_ok=True)
        saved_file.write_text(json.dumps({
            "query": norm, "app_number": app_number, "include_closed": include_closed,
            "saved_at": dt.datetime.now().isoformat(timespec="seconds"), "result": result, "events": events,
        }, default=str))
    return result


def cached_runs() -> list[dict]:
    """Saved runs, newest first, for the demo picker."""
    out = []
    for f in RUNS.glob("*.json") if RUNS.exists() else []:
        try:
            s = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        r = s["result"]
        out.append({
            "address": (r.get("geocode") or {}).get("address_full") or s["query"],
            "app_number": s["app_number"],
            "include_closed": s["include_closed"],
            "application": (r.get("application") or {}).get("app_number"),
            "headline": (r.get("narration") or {}).get("headline"),
            "saved_at": s["saved_at"],
        })
    return sorted(out, key=lambda x: x["saved_at"], reverse=True)


async def _run_pipeline(address: str, emit: Emit, app_number: str | None, include_closed: bool,
                        radius_m: float) -> dict:
    t0 = time.time()
    db = store.connect()
    status = provider_status()
    result: dict = {"ok": False, "address": address, "provider": status, "limitations": LIMITATIONS,
                    "sources": store.sources(db)}

    async def flush_provider_notes(agent):
        """Report provider switches (e.g. Gemini quota reached -> Groq) in the console."""
        notes = getattr(provider, "notes", None)
        while notes:
            await emit(agent, "warn", f"LLM: {notes.pop(0)}", None)

    def attempt_logger(agent):
        async def log(n, raw, error):
            await flush_provider_notes(agent)
            if error:
                await emit(agent, "retry", f"Attempt {n} rejected: {error[:300]}", {"response": raw})
            else:
                await emit(agent, "llm", f"Valid answer on attempt {n}", {"response": raw})
        return log

    try:
        provider = get_provider()
    except LLMError as e:
        provider = None
        await emit("system", "warn", f"LLM unavailable: {e}", None)

    # ---------------------------------------------------------------- Data Agent
    await emit("data", "start", f"Geocoding '{address}'", None)
    addr = store.geocode(db, address)
    result["geocode"] = addr.__dict__
    await emit("data", "tool", f"Matched {addr.address_full} ({addr.lat:.5f}, {addr.lon:.5f})"
               + ("" if addr.exact else " - nearest address on that street"), addr.__dict__)
    if addr.ward_name:
        result["ward"] = store.ward_summary(db, addr.ward_name, include_closed)

    apps = store.nearby_applications(db, addr.x, addr.y, radius_m, include_closed)
    result["candidates"] = [{k: a[k] for k in ("app_number", "app_type", "type_name", "status", "address",
                                                "distance_m", "modelled", "closed", "date_submitted",
                                                "application_url", "description")} for a in apps]
    await emit("data", "tool", f"{len(apps)} application(s) within {radius_m:.0f} m "
               f"({sum(a['modelled'] for a in apps)} can be modelled)",
               {"applications": [f"{a['app_number']} | {a['status']} | {a['distance_m']:.0f} m" for a in apps[:20]]})

    if app_number:
        app = store.get_application(db, app_number)
        reason = "Chosen by the user."
    else:
        modelled = [a for a in apps if a["modelled"]]
        if not modelled:
            result["message"] = (f"No rezoning or site plan application was found within {radius_m:.0f} m of "
                                 f"{addr.address_full}, so there is no proposed building to model."
                                 + (" Other application types nearby are listed." if apps else ""))
            await emit("data", "stop", result["message"], None)
            return result
        choice_file = CACHE / "choices" / f"{_hash([addr.address_full, [a['app_number'] for a in modelled]])}.json"
        if choice_file.exists():
            saved = json.loads(choice_file.read_text())
            app = next((a for a in modelled if a["app_number"] == saved["app_number"]), modelled[0])
            reason = saved["reason"]
            await emit("data", "cache", "Using the cached choice for this address", None)
        elif provider:
            app, reason, used_llm = await data_agent.choose_application(provider, address, modelled,
                                                                        attempt_logger("data"))
            await flush_provider_notes("data")
            if used_llm:
                choice_file.parent.mkdir(parents=True, exist_ok=True)
                choice_file.write_text(json.dumps({"app_number": app["app_number"], "reason": reason}))
        else:
            app, reason = modelled[0], "Nearest modelled application."
    result["application"] = app
    await emit("data", "result", f"Selected {app['app_number']} at {app['address']}: {reason}",
               {"app_number": app["app_number"], "status": app["status"], "reason": reason})

    related = data_agent.related_applications(db, app)
    if related:
        await emit("data", "tool", f"Found {len(related)} related application(s) for the same site",
                   {"related": [r["app_number"] for r in related]})
    site = store.find_lot(db, app)
    buildings = store.context_buildings(db, site, CONTEXT_RADIUS_M)
    neighbours = data_agent.neighbour_stats(buildings)
    result["site"] = {"parcel_ids": site.parcel_ids, "lot_area_m2": round(site.lot.area, 1),
                      "origin_epsg2952": site.origin, "notes": site.notes, "neighbours": neighbours}
    await emit("data", "result", f"Lot {site.lot.area:.0f} m2 from {len(site.parcel_ids)} parcel(s); "
               f"{neighbours['count']} buildings within {CONTEXT_RADIUS_M} m", result["site"])

    # ---------------------------------------------------------------- Interpreter Agent
    spec_file = spec_cache_path(app, related)
    try:
        if spec_file.exists():
            cached = json.loads(spec_file.read_text())
            extraction = Extraction.model_validate(cached["extraction"])
            spec = BuildingSpec.model_validate(cached["spec"])
            await emit("interpreter", "cache", "Using cached interpretation of this application text", None)
        else:
            if not provider:
                raise LLMError("an LLM provider is required to read the application text")
            await emit("interpreter", "start", "Reading the application description(s)",
                       {"text": interpreter.describe(app, related)})
            extraction, spec = await interpreter.interpret(provider, app, related, attempt_logger("interpreter"))
            spec_file.parent.mkdir(parents=True, exist_ok=True)
            spec_file.write_text(json.dumps({"extraction": extraction.model_dump(), "spec": spec.model_dump()},
                                            indent=1))
    except SpecRejected as e:
        result["message"] = f"Ordis did not build a model for {app['app_number']}: {e}"
        await emit("interpreter", "stop", result["message"], None)
        return result
    except LLMError as e:
        await flush_provider_notes("interpreter")
        result["message"] = f"The Interpreter Agent could not read this application: {e}"
        await emit("interpreter", "error", result["message"], None)
        return result
    result["extraction"], result["spec"] = extraction.model_dump(), spec.model_dump()
    await emit("interpreter", "result", f"{spec.total_storeys} storeys, {spec.height_m} m "
               f"({'stated' if spec.height_stated else 'estimated'}), {len(spec.towers)} tower(s), "
               f"confidence {spec.confidence:.2f}, {len(spec.assumptions)} assumption(s)", result["spec"])

    # ---------------------------------------------------------------- Builder Agent
    scene_key = f"{_safe(app['app_number'])}_{_hash([spec.model_dump(), PLAN_VERSION, CONTEXT_RADIUS_M])}"
    scene_dir = CACHE / "scenes" / scene_key
    glb = scene_dir / "scene.glb"
    result["scene_key"] = scene_key
    lot_ring = geom.clean_ring([tuple(p) for p in store.local_ring(site.lot, site.origin)])
    if glb.exists():
        await emit("builder", "cache", "Scene for this application and spec already built", None)
    else:
        _, axis, length, width = geom.min_area_rect(lot_ring)
        lot_info = {"area_m2": round(geom.area(lot_ring), 1), "long_side_m": round(length, 1),
                    "short_side_m": round(width, 1), "vertices": len(lot_ring)}
        await emit("builder", "start", "Planning Blender tool calls", {"lot": lot_info})
        if provider:
            steps, reasoning, fell_back, why = await builder.plan_proposal(provider, spec, lot_ring, lot_info,
                                                                           attempt_logger("builder"))
        else:
            steps = builder.relax_separation(builder.fallback_steps(spec), lot_ring, spec)
            reasoning, fell_back, why = "Rule-based plan generated directly from the spec.", True, "no LLM"
        await flush_provider_notes("builder")
        if fell_back:
            await emit("builder", "warn", f"Using the rule-based plan ({why})", None)
        await emit("builder", "result", reasoning, None)
        for s in steps:
            shown = {k: ("<lot polygon>" if k == "footprint" else v) for k, v in s["args"].items()}
            await emit("builder", "tool_call", s["tool"], shown)

        context = [
            {"tool": "create_ground", "args": {"size_m": CONTEXT_RADIUS_M * 2 + 100}},
            {"tool": "load_context_parcels", "args": {"geojson": store.parcels_geojson(
                store.context_parcels(db, site, CONTEXT_RADIUS_M), site.origin)}},
            {"tool": "load_context_buildings", "args": {"geojson": store.context_geojson(buildings, site.origin)}},
            {"tool": "load_street_trees", "args": {"trees": store.context_trees(db, site, CONTEXT_RADIUS_M)}},
            {"tool": "create_lot", "args": {"polygon": [list(p) for p in lot_ring]}},
        ]
        plan = {"version": PLAN_VERSION, "metadata": {
            "application_id": app["app_number"], "address": app["address"], "status": app["status"],
            "application_url": app["application_url"], "use_type": spec.use_type,
            "total_storeys": spec.total_storeys, "height_m": spec.height_m, "height_stated": spec.height_stated,
            "confidence": spec.confidence}, "steps": context + steps}
        scene_dir.mkdir(parents=True, exist_ok=True)
        (scene_dir / "plan.json").write_text(json.dumps(plan))

        async def on_step(p):
            await emit("blender", "step", f"{p['tool']} -> {json.dumps(p['result'])[:160]}", p)
        await emit("blender", "start", "Running headless Blender", None)
        tmp = scene_dir / "scene.tmp.glb"
        res = await run_build(scene_dir / "plan.json", tmp, scene_dir / "preview.png", on_step)
        if not res.get("ok"):
            result["message"] = f"Blender rejected step {res.get('step')} ({res.get('tool')}): {res.get('error')}"
            await emit("blender", "error", result["message"], res)
            return result
        tmp.replace(glb)
        await emit("blender", "result", "Exported scene.glb", None)

    # ---------------------------------------------------------------- Narrator Agent
    narration_file = scene_dir / "narration.json"
    if narration_file.exists():
        narration = json.loads(narration_file.read_text())
        await emit("narrator", "cache", "Using cached summary", None)
    else:
        await emit("narrator", "start", "Writing a plain-language summary", None)
        if provider:
            n, fell_back = await narrator.narrate(provider, app, spec, neighbours, site.notes,
                                                  attempt_logger("narrator"))
            await flush_provider_notes("narrator")
        else:
            n, fell_back = narrator.fallback(app, spec, neighbours), True
        narration = n.model_dump() | {"template": fell_back}
        narration_file.write_text(json.dumps(narration, indent=1))
        await emit("narrator", "result", narration["headline"], narration)

    result.update(ok=True, narration=narration, glb_url=f"/files/scenes/{scene_key}/scene.glb",
                  preview_url=f"/files/scenes/{scene_key}/preview.png", seconds=round(time.time() - t0, 1))
    await emit("system", "done", f"Finished in {result['seconds']} s", None)
    return result
