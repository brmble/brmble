# LiveKit Share Visibility State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate global share badge visibility from watch eligibility so root/wrong-channel users can see sharing badges but cannot start watching, and stale watcher state is cleaned up correctly.

**Architecture:** Treat `activeShares` in `useScreenShare` as global known share visibility metadata, not as a current-room snapshot. Move watch eligibility checks to the UI/action boundary using the share's real `roomName` and the current selected channel, and clean `watchingShares` at the source when LiveKit tracks unsubscribe or shares stop.

**Tech Stack:** React, TypeScript, Vitest, LiveKit client events

---

## File Map

- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: make `activeShares` global known-share state, stop filtering realtime events by current discovery target, merge room-scoped discovery without deleting unrelated shares, and remove stale watched shares on track unsubscribe.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: replace the old stale-global-share behavior test and add coverage for global visibility preservation, realtime cross-room events, and watcher cleanup.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: gate watch attempts by current channel vs the share's actual room and keep LiveKit status aligned with cleaned watcher state.
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
  Purpose: verify root/wrong-channel watch attempts do not call `connectAsViewer` and same-channel attempts do.
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
  Purpose: stop root rows from synthesizing `channel-0`; render root/cross-channel share icons as presence indicators unless the share is watch-eligible.
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`
  Purpose: replace the old root watch expectation and verify root icons are non-clickable presence indicators.

### Task 1: Make `activeShares` Global Known-Share State

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Replace the stale-global-share test with the intended behavior test**

In `src/Brmble.Web/src/hooks/useScreenShare.test.ts`, replace the test named `drops stale global shares after switching back to room-scoped discovery` with:

```ts
it('keeps global share badges after switching back to room-scoped discovery', () => {
  let activeShareHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.activeShareResult') activeShareHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    result.current.setDiscoveryTarget({ scope: 'all' });
    activeShareHandler?.({
      scope: 'all',
      shares: [
        { roomName: 'channel-1', userId: 10, userName: 'alice', sessionId: 1 },
        { roomName: 'channel-2', userId: 20, userName: 'bob', sessionId: 2 },
      ],
    });
  });

  act(() => {
    result.current.setDiscoveryTarget({ roomName: 'channel-2' });
    activeShareHandler?.({ roomName: 'channel-2', shares: [] });
  });

  expect(result.current.activeShares).toEqual([
    expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
  ]);
});
```

Also add a realtime cross-room test:

```ts
it('keeps realtime share events from other rooms in global visibility state', () => {
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  let shareStoppedHandler: ((data: unknown) => void) | null = null;

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    result.current.setDiscoveryTarget({ roomName: 'channel-2' });
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
  });

  expect(result.current.activeShares).toEqual([
    expect.objectContaining({ roomName: 'channel-1', userId: 10 }),
  ]);

  act(() => {
    shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
  });

  expect(result.current.activeShares).toEqual([]);
});
```

- [ ] **Step 2: Run the focused hook tests and confirm they fail**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "global share badges|realtime share events"`

Expected: FAIL because `setDiscoveryTarget({ roomName })` currently prunes cross-room shares and realtime events from other rooms are ignored.

- [ ] **Step 3: Make `activeShares` global and remove discovery-target pruning**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, change `setDiscoveryTarget` to only store the current target:

```ts
const setDiscoveryTarget = useCallback((target: DiscoveryTarget) => {
  discoveryTargetRef.current = target;
}, []);
```

Remove `isRelevantToDiscoveryTarget` and remove the early returns in `onShareStarted` and `onShareStopped` that ignore events from other rooms.

Update `onActiveShareResult` room-scoped handling so successful room discovery reconciles only that room without deleting other rooms:

```ts
if (d.scope === 'all') {
  setActiveShares(nextRoomShares);
  return;
}

if (!d.roomName) {
  return;
}

setActiveShares(prev => [
  ...prev.filter(s => s.roomName !== d.roomName),
  ...nextRoomShares,
]);
```

- [ ] **Step 4: Run the focused hook tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "activeShare|global share badges|realtime share events"`

Expected: PASS.

- [ ] **Step 5: Commit the global visibility-state fix**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "fix: keep livekit share visibility global"
```

