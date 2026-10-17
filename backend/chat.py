"""Ask Ordis home chat: routes a free-text message.

- Mentions a Toronto address  -> nearby proposals (deterministic: geocode + City data; no LLM)
- About the current proposal  -> cited answer from that application's sources (agents/qa.py)
- Anything else               -> short general planning answer, clearly labelled as general info
"""
import json
import re

from pydantic import BaseModel, Field

from . import orchestrator
from .agents import data_agent, qa
from .data import store
from .data.normalize import SUFFIXES, parse_address
from .llm.providers import LLMError, get_provider
from .llm.structured import ask_model

_NUMBER = re.compile(r"\b\d+[A-Za-z]?(?:-\d+)?\b")
_STOP = {"please", "thanks", "thank", "you", "toronto", "ontario", "on", "canada"}


def find_address(db, text: str):
    """Longest street phrase after a house number that geocodes exactly, e.g.
    'can you bring up proposals near 135 liberty street please' -> 135 Liberty St."""
    short_message = len(text.split()) <= 4  # e.g. "135 liberty": allow a street without its type
    for m in _NUMBER.finditer(text):
        words = re.sub(r"[^\w\s'-]", " ", text[m.end():]).split()
        words = [w for w in words if w.lower() not in _STOP][:5]
        for n in range(len(words), 0, -1):
            candidate = f"{m.group().split('-')[0]} {' '.join(words[:n])}"
            parsed = parse_address(candidate)
            if not parsed:
                continue
            num, street = parsed
            exact = db.execute("SELECT 1 FROM address_points WHERE street_norm=? AND lo_num=? LIMIT 1",
                               (street, num)).fetchone()
            if not exact and not short_message:
                continue
            try:
                addr = store.geocode(db, candidate)
            except store.DataError:
                continue
            if addr.exact:
                return addr
    return None


_SUFFIX_RE = re.compile(r"\b(\d+[A-Za-z]?\s+(?:[A-Za-z'.-]+\s+){0,3}?(?:" + "|".join(sorted(
    set(SUFFIXES) | set(SUFFIXES.values()), key=len, reverse=True)) + r"))\b", re.I)


def looks_like_address(text: str) -> str | None:
    """A 'number + street + street-type' phrase (e.g. '1 Nowhere Lane') even if it doesn't geocode."""
    m = _SUFFIX_RE.search(text)
    return m.group(1) if m else None


def _featured(address_full: str) -> dict | None:
    """The saved run for this address, if any: its summary and key facts."""
    for c in orchestrator.cached_runs():
        if c["address"] != address_full or c["include_closed"]:
            continue
        saved = json.loads((orchestrator.RUNS / f"{c['key']}.json").read_text())["result"]
        spec, app, nar = saved.get("spec") or {}, saved.get("application") or {}, saved.get("narration") or {}
        if not app:
            continue
        storeys = " & ".join(str(t["storeys"]) for t in spec.get("towers", [])) or str(spec.get("total_storeys", ""))
        facts = [
            {"value": (spec.get("use_type") or "").replace("-", " ").capitalize(), "label": "Proposed use"},
            {"value": f"{storeys} storeys",
             "label": "Stated in application" if not any(a["field"] == "total_storeys" for a in spec.get("assumptions", []))
             else "Estimated"},
        ]
        if spec.get("units"):
            facts.append({"value": f"{spec['units']:,} homes", "label": "Stated in application"})
        elif spec.get("gfa_m2"):
            facts.append({"value": f"{spec['gfa_m2']:,.0f} m²", "label": "Floor area"})
        return {"headline": nar.get("headline"), "summary": nar.get("summary"), "app_number": app["app_number"],
                "type_name": app.get("type_name"), "status": app.get("status"), "address": (app.get("address") or "").title(),
                "facts": [f for f in facts if f["value"].strip()]}
    return None


def proposals(db, addr, include_closed: bool) -> dict:
    apps = store.nearby_applications(db, addr.x, addr.y, 300, include_closed)
    housing = store.housing_context(db, addr.x, addr.y)
    modelled = sum(a["modelled"] for a in apps)
    if apps:
        intro = (f"I found {len(apps)} development application{'s' if len(apps) != 1 else ''} within 300 m of "
                 f"{addr.address_full}. {modelled} can be shown in 3D.")
    else:
        intro = (f"I couldn't find any active development applications within 300 m of {addr.address_full}."
                 + ("" if include_closed else " Closed applications are hidden."))
    return {
        "type": "proposals",
        "place": {"address": addr.address_full, "lat": addr.lat, "lon": addr.lon, "ward": addr.ward_name,
                  "neighbourhood": housing["neighbourhood"] if housing else None},
        "intro": intro,
        "featured": _featured(addr.address_full),
        "applications": [{k: a[k] for k in ("app_number", "type_name", "status", "address", "distance_m", "modelled",
                                            "closed", "application_url", "description", "date_submitted")}
                         for a in apps],
    }


class General(BaseModel):
    answer: str = Field(description="2-4 plain-language sentences")
    needs_address: bool = Field(description="True if the question can only be answered for a specific address")


GENERAL_SYSTEM = (
    "You are Ordis, a neutral civic assistant about development in Toronto. Answer general questions about "
    "how City of Toronto planning works (application types such as rezoning/OZ, site plan/SA, condominium/CD, "
    "subdivision/SB; community consultation; how to comment; the Ontario Land Tribunal) in plain language. "
    "Do not invent facts about specific sites; if the question needs an address, say so and set "
    "needs_address=true. Never argue for or against a development.")


async def handle(message: str, place: dict | None, include_closed: bool, history: list[dict]) -> dict:
    db = store.connect()
    addr = find_address(db, message)
    if addr:
        return proposals(db, addr, include_closed)
    attempted = looks_like_address(message)
    if attempted:
        return {"type": "answer", "general": False, "answerable": False, "citations": [], "sources": {},
                "answer": f"I couldn't find \"{attempted}\" in the City of Toronto's address list. Try the house number "
                          "and street, like \"135 Liberty St\"."}

    app_number = (place or {}).get("app_number")
    try:
        provider = get_provider()
    except LLMError as e:
        return {"type": "answer", "general": True, "answerable": False, "citations": [], "sources": {},
                "answer": f"I can't answer questions right now ({e}). Try a Toronto address, like '135 Liberty St'."}

    if app_number:
        app = store.get_application(db, app_number)
        spec_file = orchestrator.spec_cache_path(app, data_agent.related_applications(db, app))
        spec = json.loads(spec_file.read_text())["spec"] if spec_file.exists() else None
        extra = {}
        housing = store.housing_context(db, app["x"], app["y"])
        if housing:
            extra["neighbourhood_housing"] = {"label": f"Neighbourhood Profiles 2021: {housing['neighbourhood']}",
                                              "url": "https://open.toronto.ca/dataset/neighbourhood-profiles/",
                                              "content": housing}
        sources = qa.build_sources(db, app_number, spec, extra)
        a = await qa.answer(provider, message, sources, history)
        return {"type": "answer", "general": False, **a.model_dump(),
                "sources": {k: {"label": v["label"], "url": v["url"]} for k, v in sources.items()}}

    g = await ask_model(provider, GENERAL_SYSTEM, message, General)
    text = g.answer + (" Tell me an address, for example '135 Liberty St', and I'll look it up." if g.needs_address else "")
    return {"type": "answer", "general": True, "answerable": True, "answer": text, "citations": [], "sources": {}}
