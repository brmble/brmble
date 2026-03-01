# Plan: Robust Brmble/Mumble User Distinction (Issue #186)

## Context

Issue #186 requires visually distinguishing Brmble users from classic Mumble users.

The current `userMappings` in `/auth/token` is:
- Keyed by **display name** — not unique, mutable, collision-prone
- A **one-time snapshot** — misses users who connect after your auth call

We need a robust, real-time mechanism. The solution:
1. Key live session data by **Mumble session ID** (unique per connection)
2. Add a **WebSocket endpoint** on the same HTTPS port for server-push deltas
3. Resolve returning users immediately via `getCertificateListAsync` at Ice `userConnected`
4. Resolve new users when they call `/auth/token` (look up session by name)
5. Emit `voice.userMappingUpdated` bridge events so the frontend can show badges

---

## New Services

### `ISessionMappingService` / `SessionMappingService`
Location: `src/Brmble.Server/Events/`

Singleton. In-memory, thread-safe:
- `ConcurrentDictionary<int, string>` — sessionId → matrixUserId
- `ConcurrentDictionary<string, int>` — mumbleName → sessionId

Methods:
- `SetNameForSession(string name, int sessionId)` — called on Ice `userConnected`
- `TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName)` — returns false if already set; `mumbleName` stored alongside for payload inclusion
- `RemoveSession(int sessionId)` — called on Ice `userDisconnected`; cleans up both dictionaries immediately to prevent ghost entries or recycled-session collisions
- `TryGetMatrixUserId(int sessionId, out string? matrixUserId)`
- `TryGetSessionId(string mumbleName, out int sessionId)`
- `GetSnapshot()` → `IReadOnlyDictionary<int, (string MatrixUserId, string MumbleName)>`

**Lifecycle contract:** session IDs are ephemeral — every Mumble reconnect produces a new session ID. `RemoveSession` on `userDisconnected` is the single cleanup path; it must run before any reconnect can reuse the session slot. Stale entries from crashed clients are cleared by the same path when Mumble eventually fires `userDisconnected`.

### `IBrmbleEventBus` / `BrmbleEventBus`
Location: `src/Brmble.Server/Events/`

Singleton. Manages connected WebSocket clients and broadcasts JSON messages:
- `AddClient(WebSocket ws)`
- `RemoveClient(WebSocket ws)`
- `BroadcastAsync(object message)` — serializes to JSON, sends to all live clients in parallel; per-client errors are caught and the dead client is removed (never blocks other clients)

Message shapes:
```json
{ "type": "snapshot",          "mappings": { "123": { "matrixUserId": "@1:domain", "mumbleName": "Alice" } } }
{ "type": "userMappingAdded",  "sessionId": 789, "matrixUserId": "@3:domain", "mumbleName": "Bob" }
{ "type": "userMappingRemoved","sessionId": 789 }
```

`mumbleName` is included in all payloads so the frontend doesn't need a separate lookup.

---

## Server Changes

### `MumbleIceService.cs`
`src/Brmble.Server/Mumble/MumbleIceService.cs`

- Store `serverProxy` as a field: `private MumbleServer.ServerPrx? _serverProxy`
- After casting the proxy, call `_callback.SetServerProxy(serverProxy)` before registering the callback

### `MumbleServerCallback.cs`
`src/Brmble.Server/Mumble/MumbleServerCallback.cs`

Add constructor params: `ISessionMappingService sessionMapping`, `IBrmbleEventBus eventBus`, `UserRepository userRepository`

Add internal setter: `internal void SetServerProxy(MumbleServer.ServerPrx proxy)`

**`userConnected` callback:**
1. `sessionMapping.SetNameForSession(state.name, state.session)`
2. Fire background task: call `_serverProxy.getCertificateListAsync(state.session)` → take first cert → compute SHA1 hash → `userRepository.GetByCertHash(hash)` → if found, call `sessionMapping.TryAddMatrixUser(sessionId, matrixUserId, name)` and `eventBus.BroadcastAsync(userMappingAdded)`
3. If cert lookup finds no match: leave unmapped — treat as classic Mumble user until `/auth/token` is called. **Do not block or wait.** The frontend upgrades the badge when the mapping arrives later (eventual consistency).

