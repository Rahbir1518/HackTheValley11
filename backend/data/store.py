"""Read-only queries over data/ordis.sqlite (built by scripts/ingest.py).

All x/y values are EPSG:2952 metres. `site_context` returns geometry already shifted
into a local frame centred on the lot, ready for a Blender build plan.
"""
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import shapely
from shapely.geometry import Point, mapping

from .normalize import parse_address, parse_street_num

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "ordis.sqlite"

# Application types we turn into massing models (rezoning + site plan).
MODELLED_TYPES = {"OZ", "SA"}
APP_TYPE_NAMES = {
    "OZ": "Official Plan / Zoning By-law Amendment",
    "SA": "Site Plan Approval",
    "CD": "Draft Plan of Condominium",
    "SB": "Draft Plan of Subdivision",
    "PL": "Part Lot Control Exemption",
}
# Statuses hidden unless the user asks for closed applications.
CLOSED_STATUS_RE = re.compile(r"closed|refused|withdrawn|cancel|inactive|appeal.*dismiss", re.I)


class DataError(LookupError):
    pass


@dataclass
class Address:
    query: str
    address_full: str
    x: float
    y: float
    lon: float
    lat: float
    ward_name: str | None
    exact: bool


@dataclass
class Site:
    application: dict
    lot: shapely.Geometry            # EPSG:2952
    origin: tuple[float, float]      # EPSG:2952 point mapped to local (0, 0)
    parcel_ids: list[int]
    notes: list[str] = field(default_factory=list)


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise DataError(f"{DB_PATH} not found; run scripts/ingest.py first")
    db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    db.row_factory = sqlite3.Row
    return db


# ------------------------------------------------------------------ geocoding

def geocode(db, text: str) -> Address:
    parsed = parse_address(text)
    if not parsed:
        raise DataError(f"could not read a house number and street from '{text}'")
    num, street = parsed
    cols = "address_full, x, y, lon, lat, ward_name"
    row = db.execute(f"SELECT {cols} FROM address_points WHERE street_norm=? AND lo_num=? LIMIT 1",
                     (street, num)).fetchone()
    exact = row is not None
    if row is None:  # same street, closest house number on the same side
        row = db.execute(
            f"SELECT {cols} FROM address_points WHERE street_norm=? AND lo_num % 2 = ? "
            "ORDER BY ABS(lo_num - ?) LIMIT 1", (street, num % 2, num)).fetchone()
    if row is None:  # street typed without a suffix, e.g. "135 Liberty"
        row = db.execute(
            f"SELECT {cols} FROM address_points WHERE street_norm LIKE ? AND lo_num=? LIMIT 1",
            (street + " %", num)).fetchone()
        exact = row is not None
    if row is None:
        raise DataError(f"no Toronto address point matches '{text}'")
    return Address(text, row["address_full"], row["x"], row["y"], row["lon"], row["lat"], row["ward_name"], exact)


# ------------------------------------------------------------------ applications

def _app_dict(row, origin=None) -> dict:
    d = dict(row)
    d["type_name"] = APP_TYPE_NAMES.get(d["app_type"], d["app_type"])
    d["modelled"] = d["app_type"] in MODELLED_TYPES
    d["closed"] = bool(CLOSED_STATUS_RE.search(d["status"] or ""))
    d["address"] = " ".join(filter(None, [d["street_num"], d["street_name"], d["street_type"], d["street_direction"]]))
    if origin and d["x"] is not None:
        d["distance_m"] = round(((d["x"] - origin[0]) ** 2 + (d["y"] - origin[1]) ** 2) ** 0.5, 1)
    return d


def nearby_applications(db, x: float, y: float, radius_m: float = 300, include_closed: bool = False) -> list[dict]:
    rows = db.execute(
        "SELECT a.* FROM dev_apps a JOIN dev_apps_idx i ON a.id = i.id "
        "WHERE i.minx >= ? AND i.maxx <= ? AND i.miny >= ? AND i.maxy <= ?",
        (x - radius_m, x + radius_m, y - radius_m, y + radius_m)).fetchall()
    apps = {}
    for row in rows:
        d = _app_dict(row, (x, y))
        if d["distance_m"] > radius_m or (d["closed"] and not include_closed):
            continue
        # One application can appear on several rows; keep the closest.
        key = d["app_number"]
        if key not in apps or d["distance_m"] < apps[key]["distance_m"]:
            apps[key] = d
    return sorted(apps.values(), key=lambda d: (d["distance_m"], d["app_number"]))


def get_application(db, app_number: str) -> dict:
    row = db.execute("SELECT * FROM dev_apps WHERE app_number=? AND x IS NOT NULL LIMIT 1", (app_number,)).fetchone()
    if row is None:
        raise DataError(f"application {app_number} not found or has no coordinates")
    return _app_dict(row)


