# Ordis: project handoff

Status as of **2026-10-17**. Everything listed under "Working" has been run end to end and checked in a
browser. Use this file to pick the project up in a new session.

## What Ordis is

A civic tool for Toronto residents that answers **"What's being built near me, and how will it change my
block?"** Built for **Hack the Valley 11**, *Hack the Valley x School of Cities* challenge (civic tech using
Toronto urban data; Toronto's municipal election is October 26, 2026).

A resident types an address in plain language. Ordis finds nearby City of Toronto development applications,
AI agents read the application text into a building spec, Blender builds a 3D massing model on the real
property boundary among the real surrounding buildings and street trees, and a web viewer lets them explore
it: with/without the proposal, sun and shadows on any day, hours of sunlight lost, housing context, and how
to take part. It is neutral by design: it explains, it never argues for or against a development, and it
always separates **stated in the application** from **estimated by Ordis**.

## Architecture

```
scripts/ingest.py        download City open data -> data/ordis.sqlite (EPSG:2952, SQLite R*Tree)
backend/ (FastAPI)
  data/store.py          geocoding, nearby applications, lot lookup, context buildings/parcels/trees,
                         ward summary, neighbourhood housing (2021 Census), heritage/rentals on a lot
  llm/providers.py       Gemini (default) / Groq / OpenRouter via env; JSON mode; retry; fallback chain
  llm/structured.py      ask_model: Pydantic validation + error feedback + retries
  agents/                data_agent (pick application), interpreter + spec.py (extract stated facts,
                         rules fill gaps as assumptions), builder (tool calls validated by simulating the
                         Blender geometry), narrator (plain-language summary), qa (cited Q&A)
  orchestrator.py        runs the agents, streams events, caches runs/specs/scenes/narration
  chat.py                Ask Ordis home chat router (address -> proposals, else cited/general answer)
  sunlight.py            hours of ground-level sun lost/gained (solar ephemeris + 2D shadow polygons)
  block.py               "Your block in 5 years": every active nearby proposal placed in a built scene
  briefing.py            one-page community-meeting briefing PDF (reportlab)
  site_facts.py          what stands on a lot today: heritage + registered rental homes + the application's
                         own words about rental/demolition, and the replacement rule
  capacity.py            "Can the neighbourhood absorb it?": parks per resident, transit, schools in a walk
  blender_bridge/        headless Blender subprocess, streams build steps
  main.py                API (see below)
blender/
  build.py               CLI: blender -b -P blender/build.py -- plan.json out.glb [--png out.png]
  ordis_tools.py         bpy tool layer (ground, parcels, buildings, trees, lot, podium, tower, floor lines)
  ordis_geom.py          pure-Python polygon helpers shared with the backend (inset, towers, clipping)
frontend/ (Next.js 16, React 19, Tailwind 4, react-three-fiber, Clerk)
  src/app/page.tsx              landing (scroll-scrubbed video story, open data, principles, footer)
  src/app/sign-in/...           Clerk sign-in -> /ask
  src/app/ask/page.tsx          Ask Ordis chat (home after sign-in)
  src/app/viewer/page.tsx       3D viewer (Explore + Sunlight study)
  src/components/viewer/        Viewport.tsx (three.js scene), panels.tsx (side panel, timeline, imagery window…)
  src/components/brand.tsx      Identity, StatusChip, Ordi mascot (eyes follow the cursor)
```

Design source: Figma file `iv5GDMvRqBaROOgLuV0MXD` (frames: Public landing, Sign in, Ask Ordis, 3D viewer,
Sunlight study). Tokens: ink `#202322`, muted `#727773`, line `#DDDFDB`, soft `#F2F2EF`, side `#FAFAF8`,
canvas `#EDF0EF`, rust `#AD542D`, proposal `#8FA5B7` / `#566F87`, selection `#E6EDF3`. Fonts: Inter + IBM Plex Mono.

## How to run

```powershell
# one-time
python -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
copy .env.example .env                      # set BLENDER_PATH + at least one LLM key
backend\.venv\Scripts\python scripts\ingest.py   # ~1.7 GB download, builds data\ordis.sqlite
cd frontend; npm install; copy .env.example .env.local   # Clerk keys

# every time (two terminals, repo root / frontend)
backend\.venv\Scripts\python -m uvicorn backend.main:app --port 8000   # add --reload while developing
cd frontend; npm run dev                                               # http://localhost:3000
```

- **Backend changes need a backend restart** (unless started with `--reload`). The Next dev server hot-reloads.
- Pre-warm demo addresses (instant replays, no AI calls): `backend\.venv\Scripts\python -m backend.warm`
  (list in `demo_addresses.txt`; already saved: 135 Liberty St, 5250 Yonge St).
