# Per-Server Default Profile — Design Spec

**Issue:** #430  
**Date:** 2026-04-02  
**Status:** Draft

## Summary

Allow users to assign a default profile (certificate/identity) per saved server. When connecting to that server, the global active profile is switched automatically so the correct certificate is used. This is a power-user feature: the UI only appears when 2+ profiles exist.

## Current State

- Profiles are certificate bundles (TLS identities), managed by `CertificateService`
- A single global "active profile" determines which certificate is used for all connections
- `ServerEntry` already tracks per-server registration state (`Registered`, `RegisteredName`)
- Certificate loading flows through one path: `CertificateService.ActiveCertPath` reads `_config.GetActiveProfileId()`

## Design Decisions

1. **Reuse the global active profile mechanism** — instead of creating a parallel cert-loading path, switch the global active profile before connecting. All existing code paths (cert loading, UI updates, persistence) work automatically.
2. **Profile dropdown only at 2+ profiles** — when there's only one profile, there's nothing to choose. The dropdown and badges are hidden.
3. **Badges only for overrides** — servers using the default (active) profile show no badge. Only servers with an explicit profile override display the badge.
4. **Silent switch** — no confirmation dialog. The profile switches automatically on connect.

## Data Model

### ServerEntry (C#)

Add one field to the existing `ServerEntry` record:

```csharp
public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Password = "",
    bool Registered = false,
    string? RegisteredName = null,
    string? DefaultProfileId = null  // NEW: null = use active profile
);
```

### Persistence

`DefaultProfileId` is persisted alongside other `ServerEntry` fields in `AppConfigService`. No new storage mechanism needed — it serializes/deserializes with the existing JSON config.

### Bridge Protocol

Existing `servers.response` and `servers.update` messages already carry `ServerEntry` fields. The new `DefaultProfileId` field flows through automatically.

## Backend Changes

### Connection Flow (VoiceService / MumbleAdapter)

Before initiating the Mumble connection, check if the target server has a `DefaultProfileId`:

1. Receive `voice.connect` message with server host/port
2. Look up the `ServerEntry` by host/port in `ServerlistService`
3. If `ServerEntry.DefaultProfileId` is set and differs from current active profile:
   - Call `_config.SetActiveProfileId(defaultProfileId)`
   - Send `profiles.activeChanged` bridge event (so frontend updates)
4. Proceed with connection (existing flow — `ActiveCertPath` now returns the correct cert)

**Location:** This logic lives in the frontend `handleServerConnect` function in `App.tsx`. Before sending `voice.connect`, it sends `profiles.setActive` with the server's `DefaultProfileId`. This reuses the existing `profiles.setActive` backend handler (in `CertificateService`) which handles cert switching, UI notification, and persistence — no new backend code needed for the switch itself.

### Edge Cases

- **DefaultProfileId points to a deleted profile:** Treat as null (use active profile). Clear the stale `DefaultProfileId` from the `ServerEntry` so the badge disappears. This cleanup happens in `AppConfigService.RemoveProfile()` — iterate all server entries and null out any matching `DefaultProfileId`.
- **Already on the correct profile:** No-op, proceed directly.
- **Currently connected to another server:** The existing disconnect-before-connect flow handles this. Profile switch happens after disconnect.

## Frontend Changes

### 1. Server Edit Form — Profile Dropdown

**File:** `ServerList.tsx`

- Add a `<Select>` dropdown below the password field, separated by a subtle divider
- Only rendered when `profiles.length >= 2`
- Options: "Use active profile" (value: `""`) + all profiles by name
- Value bound to `form.defaultProfileId`
- On save, `defaultProfileId` is included in the `servers.update` bridge message

### 2. Server List — Profile Badge

**File:** `ServerList.tsx`

- Each server list item shows a small badge/tag when:
  - 2+ profiles exist, AND
  - The server has a `DefaultProfileId` set (non-null)
- Badge displays the profile name
- Servers without an override show no badge
- Badge is read-only (click the edit button to change)

### 3. Data Flow

- `useServerlist` hook already receives full `ServerEntry` data from the backend
- `useProfiles` hook provides the profiles list for the dropdown
- No new hooks or bridge messages needed

## Files to Modify

### Backend (C#)
| File | Change |
|------|--------|
| `Services/Serverlist/IServerlistService.cs` | Add `DefaultProfileId` to `ServerEntry` record |
| `Services/Voice/VoiceService.cs` | No changes needed — profile switch happens in frontend before `voice.connect` |
| `Services/AppConfig/AppConfigService.cs` | Add cleanup: when a profile is removed, null out `DefaultProfileId` on any server entry referencing it |

### Frontend (TypeScript/React)
| File | Change |
|------|--------|
| `components/ServerList/ServerList.tsx` | Add profile dropdown to edit form + badge on list items |
| `hooks/useServerlist.ts` | Type update: add `defaultProfileId` to server entry type |

### Tests
| File | Change |
|------|--------|
| `tests/Brmble.Client.Tests/` | Test profile switch on connect, stale profile ID handling |

## Out of Scope

- Rethinking whether a global "active profile" is still needed (parked for later)
- Per-server avatar or display name (profiles are certificate-only)
- Profile selection in the ConnectModal (quick-connect uses active profile)
- Any changes to the ProfileSettingsTab
