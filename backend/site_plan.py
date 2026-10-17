"""Manual (no-LLM) tools for checking the data layer and the Blender build.

    python -m backend.site_plan apps "135 Liberty St"              # list nearby applications
    python -m backend.site_plan plan "135 Liberty St" --app "21 250999 STE 10 SA" \
        --podium 3 --storeys 10 --setback 3 -o output/liberty_plan.json

`plan` writes a build plan with the real lot and real surrounding buildings plus a
massing you specify by hand. The Builder Agent produces the same plan format later.
"""
import argparse
import json
from pathlib import Path

from .data import store


def cmd_apps(args):
    db = store.connect()
    addr = store.geocode(db, args.address)
    print(f"{addr.address_full}  ({addr.lat:.5f}, {addr.lon:.5f})  ward: {addr.ward_name}"
          f"{'' if addr.exact else '  [nearest match]'}")
    apps = store.nearby_applications(db, addr.x, addr.y, args.radius, args.include_closed)
    for a in apps:
        flag = "3D" if a["modelled"] else "  "
        print(f"{a['distance_m']:6.0f} m  {flag}  {a['app_number']:<24} {a['status'] or '':<28} {a['address']}")
    if not apps:
        print(f"No development applications within {args.radius} m.")


def build_plan(db, app: dict, podium_storeys: int, storeys: int, setback: float,
               podium_storey_h: float = 4.5, storey_h: float = 3.1, radius: float = 250) -> dict:
    site = store.find_lot(db, app)
    buildings = store.context_buildings(db, site, radius)
    lot_ring = store.local_ring(site.lot, site.origin)
    steps = [
        {"tool": "load_context_buildings", "args": {"geojson": store.context_geojson(buildings, site.origin)}},
        {"tool": "create_lot", "args": {"polygon": lot_ring}},
    ]
    base = None
    if podium_storeys:
        steps.append({"tool": "create_podium", "args": {"footprint": lot_ring, "storeys": podium_storeys,
                                                         "storey_height": podium_storey_h}})
        base = "Podium"
    tower_storeys = storeys - podium_storeys
    if tower_storeys > 0:
        steps.append({"tool": "add_tower", "args": {"name": "Tower", "base": base or "Lot", "storeys": tower_storeys,
                                                    "storey_height": storey_h, "setback_m": setback}})
        steps.append({"tool": "add_floor_lines", "args": {"target": "Tower"}})
    return {
        "version": 1,
        "metadata": {"application_id": app["app_number"], "address": app["address"], "status": app["status"],
                     "application_url": app["application_url"], "origin_epsg2952": list(site.origin),
                     "parcel_ids": site.parcel_ids, "notes": site.notes},
        "steps": steps,
    }


def cmd_plan(args):
    db = store.connect()
    if args.app:
        app = store.get_application(db, args.app)
    else:
        addr = store.geocode(db, args.address)
        apps = [a for a in store.nearby_applications(db, addr.x, addr.y, 300) if a["modelled"]]
        if not apps:
            raise SystemExit("No OZ/SA application within 300 m; pass --app explicitly.")
        app = apps[0]
    plan = build_plan(db, app, args.podium, args.storeys, args.setback)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=1))
    n = len(plan["steps"][0]["args"]["geojson"]["features"])
    print(f"Wrote {out}: application {app['app_number']}, {n} context buildings, notes: {plan['metadata']['notes']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("apps")
    a.add_argument("address")
    a.add_argument("--radius", type=float, default=300)
    a.add_argument("--include-closed", action="store_true")
    p = sub.add_parser("plan")
    p.add_argument("address")
    p.add_argument("--app", help="APPLICATION# to use instead of the nearest OZ/SA")
    p.add_argument("--podium", type=int, default=0, help="podium storeys (0 = none)")
    p.add_argument("--storeys", type=int, required=True, help="total storeys")
    p.add_argument("--setback", type=float, default=3.0, help="tower setback from podium edge (m)")
    p.add_argument("-o", "--output", default="output/plan.json")
    args = ap.parse_args()
    {"apps": cmd_apps, "plan": cmd_plan}[args.cmd](args)


if __name__ == "__main__":
    main()
