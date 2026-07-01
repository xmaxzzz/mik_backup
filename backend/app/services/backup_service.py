"""Orchestrate device backups: run export, persist file + DB row, prune old."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from ..security import decrypt_secret
from . import mikrotik

logger = logging.getLogger("mikbackup.backup")
settings = get_settings()

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _slug(value: str) -> str:
    return _SAFE.sub("_", value).strip("_") or "device"


def _device_dir(device: models.Device) -> Path:
    d = settings.backups_dir / f"{device.id}_{_slug(device.name)}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def backup_file_path(device: models.Device, backup: models.Backup) -> Path:
    return _device_dir(device) / backup.filename


def run_backup(db: Session, device: models.Device) -> models.Backup:
    """Back up a single device. Always records a Backup row (ok or error)."""
    ts = datetime.now(timezone.utc)
    filename = f"{_slug(device.name)}_{ts.strftime('%Y%m%d_%H%M%S')}.rsc"

    try:
        password = decrypt_secret(device.password_enc)
        config = mikrotik.fetch_config(
            host=device.host,
            port=device.port,
            username=device.username,
            password=password,
        )
    except Exception as exc:  # noqa: BLE001 - record any failure
        logger.warning("Backup failed for device %s: %s", device.name, exc)
        backup = models.Backup(
            device_id=device.id,
            filename=filename,
            size_bytes=0,
            status="error",
            message=str(exc)[:1000],
            created_at=ts,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)
        return backup

    path = _device_dir(device) / filename
    path.write_text(config, encoding="utf-8")

    backup = models.Backup(
        device_id=device.id,
        filename=filename,
        size_bytes=path.stat().st_size,
        status="ok",
        message="",
        created_at=ts,
    )
    db.add(backup)
    db.commit()
    db.refresh(backup)

    _prune(db, device)
    logger.info("Backup ok for device %s -> %s", device.name, filename)
    return backup


def _prune(db: Session, device: models.Device) -> None:
    """Keep only the most recent N successful backups per device."""
    keep = settings.backup_retention
    if keep <= 0:
        return
    oks = (
        db.query(models.Backup)
        .filter(models.Backup.device_id == device.id, models.Backup.status == "ok")
        .order_by(models.Backup.created_at.desc())
        .all()
    )
    for old in oks[keep:]:
        try:
            (_device_dir(device) / old.filename).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(old)
    db.commit()


def run_all_enabled(db: Session) -> int:
    devices = db.query(models.Device).filter(models.Device.enabled.is_(True)).all()
    for device in devices:
        run_backup(db, device)
    return len(devices)
