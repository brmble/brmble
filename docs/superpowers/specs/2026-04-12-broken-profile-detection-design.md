# Broken Profile Detection & Cert Recovery

**Issue:** #433
**Date:** 2026-04-12
**Status:** Approved

## Problem

When a Brmble profile exists in `config.json` but its backing `.pfx` certificate file is missing from disk (manually deleted or lost), the profile becomes orphaned. It shows `certValid: false` and no fingerprint. The onboarding wizard already filters these out, but the Settings profile manager shows them with no indication anything is wrong, and the user can attempt to connect — hitting confusing errors only after the TLS handshake or Matrix credential fetch fails.

**Primary scenario:** User or disk cleanup tool accidentally deletes the `.pfx` file.

## Design

### 1. Detection & Notification Flow

**When:** At app startup, `profiles.list` already computes `certValid` per profile. The backend collects **all** profiles with `certValid === false` into a `brokenProfiles` array and sends it in the response.

**Auto-switch:** If the active profile is broken and other healthy profiles exist, the backend auto-switches to the first healthy profile (in config list order) and reports this via `autoSwitchedTo` in the `profiles.list` response.

**Notification:** The frontend renders **one `BrokenCertNotification` per broken profile**, each fixed top-right in the `.notification-stack` container with a warning status (warning icon and warning color scheme).

Each notification shows:
- Message: `Profile "X" has no certificate file.` (plus `Switched to "Y".` on the first notification if auto-switch occurred)
- Buttons: Dismiss / Settings / Import
- Dismiss hides that single notification for this session; reappears on next launch if still broken
- Import triggers a file picker scoped to that specific profile
- Recovering or dismissing one notification does not affect others

### 2. Backend Changes

#### New `profiles.recover` handler (CertificateService.cs)

- Accepts `{ id: string, data: string }` — profile ID + base64-encoded `.pfx` file data
- Validates the `.pfx` is loadable via `X509CertificateLoader.LoadPkcs12FromFile` (same approach used elsewhere; no CN or fingerprint matching — just loadability)
- Writes the `.pfx` to the expected cert path via `GetCertPath(id, name)`
- Reloads the active certificate if this is the active profile
- Sends `profiles.recovered` with updated profile info: `{ id, name, fingerprint, certValid: true }`
- On failure, sends `profiles.error`

#### Auto-switch logic (in `profiles.list` handler)

After computing all profiles:
1. Collect all profiles with `certValid === false` into a `brokenProfiles` array
2. If the active profile has `certValid === false`, find the first profile with `certValid === true`
3. If found: call `SetActiveProfileId` + `LoadActiveCertificate`
4. Include in response: `brokenProfiles: Array<{ id, name }>` and `autoSwitchedTo: { id, name } | null`

If no healthy profile exists, `autoSwitchedTo` is null and the active profile remains the broken one.

### 3. Notification System Standardization

Currently `Toast` and `UpdateNotification` are two separate components with nearly identical CSS (same tokens, same z-index, same animation pattern) but no shared base. Adding `BrokenCertNotification` as a third copy would worsen this. This branch standardizes the pattern based on best practices from Carbon Design System, Atlassian, Ant Design, Chakra UI, and WCAG guidelines.

#### Shared base: `Notification` component

- Location: `src/Brmble.Web/src/components/Notification/`
- A status-driven base component: the `status` prop determines icon, color tokens, ARIA role, and default dismiss behavior.

**Status → behavior mapping:**

| Status | Icon | Color tokens | ARIA role | Default auto-dismiss |
|---|---|---|---|---|
| `info` | `info` | `--accent-info-*` | `role="status"` | 5s |
| `success` | `check-circle` | `--accent-success-*` | `role="status"` | 5s |
| `warning` | `alert-triangle` | `--accent-warning-*` | `role="status"` | No (persist) |
| `error` | `alert-circle` | `--accent-danger-*` | `role="alert"` | No (persist) |

**Props:**

