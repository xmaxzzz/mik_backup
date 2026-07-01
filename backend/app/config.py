"""Application configuration loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root inside the container is /app; data lives in /app/data.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Mikrotik Backup"

    # --- secrets (must be provided via environment) ---
    secret_key: str = Field(..., description="JWT signing key")
    encryption_key: str = Field(..., description="Fernet key for device credentials")

    # --- bootstrap admin ---
    admin_user: str = "admin"
    admin_password: str = Field(..., description="Initial admin password")

    # --- auth ---
    access_token_expire_minutes: int = 60 * 12  # 12h

    # --- storage ---
    data_dir: Path = DATA_DIR

    # --- backup scheduler ---
    backup_interval_hours: int = 24
    backup_retention: int = 30  # keep N most recent backups per device
    scheduler_enabled: bool = True

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    return settings
