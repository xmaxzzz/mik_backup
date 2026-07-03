"""Yandex.Disk integration: OAuth (authorization code flow) + Disk REST API.

Docs:
  OAuth   https://yandex.ru/dev/id/doc/ru/  (authorize + /token)
  Disk    https://yandex.ru/dev/disk-api/doc/ru/reference/

We use the out-of-band flow: the app is registered with redirect URI
``https://oauth.yandex.ru/verification_code`` so Yandex shows the code to the
user, who pastes it back — no public redirect endpoint required.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlencode

import requests
from sqlalchemy.orm import Session

from . import settings_store as store

logger = logging.getLogger("mikbackup.yandex")

AUTHORIZE_URL = "https://oauth.yandex.ru/authorize"
TOKEN_URL = "https://oauth.yandex.ru/token"
REDIRECT_OOB = "https://oauth.yandex.ru/verification_code"
DISK_API = "https://cloud-api.yandex.net/v1/disk"
SCOPE = "cloud_api:disk.read cloud_api:disk.write"

_TIMEOUT = 30


class YandexError(RuntimeError):
    pass


def _headers(token: str) -> dict[str, str]:
    # Yandex Disk API expects the "OAuth" auth scheme (not "Bearer").
    return {"Authorization": f"OAuth {token}"}


def _norm(path: str) -> str:
    """Normalize a Disk path for write operations.

    The listing API returns paths like ``disk:/BACKUP/Mikrotik``. The write
    endpoints (create folder / upload) require a slash-rooted path and reject
    the ``disk:`` scheme when it ends up as its own segment (``/disk:`` is read
    as the scheme with an empty path). Strip the scheme and root with ``/``.
    """
    p = (path or "").strip()
    if p.startswith("disk:"):
        p = p[len("disk:"):]
    return "/" + p.strip("/")


# --------------------------------------------------------------------------- #
# OAuth
# --------------------------------------------------------------------------- #
def build_auth_url(db: Session) -> str:
    client_id = store.get(db, store.YANDEX_CLIENT_ID)
    if not client_id:
        raise YandexError("client_id is not configured")
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_OOB,
        "scope": SCOPE,
        "force_confirm": "yes",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def _store_tokens(db: Session, data: dict) -> None:
    access = data.get("access_token")
    if not access:
        raise YandexError(f"No access_token in response: {data}")
    store.set(db, store.YANDEX_ACCESS_TOKEN, access)
    if data.get("refresh_token"):
        store.set(db, store.YANDEX_REFRESH_TOKEN, data["refresh_token"])
    expires_in = int(data.get("expires_in", 0) or 0)
    if expires_in:
        # refresh a minute early
        store.set(
            db, store.YANDEX_TOKEN_EXPIRES_AT, str(int(time.time()) + expires_in - 60)
        )
    else:
        store.delete(db, store.YANDEX_TOKEN_EXPIRES_AT)


def exchange_code(db: Session, code: str) -> None:
    client_id = store.get(db, store.YANDEX_CLIENT_ID)
    client_secret = store.get(db, store.YANDEX_CLIENT_SECRET)
    if not client_id or not client_secret:
        raise YandexError("client_id / client_secret are not configured")
    try:
        resp = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code.strip(),
                "client_id": client_id,
                "client_secret": client_secret,
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise YandexError(f"Token request failed: {exc}") from exc
    if resp.status_code != 200:
        raise YandexError(f"Token exchange rejected ({resp.status_code}): {resp.text}")
    _store_tokens(db, resp.json())
    db.commit()
    _refresh_display_name(db)


def set_direct_token(db: Session, token: str) -> None:
    """Fallback: store a ready-made OAuth token pasted by the user."""
    token = token.strip()
    if not token:
        raise YandexError("Empty token")
    store.set(db, store.YANDEX_ACCESS_TOKEN, token)
    store.delete(db, store.YANDEX_REFRESH_TOKEN)
    store.delete(db, store.YANDEX_TOKEN_EXPIRES_AT)
    db.commit()
    _refresh_display_name(db)


def _refresh_token(db: Session) -> str | None:
    refresh = store.get(db, store.YANDEX_REFRESH_TOKEN)
    client_id = store.get(db, store.YANDEX_CLIENT_ID)
    client_secret = store.get(db, store.YANDEX_CLIENT_SECRET)
    if not (refresh and client_id and client_secret):
        return None
    try:
        resp = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("Yandex token refresh failed: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("Yandex token refresh rejected: %s", resp.text)
        return None
    _store_tokens(db, resp.json())
    db.commit()
    return store.get(db, store.YANDEX_ACCESS_TOKEN)


def get_valid_token(db: Session) -> str | None:
    """Return a usable access token, refreshing if expired."""
    token = store.get(db, store.YANDEX_ACCESS_TOKEN)
    if not token:
        return None
    exp = store.get(db, store.YANDEX_TOKEN_EXPIRES_AT)
    if exp:
        try:
            if time.time() >= float(exp):
                return _refresh_token(db) or token
        except ValueError:
            pass
    return token


def is_connected(db: Session) -> bool:
    return bool(store.get(db, store.YANDEX_ACCESS_TOKEN))


# --------------------------------------------------------------------------- #
# Disk API
# --------------------------------------------------------------------------- #
def _refresh_display_name(db: Session) -> None:
    token = store.get(db, store.YANDEX_ACCESS_TOKEN)
    if not token:
        return
    try:
        resp = requests.get(DISK_API, headers=_headers(token), timeout=_TIMEOUT)
        if resp.status_code == 200:
            user = resp.json().get("user") or {}
            name = user.get("display_name") or user.get("login") or ""
            store.set(db, store.YANDEX_DISPLAY_NAME, name)
            db.commit()
    except requests.RequestException:
        pass


def status(db: Session) -> dict:
    return {
        "connected": is_connected(db),
        "display_name": store.get(db, store.YANDEX_DISPLAY_NAME) or None,
        "folder": store.get(db, store.YANDEX_FOLDER),
        "client_id_set": store.is_set(db, store.YANDEX_CLIENT_ID),
        "client_secret_set": store.is_set(db, store.YANDEX_CLIENT_SECRET),
    }


def list_folders(db: Session, path: str = "/") -> list[dict]:
    token = get_valid_token(db)
    if not token:
        raise YandexError("Not connected to Yandex.Disk")
    try:
        resp = requests.get(
            f"{DISK_API}/resources",
            headers=_headers(token),
            params={
                "path": path or "/",
                "limit": 500,
                "sort": "name",
                "fields": "_embedded.items.name,_embedded.items.path,"
                "_embedded.items.type",
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise YandexError(f"Disk request failed: {exc}") from exc
    if resp.status_code == 404:
        return []
    if resp.status_code != 200:
        raise YandexError(f"Disk listing failed ({resp.status_code}): {resp.text}")
    items = (resp.json().get("_embedded") or {}).get("items") or []
    return [
        {"name": it["name"], "path": it["path"]}
        for it in items
        if it.get("type") == "dir"
    ]


def create_folder(db: Session, path: str) -> None:
    token = get_valid_token(db)
    if not token:
        raise YandexError("Not connected to Yandex.Disk")
    resp = requests.put(
        f"{DISK_API}/resources",
        headers=_headers(token),
        params={"path": _norm(path)},
        timeout=_TIMEOUT,
    )
    if resp.status_code in (201, 409):  # created or already exists
        return
    raise YandexError(f"Create folder failed ({resp.status_code}): {resp.text}")


def ensure_folder(db: Session, path: str) -> None:
    """Create every segment of an absolute Disk path, ignoring existing ones."""
    parts = [p for p in _norm(path).split("/") if p]
    cur = ""
    for part in parts:
        cur = f"{cur}/{part}"
        create_folder(db, cur)


def upload_file(db: Session, remote_path: str, data: bytes) -> None:
    token = get_valid_token(db)
    if not token:
        raise YandexError("Not connected to Yandex.Disk")
    # 1) ask for an upload URL
    resp = requests.get(
        f"{DISK_API}/resources/upload",
        headers=_headers(token),
        params={"path": _norm(remote_path), "overwrite": "true"},
        timeout=_TIMEOUT,
    )
    if resp.status_code != 200:
        raise YandexError(f"Upload URL failed ({resp.status_code}): {resp.text}")
    href = resp.json().get("href")
    if not href:
        raise YandexError("No upload href returned")
    # 2) PUT the bytes (no auth needed on the upload URL)
    put = requests.put(href, data=data, timeout=120)
    if put.status_code not in (201, 202):
        raise YandexError(f"Upload PUT failed ({put.status_code})")
