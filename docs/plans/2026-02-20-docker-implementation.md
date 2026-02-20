# Docker Container Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package Brmble.Server, LiveKit, and Continuwuity into a single amd64 Docker image with YARP as the single HTTP entry point, published to ghcr.io via GitHub Actions.

**Architecture:** Multi-stage Dockerfile (SDK build → ASP.NET runtime). Three processes managed by supervisord: Brmble.Server on :8080 (public, YARP proxy), LiveKit on localhost:7880, Continuwuity on localhost:6167. SQLite data at /data (named volume). entrypoint.sh generates per-instance config from env vars at container start.

**Tech Stack:** .NET 10, ASP.NET Core, YARP, ZeroC.Ice Slice tools (NuGet), LiveKit server (Go binary), Continuwuity/conduwuit (Rust binary), supervisord, GitHub Actions docker/build-push-action.

---

### Task 1: Create .dockerignore

**Files:**
- Create: `.dockerignore`

**Step 1: Create .dockerignore at repo root**

```
# .dockerignore
**/bin/
**/obj/
**/.vs/
**/.git/
.worktrees/
src/Brmble.Web/
src/Brmble.Client/
lib/
tests/
docs/
*.md
.github/
```

This prevents the large bin/obj directories, the web/client projects, and worktrees from being sent to the Docker build context. Only `Directory.Build.props` and `src/Brmble.Server/` matter for the build.

**Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for Brmble.Server Docker build"
```

---

### Task 2: Create appsettings.json

This file is baked into the image. It hardcodes the YARP routes (internal localhost routing, not configurable) and sets the Matrix homeserver URL to the co-located Continuwuity instance. Secrets (tokens, Ice config) are injected at runtime via env vars.

**Files:**
- Create: `src/Brmble.Server/appsettings.json`

**Step 1: Create appsettings.json**

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "Default": "Data Source=/data/brmble.db"
  },
  "Matrix": {
    "HomeserverUrl": "http://localhost:6167"
  },
  "Ice": {
    "Host": "mumble-server",
    "Port": "6502",
    "ConnectTimeoutMs": "3000"
  },
  "ReverseProxy": {
    "Routes": {
      "matrix": {
        "ClusterId": "matrix",
        "Match": {
          "Path": "/_matrix/{**catch-all}"
        }
      },
      "livekit": {
        "ClusterId": "livekit",
        "Match": {
          "Path": "/livekit/{**catch-all}"
        }
      }
    },
    "Clusters": {
      "matrix": {
        "Destinations": {
          "d0": {
            "Address": "http://localhost:6167"
          }
        }
      },
      "livekit": {
        "Destinations": {
          "d0": {
            "Address": "http://localhost:7880"
          }
        }
      }
    }
  }
}
```

**Step 2: Verify the server still builds**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

Expected: `Build succeeded`

**Step 3: Commit**

```bash
git add src/Brmble.Server/appsettings.json
git commit -m "feat: add appsettings.json with hardcoded YARP routes for container"
```

---

### Task 3: Create supervisord.conf

**Files:**
- Create: `src/Brmble.Server/docker/supervisord.conf`

**Step 1: Create the docker directory and supervisord.conf**

```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
pidfile=/tmp/supervisord.pid

[program:continuwuity]
command=/usr/local/bin/continuwuity --config /etc/continuwuity/continuwuity.toml
autostart=true
autorestart=true
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:livekit]
command=/usr/local/bin/livekit-server --config /etc/livekit/livekit.yaml
autostart=true
autorestart=true
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:brmble-server]
command=dotnet /app/Brmble.Server.dll
autostart=true
autorestart=true
priority=20
startsecs=3
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

`priority=20` and `startsecs=3` on brmble-server gives Continuwuity a head start before Brmble.Server begins accepting requests.

**Step 2: Commit**

```bash
git add src/Brmble.Server/docker/supervisord.conf
git commit -m "chore: add supervisord.conf for multi-process container"
```

---

### Task 4: Create livekit.yaml

**Files:**
- Create: `src/Brmble.Server/docker/livekit.yaml`

**Step 1: Create livekit.yaml**

```yaml
# LiveKit server config
# API keys are injected via LIVEKIT_KEYS env var: "api-key: secret"
port: 7880
bind_addresses:
  - "127.0.0.1"

