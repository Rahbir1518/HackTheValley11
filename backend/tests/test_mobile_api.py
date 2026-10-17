import pytest
from fastapi import HTTPException

from backend.data import store


@pytest.fixture(autouse=True)
def _needs_data():
    if not store.DB_PATH.exists():
        pytest.skip("data/ordis.sqlite not built")


def test_nearby_finds_applications_around_a_point_in_toronto():
    from backend.main import nearby

    r = nearby(43.63758, -79.42332, 400)  # 135 Liberty St
    assert r["here"] == "135 Liberty St"
    assert r["applications"] and all(a["distance_m"] <= 400 for a in r["applications"])
    assert any(a["address"] == "151 Liberty St" for a in r["applications"])


def test_nearby_refuses_positions_outside_toronto():
    from backend.main import nearby

    with pytest.raises(HTTPException) as e:
        nearby(45.4215, -75.6972, 400)  # Ottawa
    assert e.value.status_code == 422
