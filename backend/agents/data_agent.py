"""Data Agent: address -> application -> lot + context. Deterministic except for choosing
among several nearby applications, where the LLM judges which one best answers
"what's being built near me"."""
from pydantic import BaseModel

from ..data import store
from ..llm.structured import ask_model

SYSTEM = (
    "You are the Data Agent of Ordis. A resident asked what is being built near their address. "
    "From the candidate development applications, pick the single one that best answers that: prefer "
    "applications that describe a new building with a height or storeys, that are still active, and "
    "that are close to the address. Answer with its app_number and a one-sentence reason.")


class Choice(BaseModel):
    app_number: str
    reason: str


async def choose_application(provider, address: str, candidates: list[dict], on_attempt=None) -> tuple[dict, str, bool]:
    """Returns (application, reason, used_llm)."""
    if len(candidates) == 1:
        return candidates[0], "Only modelled application nearby.", False
    listing = "\n".join(
        f"- {c['app_number']} | {c['type_name']} | {c['status']} | {c['distance_m']:.0f} m | {c['address']} | "
        f"{(c['description'] or '')[:350]}" for c in candidates[:12])
    numbers = {c["app_number"] for c in candidates}

    def check(choice: Choice):
        if choice.app_number not in numbers:
            raise ValueError(f"app_number must be one of {sorted(numbers)}")

    try:
        choice = await ask_model(provider, SYSTEM, f"Address: {address}\nCandidates:\n{listing}", Choice,
                                 on_attempt=on_attempt, extra_check=check)
        app = next(c for c in candidates if c["app_number"] == choice.app_number)
        return app, choice.reason, True
    except Exception:
        return candidates[0], "Nearest modelled application (AI choice unavailable).", False


def related_applications(db, app: dict, limit: int = 4) -> list[dict]:
    """Other applications for the same site (same parent folder or same street address)."""
    rows = db.execute(
        "SELECT * FROM dev_apps WHERE app_number != ? AND x IS NOT NULL AND "
        "((parent_folder IS NOT NULL AND parent_folder IN (?, ?)) OR app_number = ? OR "
        " (street_num = ? AND street_norm = ?)) ORDER BY date_submitted DESC",
        (app["app_number"], app.get("parent_folder"), app["app_number"], app.get("parent_folder"),
         app["street_num"], app["street_norm"])).fetchall()
    seen, out = set(), []
    for r in rows:
        d = store._app_dict(r)
        if d["app_number"] in seen or not d["description"]:
            continue
        seen.add(d["app_number"])
        out.append(d)
    return out[:limit]


def neighbour_stats(buildings: list[dict]) -> dict:
    heights = sorted(b["height"] for b in buildings if not b["on_site"])
    if not heights:
        return {"count": 0}
    return {"count": len(heights), "median_m": round(heights[len(heights) // 2], 1),
            "tallest_m": round(heights[-1], 1), "radius_m": 250,
            "on_site_existing": sum(1 for b in buildings if b["on_site"])}
