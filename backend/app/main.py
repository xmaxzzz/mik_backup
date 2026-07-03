"""FastAPI application entry point for Mikrotik Backup."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import models
from .config import get_settings
from .database import SessionLocal, engine
from .migrations import run_migrations
from .routers import (
    auth,
    backups,
    devices,
    health,
    schedules,
    settings as settings_router,
    ssh,
    terminal,
    yandex,
)
from .security import hash_password
from .services import scheduler, ssh_keys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("mikbackup")

settings = get_settings()
STATIC_DIR = Path(__file__).resolve().parent / "static"


def _bootstrap_admin() -> None:
    db = SessionLocal()
    try:
        exists = db.query(models.User).count() > 0
        if not exists:
            admin = models.User(
                username=settings.admin_user,
                password_hash=hash_password(settings.admin_password),
                is_admin=True,
                must_change_password=True,
            )
            db.add(admin)
            db.commit()
            logger.info("Created initial admin user %r", settings.admin_user)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations(engine)
    _bootstrap_admin()
    ssh_keys.ensure_keys()
    scheduler.start()
    logger.info("%s started", settings.app_name)
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

# --- API routes (registered before the SPA catch-all) ---
api_prefix = "/api"
app.include_router(health.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(devices.router, prefix=api_prefix)
app.include_router(backups.router, prefix=api_prefix)
app.include_router(schedules.router, prefix=api_prefix)
app.include_router(settings_router.router, prefix=api_prefix)
app.include_router(yandex.router, prefix=api_prefix)
app.include_router(ssh.router, prefix=api_prefix)
app.include_router(terminal.router, prefix=api_prefix)


# --- Static SPA ---
if (STATIC_DIR / "index.html").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_DIR / "assets"),
        name="assets",
    )

    @app.get("/", include_in_schema=False)
    def spa_root() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        # Unknown API routes must return a real 404, not the SPA shell.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        # Serve real static files (favicon etc.) if present, else the SPA shell.
        candidate = STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
else:  # pragma: no cover - dev without a built frontend
    @app.get("/", include_in_schema=False)
    def no_frontend() -> dict[str, str]:
        return {"detail": "Frontend not built. API is available under /api."}
