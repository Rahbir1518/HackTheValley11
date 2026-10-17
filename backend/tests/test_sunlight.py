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


def test_proposal_masses_keep_base_heights():
    lot = [[-20, -20], [20, -20], [20, 20], [-20, 20]]
    masses = sunlight.proposal_masses([
        {"tool": "create_lot", "args": {"polygon": lot}},
        {"tool": "create_podium", "args": {"footprint": lot, "storeys": 4, "storey_height": 4.5}},
        {"tool": "add_tower", "args": {"name": "T", "base": "Podium", "storeys": 20, "storey_height": 3.0, "setback_m": 3}},
    ])
    assert [m["part"] for m in masses] == ["podium", "tower", "penthouse"]
    assert masses[1]["z0"] == 18.0 and masses[1]["top"] == 78.0
    assert masses[2]["z0"] == 78.0 and masses[2]["top"] == 83.0


def test_block_counts_every_proposal_and_replaced_buildings():
    single = sunlight.analyse(_plan(), dt.date(2026, 3, 21), radius=80)
    # A second 30 m block to the west, on a lot where the existing 6 m building (feature 0) stands.
    other = [[30, -30], [60, -30], [60, -10], [30, -10]]
    block = {"proposals": [{"masses": [{"ring": other, "z0": 0, "top": 30.0}], "replaces_features": [0]}]}
    both = sunlight.analyse(_plan(), dt.date(2026, 3, 21), radius=80, block=block)
    assert both["stats"]["area_lost_any_m2"] > single["stats"]["area_lost_any_m2"]
    # The replaced building's own shadow disappears, which shows up as sun gained.
    assert both["stats"]["area_gained_1h_m2"] > 0 == single["stats"]["area_gained_1h_m2"]


def test_shadower_ignores_line_parts_of_repaired_footprints():
    # make_valid on a bad City footprint can return a collection with stray lines (100 Queen St W).
    from shapely.geometry import GeometryCollection, LineString
    s = sunlight.Shadower([(GeometryCollection([box(0, 0, 10, 10), LineString([(20, 0), (30, 0)])]), 10.0),
                           (LineString([(40, 0), (50, 0)]), 10.0)])
    assert len(s.prisms) == 1
    assert math.isclose(s.shadow(45.0, 180.0).area, 200, rel_tol=1e-6)
