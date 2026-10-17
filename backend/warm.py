"""Pre-run demo addresses so they replay instantly in the viewer.

    python -m backend.warm                       # every address in demo_addresses.txt
    python -m backend.warm "135 Liberty St" "5250 Yonge St"
    python -m backend.warm --fresh               # ignore saved runs and redo them
    python -m backend.warm --street              # also cache Street View photos (needs GOOGLE_MAPS_API_KEY;
                                                 # cached photos keep working after the key is removed)
"""
import argparse
import asyncio
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from . import orchestrator

DEMO_FILE = Path(__file__).resolve().parents[1] / "demo_addresses.txt"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("addresses", nargs="*")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--street", action="store_true", help="cache Street View photos for each viewpoint")
    args = ap.parse_args()
    addresses = args.addresses or [
        line.strip() for line in DEMO_FILE.read_text().splitlines() if line.strip() and not line.startswith("#")]

    async def quiet(agent, kind, message, data):
        if kind in ("error", "stop", "warn", "retry"):
            print(f"    [{agent}] {kind}: {message[:160]}")

    for address in addresses:
        t0 = time.time()
        print(f"- {address}")
        try:
            r = await orchestrator.run(address, quiet, fresh=args.fresh)
        except Exception as e:
            print(f"    failed: {e!r}")
            continue
        state = "cached" if r.get("cached") else ("built" if r["ok"] else "no model")
        detail = (r.get("narration") or {}).get("headline") or r.get("message", "")
        print(f"    {state} in {time.time() - t0:.1f} s: {detail[:140]}")
        if args.street and r.get("ok") and r.get("scene_key"):
            warm_street(r)


def warm_street(result: dict, turns=(0,)):
    """Every viewpoint's photo (about 4 Street View requests per scene; free metadata lookups)."""
    from . import streetview

    scene_dir = orchestrator.CACHE / "scenes" / result["scene_key"]
    try:
        views = streetview.views(scene_dir, tuple(result["site"]["origin_epsg2952"]))
        for v in views:
            for turn in turns:
                streetview.photo(scene_dir, v, round((v["heading"] + turn) % 360, 1))
        print(f"    street: {len(views)} viewpoint(s) cached")
    except streetview.StreetViewError as e:
        print(f"    street: {e}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    load_dotenv()
    asyncio.run(main())
