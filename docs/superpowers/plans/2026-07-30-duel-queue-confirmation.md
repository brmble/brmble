# Duel Queue Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm to both participants that an accepted challenge entered the queue, and give the ready-check notification the opponent names and estimated duration it currently lacks.

**Architecture:** A new hook derives queue entry from snapshot transitions (no event correlation, no race), firing a one-shot notification when the local session newly appears in `queue[]`. Immediate-start suppression is structural: the orchestrator promotes to ready check before the snapshot is built, so the client never sees that reservation queued. Duel text formatting moves to a shared module so the panel card and the notification cannot drift.

**Tech Stack:** React + TypeScript (`Brmble.Web`), Vitest + Testing Library, existing `<Notification>` + `useNotificationQueue`.

**Source spec:** `docs/superpowers/specs/2026-07-30-duel-queue-confirmation-design.md`

**Branch:** `feature/minigame-framework-expansion`. Do not create branches or worktrees. Never stage the pre-existing untracked files under `.opencode/plans/` and `docs/superpowers/`.

**Web commands run from `src/Brmble.Web`.** Shell is PowerShell: use `;` not `&&`.

---

### Task 1: Extract shared duel formatting

**Files:**
- Create: `src/Brmble.Web/src/components/Games/duelFormatting.ts`
- Modify: `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx:15-49`
- Test: `src/Brmble.Web/src/components/Games/duelFormatting.test.ts`

`playerName`, `pairLabel`, `formatDuration`, `ceilSeconds`, `estimateMs`, and `estimateText` are private to `DuelQueueModal.tsx`. Tasks 4 and 5 need `pairLabel` and `estimateText` from `App.tsx`. Mirroring the panel card only stays true if both render from one implementation.

This is a pure move. Behaviour must not change.

- [ ] **Step 1: Create the shared module**

Create `src/Brmble.Web/src/components/Games/duelFormatting.ts` containing the six functions exactly as they exist today in `DuelQueueModal.tsx:15-49`, exported:

```ts
import type { DuelPlayer, DurationEstimate } from '../../api/games';

export function playerName(player: DuelPlayer, resolveName: (sessionId: number) => string): string {
  // resolveName only knows the session id space; a player without a live session
  // (sessionId 0) can't be looked up there, so fall back to the user id.
  return player.displayName.trim()
    || (player.sessionId ? resolveName(player.sessionId) : `Player ${player.userId}`);
}

export function pairLabel(players: DuelPlayer[], resolveName: (sessionId: number) => string): string {
  return players.map(player => playerName(player, resolveName)).join(' vs ');
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m${remainder > 0 ? ` ${remainder}s` : ''}` : `${seconds}s`;
}

/** Whole seconds rounded up, so a sub-second remainder never renders as `0s`. */
export function ceilSeconds(milliseconds: number): number {
  return Math.ceil(milliseconds / 1000) * 1000;
}

/** The usable length of an estimate, or null when the server has none. */
export function estimateMs(estimate: DurationEstimate): number | null {
  return estimate.status === 'known' && estimate.milliseconds != null ? estimate.milliseconds : null;
}

/** The duel's own expected length, as the server measured it. Never a live value. */
export function estimateText(estimate: DurationEstimate): string {
  const milliseconds = estimateMs(estimate);
  return milliseconds != null
    ? `Estimated duration: ~${formatDuration(milliseconds)}`
    : 'Estimated duration: Unknown';
}
```

- [ ] **Step 2: Point the modal at the shared module**

In `DuelQueueModal.tsx`, delete the six local function definitions (lines 15-49) and import them instead. Keep the existing `DuelPlayer`/`DurationEstimate` type import only if still referenced after the move; remove it if not.

```ts
import { ceilSeconds, estimateMs, estimateText, formatDuration, pairLabel, playerName } from './duelFormatting';
```

- [ ] **Step 3: Verify the refactor changed nothing**

Run: `npm test -- --run src/components/Games/DuelQueueModal.test.tsx`
Expected: PASS, 17 tests, 0 failures.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 4: Add direct unit tests for the module**

Create `src/Brmble.Web/src/components/Games/duelFormatting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { estimateText, formatDuration, pairLabel } from './duelFormatting';
import { knownEstimate, unknownEstimate } from './duelTestHarness';

const resolveName = (sessionId: number) => `Session${sessionId}`;

