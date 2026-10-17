"""Address normalisation shared by ingestion and geocoding.

Both the Address Points dataset ("135 Liberty St", "100 Queen St W") and the
Development Applications dataset (STREET_NAME="LIBERTY", STREET_TYPE="ST")
are reduced to the same uppercase, abbreviated form so they can be joined.
"""
import re

# Long form -> abbreviation used by the City's address repository.
SUFFIXES = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "BOULEVARD": "BLVD",
    "DRIVE": "DR", "CRESCENT": "CRES", "COURT": "CRT", "PLACE": "PL",
    "TERRACE": "TER", "GARDENS": "GDNS", "SQUARE": "SQ", "PARKWAY": "PKWY",
    "TRAIL": "TRL", "CIRCLE": "CIR", "HEIGHTS": "HTS", "GATE": "GT",
    "LANE": "LANE", "HIGHWAY": "HWY", "EXPRESSWAY": "EXPY", "GROVE": "GRV",
}
DIRECTIONS = {"EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S"}

_ADDRESS_RE = re.compile(r"^\s*(\d+)\s*[A-Z]?\s+(.+)$")


def normalize_street(text: str) -> str:
    tokens = re.sub(r"[^A-Z0-9 ]", " ", (text or "").upper()).split()
    tokens = [SUFFIXES.get(t, DIRECTIONS.get(t, t)) for t in tokens]
    return " ".join(tokens)


def parse_address(text: str) -> tuple[int, str] | None:
    """'135 liberty street, Toronto' -> (135, 'LIBERTY ST'). None if no house number."""
    text = (text or "").upper().split(",")[0]
    for noise in (" TORONTO", " ON ", " ONTARIO", " CANADA"):
        text = text.replace(noise, " ")
    m = _ADDRESS_RE.match(text)
    if not m:
        return None
    return int(m.group(1)), normalize_street(m.group(2))


def parse_street_num(street_num: str) -> tuple[int, int] | None:
    """Dev-app STREET_NUM such as '135', '5250-5254' or '39 A' -> (lo, hi)."""
    nums = [int(n) for n in re.findall(r"\d+", street_num or "")]
    if not nums:
        return None
    return min(nums), max(nums)
