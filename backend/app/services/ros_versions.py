"""Determine the latest stable RouterOS version.

Source: MikroTik's download-page changelog feed for the stable channel
(https://mikrotik.com/download/changelogs?channelFilter=stable). The plain
NEWEST7.stable file is stale, so we scrape the highest 7.x version listed here
(the same data the download page shows). An admin override in Settings wins.
"""
from __future__ import annotations

import logging
import re
import time

import requests
from sqlalchemy.orm import Session

from . import settings_store as store

logger = logging.getLogger("mikbackup.ros")

_URL = "https://mikrotik.com/download/changelogs?channelFilter=stable"
_TTL_SECONDS = 6 * 3600
_TIMEOUT = 15
# RouterOS 7 version: 7.<minor>[.<patch>], bounded so it doesn't match digit runs
_VER_RE = re.compile(r"\b7\.\d{1,2}(?:\.\d{1,3})?\b")


def _ver_key(v: str) -> tuple[int, int, int]:
    parts = [int(x) for x in v.split(".")]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])  # type: ignore[return-value]


def _fetch() -> str | None:
    resp = requests.get(
        _URL, timeout=_TIMEOUT, headers={"User-Agent": "mik-backup/1.0"}
    )
    if resp.status_code != 200:
        return None
    versions = _VER_RE.findall(resp.text)
    if not versions:
        return None
    return max(versions, key=_ver_key)


def get_latest_stable(db: Session) -> str | None:
    """Latest stable version. Admin override wins; else auto-detect (cached 6h);
    on a failed fetch the last cached value (possibly None) is returned."""
    manual = store.get(db, store.ROS_LATEST_MANUAL)
    if manual:
        return manual

    cached = store.get(db, store.ROS_LATEST_STABLE)
    checked = store.get(db, store.ROS_LATEST_CHECKED)
    fresh = False
    if checked:
        try:
            fresh = (time.time() - float(checked)) < _TTL_SECONDS
        except ValueError:
            fresh = False
    if cached and fresh:
        return cached

    try:
        version = _fetch()
        if version:
            store.set(db, store.ROS_LATEST_STABLE, version)
            store.set(db, store.ROS_LATEST_CHECKED, str(int(time.time())))
            db.commit()
            logger.info("Latest stable RouterOS: %s", version)
            return version
    except Exception as exc:  # noqa: BLE001 - network flaky; keep last value
        logger.warning("Could not fetch latest RouterOS version: %s", exc)
    return cached
