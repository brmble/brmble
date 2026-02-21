#!/bin/sh
set -e

# Required environment variables:
#   MATRIX_SERVER_NAME       - public Matrix domain (e.g. "chat.example.com")
#   MATRIX_APPSERVICE_TOKEN  - shared secret between Brmble.Server and Continuwuity
# Optional:
#   MATRIX_ALLOW_REGISTRATION - "true" to allow open registration (default: false)
#   MATRIX_ADMIN_USER         - Matrix admin username (default: brmble-admin)
#   MATRIX_ADMIN_PASSWORD     - Matrix admin password (default: auto-generated, stored in /data/admin-password)

: "${MATRIX_SERVER_NAME:?MATRIX_SERVER_NAME is required}"
: "${MATRIX_APPSERVICE_TOKEN:?MATRIX_APPSERVICE_TOKEN is required}"

mkdir -p /data/continuwuity
mkdir -p /data/dataprotection-keys
mkdir -p /etc/continuwuity

# Generate Continuwuity config
cat > /etc/continuwuity/continuwuity.toml << EOF
[global]
server_name = "${MATRIX_SERVER_NAME}"
database_backend = "rocksdb"
database_path = "/data/continuwuity"
port = 6167
address = "127.0.0.1"
max_request_size = 20000000
allow_registration = ${MATRIX_ALLOW_REGISTRATION:-false}
allow_federation = false
EOF

# Expose token and server name to Brmble.Server via ASP.NET config env vars
export Matrix__AppServiceToken="${MATRIX_APPSERVICE_TOKEN}"
export Matrix__ServerDomain="${MATRIX_SERVER_NAME}"

# LiveKit requires API keys — generate random ones at first start if not supplied
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-$(openssl rand -hex 8)}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-$(openssl rand -hex 32)}"
export LIVEKIT_KEYS="${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"

# Admin credentials for appservice registration (first-run only)
if [ ! -f /data/admin-password ]; then
    (umask 077; openssl rand -hex 16 > /data/admin-password)
fi
export MATRIX_ADMIN_USER="${MATRIX_ADMIN_USER:-brmble-admin}"
export MATRIX_ADMIN_PASSWORD="${MATRIX_ADMIN_PASSWORD:-$(cat /data/admin-password)}"

exec /usr/bin/supervisord -c /etc/supervisord.conf
