"""WebSocket endpoint for the in-browser SSH terminal.

Auth is via a ``token`` query parameter (browsers can't set an Authorization
header on a WebSocket handshake). The token is the same JWT used by the REST
API.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket

from .. import models
from ..database import SessionLocal
from ..security import decode_access_token
from ..services import ssh_terminal

logger = logging.getLogger("mikbackup.terminal")

router = APIRouter(prefix="/terminal", tags=["terminal"])


@router.websocket("/{device_id}")
async def device_terminal(
    websocket: WebSocket,
    device_id: int,
    token: str = Query(default=""),
    auth: str = Query(default=""),
):
    username = decode_access_token(token)
    if not username:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        user = (
            db.query(models.User).filter(models.User.username == username).first()
        )
        if user is None:
            await websocket.close(code=4401)
            return
        device = db.get(models.Device, device_id)
        if device is None:
            await websocket.close(code=4404)
            return
        # snapshot auth material so we don't hold the DB during the session
        host = device.host
        port = device.port
        dev_username = device.username
        auth_type = device.auth_type
        password_enc = device.password_enc
    finally:
        db.close()

    await websocket.accept()

    # One-off login/password mode: the client sends a credentials frame first.
    # Nothing is stored — used when the app key isn't installed on the router.
    login_user = dev_username
    password_override = None
    if auth == "password":
        try:
            creds = await asyncio.wait_for(websocket.receive_json(), timeout=120)
        except Exception:  # noqa: BLE001 - no creds / disconnect
            await websocket.close()
            return
        login_user = (creds.get("username") or dev_username).strip() or dev_username
        password_override = creds.get("password") or ""

    logger.info(
        "Terminal session opened for device %s by %s (%s)",
        device_id,
        username,
        "password" if password_override is not None else auth_type,
    )
    try:
        await ssh_terminal.bridge(
            websocket,
            host=host,
            port=port,
            username=login_user,
            auth_type=auth_type,
            password_enc=password_enc,
            password_override=password_override,
        )
    finally:
        logger.info("Terminal session closed for device %s", device_id)
