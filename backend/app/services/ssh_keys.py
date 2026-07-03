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


def random_password(length: int = 20) -> str:
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(length))


def build_ready_rsc(port: int, password: str, user: str = "backuser") -> str:
    """Per-device RouterOS script: create the backup account + import the key.

    The key file is created ON the router by the script itself (print-to-file
    + set contents — works on both ROS6 and ROS7), so nothing is uploaded
    manually. ``/user ssh-keys import`` deletes the file after a successful
    import. The password is the device's stored account password (generated
    from the device card); the app itself logs in with the SSH key.
    """
    pub = get_public_key()
    return f"""# --- Mikrotik Backup: enable key-based access ---
# Paste the whole block into the router terminal. The key file is created
# right on the router - nothing to upload manually. The {user} password is
# stored (encrypted) in the backup system - view it any time in the device card.
/file print file=backup_key
:delay 2s
/file set backup_key.txt contents="{pub}"
/user add name={user} group=full password="{password}"
/user ssh-keys import public-key-file=backup_key.txt user={user}
/ip service set ssh port={port} address=""
"""
