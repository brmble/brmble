import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDuelQueueState, type DuelQueueSnapshot } from './useDuelQueueState';
import { useGameState } from './useGameState';

const { handlers, api } = vi.hoisted(() => ({
  handlers: new Map<string, ((data: unknown) => void)[]>(),
  api: {
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
  },
}));

vi.mock('../../bridge', () => ({
  default: {
    on: (type: string, handler: (data: unknown) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    off: (type: string, handler: (data: unknown) => void) => {
      handlers.set(type, (handlers.get(type) ?? []).filter(candidate => candidate !== handler));
    },
  },
}));

vi.mock('../../api/games', () => api);

function emit(type: string, data: unknown) {
  act(() => handlers.get(type)?.forEach(handler => handler(data)));
}

function snapshot(
  channelId: number,
  generation: number,
  revision: number,
  queue: DuelQueueSnapshot['queue'] = [],
): DuelQueueSnapshot {
  return {
    schemaVersion: 1,
    channelId,
    generation,
    revision,
    generatedAt: '2026-07-25T12:00:00Z',
    calculationTimeMs: 1,
    active: null,
    readyCheck: null,
    queue,
  };
}

const queued = [{
  reservationId: 21,
  position: 1,
  players: [{ userId: 1, sessionId: 11, displayName: 'One', ready: false }],
  gameType: 'rps',
  format: 'bestOf3',
  rulesetVersion: 1,
  eta: { status: 'unknown' as const, estimatedStartAt: null, milliseconds: null, approximate: true as const, segments: [] },
}];

describe('useDuelQueueState', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    api.getQueueSnapshot.mockReturnValue(new Promise(() => {}));
  });

  it('applies only newer revisions within a generation and keeps an empty replacement', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    emit('game.queueSnapshot', snapshot(2, 3, 3));
    emit('game.queueSnapshot', snapshot(2, 3, 4));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);

    emit('game.queueSnapshot', snapshot(2, 3, 5));
    expect(result.current.byChannel.get(2)?.queue).toEqual([]);
  });

  it('accepts a higher generation with a lower revision and rejects a lower generation', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 5, 20, queued));
    emit('game.queueSnapshot', snapshot(2, 6, 1));
    emit('game.queueSnapshot', snapshot(2, 5, 99, queued));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 6, 1));
  });

  it('tracks channels independently', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 1, 2, queued));
    emit('game.queueSnapshot', snapshot(7, 4, 1));
    expect([...result.current.byChannel.keys()]).toEqual([2, 7]);
  });

  it('removes the previous channel, ignores its late snapshot, and requests the current channel', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 1, 2, queued));
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    expect(result.current.byChannel.has(2)).toBe(false);
    emit('game.queueSnapshot', snapshot(2, 1, 3, queued));
    expect(result.current.byChannel.has(2)).toBe(false);
    await waitFor(() => expect(api.getQueueSnapshot).toHaveBeenCalledOnce());
    expect(result.current.byChannel.get(2)).toBeUndefined();
  });

  it('allows a channel again after voice returns to it', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    emit('voice.channelChanged', { previousChannelId: 7, channelId: 2 });
    emit('game.queueSnapshot', snapshot(2, 2, 1, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);
  });

  it('reset clears all channel snapshots and movement authorization state', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    emit('game.queueSnapshot', snapshot(7, 1, 1, queued));
    act(() => result.current.reset());
    expect(result.current.byChannel.size).toBe(0);
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued));
    expect(result.current.byChannel.has(2)).toBe(true);
  });

  it('applies requested snapshots through the same tuple gate and contains errors', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 2, 5, queued));
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 2, 4));
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.get(2)?.revision).toBe(5);
    api.getQueueSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current.requestSnapshot()).resolves.toBeUndefined();
  });

  it('delegates ready, rematch, offer response, and offer cancellation exactly', () => {
    const { result } = renderHook(() => useDuelQueueState());
    act(() => {
      result.current.respondReady(12, true);
      result.current.requestRematch(34);
      result.current.respondOffer(56, false);
      result.current.cancelOffer(78);
    });
    expect(api.respondReady).toHaveBeenCalledWith(12, true);
    expect(api.requestRematch).toHaveBeenCalledWith(34);
    expect(api.respondOffer).toHaveBeenCalledWith(56, false);
    expect(api.cancelOffer).toHaveBeenCalledWith(78);
  });

  it('cleans up listeners on unmount without duplicating handlers', () => {
    const first = renderHook(() => useDuelQueueState());
    first.unmount();
    const second = renderHook(() => useDuelQueueState());
    expect(handlers.get('game.queueSnapshot')).toHaveLength(1);
    expect(handlers.get('voice.channelChanged')).toHaveLength(1);
    second.unmount();
    expect(handlers.get('game.queueSnapshot')).toHaveLength(0);
  });

  it('tracks incoming and outgoing rematch offers until terminal events', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.rematchOffered', { offerId: 9, sourceMatchId: 4, fromSessionId: 22, gameType: 'rps' });
    expect(result.current.incomingRematch?.offerId).toBe(9);
    emit('game.rematchPending', { offerId: 10, sourceMatchId: 4, toSessionId: 33, gameType: 'rps' });
    expect(result.current.outgoingRematch?.offerId).toBe(10);
    emit('game.rematchAccepted', { offerId: 9 });
    expect(result.current.incomingRematch).toBeNull();
    emit('game.rematchCanceled', { offerId: 10 });
    expect(result.current.outgoingRematch).toBeNull();
  });
});

describe('useGameState duel offer contracts', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('uses offerId for responses and cancellation, with matchId as an event fallback', () => {
    const { result } = renderHook(() => useGameState(11));
    emit('game.invited', { offerId: 5, matchId: 99, from: 22, gameType: 'rps' });
    act(() => result.current.acceptInvite());
    expect(api.respondOffer).toHaveBeenCalledWith(5, true);

    emit('game.invitePending', { matchId: 7, target: 22, gameType: 'rps' });
    act(() => result.current.cancelInvite());
    expect(api.cancelOffer).toHaveBeenCalledWith(7);
    expect(api.forfeit).not.toHaveBeenCalled();
  });

  it('retains the completed source match id and configuration', () => {
    const { result } = renderHook(() => useGameState(11));
    emit('game.started', { matchId: 0, gameType: 'rps', format: 'bestOf3', rulesetVersion: 2, options: { bestOf: 3 }, views: [] });
    emit('game.ended', { matchId: 0, gameType: 'rps', draw: true });
    expect(result.current.ended).toMatchObject({
      matchId: 0,
      sourceMatchId: 0,
      gameType: 'rps',
      format: 'bestOf3',
      rulesetVersion: 2,
      options: { bestOf: 3 },
    });
  });
});
