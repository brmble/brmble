import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { SpectatorSnapshot, SpectatorSubscribeResponse } from '../../api/games';

/**
 * Test harness for `useSpectatorState`, modelled on `duelTestHarness.ts`.
 *
 * Kept separate from the duel harness because the spectator hook mocks the games
 * API down to just the two spectator calls; mixing the two mock surfaces would
 * make it impossible to tell which suite depends on which export.
 *
 * Usage from a test file (the `await import` form is required because `vi.mock`
 * factories are hoisted above the file's own imports):
 *
 * ```ts
 * vi.mock('../../bridge', async () => ({ default: (await import('./spectatorTestHarness')).bridge }));
 * vi.mock('../../api/games', async () => (await import('./spectatorTestHarness')).api);
 * ```
 */

/** Bridge listeners registered by the hook under test, keyed by event type. */
export const handlers = new Map<string, ((data: unknown) => void)[]>();

/** Stand-in for `../../bridge`'s default export. */
export const bridge = {
  _handlers: handlers,
  on: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, [...(handlers.get(type) ?? []), handler]);
  },
  off: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, (handlers.get(type) ?? []).filter(candidate => candidate !== handler));
  },
  send: vi.fn(),
  once: vi.fn(),
  init: vi.fn(),
};

/**
 * Stand-in for the `../../api/games` module. Only the two spectator calls the hook
 * actually invokes at runtime are present: every other games export the hook touches
 * is type-only and therefore erased before this mock is consulted.
 */
export const api = {
  subscribeSpectator: vi.fn<(channelId: number) => Promise<SpectatorSubscribeResponse>>(),
  unsubscribeSpectator: vi.fn<() => Promise<void>>(),
};

/** Dispatches a bridge event to the hook. Wraps `act` so callers never need to. */
export function emit(type: string, data: unknown) {
  act(() => { handlers.get(type)?.forEach(handler => handler(data)); });
}

/** Clears registered listeners and mock call history. Call from `beforeEach`. */
export function resetHarness() {
  handlers.clear();
  bridge.send.mockReset();
  api.subscribeSpectator.mockReset().mockResolvedValue({ channelId: 7, match: null });
  api.unsubscribeSpectator.mockReset().mockResolvedValue(undefined);
}

/**
 * A frame in the shape the SUBSCRIBE RESPONSE carries it (`SpectatorSubscribeResponse.match`),
 * which genuinely has no `type` discriminator. For the inbound bridge event use
 * {@link snapshotEvent} instead — the wire payload there is a strict superset of this.
 */
export function snapshot(overrides: Partial<SpectatorSnapshot> = {}): SpectatorSnapshot {
  return {
    schemaVersion: 1,
    matchId: 91,
    channelId: 7,
    gameType: 'deathroll',
    format: '1v1',
    rulesetVersion: 1,
    players: [
      { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
      { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
    ],
    sequence: 1,
    generatedAt: '2026-08-24T14:30:04.000Z',
    view: {
      kind: 'deathroll', players: [10, 20], currentPlayer: 20,
      ceiling: 50, lastRoll: 73, lastRollBy: 10, finished: false, loserId: null,
    },
    ...overrides,
  };
}

/**
 * A frame in the shape the BRIDGE EVENT actually delivers it.
 *
 * The server's `SpectatorSnapshotEvent` declares `Type` as its first field and
 * `MumbleAdapter` prefix-forwards the whole deserialised object, so the real
 * `game.spectatorSnapshot` payload carries a `type` property that the
 * `SpectatorSnapshot` interface does not declare. Tests emit through here so the
 * hook's guards are exercised against the true superset payload rather than a
 * convenient subset that would hide an over-strict exact-shape guard.
 */
export function snapshotEvent(
  overrides: Partial<SpectatorSnapshot> = {},
): SpectatorSnapshot & { type: string } {
  return { type: 'game.spectatorSnapshot', ...snapshot(overrides) };
}
