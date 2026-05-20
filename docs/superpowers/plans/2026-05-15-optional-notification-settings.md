# Optional Notification Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Messages settings that let users globally suppress optional top-right notifications while preserving per-category choices.

**Architecture:** Extend `MessagesSettings` with a global opt-out and four per-category booleans. Add small pure helpers in `App.tsx` for effective notification checks, then gate registration/creation of the requested optional notifications while leaving critical/recovery/update notifications unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Brmble WebView bridge settings stored under `brmble-settings`.

---

## File Structure

- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`
  - Owns the Messages settings type, defaults, and UI controls.
  - Adds `Disable optional notifications` and category toggles.
- Create: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx`
  - Tests default labels and global override behavior without requiring the full settings modal.
- Modify: `src/Brmble.Web/src/App.tsx`
  - Adds pure helpers for optional notification settings.
  - Loads current message settings into App state from `settings.current` / `settings.updated`.
  - Gates only the requested optional top-right notifications.
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`
  - Tests pure helper behavior for optional settings and notification categories.
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
  - Adds integration tests around remote screen share notification registration and settings events.
- Modify: `src/Brmble.Web/src/App.chatMode.test.ts`
  - Adds unit coverage for ungated service warning behavior if helper placement changes expose useful gating assertions.
- Already modified: `docs/UI_GUIDE.md`, `CLAUDE.md`
  - Verify docs include guidance for future optional notification decisions.

## Task 1: Add Messages Settings Defaults And UI Tests

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx`
- Modify later: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`

- [ ] **Step 1: Write failing tests for optional notification settings UI**

Create `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx` with:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MESSAGES, MessagesSettingsTab, type MessagesSettings } from './MessagesSettingsTab';

describe('MessagesSettingsTab optional notifications', () => {
  it('defaults optional notification suppression off and individual categories on', () => {
    render(<MessagesSettingsTab settings={DEFAULT_MESSAGES} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Disable optional notifications')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeChecked();
    expect(screen.getByLabelText('Screen share status')).toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).toBeChecked();
    expect(screen.getByText('Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.')).toBeInTheDocument();
  });

  it('shows category toggles as off and disabled while preserving stored choices when global disable is on', () => {
    const onChange = vi.fn();
    const settings: MessagesSettings = {
      ...DEFAULT_MESSAGES,
      notificationIdleWarning: false,
    };

    const { rerender } = render(<MessagesSettingsTab settings={settings} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      notificationsDisabled: true,
    });

    rerender(<MessagesSettingsTab settings={{ ...settings, notificationsDisabled: true }} onChange={onChange} />);

    expect(screen.getByLabelText('Screen share invitations')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share status')).not.toBeChecked();
    expect(screen.getByLabelText('Idle reminders')).not.toBeChecked();
    expect(screen.getByLabelText('Channel move notices')).not.toBeChecked();
    expect(screen.getByLabelText('Screen share invitations')).toBeDisabled();
    expect(screen.getByLabelText('Idle reminders')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      notificationsDisabled: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/MessagesSettingsTab.test.tsx
```

Expected: FAIL because `notificationsDisabled` and category fields/labels do not exist yet.

- [ ] **Step 3: Commit failing test**

```bash
git add src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx
git commit -m "test: cover optional notification settings UI"
```

## Task 2: Implement Messages Settings UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`
- Test: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx`

- [ ] **Step 1: Extend `MessagesSettings` and defaults**

In `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`, replace the current interface/default notification field with:

```ts
export interface MessagesSettings {
  ttsEnabled: boolean;
  ttsVolume: number;
  ttsVoice: string;
  notificationsDisabled: boolean;
  notificationRemoteScreenShare: boolean;
  notificationScreenShareStatus: boolean;
  notificationIdleWarning: boolean;
  notificationMovedChannel: boolean;
}

