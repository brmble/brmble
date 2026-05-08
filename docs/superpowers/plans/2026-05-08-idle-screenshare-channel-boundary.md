# Idle Screenshare Channel Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idle leave, manual leave-voice, and manual channel switching enforce the same-channel screen share boundary while adding a 60-second pre-idle info notification.

**Architecture:** Keep idle decision logic in `useIdleActions`, but expose pre-leave and cancellation state so `App.tsx` can render notifications. Keep manual share-ending prompts in `App.tsx`, where channel switching and leave-voice actions already live. Use `leftVoiceChanged=true` as a cleanup safety net for watched and local shares.

**Tech Stack:** React + TypeScript + Vitest for frontend behavior tests; existing WebView bridge message names; no C# changes expected.

---

## File Structure

- Modify `src/Brmble.Web/src/hooks/useIdleActions.ts`: add a 60-second pre-leave info state, cancellation state, and optional auto-leave callback hook.
- Modify `src/Brmble.Web/src/hooks/useIdleActions.test.ts`: verify warning threshold, cancellation, lock behavior, and auto-leave callback ordering.
- Modify `src/Brmble.Web/src/App.tsx`: update manual prompts, render pre-idle/cancelled notifications, and stop sharing/watching on idle and left-voice cleanup.
- Modify `src/Brmble.Web/src/App.screenShareStart.test.ts`: add focused tests for manual prompts and cleanup paths.

---