- Terminal-only pipeline run: `backend\.venv\Scripts\python -m backend.run "135 Liberty St"`.
- After changing Blender materials: `backend\.venv\Scripts\python -m backend.rebuild_scenes` (no AI calls).
- Reload some datasets in place: `backend\.venv\Scripts\python scripts\ingest.py --only heritage rentals`
  (keys: dev_apps parcels address_points massing trees neighbourhoods profiles heritage rentals green_spaces
  schools transit; add `--refresh` to re-download). New columns on old databases are added by `MIGRATIONS`.
- Tests: `backend\.venv\Scripts\python -m pytest backend\tests -q` (58 passing). Frontend:
  `cd frontend; npx tsc --noEmit; npx eslint src`.

### Environment (`.env` at repo root; `frontend/.env.local`)

| Variable | Notes |
|---|---|
| `BLENDER_PATH` | e.g. `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` |
| `LLM_PROVIDER` | `gemini` (default) / `groq` / `openrouter` |
| `LLM_FALLBACKS` | e.g. `groq,openrouter`: used automatically when the primary's quota runs out |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | default `gemini-3.8-flash` (2.5-flash was retired). Free tier ≈ **20 requests/day** |
| `GROQ_API_KEY`, `GROQ_MODEL` | default `openai/gpt-oss-120b` (fast, generous free tier) |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | default `google/gemma-4-31b-it:free` (free models change often) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | frontend; without them `/ask` and `/viewer` show a setup message |
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` | optional, Street View in the imagery window (aerial needs no key) |
| `ORDIS_DISABLE_AUTH=true` | local testing only (ignored in production builds) |
| `NEXT_PUBLIC_API_URL` | default `http://localhost:8000` |

Everything currently used is free (Gemini free tier, Groq free plan, OpenRouter `:free` model with a $0 prepaid
balance, Clerk dev instance, City open data, Esri imagery with attribution).

## Working (verified)

**Data & 3D**
- City of Toronto open data ingested: Development Applications (26,648 rows incl. planner contacts and
  meetings), Address Points (525k), Property Boundaries (498k), 3D Massing 2025 (428k buildings),
  Street Trees (688k), Neighbourhoods (158) + Neighbourhood Profiles 2021 housing rows (plus population and
  average household size), Heritage Register (12,332), RentSafeTO apartment evaluations (3,464 registered
  rental buildings, latest evaluation each), Green Spaces (3,381), School Locations (1,173), TTC GTFS stops
  (9,409, each with the routes and modes serving it).
- Deterministic Blender builds (same plan -> byte-identical `.glb`): textured facades aligned to storeys,
  roofs, streets from parcel gaps, low-poly trees sized from trunk diameter, mechanical penthouses,
  custom properties exported as glTF extras. Light palette matching the Figma.

**Agents** (`/api/run`, Server-Sent Events)
- Data Agent picks the most relevant OZ/SA application (LLM, cached per address); Interpreter extracts only
  stated facts, `complete_spec` fills gaps with documented rules recorded as assumptions; refuses honestly when
  there's no building, no height/storeys, or confidence < 0.4; Builder's tool calls are validated by simulating
  the geometry (retries with the error, labelled rule-based fallback); Narrator writes a neutral summary.
- Caches: whole runs (`output/cache/runs/`, replayed with the event log), application choice, spec, scene,
  narration, Q&A answers, sunlight studies. Daily-quota 429s fail fast and switch provider.

**Ask Ordis** (`/ask`, `POST /api/chat`)
- Finds a Toronto address inside any sentence (no LLM; supports ranges like 5250-5254 Yonge St); returns nearby
  proposals with a featured saved summary + "View in 3D"; follow-up questions about the proposal get cited
  answers; general planning questions get labelled general answers; addresses in other municipalities
  (Markham, Mississauga, …) get a clear "outside Toronto" reply. Recent places in the sidebar. Ordi mascot.

**3D viewer** (`/viewer?address=…&app=…`)
- Explore: Existing / With proposal, tool palette (select, pan, orbit), WASD/QE fly, proposal label
  ("55 storeys · stated"), legend, layers (buildings, trees, lots, grid), fullscreen, share link, scene
  collection with visibility toggles, selected-object properties, **resizable right panel** (drag left edge).
