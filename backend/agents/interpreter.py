"""Interpreter Agent: application text -> Extraction (LLM) -> BuildingSpec (rules)."""
from ..llm.structured import ask_model
from .spec import BuildingSpec, Extraction, complete_spec

SYSTEM = (
    "You are the Interpreter Agent of Ordis. You read City of Toronto development application "
    "descriptions and extract ONLY what the text states about the proposed building: storeys, "
    "heights, podium, towers, setbacks, use, units, gross floor area. If a value is not stated, use "
    "null. Never guess numbers. Several related applications for the same site may be given; the "
    "rezoning (OZ) description usually has the most detail, and later site plan (SA) text may update "
    "it. When numbers conflict, prefer the most recent application. Quote the supporting phrases in "
    "stated_facts. Set proposes_new_building=false if the text is only about condominium "
    "registration, lot severance, part lot control, interior work or demolition.")


def describe(app: dict, related: list[dict]) -> str:
    lines = [f"Selected application {app['app_number']} ({app['type_name']}), submitted "
             f"{(app['date_submitted'] or '')[:10]}, status {app['status']}, address {app['address']}:",
             app["description"] or "(no description)"]
    for r in related:
        lines += [f"\nRelated application {r['app_number']} ({r['type_name']}), submitted "
                  f"{(r['date_submitted'] or '')[:10]}, status {r['status']}:", r["description"] or "(no description)"]
    return "\n".join(lines)


async def interpret(provider, app: dict, related: list[dict], on_attempt=None) -> tuple[Extraction, BuildingSpec]:
    """Raises SpecRejected when the application can't be modelled honestly."""
    extraction = await ask_model(provider, SYSTEM, describe(app, related), Extraction, on_attempt=on_attempt)
    return extraction, complete_spec(extraction)
