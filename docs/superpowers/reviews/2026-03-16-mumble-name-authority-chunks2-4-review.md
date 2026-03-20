# Review: Mumble Name Authority -- Chunks 2-4 (Tasks 4-12)

**Reviewer:** Code Review Agent
**Date:** 2026-03-16
**Plan:** `docs/superpowers/plans/2026-03-16-mumble-name-authority.md`
**Spec:** `docs/superpowers/specs/2026-03-15-mumble-name-authority-design.md`

---

## What Was Done Well

- The three migration branches from the spec (already registered, not registered + name available, not registered + name taken) are all covered in Task 5 Step 3.
- The TOCTOU race condition is handled correctly: no pre-check for name availability, just catch `InvalidUserException` from `registerUserAsync`.
- The `ResolveMumbleNameAsync` method correctly prioritizes Mumble's registered name over the client-supplied name (cert mismatch scenario from spec).
- Error typing is clear: `MumbleNameConflictException` vs `MumbleRegistrationException` with distinct HTTP status codes (409 vs 503).
- TDD ordering in Task 4 is correct (write test, verify fail, implement, verify pass).

---

## Critical Issues (Must Fix)

### C1: Auth response does not flow through HTTP to the frontend -- bridge architecture mismatch

The plan's frontend error handling (Task 10, Chunk 3) assumes the frontend receives HTTP status codes directly:

```typescript
if (response.status === 409) {
  const data = await response.json();
```

**This is wrong.** The auth call flows through the C# bridge, not a direct HTTP call:
1. Frontend sends `voice.connect` via bridge
2. `MumbleAdapter.Connect()` connects to Mumble
3. `MumbleAdapter.ServerConnected()` calls `FetchAndSendCredentials()`
4. `FetchCredentialsViaBcTls()` makes the HTTP POST to `/auth/token`
5. On success, sends `server.credentials` bridge message to frontend
6. On failure (non-200), **returns null silently** -- no error is sent to the frontend

The frontend never sees HTTP status codes. The plan must:
1. Update `FetchCredentialsViaBcTls` (or `FetchAndSendCredentials`) in `MumbleAdapter.cs` to parse 409/503 responses and send a specific bridge message (e.g., `voice.authError` with `{ error: "name_taken", name: "..." }`)
2. Update the frontend to listen for this bridge message instead of checking HTTP status codes
3. Add `MumbleAdapter.cs` to the modified files list

### C2: `certHash` is not available in `ResolveMumbleNameAsync` / `Authenticate()` from MumbleAdapter

The plan's `ResolveMumbleNameAsync(mumbleName, certHash)` needs the cert hash. Looking at `AuthEndpoints.cs`, `certHash` is extracted from the TLS connection via `certHashExtractor.GetCertHash(httpContext)` -- this is available server-side. However, the plan's existing-user reconciliation code (Task 5 Step 3) calls `RegisterUserAsync(user.DisplayName, certHash)` which is correct since `certHash` comes from the endpoint parameter.

No issue here on second analysis -- the cert hash is available at the endpoint level. This is fine.

### C3: `_reconnectUsername` may be stale or wrong for error recovery

`FetchCredentialsViaBcTls` uses `_reconnectUsername` as the `mumbleUsername` body parameter. But after a name conflict (409), the user needs to change their username and reconnect. The plan does not address how `_reconnectUsername` gets updated in the MumbleAdapter after the frontend receives the error and the user picks a new name. Currently, `_reconnectUsername` is set during `Connect()` and reused during reconnects. The plan needs to ensure:
- After a name conflict, the user can edit their username (plan covers this)
- When they reconnect, the new username propagates through `voice.connect` to `MumbleAdapter.Connect()` which sets `_reconnectUsername` (this works if they fully disconnect and reconnect)

This is OK if the flow is: conflict -> disconnect -> user edits name -> reconnect. But the plan should be explicit about this.

---

## Important Issues (Should Fix)

### I1: Task 5 adds `ISessionMappingService` dependency to `AuthService` but existing tests do not mock it

The existing `AuthServiceTests.cs` constructs `AuthService` with only 3 parameters:
```csharp
_svc = new AuthService(repo, _mockMatrix.Object, NullLogger<AuthService>.Instance);
```

Adding `IMumbleRegistrationService` and `ISessionMappingService` to the constructor will break all existing tests. The plan must include a step to update `AuthServiceTests.cs` to provide the new mocked dependencies. This is not mentioned anywhere in Chunks 2-4.

### I2: Task 6 test bodies are pseudocode placeholders

The test implementations in Task 6 are just comments describing what the test should do:
```csharp
// Setup: user is already registered in Mumble as "arie"
// Mock: sessionMapping returns sessionId, registrationService returns registered
// Assert: returns "arie" regardless of input name
```

