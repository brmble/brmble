# Design: Automated conduwuit Appservice Registration

**Date:** 2026-02-21
**Branch:** fix/docker-livekit-ice
**Status:** Approved

## Problem

`appservice_registration_files` is a Synapse config key that conduwuit has never supported.
conduwuit ignores it silently, so the `brmble` appservice is never registered, and
`MATRIX_APPSERVICE_TOKEN` is unrecognised — the Matrix integration is fully broken at runtime.

conduwuit only supports appservice registration via an in-Matrix admin room command:

```
!admin appservices register
```yaml
id: brmble
...
```
```

## Approach: One-shot registration script

A `register-appservice.sh` script runs at container startup via supervisord. It:

1. Checks for a sentinel file (`/data/.appservice-registered`) and exits immediately if found
2. Polls conduwuit's `/_matrix/client/versions` endpoint until ready
3. Registers `brmble-admin` as the first Matrix user (auto-promoted to server admin on empty DB)
4. Logs in and gets an access token
5. Joins `#admins:DOMAIN` and sends the `!admin appservices register` command
6. Touches the sentinel file

Admin credentials are generated on first run and persisted at `/data/admin-password`.

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Server/Dockerfile` | Add `curl jq` to apt-get install |
| `src/Brmble.Server/docker/entrypoint.sh` | Remove `appservice_registration_files` from TOML; generate `/data/admin-password`; export admin credentials |
| `src/Brmble.Server/docker/register-appservice.sh` | New one-shot registration script |
| `src/Brmble.Server/docker/supervisord.conf` | Add `[program:register-appservice]` at priority 15 |

## Script Flow

```
START
  ├─ sentinel exists? → exit 0 (already registered)
  ├─ poll GET /_matrix/client/versions until 200
  ├─ POST /register brmble-admin (ignore failure if user exists)
  ├─ POST /login → access_token (exit 1 on failure with guidance)
  ├─ POST /join #admins:DOMAIN
  ├─ PUT /send m.room.message → registration command + YAML
  └─ touch /data/.appservice-registered
```

## Error Handling

- **conduwuit not ready**: poll every 2s — container will be killed by orchestrator if it hangs
- **Login fails**: exit 1 with message directing operator to set `MATRIX_ADMIN_USER` / `MATRIX_ADMIN_PASSWORD` env vars (covers re-deploy against existing data)
- **Admin room not found**: exit 1
- **Send fails**: exit 1
- All output captured by supervisord and visible in `docker logs`

## Edge Cases

- **Re-deploy with same volume**: sentinel exists → script skips entirely
- **Partial first run** (script died after generating password but before sentinel): reuses stored password, retries cleanly
- **Existing data with known admin**: operator sets `MATRIX_ADMIN_USER` + `MATRIX_ADMIN_PASSWORD` env vars to override generated credentials

## supervisord Priority

```
priority 10 — continuwuity
priority 15 — register-appservice (one-shot, autorestart=false, startsecs=0)
priority 20 — brmble-server
```
