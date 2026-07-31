import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameState } from './useGameState';
import { useDuelQueueState } from './useDuelQueueState';
import { emit, resetHarness } from './duelTestHarness';

vi.mock('../../bridge', async () => ({ default: (await import('./duelTestHarness')).bridge }));
vi.mock('../../api/games', async () => (await import('./duelTestHarness')).api);

/**
 * `useGameState` and `useDuelQueueState` both listen to `game.error`. Each one
 * renders its own persistent (duration: null) error notification, so any command
 * reported by both produces two boxes the user has to click away for one failure.
 * These tests pin the ownership split declared in `useGameState`'s
 * DUEL_QUEUE_OWNED_COMMANDS.
 */
describe('duel command error ownership', () => {
  beforeEach(resetHarness);

  it('reports a rejected rematch request only through the duel queue hook', () => {
    const game = renderHook(() => useGameState(11));
    const queue = renderHook(() => useDuelQueueState());

    emit('game.error', {
      command: 'game.rematch', path: 'games/rematch',
      error: 'A player is already committed.', statusCode: 400,
      reason: 'alreadyCommitted', sourceMatchId: 91,
    });

    expect(queue.result.current.commandError).toMatchObject({
      operation: 'requestRematch', id: 91, reason: 'alreadyCommitted',
      message: 'A player is already committed.',
    });
    expect(game.result.current.lastError).toBeNull();
  });

  it('reports a rejected ready only through the duel queue hook', () => {
    const game = renderHook(() => useGameState(11));
    const queue = renderHook(() => useDuelQueueState());

    emit('game.error', {
      command: 'game.ready', path: 'games/ready',
      error: 'This ready check is no longer available.', statusCode: 400,
      reason: 'staleOffer', reservationId: 12,
    });

    expect(queue.result.current.commandError).toMatchObject({ operation: 'ready', id: 12 });
    expect(game.result.current.lastError).toBeNull();
  });

  // The failure mode to avoid while narrowing `useGameState`: an error the duel
  // queue hook does not correlate must still reach `lastError`, or it goes silent.
  it('still reports an error that carries no command', () => {
    const game = renderHook(() => useGameState(11));
    const queue = renderHook(() => useDuelQueueState());

    emit('game.error', { error: 'The duel service is unavailable.', statusCode: 503 });

    expect(queue.result.current.commandError).toBeNull();
    expect(game.result.current.lastError).toBe('The duel service is unavailable.');
  });

  it('still reports an error whose command is not owned by the duel queue hook', () => {
    const game = renderHook(() => useGameState(11));
    const queue = renderHook(() => useDuelQueueState());

    emit('game.error', {
      command: 'game.action', path: 'games/action',
      error: 'That action is not allowed.', statusCode: 400,
    });

    expect(queue.result.current.commandError).toBeNull();
    expect(game.result.current.lastError).toBe('That action is not allowed.');
  });
});
