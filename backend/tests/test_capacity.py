import math
import sqlite3
from pathlib import Path

import shapely
from shapely.geometry import box

from backend import capacity


def _db():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript((Path(__file__).parents[1] / "data" / "schema.sql").read_text())
    # One 2 km x 2 km neighbourhood of 10,000 people, 2.0 people per household.
    db.execute("INSERT INTO neighbourhoods VALUES (1, 'Testville', ?)", (shapely.to_wkb(box(-1000, -1000, 1000, 1000)),))
    db.execute("INSERT INTO neighbourhoods_idx VALUES (1, -1000, 1000, -1000, 1000)")
    db.execute("INSERT INTO nbhd_housing (id, name, population, avg_household_size) VALUES (1, 'Testville', 10000, 2.0)")
    # A 100 m x 100 m park inside the walk, and a traffic island that doesn't count.
    for i, (g, cls) in enumerate([(box(100, 100, 200, 200), "Park"), (box(-50, -50, -40, -40), "Traffic Island")]):
        db.execute("INSERT INTO green_spaces VALUES (?, ?, ?, ?)", (i, f"G{i}", cls, shapely.to_wkb(g)))
        b = g.bounds
        db.execute("INSERT INTO green_spaces_idx VALUES (?,?,?,?,?)", (i, b[0], b[2], b[1], b[3]))
    stops = [(0, "S1", "Test Station - Platform", "subway", "1|subway", 0, 300),
             (1, "S2", "Main St at First", "bus,streetcar", "31|bus,504|streetcar,301|streetcar", 100, 0)]
    db.executemany("INSERT INTO transit_stops VALUES (?,?,?,?,?,?,?)", stops)
    db.executemany("INSERT INTO transit_stops_idx VALUES (?,?,?,?,?)", ((s[0], s[5], s[5], s[6], s[6]) for s in stops))
    db.execute("INSERT INTO schools VALUES (0, 'Test Public School', 'English Public', 'TDSB', '1 School Rd', 0, 600)")
    db.execute("INSERT INTO schools_idx VALUES (0, 0, 0, 600, 600)")
    return db


def test_capacity_estimates_follow_their_stated_rules():
    capacity._city.clear()
    r = capacity.analyse(_db(), (0, 0), [{"app_number": "A", "address": "1 Test St", "units": 500, "x": 0, "y": 0},
                                         {"app_number": "B", "address": "2 Test St", "units": None, "x": 10, "y": 0}])
    circle = math.pi * 500 ** 2
    assert r["residents_today"] == round(10000 * circle / 4_000_000, -1)
    assert r["new_residents"] == 1000  # 500 homes stated x 2.0
    assert [p["address"] for p in r["proposals_not_counted"]] == ["2 Test St"]
    assert r["parks"]["area_m2"] == 10000  # the traffic island is left out
    assert math.isclose(r["parks"]["per_resident_with"], 10000 / (10000 * circle / 4_000_000 + 1000), abs_tol=0.05)
    assert r["parks"]["city_per_resident"] == 1.0
    t = r["transit"]
    assert t["station"]["lines"] == ["1"] and t["station"]["distance_m"] == 300
    assert t["routes"] == {"bus": ["31"], "streetcar": ["504"]}  # 301 is an overnight route
    assert r["schools"]["count"] == 1
