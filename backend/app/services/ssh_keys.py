"""Manage the shared application SSH keys used for key-based device auth.

On first start an RSA keypair (universally importable on every RouterOS
version) and an ED25519 keypair are generated. Private keys live in the data
volume (chmod 600, never in git). The provisioning script installs the RSA
public key, since older RouterOS (6.x / early 7.x) can't import ed25519 keys
("unable to load key file"). When connecting, the app offers both keys, so
devices already provisioned with the ed25519 key keep working.
"""
from __future__ import annotations

import logging
import secrets
import string

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ..config import get_settings

logger = logging.getLogger("mikbackup.ssh")
settings = get_settings()

_COMMENT = "mik-backup"


def _ed_priv():
    return settings.ssh_dir / "id_ed25519"


def _ed_pub():
    return settings.ssh_dir / "id_ed25519.pub"


def _rsa_priv():
    return settings.ssh_dir / "id_rsa"


def _rsa_pub():
    return settings.ssh_dir / "id_rsa.pub"


def _write_key(priv_path, pub_path, priv_bytes: bytes, pub_bytes: bytes) -> None:
    priv_path.write_bytes(priv_bytes)
    try:
        priv_path.chmod(0o600)
    except OSError:
        pass
    pub_path.write_text(pub_bytes.decode() + f" {_COMMENT}\n", encoding="utf-8")


def ensure_keys() -> None:
    """Generate the RSA + ED25519 keypairs if they don't exist yet."""
    if not (_ed_priv().exists() and _ed_pub().exists()):
        key = Ed25519PrivateKey.generate()
        _write_key(
            _ed_priv(),
            _ed_pub(),
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.OpenSSH,
                encryption_algorithm=serialization.NoEncryption(),
            ),
            key.public_key().public_bytes(
                encoding=serialization.Encoding.OpenSSH,
                format=serialization.PublicFormat.OpenSSH,
            ),
        )
        logger.info("Generated ED25519 application SSH key")

    if not (_rsa_priv().exists() and _rsa_pub().exists()):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _write_key(
            _rsa_priv(),
            _rsa_pub(),
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.OpenSSH,
                encryption_algorithm=serialization.NoEncryption(),
            ),
            key.public_key().public_bytes(
                encoding=serialization.Encoding.OpenSSH,
                format=serialization.PublicFormat.OpenSSH,
            ),
        )
        logger.info("Generated RSA application SSH key")


def get_public_key() -> str:
    """RSA public key — the one installed by the provisioning script (works on
    every RouterOS version, unlike ed25519 on older releases)."""
    ensure_keys()
    return _rsa_pub().read_text(encoding="utf-8").strip()


def private_key_files() -> list[str]:
    """Private key files to offer when authenticating (RSA first, then ed25519
    for devices provisioned before RSA existed)."""
    ensure_keys()
    files = []
    if _rsa_priv().exists():
        files.append(str(_rsa_priv()))
    if _ed_priv().exists():
        files.append(str(_ed_priv()))
    return files


# alphanumeric only: safe to paste into a RouterOS terminal without escaping
_PWD_ALPHABET = string.ascii_letters + string.digits


def random_password(length: int = 20) -> str:
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(length))


def build_ready_rsc(port: int, password: str, user: str = "backuser") -> str:
    pub = get_public_key()
    return f"""/ip service enable ssh
/ip service set ssh port={port} address=""
/file print file=backup_key
:delay 2s
/file set backup_key.txt contents="{pub}"
/user add name={user} group=full password="{password}"
/user ssh-keys import public-key-file=backup_key.txt user={user}
"""
