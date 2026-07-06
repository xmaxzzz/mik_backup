"""Application configuration loaded from environment / .env.

Secrets (SECRET_KEY, ENCRYPTION_KEY, ADMIN_PASSWORD) may be supplied via the
environment for full control, but if left unset they are auto-generated and
persisted in ``data/instance.env`` on first start — so a bare
``docker compose up -d`` works with zero manual setup.
"""
from __future__ import annotations

import logging
import secrets as _secrets
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("mikbackup.config")

# Project root inside the container is /app; data lives in /app/data.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"

# Persists auto-generated secrets inside the data volume (survives rebuilds).
_INSTANCE_FILE = "instance.env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Mikrotik Backup"

    # --- secrets (auto-generated & persisted if left blank; env overrides) ---
    secret_key: str = ""       # JWT signing key
    encryption_key: str = ""   # Fernet key for device credentials

    # --- bootstrap admin ---
    admin_user: str = "admin"
    admin_password: str = ""   # initial admin password (first run only)

    # --- auth ---
    access_token_expire_minutes: int = 60 * 12  # 12h

    # --- storage ---
    data_dir: Path = DATA_DIR

    # --- backups ---
    backup_retention: int = 30  # keep N most recent backups per device
    default_ssh_port: int = 10322  # default SSH port for new/imported devices
    scheduler_enabled: bool = True

    # --- availability checks ---
    availability_interval_sec: int = 60  # TCP reachability poll interval

    # --- ssh-key onboarding hints ---
    # LAN/VPN address of THIS server that routers connect back to (used in ready_rsc)
    server_ip: str = ""

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def ssh_dir(self) -> Path:
        return self.data_dir / "ssh"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"


def _read_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    except OSError:
        pass
    return data


def _write_env_file(path: Path, data: dict[str, str]) -> None:
    header = (
        "# Auto-generated instance secrets for Mikrotik Backup.\n"
        "# Keep this file safe and backed up — it holds the key that decrypts\n"
        "# stored device credentials. Deleting it generates new secrets, which\n"
        "# makes all previously encrypted data (passwords, tokens) unreadable.\n"
    )
    body = "".join(f"{key}={value}\n" for key, value in data.items())
    path.write_text(header + body, encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:  # e.g. Windows / restricted FS
        pass


def _ensure_instance_secrets(settings: Settings) -> None:
    """Fill any blank secret from data/instance.env, generating + persisting it
    on first run. An explicit env value always wins and is never persisted."""
    path = settings.data_dir / _INSTANCE_FILE
    persisted = _read_env_file(path)
    generated: dict[str, str] = {}

    def resolve(attr: str, key: str, gen) -> None:
        if getattr(settings, attr):            # provided via env / .env
            return
        if persisted.get(key):                 # from a previous auto-gen
            setattr(settings, attr, persisted[key])
            return
        value = gen()                          # first run: generate + persist
        setattr(settings, attr, value)
        generated[key] = value

    resolve("secret_key", "SECRET_KEY", lambda: _secrets.token_urlsafe(48))
    resolve("encryption_key", "ENCRYPTION_KEY", lambda: Fernet.generate_key().decode())
    resolve("admin_password", "ADMIN_PASSWORD", lambda: _secrets.token_urlsafe(12))

    if generated:
        _write_env_file(path, {**persisted, **generated})
        if "ADMIN_PASSWORD" in generated:
            logger.warning(
                "Generated instance secrets in %s — initial admin login: %s / %s "
                "(change it on first sign-in)",
                path, settings.admin_user, generated["ADMIN_PASSWORD"],
            )
        else:
            logger.warning("Generated instance secrets in %s", path)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()  # type: ignore[call-arg]
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    settings.ssh_dir.mkdir(parents=True, exist_ok=True)
    _ensure_instance_secrets(settings)
    return settings