### Task 2: Gate Watch Actions By Current Channel

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar tests for root presence-only icons**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`, replace the expectation that root click calls `channel-0` with:

```ts
it('shows root share badges as presence-only and does not start watching from root', () => {
  const onWatchScreenShare = vi.fn();
  const share = makeShare({ roomName: 'channel-1' });

  renderSidebar({
    users: [
      { session: 2, name: 'Alice', channelId: 0, matrixUserId: '@alice:example.com' },
    ],
    onWatchScreenShare,
    activeShares: [share],
  });

  expect(screen.getByText('Sharing')).toBeInTheDocument();
  expect(screen.queryByLabelText('Watch screen share from Alice')).not.toBeInTheDocument();
  expect(screen.getByText('Alice').closest('.root-user-row')?.querySelector('.sharing-indicator [data-icon="monitor"]')).not.toBeNull();
  expect(onWatchScreenShare).not.toHaveBeenCalled();
});
```

Add an App-level gating test in `src/Brmble.Web/src/App.screenShareStart.test.ts` by extracting and testing a pure helper from App:

```ts
it('blocks watch attempts when current channel does not match share room', () => {
  expect(canWatchShareFromChannel('server-root', 'channel-1')).toBe(false);
  expect(canWatchShareFromChannel('2', 'channel-1')).toBe(false);
  expect(canWatchShareFromChannel('1', 'channel-1')).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `cd src/Brmble.Web; npm run test -- src/components/Sidebar/Sidebar.test.tsx -t "root share badges"`

Expected: FAIL because root currently renders a watch button and calls `channel-0`.

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "blocks watch attempts"`

Expected: FAIL because `canWatchShareFromChannel` does not exist yet.

- [ ] **Step 3: Implement watch eligibility helper and guard**

In `src/Brmble.Web/src/App.tsx`, export:

```ts
export function canWatchShareFromChannel(currentChannelId: string | undefined, shareRoomName: string): boolean {
  if (!currentChannelId || currentChannelId === 'server-root') return false;
  return shareRoomName === `channel-${currentChannelId}`;
}
```

Update `handleWatchScreenShare` so it resolves the real share room and refuses wrong-channel/root attempts:

```ts
const handleWatchScreenShare = useCallback((roomName: string, userId?: number, matrixUserId?: string) => {
  if (userId == null) return;

  const share = activeShares.find(s => s.userId === userId) ?? null;
  const actualRoomName = share?.roomName ?? roomName;

  if (!canWatchShareFromChannel(currentChannelId, actualRoomName)) {
    return;
  }

  updateStatus('livekit', { state: 'connecting', error: undefined });
  connectAsViewer(actualRoomName, userId, matrixUserId ?? share?.matrixUserId);
}, [activeShares, connectAsViewer, currentChannelId, updateStatus]);
```

- [ ] **Step 4: Make root sidebar icons presence-only**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`, remove root double-click watching and replace the root remote sharer button with a non-clickable icon:

```tsx
onDoubleClick={undefined}
```

And for `isRemoteSharer` in root rows, render:

```tsx
<Icon name="monitor" size={11} className="user-status-icon user-status-icon--sharing" stroke="var(--accent-primary)" strokeWidth="2.5" />
```

Keep `onStopWatching` support only for actual watched shares if a separate watched state is visible there; do not start watching from root.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/components/Sidebar/Sidebar.test.tsx -t "root share badges|remote watch behavior"`

Expected: PASS.

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "blocks watch attempts"`

Expected: PASS.

- [ ] **Step 6: Commit the watch-gating fix**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
git commit -m "fix: prevent wrong-channel livekit watch starts"
```

### Task 3: Clean Up Watcher State On Track Unsubscribe

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing hook test for track unsubscribe cleanup**

In `src/Brmble.Web/src/hooks/useScreenShare.test.ts`, add a test using the existing room mock harness that starts watching a share, simulates `RoomEvent.TrackUnsubscribed` for that participant's screen-share track, and expects `watchingShares` to be empty:

```ts
it('removes watched share when its screen-share track unsubscribes', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let shareStartedHandler: ((data: unknown) => void) | null = null;

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });

  await act(async () => {
    const p = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    tokenHandler?.({ token: 'jwt', url: 'ws://localhost/livekit' });
    await p;
  });

  act(() => {
    emitMockRoomEvent(RoomEvent.TrackUnsubscribed, mockScreenShareTrack, mockPublication, { identity: '@alice:test' });
  });

  expect(result.current.watchingShares).toEqual([]);
});
```

Use the test file's existing mock-room helper names; if they differ, adapt the test to the established harness instead of creating parallel mocks.

Add or update an App status helper test:

```ts
it('returns idle when not sharing and no watched shares remain', () => {
  expect(getNextLiveKitStatusUpdate({
    isSharing: false,
    watchingShareCount: 0,
    screenShareError: null,
    isLocalShareStartPending: false,
  })).toEqual({ state: 'idle', error: undefined });
});
```

- [ ] **Step 2: Run focused tests and confirm hook test fails**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "track unsubscribes"`

Expected: FAIL because unsubscribe currently removes only `remoteVideoEls`, not `watchingShares`.

- [ ] **Step 3: Remove watched share on track unsubscribe**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, update `RoomEvent.TrackUnsubscribed` so matched screen-share unsubscribe removes the watched share and disconnects room if appropriate:

```ts
if (
  track.kind === Track.Kind.Video &&
  track.source === Track.Source.ScreenShare
) {
  track.detach();
  removeWatchingShare(matchedShare.userId);

  if (watchingSharesRef.current.length === 0 && !isSharingRef.current) {
    const room = roomRef.current;
    roomRef.current = null;
    roomAccessModeRef.current = null;
    room?.disconnect().catch(() => {});
  }
}
```

Ensure the callback has `removeWatchingShare` in its dependency list if needed.

- [ ] **Step 4: Run focused tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "track unsubscribes|screenShareStopped|connectAsViewer"`

Expected: PASS.

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "idle when not sharing"`

Expected: PASS.

- [ ] **Step 5: Commit the watcher cleanup fix**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: clear livekit watcher state on unsubscribe"
```

### Task 4: Verify The Corrected Visibility/Watch Model

**Files:**
- Modify: all files changed in Tasks 1-3

- [ ] **Step 1: Run focused hook tests**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS.

- [ ] **Step 2: Run focused App and Sidebar tests**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts src/components/Sidebar/Sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 3: Build frontend and client**

Run: `cd src/Brmble.Web; npm run build`

Expected: PASS.

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`

Expected: PASS.

- [ ] **Step 4: Commit verification-only changes if needed**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
git commit -m "fix: separate livekit visibility from watch state"
```

If everything was already committed in earlier tasks, skip this final commit.
