"""Password hashing, JWT tokens, and Fernet credential encryption."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet
from passlib.context import CryptContext

from .config import get_settings

settings = get_settings()

# pbkdf2_sha256 is pure-python — avoids native bcrypt version pitfalls on deploy.
_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

_ALGORITHM = "HS256"

# Validate the Fernet key early with a clear error rather than at first use.
try:
    _fernet = Fernet(settings.encryption_key.encode())
except Exception as exc:  # pragma: no cover - config error path
    raise RuntimeError(
        "ENCRYPTION_KEY is not a valid Fernet key. Generate one with:\n"
        '  python -c "from cryptography.fernet import Fernet;'
        'print(Fernet.generate_key().decode())"'
    ) from exc


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd.verify(password, password_hash)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def encrypt_secret(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()