def ward_summary(db, ward_name: str, include_closed: bool = False) -> dict:
    """Counts of applications in a ward by type and status (for the election-year ward panel)."""
    rows = db.execute("SELECT app_number, app_type, status, date_submitted FROM dev_apps WHERE ward_name=?",
                      (ward_name,)).fetchall()
    seen, by_type, by_status, recent = set(), {}, {}, 0
    for r in rows:
        if r["app_number"] in seen:
            continue
        seen.add(r["app_number"])
        closed = bool(CLOSED_STATUS_RE.search(r["status"] or ""))
        if closed and not include_closed:
            continue
        by_type[r["app_type"]] = by_type.get(r["app_type"], 0) + 1
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        if (r["date_submitted"] or "") >= "2024-01-01":
            recent += 1
    return {"ward_name": ward_name, "total": sum(by_type.values()), "submitted_since_2024": recent,
            "by_type": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
            "by_status": dict(sorted(by_status.items(), key=lambda kv: -kv[1]))}


# ------------------------------------------------------------------ geometry lookups

def _rtree_rows(db, table: str, minx, miny, maxx, maxy, cols: str):
    return db.execute(
        f"SELECT t.id, {cols} FROM {table} t JOIN {table}_idx i ON t.id = i.id "
        "WHERE i.maxx >= ? AND i.minx <= ? AND i.maxy >= ? AND i.miny <= ?",
        (minx, maxx, miny, maxy)).fetchall()


def _parcels_at(db, pt: Point) -> list:
    rows = _rtree_rows(db, "parcels", pt.x, pt.y, pt.x, pt.y, "parcel_id, feature_type, geom")
    return [(r["parcel_id"], shapely.from_wkb(r["geom"])) for r in rows
            if r["feature_type"] not in ("CORRIDOR", "RESERVE") and shapely.from_wkb(r["geom"]).covers(pt)]


def find_lot(db, app: dict) -> Site:
    """Lot = union of parcels under the application's address point(s)."""
    notes, points = [], []
    rng = parse_street_num(app["street_num"])
    if rng and app.get("street_norm"):
        lo, hi = rng
        for r in db.execute("SELECT x, y FROM address_points WHERE street_norm=? AND lo_num BETWEEN ? AND ?",
                            (app["street_norm"], lo, hi)):
            points.append(Point(r["x"], r["y"]))
    points.append(Point(app["x"], app["y"]))

    parcels = {}
    for pt in points:
        for pid, g in _parcels_at(db, pt):
            parcels[pid] = g
    if not parcels:  # point sits on a road/sidewalk: take the nearest parcel within 30 m
        pt = Point(app["x"], app["y"])
        rows = _rtree_rows(db, "parcels", pt.x - 30, pt.y - 30, pt.x + 30, pt.y + 30, "parcel_id, feature_type, geom")
        cands = [(r["parcel_id"], shapely.from_wkb(r["geom"])) for r in rows
                 if r["feature_type"] not in ("CORRIDOR", "RESERVE")]
        if not cands:
            raise DataError(f"no property boundary found near application {app['app_number']}")
        pid, g = min(cands, key=lambda c: c[1].distance(pt))
        parcels[pid] = g
        notes.append("Application point is not inside a parcel; used the nearest property boundary.")

    lot = shapely.union_all(list(parcels.values()))
    lot = lot.buffer(0.5, join_style="mitre").buffer(-0.5, join_style="mitre")  # close slivers between parcels
    if lot.geom_type == "MultiPolygon":
        lot = max(lot.geoms, key=lambda g: g.area)
        notes.append("Parcels are not contiguous; used the largest one as the site.")
    lot = shapely.Polygon(lot.exterior).simplify(0.2)
    if len(parcels) > 1:
        notes.append(f"Site assembled from {len(parcels)} property parcels.")
    c = lot.centroid
    origin = (round(c.x, 1), round(c.y, 1))
    return Site(app, lot, origin, sorted(parcels), notes)


def context_buildings(db, site: Site, radius_m: float = 250) -> list[dict]:
    """Existing buildings around the site, with on_site=True for ones standing on the lot."""
    ox, oy = site.origin
    rows = _rtree_rows(db, "buildings", ox - radius_m, oy - radius_m, ox + radius_m, oy + radius_m,
                       "height, height_src, geom")
    circle = Point(ox, oy).buffer(radius_m)
    out = []
    for r in rows:
        g = shapely.from_wkb(r["geom"])
        if not g.intersects(circle):
            continue
        on_site = g.intersection(site.lot).area > 0.5 * g.area
        out.append({"id": r["id"], "height": r["height"], "height_source": r["height_src"], "on_site": on_site, "geom": g})
    return sorted(out, key=lambda b: b["id"])