- Panel tabs: **Overview** (stated facts, "Estimated · visible rules", application record), **Evidence & sources**
  (quotes, every assumption with its rule, confidence, sources, limitations), **Get involved** (City planner
  name/email/phone from the dataset's CONTACT_* fields, meetings, mailto template). Drill-in: Nearby & ward
  (other applications, neighbourhood housing vs 158 neighbourhoods, ward counts).
- Floating, draggable, resizable **Site imagery** window (Esri aerial; Google Street View with a key).
- **Sunlight study**: date + time, Mar/Jun/Sep/Dec presets, 24 h timeline with daylight band and play
  (sunrise to sunset loop), side-by-side synchronised comparison, **hours of sun lost** heatmap with worst spot
  and most affected lots (`GET /api/sunlight`).
- **Block in 5 years** (third option of the Existing / With proposal toggle, `GET /api/block`): every active
  OZ/SA application whose lot is inside the scene, one per lot, each in its own shade with storey lines and a
  "55 storeys" chip; buildings on those lots today are hidden. Specs come from the Interpreter cache or are read
  once (max 6 per request; refusals listed under "Not shown" with the reason). Massing reuses the Builder
  Agent's plan if that proposal was built before, else the rule-based plan (labelled). Side panel: counts,
  tallest, homes stated, colour-keyed list. Sunlight study has an "All nearby proposals" toggle for the
  **combined** sun loss (`/api/sunlight?block=true`, cached as `sun_block_<set>_<date>`). Saved as
  `block.json` in the scene folder (invalidated when the set of nearby applications changes).
- **Construction animation**: when a scene loads (and on Existing -> With proposal) the proposal rises floor by
  floor (a clipping plane steps up one storey at a time, faces double-sided meanwhile) with a ticking
  "26 storeys" chip; block-view proposals rise the same way when they appear. Plays once per scene and view
  (not again after visiting the sunlight study); skipped with `prefers-reduced-motion`.
- **Briefing PDF** (top bar, `POST /api/briefing`): one Letter page with a snapshot of the current 3D view (the
  only thing the browser sends), the narration, stated vs estimated, sunlight lost on the study date (plus the
  combined figure when the block view is on), meetings, the planner and the record link; neutrality note,
  limitations and sources in the footer. Shrinks to fit one page; uses Segoe UI / Arial / DejaVu when present
  for Unicode, else Helvetica with ASCII substitutes.
- **On this site today** (Overview card, `GET /api/site`): Heritage Register entries on the lot (Part IV
  designated / Part V district / Listed) and how many within 100 m; registered rental buildings on the lot
  (units, year built, landlord type); sentences of the application text about rental, demolition, retention or
  replacement, **quoted** ("The application says:"). A rental building on the lot is *not* presented as a
  demolition (many applications are infill beside a retained tower). "What the rules say": Official Plan
  3.2.1.6 + Municipal Code Ch. 667 rental replacement, heritage permits, Tenant Hotline. Quiet sites get one
  line. The block view counts rental homes on all lots; the briefing PDF has an "On this site today" section.
  95 active OZ/SA applications filed since 2022 have a registered rental building on the lot
  (e.g. 240 Wellesley St E, 2575 Danforth Ave, 25 Mabelle Ave).
- **Neighbourhood capacity** (Overview drill-in, `GET /api/capacity?scene_key=&block=`): within a 500 m
  circle: residents today (estimate: 2021 neighbourhood population spread evenly, clipped), new residents
  (estimate: homes *stated* x neighbourhood average household size; proposals without stated homes listed as
  not counted), park space per resident today -> with (Green Spaces: Park, Open Green Space, Civic Centre
  Square, OTHER_CITY, OTHER_TRCA) vs Toronto overall from the same data (32.8 m2); nearest subway/LRT
  within 1.5 km, bus/streetcar routes within 500 m (overnight 3xx left out); schools within 1 km (capacity
  is not open data, said so). Block panel: one line for all proposals (135 Liberty: 6.4 -> 5.4 m2 per
  resident with about 1,318 new residents), expandable. Also in the briefing PDF.
- Clear progress card: steps tick off; on a refusal it says where it stopped, marks skipped steps and offers
  other nearby proposals that can be shown in 3D.

**Other endpoints**: `/api/health`, `/api/applications`, `/api/ward`, `/api/sources`, `/api/cached`,
`/api/involved`, `/api/housing`, `/api/ask`, `/api/block`, `/api/briefing`, `/api/site`, `/api/capacity`, `/files/...` (scenes, previews, heatmaps).

## Data gotchas worth remembering

- Dev-application `X/Y` are **NAD27 / MTM zone 10 (EPSG:7991)**, not 2952 (checked against 3,000 address points).
- The 3D Massing "WGS84" shapefile is actually **Web Mercator (EPSG:3857)**; `MAX_HEIGHT` is 0 for non-LiDAR rows
  (use `AVG_HEIGHT`); the README says `SURV_ELEV` but the column is `SURF_ELEV`.
- Property Boundaries have no address field (spatial join); `CORRIDOR` parcels are road allowances.
- The Development Applications dataset has **no** Committee of Adjustment types (only OZ, SA, CD, SB, PL) and no
  structured storeys/height: everything comes from `DESCRIPTION`.
- No open sale-price data exists (MPAC/TRREB are proprietary); housing uses 2021 Census owner estimates.
- Toronto open data only covers the City of Toronto.
- Heritage Register is a point shapefile in **WGS84** (status Part IV / Part V / Listed; `YEAR_DEMOL` marks gone
  ones). RentSafeTO evaluations have several rows per building (one per year): keep the latest per `RSN`; use
  `LATITUDE/LONGITUDE` (the X/Y columns are another MTM datum). The registry only covers 3+ storeys and 10+ units.
- Green Spaces and School Locations come as EPSG:2952 CSVs (no reprojection). TTC GTFS has no parent stations
  (`location_type` empty) and the mode lives on routes: `route_type` 1 = subway, 0 = streetcar except "Line 5"
  (LRT), 3 = bus; stop -> routes needs trips + stop_times (207 MB, streamed in a few seconds).
- `str.title()` makes "Queen'S Park"; ingest uses `proper()` for names.
- `shapely.make_valid` on a bad 3D Massing footprint can return lines/collections; `sunlight.Shadower` keeps only
  polygon parts (this crashed the sun study at 100 Queen St W).

## Code gotchas already solved

- Next.js 16: `middleware` is now `proxy.ts`; `cacheComponents` is off on purpose; Clerk needs keys (no keyless mode).
- `suncalc` 2.x returns **degrees** with azimuth clockwise from north.
- `Intl` `en-CA` formats times as `06:30 p.m.`; use `hourCycle: "h23"` when parsing.
- three.js removed `PCFSoftShadowMap` (use `shadows="percentage"`); new Chrome `scrollIntoView()` returns a Promise
  (don't return it from `useEffect`).
- glTF node names are sanitised (spaces -> `_`), so `Proposed Building` is `Proposed_Building` in three.js.

## Working conventions

- **Branch per milestone**: commit at the end of each feature, then create a new branch for the next one.
  `main` now contains everything up to this handoff.
- The user often has their own servers on **8000/3000**. For automated browser checks run a second copy:
  API on **8010** (`CORS_ORIGINS=http://localhost:3010`) and web on **3010** with
  `ORDIS_DIST_DIR=.next-test ORDIS_DISABLE_AUTH=true NEXT_PUBLIC_API_URL=http://localhost:8010 npx next dev -p 3010`.
  Next may add `.next-test` paths to `frontend/tsconfig.json`; restore that file before committing.
  Headless Chrome via `playwright-core` with `executablePath` = installed Chrome and `--use-angle=swiftshader`.
- Don't put fabricated data into caches (delete any test output made with stub providers).

## Known limitations

- Footprints come from property lines (no setbacks from the street); heights/storeys from text; massing only.
- **Infill on sites with existing towers is misdrawn**: "With proposal" hides every building on the lot and the
  podium fills the lot, even when the application keeps them (e.g. 240 Wellesley St E keeps 2,197 rental homes).
  The "On this site today" card quotes the text correctly, but the 3D model doesn't yet. Fix idea: keep on-site
  buildings the application says are retained and place new masses on the free part of the lot.
- Shadows/sun loss: clear sky, ground level, flat terrain.
- Context buildings are the City's 2025 massing (may predate recent construction).
- Free LLM tiers are small; pre-warm demo addresses.

## Ideas not built yet (ranked for a demo)

1. ~~"Your block in 5 years"~~ (built).
2. **"View from my window"**: click a neighbouring building -> camera at its window + % of sky blocked.
3. ~~Construction animation~~ (built).
4. Scale comparisons (landmark ghost, "≈ 37 houses stacked").
5. Before/after wipe slider.
6. ~~One-page briefing PDF~~ (built).
7. Ward map coloured by application status.
8. Narrated flyover (browser speech).
9. Plain-language summaries/briefing in Toronto's main languages (numbers and stated/estimated labels kept).
10. Committee of Adjustment applications (separate open dataset: garden suites, additions, minor variances).
11. Watch an address: notify on status changes or new meetings (daily ingest diff).
12. Retained buildings on infill sites (see Known limitations).

Optional tweak discussed: the Get involved email says "I live near <application address>"; could use the
address the resident searched instead.
