# Multi-Profile System Design

**Issues:** #277 (certificate reset & multi-cert), #358 (registration status UI)
**Date:** 2026-03-20

## Overview

Introduce a **Profile** concept that pairs a certificate (.pfx) with a user-chosen profile name. Users can create multiple profiles, switch between them, and each profile's name serves as the default username when connecting to servers.

## Data Model

### config.json additions

```json
{
  "profiles": [
    { "id": "abc-123", "name": "Roan" }
  ],
  "activeProfileId": "abc-123",
  "servers": [...],
  "settings": {...}
}
```

- `profiles` — ordered list of profile entries
- `activeProfileId` — UUID of the currently active profile (null if no profiles)
- Each profile's cert file lives at `%APPDATA%/Brmble/certs/{id}.pfx`
- No separate `certFile` field — the ID is the filename

### Certificate storage

- Directory: `%APPDATA%/Brmble/certs/`
- Files: `{profile-id}.pfx` per profile
- Files are **never deleted** by the app — even when a profile is removed
- Orphaned cert files stay on disk; no automatic cleanup

## Migration

On startup, if `identity.pfx` exists at the old location and `profiles` is empty/missing:

1. Create `%APPDATA%/Brmble/certs/` directory
2. Move `identity.pfx` → `certs/{new-uuid}.pfx`
3. Add profile `{ id: uuid, name: "Default" }` to config
4. Set `activeProfileId` to that UUID
5. Delete old `identity.pfx`

Seamless — existing users see no difference.

## Bridge Protocol

### New messages (ProfileService or extended AppConfigService)

| Message | Direction | Payload |
|---------|-----------|---------|
| `profiles.list` | JS → C# → JS | `{ profiles: [...], activeProfileId }` |
| `profiles.add` | JS → C# | `{ name }` — generates cert, creates profile |
| `profiles.import` | JS → C# | `{ name, data }` (base64 pfx) — creates profile with imported cert |
| `profiles.remove` | JS → C# | `{ id }` — removes from config, cert file stays |
| `profiles.rename` | JS → C# | `{ id, name }` |
| `profiles.setActive` | JS → C# | `{ id }` — switches active profile, reloads cert |
| `profiles.added` | C# → JS | New profile entry with fingerprint |
| `profiles.removed` | C# → JS | `{ id }` |
| `profiles.renamed` | C# → JS | Updated profile entry |
| `profiles.activeChanged` | C# → JS | `{ id, name, fingerprint }` |
| `profiles.error` | C# → JS | `{ message }` |

### Existing messages (unchanged)

- `cert.requestStatus` / `cert.status` — still work, reflect the active profile's cert
- `cert.export` — exports the active profile's cert
- `cert.generate`, `cert.import` — used internally by `profiles.add` / `profiles.import`

## Constraints

- `profiles.setActive` fails with `profiles.error` if currently connected to a server
- All profiles can be deleted — deleting the last profile sets `activeProfileId: null` and `certExists: false`, which triggers the CertWizard overlay
- Deleting the active profile when others exist: auto-switch to another profile first, then delete
- Profile name uniqueness is NOT enforced
- If a cert file is missing/corrupt: show error state on that profile row, allow delete but not set-active

## Frontend UI

### Settings > Profiles tab

Mirrors the ServerList layout and follows `docs/UI_GUIDE.md`:

**List layout:**
- `div.profiles-section` with `h3.heading-section.profiles-section-title` — "Profiles"
- `div.profiles-items` — flex column, `gap: var(--space-sm)`

**Profile row** (same pattern as `.server-list-item`):
- `div.profiles-item` — flex row, `--bg-surface`, `--radius-lg`, `padding: var(--space-md)`
- **Icon:** 44px gradient square, first letter of profile name (same pattern as server icon)
- **Info:** Profile name + truncated fingerprint (mono font)
- **Active badge:** "Active" indicator on the current profile
- **Actions:** Set Active (secondary, hidden on active, disabled when connected), Edit (secondary), Export cert (ghost), Delete (ghost danger)

**Inline form** (same pattern as server add/edit form):
- `form.profiles-form` with `formSlideIn` animation
- Fields: Profile Name (`brmble-input`)
- For new profiles: Generate / Import choice
- If importing: file picker for `.pfx/.p12`
- Cancel / Save buttons, `flex: 1` each

**Add button:** Full-width dashed border ghost button: `+ Add Profile`

**Delete prompt:** Uses `confirm()` from `usePrompt` hook (themed modal dialog, never `window.confirm`)

### CertWizard extension

- Add a "Profile Name" text input to the `choose` step (or new step between `welcome` and `choose`)
- This name becomes the first profile's name and default server username
- Rest of wizard flow unchanged

### App.tsx state changes

- `certExists` / `certFingerprint` — unchanged, reflect active profile's cert
- New: `activeProfileName: string` — updated on `profiles.activeChanged`
- When `activeProfileId` is null (no profiles): `certExists = false` → CertWizard overlay

### Server connection

- When connecting, if server entry's `username` is empty → use `activeProfileName` as default
- Existing per-server usernames take priority (not overwritten)

## Out of scope (future work)

- Per-server username changes (issue #358 registration status UI will be addressed separately)
- Orphaned cert file cleanup UI
- Per-profile server lists (server list is shared)
- Password protection on .pfx files
