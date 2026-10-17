import json
import math

import httpx
import pytest

from backend import streetview

TOWER = [{"ring": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "z0": 0.0, "top": 90.0}]


def test_frame_looks_at_the_proposal_and_fits_it():
    cam = streetview.frame((0, -60), TOWER)  # 60 m south of a 90 m tower
    assert cam["heading"] == pytest.approx(0, abs=0.5)  # north
    assert 20 < cam["pitch"] < 45  # looking up
    assert cam["fits"] and streetview.MIN_FOV <= cam["fov"] <= streetview.MAX_FOV
    east = streetview.frame((80, 0), TOWER)  # east of the tower: look west
    assert east["heading"] == pytest.approx(270, abs=0.5)
    # Vertical field of view covers the whole tower from the camera.
    top = math.degrees(math.atan2(90 - streetview.CAMERA_HEIGHT_M, 50))
    assert cam["pitch"] + cam["vfov"] / 2 >= top - 1


def _scene(tmp_path):
    lot = [[-10, -10], [10, -10], [10, 10], [-10, 10]]
    plan = {"steps": [{"tool": "create_lot", "args": {"polygon": lot}},
                      {"tool": "create_podium", "args": {"footprint": lot, "storeys": 20, "storey_height": 3.0}}]}
    (tmp_path / "plan.json").write_text(json.dumps(plan))
    return tmp_path


def test_views_dedupe_panoramas_cache_and_work_offline(tmp_path, monkeypatch):
    scene = _scene(tmp_path)
    origin = (313000.0, 4834000.0)
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/metadata"):
            lat, lon = map(float, request.url.params["location"].split(","))
            # Two panoramas: one for the south probe, one shared by the rest.
            south = lat < streetview._latlon((0, -20), origin)[0]
            pano = ("SOUTH", (0, -45)) if south else ("NORTH", (0, 40))
            plat, plon = streetview._latlon(pano[1], origin)
            return httpx.Response(200, json={"status": "OK", "pano_id": pano[0], "date": "2025-06",
                                             "location": {"lat": plat, "lng": plon}})
        return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})

    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    found = streetview.views(scene, origin, httpx.Client(transport=httpx.MockTransport(handler)))
    assert sorted(v["pano_id"] for v in found) == ["NORTH", "SOUTH"]
    north = next(v for v in found if v["pano_id"] == "NORTH")
    assert north["heading"] == pytest.approx(180, abs=1)  # north of the site: look south
    rel = streetview.photo(scene, north, north["heading"], httpx.Client(transport=httpx.MockTransport(handler)))
    assert (scene / rel).read_bytes().startswith(b"\xff\xd8")

    # Without a key (billing removed), cached views and photos still work; new ones explain why not.
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY")
    assert streetview.views(scene, origin) == found
    assert streetview.photo(scene, north, north["heading"]) == rel
    with pytest.raises(streetview.StreetViewError, match="GOOGLE_MAPS_API_KEY"):
        streetview.photo(scene, north, (north["heading"] + 20) % 360)