export const DEFAULT_MESSAGES: MessagesSettings = {
  ttsEnabled: false,
  ttsVolume: 100,
  ttsVoice: '',
  notificationsDisabled: false,
  notificationRemoteScreenShare: true,
  notificationScreenShareStatus: true,
  notificationIdleWarning: true,
  notificationMovedChannel: true,
};
```

- [ ] **Step 2: Update the change handler type**

Keep the existing handler but ensure it works with the new keys:

```ts
const handleChange = (key: keyof MessagesSettings, value: boolean | number | string) => {
  let newSettings = { ...localSettings, [key]: value };
  if (key === 'ttsEnabled' && value === true && !localSettings.ttsVoice) {
    const ziraVoice = voices.find(v => v.name.includes('Zira'));
    if (ziraVoice) {
      newSettings = { ...newSettings, ttsVoice: ziraVoice.name };
    }
  }
  setLocalSettings(newSettings);
  onChange(newSettings);
};
```

- [ ] **Step 3: Replace the Notifications section JSX**

Replace lines 143-157 with this block:

```tsx
{/* Notifications Section */}
<div className="settings-section">
  <h3 className="heading-section settings-section-title">Notifications</h3>
  <div className="settings-item settings-toggle">
    <div>
      <label htmlFor="disable-optional-notifications">Disable optional notifications</label>
      <p className="settings-description">Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.</p>
    </div>
    <label className="brmble-toggle">
      <input
        id="disable-optional-notifications"
        type="checkbox"
        checked={localSettings.notificationsDisabled}
        onChange={(e) => handleChange('notificationsDisabled', e.target.checked)}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>

  <div className="settings-item settings-toggle">
    <label htmlFor="notification-remote-screen-share">Screen share invitations</label>
    <label className="brmble-toggle">
      <input
        id="notification-remote-screen-share"
        type="checkbox"
        checked={!localSettings.notificationsDisabled && localSettings.notificationRemoteScreenShare}
        disabled={localSettings.notificationsDisabled}
        onChange={(e) => handleChange('notificationRemoteScreenShare', e.target.checked)}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>

  <div className="settings-item settings-toggle">
    <label htmlFor="notification-screen-share-status">Screen share status</label>
    <label className="brmble-toggle">
      <input
        id="notification-screen-share-status"
        type="checkbox"
        checked={!localSettings.notificationsDisabled && localSettings.notificationScreenShareStatus}
        disabled={localSettings.notificationsDisabled}
        onChange={(e) => handleChange('notificationScreenShareStatus', e.target.checked)}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>

  <div className="settings-item settings-toggle">
    <label htmlFor="notification-idle-warning">Idle reminders</label>
    <label className="brmble-toggle">
      <input
        id="notification-idle-warning"
        type="checkbox"
        checked={!localSettings.notificationsDisabled && localSettings.notificationIdleWarning}
        disabled={localSettings.notificationsDisabled}
        onChange={(e) => handleChange('notificationIdleWarning', e.target.checked)}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>

  <div className="settings-item settings-toggle">
    <label htmlFor="notification-moved-channel">Channel move notices</label>
    <label className="brmble-toggle">
      <input
        id="notification-moved-channel"
        type="checkbox"
        checked={!localSettings.notificationsDisabled && localSettings.notificationMovedChannel}
        disabled={localSettings.notificationsDisabled}
        onChange={(e) => handleChange('notificationMovedChannel', e.target.checked)}
      />
      <span className="brmble-toggle-slider"></span>
    </label>
  </div>
</div>
```

- [ ] **Step 4: Run settings UI tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/MessagesSettingsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit settings UI implementation**

```bash
git add src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx
git commit -m "feat: add optional notification settings"
```

## Task 3: Add Pure Helpers For Optional Notification Checks

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`

- [ ] **Step 1: Write failing helper tests**

In `src/Brmble.Web/src/App.screenShareEnded.test.ts`, extend the import from `./App` to include:

```ts
  shouldShowOptionalNotification,
```

Add this test block before `describe('getScreenShareEndedNotification', () => {`:

```ts
describe('shouldShowOptionalNotification', () => {
  const enabledSettings = {
    notificationsDisabled: false,
    notificationRemoteScreenShare: true,
    notificationScreenShareStatus: true,
    notificationIdleWarning: true,
    notificationMovedChannel: true,
  };

  it('allows enabled categories when the global opt-out is off', () => {
    expect(shouldShowOptionalNotification(enabledSettings, 'notificationRemoteScreenShare')).toBe(true);
    expect(shouldShowOptionalNotification(enabledSettings, 'notificationScreenShareStatus')).toBe(true);
    expect(shouldShowOptionalNotification(enabledSettings, 'notificationIdleWarning')).toBe(true);
    expect(shouldShowOptionalNotification(enabledSettings, 'notificationMovedChannel')).toBe(true);
  });

  it('blocks every category when the global opt-out is on without changing category values', () => {
    expect(shouldShowOptionalNotification({
      ...enabledSettings,
      notificationsDisabled: true,
      notificationIdleWarning: false,
    }, 'notificationRemoteScreenShare')).toBe(false);
    expect(shouldShowOptionalNotification({
      ...enabledSettings,
      notificationsDisabled: true,
      notificationIdleWarning: false,
    }, 'notificationIdleWarning')).toBe(false);
  });

  it('blocks a single disabled category while allowing the others', () => {
    const settings = {
      ...enabledSettings,
      notificationIdleWarning: false,
    };

    expect(shouldShowOptionalNotification(settings, 'notificationIdleWarning')).toBe(false);
    expect(shouldShowOptionalNotification(settings, 'notificationMovedChannel')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareEnded.test.ts
```

Expected: FAIL because `shouldShowOptionalNotification` is not exported.

- [ ] **Step 3: Implement helper types and function**

In `src/Brmble.Web/src/App.tsx`, add this near the notification interfaces after `WatchedShareEndedNotification`:

```ts
export type OptionalNotificationCategory =
  | 'notificationRemoteScreenShare'
  | 'notificationScreenShareStatus'
  | 'notificationIdleWarning'
  | 'notificationMovedChannel';

export interface OptionalNotificationSettings {
  notificationsDisabled?: boolean;
  notificationRemoteScreenShare?: boolean;
  notificationScreenShareStatus?: boolean;
  notificationIdleWarning?: boolean;
  notificationMovedChannel?: boolean;
}

export const DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS: Required<OptionalNotificationSettings> = {
  notificationsDisabled: false,
  notificationRemoteScreenShare: true,
  notificationScreenShareStatus: true,
  notificationIdleWarning: true,
  notificationMovedChannel: true,
};

export function normalizeOptionalNotificationSettings(settings?: OptionalNotificationSettings | null): Required<OptionalNotificationSettings> {
  return {
    ...DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS,
    ...(settings ?? {}),
  };
}

export function shouldShowOptionalNotification(
  settings: OptionalNotificationSettings | null | undefined,
  category: OptionalNotificationCategory,
): boolean {
  const normalized = normalizeOptionalNotificationSettings(settings);
  return !normalized.notificationsDisabled && normalized[category];
}
```

- [ ] **Step 4: Run helper tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareEnded.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper implementation**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareEnded.test.ts
git commit -m "test: cover optional notification gating helpers"
```

## Task 4: Load Message Notification Settings In App

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing test that settings updates can suppress remote screen share notifications**

In `src/Brmble.Web/src/App.screenShareStart.test.ts`, add this test near the existing remote share toast tests before `toast watch does not connect as viewer from root selected channel`:

```ts
  it('does not register remote screen share notification when screen share invitations are disabled', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: false,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: true,
          },
        },
      });
    });

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    expect(notifQueue.register).not.toHaveBeenCalledWith('screen-share', 'info');
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts
```

Expected: FAIL because App does not read message notification settings yet.

- [ ] **Step 3: Add App state for optional notification settings**

In `App.tsx`, near other settings state around `overlaySettings`, add:

```ts
  const [optionalNotificationSettings, setOptionalNotificationSettings] = useState<Required<OptionalNotificationSettings>>(DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS);
  const optionalNotificationSettingsRef = useRef(optionalNotificationSettings);
