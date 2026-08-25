import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpectatorState } from './useSpectatorState';
import { api, emit, resetHarness, snapshot, snapshotEvent } from './spectatorTestHarness';

vi.mock('../../bridge', async () => ({ default: (await import('./spectatorTestHarness')).bridge }));
vi.mock('../../api/games', async () => (await import('./spectatorTestHarness')).api);

describe('useSpectatorState', () => {
  beforeEach(resetHarness);

  it('starts idle', () => {
    const { result } = renderHook(() => useSpectatorState());
    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
    expect(result.current.ended).toBeNull();
    expect(result.current.closeReason).toBeNull();
  });

  it('subscribes to a channel and stages the returned live match', async () => {
    api.subscribeSpectator.mockResolvedValue({ channelId: 7, match: snapshot({ sequence: 4 }) });
    const { result } = renderHook(() => useSpectatorState());

    await act(async () => { await result.current.startSpectating(7); });

    expect(api.subscribeSpectator).toHaveBeenCalledWith(7);
    expect(result.current.spectatingChannelId).toBe(7);
    expect(result.current.match?.sequence).toBe(4);
  });

  it('subscribing to an idle channel is a success with no match', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    expect(result.current.spectatingChannelId).toBe(7);
    expect(result.current.match).toBeNull();
  });

  it('honours the subscribe response channel over the requested one', async () => {
    api.subscribeSpectator.mockResolvedValue({ channelId: 9, match: null });
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    expect(result.current.spectatingChannelId).toBe(9);
    emit('game.spectatorSnapshot', snapshotEvent({ channelId: 9, sequence: 2 }));
    expect(result.current.match?.sequence).toBe(2);
  });

  it('does not start spectating when the subscribe rejects', async () => {
    api.subscribeSpectator.mockRejectedValue(new Error('notSameChannel'));
    const { result } = renderHook(() => useSpectatorState());

    await expect(act(async () => { await result.current.startSpectating(7); })).rejects.toThrow();

    expect(result.current.spectatingChannelId).toBeNull();
  });

  it('accepts the real event payload, which carries an extra `type` field', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    const frame = snapshotEvent({ sequence: 2 });
    expect(frame.type).toBe('game.spectatorSnapshot');
    emit('game.spectatorSnapshot', frame);

    expect(result.current.match?.sequence).toBe(2);
  });

  it('ignores frames while idle', () => {
    const { result } = renderHook(() => useSpectatorState());

    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 5 }));

    expect(result.current.match).toBeNull();
  });

  it('ignores frames at or below the sequence high-water mark', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 3 }));
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 2 }));
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 3 }));

    expect(result.current.match?.sequence).toBe(3);
  });

  it('ignores frames for another channel and a wrong schema version', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', snapshotEvent({ channelId: 8, sequence: 5 }));
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 5, schemaVersion: 2 as 1 }));

    expect(result.current.match).toBeNull();
  });

  it('ignores structurally malformed frames', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', null);
    emit('game.spectatorSnapshot', { type: 'game.spectatorSnapshot' });
    emit('game.spectatorSnapshot', { ...snapshotEvent({ sequence: 5 }), view: undefined });
    emit('game.spectatorSnapshot', { ...snapshotEvent({ sequence: 5 }), matchId: '91' });
    emit('game.spectatorSnapshot', { ...snapshotEvent({ sequence: 5 }), sequence: null });

    expect(result.current.match).toBeNull();
  });

  it('transitions to the next match with no resubscribe, resetting the sequence gate', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', snapshotEvent({ matchId: 91, sequence: 9 }));
    emit('game.spectatorMatchEnded', {
      schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 9,
      outcome: { winnerId: 10, loserId: 20, draw: false },
    });
    expect(result.current.ended?.matchId).toBe(91);
    // `ended` must NOT clear `match`: the Ended stage shows the same board.
    expect(result.current.match?.matchId).toBe(91);

    // Sequence 1 is BELOW the old high-water mark of 9, but belongs to a new match.
    emit('game.spectatorSnapshot', snapshotEvent({ matchId: 92, sequence: 1 }));

    expect(api.subscribeSpectator).toHaveBeenCalledTimes(1);
    expect(result.current.ended).toBeNull();
    expect(result.current.match?.matchId).toBe(92);
    expect(result.current.match?.sequence).toBe(1);
  });

  it('a match ending does not stop spectating', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorMatchEnded', {
      schemaVersion: 1, matchId: 91, channelId: 7, reason: 'forfeited', finalSequence: 3,
      outcome: { winnerId: 10, loserId: 20, draw: false },
    });

    expect(result.current.spectatingChannelId).toBe(7);
    expect(api.unsubscribeSpectator).not.toHaveBeenCalled();
  });

  it('ignores a match-ended for another channel or a wrong schema version', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    const base = {
      matchId: 91, reason: 'completed' as const, finalSequence: 3,
      outcome: { winnerId: 10, loserId: 20, draw: false },
    };

    emit('game.spectatorMatchEnded', { ...base, schemaVersion: 1, channelId: 8 });
    emit('game.spectatorMatchEnded', { ...base, schemaVersion: 2, channelId: 7 });

    expect(result.current.ended).toBeNull();
  });

  it.each([
    ['unsubscribed'], ['authorizationLost'], ['disconnected'], ['channelRemoved'],
  ])('clears everything on a %s close', async (reason) => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 1 }));

    // Deliberately no `schemaVersion`: the close event does not carry one.
    emit('game.spectatorClosed', { channelId: 7, reason });

    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
    expect(result.current.ended).toBeNull();
    expect(result.current.closeReason).toBe(reason);
  });

  it('ignores a close for a channel it is not watching', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorClosed', { channelId: 8, reason: 'channelRemoved' });

    expect(result.current.spectatingChannelId).toBe(7);
    expect(result.current.closeReason).toBeNull();
  });

  it('a fresh subscribe clears a previous close reason', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    emit('game.spectatorClosed', { channelId: 7, reason: 'authorizationLost' });
    expect(result.current.closeReason).toBe('authorizationLost');

    await act(async () => { await result.current.startSpectating(7); });

    expect(result.current.closeReason).toBeNull();
    expect(result.current.spectatingChannelId).toBe(7);
  });

  it('stopSpectating unsubscribes and clears immediately', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    act(() => { result.current.stopSpectating(); });

    expect(result.current.spectatingChannelId).toBeNull();
    await waitFor(() => expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1));
  });

  it('stopSpectating still clears when the unsubscribe rejects', async () => {
    api.unsubscribeSpectator.mockRejectedValue(new Error('Not connected'));
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    act(() => { result.current.stopSpectating(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.spectatingChannelId).toBeNull();
  });

  it.each([['voice.connected'], ['voice.channelChanged']])('resets on %s', async (event) => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 2 }));

    emit(event, { channelId: 8 });

    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
    expect(result.current.ended).toBeNull();
    expect(result.current.closeReason).toBeNull();
  });

  it('does not resubscribe implicitly after a voice reset', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('voice.connected', { channelId: 7 });
    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 5 }));

    expect(api.subscribeSpectator).toHaveBeenCalledTimes(1);
    expect(result.current.match).toBeNull();
  });

  it('reset() clears the close reason too', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    emit('game.spectatorClosed', { channelId: 7, reason: 'disconnected' });

    act(() => { result.current.reset(); });

    expect(result.current.closeReason).toBeNull();
  });

  it('drops a frame that arrives after stopping', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    act(() => { result.current.stopSpectating(); });

    emit('game.spectatorSnapshot', snapshotEvent({ sequence: 5 }));

    expect(result.current.match).toBeNull();
  });

  it('unregisters its bridge listeners on unmount', async () => {
    const { unmount } = renderHook(() => useSpectatorState());
    const { handlers } = await import('./spectatorTestHarness');
    expect(handlers.get('game.spectatorSnapshot')).toHaveLength(1);

    unmount();

    expect(handlers.get('game.spectatorSnapshot')).toHaveLength(0);
    expect(handlers.get('game.spectatorClosed')).toHaveLength(0);
  });
});
