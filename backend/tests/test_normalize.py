from backend.data.normalize import normalize_street, parse_address, parse_street_num


def test_parse_address_long_forms():
    assert parse_address("135 liberty street, Toronto, ON") == (135, "LIBERTY ST")
    assert parse_address("100 Queen Street West") == (100, "QUEEN ST W")


def test_parse_address_needs_number():
    assert parse_address("Liberty Street") is None


def test_dev_app_and_address_point_forms_match():
    assert normalize_street("LIBERTY ST") == normalize_street("Liberty St")
    assert normalize_street("KING ST W") == normalize_street("King Street West")


def test_parse_street_num_ranges():
    assert parse_street_num("135") == (135, 135)
    assert parse_street_num("5250-5254") == (5250, 5254)
    assert parse_street_num("") is None
