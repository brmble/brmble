#!/bin/sh
set -e

SENTINEL="/data/.appservice-registered"
HS="http://127.0.0.1:6167"

if [ -f "$SENTINEL" ]; then
    echo "[register-appservice] Already registered, skipping"
    exit 0
fi

# Wait for conduwuit to be ready
echo "[register-appservice] Waiting for conduwuit..."
# Maximum time (in seconds) to wait for conduwuit to become ready (override with CONDUWUIT_STARTUP_TIMEOUT)
MAX_WAIT_SECONDS="${CONDUWUIT_STARTUP_TIMEOUT:-60}"
START_TIME=$(date +%s)
until curl -sf "$HS/_matrix/client/versions" > /dev/null; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START_TIME))
    if [ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]; then
        echo "[register-appservice] ERROR: Timed out after ${MAX_WAIT_SECONDS}s waiting for conduwuit at $HS" >&2
        exit 1
    fi
    sleep 2
done
echo "[register-appservice] conduwuit ready"

# Register admin user — succeeds on empty DB (first user auto-promoted to admin)
# Ignore failure: user may already exist if /data/admin-password was preserved
curl -sf -X POST "$HS/_matrix/client/v3/register" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg u "$MATRIX_ADMIN_USER" --arg p "$MATRIX_ADMIN_PASSWORD" \
        '{username:$u, password:$p, kind:"user"}')" \
    > /dev/null 2>&1 || true

# Login to get access token
echo "[register-appservice] Logging in as $MATRIX_ADMIN_USER..."
ACCESS_TOKEN=$(curl -sf -X POST "$HS/_matrix/client/v3/login" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg u "$MATRIX_ADMIN_USER" --arg p "$MATRIX_ADMIN_PASSWORD" \
        '{type:"m.login.password", user:$u, password:$p}')" \
    | jq -r '.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo "[register-appservice] ERROR: Login failed."
    echo "[register-appservice] If conduwuit already has users, set MATRIX_ADMIN_USER and MATRIX_ADMIN_PASSWORD env vars."
    exit 1
fi

# Join the admin room (conduwuit auto-invites the first admin user)
ENCODED_ALIAS=$(printf '%%23admins%%3A%s' "$MATRIX_SERVER_NAME")
echo "[register-appservice] Joining #admins:${MATRIX_SERVER_NAME}..."
if ! curl -sf -X POST "$HS/_matrix/client/v3/join/${ENCODED_ALIAS}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null; then
    echo "[register-appservice] ERROR: Failed to join #admins:${MATRIX_SERVER_NAME}."
    exit 1
fi

# Resolve room alias to room ID for sending the message
ROOM_ID=$(curl -sf "$HS/_matrix/client/v3/directory/room/${ENCODED_ALIAS}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    | jq -r '.room_id')

if [ -z "$ROOM_ID" ] || [ "$ROOM_ID" = "null" ]; then
    echo "[register-appservice] ERROR: Could not resolve #admins:${MATRIX_SERVER_NAME}"
    exit 1
fi

# Build registration command — three backtick fencing avoids shell interpretation
TICK='`'
TICKS="${TICK}${TICK}${TICK}"
YAML="id: brmble
url: ~
as_token: \"${MATRIX_APPSERVICE_TOKEN}\"
hs_token: \"${MATRIX_APPSERVICE_TOKEN}\"
sender_localpart: brmble
namespaces:
  users: []
  rooms: []
  aliases: []
rate_limited: false"

COMMAND="!admin appservices register
${TICKS}yaml
${YAML}
${TICKS}"

# Send the registration command
TXN_ID=$(openssl rand -hex 8)
echo "[register-appservice] Sending registration command to admin room..."
RESPONSE=$(curl -sf -X PUT "$HS/_matrix/client/v3/rooms/${ROOM_ID}/send/m.room.message/${TXN_ID}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg body "$COMMAND" '{msgtype:"m.text", body:$body}')" )

EVENT_ID=$(printf '%s\n' "$RESPONSE" | jq -r '.event_id // empty')
if [ -z "$EVENT_ID" ]; then
    echo "[register-appservice] Failed to confirm appservice registration command was accepted; not creating sentinel" >&2
    exit 1
fi

echo "[register-appservice] Appservice registered successfully (event_id: $EVENT_ID)"
touch "$SENTINEL"
