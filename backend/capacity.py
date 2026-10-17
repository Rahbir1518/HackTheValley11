"""Can the neighbourhood absorb it? Parks, transit and schools within walking distance,
before and after a proposal (or every active proposal nearby).

Everything that is not a count of mapped things is an estimate with its rule stated:
- residents today: each 2021 neighbourhood's population spread evenly over its area,
  clipped to the walking circle;
- new residents: homes stated in the application x the neighbourhood's average household
  size (proposals that state no homes are listed, not guessed);
- park space per resident: City Green Spaces (parks and public open space) inside the circle.
"""
import shapely
from shapely.geometry import Point

from .data import store

WALK_M = 500
SCHOOL_M = 1000
STATION_M = 1500
PARK_CLASSES = ("Park", "Open Green Space", "Civic Centre Square", "OTHER_CITY", "OTHER_TRCA")
PARK_RULE = ("Parks and public open space from the City's Green Spaces data (parks, civic squares, City and "
             "conservation-authority land); traffic islands, boulevards, cemeteries and golf courses are left out.")
_city: dict = {}


def _neighbourhoods(db, area: shapely.Geometry) -> list[dict]:
    minx, miny, maxx, maxy = area.bounds
    rows = db.execute(
        "SELECT n.id, n.name, n.geom, h.population, h.avg_household_size FROM neighbourhoods n "
        "JOIN neighbourhoods_idx i ON n.id = i.id LEFT JOIN nbhd_housing h ON h.id = n.id "
        "WHERE i.maxx >= ? AND i.minx <= ? AND i.maxy >= ? AND i.miny <= ?", (minx, maxx, miny, maxy)).fetchall()
    out = []
    for r in rows:
        g = shapely.from_wkb(r["geom"])
        if g.intersects(area):
            out.append({"id": r["id"], "name": r["name"], "geom": g, "population": r["population"],
                        "household_size": r["avg_household_size"]})
    return out


def _parks(db, area: shapely.Geometry) -> tuple[float, list[dict]]:
    minx, miny, maxx, maxy = area.bounds
    marks = ",".join("?" * len(PARK_CLASSES))
    rows = db.execute(
        f"SELECT g.name, g.geom FROM green_spaces g JOIN green_spaces_idx i ON g.id = i.id "
        f"WHERE i.maxx >= ? AND i.minx <= ? AND i.maxy >= ? AND i.miny <= ? AND g.area_class IN ({marks})",
        (minx, maxx, miny, maxy, *PARK_CLASSES)).fetchall()
    pieces, named = [], {}
    for r in rows:
        part = shapely.make_valid(shapely.from_wkb(r["geom"])).intersection(area)
        if part.area > 1:
            pieces.append(part)
            named[r["name"]] = named.get(r["name"], 0) + part.area
    total = shapely.union_all(pieces).area if pieces else 0.0  # overlapping polygons counted once
    top = sorted(named.items(), key=lambda kv: -kv[1])[:4]
    return total, [{"name": n, "area_m2": round(a)} for n, a in top]


def city_park_per_resident(db) -> float | None:
    """Toronto-wide park space per resident from the same data, for context (cached)."""
    if "value" not in _city:
        marks = ",".join("?" * len(PARK_CLASSES))
        geoms = [shapely.make_valid(shapely.from_wkb(r[0])) for r in
                 db.execute(f"SELECT geom FROM green_spaces WHERE area_class IN ({marks})", PARK_CLASSES)]
        people = db.execute("SELECT SUM(population) FROM nbhd_housing").fetchone()[0]
        _city["value"] = round(shapely.union_all(geoms).area / people, 1) if geoms and people else None
    return _city["value"]


def _routes(stop: dict) -> list[tuple[str, str]]:
    """[(route number, mode)] from the stored "504|streetcar,29|bus" list."""
    return [tuple(p.split("|", 1)) for p in stop["routes"].split(",") if "|" in p]


