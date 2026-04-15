# Broken Profile Detection & Notification Standardization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect orphaned profiles (missing `.pfx` cert), notify the user at startup with recovery options, and standardize the notification component system.

**Architecture:** A shared `<Notification>` base component replaces duplicated CSS across Toast and UpdateNotification. The backend auto-switches away from broken profiles and reports the issue. A new `BrokenCertNotification` uses the shared base with `warning` status.

**Tech Stack:** React + TypeScript (frontend), C# / WebView2 (backend), CSS custom properties (theming)

---

### Task 1: Add warning/info theme tokens to all theme files

**Files:**
- Modify: `src/Brmble.Web/src/themes/_template.css:230-330`
- Modify: `src/Brmble.Web/src/themes/classic.css:45-65`
- Modify: `src/Brmble.Web/src/themes/clean.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/blue-lagoon.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/aperol-spritz.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/cosmopolitan.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/midori-sour.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/retro-terminal.css` (same accent section)
- Modify: `src/Brmble.Web/src/themes/lemon-drop.css` (same accent section)

- [ ] **Step 1: Add warning and info token documentation to `_template.css`**

Insert after the Success Accent section (after line ~250) and before the Decorative Accent section. Follow the existing documentation format with hue ranges and opacity ranges:

```css
  /*
    ── Warning Accent ──────────────────────────────────────────────
    Amber / yellow tones for attention-needed states.
    Hue range: 35-50 (amber-yellow).

       Token                       Target
       --accent-warning:           hsl(35-50, 80-100%, 60-70%)    — base
       --accent-warning-text:      hsl(35-50, 80-100%, 65-75%)    — readable on dark bg
       --accent-warning-subtle:    rgba(base, 0.08-0.15)          — faint bg tint
       --accent-warning-border:    rgba(base, 0.30-0.50)          — visible border
       --accent-warning-bg:        rgba(base, 0.20-0.30)          — warning panel bg
  */
  --accent-warning:        /* hsl(35-50, 80-100%, 60-70%) */;
  --accent-warning-text:   /* hsl(35-50, 80-100%, 65-75%) */;
  --accent-warning-subtle: /* rgba(R, G, B, 0.08-0.15) */;
  --accent-warning-border: /* rgba(R, G, B, 0.30-0.50) */;
  --accent-warning-bg:     /* rgba(R, G, B, 0.20-0.30) */;

  /*
    ── Info Accent ─────────────────────────────────────────────────
    Blue tones for supplemental / informational states.
    Hue range: 200-220 (blue).

       Token                       Target
       --accent-info:              hsl(200-220, 60-80%, 55-65%)   — base
       --accent-info-text:         hsl(200-220, 60-80%, 62-72%)   — readable on dark bg
       --accent-info-subtle:       rgba(base, 0.08-0.15)          — faint bg tint
       --accent-info-border:       rgba(base, 0.30-0.50)          — visible border
       --accent-info-bg:           rgba(base, 0.20-0.30)          — info panel bg
  */
  --accent-info:        /* hsl(200-220, 60-80%, 55-65%) */;
  --accent-info-text:   /* hsl(200-220, 60-80%, 62-72%) */;
  --accent-info-subtle: /* rgba(R, G, B, 0.08-0.15) */;
  --accent-info-border: /* rgba(R, G, B, 0.30-0.50) */;
  --accent-info-bg:     /* rgba(R, G, B, 0.20-0.30) */;
```

Also extend the Success section to add `--accent-success-text`, `--accent-success-border`, `--accent-success-bg` (currently only 3 of 5 variants exist):

```css
  --accent-success-text:   /* hsl(140-160, 50-70%, 55-65%) */;
  --accent-success-border: /* rgba(R, G, B, 0.30-0.50) */;
  --accent-success-bg:     /* rgba(R, G, B, 0.20-0.30) */;
```

- [ ] **Step 2: Add tokens to `classic.css`**

Insert after the existing Success Accent block (after line 50) and before the Decorative Accent block (line 52). The classic theme uses warm tones:

```css
  /* Warning Accent (Amber) */
  --accent-warning: #f0a030;
  --accent-warning-text: #f0b050;
  --accent-warning-subtle: rgba(240, 160, 48, 0.12);
  --accent-warning-border: rgba(240, 160, 48, 0.4);
  --accent-warning-bg: rgba(240, 160, 48, 0.25);

  /* Info Accent (Blue) */
  --accent-info: #5b9bd5;
  --accent-info-text: #6baae0;
  --accent-info-subtle: rgba(91, 155, 213, 0.12);
  --accent-info-border: rgba(91, 155, 213, 0.4);
  --accent-info-bg: rgba(91, 155, 213, 0.25);
```

