"""Builder Agent: BuildingSpec + lot -> Blender tool calls.

The LLM chooses the proposal steps (podium, towers, floor lines, metadata) from a fixed
tool set. `validate_steps` simulates them with the same geometry code Blender uses, so a
bad call is rejected with a readable error and sent back to the model before Blender runs.
"""
import json
from typing import Any, Literal

import ordis_geom as geom
from pydantic import BaseModel, Field

from ..llm.structured import ask_model
from .spec import BuildingSpec

TOOL_DOCS = """Available tools (coordinates are local metres; the lot is referenced as "LOT"):
- create_podium(footprint="LOT", storeys:int 1-20, storey_height:float m, name="Podium")
    Base building filling the lot, from the ground up.
- add_tower(name:str, base:str, storeys:int, storey_height:float m, setback_m:float,
            tower_index:int=0, tower_count:int=1, separation_m:float=25, max_floorplate_m2:float|null)
    Tower sitting on top of `base` ("Podium" or "Lot"), inset `setback_m` from the base edge.
    `storeys` counts only the tower's own floors ABOVE its base. With several towers, use the
    same tower_count and a different tower_index (0..count-1) for each; they are spread along the
    lot's long side `separation_m` apart.
- add_floor_lines(target:str)   storey outlines on a podium or tower
- set_metadata(target:str, properties:object)   key/values shown in the viewer's Inspector
"""

ALLOWED_ARGS = {
    "create_podium": {"footprint", "storeys", "storey_height", "name"},
    "add_tower": {"name", "base", "storeys", "storey_height", "setback_m", "tower_index", "tower_count",
                  "separation_m", "max_floorplate_m2", "mechanical_penthouse"},
    "add_floor_lines": {"target"},
    "set_metadata": {"target", "properties"},
}


class BuildStep(BaseModel):
    tool: Literal["create_podium", "add_tower", "add_floor_lines", "set_metadata"]
    args: dict[str, Any]


class BuildPlanOut(BaseModel):
    reasoning: str = Field(description="One or two sentences on how the steps match the spec")
    steps: list[BuildStep]


def _num(args, key, lo, hi, step_i, errors, integer=False, default=None):
    v = args.get(key, default)
    if v is None or isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        errors.append(f"step {step_i}: {key} must be a number between {lo} and {hi}, got {v!r}")
        return None
    if integer and int(v) != v:
        errors.append(f"step {step_i}: {key} must be a whole number")
    return int(v) if integer else float(v)


def validate_steps(steps: list[dict], lot_ring, spec: BuildingSpec) -> list[dict]:
    """Return the steps with "LOT" resolved to coordinates, or raise ValueError listing every problem."""
    errors: list[str] = []
    registry = {"Lot": {"footprint": lot_ring, "top": 0.0, "storeys": 0}}
    out, towers = [], []
    for i, step in enumerate(steps):
        tool, args = step["tool"], dict(step.get("args") or {})
        unknown = set(args) - ALLOWED_ARGS[tool]
        if unknown:
            errors.append(f"step {i} ({tool}): unknown arguments {sorted(unknown)}")
            continue
        if tool == "create_podium":
            name = args.setdefault("name", "Podium")
            if args.get("footprint", "LOT") != "LOT":
                errors.append(f"step {i}: create_podium footprint must be \"LOT\"")
            args["footprint"] = [list(p) for p in lot_ring]
            s = _num(args, "storeys", 1, 20, i, errors, integer=True)
            h = _num(args, "storey_height", 2.5, 8, i, errors)
            if name in registry:
                errors.append(f"step {i}: name '{name}' already used")
            elif s and h:
                registry[name] = {"footprint": lot_ring, "top": s * h, "storeys": s}
        elif tool == "add_tower":
            name = args.get("name") or f"Tower_{len(towers) + 1}"
            args["name"] = name
            base = args.get("base")
            s = _num(args, "storeys", 1, 120, i, errors, integer=True)
            h = _num(args, "storey_height", 2.5, 8, i, errors)
            setback = _num(args, "setback_m", 0, 30, i, errors, default=0)
            idx = _num(args, "tower_index", 0, 9, i, errors, integer=True, default=0)
            count = _num(args, "tower_count", 1, 10, i, errors, integer=True, default=1)
            sep = _num(args, "separation_m", 0, 100, i, errors, default=25)
            cap = args.get("max_floorplate_m2")
            if base not in registry:
                errors.append(f"step {i}: base '{base}' does not exist yet (known: {sorted(registry)})")
            elif name in registry:
                errors.append(f"step {i}: name '{name}' already used")
            elif None not in (s, h, setback, idx, count, sep):
                try:
                    ring = geom.tower_footprint(registry[base]["footprint"], setback, idx, count, sep, cap)
                    registry[name] = {"footprint": ring, "top": registry[base]["top"] + s * h, "storeys": s}
                    towers.append(name)
                except geom.GeometryError as e:
                    errors.append(f"step {i} ({name}): {e}")
        elif tool == "add_floor_lines":
            target = args.get("target")
            if target not in registry or not registry[target]["storeys"]:
                errors.append(f"step {i}: add_floor_lines target '{target}' is not a podium or tower")
        elif tool == "set_metadata":
            if not isinstance(args.get("properties"), dict):
                errors.append(f"step {i}: set_metadata properties must be an object")
        out.append({"tool": tool, "args": args})

    if not errors:  # does the massing match the spec?
        if len(towers) != len(spec.towers):
            errors.append(f"spec has {len(spec.towers)} tower(s) but the plan builds {len(towers)}")
        top = max((v["top"] for v in registry.values()), default=0)
        if abs(top - spec.height_m) > max(3.0, 0.08 * spec.height_m):
            errors.append(f"plan reaches {top:.1f} m but the spec height is {spec.height_m} m")
    if errors:
        raise ValueError("; ".join(errors))
    return out