describe('duelFormatting', () => {
  it('formats seconds, exact minutes, and mixed minutes', () => {
    expect(formatDuration(25_000)).toBe('25s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(65_000)).toBe('1m 5s');
  });

  it('describes a known estimate with an approximation marker', () => {
    expect(estimateText(knownEstimate(25_000))).toBe('Estimated duration: ~25s');
  });

  it('describes an unknown estimate without inventing a value', () => {
    expect(estimateText(unknownEstimate)).toBe('Estimated duration: Unknown');
  });

  it('prefers the server display name and falls back to the resolver', () => {
    expect(pairLabel([
      { userId: 1, sessionId: 11, displayName: 'Qy', ready: false },
      { userId: 2, sessionId: 22, displayName: '  ', ready: false },
    ], resolveName)).toBe('Qy vs Session22');
  });

  it('falls back to the user id when there is no live session', () => {
    expect(pairLabel([
      { userId: 7, sessionId: 0, displayName: '', ready: false },
    ], resolveName)).toBe('Player 7');
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `npm test -- --run src/components/Games/duelFormatting.test.ts src/components/Games/DuelQueueModal.test.tsx`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/duelFormatting.ts src/Brmble.Web/src/components/Games/duelFormatting.test.ts src/Brmble.Web/src/components/Games/DuelQueueModal.tsx
git commit -m "refactor: share duel formatting helpers"
```

---

### Task 2: Add the queued-duel notification category

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:100-118`
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx:203`
- Test: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx`
- Test: `src/Brmble.Web/src/App.screenShareEnded.test.ts:30-47`

The confirmation is a repeatable informational notification, so `docs/UI_GUIDE.md` §13 item 8 requires it respect both the global switch and a category toggle.

- [ ] **Step 1: Write the failing tests**

Add to `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx`, following the file's existing render helper:

```tsx
  it('defaults the duel queue notification on and disables it with the global switch', () => {
    renderTab();

    const toggle = screen.getByLabelText('Duel queue updates');
    expect(toggle).toBeChecked();

    fireEvent.click(screen.getByLabelText('Disable optional notifications'));

    expect(screen.getByLabelText('Duel queue updates')).toBeDisabled();
  });
```

In `src/Brmble.Web/src/App.screenShareEnded.test.ts`, add `'notificationDuelQueued'` to the `categories` array at line 30 and add `notificationDuelQueued: true` to the settings object literals in that describe block so the shared assertions cover the new category.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/SettingsModal/MessagesSettingsTab.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Duel queue updates`.

- [ ] **Step 3: Add the category**

In `src/Brmble.Web/src/App.tsx`, add the key to the interface (after `notificationMovedChannel?: boolean;`):

```ts
  notificationDuelQueued?: boolean;
```

and to the defaults (after `notificationMovedChannel: true,`):

```ts
  notificationDuelQueued: true,
```

- [ ] **Step 4: Add the settings toggle**

In `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`, after the `notification-idle-warning` block, add a row matching the existing shape exactly:

```tsx
        <div className="settings-item settings-toggle">
          <label htmlFor="notification-duel-queued">Duel queue updates</label>
          <label className="brmble-toggle">
            <input
              id="notification-duel-queued"
              type="checkbox"
              checked={!localSettings.notificationsDisabled && localSettings.notificationDuelQueued}
              disabled={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationDuelQueued', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- --run src/components/SettingsModal/MessagesSettingsTab.test.tsx src/App.screenShareEnded.test.ts`
Expected: PASS, 0 failures.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.test.tsx src/Brmble.Web/src/App.screenShareEnded.test.ts
git commit -m "feat: add duel queue notification setting"
```

---

### Task 3: Derive the queue confirmation from snapshots

**Files:**
- Create: `src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.ts`
- Test: `src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.test.tsx`

This is the core of the feature. `game.accepted` carries an `offerId` while snapshots carry a `reservationId`, and they do not correlate, so the trigger is derived from snapshot transitions instead.

- [ ] **Step 1: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DuelPlayer, DuelQueueSnapshot, QueuedDuel, ReadyCheck } from '../../api/games';
import { knownEstimate, unknownEstimate } from './duelTestHarness';
import { useQueuedDuelConfirmation } from './useQueuedDuelConfirmation';

const SELF = 11;

const player = (sessionId: number): DuelPlayer =>
  ({ userId: sessionId * 100, sessionId, displayName: `P${sessionId}`, ready: false });

const queued = (reservationId: number, sessions: number[]): QueuedDuel => ({
  reservationId,
  position: 1,
  players: sessions.map(player),
  gameType: 'rps',
  format: 'bo3',
  rulesetVersion: 1,
  eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
  estimatedDuration: knownEstimate(12_000),
});

const ready = (reservationId: number, sessions: number[]): ReadyCheck => ({
  reservationId,
  expiresAt: '2026-07-30T00:00:30Z',
  players: sessions.map(player),
  gameType: 'rps',
  format: 'bo3',
  rulesetVersion: 1,
  estimatedDuration: unknownEstimate,
});

const snapshot = (
  channelId: number,
  parts: Partial<Pick<DuelQueueSnapshot, 'active' | 'readyCheck' | 'queue'>>,
): DuelQueueSnapshot => ({
  schemaVersion: 1,
  generation: 1,
  revision: 1,
  channelId,
  generatedAt: '2026-07-30T00:00:00Z',
  calculationTimeMs: 1,
  active: null,
  readyCheck: null,
  queue: [],
  ...parts,
});

const map = (...snapshots: DuelQueueSnapshot[]) =>
  new Map<number, DuelQueueSnapshot>(snapshots.map(s => [s.channelId, s]));

describe('useQueuedDuelConfirmation', () => {
  it('confirms when the local session newly appears in the queue', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    expect(result.current.confirmation).toBeNull();

    rerender({ byChannel: map(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });

    expect(result.current.confirmation?.reservationId).toBe(41);
    expect(result.current.confirmation?.gameType).toBe('rps');
  });

  it('stays silent when the pair goes straight to a ready check', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    rerender({ byChannel: map(snapshot(7, { readyCheck: ready(41, [SELF, 22]) })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('treats the first snapshot of a channel as a baseline', () => {
    const { result } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, { queue: [queued(41, [SELF, 22])] })) } },
    );

    expect(result.current.confirmation).toBeNull();
  });

  it('ignores queue entries the local session is not part of', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    rerender({ byChannel: map(snapshot(7, { queue: [queued(41, [33, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('confirms once per reservation, not on every later snapshot', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    rerender({ byChannel: map(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });
    result.current.dismiss();
    rerender({ byChannel: map(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('baselines each channel independently', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    rerender({ byChannel: map(snapshot(7, {}), snapshot(8, { queue: [queued(42, [SELF, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('does not confirm before the local session is known', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, 0),
      { initialProps: { byChannel: map(snapshot(7, {})) } },
    );

    rerender({ byChannel: map(snapshot(7, { queue: [queued(41, [0, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/Games/useQueuedDuelConfirmation.test.tsx`
Expected: FAIL — `Failed to resolve import "./useQueuedDuelConfirmation"`.

- [ ] **Step 3: Implement the hook**

Create `src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuelPlayer, DuelQueueSnapshot } from '../../api/games';

export interface QueuedDuelConfirmation {
  reservationId: number;
  players: DuelPlayer[];
  gameType: string;
  format: string;
}

/**
 * Confirms that an accepted challenge actually entered the queue.
 *
 * Derived from snapshots rather than `game.accepted`, because that event carries an
 * `offerId` while snapshots carry a `reservationId` and the two do not correlate.
 *
 * The immediate-start case suppresses itself: when a pair is accepted into an idle
 * channel the orchestrator promotes the reservation to a ready check before the
 * snapshot is built, so the client never observes it in `queue[]` and nothing fires.
 */
export function useQueuedDuelConfirmation(
  byChannel: Map<number, DuelQueueSnapshot>,
  selfSession: number,
): { confirmation: QueuedDuelConfirmation | null; dismiss: () => void } {
  const [confirmation, setConfirmation] = useState<QueuedDuelConfirmation | null>(null);
  // Reservations already announced. Ids are server-unique and never reused, so this
  // never needs pruning within a session.
  const announcedRef = useRef(new Set<number>());
  // Channels whose first snapshot has been consumed as a baseline. Without this a
  // reconnect or recovery snapshot would replay a confirmation for an old reservation.
  const baselinedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!selfSession) return;

    for (const [channelId, snapshot] of byChannel) {
      const mine = snapshot.queue.filter(
        entry => entry.players.some(player => player.sessionId === selfSession),
      );

      if (!baselinedRef.current.has(channelId)) {
        baselinedRef.current.add(channelId);
        for (const entry of mine) announcedRef.current.add(entry.reservationId);
        continue;
      }

      for (const entry of mine) {
        if (announcedRef.current.has(entry.reservationId)) continue;
        announcedRef.current.add(entry.reservationId);
        setConfirmation({
          reservationId: entry.reservationId,
          players: entry.players,
          gameType: entry.gameType,
          format: entry.format,
        });
      }
    }
  }, [byChannel, selfSession]);

  const dismiss = useCallback(() => setConfirmation(null), []);

  return { confirmation, dismiss };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run src/components/Games/useQueuedDuelConfirmation.test.tsx`
Expected: PASS, 7 tests.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.ts src/Brmble.Web/src/components/Games/useQueuedDuelConfirmation.test.tsx
git commit -m "feat: derive duel queue confirmation from snapshots"
```

---

### Task 4: Render the queue confirmation notification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (imports, hook call near the `personalDuelChannelIds` memo, register effect, render beside the other game notifications around line 4678)
- Test: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/Brmble.Web/src/App.duelOrchestration.test.tsx`, using that file's module-scope `renderApp`, `snapshot`, `queuedEntry`, `player`, `selfSession` and `connectSelf` helpers.

The file drives snapshot transitions by reassigning `mocks.duelQueue.byChannel` and then calling `rerender` (see the existing "resets the ready lock for a new reservation" test). The two-step baseline-then-queued sequence is required: the hook treats a channel's first snapshot as a baseline.

`player(n)` produces `displayName: 'Player n'`, so the pair label is deterministic.

```tsx
  it('confirms when your accepted challenge enters the queue', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    expect(screen.getByText('Challenge accepted')).toBeInTheDocument();
    expect(screen.getByText('Player 11 vs Player 22')).toBeInTheDocument();
  });

  it('does not confirm when the duel goes straight to a ready check', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: {
        reservationId: 42, expiresAt: new Date(Date.now() + 10_000).toISOString(),
        gameType: 'rps', format: 'bo3', rulesetVersion: 1,
        players: [player(selfSession), player(22)], estimatedDuration: unknownEstimate,
      },
    })]]);
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });

  it('suppresses the queue confirmation when its category is disabled', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void })
      .__emit('settings.current', { settings: { messages: { notificationDuelQueued: false } } }));

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Challenge accepted`.

- [ ] **Step 3: Call the hook**

In `src/Brmble.Web/src/App.tsx`, add the imports:

```ts
import { useQueuedDuelConfirmation } from './components/Games/useQueuedDuelConfirmation';
import { estimateText, pairLabel } from './components/Games/duelFormatting';
```

Directly after the `personalDuelChannelIds` memo:

```tsx
  const { confirmation: queuedDuelConfirmation, dismiss: dismissQueuedDuelConfirmation } =
    useQueuedDuelConfirmation(duelQueue.byChannel, selfSession);
  const showQueuedDuelConfirmation = queuedDuelConfirmation != null
    && shouldShowOptionalNotification(optionalNotificationSettings, 'notificationDuelQueued');
```

- [ ] **Step 4: Register it with the notification queue**

Add beside the other registration effects:

```tsx
  useEffect(() => {
    if (showQueuedDuelConfirmation) notifQueue.register('game-queued', 'info');
  }, [showQueuedDuelConfirmation, notifQueue]);
```

- [ ] **Step 5: Render it**

Immediately before the `readyCheck && notifQueue.isVisible('game-ready')` block:

```tsx
        {queuedDuelConfirmation && showQueuedDuelConfirmation && notifQueue.isVisible('game-queued') && (
          <Notification
            status="info"
            position="top-right"
            visible={true}
            title="Challenge accepted"
            detail={
              <>
                <div>{pairLabel(queuedDuelConfirmation.players, resolveGamePlayerName)}</div>
                <div>{gameDisplayName(queuedDuelConfirmation.gameType)} · {queuedDuelConfirmation.format}</div>
              </>
            }
            onDismiss={dismissQueuedDuelConfirmation}
            onExited={() => {
              notifQueue.unregister('game-queued');
              dismissQueuedDuelConfirmation();
            }}
          />
        )}
```

No `duration` prop: this uses the default `info` auto-dismiss, per `docs/UI_GUIDE.md` §13.

- [ ] **Step 6: Run the tests**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx`
Expected: PASS.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx
git commit -m "feat: confirm when your duel enters the queue"
```

---

### Task 5: Add opponent and duration to the ready notification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:4686`
- Test: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`

The ready notification currently shows only `Deathroll · 1v1`. It does not say who you are about to play, which is the fact most needed before pressing Ready.

- [ ] **Step 1: Write the failing test**

Add to `src/Brmble.Web/src/App.duelOrchestration.test.tsx`, importing `knownEstimate` from `./components/Games/duelTestHarness` alongside the existing `unknownEstimate` import:

```tsx
  it('shows the opponent pair and estimated duration on the ready notification', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: {
        reservationId: 42, expiresAt: new Date(Date.now() + 10_000).toISOString(),
        gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
        players: [player(selfSession), player(22)],
        estimatedDuration: knownEstimate(10_000),
      },
    })]]);
    renderApp();
    connectSelf(7);

    const notification = screen.getByText('Ready to play?').closest('.notification') as HTMLElement;
    expect(notification).toHaveTextContent('Player 11 vs Player 22');
    expect(notification).toHaveTextContent('Estimated duration: ~10s');
  });

  it('shows an unknown estimated duration on the ready notification', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: {
        reservationId: 42, expiresAt: new Date(Date.now() + 10_000).toISOString(),
        gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
        players: [player(selfSession), player(22)],
        estimatedDuration: unknownEstimate,
      },
    })]]);
    renderApp();
    connectSelf(7);

    const notification = screen.getByText('Ready to play?').closest('.notification') as HTMLElement;
    expect(notification).toHaveTextContent('Estimated duration: Unknown');
    expect(notification).not.toHaveTextContent('Starts in');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx`
Expected: FAIL — `expected element to have text content Estimated duration: ~10s`.

- [ ] **Step 3: Enrich the detail**

In `src/Brmble.Web/src/App.tsx`, replace the ready notification's `detail` prop (line 4686):

```tsx
            detail={
              <>
                <div>{pairLabel(readyCheck.players, resolveGamePlayerName)}</div>
                <div>
                  {gameDisplayName(readyCheck.gameType)} · {readyCheck.format} · {estimateText(readyCheck.estimatedDuration)}
                </div>
              </>
            }
