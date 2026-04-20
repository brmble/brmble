# Wizard Steps 2-4: Profile Flow Redesign

**Date:** 2026-04-03
**Status:** Design
**Branch:** `feature/onboarding-wizard-redesign`

## Problem

The onboarding wizard currently handles certificate selection AND profile name entry inline in step 2 (Identity). This creates a cluttered step and doesn't properly handle the different scenarios that arise from certificate CN names. The backup step (currently step 3) also lacks helpful guidance on where to store backups.

## Goals

1. Separate identity selection (step 2) from profile configuration (step 3)
2. React to certificate CN names: use real CNs as profile names, prompt for a name when the CN is generic or missing
3. Match the existing ProfileSettingsTab flow for "create new" (including orphaned cert checks)
4. Improve the backup step with friendlier copy and practical storage suggestions
5. Skip step 2 entirely when no certificates are found

## New Step Order

| # | Key | Name | Change |
|---|-----|------|--------|
| 1 | `welcome` | Welcome | Unchanged |
| 2 | `identity` | Identity | Simplified — selection only, no inline forms |
| 3 | `profile` | Profile | **New step** — name confirmation/entry + cert actions |
| 4 | `backup` | Backup | Improved copy, moved from position 3 to 4 |
| 5 | `interface` | Interface | Unchanged |
| 6 | `audio` | Audio | Unchanged |
| 7 | `connection` | Connection | Unchanged |
| 8 | `servers` | Servers | Unchanged |

## User Journeys

### Journey 1: Existing cert with real CN

Welcome -> Identity (picks cert with CN="Roan") -> Profile (shows "Roan" disabled, confirm) -> Backup -> ...

### Journey 2: Existing cert with generic/missing CN

Welcome -> Identity (picks cert with CN="Mumble User" or empty) -> Profile (name field enabled, must enter a name) -> Backup -> ...

### Journey 3a: Certs found, user picks "Create new"

Welcome -> Identity (picks "Create new") -> Profile (name input + Generate/Import buttons) -> Backup -> ...

### Journey 3b: No certs found

Welcome -> ~~Identity (skipped)~~ -> Profile (name input + Generate/Import buttons) -> Backup -> ...

Journey 3b skips step 2 entirely because there is nothing to choose from.

## Step 2: Identity (simplified)

### What stays

- Certificate scan via `certs.scan` triggered from step 1's "Get Started" button
- Three card groups: Brmble certs, Mumble certs, "Create a new profile"
- Card layout with icons, name, fingerprint
- `selectedIdentity` state (discriminated union: `brmble | mumble | new | null`)

### What changes

- **Removed:** Inline profile name input, "I understand" checkbox, and warning panel (currently shown when "Create new" is selected)
- **Removed:** All bridge calls from step 2's Continue handler (`profiles.setActive`, `profiles.import`, `profiles.add`)
- **Continue button** now simply advances to step 3 (`setStep('profile')`)
- Step 2 is a pure UI selection step — no side effects

### Skip logic

After cert scan completes in step 1, if `discoveredCerts` is empty, skip step 2 and go directly to step 3 in "create new" mode. The `STEPS` array stays fixed at 8 entries; the skip is handled in transition logic only.

## Step 3: Profile (new)

Step 3 renders in one of three modes based on a `profileMode` derived value.

### Profile Mode Derivation

```
profileMode = derive from selectedIdentity:
  null (no certs, skipped step 2)       -> 'create-new'
  { kind: 'new' }                       -> 'create-new'
  { kind: 'brmble'|'mumble', cert }
    where isGenericCN(cert.name)        -> 'generic-cn'
  { kind: 'brmble'|'mumble', cert }
    where !isGenericCN(cert.name)       -> 'real-cn'
```

### Mode A: `real-cn` (existing cert with real CN)

- **Heading:** "Your Profile"
- **Subtext:** "This is the name from your certificate — it's likely the name you're registered with on servers."
- **Profile name field:** Pre-filled with the CN, **disabled**
- **Fingerprint:** Shown below, read-only
- **Continue button:** Triggers the appropriate bridge call:
  - Brmble cert: `profiles.setActive({ id: cert.profileId })`
  - Mumble cert: `profiles.import({ name: cert.name, data: cert.data })`
- Advances to step 4 (Backup) on success

### Mode B: `generic-cn` (existing cert with generic/missing CN)

