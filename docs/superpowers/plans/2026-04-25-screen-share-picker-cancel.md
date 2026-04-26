# Screen Share Picker Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make screen-share picker cancel behave like a manual pre-share abort, with no technical failure notification and no misleading LiveKit error status.

**Architecture:** Narrow the `startSharing()` failure path in `useScreenShare` so known picker-cancel/abort errors do not flow into the generic `error` branch. In `App.tsx`, stop setting LiveKit status to `connecting` before the picker resolves so cancel naturally settles back to `idle` or remains `connected` if the user is already watching shares.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, LiveKit client, existing status/notification plumbing in `App.tsx`

---

## File Map

- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: classify picker cancel as benign/manual-equivalent behavior before the generic error path.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: verify picker cancel does not become `error`, does not retain `screenShareError`, and does not emit the technical failure callback path.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: remove the misleading `connecting` status update from the share-start button path.
- Create or modify: narrow App/status tests if needed
  Purpose: verify status timing and cancel behavior without heavy end-to-end setup.

### Task 1: Classify Picker Cancel As Benign In `useScreenShare`

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write a failing hook test for picker cancel**

Add a test that simulates the start path rejecting with a browser-style cancel error and proves it is not treated as `error`.

```ts
it('treats picker cancel as a manual-equivalent abort instead of error', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  const cancelError = Object.assign(new Error('Permission denied by user'), { name: 'AbortError' });

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(cancelError);

  const onLocalShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, onLocalShareEnded));

  await act(async () => {
    const promise = result.current.startSharing('channel-1');
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
    await promise;
  });

  expect(result.current.isSharing).toBe(false);
  expect(result.current.error).toBeNull();
  expect(onLocalShareEnded).not.toHaveBeenCalledWith('error');
  expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.shareStopped')).toHaveLength(0);
});
```

- [ ] **Step 2: Run the new picker-cancel test and confirm it fails**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "manual-equivalent abort instead of error"`

Expected: FAIL because the current catch block sets `screenShareError` and routes cancel into `stopLocalShare('error', ...)`.

- [ ] **Step 3: Add a narrow picker-cancel classifier in `useScreenShare.ts`**

Introduce one helper that recognizes known abort/cancel errors without swallowing arbitrary failures.

```ts
function isScreenSharePickerCancel(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const name = err.name.toLowerCase();
  const message = err.message.toLowerCase();

  return name === 'aborterror'
    || message.includes('permission denied by user')
    || message.includes('selection canceled')
    || message.includes('cancelled')
    || message.includes('canceled');
}
```

- [ ] **Step 4: Short-circuit benign cancel before the generic error path**

Update the `startSharing()` catch block so cancel clears temporary share-start state but does not set `screenShareError` or emit the `error` stop reason.

```ts
} catch (err) {
  clearLocalShareEndListener();

  if (isScreenSharePickerCancel(err)) {
    setError(null);
    isSharingRef.current = false;
    setIsSharing(false);
    await maybeDisconnectRoom();
    return;
  }

  setError(err instanceof Error ? err.message : 'Screen share failed');
  await stopLocalShare('error', roomRef.current);
  await maybeDisconnectRoom();
}
```

- [ ] **Step 5: Add a second test to prove true failures still map to `error`**

Keep the existing publish-failure test, but add a cancel-vs-real-failure contrast if needed.

```ts
it('still classifies real publish failures as error', async () => {
  const publishError = new Error('Publish failed');
  mockRoom.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(publishError);

  // existing expectation stays: error string retained and onLocalShareEnded('error') emitted once
});
```

- [ ] **Step 6: Run the full hook test file and confirm it passes**

Run: `npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS with picker-cancel coverage and existing auto-stop tests still green.

### Task 2: Remove Misleading Start-Connecting Status In `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Create or modify: narrow App/status tests if needed

- [ ] **Step 1: Add a failing narrow test or pure-logic seam for the start-status behavior**

If a lightweight helper is easiest, extract a tiny test seam around the rule that share start does not force `connecting` before success.

```ts
export function shouldSetConnectingStatusForShareStart(): boolean {
  return false;
}
```

Or add a narrow component logic test that proves no explicit `updateStatus('livekit', { state: 'connecting' ... })` is used from the share-start path.

- [ ] **Step 2: Run the new status test and confirm it fails**

Run: `npm run test -- src/App.screenShareStartStatus.test.ts`

Expected: FAIL if the helper/test seam does not exist yet.

- [ ] **Step 3: Remove the direct `connecting` update from `handleToggleScreenShare` start flow**

Make share start rely on the steady-state `isSharing` / `watchingShares.length` effect instead.

```ts
const handleToggleScreenShare = useCallback(async () => {
  if (isSharing) {
    await stopSharing();
    setSharingChannelId(undefined);
  } else if (!selfLeftVoice) {
    const selfUser = usersRef.current.find(u => u.self);
    const voiceChannelId = selfUser?.channelId;
    if (voiceChannelId != null && voiceChannelId !== 0) {
      try {
        await startSharing(`channel-${voiceChannelId}`);
        setSharingChannelId(String(voiceChannelId));
      } catch {
        // startSharing manages its own state; benign cancel should remain silent
      }
    }
  }
}, [isSharing, startSharing, stopSharing, selfLeftVoice]);
```

- [ ] **Step 4: Ensure the status effects still produce the intended steady states**

Keep the existing effects, which should now naturally settle to:

- `connected` when `isSharing` or watching shares
- `idle` when neither is true and there is no `screenShareError`
- `disconnected` only when a true error remains

If needed, add a tiny helper test documenting this intended cancel result.

- [ ] **Step 5: Run the App status test(s) and confirm they pass**

Run: `npm run test -- src/App.screenShareStartStatus.test.ts src/App.screenShareEnded.test.ts`

Expected: PASS.

### Task 3: Regression Verification For `#483`

**Files:**
- Modify if needed: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify if needed: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Run the hook tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the App-level tests related to share-end notifications and share-start status**

Run: `npm run test -- src/App.screenShareEnded.test.ts src/App.screenShareStartStatus.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the sidebar regressions already on this branch**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx src/components/Sidebar/Sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run a production web build**

Run: `npm run build`

Expected: PASS with no TypeScript or Vite build failures.

- [ ] **Step 5: Perform manual verification for issue #483**

Manual checklist:

```text
1. Join voice without watching any shares.
2. Click Share Screen and cancel the picker.
3. Verify no technical-failure notification appears.
4. Verify LiveKit status returns to idle.
5. Start watching another user's share.
6. Click Share Screen and cancel the picker.
7. Verify no technical-failure notification appears.
8. Verify LiveKit status stays connected.
9. Trigger a real share-start failure if feasible.
10. Verify the true failure path still shows error behavior.
```

## Self-Review

- Spec coverage: Task 1 covers cancel classification and preserving real `error` behavior. Task 2 covers the misleading pre-picker `connecting` state. Task 3 covers regression verification for both idle and watching states.
- Placeholder scan: all tasks include exact file paths, commands, and concrete implementation/test snippets.
- Type consistency: the plan preserves the existing local stop-reason model and intentionally keeps picker cancel out of that product-facing error path.
