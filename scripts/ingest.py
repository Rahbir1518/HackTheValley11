"""Download City of Toronto open data and build data/ordis.sqlite.

Usage (from repo root):
    backend/.venv/Scripts/python scripts/ingest.py            # download (if missing) + build
    backend/.venv/Scripts/python scripts/ingest.py --refresh  # re-download everything

Resource URLs are resolved through CKAN package_show by resource name, so a
city-side resource ID change doesn't break ingestion.
"""
import argparse
import csv
import datetime as dt
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

import httpx
import numpy as np
import shapefile  # pyshp
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.data.normalize import normalize_street  # noqa: E402

RAW = ROOT / "data" / "raw"
DB_PATH = ROOT / "data" / "ordis.sqlite"
CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca"
TARGET_CRS = 2952  # NAD83(CSRS) / MTM zone 10, metres
# Dev-app X/Y are NAD27 / MTM zone 10. Checked against 3,000 matching Address Points:
# EPSG:7991 median error 9.7 m, EPSG:2019 17.1 m, EPSG:2952 222 m.
DEV_APP_CRS = 7991

csv.field_size_limit(2**31 - 1)

DATASETS = {
    "dev_apps": {
        "package": "development-applications",
        "resource": "Development Applications",  # datastore resource
        "dump_fields": None,
    },
    "parcels": {
        "package": "property-boundaries",
        "resource": "Property Boundaries",
        "dump_fields": "PARCELID,FEATURE_TYPE,STATEDAREA,geometry",
    },
    "address_points": {
        "package": "address-points-municipal-toronto-one-address-repository",
        "resource": "Address Points",
        "dump_fields": "ADDRESS_FULL,LO_NUM,HI_NUM,LINEAR_NAME_FULL,ADDRESS_CLASS_DESC,WARD_NAME,geometry",
    },
    "massing": {
        "package": "3d-massing",
        "resource": "3DMassingShapefile_2025_WGS84.zip",  # file download, not datastore
        "dump_fields": None,
    },
    "trees": {
        "package": "street-tree-data",
        "resource": "Street Tree Data",
        "dump_fields": "COMMON_NAME,DBH_TRUNK,geometry",
    },
}
# Tables each dataset writes (used by --only to replace just those).
TABLES = {
    "dev_apps": ["dev_apps", "dev_apps_idx"],
    "parcels": ["parcels", "parcels_idx"],
    "address_points": ["address_points"],
    "massing": ["buildings", "buildings_idx"],
    "trees": ["street_trees", "street_trees_idx"],
}


# ---------------------------------------------------------------- download

def resolve(key: str) -> dict:
    spec = DATASETS[key]
    r = httpx.get(f"{CKAN}/api/3/action/package_show", params={"id": spec["package"]}, timeout=60)
    r.raise_for_status()
    pkg = r.json()["result"]
    res = next(x for x in pkg["resources"] if x["name"] == spec["resource"])
    if res.get("datastore_active"):
        url = f"{CKAN}/datastore/dump/{res['id']}"
        if spec["dump_fields"]:
            url += f"?fields={spec['dump_fields']}"
    else:
        url = res["url"]
    return {
        "title": pkg["title"],
        "page_url": f"https://open.toronto.ca/dataset/{spec['package']}/",
        "resource_url": url,
        "last_refreshed": pkg.get("last_refreshed"),
    }


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  downloading {url}")
    with httpx.stream("GET", url, timeout=None, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.replace(dest)


def fetch_all(refresh: bool, keys) -> dict:
    meta = {}
    for key in keys:
        info = resolve(key)
        dest = RAW / (f"{key}.zip" if key == "massing" else f"{key}.csv")
        if refresh or not dest.exists():
            download(info["resource_url"], dest)
        else:
            print(f"  cached {dest.name}")
        info["downloaded_at"] = dt.datetime.fromtimestamp(dest.stat().st_mtime).isoformat(timespec="seconds")
        meta[key] = (info, dest)
    return meta


# ---------------------------------------------------------------- helpers

def transformer(src: int):
    t = Transformer.from_crs(src, TARGET_CRS, always_xy=True)

    def fn(coords: np.ndarray) -> np.ndarray:
        x, y = t.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])
    return fn


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_int(v):
    f = to_float(v)
    return int(f) if f is not None else None


def blank_to_none(v):
    v = (v or "").strip()
    return v or None


