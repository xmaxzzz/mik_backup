"""Tiny, dependency-free schema migrations for SQLite.

``Base.metadata.create_all`` creates *new* tables but never ALTERs existing
ones. Since we ship without Alembic, we add missing columns by hand (SQLite
supports ``ALTER TABLE ADD COLUMN``) and run one-time data migrations.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .database import Base

logger = logging.getLogger("mikbackup.migrations")

# table -> {column: "SQL type + default"}
_COLUMNS: dict[str, dict[str, str]] = {
    "devices": {
        "auth_type": "VARCHAR(16) DEFAULT 'key'",
        "password_enc": "TEXT DEFAULT ''",
        "comment": "TEXT DEFAULT ''",
        "schedule_id": "INTEGER",
        "online": "BOOLEAN",
        "last_check_at": "DATETIME",
    },
    "backups": {
        "yandex_uploaded": "BOOLEAN DEFAULT 0",
    },
}


def run_migrations(engine: Engine) -> None:
    # 1. create any tables that don't exist yet
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in _COLUMNS.items():
            if table not in existing_tables:
                continue  # freshly created by create_all with the full schema
            have = {c["name"] for c in inspector.get_columns(table)}
            for col, ddl in columns.items():
                if col in have:
                    continue
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {col} {ddl}'))
                logger.info("Migration: added %s.%s", table, col)
                # devices that predate auth_type had passwords -> mark them
                if table == "devices" and col == "auth_type":
                    conn.execute(
                        text(
                            "UPDATE devices SET auth_type='password' "
                            "WHERE password_enc IS NOT NULL AND password_enc != ''"
                        )
                    )

    _ensure_default_schedule(engine)


def _ensure_default_schedule(engine: Engine) -> None:
    """If no schedules exist, create a default one and attach unscheduled devices."""
    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM schedules")).scalar() or 0
        if count > 0:
            return
        conn.execute(
            text(
                "INSERT INTO schedules (name, cron, enabled, created_at) "
                "VALUES (:n, :c, 1, CURRENT_TIMESTAMP)"
            ),
            {"n": "Каждые 24 часа", "c": "0 0 * * *"},
        )
        sched_id = conn.execute(
            text("SELECT id FROM schedules WHERE name = :n"),
            {"n": "Каждые 24 часа"},
        ).scalar()
        conn.execute(
            text("UPDATE devices SET schedule_id = :sid WHERE schedule_id IS NULL"),
            {"sid": sched_id},
        )
        logger.info("Migration: created default schedule (id=%s)", sched_id)
