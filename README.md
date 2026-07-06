# Mikrotik Backup

Self-hosted backup system for MikroTik / RouterOS devices. Register your routers
once and the app pulls a full configuration export (`/export`) over SSH — on
per-schedule cron jobs and on demand — storing each snapshot as a versioned
`.rsc` file you can download, mirror to Yandex.Disk, and get notified about in
Telegram.

- **Backend:** FastAPI (Python 3.12) + SQLite + APScheduler
- **Frontend:** React SPA (Vite), served by the backend
- **Packaging:** Docker Compose — app + a **Caddy** reverse proxy terminating TLS
- **Security:** JWT auth, device credentials + tokens encrypted at rest with Fernet; app port is not published — only Caddy (80/443) is exposed to the host

---

## Features

- 🔐 Admin login with forced first-run password change
- 🖧 Add / edit / delete devices; SSH port defaults to **10322**
- 🔑 **Two auth modes per device:** shared application **SSH key** (recommended) or password
- 🕑 **Named schedules** (cron) — one background job per schedule; devices attach to a schedule or stay manual-only
- 💾 On-demand and scheduled config backups (`/export show-sensitive`)
- 🟢 **Live online/offline dot** per device (parallel TCP reachability probe, independent of backup status), auto-refreshing in the UI
- ☁️ **Yandex.Disk** integration — OAuth connect + folder picker; every backup is mirrored to `<folder>/<device>/`
- 📨 **Telegram** notifications on every backup (success / error) + test button
- 🖥 **In-browser SSH terminal** per device (xterm.js over WebSocket, key/password auth, copy-paste)
- 📥 **Bulk CSV import** of devices (preview → confirm)
- 🗂 Per-device backup history with download
- 🔒 Device passwords + Yandex/Telegram tokens encrypted with Fernet — never in plaintext
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
#    also set SERVER_IP=<this server's LAN/VPN IP> so the SSH-key helper script is ready to paste

# 3. edit the Caddyfile if your server's IP differs from 192.168.200.121

# 4. build & run
docker compose up -d --build
```

Then open **<https://SERVER_IP>** (Caddy, port 443 — not `:8000`), sign in as
`admin` with the `ADMIN_PASSWORD` you generated, and set a new password when
prompted.

The app container's port 8000 is **not published to the host** (`expose`,
not `ports`) — it is reachable only from the `caddy` container over the
internal Compose network. All traffic in must go through Caddy.

### TLS certificate

Caddy is configured with `tls internal`: it mints its own local CA and issues
itself a certificate for the server's IP — no public DNS or ACME challenge
needed, which fits a LAN-only deployment.

**Install the root CA on every client that uses the app.** Clicking through the
browser's untrusted-cert warning is *not* enough for the in-browser SSH terminal:
browsers refuse `wss://` WebSocket connections to an untrusted cert even after
you proceed past the page warning. Trusting the CA fixes both the warning and
the terminal. Download it from the app itself:

```
https://<server-ip>/mik-ca.crt
```

Then import it into **Trusted Root Certification Authorities** (Windows:
double-click → Install → Local Machine → that store; or
`Import-Certificate -FilePath mik-ca.crt -CertStoreLocation Cert:\LocalMachine\Root`),
and fully restart the browser. The root CA is valid for ~10 years; the leaf
certs Caddy rotates under it are then trusted automatically.

> **Why the Caddyfile has a `default_sni` global option.** Browsers (and
> curl/most TLS clients) don't send the SNI extension when the URL host is a
> bare IP address (RFC 6066) — SNI exists to disambiguate hostnames, and an IP
> literal doesn't need it. Without `default_sni 192.168.200.121`, Caddy has no
> certificate to offer on those SNI-less connections and the TLS handshake
> fails outright. `default_sni` tells Caddy which certificate to fall back to
> in that case. If you change the server's IP, update it in both the site
> blocks and this global option.

Health check:

```bash
curl -sk https://SERVER_IP/api/health
# {"status":"ok","app":"Mikrotik Backup"}
```

