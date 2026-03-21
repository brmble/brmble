# Per-Profile State Scoping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scope localStorage-backed state (idle game, brmblegotchi, read markers) per-profile using the cert fingerprint, clear stale registration on connect, and migrate existing data.

**Architecture:** Create a `ProfileContext` providing `certFingerprint` to the component tree. Each component reads its scoped localStorage key (`{baseKey}_{fingerprint}`). A one-time migration copies old global keys to scoped keys. The `voice.connected` handler gets an `else` branch to clear stale registration.

**Tech Stack:** React (context, hooks), TypeScript, localStorage

---

### Task 1: Clear Stale Registration on Connect

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:548-563`

**Step 1: Add else branch to clear stale registration**

In the `onVoiceConnected` handler, after the existing `if (reg?.registered) { ... }` block (line 550-562), add an `else` branch that clears `registered` and `registeredName` on the saved server entry:

```typescript
      // Persist Mumble registration status to the saved server entry
      const reg = data as { registered?: boolean; registeredName?: string } | undefined;
      if (reg?.registered) {
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id) {
              const updated = { ...savedServer, registered: true, username: reg.registeredName ?? savedServer.username, registeredName: reg.registeredName };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      } else {
        // Clear stale registration when server reports not-registered
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id && savedServer.registered) {
              const updated = { ...savedServer, registered: false, registeredName: undefined };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      }
```

Note: The `else` branch only sends updates when `savedServer.registered` is currently truthy, avoiding unnecessary writes when the server was already marked as not-registered.

**Step 2: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success, no type errors

**Step 3: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "fix: clear stale registration status when server reports not-registered"
```

---

### Task 2: Create ProfileContext

**Files:**
- Create: `src/Brmble.Web/src/contexts/ProfileContext.tsx`
- Modify: `src/Brmble.Web/src/App.tsx:1,136`

**Step 1: Create the ProfileContext file**

Create `src/Brmble.Web/src/contexts/ProfileContext.tsx`:

```typescript
import { createContext, useContext } from 'react';

const ProfileContext = createContext<string>('');

export const ProfileProvider = ProfileContext.Provider;

export function useProfileFingerprint(): string {
  return useContext(ProfileContext);
}
```

**Step 2: Expose certFingerprint in App.tsx**

In `App.tsx` line 136, change:
```typescript
const [, setCertFingerprint] = useState('');
```
to:
```typescript
const [certFingerprint, setCertFingerprint] = useState('');
```

**Step 3: Import ProfileProvider in App.tsx**

Add to imports at top of `App.tsx`:
```typescript
import { ProfileProvider } from './contexts/ProfileContext';
```

**Step 4: Wrap app content with ProfileProvider**

In the `return` statement of `App()`, wrap the outermost `<div className="app">` children with the provider. Find the opening `<div className="app">` (should be around line 1656) and wrap the content:

```tsx
return (
  <div className="app">
    <ProfileProvider value={certFingerprint}>
      {/* ...existing content... */}
    </ProfileProvider>
  </div>
);
```

Note: The `<ProfileProvider>` should go just inside `<div className="app">`, wrapping everything until the closing `</div>`. This ensures all child components can access the fingerprint.

**Step 5: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success, no type errors

**Step 6: Commit**

```
git add src/Brmble.Web/src/contexts/ProfileContext.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: add ProfileContext to provide cert fingerprint to component tree"
```

---

### Task 3: Create localStorage Migration Utility

**Files:**
- Create: `src/Brmble.Web/src/utils/migrateLocalStorage.ts`
- Modify: `src/Brmble.Web/src/App.tsx` (call migration on fingerprint set)

**Step 1: Create the migration utility**

Create `src/Brmble.Web/src/utils/migrateLocalStorage.ts`:

