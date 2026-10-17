import pytest
from pydantic import ValidationError

from backend.agents.spec import Extraction, SpecRejected, complete_spec


def extraction(**kw):
    base = dict(proposes_new_building=True, use_type="residential", confidence=0.9)
    return Extraction(**(base | kw))


def test_stated_tower_and_podium():
    spec = complete_spec(extraction(total_storeys=35, podium_storeys=6, towers=[{"storeys": 35}], units=420))
    assert spec.total_storeys == 35
    assert spec.podium_storeys == 6
    assert not spec.height_stated
    # 6 x 4.5 m podium + 29 x 3.0 m tower
    assert spec.height_m == pytest.approx(27 + 87)
    fields = {a.field for a in spec.assumptions}
    assert "towers[0].height_m" in fields and "tower_setback_m" in fields
    assert "podium_storeys" not in fields  # it was stated


def test_stated_height_is_kept_as_fact():
    spec = complete_spec(extraction(total_storeys=10, height_m=33.5))
    assert spec.height_m == 33.5 and spec.height_stated
    assert spec.towers == []
    assert spec.podium_storeys == 10  # single mid-rise mass


def test_tall_building_without_towers_gets_assumed_tower():
    spec = complete_spec(extraction(total_storeys=25))
    assert len(spec.towers) == 1
    assert any(a.field == "towers" for a in spec.assumptions)
    assert any(a.field == "podium_storeys" for a in spec.assumptions)


def test_height_only_derives_storeys():
    spec = complete_spec(extraction(height_m=30.0, use_type="office"))
    assert spec.total_storeys == 8  # 30 / 4.0 rounded
    assert any(a.field == "total_storeys" for a in spec.assumptions)


def test_rejects_non_building():
    with pytest.raises(SpecRejected):
        complete_spec(extraction(proposes_new_building=False, total_storeys=4))


def test_rejects_missing_height():
    with pytest.raises(SpecRejected):
        complete_spec(extraction(units=40))


def test_rejects_low_confidence():
    with pytest.raises(SpecRejected):
        complete_spec(extraction(total_storeys=12, confidence=0.2))


def test_tower_must_be_taller_than_podium():
    with pytest.raises(ValidationError):
        extraction(total_storeys=8, podium_storeys=8, towers=[{"storeys": 8}])


def test_storeys_out_of_range():
    with pytest.raises(ValidationError):
        extraction(total_storeys=500)
