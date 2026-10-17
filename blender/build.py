"""Headless build entry point.

    blender -b -P blender/build.py -- plan.json out.glb [--png out.png]

Prints one JSON line per step prefixed with ORDIS_STEP, and a final ORDIS_RESULT
line, so the backend can stream progress. Exit code 2 = a step failed validation.
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ordis_tools  # noqa: E402


def emit(tag, payload):
    print(f"{tag} {json.dumps(payload)}", flush=True)


def render_png(path):
    import math
    import bpy
    from mathutils import Vector
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000

    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    scene.world = world

    # Late-afternoon sun from the south-west so towers cast readable shadows.
    sun = bpy.data.objects.new("PreviewSun", bpy.data.lights.new("PreviewSun", "SUN"))
    sun.data.energy = 5.0
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-135))
    scene.collection.objects.link(sun)

    for o in scene.objects:  # preview shows the "after" state
        o.hide_render = o.get("role") == "existing_on_site"
    proposed = [o for o in scene.objects if o.get("role") == "proposed"] or [o for o in scene.objects if o.type == "MESH"]
    top = max((o.get("top_elevation_m", o.get("height_m", 10)) for o in proposed), default=30)
    cam = bpy.data.objects.new("RenderCamera", bpy.data.cameras.new("RenderCamera"))
    cam.data.lens = 35
    scene.collection.objects.link(cam)
    dist = max(170.0, top * 2.4)
    cam.location = Vector((dist * math.cos(math.radians(-55)), dist * math.sin(math.radians(-55)), dist * 0.6))
    direction = Vector((0, 0, top * 0.3)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 5000
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for obj in (cam, sun):
        bpy.data.objects.remove(obj)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    png = None
    if "--png" in argv:
        i = argv.index("--png")
        png = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if len(argv) != 2:
        print("usage: blender -b -P build.py -- plan.json out.glb [--png out.png]", file=sys.stderr)
        sys.exit(1)
    plan_path, out_path = argv
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)

    ordis_tools.reset_scene()
    for i, step in enumerate(plan.get("steps", [])):
        if step.get("tool") == "export_glb":
            continue  # the CLI decides the output path
        try:
            result = ordis_tools.run_step(step)
        except ordis_tools.ToolError as e:
            emit("ORDIS_RESULT", {"ok": False, "step": i, "tool": step.get("tool"), "error": str(e)})
            sys.exit(2)
        except Exception as e:  # bug in a tool, not bad input
            traceback.print_exc()
            emit("ORDIS_RESULT", {"ok": False, "step": i, "tool": step.get("tool"), "error": repr(e)})
            sys.exit(3)
        emit("ORDIS_STEP", {"step": i, "tool": step.get("tool"), "result": result})

    if plan.get("metadata"):
        ordis_tools.set_metadata("Proposed Building", plan["metadata"])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    ordis_tools.export_glb(os.path.abspath(out_path))
    if png:
        render_png(os.path.abspath(png))
    emit("ORDIS_RESULT", {"ok": True, "glb": os.path.abspath(out_path), "png": png and os.path.abspath(png)})


main()
