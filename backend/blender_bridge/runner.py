"""Run a build plan through headless Blender and stream its progress lines."""
import asyncio
import json
import os
import subprocess
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = ROOT / "blender" / "build.py"


class BlenderError(RuntimeError):
    pass


def blender_path() -> str:
    path = os.getenv("BLENDER_PATH", "")
    if not path or not Path(path).exists():
        raise BlenderError(f"BLENDER_PATH '{path}' not found; set it in .env")
    return path


async def run_build(plan_path: Path, glb_path: Path, png_path: Path | None, on_line) -> dict:
    """Runs Blender in a thread (works with any asyncio loop on Windows) and forwards
    ORDIS_STEP lines to `on_line(dict)`. Returns the final ORDIS_RESULT payload."""
    cmd = [blender_path(), "-b", "--factory-startup", "-P", str(BUILD_SCRIPT), "--", str(plan_path), str(glb_path)]
    if png_path:
        cmd += ["--png", str(png_path)]
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def worker():
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        tail = []
        for line in proc.stdout:
            line = line.rstrip()
            tail = (tail + [line])[-20:]
            if line.startswith(("ORDIS_STEP ", "ORDIS_RESULT ")):
                tag, payload = line.split(" ", 1)
                loop.call_soon_threadsafe(queue.put_nowait, (tag, json.loads(payload)))
        proc.wait()
        loop.call_soon_threadsafe(queue.put_nowait, ("EXIT", {"code": proc.returncode, "tail": tail}))

    threading.Thread(target=worker, daemon=True).start()
    result = None
    while True:
        tag, payload = await queue.get()
        if tag == "ORDIS_STEP":
            await on_line(payload)
        elif tag == "ORDIS_RESULT":
            result = payload
        else:
            if result is None:
                raise BlenderError(f"Blender exited with code {payload['code']}: " + "\n".join(payload["tail"][-5:]))
            return result
