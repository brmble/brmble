# Cert-Scan Identity Step

**Date:** 2026-04-03
**Branch:** `feature/onboarding-wizard-redesign`
**Status:** Design

## Problem

The onboarding wizard identity step (step 2) currently uses two separate data sources:

1. `profiles.list` — reads profile metadata from `config.json`, then checks if each profile has a valid `.pfx` on disk
2. `mumble.detectCerts` — scans Mumble cert locations and returns detected certificates

This creates a muddled UX where orphaned config entries (profiles without certs) must be filtered out, and the two data flows have different shapes, different fingerprint algorithms (SHA-1 vs SHA-256), and arrive at different times.

## Solution

Replace both calls with a single `certs.scan` handler that discovers all certificate files on disk, extracts their data, deduplicates by fingerprint, and returns a unified list categorized by source.

The identity step becomes purely file-driven: show what's on disk, nothing else.

## Backend: `certs.scan` Handler

### Location scan order (priority high → low)

| Priority | Source | Location | Format |
|----------|--------|----------|--------|
| 1 | `"brmble"` | `%APPDATA%\Brmble\certs\*.pfx` | PKCS#12 files on disk |
| 2 | `"mumble-1.5"` | `%LOCALAPPDATA%\Mumble\Mumble\mumble_settings.json` → `certificate` | Base64-encoded PKCS#12 in JSON |
| 3 | `"mumble-1.5"` | `%APPDATA%\Mumble\mumble_settings.json` → `certificate` | Base64-encoded PKCS#12 in JSON |
| 4 | `"mumble-1.4"` | `HKCU\Software\Mumble\Mumble` → `net/certificate` | Raw bytes in registry |
| 5 | `"mumble-1.3"` | `HKCU\Software\Mumble\Mumble\net` → `certificate` | Raw bytes in registry |

### Processing per cert

1. Load as `X509Certificate2` via `X509CertificateLoader` (PKCS#12, no password, `EphemeralKeySet`)
2. Extract display name with fallback chain:
   - **Brmble certs:** CN from subject → filename-derived name → `"Brmble Certificate"`
   - **Mumble certs:** CN from subject → `playerName` from same Mumble settings source → `"Mumble Certificate"`
3. Compute SHA-256 fingerprint, colon-separated uppercase hex (`AB:CD:EF:...`)
4. Encode raw cert bytes as base64

### Deduplication

Keyed on SHA-256 fingerprint. If a cert with the same fingerprint was already found at a higher-priority location, skip the lower-priority duplicate.

For Brmble certs specifically: multiple `.pfx` files with different fingerprints each become separate entries. This is correct — they're distinct certificates.

### Response message: `certs.scanned`

```typescript
{
  certs: Array<{
    source: "brmble" | "mumble-1.5" | "mumble-1.4" | "mumble-1.3",
    name: string,          // display name (CN, playerName fallback, or derived)
    fingerprint: string,   // SHA-256, colon-separated uppercase hex
    data: string,          // base64-encoded PKCS#12 (includes private key)
    profileId?: string,    // GUID from filename — only present for source "brmble"
  }>
}
```

### Brmble `.pfx` filename parsing

The existing filename convention is `{SanitizedName}_{GUID}.pfx` (new format) or `{GUID}.pfx` (legacy).

- Split on last `_` to extract `namePart` and `idPart`
- Validate `idPart` is a parseable GUID
- If the filename is just a GUID (legacy format), `profileId` is the full filename without extension
- `profileId` is included in the response so the frontend can call `profiles.setActive` for existing Brmble certs

### Error handling

- Each location is scanned independently inside a try/catch — a failure at one location does not block others
- Invalid/corrupted `.pfx` files are silently skipped
- If the `certs/` directory doesn't exist, the Brmble scan produces zero results (no error)
- Registry access denied → skip that location

## Frontend: Identity Step Changes

### Bridge flow

**Old flow (two calls):**
1. On mount → `profiles.list` → populates `brmbleProfiles`
2. On "Get Started" click → `mumble.detectCerts` → populates `mumbleCerts`

**New flow (single call):**
1. On "Get Started" click → `certs.scan` → receives `certs.scanned` → populates a single `discoveredCerts` array

### State changes

Remove:
- `brmbleProfiles: BrmbleProfile[]`
- `mumbleCerts: DetectedCert[]`

Add:
- `discoveredCerts: ScannedCert[]`

```typescript
interface ScannedCert {
  source: 'brmble' | 'mumble-1.5' | 'mumble-1.4' | 'mumble-1.3';
  name: string;
  fingerprint: string;
  data: string;
  profileId?: string;
}
```

### Card rendering

Group into two visual sections:

1. **"Your Brmble certificates"** — certs where `source === "brmble"`, using `<BrmbleCardIcon />`
2. **"Mumble certificates found"** — certs where `source.startsWith("mumble-")`, using `<MumbleCardIcon />`. Each card shows a subtle version label derived from source (e.g. "Mumble 1.5").
3. **"Create a new profile"** — always shown at the bottom, same as today.

Section headers are only rendered if that group has at least one cert.

### Selection actions (on Continue)

| Selection | Action |
|-----------|--------|
| Brmble cert (has `profileId`) | Send `profiles.setActive` with `{ id: profileId }` |
| Mumble cert | Send `profiles.import` with `{ name, data }` |
| Create new | Send `profiles.add` with `{ name }` |

These handlers are unchanged from today.

### Subtitle text

- If any certs were found: "We found existing certificates on this computer. Select one to use as your profile, or create a new one."
- If no certs found: "Your profile name is what other users see when you connect to a server. Create one to get started."

Same logic as today, but driven by `discoveredCerts.length > 0` instead of separate checks.

## What stays unchanged

- `profiles.list` handler — still used by the Settings profile manager
- `mumble.detectCerts` handler — stays available for other consumers
- `AdoptOrphanedCerts()` — still runs on `profiles.list` calls (not on `certs.scan`)
- `profiles.setActive`, `profiles.import`, `profiles.add` — all unchanged
- Welcome step (step 1) — unchanged
- All other wizard steps — unchanged
