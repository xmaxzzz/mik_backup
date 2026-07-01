"""App settings (Telegram + Yandex config) and Telegram test."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..services import settings_store as store
from ..services import telegram

app_settings = get_settings()

router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=schemas.SettingsOut)
def get_settings_view(db: Session = Depends(get_db)):
    return schemas.SettingsOut(
        telegram_chat_id=store.get(db, store.TELEGRAM_CHAT_ID),
        telegram_bot_token_set=store.is_set(db, store.TELEGRAM_BOT_TOKEN),
        yandex_client_id=store.get(db, store.YANDEX_CLIENT_ID),
        yandex_client_secret_set=store.is_set(db, store.YANDEX_CLIENT_SECRET),
        yandex_folder=store.get(db, store.YANDEX_FOLDER),
        availability_interval_sec=app_settings.availability_interval_sec,
    )


@router.put("", response_model=schemas.SettingsOut)
def update_settings(payload: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)
    mapping = {
        "telegram_bot_token": store.TELEGRAM_BOT_TOKEN,
        "telegram_chat_id": store.TELEGRAM_CHAT_ID,
        "yandex_client_id": store.YANDEX_CLIENT_ID,
        "yandex_client_secret": store.YANDEX_CLIENT_SECRET,
        "yandex_folder": store.YANDEX_FOLDER,
    }
    for field, key in mapping.items():
        if field in data:
            store.set(db, key, data[field])
    db.commit()
    return get_settings_view(db)


@router.post("/test-telegram")
def test_telegram(db: Session = Depends(get_db)):
    ok, error = telegram.send_message(
        db, "✅ <b>Mikrotik Backup</b>\nТестовое сообщение — уведомления работают."
    )
    return {"ok": ok, "error": error}
