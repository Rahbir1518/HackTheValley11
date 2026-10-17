"""Pure-Python 2D polygon helpers shared by Blender (no shapely there) and the backend.

A ring is a list of (x, y) tuples in local metres, open (first point not repeated)
and counter-clockwise after `clean_ring`. Everything here is deterministic.
"""
import math

EPS = 1e-6


class GeometryError(ValueError):
    """Raised when a requested shape can't be built; the message is shown to the Builder Agent."""


# ------------------------------------------------------------------ basics

def signed_area(ring):
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += x1 * y2 - x2 * y1
    return a / 2.0


def area(ring):
    return abs(signed_area(ring))


def centroid(ring):
    a = signed_area(ring)
    if abs(a) < EPS:
        xs, ys = zip(*ring)
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return cx / (6 * a), cy / (6 * a)


def _collinear(a, b, c, tol=1e-9):
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < tol


def clean_ring(ring):
    """Drop closing/duplicate/collinear points and orient counter-clockwise."""
    pts = [(float(p[0]), float(p[1])) for p in ring]
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) < EPS:
        pts.pop()
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > EPS:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) < EPS:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(len(out)):
            if _collinear(out[i - 1], out[i], out[(i + 1) % len(out)]):
                out.pop(i)
                changed = True
                break
    if len(out) < 3 or area(out) < EPS:
        raise GeometryError("polygon has fewer than 3 distinct points or zero area")
    if signed_area(out) < 0:
        out.reverse()
    return out