def context_parcels(db, site: Site, radius_m: float = 250) -> list[shapely.Geometry]:
    """Non-road parcels around the site (excluding the site itself), shrunk 0.4 m so
    neighbouring lots read as separate pads. Roads (CORRIDOR) are left as bare ground."""
    ox, oy = site.origin
    rows = _rtree_rows(db, "parcels", ox - radius_m, oy - radius_m, ox + radius_m, oy + radius_m,
                       "parcel_id, feature_type, geom")
    circle = Point(ox, oy).buffer(radius_m)
    out = []
    for r in sorted(rows, key=lambda r: r["id"]):
        if r["feature_type"] == "CORRIDOR" or r["parcel_id"] in site.parcel_ids:
            continue
        g = shapely.from_wkb(r["geom"])
        if not g.intersects(circle):
            continue
        g = _polygonal(g.difference(site.lot).buffer(-0.4, join_style="mitre"))
        if g is not None and not g.is_empty and g.area > 4:
            out.append(g.simplify(0.2))
    return out


def context_trees(db, site: Site, radius_m: float = 250) -> list[dict]:
    ox, oy = site.origin
    rows = db.execute(
        "SELECT t.id, t.dbh_cm, t.x, t.y FROM street_trees t JOIN street_trees_idx i ON t.id = i.id "
        "WHERE i.minx >= ? AND i.maxx <= ? AND i.miny >= ? AND i.maxy <= ? ORDER BY t.id",
        (ox - radius_m, ox + radius_m, oy - radius_m, oy + radius_m)).fetchall()
    return [{"x": round(r["x"] - ox, 2), "y": round(r["y"] - oy, 2), "dbh_cm": r["dbh_cm"]}
            for r in rows if (r["x"] - ox) ** 2 + (r["y"] - oy) ** 2 <= radius_m ** 2]


HOUSING_FIELDS = ("median_value", "median_rent", "median_owner_cost", "pct_owner_30", "pct_tenant_30",
                  "renter_share", "apartment_share")


def housing_context(db, x: float, y: float) -> dict | None:
    """2021 Census housing indicators for the neighbourhood containing (x, y), with how it
    compares to the 158 neighbourhoods (median across neighbourhoods and percentile rank)."""
    pt = Point(x, y)
    hit = None
    for r in _rtree_rows(db, "neighbourhoods", x, y, x, y, "name, geom"):
        if shapely.from_wkb(r["geom"]).covers(pt):
            hit = r["id"]
            break
    if hit is None:
        return None
    rows = [dict(r) for r in db.execute("SELECT * FROM nbhd_housing")]
    for r in rows:
        hh = r["households"] or 0
        r["renter_share"] = round(100 * r["renters"] / hh, 1) if hh and r["renters"] is not None else None
        r["apartment_share"] = round(100 * r["apartments_5plus"] / hh, 1) if hh and r["apartments_5plus"] else None
    me = next(r for r in rows if r["id"] == hit)
    compare = {}
    for f in HOUSING_FIELDS:
        values = sorted(r[f] for r in rows if r[f] is not None)
        if me[f] is None or not values:
            continue
        compare[f] = {
            "value": me[f],
            "median_of_neighbourhoods": values[len(values) // 2],
            "percentile": round(100 * sum(v < me[f] for v in values) / len(values)),
        }
    return {"neighbourhood": me["name"], "number": hit, "households": me["households"], "owners": me["owners"],
            "renters": me["renters"], "indicators": compare, "census_year": 2021, "neighbourhood_count": len(rows)}


# ------------------------------------------------------------------ local frame

def to_local(geom: shapely.Geometry, origin) -> shapely.Geometry:
    return shapely.transform(geom, lambda c: (c - origin).round(2))


def local_ring(polygon: shapely.Polygon, origin) -> list[list[float]]:
    coords = list(to_local(polygon, origin).exterior.coords)[:-1]
    return [[x, y] for x, y in coords]


def _polygonal(g: shapely.Geometry) -> shapely.Geometry | None:
    """make_valid can return GeometryCollections with stray lines; keep only the polygons."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    polys = [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
    return shapely.MultiPolygon(polys) if polys else None


def parcels_geojson(parcels: list[shapely.Geometry], origin) -> dict:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": mapping(to_local(g, origin))} for g in parcels]}


def context_geojson(buildings: list[dict], origin) -> dict:
    features = []
    for b in buildings:
        g = _polygonal(b["geom"])
        if g is None:
            continue
        features.append({
            "type": "Feature",
            "properties": {"height": b["height"], "height_source": b["height_source"],
                           "on_site": b["on_site"], "source_id": b["id"]},
            "geometry": mapping(to_local(g, origin)),
        })
    return {"type": "FeatureCollection", "features": features}


def sources(db) -> list[dict]:
    return [dict(r) for r in db.execute("SELECT * FROM sources ORDER BY key")]