```

Do not add a start ETA. Participant readiness controls advancement, so a start estimate would be misleading — this matches the panel card.

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run src/App.duelOrchestration.test.tsx src/components/Games/DuelQueueModal.test.tsx`
Expected: PASS.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx
git commit -m "feat: show opponent and duration on the ready check"
```

---

### Task 6: Document the pattern

**Files:**
- Modify: `docs/UI_GUIDE.md` (Project 1 duel sections, near the ready-check notification paragraph at line 278)

- [ ] **Step 1: Document both notifications**

In `docs/UI_GUIDE.md`, after the ready-check notification paragraph, add:

```markdown
#### Duel queue confirmation

When an accepted challenge enters the queue, both participants get one replaceable `info`
notification under the stable id `game-queued`, titled `Challenge accepted`, with the opponent pair
and the game/format line as detail. It uses the default `info` auto-dismiss and has no actions.

It is derived from queue snapshots, not from `game.accepted`: that event carries an `offerId` while
snapshots carry a `reservationId`, and the two do not correlate. A pair accepted into an idle channel
is promoted to a ready check before the snapshot is built, so it never appears queued and no
confirmation fires - the ready check is the confirmation in that case. The first snapshot per channel
is a baseline, so reconnecting never replays an old confirmation.

Being a repeatable informational notification, it respects Notifications -> `Disable optional
notifications` and the `notificationDuelQueued` category toggle.