```

Then add this effect near other ref sync effects:

```ts
  useEffect(() => {
    optionalNotificationSettingsRef.current = optionalNotificationSettings;
  }, [optionalNotificationSettings]);
```

- [ ] **Step 4: Update existing settings bridge handler to load message settings**

In the existing `handleSettingsCurrent` handler in `App.tsx`, update both settings event paths to normalize optional notification settings:

```ts
    const handleSettingsCurrent = (data: unknown) => {
      const d = data as { settings?: any } | undefined;
      if (d?.settings) {
        updatePttKeyFromSettings(d.settings);
        setOverlaySettings(normalizeOverlaySettings(d.settings.overlay ?? {}));
        setOptionalNotificationSettings(normalizeOptionalNotificationSettings(d.settings.messages));
      }
    };
```

In the fallback storage handler, after `setOverlaySettings(...)`, add:

```ts
          setOptionalNotificationSettings(normalizeOptionalNotificationSettings(settings.messages));
```

In the initial localStorage check, after `updatePttKeyFromSettings(settings);`, add:

```ts
          setOptionalNotificationSettings(normalizeOptionalNotificationSettings(settings.messages));
```

- [ ] **Step 5: Gate remote screen share registration**

In the `onRemoteShareStarted` handler around `App.tsx:3087`, wrap the existing set/register block:

```ts
      if (
        voiceChannelId != null
        && d.roomName === `channel-${voiceChannelId}`
        && d.sessionId !== selfUser?.session
        && shouldShowOptionalNotification(optionalNotificationSettingsRef.current, 'notificationRemoteScreenShare')
      ) {
        setScreenShareToast({ userName: d.userName, roomName: d.roomName, userId: d.userId, matrixUserId: d.matrixUserId });
        notifQueue.register('screen-share', 'info');
      }
```

- [ ] **Step 6: Run remote screen share tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit App settings load and remote share gate**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: gate screen share invitation notifications"
```

## Task 5: Gate Screen Share Status Notifications

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`

- [ ] **Step 1: Write failing helper tests for optional screen share status creation**

In `App.screenShareEnded.test.ts`, add these imports from `./App`:

```ts
  createOptionalQueuedScreenShareEndedNotification,
  createOptionalWatchedShareEndedNotification,
