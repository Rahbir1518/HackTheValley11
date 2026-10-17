"""Re-run Blender for every saved scene (e.g. after changing materials). No AI calls:
each scene's plan.json is rebuilt as-is, so URLs, saved runs and sunlight studies stay valid.

    python -m backend.rebuild_scenes
"""
import asyncio
import sys

from dotenv import load_dotenv

from . import orchestrator
from .blender_bridge.runner import run_build


async def main():
    scenes = sorted(p.parent for p in (orchestrator.CACHE / "scenes").glob("*/plan.json"))
    for d in scenes:
        async def quiet(_):
            pass
        tmp = d / "scene.tmp.glb"
        res = await run_build(d / "plan.json", tmp, d / "preview.png", quiet)
        if res.get("ok"):
            tmp.replace(d / "scene.glb")
        print(f"{'ok ' if res.get('ok') else 'ERR'} {d.name} {res.get('error', '')}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    load_dotenv()
    asyncio.run(main())
