"""Infill: applications that keep the existing buildings on their lot.

Many applications (often on rental tower sites) add new buildings beside towers that stay.
Modelling the new massing over the whole lot would erase homes the application keeps, so:

- the application text (and related applications for the site) is read for clear retention
  wording; heritage-facade retention doesn't count, since the rest of that building goes;
- buildings on the lot at least MIN_KEPT_HEIGHT_M tall are kept (lower ones, such as garages,
  pavilions or townhouses, are treated as replaced: a documented rule, not a fact);
- the new massing is placed on the largest free part of the lot, SEPARATION_M clear of them.
"""
import re

import shapely
from shapely.geometry import Polygon, box

VERSION = 1  # bump when these rules change (saved runs are then re-checked)
SEPARATION_M = 3.0
MIN_KEPT_HEIGHT_M = 12.0  # about 4 storeys
MIN_FREE_M2 = 250.0

RETAIN_RE = re.compile(
    r"\bretain(?:s|ed|ing)?\b|\bretention\b|\b(?:will|would|to|shall) (?:all )?remain\b|\binfill\b"
    r"|\b(?:adjacent to|beside|next to|to the (?:north|south|east|west) of|within the [\w ]{0,30}?(?:open space|area) of)"
    r" (?:the |an |a )?existing\b"
    r"|\bredevelop (?:certain |some )?portions? of\b", re.I)
EXCLUDE_RE = re.compile(r"fa[cç]ade|heritage", re.I)


def retention_evidence(texts: list[str]) -> str | None:
    """The first sentence saying existing buildings stay (quoted as stated), or None."""
    for text in texts:
        for sentence in re.split(r"(?<=[.;])\s+", text or ""):
            s = " ".join(sentence.split())
            if RETAIN_RE.search(s) and not EXCLUDE_RE.search(s):
                return s if len(s) <= 300 else s[:297].rsplit(" ", 1)[0] + "…"
    return None


def _without_holes(p: Polygon) -> Polygon:
    """Cut a strip through each hole (a kept building in the middle of the lot) and keep the
    largest piece, so the outline never runs around a building it must not cover."""
    while p.interiors:
        minx, miny, maxx, maxy = Polygon(p.interiors[0]).bounds
        x0, y0, x1, y1 = p.bounds
        options = [p.difference(box(minx, y0 - 1, maxx, y1 + 1)), p.difference(box(x0 - 1, miny, x1 + 1, maxy))]
        pieces = [g for o in options for g in shapely.get_parts(o) if g.geom_type == "Polygon"]
        if not pieces:
            return Polygon()
        p = max(pieces, key=lambda g: g.area)
    return p


def free_area(lot: shapely.Geometry, kept: list[shapely.Geometry]) -> Polygon | None:
    """Largest hole-free part of the lot at least SEPARATION_M from every kept building."""
    keep = shapely.union_all([g.buffer(SEPARATION_M, join_style="mitre") for g in kept])
    free = lot.difference(keep).buffer(-1.0, join_style="mitre").buffer(1.0, join_style="mitre")  # drop slivers
    parts = [_without_holes(p) for p in shapely.get_parts(free) if p.geom_type == "Polygon"]
    parts = [p for p in parts if not p.is_empty]
    if not parts:
        return None
    best = max(parts, key=lambda g: g.area).simplify(0.3)
    return best if best.area >= max(MIN_FREE_M2, 0.06 * lot.area) else None


def plan(texts: list[str], lot: shapely.Geometry, on_lot: list[dict]) -> dict | None:
    """`on_lot`: [{"id", "geom", "height"}] buildings standing on the lot (any frame, same as `lot`).
    None when the application doesn't say existing buildings stay; otherwise
    {"evidence", "fits", "kept": [ids], "replaced": [ids], "free": Polygon | None}."""
    evidence = retention_evidence(texts)
    kept = [b for b in on_lot if (b.get("height") or 0) >= MIN_KEPT_HEIGHT_M]
    if not evidence or not kept:
        return None
    free = free_area(lot, [b["geom"] for b in kept])
    return {"evidence": evidence, "fits": free is not None,
            "kept": [b["id"] for b in kept], "replaced": [b["id"] for b in on_lot if b not in kept],
            "free": free}


def note(p: dict) -> str:
    if p["fits"]:
        return (f"The application keeps the existing building(s) on the site (“{p['evidence']}”). "
                f"Existing buildings at least {MIN_KEPT_HEIGHT_M:.0f} m tall stay standing; the new massing is "
                f"placed on the largest free part of the lot ({p['free'].area:,.0f} m²), {SEPARATION_M:.0f} m "
                "clear of them. Lower buildings on the lot are shown as replaced.")
    return ("The application text says existing buildings stay, but too little of the lot is free to place the new "
            "massing beside them, so it is modelled on the whole lot.")
