"""Your block in 5 years: every active nearby proposal modelled together with the one on screen.

Change usually arrives in clusters, so this places each other active rezoning / site plan
application whose lot sits inside a built scene into that scene's local frame:

- one entry per lot (several applications for the same site are one proposal);
- the spec comes from the Interpreter cache, or the Interpreter Agent reads it once (cached);
  applications that can't be modelled honestly are listed with the reason, never guessed;
- the massing reuses the Builder Agent's plan when that proposal was already built, otherwise
  the documented rule-based plan from its spec (labelled as such);
- buildings standing on those lots today are listed so the viewer (and the combined sunlight
  study) can treat them as replaced.

Saved as block.json in the scene folder.
"""
import json
from pathlib import Path

import ordis_geom as geom
import shapely
from shapely.geometry import Polygon, shape

from . import orchestrator, sunlight
from .agents import builder, data_agent, interpreter
from .agents.spec import BuildingSpec, SpecRejected
from .data import store
from .llm.providers import LLMError, get_provider

SEARCH_RADIUS_M = 300
SCENE_RADIUS_M = orchestrator.CONTEXT_RADIUS_M  # a lot's centre must sit inside the modelled area
MAX_NEW_READS = 6  # Interpreter calls per request; free LLM tiers are small
VERSION = 2  # 2: rental homes and heritage on each lot


def _translate(steps: list[dict], dx: float, dy: float) -> list[dict]:
    """Move a plan's lot/footprint rings from its own frame into another scene's frame."""
    out = []
    for s in steps:
        args = dict(s["args"])
        for key in ("polygon", "footprint"):
            if isinstance(args.get(key), list):
                args[key] = [[round(x + dx, 2), round(y + dy, 2)] for x, y in args[key]]
        out.append({"tool": s["tool"], "args": args})
    return out


