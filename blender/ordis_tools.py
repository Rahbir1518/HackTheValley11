"""Blender tool layer for Ordis. Runs inside Blender (bpy).

Each public tool takes plain JSON-able arguments (local metres, x = east, y = north,
z = up) and raises ToolError with a readable message on bad input. A build plan is
just an ordered list of {"tool": name, "args": {...}} steps run through `run_step`.
Custom properties set here are exported as glTF `extras` for the web Inspector.
"""
import json
import math

import bmesh
import bpy
from mathutils import Matrix

import ordis_geom as geom


class ToolError(ValueError):
    pass


# Facade textures: one tile = one window bay x one storey. Colours are sRGB.
FACADES = {
    # Light architectural palette from the Ordis design: soft grey-green city, blue-grey proposal.
    #                   frame                glass                slab band
    "existing":         ((0.93, 0.94, 0.92), (0.80, 0.83, 0.81), (0.87, 0.89, 0.87)),
    "existing_on_site": ((0.84, 0.86, 0.85), (0.70, 0.73, 0.72), (0.78, 0.80, 0.79)),
    "proposed":         ((0.80, 0.85, 0.90), (0.56, 0.65, 0.72), (0.70, 0.77, 0.83)),
}
# Flat materials (linear RGB for the Principled BSDF).
FLAT = {
    "roof_existing": (0.92, 0.93, 0.91, 1.0),
    "roof_existing_on_site": (0.70, 0.72, 0.71, 1.0),
    "roof_proposed": (0.66, 0.75, 0.84, 1.0),
    "lot": (0.70, 0.77, 0.83, 1.0),             # property boundary: pale blue pad
    "ground": (0.80, 0.84, 0.83, 1.0),          # streets: canvas grey-green (#EDF0EF)
    "parcel": (0.90, 0.91, 0.89, 1.0),          # lots / sidewalks a touch lighter
    "tree_trunk": (0.32, 0.30, 0.27, 1.0),
    "tree_crown": (0.35, 0.44, 0.33, 1.0),      # sage
    "floor_lines": (0.25, 0.33, 0.40, 1.0),
}
ROLES = set(FACADES) | {"lot", "floor_lines"}
TILE = 64  # facade texture resolution (px per bay/storey)

# name -> {"footprint": ring, "z0": m, "top": m, "storeys": n, "storey_height": m}
_registry = {}


