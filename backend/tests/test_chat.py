import pytest

from backend import chat
from backend.data import store


@pytest.fixture(scope="module")
def db():
    try:
        return store.connect()
    except store.DataError:
        pytest.skip("data/ordis.sqlite not built")


def test_finds_address_inside_a_sentence(db):
    a = chat.find_address(db, "Hey, can you bring up proposals near 135 liberty street please?")
    assert a is not None and a.address_full == "135 Liberty St"


def test_ignores_numbers_that_are_not_addresses(db):
    assert chat.find_address(db, "What changed in 2024 for 3 storey buildings?") is None


def test_unknown_street_is_recognised_as_an_address_attempt():
    assert chat.looks_like_address("proposals near 1 Nowhere Lane") == "1 Nowhere Lane"
    assert chat.looks_like_address("what does a rezoning application mean?") is None
