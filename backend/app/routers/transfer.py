"""Encrypted export / import of the whole configuration (devices, schedules,
settings, SSH keys and optionally backup history) as a single ``.mbk`` file."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import portability

router = APIRouter(
    prefix="/transfer",
    tags=["transfer"],
    dependencies=[Depends(get_current_user)],
)

# Bundles may embed the .rsc backup archive, so allow a generous size.
_MAX_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("/export")
def export_config(payload: schemas.ExportRequest, db: Session = Depends(get_db)):
    data = portability.build_export(
        db,
        include_settings=payload.include_settings,
        include_ssh_keys=payload.include_ssh_keys,
        include_backups=payload.include_backups,
    )
    try:
        blob = portability.seal(data, payload.passphrase)
    except portability.BundleError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    filename = f"mikbackup-{datetime.now().strftime('%Y%m%d-%H%M')}.mbk"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _read_bundle(file: UploadFile, passphrase: str) -> dict:
    raw = await file.read(_MAX_BYTES + 1)
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Файл слишком большой (лимит 100 МБ)")
    try:
        return portability.open_bundle(raw, passphrase)
    except portability.BundleError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/import/preview", response_model=schemas.TransferPreview)
async def import_preview(
    file: UploadFile = File(...),
    passphrase: str = Form(...),
):
    payload = await _read_bundle(file, passphrase)
    return portability.describe(payload)


@router.post("/import/confirm", response_model=schemas.TransferImportResult)
async def import_confirm(
    file: UploadFile = File(...),
    passphrase: str = Form(...),
    mode: str = Form("merge"),
    include_settings: bool = Form(True),
    include_ssh_keys: bool = Form(True),
    include_backups: bool = Form(False),
    db: Session = Depends(get_db),
):
    payload = await _read_bundle(file, passphrase)
    try:
        return portability.apply_import(
            db,
            payload,
            mode=mode,
            include_settings=include_settings,
            include_ssh_keys=include_ssh_keys,
            include_backups=include_backups,
        )
    except portability.BundleError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
