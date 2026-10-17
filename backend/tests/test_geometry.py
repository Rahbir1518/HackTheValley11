import math

import pytest

import ordis_geom as g

SQUARE = [(0, 0), (40, 0), (40, 40), (0, 40)]
L_SHAPE = [(0, 0), (60, 0), (60, 20), (20, 20), (20, 50), (0, 50)]


def test_clean_ring_orients_ccw_and_drops_duplicates():
    cw_closed = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
    ring = g.clean_ring(cw_closed)
    assert len(ring) == 4
    assert g.signed_area(ring) > 0


def test_clean_ring_removes_collinear_points():
    assert len(g.clean_ring([(0, 0), (5, 0), (10, 0), (10, 10), (0, 10)])) == 4


def test_clean_ring_rejects_degenerate():
    with pytest.raises(g.GeometryError):
        g.clean_ring([(0, 0), (1, 1), (2, 2)])


def test_inset_square():
    inset = g.inset_polygon(SQUARE, 5)
    assert math.isclose(g.area(inset), 30 * 30)
    assert all(g.point_in_polygon(p, SQUARE) for p in inset)


def test_inset_concave_l_shape():
    inset = g.inset_polygon(L_SHAPE, 3)
    assert g.area(inset) < g.area(L_SHAPE)
    assert g.is_simple(inset)


def test_inset_too_large_raises():
    with pytest.raises(g.GeometryError):
        g.inset_polygon(SQUARE, 25)


def test_inset_zero_is_identity():
    assert math.isclose(g.area(g.inset_polygon(SQUARE, 0)), 1600)


def test_min_area_rect_of_rotated_rectangle():
    a = math.radians(30)
    pts = [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a))
           for x, y in [(0, 0), (50, 0), (50, 20), (0, 20)]]
    _, axis, length, width = g.min_area_rect(pts)
    assert math.isclose(length, 50, abs_tol=1e-6)
    assert math.isclose(width, 20, abs_tol=1e-6)
    assert math.isclose(abs(axis[0]), math.cos(a), abs_tol=1e-6)


def test_clip_polygon_to_half():
    clipped = g.clip_polygon(SQUARE, g.clean_ring([(0, 0), (20, 0), (20, 40), (0, 40)]))
    assert math.isclose(g.area(clipped), 800)


def test_tower_footprint_single_with_floorplate_cap():
    fp = g.tower_footprint(SQUARE, 3, max_floorplate_m2=750)
    assert math.isclose(g.area(fp), 750, rel_tol=1e-6)


def test_two_towers_are_separated_and_inside_base():
    base = [(0, 0), (100, 0), (100, 30), (0, 30)]
    a = g.tower_footprint(base, 3, 0, 2, separation_m=25)
    b = g.tower_footprint(base, 3, 1, 2, separation_m=25)
    gap = min(bx for bx, _ in b) - max(ax for ax, _ in a)
    assert math.isclose(gap, 25, abs_tol=1e-6)
    for p in a + b:
        assert g.point_in_polygon(p, base)


def test_too_many_towers_raises_with_hint():
    with pytest.raises(g.GeometryError, match="reduce separation_m"):
        g.tower_footprint(SQUARE, 3, 0, 3, separation_m=25)


def test_tower_index_out_of_range():
    with pytest.raises(g.GeometryError):
        g.tower_footprint(SQUARE, 3, 2, 2)


def test_simplify_keeps_shape_of_noisy_square():
    noisy = [(0, 0), (20, 0.1), (40, 0), (40, 20), (39.9, 40), (0, 40)]
    simple = g.simplify(noisy, 0.5)
    assert len(simple) == 4
    assert math.isclose(g.area(simple), 1600, rel_tol=0.01)