- `status: 'info' | 'success' | 'warning' | 'error'` — drives icon, color, ARIA role, and default dismiss behavior
- `position: 'top-right' | 'bottom-center'` — viewport placement and slide direction
- `children: ReactNode` — message + action content
- `visible: boolean` — controls enter/exit animation
- `duration?: number | null` — override auto-dismiss duration. `null` = never dismiss. Defaults: info/success = 5000ms, warning/error = null.
- `onDismiss?: () => void` — close button handler. When provided, a close button (`x`) renders. Required for persistent notifications.
- `onExited?: () => void` — callback after exit animation completes (for unmounting)
- `pauseOnHover?: boolean` — default `true`. Pauses auto-dismiss timer when user hovers over the notification. Required for WCAG 2.2.1 compliance.
- `className?: string` — for consumer-specific styling extensions

**What the base handles:** Visual shell (`--bg-elevated` background, status-colored left border, `--radius-lg`, z-index 1100, `--shadow-elevated`), status icon rendering via `<Icon>`, slide+fade animation (250ms ease-out entry, 200ms ease-in exit), auto-dismiss timer with hover pause, close button, ARIA attributes.

**What consumers handle:** Message text, action buttons, progress bars, and any behavior-specific logic.

**Accessibility:**
- Status icons always rendered (never color-only). Color is paired with icon shape per WCAG 1.4.1.
- Close button is keyboard accessible (`Tab` to focus, `Enter`/`Space` to activate).
- `Esc` dismisses the focused notification.
- Respects `prefers-reduced-motion: reduce` — disables slide animation, keeps only opacity fade.

**CSS:** `Notification.css` with `.notification`, `.notification--info`, `.notification--success`, `.notification--warning`, `.notification--error`, `.notification--top-right`, `.notification--bottom-center`, `.notification--visible`.

#### Stacking

When multiple top-right notifications are visible, they stack vertically with `var(--space-sm)` gap, newest on top. Maximum 3 visible simultaneously; excess notifications are queued and shown as earlier ones dismiss.

This is handled by rendering them in a `.notification-stack` container in App.tsx (a simple flex column, fixed top-right) rather than each notification positioning itself independently. Bottom-center notifications (`<Toast>`) are positioned independently, not part of the stack.

Identical notifications (same status + same message) are deduplicated.

#### Refactor existing components

- **Toast** — refactored to render a `<Notification status="info" position="bottom-center" duration={8000}>` wrapper around its message + action buttons. Keeps its own props API (`message`, `actions[]`, `onDismiss`). `Toast.css` reduces to only Toast-specific styles (action button layout).
- **UpdateNotification** — refactored to render a `<Notification status="info" position="top-right" duration={null}>` wrapper. Keeps its own progress bar state and two-mode rendering (idle vs. applying). `UpdateNotification.css` reduces to only the progress bar styles.

#### New `BrokenCertNotification` component

- Renders a `<Notification status="warning" position="top-right" duration={null}>` wrapper
- Props: `profile: { id, name }`, `switchedTo: { id, name } | null`, `onImport: (profileId: string) => void`, `onOpenSettings: () => void`, `onDismiss: () => void`
- Each notification is independently dismissible
- The `warning` status automatically provides the `alert-triangle` icon and `--accent-warning-*` color tokens
- Action buttons: Import (primary), Settings (secondary), Dismiss (ghost)

#### New theme tokens

The project currently has `--accent-danger-*` (6 variants) and `--accent-success-*` (3 variants) but no warning or info token families. The notification system needs two new families added to every theme file and the template:

- **`--accent-warning-*`**: `--accent-warning`, `--accent-warning-text`, `--accent-warning-subtle`, `--accent-warning-border`, `--accent-warning-bg`. Amber/yellow hues. Used by `warning` status notifications and inline warning indicators.
- **`--accent-info-*`**: `--accent-info`, `--accent-info-text`, `--accent-info-subtle`, `--accent-info-border`, `--accent-info-bg`. Blue hues. Used by `info` status notifications.

These follow the same 5-variant pattern as `--accent-danger-*` (base, text, subtle, border, bg). The success family should also be extended from 3 to 5 variants (`--accent-success-text`, `--accent-success-border`, `--accent-success-bg` are currently missing).

**Documentation updates:**
- `_template.css`: Add guidance values, hue ranges, and opacity ranges for all new token families (same format as the existing `--accent-danger-*` documentation block)
- `UI_GUIDE.md`: Update the token reference section to list all four semantic color families and their variants, noting that all themes must define all four families

