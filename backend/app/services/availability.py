"""Live device reachability: parallel TCP connect (no SSH auth)."""
from __future__ import annotations

import logging
import socket
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal

logger = logging.getLogger("mikbackup.availability")

_CONNECT_TIMEOUT = 4.0
_MAX_WORKERS = 32


def _tcp_ok(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=_CONNECT_TIMEOUT):
            return True
    except OSError:
        return False


def check_all(db: Session | None = None) -> int:
    """Probe every device's host:port and store online + last_check_at."""
    own_session = db is None
    db = db or SessionLocal()
    try:
        devices = db.query(models.Device).all()
        if not devices:
            return 0
        targets = [(d.id, d.host, d.port) for d in devices]
        workers = min(_MAX_WORKERS, len(targets))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(
                pool.map(lambda t: (t[0], _tcp_ok(t[1], t[2])), targets)
            )
        now = datetime.now(timezone.utc)
        online_by_id = dict(results)
        for device in devices:
            device.online = online_by_id.get(device.id)
            device.last_check_at = now
        db.commit()
        return len(devices)
    finally:
        if own_session:
            db.close()
