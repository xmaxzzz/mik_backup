"""Fetch and cache the current stable RouterOS version from mikrotik.com."""
from __future__ import annotations

import logging
import time

import requests
from sqlalchemy.orm import Session

from . import settings_store as store

logger = logging.getLogger("mikbackup.ros")

# RouterOS itself uses these files for "Check for updates"; the body is
# "<version> <build-unix-time>", e.g. "7.16.1 1728316800".
_URL = "https://upgrade.mikrotik.com/routeros/NEWEST7.stable"
_TTL_SECONDS = 6 * 3600
_TIMEOUT = 6


def get_latest_stable(db: Session) -> str | None:
    """Return the cached latest stable version, refreshing at most every 6h.

    On a failed fetch the last cached value (possibly None) is returned — the
    server's outbound network is occasionally flaky and this must never break
    the device list.
    """
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
        resp = requests.get(_URL, timeout=_TIMEOUT)
        if resp.status_code == 200:
            version = resp.text.strip().split()[0] if resp.text.strip() else ""
            if version and version[0].isdigit():
                store.set(db, store.ROS_LATEST_STABLE, version)
                store.set(db, store.ROS_LATEST_CHECKED, str(int(time.time())))
                db.commit()
                logger.info("Latest stable RouterOS: %s", version)
                return version
    except Exception as exc:  # noqa: BLE001 - network flaky; keep last value
        logger.warning("Could not fetch latest RouterOS version: %s", exc)
    return cached
