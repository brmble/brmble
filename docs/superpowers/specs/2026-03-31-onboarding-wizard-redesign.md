# Onboarding Wizard Redesign

**Date:** 2026-03-31
**Issue:** #9
**Status:** Approved for implementation

---

## Overview

Replace the existing `CertWizard` with a full first-run onboarding experience. The wizard runs on first launch (no active profile) and can be reopened from Settings to revisit preferences. It covers: platform introduction, identity/certificate setup with Mumble auto-detection, certificate backup, and initial preferences.

---

## Goals

- Explain Brmble's self-hosted, privacy-first model and certificate-based identity in plain language
- Auto-detect existing Mumble and Brmble certificates so returning users do not start over
- Always prompt users to export and safely store their certificate
- Surface the most important settings before the user connects for the first time
- Be skippable at any point after the certificate step

---

## Non-Goals

- Avatar setup (avatar is per-server, stored in Matrix — cannot be set before a server is connected)
- Server configuration (handled after wizard completes, as today)
- Matrix/chat account creation (handled automatically on first server connect)
- Audio quality settings (opus bitrate, frame size) — too advanced for onboarding

---

## Wizard Steps

Six steps total, shown as progress dots.

| # | Step | Skippable |
|---|---|---|
| 1 | Welcome | No |
| 2 | Identity | No |
| 3 | Backup | No (Skip allowed with warning text) |
| 4 | Interface | Yes |
| 5 | Audio | Yes |
| 6 | Connection | Yes |

---

## Step 1 — Welcome

**Purpose:** Introduce Brmble and explain the certificate identity model before asking the user to do anything.

**Content:**
- Brmble logo / icon
- Heading: "Welcome to Brmble"
- Paragraph 1: Brmble is a self-hosted, privacy-first platform for voice, chat, and screen sharing. There is no central account system — you connect directly to servers run by your community.
- Paragraph 2: Your identity is a **certificate file** stored on this computer. It is who you are on every server — your voice, your chat history, your permissions. There is no email, no password, and no recovery process if the file is lost.
- Single "Get Started" button

**No logic.** Pure content step.

---

## Step 2 — Identity

**Purpose:** Let the user pick an existing certificate (Brmble or Mumble) or create a new one. The profile name is the name tied to the certificate — it is also the username shown when connected to a server.

### Detection (runs before the step renders)

`mumble.detectCerts` is sent when the user clicks "Get Started" on step 1. The response arrives before step 2 renders (step 2 renders only after `mumble.detectedCerts` is received, or after a 2-second timeout — whichever comes first). Two sources are checked in parallel:

**Existing Brmble profiles:** Already available via `profiles.list`. No extra scan needed.

**Mumble certificate detection** — new `mumble.detectCerts` bridge call, scanned in priority order, stopping at the first hit:

| Priority | Path | Mumble version |
|---|---|---|
| 1 | `%LOCALAPPDATA%\Mumble\Mumble\mumble_settings.json` → `"certificate"` key (base64 PKCS#12) | 1.5.x |
| 2 | `%APPDATA%\Mumble\mumble_settings.json` → `"certificate"` key (base64 PKCS#12) | 1.5.x pre-migration |
| 3 | Registry `HKCU\Software\Mumble\Mumble` → `net/certificate` (raw binary PKCS#12) | 1.4.x |

The CN (Common Name) is extracted from the certificate Subject to use as the display name.

**Response event:** `mumble.detectedCerts`
```
{
  certs: Array<{
    source: 'mumble',
    name: string,        // CN from certificate Subject
    fingerprint: string, // SHA-256 hex, colon-separated
    data: string         // base64 PKCS#12
  }>
}
```

The array contains 0 or 1 entries (Mumble stores a single active certificate).

### Identity Picker UI

The step renders a list of identity cards, grouped:

**Group 1 — Existing Brmble profiles** (from `profiles.list`, if any)
Each card shows: profile name, fingerprint snippet (first 8 chars), "Brmble" source badge.

**Group 2 — Mumble certificate** (if detected)
Card shows: CN name, fingerprint snippet, "Mumble" source badge, subtitle: "Your existing Mumble identity — import it to keep the same username and permissions on servers."

**Group 3 — Create new identity**
A card at the bottom: "Create a new identity". Selecting it expands an inline name-entry input. The name must:
- Pass the existing profile name regex (`^[-=\w\[\]\{\}\(\)\@\.]+$`, max 128 chars, no spaces)
- Not duplicate any name already shown in the list (Brmble profile names + Mumble CN)

### Actions on Selection

| Selection | Action |
|---|---|
| Existing Brmble profile | `profiles.setActive({ id })` — advances to step 3 |
| Mumble certificate | `profiles.import({ name: cn, data: base64 })` — on `profiles.added`, advances to step 3 |
| Create new identity | Inline acknowledgment checkbox (see below), then `profiles.add({ name })` — on `profiles.added`, advances to step 3 |

### Inline Warning (Generate New only)

Before `profiles.add` is called, a warning panel expands inside the step (not a separate step):

> "Generating a new certificate creates a brand-new identity. If you previously used Mumble, import your existing certificate instead so you keep your username and history."

Checkbox: "I understand — I want to create a new identity."

The "Continue" button is disabled until the checkbox is checked.

---

## Step 3 — Backup

**Purpose:** Always prompt the user to export their certificate and store it somewhere safe, regardless of whether it was generated, imported from Mumble, or imported from a file.

**Content:**
- Heading: "Save a copy of your certificate"
- Body: Your certificate is the only copy of your identity. If you lose this computer or reinstall Windows without a backup, there is no way to recover it — you would start over as a new user on every server.
- Suggested storage locations (illustrative, not exhaustive): OneDrive, Google Drive, Dropbox, iCloud Drive, a USB drive, a password manager that supports file attachments
- Certificate fingerprint display (full SHA-256, so the user can verify the file later)
- **"Export & Continue"** button — calls `cert.export`, downloads `.pfx`, then advances to step 4
- **"Skip (Not Recommended)"** link — advances to step 4 without exporting. No additional confirmation dialog; the explanation on the page is sufficient.

---

## Step 4 — Interface

**Purpose:** Let the user configure visual preferences before first use.

**Settings:**

| Setting | Control | Default |
|---|---|---|
| Theme | Theme picker (same as current appearance tab) | `'classic'` |
| Brmblegotchi | Toggle | On |

Brmblegotchi label: "Show Brmblegotchi — a small virtual companion in your sidebar."

Settings are saved live via `settings.set` as the user changes them.

**Navigation:** Back / Skip / Next

---

## Step 5 — Audio

**Purpose:** Configure microphone, speaker, and voice transmission before the user connects to a server.

**Settings:**

| Setting | Control | Default |
|---|---|---|
| Input device | Dropdown (system audio devices) | `'default'` |
| Output device | Dropdown (system audio devices) | `'default'` |
| Transmission mode | Radio cards with description | `'pushToTalk'` |
| PTT key binding | Key-capture widget (shown only when PTT selected) | `null` |
| Noise suppression | Two-option selector: Disabled / RNNoise | `'rnnoise'` |

**Transmission mode descriptions:**
- **Push to Talk** — Hold a key to transmit. Recommended for most users.
- **Voice Activity** — Transmit automatically when your mic detects speech.
- **Continuous** — Always transmit. Not recommended unless you have a dedicated mic setup.

PTT key binding uses the same key-capture widget as the current Shortcuts settings tab. It is only visible when Push to Talk is selected.

Settings are saved live via `settings.set`.

**Navigation:** Back / Skip / Next

---

## Step 6 — Connection

**Purpose:** Configure reconnection and auto-connect behaviour.

**Settings:**

| Setting | Control | Default |
|---|---|---|
| Reconnect automatically on disconnect | Toggle | On |
| Rejoin last voice channel on connect | Toggle | On |
| Auto-connect on startup | Toggle | Off |

Auto-connect on startup note: "Once you have added a server, Brmble can connect to it automatically when you launch the app. You can configure which server in Settings → Connection."

Settings are saved live via `settings.set`.

**Navigation:** Back / Skip / **Finish**

"Finish" completes the wizard and calls the existing `onComplete` callback (same as today).

---

## Architecture & Bridge Changes

### New Bridge Call: `mumble.detectCerts`

**Direction:** JS → C#
**Handler:** New method in `CertificateService.cs` (or a new `MumbleImportService.cs` if size warrants it)

**Scan logic:**
1. Check `%LOCALAPPDATA%\Mumble\Mumble\mumble_settings.json` — parse JSON, read `"certificate"` field (already base64)
2. If not found, check `%APPDATA%\Mumble\mumble_settings.json` — same
3. If not found, check `HKCU\Software\Mumble\Mumble` registry value `net/certificate` (raw `byte[]`) — base64-encode before returning
4. For any found cert: load as `X509Certificate2` with empty password to extract CN and compute fingerprint
5. Send `mumble.detectedCerts` event with result array (0 or 1 entries)

**Error handling:** Any exception during scan (missing file, malformed JSON, registry access denied) is caught per-path and treated as "not found" for that path. A total scan failure sends `{ certs: [] }` — the wizard continues without the Mumble option.

### Frontend Changes

- `CertWizard.tsx` is replaced by `OnboardingWizard.tsx` (new file, or rename + rewrite in place)
- Wizard step type expands: `'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection'`
- Settings controls in steps 4–6 reuse or extract components from `SettingsModal/` tabs:
  - Theme picker → extracted from `AppearanceSettingsTab.tsx`
  - Device dropdowns → extracted from `AudioSettingsTab.tsx`
  - PTT key capture → extracted from `ShortcutsSettingsTab.tsx`
  - Noise suppression selector → extracted from `AudioSettingsTab.tsx`
- The wizard is triggered from `App.tsx` on the same condition as today: no active profile on startup
- A "Reopen onboarding" / "Setup wizard" option is added to Settings (accessible from the sidebar or a settings section) — reopening always starts at step 4 (Interface), skipping the cert and backup steps if a profile already exists

### No Changes Required

- `CertificateService.cs` cert generation, import, and export handlers — unchanged
- `profiles.add`, `profiles.import`, `profiles.setActive` — unchanged
- `NativeBridge.cs` transport — unchanged
- `App.tsx` `onComplete` callback and `certExists` condition — unchanged

---

## Certificate Format Compatibility

Mumble certificates are passwordless PKCS#12. The existing `profiles.import` handler calls `X509CertificateLoader.LoadPkcs12(bytes, password: null, ...)` — this works without modification.

---

## Error States

| Scenario | Behaviour |
|---|---|
| Mumble cert scan finds malformed JSON | Path skipped silently, treated as not found |
| Mumble cert scan: registry access denied | Path skipped silently |
| `profiles.import` fails (corrupt cert) | Error message shown inline in step 2, user can retry or choose a different option |
| `profiles.add` fails | Error message shown inline in step 2 |
| `cert.export` fails | Error message shown in step 3, Export button re-enabled for retry |
| Audio device list empty | Dropdowns show "Default" only; no error |

---

## Reopenable Wizard

When reopened from Settings after initial setup:
- Start at step 4 (Interface) — the cert and backup steps are not shown again
- All six progress dots still shown for visual continuity; dots 1–3 are pre-filled/active
- "Finish" in step 6 closes the wizard overlay and returns to the main app

---

## Out of Scope (Future Work)

- Multiple Mumble installations (the scan stops at the first found cert — edge case, low priority)
- macOS / Linux cert detection paths (Windows only for now, matching the existing client target)
- Animated transitions between steps
- Onboarding analytics / completion tracking
