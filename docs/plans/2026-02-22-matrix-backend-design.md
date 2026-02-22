# Matrix Backend Design — Issue 104 (PR 1: Backend + Bridge)

**Date:** 2026-02-22
**Author:** maui1911
**Scope:** Backend slice of Matrix SDK integration. Frontend (PR 2) follows.

---

## Overview

Wire up per-user Matrix account provisioning and credential delivery so the React frontend can initialize a `MatrixClient` in PR 2. The client receives a single `server.credentials` bridge message after connecting, containing credentials for all services (Matrix now, LiveKit later).

---

## Server Discovery — Two Flows

`ServerEntry` supports two mutually exclusive entry points. Both end up calling `/auth/token` and sending `server.credentials`.

### Flow A — Mumble-first

User enters `{host, port}`. After connecting, the Mumble `ServerSync.WelcomeText` is parsed for an embedded JSON comment:

```html
Welcome!
<!--brmble:{"apiUrl":"https://noscope.it:1912"}-->
```

If found, Brmble.Client calls `POST {apiUrl}/auth/token` and sends `server.credentials`. If not found, legacy mode (no Matrix).

### Flow B — Brmble-first

User enters `{apiUrl}`. Brmble.Client calls `GET {apiUrl}/server-info` to retrieve `{mumbleHost, mumblePort}`, connects to Mumble, then calls `/auth/token`.

### Caching

After first connect, the resolved address is persisted back to the `ServerEntry` on disk:
- Flow A: save discovered `apiUrl` to the entry
- Flow B: save discovered `mumbleHost`/`mumblePort` to the entry

Subsequent connects skip discovery entirely.

---

## Data Layer (Brmble.Server)

### `users` table

Add `matrix_access_token TEXT` column (nullable, populated on first `/auth/token` call):

```sql
ALTER TABLE users ADD COLUMN matrix_access_token TEXT;
```

### `UserRepository`

- Add `MatrixAccessToken` to the `User` record
- Add `UpdateMatrixToken(long id, string token)` method
- Add `GetAll()` to `ChannelRepository` for building `roomMap`

---

## Matrix Provisioning (Brmble.Server)

### Appservice namespace fix (`register-appservice.sh`)

The appservice is currently registered with `namespaces.users: []`, which causes `m.login.application_service` to fail. Update the registration YAML to claim Brmble's numeric user IDs:

```yaml
namespaces:
  users:
    - exclusive: true
      regex: '@[0-9]+:noscope.it'
  rooms: []
  aliases: []
```

The regex matches `@{backend_id}:{domain}` per the auth spec. The domain is injected from `$MATRIX_SERVER_NAME` at registration time. Re-registering the appservice requires a container restart on the production server.

### `MatrixAppService` — two new methods

**`RegisterUser(string localpart, string displayName)`**

```
POST /_matrix/client/v3/register?kind=user
Authorization: Bearer {appServiceToken}
{ "username": "{localpart}" }
```

Returns `access_token`. Stored in `matrix_access_token` on first use.

**`LoginUser(string localpart)`**

```
POST /_matrix/client/v3/login
Authorization: Bearer {appServiceToken}
{
  "type": "m.login.application_service",
  "identifier": { "type": "m.id.user", "user": "@{localpart}:{domain}" }
}
```

Returns fresh `access_token`. Used as fallback when the stored token is missing or has been invalidated.

### `AuthService.Authenticate()`

Replaces the stub token:

1. Look up user by cert hash
2. If not found: `UserRepository.Insert()` → `RegisterUser()` → `UpdateMatrixToken()` → return token
3. If found with stored token: return stored token
4. If found without token: `LoginUser()` → `UpdateMatrixToken()` → return token

---

## API Endpoints (Brmble.Server)

### `GET /server-info` — public, no auth

Returns Mumble connection details and Matrix homeserver URL from config:

```json
{
  "mumbleHost": "mumble.noscope.it",
  "mumblePort": 64738,
  "matrixHomeserverUrl": "https://noscope.it:1912"
}
```

### `POST /auth/token` — cert hash in body

Request:
```json
{ "certHash": "a3f2..." }
```

Response:
```json
{
  "matrix": {
    "homeserverUrl": "https://noscope.it:1912",
    "accessToken": "syt_...",
    "userId": "@42:noscope.it",
    "roomMap": {
      "1": "!abc:noscope.it",
      "2": "!def:noscope.it"
    }
  },
  "livekit": null
}
```

`roomMap` is built from `ChannelRepository.GetAll()`. The `livekit` field is `null` until PR 3.

Note: mTLS is deferred. The cert hash is verified by checking it corresponds to a known user. Full active-session verification can be layered on later.

---

## Brmble.Client Changes

### `ServerEntry`

Add `ApiUrl` (optional). `Host`/`Port` remain but are nullable when `ApiUrl` is set:

```csharp
public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Username
);
```

Validation: exactly one of `{ApiUrl}` or `{Host + Port}` must be set.

### `CertificateService`

Expose `GetCertHash()` — SHA-1 fingerprint of the loaded `.pfx` certificate as a lowercase hex string.

### `MumbleAdapter` — connect flow

**Flow A** (Host/Port set):
1. Connect to Mumble as today
2. On `ServerSync`: scan `WelcomeText` for `<!--brmble:{...}-->`
3. If found: extract `apiUrl`, call `POST {apiUrl}/auth/token`, send `server.credentials`
4. If not found: no Matrix, continue as legacy
5. Persist discovered `apiUrl` to `ServerEntry`

**Flow B** (ApiUrl set):
1. Call `GET {apiUrl}/server-info` → get `mumbleHost`, `mumblePort`
2. Persist to `ServerEntry`
3. Connect to Mumble
4. On `ServerSync`: call `POST {apiUrl}/auth/token`
5. Send `server.credentials`

### `server.credentials` bridge message

```json
{
  "type": "server.credentials",
  "data": {
    "matrix": {
      "homeserverUrl": "https://noscope.it:1912",
      "accessToken": "syt_...",
      "userId": "@42:noscope.it",
      "roomMap": { "1": "!abc:noscope.it" }
    },
    "livekit": null
  }
}
```

Frontend ignores null fields. No bridge protocol changes needed — `NativeBridge.Send()` handles it as-is.

---

## What Is NOT in This PR

- Frontend matrix-js-sdk integration (PR 2)
- LiveKit credential issuance (PR 3)
- mTLS (deferred, infrastructure decision)
- Server list UI update for `apiUrl` field (can ship with PR 2)

---

## Open Questions

- `MumbleSettings` needs `Host`/`Port` fields for `/server-info` — verify these exist in config.

## Pre-implementation Findings

- `m.login.application_service` is supported by Continuwuity ✅
- The appservice namespace is currently empty (`users: []`), causing login to fail with `M_EXCLUSIVE` ⚠️ — fixed in `register-appservice.sh`
- `POST /register?kind=user` returns `access_token` immediately ✅ — stored and reused; `LoginUser()` is the fallback
