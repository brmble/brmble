import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function snapshot(
  channelId: number,
  generation: number,
  revision: number,
  queue: DuelQueueSnapshot['queue'] = [],
  generatedAt = '2026-07-25T12:00:00Z',
): DuelQueueSnapshot {
  return {
    schemaVersion: 1,
    channelId,
    generation,
    revision,
    generatedAt,
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

  afterEach(() => vi.useRealTimers());

  function connect(channelId = 2) {
    emit('voice.connected', { channelId });
  }

  it('recovers on voice.connected without an external snapshot request', async () => {
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await waitFor(() => expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0)));
  });

  it('recovers when an external request is discarded by the connect handler', async () => {
    const stale = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(snapshot(2, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    const staleRequest = result.current.requestSnapshot();
    connect(2);
    await act(async () => stale.resolve(snapshot(2, 1, 0)));
    await staleRequest;

    await waitFor(() => expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0)));
  });

  it('applies only newer revisions within a generation and keeps an empty replacement', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 3, 3));
    connect();
    await act(() => result.current.requestSnapshot());
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    emit('game.queueSnapshot', snapshot(2, 3, 3));
    emit('game.queueSnapshot', snapshot(2, 3, 4));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);

    emit('game.queueSnapshot', snapshot(2, 3, 5));
    expect(result.current.byChannel.get(2)?.queue).toEqual([]);
  });

  it('accepts a higher generation with a lower revision and rejects a lower generation', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 5, 19));
    connect();
    await act(() => result.current.requestSnapshot());
    emit('game.queueSnapshot', snapshot(2, 5, 20, queued));
    emit('game.queueSnapshot', snapshot(2, 6, 1));
    emit('game.queueSnapshot', snapshot(2, 5, 99, queued));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 6, 1));
  });

  it('ignores snapshots before recovery and from unrelated channels', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    emit('game.queueSnapshot', snapshot(2, 1, 2, queued));
    expect(result.current.byChannel.size).toBe(0);
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(7, 4, 0));
    connect(7);
    await act(() => result.current.requestSnapshot());
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
    await waitFor(() => expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2));
    expect(result.current.byChannel.get(2)).toBeUndefined();
  });

  it('allows a channel again after voice returns to it', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    api.getQueueSnapshot
      .mockResolvedValueOnce(snapshot(2, 1, 0))
      .mockResolvedValueOnce(snapshot(7, 1, 0))
      .mockResolvedValueOnce(snapshot(2, 2, 0));
    connect();
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    await waitFor(() => expect(result.current.byChannel.has(7)).toBe(true));
    emit('voice.channelChanged', { previousChannelId: 7, channelId: 2 });
    await waitFor(() => expect(result.current.byChannel.has(2)).toBe(true));
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

  it('keeps a same-channel delayed push hidden before failed recovery', async () => {
    const recovery = deferred<DuelQueueSnapshot>();
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    act(() => result.current.reset());
    api.getQueueSnapshot.mockReturnValueOnce(recovery.promise);
    connect(2);
    const request = result.current.requestSnapshot();
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    expect(result.current.byChannel.size).toBe(0);
    await act(async () => recovery.reject(new Error('offline')));
    await request;
    expect(result.current.byChannel.size).toBe(0);
  });

  it('ignores higher pushes while recovery is pending and after failure, then accepts pushes after retry', async () => {
    const firstRecovery = deferred<DuelQueueSnapshot>();
    const t1 = '2026-07-25T12:00:00Z';
    const t2 = '2026-07-25T12:01:00Z';
    const t3 = '2026-07-25T12:02:00Z';
    const { result } = renderHook(() => useDuelQueueState());
    api.getQueueSnapshot.mockReturnValueOnce(firstRecovery.promise);
    connect(2);
    const firstRequest = result.current.requestSnapshot();
    emit('game.queueSnapshot', snapshot(2, 9, 9, queued, t1));
    expect(result.current.byChannel.size).toBe(0);
    await act(async () => firstRecovery.reject(new Error('offline')));
    await firstRequest;
    emit('game.queueSnapshot', snapshot(2, 10, 1, queued, t2));
    expect(result.current.byChannel.size).toBe(0);

    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 0, [], t2));
    await act(() => result.current.requestSnapshot());
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued, t3));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 1, queued, t3));
  });

  it('automatically retries failed recovery and then accepts newer pushes', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snapshot(2, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    emit('game.queueSnapshot', snapshot(2, 9, 9, queued));
    expect(result.current.byChannel.size).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0));
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);
  });

  it('cancels an old-channel retry on movement', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snapshot(7, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.byChannel.has(2)).toBe(false);
    expect(result.current.byChannel.has(7)).toBe(true);
  });

  it('cancels retry timers on reset and unmount', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot.mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => first.result.current.requestSnapshot());
    act(() => first.result.current.reset());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(1);

    connect(2);
    await act(() => first.result.current.requestSnapshot());
    first.unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially between repeated recovery failures', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    expect(vi.getTimerCount()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);

    // Second retry waits 2s, not another 1s.
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(3);

    // Third retry waits 4s.
    await act(() => vi.advanceTimersByTimeAsync(3999));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('caps recovery backoff at 30s', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    // 1s + 2s + 4s + 8s + 16s of backoff.
    for (const delay of [1000, 2000, 4000, 8000, 16_000]) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
    }
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(6);

    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(6);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(7);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(8);
  });

  it('restarts backoff after a voice event', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);

    connect(2);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(4);
  });

  it('retries an old-channel recovery response and accepts the current channel', async () => {
    vi.useFakeTimers();
    api.getQueueSnapshot
      .mockResolvedValueOnce(snapshot(2, 1, 0))
      .mockResolvedValueOnce(snapshot(7, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    connect(7);
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.size).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.byChannel.has(7)).toBe(true);
  });

  it.each([
    ['invalid schema', { ...snapshot(2, 1, 0), schemaVersion: 2 }],
    ['malformed generatedAt', { ...snapshot(2, 1, 0), generatedAt: 'bad' }],
    ['null queue', { ...snapshot(2, 1, 0), queue: null }],
  ])('retries a recovery response with %s exactly once', async (_name, invalid) => {
    vi.useFakeTimers();
    api.getQueueSnapshot
      .mockResolvedValueOnce(invalid as unknown as DuelQueueSnapshot)
      .mockResolvedValueOnce(snapshot(2, 1, 0));
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.size).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.getQueueSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.byChannel.has(2)).toBe(true);
  });

  it('ignores pushes for a moved-to channel until its automatic recovery completes', async () => {
    const recovery = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot
      .mockReturnValueOnce(new Promise<DuelQueueSnapshot>(() => {}))
      .mockReturnValueOnce(recovery.promise);
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    emit('voice.channelChanged', { previousChannelId: 2, channelId: 7 });
    emit('game.queueSnapshot', snapshot(7, 20, 1, queued));
    expect(result.current.byChannel.has(7)).toBe(false);
    await act(async () => recovery.resolve(snapshot(7, 1, 0)));
    expect(result.current.byChannel.get(7)).toEqual(snapshot(7, 1, 0));
  });

  it('rebases the same exact tuple from authenticated recovery after reconnect', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect(2);
    emit('game.queueSnapshot', snapshot(2, 3, 4, queued));
    act(() => result.current.reset());
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 3, 4, queued));
    connect(2);
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 3, 4, queued));
  });

  it('rebases a lower server-restart tuple from authenticated recovery', async () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 8, 20, queued));
    act(() => result.current.reset());
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 0));
    connect();
    await act(() => result.current.requestSnapshot());
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0));
    emit('game.queueSnapshot', snapshot(2, 1, 0, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual([]);
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued));
    expect(result.current.byChannel.get(2)?.queue).toEqual(queued);
  });

  it('rejects pre-recovery high tuples by timestamp after a lower-tuple rebase', async () => {
    const t1 = '2026-07-25T12:00:00Z';
    const t2 = '2026-07-25T12:01:00Z';
    const t3 = '2026-07-25T12:02:00Z';
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 8, 20, queued, t1));
    act(() => result.current.reset());
    api.getQueueSnapshot.mockResolvedValueOnce(snapshot(2, 1, 0, [], t2));
    connect();
    await act(() => result.current.requestSnapshot());

    emit('game.queueSnapshot', snapshot(2, 8, 20, queued, t1));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 0, [], t2));
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued, t3));
    expect(result.current.byChannel.get(2)).toEqual(snapshot(2, 1, 1, queued, t3));
  });

  it('rejects push snapshots with malformed generatedAt', () => {
    const { result } = renderHook(() => useDuelQueueState());
    connect();
    emit('game.queueSnapshot', snapshot(2, 1, 1, queued, 'not-a-date'));
    expect(result.current.byChannel.size).toBe(0);
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
    vi.useFakeTimers();
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
    expect(vi.getTimerCount()).toBe(0);
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

  it('coalesces overlapping snapshot requests', async () => {
    const recovery = deferred<DuelQueueSnapshot>();
    api.getQueueSnapshot.mockReturnValueOnce(recovery.promise);
    const { result } = renderHook(() => useDuelQueueState());
    const firstRequest = result.current.requestSnapshot();
    const secondRequest = result.current.requestSnapshot();
    expect(api.getQueueSnapshot).toHaveBeenCalledOnce();
    await act(async () => recovery.resolve(snapshot(2, 1, 1, queued)));
    await Promise.all([firstRequest, secondRequest]);
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

  it('reports correlated bridge command failures with a monotonic revision', () => {
    const { result } = renderHook(() => useDuelQueueState());

    emit('game.error', { command: 'game.ready', path: 'games/ready', reservationId: 12, reason: 'stale' });
    expect(result.current.commandError).toMatchObject({ revision: 1, operation: 'ready', id: 12, reason: 'stale' });
    emit('game.error', { command: 'game.respond', path: 'games/respond', offerId: 56, reason: 'expired' });
    expect(result.current.commandError).toMatchObject({ revision: 2, operation: 'respondOffer', id: 56, reason: 'expired' });
  });

  it('reports direct ready and offer response rejections', async () => {
    api.respondReady.mockRejectedValueOnce(new Error('ready rejected'));
    api.respondOffer.mockRejectedValueOnce(new Error('offer rejected'));
    const { result } = renderHook(() => useDuelQueueState());

    act(() => result.current.respondReady(12, true));
    await waitFor(() => expect(result.current.commandError).toMatchObject({ operation: 'ready', id: 12 }));
    act(() => result.current.respondOffer(56, true));
    await waitFor(() => expect(result.current.commandError).toMatchObject({ operation: 'respondOffer', id: 56 }));
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

  it('uses offerId for responses and cancellation without accepting matchId aliases', () => {
    const { result } = renderHook(() => useGameState(11));
    emit('game.invited', { offerId: 5, matchId: 99, from: 22, gameType: 'rps' });
    act(() => result.current.acceptInvite());
    expect(api.respondOffer).toHaveBeenCalledWith(5, true);

    emit('game.invitePending', { matchId: 7, target: 22, gameType: 'rps' });
    act(() => result.current.cancelInvite());
    expect(api.cancelOffer).not.toHaveBeenCalled();
    emit('game.invitePending', { offerId: 7, target: 22, gameType: 'rps' });
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
