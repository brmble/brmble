# Missed Ready Check Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Say plainly that an accepted challenge was placed in the duel queue, and tell both players what happened when a ready check expires instead of letting the notification silently vanish.

**Architecture:** A hook captures the last-seen ready check (including each player's `ready` flag) from raw snapshots, then reacts to `game.commitmentCanceled` with `reason === 'expired'` to decide which of two mutually exclusive notifications to show. No server or wire change — every value needed is already on the client.

**Tech Stack:** React + TypeScript (`Brmble.Web`), Vitest + Testing Library, existing `<Notification>` + `useNotificationQueue`.

**Source spec:** `docs/superpowers/specs/2026-07-31-missed-ready-check-design.md`

**Branch:** `feature/minigame-framework-expansion`. Do not create branches or worktrees. Never stage `.opencode/plans/` or the older untracked `docs/superpowers/` files.

**Web commands run from `src/Brmble.Web`.** PowerShell: use `;` not `&&`.

**Verification note:** `npm run type-check` runs `tsc -b tsconfig.test.json`, which only compiles test files and their transitive imports — a source-only type error escapes it. `npm run build` is the authoritative type gate. Run both.

---

## Critical implementation facts (verified — do not re-derive)

1. **`App.tsx:1041-1043` derives `readyCheck` with a `!player.ready` filter**, so it becomes `null` the moment the local player presses Ready. The capture in Task 2 MUST read raw `duelQueue.byChannel` snapshots, not that derived variable. Using it would make the ready-player case impossible to detect.
2. **`game.commitmentCanceled` fires for six reasons**: `expired`, `declined`, `disconnected`, `leftChannel`, `channelRemoved` (`DuelOrchestrator.cs:331,480,540,607,748,770`) and `startFailed` (`DuelOrchestrator.cs:664-666`, published inline rather than via `PublishReservationCancellationAsync`). Only `expired` may produce this notification. Allow-list it rather than excluding the others.
3. **`DEFAULT_DURATIONS`** (`Notification.tsx`): `info: 5000`, `warning: null`. The persistence requirement is met by status choice alone — do NOT pass a `duration` prop.
4. **`onExited` is unreachable** for a notification behind a render gate (documented in `docs/UI_GUIDE.md` §13). Registration cleanup goes in the effect's `else`. Do not add an `onExited` handler.
5. The server keeps the ready check in the snapshot after one player readies, with that player's `ready: true` — so the capture sees the full ready state.

---

### Task 1: Rename the queue confirmation

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (the `game-queued` notification title)
- Modify: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`
- Modify: `docs/UI_GUIDE.md`

`Challenge accepted` reports the event but not its consequence. The player's question is "am I in the queue?".

- [ ] **Step 1: Update the test first**

In `src/Brmble.Web/src/App.duelOrchestration.test.tsx`, change every `'Challenge accepted'` string to `'Added to duel queue'`. There are occurrences in the confirm test, the ready-check-suppression test, the category-disabled test, and both slot-release tests — change all of them.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Added to duel queue`.

- [ ] **Step 3: Change the title**

In `src/Brmble.Web/src/App.tsx`, in the `game-queued` `<Notification>`:

```tsx
            title="Added to duel queue"
```

Leave `status`, the detail, the id, and the settings gate exactly as they are.

- [ ] **Step 4: Update the guide**

In `docs/UI_GUIDE.md`'s `#### Duel queue confirmation` subsection, change the title reference from `Challenge accepted` to `Added to duel queue`. Read the surrounding sentence and adjust its wording if it now reads awkwardly.

- [ ] **Step 5: Verify**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx src/uiGuideCompliance.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx docs/UI_GUIDE.md
git commit -m "feat: say the duel was added to the queue"
```

---

### Task 2: Detect a missed ready check

**Files:**
- Create: `src/Brmble.Web/src/components/Games/useMissedReadyCheck.ts`
- Test: `src/Brmble.Web/src/components/Games/useMissedReadyCheck.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/useMissedReadyCheck.test.tsx`. Follow the fixture conventions in the sibling `useQueuedDuelConfirmation.test.tsx` (module-scope `player`/`snapshot`/`channels` helpers, `unknownEstimate` from `duelTestHarness`), and reuse its `ready(...)` helper shape but with a per-player `ready` flag:

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DuelPlayer, DuelQueueSnapshot, ReadyCheck } from '../../api/games';
import { emit, unknownEstimate } from './duelTestHarness';
import { useMissedReadyCheck } from './useMissedReadyCheck';

// The `await import` form is required: vi.mock factories hoist above this file's imports.
vi.mock('../../bridge', async () => ({ default: (await import('./duelTestHarness')).bridge }));

const SELF = 11;

const player = (sessionId: number, ready: boolean): DuelPlayer =>
  ({ userId: sessionId * 100, sessionId, displayName: `P${sessionId}`, ready });

const ready = (reservationId: number, players: DuelPlayer[]): ReadyCheck => ({
  reservationId,
  expiresAt: '2026-07-31T00:00:30Z',
  players,
  gameType: 'rps',
  format: 'bo3',
  rulesetVersion: 1,
  estimatedDuration: unknownEstimate,
});

const snapshot = (
  channelId: number,
  readyCheck: ReadyCheck | null,
): DuelQueueSnapshot => ({
  schemaVersion: 1, generation: 1, revision: 1, channelId,
  generatedAt: '2026-07-31T00:00:00Z', calculationTimeMs: 1,
  active: null, readyCheck, queue: [],
});

const channels = (...snapshots: DuelQueueSnapshot[]) =>
  new Map<number, DuelQueueSnapshot>(snapshots.map(s => [s.channelId, s]));

describe('useMissedReadyCheck', () => {
  it('reports that you missed it when you did not ready', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed?.localReadied).toBe(false);
    expect(result.current.missed?.reservationId).toBe(41);
  });

  it('names the opponent who did not ready when you did', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, true), player(22, false)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed?.localReadied).toBe(true);
    expect(result.current.missed?.unreadyOpponents.map(p => p.sessionId)).toEqual([22]);
  });

  it('reports that you missed it when neither readied', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, false), player(22, false)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed?.localReadied).toBe(false);
  });

  it('captures the ready check even after you have readied', () => {
    // App.tsx filters its own `readyCheck` to unready-local only, so this hook must
    // read raw snapshots or the ready-player case could never fire.
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, true), player(22, false)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed).not.toBeNull();
  });

  it.each(['declined', 'disconnected', 'leftChannel', 'channelRemoved'])(
    'ignores the %s reason', reason => {
      const { result } = renderHook(() => useMissedReadyCheck(
        channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))), SELF));

      emit('game.commitmentCanceled', { reservationId: 41, reason });

      expect(result.current.missed).toBeNull();
    });

  it('ignores a cancellation for a different reservation', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 99, reason: 'expired' });

    expect(result.current.missed).toBeNull();
  });

  it('ignores a ready check the local session is not part of', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(33, false), player(22, true)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed).toBeNull();
  });

  it('clears a pending report when a new ready check arrives', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useMissedReadyCheck(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))) } },
    );
    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });
    expect(result.current.missed).not.toBeNull();

    rerender({ byChannel: channels(snapshot(7, ready(42, [player(SELF, false), player(22, false)]))) });

    expect(result.current.missed).toBeNull();
  });

  it('clears on dismiss', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))), SELF));
    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    act(() => result.current.dismiss());

    expect(result.current.missed).toBeNull();
  });
});
```

Import `act` from `@testing-library/react` for that last test only.

The harness's `emit` wraps `act` internally, so do NOT wrap the calls again. The `dismiss` call does need `act`, since it is a direct state update.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/Games/useMissedReadyCheck.test.tsx`
Expected: FAIL — `Failed to resolve import "./useMissedReadyCheck"`.

- [ ] **Step 3: Implement the hook**

Create `src/Brmble.Web/src/components/Games/useMissedReadyCheck.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import type { DuelPlayer, DuelQueueSnapshot, ReadyCheck } from '../../api/games';

export interface MissedReadyCheck {
  reservationId: number;
  /** The pair as it stood when the check expired. */
  players: DuelPlayer[];
  localReadied: boolean;
  /** Opponents who did not ready. Empty when only the local player failed. */
  unreadyOpponents: DuelPlayer[];
}

/**
 * Reports a ready check that expired without both players readying.
 *
 * The ready state is captured from raw snapshots rather than App's derived
 * `readyCheck`, which filters to checks the local player has NOT readied and so
 * goes null the moment they press Ready — the ready-player case would never fire.
 *
 * The capture is kept after the check leaves the snapshot, because
 * `game.commitmentCanceled` can be handled after the snapshot has already dropped it.
 */
export function useMissedReadyCheck(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
  selfSession: number,
): { missed: MissedReadyCheck | null; dismiss: () => void } {
  const [missed, setMissed] = useState<MissedReadyCheck | null>(null);
  const capturedRef = useRef<ReadyCheck | null>(null);
  const selfSessionRef = useRef(selfSession);
  selfSessionRef.current = selfSession;

  useEffect(() => {
    if (!selfSession) return;
    for (const snapshot of byChannel.values()) {
      const check = snapshot.readyCheck;
      if (!check?.players.some(player => player.sessionId === selfSession)) continue;
      if (capturedRef.current?.reservationId !== check.reservationId) {
        // A new pop supersedes any report still on screen for the previous one.
        setMissed(null);
      }
      capturedRef.current = check;
    }
  }, [byChannel, selfSession]);

  useEffect(() => {
    const handleCanceled = (data: unknown) => {
      const { reservationId, reason } = data as { reservationId?: number; reason?: string };
      // Only a timeout means "did not ready up in time". `declined` is a deliberate
      // refusal; `disconnected`/`leftChannel`/`channelRemoved` are not the player's doing.
      if (reason !== 'expired' || reservationId == null) return;
      const captured = capturedRef.current;
      if (!captured || captured.reservationId !== reservationId) return;
      const self = selfSessionRef.current;
      setMissed({
        reservationId,
        players: captured.players,
        localReadied: captured.players.find(p => p.sessionId === self)?.ready ?? false,
        unreadyOpponents: captured.players.filter(p => p.sessionId !== self && !p.ready),
      });
    };
    bridge.on('game.commitmentCanceled', handleCanceled);
    return () => bridge.off('game.commitmentCanceled', handleCanceled);
  }, []);

  const dismiss = useCallback(() => setMissed(null), []);

  return { missed, dismiss };
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- --run src/components/Games/useMissedReadyCheck.test.tsx`
Expected: PASS.

Run: `npm run type-check`; then `npx tsc -b tsconfig.app.json --force`
Expected: both exit 0.

- [ ] **Step 5: Mutation-check your own tests**

Break each of these in turn, confirm the named test fails, then restore and leave the tree clean:
- Drop the `reason !== 'expired'` guard → the reason tests must fail.
- Drop the `captured.reservationId !== reservationId` guard → the different-reservation test must fail.
- Hardcode `localReadied: false` → the ready-player test must fail.

Report the results.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useMissedReadyCheck.ts src/Brmble.Web/src/components/Games/useMissedReadyCheck.test.tsx
git commit -m "feat: detect an expired duel ready check"
```

---

### Task 3: Report the missed ready check

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (import, hook call, register effect, render)
- Test: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/Brmble.Web/src/App.duelOrchestration.test.tsx`, using the file's module-scope `snapshot`/`player`/`readyCheck`/`connectSelf`/`renderApp` helpers and the `rerenderApp` pass. Note `player(n)` yields `displayName: 'Player n'`.

```tsx
  it('tells you when you missed your own ready check', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({ players: [player(selfSession), { ...player(22), ready: true }] }),
    })]]);
    const { rerender } = renderApp();
    connectSelf(7);

    emitBridge('game.commitmentCanceled', { reservationId: 42, reason: 'expired' });
    rerenderApp(rerender);

    expect(screen.getByText('Missed your duel')).toBeInTheDocument();
    expect(screen.getByText(/Player 11 vs Player 22 removed from the queue/)).toBeInTheDocument();
  });

  it('names the opponent who did not ready', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({ players: [{ ...player(selfSession), ready: true }, player(22)] }),
    })]]);
    const { rerender } = renderApp();
    connectSelf(7);

    emitBridge('game.commitmentCanceled', { reservationId: 42, reason: 'expired' });
    rerenderApp(rerender);

    expect(screen.getByText('Duel canceled')).toBeInTheDocument();
    expect(screen.getByText(/Player 22 did not ready up in time/)).toBeInTheDocument();
  });

  it('releases the missed ready slot when dismissed', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({ players: [player(selfSession), { ...player(22), ready: true }] }),
    })]]);
    const { rerender } = renderApp();
    connectSelf(7);
    emitBridge('game.commitmentCanceled', { reservationId: 42, reason: 'expired' });
    rerenderApp(rerender);
    expect(mocks.ids.has('game-ready-missed')).toBe(true);

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    rerenderApp(rerender);

    expect(mocks.ids.has('game-ready-missed')).toBe(false);
  });
```

Add an `emitBridge(type, data)` module-scope helper if the file lacks one, wrapping the existing raw `bridge.__emit` cast that `connectSelf` already uses. Check the real dismiss control's accessible name before asserting on it.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Missed your duel`.

- [ ] **Step 3: Call the hook**

In `src/Brmble.Web/src/App.tsx`, add the import:

```ts
import { useMissedReadyCheck } from './components/Games/useMissedReadyCheck';
```

and, next to the `useQueuedDuelConfirmation` call:

```tsx
  const { missed: missedReadyCheck, dismiss: dismissMissedReadyCheck } =
    useMissedReadyCheck(duelQueue.byChannel, selfSession);
```

- [ ] **Step 4: Register it**

Beside the other duel registration effects, following the `notifQueueRef.current` convention those effects use:

```tsx
  useEffect(() => {
    if (missedReadyCheck) {
      notifQueueRef.current.register(
        'game-ready-missed', missedReadyCheck.localReadied ? 'info' : 'warning');
    } else {
      notifQueueRef.current.unregister('game-ready-missed');
    }
  }, [missedReadyCheck]);
```

- [ ] **Step 5: Render it**

Beside the other game notifications:

```tsx
        {missedReadyCheck && notifQueue.isVisible('game-ready-missed') && (
          <Notification
            status={missedReadyCheck.localReadied ? 'info' : 'warning'}
            position="top-right"
            visible={true}
            title={missedReadyCheck.localReadied ? 'Duel canceled' : 'Missed your duel'}
            detail={missedReadyCheck.localReadied ? (
              <div>
                {pairLabel(missedReadyCheck.unreadyOpponents, resolveGamePlayerName)} did not ready up in time
              </div>
            ) : (
              <>
                <div>You did not ready up in time</div>
                <div>
                  {pairLabel(missedReadyCheck.players, resolveGamePlayerName)} removed from the queue
                </div>
              </>
            )}
            onDismiss={dismissMissedReadyCheck}
          />
        )}
```

No `duration` prop — `warning` is `null` (persistent) and `info` is 5000ms by default. No `onExited` — it is unreachable behind a render gate.

- [ ] **Step 6: Verify**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx src/uiGuideCompliance.test.ts`
Expected: PASS.

Run: `npm run type-check`; then `npx tsc -b tsconfig.app.json --force`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx
git commit -m "feat: report an expired duel ready check"
```

---

### Task 4: Document the pattern

**Files:**
- Modify: `docs/UI_GUIDE.md`

- [ ] **Step 1: Document it**

Add a `#### Missed ready check` subsection next to `#### Duel queue confirmation`, before the section's scope-closing paragraph. Verify every claim against the code as you write it. Cover:

- The two forms under the stable id `game-ready-missed`: `warning` / `Missed your duel` (persistent, because the player was away) when the local player did not ready, and `info` / `Duel canceled` naming the opponent when they did. Both when neither readied.
- That persistence comes from the `warning` status's `duration: null`, not an explicit prop.
- That only `reason === 'expired'` produces it, and why `declined` / `disconnected` / `leftChannel` / `channelRemoved` / `startFailed` must not. Note the handler allow-lists rather than deny-lists, so a future reason cannot silently start reporting itself.
- That the ready state is captured from raw snapshots because App's derived `readyCheck` excludes checks the local player has readied.
- That it is not behind a settings toggle, matching the other duel outcome notifications.
- That the queue holds pairs, so an expired check drops the pair and getting back in means a fresh challenge at the back of the queue. This is by design, not a limitation.

- [ ] **Step 2: Verify**

Run: `npm test -- --run src/uiGuideCompliance.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: document missed ready check notifications"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1:** Run `npm test -- --run` — 0 failures.
- [ ] **Step 2:** Run `npm run build` — exit 0. This is the authoritative type gate.
- [ ] **Step 3:** Confirm the server is untouched: `git diff --stat fe25f57b..HEAD -- src/Brmble.Server tests` — expect empty output.
- [ ] **Step 4:** Report all results verbatim.

Manual checks automation cannot cover, with two clients:

- Let a ready check expire with neither player readying → both see the persistent `Missed your duel`, which is still there after switching away and back.
- One player readies, the other lets it expire → the ready player sees `Duel canceled — Player X did not ready up in time` and it auto-dismisses; the other sees the persistent form.
- Accept a challenge into a busy channel → `Added to duel queue`.
- Get a second ready check after missing one → the stale `Missed your duel` clears.
- Both notifications in Classic and Retro Terminal themes.