Also extend the Success block:

```css
  --accent-success-text: #60d888;
  --accent-success-border: rgba(80, 200, 120, 0.4);
  --accent-success-bg: rgba(80, 200, 120, 0.25);
```

- [ ] **Step 3: Add tokens to remaining 7 theme files**

Repeat the same pattern for each theme, choosing hue-appropriate warning (amber) and info (blue) values that match each theme's personality. Each theme file follows the same structure: find the existing Success Accent comment block, add `--accent-success-text/border/bg`, then add Warning Accent and Info Accent blocks before the Decorative Accent section.

For each theme:
- **clean.css**: Look at the existing danger/success hues and pick complementary amber and blue
- **blue-lagoon.css**: Teal-leaning blues; info should be distinguishable from the theme's primary blue
- **aperol-spritz.css**: Warm orange tones; warning amber should be distinguishable from the theme's primary orange
- **cosmopolitan.css**: Already has warm danger hues; pick a distinct amber for warning
- **midori-sour.css**: Green-focused; standard amber/blue will contrast well
- **retro-terminal.css**: Bright terminal colors; use bright amber and bright blue
- **lemon-drop.css**: Yellow-toned; warning amber must be distinguishable from the theme's primary yellow — consider shifting toward orange

- [ ] **Step 4: Build the frontend to verify tokens load without errors**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/themes/
git commit -m "feat: add warning and info accent token families to all themes"
```

---

### Task 2: Add notification icons to Icon component

**Files:**
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`

- [ ] **Step 1: Add `check-circle`, `alert-triangle`, and `alert-circle` icons**

Add these to the `iconPaths` record. Place them in a new `// ╔══ STATUS ══╗` category section. All icons follow Feather/Lucide conventions: 24x24 viewBox, stroke-based, `currentColor`, strokeWidth 2, round caps/joins.

```tsx
  // ╔══ STATUS ══╗
  'check-circle': {
    paths: (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </>
    ),
  },
  'alert-triangle': {
    paths: (
      <>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  },
  'alert-circle': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </>
    ),
  },
```

- [ ] **Step 2: Build to verify icons compile**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Icon/Icon.tsx
git commit -m "feat: add check-circle, alert-triangle, alert-circle status icons"
```

---

### Task 3: Create the shared `Notification` base component

**Files:**
- Create: `src/Brmble.Web/src/components/Notification/Notification.tsx`
- Create: `src/Brmble.Web/src/components/Notification/Notification.css`

- [ ] **Step 1: Create `Notification.css`**

```css
.notification {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  align-items: center;
  gap: var(--space-md);
  z-index: 1100;
  opacity: 0;
  transition: opacity var(--transition-fast), transform var(--transition-fast);
  box-shadow: var(--shadow-elevated);
  max-width: 420px;
}

/* Position variants */
.notification--top-right {
  transform: translateY(-20px);
}

.notification--bottom-center {
  position: fixed;
  bottom: var(--space-lg);
  left: 50%;
  transform: translateX(-50%) translateY(20px);
}

.notification--visible {
  opacity: 1;
}

.notification--visible.notification--top-right {
  transform: translateY(0);
}

.notification--visible.notification--bottom-center {
  transform: translateX(-50%) translateY(0);
}

/* Status icon */
.notification__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.notification--info .notification__icon { color: var(--accent-info); }
.notification--success .notification__icon { color: var(--accent-success); }
.notification--warning .notification__icon { color: var(--accent-warning); }
.notification--error .notification__icon { color: var(--accent-danger); }

/* Status left border accent */
.notification--info { border-left: 3px solid var(--accent-info); }
.notification--success { border-left: 3px solid var(--accent-success); }
.notification--warning { border-left: 3px solid var(--accent-warning); }
.notification--error { border-left: 3px solid var(--accent-danger); }

/* Content area */
.notification__content {
  flex: 1;
  min-width: 0;
}

