"""From the street: the proposal drawn onto a real Google Street View photo (a photomontage).

For a built scene this finds a few Street View panoramas around the site (metadata lookups
are free), and for one of them works out the camera that frames the proposal (heading,
pitch, field of view) from the panorama's exact position. The photo is fetched once with
the server-side key and cached next to the scene; the browser renders the 3D model from the
same camera on top. Alignment is approximate (panorama positions are GPS, a few metres off),
and the viewer says so.

Needs GOOGLE_MAPS_API_KEY with the Street View Static API enabled (10,000 free photos a month).
"""
import json
import math
import os
from pathlib import Path

import httpx
from pyproj import Transformer

from . import sunlight

META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview"
WIDTH, HEIGHT = 640, 400  # Static API maximum is 640 px a side
CAMERA_HEIGHT_M = 2.5  # Street View camera above the road (approximate)
SEARCH_M = 60  # how far from each probe point a panorama may be
PROBE_M = 45  # probe points around the site, so several sides of the block are offered
MAX_VIEWS = 4
MIN_FOV, MAX_FOV = 25.0, 120.0
VERSION = 1


class StreetViewError(RuntimeError):
    pass


def api_key() -> str | None:
    return os.getenv("GOOGLE_MAPS_API_KEY") or None


_to_wgs = Transformer.from_crs(2952, 4326, always_xy=True)
_to_mtm = Transformer.from_crs(4326, 2952, always_xy=True)


# ------------------------------------------------------------------ camera maths (no network)

def _vertical_fov(hfov: float, aspect: float = WIDTH / HEIGHT) -> float:
    return math.degrees(2 * math.atan(math.tan(math.radians(hfov) / 2) / aspect))


def frame(camera_xy: tuple[float, float], masses: list[dict], eye: float = CAMERA_HEIGHT_M) -> dict:
    """Heading/pitch/fov (degrees; heading clockwise from north) that frame every mass, seen
    from `camera_xy` (local metres, x east, y north) at height `eye`."""
    cx, cy = camera_xy
    points = [(x, y, z) for m in masses for x, y in m["ring"] for z in (m["z0"], m["top"])]
    if not points:
        raise StreetViewError("this scene has no proposed building")
    mx = sum(p[0] for p in points) / len(points)
    my = sum(p[1] for p in points) / len(points)
    centre = math.degrees(math.atan2(mx - cx, my - cy))  # heading towards the middle of the proposal
    # Horizontal angles relative to that heading, and elevation angles.
    rel = [((math.degrees(math.atan2(x - cx, y - cy)) - centre + 180) % 360) - 180 for x, y, _ in points]
    elev = [math.degrees(math.atan2(z - eye, max(1.0, math.hypot(x - cx, y - cy)))) for x, y, z in points]
    heading = (centre + (max(rel) + min(rel)) / 2) % 360
    h_span = max(rel) - min(rel)
    pitch = max(-30.0, min(60.0, (max(elev) + min(elev)) / 2))
    v_span = max(abs(max(elev) - pitch), abs(min(elev) - pitch)) * 2
    # Horizontal fov that fits both spans with a margin; vertical fov follows from the aspect.
    need_h = h_span * 1.2
    need_v = v_span * 1.15
    hfov = need_h
    while _vertical_fov(hfov) < need_v and hfov < MAX_FOV:
        hfov += 1
    hfov = max(MIN_FOV, min(MAX_FOV, hfov))
    distance = math.hypot(mx - cx, my - cy)
    return {"heading": round(heading, 2), "pitch": round(pitch, 2), "fov": round(hfov, 1),
            "vfov": round(_vertical_fov(hfov), 2), "distance_m": round(distance),
            "fits": _vertical_fov(hfov) >= need_v - 0.5}


def _local(lat: float, lon: float, origin) -> tuple[float, float]:
    x, y = _to_mtm.transform(lon, lat)
    return round(x - origin[0], 2), round(y - origin[1], 2)


def _latlon(local_xy, origin) -> tuple[float, float]:
    lon, lat = _to_wgs.transform(local_xy[0] + origin[0], local_xy[1] + origin[1])
    return lat, lon


# ------------------------------------------------------------------ Google calls

def _metadata(client: httpx.Client, lat: float, lon: float, key: str) -> dict | None:
    r = client.get(META_URL, params={"location": f"{lat:.7f},{lon:.7f}", "radius": SEARCH_M,
                                     "source": "outdoor", "key": key}, timeout=20)
    r.raise_for_status()
    data = r.json()
    if data.get("status") == "OK":
        return data
    if data.get("status") in ("REQUEST_DENIED", "OVER_QUERY_LIMIT"):
        raise StreetViewError(f"Google Street View: {data.get('status')} {data.get('error_message', '')}".strip())
    return None  # ZERO_RESULTS / NOT_FOUND


def views(scene_dir: Path, origin, client: httpx.Client | None = None) -> list[dict]:
    """Up to MAX_VIEWS distinct panoramas around the site (cached in street/views.json)."""
    out_dir = scene_dir / "street"
    cache = out_dir / "views.json"
    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved.get("version") == VERSION:
            return saved["views"]
    key = api_key()
    if not key:
        raise StreetViewError("Set GOOGLE_MAPS_API_KEY (Street View Static API enabled) to see the street view.")
    plan = json.loads((scene_dir / "plan.json").read_text())
    masses = sunlight.proposal_masses(plan["steps"])
    probes = [(0.0, 0.0)] + [(PROBE_M * math.sin(math.radians(a)), PROBE_M * math.cos(math.radians(a)))
                             for a in (0, 90, 180, 270)]
    found: dict[str, dict] = {}
    with (client or httpx.Client()) as c:
        for probe in probes:
            meta = _metadata(c, *_latlon(probe, origin), key)
            if not meta or meta["pano_id"] in found:
                continue
            x, y = _local(meta["location"]["lat"], meta["location"]["lng"], origin)
            cam = frame((x, y), masses)
            found[meta["pano_id"]] = {"pano_id": meta["pano_id"], "lat": meta["location"]["lat"],
                                      "lon": meta["location"]["lng"], "x": x, "y": y,
                                      "date": meta.get("date"), "copyright": meta.get("copyright"), **cam}
    # Views that show the whole building first, then nearest; skip panoramas so close the camera
    # would sit inside it.
    result = sorted((v for v in found.values() if v["distance_m"] >= 12),
                    key=lambda v: (not v["fits"], v["distance_m"]))[:MAX_VIEWS]
    out_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"version": VERSION, "views": result}))
    return result


def photo(scene_dir: Path, view: dict, heading: float, client: httpx.Client | None = None) -> str:
    """Path (relative to the scene folder) of the cached photo for this view and heading."""
    name = f"{view['pano_id']}_{heading:.1f}_{view['pitch']:.1f}_{view['fov']:.1f}.jpg".replace("/", "_")
    path = scene_dir / "street" / name
    if not path.exists():
        key = api_key()
        if not key:
            raise StreetViewError("Set GOOGLE_MAPS_API_KEY to fetch Street View photos.")
        with (client or httpx.Client()) as c:
            r = c.get(IMAGE_URL, params={"size": f"{WIDTH}x{HEIGHT}", "pano": view["pano_id"], "heading": heading,
                                         "pitch": view["pitch"], "fov": view["fov"], "source": "outdoor",
                                         "return_error_code": "true", "key": key}, timeout=30)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            raise StreetViewError(f"Google Street View photo failed (HTTP {r.status_code}).")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    return f"street/{name}"
