"""Connect to a RouterOS device over SSH and fetch its configuration export.

We run ``/export`` over SSH and capture stdout as a text ``.rsc`` file. This is
the most portable approach: it needs only SSH access (no FTP/SCP of binary
``.backup`` files) and produces a human-readable, version-controllable config.
"""
from __future__ import annotations

import socket

import paramiko
from paramiko.pkey import PKey

# ``/export`` hides secrets by default on modern RouterOS. ``show-sensitive``
# includes them so the backup can actually be restored. Falls back gracefully
# on older firmware that doesn't know the flag.
_EXPORT_CMD = "/export show-sensitive"
_EXPORT_FALLBACK = "/export"

_CONNECT_TIMEOUT = 15
_EXEC_TIMEOUT = 120


class BackupError(RuntimeError):
    """Raised when a device backup could not be produced."""


def fetch_config(
    host: str,
    port: int,
    username: str,
    password: str | None = None,
    pkey: PKey | None = None,
) -> str:
    """Return the RouterOS config export text, or raise BackupError.

    Authenticates with ``pkey`` when provided, otherwise with ``password``.
    """
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password if pkey is None else None,
            pkey=pkey,
            timeout=_CONNECT_TIMEOUT,
            banner_timeout=_CONNECT_TIMEOUT,
            auth_timeout=_CONNECT_TIMEOUT,
            look_for_keys=False,
            allow_agent=False,
        )
    except paramiko.AuthenticationException as exc:
        raise BackupError(f"Authentication failed for {username}@{host}") from exc
    except (paramiko.SSHException, socket.error, OSError) as exc:
        raise BackupError(f"Cannot connect to {host}:{port}: {exc}") from exc

    try:
        output = _run(client, _EXPORT_CMD)
        if not output.strip():
            output = _run(client, _EXPORT_FALLBACK)
    finally:
        client.close()

    text = output.strip()
    if not text:
        raise BackupError("Empty configuration returned by device")
    return text + "\n"


def _run(client: paramiko.SSHClient, command: str) -> str:
    stdin, stdout, stderr = client.exec_command(command, timeout=_EXEC_TIMEOUT)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    # RouterOS reports bad syntax on stderr while returning empty stdout.
    if err.strip() and not out.strip():
        raise BackupError(err.strip())
    return out
