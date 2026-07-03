"""Connect to a RouterOS device over SSH and fetch its configuration export.

We run ``/export`` over SSH and capture stdout as a text ``.rsc`` file. This is
the most portable approach: it needs only SSH access (no FTP/SCP of binary
``.backup`` files) and produces a human-readable, version-controllable config.
"""
from __future__ import annotations

import paramiko

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
    key_files: list[str] | None = None,
) -> str:
    """Return the RouterOS config export text, or raise BackupError.

    With ``key_files`` each key is tried in its OWN connection — RouterOS
    disconnects after the first rejected public key, so offering several keys
    in one session ("No existing session") never reaches the second key.
    """
    # one auth attempt per key (separate connection), or a single password auth
    if key_files:
        attempts = [{"key_filename": [kf]} for kf in key_files]
    else:
        attempts = [{"password": password}]

    last_exc: Exception | None = None
    for auth in attempts:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                hostname=host,
                port=port,
                username=username,
                timeout=_CONNECT_TIMEOUT,
                banner_timeout=_CONNECT_TIMEOUT,
                auth_timeout=_CONNECT_TIMEOUT,
                look_for_keys=False,
                allow_agent=False,
                **auth,
            )
        except Exception as exc:  # noqa: BLE001 - try the next key/auth
            last_exc = exc
            client.close()
            continue

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

    if isinstance(last_exc, paramiko.AuthenticationException):
        raise BackupError(f"Authentication failed for {username}@{host}") from last_exc
    raise BackupError(f"Cannot connect to {host}:{port}: {last_exc}") from last_exc


def _run(client: paramiko.SSHClient, command: str) -> str:
    stdin, stdout, stderr = client.exec_command(command, timeout=_EXEC_TIMEOUT)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    # RouterOS reports bad syntax on stderr while returning empty stdout.
    if err.strip() and not out.strip():
        raise BackupError(err.strip())
    return out
