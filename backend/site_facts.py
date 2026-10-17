"""What stands on a proposal's lot today: heritage and registered rental homes.

Neutral by design. A registered rental building on the lot does not mean it will be
demolished (many applications add infill beside an existing tower), so this reports what
the registers say, quotes what the application text says about rental housing, and states
the City rule that applies if rental homes are demolished.
"""
import re

from .agents import data_agent
from .data import store

RENTAL_RULE = (
    "If a development would demolish a building with six or more homes, at least one of them rented, "
    "Toronto's Official Plan (policy 3.2.1.6) and the Rental Housing Demolition and Conversion By-law "
    "(Municipal Code Chapter 667) require the rental homes to be replaced: the same number, of similar "
    "size and at similar rents, with help for tenants who have to move."
)
RENTAL_LINKS = [
    {"label": "Municipal Code Chapter 667: Rental Housing Demolition and Conversion",
     "url": "https://www.toronto.ca/legdocs/municode/1184_667.pdf"},
    {"label": "Tenant Hotline (Federation of Metro Tenants' Associations), 416-921-9494",
     "url": "https://www.torontotenants.org/"},
]
REGISTRY_NOTE = ("The City's RentSafeTO registry covers apartment buildings with 3+ storeys and 10+ units, so "
                 "smaller rentals (houses, plexes, rooms) are not in it.")
HERITAGE_NOTE = ("Designated properties need a heritage permit from the City to be altered or demolished; listed "
                 "properties need 60 days' notice before demolition.")
RENTAL_WORDS = re.compile(r"\b(rental|tenant|demoli\w*|retain\w*|replace\w*|affordable)\b", re.I)


def rental_mentions(texts: list[str], limit: int = 3) -> list[str]:
    """Sentences of the application text that talk about rental homes, demolition or retention."""
    out: list[str] = []
    for text in texts:
        for sentence in re.split(r"(?<=[.;])\s+", text or ""):
            s = " ".join(sentence.split())
            m = RENTAL_WORDS.search(s)
            if m and s not in out:
                out.append(_excerpt(s, m.start()))
    return out[:limit]


def _excerpt(s: str, at: int, size: int = 300) -> str:
    """The sentence, or a window of it around the matching words when it's long."""
    if len(s) <= size:
        return s
    start = max(0, at - size // 3)
    if start:
        start = s.find(" ", start) + 1
    end = start + size
    body = s[start:end].rsplit(" ", 1)[0] if end < len(s) else s[start:]
    return ("…" if start else "") + body + ("…" if end < len(s) else "")


def for_application(db, app: dict, lot=None) -> dict:
    lot = lot if lot is not None else store.find_lot(db, app).lot
    rentals = store.site_rentals(db, app, lot)
    related = data_agent.related_applications(db, app)
    mentions = rental_mentions([app.get("description") or ""] + [r["description"] for r in related])
    return {
        "heritage": store.site_heritage(db, app, lot),
        "heritage_note": HERITAGE_NOTE,
        "rentals": rentals,
        "rental_units": sum(r["units"] or 0 for r in rentals),
        "rental_mentions": mentions,  # quoted from the application text (stated)
        "rental_rule": RENTAL_RULE if rentals or mentions else None,
        "rental_links": RENTAL_LINKS if rentals or mentions else [],
        "registry_note": REGISTRY_NOTE,
    }