def insert_geoms(db, table: str, rows: list[tuple], geoms: np.ndarray, cols: str) -> None:
    """rows: attribute tuples aligned with geoms (EPSG:2952). Adds id, geom, and the R*Tree."""
    geoms = shapely.make_valid(geoms)
    bounds = shapely.bounds(geoms)
    wkb = shapely.to_wkb(geoms)
    n_cols = cols.count(",") + 1
    placeholders = ",".join("?" * (n_cols + 2))
    db.executemany(
        f"INSERT INTO {table} (id, {cols}, geom) VALUES ({placeholders})",
        ((i, *row, wkb[i]) for i, row in enumerate(rows)),
    )
    db.executemany(
        f"INSERT INTO {table}_idx VALUES (?,?,?,?,?)",
        ((i, b[0], b[2], b[1], b[3]) for i, b in enumerate(bounds)),
    )


# ---------------------------------------------------------------- loaders

def load_dev_apps(db, path: Path) -> None:
    to_target = Transformer.from_crs(DEV_APP_CRS, TARGET_CRS, always_xy=True)
    to_wgs = Transformer.from_crs(DEV_APP_CRS, 4326, always_xy=True)
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            x0, y0 = to_float(r["X"]), to_float(r["Y"])
            x = y = lon = lat = None
            if x0 and y0:
                x, y = to_target.transform(x0, y0)
                lon, lat = to_wgs.transform(x0, y0)
            street = " ".join(filter(None, [r["STREET_NAME"], r["STREET_TYPE"], r["STREET_DIRECTION"]]))
            rid = int(r["_id"])
            db.execute(
                "INSERT INTO dev_apps VALUES (" + ",".join("?" * 25) + ")",
                (
                    rid, r["APPLICATION#"], r["APPLICATION_TYPE"], blank_to_none(r["STREET_NUM"]),
                    blank_to_none(r["STREET_NAME"]), blank_to_none(r["STREET_TYPE"]),
                    blank_to_none(r["STREET_DIRECTION"]), normalize_street(street), blank_to_none(r["POSTAL"]),
                    blank_to_none(r["DATE_SUBMITTED"]), blank_to_none(r["STATUS"]), blank_to_none(r["DESCRIPTION"]),
                    blank_to_none(r["REFERENCE_FILE#"]), blank_to_none(r["FOLDERRSN"]),
                    blank_to_none(r["WARD_NUMBER"]), blank_to_none(r["WARD_NAME"]),
                    blank_to_none(r["COMMUNITY_MEETING_DATE"]), blank_to_none(r["COMMUNITY_MEETING_TIME"]),
                    blank_to_none(r["COMMUNITY_MEETING_LOCATION"]), blank_to_none(r["APPLICATION_URL"]),
                    blank_to_none(r["PARENT_FOLDER_NUMBER"]), x, y, lon, lat,
                ),
            )
            if x is not None:
                db.execute("INSERT INTO dev_apps_idx VALUES (?,?,?,?,?)", (rid, x, x, y, y))
            n += 1
    print(f"  dev_apps: {n} rows")


def load_parcels(db, path: Path) -> None:
    rows, geoms = [], []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["geometry"]:
                continue
            geoms.append(shape(json.loads(r["geometry"])))
            rows.append((to_int(r["PARCELID"]), r["FEATURE_TYPE"], r["STATEDAREA"]))
    geoms = shapely.transform(np.array(geoms, dtype=object), transformer(4326))
    insert_geoms(db, "parcels", rows, geoms, "parcel_id, feature_type, stated_area")
    print(f"  parcels: {len(rows)} rows")


