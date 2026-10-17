"""Narrator Agent: plain-language summary for a resident."""
import json

from pydantic import BaseModel, Field

from ..llm.structured import ask_model

SYSTEM = (
    "You are the Narrator Agent of Ordis, a neutral civic information tool for Toronto residents. "
    "Write in plain language at about a grade 8 reading level. Do not argue for or against the "
    "development and do not speculate about effects you were not given. Clearly separate what the "
    "application states from what Ordis estimated. Always say the 3D model is an approximation.")


class Narration(BaseModel):
    headline: str = Field(description="One short sentence: what is proposed and where")
    summary: str = Field(description="2 short paragraphs of plain language, markdown allowed")
    key_facts: list[str] = Field(description="3-6 short bullet facts, each marked (stated) or (estimated)")
    how_to_learn_more: str = Field(description="One sentence pointing to the official application page "
                                   "and any community meeting")


def facts(app: dict, spec, neighbours: dict, site_notes: list[str]) -> dict:
    return {
        "application": {k: app.get(k) for k in ("app_number", "type_name", "status", "date_submitted", "address",
                                                "ward_name", "application_url", "meeting_date", "meeting_location",
                                                "description")},
        "spec": json.loads(spec.model_dump_json()),
        "neighbours": neighbours,
        "site_notes": site_notes,
    }


def fallback(app: dict, spec, neighbours: dict) -> Narration:
    """Template summary if the LLM is unavailable."""
    how = "stated" if spec.height_stated else "estimated"
    first = (f"Application {app['app_number']} ({app['type_name']}) is **{app['status']}**. "
             f"It describes a {spec.use_type} building of {spec.total_storeys} storeys, {how} at about "
             f"{spec.height_m:.0f} m.")
    if neighbours.get("median_m"):
        first += (f" The median existing building within {neighbours['radius_m']} m is "
                  f"{neighbours['median_m']:.0f} m tall and the tallest is {neighbours['tallest_m']:.0f} m.")
    return Narration(
        headline=f"{spec.total_storeys}-storey {spec.use_type} proposal at {app['address']}",
        summary=first + "\n\nThe 3D model is an approximation built from the application text and the "
                        "property boundary.",
        key_facts=[f"{spec.total_storeys} storeys (stated)", f"~{spec.height_m:.0f} m "
                   f"({'stated' if spec.height_stated else 'estimated'})"]
                  + ([f"{spec.units} units (stated)"] if spec.units else []),
        how_to_learn_more=f"Read the official application at {app['application_url']}.",
    )


async def narrate(provider, app, spec, neighbours, site_notes, on_attempt=None) -> tuple[Narration, bool]:
    """Returns (narration, used_fallback)."""
    try:
        n = await ask_model(provider, SYSTEM, "Facts:\n" + json.dumps(facts(app, spec, neighbours, site_notes),
                                                                       indent=1), Narration, on_attempt=on_attempt)
        return n, False
    except Exception:
        return fallback(app, spec, neighbours), True
