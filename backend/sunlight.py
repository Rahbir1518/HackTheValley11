"""Hours of direct sunlight lost (or gained) at ground level because of a proposal.

For one day, every 15 minutes while the sun is up, each building's ground shadow is built
exactly as a 2D polygon (footprint + footprint moved along the shadow vector + the quads
swept by every edge). Comparing "with proposal" against "today" on a grid gives, per cell,
how many hours of direct sun change. Flat ground, ground level only, clear sky.
"""
import datetime as dt
import json
import math
import struct
import zlib
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import ordis_geom as geom
import shapely
from shapely.geometry import Polygon, shape

TORONTO = ZoneInfo("America/Toronto")
LAT, LON = 43.6535, -79.3841
STEP_MIN = 15
MIN_ALTITUDE_DEG = 3.0  # below this, shadows are hundreds of metres long and mostly noise
CELL_M = 2.5


# ------------------------------------------------------------------ sun

def solar_position(when: dt.datetime, lat: float = LAT, lon: float = LON) -> tuple[float, float]:
    """(altitude, azimuth) in degrees, azimuth clockwise from north. Low-precision solar
    ephemeris (accurate to a fraction of a degree), plenty for shadow studies."""
    when = when.astimezone(dt.timezone.utc)
    n = (when - dt.datetime(2000, 1, 1, 12, tzinfo=dt.timezone.utc)).total_seconds() / 86400
    mean_lon = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    ecl_lon = math.radians(mean_lon + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    ra = math.atan2(math.cos(eps) * math.sin(ecl_lon), math.cos(ecl_lon))
    dec = math.asin(math.sin(eps) * math.sin(ecl_lon))
    gmst_h = (18.697374558 + 24.06570982441908 * n) % 24
    ha = math.radians(gmst_h * 15 + lon) - ra
    la = math.radians(lat)
    alt = math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha))
    az = math.atan2(-math.sin(ha), math.tan(dec) * math.cos(la) - math.sin(la) * math.cos(ha))
    return math.degrees(alt), (math.degrees(az) + 360) % 360


def sun_steps(date: dt.date) -> list[tuple[dt.datetime, float, float]]:
    """(local time, altitude, azimuth) every STEP_MIN minutes while the sun is high enough."""
    out = []
    t = dt.datetime.combine(date, dt.time(0, 0), TORONTO)
    end = t + dt.timedelta(days=1)
    while t < end:
        alt, az = solar_position(t)
        if alt >= MIN_ALTITUDE_DEG:
            out.append((t, alt, az))
        t += dt.timedelta(minutes=STEP_MIN)
    return out


# ------------------------------------------------------------------ shadows

def _polygonal(g: shapely.Geometry) -> shapely.Geometry | None:
    """Only the polygon parts: make_valid can turn a bad City footprint into stray lines/points."""
    parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon") and not p.is_empty]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else shapely.union_all(parts)


