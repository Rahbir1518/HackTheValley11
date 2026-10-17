from shapely.geometry import box

from backend import infill


def test_retention_wording():
    keeps = ["The two existing 17-storey apartment buildings will remain (461 rental units).",
             "The existing 12-storey residential building will be retained.",
             "Proposed 32-storey infill tower.",
             "The new building is proposed to be constructed to the west of the existing residential building.",
             "Rezoning application to redevelop certain portions of this large property with five new buildings."]
    goes = ["The Proposed Development will include the demolition and replacement of the existing 26 rental units.",
            "A 56-storey residential building, containing 532 dwelling units, including 55 rental replacement units.",
            "The heritage facade on King Street will be retained."]
    assert all(infill.retention_evidence([t]) for t in keeps)
    assert not any(infill.retention_evidence([t]) for t in goes)


def test_free_area_never_runs_around_a_kept_building():
    lot = box(0, 0, 100, 60)
    tower = box(40, 20, 60, 40)  # in the middle of the lot
    free = infill.free_area(lot, [tower])
    assert free is not None and not free.interiors
    assert not free.intersects(tower.buffer(infill.SEPARATION_M - 0.01))
    assert free.area > 1500


def test_plan_keeps_tall_buildings_and_replaces_low_ones():
    lot = box(0, 0, 120, 60)
    on_lot = [{"id": 1, "geom": box(5, 5, 35, 35), "height": 50.0},  # tower: kept
              {"id": 2, "geom": box(80, 10, 100, 20), "height": 4.0}]  # garage: replaced
    p = infill.plan(["The existing tower will be retained."], lot, on_lot)
    assert p["fits"] and p["kept"] == [1] and p["replaced"] == [2]
    assert infill.plan(["A new 30-storey tower."], lot, on_lot) is None
    # Nothing left beside the kept building: modelled on the whole lot, said so.
    crowded = infill.plan(["will be retained"], box(0, 0, 40, 40), [{"id": 1, "geom": box(2, 2, 38, 38), "height": 50}])
    assert crowded and not crowded["fits"] and "whole lot" in infill.note(crowded)
