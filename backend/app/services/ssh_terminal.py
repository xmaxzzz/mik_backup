"""Bridge an interactive SSH shell (paramiko) to a WebSocket.

Used by the in-browser terminal. Authenticates to the device with the shared
application key (auth_type=key) or the stored password, opens a PTY shell and
pumps bytes both ways. Terminal resize arrives as a JSON text frame; keystrokes
arrive as binary frames; device output is sent back as binary frames.
"""
from __future__ import annotations

import asyncio
import json
import logging

import paramiko
from starlette.websockets import WebSocket, WebSocketState

from ..security import decrypt_secret
from . import ssh_keys

logger = logging.getLogger("mikbackup.terminal")

_CONNECT_TIMEOUT = 15


async def bridge(
    websocket: WebSocket,
    *,
    host: str,
    port: int,
    username: str,
    auth_type: str,
    password_enc: str,
    password_override: str | None = None,
) -> None:
    """Bridge a shell to the WebSocket.

    ``password_override`` (plaintext, not stored) forces a one-off password
    login — used when the key isn't installed on the router yet.
    """
    loop = asyncio.get_running_loop()
    base_kwargs = dict(
        hostname=host,
        port=port,
        username=username,
        timeout=_CONNECT_TIMEOUT,
        banner_timeout=_CONNECT_TIMEOUT,
        auth_timeout=_CONNECT_TIMEOUT,
        look_for_keys=False,
        allow_agent=False,
    )
    # one auth attempt per key in its OWN connection (RouterOS drops the session
    # after a rejected key, so several keys in one session never fall through)
    if password_override is not None:
        attempts = [{"password": password_override}]
    elif auth_type == "key":
        attempts = [{"key_filename": [kf]} for kf in ssh_keys.private_key_files()]
    else:
        attempts = [{"password": decrypt_secret(password_enc) if password_enc else ""}]

    client = None
    last_exc: Exception | None = None
    for auth in attempts:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            await loop.run_in_executor(
                None, lambda a=auth, cl=c: cl.connect(**base_kwargs, **a)
            )
            client = c
            break
        except Exception as exc:  # noqa: BLE001 - try the next key/auth
            last_exc = exc
            c.close()

    if client is None:
        # RouterOS drops the session on a rejected key (SSHException, not
        # AuthenticationException) — treat any key-auth failure as auth-related
        # so the UI offers the login/password fallback with the right hint.
        is_auth = (
            isinstance(last_exc, paramiko.AuthenticationException)
            or (auth_type == "key" and password_override is None)
        )
        await _safe_send_json(websocket, {"type": "conn_failed", "auth": is_auth})
        msg = (
            f"Ошибка аутентификации для {username}@{host}:{port}."
            if is_auth
            else f"Не удалось подключиться к {host}:{port}: {last_exc}"
        )
        await _safe_send_text(websocket, f"\r\n\x1b[31m*** {msg}\x1b[0m\r\n")
        await _safe_close(websocket)
        return

    chan = client.invoke_shell(term="xterm-256color", width=120, height=30)
    chan.settimeout(0.0)
    await _safe_send_text(
        websocket, f"\x1b[32m*** Подключено к {host}:{port} ({username})\x1b[0m\r\n"
    )

    out_task = asyncio.create_task(_pump_out(websocket, chan))
    in_task = asyncio.create_task(_pump_in(websocket, chan, loop))
    try:
        done, pending = await asyncio.wait(
            {out_task, in_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
    finally:
        try:
            chan.close()
        except Exception:  # noqa: BLE001
            pass
        client.close()
        await _safe_close(websocket)


async def _pump_out(websocket: WebSocket, chan) -> None:
    """Device -> browser."""
    try:
        while True:
            await asyncio.sleep(0.02)
            sent = False
            while chan.recv_ready():
                data = chan.recv(32768)
                if not data:
                    return
                await websocket.send_bytes(data)
                sent = True
            if chan.closed or chan.eof_received:
                # flush anything remaining
                while chan.recv_ready():
                    data = chan.recv(32768)
                    if not data:
                        break
                    await websocket.send_bytes(data)
                return
            _ = sent
    except Exception:  # noqa: BLE001 - socket closed / disconnect
        return


async def _pump_in(websocket: WebSocket, chan, loop) -> None:
    """Browser -> device (keystrokes) + resize control frames."""
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            if msg.get("bytes") is not None:
                await loop.run_in_executor(None, chan.send, msg["bytes"])
            elif msg.get("text") is not None:
                txt = msg["text"]
                obj = None
                try:
                    obj = json.loads(txt)
                except ValueError:
                    obj = None
                if isinstance(obj, dict) and obj.get("type") == "resize":
                    try:
                        chan.resize_pty(
                            width=int(obj.get("cols", 120)),
                            height=int(obj.get("rows", 30)),
                        )
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    await loop.run_in_executor(None, chan.send, txt.encode())
    except Exception:  # noqa: BLE001 - disconnect
        return


async def _safe_send_text(websocket: WebSocket, text: str) -> None:
    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_text(text)
    except Exception:  # noqa: BLE001
        pass


async def _safe_send_json(websocket: WebSocket, obj: dict) -> None:
    # sent as a text frame; the client parses text frames that are JSON with a
    # "type" field as control messages, everything else is terminal output.
    await _safe_send_text(websocket, json.dumps(obj))


async def _safe_close(websocket: WebSocket) -> None:
    try:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()
    except Exception:  # noqa: BLE001
        pass
