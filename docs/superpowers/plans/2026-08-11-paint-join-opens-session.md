# Paint Join Opens Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the collaborative paint editor automatically after an eligible user's join request succeeds.

**Architecture:** Keep API joining and editor opening as separate callbacks owned by `App.tsx`, and compose them in `PaintSessionCard`. Treat successful completion of `onJoin` as the authoritative boundary for opening; refresh the summary without awaiting it so summary availability cannot block the editor.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, Testing Library

## Global Constraints

- Existing participants retain the separate **Open paint** action.
- A rejected join must not open the editor and must use the existing card error display.
- A summary refresh failure after a successful join must not block or close the editor.
- Do not change APIs, eligibility rules, invitation data, styling, or editor lifecycle behavior.

---

## File Structure

- `src/Brmble.Web/src/components/Paint/PaintSessionCard.tsx`: compose join, open, and non-blocking summary refresh for the card action.
- `src/Brmble.Web/src/components/Paint/PaintSessionCard.test.tsx`: define the successful auto-open and failed-join regression behavior.
- `src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx`: update the invitation consumer expectation from two clicks to one.
- `src/Brmble.Web/src/App.paintFlow.test.tsx`: verify the editor opens after joining while chat remains mounted.

### Task 1: Open Paint After a Successful Join

**Files:**
- Modify: `src/Brmble.Web/src/components/Paint/PaintSessionCard.tsx:57-68`
- Test: `src/Brmble.Web/src/components/Paint/PaintSessionCard.test.tsx:42-66`

**Interfaces:**
- Consumes: `onJoin: (sessionId: string) => Promise<void> | void`, `onOpen: (sessionId: string) => void`, and `refresh: () => Promise<void>`.
- Produces: `handleJoin(): Promise<void>` that opens only after `onJoin` resolves and starts a best-effort summary refresh.

- [ ] **Step 1: Write the failing successful-join regression test**

Replace the existing `joins an eligible session...` test with:

```tsx
it('joins an eligible session and opens paint immediately', async () => {
  const onJoin = vi.fn().mockResolvedValue(undefined);
  const onOpen = vi.fn();
  const getSummary = vi.fn()
    .mockResolvedValueOnce(summary())
    .mockResolvedValueOnce(summary({ isParticipant: true }));

  render(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={onJoin} onOpen={onOpen} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Join paint' }));

  await waitFor(() => expect(onOpen).toHaveBeenCalledWith('session-1'));
  expect(onJoin).toHaveBeenCalledWith('session-1');
  expect(onJoin.mock.invocationCallOrder[0]).toBeLessThan(onOpen.mock.invocationCallOrder[0]);
  await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 2: Add failed-join coverage**

Add this test immediately after the successful-join test:

```tsx
it('does not open paint when joining fails', async () => {
  const onJoin = vi.fn().mockRejectedValue(new Error('Join denied'));
  const onOpen = vi.fn();

  render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary())} onJoin={onJoin} onOpen={onOpen} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Join paint' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Join denied');
  expect(onOpen).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/Paint/PaintSessionCard.test.tsx
```

Expected: FAIL in `joins an eligible session and opens paint immediately` because `onOpen` is never called by the current join path. The failed-join test should pass as characterization of existing error behavior.

- [ ] **Step 4: Implement the minimal join/open sequence**

Replace `handleJoin` with:

```tsx
const handleJoin = async () => {
  setJoining(true);
  setError(null);
  try {
    await onJoin(session.sessionId);
    onOpen(session.sessionId);
    void refresh().catch(() => {});
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : 'Unable to join paint.');
  } finally {
    setJoining(false);
  }
};
```

The empty refresh rejection handler is intentional: the editor has already opened following an authoritative successful join, and a stale card summary must not turn that successful action into an error.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/Paint/PaintSessionCard.test.tsx
```

Expected: all `PaintSessionCard` tests PASS with no unhandled rejection.

- [ ] **Step 6: Run related consumer tests**

Update the invitation action test in `MessageBubble.test.tsx` to expect `onOpenPaint('session-1')` after the Join click, and remove its second Open click. Update the reconnect flow test in `App.paintFlow.test.tsx` to expect the collaborative paint editor immediately after the Join click while retaining its chat-mount and draft-preservation assertions.

Run from `src/Brmble.Web`:

```powershell
npm run test -- src/components/ChatPanel/MessageBubble.test.tsx src/App.paintFlow.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 7: Type-check the frontend**

Run from `src/Brmble.Web`:

```powershell
npm run type-check
```

Expected: command exits successfully with no TypeScript errors.

- [ ] **Step 8: Commit the scoped change**

```powershell
git add -- docs/superpowers/specs/2026-08-11-paint-join-opens-session-design.md docs/superpowers/plans/2026-08-11-paint-join-opens-session.md src/Brmble.Web/src/components/Paint/PaintSessionCard.tsx src/Brmble.Web/src/components/Paint/PaintSessionCard.test.tsx
git commit -m "fix: open paint after joining"
```
