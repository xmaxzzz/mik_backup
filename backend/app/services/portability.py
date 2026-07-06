"""Encrypted, portable export / import of the whole configuration.

A single ``.mbk`` bundle carries devices, schedules, app settings (Telegram /
Yandex tokens), the application SSH keypair and — optionally — the backup
history with the actual ``.rsc`` files.

Device passwords and secret settings are stored *decrypted* inside the bundle
and re-encrypted with the target machine's ``ENCRYPTION_KEY`` on import, so a
bundle restores cleanly onto a fresh install that has a *different* key. That is
what makes "deploy anywhere + restore" work without copying secrets around.

The bundle itself is protected with a user passphrase: a scrypt-derived key
feeds Fernet, so the file is useless to anyone without the passphrase.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import secrets as _secrets
from datetime import datetime, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from sqlalchemy.orm import Session

from .. import models
from ..config import get_settings
from ..security import decrypt_secret, encrypt_secret
from . import scheduler
from . import settings_store as store

logger = logging.getLogger("mikbackup.portability")

settings = get_settings()

MAGIC = "MIKBACKUP-EXPORT"
SCHEMA_VERSION = 1

# scrypt work factors (n must be a power of two). 2**15 ≈ interactive-fast.
_SCRYPT_N = 2 ** 15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_MIN_PASSPHRASE = 8


class BundleError(ValueError):
    """Bad passphrase, or a corrupt / incompatible bundle."""


# --------------------------------------------------------------------------- #
# passphrase -> Fernet
# --------------------------------------------------------------------------- #
def _fernet(passphrase: str, salt: bytes, n: int, r: int, p: int) -> Fernet:
    key = Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(passphrase.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(key))


def seal(payload: dict[str, Any], passphrase: str) -> bytes:
    """Serialize + encrypt a payload dict into a portable ``.mbk`` file body."""
    if len(passphrase) < _MIN_PASSPHRASE:
        raise BundleError(f"Пароль должен быть не короче {_MIN_PASSPHRASE} символов")
    salt = _secrets.token_bytes(_SALT_BYTES)
    fernet = _fernet(passphrase, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    token = fernet.encrypt(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    envelope = {
        "magic": MAGIC,
        "version": SCHEMA_VERSION,
        "kdf": {
            "algo": "scrypt",
            "n": _SCRYPT_N,
            "r": _SCRYPT_R,
            "p": _SCRYPT_P,
            "salt": base64.b64encode(salt).decode("ascii"),
        },
        "data": token.decode("ascii"),
    }
    return json.dumps(envelope, ensure_ascii=False).encode("utf-8")


def open_bundle(raw: bytes, passphrase: str) -> dict[str, Any]:
    """Decrypt + parse a ``.mbk`` file body back into a payload dict."""
    try:
        envelope = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BundleError("Файл не является бэкапом Mikrotik Backup")
    if not isinstance(envelope, dict) or envelope.get("magic") != MAGIC:
        raise BundleError("Файл не является бэкапом Mikrotik Backup")
    if envelope.get("version") != SCHEMA_VERSION:
        raise BundleError(f"Несовместимая версия бэкапа: {envelope.get('version')!r}")
    kdf = envelope.get("kdf") or {}
    try:
        salt = base64.b64decode(kdf["salt"])
        fernet = _fernet(
            passphrase,
            salt,
            int(kdf.get("n", _SCRYPT_N)),
            int(kdf.get("r", _SCRYPT_R)),
            int(kdf.get("p", _SCRYPT_P)),
        )
        inner = fernet.decrypt(envelope["data"].encode("ascii"))
    except (KeyError, ValueError, TypeError, binascii.Error):
        raise BundleError("Повреждённый файл бэкапа")
    except InvalidToken:
        raise BundleError("Неверный пароль или повреждённый файл")
    try:
        return json.loads(inner.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BundleError("Повреждённый файл бэкапа")


# --------------------------------------------------------------------------- #
# export
# --------------------------------------------------------------------------- #
def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _dump_schedules(db: Session) -> list[dict[str, Any]]:
    return [
        {"name": s.name, "cron": s.cron, "enabled": s.enabled}
        for s in db.query(models.Schedule).order_by(models.Schedule.name).all()
    ]


def _dump_devices(db: Session, *, include_backups: bool) -> list[dict[str, Any]]:
    devices: list[dict[str, Any]] = []
    for d in db.query(models.Device).order_by(models.Device.name).all():
        password: str | None = None
        if d.password_enc:
            try:
                password = decrypt_secret(d.password_enc)
            except Exception:  # noqa: BLE001 - rotated/corrupt key: skip the secret
                logger.warning("Could not decrypt password for device %s", d.id)
        row: dict[str, Any] = {
            "name": d.name,
            "host": d.host,
            "port": d.port,
            "username": d.username,
            "auth_type": d.auth_type,
            "comment": d.comment or "",
            "enabled": d.enabled,
            "ros_version": d.ros_version,
            "schedule_name": d.schedule.name if d.schedule else None,
            "password": password,
            "created_at": _iso(d.created_at),
        }
        if include_backups:
            row["backups"] = _dump_backups(d)
        devices.append(row)
    return devices


def _dump_backups(device: models.Device) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in device.backups:
        content: str | None = None
        path = settings.backups_dir / b.filename
        try:
            if path.is_file():
                content = base64.b64encode(path.read_bytes()).decode("ascii")
        except OSError:
            logger.warning("Could not read backup file %s", b.filename)
        out.append(
            {
                "filename": b.filename,
                "size_bytes": b.size_bytes,
                "status": b.status,
                "message": b.message or "",
                "yandex_uploaded": b.yandex_uploaded,
                "created_at": _iso(b.created_at),
                "content_b64": content,
            }
        )
    return out


def _dump_ssh_keys() -> dict[str, str]:
    keys: dict[str, str] = {}
    for name in ("id_rsa", "id_rsa.pub", "id_ed25519", "id_ed25519.pub"):
        path = settings.ssh_dir / name
        try:
            if path.is_file():
                keys[name] = path.read_text(encoding="utf-8")
        except OSError:
            logger.warning("Could not read ssh key %s", name)
    return keys


def build_export(
    db: Session,
    *,
    include_settings: bool = True,
    include_ssh_keys: bool = True,
    include_backups: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "meta": {
            "app": "mikrotik-backup",
            "schema": SCHEMA_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
        },
        "schedules": _dump_schedules(db),
        "devices": _dump_devices(db, include_backups=include_backups),
    }
    if include_settings:
        payload["settings"] = store.dump(db)
    if include_ssh_keys:
        payload["ssh_keys"] = _dump_ssh_keys()
    return payload


# --------------------------------------------------------------------------- #
# describe (import preview)
# --------------------------------------------------------------------------- #
def describe(payload: dict[str, Any]) -> dict[str, Any]:
    devices = payload.get("devices") or []
    return {
        "exported_at": (payload.get("meta") or {}).get("exported_at"),
        "device_count": len(devices),
        "schedule_count": len(payload.get("schedules") or []),
        "has_settings": bool(payload.get("settings")),
        "settings_keys": sorted((payload.get("settings") or {}).keys()),
        "has_ssh_keys": bool(payload.get("ssh_keys")),
        "backup_count": sum(len(d.get("backups") or []) for d in devices),
        "devices": [
            {"name": d.get("name") or d.get("host"), "host": d.get("host")}
            for d in devices
        ],
    }


# --------------------------------------------------------------------------- #
# import
# --------------------------------------------------------------------------- #
def _parse_dt(value: str | None) -> datetime:
    if value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _apply_schedules(db: Session, rows: list[dict[str, Any]]) -> dict[str, int]:
    created = updated = 0
    for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        existing = db.query(models.Schedule).filter_by(name=name).first()
        if existing:
            existing.cron = row.get("cron", existing.cron)
            existing.enabled = bool(row.get("enabled", existing.enabled))
            updated += 1
        else:
            db.add(
                models.Schedule(
                    name=name,
                    cron=row.get("cron", "0 0 * * *"),
                    enabled=bool(row.get("enabled", True)),
                )
            )
            created += 1
    db.flush()
    return {"created": created, "updated": updated}


def _apply_devices(
    db: Session, rows: list[dict[str, Any]], *, include_backups: bool
) -> tuple[dict[str, int], int]:
    sched_ids = {s.name: s.id for s in db.query(models.Schedule).all()}
    created = updated = backups_imported = 0
    for row in rows:
        host = (row.get("host") or "").strip()
        username = (row.get("username") or "backuser").strip()
        if not host:
            continue
        sched_id = sched_ids.get(row.get("schedule_name"))
        password = row.get("password")
        pwd_enc = encrypt_secret(password) if password else ""

        device = db.query(models.Device).filter_by(host=host, username=username).first()
        if device:
            device.name = row.get("name") or device.name
            device.port = int(row.get("port", device.port))
            device.auth_type = row.get("auth_type", device.auth_type)
            device.comment = row.get("comment", device.comment) or ""
            device.enabled = bool(row.get("enabled", device.enabled))
            device.ros_version = row.get("ros_version", device.ros_version)
            device.schedule_id = sched_id
            if password:
                device.password_enc = pwd_enc
            updated += 1
        else:
            device = models.Device(
                name=row.get("name") or host,
                host=host,
                port=int(row.get("port", settings.default_ssh_port)),
                username=username,
                auth_type=row.get("auth_type", "key"),
                password_enc=pwd_enc,
                comment=row.get("comment") or "",
                enabled=bool(row.get("enabled", True)),
                ros_version=row.get("ros_version"),
                schedule_id=sched_id,
                created_at=_parse_dt(row.get("created_at")),
            )
            db.add(device)
            created += 1
        db.flush()
        if include_backups:
            backups_imported += _apply_backups(db, device, row.get("backups") or [])
    return {"created": created, "updated": updated}, backups_imported


def _apply_backups(db: Session, device: models.Device, rows: list[dict[str, Any]]) -> int:
    existing = {
        b.filename for b in db.query(models.Backup).filter_by(device_id=device.id).all()
    }
    imported = 0
    for row in rows:
        filename = (row.get("filename") or "").strip()
        if not filename or filename in existing:
            continue
        content_b64 = row.get("content_b64")
        if content_b64:
            try:
                (settings.backups_dir / filename).write_bytes(
                    base64.b64decode(content_b64)
                )
            except (OSError, binascii.Error, ValueError):
                logger.warning("Could not write backup file %s", filename)
        db.add(
            models.Backup(
                device_id=device.id,
                filename=filename,
                size_bytes=int(row.get("size_bytes", 0)),
                status=row.get("status", "ok"),
                message=row.get("message", "") or "",
                yandex_uploaded=bool(row.get("yandex_uploaded", False)),
                created_at=_parse_dt(row.get("created_at")),
            )
        )
        existing.add(filename)
        imported += 1
    return imported


def _restore_ssh_keys(keys: dict[str, str]) -> None:
    settings.ssh_dir.mkdir(parents=True, exist_ok=True)
    for name, text in keys.items():
        if name not in {"id_rsa", "id_rsa.pub", "id_ed25519", "id_ed25519.pub"}:
            continue  # never write arbitrary filenames from an untrusted bundle
        path = settings.ssh_dir / name
        try:
            path.write_text(text, encoding="utf-8")
            if not name.endswith(".pub"):
                path.chmod(0o600)
        except OSError:
            logger.warning("Could not restore ssh key %s", name)


def apply_import(
    db: Session,
    payload: dict[str, Any],
    *,
    mode: str = "merge",
    include_settings: bool = True,
    include_ssh_keys: bool = True,
    include_backups: bool = False,
) -> dict[str, Any]:
    if mode not in ("merge", "replace"):
        raise BundleError(f"Неизвестный режим импорта: {mode!r}")

    if mode == "replace":
        db.query(models.Backup).delete()
        db.query(models.Device).delete()
        db.query(models.Schedule).delete()
        if include_settings:
            db.query(models.Setting).delete()
        db.flush()

    schedules = _apply_schedules(db, payload.get("schedules") or [])
    devices, backups_imported = _apply_devices(
        db, payload.get("devices") or [], include_backups=include_backups
    )

    settings_applied = False
    if include_settings and payload.get("settings"):
        store.load(db, payload["settings"])
        settings_applied = True

    db.commit()

    ssh_keys_applied = False
    if include_ssh_keys and payload.get("ssh_keys"):
        _restore_ssh_keys(payload["ssh_keys"])
        ssh_keys_applied = True

    # rebuild cron jobs from the new schedule set without a restart
    scheduler.reschedule_backups()

    return {
        "mode": mode,
        "schedules_created": schedules["created"],
        "schedules_updated": schedules["updated"],
        "devices_created": devices["created"],
        "devices_updated": devices["updated"],
        "backups_imported": backups_imported,
        "settings_applied": settings_applied,
        "ssh_keys_applied": ssh_keys_applied,
    }
