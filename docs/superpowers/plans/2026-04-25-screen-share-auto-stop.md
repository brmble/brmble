# Screen Share Auto-Stop Implementation Plan

> **Historical note:** This implementation plan is retained as an implemented historical record for the shipped fix. The task-by-task checklist body below is intentionally preserved as the original implementation record.

**Goal:** Automatically stop local screen sharing when the captured source ends externally, classify the stop reason for sharer-only notifications, and keep viewer cleanup silent and reliable.

**Architecture:** Keep `useScreenShare` as the single owner of local share lifecycle and introduce one idempotent local stop pipeline that handles `manual`, `source-closed`, `interrupted`, and `error` reasons. Expose just enough reasoned signal to `App.tsx` so the sharer can get the correct notification copy while remote viewers continue to rely on the existing `livekit.shareStopped` cleanup path.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, LiveKit client, existing notification queue + notification component

> **Status note:** Implemented. This plan is kept as a historical implementation record for the shipped fix, including the preserved task-by-task checklist.

---

## File Map

- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: add reason-aware, idempotent local stop handling and capture lifecycle listeners.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: lock down manual, source-closed, interrupted, and duplicate-stop behavior.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: consume the reasoned share-end signal and show sharer-only notifications with the approved copy.

### Task 1: Make Local Screen Share Stop Reason-Aware And Idempotent

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Add a failing test for manual stop remaining notification-free and still sending one stop event**

Add a reason callback to the hook API in the test first, then assert manual stop reports `manual` and emits `livekit.shareStopped` once.

```ts
it('classifies manual stop as manual and emits shareStopped once', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  const onShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, onShareEnded));

  await act(async () => {
    const promise = result.current.startSharing('channel-1');
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
    await promise;
  });

  await act(async () => {
    await result.current.stopSharing();
  });

  expect(onShareEnded).toHaveBeenCalledWith({ reason: 'manual', roomName: 'channel-1' });
  expect(bridge.send).toHaveBeenCalledWith('livekit.shareStopped', { roomName: 'channel-1' });
  expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the single manual-stop test and confirm it fails**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "classifies manual stop as manual and emits shareStopped once"`

Expected: FAIL because `useScreenShare` does not yet accept or call an `onShareEnded` callback.

- [ ] **Step 3: Add the minimal stop-reason types and callback plumbing in `useScreenShare.ts`**

Introduce explicit local stop reasons and thread an `onShareEnded` callback into the hook signature.

```ts
export type LocalShareStopReason = 'manual' | 'source-closed' | 'interrupted' | 'error';

export interface LocalShareEndedEvent {
  reason: LocalShareStopReason;
  roomName?: string;
}

export function useScreenShare(
  onDisconnected?: () => void,
  screenShareSettings?: ScreenShareSettings,
  onShareEnded?: (event: LocalShareEndedEvent) => void,
) {
  const onShareEndedRef = useRef(onShareEnded);
  onShareEndedRef.current = onShareEnded;
```

- [ ] **Step 4: Add a single idempotent local stop pipeline in `useScreenShare.ts`**

Create one internal function that owns all local-share teardown side effects.

```ts
const localShareStopInFlightRef = useRef(false);
const localShareTrackCleanupRef = useRef<(() => void) | null>(null);

const finishLocalShare = useCallback(async (reason: LocalShareStopReason, options?: { disableCapture?: boolean }) => {
  if (localShareStopInFlightRef.current) return;
  localShareStopInFlightRef.current = true;

  const room = roomRef.current;
  const roomName = room?.name;

  try {
    localShareTrackCleanupRef.current?.();
    localShareTrackCleanupRef.current = null;

    if (options?.disableCapture !== false && room) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch {
        // already stopped externally
      }
    }

    isSharingRef.current = false;
    setIsSharing(false);

    if (roomName) {
      bridge.send('livekit.shareStopped', { roomName });
    }

    onShareEndedRef.current?.({ reason, roomName });
    await maybeDisconnectRoom();
  } finally {
    localShareStopInFlightRef.current = false;
  }
}, [maybeDisconnectRoom]);
```

- [ ] **Step 5: Rewire `stopSharing()` to use the shared pipeline and make the manual-stop test pass**