/* Close button */
.notification__close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--space-xs);
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.notification__close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* Stacking container */
.notification-stack {
  position: fixed;
  top: var(--space-lg);
  right: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  z-index: 1100;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .notification {
    transition: opacity var(--transition-fast);
    transform: none !important;
  }
  .notification--bottom-center {
    transform: translateX(-50%) !important;
  }
  .notification--visible.notification--bottom-center {
    transform: translateX(-50%) !important;
  }
}
```

- [ ] **Step 2: Create `Notification.tsx`**

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '../Icon/Icon';
import './Notification.css';

export type NotificationStatus = 'info' | 'success' | 'warning' | 'error';

interface NotificationProps {
  status: NotificationStatus;
  position: 'top-right' | 'bottom-center';
  children: React.ReactNode;
  visible: boolean;
  duration?: number | null;
  onDismiss?: () => void;
  onExited?: () => void;
  pauseOnHover?: boolean;
  className?: string;
}

const STATUS_ICONS: Record<NotificationStatus, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-circle',
};

const STATUS_ROLES: Record<NotificationStatus, string> = {
  info: 'status',
  success: 'status',
  warning: 'status',
  error: 'alert',
};

const STATUS_LIVE: Record<NotificationStatus, 'polite' | 'assertive'> = {
  info: 'polite',
  success: 'polite',
  warning: 'polite',
  error: 'assertive',
};

const DEFAULT_DURATIONS: Record<NotificationStatus, number | null> = {
  info: 5000,
  success: 5000,
  warning: null,
  error: null,
};

export function Notification({
  status,
  position,
  children,
  visible,
  duration,
  onDismiss,
  onExited,
  pauseOnHover = true,
  className,
}: NotificationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveDuration = duration !== undefined ? duration : DEFAULT_DURATIONS[status];

  // Enter animation
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
      exitTimerRef.current = setTimeout(() => onExited?.(), 250);
    }
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [visible, onExited]);

  // Auto-dismiss timer
  const startTimer = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingRef.current = ms;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, ms);
  }, [onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current && startTimeRef.current !== null && remainingRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (remainingRef.current !== null && remainingRef.current > 0 && !timerRef.current) {
      startTimer(remainingRef.current);
    }
  }, [startTimer]);

  useEffect(() => {
    if (visible && effectiveDuration !== null && effectiveDuration > 0) {
      startTimer(effectiveDuration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, effectiveDuration, startTimer]);

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover && effectiveDuration !== null) pauseTimer();
  }, [pauseOnHover, effectiveDuration, pauseTimer]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover && effectiveDuration !== null) resumeTimer();
  }, [pauseOnHover, effectiveDuration, resumeTimer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onDismiss) {
      onDismiss();
    }
  }, [onDismiss]);

  const classNames = [
    'notification',
    `notification--${status}`,
    `notification--${position}`,
    isVisible ? 'notification--visible' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      role={STATUS_ROLES[status]}
      aria-live={STATUS_LIVE[status]}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      <div className="notification__icon">
        <Icon name={STATUS_ICONS[status]} size={18} />
      </div>
      <div className="notification__content">
        {children}
      </div>
      {onDismiss && (
        <button
          className="notification__close"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to verify component compiles**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds. The component is not yet used by anything.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Notification/
git commit -m "feat: create shared Notification base component with status-driven API"
```

---

### Task 4: Refactor Toast to use Notification base

**Files:**
- Modify: `src/Brmble.Web/src/components/Toast/Toast.tsx`
- Modify: `src/Brmble.Web/src/components/Toast/Toast.css`

- [ ] **Step 1: Refactor `Toast.tsx`**

Replace the entire file with:

```tsx
import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './Toast.css';

interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface ToastProps {
  message: string;
  actions?: ToastAction[];
  duration?: number;
  onDismiss: () => void;
}

export function Toast({ message, actions, duration = 8000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleAction = useCallback((action: ToastAction) => {
    action.onClick();
    setVisible(false);
  }, []);

  return (
    <Notification
      status="info"
      position="bottom-center"
      visible={visible}
      duration={duration}
      onDismiss={handleDismiss}
      onExited={onDismiss}
    >
      <span className="toast-message">{message}</span>
      {actions && (
        <div className="toast-actions">
          {actions.map((action, i) => (
            <button
              key={i}
              className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </Notification>
  );
}
```

- [ ] **Step 2: Reduce `Toast.css` to Toast-specific styles only**

Replace the entire file with:

```css
.toast-message {
  font-size: var(--text-sm);
  color: var(--text-primary);
  white-space: nowrap;
}

.toast-actions {
  display: flex;
  gap: var(--space-xs);
}
```

The positioning, background, border, animation, and z-index are now handled by `Notification.css`.

- [ ] **Step 3: Build and verify Toast still works visually**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds. Toast component still renders correctly (same visual output, now using the shared base).

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Toast/
git commit -m "refactor: Toast uses shared Notification base component"
```

---

### Task 5: Refactor UpdateNotification to use Notification base

**Files:**
- Modify: `src/Brmble.Web/src/components/UpdateNotification/UpdateNotification.tsx`
- Modify: `src/Brmble.Web/src/components/UpdateNotification/UpdateNotification.css`
- Modify: `src/Brmble.Web/src/App.tsx:2219-2226`

- [ ] **Step 1: Refactor `UpdateNotification.tsx`**

Replace the entire file with:

```tsx
import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
  progress: number | null;
}

