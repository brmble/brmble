# Conduwuit Appservice Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate registration of the brmble appservice in conduwuit on first container start, replacing the broken `appservice_registration_files` TOML key.

**Architecture:** A one-shot shell script (`register-appservice.sh`) runs via supervisord at priority 15. It polls conduwuit, creates the first admin user, joins `#admins:DOMAIN`, and sends the `!admin appservices register` command. A sentinel file at `/data/.appservice-registered` prevents re-registration on subsequent starts.

**Tech Stack:** sh, curl, jq, openssl (all in the container); Matrix Client-Server API v3; conduwuit v0.4.6; supervisord

---

### Task 1: Add curl and jq to the runtime image

**Files:**
- Modify: `src/Brmble.Server/Dockerfile:42`

The runtime image currently installs only `supervisor`. Add `curl` and `jq` to the same `apt-get install` line.

**Step 1: Edit the Dockerfile**

Find this line:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends supervisor \
    && rm -rf /var/lib/apt/lists/*
```

Replace with:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends supervisor curl jq \
    && rm -rf /var/lib/apt/lists/*
```

**Step 2: Verify the build compiles**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```
Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`

**Step 3: Commit**

```bash
git add src/Brmble.Server/Dockerfile
git commit -m "fix: add curl and jq to runtime image for appservice registration"
```

---

### Task 2: Fix entrypoint.sh — remove bad TOML key and generate admin credentials

**Files:**
- Modify: `src/Brmble.Server/docker/entrypoint.sh`

Two changes:
1. Remove `appservice_registration_files` from the generated TOML (and the unused brmble.yaml generation)
2. Generate `brmble-admin` password on first run, export credentials for the registration script

**Step 1: Edit entrypoint.sh**

The full new file (replacing the existing content entirely):

```sh
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
    openssl rand -hex 16 > /data/admin-password
fi
export MATRIX_ADMIN_USER="${MATRIX_ADMIN_USER:-brmble-admin}"
export MATRIX_ADMIN_PASSWORD="${MATRIX_ADMIN_PASSWORD:-$(cat /data/admin-password)}"

exec /usr/bin/supervisord -c /etc/supervisord.conf
```

**Step 2: Verify the file looks correct**

Read the file and confirm:
- No `appservice_registration_files` line in the TOML heredoc
- No `brmble.yaml` generation block
- Admin credential generation block is present before `exec supervisord`

**Step 3: Commit**

```bash
git add src/Brmble.Server/docker/entrypoint.sh
git commit -m "fix: remove invalid appservice_registration_files TOML key, add admin credential generation"
```

---

### Task 3: Create register-appservice.sh

**Files:**
- Create: `src/Brmble.Server/docker/register-appservice.sh`

**Step 1: Create the script**

```sh
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
until curl -sf "$HS/_matrix/client/versions" > /dev/null; do
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
curl -sf -X POST "$HS/_matrix/client/v3/join/${ENCODED_ALIAS}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null

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
curl -sf -X PUT "$HS/_matrix/client/v3/rooms/${ROOM_ID}/send/m.room.message/${TXN_ID}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg body "$COMMAND" '{msgtype:"m.text", body:$body}')" \
    > /dev/null

echo "[register-appservice] Appservice registered successfully"
touch "$SENTINEL"
```

**Step 2: Commit**

```bash
git add src/Brmble.Server/docker/register-appservice.sh
git commit -m "feat: add register-appservice.sh for automated conduwuit appservice registration"
```

---

### Task 4: Register the script in the Dockerfile and supervisord

**Files:**
- Modify: `src/Brmble.Server/Dockerfile`
- Modify: `src/Brmble.Server/docker/supervisord.conf`

**Step 1: Copy and chmod the script in the Dockerfile**

After the existing `RUN chmod +x /entrypoint.sh` line, add:

```dockerfile
COPY src/Brmble.Server/docker/register-appservice.sh /register-appservice.sh
RUN chmod +x /register-appservice.sh
```

**Step 2: Add the supervisord program**

In `supervisord.conf`, add this block between the `[program:continuwuity]` and `[program:brmble-server]` blocks:

```ini
[program:register-appservice]
command=/register-appservice.sh
autostart=true
autorestart=false
startsecs=0
priority=15
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

Note on settings:
- `priority=15`: starts after continuwuity (10), before brmble-server (20)
- `autorestart=false`: one-shot, never retried by supervisord
- `startsecs=0`: supervisord considers it "started" immediately; the script itself handles waiting

**Step 3: Verify the build**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```
Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`

**Step 4: Commit**

```bash
git add src/Brmble.Server/Dockerfile src/Brmble.Server/docker/supervisord.conf
git commit -m "feat: wire register-appservice.sh into Dockerfile and supervisord"
```

---

### Task 5: Smoke test the full flow

**Goal:** Verify the container registers the appservice correctly on a fresh volume.

**Step 1: Build the Docker image locally**

```bash
docker build -t brmble-server-test -f src/Brmble.Server/Dockerfile .
```
Expected: build succeeds, no errors.

**Step 2: Run with a fresh volume**

```bash
docker run --rm \
  -e MATRIX_SERVER_NAME=test.local \
  -e MATRIX_APPSERVICE_TOKEN=test-token-abc123 \
  -v brmble-test-data:/data \
  brmble-server-test
```

**Step 3: Watch docker logs for these lines (in order)**

```
[register-appservice] Waiting for conduwuit...
[register-appservice] conduwuit ready
[register-appservice] Logging in as brmble-admin...
[register-appservice] Joining #admins:test.local...
[register-appservice] Sending registration command to admin room...
[register-appservice] Appservice registered successfully
```

**Step 4: Verify sentinel was created**

```bash
docker run --rm -v brmble-test-data:/data alpine ls -la /data/.appservice-registered
```
Expected: file exists.

**Step 5: Verify re-run skips registration**

Stop and restart the container. Logs should show:
```
[register-appservice] Already registered, skipping
```

**Step 6: Cleanup**

```bash
docker volume rm brmble-test-data
docker rmi brmble-server-test
```

**Step 7: Commit any fixes found during smoke test, then final commit**

```bash
git add -p  # stage only relevant changes
git commit -m "fix: <describe what needed fixing>"
```