#### Icons needed

Add to `Icon.tsx` if not already present: `info`, `check-circle`, `alert-triangle`, `alert-circle`. These are standard Feather/Lucide icons consistent with the existing icon system.

#### UI_GUIDE.md update

Add a new "Notification Pattern" section. This section must be complete enough that a future contributor can build a new notification without asking questions. It should include:

**Component API reference:**
- The `<Notification>` base component and its full props list with types and defaults
- Status types and what each one drives (icon, color tokens, ARIA role, auto-dismiss default)

**Decision checklist for new notifications** (a contributor must answer all of these):
1. What **status** applies? (`info` = supplemental, `success` = action confirmed, `warning` = needs attention, `error` = something failed)
2. What **position**? (`top-right` for system/background events, `bottom-center` for direct action feedback)
3. Should it **auto-dismiss**? (Default from status, but can override with `duration`)
4. Does it need a **dismiss button**? (Persistent notifications: yes. Blocking with no fallback: no dismiss.)
5. What **actions** does it need? (Max 1 primary action. Action must be reachable elsewhere in UI since notifications can be missed.)
6. What **message text**? (Short, no jargon. State what happened and what the user can do.)

**Behavioral rules:**
- Auto-dismiss rules: `info`/`success` auto-dismiss at 5s; `warning`/`error` persist; timer pauses on hover
- Errors and actionable notifications must never auto-dismiss
- Max 3 visible top-right notifications; excess queued; identical notifications deduplicated
- Action buttons: max 1 primary per notification; close button is separate from action button

**Accessibility requirements:**
- ARIA roles: `info`/`success`/`warning` use `role="status"` (`aria-live="polite"`); `error` uses `role="alert"` (`aria-live="assertive"`)
- Status icon always rendered (never rely on color alone, WCAG 1.4.1)
- Close button keyboard accessible; `Esc` dismisses focused notification
- `prefers-reduced-motion: reduce` disables slide, keeps opacity fade only

**When NOT to use Notification:**
- Blocking decisions requiring immediate response → use `confirm()` modal
- Form validation errors → use inline error text near the field
- Passive status indicators → use inline badges/dots, not notifications

**Token reference:**
- List all notification-related token families (`--accent-info-*`, `--accent-success-*`, `--accent-warning-*`, `--accent-danger-*`) with their variant suffixes (base, `-text`, `-subtle`, `-border`, `-bg`)
- Note: themes must define all four families. Reference `_template.css` for guidance values.

**Example: adding a new notification:**
```tsx
// A "server unreachable" error notification
<Notification status="error" position="top-right" onDismiss={handleDismiss}>
  <p>Could not reach server. <strong>Check your connection.</strong></p>
  <button className="btn btn-sm btn-primary" onClick={handleRetry}>Retry</button>
</Notification>
```

### 4. Frontend Feature Changes

#### App.tsx wiring

- New state: `brokenCertInfo: { brokenProfiles: Array<{ id: string; name: string }>; switchedTo: { id: string; name: string } | null } | null`
- On `profiles.list` response: check `brokenProfiles` array, set `brokenCertInfo` if non-empty
- Top-right notifications rendered inside a `.notification-stack` container (replaces individual fixed positioning for `UpdateNotification` and `BrokenCertNotification`)
- `<Toast>` remains independently positioned at bottom-center (not part of the stack)
- Renders **one `BrokenCertNotification` per broken profile** via `.map()` with `key={bp.id}`
- `onImport(profileId)`: trigger file picker, read as base64, send `profiles.recover` with the specific profile ID
- `onOpenSettings`: `setShowSettings(true)` + `setSettingsTab('profile')`
- `onDismiss(profileId)`: filters that profile out of `brokenCertInfo.brokenProfiles`; clears state entirely when array becomes empty
- On `profiles.recovered`: filters the recovered profile out of `brokenCertInfo.brokenProfiles`
- On `profiles.removed`: filters the removed profile out of `brokenCertInfo.brokenProfiles`

#### ProfileSettingsTab.tsx changes