export function UpdateNotification({ version, onUpdate, onDismiss, progress }: UpdateNotificationProps) {
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const isApplying = progress !== null;

  return (
    <Notification
      status="info"
      position="top-right"
      visible={visible}
      duration={null}
      onDismiss={isApplying ? undefined : handleDismiss}
      onExited={onDismiss}
    >
      {isApplying ? (
        <>
          <span className="update-notification__message">Updating to v{version}...</span>
          <div className="update-notification__progress">
            <div className="update-notification__progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <>
          <span className="update-notification__message">Update available: v{version}</span>
          <div className="update-notification__actions">
            <button className="btn btn-sm btn-ghost" onClick={handleDismiss}>Later</button>
            <button className="btn btn-sm btn-primary" onClick={onUpdate}>Update</button>
          </div>
        </>
      )}
    </Notification>
  );
}
```

- [ ] **Step 2: Reduce `UpdateNotification.css` to component-specific styles only**

Replace the entire file with:

```css
.update-notification__message {
  font-size: var(--text-sm);
  color: var(--text-primary);
  white-space: nowrap;
}

.update-notification__actions {
  display: flex;
  gap: var(--space-xs);
}

.update-notification__progress {
  width: 120px;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.update-notification__progress-bar {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-sm);
  transition: width var(--transition-fast);
}
```

- [ ] **Step 3: Add `.notification-stack` container in App.tsx**

In `App.tsx`, find the render section (around line 2219) where `<UpdateNotification>` is rendered. Wrap it in a `.notification-stack` div. Replace:

```tsx
      {updateInfo && (
        <UpdateNotification
          version={updateInfo.version}
          onUpdate={handleApplyUpdate}
          onDismiss={handleDismissUpdate}
          progress={updateProgress}
        />
      )}
```

With:

```tsx
      <div className="notification-stack">
        {updateInfo && (
          <UpdateNotification
            version={updateInfo.version}
            onUpdate={handleApplyUpdate}
            onDismiss={handleDismissUpdate}
            progress={updateProgress}
          />
        )}
      </div>
```

- [ ] **Step 4: Build and verify UpdateNotification still works**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/UpdateNotification/ src/Brmble.Web/src/App.tsx
git commit -m "refactor: UpdateNotification uses shared Notification base, add notification-stack"
```

---

### Task 6: Add `profiles.recover` backend handler

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

- [ ] **Step 1: Add `profiles.recover` handler**

In `CertificateService.cs`, after the existing `profiles.rename` handler block (around line 500), add the new handler:

```csharp
bridge.RegisterHandler("profiles.recover", data =>
{
    try
    {
        var id = data.GetProperty("id").GetString();
        var base64Data = data.GetProperty("data").GetString();

        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(base64Data))
        {
            bridge.Send("profiles.error", new { message = "Missing profile ID or certificate data." });
            return Task.CompletedTask;
        }

        var profile = _config.GetProfiles().FirstOrDefault(p => p.Id == id);
        if (profile == null)
        {
            bridge.Send("profiles.error", new { message = "Profile not found." });
            return Task.CompletedTask;
        }

        var certBytes = Convert.FromBase64String(base64Data);

        // Validate the .pfx is loadable
        string fingerprint;
        try
        {
            using var cert = X509CertificateLoader.LoadPkcs12(certBytes, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
            fingerprint = cert.Thumbprint;
        }
        catch (Exception ex)
        {
            bridge.Send("profiles.error", new { message = $"Invalid certificate file: {ex.Message}" });
            return Task.CompletedTask;
        }

        // Write to the expected cert path
        var certPath = GetCertPath(profile.Id, profile.Name);
        var certDir = Path.GetDirectoryName(certPath);
        if (certDir != null) Directory.CreateDirectory(certDir);
        File.WriteAllBytes(certPath, certBytes);

        // Reload active cert if this is the active profile
        if (_config.GetActiveProfileId() == id)
        {
            LoadActiveCertificate();
            SendStatus();
        }

        bridge.Send("profiles.recovered", new
        {
            id = profile.Id,
            name = profile.Name,
            fingerprint,
            certValid = true,
        });
    }
    catch (Exception ex)
    {
        bridge.Send("profiles.error", new { message = $"Failed to recover certificate: {ex.Message}" });
    }
    return Task.CompletedTask;
});
```

- [ ] **Step 2: Build to verify it compiles**

Run:
```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: add profiles.recover handler for cert re-import"
```

---

