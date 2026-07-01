"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# --- auth ---
class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_admin: bool
    must_change_password: bool


# --- devices ---
class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1)
    enabled: bool = True


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=128)
    password: str | None = None
    enabled: bool | None = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    host: str
    port: int
    username: str
    enabled: bool
    created_at: datetime
    last_backup_at: datetime | None = None
    last_backup_status: str | None = None
    backup_count: int = 0


# --- backups ---
class BackupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    filename: str
    size_bytes: int
    status: str
    message: str
    created_at: datetime
