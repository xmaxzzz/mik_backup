# Mikrotik Backup

Self-hosted backup system for MikroTik / RouterOS devices. Register your routers
once and the app pulls a full configuration export (`/export`) over SSH — on a
schedule and on demand — storing each snapshot as a versioned `.rsc` file you can
download at any time.

- **Backend:** FastAPI (Python 3.12) + SQLite + APScheduler
- **Frontend:** React SPA (Vite), served by the backend
- **Packaging:** single Docker image, `docker compose up`
- **Security:** JWT auth, device credentials encrypted at rest with Fernet

---

## Features

- 🔐 Admin login with forced first-run password change
- 🖧 Add / edit / delete devices (host, SSH port, credentials)
- 💾 On-demand and scheduled config backups (`/export show-sensitive`)
- 🗂 Per-device backup history with download
- 🔒 Device passwords encrypted with a Fernet key — never stored in plaintext
- ♻️ Automatic retention (keeps the N most recent backups per device)

---

## Quick start (Docker)

```bash
git clone https://github.com/xmaxzzz/mik_backup.git
cd mik_backup

# 1. create your environment file
cp .env.example .env

# 2. generate the three secrets and put them in .env
python3 -c "import secrets; print('SECRET_KEY='+secrets.token_urlsafe(48))"
python3 -c "from cryptography.fernet import Fernet; print('ENCRYPTION_KEY='+Fernet.generate_key().decode())"
python3 -c "import secrets; print('ADMIN_PASSWORD='+secrets.token_urlsafe(12))"

# 3. build & run
docker compose up -d --build
```

Then open <http://SERVER_IP:8000>, sign in as `admin` with the `ADMIN_PASSWORD`
you generated, and set a new password when prompted.

Health check:

```bash
curl -s localhost:8000/api/health
# {"status":"ok","app":"Mikrotik Backup"}
```

---

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECRET_KEY` | ✅ | — | JWT signing key |
| `ENCRYPTION_KEY` | ✅ | — | Fernet key for encrypting device credentials |
| `ADMIN_PASSWORD` | ✅ | — | Initial admin password (first run only) |
| `ADMIN_USER` | | `admin` | Initial admin username |
| `BACKUP_INTERVAL_HOURS` | | `24` | Scheduled backup interval |
| `BACKUP_RETENTION` | | `30` | Backups kept per device (0 = unlimited) |
| `SCHEDULER_ENABLED` | | `true` | Toggle the background scheduler |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | | `720` | JWT lifetime |

> **Never commit `.env`.** It contains secrets and is git-ignored. Generate
> secrets on the host you deploy to.

Backups and the SQLite database live in the `./data` volume and persist across
rebuilds.

---

## How backups work

For each enabled device the app connects over SSH and runs:

```
/export show-sensitive
```

The text output is saved to `data/backups/<device>/<name>_<timestamp>.rsc`.
`show-sensitive` includes secrets so the export can actually be restored; on
older RouterOS that don't support the flag it falls back to plain `/export`.

To restore, paste the `.rsc` contents into a router terminal or run
`/import file-name=...` after uploading it.

---

## API

Interactive docs are available at `/docs`. Key endpoints (all under `/api`):

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Obtain a JWT |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/change-password` | Change password |
| `GET/POST` | `/api/devices` | List / create devices |
| `PATCH/DELETE` | `/api/devices/{id}` | Update / delete a device |
| `POST` | `/api/devices/{id}/backup` | Back up a device now |
| `GET` | `/api/backups` | List backups (optional `?device_id=`) |
| `GET` | `/api/backups/{id}/download` | Download a backup file |

---

## Development

```bash
# backend
cd backend
python -m venv .venv && . .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
# provide SECRET_KEY / ENCRYPTION_KEY / ADMIN_PASSWORD in your shell or a .env
uvicorn app.main:app --reload

# frontend (in another terminal — proxies /api to :8000)
cd frontend
npm install
npm run dev   # http://localhost:5173
```

---

## Prerequisites on your MikroTik devices

Create a dedicated backup user with SSH access, e.g.:

```
/user add name=backup password=<strong> group=full
/ip service enable ssh
```

A read/full group is needed for `/export` to include all configuration.

---

## License

MIT