```typescript
/**
 * Migrate global localStorage keys to per-profile scoped keys.
 *
 * For each key, if the old global key exists AND the new scoped key
 * does NOT exist, copies the value and deletes the old key.
 * Idempotent — safe to run multiple times.
 */

const KEYS_TO_MIGRATE = [
  'idle-farm-save',
  'idle-farm-theme',
  'brmblegotchi-state',
  'brmblegotchi-position',
  'brmble-read-markers',
];

export function migrateLocalStorage(fingerprint: string): void {
  if (!fingerprint) return;

  for (const key of KEYS_TO_MIGRATE) {
    const scopedKey = `${key}_${fingerprint}`;
    const oldValue = localStorage.getItem(key);
    if (oldValue !== null && localStorage.getItem(scopedKey) === null) {
      localStorage.setItem(scopedKey, oldValue);
      localStorage.removeItem(key);
    }
  }
}
```

**Step 2: Call migration in App.tsx when fingerprint is set**

Add import at top of `App.tsx`:
```typescript
import { migrateLocalStorage } from './utils/migrateLocalStorage';
```

Add a `useEffect` in `App()` (after the `certFingerprint` state declaration, around line 138) that runs migration when fingerprint changes:

```typescript
useEffect(() => {
  if (certFingerprint) {
    migrateLocalStorage(certFingerprint);
  }
}, [certFingerprint]);
```

**Step 3: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 4: Commit**

```
git add src/Brmble.Web/src/utils/migrateLocalStorage.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add localStorage migration utility for per-profile state scoping"
```

---

### Task 4: Scope useGameState to Profile Fingerprint

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

**Step 1: Add fingerprint parameter to useGameState**

In `useGameState.ts`, import `useProfileFingerprint`:

```typescript
import { useProfileFingerprint } from '../../contexts/ProfileContext';
```

Change the hook signature and add scoped key derivation. At line 61:

```typescript
export function useGameState() {
  const fingerprint = useProfileFingerprint();
  const storageKey = fingerprint ? `${STORAGE_KEY}_${fingerprint}` : STORAGE_KEY;
  const themeKey = fingerprint ? `idle-farm-theme_${fingerprint}` : 'idle-farm-theme';
```

**Step 2: Replace all STORAGE_KEY references with storageKey**

Replace every `STORAGE_KEY` usage inside the hook body with `storageKey`, and `'idle-farm-theme'` with `themeKey`. There are 6 locations:

1. Line 63 (useState initializer): `localStorage.getItem(storageKey)`
2. Line 98 (auto-save interval): `localStorage.setItem(storageKey, ...)`
3. Line 230 (theme save): `localStorage.setItem(themeKey, theme)`
4. Line 234 (manual save): `localStorage.setItem(storageKey, ...)`
5. Line 238 (manual load): `localStorage.getItem(storageKey)`
6. Line 254 (reset): `localStorage.removeItem(storageKey)`

**Step 3: Re-load state when fingerprint changes**

The `useState` lazy initializer only runs on mount. Add a `useEffect` to reload state when fingerprint changes:

```typescript
const fingerprintRef = useRef(fingerprint);
useEffect(() => {
  if (fingerprint && fingerprint !== fingerprintRef.current) {
    fingerprintRef.current = fingerprint;
    const key = `${STORAGE_KEY}_${fingerprint}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (hasInfrastructure(parsed) && hasServices(parsed)) {
          setState(parsed);
          return;
        }
      } catch { /* ignore */ }
    }
    setState(INITIAL_STATE);
  }
}, [fingerprint]);
```

**Step 4: Add storageKey to auto-save dependency array**

The auto-save `useEffect` (line 96-101) uses `[]` dependency. Since `storageKey` can change, update it:

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    localStorage.setItem(storageKey, JSON.stringify({ ...stateRef.current, lastSaved: Date.now() }));
  }, 30000);
  return () => clearInterval(interval);
}, [storageKey]);
```

**Step 5: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 6: Commit**

```
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: scope idle game state to active profile fingerprint"
```

---

### Task 5: Scope Brmblegotchi to Profile Fingerprint

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Import useProfileFingerprint and derive scoped keys**

