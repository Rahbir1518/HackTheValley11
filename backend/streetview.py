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
SEARCH_M = 50  # how far from each probe point a panorama may be
PROBE_RINGS_M = (30, 60)  # probe points on two rings around the site (8 directions each; lookups are free)
MAX_VIEWS = 4
MIN_SPREAD_DEG = 60  # different sides of the site
MIN_COMFORT_M = 35  # closer panoramas are offered after farther ones
MIN_FOV, MAX_FOV = 25.0, 120.0
VERSION = 5  # 2: Google imagery only, more probes, different sides; 3: exact "(c) Google"; 4: drop cropped close-ups; 5: close panoramas after farther ones


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


def is_google(meta: dict) -> bool:
    """Google's own Street View car/trekker imagery. User-uploaded photospheres (credited to a
    person, IDs like "CAoS...") have unreliable position, height and compass heading, so the
    model would not line up on them."""
    credit = "".join(ch for ch in (meta.get("copyright") or "").lower() if ch.isalpha())
    # Exactly "(c) Google": third-party tours such as "MIB360- Google Virtual Tours" don't count.
    return credit == "google" and not str(meta.get("pano_id", "")).startswith("CAoS")


def pick_views(candidates: list[dict], limit: int = MAX_VIEWS) -> list[dict]:
    """Whole building in frame first, then nearest; each further view from a different side of
    the site (at least MIN_SPREAD_DEG around from the ones already picked) when possible."""
    # Whole building in frame, then not right on top of it (too close reads as a wall), then nearest.
    ordered = sorted(candidates, key=lambda v: (not v["fits"], v["distance_m"] < MIN_COMFORT_M, v["distance_m"]))
    if sum(v["fits"] for v in ordered) >= 2:  # close-ups that crop the building only when nothing better exists
        ordered = [v for v in ordered if v["fits"]]
    picked: list[dict] = []
    for v in ordered:
        if all(abs((v["bearing"] - p["bearing"] + 180) % 360 - 180) >= MIN_SPREAD_DEG for p in picked):
            picked.append(v)
    for v in ordered:  # not enough sides covered: fill with the next best
        if len(picked) >= limit:
            break
        if v not in picked:
            picked.append(v)
    return picked[:limit]


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
    probes = [(0.0, 0.0)] + [(r * math.sin(math.radians(a)), r * math.cos(math.radians(a)))
                             for r in PROBE_RINGS_M for a in range(0, 360, 45)]
    found: dict[str, dict] = {}
    with (client or httpx.Client()) as c:
        for probe in probes:
            meta = _metadata(c, *_latlon(probe, origin), key)
            if not meta or meta["pano_id"] in found or not is_google(meta):
                continue
            x, y = _local(meta["location"]["lat"], meta["location"]["lng"], origin)
            cam = frame((x, y), masses)
            found[meta["pano_id"]] = {"pano_id": meta["pano_id"], "lat": meta["location"]["lat"],
                                      "lon": meta["location"]["lng"], "x": x, "y": y,
                                      "date": meta.get("date"), "copyright": meta.get("copyright"),
                                      "bearing": round(math.degrees(math.atan2(x, y)) % 360, 1), **cam}
    result = pick_views([v for v in found.values() if v["distance_m"] >= 12])
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
