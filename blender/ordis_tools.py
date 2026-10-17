"""Blender tool layer for Ordis. Runs inside Blender (bpy).

Each public tool takes plain JSON-able arguments (local metres, x = east, y = north,
z = up) and raises ToolError with a readable message on bad input. A build plan is
just an ordered list of {"tool": name, "args": {...}} steps run through `run_step`.
Custom properties set here are exported as glTF `extras` for the web Inspector.
"""
import bmesh
import bpy

import ordis_geom as geom


class ToolError(ValueError):
    pass


# Linear-sRGB colours; the web viewer may restyle, but the glb should look right on its own.
ROLES = {
    "proposed": (0.95, 0.42, 0.11, 1.0),          # permit orange
    "existing": (0.80, 0.80, 0.78, 1.0),          # light concrete grey
    "existing_on_site": (0.55, 0.55, 0.55, 1.0),  # buildings the proposal replaces
    "lot": (0.10, 0.10, 0.10, 1.0),               # asphalt black
    "floor_lines": (0.05, 0.05, 0.05, 1.0),
}

# name -> {"footprint": ring, "z0": m, "top": m, "storeys": n, "storey_height": m}
_registry = {}


# ------------------------------------------------------------------ scene helpers

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _registry.clear()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _material(role):
    if role not in ROLES:
        raise ToolError(f"unknown role '{role}'; expected one of {sorted(ROLES)}")
    name = f"M_{role}"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = ROLES[role]
        bsdf.inputs["Roughness"].default_value = 0.8
        mat.diffuse_color = ROLES[role]
    return mat


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


