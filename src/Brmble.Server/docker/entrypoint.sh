#!/bin/sh
set -e

# Required environment variables:
#   MATRIX_SERVER_NAME       - public Matrix domain (e.g. "chat.example.com")
#   MATRIX_APPSERVICE_TOKEN  - shared secret between Brmble.Server and Continuwuity
# Optional:
#   MATRIX_ALLOW_REGISTRATION - "true" to allow open registration (default: false)

: "${MATRIX_SERVER_NAME:?MATRIX_SERVER_NAME is required}"
: "${MATRIX_APPSERVICE_TOKEN:?MATRIX_APPSERVICE_TOKEN is required}"

mkdir -p /data/continuwuity
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
appservice_registration_files = ["/etc/continuwuity/brmble.yaml"]
EOF

# Generate appservice registration (allows Brmble.Server to act as Matrix bot)
cat > /etc/continuwuity/brmble.yaml << EOF
id: brmble
url: ~
as_token: "${MATRIX_APPSERVICE_TOKEN}"
hs_token: "${MATRIX_APPSERVICE_TOKEN}"
sender_localpart: brmble
namespaces:
  users: []
  rooms: []
  aliases: []
rate_limited: false
EOF

exec /usr/bin/supervisord -c /etc/supervisord.conf