The ready-check notification mirrors the panel's ready card: the opponent pair, then
`Deathroll · 1v1 · Estimated duration: ~10s`. Both render through
`components/Games/duelFormatting.ts` so the two cannot drift. The ready check shows **no** start ETA
in either place, because participant readiness controls advancement.
```

- [ ] **Step 2: Verify guide compliance**

Run: `npm test -- --run src/uiGuideCompliance.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: document duel queue confirmation notification"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the web suite**

Run: `npm test -- --run` (from `src/Brmble.Web`)
Expected: 0 failures.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `built in …`, exit 0.

- [ ] **Step 4: Confirm the server is untouched**

Run: `git diff --stat 0aaf566f..HEAD -- src/Brmble.Server tests`
Expected: empty output. This change is web-only.

- [ ] **Step 5: Report**

Report the suite, type-check, and build results verbatim.

Manual checks automation cannot cover, with two clients:
- Challenge someone while a duel is already running: both players see `Challenge accepted` with the correct opponent name and game.
- Challenge someone in an idle channel: no `Challenge accepted`, only `Ready to play?`.
- The ready notification names the opponent and shows the estimated duration.
- Turning off `Duel queue updates` in Messages settings suppresses the confirmation but not the ready check.
- Reconnect while queued: no stale `Challenge accepted` replay.
- Both notifications in Classic and Retro Terminal themes.
