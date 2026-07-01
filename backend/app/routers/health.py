"""Health check endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import get_settings

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name}
