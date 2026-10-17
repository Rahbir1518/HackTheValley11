# Ordis

**What's being built near me, and how will it change my block?**

A resident enters a Toronto address. Ordis finds nearby development applications, has AI agents
read what is proposed, builds a 3D massing model in Blender among the real surrounding buildings,
and shows it in a Unity-editor-style web viewer with a sun/shadow study and a plain-language summary.
Ordis explains civic information; it does not advocate for or against any development.

Built for Hack the Valley 11 – *Hack the Valley x School of Cities* challenge.

## Repo layout

```
backend/        FastAPI app (data/, agents/, llm/, blender_bridge/) + tests
blender/        build.py (headless CLI), ordis_tools.py (bpy tool layer), ordis_geom.py (pure-Python geometry)
scripts/        ingest.py – downloads City of Toronto open data into data/ordis.sqlite
frontend/       Next.js viewer (later milestone)
```

## Setup

Requirements: Python 3.12+, Blender 4.2+ (developed on 5.2), Node 20+ (frontend).

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt   # macOS/Linux: backend/.venv/bin/python
cp .env.example .env        # then set BLENDER_PATH
backend/.venv/Scripts/python scripts/ingest.py      # ~1.6 GB download on first run, then cached
```

`ingest.py --refresh` re-downloads everything. The database is ~1 GB and is git-ignored.

## Checking the data layer and Blender build (no LLM)

```bash
# Nearby applications ("3D" = an application type Ordis models)
backend/.venv/Scripts/python -m backend.site_plan apps "135 Liberty St"

# Build plan with the real lot + real neighbours + a hand-specified massing
backend/.venv/Scripts/python -m backend.site_plan plan "135 Liberty St" --app "21 250999 STE 10 SA" --storeys 10 -o output/liberty_plan.json

# Headless Blender build -> .glb (+ optional preview render)
"<BLENDER_PATH>" -b --factory-startup -P blender/build.py -- output/liberty_plan.json output/liberty.glb --png output/liberty.png

# Fully hand-written plan (no data needed)
"<BLENDER_PATH>" -b --factory-startup -P blender/build.py -- blender/examples/sample_plan.json output/sample.glb --png output/sample.png

# Tests
backend/.venv/Scripts/python -m pytest backend/tests -q
```

Open the `.glb` in Blender (File → Import → glTF) or https://gltf-viewer.donmccurdy.com/ to inspect
object names and custom properties (exported as glTF `extras`).

## Agent pipeline

Set `LLM_PROVIDER` and the matching key in `.env` (free keys: [Gemini](https://aistudio.google.com/apikey),
[Groq](https://console.groq.com/keys), [OpenRouter](https://openrouter.ai/keys)), then:

```bash
backend/.venv/Scripts/python -m backend.run "135 Liberty St"
```

| Agent | Does | Uses the LLM for |
|---|---|---|
| Data | geocode, nearby applications, related applications, lot, neighbours | choosing among several applications |
| Interpreter | reads application text into an `Extraction`, then `complete_spec` fills gaps with fixed rules, each recorded as an assumption | extracting stated numbers only (`backend/agents/spec.py`) |
| Builder | turns the spec into tool calls; `validate_steps` simulates them with the Blender geometry code and sends errors back for a retry (3 tries, then a labelled rule-based plan) | choosing tool calls |
| Narrator | plain-language summary (template fallback if the LLM fails) | writing |

Every LLM call asks for JSON, is validated with Pydantic and retried with the error message; HTTP 429/5xx
are retried with exponential backoff. Results are cached in `output/cache/` (interpretation by application
text hash, scenes by application + spec hash), so repeat runs are instant. Applications that don't describe
a building, don't state a height/storeys, or have confidence < 0.4 are reported, not modelled.

### Build plan format

```json
{"version": 1, "metadata": {"application_id": "..."}, "steps": [
  {"tool": "create_ground",          "args": {"size_m": 600}},
  {"tool": "load_context_parcels",   "args": {"geojson": {"type": "FeatureCollection", "features": []}}},
  {"tool": "load_context_buildings", "args": {"geojson": {"type": "FeatureCollection", "features": []}}},
  {"tool": "load_street_trees",      "args": {"trees": [{"x": 12.5, "y": -40.2, "dbh_cm": 35}]}},
  {"tool": "create_lot",    "args": {"polygon": [[x, y], ...]}},
  {"tool": "create_podium", "args": {"footprint": [[x, y], ...], "storeys": 4, "storey_height": 4.5}},
  {"tool": "add_tower",     "args": {"name": "Tower_A", "base": "Podium", "storeys": 30, "storey_height": 3.1,
                                     "setback_m": 3, "tower_index": 0, "tower_count": 1, "max_floorplate_m2": 750}},
  {"tool": "add_floor_lines", "args": {"target": "Tower_A"}},
  {"tool": "set_material",  "args": {"target": "Tower_A", "role": "proposed"}},
  {"tool": "set_metadata",  "args": {"target": "Tower_A", "properties": {"key": "value"}}}
]}
```

Coordinates are local metres (x = east, y = north) around the site centroid, derived from EPSG:2952.
The same plan always produces a byte-identical `.glb`.

## Data sources (City of Toronto Open Data)

| Dataset | Used for | Notes |
|---|---|---|
| [Development Applications](https://open.toronto.ca/dataset/development-applications/) | applications, status, description, ward, links | `X`/`Y` are NAD27 / MTM zone 10 (EPSG:7991); checked against 3,000 address points (median 9.7 m). No structured height/storey fields: those come from `DESCRIPTION`. Contains OZ, SA, CD, SB, PL types only (no Committee of Adjustment). |
| [Property Boundaries](https://open.toronto.ca/dataset/property-boundaries/) | lot polygon | No address field: lots are found by spatial join with address points. |
| [3D Massing](https://open.toronto.ca/dataset/3d-massing/) (2025) | surrounding buildings + heights | Despite the "WGS84" file name, the shapefile is Web Mercator (EPSG:3857). Flat footprints with `AVG_HEIGHT`; `MAX_HEIGHT` is 0 for non-LiDAR rows. |
| [Address Points](https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/) | geocoding | Used instead of Nominatim. |
| [Street Tree Data](https://open.toronto.ca/dataset/street-tree-data/) | street trees in the scene | Only trunk diameter is published; tree height/crown size are estimated from it. |

Streets in the 3D scene are the gaps between non-road property parcels (`CORRIDOR` parcels are road allowances).
Facade window grids are illustrative and aligned to storey heights; they are not real window positions.

Source URLs and refresh dates are stored in the `sources` table so the UI can link to them.

## Limitations

- Footprints are estimated from property boundaries, not architectural drawings.
- Heights and storeys are read from free-text descriptions; missing values are estimated and labelled as assumptions.
- The model is a massing approximation, not an architectural rendering.
- Context building heights come from the City's 3D Massing data (2025) and may be out of date.
