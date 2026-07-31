# Brmble Service Temporary Chat Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn users when Brmble services are unavailable during an active voice session and mark channel chat as temporary until Brmble and Matrix chat recover.

**Architecture:** Add small pure helpers in `App.tsx` to derive service outage and temporary chat state from the existing `ServiceStatusMap`. Use those helpers in `App` to pass the existing `ChatPanel.topNotice` prop and to control one warning notification through the existing `Notification` and `useNotificationQueue` framework.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing Brmble Web notification and chat panel components.

---

## File Structure

- Modify `src/Brmble.Web/src/App.tsx`: add exported helper functions/constants, derive temporary chat state, pass `topNotice` to the channel `ChatPanel`, and render the Brmble service warning notification.
- Modify `src/Brmble.Web/src/App.chatMode.test.ts`: add Vitest coverage for outage detection, temporary chat banner conditions, and notification visibility gating.

---

### Task 1: Add Pure Status Helpers

**Files:**
- Modify: `src/Brmble.Web/src/App.chatMode.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Write failing tests for outage and banner state**

Replace the import in `src/Brmble.Web/src/App.chatMode.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  isBrmbleServiceOutageActive,
  isMatrixChannelChatActive,
  isTemporaryChannelChatActive,
  shouldShowBrmbleServiceWarningNotification,
} from './App';
import type { ServiceStatusMap } from './types';
import type { MatrixCredentials } from './hooks/useMatrixClient';
```

Append these tests to `src/Brmble.Web/src/App.chatMode.test.ts`:

```ts
describe('isBrmbleServiceOutageActive', () => {
  it('is false when voice, Brmble, and Matrix chat are connected', () => {
    expect(isBrmbleServiceOutageActive(connectedStatuses)).toBe(false);
  });

  it('is true when voice remains connected but Brmble is reconnecting', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(true);
  });

  it('is true when voice remains connected but Matrix chat is disconnected', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      chat: { state: 'disconnected' },
    })).toBe(true);
  });

  it('is false when voice is not connected', () => {
    expect(isBrmbleServiceOutageActive({
      ...connectedStatuses,
      voice: { state: 'disconnected' },
      server: { state: 'connecting' },
    })).toBe(false);
  });
});

