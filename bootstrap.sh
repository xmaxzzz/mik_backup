#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-command deploy / re-deploy of Mikrotik Backup on any Docker host.
#
#   ./bootstrap.sh [SERVER_IP] [--build]
#
# What it does:
#   * sets SERVER_IP (arg, $SERVER_IP env, or auto-detected) — the address
#     Caddy serves TLS for — in .env;
#   * pulls the published multi-arch image from Docker Hub (xmaxzzz/mik-backup)
#     and starts the stack (pass --build or BUILD_LOCAL=1 to build from source);
#   * prints the URL, root-CA link and the initial admin password.
#
# Secrets (SECRET_KEY / ENCRYPTION_KEY / ADMIN_PASSWORD) are NOT created here —
# the app auto-generates them on first start and persists them in
# data/instance.env. That file (the encryption key!) is what to back up; the
# in-app "Экспорт конфигурации" is the portable way to move data between hosts.
#
# Only needs bash + docker (with the compose plugin). Re-running is safe.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env
BUILD_LOCAL="${BUILD_LOCAL:-0}"
IP_ARG=""
for a in "$@"; do
  case "$a" in
    --build) BUILD_LOCAL=1 ;;
    *) IP_ARG="$a" ;;
  esac
done
IP_ARG="${IP_ARG:-${SERVER_IP:-}}"

detect_ip() {
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I | awk '{print $1}'
  else
    ip -4 addr show scope global 2>/dev/null \
      | awk '/inet /{print $2}' | cut -d/ -f1 | head -n1
  fi
}

set_server_ip() {  # write/replace SERVER_IP=<ip> in .env, creating it if needed
  local ip="$1"
  if [ -f "$ENV_FILE" ] && grep -q '^SERVER_IP=' "$ENV_FILE"; then
    sed -i.bak "s|^SERVER_IP=.*|SERVER_IP=$ip|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    umask 077
    echo "SERVER_IP=$ip" >> "$ENV_FILE"
  fi
}

if ! docker compose version >/dev/null 2>&1; then
  echo "!! 'docker compose' not found. Install Docker with the compose plugin." >&2
  exit 1
fi

# Resolve SERVER_IP: explicit arg > existing .env > auto-detect.
SERVER_IP=""
if [ -n "$IP_ARG" ]; then
  SERVER_IP="$IP_ARG"
  set_server_ip "$SERVER_IP"
  echo "→ SERVER_IP set to $SERVER_IP"
elif [ -f "$ENV_FILE" ] && grep -q '^SERVER_IP=' "$ENV_FILE"; then
  SERVER_IP="$(grep '^SERVER_IP=' "$ENV_FILE" | cut -d= -f2-)"
  echo "→ Using SERVER_IP=$SERVER_IP from $ENV_FILE"
else
  SERVER_IP="$(detect_ip)"
  if [ -z "$SERVER_IP" ]; then
    echo "!! Could not auto-detect the server IP. Run: ./bootstrap.sh <ip>" >&2
    exit 1
  fi
  set_server_ip "$SERVER_IP"
  echo "→ Auto-detected SERVER_IP=$SERVER_IP"
fi

if [ "$BUILD_LOCAL" = "1" ]; then
  echo "→ Building images locally & starting containers"
  docker compose up -d --build
else
  echo "→ Pulling published image & starting containers"
  if ! docker compose pull; then
    echo "!! Pull failed — falling back to a local build"
    docker compose build
  fi
  docker compose up -d
fi
# Caddy must be recreated to pick up a changed SERVER_IP / Caddyfile.
docker compose up -d --force-recreate caddy

# The app writes data/instance.env on first start; wait briefly, then surface
# the auto-generated admin password.
ADMIN_PW=""
for _ in $(seq 1 30); do
  if [ -f data/instance.env ] && grep -q '^ADMIN_PASSWORD=' data/instance.env; then
    ADMIN_PW="$(grep '^ADMIN_PASSWORD=' data/instance.env | cut -d= -f2-)"
    break
  fi
  sleep 1
done

cat <<EOF

✓ Mikrotik Backup is up.
    URL:      https://$SERVER_IP
    Root CA:  https://$SERVER_IP/mik-ca.crt   (install on clients to trust TLS + terminal)
    Login:    admin
EOF
if [ -n "$ADMIN_PW" ]; then
  echo "    Password: $ADMIN_PW   (auto-generated — change it on first login)"
else
  echo "    Password: see 'docker compose logs app' or data/instance.env"
fi
