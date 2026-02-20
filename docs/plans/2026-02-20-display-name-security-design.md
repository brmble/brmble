# Display Name Security Design

**Date:** 2026-02-20

## Problem

`POST /auth/token` currently accepts a `displayName` field in the request body and updates the stored display name for existing users on every reconnect. This allows any authenticated user (with their own valid cert) to supply an arbitrary display name — including someone else's — causing impersonation in the Matrix UI.

## Decision

Remove `displayName` from the token request entirely. Display names are owned by Mumble (the authoritative source) and flow into the backend via UserState sync only. The backend never trusts a client-supplied name after the initial identity is established.

---

## Race Condition

Mumble UserState and the backend auth call (`POST /auth/token`) are independent and can arrive in either order.

**Case 1 — Mumble UserState arrives first (common path)**

Mumble syncs immediately on connect. The backend observes a cert hash + confirmed Mumble username before the client has called `/auth/token`. If discarded, the name is lost and the user gets a placeholder.

**Case 2 — Backend auth arrives first**

`/auth/token` is called before the UserState is observed. The user is inserted with a placeholder name (`user_{id}`). When the UserState arrives shortly after, the name is updated. The client sees the real name on the next Matrix sync cycle — no reconnect required.

---

## Design

### Pending Name Queue

`AuthService` holds a `ConcurrentDictionary<string, string>` (`_pendingNames`) mapping cert hash → Mumble-confirmed display name.

This is in-memory and ephemeral. It is only populated for the brief window between a UserState being observed and the user's first backend auth call. On server restart all sessions re-authenticate, so no persistence is needed.

### Mumble UserState handler — `HandleUserState(string certHash, string displayName)`

Called by the Mumble UserState sync on every relevant UserState message.

```
Look up certHash in DB
  IF user found AND displayName differs:
    UpdateDisplayName(user.Id, displayName)       ← Case 2 resolution
  IF user not found:
    _pendingNames[certHash] = displayName         ← park for Case 1
```

### `Authenticate(string certHash)` — no displayName parameter

```
Look up certHash in DB
  IF user not found:
    name = _pendingNames.TryRemove(certHash) ?? "user_{id_placeholder}"
    Insert(certHash, name)                        ← Case 1 resolution (or placeholder)
  Add certHash to _activeSessions
  Return AuthResult(stub_token_{user.Id})
```

The placeholder `user_{id}` is only used when neither a pending name nor an existing record is present — i.e. the backend auth call arrives before any Mumble UserState for this cert. The UserState will follow and `UpdateDisplayName` will be called, updating the Matrix display name transparently.

### `UserRepository.Insert(string certHash, string displayName)`

Signature unchanged. The `displayName` parameter is now always supplied by `AuthService` — either from the pending queue or the placeholder — never from the HTTP request body.

### `POST /auth/token` — request body dropped

`AuthTokenRequest` record is deleted. The endpoint handler takes no body parameters. Only the cert hash (from mTLS via `ICertificateHashExtractor`) is needed.

---

## Client Transparency (Case 2)

When `UpdateDisplayName` is called after a placeholder insert, the Matrix display name is updated via the Continuwuity admin API. The Matrix JS SDK picks this up on its next sync. No reconnect, no action required from the client.

---

## What Changes

| | Before | After |
|---|---|---|
| `POST /auth/token` body | `{ displayName }` | empty |
| `AuthTokenRequest` | `record AuthTokenRequest(string DisplayName)` | deleted |
| `AuthService.Authenticate` | `(string certHash, string displayName)` | `(string certHash)` |
| Existing user reconnect | Updates display name from request | No-op |
| New user registration | Uses request body name | Uses pending queue name, or placeholder |
| Display name updates | Client-controlled via token request | Mumble UserState sync only |
| New method | — | `AuthService.HandleUserState(string certHash, string displayName)` |

## What Does Not Change

- `UserRepository.UpdateDisplayName` — same signature, same SQL
- `UserRepository.Insert` — same signature, displayName still passed in (now from queue/placeholder)
- `ICertificateHashExtractor` and mTLS flow — unchanged
- `IActiveBrmbleSessions` / `Deactivate` — unchanged

---

## Tests

### Updated
- `Authenticate_NewUser_ReturnsStubToken` — no displayName arg
- `Authenticate_NewUser_AddsToActiveSessions` — no displayName arg
- `Authenticate_ExistingUser_StillAddsToActiveSessions` — no displayName arg
- `Insert_NewUser_PersistsToDatabase` — assert placeholder format `user_{id}` when no pending name
- `PostToken_ValidRequest_ReturnsOk` — no displayName in request body
- `PostToken_ValidRequest_ReturnsStubToken` — no displayName in request body

### New
- `HandleUserState_BeforeAuth_QueuesName` — UserState arrives first; subsequent Authenticate uses queued name, not placeholder
- `HandleUserState_AfterAuth_UpdatesDisplayName` — Authenticate first (placeholder); UserState arrives; DB name is updated
- `HandleUserState_UnknownCert_DoesNotThrow` — defensive: cert hash with no record and no queue entry is a no-op
- `Authenticate_WithPendingName_UsesQueuedName` — queue populated; Authenticate picks it up and removes it
- `Authenticate_NoPendingName_UsesPlaceholder` — no queue entry; placeholder `user_{id}` format asserted
