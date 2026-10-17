from backend import block


def test_translate_moves_rings_into_the_other_frame():
    steps = [
        {"tool": "create_lot", "args": {"polygon": [[0, 0], [10, 0], [10, 10]]}},
        {"tool": "create_podium", "args": {"footprint": [[0, 0], [10, 0], [10, 10]], "storeys": 3, "storey_height": 4}},
        {"tool": "add_tower", "args": {"name": "T", "base": "Podium", "storeys": 10, "storey_height": 3}},
    ]
    moved = block._translate(steps, 100.0, -50.0)
    assert moved[0]["args"]["polygon"][1] == [110.0, -50.0]
    assert moved[1]["args"]["footprint"][2] == [110.0, -40.0]
    assert moved[2]["args"] == steps[2]["args"]
    assert steps[0]["args"]["polygon"][1] == [10, 0]  # input untouched