Add import:
```typescript
import { useProfileFingerprint } from '../../contexts/ProfileContext';
```

At the start of `BrmblegotchiWidget()` (line 88), add:
```typescript
export function BrmblegotchiWidget() {
  const fingerprint = useProfileFingerprint();
  const stateKey = fingerprint ? `${STATE_KEY}_${fingerprint}` : STATE_KEY;
  const positionKey = fingerprint ? `${POSITION_KEY}_${fingerprint}` : POSITION_KEY;
```

**Step 2: Replace all STATE_KEY / POSITION_KEY with scoped versions**

Replace every usage in the component body:

- `STATE_KEY` → `stateKey` (lines 105, 163, 203)
- `POSITION_KEY` → `positionKey` (lines 94, 251)

The `SETTINGS_KEY` references stay global (settings are shared).

**Step 3: Re-initialize state when fingerprint changes**

Add a `useEffect` to reload state and position when fingerprint changes:

```typescript
const fingerprintRef = useRef(fingerprint);
useEffect(() => {
  if (fingerprint && fingerprint !== fingerprintRef.current) {
    fingerprintRef.current = fingerprint;
    // Reload pet state
    try {
      const stored = localStorage.getItem(`${STATE_KEY}_${fingerprint}`);
      if (stored) {
        const saved = JSON.parse(stored) as PetState;
        const elapsed = (Date.now() - saved.lastUpdate) / 1000;
        setPetState({
          hunger: Math.max(0, saved.hunger - elapsed * 0.0069),
          happiness: Math.max(0, saved.happiness - elapsed * 0.0139),
          cleanliness: Math.max(0, saved.cleanliness - elapsed * 0.0278),
          lastUpdate: Date.now(),
          lastActionTime: saved.lastActionTime ?? 0,
        });
      } else {
        setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
      }
    } catch {
      setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
    }
    // Reload position
    try {
      const stored = localStorage.getItem(`${POSITION_KEY}_${fingerprint}`);
      if (stored) {
        setPosition(JSON.parse(stored));
      } else {
        setPosition({ bottom: 150, right: 24 });
      }
    } catch {
      setPosition({ bottom: 150, right: 24 });
    }
  }
}, [fingerprint]);
```

**Step 4: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 5: Commit**

```
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat: scope brmblegotchi state to active profile fingerprint"
```

---

### Task 6: Scope Read Markers to Profile Fingerprint

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useUnreadTracker.ts`
- Modify: `src/Brmble.Web/src/App.tsx` (call resetMarkersCache on profile switch)

**Step 1: Add fingerprint parameter to module-level functions**

In `useUnreadTracker.ts`, change the module-level functions to accept a fingerprint parameter:

Change `STORAGE_KEY` usage to be dynamic. Add a helper:

```typescript
function getStorageKey(fingerprint: string): string {
  return fingerprint ? `${STORAGE_KEY}_${fingerprint}` : STORAGE_KEY;
}
```

Update `loadMarkers` to accept fingerprint and use scoped key:
```typescript
let markersCacheFingerprint: string | null = null;

