"""Background scheduler that runs periodic backups of all enabled devices."""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from ..config import get_settings
from ..database import SessionLocal
from . import backup_service

logger = logging.getLogger("mikbackup.scheduler")
settings = get_settings()

_scheduler: BackgroundScheduler | None = None
JOB_ID = "backup-all-enabled"


def _job() -> None:
    db = SessionLocal()
    try:
        count = backup_service.run_all_enabled(db)
        logger.info("Scheduled backup run complete for %d device(s)", count)
    except Exception:  # noqa: BLE001
        logger.exception("Scheduled backup run failed")
    finally:
        db.close()


def start() -> None:
    global _scheduler
    if not settings.scheduler_enabled or _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _job,
        trigger="interval",
        hours=max(1, settings.backup_interval_hours),
        id=JOB_ID,
        coalesce=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info(
        "Scheduler started: every %d h", max(1, settings.backup_interval_hours)
    )


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