```ts
const stopSharing = useCallback(async () => {
  if (!isSharingRef.current && !roomRef.current) {
    setIsSharing(false);
    return;
  }
  await finishLocalShare('manual');
}, [finishLocalShare]);
```

- [ ] **Step 6: Run the single manual-stop test again and confirm it passes**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "classifies manual stop as manual and emits shareStopped once"`

Expected: PASS.

- [ ] **Step 7: Add failing tests for external source end, interrupted disconnect, and duplicate event races**

Extend the mocked local participant so the test can trigger a fake local screen-share track `ended` event.

```ts
it('classifies external track end as source-closed', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let endedHandler: (() => void) | null = null;
  mockRoom.localParticipant.getTrackPublication = vi.fn(() => ({
    track: {
      mediaStreamTrack: {
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'ended') endedHandler = handler;
        }),
        removeEventListener: vi.fn(),
      },
    },
  }));

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  const onShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, onShareEnded));

  await act(async () => {
    const promise = result.current.startSharing('channel-1');
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
    await promise;
  });

  act(() => {
    endedHandler?.();
  });

  expect(onShareEnded).toHaveBeenCalledWith({ reason: 'source-closed', roomName: 'channel-1' });
});

it('classifies room disconnect while sharing as interrupted', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let disconnectedHandler: (() => void) | null = null;
  (mockRoom.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: () => void) => {
    if (event === 'disconnected') disconnectedHandler = handler;
    return mockRoom;
  });

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  const onShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, onShareEnded));

  await act(async () => {
    const promise = result.current.startSharing('channel-1');
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
    await promise;
  });

  act(() => {
    disconnectedHandler?.();
  });

  expect(onShareEnded).toHaveBeenCalledWith({ reason: 'interrupted', roomName: 'channel-1' });
});