The implementing agent will need to construct `AuthService` with all its dependencies mocked. Given I1 above, this is a significant gap. The plan should provide at minimum the mock setup pattern showing how to construct `AuthService` with the new dependencies.

### I3: Auth response `registered` field (Task 7) always returns `true` -- misleading for existing unregistered users

Task 7 Step 1 says:
```csharp
registered = true  // NEW: user is always registered after successful auth
```

This is only correct if `Authenticate()` always registers the user. But for existing users whose name conflicts (fallback to `user_{id}`), they are NOT truly registered -- they need to pick a new name. The `registered` field should reflect actual Mumble registration status, not just "auth succeeded." The `AuthResult` record should carry a `bool IsRegistered` field set by the actual registration check.

### I4: No update to `AuthResult` record to carry registration info

The current `AuthResult` record is:
```csharp
public record AuthResult(long UserId, string MatrixUserId, string MatrixAccessToken, string DisplayName);
```

The plan modifies `Authenticate()` to handle registration but never updates `AuthResult` to carry registration status or the resolved name back to the endpoint. The endpoint needs to know:
- Whether the user is registered (for the `registered` response field)
- The resolved/authoritative display name (which may differ from what was requested)

`AuthResult` should be extended, e.g.:
```csharp
public record AuthResult(long UserId, string MatrixUserId, string MatrixAccessToken, string DisplayName, bool IsRegistered);
```

### I5: `registered` flag in `ServerEntry` is per-server but stored client-side without server confirmation

The plan stores `registered` in the `ServerEntry` in localStorage via `useServerlist`. But the `registered` flag comes from the auth response that flows through the C# bridge as `server.credentials`. The plan does not show how this flag gets from the bridge message into the server list entry. The `server.credentials` handler in App.tsx would need to read the `registered` field and call `updateServer()`.

### I6: Task 4 TDD is partially correct but validation is too minimal

The spec says: "No invalid characters (Mumble rejects names with certain characters)." The plan's `ValidateMumbleUsername` only checks empty and length > 128. It does not validate characters. While Mumble will reject invalid names, the spec explicitly says to validate on the Brmble side to provide clear error messages. At minimum, add a test/check for known-bad characters.

---

## Suggestions (Nice to Have)

### S1: Consider adding `displayName` to the `registered` response field

Instead of just `registered: true`, the auth response could include `registeredName: "arie"` so the frontend can update the displayed username to match the authoritative name (handles the cert-mismatch scenario where the server overrides the requested name).

### S2: Task 11 (ProfileSettingsTab) is too simplistic

The plan unconditionally disables the display name field. But not all users may be connected to a server. The `disabled` state should be conditional on having a registered name for the current server connection, not always disabled. The existing component already receives `connected` and `connectedUsername` props, so the logic should be:
```tsx
disabled={connected && !!connectedUsername}
```

### S3: Consider adding the `voice.authError` bridge message to the Bridge Architecture section

Since C1 requires a new bridge message, the message protocol documentation in CLAUDE.md should be updated.

---

## Plan Alignment Summary

| Spec Requirement | Plan Coverage | Status |
|---|---|---|
| 3 migration branches | Task 5 Step 3 | Covered |
| TOCTOU via catch | Task 5 Step 2 `RegisterUserAsync` | Covered |
| Cert mismatch handling | `ResolveMumbleNameAsync` ignores client name | Covered |
| ICE unavailable = fail | `MumbleRegistrationException` -> 503 | Covered |
| Username validation | Task 4 (partial) | Missing character validation |
| Username field disabled after registration | Tasks 8, 9 | Covered (but see I5) |
| Name conflict error in UI | Task 10 | Wrong architecture (C1) |
| ProfileSettingsTab read-only | Task 11 | Covered (but see S2) |
| `registered` response field | Task 7 | Wrong value logic (I3, I4) |
| Auth response through bridge | Not addressed | Missing (C1) |
| Existing test compatibility | Not addressed | Missing (I1) |

---

## Recommended Actions

1. **[C1] Rewrite Task 10 and Task 7 Step 3** to route errors through the C# bridge, not HTTP status codes. Add `MumbleAdapter.cs` to modified files. Define a new bridge message for auth errors.
2. **[I1] Add a step** in Task 5 or Task 6 to update existing `AuthServiceTests.cs` constructor calls with the new dependencies.
3. **[I3/I4] Update `AuthResult`** to carry `IsRegistered` and use it in the response, not a hardcoded `true`.
4. **[I5] Specify** how the `registered` flag flows from `server.credentials` bridge message into the `ServerEntry` stored in localStorage.
5. **[I6] Add character validation** tests and implementation to Task 4.
6. **[I2] Flesh out** Task 6 test bodies with actual mock setup patterns.
