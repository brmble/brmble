# Profile Deletion Persistence Fix

## Problem

When a user deletes a profile from the UI, it reappears on the next app startup or settings open. Two intentional behaviors directly conflict:

1. **Profile deletion preserves the `.pfx` file on disk.** The UI tells the user: "The certificate file will remain on disk and can be re-imported later." Only the `config.json` entry is removed.

2. **`AdoptOrphanedCerts` runs on every `profiles.list` request** (app startup, opening settings). It scans `certs/`, finds any `.pfx` whose GUID isn't in `config.json`, and re-registers it as a new profile.

Result: delete profile → config entry removed → `.pfx` stays → next `profiles.list` → `AdoptOrphanedCerts` finds the "orphaned" `.pfx` → re-creates the profile.

Secondary issue: `profileRegistrations` (per-profile server registration cache in `config.json`) is never cleaned up on delete, causing stale data to accumulate.

## Solution

Two changes, both in the C# backend:

### 1. Gate `AdoptOrphanedCerts` to first-launch only

**Current behavior:** `AdoptOrphanedCerts()` is called at `CertificateService.cs:290`, inside the `profiles.list` handler, on every request.

**New behavior:** Only call `AdoptOrphanedCerts()` when the app is running for the first time (no prior `config.json` existed). This preserves the crash-recovery benefit for genuine first launches or config loss, while preventing re-adoption of intentionally deleted profiles during normal use.

**Implementation:**

- Add a `bool IsFirstLaunch` property to `IAppConfigService` and `AppConfigService`.
- In `AppConfigService.Load()`:
  - Path A (config.json exists, line 316): `_isFirstLaunch = false`
  - Path B (legacy servers.json exists, line 336): `_isFirstLaunch = true` (new config created from legacy data)
  - Path C (neither file exists / catch block, line 348): `_isFirstLaunch = true`
- In `CertificateService.cs`, the `profiles.list` handler (line 286): wrap the `AdoptOrphanedCerts()` call in `if (_config.IsFirstLaunch)`.

After this change, `AdoptOrphanedCerts` only runs when:
- The user has never launched the app before (true first launch)
- The user manually deleted `config.json` (simulating config loss)

It does NOT run on normal startups where `config.json` was loaded successfully.

### 2. Clean up `profileRegistrations` on profile delete

**Current behavior:** `AppConfigService.RemoveProfile()` (line 273) removes the profile from `_profiles` and reassigns `_activeProfileId`, but does not touch `_profileRegistrations`. Stale per-server registration data for the deleted profile persists in `config.json` forever.

**New behavior:** Also remove the deleted profile's entry from `_profileRegistrations` before calling `Save()`.

**Implementation:**

In `AppConfigService.RemoveProfile()`, add one line before `Save()`:
```csharp
_profileRegistrations.Remove(id);
```

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs` | Add `bool IsFirstLaunch { get; }` property |
| `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` | Add `_isFirstLaunch` field, set it in `Load()`, expose as `IsFirstLaunch`. Add `_profileRegistrations.Remove(id)` to `RemoveProfile()`. |
| `src/Brmble.Client/Services/Certificate/CertificateService.cs` | Wrap `AdoptOrphanedCerts()` call in `if (_config.IsFirstLaunch)` |

## What stays the same

- `.pfx` files are preserved on disk after profile deletion (user can re-import manually via the wizard or settings)
- Profile deletion still removes the `config.json` entry and reassigns the active profile
- The onboarding wizard cert scan (`HandleCertsScan`) still works — it reports certs without auto-registering them
- `AdoptOrphanedCerts` logic itself is unchanged — only its call site is gated

## Edge cases

- **User deletes config.json manually:** `IsFirstLaunch` will be `true` on next launch, so `AdoptOrphanedCerts` runs and recovers all certs. This is correct — it's simulating a fresh install.
- **User deletes a profile then restarts:** `IsFirstLaunch` is `false` (config.json exists), so `AdoptOrphanedCerts` does not run. Profile stays deleted. Correct.
- **Truly fresh install with no certs:** `AdoptOrphanedCerts` runs (first launch) but finds nothing. No-op. Correct.
- **Legacy migration (servers.json → config.json):** `IsFirstLaunch` is `true`, so any certs in `certs/` are adopted. This is correct — the user hasn't had profiles before, so all certs should be recovered.

## Testing

- Existing test `RemoveProfile_RemovesFromConfig_ButNotCertFile` remains valid (cert file still preserved).
- Add test: `RemoveProfile_CleansUpProfileRegistrations` — verify `_profileRegistrations` no longer contains the deleted profile's ID after removal.
- Manual test: delete a profile, restart app, verify it does not reappear.
