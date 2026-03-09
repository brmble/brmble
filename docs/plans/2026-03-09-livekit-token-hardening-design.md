# LiveKit Token Flow Hardening

## Problem

Screen sharing doesn't always work. When it fails, nothing happens — no error, no feedback. If it works on the first attempt, it continues working reliably. The failure is binary and silent.

## Root Cause

The LiveKit token request flow has no retry logic and swallows errors silently:

1. `SendViaBcTls` returns `null` for any non-200 response, losing the actual status code
2. `PostViaBcTls` collapses all failures to `null`
3. The `livekit.requestToken` handler sends a generic "Token request failed" with no detail
4. `LiveKitEndpoints.cs` swallows JSON parse errors with empty catch blocks
5. No retry on transient failures (connection errors, TLS hiccups, 5xx)

## Design: Structured Result Type + Retry

### 1. TlsResult record (MumbleAdapter.cs)

Replace `string?` return from `SendViaBcTls` with a structured result:

```csharp
private record TlsResult(bool Success, string? Body, int StatusCode, string? Error);
```

- `SendViaBcTls` → returns `TlsResult` with actual HTTP status code and error details
- `PostViaBcTls` → returns `TlsResult` instead of `object?`, preserving error context
- Connection/TLS exceptions produce `TlsResult(false, null, 0, ex.Message)`

### 2. Retry with backoff (MumbleAdapter.cs `livekit.requestToken` handler)

- 3 attempts with delays: 500ms, 1000ms, 2000ms
- Only retry on transient failures: connection errors, TLS exceptions, 5xx status codes
- Do NOT retry on 400 (bad request) or 401 (auth failure) — these won't self-resolve
- Log each retry attempt to temp file for diagnostics

### 3. Frontend timeout adjustment (useScreenShare.ts)

- Increase timeout from 15s to 20s to accommodate retry delays (max 3.5s retry + server time)
- Error messages already propagate through `livekit.tokenError` — now they'll carry specific details

### 4. Server-side logging (LiveKitEndpoints.cs)

- Log JSON parse failures with `logger.LogWarning` instead of empty catch
- Existing cert hash logging in `LiveKitService.cs` is already adequate

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Add `TlsResult` record, update `SendViaBcTls`/`PostViaBcTls` return types, add retry logic in `livekit.requestToken` handler |
| `src/Brmble.Web/src/hooks/useScreenShare.ts` | Increase timeout to 20s |
| `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` | Add logging on JSON parse failures |

## Out of Scope

- BouncyCastle TLS transport (required for self-signed certs)
- Token grants or room validation (closed #221 — current behavior is intended)
- Share notification flow (fire-and-forget is acceptable)
- `/livekit/active-share` authentication (separate concern)