---

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)).
Backup timing, Telegram and Yandex.Disk are configured **in the UI**, not via env.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECRET_KEY` | ✅ | — | JWT signing key |
| `ENCRYPTION_KEY` | ✅ | — | Fernet key for encrypting device credentials + tokens |
| `ADMIN_PASSWORD` | ✅ | — | Initial admin password (first run only) |
| `ADMIN_USER` | | `admin` | Initial admin username |
| `SERVER_IP` | | `""` | This server's LAN/VPN IP, used in the ready-to-paste RouterOS SSH-key script |
| `DEFAULT_SSH_PORT` | | `10322` | Default SSH port for new / imported devices |
| `BACKUP_RETENTION` | | `30` | Backups kept per device (0 = unlimited) |
| `AVAILABILITY_INTERVAL_SEC` | | `60` | How often every device is TCP-probed for the online/offline dot |
| `SCHEDULER_ENABLED` | | `true` | Toggle all background jobs (backups + availability) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | | `720` | JWT lifetime |

> **Never commit `.env`.** It contains secrets and is git-ignored. Generate
> secrets on the host you deploy to. The application SSH private key lives in
> `data/ssh/` (also git-ignored) and never leaves the server.

Backups, the SQLite database and the SSH key live in the `./data` volume and
persist across rebuilds.

---

## Schedules

Backup timing is managed by **named schedules** (section “Расписания”). Each
enabled schedule is a 5-field cron expression and becomes one background job that
backs up every enabled device attached to it. Presets are offered (daily 03:00,
every 6 hours, hourly, Mondays 02:00). A device with no schedule is backed up
only on demand. On first run a default schedule **“Каждые 24 часа”** (`0 0 * * *`)
is created and all existing devices are attached to it.

---

## SSH-key auth (recommended)

On first start the app generates two keypairs in `data/ssh/` (chmod 600): an
**RSA** key and an **ED25519** key. The provisioning script installs the **RSA**
public key because older RouterOS (6.x / early 7.x) can't `ssh-keys import`
ed25519 keys ("unable to load key file"); RSA import works on every version.
When connecting, the app offers both keys, so devices provisioned earlier with
the ed25519 key keep working.

Provisioning is per device: open the device card and click **«Сгенерировать
пароль»** — the app stores a random account password for that device
(Fernet-encrypted, viewable via «Показать пароль») and produces a ready-to-paste
RouterOS script. Nothing is uploaded manually — the script creates the key file
right on the router (`import` removes the file afterwards):

```
/ip service enable ssh
/ip service set ssh port=<device port> address=""
/file print file=backup_key
:delay 2s
/file set backup_key.txt contents="ssh-rsa AAAA... mik-backup"
/user add name=backuser group=full password="<generated & stored>"
/user ssh-keys import public-key-file=backup_key.txt user=backuser
```

The app logs into key-auth devices with the SSH key — the stored password is
for your own admin access to the router account. The public key itself is
available under **Устройства → SSH-ключ приложения**.

---

## Yandex.Disk

1. Register an app at <https://oauth.yandex.ru/client/new> with permissions
   `cloud_api:disk.read` + `cloud_api:disk.write` and redirect URI
   `https://oauth.yandex.ru/verification_code`.
2. In **Настройки → Яндекс.Диск** enter `client_id` / `client_secret`.
3. Click **Подключить**, authorize, copy the shown code, paste it back
   (or paste a ready-made OAuth token via the fallback).
4. Pick / create the target folder (default `/mikrotik-backups`).

After each successful backup the `.rsc` is uploaded to
`<folder>/<device>/`. A Yandex failure never fails the backup — it is logged and
the backup is flagged `yandex_uploaded = false`.

---

## Telegram

In **Настройки → Telegram** enter the bot token and chat id, then **Отправить
тест**. After every backup a success (device, size, storage) or error (device,
reason) message is sent via `sendMessage` (HTML).

---

## SSH terminal

Each device row has an **SSH** button that opens an in-browser terminal
(xterm.js) connected to the router over a WebSocket (`/api/terminal/{id}`).
The backend opens an interactive PTY via paramiko using the same auth as
backups — the shared application key for key-auth devices, or the stored
password otherwise. Copy-paste works (Ctrl+Shift+V or right-click), and the
terminal resizes with the window. The WebSocket is authenticated with the
JWT passed as a `?token=` query parameter (browsers can't set an
Authorization header on a WebSocket handshake) and is proxied transparently
by Caddy.

## CSV import

**Устройства → Импорт списка** accepts a CSV (≤ 1 MB), columns
`host, port (def 10322), login (def backup), note`. You get a preview with
checkboxes, choose the auth mode (shared key or shared password) and a schedule,
then confirm.

```csv
host,port,login,note
10.0.0.1,10322,backuser,Office router
10.0.0.2,,backuser,Warehouse
```

---

## API

Interactive docs at `/docs`. Key endpoints (all under `/api`):

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` · `GET /api/auth/me` · `POST /api/auth/change-password` | Auth |
| `GET/POST` | `/api/devices` | List (incl. `online`, `last_check_at`, `auth_type`, `schedule_id`) / create |
| `PATCH/DELETE` | `/api/devices/{id}` | Update / delete |
| `POST` | `/api/devices/{id}/backup` | Back up now |
| `POST` | `/api/devices/import` · `/api/devices/import/confirm` | CSV preview / confirm |
| `GET/POST/PATCH/DELETE` | `/api/schedules` | Schedule CRUD |
| `GET` | `/api/backups` · `/api/backups/{id}/download` | List / download |
| `GET/PUT` | `/api/settings` · `POST /api/settings/test-telegram` | Telegram/Yandex config + test |
| `GET` | `/api/yandex/status` · `/auth-url` · `/folders` | Yandex status / connect / browse |
| `POST` | `/api/yandex/exchange` · `/token` · `/folders` · `/disconnect` | Yandex connect / folder |
| `GET` | `/api/ssh-key` | Public key + ready RouterOS script |

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

## License

MIT