### Task 1: Add Pre-Idle State To `useIdleActions`

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useIdleActions.ts`
- Modify: `src/Brmble.Web/src/hooks/useIdleActions.test.ts`

- [ ] **Step 1: Write failing tests for pre-idle notification state**

Add these tests to `src/Brmble.Web/src/hooks/useIdleActions.test.ts` inside `describe('useIdleActions', ...)`:

```ts
  it('shows pre-leave state sixty seconds before auto-leave', () => {
    const { result } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - 60,
      systemIdleSec: AFK_THRESHOLD_SEC - 60,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(bridge.send).not.toHaveBeenCalled();
    expect(result.current.preLeaveStartedAt).not.toBeNull();
    expect(result.current.preLeaveCancelledAt).toBeNull();
  });

  it('does not show pre-leave state when only one idle source reaches warning threshold', () => {
    const { result } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - 60,
      systemIdleSec: 0,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(result.current.preLeaveStartedAt).toBeNull();
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('turns pre-leave state into cancelled state when activity returns', () => {
    const { result, rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - 60,
      systemIdleSec: AFK_THRESHOLD_SEC - 60,
      isLocked: false,
      inVoiceChannel: true,
    });

    expect(result.current.preLeaveStartedAt).not.toBeNull();

    rerender({ brmbleIdleSec: 1, systemIdleSec: 1, isLocked: false, inVoiceChannel: true });

    expect(result.current.preLeaveStartedAt).toBeNull();
    expect(result.current.preLeaveCancelledAt).not.toBeNull();
  });

  it('dismissPreLeaveCancelled clears the cancellation notification state', () => {
    const { result, rerender } = render({
      brmbleIdleSec: AFK_THRESHOLD_SEC - 60,
      systemIdleSec: AFK_THRESHOLD_SEC - 60,
      isLocked: false,
      inVoiceChannel: true,
    });

    rerender({ brmbleIdleSec: 1, systemIdleSec: 1, isLocked: false, inVoiceChannel: true });

    expect(result.current.preLeaveCancelledAt).not.toBeNull();
    act(() => result.current.dismissPreLeaveCancelled());
    expect(result.current.preLeaveCancelledAt).toBeNull();
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test -- src/hooks/useIdleActions.test.ts
```

Expected: TypeScript/test failures because `preLeaveStartedAt`, `preLeaveCancelledAt`, and `dismissPreLeaveCancelled` do not exist.

- [ ] **Step 3: Implement minimal hook state**

Update `src/Brmble.Web/src/hooks/useIdleActions.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import bridge from '../bridge';

export const AFK_THRESHOLD_SEC = 10 * 60;
export const PRE_LEAVE_WARNING_SEC = 60;

interface UseIdleActionsArgs {
  brmbleIdleSec: number;
  systemIdleSec: number;
  isLocked: boolean;
  inVoiceChannel: boolean;
}

interface UseIdleActionsResult {
  /** Unix ms timestamp of the most recent auto-leave-voice fire, or null. */
  autoLeftAt: number | null;
  /** Unix ms timestamp for the current pre-leave notification, or null. */
  preLeaveStartedAt: number | null;
  /** Unix ms timestamp for the most recent cancelled pre-leave notification, or null. */
  preLeaveCancelledAt: number | null;
  /** Clear the post-auto-leave toast indicator. */
  dismissToast: () => void;
  /** Clear the cancelled pre-leave toast indicator. */
  dismissPreLeaveCancelled: () => void;
}

export function useIdleActions({
  brmbleIdleSec,
  systemIdleSec,
  isLocked,
  inVoiceChannel,
}: UseIdleActionsArgs): UseIdleActionsResult {
  const firedRef = useRef(false);
  const preLeaveShownRef = useRef(false);
  const [autoLeftAt, setAutoLeftAt] = useState<number | null>(null);
  const [preLeaveStartedAt, setPreLeaveStartedAt] = useState<number | null>(null);
  const [preLeaveCancelledAt, setPreLeaveCancelledAt] = useState<number | null>(null);

  useEffect(() => {
    if (!inVoiceChannel) {
      firedRef.current = false;
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      return;
    }

    const fullyIdle =
      isLocked ||
      (brmbleIdleSec >= AFK_THRESHOLD_SEC && systemIdleSec >= AFK_THRESHOLD_SEC);
    const nearingIdle =
      !isLocked &&
      brmbleIdleSec >= AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC &&
      systemIdleSec >= AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC;

    if (fullyIdle && !firedRef.current) {
      firedRef.current = true;
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      bridge.send('voice.leaveVoice', {});
      setAutoLeftAt(Date.now());
    } else if (!fullyIdle && firedRef.current) {
      firedRef.current = false;
    }

    if (!fullyIdle && nearingIdle && !preLeaveShownRef.current) {
      preLeaveShownRef.current = true;
      setPreLeaveCancelledAt(null);
      setPreLeaveStartedAt(Date.now());
    } else if (!fullyIdle && !nearingIdle && preLeaveShownRef.current) {
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      setPreLeaveCancelledAt(Date.now());
    }
  }, [brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel]);

  return {
    autoLeftAt,
    preLeaveStartedAt,
    preLeaveCancelledAt,
    dismissToast: () => setAutoLeftAt(null),
    dismissPreLeaveCancelled: () => setPreLeaveCancelledAt(null),
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npm run test -- src/hooks/useIdleActions.test.ts
```

Expected: all `useIdleActions` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useIdleActions.ts src/Brmble.Web/src/hooks/useIdleActions.test.ts
git commit -m "feat: add idle pre-leave state"
```

---

### Task 2: Let Idle Auto-Leave Stop Shares Before Leaving Voice

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useIdleActions.ts`
- Modify: `src/Brmble.Web/src/hooks/useIdleActions.test.ts`

- [ ] **Step 1: Write failing callback ordering test**

Change the local `render` helper in `src/Brmble.Web/src/hooks/useIdleActions.test.ts` to accept `onBeforeAutoLeave`:

```ts
  function render(props: {
    brmbleIdleSec: number;
    systemIdleSec: number;
    isLocked: boolean;
    inVoiceChannel: boolean;
    onBeforeAutoLeave?: () => void | Promise<void>;
  }) {
    return renderHook(({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave }) =>
      useIdleActions({ brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave }),
      { initialProps: props }
    );
  }
```

Add this test:

```ts
  it('runs auto-leave cleanup before sending leaveVoice', async () => {
    const order: string[] = [];
    vi.mocked(bridge.send).mockImplementation(() => {
      order.push('leave');
    });

    render({
      brmbleIdleSec: AFK_THRESHOLD_SEC,
      systemIdleSec: AFK_THRESHOLD_SEC,
      isLocked: false,
      inVoiceChannel: true,
      onBeforeAutoLeave: () => {
        order.push('cleanup');
      },
    });

    await Promise.resolve();

    expect(order).toEqual(['cleanup', 'leave']);
  });
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test -- src/hooks/useIdleActions.test.ts -t "runs auto-leave cleanup"
```

Expected: TypeScript failure because `onBeforeAutoLeave` is not accepted.

- [ ] **Step 3: Add callback support**

Update `UseIdleActionsArgs` in `src/Brmble.Web/src/hooks/useIdleActions.ts`:

```ts
interface UseIdleActionsArgs {
  brmbleIdleSec: number;
  systemIdleSec: number;
  isLocked: boolean;
  inVoiceChannel: boolean;
  onBeforeAutoLeave?: () => void | Promise<void>;
}
```

Update the function signature and fully-idle block:

```ts
export function useIdleActions({
  brmbleIdleSec,
  systemIdleSec,
  isLocked,
  inVoiceChannel,
  onBeforeAutoLeave,
}: UseIdleActionsArgs): UseIdleActionsResult {
```

Replace:

```ts
      bridge.send('voice.leaveVoice', {});
      setAutoLeftAt(Date.now());
```

with:

```ts
      void Promise.resolve(onBeforeAutoLeave?.()).finally(() => {
        bridge.send('voice.leaveVoice', {});
        setAutoLeftAt(Date.now());
      });
```

Update the `useEffect` dependency list:

```ts
  }, [brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave]);
```

- [ ] **Step 4: Run hook tests**

Run:

```bash
npm run test -- src/hooks/useIdleActions.test.ts
```

Expected: all hook tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useIdleActions.ts src/Brmble.Web/src/hooks/useIdleActions.test.ts
git commit -m "fix: clean up shares before idle leave"
```

---

### Task 3: Render Pre-Idle And Cancelled Notifications

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing App notification tests**

Add tests to `src/Brmble.Web/src/App.screenShareStart.test.ts` using the existing App test patterns in that file. Add module mock support for `useIdleActions` if the file already mocks hooks; otherwise use the existing bridge/event helpers to drive idle state. The expected assertions are:

```ts
expect(screen.getByText('Still there?')).toBeInTheDocument();
expect(screen.getByText("You'll leave voice soon due to inactivity.")).toBeInTheDocument();
```

Then simulate cancellation and assert:

```ts
expect(screen.getByText('Welcome back')).toBeInTheDocument();
expect(screen.getByText('Auto leave cancelled.')).toBeInTheDocument();
```

Use `vi.mock('./hooks/useIdleActions', ...)` only if the file already uses module-level mocks safely. Keep the test focused on App rendering notification state, not the hook threshold math already covered in Task 1.

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "Still there"
```

Expected: fails because App does not render the new notifications yet.

- [ ] **Step 3: Wire hook return values in App**

In `src/Brmble.Web/src/App.tsx`, change:

```ts
  const { autoLeftAt, dismissToast: dismissAutoLeftToast } = useIdleActions({
```

to:

```ts
  const {
    autoLeftAt,
    preLeaveStartedAt,
    preLeaveCancelledAt,
    dismissToast: dismissAutoLeftToast,
    dismissPreLeaveCancelled,
  } = useIdleActions({
```

Add notification registration effects near the existing `autoLeftAt` effect:

```ts
  useEffect(() => {
    if (preLeaveStartedAt !== null) {
      notifQueue.register('idle-pre-leave', 'info');
    }
  }, [preLeaveStartedAt]);

  useEffect(() => {
    if (preLeaveCancelledAt !== null) {
      notifQueue.unregister('idle-pre-leave');
      notifQueue.register('idle-pre-leave-cancelled', 'info');
    }
  }, [preLeaveCancelledAt]);
```

Add these notification blocks before the existing `autoLeftAt` notification block:

```tsx
        {preLeaveStartedAt !== null && notifQueue.isVisible('idle-pre-leave') && (
          <Notification
            status="info"
            position="top-right"
            visible={preLeaveStartedAt !== null}
            duration={60000}
            title="Still there?"
            detail="You'll leave voice soon due to inactivity."
            onDismiss={() => {
              notifQueue.unregister('idle-pre-leave');
            }}
            onExited={() => {
              notifQueue.unregister('idle-pre-leave');
            }}
          />
        )}
        {preLeaveCancelledAt !== null && notifQueue.isVisible('idle-pre-leave-cancelled') && (
          <Notification
            status="info"
            position="top-right"
            visible={preLeaveCancelledAt !== null}
            duration={5000}
            title="Welcome back"
            detail="Auto leave cancelled."
            onDismiss={() => {
              notifQueue.unregister('idle-pre-leave-cancelled');
              dismissPreLeaveCancelled();
            }}
            onExited={() => {
              notifQueue.unregister('idle-pre-leave-cancelled');
            }}
          />
        )}
```

- [ ] **Step 4: Run notification tests**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "Still there|Welcome back"
```

Expected: new App notification tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: show idle pre-leave notifications"
```

---

### Task 4: Update Manual Share Prompts To Block Move Or Leave On Cancel

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing tests for channel switch prompt**

Add tests that render App in a state where the local user is sharing in channel `1`, then trigger a join of channel `2`.

For cancel:

```ts
expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
  title: 'Screen share active',
  message: 'Moving to another channel will end your screen share. Move and stop sharing?',
  confirmLabel: 'Move',
  cancelLabel: 'Stay Here',
}));
expect(bridge.send).not.toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });
```

For confirm:

```ts
expect(stopSharingMock).toHaveBeenCalled();
expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });
```

- [ ] **Step 2: Write failing tests for leave-voice prompt**

Add tests that render App in a sharing state and trigger the leave voice button.

For cancel:

```ts
expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
  title: 'Screen share active',
  message: 'Leaving voice will end your screen share. Leave voice and stop sharing?',
  confirmLabel: 'Leave',
  cancelLabel: 'Stay Here',
}));
expect(bridge.send).not.toHaveBeenCalledWith('voice.leaveVoice', {});
```

For confirm:

```ts
expect(stopSharingMock).toHaveBeenCalled();
expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "screen share active"
```

Expected: failures because prompts still use old copy and cancellation still proceeds.

- [ ] **Step 4: Update `handleJoinChannel`**

In `src/Brmble.Web/src/App.tsx`, replace the sharing block in `handleJoinChannel` with:

```ts
    if (isSharing && sharingChannelId && String(channelId) !== sharingChannelId) {
      const shouldMove = await confirm({
        title: 'Screen share active',
        message: 'Moving to another channel will end your screen share. Move and stop sharing?',
        confirmLabel: 'Move',
        cancelLabel: 'Stay Here',
      });
      if (!shouldMove) {
        return;
      }
      await stopSharing();
      setSharingChannelId(undefined);
    }