function loadMarkers(fingerprint: string): Record<string, StoredMarker> {
  if (markersCache && markersCacheFingerprint === fingerprint) return markersCache;
  const key = getStorageKey(fingerprint);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      markersCache = {};
      markersCacheFingerprint = fingerprint;
      return markersCache;
    }
    const parsed = JSON.parse(raw);
    const result: Record<string, StoredMarker> = {};
    for (const [roomId, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        result[roomId] = { eventId: value, ts: Date.now() };
      } else {
        result[roomId] = value as StoredMarker;
      }
    }
    markersCache = result;
    markersCacheFingerprint = fingerprint;
    return markersCache;
  } catch {
    markersCache = {};
    markersCacheFingerprint = fingerprint;
    return markersCache;
  }
}
```

Update `saveMarker`:
```typescript
function saveMarker(roomId: string, eventId: string, ts: number, fingerprint: string): void {
  const markers = loadMarkers(fingerprint);
  markers[roomId] = { eventId, ts };
  try {
    localStorage.setItem(getStorageKey(fingerprint), JSON.stringify(markers));
  } catch { /* localStorage may be full */ }
}
```

Update `getMarker`:
```typescript
function getMarker(roomId: string, fingerprint: string): StoredMarker | null {
  return loadMarkers(fingerprint)[roomId] ?? null;
}
```

Add `resetMarkersCache` export:
```typescript
export function resetMarkersCache(): void {
  markersCache = null;
  markersCacheFingerprint = null;
}
```

**Step 2: Thread fingerprint through useUnreadTracker hook**

Add fingerprint parameter to the hook:
```typescript
export function useUnreadTracker(
  client: MatrixClient | null,
  dmRoomIds: Set<string>,
  activeRoomId: string | null,
  currentDisplayName?: string | null,
  fingerprint?: string,
): UnreadTracker {
```

Use `fingerprint ?? ''` in all calls to `loadMarkers`, `saveMarker`, `getMarker` within the hook body. There are 5 call sites:

1. `buildRoomUnread` — `getMarker(room.roomId, fp)` (2 occurrences, lines ~206, ~253)
2. `markRoomRead` — `saveMarker(roomId, messageEventId, markerTs, fp)` (line ~359)
3. `getMarkerTimestamp` — `getMarker(roomId, fp)` (line ~430)
4. `refreshAll` — `getMarker(room.roomId, fp)` (line ~253)

Store fingerprint in a local variable:
```typescript
const fp = fingerprint ?? '';
```

**Step 3: Pass fingerprint to useUnreadTracker call in App.tsx**

In `App.tsx` around line 330, update the call:
```typescript
const unreadTracker = useUnreadTracker(
  matrixClient?.client ?? null,
  dmRoomIds,
  activeMatrixRoomId,
  username || null,
  certFingerprint,
);
```

**Step 4: Call resetMarkersCache on profile switch in App.tsx**

Import `resetMarkersCache`:
```typescript
import { useUnreadTracker, resetMarkersCache } from './hooks/useUnreadTracker';
```

In the `onProfilesActiveChanged` handler (line 918-929), add `resetMarkersCache()` call:
```typescript
const onProfilesActiveChanged = (data: unknown) => {
  const d = data as { id: string | null; name: string | null; fingerprint: string | null };
  resetMarkersCache();
  if (d.id) {
    // ...existing code...
```

**Step 5: Build to verify**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success

**Step 6: Commit**

```
git add src/Brmble.Web/src/hooks/useUnreadTracker.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: scope read markers to active profile fingerprint"
```

---

### Task 7: Build Verification & Final Commit

**Files:**
- None (verification only)

**Step 1: Run full frontend build**

Run: `npm run build` (in `src/Brmble.Web`)
Expected: Success with zero errors

**Step 2: Run dotnet build**

Run: `dotnet build`
Expected: Success (no C# changes in this plan, but verify nothing is broken)

**Step 3: Run tests**

Run: `dotnet test`
Expected: All tests pass

---

### Task 8: Create GitHub Issue for Medium-Priority Items

**Files:**
- None (GitHub issue only)

**Step 1: Create the issue**

Use `gh issue create` with the following content:

Title: `Per-profile scoping for auto-connect and last-connected-server settings`

Body:
```
## Context

With the multi-profile system, several settings are currently shared globally but should be scoped per-profile in a future iteration.

## Items

- [ ] `autoConnectEnabled` / `autoConnectServerId` — auto-connect preferences should be per-profile
- [ ] `lastConnectedServerId` — last connected server should track per-profile
- [ ] `brmble-server` localStorage key — stores the last connected server entry, should be per-profile

## Notes

These are medium priority because they don't cause data corruption or incorrect behavior — they just mean preferences leak between profiles. The critical items (game state, brmblegotchi, read markers, registration status) were fixed in the per-profile state scoping implementation.

## Related

- Part of the multi-profile system (feature/profile-data-model branch)
```