### Task 7: Add auto-switch logic to `profiles.list` handler

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs:286-312`

- [ ] **Step 1: Modify the `profiles.list` handler**

Replace the current handler (lines 286-312) with:

```csharp
bridge.RegisterHandler("profiles.list", _ =>
{
    // Adopt orphaned .pfx files only on first launch (no prior config.json).
    // This prevents re-adoption of intentionally deleted profiles.
    if (_config.IsFirstLaunch)
        AdoptOrphanedCerts();

    var profiles = _config.GetProfiles().Select(p =>
    {
        var certPath = FindCertPath(p.Id, p.Name);
        string? fingerprint = null;
        bool certValid = false;
        if (File.Exists(certPath))
        {
            try
            {
                using var cert = X509CertificateLoader.LoadPkcs12FromFile(certPath, password: null, keyStorageFlags: X509KeyStorageFlags.DefaultKeySet);
                fingerprint = cert.Thumbprint;
                certValid = true;
            }
            catch { }
        }
        return new { id = p.Id, name = p.Name, fingerprint, certValid };
    }).ToList();

    var activeProfileId = _config.GetActiveProfileId();
    object? brokenActiveProfile = null;
    object? autoSwitchedTo = null;

    // Check if active profile has a broken cert
    var activeProfile = profiles.FirstOrDefault(p => p.id == activeProfileId);
    if (activeProfile != null && !activeProfile.certValid)
    {
        brokenActiveProfile = new { id = activeProfile.id, name = activeProfile.name };

        // Try to auto-switch to the first healthy profile
        var healthyProfile = profiles.FirstOrDefault(p => p.certValid);
        if (healthyProfile != null)
        {
            _config.SetActiveProfileId(healthyProfile.id);
            LoadActiveCertificate();
            activeProfileId = healthyProfile.id;
            autoSwitchedTo = new { id = healthyProfile.id, name = healthyProfile.name };
        }
    }

    bridge.Send("profiles.list", new { profiles, activeProfileId, brokenActiveProfile, autoSwitchedTo });
    return Task.CompletedTask;
});
```

- [ ] **Step 2: Build to verify it compiles**

Run:
```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: auto-switch from broken active profile, report in profiles.list response"
```

---

### Task 8: Add `recoverProfile` and `profiles.recovered` handler to useProfiles

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useProfiles.ts`

- [ ] **Step 1: Add the `profiles.recovered` event handler and `recoverProfile` function**

In `useProfiles.ts`, add a new handler inside the `useEffect`:

After the `onError` handler (line 55), add:

```typescript
    const onRecovered = (data: unknown) => {
      const d = data as { id: string; name: string; fingerprint: string; certValid: boolean };
      setProfiles(prev => prev.map(p => p.id === d.id ? { ...p, fingerprint: d.fingerprint, certValid: d.certValid } : p));
    };
```

Add the listener after line 62:

```typescript
    bridge.on('profiles.recovered', onRecovered);
```

Add the cleanup after line 71:

```typescript
      bridge.off('profiles.recovered', onRecovered);
```

Add the `recoverProfile` callback after `renameSwapCert` (line 116):

```typescript
  const recoverProfile = useCallback((id: string, data: string) => {
    bridge.send('profiles.recover', { id, data });
  }, []);
```

Update the return statement (line 119) to include `recoverProfile`:

```typescript
  return { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert, checkExistingCert, addFromExisting, renameSwapCert, recoverProfile };
```

- [ ] **Step 2: Build to verify**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useProfiles.ts
git commit -m "feat: add recoverProfile and profiles.recovered handler to useProfiles hook"
```

---

### Task 9: Create BrokenCertNotification component

**Files:**
- Create: `src/Brmble.Web/src/components/BrokenCertNotification/BrokenCertNotification.tsx`
- Create: `src/Brmble.Web/src/components/BrokenCertNotification/BrokenCertNotification.css`

- [ ] **Step 1: Create `BrokenCertNotification.css`**

```css
.broken-cert-notification__message {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: var(--space-sm);
}

.broken-cert-notification__message strong {
  color: var(--text-primary);
}

.broken-cert-notification__actions {
  display: flex;
  gap: var(--space-xs);
  justify-content: flex-end;
}
```

- [ ] **Step 2: Create `BrokenCertNotification.tsx`**

```tsx
import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './BrokenCertNotification.css';

interface BrokenCertNotificationProps {
  brokenProfile: { id: string; name: string };
  switchedTo: { id: string; name: string } | null;
  onImport: () => void;
  onOpenSettings: () => void;
  onDismiss?: () => void;
}