- **Heading:** "Your Profile"
- **Subtext:** "Your certificate doesn't have a personal name. Choose a name for your profile — this is how others will see you."
- **Profile name field:** **Enabled**, empty (generic value shown as placeholder, not value)
- **Validation:** `validateProfileName()` + duplicate check against `takenNames`
- **Fingerprint:** Shown below, read-only
- **Continue button** (gated by valid name): Triggers bridge call:
  - Brmble cert: `profiles.setActive({ id: cert.profileId })`, wait for `profiles.activeChanged`, then `profiles.rename({ ... })` with entered name
  - Mumble cert: `profiles.import({ name: enteredName, data: cert.data })` (uses entered name, not generic CN)
- Advances to step 4 (Backup) on success

### Mode C: `create-new` (create new profile or no certs found)

- **Heading:** "Create Your Profile"
- **Subtext:** "Choose a name and set up your certificate. Your name will be embedded in the certificate."
- **Profile name field:** **Enabled**, empty, required
- **Validation:** `validateProfileName()` + duplicate check against `takenNames`
- **Two action buttons** below the name field:
  - **"Generate New Certificate"** — generates cert with profile name as CN
  - **"Import Certificate"** — opens file picker for `.pfx` file
- Both buttons gated by valid profile name

**Orphaned cert check flow (same as ProfileSettingsTab):**

Both buttons follow this flow before executing:

1. Validate profile name
2. Check duplicates against `takenNames`
3. Call `checkExistingCert(name)` via `useProfiles` hook
4. If orphaned cert found on disk -> show confirm dialog:
   - For Generate: "A certificate file for [name] already exists in Brmble. Would you like to use it instead of generating a new one?" (Use existing / Generate new)
   - For Import: "A certificate file for [name] already exists in Brmble. Would you like to use it instead of importing a different one?" (Use existing / Import different)
5. If user picks "Use existing" -> call `addFromExisting(name)`
6. Otherwise -> proceed with `profiles.add({ name })` or file picker + `profiles.import({ name, data })`

This is the same logic as `handleAddGenerate` and `handleAddImport` in `ProfileSettingsTab.tsx` (lines 96-155).

After success, advances to step 4 (Backup).

## Step 4: Backup (improved)

### What stays

- Export button (triggers `profiles.exportCert`)
- Fingerprint display
- Skip option

### What changes

- **Heading:** "Back Up Your Certificate"
- **Subtext:** "Your certificate is your identity on Brmble. If you lose it, you'll lose access to any servers where you're registered. Export a backup and store it somewhere safe — for example in Google Drive, OneDrive, iCloud, Dropbox, or on a USB drive."
- **Skip wording:** "I'll do this later" instead of "Skip (not recommended)"

## Generic CN Detection

New helper function in `src/Brmble.Web/src/utils/profileValidation.ts`:

```typescript
const GENERIC_CN_NAMES = ['mumble user'];

export function isGenericCN(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return GENERIC_CN_NAMES.includes(name.trim().toLowerCase());
}
```

The `GENERIC_CN_NAMES` list is easy to extend as we discover more Mumble client defaults.

## State Management Changes

### Existing state (no changes needed)

- `selectedIdentity` — already captures the cert selection from step 2
- `newName` — reused for profile name input in step 3
- `busy`, `identityError` — reused for bridge call feedback in step 3
- `fingerprint` — set after profile creation/activation

### New derived value

```typescript
type ProfileMode = 'real-cn' | 'generic-cn' | 'create-new';

const profileMode: ProfileMode = useMemo(() => {
  if (!selectedIdentity || selectedIdentity.kind === 'new') return 'create-new';
  const cert = selectedIdentity.cert;
  return isGenericCN(cert.name) ? 'generic-cn' : 'real-cn';
}, [selectedIdentity]);
```

### Bridge call relocation

All bridge calls currently in step 2's `handleIdentityContinue` (lines 310-330 of OnboardingWizard.tsx) move to step 3's action handlers. Step 3 also gains `checkExistingCert` and `addFromExisting` calls (for Mode C), which requires importing these from `useProfiles` or calling the bridge directly.

### Step skip logic

In the cert scan completion handler: if `discoveredCerts` is empty, set step to `'profile'` instead of `'identity'`. The progress bar should reflect being on step 3.

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` | Add `'profile'` step, add step 3 rendering with three modes, simplify step 2, update step 4 copy, relocate bridge calls, add skip logic |
| `src/Brmble.Web/src/utils/profileValidation.ts` | Add `isGenericCN()` helper |
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css` | Styles for new step 3 modes (profile name field states, action buttons) |

## Out of Scope

- Refactoring OnboardingWizard.tsx into smaller sub-components (the file is 926 lines; improvements are welcome but not the goal of this change)
- Changes to steps 5-8 (Interface, Audio, Connection, Servers)
- Research into additional Mumble client default CN names (handled by extensible list)
- Changes to ProfileSettingsTab.tsx (we reuse its patterns, not modify it)
