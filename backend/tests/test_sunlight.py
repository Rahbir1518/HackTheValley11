import datetime as dt
import math

from shapely.geometry import Point, box

from backend import sunlight


def test_solar_position_matches_reference():
    # suncalc gives altitude 31.0, azimuth 214.2 for Toronto at 2026-10-16 19:00 UTC (3 pm EDT)
    alt, az = sunlight.solar_position(dt.datetime(2026, 10, 16, 19, 0, tzinfo=dt.timezone.utc))
    assert math.isclose(alt, 31.0, abs_tol=0.5)
    assert math.isclose(az, 214.2, abs_tol=0.5)


def test_sun_steps_cover_daylight_only():
    steps = sunlight.sun_steps(dt.date(2026, 6, 21))
    assert all(alt >= sunlight.MIN_ALTITUDE_DEG for _, alt, _ in steps)
    assert 14 < len(steps) * sunlight.STEP_MIN / 60 < 16.5  # ~15 h of usable sun at the solstice


def test_box_shadow_points_away_from_sun():
    s = sunlight.Shadower([(box(0, 0, 10, 10), 10.0)])
    # Sun due south at 45 degrees: a 10 m tall box casts a shadow 10 m to the north.
    shadow = s.shadow(45.0, 180.0)
    assert math.isclose(shadow.area, 10 * 20, rel_tol=1e-6)
    assert shadow.covers(Point(5, 19.5)) and not shadow.covers(Point(5, -1))
    assert s.shades_point(5, 15, 45.0, 180.0)
    assert not s.shades_point(5, 25, 45.0, 180.0)


def test_clip_skips_buildings_that_cannot_reach():
    s = sunlight.Shadower([(box(0, 0, 10, 10), 10.0), (box(500, 500, 510, 510), 10.0)])
    clipped = s.shadow(45.0, 180.0, clip=(0, 0, 20, 30))
    assert math.isclose(clipped.area, 200, rel_tol=1e-6)


def _plan(on_site=False):
    feats = [{"type": "Feature", "properties": {"height": 6.0, "on_site": on_site},
              "geometry": {"type": "Polygon", "coordinates": [[[40, -5], [50, -5], [50, 5], [40, 5], [40, -5]]]}}]
    lot = [[-10, -10], [10, -10], [10, 10], [-10, 10]]
    return {"steps": [
        {"tool": "load_context_buildings", "args": {"geojson": {"type": "FeatureCollection", "features": feats}}},
        {"tool": "create_lot", "args": {"polygon": lot}},
        {"tool": "create_podium", "args": {"footprint": lot, "storeys": 10, "storey_height": 3.0}},
    ]}


def test_analysis_reports_lost_sun_north_of_a_new_building():
    res = sunlight.analyse(_plan(), dt.date(2026, 3, 21), radius=80)
    assert res["stats"]["max_hours_lost"] > 1
    w = res["stats"]["worst_point"]
    assert w["y"] > 10  # shade falls north of the 30 m block in Toronto
    assert w["sun_with_h"] < w["sun_today_h"]
