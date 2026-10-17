-- All geometry is stored in EPSG:2952 (NAD83(CSRS) / MTM zone 10, metres) as WKB.
-- lon/lat columns are WGS84, kept for display and links.

CREATE TABLE IF NOT EXISTS sources (
    key TEXT PRIMARY KEY,
    title TEXT,
    page_url TEXT,
    resource_url TEXT,
    last_refreshed TEXT,
    downloaded_at TEXT
);

CREATE TABLE IF NOT EXISTS dev_apps (
    id INTEGER PRIMARY KEY,           -- datastore _id
    app_number TEXT,                  -- APPLICATION#
    app_type TEXT,                    -- APPLICATION_TYPE (OZ, SA, CD, SB, ...)
    street_num TEXT,
    street_name TEXT,
    street_type TEXT,
    street_direction TEXT,
    street_norm TEXT,                 -- normalised "LIBERTY ST" for joins
    postal TEXT,
    date_submitted TEXT,
    status TEXT,
    description TEXT,
    reference_file TEXT,
    folder_rsn TEXT,
    ward_number TEXT,
    ward_name TEXT,
    meeting_date TEXT,
    meeting_time TEXT,
    meeting_location TEXT,
    application_url TEXT,
    contact_name TEXT,                -- City planner on the file
    contact_phone TEXT,
    contact_email TEXT,
    parent_folder TEXT,
    x REAL, y REAL,                   -- EPSG:2952
    lon REAL, lat REAL
);
CREATE INDEX IF NOT EXISTS dev_apps_number ON dev_apps(app_number);
CREATE VIRTUAL TABLE IF NOT EXISTS dev_apps_idx USING rtree(id, minx, maxx, miny, maxy);

CREATE TABLE IF NOT EXISTS parcels (
    id INTEGER PRIMARY KEY,
    parcel_id INTEGER,
    feature_type TEXT,                -- COMMON / CONDO / CORRIDOR / RESERVE
    stated_area TEXT,
    geom BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS parcels_idx USING rtree(id, minx, maxx, miny, maxy);

CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY,
    height REAL,                      -- metres above ground
    height_src TEXT,
    bldg_src TEXT,
    geom BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS buildings_idx USING rtree(id, minx, maxx, miny, maxy);

CREATE TABLE IF NOT EXISTS street_trees (
    id INTEGER PRIMARY KEY,
    common_name TEXT,
    dbh_cm INTEGER,                   -- trunk diameter at breast height
    x REAL, y REAL
);
CREATE VIRTUAL TABLE IF NOT EXISTS street_trees_idx USING rtree(id, minx, maxx, miny, maxy);

CREATE TABLE IF NOT EXISTS neighbourhoods (
    id INTEGER PRIMARY KEY,           -- AREA_SHORT_CODE (1-174, 158 neighbourhoods)
    name TEXT,
    geom BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS neighbourhoods_idx USING rtree(id, minx, maxx, miny, maxy);

-- 2021 Census housing indicators from the City's Neighbourhood Profiles (158-neighbourhood model)
CREATE TABLE IF NOT EXISTS nbhd_housing (
    id INTEGER PRIMARY KEY,           -- neighbourhood number
    name TEXT,
    households INTEGER,
    owners INTEGER,
    renters INTEGER,
    apartments_5plus INTEGER,
    median_value REAL,                -- median value of owned dwellings ($)
    median_owner_cost REAL,           -- median monthly shelter costs, owned ($)
    median_rent REAL,                 -- median monthly shelter costs, rented ($)
    pct_owner_30 REAL,                -- % owner households spending 30%+ of income on shelter
    pct_tenant_30 REAL                -- % tenant households spending 30%+ of income on shelter
);

CREATE TABLE IF NOT EXISTS address_points (
    id INTEGER PRIMARY KEY,
    address_full TEXT,
    lo_num INTEGER,
    hi_num INTEGER,
    street_norm TEXT,
    address_class TEXT,
    ward_name TEXT,
    x REAL, y REAL,
    lon REAL, lat REAL
);
CREATE INDEX IF NOT EXISTS address_points_street ON address_points(street_norm, lo_num);