def load_address_points(db, path: Path) -> None:
    t = Transformer.from_crs(4326, TARGET_CRS, always_xy=True)
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        batch = []
        for r in csv.DictReader(f):
            if not r["geometry"]:
                continue
            lon, lat = json.loads(r["geometry"])["coordinates"][:2]
            x, y = t.transform(lon, lat)
            batch.append((
                n, r["ADDRESS_FULL"], to_int(r["LO_NUM"]), to_int(r["HI_NUM"]),
                normalize_street(r["LINEAR_NAME_FULL"]), r["ADDRESS_CLASS_DESC"], r["WARD_NAME"],
                x, y, lon, lat,
            ))
            n += 1
        db.executemany("INSERT INTO address_points VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
    print(f"  address_points: {n} rows")


def load_trees(db, path: Path) -> None:
    t = Transformer.from_crs(4326, TARGET_CRS, always_xy=True)
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["geometry"]:
                continue
            g = json.loads(r["geometry"])
            lon, lat = (g["coordinates"][0] if g["type"] == "MultiPoint" else g["coordinates"])[:2]
            x, y = t.transform(lon, lat)
            rows.append((len(rows), r["COMMON_NAME"], to_int(r["DBH_TRUNK"]), x, y))
    db.executemany("INSERT INTO street_trees VALUES (?,?,?,?,?)", rows)
    db.executemany("INSERT INTO street_trees_idx VALUES (?,?,?,?,?)", ((r[0], r[3], r[3], r[4], r[4]) for r in rows))
    print(f"  street_trees: {len(rows)} rows")


def rings_to_geom(points, parts) -> shapely.Geometry | None:
    """Shapefile rings -> (Multi)Polygon. Outer rings are clockwise, holes counter-clockwise."""
    bounds = list(parts) + [len(points)]
    polys = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        ring = [p[:2] for p in points[a:b]]
        if len(ring) < 4:
            continue
        if shapely.LinearRing(ring).is_ccw and polys:
            polys[-1][1].append(ring)  # hole of the previous shell
        else:
            polys.append((ring, []))
    if not polys:
        return None
    geoms = [Polygon(shell, holes) for shell, holes in polys]
    return geoms[0] if len(geoms) == 1 else shapely.MultiPolygon(geoms)


def load_massing(db, zip_path: Path) -> None:
    out_dir = RAW / "massing"
    with zipfile.ZipFile(zip_path) as z:
        shp_name = next(n for n in z.namelist() if n.lower().endswith(".shp"))
        stem = shp_name[:-4]
        for ext in (".shp", ".shx", ".dbf", ".prj"):
            z.extract(stem + ext, out_dir)
    prj = (out_dir / (stem + ".prj")).read_text()
    # The 2025 "WGS84" file is actually Web Mercator; detect instead of trusting the name.
    src_crs = 3857 if "Mercator" in prj else 4326
    print(f"  massing CRS detected from .prj: EPSG:{src_crs}")

    reader = shapefile.Reader(str(out_dir / stem))
    names = [f[0] for f in reader.fields[1:]]
    rows, geoms, skipped = [], [], 0
    for sr in reader.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        avg = to_float(rec.get("AVG_HEIGHT")) or 0
        msl, surf = to_float(rec.get("HEIGHT_MSL")) or 0, to_float(rec.get("SURF_ELEV")) or 0
        mx = to_float(rec.get("MAX_HEIGHT")) or 0
        # AVG_HEIGHT is populated for every source; MAX_HEIGHT only for LiDAR rows.
        height = avg if avg > 0 else (msl - surf if msl > 0 and surf > 0 and msl > surf else mx)
        geom = rings_to_geom(sr.shape.points, sr.shape.parts)
        if geom is None or height <= 0:
            skipped += 1
            continue
        geoms.append(geom)
        rows.append((round(height, 2), rec.get("HEIGHT_SRC"), rec.get("BLDG_SRC")))
    geoms = shapely.transform(np.array(geoms, dtype=object), transformer(src_crs))
    insert_geoms(db, "buildings", rows, geoms, "height, height_src, bldg_src")
    print(f"  buildings: {len(rows)} rows ({skipped} skipped: no geometry or height)")


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download raw files")
    ap.add_argument("--only", nargs="+", choices=list(DATASETS),
                    help="reload just these datasets into the existing database")
    args = ap.parse_args()
    keys = args.only or list(DATASETS)

    print("Fetching datasets")
    meta = fetch_all(args.refresh, keys)

    if args.only and DB_PATH.exists():
        target = DB_PATH  # update in place
    else:
        target = DB_PATH.with_suffix(".building")
        target.unlink(missing_ok=True)
    db = sqlite3.connect(target)
    db.executescript((ROOT / "backend" / "data" / "schema.sql").read_text())

    print("Building database")
    loaders = {"dev_apps": load_dev_apps, "address_points": load_address_points,
               "parcels": load_parcels, "massing": load_massing, "trees": load_trees}
    for key in keys:
        for table in TABLES[key]:
            db.execute(f"DELETE FROM {table}")
        loaders[key](db, meta[key][1])
        info = meta[key][0]
        db.execute(
            "INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?)",
            (key, info["title"], info["page_url"], info["resource_url"], info["last_refreshed"], info["downloaded_at"]),
        )
    db.commit()
    db.close()
    if target != DB_PATH:
        target.replace(DB_PATH)
    print(f"Done: {DB_PATH}")


if __name__ == "__main__":
    main()