class Shadower:
    """Precomputed edges for a set of (polygon, height) prisms; casts their union shadow."""

    def __init__(self, prisms: list[tuple[shapely.Geometry, float]]):
        prisms = [(_polygonal(g), h) for g, h in prisms]
        self.prisms = [(g, h) for g, h in prisms if h > 0 and g is not None and not g.is_empty]
        self.geoms = np.array([g for g, _ in self.prisms], dtype=object)
        self.heights = np.array([h for _, h in self.prisms], dtype=float)
        self.bounds = shapely.bounds(self.geoms) if len(self.geoms) else np.zeros((0, 4))
        p1, p2, owner = [], [], []
        for i, (g, _) in enumerate(self.prisms):
            for poly in getattr(g, "geoms", [g]):
                for ring in [poly.exterior, *poly.interiors]:
                    c = np.asarray(ring.coords)[:, :2]
                    p1.append(c[:-1])
                    p2.append(c[1:])
                    owner.append(np.full(len(c) - 1, i))
        self.p1 = np.concatenate(p1) if p1 else np.zeros((0, 2))
        self.p2 = np.concatenate(p2) if p2 else np.zeros((0, 2))
        self.owner = np.concatenate(owner) if owner else np.zeros(0, dtype=int)
        self.footprints = shapely.union_all(self.geoms) if len(self.geoms) else Polygon()

    @staticmethod
    def _unit(alt: float, az: float) -> np.ndarray:
        # Shadow points away from the sun: direction (-sin az, -cos az), length h / tan(alt) per metre.
        k = 1 / math.tan(math.radians(alt))
        return np.array([-math.sin(math.radians(az)), -math.cos(math.radians(az))]) * k

    def shadow(self, alt: float, az: float, clip: tuple | None = None) -> shapely.Geometry:
        """Union shadow; with `clip` (minx, miny, maxx, maxy) only buildings whose shadow can reach it."""
        if not self.prisms:
            return Polygon()
        unit = self._unit(alt, az)
        d = self.heights[:, None] * unit[None, :]
        keep = np.ones(len(self.prisms), dtype=bool)
        if clip is not None:
            b = self.bounds
            sminx = np.minimum(b[:, 0], b[:, 0] + d[:, 0])
            smaxx = np.maximum(b[:, 2], b[:, 2] + d[:, 0])
            sminy = np.minimum(b[:, 1], b[:, 1] + d[:, 1])
            smaxy = np.maximum(b[:, 3], b[:, 3] + d[:, 1])
            keep = (smaxx >= clip[0]) & (sminx <= clip[2]) & (smaxy >= clip[1]) & (sminy <= clip[3])
            if not keep.any():
                return Polygon()
        edges = keep[self.owner]
        de = d[self.owner[edges]]
        p1, p2 = self.p1[edges], self.p2[edges]
        polys = shapely.polygons(np.stack([p1, p2, p2 + de, p1 + de, p1], axis=1))
        polys = polys[shapely.area(polys) > 1e-6]
        idx = np.nonzero(keep)[0]
        moved = [shapely.affinity.translate(self.geoms[i], *d[i]) for i in idx]
        return shapely.union_all(np.concatenate([polys, np.array(moved, dtype=object), self.geoms[idx]]))

    def shades_point(self, x: float, y: float, alt: float, az: float) -> bool:
        """Exact test for one point: does the segment from it towards the sun hit a building?"""
        if not self.prisms:
            return False
        unit = self._unit(alt, az)
        lines = shapely.linestrings(np.stack([np.tile([x, y], (len(self.heights), 1)),
                                              np.array([x, y]) - self.heights[:, None] * unit], axis=1))
        return bool(shapely.intersects(self.geoms, lines).any())


# ------------------------------------------------------------------ scene -> prisms

def proposal_masses(steps: list[dict]) -> list[dict]:
    """Replays the proposal steps (same geometry code as Blender) into masses:
    {"ring", "z0", "top", "storeys", "part"} with the mechanical penthouse as its own mass."""
    reg: dict[str, dict] = {}
    out = []
    for s in steps:
        tool, a = s["tool"], s["args"]
        if tool == "create_lot":
            reg[a.get("name", "Lot")] = {"ring": geom.clean_ring(a["polygon"]), "top": 0.0}
        elif tool == "create_podium":
            ring = geom.clean_ring(a["footprint"])
            top = a["storeys"] * a["storey_height"]
            reg[a.get("name", "Podium")] = {"ring": ring, "top": top}
            out.append({"ring": ring, "z0": 0.0, "top": top, "storeys": a["storeys"], "part": "podium"})
        elif tool == "add_tower":
            base = reg.get(a.get("base"))
            if a.get("footprint"):
                ring = geom.clean_ring(a["footprint"])
            else:
                ring = geom.tower_footprint(base["ring"], a.get("setback_m", 0), a.get("tower_index", 0),
                                            a.get("tower_count", 1), a.get("separation_m", 25),
                                            a.get("max_floorplate_m2"))
            z0 = base["top"] if base else 0.0
            top = z0 + a["storeys"] * a["storey_height"]
            reg[a.get("name", "Tower")] = {"ring": ring, "top": top}
            out.append({"ring": ring, "z0": z0, "top": top, "storeys": a["storeys"], "part": "tower"})
            # The rooftop mechanical penthouse (5 m) is part of the massing too.
            if a.get("mechanical_penthouse", True) and a["storeys"] >= 6:
                out.append({"ring": geom.scale_about_centroid(ring, 0.55), "z0": top, "top": top + 5.0,
                            "storeys": 0, "part": "penthouse"})
    return out


