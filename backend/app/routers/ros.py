"""Latest stable RouterOS version (from mikrotik.com), for the UI to flag
outdated devices."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..services import ros_versions

router = APIRouter(
    prefix="/ros",
    tags=["ros"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/latest")
def latest_stable(db: Session = Depends(get_db)):
    return {"version": ros_versions.get_latest_stable(db)}
