"""Schedule CRUD. Each enabled schedule becomes one cron backup job."""
from __future__ import annotations

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import scheduler

router = APIRouter(
    prefix="/schedules",
    tags=["schedules"],
    dependencies=[Depends(get_current_user)],
)


def _validate_cron(cron: str) -> None:
    try:
        CronTrigger.from_crontab(cron)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid cron expression: {cron!r}",
        )


def _to_out(db: Session, sched: models.Schedule) -> schemas.ScheduleOut:
    count = (
        db.query(models.Device)
        .filter(models.Device.schedule_id == sched.id)
        .count()
    )
    return schemas.ScheduleOut(
        id=sched.id,
        name=sched.name,
        cron=sched.cron,
        enabled=sched.enabled,
        device_count=count,
    )


def _get_or_404(db: Session, schedule_id: int) -> models.Schedule:
    sched = db.get(models.Schedule, schedule_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return sched


@router.get("", response_model=list[schemas.ScheduleOut])
def list_schedules(db: Session = Depends(get_db)):
    schedules = db.query(models.Schedule).order_by(models.Schedule.name).all()
    return [_to_out(db, s) for s in schedules]


@router.post("", response_model=schemas.ScheduleOut, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: schemas.ScheduleCreate, db: Session = Depends(get_db)):
    _validate_cron(payload.cron)
    if db.query(models.Schedule).filter(models.Schedule.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Schedule name already exists")
    sched = models.Schedule(
        name=payload.name, cron=payload.cron, enabled=payload.enabled
    )
    db.add(sched)
    db.commit()
    db.refresh(sched)
    scheduler.reschedule_backups()
    return _to_out(db, sched)


@router.patch("/{schedule_id}", response_model=schemas.ScheduleOut)
def update_schedule(
    schedule_id: int, payload: schemas.ScheduleUpdate, db: Session = Depends(get_db)
):
    sched = _get_or_404(db, schedule_id)
    data = payload.model_dump(exclude_unset=True)
    if "cron" in data and data["cron"]:
        _validate_cron(data["cron"])
    if "name" in data and data["name"] and data["name"] != sched.name:
        dup = (
            db.query(models.Schedule)
            .filter(models.Schedule.name == data["name"])
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="Schedule name already exists")
    for field, value in data.items():
        setattr(sched, field, value)
    db.commit()
    db.refresh(sched)
    scheduler.reschedule_backups()
    return _to_out(db, sched)


@router.get("/{schedule_id}/devices", response_model=list[int])
def get_schedule_devices(schedule_id: int, db: Session = Depends(get_db)):
    """IDs of devices currently attached to this schedule."""
    _get_or_404(db, schedule_id)
    rows = (
        db.query(models.Device.id)
        .filter(models.Device.schedule_id == schedule_id)
        .all()
    )
    return [r[0] for r in rows]


@router.post("/{schedule_id}/devices", response_model=schemas.ScheduleOut)
def set_schedule_devices(
    schedule_id: int,
    payload: schemas.ScheduleDevicesRequest,
    db: Session = Depends(get_db),
):
    """Set this schedule's device membership in bulk.

    Devices in ``device_ids`` are attached to this schedule; devices previously
    on this schedule but not listed are detached (schedule_id=NULL). Devices on
    *other* schedules are left untouched. Backup jobs read membership at run
    time, so no rescheduling is needed.
    """
    sched = _get_or_404(db, schedule_id)
    ids = list(dict.fromkeys(payload.device_ids))  # de-dup, keep order

    # detach devices currently on this schedule that aren't in the new set
    detach_q = db.query(models.Device).filter(
        models.Device.schedule_id == schedule_id
    )
    if ids:
        detach_q = detach_q.filter(models.Device.id.notin_(ids))
    detach_q.update({models.Device.schedule_id: None}, synchronize_session=False)

    # attach the selected devices to this schedule
    if ids:
        db.query(models.Device).filter(models.Device.id.in_(ids)).update(
            {models.Device.schedule_id: schedule_id}, synchronize_session=False
        )

    db.commit()
    db.refresh(sched)
    return _to_out(db, sched)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    sched = _get_or_404(db, schedule_id)
    # detach devices -> they become manual-only
    db.query(models.Device).filter(models.Device.schedule_id == schedule_id).update(
        {models.Device.schedule_id: None}
    )
    db.delete(sched)
    db.commit()
    scheduler.reschedule_backups()