def _built_plan(app_number: str) -> dict | None:
    """The Builder Agent's plan from an earlier run of this application, if there is one."""
    plans = sorted((orchestrator.CACHE / "scenes").glob(f"{orchestrator._safe(app_number)}_*/plan.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for p in plans:
        if (p.parent / "scene.glb").exists():
            return json.loads(p.read_text())
    return None


def _cached_spec(app: dict, related: list[dict]) -> BuildingSpec | None:
    f = orchestrator.spec_cache_path(app, related)
    return BuildingSpec.model_validate(json.loads(f.read_text())["spec"]) if f.exists() else None


def _summary(spec: BuildingSpec) -> dict:
    return {
        "use_type": spec.use_type,
        "total_storeys": spec.total_storeys,
        "storeys_stated": not any(a.field == "total_storeys" for a in spec.assumptions),
        "towers": [t.storeys for t in spec.towers],
        "height_m": spec.height_m,
        "height_stated": spec.height_stated,
        "units": spec.units,
        "gfa_m2": spec.gfa_m2,
        "confidence": spec.confidence,
    }


def _context_features(plan: dict) -> list[tuple[int, shapely.Geometry, bool]]:
    for s in plan["steps"]:
        if s["tool"] == "load_context_buildings":
            return [(i, shapely.make_valid(shape(f["geometry"])), bool(f["properties"].get("on_site")))
                    for i, f in enumerate(s["args"]["geojson"]["features"])]
    return []


async def build(scene_dir: Path, fresh: bool = False, on_progress=None) -> dict:
    """Block data for a built scene. `on_progress(message)` is awaited before slow steps."""
    plan = json.loads((scene_dir / "plan.json").read_text())
    db = store.connect()
    main_app = store.get_application(db, plan["metadata"]["application_id"])
    main_site = store.find_lot(db, main_app)
    ox, oy = main_site.origin

    apps = [a for a in store.nearby_applications(db, ox, oy, SEARCH_RADIUS_M) if a["modelled"]]
    key = orchestrator._hash([sorted(a["app_number"] for a in apps), VERSION])
    out_file = scene_dir / "block.json"
    if not fresh and out_file.exists():
        saved = json.loads(out_file.read_text())
        if saved.get("candidates_key") == key:
            return saved | {"cached": True}

    # Group applications by lot; the main proposal's lot is already in the scene.
    sites: list[dict] = []  # {"site", "apps": [...]}
    skipped: list[dict] = []
    for a in apps:
        if a["app_number"] == main_app["app_number"]:
            continue
        try:
            site = store.find_lot(db, a)
        except store.DataError as e:
            skipped.append({"app_number": a["app_number"], "address": a["address"], "reason": str(e)})
            continue
        if site.lot.intersection(main_site.lot).area > 0.3 * min(site.lot.area, main_site.lot.area):
            continue  # another application for the site on screen
        c = site.lot.centroid
        if ((c.x - ox) ** 2 + (c.y - oy) ** 2) ** 0.5 > SCENE_RADIUS_M:
            skipped.append({"app_number": a["app_number"], "address": a["address"],
                            "reason": "Outside the area modelled around this proposal."})
            continue
        group = next((g for g in sites if site.lot.intersection(g["site"].lot).area
                      > 0.3 * min(site.lot.area, g["site"].lot.area)), None)
        if group:
            group["apps"].append(a)
        else:
            sites.append({"site": site, "apps": [a]})

    features = _context_features(plan)
    provider, reads, proposals = None, 0, []
    for g in sites:
        site = g["site"]
        # Prefer an application already read; otherwise the most recent one (latest numbers).
        candidates = sorted(g["apps"], key=lambda a: a.get("date_submitted") or "", reverse=True)
        chosen, spec, related = None, None, []
        for a in candidates:
            rel = data_agent.related_applications(db, a)
            s = _cached_spec(a, rel)
            if s:
                chosen, spec, related = a, s, rel
                break
        names = ", ".join(a["app_number"] for a in g["apps"])
        if spec is None:
            chosen = candidates[0]
            related = data_agent.related_applications(db, chosen)
            if reads >= MAX_NEW_READS:
                skipped.append({"app_number": names, "address": chosen["address"],
                                "reason": "Not read yet (limit per request); open the block view again to continue."})
                continue
            try:
                provider = provider or get_provider()
                if on_progress:
                    await on_progress(f"Reading {chosen['address']} ({chosen['app_number']})")
                reads += 1
                extraction, spec = await interpreter.interpret(provider, chosen, related)
                f = orchestrator.spec_cache_path(chosen, related)
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps({"extraction": extraction.model_dump(), "spec": spec.model_dump()}, indent=1))
            except SpecRejected as e:
                skipped.append({"app_number": names, "address": chosen["address"], "reason": str(e)})
                continue
            except LLMError as e:
                skipped.append({"app_number": names, "address": chosen["address"],
                                "reason": f"Could not be read right now ({str(e)[:120]})."})
                continue

        # Massing in the main scene's frame.
        lot_ring = geom.clean_ring(store.local_ring(site.lot, main_site.origin))
        built = _built_plan(chosen["app_number"])
        try:
            if built:
                bx, by = built["metadata"].get("origin_epsg2952") or store.find_lot(db, chosen).origin
                steps = _translate([s for s in built["steps"] if s["tool"] in
                                    ("create_lot", "create_podium", "add_tower")], bx - ox, by - oy)
                massing = "builder"
            else:
                steps = [{"tool": "create_lot", "args": {"polygon": lot_ring}}] + \
                    builder.relax_separation(builder.fallback_steps(spec), lot_ring, spec)
                massing = "rules"
            masses = sunlight.proposal_masses(steps)
        except (ValueError, geom.GeometryError) as e:
            skipped.append({"app_number": names, "address": chosen["address"],
                            "reason": f"The stated massing does not fit the lot ({str(e)[:120]})."})
            continue
        if not masses:
            continue

        lot_poly = Polygon(lot_ring)
        replaces = [i for i, gm, on_main in features
                    if not on_main and gm.area > 0 and gm.intersection(lot_poly).area > 0.5 * gm.area]
        c = site.lot.centroid
        proposals.append({
            "app_number": chosen["app_number"],
            "related": [a["app_number"] for a in g["apps"] if a is not chosen],
            "address": chosen["address"],
            "status": chosen["status"],
            "type_name": chosen["type_name"],
            "date_submitted": (chosen.get("date_submitted") or "")[:10] or None,
            "application_url": chosen["application_url"],
            "distance_m": round(((c.x - ox) ** 2 + (c.y - oy) ** 2) ** 0.5),
            "spec": _summary(spec),
            "massing": massing,
            "masses": [{"ring": [[round(x, 2), round(y, 2)] for x, y in m["ring"]], "z0": round(m["z0"], 2),
                        "top": round(m["top"], 2), "storeys": m["storeys"], "part": m["part"]} for m in masses],
            "replaces_features": replaces,
            # What stands on the lot today (registers, not a demolition notice).
            "rental_units": sum(r["units"] or 0 for r in store.site_rentals(db, chosen, site.lot)),
            "heritage": [h["status_label"] for h in store.site_heritage(db, chosen, site.lot)["on_site"]],
            "replaces": [f"Existing_{i:04d}" for i in replaces],
        })

    proposals.sort(key=lambda p: p["distance_m"])
    result = {
        "version": VERSION,
        "candidates_key": key,
        "main": main_app["app_number"],
        "main_rental_units": sum(r["units"] or 0 for r in store.site_rentals(db, main_app, main_site.lot)),
        "radius_m": SEARCH_RADIUS_M,
        "proposals": proposals,
        "skipped": skipped,
        # Identifies this exact set of proposals for the combined sunlight study cache.
        "key": orchestrator._hash([[p["app_number"], p["masses"]] for p in proposals]),
        "limitations": [
            "Shows every active application nearby as if built. Approval, timing and final designs are unknown.",
            "Other proposals use the Builder Agent's plan if Ordis has built them before, otherwise a "
            "rule-based massing from the stated numbers.",
            "Closed, refused and withdrawn applications are left out.",
        ],
    }
    out_file.write_text(json.dumps(result))
    return result
