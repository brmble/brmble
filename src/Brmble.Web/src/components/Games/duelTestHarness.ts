import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { DurationEstimate } from '../../api/games';

/**
 * Shared test harness for the duel hooks (`useGameState`, `useDuelQueueState`).
 *
 * Both hooks talk to the same two modules — the bridge (inbound `game.*` events)
 * and the games API (outbound calls) — so they share one set of mocks and one
 * `emit` helper. Keeping a single harness prevents the two suites from drifting
 * into subtly different event-dispatch semantics.
 *
 * Usage from a test file (the `await import` form is required because `vi.mock`
 * factories are hoisted above the file's own imports):
 *
 * ```ts
 * vi.mock('../../bridge', async () => ({ default: (await import('./duelTestHarness')).bridge }));
 * vi.mock('../../api/games', async () => (await import('./duelTestHarness')).api);
 * ```
 */

/** Bridge listeners registered by the hook under test, keyed by event type. */
export const handlers = new Map<string, ((data: unknown) => void)[]>();

/** Stand-in for `../../bridge`'s default export. */
export const bridge = {
  on: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, [...(handlers.get(type) ?? []), handler]);
  },
  off: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, (handlers.get(type) ?? []).filter(candidate => candidate !== handler));
  },
};

/** Stand-in for the `../../api/games` module. */
export const api = {
  getQueueSnapshot: vi.fn(),
  respondReady: vi.fn().mockResolvedValue(undefined),
  requestRematch: vi.fn().mockResolvedValue(undefined),
  respondOffer: vi.fn().mockResolvedValue(undefined),
  cancelOffer: vi.fn().mockResolvedValue(undefined),
  respond: vi.fn().mockResolvedValue(undefined),
  invite: vi.fn().mockResolvedValue(undefined),
  sendAction: vi.fn().mockResolvedValue(undefined),
  forfeit: vi.fn().mockResolvedValue(undefined),
  GameApiError: class extends Error {},
};

/** Dispatches a bridge event to the hook. Wraps `act` so callers never need to. */
export function emit(type: string, data: unknown) {
  act(() => handlers.get(type)?.forEach(handler => handler(data)));
}

/** Clears registered listeners and mock call history. Call from `beforeEach`. */
export function resetHarness() {
  handlers.clear();
  vi.clearAllMocks();
}

/**
 * Shared "no estimate yet" {@link DurationEstimate} for fixtures that construct
 * `ActiveDuel` / `ReadyCheck` / `QueuedDuel` but do not assert on the duration.
 * Every wire entry carries an estimate, so fixtures must supply one too.
 */
export const unknownEstimate: DurationEstimate = {
  status: 'unknown', milliseconds: null, sampleCount: 0,
  method: 'insufficient', approximate: true,
};

/** Counterpart to {@link unknownEstimate} for fixtures that do assert on a duration. */
export function knownEstimate(milliseconds: number): DurationEstimate {
  return { status: 'known', milliseconds, sampleCount: 11, method: 'fullMedian', approximate: true };
}
