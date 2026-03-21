# Audit Bugfixes Design

**Goal:** Fix high-severity data loss bugs, medium-severity robustness/UX issues, and one low-severity CSS inconsistency found during the multi-profile branch audit.

**Branch:** `feature/profile-data-model`

---

## H1: Migration Timing — Data Loss on First Profile

**Problem:** `migrateLocalStorage` runs in a parent `useEffect` in `App.tsx`. React fires child effects before parent effects. When `certFingerprint` changes from `''` to a real value, the game and brmblegotchi fingerprint-change effects fire first, find no scoped localStorage key, and reset to `INITIAL_STATE`. Then migration runs and copies old data to the scoped key — but it's too late. The auto-save intervals overwrite the migrated data with defaults.

**Fix:** Call `migrateLocalStorage(fingerprint)` synchronously inside the bridge event handlers (`onCertStatus`, `onCertGenerated`, `onCertImported`, `onProfilesActiveChanged`) before calling `setCertFingerprint`. Remove the `useEffect`-based migration entirely. This guarantees scoped keys exist before React re-renders children.

**Files:** `App.tsx`

---

## H2: Stale State Cross-Write During Profile Switch

**Problem:** When switching profiles, `storageKey` updates immediately but `stateRef.current` still holds the old profile's data. If the auto-save interval fires in that window, it writes Profile A's state to Profile B's storage key.

**Fix:** Change the fingerprint-reload effects in `useGameState.ts` and `Brmblegotchi.tsx` from `useEffect` to `useLayoutEffect`. This ensures state is reloaded synchronously before paint, before the auto-save `useEffect` re-establishes its interval with the new `storageKey`. The `stateRef` is updated as part of `setState`, so by the time the auto-save interval fires, it references the correct state.

**Files:** `useGameState.ts`, `Brmblegotchi.tsx`

---

## H3: `profiles.setActive` No-Op Guard

**Problem:** `AppConfigService.SetActiveProfileId` silently no-ops for non-existent profile IDs, but the `profiles.setActive` bridge handler unconditionally swaps registrations, reloads certs, and sends events.

**Fix:** After calling `_config.SetActiveProfileId(id)`, check `_config.GetActiveProfileId() == id`. If they differ (ID was invalid), return early without side effects.

**Files:** `CertificateService.cs`

---

## M1: Duplicate Name Guard in C# Backend

**Problem:** `AppConfigService.AddProfile` and `RenameProfile` accept any name. Frontend validates, but the domain layer has no defense.

**Fix:** In `AddProfile`, check `_profiles.Any(p => p.Name.Equals(name, StringComparison.OrdinalIgnoreCase))` and return `null` if duplicate. In `RenameProfile`, same check excluding the profile's own ID. Return `false` on failure. Bridge handlers already validate at the frontend layer; this is defense-in-depth.

**Files:** `AppConfigService.cs`, `IAppConfigService.cs` (return type changes)

---

## M2: `ActiveCertificate` Thread Safety

**Problem:** `profiles.add` and `profiles.import` use `Task.Run`, while `profiles.setActive` runs on the UI thread. Both read/write `ActiveCertificate` without synchronization.

**Fix:** Add a `private readonly object _certLock = new()` to `CertificateService`. Wrap all reads/writes of `ActiveCertificate` and calls to `LoadActiveCertificate` in `lock(_certLock)`.

**Files:** `CertificateService.cs`

---

## M3: Tooltips on Disabled Buttons

**Problem:** Disabled `<button>` elements don't fire hover events, so the informational tooltips ("Disconnect to delete/rename") never appear when they're most useful.

**Fix:** Wrap disabled buttons in a `<span>` and attach the `Tooltip` to the wrapper, per the UI guide's rule for disabled elements. Applies to Delete and Edit buttons in `ProfileSettingsTab.tsx`.

**Files:** `ProfileSettingsTab.tsx`

---

## M4: Export Button Exports Wrong Profile

**Problem:** `exportCert()` sends `cert.export` with no profile ID. Clicking Export on a non-active profile exports the active profile's cert.

**Fix:** Pass the profile ID from the UI: `bridge.send('cert.export', { profileId })`. On the C# side, look up the cert path for that specific profile. Fall back to active profile when no ID is provided (backward compat).

**Files:** `useProfiles.ts`, `ProfileSettingsTab.tsx`, `CertificateService.cs`

---

## M5: Missing try/catch in Bridge Handlers

**Problem:** `profiles.remove`, `profiles.rename`, and `profiles.setActive` have no try/catch. Exceptions leave the frontend with no response.

**Fix:** Wrap each handler body in try/catch, send `profiles.error` with the exception message on failure. Matches the pattern already used in `profiles.add` and `profiles.import`.

**Files:** `CertificateService.cs`

---

## L3: CertWizard Button CSS Classes

**Problem:** Import step buttons use `cert-wizard-btn ghost/primary` instead of `btn btn-ghost/btn btn-primary`.

**Fix:** Replace the incorrect classes with the standard button classes.

**Files:** `CertWizard.tsx`
