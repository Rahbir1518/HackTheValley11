"""Ask Ordis: questions answered only from this application's data, with citations.

The context is a set of named sources (application text, interpreted spec, neighbouring
buildings, nearby applications, ward). The model must cite source keys from that set;
anything it can't support is answered as "not in the data".
"""
import json

from pydantic import BaseModel, Field

from ..data import store
from ..llm.structured import ask_model
from . import data_agent


class Citation(BaseModel):
    source: str = Field(description="One of the source keys given in the context")
    quote: str = Field(description="The short phrase or number from that source that supports the answer")


class Answer(BaseModel):
    answerable: bool = Field(description="False if the sources don't contain the answer")
    answer: str = Field(description="2-4 plain-language sentences")
    citations: list[Citation] = Field(default_factory=list)


SYSTEM = (
    "You are Ask Ordis, a neutral civic assistant about one Toronto development application. Answer ONLY "
    "from the sources provided. Cite every fact with the source key it came from. If the sources don't "
    "contain the answer, set answerable=false, say what is not known, and suggest asking the City planner. "
    "Clearly say when a number is an Ordis estimate rather than stated in the application. Do not predict "
    "approval, property values or impacts you were not given, do not give legal or financial advice, and "
    "do not argue for or against the development. Plain language, grade 8 reading level.")


def build_sources(db, app_number: str, spec: dict | None, extra: dict | None = None) -> dict[str, dict]:
    """Named sources: {key: {"label", "url", "content"}}."""
    app = store.get_application(db, app_number)
    related = data_agent.related_applications(db, app, limit=6)
    sources = {
        f"application:{app['app_number']}": {
            "label": f"Application {app['app_number']} ({app['type_name']})",
            "url": app["application_url"],
            "content": {k: app.get(k) for k in ("address", "status", "date_submitted", "ward_name", "description",
                                                "meeting_date", "meeting_time", "meeting_location")},
        }
    }
    for r in related:
        sources[f"application:{r['app_number']}"] = {
            "label": f"Related application {r['app_number']} ({r['type_name']})",
            "url": r["application_url"],
            "content": {k: r.get(k) for k in ("address", "status", "date_submitted", "description")},
        }
    if spec:
        sources["ordis_spec"] = {
            "label": "Ordis interpretation (stated facts + estimates)",
            "url": None,
            "content": spec,
        }
    site = store.find_lot(db, app)
    buildings = store.context_buildings(db, site, 250)
    others = sorted((b for b in buildings if not b["on_site"]), key=lambda b: -b["height"])
    sources["neighbourhood_buildings"] = {
        "label": "City of Toronto 3D Massing (buildings within 250 m)",
        "url": "https://open.toronto.ca/dataset/3d-massing/",
        "content": {**data_agent.neighbour_stats(buildings), "lot_area_m2": round(site.lot.area),
                    "five_tallest_m": [b["height"] for b in others[:5]], "site_notes": site.notes},
    }
    nearby = store.nearby_applications(db, app["x"], app["y"], 500)
    sources["nearby_applications"] = {
        "label": "Development applications within 500 m",
        "url": "https://open.toronto.ca/dataset/development-applications/",
        "content": [{k: a[k] for k in ("app_number", "type_name", "status", "address", "distance_m")}
                    | {"description": (a["description"] or "")[:240]} for a in nearby[:15]],
    }
    if app.get("ward_name"):
        sources["ward"] = {
            "label": f"Ward activity: {app['ward_name']}",
            "url": "https://open.toronto.ca/dataset/development-applications/",
            "content": store.ward_summary(db, app["ward_name"]),
        }
    for key, value in (extra or {}).items():
        sources[key] = value
    return sources


async def answer(provider, question: str, sources: dict, history: list[dict], on_attempt=None) -> Answer:
    context = {k: {"label": v["label"], "content": v["content"]} for k, v in sources.items()}
    convo = "".join(f"Q: {h['q']}\nA: {h['a']}\n" for h in history[-3:])
    user = (f"Sources (cite by key):\n{json.dumps(context, default=str)}\n\n"
            + (f"Earlier in this conversation:\n{convo}\n" if convo else "")
            + f"Question: {question}")

    def check(a: Answer):
        bad = [c.source for c in a.citations if c.source not in sources]
        if bad:
            raise ValueError(f"unknown citation sources {bad}; use only {sorted(sources)}")
        if a.answerable and not a.citations:
            raise ValueError("an answerable answer must cite at least one source")

    return await ask_model(provider, SYSTEM, user, Answer, on_attempt=on_attempt, extra_check=check)