def point_in_polygon(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside


def _segments_cross(p1, p2, p3, p4):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def is_simple(ring):
    n = len(ring)
    for i in range(n):
        a1, a2 = ring[i], ring[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # adjacent through the closing edge
            if _segments_cross(a1, a2, ring[j], ring[(j + 1) % n]):
                return False
    return True


# ------------------------------------------------------------------ inset

def _line_intersection(p1, d1, p2, d2):
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(cross) < 1e-12:
        return None
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross
    return p1[0] + t * d1[0], p1[1] + t * d1[1]


def inset_polygon(ring, distance):
    """Offset every edge of a CCW ring inward by `distance` metres (mitred corners)."""
    ring = clean_ring(ring)
    if distance <= 0:
        return ring
    n = len(ring)
    lines = []
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        nx, ny = -dy / length, dx / length  # left normal = inward for CCW
        lines.append(((x1 + nx * distance, y1 + ny * distance), (dx, dy)))
    out = []
    for i in range(n):
        prev, cur = lines[i - 1], lines[i]
        p = _line_intersection(prev[0], prev[1], cur[0], cur[1])
        out.append(p if p is not None else cur[0])
    # Validate: every edge keeps its direction, polygon is simple and inside the original.
    for i in range(n):
        new_edge = (out[(i + 1) % n][0] - out[i][0], out[(i + 1) % n][1] - out[i][1])
        if new_edge[0] * lines[i][1][0] + new_edge[1] * lines[i][1][1] <= 0:
            raise GeometryError(f"setback {distance} m collapses the footprint (edge {i} inverted)")
    if signed_area(out) <= 0 or not is_simple(out):
        raise GeometryError(f"setback {distance} m produces a self-intersecting footprint")
    if not all(point_in_polygon(p, ring) for p in out):
        raise GeometryError(f"setback {distance} m pushes the footprint outside its base")
    return clean_ring(out)


def simplify(ring, tolerance):
    """Douglas-Peucker on a closed ring (keeps the two farthest-apart anchor points)."""
    if tolerance <= 0 or len(ring) <= 4:
        return list(ring)

    def dp(pts):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        seg = math.hypot(x2 - x1, y2 - y1) or EPS
        best, idx = 0.0, 0
        for i in range(1, len(pts) - 1):
            d = abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / seg
            if d > best:
                best, idx = d, i
        if best <= tolerance:
            return [pts[0], pts[-1]]
        return dp(pts[: idx + 1])[:-1] + dp(pts[idx:])

    far = max(range(len(ring)), key=lambda i: math.dist(ring[0], ring[i]))
    a = dp(ring[: far + 1])
    b = dp(ring[far:] + ring[:1])
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else list(ring)


def inset_robust(ring, distance):
    """inset_polygon, retrying on progressively simplified outlines (real lots are noisy)."""
    last = None
    for tol in (0.0, 0.5, 1.0, 2.0):
        try:
            return inset_polygon(simplify(clean_ring(ring), tol), distance)
        except GeometryError as e:
            last = e
    raise last


# ------------------------------------------------------------------ rectangles / clipping

def convex_hull(points):
    pts = sorted(set((float(x), float(y)) for x, y in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_area_rect(ring):
    """Minimum-area oriented rectangle. Returns (centre, long_axis_unit, long_len, short_len)."""
    hull = convex_hull(ring)
    best = None
    for (x1, y1), (x2, y2) in zip(hull, hull[1:] + hull[:1]):
        length = math.hypot(x2 - x1, y2 - y1)
        if length < EPS:
            continue
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        us = [x * ux + y * uy for x, y in hull]
        vs = [-x * uy + y * ux for x, y in hull]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0] - EPS:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            centre = (cu * ux - cv * uy, cu * uy + cv * ux)
            best = (w * h, centre, (ux, uy), w, h)
    _, centre, (ux, uy), w, h = best
    if h > w:  # make the axis point along the long side
        ux, uy, w, h = -uy, ux, h, w
    return centre, (ux, uy), w, h


def rect_ring(centre, axis, length, width):
    (cx, cy), (ux, uy) = centre, axis
    vx, vy = -uy, ux
    hl, hw = length / 2, width / 2
    return clean_ring([
        (cx - ux * hl - vx * hw, cy - uy * hl - vy * hw),
        (cx + ux * hl - vx * hw, cy + uy * hl - vy * hw),
        (cx + ux * hl + vx * hw, cy + uy * hl + vy * hw),
        (cx - ux * hl + vx * hw, cy - uy * hl + vy * hw),
    ])


def clip_polygon(subject, clip):
    """Sutherland-Hodgman: clip any ring against a convex CCW ring."""
    out = list(subject)
    for c1, c2 in zip(clip, clip[1:] + clip[:1]):
        if not out:
            break

        def inside(p):
            return (c2[0] - c1[0]) * (p[1] - c1[1]) - (c2[1] - c1[1]) * (p[0] - c1[0]) >= -EPS

        def cut(p, q):
            d = (q[0] - p[0], q[1] - p[1])
            return _line_intersection(p, d, c1, (c2[0] - c1[0], c2[1] - c1[1])) or q
        src, out = out, []
        for i, cur in enumerate(src):
            prev = src[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cut(prev, cur))
    return out


def scale_about_centroid(ring, factor):
    cx, cy = centroid(ring)
    return [(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in ring]


# ------------------------------------------------------------------ towers

MIN_TOWER_AREA_M2 = 50.0


def tower_footprint(base, setback_m, tower_index=0, tower_count=1, separation_m=25.0, max_floorplate_m2=None):
    """Footprint for tower `tower_index` of `tower_count` sitting on `base`.

    The base is inset by `setback_m`; with several towers the inset is cut into equal
    slots along the base's long axis, `separation_m` apart. If `max_floorplate_m2` is
    given, the result is shrunk about its centroid to that area.
    """
    if not 0 <= tower_index < tower_count:
        raise GeometryError(f"tower_index {tower_index} out of range for tower_count {tower_count}")
    footprint = inset_robust(base, setback_m)
    if tower_count > 1:
        centre, axis, length, width = min_area_rect(footprint)
        slot = (length - separation_m * (tower_count - 1)) / tower_count
        if slot < 10.0:
            raise GeometryError(
                f"base is {length:.1f} m long: too short for {tower_count} towers {separation_m} m apart "
                "(reduce separation_m or tower_count)")
        offset = -length / 2 + slot / 2 + tower_index * (slot + separation_m)
        slot_centre = (centre[0] + axis[0] * offset, centre[1] + axis[1] * offset)
        footprint = clip_polygon(footprint, rect_ring(slot_centre, axis, slot, width + 2.0))
        if len(footprint) < 3:
            raise GeometryError(f"tower {tower_index} slot does not overlap the base")
        footprint = clean_ring(footprint)
    a = area(footprint)
    if a < MIN_TOWER_AREA_M2:
        raise GeometryError(f"tower footprint is only {a:.0f} m2 (< {MIN_TOWER_AREA_M2:.0f}); reduce setback_m")
    if max_floorplate_m2 and a > max_floorplate_m2:
        footprint = scale_about_centroid(footprint, math.sqrt(max_floorplate_m2 / a))
    return clean_ring(footprint)
