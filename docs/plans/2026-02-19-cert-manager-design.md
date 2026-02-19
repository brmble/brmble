# Certificate Manager — Design

**Date:** 2026-02-19
**Issue:** #8
**Scope:** Brmble.Client (C#) + Brmble.Web (React)

---

## Overview

Implements X.509 client certificate lifecycle for the Brmble desktop client. The certificate is the user's identity across Mumble voice, Matrix chat, and LiveKit screen sharing. This feature covers first-launch generation, import of existing certificates, export/backup, and loading the active certificate into MumbleSharp on startup.

The ASP.NET backend server is out of scope for this feature.

---

## C# Backend (`Brmble.Client`)

### CertificateService

A new `CertificateService` implementing `IService`, registered in `Program.cs` alongside `VoiceService`.

**Responsibilities:**
- On startup: check for `%AppData%\Brmble\identity.pfx` and emit `cert.status` to the frontend
- Generate a self-signed X.509 certificate on demand using `CertificateRequest` (.NET built-in)
  - Algorithm: ECDSA P-256
  - Lifetime: 100 years (consistent with Mumble conventions)
  - Store result as `%AppData%\Brmble\identity.pfx`
- Import: open a Win32 `GetOpenFileName` dialog filtered to `.pfx`/`.p12`, validate, copy to `identity.pfx`
- Export: open a Win32 `GetSaveFileName` dialog, copy `identity.pfx` to chosen path
- Expose the loaded `X509Certificate2` via a static/shared property for `MumbleAdapter` to use when opening its TLS connection

### Bridge Messages

**C# → React (events):**

| Message | Payload | When |
|---|---|---|
| `cert.status` | `{ exists: bool, fingerprint?: string, subject?: string }` | On startup |
| `cert.generated` | `{ fingerprint: string, subject: string }` | After successful generation |
| `cert.imported` | `{ fingerprint: string, subject: string }` | After successful import |
| `cert.exported` | `{ path: string }` | After successful export |
| `cert.error` | `{ message: string }` | On any failure |

**React → C# (commands):**

| Message | Payload | Action |
|---|---|---|
| `cert.generate` | `{ subject: string }` | Generate new cert with given subject (username) |
| `cert.import` | _(none)_ | Open Win32 file dialog, import selected .pfx |
| `cert.export` | _(none)_ | Open Win32 save dialog, export identity.pfx |

### MumbleAdapter Integration

`MumbleAdapter` reads the active certificate from `CertificateService` before opening the Mumble TLS connection. If no certificate is present, the connection is refused with a clear error.

---

## React Frontend (`Brmble.Web`)

### First-Launch Wizard (`CertWizard`)

Shown when `cert.status` arrives with `exists: false`. Replaces the server list overlay until a certificate is confirmed. Uses a step-based state machine:

**Step 1 — Welcome**
Explains that the certificate is the user's identity across voice, chat, and screen sharing. No actions, just a Next button.

**Step 2 — Choose**
Two prominent cards:
- "Generate a new certificate" (recommended path)
- "Import an existing certificate (.pfx / .p12)"

**Step 3 — Warning**
Full-screen red-tinted panel with prominent language:
> "If you reinstall your computer without a backup of this certificate, you will permanently lose access to your chat history, your registered username, and everything tied to your identity. There is no recovery. Back it up."

Requires explicit acknowledgement (checkbox: "I understand") before proceeding.

**Step 4 — Action**
- Generate path: loading spinner while C# generates the cert, then success state
- Import path: button triggers `cert.import` bridge call, C# opens the OS file dialog

**Step 5 — Backup Prompt**
> "Your certificate has been created. Export it now and store it somewhere safe."
- `[Export Now]` → sends `cert.export`, then transitions to server list
- `[Skip for now]` → transitions to server list immediately

### Identity Tab in Settings

New tab added to `SettingsModal`: **Audio | Shortcuts | Messages | Overlay | Identity**

Contents:
- **Certificate fingerprint** — read-only, monospace display
- **Current server username** — read-only; populated from the connected username state; shows "Not connected" when offline. Note: display name is server-specific and cannot be changed once registered on a Mumble server.
- **`[Export Certificate]`** — sends `cert.export`
- **`[Import Different Certificate]`** — sends `cert.import`, followed by an info notice: "Takes effect on next launch."

### App.tsx Integration

- On mount, listen for `cert.status`
- If `exists: false`: render `CertWizard` in place of the server list overlay
- If `exists: true`: proceed normally to server list
- On `cert.generated` or `cert.imported`: mark cert as confirmed, transition to server list

---

## File Structure

```
src/Brmble.Client/
└── Services/
    └── Certificate/
        └── CertificateService.cs

src/Brmble.Web/src/
└── components/
    ├── CertWizard/
    │   ├── CertWizard.tsx
    │   └── CertWizard.css
    └── SettingsModal/
        ├── IdentitySettingsTab.tsx
        └── IdentitySettingsTab.css
```

---

## Out of Scope

- ASP.NET backend server integration (future: Matrix/LiveKit token issuance)
- Certificate renewal or revocation
- Multiple certificate profiles
- Server-side admin registration UI
