from backend import site_facts
from backend.data import store


def test_rental_mentions_quote_only_relevant_sentences():
    text = ("Site plan for a 47-storey building. This would result in the loss of 27 existing rental dwelling "
            "units that would be replaced in the new building. The remaining units are proposed to be retained. "
            "Parking is underground.")
    got = site_facts.rental_mentions([text])
    assert got == ["This would result in the loss of 27 existing rental dwelling units that would be replaced in "
                   "the new building.", "The remaining units are proposed to be retained."]
    assert site_facts.rental_mentions(["A 12-storey office building."]) == []


def test_same_address_matches_street_number_ranges():
    app = {"street_num": "240-260", "street_norm": "WELLESLEY ST E"}
    assert store._same_address(app, "260 Wellesley St E")
    assert not store._same_address(app, "262 Wellesley St E")
    assert not store._same_address(app, "250 Wellesley St W")


def test_long_sentences_are_excerpted_around_the_rental_words():
    s = "Site plan for " + "a building with many features, " * 20 + "including 27 rental units to be replaced on site."
    (got,) = site_facts.rental_mentions([s])
    assert got.startswith("…") and "27 rental units to be replaced" in got and len(got) <= 302


def test_repeated_long_sentences_are_quoted_once():
    s = "Rezoning for " + "a building with many features, " * 20 + "and 827 purpose-built rental dwelling units above."
    assert len(site_facts.rental_mentions([s, s])) == 1  # the same text in a related application
