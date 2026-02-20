# Docker Container Design: Brmble.Server

**Date:** 2026-02-20
**Issue:** #44

## Overview

Package `Brmble.Server` as a single self-contained Docker image that includes the LiveKit server and Continuwity (Matrix homeserver) binaries. All HTTP traffic is routed through the YARP reverse proxy already embedded in Brmble.Server. The image is published to `ghcr.io/brmble/brmble-server` via GitHub Actions.

## Architecture

### Single-Container, Multi-Process

The image runs three processes managed by `supervisord`:

| Process | Internal Address | Role |
|---|---|---|
| Brmble.Server (ASP.NET Core / YARP) | `:8080` | Public entry point, reverse proxy |
| LiveKit server | `localhost:7880` | WebRTC voice/video |
| Continuwity (Matrix homeserver) | `localhost:6167` | Text/chat |

Only port `8080` is exposed externally. LiveKit and Continuwity bind to `localhost` only.

### Routing

YARP routes are hardcoded in `appsettings.json` baked into the image:

```
/livekit/{**catch-all}  →  http://localhost:7880
/_matrix/{**catch-all}  →  http://localhost:6167
```

### Persistent Storage

SQLite database is stored at `/data/brmble.db`. `/data` is declared as a Docker `VOLUME` and should be backed by a named volume in production.

## Dockerfile

Multi-stage build:

**Stage 1 — `build` (`mcr.microsoft.com/dotnet/sdk:10.0`)**
- Runs `dotnet publish` for `Brmble.Server` (includes ZeroC.Ice Slice code generation)
- Downloads LiveKit server binary (`livekit-server`, linux-amd64) from GitHub releases
- Downloads Continuwity binary (linux-amd64) from GitHub releases

**Stage 2 — `runtime` (`mcr.microsoft.com/dotnet/aspnet:10.0`)**
- Copies published Brmble.Server output
- Copies LiveKit and Continuwity binaries to `/usr/local/bin`
- Installs `supervisord`
- Embeds `supervisord.conf`, `appsettings.json` (with hardcoded YARP routes)
- Declares `VOLUME /data`
- Exposes port `8080`
- Entrypoint: `supervisord`

Target architecture: `linux/amd64` only.

## GitHub Actions Workflow

**File:** `.github/workflows/docker-server.yml`

**Triggers:**
- Push to `main` → tags `latest` and `sha-<short-sha>`
- Push of `v*` tag → additionally tags `:v1.2.3` and `:1.2`

**Steps:**
1. Checkout repository
2. Log in to `ghcr.io` using `GITHUB_TOKEN`
3. Extract Docker metadata (tags, labels) via `docker/metadata-action`
4. Build and push image via `docker/build-push-action`

**Target registry:** `ghcr.io/brmble/brmble-server`

## docker-compose.yml

A `docker-compose.yml` at the repo root for local development and self-hosting:

```yaml
services:
  brmble:
    image: ghcr.io/brmble/brmble-server:latest
    ports:
      - "8080:8080"
    volumes:
      - brmble-data:/data
    environment:
      - ConnectionStrings__Default=Data Source=/data/brmble.db

volumes:
  brmble-data:
```

All other runtime configuration (auth secrets, Mumble ICE endpoint, etc.) is injected via additional environment variables following ASP.NET Core's env var override convention (e.g. `Section__Key=value`).

## Files to Create

| File | Description |
|---|---|
| `src/Brmble.Server/Dockerfile` | Multi-stage build |
| `src/Brmble.Server/supervisord.conf` | Process manager config |
| `src/Brmble.Server/appsettings.json` | Hardcoded YARP routes + defaults |
| `.github/workflows/docker-server.yml` | CI build and push workflow |
| `docker-compose.yml` | Local/self-hosted stack |
