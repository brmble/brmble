# Paint Voice-Membership Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep collaborative Paint open during channel-chat, server-chat, and DM browsing, while closing it immediately when the local user moves away from, leaves, or disconnects from the Paint session's voice channel.

**Architecture:** Derive tri-state Paint voice membership from the existing self user, connection status, and Leave Voice state. Store the actual voice channel when Paint opens, compare that stored channel only with actual voice membership, and keep conversation selection responsible only for cancelling in-flight Paint setup preparation.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, Testing Library

## Global Constraints

- The server remains authoritative for Paint participation and mutation authorization.
- Chat, server-chat, and DM selection must not close an active Paint editor.
- A confirmed voice move, Leave Voice state, root voice channel, or disconnect must close an active Paint editor.
- Unknown self voice state while connected must not close Paint prematurely.
- Do not refactor general channel selection or extract a new Paint orchestration hook.

---

### Task 1: Bind Paint lifecycle to actual voice membership

**Files:**
- Modify: `src/Brmble.Web/src/App.dmDirectoryBehavior.test.tsx`
- Modify: `src/Brmble.Web/src/components/Paint/PaintSessionView.test.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Paint/PaintSessionView.tsx`

**Interfaces:**
- Consumes: the self user's `channelId`, `connectionStatus`, `selfLeftVoice`, and `currentChannelId`.
- Produces: `paintVoiceChannelId: number | null | undefined`; `undefined` means unknown, `null` means confirmed absent, and a number means actual membership.
- Produces: `activePaintChannelIdRef: MutableRefObject<number | null>`, storing the actual voice channel captured when Paint opens.

- [ ] **Step 1: Extend the App test harness**

In `App.dmDirectoryBehavior.test.tsx`, add `sidebarProps` beside the existing captured props and expose it through `mockValues`:

```tsx
let sidebarProps: Record<string, unknown> | undefined;

get sidebarProps() { return sidebarProps; },
setSidebarProps: (props: Record<string, unknown> | undefined) => {
  sidebarProps = props;
},
```

Replace the Sidebar mock body with:

```tsx
Sidebar: (props: Record<string, unknown>) => {
  mockValues.setSidebarProps(props);
  return (
    <>
      <button type="button" data-testid="sidebar-select-channel" onClick={() => (props.onSelectChannel as ((channelId: number) => void) | undefined)?.(1)} />
      <button type="button" data-testid="sidebar-select-channel-2" onClick={() => (props.onSelectChannel as ((channelId: number) => void) | undefined)?.(2)} />
      <button type="button" data-testid="sidebar-select-server" onClick={() => (props.onSelectServer as (() => void) | undefined)?.()} />
    </>
  );
},
```

Make `renderPaintReadyApp` advertise both channels:

```tsx
channels: [
  { id: 1, name: 'General' },
  { id: 2, name: 'Gaming' },
],
```

Reset `sidebarProps` in `beforeEach`, then add this helper below `renderPaintReadyApp`:

```tsx
async function renderAppWithActivePaint() {
  const view = renderPaintReadyApp();
  await waitFor(() => {
    expect(mockValues.channelChatPanelProps?.onOpenPaint).toEqual(expect.any(Function));
  });
  act(() => {
    (mockValues.channelChatPanelProps?.onOpenPaint as (sessionId: string) => void)(
      'active-paint-session',
    );
  });
  await waitFor(() => {
    expect(mockValues.headerProps?.activePaintSessionId).toBe('active-paint-session');
  });
  return view;
}
```

- [ ] **Step 2: Add the browsing regression tests**

Add to `App.dmDirectoryBehavior.test.tsx`:

```tsx
it('keeps active paint open when browsing another channel chat', async () => {
  const view = await renderAppWithActivePaint();
  act(() => view.getByTestId('sidebar-select-channel-2').click());
  expect(mockValues.headerProps?.activePaintSessionId).toBe('active-paint-session');
});

it('keeps active paint open when browsing server chat', async () => {
  const view = await renderAppWithActivePaint();
  act(() => view.getByTestId('sidebar-select-server').click());
  expect(mockValues.headerProps?.activePaintSessionId).toBe('active-paint-session');
});

it('keeps active paint open when browsing a direct message', async () => {
  mockValues.dmStore.selectedContact = {
    id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0,
  };
  await renderAppWithActivePaint();
  act(() => {
    (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)(
      '@val:example.com',
    );
  });
  expect(mockValues.headerProps?.activePaintSessionId).toBe('active-paint-session');
});
```

- [ ] **Step 3: Verify the regressions fail before implementation**

Run from `src/Brmble.Web`:

```powershell
npm.cmd run test -- --run src/App.dmDirectoryBehavior.test.tsx
```

Expected: the different-channel and server-chat tests fail because `activePaintSessionId` becomes `null`; the DM test passes.

- [ ] **Step 4: Add actual voice-exit coverage**

Add to `App.dmDirectoryBehavior.test.tsx`:

```tsx
it('closes active paint after an actual voice-channel move', async () => {
  await renderAppWithActivePaint();
  act(() => {
    const emitter = bridge as unknown as { __emit: (event: string, data?: unknown) => void };
    emitter.__emit('voice.userJoined', {
      session: 7, name: 'Me', self: true, channelId: 2,
    });
    emitter.__emit('voice.channelChanged', {
      previousChannelId: 1, channelId: 2, name: 'Gaming',
    });
  });
  await waitFor(() => expect(mockValues.headerProps?.activePaintSessionId).toBeNull());
});

it('closes active paint after Leave Voice is confirmed', async () => {
  await renderAppWithActivePaint();
  act(() => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void })
      .__emit('voice.leftVoiceChanged', { leftVoice: true });
  });
  await waitFor(() => expect(mockValues.headerProps?.activePaintSessionId).toBeNull());
});

it('closes active paint after voice disconnects', async () => {
  await renderAppWithActivePaint();
  act(() => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void })
      .__emit('voice.disconnected', { reconnectAvailable: true });
  });
  await waitFor(() => expect(mockValues.headerProps?.activePaintSessionId).toBeNull());
});

it('keeps active paint open while connected self voice membership is temporarily unknown', async () => {
  await renderAppWithActivePaint();
  act(() => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void })
      .__emit('voice.connected', {
        username: 'Me',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [],
      });
  });
  expect(mockValues.headerProps?.activePaintSessionId).toBe('active-paint-session');
});
```

Add to `PaintSessionView.test.tsx`:

```tsx
it('closes paint when the local user has confirmed absence from voice', async () => {
  sessionState = { snapshot: { ...activeSnapshot(), channelId: 5 }, previews: [], error: null };
  const onClose = vi.fn();
  render(<PaintSessionView sessionId="session-1" currentVoiceChannelId={null} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it('does not close paint while local voice membership is unknown', async () => {
  sessionState = { snapshot: { ...activeSnapshot(), channelId: 5 }, previews: [], error: null };
  const onClose = vi.fn();
  render(<PaintSessionView sessionId="session-1" currentVoiceChannelId={undefined} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);
  await Promise.resolve();
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Derive tri-state membership in App**

Rename the early `selfVoiceChannelIdForIdle` variable and reuse it throughout `App.tsx`; remove the later duplicate declaration:

```tsx
const selfVoiceChannelId = users.find(user => user.self)?.channelId;
const inVoiceChannelForIdle =
  !selfLeftVoice && selfVoiceChannelId != null && selfVoiceChannelId !== 0;
```

After the active Paint refs, add:

```tsx
const paintVoiceChannelId: number | null | undefined =
  connectionStatus !== 'connected' || selfLeftVoice || selfVoiceChannelId === 0
    ? null
    : selfVoiceChannelId;
```

- [ ] **Step 6: Separate conversation invalidation from voice closure**

Change the active channel ref and replace the current combined effect:

```tsx
const activePaintChannelIdRef = useRef<number | null>(null);

useEffect(() => {
  invalidatePaintPreparation();
}, [currentChannelId, invalidatePaintPreparation]);

useEffect(() => {
  if (!activePaintSessionId || paintVoiceChannelId === undefined) return;
  if (activePaintChannelIdRef.current !== paintVoiceChannelId) {
    activePaintSessionIdRef.current = null;
    setActivePaintSessionId(null);
    activePaintChannelIdRef.current = null;
  }
}, [activePaintSessionId, paintVoiceChannelId]);
```

- [ ] **Step 7: Capture actual membership when Paint opens**

Replace `handleOpenPaint` with:

```tsx
const handleOpenPaint = useCallback((sessionId: string) => {
  if (paintVoiceChannelId == null) return;
  invalidatePaintPreparation();
  activePaintChannelIdRef.current = paintVoiceChannelId;
  activePaintSessionIdRef.current = sessionId;
  setActivePaintSessionId(sessionId);
}, [invalidatePaintPreparation, paintVoiceChannelId]);
```

Use `null` when `handleClosePaint` clears the ref. Derive setup eligibility and capture its validated channel on completion:

```tsx
const paintChannelId = typeof paintVoiceChannelId === 'number'
  ? paintVoiceChannelId
  : null;

// PaintSessionSetupModal.onComplete
activePaintChannelIdRef.current = paintChannelId;
```

- [ ] **Step 8: Pass tri-state membership to the view**

In `App.tsx`:

```tsx
currentVoiceChannelId={paintVoiceChannelId}
```

In `PaintSessionView.tsx`, widen the prop type:

```tsx
currentVoiceChannelId?: number | null;
```

Keep the existing effect condition. It ignores `undefined` and closes for `null` or a mismatched number.

- [ ] **Step 9: Run focused tests**

Run from `src/Brmble.Web`:

```powershell
npm.cmd run test -- --run src/App.dmDirectoryBehavior.test.tsx src/components/Paint/PaintSessionView.test.tsx
```

Expected: both files pass with zero failures.

- [ ] **Step 10: Verify red-green protection**

Temporarily restore only the old App comparison against `currentChannelId`, run the focused suite, and confirm the channel-chat and server-chat regressions fail. Restore the fixed effect immediately and rerun Step 9; expected result is zero failures.

- [ ] **Step 11: Run full verification**

Run from `src/Brmble.Web`:

```powershell
npm.cmd run type-check
npm.cmd run test
npm.cmd run build
```

Expected: all commands exit with code 0.

- [ ] **Step 12: Review scope and commit**

Run from the repository root:

```powershell
git diff --check
git status --short
git diff -- src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.dmDirectoryBehavior.test.tsx src/Brmble.Web/src/components/Paint/PaintSessionView.tsx src/Brmble.Web/src/components/Paint/PaintSessionView.test.tsx
```

Expected: no whitespace errors; unrelated existing files remain untouched. Then stage only the design, plan, and four implementation files:

```powershell
git add -- docs/superpowers/specs/2026-08-11-paint-voice-membership-guard-design.md docs/superpowers/plans/2026-08-11-paint-voice-membership-guard.md src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.dmDirectoryBehavior.test.tsx src/Brmble.Web/src/components/Paint/PaintSessionView.tsx src/Brmble.Web/src/components/Paint/PaintSessionView.test.tsx
git commit -m "fix: bind paint editor to voice membership"
```
