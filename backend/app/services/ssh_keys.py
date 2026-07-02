"""Manage the shared application SSH key used for key-based device auth.

On first start an ED25519 keypair is generated. The private key lives in the
data volume (chmod 600, never in git); the public key is handed to the user to
install on each RouterOS device.
"""
from __future__ import annotations

import logging
import secrets
import string
from functools import lru_cache

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ..config import get_settings

logger = logging.getLogger("mikbackup.ssh")
settings = get_settings()

_COMMENT = "mik-backup"


def _priv_path():
    return settings.ssh_dir / "id_ed25519"


def _pub_path():
    return settings.ssh_dir / "id_ed25519.pub"


def ensure_keys() -> None:
    """Generate the ED25519 keypair if it does not exist yet."""
    priv, pub = _priv_path(), _pub_path()
    if priv.exists() and pub.exists():
        return
    key = Ed25519PrivateKey.generate()
    priv_bytes = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_bytes = key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    )
    priv.write_bytes(priv_bytes)
    try:
        priv.chmod(0o600)
    except OSError:
        pass
    pub.write_text(pub_bytes.decode() + f" {_COMMENT}\n", encoding="utf-8")
    logger.info("Generated ED25519 application SSH key")


def get_public_key() -> str:
    ensure_keys()
    return _pub_path().read_text(encoding="utf-8").strip()


@lru_cache
def load_private_key() -> paramiko.Ed25519Key:
    ensure_keys()
    return paramiko.Ed25519Key.from_private_key_file(str(_priv_path()))


# alphanumeric only: safe to paste into a RouterOS terminal without escaping
_PWD_ALPHABET = string.ascii_letters + string.digits


def _random_password(length: int = 20) -> str:
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(length))


def build_ready_rsc(port: int, user: str = "backuser") -> str:
    """RouterOS script the user pastes to enable key-based backup access.

    A fresh random password is embedded on every call. The app itself never
    uses it (it logs in with the SSH key) — it only prevents the account from
    being created with an empty password, which would allow password-less
    logins via other services.
    """
    server = settings.server_ip or "<SERVER_IP>"
    pub = get_public_key()
    pwd = _random_password()
    return f"""# --- Mikrotik Backup: enable key-based access ---
# 1) Upload the public key file (below) to the router's Files as "backup_key.pub".
#    Public key:
#    {pub}
#
# 2) Then run in the router terminal. The password below is randomly
#    generated for this script and is NOT used by the backup app (it logs
#    in with the key) — it only keeps the account from having an empty
#    password. No need to save it anywhere.
/ip service set ssh port={port} address=""
/user add name={user} group=full password="{pwd}"
/user/ssh-keys import public-key-file=backup_key.pub user={user}
#
# 3) If your firewall has an input drop rule, allow the backup port from the
#    server ABOVE that drop rule:
/ip firewall filter add chain=input protocol=tcp dst-port={port} \\
    src-address={server} action=accept comment="mik-backup" place-before=0
"""