For each profile card, check `profile.certValid`:
- If `false`: show `<Icon name="alert-triangle" />` next to profile name, replace fingerprint with "Certificate missing" in `--accent-warning-text` color (new token), replace Export button with Import button
- Import button triggers file picker + `profiles.recover` flow
- Delete still works as before (removes orphaned config entry)
- Edit (rename) still works as before

#### useProfiles.ts changes

- Add handler for `profiles.recovered` event — updates profile in list with new `certValid`/`fingerprint`
- Expose `recoverProfile(id: string, data: string)` function that sends `profiles.recover`

### 5. Edge Cases & Error Handling

**Import fails (invalid/corrupt .pfx):**
Backend sends `profiles.error`. Frontend shows error via existing `confirm()` modal alert. Notification/Settings stays visible for retry.

**Auto-switch with multiple healthy profiles:**
Picks the first healthy profile in list order (config.json order). Notification tells the user which profile was selected.

**Profile recovered while notification is showing:**
`profiles.recovered` fires → `brokenCertInfo` clears → notification disappears. Same if profile is deleted via Settings (`profiles.removed` → clear `brokenCertInfo`).

**Notification + Update notification both visible:**
Both render inside the `.notification-stack` container in App.tsx. They stack vertically with `var(--space-sm)` gap, no manual CSS offset needed.

**New profile created while notification shows (Scenario B):**
Creating a new profile auto-sets it as active (existing behavior). `profiles.added` + `profiles.activeChanged` fire → frontend detects healthy active profile → clears `brokenCertInfo`.

**Multiple broken profiles:**
Each broken profile gets its own notification in the `.notification-stack`. Recovering, dismissing, or deleting a profile removes only that profile's notification. The `switchedTo` info is shown on the first notification (when the active profile was broken and auto-switched), providing context for the switch.

## New Bridge Messages

| Message | Direction | Payload |
|---------|-----------|---------|
| `profiles.recover` | JS → C# | `{ id: string, data: string }` |
| `profiles.recovered` | C# → JS | `{ id: string, name: string, fingerprint: string, certValid: true }` |

## Modified Bridge Messages

| Message | Change |
|---------|--------|
| `profiles.list` response | Add `brokenProfiles: Array<{ id, name }>` and `autoSwitchedTo: { id, name } \| null` fields |

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Client/Services/Certificate/CertificateService.cs` | New `profiles.recover` handler; auto-switch logic in `profiles.list` handler |
| `src/Brmble.Web/src/components/Notification/Notification.tsx` | New shared base notification component |
| `src/Brmble.Web/src/components/Notification/Notification.css` | Shared notification styles (position variants, animation, stacking) |
| `src/Brmble.Web/src/components/Toast/Toast.tsx` | Refactor to use `<Notification>` base |
| `src/Brmble.Web/src/components/Toast/Toast.css` | Reduce to Toast-specific styles only |
| `src/Brmble.Web/src/components/UpdateNotification/UpdateNotification.tsx` | Refactor to use `<Notification>` base |
| `src/Brmble.Web/src/components/UpdateNotification/UpdateNotification.css` | Reduce to progress bar styles only |
| `src/Brmble.Web/src/components/BrokenCertNotification/BrokenCertNotification.tsx` | New component using `<Notification>` base |
| `src/Brmble.Web/src/components/BrokenCertNotification/BrokenCertNotification.css` | Danger variant styles |
| `src/Brmble.Web/src/components/Icon/Icon.tsx` | Add `info`, `check-circle`, `alert-triangle`, `alert-circle` icons if missing |
| `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx` | Warning indicator + Import button for broken profiles |
| `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css` | Danger text styles for broken profiles |
| `src/Brmble.Web/src/hooks/useProfiles.ts` | `profiles.recovered` handler + `recoverProfile` function |
| `src/Brmble.Web/src/App.tsx` | `brokenCertInfo` state, `.notification-stack` container, import/settings/dismiss handlers |
| `docs/UI_GUIDE.md` | New Notification Pattern section |
| `src/Brmble.Web/src/themes/*.css` | Add `--accent-warning-*` and `--accent-info-*` token families; extend `--accent-success-*` to 5 variants |
| `src/Brmble.Web/src/themes/_template.css` | Document new token families in theme template |