def _prism_mesh(name, polygons, z0, height):
    """polygons: list of [shell, *holes] rings. Builds a closed extrusion with bmesh."""
    bm = bmesh.new()
    for rings in polygons:
        loops, fill_edges = [], []
        for ring in rings:
            verts = [bm.verts.new((x, y, z0)) for x, y in ring]
            loops.append(verts)
            fill_edges += [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
        bottom = [f for f in bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False,
                                                     edges=fill_edges, normal=(0, 0, 1))["geom"]
                  if isinstance(f, bmesh.types.BMFace)]
        top_of = {}
        for verts in loops:
            for v in verts:
                top_of[v] = bm.verts.new((v.co.x, v.co.y, z0 + height))
        for f in bottom:
            bm.faces.new([top_of[v] for v in f.verts])
        for verts in loops:
            for i in range(len(verts)):
                a, b = verts[i], verts[(i + 1) % len(verts)]
                bm.faces.new((a, b, top_of[b], top_of[a]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def _mass(name, footprint, z0, storeys, storey_height, role, parent, extra):
    height = storeys * storey_height
    obj = _link(bpy.data.objects.new(name, _prism_mesh(name, [[footprint]], z0, height)), parent)
    obj.data.materials.append(_material(role))
    _registry[name] = {"footprint": footprint, "z0": z0, "top": z0 + height,
                       "storeys": storeys, "storey_height": storey_height}
    obj["role"] = role
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


# ------------------------------------------------------------------ tools

def load_context_buildings(geojson):
    """GeoJSON FeatureCollection in local metres; each feature needs properties.height.
    properties.on_site = true marks buildings standing on the lot today (hidden in 'after')."""
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        raise ToolError("geojson must be a FeatureCollection")
    root = _empty("Existing Buildings")
    count = 0
    for i, feat in enumerate(geojson.get("features", [])):
        props, g = feat.get("properties") or {}, feat.get("geometry") or {}
        height = props.get("height")
        if not isinstance(height, (int, float)) or height <= 0:
            continue
        if g.get("type") == "Polygon":
            polys = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        try:
            rings = [[geom.clean_ring(r) for r in poly] for poly in polys]
        except geom.GeometryError:
            continue  # skip slivers in the source data rather than fail the whole scene
        on_site = bool(props.get("on_site"))
        role = "existing_on_site" if on_site else "existing"
        name = f"{'OnSite' if on_site else 'Existing'}_{i:04d}"
        obj = _link(bpy.data.objects.new(name, _prism_mesh(name, rings, 0.0, float(height))), root)
        obj.data.materials.append(_material(role))
        obj["role"] = role
        obj["height_m"] = round(float(height), 2)
        obj["on_site"] = on_site
        for key in ("height_source", "source_id"):
            if props.get(key) is not None:
                obj[key] = props[key]
        count += 1
    root["role"] = "group"
    root["count"] = count
    return {"created": count}


def create_lot(polygon, name="Lot"):
    ring = _ring(polygon, "polygon")
    obj = _link(bpy.data.objects.new(name, _prism_mesh(name, [[ring]], -0.05, 0.1)), _empty("Site"))
    obj.data.materials.append(_material("lot"))
    _registry[name] = {"footprint": ring, "z0": 0.0, "top": 0.0, "storeys": 0, "storey_height": 0}
    obj["role"] = "lot"
    obj["area_m2"] = round(geom.area(ring), 1)
    return {"name": name, "area_m2": obj["area_m2"]}


def create_podium(footprint, storeys, storey_height, name="Podium"):
    ring = _ring(footprint, "footprint")
    storeys = int(_positive(storeys, "storeys", 20))
    storey_height = _positive(storey_height, "storey_height", 8)
    obj = _mass(name, ring, 0.0, storeys, storey_height, "proposed", _empty("Proposed Building"),
                {"part": "podium"})
    return {"name": obj.name, "height_m": obj["height_m"], "footprint_area_m2": obj["footprint_area_m2"]}


def add_tower(storeys, storey_height, setback_m=0.0, base=None, footprint=None, name="Tower",
              tower_index=0, tower_count=1, separation_m=25.0, max_floorplate_m2=None):
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
    obj = _mass(name, ring, z0, storeys, storey_height, "proposed", _empty("Proposed Building"),
                {"part": "tower", "setback_m": float(setback_m), "base": base})
    return {"name": obj.name, "height_m": obj["height_m"], "top_elevation_m": obj["top_elevation_m"],
            "footprint_area_m2": obj["footprint_area_m2"]}


def add_floor_lines(target):
    """Loose-edge outlines at every storey of a podium/tower (exported as glTF lines)."""
    info = _registry.get(target)
    if not info or not info["storeys"]:
        raise ToolError(f"'{target}' is not a podium or tower")
    bm = bmesh.new()
    ring = info["footprint"]
    for k in range(1, info["storeys"]):
        z = info["z0"] + k * info["storey_height"]
        verts = [bm.verts.new((x, y, z)) for x, y in ring]
        for i in range(len(verts)):
            bm.edges.new((verts[i], verts[(i + 1) % len(verts)]))
    mesh = bpy.data.meshes.new(f"{target}_FloorLines")
    bm.to_mesh(mesh)
    bm.free()
    obj = _link(bpy.data.objects.new(mesh.name, mesh), bpy.data.objects[target])
    obj.data.materials.append(_material("floor_lines"))
    obj["role"] = "floor_lines"
    return {"name": obj.name, "lines": info["storeys"] - 1}


def set_material(target, role):
    obj = bpy.data.objects.get(target)
    if obj is None or obj.type != "MESH":
        raise ToolError(f"no mesh object named '{target}'")
    obj.data.materials.clear()
    obj.data.materials.append(_material(role))
    obj["role"] = role
    return {"name": target, "role": role}


def set_metadata(target, properties):
    """Attach JSON-able key/values (application id, status, ...) as glTF extras."""
    obj = bpy.data.objects.get(target) or _empty(target)
    if not isinstance(properties, dict):
        raise ToolError("properties must be an object")
    for k, v in properties.items():
        if isinstance(v, (list, dict)):
            import json
            v = json.dumps(v)
        if v is not None:
            obj[str(k)] = v
    return {"name": obj.name, "keys": sorted(properties)}


def export_glb(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True,
                              use_mesh_edges=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False)
    return {"path": path}


TOOLS = {f.__name__: f for f in (load_context_buildings, create_lot, create_podium, add_tower,
                                  add_floor_lines, set_material, set_metadata, export_glb)}


def run_step(step):
    tool = step.get("tool")
    if tool not in TOOLS:
        raise ToolError(f"unknown tool '{tool}'; available: {sorted(TOOLS)}")
    try:
        return TOOLS[tool](**(step.get("args") or {}))
    except TypeError as e:  # wrong/missing argument names
        raise ToolError(f"{tool}: {e}")