def proposal_prisms(steps: list[dict]) -> list[tuple[shapely.Geometry, float]]:
    """Ground-to-top prisms of the proposal (shadows on flat ground only need the top)."""
    return [(Polygon(m["ring"]), m["top"]) for m in proposal_masses(steps)]


def context_prisms(steps: list[dict], also_on_site: frozenset[int] = frozenset()):
    """Existing buildings split into (elsewhere, standing on a proposal's lot), plus parcels.
    `also_on_site` holds feature indexes on other proposals' lots (the block view)."""
    existing, on_site, parcels = [], [], []
    for s in steps:
        if s["tool"] == "load_context_buildings":
            for i, f in enumerate(s["args"]["geojson"]["features"]):
                g = shapely.make_valid(shape(f["geometry"]))
                target = on_site if f["properties"].get("on_site") or i in also_on_site else existing
                target.append((g, float(f["properties"]["height"])))
        elif s["tool"] == "load_context_parcels":
            parcels = [shapely.make_valid(shape(f["geometry"])) for f in s["args"]["geojson"]["features"]]
    return existing, on_site, parcels


# ------------------------------------------------------------------ analysis

def analyse(plan: dict, date: dt.date, radius: float = 250.0, block: dict | None = None) -> dict:
    """With `block` (see backend.block), every nearby proposal counts as built and the
    buildings on their lots as removed, so the result is the combined sun loss."""
    also = frozenset(i for p in (block or {}).get("proposals", []) for i in p["replaces_features"])
    existing, on_site, parcels = context_prisms(plan["steps"], also)
    proposed = proposal_prisms(plan["steps"])
    for p in (block or {}).get("proposals", []):
        proposed += [(Polygon(m["ring"]), m["top"]) for m in p["masses"]]
    if not proposed:
        raise ValueError("this scene has no proposed building")
    E, O, P = Shadower(existing), Shadower(on_site), Shadower(proposed)

    xs = np.arange(-radius + CELL_M / 2, radius, CELL_M)
    gx, gy = np.meshgrid(xs, xs[::-1])  # row 0 = north
    inside = gx ** 2 + gy ** 2 <= radius ** 2
    # Ground only: skip cells under any building, today or proposed.
    roofs = shapely.union_all([E.footprints, O.footprints, P.footprints])
    shapely.prepare(roofs)
    ground = inside & ~shapely.contains_xy(roofs, gx, gy)

    lost = np.zeros(gx.shape)
    gained = np.zeros(gx.shape)
    steps = sun_steps(date)
    dt_h = STEP_MIN / 60
    for _, alt, az in steps:
        o, p = O.shadow(alt, az), P.shadow(alt, az)
        changed = shapely.union_all([o, p])
        if changed.is_empty:
            continue
        # Existing shadows only matter where the proposal's or the on-site building's shadow falls.
        e = E.shadow(alt, az, clip=changed.bounds)
        lost_poly = p.difference(shapely.union_all([e, o]))
        gained_poly = o.difference(shapely.union_all([e, p]))
        for poly, acc in ((lost_poly, lost), (gained_poly, gained)):
            if not poly.is_empty:
                minx, miny, maxx, maxy = poly.bounds
                win = (gx >= minx) & (gx <= maxx) & (gy >= miny) & (gy <= maxy)
                shapely.prepare(poly)
                acc[win] += shapely.contains_xy(poly, gx[win], gy[win]) * dt_h
    lost[~ground] = 0
    gained[~ground] = 0

    cell_area = CELL_M ** 2
    worst = np.unravel_index(np.argmax(lost), lost.shape)
    wx, wy = float(gx[worst]), float(gy[worst])
    sun_today_worst = sum(dt_h for _, alt, az in steps
                          if not (E.shades_point(wx, wy, alt, az) or O.shades_point(wx, wy, alt, az)))
    affected = []
    for i, parcel in enumerate(parcels):
        if parcel.is_empty:
            continue
        shapely.prepare(parcel)
        m = ground & shapely.contains_xy(parcel, gx, gy)
        if m.sum() < 4:
            continue
        mean_lost = float(lost[m].mean())
        if mean_lost >= 0.1:
            c = parcel.representative_point()
            affected.append({"index": i, "mean_hours_lost": round(mean_lost, 2),
                             "max_hours_lost": round(float(lost[m].max()), 2),
                             "area_m2": round(float(m.sum() * cell_area)), "x": c.x, "y": c.y})
    affected.sort(key=lambda a: -a["mean_hours_lost"])

    return {
        "date": date.isoformat(),
        "sunrise_steps": len(steps),
        "first": steps[0][0].strftime("%H:%M") if steps else None,
        "last": steps[-1][0].strftime("%H:%M") if steps else None,
        "lost": lost, "gained": gained,
        "stats": {
            "max_hours_lost": round(float(lost.max()), 2),
            "area_lost_1h_m2": round(float((lost >= 1).sum() * cell_area)),
            "area_lost_2h_m2": round(float((lost >= 2).sum() * cell_area)),
            "area_lost_any_m2": round(float((lost >= STEP_MIN / 60).sum() * cell_area)),
            "area_gained_1h_m2": round(float((gained >= 1).sum() * cell_area)),
            "worst_point": {"x": wx, "y": wy,
                            "sun_today_h": round(sun_today_worst, 2),
                            "sun_with_h": round(sun_today_worst - float(lost[worst]), 2)},
        },
        "affected_parcels": affected[:8],
        "extent_m": radius,
        "cell_m": CELL_M,
    }


