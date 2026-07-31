import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuelPlayer, DuelQueueSnapshot, ReadyCheck } from '../../api/games';
import { emit, resetHarness, unknownEstimate } from './duelTestHarness';
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
  beforeEach(resetHarness);

  it('reports that you missed it when you did not ready', () => {
    const { result } = renderHook(() => useMissedReadyCheck(
      channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))), SELF));

    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed?.localReadied).toBe(false);
    expect(result.current.missed?.reservationId).toBe(41);
  });

  it('names the opponent who did not ready when you did', () => {
    // App.tsx filters its own `readyCheck` to unready-local only, so this hook must
    // read raw snapshots or this ready-player case could never fire.
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

  it('still reports after the ready check has left the snapshot', () => {
    // `game.commitmentCanceled` can be handled after the snapshot has already
    // dropped the check, so the capture must outlive it.
    const { result, rerender } = renderHook(
      ({ byChannel }) => useMissedReadyCheck(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, ready(41, [player(SELF, false), player(22, true)]))) } },
    );

    rerender({ byChannel: channels(snapshot(7, null)) });
    emit('game.commitmentCanceled', { reservationId: 41, reason: 'expired' });

    expect(result.current.missed?.reservationId).toBe(41);
  });

  it.each(['declined', 'disconnected', 'leftChannel', 'channelRemoved', 'startFailed'])(
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
