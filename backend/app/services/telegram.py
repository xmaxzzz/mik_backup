"""Telegram Bot API wrapper (sendMessage). All failures are swallowed/logged."""
from __future__ import annotations

import html
import logging

import requests
from sqlalchemy.orm import Session

from . import settings_store as store

logger = logging.getLogger("mikbackup.telegram")

_API = "https://api.telegram.org/bot{token}/sendMessage"
_TIMEOUT = 15


def _config(db: Session) -> tuple[str | None, str | None]:
    return (
        store.get(db, store.TELEGRAM_BOT_TOKEN),
        store.get(db, store.TELEGRAM_CHAT_ID),
    )


def is_configured(db: Session) -> bool:
    token, chat = _config(db)
    return bool(token and chat)


def send_message(db: Session, text: str) -> tuple[bool, str | None]:
    """Send an HTML message. Returns (ok, error). Never raises."""
    token, chat_id = _config(db)
    if not (token and chat_id):
        return False, "Telegram is not configured"
    try:
        resp = requests.post(
            _API.format(token=token),
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=_TIMEOUT,
        )
        if resp.status_code == 200 and resp.json().get("ok"):
            return True, None
        detail = resp.json().get("description") if resp.content else None
        return False, detail or f"HTTP {resp.status_code}"
    except Exception as exc:  # noqa: BLE001 - never let notifications break flow
        logger.warning("Telegram send failed: %s", exc)
        return False, str(exc)


def notify_backup(db: Session, device, backup) -> None:
    """Fire a success/error notification for a completed backup attempt."""
    if not is_configured(db):
        return
    name = html.escape(device.name)
    host = html.escape(f"{device.host}:{device.port}")
    if backup.status == "ok":
        size_kb = f"{backup.size_bytes / 1024:.1f} KB"
        ya = "☁️ на Я.Диске" if backup.yandex_uploaded else "💾 локально"
        text = (
            f"✅ <b>Бэкап выполнен</b>\n"
            f"Устройство: <b>{name}</b> ({host})\n"
            f"Размер: {size_kb}\n"
            f"Хранилище: {ya}"
        )
    else:
        reason = html.escape((backup.message or "неизвестная ошибка")[:400])
        text = (
            f"❌ <b>Ошибка бэкапа</b>\n"
            f"Устройство: <b>{name}</b> ({host})\n"
            f"Причина: {reason}"
        )
    send_message(db, text)
