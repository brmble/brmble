#!/bin/sh
set -e

HS="http://127.0.0.1:6167"
SENTINEL="/data/.appservice-registered"
MAX_WAIT_SECONDS="${CONDUWUIT_STARTUP_TIMEOUT:-60}"

# Wait for conduwuit to be ready
i=0
until curl -sf "$HS/_matrix/client/versions" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$MAX_WAIT_SECONDS" ]; then
        echo "conduwuit did not become ready within ${MAX_WAIT_SECONDS} seconds" >&2
        exit 1
    fi
    sleep 1
done

# Wait for appservice registration sentinel
i=0
until [ -f "$SENTINEL" ]; do
    i=$((i + 1))
    if [ "$i" -ge "$MAX_WAIT_SECONDS" ]; then
        echo "appservice registration did not complete within ${MAX_WAIT_SECONDS} seconds" >&2
        exit 1
    fi
    echo "[brmble-server] waiting for appservice registration..."
    sleep 1
done
