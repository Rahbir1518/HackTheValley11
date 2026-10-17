"""Per-user saved places, shared by the web app and the mobile app.

Signed-in requests carry the Clerk session token (Authorization: Bearer <jwt>). It is verified
against the Clerk instance's public keys (JWKS), derived from the publishable key, so the backend
needs no Clerk secret. ORDIS_DISABLE_AUTH=true (local testing only) uses one "local-dev" user.

A saved place can be watched: its application's status and next community meeting are remembered
when it is saved (or marked seen), and `changes` lists what differs now.
"""
import base64
import datetime as dt
import os
import sqlite3
from functools import lru_cache
from pathlib import Path

import jwt
from fastapi import Header, HTTPException

from .data import store

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "users.sqlite"
FRONTEND_ENV = Path(__file__).resolve().parents[1] / "frontend" / ".env.local"
LOCAL_USER = "local-dev"

SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
    user_id TEXT NOT NULL,
    address TEXT NOT NULL,          -- as searched, e.g. "135 Liberty St"
    app_number TEXT,                -- the proposal shown for it, if any
    label TEXT,
    watched INTEGER NOT NULL DEFAULT 0,
    seen_status TEXT,               -- application status when last seen
    seen_meeting TEXT,              -- next community meeting date when last seen
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, address)
);
"""


# ------------------------------------------------------------------ auth

def _publishable_key() -> str | None:
    key = os.getenv("CLERK_PUBLISHABLE_KEY") or os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
    if not key and FRONTEND_ENV.exists():  # same repo: reuse the web app's (public) key
        for line in FRONTEND_ENV.read_text().splitlines():
            if line.startswith("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    return key or None


def clerk_issuer(publishable_key: str) -> str:
    """pk_test_<base64("sensible-bee-129.clerk.accounts.dev$")> -> https://sensible-bee-129.clerk.accounts.dev"""
    encoded = publishable_key.split("_", 2)[2]
    host = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")
    return f"https://{host}"


@lru_cache(maxsize=1)
def _jwks(issuer: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)


def user_id_from_token(token: str) -> str:
    key = _publishable_key()
    if not key:
        raise HTTPException(503, "Clerk is not configured on the server (CLERK_PUBLISHABLE_KEY)")
    issuer = clerk_issuer(key)
    try:
        signing_key = _jwks(issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(token, signing_key.key, algorithms=["RS256"], issuer=issuer,
                            options={"require": ["exp", "sub"]}, leeway=10)
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"invalid session: {e}")
    return claims["sub"]


def current_user(authorization: str | None = Header(None)) -> str:
    """FastAPI dependency: the signed-in Clerk user id."""
    if authorization and authorization.lower().startswith("bearer "):
        return user_id_from_token(authorization.split(" ", 1)[1].strip())
    if os.getenv("ORDIS_DISABLE_AUTH") == "true":
        return LOCAL_USER
    raise HTTPException(401, "sign in to use saved places")


# ------------------------------------------------------------------ storage

def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _watch_state(city, app_number: str | None) -> tuple[str | None, str | None]:
    """(status, next upcoming meeting date) of an application, from the City's data."""
    if not app_number:
        return None, None
    try:
        app = store.get_application(city, app_number)
    except store.DataError:
        return None, None
    today = dt.date.today().isoformat()
    rows = city.execute("SELECT meeting_date FROM dev_apps WHERE app_number = ? AND meeting_date >= ? "
                        "ORDER BY meeting_date LIMIT 1", (app_number, today)).fetchone()
    return app["status"], (rows["meeting_date"][:10] if rows else None)


def save_place(db, city, user: str, address: str, app_number: str | None, label: str | None,
               watched: bool | None = None) -> dict:
    """Insert or touch a place. Watching (or re-saving) records the current status/meeting."""
    now = _now()
    existing = db.execute("SELECT * FROM places WHERE user_id = ? AND address = ?", (user, address)).fetchone()
    if existing is None:
        status, meeting = _watch_state(city, app_number)
        db.execute("INSERT INTO places (user_id, address, app_number, label, watched, seen_status, seen_meeting, "
                   "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   (user, address, app_number, label, int(bool(watched)), status, meeting, now, now))
    else:
        app_number = app_number or existing["app_number"]
        db.execute("UPDATE places SET app_number = ?, label = COALESCE(?, label), updated_at = ? "
                   "WHERE user_id = ? AND address = ?", (app_number, label, now, user, address))
        if watched is not None and bool(watched) != bool(existing["watched"]):
            status, meeting = _watch_state(city, app_number)
            db.execute("UPDATE places SET watched = ?, seen_status = ?, seen_meeting = ? "
                       "WHERE user_id = ? AND address = ?", (int(watched), status, meeting, user, address))
    db.commit()
    return next(p for p in list_places(db, city, user) if p["address"] == address)


def mark_seen(db, city, user: str, address: str) -> None:
    row = db.execute("SELECT app_number FROM places WHERE user_id = ? AND address = ?", (user, address)).fetchone()
    if row:
        status, meeting = _watch_state(city, row["app_number"])
        db.execute("UPDATE places SET seen_status = ?, seen_meeting = ? WHERE user_id = ? AND address = ?",
                   (status, meeting, user, address))
        db.commit()


def delete_place(db, user: str, address: str) -> None:
    db.execute("DELETE FROM places WHERE user_id = ? AND address = ?", (user, address))
    db.commit()


def list_places(db, city, user: str) -> list[dict]:
    """Newest first; watched places carry `changes` since they were last seen."""
    out = []
    for r in db.execute("SELECT * FROM places WHERE user_id = ? ORDER BY updated_at DESC", (user,)):
        p = {k: r[k] for k in ("address", "app_number", "label", "created_at", "updated_at")}
        p["watched"] = bool(r["watched"])
        p["changes"] = []
        if p["watched"] and p["app_number"]:
            status, meeting = _watch_state(city, p["app_number"])
            p["status"], p["next_meeting"] = status, meeting
            if status and r["seen_status"] and status != r["seen_status"]:
                p["changes"].append(f"Status changed: {r['seen_status']} → {status}")
            if meeting and meeting != r["seen_meeting"]:
                p["changes"].append(f"Community meeting scheduled: {meeting}")
        out.append(p)
    return out
