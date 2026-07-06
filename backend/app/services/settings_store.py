"""Persistent key/value settings (Yandex + Telegram). Secrets are Fernet-encrypted."""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .. import models
from ..security import decrypt_secret, encrypt_secret

logger = logging.getLogger("mikbackup.settings")

# Setting keys
TELEGRAM_BOT_TOKEN = "telegram_bot_token"       # secret
TELEGRAM_CHAT_ID = "telegram_chat_id"
YANDEX_CLIENT_ID = "yandex_client_id"
YANDEX_CLIENT_SECRET = "yandex_client_secret"   # secret
YANDEX_ACCESS_TOKEN = "yandex_access_token"     # secret
YANDEX_REFRESH_TOKEN = "yandex_refresh_token"   # secret
YANDEX_TOKEN_EXPIRES_AT = "yandex_token_expires_at"  # unix ts (str)
YANDEX_FOLDER = "yandex_folder"
YANDEX_DISPLAY_NAME = "yandex_display_name"
ROS_LATEST_STABLE = "ros_latest_stable"        # auto-fetched from mikrotik.com
ROS_LATEST_CHECKED = "ros_latest_checked"      # unix ts of last fetch
ROS_LATEST_MANUAL = "ros_latest_manual"        # admin override (takes priority)

_SECRET_KEYS = {
    TELEGRAM_BOT_TOKEN,
    YANDEX_CLIENT_SECRET,
    YANDEX_ACCESS_TOKEN,
    YANDEX_REFRESH_TOKEN,
}

_DEFAULTS = {
    YANDEX_FOLDER: "/mikrotik-backups",
}


def get(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.get(models.Setting, key)
    if row is None or row.value == "":
        return default if default is not None else _DEFAULTS.get(key)
    if key in _SECRET_KEYS:
        try:
            return decrypt_secret(row.value)
        except Exception:  # noqa: BLE001 - corrupt/rotated key
            logger.warning("Could not decrypt setting %s", key)
            return default
    return row.value


def set(db: Session, key: str, value: str | None) -> None:
    row = db.get(models.Setting, key)
    if value is None or value == "":
        if row is not None:
            db.delete(row)
        return
    stored = encrypt_secret(value) if key in _SECRET_KEYS else value
    if row is None:
        db.add(models.Setting(key=key, value=stored))
    else:
        row.value = stored


def is_set(db: Session, key: str) -> bool:
    row = db.get(models.Setting, key)
    return row is not None and row.value != ""


def delete(db: Session, key: str) -> None:
    row = db.get(models.Setting, key)
    if row is not None:
        db.delete(row)


def dump(db: Session) -> dict[str, str]:
    """All persisted settings as plaintext (secret values decrypted).

    Used by the config export. Secrets that can't be decrypted (rotated key)
    are skipped rather than exported as ciphertext, which would be useless on
    a machine with a different key.
    """
    out: dict[str, str] = {}
    for row in db.query(models.Setting).all():
        if not row.value:
            continue
        if row.key in _SECRET_KEYS:
            try:
                out[row.key] = decrypt_secret(row.value)
            except Exception:  # noqa: BLE001 - corrupt/rotated key
                logger.warning("Skipping unreadable secret %s during export", row.key)
                continue
        else:
            out[row.key] = row.value
    return out


def load(db: Session, data: dict[str, str]) -> int:
    """Restore settings from a plaintext mapping, re-encrypting secrets with
    this machine's key. Returns the number of keys written."""
    count = 0
    for key, value in data.items():
        set(db, key, value)
        count += 1
    return count
