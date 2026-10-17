import sys
from pathlib import Path

# ordis_geom is plain Python shared with Blender; make it importable from the backend.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "blender"))
