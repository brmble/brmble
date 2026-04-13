# LiveKit Token Revocation Design

**Date**: 2026-04-13  
**Issue**: #354 - LiveKit tokens have no early revocation

## Problem

LiveKit JWTs have a 6-hour TTL with no mechanism for early revocation. A user kicked from Mumble retains screen-share access until the token expires (up to 6 hours).

## Solution: Reduce TTL + Token Refresh

### Server Changes

1. **Reduce TTL** in `LiveKitService.cs`:
   - Change `DefaultTokenTtl` from 6 hours to 1 hour

2. **Add refresh endpoint** (`LiveKitController.cs`):
   - New endpoint: `POST /api/livekit/refresh`
   - Accepts: current room name
   - Validates: user still has access to the room (via Mumble integration)
   - Returns: new JWT with 1-hour TTL
   - If user no longer has access: returns 403

### Client Changes

1. **Token refresh flow**:
   - Track token expiration time locally
   - Background timer checks every 30 seconds
   - When token expires within 5 minutes → request new token

2. **In-place token update**:
   - Use LiveKit SDK's `setToken()` or equivalent method
   - Update token without disconnecting/reconnecting
   - Connection stays alive, media continues playing

3. **Error handling**:
   - If refresh returns 403 → emit disconnect event (user removed from Mumble)
   - Show appropriate error UI

## Data Flow

```
Client with JWT (1hr TTL)
        │
        ▼ (every 30s check)
Token expires within 5 min?
        │
   Yes ─┴─ No (continue)
          │
          ▼
POST /api/livekit/refresh
          │
    ┌─────┴─────┐
    │            │
 200 OK      403
    │            │
    ▼            ▼
New JWT      Disconnect
    │
    ▼
connection.setToken(new JWT)
(keep connection alive)
```

## Acceptance Criteria

- [ ] TTL reduced from 6h to 1h
- [ ] Refresh endpoint validates user access
- [ ] Client refreshes token before expiry without interrupting media
- [ ] Client handles 403 from refresh endpoint gracefully
- [ ] Test: disconnect user from Mumble → they cannot get new LiveKit token