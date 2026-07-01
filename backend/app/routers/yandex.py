"""Yandex.Disk connection and folder management."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import settings_store as store
from ..services import yandex
from ..services.yandex import YandexError

router = APIRouter(
    prefix="/yandex",
    tags=["yandex"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/status", response_model=schemas.YandexStatus)
def status(db: Session = Depends(get_db)):
    return schemas.YandexStatus(**yandex.status(db))


@router.get("/auth-url")
def auth_url(db: Session = Depends(get_db)):
    try:
        return {"auth_url": yandex.build_auth_url(db)}
    except YandexError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/exchange", response_model=schemas.YandexStatus)
def exchange(payload: schemas.YandexCode, db: Session = Depends(get_db)):
    try:
        yandex.exchange_code(db, payload.code)
    except YandexError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return schemas.YandexStatus(**yandex.status(db))


@router.post("/token", response_model=schemas.YandexStatus)
def direct_token(payload: schemas.YandexTokenDirect, db: Session = Depends(get_db)):
    try:
        yandex.set_direct_token(db, payload.token)
    except YandexError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return schemas.YandexStatus(**yandex.status(db))


@router.post("/disconnect", response_model=schemas.YandexStatus)
def disconnect(db: Session = Depends(get_db)):
    for key in (
        store.YANDEX_ACCESS_TOKEN,
        store.YANDEX_REFRESH_TOKEN,
        store.YANDEX_TOKEN_EXPIRES_AT,
        store.YANDEX_DISPLAY_NAME,
    ):
        store.delete(db, key)
    db.commit()
    return schemas.YandexStatus(**yandex.status(db))


@router.get("/folders", response_model=list[schemas.YandexFolderItem])
def list_folders(path: str = "/", db: Session = Depends(get_db)):
    try:
        return [schemas.YandexFolderItem(**f) for f in yandex.list_folders(db, path)]
    except YandexError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/folders", response_model=schemas.YandexFolderItem)
def create_folder(payload: schemas.YandexFolderPath, db: Session = Depends(get_db)):
    try:
        yandex.create_folder(db, payload.path)
    except YandexError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    name = payload.path.rstrip("/").rsplit("/", 1)[-1]
    return schemas.YandexFolderItem(name=name, path=payload.path)
