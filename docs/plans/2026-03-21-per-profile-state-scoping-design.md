# Per-Profile State Scoping — Design

**Date:** 2026-03-21
**Status:** Approved
**Related:** Multi-profile system (`2026-03-20-multi-profile-design.md`)

## Problem

Several pieces of client-side state are stored globally when they should be scoped per-profile. When a user switches profiles, they see stale data from the previous profile:

1. **Stale registration status** — If Profile A is registered on a server but Profile B is not, the server entry still shows `registered=true` after switching to Profile B and connecting.
2. **Idle game state** — Progress in the "Hosting Empire" game carries across profiles.
3. **Brmblegotchi state** — Virtual pet stats and position carry across profiles.
4. **Read markers** — Unread indicators for chat rooms carry across profiles (each profile has a different Matrix identity server-side).

## Scope

### In Scope (Critical + High Priority)

| Item | Storage | Current Key | Priority |
|---|---|---|---|
| Registration status (clear on connect) | config.json via bridge | Server entry fields | Critical |
| Idle game save | localStorage | `idle-farm-save` | High |
| Idle game theme | localStorage | `idle-farm-theme` | High |
| Brmblegotchi state | localStorage | `brmblegotchi-state` | High |
| Brmblegotchi position | localStorage | `brmblegotchi-position` | High |
| Read markers | localStorage | `brmble-read-markers` | High |

### Out of Scope (Deferred)

| Item | Reason |
|---|---|
| DM contacts (`brmble_dm_contacts_*`) | DM system will be refactored separately |
| Auto-connect settings | Medium priority — GitHub issue to be filed |
| Last connected server (`brmble-server`) | Medium priority — GitHub issue to be filed |
| Chat history (`brmble_chat_*`) | Already server-scoped by room ID |
| Volume/mute settings (`volume_*`, `localMute_*`) | Hardware settings, not identity-bound |
| App settings (`brmble-settings`) | User preferences, not identity-bound |
| Screenshare split (`brmble-screenshare-split`) | UI preference, not identity-bound |

## Design

### 1. Registration Status — Clear on Connect

**Problem:** The `voice.connected` handler in `App.tsx` (line 548) only processes registration when `reg?.registered` is truthy. It never clears stale `registered`/`registeredName` when a server reports the user is NOT registered.

**Solution:** Add an `else` branch to the existing `if (reg?.registered)` block. When the server reports `registered=false` (or omits registration data), clear `registered` to `false` and `registeredName` to `null` on the server entry. Persist via `servers.update` bridge call.

**No schema change needed.** The `ServerEntry` already has optional `registered?: boolean` and `registeredName?: string` fields.

### 2. localStorage Scoping by Cert Fingerprint

**Keying strategy:** Append the full 40-character SHA1 certificate thumbprint to each localStorage key using an underscore separator.

| Old Key | New Key Pattern |
|---|---|
| `idle-farm-save` | `idle-farm-save_{fingerprint}` |
| `idle-farm-theme` | `idle-farm-theme_{fingerprint}` |
| `brmblegotchi-state` | `brmblegotchi-state_{fingerprint}` |
| `brmblegotchi-position` | `brmblegotchi-position_{fingerprint}` |
| `brmble-read-markers` | `brmble-read-markers_{fingerprint}` |

**Why fingerprint?** The cert fingerprint is the true identity — it's what the Mumble server and Matrix homeserver use to identify the user. Profile names can be renamed; fingerprints are immutable.

### 3. ProfileContext for Fingerprint Distribution

**Problem:** Components that need the fingerprint (`useGameState`, `Brmblegotchi`, `useUnreadTracker`) are deep in the component tree. Threading props would be invasive.

**Solution:** Create a `ProfileContext` React context that provides `certFingerprint`.

- `certFingerprint` is already maintained as React state in `App.tsx` (set from `cert.status`, `cert.generated`, `cert.imported`, `profiles.activeChanged`).
- Currently the state value is destructured away: `const [, setCertFingerprint] = useState('')`. Change to `const [certFingerprint, setCertFingerprint]`.
- Wrap the app content in `<ProfileContext.Provider value={certFingerprint}>`.
- Consumers call `useProfileFingerprint()` to get the value.

### 4. Component Changes

#### `useGameState.ts`
- Accept `fingerprint` parameter (from context, passed by caller).
- Derive scoped keys: `idle-farm-save_{fingerprint}`, `idle-farm-theme_{fingerprint}`.
- When `fingerprint` is empty string (no profile loaded), use the old unscoped key as fallback for backward compatibility.
- All 6 localStorage access points updated to use scoped keys.

#### `Brmblegotchi.tsx`
- Read `certFingerprint` from `ProfileContext`.
- Derive scoped keys: `brmblegotchi-state_{fingerprint}`, `brmblegotchi-position_{fingerprint}`.
- When fingerprint changes (profile switch), re-initialize state from the new scoped keys.
- All 7 localStorage access points updated.

#### `useUnreadTracker.ts`
- Module-level `markersCache` must be invalidated on profile switch.
- Add a `resetMarkersCache()` export function.
- `loadMarkers()` and `saveMarker()` accept a `fingerprint` parameter to build the scoped key.
- Callers pass fingerprint from context.
- When fingerprint is empty, fall back to the unscoped key.

### 5. Migration

Create a `migrateLocalStorage(fingerprint: string)` utility function:

```
For each old global key:
  1. If old key exists in localStorage AND new scoped key does NOT exist:
     - Copy value from old key to new scoped key
     - Delete old key
  2. If both exist, do nothing (scoped key takes precedence)
  3. If only scoped key exists, do nothing (already migrated)
```

**Properties:**
- Idempotent — safe to run multiple times
- Non-destructive — only migrates if the scoped key doesn't already exist
- Runs once on app startup after fingerprint is known

**Trigger:** Call `migrateLocalStorage(fingerprint)` in `App.tsx` when `certFingerprint` is first set (or changes).

### 6. Profile Switch Behavior

When the active profile changes (`profiles.activeChanged`):
1. `certFingerprint` state updates (already happens).
2. `migrateLocalStorage(newFingerprint)` runs for the new profile.
3. `resetMarkersCache()` is called to invalidate the unread tracker cache.
4. Components re-render with the new fingerprint via context, loading their state from new scoped keys.

**Note:** `useGameState` and `Brmblegotchi` use `useState` lazy initializers, which only run on mount. On profile switch, these components need to detect the fingerprint change and re-load state. This is handled by `useEffect` watching the fingerprint value.

## Non-Goals

- No changes to `config.json` schema
- No changes to C# backend
- No changes to bridge protocol
- No server-side changes
