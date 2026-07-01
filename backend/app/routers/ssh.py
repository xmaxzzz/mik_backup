"""Expose the application's public SSH key + a ready-to-paste RouterOS script."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import schemas
from ..config import get_settings
from ..deps import get_current_user
from ..services import ssh_keys

settings = get_settings()

router = APIRouter(
    prefix="/ssh-key",
    tags=["ssh-key"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=schemas.SshKeyOut)
def get_ssh_key():
    return schemas.SshKeyOut(
        public_key=ssh_keys.get_public_key(),
        ready_rsc=ssh_keys.build_ready_rsc(port=settings.default_ssh_port),
    )
