# Settings Menu UI Guide Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every SettingsModal tab comply with `docs/UI_GUIDE.md`, while documenting Admin-only sub-tabs as the sole settings submenu exception.

**Architecture:** Add one shared settings help component/style pattern and migrate all settings help affordances to it. Then remove invalid/ad-hoc UI patterns tab-by-tab with focused tests, keeping behavior unchanged.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, CSS custom property design tokens.

---

## File Structure

- Create: `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx`
  - Shared settings `?` help component wrapping `Tooltip`.
- Create: `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.test.tsx`
  - Verifies accessible button and tooltip content.
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`
  - Owns shared settings label/help styles.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
  - Replaces CSS-only help spans and WaveIn inline help with `SettingsHelp`.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
  - Removes old `.tooltip-icon` CSS and tokenizes remaining hardcoded values where practical.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.test.tsx`
  - Verifies no `.tooltip-icon` / `[data-tooltip]`, and WaveIn explanation moved to help.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx`
  - Uses `SettingsHelp` and removes inline note.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.css`
  - Removes duplicated help styles, removes extra root padding, tokenizes spacing.
- Create: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx`
  - Verifies `SettingsHelp` buttons and no inline note.
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
  - Removes overlay inline hint or converts it to `SettingsHelp`.
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css`
  - Removes global `.btn-danger` override.
- Create: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.test.tsx`
  - Verifies no overlay inline hint.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`
  - Removes empty-server inline hint or folds it into existing tooltip.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`
  - Removes now-unused `.settings-hint` CSS if unused.
- Create: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.test.tsx`
  - Verifies empty-server hint is not rendered.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
  - Fixes nested button structure.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
  - Adjusts ban row layout and removes root padding if unnecessary.
- Create: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`
  - Verifies no nested buttons and Unban remains clickable.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`
  - Uses `<Icon name="x" />` and tokenized stagger variable.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.tsx`
  - Uses `<Icon name="x" />` and tokenized stagger variable.
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css`
  - Tokenizes shadow/gap and implements stagger delay via CSS variable.
- Create or modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.test.tsx`
  - Verifies delete button does not contain text glyph.
- Create or modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.test.tsx`
  - Verifies delete button does not contain text glyph.
- Modify: `docs/UI_GUIDE.md`
  - Documents Admin-only sub-tab exception and normal-user no-submenu rule.
- Modify: `src/Brmble.Web/src/uiGuideCompliance.test.ts`
  - Tightens allowlists if this cleanup removes old exceptions.

## Task 1: Add Shared SettingsHelp Component

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`

- [ ] **Step 1: Write failing SettingsHelp test**

Create `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsHelp } from './SettingsHelp';

