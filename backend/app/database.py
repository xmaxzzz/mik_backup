"""SQLAlchemy engine / session setup (SQLite)."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    # timeout gives SQLite a busy-wait so concurrent scheduler jobs
    # (backups + availability polling) don't hit "database is locked".
    connect_args={"check_same_thread": False, "timeout": 15},
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
