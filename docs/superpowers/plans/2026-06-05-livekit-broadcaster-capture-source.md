# LiveKit Broadcaster Capture Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a themed Screen Share setting that defaults capture to Window and passes the corresponding LiveKit/browser display-surface hint when starting a share.

**Architecture:** Extend the existing `ScreenShareSettings` model with a `preferredCaptureSource` enum-like string. Reuse the existing Settings tab `Select` and `SettingsHelp` patterns for UI, then map the setting inside `useScreenShare.startSharing` when building LiveKit capture options. No native picker, custom picker, game detection, or viewer behavior changes are included.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, LiveKit JS client.

---

## File Structure

- Modify `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`: extend `ScreenShareSettings` and `DEFAULT_SCREEN_SHARE`.
- Modify `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx`: add the themed `Preferred Capture Source` select row and options.
- Modify `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx`: cover the new help button and select change behavior.
- Modify `src/Brmble.Web/src/hooks/useScreenShare.ts`: map `preferredCaptureSource` to LiveKit `video.displaySurface` capture hints.
- Modify `src/Brmble.Web/src/hooks/useScreenShare.test.ts`: cover default window hint, `auto` omission, and preservation of existing capture options.

## Task 1: Extend Settings Model Defaults

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx:62-76`
- Test: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx`

- [ ] **Step 1: Write the failing settings-tab fixture update**

Update the shared test fixture so TypeScript expects the new property everywhere that constructs `ScreenShareSettings`:

```ts
const settings: ScreenShareSettings = {
  captureAudio: true,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
  preferredCaptureSource: 'window',
};
```

- [ ] **Step 2: Run type check to verify it fails before model change**

Run from `src/Brmble.Web`:

```powershell
npm run type-check
```

Expected: FAIL with a TypeScript error that `preferredCaptureSource` does not exist in `ScreenShareSettings` or related call sites.

- [ ] **Step 3: Add the model property and default**

Change `ScreenShareSettings` and `DEFAULT_SCREEN_SHARE` to:

```ts
export interface ScreenShareSettings {
  captureAudio: boolean;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 15 | 30 | 60;
  systemAudio: boolean;
  viewerMode: 'in-app' | 'new-window';
  preferredCaptureSource: 'auto' | 'window' | 'screen' | 'browser';
}

export const DEFAULT_SCREEN_SHARE: ScreenShareSettings = {
  captureAudio: false,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
  preferredCaptureSource: 'window',
};
```

- [ ] **Step 4: Run type check to verify it passes**

Run from `src/Brmble.Web`:

```powershell
npm run type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add "src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx" "src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx"
git commit -m "feat: add screen share capture source setting default"
```

## Task 2: Add Preferred Capture Source UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx:25-112`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx:23-40`

- [ ] **Step 1: Write failing tests for help and change behavior**

Replace the test file with this content:

```ts
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenShareSettingsTab } from './ScreenShareSettingsTab';
import type { ScreenShareSettings } from './SettingsModal';

const settings: ScreenShareSettings = {
  captureAudio: true,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
  preferredCaptureSource: 'window',
};

describe('ScreenShareSettingsTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses shared settings help buttons and no inline note', () => {
    render(<ScreenShareSettingsTab settings={settings} onChange={vi.fn()} />);

    const captureAudioHelp = screen.getByRole('button', { name: 'More information about capture audio' });

    expect(captureAudioHelp).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about resolution' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about frame rate' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about system audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about preferred capture source' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about viewer location' })).toHaveClass('settings-info-btn');
    expect(screen.queryByText('System audio is available on Windows and macOS. Audio capture requires browser support.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose Window for game sharing. Your system picker still asks which window to share.')).not.toBeInTheDocument();

    fireEvent.focus(captureAudioHelp);
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByRole('tooltip')).toHaveTextContent('browser support');
  });

  it('updates preferred capture source through the themed select', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ScreenShareSettingsTab settings={settings} onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Application Window' }));
    await user.click(screen.getByRole('option', { name: 'Full Screen' }));

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      preferredCaptureSource: 'screen',
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/SettingsModal/ScreenShareSettingsTab.test.tsx
```

Expected: FAIL because the preferred capture source help button and select do not exist yet.

- [ ] **Step 3: Add the UI option list and settings row**

In `ScreenShareSettingsTab.tsx`, add this option list after `VIEWER_MODE_OPTIONS`:

```ts
const PREFERRED_CAPTURE_SOURCE_OPTIONS = [
  { value: 'window', label: 'Application Window' },
  { value: 'screen', label: 'Full Screen' },
  { value: 'browser', label: 'Browser Tab' },
  { value: 'auto', label: 'Auto' },
];
```

Add this row at the top of the Screen Capture section, before Resolution:

```tsx
        <div className="settings-item">
          <div className="settings-label-group">
            <span className="settings-label">Preferred Capture Source</span>
            <SettingsHelp content="Choose Window for game sharing. Your system picker still asks which window to share." label="More information about preferred capture source" />
          </div>
          <Select
            value={localSettings.preferredCaptureSource}
            onChange={(value) => handleChange('preferredCaptureSource', value as ScreenShareSettings['preferredCaptureSource'])}
            options={PREFERRED_CAPTURE_SOURCE_OPTIONS}
          />
        </div>
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/SettingsModal/ScreenShareSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add "src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx" "src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx"
git commit -m "feat: add screen share capture source selector"
```