# ------------------------------------------------------------------ scene helpers

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _registry.clear()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _facade_image(role):
    """Deterministic window-grid texture, packed so it is embedded in the .glb."""
    name = f"T_facade_{role}"
    img = bpy.data.images.get(name)
    if img:
        return img
    frame, glass, band = FACADES[role]
    curtain = role == "proposed"  # curtain wall: big glass, thin mullion
    px = []
    for row in range(TILE):           # rows run bottom -> top
        for col in range(TILE):
            if row < 6:
                c = band
            elif curtain:
                c = glass if (row >= 9 and 3 <= col < TILE - 3 and abs(col - TILE // 2) > 1) else frame
            else:
                c = glass if (14 <= row < TILE - 8 and 12 <= col < TILE - 12) else frame
            px.extend((*c, 1.0))
    img = bpy.data.images.new(name, TILE, TILE, alpha=False)
    img.pixels.foreach_set(px)
    img.file_format = "PNG"
    img.pack()
    return img


def _material(key):
    """key: a facade role (textured) or a FLAT key."""
    name = f"M_{key}"
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.85
    if key in FACADES:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = _facade_image(key)
        tex.interpolation = "Closest"
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if key == "proposed":
            bsdf.inputs["Roughness"].default_value = 0.45
        mat.diffuse_color = (*FACADES[key][0], 1.0)
    elif key in FLAT:
        bsdf.inputs["Base Color"].default_value = FLAT[key]
        mat.diffuse_color = FLAT[key]
    else:
        raise ToolError(f"unknown material '{key}'")
    return mat


def _assign(obj, *keys):
    for k in keys:
        obj.data.materials.append(_material(k))


def _empty(name, parent=None):
    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
    return obj


def _link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def _ring(coords, what):
    if not isinstance(coords, list) or len(coords) < 3:
        raise ToolError(f"{what} must be a list of at least 3 [x, y] points")
    try:
        return geom.clean_ring([(float(p[0]), float(p[1])) for p in coords])
    except (TypeError, IndexError, ValueError) as e:
        raise ToolError(f"{what} is not a valid polygon: {e}")


def _positive(value, what, maximum=None):
    if not isinstance(value, (int, float)) or value <= 0:
        raise ToolError(f"{what} must be a positive number, got {value!r}")
    if maximum is not None and value > maximum:
        raise ToolError(f"{what} = {value} exceeds the sanity limit {maximum}")
    return float(value)


def _add_prism(bm, uv, rings, z0, height, bay, storey):
    """Extrude one polygon (shell + holes) into bm. Walls get material 0 with UVs in
    bay/storey units (so the facade texture lines up with floors); caps get material 1."""
    loops, fill_edges = [], []
    for ring in rings:
        verts = [bm.verts.new((x, y, z0)) for x, y in ring]
        loops.append(verts)
        fill_edges += [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
    bottom = [f for f in bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False,
                                                 edges=fill_edges, normal=(0, 0, 1))["geom"]
              if isinstance(f, bmesh.types.BMFace)]
    top_of = {v: bm.verts.new((v.co.x, v.co.y, z0 + height)) for verts in loops for v in verts}
    for f in bottom:
        f.material_index = 1
        top = bm.faces.new([top_of[v] for v in f.verts])
        top.material_index = 1
        for face in (f, top):
            for loop in face.loops:
                loop[uv].uv = (loop.vert.co.x / 10.0, loop.vert.co.y / 10.0)
    for verts in loops:
        s = 0.0
        for i in range(len(verts)):
            a, b = verts[i], verts[(i + 1) % len(verts)]
            length = (b.co - a.co).length
            face = bm.faces.new((a, b, top_of[b], top_of[a]))
            face.material_index = 0
            u0, u1, v1 = s / bay, (s + length) / bay, height / storey
            for loop, coords in zip(face.loops, ((u0, 0.0), (u1, 0.0), (u1, v1), (u0, v1))):
                loop[uv].uv = coords
            s += length


def _prism_object(name, polygons, z0, height, materials, parent=None, bay=3.0, storey=3.5):
    """polygons: list of [shell, *holes] rings. One mesh object, closed, with UVs."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for rings in polygons:
        _add_prism(bm, uv, rings, z0, height, bay, storey)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = _link(bpy.data.objects.new(name, mesh), parent)
    _assign(obj, *materials)
    return obj


def _mass(name, footprint, z0, storeys, storey_height, parent, extra):
    height = storeys * storey_height
    obj = _prism_object(name, [[footprint]], z0, height, ("proposed", "roof_proposed"), parent,
                        bay=3.0, storey=storey_height)
    _registry[name] = {"footprint": footprint, "z0": z0, "top": z0 + height,
                       "storeys": storeys, "storey_height": storey_height}
    obj["role"] = "proposed"
    obj["storeys"] = storeys
    obj["storey_height_m"] = round(storey_height, 2)
    obj["height_m"] = round(height, 2)
    obj["base_elevation_m"] = round(z0, 2)
    obj["top_elevation_m"] = round(z0 + height, 2)
    obj["footprint_area_m2"] = round(geom.area(footprint), 1)
    for k, v in extra.items():
        if v is not None:
            obj[k] = v
    return obj


def _features(geojson, what):
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        raise ToolError(f"{what} must be a GeoJSON FeatureCollection")
    for i, feat in enumerate(geojson.get("features", [])):
        g = feat.get("geometry") or {}
        if g.get("type") == "Polygon":
            polys = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        try:
            polygons = [[geom.clean_ring(r) for r in poly] for poly in polys]
        except geom.GeometryError:
            continue  # skip slivers in the source data rather than fail the whole scene
        yield i, feat.get("properties") or {}, polygons  # [[shell, *holes], ...]


# ------------------------------------------------------------------ context tools

def create_ground(size_m=600.0):
    """Asphalt-coloured ground square centred on the site; streets show where no parcel is."""
    size = _positive(size_m, "size_m", 5000) / 2
    ring = [(-size, -size), (size, -size), (size, size), (-size, size)]
    obj = _prism_object("Ground", [[ring]], -0.3, 0.3, ("ground", "ground"))
    obj["role"] = "ground"
    return {"name": "Ground", "size_m": size * 2}


def load_context_parcels(geojson):
    """Neighbouring property parcels as low (0.15 m) pads, merged into one object."""
    polys = [poly for _, _, polygons in _features(geojson, "geojson") for poly in polygons]
    if not polys:
        return {"created": 0}
    obj = _prism_object("Parcels", polys, 0.0, 0.15, ("parcel", "parcel"), _empty("Context"))
    obj["role"] = "parcels"
    obj["count"] = len(polys)
    return {"created": len(polys)}


def load_context_buildings(geojson):
    """GeoJSON FeatureCollection in local metres; each feature needs properties.height.
    properties.on_site = true marks buildings standing on the lot today (hidden in 'after')."""
    root = _empty("Existing Buildings", _empty("Context"))
    count = 0
    for i, props, polygons in _features(geojson, "geojson"):
        height = props.get("height")
        if not isinstance(height, (int, float)) or height <= 0:
            continue
        on_site = bool(props.get("on_site"))
        role = "existing_on_site" if on_site else "existing"
        name = f"{'OnSite' if on_site else 'Existing'}_{i:04d}"
        obj = _prism_object(name, polygons, 0.0, float(height), (role, f"roof_{role}"), root,
                            bay=3.5, storey=3.5)
        obj["role"] = role
        obj["height_m"] = round(float(height), 2)
        obj["approx_storeys"] = max(1, round(float(height) / 3.5))
        obj["on_site"] = on_site
        for key in ("height_source", "source_id"):
            if props.get(key) is not None:
                obj[key] = props[key]
        count += 1
    root["role"] = "group"
    root["count"] = count
    return {"created": count}


def load_street_trees(trees):
    """trees: [{"x", "y", "dbh_cm"}] -> one low-poly mesh. Size is estimated from trunk diameter."""
    if not isinstance(trees, list):
        raise ToolError("trees must be a list of {x, y, dbh_cm}")
    bm = bmesh.new()
    n = 0
    for t in trees:
        try:
            x, y = float(t["x"]), float(t["y"])
        except (KeyError, TypeError, ValueError):
            continue
        dbh = min(max(float(t.get("dbh_cm") or 20), 5), 120)
        height = min(4.0 + 0.22 * dbh, 18.0)
        crown_r = min(1.4 + 0.07 * dbh, 6.0)
        trunk_h = height - crown_r * 1.2
        trunk = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.12 + dbh / 250,
                                      radius2=0.08 + dbh / 300, depth=trunk_h,
                                      matrix=Matrix.Translation((x, y, trunk_h / 2)))
        crown = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=crown_r,
                                           matrix=Matrix.Translation((x, y, height - crown_r))
                                           @ Matrix.Diagonal((1, 1, 0.85, 1)))
        for verts, idx in ((trunk["verts"], 0), (crown["verts"], 1)):
            for f in {f for v in verts for f in v.link_faces}:
                f.material_index = idx
        n += 1
    mesh = bpy.data.meshes.new("Street Trees")
    bm.to_mesh(mesh)
    bm.free()
    obj = _link(bpy.data.objects.new("Street Trees", mesh), _empty("Context"))
    _assign(obj, "tree_trunk", "tree_crown")
    obj["role"] = "trees"
    obj["count"] = n
    obj["note"] = "Tree sizes estimated from trunk diameter (City of Toronto Street Tree Data)"
    return {"created": n}


# ------------------------------------------------------------------ proposal tools

def create_lot(polygon, name="Lot"):
    ring = _ring(polygon, "polygon")
    obj = _prism_object(name, [[ring]], 0.0, 0.2, ("lot", "lot"), _empty("Site"))
    _registry[name] = {"footprint": ring, "z0": 0.0, "top": 0.0, "storeys": 0, "storey_height": 0}
    obj["role"] = "lot"
    obj["area_m2"] = round(geom.area(ring), 1)
    return {"name": name, "area_m2": obj["area_m2"]}


def create_podium(footprint, storeys, storey_height, name="Podium"):
    ring = _ring(footprint, "footprint")
    storeys = int(_positive(storeys, "storeys", 20))
    storey_height = _positive(storey_height, "storey_height", 8)
    obj = _mass(name, ring, 0.0, storeys, storey_height, _empty("Proposed Building"), {"part": "podium"})
    return {"name": obj.name, "height_m": obj["height_m"], "footprint_area_m2": obj["footprint_area_m2"]}


def add_tower(storeys, storey_height, setback_m=0.0, base=None, footprint=None, name="Tower",
              tower_index=0, tower_count=1, separation_m=25.0, max_floorplate_m2=None,
              mechanical_penthouse=True):
    """A tower on top of `base` (an earlier podium/lot name), inset by setback_m from its edge.
    Pass an explicit `footprint` to skip the automatic inset."""
    storeys = int(_positive(storeys, "storeys", 120))
    storey_height = _positive(storey_height, "storey_height", 8)
    if not isinstance(setback_m, (int, float)) or setback_m < 0:
        raise ToolError("setback_m must be >= 0")
    if base is not None and base not in _registry:
        raise ToolError(f"base '{base}' does not exist; create it first (known: {sorted(_registry)})")
    if name in _registry:
        raise ToolError(f"an object named '{name}' already exists")
    z0 = _registry[base]["top"] if base else 0.0
    if footprint is not None:
        ring = _ring(footprint, "footprint")
    elif base is not None:
        try:
            ring = geom.tower_footprint(_registry[base]["footprint"], float(setback_m), int(tower_index),
                                        int(tower_count), float(separation_m), max_floorplate_m2)
        except geom.GeometryError as e:
            raise ToolError(str(e))
    else:
        raise ToolError("add_tower needs either base or footprint")
    tower = _mass(name, ring, z0, storeys, storey_height, _empty("Proposed Building"),
                  {"part": "tower", "setback_m": float(setback_m), "base": base})
    result = {"name": tower.name, "height_m": tower["height_m"], "top_elevation_m": tower["top_elevation_m"],
              "footprint_area_m2": tower["footprint_area_m2"]}
    if mechanical_penthouse and storeys >= 6:
        # Rooftop mechanical room: typical of Toronto towers, purely illustrative.
        mph = geom.scale_about_centroid(ring, 0.55)
        obj = _prism_object(f"{name}_Penthouse", [[mph]], tower["top_elevation_m"], 5.0,
                            ("roof_proposed", "roof_proposed"), tower)
        obj["role"] = "proposed"
        obj["part"] = "mechanical penthouse (assumed, 5 m)"
        obj["height_m"] = 5.0
        result["penthouse"] = obj.name
    return result


def add_floor_lines(target):
    """Loose-edge outlines at every storey of a podium/tower (exported as glTF lines)."""
    info = _registry.get(target)
    if not info or not info["storeys"]:
        raise ToolError(f"'{target}' is not a podium or tower")
    bm = bmesh.new()
    ring = geom.scale_about_centroid(info["footprint"], 1.002)  # sit just outside the wall
    for k in range(1, info["storeys"]):
        z = info["z0"] + k * info["storey_height"]
        verts = [bm.verts.new((x, y, z)) for x, y in ring]
        for i in range(len(verts)):
            bm.edges.new((verts[i], verts[(i + 1) % len(verts)]))
    mesh = bpy.data.meshes.new(f"{target}_FloorLines")
    bm.to_mesh(mesh)
    bm.free()
    obj = _link(bpy.data.objects.new(mesh.name, mesh), bpy.data.objects[target])
    _assign(obj, "floor_lines")
    obj["role"] = "floor_lines"
    return {"name": obj.name, "lines": info["storeys"] - 1}


def set_material(target, role):
    obj = bpy.data.objects.get(target)
    if obj is None or obj.type != "MESH":
        raise ToolError(f"no mesh object named '{target}'")
    if role not in ROLES:
        raise ToolError(f"unknown role '{role}'; expected one of {sorted(ROLES)}")
    obj.data.materials.clear()
    if role in FACADES:
        _assign(obj, role, f"roof_{role}")
    else:
        _assign(obj, role)
    obj["role"] = role
    return {"name": target, "role": role}


def set_metadata(target, properties):
    """Attach JSON-able key/values (application id, status, ...) as glTF extras."""
    if not isinstance(properties, dict):
        raise ToolError("properties must be an object")
    obj = bpy.data.objects.get(target) or _empty(target)
    for k, v in properties.items():
        if isinstance(v, (list, dict)):
            v = json.dumps(v)
        if v is not None:
            obj[str(k)] = v
    return {"name": obj.name, "keys": sorted(properties)}


def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True,
                              use_mesh_edges=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False)
    return {"path": path}


TOOLS = {f.__name__: f for f in (create_ground, load_context_parcels, load_context_buildings, load_street_trees,
                                  create_lot, create_podium, add_tower, add_floor_lines, set_material,
                                  set_metadata, export_glb)}


def run_step(step):
    tool = step.get("tool")
    if tool not in TOOLS:
        raise ToolError(f"unknown tool '{tool}'; available: {sorted(TOOLS)}")
    try:
        return TOOLS[tool](**(step.get("args") or {}))
    except TypeError as e:  # wrong/missing argument names
        raise ToolError(f"{tool}: {e}")