# ------------------------------------------------------------------ image

def _png(rgba: np.ndarray) -> bytes:
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def heat_png(lost: np.ndarray, gained: np.ndarray) -> bytes:
    """Transparent where nothing changes; yellow -> deep red for sun lost (saturating at 4 h),
    teal where an existing on-site building's shadow disappears."""
    t = np.clip(lost / 4.0, 0, 1)
    rgba = np.zeros(lost.shape + (4,), dtype=np.uint8)
    on = lost >= STEP_MIN / 60 - 1e-9
    rgba[..., 0] = np.where(on, 255 - 40 * t, 0)
    rgba[..., 1] = np.where(on, 214 * (1 - t) ** 1.3 + 20 * t, 0)
    rgba[..., 2] = np.where(on, 60 * (1 - t), 0)
    rgba[..., 3] = np.where(on, 110 + 125 * t, 0)
    g = (gained >= STEP_MIN / 60 - 1e-9) & ~on
    rgba[g] = [40, 200, 190, 140]
    return _png(rgba)


def study_name(date: dt.date, block: dict | None = None) -> str:
    """File stem for a cached study: sun_<date>, or sun_block_<set>_<date> for the combined one."""
    return f"sun_block_{block['key']}_{date.isoformat()}" if block else f"sun_{date.isoformat()}"


def run(scene_dir: Path, date: dt.date, block: dict | None = None) -> dict:
    """Cached analysis for a built scene and date; writes <study_name>.png next to the scene."""
    name = study_name(date, block)
    out_json = scene_dir / f"{name}.json"
    if out_json.exists():
        return json.loads(out_json.read_text()) | {"cached": True}
    plan = json.loads((scene_dir / "plan.json").read_text())
    res = analyse(plan, date, block=block)
    (scene_dir / f"{name}.png").write_bytes(heat_png(res.pop("lost"), res.pop("gained")))
    res["application_id"] = plan.get("metadata", {}).get("application_id")
    if block:
        res["block"] = [p["app_number"] for p in block["proposals"]]
    out_json.write_text(json.dumps(res))
    return res