Cert hashing: `SHA1.HashData(derBytes)` formatted as lowercase hex — matches `MtlsCertificateHashExtractor.GetCertHash` logic. Extract the shared hash logic into a static `CertificateHasher.HashDer(byte[] der)` helper in `Auth/`. **Refactor `MtlsCertificateHashExtractor` to use `CertificateHasher.HashDer()` as well** — single source of truth for hash format.

**Important:** Verify that `getCertificateListAsync` returns the same DER-encoded cert used for mTLS auth and that the SHA1 hex output matches what's stored in the DB. If the format differs, the cert lookup will silently fail and returning users will appear as classic Mumble users until `/auth/token` is called. Write a test that round-trips a known cert through both paths.

**`userDisconnected` callback:**
1. `sessionMapping.RemoveSession(state.session)`
2. `eventBus.BroadcastAsync(userMappingRemoved)`

### `AuthEndpoints.cs`
`src/Brmble.Server/Auth/AuthEndpoints.cs`

Add params: `ISessionMappingService sessionMapping`, `IBrmbleEventBus eventBus`

After `authService.TrackMumbleName(mumbleUsername)` succeeds:
1. If `sessionMapping.TryGetSessionId(mumbleUsername, out var sid)` → call `sessionMapping.TryAddMatrixUser(sid, result.MatrixUserId, mumbleUsername)` → if it returned true (first time), broadcast `userMappingAdded`

Auth response: add `sessionMappings: sessionMapping.GetSnapshot()` alongside existing `userMappings` (keep `userMappings` for backward compat).

### WebSocket endpoint
`src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`

```
GET /ws  (HTTP → WebSocket upgrade)
```

Auth flow (client cert — consistent with existing mTLS):
1. Extract client cert from `HttpContext.Connection.ClientCertificate`
2. Hash it via `CertificateHasher.HashDer()`
3. Look up user via `userRepository.GetByCertHash(hash)` → if null → 401

On connect:
1. `eventBus.AddClient(ws)`
2. Send snapshot: `{ type: "snapshot", mappings: sessionMapping.GetSnapshot() }`
3. Read loop until close
4. `eventBus.RemoveClient(ws)` on close or error

### `Program.cs`
`src/Brmble.Server/Program.cs`

- `app.UseWebSockets()` before endpoint mapping
- `app.Map("/ws", BrmbleWebSocketHandler.HandleAsync)` — or use minimal API with DI

### Service registrations
- `MumbleExtensions.AddMumble()`: add `services.AddSingleton<ISessionMappingService, SessionMappingService>()` and `services.AddSingleton<IBrmbleEventBus, BrmbleEventBus>()`
- `MumbleExtensions.AddMumble()`: inject `ISessionMappingService` and `IBrmbleEventBus` into `MumbleServerCallback` (already singleton, DI picks it up automatically)

---

## Client Changes

### `MumbleAdapter.cs`
`src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**New field:** `private readonly ConcurrentDictionary<int, string> _sessionMappings = new()` — session-keyed, updated via WebSocket; must be concurrent because the WS receive loop writes while voice event handlers read from different threads

**Keep** `_userMappings` (name-keyed) for initial `voice.connected` fallback only.

**After auth succeeds** (where credentials are stored), start WebSocket connection:
- Use `ClientWebSocket.ConnectAsync(wsUri, new HttpMessageInvoker(handler), ct)` with `SocketsHttpHandler` carrying the client cert and `RemoteCertificateValidationCallback = (_, _, _, _) => true`
- URI: replace `https://` with `wss://` from the apiUrl, path `/ws`
- Background loop: receive JSON messages, update `_sessionMappings`, emit bridge events

**WebSocket reconnection:** If the WS connection drops (network blip, server restart, read error), reconnect with exponential backoff (1s → 2s → 4s → max 30s). On reconnect, the server sends a fresh `snapshot` message — no client-side replay needed. Reset backoff on successful connection.

**Lifecycle coordination with Mumble:** When the Mumble connection drops and reconnects, tear down the existing WS and start a fresh one. Session IDs reset on Mumble reconnect, so the old WS snapshot is stale. Close the WS in the Mumble disconnect handler; the reconnect path will establish a new WS after re-auth.

**Handle `snapshot`:** populate `_sessionMappings` from `mappings` dict