export function BrokenCertNotification({
  brokenProfile,
  switchedTo,
  onImport,
  onOpenSettings,
  onDismiss,
}: BrokenCertNotificationProps) {
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <Notification
      status="warning"
      position="top-right"
      visible={visible}
      duration={null}
      onDismiss={onDismiss ? handleDismiss : undefined}
      onExited={onDismiss}
    >
      <div>
        <p className="broken-cert-notification__message">
          {switchedTo ? (
            <>
              Profile <strong>"{brokenProfile.name}"</strong> has no certificate file.
              Switched to <strong>"{switchedTo.name}"</strong>.
            </>
          ) : (
            <>
              Profile <strong>"{brokenProfile.name}"</strong> has no certificate.
              Import a certificate or create a new profile to connect.
            </>
          )}
        </p>
        <div className="broken-cert-notification__actions">
          {onDismiss && (
            <button className="btn btn-sm btn-ghost" onClick={handleDismiss}>
              Dismiss
            </button>
          )}
          <button className="btn btn-sm btn-secondary" onClick={onOpenSettings}>
            Open Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={onImport}>
            Import Certificate
          </button>
        </div>
      </div>
    </Notification>
  );
}
```

- [ ] **Step 3: Build to verify**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds. Component is not yet wired into App.tsx.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/BrokenCertNotification/
git commit -m "feat: create BrokenCertNotification component"
```

---

### Task 10: Wire BrokenCertNotification into App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add import**

At the top of `App.tsx`, add:

```typescript
import { BrokenCertNotification } from './components/BrokenCertNotification/BrokenCertNotification';
```

- [ ] **Step 2: Add state**

Near the other notification state (around line 1793), add:

```typescript
const [brokenCertInfo, setBrokenCertInfo] = useState<{
  brokenProfile: { id: string; name: string };
  switchedTo: { id: string; name: string } | null;
} | null>(null);
```

- [ ] **Step 3: Update the `profiles.list` response handler**

Find the `onProfilesList` handler (around line 1084). Replace it with:

```typescript
    const onProfilesList = (data: unknown) => {
      const d = data as {
        profiles: Array<{ id: string; name: string }>;
        activeProfileId: string | null;
        brokenActiveProfile: { id: string; name: string } | null;
        autoSwitchedTo: { id: string; name: string } | null;
      };
      setProfiles(d.profiles ?? []);
      if (d.activeProfileId) {
        const active = d.profiles.find(p => p.id === d.activeProfileId);
        if (active) setActiveProfileName(active.name);
      }
      if (d.brokenActiveProfile) {
        setBrokenCertInfo({
          brokenProfile: d.brokenActiveProfile,
          switchedTo: d.autoSwitchedTo,
        });
      }
    };
```

- [ ] **Step 4: Add `profiles.recovered` listener to clear brokenCertInfo**

In the same `useEffect` where bridge listeners are registered, add:

```typescript
    const onProfilesRecovered = () => {
      setBrokenCertInfo(null);
    };
    bridge.on('profiles.recovered', onProfilesRecovered);
```

And in the cleanup:

```typescript
      bridge.off('profiles.recovered', onProfilesRecovered);
```

- [ ] **Step 5: Add handler functions**

Near the other notification handlers (around line 1802), add:

```typescript
  const handleBrokenCertImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pfx,.p12';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !brokenCertInfo) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        bridge.send('profiles.recover', { id: brokenCertInfo.brokenProfile.id, data: base64 });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [brokenCertInfo]);

  const handleBrokenCertOpenSettings = useCallback(() => {
    setShowSettings(true);
    setSettingsTab('profile');
  }, []);

  const handleBrokenCertDismiss = useCallback(() => {
    setBrokenCertInfo(null);
  }, []);
```

- [ ] **Step 6: Add BrokenCertNotification to the notification-stack**

Find the `.notification-stack` div (from Task 5) and add the BrokenCertNotification inside it:

```tsx
      <div className="notification-stack">
        {updateInfo && (
          <UpdateNotification
            version={updateInfo.version}
            onUpdate={handleApplyUpdate}
            onDismiss={handleDismissUpdate}
            progress={updateProgress}
          />
        )}
        {brokenCertInfo && (
          <BrokenCertNotification
            brokenProfile={brokenCertInfo.brokenProfile}
            switchedTo={brokenCertInfo.switchedTo}
            onImport={handleBrokenCertImport}
            onOpenSettings={handleBrokenCertOpenSettings}
            onDismiss={brokenCertInfo.switchedTo ? handleBrokenCertDismiss : undefined}
          />
        )}
      </div>
```

Note: `onDismiss` is only provided when `switchedTo` is not null (Scenario A). When there's no fallback (Scenario B), `onDismiss` is undefined, so no Dismiss button or close X renders.

