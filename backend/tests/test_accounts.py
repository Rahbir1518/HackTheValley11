import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from backend import accounts

HOST = "sensible-bee-129.clerk.accounts.dev"
PK = "pk_test_" + base64.b64encode(f"{HOST}$".encode()).decode().rstrip("=")


def test_issuer_from_publishable_key():
    assert accounts.clerk_issuer(PK) == f"https://{HOST}"


def test_session_tokens_are_verified(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJwks:
        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": key.public_key()})()

    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", PK)
    monkeypatch.setattr(accounts, "_jwks", lambda issuer: FakeJwks())
    good = jwt.encode({"sub": "user_123", "iss": f"https://{HOST}", "exp": time.time() + 60}, key, algorithm="RS256")
    assert accounts.user_id_from_token(good) == "user_123"
    for bad in (jwt.encode({"sub": "u", "iss": "https://evil.example", "exp": time.time() + 60}, key, algorithm="RS256"),
                jwt.encode({"sub": "u", "iss": f"https://{HOST}", "exp": time.time() - 600}, key, algorithm="RS256")):
        with pytest.raises(HTTPException) as e:
            accounts.user_id_from_token(bad)
        assert e.value.status_code == 401


def test_requests_without_a_session_are_refused_unless_local_testing(monkeypatch):
    monkeypatch.delenv("ORDIS_DISABLE_AUTH", raising=False)
    with pytest.raises(HTTPException):
        accounts.current_user(None)
    monkeypatch.setenv("ORDIS_DISABLE_AUTH", "true")
    assert accounts.current_user(None) == accounts.LOCAL_USER


def test_watched_places_report_changes(tmp_path, monkeypatch):
    state = {"status": "Under Review", "meeting": None}
    monkeypatch.setattr(accounts, "_watch_state", lambda city, app: (state["status"], state["meeting"]) if app else (None, None))
    db = accounts.connect(tmp_path / "users.sqlite")
    accounts.save_place(db, None, "u1", "135 Liberty St", "21 250999 STE 10 SA", "Two office towers")
    accounts.save_place(db, None, "u1", "5250 Yonge St", None, "Yonge")
    accounts.save_place(db, None, "u1", "135 Liberty St", None, None, watched=True)
    assert accounts.list_places(db, None, "u1")[0]["changes"] == []
    state.update(status="Council Approved", meeting="2026-11-04")
    p = next(x for x in accounts.list_places(db, None, "u1") if x["address"] == "135 Liberty St")
    assert p["watched"] and p["changes"] == ["Status changed: Under Review → Council Approved",
                                             "Community meeting scheduled: 2026-11-04"]
    accounts.mark_seen(db, None, "u1", "135 Liberty St")
    assert all(not x["changes"] for x in accounts.list_places(db, None, "u1"))
    assert accounts.list_places(db, None, "someone-else") == []  # places are per user
    accounts.delete_place(db, "u1", "5250 Yonge St")
    assert [x["address"] for x in accounts.list_places(db, None, "u1")] == ["135 Liberty St"]