```

- [ ] **Step 5: Update `handleLeaveVoice`**

In `src/Brmble.Web/src/App.tsx`, replace the sharing block in `handleLeaveVoice` with:

```ts
    if (isSharing) {
      const shouldLeave = await confirm({
        title: 'Screen share active',
        message: 'Leaving voice will end your screen share. Leave voice and stop sharing?',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay Here',
      });
      if (!shouldLeave) {
        return;
      }
      await stopSharing();
      setSharingChannelId(undefined);
    }
```

- [ ] **Step 6: Run prompt tests**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "screen share active"
```

Expected: prompt tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: require stopping share before leaving channel"
```

---

### Task 5: Stop Sharing And Watching During Idle Auto-Leave

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing idle cleanup test**

Add an App test where `useIdleActions` is mocked or driven to call `onBeforeAutoLeave`. Assert that before `voice.leaveVoice` is sent, App invokes the local share and viewer cleanup functions.

Expected assertion shape:

```ts
expect(stopSharingMock).toHaveBeenCalled();
expect(disconnectViewerMock).toHaveBeenCalled();
expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
```

If using a real hook-driven test, set both idle timers to `AFK_THRESHOLD_SEC` and await effects.

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "idle"
```

Expected: fails because App has not passed an idle cleanup callback to `useIdleActions`.

