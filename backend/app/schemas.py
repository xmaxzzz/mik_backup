"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

AuthType = str  # "key" | "password"


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


# --- schedules ---
class ScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    cron: str = Field(min_length=1, max_length=128)
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    cron: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None


class ScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    cron: str
    enabled: bool
    device_count: int = 0


# --- devices ---
class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=10322, ge=1, le=65535)
    username: str = Field(default="backuser", min_length=1, max_length=128)
    auth_type: AuthType = "key"
    password: str | None = None
    comment: str = ""
    enabled: bool = True
    schedule_id: int | None = None

    @model_validator(mode="after")
    def _check_password(self):
        if self.auth_type == "password" and not self.password:
            raise ValueError("password is required when auth_type is 'password'")
        return self


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=128)
    auth_type: AuthType | None = None
    password: str | None = None
    comment: str | None = None
    enabled: bool | None = None
    schedule_id: int | None = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    comment: str = ""
    has_password: bool = False
    enabled: bool
    schedule_id: int | None = None
    schedule_name: str | None = None
    online: bool | None = None
    last_check_at: datetime | None = None
    created_at: datetime
    last_backup_at: datetime | None = None
    last_backup_status: str | None = None
    last_backup_error: str | None = None
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
    yandex_uploaded: bool = False
    created_at: datetime


# --- settings (Telegram + Yandex config) ---
class SettingsOut(BaseModel):
    telegram_chat_id: str | None = None
    telegram_bot_token_set: bool = False
    yandex_client_id: str | None = None
    yandex_client_secret_set: bool = False
    yandex_folder: str | None = None
    availability_interval_sec: int = 60


class SettingsUpdate(BaseModel):
    # None => leave unchanged; "" => clear; value => set
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    yandex_client_id: str | None = None
    yandex_client_secret: str | None = None
    yandex_folder: str | None = None


# --- yandex ---
class YandexStatus(BaseModel):
    connected: bool
    display_name: str | None = None
    folder: str | None = None
    client_id_set: bool = False
    client_secret_set: bool = False


class YandexCode(BaseModel):
    code: str = Field(min_length=1)


class YandexTokenDirect(BaseModel):
    token: str = Field(min_length=1)


class YandexFolderPath(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


class YandexFolderItem(BaseModel):
    name: str
    path: str


# --- ssh key ---
class SshKeyOut(BaseModel):
    public_key: str


class DevicePasswordOut(BaseModel):
    password: str


class GeneratedPasswordOut(BaseModel):
    password: str
    ready_rsc: str


# --- CSV import ---
class ImportRow(BaseModel):
    host: str
    port: int = 10322
    login: str = "backuser"
    note: str = ""
    valid: bool = True
    error: str | None = None


class ImportPreview(BaseModel):
    rows: list[ImportRow]
    total: int
    valid_count: int


class ImportConfirmRow(BaseModel):
    host: str
    port: int = Field(default=10322, ge=1, le=65535)
    login: str = "backuser"
    note: str = ""


class ImportConfirmRequest(BaseModel):
    rows: list[ImportConfirmRow]
    auth_type: AuthType = "key"
    password: str | None = None  # shared password when auth_type == "password"
    schedule_id: int | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.auth_type == "password" and not self.password:
            raise ValueError("password is required when auth_type is 'password'")
        return self


class ImportResult(BaseModel):
    created: int
    devices: list[DeviceOut]
