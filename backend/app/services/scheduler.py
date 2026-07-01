"""Background scheduler: one cron job per enabled Schedule + availability polling."""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .. import models
from ..config import get_settings
from ..database import SessionLocal
from . import availability, backup_service

logger = logging.getLogger("mikbackup.scheduler")
settings = get_settings()

_scheduler: BackgroundScheduler | None = None
_AVAIL_JOB = "availability"
_SCHED_PREFIX = "schedule-"


def _backup_job(schedule_id: int) -> None:
    db = SessionLocal()
    try:
        count = backup_service.run_for_schedule(db, schedule_id)
        logger.info("Schedule %s: backed up %d device(s)", schedule_id, count)
    except Exception:  # noqa: BLE001
        logger.exception("Backup job failed for schedule %s", schedule_id)
    finally:
        db.close()


def _availability_job() -> None:
    try:
        availability.check_all()
    except Exception:  # noqa: BLE001
        logger.exception("Availability check failed")


def reschedule_backups() -> None:
    """Rebuild per-schedule backup jobs from the DB. Safe to call anytime."""
    if _scheduler is None:
        return
    for job in _scheduler.get_jobs():
        if job.id.startswith(_SCHED_PREFIX):
            job.remove()
    db = SessionLocal()
    try:
        schedules = (
            db.query(models.Schedule).filter(models.Schedule.enabled.is_(True)).all()
        )
        for sched in schedules:
            try:
                trigger = CronTrigger.from_crontab(sched.cron, timezone="UTC")
            except ValueError:
                logger.warning(
                    "Skipping schedule %s: invalid cron %r", sched.id, sched.cron
                )
                continue
            _scheduler.add_job(
                _backup_job,
                trigger=trigger,
                args=[sched.id],
                id=f"{_SCHED_PREFIX}{sched.id}",
                coalesce=True,
                max_instances=1,
                replace_existing=True,
            )
        logger.info("Scheduled %d backup job(s)", len(schedules))
    finally:
        db.close()


def start() -> None:
    global _scheduler
    if not settings.scheduler_enabled or _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")

    # ongoing availability polling
    _scheduler.add_job(
        _availability_job,
        trigger="interval",
        seconds=max(10, settings.availability_interval_sec),
        id=_AVAIL_JOB,
        coalesce=True,
        max_instances=1,
    )
    # run an availability check immediately at startup (one-shot 'date' job)
    _scheduler.add_job(_availability_job, id="availability-initial")

    _scheduler.start()
    reschedule_backups()
    logger.info(
        "Scheduler started (availability every %ds)",
        max(10, settings.availability_interval_sec),
    )


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