describe('SettingsHelp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an accessible question-mark help button with tooltip content', () => {
    render(<SettingsHelp content="Higher quality uses more bandwidth" label="More information about quality" />);

    const button = screen.getByRole('button', { name: 'More information about quality' });
    expect(button).toHaveTextContent('?');
    expect(button).toHaveClass('settings-info-btn');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(button);
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Higher quality uses more bandwidth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/SettingsHelp.test.tsx
```

Expected: FAIL because `SettingsHelp` does not exist.

- [ ] **Step 3: Add SettingsHelp component**

Create `src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx`:

```tsx
import { Tooltip } from '../Tooltip/Tooltip';

interface SettingsHelpProps {
  content: string;
  label: string;
}

export function SettingsHelp({ content, label }: SettingsHelpProps) {
  return (
    <Tooltip content={content} position="right" align="start">
      <button type="button" className="settings-info-btn" aria-label={label}>?</button>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Add shared settings help styles**

In `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`, after `.settings-item label`, add:

```css
.settings-label-group {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.settings-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.settings-info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-subtle);
  padding: 0;
}
```

- [ ] **Step 5: Run SettingsHelp test**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/SettingsHelp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsHelp.tsx src/Brmble.Web/src/components/SettingsModal/SettingsHelp.test.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.css
git commit -m "refactor: add shared settings help component"
```

## Task 2: Migrate Audio Settings Help

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.test.tsx`

- [ ] **Step 1: Update failing tests for new help behavior**

In `AudioSettingsTab.test.tsx`, update the WaveIn test assertion:

```tsx
expect(screen.queryByText('WaveIn uses the system default microphone only. Switch to WASAPI to choose a specific input device.')).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: 'More information about input device' })).toHaveClass('settings-info-btn');
```

Add a test:

```tsx
it('uses shared settings help buttons instead of CSS-only tooltip spans', () => {
  render(
    <AudioSettingsTab
      settings={baseSettings}
      noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
      onChange={vi.fn()}
      onNoiseSuppressionChange={vi.fn()}
      allBindings={{ pushToTalkKey: null }}
      onClearBinding={vi.fn()}
    />
  );

  expect(screen.getByRole('button', { name: 'More information about hold time' })).toHaveClass('settings-info-btn');
  expect(screen.getByRole('button', { name: 'More information about sensitivity' })).toHaveClass('settings-info-btn');
  expect(screen.getByRole('button', { name: 'More information about noise suppression' })).toHaveClass('settings-info-btn');
  expect(screen.getByRole('button', { name: 'More information about bitrate' })).toHaveClass('settings-info-btn');
  expect(screen.getByRole('button', { name: 'More information about audio per packet' })).toHaveClass('settings-info-btn');
  expect(document.querySelector('.tooltip-icon')).not.toBeInTheDocument();
  expect(document.querySelector('[data-tooltip]')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/AudioSettingsTab.test.tsx
```

Expected: FAIL because Audio still uses inline hint and CSS-only tooltip spans.

- [ ] **Step 3: Migrate AudioSettingsTab to SettingsHelp**

In `AudioSettingsTab.tsx`, add:

```ts
import { SettingsHelp } from './SettingsHelp';
```

Replace `Input Device` label with:

```tsx
<div className="settings-label-group">
  <span className="settings-label">Input Device</span>
  <SettingsHelp content="WaveIn uses the system default microphone only. Switch to WASAPI to choose a specific input device." label="More information about input device" />
</div>
```

Remove the `settings-hint` paragraph for WaveIn.

Replace each `<span className="tooltip-icon" data-tooltip="...">?</span>` with a matching `SettingsHelp` call:

```tsx
<SettingsHelp content="How long to keep transmitting after you release Push to Talk. Higher values add a short silence tail to help avoid clipping words during brief pauses or at the end of speech." label="More information about hold time" />
<SettingsHelp content="How strictly background noise is rejected. Higher rejects more noise but needs clearer speech to trigger; lower picks up softer voices." label="More information about sensitivity" />
<SettingsHelp content="How aggressively to suppress background noise. Higher levels remove more noise but can muffle speech. AGC and high-pass filter run regardless of this setting." label="More information about noise suppression" />
<SettingsHelp content="How much data is used per second of voice. Higher = better quality but uses more bandwidth. Lower = smaller data usage, good for slow connections. 72 kbps is recommended for most users." label="More information about bitrate" />
<SettingsHelp content="How many milliseconds of audio are bundled into each network packet. Lower = your voice arrives faster (less delay). Higher = fewer packets sent, better for unstable connections. 20 ms is recommended for most users." label="More information about audio per packet" />
```

Use `.settings-label-group` around label text plus `SettingsHelp` for slider/select labels.

- [ ] **Step 4: Remove old Audio CSS-only tooltip styles**

Delete `.audio-settings-tab .tooltip-icon` and `.audio-settings-tab .tooltip-icon:hover::after` blocks from `AudioSettingsTab.css`.

Change `.settings-dev-label` padding from:

```css
padding: 2px var(--space-2xs);
```

to:

```css
padding: var(--space-2xs);
```

- [ ] **Step 5: Run Audio tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/AudioSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.test.tsx
git commit -m "refactor: standardize audio settings help"
```

## Task 3: Migrate Screen Share Settings Help

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.css`
- Create: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `ScreenShareSettingsTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenShareSettingsTab } from './ScreenShareSettingsTab';
import type { ScreenShareSettings } from './SettingsModal';

const settings: ScreenShareSettings = {
  captureAudio: true,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
};

describe('ScreenShareSettingsTab', () => {
  it('uses shared settings help buttons and no inline note', () => {
    render(<ScreenShareSettingsTab settings={settings} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'More information about capture audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about system audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about viewer location' })).toHaveClass('settings-info-btn');
    expect(screen.queryByText('System audio is available on Windows and macOS. Audio capture requires browser support.')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/ScreenShareSettingsTab.test.tsx
```

Expected: FAIL because inline note still exists and raw Tooltip buttons may still be used.

- [ ] **Step 3: Migrate ScreenShareSettingsTab**

In `ScreenShareSettingsTab.tsx`, replace `Tooltip` import with:

```ts
import { SettingsHelp } from './SettingsHelp';
```

Replace every raw `Tooltip + button.settings-info-btn` with `SettingsHelp`. For `System Audio`, include the support note in the help content:

```tsx
<SettingsHelp content="Capture system audio when supported. System audio is available on Windows and macOS, and requires browser support." label="More information about system audio" />
```

Remove the bottom `<p className="settings-note">...</p>`.

- [ ] **Step 4: Clean ScreenShare CSS**

In `ScreenShareSettingsTab.css`:

- Remove root padding block `.screen-share-settings-tab { padding: 16px; }`.
- Remove `.settings-note` block.
- Remove duplicated `.settings-label-group`, `.settings-label`, and `.settings-info-btn` blocks if present.

- [ ] **Step 5: Run Screen Share tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/ScreenShareSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.css src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx
git commit -m "refactor: standardize screen share settings help"
```

## Task 4: Remove Inline Help From Interface And Connection Settings

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css`
- Create: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`
- Create: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.test.tsx`

- [ ] **Step 1: Write failing Interface test**

Create `InterfaceSettingsTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { DEFAULT_OVERLAY } from './InterfaceSettingsTypes';

describe('InterfaceSettingsTab', () => {
  it('does not render plain inline overlay help text', () => {
    render(
      <InterfaceSettingsTab
        appearanceSettings={{ theme: 'classic' }}
        overlaySettings={DEFAULT_OVERLAY}
        brmblegotchiSettings={{ enabled: true }}
        onAppearanceChange={vi.fn()}
        onOverlayChange={vi.fn()}
        onBrmblegotchiChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/Keep a small Brmblegotchi companion overlay/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing Connection test**

Create `ConnectionSettingsTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionSettingsTab, DEFAULT_CONNECTION } from './ConnectionSettingsTab';

describe('ConnectionSettingsTab', () => {
  it('does not render plain inline server help text', () => {
    render(<ConnectionSettingsTab settings={DEFAULT_CONNECTION} onChange={vi.fn()} servers={[]} />);

    expect(screen.queryByText("You can also choose a specific server once you've added one.")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/SettingsModal/ConnectionSettingsTab.test.tsx
```

Expected: FAIL because inline help still renders.

- [ ] **Step 4: Remove or convert inline help**

In `InterfaceSettingsTab.tsx`, remove:

```tsx
<p className="settings-hint">
  Keep a small Brmblegotchi companion overlay on top of games and desktop apps for current-channel activity, DMs, moderation, and speakers.
</p>
```

In `ConnectionSettingsTab.tsx`, remove:

```tsx
{servers.length === 0 && (
  <p className="settings-hint">
    You can also choose a specific server once you've added one.
  </p>
)}
```

Keep the existing `Tooltip` around the `Connect to` select.

In `InterfaceSettingsTab.css`, delete the global `.btn-danger`, `.btn-danger:hover`, and `.btn-danger:active` blocks if no class in `InterfaceSettingsTab.tsx` uses `btn-danger`.

In `ConnectionSettingsTab.css`, delete `.connection-settings-tab .settings-hint` if unused.

- [ ] **Step 5: Run tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/SettingsModal/ConnectionSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.test.tsx
git commit -m "refactor: remove inline settings help text"
```

## Task 5: Fix Admin Ban Row And Document Sub-Tab Exception

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- Create: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`
- Modify: `docs/UI_GUIDE.md`

- [ ] **Step 1: Write failing Admin tests**

Create `AdminSettingsTab.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminSettingsTab } from './AdminSettingsTab';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

const ban = {
  address: '127.0.0.1',
  bits: 32,
  name: 'TroubleUser',
  hash: 'hash-1',
  reason: 'spam',
  start: 1700000000,
  duration: 0,
};

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

function renderWithBan() {
  bridgeMock.once.mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'voice.bans') handler([ban]);
  });
  return render(<AdminSettingsTab />);
}

describe('AdminSettingsTab', () => {
  it('renders ban summary and unban as sibling buttons', () => {
    renderWithBan();

    const summary = screen.getByRole('button', { name: /TroubleUser/ });
    const unban = screen.getByRole('button', { name: 'Unban' });

    expect(summary).not.toContainElement(unban);
    expect(summary.parentElement).toContainElement(unban);
  });

  it('keeps expand and unban behavior separate', () => {
    renderWithBan();

    fireEvent.click(screen.getByRole('button', { name: /TroubleUser/ }));
    expect(screen.getByText('IP:')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unban' }));
    expect(bridgeMock.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected: FAIL because Unban is nested inside summary button or test props need matching.

- [ ] **Step 3: Refactor ban row markup**

In `AdminSettingsTab.tsx`, replace nested summary button structure with sibling controls:

```tsx
<div key={`${ban.hash}-${ban.address}-${ban.start}`} className="admin-ban-row">
  <div className="admin-ban-summary">
    <button
      type="button"
      className="admin-ban-expand"
      onClick={() => setExpandedBan(expandedBan === index ? null : index)}
    >
      <div className="admin-ban-info">
        <span className="admin-ban-name">{ban.name || ban.address}</span>
        <span className="admin-ban-reason">{ban.reason || 'No reason'}</span>
      </div>
      <span className="admin-ban-expiry">{formatExpiry(ban.start, ban.duration)}</span>
    </button>
    <button className="btn btn-danger btn-sm" onClick={() => handleUnban(index)}>Unban</button>
  </div>
  {expandedBan === index && (...existing details...)}
</div>
```

- [ ] **Step 4: Update Admin CSS**

In `AdminSettingsTab.css`:

- Remove `.admin-settings-tab { padding: var(--space-lg); }` unless visual tests fail.
- Keep `.settings-subtabs` as Admin exception.
- Make `.admin-ban-summary` a flex container, not the clickable button.
- Add `.admin-ban-expand` using button reset-style with tokenized values:

```css
.admin-ban-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  gap: var(--space-md);
}

.admin-ban-expand {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.admin-ban-summary:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 5: Document Admin-only sub-tab exception**

In `docs/UI_GUIDE.md`, under Settings Tab Pattern rules, add:

```md
6. Do not hide normal-user settings inside sub-tabs or nested settings menus. Normal settings must be visible in the tab.
7. Admin settings are the only exception: admin-only tools may use sub-tabs because they are advanced, specialized workflows.
```

- [ ] **Step 6: Run Admin tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx
git commit -m "fix: clean up admin settings interactions"
```

## Task 6: Replace Profile Delete Glyphs And Tokenize Stagger

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css`
- Create: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.test.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.test.tsx`

- [ ] **Step 1: Write failing ProfileSettingsTab test**

Create `ProfileSettingsTab.test.tsx` with the smallest render needed for a profile row. If the full component setup is too large, test a local exported helper only after extracting one in this task. The assertion must prove delete buttons do not contain `✕`:

```tsx
expect(screen.queryByText('✕')).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: /delete profile/i }).querySelector('svg')).toBeInTheDocument();
```

- [ ] **Step 2: Write failing ProfilesSettingsTab test**

Create `ProfilesSettingsTab.test.tsx` with the same assertion for the older profiles tab.

- [ ] **Step 3: Run tests to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/ProfileSettingsTab.test.tsx src/components/SettingsModal/ProfilesSettingsTab.test.tsx
```

Expected: FAIL because delete buttons contain `✕`.

- [ ] **Step 4: Replace glyphs with Icon**

In both `ProfileSettingsTab.tsx` and `ProfilesSettingsTab.tsx`, import:

```ts
import { Icon } from '../Icon/Icon';
```

Replace delete button content:

```tsx
<Icon name="x" size={16} />
```

Add `aria-label="Delete profile"` where missing.

- [ ] **Step 5: Replace inline animation delay with CSS variable**

In both TSX files, replace:

```tsx
style={{ animationDelay: `${index * 50}ms` }}
```

with:

```tsx
style={{ '--stagger-index': index } as React.CSSProperties}
```

Ensure `CSSProperties` is imported from React in each file if needed:

```ts
import { useCallback, useRef, useState, type CSSProperties } from 'react';
```

or use the existing React import style.

In `ProfilesSettingsTab.css`, add to `.profiles-item`:

```css
animation-delay: calc(var(--stagger-index, 0) * var(--stagger-step));
```

- [ ] **Step 6: Tokenize Profiles CSS values**

In `ProfilesSettingsTab.css`:

Change:

```css
box-shadow: 0 4px 12px var(--accent-primary-glow);
gap: 0.125rem;
```

to:

```css
box-shadow: var(--shadow-soft);
gap: var(--space-2xs);
```

If `--shadow-soft` does not exist in `index.css`/themes, use `box-shadow: 0 0 var(--glow-md) var(--accent-primary-glow);` because glow radius is tokenized.

- [ ] **Step 7: Run profile tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/ProfileSettingsTab.test.tsx src/components/SettingsModal/ProfilesSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.css src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/ProfilesSettingsTab.test.tsx
git commit -m "refactor: align profile settings icons and motion"
```

## Task 7: Final Compliance Verification

**Files:**
- Modify if needed: `src/Brmble.Web/src/uiGuideCompliance.test.ts`
- Verify all SettingsModal source files.

- [ ] **Step 1: Run settings-specific grep checks**

Run from repo root:

```bash
git grep -n "tooltip-icon\|data-tooltip\|settings-hint\|settings-note\|✕\|Toast\|toast" -- src/Brmble.Web/src/components/SettingsModal
```

Expected: no output, except test assertions that explicitly ensure old patterns are absent. If test assertions appear, confirm they are negative assertions only.

- [ ] **Step 2: Run targeted settings tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/SettingsHelp.test.tsx src/components/SettingsModal/AudioSettingsTab.test.tsx src/components/SettingsModal/ScreenShareSettingsTab.test.tsx src/components/SettingsModal/InterfaceSettingsTab.test.tsx src/components/SettingsModal/ConnectionSettingsTab.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/ProfileSettingsTab.test.tsx src/components/SettingsModal/ProfilesSettingsTab.test.tsx src/uiGuideCompliance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run from `src/Brmble.Web`:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit final test/compliance updates if needed**

If `uiGuideCompliance.test.ts` or other final cleanup files changed:

```bash
git add src/Brmble.Web/src/uiGuideCompliance.test.ts
git commit -m "test: tighten settings UI guide compliance"
```

If no files changed, skip this commit.

---

## Self-Review

Spec coverage:
- SettingsHelp standardization: Tasks 1-3.
- Inline help cleanup: Tasks 2-4.
- Admin nested button fix: Task 5.
- Admin sub-tab exception docs: Task 5.
- Icon cleanup: Task 6.
- Token/motion cleanup: Tasks 3, 5, 6.
- Final verification: Task 7.

Placeholder scan: no TODO/TBD placeholders remain. Steps include concrete file paths, commands, and expected behavior.

Type consistency: `SettingsHelp`, `settings-info-btn`, `settings-label-group`, `notification` terminology, and `--stagger-index` are used consistently.