## Task 3: Map Capture Source To LiveKit Options

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts:922-963`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts:3225-3252`

- [ ] **Step 1: Write failing hook tests for default window and auto behavior**

Replace the final existing `passes correct capture options to setScreenShareEnabled` test with these two tests:

```ts
  it('passes default window capture source to setScreenShareEnabled', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const settings = {
      captureAudio: true,
      systemAudio: true,
      resolution: '1080p' as const,
      fps: 30 as const,
      preferredCaptureSource: 'window' as const,
    };

    const { result } = renderHook(() => useScreenShare(undefined, settings));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.(liveKitToken('test-jwt'));
      await promise;
    });

    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, expect.objectContaining({
      audio: true,
      systemAudio: 'include',
      video: { displaySurface: 'window' },
      resolution: { width: 1920, height: 1080, frameRate: 30 },
      videoEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 },
    }));
  });

  it('omits display surface hint when preferred capture source is auto', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const settings = {
      captureAudio: false,
      systemAudio: false,
      resolution: '720p' as const,
      fps: 15 as const,
      preferredCaptureSource: 'auto' as const,
    };

    const { result } = renderHook(() => useScreenShare(undefined, settings));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.(liveKitToken('test-jwt'));
      await promise;
    });

    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, expect.not.objectContaining({
      video: expect.anything(),
    }));
    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, expect.objectContaining({
      resolution: { width: 1280, height: 720, frameRate: 15 },
      videoEncoding: { maxBitrate: 2_000_000, maxFramerate: 15 },
    }));
  });
```

- [ ] **Step 2: Run the focused hook tests to verify they fail**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/hooks/useScreenShare.test.ts
```

Expected: FAIL because `video.displaySurface` is not passed for the window case.

- [ ] **Step 3: Add the mapping implementation**

In `useScreenShare.ts`, after `captureOptions = {};` add:

```ts
        const displaySurfaceMap: Partial<Record<NonNullable<typeof screenShareSettings>['preferredCaptureSource'], 'window' | 'monitor' | 'browser'>> = {
          window: 'window',
          screen: 'monitor',
          browser: 'browser',
        };
        const displaySurface = displaySurfaceMap[screenShareSettings.preferredCaptureSource];
        if (displaySurface) {
          captureOptions.video = { displaySurface };
        }
```

The resulting block starts like this:

```ts
        captureOptions = {};

        const displaySurfaceMap: Partial<Record<NonNullable<typeof screenShareSettings>['preferredCaptureSource'], 'window' | 'monitor' | 'browser'>> = {
          window: 'window',
          screen: 'monitor',
          browser: 'browser',
        };
        const displaySurface = displaySurfaceMap[screenShareSettings.preferredCaptureSource];
        if (displaySurface) {
          captureOptions.video = { displaySurface };
        }

        if (screenShareSettings.captureAudio) {
          captureOptions.audio = true;
        }
```

- [ ] **Step 4: Run the focused hook tests to verify they pass**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/hooks/useScreenShare.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add "src/Brmble.Web/src/hooks/useScreenShare.ts" "src/Brmble.Web/src/hooks/useScreenShare.test.ts"
git commit -m "feat: pass preferred capture source to LiveKit"
```

## Task 4: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run frontend tests**

Run from `src/Brmble.Web`:

```powershell
npm run test
```

Expected: PASS.

- [ ] **Step 2: Run frontend type check**

Run from `src/Brmble.Web`:

```powershell
npm run type-check
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run from `src/Brmble.Web`:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Check git status**

Run from repo root:

```powershell
git status --short --branch
```

Expected: branch is `feature/livekit-broadcaster-controls`; only unrelated pre-existing untracked files may remain.

- [ ] **Step 5: Commit any verification-only fixes if needed**

If a verification command reveals a real issue caused by this work, fix the smallest relevant code or test change, rerun the failing command, and commit with:

```powershell
git add "src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx" "src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.tsx" "src/Brmble.Web/src/components/SettingsModal/ScreenShareSettingsTab.test.tsx" "src/Brmble.Web/src/hooks/useScreenShare.ts" "src/Brmble.Web/src/hooks/useScreenShare.test.ts"
git commit -m "fix: stabilize screen share capture source setting"
```

If all verification commands pass and there are no uncommitted changes from this work, do not create an empty commit.

## Self-Review

- Spec coverage: Task 1 covers the data model/default. Task 2 covers UI guide-compliant settings UI and help text. Task 3 covers LiveKit display-surface mapping and unsupported/ignored hints by relying on existing error behavior. Task 4 covers verification. Deferred game-window suggestion remains documented in the spec/roadmap and is intentionally not implemented.
- Placeholder scan: No placeholders, TODOs, or ambiguous implementation instructions remain.
- Type consistency: The property name is consistently `preferredCaptureSource`; allowed values are consistently `'auto' | 'window' | 'screen' | 'browser'`; LiveKit display-surface outputs are consistently `'window' | 'monitor' | 'browser'`.