- [ ] **Step 7: Also clear brokenCertInfo when the broken profile is deleted**

Find where `profiles.removed` is handled in App.tsx (if it exists at the App level). If not, add a listener:

```typescript
    const onProfilesRemoved = (data: unknown) => {
      const d = data as { id: string };
      setBrokenCertInfo(prev => prev && prev.brokenProfile.id === d.id ? null : prev);
    };
    bridge.on('profiles.removed', onProfilesRemoved);
```

And cleanup:

```typescript
      bridge.off('profiles.removed', onProfilesRemoved);
```

- [ ] **Step 8: Build to verify**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire BrokenCertNotification into App with import, settings, and dismiss handlers"
```

---

### Task 11: Add broken profile indicators to ProfileSettingsTab

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css`

- [ ] **Step 1: Add Icon import to ProfileSettingsTab.tsx**

At the top of the file, ensure the `Icon` import exists (it may already be imported for the empty state):

```typescript
import { Icon } from '../Icon/Icon';
```

- [ ] **Step 2: Get `recoverProfile` from the hook**

In the component, update the `useProfiles()` destructuring to include `recoverProfile`:

```typescript
const { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert, checkExistingCert, addFromExisting, renameSwapCert, recoverProfile } = useProfiles();
```

- [ ] **Step 3: Add import handler function**

Add a handler for the import action on broken profiles:

```typescript
  const handleRecoverCert = useCallback((profile: { id: string; name: string }) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pfx,.p12';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        recoverProfile(profile.id, base64);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [recoverProfile]);
```

- [ ] **Step 4: Modify profile card rendering**

Find the profile info section (around line 346-348). Replace:

```tsx
                  <div className="profiles-info">
                    <span className="profiles-name">{profile.name}</span>
                    <span className="profiles-fingerprint">{formatFingerprint(profile.fingerprint)}</span>

                  </div>
```

With:

```tsx
                  <div className="profiles-info">
                    <span className="profiles-name">
                      {profile.name}
                      {!profile.certValid && (
                        <Icon name="alert-triangle" size={14} className="profiles-warning-icon" />
                      )}
                    </span>
                    <span className={`profiles-fingerprint${!profile.certValid ? ' profiles-fingerprint--broken' : ''}`}>
                      {profile.certValid ? formatFingerprint(profile.fingerprint) : 'Certificate missing'}
                    </span>
                  </div>
```

- [ ] **Step 5: Replace Export with Import for broken profiles**

Find the Export button (around line 374-381). Replace:

```tsx
                    <Tooltip content="Export certificate">
                      <button
                        className="btn btn-primary profiles-action-btn"
                        onClick={() => exportCert(profile.id)}
                      >
                        Export
                      </button>
                    </Tooltip>
```

With:

```tsx
                    {profile.certValid ? (
                      <Tooltip content="Export certificate">
                        <button
                          className="btn btn-primary profiles-action-btn"
                          onClick={() => exportCert(profile.id)}
                        >
                          Export
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Import certificate to restore this profile">
                        <button
                          className="btn btn-primary profiles-action-btn"
                          onClick={() => handleRecoverCert(profile)}
                        >
                          Import
                        </button>
                      </Tooltip>
                    )}
```

- [ ] **Step 6: Add CSS for broken profile indicators**

In `ProfilesSettingsTab.css`, add at the end:

```css
.profiles-warning-icon {
  color: var(--accent-warning);
  margin-left: var(--space-xs);
  vertical-align: middle;
}

.profiles-fingerprint--broken {
  color: var(--accent-warning-text);
}
```

- [ ] **Step 7: Build to verify**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css
git commit -m "feat: show warning indicators and import action for broken profiles in Settings"
```

---

### Task 12: Update UI_GUIDE.md with Notification Pattern section

**Files:**
- Modify: `docs/UI_GUIDE.md`

- [ ] **Step 1: Add the Notification Pattern section**

Find the last numbered section in `UI_GUIDE.md` and add a new section after it. The section number will depend on the current last section (check the file). Add:

```markdown
## N. Notification Pattern

### Base Component

All notifications use the shared `<Notification>` base component (`src/Brmble.Web/src/components/Notification/`). Never create standalone notification components with their own positioning/animation/styling — always wrap with `<Notification>`.

### Status Types

The `status` prop drives icon, color, ARIA role, and auto-dismiss behavior:

| Status | Icon | Color tokens | ARIA role | Auto-dismiss |
|---|---|---|---|---|
| `info` | `info` | `--accent-info-*` | `role="status"` | 5s |
| `success` | `check-circle` | `--accent-success-*` | `role="status"` | 5s |
| `warning` | `alert-triangle` | `--accent-warning-*` | `role="status"` | No (persist) |
| `error` | `alert-circle` | `--accent-danger-*` | `role="alert"` | No (persist) |

### Decision Checklist (answer all before building a notification)

1. **What status applies?** `info` = supplemental, `success` = action confirmed, `warning` = needs attention, `error` = something failed
2. **What position?** `top-right` for system/background events, `bottom-center` for direct action feedback
3. **Should it auto-dismiss?** Default from status, but can override with `duration` prop
4. **Does it need a dismiss button?** Persistent notifications: yes. Blocking with no fallback: no dismiss.
5. **What actions does it need?** Max 1 primary action. Action must be reachable elsewhere in UI since notifications can be missed.
6. **What message text?** Short, no jargon. State what happened and what the user can do.

### Props

```tsx
interface NotificationProps {
  status: 'info' | 'success' | 'warning' | 'error';
  position: 'top-right' | 'bottom-center';
  children: React.ReactNode;
  visible: boolean;
  duration?: number | null;     // null = never. Defaults: info/success = 5000, warning/error = null
  onDismiss?: () => void;       // When provided, close button (x) renders
  onExited?: () => void;        // After exit animation completes
  pauseOnHover?: boolean;       // Default: true. Pauses auto-dismiss on hover (WCAG 2.2.1)
  className?: string;           // For consumer-specific styling
}
```

### Behavioral Rules

- **Auto-dismiss:** `info`/`success` auto-dismiss at 5s; `warning`/`error` persist. Timer pauses on hover.
- **Errors and actionable notifications must never auto-dismiss.**
- **Max 3** visible top-right notifications. Excess queued. Identical notifications (same status + message) deduplicated.
- **Action buttons:** Max 1 primary per notification. Close button is separate from action button.
- Top-right notifications render inside a `.notification-stack` container in `App.tsx`.
- Bottom-center notifications (`Toast`) position themselves independently.

### Accessibility

- **ARIA:** `info`/`success`/`warning` use `role="status"` (`aria-live="polite"`); `error` uses `role="alert"` (`aria-live="assertive"`)
- **Icons:** Status icon always rendered — never rely on color alone (WCAG 1.4.1)
- **Keyboard:** Close button is keyboard accessible. `Esc` dismisses focused notification.
- **Motion:** `prefers-reduced-motion: reduce` disables slide animation, keeps opacity fade only.

### When NOT to Use Notification

- **Blocking decisions** requiring immediate response → use `confirm()` modal
- **Form validation errors** → use inline error text near the field (`.profiles-form-error` pattern)
- **Passive status indicators** → use inline badges/dots, not notifications

### Token Reference

All four semantic accent families must be defined in every theme:

| Family | Variants |
|---|---|
| `--accent-info-*` | base, `-text`, `-subtle`, `-border`, `-bg` |
| `--accent-success-*` | base, `-text`, `-subtle`, `-border`, `-bg`, `-glow` |
| `--accent-warning-*` | base, `-text`, `-subtle`, `-border`, `-bg` |
| `--accent-danger-*` | base, `-text`, `-subtle`, `-border`, `-bg`, `-strong` |

See `src/Brmble.Web/src/themes/_template.css` for guidance values per token.

### Example: Adding a New Notification

```tsx
// A "server unreachable" error notification
<Notification status="error" position="top-right" onDismiss={handleDismiss}>
  <p>Could not reach server. <strong>Check your connection.</strong></p>
  <button className="btn btn-sm btn-primary" onClick={handleRetry}>Retry</button>
</Notification>
```

### Existing Notifications

| Component | Status | Position | Auto-dismiss |
|---|---|---|---|
| `Toast` | `info` | `bottom-center` | 8s |
| `UpdateNotification` | `info` | `top-right` | No |
| `BrokenCertNotification` | `warning` | `top-right` | No |
```

- [ ] **Step 2: Build to verify docs don't break anything**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds (docs changes don't affect build, but verify nothing was accidentally broken).

- [ ] **Step 3: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: add Notification Pattern section to UI_GUIDE.md"
```

---

### Task 13: Run full build and test

**Files:** None (verification only)

- [ ] **Step 1: Build the frontend**

Run:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Build the backend**

Run:
```bash
dotnet build
```
Expected: Build succeeds.

- [ ] **Step 3: Run tests**

Run:
```bash
dotnet test
```
Expected: All tests pass.

- [ ] **Step 4: Verify no lint errors**

Run:
```bash
cd src/Brmble.Web && npx tsc --noEmit
```
Expected: No TypeScript errors.
