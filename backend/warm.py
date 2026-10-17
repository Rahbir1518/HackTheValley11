"""Pre-run demo addresses so they replay instantly in the viewer.

    python -m backend.warm                       # every address in demo_addresses.txt
    python -m backend.warm "135 Liberty St" "5250 Yonge St"
    python -m backend.warm --fresh               # ignore saved runs and redo them
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


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    load_dotenv()
    asyncio.run(main())
