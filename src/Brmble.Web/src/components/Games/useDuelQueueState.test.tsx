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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
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

  function connect(channelId = 2) {
    emit('voice.connected', { channelId });
  }

  it('applies only newer revisions within a generation and keeps an empty replacement', () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    emit('game.queueSnapshot', snapshot(2, 3, 3));
    emit('game.queueSnapshot', snapshot(2, 3, 4));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);

    emit('game.queueSnapshot', snapshot(2, 3, 5));
    expect(result.current.byChannel.get(2)?.queue).toEqual([]);
  });

  it('accepts a higher generation with a lower revision and rejects a lower generation', () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 5, 20, queued));
    emit('game.queueSnapshot', snapshot(2, 6, 1));
    emit('game.queueSnapshot', snapshot(2, 5, 99, queued));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 6, 1));
  });

  it('ignores snapshots before connection and from unrelated channels', () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 1, 2, queued));
    expect(result.current.byChannel.size).toBe(0);
    connect(7);
    emit('game.queueSnapshot', snapshot(2, 1, 3, queued));
    emit('game.queueSnapshot', snapshot(7, 4, 1));
    expect([...result.current.byChannel.keys()]).toEqual([7]);
  });

  it('removes the previous channel, ignores its late snapshot, and requests the current channel', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
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
    connect();
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    emit('voice.channelChanged', { previousChannelId: 7, channelId: 2 });
    emit('game.queueSnapshot', snapshot(2, 2, 1, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);
  });

  it('reset clears snapshots and rejects delayed events until reconnect', () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect(7);
    emit('game.queueSnapshot', snapshot(7, 1, 1, queued));
    act(() => result.current.reset());
    expect(result.current.byChannel.size).toBe(0);
    emit('game.queueSnapshot', snapshot(7, 1, 2, queued));
    expect(result.current.byChannel.size).toBe(0);
  });

  it('rebases the same exact tuple from authenticated recovery after reconnect', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    act(() => result.current.reset());
    connect(2);
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 3, 4, queued));
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 3, 4, queued));
  });

  it('rebases a lower server-restart tuple from authenticated recovery', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 8, 20, queued));
    act(() => result.current.reset());
    connect();
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 0));
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0));
    emit('game.queueSnapshot', snapshot(2, 1, 0, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual([]);
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);
  });

  it('contains recovery errors', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    api.getQueueSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current.requestSnapshot()).resolves.toBeUndefined();
  });

  it('ignores a deferred snapshot resolved after reset', async () => {
    const pending = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useDuelQueueState());
    const request = result.current.requestSnapshot();
    act(() => result.current.reset());
    await act(async () => pending.resolve(snapshot(2, 1, 1, queued)));
    await request;
    expect(result.current.byChannel.size).toBe(0);
  });

  it('ignores an old-channel request resolved after movement', async () => {
    const oldRequest = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(oldRequest.promise);
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    const request = result.current.requestSnapshot();
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    await act(async () => oldRequest.resolve(snapshot(2, 1, 1, queued)));
    await request;
    expect(result.current.byChannel.has(2)).toBe(false);
  });

  it('ignores an old request epoch and rebases from the current recovery response', async () => {
    const oldRequest = deferred<DuelQueueSnapshot>();
    const currentRequest = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    const old = result.current.requestSnapshot();
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    await act(async () => oldRequest.resolve(snapshot(2, 9, 9, queued)));
    await old;
    expect(result.current.byChannel.size).toBe(0);
    await act(async () => currentRequest.resolve(snapshot(7, 0, 0, queued)));
    expect(result.current.byChannel.get(7)).toEqual(snapshot(7, 0, 0, queued));
  });

  it('ignores a deferred snapshot after unmount without a React warning', async () => {
    const pending = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useDuelQueueState());
    const request = result.current.requestSnapshot();
    unmount();
    await act(async () => pending.resolve(snapshot(2, 1, 1, queued)));
    await request;
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('lets only the latest overlapping snapshot request apply', async () => {
    const first = deferred<DuelQueueSnapshot>();
    const second = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDuelQueueState());
    const firstRequest = result.current.requestSnapshot();
    const secondRequest = result.current.requestSnapshot();
    await act(async () => second.resolve(snapshot(2, 1, 1, queued)));
    await secondRequest;
    await act(async () => first.resolve(snapshot(3, 1, 1, queued)));
    await firstRequest;
    expect([...result.current.byChannel.keys()]).toEqual([2]);
  });

  it('accepts requests after StrictMode replays the subscription effect', async () => {
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 1, queued));
    const { result } = renderHook(() => useDuelQueueState(), { reactStrictMode: true });
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.has(2)).toBe(true);
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
    expect(handlers.get('voice.connected')).toHaveLength(1);
    second.unmount();
    expect(handlers.get('game.queueSnapshot')).toHaveLength(0);
    expect(handlers.get('voice.connected')).toHaveLength(0);
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

  it('prefers canonical configuration on the ended event', () => {
    const { result } = renderHook(() => useGameState(11));
    emit('game.started', { matchId: 8, gameType: 'rps', format: 'old', rulesetVersion: 1, options: {}, views: [] });
    emit('game.ended', { matchId: 8, gameType: 'rps', format: 'bo5', rulesetVersion: 3, options: { bestOf: 5 }, draw: true });
    expect(result.current.ended).toMatchObject({
      sourceMatchId: 8,
      format: 'bo5',
      rulesetVersion: 3,
      options: { bestOf: 5 },
    });
  });
});