describe('isTemporaryChannelChatActive', () => {
  it('is true for a normal channel during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('1', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(true);
  });

  it('is false for server root during a Brmble service outage', () => {
    expect(isTemporaryChannelChatActive('server-root', {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(false);
  });

  it('is false when no channel is selected', () => {
    expect(isTemporaryChannelChatActive(undefined, {
      ...connectedStatuses,
      server: { state: 'connecting' },
    })).toBe(false);
  });

  it('is false when Brmble and Matrix chat are connected', () => {
    expect(isTemporaryChannelChatActive('1', connectedStatuses)).toBe(false);
  });
});

describe('shouldShowBrmbleServiceWarningNotification', () => {
  it('shows the notification during a new outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, false)).toBe(true);
  });

  it('does not re-show the notification after the user dismissed it during the same outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(true, true)).toBe(false);
  });

  it('does not show the notification when there is no outage', () => {
    expect(shouldShowBrmbleServiceWarningNotification(false, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `src/Brmble.Web`:

```bash
npm test -- App.chatMode.test.ts
```

Expected: FAIL because `isBrmbleServiceOutageActive`, `isTemporaryChannelChatActive`, and `shouldShowBrmbleServiceWarningNotification` are not exported from `App.tsx` yet.

- [ ] **Step 3: Add the minimal helper implementation**

In `src/Brmble.Web/src/App.tsx`, near `isMatrixChannelChatActive`, add:

```ts
export const BRMBLE_SERVICE_WARNING_ID = 'brmble-service-disconnected';

export const BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE =
  'Brmble services are currently unavailable. You can keep talking in voice chat, but new chat messages are temporary and will not be saved.';

export const BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION = {
  id: BRMBLE_SERVICE_WARNING_ID,
  status: 'warning' as const,
  title: 'Brmble services disconnected',
  detail: 'Voice chat is still online. Brmble features are unavailable, and chat messages sent now are temporary and will not be saved.',
};

export function isBrmbleServiceOutageActive(statuses: ServiceStatusMap): boolean {
  return statuses.voice.state === 'connected'
    && (statuses.server.state !== 'connected' || statuses.chat.state !== 'connected');
}

export function isTemporaryChannelChatActive(
  channelId: string | undefined,
  statuses: ServiceStatusMap,
): boolean {
  if (!channelId || channelId === 'server-root') return false;
  return isBrmbleServiceOutageActive(statuses);
}

export function shouldShowBrmbleServiceWarningNotification(
  brmbleServiceOutageActive: boolean,
  dismissedForCurrentOutage: boolean,
): boolean {
  return brmbleServiceOutageActive && !dismissedForCurrentOutage;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run from `src/Brmble.Web`:

```bash
npm test -- App.chatMode.test.ts
```

Expected: PASS for `App.chatMode.test.ts`.

- [ ] **Step 5: Commit the helper tests and implementation**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts
git commit -m "test: cover brmble temporary chat state"
```

---

### Task 2: Show the Temporary Chat Banner

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Derive the banner state in `App`**

In `src/Brmble.Web/src/App.tsx`, after the existing `isMatrixActive` calculation, add:

```ts
  const brmbleTemporaryChatActive = isTemporaryChannelChatActive(activeChannelId, statuses);
```

The surrounding block should look like:

```ts
  const selfUserForChat = users.find(u => u.self);
  const isMatrixActive = activeChannelId
    ? isMatrixChannelChatActive(activeChannelId, matrixCredentials, statuses, selfUserForChat)
    : false;
  const brmbleTemporaryChatActive = isTemporaryChannelChatActive(activeChannelId, statuses);
  const matrixMessages = activeChannelId
    ? matrixClient.activeMessages
    : undefined;
```

- [ ] **Step 2: Pass the top notice to the channel chat panel**

In the channel `ChatPanel` props in `src/Brmble.Web/src/App.tsx`, add:

```tsx
                    topNotice={brmbleTemporaryChatActive ? BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE : undefined}
```

The channel `ChatPanel` block should include:

```tsx
                    users={users}
                    topNotice={brmbleTemporaryChatActive ? BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE : undefined}
                    onMessageContextMenu={handleChatMessageContextMenu}
```

- [ ] **Step 3: Run the focused chat mode test**

Run from `src/Brmble.Web`:

```bash
npm test -- App.chatMode.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the banner implementation**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: show temporary chat banner during brmble outage"
```

---

### Task 3: Show and Clear the Brmble Service Warning Notification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add notification state and outage dismissal tracking**

In `src/Brmble.Web/src/App.tsx`, near the existing notification state around `serverRemovalNotification`, add:

```ts
  const [brmbleServiceWarningNotification, setBrmbleServiceWarningNotification] = useState<typeof BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION | null>(null);
  const brmbleServiceWarningDismissedForOutageRef = useRef(false);
```

The nearby state should look like:

```ts
  const [movedChannelNotification, setMovedChannelNotification] = useState<QueuedMovedChannelNotification | null>(null);
  const [serverRemovalNotification, setServerRemovalNotification] = useState<ServerRemovalNotification | null>(null);
  const [brmbleServiceWarningNotification, setBrmbleServiceWarningNotification] = useState<typeof BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION | null>(null);
  const brmbleServiceWarningDismissedForOutageRef = useRef(false);
```

- [ ] **Step 2: Derive outage notification state**

In `src/Brmble.Web/src/App.tsx`, after `brmbleTemporaryChatActive`, add:

```ts
  const brmbleServiceOutageActive = isBrmbleServiceOutageActive(statuses);
```

The block should look like:

```ts
  const brmbleTemporaryChatActive = isTemporaryChannelChatActive(activeChannelId, statuses);
  const brmbleServiceOutageActive = isBrmbleServiceOutageActive(statuses);
```

- [ ] **Step 3: Add lifecycle effect for warning registration and recovery cleanup**

In `src/Brmble.Web/src/App.tsx`, near the existing notification registration effects, add:

```ts
  useEffect(() => {
    if (shouldShowBrmbleServiceWarningNotification(
      brmbleServiceOutageActive,
      brmbleServiceWarningDismissedForOutageRef.current,
    )) {
      setBrmbleServiceWarningNotification(BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION);
      notifQueue.register(BRMBLE_SERVICE_WARNING_ID, 'warning');
      return;
    }

    if (!brmbleServiceOutageActive) {
      brmbleServiceWarningDismissedForOutageRef.current = false;
      setBrmbleServiceWarningNotification(null);
      notifQueue.unregister(BRMBLE_SERVICE_WARNING_ID);
    }
  }, [brmbleServiceOutageActive, notifQueue]);
```

This effect makes a new outage show one warning, respects dismissal during the same outage, and clears stale warnings after recovery.

- [ ] **Step 4: Render the warning notification**

In the `.notification-stack` in `src/Brmble.Web/src/App.tsx`, add this block before lower-priority info notifications:

```tsx
        {brmbleServiceWarningNotification && notifQueue.isVisible(brmbleServiceWarningNotification.id) && (
          <Notification
            status={brmbleServiceWarningNotification.status}
            position="top-right"
            visible={!!brmbleServiceWarningNotification}
            title={brmbleServiceWarningNotification.title}
            detail={brmbleServiceWarningNotification.detail}
            onDismiss={() => {
              brmbleServiceWarningDismissedForOutageRef.current = true;
              notifQueue.unregister(brmbleServiceWarningNotification.id);
              setBrmbleServiceWarningNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister(brmbleServiceWarningNotification.id);
            }}
          />
        )}
```

- [ ] **Step 5: Run the focused chat mode test**

Run from `src/Brmble.Web`:

```bash
npm test -- App.chatMode.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the notification implementation**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: warn when brmble services disconnect"
```

---

### Task 4: Verify the Frontend

**Files:**
- Verify: `src/Brmble.Web/src/App.tsx`
- Verify: `src/Brmble.Web/src/App.chatMode.test.ts`

- [ ] **Step 1: Run all frontend tests**

Run from `src/Brmble.Web`:

```bash
npm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 2: Run the frontend build**

Run from `src/Brmble.Web`:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Commit any verification-only fixes**

If tests or build require small fixes, commit only the files changed for those fixes:

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts
git commit -m "fix: stabilize brmble outage warning state"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: Task 1 covers derived temporary chat and notification gating; Task 2 covers the non-dismissible chat panel message; Task 3 covers the warning notification and cleanup on recovery; Task 4 covers frontend verification.
- Placeholder scan: No placeholders remain in the plan; every code-changing step includes concrete code.
- Type consistency: Helper names, constants, notification IDs, and status types match across tests and implementation steps.
