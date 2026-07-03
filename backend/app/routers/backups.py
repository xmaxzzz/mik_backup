"""List, download and delete backups."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import backup_service

router = APIRouter(
    prefix="/backups",
    tags=["backups"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[schemas.BackupOut])
def list_backups(
    device_id: int | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(models.Backup)
    if device_id is not None:
        q = q.filter(models.Backup.device_id == device_id)
    return q.order_by(models.Backup.created_at.desc()).limit(limit).all()


@router.get("/{backup_id}/download")
def download_backup(backup_id: int, db: Session = Depends(get_db)):
    backup = db.get(models.Backup, backup_id)
    if backup is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    if backup.status != "ok":
        raise HTTPException(status_code=404, detail="No file for a failed backup")
    device = db.get(models.Device, backup.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    path = backup_service.backup_file_path(device, backup)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup file is missing on disk")
    return FileResponse(
        path, media_type="text/plain", filename=backup.filename
    )


@router.delete("/{backup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_backup(backup_id: int, db: Session = Depends(get_db)):
    backup = db.get(models.Backup, backup_id)
    if backup is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    device = db.get(models.Device, backup.device_id)
    if device is not None:
        try:
            backup_service.backup_file_path(device, backup).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(backup)
    db.commit()