**Handle `userMappingAdded`:**
1. Update `_sessionMappings[sessionId] = { matrixUserId, mumbleName }`
2. If a user with that session is already in the connected user list, emit `voice.userMappingUpdated { sessionId, matrixUserId, mumbleName }` to bridge
3. Brmble client that reconnects to Mumble gets a new session ID → will trigger a fresh `userMappingAdded` via the normal `userConnected` + `/auth/token` path; the old session is cleaned up by `userMappingRemoved`

**Handle `userMappingRemoved`:** remove from `_sessionMappings`

**`voice.connected` matrixUserId lookup** (line ~1165): check `_sessionMappings[u.Id]` first, fall back to `_userMappings[u.Name]`

**`voice.userJoined` matrixUserId lookup** (line ~1277): check `_sessionMappings[userState.Session]` first, fall back to `_userMappings[joinedUserName]`

### Bridge events

**`voice.userMappingUpdated`**
Shape: `{ sessionId: number, matrixUserId: string, mumbleName: string }`
Emitted for individual mapping changes (add/remove).

**`voice.sessionMappingSnapshot`**
Shape: `{ mappings: Record<number, { matrixUserId: string, mumbleName: string }> }`
Emitted on initial WS connect and on WS reconnect. Allows the frontend to do a bulk update instead of N individual `userMappingUpdated` events for users already connected.

---

## Frontend Changes

### `App.tsx`
`src/Brmble.Web/src/App.tsx`

Add handler for `voice.userMappingUpdated`:
```ts
bridge.on('voice.userMappingUpdated', (data) => {
  const d = data as { sessionId: number; matrixUserId: string; mumbleName: string };
  setUsers(prev => prev.map(u =>
    u.session === d.sessionId ? { ...u, matrixUserId: d.matrixUserId } : u
  ));
});
```

Unmapped sessions render as plain Mumble users until the mapping arrives — no blocking, no loading state needed. The UI upgrades naturally when `voice.userMappingUpdated` fires.

### Visual badge
In the Sidebar user list component: if `user.matrixUserId` is set, render a small Brmble icon/badge next to the username. Classic Mumble users get no badge (or a plain icon). The `types/index.ts` `User` interface already has `matrixUserId?: string` — no change needed.

---

## Critical Files Summary

| File | Change |
|------|--------|
| `src/Brmble.Server/Events/ISessionMappingService.cs` | **NEW** |
| `src/Brmble.Server/Events/SessionMappingService.cs` | **NEW** |
| `src/Brmble.Server/Events/IBrmbleEventBus.cs` | **NEW** |
| `src/Brmble.Server/Events/BrmbleEventBus.cs` | **NEW** |
| `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` | **NEW** |
| `src/Brmble.Server/Auth/CertificateHasher.cs` | **NEW** (shared hash util) |
| `src/Brmble.Server/Mumble/MumbleIceService.cs` | Store serverProxy, call SetServerProxy |
| `src/Brmble.Server/Mumble/MumbleServerCallback.cs` | getCertificateListAsync, push deltas |
| `src/Brmble.Server/Mumble/MumbleExtensions.cs` | Register new singletons |
| `src/Brmble.Server/Auth/AuthEndpoints.cs` | Push delta on auth, add sessionMappings to response |
| `src/Brmble.Server/Auth/UserRepository.cs` | No changes needed (GetByCertHash already exists) |
| `src/Brmble.Server/Program.cs` | UseWebSockets, map /ws |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | WS client, session-keyed mappings, new bridge event |
| `src/Brmble.Web/src/App.tsx` | Handle voice.userMappingUpdated |
| Sidebar component (find exact path) | Brmble badge rendering |

---

## Verification

1. **Unit tests**: `SessionMappingService` — verify concurrent add/remove/snapshot; `BrmbleEventBus` — verify broadcast to multiple clients, verify dead client removal on write failure
2. **Unit test**: `CertificateHasher` — round-trip a known DER cert through `HashDer()` and verify it matches the hash produced by `MtlsCertificateHashExtractor` (confirms `getCertificateListAsync` certs will match DB hashes)
3. **Integration test**: extend `AuthIntegrationTests` — after POST `/auth/token`, verify `sessionMappings` field in response
4. **Manual**: connect two Brmble clients → both show Brmble badges; connect a vanilla Mumble client → no badge; connect Brmble client after others → WebSocket push updates other clients' badges promptly; disconnect and reconnect Brmble client → old session removed, new session appears with badge; verify no ghost entries after disconnect
5. **Manual**: kill the server while a client is connected → verify WS reconnects with backoff and badges restore after server comes back
