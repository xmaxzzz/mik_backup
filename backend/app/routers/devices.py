"""Device CRUD and on-demand backup trigger."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..security import encrypt_secret
from ..services import backup_service

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    dependencies=[Depends(get_current_user)],
)


def _to_out(device: models.Device) -> schemas.DeviceOut:
    latest = device.backups[0] if device.backups else None
    return schemas.DeviceOut(
        id=device.id,
        name=device.name,
        host=device.host,
        port=device.port,
        username=device.username,
        enabled=device.enabled,
        created_at=device.created_at,
        last_backup_at=latest.created_at if latest else None,
        last_backup_status=latest.status if latest else None,
        backup_count=sum(1 for b in device.backups if b.status == "ok"),
    )


def _get_or_404(db: Session, device_id: int) -> models.Device:
    device = db.get(models.Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.get("", response_model=list[schemas.DeviceOut])
def list_devices(db: Session = Depends(get_db)):
    devices = db.query(models.Device).order_by(models.Device.name).all()
    return [_to_out(d) for d in devices]


@router.post("", response_model=schemas.DeviceOut, status_code=status.HTTP_201_CREATED)
def create_device(payload: schemas.DeviceCreate, db: Session = Depends(get_db)):
    device = models.Device(
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        password_enc=encrypt_secret(payload.password),
        enabled=payload.enabled,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return _to_out(device)


@router.patch("/{device_id}", response_model=schemas.DeviceOut)
def update_device(
    device_id: int, payload: schemas.DeviceUpdate, db: Session = Depends(get_db)
):
    device = _get_or_404(db, device_id)
    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        pwd = data.pop("password")
        if pwd:
            device.password_enc = encrypt_secret(pwd)
    for field, value in data.items():
        setattr(device, field, value)
    db.commit()
    db.refresh(device)
    return _to_out(device)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(device_id: int, db: Session = Depends(get_db)):
    device = _get_or_404(db, device_id)
    db.delete(device)
    db.commit()


@router.post("/{device_id}/backup", response_model=schemas.BackupOut)
def trigger_backup(device_id: int, db: Session = Depends(get_db)):
    device = _get_or_404(db, device_id)
    backup = backup_service.run_backup(db, device)
    if backup.status != "ok":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=backup.message
        )
    return backup
