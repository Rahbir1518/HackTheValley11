"""Run the full agent pipeline from the terminal (same code path as the web API).

    python -m backend.run "135 Liberty St"
    python -m backend.run "135 Liberty St" --app "21 160624 STE 10 OZ" --include-closed
"""
import argparse
import asyncio
import json
import sys

from dotenv import load_dotenv

from . import orchestrator

COLOURS = {"data": "36", "interpreter": "35", "builder": "33", "blender": "34", "narrator": "32", "system": "37"}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    ap.add_argument("--app")
    ap.add_argument("--include-closed", action="store_true")
    args = ap.parse_args()

    async def emit(agent, kind, message, data):
        print(f"\033[{COLOURS.get(agent, '37')}m[{agent:>11}] {kind:<9}\033[0m {message}")

    result = await orchestrator.run(args.address, emit, args.app, args.include_closed)
    print()
    if result["ok"]:
        print(result["narration"]["headline"])
        print(result["narration"]["summary"])
        print("Scene:", orchestrator.CACHE / "scenes" / result["scene_key"] / "scene.glb")
    else:
        print(result.get("message"))
    print(json.dumps({k: result.get(k) for k in ("ok", "scene_key", "seconds")}))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    load_dotenv()
    asyncio.run(main())