```

Add this describe block after `describe('getScreenShareEndedNotification', ...)`:

```ts
describe('optional screen share status notification helpers', () => {
  const disabledStatus = {
    notificationsDisabled: false,
    notificationRemoteScreenShare: true,
    notificationScreenShareStatus: false,
    notificationIdleWarning: true,
    notificationMovedChannel: true,
  };

  it('does not create local share-ended notifications when screen share status is disabled', () => {
    expect(createOptionalQueuedScreenShareEndedNotification('error', 1, disabledStatus)).toBeNull();
  });

  it('does not create watched share-ended notifications when screen share status is disabled', () => {
    expect(createOptionalWatchedShareEndedNotification({
      roomName: 'channel-1',
      userName: 'alice',
      userId: 10,
      matrixUserId: '@alice:test',
    }, 'unexpected', 1, disabledStatus)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareEnded.test.ts
```

Expected: FAIL because the optional helper functions are not exported.

- [ ] **Step 3: Implement optional helper wrappers**

In `App.tsx`, after `createQueuedScreenShareEndedNotification`, add:

```ts
export function createOptionalQueuedScreenShareEndedNotification(
  reason: LocalShareStopReason,
  sequence: number,
  settings: OptionalNotificationSettings | null | undefined,
): QueuedScreenShareEndedNotification | null {
  if (!shouldShowOptionalNotification(settings, 'notificationScreenShareStatus')) {
    return null;
  }

  return createQueuedScreenShareEndedNotification(reason, sequence);
}
```

After `createWatchedShareEndedNotification`, add:

```ts
export function createOptionalWatchedShareEndedNotification(
  share: ShareInfo,
  reason: WatchedShareEndReason,
  sequence: number,
  settings: OptionalNotificationSettings | null | undefined,
): WatchedShareEndedNotification | null {
  if (!shouldShowOptionalNotification(settings, 'notificationScreenShareStatus')) {
    return null;
  }

  return createWatchedShareEndedNotification(share, reason, sequence);
}
```

- [ ] **Step 4: Wire wrappers into App local/watched share handlers**

In `handleLocalShareEnded`, replace:

```ts
    const notification = replaceScreenShareEndedNotification(
      screenShareEndedNotificationRef.current,
      reason,
      nextScreenShareEndedNotificationIdRef.current++,
      notifQueue,
    );
```

with:

```ts
    if (screenShareEndedNotificationRef.current) {
      notifQueue.unregister(screenShareEndedNotificationRef.current.id);
    }
    const notification = createOptionalQueuedScreenShareEndedNotification(
      reason,
      nextScreenShareEndedNotificationIdRef.current++,
      optionalNotificationSettingsRef.current,
    );
```

In `handleWatchedShareEnded`, replace creation with:

```ts
    const notification = createOptionalWatchedShareEndedNotification(
      share,
      reason,
      nextWatchedShareEndedNotificationIdRef.current++,
      optionalNotificationSettingsRef.current,
    );
    if (!notification) return;
```

- [ ] **Step 5: Run screen share ended tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareEnded.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit screen share status gate**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareEnded.test.ts
git commit -m "feat: gate screen share status notifications"
```

## Task 6: Gate Idle Reminder And Channel Move Notifications

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `App.screenShareStart.test.ts`, add this test near other idle tests:

```ts
  it('does not register idle pre-leave notification when idle reminders are disabled', () => {
    idleActionsState.preLeaveStartedAt = 1234;

    render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: false,
            notificationMovedChannel: true,
          },
        },
      });
    });

    expect(notifQueue.register).not.toHaveBeenCalledWith('idle-pre-leave', 'info');
  });
```

Add this test near channel move tests:

```ts
  it('does not register moved channel notification when channel move notices are disabled', () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: false,
          },
        },
      });
    });

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 2, name: 'Gaming', actorName: 'Moderator' });
    });

    expect(notifQueue.register).not.toHaveBeenCalledWith(expect.stringMatching(/^moved-channel-/), 'info');
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts
```

Expected: FAIL because idle and moved-channel registrations are not gated.

- [ ] **Step 3: Gate idle pre-leave registration**

In the `preLeaveStartedAt` effect around `App.tsx:1042`, change the condition to:

```ts
    if (
      preLeaveStartedAt !== null
      && shouldShowOptionalNotification(optionalNotificationSettingsRef.current, 'notificationIdleWarning')
    ) {
      notifQueue.register('idle-pre-leave', 'info');
    } else {
      notifQueue.unregister('idle-pre-leave');
    }
```

Also update render condition around `App.tsx:3719`:

```tsx
        {preLeaveStartedAt !== null && shouldShowOptionalNotification(optionalNotificationSettings, 'notificationIdleWarning') && notifQueue.isVisible('idle-pre-leave') && (
```

- [ ] **Step 4: Gate moved-channel registration**

Around the `setMovedChannelNotification(notification);` path, only create/register when enabled:

```ts
          if (shouldShowOptionalNotification(optionalNotificationSettingsRef.current, 'notificationMovedChannel')) {
            const notification = {
              id: `moved-channel-${nextMovedChannelNotificationIdRef.current++}`,
              ...getMovedChannelNotification({
                actorName: d.actorName,
                previousChannelName,
                channelName,
                movedToRoot: channelId === 0,
                wasSharing,
              }),
            };
            setMovedChannelNotification(notification);
            movedChannelNotificationRef.current = notification;
            notifQueue.register(notification.id, notification.status);
          }
```

Keep the existing sharing teardown behavior unchanged outside this gate.

- [ ] **Step 5: Run App notification tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit idle and channel move gates**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: gate idle and channel move notifications"
```

## Task 7: Clear Stale Optional Notifications When Settings Change

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing stale-clearing test**

In `App.screenShareStart.test.ts`, add:

```ts
  it('clears visible optional screen share notification when global disable is enabled', () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'screen-share');

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    expect(screen.getByText('Alice started sharing their screen')).toBeInTheDocument();

    act(() => {
      bridge.emit('settings.updated', {
        settings: {
          messages: {
            notificationsDisabled: true,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: true,
          },
        },
      });
    });

    expect(notifQueue.unregister).toHaveBeenCalledWith('screen-share');
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify failure**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts
```

Expected: FAIL because settings changes do not clear visible optional notifications.

- [ ] **Step 3: Add stale clearing effect**

In `App.tsx`, after optional notification settings ref sync, add:

```ts
  useEffect(() => {
    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationRemoteScreenShare')) {
      setScreenShareToast(null);
      notifQueue.unregister('screen-share');
    }
    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationScreenShareStatus')) {
      if (screenShareEndedNotificationRef.current) {
        notifQueue.unregister(screenShareEndedNotificationRef.current.id);
        screenShareEndedNotificationRef.current = null;
      }
      setScreenShareEndedNotification(null);
      watchedShareEndedNotifications.forEach(notification => notifQueue.unregister(notification.id));
      setWatchedShareEndedNotifications([]);
    }
    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationIdleWarning')) {
      notifQueue.unregister('idle-pre-leave');
    }
    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationMovedChannel')) {
      if (movedChannelNotificationRef.current) {
        notifQueue.unregister(movedChannelNotificationRef.current.id);
        movedChannelNotificationRef.current = null;
      }
      setMovedChannelNotification(null);
    }
  }, [optionalNotificationSettings, notifQueue, watchedShareEndedNotifications]);
```

If this causes a render loop because `notifQueue` identity changes, follow the existing file pattern by omitting `notifQueue` from dependencies with an explanatory eslint-disable comment, as nearby effects already do.

- [ ] **Step 4: Run App notification tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit stale clearing**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: clear disabled optional notifications"
```

## Task 8: Verify Docs And Full Frontend

**Files:**
- Verify: `docs/UI_GUIDE.md`
- Verify: `CLAUDE.md`
- Verify: `docs/superpowers/specs/2026-05-15-optional-notification-settings-design.md`

- [ ] **Step 1: Confirm docs mention optional notification decisions**

Read `docs/UI_GUIDE.md` section 13 and confirm it includes:

```md
Should users be able to disable it?
```

Read `CLAUDE.md` UI Development Rules and confirm it includes:

```md
Notification rules, including when repeatable top-right notifications should respect optional notification settings
```

- [ ] **Step 2: Run targeted tests**

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/MessagesSettingsTab.test.tsx src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts src/App.chatMode.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run from `src/Brmble.Web`:

```bash
npm run build
```

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 4: Check git status**

Run from repo root:

```bash
git status --short --branch
```

Expected: branch `feature/notification-settings`; only intended files modified plus pre-existing unrelated untracked files.

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md docs/UI_GUIDE.md docs/superpowers/specs/2026-05-15-optional-notification-settings-design.md docs/superpowers/plans/2026-05-15-optional-notification-settings.md
git commit -m "docs: document optional notification settings"
```

If previous task commits already included docs, skip this commit and report that no docs commit is needed.

---

## Self-Review

Spec coverage:
- Global opt-out with preserved category choices: Task 1 and Task 2.
- Four requested category toggles: Task 2.
- Effective settings helper and App loading: Task 3 and Task 4.
- Remote screen share invitations: Task 4.
- Local/watched screen share status: Task 5.
- Idle reminders: Task 6.
- Channel move notices: Task 6.
- Clear stale optional notifications: Task 7.
- Critical/one-time notifications left ungated: Task 3 helper tests plus Task 8 targeted checks; implementation avoids gates for those render paths.
- Contributor guidance: already updated docs verified in Task 8.

Placeholder scan: no placeholder tasks remain. Each code-writing step includes concrete code or exact replacement guidance.

Type consistency: plan consistently uses `notificationsDisabled`, `notificationRemoteScreenShare`, `notificationScreenShareStatus`, `notificationIdleWarning`, and `notificationMovedChannel`.
