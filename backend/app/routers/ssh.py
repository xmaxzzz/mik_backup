"""Expose the application's public SSH key.

The per-device RouterOS script (with a generated password) is produced by
POST /api/devices/{id}/generate-password.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import schemas
from ..deps import get_current_user
from ..services import ssh_keys

router = APIRouter(
    prefix="/ssh-key",
    tags=["ssh-key"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=schemas.SshKeyOut)
def get_ssh_key():
    return schemas.SshKeyOut(public_key=ssh_keys.get_public_key())