def fallback_steps(spec: BuildingSpec) -> list[dict]:
    """Rule-based plan straight from the spec, used if the model can't produce a valid plan."""
    steps = []
    base = "Lot"
    if spec.podium_storeys:
        steps.append({"tool": "create_podium", "args": {"footprint": "LOT", "storeys": spec.podium_storeys,
                                                        "storey_height": spec.podium_storey_height_m}})
        steps.append({"tool": "add_floor_lines", "args": {"target": "Podium"}})
        base = "Podium"
    podium_h = spec.podium_storeys * spec.podium_storey_height_m
    for i, t in enumerate(spec.towers):
        own = max(1, t.storeys - spec.podium_storeys)
        name = f"Tower_{chr(65 + i)}"
        steps.append({"tool": "add_tower", "args": {
            "name": name, "base": base, "storeys": own,
            "storey_height": round(max(2.5, min(8.0, (t.height_m - podium_h) / own)), 3),
            "setback_m": spec.tower_setback_m, "tower_index": i, "tower_count": len(spec.towers),
            "separation_m": 25, "max_floorplate_m2": spec.max_floorplate_m2}})
        steps.append({"tool": "add_floor_lines", "args": {"target": name}})
    return steps


def relax_separation(steps: list[dict], lot_ring, spec: BuildingSpec) -> list[dict]:
    """Fallback helper: shrink tower separation (25 -> 15 -> 10 m), then setback, until it fits."""
    last = None
    for sep, setback in ((25, None), (15, None), (10, None), (10, 1.5), (6, 0.0)):
        trial = json.loads(json.dumps(steps))
        for s in trial:
            if s["tool"] == "add_tower":
                s["args"]["separation_m"] = sep
                if setback is not None:
                    s["args"]["setback_m"] = setback
        try:
            return validate_steps(trial, lot_ring, spec)
        except ValueError as e:
            last = e
    raise last


SYSTEM = (
    "You are the Builder Agent of Ordis, a civic tool that shows residents a 3D massing model of a "
    "proposed building. You turn a validated building spec into calls to a fixed set of Blender tools. "
    "You never write code. Match the spec exactly: podium storeys and heights, one add_tower per tower, "
    "tower heights so that podium height + tower storeys x storey_height equals each tower's height_m. "
    "Add floor lines to every podium and tower. Use set_metadata to label each tower with its total "
    "storeys and height.")


async def plan_proposal(provider, spec: BuildingSpec, lot_ring, lot_info: dict, on_attempt=None):
    """Returns (resolved_steps, reasoning, used_fallback, fallback_reason)."""
    user = (f"{TOOL_DOCS}\nBuilding spec:\n{spec.model_dump_json(indent=1)}\n\n"
            f"Lot: {json.dumps(lot_info)}\n\nPlan the proposal steps.")
    resolved: dict = {}

    def check(plan: BuildPlanOut):
        resolved["steps"] = validate_steps([s.model_dump() for s in plan.steps], lot_ring, spec)

    try:
        plan = await ask_model(provider, SYSTEM, user, BuildPlanOut, on_attempt=on_attempt, extra_check=check)
        return resolved["steps"], plan.reasoning, False, None
    except Exception as e:  # LLM unavailable or never valid: rule-based plan, clearly labelled
        steps = relax_separation(fallback_steps(spec), lot_ring, spec)
        return steps, "Rule-based plan generated directly from the spec.", True, str(e)[:500]