- [ ] **Step 3: Add an App cleanup callback**

In `src/Brmble.Web/src/App.tsx`, create this callback before calling `useIdleActions`:

```ts
  const stopSharesForVoiceExit = useCallback(async () => {
    disconnectViewerRef.current?.();
    if (isSharingRef.current) {
      await stopSharingRef.current?.();
    }
    setSharingChannelId(undefined);
    setScreenShareToast(null);
  }, []);
```

If `isSharingRef` or `stopSharingRef` do not exist, create refs near the existing screen share refs:

```ts
  const isSharingRef = useRef(false);
  const stopSharingRef = useRef<(() => Promise<void>) | null>(null);
```

Keep them current after `useScreenShare()` returns:

```ts
  isSharingRef.current = isSharing;
  stopSharingRef.current = stopSharing;
```

Pass the callback to `useIdleActions`:

```ts
  const {
    autoLeftAt,
    preLeaveStartedAt,
    preLeaveCancelledAt,
    dismissToast: dismissAutoLeftToast,
    dismissPreLeaveCancelled,
  } = useIdleActions({
    brmbleIdleSec,
    systemIdleSec: systemIdle,
    isLocked,
    inVoiceChannel: inVoiceChannelForIdle,
    onBeforeAutoLeave: stopSharesForVoiceExit,
  });
```

