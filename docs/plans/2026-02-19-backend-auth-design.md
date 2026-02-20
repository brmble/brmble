# Backend Auth Implementation Design

**Date:** 2026-02-19
**Authoritative spec:** `docs/server/backend-auth-architecture.md`
**Scope:** Core auth layer — UserRepository, AuthService, ICertificateHashExtractor, AuthEndpoints. LiveKit is a follow-up branch.

---

## What We're Building

The certificate-based identity flow for the ASP.NET backend:

1. Client connects via mTLS presenting its Mumble X.509 certificate
2. `POST /auth/token` extracts the cert hash from the TLS handshake
3. Backend looks up or creates a user record keyed on cert hash
4. Returns a Matrix access token (stubbed for now; real Continuwuity provisioning is a follow-up)

---

## Data Layer — UserRepository

Three methods against the existing `users` SQLite table via Dapper:

- `GetByCertHash(string certHash) → User?`
- `Insert(string certHash, string displayName) → User` — two-step SQLite transaction: insert row, read back `last_insert_rowid()`, compute `matrix_user_id = @{id}:{serverDomain}`, update row. Server domain read from `IConfiguration["Matrix:ServerDomain"]`.
- `UpdateDisplayName(int id, string displayName)`

The `User` record already exists: `(int Id, string CertHash, string DisplayName, string MatrixUserId)`.

---

## Cert Hash Extraction — ICertificateHashExtractor

```csharp
public interface ICertificateHashExtractor
{
    string? GetCertHash(HttpContext context);
}
```

**`MtlsCertificateHashExtractor`** (production):
- Reads `context.Connection.ClientCertificate`
- Returns `cert.GetCertHashString(HashAlgorithmName.SHA1).ToLowerInvariant()`
- Returns `null` if no certificate is present

**`FakeCertificateHashExtractor`** (test project only):
- Configurable hash via constructor, returns it unconditionally
- Injected via `WebApplicationFactory` service override

Registered as singleton in `AuthExtensions.cs`.

---

## Service Layer — AuthService

**`AuthResult` record:** `(string MatrixAccessToken)`

**`Authenticate(string certHash, string displayName) → AuthResult`:**
1. `UserRepository.GetByCertHash(certHash)`
2. If not found → `Insert(certHash, displayName)` → add to `_activeSessions` → return `stub_token_{userId}`
3. If found and `displayName` differs → `UpdateDisplayName` → add to `_activeSessions` → return stub token
4. If found and unchanged → add to `_activeSessions` → return stub token

Stub token format: `stub_token_{userId}` — clearly fake, easy to replace when Continuwuity is wired.

**`Deactivate(string certHash)`:** removes from `_activeSessions`.

---

## Endpoint — POST /auth/token

**Request:** `{ "displayName": "string" }`
**Auth:** mTLS (cert hash extracted from TLS handshake)

Flow:
1. `ICertificateHashExtractor.GetCertHash(httpContext)` → `400` if null
2. `AuthService.Authenticate(certHash, displayName)`
3. Return `200 { "matrixAccessToken": "stub_token_..." }`

---

## Testing Strategy

- `UserRepositoryTests`: in-memory SQLite (existing pattern), fill in TODO tests
- `AuthServiceTests`: unit tests with mock `UserRepository` and mock `IConfiguration`, fill in TODO tests
- `AuthEndpointTests`: `WebApplicationFactory` with `FakeCertificateHashExtractor` injected, new integration test class
- All new tests follow existing MSTest + Moq conventions

---

## Out of Scope (Follow-up Branches)

- Real Continuwuity admin API calls (Matrix account provisioning)
- LiveKit token generation
- mTLS Kestrel configuration (server-side TLS cert setup)
- Display name change policy (currently: sync on every connect per spec)
