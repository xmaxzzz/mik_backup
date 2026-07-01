"""Device CRUD, on-demand backup trigger, and CSV bulk import."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..security import encrypt_secret
from ..services import backup_service

settings = get_settings()

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    dependencies=[Depends(get_current_user)],
)

_MAX_CSV_BYTES = 1_000_000  # 1 MB


def _to_out(device: models.Device) -> schemas.DeviceOut:
    latest = device.backups[0] if device.backups else None
    return schemas.DeviceOut(
        id=device.id,
        name=device.name,
        host=device.host,
        port=device.port,
        username=device.username,
        auth_type=device.auth_type,
        enabled=device.enabled,
        schedule_id=device.schedule_id,
        schedule_name=device.schedule.name if device.schedule else None,
        online=device.online,
        last_check_at=device.last_check_at,
        created_at=device.created_at,
        last_backup_at=latest.created_at if latest else None,
        last_backup_status=latest.status if latest else None,
        last_backup_error=(latest.message if latest and latest.status == "error" else None),
        backup_count=sum(1 for b in device.backups if b.status == "ok"),
    )


def _get_or_404(db: Session, device_id: int) -> models.Device:
    device = db.get(models.Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _validate_schedule(db: Session, schedule_id: int | None) -> None:
    if schedule_id is not None and db.get(models.Schedule, schedule_id) is None:
        raise HTTPException(status_code=400, detail="Unknown schedule_id")


@router.get("", response_model=list[schemas.DeviceOut])
def list_devices(db: Session = Depends(get_db)):
    devices = db.query(models.Device).order_by(models.Device.name).all()
    return [_to_out(d) for d in devices]


@router.post("", response_model=schemas.DeviceOut, status_code=status.HTTP_201_CREATED)
def create_device(payload: schemas.DeviceCreate, db: Session = Depends(get_db)):
    _validate_schedule(db, payload.schedule_id)
    device = models.Device(
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        auth_type=payload.auth_type,
        password_enc=(
            encrypt_secret(payload.password)
            if payload.auth_type == "password" and payload.password
            else ""
        ),
        enabled=payload.enabled,
        schedule_id=payload.schedule_id,
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
    pwd = data.pop("password", None)
    if "schedule_id" in data:
        _validate_schedule(db, data["schedule_id"])
    for field, value in data.items():
        setattr(device, field, value)
    if pwd:
        device.password_enc = encrypt_secret(pwd)
    if device.auth_type == "key":
        device.password_enc = ""
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


# --------------------------------------------------------------------------- #
# CSV bulk import
# --------------------------------------------------------------------------- #
def _parse_csv(text: str) -> list[schemas.ImportRow]:
    rows: list[schemas.ImportRow] = []
    reader = csv.reader(io.StringIO(text))
    records = [r for r in reader if any(cell.strip() for cell in r)]
    if not records:
        return rows

    # detect an optional header row
    header = [c.strip().lower() for c in records[0]]
    has_header = "host" in header
    if has_header:
        idx = {name: header.index(name) for name in header}
        data_rows = records[1:]
    else:
        idx = {"host": 0, "port": 1, "login": 2, "note": 3}
        data_rows = records

    def cell(row: list[str], key: str) -> str:
        i = idx.get(key)
        if i is None or i >= len(row):
            return ""
        return row[i].strip()

    for raw in data_rows:
        host = cell(raw, "host")
        port_s = cell(raw, "port")
        login = cell(raw, "login") or "backuser"
        note = cell(raw, "note")
        error = None
        port = settings.default_ssh_port
        if not host:
            error = "host is empty"
        elif port_s:
            try:
                port = int(port_s)
                if not (1 <= port <= 65535):
                    raise ValueError
            except ValueError:
                error = f"invalid port: {port_s}"
        rows.append(
            schemas.ImportRow(
                host=host or "(empty)",
                port=port,
                login=login,
                note=note,
                valid=error is None,
                error=error,
            )
        )
    return rows


@router.post("/import", response_model=schemas.ImportPreview)
async def import_preview(file: UploadFile = File(...)):
    raw = await file.read(_MAX_CSV_BYTES + 1)
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV file too large (limit 1 MB)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = _parse_csv(text)
    return schemas.ImportPreview(
        rows=rows,
        total=len(rows),
        valid_count=sum(1 for r in rows if r.valid),
    )


@router.post("/import/confirm", response_model=schemas.ImportResult)
def import_confirm(payload: schemas.ImportConfirmRequest, db: Session = Depends(get_db)):
    _validate_schedule(db, payload.schedule_id)
    created: list[models.Device] = []
    pwd_enc = (
        encrypt_secret(payload.password)
        if payload.auth_type == "password" and payload.password
        else ""
    )
    for row in payload.rows:
        if not row.host.strip():
            continue
        name = row.note.strip() or row.host.strip()
        device = models.Device(
            name=name,
            host=row.host.strip(),
            port=row.port,
            username=row.login.strip() or "backuser",
            auth_type=payload.auth_type,
            password_enc=pwd_enc,
            enabled=True,
            schedule_id=payload.schedule_id,
        )
        db.add(device)
        created.append(device)
    db.commit()
    for d in created:
        db.refresh(d)
    return schemas.ImportResult(created=len(created), devices=[_to_out(d) for d in created])