- [ ] **Step 4: Update post-idle notification copy**

Change the existing auto-leave notification detail in `src/Brmble.Web/src/App.tsx` to:

```tsx
detail="You were moved out of voice after inactivity. Screen sharing and watched streams were stopped."
```

- [ ] **Step 5: Run idle cleanup tests**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "idle"
```

Expected: idle cleanup tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: stop shares before idle leave voice"
```

---

### Task 6: Enforce Left-Voice Cleanup Safety Net

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing left-voice cleanup test**

Add an App test that simulates `bridge` receiving:

```ts
leftVoiceHandler?.({ leftVoice: true });
```

while local sharing or watching is active. Assert:

```ts
expect(stopSharingMock).toHaveBeenCalled();
expect(disconnectViewerMock).toHaveBeenCalled();
expect(screen.queryByText('Sharing')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "leftVoiceChanged"
```

Expected: fails because current handler only disconnects viewers and clears UI; it does not stop local sharing.

- [ ] **Step 3: Reuse the voice-exit cleanup callback**

In `src/Brmble.Web/src/App.tsx`, update the `onLeftVoiceChanged` handler block:

```ts
        if (d.leftVoice) {
          void stopSharesForVoiceExit();
          handleSelectServer();
        }
```

Remove duplicated lines in that block that directly call `disconnectViewerRef.current?.()`, `setSharingChannelId(undefined)`, and `setScreenShareToast(null)` if they are now covered by `stopSharesForVoiceExit`.

Ensure `stopSharesForVoiceExit` is defined before the effect that registers `onLeftVoiceChanged`, or wrap event registration in a way that captures it safely.

- [ ] **Step 4: Run left-voice cleanup tests**

Run:

```bash
npm run test -- src/App.screenShareStart.test.ts -t "leftVoiceChanged"
```

Expected: left-voice cleanup tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: clean up shares on leave voice state"
```

---

### Task 7: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
npm run test -- src/hooks/useIdleActions.test.ts src/App.screenShareStart.test.ts src/hooks/useScreenShare.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Build frontend**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 3: Build solution**

Run from repo root:

```bash
dotnet build
```

Expected: solution build succeeds.

- [ ] **Step 4: Manual smoke checklist**

Run two local clients and verify:

- sharing user cancelling channel move stays in current channel and keeps sharing
- sharing user confirming channel move stops share and moves
- sharing user cancelling leave-voice stays in channel and keeps sharing
- sharing user confirming leave-voice stops share and enters leave voice
- idle pre-leave notification appears after threshold minus 60 seconds when manually simulated or with shortened thresholds in a temporary local-only debug patch
- moving mouse during pre-leave changes notification to `Welcome back`
- idle auto-leave stops local sharing and watched streams

- [ ] **Step 5: Commit if verification required code/test adjustments**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify idle screenshare channel boundaries"
```

Only commit if Step 4 or verification required additional committed changes.

---

## Self-Review

- Spec coverage: manual prompts, idle pre-leave, cancellation notification, idle auto-stop, and left-voice safety net are each covered by a task.
- Placeholder scan: implementation details are concrete; App test setup may need adaptation to the existing test harness, but expected behavior and assertions are explicit.
- Type consistency: `preLeaveStartedAt`, `preLeaveCancelledAt`, `dismissPreLeaveCancelled`, `PRE_LEAVE_WARNING_SEC`, and `onBeforeAutoLeave` are introduced before use.