rtc:
  tcp_port: 7881
  port_range_start: 50100
  port_range_end: 50200
  use_external_ip: true

logging:
  json: false
  level: info
```

`bind_addresses: ["127.0.0.1"]` — LiveKit's HTTP API is only accessible on localhost; YARP proxies `/livekit/**` to it. The RTC ports (7881/TCP and UDP range) listen on all interfaces via the `rtc` block and must be published in docker-compose. `use_external_ip: true` auto-detects the public IP via STUN for ICE candidate generation.

**Step 2: Commit**

```bash
git add src/Brmble.Server/docker/livekit.yaml
git commit -m "chore: add LiveKit server config for container"
```

---

### Task 5: Create entrypoint.sh

The entrypoint generates Continuwuity's TOML config and appservice registration YAML at container start from env vars, then execs supervisord.

**Files:**
- Create: `src/Brmble.Server/docker/entrypoint.sh`

**Step 1: Create entrypoint.sh**

```sh
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
```

**Step 2: Commit**

```bash
git add src/Brmble.Server/docker/entrypoint.sh
git commit -m "chore: add container entrypoint script"
```

---

### Task 6: Create Dockerfile

> **NOTE before starting:** Verify the correct download URLs for both binaries from their GitHub releases pages before coding:
> - LiveKit: https://github.com/livekit/livekit/releases — find the `linux_amd64.tar.gz` asset and confirm binary name inside archive is `livekit-server`
> - Continuwuity/conduwuit: https://github.com/girlbossceo/conduwuit/releases — find the `x86_64-unknown-linux-musl` static binary asset
>
> Update `LIVEKIT_VERSION` and `CONTINUWUITY_VERSION` ARGs to match the latest stable release tags.

**Files:**
- Create: `src/Brmble.Server/Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

ARG LIVEKIT_VERSION=v1.8.2
ARG CONTINUWUITY_VERSION=v0.4.6

# ── Stage 1: Download third-party binaries ────────────────────────────────────
FROM debian:bookworm-slim AS downloader

ARG LIVEKIT_VERSION
ARG CONTINUWUITY_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends curl tar ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# LiveKit server — adjust filename if release format changes
RUN LKVER="${LIVEKIT_VERSION#v}" && \
    curl -fsSL "https://github.com/livekit/livekit/releases/download/${LIVEKIT_VERSION}/livekit_${LKVER}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin livekit-server && \
    chmod +x /usr/local/bin/livekit-server

# Continuwuity (conduwuit) — static musl binary
RUN curl -fsSL -o /usr/local/bin/continuwuity \
    "https://github.com/girlbossceo/conduwuit/releases/download/${CONTINUWUITY_VERSION}/conduwuit-${CONTINUWUITY_VERSION}-x86_64-unknown-linux-musl" && \
    chmod +x /usr/local/bin/continuwuity

# ── Stage 2: Build Brmble.Server ─────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props .
COPY src/Brmble.Server/ src/Brmble.Server/

RUN dotnet publish src/Brmble.Server/Brmble.Server.csproj \
    -c Release \
    -r linux-x64 \
    --no-self-contained \
    -o /app/publish

# ── Stage 3: Runtime image ────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends supervisor \
    && rm -rf /var/lib/apt/lists/*

# Brmble.Server
COPY --from=build /app/publish /app

# Third-party binaries
COPY --from=downloader /usr/local/bin/livekit-server /usr/local/bin/
COPY --from=downloader /usr/local/bin/continuwuity /usr/local/bin/

# Config files
COPY src/Brmble.Server/docker/supervisord.conf /etc/supervisord.conf
COPY src/Brmble.Server/docker/livekit.yaml /etc/livekit/livekit.yaml
COPY src/Brmble.Server/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data volume (SQLite + Continuwuity RocksDB)
VOLUME /data

# Single public port — everything goes through YARP
EXPOSE 8080

# LiveKit RTC ports (direct, not proxied)
EXPOSE 7881
EXPOSE 50100-50200/udp

WORKDIR /app
ENTRYPOINT ["/entrypoint.sh"]
```

**Step 2: Commit**

```bash
git add src/Brmble.Server/Dockerfile
git commit -m "feat: add multi-stage Dockerfile for Brmble.Server container"
```

---

### Task 7: Verify Docker build locally

Run from the **repo root** (where `.dockerignore` lives).

**Step 1: Build the image**

```bash
docker build -f src/Brmble.Server/Dockerfile -t brmble-server:local .
```

Expected: `Successfully built <id>` / `Successfully tagged brmble-server:local`

Common failures and fixes:
- **`slice2cs` not found** — The ZeroC.Ice.Slice.Tools NuGet package ships native Linux binaries that run during `dotnet publish`. If it fails, check the ZeroC.Ice NuGet package version matches the runtime.
- **LiveKit download URL 404** — Verify the release tag and filename format on https://github.com/livekit/livekit/releases and update the `LIVEKIT_VERSION` ARG.
- **Continuwuity download URL 404** — Verify the release tag and filename on https://github.com/girlbossceo/conduwuit/releases and update the `CONTINUWUITY_VERSION` ARG.

**Step 2: Check image size**

```bash
docker image inspect brmble-server:local --format='{{.Size}}' | awk '{printf "%.0f MB\n", $1/1024/1024}'
```

Expected: roughly 400–700 MB (ASP.NET runtime ~200 MB + LiveKit ~50 MB + Continuwuity ~30 MB + publish output).

---

### Task 8: Verify /health endpoint

**Step 1: Run the container with required env vars**

```bash
docker run --rm -d \
  --name brmble-test \
  -p 8080:8080 \
  -e MATRIX_SERVER_NAME=localhost \
  -e MATRIX_APPSERVICE_TOKEN=test-token \
  -e Matrix__AppServiceToken=test-token \
  -e Ice__Host=localhost \
  -e Ice__Secret="" \
  brmble-server:local
```

**Step 2: Wait for startup, then hit /health**

```bash
sleep 6 && curl -sf http://localhost:8080/health
```

Expected: `{"status":"healthy"}`

**Step 3: Check all 3 processes started**

```bash
docker exec brmble-test supervisorctl status
```

Expected:
```
brmble-server    RUNNING   pid ..., uptime ...
continuwuity     RUNNING   pid ..., uptime ...
livekit          RUNNING   pid ..., uptime ...
```

**Step 4: Stop test container**

```bash
docker stop brmble-test
```

---

### Task 9: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/docker-server.yml`

**Step 1: Create the workflows directory and file**

```yaml
name: Docker — Brmble.Server

on:
  push:
    branches:
      - main
    tags:
      - "v*"

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/brmble/brmble-server
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-,format=short
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: src/Brmble.Server/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

**Step 2: Commit**

```bash
git add .github/workflows/docker-server.yml
git commit -m "ci: add GitHub Actions workflow to build and push Brmble.Server Docker image"
```

---

### Task 10: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml at repo root**

```yaml
services:
  brmble:
    image: ghcr.io/brmble/brmble-server:latest
    ports:
      - "8080:8080"
      - "7881:7881"
      - "50100-50200:50100-50200/udp"
    volumes:
      - brmble-data:/data
    environment:
      # Required — set these in a .env file or your environment
      MATRIX_SERVER_NAME: ${MATRIX_SERVER_NAME}
      MATRIX_APPSERVICE_TOKEN: ${MATRIX_APPSERVICE_TOKEN}
      Matrix__AppServiceToken: ${MATRIX_APPSERVICE_TOKEN}
      # Optional — Mumble ICE bridge (leave blank if no Mumble server)
      Ice__Host: ${ICE_HOST:-mumble-server}
      Ice__Port: ${ICE_PORT:-6502}
      Ice__Secret: ${ICE_SECRET:-}
    restart: unless-stopped

volumes:
  brmble-data:
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for self-hosted Brmble stack"
```

---

### Task 11: Close issue

Once CI passes on main and `docker pull ghcr.io/brmble/brmble-server:latest` succeeds:

```bash
gh issue close 44 --comment "Implemented in this branch: Dockerfile, GitHub Actions workflow (.github/workflows/docker-server.yml), and docker-compose.yml. Image published to ghcr.io/brmble/brmble-server."
```