it('emits stop and share-ended callback only once when ended and disconnect race', async () => {
  expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(1);
  expect(onShareEnded).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 8: Run the targeted hook tests and confirm they fail for the right reasons**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "source-closed|interrupted|only once"`

Expected: FAIL because `startSharing()` does not yet register local capture lifecycle listeners and `RoomEvent.Disconnected` does not yet classify local interruption.

- [ ] **Step 9: Register capture-end listeners after local screen share starts**

Use the actual local share publication if available, and listen for the underlying media-track end event.

```ts
const registerLocalShareLifecycle = useCallback((room: Room, roomName: string) => {
  const publication = room.localParticipant.getTrackPublication?.(Track.Source.ScreenShare);
  const mediaTrack = publication?.track?.mediaStreamTrack;
  if (!mediaTrack) return;

  const handleEnded = () => {
    if (!isSharingRef.current) return;
    void finishLocalShare('source-closed', { disableCapture: false });
  };

  mediaTrack.addEventListener?.('ended', handleEnded);
  localShareTrackCleanupRef.current = () => {
    mediaTrack.removeEventListener?.('ended', handleEnded);
  };
}, [finishLocalShare]);
```

- [ ] **Step 10: Call the lifecycle registration from `startSharing()`**

```ts
await room.localParticipant.setScreenShareEnabled(true, captureOptions);
isSharingRef.current = true;
setIsSharing(true);
registerLocalShareLifecycle(room, roomName);
bridge.send('livekit.shareStarted', { roomName });
```

- [ ] **Step 11: Make `RoomEvent.Disconnected` fall back to `interrupted` only when a local share was still active**

```ts
room.on(RoomEvent.Disconnected, () => {
  const wasSharing = isSharingRef.current;
  roomRef.current = null;
  setRemoteVideoEls(new Map());
  updateWatchingShares([]);
  setFocusedShare(null);

  if (wasSharing) {
    isSharingRef.current = false;
    setIsSharing(false);
    onDisconnectedRef.current?.();
    onShareEndedRef.current?.({ reason: 'interrupted', roomName: room.name });
  }
});
```

Then refactor this to reuse the same guard state as `finishLocalShare`, so disconnect and track-end races cannot double-fire.

- [ ] **Step 12: Run the full hook test file and confirm it passes**

Run: `npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS with all existing tests plus the new reason/idempotency tests green.

### Task 2: Show Sharer Notifications For Non-Manual Share Endings

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify if needed: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write a failing component-level test or extract a small pure mapper for notification copy**

Prefer a small pure mapper in `App.tsx` test scope if that keeps the change narrow.

```ts
type ShareEndedNotice = {
  title: string;
  detail: string;
};

function getScreenShareEndedNotice(reason: 'source-closed' | 'interrupted' | 'error'): ShareEndedNotice {
  switch (reason) {
    case 'source-closed':
      return { title: 'Share ended', detail: 'The shared window or program was closed.' };
    case 'interrupted':
      return { title: 'Share ended', detail: 'The share ended due to an unexpected technical reason.' };
    case 'error':
      return { title: 'Share ended', detail: 'The share could not continue because of a technical error.' };
  }
}
```

- [ ] **Step 2: Run the new notification-copy test and confirm it fails**

Run: `npm run test -- src/App.test.tsx -t "Share ended"`

Expected: FAIL if the helper or test does not yet exist.

- [ ] **Step 3: Add minimal App state for local share-ended notifications**

Add local state separate from the existing remote `screenShareToast`.

```ts
const [screenShareEndedNotification, setScreenShareEndedNotification] = useState<{
  title: string;
  detail: string;
} | null>(null);
```

- [ ] **Step 4: Pass the new share-ended callback into `useScreenShare()`**

```ts
const { isSharing, startSharing, stopSharing, error: screenShareError, activeShare, activeShares, watchingShares, focusedShare, setFocusedShare, remoteVideoEls, disconnectViewer, connectAsViewer } = useScreenShare(
  () => {
    setSharingChannelId(undefined);
  },
  screenShareSettings,
  (event) => {
    if (event.reason === 'manual') return;

    const notice = getScreenShareEndedNotice(event.reason === 'error' ? 'error' : event.reason);
    setScreenShareEndedNotification(notice);
    notifQueue.register('screen-share-ended', event.reason === 'error' ? 'error' : 'info');
    setSharingChannelId(undefined);
  },
);
```

- [ ] **Step 5: Render the sharer-only notification in the existing notification stack**

Use the standard `Notification` component and existing notification queue behavior.

```tsx
{screenShareEndedNotification && notifQueue.isVisible('screen-share-ended') && (
  <Notification
    visible={!!screenShareEndedNotification}
    status="info"
    title={screenShareEndedNotification.title}
    detail={screenShareEndedNotification.detail}
    duration={5000}
    onDismiss={() => {
      setScreenShareEndedNotification(null);
      notifQueue.unregister('screen-share-ended');
    }}
  />
)}
```

Keep `manual` silent by never creating this notification.

- [ ] **Step 6: Run the App notification test and confirm it passes**

Run: `npm run test -- src/App.test.tsx -t "Share ended"`

Expected: PASS.

### Task 3: Full Regression Verification

**Files:**
- Modify if needed: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify if needed: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Run the screen-share hook tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS.

- [ ] **Step 2: Run any App-level notification tests added in Task 2**

Run: `npm run test -- src/App.test.tsx`

Expected: PASS for the new notification coverage.

- [ ] **Step 3: Run the sidebar regression tests to make sure the current branch work still passes**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx src/components/Sidebar/Sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run a production web build**

Run: `npm run build`

Expected: PASS with no TypeScript or Vite build failures.

- [ ] **Step 5: Perform manual verification**

Manual checklist:

```text
1. Share a specific application window.
2. Close that window with X or Ctrl+F4.
3. Verify the sharer sees 'Share ended' with detail explaining the shared window/program was closed.
4. Verify viewers silently lose the feed.
5. Start sharing again and use Brmble's manual stop.
6. Verify no sharer notification appears.
7. Use the browser stop-sharing control.
8. Verify no sharer notification appears.
9. Simulate or observe an interruption path (for example app-close while sharing).
10. Verify the sharer gets the technical-reason 'Share ended' notification if the app remains alive to display it.
```

## Self-Review

- Spec coverage: Task 1 covers stop reasons, capture-end listeners, disconnect fallback, and idempotency. Task 2 covers sharer-only notification mapping and manual-stop silence. Task 3 covers regression verification.
- Placeholder scan: all tasks include specific file paths, commands, and concrete code snippets for the key changes.
- Type consistency: the plan uses one reason model (`manual`, `source-closed`, `interrupted`, `error`) consistently across hook logic, notification mapping, and tests.