def _transit(db, centre: Point) -> dict:
    rows = store._points_near(db, "transit_stops", centre, STATION_M)
    for r in rows:
        r["distance_m"] = round(centre.distance(Point(r["x"], r["y"])))
    walk = [r for r in rows if r["distance_m"] <= WALK_M]
    surface: dict[str, set] = {}
    for r in walk:
        for number, mode in _routes(r):
            if mode in ("bus", "streetcar") and not (len(number) == 3 and number.startswith("3")):  # 3xx = overnight
                surface.setdefault(mode, set()).add(number)
    rapid = sorted((r for r in rows if {"subway", "lrt"} & set(r["modes"].split(","))), key=lambda r: r["distance_m"])
    station = None
    if rapid:
        s = rapid[0]
        lines = [(n, m) for n, m in _routes(s) if m in ("subway", "lrt")]
        station = {"name": s["name"].split(" - ")[0], "distance_m": s["distance_m"],
                   "mode": lines[0][1] if lines else "subway", "lines": [n for n, _ in lines]}
    return {"stops_within_walk": len(walk), "station": station,
            "routes": {m: sorted(v, key=lambda n: (len(n), n)) for m, v in surface.items()}}


def _schools(db, centre: Point) -> dict:
    rows = sorted(store._points_near(db, "schools", centre, SCHOOL_M), key=lambda r: r["distance_m"])
    rows = [r for r in rows if r["distance_m"] <= SCHOOL_M]
    by_type: dict[str, int] = {}
    for r in rows:
        by_type[r["type_desc"] or "Other"] = by_type.get(r["type_desc"] or "Other", 0) + 1
    return {"count": len(rows), "by_type": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
            "nearest": [{"name": r["name"], "type": r["type_desc"], "distance_m": round(r["distance_m"])}
                        for r in rows[:4]],
            "note": "Enrolment and capacity are not in the City's open data; ask the school boards (TDSB, TCDSB)."}


def analyse(db, centre_xy: tuple[float, float], proposals: list[dict]) -> dict:
    """`proposals`: [{"app_number", "address", "units" (stated or None), "x", "y"}] in EPSG:2952."""
    centre = Point(*centre_xy)
    circle = centre.buffer(WALK_M, quad_segs=32)
    nbhds = _neighbourhoods(db, circle)
    residents = sum((n["population"] or 0) * n["geom"].intersection(circle).area / n["geom"].area
                    for n in nbhds if n["geom"].area)

    counted, not_counted = [], []
    for p in proposals:
        if not p.get("units"):
            not_counted.append({"app_number": p["app_number"], "address": p["address"]})
            continue
        home = next((n for n in _neighbourhoods(db, Point(p["x"], p["y"]).buffer(1))), None)
        size = (home or {}).get("household_size") or 2.4
        counted.append({"app_number": p["app_number"], "address": p["address"], "units": p["units"],
                        "household_size": size, "residents": round(p["units"] * size),
                        "neighbourhood": (home or {}).get("name")})
    new = sum(c["residents"] for c in counted)

    park_m2, parks = _parks(db, circle)
    per_today = park_m2 / residents if residents else None
    per_with = park_m2 / (residents + new) if residents + new else None
    return {
        "radius_m": WALK_M,
        "residents_today": round(residents, -1),
        "neighbourhoods": [n["name"] for n in nbhds],
        "new_residents": new,
        "proposals_counted": counted,
        "proposals_not_counted": not_counted,
        "parks": {"area_m2": round(park_m2), "largest": parks,
                  "per_resident_today": round(per_today, 1) if per_today is not None else None,
                  "per_resident_with": round(per_with, 1) if per_with is not None else None,
                  "city_per_resident": city_park_per_resident(db), "rule": PARK_RULE},
        "transit": _transit(db, centre),
        "schools": _schools(db, centre),
        "rules": [
            "Residents today: 2021 Census population of each neighbourhood, spread evenly over its area, inside "
            f"a {WALK_M} m circle around the site (estimate).",
            "New residents: homes stated in each application x its neighbourhood's 2021 average household size "
            "(estimate); applications that state no homes are not counted.",
            "Straight-line distances, not walking routes.",
        ],
    }
